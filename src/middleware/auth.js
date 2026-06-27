const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getUserById, getRoleById } = require('../models/authStore');

const JWT_SECRET = process.env.JWT_SECRET || 'vido_default_secret_change_me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '365d';
const INTERNAL_JOB_HEADER = 'x-vido-internal-job';
const INTERNAL_JOB_TTL_MS = 24 * 60 * 60 * 1000;

function signToken(userId, role) {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function parseCookies(req) {
  if (req.cookies && typeof req.cookies === 'object') return req.cookies;
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) out[k.trim()] = decodeURIComponent(v.join('=').trim());
  });
  return out;
}

function getRequestTokens(req) {
  const authHeader = req.headers.authorization;
  const tokens = [];
  if (authHeader && authHeader.startsWith('Bearer ')) tokens.push(authHeader.slice(7));
  if (req.query?.token) tokens.push(req.query.token);
  const cookieToken = parseCookies(req).vido_session;
  if (cookieToken) tokens.push(cookieToken);
  return Array.from(new Set(tokens.filter(Boolean)));
}

function verifyUserToken(token) {
  const decoded = jwt.verify(token, JWT_SECRET);
  const user = getUserById(decoded.userId);
  if (!user) {
    const err = new Error('用户不存在');
    err.statusCode = 401;
    throw err;
  }
  if (user.status !== 'active') {
    const err = new Error('账户已被禁用');
    err.statusCode = 403;
    throw err;
  }
  return user;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function parseBase64UrlJson(value) {
  return JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'));
}

function internalJobSecret() {
  return process.env.VIDO_INTERNAL_JOB_SECRET || JWT_SECRET;
}

function signInternalJobPayload(payload) {
  return crypto.createHmac('sha256', internalJobSecret()).update(payload).digest('base64url');
}

function isLoopbackRequest(req) {
  const values = [
    req.ip,
    req.socket?.remoteAddress,
    req.connection?.remoteAddress,
  ].filter(Boolean).map(x => String(x));
  return values.some(addr =>
    addr === '127.0.0.1'
    || addr === '::1'
    || addr === '::ffff:127.0.0.1'
    || addr.endsWith(':127.0.0.1'));
}

function createInternalJobAuthHeaders(userOrId, scope = '') {
  const userId = typeof userOrId === 'object' ? userOrId?.id : userOrId;
  if (!userId) return {};
  const payload = base64UrlJson({
    userId: String(userId),
    scope: String(scope || '').slice(0, 160),
    iat: Date.now(),
  });
  return { 'X-VIDO-Internal-Job': `${payload}.${signInternalJobPayload(payload)}` };
}

function verifyInternalJobRequest(req) {
  const raw = req.headers[INTERNAL_JOB_HEADER];
  if (!raw) return null;
  if (!isLoopbackRequest(req)) {
    const err = new Error('Internal job auth is only allowed from loopback');
    err.statusCode = 403;
    throw err;
  }
  const [payload, signature] = String(raw).split('.');
  if (!payload || !signature) {
    const err = new Error('Invalid internal job auth');
    err.statusCode = 401;
    throw err;
  }
  const expected = signInternalJobPayload(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const err = new Error('Invalid internal job auth');
    err.statusCode = 401;
    throw err;
  }
  const decoded = parseBase64UrlJson(payload);
  const age = Date.now() - Number(decoded.iat || 0);
  if (!Number.isFinite(age) || age < 0 || age > INTERNAL_JOB_TTL_MS) {
    const err = new Error('Internal job auth expired');
    err.statusCode = 401;
    throw err;
  }
  const user = getUserById(decoded.userId);
  if (!user) {
    const err = new Error('用户不存在');
    err.statusCode = 401;
    throw err;
  }
  if (user.status !== 'active') {
    const err = new Error('账户已被禁用');
    err.statusCode = 403;
    throw err;
  }
  return user;
}

function authenticate(req, res, next) {
  try {
    const internalUser = verifyInternalJobRequest(req);
    if (internalUser) {
      req.user = { id: internalUser.id, username: internalUser.username, role: internalUser.role, credits: internalUser.credits };
      return next();
    }
  } catch (err) {
    return res.status(err.statusCode || 401).json({ success: false, error: err.message || 'Internal job auth failed' });
  }
  const tokens = getRequestTokens(req);
  if (!tokens.length) {
    return res.status(401).json({ success: false, error: '未登录' });
  }
  let lastErr = null;
  for (const token of tokens) {
    try {
      const user = verifyUserToken(token);
      req.user = { id: user.id, username: user.username, role: user.role, credits: user.credits };
      return next();
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr?.statusCode === 403) return res.status(403).json({ success: false, error: lastErr.message });
  if (lastErr?.statusCode === 401) return res.status(401).json({ success: false, error: lastErr.message });
  if (lastErr?.name === 'TokenExpiredError') return res.status(401).json({ success: false, error: 'Token 已过期' });
  return res.status(401).json({ success: false, error: 'Token 无效' });
}

function optionalAuth(req, res, next) {
  const tokens = getRequestTokens(req);
  if (!tokens.length) { req.user = null; return next(); }
  for (const token of tokens) {
    try {
      const user = verifyUserToken(token);
      req.user = { id: user.id, username: user.username, role: user.role, credits: user.credits };
      return next();
    } catch {}
  }
  req.user = null;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, error: '未登录' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ success: false, error: '权限不足' });
    next();
  };
}

