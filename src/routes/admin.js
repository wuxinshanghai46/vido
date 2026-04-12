const router = require('express').Router();
const { hashPassword } = require('../utils/crypto');
const auth = require('../models/authStore');
const db = require('../models/database');

// === 用户管理 ===
router.get('/users', (req, res) => {
  const users = auth.getUsers().map(safeUser);
  res.json({ success: true, data: users });
});

router.post('/users', (req, res) => {
  const { username, email, password, role, permissions, allowed_models } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: '用户名和密码必填' });
  if (auth.getUserByUsername(username)) return res.status(409).json({ success: false, error: '用户名已存在' });
  // role 必须是现存角色
  const roleObj = role ? auth.getRoleById(role) : auth.getRoleById('user');
  if (!roleObj) return res.status(400).json({ success: false, error: '角色不存在: ' + role });
  const { hash, salt } = hashPassword(password);
  const user = auth.createUser({
    username, email: email || '',
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
  const { role, status, allowed_models, email, permissions } = req.body;
  const updates = {};
  if (role !== undefined) {
    // role 必须是存在的角色
    const roleObj = auth.getRoleById(role);
    if (!roleObj) return res.status(400).json({ success: false, error: '角色不存在: ' + role });
    updates.role = role;
  }
  if (status !== undefined) updates.status = status;
  if (allowed_models !== undefined) updates.allowed_models = Array.isArray(allowed_models) ? allowed_models : [];
  if (permissions !== undefined) updates.permissions = Array.isArray(permissions) ? permissions : [];
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

// === 权限矩阵元数据 ===
// 前后端权限完全独立。平台矩阵为多操作列；企业矩阵仅单列"使用"。
const PERMISSION_MATRIX = {
  platform: {
    label: '平台角色',
    modules: [
      { id: 'users',    label: '用户管理', group: '访问控制' },
      { id: 'roles',    label: '角色管理', group: '访问控制' },
      { id: 'credits',  label: '积分管理', group: '计费'     },
      { id: 'contents', label: '内容管理', group: '运营'     },
      { id: 'ai',       label: 'AI 配置',  group: '系统'     },
      { id: 'aicap',    label: 'AI 能力',  group: '系统'     },
      { id: 'sync',     label: '数据同步', group: '系统'     },
      { id: 'system',   label: '系统设置', group: '系统'     },
    ],
    actions: [
      { id: 'view',   label: '查看' },
      { id: 'create', label: '创建' },
      { id: 'edit',   label: '编辑' },
      { id: 'delete', label: '删除' },
    ]
  },
  enterprise: {
    label: '用户角色',
    // 模块结构与前端侧边栏完全对齐（按分组呈现）
    modules: [
      // 创作中心
      { id: 'dashboard',  label: '创作中心',     group: '创作中心' },
      // 内容创作
      { id: 'aicanvas',   label: 'AI 画布',      group: '内容创作' },
      { id: 'create',     label: 'AI 视频',      group: '内容创作' },
      { id: 'avatar',     label: 'AI 数字人',    group: '内容创作' },
      { id: 'comic',      label: 'AI 漫画',      group: '内容创作' },
      { id: 'drama',      label: 'AI 网剧',      group: '内容创作' },
      { id: 'novel',      label: 'AI 小说',      group: '内容创作' },
      { id: 'workflow',   label: '工作流画布',   group: '内容创作' },
      // 工具
      { id: 'i2v',        label: '图生视频',     group: '工具' },
      { id: 'imggen',     label: 'AI 图片生成',  group: '工具' },
      // 爆款复刻
      { id: 'radar',      label: '素材获取',     group: '爆款复刻' },
      { id: 'monitor',    label: '素材库',       group: '爆款复刻' },
      { id: 'contentlib', label: '内容库',       group: '爆款复刻' },
      { id: 'workbench',  label: '声音克隆',     group: '爆款复刻' },
      { id: 'replicate',  label: '一键复刻',     group: '爆款复刻' },
      // 我的
      { id: 'works',      label: '我的作品',     group: '我的' },
      { id: 'projects',   label: '我的项目',     group: '我的' },
      { id: 'portrait',   label: '我的角色',     group: '我的' },
      { id: 'assets',     label: '素材库',       group: '我的' },
    ],
    // 与平台矩阵一致：查看/创建/编辑/删除 四列
    actions: [
      { id: 'view',   label: '查看' },
      { id: 'create', label: '创建' },
      { id: 'edit',   label: '编辑' },
      { id: 'delete', label: '删除' },
    ]
  }
};

router.get('/permissions-matrix', (req, res) => {
  const type = req.query.type === 'platform' ? 'platform' : req.query.type === 'enterprise' ? 'enterprise' : null;
  if (type) return res.json({ success: true, data: PERMISSION_MATRIX[type] });
  res.json({ success: true, data: PERMISSION_MATRIX });
});

// === 角色管理 ===
router.get('/roles', (req, res) => {
  const type = req.query.type;
  const users = auth.getUsers();
  let roles = auth.getRoles();
  if (type === 'platform' || type === 'enterprise') {
    roles = roles.filter(r => (r.type || 'enterprise') === type);
  }
  // 附加每个角色的用户数
  const data = roles.map(r => ({
    ...r,
    user_count: users.filter(u => u.role === r.id).length
  }));
  res.json({ success: true, data });
});

router.post('/roles', (req, res) => {
  const { id, label, type, description, permissions, default_credits, allowed_models, max_projects } = req.body;
  if (!id || !label) return res.status(400).json({ success: false, error: 'id 和 label 必填' });
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(id)) return res.status(400).json({ success: false, error: 'id 只允许字母、数字、下划线' });
  if (auth.getRoleById(id)) return res.status(409).json({ success: false, error: '角色 ID 已存在' });
  if (type && type !== 'platform' && type !== 'enterprise') {
    return res.status(400).json({ success: false, error: '非法 type' });
  }
  const role = auth.createRole({
    id, label, type: type || 'enterprise', description: description || '',
    permissions: permissions || [],
    default_credits: default_credits || 100,
    allowed_models: allowed_models || [],
    max_projects: max_projects || 10
  });
  res.json({ success: true, data: role });
});

router.put('/roles/:id', (req, res) => {
  const role = auth.getRoleById(req.params.id);
  if (!role) return res.status(404).json({ success: false, error: '角色不存在' });
  const { label, description, permissions, default_credits, allowed_models, max_projects } = req.body;
  const updates = {};
  if (label !== undefined) updates.label = label;
  if (description !== undefined) updates.description = description;
  if (permissions !== undefined) {
    // 过滤：平台角色不能持有 enterprise: 前缀权限，反之亦然
    const type = role.type || 'enterprise';
    const allowedPrefix = type + ':';
    updates.permissions = (permissions || []).filter(p => p === '*' || p.startsWith(allowedPrefix));
    // admin 内置角色永远保持 *
    if (role.id === 'admin') updates.permissions = ['*'];
  }
  if (default_credits !== undefined) updates.default_credits = default_credits;
  if (allowed_models !== undefined) updates.allowed_models = allowed_models;
  if (max_projects !== undefined) updates.max_projects = max_projects;
  const updated = auth.updateRole(req.params.id, updates);
  if (!updated) return res.status(404).json({ success: false, error: '角色不存在' });
  res.json({ success: true, data: updated });
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

// === 内容管理（v8 升级：覆盖全部内容模块）===

// 模块元信息（供前端渲染 tab）
const CONTENT_MODULES = [
  { id: 'all',       name: '全部',       emoji: '📦' },
  { id: 'project',   name: '视频项目',   emoji: '🎬' },
  { id: 'drama',     name: '网剧',       emoji: '📺' },
  { id: 'i2v',       name: '图生视频',   emoji: '🎥' },
  { id: 'novel',     name: '小说',       emoji: '📖' },
  { id: 'comic',     name: '漫画',       emoji: '🖼️' },
  { id: 'avatar',    name: '数字人',     emoji: '👤' },
  { id: 'portrait',  name: '角色形象',   emoji: '🎨' },
];

router.get('/contents/modules', (req, res) => {
  // 同时返回各模块的计数
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

  // v11: 统一用 /api/admin/thumbnail/:type/:id 作为缩略图来源
  // 这个端点会自动选最佳源（图片/视频首帧）并缓存
  const thumbUrl = (type, id) => `/api/admin/thumbnail/${type}/${id}`;

  // 项目（单视频）
  if (want('project')) {
    try {
      db.listProjects().forEach(p => {
        if (user_id && p.user_id !== user_id) return;
        // 检查是否有已生成的视频/clip
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
          title: p.title || p.prompt?.slice(0, 40) || '未命名项目',
          user_id: p.user_id, username: userMap[p.user_id] || '未知',
          status: p.status, created_at: p.created_at,
          detail: `${p.scene_count || '-'} 场景 · ${p.video_provider || 'demo'}`,
          thumbnail: hasVideo ? thumbUrl('project', p.id) : null,
          has_video: hasVideo,
        });
      });
    } catch {}
  }

  // 网剧项目
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
          title: p.title || p.synopsis?.slice(0, 40) || '未命名网剧',
          user_id: p.user_id, username: userMap[p.user_id] || '未知',
          status: p.status || '-', created_at: p.created_at,
          detail: `${episodeCount}/${p.episode_count || 0} 集 · ${p.style || ''}`,
          thumbnail: hasThumb ? thumbUrl('drama', p.id) : null,
          has_video: hasMedia,
        });
      });
    } catch {}
  }

  // 图生视频
  if (want('i2v')) {
    try {
      db.listI2VTasks().forEach(t => {
        if (user_id && t.user_id !== user_id) return;
        items.push({
          type: 'i2v', id: t.id,
          title: t.prompt?.slice(0, 40) || '图生视频',
          user_id: t.user_id, username: userMap[t.user_id] || '未知',
          status: t.status, created_at: t.created_at,
          detail: `${t.provider || ''} · ${t.model || ''}`,
          thumbnail: t.image_path ? thumbUrl('i2v', t.id) : null,
          has_video: t.status === 'completed',
        });
      });
    } catch {}
  }

  // 小说
  if (want('novel')) {
    try {
      db.listNovels().forEach(n => {
        if (user_id && n.user_id !== user_id) return;
        const totalWords = (n.chapters || []).reduce((s, c) => s + (c.word_count || 0), 0);
        items.push({
          type: 'novel', id: n.id, title: n.title || '未命名小说',
          user_id: n.user_id, username: userMap[n.user_id] || '未知',
          status: n.chapters?.length ? `${n.chapters.length} 章` : '空',
          created_at: n.created_at,
          detail: `${totalWords} 字 · ${n.genre || ''}`,
          thumbnail: null,
          has_content: n.chapters?.length > 0,
        });
      });
    } catch {}
  }

  // 漫画
  if (want('comic')) {
    try {
      db.listComicTasks().forEach(c => {
        if (user_id && c.user_id !== user_id) return;
        const hasPanels = (c.panels || []).length > 0 && c.panels.some(p => p.image_url);
        items.push({
          type: 'comic', id: c.id,
          title: c.title || c.theme?.slice(0, 40) || '未命名漫画',
          user_id: c.user_id, username: userMap[c.user_id] || '未知',
          status: c.status || '-', created_at: c.created_at,
          detail: `${(c.panels || []).length} 格 · ${c.style || ''}`,
          thumbnail: hasPanels ? thumbUrl('comic', c.id) : null,
          has_content: (c.panels || []).length > 0,
        });
      });
    } catch {}
  }

  // 数字人
  if (want('avatar')) {
    try {
      db.listAvatarTasks().forEach(a => {
        if (user_id && a.user_id !== user_id) return;
        const hasMedia = !!(a.avatar_url || a.video_url || a.output_url);
        items.push({
          type: 'avatar', id: a.id,
          title: a.name || a.text?.slice(0, 40) || '数字人视频',
          user_id: a.user_id, username: userMap[a.user_id] || '未知',
          status: a.status || '-', created_at: a.created_at,
          detail: `${a.provider || ''} · ${a.voice || ''}`,
          thumbnail: hasMedia ? thumbUrl('avatar', a.id) : null,
          has_video: a.status === 'completed' || a.status === 'done',
        });
      });
    } catch {}
  }

  // 角色形象（Portrait）
  if (want('portrait')) {
    try {
      db.listPortraits().forEach(p => {
        if (user_id && p.user_id !== user_id) return;
        const imgs = p.images || [];
        const hasImage = imgs.length > 0 || !!p.image_url || !!p.three_view?.front;
        items.push({
          type: 'portrait', id: p.id,
          title: p.name || p.character_name || p.prompt?.slice(0, 40) || '角色形象',
          user_id: p.user_id, username: userMap[p.user_id] || '未知',
          status: p.status || '-', created_at: p.created_at,
          detail: `${p.style || ''} · ${imgs.length} 张`,
          thumbnail: hasImage ? thumbUrl('portrait', p.id) : null,
          has_content: imgs.length > 0,
        });
      });
    } catch {}
  }

  // 按时间排序
  items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const total = items.length;
  items = items.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
  res.json({ success: true, data: { items, total } });
});

