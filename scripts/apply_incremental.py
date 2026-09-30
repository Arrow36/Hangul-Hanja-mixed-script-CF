"""Apply a prepared dictionary delta after checking the live D1 source version.

Usage: python scripts/apply_incremental.py output/delta/OLD-NEW --remote --apply
The raw database is updated first. Resume the same command after interruption.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path


def wrangler(database, mode, *args):
    npx = shutil.which('npx.cmd' if os.name == 'nt' else 'npx')
    if not npx:
        raise RuntimeError('npx was not found')
    command = [npx, 'wrangler', 'd1', 'execute', database, mode, *args, '--json']
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, errors='replace')
    if result.returncode:
        raise RuntimeError(f'Wrangler failed ({result.returncode}): {result.stdout[-1500:]}')
    match = re.search(r'(?m)^\[\s*\{', result.stdout)
    if not match:
        raise RuntimeError(f'Cannot parse Wrangler response: {result.stdout[-1500:]}')
    payload = json.loads(result.stdout[match.start():])
    if not isinstance(payload, list) or not all(item.get('success') for item in payload):
        raise RuntimeError(f'D1 did not report success: {result.stdout[-1500:]}')
    return payload


def query(database, mode, sql):
    payload = wrangler(database, mode, '--command', sql)
    return payload[0]['results']


def apply_files(directory, database, mode):
    files = sorted(directory.glob('*.sql'))
    checkpoint = directory / f'.applied-{mode.removeprefix("--")}'
    done = set(checkpoint.read_text(encoding='utf-8').splitlines()) if checkpoint.exists() else set()
    if done - {file.name for file in files}:
        raise RuntimeError(f'Checkpoint refers to missing SQL files: {checkpoint}')
    for index, path in enumerate(files, 1):
        if path.name in done:
            continue
        print(f'[{database} {index}/{len(files)}] {path.name}', flush=True)
        for attempt in range(1, 6):
            try:
                wrangler(database, mode, '--file', str(path))
                break
            except RuntimeError:
                if attempt == 5:
                    raise
                delay = min(30, 2 ** attempt)
                print(f'Retrying in {delay}s ({attempt + 1}/5)', flush=True)
                time.sleep(delay)
        with checkpoint.open('a', encoding='utf-8') as stream:
            stream.write(path.name + '\n')


def apply(directory, mode):
    manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
    for part, count in (('raw', 'raw_files'), ('main', 'main_files')):
        files = list((directory / part).glob('*.sql'))
        if len(files) != manifest[count]:
            raise RuntimeError(f'{part} SQL file count differs from the manifest')
        for path in files:
            key = f'{part}/{path.name}'
            if hashlib.sha256(path.read_bytes()).hexdigest() != manifest['sql_sha256'].get(key):
                raise RuntimeError(f'SQL file differs from the manifest: {key}')
    current = query('hangul-hanja-dictionary', mode,
                    'SELECT sha256,data_version FROM import_metadata LIMIT 1')
    if len(current) != 1:
        raise RuntimeError('Remote dictionary version is missing or ambiguous')
    if current[0]['sha256'] == manifest['new_sha256']:
        print('D1 already records the new snapshot; verifying row counts.')
    elif current[0]['sha256'] != manifest['old_sha256']:
        raise RuntimeError(f'D1 source SHA {current[0]["sha256"]} differs from the expected old snapshot')
    else:
        started = directory / f'.started-{mode.removeprefix("--")}'
        if not started.exists():
            old_count = query('hangul-hanja-dictionary', mode, 'SELECT count(*) AS n FROM entries')[0]['n']
            if old_count != manifest['old_entries']:
                raise RuntimeError(f'D1 has {old_count} entries, expected {manifest["old_entries"]}')
            started.write_text(manifest['old_sha256'] + '\n', encoding='utf-8')
        elif started.read_text(encoding='utf-8').strip() != manifest['old_sha256']:
            raise RuntimeError('Checkpoint belongs to another source snapshot')
        apply_files(directory / 'raw', 'hangul-hanja-raw', mode)
        apply_files(directory / 'main', 'hangul-hanja-dictionary', mode)
    after = query('hangul-hanja-dictionary', mode,
                  'SELECT sha256,data_version FROM import_metadata LIMIT 1')
    main_count = query('hangul-hanja-dictionary', mode, 'SELECT count(*) AS n FROM entries')[0]['n']
    raw_count = query('hangul-hanja-raw', mode,
                      'SELECT count(DISTINCT entry_id) AS n FROM entry_raw_chunks')[0]['n']
    if len(after) != 1 or after[0]['sha256'] != manifest['new_sha256'] or \
       main_count != manifest['new_entries'] or raw_count != manifest['new_entries']:
        raise RuntimeError(f'Post-update verification failed: metadata={after}, '
                           f'main={main_count}, raw={raw_count}')
    print(f'Updated D1 to {after[0]["data_version"]}: '
          f'{main_count} main entries, {raw_count} raw entries.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--remote', action='store_true')
    mode.add_argument('--local', action='store_true')
    parser.add_argument('--apply', action='store_true', help='Required to write to D1')
    args = parser.parse_args()
    if not args.apply:
        parser.error('Add --apply after reviewing manifest.json and the SQL files')
    apply(args.directory, '--remote' if args.remote else '--local')


if __name__ == '__main__': main()
