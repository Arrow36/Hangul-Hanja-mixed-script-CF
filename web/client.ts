import { initializeKiwi, tokenize, KiwiLoadError } from './kiwi';
import type { KiwiFailure } from './kiwi';
import { convert } from './converter';
import { modelLoadingText, modelFailureText } from './model-status';

declare global { interface Window { cfConvert: (text:string, requestId:string) => Promise<{request_id:string;segments:Awaited<ReturnType<typeof convert>>}> } }
declare const LanguageRoutes: { initialLanguage: () => string };
const status = document.getElementById('kiwi-status');
let language = LanguageRoutes.initialLanguage();
let failure: KiwiFailure | undefined;
const setStatus = (message:string) => {
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
};
const renderStatus = () => setStatus(failure ? modelFailureText(language, failure) : modelLoadingText(language));
renderStatus();
document.getElementById('language-select')?.addEventListener('change', event => {
  language = (event.target as HTMLSelectElement).value;
  if (!status?.hidden) renderStatus();
});
window.addEventListener('popstate', () => {
  language = LanguageRoutes.initialLanguage();
  if (!status?.hidden) renderStatus();
});
initializeKiwi().then(() => setStatus('')).catch(error => {
  console.error('Kiwi initialization failed', error);
  failure = error instanceof KiwiLoadError ? error.failure : {code:'unknown',detail: error instanceof Error ? error.message : String(error)};
  renderStatus();
});
window.cfConvert = async (text, requestId) => {
  await initializeKiwi();
  const tokens = await tokenize(text);
  return { request_id:requestId, segments:await convert(text,tokens) };
};