// 内容详情
router.get('/contents/:type/:id', (req, res) => {
  const { type, id } = req.params;
  const users = auth.getUsers();
  const userMap = {};
  users.forEach(u => { userMap[u.id] = u.username; });

  let item = null;
  if (type === 'project') {
    const p = db.getProject(id);
    if (p) item = {
      type: 'project', id: p.id, title: p.title || p.prompt?.slice(0, 60) || '未命名',
      username: userMap[p.user_id] || '未知', status: p.status, created_at: p.created_at,
      prompt: p.prompt, scene_count: p.scene_count, video_provider: p.video_provider,
      video_model: p.video_model, anim_style: p.anim_style,
      scenes: (p.scenes || []).map(s => ({ index: s.scene_index, description: s.description, visual_prompt: s.visual_prompt })),
      has_video: !!(p.output_path || p.final_video_path || db.getFinalVideoByProject(p.id)),
      stream_url: `/api/projects/${p.id}/stream`
    };
  } else if (type === 'i2v') {
    const t = db.getI2VTask(id);
    if (t) item = {
      type: 'i2v', id: t.id, title: t.prompt?.slice(0, 60) || '图生视频',
      username: userMap[t.user_id] || '未知', status: t.status, created_at: t.created_at,
      prompt: t.prompt, provider: t.provider, model: t.model,
      has_video: t.status === 'completed',
      stream_url: `/api/i2v/tasks/${t.id}/stream`,
      image_url: t.image_path ? `/api/i2v/images/${require('path').basename(t.image_path)}` : null
    };
  } else if (type === 'novel') {
    const n = db.getNovel(id);
    if (n) item = {
      type: 'novel', id: n.id, title: n.title, novel_type: n.novel_type,
      username: userMap[n.user_id] || '未知', status: n.status, created_at: n.created_at,
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
        type: 'drama', id: p.id, title: p.title || '未命名网剧',
        username: userMap[p.user_id] || '未知', status: p.status, created_at: p.created_at,
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
      type: 'comic', id: c.id, title: c.title || '未命名漫画',
      username: userMap[c.user_id] || '未知', status: c.status, created_at: c.created_at,
      theme: c.theme, style: c.style,
      panels: (c.panels || []).map((p, i) => ({
        index: i, description: p.description, dialogue: p.dialogue,
        image_url: p.image_url,
      })),
    };
  } else if (type === 'avatar') {
    const a = db.getAvatarTask(id);
    if (a) item = {
      type: 'avatar', id: a.id, title: a.name || '数字人视频',
      username: userMap[a.user_id] || '未知', status: a.status, created_at: a.created_at,
      text: a.text, voice: a.voice, provider: a.provider,
      avatar_url: a.avatar_url,
      video_url: a.video_url || a.output_url,
      duration: a.duration,
    };
  } else if (type === 'portrait') {
    const p = db.getPortrait(id);
    if (p) item = {
      type: 'portrait', id: p.id,
      title: p.name || p.character_name || '角色形象',
      username: userMap[p.user_id] || '未知', status: p.status, created_at: p.created_at,
      prompt: p.prompt, style: p.style, gender: p.gender, age: p.age,
      appearance: p.appearance, personality: p.personality,
      images: p.images || [],
      three_view: p.three_view,
    };
  }
  if (!item) return res.status(404).json({ success: false, error: '内容不存在' });
  res.json({ success: true, data: item });
});

