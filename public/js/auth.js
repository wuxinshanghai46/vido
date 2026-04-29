// === Token 管理 ===
let _accessToken = sessionStorage.getItem('vido_token');
let _currentUser = null;

function getToken() { return _accessToken; }
function setToken(token) { _accessToken = token; sessionStorage.setItem('vido_token', token); }
function clearToken() {
  _accessToken = null;
  _currentUser = null;
  sessionStorage.removeItem('vido_token');
  sessionStorage.removeItem('vido_user');
  localStorage.removeItem('vido_token');
  localStorage.removeItem('vido_user');
}

function getAuthHeaders() {
  const token = getToken();
  return token ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

// 带自动刷新的 fetch 封装
async function authFetch(url, opts = {}) {
  const isFormData = opts.body instanceof FormData;
  const base = isFormData ? { 'Authorization': getToken() ? `Bearer ${getToken()}` : undefined } : getAuthHeaders();
  opts.headers = { ...base, ...opts.headers };
  let res = await fetch(url, opts);
  if (res.status === 401) {
    // 尝试刷新 token（去重并发刷新，避免 refresh_token 旋转 race 把人踢出去）
    const refreshed = await tryRefresh();
    if (refreshed) {
      const base2 = isFormData ? { 'Authorization': `Bearer ${getToken()}` } : getAuthHeaders();
      opts.headers = { ...base2, ...opts.headers };
      res = await fetch(url, opts);
    } else {
      clearToken();
      window.location.href = '/?login=1';
      return res;
    }
  }
  return res;
}

// 关键修复：去重并发 refresh 调用 — 避免 refresh_token 旋转期间多个 401 并发刷新导致互相失效
let _inflightRefresh = null;
async function tryRefresh() {
  if (_inflightRefresh) return _inflightRefresh;
  _inflightRefresh = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.success && data.data?.access_token) {
        setToken(data.data.access_token);
        _currentUser = data.data.user;
        return true;
      }
      return false;
    } catch { return false; }
    finally {
      // 1.5s 内同 token 不再重复刷新
      setTimeout(() => { _inflightRefresh = null; }, 1500);
    }
  })();
  return _inflightRefresh;
}

async function fetchCurrentUser() {
  if (_currentUser) return _currentUser;
  try {
    const res = await authFetch('/api/auth/me');
    if (!res.ok) return null;
    const data = await res.json();
    _currentUser = data.data;
    return _currentUser;
  } catch { return null; }
}

function getCurrentUser() { return _currentUser; }

async function logout() {
  try { await authFetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
  clearToken();
  window.location.href = '/?login=1';
}

// === 页面保护 ===
// 超管和普通用户都可访问工作台；后台 /admin.html 由 requireAdmin 单独保护
async function requireAuth() {
  if (!getToken()) { window.location.href = '/?login=1'; return false; }
  const user = await fetchCurrentUser();
  if (!user) { clearToken(); window.location.href = '/?login=1'; return false; }
  return true;
}

// 给 URL 附加 token 参数（用于 EventSource、video src、download 等无法带 header 的场景）
function authUrl(url) {
  const t = getToken();
  if (!t) return url;
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + 'token=' + encodeURIComponent(t);
}

async function requireAdmin() {
  // admin 独立登录入口：未登录直接跳 /login.html?redirect=/admin.html（不走前台首页弹窗）
  if (!getToken()) { window.location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname); return false; }
  const user = await fetchCurrentUser();
  if (!user) { clearToken(); window.location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname); return false; }
  if (user.role !== 'admin') { window.location.href = '/'; return false; }
  return true;
}
