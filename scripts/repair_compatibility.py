"""Prepare/apply a resumable repair of derived data without changing the ZIP.

Apply migrations/0002_dictionary_compatibility.sql first. The raw D1 is never
written. Replaying a repair is safe, including after a partially applied file.
"""
import argparse
import hashlib
import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'scripts'))
from scripts.dictionary_compat import PARSER_VERSION, encode, first, normalize_origin, resolve_references, supplement
from scripts.import_dictionary import classify_origin, has_cjk
from scripts.export_d1 import quote
from scripts.prepare_incremental import ChunkWriter
from scripts.apply_incremental import query, wrangler


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(source, directory):
    if directory.exists():
        raise ValueError('Choose a fresh repair directory; never overwrite a prepared repair')
    expected = {'supplements': [], 'origins': [], 'origin_entries': 0}
    with closing(sqlite3.connect(f'file:{source.resolve()}?mode=ro', uri=True)) as db:
        db.row_factory = sqlite3.Row
        metadata = db.execute('SELECT * FROM import_metadata').fetchall()
        if len(metadata) != 1:
            raise ValueError('Source snapshot must have exactly one metadata row')
        meta = dict(metadata[0])
        for row in db.execute('SELECT id,written_form,origin_raw,raw_json FROM entries ORDER BY id'):
            raw = json.loads(row['raw_json'])
            extra = supplement(raw)
            if '<word_no>' in row['raw_json']:
                extra['references'] = resolve_references(db, raw)
            if extra:
                expected['supplements'].append([row['id'], encode(extra)])
            source_origin = first(raw, 'origin')
            normalized = normalize_origin(source_origin)
            expected['origin_entries'] += bool(has_cjk(normalized))
            if normalized != source_origin:
                replacement, kind, reliable = classify_origin(normalized, row['written_form'])
                if not replacement or not reliable:
                    raise ValueError(f'Unreliable normalized candidate: {row["id"]}')
                expected['origins'].append({'entry_id': row['id'], 'written_form': row['written_form'].strip('-'),
                                           'source_origin': source_origin, 'origin_raw': normalized,
                                           'replacement': replacement, 'replacement_type': kind, 'is_reliable': reliable})
        expected['entries'] = db.execute('SELECT count(*) FROM entries').fetchone()[0]
    writer = ChunkWriter(directory / 'main')
    try:
        for entry_id, data in expected['supplements']:
            writer.add([f'INSERT INTO entry_compatibility(entry_id,data_json) VALUES ({entry_id},{quote(data)}) '
                        'ON CONFLICT(entry_id) DO UPDATE SET data_json=excluded.data_json '
                        'WHERE data_json<>excluded.data_json;\n'])
        for item in expected['origins']:
            eid = item['entry_id']
            assignments = ','.join(f'{key}={quote(item[key])}' for key in
                                   ('written_form', 'origin_raw', 'replacement', 'replacement_type', 'is_reliable'))
            fields = ['entry_id', 'written_form', 'origin_raw', 'replacement', 'replacement_type', 'is_reliable']
            writer.add([
                f'UPDATE entries SET origin_raw={quote(item["origin_raw"])} WHERE id={eid} '
                f'AND origin_raw={quote(item["source_origin"])};\n',
                f'UPDATE conversion_candidates SET {assignments} WHERE entry_id={eid};\n',
                f'INSERT INTO conversion_candidates({",".join(fields)}) SELECT {",".join(quote(item[k]) for k in fields)} '
                f'WHERE NOT EXISTS(SELECT 1 FROM conversion_candidates WHERE entry_id={eid});\n'])
    finally:
        writer.close()
    (directory / 'expected.json').write_text(encode(expected) + '\n', encoding='utf-8')
    manifest = {'repair_id': 'dictionary-compatibility-' + PARSER_VERSION,
                'source_sha256': meta['sha256'], 'data_version': meta['data_version'],
                'parser_version': PARSER_VERSION, 'entries': expected['entries'],
                'supplements': len(expected['supplements']), 'origins': len(expected['origins']),
                'expected_sha256': digest(directory / 'expected.json'),
                'sql_sha256': {p.name: digest(p) for p in sorted((directory / 'main').glob('*.sql'))}}
    (directory / 'manifest.json').write_text(encode(manifest) + '\n', encoding='utf-8')
    return manifest


