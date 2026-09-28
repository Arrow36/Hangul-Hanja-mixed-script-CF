import { initializeKiwi, tokenize } from './kiwi';
import { convert } from './converter';

declare global { interface Window { cfConvert: (text:string, requestId:string) => Promise<{request_id:string;segments:Awaited<ReturnType<typeof convert>>}> } }
const status = document.getElementById('kiwi-status');
const setStatus = (message:string) => { if (status) status.textContent=message; };
setStatus('正在加载韩语分析模型……');
initializeKiwi().then(() => setStatus('模型加载完成')).catch(() => setStatus('模型加载失败，请刷新页面重试'));
window.cfConvert = async (text, requestId) => {
  await initializeKiwi();
  const tokens = await tokenize(text);
  return { request_id:requestId, segments:await convert(text,tokens) };
};
