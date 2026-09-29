import { KiwiBuilder, Match } from 'kiwi-nlp';
import type { Kiwi } from 'kiwi-nlp';
import type { KiwiFailure } from './kiwi';

type RequestMessage = { id: number; type: 'tokenize'; text: string } | { id: number; type: 'init' };
let kiwiPromise: Promise<Kiwi> | undefined;
class ModelError extends Error {
  constructor(readonly failure: KiwiFailure) { super(failure.code); }
}

async function loadModel(): Promise<Kiwi> {
  let builder: KiwiBuilder;
  try { builder = await KiwiBuilder.create('/static/kiwi-wasm.wasm'); }
  catch (cause) { throw new ModelError({code:'wasm',detail:message(cause)}); }
  let manifest: Record<string, { parts: string[]; sizes: number[] }>;
  try {
    const response = await fetch('/model/manifest.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    manifest = await response.json() as typeof manifest;
  } catch (cause) { throw new ModelError({code:'manifest',detail:message(cause)}); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new ModelError({code:'manifest-format'});
  const files: Record<string, Uint8Array> = {};
  for (const [name, entry] of Object.entries(manifest)) {
    const parts = entry?.parts;
    const sizes = entry?.sizes;
    if (!Array.isArray(parts) || !Array.isArray(sizes) || parts.length !== sizes.length ||
        !parts.every(part => typeof part === 'string') ||
        !sizes.every(size => Number.isSafeInteger(size) && size >= 0)) throw new ModelError({code:'manifest-format'});
    const total = sizes.reduce((n, size) => n + size, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (let i = 0; i < parts.length; i++) {
      const path = `/model/${parts[i]}`;
      let buffer = await fetchPart(path);
      // A browser can keep a truncated cached response even after revalidation.
      if (buffer.length !== sizes[i]) buffer = await fetchPart(path, 'no-store');
      if (buffer.length !== sizes[i]) throw new ModelError({code:'size',file:parts[i],expected:sizes[i],actual:buffer.length});
      merged.set(buffer, offset); offset += buffer.length;
    }
    files[name] = merged;
  }
  try { return await builder.build({ modelFiles: files, modelType: 'cong' }); }
  catch (cause) { throw new ModelError({code:'build',detail:message(cause)}); }
}

async function fetchPart(path: string, cache?: RequestCache): Promise<Uint8Array> {
  try {
    const response = await fetch(path, { cache });
    if (!response.ok) throw new ModelError({code:'download',file:path,status:response.status});
    return new Uint8Array(await response.arrayBuffer());
  } catch (cause) {
    if (cause instanceof ModelError) throw cause;
    throw new ModelError({code:'download',file:path,detail:message(cause)});
  }
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
    self.postMessage({ id, ok: false, error: error instanceof ModelError ? error.failure : {code:'unknown',detail:message(error)} });
  }
};
