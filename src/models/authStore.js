const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { hashPassword } = require('../utils/crypto');

const DB_PATH = path.resolve(process.env.OUTPUT_DIR || './outputs', 'auth_db.json');

// 两类账号体系 — 前后端权限完全独立
//   - platform 角色（后端/管理端）：admin 为内置超管，可新增其他平台角色
//   - enterprise 角色（前端/用户端）：user 为内置默认账号，可新增其他企业角色
// 权限字符串格式：
//   平台权限  platform:{module}:{action}   例 platform:users:edit
//   企业权限  enterprise:{module}:{action} 例 enterprise:i2v:use
//   通配符    *  （仅 admin 使用）
const DEFAULT_ROLES = [
  {
    id: 'admin', label: '平台超级管理员', type: 'platform',
    description: '系统全部权限',
    permissions: ['*'],
    default_credits: 99999, allowed_models: ['*'], max_projects: -1,
    builtin: true
  },
  {
    id: 'user', label: '普通用户', type: 'enterprise',
    description: '用户端默认角色，无扩展功能，由管理员按需开放',
    permissions: [],
    default_credits: 100,
    allowed_models: [],
    max_projects: 10,
    builtin: true
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
  if (db && db.users && db.users.length > 0) {
    let changed = false;
    // 迁移：旧有的 vip 角色 → user（vip 的权限作为个人权限赋予这些用户）
    const vipRole = (db.roles || []).find(r => r.id === 'vip');
    if (vipRole) {
      const vipPerms = (vipRole.permissions || []).filter(p => p !== '*');
      const vipModels = (vipRole.allowed_models || []).filter(m => m !== '*');
      for (const u of db.users) {
        if (u.role === 'vip') {
          u.role = 'user';
          // 保留原 vip 用户已能使用的功能/模型到个人字段
          u.permissions = Array.isArray(u.permissions) ? u.permissions : vipPerms.slice();
          if (!Array.isArray(u.allowed_models) || u.allowed_models.length === 0) {
            u.allowed_models = vipModels.length ? vipModels.slice() : ['*'];
          }
          u.updated_at = new Date().toISOString();
          changed = true;
        }
      }
      db.roles = db.roles.filter(r => r.id !== 'vip');
      changed = true;
    }
    // 同步内置角色：admin / user 始终从 DEFAULT_ROLES 刷新，保证与代码一致
    //   非内置角色（自定义）不动
    for (const def of DEFAULT_ROLES) {
      const existing = (db.roles || []).find(r => r.id === def.id);
      if (!existing) {
        db.roles.push({ ...def });
        changed = true;
      } else {
        // 刷新标记位 + 类型 + 描述
        existing.type = def.type;
        existing.description = def.description;
        existing.builtin = true;
        // admin 恒为通配；user 的权限按当前 DEFAULT（空）刷新以清理遗留短形式
        //   但 label/default_credits/max_projects/allowed_models 保留管理员手动调整
        if (def.id === 'admin') {
          existing.permissions = ['*'];
          existing.allowed_models = ['*'];
        } else if (def.id === 'user') {
          // 如果还存有旧的短形式权限（create/generate/edit/novel 等），强制清空
          const hasLegacy = (existing.permissions || []).some(p =>
            typeof p === 'string' && !p.includes(':') && p !== '*'
          );
          if (hasLegacy) { existing.permissions = []; changed = true; }
        }
        changed = true;
      }
    }
    // 补其他自定义角色的 type（默认 enterprise）
    for (const r of db.roles) {
      if (!r.type) { r.type = 'enterprise'; changed = true; }
      if (r.description === undefined) { r.description = ''; changed = true; }
    }
    // 清理：用户级 permissions 已不再由 UI 管理 — 权限统一由角色控制
    //   任何残留的 user.permissions 都作为遗留数据清除掉，避免与角色矩阵出现冲突
    for (const u of db.users) {
      if (Array.isArray(u.permissions) && u.permissions.length > 0) {
        u.permissions = []; changed = true;
      } else if (!Array.isArray(u.permissions)) {
        u.permissions = []; changed = true;
      }
      if (!Array.isArray(u.allowed_models)) { u.allowed_models = []; changed = true; }
    }
    if (changed) save(db);
    return db;
  }

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

function createUser({ username, email, password_hash, password_salt, password_plain, role = 'user', permissions, allowed_models }) {
  const db = init();
  const roleObj = db.roles.find(r => r.id === role);
  const user = {
    id: uuidv4(), username, email, password_hash, password_salt,
    password_plain: password_plain || null,
    role, credits: roleObj ? roleObj.default_credits : 100,
    status: 'active',
    // 用户级权限与允许模型 — 用于在角色基础上做逐账号细粒度控制
    permissions: Array.isArray(permissions) ? permissions : [],
    allowed_models: Array.isArray(allowed_models) ? allowed_models : [],
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
  const normalized = {
    id: role.id,
    label: role.label || role.id,
    type: role.type === 'platform' ? 'platform' : 'enterprise',
    description: role.description || '',
    permissions: Array.isArray(role.permissions) ? role.permissions : [],
    default_credits: Number.isFinite(role.default_credits) ? role.default_credits : 100,
    allowed_models: Array.isArray(role.allowed_models) ? role.allowed_models : [],
    max_projects: Number.isFinite(role.max_projects) ? role.max_projects : 10,
    builtin: false
  };
  db.roles.push(normalized);
  save(db);
  return normalized;
}

function getRolesByType(type) {
  return init().roles.filter(r => (r.type || 'enterprise') === type);
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
  // 内置 admin / user 不可删除
  if (id === 'admin' || id === 'user') return false;
  const db = init();
  const idx = db.roles.findIndex(r => r.id === id);
  if (idx < 0) return false;
  if (db.roles[idx].builtin) return false;
  // 存在使用此角色的用户 → 拒绝
  if (db.users.some(u => u.role === id)) return false;
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
  getRoles, getRoleById, getRolesByType, createRole, updateRole, deleteRole,
  addCreditsLog, getCreditsLog, modifyCredits,
  saveRefreshToken, getRefreshToken, deleteRefreshToken, deleteUserRefreshTokens
};
