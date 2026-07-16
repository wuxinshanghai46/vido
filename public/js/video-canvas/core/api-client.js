export async function api(path, options = {}) {
  const init = { ...options, headers: { ...(options.headers || {}) } };
  if (init.body && !(init.body instanceof FormData) && typeof init.body !== 'string') {
    init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(init.body);
  }
  const fetcher = window.authFetch || window.fetch.bind(window);
  const response = await fetcher(`/api/video-canvas${path}`, init);
  const text = await response.text(); let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error(`服务器返回了无效数据（HTTP ${response.status}）`); }
  if (!response.ok || payload.success === false) {
    const error = new Error(payload.error || `请求失败（HTTP ${response.status}）`);
    error.status = response.status; error.code = payload.code; error.data = payload.data; error.errors = payload.errors; throw error;
  }
  return payload.data;
}

export function idempotencyKey(prefix = 'vc') {
  return `${prefix}_${Date.now()}_${crypto.getRandomValues(new Uint32Array(2)).join('')}`;
}
