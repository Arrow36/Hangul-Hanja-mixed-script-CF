import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from collections import defaultdict
from unittest.mock import patch

from app.schema import create_schema
from scripts.dictionary_compat import normalize_origin, pronunciation_variants, supplement, finalize_supplements
from scripts.import_dictionary import import_entry
from scripts.repair_compatibility import prepare, apply
from scripts.apply_incremental import wrangler


def feat(**fields):
    return [{'att': key, 'val': item} for key, value in fields.items()
            for item in (value if isinstance(value, list) else [value])]


def source_entry():
    return {'val': '85442', 'feat': feat(origin='<hanja>6255_1</hanja><hanja>10964_2</hanja>시키다',
                                        semanticCategory=['a', 'b'], subjectCategiory=['x', 'y']),
            'Lemma': {'feat': feat(writtenForm='밀착시키다')},
            'Sense': {'val': '1', 'feat': feat(definition='→ <word_no>601450</word_no>콘텐츠_',
                                             syntacticPattern=['pattern1', 'pattern2'])},
            'WordForm': {'feat': feat(writtenForm='식히어', pronunciation=['시키어', '시키여'],
                                      sound=['https://example.com/a.wav', 'https://example.com/b.wav']),
                         'FormRepresentation': {'feat': feat(pronunciation=['one', 'two'], sound=['https://example.com/c.wav'])}}}


class CompatibilityTest(unittest.TestCase):
    def test_known_and_unknown_hanja(self):
        self.assertEqual(normalize_origin('<hanja>14861_1</hanja><hanja>7689_1</hanja>시키다'), '負擔시키다')
        with self.assertRaisesRegex(ValueError, 'Unknown'):
            normalize_origin('<hanja>new_id</hanja>')
        with self.assertRaisesRegex(ValueError, 'Malformed'):
            normalize_origin('<hanja>6255_1')

    def test_import_preserves_raw_and_all_repeated_features(self):
        db = sqlite3.connect(':memory:')
        self.addCleanup(db.close)
        create_schema(db)
        raw = source_entry()
        import_entry(db, raw, defaultdict(int), {})
        db.execute("INSERT INTO entries(id,target_code,written_form,raw_json) VALUES(600228,600228,'콘텐츠','{}')")
        finalize_supplements(db)
        self.assertEqual(json.loads(db.execute('SELECT raw_json FROM entries WHERE id=85442').fetchone()[0]), raw)
        self.assertEqual(db.execute('SELECT replacement,is_reliable FROM conversion_candidates').fetchone(), ('密着', 1))
        data = json.loads(db.execute('SELECT data_json FROM entry_compatibility').fetchone()[0])
        self.assertEqual(data['semantic_categories'], ['a', 'b'])
        self.assertEqual(data['subject_categories'], ['x', 'y'])
        self.assertEqual(data['syntactic_patterns']['1'], ['pattern1', 'pattern2'])
        self.assertEqual(data['references']['601450'], 600228)
        self.assertEqual(data['word_forms'][0]['pronunciation_variants'][1],
                         {'pronunciation': '시키여', 'sound_url': 'https://example.com/b.wav'})
        self.assertIsNone(data['word_forms'][0]['sub_forms'][0]['pronunciation_variants'][1]['sound_url'])

    def test_repair_same_snapshot_replay_and_source_guard(self):
        output = Path(__file__).resolve().parents[1] / 'output'
        output.mkdir(exist_ok=True)
        temp_dir = tempfile.TemporaryDirectory(dir=output)
        self.addCleanup(temp_dir.cleanup)
        temp = temp_dir.name
        root = Path(temp)
        source = root / 'source.db'
        db = sqlite3.connect(source)
        self.addCleanup(db.close)
        create_schema(db)
        raw = source_entry()
        db.execute("INSERT INTO import_metadata(id,source_filename,sha256,import_timestamp,data_version) VALUES(1,'snapshot.zip','source-sha','test','20261019')")
        db.execute('INSERT INTO entries(id,target_code,written_form,origin_raw,raw_json) VALUES(85442,85442,?,?,?)',
                   ('밀착시키다', raw['feat'][0]['val'], json.dumps(raw, ensure_ascii=False)))
        db.execute("INSERT INTO entries(id,target_code,written_form,raw_json) VALUES(600228,600228,'콘텐츠','{}')")
        # A D1 incremental import has unrelated/negative child IDs. Repair
        # must not assume IDs assigned by a freshly rebuilt SQLite file.
        db.execute("INSERT INTO senses(id,entry_id,sense_number,syntactic_pattern) VALUES(-854420001,85442,'1','pattern1')")
        db.commit()
        directory = root / 'repair'
        manifest = prepare(source, directory)
        self.assertEqual(manifest['supplements'], 1)
        db.row_factory = sqlite3.Row
        select = lambda sql: [dict(r) for r in db.execute(sql)]
        def execute(path):
            db.executescript('BEGIN;\n' + path.read_text(encoding='utf-8') + '\nCOMMIT;')
        # Simulate interruption after SQL data writes but before verification
        # and completion metadata. Replaying the file must remain safe.
        execute(next((directory / 'main').glob('*.sql')))
        apply(directory, select, execute)
        before = db.execute('SELECT data_json FROM entry_compatibility').fetchone()[0]
        apply(directory, select, execute)
        self.assertEqual(db.execute('SELECT data_json FROM entry_compatibility').fetchone()[0], before)
        self.assertEqual(db.execute('SELECT count(*) FROM conversion_candidates').fetchone()[0], 1)
        self.assertEqual(db.execute('SELECT id FROM senses').fetchone()[0], -854420001)
        self.assertEqual(json.loads(db.execute('SELECT raw_json FROM entries WHERE id=85442').fetchone()[0]), raw)
        db.execute("UPDATE import_metadata SET sha256='wrong'")
        with self.assertRaisesRegex(ValueError, 'source SHA'):
            apply(directory, select, execute)

    def test_utf8_wrangler_output(self):
        with patch('scripts.apply_incremental.shutil.which', return_value='npx.cmd'), \
             patch('scripts.apply_incremental.subprocess.run') as run:
            run.return_value.returncode = 0
            run.return_value.stdout = json.dumps([{'success': True, 'results': [{'word': '경제'}]}], ensure_ascii=False)
            self.assertEqual(wrangler('db', '--local')[0]['results'][0]['word'], '경제')
            self.assertEqual(run.call_args.kwargs['encoding'], 'utf-8')
            self.assertEqual(run.call_args.kwargs['errors'], 'strict')


if __name__ == '__main__':
    unittest.main()