// ═══════════════════════════════════════════════════
// 【v11 新增】统一缩略图端点
// 返回各类内容的缩略图（图片直接返回，视频提取首帧并缓存）
// ═══════════════════════════════════════════════════
router.get('/thumbnail/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');

    // 缓存目录
    const CACHE_DIR = path.resolve(__dirname, '../../outputs/thumbnails');
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const cacheFile = path.join(CACHE_DIR, `${type}_${id}.jpg`);

    // 检查缓存（缓存 1 天）
    if (fs.existsSync(cacheFile)) {
      const stat = fs.statSync(cacheFile);
      if (Date.now() - stat.mtimeMs < 86400000) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return fs.createReadStream(cacheFile).pipe(res);
      }
    }

    // 根据类型解析源文件
    let sourceFile = null;
    let sourceUrl = null;
    let isImage = false;

    if (type === 'project') {
      const project = db.getProject(id);
      if (!project) return res.status(404).json({ success: false, error: '项目不存在' });
      // 1. 尝试 final_video
      const finalVideo = db.getFinalVideoByProject(id);
      if (finalVideo?.file_path && fs.existsSync(finalVideo.file_path)) {
        sourceFile = finalVideo.file_path;
      }
      // 2. 尝试 output_path / final_video_path
      if (!sourceFile && project.output_path && fs.existsSync(project.output_path)) {
        sourceFile = project.output_path;
      }
      if (!sourceFile && project.final_video_path && fs.existsSync(project.final_video_path)) {
        sourceFile = project.final_video_path;
      }
      // 3. 尝试 outputs/projects/:id_final.mp4
      if (!sourceFile) {
        const guess = path.resolve(__dirname, `../../outputs/projects/${id}_final.mp4`);
        if (fs.existsSync(guess)) sourceFile = guess;
      }
      // 4. 尝试第一个 clip
      if (!sourceFile) {
        const clips = db.getClipsByProject(id);
        const firstClip = clips.find(c => c.file_path && fs.existsSync(c.file_path));
        if (firstClip) sourceFile = firstClip.file_path;
      }
    } else if (type === 'drama') {
      const drama = db.getDramaProject(id);
      if (!drama) return res.status(404).json({ success: false, error: '网剧不存在' });
      // 1. cover_url 可能是 api 路径
      if (drama.cover_url) {
        // 检查是否是 API 路径还是文件路径
        if (drama.cover_url.startsWith('http') || drama.cover_url.startsWith('/')) {
          sourceUrl = drama.cover_url;
        } else if (fs.existsSync(drama.cover_url)) {
          sourceFile = drama.cover_url;
          isImage = /\.(jpg|png|webp|jpeg)$/i.test(drama.cover_url);
        }
      }
      // 2. 第一集的第一个场景的 image_url
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
      if (!task) return res.status(404).json({ success: false, error: '任务不存在' });
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
      if (!portrait) return res.status(404).json({ success: false, error: '角色不存在' });
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
      return res.status(400).json({ success: false, error: '不支持的类型: ' + type });
    }

    // 如果是 URL 相对路径，重定向过去
    if (sourceUrl) {
      // 保留 token 给目标端点
      const token = req.query.token || req.headers.authorization?.slice(7);
      const joiner = sourceUrl.includes('?') ? '&' : '?';
      return res.redirect(302, token ? `${sourceUrl}${joiner}token=${encodeURIComponent(token)}` : sourceUrl);
    }

    if (!sourceFile) {
      return res.status(404).json({ success: false, error: '未找到可用的缩略图源' });
    }

    // 图片源：直接返回（带缓存）
    if (isImage) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(sourceFile).pipe(res);
    }

    // 视频源：直接用 ffmpeg 命令行提取首帧（不走 screenshots 避开 ffprobe 依赖）
    const ffmpegPath = require('ffmpeg-static');
    const { spawn } = require('child_process');

    await new Promise((resolve, reject) => {
      // ffmpeg -ss 0.5 -i input.mp4 -frames:v 1 -q:v 3 -vf scale=480:-1 output.jpg
      const args = [
        '-ss', '0.5',                 // 跳到 0.5s
        '-i', sourceFile,
        '-frames:v', '1',
        '-q:v', '3',                  // 质量 (2-5 较好)
        '-vf', 'scale=480:-1',        // 宽 480，高按比例
        '-y',                          // 覆盖
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

// 删除内容
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
    else return res.status(400).json({ success: false, error: '不支持的类型: ' + type });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

function safeUser(u) {
  return {
    id: u.id, username: u.username, email: u.email,
    role: u.role, credits: u.credits, status: u.status,
    permissions: u.permissions || [],
    allowed_models: u.allowed_models || [],
    created_at: u.created_at, last_login: u.last_login,
    password_plain: u.password_plain || null
  };
}

// ═══════════════════════════════════════════════════
// 知识库（数字人 / 网剧 / 分镜 / 氛围）
// ═══════════════════════════════════════════════════
const kb = require('../services/knowledgeBaseService');
const { v4: uuidv4 } = require('uuid');

// 列出合集元信息
router.get('/knowledgebase/collections', (req, res) => {
  res.json({ success: true, data: kb.listCollections() });
});

// 列出全部 agent 类型（给 UI 动态渲染 checkbox / 下拉框用）
router.get('/knowledgebase/agent-types', (req, res) => {
  res.json({ success: true, data: kb.listAgentTypes() });
});

// ═══════════════════════════════════════════════════
// 【v9 新增】自定义 Agent 管理 + 自动学习
// ═══════════════════════════════════════════════════

// 创建自定义 agent
router.post('/agents/custom', (req, res) => {
  try {
    const b = req.body || {};
    if (!b.id || !b.name) return res.status(400).json({ success: false, error: 'id 和 name 必填' });
    if (!/^[a-z][a-z0-9_]*$/.test(b.id)) {
      return res.status(400).json({ success: false, error: 'id 只能用小写字母/数字/下划线，且以字母开头' });
    }
    // 检查不与内置 agent 冲突
    const builtin = kb.AGENT_TYPES.find(a => a.id === b.id);
    if (builtin) return res.status(409).json({ success: false, error: '与内置 agent id 冲突: ' + b.id });

    const agent = {
      id: b.id,
      name: b.name,
      emoji: b.emoji || '🤖',
      team: b.team === 'rd' ? 'rd' : 'ops',
      layer: b.layer || 'marketing',
      skills: Array.isArray(b.skills) ? b.skills : (b.skills || '').split(',').map(s => s.trim()).filter(Boolean),
      desc: b.desc || '',
      role_context: b.role_context || '',  // 自动学习时 LLM 参考的岗位背景
    };
    kb.addCustomAgent(agent);
    res.json({ success: true, data: agent });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 列出所有自定义 agent
router.get('/agents/custom', (req, res) => {
  try {
    res.json({ success: true, data: kb.loadCustomAgents() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 删除自定义 agent
router.delete('/agents/custom/:id', (req, res) => {
  try {
    const { id } = req.params;
    const removed = kb.removeCustomAgent(id);
    if (!removed) return res.status(404).json({ success: false, error: 'agent 不存在' });

    // 同时清理这个 agent 的 KB 条目（auto-learned ones）
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

// 自动学习：用 LLM 为这个 agent 生成 5 条高阶 KB 条目
// 策略：循环调用 5 次，每次生成 1 条（避免 max_tokens 截断导致 JSON 解析失败）
router.post('/agents/:id/learn', async (req, res) => {
  try {
    const { id } = req.params;
    const { callLLM } = require('../services/storyService');

    // 先从自定义或内置找 agent
    let agent = kb.getCustomAgent(id);
    if (!agent) agent = kb.AGENT_TYPES.find(a => a.id === id);
    if (!agent) return res.status(404).json({ success: false, error: 'agent 不存在' });

    // 决定目标合集
    let targetCollection = 'production';
    if (agent.team === 'rd' || agent.layer === 'engineering') {
      targetCollection = 'engineering';
    } else if (agent.layer === 'creative' || agent.layer === 'production') {
      targetCollection = 'drama';
    } else {
      targetCollection = 'production';
    }

    // 5 个不同角度
    const angles = [
      { slug: 'methodology', focus: '方法论 / 核心框架', hint: '必须是系统的方法论，含公式、步骤、原则' },
      { slug: 'tools', focus: '工具链 / 技术栈', hint: '具体工具清单 + 对比 + 推荐选型' },
      { slug: 'case_study', focus: '实战案例 / 数据分析', hint: '真实案例 + 数据 + 复盘，越具体越好' },
      { slug: 'pitfalls', focus: '常见陷阱 / 禁忌', hint: '血的教训 + 反面案例 + 为什么要避免' },
      { slug: 'advanced', focus: '进阶技巧 / 高阶玩法', hint: '顶级从业者才会的秘技，不是基础知识' },
    ];

    console.log(`[AutoLearn] Generating KB for agent: ${agent.id} (5 angles)`);
    const startTime = Date.now();
    const inserted = [];
    const errors = [];

    // 小工具：宽松 JSON 解析
    function parseJSON(raw) {
      let str = String(raw).trim();
      str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      const start = str.indexOf('{');
      const end = str.lastIndexOf('}');
      if (start === -1 || end <= start) return null;
      str = str.slice(start, end + 1);
      try { return JSON.parse(str); } catch {}
      // 尝试修复常见问题：末尾逗号
      try { return JSON.parse(str.replace(/,(\s*[}\]])/g, '$1')); } catch {}
      return null;
    }

    // 循环生成每条
    for (const angle of angles) {
      const systemPrompt = `你是行业顶级专家，为一名新入职的 AI 团队成员生成 1 条行业级高阶知识。

【严格 JSON 输出，禁止 markdown 代码块，禁止额外文字】：
{
  "id": "kb_learn_${agent.id}_${angle.slug}",
  "subcategory": "子分类（中文短词）",
  "title": "具体专业的标题（不要笼统）",
  "summary": "一句话摘要（100 字内）",
  "content": "正文（600-1200 字，含小标题/列表/示例/数据/工具）",
  "tags": ["3-5 个标签"],
  "keywords": ["5-10 个英文关键词"],
  "prompt_snippets": ["2-4 个可复用的 prompt 片段"]
}

【角度要求】
本条知识聚焦于: **${angle.focus}**
${angle.hint}

【正文格式】
- 使用 Markdown 小标题（## / ###）
- 列表用 - 或数字
- 代码/工具名用反引号但**在 JSON 里必须转义为 \\"** 或直接写成普通文字
- 严禁在 JSON 字符串里出现未转义的换行符、反斜杠、引号
- 换行符写作 \\n（在 JSON 字符串里就是 \\\\n）`;

      const userPrompt = `Agent: ${agent.emoji} ${agent.name} (${agent.id})
团队: ${agent.team === 'rd' ? '研发' : '市场运营'}
层级: ${agent.layer}
技能: ${(agent.skills || []).join(' / ')}
职责: ${agent.desc || '无'}
${agent.role_context ? '背景: ' + agent.role_context : ''}

输出本条知识的 JSON。`;

      try {
        const raw = await callLLM(systemPrompt, userPrompt, { agentId: 'project_assistant' });
        const d = parseJSON(raw);
        if (!d || !d.id || !d.title) {
          errors.push({ angle: angle.slug, error: 'JSON 解析失败或缺少必填字段' });
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

// 【v5 新增】按团队返回完整 roster（含每个 agent 的知识统计）
router.get('/knowledgebase/teams', (req, res) => {
  const agents = kb.listAgentTypes();
  const teams = {
    rd: { id: 'rd', name: '研发团队', emoji: '🔬', agents: [] },
    ops: { id: 'ops', name: '市场运营团队', emoji: '📣', agents: [] },
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
  // 每队内部按 layer 排序
  const layerOrder = { creative: 1, production: 2, engineering: 3, strategy: 4, marketing: 5, orchestration: 6 };
  for (const k of Object.keys(teams)) {
    teams[k].agents.sort((a, b) => (layerOrder[a.layer] || 99) - (layerOrder[b.layer] || 99));
    teams[k].total_agents = teams[k].agents.length;
    teams[k].total_docs = teams[k].agents.reduce((s, a) => s + a.total_docs, 0);
  }
  res.json({ success: true, data: [teams.rd, teams.ops] });
});

// 【v5 新增】RAG 动态检索 preview（调试 searchForAgent 用）
router.get('/knowledgebase/_search/:agentType', (req, res) => {
  const { agentType } = req.params;
  const { q, limit } = req.query;
  if (!q) return res.status(400).json({ success: false, error: 'q 参数必填' });
  const ctx = kb.searchForAgent(agentType, q, { limit: parseInt(limit) || 5 });
  res.json({ success: true, data: { agent_type: agentType, q, length: ctx.length, context: ctx } });
});

// 【v6 新增】每日学习 - 手动触发
router.post('/daily-learn/trigger', async (req, res) => {
  try {
    const dailyLearn = require('../services/dailyLearnService');
    const result = await dailyLearn.runDailyLearn({ manual: true });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 【v6 新增】每日学习 - 查看最近 digest
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

// 【v6 新增】知识源列表
router.get('/daily-learn/sources', (req, res) => {
  try {
    const sources = require('../services/knowledgeSources');
    res.json({ success: true, data: sources.listSources() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 【v7 新增】统一日志树：列出 docs/logs/ 下所有日志
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

    // 统计
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

// ═══════════════════════════════════════════════════
// 【v9 新增】Dashboard 聚合首页（v11 加缓存）
// ═══════════════════════════════════════════════════
let _dashboardCache = { data: null, timestamp: 0 };
const DASHBOARD_CACHE_TTL = 30000;  // 30 秒缓存

router.get('/dashboard', (req, res) => {
  // 缓存命中直接返回
  const force = req.query.force === '1';
  if (!force && _dashboardCache.data && (Date.now() - _dashboardCache.timestamp < DASHBOARD_CACHE_TTL)) {
    res.setHeader('X-Cache', 'HIT');
    return res.json({ success: true, data: _dashboardCache.data, cached: true });
  }
  res.setHeader('X-Cache', 'MISS');
  try {
    const tracker = require('../services/tokenTracker');
    const { loadSettings } = require('../services/settingsService');

    // ——— 时间基准 ———
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);
    const monthAgo = new Date(today.getTime() - 30 * 86400000);
    const quarterAgo = new Date(today.getTime() - 90 * 86400000);

    const inRange = (ts, from) => ts && new Date(ts) >= from;

    // ——— 用户统计 ———
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

    // ——— 内容统计（全 7 种模块）———
    const contentStats = {};
    const contentModules = [
      { id: 'project',  name: '视频项目',  lister: 'listProjects' },
      { id: 'drama',    name: '网剧',      lister: 'listDramaProjects' },
      { id: 'i2v',      name: '图生视频',  lister: 'listI2VTasks' },
      { id: 'novel',    name: '小说',      lister: 'listNovels' },
      { id: 'comic',    name: '漫画',      lister: 'listComicTasks' },
      { id: 'avatar',   name: '数字人',    lister: 'listAvatarTasks' },
      { id: 'portrait', name: '角色形象',  lister: 'listPortraits' },
    ];
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

    // ——— 模型统计（已接入的 providers/models）———
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

    // ——— Token 消耗统计 ———
    const allCalls = db.listTokenUsage();
    const sumCost = (list) => Number(list.reduce((s, r) => s + (r.cost_usd || 0), 0).toFixed(4));
    const sumTokens = (list) => list.reduce((s, r) => s + (r.total_tokens || 0), 0);

    const todayCalls = allCalls.filter(c => inRange(c.timestamp, today));
    const weekCalls = allCalls.filter(c => inRange(c.timestamp, weekAgo));
    const monthCalls = allCalls.filter(c => inRange(c.timestamp, monthAgo));
    const quarterCalls = allCalls.filter(c => inRange(c.timestamp, quarterAgo));

    const tokenStats = {
      total_calls: allCalls.length,
      total_tokens: sumTokens(allCalls),
      total_cost_usd: sumCost(allCalls),
      today: {
        calls: todayCalls.length,
        tokens: sumTokens(todayCalls),
        cost_usd: sumCost(todayCalls),
      },
      week: {
        calls: weekCalls.length,
        tokens: sumTokens(weekCalls),
        cost_usd: sumCost(weekCalls),
      },
      month: {
        calls: monthCalls.length,
        tokens: sumTokens(monthCalls),
        cost_usd: sumCost(monthCalls),
      },
      quarter: {
        calls: quarterCalls.length,
        tokens: sumTokens(quarterCalls),
        cost_usd: sumCost(quarterCalls),
      },
    };

    // ——— 按用户消耗 Top 10 ———
    const byUser = {};
    allCalls.forEach(c => {
      const uid = c.user_id || 'unknown';
      if (!byUser[uid]) byUser[uid] = { user_id: uid, calls: 0, tokens: 0, cost_usd: 0 };
      byUser[uid].calls++;
      byUser[uid].tokens += c.total_tokens || 0;
      byUser[uid].cost_usd += c.cost_usd || 0;
    });
    const topUsers = Object.values(byUser)
      .map(u => {
        const uu = users.find(x => x.id === u.user_id);
        return {
          ...u,
          cost_usd: Number(u.cost_usd.toFixed(4)),
          username: uu?.username || (u.user_id === 'unknown' ? '(未登录/系统)' : '(已删除)'),
        };
      })
      .sort((a, b) => b.cost_usd - a.cost_usd)
      .slice(0, 10);

    // ——— 模型调用排行（日/月/季）最多 + 最少 ———
    function rankByModel(calls) {
      const byModel = {};
      calls.forEach(c => {
        const key = `${c.provider || '-'}/${c.model || '-'}`;
        if (!byModel[key]) byModel[key] = { key, provider: c.provider, model: c.model, calls: 0, tokens: 0, cost_usd: 0 };
        byModel[key].calls++;
        byModel[key].tokens += c.total_tokens || 0;
        byModel[key].cost_usd += c.cost_usd || 0;
      });
      const arr = Object.values(byModel).map(m => ({ ...m, cost_usd: Number(m.cost_usd.toFixed(4)) }));
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

    // ——— KB + Agents 概览 ———
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

    // ——— 服务器监控 (简化) ———
    let serverMetrics = null;
    try { serverMetrics = tracker.getServerMetrics(); } catch {}

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
    };
    _dashboardCache = { data: dashboardData, timestamp: Date.now() };
    res.json({ success: true, data: dashboardData });
  } catch (e) {
    console.error('[Dashboard] failed:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// 【v8 新增】Token 使用统计 + 服务器监控
// ═══════════════════════════════════════════════════
const tracker = require('../services/tokenTracker');

// 总览 (默认最近 7 天)
router.get('/token-stats/overview', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const stats = tracker.getStats({ days });
    const budget = tracker.getBudgetStatus();
    const alerts = tracker.checkAlerts();
    res.json({ success: true, data: { stats, budget, alerts } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 按 provider 聚合
router.get('/token-stats/by-provider', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const stats = tracker.getStats({ days });
    res.json({ success: true, data: stats.by_provider });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 按 model 聚合
router.get('/token-stats/by-model', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const stats = tracker.getStats({ days });
    res.json({ success: true, data: stats.by_model });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 按 agent 聚合
router.get('/token-stats/by-agent', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const stats = tracker.getStats({ days });
    res.json({ success: true, data: stats.by_agent });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 按日期聚合
router.get('/token-stats/by-day', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const stats = tracker.getStats({ days });
    res.json({ success: true, data: stats.by_day });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 最近 N 条调用
router.get('/token-stats/recent', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    res.json({ success: true, data: tracker.listRecent(limit) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 服务器监控
router.get('/token-stats/server', (req, res) => {
  try {
    res.json({ success: true, data: tracker.getServerMetrics() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 预算读取 / 设置
router.get('/token-stats/budget', (req, res) => {
  try {
    res.json({ success: true, data: tracker.getBudgetStatus() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put('/token-stats/budget', (req, res) => {
  try {
    const { monthly_budget_usd, alert_threshold } = req.body || {};
    const budget = tracker.loadBudget();
    if (monthly_budget_usd !== undefined) budget.monthly_budget_usd = Number(monthly_budget_usd) || 0;
    if (alert_threshold !== undefined) budget.alert_threshold = Number(alert_threshold) || 0.8;
    tracker.saveBudget(budget);
    res.json({ success: true, data: tracker.getBudgetStatus() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 告警
router.get('/token-stats/alerts', (req, res) => {
  try {
    res.json({ success: true, data: tracker.checkAlerts() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 定价表
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

// 【v7 新增】读取单个日志文件
router.get('/logs/file', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const { file } = req.query;
    if (!file) return res.status(400).json({ success: false, error: 'file 参数必填' });
    if (file.includes('..') || !file.startsWith('docs/logs/')) {
      return res.status(400).json({ success: false, error: '非法路径' });
    }
    const full = path.resolve(__dirname, '../..', file);
    if (!fs.existsSync(full)) return res.status(404).json({ success: false, error: '文件不存在' });
    const content = fs.readFileSync(full, 'utf8');
    res.json({ success: true, data: { file, content, size: content.length } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 文档列表（支持过滤: collection / subcategory / appliesTo / q）
router.get('/knowledgebase', (req, res) => {
  const { collection, subcategory, appliesTo, q } = req.query;
  const docs = kb.listDocs({ collection, subcategory, appliesTo, q });
  res.json({ success: true, data: docs, total: docs.length });
});

// 文档详情
router.get('/knowledgebase/:id', (req, res) => {
  const doc = kb.getDoc(req.params.id);
  if (!doc) return res.status(404).json({ success: false, error: '文档不存在' });
  res.json({ success: true, data: doc });
});

// 新建
router.post('/knowledgebase', (req, res) => {
  const b = req.body || {};
  if (!b.collection || !b.title) {
    return res.status(400).json({ success: false, error: 'collection 与 title 必填' });
  }
  const allowed = ['digital_human', 'drama', 'storyboard', 'atmosphere', 'production', 'engineering'];
  if (!allowed.includes(b.collection)) {
    return res.status(400).json({ success: false, error: 'collection 必须是 ' + allowed.join('/') });
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
  };
  db.insertKnowledgeDoc(doc);
  res.json({ success: true, data: doc });
});

// 更新
router.put('/knowledgebase/:id', (req, res) => {
  const existing = db.getKnowledgeDoc(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: '文档不存在' });
  const b = req.body || {};
  const fields = {};
  ['collection', 'subcategory', 'title', 'summary', 'content', 'tags', 'keywords',
   'prompt_snippets', 'applies_to', 'source', 'lang', 'enabled'].forEach(k => {
    if (b[k] !== undefined) fields[k] = b[k];
  });
  db.updateKnowledgeDoc(req.params.id, fields);
  res.json({ success: true, data: db.getKnowledgeDoc(req.params.id) });
});

// 删除
router.delete('/knowledgebase/:id', (req, res) => {
  const existing = db.getKnowledgeDoc(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: '文档不存在' });
  db.deleteKnowledgeDoc(req.params.id);
  res.json({ success: true });
});

// 预览 agent 上下文（用于验证注入内容）
router.get('/knowledgebase/_preview/:agentType', (req, res) => {
  const { agentType } = req.params;
  const { genre } = req.query;
  const ctx = kb.buildAgentContext(agentType, { genre });
  res.json({ success: true, data: { agent_type: agentType, genre: genre || null, context: ctx, length: ctx.length } });
});

// 重新 seed（仅在文档为空时写入，不会覆盖已有）
router.post('/knowledgebase/_seed', (req, res) => {
  const r = kb.ensureSeeded();
  res.json({ success: true, data: r });
});

module.exports = router;