// 权限匹配：兼容短形式("i2v") 与范围式("enterprise:i2v:view" 等多种操作)
// 只要用户持有该模块任一 CRUD 权限，即允许访问路由级中间件
function permSetHas(permSet, perm) {
  if (permSet.has('*')) return true;
  if (permSet.has(perm)) return true;
  const ePrefix = `enterprise:${perm}:`;
  const pPrefix = `platform:${perm}:`;
  for (const p of permSet) {
    if (typeof p === 'string' && (p.startsWith(ePrefix) || p.startsWith(pPrefix))) return true;
  }
  return false;
}

function requirePermission(...perms) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, error: '未登录' });
    // admin 角色始终拥有所有权限
    if (req.user.role === 'admin') return next();
    const user = getUserById(req.user.id);
    const role = getRoleById(req.user.role);
    if (!role) return res.status(403).json({ success: false, error: '角色不存在' });
    // 合并：用户级权限 ∪ 角色级权限
    const userPerms = Array.isArray(user && user.permissions) ? user.permissions : [];
    const rolePerms = Array.isArray(role.permissions) ? role.permissions : [];
    if (rolePerms.includes('*') || userPerms.includes('*')) return next();
    const merged = new Set([...userPerms, ...rolePerms]);
    const hasAll = perms.every(p => permSetHas(merged, p));
    if (!hasAll) return res.status(403).json({ success: false, error: '权限不足，需要: ' + perms.join(', ') });
    next();
  };
}

// 数据隔离辅助函数
//   isAdmin(req)                    → 当前请求是否来自平台管理员
//   ownedBy(req, row)               → 该数据行是否属于当前用户（admin 总是 true）
//   scopeUserId(req)                → 列表查询使用的 user_id 参数（admin 返回 undefined 表示全部，其他用户返回自己的 id）
function isAdmin(req) { return req && req.user && req.user.role === 'admin'; }
function ownedBy(req, row) {
  if (!row) return false;
  if (isAdmin(req)) return true;
  return row.user_id && req.user && row.user_id === req.user.id;
}
function scopeUserId(req) { return isAdmin(req) ? undefined : req && req.user && req.user.id; }

module.exports = { signToken, authenticate, optionalAuth, requireRole, requirePermission, JWT_SECRET, createInternalJobAuthHeaders, isAdmin, ownedBy, scopeUserId };
