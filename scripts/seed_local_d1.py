"""Copy a complete imported dictionary into Wrangler's local D1 SQLite files.

Run after local migrations and with `wrangler dev` stopped. This is for local
testing only; remote D1 must be imported with scripts/import_d1.py.
"""
import argparse
import socket
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TABLES = (
    'import_metadata', 'entries', 'senses', 'equivalents', 'sense_examples',
    'sense_relations', 'multimedia', 'word_forms', 'form_representations',
    'related_forms', 'conversion_candidates',
)

def local_databases():
    folder = ROOT / '.wrangler/state/v3/d1/miniflare-D1DatabaseObject'
    main = raw = None
    for path in folder.glob('*.sqlite'):
        with sqlite3.connect(path) as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if {'entries', 'conversion_candidates'} <= tables:
            main = path
        if 'entry_raw_chunks' in tables:
            raw = path
    if not main or not raw:
        raise SystemExit('Run both local D1 migrations first; see README.md')
    return main, raw

def fill_main(path: Path, source: Path):
    with sqlite3.connect(path) as db:
        db.execute('ATTACH DATABASE ? AS source', (str(source),))
        for table in TABLES:
            columns = [row[1] for row in db.execute(f'PRAGMA table_info({table})')]
            values = ','.join('NULL' if table == 'entries' and name == 'raw_json' else name for name in columns)
            db.execute(f'INSERT OR IGNORE INTO {table} ({",".join(columns)}) SELECT {values} FROM source.{table}')
            db.commit()
            count = db.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
            print(f'{table}: {count}', flush=True)
        db.execute('DETACH DATABASE source')

def fill_raw(path: Path, source: Path):
    with sqlite3.connect(source) as original, sqlite3.connect(path) as raw_db:
        inserted = 0
        for entry_id, data in original.execute('SELECT id,raw_json FROM entries'):
            for index, start in enumerate(range(0, len(data), 6000)):
                raw_db.execute('INSERT OR IGNORE INTO entry_raw_chunks VALUES (?,?,?)',
                               (entry_id, index, data[start:start+6000]))
                inserted += 1
            if entry_id % 1000 == 0:
                raw_db.commit()
        raw_db.commit()
        print(f'entry_raw_chunks: {raw_db.execute("SELECT count(*) FROM entry_raw_chunks").fetchone()[0]}', flush=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', nargs='?', type=Path, default=ROOT / 'hanja_dict.db')
    args = parser.parse_args()
    source = args.source.resolve()
    if not source.is_file():
        parser.error(f'SQLite dictionary not found: {source}')
    with socket.socket() as probe:
        probe.settimeout(0.2)
        if probe.connect_ex(('127.0.0.1', 8787)) == 0:
            parser.error('Stop the local Wrangler dev server on port 8787 before seeding D1')
    main_db, raw_db = local_databases()
    print(f'Local main D1: {main_db}', flush=True)
    fill_main(main_db, source)
    print(f'Local raw D1: {raw_db}', flush=True)
    fill_raw(raw_db, source)

if __name__ == '__main__':
    main()
