import type { Candidate } from './types';
const memory = new Map<string, Candidate[]>();
let database: Promise<IDBDatabase> | undefined;
function openDb(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('hanja-dictionary-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('candidates');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function cached(word: string): Promise<Candidate[] | undefined> {
  if (memory.has(word)) return memory.get(word);
  try {
    const db = await openDb();
    return await new Promise(resolve => {
      const request = db.transaction('candidates').objectStore('candidates').get(word);
      request.onsuccess = () => resolve(request.result as Candidate[] | undefined);
      request.onerror = () => resolve(undefined);
    });
  } catch { return undefined; }
}
async function persist(word: string, candidates: Candidate[]): Promise<void> {
  try {
    const db = await openDb();
    db.transaction('candidates', 'readwrite').objectStore('candidates').put(candidates, word);
  } catch { /* Cache failure must not break conversion. */ }
}
export async function lookup(words: string[]): Promise<Record<string, Candidate[]>> {
  const unique = [...new Set(words.filter(w => w.length > 0 && w.length <= 100))];
  const out: Record<string, Candidate[]> = {};
  const missing: string[] = [];
  for (const word of unique) {
    const value = await cached(word);
    if (value) { out[word] = value; memory.set(word, value); }
    else missing.push(word);
  }
  for (let i = 0; i < missing.length; i += 80) {
    const batch = missing.slice(i, i+80);
    const response = await fetch('/api/dictionary/batch', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({words:batch}) });
    if (!response.ok) throw new Error('词典服务暂时不可用，请稍后重试。');
    const results = await response.json() as Record<string, Candidate[]>;
    for (const word of batch) {
      const candidates = results[word] ?? [];
      out[word] = candidates; memory.set(word, candidates);
      void persist(word, candidates);
    }
  }
  return out;
}
interface OriginRow { entry_id: number; origin_raw: string | null }
const originsMemory = new Map<string, OriginRow[]>();
export async function lookupOrigins(words: string[]): Promise<Record<string, OriginRow[]>> {
  const unique = [...new Set(words.filter(w => w.length > 0 && w.length <= 100))];
  const result: Record<string, OriginRow[]> = {};
  const missing = unique.filter(w => !originsMemory.has(w));
  for (let i=0; i<missing.length; i+=80) {
    const batch=missing.slice(i,i+80);
    const response=await fetch('/api/dictionary/origins',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({words:batch})});
    if (!response.ok) throw new Error('词典服务暂时不可用，请稍后重试。');
    const data=await response.json() as Record<string, OriginRow[]>;
    for (const word of batch) originsMemory.set(word,data[word]??[]);
  }
  for (const word of unique) result[word]=originsMemory.get(word)??[];
  return result;
}
