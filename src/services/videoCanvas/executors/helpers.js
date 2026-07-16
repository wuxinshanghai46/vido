const path = require('path');

function textInputs(context) {
  return context.inputArtifacts.filter(item => item.kind === 'text' || item.kind === 'json').map(item => item.metadata?.text || item.metadata?.json || '').filter(Boolean);
}
function mediaInputs(context, prefix) {
  return context.inputArtifacts.filter(item => String(item.kind || '').startsWith(prefix)).filter(item => item.storage_path);
}
function combinedPrompt(node, context) {
  const upstream = textInputs(context).join('\n\n');
  return [upstream, node.config?.prompt].filter(Boolean).join('\n\n').trim();
}
function publicUrl(artifact) {
  const url = String(artifact?.public_url || '');
  if (/^https?:\/\//i.test(url)) return url;
  const base = String(process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_URL || '').replace(/\/$/, '');
  return base && url.startsWith('/') ? `${base}${url}` : url;
}
function extensionFromUrl(url, fallback = '.bin') {
  try { return path.extname(new URL(url).pathname) || fallback; } catch { return fallback; }
}
function classifyError(error) {
  const message = String(error?.message || error || '未知错误');
  const code = String(error?.code || '');
  if (code) return { code, message, retryable: error?.retryable === true };
  if (/401|403|unauthorized|api key|token/i.test(message)) return { code: 'AUTH_CONFIG', message, retryable: false };
  if (/余额|quota|credit|insufficient/i.test(message)) return { code: 'INSUFFICIENT_BALANCE', message, retryable: false };
  if (/429|rate limit|频率/i.test(message)) return { code: 'RATE_LIMIT', message, retryable: true };
  if (/timeout|ECONNRESET|socket|network/i.test(message)) return { code: 'TIMEOUT_OR_NETWORK', message, retryable: true };
  if (/\b5\d\d\b|provider/i.test(message)) return { code: 'PROVIDER_ERROR', message, retryable: true };
  return { code: 'EXECUTION_FAILED', message, retryable: false };
}

module.exports = { classifyError, combinedPrompt, extensionFromUrl, mediaInputs, publicUrl, textInputs };
