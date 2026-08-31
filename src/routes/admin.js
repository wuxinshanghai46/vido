const router = require('express').Router();
const { hashPassword } = require('../utils/crypto');
const auth = require('../models/authStore');
const db = require('../models/database');
const knowledgeRuleSchema = require('../services/newStoryAd/knowledgeRuleSchemaService');

// === 鐢ㄦ埛绠＄悊 ===
router.get('/users', (req, res) => {
  const users = auth.getUsers().map(safeUser);
  res.json({ success: true, data: users });
});

router.post('/users', (req, res) => {
  const { username, email, phone, nickname, gender, remark, password, role, permissions, allowed_models } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: '用户名和密码必填' });
  const cleanUsername = String(username).trim();
  const passwordError = validatePassword(password);
  if (!isEnglishUsername(cleanUsername)) return res.status(400).json({ success: false, error: '用户名只能输入英文字母，长度 3-20 位' });
  if (passwordError) return res.status(400).json({ success: false, error: passwordError });
  if (auth.getUserByUsername(cleanUsername)) return res.status(409).json({ success: false, error: '用户名已存在' });
  // role 蹇呴』鏄幇瀛樿鑹?
  const roleObj = role ? auth.getRoleById(role) : auth.getRoleById('user');
  if (!roleObj) return res.status(400).json({ success: false, error: '角色不存在 ' + role });
  const { hash, salt } = hashPassword(password);
  const user = auth.createUser({
    username: cleanUsername, email: email || '', phone: phone || '', nickname: nickname || '', gender: gender || '', remark: remark || '',
    password_hash: hash, password_salt: salt, password_plain: password,
    role: roleObj.id,
    permissions: Array.isArray(permissions) ? permissions : [],
    allowed_models: Array.isArray(allowed_models) ? allowed_models : []
  });
  res.json({ success: true, data: safeUser(user) });
});

router.get('/users/:id', (req, res) => {
  const user = auth.getUserById(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: '用户不存在' });
  res.json({ success: true, data: safeUser(user) });
});

router.put('/users/:id', (req, res) => {
  const { role, status, allowed_models, email, phone, nickname, gender, remark, permissions } = req.body;
  const updates = {};
  if (role !== undefined) {
    // role 蹇呴』鏄瓨鍦ㄧ殑瑙掕壊
    const roleObj = auth.getRoleById(role);
    if (!roleObj) return res.status(400).json({ success: false, error: '角色不存在 ' + role });
    updates.role = role;
  }
  if (status !== undefined) updates.status = status;
  if (allowed_models !== undefined) updates.allowed_models = Array.isArray(allowed_models) ? allowed_models : [];
  if (permissions !== undefined) updates.permissions = Array.isArray(permissions) ? permissions : [];
  if (email !== undefined) updates.email = email;
  if (phone !== undefined) updates.phone = phone;
  if (nickname !== undefined) updates.nickname = nickname;
  if (gender !== undefined) updates.gender = gender;
  if (remark !== undefined) updates.remark = remark;
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

// 閲嶇疆瀵嗙爜
router.post('/users/:id/reset-password', (req, res) => {
  const { password } = req.body;
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ success: false, error: passwordError });
  const { hash, salt } = hashPassword(password);
  const user = auth.updateUser(req.params.id, { password_hash: hash, password_salt: salt, password_plain: password });
  if (!user) return res.status(404).json({ success: false, error: '用户不存在' });
  auth.deleteUserRefreshTokens(req.params.id);
  res.json({ success: true });
});

// === 绉垎绠＄悊 ===
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

// === 鏉冮檺鐭╅樀鍏冩暟鎹?===
// === ??????? ===
// === Permission matrix metadata ===
// Frontend and admin permissions are independent. Add new modules/actions here; new roles select all by default.
const PERMISSION_MATRIX = {
  platform: {
    label: '后台角色',
    modules: [
      { id: 'dashboard',     label: '仪表盘',       group: '总览', actions: ['view', 'export'] },
      { id: 'users',         label: '用户管理',     group: '访问控制', actions: ['view', 'create', 'edit', 'delete', 'reset_password', 'configure'] },
      { id: 'roles',         label: '角色管理',     group: '访问控制', actions: ['view', 'create', 'edit', 'delete', 'configure'] },
      { id: 'credits',       label: '积分记录',     group: '计费', actions: ['view', 'edit', 'export'] },
      { id: 'contents',      label: '内容管理',     group: '运营', actions: ['view', 'edit', 'delete', 'review', 'export'] },
      { id: 'ai',            label: 'AI 配置',      group: 'AI 系统', actions: ['view', 'create', 'edit', 'delete', 'configure', 'test'] },
      { id: 'aicap',         label: 'AI 能力',      group: 'AI 系统', actions: ['view', 'create', 'edit', 'delete', 'generate', 'configure'] },
      { id: 'workflows',     label: 'AI 工作流',    group: 'AI 系统', actions: ['view', 'create', 'edit', 'delete', 'run', 'debug'] },
      { id: 'knowledgebase', label: '知识库',       group: 'AI 系统', actions: ['view', 'create', 'edit', 'delete', 'import', 'export'] },
      { id: 'aiteam',        label: 'AI 团队',      group: 'AI 系统', actions: ['view', 'create', 'edit', 'delete', 'configure'] },
      { id: 'monitor',       label: '模型监控',     group: '监控', actions: ['view', 'debug', 'export'] },
      { id: 'videogenerationmonitor', label: '视频生成监控', group: '监控', actions: ['view', 'debug', 'export'] },
      { id: 'sync',          label: '数据同步',     group: '数据', actions: ['view', 'edit', 'run', 'debug'] },
      { id: 'apiaccounts',   label: '接口账号',     group: '接口', actions: ['view', 'create', 'edit', 'delete', 'test'] },
      { id: 'datasource',    label: '数据源管理',   group: '数据', actions: ['view', 'create', 'edit', 'delete', 'test'] },
      { id: 'modelpipeline', label: '模型调用管理', group: 'AI 系统', actions: ['view', 'create', 'edit', 'delete', 'configure', 'debug'] },
      { id: 'system',        label: '系统设置',     group: '系统', actions: ['view', 'edit', 'configure', 'debug'] },
    ],
    actions: [
      { id: 'view',   label: '查看' },
      { id: 'create', label: '创建' },
      { id: 'edit',   label: '编辑' },
      { id: 'delete', label: '删除' },
      { id: 'generate', label: '生成' },
      { id: 'run', label: '执行' },
      { id: 'configure', label: '配置' },
      { id: 'import', label: '导入' },
      { id: 'export', label: '导出' },
      { id: 'review', label: '审核' },
      { id: 'test', label: '测试' },
      { id: 'reset_password', label: '重置密码' },
      { id: 'debug', label: '调试' },
    ]
  },
  enterprise: {
    label: '前台角色',
    modules: [
      { id: 'dashboard',  label: '创作中心',     group: '创作中心', actions: ['view'] },
      { id: 'aicanvas',   label: '视频画布',      group: '内容创作', actions: ['view', 'create', 'edit', 'delete', 'generate', 'export'] },
      { id: 'create',     label: '视频动漫',      group: '内容创作', actions: ['view', 'create', 'edit', 'delete', 'generate', 'publish', 'export'] },
      { id: 'avatar',     label: '广告/数字人',   group: '内容创作', actions: ['view', 'create', 'edit', 'delete', 'generate', 'publish', 'export', 'view_errors'] },
      { id: 'comic',      label: '漫画',          group: '内容创作', actions: ['view', 'create', 'edit', 'delete', 'generate', 'publish', 'export'] },
      { id: 'drama',      label: 'AI 网剧',      group: '内容创作', actions: ['view', 'create', 'edit', 'delete', 'generate', 'publish', 'export'] },
      { id: 'manga_drama', label: '漫剧',        group: '内容创作', actions: ['view', 'create', 'edit', 'delete', 'generate', 'publish', 'export'] },
      { id: 'novel',      label: '小说',          group: '内容创作', actions: ['view', 'create', 'edit', 'delete', 'generate', 'import', 'export'] },
      { id: 'workflow',   label: '工作流画布',   group: '内容创作', actions: ['view', 'create', 'edit', 'delete', 'run', 'debug'] },
      { id: 'i2v',        label: '图生视频',     group: '工具', actions: ['view', 'create', 'generate', 'delete', 'export', 'view_errors'] },
      { id: 'imggen',     label: '图片生成',      group: '工具', actions: ['view', 'create', 'generate', 'delete', 'export', 'view_errors'] },
      { id: 'radar',      label: '素材获取',     group: '爆款复刻', actions: ['view', 'create', 'import', 'delete', 'export'] },
      { id: 'monitor',    label: '素材库',       group: '爆款复刻', actions: ['view', 'create', 'edit', 'delete', 'import', 'export'] },
      { id: 'contentlib', label: '内容库',       group: '爆款复刻', actions: ['view', 'create', 'edit', 'delete', 'import', 'export'] },
      { id: 'workbench',  label: '声音克隆',     group: '爆款复刻', actions: ['view', 'create', 'edit', 'delete', 'generate', 'export'] },
      { id: 'replicate',  label: '一键复刻',     group: '爆款复刻', actions: ['view', 'create', 'edit', 'delete', 'generate', 'publish', 'export', 'view_errors'] },
      { id: 'works',      label: '我的作品',     group: '我的', actions: ['view', 'edit', 'delete', 'publish', 'export'] },
      { id: 'projects',   label: '我的项目',     group: '我的', actions: ['view', 'create', 'edit', 'delete', 'export'] },
      { id: 'portrait',   label: '我的角色',     group: '我的', actions: ['view', 'create', 'edit', 'delete', 'generate', 'export'] },
      { id: 'assets',     label: '素材库',       group: '我的', actions: ['view', 'create', 'edit', 'delete', 'import', 'export'] },
      { id: 'profile',    label: '个人信息',     group: '账号', actions: ['view', 'edit'] },
      { id: 'model_usage', label: '模型消耗',    group: '账号', actions: ['view', 'export'] },
      { id: 'luxury_ad_pipeline_debug', label: '剧情广告调试链路', group: '账号', actions: ['view', 'debug', 'view_errors', 'export'] },
    ],
    actions: [
      { id: 'view',   label: '查看' },
      { id: 'create', label: '创建' },
      { id: 'edit',   label: '编辑' },
      { id: 'delete', label: '删除' },
      { id: 'generate', label: '生成' },
      { id: 'run', label: '执行' },
      { id: 'publish', label: '发布' },
      { id: 'import', label: '导入' },
      { id: 'export', label: '导出' },
      { id: 'debug', label: '调试' },
      { id: 'view_errors', label: '错误可见' },
    ]
  }
};

function matrixActionsForModule(matrix, module) {
  const allowed = Array.isArray(module.actions) && module.actions.length ? new Set(module.actions) : null;
  return (matrix.actions || []).filter(a => !allowed || allowed.has(a.id));
}

function allPermissionKeys(type) {
  const matrix = PERMISSION_MATRIX[type] || PERMISSION_MATRIX.enterprise;
  const keys = [];
  for (const module of matrix.modules || []) {
    for (const action of matrixActionsForModule(matrix, module)) {
      keys.push(`${type}:${module.id}:${action.id}`);
    }
  }
  return keys;
}

