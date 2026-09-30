"""Compare two imported SQLite snapshots and export changed entries for both D1 databases.

Usage: python scripts/prepare_incremental.py OLD.db NEW.db output/delta/OLD-NEW
The generated SQL is applied with scripts/apply_incremental.py, never with
import_d1.py directly: the apply script verifies the remote source SHA first.
"""
import argparse
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path

from export_d1 import quote

MAX_FILE = 1_900_000
CHUNK_SIZE = 6000
ENTRY_COLUMNS = ('id', 'target_code', 'written_form', 'variant', 'homonym_number',
                 'lexical_unit', 'part_of_speech', 'origin_raw', 'vocabulary_level',
                 'annotation', 'semantic_category', 'subject_category', 'raw_json')
CHILD_TABLES = ('senses', 'equivalents', 'sense_examples', 'sense_relations',
                'multimedia', 'word_forms', 'form_representations',
                'related_forms', 'conversion_candidates')


def insert(table, fields, values):
    return (f'INSERT OR IGNORE INTO {table} ({",".join(fields)}) VALUES '
            f'({",".join(map(quote, values))});\n')


def rows(db, table, column, value):
    return db.execute(f'SELECT * FROM {table} WHERE {column}=? ORDER BY id', (value,))


def child_lines(db, table, column, value, replace=None):
    for row in rows(db, table, column, value):
        fields = [key for key in row.keys() if key != 'id']
        values = [replace if key == column and replace is not None else row[key] for key in fields]
        yield insert(table, fields, values)


def stable_child_id(entry_id, index):
    if entry_id < 0 or index >= 10_000 or entry_id > 922_337_203_685_476:
        raise ValueError(f'Cannot assign a stable child ID for entry {entry_id}')
    return -(entry_id * 10_000 + index + 1)


def main_lines(db, entry_id):
    yield f'DELETE FROM entries WHERE id={entry_id};\n'
    entry = db.execute('SELECT * FROM entries WHERE id=?', (entry_id,)).fetchone()
    if entry is None:
        return
    yield insert('entries', ENTRY_COLUMNS,
                 [None if key == 'raw_json' else entry[key] for key in ENTRY_COLUMNS])
    for index, sense in enumerate(rows(db, 'senses', 'entry_id', entry_id)):
        sense_id = stable_child_id(entry_id, index)
        fields = [key for key in sense.keys() if key != 'id']
        yield insert('senses', ['id', *fields], [sense_id, *(sense[key] for key in fields)])
        for table in ('equivalents', 'sense_examples', 'sense_relations', 'multimedia'):
            yield from child_lines(db, table, 'sense_id', sense['id'], sense_id)
    for index, form in enumerate(rows(db, 'word_forms', 'entry_id', entry_id)):
        form_id = stable_child_id(entry_id, index)
        fields = [key for key in form.keys() if key != 'id']
        yield insert('word_forms', ['id', *fields], [form_id, *(form[key] for key in fields)])
        yield from child_lines(db, 'form_representations', 'word_form_id', form['id'], form_id)
    for table in ('related_forms', 'conversion_candidates'):
        yield from child_lines(db, table, 'entry_id', entry_id)


def raw_lines(db, entry_id):
    yield f'DELETE FROM entry_raw_chunks WHERE entry_id={entry_id};\n'
    row = db.execute('SELECT raw_json FROM entries WHERE id=?', (entry_id,)).fetchone()
    if row:
        for index, start in enumerate(range(0, len(row['raw_json']), CHUNK_SIZE)):
            yield insert('entry_raw_chunks', ('entry_id', 'chunk_index', 'content'),
                         (entry_id, index, row['raw_json'][start:start + CHUNK_SIZE]))


class ChunkWriter:
    def __init__(self, directory):
        self.directory = directory
        directory.mkdir(parents=True)
        self.index = 0
        self.stream = None
        self.size = 0

    def add(self, lines):
        block = ''.join(lines).encode('utf-8')
        if len(block) > MAX_FILE:
            raise ValueError('One entry exceeds the SQL file size limit')
        if self.stream is None or self.size + len(block) > MAX_FILE:
            self.close()
            self.index += 1
            self.stream = (self.directory / f'{self.index:06d}.sql').open('wb')
            self.size = 0
        self.stream.write(block)
        self.size += len(block)

    def close(self):
        if self.stream:
            self.stream.close()
            self.stream = None


def metadata(db):
    result = db.execute('SELECT * FROM import_metadata').fetchall()
    if len(result) != 1 or not result[0]['sha256']:
        raise ValueError('Each snapshot must have one import_metadata row with a source SHA')
    return dict(result[0])


def validate_schema(db):
    required = ('entries', 'import_metadata', *CHILD_TABLES)
    for table in required:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            raise ValueError(f'Missing table: {table}')


def prepare(old_path, new_path, output):
    if output.exists():
        raise ValueError(f'Output already exists; choose a fresh directory: {output}')
    with closing(sqlite3.connect(f'file:{old_path.resolve()}?mode=ro', uri=True)) as old, \
         closing(sqlite3.connect(f'file:{new_path.resolve()}?mode=ro', uri=True)) as new:
        old.row_factory = new.row_factory = sqlite3.Row
        validate_schema(old); validate_schema(new)
        old_meta, new_meta = metadata(old), metadata(new)
        if old_meta['sha256'] == new_meta['sha256']:
            raise ValueError('Both SQLite files represent the same source ZIP')
        old_rows = {row['id']: row['raw_json'] for row in old.execute('SELECT id,raw_json FROM entries')}
        new_rows = {row['id']: row['raw_json'] for row in new.execute('SELECT id,raw_json FROM entries')}
        changed = sorted(key for key in old_rows.keys() & new_rows.keys() if old_rows[key] != new_rows[key])
        added = sorted(new_rows.keys() - old_rows.keys())
        removed = sorted(old_rows.keys() - new_rows.keys())
        ids = sorted(set(changed + added + removed))
        if not ids and old_meta['data_version'] == new_meta['data_version']:
            raise ValueError('No entries or version changed')
        main_writer = ChunkWriter(output / 'main')
        raw_writer = ChunkWriter(output / 'raw')
        try:
            for entry_id in ids:
                main_writer.add(main_lines(new, entry_id))
                raw_writer.add(raw_lines(new, entry_id))
        finally:
            main_writer.close(); raw_writer.close()
        main_writer.index += 1
        meta_fields = list(new_meta)
        (output / 'main' / f'{main_writer.index:06d}.sql').write_text(
            'DELETE FROM import_metadata;\n' +
            insert('import_metadata', meta_fields, [new_meta[key] for key in meta_fields]),
            encoding='utf-8')
        manifest = {'old_sha256': old_meta['sha256'], 'new_sha256': new_meta['sha256'],
                    'old_version': old_meta['data_version'], 'new_version': new_meta['data_version'],
                    'old_entries': len(old_rows), 'new_entries': len(new_rows),
                    'added': len(added), 'changed': len(changed), 'removed': len(removed),
                    'main_files': main_writer.index, 'raw_files': raw_writer.index}
        manifest['sql_sha256'] = {
            str(path.relative_to(output)).replace('\\', '/'): hashlib.sha256(path.read_bytes()).hexdigest()
            for part in ('raw', 'main') for path in sorted((output / part).glob('*.sql'))
        }
        (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('old_database', type=Path)
    parser.add_argument('new_database', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    for path in (args.old_database, args.new_database):
        if not path.is_file(): parser.error(f'No such SQLite snapshot: {path}')
    print(json.dumps(prepare(args.old_database, args.new_database, args.output), indent=2))


if __name__ == '__main__': main()
