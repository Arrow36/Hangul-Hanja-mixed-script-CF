"""Check that an entry delta handles changed, added, and removed entries."""
import json
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from prepare_incremental import prepare  # noqa: E402
from app.schema import create_schema  # noqa: E402


def make_snapshot(path, version, entries):
    db = sqlite3.connect(path)
    create_schema(db)
    db.execute('INSERT INTO import_metadata (id,source_filename,sha256,import_timestamp,data_version) '
               'VALUES (1,?,?,?,?)', (version + '.zip', version, 'test', version))
    for entry_id, word in entries.items():
        raw = json.dumps({'val': entry_id, 'word': word}, ensure_ascii=False)
        db.execute('INSERT INTO entries (id,target_code,written_form,raw_json) VALUES (?,?,?,?)',
                   (entry_id, entry_id, word, raw))
        sense_id = db.execute('INSERT INTO senses (entry_id,sense_number,definition) VALUES (?,?,?)',
                              (entry_id, '1', word + ' definition')).lastrowid
        db.execute('INSERT INTO equivalents (sense_id,language,lemma) VALUES (?,?,?)',
                   (sense_id, 'en', word))
        db.execute('INSERT INTO sense_examples (sense_id,example) VALUES (?,?)',
                   (sense_id, word + ' example'))
        form_id = db.execute('INSERT INTO word_forms (entry_id,written_form) VALUES (?,?)',
                             (entry_id, word)).lastrowid
        db.execute('INSERT INTO form_representations (word_form_id,written_form) VALUES (?,?)',
                   (form_id, word))
        db.execute('INSERT INTO conversion_candidates (written_form,entry_id,replacement) VALUES (?,?,?)',
                   (word, entry_id, word))
    db.commit(); db.close()


class IncrementalTest(unittest.TestCase):
    def test_changed_added_removed_and_replay(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'output') as directory:
            root = Path(directory)
            old, new, result = root / 'old.db', root / 'new.db', root / 'delta'
            make_snapshot(old, 'old', {1: 'same', 2: 'before', 3: 'removed'})
            make_snapshot(new, 'new', {1: 'same', 2: 'after', 4: 'added'})
            manifest = prepare(old, new, result)
            self.assertEqual((manifest['added'], manifest['changed'], manifest['removed']), (1, 1, 1))
            main = sqlite3.connect(root / 'main.db')
            main.executescript((ROOT / 'migrations' / '0001_schema.sql').read_text(encoding='utf-8'))
            main.execute('ATTACH DATABASE ? AS source', (str(old),))
            for table in ('import_metadata', 'entries', 'senses', 'equivalents', 'sense_examples',
                          'sense_relations', 'multimedia', 'word_forms', 'form_representations',
                          'related_forms', 'conversion_candidates'):
                if table == 'entries':
                    fields = [row[1] for row in main.execute('PRAGMA table_info(entries)')]
                    select = ','.join('NULL' if field == 'raw_json' else field for field in fields)
                    main.execute(f'INSERT INTO entries SELECT {select} FROM source.entries')
                else:
                    main.execute(f'INSERT INTO {table} SELECT * FROM source.{table}')
            main.commit()
            main.execute('DETACH DATABASE source')
            main.execute('PRAGMA foreign_keys=ON')
            raw = sqlite3.connect(':memory:')
            raw.executescript((ROOT / 'migrations_raw' / '0001_raw.sql').read_text(encoding='utf-8'))
            with closing(sqlite3.connect(old)) as source:
                for entry_id, content in source.execute('SELECT id,raw_json FROM entries'):
                    raw.execute('INSERT INTO entry_raw_chunks VALUES (?,?,?)', (entry_id, 0, content))
            for database, part in ((raw, 'raw'), (main, 'main')):
                for path in sorted((result / part).glob('*.sql')):
                    database.executescript(path.read_text(encoding='utf-8'))
            self.assertEqual(main.execute('SELECT id,written_form FROM entries ORDER BY id').fetchall(),
                             [(1, 'same'), (2, 'after'), (4, 'added')])
            self.assertEqual(main.execute('SELECT sha256 FROM import_metadata').fetchone()[0], 'new')
            self.assertEqual(main.execute('PRAGMA foreign_key_check').fetchall(), [])
            self.assertEqual(raw.execute('SELECT entry_id FROM entry_raw_chunks ORDER BY entry_id').fetchall(),
                             [(1,), (2,), (4,)])
            main.close(); raw.close()


if __name__ == '__main__': unittest.main()
