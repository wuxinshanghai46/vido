// === Token 管理 ===
let _accessToken = sessionStorage.getItem('vido_token');
let _currentUser = null;

function getToken() { return _accessToken; }
function setToken(token) { _accessToken = token; sessionStorage.setItem('vido_token', token); }
function clearToken() { _accessToken = null; sessionStorage.removeItem('vido_token'); _currentUser = null; }

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
    // 尝试刷新 token
    const refreshed = await tryRefresh();
    if (refreshed) {
      const base2 = isFormData ? { 'Authorization': `Bearer ${getToken()}` } : getAuthHeaders();
      opts.headers = { ...base2, ...opts.headers };
      res = await fetch(url, opts);
    } else {
      clearToken();
      window.location.href = '/login.html';
      return res;
    }
  }
  return res;
}

async function tryRefresh() {
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
  window.location.href = '/login.html';
}

// === 页面保护 ===
async function requireAuth() {
  if (!getToken()) { window.location.href = '/login.html'; return false; }
  const user = await fetchCurrentUser();
  if (!user) { clearToken(); window.location.href = '/login.html'; return false; }
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
  const ok = await requireAuth();
  if (!ok) return false;
  if (_currentUser.role !== 'admin') { window.location.href = '/'; return false; }
  return true;
}
