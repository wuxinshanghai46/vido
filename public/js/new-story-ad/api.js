(() => {
  const tokenKeys = ['vido_token', 'token'];
  let refreshPromise = null;

  /** 从会话或本地存储读取当前登录令牌。 */
  function readToken() {
    for (const key of tokenKeys) {
      const value = sessionStorage.getItem(key) || localStorage.getItem(key) || '';
      if (value) return value;
    }
    return '';
  }

  /** 保存刷新后的登录令牌。 */
  function writeToken(token = '') {
    if (!token) return;
    sessionStorage.setItem('vido_token', token);
    localStorage.setItem('vido_token', token);
  }

  /** 从不同接口错误结构中提取原始消息。 */
  function errorMessage(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') return value.message || value.msg || value.error_description || errorMessage(value.error) || value.code || '';
    return String(value);
  }

  /** 把英文网络或供应商错误转换为统一中文提示。 */
  function chineseErrorMessage(value = '', status = 0) {
    const message = String(value || '').trim();
    if (/[\u3400-\u9fff]/.test(message)) return message;
    if (status === 401 || /unauth|unauthorized/i.test(message)) return '登录状态已失效，请重新登录。';
    if (status === 403 || /forbidden/i.test(message)) return '当前账号没有执行此操作的权限。';
    if (status === 404 || /not found/i.test(message)) return '请求的项目或接口不存在，请刷新页面后重试。';
    if (status === 429 || /rate.?limit|too many requests/i.test(message)) return '模型调用过于频繁，请稍后重试。';
    if (/capacity|overloaded|too busy/i.test(message)) return '当前模型服务繁忙，请稍后重试或选择其他可用模型。';
    if (/billing|balance|credit|quota|payment/i.test(message)) return '供应商余额、额度或计费状态异常，已停止继续提交。';
    if (/timeout|timed out|network|failed to fetch|ECONN/i.test(message)) return '网络连接或模型服务响应超时，请稍后从当前阶段重试。';
    return status ? `请求失败（状态码 ${status}），请稍后重试。` : '操作失败，请稍后重试。';
  }

  /** 刷新登录状态，并把新令牌同步给调用页面。 */
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

  /** 执行底层 fetch，并将浏览器英文网络异常转换为中文。 */
  async function fetchWithChineseError(path, options = {}) {
    const {
      timeoutMs = 15000,
      signal: externalSignal,
      ...fetchOptions
    } = options;
    const controller = new AbortController();
    let timedOut = false;
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    if (externalSignal) {
      if (externalSignal.aborted) abortFromExternal();
      else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
    }
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(1000, Number(timeoutMs) || 15000));
    try {
      return await fetch(path, { ...fetchOptions, signal: controller.signal });
    } catch (error) {
      if (timedOut) throw new Error(`请求超过 ${Math.round(Number(timeoutMs) / 1000)} 秒未响应，已停止本次页面等待`);
      throw new Error(chineseErrorMessage(error?.message || error));
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener?.('abort', abortFromExternal);
    }
  }

  /** 发起剧情广告接口请求，并保证抛出的用户提示始终为中文。 */
  async function request(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (!headers['Content-Type'] && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const token = opts.token || readToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const body = opts.body instanceof FormData ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined);
    const timeoutMs = Number(opts.timeoutMs)
      || (opts.body instanceof FormData ? 120000 : (String(opts.method || 'GET').toUpperCase() === 'GET' ? 15000 : 45000));
    let resp = await fetchWithChineseError(path, { ...opts, timeoutMs, credentials: opts.credentials || 'include', headers, body });
    if (resp.status === 401 && await refreshAuth(opts.onToken)) {
      const retryHeaders = { ...headers };
      const retryToken = readToken();
      if (retryToken) retryHeaders.Authorization = `Bearer ${retryToken}`;
      resp = await fetchWithChineseError(path, { ...opts, timeoutMs, credentials: opts.credentials || 'include', headers: retryHeaders, body });
    }
    if (resp.status === 401) {
      location.href = '/?login=1&target=' + encodeURIComponent('/digital-human?tab=new-story-ad');
      throw new Error('登录状态已失效，请重新登录。');
    }
    const raw = await resp.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    if (!resp.ok || data?.success === false) {
      const isHtmlError = /^\s*<!doctype html|^\s*<html[\s>]/i.test(raw || '');
      const friendly = isHtmlError && resp.status === 404
        ? `接口不存在或服务仍是旧版本，请重启服务后再试：${path}`
        : (isHtmlError ? `接口返回了 HTML 错误页：HTTP ${resp.status}` : '');
      const original = errorMessage(data?.error) || errorMessage(data?.message) || friendly || raw.slice(0, 180);
      const err = new Error(chineseErrorMessage(original, resp.status));
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
    chineseErrorMessage,
  };
})();
