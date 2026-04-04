'use strict';

let currentProjectId = null;
let currentSSE = null;
let creationMode = 'ai';
let videoDuration = 60;
let animStyle = 'anime';
let aspectRatio = '16:9';
let characters = [];
let customScenes = [];
let charIdCounter = 0;
let sceneIdCounter = 0;
let musicFilePath = null;
let musicOriginalName = null;
let musicDuration = 0;    // 音乐总时长（秒）
let musicTrimStart = 0;   // 裁剪起点（秒）
let musicTrimEnd = 0;     // 裁剪终点（秒）
let sceneDim = '2d';
let charDim = '2d';
let contentType = '2d';
let voiceEnabled = false;
let voiceGender = 'female';
let selectedVoiceId = null;
let allVoices = [];
let voiceFilter = 'all';
let voiceSpeed = 1.0;
let subtitleEnabled = true;
let subtitleSize = 32;
let subtitlePosition = 'bottom';
let subtitleColor = 'white';
let selectedVideoProvider = null;
let selectedVideoModelId = null;
let videoModelsCache = null;
let _disabledModelsCache = null;
let completedClips = {}; // { sceneIndex: { clipId, sceneTitle } }

// ═══ 长篇动画模式 ═══
let episodeCount = 5;
let episodeIndex = 1;
let previousSummary = '';
let episodeSummaries = {}; // {1: 'summary text', 2: ...}
let motionCatalogCache = null;

// ═══ 动画风格（影响视频模型 prompt + negative prompt） ═══
const ANIM_STYLES = [
  { id: 'anime',     label: '日系动漫',  icon: '🎌', color: '#c06af0', desc: '赛璐璐上色，干净线条' },
  { id: 'realistic', label: '电影写实',  icon: '🎬', color: '#7888d8', desc: '高清实拍，电影质感' },
  { id: '3dcg',      label: '3D动画',    icon: '🌐', color: '#c4a535', desc: '三维渲染，CG 光影' },
  { id: 'concept',   label: '概念画',    icon: '🖼', color: '#e08040', desc: '半写实CG插画，史诗感' },
  { id: 'battle',    label: '史诗战斗',  icon: '⚔',  color: '#ff4444', desc: '战斗特化，火焰粒子爆炸' },
  { id: 'ink',       label: '水墨国风',  icon: '🖌', color: '#d4a020', desc: '泼墨写意，古典意境' },
  { id: 'cyberpunk', label: '赛博朋克',  icon: '⚡', color: '#00d4ff', desc: '霓虹灯光，暗色未来' },
  { id: 'ghibli',    label: '吉卜力',    icon: '🌿', color: '#6ac060', desc: '水彩田园，温暖治愈' },
  // ── 中国国风动画（长篇剧情专用） ──
  { id: 'xianxia',    label: '仙侠修真', icon: '🏔', color: '#8B5CF6', desc: '仙界飘渺，修仙飞升，完美世界风' },
  { id: 'wuxia',      label: '武侠江湖', icon: '⚔',  color: '#DC2626', desc: '刀光剑影，快意恩仇，斗破苍穹风' },
  { id: 'guoman',     label: '国漫新潮', icon: '🐲', color: '#F59E0B', desc: '高品质国漫，凡人修仙传风格' },
  { id: 'guofeng_3d', label: '3D国风',   icon: '🏯', color: '#10B981', desc: '3D高精度国风渲染，完美世界风' },
  { id: 'ink_battle', label: '水墨战斗', icon: '🖌', color: '#78350F', desc: '水墨画风+动态打斗特效' },
];

// 角色类型系统
const CHAR_TYPES = {
  human:   { label: '人物', race: '人', gender: 'female', descPh: '外貌特征、性格气质、背景故事...' },
  animal:  { label: '动物', race: '动物', gender: 'none', descPh: '体型、毛色、花纹、特征...' },
  mythical:{ label: '神话生物', race: '神兽', gender: 'none', descPh: '形态、灵气、鳞甲、光效...' },
  alien:   { label: '外星生物', race: '外星', gender: 'none', descPh: '肤色、肢体结构、特殊器官...' },
  robot:   { label: '机器人', race: '机器人', gender: 'none', descPh: '材质、发光元件、武器装甲...' },
  monster: { label: '怪物', race: '怪兽', gender: 'none', descPh: '血肉、鳞片、触角、武器...' },
};

// 动物品种数据
const ANIMAL_BREEDS = {
  '宠物':     [{icon:'🐱',n:'猫'},{icon:'🐕',n:'狗'},{icon:'🐰',n:'兔子'},{icon:'🐹',n:'仓鼠'},{icon:'🐦',n:'鹦鹉'},{icon:'🐟',n:'金鱼'},{icon:'🐢',n:'乌龟'}],
  '野生动物': [{icon:'🦁',n:'狮子'},{icon:'🐯',n:'老虎'},{icon:'🐺',n:'狼'},{icon:'🦊',n:'狐狸'},{icon:'🐻',n:'熊'},{icon:'🐘',n:'大象'},{icon:'🦌',n:'鹿'},{icon:'🐒',n:'猴子'}],
  '鸟类':     [{icon:'🦅',n:'鹰'},{icon:'🦉',n:'猫头鹰'},{icon:'🦚',n:'孔雀'},{icon:'🐧',n:'企鹅'},{icon:'🦢',n:'天鹅'},{icon:'🦜',n:'鹦鹉'},{icon:'🕊',n:'鸽子'}],
  '海洋生物': [{icon:'🐬',n:'海豚'},{icon:'🦈',n:'鲨鱼'},{icon:'🐙',n:'章鱼'},{icon:'🐋',n:'鲸鱼'},{icon:'🦑',n:'鱿鱼'},{icon:'🐠',n:'热带鱼'},{icon:'🦀',n:'螃蟹'}],
  '爬行动物': [{icon:'🐊',n:'鳄鱼'},{icon:'🦎',n:'蜥蜴'},{icon:'🐍',n:'蛇'},{icon:'🐢',n:'龟'},{icon:'🦕',n:'恐龙'}],
  '昆虫':     [{icon:'🦋',n:'蝴蝶'},{icon:'🐝',n:'蜜蜂'},{icon:'🐞',n:'瓢虫'},{icon:'🦗',n:'蟋蟀'},{icon:'🕷',n:'蜘蛛'},{icon:'🦂',n:'蝎子'}],
  '家禽家畜': [{icon:'🐔',n:'鸡'},{icon:'🐷',n:'猪'},{icon:'🐄',n:'牛'},{icon:'🐴',n:'马'},{icon:'🐑',n:'羊'},{icon:'🐐',n:'山羊'}],
};

// 神话生物数据
const MYTH_BREEDS = {
  '中国神话': [{icon:'🐉',n:'龙'},{icon:'🦊',n:'九尾狐'},{icon:'🔥',n:'凤凰'},{icon:'🐢',n:'玄武'},{icon:'🐯',n:'白虎'},{icon:'🦌',n:'麒麟'},{icon:'🐒',n:'孙悟空'}],
  '日本神话': [{icon:'🦊',n:'九尾狐'},{icon:'🐉',n:'八岐大蛇'},{icon:'👹',n:'天狗'},{icon:'🐱',n:'猫又'},{icon:'🐸',n:'河童'},{icon:'👻',n:'百鬼'}],
  '西方神话': [{icon:'🐉',n:'巨龙'},{icon:'🦄',n:'独角兽'},{icon:'🦅',n:'格里芬'},{icon:'🔥',n:'凤凰'},{icon:'🐍',n:'九头蛇'},{icon:'🧜',n:'美人鱼'},{icon:'🏇',n:'天马'}],
  '北欧神话': [{icon:'🐺',n:'芬里尔'},{icon:'🐍',n:'耶梦加得'},{icon:'🦅',n:'尼德霍格'},{icon:'🐴',n:'斯莱普尼尔'},{icon:'🦌',n:'赫德伦'}],
  '埃及神话': [{icon:'🐱',n:'巴斯特猫'},{icon:'🦅',n:'荷鲁斯鹰'},{icon:'🐍',n:'阿佩普蛇'},{icon:'🐺',n:'阿努比斯'},{icon:'🦂',n:'塞尔凯特蝎'}],
  '印度神话': [{icon:'🐘',n:'伽内什象'},{icon:'🐒',n:'哈努曼猴'},{icon:'🐍',n:'那伽蛇'},{icon:'🦅',n:'迦楼罗鸟'},{icon:'🐄',n:'难陀牛'}],
};

// 怪物数据
const MONSTER_BREEDS = {
  '丧尸':   [{icon:'🧟',n:'行尸'},{icon:'💀',n:'骷髅兵'},{icon:'🧟',n:'尸王'},{icon:'🦠',n:'感染者'}],
  '变异体': [{icon:'🧬',n:'变异兽'},{icon:'🕷',n:'巨蛛'},{icon:'🦎',n:'蜥蜴人'},{icon:'🐛',n:'虫巢母'}],
  '暗影':   [{icon:'👤',n:'影魔'},{icon:'👁',n:'噩梦'},{icon:'🌑',n:'虚空行者'},{icon:'💨',n:'幽灵'}],
  '巨兽':   [{icon:'🦕',n:'泰坦巨兽'},{icon:'🐙',n:'克拉肯'},{icon:'🐛',n:'沙虫'},{icon:'🦖',n:'远古巨龙'}],
  '恶魔':   [{icon:'👹',n:'恶魔领主'},{icon:'😈',n:'小恶魔'},{icon:'🔥',n:'炎魔'},{icon:'❄',n:'冰魔'}],
  '亡灵':   [{icon:'💀',n:'巫妖'},{icon:'🧛',n:'吸血鬼'},{icon:'👻',n:'幽灵'},{icon:'⚰',n:'死灵骑士'}],
  '寄生体': [{icon:'🦠',n:'寄生虫'},{icon:'🧫',n:'感染体'},{icon:'🕸',n:'共生体'},{icon:'🫠',n:'史莱姆'}],
};

const ANIMAL_RACES = ['动物','宠物','神兽','怪兽'];

let studioTab = 'script';
let studioSelectedCharId = null;
let studioSelectedSceneId = null;
let studioTlZoom = 4;
let loadingCharIds = new Set();

// ═══ 主题切换 ═══
function switchTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('vido-theme', theme);
  document.querySelectorAll('.theme-dot').forEach(d => d.classList.toggle('active', d.dataset.theme === theme));
  // 保存到后端（用户偏好）
  authFetch('/api/user/theme', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme }) }).catch(() => {});
  // 关闭面板
  const panel = document.getElementById('theme-panel');
  if (panel) panel.style.display = 'none';
}

function toggleThemePanel() {
  const panel = document.getElementById('theme-panel');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

// 点击面板外关闭
document.addEventListener('click', e => {
  const panel = document.getElementById('theme-panel');
  const toggle = document.getElementById('theme-mode-toggle');
  if (panel && panel.style.display !== 'none' && !panel.contains(e.target) && !toggle?.contains(e.target)) {
    panel.style.display = 'none';
  }
});

function loadTheme() {
  const saved = localStorage.getItem('vido-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
    document.querySelectorAll('.theme-dot').forEach(d => d.classList.toggle('active', d.dataset.theme === saved));
  }
  // 从后端同步（登录后）
  authFetch('/api/user/theme').then(r => r.json()).then(data => {
    if (data.success && data.theme && data.theme !== saved) {
      switchTheme(data.theme);
    }
  }).catch(() => {});
}

// ═══ 用户菜单 ═══
function toggleUserMenu() {
  const dd = document.getElementById('user-dropdown');
  dd.style.display = dd.style.display === 'none' ? '' : 'none';
}
document.addEventListener('click', e => {
  if (!e.target.closest('.user-menu')) {
    const dd = document.getElementById('user-dropdown');
    if (dd) dd.style.display = 'none';
  }
});

async function initAuth() {
  if (!getToken()) { window.location.href = '/login.html'; return false; }
  const user = await fetchCurrentUser();
  if (!user) { clearToken(); window.location.href = '/login.html'; return false; }
  const nameEl = document.getElementById('user-name');
  if (nameEl) nameEl.textContent = user.username;
  const avatarEl = document.getElementById('user-avatar');
  if (avatarEl) avatarEl.textContent = user.username[0].toUpperCase();
  const creditsEl = document.getElementById('credits-display');
  if (creditsEl) creditsEl.textContent = user.credits;
  const adminEl = document.getElementById('admin-link');
  if (adminEl && user.role === 'admin') adminEl.style.display = '';
  return true;
}

function updateCreditsDisplay() {
  fetchCurrentUser().then(() => {
    const u = getCurrentUser();
    const el = document.getElementById('credits-display');
    if (u && el) el.textContent = u.credits;
  });
}

// ═══ 初始化 ═══
async function init() {
  const authed = await initAuth();
  if (!authed) return;
  loadTheme();
  renderStyleGrid();
  renderCharacters();
  renderScenes();
  updateDimHint();
  updateCanvasPreview();
  updateStudioDatetime();
  setInterval(updateStudioDatetime, 10000);
  renderTimeline();
  initMusicTrimDrag();
  initMusicPreview();
  initScrollSync();
  initRulerScrub();
  loadVideoModels();
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', () => switchPage(el.dataset.page));
  });

  // 事件委托：点击角色/场景图片打开大图
  document.addEventListener('click', e => {
    const img = e.target.closest('.srp-portrait-img, .srp-scene-preview img');
    if (img && img.src) {
      e.stopPropagation();
      openLightbox(img.src, img.alt || '');
    }
  });
}

// ═══ 导航 ═══
const PAGE_TITLES = {
  dashboard:'工作台', create:'AI视频生成', imggen:'AI图片生成', avatar:'AI数字人',
  comic:'AI漫画', novel:'AI小说', i2v:'图生视频', portrait:'我的角色',
  projects:'我的项目', works:'我的作品', assets:'素材库', workbench:'声音克隆',
  radar:'素材获取', monitor:'素材库', contentlib:'内容库', replicate:'一键复刻',
  profile:'个人信息'
};

function switchPage(page, opts) {
  if (page === 'settings') return;
  if (page === 'dashboard') loadDashboard();
  // 切换页面时停止所有音频播放
  stopAllAudio();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (!pageEl) return;
  pageEl.classList.add('active');
  const navEl = document.querySelector('[data-page="' + page + '"]');
  if (navEl) navEl.classList.add('active');
  // 更新顶栏标题
  const titleEl = document.getElementById('topbar-title');
  const breadEl = document.getElementById('topbar-breadcrumb');
  if (titleEl) titleEl.textContent = PAGE_TITLES[page] || page;
  if (breadEl) breadEl.textContent = page === 'dashboard' ? '/ 首页概览' : '';
  if (page === 'projects') loadProjects();
  if (page === 'i2v') loadI2VPage();
  if (page === 'avatar') loadAvatarPage();
  if (page === 'imggen') loadImgGenPage();
  if (page === 'novel') nvLoadPage();
  if (page === 'comic') loadComicPage();
  if (page === 'portrait') loadPortraitPage();
  if (page === 'works') loadWorksPage();
  if (page === 'assets') loadAssetsPage();
  if (page === 'radar') loadRadarOverview();
  if (page === 'monitor') loadMonitorList();
  if (page === 'contentlib') loadContentLib();
  if (page === 'replicate') loadReplicatePage();
  if (page === 'workbench') loadVoiceClonePage();
  if (page === 'profile') loadProfilePage();
  if (page === 'create' && !(opts && opts.keepProject)) {
    resetForm();
  }
}

// ═══ 仪表板 ═══
async function loadDashboard() {
  // 并行加载统计、任务
  const [statsRes, tasksRes] = await Promise.all([
    authFetch('/api/dashboard/stats').then(r => r.json()).catch(() => null),
    authFetch('/api/dashboard/recent-tasks').then(r => r.json()).catch(() => null)
  ]);

  // 统计卡片
  if (statsRes?.success) {
    const s = statsRes.data;
    document.getElementById('ds-videos').textContent = s.total_projects || 0;
    document.getElementById('ds-videos-sub').textContent = `今日 +${s.today_videos || 0}`;
    document.getElementById('ds-avatars').textContent = s.total_avatars || 0;
    document.getElementById('ds-avatars-sub').textContent = `今日 +${s.today_avatars || 0}`;
    document.getElementById('ds-images').textContent = (s.total_portraits || 0) + (s.total_comics || 0);
    document.getElementById('ds-images-sub').textContent = `形象 ${s.total_portraits || 0} · 漫画 ${s.total_comics || 0}`;
    document.getElementById('ds-novels').textContent = s.total_novels || 0;
    document.getElementById('ds-novels-sub').textContent = `今日 +${s.today_novels || 0}`;
  }

  // 最近任务（原型table格式）
  const tasksEl = document.getElementById('dash-tasks');
  if (tasksRes?.success && tasksRes.tasks?.length) {
    const TYPE_TAG = { 'AI视频':'tag-blue', '数字人':'tag-yellow', 'AI漫画':'tag-purple', 'AI图片':'tag-green', 'AI小说':'tag-gray', '图生视频':'tag-blue' };
    const STATUS_TAG = { done:'tag-green', completed:'tag-green', processing:'tag-yellow', generating:'tag-yellow', error:'tag-red', pending:'tag-gray' };
    const STATUS_LABEL = { done:'已完成', completed:'已完成', processing:'生成中', generating:'生成中', error:'失败', pending:'等待中' };
    const TYPE_PAGE = { 'AI视频':'projects', '数字人':'avatar', 'AI漫画':'comic', 'AI图片':'portrait', 'AI小说':'novel', '图生视频':'i2v' };
    tasksEl.innerHTML = `<table class="table" style="width:100%"><thead><tr><th>任务名称</th><th>类型</th><th>状态</th><th>时间</th><th></th></tr></thead><tbody>` +
      tasksRes.tasks.map(t => {
        const st = t.status || 'pending';
        const pg = TYPE_PAGE[t.type] || 'works';
        const errBtn = (st === 'error' && t.error) ? `<span onclick="event.stopPropagation();this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'" style="margin-left:4px;padding:1px 6px;background:rgba(239,68,68,.1);color:#ef4444;border:none;border-radius:3px;font-size:10px;cursor:pointer;">原因</span><div style="display:none;margin-top:4px;font-size:11px;color:#ef4444;background:rgba(239,68,68,.06);padding:4px 8px;border-radius:4px;line-height:1.4;">${esc(t.error.substring(0, 200))}</div>` : '';
        return `<tr><td class="cell-main">${esc(t.title || '未命名')}</td><td><span class="tag ${TYPE_TAG[t.type]||'tag-gray'}">${esc(t.type)}</span></td><td><span class="tag ${STATUS_TAG[st]||'tag-gray'}">${STATUS_LABEL[st]||st}</span>${errBtn}</td><td>${esc(t.time_ago||'')}</td><td><button onclick="switchPage('${pg}')" style="padding:2px 10px;background:rgba(var(--accent-rgb),.12);color:var(--accent);border:none;border-radius:4px;font-size:11px;cursor:pointer;">查看</button></td></tr>`;
      }).join('') + '</tbody></table>';
  } else {
    tasksEl.innerHTML = '<table class="table"><tbody><tr><td colspan="4" style="text-align:center;color:var(--text3)">暂无任务记录</td></tr></tbody></table>';
  }

  // 模型状态已移除
}

// 页面加载时默认打开工作台
document.addEventListener('DOMContentLoaded', () => { loadDashboard(); });

// ═══ 个人信息 ═══
function loadProfilePage() {
  const user = getCurrentUser();
  if (!user) return;
  const el = (id) => document.getElementById(id);
  if (el('profile-avatar-lg')) el('profile-avatar-lg').textContent = (user.username || 'U')[0].toUpperCase();
  if (el('profile-username')) el('profile-username').textContent = user.username || '--';
  if (el('profile-role')) el('profile-role').textContent = user.role === 'admin' ? '管理员' : '普通用户';
  if (el('profile-name-val')) el('profile-name-val').textContent = user.username || '--';
  if (el('profile-email-val')) el('profile-email-val').textContent = user.email || '未设置';
  if (el('profile-role-val')) el('profile-role-val').textContent = user.role === 'admin' ? '超级管理员' : '普通用户';
  if (el('profile-created-val')) el('profile-created-val').textContent = user.created_at ? new Date(user.created_at).toLocaleDateString('zh-CN') : '--';
}

function switchProfileTab(tab, btn) {
  ['info', 'platforms', 'security'].forEach(t => {
    const el = document.getElementById('profile-tab-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  if (btn) {
    btn.closest('.assets-tabs').querySelectorAll('.assets-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
  }
  if (tab === 'platforms') loadPlatformLogins();
}

// ═══ 修改密码 ═══
async function changePassword() {
  const oldPwd = document.getElementById('pwd-old')?.value;
  const newPwd = document.getElementById('pwd-new')?.value;
  const confirmPwd = document.getElementById('pwd-confirm')?.value;
  const msgEl = document.getElementById('pwd-msg');
  if (!oldPwd || !newPwd) { msgEl.innerHTML = '<span style="color:#ef4444">请填写所有字段</span>'; return; }
  if (newPwd !== confirmPwd) { msgEl.innerHTML = '<span style="color:#ef4444">两次密码不一致</span>'; return; }
  if (newPwd.length < 6) { msgEl.innerHTML = '<span style="color:#ef4444">密码至少6位</span>'; return; }
  try {
    const resp = await authFetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }) });
    const data = await resp.json();
    if (data.success) {
      msgEl.innerHTML = '<span style="color:#22c55e">密码修改成功！</span>';
      document.getElementById('pwd-old').value = '';
      document.getElementById('pwd-new').value = '';
      document.getElementById('pwd-confirm').value = '';
    } else {
      msgEl.innerHTML = `<span style="color:#ef4444">${data.error || '修改失败'}</span>`;
    }
  } catch (err) { msgEl.innerHTML = `<span style="color:#ef4444">${err.message}</span>`; }
}

// ═══ 平台账号登录 ═══
let _qrPlatform = '';
let _qrPollTimer = null;

async function loadPlatformLogins() {
  const list = document.getElementById('platform-login-list');
  if (!list) return;
  try {
    const resp = await authFetch('/api/browser/status');
    if (!resp.ok) throw new Error('API 不可用');
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || '加载失败');
    const icons = { douyin: '🎵', xiaohongshu: '📕', kuaishou: '⚡' };
    list.innerHTML = Object.entries(data.platforms).map(([id, p]) => {
      const icon = icons[id] || '🌐';
      const userName = p.username ? ` · ${esc(p.username)}` : '';
      const statusBadge = p.loggedIn
        ? `<span style="color:#22c55e;font-size:11px;">● 已登录${userName}</span>`
        : '<span style="color:var(--text3);font-size:11px;">○ 未登录</span>';
      const btn = p.loggedIn
        ? `<button onclick="platformLogout('${id}')" style="padding:4px 14px;background:rgba(239,68,68,.1);color:#ef4444;border:none;border-radius:6px;font-size:11px;cursor:pointer;">退出</button>`
        : `<button onclick="platformLogin('${id}')" style="padding:4px 14px;background:var(--accent);color:#000;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">扫码登录</button>`;
      const chromeWarn = !data.hasChrome ? '<div style="font-size:10px;color:#f59e0b;margin-top:2px;">需安装 Chrome 浏览器</div>' : '';
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px;background:var(--bg3);border-radius:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:20px;">${icon}</span>
          <div><div style="font-size:13px;font-weight:500;color:var(--text);">${esc(p.name)}</div>${statusBadge}${chromeWarn}</div>
        </div>
        ${btn}
      </div>`;
    }).join('');
  } catch (err) {
    // API 不可用时显示手动配置提示
    const icons = { douyin: '🎵', xiaohongshu: '📕', kuaishou: '⚡' };
    const names = { douyin: '抖音', xiaohongshu: '小红书', kuaishou: '快手' };
    list.innerHTML = Object.entries(names).map(([id, name]) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px;background:var(--bg3);border-radius:8px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:20px;">${icons[id]}</span>
        <div><div style="font-size:13px;font-weight:500;color:var(--text);">${name}</div><span style="color:var(--text3);font-size:11px;">○ 未登录</span></div>
      </div>
      <button onclick="platformLogin('${id}')" style="padding:4px 14px;background:var(--accent);color:#000;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">扫码登录</button>
    </div>`).join('');
  }
}

async function platformLogin(platform) {
  _qrPlatform = platform;
  const modal = document.getElementById('qr-login-modal');
  const img = document.getElementById('qr-login-img');
  const title = document.getElementById('qr-login-title');
  const hint = document.getElementById('qr-login-hint');
  const names = { douyin: '抖音', xiaohongshu: '小红书', kuaishou: '快手' };
  title.textContent = `扫码登录${names[platform] || platform}`;
  hint.textContent = '正在打开登录页面...';
  img.src = '';
  modal.style.display = 'flex';

  try {
    const resp = await authFetch(`/api/browser/login/${platform}`, { method: 'POST' });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);
    img.src = data.screenshot;
    hint.textContent = `请用${names[platform] || ''}APP 扫描页面中的二维码`;
    // 开始轮询
    startQrPoll(platform);
  } catch (err) {
    hint.textContent = '启动失败: ' + err.message;
  }
}

function startQrPoll(platform) {
  if (_qrPollTimer) clearInterval(_qrPollTimer);
  _qrPollTimer = setInterval(async () => {
    try {
      const resp = await authFetch(`/api/browser/login/${platform}/poll`);
      const data = await resp.json();
      if (data.status === 'success') {
        clearInterval(_qrPollTimer); _qrPollTimer = null;
        document.getElementById('qr-login-hint').textContent = '登录成功！';
        if (data.screenshot) document.getElementById('qr-login-img').src = data.screenshot;
        setTimeout(() => { document.getElementById('qr-login-modal').style.display = 'none'; loadPlatformLogins(); }, 1500);
      } else if (data.status === 'expired' || data.status === 'error') {
        clearInterval(_qrPollTimer); _qrPollTimer = null;
        document.getElementById('qr-login-hint').textContent = data.message || '会话过期';
      } else if (data.screenshot) {
        document.getElementById('qr-login-img').src = data.screenshot;
      }
    } catch {}
  }, 3000);
}

function cancelPlatformLogin() {
  if (_qrPollTimer) { clearInterval(_qrPollTimer); _qrPollTimer = null; }
  authFetch(`/api/browser/login/${_qrPlatform}/cancel`, { method: 'POST' }).catch(() => {});
  document.getElementById('qr-login-modal').style.display = 'none';
}

async function refreshPlatformLogin() {
  if (_qrPlatform) platformLogin(_qrPlatform);
}

async function platformLogout(platform) {
  if (!confirm('确定退出登录？')) return;
  await authFetch(`/api/browser/logout/${platform}`, { method: 'POST' });
  loadPlatformLogins();
}

// ═══ 内容雷达 ═══

async function loadRadarOverview() {
  // 素材获取页面不需要加载统计数据
}

// ═══ 素材获取与解析 ═══
let _radarVideos = []; // 解析出的视频列表
let _radarBlogger = null; // 解析出的博主信息

/** 从混合文本中提取URL（支持抖音分享文案等） */
function extractUrlFromText(text) {
  if (!text) return '';
  const m = text.match(/https?:\/\/[^\s<>"'，。！？、；：）》\]]+/i);
  return m ? m[0].replace(/[.,;:!?]+$/, '') : text;
}

async function radarParse() {
  const input = document.getElementById('radar-extract-url');
  const btn = document.getElementById('radar-parse-btn');
  const rawText = input?.value?.trim();
  if (!rawText) return;
  const url = extractUrlFromText(rawText);

  btn.disabled = true; btn.textContent = '⏳';
  const infoEl = document.getElementById('radar-blogger-info');
  const toolbarEl = document.getElementById('radar-video-toolbar');
  const listEl = document.getElementById('radar-video-list');

  listEl.innerHTML = `<div class="card" style="padding:24px;text-align:center;">
    <div style="width:24px;height:24px;border:2px solid var(--accent);border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;display:inline-block;"></div>
    <div style="color:var(--accent);font-size:13px;margin-top:8px;">MCP 爬虫正在解析链接...</div>
  </div>`;

  try {
    // 先尝试当作博主主页解析
    const crawlResp = await authFetch('/api/radar/extract-blogger', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url }) });
    if (!crawlResp.ok) throw new Error(`服务器错误 (${crawlResp.status})`);
    const crawlText = await crawlResp.text();
    let crawlData;
    try { crawlData = JSON.parse(crawlText); } catch { throw new Error('服务器返回了无效数据，请检查链接格式'); }

    if (crawlData.success && crawlData.blogger) {
      _radarBlogger = crawlData.blogger;
      _radarVideos = crawlData.videos || [];

      // 显示博主信息卡片
      const b = crawlData.blogger;
      infoEl.style.display = '';
      infoEl.innerHTML = `<div class="card" style="padding:16px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="width:48px;height:48px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">${crawlData.platformIcon || '👤'}</div>
          <div style="flex:1;">
            <div style="font-size:15px;font-weight:700;color:var(--text);">${esc(b.name || '未知博主')}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:2px;">ID: ${esc(b.id || '-')} · ${b.videoCount || 0} 个视频 · 总赞 ${b.totalLikes ? (b.totalLikes > 10000 ? (b.totalLikes/10000).toFixed(1)+'万' : b.totalLikes) : 0}</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button onclick="radarFetchAllVideos()" style="padding:7px 16px;background:var(--accent);color:#000;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">获取全部视频</button>
            <button onclick="radarFollowBlogger()" id="radar-follow-btn" style="padding:7px 16px;background:rgba(var(--accent-rgb),.12);color:var(--accent);border:1px solid rgba(var(--accent-rgb),.2);border-radius:8px;font-size:12px;cursor:pointer;">+ 关注博主</button>
          </div>
        </div>
      </div>`;

      // 显示视频列表
      renderRadarVideos();
    } else {
      // 当作单个视频链接提取
      infoEl.style.display = 'none';
      toolbarEl.style.display = 'none';
      listEl.innerHTML = `<div class="card" style="padding:16px;border:1px solid rgba(var(--accent-rgb),.2);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:15px;">🔄</span>
          <span style="color:var(--accent);font-size:13px;font-weight:600;">未识别为博主主页，正在尝试单视频提取...</span>
        </div>
      </div>`;
      radarExtract();
    }
  } catch (err) {
    listEl.innerHTML = `<div class="card" style="padding:18px;border:1px solid rgba(239,68,68,.25);background:rgba(239,68,68,.04);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <div style="width:36px;height:36px;border-radius:10px;background:rgba(239,68,68,.1);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">⚠️</div>
        <div>
          <div style="color:#ef4444;font-size:14px;font-weight:700;">链接解析失败</div>
          <div style="color:var(--text3);font-size:11px;margin-top:2px;">${esc(err.message)}</div>
        </div>
      </div>
      <div style="padding:12px;background:var(--bg);border-radius:8px;line-height:1.8;">
        <div style="color:var(--text2);font-size:12px;font-weight:600;margin-bottom:4px;">💡 请检查以下几点：</div>
        <div style="color:var(--text3);font-size:11px;">
          1. 链接是否完整 — 请直接从平台复制分享链接<br>
          2. 可以粘贴抖音/快手的「分享文案」，系统会自动提取其中的链接<br>
          3. 确认链接来自支持的平台：<span style="color:var(--accent);">抖音 · 小红书 · 快手 · B站 · 微博</span><br>
          4. 如果是私密/已删除内容，可能无法访问
        </div>
      </div>
    </div>`;
  } finally {
    btn.disabled = false; btn.textContent = '解析';
  }
}

function renderRadarVideos() {
  const listEl = document.getElementById('radar-video-list');
  const toolbarEl = document.getElementById('radar-video-toolbar');
  const countEl = document.getElementById('radar-video-count');
  if (!_radarVideos.length) {
    toolbarEl.style.display = 'none';
    listEl.innerHTML = '<div class="card" style="padding:20px;text-align:center;color:var(--text3);font-size:12px;">未获取到视频列表</div>';
    return;
  }
  toolbarEl.style.display = '';
  if (countEl) countEl.textContent = `共 ${_radarVideos.length} 个视频`;

  listEl.innerHTML = _radarVideos.map((v, i) => {
    const likes = v.stats?.likes || v.likes || 0;
    const comments = v.stats?.comments || v.comments || 0;
    const shares = v.stats?.shares || v.shares || 0;
    const collects = v.stats?.collects || v.collects || 0;
    const duration = v.duration || '';
    const date = v.date || v.publish_time || '';
    return `<div class="card" style="padding:14px;margin-bottom:8px;display:flex;gap:14px;align-items:flex-start;">
      <input type="checkbox" class="rv-check" data-idx="${i}" style="margin-top:4px;accent-color:var(--accent);flex-shrink:0;" />
      <div style="width:120px;height:68px;background:var(--bg3);border-radius:6px;flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;">
        ${v.cover ? `<img src="${esc(v.cover)}" style="width:100%;height:100%;object-fit:cover;" />` : `<span style="font-size:28px;opacity:.3;">🎬</span>`}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(v.title || '作品 ' + (i+1))}</div>
        <div style="font-size:11px;color:var(--text3);display:flex;gap:10px;flex-wrap:wrap;">
          ${likes ? `<span>${likes} 赞</span>` : ''}
          ${comments ? `<span>${comments} 评论</span>` : ''}
          ${collects ? `<span>${collects} 收藏</span>` : ''}
          ${shares ? `<span>${shares} 转发</span>` : ''}
          ${duration ? `<span>${duration}</span>` : ''}
          ${date ? `<span>${esc(date)}</span>` : ''}
        </div>
        <div style="display:flex;gap:6px;margin-top:8px;">
          ${v.url ? `<a href="${esc(v.url)}" target="_blank" style="padding:3px 10px;background:rgba(var(--accent-rgb),.1);color:var(--accent);border:none;border-radius:5px;font-size:10px;text-decoration:none;display:inline-flex;align-items:center;gap:3px;">▶ 播放</a>` : ''}
          ${v.url ? `<button onclick="extractVideoUrl('${esc(v.url)}',${i})" id="rv-extract-${i}" style="padding:3px 10px;background:var(--accent);color:#000;border:none;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;">提取文案</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function rvSort(key) {
  document.querySelectorAll('.rv-sort').forEach(b => {
    b.classList.toggle('active', b.dataset.sort === key);
    b.style.background = b.dataset.sort === key ? 'var(--accent)' : 'var(--bg3)';
    b.style.color = b.dataset.sort === key ? '#000' : 'var(--text2)';
  });
  const sorters = {
    latest: (a, b) => (b.date || b.publish_time || '').localeCompare(a.date || a.publish_time || ''),
    likes: (a, b) => (b.stats?.likes || b.likes || 0) - (a.stats?.likes || a.likes || 0),
    comments: (a, b) => (b.stats?.comments || b.comments || 0) - (a.stats?.comments || a.comments || 0),
    duration_long: (a, b) => (b.duration_sec || 0) - (a.duration_sec || 0),
    duration_short: (a, b) => (a.duration_sec || 0) - (b.duration_sec || 0)
  };
  if (sorters[key]) _radarVideos.sort(sorters[key]);
  renderRadarVideos();
}

function rvSelectAll() {
  const checks = document.querySelectorAll('.rv-check');
  const allChecked = [...checks].every(c => c.checked);
  checks.forEach(c => c.checked = !allChecked);
}

async function rvBatchExtract() {
  const checks = [...document.querySelectorAll('.rv-check:checked')];
  if (!checks.length) return alert('请先勾选要提取的视频');
  const urls = checks.map(c => _radarVideos[c.dataset.idx]?.url).filter(Boolean);
  if (!urls.length) return;
  if (!confirm(`确定批量提取 ${urls.length} 个视频的文案？`)) return;
  try {
    const resp = await authFetch('/api/radar/batch-extract', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ urls }) });
    const data = await resp.json();
    const ok = data.results?.filter(r => r.success).length || 0;
    alert(`批量提取完成: ${ok}/${urls.length} 成功`);
  } catch (err) { alert('失败: ' + err.message); }
}

async function radarFetchAllVideos() {
  if (!_radarBlogger?.url) return;
  const btn = document.querySelector('[onclick="radarFetchAllVideos()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 抓取中...'; }
  try {
    const resp = await authFetch('/api/radar/extract-blogger', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: _radarBlogger.url, fetchAll: true }) });
    const data = await resp.json();
    if (data.success && data.videos?.length) {
      _radarVideos = data.videos;
      renderRadarVideos();
    }
  } catch {}
  if (btn) { btn.disabled = false; btn.textContent = '获取全部视频'; }
}

async function radarFollowBlogger() {
  if (!_radarBlogger) return;
  const btn = document.getElementById('radar-follow-btn');
  try {
    const resp = await authFetch('/api/radar/monitors', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: _radarBlogger.url, name: _radarBlogger.name || '' }) });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);
    if (btn) { btn.textContent = '✅ 已关注'; btn.disabled = true; btn.style.background = 'rgba(34,197,94,.12)'; btn.style.color = '#22c55e'; }
  } catch (err) { alert('关注失败: ' + err.message); }
}

const PLATFORM_LABEL = { douyin:'抖音', xiaohongshu:'小红书', bilibili:'B站', weibo:'微博' };

async function loadTrending(platform) {
  const el = document.getElementById('rd-trending');
  if (!el) return;
  el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;"><div style="width:16px;height:16px;border:2px solid var(--accent);border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></div><span style="font-size:12px;color:var(--accent);">正在获取${PLATFORM_LABEL[platform]||platform}热门内容...</span></div>`;
  try {
    const resp = await authFetch(`/api/radar/trending/${platform}`);
    const data = await resp.json();
    if (!data.success || (!data.trending?.length && !data.links?.length)) {
      el.innerHTML = `<div style="color:var(--text3);font-size:12px;text-align:center;">${data.message || '未获取到热门内容（MCP 爬虫可能未运行）'}</div>`;
      return;
    }
    let html = `<div style="font-size:12px;color:var(--accent);margin-bottom:10px;font-weight:600;">🔥 ${PLATFORM_LABEL[platform]} 热门话题</div>`;
    if (data.trending?.length) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">';
      html += data.trending.slice(0, 15).map((t, i) => `<span style="font-size:11px;padding:4px 10px;background:${i<3?'rgba(239,68,68,.12)':'rgba(var(--accent-rgb),.08)'};color:${i<3?'#ef4444':'var(--text2)'};border-radius:4px;cursor:default;">${i<3?'🔥':''} ${esc(t)}</span>`).join('');
      html += '</div>';
    }
    if (data.links?.length) {
      html += '<div style="font-size:11px;color:var(--text3);margin-bottom:6px;">相关视频链接：</div>';
      html += data.links.slice(0, 5).map(l => `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04);">
        <span style="flex:1;font-size:11px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(l.substring(0,80))}</span>
        <button onclick="extractVideoUrl('${esc(l)}')" style="padding:2px 8px;background:var(--accent);color:#000;border:none;border-radius:4px;font-size:10px;cursor:pointer;white-space:nowrap;">提取</button>
      </div>`).join('');
    }
    el.innerHTML = html;
  } catch (err) {
    el.innerHTML = `<div style="color:#ef4444;font-size:12px;">${esc(err.message)}</div>`;
  }
}

async function radarExtract() {
  const urlInput = document.getElementById('radar-extract-url');
  const resultEl = document.getElementById('radar-extract-result');
  const btn = document.querySelector('[onclick="radarExtract()"]');
  if (!urlInput?.value.trim()) return;
  if (!resultEl) return;
  // 清除视频列表区域（可能有 radarParse 的 loading）
  const listEl = document.getElementById('radar-video-list');
  if (listEl) listEl.innerHTML = '';
  // 显示加载动画
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 分析中...'; }
  resultEl.innerHTML = `<div class="card" style="padding:20px;margin-top:8px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
      <div style="width:20px;height:20px;border:2px solid var(--accent);border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;flex-shrink:0;"></div>
      <span style="color:var(--accent);font-size:13px;font-weight:600;">AI 正在分析视频内容...</span>
    </div>
    <div style="font-size:11px;color:var(--text3);line-height:1.8;">
      ✅ 正在识别平台来源...<br>
      ⏳ 提取视频文案和标签...<br>
      ⏳ 分析内容结构和风格...
    </div>
  </div>`;
  try {
    const extractedUrl = extractUrlFromText(urlInput.value.trim());
    const resp = await authFetch('/api/radar/extract', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ url: extractedUrl }) });
    if (!resp.ok) throw new Error(`服务器错误 (${resp.status})`);
    const respText = await resp.text();
    let data;
    try { data = JSON.parse(respText); } catch { throw new Error('服务器返回了无效数据，请检查链接格式'); }
    if (!data.success) throw new Error(data.error);
    const c = data.content;
    resultEl.innerHTML = `<div class="card" style="padding:16px;margin-top:8px;border:1px solid rgba(34,197,94,.2);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="color:#22c55e;font-size:13px;font-weight:600;">✅ 提取成功</span>
        <span class="tag tag-blue" style="font-size:10px;">${esc(c.platformName||'')}</span>
        ${c.style?`<span class="tag tag-purple" style="font-size:10px;">${esc(c.style)}</span>`:''}
      </div>
      <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:8px;">${esc(c.title||'')}</div>
      <div style="font-size:12px;color:var(--text2);line-height:1.6;max-height:120px;overflow-y:auto;margin-bottom:10px;padding:10px;background:var(--bg);border-radius:6px;">${esc(c.transcript||'').substring(0,500)}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">${(c.tags||[]).map(t=>`<span class="tag tag-purple">${esc(t)}</span>`).join('')}</div>
      ${c.hook?`<div style="font-size:11px;color:var(--accent);margin-bottom:4px;">🎣 钩子: ${esc(c.hook)}</div>`:''}
      ${c.structure?`<div style="font-size:11px;color:var(--text3);">📐 结构: ${esc(c.structure)}</div>`:''}
      <div style="margin-top:10px;display:flex;gap:6px;">
        <button onclick="openContentProcess('${c.id}')" style="padding:5px 14px;background:var(--accent);color:#000;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">处理内容</button>
        <button onclick="navigator.clipboard.writeText(document.querySelector('#radar-extract-result .card div[style*=overflow-y]')?.textContent||'');alert('已复制')" style="padding:5px 14px;background:rgba(var(--accent-rgb),.12);color:var(--accent);border:none;border-radius:6px;font-size:11px;cursor:pointer;">复制文案</button>
      </div>
    </div>`;
    urlInput.value = '';
    loadRadarOverview();
  } catch (err) {
    resultEl.innerHTML = `<div class="card" style="padding:18px;margin-top:8px;border:1px solid rgba(239,68,68,.25);background:rgba(239,68,68,.04);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <div style="width:36px;height:36px;border-radius:10px;background:rgba(239,68,68,.1);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">❌</div>
        <div>
          <div style="color:#ef4444;font-size:14px;font-weight:700;">素材提取失败</div>
          <div style="color:var(--text3);font-size:11px;margin-top:2px;">${esc(err.message)}</div>
        </div>
      </div>
      <div style="padding:12px;background:var(--bg);border-radius:8px;line-height:1.8;">
        <div style="color:var(--text2);font-size:12px;font-weight:600;margin-bottom:4px;">💡 可能的原因：</div>
        <div style="color:var(--text3);font-size:11px;">
          1. 视频链接已失效或内容已被删除<br>
          2. 该平台需要登录才能访问（私密内容）<br>
          3. MCP 爬虫服务未配置或连接异常 — 请在 <span style="color:var(--accent);cursor:pointer;" onclick="switchPage('settings')">设置页</span> 检查 MCP 连接<br>
          4. 也可以直接粘贴视频的文案内容进行分析
        </div>
      </div>
    </div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'AI 提取分析'; }
  }
}

let currentMonitorId = null;

function matSwitchTab(tab) {
  document.querySelectorAll('.mat-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  ['all','blogger','parsed','download','transcript','audio'].forEach(t => {
    const el = document.getElementById('mat-tab-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'all') matLoadAll();
  if (tab === 'parsed') matLoadParsed();
  if (tab === 'transcript') matLoadTranscripts();
  if (tab === 'audio') matLoadAudios();
  if (tab === 'download') matLoadDownloads();
}

async function matLoadAll() {
  const el = document.getElementById('mat-all-list');
  if (!el) return;
  try {
    const [contentsResp, monitorsResp, voicesResp] = await Promise.all([
      authFetch('/api/radar/contents').then(r=>r.json()).catch(()=>({contents:[]})),
      authFetch('/api/radar/monitors').then(r=>r.json()).catch(()=>({monitors:[]})),
      authFetch('/api/workbench/voices').then(r=>r.json()).catch(()=>({voices:[]}))
    ]);
    const items = [];
    (contentsResp.contents||[]).forEach(c => items.push({ type:'content', title: c.title, sub: c.platform_name, time: c.created_at, id: c.id }));
    (monitorsResp.monitors||[]).forEach(m => items.push({ type:'blogger', title: m.account_name, sub: m.platform_name, time: m.created_at }));
    (voicesResp.voices||[]).forEach(v => items.push({ type:'voice', title: v.name, sub: '语音', time: v.created_at }));
    items.sort((a,b) => (b.time||'').localeCompare(a.time||''));
    if (!items.length) { el.innerHTML = '<div style="color:var(--text3);font-size:12px;text-align:center;padding:40px;">暂无素材</div>'; return; }
    const typeTag = { content:'tag-blue', blogger:'tag-green', voice:'tag-purple' };
    const typeLabel = { content:'文案', blogger:'博主', voice:'配音' };
    el.innerHTML = items.slice(0,30).map(it => `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.04);">
      <span class="tag ${typeTag[it.type]}" style="font-size:10px;">${typeLabel[it.type]}</span>
      <span style="flex:1;font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(it.title||'未命名')}</span>
      <span style="font-size:11px;color:var(--text3);">${esc(it.sub||'')}</span>
      <span style="font-size:10px;color:var(--text3);">${it.time?new Date(it.time).toLocaleDateString('zh-CN'):''}</span>
    </div>`).join('');
  } catch {}
}

function matLoadDownloads() {
  const el = document.getElementById('mat-download-list');
  if (el) el.innerHTML = '<div style="color:var(--text3);font-size:12px;text-align:center;padding:40px;">暂无下载记录</div>';
}

let _crawlTimer = null;
function startCrawlTimer() {
  if (_crawlTimer) { clearInterval(_crawlTimer); _crawlTimer = null; document.getElementById('crawl-timer-status').textContent = '未启动'; return; }
  crawlAllBloggers();
  _crawlTimer = setInterval(crawlAllBloggers, 3600000); // 每小时
  document.getElementById('crawl-timer-status').textContent = '已启动（每小时）';
}

async function crawlAllBloggers() {
  try {
    const resp = await authFetch('/api/radar/monitors');
    const data = await resp.json();
    if (!data.success) return;
    const active = (data.monitors||[]).filter(m => m.is_active);
    let ok = 0;
    for (const m of active) {
      try { await authFetch(`/api/radar/monitors/${m.id}/crawl`); ok++; } catch {}
    }
    document.getElementById('crawl-timer-status').textContent = `已启动 · 上次抓取 ${ok}/${active.length} 个博主`;
  } catch {}
}

function matFilterContent() {
  // 在当前 tab 下搜索
  const q = document.getElementById('mat-search')?.value?.toLowerCase() || '';
  const activeTab = document.querySelector('.mat-tab.active')?.dataset.tab;
  if (activeTab === 'blogger') {
    document.querySelectorAll('.mat-blogger-card').forEach(card => {
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(q) ? '' : 'none';
    });
  }
}

async function loadMonitorList() {
  try {
    const resp = await authFetch('/api/radar/monitors');
    const data = await resp.json();
    const el = document.getElementById('monitor-list');
    if (!data.success || !data.monitors?.length) {
      el.innerHTML = '<div style="color:var(--text3);font-size:12px;text-align:center;padding:40px;">暂无关注博主，点击上方按钮添加</div>';
      return;
    }
    const platformIcon = { douyin:'📱', bilibili:'📺', xiaohongshu:'📕', kuaishou:'🎬', wechat:'💬' };
    el.innerHTML = data.monitors.map(m => {
      const icon = platformIcon[m.platform] || '🌐';
      const timeAgo = m.created_at ? new Date(m.created_at).toLocaleDateString('zh-CN') : '';
      const followersText = m.followers ? `${m.followers > 10000 ? (m.followers / 10000).toFixed(1) + '万' : m.followers} 粉丝` : '';
      const bioText = m.bio ? esc(m.bio.substring(0, 40)) : '';
      const syncText = m.last_sync_at ? `最后同步 ${new Date(m.last_sync_at).toLocaleString('zh-CN')}` : '未同步';
      return `<div class="mat-blogger-card">
        <div class="mat-blogger-avatar">${icon}</div>
        <div class="mat-blogger-info">
          <div class="mat-blogger-name">${esc(m.account_name)}${followersText ? ` <span style="font-size:11px;color:var(--text3);font-weight:400;">${followersText}</span>` : ''}</div>
          <div class="mat-blogger-meta">${esc(m.platform_name)} · ID: ${esc(m.account_url?.match(/\/([^\/\?]+)\/?(\?|$)/)?.[1] || '').substring(0,20)} · ${syncText}</div>
          ${bioText ? `<div style="font-size:11px;color:var(--text3);margin-top:1px;">${bioText}</div>` : ''}
        </div>
        <div class="mat-blogger-actions">
          <label style="font-size:11px;color:var(--text3);cursor:pointer;display:flex;align-items:center;gap:4px;">
            <input type="checkbox" ${m.is_active?'checked':''} onchange="toggleMonitor('${m.id}')" style="accent-color:var(--accent);" /> 自动抓取
          </label>
          <span class="mat-btn-follow-status">${m.is_active ? '已关注' : '已暂停'}</span>
          <button class="mat-btn-view" onclick="viewMonitorDetail('${m.id}','${esc(m.account_name)}','${esc(m.platform_name)}')">查看视频</button>
          <button class="mat-btn-unfollow" onclick="deleteMonitor('${m.id}')">取关</button>
        </div>
      </div>`;
    }).join('');
  } catch (err) { console.warn('[Monitor]', err.message); }
}

async function matLoadParsed() {
  const el = document.getElementById('mat-parsed-list');
  if (!el) return;
  try {
    const resp = await authFetch('/api/radar/contents');
    const data = await resp.json();
    if (!data.success || !data.contents?.length) { el.innerHTML = '<div style="color:var(--text3);font-size:12px;text-align:center;padding:40px;">暂无解析记录</div>'; return; }
    el.innerHTML = data.contents.map(c => `<div class="card" style="padding:14px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="font-size:14px;font-weight:600;color:var(--text);flex:1;">${esc(c.title||'未命名')}</span>
        <span class="tag tag-blue" style="font-size:10px;">${esc(c.platform_name||'')}</span>
        <span style="font-size:11px;color:var(--text3);">${c.created_at?new Date(c.created_at).toLocaleString('zh-CN'):''}</span>
      </div>
      <div style="font-size:12px;color:var(--text2);line-height:1.5;max-height:60px;overflow:hidden;">${esc((c.transcript||'').substring(0,200))}</div>
      <div style="margin-top:8px;display:flex;gap:6px;">
        <button onclick="openContentProcess('${c.id}')" style="padding:4px 12px;background:var(--accent);color:#000;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">加载文案</button>
        <button onclick="navigator.clipboard.writeText(${JSON.stringify(c.transcript||'')});alert('已复制')" style="padding:4px 12px;background:rgba(var(--accent-rgb),.12);color:var(--accent);border:none;border-radius:6px;font-size:11px;cursor:pointer;">复制</button>
        <button onclick="cpToAvatarFromId('${c.id}')" style="padding:4px 12px;background:rgba(236,72,153,.12);color:#ec4899;border:none;border-radius:6px;font-size:11px;cursor:pointer;">数字人</button>
        <button onclick="deleteContentItem('${c.id}')" style="padding:4px 12px;background:rgba(239,68,68,.1);color:#ef4444;border:none;border-radius:6px;font-size:11px;cursor:pointer;">删除</button>
      </div>
    </div>`).join('');
  } catch {}
}

async function matLoadTranscripts() {
  const el = document.getElementById('mat-transcript-list');
  if (!el) return;
  try {
    const resp = await authFetch('/api/radar/contents');
    const data = await resp.json();
    const contents = (data.contents || []).filter(c => c.transcript);
    if (!contents.length) { el.innerHTML = '<div style="color:var(--text3);font-size:12px;text-align:center;padding:40px;">暂无提取文案</div>'; return; }
    el.innerHTML = contents.map(c => `<div class="card" style="padding:14px;margin-bottom:8px;">
      <div style="font-size:13px;font-weight:500;color:var(--text);margin-bottom:6px;">${esc(c.title||'未命名')}</div>
      <div style="font-size:12px;color:var(--text2);line-height:1.6;max-height:80px;overflow-y:auto;padding:8px;background:var(--bg);border-radius:6px;">${esc(c.transcript.substring(0,300))}</div>
      <div style="margin-top:8px;display:flex;gap:6px;">
        <button onclick="navigator.clipboard.writeText(${JSON.stringify(c.transcript)});alert('已复制')" style="padding:4px 12px;background:rgba(var(--accent-rgb),.12);color:var(--accent);border:none;border-radius:6px;font-size:11px;cursor:pointer;">复制</button>
        <button onclick="cpToAvatarFromId('${c.id}')" style="padding:4px 12px;background:rgba(236,72,153,.12);color:#ec4899;border:none;border-radius:6px;font-size:11px;cursor:pointer;">生成数字人</button>
      </div>
    </div>`).join('');
  } catch {}
}

async function matLoadAudios() {
  const el = document.getElementById('mat-audio-list');
  if (!el) return;
  try {
    const resp = await authFetch('/api/workbench/voices');
    const data = await resp.json();
    const voices = data.voices || [];
    if (!voices.length) { el.innerHTML = '<div style="color:var(--text3);font-size:12px;text-align:center;padding:40px;">暂无合成配音</div>'; return; }
    el.innerHTML = voices.map(v => `<div class="card" style="padding:14px;margin-bottom:8px;display:flex;align-items:center;gap:12px;">
      <div style="font-size:20px;">🎵</div>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:500;color:var(--text);">${esc(v.name||'未命名')}</div>
        <div style="font-size:11px;color:var(--text3);">创建于 ${v.created_at?new Date(v.created_at).toLocaleDateString('zh-CN'):''}</div>
      </div>
      <button onclick="vcPlayVoice('${v.id}')" style="padding:5px 14px;background:var(--accent);color:#000;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">▶ 试听</button>
    </div>`).join('');
  } catch {}
}

async function viewMonitorDetail(id, name, platform) {
  currentMonitorId = id;
  document.getElementById('monitor-detail').style.display = '';
  document.getElementById('md-name').textContent = (name || '加载中...') + (platform ? ' (' + platform + ')' : '');
  const el = document.getElementById('md-videos');
  el.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:24px;">
    <div style="width:24px;height:24px;border:2px solid var(--accent);border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;display:inline-block;"></div>
    <div style="color:var(--accent);font-size:13px;margin-top:10px;font-weight:600;">MCP 爬虫正在抓取博主内容...</div>
    <div style="color:var(--text3);font-size:11px;margin-top:4px;">自动识别平台，提取视频列表和文案</div>
  </div>`;

  try {
    const resp = await authFetch(`/api/radar/monitors/${id}/crawl`);
    const data = await resp.json();
    if (data.success) {
      if (data.account_name) {
        document.getElementById('md-name').textContent = data.account_name + (platform ? ' (' + platform + ')' : '');
        // 刷新左侧博主列表名称
        loadMonitorList();
      }
      const source = data.crawl_source === 'mcp' ? '🤖 MCP 爬虫' : '🔍 内置抓取';
      let html = `<div style="grid-column:1/-1;display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <span style="font-size:11px;color:var(--text3);background:var(--bg);padding:3px 8px;border-radius:4px;">${source}</span>
        ${data.videos?.length ? `<span style="font-size:11px;color:var(--accent);">发现 ${data.videos.length} 个作品</span>` : ''}
        ${data.videos?.length > 1 ? `<button onclick="batchExtractVideos()" style="margin-left:auto;padding:4px 14px;background:linear-gradient(135deg,var(--accent),#8b5cf6);color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">⚡ 一键全部提取</button>` : ''}
      </div>`;

      // 视频列表
      if (data.videos?.length) {
        window._monitorVideos = data.videos; // 存储用于批量提取
        html += data.videos.slice(0, 12).map((v, i) => `<div class="card" style="padding:12px;" id="mv-card-${i}">
          <div style="font-size:12px;color:var(--text);margin-bottom:4px;font-weight:500;">${esc(v.title || '作品 ' + (i + 1))}</div>
          <div style="font-size:10px;color:var(--text3);margin-bottom:8px;word-break:break-all;max-height:30px;overflow:hidden;">${esc(typeof v === 'string' ? v : v.url || '')}</div>
          <div style="display:flex;gap:6px;">
            <button onclick="extractVideoUrl('${esc(typeof v === 'string' ? v : v.url)}', ${i})" style="padding:4px 12px;background:var(--accent);color:#000;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">📄 提取文案</button>
            <a href="${esc(typeof v === 'string' ? v : v.url)}" target="_blank" style="padding:4px 12px;background:rgba(var(--accent-rgb),.1);color:var(--accent);border:none;border-radius:6px;font-size:11px;text-decoration:none;display:inline-flex;align-items:center;">🔗 查看原文</a>
          </div>
        </div>`).join('');
      }

      // 已提取内容
      if (data.contents?.length) {
        html += '<div style="grid-column:1/-1;margin-top:16px;margin-bottom:8px;font-size:13px;font-weight:600;color:var(--text);">📋 已提取内容 (' + data.contents.length + ')</div>';
        html += data.contents.map(c => `<div class="card" style="padding:12px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span style="font-size:13px;font-weight:500;color:var(--text);flex:1;">${esc(c.title||'未命名')}</span>
            <span class="tag tag-purple" style="font-size:9px;">${esc(c.style||'')}</span>
          </div>
          <div style="font-size:11px;color:var(--text2);line-height:1.5;max-height:45px;overflow:hidden;margin-bottom:8px;">${esc((c.transcript||'').substring(0,150))}</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            ${(c.tags||[]).slice(0,5).map(t=>`<span style="font-size:9px;color:var(--accent);background:rgba(var(--accent-rgb),.08);padding:1px 6px;border-radius:3px;">#${esc(t)}</span>`).join('')}
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button onclick="openContentProcess('${c.id}')" style="padding:4px 10px;background:rgba(var(--accent-rgb),.12);color:var(--accent);border:none;border-radius:5px;font-size:10px;cursor:pointer;">✏️ AI改写</button>
            <button onclick="cpToAvatarFromId('${c.id}')" style="padding:4px 10px;background:rgba(236,72,153,.12);color:#ec4899;border:none;border-radius:5px;font-size:10px;cursor:pointer;">👤 数字人</button>
            <button onclick="navigator.clipboard.writeText(${JSON.stringify(c.transcript||'')});alert('已复制')" style="padding:4px 10px;background:rgba(34,197,94,.12);color:#22c55e;border:none;border-radius:5px;font-size:10px;cursor:pointer;">📋 复制</button>
          </div>
        </div>`).join('');
      }

      if (!data.videos?.length && !data.contents?.length) {
        html += '<div style="grid-column:1/-1;color:var(--text3);font-size:12px;text-align:center;padding:30px;">未抓取到视频内容（平台可能需要登录）<br>请在下方手动粘贴视频链接提取</div>';
      }
      el.innerHTML = html;
      return;
    }
  } catch {}
  loadMonitorVideosLegacy(id);
}

async function batchExtractVideos() {
  if (!window._monitorVideos?.length) return;
  const urls = window._monitorVideos.slice(0, 5).map(v => typeof v === 'string' ? v : v.url).filter(Boolean);
  if (!urls.length) return;
  if (!confirm(`确定批量提取 ${urls.length} 个视频的文案？`)) return;
  try {
    const resp = await authFetch('/api/radar/batch-extract', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ urls }) });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);
    const ok = data.results.filter(r => r.success).length;
    alert(`批量提取完成: ${ok}/${urls.length} 成功`);
    if (currentMonitorId) viewMonitorDetail(currentMonitorId, '', '');
  } catch (err) { alert('批量提取失败: ' + err.message); }
}

async function extractVideoUrl(url, cardIndex) {
  const card = cardIndex !== undefined ? document.getElementById('mv-card-' + cardIndex) : null;
  if (card) {
    const btn = card.querySelector('button');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 提取中...'; }
  }
  try {
    const resp = await authFetch('/api/radar/extract', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url }) });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);
    if (card) card.style.borderColor = 'rgba(34,197,94,.3)';
    if (currentMonitorId) viewMonitorDetail(currentMonitorId, '', '');
  } catch (err) { alert('提取失败: ' + err.message); }
}

async function loadMonitorVideosLegacy(accountId) {
  try {
    const resp = await authFetch(`/api/radar/contents?account_id=${accountId}`);
    const data = await resp.json();
    const el = document.getElementById('md-videos');
    if (!data.success || !data.contents?.length) {
      el.innerHTML = '<div style="grid-column:1/-1;color:var(--text3);font-size:12px;text-align:center;padding:30px;">暂无提取内容，请粘贴该博主视频链接进行提取</div>';
      return;
    }
    el.innerHTML = data.contents.map(c => `<div class="card" style="padding:12px;">
      <div style="font-size:13px;font-weight:500;color:var(--text);margin-bottom:4px;">${esc(c.title||'未命名')}</div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:6px;">${esc(c.style||'')} · ${(c.tags||[]).map(t=>'#'+t).join(' ')}</div>
      <div style="font-size:11px;color:var(--text2);line-height:1.5;max-height:50px;overflow:hidden;margin-bottom:8px;">${esc((c.transcript||'').substring(0,150))}</div>
      <div style="display:flex;gap:4px;">
        <button onclick="openContentProcess('${c.id}')" style="padding:3px 8px;background:rgba(var(--accent-rgb),.12);color:var(--accent);border:none;border-radius:4px;font-size:10px;cursor:pointer;">处理</button>
        <button onclick="rewriteContentUI('${c.id}')" style="padding:3px 8px;background:rgba(34,197,94,.12);color:#22c55e;border:none;border-radius:4px;font-size:10px;cursor:pointer;">改写</button>
      </div>
    </div>`).join('');
  } catch (err) { console.warn('[Monitor]', err.message); }
}

async function extractMonitorVideo() {
  const urlInput = document.getElementById('md-video-url');
  if (!urlInput?.value.trim()) return alert('请输入视频链接');
  const btn = urlInput.nextElementSibling;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 提取中...'; }
  try {
    const resp = await authFetch('/api/radar/extract', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: urlInput.value.trim(), account_id: currentMonitorId }) });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);
    urlInput.value = '';
    if (currentMonitorId) viewMonitorDetail(currentMonitorId, '', '');
  } catch (err) { alert('提取失败: ' + err.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '提取内容'; } }
}

function addMonitorPrompt() {
  // 创建内联对话框
  let modal = document.getElementById('add-monitor-modal');
  if (modal) { modal.style.display = 'flex'; return; }
  modal = document.createElement('div');
  modal.id = 'add-monitor-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:24px;width:420px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.5);">
    <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px;">关注博主</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:16px;">添加博主账号，追踪其最新内容</div>
    <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:6px;">博主名称</label>
    <input id="am-name" style="width:100%;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;margin-bottom:12px;box-sizing:border-box;" placeholder="例如：王先生说金融" />
    <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:6px;">账号主页链接</label>
    <input id="am-url" style="width:100%;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;margin-bottom:6px;box-sizing:border-box;" placeholder="粘贴抖音/快手/B站/小红书主页链接..." />
    <div style="font-size:11px;color:var(--text3);margin-bottom:16px;">支持平台：抖音 · 快手 · B站 · 小红书 · 视频号</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button onclick="document.getElementById('add-monitor-modal').style.display='none'" style="padding:8px 20px;background:var(--bg3);color:var(--text2);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer;">取消</button>
      <button onclick="submitAddMonitor()" style="padding:8px 20px;background:var(--accent);color:#000;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">确认关注</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
  document.getElementById('am-name').focus();
}

async function submitAddMonitor() {
  const url = document.getElementById('am-url')?.value?.trim();
  const name = document.getElementById('am-name')?.value?.trim();
  if (!url) { document.getElementById('am-url').style.borderColor = '#ef4444'; return; }
  if (!name) { document.getElementById('am-name').style.borderColor = '#ef4444'; return; }
  try {
    const resp = await authFetch('/api/radar/monitors', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url, name }) });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);
    document.getElementById('add-monitor-modal').style.display = 'none';
    document.getElementById('am-url').value = '';
    document.getElementById('am-name').value = '';
    loadMonitorList();
  } catch (err) { alert('关注失败: ' + err.message); }
}
async function toggleMonitor(id) {
  await authFetch(`/api/radar/monitors/${id}/toggle`, { method:'PUT' });
  loadMonitorList();
}
async function deleteMonitor(id) {
  if (!confirm('确定删除此监控账号？')) return;
  await authFetch(`/api/radar/monitors/${id}`, { method:'DELETE' });
  loadMonitorList();
}

async function loadContentLib() {
  try {
    const platform = document.getElementById('clib-platform-filter')?.value || '';
    const resp = await authFetch(`/api/radar/contents${platform?'?platform='+platform:''}`);
    const data = await resp.json();
    const el = document.getElementById('clib-list');
    if (!data.success || !data.contents?.length) { el.innerHTML = '<div style="color:var(--text3);font-size:12px;text-align:center;padding:40px;">暂无内容</div>'; return; }
    el.innerHTML = data.contents.map(c => `<div class="card" style="padding:14px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px;">
        <div style="font-size:13px;font-weight:500;color:var(--text);">${esc(c.title||'未命名')}</div>
        <div style="display:flex;gap:4px;flex-shrink:0;"><span class="tag tag-blue">${esc(c.platform_name||'')}</span><span class="tag tag-purple">${esc(c.style||'')}</span></div>
      </div>
      <div style="font-size:12px;color:var(--text2);line-height:1.5;max-height:60px;overflow:hidden;">${esc((c.transcript||'').substring(0,200))}</div>
      <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">${(c.tags||[]).map(t=>`<span class="tag tag-gray">${esc(t)}</span>`).join('')}</div>
      <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
        <button onclick="openContentProcess('${c.id}')" style="padding:4px 10px;background:rgba(var(--accent-rgb),.15);color:var(--accent);border:none;border-radius:6px;font-size:11px;cursor:pointer;">📝 处理</button>
        <button onclick="rewriteContentUI('${c.id}')" style="padding:4px 10px;background:rgba(34,197,94,.12);color:#22c55e;border:none;border-radius:6px;font-size:11px;cursor:pointer;">🔄 快速改写</button>
        <button onclick="cpToAvatarFromId('${c.id}')" style="padding:4px 10px;background:rgba(236,72,153,.12);color:#ec4899;border:none;border-radius:6px;font-size:11px;cursor:pointer;">👤 生成数字人</button>
        <button onclick="deleteContentItem('${c.id}')" style="padding:4px 10px;background:rgba(239,68,68,.1);color:#ef4444;border:none;border-radius:6px;font-size:11px;cursor:pointer;">✕ 删除</button>
      </div>
    </div>`).join('');
  } catch (err) { console.warn('[ContentLib]', err.message); }
}

function filterContentLib() { loadContentLib(); }

async function rewriteContentUI(id) {
  const style = prompt('改写风格:\nsame=保持原风格\noral=口播\nsell=带货\nknowledge=知识\nstory=故事', 'same');
  if (!style) return;
  try {
    const resp = await authFetch('/api/radar/rewrite', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ content_id: id, style }) });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);
    alert('改写完成！\n\n' + data.rewritten.substring(0, 300) + '...');
  } catch (err) { alert('改写失败: ' + err.message); }
}

async function deleteContentItem(id) {
  if (!confirm('删除此内容？')) return;
  await authFetch(`/api/radar/contents/${id}`, { method:'DELETE' });
  loadContentLib();
}

async function loadReplicatePage() {
  // 加载克隆声音到 voice chips
  try {
    const resp = await authFetch('/api/workbench/voices');
    const data = await resp.json();
    const chips = document.getElementById('wb-voice-chips');
    if (chips && data.success && data.voices?.length) {
      // 移除旧的克隆声音 chips
      chips.querySelectorAll('.wb-voice-cloned').forEach(el => el.remove());
      // 添加克隆声音
      data.voices.forEach(v => {
        const span = document.createElement('span');
        span.className = 'wb-voice-chip wb-voice-cloned';
        span.dataset.voice = v.id;
        span.onclick = () => wbSelectVoice(span);
        span.textContent = '🎙 ' + (v.name || '克隆声音');
        chips.appendChild(span);
      });
    }
  } catch {}
  // 加载历史
  try {
    const resp = await authFetch('/api/radar/replicate/tasks');
    const data = await resp.json();
    const el = document.getElementById('rep-history');
    if (!data.success || !data.tasks?.length) return;
    el.innerHTML = data.tasks.reverse().map(t => {
      const sc = t.status==='done'?'tag-green':t.status==='error'?'tag-red':'tag-yellow';
      const sl = t.status==='done'?'完成':t.status==='error'?'失败':'进行中';
      const preview = t.rewritten_text ? esc(t.rewritten_text.substring(0, 80)) + '...' : '';
      const errMsg = t.status==='error' && t.error ? `<div style="color:#ef4444;font-size:11px;margin-top:4px;">${esc(t.error)}</div>` : '';
      const created = t.created_at ? new Date(t.created_at).toLocaleString('zh-CN') : '';
      return `<div class="card" style="padding:14px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:${preview||errMsg?'8':'0'}px;">
          <span style="font-size:13px;color:var(--text);flex:1;font-weight:500;">${esc(t.title||'复刻任务')}</span>
          <span style="font-size:11px;color:var(--text3);">${created}</span>
          <span class="tag ${sc}">${sl}</span>
        </div>
        ${preview?`<div style="font-size:12px;color:var(--text2);line-height:1.5;">${preview}</div>`:''}
        ${errMsg}
      </div>`;
    }).join('');
  } catch {}
}

// ═══ 内容处理面板 ═══
let currentProcessContentId = null;

async function openContentProcess(id) {
  try {
    const resp = await authFetch(`/api/radar/contents/${id}`);
    const data = await resp.json();
    if (!data.success) return;
    currentProcessContentId = id;
    const c = data.content;
    document.getElementById('cp-title').textContent = c.title || '未命名';
    document.getElementById('cp-original').textContent = c.transcript || '';
    document.getElementById('cp-result').style.display = 'none';
    document.getElementById('clib-process').style.display = '';
    document.getElementById('clib-process').scrollIntoView({ behavior: 'smooth' });
  } catch (err) { alert(err.message); }
}

async function cpRewrite(style) {
  if (!currentProcessContentId) return;
  document.getElementById('cp-result').style.display = '';
  document.getElementById('cp-rewritten').innerHTML = '<span style="color:var(--accent)">🔄 AI 改写中...</span>';
  try {
    const resp = await authFetch('/api/radar/rewrite', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ content_id: currentProcessContentId, style }) });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);
    document.getElementById('cp-rewritten').textContent = data.rewritten;
  } catch (err) { document.getElementById('cp-rewritten').innerHTML = `<span style="color:#ef4444">${esc(err.message)}</span>`; }
}

function cpCopyResult() {
  const text = document.getElementById('cp-rewritten')?.textContent;
  if (text) { navigator.clipboard.writeText(text); alert('已复制到剪贴板'); }
}

function cpToAvatar() {
  const text = document.getElementById('cp-original')?.textContent;
  if (!text) return;
  switchPage('avatar');
  setTimeout(() => { const ta = document.getElementById('av-text'); if (ta) ta.value = text; }, 300);
}

function cpToAvatarRewritten() {
  const text = document.getElementById('cp-rewritten')?.textContent;
  if (!text) return;
  switchPage('avatar');
  setTimeout(() => { const ta = document.getElementById('av-text'); if (ta) ta.value = text; }, 300);
}

function cpToVideo() {
  const text = document.getElementById('cp-original')?.textContent;
  if (!text) return;
  switchPage('create');
  setTimeout(() => { const ta = document.getElementById('theme-input'); if (ta) ta.value = text.substring(0, 200); }, 300);
}

async function cpToAvatarFromId(contentId) {
  try {
    const resp = await authFetch(`/api/radar/contents/${contentId}`);
    const data = await resp.json();
    if (!data.success) return;
    switchPage('avatar');
    setTimeout(() => { const ta = document.getElementById('av-text-input'); if (ta) { ta.value = data.content.transcript || ''; ta.dispatchEvent(new Event('input')); } }, 300);
  } catch {}
}

async function startReplicate() {
  const contentId = document.getElementById('rep-content')?.value;
  if (!contentId) return alert('请先选择要复刻的内容');
  const style = document.getElementById('rep-style')?.value || 'same';
  const voiceId = document.getElementById('rep-voice')?.value || '';
  const statusEl = document.getElementById('rep-status');
  if (statusEl) { statusEl.style.display = ''; statusEl.innerHTML = '<span style="color:var(--accent)">⚡ 正在创建复刻任务...</span>'; }
  try {
    const resp = await authFetch('/api/radar/replicate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ content_id: contentId, style, voice_id: voiceId }) });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);
    // 轮询任务状态
    pollReplicateTask(data.taskId);
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span style="color:#ef4444">❌ 复刻失败: ${esc(err.message)}</span>`;
  }
}

async function pollReplicateTask(taskId) {
  const statusEl = document.getElementById('rep-status');
  const steps = { processing: '🔄 复刻进行中...', rewrite: '📝 AI改写文案中...', tts: '🎙 生成语音配音...', video: '🎬 生成数字人视频...' };
  let attempts = 0;
  const poll = setInterval(async () => {
    try {
      attempts++;
      const resp = await authFetch(`/api/radar/replicate/tasks/${taskId}`);
      const data = await resp.json();
      if (!data.success) { clearInterval(poll); return; }
      const t = data.task;
      if (t.status === 'done') {
        clearInterval(poll);
        if (statusEl) statusEl.innerHTML = '<span style="color:#22c55e">✅ 复刻完成！</span>';
        loadReplicatePage();
      } else if (t.status === 'error') {
        clearInterval(poll);
        if (statusEl) statusEl.innerHTML = `<span style="color:#ef4444">❌ 复刻失败: ${esc(t.error || '未知错误')}</span>`;
      } else {
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--accent)">${steps[t.status] || steps.processing}</span>`;
      }
      if (attempts > 120) { clearInterval(poll); if (statusEl) statusEl.innerHTML = '<span style="color:#f59e0b">⏱ 任务超时，请稍后刷新查看</span>'; }
    } catch { /* ignore polling errors */ }
  }, 3000);
}

// ═══ 尺寸切换 ═══
function switchAspect(ratio) {
  aspectRatio = ratio;
  document.getElementById('size-169')?.classList.toggle('active', ratio === '16:9');
  document.getElementById('size-916')?.classList.toggle('active', ratio === '9:16');
  document.getElementById('size-11')?.classList.toggle('active', ratio === '1:1');
  const lbl = document.getElementById('sto-ratio-label');
  if (lbl) lbl.textContent = ratio;
  updateCanvasPreview();
}

// ═══ 画布比例预览 ═══
function updateCanvasPreview() {
  const canvas = document.getElementById('sto-canvas');
  if (!canvas) return;
  const arMap = { '16:9': '16/9', '9:16': '9/16', '1:1': '1/1' };
  const ar = arMap[aspectRatio] || '16/9';
  canvas.style.aspectRatio = ar;
  if (aspectRatio === '9:16') {
    canvas.style.height = '100%';
    canvas.style.width = 'auto';
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '100%';
  } else {
    canvas.style.height = 'auto';
    canvas.style.width = '100%';
    canvas.style.maxHeight = '100%';
    canvas.style.maxWidth = '';
  }
}

// ═══ 内容类型切换 ═══
function switchContentType(type) {
  contentType = type;
  document.getElementById('ctype-2d')?.classList.toggle('active', type === '2d');
  document.getElementById('ctype-3d')?.classList.toggle('active', type === '3d');
  // 自动联动渲染类型
  if (type === '2d') {
    switchSceneDim('2d');
    switchCharDim('2d');
  } else {
    switchSceneDim('3d');
    switchCharDim('3d');
  }
  // 切换 2D/3D 后重新渲染模型推荐
  if (videoModelsCache && videoModelsCache.length) {
    // 自动切换到当前维度最匹配的模型（如果当前选择的模型不是推荐）
    autoSelectBestModel(type);
    renderVideoModels(videoModelsCache, _disabledModelsCache || []);
  }
  // 显示模型推荐 toast
  showContentTypeHint(type);
}

function showContentTypeHint(type) {
  let existing = document.getElementById('ctype-hint-toast');
  if (existing) existing.remove();
  const hints = {
    '2d': {
      icon: '🎨',
      title: '2D 动画 / 漫画风格',
      best: 'Wan 2.1、HunyuanVideo、CogVideoX、Hailuo',
      action: 'Kling V2/V3、Seedance 2.0、Runway Gen-4',
      tip: '2D 动画擅长：日漫风、水墨国风、赛博朋克、吉卜力风格'
    },
    '3d': {
      icon: '🎲',
      title: '3D 写实 / 立体风格',
      best: 'Sora 2、Veo 3.1、Runway Gen-4、Kling V3',
      action: 'Kling V3 4K、Seedance 2.0、Veo 3.1',
      tip: '3D 写实擅长：电影级画质、物理仿真、真实光影、4K超清'
    }
  };
  const h = hints[type];
  const toast = document.createElement('div');
  toast.id = 'ctype-hint-toast';
  toast.className = 'ctype-hint-toast';
  toast.innerHTML = `<span class="ctype-hint-icon">${h.icon}</span>
    <b>${h.title}</b><br>
    <span style="opacity:.7;font-size:11px">画质推荐：${h.best}<br>动作/打斗推荐：${h.action}<br>${h.tip}</span>`;
  const anchor = document.getElementById('ctype-2d')?.parentElement?.parentElement;
  if (anchor) anchor.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 6000);
}

// ═══ 渲染维度 ═══
const DIM_LABELS = { '2d': '2D 平面', '3d': '3D 立体' };

function switchSceneDim(dim) {
  sceneDim = dim;
  document.getElementById('scene-dim-2d').classList.toggle('active', dim === '2d');
  document.getElementById('scene-dim-3d').classList.toggle('active', dim === '3d');
  updateDimHint();
}

function switchCharDim(dim) {
  charDim = dim;
  document.getElementById('char-dim-2d').classList.toggle('active', dim === '2d');
  document.getElementById('char-dim-3d').classList.toggle('active', dim === '3d');
  updateDimHint();
}

function updateDimHint() {
  const el = document.getElementById('render-dim-hint');
  if (el) el.textContent = `场景 ${DIM_LABELS[sceneDim]} · 人物 ${DIM_LABELS[charDim]}`;
}

// ═══ 语音配音 ═══
// AI 生成当前场景的配音台词
async function aiGenerateDialogue() {
  const s = customScenes.find(s => s.id === studioSelectedSceneId);
  if (!s) { alert('请先选择一个场景'); return; }
  const btn = document.querySelector('.srp-voice-gen-btn');
  if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }
  try {
    const resp = await authFetch('/api/story/generate', {
      method: 'POST',
      body: JSON.stringify({
        theme: `为以下场景生成一段简短的旁白配音文字（50字以内，适合语音合成）：\n场景标题：${s.title}\n场景描述：${s.description}\n只返回旁白文字，不要任何解释`,
        scene_count: 1
      })
    });
    const data = await resp.json();
    // 从返回内容提取文本
    let text = '';
    if (data.data?.story?.scenes?.[0]?.dialogue) {
      text = data.data.story.scenes[0].dialogue;
    } else if (data.data?.story?.scenes?.[0]?.action) {
      text = data.data.story.scenes[0].action;
    } else if (typeof data.data?.story === 'string') {
      text = data.data.story.replace(/["""]/g, '').trim().slice(0, 100);
    }
    if (text) {
      s.dialogue = text;
      const el = document.getElementById('srp-scene-dialogue');
      if (el) el.value = text;
    }
  } catch (e) {
    alert('生成失败: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'AI 生成'; }
  }
}

// 试听语音
async function previewVoice(voiceId) {
  const v = allVoices.find(v => v.id === voiceId);
  if (!v) return;
  const btn = document.querySelector(`.voice-card[onclick*="${voiceId}"] .voice-preview-btn`);
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    const resp = await authFetch('/api/story/preview-voice', {
      method: 'POST',
      body: JSON.stringify({ voice_id: voiceId, text: '欢迎使用VIDO AI视频创作平台，让创意变为现实。' })
    });
    const data = await resp.json();
    if (data.success && data.audio_url) {
      const audio = new Audio(data.audio_url);
      audio.play().catch(() => {});
    } else {
      alert(data.error || '试听失败');
    }
  } catch (e) {
    alert('试听失败: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '▶'; }
  }
}

function toggleVoice(enabled) {
  voiceEnabled = enabled;
  document.getElementById('voice-options').style.display = enabled ? 'block' : 'none';
  document.getElementById('voice-off-hint').style.display = enabled ? 'none' : 'block';
  if (enabled && allVoices.length === 0) loadVoices();
  // 配音轨道标签
  const vlbl = document.getElementById('tl-voice-lbl');
  if (vlbl) vlbl.classList.toggle('has-voice', enabled);
}

function toggleSubtitle(enabled) {
  subtitleEnabled = enabled;
  document.getElementById('subtitle-options').style.display = enabled ? '' : 'none';
  document.getElementById('subtitle-off-hint').style.display = enabled ? 'none' : '';
}

function pickSubColor(btn, color) {
  subtitleColor = color;
  document.querySelectorAll('.sub-color-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function switchVoiceGender(gender) {
  voiceGender = gender;
}

async function loadVoices() {
  const list = document.getElementById('voice-list');
  if (!list) return;
  list.innerHTML = '<div class="voice-list-loading">加载音色中...</div>';
  try {
    const res = await authFetch('/api/story/voices');
    const data = await res.json();
    allVoices = data.voices || [];
    renderVoiceList();
  } catch {
    list.innerHTML = '<div class="voice-list-empty">加载失败，将使用默认音色</div>';
  }
}

function renderVoiceList() {
  const list = document.getElementById('voice-list');
  if (!list) return;
  const filtered = voiceFilter === 'all' ? allVoices : allVoices.filter(v => v.gender === voiceFilter);
  if (!filtered.length) {
    list.innerHTML = '<div class="voice-list-empty">暂无可用音色，请在 AI 设置中添加语音供应商</div>';
    return;
  }
  // 按供应商分组
  const groups = {};
  filtered.forEach(v => {
    if (!groups[v.provider]) groups[v.provider] = [];
    groups[v.provider].push(v);
  });
  let html = '';
  for (const [provider, voices] of Object.entries(groups)) {
    html += `<div class="voice-group-label">${voices[0].providerIcon} ${provider}</div>`;
    voices.forEach(v => {
      const isActive = selectedVoiceId === v.id;
      const genderLabel = { female: '女', male: '男', child: '童' }[v.gender] || '';
      html += `<div class="voice-card ${isActive ? 'active' : ''}" onclick="selectVoice('${v.id}')">
        <div class="voice-card-info">
          <div class="voice-card-name">${esc(v.name)}</div>
        </div>
        <span class="voice-card-gender">${genderLabel}</span>
        ${v.tag ? `<span class="voice-card-tag">${esc(v.tag)}</span>` : ''}
        <button class="voice-preview-btn" onclick="event.stopPropagation();previewVoice('${v.id}')" title="试听">▶</button>
      </div>`;
    });
  }
  list.innerHTML = html;
}

function filterVoices(filter) {
  voiceFilter = filter;
  document.querySelectorAll('.voice-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  renderVoiceList();
}

function selectVoice(id) {
  selectedVoiceId = id;
  const v = allVoices.find(v => v.id === id);
  if (v) {
    voiceGender = v.gender === 'child' ? 'female' : v.gender;
    const nameEl = document.getElementById('voice-selected-name');
    const provEl = document.getElementById('voice-selected-provider');
    const row = document.getElementById('voice-selected-row');
    if (nameEl) nameEl.textContent = v.name;
    if (provEl) provEl.textContent = v.provider;
    if (row) row.style.display = 'flex';
  }
  renderVoiceList(); // 刷新高亮
}

// ═══ Studio 导航 ═══
function switchStudioTab(tab) {
  if (tab === 'audio') tab = 'script'; // 音讯已合并到剧本 Step 7
  studioTab = tab;
  const tabs = ['script', 'scene', 'character'];
  tabs.forEach(t => {
    const nav = document.getElementById('snav-' + t);
    const pane = document.getElementById('stab-' + t);
    if (nav) nav.classList.toggle('active', t === tab);
    if (pane) pane.style.display = t === tab ? 'flex' : 'none';
  });
  // sync side icons
  document.querySelectorAll('.sto-si').forEach(el => el.classList.remove('active'));
  if (tab === 'script') document.querySelector('.sto-si')?.classList.add('active');
}

function toggleStudioPanel() {
  const panel = document.getElementById('sto-panel');
  const icon = document.getElementById('sto-colbtn-icon');
  if (!panel) return;
  const collapsed = panel.classList.toggle('collapsed');
  if (icon) icon.style.transform = collapsed ? 'scaleX(-1)' : '';
}

// ═══ Studio 日期时间 ═══
function updateStudioDatetime() {
  const el = document.getElementById('sto-datetime');
  if (!el) return;
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  el.textContent = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// ═══ Studio Aspect Ratio ═══
function studioToggleAspect() {
  const ratios = ['16:9', '9:16', '1:1'];
  const next = ratios[(ratios.indexOf(aspectRatio) + 1) % ratios.length];
  switchAspect(next);
}

// ═══ Studio Tool ═══
function setStudioTool(tool) {
  document.querySelectorAll('.sto-tool').forEach(b => b.classList.remove('active'));
  document.getElementById('stool-' + tool)?.classList.add('active');
}

// ═══ Studio 角色列表（紧凑格式） ═══
function renderCharacters() {
  const list = document.getElementById('characters-list');
  const badge = document.getElementById('char-count-badge');
  if (badge) badge.textContent = '共 ' + characters.length + ' 个角色';
  const dot = document.getElementById('snav-char-dot');
  if (dot) dot.style.display = characters.length ? 'block' : 'none';
  if (!list) return;
  if (!characters.length) {
    list.innerHTML = '<div style="font-size:11px;color:var(--text3);text-align:center;padding:16px 8px">还没有角色，点击下方添加</div>';
    return;
  }
  list.innerHTML = characters.map((c, i) => {
    const hasImg = !!c.imageUrl;
    const isLoading = loadingCharIds.has(c.id);
    const isActive = c.id === studioSelectedCharId;
    return `<div class="sto-list-item ${isActive ? 'active' : ''} ${isLoading ? 'loading' : ''}" onclick="selectCharacter(${c.id})">
      <div class="sto-li-row1">
        <label class="sto-li-check" onclick="event.stopPropagation()">
          <input type="checkbox" ${c.checked ? 'checked' : ''} onchange="toggleCharCheck(${c.id},this.checked)" />
        </label>
        ${isLoading
          ? `<span class="sto-li-spin">⟳</span>`
          : `<span class="sto-li-warn ${hasImg ? 'ok' : ''}" title="${hasImg ? '已生成形象' : '未生成形象'}">!</span>`}
        <span class="sto-li-name">${esc(c.name || '角色 '+(i+1))}</span>
        <button class="sto-li-del" onclick="removeCharacter(${c.id});event.stopPropagation()" ${isLoading ? 'disabled' : ''}>
          <svg width="11" height="12" viewBox="0 0 11 12" fill="none"><path d="M1.5 3h8M3.5 3V2h4v1M4 5v4M7 5v4M2.5 3l.5 7h5l.5-7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="sto-li-desc">${isLoading ? '正在生成形象...' : esc(buildCharDesc(c))}</div>
    </div>`;
  }).join('');
}

function buildCharDesc(c) {
  const parts = [];
  const type = c.charType || 'human';
  const typeLabel = CHAR_TYPES[type]?.label || '人物';
  parts.push('【' + typeLabel + '】');
  if (type === 'human') {
    if (c.theme) parts.push(c.theme);
  } else {
    if (c.subCategory) parts.push(c.subCategory);
  }
  if (c.species) parts.push(c.species);
  if (c.description) parts.push(c.description);
  return parts.join(' ') || '（未填写描述）';
}

function toggleCharCheck(id, checked) {
  const c = characters.find(c => c.id === id);
  if (c) c.checked = checked;
}
function selectAllChars(checked) {
  characters.forEach(c => c.checked = checked);
  renderCharacters();
}

// ═══ Studio 场景列表（紧凑格式） ═══
function renderScenes() {
  const list = document.getElementById('scenes-list-edit');
  const badge = document.getElementById('scene-count-badge');
  if (badge) badge.textContent = '共 ' + customScenes.length + ' 个场景';
  const dot = document.getElementById('snav-scene-dot');
  if (dot) dot.style.display = customScenes.length ? 'block' : 'none';
  if (!list) return;
  if (!customScenes.length) {
    list.innerHTML = '<div style="font-size:11px;color:var(--text3);text-align:center;padding:16px 8px">还没有场景，点击下方添加</div>';
    return;
  }
  list.innerHTML = customScenes.map((s, i) => {
    const isActive = s.id === studioSelectedSceneId;
    return `<div class="sto-list-item ${isActive ? 'active' : ''}" onclick="selectScene(${s.id})">
      <div class="sto-li-row1">
        <label class="sto-li-check" onclick="event.stopPropagation()">
          <input type="checkbox" ${s.checked ? 'checked' : ''} onchange="toggleSceneCheck(${s.id},this.checked)" />
        </label>
        <span class="sto-li-warn ${(s.description && s.description.trim()) ? 'ok' : ''}" title="${(s.description && s.description.trim()) ? '已填写描述' : '缺少场景描述'}">!</span>
        <span class="sto-li-name">${esc(s.title || '场景 '+(i+1))}</span>
        <button class="sto-li-del" onclick="removeScene(${s.id});event.stopPropagation()">
          <svg width="11" height="12" viewBox="0 0 11 12" fill="none"><path d="M1.5 3h8M3.5 3V2h4v1M4 5v4M7 5v4M2.5 3l.5 7h5l.5-7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="sto-li-row2">
        ${s.imageUrl ? `<img class="sto-li-thumb" src="${esc(s.imageUrl)}" />` : ''}
        <div class="sto-li-desc">${esc(buildSceneDesc(s))}</div>
      </div>
      <div class="sto-li-dialogue" onclick="event.stopPropagation();selectScene(${s.id});switchStudioTab('scene')">
        <span class="sto-li-dialogue-icon">CC</span>
        <span class="sto-li-dialogue-text">${s.dialogue ? esc(s.dialogue.slice(0,30)) + (s.dialogue.length>30?'...':'') : '<em>点击编辑字幕</em>'}</span>
      </div>
    </div>`;
  }).join('');
  updateDurationHint();
}

function buildSceneDesc(s) {
  const parts = [];
  if (s.video_provider && s.video_model) {
    const m = (videoModelsCache || []).find(v => v.providerId === s.video_provider && v.modelId === s.video_model);
    parts.push('🎬' + (m ? m.modelName : s.video_model));
  }
  if (s.location) parts.push('【地点】' + s.location);
  if (s.timeOfDay) parts.push('【时间】' + s.timeOfDay);
  if (s.mood) parts.push('【氛围】' + s.mood);
  if (s.description) parts.push(s.description);
  return parts.join(' ') || '（未填写描述）';
}

function toggleSceneCheck(id, checked) {
  const s = customScenes.find(s => s.id === id);
  if (s) s.checked = checked;
}
function selectAllScenes(checked) {
  customScenes.forEach(s => s.checked = checked);
  renderScenes();
}

// ═══ 右侧属性面板：选择角色 ═══
function selectCharacter(id) {
  studioSelectedCharId = id;
  studioSelectedSceneId = null;
  const c = characters.find(c => c.id === id);
  if (!c) return;
  renderCharacters();
  showRightPanel('character');
  // Fill common fields
  document.getElementById('srp-char-name').value = c.name || '';
  const cDim = c.dim || '2d';
  document.getElementById('srp-char-dim-2d')?.classList.toggle('active', cDim === '2d');
  document.getElementById('srp-char-dim-3d')?.classList.toggle('active', cDim === '3d');
  document.getElementById('srp-char-desc').value = c.description || '';

  // 恢复角色类型
  const type = c.charType || 'human';
  setCharType(type);

  // 恢复类型专属字段
  if (type === 'human') {
    setSelectVal('srp-char-theme', c.theme || '古代');
    setSelectVal('srp-char-gender', c.gender || 'female');
    setSelectVal('srp-char-race', c.race || '人');
    setSelectVal('srp-char-age', c.age || '青年');
  } else if (type === 'animal') {
    setSelectVal('srp-char-animal-cat', c.subCategory || '宠物');
    const speciesInp = document.getElementById('srp-char-species');
    if (speciesInp) speciesInp.value = c.species || '';
    renderAnimalBreeds();
  } else if (type === 'mythical') {
    setSelectVal('srp-char-myth-origin', c.subCategory || '中国神话');
    const mythInp = document.getElementById('srp-char-myth-species');
    if (mythInp) mythInp.value = c.species || '';
    renderMythBreeds();
  } else if (type === 'alien') {
    setSelectVal('srp-char-alien-form', c.subCategory || '人形');
    setSelectVal('srp-char-alien-size', c.alienSize || '中型');
    const alienInp = document.getElementById('srp-char-alien-species');
    if (alienInp) alienInp.value = c.species || '';
  } else if (type === 'robot') {
    setSelectVal('srp-char-robot-type', c.subCategory || '人形机器人');
    setSelectVal('srp-char-robot-func', c.robotFunc || '战斗');
    const robotInp = document.getElementById('srp-char-robot-model');
    if (robotInp) robotInp.value = c.species || '';
  } else if (type === 'monster') {
    setSelectVal('srp-char-monster-cat', c.subCategory || '丧尸');
    const monsterInp = document.getElementById('srp-char-monster-name');
    if (monsterInp) monsterInp.value = c.species || '';
    renderMonsterBreeds();
  }

  // Portrait
  const portrait = document.getElementById('srp-char-portrait');
  if (portrait) {
    portrait.innerHTML = c.imageUrl
      ? `<img src="${esc(c.imageUrl)}" class="srp-portrait-img" onclick="openLightbox('${esc(c.imageUrl)}','${esc(c.name || '')}')" style="cursor:zoom-in" />`
      : `<div class="srp-portrait-ph"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.4"/><path d="M4 22c0-4.42 3.58-8 8-8s8 3.58 8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><span>暂无形象</span></div>`;
  }
}

function syncCharProp(field, value) {
  const c = characters.find(c => c.id === studioSelectedCharId);
  if (!c) return;
  c[field] = value;
  renderCharacters();
}

// ═══ 右侧属性面板：选择场景 ═══
function selectScene(id) {
  studioSelectedSceneId = id;
  studioSelectedCharId = null;
  const s = customScenes.find(s => s.id === id);
  if (!s) return;
  renderScenes();
  showRightPanel('scene');
  document.getElementById('srp-scene-name').value = s.title || '';
  const sDim = s.dim || '2d';
  document.getElementById('srp-scene-dim-2d')?.classList.toggle('active', sDim === '2d');
  document.getElementById('srp-scene-dim-3d')?.classList.toggle('active', sDim === '3d');
  // 显示场景视频模型
  const vmValEl = document.getElementById('srp-model-val');
  if (vmValEl) {
    if (s.video_provider && s.video_model) {
      const m = (videoModelsCache || []).find(v => v.providerId === s.video_provider && v.modelId === s.video_model);
      vmValEl.textContent = m ? `${m.providerName} · ${m.modelName}` : `${s.video_provider} · ${s.video_model}`;
    } else {
      vmValEl.textContent = '跟随全局默认';
    }
  }
  setSelectVal('srp-scene-theme', s.theme || '魔幻');
  setSelectVal('srp-scene-cat', s.category || '室外');
  setSelectVal('srp-scene-time', s.timeOfDay || '白天');
  setSelectVal('srp-scene-camera', s.camera_move || '');
  setSelectVal('srp-scene-shottype', s.shot_type || '');
  updateStoryboardPreview(s);
  document.getElementById('srp-scene-desc').value = s.description || '';
  // 字幕/配音文本
  const dialogueEl = document.getElementById('srp-scene-dialogue');
  if (dialogueEl) dialogueEl.value = s.dialogue || '';
  // Scene preview image
  const preview = document.getElementById('srp-scene-preview');
  if (preview) {
    preview.innerHTML = s.imageUrl
      ? `<img src="${esc(s.imageUrl)}" onclick="openLightbox('${esc(s.imageUrl)}','${esc(s.title || '')}')" style="cursor:zoom-in" />`
      : `<div class="srp-portrait-ph"><svg width="32" height="32" viewBox="0 0 24 24" fill="none"><rect x="2" y="3" width="20" height="18" rx="2" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="9" r="2" stroke="currentColor" stroke-width="1.2"/><path d="M2 17l5-5 3 3 4-4 8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>暂无概念图</span></div>`;
  }
  const sceneBtn = document.getElementById('srp-gen-scene-img');
  if (sceneBtn) sceneBtn.textContent = s.imageUrl ? '🔄 重新生成' : '🎨 生成概念图';
  // Restore first/last frame previews
  restoreFramePreview('first', s.firstFrameUrl);
  restoreFramePreview('last', s.lastFrameUrl);
}

function syncSceneProp(field, value) {
  const s = customScenes.find(s => s.id === studioSelectedSceneId);
  if (!s) return;
  s[field] = value;
  if (field === 'title') document.getElementById('srp-scene-name').textContent = value || '场景';
  if (field === 'camera_move' || field === 'shot_type') updateStoryboardPreview(s);
  renderScenes();
}

function updateStoryboardPreview(scene) {
  const frame = document.getElementById('srp-sb-frame');
  const meta = document.getElementById('srp-sb-meta');
  if (!frame || !meta) return;

  const CAMERA_LABELS = {
    static:'固定',push_in:'推',pull_out:'拉',pan_left:'左摇',pan_right:'右摇',
    tilt_up:'上仰',tilt_down:'下俯',tracking:'跟拍',dolly_zoom:'希区柯克',
    orbit:'环绕360°',crane_up:'升',crane_down:'降',handheld:'手持',
    first_person:'第一视角',over_shoulder:'过肩',aerial:'航拍',
    whip_pan:'甩镜',slow_zoom:'缓推',bullet_time:'子弹时间'
  };
  const SHOT_LABELS = {
    extreme_wide:'大远景',wide:'远景',full:'全景',medium:'中景',
    medium_close:'中近景',close_up:'特写',extreme_close:'大特写',
    low_angle:'仰拍',high_angle:'俯拍',birds_eye:'鸟瞰',dutch_angle:'荷兰角'
  };
  // SVG icons for camera movements
  const CAMERA_ICONS = {
    push_in:'<svg width="28" height="28" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="10" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 2"/><path d="M14 8v12M10 12l4-4 4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pull_out:'<svg width="28" height="28" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="10" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 2"/><path d="M14 8v12M10 16l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pan_left:'<svg width="28" height="28" viewBox="0 0 28 28" fill="none"><path d="M20 14H8M12 10l-4 4 4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pan_right:'<svg width="28" height="28" viewBox="0 0 28 28" fill="none"><path d="M8 14h12M16 10l4 4-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    orbit:'<svg width="28" height="28" viewBox="0 0 28 28" fill="none"><ellipse cx="14" cy="14" rx="10" ry="6" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 2"/><path d="M22 10l2 4-4 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    tracking:'<svg width="28" height="28" viewBox="0 0 28 28" fill="none"><rect x="6" y="8" width="10" height="12" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M18 14h6M22 11l3 3-3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  const cam = scene.camera_move || '';
  const shot = scene.shot_type || '';

  if (!cam && !shot) {
    frame.innerHTML = '<div class="srp-sb-empty">选择镜头运动和景别后自动生成分镜描述</div>';
    meta.innerHTML = '';
    return;
  }

  // Frame icon
  const icon = CAMERA_ICONS[cam] || '<svg width="28" height="28" viewBox="0 0 28 28" fill="none"><rect x="4" y="7" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.2"/><circle cx="14" cy="14" r="3" stroke="currentColor" stroke-width="1.2"/></svg>';
  frame.innerHTML = scene.imageUrl
    ? `<img src="${esc(scene.imageUrl)}" /><div style="position:absolute;bottom:2px;right:2px;background:rgba(0,0,0,.6);border-radius:4px;padding:1px 4px;font-size:8px;color:var(--accent)">${CAMERA_LABELS[cam] || ''}</div>`
    : icon;

  // Meta tags
  const tags = [];
  if (cam) tags.push(`<span class="sb-tag">${CAMERA_LABELS[cam] || cam}</span>`);
  if (shot) tags.push(`<span class="sb-tag">${SHOT_LABELS[shot] || shot}</span>`);
  if (scene.timeOfDay) tags.push(`<span class="sb-tag">${scene.timeOfDay}</span>`);
  const title = scene.title ? `<div style="font-weight:600;margin-bottom:2px">${esc(scene.title)}</div>` : '';
  meta.innerHTML = title + tags.join('') + (scene.camera ? `<div style="margin-top:3px;font-size:9px;color:var(--text3)">${esc(scene.camera)}</div>` : '');
}

// ═══ 2D/3D 维度 per item ═══
function setCharDim(dim) {
  const c = characters.find(c => c.id === studioSelectedCharId);
  if (!c) return;
  c.dim = dim;
  document.getElementById('srp-char-dim-2d')?.classList.toggle('active', dim === '2d');
  document.getElementById('srp-char-dim-3d')?.classList.toggle('active', dim === '3d');
  renderCharacters();
}
function setSceneDim(dim) {
  const s = customScenes.find(s => s.id === studioSelectedSceneId);
  if (!s) return;
  s.dim = dim;
  document.getElementById('srp-scene-dim-2d')?.classList.toggle('active', dim === '2d');
  document.getElementById('srp-scene-dim-3d')?.classList.toggle('active', dim === '3d');
  // 自动推荐匹配维度的最佳模型
  if (videoModelsCache?.length && (!s.video_model || !s.video_provider)) {
    const sorted = [...videoModelsCache].sort((a, b) => modelSortScore(b.modelId, dim) - modelSortScore(a.modelId, dim));
    if (sorted.length) {
      const best = sorted[0];
      const cap = getModelCap(best.modelId);
      if (cap.dim === dim || cap.dim === 'both') {
        selectSceneVideoModel(best.providerId, best.modelId);
      }
    }
  }
}

function setSelectVal(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  for (let opt of el.options) { if (opt.value === val) { opt.selected = true; break; } }
}

// ═══ 场景视频模型选择器 ═══
function toggleSceneVmPicker() {
  const picker = document.getElementById('srp-scene-vm-picker');
  if (!picker) return;
  const show = picker.style.display === 'none';
  picker.style.display = show ? 'block' : 'none';
  if (show) populateSceneVmList();
}

function populateSceneVmList() {
  const list = document.getElementById('srp-scene-vm-list');
  if (!list) return;
  const s = customScenes.find(s => s.id === studioSelectedSceneId);
  const curProvider = s?.video_provider || '';
  const curModel = s?.video_model || '';
  const dim = s?.dim || sceneDim || '2d';
  let html = `<div class="srp-mp-opt ${!curProvider ? 'active' : ''}" onclick="selectSceneVideoModel('','')">
    <span style="opacity:.6">🔄</span> 跟随全局默认
  </div>`;
  if (videoModelsCache && videoModelsCache.length) {
    // 按维度匹配度排序
    const sorted = [...videoModelsCache].sort((a, b) => modelSortScore(b.modelId, dim) - modelSortScore(a.modelId, dim));
    // 分组：推荐 vs 其他
    const rec = sorted.filter(m => { const c = getModelCap(m.modelId); return c.dim === dim || c.dim === 'both'; });
    const alt = sorted.filter(m => { const c = getModelCap(m.modelId); return c.dim !== dim && c.dim !== 'both'; });
    if (rec.length) {
      html += `<div style="padding:4px 10px 2px;color:var(--accent);font-size:10px;font-weight:600">⭐ ${dim === '3d' ? '3D' : '2D'} 推荐</div>`;
      for (const m of rec) {
        const active = m.providerId === curProvider && m.modelId === curModel;
        const cap = getModelCap(m.modelId);
        const badge = cap.note ? `<span style="opacity:.5;font-size:10px;margin-left:4px">${cap.note}</span>` : '';
        html += `<div class="srp-mp-opt ${active ? 'active' : ''}" onclick="selectSceneVideoModel('${esc(m.providerId)}','${esc(m.modelId)}')">
          ${esc(m.modelName)}${badge}
        </div>`;
      }
    }
    if (alt.length) {
      html += `<div style="padding:4px 10px 2px;opacity:.4;font-size:10px;font-weight:600">其他模型</div>`;
      for (const m of alt) {
        const active = m.providerId === curProvider && m.modelId === curModel;
        html += `<div class="srp-mp-opt ${active ? 'active' : ''}" style="opacity:.6" onclick="selectSceneVideoModel('${esc(m.providerId)}','${esc(m.modelId)}')">
          ${esc(m.modelName)}
        </div>`;
      }
    }
  }
  list.innerHTML = html;
}

function selectSceneVideoModel(providerId, modelId) {
  const s = customScenes.find(s => s.id === studioSelectedSceneId);
  if (s) {
    s.video_provider = providerId || '';
    s.video_model = modelId || '';
  }
  const el = document.getElementById('srp-model-val');
  if (el) {
    if (providerId && modelId) {
      const m = (videoModelsCache || []).find(v => v.providerId === providerId && v.modelId === modelId);
      el.textContent = m ? `${m.providerName} · ${m.modelName}` : `${providerId} · ${modelId}`;
    } else {
      el.textContent = '跟随全局默认';
    }
  }
  toggleSceneVmPicker();
  renderScenes();
}

// ═══ 生成选中项 ═══
function generateSelectedItem() {
  if (studioSelectedCharId) {
    genCharPortraitFromPanel();
  } else if (studioSelectedSceneId) {
    genSceneImageFromPanel();
  } else {
    startGeneration();
  }
}

// ═══ 场景概念图生成 ═══
async function genSceneImageFromPanel() {
  if (!studioSelectedSceneId) return;
  const id = studioSelectedSceneId;
  const s = customScenes.find(s => s.id === id);
  if (!s) return;
  const btn = document.getElementById('srp-gen-scene-img');
  const preview = document.getElementById('srp-scene-preview');
  if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }
  if (preview) preview.innerHTML = '<div class="srp-portrait-ph"><span style="font-size:20px;animation:spin 1s linear infinite;display:inline-block">⟳</span><span>正在生成...</span></div>';
  try {
    const res = await authFetch('/api/story/generate-scene-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: s.title || '',
        description: s.description || '',
        theme: s.theme || '',
        timeOfDay: s.timeOfDay || '',
        category: s.category || '',
        dim: s.dim || sceneDim || '2d'
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    s.imageUrl = data.data.imageUrl;
    if (preview) preview.innerHTML = `<img src="${esc(s.imageUrl)}" onclick="openLightbox('${esc(s.imageUrl)}','${esc(s.title || '')}')" style="cursor:zoom-in" />`;
    if (btn) btn.textContent = '🔄 重新生成';
  } catch (e) {
    if (preview) preview.innerHTML = '<div class="srp-portrait-ph"><span style="color:var(--error);font-size:11px">生成失败: ' + esc(e.message) + '</span></div>';
    if (btn) btn.textContent = '🎨 生成概念图';
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ═══ 批量预览场景概念图 ═══
let batchPreviewRunning = false;

async function batchPreviewScenes() {
  const scenes = customScenes.filter(s => s.title.trim() || s.description.trim());
  if (!scenes.length) { showToast('请先添加场景', 'error'); return; }
  showCanvasGallery(scenes);
  if (batchPreviewRunning) return;
  batchPreviewRunning = true;
  const btn = document.getElementById('btn-preview-scenes');
  const regenBtn = document.getElementById('cg-regen-btn');
  if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }
  if (regenBtn) { regenBtn.disabled = true; regenBtn.textContent = '生成中...'; }
  // Generate missing concept images (max 2 concurrent)
  const needGen = scenes.filter(s => !s.imageUrl);
  let completed = 0;
  const total = needGen.length;
  if (total === 0) {
    batchPreviewRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = '预览全部'; }
    if (regenBtn) { regenBtn.disabled = false; regenBtn.textContent = '全部重新生成'; }
    return;
  }
  const concurrency = 2;
  let idx = 0;
  async function worker() {
    while (idx < needGen.length) {
      const s = needGen[idx++];
      const cardImg = document.getElementById('cg-img-' + s.id);
      if (cardImg) cardImg.innerHTML = '<div class="cg-generating"><span style="font-size:16px;animation:spin 1s linear infinite;display:inline-block">⟳</span><span>生成中...</span></div>';
      try {
        const res = await authFetch('/api/story/generate-scene-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: s.title || '',
            description: s.description || '',
            theme: s.theme || '',
            timeOfDay: s.timeOfDay || '',
            category: s.category || '',
            dim: s.dim || sceneDim || '2d'
          })
        });
        const data = await res.json();
        if (data.success) {
          s.imageUrl = data.data.imageUrl;
          if (cardImg) cardImg.innerHTML = `<img src="${esc(s.imageUrl)}" />`;
        } else {
          if (cardImg) cardImg.innerHTML = '<div class="cg-placeholder"><span style="color:var(--error)">生成失败</span></div>';
        }
      } catch (e) {
        if (cardImg) cardImg.innerHTML = '<div class="cg-placeholder"><span style="color:var(--error)">错误</span></div>';
      }
      completed++;
      const countEl = document.getElementById('cg-count');
      if (countEl) countEl.textContent = `${completed}/${total} 已生成`;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  batchPreviewRunning = false;
  if (btn) { btn.disabled = false; btn.textContent = '预览全部'; }
  if (regenBtn) { regenBtn.disabled = false; regenBtn.textContent = '全部重新生成'; }
  renderScenes(); // update thumbnails
}

function showCanvasGallery(scenes) {
  const gallery = document.getElementById('canvas-gallery');
  const grid = document.getElementById('cg-grid');
  const countEl = document.getElementById('cg-count');
  if (!gallery || !grid) return;
  const withImg = scenes.filter(s => s.imageUrl).length;
  if (countEl) countEl.textContent = `${withImg}/${scenes.length} 已生成`;
  grid.innerHTML = scenes.map((s, i) => `
    <div class="cg-card" onclick="openLightbox('${esc(s.imageUrl || '')}','${esc(s.title || '场景'+(i+1))}')" oncontextmenu="event.preventDefault();regenSinglePreview(${s.id})">
      <div class="cg-card-img" id="cg-img-${s.id}">
        ${s.imageUrl
          ? `<img src="${esc(s.imageUrl)}" />`
          : `<div class="cg-placeholder"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="2" y="3" width="20" height="18" rx="2" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="9" r="2" stroke="currentColor" stroke-width="1"/><path d="M2 17l5-5 3 3 4-4 8 8" stroke="currentColor" stroke-width="1.2"/></svg><span>待生成</span></div>`
        }
      </div>
      <div class="cg-card-info">
        <div class="cg-card-title">${esc(s.title || '场景 ' + (i+1))}</div>
        <div class="cg-card-desc">${esc(s.description || '未填写描述').substring(0, 40)}</div>
      </div>
      <div class="cg-card-badge">场景 ${i+1}</div>
      <button class="cg-card-regen" onclick="event.stopPropagation();regenSinglePreview(${s.id})" title="重新生成">⟳</button>
    </div>
  `).join('');
  gallery.style.display = 'flex';
  show('canvas-idle', false);
}

function closeCanvasGallery() {
  const gallery = document.getElementById('canvas-gallery');
  if (gallery) gallery.style.display = 'none';
  const vid = document.getElementById('center-video');
  if (vid && vid.src && vid.style.display === 'block') return; // keep video if playing
  show('canvas-idle', true);
}

async function regenSinglePreview(sceneId) {
  const s = customScenes.find(s => s.id === sceneId);
  if (!s) return;
  const cardImg = document.getElementById('cg-img-' + s.id);
  if (cardImg) cardImg.innerHTML = '<div class="cg-generating"><span style="font-size:16px;animation:spin 1s linear infinite;display:inline-block">⟳</span><span>重新生成...</span></div>';
  try {
    const res = await authFetch('/api/story/generate-scene-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: s.title || '',
        description: s.description || '',
        theme: s.theme || '',
        timeOfDay: s.timeOfDay || '',
        category: s.category || '',
        dim: s.dim || sceneDim || '2d'
      })
    });
    const data = await res.json();
    if (data.success) {
      s.imageUrl = data.data.imageUrl;
      if (cardImg) cardImg.innerHTML = `<img src="${esc(s.imageUrl)}" />`;
    } else {
      if (cardImg) cardImg.innerHTML = '<div class="cg-placeholder"><span style="color:var(--error)">失败</span></div>';
    }
  } catch (e) {
    if (cardImg) cardImg.innerHTML = '<div class="cg-placeholder"><span style="color:var(--error)">错误</span></div>';
  }
  renderScenes();
}

// ═══ 首帧/尾帧上传 ═══
async function uploadSceneFrame(type, input) {
  if (!studioSelectedSceneId || !input.files?.length) return;
  const s = customScenes.find(s => s.id === studioSelectedSceneId);
  if (!s) return;
  const file = input.files[0];
  const formData = new FormData();
  formData.append('image', file);
  const dropEl = document.getElementById(type === 'first' ? 'srp-ff-drop' : 'srp-lf-drop');
  if (dropEl) dropEl.innerHTML = '<span style="font-size:14px;animation:spin 1s linear infinite;display:inline-block;color:var(--text3)">⟳</span>';
  try {
    const res = await authFetch('/api/i2v/upload-image', { method: 'POST', body: formData });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    const url = data.data.imageUrl;
    if (type === 'first') s.firstFrameUrl = url;
    else s.lastFrameUrl = url;
    restoreFramePreview(type, url);
  } catch (e) {
    restoreFramePreview(type, null);
    showToast('上传失败: ' + e.message, 'error');
  }
  input.value = '';
}

function restoreFramePreview(type, url) {
  const dropEl = document.getElementById(type === 'first' ? 'srp-ff-drop' : 'srp-lf-drop');
  if (!dropEl) return;
  const inputId = type === 'first' ? 'srp-ff-input' : 'srp-lf-input';
  if (url) {
    dropEl.innerHTML = `<img src="${esc(url)}" onclick="openLightbox('${esc(url)}','${type === 'first' ? '首帧' : '尾帧'}')" style="cursor:zoom-in" /><button class="srp-frame-clear" onclick="event.stopPropagation();clearSceneFrame('${type}')" title="清除">✕</button>`;
  } else {
    dropEl.innerHTML = `<input type="file" id="${inputId}" accept="image/*" style="display:none" onchange="uploadSceneFrame('${type}',this)" /><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    dropEl.onclick = () => document.getElementById(inputId)?.click();
  }
}

function clearSceneFrame(type) {
  const s = customScenes.find(s => s.id === studioSelectedSceneId);
  if (!s) return;
  if (type === 'first') s.firstFrameUrl = null;
  else s.lastFrameUrl = null;
  restoreFramePreview(type, null);
}

async function genCharPortraitFromPanel() {
  if (!studioSelectedCharId) return;
  const id = studioSelectedCharId;
  const btn = document.getElementById('srp-gen-portrait');
  const portrait = document.getElementById('srp-char-portrait');
  if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }
  if (portrait) portrait.innerHTML = '<div class="srp-portrait-ph"><span style="font-size:20px;animation:spin 1s linear infinite;display:inline-block">⟳</span></div>';
  loadingCharIds.add(id);
  renderCharacters();
  try {
    await generateCharImage(id);
    const c = characters.find(c => c.id === id);
    if (c?.imageUrl && portrait) portrait.innerHTML = `<img src="${esc(c.imageUrl)}" class="srp-portrait-img" onclick="openLightbox('${esc(c.imageUrl)}','${esc(c.name || '')}')" style="cursor:zoom-in" />`;
    if (btn) btn.textContent = '🔄 重新生成';
  } catch (e) {
    if (portrait) portrait.innerHTML = '<div class="srp-portrait-ph"><span style="color:var(--error);font-size:11px">生成失败</span></div>';
    if (btn) btn.textContent = '🎨 生成形象';
  } finally {
    loadingCharIds.delete(id);
    renderCharacters();
    if (btn) btn.disabled = false;
  }
}

async function genAllCharPortraits() {
  const targets = characters.filter(c => c.name.trim());
  if (!targets.length) return;
  const btn = document.getElementById('btn-gen-all-chars');
  if (btn) { btn.disabled = true; btn.textContent = `生成中 0/${targets.length}...`; }
  targets.forEach(c => loadingCharIds.add(c.id));
  renderCharacters();
  let done = 0;
  await Promise.allSettled(targets.map(async c => {
    try {
      await generateCharImage(c.id);
      // If this char is currently selected, update portrait panel
      if (studioSelectedCharId === c.id && c.imageUrl) {
        const portrait = document.getElementById('srp-char-portrait');
        if (portrait) portrait.innerHTML = `<img src="${esc(c.imageUrl)}" class="srp-portrait-img" onclick="openLightbox('${esc(c.imageUrl)}','${esc(c.name || '')}')" style="cursor:zoom-in" />`;
        const genBtn = document.getElementById('srp-gen-portrait');
        if (genBtn) genBtn.textContent = '🔄 重新生成';
      }
    } finally {
      loadingCharIds.delete(c.id);
      done++;
      if (btn) btn.textContent = `生成中 ${done}/${targets.length}...`;
      renderCharacters();
    }
  }));
  if (btn) { btn.disabled = false; btn.textContent = '全部生成'; }
}

// ═══ 参数面板（预留） ═══
function toggleParamPanel() {
  // TODO: open a params overlay
}

// ═══ 时间轴 ═══

// ═══ 播放指针位置更新（统一函数） ═══
function updateTlPlayhead(timeSec) {
  const ph = document.getElementById('tl-playhead');
  if (!ph) return;
  const pixPerSec = studioTlZoom * 10;
  const scrollEl = document.getElementById('tl-ruler-area');
  const scrollLeft = scrollEl ? scrollEl.scrollLeft : 0;
  const xPx = 110 + timeSec * pixPerSec - scrollLeft;
  // 限制在轨道区域内（110px ~ 容器宽度）
  ph.style.left = Math.max(110, xPx) + 'px';
  ph.style.display = xPx < 110 ? 'none' : '';
}

// 标尺拖拽快速定位
function initRulerScrub() {
  const rulerArea = document.getElementById('tl-ruler-area');
  if (!rulerArea) return;

  let autoScrollRAF = null;

  function seekFromX(clientX) {
    const rect = rulerArea.getBoundingClientRect();
    const xInContent = clientX - rect.left + rulerArea.scrollLeft;
    const pixPerSec = studioTlZoom * 10;
    const timeSec = Math.max(0, xInContent / pixPerSec);
    const vid = document.getElementById('center-video');
    if (vid && vid.duration) vid.currentTime = Math.min(timeSec, vid.duration);
    updateTlPlayhead(timeSec);

    // 靠近边缘自动滚动
    const edge = 40;
    const relX = clientX - rect.left;
    if (relX < edge) {
      rulerArea.scrollLeft = Math.max(0, rulerArea.scrollLeft - 8);
      syncAllScroll(rulerArea);
    } else if (relX > rect.width - edge) {
      rulerArea.scrollLeft += 8;
      syncAllScroll(rulerArea);
    }
  }

  function syncAllScroll(src) {
    const els = document.querySelectorAll('.tl-scroll-sync');
    els.forEach(el => { if (el !== src) el.scrollLeft = src.scrollLeft; });
  }

  // 标尺 + 轨道区域都可以点击/拖拽定位
  document.querySelectorAll('.tl-track-area.tl-scroll-sync').forEach(el => {
    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('.tl-clip-trim') || e.target.closest('.tl-mclip-handle') || e.target.closest('.tl-mclip-body')) return;
      e.preventDefault();
      seekFromX(e.clientX);
      const onMove = (ev) => seekFromX(ev.clientX);
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });

  // 视频播放时指针跟随
  const vid = document.getElementById('center-video');
  if (vid) {
    vid.addEventListener('timeupdate', () => updateTlPlayhead(vid.currentTime));
  }

  // 播放指针自身可拖拽
  const ph = document.getElementById('tl-playhead');
  if (ph) {
    ph.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const onMove = (ev) => seekFromX(ev.clientX);
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}

// 横向滚动同步
function initScrollSync() {
  setTimeout(() => {
    const els = Array.from(document.querySelectorAll('.tl-scroll-sync'));
    if (!els.length) return;
    let syncing = false;
    els.forEach(el => {
      el.addEventListener('scroll', () => {
        if (syncing) return;
        syncing = true;
        const sl = el.scrollLeft;
        els.forEach(other => { if (other !== el) other.scrollLeft = sl; });
        const vid = document.getElementById('center-video');
        if (vid) updateTlPlayhead(vid.currentTime);
        syncing = false;
      });
    });
  }, 100);
}

function renderTimeline() {
  const clips = document.getElementById('tl-clips');
  const ruler = document.getElementById('tl-ruler');
  if (!clips || !ruler) return;
  const zoom = studioTlZoom;
  const pixPerSec = zoom * 10;
  // 计算总时长：取视频场景、音乐、60秒中的最大值
  const items = customScenes.length ? customScenes : [];
  let offset = 0;
  const totalDurSecs = items.reduce((sum, s) => sum + (s.duration || 10), 0);
  const totalSecs = Math.max(60, totalDurSecs + 10, musicDuration ? musicDuration + 5 : 0);
  // 标尺刻度
  let rulerHtml = '';
  for (let i = 0; i <= totalSecs; i += 5) {
    const m = Math.floor(i / 60), s = i % 60;
    const label = m > 0 ? `${m}:${String(s).padStart(2,'0')}` : `0:${String(i).padStart(2,'0')}`;
    rulerHtml += `<div class="tl-ruler-tick" style="left:${i * pixPerSec}px"><div class="tl-ruler-line"></div><div class="tl-ruler-txt">${label}</div></div>`;
  }
  ruler.innerHTML = rulerHtml;
  const neededWidth = totalSecs * pixPerSec;
  clips.style.width = neededWidth + 'px';
  ruler.style.width = neededWidth + 'px';
  // 同步所有轨道区域和底部滚动条宽度
  const sbInner = document.getElementById('tl-scrollbar-inner');
  if (sbInner) sbInner.style.width = neededWidth + 'px';
  const voiceClips = document.getElementById('tl-voice-clips');
  if (voiceClips) voiceClips.style.width = neededWidth + 'px';
  clips.innerHTML = items.map((s, i) => {
    const dur = s.duration || 10;
    const left = offset * pixPerSec;
    const w = dur * pixPerSec - 2;
    offset += dur;
    const isActive = s.id === studioSelectedSceneId;
    return `<div class="tl-clip ${isActive ? 'active' : ''}" style="left:${left}px;width:${w}px" data-scene-id="${s.id}" data-index="${i}">
      <div class="tl-clip-trim tl-clip-trim-l" data-side="left" data-scene-id="${s.id}"></div>
      <span class="tl-clip-label" onclick="selectScene(${s.id});switchStudioTab('scene')">分镜 ${i+1} <small>${dur}s</small></span>
      <div class="tl-clip-trim tl-clip-trim-r" data-side="right" data-scene-id="${s.id}"></div>
    </div>`;
  }).join('');

  // 绑定视频片段裁剪手柄拖动
  clips.querySelectorAll('.tl-clip-trim').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      const side = handle.dataset.side;
      const sceneId = parseInt(handle.dataset.sceneId);
      const scene = customScenes.find(s => s.id === sceneId);
      if (!scene) return;
      handle.classList.add('dragging');
      const startX = e.clientX;
      const origDur = scene.duration || 10;
      const onMove = ev => {
        const dx = ev.clientX - startX;
        const dSec = dx / pixPerSec;
        if (side === 'right') {
          scene.duration = Math.max(3, Math.round(origDur + dSec));
        } else {
          scene.duration = Math.max(3, Math.round(origDur - dSec));
        }
        renderTimeline();
        renderMusicTrack();
      };
      const onUp = () => {
        handle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        updateDurationHint();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

function tlUpdateZoom(val) {
  studioTlZoom = parseInt(val);
  renderTimeline();
  renderMusicTrack();
}

let tlMusicLoop = true; // 默认循环（与左侧 checkbox 同步）

function tlTogglePlay() {
  const btn = document.getElementById('tl-play-btn');
  if (!btn) return;
  const playing = btn.dataset.playing === '1';
  btn.dataset.playing = playing ? '0' : '1';
  btn.innerHTML = playing
    ? '<svg width="10" height="12" viewBox="0 0 10 12"><path d="M1 1.5l8 4.5-8 4.5z" fill="currentColor"/></svg>'
    : '<svg width="10" height="12" viewBox="0 0 10 12"><rect x="1" y="1" width="3" height="10" rx="1" fill="currentColor"/><rect x="6" y="1" width="3" height="10" rx="1" fill="currentColor"/></svg>';
}

function tlToggleLoop() {
  tlMusicLoop = !tlMusicLoop;
  const btn = document.getElementById('tl-loop-btn');
  if (btn) btn.classList.toggle('active', tlMusicLoop);
  // 同步视频循环
  const vid = document.getElementById('center-video');
  if (vid) vid.loop = tlMusicLoop;
  cvLoopEnabled = tlMusicLoop;
  // 同步到左侧面板的循环 checkbox
  const cb = document.getElementById('music-loop-input');
  if (cb) cb.checked = tlMusicLoop;
}

// ═══ 音乐轨道（时间轴内） ═══
function renderMusicTrack() {
  const track = document.getElementById('tl-music-track');
  const pair = document.getElementById('tl-music-pair');
  if (!track) return;
  if (!musicFilePath || !musicDuration) {
    if (pair) pair.style.display = 'none';
    return;
  }
  if (pair) pair.style.display = '';

  // 如果音乐比当前标尺长，重新渲染标尺以扩展宽度
  const ruler = document.getElementById('tl-ruler');
  if (ruler && musicDuration * studioTlZoom * 10 > ruler.scrollWidth) {
    renderTimeline();
  }

  const pixPerSec = studioTlZoom * 10;
  const fullBar = document.getElementById('tl-music-full-bar');
  const clip = document.getElementById('tl-music-clip');
  if (!clip) return;

  // 全曲底条（虚线框表示完整音频范围）
  if (fullBar) {
    fullBar.style.left = '0';
    fullBar.style.width = (musicDuration * pixPerSec) + 'px';
  }

  // 选中片段
  const startPx = musicTrimStart * pixPerSec;
  const endPx = musicTrimEnd * pixPerSec;
  clip.style.left = startPx + 'px';
  clip.style.width = Math.max(endPx - startPx, 32) + 'px';

  // 信息
  const nameEl = document.getElementById('tl-mclip-name');
  const durEl = document.getElementById('tl-mclip-dur');
  if (nameEl) nameEl.textContent = musicOriginalName || '音乐';
  if (durEl) durEl.textContent = fmtSec(musicTrimStart) + '–' + fmtSec(musicTrimEnd);
}

function fmtSec(s) {
  s = Math.round(s);
  const m = Math.floor(s / 60);
  return m ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

// 裁剪交互
function initMusicTrimDrag() {
  const area = document.getElementById('tl-music-track');
  if (!area) return;

  function pxToSec(x) {
    const pixPerSec = studioTlZoom * 10;
    return Math.max(0, Math.min((x + area.scrollLeft) / pixPerSec, musicDuration));
  }

  // 手柄拖动
  ['tl-mclip-handle-l', 'tl-mclip-handle-r'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const isLeft = id.includes('-l');
    el.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      el.classList.add('dragging');
      const areaRect = area.getBoundingClientRect();
      const onMove = ev => {
        const sec = pxToSec(ev.clientX - areaRect.left);
        if (isLeft) musicTrimStart = Math.max(0, Math.min(sec, musicTrimEnd - 1));
        else musicTrimEnd = Math.min(musicDuration, Math.max(sec, musicTrimStart + 1));
        renderMusicTrack();
      };
      const onUp = () => {
        el.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });

  // 拖动片段整体平移
  const body = document.getElementById('tl-mclip-body');
  if (body) {
    body.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      const pixPerSec = studioTlZoom * 10;
      const startX = e.clientX;
      const origStart = musicTrimStart;
      const origEnd = musicTrimEnd;
      const span = origEnd - origStart;
      const onMove = ev => {
        const dSec = (ev.clientX - startX) / pixPerSec;
        let ns = origStart + dSec, ne = origEnd + dSec;
        if (ns < 0) { ns = 0; ne = span; }
        if (ne > musicDuration) { ne = musicDuration; ns = musicDuration - span; }
        musicTrimStart = ns; musicTrimEnd = ne;
        renderMusicTrack();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}

function initMusicPreview() {
  const audio = document.getElementById('tl-music-audio');
  if (!audio) return;
  // 初始化循环按钮状态
  const loopBtn = document.getElementById('tl-loop-btn');
  if (loopBtn) loopBtn.classList.toggle('active', tlMusicLoop);
  audio.addEventListener('timeupdate', () => {
    if (musicPlayMode === 'trim' && audio.currentTime >= musicTrimEnd) {
      if (tlMusicLoop) {
        audio.currentTime = musicTrimStart;
        audio.play().catch(() => {});
      } else {
        stopMusicPlayback();
      }
    }
  });
  audio.addEventListener('ended', () => {
    if (tlMusicLoop && musicPlayMode !== 'none') {
      // 循环：从裁剪起点或开头重新播放
      audio.currentTime = musicTrimStart || 0;
      audio.play().catch(() => {});
    } else {
      stopMusicPlayback();
    }
  });
}

let musicPlayMode = 'none'; // 'none' | 'full' | 'trim'

let _globalAudio = null; // 全局音频播放器（声音克隆试听等）
function stopAllAudio() {
  stopMusicPlayback();
  // 全局音频
  if (_globalAudio) { _globalAudio.pause(); _globalAudio.src = ''; _globalAudio = null; }
  // 素材预听
  if (typeof _assetAudio !== 'undefined' && _assetAudio) { _assetAudio.pause(); _assetAudio = null; }
  // 裁剪弹窗
  if (typeof mtmAudio !== 'undefined' && mtmAudio) mtmAudio.pause();
  // 预览音频
  const pa = document.getElementById('music-preview-audio');
  if (pa) pa.pause();
  // workbench audio
  const wba = document.getElementById('wb-audio-player');
  if (wba) wba.pause();
}

function stopMusicPlayback() {
  const audio = document.getElementById('tl-music-audio');
  if (audio) audio.pause();
  musicPlayMode = 'none';
  const fb = document.getElementById('tl-music-full');
  const tb = document.getElementById('tl-music-trim-play');
  if (fb) { fb.textContent = '🔊'; fb.classList.remove('playing'); }
  if (tb) { tb.textContent = '▶'; tb.classList.remove('playing'); }
}

function toggleMusicFullPlay() {
  const audio = document.getElementById('tl-music-audio');
  if (!audio) return;
  if (musicPlayMode === 'full') { stopMusicPlayback(); return; }
  stopMusicPlayback();
  musicPlayMode = 'full';
  audio.currentTime = 0;
  audio.play().catch(() => {});
  const btn = document.getElementById('tl-music-full');
  if (btn) { btn.textContent = '⏸'; btn.classList.add('playing'); }
}

function toggleMusicTrimPreview() {
  const audio = document.getElementById('tl-music-audio');
  if (!audio) return;
  if (musicPlayMode === 'trim') { stopMusicPlayback(); return; }
  stopMusicPlayback();
  musicPlayMode = 'trim';
  audio.currentTime = musicTrimStart;
  audio.play().catch(() => {});
  const btn = document.getElementById('tl-music-trim-play');
  if (btn) { btn.textContent = '⏸'; btn.classList.add('playing'); }
}

// ═══ 视频模型选择 ═══
const VM_PROVIDER_ICONS = {
  openai:   '🌀', kling:    '🎬', jimeng:  '🎭', fal:     '⚡', runway:  '✈️',
  luma:     '🌙', minimax: '🎞', zhipu:   '🧠', replicate:'🔄',
  huggingface:'🤗', demo:  '🧪', pika:    '🎨', seedance: '🌱', veo: '🔷',
  vidu:     '🎥'
};

// 模型 2D/3D/动作 适配度数据库（modelId 或 providerId 级别匹配）
const MODEL_CAPS = {
  // --- 2D 动画强项 ---
  'cogvideox-flash':       { dim: '2d',   action: 1, note: '2D动画，动作表现一般' },
  'cogvideox':             { dim: '2d',   action: 1, note: '2D动画' },
  'video-01':              { dim: '2d',   action: 2, note: '2D动画，运动流畅' },
  'video-01-live2d':       { dim: '2d',   action: 1, note: 'Live2D风格，适合对话场景' },
  'modelscope-t2v':        { dim: '2d',   action: 0, note: '低质量2D，仅供测试' },
  'wan-2-1':               { dim: '2d',   action: 1, note: '2D动画' },
  // FAL.ai models
  'fal-ai/wan/v2.1/1.3b/text-to-video':   { dim: '2d',   action: 1, note: '2D动画，轻量快速' },
  'fal-ai/wan/v2.1/14b/text-to-video':    { dim: '2d',   action: 2, note: '2D动画，高质量' },
  'fal-ai/ltx-video':                      { dim: '2d',   action: 1, note: '2D极速生成' },
  'fal-ai/hunyuan-video':                  { dim: '2d',   action: 2, note: '腾讯HunyuanVideo，2D高质量' },
  'fal-ai/kling-video/v1.6/standard/text-to-video': { dim: 'both', action: 2, note: '2D/3D均可，动作不错' },
  'fal-ai/kling-video/v1.6/pro/text-to-video':      { dim: 'both', action: 3, note: '2D/3D高质量，动作优秀' },
  // --- 3D / 写实强项 ---
  'sora-2':                { dim: '3d',   action: 3, note: '3D写实旗舰，动作表现强' },
  'sora-2-mini':           { dim: '3d',   action: 2, note: '3D写实轻量版' },
  'gen3a_turbo':           { dim: '3d',   action: 3, note: 'Runway 3D快速，动作优秀' },
  'gen4_turbo':            { dim: '3d',   action: 3, note: 'Runway 最新3D旗舰' },
  'ray-2':                 { dim: '3d',   action: 2, note: 'Luma 3D写实' },
  'ray-2-720p':            { dim: '3d',   action: 2, note: 'Luma 3D 720p' },
  'pika-2.0':              { dim: 'both', action: 2, note: '2D/3D均可，特效丰富' },
  'pika-1.5':              { dim: 'both', action: 1, note: '快速生成' },
  // --- Kling 直连 ---
  'kling-v2-master':       { dim: 'both', action: 3, note: '最新旗舰，动作/打斗最佳' },
  'kling-v1-6':            { dim: 'both', action: 2, note: '2D/3D均可，动作不错' },
  'kling-v1-5-pro':        { dim: 'both', action: 2, note: '高质量' },
  // --- 即梦 ---
  'jimeng_vgfm_t2v_l20_pro':  { dim: '3d', action: 2, note: '写实3D Pro' },
  'jimeng_vgfm_t2v_l20':      { dim: '3d', action: 2, note: '写实3D标准' },
  'jimeng_vgfm_t2v_l20_lite': { dim: '3d', action: 1, note: '写实3D轻量' },
  // --- Seedance (ByteDance) ---
  'fal-ai/seedance/video/text-to-video':   { dim: 'both', action: 3, note: '动作最强，20秒，原生音频' },
  'fal-ai/seedance/video/image-to-video':  { dim: 'both', action: 3, note: '图生视频，动作最强' },
  // --- Google Veo ---
  'veo-3.1':       { dim: '3d', action: 3, note: '影院级广播级画质，原生音频同步，$0.40/s' },
  'veo-3.1-fast':  { dim: '3d', action: 2, note: '快速版，$0.15/s' },
  'veo-3':         { dim: '3d', action: 3, note: '高质量，音频同步' },
  // --- Kling 3.0 ---
  'kling-v3':              { dim: 'both', action: 3, note: '4K/60fps 旗舰，6镜头故事板，动作最强，最长2分钟' },
  'kling-v2.5-turbo-pro':  { dim: 'both', action: 3, note: '快速，动作优秀' },
  // --- Runway Gen-4.5 ---
  'gen4.5':                { dim: '3d', action: 3, note: 'Runway 最新旗舰，Elo 1247，Motion Brush 精控' },
  'gen4.5_turbo':          { dim: '3d', action: 3, note: 'Runway 4.5 快速版，高级镜头控制' },
  // --- Seedance 2.0 (ByteDance) ---
  'fal-ai/seedance/v2/text-to-video':   { dim: 'both', action: 3, note: 'Seedance 2.0 T2V via FAL，动作极强' },
  'fal-ai/seedance/v2/image-to-video':  { dim: 'both', action: 3, note: 'Seedance 2.0 I2V via FAL，角色一致性引擎' },
  // --- Seedance 2.0 火山方舟直连 ---
  'doubao-seedance-2-0-260128':         { dim: 'both', action: 3, note: '火山方舟 Seedance 2.0 旗舰·视频编辑·音频同步' },
  'doubao-seedance-2-0-t2v-250428':     { dim: 'both', action: 3, note: '火山方舟 Seedance 2.0 T2V·极致画质' },
  'doubao-seedance-2-0-i2v-250428':     { dim: 'both', action: 3, note: '火山方舟 Seedance 2.0 I2V·角色一致' },
  // --- HunyuanVideo 1.5 (Tencent) ---
  'fal-ai/hunyuan-video/v1.5':          { dim: '2d', action: 2, note: '腾讯HunyuanVideo 1.5，开源SOTA，8.3B参数' },
  // --- Wan 2.2 ---
  'fal-ai/wan/v2.2/14b/text-to-video':  { dim: '2d', action: 2, note: 'Wan 2.2 最新版，2D动画高质量' },
  // --- Sora 2 Pro ---
  'sora-2-pro':            { dim: '3d', action: 3, note: 'Sora 2 Pro，25秒原生，故事板时间轴，物理仿真最强' },
  // --- LTX-2 (NVIDIA优化) ---
  'fal-ai/ltx-video/v2':   { dim: '2d', action: 1, note: 'LTX-2，NVIDIA RTX加速，4K本地生成' },
  // --- Pika 2.1 ---
  'pika-2.1':              { dim: 'both', action: 2, note: 'Pika 2.1 Turbo，风格化VFX特效丰富' },
  'pika-2.1-effects':      { dim: 'both', action: 2, note: 'Pika 2.1 特效模式，爆炸/火焰/粒子' },
  // --- Hailuo 2.3 (MiniMax) ---
  'video-02':              { dim: '2d',   action: 2, note: 'Hailuo 2.3，动漫/游戏CG/水墨风最佳，物理引擎升级' },
  'video-02-anime':        { dim: '2d',   action: 2, note: 'Hailuo 2.3 动漫专用模式' },
  // --- Luma Ray3 ---
  'ray-3':                 { dim: '3d',   action: 2, note: 'Luma Ray3，原生HDR，4K升频，最长60秒' },
  // --- Runway Gen-4.5 详细 ---
  'gen4.5-motion':         { dim: '3d',   action: 3, note: 'Gen-4.5 Motion Brush 精控动画区域' },
  // --- Vidu Q3 ---
  'vidu-q3':               { dim: '2d',   action: 2, note: 'Vidu Q3，极快动漫生成，最长120秒，原生音频对话' },
  'vidu-q3-realistic':     { dim: '3d',   action: 2, note: 'Vidu Q3 写实模式，120秒' },
};

function getModelCap(modelId) {
  return MODEL_CAPS[modelId] || { dim: 'both', action: 1, note: '' };
}

// 模型排序分数：推荐的排前面，action 分高的排前面
function modelSortScore(modelId, ctype) {
  const cap = getModelCap(modelId);
  let score = 0;
  if (cap.dim === ctype) score += 100;       // 完全匹配维度
  else if (cap.dim === 'both') score += 50;   // 通用
  // action 能力加分
  score += cap.action * 10;
  return score;
}

// 切换 2D/3D 时自动选择最匹配的推荐模型
function autoSelectBestModel(ctype) {
  if (!videoModelsCache || !videoModelsCache.length) return;
  // 如果当前选择的模型已经是推荐的，不切换
  if (selectedVideoModelId) {
    const curCap = getModelCap(selectedVideoModelId);
    if (curCap.dim === ctype || curCap.dim === 'both') return;
  }
  // 找到最佳匹配模型
  const sorted = [...videoModelsCache].sort((a, b) => modelSortScore(b.modelId, ctype) - modelSortScore(a.modelId, ctype));
  if (sorted.length) {
    const best = sorted[0];
    const bestCap = getModelCap(best.modelId);
    // 只在有明确推荐模型时才自动切换
    if (bestCap.dim === ctype || bestCap.dim === 'both') {
      const prev = selectedVideoModelId;
      selectedVideoProvider = best.providerId;
      selectedVideoModelId = best.modelId;
      if (prev !== best.modelId) {
        showAutoSwitchHint(best, ctype);
      }
    }
  }
}

function showAutoSwitchHint(model, ctype) {
  let existing = document.getElementById('auto-switch-hint');
  if (existing) existing.remove();
  const hint = document.createElement('div');
  hint.id = 'auto-switch-hint';
  hint.className = 'ctype-hint-toast show';
  hint.style.background = 'rgba(33,255,243,.06)';
  hint.style.borderColor = 'rgba(33,255,243,.2)';
  const dimLabel = ctype === '3d' ? '3D' : '2D';
  hint.innerHTML = `<span class="ctype-hint-icon">🔄</span> 已自动切换到 <b>${dimLabel}</b> 推荐模型：<b>${esc(model.providerName)} · ${esc(model.modelName)}</b>`;
  const anchor = document.getElementById('vm-selector');
  if (anchor) anchor.after(hint);
  setTimeout(() => { hint.classList.remove('show'); setTimeout(() => hint.remove(), 300); }, 4000);
}

function isModelRecommended(modelId, ctype) {
  const cap = getModelCap(modelId);
  if (cap.dim === 'both') return true;
  return cap.dim === ctype;
}

function getModelBadge(modelId, ctype) {
  const cap = getModelCap(modelId);
  if (cap.dim === ctype || cap.dim === 'both') return 'rec';      // 推荐
  return 'alt';  // 可用但非最优
}

async function loadVideoModels() {
  const container = document.getElementById('vm-selector');
  if (!container) return;
  try {
    const res = await authFetch('/api/settings');
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    const providers = data.data.providers || [];
    const videoModels = [];
    const disabledModels = [];
    for (const p of providers) {
      const hasKey = !!(p.api_key || p.api_key_masked);
      for (const m of (p.models || [])) {
        if (m.use !== 'video') continue;
        if (p.enabled && hasKey && m.enabled !== false) {
          videoModels.push({ providerId: p.id, providerName: p.name, modelId: m.id, modelName: m.name, modelType: m.type });
        } else {
          let reason = '';
          if (!hasKey) reason = '未配置 API Key';
          else if (!p.enabled) reason = '供应商已禁用';
          else if (m.enabled === false) reason = '模型已禁用';
          disabledModels.push({ providerId: p.id, providerName: p.name, modelId: m.id, modelName: m.name, reason });
        }
      }
    }
    videoModelsCache = videoModels;
    _disabledModelsCache = disabledModels;
    if (!videoModels.length && !disabledModels.length) {
      container.innerHTML = '<div class="vm-empty">未配置视频模型<br><span onclick="window.location.href=\'/admin.html\'" style="color:var(--cyan);cursor:pointer">前往 AI 配置添加</span></div>';
      selectedVideoProvider = null;
      selectedVideoModelId = null;
      updateVmStatus();
      return;
    }
    // 自动选择最匹配当前 2D/3D 模式的模型
    if (!selectedVideoProvider && videoModels.length) {
      const sorted = [...videoModels].sort((a, b) => modelSortScore(b.modelId, contentType) - modelSortScore(a.modelId, contentType));
      selectedVideoProvider = sorted[0].providerId;
      selectedVideoModelId = sorted[0].modelId;
    }
    renderVideoModels(videoModels, disabledModels);
    updateVmStatus();
  } catch (e) {
    container.innerHTML = '<div class="vm-empty">模型加载失败</div>';
  }
}

function renderVideoModels(models, disabledModels) {
  const container = document.getElementById('vm-selector');
  if (!container) return;

  // Trigger button (shows selected model or prompt to choose)
  const selectedModel = models.find(m => m.providerId === selectedVideoProvider && m.modelId === selectedVideoModelId);
  const triggerIcon = selectedModel ? (VM_PROVIDER_ICONS[selectedModel.providerId] || '🔹') : '🎬';
  const triggerLabel = selectedModel ? `${selectedModel.providerName} · ${selectedModel.modelName}` : '选择视频模型...';
  const triggerClass = selectedModel ? 'vm-trigger has-value' : 'vm-trigger';
  container.innerHTML = `<div class="${triggerClass}" id="vm-dd-trigger" onclick="openVmModal()">
    <span class="vm-dd-icon">${triggerIcon}</span>
    <span class="vm-dd-label">${esc(triggerLabel)}</span>
    <svg width="10" height="6" viewBox="0 0 10 6" style="opacity:.4"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>
  </div>`;

  // Build modal content
  const groups = {};
  for (const m of models) {
    if (!groups[m.providerId]) groups[m.providerId] = { name: m.providerName, id: m.providerId, models: [], disabled: [] };
    groups[m.providerId].models.push(m);
  }
  for (const m of (disabledModels || [])) {
    if (!groups[m.providerId]) groups[m.providerId] = { name: m.providerName, id: m.providerId, models: [], disabled: [] };
    groups[m.providerId].disabled.push(m);
  }

  let html = '';
  // 2D/3D recommendation hint
  html += `<div class="vmm-dim-hint" id="vmm-dim-hint"></div>`;
  for (const g of Object.values(groups)) {
    // 按推荐度排序：匹配维度的在前，action 分高的在前
    g.models.sort((a, b) => modelSortScore(b.modelId, contentType) - modelSortScore(a.modelId, contentType));
    const icon = VM_PROVIDER_ICONS[g.id] || '🔹';
    html += `<div class="vmm-group">
      <div class="vmm-group-label">${icon} ${esc(g.name)}</div>
      <div class="vmm-group-list">`;
    for (const m of g.models) {
      const active = m.providerId === selectedVideoProvider && m.modelId === selectedVideoModelId;
      const badge = getModelBadge(m.modelId, contentType);
      const cap = getModelCap(m.modelId);
      const isRec = badge === 'rec';
      const actionStars = cap.action >= 3 ? ' <span class="vmm-tag-action">动作强</span>' : '';
      const recTag = isRec ? ` <span class="vmm-tag-rec">${contentType === '3d' ? '3D推荐' : '2D推荐'}</span>` : '';
      const altTag = !isRec ? ' <span class="vmm-tag-alt">可用</span>' : '';
      const noteText = cap.note ? `<span class="vmm-opt-note">${esc(cap.note)}</span>` : '';
      html += `<div class="vmm-opt ${active ? 'active' : ''} ${!isRec ? 'vmm-dim-soft' : ''}" onclick="selectVideoModel('${esc(m.providerId)}','${esc(m.modelId)}')">
          <div class="vmm-opt-icon">${icon}</div>
          <div class="vmm-opt-info">
            <div class="vmm-opt-name">${esc(m.modelName)}${recTag}${altTag}${actionStars}</div>
            <div class="vmm-opt-id">${esc(m.modelId)} ${noteText}</div>
          </div>
          <div class="vmm-opt-check">✓</div>
        </div>`;
    }
    for (const m of (g.disabled || [])) {
      html += `<div class="vmm-opt vmm-disabled">
          <div class="vmm-opt-icon" style="opacity:.3">${icon}</div>
          <div class="vmm-opt-info">
            <div class="vmm-opt-name" style="opacity:.4">${esc(m.modelName)}</div>
            <div class="vmm-opt-reason">${esc(m.reason)}</div>
          </div>
        </div>`;
    }
    html += `</div></div>`;
  }
  document.getElementById('vmm-body').innerHTML = html;
  updateVmModalHint();
}

function updateVmModalHint() {
  const hint = document.getElementById('vmm-dim-hint');
  if (!hint) return;
  if (contentType === '3d') {
    hint.innerHTML = '🎲 当前为 <b>3D 写实/立体</b> 模式<br><span style="opacity:.7;font-size:11px">画质旗舰：<b>Veo 3.1、Sora 2 Pro、Kling 3.0</b><br>动作/打斗：<b>Kling 3.0、Seedance 2.0、Runway Gen-4.5</b><br>标有 <span class="vmm-tag-rec" style="font-size:9px">3D推荐</span> 的模型效果最佳</span>';
    hint.style.display = '';
  } else {
    hint.innerHTML = '🎨 当前为 <b>2D 动画/漫画</b> 模式<br><span style="opacity:.7;font-size:11px">画质推荐：<b>Wan 2.2、HunyuanVideo 1.5、CogVideoX、Hailuo</b><br>动作/打斗：<b>Kling V3、Seedance 2.0</b><br>标有 <span class="vmm-tag-rec" style="font-size:9px">2D推荐</span> 的模型效果最佳</span>';
    hint.style.display = '';
  }
}

function openVmModal() {
  updateVmModalHint();
  document.getElementById('modal-vm').classList.add('open');
}
function closeVmModal() {
  document.getElementById('modal-vm').classList.remove('open');
}

function selectVideoModel(providerId, modelId) {
  selectedVideoProvider = providerId;
  selectedVideoModelId = modelId;
  // Update modal options
  document.querySelectorAll('.vmm-opt').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.vmm-opt').forEach(el => {
    const oc = el.getAttribute('onclick') || '';
    if (oc.includes(providerId) && oc.includes(modelId)) el.classList.add('active');
  });
  // Update trigger
  const trigger = document.getElementById('vm-dd-trigger');
  if (trigger) {
    trigger.classList.add('has-value');
    const m = (videoModelsCache || []).find(v => v.providerId === providerId && v.modelId === modelId);
    const icon = VM_PROVIDER_ICONS[providerId] || '🔹';
    const label = m ? `${m.providerName} · ${m.modelName}` : `${providerId} · ${modelId}`;
    trigger.querySelector('.vm-dd-icon').textContent = icon;
    trigger.querySelector('.vm-dd-label').textContent = label;
  }
  // Close modal
  closeVmModal();
  // 隐藏验证提示
  const val = document.getElementById('vm-validation');
  if (val) val.style.display = 'none';
  const stepVm = document.getElementById('step-vm');
  if (stepVm) stepVm.classList.remove('stp-step-error');
  updateVmStatus();
}

function updateVmStatus() {
  const el = document.getElementById('vm-status');
  if (!el) return;
  if (selectedVideoProvider && selectedVideoModelId) {
    const m = (videoModelsCache || []).find(v => v.providerId === selectedVideoProvider && v.modelId === selectedVideoModelId);
    el.textContent = m ? m.providerName : selectedVideoProvider;
    el.style.color = 'var(--cyan)';
  } else {
    el.textContent = '请选择';
    el.style.color = 'var(--error,#ff4d6d)';
  }
}


// 动物角色字段切换
// ═══ 角色类型切换系统 ═══
function setCharType(type) {
  const c = characters.find(c => c.id === studioSelectedCharId);
  if (c) {
    c.charType = type;
    const def = CHAR_TYPES[type];
    if (def) {
      c.race = def.race;
      c.gender = def.gender;
    }
  }
  // 更新按钮状态
  document.querySelectorAll('#srp-char-type-grid .srp-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === type);
  });
  // 显示/隐藏对应字段区域
  const typeIds = ['human','animal','mythical','alien','robot','monster'];
  typeIds.forEach(t => {
    const el = document.getElementById('srp-tf-' + t);
    if (el) el.style.display = t === type ? '' : 'none';
  });
  // 更新描述 placeholder
  const descEl = document.getElementById('srp-char-desc');
  const descLabel = document.getElementById('srp-desc-label');
  if (descEl && CHAR_TYPES[type]) descEl.placeholder = CHAR_TYPES[type].descPh;
  if (descLabel) {
    const labels = { human:'角色描述', animal:'外貌描述', mythical:'形态描述', alien:'外形描述', robot:'外观描述', monster:'形态描述' };
    descLabel.textContent = labels[type] || '描述';
  }
  // 渲染品种标签
  if (type === 'animal') renderAnimalBreeds();
  if (type === 'mythical') renderMythBreeds();
  if (type === 'monster') renderMonsterBreeds();
  renderCharacters();
}

function renderAnimalBreeds() {
  const cat = document.getElementById('srp-char-animal-cat')?.value || '宠物';
  const breeds = ANIMAL_BREEDS[cat] || [];
  const container = document.getElementById('srp-breed-tags');
  if (!container) return;
  const c = characters.find(c => c.id === studioSelectedCharId);
  const current = c?.species || '';
  container.innerHTML = breeds.map(b =>
    `<span class="srp-breed-tag ${current === b.n ? 'active' : ''}" onclick="pickBreed('${b.n}','srp-char-species')"><span class="breed-icon">${b.icon}</span>${b.n}</span>`
  ).join('');
}

function renderMythBreeds() {
  const origin = document.getElementById('srp-char-myth-origin')?.value || '中国神话';
  const breeds = MYTH_BREEDS[origin] || [];
  const container = document.getElementById('srp-myth-tags');
  if (!container) return;
  const c = characters.find(c => c.id === studioSelectedCharId);
  const current = c?.species || '';
  container.innerHTML = breeds.map(b =>
    `<span class="srp-breed-tag ${current === b.n ? 'active' : ''}" onclick="pickBreed('${b.n}','srp-char-myth-species')"><span class="breed-icon">${b.icon}</span>${b.n}</span>`
  ).join('');
}

function renderMonsterBreeds() {
  const cat = document.getElementById('srp-char-monster-cat')?.value || '丧尸';
  const breeds = MONSTER_BREEDS[cat] || [];
  const container = document.getElementById('srp-monster-tags');
  if (!container) return;
  const c = characters.find(c => c.id === studioSelectedCharId);
  const current = c?.species || '';
  container.innerHTML = breeds.map(b =>
    `<span class="srp-breed-tag ${current === b.n ? 'active' : ''}" onclick="pickBreed('${b.n}','srp-char-monster-name')"><span class="breed-icon">${b.icon}</span>${b.n}</span>`
  ).join('');
}

function pickBreed(name, inputId) {
  const inp = document.getElementById(inputId);
  if (inp) { inp.value = name; }
  syncCharProp('species', name);
  // 也更新角色名（如果当前没有名字）
  const c = characters.find(c => c.id === studioSelectedCharId);
  if (c && !c.name) {
    c.name = name;
    const nameInp = document.getElementById('srp-char-name');
    if (nameInp) nameInp.value = name;
  }
  // 刷新 tag 高亮
  const type = c?.charType || 'human';
  if (type === 'animal') renderAnimalBreeds();
  if (type === 'mythical') renderMythBreeds();
  if (type === 'monster') renderMonsterBreeds();
  renderCharacters();
}

function toggleAnimalFields() {
  // 兼容旧逻辑 — 现在通过 setCharType 处理
}

// ═══ 风格选择 ═══
function renderStyleGrid() {
  const grid = document.getElementById('style-grid');
  if (!grid) return;
  grid.innerHTML = ANIM_STYLES.map(s => {
    const active = s.id === animStyle;
    return `<div class="style-chip ${active ? 'active' : ''}" data-sid="${s.id}" onclick="switchAnimStyle('${s.id}')" style="--sc: ${s.color}">
      <span class="sc-icon">${s.icon}</span>
      <span class="sc-text">${esc(s.label)}</span>
    </div>`;
  }).join('');
}

function switchAnimStyle(id) {
  animStyle = id;
  document.querySelectorAll('#style-grid .style-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.sid === id);
  });
}

// ═══ 高级设置折叠 ═══
function toggleAdvancedSettings() {
  const body = document.getElementById('stp-adv-body');
  const arrow = document.getElementById('stp-adv-arrow');
  if (!body) return;
  const open = body.style.display === 'none';
  body.style.display = open ? '' : 'none';
  if (arrow) arrow.classList.toggle('open', open);
}

// ═══ 模式切换 ═══
function switchMode(mode) {
  creationMode = mode;
  ['ai', 'custom', 'script', 'longform'].forEach(m => {
    const el = document.getElementById('mode-' + m);
    if (el) el.classList.toggle('active', m === mode);
  });
  show('section-ai',       mode === 'ai');
  show('section-script',   mode === 'script');
  show('section-plot',     mode === 'custom');
  show('section-longform', mode === 'longform');
  // 长篇模式自动推荐中国风格
  if (mode === 'longform' && !['xianxia','wuxia','guoman','guofeng_3d','ink_battle','ink'].includes(animStyle)) {
    switchAnimStyle('xianxia');
  }
}

function show(id, visible) {
  const el = document.getElementById(id);
  if (!el) return;
  if (visible) { el.style.display = 'block'; el.style.animation = 'fadeUp .3s ease'; }
  else { el.style.display = 'none'; }
}

// ═══ 故事示例 ═══
function setExample(text) {
  const ta = document.getElementById('input-theme');
  ta.value = text;
  updateCharCount(ta, 'story-cnt');
  ta.focus();
  // 同时提取简短标题填入标题栏（取前10字或第一个逗号前）
  const titleInput = document.getElementById('input-title');
  if (titleInput && !titleInput.value.trim()) {
    const short = text.split(/[，,。]/)[0].substring(0, 15);
    titleInput.value = short;
  }
  // 检测动作/打斗/特效内容，精准提示推荐模型
  detectActionContent(text);
}

// ═══ 模板快速启动系统 ═══
const TEMPLATES = {
  banana_cat: {
    title: '香蕉猫大战仓鼠军团',
    theme: '一只穿着香蕉皮斗篷的猫咪战士，手持古风长枪，与成群的仓鼠盾兵展开史诗级搞笑战斗，画面充满火焰特效和夸张动作',
    anim_style: '3d_render',
    duration: 30,
    characters: [
      { name: '香蕉猫', role: 'main', charType: 'animal', description: '穿着黄色香蕉皮斗篷的猫咪战士，圆脸大眼，手持古风长枪，表情凶狠但萌感十足', gender: 'male', species: '猫', subCategory: '宠物' },
      { name: '仓鼠士兵', role: 'supporting', charType: 'animal', description: '一群穿着微型盔甲、手持木盾和小刀的仓鼠士兵，圆滚滚的身材', gender: 'male', species: '仓鼠', subCategory: '宠物' }
    ],
    scenes: [
      { title: '冲锋陷阵', description: '香蕉猫手持长枪全速冲锋，身后烟尘滚滚，天空中火球飞坠', location: '荒凉战场', mood: '热血激昂', category: '战场', timeOfDay: '傍晚' },
      { title: '重重围困', description: '数十只仓鼠士兵举起木盾围成圆阵，香蕉猫被困在正中央蓄力旋转', location: '沙漠平原', mood: '紧张对峙', category: '战场', timeOfDay: '白天' },
      { title: '怒吼跳斩', description: '香蕉猫腾空跃起张嘴怒吼，长枪从空中劈下带出火焰旋涡', location: '战场上空', mood: '霸气震撼', category: '战场', timeOfDay: '傍晚' },
      { title: '最终爆发', description: '香蕉猫释放超级冲击波，仓鼠士兵四散飞出画面，火焰碎片漫天', location: '爆炸中心', mood: '史诗终结', category: '战场', timeOfDay: '黄昏' }
    ]
  },
  sword: {
    title: '剑来·少年问剑',
    theme: '少年剑客在仙侠世界中求道问剑，经历古城送别、竹林论剑、山巅悟道的成长之旅，画面充满东方仙侠美学',
    anim_style: 'anime',
    duration: 60,
    characters: [
      { name: '陈平安', role: 'main', charType: 'human', description: '朴素少年，身穿麻布衣裳，背负一把木剑，眼神坚毅而温和', gender: 'male', theme: '仙侠', race: '人', age: '少年' },
      { name: '宁姚', role: 'supporting', charType: 'human', description: '英姿飒爽的少女剑修，白衣银甲，腰悬三尺青锋，气质冷傲', gender: 'female', theme: '仙侠', race: '人', age: '青年' }
    ],
    scenes: [
      { title: '小镇送别', description: '陈平安站在古老小镇的城门口，回望熟悉的街巷，晨雾中踏上旅途', location: '骊珠洞天小镇', mood: '离别惆怅', category: '室外', timeOfDay: '清晨', theme: '仙侠' },
      { title: '竹林论剑', description: '竹林深处，陈平安与宁姚对剑而立，剑气纵横间竹叶纷飞', location: '翠竹林', mood: '紧张肃穆', category: '自然', timeOfDay: '白天', theme: '仙侠' },
      { title: '山巅悟道', description: '陈平安独坐山巅，俯瞰云海翻涌，手中木剑渐渐泛起光芒', location: '仙山之巅', mood: '壮阔顿悟', category: '自然', timeOfDay: '黄昏', theme: '仙侠' }
    ]
  },
  mecha: {
    title: '钢铁黎明',
    theme: '末世废墟中，最后一台巨型机甲「天罚」对抗变异巨兽，守护人类最后的城市',
    anim_style: '3d_render',
    duration: 30,
    characters: [
      { name: '天罚机甲', role: 'main', charType: 'robot', description: '20米高的人形战斗机甲，银灰色装甲覆盖全身，胸口有蓝色能量核心发光，右臂是巨型光刃', gender: 'none' },
      { name: '变异巨兽', role: 'supporting', charType: 'monster', description: '三头黑色巨兽，身高15米，全身覆盖甲壳，口中喷射酸液，尾巴带有骨刺', gender: 'none' }
    ],
    scenes: [
      { title: '废墟对峙', description: '天罚机甲站在倒塌的摩天大楼间，警报声中变异巨兽从黑雾中浮现', location: '废墟都市', mood: '压迫紧张', category: '城市', timeOfDay: '夜晚', theme: '末世' },
      { title: '激战爆发', description: '巨兽喷射酸液，天罚用能量盾格挡后发射导弹群，爆炸掀起冲击波', location: '战场废墟', mood: '激烈燃烧', category: '战场', timeOfDay: '夜晚', theme: '末世' },
      { title: '超载一击', description: '天罚启动超载模式全身金光闪耀，光刃贯穿巨兽核心，黎明破晓', location: '城市上空', mood: '史诗胜利', category: '战场', timeOfDay: '清晨', theme: '末世' }
    ]
  },
  cat_adventure: {
    title: '白猫奇遇记',
    theme: '一只叫小雪的白猫在月光下的屋顶上追逐萤火虫，途中结识流浪猫朋友，温馨治愈的夜晚冒险',
    anim_style: 'anime',
    duration: 30,
    characters: [
      { name: '小雪', role: 'main', charType: 'animal', description: '雪白的短毛猫，蓝色大眼睛，粉色鼻头，毛发柔软蓬松，好奇心旺盛', gender: 'female', species: '白猫', subCategory: '宠物' },
      { name: '阿黑', role: 'supporting', charType: 'animal', description: '黑色流浪猫，一只耳朵缺了个角，眼神警觉但善良，身手敏捷', gender: 'male', species: '黑猫', subCategory: '宠物' }
    ],
    scenes: [
      { title: '月下屋顶', description: '小雪跳上屋顶，发现漫天萤火虫在月光下飞舞，伸出小爪子好奇触碰', location: '老城屋顶', mood: '温馨梦幻', category: '室外', timeOfDay: '夜晚' },
      { title: '偶遇朋友', description: '追逐萤火虫时遇到独自觅食的阿黑，两猫对视后小心翼翼靠近', location: '小巷围墙', mood: '温暖友善', category: '室外', timeOfDay: '夜晚' },
      { title: '一起看星', description: '小雪和阿黑并排趴在屋檐上，萤火虫环绕身旁，一起望着星空', location: '屋檐上', mood: '宁静治愈', category: '室外', timeOfDay: '夜晚' }
    ]
  },
  cyberpunk: {
    title: '霓虹暗影',
    theme: '2077年的赛博都市，黑客少女潜入巨型企业窃取被囚禁的AI意识，霓虹灯下的数字逃亡',
    anim_style: 'anime',
    duration: 60,
    characters: [
      { name: '零', role: 'main', charType: 'human', description: '赛博朋克黑客少女，半边脸有发光电路纹路，紫色短发，穿着改装皮夹克，手臂有机械义肢', gender: 'female', theme: '未来', age: '青年' },
      { name: 'ARIA', role: 'supporting', charType: 'robot', description: '被囚禁的AI意识，以全息投影形态出现，半透明蓝色光影，温柔而忧伤的面容', gender: 'female' }
    ],
    scenes: [
      { title: '霓虹街巷', description: '零穿行在雨夜的赛博都市街道，全息广告和霓虹灯在积水中倒映', location: '赛博都市街道', mood: '孤独神秘', category: '城市', timeOfDay: '夜晚', theme: '科幻' },
      { title: '数字潜入', description: '零接入企业服务器，数据流化为光线在黑暗空间中流淌，发现了ARIA', location: '虚拟空间', mood: '紧张科幻', category: '室内', timeOfDay: '夜晚', theme: '科幻' },
      { title: '霓虹逃亡', description: '零带着ARIA的数据在城市天台间飞跃，身后追兵的红色激光扫射', location: '城市天台', mood: '刺激惊险', category: '城市', timeOfDay: '夜晚', theme: '科幻' }
    ]
  },
  ocean: {
    title: '深海遗迹探秘',
    theme: '深海探险队在马里亚纳海沟发现一座发光的古代海底遗迹，但遗迹的守护者苏醒了',
    anim_style: 'anime',
    duration: 30,
    characters: [
      { name: '林海', role: 'main', charType: 'human', description: '年轻的深海探险家，穿着高科技潜水服，头盔内透出坚定的目光', gender: 'male', theme: '现代', age: '青年' },
      { name: '守护者', role: 'supporting', charType: 'mythical', description: '沉睡万年的海底巨型生物，身体由珊瑚与水晶构成，发出幽蓝色光芒', gender: 'none' }
    ],
    scenes: [
      { title: '深渊下潜', description: '潜水器缓缓下沉进入漆黑深海，探照灯照亮周围奇异的深海生物', location: '马里亚纳海沟', mood: '神秘未知', category: '自然', timeOfDay: '夜晚' },
      { title: '遗迹现身', description: '海底出现巨大的发光建筑群，晶莹的柱廊和拱门散发着蓝绿色光芒', location: '海底遗迹', mood: '震撼壮观', category: '室外', timeOfDay: '夜晚' },
      { title: '守护者苏醒', description: '遗迹中心的水晶棺裂开，守护者缓缓苏醒，巨大的身影笼罩探险队', location: '遗迹中心', mood: '敬畏紧张', category: '室内', timeOfDay: '夜晚' }
    ]
  }
};

function applyTemplate(tplId) {
  const tpl = TEMPLATES[tplId];
  if (!tpl) return;

  // 标记选中状态
  document.querySelectorAll('.stp-tpl-card').forEach(c => c.classList.remove('applied'));
  event.currentTarget.classList.add('applied');

  // 切换到 AI 自动模式
  switchMode('ai');

  // 填充标题和主题
  document.getElementById('input-title').value = tpl.title;
  const ta = document.getElementById('input-theme');
  ta.value = tpl.theme;
  updateCharCount(ta, 'story-cnt');

  // 设置动画风格
  if (tpl.anim_style) {
    animStyle = tpl.anim_style;
    document.querySelectorAll('#style-grid .style-chip').forEach(el => {
      el.classList.toggle('active', el.dataset.sid === animStyle);
    });
  }

  // 设置时长
  if (tpl.duration) {
    videoDuration = tpl.duration;
    const durMap = { 15: '15秒', 30: '30秒', 60: '1分钟', 120: '2分钟', 180: '3分钟', 300: '5分钟', 600: '10分钟' };
    const durText = durMap[tpl.duration] || '';
    document.querySelectorAll('.dur-btn').forEach(b => {
      b.classList.toggle('active', b.textContent.trim() === durText);
    });
    // 非预设时长显示在自定义按钮上
    if (!durText) {
      const customBtn = document.getElementById('dur-custom-btn');
      if (customBtn) { customBtn.classList.add('active'); customBtn.textContent = fmtDurLabel(tpl.duration); }
    }
  }

  // 清空并填充角色
  characters = [];
  charIdCounter = 0;
  if (tpl.characters) {
    tpl.characters.forEach(ch => {
      const id = ++charIdCounter;
      characters.push({
        id, name: ch.name, role: ch.role || 'main', charType: ch.charType || 'human',
        description: ch.description || '', imageUrl: '', dim: ch.charType === 'human' ? '2d' : '2d',
        theme: ch.theme || '古代', gender: ch.gender || 'female', race: ch.race || '人',
        age: ch.age || '青年', species: ch.species || '', subCategory: ch.subCategory || '',
        checked: false
      });
    });
  }
  renderCharacters();

  // 清空并填充场景
  customScenes = [];
  sceneIdCounter = 0;
  if (tpl.scenes) {
    tpl.scenes.forEach(sc => {
      const id = ++sceneIdCounter;
      customScenes.push({
        id, title: sc.title, location: sc.location || '', description: sc.description || '',
        mood: sc.mood || '', theme: sc.theme || '魔幻', category: sc.category || '室外',
        timeOfDay: sc.timeOfDay || '白天', dim: '2d', imageUrl: null,
        video_provider: '', video_model: '', duration: 10, checked: false
      });
    });
  }
  renderScenes();
  renderTimeline();
  updateDurationHint();

  // 更新 tab 指示器
  const charDot = document.getElementById('snav-char-dot');
  const sceneDot = document.getElementById('snav-scene-dot');
  if (charDot && characters.length) charDot.style.display = '';
  if (sceneDot && customScenes.length) sceneDot.style.display = '';

  // 滚动到面板顶部
  const scroll = document.querySelector('.stp-scroll');
  if (scroll) scroll.scrollTop = 0;

  // 提示
  showToast(`已应用模板「${tpl.title}」，${characters.length} 个角色 + ${customScenes.length} 个场景已就绪`, 'ok');

  // 检测动作内容
  detectActionContent(tpl.theme);
}

// 动作内容类型检测数据库
const ACTION_DETECT_RULES = [
  { type: 'combat',    icon: '⚔', label: '近身格斗/武术对决', pattern: /打斗|决斗|格斗|战斗|交锋|对决|武术|搏击|对抗|攻击|出拳|挥剑|拳脚|刀剑|近身|肉搏|拔刀|亮剑/i,
    models: 'Kling V3 / Kling V2 Master / Seedance 2.0 / Runway Gen-4' },
  { type: 'ranged',    icon: '🔫', label: '远程攻击/枪战/魔法', pattern: /枪战|射击|远程|魔法|弹幕|弓箭|炮击|狙击|激光|光束|子弹|开枪|法术|施法/i,
    models: 'Veo 3.1 / Sora 2 / Kling V3 / Runway Gen-4' },
  { type: 'chase',     icon: '🏃', label: '追逐/飞车/高速场景', pattern: /追逐|追击|飞车|赛车|逃跑|追捕|奔跑|狂奔|飙车|速度|冲刺/i,
    models: 'Seedance 2.0 / Kling V3 / Sora 2 / Veo 3.1' },
  { type: 'explosion', icon: '💥', label: '爆炸/大规模破坏', pattern: /爆炸|炸弹|坍塌|摧毁|毁灭|崩塌|破坏|碎裂|粉碎|冲击波|轰炸/i,
    models: 'Veo 3.1 / Kling V3 / Runway Gen-4 / Sora 2' },
  { type: 'power',     icon: '⚡', label: '能量爆发/变身/大招', pattern: /能量|爆发|变身|觉醒|大招|释放|蓄力|超能力|气场|光芒|解封|封印|神力/i,
    models: 'Kling V3 / Seedance 2.0 / Veo 3.1 / Sora 2' },
  { type: 'aerial',    icon: '🦅', label: '空战/飞行/高空场景', pattern: /空战|飞行|飞天|翱翔|坠落|空中|太空|天空|滑翔|俯冲|升空/i,
    models: 'Veo 3.1 / Sora 2 / Kling V3 / Runway Gen-4' },
  { type: 'stealth',   icon: '🗡', label: '潜行/暗杀/偷袭', pattern: /潜行|暗杀|偷袭|刺客|忍者|隐身|伏击|暗影|无声|突袭/i,
    models: 'Kling V2 Master / Runway Gen-4 / Seedance 2.0' },
  { type: 'mecha',     icon: '🤖', label: '机甲/巨型对决', pattern: /机甲|巨人|泰坦|机器人|高达|变形|合体|巨兽|怪兽大战/i,
    models: 'Veo 3.1 / Kling V3 / Sora 2 / Runway Gen-4' },
];

function detectActionContent(text) {
  if (!text || text.length < 5) return;
  for (const rule of ACTION_DETECT_RULES) {
    if (rule.pattern.test(text)) {
      showActionModelHint(rule);
      return;
    }
  }
}

function showActionModelHint(rule) {
  if (!rule) rule = ACTION_DETECT_RULES[0]; // 默认 combat
  let existing = document.getElementById('action-model-hint');
  if (existing) existing.remove();
  const hint = document.createElement('div');
  hint.id = 'action-model-hint';
  hint.className = 'ctype-hint-toast show';
  hint.style.background = 'rgba(255,107,53,.06)';
  hint.style.borderColor = 'rgba(255,107,53,.18)';
  hint.innerHTML = `<span class="ctype-hint-icon">${rule.icon}</span> 检测到 <b>${rule.label}</b> 内容<br>
    <span style="opacity:.7;font-size:11px">推荐模型：<b>${rule.models}</b><br>
    标有 <span class="vmm-tag-action" style="font-size:9px">动作强</span> 的模型对此类场景效果最佳。系统会自动增强视觉特效 prompt（冲击波/粒子/运动模糊等）</span>`;
  const anchor = document.getElementById('mode-examples');
  if (anchor) anchor.after(hint);
  setTimeout(() => { hint.classList.remove('show'); setTimeout(() => hint.remove(), 300); }, 8000);
}

function updateCharCount(el, targetId) {
  const max = el.id === 'input-theme' ? 5000 : el.id === 'av-text-input' ? 3000 : 1000;
  const cnt = document.getElementById(targetId);
  if (cnt) cnt.textContent = el.value.length + ' / ' + max;
}

let _actionDetectTimer = null;
let _actionHintShown = false;
function debouncedActionDetect(text) {
  clearTimeout(_actionDetectTimer);
  _actionDetectTimer = setTimeout(() => {
    if (_actionHintShown) return;
    if (text && text.length > 10) {
      for (const rule of ACTION_DETECT_RULES) {
        if (rule.pattern.test(text)) {
          _actionHintShown = true;
          showActionModelHint(rule);
          return;
        }
      }
    }
  }, 1500);
}

// ═══ 网络术语识别 ═══
async function detectSlang(text) {
  if (!text || text.trim().length < 2) {
    document.getElementById('slang-detect-area').style.display = 'none';
    return;
  }
  try {
    const res = await authFetch('/api/story/detect-slang', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    const area = document.getElementById('slang-detect-area');
    const tags = document.getElementById('slang-tags');
    if (data.data && data.data.length > 0) {
      tags.innerHTML = data.data.map(m =>
        `<span style="padding:2px 8px;background:rgba(0,212,200,.1);border:1px solid rgba(0,212,200,.25);border-radius:99px;font-size:10px;color:rgba(255,255,255,.8)">${esc(m.name)}</span>`
      ).join('');
      area.style.display = 'block';
    } else {
      area.style.display = 'none';
    }
  } catch {}
}

// ═══ AI 智能创作（快速填词） ═══
async function quickAIStory() {
  const ta = document.getElementById('input-theme');
  const theme = ta.value.trim();
  if (!theme) {
    ta.placeholder = '请先输入内容描述，再点击智能创作...';
    ta.focus();
    setTimeout(() => { ta.placeholder = '描述你想要的视频内容，越详细效果越好...'; }, 3000);
    return;
  }
  const btn = document.querySelector('.btn-ai-create');
  btn.disabled = true; btn.innerHTML = '<span class="ai-dot spinning"></span> 生成中...';
  try {
    const res = await authFetch('/api/story/parse-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: theme, genre: 'drama', duration: 60 })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    // 填充角色
    characters = []; charIdCounter = 0;
    (data.data.characters || []).forEach(c => {
      characters.push({
        id: ++charIdCounter, name: c.name || '', role: c.role || 'main',
        charType: c.charType || 'human', description: c.description || '',
        imageUrl: '', theme: c.theme || '古代', gender: c.gender || 'female',
        race: c.race || '人', age: c.age || '青年', species: '', subCategory: '', checked: false
      });
    });
    renderCharacters();

    // 填充场景
    customScenes = []; sceneIdCounter = 0;
    (data.data.custom_scenes || []).forEach(s => {
      customScenes.push({
        id: ++sceneIdCounter, title: s.title || '', location: s.location || '',
        description: s.description || '', dialogue: s.dialogue || '',
        mood: s.mood || '', theme: '魔幻', category: '室外', timeOfDay: '白天',
        dim: '2d', imageUrl: null, video_provider: '', video_model: '',
        duration: s.duration || 10, checked: false
      });
    });
    renderScenes();
    renderTimeline();
    updateDurationHint();

    // 更新 tab 指示器
    const charDot = document.getElementById('snav-char-dot');
    const sceneDot = document.getElementById('snav-scene-dot');
    if (charDot && characters.length) charDot.style.display = '';
    if (sceneDot && customScenes.length) sceneDot.style.display = '';

    showToast(`智能创作完成：${characters.length} 个角色 + ${customScenes.length} 个场景`, 'ok');
    if (customScenes.length) switchStudioTab('scene');
    detectActionContent(theme);
  } catch (e) {
    showToast('智能创作失败: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = '<span class="ai-dot"></span> 智能创作';
  }
}

// ═══ 剧本解析 ═══
async function parseScriptContent() {
  const script = document.getElementById('script-input').value.trim();
  if (!script) { document.getElementById('script-input').focus(); return; }

  const btn = document.getElementById('btn-parse');
  const hint = document.getElementById('parse-hint');
  btn.disabled = true; btn.innerHTML = '⟳ 解析中...';
  hint.style.color = 'var(--cyan)'; hint.textContent = '正在分析剧本...';

  try {
    const res = await authFetch('/api/story/parse-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        script,
        genre: 'drama',
        duration: 60
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    characters = []; charIdCounter = 0;
    (data.data.characters || []).forEach(c => {
      characters.push({ id: ++charIdCounter, name: c.name||'', role: c.role||'main', description: c.description||'' });
    });
    renderCharacters();

    customScenes = []; sceneIdCounter = 0;
    (data.data.custom_scenes || []).forEach(s => {
      customScenes.push({ id: ++sceneIdCounter, title: s.title||'', location: s.location||'', description: s.description||'', mood: s.mood||'', video_provider: '', video_model: '' });
    });
    renderScenes();

    hint.style.color = 'var(--success)';
    hint.textContent = '✓ 解析完成：' + characters.length + ' 个角色，' + customScenes.length + ' 个场景';
  } catch (e) {
    hint.style.color = 'var(--error)'; hint.textContent = '✕ ' + e.message;
  } finally {
    btn.disabled = false; btn.innerHTML = '✨ AI 解析角色和场景';
  }
}

// ═══ 角色 ═══
function addCharacter() {
  const id = ++charIdCounter;
  characters.push({ id, name: '', role: 'main', charType: 'human', description: '', imageUrl: '', theme: '古代', gender: 'female', race: '人', age: '青年', species: '', subCategory: '', checked: false });
  renderCharacters();
  switchStudioTab('character');
  setTimeout(() => selectCharacter(id), 50);
}

// 音乐预听
function toggleMusicPreview() {
  const audio = document.getElementById('music-preview-audio');
  const btn = document.querySelector('.btn-music-preview');
  if (!audio || !musicFilePath) return;
  if (audio.paused) {
    // 设置音源
    if (!audio.src || audio.src === window.location.href) {
      const fn = musicFilePath.split(/[\\/]/).pop();
      audio.src = musicFilePath.includes('assets')
        ? '/api/assets/file/' + encodeURIComponent(fn)
        : '/api/projects/music/' + encodeURIComponent(fn);
    }
    audio.play().catch(() => {});
    if (btn) { btn.textContent = '⏸'; btn.classList.add('playing'); }
  } else {
    audio.pause();
    if (btn) { btn.textContent = '▶'; btn.classList.remove('playing'); }
  }
}
function removeCharacter(id) {
  characters = characters.filter(c => c.id !== id);
  if (studioSelectedCharId === id) {
    studioSelectedCharId = null;
    showRightPanel('idle');
  }
  renderCharacters();
}

async function generateCharImage(id) {
  const c = characters.find(c => c.id === id);
  if (!c || !c.name.trim()) return;

  const dim = c.dim || charDim || '2d';
  const isAnimal = ANIMAL_RACES.includes(c.race);
  const desc = isAnimal
    ? [c.species || c.race, c.description].filter(Boolean).join('，')
    : c.description;
  const res = await authFetch('/api/story/generate-character-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: c.name, role: c.role, description: desc, dim, race: c.race, species: c.species })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  c.imageUrl = data.data.imageUrl;
}

// ═══ 场景 ═══
function updateDurationHint() {
  const count = customScenes.length;
  const hint = document.getElementById('dur-auto-hint');
  if (!hint) return;
  if (count > 0) {
    const estSecs = count * 8;
    hint.textContent = `建议 ${fmtDurLabel(estSecs)}（${count} 个场景）`;
    hint.style.display = 'inline';
    hint.style.cursor = 'pointer';
    hint.onclick = () => autoRecommendDuration(count);
    hint.title = '点击应用推荐时长';
  } else {
    hint.style.display = 'none';
  }
}

function addScene() {
  const id = ++sceneIdCounter;
  customScenes.push({ id, title: '', location: '', description: '', mood: '', theme: '魔幻', category: '室外', timeOfDay: '白天', video_provider: '', video_model: '', checked: false, firstFrameUrl: null, lastFrameUrl: null });
  renderScenes();
  renderTimeline();
  updateDurationHint();
  switchStudioTab('scene');
  setTimeout(() => selectScene(id), 50);
}
function removeScene(id) {
  customScenes = customScenes.filter(s => s.id !== id);
  if (studioSelectedSceneId === id) {
    studioSelectedSceneId = null;
    showRightPanel('idle');
  }
  renderScenes();
  renderTimeline();
  updateDurationHint();
}

// ═══ 音乐 ═══
async function uploadProjectMusic(input) {
  const file = input.files[0]; if (!file) return;
  const box = document.getElementById('music-upload-box');
  box.style.opacity = '.5'; box.style.pointerEvents = 'none';
  try {
    const fd = new FormData(); fd.append('music', file);
    const res = await authFetch('/api/projects/upload-music', { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    musicFilePath = data.data.file_path; musicOriginalName = data.data.original_name;
    box.style.display = 'none';
    document.getElementById('music-loaded-area').style.display = 'block';
    document.getElementById('music-loaded-name').textContent = musicOriginalName;
    document.getElementById('music-status-badge').style.display = 'inline-flex';
    // 设置预听音源
    const previewAudio = document.getElementById('music-preview-audio');
    if (previewAudio && data.data.file_url) previewAudio.src = data.data.file_url;
    // 加载音乐到时间轴轨道
    const tlAudio = document.getElementById('tl-music-audio');
    if (tlAudio && data.data.file_url) {
      tlAudio.src = data.data.file_url;
      tlAudio.addEventListener('loadedmetadata', () => {
        musicDuration = tlAudio.duration || 0;
        musicTrimStart = 0;
        musicTrimEnd = musicDuration;
        renderMusicTrack();
      }, { once: true });
    }
  } catch (e) {
    alert('上传失败：' + e.message);
    box.style.opacity = '1'; box.style.pointerEvents = 'auto';
  }
}
function removeProjectMusic() {
  musicFilePath = null; musicOriginalName = null;
  musicDuration = 0; musicTrimStart = 0; musicTrimEnd = 0;
  document.getElementById('music-upload-box').style.cssText = 'display:block;opacity:1;pointer-events:auto';
  document.getElementById('music-loaded-area').style.display = 'none';
  document.getElementById('music-status-badge').style.display = 'none';
  document.getElementById('music-file-input').value = '';
  // 停止预听并清除音源
  const previewAudio = document.getElementById('music-preview-audio');
  if (previewAudio) { previewAudio.pause(); previewAudio.src = ''; }
  const btn = document.querySelector('.btn-music-preview');
  if (btn) { btn.textContent = '▶'; btn.classList.remove('playing'); }
  // 清除时间轴音乐轨道
  const tlAudio = document.getElementById('tl-music-audio');
  if (tlAudio) { tlAudio.pause(); tlAudio.src = ''; }
  renderMusicTrack();
}

// ═══ 时长选择 ═══
function setDuration(secs, btn) {
  videoDuration = secs;
  document.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const customRow = document.getElementById('dur-custom-row');
  if (customRow) customRow.style.display = 'none';
}

function showCustomDuration() {
  const row = document.getElementById('dur-custom-row');
  if (row) row.style.display = row.style.display === 'none' ? 'flex' : 'none';
  const input = document.getElementById('dur-custom-input');
  if (input) { input.value = videoDuration; input.focus(); }
}

function applyCustomDuration() {
  const input = document.getElementById('dur-custom-input');
  const secs = parseInt(input?.value);
  if (!secs || secs < 5) { alert('至少 5 秒'); return; }
  videoDuration = secs;
  document.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('active'));
  const customBtn = document.getElementById('dur-custom-btn');
  if (customBtn) { customBtn.classList.add('active'); customBtn.textContent = fmtDurLabel(secs); }
  document.getElementById('dur-custom-row').style.display = 'none';
}

function fmtDurLabel(secs) {
  if (secs >= 60) {
    const m = Math.floor(secs / 60), s = secs % 60;
    return s ? `${m}分${s}秒` : `${m}分钟`;
  }
  return secs + '秒';
}

// 根据场景数自动推荐时长并高亮
function autoRecommendDuration(sceneCount) {
  if (!sceneCount) return;
  const estSecs = sceneCount * 8;
  // 找最接近的预设时长
  const presets = [15, 30, 60, 120, 180, 300, 600];
  let best = presets[0];
  for (const p of presets) {
    if (Math.abs(p - estSecs) < Math.abs(best - estSecs)) best = p;
  }
  // 自动设置
  videoDuration = best;
  document.querySelectorAll('.dur-btn').forEach(b => {
    const match = b.onclick?.toString().includes(best + ',');
    b.classList.toggle('active', !!match);
  });
}

// ═══ 右侧面板区域切换（互斥显示） ═══
// which: 'idle' | 'progress' | 'result' | 'character' | 'scene'
let _currentRightPanel = 'idle';
let _isGenerating = false;

function showRightPanel(which) {
  _currentRightPanel = which;
  if (which === 'progress') _isGenerating = true;
  if (which === 'result' || which === 'idle') _isGenerating = false;
  const panels = { idle: 'srp-empty', progress: 'srp-progress', result: 'srp-result', character: 'srp-character', scene: 'srp-scene' };
  Object.values(panels).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const target = panels[which];
  if (target) {
    const el = document.getElementById(target);
    if (el) el.style.display = '';
  }
  // 生成中时显示"返回进度"按钮
  updateBackToProgressBtn();
}

function updateBackToProgressBtn() {
  let btn = document.getElementById('btn-back-progress');
  if (_isGenerating && _currentRightPanel !== 'progress') {
    if (!btn) {
      btn = document.createElement('div');
      btn.id = 'btn-back-progress';
      btn.innerHTML = '◀ 返回进度';
      btn.style.cssText = 'position:absolute;top:8px;left:8px;z-index:10;background:var(--cyan);color:#000;font-size:11px;font-weight:700;padding:4px 12px;border-radius:999px;cursor:pointer;';
      btn.onclick = () => showRightPanel('progress');
      const rp = document.getElementById('sto-rp');
      if (rp) { rp.style.position = 'relative'; rp.appendChild(btn); }
    }
    btn.style.display = '';
  } else if (btn) {
    btn.style.display = 'none';
  }
}

// ═══ 视频循环播放 ═══
let cvLoopEnabled = true; // 与 tlMusicLoop 同步

function cvApplyLoop() {
  const vid = document.getElementById('center-video');
  if (vid) vid.loop = cvLoopEnabled;
}

// ═══ 中央画布状态 ═══
// state: 'idle' | 'generating' | 'done' | 'preview'
function setCanvasState(state) {
  show('canvas-idle', state === 'idle');
  show('canvas-gen-overlay', state === 'generating');
  const vid = document.getElementById('center-video');
  const showVid = state === 'done' || state === 'preview';
  if (vid) vid.style.display = showVid ? 'block' : 'none';
}

// 标记场景卡片为可点击播放
function markSceneChipPlayable(sceneIndex) {
  const chips = document.querySelectorAll('.scene-chip');
  const chip = chips[sceneIndex];
  if (!chip || chip.classList.contains('playable')) return;
  chip.classList.add('playable');
  chip.style.cursor = 'pointer';
  chip.title = '点击预览此场景';
  // 添加播放图标
  const badge = document.createElement('div');
  badge.className = 'scene-play-badge';
  badge.innerHTML = '▶ 预览';
  badge.style.cssText = 'position:absolute;top:6px;right:6px;background:var(--cyan);color:#000;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;';
  chip.style.position = 'relative';
  chip.appendChild(badge);
  chip.onclick = () => {
    const info = completedClips[sceneIndex];
    if (info && currentProjectId) previewClip(currentProjectId, info.clipId, sceneIndex, info.sceneTitle);
  };
}

// 在中央画布预览单个场景片段
function previewClip(projectId, clipId, sceneIndex, sceneTitle) {
  const vid = document.getElementById('center-video');
  if (!vid) return;
  vid.src = authUrl('/api/projects/' + projectId + '/clips/' + clipId + '/stream');
  vid.style.display = 'block';
  cvApplyLoop();
  vid.load();
  vid.play().catch(() => {});
  // 隐藏 idle/overlay，显示视频
  show('canvas-idle', false);
  show('canvas-gen-overlay', false);
  // 更新画布底部进度文字
  const cgoMsg = document.getElementById('cgo-msg');
  if (cgoMsg) cgoMsg.textContent = '场景 ' + ((sceneIndex ?? 0) + 1) + '：' + (sceneTitle || '');
}

function setPanelState(state) {
  if (state === 'idle') {
    showRightPanel('idle');
    setCanvasState('idle');
    lockStudioPanel(false);
  } else if (state === 'progress' || state === 'story') {
    showRightPanel('progress');
    setCanvasState('generating');
    lockStudioPanel(true);
    if (state === 'story') show('story-area', true);
  } else if (state === 'done') {
    showRightPanel('result');
    setCanvasState('done');
    lockStudioPanel(false);
  }
}

function lockStudioPanel(locked) {
  const panel = document.getElementById('sto-panel');
  if (!panel) return;
  let overlay = document.getElementById('sto-panel-lock');
  if (locked) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sto-panel-lock';
      overlay.className = 'sto-panel-lock';
      overlay.innerHTML = '<div class="sto-lock-msg"><svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="3" y="8" width="12" height="8" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M6 8V5.5a3 3 0 016 0V8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg><span>创作中，完成后可编辑</span></div>';
      panel.style.position = 'relative';
      panel.appendChild(overlay);
    }
    overlay.style.display = 'flex';
  } else {
    if (overlay) overlay.style.display = 'none';
  }
}

// ═══ 校验辅助：强制导航到目标字段 ═══
function scrollToField(fieldId, toastMsg) {
  // 1) 切到剧本 tab（确保面板可见）
  switchStudioTab('script');
  // 2) 展开面板（如果折叠了）
  const panel = document.getElementById('sto-panel');
  if (panel && panel.classList.contains('collapsed')) panel.classList.remove('collapsed');
  // 3) 弹出 toast
  if (toastMsg) showToast(toastMsg, 'warn');
  // 4) 延迟后滚动到目标元素
  setTimeout(() => {
    const el = document.getElementById(fieldId);
    if (!el) return;
    // 找到最近的可滚动父容器
    let scrollParent = el.parentElement;
    while (scrollParent && scrollParent !== document.body) {
      const ov = getComputedStyle(scrollParent).overflowY;
      if (ov === 'auto' || ov === 'scroll') break;
      scrollParent = scrollParent.parentElement;
    }
    if (scrollParent && scrollParent !== document.body) {
      // 计算元素在滚动容器内的偏移量
      const containerRect = scrollParent.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const offset = elRect.top - containerRect.top + scrollParent.scrollTop;
      scrollParent.scrollTo({ top: Math.max(0, offset - 40), behavior: 'smooth' });
    }
    // 高亮 + 聚焦
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      el.focus();
      el.style.borderColor = 'var(--error)';
      el.style.boxShadow = '0 0 0 3px rgba(255,77,109,.2)';
      setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 3000);
    } else {
      el.style.outline = '2px solid rgba(255,170,0,.6)';
      el.style.outlineOffset = '3px';
      setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 3000);
    }
  }, 200);
}

// ═══ 创作流程 ═══
async function startGeneration() { await _doGenerate(false); }
async function startGenerationSkip() { await _doGenerate(true); }

async function _doGenerate(skip) {
  // 重新生成时停止所有音频/视频播放
  stopAllAudio();
  const vid = document.getElementById('center-video');
  if (vid) { vid.pause(); vid.src = ''; }

  let theme = document.getElementById('input-theme').value.trim();

  // 剧本模式：用剧本内容或已解析的场景作为 theme
  if (creationMode === 'script') {
    const scriptText = (document.getElementById('script-input')?.value || '').trim();
    if (!scriptText && customScenes.length === 0) {
      scrollToField('script-input', '请先输入或解析剧本内容');
      return;
    }
    theme = theme || scriptText || customScenes.map(s => s.title + ' ' + (s.description || '')).join('\n');
  }
  // 自定义模式：用剧情结构拼接
  if (creationMode === 'custom') {
    const plotParts = ['plot-beginning', 'plot-middle', 'plot-ending'].map(id => (document.getElementById(id)?.value || '').trim()).filter(Boolean);
    if (!plotParts.length && !theme) {
      scrollToField('plot-beginning', '请先填写剧情结构');
      return;
    }
    theme = theme || plotParts.join('\n');
  }
  // 长篇模式：使用长篇主题
  if (creationMode === 'longform') {
    const lfTheme = (document.getElementById('longform-theme')?.value || '').trim();
    if (!lfTheme && customScenes.length === 0) {
      showToast('请先输入长篇主题，或点击「生成本集剧本」', 'warn');
      return;
    }
    theme = theme || lfTheme || customScenes.map(s => s.title + ' ' + (s.description || '')).join('\n');
  }

  if (!theme) {
    scrollToField('input-theme', '请先输入视频内容描述');
    return;
  }
  const title = (document.getElementById('input-title')?.value || '').trim() || theme.substring(0, 30) || '未命名视频';

  // 验证视频模型 — 未选时自动选第一个可用模型
  if (!selectedVideoProvider || !selectedVideoModelId) {
    const available = (videoModelsCache || []).filter(m => !m.disabled);
    if (available.length > 0) {
      // 自动选择第一个可用模型
      const first = available[0];
      selectedVideoProvider = first.providerId;
      selectedVideoModelId = first.modelId;
      // 更新 UI 选中状态
      document.querySelectorAll('.vm-card').forEach(c => {
        c.classList.toggle('active', c.dataset.pid === first.providerId && c.dataset.mid === first.modelId);
      });
      console.log(`[AutoSelect] 自动选择视频模型: ${first.providerId}/${first.modelId}`);
    } else {
      const hasDisabled = (_disabledModelsCache || []).length > 0;
      let msg = '请先选择一个视频模型';
      if (hasDisabled) msg = '当前无可用视频模型 — 请检查 AI 配置中的 API Key 和供应商状态';
      else msg = '未配置视频模型 — 请前往「AI 配置」添加视频供应商';
      // 展开高级设置让用户看到模型选择
      const body = document.getElementById('stp-adv-body');
      if (body && body.style.display === 'none') toggleAdvancedSettings();
      scrollToField('step-vm', msg);
      const val = document.getElementById('vm-validation');
      if (val) { val.style.display = 'block'; val.textContent = msg; }
      const stepVm = document.getElementById('step-vm');
      if (stepVm) stepVm.classList.add('stp-step-error');
      return;
    }
  }

  let customContent = null;
  // 收集角色数据（含形象图 URL，所有模式都传）
  const vc = characters.filter(c => c.name.trim());
  // 序列化角色完整字段的辅助函数
  const serializeChar = c => ({
    name: c.name, role: c.role, description: c.description,
    race: c.race || '人', species: c.species || '',
    charType: c.charType || 'human', theme: c.theme || '',
    gender: c.gender || '', age: c.age || '',
    subCategory: c.subCategory || '', dim: c.dim || '',
    imageUrl: c.imageUrl || null
  });
  const serializeScene = s => ({
    title: s.title || '场景',
    description: s.description || '',
    dialogue: s.dialogue || '',
    location: s.location || '', timeOfDay: s.timeOfDay || '',
    mood: s.mood || '', theme: s.theme || '',
    category: s.category || '', duration: s.duration || 10,
    dim: s.dim || '', imageUrl: s.imageUrl || null,
    video_provider: s.video_provider || '', video_model: s.video_model || '',
    firstFrameUrl: s.firstFrameUrl || null, lastFrameUrl: s.lastFrameUrl || null
  });

  if (creationMode !== 'ai') {
    customContent = {};
    if (vc.length) customContent.characters = vc.map(serializeChar);
    const vs = customScenes.filter(s => s.title.trim() || s.description.trim());
    if (vs.length) customContent.custom_scenes = vs.map(serializeScene);
    if (creationMode === 'custom') {
      const plot = { beginning: g('plot-beginning'), middle: g('plot-middle'), ending: g('plot-ending') };
      if (plot.beginning||plot.middle||plot.ending) customContent.plot = plot;
    }
    if (creationMode === 'script') {
      const sc = document.getElementById('script-input').value.trim();
      if (sc) customContent.style_notes = '参考剧本：' + sc.substring(0, 500);
    }
    if (creationMode === 'longform') {
      customContent.style_notes = `长篇动画第${episodeIndex}/${episodeCount}集`;
      const summary = (document.getElementById('longform-summary')?.value || '').trim();
      if (summary) customContent.style_notes += `\n前情提要：${summary}`;
    }
    const sn = g('style-notes') || (creationMode === 'custom' ? g('style-notes-custom') : '');
    if (sn) customContent.style_notes = (customContent.style_notes||'') + ' ' + sn;
    if (!Object.keys(customContent).length) customContent = null;
  } else if (vc.length || customScenes.some(s => s.imageUrl)) {
    // AI 模式下也传角色和场景信息（如果用户添加了角色或场景有概念图）
    customContent = {};
    if (vc.length) customContent.characters = vc.map(serializeChar);
    const vs = customScenes.filter(s => s.title.trim() || s.description.trim());
    if (vs.length) customContent.custom_scenes = vs.map(serializeScene);
  }

  const btn = document.getElementById('btn-generate');
  btn.disabled = true;
  btn.textContent = '创作中...';
  completedClips = {};

  // 显示取消按钮
  const cancelBtn = document.getElementById('btn-cancel');
  if (cancelBtn) { cancelBtn.style.display = ''; cancelBtn.disabled = false; cancelBtn.textContent = '取消'; }

  setPanelState('progress');

  try {
    const res = await authFetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme, genre: 'drama', duration: videoDuration,
        title,
        anim_style: animStyle,
        aspect_ratio: aspectRatio,
        skip_parse: skip,
        mode: creationMode === 'ai' ? 'quick' : 'custom',
        custom_content: customContent,
        music_path: musicFilePath,
        music_trim_start: musicFilePath && musicTrimStart > 0 ? musicTrimStart : null,
        music_trim_end: musicFilePath && musicTrimEnd < musicDuration ? musicTrimEnd : null,
        music_volume: musicFilePath ? parseInt(document.getElementById('music-volume-input').value) / 100 : null,
        music_loop: musicFilePath ? document.getElementById('music-loop-input').checked : null,
        scene_dim: sceneDim,
        char_dim: charDim,
        voice_enabled: voiceEnabled,
        voice_gender: voiceGender,
        voice_id: selectedVoiceId,
        voice_speed: voiceEnabled ? parseFloat(document.getElementById('voice-speed-input').value) : 1.0,
        subtitle_enabled: subtitleEnabled,
        subtitle_size: subtitleSize,
        subtitle_position: subtitlePosition,
        subtitle_color: subtitleColor,
        video_provider: selectedVideoProvider,
        video_model: selectedVideoModelId,
        // 长篇模式参数
        creation_mode: creationMode,
        episode_count: creationMode === 'longform' ? episodeCount : undefined,
        episode_index: creationMode === 'longform' ? episodeIndex : undefined,
        previous_summary: creationMode === 'longform' ? (document.getElementById('longform-summary')?.value || '').trim() || undefined : undefined
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    currentProjectId = data.data.projectId;
    const pidEl = document.getElementById('progress-project-id');
    if (pidEl) pidEl.textContent = '#' + data.data.projectId.slice(0, 6);
    connectSSE(currentProjectId);
  } catch (err) {
    addLog(err.message, 'err');
    btn.disabled = false;
    btn.innerHTML = '创作';
    lockStudioPanel(false);
  }
}

function connectSSE(projectId) {
  if (currentSSE) currentSSE.close();
  currentSSE = new EventSource(authUrl('/api/projects/' + projectId + '/progress'));
  currentSSE.onmessage = e => handleProgress(JSON.parse(e.data));
  currentSSE.onerror = () => addLog('连接中断', 'warn');
}

function handleProgress(data) {
  const { step, status, message } = data;
  const payload = data.data;
  addLog(message, status === 'error' ? 'err' : (status === 'done' || status === 'scene_done') ? 'ok' : '');
  // 更新画布底部进度文字
  const cgoMsg = document.getElementById('cgo-msg');
  if (cgoMsg && message) cgoMsg.textContent = message;
  if (step === 'story') {
    setStep('step-story', status === 'done' ? 'done' : status === 'error' ? 'error' : 'active');
    setSub('step-story-sub', { done: '已完成 ✓', error: '出错' }[status] || '生成中...');
    if (status === 'done') loadStoryPreview(currentProjectId);
  }
  if (step === 'video') {
    setStep('step-video', 'active');
    if (payload) {
      const done = payload.completed ?? 0;
      setSub('step-video-sub', done + ' / ' + payload.total + ' 场景');
    }
    // 场景完成时：记录 clip 信息 + 在画布自动预览 + 标记场景卡片可点击
    if (status === 'scene_done' && payload?.clipId && currentProjectId) {
      completedClips[payload.sceneIndex] = { clipId: payload.clipId, sceneTitle: payload.sceneTitle };
      previewClip(currentProjectId, payload.clipId, payload.sceneIndex, payload.sceneTitle);
      markSceneChipPlayable(payload.sceneIndex);
    }
  }
  if (step === 'merge') {
    setStep('step-merge', status === 'done' ? 'done' : 'active');
    setSub('step-merge-sub', status === 'done' ? '已完成 ✓' : '合成中...');
  }
  if (step === 'final' && status === 'done') {
    setStep('step-video', 'done'); setSub('step-video-sub', '已完成 ✓');
    currentSSE?.close();
    showResult(payload);
    resetBtn();
  }
  if (step === 'error') {
    currentSSE?.close();
    resetBtn();
    setPanelState('idle');
    if (message) showToast(message, 'error');
  }
}

function setStep(id, cls) { const el = document.getElementById(id); if (el) el.className = 'step-row ' + cls; }
function setSub(id, t)  { const el = document.getElementById(id); if (el) el.textContent = t; }
function resetBtn() {
  const btn = document.getElementById('btn-generate');
  if (!btn) return;
  btn.disabled = false; btn.textContent = '创作';
  const cancelBtn = document.getElementById('btn-cancel');
  if (cancelBtn) cancelBtn.style.display = 'none';
  lockStudioPanel(false);
}

async function cancelGeneration() {
  if (!currentProjectId) return;
  const cancelBtn = document.getElementById('btn-cancel');
  if (cancelBtn) { cancelBtn.disabled = true; cancelBtn.textContent = '取消中...'; }
  let reason = '';
  try {
    const res = await authFetch('/api/projects/' + currentProjectId + '/cancel', { method: 'POST' });
    const data = await res.json();
    reason = data.data?.last_error || '';
  } catch {}
  if (currentSSE) { currentSSE.close(); currentSSE = null; }
  addLog('制作已取消', 'warn');
  if (reason) addLog('失败原因: ' + reason, 'err');
  resetBtn();
  setPanelState('idle');
}

async function loadStoryPreview(projectId) {
  try {
    const res = await authFetch('/api/projects/' + projectId);
    const data = await res.json();
    if (!data.success || !data.data.story) return;
    const story = data.data.story;
    document.getElementById('story-title').textContent = story.title || '';
    document.getElementById('story-synopsis').textContent = story.synopsis || '';
    document.getElementById('scenes-list').innerHTML = (story.scenes || []).map((s, i) => `
      <div class="scene-chip">
        <div class="scene-chip-num">场景 ${i+1}</div>
        <div class="scene-chip-title">${esc(s.title||'')}</div>
        <div class="scene-chip-desc">${esc(s.action||'')}</div>
        <div class="scene-chip-tags">
          ${s.location?`<span class="chip-tag">📍 ${esc(s.location)}</span>`:''}
          ${s.mood?`<span class="chip-tag">🎭 ${esc(s.mood)}</span>`:''}
          <span class="chip-tag">⏱ ${s.duration||10}秒</span>
        </div>
      </div>`).join('');
    show('story-area', true);
    // 确保右侧面板显示进度区（含剧情预览）
    showRightPanel('progress');
  } catch(e) { console.error(e); }
}

function showResult(payload) {
  const dl = document.getElementById('btn-download');
  const ed = document.getElementById('btn-edit');
  if (dl) dl.href = authUrl(payload?.downloadUrl || '/api/projects/' + currentProjectId + '/download');
  if (ed) ed.href = '/editor.html?id=' + currentProjectId;
  // 在中央画布播放视频
  const vid = document.getElementById('center-video');
  if (vid) {
    vid.src = authUrl('/api/projects/' + currentProjectId + '/stream');
    cvApplyLoop();
    vid.load();
    vid.play().catch(() => {});
  }
  // 显示音频轨道信息
  const audioPreview = document.getElementById('srp-audio-preview');
  const voiceTrack = document.getElementById('srp-voice-track');
  const musicTrack = document.getElementById('srp-music-track');
  const hasVoice = payload?.hasVoice;
  const hasMusic = payload?.hasMusic;
  if (audioPreview && (hasVoice || hasMusic)) {
    audioPreview.style.display = '';
    if (voiceTrack) {
      voiceTrack.style.display = hasVoice ? '' : 'none';
      const voiceDetail = document.getElementById('srp-voice-detail');
      if (voiceDetail) voiceDetail.textContent = `${voiceGender === 'female' ? '女声' : '男声'} · ${voiceSpeed.toFixed(1)}x`;
    }
    if (musicTrack) {
      musicTrack.style.display = hasMusic ? '' : 'none';
      if (hasMusic && musicOriginalName) {
        const nm = document.getElementById('srp-music-name');
        if (nm) nm.textContent = musicOriginalName;
        const md = document.getElementById('srp-music-detail');
        const vol = document.getElementById('music-volume-input');
        const loop = document.getElementById('music-loop-input');
        if (md) md.textContent = `音量 ${vol ? vol.value : 50}% · ${loop?.checked ? '循环' : '单次'}`;
      }
    }
  } else if (audioPreview) {
    audioPreview.style.display = 'none';
  }
  setPanelState('done');
}

function replayVideo() {
  const vid = document.getElementById('center-video');
  if (vid && currentProjectId) {
    vid.src = authUrl('/api/projects/' + currentProjectId + '/stream');
    cvApplyLoop();
    vid.load();
    vid.play().catch(() => {});
  }
}

function resetForm() {
  const log = document.getElementById('progress-log');
  if (log) log.innerHTML = '';
  ['step-story','step-video','step-merge'].forEach(id => setStep(id, ''));
  ['step-story-sub','step-video-sub','step-merge-sub'].forEach(id => setSub(id, '等待中'));
  show('story-area', false);
  const ta = document.getElementById('input-theme');
  if (ta) ta.value = '';
  const ti = document.getElementById('input-title');
  if (ti) ti.value = '';
  // 重置剧本模式
  const scriptInput = document.getElementById('script-input');
  if (scriptInput) scriptInput.value = '';
  const plotIds = ['plot-beginning', 'plot-middle', 'plot-ending', 'style-notes', 'style-notes-custom'];
  plotIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  // 重置角色和场景
  characters = [];
  customScenes = [];
  charIdCounter = 0;
  sceneIdCounter = 0;
  studioSelectedCharId = null;
  studioSelectedSceneId = null;
  loadingCharIds.clear();
  renderCharacters();
  renderScenes();
  renderTimeline();
  // 重置音乐
  musicFilePath = null;
  musicOriginalName = null;
  const musicStatus = document.getElementById('music-status-badge');
  if (musicStatus) musicStatus.style.display = 'none';
  const musicLoaded = document.getElementById('music-loaded-area');
  if (musicLoaded) musicLoaded.style.display = 'none';
  const musicUpload = document.getElementById('music-upload-box');
  if (musicUpload) musicUpload.style.display = '';
  // 重置语音
  voiceEnabled = false;
  selectedVoiceId = null;
  voiceFilter = 'all';
  const voiceOpts = document.getElementById('voice-options');
  if (voiceOpts) voiceOpts.style.display = 'none';
  const voiceHint = document.getElementById('voice-off-hint');
  if (voiceHint) voiceHint.style.display = 'block';
  const voiceSelRow = document.getElementById('voice-selected-row');
  if (voiceSelRow) voiceSelRow.style.display = 'none';
  const voiceCb = document.getElementById('voice-enabled');
  if (voiceCb) voiceCb.checked = false;
  // 重置模式为 AI
  switchMode('ai');
  // 重置视频模型选择触发器显示（保留上次选择的模型，方便复用）
  // 重置完成片段
  completedClips = {};
  // 重置中央视频播放器
  const vid = document.getElementById('center-video');
  if (vid) { vid.pause(); vid.src = ''; }
  currentProjectId = null;
  currentSSE?.close(); currentSSE = null;
  showRightPanel('idle');
  setCanvasState('idle');
  resetBtn();
}

function showToast(msg, type = 'info') {
  const toast = document.createElement('div');
  toast.className = 'vido-toast vido-toast-' + type;
  toast.textContent = msg;
  toast.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 24px;border-radius:999px;font-size:13px;color:#fff;pointer-events:none;opacity:0;transition:opacity .3s;max-width:80vw;text-align:center;'
    + (type === 'warn' ? 'background:rgba(255,170,0,.92);' : type === 'err' ? 'background:rgba(255,77,109,.92);' : 'background:rgba(33,255,243,.85);color:#000;');
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, 3000);
}

function addLog(msg, type = '') {
  const log = document.getElementById('progress-log');
  if (!log) return;
  const row = document.createElement('div'); row.className = 'log-row';
  row.innerHTML = `<span class="log-t">${new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span><span class="log-m ${type}">${esc(msg||'')}</span>`;
  log.appendChild(row); log.scrollTop = log.scrollHeight;
}

// ═══ 视频轮播 ═══
let carouselClips = [];    // [{clipId, label}]
let carouselIndex = 0;
let carouselActive = false;
let carouselProjectId = null;

function toggleCarousel() {
  carouselActive = !carouselActive;
  const btn = document.getElementById('carousel-toggle');
  if (btn) btn.classList.toggle('active', carouselActive);

  const indicator = document.getElementById('carousel-indicator');
  const prev = document.getElementById('carousel-prev');
  const next = document.getElementById('carousel-next');

  if (carouselActive && carouselClips.length > 1) {
    if (indicator) indicator.style.display = '';
    if (prev) prev.style.display = '';
    if (next) next.style.display = '';
    // 从第一个场景开始轮播
    carouselIndex = 0;
    carouselPlayCurrent();
  } else {
    if (indicator) indicator.style.display = 'none';
    if (prev) prev.style.display = 'none';
    if (next) next.style.display = 'none';
    // 关闭轮播，回到完整视频
    if (carouselProjectId) {
      const v = document.getElementById('modal-video');
      document.getElementById('modal-video-src').src = authUrl('/api/projects/' + carouselProjectId + '/stream');
      v.load(); v.play().catch(() => {});
      document.getElementById('modal-title').textContent = '视频预览';
      // 重置 footer 按钮高亮
      document.querySelectorAll('.clip-btn').forEach(b => b.classList.remove('active'));
      const fullBtn = document.querySelector('.clip-btn');
      if (fullBtn) fullBtn.classList.add('active');
    }
  }
}

function carouselPlayCurrent() {
  if (!carouselClips.length) return;
  const clip = carouselClips[carouselIndex];
  const v = document.getElementById('modal-video');
  document.getElementById('modal-video-src').src = authUrl('/api/projects/' + carouselProjectId + '/clips/' + clip.clipId + '/stream');
  document.getElementById('modal-title').textContent = clip.label;
  v.load(); v.play().catch(() => {});

  // 更新指示器
  updateCarouselDots();

  // 更新 footer 按钮高亮
  const btns = document.querySelectorAll('.clip-btn');
  btns.forEach(b => b.classList.remove('active'));
  if (btns[carouselIndex + 1]) btns[carouselIndex + 1].classList.add('active'); // +1 因为第0个是"完整"
}

function updateCarouselDots() {
  const dots = document.getElementById('carousel-dots');
  const label = document.getElementById('carousel-label');
  if (dots) {
    dots.innerHTML = carouselClips.map((c, i) =>
      `<div class="carousel-dot ${i === carouselIndex ? 'active' : ''}" onclick="carouselGoTo(${i})"></div>`
    ).join('');
  }
  if (label && carouselClips[carouselIndex]) {
    label.textContent = `${carouselIndex + 1} / ${carouselClips.length}  ${carouselClips[carouselIndex].label}`;
  }
}

function carouselNext() {
  if (!carouselClips.length) return;
  carouselIndex = (carouselIndex + 1) % carouselClips.length;
  carouselPlayCurrent();
}

function carouselPrev() {
  if (!carouselClips.length) return;
  carouselIndex = (carouselIndex - 1 + carouselClips.length) % carouselClips.length;
  carouselPlayCurrent();
}

function carouselGoTo(i) {
  carouselIndex = i;
  carouselPlayCurrent();
}

function setupCarouselAutoNext() {
  const v = document.getElementById('modal-video');
  if (!v) return;
  // 移除旧监听
  v.removeEventListener('ended', onCarouselVideoEnded);
  v.addEventListener('ended', onCarouselVideoEnded);
}

function onCarouselVideoEnded() {
  if (!carouselActive || !carouselClips.length) return;
  carouselNext();
}

// ═══ 视频预览 ═══
function openPreview(projectId, title) {
  const id = projectId || currentProjectId; if (!id) return;
  carouselProjectId = id;
  carouselActive = false;
  carouselClips = [];
  carouselIndex = 0;
  const toggleBtn = document.getElementById('carousel-toggle');
  if (toggleBtn) toggleBtn.classList.remove('active');
  document.getElementById('carousel-indicator').style.display = 'none';
  document.getElementById('carousel-prev').style.display = 'none';
  document.getElementById('carousel-next').style.display = 'none';

  document.getElementById('modal-title').textContent = title || '视频预览';
  document.getElementById('modal-video-src').src = authUrl('/api/projects/' + id + '/stream');
  const v = document.getElementById('modal-video'); v.load(); v.play().catch(()=>{});
  setupCarouselAutoNext();
  loadClipButtons(id);
  document.getElementById('video-modal').classList.add('open');
}
async function loadClipButtons(pid) {
  const footer = document.getElementById('modal-footer');
  footer.innerHTML = '<span style="color:var(--text3);font-size:11px">加载场景...</span>';
  try {
    const data = await (await authFetch('/api/projects/' + pid)).json();
    const clips = (data.data?.clips||[]).filter(c => c.status==='done');
    if (!clips.length) { footer.innerHTML = ''; return; }

    // 填充轮播数据
    carouselClips = clips.map((c, i) => ({ clipId: c.id, label: '场景 ' + (i + 1) }));

    footer.innerHTML = '<span style="color:var(--text3);font-size:11px;margin-right:6px">场景：</span>' +
      '<button class="clip-btn active" onclick="playFull(\''+pid+'\',this)">完整</button>' +
      clips.map((c,i)=>`<button class="clip-btn" onclick="playClip('${pid}','${c.id}',${i},this)">场景 ${i+1}</button>`).join('');

    // 如果有多个场景，显示轮播按钮
    const toggleBtn = document.getElementById('carousel-toggle');
    if (toggleBtn) toggleBtn.style.display = clips.length > 1 ? '' : 'none';
  } catch { footer.innerHTML = ''; }
}
function playFull(pid, btn) {
  setAB(btn); const v = document.getElementById('modal-video');
  document.getElementById('modal-video-src').src = authUrl('/api/projects/'+pid+'/stream');
  v.load(); v.play().catch(()=>{});
}
function playClip(pid, cid, i, btn) {
  setAB(btn); const v = document.getElementById('modal-video');
  document.getElementById('modal-video-src').src = authUrl('/api/projects/'+pid+'/clips/'+cid+'/stream');
  document.getElementById('modal-title').textContent = '场景 '+(i+1);
  v.load(); v.play().catch(()=>{});
}
function setAB(btn) { document.querySelectorAll('.clip-btn').forEach(b=>b.classList.remove('active')); btn?.classList.add('active'); }
function closePreview() {
  const v = document.getElementById('modal-video'); v.pause();
  v.removeEventListener('ended', onCarouselVideoEnded);
  document.getElementById('modal-video-src').src = ''; v.load();
  document.getElementById('video-modal').classList.remove('open');
  carouselActive = false;
  carouselClips = [];
}
function closeModal(e) { if (e.target.id==='video-modal') closePreview(); }

// ═══ 图片大图弹窗 ═══
function openLightbox(src, caption, type) {
  const box = document.getElementById('img-lightbox');
  const img = document.getElementById('lightbox-img');
  const vid = document.getElementById('lightbox-video');
  const cap = document.getElementById('lightbox-caption');
  if (!box) return;
  if (type === 'video' && vid) {
    img.style.display = 'none';
    vid.style.display = 'block';
    vid.src = src;
    vid.play().catch(() => {});
  } else {
    if (vid) { vid.style.display = 'none'; vid.pause(); vid.src = ''; }
    img.style.display = '';
    img.src = src;
  }
  if (cap) cap.textContent = caption || '';
  box.classList.add('open');
}
function closeLightbox(e) {
  if (e && e.target !== document.getElementById('img-lightbox') && !e.target.classList.contains('lightbox-close')) return;
  const box = document.getElementById('img-lightbox');
  if (box) box.classList.remove('open');
  const vid = document.getElementById('lightbox-video');
  if (vid) { vid.pause(); vid.src = ''; vid.style.display = 'none'; }
  const img = document.getElementById('lightbox-img');
  if (img) img.style.display = '';
}

// ═══ 项目列表 ═══
let allProjectsCache = [];
let projectFilter = 'all';
let projectTypeFilter = 'original';

function switchProjectType(type, btn) {
  projectTypeFilter = type;
  document.querySelectorAll('.proj-type-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // 剪辑视频没有"生成中"状态，隐藏状态筛选
  const filterBar = document.getElementById('proj-filter-bar');
  if (filterBar) filterBar.style.display = type === 'edited' ? 'none' : '';
  projectFilter = 'all';
  document.querySelectorAll('.proj-filter-btn').forEach(b => b.classList.remove('active'));
  const allBtn = document.querySelector('.proj-filter-btn[data-filter="all"]');
  if (allBtn) allBtn.classList.add('active');
  renderProjectGrid(allProjectsCache);
}

function filterProjects(filter, btn) {
  projectFilter = filter;
  document.querySelectorAll('.proj-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderProjectGrid(allProjectsCache);
}

function isRunning(status) {
  return ['pending','generating_story','generating_videos','merging'].includes(status);
}

function renderProjectGrid(projects) {
  const grid = document.getElementById('projects-grid');

  // 按类型分类
  let list = projects.filter(p => {
    if (projectTypeFilter === 'edited') return p.type === 'edited';
    return p.type !== 'edited'; // original 或无 type 的旧项目
  });

  // 再按状态筛选（仅原视频类）
  if (projectTypeFilter === 'original') {
    if (projectFilter === 'running') list = list.filter(p => isRunning(p.status));
    else if (projectFilter === 'done') list = list.filter(p => p.status === 'done');
    else if (projectFilter === 'error') list = list.filter(p => p.status === 'error' || p.status === 'cancelled');
  }

  if (!list.length) {
    const msg = projectTypeFilter === 'edited' ? '还没有剪辑过的视频' : (projectFilter === 'all' ? '还没有项目' : '没有符合条件的项目');
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">${projectTypeFilter === 'edited' ? '✂' : '🎬'}</div><div class="empty-title">${msg}</div></div>`;
    return;
  }

  const sl = { pending:'等待中', done:'已完成', error:'失败', cancelled:'已取消', generating_story:'生成剧情', generating_videos:'生成视频', merging:'合成中' };
  const isEdited = projectTypeFilter === 'edited';

  grid.innerHTML = list.map(p => {
    const isDone = p.status === 'done';
    const isErr = p.status === 'error' || p.status === 'cancelled';
    const statusCls = isDone ? 'pc-done' : isErr ? 'pc-error' : 'pc-running';
    const onclick = isEdited ? `openPreview('${p.id}','${esc(p.title)}')` : `viewProject('${p.id}')`;
    return `
    <div class="project-card ${statusCls}" onclick="${onclick}">
      <div class="pc-thumb">${isEdited ? '✂' : '🎬'}</div>
      <div class="pc-body">
        <div class="pc-title">${esc(p.title)}</div>
        <div class="pc-theme">${esc(p.theme||'')}</div>
        <div class="pc-meta">
          <span class="pc-status">${sl[p.status]||p.status}</span>
          <span class="pc-date">${fmt(p.created_at)}</span>
        </div>
      </div>
      <div class="pc-actions" onclick="event.stopPropagation()">
        ${isDone ? `
          <button class="pca-btn pca-play" onclick="openPreview('${p.id}','${esc(p.title)}')">▶</button>
          <a class="pca-btn pca-dl" href="${authUrl('/api/projects/'+p.id+'/download')}">⬇</a>
          <button class="pca-btn pca-pub" onclick="openPublishModal('${p.id}')">发布</button>
          ${isEdited ? `<a class="pca-btn pca-edit" href="/editor.html?id=${p.source_project_id||p.id}">再编辑</a>` : `<a class="pca-btn pca-edit" href="/editor.html?id=${p.id}">剪辑</a>`}
          <button class="pca-btn pca-del" onclick="deleteProject('${p.id}')">删除</button>
        ` : isErr ? `
          <button class="pca-btn pca-del" onclick="deleteProject('${p.id}')">删除</button>
        ` : `
          <span class="pca-progress-dot"></span>
        `}
      </div>
    </div>`;
  }).join('');
}

async function loadProjects() {
  const grid = document.getElementById('projects-grid');
  grid.innerHTML = '<div class="loading-placeholder">加载中...</div>';
  try {
    const res = await authFetch('/api/projects'); const data = await res.json();
    if (!data.success) throw new Error(data.error || '加载失败');
    allProjectsCache = data.data || [];
    const badge = document.getElementById('project-count');
    if (badge) { badge.textContent = allProjectsCache.length; badge.style.display = allProjectsCache.length ? '' : 'none'; }
    renderProjectGrid(allProjectsCache);
  } catch(err) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-title">加载失败：'+esc(err.message)+'</div></div>';
  }
}
function fmt(s) { return s ? new Date(s).toLocaleDateString('zh-CN') : ''; }

async function viewProject(id) {
  switchPage('create', { keepProject: true });
  currentProjectId = id;
  const pidEl = document.getElementById('progress-project-id');
  if (pidEl) pidEl.textContent = id.slice(0,8)+'...';
  const res = await authFetch('/api/projects/'+id); const data = await res.json();
  if (!data.success) return;
  const p = data.data;

  // 恢复项目参数到工作台
  restoreProjectToStudio(p);

  if (p.story) loadStoryPreview(id);
  if (p.status === 'done') {
    showResult({ downloadUrl: authUrl('/api/projects/'+id+'/download'), hasVoice: p.voice_enabled, hasMusic: !!p.music_path });
  } else if (p.status === 'error') {
    setPanelState('progress');
    addLog('项目生成失败，可修改参数后重新创作', 'error');
    resetBtn();
  } else {
    setPanelState('progress');
    connectSSE(id);
  }
}

async function deleteProject(id) {
  if (!confirm('确定删除此项目？视频文件将一并删除，此操作不可撤销。')) return;
  try {
    const res = await authFetch('/api/projects/' + id, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      loadProjects();
    } else {
      alert('删除失败: ' + (data.error || '未知错误'));
    }
  } catch (err) {
    alert('删除失败: ' + err.message);
  }
}

// 将已有项目数据恢复到工作台
function restoreProjectToStudio(p) {
  // 标题
  const titleEl = document.getElementById('input-title');
  if (titleEl) titleEl.value = p.title || '';

  // 主题内容
  const themeEl = document.getElementById('input-theme');
  if (themeEl && p.theme) themeEl.value = p.theme;

  // 恢复角色和场景（从 custom_content）
  if (p.custom_content) {
    try {
      const custom = typeof p.custom_content === 'string' ? JSON.parse(p.custom_content) : p.custom_content;
      if (custom.characters && custom.characters.length) {
        characters = custom.characters.map((c, i) => ({
          id: ++charIdCounter,
          name: c.name || '',
          role: c.role || 'main',
          charType: c.charType || (c.race && ['动物','宠物','神兽','怪兽'].includes(c.race) ? 'animal' : 'human'),
          description: c.description || '',
          imageUrl: c.imageUrl || '',
          theme: c.theme || '古代',
          gender: c.gender || 'female',
          race: c.race || '人',
          age: c.age || '青年',
          species: c.species || '',
          subCategory: c.subCategory || '',
          checked: false
        }));
        renderCharacters();
      }
      const scenesData = custom.custom_scenes || custom.scenes;
      if (scenesData && scenesData.length) {
        customScenes = scenesData.map((s, i) => ({
          id: ++sceneIdCounter,
          title: s.title || '场景 ' + (i+1),
          description: s.description || s.action || '',
          dialogue: s.dialogue || '',
          location: s.location || '',
          timeOfDay: s.timeOfDay || '',
          mood: s.mood || '',
          theme: s.theme || '',
          category: s.category || '',
          duration: s.duration || 10,
          dim: s.dim || p.scene_dim || '2d',
          imageUrl: s.imageUrl || '',
          video_provider: s.video_provider || '',
          video_model: s.video_model || '',
          checked: false
        }));
        renderScenes();
        renderTimeline();
      }
    } catch (e) { console.warn('恢复项目数据失败:', e); }
  }

  // 也从 story 的 scenes 恢复（如果 custom_content 没有场景数据）
  if (p.story && p.story.scenes && !customScenes.length) {
    customScenes = p.story.scenes.map((s, i) => ({
      id: ++sceneIdCounter,
      title: s.title || '场景 ' + (i+1),
      description: s.action || s.description || '',
      location: s.location || '',
      timeOfDay: s.timeOfDay || '',
      mood: s.mood || '',
      duration: s.duration || 10,
      dim: p.scene_dim || '2d',
      video_provider: '', video_model: '',
      checked: false
    }));
    renderScenes();
    renderTimeline();
  }

  // 恢复动画风格
  if (p.anim_style && typeof switchAnimStyle === 'function') switchAnimStyle(p.anim_style);
  // 恢复内容类型
  if (p.scene_dim === '3d') switchContentType('3d');
  // 恢复时长
  if (p.duration) { videoDuration = p.duration; }
  // 恢复画幅
  if (p.aspect_ratio) switchAspect(p.aspect_ratio);
  // 恢复配音设置
  if (p.voice_enabled) {
    voiceEnabled = true;
    const vcb = document.getElementById('voice-enabled');
    if (vcb) vcb.checked = true;
    toggleVoice(true);
    if (p.voice_id) {
      selectedVoiceId = p.voice_id;
    }
    voiceGender = p.voice_gender || 'female';
  }

  // 恢复字幕设置
  subtitleEnabled = p.subtitle_enabled !== false;
  document.getElementById('subtitle-enabled').checked = subtitleEnabled;
  toggleSubtitle(subtitleEnabled);
  if (p.subtitle_size) {
    subtitleSize = p.subtitle_size;
    document.getElementById('subtitle-size').value = String(p.subtitle_size);
  }
  if (p.subtitle_position) {
    subtitlePosition = p.subtitle_position;
    document.getElementById('subtitle-position').value = p.subtitle_position;
  }
  if (p.subtitle_color) {
    subtitleColor = p.subtitle_color;
    document.querySelectorAll('.sub-color-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.color === p.subtitle_color);
    });
  }

  // 恢复音乐
  if (p.music_path) {
    musicFilePath = p.music_path;
    musicOriginalName = p.music_original_name || p.music_path.split(/[\\/]/).pop();
    musicTrimStart = p.music_trim_start || 0;
    musicTrimEnd = p.music_trim_end || 0;

    show('music-upload-box', false);
    show('music-loaded-area', true);
    const nameEl = document.getElementById('music-loaded-name');
    if (nameEl) nameEl.textContent = musicOriginalName;
    const badge = document.getElementById('music-status-badge');
    if (badge) { badge.style.display = 'inline-flex'; badge.textContent = '已上传'; }

    if (p.music_volume != null) {
      const volInput = document.getElementById('music-volume-input');
      if (volInput) volInput.value = Math.round(p.music_volume * 100);
    }
    if (p.music_loop != null) {
      const loopInput = document.getElementById('music-loop-input');
      if (loopInput) loopInput.checked = p.music_loop;
    }

    // 加载音频到时间轴
    const fn = musicFilePath.split(/[\\/]/).pop();
    const audioUrl = musicFilePath.includes('assets')
      ? '/api/assets/file/' + encodeURIComponent(fn)
      : '/api/projects/music/' + encodeURIComponent(fn);
    const previewAudio = document.getElementById('music-preview-audio');
    if (previewAudio) previewAudio.src = audioUrl;
    const tlAudio = document.getElementById('tl-music-audio');
    if (tlAudio) {
      tlAudio.src = audioUrl;
      const onMeta = () => {
        musicDuration = tlAudio.duration || 0;
        if (!musicTrimEnd) musicTrimEnd = musicDuration;
        renderMusicTrack();
        tlAudio.removeEventListener('loadedmetadata', onMeta);
      };
      tlAudio.addEventListener('loadedmetadata', onMeta);
      tlAudio.addEventListener('canplay', () => {
        if (!musicDuration && tlAudio.duration && isFinite(tlAudio.duration)) {
          musicDuration = tlAudio.duration;
          if (!musicTrimEnd) musicTrimEnd = musicDuration;
          renderMusicTrack();
        }
      }, { once: true });
    }
  }
}

// ═══════════════════════════════════════════
// SETTINGS PAGE — Universal Model/MCP/Skill Manager
// ═══════════════════════════════════════════
let settingsData = null;
let editingProviderId = null;   // for edit-key modal
let addingModelForProv = null;  // for add-model modal
let presetsCache = null;

const USE_LABELS = { story: '剧情生成', image: '图像生成', video: '视频生成', tts: '语音合成', avatar: '数字人' };

async function loadSettingsPage() {
  const list = document.getElementById('sp-providers-list');
  if (list) list.innerHTML = '<div class="sp-loading">加载中...</div>';
  try {
    const [sRes, pRes] = await Promise.all([authFetch('/api/settings'), authFetch('/api/settings/presets')]);
    const sData = await sRes.json(); const pData = await pRes.json();
    if (!sData.success) throw new Error(sData.error);
    settingsData = sData.data;
    presetsCache = pData.success ? pData.data : [];
    renderProviders(); renderMCPs(); renderSkills();
    startProviderAutoRefresh();
    updateRefreshCountdown();
  } catch (e) {
    if (list) list.innerHTML = `<div class="sp-loading" style="color:var(--error,#ff5050)">加载失败: ${esc(e.message)}</div>`;
  }
}

let _providerRefreshTimer = null;
let _providerCountdownTimer = null;
let _lastRefreshTime = null;
const REFRESH_INTERVAL = 5 * 60 * 1000;

function startProviderAutoRefresh() {
  if (_providerRefreshTimer) clearInterval(_providerRefreshTimer);
  if (_providerCountdownTimer) clearInterval(_providerCountdownTimer);
  _providerRefreshTimer = setInterval(refreshAllProviders, REFRESH_INTERVAL);
  _providerCountdownTimer = setInterval(updateRefreshCountdown, 30000);
  refreshAllProviders();
}
function stopProviderAutoRefresh() {
  if (_providerRefreshTimer) { clearInterval(_providerRefreshTimer); _providerRefreshTimer = null; }
  if (_providerCountdownTimer) { clearInterval(_providerCountdownTimer); _providerCountdownTimer = null; }
}
function updateRefreshCountdown() {
  const indicator = document.getElementById('sp-refresh-indicator');
  if (!indicator || !_lastRefreshTime) return;
  const elapsed = Date.now() - _lastRefreshTime;
  const remaining = Math.max(0, Math.ceil((REFRESH_INTERVAL - elapsed) / 60000));
  const t = new Date(_lastRefreshTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  indicator.style.display = 'inline-flex';
  indicator.innerHTML = `<span class="sp-refresh-dot"></span>${t} 刷新 · ${remaining}分后自动刷新`;
}
async function refreshAllProviders() {
  const indicator = document.getElementById('sp-refresh-indicator');
  const refreshBtn = document.querySelector('[onclick="refreshAllProviders()"]');
  if (indicator) { indicator.style.display = 'inline-flex'; indicator.innerHTML = '<span class="sp-refresh-spin"></span>检测中...'; }
  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.textContent = '刷新中...'; }
  // Set all providers to 'checking' state in UI
  settingsData?.providers?.forEach(p => { if (p.enabled && p.api_key) p._checking = true; });
  renderProviders();
  try {
    const res = await authFetch('/api/settings/providers/refresh-all', { method: 'POST' });
    const d = await res.json();
    if (d.success) {
      const sRes = await authFetch('/api/settings');
      const sData = await sRes.json();
      if (sData.success) { settingsData = sData.data; renderProviders(); }
      _lastRefreshTime = Date.now();
      updateRefreshCountdown();
    }
  } catch (e) {
    if (indicator) { indicator.style.display = 'inline-flex'; indicator.innerHTML = '<span style="color:#ff5050">刷新失败</span>'; }
  } finally {
    if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.textContent = '刷新状态'; }
    settingsData?.providers?.forEach(p => { delete p._checking; });
  }
}

function switchSettingsTab(tab) {
  ['providers', 'mcps', 'skills'].forEach(t => {
    document.getElementById('sptab-' + t)?.classList.toggle('active', t === tab);
    const pane = document.getElementById('sppane-' + t);
    if (pane) pane.style.display = t === tab ? '' : 'none';
  });
}

// ═══ 供应商列表渲染 ═══
function renderProviders() {
  const container = document.getElementById('sp-providers-list');
  if (!container || !settingsData) return;
  if (!settingsData.providers.length) {
    container.innerHTML = `<div class="sp-empty-state">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><rect x="4" y="4" width="32" height="32" rx="6" stroke="currentColor" stroke-width="1.5"/><path d="M13 20h14M20 13v14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      <p>还没有供应商<br><span style="font-size:11px">点击「添加供应商」开始配置</span></p></div>`;
    return;
  }
  container.innerHTML = settingsData.providers.map(p => {
    const models = p.models || [];
    const checking = p._checking;
    const statusClass = checking ? 'checking' : !p.enabled ? 'inactive' : p.test_status === 'error' ? 'error' : p.test_status === 'ok' ? 'active' : 'unknown';
    const statusText  = checking ? '检测中' : !p.enabled ? '未启用' : p.test_status === 'error' ? '异常' : p.test_status === 'ok' ? '正常' : '未检测';
    const statusIcon  = checking ? '<span class="sp-status-spin"></span>' : p.test_status === 'ok' ? '<span class="sp-status-dot active"></span>' : p.test_status === 'error' ? '<span class="sp-status-dot error"></span>' : '';
    const statusTip   = p.test_error ? esc(p.test_error) : '';
    const testedAt = p.last_tested
      ? new Date(p.last_tested).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '-';
    // Model use summary (e.g. "剧情 · 图像")
    const useSummary = [...new Set(models.map(m => USE_LABELS[m.use]).filter(Boolean))].join(' · ');
    return `<div class="sp-provider-row" id="sprow-${esc(p.id)}">
      <div class="sp-prov-main" onclick="toggleProviderModels('${esc(p.id)}')">
        <div class="sp-prov-info spc-name">
          <div class="sp-prov-name-line">
            ${statusIcon}<span class="sp-prov-name">${esc(p.name)}</span>
            <span class="sp-status-badge ${statusClass}" ${statusTip ? `title="${statusTip}"` : ''}>${statusText}</span>
          </div>
          <div class="sp-prov-meta">
            <span class="sp-prov-tag">${esc(p.id.toUpperCase())}</span>
            ${useSummary ? `<span class="sp-prov-use-summary">${useSummary}</span>` : ''}
          </div>
        </div>
        <div class="sp-prov-url spc-url" title="${esc(p.api_url)}">${esc(p.api_url)}</div>
        <div class="sp-prov-key spc-key">
          <span>${p.api_key_masked ? esc(p.api_key_masked) : '<span style="color:var(--text3)">未配置</span>'}</span>
        </div>
        <div class="sp-prov-model-count spc-cnt">
          <span class="sp-cnt-num">${models.length}</span>
          <span class="sp-cnt-label">模型</span>
        </div>
        <div class="sp-prov-tested spc-tested">
          ${testedAt !== '-' ? `<span class="sp-tested-label">最近测试</span>` : ''}
          <span class="sp-tested-time">${testedAt}</span>
        </div>
        <div class="sp-prov-actions spc-ops" onclick="event.stopPropagation()">
          <button class="sp-btn" onclick="editProviderKey('${esc(p.id)}')">编辑</button>
          <button class="sp-btn" id="sptest-${esc(p.id)}" onclick="testProvider('${esc(p.id)}')" ${!p.enabled?'disabled':''}>测试</button>
          <button class="sp-btn danger" onclick="deleteProvider('${esc(p.id)}')">删除</button>
        </div>
        <span class="sp-expand-icon">▶</span>
      </div>
      ${statusTip ? `<div class="sp-error-bar">${statusTip}</div>` : ''}
      <div class="sp-models-sub" id="spmodels-${esc(p.id)}">
        <div class="sp-models-sub-head">
          <span>${models.length} 个模型</span>
          <button class="sp-btn primary-btn" onclick="showAddModel('${esc(p.id)}')">＋ 添加模型</button>
        </div>
        ${models.length ? models.map(m => `
          <div class="sp-model-row">
            <span class="sp-model-name">${esc(m.name)}</span>
            <span class="sp-model-id">${esc(m.id)}</span>
            <span class="sp-model-type sp-model-type-${esc(m.type)}">${esc(m.type)}</span>
            <span class="sp-model-use">${esc(USE_LABELS[m.use] || m.use)}</span>
            <button class="sp-model-del" onclick="deleteModel('${esc(p.id)}','${esc(m.id)}')" title="删除">×</button>
          </div>`).join('')
        : '<div style="font-size:11px;color:var(--text3);padding:4px 0">暂无模型，点击「添加模型」</div>'}
      </div>
    </div>`;
  }).join('');
}

function toggleProviderModels(id) {
  const sub = document.getElementById('spmodels-' + id);
  const main = sub?.previousElementSibling;
  if (!sub) return;
  const open = sub.classList.toggle('open');
  main?.classList.toggle('expanded', open);
}

// ═══ 添加供应商 ═══
async function showAddProvider() {
  if (!presetsCache) {
    const res = await authFetch('/api/settings/presets');
    const d = await res.json();
    presetsCache = d.success ? d.data : [];
  }
  // Reset form
  ['prov-name','prov-id','prov-url','prov-key'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('modal-provider-title').textContent = '添加供应商';
  document.getElementById('btn-save-provider').textContent = '添加';
  // Render preset buttons
  const btns = document.getElementById('sp-preset-btns');
  btns.innerHTML = presetsCache.map(p => `<button class="sp-preset-btn" onclick="applyPreset('${esc(p.id)}')">${esc(p.name || p.id)}</button>`).join('');
  updateModelsPreview([]);
  document.getElementById('modal-provider').style.display = 'flex';
  setTimeout(() => document.getElementById('prov-name').focus(), 100);
}

function applyPreset(presetId) {
  const preset = presetsCache?.find(p => p.id === presetId);
  if (!preset) return;
  document.getElementById('prov-name').value = preset.name;
  document.getElementById('prov-id').value = presetId;
  document.getElementById('prov-url').value = preset.api_url;
  // Mark active preset button
  document.querySelectorAll('.sp-preset-btn').forEach(b => b.classList.toggle('active', b.textContent === preset.name));
  updateModelsPreview(preset.defaultModels || []);
}

function updateModelsPreview(models) {
  const el = document.getElementById('prov-models-preview');
  if (!el) return;
  el.innerHTML = models.length
    ? models.map(m => `<div class="sp-models-preview-row"><span>${esc(m.name)}</span><span style="color:var(--text3)">${esc(m.id)}</span><span class="sp-model-type sp-model-type-${esc(m.type)}" style="font-size:10px">${esc(m.type)}</span></div>`).join('')
    : '<div class="sp-models-preview-empty">选择预设后将自动添加默认模型，也可添加后手动配置</div>';
}

function closeProviderModal() {
  document.getElementById('modal-provider').style.display = 'none';
}

async function saveProvider() {
  const name   = document.getElementById('prov-name').value.trim();
  const id     = document.getElementById('prov-id').value.trim();
  const url    = document.getElementById('prov-url').value.trim();
  const key    = document.getElementById('prov-key').value.trim();
  if (!name || !url) { alert('请填写供应商名称和 API 地址'); return; }
  const btn = document.getElementById('btn-save-provider');
  btn.disabled = true; btn.textContent = '添加中...';
  // Find preset models
  const preset = presetsCache?.find(p => p.id === id);
  const models = preset?.defaultModels || [];
  try {
    const res = await authFetch('/api/settings/providers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id || undefined, name, api_url: url, api_key: key, models })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    document.getElementById('modal-provider').style.display = 'none';
    await loadSettingsPage();
  } catch (e) {
    alert('添加失败: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '添加';
  }
}

// ═══ 编辑供应商 Key/URL ═══
function editProviderKey(id) {
  editingProviderId = id;
  const p = settingsData?.providers.find(p => p.id === id);
  if (!p) return;
  document.getElementById('modal-apikey-title').textContent = `编辑 ${p.name}`;
  document.getElementById('modal-prov-url').value = p.api_url || '';
  document.getElementById('modal-apikey-input').value = '';
  document.getElementById('modal-apikey').style.display = 'flex';
  setTimeout(() => document.getElementById('modal-prov-url').focus(), 100);
}
function closeApiKeyModal() {
  document.getElementById('modal-apikey').style.display = 'none';
  editingProviderId = null;
}
async function saveProviderEdit() {
  if (!editingProviderId) return;
  const url = document.getElementById('modal-prov-url').value.trim();
  const key = document.getElementById('modal-apikey-input').value.trim();
  const btn = document.querySelector('#modal-apikey .btn-primary');
  btn.disabled = true; btn.textContent = '保存中...';
  try {
    const body = {};
    if (url) body.api_url = url;
    if (key) body.api_key = key;
    const res = await fetch(`/api/settings/providers/${editingProviderId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    document.getElementById('modal-apikey').style.display = 'none';
    await loadSettingsPage();
  } catch (e) {
    alert('保存失败: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '保存';
  }
}

// ═══ 删除供应商 ═══
async function deleteProvider(id) {
  const p = settingsData?.providers.find(p => p.id === id);
  if (!confirm(`确认删除供应商「${p?.name || id}」及其所有模型？`)) return;
  await fetch(`/api/settings/providers/${id}`, { method: 'DELETE' });
  await loadSettingsPage();
}

// ═══ 测试连接 ═══
async function testProvider(id) {
  const btn = document.getElementById('sptest-' + id);
  if (btn) { btn.disabled = true; btn.textContent = '测试中...'; }
  try {
    const res = await fetch(`/api/settings/providers/${id}/test`, { method: 'POST' });
    const data = await res.json();
    if (btn) {
      btn.textContent = data.success ? '✓ 正常' : '✕ 失败';
      btn.style.color = data.success ? '#00d464' : '#ff5050';
      setTimeout(() => { if (btn) { btn.textContent = '测试'; btn.style.color = ''; btn.disabled = false; } }, 3000);
    }
    await loadSettingsPage();
  } catch (e) {
    if (btn) { btn.textContent = '失败'; btn.disabled = false; }
  }
}

// ═══ 添加/删除模型 ═══
function showAddModel(providerId) {
  addingModelForProv = providerId;
  ['model-id','model-name'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('modal-model').style.display = 'flex';
  setTimeout(() => document.getElementById('model-id').focus(), 100);
}
function closeModelModal() {
  document.getElementById('modal-model').style.display = 'none';
  addingModelForProv = null;
}
async function saveModel() {
  if (!addingModelForProv) return;
  const modelId = document.getElementById('model-id').value.trim();
  const name    = document.getElementById('model-name').value.trim();
  if (!modelId || !name) { alert('请填写模型 ID 和名称'); return; }
  const btn = document.querySelector('#modal-model .btn-primary');
  btn.disabled = true; btn.textContent = '添加中...';
  try {
    const res = await fetch(`/api/settings/providers/${addingModelForProv}/models`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: modelId, name, type: document.getElementById('model-type').value, use: document.getElementById('model-use').value })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    document.getElementById('modal-model').style.display = 'none';
    await loadSettingsPage();
    // Re-expand this provider's model list
    setTimeout(() => {
      const sub = document.getElementById('spmodels-' + addingModelForProv);
      if (sub && !sub.classList.contains('open')) toggleProviderModels(addingModelForProv);
    }, 100);
  } catch (e) {
    alert('添加失败: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '添加';
    addingModelForProv = null;
  }
}
async function deleteModel(providerId, modelId) {
  if (!confirm(`确认删除模型 ${modelId}？`)) return;
  await fetch(`/api/settings/providers/${providerId}/models/${modelId}`, { method: 'DELETE' });
  await loadSettingsPage();
  setTimeout(() => {
    const sub = document.getElementById('spmodels-' + providerId);
    if (sub && !sub.classList.contains('open')) toggleProviderModels(providerId);
  }, 100);
}

// ═══ MCP ═══
function renderMCPs() {
  const container = document.getElementById('sp-mcps-list');
  if (!container || !settingsData) return;
  if (!settingsData.mcps.length) {
    container.innerHTML = `<div class="sp-empty-state">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="16" stroke="currentColor" stroke-width="1.5"/><path d="M13 20a7 7 0 1 0 14 0 7 7 0 0 0-14 0ZM20 4v3M20 33v3M4 20h3M33 20h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      <p>还没有 MCP 连接器<br><span style="font-size:11px">点击「添加连接器」接入外部工具</span></p></div>`;
    return;
  }
  container.innerHTML = settingsData.mcps.map(m => `
    <div class="sp-card">
      <div class="sp-card-head">
        <div class="sp-card-icon">🔌</div>
        <div class="sp-card-info">
          <div class="sp-card-name">${esc(m.name)}</div>
          <div class="sp-card-desc">${esc(m.description || '外部 MCP 服务')}</div>
          <div class="sp-card-url">${esc(m.url)}</div>
        </div>
      </div>
      <div class="sp-card-actions"><button class="sp-card-del" onclick="deleteMCP('${m.id}')">删除</button></div>
    </div>`).join('');
}
function showAddMCP() {
  ['mcp-name','mcp-url','mcp-desc'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  document.getElementById('modal-mcp').style.display = 'flex';
  setTimeout(() => document.getElementById('mcp-name').focus(), 100);
}
function closeMCPModal() { document.getElementById('modal-mcp').style.display = 'none'; }
async function saveMCP() {
  const name = document.getElementById('mcp-name').value.trim();
  const url  = document.getElementById('mcp-url').value.trim();
  if (!name || !url) { alert('请填写名称和 URL'); return; }
  const btn = document.querySelector('#modal-mcp .btn-primary');
  btn.disabled = true; btn.textContent = '添加中...';
  try {
    const res = await authFetch('/api/settings/mcps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, url, description: document.getElementById('mcp-desc').value.trim() }) });
    const data = await res.json(); if (!data.success) throw new Error(data.error);
    document.getElementById('modal-mcp').style.display = 'none';
    await loadSettingsPage(); switchSettingsTab('mcps');
  } catch(e) { alert('添加失败: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = '添加'; }
}
async function deleteMCP(id) {
  if (!confirm('确认删除该 MCP 连接器？')) return;
  await fetch(`/api/settings/mcps/${id}`, { method: 'DELETE' });
  await loadSettingsPage(); switchSettingsTab('mcps');
}

// ═══ Skill ═══
function renderSkills() {
  const container = document.getElementById('sp-skills-list');
  if (!container || !settingsData) return;
  if (!settingsData.skills.length) {
    container.innerHTML = `<div class="sp-empty-state">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><path d="M20 3l3.5 8.5L32 13l-6 6 1.5 9L20 24l-7.5 4 1.5-9-6-6 8.5-1.5L20 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
      <p>还没有 Skill<br><span style="font-size:11px">点击「新建 Skill」创建 AI 能力</span></p></div>`;
    return;
  }
  const TYPE_COLORS = { '图像':'#ffb400','文本':'#2178ff','视频':'#7850ff','语音':'#00c878','通用':'var(--cyan)' };
  container.innerHTML = settingsData.skills.map(s => `
    <div class="sp-card">
      <div class="sp-card-head">
        <div class="sp-card-icon">${esc(s.emoji||'⚡')}</div>
        <div class="sp-card-info">
          <div class="sp-card-name">${esc(s.name)}</div>
          <div class="sp-card-desc">${esc(s.description||'')}</div>
        </div>
      </div>
      <div class="sp-card-meta">
        <span class="sp-card-type" style="color:${TYPE_COLORS[s.type]||'var(--cyan)'}">${esc(s.type)}</span>
        ${s.endpoint ? `<span class="sp-card-url" style="font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px">${esc(s.endpoint)}</span>` : ''}
      </div>
      <div class="sp-card-actions"><button class="sp-card-del" onclick="deleteSkill('${s.id}')">删除</button></div>
    </div>`).join('');
}
function showAddSkill() {
  ['skill-name','skill-emoji','skill-endpoint','skill-desc'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  document.getElementById('modal-skill').style.display = 'flex';
  setTimeout(() => document.getElementById('skill-name').focus(), 100);
}
function closeSkillModal() { document.getElementById('modal-skill').style.display = 'none'; }
async function saveSkill() {
  const name = document.getElementById('skill-name').value.trim();
  if (!name) { alert('请填写 Skill 名称'); return; }
  const btn = document.querySelector('#modal-skill .btn-primary');
  btn.disabled = true; btn.textContent = '创建中...';
  try {
    const res = await authFetch('/api/settings/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, emoji: document.getElementById('skill-emoji').value.trim()||'⚡', type: document.getElementById('skill-type').value, endpoint: document.getElementById('skill-endpoint').value.trim(), description: document.getElementById('skill-desc').value.trim() }) });
    const data = await res.json(); if (!data.success) throw new Error(data.error);
    document.getElementById('modal-skill').style.display = 'none';
    await loadSettingsPage(); switchSettingsTab('skills');
  } catch(e) { alert('创建失败: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = '创建'; }
}
async function deleteSkill(id) {
  if (!confirm('确认删除该 Skill？')) return;
  await fetch(`/api/settings/skills/${id}`, { method: 'DELETE' });
  await loadSettingsPage(); switchSettingsTab('skills');
}

// ═══════════════════════════════════════════
//  图生视频 (I2V) 模块
// ═══════════════════════════════════════════
let i2vImageUrl = null;
let i2vSelectedProvider = null;
let i2vSelectedModelId = null;
let i2vDuration = 5;
let i2vModels = [];
let i2vPollingTimer = null;

function loadI2VPage() {
  loadI2VModels();
  loadI2VHistory();
}

// ── 图片来源切换 ──
function switchI2VSrc(mode) {
  document.getElementById('i2v-tab-upload').classList.toggle('active', mode === 'upload');
  document.getElementById('i2v-tab-url').classList.toggle('active', mode === 'url');
  document.getElementById('i2v-src-upload').style.display = mode === 'upload' ? '' : 'none';
  document.getElementById('i2v-src-url').style.display = mode === 'url' ? '' : 'none';
}

// ── 拖拽上传 ──
function handleI2VDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('image/')) uploadI2VImage(file);
}

function handleI2VFileSelect(input) {
  const file = input.files?.[0];
  if (file) uploadI2VImage(file);
  input.value = '';
}

async function uploadI2VImage(file) {
  const formData = new FormData();
  formData.append('image', file);
  try {
    const res = await authFetch('/api/i2v/upload-image', { method: 'POST', body: formData });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    setI2VImage(data.data.image_url);
  } catch (e) {
    alert('上传失败: ' + e.message);
  }
}

function loadI2VFromUrl() {
  const url = document.getElementById('i2v-url-input').value.trim();
  if (!url) return;
  setI2VImage(url);
}

function setI2VImage(url) {
  i2vImageUrl = url;
  const sec = document.getElementById('i2v-img-preview-sec');
  const preview = document.getElementById('i2v-img-preview');
  if (sec) sec.style.display = '';
  if (preview) preview.innerHTML = `<img src="${esc(url)}" onerror="this.parentElement.innerHTML='<div style=\\'color:var(--error);font-size:11px;padding:16px\\'>图片加载失败</div>'" />`;
}

function clearI2VImage() {
  i2vImageUrl = null;
  const sec = document.getElementById('i2v-img-preview-sec');
  if (sec) sec.style.display = 'none';
}

// ── 模型加载 ──
async function loadI2VModels() {
  try {
    const res = await authFetch('/api/settings');
    const data = await res.json();
    if (!data.success) return;
    const providers = data.data.providers || [];
    i2vModels = [];
    for (const p of providers) {
      const hasKey = !!(p.api_key || p.api_key_masked);
      if (!p.enabled || !hasKey) continue;
      for (const m of (p.models || [])) {
        if (m.use !== 'video' || m.enabled === false) continue;
        i2vModels.push({ providerId: p.id, providerName: p.name, modelId: m.id, modelName: m.name });
      }
    }
    renderI2VModels();
    if (!i2vSelectedProvider && i2vModels.length) {
      selectI2VModel(i2vModels[0].providerId, i2vModels[0].modelId);
    }
  } catch {}
}

function renderI2VModels() {
  const picker = document.getElementById('i2v-model-picker');
  if (!picker) return;
  const groups = {};
  for (const m of i2vModels) {
    if (!groups[m.providerId]) groups[m.providerId] = { name: m.providerName, id: m.providerId, models: [] };
    groups[m.providerId].models.push(m);
  }
  let html = '';
  const icons = { kling:'🎬', jimeng:'🎭', fal:'⚡', runway:'✈️', luma:'🌙', minimax:'🎞', zhipu:'🧠', replicate:'🔄', huggingface:'🤗', demo:'🧪' };
  for (const g of Object.values(groups)) {
    const icon = icons[g.id] || '🔹';
    html += `<div class="i2v-mp-group"><div class="i2v-mp-group-label">${icon} ${g.name}</div>`;
    for (const m of g.models) {
      const active = m.providerId === i2vSelectedProvider && m.modelId === i2vSelectedModelId;
      html += `<div class="i2v-mp-opt ${active ? 'active' : ''}" onclick="selectI2VModel('${m.providerId}','${m.modelId}')">
        <span class="i2v-mp-opt-name">${m.modelName}</span>
        <span class="i2v-mp-opt-id">${m.modelId}</span>
        <span class="i2v-mp-opt-check">✓</span>
      </div>`;
    }
    html += `</div>`;
  }
  if (!i2vModels.length) {
    html = '<div style="padding:16px;text-align:center;color:var(--text3);font-size:11px">未配置视频模型<br><span onclick="window.location.href=\'/admin.html\'" style="color:var(--cyan);cursor:pointer">前往 AI 配置</span></div>';
  }
  picker.innerHTML = html;
}

function openI2VModelPicker() {
  const picker = document.getElementById('i2v-model-picker');
  if (picker) picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
}

function selectI2VModel(providerId, modelId) {
  i2vSelectedProvider = providerId;
  i2vSelectedModelId = modelId;
  const icons = { kling:'🎬', jimeng:'🎭', fal:'⚡', runway:'✈️', luma:'🌙', minimax:'🎞', zhipu:'🧠', replicate:'🔄', huggingface:'🤗', demo:'🧪' };
  const trigger = document.getElementById('i2v-model-trigger');
  if (trigger) {
    trigger.classList.add('has-value');
    const m = i2vModels.find(v => v.providerId === providerId && v.modelId === modelId);
    document.getElementById('i2v-model-icon').textContent = icons[providerId] || '🔹';
    document.getElementById('i2v-model-label').textContent = m ? `${m.providerName} · ${m.modelName}` : `${providerId} · ${modelId}`;
  }
  const picker = document.getElementById('i2v-model-picker');
  if (picker) picker.style.display = 'none';
  renderI2VModels();
}

// ── 时长 ──
function setI2VDuration(dur, btn) {
  i2vDuration = dur;
  document.querySelectorAll('.i2v-dur-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

// ── 生成 ──
async function startI2VGeneration() {
  if (!i2vImageUrl) { alert('请先上传图片或输入图片 URL'); return; }
  if (!i2vSelectedProvider || !i2vSelectedModelId) { alert('请选择视频模型'); return; }

  const btn = document.getElementById('i2v-gen-btn');
  btn.disabled = true;
  btn.textContent = '生成中...';

  const previewBox = document.getElementById('i2v-preview-box');
  previewBox.innerHTML = `<div class="i2v-progress">
    <span class="i2v-progress-spin">⟳</span>
    <span class="i2v-progress-text">正在生成视频，请稍候...</span>
    <span class="i2v-progress-text" style="font-size:10px;color:var(--text3)">通常需要 1-5 分钟</span>
  </div>`;

  try {
    const res = await authFetch('/api/i2v/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: i2vImageUrl,
        prompt: document.getElementById('i2v-prompt').value.trim(),
        duration: i2vDuration,
        video_provider: i2vSelectedProvider,
        video_model: i2vSelectedModelId
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    pollI2VTask(data.data.taskId);
  } catch (e) {
    previewBox.innerHTML = `<div class="i2v-progress"><span style="color:var(--error)">生成失败: ${esc(e.message)}</span></div>`;
    btn.disabled = false;
    btn.textContent = '生成视频';
  }
}

function pollI2VTask(taskId) {
  if (i2vPollingTimer) clearInterval(i2vPollingTimer);
  i2vPollingTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/i2v/tasks/${taskId}`);
      const data = await res.json();
      if (!data.success) return;
      const task = data.data;
      if (task.status === 'done') {
        clearInterval(i2vPollingTimer);
        i2vPollingTimer = null;
        showI2VResult(taskId);
        const btn = document.getElementById('i2v-gen-btn');
        if (btn) { btn.disabled = false; btn.textContent = '生成视频'; }
        loadI2VHistory();
      } else if (task.status === 'error') {
        clearInterval(i2vPollingTimer);
        i2vPollingTimer = null;
        const previewBox = document.getElementById('i2v-preview-box');
        previewBox.innerHTML = `<div class="i2v-progress"><span style="color:var(--error)">生成失败: ${esc(task.error_message)}</span></div>`;
        const btn = document.getElementById('i2v-gen-btn');
        if (btn) { btn.disabled = false; btn.textContent = '生成视频'; }
        loadI2VHistory();
      }
    } catch {}
  }, 5000);
}

function showI2VResult(taskId) {
  const previewBox = document.getElementById('i2v-preview-box');
  previewBox.innerHTML = `
    <video controls autoplay loop src="${authUrl('/api/i2v/tasks/'+taskId+'/stream')}" style="width:100%;display:block"></video>
    <div class="i2v-result-actions">
      <a class="i2v-result-btn" href="${authUrl('/api/i2v/tasks/'+taskId+'/download')}" download>下载视频</a>
      <button class="i2v-result-btn" onclick="clearI2VImage();document.getElementById('i2v-preview-box').innerHTML='<div class=\\'i2v-preview-empty\\'><span>继续上传新图片生成</span></div>'">新建任务</button>
    </div>`;
}

// ── 历史记录 ──
async function loadI2VHistory() {
  const container = document.getElementById('i2v-history');
  if (!container) return;
  try {
    const res = await authFetch('/api/i2v/tasks');
    const data = await res.json();
    if (!data.success) return;
    const tasks = data.data || [];
    if (!tasks.length) {
      container.innerHTML = '<div class="i2v-history-empty">暂无记录</div>';
      return;
    }
    container.innerHTML = tasks.map(t => {
      const statusLabel = { processing: '生成中', done: '已完成', error: '失败' };
      const time = new Date(t.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      return `<div class="i2v-hist-card" onclick="${t.status === 'done' ? `showI2VResult('${t.id}')` : ''}">
        <img class="i2v-hist-thumb" src="${esc(t.image_url)}" onerror="this.style.background='var(--bg2)'" />
        <div class="i2v-hist-info">
          <div class="i2v-hist-prompt">${esc(t.prompt || '无描述')}</div>
          <div class="i2v-hist-meta">
            <span class="i2v-hist-status ${t.status}">${statusLabel[t.status] || t.status}</span>
            <span>${time}</span>
            <span>${t.video_provider}</span>
            <button class="i2v-hist-del" onclick="event.stopPropagation();deleteI2VTask('${t.id}')" title="删除">✕</button>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch {}
}

async function deleteI2VTask(taskId) {
  if (!confirm('确定删除此任务？')) return;
  await fetch(`/api/i2v/tasks/${taskId}`, { method: 'DELETE' });
  loadI2VHistory();
}

// ═══ 工具 ═══
const g = id => (document.getElementById(id)?.value || '').trim();
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

// ═══ 长篇动画模式 ═══
function setEpisodeCount(n, btn) {
  episodeCount = n;
  document.querySelectorAll('#episode-count-row .episode-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // 重置 index
  if (episodeIndex > n) setEpisodeIndex(1);
  updateEpisodeUI();
}

function setEpisodeIndex(i) {
  if (i < 1 || i > episodeCount) return;
  // 保存当前集的 summary
  const summaryTa = document.getElementById('longform-summary');
  if (summaryTa && episodeIndex > 1) {
    episodeSummaries[episodeIndex] = summaryTa.value;
  }
  episodeIndex = i;
  updateEpisodeUI();
  // 加载目标集的 summary
  if (summaryTa) {
    summaryTa.value = episodeSummaries[i] || '';
  }
}

function updateEpisodeUI() {
  const label = document.getElementById('ep-label');
  if (label) label.innerHTML = `第 <b>${episodeIndex}</b> / ${episodeCount} 集`;
  const prev = document.getElementById('ep-prev');
  const next = document.getElementById('ep-next');
  if (prev) prev.disabled = episodeIndex <= 1;
  if (next) next.disabled = episodeIndex >= episodeCount;
  // 第2集以上显示前情提要
  const wrap = document.getElementById('longform-summary-wrap');
  if (wrap) wrap.style.display = episodeIndex > 1 ? '' : 'none';
}

async function generateLongformEpisode() {
  const theme = (document.getElementById('longform-theme')?.value || '').trim();
  if (!theme) {
    showToast('请先输入长篇主题/世界观', 'warn');
    return;
  }
  const btn = document.getElementById('btn-gen-episode');
  const status = document.getElementById('longform-status');
  btn.disabled = true;
  btn.textContent = '生成中...';
  if (status) status.textContent = '正在生成第' + episodeIndex + '集剧本...';

  // 收集当前角色
  const chars = characters.filter(c => c.name.trim()).map(c => ({
    name: c.name, role: c.role, description: c.description,
    race: c.race || '人'
  }));
  // 前情提要
  const summary = episodeIndex > 1 ? (document.getElementById('longform-summary')?.value || '') : '';

  try {
    const res = await authFetch('/api/story/generate-long', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme,
        genre: 'drama',
        duration: videoDuration,
        language: '中文',
        scene_dim: sceneDim,
        char_dim: charDim,
        anim_style: animStyle,
        episode_count: episodeCount,
        episode_index: episodeIndex,
        characters: chars,
        plot: {},
        previous_summary: summary,
        style_notes: ''
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const story = data.data;
    if (status) status.textContent = `第${episodeIndex}集「${story.title}」生成完成`;

    // 填充场景到 customScenes
    customScenes = [];
    sceneIdCounter = 0;
    if (story.scenes?.length) {
      story.scenes.forEach(s => {
        customScenes.push({
          id: ++sceneIdCounter,
          title: s.title || '场景',
          description: s.action || s.dialogue || '',
          location: s.location || '',
          timeOfDay: s.time_of_day || '',
          mood: s.mood || '',
          theme: '', category: '',
          duration: s.duration || 10,
          dim: '', imageUrl: null,
          video_provider: '', video_model: '', checked: false,
          // 保存额外信息供查看
          _visual_prompt: s.visual_prompt || '',
          _action_type: s.action_type || 'normal',
          _vfx: s.vfx || [],
          _camera: s.camera || '',
          _dialogue: s.dialogue || ''
        });
      });
    }

    // 提取角色（如果 AI 返回了新角色且当前为空）
    if (story.scenes?.length && characters.length === 0) {
      const charNames = new Set();
      story.scenes.forEach(s => {
        (s.characters || []).forEach(name => charNames.add(name));
      });
      charNames.forEach(name => {
        characters.push({
          id: ++charIdCounter,
          name, role: 'main', description: '',
          charType: 'human', race: '人', species: '',
          gender: '', age: '', subCategory: '', theme: '古代',
          dim: '', imageUrl: '', checked: false
        });
      });
      renderCharacters();
      const charDot = document.getElementById('snav-char-dot');
      if (charDot) charDot.style.display = '';
    }

    renderScenes();
    renderTimeline();
    // 自动保存 synopsis 为下一集的前情提要
    if (story.synopsis) {
      const nextSummary = (episodeSummaries[episodeIndex + 1] || '');
      episodeSummaries[episodeIndex + 1] = nextSummary
        ? nextSummary + '\n' + story.synopsis
        : `第${episodeIndex}集：${story.synopsis}`;
    }

    // 切换到场景 tab 显示结果
    switchStudioTab('scene');
    const sceneDot = document.getElementById('snav-scene-dot');
    if (sceneDot) sceneDot.style.display = '';

    showToast(`第${episodeIndex}集剧本已生成，共 ${customScenes.length} 个场景`, 'success');
  } catch (err) {
    if (status) status.textContent = '生成失败：' + err.message;
    showToast('长篇剧本生成失败：' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '生成本集剧本';
  }
}

// ═══ 动作资源库 ═══
async function loadMotionCatalog() {
  if (motionCatalogCache) return motionCatalogCache;
  try {
    const res = await authFetch('/api/story/motions');
    const data = await res.json();
    if (data.success) {
      motionCatalogCache = data.data;
      // 更新计数
      let total = 0;
      Object.values(motionCatalogCache).forEach(cat => total += cat.count);
      const cnt = document.getElementById('motion-cat-count');
      if (cnt) cnt.textContent = total + ' 个动作';
      return motionCatalogCache;
    }
  } catch {}
  return null;
}

function toggleMotionCatalog() {
  const body = document.getElementById('motion-cat-body');
  const arrow = document.getElementById('motion-cat-arrow');
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if (arrow) arrow.classList.toggle('open', !isOpen);
  if (!isOpen && !motionCatalogCache) {
    loadMotionCatalog().then(catalog => {
      if (catalog) renderMotionCategories(catalog);
    });
  }
}

function renderMotionCategories(catalog, filter = '') {
  const container = document.getElementById('motion-categories');
  if (!container || !catalog) return;
  const q = filter.toLowerCase();
  let html = '';
  for (const [key, cat] of Object.entries(catalog)) {
    let motions = cat.motions || [];
    if (q) {
      motions = motions.filter(m =>
        m.name.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q)
      );
      if (!motions.length) continue;
    }
    html += `<div class="motion-cat-group${q ? ' open' : ''}" id="mcg-${key}">
      <div class="motion-cat-group-hd" onclick="this.parentElement.classList.toggle('open')">
        <span>${cat.label}</span>
        <span class="mcg-cnt">${motions.length}</span>
      </div>
      <div class="motion-cat-group-body">
        ${motions.map(m => `<span class="motion-chip" title="${esc(m.desc)}"><span class="motion-chip-name">${esc(m.name)}</span></span>`).join('')}
      </div>
    </div>`;
  }
  container.innerHTML = html || '<div style="font-size:11px;color:var(--text3);padding:8px 0">无匹配动作</div>';
}

function filterMotions(query) {
  if (motionCatalogCache) {
    renderMotionCategories(motionCatalogCache, query);
  }
}

async function matchSceneMotions() {
  const scene = customScenes.find(s => s.id === studioSelectedSceneId);
  if (!scene) {
    showToast('请先选择一个场景', 'warn');
    return;
  }
  const container = document.getElementById('srp-scene-motions');
  if (!container) return;
  container.innerHTML = '<div style="font-size:10px;color:var(--text3);padding:4px 0">匹配中...</div>';

  const text = [scene.title, scene.description, scene._visual_prompt, scene._dialogue].filter(Boolean).join(' ');
  const actionType = scene._action_type || 'normal';

  try {
    const res = await authFetch('/api/story/motions/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, action_type: actionType, count: 5, style: animStyle })
    });
    const data = await res.json();
    if (data.success && data.data.motions?.length) {
      container.innerHTML = data.data.motions.map(m =>
        `<div class="srp-motion-item">
          <span class="srp-motion-name">${esc(m.name)}</span>
          <span class="srp-motion-desc">${esc(m.desc)}</span>
          <span class="srp-motion-score">${m.score}</span>
        </div>`
      ).join('');
    } else {
      container.innerHTML = '<div style="font-size:10px;color:var(--text3);padding:4px 0">未找到匹配动作</div>';
    }
  } catch {
    container.innerHTML = '<div style="font-size:10px;color:var(--text3);padding:4px 0">匹配失败</div>';
  }
}

// ═══ 长篇模式下的 _doGenerate 增强 ═══
// 覆写 _doGenerate 的 longform 分支：在 _doGenerate 内部处理

// ══════════════════════════════════════════
//  AI 数字人页面
// ══════════════════════════════════════════
let avatarDrive = 'text';
let avatarSelected = 'female-1';
let avatarBg = 'office';
let avatarRatio = '9:16';
let avatarTemplate = ''; // 当前选中的脚本模板
let avatarSegments = null; // AI 分段结果 [{text, expression, motion}]

// 历史记录（内存，刷新后清空）
const avatarHistory = [];

async function loadAvatarPage() {
  loadAvModels();
  loadAvatarPresets();
  // 从数据库加载历史记录
  await loadAvatarHistoryFromDB();
  renderAvatarHistory();
}

async function loadAvatarHistoryFromDB() {
  try {
    const resp = await authFetch('/api/avatar/tasks');
    const data = await resp.json();
    if (!data.success || !data.tasks) return;
    // 将 DB 记录合并到内存（去重）
    const existingIds = new Set(avatarHistory.map(h => h.taskId));
    for (const t of data.tasks) {
      if (t.status === 'done' && t.videoUrl && !existingIds.has(t.id)) {
        avatarHistory.push({
          taskId: t.id,
          text: t.text || '',
          videoUrl: t.videoUrl,
          ratio: t.ratio || '9:16',
          model: t.model || '',
          time: new Date(t.created_at)
        });
      }
    }
    // 按时间倒序
    avatarHistory.sort((a, b) => b.time - a.time);
  } catch (err) {
    console.warn('[Avatar] 加载历史失败:', err.message);
  }
}

async function loadAvModels() {
  try {
    const resp = await authFetch('/api/settings');
    const data = await resp.json();
    const providers = data.providers || [];
    const sel = document.getElementById('av-model-selector');
    // 从 settings 追加 use=avatar 的模型到下拉框
    const existingValues = new Set([...sel.options].map(o => o.value));
    let extra = '';
    providers.forEach(p => {
      (p.models || []).forEach(m => {
        if (m.use === 'avatar' && !existingValues.has(m.id)) {
          extra += `<option value="${m.id}">${esc(m.name || m.id)} — ${esc(p.name || p.id)}</option>`;
        }
      });
    });
    if (extra) {
      const group = document.createElement('optgroup');
      group.label = '更多模型';
      group.innerHTML = extra;
      sel.appendChild(group);
    }
  } catch {}
}

function selectAvModel(sel) {
  const model = sel.value || '';
  const hint = document.getElementById('av-gen-hint');
  if (hint) {
    const isMM = model.startsWith('I2V-') || model.startsWith('MiniMax-');
    const isKling = model.startsWith('kling-');
    hint.textContent = isKling
      ? `Kling AI ${model === 'kling-v3' ? '4K旗舰' : '图生视频'} · 预计 1~3 分钟`
      : isMM
      ? `MiniMax Hailuo ${model.includes('Fast') ? '快速模式' : '图生视频'} · 预计 1~3 分钟`
      : `智谱 CogVideoX 图生视频 · 预计 1~3 分钟`;
  }
}

function selectAvatar(el) {
  document.querySelectorAll('.av-avatar-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  avatarSelected = el.dataset.avatar;
}

function switchAvatarDrive(mode, btn) {
  avatarDrive = mode;
  document.querySelectorAll('.av-drive-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('av-drive-text').style.display = mode === 'text' ? '' : 'none';
  document.getElementById('av-drive-audio').style.display = mode === 'audio' ? '' : 'none';
}

async function handleAvatarUpload(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const uploadCard = document.querySelector('.av-avatar-upload');
  const imgEl = uploadCard.querySelector('.av-avatar-img');
  const span = uploadCard.querySelector('span');

  // 本地预览
  const reader = new FileReader();
  reader.onload = function(e) {
    if (imgEl) {
      imgEl.classList.remove('av-avatar-upload-ph');
      imgEl.style.backgroundImage = `url(${e.target.result})`;
      imgEl.style.backgroundSize = 'cover';
      imgEl.style.backgroundPosition = 'center';
      imgEl.innerHTML = '';
    }
    if (span) span.textContent = '上传中...';
  };
  reader.readAsDataURL(file);
  selectAvatar(uploadCard);
  uploadCard.dataset.avatar = ''; // 上传完成前清空，防止带着 'custom' 提交

  // 上传到服务器
  try {
    const fd = new FormData();
    fd.append('image', file);
    const res = await authFetch('/api/avatar/upload-image', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.path) {
      uploadCard.dataset.avatar = data.path; // 服务器路径，如 /api/avatar/images/xxx.png
      if (span) span.textContent = file.name.length > 8 ? file.name.slice(0, 7) + '…' : file.name;
    } else {
      throw new Error(data.error || '上传失败');
    }
  } catch (err) {
    if (span) span.textContent = '上传失败';
    if (imgEl) { imgEl.classList.add('av-avatar-upload-ph'); imgEl.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'; imgEl.style.backgroundImage = ''; }
    alert('图片上传失败：' + err.message);
  }
}

function handleAvatarAudio(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  document.getElementById('av-audio-loaded').style.display = 'flex';
  document.getElementById('av-audio-name').textContent = file.name;
  document.querySelector('.av-audio-drop').style.display = 'none';
}

function removeAvatarAudio() {
  document.getElementById('av-audio-loaded').style.display = 'none';
  document.querySelector('.av-audio-drop').style.display = 'flex';
  document.getElementById('av-audio-input').value = '';
}

function selectAvatarBg(el) {
  document.querySelectorAll('.av-bg-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  avatarBg = el.dataset.bg;
}

function handleAvatarBgUpload(input) {
  if (!input.files || !input.files[0]) return;
  const card = input.closest('.av-bg-card');
  const reader = new FileReader();
  reader.onload = function(e) {
    const preview = card.querySelector('.av-bg-preview');
    if (preview) {
      preview.style.backgroundImage = `url(${e.target.result})`;
      preview.style.backgroundSize = 'cover';
      preview.classList.remove('av-bg-upload-ph');
    }
  };
  reader.readAsDataURL(input.files[0]);
  selectAvatarBg(card);
}

function selectAvatarVoice(el) {
  document.querySelectorAll('.av-voice-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

// 自定义声音上传
let customVoices = JSON.parse(localStorage.getItem('vido_custom_voices') || '[]');

async function uploadCustomVoice(input) {
  if (!input.files?.[0]) return;
  const file = input.files[0];
  const name = prompt('给这个声音起个名字：', file.name.replace(/\.[^.]+$/, ''));
  if (!name) { input.value = ''; return; }

  const fd = new FormData();
  fd.append('audio', file);
  fd.append('name', name);

  try {
    const res = await authFetch('/api/workbench/upload-voice', { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    customVoices.push({ id: data.voiceId, name, file: data.filename });
    localStorage.setItem('vido_custom_voices', JSON.stringify(customVoices));
    renderCustomVoices();
  } catch (err) {
    alert('上传失败: ' + err.message);
  }
  input.value = '';
}

async function renderCustomVoices() {
  const container = document.getElementById('av-custom-voice-list');
  const section = document.getElementById('av-custom-voices');
  if (!container || !section) return;
  // 从服务器加载克隆声音（合并 localStorage）
  try {
    const resp = await authFetch('/api/workbench/voices');
    const data = await resp.json();
    if (data.success && data.voices?.length) {
      // 用服务器数据为准，同步到 localStorage
      customVoices = data.voices.map(v => ({ id: v.id, name: v.name, file: v.filename }));
      localStorage.setItem('vido_custom_voices', JSON.stringify(customVoices));
    }
  } catch {}
  if (!customVoices.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  container.innerHTML = customVoices.map((v, i) => `
    <span class="av-voice-chip av-voice-chip-custom" data-voice="${v.id}" onclick="selectAvatarVoice(this)">
      🎙 ${esc(v.name)}
      <button class="av-voice-chip-del" onclick="event.stopPropagation();removeCustomVoice(${i})">✕</button>
    </span>
  `).join('');
}

function removeCustomVoice(idx) {
  customVoices.splice(idx, 1);
  localStorage.setItem('vido_custom_voices', JSON.stringify(customVoices));
  renderCustomVoices();
}

// 页面加载时渲染
setTimeout(renderCustomVoices, 500);

function setAvatarRatio(ratio, btn) {
  avatarRatio = ratio;
  document.querySelectorAll('.av-ratio-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

// 进度步骤映射
const AV_STEPS = [
  { key: 'start',    label: '准备' },
  { key: 'video',    label: '生成' },
  { key: 'tts',      label: '配音' },
  { key: 'merge',    label: '合成' },
  { key: 'done',     label: '完成' },
];

function renderProgressUI(currentStep, statusMsg, segmentInfo) {
  const stepIdx = AV_STEPS.findIndex(s => s.key === currentStep);
  const stepsHTML = AV_STEPS.map((s, i) => {
    const isDone   = i < stepIdx || currentStep === 'done';
    const isActive = i === stepIdx && currentStep !== 'done';
    const cls = isDone ? 'av-step done' : isActive ? 'av-step active' : 'av-step';
    const dot = isDone
      ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : (i + 1);
    const line = i < AV_STEPS.length - 1
      ? `<div class="av-step-line${isDone ? ' done' : ''}"></div>`
      : '';
    return `<div class="${cls}"><div class="av-step-dot">${dot}</div><div class="av-step-name">${s.label}</div></div>${line}`;
  }).join('');

  // 多段进度条
  let segProgressHTML = '';
  if (segmentInfo && segmentInfo.total > 1) {
    const pct = Math.round((segmentInfo.segment / segmentInfo.total) * 100);
    segProgressHTML = `<div class="av-seg-progress">
      <div class="av-seg-progress-bar"><div class="av-seg-progress-fill" style="width:${pct}%"></div></div>
      <div class="av-seg-progress-label">片段 ${segmentInfo.segment} / ${segmentInfo.total}</div>
    </div>`;
  }

  const isMulti = avatarSegments && avatarSegments.length > 1;
  const subText = isMulti
    ? `多段模式 · ${avatarSegments.length} 个片段`
    : '智谱 CogVideoX · 预计 1~3 分钟';

  return `<div class="av-progress-wrap">
    <div class="av-spinner"></div>
    <div class="av-progress-status" id="av-gen-status">${esc(statusMsg || '正在生成...')}</div>
    <div class="av-progress-sub">${subText}</div>
    ${segProgressHTML}
    <div class="av-progress-steps">${stepsHTML}</div>
  </div>`;
}

async function startAvatarGeneration() {
  const btn = document.getElementById('av-gen-btn');
  const resetBtn = () => {
    btn.disabled = false;
    btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M3.5 2.5l9 5-9 5v-10z" fill="currentColor"/></svg> 生成数字人视频';
  };
  btn.disabled = true;
  btn.innerHTML = '<span class="av-spinner av-spinner-sm" style="display:inline-block"></span> 生成中...';

  const text = document.getElementById('av-text-input')?.value?.trim() || '';
  if (avatarDrive === 'text' && !text) {
    alert('请输入数字人要说的台词');
    resetBtn();
    return;
  }

  const selectedAvEl = document.querySelector('.av-avatar-card.active');
  const avatar = selectedAvEl?.dataset?.avatar || avatarSelected;
  if (!avatar) { alert('请选择数字人形象'); resetBtn(); return; }
  if (avatar === 'custom' || avatar === '') { alert('图片正在上传中，请稍候再试'); resetBtn(); return; }

  // 从 voice chip 取音色
  const voiceId = document.querySelector('.av-voice-chip.active')?.dataset?.voice || '';
  const speed = parseFloat(document.getElementById('av-speed-range')?.value) || 1.0;
  // 从下拉选择器取模型 ID
  const model = document.getElementById('av-model-selector')?.value || 'cogvideox-flash';

  const previewBox = document.getElementById('av-preview-box');
  previewBox.innerHTML = renderProgressUI('start', '正在提交生成任务...');

  // 长文本自动分段：超过50字(约12秒说话)触发分段
  if (text.length > 50 && (!avatarSegments || avatarSegments.length <= 1)) {
    previewBox.innerHTML = renderProgressUI('start', 'AI 智能分段中...');
    try {
      const segRes = await authFetch('/api/avatar/segment-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const segData = await segRes.json();
      if (segData.success && segData.segments?.length > 1) {
        avatarSegments = segData.segments;
        renderAvatarSegments();
        updateAvatarGenHint();
      }
    } catch (segErr) {
      console.warn('[Avatar] 自动分段失败，使用单段模式:', segErr.message);
    }
  }

  try {
    const res = await authFetch('/api/avatar/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        avatar, text, voiceId, speed, ratio: avatarRatio, model,
        title: document.getElementById('av-title-input')?.value?.trim() || '',
        expression: document.getElementById('av-expression')?.value || 'natural',
        background: avatarBg || 'office',
        segments: (avatarSegments && avatarSegments.length > 1) ? avatarSegments : undefined
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || data.message || '生成失败');

    const taskId = data.taskId;

    // SSE 监听进度
    const sse = new EventSource(authUrl(`/api/avatar/tasks/${taskId}/progress`));
    sse.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.step === 'connected') return;

      if (d.step === 'done') {
        sse.close();
        const dlUrl = authUrl(`/api/avatar/tasks/${taskId}/download`);
        const videoSrc = authUrl(d.videoUrl);
        previewBox.innerHTML = `
          <div class="av-result-wrap">
            <video class="av-result-video" controls autoplay playsinline>
              <source src="${videoSrc}" type="video/mp4" />
            </video>
            <div class="av-result-actions">
              <a href="${dlUrl}" download class="av-action-btn av-action-btn-primary">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v8M3 6.5l3.5 3.5 3.5-3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M1.5 11.5h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
                下载视频
              </a>
              <button class="av-action-btn av-action-btn-ghost" onclick="this.closest('.av-preview-box').querySelector('video').requestFullscreen()">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 4V1h3M8 1h3v3M1 8v3h3M11 8v3H8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                全屏
              </button>
              <button class="av-action-btn av-action-btn-regen" onclick="startAvatarGeneration()">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 6a4.5 4.5 0 018.2-2.5M10.5 6a4.5 4.5 0 01-8.2 2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M9.7 1v2.5H7.2M2.3 11V8.5h2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                重新生成
              </button>
            </div>
          </div>`;
        addAvatarHistory({ taskId, text, videoUrl: d.videoUrl, voiceId, ratio: avatarRatio, model });
        resetBtn();
        return;
      }

      if (d.step === 'error') {
        sse.close();
        previewBox.innerHTML = `
          <div class="av-error-wrap">
            <div class="av-error-icon">⚠</div>
            <div class="av-error-title">生成失败</div>
            <div class="av-error-msg">${esc(d.message || '请检查 API 配置后重试')}</div>
            <button class="av-error-retry" onclick="restoreAvatarPipeline()">关闭</button>
            <button class="av-error-retry" style="border-color:var(--accent);color:var(--accent)" onclick="startAvatarGeneration()">重试</button>
          </div>`;
        resetBtn();
        return;
      }

      // 更新进度步骤（含多段信息）
      previewBox.innerHTML = renderProgressUI(d.step, d.message || d.step, d.segment ? { segment: d.segment, total: d.total } : null);
    };
    // SSE 断线自动重连 + 轮询兜底
    let sseRetries = 0;
    sse.onerror = () => {
      sse.close();
      sseRetries++;
      if (sseRetries > 30) return; // 最多重试 30 次（约 5 分钟）
      setTimeout(() => {
        // 先 REST 轮询检查任务状态
        authFetch(`/api/avatar/tasks/${taskId}/status`).then(r => r.json()).then(d => {
          if (d.status === 'done' && d.videoUrl) {
            const dlUrl = authUrl(`/api/avatar/tasks/${taskId}/download`);
            const videoSrc = authUrl(d.videoUrl);
            previewBox.innerHTML = `
              <div class="av-result-wrap">
                <video class="av-result-video" controls autoplay playsinline>
                  <source src="${videoSrc}" type="video/mp4" />
                </video>
                <div class="av-result-actions">
                  <a href="${dlUrl}" download class="av-action-btn av-action-btn-primary">
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v8M3 6.5l3.5 3.5 3.5-3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M1.5 11.5h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
                    下载视频
                  </a>
                  <button class="av-action-btn av-action-btn-ghost" onclick="this.closest('.av-preview-box').querySelector('video').requestFullscreen()">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 4V1h3M8 1h3v3M1 8v3h3M11 8v3H8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    全屏
                  </button>
                  <button class="av-action-btn av-action-btn-regen" onclick="startAvatarGeneration()">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 6a4.5 4.5 0 018.2-2.5M10.5 6a4.5 4.5 0 01-8.2 2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M9.7 1v2.5H7.2M2.3 11V8.5h2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    重新生成
                  </button>
                </div>
              </div>`;
            addAvatarHistory({ taskId, text, videoUrl: d.videoUrl, ratio: avatarRatio, model });
            resetBtn();
          } else if (d.status === 'error') {
            previewBox.innerHTML = `
              <div class="av-error-wrap">
                <div class="av-error-icon">⚠</div>
                <div class="av-error-title">生成失败</div>
                <div class="av-error-msg">${esc(d.error || '请检查 API 配置后重试')}</div>
                <button class="av-error-retry" onclick="restoreAvatarPipeline()">关闭</button>
                <button class="av-error-retry" style="border-color:var(--accent);color:var(--accent)" onclick="startAvatarGeneration()">重试</button>
              </div>`;
            resetBtn();
          }
          // 仍在 processing → 不做任何事，等下次重试
        }).catch(() => {});
      }, 10000); // 10 秒后重试
    };
  } catch (err) {
    previewBox.innerHTML = `
      <div class="av-error-wrap">
        <div class="av-error-icon">⚠</div>
        <div class="av-error-title">请求失败</div>
        <div class="av-error-msg">${esc(err.message)}</div>
        <button class="av-error-retry" onclick="restoreAvatarPipeline()">关闭</button>
        <button class="av-error-retry" style="border-color:var(--accent);color:var(--accent)" onclick="startAvatarGeneration()">重试</button>
      </div>`;
    resetBtn();
  }
}

// ═══ 历史记录 ═══

function addAvatarHistory({ taskId, text, videoUrl, ratio, model, title }) {
  const entry = {
    taskId, text, videoUrl, ratio, model,
    title: title || document.getElementById('av-title-input')?.value?.trim() || '',
    time: new Date()
  };
  avatarHistory.unshift(entry);
  renderAvatarHistory();
}

function renderAvatarHistory() {
  const container = document.getElementById('av-history');
  const countEl = document.getElementById('av-history-count');
  if (!container) return;
  if (!avatarHistory.length) {
    container.innerHTML = '<div class="av-history-empty">完成首次生成后，历史记录将在此显示</div>';
    if (countEl) countEl.style.display = 'none';
    return;
  }
  if (countEl) { countEl.textContent = avatarHistory.length + ' 条'; countEl.style.display = ''; }
  container.innerHTML = avatarHistory.map((h, i) => {
    const timeStr = h.time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const titleStr = h.title ? `<div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:2px;">${esc(h.title)}</div>` : '';
    const textPreview = h.text ? esc(h.text.slice(0, 60)) + (h.text.length > 60 ? '…' : '') : '（无台词）';
    const dlUrl = authUrl(`/api/avatar/tasks/${h.taskId}/download`);
    const videoSrc = authUrl(h.videoUrl);
    return `<div class="av-hist-card" onclick="avatarHistPlay(${i})">
      <div class="av-hist-thumb" id="av-hist-thumb-${i}">
        <video src="${videoSrc}" muted preload="metadata" style="width:100%;height:100%;object-fit:cover;pointer-events:none"></video>
        <div class="av-hist-play">
          <svg width="12" height="14" viewBox="0 0 12 14" fill="none"><path d="M1 1.5l10 5.5L1 12.5V1.5z" fill="white"/></svg>
        </div>
        <div class="av-hist-badge">${h.ratio || '9:16'}</div>
      </div>
      <div class="av-hist-body">
        ${titleStr}<div class="av-hist-text">${textPreview}</div>
        <div class="av-hist-meta">
          <span class="av-hist-time">${timeStr}</span>
          <a href="${dlUrl}" download class="av-hist-dl" onclick="event.stopPropagation()">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v6M2.5 5l2.5 2.5L7.5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 9h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            下载
          </a>
        </div>
      </div>
    </div>`;
  }).join('');
}

function avatarHistPlay(i) {
  const h = avatarHistory[i];
  if (!h) return;
  const previewBox = document.getElementById('av-preview-box');
  const dlUrl = authUrl(`/api/avatar/tasks/${h.taskId}/download`);
  const videoSrc = authUrl(h.videoUrl);
  previewBox.innerHTML = `
    <div class="av-result-wrap">
      <video class="av-result-video" controls autoplay playsinline>
        <source src="${videoSrc}" type="video/mp4" />
      </video>
      <div class="av-result-actions">
        <a href="${dlUrl}" download class="av-action-btn av-action-btn-primary">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v8M3 6.5l3.5 3.5 3.5-3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M1.5 11.5h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          下载视频
        </a>
        <button class="av-action-btn av-action-btn-ghost" onclick="this.closest('.av-preview-box').querySelector('video').requestFullscreen()">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 4V1h3M8 1h3v3M1 8v3h3M11 8v3H8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          全屏
        </button>
      </div>
    </div>`;
  previewBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ═══ AI 生成台词 ═══
async function aiGenerateAvatarText() {
  const btn = document.getElementById('av-ai-gen-btn');
  const ta = document.getElementById('av-text-input');
  if (!btn || !ta) return;
  const origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="av-spinner av-spinner-sm" style="display:inline-block"></span> 生成中';

  // 收集上下文
  const avatarEl = document.querySelector('.av-avatar-card.active');
  const avatarName = avatarEl?.querySelector('span')?.textContent || '数字人';
  const bgEl = document.querySelector('.av-bg-card.active');
  const bgName = bgEl?.querySelector('span')?.textContent || '办公室';
  const existingText = ta.value.trim();

  try {
    const res = await authFetch('/api/avatar/generate-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar_name: avatarName, bg_name: bgName, draft: existingText, template: avatarTemplate })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '生成失败');
    const text = data.text || '';
    if (text) {
      ta.value = text.trim();
      ta.dispatchEvent(new Event('input'));
    } else {
      alert('AI 未返回内容，请检查剧情模型配置');
    }
  } catch (err) {
    alert('AI 生成失败: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHTML;
  }
}

// ═══ 脚本模板选择 ═══
function selectAvatarTemplate(el) {
  document.querySelectorAll('.av-tpl-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  avatarTemplate = el.dataset.tpl || '';
}

// ═══ 台词文本变化时：显示/隐藏分段按钮 ═══
function onAvatarTextChange() {
  const text = document.getElementById('av-text-input')?.value || '';
  const segBtn = document.getElementById('av-seg-btn');
  if (segBtn) segBtn.style.display = text.length > 100 ? '' : 'none';
  // 文本改变后清除旧分段
  if (avatarSegments) {
    avatarSegments = null;
    document.getElementById('av-segments-preview').style.display = 'none';
    updateAvatarGenHint();
  }
}

// ═══ AI 智能分段 ═══
async function segmentAvatarScript() {
  const text = document.getElementById('av-text-input')?.value?.trim();
  if (!text || text.length < 30) { alert('台词太短，无需分段'); return; }

  const btn = document.getElementById('av-seg-btn');
  const origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="av-spinner av-spinner-sm" style="display:inline-block"></span> 分段中';

  try {
    const res = await authFetch('/api/avatar/segment-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '分段失败');

    avatarSegments = data.segments;
    renderAvatarSegments();
    updateAvatarGenHint();
  } catch (err) {
    alert('智能分段失败: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHTML;
  }
}

function renderAvatarSegments() {
  const container = document.getElementById('av-segments-preview');
  const list = document.getElementById('av-seg-list');
  const countEl = document.getElementById('av-seg-count');
  if (!container || !list || !avatarSegments?.length) { container.style.display = 'none'; return; }

  container.style.display = '';
  countEl.textContent = `${avatarSegments.length} 段`;

  const exprLabels = { natural: '自然', smile: '微笑', serious: '严肃', excited: '兴奋', calm: '平静' };
  list.innerHTML = avatarSegments.map((seg, i) => {
    const charCount = seg.text.length;
    const exprLabel = exprLabels[seg.expression] || seg.expression;
    return `<div class="av-seg-item">
      <div class="av-seg-idx">${i + 1}</div>
      <div class="av-seg-body">
        <div class="av-seg-text">${esc(seg.text)}</div>
        <div class="av-seg-meta">
          <span class="av-seg-tag">${charCount}字</span>
          <span class="av-seg-tag expr">${exprLabel}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function clearAvatarSegments() {
  avatarSegments = null;
  document.getElementById('av-segments-preview').style.display = 'none';
  updateAvatarGenHint();
}

function updateAvatarGenHint() {
  const hint = document.getElementById('av-gen-hint');
  if (!hint) return;
  if (avatarSegments && avatarSegments.length > 1) {
    const est = avatarSegments.length * 2;
    hint.textContent = `多段模式 · ${avatarSegments.length} 个片段 · 预计 ${est}~${est * 2} 分钟`;
    hint.style.color = 'var(--accent)';
  } else {
    hint.textContent = '基于智谱 CogVideoX 图生视频 · 预计 1~3 分钟';
    hint.style.color = '';
  }
}

// ═══ 恢复 pipeline 空状态 ═══
function restoreAvatarPipeline() {
  const box = document.getElementById('av-preview-box');
  if (!box) return;
  const tpl = document.getElementById('av-pipeline-tpl');
  if (tpl) {
    box.innerHTML = '';
    box.appendChild(tpl.content.cloneNode(true));
  } else {
    box.innerHTML = '<div class="av-preview-empty"></div>';
  }
}

// ═══ 从形象库导入 ═══
async function openPortraitImport() {
  // 先获取形象列表
  let portraits = [];
  try {
    const res = await authFetch('/api/portrait/list');
    const data = await res.json();
    if (data.success && data.data?.length) {
      portraits = data.data.filter(p => p.status === 'done');
    }
  } catch {}

  const cardsHtml = portraits.length
    ? portraits.map(p => {
      const thumbUrl = p.result_2d?.url || p.result_3d?.url || p.photo_url || '';
      const dimLabel = p.result_2d && p.result_3d ? '2D+3D' : p.result_3d ? '3D' : '2D';
      return `<div class="av-import-card" onclick="selectPortraitAsAvatar('${esc(p.photo_url || thumbUrl)}','${esc(p.name || '形象库')}')">
        ${thumbUrl ? `<img src="${thumbUrl}" alt="" />` : '<div style="aspect-ratio:3/4;background:var(--bg4)"></div>'}
        <div class="av-import-card-info">
          <div class="av-import-card-name">${esc(p.name || '未命名')}</div>
          <div class="av-import-card-dim">${dimLabel}</div>
        </div>
      </div>`;
    }).join('')
    : `<div class="av-import-empty">暂无已完成的形象<br><a onclick="closePortraitImport();switchPage('portrait')">去 AI 形象工坊创建</a></div>`;

  const overlay = document.createElement('div');
  overlay.className = 'av-import-overlay';
  overlay.id = 'av-import-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) closePortraitImport(); };
  overlay.innerHTML = `
    <div class="av-import-modal">
      <div class="av-import-hd">
        <div class="av-import-title">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="5" r="3" stroke="currentColor" stroke-width="1.2"/><path d="M2 14c0-3.31 2.46-6 5.5-6s5.5 2.69 5.5 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          从形象库选择
        </div>
        <button class="av-import-close" onclick="closePortraitImport()">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="av-import-body">
        <div class="av-import-grid">${cardsHtml}</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function closePortraitImport() {
  document.getElementById('av-import-overlay')?.remove();
}

function selectPortraitAsAvatar(imgUrl, name) {
  closePortraitImport();
  // 设置上传卡片显示该图片
  const uploadCard = document.querySelector('.av-avatar-upload');
  if (!uploadCard) return;
  const imgEl = uploadCard.querySelector('.av-avatar-img');
  const span = uploadCard.querySelector('span');
  if (imgEl) {
    imgEl.classList.remove('av-avatar-upload-ph');
    imgEl.style.backgroundImage = `url(${imgUrl})`;
    imgEl.style.backgroundSize = 'cover';
    imgEl.style.backgroundPosition = 'center';
    imgEl.innerHTML = '';
  }
  if (span) span.textContent = name.length > 8 ? name.slice(0, 7) + '…' : name;
  uploadCard.dataset.avatar = imgUrl;
  selectAvatar(uploadCard);
}

// ═══════ 预设图片加载与生成 ═══════

async function loadAvatarPresets() {
  try {
    const resp = await authFetch('/api/avatar/presets');
    const data = await resp.json();
    if (!data.success) return;
    for (const [key, url] of Object.entries(data.avatars || {})) {
      if (url) applyPresetImage('.av-preset-avatar', key, url);
    }
    for (const [key, url] of Object.entries(data.backgrounds || {})) {
      if (url) applyPresetImage('.av-preset-bg', key, url);
    }
  } catch {}
}

function applyPresetImage(selector, key, url) {
  const el = document.querySelector(`${selector}[data-preset="${key}"]`);
  if (!el) return;
  const token = getToken() || '';
  const fullUrl = url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
  const img = new Image();
  img.onload = () => {
    el.classList.add('has-img');
    el.style.background = 'none';
    el.insertBefore(img, el.firstChild);
  };
  img.src = fullUrl;
}

async function generateAvatarPresets(type) {
  const btnId = type === 'background' ? 'av-gen-bg-btn' : 'av-gen-presets-btn';
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="av-spinner av-spinner-sm" style="display:inline-block"></span> 生成中...';

  try {
    const resp = await authFetch('/api/avatar/generate-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: type || 'avatar' })
    });
    const data = await resp.json();
    if (!data.success) { alert(data.error || '生成失败'); return; }
    for (const [key, url] of Object.entries(data.results?.avatars || {})) {
      applyPresetImage('.av-preset-avatar', key, url);
    }
    for (const [key, url] of Object.entries(data.results?.backgrounds || {})) {
      applyPresetImage('.av-preset-bg', key, url);
    }
    if (data.errors?.length) console.warn('[Avatar Presets] 部分失败:', data.errors);
  } catch (e) {
    alert('生成失败: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHTML;
  }
}

// ══════════════════════════════════════════
//  AI 图片生成页面
// ══════════════════════════════════════════
let igSize = '1:1';
let igCount = 1;
let igStyle = 'auto';

function loadImgGenPage() {
  loadIgModels();
}

async function loadIgModels() {
  try {
    const resp = await authFetch('/api/settings');
    const data = await resp.json();
    const providers = data.providers || [];
    const container = document.getElementById('ig-model-selector');
    let html = `<div class="ig-model-opt active" data-model="auto" onclick="selectIgModel(this)">
      <span class="ig-model-icon">A</span>
      <div class="ig-model-info"><div class="ig-model-name">自动选择</div><div class="ig-model-desc">根据配置自动匹配最佳模型</div></div>
    </div>`;
    providers.forEach(p => {
      (p.models || []).forEach(m => {
        if (m.use === 'image') {
          html += `<div class="ig-model-opt" data-model="${m.id}" data-provider="${p.id}" onclick="selectIgModel(this)">
            <span class="ig-model-icon">${(p.name || p.id)[0].toUpperCase()}</span>
            <div class="ig-model-info"><div class="ig-model-name">${esc(m.name || m.id)}</div><div class="ig-model-desc">${esc(p.name || p.id)}</div></div>
          </div>`;
        }
      });
    });
    container.innerHTML = html;
  } catch {}
}

function selectIgModel(el) {
  document.querySelectorAll('.ig-model-opt').forEach(o => o.classList.remove('active'));
  el.classList.add('active');
}

function setIgSize(size, btn) {
  igSize = size;
  btn.closest('.ig-size-btns').querySelectorAll('.ig-size-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function setIgCount(count, btn) {
  igCount = count;
  btn.closest('.ig-size-btns').querySelectorAll('.ig-size-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function setIgStyle(style, el) {
  igStyle = style;
  document.querySelectorAll('.ig-style-tag').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}

function toggleIgNeg() {
  const wrap = document.getElementById('ig-neg-wrap');
  const arrow = document.getElementById('ig-neg-arrow');
  const visible = wrap.style.display !== 'none';
  wrap.style.display = visible ? 'none' : '';
  arrow.classList.toggle('open', !visible);
}

function toggleIgRef() {
  const wrap = document.getElementById('ig-ref-wrap');
  const arrow = document.getElementById('ig-ref-arrow');
  const visible = wrap.style.display !== 'none';
  wrap.style.display = visible ? 'none' : '';
  arrow.classList.toggle('open', !visible);
}

function handleIgRefUpload(input) {
  if (!input.files || !input.files[0]) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const drop = document.querySelector('.ig-ref-drop');
    drop.innerHTML = `<img src="${e.target.result}" style="max-height:100px;border-radius:6px;object-fit:contain" />
      <span style="font-size:10px;color:var(--text3)">已上传参考图</span>`;
  };
  reader.readAsDataURL(input.files[0]);
  document.getElementById('ig-ref-strength').style.display = 'flex';
}

function enhanceImagePrompt() {
  const ta = document.getElementById('ig-prompt');
  if (!ta.value.trim()) return;
  ta.value += ', high quality, detailed, masterpiece, 8K resolution';
  updateCharCount(ta, 'ig-prompt-cnt');
}

async function startImageGeneration() {
  const prompt = document.getElementById('ig-prompt')?.value?.trim();
  if (!prompt) { alert('请输入提示词'); return; }

  const btn = document.getElementById('ig-gen-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="sto-li-spin">&#8635;</span> 生成中...';

  const resultBox = document.getElementById('ig-result-box');
  resultBox.innerHTML = `
    <div class="ig-result-empty" style="animation:fadeUp .3s ease">
      <div class="sto-li-spin" style="font-size:32px;color:var(--accent)">&#8635;</div>
      <div class="ig-empty-text">正在生成图片...</div>
      <div class="ig-empty-sub">请稍候</div>
    </div>`;

  try {
    const activeModel = document.querySelector('.ig-model-opt.active');
    const modelId = activeModel?.dataset.model || 'auto';
    const providerId = activeModel?.dataset.provider || '';
    const negative = document.getElementById('ig-negative')?.value || '';

    const resp = await authFetch('/api/imggen/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, negative, model: modelId, provider: providerId, size: igSize, count: igCount, style: igStyle })
    });
    const data = await resp.json();

    if (data.images && data.images.length > 0) {
      const gridCols = data.images.length > 1 ? 'grid-template-columns:repeat(2,1fr)' : '';
      resultBox.innerHTML = `<div style="display:grid;${gridCols};gap:8px;padding:16px;width:100%">
        ${data.images.map(img => `<img src="${img}" style="width:100%;border-radius:10px;cursor:zoom-in" onclick="openLightbox('${img}','')" />`).join('')}
      </div>`;
    } else {
      resultBox.innerHTML = `
        <div class="ig-result-empty" style="animation:fadeUp .3s ease">
          <div class="ig-empty-text" style="color:var(--success)">请求已提交</div>
          <div class="ig-empty-sub">${data.message || '图片生成功能即将上线'}</div>
        </div>`;
    }
  } catch (e) {
    resultBox.innerHTML = `
      <div class="ig-result-empty" style="animation:fadeUp .3s ease">
        <div class="ig-empty-text" style="color:var(--error)">生成失败</div>
        <div class="ig-empty-sub">${e.message}</div>
      </div>`;
  }

  btn.disabled = false;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1l1.5 3.5H13l-3.5 2.5 1.3 4L7 8.5 3.2 11l1.3-4L1 4.5h4.5z" fill="currentColor"/></svg> 生成图片';
}


// ══════════════════════════════════════════
//  我的素材页面
// ══════════════════════════════════════════
let assetsFilter = 'all';
let assetsCache = [];

async function loadAssetsPage() {
  const grid = document.getElementById('assets-grid');
  grid.innerHTML = '<div class="assets-empty">加载中...</div>';
  try {
    const resp = await authFetch('/api/assets?type=' + assetsFilter);
    const data = await resp.json();
    assetsCache = data.data || [];
    renderAssetsGrid(assetsCache);
  } catch (e) {
    grid.innerHTML = '<div class="assets-empty">加载失败</div>';
  }
}

function filterAssets(type, btn) {
  assetsFilter = type;
  document.querySelectorAll('.assets-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadAssetsPage();
}

function renderAssetsGrid(assets) {
  const grid = document.getElementById('assets-grid');
  if (!assets.length) { grid.innerHTML = '<div class="assets-empty">暂无素材</div>'; return; }

  const TYPE_MAP = { character: '角色', scene: '场景', music: '音乐' };

  grid.innerHTML = assets.map(a => {
    const isMusic = a.type === 'music';
    const thumbContent = isMusic
      ? `<div class="asset-card-thumb music-thumb">
           <span class="asset-card-music-icon">♪</span>
           ${a.duration ? `<span class="asset-card-dur">${formatAssetTime(a.duration)}</span>` : ''}
           <div class="asset-card-play" onclick="event.stopPropagation();previewAssetAudio('${a.id}')">▶</div>
         </div>`
      : `<div class="asset-card-thumb">
           <img src="${a.file_url}" loading="lazy" onerror="this.style.display='none'" />
         </div>`;

    return `<div class="asset-card" onclick="previewAsset('${a.id}')">
      ${thumbContent}
      <div class="asset-card-info">
        <div class="asset-card-name" title="${esc(a.name)}">${esc(a.name)}</div>
        <div class="asset-card-meta">
          <span class="asset-card-type">${TYPE_MAP[a.type] || a.type}</span>
          <span>${new Date(a.created_at).toLocaleDateString('zh-CN')}</span>
        </div>
      </div>
      <div class="asset-card-actions">
        <button class="asset-card-btn" onclick="event.stopPropagation();useAsset('${a.id}')">使用</button>
        ${isMusic ? `<button class="asset-card-btn" onclick="event.stopPropagation();openMusicTrimFromAsset('${a.id}')">裁剪</button>` : ''}
        <button class="asset-card-btn danger" onclick="event.stopPropagation();deleteAsset('${a.id}')">删除</button>
      </div>
    </div>`;
  }).join('');
}

function formatAssetTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

async function uploadAssetFile(input) {
  const file = input.files[0];
  if (!file) return;
  // 显示上传中状态
  const grid = document.getElementById('assets-grid');
  const sizeMB = (file.size / 1024 / 1024).toFixed(1);
  grid.innerHTML = `<div class="assets-empty"><span class="av-spinner" style="display:inline-block;width:28px;height:28px;margin-bottom:8px"></span><div>正在上传 ${esc(file.name)} (${sizeMB}MB)...</div><div style="font-size:11px;color:var(--text3);margin-top:4px">大文件可能需要较长时间</div></div>`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('name', file.name);
  try {
    const resp = await authFetch('/api/assets/upload', { method: 'POST', body: fd });
    const data = await resp.json();
    if (!data.success) { alert(data.error || '上传失败'); loadAssetsPage(); return; }
    // 切换到全部tab确保新素材可见
    assetsFilter = 'all';
    document.querySelectorAll('.assets-tab').forEach(t => t.classList.toggle('active', t.textContent.trim() === '全部'));
    loadAssetsPage();
  } catch (e) { alert('上传失败: ' + e.message); }
  input.value = '';
}

async function deleteAsset(id) {
  if (!confirm('确认删除此素材？')) return;
  try {
    await authFetch('/api/assets/' + id, { method: 'DELETE' });
    loadAssetsPage();
  } catch {}
}

let _assetAudio = null;
async function previewAssetAudio(id) {
  const asset = assetsCache.find(a => a.id === id);
  if (!asset) return;
  if (_assetAudio) { _assetAudio.pause(); _assetAudio = null; return; }
  try {
    const resp = await authFetch(asset.file_url);
    const blob = await resp.blob();
    _assetAudio = new Audio(URL.createObjectURL(blob));
    _assetAudio.onended = () => { _assetAudio = null; };
    _assetAudio.play();
  } catch { }
}

function previewAsset(id) {
  const asset = assetsCache.find(a => a.id === id);
  if (!asset) return;
  if (asset.type === 'music') {
    openMusicTrimModal(asset.file_url, asset.file_path, asset.name);
  } else {
    openLightbox(asset.file_url, asset.name);
  }
}

function useAsset(id) {
  const asset = assetsCache.find(a => a.id === id);
  if (!asset) return;
  if (asset.type === 'music') {
    // 设置为当前项目音乐
    musicFilePath = asset.file_path;
    musicOriginalName = asset.name;
    musicTrimStart = 0;
    musicTrimEnd = 0;
    switchPage('create', { keepProject: true });
    // 更新 UI
    show('music-empty', false);
    show('music-loaded', true);
    const nameEl = document.getElementById('music-file-name');
    if (nameEl) nameEl.textContent = asset.name;
    renderMusicTrack();
    showToast('已选择音乐: ' + asset.name);
  } else {
    showToast('素材已选择（请在创作页面使用）');
  }
}

// ══════════════════════════════════════════
//  音乐裁剪弹窗（专业剪辑风格）
// ══════════════════════════════════════════
let mtmAudio = null;
let mtmDuration = 0;
let mtmStart = 0;
let mtmEnd = 0;
let mtmPlaying = false;
let mtmRAF = null;
let mtmSourcePath = '';
let mtmWaveformData = null;
let mtmZoom = 1;          // 缩放级别
let mtmScrollLeft = 0;    // 滚动偏移(秒)
let mtmDragging = null;   // 'left' | 'right' | 'playhead' | null

function openMusicTrimModal(fileUrl, filePath, name) {
  mtmSourcePath = filePath || '';
  mtmStart = 0; mtmEnd = 0; mtmDuration = 0;
  mtmPlaying = false; mtmWaveformData = null;
  mtmZoom = 1; mtmScrollLeft = 0; mtmDragging = null;
  document.getElementById('mtm-name').value = name ? name.replace(/\.[^.]+$/, '') + '_裁剪' : '';
  const fn = document.getElementById('mtm-file-name');
  if (fn) fn.textContent = name || '';
  document.getElementById('music-trim-modal').classList.add('open');

  if (mtmAudio) { mtmAudio.pause(); mtmAudio = null; }
  // 公开端点不需要 token，直接用路径；有 token 的 URL 也兼容
  const audioUrl = fileUrl.includes('?') ? fileUrl : authUrl(fileUrl);
  mtmAudio = new Audio(audioUrl);
  mtmAudio.preload = 'auto';

  const onReady = () => {
    mtmDuration = mtmAudio.duration;
    mtmEnd = mtmDuration;
    mtmInitCanvas();
    mtmUpdateAll();
    mtmDecodeWaveform(fileUrl);
  };
  mtmAudio.addEventListener('loadedmetadata', onReady);
  // 某些格式(flac等) loadedmetadata 不触发，用 canplay 兜底
  mtmAudio.addEventListener('canplay', () => {
    if (!mtmDuration && mtmAudio.duration && isFinite(mtmAudio.duration)) onReady();
  });
  mtmAudio.addEventListener('error', (e) => {
    console.error('[MTM] audio load error:', mtmAudio.error?.message || e);
  });
  mtmAudio.load();
  mtmBindEvents();
}

function openMusicTrimFromAsset(id) {
  const asset = assetsCache.find(a => a.id === id);
  if (asset) openMusicTrimModal(asset.file_url, asset.file_path, asset.name);
}

function closeMusicTrimModal() {
  document.getElementById('music-trim-modal').classList.remove('open');
  if (mtmAudio) { mtmAudio.pause(); }
  if (mtmRAF) { cancelAnimationFrame(mtmRAF); mtmRAF = null; }
  mtmPlaying = false;
  mtmDragging = null;
}

// --- Canvas 初始化 ---
function mtmInitCanvas() {
  const timeline = document.getElementById('mtm-timeline');
  if (!timeline) return;
  const w = timeline.clientWidth;
  const wf = document.getElementById('mtm-waveform');
  const ruler = document.getElementById('mtm-ruler');
  if (wf) { wf.width = w * 2; wf.style.width = w + 'px'; }
  if (ruler) { ruler.width = w * 2; ruler.style.width = w + 'px'; }
}

// --- 波形解码 ---
function mtmDecodeWaveform(fileUrl) {
  const url = fileUrl.includes('?') ? fileUrl : authUrl(fileUrl);
  authFetch(url).then(r => r.arrayBuffer()).then(buf => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx.decodeAudioData(buf);
  }).then(audioBuffer => {
    const raw = audioBuffer.getChannelData(0);
    const samples = 2000;
    const blockSize = Math.floor(raw.length / samples);
    mtmWaveformData = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      let peak = 0;
      const off = i * blockSize;
      for (let j = 0; j < blockSize; j++) {
        const v = Math.abs(raw[off + j] || 0);
        if (v > peak) peak = v;
      }
      mtmWaveformData[i] = peak;
    }
    mtmDrawAll();
    mtmFlashHandles();
  }).catch(() => mtmDrawAll());
}

function mtmFlashHandles() {
  const hl = document.getElementById('mtm-handle-left');
  const hr = document.getElementById('mtm-handle-right');
  if (hl) { hl.classList.add('hint'); setTimeout(() => hl.classList.remove('hint'), 2000); }
  if (hr) { hr.classList.add('hint'); setTimeout(() => hr.classList.remove('hint'), 2000); }
}

// --- 坐标转换 ---
function mtmVisibleDuration() { return mtmDuration / mtmZoom; }
function mtmTimeToX(t, canvasW) {
  return ((t - mtmScrollLeft) / mtmVisibleDuration()) * canvasW;
}
function mtmXToTime(x, elW) {
  return mtmScrollLeft + (x / elW) * mtmVisibleDuration();
}
function mtmTimeToPct(t) {
  return ((t - mtmScrollLeft) / mtmVisibleDuration()) * 100;
}

// --- 绘制标尺 ---
function mtmDrawRuler() {
  const canvas = document.getElementById('mtm-ruler');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const visDur = mtmVisibleDuration();
  // 选择合适的刻度间距
  const intervals = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  let interval = 5;
  for (const iv of intervals) {
    if (visDur / iv <= 30) { interval = iv; break; }
  }

  ctx.fillStyle = 'rgba(251,251,251,.35)';
  ctx.font = '18px system-ui, sans-serif';
  ctx.textAlign = 'center';

  const startT = Math.floor(mtmScrollLeft / interval) * interval;
  for (let t = startT; t <= mtmScrollLeft + visDur; t += interval) {
    if (t < 0) continue;
    const x = mtmTimeToX(t, w);
    if (x < -20 || x > w + 20) continue;

    // 主刻度线
    ctx.fillRect(x, h - 8, 1, 8);

    // 时间文字
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const label = m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
    ctx.fillText(label, x, h - 10);

    // 子刻度
    const subCount = interval >= 10 ? 5 : interval >= 2 ? 4 : 2;
    const subInterval = interval / subCount;
    for (let si = 1; si < subCount; si++) {
      const st = t + si * subInterval;
      const sx = mtmTimeToX(st, w);
      if (sx >= 0 && sx <= w) {
        ctx.fillRect(sx, h - 4, 1, 4);
      }
    }
  }
}

// --- 绘制波形 ---
function mtmDrawWaveform() {
  const canvas = document.getElementById('mtm-waveform');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (!mtmWaveformData || !mtmDuration) {
    // 占位条纹
    ctx.fillStyle = 'rgba(251,251,251,.06)';
    for (let i = 0; i < w; i += 3) {
      const bh = 8 + Math.abs(Math.sin(i * 0.04)) * 35 + Math.random() * 5;
      ctx.fillRect(i, (h - bh) / 2, 2, bh);
    }
    return;
  }

  let peak = 0;
  for (let i = 0; i < mtmWaveformData.length; i++) {
    if (mtmWaveformData[i] > peak) peak = mtmWaveformData[i];
  }
  if (peak === 0) peak = 1;

  const visDur = mtmVisibleDuration();
  const samplesPerSec = mtmWaveformData.length / mtmDuration;

  for (let px = 0; px < w; px++) {
    const t = mtmScrollLeft + (px / w) * visDur;
    const si = Math.floor(t * samplesPerSec);
    if (si < 0 || si >= mtmWaveformData.length) continue;

    const v = mtmWaveformData[si] / peak;
    const barH = Math.max(2, v * h * 0.82);
    const inRegion = t >= mtmStart && t <= mtmEnd;

    ctx.fillStyle = inRegion ? 'rgba(33,255,243,.5)' : 'rgba(251,251,251,.1)';
    ctx.fillRect(px, (h - barH) / 2, 1.5, barH);
  }
}

// --- 更新遮罩和选区 ---
function mtmUpdateSelection() {
  if (!mtmDuration) return;
  const maskL = document.getElementById('mtm-mask-left');
  const maskR = document.getElementById('mtm-mask-right');
  const sel = document.getElementById('mtm-selection');
  const hlt = document.getElementById('mtm-handle-left-time');
  const hrt = document.getElementById('mtm-handle-right-time');

  const lPct = Math.max(0, mtmTimeToPct(mtmStart));
  const rPct = Math.min(100, mtmTimeToPct(mtmEnd));
  const wPct = rPct - lPct;

  maskL.style.width = Math.max(0, lPct) + '%';
  maskR.style.width = Math.max(0, 100 - rPct) + '%';
  sel.style.left = lPct + '%';
  sel.style.width = wPct + '%';

  if (hlt) hlt.textContent = mtmFmtTime(mtmStart);
  if (hrt) hrt.textContent = mtmFmtTime(mtmEnd);
}

// --- 更新播放指针 ---
function mtmUpdatePlayhead(time) {
  const ph = document.getElementById('mtm-playhead');
  if (!ph) return;
  ph.style.left = mtmTimeToPct(time) + '%';
  const label = document.getElementById('mtm-playhead-time');
  if (label) label.textContent = mtmFmtTime(time);
}

// --- 更新信息显示 ---
function mtmUpdateInfo() {
  const ct = document.getElementById('mtm-current-time');
  const st = document.getElementById('mtm-start-time');
  const et = document.getElementById('mtm-end-time');
  const sd = document.getElementById('mtm-sel-dur');
  const td = document.getElementById('mtm-total-dur');
  const curTime = mtmAudio ? mtmAudio.currentTime : 0;

  if (ct) ct.textContent = mtmFmtTimePrecise(curTime);
  if (st) st.textContent = mtmFmtTime(mtmStart);
  if (et) et.textContent = mtmFmtTime(mtmEnd);
  if (sd) sd.textContent = mtmFmtTime(mtmEnd - mtmStart);
  if (td) td.textContent = mtmFmtTime(mtmDuration);
}

// --- 统一刷新 ---
function mtmDrawAll() {
  mtmDrawRuler();
  mtmDrawWaveform();
  mtmUpdateSelection();
}
function mtmUpdateAll() {
  mtmDrawAll();
  mtmUpdateInfo();
  if (mtmAudio) mtmUpdatePlayhead(mtmAudio.currentTime);
}

// --- 格式化时间 ---
function mtmFmtTime(sec) {
  if (!sec || !isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}
function mtmFmtTimePrecise(sec) {
  if (!sec || !isFinite(sec) || sec < 0) return '0:00.0';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + s.toFixed(1).padStart(4, '0');
}

// --- 事件绑定 ---
let _mtmAC = null; // AbortController for cleanup
function mtmBindEvents() {
  // 清除上次绑定
  if (_mtmAC) _mtmAC.abort();
  _mtmAC = new AbortController();
  const sig = { signal: _mtmAC.signal };

  const timeline = document.getElementById('mtm-timeline');
  if (!timeline) return;

  const getHandle = (which) => document.getElementById(which === 'left' ? 'mtm-handle-left' : 'mtm-handle-right');

  // 拖拽手柄
  const onDown = (which) => (e) => {
    e.preventDefault(); e.stopPropagation();
    mtmHideCutPopup();
    mtmDragging = which;
    const h = getHandle(which);
    if (h) h.classList.add('dragging');

    const onMove = (e) => {
      if (!mtmDragging) return;
      const rect = timeline.getBoundingClientRect();
      const t = mtmXToTime(e.clientX - rect.left, rect.width);
      if (mtmDragging === 'left') {
        mtmStart = Math.max(0, Math.min(t, mtmEnd - 0.5));
      } else if (mtmDragging === 'right') {
        mtmEnd = Math.min(mtmDuration, Math.max(t, mtmStart + 0.5));
      }
      mtmDrawAll();
      mtmUpdateInfo();
    };
    const onUp = () => {
      const h2 = getHandle(mtmDragging);
      if (h2) h2.classList.remove('dragging');
      mtmDragging = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  getHandle('left')?.addEventListener('mousedown', onDown('left'), sig);
  getHandle('right')?.addEventListener('mousedown', onDown('right'), sig);

  // 拖拽播放指针
  const playhead = document.getElementById('mtm-playhead');
  if (playhead) {
    playhead.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      mtmHideCutPopup();
      mtmDragging = 'playhead';
      playhead.classList.add('dragging');

      const phMove = (e) => {
        const rect = timeline.getBoundingClientRect();
        const t = Math.max(0, Math.min(mtmDuration, mtmXToTime(e.clientX - rect.left, rect.width)));
        if (mtmAudio) mtmAudio.currentTime = t;
        mtmUpdatePlayhead(t);
        mtmUpdateInfo();
      };
      const phUp = (e) => {
        playhead.classList.remove('dragging');
        mtmDragging = null;
        document.removeEventListener('mousemove', phMove);
        document.removeEventListener('mouseup', phUp);
        // 拖拽结束弹出剪切按钮
        const rect = timeline.getBoundingClientRect();
        mtmShowCutPopup(e.clientX - rect.left);
      };
      document.addEventListener('mousemove', phMove);
      document.addEventListener('mouseup', phUp);
    }, sig);
  }

  // 点击波形区域 → 移动播放指针 + 弹出剪切按钮
  timeline.addEventListener('mousedown', (e) => {
    if (e.target.closest('.mtm-handle') || e.target.closest('.mtm-playhead') || e.target.closest('.mtm-cut-popup')) return;
    e.preventDefault();
    mtmHideCutPopup();
    const rect = timeline.getBoundingClientRect();

    const seek = (ev) => {
      const t = Math.max(0, Math.min(mtmDuration, mtmXToTime(ev.clientX - rect.left, rect.width)));
      if (mtmAudio) mtmAudio.currentTime = t;
      mtmUpdatePlayhead(t);
      mtmUpdateInfo();
    };
    seek(e);
    mtmDragging = 'playhead';

    const onMove = (ev) => seek(ev);
    const onUp = (ev) => {
      mtmDragging = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      mtmShowCutPopup(ev.clientX - rect.left);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, sig);

  // 滚轮缩放
  timeline.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = timeline.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseTime = mtmXToTime(mouseX, rect.width);

    if (e.deltaY < 0) mtmZoom = Math.min(32, mtmZoom * 1.25);
    else mtmZoom = Math.max(1, mtmZoom / 1.25);

    // 保持鼠标位置对应的时间不变
    mtmScrollLeft = mouseTime - (mouseX / rect.width) * mtmVisibleDuration();
    mtmClampScroll();
    mtmUpdateAll();
  }, sig);
}

function mtmClampScroll() {
  const maxScroll = Math.max(0, mtmDuration - mtmVisibleDuration());
  mtmScrollLeft = Math.max(0, Math.min(mtmScrollLeft, maxScroll));
}

// --- 剪切浮动按钮 ---
function mtmShowCutPopup(xPx) {
  const popup = document.getElementById('mtm-cut-popup');
  const timeline = document.getElementById('mtm-timeline');
  if (!popup || !timeline) return;
  const tw = timeline.clientWidth;
  // 限制不超出两侧
  let left = Math.max(50, Math.min(xPx, tw - 50));
  popup.style.left = left + 'px';
  popup.style.bottom = '-38px';
  popup.classList.add('show');
}

function mtmHideCutPopup() {
  const popup = document.getElementById('mtm-cut-popup');
  if (popup) popup.classList.remove('show');
}

function mtmCutSetStart() {
  if (!mtmAudio) return;
  mtmStart = Math.max(0, Math.min(mtmAudio.currentTime, mtmEnd - 0.5));
  mtmDrawAll();
  mtmUpdateInfo();
  mtmHideCutPopup();
}

function mtmCutSetEnd() {
  if (!mtmAudio) return;
  mtmEnd = Math.min(mtmDuration, Math.max(mtmAudio.currentTime, mtmStart + 0.5));
  mtmDrawAll();
  mtmUpdateInfo();
  mtmHideCutPopup();
}

// --- 播放控制 ---
function mtmTogglePlay() {
  if (!mtmAudio) return;
  mtmHideCutPopup();
  if (mtmPlaying) {
    mtmAudio.pause();
    mtmPlaying = false;
    if (mtmRAF) { cancelAnimationFrame(mtmRAF); mtmRAF = null; }
    mtmSetPlayBtn(false);
    return;
  }
  // 如果指针在选区外，从选区起点开始
  if (mtmAudio.currentTime < mtmStart || mtmAudio.currentTime >= mtmEnd) {
    mtmAudio.currentTime = mtmStart;
  }
  mtmAudio.play().catch(err => {
    console.error('[MTM] play failed:', err.name, err.message);
    mtmPlaying = false;
    mtmSetPlayBtn(false);
  });
  mtmPlaying = true;
  mtmSetPlayBtn(true);

  const tick = () => {
    if (!mtmPlaying) return;
    const ct = mtmAudio.currentTime;
    if (ct >= mtmEnd) {
      mtmAudio.pause();
      mtmAudio.currentTime = mtmEnd;
      mtmPlaying = false;
      mtmSetPlayBtn(false);
      mtmUpdatePlayhead(mtmEnd);
      mtmUpdateInfo();
      return;
    }
    mtmUpdatePlayhead(ct);
    mtmUpdateInfo();
    mtmRAF = requestAnimationFrame(tick);
  };
  mtmRAF = requestAnimationFrame(tick);
}

function mtmSetPlayBtn(playing) {
  const btn = document.getElementById('mtm-play-btn');
  const icon = document.getElementById('mtm-play-icon');
  if (btn) btn.classList.toggle('playing', playing);
  if (icon) icon.innerHTML = playing
    ? '<rect x="3" y="2" width="3" height="10" rx="1" fill="currentColor"/><rect x="8" y="2" width="3" height="10" rx="1" fill="currentColor"/>'
    : '<path d="M3 1.5v11l9-5.5z" fill="currentColor"/>';
}

// --- 缩放按钮 ---
function mtmZoomIn() {
  const centerTime = mtmScrollLeft + mtmVisibleDuration() / 2;
  mtmZoom = Math.min(32, mtmZoom * 1.5);
  mtmScrollLeft = centerTime - mtmVisibleDuration() / 2;
  mtmClampScroll();
  mtmUpdateAll();
}
function mtmZoomOut() {
  const centerTime = mtmScrollLeft + mtmVisibleDuration() / 2;
  mtmZoom = Math.max(1, mtmZoom / 1.5);
  mtmScrollLeft = centerTime - mtmVisibleDuration() / 2;
  mtmClampScroll();
  mtmUpdateAll();
}

// --- 重置选区 ---
function mtmReset() {
  mtmStart = 0;
  mtmEnd = mtmDuration;
  mtmZoom = 1;
  mtmScrollLeft = 0;
  mtmUpdateAll();
}

// --- 应用裁剪到当前项目 ---
function mtmApply() {
  if (!mtmDuration) return;
  musicTrimStart = Math.round(mtmStart * 100) / 100;
  musicTrimEnd = Math.round(mtmEnd * 100) / 100;
  showToast('已应用裁剪: ' + mtmFmtTime(mtmStart) + ' — ' + mtmFmtTime(mtmEnd));
  closeMusicTrimModal();
}

// --- 保存到素材库 ---
async function mtmSave() {
  const name = document.getElementById('mtm-name').value.trim();
  if (mtmEnd <= mtmStart) { alert('请先选择裁剪范围'); return; }
  if (mtmEnd - mtmStart < 1) { alert('裁剪片段至少 1 秒'); return; }

  const btn = document.getElementById('mtm-save-btn');
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '保存中...';

  try {
    const resp = await authFetch('/api/assets/trim-music', {
      method: 'POST',
      body: JSON.stringify({
        source_path: mtmSourcePath,
        start: Math.round(mtmStart * 100) / 100,
        end: Math.round(mtmEnd * 100) / 100,
        name: name || undefined
      })
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);
    showToast('裁剪片段已保存到素材库');
    closeMusicTrimModal();
    if (document.getElementById('page-assets')?.classList.contains('active')) loadAssetsPage();
  } catch (e) {
    alert('保存失败: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

// ═══ 音乐集成 ═══
function onPickMusic(asset) {
  if (!asset) return;
  musicFilePath = asset.file_path;
  musicOriginalName = asset.name;
  musicTrimStart = 0;
  musicTrimEnd = 0;
  show('music-upload-box', false);
  show('music-loaded-area', true);
  document.getElementById('music-loaded-name').textContent = asset.name;
  const badge = document.getElementById('music-status-badge');
  if (badge) { badge.style.display = ''; badge.textContent = '素材库'; }

  // 加载音频获取时长，然后渲染时间轴轨道
  const fn = asset.file_path.split(/[\\/]/).pop();
  const audioUrl = asset.file_url || '/api/assets/file/' + encodeURIComponent(fn);
  const previewAudio = document.getElementById('music-preview-audio');
  if (previewAudio) previewAudio.src = audioUrl;
  const tlAudio = document.getElementById('tl-music-audio');
  if (tlAudio) {
    tlAudio.src = audioUrl;
    const onMeta = () => {
      musicDuration = tlAudio.duration || 0;
      musicTrimEnd = musicDuration;
      renderMusicTrack();
      tlAudio.removeEventListener('loadedmetadata', onMeta);
    };
    tlAudio.addEventListener('loadedmetadata', onMeta);
    // 有些格式 loadedmetadata 不触发
    tlAudio.addEventListener('canplay', () => {
      if (!musicDuration && tlAudio.duration && isFinite(tlAudio.duration)) {
        musicDuration = tlAudio.duration;
        musicTrimEnd = musicDuration;
        renderMusicTrack();
      }
    }, { once: true });
  }
  // asset 自带 duration 时先用
  if (asset.duration) {
    musicDuration = asset.duration;
    musicTrimEnd = musicDuration;
    renderMusicTrack();
  }
  showToast('已选择: ' + asset.name);
}

function openMusicTrimForCurrent() {
  if (!musicFilePath) return;
  const filename = musicFilePath.split(/[\\/]/).pop();
  // 根据文件路径判断走哪个公开端点
  const isAsset = musicFilePath.includes('assets');
  const musicUrl = isAsset
    ? '/api/assets/file/' + encodeURIComponent(filename)
    : '/api/projects/music/' + encodeURIComponent(filename);
  openMusicTrimModal(musicUrl, musicFilePath, musicOriginalName || '背景音乐');
}

// ═══ 素材选择弹窗 ═══
let assetPickerCallback = null;

function openAssetPicker(type, onSelect) {
  assetPickerCallback = onSelect;
  document.getElementById('asset-picker-title').textContent = type === 'music' ? '选择音乐素材' : '选择素材';
  document.getElementById('asset-picker-modal').classList.add('open');
  const grid = document.getElementById('ap-grid');
  grid.innerHTML = '<div style="padding:20px;color:var(--text3);text-align:center">加载中...</div>';

  authFetch('/api/assets?type=' + type).then(r => r.json()).then(data => {
    const assets = data.data || [];
    if (!assets.length) { grid.innerHTML = '<div style="padding:20px;color:var(--text3);text-align:center">暂无素材</div>'; return; }
    grid.innerHTML = assets.map(a => {
      const isMusic = a.type === 'music';
      return `<div class="ap-item" onclick="selectPickerAsset('${a.id}')" data-id="${a.id}">
        <div class="ap-item-thumb ${isMusic ? 'music' : ''}">
          ${isMusic
            ? `<span style="font-size:24px;opacity:.2">♪</span>`
            : `<img src="${a.file_url}" onerror="this.style.display='none'" />`}
        </div>
        <div class="ap-item-name" title="${esc(a.name)}">${esc(a.name)}${a.duration ? ' (' + formatAssetTime(a.duration) + ')' : ''}</div>
      </div>`;
    }).join('');
  }).catch(() => { grid.innerHTML = '<div style="padding:20px;color:var(--text3)">加载失败</div>'; });
}

function selectPickerAsset(id) {
  document.querySelectorAll('.ap-item').forEach(el => el.classList.remove('selected'));
  const el = document.querySelector('.ap-item[data-id="' + id + '"]');
  if (el) el.classList.add('selected');
  if (assetPickerCallback) {
    const assets = assetsCache.length ? assetsCache : [];
    // 需要重新拿
    authFetch('/api/assets/' + id).then(r => r.json()).then(data => {
      if (data.success) {
        assetPickerCallback(data.data);
        closeAssetPicker();
      }
    }).catch(() => {});
  }
}

function closeAssetPicker() {
  document.getElementById('asset-picker-modal').classList.remove('open');
  assetPickerCallback = null;
}

// ══════════════════════════════════════════
//  创作页面增强：负面提示词 + 运动控制 + 种子
// ══════════════════════════════════════════
let negativePrompt = '';
let cameraMotion = '';
let motionIntensity = 5;
function toggleNegPrompt() {
  const wrap = document.getElementById('neg-prompt-wrap');
  if (wrap) wrap.style.display = wrap.style.display === 'none' ? '' : 'none';
}

function setCameraMotion(motion, btn) {
  if (cameraMotion === motion) {
    cameraMotion = '';
    btn.classList.remove('active');
  } else {
    cameraMotion = motion;
    document.querySelectorAll('.motion-preset').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
  }
}

function updateMotionIntensity(val) {
  motionIntensity = parseInt(val);
  const label = document.getElementById('motion-intensity-val');
  if (label) label.textContent = val;
}

// ══════════════════════════════════════════
//  AI 小说模块
// ══════════════════════════════════════════
let nvCurrentId = null;
let nvCurrentChapter = 1;
let nvSaveTimer = null;
let nvStreaming = false;
let nvCurrentMode = 'read'; // 'read' | 'outline' | 'write'
let nvOutlineSaveTimer = null;

const NV_TYPE_PRESETS = {
  flash: { label: '超短篇', chapter_count: 1, chapter_words: 1500 },
  short: { label: '短篇',  chapter_count: 5, chapter_words: 2000 },
  long:  { label: '长篇',  chapter_count: 20, chapter_words: 3000 }
};

async function nvLoadPage() {
  // 加载小说列表
  try {
    const res = await fetch('/api/novel', { headers: { 'Authorization': 'Bearer ' + getToken() } });
    const data = await res.json();
    const list = document.getElementById('nv-list');
    if (!data.success || !data.novels.length) {
      list.innerHTML = '<div class="nv-list-empty">暂无小说</div>';
      return;
    }
    list.innerHTML = data.novels.map(n => {
      const typeLabel = NV_TYPE_PRESETS[n.novel_type]?.label || '短篇';
      return `
      <div class="nv-list-item ${n.id === nvCurrentId ? 'active' : ''}" onclick="nvSelect('${n.id}')">
        <div class="nv-list-title"><span class="nv-list-type">${typeLabel}</span>${esc(n.title)}</div>
        <div class="nv-list-meta">
          <span>${n.total_words || 0} 字</span>
          <span>${(n.chapters || []).length} 章</span>
        </div>
      </div>`;
    }).join('');
  } catch {}
  // 加载模型列表
  try {
    const res = await fetch('/api/novel/models', { headers: { 'Authorization': 'Bearer ' + getToken() } });
    const data = await res.json();
    const sel = document.getElementById('nv-model');
    if (data.success && data.models.length) {
      sel.innerHTML = '<option value="">自动选择</option>' +
        data.models.map(m => `<option value="${m.providerId}">${m.providerName} / ${m.modelName}</option>`).join('');
    }
  } catch {}
}

function nvShowCreateDialog() {
  const modal = document.createElement('div');
  modal.className = 'nv-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="nv-modal-box">
      <h3>新建小说</h3>
      <div class="nv-create-types" id="nv-create-types">
        <div class="nv-create-type" data-type="flash" onclick="nvCreateTypeSelect(this,'flash')">
          <div class="nv-create-type-name">超短篇</div>
          <div class="nv-create-type-desc">1~3章 约1500字<br>闪小说、微型故事</div>
        </div>
        <div class="nv-create-type active" data-type="short" onclick="nvCreateTypeSelect(this,'short')">
          <div class="nv-create-type-name">短篇</div>
          <div class="nv-create-type-desc">5~10章 约1万字<br>短篇小说、故事</div>
        </div>
        <div class="nv-create-type" data-type="long" onclick="nvCreateTypeSelect(this,'long')">
          <div class="nv-create-type-name">长篇</div>
          <div class="nv-create-type-desc">20章+ 6万字+<br>连载长篇小说</div>
        </div>
      </div>
      <label class="nv-label" style="margin-top:0">小说标题</label>
      <input class="nv-inp" id="nv-create-title" placeholder="给你的小说起个名字..." style="margin-bottom:12px" autocomplete="one-time-code" data-lpignore="true" data-1p-ignore />
      <label class="nv-label">题材</label>
      <select class="nv-sel" id="nv-create-genre" style="margin-bottom:12px">
        <option value="fantasy">奇幻</option><option value="wuxia">武侠</option><option value="xianxia">仙侠</option>
        <option value="scifi">科幻</option><option value="romance">言情</option><option value="mystery">悬疑</option>
        <option value="horror">恐怖</option><option value="urban">都市</option><option value="historical">历史</option>
      </select>
      <div class="nv-modal-actions">
        <button class="nv-act-btn" onclick="this.closest('.nv-modal').remove()">取消</button>
        <button class="nv-gen-btn" onclick="nvDoCreate(this)">创建</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#nv-create-title').focus();
}
let _nvCreateType = 'short';
function nvCreateTypeSelect(el, type) {
  _nvCreateType = type;
  el.closest('.nv-create-types').querySelectorAll('.nv-create-type').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
}
async function nvDoCreate(btn) {
  const modal = btn.closest('.nv-modal');
  const title = modal.querySelector('#nv-create-title').value.trim();
  if (!title) return alert('请输入标题');
  const genre = modal.querySelector('#nv-create-genre').value;
  const preset = NV_TYPE_PRESETS[_nvCreateType];
  btn.disabled = true; btn.textContent = '创建中...';
  try {
    const res = await fetch('/api/novel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
      body: JSON.stringify({
        title, genre, novel_type: _nvCreateType,
        chapter_count: preset.chapter_count,
        chapter_words: preset.chapter_words
      })
    });
    const data = await res.json();
    if (data.success) {
      modal.remove();
      nvCurrentId = data.novel.id;
      nvLoadPage();
      nvSelect(data.novel.id);
    } else alert(data.error);
  } catch (e) { alert('创建失败: ' + e.message); }
  btn.disabled = false; btn.textContent = '创建';
}

async function nvSelect(id) {
  try {
    const res = await fetch('/api/novel/' + id, { headers: { 'Authorization': 'Bearer ' + getToken() } });
    const data = await res.json();
    if (!data.success) return;
    const novel = data.novel;
    const isNewSelect = nvCurrentId !== id;
    nvCurrentId = id;
    if (isNewSelect) nvCurrentChapter = 1;

    // 更新列表高亮
    document.querySelectorAll('.nv-list-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nv-list-item').forEach(el => {
      if (el.getAttribute('onclick')?.includes(id)) el.classList.add('active');
    });

    // 显示编辑器
    const _$ = id => document.getElementById(id);
    if (_$('nv-editor-empty')) _$('nv-editor-empty').style.display = 'none';
    if (_$('nv-editor-active')) _$('nv-editor-active').style.display = '';
    if (_$('nv-title')) _$('nv-title').value = novel.title;
    if (_$('nv-genre')) _$('nv-genre').value = novel.genre || 'fantasy';
    if (_$('nv-style')) _$('nv-style').value = novel.style || 'descriptive';
    if (_$('nv-chapter-words')) _$('nv-chapter-words').value = novel.chapter_words || 2000;
    if (_$('nv-chapter-count')) _$('nv-chapter-count').value = novel.chapter_count || 10;
    if (_$('nv-description')) _$('nv-description').value = novel.description || '';
    if (novel.provider && _$('nv-model')) _$('nv-model').value = novel.provider;

    // 篇幅类型
    const novelType = novel.novel_type || 'short';
    if (_$('nv-type-badge')) _$('nv-type-badge').textContent = NV_TYPE_PRESETS[novelType]?.label || '短篇';
    document.querySelectorAll('.nv-type-card').forEach(c => {
      c.classList.toggle('active', c.dataset.type === novelType);
    });

    // 统计信息
    const totalWords = novel.total_words || 0;
    const chaptersDone = (novel.chapters || []).filter(c => c.status === 'done').length;
    const chaptersTotal = novel.outline?.chapters?.length || novel.chapter_count || 0;
    document.getElementById('nv-mode-stats').textContent = `${totalWords} 字 · ${chaptersDone}/${chaptersTotal} 章`;

    // 渲染大纲工作台
    nvRenderOutlineWorkspace(novel);

    // 渲染写作工作台
    nvRenderChapterTabs(novel);

    // 自动选择有内容的章节
    const firstWithContent = (novel.chapters || []).find(c => c.content && c.content.trim());
    if (firstWithContent) {
      const curCh = (novel.chapters || []).find(c => c.index === nvCurrentChapter);
      if (!curCh?.content?.trim()) nvCurrentChapter = firstWithContent.index;
    }
    nvShowChapter(nvCurrentChapter, novel);

    // 渲染阅读模式
    _nvReadNovelCache = novel;
    nvRenderReadMode(novel);

    // 选择小说时自动决定模式：有内容→阅读，无内容→大纲
    if (isNewSelect) {
      nvCurrentMode = firstWithContent ? 'read' : 'outline';
    }
    // 应用当前模式的 DOM 显示
    document.querySelectorAll('.nv-mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === nvCurrentMode));
    document.getElementById('nv-ws-read').style.display = nvCurrentMode === 'read' ? '' : 'none';
    document.getElementById('nv-ws-outline').style.display = nvCurrentMode === 'outline' ? '' : 'none';
    document.getElementById('nv-ws-write').style.display = nvCurrentMode === 'write' ? '' : 'none';
  } catch (e) { console.error('nvSelect error', e); }
  nvLoadPage();
}

// ── 模式切换 ──
function nvSwitchMode(mode) {
  nvCurrentMode = mode;
  document.querySelectorAll('.nv-mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  document.getElementById('nv-ws-read').style.display = mode === 'read' ? '' : 'none';
  document.getElementById('nv-ws-outline').style.display = mode === 'outline' ? '' : 'none';
  document.getElementById('nv-ws-write').style.display = mode === 'write' ? '' : 'none';
  if (mode === 'write' && nvCurrentId) {
    nvSaveCurrentContent();
    nvSelect(nvCurrentId);
  } else if (mode === 'read' && nvCurrentId) {
    nvSelect(nvCurrentId);
  }
}

// ── 篇幅类型切换 ──
function nvSetType(type) {
  if (!nvCurrentId) return;
  const preset = NV_TYPE_PRESETS[type];
  document.querySelectorAll('.nv-type-card').forEach(c => c.classList.toggle('active', c.dataset.type === type));
  document.getElementById('nv-type-badge').textContent = preset.label;
  document.getElementById('nv-chapter-words').value = preset.chapter_words;
  document.getElementById('nv-chapter-count').value = preset.chapter_count;
  nvSaveField('novel_type', type);
  nvSaveField('chapter_words', preset.chapter_words);
  nvSaveField('chapter_count', preset.chapter_count);
}

// ── 大纲工作台 ──
function nvRenderOutlineWorkspace(novel) {
  const synopsis = document.getElementById('nv-synopsis');
  synopsis.value = novel.outline?.synopsis || '';
  nvRenderOutlineChapters(novel.outline);
}

function nvRenderOutlineChapters(outline) {
  const el = document.getElementById('nv-outline-chapters');
  if (!outline || !outline.chapters || !outline.chapters.length) {
    el.innerHTML = '<div class="nv-outline-empty">生成或导入大纲后，章节将在此显示</div>';
    return;
  }
  el.innerHTML = outline.chapters.map(ch => `
    <div class="nv-ol-ch-card" data-index="${ch.index}">
      <div class="nv-ol-ch-idx">${ch.index}</div>
      <div class="nv-ol-ch-body">
        <input class="nv-ol-ch-title" value="${esc(ch.title || '')}" placeholder="章节标题" onchange="nvSaveOutlineChapter(${ch.index},'title',this.value)" />
        <textarea class="nv-ol-ch-summary" placeholder="章节摘要..." onchange="nvSaveOutlineChapter(${ch.index},'summary',this.value)">${esc(ch.summary || '')}</textarea>
      </div>
      <button class="nv-ol-ch-del" onclick="nvDeleteOutlineChapter(${ch.index})" title="删除章节">&times;</button>
    </div>
  `).join('');
  // 自适应 textarea 高度
  el.querySelectorAll('.nv-ol-ch-summary').forEach(ta => {
    ta.style.height = 'auto';
    ta.style.height = Math.max(24, ta.scrollHeight) + 'px';
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.max(24, ta.scrollHeight) + 'px'; });
  });
}

async function nvSaveSynopsis() {
  if (!nvCurrentId) return;
  const synopsis = document.getElementById('nv-synopsis').value;
  const novel = await nvFetch(nvCurrentId);
  if (!novel) return;
  const outline = novel.outline || { synopsis: '', chapters: [] };
  outline.synopsis = synopsis;
  await nvSaveField('outline', outline);
}

async function nvSaveOutlineChapter(index, field, value) {
  if (!nvCurrentId) return;
  const novel = await nvFetch(nvCurrentId);
  if (!novel || !novel.outline) return;
  const ch = novel.outline.chapters.find(c => c.index === index);
  if (ch) {
    ch[field] = value;
    await nvSaveField('outline', novel.outline);
  }
}

async function nvDeleteOutlineChapter(index) {
  if (!nvCurrentId) return;
  const novel = await nvFetch(nvCurrentId);
  if (!novel || !novel.outline) return;
  if (novel.outline.chapters.length <= 1) return alert('至少保留一个章节');
  if (!confirm(`删除第${index}章大纲？`)) return;
  novel.outline.chapters = novel.outline.chapters.filter(c => c.index !== index);
  // 重排索引
  novel.outline.chapters.forEach((c, i) => c.index = i + 1);
  await nvSaveField('outline', novel.outline);
  nvRenderOutlineChapters(novel.outline);
  // 同步删除对应的已写章节
  const chapters = (novel.chapters || []).filter(c => c.index !== index);
  await nvSaveField('chapters', chapters);
}

async function nvAddOutlineChapter() {
  if (!nvCurrentId) return;
  const novel = await nvFetch(nvCurrentId);
  if (!novel) return;
  const outline = novel.outline || { synopsis: '', chapters: [] };
  const newIndex = outline.chapters.length ? Math.max(...outline.chapters.map(c => c.index)) + 1 : 1;
  outline.chapters.push({ index: newIndex, title: '', summary: '' });
  await nvSaveField('outline', outline);
  nvRenderOutlineChapters(outline);
  // 聚焦到新章节标题输入
  setTimeout(() => {
    const cards = document.querySelectorAll('.nv-ol-ch-card');
    if (cards.length) cards[cards.length - 1].querySelector('.nv-ol-ch-title')?.focus();
  }, 50);
}

// ── 导入大纲 ──
function nvShowImportOutline() {
  const modal = document.createElement('div');
  modal.className = 'nv-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="nv-modal-box">
      <h3>导入大纲</h3>
      <div style="font-size:12px;color:var(--text3);margin-bottom:10px;line-height:1.5">
        粘贴你的大纲文本，每行一个章节。支持格式：<br>
        <span style="color:var(--text2)">第1章 标题 摘要...</span> 或 <span style="color:var(--text2)">1. 标题 - 摘要</span> 或 <span style="color:var(--text2)">章节标题（每行自动编号）</span>
      </div>
      <label class="nv-label" style="margin-top:0">故事简介（可选）</label>
      <textarea id="nv-import-synopsis" rows="2" placeholder="一句话概括..." style="margin-bottom:10px"></textarea>
      <label class="nv-label">章节大纲</label>
      <textarea id="nv-import-text" rows="12" placeholder="第1章 初入江湖 少年离开家乡前往京城&#10;第2章 风云际会 在客栈遇到神秘剑客&#10;第3章 暗流涌动 发现一个惊天阴谋"></textarea>
      <div class="nv-modal-actions">
        <button class="nv-act-btn" onclick="this.closest('.nv-modal').remove()">取消</button>
        <button class="nv-gen-btn" onclick="nvDoImportOutline(this)">导入</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#nv-import-text').focus();
}

async function nvDoImportOutline(btn) {
  if (!nvCurrentId) return;
  const modal = btn.closest('.nv-modal');
  const synopsis = modal.querySelector('#nv-import-synopsis').value.trim();
  const text = modal.querySelector('#nv-import-text').value.trim();
  if (!text) return alert('请粘贴大纲内容');

  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const chapters = [];
  lines.forEach((line, i) => {
    // 尝试解析: "第X章 标题 摘要" / "X. 标题 - 摘要" / 纯文本
    let title = '', summary = '';
    let m;
    if ((m = line.match(/^第(\d+)章[：:\s]+(.+)/))) {
      const rest = m[2];
      const parts = rest.split(/[：:\s]{2,}|——|--|\s{2,}/);
      title = parts[0].trim();
      summary = parts.slice(1).join(' ').trim();
    } else if ((m = line.match(/^(\d+)[.、)）]\s*(.+)/))) {
      const rest = m[2];
      const parts = rest.split(/[-—：:]\s*/);
      title = parts[0].trim();
      summary = parts.slice(1).join(' ').trim();
    } else {
      const parts = line.split(/[-—：:]\s*/);
      title = parts[0].trim();
      summary = parts.slice(1).join(' ').trim();
    }
    chapters.push({ index: i + 1, title: title || line, summary });
  });

  const outline = { synopsis, chapters };
  await nvSaveField('outline', outline);
  await nvSaveField('chapter_count', chapters.length);
  document.getElementById('nv-chapter-count').value = chapters.length;
  document.getElementById('nv-synopsis').value = synopsis;
  nvRenderOutlineChapters(outline);
  modal.remove();
}

// ── 写作工作台 ──
function nvRenderChapterTabs(novel) {
  const tabs = document.getElementById('nv-chapter-tabs');
  const chapterIndices = new Set();
  const baseCount = novel.outline ? novel.outline.chapters.length : (novel.chapter_count || 0);
  for (let i = 1; i <= baseCount; i++) chapterIndices.add(i);
  (novel.chapters || []).forEach(c => chapterIndices.add(c.index));
  if (chapterIndices.size === 0) chapterIndices.add(1);
  const sorted = [...chapterIndices].sort((a, b) => a - b);

  let html = '';
  sorted.forEach(i => {
    const ch = (novel.chapters || []).find(c => c.index === i);
    const active = i === nvCurrentChapter ? 'active' : '';
    const done = ch && ch.status === 'done' ? 'done' : '';
    const title = ch?.title || novel.outline?.chapters?.find(c => c.index === i)?.title || `第${i}章`;
    html += `<button class="nv-ch-tab ${active} ${done}" onclick="nvSwitchChapter(${i})" oncontextmenu="event.preventDefault();nvDeleteChapter(${i})" title="${esc(title)}（右键删除）">第${i}章</button>`;
  });
  html += `<button class="nv-ch-tab nv-ch-add" onclick="nvAddChapter()" title="添加章节">+</button>`;
  tabs.innerHTML = html;
}

async function nvAddChapter() {
  if (!nvCurrentId) return;
  nvSaveCurrentContent();
  const novel = await nvFetch(nvCurrentId);
  if (!novel) return;
  const indices = (novel.chapters || []).map(c => c.index);
  if (novel.outline?.chapters) novel.outline.chapters.forEach(c => indices.push(c.index));
  const maxIndex = indices.length ? Math.max(...indices) : 0;
  const newIndex = maxIndex + 1;
  nvCurrentChapter = newIndex;
  nvRenderChapterTabs({ ...novel, chapters: [...(novel.chapters || []), { index: newIndex, title: `第${newIndex}章`, content: '', status: '' }] });
  document.getElementById('nv-content').textContent = '';
  nvUpdateWordCount();
}

async function nvDeleteChapter(index) {
  if (!nvCurrentId) return;
  const novel = await nvFetch(nvCurrentId);
  if (!novel) return;
  const chapters = (novel.chapters || []).filter(c => c.index !== index);
  const allIndices = new Set();
  chapters.forEach(c => allIndices.add(c.index));
  if (novel.outline?.chapters) novel.outline.chapters.forEach(c => { if (c.index !== index) allIndices.add(c.index); });
  if (allIndices.size === 0 && chapters.length === 0) return alert('至少保留一个章节');
  if (!confirm(`确定删除第${index}章？`)) return;
  let outline = novel.outline;
  if (outline?.chapters) {
    outline = { ...outline, chapters: outline.chapters.filter(c => c.index !== index) };
  }
  await fetch('/api/novel/' + nvCurrentId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
    body: JSON.stringify({ chapters, outline })
  });
  if (nvCurrentChapter === index) nvCurrentChapter = 1;
  nvSelect(nvCurrentId);
}

function nvSwitchChapter(index) {
  if (nvStreaming) return;
  nvSaveCurrentContent();
  nvCurrentChapter = index;
  nvSelect(nvCurrentId);
}

function nvShowChapter(index, novel) {
  nvCurrentChapter = index;
  const content = document.getElementById('nv-content');
  const ch = (novel.chapters || []).find(c => c.index === index);
  content.textContent = ch ? ch.content : '';
  nvUpdateWordCount();
}

let _nvReadChapter = 1;
function nvRenderReadMode(novel) {
  const tabs = document.getElementById('nv-read-chapter-tabs');
  const body = document.getElementById('nv-read-content');
  if (!tabs || !body) { console.warn('[Novel] read mode elements not found'); return; }
  const chapters = (novel.chapters || []).filter(c => c.content && c.content.trim()).sort((a, b) => a.index - b.index);
  console.log('[Novel] renderReadMode:', novel.title, 'chapters with content:', chapters.length);
  if (!chapters.length) {
    tabs.innerHTML = '';
    body.textContent = '暂无章节内容，请在「写作」模式中生成。';
    return;
  }
  // 确保当前阅读章节有效
  if (!chapters.find(c => c.index === _nvReadChapter)) _nvReadChapter = chapters[0].index;
  // 渲染章节 tabs
  tabs.innerHTML = chapters.map(c => {
    const title = c.title || novel.outline?.chapters?.find(o => o.index === c.index)?.title || `第${c.index}章`;
    return `<button class="nv-ch-tab ${c.index === _nvReadChapter ? 'active' : ''}" onclick="nvReadChapter(${c.index})">${esc(title)}</button>`;
  }).join('');
  // 渲染内容（简易 Markdown → HTML）
  const ch = chapters.find(c => c.index === _nvReadChapter);
  const chTitle = ch?.title || novel.outline?.chapters?.find(o => o.index === _nvReadChapter)?.title || '';
  const raw = ch?.content || '暂无内容';
  // 按段落分割，处理 Markdown 标题
  const formatted = raw.split(/\n{2,}/).map(para => {
    const trimmed = para.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('# ')) return `<h2 style="font-size:20px;font-weight:700;color:var(--accent);margin:28px 0 12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.06);">${esc(trimmed.slice(2))}</h2>`;
    if (trimmed.startsWith('## ')) return `<h3 style="font-size:17px;font-weight:600;color:var(--text);margin:24px 0 10px;">${esc(trimmed.slice(3))}</h3>`;
    if (trimmed.startsWith('### ')) return `<h4 style="font-size:15px;font-weight:600;color:var(--text2);margin:20px 0 8px;">${esc(trimmed.slice(4))}</h4>`;
    // 普通段落：首行缩进
    return `<p style="text-indent:2em;margin:0 0 16px;line-height:2;">${esc(trimmed).replace(/\n/g, '<br>')}</p>`;
  }).filter(Boolean).join('');
  body.innerHTML = (chTitle ? `<div style="font-size:22px;font-weight:700;text-align:center;margin-bottom:20px;color:var(--accent);">${esc(chTitle)}</div>` : '') + formatted;
  console.log('[Novel] read ch', _nvReadChapter, 'length:', (ch?.content||'').length);
}

let _nvReadNovelCache = null;
function nvReadChapter(index) {
  _nvReadChapter = index;
  // 优先用缓存，避免每次切章都请求 API
  if (_nvReadNovelCache) {
    nvRenderReadMode(_nvReadNovelCache);
    return;
  }
  if (nvCurrentId) {
    fetch('/api/novel/' + nvCurrentId, { headers: { 'Authorization': 'Bearer ' + getToken() } })
      .then(r => r.json()).then(data => { if (data.success) { _nvReadNovelCache = data.novel; nvRenderReadMode(data.novel); } });
  }
}

function nvUpdateWordCount() {
  const content = document.getElementById('nv-content');
  const count = (content?.textContent || '').replace(/\s/g, '').length;
  const wcEl = document.getElementById('nv-word-count');
  if (wcEl) wcEl.textContent = count + ' 字';
  // 右侧面板统计
  const statWords = document.getElementById('nv-stat-words');
  if (statWords) statWords.textContent = count + ' 字';
  const target = parseInt(document.getElementById('nv-chapter-words')?.value || 3000);
  const statTarget = document.getElementById('nv-stat-target');
  if (statTarget) statTarget.textContent = target + ' 字';
  const bar = document.getElementById('nv-stat-bar');
  if (bar) bar.style.width = Math.min(100, Math.round(count / target * 100)) + '%';
}

function nvAutoSaveContent() {
  nvUpdateWordCount();
  clearTimeout(nvSaveTimer);
  nvSaveTimer = setTimeout(() => nvSaveCurrentContent(), 2000);
}

async function nvSaveCurrentContent() {
  if (!nvCurrentId || nvStreaming) return;
  // 只在写作模式且编辑器可见时才保存
  if (nvCurrentMode !== 'write') return;
  const writeWs = document.getElementById('nv-ws-write');
  if (!writeWs || writeWs.style.display === 'none') return;
  try {
    const novel = await nvFetch(nvCurrentId);
    if (!novel) return;
    const chapters = [...(novel.chapters || [])];
    const content = document.getElementById('nv-content').textContent;
    const existing = chapters.findIndex(c => c.index === nvCurrentChapter);
    // 不要用空内容覆盖已有章节
    if (!content.trim() && existing >= 0 && chapters[existing].content) return;
    const outlineChapter = novel.outline?.chapters?.find(c => c.index === nvCurrentChapter);
    const chData = {
      index: nvCurrentChapter,
      title: outlineChapter?.title || `第${nvCurrentChapter}章`,
      content,
      word_count: content.replace(/\s/g, '').length,
      status: 'done'
    };
    if (existing >= 0) chapters[existing] = chData;
    else if (content.trim()) chapters.push(chData);
    else return;
    chapters.sort((a, b) => a.index - b.index);
    await fetch('/api/novel/' + nvCurrentId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
      body: JSON.stringify({ chapters })
    });
  } catch {}
}

async function nvFetch(id) {
  try {
    const res = await fetch('/api/novel/' + id, { headers: { 'Authorization': 'Bearer ' + getToken() } });
    const data = await res.json();
    return data.success ? data.novel : null;
  } catch { return null; }
}

async function nvSaveField(field, value) {
  if (!nvCurrentId) return;
  try {
    await fetch('/api/novel/' + nvCurrentId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
      body: JSON.stringify({ [field]: value })
    });
  } catch {}
}

async function nvGenerateOutline() {
  if (!nvCurrentId) return;
  const btn = document.getElementById('nv-outline-btn');
  btn.disabled = true;
  const origHTML = btn.innerHTML;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="animation:spin 1s linear infinite"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" stroke-dasharray="28" stroke-dashoffset="8" opacity=".6"/></svg> 生成中...';
  try {
    const res = await fetch('/api/novel/' + nvCurrentId + '/generate-outline', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() }
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('nv-synopsis').value = data.outline.synopsis || '';
      nvRenderOutlineChapters(data.outline);
      document.getElementById('nv-chapter-count').value = data.outline.chapters?.length || 0;
      // 刷新 tabs
      const novel = await nvFetch(nvCurrentId);
      if (novel) {
        nvRenderChapterTabs(novel);
        document.getElementById('nv-mode-stats').textContent = `${novel.total_words || 0} 字 · 0/${data.outline.chapters?.length || 0} 章`;
      }
    } else alert('生成大纲失败: ' + data.error);
  } catch (e) { alert('生成大纲失败: ' + e.message); }
  btn.disabled = false;
  btn.innerHTML = origHTML;
}

async function nvGenerateChapter() {
  if (!nvCurrentId || nvStreaming) return;
  const novel = await nvFetch(nvCurrentId);
  if (!novel || !novel.outline) return alert('请先生成或导入大纲');

  nvStreaming = true;
  const btn = document.getElementById('nv-gen-btn');
  btn.disabled = true;
  btn.textContent = '生成中...';
  const content = document.getElementById('nv-content');
  content.textContent = '';
  content.contentEditable = 'false';

  const cursor = document.createElement('span');
  cursor.className = 'nv-streaming-cursor';
  content.appendChild(cursor);

  const token = getToken();
  const url = `/api/novel/${nvCurrentId}/generate-chapter-stream?chapter=${nvCurrentChapter}&token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);

  es.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'chunk') {
        cursor.before(document.createTextNode(msg.text));
        content.scrollTop = content.scrollHeight;
      } else if (msg.type === 'done') {
        es.close();
        cursor.remove();
        content.contentEditable = 'true';
        nvStreaming = false;
        btn.disabled = false;
        btn.textContent = '生成本章';
        nvUpdateWordCount();
        nvSelect(nvCurrentId);
      } else if (msg.type === 'error') {
        es.close();
        cursor.remove();
        content.contentEditable = 'true';
        nvStreaming = false;
        btn.disabled = false;
        btn.textContent = '生成本章';
        alert('生成失败: ' + msg.message);
      }
    } catch {}
  };
  es.onerror = () => {
    es.close();
    cursor.remove();
    content.contentEditable = 'true';
    nvStreaming = false;
    btn.disabled = false;
    btn.textContent = '生成本章';
  };
}

let _nvRefineText = '';

function nvSetStyle(btn, style) {
  document.querySelectorAll('.nv-style-tag').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  nvSaveField('style', style);
}

function nvExpandSelection() {
  // 扩写选中段落 — 复用 refine 逻辑但 prompt 不同
  const contentEl = document.getElementById('nv-content');
  const sel = window.getSelection();
  const text = sel?.toString()?.trim();
  if (!text || text.length < 10) return alert('请先在编辑器中选中要扩写的段落（至少10字）');
  nvRefine('expand');
}

function nvRefine(mode) {
  const sel = window.getSelection();
  _nvRefineText = sel ? sel.toString().trim() : '';
  if (!_nvRefineText) return alert('请先选中要优化的文本');
  if (!nvCurrentId) return;

  const text = _nvRefineText;
  const modal = document.createElement('div');
  modal.className = 'nv-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="nv-modal-box" style="width:420px">
      <h3>AI 文本优化</h3>
      <div style="font-size:12px;color:var(--text3);margin-bottom:8px">选中文本（${text.length}字）</div>
      <div style="font-size:12px;color:var(--text2);background:var(--bg3);padding:8px;border-radius:8px;max-height:100px;overflow-y:auto;margin-bottom:12px;line-height:1.5">${esc(text.slice(0, 200))}${text.length > 200 ? '...' : ''}</div>
      <textarea id="nv-refine-instruction" rows="3" placeholder="优化指令，如：让对话更自然、增加环境描写、加入心理活动..."></textarea>
      <div class="nv-modal-actions">
        <button class="nv-act-btn" onclick="this.closest('.nv-modal').remove()">取消</button>
        <button class="nv-gen-btn" onclick="nvDoRefine(this)">开始优化</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#nv-refine-instruction').focus();
}

async function nvDoRefine(btn) {
  const modal = btn.closest('.nv-modal');
  const instruction = modal.querySelector('#nv-refine-instruction').value.trim();
  if (!instruction) return alert('请输入优化指令');

  const text = _nvRefineText;
  if (!text) { modal.remove(); return; }

  btn.disabled = true;
  btn.textContent = '优化中...';

  const token = getToken();
  const url = `/api/novel/${nvCurrentId}/refine-stream?text=${encodeURIComponent(text)}&instruction=${encodeURIComponent(instruction)}&token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);
  let refined = '';

  es.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'chunk') {
        refined += msg.text;
      } else if (msg.type === 'done') {
        es.close();
        const content = document.getElementById('nv-content');
        const fullText = content.textContent;
        content.textContent = fullText.replace(text, refined);
        nvUpdateWordCount();
        nvAutoSaveContent();
        modal.remove();
      } else if (msg.type === 'error') {
        es.close();
        alert('优化失败: ' + msg.message);
        btn.disabled = false;
        btn.textContent = '开始优化';
      }
    } catch {}
  };
  es.onerror = () => {
    es.close();
    btn.disabled = false;
    btn.textContent = '开始优化';
  };
}

async function nvExport() {
  if (!nvCurrentId) return;
  window.open('/api/novel/' + nvCurrentId + '/export?token=' + encodeURIComponent(getToken()));
}

async function nvDelete() {
  if (!nvCurrentId) return;
  if (!confirm('确定删除这部小说？此操作不可撤销。')) return;
  try {
    await fetch('/api/novel/' + nvCurrentId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + getToken() }
    });
    nvCurrentId = null;
    document.getElementById('nv-editor-empty').style.display = '';
    document.getElementById('nv-editor-active').style.display = 'none';
    nvLoadPage();
  } catch {}
}

// ═══════════════════════════════════════════
// 社交媒体发布
// ═══════════════════════════════════════════
let pubProjectId = null;
let pubSelectedPlatform = null;
let pubAccounts = [];
let pubPlatforms = [];
let socialLoginPlatform = null;

const PLAT_ICONS = {
  xiaohongshu: '红'
};

async function openPublishModal(projectId) {
  pubProjectId = projectId;
  pubSelectedPlatform = null;
  document.getElementById('publish-modal').classList.add('open');
  document.getElementById('pub-account-section').style.display = 'none';
  document.getElementById('pub-copy-section').style.display = 'none';
  document.getElementById('pub-actions').style.display = 'none';
  document.getElementById('pub-status').style.display = 'none';

  // 并行加载平台列表和已绑定账号
  try {
    const [platRes, accRes] = await Promise.all([
      authFetch('/api/publish/platforms'),
      authFetch('/api/publish/accounts')
    ]);
    const platData = await platRes.json();
    const accData = await accRes.json();
    pubPlatforms = platData.success ? platData.data : [];
    pubAccounts = accData.success ? accData.data : [];
  } catch {
    pubPlatforms = [
      { id: 'weishi', name: '微视', color: '#FF4081' },
      { id: 'douyin', name: '抖音', color: '#FE2C55' },
      { id: 'xiaohongshu', name: '小红书', color: '#FE2C55' },
      { id: 'kuaishou', name: '快手', color: '#FF6600' }
    ];
    pubAccounts = [];
  }
  renderPubPlatforms();
}

function closePublishModal() {
  document.getElementById('publish-modal').classList.remove('open');
  pubProjectId = null;
  pubSelectedPlatform = null;
}

function renderPubPlatforms() {
  const container = document.getElementById('pub-platforms');
  container.innerHTML = pubPlatforms.map(p => {
    const connected = pubAccounts.some(a => a.platform === p.id);
    return `<div class="pub-plat-card ${pubSelectedPlatform === p.id ? 'active' : ''} ${connected ? 'connected' : ''}"
      onclick="selectPubPlatform('${p.id}')">
      <div class="pub-plat-icon ${p.id}">${PLAT_ICONS[p.id] || p.id[0].toUpperCase()}</div>
      <div class="pub-plat-name">${esc(p.name)}</div>
      <div class="pub-plat-status ${connected ? 'connected' : ''}">${connected ? '已绑定' : '未绑定'}</div>
    </div>`;
  }).join('');
}

function selectPubPlatform(platformId) {
  pubSelectedPlatform = platformId;
  renderPubPlatforms();

  const accountSection = document.getElementById('pub-account-section');
  const copySection = document.getElementById('pub-copy-section');
  const actionsSection = document.getElementById('pub-actions');
  accountSection.style.display = '';
  document.getElementById('pub-status').style.display = 'none';

  const connected = pubAccounts.find(a => a.platform === platformId);
  const platInfo = pubPlatforms.find(p => p.id === platformId);
  const infoEl = document.getElementById('pub-account-info');

  if (connected) {
    infoEl.innerHTML = `<div class="pub-account-row">
      <div class="pub-account-avatar">${PLAT_ICONS[platformId] || '?'}</div>
      <div class="pub-account-name">${esc(connected.nickname)}</div>
      <div class="pub-account-actions">
        <button class="pub-unlink-btn" onclick="pubUnlinkAccount('${platformId}')">解绑</button>
      </div>
    </div>`;
    copySection.style.display = '';
    actionsSection.style.display = '';
    // 清空文案
    document.getElementById('pub-title').value = '';
    document.getElementById('pub-desc').value = '';
    document.getElementById('pub-tags').value = '';
    document.getElementById('pub-title').maxLength = platInfo?.maxTitleLen || 55;
  } else {
    infoEl.innerHTML = `<div class="pub-account-row">
      <div class="pub-account-avatar" style="opacity:.4">${PLAT_ICONS[platformId] || '?'}</div>
      <div class="pub-account-name" style="color:var(--text3)">尚未绑定${platInfo?.name || ''}账号</div>
      <div class="pub-account-actions">
        <button class="pub-link-btn" onclick="openSocialLogin('${platformId}')">立即绑定</button>
      </div>
    </div>`;
    copySection.style.display = 'none';
    actionsSection.style.display = 'none';
  }
}

async function pubUnlinkAccount(platform) {
  if (!confirm('确定解绑该平台账号？')) return;
  try {
    await authFetch('/api/publish/accounts/' + platform, { method: 'DELETE' });
    pubAccounts = pubAccounts.filter(a => a.platform !== platform);
    renderPubPlatforms();
    selectPubPlatform(platform);
  } catch {}
}

function openSocialLogin(platform) {
  socialLoginPlatform = platform;
  const platInfo = pubPlatforms.find(p => p.id === platform);
  document.getElementById('social-login-title').textContent = '绑定' + (platInfo?.name || platform);
  document.getElementById('social-login-platform-name').textContent = platInfo?.name || platform;
  document.getElementById('social-nickname').value = '';
  document.getElementById('social-token').value = '';
  document.getElementById('social-openid').value = '';
  document.getElementById('social-login-modal').classList.add('open');
}

function closeSocialLogin() {
  document.getElementById('social-login-modal').classList.remove('open');
  socialLoginPlatform = null;
}

async function submitSocialLogin() {
  const platform = socialLoginPlatform;
  if (!platform) return;
  const nickname = document.getElementById('social-nickname').value.trim();
  const token = document.getElementById('social-token').value.trim();
  const openId = document.getElementById('social-openid').value.trim();

  if (!token) { alert('请输入 Access Token'); return; }

  try {
    const res = await authFetch('/api/publish/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform,
        nickname: nickname || platform + '用户',
        access_token: token,
        open_id: openId,
        expires_in: 7776000 // 90 days
      })
    });
    const data = await res.json();
    if (data.success) {
      pubAccounts = pubAccounts.filter(a => a.platform !== platform);
      pubAccounts.push(data.data);
      closeSocialLogin();
      renderPubPlatforms();
      selectPubPlatform(platform);
    } else {
      alert('绑定失败: ' + (data.error || '未知错误'));
    }
  } catch (err) {
    alert('绑定失败: ' + err.message);
  }
}

async function pubGenerateCopy() {
  if (!pubProjectId || !pubSelectedPlatform) return;
  const btn = document.getElementById('pub-gen-btn');
  btn.disabled = true;
  btn.textContent = '生成中...';
  setPubStatus('info', '正在用 AI 生成专属文案...');

  try {
    const res = await authFetch('/api/publish/copywriting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: pubProjectId, platform: pubSelectedPlatform })
    });
    const data = await res.json();
    if (data.success && data.data) {
      document.getElementById('pub-title').value = data.data.title || '';
      document.getElementById('pub-desc').value = data.data.description || '';
      document.getElementById('pub-tags').value = (data.data.tags || []).join(' ');
      setPubStatus('success', '文案已生成，可自行修改后发布');
    } else {
      setPubStatus('error', '生成失败: ' + (data.error || '请检查 AI 配置'));
    }
  } catch (err) {
    setPubStatus('error', '生成失败: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'AI 生成文案';
  }
}

async function pubSendVideo() {
  if (!pubProjectId || !pubSelectedPlatform) return;
  const title = document.getElementById('pub-title').value.trim();
  const desc = document.getElementById('pub-desc').value.trim();
  const tags = document.getElementById('pub-tags').value.trim().split(/\s+/).filter(Boolean);
  const btn = document.getElementById('pub-send-btn');

  if (!title && !desc) {
    setPubStatus('error', '请填写标题或描述');
    return;
  }

  btn.disabled = true;
  btn.textContent = '发布中...';
  setPubStatus('info', '正在上传视频到' + (pubPlatforms.find(p => p.id === pubSelectedPlatform)?.name || '') + '...');

  try {
    const res = await authFetch('/api/publish/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: pubProjectId,
        platform: pubSelectedPlatform,
        title, description: desc, tags
      })
    });
    const data = await res.json();
    if (data.success) {
      setPubStatus('success', '发布成功！' + (data.data.platform_url ? ' <a href="'+esc(data.data.platform_url)+'" target="_blank" style="color:var(--cyan)">查看</a>' : ''));
    } else {
      setPubStatus('error', '发布失败: ' + (data.error || '未知错误'));
    }
  } catch (err) {
    setPubStatus('error', '发布失败: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '发布视频';
  }
}

function setPubStatus(type, msg) {
  const el = document.getElementById('pub-status');
  el.style.display = '';
  el.innerHTML = `<div class="pub-status-msg ${type}">${msg}</div>`;
}

// ═══════════════════════════════════════════
// ═══ AI 形象 ═══
// ═══════════════════════════════════════════
let ptrPhotoFilename = null;
let ptrDim = '2d';

function loadPortraitPage() {
  loadPtrGallery();
}

// ── 照片上传 ──
function handlePtrDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('image/')) uploadPtrPhoto(file);
}

function handlePtrFileSelect(input) {
  const file = input.files?.[0];
  if (file) uploadPtrPhoto(file);
  input.value = '';
}

async function uploadPtrPhoto(file) {
  const formData = new FormData();
  formData.append('photo', file);
  try {
    const res = await authFetch('/api/portrait/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    setPtrPhoto(data.data.filename, data.data.image_url);
  } catch (e) {
    alert('上传失败: ' + e.message);
  }
}

function setPtrPhoto(filename, url) {
  ptrPhotoFilename = filename;
  document.getElementById('ptr-preview-sec').style.display = '';
  document.getElementById('ptr-photo-preview').innerHTML = `<img src="${url}" alt="照片预览" />`;
  document.getElementById('ptr-dropzone').style.display = 'none';
}

function clearPtrPhoto() {
  ptrPhotoFilename = null;
  document.getElementById('ptr-preview-sec').style.display = 'none';
  document.getElementById('ptr-dropzone').style.display = '';
}

function selectPtrDim(btn) {
  document.querySelectorAll('.ptr-dim-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  ptrDim = btn.dataset.dim;
}

// ── 生成形象 ──
async function startPortraitGeneration() {
  if (!ptrPhotoFilename) return alert('请先上传照片');
  const name = document.getElementById('ptr-name')?.value?.trim() || '';

  const btn = document.getElementById('ptr-gen-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="av-spinner av-spinner-sm" style="display:inline-block"></span> 生成中...'; }

  const canvas = document.getElementById('ptr-canvas');
  if (canvas) {
    canvas.innerHTML = `
      <div class="ptr-progress">
        <div class="ptr-progress-ring">
          <svg viewBox="0 0 100 100"><circle class="ring-bg" cx="50" cy="50" r="44" fill="none" stroke-width="4"/><circle class="ring-fill" id="ptr-ring-fill" cx="50" cy="50" r="44" fill="none" stroke-width="4" stroke-linecap="round" stroke-dasharray="276.5" stroke-dashoffset="276.5" style="stroke:var(--accent);transition:stroke-dashoffset .4s"/></svg>
          <div class="ptr-progress-pct" id="ptr-progress-pct">0%</div>
        </div>
        <div class="ptr-progress-text" id="ptr-progress-text">初始化...</div>
      </div>`;
  }

  try {
    const res = await authFetch('/api/portrait/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_filename: ptrPhotoFilename, dim: ptrDim, name })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    pollPtrProgress(data.data.id);
  } catch (err) {
    alert('生成失败: ' + err.message);
    resetPtrBtn();
  }
}

function resetPtrBtn() {
  const btn = document.getElementById('ptr-gen-btn');
  if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 2L9 9H2l5.5 4.2L5.3 20 12 15.8 18.7 20l-2.2-6.8L22 9h-7z" fill="currentColor"/></svg> 生成卡通形象'; }
}

function pollPtrProgress(taskId) {
  const check = async () => {
    try {
      const res = await authFetch(`/api/portrait/${taskId}`);
      const data = await res.json();
      if (!data.success) return;
      const task = data.data;

      // 更新进度
      const ring = document.getElementById('ptr-ring-fill');
      const pctEl = document.getElementById('ptr-progress-pct');
      const textEl = document.getElementById('ptr-progress-text');
      if (ring) ring.style.strokeDashoffset = 276.5 * (1 - (task.progress || 0) / 100);
      if (pctEl) pctEl.textContent = (task.progress || 0) + '%';
      if (textEl) textEl.textContent = task.message || '处理中...';

      if (task.status === 'done') {
        renderPtrResult(task);
        resetPtrBtn();
        loadPtrGallery();
      } else if (task.status === 'error') {
        const canvas = document.getElementById('ptr-canvas');
        if (canvas) canvas.innerHTML = `<div class="ptr-empty-state"><div class="ptr-empty-title" style="color:var(--error)">生成失败</div><div class="ptr-empty-sub">${esc(task.error_message || '未知错误')}</div></div>`;
        resetPtrBtn();
      } else {
        setTimeout(check, 2500);
      }
    } catch { setTimeout(check, 4000); }
  };
  setTimeout(check, 2000);
}

function renderPtrResult(task) {
  const canvas = document.getElementById('ptr-canvas');
  if (!canvas) return;

  const photoUrl = task.photo_url || `/api/portrait/image/${task.photo_filename}`;
  const cards = [];

  // 原始照片
  cards.push(`
    <div class="ptr-result-card ptr-card-photo">
      <div class="ptr-card-tag">原始照片</div>
      <img src="${photoUrl}" alt="原始照片" />
    </div>`);

  // 2D 结果
  if (task.result_2d) {
    cards.push(`
      <div class="ptr-result-card ptr-card-2d">
        <div class="ptr-card-tag ptr-tag-2d">2D 动漫</div>
        <img src="${task.result_2d.url}" alt="2D 形象" />
      </div>`);
  }

  // 3D 结果
  if (task.result_3d) {
    cards.push(`
      <div class="ptr-result-card ptr-card-3d">
        <div class="ptr-card-tag ptr-tag-3d">3D CG</div>
        <img src="${task.result_3d.url}" alt="3D 形象" />
      </div>`);
  }

  // 分析摘要
  const analysis = task.analysis || {};
  const infoHtml = analysis.description_cn
    ? `<div class="ptr-analysis"><div class="ptr-analysis-title">AI 特征分析</div><div class="ptr-analysis-text">${esc(analysis.description_cn)}</div></div>`
    : '';

  canvas.innerHTML = `
    <div class="ptr-result">
      <div class="ptr-result-name">${esc(task.name || '未命名形象')}</div>
      <div class="ptr-result-grid">${cards.join('')}</div>
      ${infoHtml}
      <div class="ptr-result-actions">
        <div class="ptr-use-hint">此形象可用于：</div>
        <span class="ptr-use-tag">漫画角色</span>
        <span class="ptr-use-tag">视频角色</span>
        <span class="ptr-use-tag">数字人形象</span>
        <button class="ptr-use-as-avatar" onclick="usePortraitAsAvatar('${esc(task.photo_url || '')}','${esc(task.name || '形象')}')">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="4" r="2.5" stroke="currentColor" stroke-width="1.1"/><path d="M1.5 11c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><path d="M8.5 1.5l2 2-2 2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>
          用作数字人形象
        </button>
      </div>
    </div>`;
}

// ── 形象库 ──
function togglePtrGallery() {
  const gallery = document.getElementById('ptr-gallery');
  if (!gallery) return;
  const show = gallery.style.display === 'none';
  gallery.style.display = show ? '' : 'none';
  if (show) loadPtrGallery();
}

async function loadPtrGallery() {
  const container = document.getElementById('ptr-gallery');
  if (!container) return;
  try {
    const res = await authFetch('/api/portrait/list');
    const data = await res.json();
    if (!data.success || !data.data?.length) {
      container.innerHTML = '<div class="ptr-gallery-empty">暂无形象</div>';
      return;
    }
    container.innerHTML = data.data.map(p => {
      const thumbUrl = p.result_2d?.url || p.result_3d?.url || p.photo_url || '';
      const statusCls = p.status === 'done' ? 'done' : p.status === 'error' ? 'error' : 'processing';
      const dimLabel = p.result_2d && p.result_3d ? '2D+3D' : p.result_3d ? '3D' : '2D';
      return `
        <div class="ptr-gallery-card" onclick="viewPortrait('${p.id}')">
          ${thumbUrl ? `<img class="ptr-gallery-thumb" src="${thumbUrl}" alt="" />` : '<div class="ptr-gallery-thumb" style="background:var(--bg3)"></div>'}
          <div class="ptr-gallery-info">
            <div class="ptr-gallery-name">${esc(p.name || '未命名')}</div>
            <div class="ptr-gallery-meta">
              <span class="ptr-gallery-dim">${dimLabel}</span>
              <span class="ptr-gallery-status ${statusCls}">${p.status === 'done' ? '完成' : p.status === 'error' ? '失败' : '生成中'}</span>
            </div>
          </div>
          <button class="ptr-gallery-del" onclick="event.stopPropagation();deletePortrait('${p.id}')" title="删除">&times;</button>
        </div>`;
    }).join('');
  } catch {}
}

async function viewPortrait(id) {
  try {
    const res = await authFetch(`/api/portrait/${id}`);
    const data = await res.json();
    if (data.success && data.data.status === 'done') renderPtrResult(data.data);
  } catch {}
}

async function deletePortrait(id) {
  if (!confirm('确定删除此形象？')) return;
  try {
    await authFetch(`/api/portrait/${id}`, { method: 'DELETE' });
    loadPtrGallery();
  } catch {}
}

// ── 跳转到数字人页面并设置形象 ──
function usePortraitAsAvatar(imgUrl, name) {
  switchPage('avatar');
  setTimeout(() => selectPortraitAsAvatar(imgUrl, name), 100);
}

// ═══════════════════════════════════════════
// ═══ 声音克隆 ═══
// ═══════════════════════════════════════════

let vcRecording = false;
let vcMediaRecorder = null;
let vcRecordChunks = [];
let vcRecordTimer = null;
let vcRecordSeconds = 0;
let vcUploadedFile = null;

async function loadVoiceClonePage() {
  try {
    const resp = await authFetch('/api/workbench/voices');
    const data = await resp.json();
    const el = document.getElementById('vc-voice-list');
    if (!el) return;
    const voices = data.voices || [];
    if (!voices.length) {
      el.innerHTML = '<div style="color:var(--text3);font-size:12px;text-align:center;padding:60px 0;">暂无克隆声音，上传音频开始克隆</div>';
      return;
    }
    el.innerHTML = voices.map(v => {
      const statusTag = v.cloned
        ? '<span class="tag tag-green">语音包就绪</span>'
        : '<span class="tag tag-yellow">仅本地</span>';
      const statusHint = v.cloned
        ? `<div style="font-size:10px;color:#22c55e;margin-top:2px;">Fish Audio ID: ${esc((v.fish_ref_id||'').substring(0,20))}...</div>`
        : `<div style="font-size:10px;color:#8b8fa3;margin-top:2px;">可用于 TTS（配置 Fish Audio 效果更佳）</div>`;
      return `<div class="card" style="padding:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div>
            <div style="font-size:14px;font-weight:600;color:var(--text);">🎙 ${esc(v.name || '未命名声音')}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:2px;">创建于 ${v.created_at ? new Date(v.created_at).toLocaleDateString('zh-CN') : '未知'}</div>
            ${statusHint}
          </div>
          ${statusTag}
        </div>
        <div style="height:32px;background:rgba(var(--accent-rgb),.08);border-radius:6px;display:flex;align-items:center;justify-content:center;margin-bottom:12px;">
          <div style="display:flex;gap:2px;align-items:end;height:20px;">
            ${Array.from({length:20}, (_, i) => `<div style="width:3px;height:${4+Math.random()*16}px;background:var(--accent);border-radius:1px;opacity:${0.4+Math.random()*0.6}"></div>`).join('')}
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button onclick="vcPlayVoice('${v.id}')" style="padding:6px 16px;background:var(--accent);color:#000;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">▶ 试听</button>
          <button onclick="vcUseVoice('${v.id}','${esc(v.name)}')" style="padding:6px 16px;background:none;color:var(--text2);border:1px solid var(--border);border-radius:6px;font-size:12px;cursor:pointer;">使用此声音</button>
          <button onclick="vcDeleteVoice('${v.id}')" style="padding:6px 16px;background:rgba(239,68,68,.1);color:#ef4444;border:none;border-radius:6px;font-size:12px;cursor:pointer;margin-left:auto;">🗑 删除</button>
        </div>
      </div>`;
    }).join('');
  } catch (err) { console.error('loadVoiceClonePage error', err); }
}

async function vcToggleRecord() {
  if (vcRecording) {
    // 停止录音
    if (vcMediaRecorder) vcMediaRecorder.stop();
    vcRecording = false;
    clearInterval(vcRecordTimer);
    document.getElementById('vc-record-btn').style.background = 'linear-gradient(135deg,#ef4444,#dc2626)';
    document.getElementById('vc-record-btn').textContent = '🎙';
    document.getElementById('vc-record-status').textContent = '录音完成';
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    vcRecordChunks = [];
    vcMediaRecorder = new MediaRecorder(stream);
    vcMediaRecorder.ondataavailable = e => { if (e.data.size > 0) vcRecordChunks.push(e.data); };
    vcMediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(vcRecordChunks, { type: 'audio/wav' });
      vcUploadedFile = new File([blob], 'recording.wav', { type: 'audio/wav' });
      document.getElementById('vc-name-area').style.display = '';
      document.getElementById('vc-clone-btn').style.display = '';
      document.getElementById('vc-record-status').textContent = `录音完成 (${vcRecordSeconds}秒)`;
    };
    vcMediaRecorder.start();
    vcRecording = true;
    vcRecordSeconds = 0;
    document.getElementById('vc-record-btn').style.background = 'linear-gradient(135deg,#22c55e,#16a34a)';
    document.getElementById('vc-record-btn').textContent = '⏹';
    document.getElementById('vc-record-status').textContent = '正在录音...';
    document.getElementById('vc-record-timer').style.display = '';
    vcRecordTimer = setInterval(() => {
      vcRecordSeconds++;
      const m = String(Math.floor(vcRecordSeconds / 60)).padStart(2, '0');
      const s = String(vcRecordSeconds % 60).padStart(2, '0');
      document.getElementById('vc-record-timer').textContent = `${m}:${s}`;
    }, 1000);
  } catch (err) {
    document.getElementById('vc-record-status').textContent = '无法访问麦克风: ' + err.message;
  }
}

function vcHandleUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  vcUploadedFile = file;
  document.getElementById('vc-name-area').style.display = '';
  document.getElementById('vc-clone-btn').style.display = '';
  document.getElementById('vc-record-status').textContent = `已选择: ${file.name} (${(file.size/1024/1024).toFixed(1)}MB)`;
}

async function vcStartClone() {
  if (!vcUploadedFile) return alert('请先录音或上传音频');
  const name = document.getElementById('vc-voice-name')?.value?.trim() || '我的声音';
  const btn = document.getElementById('vc-clone-btn');
  const prog = document.getElementById('vc-progress-area');
  btn.disabled = true;
  btn.textContent = '⏳ 正在克隆...';
  prog.style.display = '';

  // 模拟训练进度
  const s1 = document.getElementById('vc-step1');
  const s2 = document.getElementById('vc-step2');
  const s3 = document.getElementById('vc-step3');
  s1.textContent = '处理中...'; s1.style.color = 'var(--accent)';

  const fd = new FormData();
  fd.append('audio', vcUploadedFile);
  fd.append('name', name);
  try {
    s1.textContent = '已完成'; s1.style.color = '#22c55e';
    s2.textContent = '处理中...'; s2.style.color = 'var(--accent)';
    const resp = await authFetch('/api/workbench/upload-voice', { method: 'POST', body: fd });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);
    s2.textContent = '已完成'; s2.style.color = '#22c55e';
    s3.textContent = data.cloned ? '已完成' : '跳过（未配置 Fish Audio）';
    s3.style.color = data.cloned ? '#22c55e' : '#f59e0b';
    btn.textContent = data.cloned ? '✅ 克隆完成！' : '✅ 已保存（需配置 Fish Audio 才能克隆）';
    // 刷新声音列表
    loadVoiceClonePage();
    // 重置表单
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = '🎙 开始克隆声音';
      btn.style.display = 'none';
      prog.style.display = 'none';
      document.getElementById('vc-name-area').style.display = 'none';
      s1.textContent = '等待中'; s1.style.color = 'var(--text3)';
      s2.textContent = '等待中'; s2.style.color = 'var(--text3)';
      s3.textContent = '等待中'; s3.style.color = 'var(--text3)';
      vcUploadedFile = null;
    }, 2000);
  } catch (err) {
    s3.textContent = '失败'; s3.style.color = '#ef4444';
    btn.textContent = '🎙 开始克隆声音';
    btn.disabled = false;
    alert('克隆失败: ' + err.message);
  }
}

async function vcPlayVoice(id) {
  // 先停止之前的
  if (_globalAudio) { _globalAudio.pause(); _globalAudio.src = ''; _globalAudio = null; }
  try {
    const resp = await authFetch(`/api/workbench/voices/${id}/play`);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    _globalAudio = new Audio(url);
    _globalAudio.onended = () => { URL.revokeObjectURL(url); _globalAudio = null; };
    _globalAudio.play();
  } catch (err) { alert('试听失败: ' + err.message); }
}

function vcUseVoice(id, name) {
  // 保存到 localStorage，数字人页面可以使用
  let voices = JSON.parse(localStorage.getItem('vido_custom_voices') || '[]');
  if (!voices.find(v => v.id === id)) {
    voices.push({ id, name, voiceId: id });
    localStorage.setItem('vido_custom_voices', JSON.stringify(voices));
  }
  alert('声音已添加到自定义声音列表，可在数字人和一键复刻中使用');
}

async function vcDeleteVoice(id) {
  if (!confirm('确定删除此声音？')) return;
  try {
    await authFetch('/api/workbench/voices/' + id, { method: 'DELETE' });
    loadVoiceClonePage();
  } catch {}
}

// ═══════════════════════════════════════════
// ═══ 创作工作台（一键复刻） ═══
// ═══════════════════════════════════════════

function wbSelectVoice(el) {
  document.querySelectorAll('.wb-voice-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

async function wbParseInput() {
  const rawInput = document.getElementById('wb-url-input')?.value?.trim();
  if (!rawInput) return alert('请输入内容');
  const btn = document.getElementById('wb-parse-btn');
  const sourceInfo = document.getElementById('wb-source-info');
  const sourceName = document.getElementById('wb-source-name');
  const sourceBadge = document.getElementById('wb-source-badge');
  btn.disabled = true;
  btn.innerHTML = '<span class="av-spinner av-spinner-sm" style="display:inline-block"></span>';

  // 判断是否包含 URL
  const extractedUrl = extractUrlFromText(rawInput);
  const isUrl = /^https?:\/\//i.test(extractedUrl);

  if (isUrl) {
    try {
      const resp = await authFetch('/api/radar/extract', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ url: extractedUrl })
      });
      if (!resp.ok) throw new Error(`服务器错误 (${resp.status})`);
      const respText = await resp.text();
      let data;
      try { data = JSON.parse(respText); } catch { throw new Error('服务器返回了无效数据，请检查链接格式'); }
      if (!data.success) throw new Error(data.error);
      const c = data.content;
      document.getElementById('wb-original-text').value = c.transcript || c.title || '';
      sourceInfo.style.display = 'flex';
      sourceBadge.textContent = '已解析';
      sourceBadge.style.background = 'rgba(34,197,94,.15)';
      sourceBadge.style.color = '#22c55e';
      sourceName.textContent = (c.platformName ? `[${c.platformName}] ` : '') + (c.title || extractedUrl).substring(0, 60);
    } catch (err) {
      sourceInfo.style.display = 'flex';
      sourceBadge.textContent = '解析失败';
      sourceBadge.style.background = 'rgba(239,68,68,.15)';
      sourceBadge.style.color = '#ef4444';
      sourceName.textContent = err.message;
    }
  } else {
    // 纯文本直接放入原始文案
    document.getElementById('wb-original-text').value = rawInput;
    sourceInfo.style.display = 'flex';
    sourceBadge.textContent = '已加载';
    sourceBadge.style.background = '';
    sourceBadge.style.color = '';
    sourceName.textContent = '手动输入文本 (' + rawInput.length + '字)';
  }
  btn.disabled = false;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M6 1a5 5 0 104 8.9l3.1 3.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg> 解析';
}

function wbClearSource() {
  document.getElementById('wb-source-info').style.display = 'none';
  document.getElementById('wb-url-input').value = '';
  document.getElementById('wb-original-text').value = '';
}

function wbHandleUpload(input) {
  if (!input.files?.[0]) return;
  const file = input.files[0];
  document.getElementById('wb-source-info').style.display = 'flex';
  document.getElementById('wb-source-name').textContent = file.name + ' (' + (file.size / 1024 / 1024).toFixed(1) + 'MB)';
  document.getElementById('wb-original-text').value = '（音视频文案提取功能开发中，请手动输入文案）';
  input.value = '';
}

function wbCopyText(id) {
  const el = document.getElementById(id);
  if (!el?.value) return;
  navigator.clipboard.writeText(el.value).then(() => {
    // 临时提示
    const btn = el.closest('.wb-pane')?.querySelector('.wb-copy-btn');
    if (btn) { const orig = btn.textContent; btn.textContent = '已复制'; setTimeout(() => btn.textContent = orig, 1500); }
  }).catch(() => { el.select(); document.execCommand('copy'); });
}

async function wbRewrite() {
  const original = document.getElementById('wb-original-text')?.value?.trim();
  if (!original) return alert('请先输入或粘贴原始文案');
  const style = document.getElementById('wb-style-select')?.value || '';
  const custom = document.getElementById('wb-custom-prompt')?.value?.trim() || '';
  const btn = document.getElementById('wb-rewrite-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="av-spinner av-spinner-sm" style="display:inline-block"></span> 仿写中';

  try {
    const res = await authFetch('/api/avatar/generate-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        avatar_name: '创作者',
        bg_name: style || '通用',
        draft: (style ? `【风格：${style}】` : '') + (custom ? `【要求：${custom}】` : '') + `\n请基于以下原始文案进行仿写改编，保留核心信息但改变表达方式：\n\n${original}`
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    document.getElementById('wb-rewritten-text').value = data.text || '';
    // 自动同步到配音文本
    document.getElementById('wb-tts-text').value = data.text || '';
  } catch (err) {
    alert('AI 仿写失败: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1l1.2 3.2H10L7.6 6l.9 3L6 7.4 3.5 9l.9-3L2 4.2h2.8z" stroke="currentColor" stroke-width=".9" stroke-linejoin="round"/></svg> AI 仿写';
  }
}

async function wbPickFromContentLib() {
  try {
    const resp = await authFetch('/api/radar/contents');
    const data = await resp.json();
    if (!data.success || !data.contents?.length) return alert('内容库暂无内容，请先在素材获取中抓取');
    const items = data.contents.slice(0, 20);
    const pick = await new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
      const box = document.createElement('div');
      box.style.cssText = 'background:var(--bg2);border-radius:12px;padding:20px;max-width:600px;width:90%;max-height:70vh;overflow-y:auto;';
      box.innerHTML = `<div style="font-size:16px;font-weight:700;margin-bottom:12px;color:var(--text);">选择内容</div>` +
        items.map(c => `<div onclick="this.parentElement._pick('${c.id}')" style="padding:10px;margin-bottom:6px;background:var(--bg3);border-radius:8px;cursor:pointer;"><div style="font-size:13px;font-weight:500;color:var(--text);">${esc(c.title||'未命名')}</div><div style="font-size:11px;color:var(--text3);margin-top:4px;max-height:40px;overflow:hidden;">${esc((c.transcript||'').substring(0,120))}</div></div>`).join('') +
        `<button onclick="this.parentElement._pick(null)" style="width:100%;padding:8px;margin-top:8px;background:var(--bg3);border:none;border-radius:8px;color:var(--text3);cursor:pointer;">取消</button>`;
      box._pick = (id) => { document.body.removeChild(overlay); resolve(id); };
      overlay.appendChild(box);
      overlay.onclick = (e) => { if (e.target === overlay) { document.body.removeChild(overlay); resolve(null); } };
      document.body.appendChild(overlay);
    });
    if (!pick) return;
    const detail = await authFetch('/api/radar/contents/' + pick);
    const cd = await detail.json();
    if (cd.success && cd.content?.transcript) {
      document.getElementById('wb-tts-text').value = cd.content.transcript;
      document.getElementById('wb-url-input').value = cd.content.transcript;
      const si = document.getElementById('wb-source-info');
      si.style.display = '';
      document.getElementById('wb-source-name').textContent = cd.content.title || '内容库文案';
      document.getElementById('wb-source-badge').textContent = '内容库';
    }
  } catch (err) { alert('加载失败: ' + err.message); }
}

async function wbSynthesize() {
  const text = document.getElementById('wb-tts-text')?.value?.trim();
  if (!text) return alert('请输入配音文本');
  const voiceId = document.querySelector('.wb-voice-chip.active')?.dataset?.voice || 'female-sweet';
  const speed = parseFloat(document.getElementById('wb-speed-range')?.value) || 1.0;
  const btn = document.getElementById('wb-synth-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="av-spinner av-spinner-sm" style="display:inline-block"></span> 合成中...';

  try {
    const res = await authFetch('/api/workbench/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId, speed })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    // 显示结果（需要带 token 获取音频，<audio> 无法自动带 header）
    const resultEl = document.getElementById('wb-audio-result');
    resultEl.style.display = '';
    const player = document.getElementById('wb-audio-player');
    const audioResp = await authFetch(data.audioUrl);
    const audioBlob = await audioResp.blob();
    const audioBlobUrl = URL.createObjectURL(audioBlob);
    player.src = audioBlobUrl;
    player.load();
    document.getElementById('wb-audio-download').href = audioBlobUrl;
    document.getElementById('wb-audio-download').download = 'tts_audio' + (data.audioUrl.match(/\.\w+$/)?.[0] || '.mp3');
  } catch (err) {
    alert('合成失败: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="4" y="1" width="6" height="8" rx="3" stroke="currentColor" stroke-width="1.2"/><path d="M2 7a5 5 0 0010 0M7 11v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg> 一键合成配音';
  }
}

function wbClearAudio() {
  document.getElementById('wb-audio-result').style.display = 'none';
  document.getElementById('wb-audio-player').src = '';
}

// ═══════════════════════════════════════════
// ═══ AI 漫画 ═══
// ═══════════════════════════════════════════
let comicStyle = '日系动漫';
let comicPages = 4;
let comicPanelsPerPage = 4;
let comicCharacters = [];
let comicCurrentTaskId = null;
let comicImageModels = [];
let comicSelectedModel = null; // null = auto

function loadComicPage() {
  loadComicImageModels();
  loadComicHistory();
}

function selectComicStyle(btn) {
  document.querySelectorAll('.comic-style-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  comicStyle = btn.dataset.style;
}

function setComicPages(n, btn) {
  comicPages = n;
  btn.parentElement.querySelectorAll('.comic-opt-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function setComicPanels(n, btn) {
  comicPanelsPerPage = n;
  btn.parentElement.querySelectorAll('.comic-opt-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

// ── 图片模型选择器 ──
async function loadComicImageModels() {
  try {
    const res = await authFetch('/api/settings');
    const data = await res.json();
    if (!data.success) return;
    comicImageModels = [];
    for (const p of (data.data.providers || [])) {
      if (!p.enabled || !(p.api_key || p.api_key_masked)) continue;
      for (const m of (p.models || [])) {
        if (m.use !== 'image' || m.enabled === false) continue;
        comicImageModels.push({ providerId: p.id, providerName: p.name, modelId: m.id, modelName: m.name });
      }
    }
    renderComicModelPicker();
  } catch {}
}

function renderComicModelPicker() {
  const picker = document.getElementById('comic-model-picker');
  if (!picker) return;
  const groups = {};
  for (const m of comicImageModels) {
    if (!groups[m.providerId]) groups[m.providerId] = { name: m.providerName, models: [] };
    groups[m.providerId].models.push(m);
  }
  let html = `<div class="comic-model-opt ${!comicSelectedModel ? 'active' : ''}" onclick="selectComicModel(null)">
    <span class="comic-model-opt-dot"></span> 自动选择（推荐）
  </div>`;
  for (const [gid, g] of Object.entries(groups)) {
    html += `<div class="comic-model-group-label">${esc(g.name)}</div>`;
    for (const m of g.models) {
      const isActive = comicSelectedModel?.modelId === m.modelId && comicSelectedModel?.providerId === m.providerId;
      html += `<div class="comic-model-opt ${isActive ? 'active' : ''}" onclick="selectComicModel({providerId:'${m.providerId}',modelId:'${m.modelId}',modelName:'${esc(m.modelName)}'})">
        <span class="comic-model-opt-dot"></span> ${esc(m.modelName)}
      </div>`;
    }
  }
  picker.innerHTML = html;
}

function toggleComicModelPicker() {
  const picker = document.getElementById('comic-model-picker');
  if (picker) picker.style.display = picker.style.display === 'none' ? '' : 'none';
}

function selectComicModel(model) {
  comicSelectedModel = model;
  const label = document.getElementById('comic-model-label');
  if (label) {
    label.textContent = model ? model.modelName : '自动选择（推荐）';
    label.classList.toggle('selected', !!model);
  }
  const picker = document.getElementById('comic-model-picker');
  if (picker) picker.style.display = 'none';
  renderComicModelPicker();
}

// ── 角色管理 ──
function addComicCharacter() {
  const id = Date.now();
  comicCharacters.push({ id, name: '', description: '' });
  renderComicCharacters();
}

function removeComicCharacter(id) {
  comicCharacters = comicCharacters.filter(c => c.id !== id);
  renderComicCharacters();
}

function renderComicCharacters() {
  const container = document.getElementById('comic-characters');
  if (!container) return;
  container.innerHTML = comicCharacters.map(c => `
    <div class="comic-char-item" data-id="${c.id}">
      <input class="comic-char-input" placeholder="角色名" value="${esc(c.name)}" onchange="updateComicChar(${c.id},'name',this.value)" />
      <input class="comic-char-input" placeholder="外貌描述（发型、服装、特征...）" value="${esc(c.description)}" onchange="updateComicChar(${c.id},'description',this.value)" />
      <button class="comic-char-del" onclick="removeComicCharacter(${c.id})">&times;</button>
    </div>
  `).join('');
}

function updateComicChar(id, field, value) {
  const char = comicCharacters.find(c => c.id === id);
  if (char) char[field] = value;
}

// ── 历史面板折叠 ──
function toggleComicHistory() {
  const hist = document.getElementById('comic-history');
  const toggle = document.getElementById('comic-hist-toggle');
  if (!hist) return;
  const show = hist.style.display === 'none';
  hist.style.display = show ? '' : 'none';
  toggle?.classList.toggle('open', show);
  if (show) loadComicHistory();
}

// ── AI 生成故事内容 ──
async function aiGenerateComicStory() {
  const title = document.getElementById('comic-title')?.value?.trim();
  if (!title) return alert('请先输入漫画标题');

  const btn = document.getElementById('comic-ai-story-btn');
  if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }

  try {
    const res = await authFetch('/api/comic/ai-story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, style: comicStyle })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const storyEl = document.getElementById('comic-story');
    if (storyEl && data.data.content) {
      storyEl.value = data.data.content;
      storyEl.style.height = 'auto';
      storyEl.style.height = storyEl.scrollHeight + 'px';
    }
  } catch (err) {
    alert('AI 生成失败: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1l2 4.5H15l-3.8 3 1.3 4.5L8 10l-4.5 3 1.3-4.5L1 5.5h5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg> AI 生成';
    }
  }
}

// ── 生成漫画 ──
async function startComicGeneration() {
  const title = document.getElementById('comic-title')?.value?.trim();
  const story = document.getElementById('comic-story')?.value?.trim();
  if (!title) return alert('请输入漫画标题');
  const theme = story ? `${title}：${story}` : title;

  const btn = document.getElementById('comic-gen-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="comic-gen-spinner"></span> 创作中...'; }

  // 显示圆形进度
  const area = document.getElementById('comic-canvas-area');
  if (area) {
    area.innerHTML = `
      <div class="comic-progress" id="comic-preview-box">
        <div class="comic-progress-ring">
          <svg viewBox="0 0 100 100"><circle class="ring-bg" cx="50" cy="50" r="44"/><circle class="ring-fill" id="comic-ring-fill" cx="50" cy="50" r="44" stroke-dasharray="276.5" stroke-dashoffset="276.5"/></svg>
          <div class="comic-progress-pct" id="comic-progress-pct">0%</div>
        </div>
        <div class="comic-progress-text" id="comic-progress-text">初始化...</div>
      </div>`;
  }

  try {
    const chars = comicCharacters.filter(c => c.name.trim());
    const res = await authFetch('/api/comic/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme,
        style: comicStyle,
        pages: comicPages,
        panels_per_page: comicPanelsPerPage,
        characters: chars
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    comicCurrentTaskId = data.data.id;
    pollComicProgress(comicCurrentTaskId);
  } catch (err) {
    alert('生成失败: ' + err.message);
    resetComicBtn();
  }
}

function resetComicBtn() {
  const btn = document.getElementById('comic-gen-btn');
  if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 2L9 9H2l5.5 4.2L5.3 20 12 15.8 18.7 20l-2.2-6.8L22 9h-7z" fill="currentColor"/></svg> 开始创作'; }
}

function updateComicProgress(pct, text) {
  const ring = document.getElementById('comic-ring-fill');
  const pctEl = document.getElementById('comic-progress-pct');
  const textEl = document.getElementById('comic-progress-text');
  if (ring) {
    const offset = 276.5 * (1 - pct / 100);
    ring.style.strokeDashoffset = offset;
  }
  if (pctEl) pctEl.textContent = Math.round(pct) + '%';
  if (textEl) textEl.textContent = text || '';
}

function pollComicProgress(taskId) {
  const check = async () => {
    try {
      const res = await authFetch(`/api/comic/tasks/${taskId}`);
      const data = await res.json();
      if (!data.success) return;
      const task = data.data;
      updateComicProgress(task.progress || 0, task.message || '处理中...');

      if (task.status === 'done') {
        renderComicResult(task);
        resetComicBtn();
        loadComicHistory();
      } else if (task.status === 'error') {
        const area = document.getElementById('comic-canvas-area');
        if (area) area.innerHTML = `<div class="comic-empty-state" id="comic-preview-box"><div class="comic-empty-title" style="color:var(--error)">生成失败</div><div class="comic-empty-sub">${esc(task.error_message || '未知错误')}</div></div>`;
        resetComicBtn();
      } else {
        setTimeout(check, 3000);
      }
    } catch { setTimeout(check, 5000); }
  };
  setTimeout(check, 2000);
}

function renderComicResult(task) {
  const area = document.getElementById('comic-canvas-area');
  if (!area || !task.result) return;
  const result = task.result;

  const pagesHtml = (result.pages || []).map(page => {
    const panelsHtml = (page.panels || []).map(panel => {
      const panelImgUrl = `/api/comic/image/${task.id}/${panel.image}`;
      const dialogueHtml = panel.dialogue ? `<div class="comic-bubble comic-bubble-${panel.dialogue_position || 'bottom'}">${esc(panel.dialogue)}</div>` : '';
      const narratorHtml = panel.narrator ? `<div class="comic-narrator">${esc(panel.narrator)}</div>` : '';
      const sfxHtml = panel.sfx ? `<div class="comic-sfx">${esc(panel.sfx)}</div>` : '';
      return `<div class="comic-panel-cell">
        <img src="${panelImgUrl}" alt="${esc(panel.description || '')}" loading="lazy" />
        ${dialogueHtml}${narratorHtml}${sfxHtml}
      </div>`;
    }).join('');

    return `
      <div class="comic-page-result">
        <div class="comic-page-header">
          <div class="comic-page-num">${page.page_number}</div>
          <div class="comic-page-label">第 ${page.page_number} 页</div>
        </div>
        <div class="comic-panels-grid">${panelsHtml}</div>
      </div>`;
  }).join('');

  area.innerHTML = `
    <div class="comic-result" id="comic-preview-box">
      <div class="comic-result-header">
        <div>
          <div class="comic-result-title">${esc(result.title || '未命名漫画')}</div>
          <div class="comic-result-synopsis">${esc(result.synopsis || '')}</div>
          <div class="comic-result-meta">
            <span class="comic-result-tag">${esc(result.style || comicStyle)}</span>
            <span class="comic-result-tag">${result.total_panels || 0} 格</span>
            <span class="comic-result-tag">${result.pages?.length || 0} 页</span>
          </div>
        </div>
      </div>
      <div class="comic-pages-container">${pagesHtml}</div>
    </div>`;
}

async function loadComicHistory() {
  const container = document.getElementById('comic-history');
  if (!container) return;
  try {
    const res = await authFetch('/api/comic/tasks');
    const data = await res.json();
    if (!data.success || !data.data?.length) {
      container.innerHTML = '<div class="comic-history-empty">暂无记录</div>';
      return;
    }
    container.innerHTML = data.data.map(task => {
      const title = task.result?.title || task.theme?.substring(0, 20) || '未命名';
      const statusMap = { processing: '创作中', done: '完成', error: '失败' };
      const statusCls = task.status === 'done' ? 'done' : task.status === 'error' ? 'error' : 'processing';
      const thumbUrl = task.status === 'done' && task.result?.pages?.[0]
        ? `/api/comic/image/${task.id}/page_1.png` : '';
      return `
        <div class="comic-hist-card" onclick="viewComicTask('${task.id}')">
          ${thumbUrl ? `<img class="comic-hist-card-thumb" src="${thumbUrl}" alt="" />` : '<div class="comic-hist-card-thumb" style="background:var(--bg3)"></div>'}
          <div class="comic-hist-card-body">
            <div class="comic-hist-card-title">${esc(title)}</div>
            <div class="comic-hist-card-meta">
              <span class="comic-hist-card-status ${statusCls}">${statusMap[task.status] || task.status}</span>
              <button class="comic-hist-card-del" onclick="event.stopPropagation();deleteComicTask('${task.id}')" title="删除">&times;</button>
            </div>
          </div>
        </div>`;
    }).join('');
  } catch {}
}

async function viewComicTask(taskId) {
  try {
    const res = await authFetch(`/api/comic/tasks/${taskId}`);
    const data = await res.json();
    if (!data.success) return;
    if (data.data.status === 'done') {
      renderComicResult(data.data);
    } else if (data.data.status === 'processing') {
      comicCurrentTaskId = taskId;
      const area = document.getElementById('comic-canvas-area');
      if (area) {
        area.innerHTML = `
          <div class="comic-progress" id="comic-preview-box">
            <div class="comic-progress-ring">
              <svg viewBox="0 0 100 100"><circle class="ring-bg" cx="50" cy="50" r="44"/><circle class="ring-fill" id="comic-ring-fill" cx="50" cy="50" r="44" stroke-dasharray="276.5" stroke-dashoffset="${276.5 * (1 - (data.data.progress||0)/100)}"/></svg>
              <div class="comic-progress-pct" id="comic-progress-pct">${data.data.progress || 0}%</div>
            </div>
            <div class="comic-progress-text" id="comic-progress-text">${esc(data.data.message || '处理中...')}</div>
          </div>`;
      }
      pollComicProgress(taskId);
    }
  } catch {}
}

async function deleteComicTask(taskId) {
  if (!confirm('确定删除此漫画？')) return;
  try {
    await authFetch(`/api/comic/tasks/${taskId}`, { method: 'DELETE' });
    loadComicHistory();
  } catch {}
}

// ══════════════════════════════════════════
//  我的作品
// ══════════════════════════════════════════
let worksFilter = 'all';
let worksCache = [];

async function loadWorksPage() {
  const grid = document.getElementById('works-grid');
  grid.innerHTML = '<div class="assets-empty">加载中...</div>';
  try {
    const [worksResp, statsResp] = await Promise.all([
      authFetch('/api/works?type=' + worksFilter),
      authFetch('/api/works/stats')
    ]);
    const worksData = await worksResp.json();
    const statsData = await statsResp.json();
    worksCache = worksData.works || [];
    renderWorksStats(statsData.stats || {});
    renderWorksGrid(worksCache);
  } catch (e) {
    grid.innerHTML = '<div class="assets-empty">加载失败</div>';
  }
}

function renderWorksStats(stats) {
  const el = document.getElementById('works-stats');
  const items = [
    { key: 'all', label: '全部作品', count: Object.values(stats).reduce((s, n) => s + n, 0) },
    { key: 'avatar', label: '数字人', count: stats.avatar || 0 },
    { key: 'video', label: 'AI 视频', count: stats.video || 0 },
    { key: 'i2v', label: '图生视频', count: stats.i2v || 0 },
    { key: 'portrait', label: 'AI 形象', count: stats.portrait || 0 },
    { key: 'comic', label: 'AI 漫画', count: stats.comic || 0 },
    { key: 'novel', label: 'AI 小说', count: stats.novel || 0 },
  ];
  el.innerHTML = items.map(it => `
    <div class="works-stat-card ${worksFilter === it.key ? 'active' : ''}" onclick="filterWorks('${it.key}',null)">
      <div class="works-stat-num">${it.count}</div>
      <div class="works-stat-label">${it.label}</div>
    </div>
  `).join('');
}

function filterWorks(type, btn) {
  worksFilter = type;
  document.querySelectorAll('#works-tabs .assets-tab').forEach(t => t.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
  } else {
    const tabs = document.querySelectorAll('#works-tabs .assets-tab');
    tabs.forEach(t => {
      const tabType = t.getAttribute('onclick')?.match(/filterWorks\('(\w+)'/)?.[1];
      if (tabType === type) t.classList.add('active');
    });
  }
  loadWorksPage();
}

function renderWorksGrid(works) {
  const grid = document.getElementById('works-grid');
  if (!works.length) {
    grid.innerHTML = '<div class="assets-empty">暂无作品，去各模块生成内容吧</div>';
    return;
  }

  grid.innerHTML = works.map(w => {
    let thumbContent;
    if (w.media_type === 'video') {
      const poster = w.thumbnail_url ? ` poster="${w.thumbnail_url}"` : '';
      thumbContent = `<div class="work-card-thumb">
        <video src="${w.stream_url}" muted preload="metadata"${poster}></video>
        <div class="work-card-play">&#9654;</div>
      </div>`;
    } else if (w.media_type === 'image') {
      thumbContent = `<div class="work-card-thumb">
        <img src="${w.preview_url}" loading="lazy" onerror="this.style.display='none'" />
      </div>`;
    } else {
      thumbContent = `<div class="work-card-text-preview">${esc(w.preview_text || '')}</div>`;
    }

    const downloadBtn = w.download_url
      ? `<button class="work-card-btn" onclick="event.stopPropagation();window.open('${w.download_url}','_blank')">下载</button>`
      : '';

    return `<div class="work-card" onclick="previewWork('${w.id}')">
      <span class="work-card-type-badge">${w.type_label}</span>
      ${thumbContent}
      <div class="work-card-info">
        <div class="work-card-title" title="${esc(w.title)}">${esc(w.title)}</div>
        <div class="work-card-meta">
          <span>${new Date(w.created_at).toLocaleDateString('zh-CN')}</span>
          ${w.word_count ? `<span>${w.word_count} 字</span>` : ''}
          ${w.panels ? `<span>${w.panels} 格</span>` : ''}
        </div>
      </div>
      <div class="work-card-actions">
        ${downloadBtn}
        <button class="work-card-btn danger" onclick="event.stopPropagation();deleteWork('${w.type}','${w.id}')">删除</button>
      </div>
    </div>`;
  }).join('');
}

function previewWork(id) {
  const w = worksCache.find(x => x.id === id);
  if (!w) return;
  if (w.media_type === 'video' && w.stream_url) {
    openLightbox(w.stream_url, w.title, 'video');
  } else if (w.media_type === 'image' && w.preview_url) {
    openLightbox(w.preview_url, w.title);
  } else if (w.media_type === 'text') {
    // 跳转到对应模块
    switchPage('novel');
  }
}

async function deleteWork(type, id) {
  if (!confirm('确认删除此作品？')) return;
  try {
    await authFetch(`/api/works/${type}/${id}`, { method: 'DELETE' });
    loadWorksPage();
  } catch {}
}

// 启动
init();
