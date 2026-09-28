export interface KiwiToken { form: string; tag: string; start: number; len: number }
type Reply = { id: number; ok: boolean; tokens?: KiwiToken[]; error?: string };
const worker = new Worker('/static/kiwi-worker.js', { type: 'module' });
let nextId = 0;
const pending = new Map<number, { resolve: (v: Reply) => void; reject: (e: Error) => void }>();
worker.onmessage = (event: MessageEvent<Reply>) => {
  const entry = pending.get(event.data.id);
  if (!entry) return;
  pending.delete(event.data.id);
  event.data.ok ? entry.resolve(event.data) : entry.reject(new Error(event.data.error || 'Kiwi failed'));
};
worker.onerror = () => {
  for (const entry of pending.values()) entry.reject(new Error('Kiwi worker failed'));
  pending.clear();
};
function send(type: 'init' | 'tokenize', text = ''): Promise<Reply> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, text });
  });
}
let ready: Promise<void> | undefined;
export function initializeKiwi(): Promise<void> { return ready ??= send('init').then(() => undefined); }
export async function tokenize(text: string): Promise<KiwiToken[]> {
  await initializeKiwi();
  return (await send('tokenize', text)).tokens ?? [];
}
