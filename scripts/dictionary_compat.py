"""Lossless supplements for the official dictionary's repeated features and tags.

Legacy scalar columns remain available. Raw JSON is never rewritten.
"""
import json
import re
from itertools import zip_longest
from pathlib import Path

PARSER_VERSION = '20261023.1'
HANJA = json.loads((Path(__file__).parent / 'hanja_references.json').read_text(encoding='utf-8'))['characters']
HANJA_TAG = re.compile(r'<hanja>([^<>]+)</hanja>')
WORD_REFERENCE = re.compile(r'<word_no>(\d+)</word_no>([^\s<>]*)')


def many(value):
    return value if isinstance(value, list) else ([] if value is None else [value])


def values(obj, name):
    return [f.get('val', '') for f in many(obj.get('feat')) if f.get('att') == name]


def first(obj, name):
    return next(iter(values(obj, name)), '')


def normalize_origin(raw):
    def replace(match):
        key = match[1]
        if key not in HANJA:
            raise ValueError(f'Unknown dictionary Hanja reference: {key}')
        return HANJA[key]
    result = HANJA_TAG.sub(replace, raw or '')
    if '<hanja' in result.lower() or '</hanja' in result.lower():
        raise ValueError(f'Malformed dictionary Hanja reference: {raw}')
    return result


def pronunciation_variants(obj):
    # Pair the nth pronunciation with the nth sound. Never repeat the last audio
    # when the source has unequal counts: missing values remain explicit nulls.
    return [{'pronunciation': p or None, 'sound_url': s or None}
            for p, s in zip_longest(values(obj, 'pronunciation'), values(obj, 'sound'))]


def word_form(obj, sub=False):
    result = {'repr_type' if sub else 'form_type': first(obj, 'type'),
              'written_form': first(obj, 'writtenForm'),
              'pronunciation': first(obj, 'pronunciation'), 'sound_url': first(obj, 'sound'),
              'pronunciation_variants': pronunciation_variants(obj)}
    if not sub:
        result['sub_forms'] = [word_form(x, True) for x in many(obj.get('FormRepresentation'))]
    return result


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from strings(child)


def supplement(entry):
    result = {}
    for feature, key in [('semanticCategory', 'semantic_categories'), ('subjectCategiory', 'subject_categories')]:
        items = values(entry, feature)
        if len(items) > 1:
            result[key] = items
    patterns = {}
    for sense in many(entry.get('Sense')):
        items = values(sense, 'syntacticPattern')
        if len(items) > 1:
            key = str(sense.get('val', ''))
            if key in patterns:
                raise ValueError(f'Duplicate sense number with repeated patterns: {key}')
            patterns[key] = items
    if patterns:
        result['syntactic_patterns'] = patterns
    forms = many(entry.get('WordForm'))
    nested = [x for wf in forms for x in [wf, *many(wf.get('FormRepresentation'))]]
    if any(len(values(x, name)) > 1 for x in nested for name in ('pronunciation', 'sound')):
        result['word_forms'] = [word_form(wf) for wf in forms]
    return result


def resolve_references(db, entry):
    resolved = {}
    for text in strings(entry):
        for match in WORD_REFERENCE.finditer(text):
            number, label = match.groups()
            # Prefer a valid source ID. Otherwise resolve only an unambiguous
            # exact headword; missing/ambiguous references stay plain text.
            found = db.execute('SELECT id FROM entries WHERE id=?', (int(number),)).fetchall()
            if not found:
                found = db.execute('SELECT id FROM entries WHERE target_code=?', (int(number),)).fetchall()
            if not found and label.rstrip('_'):
                found = db.execute('SELECT id FROM entries WHERE written_form=?', (label.rstrip('_'),)).fetchall()
            target = found[0][0] if len(found) == 1 else None
            if number in resolved and resolved[number] != target:
                target = None
            resolved[number] = target
    return resolved


def encode(payload):
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def finalize_supplements(db):
    """Resolve links only after all target headwords have been imported."""
    for entry_id, raw in db.execute("SELECT id,raw_json FROM entries WHERE instr(raw_json,'<word_no>')>0"):
        row = db.execute('SELECT data_json FROM entry_compatibility WHERE entry_id=?', (entry_id,)).fetchone()
        data = json.loads(row[0]) if row else {}
        data['references'] = resolve_references(db, json.loads(raw))
        db.execute('INSERT INTO entry_compatibility VALUES (?,?) ON CONFLICT(entry_id) DO UPDATE SET data_json=excluded.data_json',
                   (entry_id, encode(data)))
