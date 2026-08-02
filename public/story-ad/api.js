const TOKEN_KEYS = ['vido_token', 'token'];
let refreshPromise = null;

export function readToken() {
  for (const key of TOKEN_KEYS) {
    const token = sessionStorage.getItem(key) || localStorage.getItem(key) || '';
    if (token) return token;
  }
  return '';
}

function writeToken(token = '') {
  if (!token) return;
  sessionStorage.setItem('vido_token', token);
  localStorage.setItem('vido_token', token);
}

async function refreshAuth() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  }).then(async response => {
    if (!response.ok) return false;
    const data = await response.json();
    const token = data?.success && data?.data?.access_token;
    if (!token) return false;
    writeToken(token);
    return true;
  }).catch(() => false).finally(() => {
    setTimeout(() => { refreshPromise = null; }, 800);
  });
  return refreshPromise;
}

function errorMessage(data, status) {
  const raw = String(data?.error || data?.message || data?.code || '').trim();
  if (/[\u3400-\u9fff]/.test(raw)) return raw;
  if (status === 401) return '登录状态已失效，请重新登录。';
  if (status === 403) return '当前账号没有执行此操作的权限。';
  if (status === 404) return '没有找到对应项目，请返回任务中心刷新。';
  if (status === 409) return '项目内容已经变化，请刷新后再继续。';
  if (status === 429) return '调用过于频繁，请稍后重试。';
  return status ? `请求失败（状态码 ${status}）` : '请求失败，请稍后重试。';
}

export async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const isForm = options.body instanceof FormData;
  if (!isForm) headers['Content-Type'] ||= 'application/json';
  const token = readToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || (isForm ? 180000 : 30000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const execute = () => fetch(path, {
    method: options.method || 'GET',
    credentials: 'include',
    headers,
    signal: options.signal || controller.signal,
    body: isForm ? options.body : (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  try {
    let response = await execute();
    if (response.status === 401 && await refreshAuth()) {
      const nextToken = readToken();
      if (nextToken) headers.Authorization = `Bearer ${nextToken}`;
      response = await execute();
    }
    if (response.status === 401) {
      location.href = `/?login=1&target=${encodeURIComponent(location.pathname + location.search)}`;
      throw new Error('登录状态已失效，请重新登录。');
    }
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || data.success === false) {
      const error = new Error(errorMessage(data, response.status));
      error.status = response.status;
      error.code = data.code || '';
      error.data = data;
      throw error;
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('请求等待时间过长，已停止本次页面等待。');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function uploadAsset(file, role = 'asset') {
  const body = new FormData();
  body.append('file', file);
  body.append('role', role);
  return request('/api/new-story-ad/upload', { method: 'POST', body, timeoutMs: 180000 });
}

export function uploadReferenceVideo(file, taskId = '') {
  const body = new FormData();
  body.append('file', file);
  body.append('rights_confirmed', 'true');
  if (taskId) body.append('task_id', taskId);
  return request('/api/new-story-ad/reference-video-analyses', {
    method: 'POST',
    body,
    timeoutMs: 240000,
  });
}
