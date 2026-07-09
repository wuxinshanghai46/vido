(() => {
  const tokenKeys = ['vido_token', 'token'];
  let refreshPromise = null;

  function readToken() {
    for (const key of tokenKeys) {
      const value = sessionStorage.getItem(key) || localStorage.getItem(key) || '';
      if (value) return value;
    }
    return '';
  }

  function writeToken(token = '') {
    if (!token) return;
    sessionStorage.setItem('vido_token', token);
    localStorage.setItem('vido_token', token);
  }

  function errorMessage(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') return value.message || value.msg || value.error_description || errorMessage(value.error) || value.code || '';
    return String(value);
  }

  async function refreshAuth(onToken) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const resp = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!resp.ok) return false;
        const data = await resp.json();
        const token = data?.success && data?.data?.access_token;
        if (!token) return false;
        writeToken(token);
        if (typeof onToken === 'function') onToken(token);
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => { refreshPromise = null; }, 1200);
      }
    })();
    return refreshPromise;
  }

  async function request(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (!headers['Content-Type'] && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const token = opts.token || readToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const body = opts.body instanceof FormData ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined);
    let resp = await fetch(path, { ...opts, credentials: opts.credentials || 'include', headers, body });
    if (resp.status === 401 && await refreshAuth(opts.onToken)) {
      const retryHeaders = { ...headers };
      const retryToken = readToken();
      if (retryToken) retryHeaders.Authorization = `Bearer ${retryToken}`;
      resp = await fetch(path, { ...opts, credentials: opts.credentials || 'include', headers: retryHeaders, body });
    }
    if (resp.status === 401) {
      location.href = '/?login=1&target=' + encodeURIComponent('/digital-human?tab=new-story-ad');
      throw new Error('unauth');
    }
    const raw = await resp.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    if (!resp.ok || data?.success === false) {
      const isHtmlError = /^\s*<!doctype html|^\s*<html[\s>]/i.test(raw || '');
      const friendly = isHtmlError && resp.status === 404
        ? `接口不存在或服务仍是旧版本，请重启服务后再试：${path}`
        : (isHtmlError ? `接口返回了 HTML 错误页：HTTP ${resp.status}` : '');
      const err = new Error(errorMessage(data?.error) || errorMessage(data?.message) || friendly || raw.slice(0, 180) || `HTTP ${resp.status}`);
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data || {};
  }

  window.NewStoryAdApi = {
    request,
    readToken,
    writeToken,
    refreshAuth,
    errorMessage,
  };
})();
