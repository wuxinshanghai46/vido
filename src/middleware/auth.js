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

function requirePermission(...perms) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, error: '未登录' });
    const role = getRoleById(req.user.role);
    if (!role) return res.status(403).json({ success: false, error: '角色不存在' });
    if (role.permissions.includes('*')) return next();
    const hasAll = perms.every(p => role.permissions.includes(p));
    if (!hasAll) return res.status(403).json({ success: false, error: '权限不足，需要: ' + perms.join(', ') });
    next();
  };
}

module.exports = { signToken, authenticate, optionalAuth, requireRole, requirePermission, JWT_SECRET };
