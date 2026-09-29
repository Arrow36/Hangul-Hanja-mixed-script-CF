export interface KiwiToken { form: string; tag: string; start: number; len: number }
export interface KiwiFailure {
  code: 'wasm' | 'manifest' | 'manifest-format' | 'download' | 'size' | 'build' | 'worker' | 'unknown';
  detail?: string;
  file?: string;
  status?: number;
  expected?: number;
  actual?: number;
}
export class KiwiLoadError extends Error {
  constructor(readonly failure: KiwiFailure) {
    super(`${failure.code}: ${failure.file ?? failure.detail ?? ''}`);
  }
}
type Reply = { id: number; ok: boolean; tokens?: KiwiToken[]; error?: KiwiFailure };
const worker = new Worker('/static/kiwi-worker.js', { type: 'module' });
let nextId = 0;
const pending = new Map<number, { resolve: (v: Reply) => void; reject: (e: Error) => void }>();
worker.onmessage = (event: MessageEvent<Reply>) => {
  const entry = pending.get(event.data.id);
  if (!entry) return;
  pending.delete(event.data.id);
  event.data.ok ? entry.resolve(event.data) : entry.reject(new KiwiLoadError(event.data.error ?? {code:'unknown'}));
};
worker.onerror = (event) => {
  for (const entry of pending.values()) entry.reject(new KiwiLoadError({code:'worker',detail:event.message}));
  pending.clear();
};
worker.onmessageerror = () => {
  for (const entry of pending.values()) entry.reject(new KiwiLoadError({code:'worker'}));
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
