"""Export the original SQLite dictionary to two resumable D1 SQL file sets.

Usage: python scripts/export_d1.py hanja_dict.db output/d1
"""
import argparse
import sqlite3
from pathlib import Path

TABLES = ('import_metadata', 'entries', 'senses', 'equivalents', 'sense_examples',
          'sense_relations', 'multimedia', 'word_forms', 'form_representations',
          'related_forms', 'conversion_candidates')
MAX_FILE = 2_000_000

def quote(value):
    if value is None: return 'NULL'
    if isinstance(value, (int, float)): return str(value)
    if isinstance(value, bytes): return "X'" + value.hex() + "'"
    return "'" + str(value).replace("'", "''") + "'"

class Writer:
    def __init__(self, directory):
        self.directory = directory
        directory.mkdir(parents=True, exist_ok=True)
        self.number = 0
        self.file = None
        self.size = 0
    def write(self, line):
        encoded = line.encode('utf-8')
        if self.file is None or self.size + len(encoded) > MAX_FILE:
            if self.file: self.file.close()
            self.number += 1
            self.file = (self.directory / f'{self.number:04d}.sql').open('wb')
            self.size = 0
        self.file.write(encoded)
        self.size += len(encoded)
    def close(self):
        if self.file: self.file.close()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if not args.database.is_file(): parser.error('SQLite database does not exist')
    db = sqlite3.connect(f'file:{args.database.resolve()}?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    main_writer = Writer(args.output / 'main')
    raw_writer = Writer(args.output / 'raw')
    try:
        for table in TABLES:
            columns = [row[1] for row in db.execute(f'PRAGMA table_info({table})')]
            for row in db.execute(f'SELECT * FROM {table}'):
                vals = [None if table == 'entries' and col == 'raw_json' else row[col] for col in columns]
                main_writer.write(f'INSERT OR IGNORE INTO {table} ({",".join(columns)}) VALUES ({",".join(map(quote, vals))});\n')
                if table == 'entries':
                    raw = row['raw_json']
                    for index, start in enumerate(range(0, len(raw), 6000)):
                        raw_writer.write(f'INSERT OR IGNORE INTO entry_raw_chunks (entry_id,chunk_index,content) VALUES ({row["id"]},{index},{quote(raw[start:start+6000])});\n')
            print(f'exported {table}', flush=True)
    finally:
        main_writer.close(); raw_writer.close(); db.close()
    print(f'main files: {main_writer.number}, raw files: {raw_writer.number}')

if __name__ == '__main__': main()