function normalizeRolePermissions(type, permissions) {
  const allowed = new Set(allPermissionKeys(type));
  if (!Array.isArray(permissions)) return allPermissionKeys(type);
  if (permissions.includes('*')) return ['*'];
  return permissions.filter(p => typeof p === 'string' && allowed.has(p));
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isEnglishUsername(username) {
  return /^[A-Za-z]{3,20}$/.test(username);
}

function validatePassword(password) {
  if (typeof password !== 'string' || !password) return '密码必填';
  if (password.length < 8) return '密码至少 8 位';
  if (!/^[\x21-\x7E]+$/.test(password)) return '密码只支持数字、英文和特殊字符';
  return '';
}

function roleIdPrefix(type) {
  return type === 'platform' ? 'HT_' : 'QT_';
}

function isValidRoleIdForType(id, type) {
  return new RegExp(`^${roleIdPrefix(type)}\\d{3}$`).test(String(id || ''));
}

router.get('/permissions-matrix', (req, res) => {
  const type = req.query.type === 'platform' ? 'platform' : req.query.type === 'enterprise' ? 'enterprise' : null;
  if (type) return res.json({ success: true, data: PERMISSION_MATRIX[type] });
  res.json({ success: true, data: PERMISSION_MATRIX });
});

// === 瑙掕壊绠＄悊 ===
router.get('/roles', (req, res) => {
  const type = req.query.type;
  const users = auth.getUsers();
  let roles = auth.getRoles();
  if (type === 'platform' || type === 'enterprise') {
    roles = roles.filter(r => (r.type || 'enterprise') === type);
  }
  // 闄勫姞姣忎釜瑙掕壊鐨勭敤鎴锋暟
  const data = roles.map(r => ({
    ...r,
    user_count: users.filter(u => u.role === r.id).length
  }));
  res.json({ success: true, data });
});

router.post('/roles', (req, res) => {
  const { id, label, type, description, remark, display_order, status, permissions, default_credits, allowed_models, max_projects } = req.body;
  if (!id || !label) return res.status(400).json({ success: false, error: 'id 鍜?label 蹇呭～' });
  const roleType = type || 'enterprise';
  if (roleType !== 'platform' && roleType !== 'enterprise') {
    return res.status(400).json({ success: false, error: '闈炴硶 type' });
  }
  if (!isValidRoleIdForType(id, roleType)) return res.status(400).json({ success: false, error: `${roleType === 'platform' ? '后台' : '前台'}角色编号必须按 ${roleIdPrefix(roleType)}001 格式递增` });
  if (auth.getRoleById(id)) return res.status(409).json({ success: false, error: '瑙掕壊 ID 宸插瓨鍦? '});
  const role = auth.createRole({
    id, label, type: roleType, description: description || '',
    remark: remark || '',
    display_order: finiteNumber(display_order, 0),
    status: status || 'active',
    permissions: normalizeRolePermissions(roleType, permissions),
    default_credits: finiteNumber(default_credits, 100),
    allowed_models: allowed_models || [],
    max_projects: finiteNumber(max_projects, 10)
  });
  res.json({ success: true, data: role });
});

router.put('/roles/:id', (req, res) => {
  const role = auth.getRoleById(req.params.id);
  if (!role) return res.status(404).json({ success: false, error: '瑙掕壊涓嶅瓨鍦? '});
  const { label, description, remark, display_order, status, permissions, default_credits, allowed_models, max_projects } = req.body;
  const updates = {};
  if (label !== undefined) updates.label = label;
  if (description !== undefined) updates.description = description;
  if (remark !== undefined) updates.remark = remark;
  if (display_order !== undefined) updates.display_order = finiteNumber(display_order, 0);
  if (status !== undefined) updates.status = status;
  if (permissions !== undefined) {
    // 杩囨护锛氬悗鍙拌鑹蹭笉鑳芥寔鏈?enterprise: 鍓嶇紑鏉冮檺锛屽弽涔嬩害鐒?    const type = role.type || 'enterprise';
    const type = role.type || 'enterprise';
    updates.permissions = normalizeRolePermissions(type, permissions);
    // admin 鍐呯疆瑙掕壊姘歌繙淇濇寔 *
    if (role.id === 'admin') updates.permissions = ['*'];
  }
  if (default_credits !== undefined) updates.default_credits = finiteNumber(default_credits, 100);
  if (allowed_models !== undefined) updates.allowed_models = allowed_models;
  if (max_projects !== undefined) updates.max_projects = finiteNumber(max_projects, 10);
  const updated = auth.updateRole(req.params.id, updates);
  if (!updated) return res.status(404).json({ success: false, error: '瑙掕壊涓嶅瓨鍦? '});
  res.json({ success: true, data: updated });
});

router.delete('/roles/:id', (req, res) => {
  if (!auth.deleteRole(req.params.id)) return res.status(400).json({ success: false, error: '鏃犳硶鍒犻櫎姝よ鑹? '});
  res.json({ success: true });
});

// === 绯荤粺缁熻 ===
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

// === 鍐呭绠＄悊锛坴8 鍗囩骇锛氳鐩栧叏閮ㄥ唴瀹规ā鍧楋級===

// 妯″潡鍏冧俊鎭紙渚涘墠绔覆鏌?tab锛?
const CONTENT_MODULES = [
  { id: 'all',       name: '全部',       emoji: '▦' },
  { id: 'project',   name: '视频项目',   emoji: '▶' },
  { id: 'drama',     name: '网剧',       emoji: '▣' },
  { id: 'i2v',       name: '图生视频',   emoji: '◉' },
  { id: 'novel',     name: '小说',       emoji: '▤' },
  { id: 'comic',     name: '漫画',       emoji: '▧' },
  { id: 'avatar',    name: '数字人',     emoji: '◇' },
  { id: 'portrait',  name: '角色形象',   emoji: '◎' },
];

router.get('/contents/modules', (req, res) => {
  // 鍚屾椂杩斿洖鍚勬ā鍧楃殑璁℃暟
  const counts = {};
  try { counts.project  = db.listProjects().length; } catch { counts.project = 0; }
  try { counts.drama    = db.listDramaProjects().length; } catch { counts.drama = 0; }
  try { counts.i2v      = db.listI2VTasks().length; } catch { counts.i2v = 0; }
  try { counts.novel    = db.listNovels().length; } catch { counts.novel = 0; }
  try { counts.comic    = db.listComicTasks().length; } catch { counts.comic = 0; }
  try { counts.avatar   = db.listAvatarTasks().length; } catch { counts.avatar = 0; }
  try { counts.portrait = db.listPortraits().length; } catch { counts.portrait = 0; }
  counts.all = Object.values(counts).reduce((s, v) => s + v, 0);

  res.json({ success: true, data: CONTENT_MODULES.map(m => ({ ...m, count: counts[m.id] || 0 })) });
});

router.get('/contents', (req, res) => {
  const { type, user_id, limit = 50, offset = 0 } = req.query;
  const users = auth.getUsers();
  const userMap = {};
  users.forEach(u => { userMap[u.id] = u.username; });

  let items = [];
  const want = t => !type || type === 'all' || type === t;

  // v11: 缁熶竴鐢?/api/admin/thumbnail/:type/:id 浣滀负缂╃暐鍥炬潵婧?
  // 杩欎釜绔偣浼氳嚜鍔ㄩ€夋渶浣虫簮锛堝浘鐗?瑙嗛棣栧抚锛夊苟缂撳瓨
  const thumbUrl = (type, id) => `/api/admin/thumbnail/${type}/${id}`;

  // 椤圭洰锛堝崟瑙嗛锛?
  if (want('project')) {
    try {
      db.listProjects().forEach(p => {
        if (user_id && p.user_id !== user_id) return;
        // 妫€鏌ユ槸鍚︽湁宸茬敓鎴愮殑瑙嗛/clip
        let hasVideo = !!(p.output_path || p.final_video_path);
        if (!hasVideo) {
          try {
            const clips = db.getClipsByProject(p.id);
            hasVideo = clips.some(c => c.file_path);
          } catch {}
          if (!hasVideo) {
            const fs = require('fs');
            const path = require('path');
            const guess = path.resolve(__dirname, `../../outputs/projects/${p.id}_final.mp4`);
            hasVideo = fs.existsSync(guess);
          }
        }
        items.push({
          type: 'project', id: p.id,
          title: p.title || p.prompt?.slice(0, 40) || '\u672a\u547d\u540d\u9879\u76ee',
          user_id: p.user_id, username: userMap[p.user_id] || '\u672a\u77e5',
          status: p.status, created_at: p.created_at,
          detail: `${p.scene_count || '-'} 场景 · ${p.video_provider || 'demo'}`,
          thumbnail: hasVideo ? thumbUrl('project', p.id) : null,
          has_video: hasVideo,
        });
      });
    } catch {}
  }

  // 缃戝墽椤圭洰
  if (want('drama')) {
    try {
      db.listDramaProjects().forEach(p => {
        if (user_id && p.user_id !== user_id) return;
        let episodeCount = 0;
        let hasMedia = false;
        try {
          const eps = db.listDramaEpisodes(p.id);
          episodeCount = eps.length;
          hasMedia = eps.some(e => e.result?.scenes?.length > 0);
        } catch {}
        const hasThumb = !!p.cover_url || hasMedia;
        items.push({
          type: 'drama', id: p.id,
          title: p.title || p.synopsis?.slice(0, 40) || '\u672a\u547d\u540d\u7f51\u5267',
          user_id: p.user_id, username: userMap[p.user_id] || '\u672a\u77e5',
          status: p.status || '-', created_at: p.created_at,
          detail: `${episodeCount}/${p.episode_count || 0} 集 · ${p.style || ''}`,
          thumbnail: hasThumb ? thumbUrl('drama', p.id) : null,
          has_video: hasMedia,
        });
      });
    } catch {}
  }

  // 鍥剧敓瑙嗛
  if (want('i2v')) {
    try {
      db.listI2VTasks().forEach(t => {
        if (user_id && t.user_id !== user_id) return;
        items.push({
          type: 'i2v', id: t.id,
          title: t.prompt?.slice(0, 40) || '\u56fe\u751f\u89c6\u9891',
          user_id: t.user_id, username: userMap[t.user_id] || '\u672a\u77e5',
          status: t.status, created_at: t.created_at,
          detail: `${t.provider || ''} · ${t.model || ''}`,
          thumbnail: t.image_path ? thumbUrl('i2v', t.id) : null,
          has_video: t.status === 'completed',
        });
      });
    } catch {}
  }

  // 灏忚
  if (want('novel')) {
    try {
      db.listNovels().forEach(n => {
        if (user_id && n.user_id !== user_id) return;
        const totalWords = (n.chapters || []).reduce((s, c) => s + (c.word_count || 0), 0);
        items.push({
          type: 'novel', id: n.id, title: n.title || '\u672a\u547d\u540d\u5c0f\u8bf4',
          user_id: n.user_id, username: userMap[n.user_id] || '\u672a\u77e5',
          status: n.chapters?.length ? `${n.chapters.length} 章` : '空',
          created_at: n.created_at,
          detail: `${totalWords} 字 · ${n.genre || ''}`,
          thumbnail: null,
          has_content: n.chapters?.length > 0,
        });
      });
    } catch {}
  }

  // 婕敾
  if (want('comic')) {
    try {
      db.listComicTasks().forEach(c => {
        if (user_id && c.user_id !== user_id) return;
        const hasPanels = (c.panels || []).length > 0 && c.panels.some(p => p.image_url);
        items.push({
          type: 'comic', id: c.id,
          title: c.title || c.theme?.slice(0, 40) || '\u672a\u547d\u540d\u6f2b\u753b',
          user_id: c.user_id, username: userMap[c.user_id] || '\u672a\u77e5',
          status: c.status || '-', created_at: c.created_at,
          detail: `${(c.panels || []).length} 格 · ${c.style || ''}`,
          thumbnail: hasPanels ? thumbUrl('comic', c.id) : null,
          has_content: (c.panels || []).length > 0,
        });
      });
    } catch {}
  }

  // 鏁板瓧浜?
  if (want('avatar')) {
    try {
      db.listAvatarTasks().forEach(a => {
        if (user_id && a.user_id !== user_id) return;
        const hasMedia = !!(a.avatar_url || a.video_url || a.output_url);
        items.push({
          type: 'avatar', id: a.id,
          title: a.name || a.text?.slice(0, 40) || '\u6570\u5b57\u4eba\u89c6\u9891',
          user_id: a.user_id, username: userMap[a.user_id] || '\u672a\u77e5',
          status: a.status || '-', created_at: a.created_at,
          detail: `${a.provider || ''} · ${a.voice || ''}`,
          thumbnail: hasMedia ? thumbUrl('avatar', a.id) : null,
          has_video: a.status === 'completed' || a.status === 'done',
        });
      });
    } catch {}
  }

  // 瑙掕壊褰㈣薄锛圥ortrait锛?
  if (want('portrait')) {
    try {
      db.listPortraits().forEach(p => {
        if (user_id && p.user_id !== user_id) return;
        const imgs = p.images || [];
        const hasImage = imgs.length > 0 || !!p.image_url || !!p.three_view?.front;
        items.push({
          type: 'portrait', id: p.id,
          title: p.name || p.character_name || p.prompt?.slice(0, 40) || '\u89d2\u8272\u5f62\u8c61',
          user_id: p.user_id, username: userMap[p.user_id] || '\u672a\u77e5',
          status: p.status || '-', created_at: p.created_at,
          detail: `${p.style || ''} · ${imgs.length} 张`,
          thumbnail: hasImage ? thumbUrl('portrait', p.id) : null,
          has_content: imgs.length > 0,
        });
      });
    } catch {}
  }

  // 鎸夋椂闂存帓搴?
  items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const total = items.length;
  items = items.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
  res.json({ success: true, data: { items, total } });
});

// 鍐呭璇︽儏
router.get('/contents/:type/:id', (req, res) => {
  const { type, id } = req.params;
  const users = auth.getUsers();
  const userMap = {};
  users.forEach(u => { userMap[u.id] = u.username; });

  let item = null;
  if (type === 'project') {
    const p = db.getProject(id);
    if (p) item = {
      type: 'project', id: p.id, title: p.title || p.prompt?.slice(0, 60) || '\u672a\u547d\u540d',
      username: userMap[p.user_id] || '\u672a\u77e5', status: p.status, created_at: p.created_at,
      prompt: p.prompt, scene_count: p.scene_count, video_provider: p.video_provider,
      video_model: p.video_model, anim_style: p.anim_style,
      scenes: (p.scenes || []).map(s => ({ index: s.scene_index, description: s.description, visual_prompt: s.visual_prompt })),
      has_video: !!(p.output_path || p.final_video_path || db.getFinalVideoByProject(p.id)),
      stream_url: `/api/projects/${p.id}/stream`
    };
  } else if (type === 'i2v') {
    const t = db.getI2VTask(id);
    if (t) item = {
      type: 'i2v', id: t.id, title: t.prompt?.slice(0, 60) || '\u56fe\u751f\u89c6\u9891',
      username: userMap[t.user_id] || '\u672a\u77e5', status: t.status, created_at: t.created_at,
      prompt: t.prompt, provider: t.provider, model: t.model,
      has_video: t.status === 'completed',
      stream_url: `/api/i2v/tasks/${t.id}/stream`,
      image_url: t.image_path ? `/api/i2v/images/${require('path').basename(t.image_path)}` : null
    };
  } else if (type === 'novel') {
    const n = db.getNovel(id);
    if (n) item = {
      type: 'novel', id: n.id, title: n.title, novel_type: n.novel_type,
      username: userMap[n.user_id] || '\u672a\u77e5', status: n.status, created_at: n.created_at,
      genre: n.genre, style: n.style, total_words: n.total_words,
      synopsis: n.outline?.synopsis || '',
      chapters: (n.chapters || []).map(c => ({ index: c.index, title: c.title, word_count: c.word_count, content: c.content })),
      outline_chapters: (n.outline?.chapters || []).map(c => ({ index: c.index, title: c.title, summary: c.summary }))
    };
  } else if (type === 'drama') {
    const p = db.getDramaProject(id);
    if (p) {
      const episodes = db.listDramaEpisodes(id);
      item = {
        type: 'drama', id: p.id, title: p.title || '\u672a\u547d\u540d\u7f51\u5267',
        username: userMap[p.user_id] || '\u672a\u77e5', status: p.status, created_at: p.created_at,
        synopsis: p.synopsis, style: p.style, episode_count: p.episode_count,
        aspect_ratio: p.aspect_ratio, motion_preset: p.motion_preset,
        cover_url: p.cover_url,
        characters: p.characters || [],
        episodes: episodes.map(e => ({
          id: e.id, episode_index: e.episode_index, title: e.title,
          status: e.status, progress: e.progress, message: e.message,
          hook: e.hook, summary: e.summary,
          has_video: e.status === 'done' && !!e.result,
          stream_url: `/api/drama/tasks/${e.id}/stream`,
        })),
      };
    }
  } else if (type === 'comic') {
    const c = db.getComicTask(id);
    if (c) item = {
      type: 'comic', id: c.id, title: c.title || '\u672a\u547d\u540d\u6f2b\u753b',
      username: userMap[c.user_id] || '\u672a\u77e5', status: c.status, created_at: c.created_at,
      theme: c.theme, style: c.style,
      panels: (c.panels || []).map((p, i) => ({
        index: i, description: p.description, dialogue: p.dialogue,
        image_url: p.image_url,
      })),
    };
  } else if (type === 'avatar') {
    const a = db.getAvatarTask(id);
    if (a) item = {
      type: 'avatar', id: a.id, title: a.name || '\u6570\u5b57\u4eba\u89c6\u9891',
      username: userMap[a.user_id] || '\u672a\u77e5', status: a.status, created_at: a.created_at,
      text: a.text, voice: a.voice, provider: a.provider,
      avatar_url: a.avatar_url,
      video_url: a.video_url || a.output_url,
      duration: a.duration,
    };
  } else if (type === 'portrait') {
    const p = db.getPortrait(id);
    if (p) item = {
      type: 'portrait', id: p.id,
      title: p.name || p.character_name || '\u89d2\u8272\u5f62\u8c61',
      username: userMap[p.user_id] || '\u672a\u77e5', status: p.status, created_at: p.created_at,
      prompt: p.prompt, style: p.style, gender: p.gender, age: p.age,
      appearance: p.appearance, personality: p.personality,
      images: p.images || [],
      three_view: p.three_view,
    };
  }
  if (!item) return res.status(404).json({ success: false, error: '鍐呭涓嶅瓨鍦? '});
  res.json({ success: true, data: item });
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
// 銆恦11 鏂板銆戠粺涓€缂╃暐鍥剧鐐?
// 杩斿洖鍚勭被鍐呭鐨勭缉鐣ュ浘锛堝浘鐗囩洿鎺ヨ繑鍥烇紝瑙嗛鎻愬彇棣栧抚骞剁紦瀛橈級
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
router.get('/thumbnail/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');

    // 缂撳瓨鐩綍
    const CACHE_DIR = path.resolve(__dirname, '../../outputs/thumbnails');
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const cacheFile = path.join(CACHE_DIR, `${type}_${id}.jpg`);

    // 妫€鏌ョ紦瀛橈紙缂撳瓨 1 澶╋級
    if (fs.existsSync(cacheFile)) {
      const stat = fs.statSync(cacheFile);
      if (Date.now() - stat.mtimeMs < 86400000) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return fs.createReadStream(cacheFile).pipe(res);
      }
    }

    // 鏍规嵁绫诲瀷瑙ｆ瀽婧愭枃浠?
    let sourceFile = null;
    let sourceUrl = null;
    let isImage = false;

    if (type === 'project') {
      const project = db.getProject(id);
      if (!project) return res.status(404).json({ success: false, error: '椤圭洰涓嶅瓨鍦? '});
      // 1. 灏濊瘯 final_video
      const finalVideo = db.getFinalVideoByProject(id);
      if (finalVideo?.file_path && fs.existsSync(finalVideo.file_path)) {
        sourceFile = finalVideo.file_path;
      }
      // 2. 灏濊瘯 output_path / final_video_path
      if (!sourceFile && project.output_path && fs.existsSync(project.output_path)) {
        sourceFile = project.output_path;
      }
      if (!sourceFile && project.final_video_path && fs.existsSync(project.final_video_path)) {
        sourceFile = project.final_video_path;
      }
      // 3. 灏濊瘯 outputs/projects/:id_final.mp4
      if (!sourceFile) {
        const guess = path.resolve(__dirname, `../../outputs/projects/${id}_final.mp4`);
        if (fs.existsSync(guess)) sourceFile = guess;
      }
      // 4. 灏濊瘯绗竴涓?clip
      if (!sourceFile) {
        const clips = db.getClipsByProject(id);
        const firstClip = clips.find(c => c.file_path && fs.existsSync(c.file_path));
        if (firstClip) sourceFile = firstClip.file_path;
      }
    } else if (type === 'drama') {
      const drama = db.getDramaProject(id);
      if (!drama) return res.status(404).json({ success: false, error: '网剧不存在' });
      // 1. cover_url 鍙兘鏄?api 璺緞
      if (drama.cover_url) {
        // 妫€鏌ユ槸鍚︽槸 API 璺緞杩樻槸鏂囦欢璺緞
        if (drama.cover_url.startsWith('http') || drama.cover_url.startsWith('/')) {
          sourceUrl = drama.cover_url;
        } else if (fs.existsSync(drama.cover_url)) {
          sourceFile = drama.cover_url;
          isImage = /\.(jpg|png|webp|jpeg)$/i.test(drama.cover_url);
        }
      }
      // 2. 绗竴闆嗙殑绗竴涓満鏅殑 image_url
      if (!sourceFile && !sourceUrl) {
        const episodes = db.listDramaEpisodes(id);
        const firstEp = episodes.find(e => e.result?.scenes?.length);
        if (firstEp) {
          const firstScene = firstEp.result.scenes[0];
          if (firstScene.image_url) {
            sourceUrl = firstScene.image_url;
          }
        }
      }
    } else if (type === 'i2v') {
      const task = db.getI2VTask(id);
      if (!task) return res.status(404).json({ success: false, error: '浠诲姟涓嶅瓨鍦? '});
      if (task.image_path && fs.existsSync(task.image_path)) {
        sourceFile = task.image_path;
        isImage = true;
      }
    } else if (type === 'comic') {
      const comic = db.getComicTask(id);
      if (!comic) return res.status(404).json({ success: false, error: '漫画不存在' });
      const firstPanel = (comic.panels || []).find(p => p.image_url);
      if (firstPanel) {
        if (firstPanel.image_url.startsWith('/') || firstPanel.image_url.startsWith('http')) {
          sourceUrl = firstPanel.image_url;
        } else if (fs.existsSync(firstPanel.image_url)) {
          sourceFile = firstPanel.image_url;
          isImage = true;
        }
      }
    } else if (type === 'avatar') {
      const avatar = db.getAvatarTask(id);
      if (!avatar) return res.status(404).json({ success: false, error: '数字人不存在' });
      if (avatar.avatar_url) {
        sourceUrl = avatar.avatar_url;
      } else if (avatar.video_url || avatar.output_url) {
        sourceUrl = avatar.video_url || avatar.output_url;
      }
    } else if (type === 'portrait') {
      const portrait = db.getPortrait(id);
      if (!portrait) return res.status(404).json({ success: false, error: '瑙掕壊涓嶅瓨鍦? '});
      const images = portrait.images || [];
      if (images[0]) {
        if (typeof images[0] === 'string') {
          if (images[0].startsWith('/') || images[0].startsWith('http')) {
            sourceUrl = images[0];
          } else if (fs.existsSync(images[0])) {
            sourceFile = images[0];
            isImage = true;
          }
        }
      }
      if (!sourceFile && !sourceUrl && portrait.three_view?.front) {
        sourceUrl = portrait.three_view.front;
      }
    } else {
      return res.status(400).json({ success: false, error: '涓嶆敮鎸佺殑绫诲瀷: ' + type });
    }

    // 濡傛灉鏄?URL 鐩稿璺緞锛岄噸瀹氬悜杩囧幓
    if (sourceUrl) {
      if (sourceUrl.startsWith('/api/')) {
        return res.status(204).end();
      }
      // 淇濈暀 token 缁欑洰鏍囩鐐?
      const token = req.query.token || req.headers.authorization?.slice(7);
      const joiner = sourceUrl.includes('?') ? '&' : '?';
      return res.redirect(302, token ? `${sourceUrl}${joiner}token=${encodeURIComponent(token)}` : sourceUrl);
    }

    if (!sourceFile) {
      return res.status(204).end();
    }

    // 鍥剧墖婧愶細鐩存帴杩斿洖锛堝甫缂撳瓨锛?
    if (isImage) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(sourceFile).pipe(res);
    }

    // 瑙嗛婧愶細鐩存帴鐢?ffmpeg 鍛戒护琛屾彁鍙栭甯э紙涓嶈蛋 screenshots 閬垮紑 ffprobe 渚濊禆锛?
    const ffmpegPath = require('ffmpeg-static');
    const { spawn } = require('child_process');

    await new Promise((resolve, reject) => {
      // ffmpeg -ss 0.5 -i input.mp4 -frames:v 1 -q:v 3 -vf scale=480:-1 output.jpg
      const args = [
        '-ss', '0.5',                 // 璺冲埌 0.5s
        '-i', sourceFile,
        '-frames:v', '1',
        '-q:v', '3',                  // 璐ㄩ噺 (2-5 杈冨ソ)
        '-vf', 'scale=480:-1',        // 瀹?480锛岄珮鎸夋瘮渚?
        '-y',                          // 瑕嗙洊
        cacheFile,
      ];
      const ff = spawn(ffmpegPath, args, { windowsHide: true });
      let stderr = '';
      ff.stderr.on('data', d => stderr += d.toString());
      ff.on('error', reject);
      ff.on('close', (code) => {
        if (code === 0 && fs.existsSync(cacheFile)) resolve();
        else reject(new Error('ffmpeg exit ' + code + ': ' + stderr.slice(-300)));
      });
    });

    if (!fs.existsSync(cacheFile)) {
      return res.status(500).json({ success: false, error: '缩略图生成失败' });
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(cacheFile).pipe(res);
  } catch (e) {
    console.error('[Thumbnail] failed:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// 鍒犻櫎鍐呭
router.delete('/contents/:type/:id', (req, res) => {
  const { type, id } = req.params;
  try {
    if (type === 'novel')     db.deleteNovel(id);
    else if (type === 'project') db.deleteProject(id);
    else if (type === 'i2v')  db.deleteI2VTask(id);
    else if (type === 'drama') db.deleteDramaProject(id);
    else if (type === 'comic') db.deleteComicTask(id);
    else if (type === 'avatar') db.deleteAvatarTask(id);
    else if (type === 'portrait') db.deletePortrait(id);
    else return res.status(400).json({ success: false, error: '涓嶆敮鎸佺殑绫诲瀷: ' + type });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

function safeUser(u) {
  return {
    id: u.id, username: u.username, email: u.email,
    phone: u.phone || '',
    nickname: u.nickname || '',
    gender: u.gender || '',
    remark: u.remark || '',
    role: u.role, credits: u.credits, status: u.status,
    permissions: u.permissions || [],
    allowed_models: u.allowed_models || [],
    created_at: u.created_at, last_login: u.last_login,
    password_plain: u.password_plain || null
  };
}

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
// 鐭ヨ瘑搴擄紙鏁板瓧浜?/ 缃戝墽 / 鍒嗛暅 / 姘涘洿锛?
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
const kb = require('../services/knowledgeBaseService');
const { v4: uuidv4 } = require('uuid');

// 鍒楀嚭鍚堥泦鍏冧俊鎭?
router.get('/knowledgebase/collections', (req, res) => {
  res.json({ success: true, data: kb.listCollections() });
});

// 鍒楀嚭鍏ㄩ儴 agent 绫诲瀷锛堢粰 UI 鍔ㄦ€佹覆鏌?checkbox / 涓嬫媺妗嗙敤锛?
router.get('/knowledgebase/agent-types', (req, res) => {
  res.json({ success: true, data: kb.listAgentTypes() });
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
// 銆恦9 鏂板銆戣嚜瀹氫箟 Agent 绠＄悊 + 鑷姩瀛︿範
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?

// 鍒涘缓鑷畾涔?agent
router.post('/agents/custom', (req, res) => {
  try {
    const b = req.body || {};
    if (!b.id || !b.name) return res.status(400).json({ success: false, error: 'id 鍜?name 蹇呭～' });
    if (!/^[a-z][a-z0-9_]*$/.test(b.id)) {
      return res.status(400).json({ success: false, error: 'id 鍙兘鐢ㄥ皬鍐欏瓧姣?鏁板瓧/涓嬪垝绾匡紝涓斾互瀛楁瘝寮€澶? '});
    }
    // 妫€鏌ヤ笉涓庡唴缃?agent 鍐茬獊
    const builtin = kb.AGENT_TYPES.find(a => a.id === b.id);
    if (builtin) return res.status(409).json({ success: false, error: '涓庡唴缃?agent id 鍐茬獊: ' + b.id });

    const agent = {
      id: b.id,
      name: b.name,
      emoji: b.emoji || '馃',
      team: b.team === 'rd' ? 'rd' : 'ops',
      layer: b.layer || 'marketing',
      skills: Array.isArray(b.skills) ? b.skills : (b.skills || '').split(',').map(s => s.trim()).filter(Boolean),
      desc: b.desc || '',
      role_context: b.role_context || '',  // 鑷姩瀛︿範鏃?LLM 鍙傝€冪殑宀椾綅鑳屾櫙
    };
    kb.addCustomAgent(agent);
    res.json({ success: true, data: agent });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 鍒楀嚭鎵€鏈夎嚜瀹氫箟 agent
router.get('/agents/custom', (req, res) => {
  try {
    res.json({ success: true, data: kb.loadCustomAgents() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 鍒犻櫎鑷畾涔?agent
router.delete('/agents/custom/:id', (req, res) => {
  try {
    const { id } = req.params;
    const removed = kb.removeCustomAgent(id);
    if (!removed) return res.status(404).json({ success: false, error: 'agent 涓嶅瓨鍦? '});

    // 鍚屾椂娓呯悊杩欎釜 agent 鐨?KB 鏉＄洰锛坅uto-learned ones锛?
    const docs = db.listKnowledgeDocs();
    let cleaned = 0;
    docs.forEach(d => {
      if ((d.applies_to || []).length === 1 && d.applies_to[0] === id && d.source?.startsWith('auto-learned')) {
        db.deleteKnowledgeDoc(d.id);
        cleaned++;
      }
    });
    res.json({ success: true, data: { removed: true, cleaned_docs: cleaned } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 鑷姩瀛︿範锛氱敤 LLM 涓鸿繖涓?agent 鐢熸垚 5 鏉￠珮闃?KB 鏉＄洰
// 绛栫暐锛氬惊鐜皟鐢?5 娆★紝姣忔鐢熸垚 1 鏉★紙閬垮厤 max_tokens 鎴柇瀵艰嚧 JSON 瑙ｆ瀽澶辫触锛?
router.post('/agents/:id/learn', async (req, res) => {
  try {
    const { id } = req.params;
    const { callLLM } = require('../services/storyService');

    // 鍏堜粠鑷畾涔夋垨鍐呯疆鎵?agent
    let agent = kb.getCustomAgent(id);
    if (!agent) agent = kb.AGENT_TYPES.find(a => a.id === id);
    if (!agent) return res.status(404).json({ success: false, error: 'agent 涓嶅瓨鍦? '});

    // 鍐冲畾鐩爣鍚堥泦
    let targetCollection = 'production';
    if (agent.team === 'rd' || agent.layer === 'engineering') {
      targetCollection = 'engineering';
    } else if (agent.layer === 'creative' || agent.layer === 'production') {
      targetCollection = 'drama';
    } else {
      targetCollection = 'production';
    }

    // 5 涓笉鍚岃搴?
    const angles = [
      { slug: 'methodology', focus: '鏂规硶璁?/ 鏍稿績妗嗘灦', hint: '蹇呴』鏄郴缁熺殑鏂规硶璁猴紝鍚叕寮忋€佹楠ゃ€佸師鍒? '},
      { slug: 'tools', focus: '宸ュ叿閾?/ 鎶€鏈爤', hint: '鍏蜂綋宸ュ叿娓呭崟 + 瀵规瘮 + 鎺ㄨ崘閫夊瀷' },
      { slug: 'case_study', focus: '瀹炴垬妗堜緥 / 鏁版嵁鍒嗘瀽', hint: '鐪熷疄妗堜緥 + 鏁版嵁 + 澶嶇洏锛岃秺鍏蜂綋瓒婂ソ' },
      { slug: 'pitfalls', focus: '甯歌闄烽槺 / 绂佸繉', hint: '琛€鐨勬暀璁?+ 鍙嶉潰妗堜緥 + 涓轰粈涔堣閬垮厤' },
      { slug: 'advanced', focus: '杩涢樁鎶€宸?/ 楂橀樁鐜╂硶', hint: '椤剁骇浠庝笟鑰呮墠浼氱殑绉樻妧锛屼笉鏄熀纭€鐭ヨ瘑' },
    ];

    console.log(`[AutoLearn] Generating KB for agent: ${agent.id} (5 angles)`);
    const startTime = Date.now();
    const inserted = [];
    const errors = [];

    // 灏忓伐鍏凤細瀹芥澗 JSON 瑙ｆ瀽
    function parseJSON(raw) {
      let str = String(raw).trim();
      str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      const start = str.indexOf('{');
      const end = str.lastIndexOf('}');
      if (start === -1 || end <= start) return null;
      str = str.slice(start, end + 1);
      try { return JSON.parse(str); } catch {}
      // 灏濊瘯淇甯歌闂锛氭湯灏鹃€楀彿
      try { return JSON.parse(str.replace(/,(\s*[}\]])/g, '$1')); } catch {}
      return null;
    }

    // 寰幆鐢熸垚姣忔潯
    for (const angle of angles) {
      const systemPrompt = `浣犳槸琛屼笟椤剁骇涓撳锛屼负涓€鍚嶆柊鍏ヨ亴鐨?AI 鍥㈤槦鎴愬憳鐢熸垚 1 鏉¤涓氱骇楂橀樁鐭ヨ瘑銆?

銆愪弗鏍?JSON 杈撳嚭锛岀姝?markdown 浠ｇ爜鍧楋紝绂佹棰濆鏂囧瓧銆戯細
{
  "id": "kb_learn_${agent.id}_${angle.slug}",
  "subcategory": "瀛愬垎绫伙紙涓枃鐭瘝锛?,
  "title": "鍏蜂綋涓撲笟鐨勬爣棰橈紙涓嶈绗肩粺锛?,
  "summary": "涓€鍙ヨ瘽鎽樿锛?00 瀛楀唴锛?,
  "content": "姝ｆ枃锛?00-1200 瀛楋紝鍚皬鏍囬/鍒楄〃/绀轰緥/鏁版嵁/宸ュ叿锛?,
  "tags": ["3-5 涓爣绛?],
  "keywords": ["5-10 涓嫳鏂囧叧閿瘝"],
  "prompt_snippets": ["2-4 涓彲澶嶇敤鐨?prompt 鐗囨"]
}

銆愯搴﹁姹傘€?
鏈潯鐭ヨ瘑鑱氱劍浜? **${angle.focus}**
${angle.hint}

銆愭鏂囨牸寮忋€?
- 浣跨敤 Markdown 灏忔爣棰橈紙## / ###锛?
- 鍒楄〃鐢?- 鎴栨暟瀛?
- 浠ｇ爜/宸ュ叿鍚嶇敤鍙嶅紩鍙蜂絾**鍦?JSON 閲屽繀椤昏浆涔変负 \\"** 鎴栫洿鎺ュ啓鎴愭櫘閫氭枃瀛?
- 涓ョ鍦?JSON 瀛楃涓查噷鍑虹幇鏈浆涔夌殑鎹㈣绗︺€佸弽鏂滄潬銆佸紩鍙?
- 鎹㈣绗﹀啓浣?\\n锛堝湪 JSON 瀛楃涓查噷灏辨槸 \\\\n锛塦`;

      const userPrompt = `Agent: ${agent.emoji} ${agent.name} (${agent.id})
鍥㈤槦: ${agent.team === 'rd' ? '鐮斿彂' : '甯傚満杩愯惀'}
灞傜骇: ${agent.layer}
鎶€鑳? ${(agent.skills || []).join(' / ')}
鑱岃矗: ${agent.desc || '鏃?'}
${agent.role_context ? '鑳屾櫙: ' + agent.role_context : ''}

杈撳嚭鏈潯鐭ヨ瘑鐨?JSON銆俙`;

      try {
        const raw = await callLLM(systemPrompt, userPrompt, { agentId: 'project_assistant' });
        const d = parseJSON(raw);
        if (!d || !d.id || !d.title) {
          errors.push({ angle: angle.slug, error: 'JSON 瑙ｆ瀽澶辫触鎴栫己灏戝繀濉瓧娈? '});
          continue;
        }
        const doc = {
          id: d.id,
          collection: targetCollection,
          subcategory: d.subcategory || angle.focus,
          title: d.title,
          summary: d.summary || '',
          content: d.content || '',
          tags: Array.isArray(d.tags) ? d.tags : [],
          keywords: Array.isArray(d.keywords) ? d.keywords : [],
          prompt_snippets: Array.isArray(d.prompt_snippets) ? d.prompt_snippets : [],
          applies_to: [agent.id],
          source: `auto-learned for ${agent.id} / ${angle.slug} (${new Date().toISOString().slice(0, 10)})`,
          lang: 'zh',
          enabled: true,
          auto_learned: true,
        };
        if (!db.getKnowledgeDoc(doc.id)) {
          db.insertKnowledgeDoc(doc);
          inserted.push({ id: doc.id, title: doc.title, angle: angle.slug });
        }
      } catch (e) {
        errors.push({ angle: angle.slug, error: e.message });
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[AutoLearn] ${agent.id}: ${inserted.length}/${angles.length} docs in ${duration}ms`);

    res.json({
      success: true,
      data: {
        agent_id: agent.id,
        agent_name: agent.name,
        collection: targetCollection,
        inserted_count: inserted.length,
        inserted,
        errors,
        duration_ms: duration,
      },
    });
  } catch (e) {
    console.error('[AutoLearn] failed:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// 銆恦5 鏂板銆戞寜鍥㈤槦杩斿洖瀹屾暣 roster锛堝惈姣忎釜 agent 鐨勭煡璇嗙粺璁★級
router.get('/knowledgebase/teams', (req, res) => {
  const agents = kb.listAgentTypes();
  const teams = {
    rd: { id: 'rd', name: '\u7814\u53d1\u56e2\u961f', emoji: '\u2699', agents: [] },
    ops: { id: 'ops', name: '\u5e02\u573a\u8fd0\u8425\u56e2\u961f', emoji: '\u25c6', agents: [] },
  };
  for (const a of agents) {
    const stats = kb.getAgentStats(a.id);
    const t = teams[a.team] || teams.rd;
    t.agents.push({
      ...a,
      total_docs: stats.total_docs,
      by_collection: stats.by_collection,
    });
  }
  // 姣忛槦鍐呴儴鎸?layer 鎺掑簭
  const layerOrder = { creative: 1, production: 2, engineering: 3, strategy: 4, marketing: 5, orchestration: 6 };
  for (const k of Object.keys(teams)) {
    teams[k].agents.sort((a, b) => (layerOrder[a.layer] || 99) - (layerOrder[b.layer] || 99));
    teams[k].total_agents = teams[k].agents.length;
    teams[k].total_docs = teams[k].agents.reduce((s, a) => s + a.total_docs, 0);
  }
  res.json({ success: true, data: [teams.rd, teams.ops] });
});

// 銆恦5 鏂板銆慠AG 鍔ㄦ€佹绱?preview锛堣皟璇?searchForAgent 鐢級
router.get('/knowledgebase/_search/:agentType', (req, res) => {
  const { agentType } = req.params;
  const { q, limit } = req.query;
  if (!q) return res.status(400).json({ success: false, error: 'q 鍙傛暟蹇呭～' });
  const ctx = kb.searchForAgent(agentType, q, { limit: parseInt(limit) || 5 });
  res.json({ success: true, data: { agent_type: agentType, q, length: ctx.length, context: ctx } });
});

// 銆恦6 鏂板銆戞瘡鏃ュ涔?- 鎵嬪姩瑙﹀彂
router.post('/daily-learn/trigger', async (req, res) => {
  try {
    const dailyLearn = require('../services/dailyLearnService');
    const result = await dailyLearn.runDailyLearn({ manual: true });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 寮哄埗鍏ㄩ噺瀛︿範锛氳鎵€鏈?AI 鍥㈤槦鎴愬憳瀛︿範鍏ㄩ儴 KB 鐭ヨ瘑
router.post('/daily-learn/force-study', async (req, res) => {
  try {
    const dailyLearn = require('../services/dailyLearnService');
    const result = await dailyLearn.forceFullStudy();
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 銆恦6 鏂板銆戞瘡鏃ュ涔?- 鏌ョ湅鏈€杩?digest
router.get('/daily-learn/recent', (req, res) => {
  try {
    const dailyLearn = require('../services/dailyLearnService');
    const days = parseInt(req.query.days) || 3;
    const digests = dailyLearn.readRecentDigests(days);
    res.json({ success: true, data: digests });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 銆恦6 鏂板銆戠煡璇嗘簮鍒楄〃
router.get('/daily-learn/sources', (req, res) => {
  try {
    const sources = require('../services/knowledgeSources');
    res.json({ success: true, data: sources.listSources() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 銆恦7 鏂板銆戠粺涓€鏃ュ織鏍戯細鍒楀嚭 docs/logs/ 涓嬫墍鏈夋棩蹇?
router.get('/logs/tree', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const LOGS_ROOT = path.resolve(__dirname, '../../docs/logs');

    if (!fs.existsSync(LOGS_ROOT)) {
      return res.json({ success: true, data: { root: LOGS_ROOT, exists: false, categories: [] } });
    }

    const categories = [];
    const subdirs = ['sessions', 'changes', 'deployments', 'learning'];

    for (const cat of subdirs) {
      const catDir = path.join(LOGS_ROOT, cat);
      if (!fs.existsSync(catDir)) {
        categories.push({ id: cat, path: `docs/logs/${cat}`, exists: false, entries: [] });
        continue;
      }

      const entries = [];
      const items = fs.readdirSync(catDir).sort().reverse();

      for (const item of items) {
        const full = path.join(catDir, item);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          // e.g. learning/2026-04-11/
          const files = fs.readdirSync(full).map(f => ({
            name: f,
            path: `docs/logs/${cat}/${item}/${f}`,
            size: fs.statSync(path.join(full, f)).size,
          }));
          entries.push({
            name: item,
            type: 'directory',
            path: `docs/logs/${cat}/${item}`,
            files: files.length,
            file_list: files,
          });
        } else {
          entries.push({
            name: item,
            type: 'file',
            path: `docs/logs/${cat}/${item}`,
            size: stat.size,
            modified: stat.mtime.toISOString(),
          });
        }
      }

      categories.push({ id: cat, path: `docs/logs/${cat}`, exists: true, entries });
    }

    // 缁熻
    const stats = {
      total_sessions: categories.find(c => c.id === 'sessions')?.entries.length || 0,
      total_learning_days: categories.find(c => c.id === 'learning')?.entries.length || 0,
      total_changes: categories.find(c => c.id === 'changes')?.entries.length || 0,
      total_deployments: categories.find(c => c.id === 'deployments')?.entries.length || 0,
    };

    res.json({ success: true, data: { root: 'docs/logs/', exists: true, categories, stats } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
// 銆恦9 鏂板銆慏ashboard 鑱氬悎棣栭〉锛坴11 鍔犵紦瀛橈級
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
let _dashboardCache = { data: null, timestamp: 0 };
const DASHBOARD_CACHE_TTL = 30000;  // 30 绉掔紦瀛?

router.get('/dashboard', (req, res) => {
  // 缂撳瓨鍛戒腑鐩存帴杩斿洖
  const force = req.query.force === '1';
  if (!force && _dashboardCache.data && (Date.now() - _dashboardCache.timestamp < DASHBOARD_CACHE_TTL)) {
    res.setHeader('X-Cache', 'HIT');
    return res.json({ success: true, data: _dashboardCache.data, cached: true });
  }
  res.setHeader('X-Cache', 'MISS');
  try {
    const tracker = require('../services/tokenTracker');
    const { loadSettings } = require('../services/settingsService');

    // 鈥斺€斺€?鏃堕棿鍩哄噯 鈥斺€斺€?
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);
    const monthAgo = new Date(today.getTime() - 30 * 86400000);
    const quarterAgo = new Date(today.getTime() - 90 * 86400000);

    const inRange = (ts, from) => ts && new Date(ts) >= from;

    // 鈥斺€斺€?鐢ㄦ埛缁熻 鈥斺€斺€?
    const users = auth.getUsers();
    const userStats = {
      total: users.length,
      today: users.filter(u => inRange(u.created_at, today)).length,
      week: users.filter(u => inRange(u.created_at, weekAgo)).length,
      month: users.filter(u => inRange(u.created_at, monthAgo)).length,
      by_role: {},
      recent_signups: users
        .filter(u => u.created_at)
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, 5)
        .map(u => ({ id: u.id, username: u.username, role: u.role, created_at: u.created_at })),
    };
    users.forEach(u => {
      userStats.by_role[u.role] = (userStats.by_role[u.role] || 0) + 1;
    });

    // 鈥斺€斺€?鍐呭缁熻锛堝叏 7 绉嶆ā鍧楋級鈥斺€斺€?
    const contentStats = {};
    const contentListerMap = {
      project: 'listProjects',
      drama: 'listDramaProjects',
      i2v: 'listI2VTasks',
      novel: 'listNovels',
      comic: 'listComicTasks',
      avatar: 'listAvatarTasks',
      portrait: 'listPortraits',
    };
    const contentModules = CONTENT_MODULES
      .filter(m => m.id !== 'all' && contentListerMap[m.id])
      .map(m => ({ id: m.id, name: m.name, lister: contentListerMap[m.id] }));
    let totalContent = 0, todayContent = 0, weekContent = 0;
    for (const m of contentModules) {
      try {
        const list = db[m.lister]();
        const stats = {
          id: m.id,
          name: m.name,
          total: list.length,
          today: list.filter(x => inRange(x.created_at, today)).length,
          week: list.filter(x => inRange(x.created_at, weekAgo)).length,
          month: list.filter(x => inRange(x.created_at, monthAgo)).length,
        };
        contentStats[m.id] = stats;
        totalContent += stats.total;
        todayContent += stats.today;
        weekContent += stats.week;
      } catch {
        contentStats[m.id] = { id: m.id, name: m.name, total: 0, today: 0, week: 0, month: 0 };
      }
    }
    contentStats._total = { total: totalContent, today: todayContent, week: weekContent };

    // 鈥斺€斺€?妯″瀷缁熻锛堝凡鎺ュ叆鐨?providers/models锛夆€斺€斺€?
    let settings = null;
    try { settings = loadSettings(); } catch { settings = { providers: [] }; }
    const allProviders = settings.providers || [];
    const enabledProviders = allProviders.filter(p => p.enabled);
    let totalModels = 0, enabledModels = 0;
    const modelsByCategory = { story: 0, image: 0, video: 0, tts: 0, other: 0 };
    enabledProviders.forEach(p => {
      (p.models || []).forEach(m => {
        totalModels++;
        if (m.enabled !== false) enabledModels++;
        const use = m.use || 'other';
        modelsByCategory[use] = (modelsByCategory[use] || 0) + 1;
      });
    });
    const modelStats = {
      total_providers: allProviders.length,
      enabled_providers: enabledProviders.length,
      total_models: totalModels,
      enabled_models: enabledModels,
      by_category: modelsByCategory,
      provider_list: enabledProviders.map(p => ({
        id: p.id, name: p.name,
        model_count: (p.models || []).length,
        enabled: p.enabled,
      })),
    };

    // 鈥斺€斺€?Token 娑堣€楃粺璁?鈥斺€斺€?
    const allCalls = db.listTokenUsage();
    const sumCost = (list) => Number(list.reduce((s, r) => s + (r.cost_usd || 0), 0).toFixed(4));
    const sumTokens = (list) => list.reduce((s, r) => s + (r.total_tokens || 0), 0);
    const sumInputTokens = (list) => list.reduce((s, r) => s + (r.input_tokens || 0), 0);
    const sumOutputTokens = (list) => list.reduce((s, r) => s + (r.output_tokens || 0), 0);

    const todayCalls = allCalls.filter(c => inRange(c.timestamp, today));
    const weekCalls = allCalls.filter(c => inRange(c.timestamp, weekAgo));
    const monthCalls = allCalls.filter(c => inRange(c.timestamp, monthAgo));
    const quarterCalls = allCalls.filter(c => inRange(c.timestamp, quarterAgo));

    // 鎸夊搧绫伙紙llm/video/image/tts锛夋媶鍒?
    function bucketByCategory(list) {
      const buckets = { llm: { calls: 0, cost_usd: 0, tokens: 0, input_tokens: 0, output_tokens: 0 },
                        video: { calls: 0, cost_usd: 0, seconds: 0 },
                        image: { calls: 0, cost_usd: 0, count: 0 },
                        tts:   { calls: 0, cost_usd: 0, chars: 0 } };
      for (const r of list) {
        const c = r.category || 'llm';
        if (!buckets[c]) continue;
        buckets[c].calls++;
        buckets[c].cost_usd += r.cost_usd || 0;
        if (c === 'llm') {
          buckets.llm.tokens += r.total_tokens || 0;
          buckets.llm.input_tokens += r.input_tokens || 0;
          buckets.llm.output_tokens += r.output_tokens || 0;
        }
        if (c === 'video') buckets.video.seconds += r.video_seconds || 0;
        if (c === 'image') buckets.image.count   += r.image_count   || 0;
        if (c === 'tts')   buckets.tts.chars     += r.tts_chars     || 0;
      }
      Object.values(buckets).forEach(b => { b.cost_usd = Number(b.cost_usd.toFixed(4)); });
      return buckets;
    }

    // 鎴愬姛/澶辫触缁熻
    const successCount = allCalls.filter(r => r.status === 'success').length;
    const failCount = allCalls.filter(r => r.status === 'fail').length;
    const successRate = allCalls.length ? Number((successCount / allCalls.length * 100).toFixed(1)) : 100;

    const tokenStats = {
      total_calls: allCalls.length,
      total_tokens: sumTokens(allCalls),
      total_input_tokens: sumInputTokens(allCalls),
      total_output_tokens: sumOutputTokens(allCalls),
      total_cost_usd: sumCost(allCalls),
      success_count: successCount,
      fail_count: failCount,
      success_rate: successRate,
      today: {
        calls: todayCalls.length,
        tokens: sumTokens(todayCalls),
        input_tokens: sumInputTokens(todayCalls),
        output_tokens: sumOutputTokens(todayCalls),
        cost_usd: sumCost(todayCalls),
        by_category: bucketByCategory(todayCalls),
      },
      week: {
        calls: weekCalls.length,
        tokens: sumTokens(weekCalls),
        input_tokens: sumInputTokens(weekCalls),
        output_tokens: sumOutputTokens(weekCalls),
        cost_usd: sumCost(weekCalls),
        by_category: bucketByCategory(weekCalls),
      },
      month: {
        calls: monthCalls.length,
        tokens: sumTokens(monthCalls),
        input_tokens: sumInputTokens(monthCalls),
        output_tokens: sumOutputTokens(monthCalls),
        cost_usd: sumCost(monthCalls),
        by_category: bucketByCategory(monthCalls),
      },
      quarter: {
        calls: quarterCalls.length,
        tokens: sumTokens(quarterCalls),
        input_tokens: sumInputTokens(quarterCalls),
        output_tokens: sumOutputTokens(quarterCalls),
        cost_usd: sumCost(quarterCalls),
        by_category: bucketByCategory(quarterCalls),
      },
      total_by_category: bucketByCategory(allCalls),
    };

    // 鐢ㄦ埛娲昏穬搴︼紙鍩轰簬鏈€杩戠櫥褰曟椂闂达級
    const activeStats = {
      dau: users.filter(u => inRange(u.last_login, today)).length,
      wau: users.filter(u => inRange(u.last_login, weekAgo)).length,
      mau: users.filter(u => inRange(u.last_login, monthAgo)).length,
    };
    userStats.dau = activeStats.dau;
    userStats.wau = activeStats.wau;
    userStats.mau = activeStats.mau;

    // 鈥斺€斺€?鎸夌敤鎴锋秷鑰?Top 10 鈥斺€斺€?
    const byUser = {};
    allCalls.forEach(c => {
      const uid = c.user_id || 'unknown';
      if (!byUser[uid]) byUser[uid] = { user_id: uid, calls: 0, tokens: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
      byUser[uid].calls++;
      byUser[uid].tokens += c.total_tokens || 0;
      byUser[uid].input_tokens += c.input_tokens || 0;
      byUser[uid].output_tokens += c.output_tokens || 0;
      byUser[uid].cost_usd += c.cost_usd || 0;
    });
    const topUsers = Object.values(byUser)
      .map(u => {
        const uu = users.find(x => x.id === u.user_id);
        return {
          ...u,
          cost_usd: Number(u.cost_usd.toFixed(4)),
          username: uu?.username || (u.user_id === 'unknown' ? '(鏈櫥褰?绯荤粺)' : '(宸插垹闄?'),
        };
      })
      .sort((a, b) => b.cost_usd - a.cost_usd)
      .slice(0, 10);

    // 鈥斺€斺€?妯″瀷璋冪敤鎺掕锛堟棩/鏈?瀛ｏ級鏈€澶?+ 鏈€灏?鈥斺€斺€?
    function rankByModel(calls) {
      const byModel = {};
      calls.forEach(c => {
        const key = `${c.provider || '-'}/${c.model || '-'}`;
        if (!byModel[key]) byModel[key] = { key, provider: c.provider, model: c.model, calls: 0, tokens: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
        byModel[key].calls++;
        byModel[key].tokens += c.total_tokens || 0;
        byModel[key].input_tokens += c.input_tokens || 0;
        byModel[key].output_tokens += c.output_tokens || 0;
        byModel[key].cost_usd += c.cost_usd || 0;
      });
      const arr = Object.values(byModel).map(m => ({
        ...m,
        avg_input_tokens: m.calls ? Math.round(m.input_tokens / m.calls) : 0,
        avg_output_tokens: m.calls ? Math.round(m.output_tokens / m.calls) : 0,
        avg_total_tokens: m.calls ? Math.round(m.tokens / m.calls) : 0,
        cost_usd: Number(m.cost_usd.toFixed(4)),
      }));
      const sorted = arr.sort((a, b) => b.calls - a.calls);
      return {
        top: sorted.slice(0, 5),
        bottom: sorted.slice(-5).reverse(),
        total_models_used: arr.length,
      };
    }
    const modelRanking = {
      today: rankByModel(todayCalls),
      month: rankByModel(monthCalls),
      quarter: rankByModel(quarterCalls),
    };

    // 鈥斺€斺€?KB + Agents 姒傝 鈥斺€斺€?
    const kb = require('../services/knowledgeBaseService');
    const kbDocs = kb.listDocs();
    const agentTypes = kb.listAgentTypes();
    const knowledgeStats = {
      total_docs: kbDocs.length,
      total_agents: agentTypes.length,
      by_team: {
        rd: agentTypes.filter(a => a.team === 'rd').length,
        ops: agentTypes.filter(a => a.team === 'ops').length,
      },
      by_collection: kbDocs.reduce((acc, d) => {
        acc[d.collection] = (acc[d.collection] || 0) + 1;
        return acc;
      }, {}),
    };

    // 鈥斺€斺€?鏈嶅姟鍣ㄧ洃鎺?(绠€鍖? 鈥斺€斺€?
    let serverMetrics = null;
    try { serverMetrics = tracker.getServerMetrics(); } catch {}

    // CNY 姹囩巼锛圲SD鈫扖NY锛夋潵鑷?tokenTracker.budget
    const usdCnyRate = tracker.getUSDtoCNY();

    const dashboardData = {
      timestamp: now.toISOString(),
      users: userStats,
      content: contentStats,
      models: modelStats,
      tokens: tokenStats,
      top_users: topUsers,
      model_ranking: modelRanking,
      knowledge: knowledgeStats,
      server: serverMetrics,
      currency: { usd_cny_rate: usdCnyRate },
    };
    _dashboardCache = { data: dashboardData, timestamp: Date.now() };
    res.json({ success: true, data: dashboardData });
  } catch (e) {
    console.error('[Dashboard] failed:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
// 銆恦8 鏂板銆慣oken 浣跨敤缁熻 + 鏈嶅姟鍣ㄧ洃鎺?
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
const tracker = require('../services/tokenTracker');

function _modelLabelIndex() {
  try {
    const { loadSettings } = require('../services/settingsService');
    const settings = loadSettings();
    const providers = {};
    const models = {};
    (settings.providers || []).forEach(p => {
      providers[p.id] = p.name || p.id;
      (p.models || []).forEach(m => {
        models[`${p.id}::${m.id}`] = m.name || m.id;
      });
    });
    return { providers, models };
  } catch {
    return { providers: {}, models: {} };
  }
}

function _fallbackProviderName(id) {
  return ({
    topview: 'Topview AI',
    'aliyun-tts': '阿里云 CosyVoice',
    'aliyun-nls': '阿里云 NLS',
    deyunai: '漫路聚合',
    volcengine: '火山引擎',
    replicate: 'Replicate',
    deepseek: 'DeepSeek',
    dashscope: '阿里百炼',
    hifly: '飞影 Hifly',
    jimeng: '即梦',
  })[id] || id || '-';
}

function _fallbackModelName(id) {
  return ({
    'topview-product-avatar-v3': 'Topview Product Avatar V3',
    'topview-product-avatar-i2v': 'Topview Product Avatar Image2Video',
    'topview-m2v': 'Topview Marketing Video',
    'cosyvoice-v3.5-plus': 'CosyVoice 3.5 Plus',
    'cosyvoice-v3-flash': 'CosyVoice 3 Flash',
    'gpt-4o-mini': 'GPT-4o Mini',
    'nano-banana': 'Nano Banana',
    'nano-banana-pro': 'Nano Banana Pro',
  })[id] || id || '-';
}

function _enrichUsageRows(rows) {
  const idx = _modelLabelIndex();
  return (rows || []).map(r => {
    const keyProvider = r.provider || (typeof r.key === 'string' && r.key.includes('/') ? r.key.split('/')[0] : '');
    const keyModel = r.model || (typeof r.key === 'string' && r.key.includes('/') ? r.key.split('/').slice(1).join('/') : '');
    const providerName = idx.providers[keyProvider] || _fallbackProviderName(keyProvider);
    const modelName = idx.models[`${keyProvider}::${keyModel}`] || _fallbackModelName(keyModel);
    return {
      ...r,
      provider_name: providerName,
      model_name: modelName,
      vendor_label: providerName,
      model_label: modelName,
    };
  });
}

// 鎬昏 (榛樿鏈€杩?7 澶?
router.get('/token-stats/overview', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const stats = tracker.getStats({ days });
    stats.by_provider = _enrichUsageRows(stats.by_provider);
    stats.by_model = _enrichUsageRows(stats.by_model);
    stats.by_agent = _enrichUsageRows(stats.by_agent);
    const budget = tracker.getBudgetStatus();
    const alerts = tracker.checkAlerts();
    res.json({ success: true, data: { stats, budget, alerts } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 鎸?provider 鑱氬悎
router.get('/token-stats/by-provider', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const stats = tracker.getStats({ days });
    res.json({ success: true, data: _enrichUsageRows(stats.by_provider) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 鎸?model 鑱氬悎
router.get('/token-stats/by-model', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const stats = tracker.getStats({ days });
    res.json({ success: true, data: _enrichUsageRows(stats.by_model) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 鎸?agent 鑱氬悎
router.get('/token-stats/by-agent', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const stats = tracker.getStats({ days });
    res.json({ success: true, data: _enrichUsageRows(stats.by_agent) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 鎸夋棩鏈熻仛鍚?
router.get('/token-stats/by-day', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const stats = tracker.getStats({ days });
    res.json({ success: true, data: stats.by_day });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 鏈€杩?N 鏉¤皟鐢?
function _adminUsageDateBoundary(value, endOfDay = false) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const time = endOfDay ? '23:59:59.999' : '00:00:00.000';
    return new Date(`${text}T${time}+08:00`).toISOString();
  }
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

router.get('/token-stats/recent', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const result = tracker.listUsage({
      limit,
      offset,
      from: _adminUsageDateBoundary(req.query.from || req.query.date_from || req.query.start_date, false),
      to: _adminUsageDateBoundary(req.query.to || req.query.date_to || req.query.end_date, true),
      provider: String(req.query.provider || '').trim(),
      model: String(req.query.model || '').trim(),
      category: String(req.query.category || '').trim(),
      agent_id: String(req.query.agent_id || req.query.agent || '').trim(),
      status: String(req.query.status || '').trim(),
    });
    result.items = _enrichUsageRows(result.items);
    // 中文注释：兼容旧前端传 limit=50，同时给新前端返回 total/summary/facets 以支持按日期、厂商、模型查询全量记录。
    res.json({ success: true, data: req.query.format === 'page' ? result : result.items });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 鏈嶅姟鍣ㄧ洃鎺?
router.get('/token-stats/server', (req, res) => {
  try {
    res.json({ success: true, data: tracker.getServerMetrics() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 棰勭畻璇诲彇 / 璁剧疆
router.get('/token-stats/budget', (req, res) => {
  try {
    res.json({ success: true, data: tracker.getBudgetStatus() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put('/token-stats/budget', (req, res) => {
  try {
    const { monthly_budget_usd, alert_threshold, usd_cny_rate } = req.body || {};
    const budget = tracker.loadBudget();
    if (monthly_budget_usd !== undefined) budget.monthly_budget_usd = Number(monthly_budget_usd) || 0;
    if (alert_threshold !== undefined) budget.alert_threshold = Number(alert_threshold) || 0.8;
    if (usd_cny_rate !== undefined) {
      const r = Number(usd_cny_rate);
      if (r > 0 && r < 100) budget.usd_cny_rate = r;
    }
    tracker.saveBudget(budget);
    res.json({ success: true, data: tracker.getBudgetStatus() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 鍛婅
router.get('/token-stats/alerts', (req, res) => {
  try {
    res.json({ success: true, data: tracker.checkAlerts() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 瀹氫环琛?
router.get('/token-stats/pricing', (req, res) => {
  res.json({
    success: true,
    data: {
      llm: tracker.PRICING,
      video: tracker.VIDEO_PRICING,
      tts: tracker.TTS_PRICING,
      image: tracker.IMAGE_PRICING,
    },
  });
});

// 銆恦7 鏂板銆戣鍙栧崟涓棩蹇楁枃浠?
router.get('/logs/file', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const { file } = req.query;
    if (!file) return res.status(400).json({ success: false, error: 'file 鍙傛暟蹇呭～' });
    if (file.includes('..') || !file.startsWith('docs/logs/')) {
      return res.status(400).json({ success: false, error: '闈炴硶璺緞' });
    }
    const full = path.resolve(__dirname, '../..', file);
    if (!fs.existsSync(full)) return res.status(404).json({ success: false, error: '鏂囦欢涓嶅瓨鍦? '});
    const content = fs.readFileSync(full, 'utf8');
    res.json({ success: true, data: { file, content, size: content.length } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 鏂囨。鍒楄〃锛堟敮鎸佽繃婊? collection / subcategory / appliesTo / q锛?
router.get('/knowledgebase', (req, res) => {
  const { collection, subcategory, appliesTo, q } = req.query;
  const docs = kb.listDocs({ collection, subcategory, appliesTo, q });
  res.json({ success: true, data: docs, total: docs.length });
});

// 鏂囨。璇︽儏
router.get('/knowledgebase/_force', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const f = path.resolve(__dirname, '../../outputs/kb_force.json');
    let enabled = true;
    if (fs.existsSync(f)) {
      try { enabled = JSON.parse(fs.readFileSync(f, 'utf8')).enabled !== false; } catch {}
    }
    res.json({ success: true, data: { enabled } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put('/knowledgebase/_force', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const f = path.resolve(__dirname, '../../outputs/kb_force.json');
    const enabled = req.body?.enabled !== false;
    fs.writeFileSync(f, JSON.stringify({ enabled, updated_at: new Date().toISOString() }, null, 2), 'utf8');
    res.json({ success: true, data: { enabled } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 知识候选先审核、后入库。外部文章、会话摘要和手动粘贴共用同一条证据链。
router.get('/knowledgebase/candidates', (req, res) => {
  try {
    const service = require('../services/knowledgeCandidateService');
    res.json({
      success: true,
      data: service.listCandidates({ status: req.query.status, source_type: req.query.source_type, q: req.query.q }),
      stats: service.stats(),
    });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

router.post('/knowledgebase/candidates', (req, res) => {
  try {
    const service = require('../services/knowledgeCandidateService');
    const result = service.ingest({ ...(req.body || {}), source_type: req.body?.source_type || 'manual' });
    res.status(result.created ? 201 : 200).json({
      success: true,
      data: result.candidate,
      meta: { created: result.created, updated: result.updated, duplicate: result.duplicate },
    });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

router.post('/knowledgebase/candidates/:id/approve', (req, res) => {
  try {
    const service = require('../services/knowledgeCandidateService');
    const actor = req.user?.id || req.user?.username || 'admin';
    const result = service.approve(req.params.id, { ...(req.body || {}), reviewed_by: actor });
    res.json({ success: true, data: result.candidate, knowledge: result.document, meta: { created: result.created } });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

router.post('/knowledgebase/candidates/:id/reject', (req, res) => {
  try {
    const service = require('../services/knowledgeCandidateService');
    const actor = req.user?.id || req.user?.username || 'admin';
    const candidate = service.reject(req.params.id, { ...(req.body || {}), reviewed_by: actor });
    res.json({ success: true, data: candidate });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

router.get('/knowledgebase/:id', (req, res) => {
  const doc = kb.getDoc(req.params.id);
  if (!doc) return res.status(404).json({ success: false, error: '鏂囨。涓嶅瓨鍦? '});
  res.json({ success: true, data: doc });
});

// 鏂板缓
function runtimePolicyFromBody(body = {}) {
  if (!Object.prototype.hasOwnProperty.call(body, 'runtime_policy')) return undefined;
  if (body.runtime_policy === null) return null;
  return knowledgeRuleSchema.normalizeRuntimePolicy(body.runtime_policy);
}

router.post('/knowledgebase', (req, res) => {
  const b = req.body || {};
  if (!b.collection || !b.title) {
    return res.status(400).json({ success: false, error: 'collection 涓?title 蹇呭～' });
  }
  const allowed = ['digital_human', 'drama', 'storyboard', 'atmosphere', 'production', 'engineering'];
  if (!allowed.includes(b.collection)) {
    return res.status(400).json({ success: false, error: 'collection 蹇呴』鏄?' + allowed.join('/') });
  }
  let runtimePolicy;
  try { runtimePolicy = runtimePolicyFromBody(b); } catch (error) {
    return res.status(error.status || 422).json({ success: false, error: error.message, code: error.code || 'KNOWLEDGE_RUNTIME_POLICY_INVALID' });
  }
  const doc = {
    id: b.id || ('kb_' + uuidv4().slice(0, 8)),
    collection: b.collection,
    subcategory: b.subcategory || '',
    title: b.title,
    summary: b.summary || '',
    content: b.content || '',
    tags: Array.isArray(b.tags) ? b.tags : [],
    keywords: Array.isArray(b.keywords) ? b.keywords : [],
    prompt_snippets: Array.isArray(b.prompt_snippets) ? b.prompt_snippets : [],
    applies_to: Array.isArray(b.applies_to) ? b.applies_to : [],
    source: b.source || '',
    lang: b.lang || 'zh',
    enabled: b.enabled !== false,
    runtime_policy: runtimePolicy,
  };
  db.insertKnowledgeDoc(doc);
  try { require('../services/newStoryAd/knowledgePolicyCompilerService').clearCache(); } catch {}
  res.json({ success: true, data: doc });
});

// 鏇存柊
router.put('/knowledgebase/:id', (req, res) => {
  const existing = db.getKnowledgeDoc(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: '鏂囨。涓嶅瓨鍦? '});
  const b = req.body || {};
  let runtimePolicy;
  try { runtimePolicy = runtimePolicyFromBody(b); } catch (error) {
    return res.status(error.status || 422).json({ success: false, error: error.message, code: error.code || 'KNOWLEDGE_RUNTIME_POLICY_INVALID' });
  }
  const fields = {};
  ['collection', 'subcategory', 'title', 'summary', 'content', 'tags', 'keywords',
   'prompt_snippets', 'applies_to', 'source', 'lang', 'enabled', 'runtime_policy'].forEach(k => {
    if (b[k] !== undefined) fields[k] = b[k];
  });
  if (runtimePolicy !== undefined) fields.runtime_policy = runtimePolicy;
  db.updateKnowledgeDoc(req.params.id, fields);
  try { require('../services/newStoryAd/knowledgePolicyCompilerService').clearCache(); } catch {}
  res.json({ success: true, data: db.getKnowledgeDoc(req.params.id) });
});

// 鍒犻櫎
router.delete('/knowledgebase/:id', (req, res) => {
  const existing = db.getKnowledgeDoc(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: '鏂囨。涓嶅瓨鍦? '});
  db.deleteKnowledgeDoc(req.params.id);
  try { require('../services/newStoryAd/knowledgePolicyCompilerService').clearCache(); } catch {}
  res.json({ success: true });
});

// 棰勮 agent 涓婁笅鏂囷紙鐢ㄤ簬楠岃瘉娉ㄥ叆鍐呭锛?
router.get('/knowledgebase/_preview/:agentType', (req, res) => {
  const { agentType } = req.params;
  const { genre } = req.query;
  const ctx = kb.buildAgentContext(agentType, { genre });
  res.json({ success: true, data: { agent_type: agentType, genre: genre || null, context: ctx, length: ctx.length } });
});

// 閲嶆柊 seed锛堜粎鍦ㄦ枃妗ｄ负绌烘椂鍐欏叆锛屼笉浼氳鐩栧凡鏈夛級
router.post('/knowledgebase/_seed', (req, res) => {
  const r = kb.ensureSeeded();
  res.json({ success: true, data: r });
});

// 鎵归噺瀵煎叆鎻愮ず璇嶏紙椋炰功 wiki 绛夊閮ㄦ潵婧愮矘璐寸殑 markdown锛?
// body: { source, collection, applies_to:[], content }
// 鎸変簩绾ф爣棰?## 鑷姩鎷嗗垎涓哄鏉?KB锛涜嫢娌℃湁 ##锛屾暣娈典綔涓哄崟鏉?
router.post('/knowledgebase/import-prompts', (req, res) => {
  try {
    const { source = '椋炰功 wiki', collection = 'storyboard', applies_to = [], content = '' } = req.body || {};
    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, error: 'content 涓嶈兘涓虹┖' });
    }
    const allowed = ['digital_human', 'drama', 'storyboard', 'atmosphere', 'production', 'engineering'];
    if (!allowed.includes(collection)) {
      return res.status(400).json({ success: false, error: 'collection 蹇呴』鏄?' + allowed.join('/') });
    }
    const appliesArr = Array.isArray(applies_to) && applies_to.length
      ? applies_to
      : ['screenwriter', 'director', 'storyboard', 'atmosphere'];

    // 鎷嗗垎锛氭寜 \n## 鍒嗘锛堜繚鐣欓娈电殑"鍓嶈█"锛?
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const sections = [];
    let curTitle = null;
    let curBody = [];
    for (const line of lines) {
      const m = /^##\s+(.+)$/.exec(line.trim());
      if (m) {
        if (curTitle || curBody.join('').trim()) {
          sections.push({ title: curTitle || '鍓嶈█', body: curBody.join('\n').trim() });
        }
        curTitle = m[1].trim();
        curBody = [];
      } else {
        curBody.push(line);
      }
    }
    if (curTitle || curBody.join('').trim()) {
      sections.push({ title: curTitle || '椋炰功鎻愮ず璇?', body: curBody.join('\n').trim() });
    }
    const filtered = sections.filter(s => s.body.length > 0);
    if (filtered.length === 0) {
      return res.status(400).json({ success: false, error: '瑙ｆ瀽鍚庢病鏈夋湁鏁堝唴瀹癸紙璇锋鏌?markdown 鏍煎紡锛? '});
    }

    const inserted = [];
    for (const sec of filtered) {
      // 鎻愬彇鍏抽敭璇嶏細鍙栨爣棰?+ 鍐呭鍓?200 瀛椾腑鐨勪腑鏂囩煭璇?
      const head = (sec.title + ' ' + sec.body.slice(0, 200));
      const keywords = (head.match(/[\u4e00-\u9fa5]{2,8}/g) || []).slice(0, 12);
      // 鎻愬彇 prompt 鐗囨锛氬唴瀹归噷浠?- 鎴?1. 寮€澶寸殑琛岋紙鏈€澶?8 鏉★級
      const snips = (sec.body.match(/^[\s>]*[-*•]\s+(.+?)$/gm) || [])
        .map(s => s.replace(/^[\s>]*[-*•]\s+/, '').trim())
        .filter(s => s.length >= 4 && s.length <= 120)
        .slice(0, 8);
      const id = 'kb_feishu_' + uuidv4().slice(0, 8);
      const doc = {
        id,
        collection,
        subcategory: '鎻愮ず璇?',
        title: sec.title.slice(0, 80),
        summary: sec.body.slice(0, 160),
        content: sec.body.slice(0, 4000),
        tags: ['feishu', '鎻愮ず璇?', collection],
        keywords,
        prompt_snippets: snips,
        applies_to: appliesArr,
        source,
        lang: 'zh',
        enabled: true,
      };
      db.insertKnowledgeDoc(doc);
      inserted.push(doc);
    }
    res.json({ success: true, data: { inserted: inserted.length, ids: inserted.map(d => d.id) } });
  } catch (e) {
    console.error('[KB Import] failed:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// 寮哄埗浣跨敤 KB 鍏ㄥ眬寮€鍏筹紙钀界洏 outputs/kb_force.json锛?
router.get('/knowledgebase/_force', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const f = path.resolve(__dirname, '../../outputs/kb_force.json');
    let enabled = true;
    if (fs.existsSync(f)) {
      try { enabled = JSON.parse(fs.readFileSync(f, 'utf8')).enabled !== false; } catch {}
    }
    res.json({ success: true, data: { enabled } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put('/knowledgebase/_force', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const f = path.resolve(__dirname, '../../outputs/kb_force.json');
    const enabled = req.body?.enabled !== false;
    fs.writeFileSync(f, JSON.stringify({ enabled, updated_at: new Date().toISOString() }, null, 2), 'utf8');
    res.json({ success: true, data: { enabled } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
// API 鎺ュ彛璐﹀彿绠＄悊锛圓ppID/AppKey 瀵规帴璐﹀彿锛?
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
const apiCatalog = require('../services/apiCatalog');

router.get('/api-accounts', (req, res) => {
  const list = auth.listApiAccounts().map(a => ({
    ...a,
    app_secret_masked: a.app_secret ? a.app_secret.slice(0, 6) + '******' + a.app_secret.slice(-4) : '',
  }));
  res.json({ success: true, data: list });
});

router.get('/api-accounts/catalog', (req, res) => {
  res.json({ success: true, data: apiCatalog.listCatalog() });
});

// 杩斿洖鍙垎閰嶇粰鎺ュ彛璐﹀彿鐨?AI 妯″瀷鐩綍锛堟寜渚涘簲鍟嗗垎缁勶級
router.get('/api-accounts/model-catalog', (req, res) => {
  try {
    const { loadSettings } = require('../services/settingsService');
    const s = loadSettings();
    const USE_LABELS = { story: '剧情', image: '图片', video: '视频', tts: '语音', vlm: '视觉理解' };
    const groups = [];
    for (const p of (s.providers || [])) {
      if (p.enabled === false) continue;
      const models = (p.models || []).filter(m => m.enabled !== false);
      if (!models.length) continue;
      groups.push({
        provider_id: p.id,
        provider_name: p.name || p.id,
        items: models.map(m => ({
          key: `${p.id}::${m.id}`,
          model_id: m.id,
          label: m.name || m.id,
          use: m.use || '',
          use_label: USE_LABELS[m.use] || m.use || '',
        })),
      });
    }
    res.json({ success: true, data: groups });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/api-accounts/:id', (req, res) => {
  const acc = auth.getApiAccountById(req.params.id);
  if (!acc) return res.status(404).json({ success: false, error: '鎺ュ彛璐﹀彿涓嶅瓨鍦? '});
  res.json({ success: true, data: acc }); // 鍚畬鏁?app_secret锛屼粎 admin 鍙
});

router.post('/api-accounts', (req, res) => {
  const { name, allowed_apis = [], allowed_models = [], remark = '', credits = 0 } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ success: false, error: '璇峰～鍐欒处鍙峰悕绉? '});
  // 鏍￠獙 allowed_apis 鍏ㄩ兘瀛樺湪
  const known = new Set(apiCatalog.allKeys());
  const bad = (allowed_apis || []).filter(k => k !== '*' && !known.has(k));
  if (bad.length) return res.status(400).json({ success: false, error: '鏈煡鎺ュ彛 key: ' + bad.join(',') });
  const acc = auth.createApiAccount({ name: name.trim(), allowed_apis, allowed_models, remark, credits });
  res.json({ success: true, data: acc });
});

router.put('/api-accounts/:id', (req, res) => {
  const { name, allowed_apis, allowed_models, remark, status, credits } = req.body || {};
  const update = {};
  if (name !== undefined) update.name = String(name).trim();
  if (Array.isArray(allowed_apis)) {
    const known = new Set(apiCatalog.allKeys());
    const bad = allowed_apis.filter(k => k !== '*' && !known.has(k));
    if (bad.length) return res.status(400).json({ success: false, error: '鏈煡鎺ュ彛 key: ' + bad.join(',') });
    update.allowed_apis = allowed_apis;
  }
  if (Array.isArray(allowed_models)) update.allowed_models = allowed_models;
  if (remark !== undefined) update.remark = String(remark);
  if (status !== undefined && ['active', 'disabled'].includes(status)) update.status = status;
  if (credits !== undefined && Number.isFinite(Number(credits))) update.credits = Number(credits);
  const acc = auth.updateApiAccount(req.params.id, update);
  if (!acc) return res.status(404).json({ success: false, error: '鎺ュ彛璐﹀彿涓嶅瓨鍦? '});
  res.json({ success: true, data: acc });
});

router.post('/api-accounts/:id/rotate-secret', (req, res) => {
  const acc = auth.rotateApiSecret(req.params.id);
  if (!acc) return res.status(404).json({ success: false, error: '鎺ュ彛璐﹀彿涓嶅瓨鍦? '});
  res.json({ success: true, data: acc });
});

router.delete('/api-accounts/:id', (req, res) => {
  const ok = auth.deleteApiAccount(req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: '鎺ュ彛璐﹀彿涓嶅瓨鍦? '});
  res.json({ success: true });
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
// 鏁版嵁婧愮鐞嗭紙鐖嗘澶嶅埢 search providers锛夆€?杞彂鍒?radar
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
const searchProviders = require('../services/searchProviders');
router.get('/datasources', (req, res) => {
  try {
    const list = searchProviders.listProviders();
    const config = searchProviders.loadConfig();
    res.json({
      success: true,
      providers: list.map(p => ({ ...p, config: config.providers?.[p.id] || { enabled: false } })),
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.put('/datasources/:id', (req, res) => {
  try {
    const id = req.params.id;
    if (!searchProviders.getProvider(id)) return res.status(404).json({ success: false, error: 'provider 不存在' });
    const config = searchProviders.loadConfig();
    config.providers = config.providers || {};
    config.providers[id] = { ...(config.providers[id] || {}), ...req.body };
    searchProviders.saveConfig(config);
    res.json({ success: true, config: config.providers[id] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.post('/datasources/:id/health', async (req, res) => {
  try {
    const provider = searchProviders.getProvider(req.params.id);
    if (!provider) return res.status(404).json({ success: false, error: 'provider 不存在' });
    const config = searchProviders.loadConfig();
    const r = await provider.health(config.providers?.[req.params.id] || {});
    res.json({ success: true, health: r });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
// 妯″瀷璋冪敤绠＄悊锛圥ipeline Model Routing锛?
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
const pms = require('../services/pipelineModelService');

router.get('/pipeline-models', (req, res) => {
  try {
    const schema = pms.listSchema();
    const config = pms.loadConfig();
    // 鍒楀嚭姣忎釜 use 鐨勫彲鐢ㄦā鍨嬶紙璁╁墠绔?dropdown 閫夛級
    const availableByUse = {
      story: pms.listAvailableModels('story'),
      vlm:   pms.listAvailableModels('vlm'),
      image: pms.listAvailableModels('image'),
      video: pms.listAvailableModels('video'),
      tts:   pms.listAvailableModels('tts'),
      avatar: pms.listAvailableModels('avatar'),
    };
    const availableByStage = {};
    Object.values(schema).flat().forEach(stage => {
      if (pms.isNewStoryAdImageStage(stage.id)) {
        availableByStage[stage.id] = pms.listAvailableModelsForStage(stage.id);
      }
    });
    res.json({ success: true, schema, config: config.stages, available: availableByUse, available_by_stage: availableByStage, defaults: pms.listDefaults() });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.put('/pipeline-models/:stageId', async (req, res) => {
  try {
    const result = typeof pms.setStageConfigAsync === 'function'
      ? await pms.setStageConfigAsync(req.params.stageId, req.body.models || [], { live: true })
      : pms.setStageConfig(req.params.stageId, req.body.models || []);
    res.json({ success: true, models: result.models || result, rejected: result.rejected || [] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
