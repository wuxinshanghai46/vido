const jwt = require('jsonwebtoken');
const { getUserById, getRoleById } = require('../models/authStore');

const JWT_SECRET = process.env.JWT_SECRET || 'vido_default_secret_change_me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

function signToken(userId, role) {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.slice(7) : req.query?.token;
  if (!token) {
    return res.status(401).json({ success: false, error: '未登录' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = getUserById(decoded.userId);
    if (!user) return res.status(401).json({ success: false, error: '用户不存在' });
    if (user.status !== 'active') return res.status(403).json({ success: false, error: '账户已被禁用' });
    req.user = { id: user.id, username: user.username, role: user.role, credits: user.credits };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ success: false, error: 'Token 已过期' });
    return res.status(401).json({ success: false, error: 'Token 无效' });
  }
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) { req.user = null; return next(); }
  try {
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
    const user = getUserById(decoded.userId);
    req.user = user ? { id: user.id, username: user.username, role: user.role, credits: user.credits } : null;
  } catch { req.user = null; }
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

module.exports = { signToken, authenticate, optionalAuth, requireRole, requirePermission, JWT_SECRET, isAdmin, ownedBy, scopeUserId };
