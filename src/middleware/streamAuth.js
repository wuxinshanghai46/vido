// 流媒体/下载类接口的轻量级认证
// video 标签、<img> 等无法携带 Authorization header，只能走 ?token= query 参数
const jwt = require('jsonwebtoken');
const { getUserById } = require('../models/authStore');

const JWT_SECRET = process.env.JWT_SECRET || 'vido_default_secret_change_me';

// 从请求里解析出当前用户（返回 null 表示未登录）
function userFromRequest(req) {
  const authHeader = req.headers && req.headers.authorization;
  const headerToken = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.slice(7) : null;
  const token = headerToken || (req.query && req.query.token);
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = getUserById(decoded.userId);
    if (!user || user.status !== 'active') return null;
    return user;
  } catch { return null; }
}

// 检查是否为管理员
function isAdminUser(user) { return user && user.role === 'admin'; }

// 校验用户是否拥有该数据行（admin 总是通过）
function ownsRow(user, row) {
  if (!row) return false;
  if (isAdminUser(user)) return true;
  return !!user && !!row.user_id && row.user_id === user.id;
}

module.exports = { userFromRequest, isAdminUser, ownsRow };
