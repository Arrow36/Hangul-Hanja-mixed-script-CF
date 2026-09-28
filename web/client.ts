import { initializeKiwi, tokenize } from './kiwi';
import { convert } from './converter';

declare global { interface Window { cfConvert: (text:string, requestId:string) => Promise<{request_id:string;segments:Awaited<ReturnType<typeof convert>>}> } }
const status = document.getElementById('kiwi-status');
const setStatus = (message:string) => {
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
};
setStatus('正在加载韩语分析模型……');
initializeKiwi().then(() => setStatus('')).catch(error => {
  console.error('Kiwi initialization failed', error);
  const detail = error instanceof Error ? error.message.slice(0, 160) : '未知错误';
  setStatus(`模型加载失败：${detail}。请刷新页面重试`);
});
window.cfConvert = async (text, requestId) => {
  await initializeKiwi();
  const tokens = await tokenize(text);
  return { request_id:requestId, segments:await convert(text,tokens) };
};
