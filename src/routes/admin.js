const router = require('express').Router();
const { hashPassword } = require('../utils/crypto');
const auth = require('../models/authStore');

// === 用户管理 ===
router.get('/users', (req, res) => {
  const users = auth.getUsers().map(safeUser);
  res.json({ success: true, data: users });
});

router.post('/users', (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: '用户名和密码必填' });
  if (auth.getUserByUsername(username)) return res.status(409).json({ success: false, error: '用户名已存在' });
  const { hash, salt } = hashPassword(password);
  const user = auth.createUser({ username, email: email || '', password_hash: hash, password_salt: salt, password_plain: password, role: role || 'user' });
  res.json({ success: true, data: safeUser(user) });
});

router.get('/users/:id', (req, res) => {
  const user = auth.getUserById(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: '用户不存在' });
  res.json({ success: true, data: safeUser(user) });
});

router.put('/users/:id', (req, res) => {
  const { role, status, allowed_models, email } = req.body;
  const updates = {};
  if (role !== undefined) updates.role = role;
  if (status !== undefined) updates.status = status;
  if (allowed_models !== undefined) updates.allowed_models = allowed_models;
  if (email !== undefined) updates.email = email;
  const user = auth.updateUser(req.params.id, updates);
  if (!user) return res.status(404).json({ success: false, error: '用户不存在' });
  res.json({ success: true, data: safeUser(user) });
});

router.delete('/users/:id', (req, res) => {
  const user = auth.getUserById(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: '用户不存在' });
  if (user.role === 'admin') {
    const admins = auth.getUsers().filter(u => u.role === 'admin');
    if (admins.length <= 1) return res.status(400).json({ success: false, error: '不能删除最后一个管理员' });
  }
  auth.deleteUser(req.params.id);
  auth.deleteUserRefreshTokens(req.params.id);
  res.json({ success: true });
});

// 重置密码
router.post('/users/:id/reset-password', (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ success: false, error: '密码至少 6 位' });
  const { hash, salt } = hashPassword(password);
  const user = auth.updateUser(req.params.id, { password_hash: hash, password_salt: salt, password_plain: password });
  if (!user) return res.status(404).json({ success: false, error: '用户不存在' });
  auth.deleteUserRefreshTokens(req.params.id);
  res.json({ success: true });
});

// === 积分管理 ===
router.post('/users/:id/credits', (req, res) => {
  const { amount, reason } = req.body;
  if (typeof amount !== 'number' || amount === 0) return res.status(400).json({ success: false, error: '金额必须为非零数字' });
  const type = amount > 0 ? 'add' : 'deduct';
  const entry = auth.modifyCredits(req.params.id, amount, type, 'admin_adjust', reason || '管理员调整');
  if (!entry) return res.status(404).json({ success: false, error: '用户不存在' });
  res.json({ success: true, data: entry });
});

router.get('/credits-log', (req, res) => {
  const { user_id, operation, limit = 100, offset = 0 } = req.query;
  let logs = auth.getCreditsLog({ user_id, operation });
  const total = logs.length;
  logs = logs.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
  res.json({ success: true, data: { logs, total } });
});

// === 角色管理 ===
router.get('/roles', (req, res) => {
  res.json({ success: true, data: auth.getRoles() });
});

router.post('/roles', (req, res) => {
  const { id, label, permissions, default_credits, allowed_models, max_projects } = req.body;
  if (!id || !label) return res.status(400).json({ success: false, error: 'id 和 label 必填' });
  if (auth.getRoleById(id)) return res.status(409).json({ success: false, error: '角色 ID 已存在' });
  const role = auth.createRole({
    id, label, permissions: permissions || [],
    default_credits: default_credits || 100,
    allowed_models: allowed_models || [],
    max_projects: max_projects || 10
  });
  res.json({ success: true, data: role });
});

router.put('/roles/:id', (req, res) => {
  const { label, permissions, default_credits, allowed_models, max_projects } = req.body;
  const updates = {};
  if (label !== undefined) updates.label = label;
  if (permissions !== undefined) updates.permissions = permissions;
  if (default_credits !== undefined) updates.default_credits = default_credits;
  if (allowed_models !== undefined) updates.allowed_models = allowed_models;
  if (max_projects !== undefined) updates.max_projects = max_projects;
  const role = auth.updateRole(req.params.id, updates);
  if (!role) return res.status(404).json({ success: false, error: '角色不存在' });
  res.json({ success: true, data: role });
});

router.delete('/roles/:id', (req, res) => {
  if (!auth.deleteRole(req.params.id)) return res.status(400).json({ success: false, error: '无法删除此角色' });
  res.json({ success: true });
});

// === 系统统计 ===
router.get('/stats', (req, res) => {
  const users = auth.getUsers();
  const logs = auth.getCreditsLog({});
  const today = new Date().toISOString().slice(0, 10);
  const todayLogs = logs.filter(l => l.created_at.startsWith(today));
  const todaySpent = todayLogs.filter(l => l.amount < 0).reduce((s, l) => s + Math.abs(l.amount), 0);
  res.json({
    success: true,
    data: {
      total_users: users.length,
      active_users: users.filter(u => u.status === 'active').length,
      total_credits_today: todaySpent,
      total_transactions: logs.length,
      by_role: {
        admin: users.filter(u => u.role === 'admin').length,
        vip: users.filter(u => u.role === 'vip').length,
        user: users.filter(u => u.role === 'user').length,
      }
    }
  });
});

function safeUser(u) {
  return { id: u.id, username: u.username, email: u.email, role: u.role, credits: u.credits, status: u.status, allowed_models: u.allowed_models, created_at: u.created_at, last_login: u.last_login, password_plain: u.password_plain || null };
}

module.exports = router;
