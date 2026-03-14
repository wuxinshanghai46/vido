const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { hashPassword } = require('../utils/crypto');

const DB_PATH = path.resolve(process.env.OUTPUT_DIR || './outputs', 'auth_db.json');

const DEFAULT_ROLES = [
  {
    id: 'admin', label: '管理员',
    permissions: ['*'],
    default_credits: 99999, allowed_models: ['*'], max_projects: -1
  },
  {
    id: 'vip', label: 'VIP用户',
    permissions: ['create', 'generate', 'edit', 'i2v', 'avatar', 'imggen', 'view_settings'],
    default_credits: 5000, allowed_models: ['*'], max_projects: 100
  },
  {
    id: 'user', label: '普通用户',
    permissions: ['create', 'generate', 'edit'],
    default_credits: 100,
    allowed_models: ['demo', 'deepseek-chat', 'cogvideox-flash', 'cogview-3-flash'],
    max_projects: 10
  }
];

function load() {
  try {
    if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {}
  return null;
}

function save(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

function init() {
  let db = load();
  if (db && db.users && db.users.length > 0) return db;

  const { hash, salt } = hashPassword('admin123');
  db = {
    users: [{
      id: uuidv4(),
      username: 'admin',
      email: 'admin@vido.ai',
      password_hash: hash,
      password_salt: salt,
      role: 'admin',
      credits: 99999,
      status: 'active',
      allowed_models: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_login: null
    }],
    roles: DEFAULT_ROLES,
    credits_log: [],
    refresh_tokens: []
  };
  save(db);
  console.log('\n  ⚠ 默认管理员已创建: admin / admin123 — 请尽快修改密码\n');
  return db;
}

// === Users ===
function getUsers() { return init().users; }

function getUserById(id) { return init().users.find(u => u.id === id) || null; }

function getUserByUsername(username) { return init().users.find(u => u.username === username) || null; }

function getUserByEmail(email) { return init().users.find(u => u.email === email) || null; }

function createUser({ username, email, password_hash, password_salt, role = 'user' }) {
  const db = init();
  const roleObj = db.roles.find(r => r.id === role);
  const user = {
    id: uuidv4(), username, email, password_hash, password_salt,
    role, credits: roleObj ? roleObj.default_credits : 100,
    status: 'active', allowed_models: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_login: null
  };
  db.users.push(user);
  save(db);
  return user;
}

function updateUser(id, fields) {
  const db = init();
  const idx = db.users.findIndex(u => u.id === id);
  if (idx < 0) return null;
  Object.assign(db.users[idx], fields, { updated_at: new Date().toISOString() });
  save(db);
  return db.users[idx];
}

function deleteUser(id) {
  const db = init();
  const idx = db.users.findIndex(u => u.id === id);
  if (idx < 0) return false;
  db.users.splice(idx, 1);
  save(db);
  return true;
}

// === Roles ===
function getRoles() { return init().roles; }

function getRoleById(id) { return init().roles.find(r => r.id === id) || null; }

function createRole(role) {
  const db = init();
  db.roles.push(role);
  save(db);
  return role;
}

function updateRole(id, fields) {
  const db = init();
  const idx = db.roles.findIndex(r => r.id === id);
  if (idx < 0) return null;
  Object.assign(db.roles[idx], fields);
  save(db);
  return db.roles[idx];
}

function deleteRole(id) {
  if (id === 'admin' || id === 'user') return false;
  const db = init();
  const idx = db.roles.findIndex(r => r.id === id);
  if (idx < 0) return false;
  db.roles.splice(idx, 1);
  save(db);
  return true;
}

// === Credits ===
function addCreditsLog(entry) {
  const db = init();
  entry.id = uuidv4();
  entry.created_at = new Date().toISOString();
  db.credits_log.push(entry);
  save(db);
  return entry;
}

function getCreditsLog(filter = {}) {
  const db = init();
  let logs = db.credits_log;
  if (filter.user_id) logs = logs.filter(l => l.user_id === filter.user_id);
  if (filter.operation) logs = logs.filter(l => l.operation === filter.operation);
  return logs.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function modifyCredits(userId, amount, type, operation, detail = '', projectId = null) {
  const db = init();
  const user = db.users.find(u => u.id === userId);
  if (!user) return null;
  user.credits += amount;
  if (user.credits < 0) user.credits = 0;
  user.updated_at = new Date().toISOString();
  const entry = {
    id: uuidv4(), user_id: userId, amount,
    balance_after: user.credits, type, operation,
    detail, project_id: projectId,
    created_at: new Date().toISOString()
  };
  db.credits_log.push(entry);
  save(db);
  return entry;
}

// === Refresh Tokens ===
function saveRefreshToken(tokenHash, userId, expiresAt) {
  const db = init();
  db.refresh_tokens.push({ token_hash: tokenHash, user_id: userId, expires_at: expiresAt, created_at: new Date().toISOString() });
  // 清理过期 token
  const now = new Date().toISOString();
  db.refresh_tokens = db.refresh_tokens.filter(t => t.expires_at > now);
  save(db);
}

function getRefreshToken(tokenHash) {
  const db = init();
  return db.refresh_tokens.find(t => t.token_hash === tokenHash && t.expires_at > new Date().toISOString()) || null;
}

function deleteRefreshToken(tokenHash) {
  const db = init();
  db.refresh_tokens = db.refresh_tokens.filter(t => t.token_hash !== tokenHash);
  save(db);
}

function deleteUserRefreshTokens(userId) {
  const db = init();
  db.refresh_tokens = db.refresh_tokens.filter(t => t.user_id !== userId);
  save(db);
}

module.exports = {
  init, getUsers, getUserById, getUserByUsername, getUserByEmail,
  createUser, updateUser, deleteUser,
  getRoles, getRoleById, createRole, updateRole, deleteRole,
  addCreditsLog, getCreditsLog, modifyCredits,
  saveRefreshToken, getRefreshToken, deleteRefreshToken, deleteUserRefreshTokens
};
