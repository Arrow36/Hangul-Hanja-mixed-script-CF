import { KiwiBuilder, Match } from 'kiwi-nlp';
import type { Kiwi } from 'kiwi-nlp';

type RequestMessage = { id: number; type: 'tokenize'; text: string } | { id: number; type: 'init' };
let kiwiPromise: Promise<Kiwi> | undefined;

async function loadModel(): Promise<Kiwi> {
  let builder: KiwiBuilder;
  try { builder = await KiwiBuilder.create('/static/kiwi-wasm.wasm'); }
  catch (cause) { throw new Error(`WASM 加载失败：${message(cause)}`); }
  const manifest = await fetch('/model/manifest.json').then(async r => {
    if (!r.ok) throw new Error('Kiwi model manifest unavailable');
    return await r.json() as Record<string, { parts: string[]; sizes: number[] }>;
  });
  const files: Record<string, Uint8Array> = {};
  for (const [name, { parts, sizes }] of Object.entries(manifest)) {
    if (!Array.isArray(parts) || !Array.isArray(sizes) || parts.length !== sizes.length) throw new Error('模型清单格式无效');
    const total = sizes.reduce((n, size) => n + size, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (let i = 0; i < parts.length; i++) {
      const path = `/model/${parts[i]}`;
      let buffer = await fetchPart(path);
      // A browser can keep a truncated cached response even after revalidation.
      if (buffer.length !== sizes[i]) buffer = await fetchPart(path, 'no-store');
      if (buffer.length !== sizes[i]) throw new Error(`模型文件大小不符：${parts[i]}（需要 ${sizes[i]} 字节，收到 ${buffer.length} 字节）`);
      merged.set(buffer, offset); offset += buffer.length;
    }
    files[name] = merged;
  }
  try { return await builder.build({ modelFiles: files, modelType: 'cong' }); }
  catch (cause) { throw new Error(`模型初始化失败：${message(cause)}`); }
}

async function fetchPart(path: string, cache?: RequestCache): Promise<Uint8Array> {
  const response = await fetch(path, { cache });
  if (!response.ok) throw new Error(`模型文件下载失败：${path} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

self.onmessage = async (event: MessageEvent<RequestMessage>) => {
  const { id, type } = event.data;
  try {
    kiwiPromise ??= loadModel();
    const kiwi = await kiwiPromise;
    if (type === 'init') {
      self.postMessage({ id, ok: true, version: '0.24.0' });
    } else {
      const result = kiwi.analyze(event.data.text, Match.allWithNormalizing);
      self.postMessage({ id, ok: true, tokens: result.tokens.map(t => ({ form: t.str, tag: t.tag, start: t.position, len: t.length })) });
    }
  } catch (error) {
    console.error('Kiwi initialization failed', error);
    self.postMessage({ id, ok: false, error: message(error) });
  }
};
