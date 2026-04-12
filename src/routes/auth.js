const router = require('express').Router();
const { hashPassword, verifyPassword, hashToken, generateToken } = require('../utils/crypto');
const { getUserByUsername, getUserByEmail, createUser, updateUser, getUserById, getRoleById,
        saveRefreshToken, getRefreshToken, deleteRefreshToken, deleteUserRefreshTokens } = require('../models/authStore');
const { signToken, authenticate } = require('../middleware/auth');

const REFRESH_TOKEN_DAYS = parseInt(process.env.REFRESH_TOKEN_DAYS || '7');

// 注册
router.post('/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: '用户名和密码必填' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ success: false, error: '用户名长度 3-20 位' });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ success: false, error: '用户名只允许字母、数字、下划线' });
  if (password.length < 6) return res.status(400).json({ success: false, error: '密码至少 6 位' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, error: '邮箱格式不正确' });
  if (getUserByUsername(username)) return res.status(409).json({ success: false, error: '用户名已存在' });
  if (email && getUserByEmail(email)) return res.status(409).json({ success: false, error: '邮箱已被注册' });

  const { hash, salt } = hashPassword(password);
  const user = createUser({ username, email: email || '', password_hash: hash, password_salt: salt, password_plain: password, role: 'user' });
  const accessToken = signToken(user.id, user.role);
  const { refreshToken, refreshExpires } = issueRefresh(user.id);

  res.cookie('refresh_token', refreshToken, { httpOnly: true, sameSite: 'lax', maxAge: REFRESH_TOKEN_DAYS * 86400000, path: '/api/auth' });
  res.json({
    success: true,
    data: { access_token: accessToken, user: safeUser(user) }
  });
});

// 登录
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: '用户名和密码必填' });
  const user = getUserByUsername(username);
  if (!user) return res.status(401).json({ success: false, error: '用户名或密码错误' });
  if (user.status !== 'active') return res.status(403).json({ success: false, error: '账户已被禁用' });
  if (!verifyPassword(password, user.password_hash, user.password_salt)) {
    return res.status(401).json({ success: false, error: '用户名或密码错误' });
  }
  updateUser(user.id, { last_login: new Date().toISOString(), password_plain: password });
  const accessToken = signToken(user.id, user.role);
  const { refreshToken } = issueRefresh(user.id);

  res.cookie('refresh_token', refreshToken, { httpOnly: true, sameSite: 'lax', maxAge: REFRESH_TOKEN_DAYS * 86400000, path: '/api/auth' });
  res.json({
    success: true,
    data: { access_token: accessToken, user: safeUser(user) }
  });
});

// 刷新 token
router.post('/refresh', (req, res) => {
  const token = req.cookies?.refresh_token || req.body?.refresh_token;
  if (!token) return res.status(401).json({ success: false, error: '无 refresh token' });
  const tokenHash = hashToken(token);
  const stored = getRefreshToken(tokenHash);
  if (!stored) return res.status(401).json({ success: false, error: 'Refresh token 无效或已过期' });
  const user = getUserById(stored.user_id);
  if (!user || user.status !== 'active') {
    deleteRefreshToken(tokenHash);
    return res.status(401).json({ success: false, error: '用户不存在或已禁用' });
  }
  // 旋转: 删旧发新
  deleteRefreshToken(tokenHash);
  const accessToken = signToken(user.id, user.role);
  const { refreshToken: newRefresh } = issueRefresh(user.id);

  res.cookie('refresh_token', newRefresh, { httpOnly: true, sameSite: 'lax', maxAge: REFRESH_TOKEN_DAYS * 86400000, path: '/api/auth' });
  res.json({ success: true, data: { access_token: accessToken, user: safeUser(user) } });
});

// 登出
router.post('/logout', authenticate, (req, res) => {
  const token = req.cookies?.refresh_token;
  if (token) deleteRefreshToken(hashToken(token));
  res.clearCookie('refresh_token', { path: '/api/auth' });
  res.json({ success: true });
});

// 当前用户信息
router.get('/me', authenticate, (req, res) => {
  const user = getUserById(req.user.id);
  if (!user) return res.status(404).json({ success: false, error: '用户不存在' });
  res.json({ success: true, data: safeUser(user) });
});

// 修改个人信息
router.put('/me', authenticate, (req, res) => {
  const { email, password, old_password } = req.body;
  const user = getUserById(req.user.id);
  if (!user) return res.status(404).json({ success: false, error: '用户不存在' });
  const updates = {};
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, error: '邮箱格式不正确' });
    const existing = getUserByEmail(email);
    if (existing && existing.id !== user.id) return res.status(409).json({ success: false, error: '邮箱已被使用' });
    updates.email = email;
  }
  if (password) {
    if (!old_password) return res.status(400).json({ success: false, error: '请提供旧密码' });
    if (!verifyPassword(old_password, user.password_hash, user.password_salt)) {
      return res.status(400).json({ success: false, error: '旧密码不正确' });
    }
    if (password.length < 6) return res.status(400).json({ success: false, error: '新密码至少 6 位' });
    const { hash, salt } = hashPassword(password);
    updates.password_hash = hash;
    updates.password_salt = salt;
    updates.password_plain = password;
  }
  if (Object.keys(updates).length) updateUser(user.id, updates);
  res.json({ success: true, data: safeUser(getUserById(user.id)) });
});

// helpers
function issueRefresh(userId) {
  const refreshToken = generateToken();
  const expires = new Date(Date.now() + REFRESH_TOKEN_DAYS * 86400000).toISOString();
  saveRefreshToken(hashToken(refreshToken), userId, expires);
  return { refreshToken, refreshExpires: expires };
}

function safeUser(u) {
  // 计算有效权限 = 角色权限 ∪ 用户个人权限（admin 角色返回 ['*']）
  let effectivePermissions = [];
  const role = u.role ? getRoleById(u.role) : null;
  const rolePerms = Array.isArray(role && role.permissions) ? role.permissions : [];
  const userPerms = Array.isArray(u.permissions) ? u.permissions : [];
  if (u.role === 'admin' || rolePerms.includes('*') || userPerms.includes('*')) {
    effectivePermissions = ['*'];
  } else {
    effectivePermissions = Array.from(new Set([...rolePerms, ...userPerms]));
  }
  return {
    id: u.id, username: u.username, email: u.email,
    role: u.role, role_type: role ? (role.type || 'enterprise') : 'enterprise',
    credits: u.credits, status: u.status,
    effective_permissions: effectivePermissions,
    allowed_models: (u.allowed_models && u.allowed_models.length) ? u.allowed_models : (role && role.allowed_models) || [],
    created_at: u.created_at, last_login: u.last_login
  };
}

// 修改密码
router.post('/change-password', authenticate, (req, res) => {
  try {
    const { old_password, new_password } = req.body;
    if (!old_password || !new_password) return res.status(400).json({ success: false, error: '请填写所有字段' });
    if (new_password.length < 6) return res.status(400).json({ success: false, error: '新密码至少6位' });

    const user = getUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: '用户不存在' });

    if (!verifyPassword(old_password, user.password_hash, user.salt)) {
      return res.status(400).json({ success: false, error: '当前密码不正确' });
    }

    const { hash, salt } = hashPassword(new_password);
    updateUser(user.id, { password_hash: hash, salt });
    res.json({ success: true, message: '密码修改成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
