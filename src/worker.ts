import { batchCandidates, batchOrigins, entryDetail, rawEntry, search } from './db';

interface Env { DB: D1Database; RAW_DB: D1Database; ASSETS: Fetcher }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const error = (code: string, message: string, status: number) => json({ error: code, message }, status);
function wordsOf(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 80 || value.some(w => typeof w !== 'string' || w.length < 1 || w.length > 100)) return null;
  return [...new Set(value as string[])];
}
async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get('content-length') ?? 0) > 20000) return null;
  try {
    const reader = request.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 20000) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch { return null; }
}
async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/api/dictionary/batch' || path === '/api/dictionary/origins') {
    if (request.method !== 'POST') return error('METHOD_NOT_ALLOWED', 'Method not allowed', 405);
    const words = wordsOf((await bodyOf(request))?.words);
    if (!words) return error('INVALID_WORDS', 'Expected up to 80 words of 1–100 characters', 400);
    return json(path.endsWith('/origins') ? await batchOrigins(env.DB, words) : await batchCandidates(env.DB, words));
  }
  if (path === '/api/lookup') {
    const query = url.searchParams.get('query') ?? '';
    const type = url.searchParams.get('search_type') ?? 'written_form';
    const page = Number(url.searchParams.get('page') ?? 1);
    const size = Number(url.searchParams.get('page_size') ?? 20);
    if (!query || query.length > 200 || !['written_form','origin','entry_id'].includes(type) || !Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(size) || size < 1 || size > 100 || (type === 'entry_id' && !/^\d+$/.test(query))) return error('INVALID_QUERY', 'Invalid lookup parameters', 400);
    return json(await search(env.DB, query, type, page, size));
  }
  const entryMatch = /^\/api\/entries\/(\d+)(\/raw)?$/.exec(path);
  if (entryMatch) {
    const id = Number(entryMatch[1]);
    if (!Number.isSafeInteger(id) || id < 1) return error('INVALID_ENTRY_ID', 'Invalid entry ID', 400);
    if (entryMatch[2]) {
      const raw = await rawEntry(env.RAW_DB, id);
      return raw === null ? error('ENTRY_NOT_FOUND', 'Entry not found', 404) : json(raw);
    }
    const entry = await entryDetail(env.DB, id);
    return entry ? json(entry) : error('ENTRY_NOT_FOUND', 'Entry not found', 404);
  }
  if (path === '/api/select-candidate') {
    const body = await bodyOf(request);
    const id = Number(body?.entry_id);
    const original = body?.original;
    if (!Number.isSafeInteger(id) || id < 1 || typeof original !== 'string' || original.length > 200) return error('INVALID_SELECTION', 'Invalid candidate selection', 400);
    const row = await env.DB.prepare(`SELECT cc.replacement,cc.is_reliable,e.id,e.written_form,e.origin_raw FROM entries e
      LEFT JOIN conversion_candidates cc ON cc.entry_id=e.id WHERE e.id=? LIMIT 1`).bind(id).first<{replacement: string|null;is_reliable:number|null;id:number;written_form:string;origin_raw:string|null}>();
    if (!row) return error('ENTRY_NOT_FOUND', 'Entry not found', 404);
    const reliable = !!(row.is_reliable && row.replacement);
    let display = original;
    if (reliable && row.replacement) display = row.written_form.endsWith('하다') && original !== row.written_form && original.startsWith(row.written_form.slice(0,-2)) ? row.replacement + original.slice(row.replacement.length) : row.replacement;
    return json({ status:'ok', segment_id:body?.segment_id, matched_entry_id:id, display_text:display, origin_raw:row.origin_raw,
      origin: row.origin_raw ? { type:/[\u3400-\u9fff]/u.test(row.origin_raw)?'hanja':'loanword', language:/[\u3400-\u9fff]/u.test(row.origin_raw)?'Hanja':null, raw:row.origin_raw, entry_id:id } : null,
      is_reliable:reliable, selection_reason:'user_selected' });
  }
  if (path === '/api/version' || path === '/api/stats') {
    const metadata = await env.DB.prepare('SELECT data_version,total_entries,total_senses,total_examples,origin_entries FROM import_metadata LIMIT 1').first<Record<string, number | string | null>>();
    const stats = { total_entries:metadata?.total_entries ?? 0, total_senses:metadata?.total_senses ?? 0, total_examples:metadata?.total_examples ?? 0, entries_with_hanja_origin:metadata?.origin_entries ?? 0 };
    return json(path === '/api/version' ? { code_version:'cf-0.1.0', api_schema_version:'2.1.0', data_version:metadata?.data_version ?? null, db_stats:stats } : stats);
  }
  return error('NOT_FOUND', 'API route not found', 404);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await api(request, env);
      if (url.pathname === '/ko' || url.pathname === '/ko/') return Response.redirect(new URL('/kr', url), 308);
      if (url.pathname === '/' || /^\/(zh|kr|en|ja|fr|es|ru|vi|mn|ar|th|id)\/?$/.test(url.pathname)) return env.ASSETS.fetch(new Request(new URL('/', url), request));
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error('Request failed', e instanceof Error ? e.message : 'unknown');
      return error('SERVICE_UNAVAILABLE', 'Dictionary service temporarily unavailable', 503);
    }
  }
} satisfies ExportedHandler<Env>;
