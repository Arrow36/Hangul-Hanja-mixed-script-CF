export interface Candidate {
  entry_id: number; written_form: string; origin_raw: string | null; replacement: string | null;
  replacement_type: string | null; is_reliable: number; part_of_speech: string | null;
  vocabulary_level: string | null; homonym_number: number | null;
}
type Row = Record<string, unknown>;
export async function batchCandidates(db: D1Database, words: string[]): Promise<Record<string, Candidate[]>> {
  const result: Record<string, Candidate[]> = Object.fromEntries(words.map(w => [w, []]));
  if (!words.length) return result;
  const placeholders = words.map(() => '?').join(',');
  const query = `SELECT cc.entry_id, cc.written_form, cc.origin_raw, cc.replacement, cc.replacement_type, cc.is_reliable,
    e.part_of_speech, e.vocabulary_level, e.homonym_number FROM conversion_candidates cc
    JOIN entries e ON e.id = cc.entry_id WHERE cc.written_form IN (${placeholders})
    ORDER BY cc.written_form, cc.is_reliable DESC, e.homonym_number ASC`;
  const rows = await db.prepare(query).bind(...words).all<Candidate>();
  for (const row of rows.results) result[row.written_form]?.push(row);
  return result;
}
export async function batchOrigins(db: D1Database, words: string[]): Promise<Record<string, Row[]>> {
  const result: Record<string, Row[]> = Object.fromEntries(words.map(w => [w, []]));
  if (!words.length) return result;
  const rows = await db.prepare(`SELECT id AS entry_id, written_form, origin_raw FROM entries WHERE written_form IN (${words.map(() => '?').join(',')}) ORDER BY id`).bind(...words).all<Row>();
  for (const row of rows.results) result[String(row.written_form)]?.push(row);
  return result;
}
export async function search(db: D1Database, query: string, type: string, page: number, size: number) {
  let where: string;
  let params: (string | number)[];
  if (type === 'entry_id') { where = '(id=? OR target_code=?)'; params = [Number(query),Number(query)]; }
  else {
    const field = type === 'origin' ? 'origin_raw' : 'written_form';
    const codepoints = Array.from(query);
    const last = codepoints.pop()!;
    const upper = codepoints.join('') + String.fromCodePoint(last.codePointAt(0)! + 1);
    where = `${field} >= ? AND ${field} < ?`;
    params = [query,upper];
  }
  const total = await db.prepare(`SELECT count(*) AS n FROM entries WHERE ${where}`).bind(...params).first<{n: number}>();
  const result = await db.prepare(`SELECT id,target_code,written_form,homonym_number,part_of_speech,origin_raw,vocabulary_level,
    (SELECT definition FROM senses WHERE entry_id=entries.id ORDER BY sense_number LIMIT 1) AS definition_preview
    FROM entries WHERE ${where} ORDER BY written_form,homonym_number LIMIT ? OFFSET ?`).bind(...params, size, (page-1)*size).all<Row>();
  return { query, total: total?.n ?? 0, page, page_size: size, results: result.results };
}
async function children(db: D1Database, table: string, key: string, ids: number[]): Promise<Map<number, Row[]>> {
  const map = new Map<number, Row[]>();
  for (let i = 0; i < ids.length; i += 80) {
    const slice = ids.slice(i, i+80);
    const rows = await db.prepare(`SELECT * FROM ${table} WHERE ${key} IN (${slice.map(() => '?').join(',')}) ORDER BY id`).bind(...slice).all<Row>();
    for (const row of rows.results) {
      const k = Number(row[key]);
      const list = map.get(k) ?? [];
      list.push(row); map.set(k, list);
    }
  }
  return map;
}
export async function entryDetail(db: D1Database, id: number): Promise<Row | null> {
  const entry = await db.prepare(`SELECT id,target_code,written_form,variant,homonym_number,lexical_unit,part_of_speech,
    origin_raw,vocabulary_level,annotation,semantic_category,subject_category FROM entries
    WHERE id=? OR target_code=? ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,id LIMIT 1`).bind(id,id,id).first<Row>();
  if (!entry) return null;
  const actual = Number(entry.id);
  const senses = (await db.prepare('SELECT * FROM senses WHERE entry_id=? ORDER BY sense_number').bind(actual).all<Row>()).results;
  const senseIds = senses.map(s => Number(s.id));
  const [equiv, examples, relations, media] = await Promise.all([
    children(db, 'equivalents', 'sense_id', senseIds), children(db, 'sense_examples', 'sense_id', senseIds),
    children(db, 'sense_relations', 'sense_id', senseIds), children(db, 'multimedia', 'sense_id', senseIds)
  ]);
  entry.senses = senses.map(s => ({...s, equivalents: equiv.get(Number(s.id)) ?? [], examples: examples.get(Number(s.id)) ?? [], relations: relations.get(Number(s.id)) ?? [], multimedia: media.get(Number(s.id)) ?? []}));
  const wordForms = (await db.prepare('SELECT * FROM word_forms WHERE entry_id=? ORDER BY id').bind(actual).all<Row>()).results;
  const representations = await children(db, 'form_representations', 'word_form_id', wordForms.map(w => Number(w.id)));
  entry.word_forms = wordForms.map(w => ({...w, sub_forms: representations.get(Number(w.id)) ?? []}));
  entry.related_forms = (await db.prepare('SELECT * FROM related_forms WHERE entry_id=? ORDER BY id').bind(actual).all<Row>()).results;
  entry.raw_json = null;
  return entry;
}
export async function rawEntry(db: D1Database, id: number): Promise<unknown | null> {
  const rows = (await db.prepare('SELECT content FROM entry_raw_chunks WHERE entry_id=? ORDER BY chunk_index').bind(id).all<{content: string}>()).results;
  return rows.length ? JSON.parse(rows.map(r => r.content).join('')) as unknown : null;
}