def apply(directory, select, execute):
    """select/execute adapters support either SQLite validation or real D1."""
    manifest_path = directory / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    expected = json.loads((directory / 'expected.json').read_text(encoding='utf-8'))
    if digest(directory / 'expected.json') != manifest['expected_sha256']:
        raise ValueError('Repair expectations have changed')
    files = sorted((directory / 'main').glob('*.sql'))
    if {p.name: digest(p) for p in files} != manifest['sql_sha256']:
        raise ValueError('Repair SQL files have changed')
    current = select('SELECT sha256,parser_version FROM import_metadata')
    if len(current) != 1 or current[0]['sha256'] != manifest['source_sha256']:
        raise ValueError('Repair source SHA does not match the target dictionary')
    if current[0]['parser_version'] not in ('legacy', manifest['parser_version']):
        raise ValueError('Target has another parser version; refusing to overwrite it')
    if select('SELECT count(*) AS n FROM entries')[0]['n'] != expected['entries']:
        raise ValueError('Target entry count differs from the source snapshot')
    records = select(f'SELECT manifest_sha256 FROM dictionary_repairs WHERE repair_id={quote(manifest["repair_id"])}')
    if records and records[0]['manifest_sha256'] != digest(manifest_path):
        raise ValueError('This repair ID already belongs to another manifest')
    for item in expected['origins']:
        rows = select(f'SELECT written_form,origin_raw FROM entries WHERE id={item["entry_id"]}')
        if len(rows) != 1 or rows[0]['written_form'].strip('-') != item['written_form'] or \
           rows[0]['origin_raw'] not in (item['source_origin'], item['origin_raw']):
            raise ValueError(f'Origin precondition failed: {item["entry_id"]}')
    if not records:
        for index, path in enumerate(files, 1):
            print(f'Applying compatibility file {index}/{len(files)}', flush=True)
            execute(path)
    actual = [[row['entry_id'], row['data_json']] for row in
              select('SELECT entry_id,data_json FROM entry_compatibility ORDER BY entry_id')]
    if actual != expected['supplements']:
        raise ValueError('Supplement contents do not match; repair remains incomplete')
    for item in expected['origins']:
        eid = item['entry_id']
        if select(f'SELECT origin_raw FROM entries WHERE id={eid}')[0]['origin_raw'] != item['origin_raw']:
            raise ValueError(f'Origin verification failed: {eid}')
        rows = select(f'SELECT written_form,origin_raw,replacement,replacement_type,is_reliable FROM conversion_candidates WHERE entry_id={eid}')
        if len(rows) != 1 or any(rows[0][key] != item[key] for key in rows[0]):
            raise ValueError(f'Candidate verification failed: {eid}')
    if not records:
        final = directory / 'finalize.sql'
        final.write_text(
            f'UPDATE import_metadata SET parser_version={quote(manifest["parser_version"])},origin_entries={expected["origin_entries"]};\n'
            f'INSERT INTO dictionary_repairs VALUES ({quote(manifest["repair_id"])},{quote(manifest["source_sha256"])},'
            f'{quote(digest(manifest_path))},strftime(\'%Y-%m-%dT%H:%M:%SZ\',\'now\'));\n', encoding='utf-8')
        execute(final)
    after = select('SELECT parser_version,origin_entries FROM import_metadata')[0]
    if after['parser_version'] != manifest['parser_version'] or after['origin_entries'] != expected['origin_entries']:
        raise ValueError('Repair metadata verification failed')
    print(f'Verified {len(actual)} complete supplements and {len(expected["origins"])} restored candidates; parser {manifest["parser_version"]}.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    prep = commands.add_parser('prepare')
    prep.add_argument('source', type=Path)
    prep.add_argument('directory', type=Path)
    run = commands.add_parser('apply')
    run.add_argument('directory', type=Path)
    target = run.add_mutually_exclusive_group(required=True)
    target.add_argument('--sqlite', type=Path)
    target.add_argument('--remote', action='store_true')
    target.add_argument('--local', action='store_true')
    run.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.action == 'prepare':
        print(json.dumps(prepare(args.source, args.directory), indent=2))
    elif not args.apply:
        parser.error('Review the prepared SQL and add --apply to write the repair')
    elif args.sqlite:
        if not args.sqlite.is_file():
            parser.error('SQLite target does not exist')
        with closing(sqlite3.connect(args.sqlite)) as db:
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA foreign_keys=ON')
            def select(sql):
                return [dict(r) for r in db.execute(sql)]
            def execute(path):
                db.executescript('BEGIN;\n' + path.read_text(encoding='utf-8') + '\nCOMMIT;')
            apply(args.directory, select, execute)
    else:
        mode = '--remote' if args.remote else '--local'
        apply(args.directory, lambda sql: query('hangul-hanja-dictionary', mode, sql),
              lambda path: wrangler('hangul-hanja-dictionary', mode, '--file', str(path)))


if __name__ == '__main__':
    main()
