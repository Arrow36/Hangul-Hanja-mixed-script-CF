import { KiwiBuilder, Match } from 'kiwi-nlp';
import type { Kiwi } from 'kiwi-nlp';

type RequestMessage = { id: number; type: 'tokenize'; text: string } | { id: number; type: 'init' };
let kiwiPromise: Promise<Kiwi> | undefined;

async function loadModel(): Promise<Kiwi> {
  const builder = await KiwiBuilder.create('/static/kiwi-wasm.wasm');
  const manifest = await fetch('/model/manifest.json').then(async r => {
    if (!r.ok) throw new Error('Kiwi model manifest unavailable');
    return await r.json() as Record<string, string[]>;
  });
  const files: Record<string, Uint8Array> = {};
  for (const [name, parts] of Object.entries(manifest)) {
    const buffers = await Promise.all(parts.map(async part => {
      const response = await fetch(`/model/${part}`);
      if (!response.ok) throw new Error(`Kiwi model part unavailable: ${part}`);
      return new Uint8Array(await response.arrayBuffer());
    }));
    const total = buffers.reduce((n, b) => n + b.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const buffer of buffers) { merged.set(buffer, offset); offset += buffer.length; }
    files[name] = merged;
  }
  return builder.build({ modelFiles: files, modelType: 'cong' });
}

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
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : 'Kiwi initialization failed' });
  }
};
