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
  if (!getToken()) { window.location.href = '/?login=1'; return false; }
  const user = await fetchCurrentUser();
  if (!user) { clearToken(); window.location.href = '/?login=1'; return false; }
  const nameEl = document.getElementById('user-name');
  if (nameEl) nameEl.textContent = user.username;
  const avatarEl = document.getElementById('user-avatar');
  if (avatarEl) avatarEl.textContent = user.username[0].toUpperCase();
  // 头像旁显示用户名
  const labelEl = document.getElementById('user-name-label');
  if (labelEl) labelEl.textContent = user.username;
  const creditsEl = document.getElementById('credits-display');
  if (creditsEl) creditsEl.textContent = user.credits;
  const adminEl = document.getElementById('admin-link');
  if (adminEl && user.role === 'admin') adminEl.style.display = '';
  // 按权限过滤侧边栏 + 卡片入口
  applyPermissionVisibility(user);
  return true;
}

// 根据用户的 effective_permissions 隐藏无权访问的模块
// effective_permissions 是字符串数组：['*'] 表示全部；否则形如 ['enterprise:i2v:view', ...]
function applyPermissionVisibility(user) {
  const canSee = (k) => canSeeModule(user, k);

  // 隐藏所有 data-perm 未授权的 nav-item
  document.querySelectorAll('.sidebar .nav-item[data-perm]').forEach(el => {
    el.style.display = canSee(el.dataset.perm) ? '' : 'none';
  });

  // 如果整组子项都被隐藏 → 隐藏分组标题和分隔线
  document.querySelectorAll('.sidebar .sidebar-section[data-group]').forEach(section => {
    const items = section.querySelectorAll('.nav-item[data-perm]');
    const anyVisible = [...items].some(it => it.style.display !== 'none');
    section.style.display = anyVisible ? '' : 'none';
    const group = section.dataset.group;
    const divider = document.querySelector('.sidebar .sidebar-divider[data-group="' + group + '"]');
    if (divider) divider.style.display = anyVisible ? '' : 'none';
  });

  // 首页卡片入口：根据 onclick 参数判断
  document.querySelectorAll('.hub-type-card').forEach(card => {
    const onclick = card.getAttribute('onclick') || '';
    const m = onclick.match(/switchPage\(['"]([^'"]+)['"]\)/);
    if (m && !canSee(m[1])) card.style.display = 'none';
  });

  // 我的作品 Tab 按钮
  document.querySelectorAll('#works-tabs .assets-tab[data-perm]').forEach(btn => {
    btn.style.display = canSee(btn.dataset.perm) ? '' : 'none';
  });
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
  loadPlatformStyles(); // v15: 异步从 /api/ai-cap/styles 加载平台真实风格库
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

  // v15 fix: 处理 URL hash / sessionStorage 跳转 (供 drama-studio 返回工作台用)
  const hashTarget = (location.hash || '').replace('#', '').trim();
  const ssTarget = sessionStorage.getItem('vido-target-page');
  const target = ssTarget || hashTarget;
  if (target) {
    sessionStorage.removeItem('vido-target-page');
    setTimeout(() => switchPage(target), 100);
  }

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
  dashboard:'创作中心', create:'AI 视频', imggen:'AI 图片生成', avatar:'AI 数字人',
  comic:'AI 漫画', novel:'AI 小说', i2v:'图生视频', portrait:'我的角色',
  projects:'我的项目', works:'我的作品', assets:'素材库', workbench:'声音克隆',
  radar:'素材获取', monitor:'素材库', contentlib:'内容库', replicate:'一键复刻',
  profile:'个人信息', workflow:'工作流画布'
};

function toggleMoreTools() {
  const trigger = document.querySelector('.nav-sub-trigger');
  const group = document.getElementById('nav-more-tools');
  if (trigger) trigger.classList.toggle('open');
  if (group) group.classList.toggle('open');
}

function toggleAdvancedSettings() {
  const toggle = document.querySelector('.stp-advanced-toggle');
  const body = document.getElementById('stp-advanced-body');
  if (!toggle || !body) return;
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  toggle.classList.toggle('open', !isOpen);
}

function toggleComicAdvanced() {
  const toggle = document.querySelector('.comic-advanced-toggle');
  const body = document.getElementById('comic-advanced-body');
  if (!toggle || !body) return;
  body.classList.toggle('open');
  toggle.classList.toggle('open');
}

function toggleNovelAdvanced() {
  const toggle = document.querySelector('.nv-advanced-toggle');
  const body = document.getElementById('nv-advanced-body');
  if (!toggle || !body) return;
  body.classList.toggle('open');
  toggle.classList.toggle('open');
}

function toggleAvatarAdvanced() {
  const toggle = document.querySelector('.av-advanced-toggle');
  const body = document.getElementById('av-advanced-body');
  if (!toggle || !body) return;
  body.classList.toggle('open');
  toggle.classList.toggle('open');
}

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
  if (breadEl) breadEl.textContent = page === 'dashboard' ? '/ 开始创作' : '';
  if (page === 'projects') loadProjects();
  if (page === 'i2v') loadI2VPage();
  if (page === 'avatar') loadAvatarPage();
  if (page === 'imggen') loadImgGenPage();
  if (page === 'novel') nvLoadPage();
  if (page === 'comic') loadComicPage();
  if (page === 'drama') loadDramaPage();
  if (page === 'portrait') loadPortraitPage();
  if (page === 'works') loadWorksPage();
  if (page === 'assets') loadAssetsPage();
  if (page === 'radar') loadRadarOverview();
  if (page === 'monitor') loadMonitorList();
  if (page === 'contentlib') loadContentLib();
  if (page === 'replicate') loadReplicatePage();
  if (page === 'workbench') loadVoiceClonePage();
  if (page === 'profile') loadProfilePage();
  if (page === 'workflow') {
    const iframe = document.getElementById('workflow-iframe');
    if (iframe && iframe.src === 'about:blank') iframe.src = '/workflow.html';
  }
  if (page === 'create' && !(opts && opts.keepProject)) {
    resetForm();
  }
}

// ═══ 仪表板 ═══
async function loadDashboard() {
  const [statsRes, tasksRes] = await Promise.all([
    authFetch('/api/dashboard/stats').then(r => r.json()).catch(() => null),
    authFetch('/api/dashboard/recent-tasks').then(r => r.json()).catch(() => null)
  ]);

  // 统计数据
  if (statsRes?.success) {
    const s = statsRes.data;
    const totalVideos = s.total_projects || 0;
    const totalAvatars = s.total_avatars || 0;
    const totalImages = (s.total_portraits || 0) + (s.total_comics || 0);
    const totalNovels = s.total_novels || 0;
    const el = id => document.getElementById(id);
    if (el('ds-videos')) el('ds-videos').textContent = totalVideos;
    if (el('ds-avatars')) el('ds-avatars').textContent = totalAvatars;
    if (el('ds-images')) el('ds-images').textContent = totalImages;
    if (el('ds-novels')) el('ds-novels').textContent = totalNovels;
    // 内容卡片计数
    if (el('hub-cnt-video')) el('hub-cnt-video').textContent = totalVideos + ' 作品';
    if (el('hub-cnt-avatar')) el('hub-cnt-avatar').textContent = totalAvatars + ' 作品';
    if (el('hub-cnt-comic')) el('hub-cnt-comic').textContent = totalImages + ' 作品';
    if (el('hub-cnt-novel')) el('hub-cnt-novel').textContent = totalNovels + ' 作品';
  }

  // 最近作品（视觉画廊格式）
  const tasksEl = document.getElementById('dash-tasks');
  if (tasksRes?.success && tasksRes.tasks?.length) {
    const TYPE_ICON = { 'AI视频':'🎬', '数字人':'🧑‍💼', 'AI漫画':'📚', 'AI图片':'🖼️', 'AI小说':'✍️', '图生视频':'🎞️' };
    const STATUS_LABEL = { done:'已完成', completed:'已完成', processing:'生成中', generating:'生成中', error:'失败', pending:'等待中' };
    const TYPE_PAGE = { 'AI视频':'projects', '数字人':'avatar', 'AI漫画':'comic', 'AI图片':'portrait', 'AI小说':'novel', '图生视频':'i2v' };
    tasksEl.innerHTML = tasksRes.tasks.map(t => {
      const st = t.status || 'pending';
      const pg = TYPE_PAGE[t.type] || 'works';
      const icon = TYPE_ICON[t.type] || '📄';
      const statusColor = (st === 'done' || st === 'completed') ? 'var(--accent)' : st === 'error' ? '#ef4444' : 'var(--text3)';
      return `<div class="hub-recent-item" onclick="switchPage('${pg}')">
        <div class="hub-recent-thumb" style="display:flex;align-items:center;justify-content:center;font-size:32px;background:rgba(var(--accent-rgb),.04);">${icon}</div>
        <div class="hub-recent-info">
          <div class="hub-recent-title">${esc(t.title || '未命名')}</div>
          <div class="hub-recent-meta">
            <span class="hub-recent-type">${esc(t.type)}</span>
            <span style="color:${statusColor}">${STATUS_LABEL[st]||st}</span>
            <span>${esc(t.time_ago||'')}</span>
          </div>
        </div>
      </div>`;
    }).join('');
  } else {
    tasksEl.innerHTML = '<div class="hub-recent-empty">还没有作品，从上方开始你的第一次创作吧</div>';
  }
}

// Hub 智能路由
function hubSmartRoute() {
  const text = (document.getElementById('hub-input')?.value || '').trim();
  if (!text) return;
  const avatarKW = ['数字人','口播','讲解','主播','直播','大家好','欢迎','分享','今天'];
  const comicKW = ['漫画','分镜','格漫','条漫'];
  const novelKW = ['小说','章节','写作','长篇','连载','第一章'];
  if (avatarKW.some(k => text.includes(k))) {
    switchPage('avatar');
    const el = document.getElementById('av-text-input');
    if (el) el.value = text;
  } else if (comicKW.some(k => text.includes(k))) {
    switchPage('comic');
    const el = document.getElementById('comic-story');
    if (el) el.value = text;
  } else if (novelKW.some(k => text.includes(k))) {
    switchPage('novel');
  } else {
    switchPage('create');
    const el = document.getElementById('input-theme');
    if (el) { el.value = text; if (typeof updateCharCount === 'function') updateCharCount(el, 'story-cnt'); }
  }
}

function hubSetExample(page, text) {
  const el = document.getElementById('hub-input');
  if (el) el.value = text;
  hubSmartRoute();
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
    hint.textContent = '正在打开浏览器（约 5-10 秒）...';
    startQrPoll(platform);  // 立即开始 1s polling 拿截图
  } catch (err) {
    hint.textContent = '启动失败: ' + err.message;
  }
}

function startQrPoll(platform) {
  if (_qrPollTimer) clearInterval(_qrPollTimer);
  // 1s 间隔（之前 3s）— 浏览器异步启动后第一次 polling 就能拿到二维码
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
      } else if (data.status === 'launching') {
        document.getElementById('qr-login-hint').textContent = `${data.message || '启动中'} · 已等 ${data.elapsed || 0}s`;
      } else if (data.screenshot) {
        document.getElementById('qr-login-img').src = data.screenshot;
        document.getElementById('qr-login-hint').textContent = `请用 APP 扫描二维码 · 已等 ${data.elapsed || '?'}s`;
      }
    } catch {}
  }, 1000);
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
      <div class="sto-li-desc">${esc(buildCharDesc(c))}</div>
      ${isLoading ? '<div class="sto-li-loading">⟳ 正在生成形象...</div>' : ''}
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

  // Portrait + 三视图 (v15)
  const portrait = document.getElementById('srp-char-portrait');
  if (portrait) {
    let html = c.imageUrl
      ? `<img src="${esc(c.imageUrl)}" class="srp-portrait-img" onclick="openLightbox('${esc(c.imageUrl)}','${esc(c.name || '')}')" style="cursor:zoom-in" />`
      : `<div class="srp-portrait-ph"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.4"/><path d="M4 22c0-4.42 3.58-8 8-8s8 3.58 8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><span>暂无形象</span></div>`;

    // 如果有三视图就追加 3 张缩略图
    if (c.threeView && (c.threeView.front || c.threeView.side || c.threeView.back)) {
      const thumbs = ['front', 'side', 'back'].map(k => {
        const url = c.threeView[k];
        const labelMap = { front: '正面', side: '侧面', back: '背面' };
        if (!url) {
          return `<div class="srp-tv-thumb srp-tv-empty" title="${labelMap[k]}（生成失败）">—</div>`;
        }
        return `<div class="srp-tv-thumb" title="${labelMap[k]}" onclick="openLightbox('${esc(url)}','${esc(c.name || '')} - ${labelMap[k]}')">
          <img src="${esc(url)}" alt="${labelMap[k]}" />
          <span>${labelMap[k]}</span>
        </div>`;
      }).join('');
      html += `<div class="srp-three-view"><div class="srp-three-view-label">🎭 三视图</div><div class="srp-three-view-row">${thumbs}</div></div>`;
    }
    portrait.innerHTML = html;
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

// ═══ 风格选择 (v15: 同步平台 /api/ai-cap/styles) ═══
let platformStyles = [];   // 来自 /api/ai-cap/styles 的真实平台风格
let selectedPlatformStyleId = null;

// 类目 → 默认 dim 映射 (取代 2D/3D 切换)
const STYLE_CATEGORY_DIM = {
  realistic: '3d',  // 写实类用 3d 渲染管线
  cartoon:   '3d',  // 3D 卡通
  manga:     '2d',
  comic:     '2d',
  traditional:'2d', // 国风水墨
  scifi:     '3d',  // 赛博朋克偏 3d
  dark:      '2d',
  soft:      '2d',
  stylized:  '2d',
};
// 类目 → emoji 图标
const STYLE_CATEGORY_ICON = {
  realistic: '🎬',
  cartoon:   '🌐',
  manga:     '🎌',
  comic:     '💥',
  traditional:'🖌',
  scifi:     '⚡',
  dark:      '🌑',
  soft:      '🌸',
  stylized:  '🎨',
};
// 类目 → 主题色
const STYLE_CATEGORY_COLOR = {
  realistic: '#7888d8',
  cartoon:   '#c4a535',
  manga:     '#c06af0',
  comic:     '#ff5040',
  traditional:'#d4a020',
  scifi:     '#00b4cc',
  dark:      '#475569',
  soft:      '#ff9ec0',
  stylized:  '#a4e400',
};

async function loadPlatformStyles() {
  try {
    const r = await authFetch('/api/ai-cap/styles');
    const j = await r.json();
    if (j.success && Array.isArray(j.data)) {
      platformStyles = j.data;
    }
  } catch (e) {
    console.warn('[loadPlatformStyles] failed', e);
  }
  // 默认选第 1 个
  if (platformStyles.length && !selectedPlatformStyleId) {
    selectedPlatformStyleId = platformStyles[0].id;
    applyStyleToDim(platformStyles[0]);
  }
  renderStyleGrid();
}

function applyStyleToDim(style) {
  if (!style) return;
  const dim = STYLE_CATEGORY_DIM[style.category] || '2d';
  sceneDim = dim;
  charDim = dim;
  contentType = dim;
  // 兼容旧的 animStyle 全局变量 (storyService 用)
  animStyle = style.name || 'anime';
}

function renderStyleGrid() {
  const grid = document.getElementById('style-grid');
  if (!grid) return;
  // 如果还没有平台风格，回退到旧的 ANIM_STYLES
  if (!platformStyles.length) {
    grid.innerHTML = ANIM_STYLES.map(s => {
      const active = s.id === animStyle;
      return `<div class="style-chip ${active ? 'active' : ''}" data-sid="${s.id}" onclick="switchAnimStyle('${s.id}')" style="--sc: ${s.color}">
        <span class="sc-icon">${s.icon}</span>
        <span class="sc-text">${esc(s.label)}</span>
      </div>`;
    }).join('');
    return;
  }
  // 使用平台风格库
  grid.innerHTML = platformStyles.map(s => {
    const active = s.id === selectedPlatformStyleId;
    const icon = STYLE_CATEGORY_ICON[s.category] || '🎨';
    const color = STYLE_CATEGORY_COLOR[s.category] || '#00b4cc';
    return `<div class="style-chip ${active ? 'active' : ''}" data-sid="${s.id}" onclick="selectPlatformStyle('${s.id}')" style="--sc: ${color}" title="${esc(s.prompt_en || '')}">
      <span class="sc-icon">${icon}</span>
      <span class="sc-text">${esc(s.name)}</span>
    </div>`;
  }).join('');
}

function selectPlatformStyle(id) {
  selectedPlatformStyleId = id;
  const style = platformStyles.find(s => s.id === id);
  if (style) applyStyleToDim(style);
  document.querySelectorAll('#style-grid .style-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.sid === id);
  });
}

// 兼容旧 ANIM_STYLES 路径
function switchAnimStyle(id) {
  animStyle = id;
  const s = ANIM_STYLES.find(x => x.id === id);
  if (s) {
    // 简单映射
    const dim = ['3dcg', 'realistic', 'guofeng_3d'].includes(id) ? '3d' : '2d';
    sceneDim = charDim = contentType = dim;
  }
  document.querySelectorAll('#style-grid .style-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.sid === id);
  });
}

// ═══ 高级设置折叠 ═══
// Note: toggleAdvancedSettings is defined earlier (line ~236) using classList toggle
// with the correct element IDs (stp-advanced-body). Removed duplicate here.

// ═══ 模式切换 ═══
function switchMode(mode) {
  // 仅保留 ai / custom 两种模式 (Phase 4 简化)
  if (mode !== 'ai' && mode !== 'custom') mode = 'ai';
  creationMode = mode;
  ['ai', 'custom'].forEach(m => {
    const el = document.getElementById('mode-' + m);
    if (el) el.classList.toggle('active', m === mode);
  });
  show('section-ai',   mode === 'ai');
  show('section-plot', mode === 'custom');
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
    setTimeout(() => { ta.placeholder = '一句话描述也可以,AI 会先扩写为分镜脚本级别的详细内容...'; }, 3000);
    return;
  }
  const btn = document.querySelector('.btn-ai-create');
  btn.disabled = true; btn.innerHTML = '<span class="ai-dot spinning"></span> ✦ AI 扩写中...';
  try {
    // Step 1: 如果文本较短(<200 字)且不像分镜脚本(没有"分镜"/"画面"关键词), 先调 expand-theme 扩写
    let scriptText = theme;
    const looksLikeShotScript = /分镜|画面|镜头|焦段|LUT|场景\s*[一二三四五六七八九十1-9]/.test(theme);
    if (theme.length < 200 && !looksLikeShotScript) {
      try {
        const expandRes = await authFetch('/api/story/expand-theme', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme, scene_count: 8, style: typeof animStyle !== 'undefined' ? animStyle : '' })
        });
        const expandData = await expandRes.json();
        if (expandData.success && expandData.data?.expanded_text) {
          scriptText = expandData.data.expanded_text;
          ta.value = scriptText;  // 把扩写后的详细描述显示在输入框
          updateCharCount(ta, 'story-cnt');
          showToast('✦ 已扩写为详细分镜描述,正在解析角色和场景...', 'ok');
        }
      } catch (e) {
        console.warn('[quickAIStory] expand-theme 失败,直接 parseScript:', e);
      }
    }

    // Step 2: 用扩写后(或原始)的文本走 parseScript 提取角色+场景
    btn.innerHTML = '<span class="ai-dot spinning"></span> 解析角色场景...';
    const res = await authFetch('/api/story/parse-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: scriptText, genre: 'drama', duration: 60 })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    // 填充角色 (合并 description + appearance, 后端两个字段都可能有内容)
    characters = []; charIdCounter = 0;
    (data.data.characters || []).forEach(c => {
      const desc = [c.description, c.appearance].filter(Boolean).join('；');
      characters.push({
        id: ++charIdCounter, name: c.name || '', role: c.role || 'main',
        charType: c.charType || 'human', description: desc || '（待补充）',
        imageUrl: '', theme: c.theme || '古代', gender: c.gender || 'female',
        race: c.race || '人', age: c.age || '青年', species: '', subCategory: '', checked: false
      });
    });
    renderCharacters();

    // 填充场景 (后端 parseScript 返回 scenes 数组，字段是 background/characters_action/dialogue/camera/mood/duration)
    customScenes = []; sceneIdCounter = 0;
    const sceneList = data.data.scenes || data.data.custom_scenes || [];
    sceneList.forEach(s => {
      customScenes.push({
        id: ++sceneIdCounter,
        title: s.title || '',
        location: s.location || '',
        // 关键：把后端的 background + characters_action 合并到 description 字段
        description: [s.background, s.characters_action].filter(Boolean).join('\n\n') || s.description || '',
        dialogue: s.dialogue || '',
        mood: s.mood || '',
        theme: '魔幻',
        category: '室外',
        timeOfDay: s.timeOfDay || '白天',
        dim: '2d', imageUrl: null, video_provider: '', video_model: '',
        duration: s.duration || 10, checked: false,
        // 保留原始字段供 AI 视频生成使用
        background: s.background || '',
        characters_action: s.characters_action || '',
        characters_in_scene: s.characters_in_scene || [],
        camera: s.camera || '',
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

    showToast(`智能创作完成：${characters.length} 个角色 + ${customScenes.length} 个场景，开始按画风生成形象...`, 'ok');
    if (customScenes.length) switchStudioTab('scene');
    detectActionContent(theme);

    // 【v15 关键】按选定画风自动生成所有角色 + 场景图片
    btn.innerHTML = '<span class="ai-dot spinning"></span> 按画风生图...';
    autoGenerateAllAssets();  // 不 await — 后台并行生成，不阻塞 UI
  } catch (e) {
    showToast('智能创作失败: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = '<span class="ai-dot"></span> 智能创作';
  }
}

// v15: 按当前选定的画风，并行生成所有角色 + 场景图片
async function autoGenerateAllAssets() {
  const charPromises = characters.map(async (c) => {
    if (c.imageUrl) return; // 已有就跳过
    if (!loadingCharIds) return;
    loadingCharIds.add(c.id);
    renderCharacters();
    try {
      await generateCharImage(c.id);
    } catch (e) {
      console.warn(`[autoGen char ${c.name}] failed:`, e.message);
    } finally {
      loadingCharIds.delete(c.id);
      renderCharacters();
    }
  });

  const scenePromises = customScenes.map(async (s) => {
    if (s.imageUrl) return;
    try {
      const res = await authFetch('/api/story/generate-scene-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: s.title,
          description: s.background || s.description,
          theme: animStyle,
          timeOfDay: s.timeOfDay,
          category: s.category,
          dim: sceneDim,
          aspectRatio,
        })
      });
      const data = await res.json();
      if (data.success && data.data?.imageUrl) {
        s.imageUrl = data.data.imageUrl;
        renderScenes();
      }
    } catch (e) {
      console.warn(`[autoGen scene ${s.title}] failed:`, e.message);
    }
  });

  // 并行（最多 3 个并发，避免 API 限流）
  await Promise.all([...charPromises, ...scenePromises]);
  showToast(`✓ 所有素材生成完成 (${characters.length} 角色 + ${customScenes.length} 场景)`, 'ok');
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
      const desc = [c.description, c.appearance].filter(Boolean).join('；');
      characters.push({
        id: ++charIdCounter,
        name: c.name||'',
        role: c.role||'main',
        description: desc || '（待补充）',
      });
    });
    renderCharacters();

    customScenes = []; sceneIdCounter = 0;
    const sceneList = data.data.scenes || data.data.custom_scenes || [];
    sceneList.forEach(s => {
      customScenes.push({
        id: ++sceneIdCounter,
        title: s.title || '',
        location: s.location || '',
        description: [s.background, s.characters_action].filter(Boolean).join('\n\n') || s.description || '',
        mood: s.mood || '',
        video_provider: '',
        video_model: '',
        background: s.background || '',
        characters_action: s.characters_action || '',
        characters_in_scene: s.characters_in_scene || [],
        camera: s.camera || '',
        duration: s.duration || 10,
      });
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

// 从角色库导入角色到视频项目
function importVideoCharFromLibrary() {
  showLibraryPicker('characters', {
    multiple: true,
    onSelect: (items) => {
      for (const c of items) {
        const id = ++charIdCounter;
        characters.push({
          id, name: c.name, role: 'main', charType: 'human',
          description: c.appearance_prompt || c.appearance || c.personality || '',
          imageUrl: c.ref_images?.[0] || '', theme: '古代',
          gender: c.gender || 'female', race: '人', age: c.age_range || '青年',
          species: '', subCategory: '', checked: false,
          _libraryId: c.id
        });
      }
      renderCharacters();
      switchStudioTab('character');
    }
  });
}

// 从场景库导入场景到视频项目
function importVideoSceneFromLibrary() {
  showLibraryPicker('scenes', {
    multiple: true,
    onSelect: (items) => {
      for (const s of items) {
        addScene();
        const last = customScenes[customScenes.length - 1];
        if (last) {
          last.title = s.name;
          last.description = s.scene_prompt || s.description || '';
          last.imageUrl = s.ref_images?.[0] || '';
          last._libraryId = s.id;
        }
      }
      renderScenes();
      switchStudioTab('scene');
    }
  });
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
  // v15: 后端默认附带三视图，存到角色对象上供属性面板展示
  if (data.data.threeView) {
    c.threeView = data.data.threeView;
  }
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
  const textEl = box.querySelector('.music-drop-text');
  const origText = textEl?.textContent || '';
  if (textEl) textEl.textContent = `上传中... (${(file.size/1024/1024).toFixed(1)}MB)`;
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
    if (textEl) textEl.textContent = origText;
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
      const body = document.getElementById('stp-advanced-body');
      if (body && !body.classList.contains('open')) toggleAdvancedSettings();
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

async function saveProjectToWorks(btn) {
  if (!currentProjectId) return;
  btn.disabled = true;
  btn.textContent = '保存中...';
  try {
    const res = await authFetch('/api/workflow/save-to-works', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: document.getElementById('input-theme')?.value || 'AI 视频',
        videoUrl: '/api/projects/' + currentProjectId + '/stream',
        projectId: currentProjectId
      })
    });
    const data = await res.json();
    if (data.success) {
      btn.textContent = '已保存 ✓';
      showToast('已保存到作品库', 'ok');
    } else {
      throw new Error(data.error);
    }
  } catch (e) {
    btn.textContent = '💾 保存到作品';
    btn.disabled = false;
    showToast('保存失败: ' + e.message, 'error');
  }
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
const escapeHtml = esc;

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
  // 从模板初始化完整流程卡片
  restoreAvatarPipeline();
  // 从数据库加载历史记录
  await loadAvatarHistoryFromDB();
  renderAvatarHistory();
  // 加载用户自定义素材（人物/背景）
  await loadCustomItems();
  // 后台补生缺失的预设头像（3 并发，不阻塞页面）
  setTimeout(() => autoBackfillMissingPresets().catch(() => {}), 3000);
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
    // 注意：后端 /api/settings 会把 api_key 抹掉为 undefined（仅返回 api_key_masked），
    // 这里只能按 enabled 过滤；后端在保存时已确保 enabled = !!api_key
    const providers = (data.data?.providers || data.providers || [])
      .filter(p => p.enabled && (p.api_key || p.api_key_masked))
      .filter(p => p.test_status !== 'error'); // 屏蔽测试失败的供应商
    const sel = document.getElementById('av-model-selector');
    if (!sel) return;

    // 视频模型数据库（id → 描述）
    const modelInfo = {
      'cogvideox-flash': { name: 'CogVideoX Flash', desc: '快速免费', rec: true },
      'cogvideox-3': { name: 'CogVideoX 3', desc: '高质量' },
      'I2V-01-live': { name: 'Hailuo I2V Live', desc: '口播推荐', rec: true },
      'I2V-01': { name: 'Hailuo I2V-01', desc: '标准图生视频' },
      'MiniMax-Hailuo-2.3': { name: 'Hailuo 2.3', desc: '最新旗舰', rec: true },
      'MiniMax-Hailuo-2.3-Fast': { name: 'Hailuo 2.3 Fast', desc: '快速低价' },
      'kling-v3': { name: 'Kling 3.0', desc: '4K旗舰', rec: true },
      'kling-v2.5-turbo-pro': { name: 'Kling 2.5 Turbo', desc: '快速' },
      'kling-v2-master': { name: 'Kling V2 Master', desc: '旗舰' },
      'kling-v1-6': { name: 'Kling v1.6', desc: '经典' },
    };

    // 按供应商收集可用的视频模型
    const providerMap = {
      zhipu: '智谱AI', minimax: 'MiniMax', kling: 'Kling AI', fal: 'FAL',
      runway: 'Runway', luma: 'Luma', vidu: 'Vidu', jimeng: '即梦',
    };
    // 数字人必须是 i2v（image-to-video）模型；过滤掉 t2v 文生视频
    // 黑名单：模型名/id 中含以下关键词 = 文生视频，数字人用不上
    const T2V_KEYWORDS = ['t2v', 'text2video', '文生视频', 'text-to-video', 'text_to_video', '运镜视频'];
    function isT2VOnly(m, info) {
      const haystack = [(m.id||''), (m.name||''), (info.name||'')].join(' ').toLowerCase();
      // 含 i2v 或"图生"或"图生视频"或"首帧"= 一定是 i2v，保留
      if (/i2v|image2video|图生|首帧|image-to-video|first[-_ ]?frame/i.test(haystack)) return false;
      // 命中 t2v 关键词 = 不要
      return T2V_KEYWORDS.some(kw => haystack.includes(kw.toLowerCase()));
    }

    const available = []; // { id, name, provider, rec }
    const filtered = []; // 已过滤的 t2v 模型，仅日志
    for (const p of providers) {
      const videoModels = (p.models || []).filter(m => m.use === 'video' && m.enabled !== false);
      for (const m of videoModels) {
        const info = modelInfo[m.id] || {};
        if (isT2VOnly(m, info)) {
          filtered.push(`${p.id}/${m.id}`);
          continue;
        }
        available.push({
          id: m.id,
          name: info.name || m.name || m.id,
          desc: info.desc || '',
          provider: p.name || providerMap[p.id] || p.id,
          rec: info.rec || false,
        });
      }
    }
    if (filtered.length) console.log('[Avatar] 过滤掉的 t2v 模型（数字人不支持）:', filtered.join(', '));

    // 智谱免费模型始终可用（即使没在 settings 里配置视频模型）
    if (!available.find(a => a.id === 'cogvideox-flash')) {
      const zhipu = providers.find(p => p.id === 'zhipu');
      if (zhipu) available.unshift({ id: 'cogvideox-flash', name: 'CogVideoX Flash', desc: '快速免费', provider: '智谱AI', rec: true });
    }

    if (available.length === 0) {
      sel.innerHTML = '<option value="cogvideox-flash">CogVideoX Flash — 智谱AI · 快速免费</option>';
      return;
    }

    // 推荐在前
    const recommended = available.filter(a => a.rec);
    const others = available.filter(a => !a.rec);

    // ⭐ 即梦 Omni 选项（照片级抠像版）— 当 jimeng provider 有 key 时注入
    const hasJimeng = providers.some(p => (p.id === 'jimeng' || p.preset === 'jimeng'));
    const hasBaidu = providers.some(p => (p.id === 'baidu-aip' || p.preset === 'baidu-aip'));

    let html = '';
    if (hasJimeng) {
      html += '<optgroup label="⭐ 即梦 Omni（照片级·口型最准）">';
      if (hasBaidu) {
        html += '<option value="jimeng-omni-matte" selected>即梦 Omni + 百度抠像（换任意背景·5-7 分钟）</option>';
      }
      html += '<option value="jimeng-omni-raw">即梦 Omni 原片（即梦自选背景·4-5 分钟）</option>';
      html += '</optgroup>';
    }

    if (recommended.length) {
      html += '<optgroup label="其他推荐">';
      recommended.forEach(a => { html += `<option value="${a.id}">${esc(a.name)} — ${esc(a.provider)}${a.desc ? ' · '+a.desc : ''}</option>`; });
      html += '</optgroup>';
    }
    // 其余按供应商分组
    const groups = {};
    others.forEach(a => { if (!groups[a.provider]) groups[a.provider] = []; groups[a.provider].push(a); });
    for (const [prov, models] of Object.entries(groups)) {
      html += `<optgroup label="${esc(prov)}">`;
      models.forEach(a => { html += `<option value="${a.id}">${esc(a.name)}${a.desc ? ' — '+a.desc : ''}</option>`; });
      html += '</optgroup>';
    }
    sel.innerHTML = html;
    // 立刻触发一次 hint 同步，让默认选中项的 hint 正确显示
    if (typeof selectAvModel === 'function') selectAvModel(sel);
  } catch (e) { console.warn('[Avatar] loadAvModels:', e.message); }
}

let _lastAvModelHint = '智谱 CogVideoX · 预计 1~3 分钟';

function selectAvModel(sel) {
  const model = sel.value || '';
  let hintText;
  if (model === 'jimeng-omni-matte') {
    hintText = '即梦 Omni + 百度抠像 · 5-7 分钟（含换背景）';
  } else if (model === 'jimeng-omni-raw') {
    hintText = '即梦 Omni 原片 · 4-5 分钟';
  } else if (model.startsWith('kling-')) {
    hintText = `Kling AI ${model === 'kling-v3' ? '4K旗舰' : '图生视频'} · 预计 1~3 分钟`;
  } else if (model.startsWith('I2V-') || model.startsWith('MiniMax-')) {
    hintText = `MiniMax Hailuo ${model.includes('Fast') ? '快速模式' : '图生视频'} · 预计 1~3 分钟`;
  } else {
    hintText = '智谱 CogVideoX 图生视频 · 预计 1~3 分钟';
  }
  _lastAvModelHint = hintText;
  const hint = document.getElementById('av-gen-hint');
  if (hint) hint.textContent = hintText;
  // 即梦 Omni 场景限制提示：只在选了 Omni 任一变体时显示
  const omniNote = document.getElementById('av-omni-prompt-note');
  if (omniNote) omniNote.style.display = (model === 'jimeng-omni-matte' || model === 'jimeng-omni-raw') ? 'block' : 'none';
}

function selectAvatar(el) {
  document.querySelectorAll('.av-avatar-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  avatarSelected = el.dataset.avatar;

  // 仅当"预设卡片且从未生成过图片"才自动生成（双重兜底：generated 标记 + has-img class + 已有 img 子元素）
  const imgEl = el.querySelector('.av-preset-avatar');
  if (!imgEl || !el.dataset.avatar) return;
  const alreadyHasImage = imgEl.dataset.generated === 'true'
    || imgEl.classList.contains('has-img')
    || imgEl.querySelector('img');
  if (!alreadyHasImage) {
    generateSinglePreset('avatar', el.dataset.avatar, imgEl);
  }
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

let _bgRewriteTimer = null;
const _BG_NAME_MAP = {
  office: '办公室', studio: '演播室', classroom: '教室',
  outdoor: '户外', green: '绿幕/纯色', custom: '自定义背景',
};

function selectAvatarBg(el) {
  document.querySelectorAll('.av-bg-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  const prevBg = avatarBg;
  avatarBg = el.dataset.bg;

  // 非"即梦 Omni + 百度抠像"模型时，背景不会真正合成 — 弹窗让用户选：切模型 or 继续
  const modelSel = document.getElementById('av-model-selector');
  const curModel = modelSel?.value || '';
  if (curModel && curModel !== 'jimeng-omni-matte' && el.dataset.bg !== 'office') {
    // 默认办公室不弹（避免打扰），其它 bg 切换时才弹
    setTimeout(() => {
      const hasMatte = modelSel && [...modelSel.options].some(o => o.value === 'jimeng-omni-matte');
      if (!hasMatte) return; // 没有抠像选项就算了
      const ok = confirm('你选了"' + (_BG_NAME_MAP[avatarBg] || avatarBg) + '"背景。\n\n当前模型不会真正合成背景，会是原图的背景。\n\n是否切换到「即梦 Omni + 百度抠像」让背景真实替换？');
      if (ok) {
        modelSel.value = 'jimeng-omni-matte';
        modelSel.dispatchEvent(new Event('change'));
        if (typeof selectAvModel === 'function') selectAvModel(modelSel);
        if (typeof showToast === 'function') showToast('已切换到「即梦 Omni + 百度抠像」', 'success');
      }
    }, 50);
  }

  // 台词已存在且背景真的变了 → debounce 1.5s 按新背景自动改写
  const ta = document.getElementById('av-text-input');
  const currentText = ta?.value?.trim() || '';
  if (currentText.length >= 20 && prevBg && prevBg !== avatarBg) {
    if (_bgRewriteTimer) clearTimeout(_bgRewriteTimer);
    _bgRewriteTimer = setTimeout(() => {
      _rewriteAvatarTextForBg(currentText, avatarBg);
    }, 1500);
  }

  // bg 改变时同步刷新"最终 prompt"（除非用户手动编辑过）
  if (prevBg && prevBg !== avatarBg && typeof refreshPromptPreview === 'function') {
    refreshPromptPreview(true);
  }

  // 仅当预设背景且从未生成过才自动生成
  const preview = el.querySelector('.av-preset-bg');
  if (!preview || !el.dataset.bg || el.dataset.bg === 'green' || el.dataset.bg === 'custom') return;
  const alreadyHasImage = preview.dataset.generated === 'true' || preview.classList.contains('has-img') || preview.querySelector('img');
  if (!alreadyHasImage) {
    generateSinglePreset('background', el.dataset.bg, preview);
  }
}

async function _rewriteAvatarTextForBg(oldText, newBg) {
  const bgName = _BG_NAME_MAP[newBg] || newBg;
  if (typeof showToast === 'function') showToast(`正在按「${bgName}」重写文案...`, 'info');
  try {
    const r = await authFetch('/api/avatar/generate-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar_name: '数字人', bg_name: bgName, draft: oldText, template: (typeof avatarTemplate !== 'undefined' ? avatarTemplate : '') }),
    });
    const j = await r.json();
    if (j.success && j.text) {
      const ta = document.getElementById('av-text-input');
      if (ta) {
        ta.value = j.text.trim();
        ta.dispatchEvent(new Event('input'));
        ta.dispatchEvent(new Event('change'));
      }
      // 文案变了 → 最终 prompt 也跟着更新
      if (typeof refreshPromptPreview === 'function') refreshPromptPreview(true);
      if (typeof showToast === 'function') showToast(`文案已按「${bgName}」调整`, 'success');
    } else {
      if (typeof showToast === 'function') showToast('自动改写失败，保留原文案', 'warning');
    }
  } catch (e) {
    console.warn('[bg-rewrite]', e.message);
  }
}

async function handleAvatarBgUpload(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const card = input.closest('.av-bg-card');
  // 本地预览
  const reader = new FileReader();
  reader.onload = function(e) {
    const preview = card.querySelector('.av-bg-preview');
    if (preview) {
      preview.style.backgroundImage = `url(${e.target.result})`;
      preview.style.backgroundSize = 'cover';
      preview.classList.remove('av-bg-upload-ph');
    }
  };
  reader.readAsDataURL(file);
  selectAvatarBg(card);

  // 上传到服务端，拿到可供 /compose 使用的公网 URL
  try {
    const fd = new FormData();
    fd.append('bg', file);
    const r = await authFetch('/api/avatar/jimeng-omni/upload-matte', { method: 'POST', body: fd });
    const d = await r.json();
    if (d?.bg_url) {
      avatarBgImageUrl = d.bg_url;
      if (typeof showToast === 'function') showToast('背景图已上传，生成时会自动抠像合成', 'success');
    } else {
      console.warn('[bg-upload] 没有 bg_url 返回', d);
    }
  } catch (e) {
    console.warn('[bg-upload] 上传失败', e);
    if (typeof showToast === 'function') showToast('背景图上传失败，将只在提示词里提到背景', 'warning');
  }
}

function selectAvatarVoice(el) {
  document.querySelectorAll('.av-voice-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  _avSelected = {
    id: el.dataset.voice || '',
    name: el.dataset.name || el.textContent.trim(),
    gender: el.dataset.gender || 'auto'
  };
}

// ═══ 音色列表加载 + 试听 ═══
let avVoiceListLoaded = false;
const AV_DEFAULT_VOICES = [
  { id: '', name: '自动', gender: 'auto', provider: '系统' },
  { id: 'BV700_streaming', name: '灿灿（甜美）', gender: 'female', provider: '火山引擎' },
  { id: 'BV009_streaming', name: '知性女声', gender: 'female', provider: '火山引擎' },
  { id: 'BV006_streaming', name: '磁性男声', gender: 'male', provider: '火山引擎' },
  { id: 'BV004_streaming', name: '开朗青年', gender: 'male', provider: '火山引擎' },
  { id: 'BV061_streaming', name: '天才童声', gender: 'male', provider: '火山引擎' },
];

// ═══════════ 新版音色选择器（2026-04-13） ═══════════
// 设计：只加载"当前可调用"的音色（后端已过滤未配 key 的供应商）
//       顶部 quick chips 显示 6 个常用；"更多音色"打开抽屉，含搜索/性别筛选/分组

let _avAllVoices = null;
let _avSelected = { id: '', name: '自动', gender: 'auto' };

function renderAvatarVoiceChips(voices) {
  const container = document.getElementById('av-voice-chips');
  if (!container) return;

  // 顶部只展示 6 个 quick chips（自动 + 5 个常用）
  const quick = [
    voices.find(v => v.id === '') || { id: '', name: '自动', gender: 'auto' },
    ...voices.filter(v => v.id !== '').slice(0, 5)
  ];

  container.innerHTML = quick.map(v => {
    const isActive = v.id === _avSelected.id ? 'active' : '';
    const gIcon = v.gender === 'male' ? '♂' : v.gender === 'female' ? '♀' : v.gender === 'child' ? '👶' : '';
    return `<span class="av-voice-chip ${isActive}" data-voice="${esc(v.id)}" data-gender="${esc(v.gender||'')}" data-name="${esc(v.name)}" onclick="selectAvatarVoice(this)">
      ${gIcon ? `<span class="av-vc-gender">${gIcon}</span>` : ''}${esc(v.name)}
      ${v.id ? `<button class="av-voice-preview-btn" onclick="event.stopPropagation();previewAvatarVoice('${esc(v.id)}','${esc(v.gender || 'female')}',this)" title="试听">▶</button>` : ''}
    </span>`;
  }).join('');
}

// 页面加载时：先渲染内置兜底，再异步加载真实可用列表
const AV_FALLBACK_QUICK = [
  { id: '', name: '自动', gender: 'auto' },
];
document.addEventListener('DOMContentLoaded', () => {
  renderAvatarVoiceChips(AV_FALLBACK_QUICK);
  preloadAvatarVoices();
});
if (document.readyState !== 'loading') { setTimeout(() => { renderAvatarVoiceChips(AV_FALLBACK_QUICK); preloadAvatarVoices(); }, 100); }

async function preloadAvatarVoices() {
  try {
    const r = await authFetch('/api/avatar/voice-list');
    const j = await r.json();
    if (j.success && j.voices?.length) {
      _avAllVoices = j.voices;
      renderAvatarVoiceChips(j.voices);
    }
  } catch {}
}

// 打开音色抽屉
async function loadMoreVoices() {
  if (!_avAllVoices) {
    try {
      const r = await authFetch('/api/avatar/voice-list');
      const j = await r.json();
      if (j.success) _avAllVoices = j.voices || [];
    } catch (e) { showToast('加载音色失败: ' + e.message, 'error'); return; }
  }
  if (!_avAllVoices || _avAllVoices.length <= 1) {
    showToast('未检测到可用音色。请到 AI 配置中启用 TTS 供应商（讯飞 / 火山 / 阿里 / MiniMax 等）', 'warning');
    return;
  }
  openVoicePicker();
}

function openVoicePicker() {
  // 复用或创建抽屉
  let modal = document.getElementById('av-voice-picker');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'av-voice-picker';
    modal.className = 'av-voice-modal';
    modal.innerHTML = `
      <div class="av-voice-modal-backdrop" onclick="closeVoicePicker()"></div>
      <div class="av-voice-modal-panel">
        <div class="av-voice-modal-hd">
          <span>选择音色</span>
          <button class="av-voice-modal-close" onclick="closeVoicePicker()">×</button>
        </div>
        <div class="av-voice-modal-tools">
          <input type="text" id="vpk-search" placeholder="搜索音色名称 / 标签..." oninput="filterVoicePicker()" />
          <div class="vpk-filter-row">
            <button class="vpk-f active" data-f="all" onclick="setVoicePickerFilter(this)">全部</button>
            <button class="vpk-f" data-f="female" onclick="setVoicePickerFilter(this)">♀ 女声</button>
            <button class="vpk-f" data-f="male" onclick="setVoicePickerFilter(this)">♂ 男声</button>
            <button class="vpk-f" data-f="child" onclick="setVoicePickerFilter(this)">👶 童声</button>
          </div>
        </div>
        <div class="av-voice-modal-body" id="vpk-body"></div>
        <div class="av-voice-modal-ft">
          <span style="font-size:11px;color:var(--text3)">共 <b id="vpk-count">0</b> 个可用音色</span>
          <button class="av-voice-modal-done" onclick="closeVoicePicker()">完成</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  renderVoicePicker();
  modal.classList.add('open');
}

function closeVoicePicker() {
  document.getElementById('av-voice-picker')?.classList.remove('open');
}

let _vpkFilter = 'all';
function setVoicePickerFilter(btn) {
  document.querySelectorAll('#av-voice-picker .vpk-f').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _vpkFilter = btn.dataset.f;
  renderVoicePicker();
}

function filterVoicePicker() { renderVoicePicker(); }

function renderVoicePicker() {
  const body = document.getElementById('vpk-body');
  if (!body || !_avAllVoices) return;
  const q = (document.getElementById('vpk-search')?.value || '').trim().toLowerCase();

  let list = _avAllVoices.filter(v => v.id !== ''); // 排除"自动"
  if (_vpkFilter !== 'all') list = list.filter(v => v.gender === _vpkFilter);
  if (q) list = list.filter(v => (v.name || '').toLowerCase().includes(q) || (v.tag || '').toLowerCase().includes(q) || (v.id || '').toLowerCase().includes(q));

  document.getElementById('vpk-count').textContent = list.length;

  // 我的克隆音色单独一组置顶
  const cloned = list.filter(v => v.isCloned);
  const rest = list.filter(v => !v.isCloned);

  // 其余按供应商分组
  const groups = {};
  rest.forEach(v => {
    const p = v.provider || '其他';
    (groups[p] = groups[p] || []).push(v);
  });

  const provIcons = { '科大讯飞':'🎙️','火山引擎':'🌋','阿里云':'☁️','百度':'🔍','MiniMax':'🎭','ElevenLabs':'🔊','智谱':'🔮','Fish Audio':'🐟','OpenAI':'⚡','火山复刻':'🎤' };
  const renderVoiceCard = (v, isCloned) => {
    const gIcon = v.gender === 'male' ? '♂' : v.gender === 'female' ? '♀' : v.gender === 'child' ? '👶' : '';
    const isActive = v.id === _avSelected.id ? 'active' : '';
    return `<div class="vpk-card ${isActive} ${isCloned ? 'vpk-card-cloned' : ''}" onclick="pickVoiceFromModal('${esc(v.id)}','${esc(v.name)}','${esc(v.gender||'')}')">
      <div class="vpk-card-top">
        <span class="vpk-card-gender">${gIcon}</span>
        <span class="vpk-card-name">${esc(v.name)}</span>
        <button class="vpk-preview" onclick="event.stopPropagation();previewAvatarVoice('${esc(v.id)}','${esc(v.gender || 'female')}',this)">▶</button>
      </div>
      ${isCloned ? '<div class="vpk-card-badge">我的克隆</div>' : ''}
      ${v.tag ? `<div class="vpk-card-tag">${esc(v.tag)}</div>` : ''}
    </div>`;
  };

  let html = '';
  if (cloned.length) {
    html += `<div class="vpk-group vpk-group-mine">
      <div class="vpk-group-hd">🎤 我的音色（克隆） <span class="vpk-group-cnt">${cloned.length}</span>
        <a class="vpk-goto-clone" href="#" onclick="event.preventDefault();switchPage('workbench')">+ 克隆新音色</a>
      </div>
      <div class="vpk-grid">${cloned.map(v => renderVoiceCard(v, true)).join('')}</div>
    </div>`;
  } else {
    html += `<div class="vpk-empty-clone">
      <div>🎤 还没有克隆音色</div>
      <a href="#" onclick="event.preventDefault();closeVoicePicker();switchPage('workbench')">前往「声音克隆」工作台 →</a>
    </div>`;
  }

  for (const [prov, items] of Object.entries(groups)) {
    const icon = Object.entries(provIcons).find(([k]) => prov.includes(k))?.[1] || '🎤';
    html += `<div class="vpk-group">
      <div class="vpk-group-hd">${icon} ${esc(prov)} <span class="vpk-group-cnt">${items.length}</span></div>
      <div class="vpk-grid">`;
    items.forEach(v => { html += renderVoiceCard(v, false); });
    html += '</div></div>';
  }
  body.innerHTML = html || '<div style="padding:40px;text-align:center;color:var(--text3)">未找到匹配的音色</div>';
}

function pickVoiceFromModal(id, name, gender) {
  _avSelected = { id, name, gender };
  // 更新顶部 chips 高亮
  renderAvatarVoiceChips(_avAllVoices || AV_FALLBACK_QUICK);
  // 如果 quick chips 里没有此音色，加到最前
  const topIds = new Set([...document.querySelectorAll('#av-voice-chips .av-voice-chip')].map(c => c.dataset.voice));
  if (!topIds.has(id) && id !== '') {
    const voices = _avAllVoices || [];
    const picked = voices.find(v => v.id === id);
    if (picked) {
      // 把 picked 置顶
      const reordered = [voices.find(v => v.id === '') || { id:'', name:'自动' }, picked, ...voices.filter(v => v.id !== '' && v.id !== id)];
      renderAvatarVoiceChips(reordered);
    }
  }
  closeVoicePicker();
  showToast(`已选择音色：${name}`, 'success');
}

let avPreviewAudioPlaying = false;
async function previewAvatarVoice(voiceId, gender, btnEl) {
  if (avPreviewAudioPlaying) {
    const audio = document.getElementById('av-voice-preview-audio');
    if (audio) { audio.pause(); audio.currentTime = 0; }
    document.querySelectorAll('.av-voice-preview-btn.playing').forEach(b => { b.textContent = '▶'; b.classList.remove('playing'); });
    avPreviewAudioPlaying = false;
    return;
  }
  btnEl.textContent = '...';
  btnEl.classList.add('playing');
  try {
    const r = await authFetch('/api/avatar/preview-voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceId, gender, text: '大家好，欢迎来到我的频道。' }),
    });
    if (!r.ok) {
      let errMsg = '试听失败';
      try { const j = await r.json(); errMsg = j.error || errMsg; } catch {}
      throw new Error(errMsg);
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const audio = document.getElementById('av-voice-preview-audio');
    audio.src = url;
    audio.play();
    avPreviewAudioPlaying = true;
    btnEl.textContent = '⏹';
    audio.onended = () => {
      avPreviewAudioPlaying = false;
      btnEl.textContent = '▶';
      btnEl.classList.remove('playing');
      URL.revokeObjectURL(url);
    };
  } catch (e) {
    showToast('试听失败: ' + e.message, 'error');
    btnEl.textContent = '▶';
    btnEl.classList.remove('playing');
  }
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
    : (_lastAvModelHint || '智谱 CogVideoX · 预计 1~3 分钟');

  return `<div class="av-progress-wrap">
    <div class="av-spinner"></div>
    <div class="av-progress-status" id="av-gen-status">${esc(statusMsg || '正在生成...')}</div>
    <div class="av-progress-sub">${subText}</div>
    ${segProgressHTML}
    <div class="av-progress-steps">${stepsHTML}</div>
  </div>`;
}

// ═══ 背景音乐 ═══
let avatarBgmFile = null;
let avatarBgmUrl = null;

async function handleAvatarBgm(input) {
  if (!input.files?.[0]) return;
  const file = input.files[0];
  avatarBgmFile = file;

  // 上传到服务器
  const fd = new FormData();
  fd.append('audio', file);
  try {
    const r = await authFetch('/api/avatar/upload-audio', { method: 'POST', body: fd });
    const j = await r.json();
    if (j.filename || j.path) {
      avatarBgmUrl = j.path || `/api/avatar/audios/${j.filename}`;
      document.getElementById('av-bgm-area').style.display = 'none';
      document.getElementById('av-bgm-loaded').style.display = '';
      document.getElementById('av-bgm-name').textContent = file.name;
    }
  } catch (e) { showToast('BGM 上传失败: ' + e.message, 'error'); }
  input.value = '';
}

function removeAvatarBgm() {
  avatarBgmFile = null;
  avatarBgmUrl = null;
  document.getElementById('av-bgm-area').style.display = '';
  document.getElementById('av-bgm-loaded').style.display = 'none';
}

// ═══ 花字特效 ═══
let avTextEffects = [];

// 自定义花字输入 modal
function openTextEffectModal({ title, defaultText, style, position }) {
  return new Promise(resolve => {
    let modal = document.getElementById('te-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'te-modal';
    modal.className = 'te-modal';
    const styleOptions = [
      { v: 'title',    name: '标题花字',   icon: '📝', desc: '大号·描边·阴影' },
      { v: 'price',    name: '价格标签',   icon: '💰', desc: '红色·醒目' },
      { v: 'promo',    name: '促销文字',   icon: '🔥', desc: '橙色·带框' },
      { v: 'subtitle', name: '字幕',       icon: '💬', desc: '底部·半透明框' },
      { v: 'emphasis', name: '强调',       icon: '⚡', desc: '闪光·描边' },
    ];
    const posOptions = [
      { v: 'top',    name: '顶部', icon: '⬆️' },
      { v: 'center', name: '中央', icon: '⏺️' },
      { v: 'bottom', name: '底部', icon: '⬇️' },
    ];
    modal.innerHTML = `
      <div class="te-backdrop"></div>
      <div class="te-panel">
        <div class="te-hd">
          <span class="te-title">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="color:var(--accent)"><path d="M2 3h10M4 3v8M7 3v8M10 3v8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            ${title || '添加花字特效'}
          </span>
          <button class="te-close" onclick="closeTextEffectModal(null)">×</button>
        </div>
        <div class="te-body">
          <label class="te-label">文字内容</label>
          <input type="text" class="te-input" id="te-text" value="${escapeHtml(defaultText || '')}" placeholder="输入要显示的文字..." />

          <label class="te-label">样式</label>
          <div class="te-grid">
            ${styleOptions.map(o => `
              <div class="te-card ${o.v === (style||'title') ? 'active' : ''}" data-style="${o.v}">
                <div class="te-card-icon">${o.icon}</div>
                <div class="te-card-name">${o.name}</div>
                <div class="te-card-desc">${o.desc}</div>
              </div>
            `).join('')}
          </div>

          <label class="te-label">位置</label>
          <div class="te-pos-row">
            ${posOptions.map(o => `
              <div class="te-pos ${o.v === (position||'top') ? 'active' : ''}" data-pos="${o.v}">
                ${o.icon} ${o.name}
              </div>
            `).join('')}
          </div>
        </div>
        <div class="te-ft">
          <button class="te-btn-cancel" onclick="closeTextEffectModal(null)">取消</button>
          <button class="te-btn-ok" onclick="submitTextEffect()">添加</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    // 样式卡片点击
    modal.querySelectorAll('.te-card').forEach(c => {
      c.addEventListener('click', () => {
        modal.querySelectorAll('.te-card').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
      });
    });
    // 位置切换
    modal.querySelectorAll('.te-pos').forEach(p => {
      p.addEventListener('click', () => {
        modal.querySelectorAll('.te-pos').forEach(x => x.classList.remove('active'));
        p.classList.add('active');
      });
    });
    modal.querySelector('.te-backdrop').addEventListener('click', () => closeTextEffectModal(null));
    document.addEventListener('keydown', teEscHandler);

    requestAnimationFrame(() => { modal.classList.add('open'); document.getElementById('te-text')?.focus(); });

    window._teResolve = resolve;
  });
}
function teEscHandler(e) {
  if (e.key === 'Escape') closeTextEffectModal(null);
  if (e.key === 'Enter' && e.target.id === 'te-text') submitTextEffect();
}
function submitTextEffect() {
  const modal = document.getElementById('te-modal');
  if (!modal) return;
  const text = (document.getElementById('te-text')?.value || '').trim();
  const style = modal.querySelector('.te-card.active')?.dataset?.style || 'title';
  const position = modal.querySelector('.te-pos.active')?.dataset?.pos || 'top';
  closeTextEffectModal(text ? { text, style, position } : null);
}
function closeTextEffectModal(result) {
  const modal = document.getElementById('te-modal');
  if (modal) { modal.classList.remove('open'); setTimeout(() => modal.remove(), 200); }
  document.removeEventListener('keydown', teEscHandler);
  if (window._teResolve) { window._teResolve(result); window._teResolve = null; }
}

async function addAvatarTextEffect() {
  const r = await openTextEffectModal({ title: '添加花字特效', defaultText: '', style: 'title', position: 'top' });
  if (!r) return;
  avTextEffects.push({ text: r.text, style: r.style, position: r.position === 'top' ? 'top-center' : (r.position === 'bottom' ? 'bottom-center' : 'center') });
  renderTextEffects();
}
async function addTextEffectPreset(type) {
  const presets = {
    title:    { text: '标题文字',  style: 'title',    position: 'top' },
    price:    { text: '¥99.9',     style: 'price',    position: 'center' },
    promo:    { text: '限时 5 折', style: 'promo',    position: 'top' },
    subtitle: { text: '字幕内容',  style: 'subtitle', position: 'bottom' },
    emphasis: { text: '重点强调',  style: 'emphasis', position: 'center' },
  };
  const p = presets[type] || presets.title;
  const r = await openTextEffectModal({ title: `添加 ${p.text}`, defaultText: p.text, style: p.style, position: p.position });
  if (!r) return;
  avTextEffects.push({ text: r.text, style: r.style, position: r.position === 'top' ? 'top-center' : (r.position === 'bottom' ? 'bottom-center' : 'center') });
  renderTextEffects();
}
function renderTextEffects() {
  const el = document.getElementById('av-text-effects');
  if (!el) return;
  if (!avTextEffects.length) { el.innerHTML = '<div class="av-fx-hint">点击添加花字、价格标签、促销文字</div>'; return; }
  el.innerHTML = avTextEffects.map((e, i) => `
    <div class="av-fx-item"><span style="font-weight:700">${e.style}</span> ${escapeHtml(e.text)} <span class="av-fx-item-del" onclick="avTextEffects.splice(${i},1);renderTextEffects()">×</span></div>
  `).join('');
}

// ═══ 产品贴图 ═══
let avProductStickers = [];
function handleProductUpload(input) {
  if (!input.files?.length) return;
  for (const file of input.files) {
    const url = URL.createObjectURL(file);
    avProductStickers.push({ name: file.name, url, file });
  }
  renderProductStickers();
  input.value = '';
}
function renderProductStickers() {
  const el = document.getElementById('av-product-stickers');
  if (!el) return;
  if (!avProductStickers.length) { el.innerHTML = '<div class="av-fx-hint">上传产品图片叠加到视频上</div>'; return; }
  el.innerHTML = avProductStickers.map((s, i) => `
    <div class="av-fx-item"><img src="${s.url}" style="width:24px;height:24px;border-radius:4px;object-fit:cover"> ${escapeHtml(s.name.slice(0,15))} <span class="av-fx-item-del" onclick="avProductStickers.splice(${i},1);renderProductStickers()">×</span></div>
  `).join('');
}

// ═══ 招引动画 ═══
let avGuideAnims = [];
// 每种类型的默认位置（更合理的 UI 位置）
const GUIDE_DEFAULT_POS = {
  arrow:   'bottom-center',  // 箭头指向下方 CTA
  finger:  'bottom-center',  // 手指指下方
  fire:    'top-center',     // 火焰贴在顶部标题旁
  sparkle: 'top-center',     // 闪光点缀标题
  circle:  'center',         // 圈注主体
};
const GUIDE_LABELS = { arrow: '⬇ 箭头', finger: '👆 手指', fire: '🔥 火焰', sparkle: '✨ 闪光', circle: '⭕ 圈注' };
const POS_LABELS = {
  'top-left': '左上', 'top-center': '顶部', 'top-right': '右上',
  'center': '中央', 'bottom-left': '左下', 'bottom-center': '底部', 'bottom-right': '右下',
};

function addGuideAnimation() {
  addGuidePreset('arrow');
}
function addGuidePreset(type) {
  avGuideAnims.push({
    type,
    label: GUIDE_LABELS[type] || type,
    position: GUIDE_DEFAULT_POS[type] || 'bottom-center',
  });
  renderGuideAnims();
}
function renderGuideAnims() {
  const el = document.getElementById('av-guide-anims');
  if (!el) return;
  if (!avGuideAnims.length) { el.innerHTML = '<div class="av-fx-hint">添加箭头、手指、火焰等招引动画</div>'; return; }
  el.innerHTML = avGuideAnims.map((a, i) => {
    // 兜底：老数据可能没 position，补默认
    if (!a.position) a.position = GUIDE_DEFAULT_POS[a.type] || 'bottom-center';
    const posZh = POS_LABELS[a.position] || a.position;
    return `<div class="av-fx-item">${a.label} <span style="font-size:9px;color:var(--text3)">位置: ${posZh}</span> <span class="av-fx-item-del" onclick="avGuideAnims.splice(${i},1);renderGuideAnims()">×</span></div>`;
  }).join('');
}

// ═══ 快捷模板 ═══
function applyAvatarTemplate(type) {
  const templates = {
    sell: { text: '家人们看过来！这款产品真的太好用了，原价199现在只要99！赶紧下单，库存不多了！点击下方链接购买。', effects: [{ text: '¥99', style: 'price' }, { text: '原价¥199', style: 'promo' }], guide: [{ type: 'finger', label: '👆 手指', position: 'bottom-center' }] },
    promo: { text: '限时活动来了！全场5折起，满200减50！活动仅限今天，错过就没了！', effects: [{ text: '限时5折', style: 'promo' }, { text: '满200减50', style: 'emphasis' }], guide: [{ type: 'fire', label: '🔥 火焰', position: 'top-center' }] },
    tutorial: { text: '大家好，今天教大家一个非常实用的技巧。首先打开设置，然后找到这个选项，按照我的步骤操作就可以了。', effects: [{ text: '实用教程', style: 'title' }], guide: [{ type: 'arrow', label: '⬇ 箭头', position: 'bottom-center' }] },
  };
  const tpl = templates[type];
  if (!tpl) return;
  // 填充文字
  const ta = document.querySelector('#av-drive-text textarea');
  if (ta) ta.value = tpl.text;
  // 填充花字
  avTextEffects = tpl.effects || [];
  renderTextEffects();
  // 填充招引动画
  avGuideAnims = tpl.guide || [];
  renderGuideAnims();
  showToast(`已应用${type === 'sell' ? '带货' : type === 'promo' ? '促销' : '教程'}模板`, 'ok');
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

  // —— 新 pipeline 分支：即梦 Omni（+ 可选百度抠像换背景）——
  if (model === 'jimeng-omni-matte' || model === 'jimeng-omni-raw') {
    // 用户上传了自定义背景（图或视频）→ 不管选的哪个 Omni 变体，都强制走抠像合成，
    // 否则背景上传了却不体现在成片里（之前的 bug）
    const userHasCustomBg = (avatarBg === 'custom') && (avatarBgImageUrl || avatarBgVideoUrl);
    // 同理：用户选了非 office 预设背景（studio/classroom/outdoor）也应该 compose 进去
    const nonDefaultPresetBg = ['studio', 'classroom', 'outdoor'].includes(avatarBg);
    const doMatting = model === 'jimeng-omni-matte' || userHasCustomBg || nonDefaultPresetBg;
    return startAvatarJimengOmni({
      text, avatar, voiceId, btn, resetBtn,
      doMatting,
    });
  }

  // 非 Omni 路径：如果用户上传了自定义背景却选了 Hedra/Kling/CogVideoX 等普通模型，
  // 这些模型只能把背景写进 prompt，不会真的抠像合成。给个一次性提示，避免用户不知道。
  if (avatarBg === 'custom' && (avatarBgImageUrl || avatarBgVideoUrl)) {
    if (!window._warnedNonOmniBg) {
      window._warnedNonOmniBg = true;
      alert('检测到你上传了自定义背景，但当前选的是非即梦-Omni 模型 —— 这类模型只会把背景描述进提示词，不会做真实抠像合成。\n\n要把背景真正替换到成片里，请在"数字人模型"里改选 ⭐ 即梦 Omni（照片级·口型最准）');
    }
  }

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
    // 预上传产品贴图文件（blob URL 不能发给后端）
    const uploadedStickers = [];
    for (const s of (avProductStickers || [])) {
      if (s.uploaded_path) { uploadedStickers.push({ path: s.uploaded_path, name: s.name }); continue; }
      if (!s.file) continue;
      try {
        const fd = new FormData();
        fd.append('image', s.file);
        const upResp = await authFetch('/api/avatar/upload-image', { method: 'POST', body: fd });
        const upData = await upResp.json();
        if (upData.filename) {
          s.uploaded_path = upData.path; // 缓存避免重复上传
          uploadedStickers.push({ path: upData.path, name: s.name });
        }
      } catch (e) { console.warn('[sticker upload]', e.message); }
    }

    const emotionIntensityPct = parseInt(document.getElementById('av-emotion-intensity')?.value || '50');
    const res = await authFetch('/api/avatar/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        avatar, text, voiceId, speed, ratio: avatarRatio, model,
        title: document.getElementById('av-title-input')?.value?.trim() || '',
        expression: document.getElementById('av-expression')?.value || 'natural',
        background: avatarBg || 'office',
        segments: (avatarSegments && avatarSegments.length > 1) ? avatarSegments : undefined,
        bgm: avatarBgmUrl || undefined,
        voiceVolume: parseFloat(document.getElementById('av-voice-vol')?.value || '1.0'),
        bgmVolume: parseFloat(document.getElementById('av-bgm-vol')?.value || '0.15'),
        // 后期特效（花字 / 产品贴图 / 招引动画）
        textEffects: avTextEffects || [],
        stickers: uploadedStickers,
        pointers: avGuideAnims || [],
        // P1/P2: 结构化运镜 + 情绪数值 + 视频背景抠像
        camera: avatarCamera || 'medium',
        emotion: avatarEmotion || 'neutral',
        emotion_intensity: emotionIntensityPct / 100,
        backgroundVideo: (avatarBg === 'green' && avatarBgVideoUrl) ? avatarBgVideoUrl : undefined,
        // P8: 用户追加的 prompt 片段
        customPromptSuffix: document.getElementById('av-custom-prompt-suffix')?.value?.trim() || '',
        // P0: 身位构图 + 多机位参考图
        bodyFrame: avatarBodyFrame || 'head_shoulders',
        multiAngleImages: (avatarMultiAngleImages && Object.keys(avatarMultiAngleImages).length > 0) ? avatarMultiAngleImages : undefined,
        // 用户在中文 prompt 框里编辑过 → 送 EN（LLM 翻译结果）给 I2V
        promptOverride: _promptUserEdited && avatarPromptEn ? avatarPromptEn : undefined,
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

// ═══════════════════════════════════════════════
// 即梦 Omni 新 pipeline（照片级抠像 + 换背景）
// ═══════════════════════════════════════════════

// 把主 Studio 的 avatarSelected（预设 ID 或 /api/avatar/images/... 路径）转成完整 URL
function _avatarToImageUrl(avatarValue) {
  if (!avatarValue) return '';
  if (/^https?:\/\//i.test(avatarValue)) return avatarValue;
  if (avatarValue.startsWith('/')) return window.location.origin + avatarValue;
  // 预设 ID，如 female-1 → /api/avatar/preset-img/avatar_female-1.png
  return `${window.location.origin}/api/avatar/preset-img/avatar_${avatarValue}.png`;
}

// 把主 Studio 的 avatarBg（office/studio/classroom/outdoor/green/custom）转成公网 URL 供 /compose 使用
async function _avatarBgToUrlMain() {
  const bg = (typeof avatarBg !== 'undefined' && avatarBg) ? avatarBg : 'office';
  const origin = window.location.origin;

  // green 绿幕 → 客户端画一张 720×1280 纯绿 PNG 上传
  if (bg === 'green') {
    const canvas = document.createElement('canvas');
    canvas.width = 720; canvas.height = 1280;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#00b140';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const fd = new FormData();
    fd.append('bg', new File([blob], 'green.png', { type: 'image/png' }));
    const r = await authFetch('/api/avatar/jimeng-omni/upload-matte', { method: 'POST', body: fd });
    const d = await r.json();
    return d?.bg_url || null;
  }
  // 自定义（已上传视频/图片）：优先用视频，再用图片
  if (bg === 'custom') {
    if (typeof avatarBgVideoUrl !== 'undefined' && avatarBgVideoUrl) {
      return avatarBgVideoUrl.startsWith('http') ? avatarBgVideoUrl : (origin + avatarBgVideoUrl);
    }
    if (typeof avatarBgImageUrl !== 'undefined' && avatarBgImageUrl) {
      return avatarBgImageUrl.startsWith('http') ? avatarBgImageUrl : (origin + avatarBgImageUrl);
    }
    return null; // 还没上传就跳过背景（不至于崩）
  }
  const presetMap = { office: 'bg_office', studio: 'bg_studio', classroom: 'bg_classroom', outdoor: 'bg_outdoor' };
  const name = presetMap[bg];
  if (name) return `${origin}/api/avatar/preset-img/${name}.png`;
  return null;
}

async function startAvatarJimengOmni({ text, avatar, voiceId, btn, resetBtn, doMatting }) {
  const previewBox = document.getElementById('av-preview-box');
  // 即梦 Omni 不走老 pipeline 的分段，清掉分段状态避免 UI hint 混淆
  if (typeof avatarSegments !== 'undefined') { avatarSegments = null; if (typeof renderAvatarSegments === 'function') renderAvatarSegments(); if (typeof updateAvatarGenHint === 'function') updateAvatarGenHint(); }
  // Omni 对音频时长敏感，~150 字以上易触发 504 网关超时
  if (text && text.length > 200) {
    const ok = confirm(`⚠️ 文案 ${text.length} 字（约 ${Math.round(text.length / 4)} 秒），即梦 Omni 对 60 秒以上音频成功率下降。\n\n建议用 ✨ AI 写稿 选 30/45 秒时长重写。\n\n继续用当前文案提交？`);
    if (!ok) { resetBtn(); return; }
  }
  previewBox.innerHTML = renderProgressUI('start', '即梦 Omni：提交生成任务...');
  try {
    // 全身构图优先用扩图后的全身版（avatarFullBodyUrl），否则回退到原图
    let imageUrl;
    if ((typeof avatarBodyFrame !== 'undefined' && avatarBodyFrame === 'full_body') && avatarFullBodyUrl) {
      imageUrl = avatarFullBodyUrl.startsWith('http') ? avatarFullBodyUrl : (window.location.origin + avatarFullBodyUrl);
      console.log('[Omni] 使用全身扩图版:', imageUrl);
    } else {
      imageUrl = _avatarToImageUrl(avatar);
    }
    if (!imageUrl) throw new Error('无法解析形象图 URL');
    // 如果用户选了 full_body 但扩图没好，给个提示（避免用户看到半身结果懵）
    if (avatarBodyFrame === 'full_body' && !avatarFullBodyUrl) {
      const ok = confirm('⚠️ 你选了"全身"构图，但全身扩图还没生成好。\n\n即梦 Omni 不会自动扩图，现在继续的话，输入图是半身照就只会出半身视频（没有腿）。\n\n点"确定"继续用原图，点"取消"后我帮你等扩图完成');
      if (!ok) {
        resetBtn();
        ensureFullBodyOutpaint();
        return;
      }
    }
    // 读取速度 + 身位 + 自定义 prompt 后缀，一并传给后端
    const speed = parseFloat(document.getElementById('av-speed-range')?.value) || 1.0;
    const bodyFrameHintMap = {
      head_shoulders: '头肩特写镜头，面部占画面 60% 以上',
      half_body: '半身镜头，腰部以上可见，双手偶尔入画',
      full_body: '全身镜头，整个人物从头到脚在画面中，看到身体动作',
    };
    const bodyFrame = typeof avatarBodyFrame !== 'undefined' ? avatarBodyFrame : 'head_shoulders';
    const customSuffix = document.getElementById('av-custom-prompt-suffix')?.value?.trim() || '';
    const promptHint = [bodyFrameHintMap[bodyFrame], customSuffix].filter(Boolean).join('，');
    // 预上传产品贴图（blob: URL 不能发给后端）
    const uploadedStickers = [];
    for (const s of (typeof avProductStickers !== 'undefined' ? (avProductStickers || []) : [])) {
      if (s.uploaded_path) { uploadedStickers.push({ path: s.uploaded_path, name: s.name }); continue; }
      if (!s.file) continue;
      try {
        const fd = new FormData();
        fd.append('image', s.file);
        const upResp = await authFetch('/api/avatar/upload-image', { method: 'POST', body: fd });
        const upData = await upResp.json();
        if (upData.filename) {
          s.uploaded_path = upData.path;
          uploadedStickers.push({ path: upData.path, name: s.name });
        }
      } catch (e) { console.warn('[sticker upload]', e.message); }
    }
    const body = {
      image_url: imageUrl, text, voiceId, speed, prompt: promptHint,
      // 后期特效透传（Omni 原生成片后 OR 抠像合成后会再叠一层 FFmpeg）
      textEffects: (typeof avTextEffects !== 'undefined' ? (avTextEffects || []) : []),
      stickers: uploadedStickers,
      pointers: (typeof avGuideAnims !== 'undefined' ? (avGuideAnims || []) : []),
    };
    const res = await authFetch('/api/avatar/jimeng-omni/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.success || !data.taskId) throw new Error(data.error || '提交失败');
    previewBox.innerHTML = renderProgressUI('run', doMatting ? '即梦 Omni 生成中（约 4-5 分钟）...' : '即梦 Omni 生成中...');
    pollAvatarJimengOmni(data.taskId, { doMatting, btn, resetBtn, previewBox, text, omniTaskId: data.taskId, uploadedStickers });
  } catch (err) {
    previewBox.innerHTML = `<div class="av-error-box">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="18" stroke="var(--accent)" stroke-width="1.5"/><path d="M20 12v10M20 26v1" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/></svg>
      <div class="av-error-msg">${esc(err.message)}</div>
      <button class="av-error-retry" onclick="restoreAvatarPipeline && restoreAvatarPipeline()">关闭</button>
      <button class="av-error-retry" style="border-color:var(--accent);color:var(--accent)" onclick="startAvatarGeneration()">重试</button>
    </div>`;
    resetBtn();
  }
}

async function pollAvatarJimengOmni(taskId, ctx) {
  try {
    const res = await authFetch(`/api/avatar/jimeng-omni/tasks/${taskId}`);
    const data = await res.json();
    const t = data.task || {};
    if (t.status === 'done' && t.video_url) {
      if (ctx.doMatting) {
        ctx.previewBox.innerHTML = renderProgressUI('tts', '即梦 Omni 完成，开始百度抠像...');
        return startAvatarComposeMain(t.video_url, ctx);
      }
      return _renderAvatarOmniResult(t.video_url, ctx);
    }
    if (t.status === 'error') {
      ctx.previewBox.innerHTML = `<div class="av-error-box">
        <div class="av-error-msg">${esc(t.error || '失败')}</div>
        <button class="av-error-retry" onclick="startAvatarGeneration()">重试</button>
      </div>`;
      ctx.resetBtn();
      return;
    }
    // 阶段映射：prepare_* → start（准备），submitting/processing/generating → video（生成）
    const stage = t.stage || '';
    let stepKey = 'start';
    if (stage.startsWith('prepare_') || stage === 'detecting' || stage === 'submitting') stepKey = 'start';
    else if (t.cv_status === 'generating' || t.cv_status === 'processing' || t.cv_status === 'in_queue') stepKey = 'video';
    else stepKey = 'video';
    const hint = t.cv_status ? `即梦 ${t.cv_status}` : (stage || '处理中');
    ctx.previewBox.innerHTML = renderProgressUI(stepKey, `即梦 Omni：${esc(hint)}`);
    setTimeout(() => pollAvatarJimengOmni(taskId, ctx), 3000);
  } catch (e) {
    setTimeout(() => pollAvatarJimengOmni(taskId, ctx), 5000);
  }
}

async function startAvatarComposeMain(sourceVideoUrl, ctx) {
  try {
    const bgUrl = await _avatarBgToUrlMain();
    if (!bgUrl) {
      // 没选背景 → 直接作为完成
      return _renderAvatarOmniResult(sourceVideoUrl, ctx);
    }
    // 把 omni_task_id 传给 compose，让它继承 post_effects；同时也直接塞一份（双保险）
    const body = {
      source: sourceVideoUrl,
      bg: bgUrl, width: 720, height: 1280, scaleMode: 'cover',
      omni_task_id: ctx.omniTaskId || undefined,
      textEffects: (typeof avTextEffects !== 'undefined' ? (avTextEffects || []) : []),
      stickers: (ctx.uploadedStickers || []),
      pointers: (typeof avGuideAnims !== 'undefined' ? (avGuideAnims || []) : []),
    };
    const res = await authFetch('/api/avatar/jimeng-omni/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.success || !data.taskId) throw new Error(data.error || '抠像提交失败');
    ctx.matteTaskId = data.taskId;
    ctx.previewBox.innerHTML = renderProgressUI('run', '开始抠像，约 2 分钟...');
    pollAvatarComposeMain(data.taskId, ctx);
  } catch (err) {
    ctx.previewBox.innerHTML = `<div class="av-error-box">
      <div class="av-error-msg">抠像合成失败：${esc(err.message)}</div>
      <button class="av-error-retry" onclick="startAvatarGeneration()">重试</button>
    </div>`;
    ctx.resetBtn();
  }
}

async function pollAvatarComposeMain(taskId, ctx) {
  try {
    const res = await authFetch(`/api/avatar/jimeng-omni/matte-tasks/${taskId}`);
    const data = await res.json();
    const t = data.task || {};
    if (t.status === 'done' && t.output_url) {
      return _renderAvatarOmniResult(t.output_url, ctx);
    }
    if (t.status === 'error') {
      ctx.previewBox.innerHTML = `<div class="av-error-box">
        <div class="av-error-msg">${esc(t.error || '失败')}</div>
        <button class="av-error-retry" onclick="startAvatarGeneration()">重试</button>
      </div>`;
      ctx.resetBtn();
      return;
    }
    // 抠像走 "tts" 槽位（借用作为"抠像"阶段，视觉上是第 3 步）
    // compose_start / composing → "merge" 槽位（第 4 步：合成）
    const stage = t.stage || '';
    let stepKey = 'tts';
    if (stage === 'encoding_matte_mov' || stage === 'composing' || stage === 'compose_start') stepKey = 'merge';
    const hint = t.matte_done
      ? `抠像 ${t.matte_done}/${t.matte_total}`
      : (stage === 'composing' ? 'FFmpeg 合成背景...' : (stage || '处理中'));
    ctx.previewBox.innerHTML = renderProgressUI(stepKey, `合成：${esc(hint)}`);
    setTimeout(() => pollAvatarComposeMain(taskId, ctx), 3000);
  } catch (e) {
    setTimeout(() => pollAvatarComposeMain(taskId, ctx), 5000);
  }
}

function _renderAvatarOmniResult(videoUrl, ctx) {
  // Omni 的 video_url 已经是 /public/jimeng-assets/xxx.mp4，直接可下载不需要 token
  // 同时给个"保存到我的作品"提示（实际上后端已经持久化到 avatar_db 了）
  const taskId = ctx.matteTaskId || ctx.omniTaskId || '';
  ctx.previewBox.innerHTML = `
    <div class="av-result-wrap">
      <video class="av-result-video" controls autoplay playsinline>
        <source src="${videoUrl}" type="video/mp4" />
      </video>
      <div style="font-size:10px;color:#22c55e;margin:6px 2px 2px;padding:5px 8px;background:rgba(34,197,94,.08);border-radius:6px;">
        ✓ 已自动保存到"我的作品"（任务ID ${taskId ? taskId.slice(0,8) : '—'}）
      </div>
      <div class="av-result-actions">
        <a href="${videoUrl}" download="avatar_${taskId.slice(0,8) || Date.now()}.mp4" class="av-action-btn av-action-btn-primary">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v8M3 6.5l3.5 3.5 3.5-3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          下载视频
        </a>
        <a href="#works" onclick="event.preventDefault();if(typeof switchPage==='function')switchPage('works');" class="av-action-btn av-action-btn-ghost">
          📁 去"我的作品"
        </a>
        <button class="av-action-btn av-action-btn-regen" onclick="startAvatarGeneration()">
          重新生成
        </button>
      </div>
    </div>`;
  if (typeof addAvatarHistory === 'function') {
    try { addAvatarHistory({ taskId, text: ctx.text, videoUrl, voiceId: '', ratio: avatarRatio, model: ctx.doMatting ? 'jimeng-omni-matte' : 'jimeng-omni-raw' }); } catch {}
  }
  ctx.resetBtn();
}

// ✨ AI 按主题写口播稿（黄金 4 段结构）— 主题风格浮窗
function aiWriteAvatarScriptMain(btn) {
  // 防止重复打开
  if (document.getElementById('omni-write-modal')) return;

  const ta = document.getElementById('av-text-input');
  const existingDraft = ta?.value?.trim() || '';
  // 从当前活跃的模板 chip 推断默认题材
  const activeTpl = document.querySelector('.av-tpl-chip.active')?.dataset?.tpl || '';

  // 样式（只注入一次）
  if (!document.getElementById('omni-write-modal-style')) {
    const style = document.createElement('style');
    style.id = 'omni-write-modal-style';
    style.textContent = `
      .omni-modal-mask {
        position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,.58); backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center; animation: omniFadeIn .18s ease;
      }
      @keyframes omniFadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes omniSlideUp { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .omni-modal {
        background: var(--bg2, #14151a); border: 1px solid var(--border2, rgba(255,255,255,.09));
        border-radius: 14px; width: 520px; max-width: calc(100vw - 32px);
        box-shadow: 0 20px 60px rgba(0,0,0,.5); overflow: hidden; animation: omniSlideUp .22s ease;
      }
      .omni-modal-head {
        padding: 16px 20px 12px; display: flex; align-items: center; justify-content: space-between;
        border-bottom: 1px solid var(--border, rgba(255,255,255,.05));
      }
      .omni-modal-title { font-size: 15px; font-weight: 600; color: var(--text, #E8E9ED); display: flex; align-items: center; gap: 8px; }
      .omni-modal-sub { font-size: 11px; color: var(--text3, #666); margin-top: 2px; }
      .omni-modal-close { background: transparent; border: none; color: var(--text3); font-size: 20px; cursor: pointer; line-height: 1; padding: 2px 6px; border-radius: 4px; }
      .omni-modal-close:hover { background: var(--bg3); color: var(--text); }
      .omni-modal-body { padding: 16px 20px; }
      .omni-field-label { font-size: 12px; color: var(--text2, #c1c5d0); margin-bottom: 6px; font-weight: 500; }
      .omni-field-label .req { color: #ff6b9a; margin-left: 3px; }
      .omni-input, .omni-select {
        width: 100%; background: var(--bg, #0D0E12); border: 1px solid var(--border2);
        color: var(--text); padding: 10px 12px; border-radius: 8px; font-size: 13px;
        outline: none; box-sizing: border-box; transition: border-color .15s;
      }
      .omni-input:focus, .omni-select:focus { border-color: var(--accent, #7c6cf0); }
      .omni-row { display: flex; gap: 10px; }
      .omni-row > * { flex: 1; }
      .omni-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
      .omni-chip {
        padding: 6px 10px; border-radius: 999px; border: 1px solid var(--border2);
        background: var(--bg3, #1c1e29); color: var(--text2); font-size: 11px; cursor: pointer; transition: all .15s;
      }
      .omni-chip:hover { border-color: rgba(var(--accent-rgb,124,108,240),.5); color: var(--text); }
      .omni-chip.active { background: rgba(var(--accent-rgb,124,108,240),.18); border-color: var(--accent); color: var(--accent2, #9d8cf8); }
      .omni-modal-foot {
        padding: 12px 20px 16px; display: flex; gap: 8px; justify-content: flex-end;
        border-top: 1px solid var(--border); background: rgba(0,0,0,.15);
      }
      .omni-btn {
        padding: 8px 18px; border-radius: 8px; border: 1px solid var(--border2);
        background: var(--bg3); color: var(--text); font-size: 12px; cursor: pointer; transition: all .15s;
        display: inline-flex; align-items: center; gap: 6px;
      }
      .omni-btn:hover:not(:disabled) { border-color: var(--border2); background: var(--bg2); }
      .omni-btn:disabled { opacity: .5; cursor: not-allowed; }
      .omni-btn-primary {
        background: linear-gradient(135deg, var(--accent, #7c6cf0), var(--accent2, #9d8cf8));
        border-color: transparent; color: #fff; font-weight: 500;
      }
      .omni-btn-primary:hover:not(:disabled) { filter: brightness(1.1); }
      .omni-spinner {
        width: 12px; height: 12px; border: 2px solid rgba(255,255,255,.2); border-top-color: #fff;
        border-radius: 50%; animation: omniSpin .7s linear infinite;
      }
      @keyframes omniSpin { to { transform: rotate(360deg); } }
      .omni-hint { font-size: 11px; color: var(--text3); margin-top: 10px; line-height: 1.6; }
      .omni-preview {
        margin-top: 12px; padding: 10px 12px; background: var(--bg, #0D0E12); border-radius: 8px;
        font-size: 12px; color: var(--text2); line-height: 1.6; max-height: 160px; overflow-y: auto;
        border-left: 2px solid var(--accent); display: none;
      }
    `;
    document.head.appendChild(style);
  }

  // DOM
  const mask = document.createElement('div');
  mask.className = 'omni-modal-mask';
  mask.id = 'omni-write-modal';
  mask.innerHTML = `
    <div class="omni-modal" role="dialog">
      <div class="omni-modal-head">
        <div>
          <div class="omni-modal-title">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l2.1 4.3 4.7.7-3.4 3.3.8 4.7L8 12.3 3.8 14.5l.8-4.7L1.2 6.5l4.7-.7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
            AI 写稿向导
          </div>
          <div class="omni-modal-sub">按「钩子→立论→证据→CTA」黄金 4 段结构 · 可选时长与风格</div>
        </div>
        <button class="omni-modal-close" onclick="_closeOmniModal()" title="关闭">×</button>
      </div>
      <div class="omni-modal-body">
        <div class="omni-field-label">视频主题<span class="req">*</span></div>
        <input id="omni-topic-input" class="omni-input" placeholder="例如：3 招让 AI 数字人 3 秒涨粉·抖音实测有效" />
        <div class="omni-hint">💡 写清楚"给谁看 + 讲什么 + 想达到什么"，AI 会按 20s 口播节奏展开</div>

        <div style="margin-top:14px;" class="omni-row">
          <div>
            <div class="omni-field-label">时长</div>
            <select id="omni-duration" class="omni-select">
              <option value="15">15 秒（~60 字）</option>
              <option value="20" selected>20 秒（~80 字）</option>
              <option value="30">30 秒（~120 字）</option>
              <option value="45">45 秒（~180 字）</option>
              <option value="60">60 秒（~240 字）</option>
            </select>
          </div>
          <div>
            <div class="omni-field-label">语气风格</div>
            <select id="omni-style" class="omni-select">
              <option value="tutorial" ${activeTpl === 'knowledge' || activeTpl === 'tutorial' ? 'selected' : ''}>🎓 知识教程（理性、有节奏）</option>
              <option value="promo" ${activeTpl === 'promo' ? 'selected' : ''}>🛒 带货推广（有张力、催单感）</option>
              <option value="news" ${activeTpl === 'news' ? 'selected' : ''}>📰 新闻播报（客观、稳重）</option>
              <option value="story" ${activeTpl === 'story' ? 'selected' : ''}>📖 故事叙述（有情绪、有画面）</option>
              <option value="daily">💬 日常口语（亲切、轻松）</option>
            </select>
          </div>
        </div>

        <div style="margin-top:14px;">
          <div class="omni-field-label">快选主题</div>
          <div class="omni-chips" id="omni-preset-chips">
            <div class="omni-chip" data-topic="3 招让 AI 数字人 3 秒涨粉·抖音实测有效">3 招涨粉</div>
            <div class="omni-chip" data-topic="90% 的人都不知道的 AI 提示词秘笈">反常识秘笈</div>
            <div class="omni-chip" data-topic="新手 30 天学会 AI 视频剪辑路径">学习路径</div>
            <div class="omni-chip" data-topic="这款产品原价 199 现在 99 限时 3 天">限时带货</div>
            <div class="omni-chip" data-topic="为什么你拍的短视频没人看">痛点揭秘</div>
          </div>
        </div>

        <div id="omni-script-preview" class="omni-preview"></div>
      </div>
      <div class="omni-modal-foot">
        <button class="omni-btn" onclick="_closeOmniModal()">取消</button>
        <button class="omni-btn omni-btn-primary" id="omni-generate-btn" onclick="_submitOmniScript()">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l2 2 6-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          生成并填入
        </button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  // ESC 关闭
  mask.addEventListener('click', (e) => { if (e.target === mask) _closeOmniModal(); });
  // 快选主题
  mask.querySelectorAll('.omni-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      mask.querySelectorAll('.omni-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      document.getElementById('omni-topic-input').value = chip.dataset.topic;
    });
  });
  // 初始 focus
  setTimeout(() => document.getElementById('omni-topic-input')?.focus(), 100);
  // 记 ESC
  const escHandler = (e) => { if (e.key === 'Escape') _closeOmniModal(); };
  document.addEventListener('keydown', escHandler);
  mask._escHandler = escHandler;
  // 预填现有草稿到主题里（若用户之前在台词里写了东西）
  if (existingDraft && existingDraft.length < 80) {
    document.getElementById('omni-topic-input').value = existingDraft;
  }
}

function _closeOmniModal() {
  const m = document.getElementById('omni-write-modal');
  if (!m) return;
  if (m._escHandler) document.removeEventListener('keydown', m._escHandler);
  m.remove();
}

async function _submitOmniScript() {
  const topic = document.getElementById('omni-topic-input')?.value?.trim();
  const duration = parseInt(document.getElementById('omni-duration')?.value || '20', 10);
  const style = document.getElementById('omni-style')?.value || 'tutorial';
  if (!topic) {
    const inp = document.getElementById('omni-topic-input');
    inp?.focus();
    if (inp) { inp.style.borderColor = '#ff6b9a'; setTimeout(() => inp.style.borderColor = '', 1200); }
    return;
  }
  const genBtn = document.getElementById('omni-generate-btn');
  const preview = document.getElementById('omni-script-preview');
  genBtn.disabled = true;
  genBtn.innerHTML = '<span class="omni-spinner"></span> 生成中...';
  try {
    const r = await authFetch('/api/avatar/jimeng-omni/write-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, duration_sec: duration, style }),
    });
    const d = await r.json();
    if (!d.success || !d.script) throw new Error(d.error || 'AI 未返回');
    // 先显示预览 0.4s 再关窗
    if (preview) { preview.style.display = 'block'; preview.textContent = d.script; }
    // 填入台词
    const ta = document.getElementById('av-text-input');
    if (ta) {
      ta.value = d.script;
      ta.dispatchEvent(new Event('input'));
      ta.dispatchEvent(new Event('change'));
    }
    genBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l2 2 6-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> 已填入·正在分段...';
    // 关窗前自动触发智能分段（文字 > 30 时后端会拆）
    if (d.script.length >= 30 && typeof segmentAvatarScript === 'function') {
      try { await segmentAvatarScript(); } catch (e) { console.warn('自动分段失败', e); }
    }
    setTimeout(_closeOmniModal, 600);
  } catch (e) {
    genBtn.disabled = false;
    genBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l2 2 6-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> 重试';
    alert('AI 生成失败：' + e.message);
  }
}

// ═══════════════════════════════════════════════
// 升级版 Avatar Studio 状态（2026-04-17）
// ═══════════════════════════════════════════════

// 结构化运镜当前值
let avatarCamera = 'medium'; // 字符串预设 or 对象 {type, config, simple}
let avatarEmotion = 'neutral';
let avatarBgVideoUrl = ''; // 上传的背景视频 URL
let avatarBgImageUrl = ''; // 上传的背景静态图 URL（由 handleAvatarBgUpload 写入）
let avatarMode = 'single'; // 'single' | 'multi'
// P0: 身位构图 + 多机位参考图
let avatarBodyFrame = 'head_shoulders'; // 'head_shoulders' | 'half_body' | 'full_body'
let avatarMultiAngleImages = {};  // { front_medium?, side_45?, front_closeup? } URL 映射
let multiAnglePollTimer = null;
let avatarFullBodyUrl = '';  // 当 bodyFrame='full_body' 时，通过 i2i 扩图得到的全身版 avatar URL（给 Omni 用）
let _fullBodyInFlight = false;

function selectBodyFrame(btn, bf) {
  document.querySelectorAll('#av-body-frame-grid .av-cam-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  avatarBodyFrame = bf;
  // 切换身位后清掉之前的多机位缓存（旧身位的图不匹配了）
  if (Object.keys(avatarMultiAngleImages).length > 0) {
    const keep = confirm('切换身位后，已生成的多机位参考图可能不再匹配。是否保留？\n\n确定=保留；取消=清除并重新生成');
    if (!keep) clearMultiAngle();
  }
  if (bf === 'full_body') {
    ensureFullBodyOutpaint();
  } else {
    // 切回非 full_body，清掉扩图引用（避免误用）+ 隐藏进度块
    avatarFullBodyUrl = '';
    _updateFullBodyStatus({ show: false });
  }
  if (typeof refreshPromptPreview === 'function') refreshPromptPreview();
}

// UI helper：更新全身扩图状态块
function _updateFullBodyStatus({ show, title, icon, msg, pct, elapsed, thumbUrl, finalSuccess, finalError }) {
  const box = document.getElementById('av-fullbody-status');
  if (!box) return;
  if (show === false) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  const t = document.getElementById('av-fullbody-title'); if (t && title != null) t.textContent = title;
  const i = document.getElementById('av-fullbody-icon'); if (i && icon != null) i.textContent = icon;
  const m = document.getElementById('av-fullbody-msg'); if (m && msg != null) m.textContent = msg;
  const e = document.getElementById('av-fullbody-elapsed'); if (e && elapsed != null) e.textContent = elapsed + 's';
  const bar = document.getElementById('av-fullbody-bar');
  if (bar && pct != null) { bar.style.animation = 'none'; bar.style.width = Math.min(100, Math.max(5, pct)) + '%'; }
  const thumbWrap = document.getElementById('av-fullbody-thumb-wrap');
  const thumb = document.getElementById('av-fullbody-thumb');
  if (thumbUrl && thumbWrap && thumb) {
    thumb.src = thumbUrl.startsWith('http') ? thumbUrl : (window.location.origin + thumbUrl);
    thumbWrap.style.display = '';
  }
  if (finalSuccess) {
    box.style.borderColor = 'rgba(34,197,94,.4)';
    box.style.background = 'rgba(34,197,94,.08)';
    if (t) t.style.color = '#22c55e';
  } else if (finalError) {
    box.style.borderColor = 'rgba(239,68,68,.4)';
    box.style.background = 'rgba(239,68,68,.08)';
    if (t) t.style.color = '#ef4444';
  } else {
    box.style.borderColor = 'rgba(124,108,240,.25)';
    box.style.background = 'rgba(124,108,240,.08)';
    if (t) t.style.color = 'var(--accent)';
  }
}

// 触发/确保 avatar 的全身扩图完成（Omni 不会扩图，必须前置）
async function ensureFullBodyOutpaint() {
  const avatar = (typeof avatarSelected !== 'undefined' ? avatarSelected : '') ||
                 document.querySelector('.av-avatar-card.active')?.dataset?.avatar || '';
  if (!avatar || avatar === 'custom') return;
  if (_fullBodyInFlight) return;
  _fullBodyInFlight = true;
  const t0 = Date.now();
  _updateFullBodyStatus({ show: true, icon: '🦵', title: '全身扩图', msg: '准备提交任务...', pct: 5, elapsed: 0 });
  try {
    const r = await authFetch('/api/avatar/outpaint-fullbody', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error || '扩图启动失败');
    if (j.cached && j.image_url) {
      avatarFullBodyUrl = j.image_url;
      _updateFullBodyStatus({
        icon: '⚡', title: '全身扩图（缓存命中）', msg: '已复用之前生成的全身版，无需重跑',
        pct: 100, elapsed: 0, thumbUrl: j.image_url, finalSuccess: true,
      });
      _fullBodyInFlight = false;
      return;
    }
    // 轮询
    const taskId = j.taskId;
    _updateFullBodyStatus({ msg: '已提交到 Seedream i2i，排队中...', pct: 15 });
    let tries = 0;
    const poll = async () => {
      tries++;
      const elapsed = Math.round((Date.now() - t0) / 1000);
      try {
        const pr = await authFetch(`/api/avatar/outpaint-fullbody/${taskId}`);
        const pj = await pr.json();
        if (pj.task?.status === 'done' && pj.task.image_url) {
          avatarFullBodyUrl = pj.task.image_url;
          _updateFullBodyStatus({
            icon: '✅', title: `全身扩图完成 (${elapsed}s)`,
            msg: 'Omni 生成时将用这张扩图结果作为输入，成片会有完整的腿和脚',
            pct: 100, elapsed, thumbUrl: pj.task.image_url, finalSuccess: true,
          });
          _fullBodyInFlight = false;
          return;
        }
        if (pj.task?.status === 'error') {
          _updateFullBodyStatus({
            icon: '⚠️', title: '全身扩图失败',
            msg: (pj.task.error || '未知原因') + ' · 点"全身"可重试',
            pct: 100, elapsed, finalError: true,
          });
          _fullBodyInFlight = false;
          return;
        }
        // 进度条基于时间（典型 30-60s）估算推进
        const estPct = Math.min(85, 15 + elapsed * 1.5);
        _updateFullBodyStatus({ msg: `Seedream 5.0 i2i 处理中，保持脸部和服装不变...`, pct: estPct, elapsed });
      } catch (pollErr) {
        console.warn('[fullbody-poll]', pollErr);
      }
      if (tries > 40) {
        _updateFullBodyStatus({
          icon: '⏱', title: '扩图超时（>2 分钟）',
          msg: 'Seedream API 可能繁忙，可稍后重新点"全身"重试',
          pct: 100, elapsed, finalError: true,
        });
        _fullBodyInFlight = false;
        return;
      }
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 2000);
  } catch (err) {
    _fullBodyInFlight = false;
    _updateFullBodyStatus({
      icon: '⚠️', title: '扩图请求失败',
      msg: err.message, pct: 100, elapsed: Math.round((Date.now() - t0) / 1000), finalError: true,
    });
  }
}

async function generateMultiAngleSet() {
  const selectedAvEl = document.querySelector('.av-avatar-card.active');
  const avatar = selectedAvEl?.dataset?.avatar || (typeof avatarSelected !== 'undefined' ? avatarSelected : '');
  if (!avatar || avatar === 'custom') {
    showToast('请先选择数字人形象', 'warning');
    return;
  }
  const btn = document.getElementById('av-multi-angle-btn');
  const status = document.getElementById('av-multi-angle-status');
  btn.disabled = true;
  const origHtml = btn.innerHTML;
  btn.innerHTML = '<span class="av-spinner av-spinner-sm" style="display:inline-block;margin-right:4px"></span>生成中 (约 30s)...';
  status.style.display = 'block';
  status.textContent = '发起任务...';

  try {
    const r = await authFetch('/api/avatar/generate-multi-angle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar, bodyFrame: avatarBodyFrame, aspectRatio: (typeof avatarRatio !== 'undefined' ? avatarRatio : '9:16') }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error || '启动失败');
    // 轮询
    if (multiAnglePollTimer) clearInterval(multiAnglePollTimer);
    let tries = 0;
    multiAnglePollTimer = setInterval(async () => {
      tries++;
      try {
        const pr = await authFetch(`/api/avatar/multi-angle/${j.taskId}`);
        const pj = await pr.json();
        if (!pj.success) throw new Error(pj.error || '查询失败');
        const latestProgress = pj.progress?.[pj.progress.length - 1]?.message || '生成中...';
        status.textContent = `${latestProgress} (${tries * 3}s)`;
        if (pj.status === 'done') {
          clearInterval(multiAnglePollTimer);
          multiAnglePollTimer = null;
          avatarMultiAngleImages = pj.images || {};
          const successCount = Object.keys(avatarMultiAngleImages).length;
          const failedCount = (pj.failed || []).length;
          status.textContent = `完成：${successCount}/3 机位${failedCount ? `（${failedCount} 失败）` : ''}`;
          renderMultiAngleGrid();
          document.getElementById('av-multi-angle-clear').style.display = successCount > 0 ? 'inline-block' : 'none';
          btn.disabled = false;
          btn.innerHTML = origHtml;
          if (successCount > 0) showToast(`多机位 ${successCount}/3 张生成完成`, 'success');
          else showToast('多机位生成失败，请重试', 'error');
          if (typeof refreshPromptPreview === 'function') refreshPromptPreview();
        } else if (pj.status === 'error') {
          clearInterval(multiAnglePollTimer);
          multiAnglePollTimer = null;
          throw new Error(pj.error || '生成失败');
        } else if (tries > 160) {
          // 8 分钟还没完成（原来 3 分钟太短，即梦并发被占时会超时）
          clearInterval(multiAnglePollTimer);
          multiAnglePollTimer = null;
          throw new Error('超时（>8 分钟）— 即梦 API 可能并发被占');
        }
      } catch (pollErr) {
        clearInterval(multiAnglePollTimer);
        multiAnglePollTimer = null;
        status.textContent = '失败：' + pollErr.message;
        showToast('多机位失败：' + pollErr.message, 'error');
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }, 3000);
  } catch (err) {
    status.textContent = '失败：' + err.message;
    showToast('多机位失败：' + err.message, 'error');
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

function renderMultiAngleGrid() {
  const grid = document.getElementById('av-multi-angle-grid');
  if (!grid) return;
  const ANGLES = [
    { key: 'front_medium',  label: '正面中景', icon: '👤' },
    { key: 'side_45',       label: '45°侧面', icon: '↗️' },
    { key: 'front_closeup', label: '正面特写', icon: '🔍' },
  ];
  grid.innerHTML = ANGLES.map(a => {
    const url = avatarMultiAngleImages[a.key];
    if (url) {
      return `<div style="position:relative;aspect-ratio:3/4;background:var(--bg2);border:1px solid rgba(124,108,240,.35);border-radius:7px;overflow:hidden;cursor:pointer" title="${a.label}：此机位将在 ${a.key === 'front_closeup' ? '特写/推镜' : a.key === 'side_45' ? '左右摇/环绕' : '中景/全景'} 镜头时自动使用">
        <img src="${url}" style="width:100%;height:100%;object-fit:cover;display:block" />
        <div style="position:absolute;top:3px;left:3px;background:rgba(0,0,0,.6);color:#fff;font-size:9px;padding:2px 5px;border-radius:3px">${a.icon} ${a.label}</div>
        <button onclick="regenerateAngle('${a.key}')" title="换一张" style="position:absolute;bottom:3px;right:3px;background:rgba(0,0,0,.6);border:none;color:#fff;border-radius:3px;padding:3px 6px;font-size:9px;cursor:pointer">🔄</button>
      </div>`;
    } else {
      return `<div style="aspect-ratio:3/4;background:var(--bg2);border:1px dashed rgba(255,255,255,.1);border-radius:7px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;color:var(--text3);font-size:10px">
        <div style="font-size:18px;opacity:.4">${a.icon}</div>
        <div>${a.label}</div>
        <div style="font-size:9px">待生成</div>
      </div>`;
    }
  }).join('');
}

async function regenerateAngle(angle) {
  const selectedAvEl = document.querySelector('.av-avatar-card.active');
  const avatar = selectedAvEl?.dataset?.avatar || (typeof avatarSelected !== 'undefined' ? avatarSelected : '');
  if (!avatar) { showToast('请先选择形象', 'warning'); return; }
  showToast(`重新生成 ${angle}...`, 'info');
  try {
    const r = await authFetch('/api/avatar/regenerate-angle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar, angle, bodyFrame: avatarBodyFrame, aspectRatio: (typeof avatarRatio !== 'undefined' ? avatarRatio : '9:16') }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    avatarMultiAngleImages[angle] = j.imageUrl;
    renderMultiAngleGrid();
    showToast(`${angle} 已更新`, 'success');
  } catch (e) {
    showToast('换图失败：' + e.message, 'error');
  }
}

function clearMultiAngle() {
  avatarMultiAngleImages = {};
  renderMultiAngleGrid();
  document.getElementById('av-multi-angle-clear').style.display = 'none';
  const status = document.getElementById('av-multi-angle-status');
  if (status) { status.style.display = 'none'; status.textContent = ''; }
}

// 初始渲染空 grid（提示用户点击按钮）
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('av-multi-angle-grid')) renderMultiAngleGrid();
});

// 多人对话状态
let multiSpeakers = []; // [{ id, avatar, voiceId, voiceName, name, emotion }]
let multiDialogue = []; // [{ speakerId, text, emotion?, emotion_intensity?, camera? }]
let multiLayout = 'cut-to-speaker';

function switchAvatarMode(mode) {
  avatarMode = mode;
  const panel = document.getElementById('av-multi-panel');
  document.getElementById('av-mode-single').classList.toggle('active', mode === 'single');
  document.getElementById('av-mode-multi').classList.toggle('active', mode === 'multi');
  if (mode === 'multi') {
    panel.style.display = 'block';
    renderMultiSpeakers();
    renderMultiDialogue();
  } else {
    panel.style.display = 'none';
  }
}

function selectAvatarCamera(btn, camId) {
  document.querySelectorAll('#av-camera-grid .av-cam-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  avatarCamera = camId;
  // 同步自定义滑杆到预设值
  const PRESET_TO_SLIDERS = {
    medium:    { zoom: 0, pan: 0,  tilt: 0,  roll: 0 },
    close_up:  { zoom: 3, pan: 0,  tilt: 0,  roll: 0 },
    full:      { zoom: -3, pan: 0, tilt: 0,  roll: 0 },
    zoom_in:   { zoom: 5, pan: 0,  tilt: 0,  roll: 0 },
    zoom_out:  { zoom: -5, pan: 0, tilt: 0,  roll: 0 },
    pan_left:  { zoom: 0, pan: -5, tilt: 0,  roll: 0 },
    pan_right: { zoom: 0, pan: 5,  tilt: 0,  roll: 0 },
    orbit:     { zoom: 0, pan: 0,  tilt: 0,  roll: 5 },
  };
  const v = PRESET_TO_SLIDERS[camId] || PRESET_TO_SLIDERS.medium;
  ['zoom','pan','tilt','roll'].forEach(k => {
    const el = document.getElementById('av-cc-'+k);
    const vEl = document.getElementById('av-cc-'+k+'-v');
    if (el) el.value = v[k];
    if (vEl) vEl.textContent = v[k];
  });
}

// ═══ 智能镜头推荐（P4：AI 根据内容+业务场景推荐镜头组合） ═══
let smartCameraShots = null; // 最后一次 AI 推荐的镜头序列

async function recommendSmartCamera() {
  const text = document.getElementById('av-text-input')?.value?.trim();
  if (!text || text.length < 10) { showToast('请先输入至少 10 字的台词', 'warning'); return; }
  const scenario = document.getElementById('av-smart-scenario')?.value || 'live';
  const btn = document.getElementById('av-smart-cam-btn');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="av-spinner av-spinner-sm" style="display:inline-block;margin-right:4px"></span>思考中...';
  try {
    const r = await authFetch('/api/avatar/smart-camera', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, scenario }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    smartCameraShots = j.shots || [];
    renderSmartCameraShots();
    document.getElementById('av-smart-cam-result').style.display = 'block';
    // 自动应用（不再需要手动点"应用"）
    if (smartCameraShots.length && typeof applySmartCameraToSegments === 'function') {
      applySmartCameraToSegments();
    }
    showToast(`AI 推荐 ${smartCameraShots.length} 个镜头·已自动应用`, 'success');
  } catch (e) {
    showToast('推荐失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

function renderSmartCameraShots() {
  const box = document.getElementById('av-smart-cam-list');
  if (!box || !smartCameraShots) return;
  const CAM_ICONS = { medium:'📷', close_up:'🔍', full:'🌄', zoom_in:'➡️', zoom_out:'⬅️', pan_left:'⬅', pan_right:'➡', orbit:'🔄', tilt_up:'⬆', tilt_down:'⬇' };
  box.innerHTML = smartCameraShots.map((s, i) => `
    <div style="display:flex;gap:6px;align-items:flex-start;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04)">
      <span style="font-size:11px;color:var(--accent);font-weight:600;width:34px;flex-shrink:0">${CAM_ICONS[s.camera]||'📷'} ${i+1}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:10.5px;color:var(--text);line-height:1.4">${esc(s.text)}</div>
        <div style="font-size:9px;color:var(--text3);margin-top:2px"><b style="color:var(--accent)">${esc(s.camera)}</b>${s.reason ? ' · ' + esc(s.reason) : ''}</div>
      </div>
    </div>`).join('');
}

function applySmartCameraToSegments() {
  if (!smartCameraShots?.length) return;
  // 把推荐结果作为 segments（每段 text + camera + 默认 emotion 为 neutral 0.5）
  avatarSegments = smartCameraShots.map(s => ({
    text: s.text,
    camera: s.camera,
    emotion: 'neutral',
    emotion_intensity: 0.5,
    motion: '',
  }));
  if (typeof renderAvatarSegments === 'function') renderAvatarSegments();
  // 把所有 text 重新拼回输入框
  const ta = document.getElementById('av-text-input');
  if (ta) ta.value = smartCameraShots.map(s => s.text).join('');
  showToast(`已应用 ${avatarSegments.length} 段智能镜头组合（每段独立镜头）`, 'success');
  refreshPromptPreview();
}

// ═══ Prompt 预览（P8：提示词可视化 + 中文编辑自动同步英文） ═══
let _promptPreviewTimer = null;
let avatarPromptEn = '';   // 隐藏：最终送给 I2V 模型的英文
let avatarPromptZh = '';   // 可见：默认显示的中文（用户可编辑）
let _promptUserEdited = false; // 用户是否手改过中文（改过就别被自动覆盖）

async function refreshPromptPreview(forceNow) {
  clearTimeout(_promptPreviewTimer);
  const run = async () => {
    const text = document.getElementById('av-text-input')?.value?.trim() || '';
    const emotion = avatarEmotion || document.getElementById('av-emotion')?.value || 'neutral';
    const intensity = parseInt(document.getElementById('av-emotion-intensity')?.value || '50') / 100;
    const customSuffix = document.getElementById('av-custom-prompt-suffix')?.value?.trim() || '';
    const box = document.getElementById('av-prompt-preview');
    const status = document.getElementById('av-prompt-sync-status');
    if (!box) return;
    // forceNow 时先显示"加载中"视觉反馈，让用户知道按钮响应了
    if (forceNow && status) status.textContent = '🔄 正在重新生成 prompt...';
    try {
      const r = await authFetch('/api/avatar/prompt-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, emotion, emotion_intensity: intensity, camera: avatarCamera || 'medium', background: avatarBg || 'office', customSuffix, bodyFrame: avatarBodyFrame || 'head_shoulders' }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '服务端返回 success=false');
      avatarPromptEn = j.prompt || '';
      avatarPromptZh = j.prompt_zh || j.prompt || '';
      // forceNow=true 强制覆盖 textarea（用户显式点"重置/刷新"）
      // forceNow=false 只在用户没手改时覆盖（避免覆盖用户正在打字的内容）
      if (!_promptUserEdited || forceNow) {
        // 临时取消 oninput 处理，防止赋值触发误报"用户已编辑"
        const prev = box.oninput; box.oninput = null;
        box.value = avatarPromptZh;
        setTimeout(() => { box.oninput = prev; }, 50);
        _promptUserEdited = false;
      }
      if (status) status.textContent = `自动生成 · ${avatarPromptZh.length} 字 (英文 ${avatarPromptEn.length} 字符)`;
    } catch (e) {
      console.warn('[prompt-preview]', e);
      if (status) status.textContent = '⚠️ 预览失败: ' + e.message;
      if (forceNow && typeof showToast === 'function') showToast('prompt 预览失败：' + e.message, 'error');
    }
  };
  if (forceNow) run();
  else _promptPreviewTimer = setTimeout(run, 500);
}

// 硬重置：用户点"重置为自动生成"时调用
// 清空编辑标志 → 拉新 prompt → 无条件覆盖 textarea
function resetPromptPreview() {
  _promptUserEdited = false;
  const box = document.getElementById('av-prompt-preview');
  const status = document.getElementById('av-prompt-sync-status');
  if (box) box.value = '';  // 先清空，避免视觉残留
  if (status) status.textContent = '🔄 正在重置为自动生成...';
  refreshPromptPreview(true);
}

// 用户手改了中文 textarea → debounce 翻译成英文同步到 avatarPromptEn
let _promptZhTranslateTimer = null;
function onPromptZhEdited() {
  _promptUserEdited = true;
  clearTimeout(_promptZhTranslateTimer);
  const status = document.getElementById('av-prompt-sync-status');
  const zh = document.getElementById('av-prompt-preview')?.value || '';
  avatarPromptZh = zh;
  if (status) status.textContent = '✍️ 已编辑（1.2s 后自动翻译到英文）';
  _promptZhTranslateTimer = setTimeout(async () => {
    if (!zh.trim()) { avatarPromptEn = ''; if (status) status.textContent = '（已清空）'; return; }
    if (status) status.textContent = '🔄 正在翻译到英文...';
    try {
      const r = await authFetch('/api/avatar/translate-prompt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt_zh: zh }),
      });
      const j = await r.json();
      if (j.success && j.prompt) {
        avatarPromptEn = j.prompt;
        if (status) status.textContent = `✓ 已同步到英文 ${avatarPromptEn.length} 字符（实际送给 I2V 模型）`;
      } else throw new Error(j.error || 'LLM 失败');
    } catch (e) {
      // 翻译失败 → 直接用中文作为 EN（模型都支持中文 prompt）
      avatarPromptEn = zh;
      if (status) status.textContent = '⚠️ 翻译失败，直接用中文送给模型 (' + e.message + ')';
    }
  }, 1200);
}
// 监听各种参数变化 → 自动刷新 Prompt 预览
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const hook = (id) => document.getElementById(id)?.addEventListener('change', () => refreshPromptPreview());
    const hookInput = (id) => document.getElementById(id)?.addEventListener('input', () => refreshPromptPreview());
    hook('av-emotion'); hook('av-expression'); hook('av-smart-scenario'); hook('av-model-selector');
    hookInput('av-emotion-intensity');
    hookInput('av-text-input');             // 台词输入 → 立即刷
    hookInput('av-custom-prompt-suffix');   // 已经有 oninput，但双保险
    // 首次进入页面就拉一次（即使 text 为空也显示模板 prompt）
    setTimeout(() => refreshPromptPreview(true), 800);
  }, 500);
});

function updateCustomCamera() {
  const zoom = +(document.getElementById('av-cc-zoom')?.value || 0);
  const pan  = +(document.getElementById('av-cc-pan')?.value || 0);
  const tilt = +(document.getElementById('av-cc-tilt')?.value || 0);
  const roll = +(document.getElementById('av-cc-roll')?.value || 0);
  ['zoom','pan','tilt','roll'].forEach(k => {
    const vEl = document.getElementById('av-cc-'+k+'-v');
    if (vEl) vEl.textContent = ({zoom,pan,tilt,roll})[k];
  });
  // 任意非零 → 启用结构化 camera_control
  if (zoom || pan || tilt || roll) {
    // Kling camera_control 要求 type 是单一类型 → 挑主导轴
    const abs = { zoom: Math.abs(zoom), pan: Math.abs(pan), tilt: Math.abs(tilt), roll: Math.abs(roll) };
    const dominant = Object.keys(abs).reduce((a, b) => abs[a] >= abs[b] ? a : b);
    avatarCamera = {
      type: dominant,
      config: { zoom, pan, tilt, roll },
      simple: dominant === 'zoom' ? (zoom > 0 ? 'zoom_in' : 'zoom_out')
            : dominant === 'pan' ? (pan > 0 ? 'pan_right' : 'pan_left')
            : 'medium',
    };
    // 取消预设选中（进入自定义模式）
    document.querySelectorAll('#av-camera-grid .av-cam-btn').forEach(b => b.classList.remove('active'));
  }
}

// ═══ P1: 背景视频上传 ═══
async function uploadAvatarBgVideo(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const nameEl = document.getElementById('av-bg-video-name');
  const preview = document.getElementById('av-bg-video-preview');
  const videoEl = document.getElementById('av-bg-video-el');
  if (nameEl) nameEl.textContent = '上传中...';
  try {
    const fd = new FormData();
    fd.append('video', file);
    const r = await authFetch('/api/avatar/upload-bg-video', { method: 'POST', body: fd });
    const j = await r.json();
    if (!j.success) throw new Error(j.error || '上传失败');
    avatarBgVideoUrl = j.path;
    if (videoEl) {
      videoEl.src = authUrl(j.path);
      videoEl.play().catch(() => {});
    }
    if (nameEl) nameEl.textContent = file.name;
    if (preview) preview.style.display = 'block';
    showToast('背景视频已上传，生成时将自动抠像合成', 'success');
  } catch (e) {
    if (nameEl) nameEl.textContent = '上传失败：' + e.message;
    showToast('背景视频上传失败: ' + e.message, 'error');
  }
}

function clearAvatarBgVideo() {
  avatarBgVideoUrl = '';
  const preview = document.getElementById('av-bg-video-preview');
  const videoEl = document.getElementById('av-bg-video-el');
  if (videoEl) videoEl.src = '';
  if (preview) preview.style.display = 'none';
  const input = document.getElementById('av-bg-video-input');
  if (input) input.value = '';
}

// 当选择 bg=green，自动显示背景视频面板
const _origSelectBg = typeof selectAvatarBg === 'function' ? selectAvatarBg : null;
if (_origSelectBg) {
  window.selectAvatarBg = function(el) {
    _origSelectBg(el);
    const bgVidPanel = document.getElementById('av-bg-video-panel');
    if (bgVidPanel) bgVidPanel.style.display = avatarBg === 'green' ? 'block' : 'none';
  };
}

// ═══ P0: 多人对话 UI ═══

function addMultiSpeaker() {
  const id = 's' + (multiSpeakers.length + 1);
  multiSpeakers.push({
    id,
    avatar: avatarSelected, // 默认复用主界面选中的
    voiceId: _avSelected?.id || '',
    voiceName: _avSelected?.name || '自动',
    name: '角色 ' + (multiSpeakers.length + 1),
    emotion: 'neutral',
  });
  renderMultiSpeakers();
  updateMultiStat();
}

function removeMultiSpeaker(idx) {
  const removed = multiSpeakers.splice(idx, 1)[0];
  // 清除引用这个 speaker 的对话
  multiDialogue = multiDialogue.filter(d => d.speakerId !== removed.id);
  renderMultiSpeakers();
  renderMultiDialogue();
  updateMultiStat();
}

// 通用选择器样式（只注一次）
function _ensureMultiPickerStyle() {
  if (document.getElementById('multi-picker-style')) return;
  const s = document.createElement('style');
  s.id = 'multi-picker-style';
  s.textContent = `
    .mp-mask { position:fixed; inset:0; z-index:99999; background:rgba(0,0,0,.65); backdrop-filter:blur(4px); display:flex; align-items:center; justify-content:center; animation:mpFade .16s ease; }
    @keyframes mpFade { from { opacity:0 } to { opacity:1 } }
    @keyframes mpSlide { from { transform:translateY(10px); opacity:0 } to { transform:translateY(0); opacity:1 } }
    .mp-panel { background:var(--bg2,#14151a); border:1px solid var(--border2,rgba(255,255,255,.09)); border-radius:14px; width:760px; max-width:calc(100vw - 32px); max-height:80vh; display:flex; flex-direction:column; animation:mpSlide .22s ease; overflow:hidden; }
    .mp-hd { padding:14px 20px; border-bottom:1px solid rgba(255,255,255,.06); display:flex; align-items:center; justify-content:space-between; }
    .mp-title { font-size:15px; font-weight:600; color:var(--text); }
    .mp-close { background:none; border:none; color:var(--text3); font-size:20px; cursor:pointer; padding:4px 8px; border-radius:5px; }
    .mp-close:hover { background:var(--bg3); color:var(--text); }
    .mp-tools { padding:10px 20px; border-bottom:1px solid rgba(255,255,255,.04); display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
    .mp-search { flex:1; min-width:140px; height:30px; padding:0 10px; background:var(--bg3); border:1px solid rgba(255,255,255,.06); border-radius:6px; color:var(--text); font-size:12px; outline:none; }
    .mp-cat { padding:4px 10px; background:var(--bg3); border:1px solid rgba(255,255,255,.06); color:var(--text2); border-radius:999px; font-size:11px; cursor:pointer; }
    .mp-cat.active { background:var(--accent); color:#000; border-color:var(--accent); }
    .mp-body { flex:1; overflow-y:auto; padding:14px 20px; }
    .mp-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:10px; }
    .mp-card { cursor:pointer; border-radius:8px; border:1px solid rgba(255,255,255,.06); background:var(--bg3); overflow:hidden; transition:transform .1s, border-color .1s; position:relative; }
    .mp-card:hover { border-color:var(--accent); transform:translateY(-1px); }
    .mp-card.active { border-color:var(--accent); box-shadow:0 0 0 2px rgba(124,108,240,.35); }
    .mp-card-img { width:100%; aspect-ratio:1/1; background:var(--bg4); background-size:cover; background-position:center; }
    .mp-card-label { padding:6px 8px; font-size:11px; color:var(--text); text-align:center; }
    .mp-list { display:flex; flex-direction:column; gap:4px; }
    .mp-list-row { padding:8px 12px; background:var(--bg3); border:1px solid rgba(255,255,255,.04); border-radius:6px; display:flex; align-items:center; gap:10px; cursor:pointer; transition:border-color .1s; }
    .mp-list-row:hover { border-color:var(--accent); }
    .mp-list-row.active { border-color:var(--accent); background:rgba(124,108,240,.1); }
    .mp-list-icon { width:24px; text-align:center; font-size:14px; }
    .mp-list-name { flex:1; font-size:12px; color:var(--text); }
    .mp-list-meta { font-size:10px; color:var(--text3); }
    .mp-empty { padding:40px 20px; text-align:center; color:var(--text3); font-size:12px; }
  `;
  document.head.appendChild(s);
}

function _closeMultiPicker() { document.getElementById('multi-picker')?.remove(); }

async function pickMultiSpeakerAvatar(idx) {
  _ensureMultiPickerStyle();
  const resp = await authFetch('/api/avatar/presets');
  const data = await resp.json();
  const avatars = data.avatars || {};
  const meta = data.avatarMeta || {};
  const categories = data.categories || [];
  const keys = Object.keys(avatars).filter(k => avatars[k]);
  if (!keys.length) { alert('请先在"选择形象"里生成预设头像'); return; }

  const current = multiSpeakers[idx]?.avatar;
  let catFilter = ''; let search = '';

  const renderGrid = () => {
    const body = document.getElementById('mp-body');
    const filtered = keys.filter(k => {
      if (catFilter && (meta[k]?.category !== catFilter)) return false;
      if (search && !(meta[k]?.name || k).toLowerCase().includes(search.toLowerCase()) && !k.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    if (!filtered.length) { body.innerHTML = `<div class="mp-empty">没有匹配的形象</div>`; return; }
    body.innerHTML = `<div class="mp-grid">${filtered.map(k => `
      <div class="mp-card ${k === current ? 'active' : ''}" data-key="${esc(k)}" onclick="__mpPickAvatar(${idx}, '${esc(k)}')">
        <div class="mp-card-img" style="background-image:url('${esc(avatars[k])}')"></div>
        <div class="mp-card-label">${esc(meta[k]?.name || k)}</div>
      </div>`).join('')}</div>`;
  };

  const overlay = document.createElement('div');
  overlay.className = 'mp-mask';
  overlay.id = 'multi-picker';
  overlay.onclick = (e) => { if (e.target === overlay) _closeMultiPicker(); };
  overlay.innerHTML = `
    <div class="mp-panel">
      <div class="mp-hd">
        <span class="mp-title">🎭 为角色选择形象</span>
        <button class="mp-close" onclick="_closeMultiPicker()">×</button>
      </div>
      <div class="mp-tools">
        <input class="mp-search" id="mp-search" placeholder="搜索形象名或 id..." />
        <div id="mp-cats" style="display:flex;gap:6px;flex-wrap:wrap">
          <span class="mp-cat active" data-cat="">全部</span>
          ${categories.map(c => `<span class="mp-cat" data-cat="${esc(c.id)}">${esc(c.name)}</span>`).join('')}
        </div>
      </div>
      <div class="mp-body" id="mp-body"></div>
    </div>`;
  document.body.appendChild(overlay);
  renderGrid();
  document.getElementById('mp-search').addEventListener('input', (e) => { search = e.target.value; renderGrid(); });
  document.querySelectorAll('#mp-cats .mp-cat').forEach(el => el.addEventListener('click', () => {
    catFilter = el.dataset.cat;
    document.querySelectorAll('#mp-cats .mp-cat').forEach(x => x.classList.remove('active'));
    el.classList.add('active');
    renderGrid();
  }));
}

// 供 onclick 调用（全局）
function __mpPickAvatar(idx, key) {
  const cardData = window._mpAvatarDataCache;
  // meta 在 picker 函数闭包里，我们直接更新 model state
  fetch('/api/avatar/presets').then(() => {}).catch(() => {}); // fire-and-forget noop
  // 读最新元数据
  authFetch('/api/avatar/presets').then(r => r.json()).then(data => {
    const meta = data.avatarMeta || {};
    multiSpeakers[idx].avatar = key;
    multiSpeakers[idx].name = meta[key]?.name || key;
    renderMultiSpeakers();
    _closeMultiPicker();
  }).catch(() => {
    multiSpeakers[idx].avatar = key;
    multiSpeakers[idx].name = key;
    renderMultiSpeakers();
    _closeMultiPicker();
  });
}

function renderMultiSpeakers() {
  const box = document.getElementById('av-multi-speakers');
  if (!box) return;
  if (!multiSpeakers.length) {
    box.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:11px">还没有角色，点右上"+ 添加"</div>';
    return;
  }
  box.innerHTML = multiSpeakers.map((s, i) => {
    const avatarImg = s.avatar && typeof s.avatar === 'string' && !s.avatar.startsWith('/')
      ? `/api/avatar/preset-img/avatar_${s.avatar}.png`
      : (s.avatar || '');
    return `<div class="av-multi-speaker-card">
      <div class="av-multi-speaker-avatar" onclick="pickMultiSpeakerAvatar(${i})" style="cursor:pointer">
        ${avatarImg ? `<img src="${esc(avatarImg)}" onerror="this.style.display='none'" />` : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:9px">选头像</div>'}
      </div>
      <div class="av-multi-speaker-info">
        <input type="text" value="${esc(s.name)}" oninput="multiSpeakers[${i}].name=this.value" style="background:transparent;border:none;border-bottom:1px solid rgba(255,255,255,.1);color:var(--text);font-size:11px;width:100%;padding:2px 0;outline:none" />
        <div class="av-multi-speaker-role">${esc(s.id)} · ${esc(s.voiceName || '自动')}</div>
      </div>
      <button onclick="changeMultiSpeakerVoice(${i})" style="background:var(--bg2);border:1px solid rgba(255,255,255,.08);color:var(--text2);border-radius:5px;height:22px;padding:0 6px;font-size:10px;cursor:pointer">音色</button>
      <button onclick="removeMultiSpeaker(${i})" style="background:transparent;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:4px">×</button>
    </div>`;
  }).join('');
}

async function changeMultiSpeakerVoice(idx) {
  _ensureMultiPickerStyle();
  if (!_avAllVoices) {
    try { const r = await authFetch('/api/avatar/voice-list'); const j = await r.json(); _avAllVoices = j.voices || []; } catch {}
  }
  if (!_avAllVoices?.length) { alert('无可用音色，请到 AI 配置中启用 TTS'); return; }

  const current = multiSpeakers[idx]?.voiceId || '';
  let search = '', genderFilter = '';

  const renderList = () => {
    const body = document.getElementById('mp-body');
    const filtered = _avAllVoices.filter(v => {
      if (genderFilter && v.gender !== genderFilter && v.gender !== 'auto') return false;
      if (search) {
        const key = (v.name + ' ' + (v.id || '') + ' ' + (v.provider || '')).toLowerCase();
        if (!key.includes(search.toLowerCase())) return false;
      }
      return true;
    });
    if (!filtered.length) { body.innerHTML = `<div class="mp-empty">没有匹配的音色</div>`; return; }
    body.innerHTML = `<div class="mp-list">${filtered.map(v => {
      const vid = v.id || '';
      const active = vid === current;
      const icon = v.providerIcon || (v.gender === 'female' ? '👩' : v.gender === 'male' ? '👨' : v.gender === 'child' ? '🧒' : '🔊');
      return `<div class="mp-list-row ${active ? 'active' : ''}" onclick="__mpPickVoice(${idx}, '${esc(vid)}', '${esc(v.name)}')">
        <div class="mp-list-icon">${icon}</div>
        <div class="mp-list-name">${esc(v.name)}${v.tag ? ` <span style="font-size:9px;padding:1px 5px;background:rgba(124,108,240,.2);color:var(--accent);border-radius:4px;margin-left:4px">${esc(v.tag)}</span>` : ''}</div>
        <div class="mp-list-meta">${esc(v.provider || '')} · ${esc(vid || 'auto')}</div>
        ${vid ? `<button onclick="event.stopPropagation();__mpPreviewVoice('${esc(vid)}', this)" style="background:var(--bg4);border:1px solid rgba(255,255,255,.08);color:var(--text2);border-radius:4px;height:22px;padding:0 8px;font-size:10px;cursor:pointer">▶ 试听</button>` : ''}
      </div>`;
    }).join('')}</div>`;
  };

  const overlay = document.createElement('div');
  overlay.className = 'mp-mask';
  overlay.id = 'multi-picker';
  overlay.onclick = (e) => { if (e.target === overlay) _closeMultiPicker(); };
  overlay.innerHTML = `
    <div class="mp-panel">
      <div class="mp-hd">
        <span class="mp-title">🎵 为"${esc(multiSpeakers[idx]?.name || '角色')}"选择音色</span>
        <button class="mp-close" onclick="_closeMultiPicker()">×</button>
      </div>
      <div class="mp-tools">
        <input class="mp-search" id="mp-search" placeholder="搜索音色名 / 提供商（火山/智谱/百度）..." />
        <div style="display:flex;gap:6px">
          <span class="mp-cat active" data-gender="">全部</span>
          <span class="mp-cat" data-gender="female">女声</span>
          <span class="mp-cat" data-gender="male">男声</span>
          <span class="mp-cat" data-gender="child">童声</span>
        </div>
      </div>
      <div class="mp-body" id="mp-body"></div>
    </div>`;
  document.body.appendChild(overlay);
  renderList();
  document.getElementById('mp-search').addEventListener('input', (e) => { search = e.target.value; renderList(); });
  overlay.querySelectorAll('.mp-cat[data-gender]').forEach(el => el.addEventListener('click', () => {
    genderFilter = el.dataset.gender;
    overlay.querySelectorAll('.mp-cat[data-gender]').forEach(x => x.classList.remove('active'));
    el.classList.add('active');
    renderList();
  }));
}

function __mpPickVoice(idx, voiceId, voiceName) {
  multiSpeakers[idx].voiceId = voiceId || '';
  multiSpeakers[idx].voiceName = voiceName || '自动';
  renderMultiSpeakers();
  _closeMultiPicker();
}

async function __mpPreviewVoice(voiceId, btn) {
  const origLabel = btn.textContent;
  btn.textContent = '⏳'; btn.disabled = true;
  try {
    if (_globalAudio) { _globalAudio.pause(); _globalAudio.src = ''; _globalAudio = null; }
    const r = await authFetch('/api/avatar/preview-voice', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceId, text: '你好，这是我的音色试听。' }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    _globalAudio = new Audio(url);
    _globalAudio.onended = () => { URL.revokeObjectURL(url); _globalAudio = null; };
    await _globalAudio.play();
  } catch (e) {
    alert('试听失败：' + e.message);
  } finally {
    btn.textContent = origLabel; btn.disabled = false;
  }
}

function addMultiDialogue() {
  if (!multiSpeakers.length) { alert('请先添加至少一个角色'); return; }
  multiDialogue.push({
    speakerId: multiSpeakers[0].id,
    text: '',
    emotion: 'neutral',
    emotion_intensity: 0.5,
    camera: 'medium',
  });
  renderMultiDialogue();
  updateMultiStat();
}

function removeMultiDialogue(idx) {
  multiDialogue.splice(idx, 1);
  renderMultiDialogue();
  updateMultiStat();
}

function renderMultiDialogue() {
  const box = document.getElementById('av-multi-dialogue');
  if (!box) return;
  if (!multiDialogue.length) {
    box.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3);font-size:11px">还没有对话<br><br>点击右上"+ 添加发言"或"AI 生成对话"</div>';
    return;
  }
  const CAM_OPTS = ['medium','close_up','full','zoom_in','zoom_out','pan_left','pan_right','orbit'];
  const EMOT_OPTS = ['neutral','happy','warm','confident','excited','serious','sad','surprised'];
  box.innerHTML = multiDialogue.map((d, i) => {
    const spOptions = multiSpeakers.map(s => `<option value="${esc(s.id)}" ${s.id === d.speakerId ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    const camOptions = CAM_OPTS.map(c => `<option value="${c}" ${c === d.camera ? 'selected' : ''}>${c}</option>`).join('');
    const emotOptions = EMOT_OPTS.map(e => `<option value="${e}" ${e === d.emotion ? 'selected' : ''}>${e}</option>`).join('');
    return `<div class="av-multi-dialogue-row">
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
        <span style="font-size:10px;color:var(--text3);width:20px">#${i+1}</span>
        <select onchange="multiDialogue[${i}].speakerId=this.value;updateMultiStat()" style="background:var(--bg2);border:1px solid rgba(255,255,255,.08);color:var(--text);border-radius:5px;height:24px;font-size:11px;padding:0 4px">${spOptions}</select>
        <select onchange="multiDialogue[${i}].emotion=this.value" style="background:var(--bg2);border:1px solid rgba(255,255,255,.08);color:var(--text);border-radius:5px;height:24px;font-size:11px;padding:0 4px">${emotOptions}</select>
        <select onchange="multiDialogue[${i}].camera=this.value" style="background:var(--bg2);border:1px solid rgba(255,255,255,.08);color:var(--text);border-radius:5px;height:24px;font-size:11px;padding:0 4px">${camOptions}</select>
        <input type="range" min="0" max="100" value="${Math.round((d.emotion_intensity||0.5)*100)}" oninput="multiDialogue[${i}].emotion_intensity=parseInt(this.value)/100" style="flex:1;max-width:80px" title="情绪强度" />
        <button onclick="removeMultiDialogue(${i})" style="background:transparent;border:none;color:var(--text3);cursor:pointer;font-size:14px">×</button>
      </div>
      <textarea oninput="multiDialogue[${i}].text=this.value" placeholder="输入台词..." rows="2" style="width:100%;background:var(--bg2);border:1px solid rgba(255,255,255,.08);color:var(--text);border-radius:5px;padding:6px 8px;font-size:11px;resize:vertical;font-family:inherit;box-sizing:border-box">${esc(d.text || '')}</textarea>
    </div>`;
  }).join('');
}

function updateMultiStat() {
  const el = document.getElementById('av-multi-stat');
  if (el) el.textContent = `${multiSpeakers.length} 个角色 · ${multiDialogue.length} 条发言`;
}

function selectMultiLayout(layout) {
  multiLayout = layout;
  document.getElementById('av-layout-cut').classList.toggle('active', layout === 'cut-to-speaker');
  document.getElementById('av-layout-side').classList.toggle('active', layout === 'side-by-side');
}

async function aiGenerateMultiDialogue() {
  if (!multiSpeakers.length) { alert('请先添加至少 1 个角色'); return; }
  const topic = prompt('对话主题（例如："主持人和嘉宾讨论 AI 未来"）：', 'AI 技术对话');
  if (!topic) return;
  const names = multiSpeakers.map(s => s.name).join('、');
  const sys = '你是资深影视编剧。输出 JSON 数组，每项 {speakerId, text, emotion, camera}。emotion: neutral/happy/warm/confident/excited/serious. camera: medium/close_up/zoom_in/zoom_out. 只输出纯 JSON，不要 markdown。';
  const user = `角色：${multiSpeakers.map(s => `${s.id}=${s.name}`).join(', ')}\n主题：${topic}\n\n生成 6-10 条对话，每条 20-50 字，口语自然。按 speakerId 字段标明是谁在说。直接返回 JSON 数组。`;
  try {
    const btn = event?.target?.closest('button'); if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }
    const r = await authFetch('/api/story/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: user, systemPrompt: sys, rawOutput: true }),
    });
    const j = await r.json();
    const txt = j.content || j.text || j.result || '';
    const match = txt.match(/\[[\s\S]*\]/);
    const arr = JSON.parse(match ? match[0] : txt);
    if (!Array.isArray(arr)) throw new Error('AI 返回非数组');
    multiDialogue = arr.map(d => ({
      speakerId: d.speakerId || multiSpeakers[0].id,
      text: d.text || '',
      emotion: d.emotion || 'neutral',
      emotion_intensity: d.emotion_intensity ?? 0.5,
      camera: d.camera || 'medium',
    })).filter(d => d.text);
    renderMultiDialogue();
    updateMultiStat();
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="vertical-align:middle;margin-right:3px"><path d="M5 1l.8 2.6H8.5L6.4 5l.8 2.5L5 6 2.8 7.5l.8-2.5L1.5 3.6h2.7z" stroke="currentColor" stroke-width=".8" stroke-linejoin="round"/></svg>AI 生成对话'; }
  } catch (e) {
    alert('AI 生成失败: ' + e.message);
    const btn = event?.target?.closest('button'); if (btn) { btn.disabled = false; btn.innerHTML = 'AI 生成对话'; }
  }
}

async function startMultiSpeakerGeneration() {
  if (!multiSpeakers.length) { alert('至少需要 1 个角色'); return; }
  if (!multiDialogue.length || !multiDialogue.every(d => d.text?.trim())) { alert('每条发言必须有台词'); return; }

  const btn = document.getElementById('av-multi-gen-btn');
  btn.disabled = true;
  const origHtml = btn.innerHTML;
  btn.innerHTML = '<span class="av-spinner av-spinner-sm" style="display:inline-block;margin-right:6px"></span>生成中...';

  const resultBox = document.getElementById('av-multi-result');
  resultBox.style.display = 'block';
  resultBox.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2)">提交任务...</div>';

  try {
    const body = {
      speakers: multiSpeakers.map(s => ({
        id: s.id, name: s.name, avatar: s.avatar, voiceId: s.voiceId || '',
        emotion: s.emotion || 'neutral',
      })),
      dialogue: multiDialogue.map(d => ({
        speakerId: d.speakerId,
        text: d.text,
        emotion: d.emotion,
        emotion_intensity: d.emotion_intensity,
        camera: d.camera,
      })),
      layout: multiLayout,
      background: document.getElementById('av-multi-bg')?.value || 'studio',
      ratio: document.getElementById('av-multi-ratio')?.value || '16:9',
      model: document.getElementById('av-model-selector')?.value || 'cogvideox-flash',
      speed: parseFloat(document.getElementById('av-multi-speed')?.value) || 1.0,
      title: '多人对话 ' + new Date().toLocaleTimeString(),
    };
    const r = await authFetch('/api/avatar/multi-speaker', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error || '提交失败');

    // SSE 进度
    const sse = new EventSource(authUrl(`/api/avatar/tasks/${j.taskId}/progress`));
    sse.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.step === 'connected') return;
      if (d.step === 'done') {
        sse.close();
        const src = authUrl(d.videoUrl);
        const dl = authUrl(`/api/avatar/tasks/${j.taskId}/download`);
        resultBox.innerHTML = `<video controls autoplay playsinline style="width:100%;max-height:400px;border-radius:6px;background:#000"><source src="${src}" type="video/mp4" /></video>
          <div style="display:flex;gap:8px;margin-top:8px;justify-content:center">
            <a href="${dl}" download style="background:var(--accent);border-radius:6px;color:#0a0a0f;padding:8px 16px;text-decoration:none;font-size:12px;font-weight:600">下载视频</a>
          </div>`;
        btn.disabled = false; btn.innerHTML = origHtml;
        addAvatarHistory({ taskId: j.taskId, text: `多人对话 (${multiSpeakers.length}×${multiDialogue.length})`, videoUrl: d.videoUrl, ratio: body.ratio, model: body.model, title: body.title });
        return;
      }
      if (d.step === 'error') {
        sse.close();
        resultBox.innerHTML = `<div style="padding:16px;color:var(--error);font-size:12px">⚠ ${esc(d.message || '未知错误')}</div>`;
        btn.disabled = false; btn.innerHTML = origHtml;
        return;
      }
      // 进度
      const cur = d.current ? `[${d.current}/${d.total}]` : '';
      resultBox.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text2);font-size:12px"><div style="margin-bottom:10px"><span class="av-spinner" style="display:inline-block"></span></div>${esc(d.message || d.step)} ${cur}</div>`;
    };
    sse.onerror = () => { /* 静默重连 */ };
  } catch (e) {
    resultBox.innerHTML = `<div style="padding:16px;color:var(--error);font-size:12px">⚠ ${esc(e.message)}</div>`;
    btn.disabled = false; btn.innerHTML = origHtml;
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
  // 短到 30 字也允许手动分段（AI 写的 20s 口播 ~80 字，但 15s 的可能 60 字）
  if (segBtn) segBtn.style.display = text.length >= 30 ? '' : 'none';
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
  // 按中文语速约 4 字/秒估算每段时间
  let accTime = 0;
  list.innerHTML = avatarSegments.map((seg, i) => {
    const charCount = seg.text.length;
    const durSec = Math.max(2, Math.round(charCount / 4));
    const startSec = accTime;
    const endSec = accTime + durSec;
    accTime = endSec;
    const fmt = (s) => { const m = Math.floor(s/60); const ss = s%60; return String(m).padStart(2,'0')+':'+String(ss).padStart(2,'0'); };
    const exprLabel = exprLabels[seg.expression] || seg.expression;
    return `<div class="av-seg-item">
      <div class="av-seg-idx">${i + 1}</div>
      <div class="av-seg-body">
        <div class="av-seg-time" style="font-size:10px;color:var(--accent);font-family:'SF Mono',monospace;margin-bottom:2px">${fmt(startSec)} - ${fmt(endSec)}</div>
        <div class="av-seg-text">${esc(seg.text)}</div>
        <div class="av-seg-meta">
          <span class="av-seg-tag">${charCount}字 · ${durSec}s</span>
          <span class="av-seg-tag expr">${exprLabel}</span>
        </div>
      </div>
    </div>`;
  }).join('');
  // 更新总时长
  countEl.textContent = `${avatarSegments.length} 段 · 约${Math.floor(accTime/60)}分${accTime%60}秒`;
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

let _avatarPresetsData = null; // { avatars, avatarMeta, backgrounds, categories }
let _avatarCatFilter = '';

async function loadAvatarPresets() {
  try {
    const resp = await authFetch('/api/avatar/presets');
    const data = await resp.json();
    if (!data.success) return;
    _avatarPresetsData = data;
    renderAvatarGrid();
    // 背景预设沿用老逻辑
    for (const [key, url] of Object.entries(data.backgrounds || {})) {
      if (url) applyPresetImage('.av-preset-bg', key, url);
    }
  } catch {}
}

function renderAvatarGrid() {
  const grid = document.getElementById('av-avatar-grid');
  if (!grid || !_avatarPresetsData) return;
  const meta = _avatarPresetsData.avatarMeta || {};
  const urls = _avatarPresetsData.avatars || {};

  // 清掉现有预设卡（保留 data-fixed="1" 的上传/形象库卡）
  [...grid.querySelectorAll('.av-avatar-card[data-avatar]')].forEach(c => c.remove());

  const gradientPool = [
    'linear-gradient(135deg,#667eea,#764ba2)',
    'linear-gradient(135deg,#3a7bd5,#00d2ff)',
    'linear-gradient(135deg,#4facfe,#00f2fe)',
    'linear-gradient(135deg,#43e97b,#38f9d7)',
    'linear-gradient(135deg,#fa709a,#fee140)',
    'linear-gradient(135deg,#ff9a9e,#fad0c4)',
    'linear-gradient(135deg,#a1c4fd,#c2e9fb)',
    'linear-gradient(135deg,#ffecd2,#fcb69f)',
    'linear-gradient(135deg,#84fab0,#8fd3f4)',
    'linear-gradient(135deg,#fbc2eb,#a6c1ee)',
  ];

  const fragments = [];
  Object.entries(meta).forEach(([key, m], i) => {
    const cat = m.category || 'general';
    if (_avatarCatFilter && cat !== _avatarCatFilter) return;
    const grad = gradientPool[i % gradientPool.length];
    fragments.push(`
      <div class="av-avatar-card" data-avatar="${key}" data-cat="${cat}" onclick="selectAvatar(this)">
        <div class="av-avatar-img av-preset-avatar" data-preset="${key}" style="background:${grad}">
          <svg class="av-avatar-fallback" width="28" height="28" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="#fff" stroke-width="1.2" opacity=".9"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke="#fff" stroke-width="1.2" opacity=".7" stroke-linecap="round"/></svg>
        </div>
        <span>${m.name || key}</span>
      </div>
    `);
  });

  // 固定卡（上传/形象库）保留在最前，预设卡追加到后面
  const fixed = [...grid.querySelectorAll('.av-avatar-card[data-fixed="1"]')];
  grid.innerHTML = fixed.map(el => el.outerHTML).join('') + fragments.join('');

  // 异步回填已生成的预设图
  for (const [key, url] of Object.entries(urls)) {
    if (url) applyPresetImage('.av-preset-avatar', key, url);
  }

  // 默认选第一个预设卡（若当前未选中任何 avatar）
  if (!avatarSelected) {
    const first = grid.querySelector('.av-avatar-card[data-avatar]');
    if (first) { first.classList.add('active'); avatarSelected = first.dataset.avatar; }
  } else {
    const restore = grid.querySelector(`.av-avatar-card[data-avatar="${avatarSelected}"]`);
    if (restore) restore.classList.add('active');
  }
}

function filterAvatarGrid(btn, cat) {
  _avatarCatFilter = cat || '';
  document.querySelectorAll('#av-avatar-cats .av-cat-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderAvatarGrid();
}
window.filterAvatarGrid = filterAvatarGrid;

function applyPresetImage(selector, key, url) {
  const el = document.querySelector(`${selector}[data-preset="${key}"]`);
  if (!el) return;
  const token = getToken() || '';
  const fullUrl = url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
  const img = new Image();
  img.onload = () => {
    el.classList.add('has-img');
    el.style.background = 'none';
    // 清除可能残留的文字节点，再插入图片
    [...el.childNodes].forEach(n => { if (n.nodeType === 3 || (n.nodeType === 1 && !n.tagName?.match(/^IMG$/i))) { if (n.tagName !== 'SPAN' || !n.className?.includes('av-bg-fallback')) n.remove(); } });
    el.insertBefore(img, el.firstChild);
    el.dataset.generated = 'true';
  };
  img.src = fullUrl;
}

// 单个预设图片自动生成（点击预设卡时触发）
async function generateSinglePreset(type, key, imgEl) {
  if (imgEl.dataset.generating) return; // 防重复
  imgEl.dataset.generating = 'true';
  // 显示加载指示
  const origBg = imgEl.style.background;
  imgEl.innerHTML = '<span style="font-size:10px;color:rgba(255,255,255,.7)">生成中...</span>';

  try {
    const resp = await authFetch('/api/avatar/generate-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, keys: [key] })
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);

    const results = type === 'avatar' ? data.results?.avatars : data.results?.backgrounds;
    const url = results?.[key];
    if (url) {
      imgEl.style.backgroundImage = `url(${url})`;
      imgEl.style.backgroundSize = 'cover';
      imgEl.style.backgroundPosition = 'center';
      imgEl.innerHTML = '';
      imgEl.dataset.generated = 'true';
    } else {
      imgEl.innerHTML = '';
      imgEl.style.background = origBg;
    }
  } catch (e) {
    console.warn(`[Preset] ${key} 生成失败:`, e.message);
    imgEl.innerHTML = '';
    imgEl.style.background = origBg;
  } finally {
    delete imgEl.dataset.generating;
  }
}

// AI 生成新素材（背景/人物）通用 dialog — 单张生成并入库成为新卡片
// type: 'background' | 'avatar'
function openCustomGenModal(type) {
  return new Promise(resolve => {
    const isBg = type === 'background';
    const title = isBg ? 'AI 生成背景图' : 'AI 生成新人物形象';
    const examples = isBg ? [
      { ico: '🏖️', name: '海边咖啡馆', text: '海边咖啡馆的露台，黄昏时分，有绿植、藤椅和远处海景' },
      { ico: '💻', name: '科技办公室', text: '科技感未来办公室，深蓝色调，大屏幕显示代码和数据，悬浮全息UI' },
      { ico: '🍵', name: '中式茶室', text: '中式茶室，木质桌椅和山水画，温暖灯光，传统屏风' },
      { ico: '🏠', name: '北欧客厅', text: '北欧风格客厅，白色木地板，灰色沙发，绿植，落地窗，柔和自然光' },
      { ico: '📚', name: '复古书房', text: '复古书房，深色木质书架，皮质沙发，台灯，温暖琥珀色调' },
      { ico: '🌃', name: '赛博朋克', text: '赛博朋克霓虹街道，雨天，全息广告牌，紫色和青色光影' },
    ] : [
      { ico: '👔', name: '金融分析师', text: '30岁华人男性金融分析师，灰色定制西装，白衬衫，精致眼镜，专业自信的表情，落地窗办公室背景虚化' },
      { ico: '🧪', name: '科研女学者', text: '35岁亚洲女性科研学者，白色实验袍，知性短发，细框眼镜，温和坚定的微笑，实验室背景虚化' },
      { ico: '💪', name: '健身达人', text: '27岁亚洲男性健身教练，紧身黑色运动背心，阳光健康的笑容，健身房背景虚化' },
      { ico: '🎤', name: '综艺 MC', text: '28岁亚洲女性综艺主持人，亮色职业装，活力灿烂笑容，大爱心耳环，演播室背景' },
      { ico: '🎨', name: '艺术家', text: '35岁男性艺术家，休闲衬衫配围裙，沾有颜料，创作专注眼神，画室背景' },
      { ico: '🍳', name: '厨师', text: '40岁华人大厨，白色厨师服，自信和善笑容，厨房背景' },
    ];
    let modal = document.getElementById('custom-gen-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'custom-gen-modal';
    modal.className = 'bgpm-modal';
    modal.innerHTML = `
      <div class="bgpm-backdrop"></div>
      <div class="bgpm-panel">
        <div class="bgpm-hd">
          <div class="bgpm-title">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="color:var(--accent)"><path d="M8 1l1.8 4.6L14 6l-3.4 3.2L11.4 14 8 11.6 4.6 14l.8-4.8L2 6l4.2-.4z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
            ${title}
          </div>
          <button class="bgpm-close" onclick="closeCustomGenModal(null)">×</button>
        </div>
        <div class="bgpm-body">
          <label class="bgpm-label">名称（显示在卡片下方，可选）</label>
          <input class="bgpm-textarea" id="cgm-name" style="height:30px;padding:4px 10px" placeholder="例：我的海边咖啡馆" maxlength="12" />
          <label class="bgpm-label" style="margin-top:10px">详细描述 *必填</label>
          <textarea class="bgpm-textarea" id="cgm-desc" rows="3" placeholder="${isBg ? '描述你想要的背景图场景，越细越好（光线/色调/物品/氛围）' : '描述人物（年龄/性别/服装/发型/表情/职业场景）'}"></textarea>
          <div class="bgpm-hint">参考示例（点击填入）：</div>
          <div class="bgpm-examples">
            ${examples.map(e => `<span class="bgpm-chip" data-ex="${e.text.replace(/"/g, '&quot;')}">${e.ico} ${e.name}</span>`).join('')}
          </div>
          <div id="cgm-status" style="margin-top:10px;font-size:11px;color:var(--text3);min-height:16px"></div>
        </div>
        <div class="bgpm-ft">
          <button class="bgpm-btn-cancel" onclick="closeCustomGenModal(null)">取消</button>
          <button class="bgpm-btn-ok" id="cgm-ok-btn" onclick="submitCustomGen('${type}')">生成</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('.bgpm-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const ta = document.getElementById('cgm-desc');
        ta.value = chip.dataset.ex;
        ta.focus();
      });
    });
    modal.querySelector('.bgpm-backdrop').addEventListener('click', () => closeCustomGenModal(null));
    const handler = (e) => {
      if (e.key === 'Escape') { closeCustomGenModal(null); document.removeEventListener('keydown', handler); }
    };
    document.addEventListener('keydown', handler);
    requestAnimationFrame(() => { modal.classList.add('open'); document.getElementById('cgm-desc')?.focus(); });
    window._customGenResolve = (val) => { resolve(val); };
  });
}

async function submitCustomGen(type) {
  const desc = document.getElementById('cgm-desc').value.trim();
  const name = document.getElementById('cgm-name').value.trim();
  if (!desc || desc.length < 5) {
    const s = document.getElementById('cgm-status');
    if (s) { s.style.color = 'var(--error)'; s.textContent = '⚠ 请输入至少 5 个字的描述'; }
    return;
  }
  const btn = document.getElementById('cgm-ok-btn');
  const status = document.getElementById('cgm-status');
  btn.disabled = true;
  btn.innerHTML = '<span class="av-spinner av-spinner-sm" style="display:inline-block;margin-right:4px"></span>生成中...';
  status.style.color = 'var(--text3)';
  status.textContent = '🎨 AI 正在生成（10-30 秒）...';
  try {
    const r = await authFetch('/api/avatar/generate-custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, name, description: desc }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    status.style.color = 'var(--accent)';
    status.textContent = '✓ 生成成功';
    setTimeout(() => closeCustomGenModal(j.item), 400);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '重试';
    status.style.color = 'var(--error)';
    status.textContent = '⚠ ' + e.message;
  }
}

function closeCustomGenModal(item) {
  const modal = document.getElementById('custom-gen-modal');
  if (modal) {
    modal.classList.remove('open');
    setTimeout(() => modal.remove(), 200);
  }
  if (window._customGenResolve) {
    window._customGenResolve(item);
    window._customGenResolve = null;
  }
}

// 兼容旧调用
function openBgPromptModal() { return openCustomGenModal('background').then(item => item?.description || null); }
function closeBgPromptModal() { closeCustomGenModal(null); }

// 生成自定义素材 → 添加到 UI
async function generateCustomAvatar() {
  const item = await openCustomGenModal('avatar');
  if (!item) return;
  addCustomAvatarCard(item);
  showToast('新人物形象已添加：' + item.name, 'success');
}
async function generateCustomBackground() {
  const item = await openCustomGenModal('background');
  if (!item) return;
  addCustomBackgroundCard(item);
  showToast('新背景已添加：' + item.name, 'success');
}

function addCustomAvatarCard(item) {
  const grid = document.getElementById('av-avatar-grid');
  if (!grid) return;
  // 避免重复
  if (grid.querySelector(`[data-avatar="${item.id}"]`)) return;
  const card = document.createElement('div');
  card.className = 'av-avatar-card';
  card.dataset.avatar = item.id;
  card.dataset.category = 'custom';
  card.dataset.gender = 'neutral';
  card.title = item.description;
  card.innerHTML = `
    <div class="av-avatar-img av-preset-avatar has-img" data-generated="true" style="background-image:url(${authUrl(item.imgPath)});background-size:cover;background-position:center"></div>
    <span>${esc(item.name)}</span>
    <button onclick="event.stopPropagation();deleteCustomItem('${item.id}',this,'avatar')" style="position:absolute;top:4px;right:4px;width:16px;height:16px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;border:none;cursor:pointer;font-size:10px;line-height:1;display:flex;align-items:center;justify-content:center;opacity:.5" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.5">×</button>
  `;
  card.style.position = 'relative';
  card.onclick = () => selectAvatar(card);
  grid.appendChild(card);
}

function addCustomBackgroundCard(item) {
  const grid = document.getElementById('av-bg-grid');
  if (!grid) return;
  if (grid.querySelector(`[data-bg="${item.id}"]`)) return;
  const card = document.createElement('div');
  card.className = 'av-bg-card';
  card.dataset.bg = item.id;
  card.title = item.description;
  card.style.position = 'relative';
  card.innerHTML = `
    <div class="av-bg-preview av-preset-bg has-img" data-generated="true" style="background-image:url(${authUrl(item.imgPath)});background-size:cover;background-position:center"></div>
    <span>${esc(item.name)}</span>
    <button onclick="event.stopPropagation();deleteCustomItem('${item.id}',this,'background')" style="position:absolute;top:4px;right:4px;width:16px;height:16px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;border:none;cursor:pointer;font-size:10px;line-height:1;display:flex;align-items:center;justify-content:center;opacity:.5" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.5">×</button>
  `;
  card.onclick = () => selectAvatarBg(card);
  grid.appendChild(card);
}

async function deleteCustomItem(id, btn, type) {
  if (!confirm('删除这个自定义素材？')) return;
  try {
    await authFetch('/api/avatar/custom-items/' + encodeURIComponent(id), { method: 'DELETE' });
    const card = btn.closest(type === 'avatar' ? '.av-avatar-card' : '.av-bg-card');
    if (card) card.remove();
  } catch (e) {
    alert('删除失败: ' + e.message);
  }
}

// 页面加载时拉取已生成的自定义素材
async function loadCustomItems() {
  try {
    const r = await authFetch('/api/avatar/custom-items');
    const j = await r.json();
    if (!j.success) return;
    (j.avatars || []).forEach(addCustomAvatarCard);
    (j.backgrounds || []).forEach(addCustomBackgroundCard);
  } catch (e) { console.warn('[Avatar] loadCustomItems:', e.message); }
}

// 批量补生缺失预设 — 3 并发 + 进度提示
let _backfillInProgress = false;
async function autoBackfillMissingPresets(force = false) {
  if (_backfillInProgress) return;
  const missingAvatars = [];
  document.querySelectorAll('#av-avatar-grid .av-avatar-card[data-avatar]').forEach(card => {
    if (card.dataset.fixed === '1') return;
    const id = card.dataset.avatar;
    const img = card.querySelector('.av-preset-avatar');
    if (!img) return;
    const hasImg = img.dataset.generated === 'true' || img.classList.contains('has-img') || img.querySelector('img');
    if (!hasImg && !id.startsWith('custom_')) missingAvatars.push({ id, img });
  });
  if (!missingAvatars.length) return;
  _backfillInProgress = true;

  console.log(`[Avatar] 检测到 ${missingAvatars.length} 个未生成的预设头像，3 并发补生...`);
  if (typeof showToast === 'function') showToast(`正在 AI 补生 ${missingAvatars.length} 个头像...`, 'info');

  // 显示全局进度条
  let progressEl = document.getElementById('av-backfill-progress');
  if (!progressEl) {
    progressEl = document.createElement('div');
    progressEl.id = 'av-backfill-progress';
    progressEl.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:200;background:var(--bg2);border:1px solid rgba(var(--accent-rgb),.3);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--text);box-shadow:0 4px 20px rgba(0,0,0,.3);display:flex;align-items:center;gap:8px';
    document.body.appendChild(progressEl);
  }
  let done = 0, failed = 0;
  const updateProgress = () => {
    progressEl.innerHTML = `<span class="av-spinner av-spinner-sm" style="display:inline-block"></span>
      <span>AI 补生头像 ${done}/${missingAvatars.length}${failed ? ` · <span style="color:var(--error)">${failed} 失败</span>` : ''}</span>`;
  };
  updateProgress();

  const CONCURRENCY = 3;
  let cursor = 0;
  async function worker() {
    while (cursor < missingAvatars.length) {
      const my = missingAvatars[cursor++];
      if (!my || my.img.dataset.generating || my.img.dataset.generated === 'true') continue;
      try {
        await generateSinglePreset('avatar', my.id, my.img);
        // 检查是否真的生成了
        if (my.img.dataset.generated === 'true') done++;
        else failed++;
      } catch { failed++; }
      updateProgress();
      // 相邻同一 worker 间轻微延迟避免触发并发限流
      await new Promise(r => setTimeout(r, 800));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  progressEl.innerHTML = `<span style="color:var(--accent)">✓</span> 完成 ${done}/${missingAvatars.length}${failed ? ` · <span style="color:var(--error)">${failed} 失败</span>` : ''}`;
  setTimeout(() => progressEl.remove(), 5000);
  _backfillInProgress = false;
  if (failed > 0) console.warn(`[Avatar] ${failed} 个预设补生失败。点击对应卡片会触发单独重试，或检查 AI 配置中的图像模型。`);
}

async function generateAvatarPresets(type) {
  const btnId = type === 'background' ? 'av-gen-bg-btn' : 'av-gen-presets-btn';
  const btn = document.getElementById(btnId);
  if (!btn) return;

  // 背景图：先用自定义模态框问用户描述
  let customPrompt = '';
  if (type === 'background') {
    customPrompt = await openBgPromptModal();
    if (customPrompt === null) return; // 用户取消
  }

  const origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="av-spinner av-spinner-sm" style="display:inline-block"></span> 生成中...';

  try {
    const resp = await authFetch('/api/avatar/generate-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: type || 'avatar', customPrompt })
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
    if (!data.success) return;
    const providers = data.data?.providers || [];
    // v15: 改成下拉 select
    const sel = document.getElementById('ig-model-select');
    if (!sel) {
      // 旧版兼容：还在用 div 卡片
      const container = document.getElementById('ig-model-selector');
      if (!container) return;
      let html = `<div class="ig-model-opt active" data-model="auto" onclick="selectIgModel(this)">
        <span class="ig-model-icon">A</span>
        <div class="ig-model-info"><div class="ig-model-name">自动选择</div><div class="ig-model-desc">根据配置自动匹配最佳模型</div></div>
      </div>`;
      providers.forEach(p => {
        if (!p.enabled || !(p.api_key || p.api_key_masked)) return;
        (p.models || []).forEach(m => {
          if (m.enabled === false || m.use !== 'image') return;
          const initial = (p.name || p.id || '?')[0].toUpperCase();
          html += `<div class="ig-model-opt" data-model="${m.id}" data-provider="${p.id}" onclick="selectIgModel(this)">
            <span class="ig-model-icon">${initial}</span>
            <div class="ig-model-info"><div class="ig-model-name">${esc(m.name || m.id)}</div><div class="ig-model-desc">${esc(p.name || p.id)}</div></div>
          </div>`;
        });
      });
      container.innerHTML = html;
      return;
    }
    // 新版下拉
    let html = `<option value="auto" data-provider="">自动选择 (按配置匹配)</option>`;
    let count = 0;
    // 按 provider 分组
    providers.forEach(p => {
      if (!p.enabled || !(p.api_key || p.api_key_masked)) return;
      const imageModels = (p.models || []).filter(m => m.enabled !== false && m.use === 'image');
      if (!imageModels.length) return;
      html += `<optgroup label="${esc(p.name || p.id)}">`;
      imageModels.forEach(m => {
        count++;
        const value = `${p.id}::${m.id}`;
        html += `<option value="${esc(value)}" data-provider="${esc(p.id)}" data-model="${esc(m.id)}">${esc(m.name || m.id)}</option>`;
      });
      html += `</optgroup>`;
    });
    console.log(`[loadIgModels] 加载 ${count} 个图片模型 (下拉)`);
    sel.innerHTML = html;
  } catch (e) {
    console.warn('[loadIgModels] failed:', e);
  }
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
    // v15: 优先读 select 下拉，回退到旧 ig-model-opt.active
    let modelId = 'auto', providerId = '';
    const sel = document.getElementById('ig-model-select');
    if (sel && sel.value && sel.value !== 'auto') {
      const [pid, mid] = sel.value.split('::');
      providerId = pid || '';
      modelId = mid || sel.value;
    } else {
      const activeModel = document.querySelector('.ig-model-opt.active');
      modelId = activeModel?.dataset.model || 'auto';
      providerId = activeModel?.dataset.provider || '';
    }
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
  const grid = document.getElementById('assets-grid');
  const wfList = document.getElementById('workflow-list');
  if (type === 'workflow') {
    grid.style.display = 'none';
    wfList.style.display = 'block';
    loadWorkflowList();
  } else {
    grid.style.display = '';
    wfList.style.display = 'none';
    loadAssetsPage();
  }
}

// ═══ 画布列表 ═══
async function loadWorkflowList() {
  const list = document.getElementById('workflow-list');
  list.innerHTML = '<div class="assets-empty">加载中...</div>';
  try {
    const res = await authFetch('/api/workflow');
    const data = await res.json();
    const workflows = data.success ? (data.data || []) : [];
    if (workflows.length === 0) {
      list.innerHTML = '<div class="assets-empty">暂无保存的画布，在工作流画布中点击「保存」来保存进度</div>';
      return;
    }
    list.innerHTML = `
      <table class="wf-table">
        <thead><tr>
          <th>画布名称</th>
          <th>节点数</th>
          <th>进度</th>
          <th>更新时间</th>
          <th>操作</th>
        </tr></thead>
        <tbody>${workflows.map(w => {
          const nodeCount = countWorkflowNodes(w.drawflow);
          const progress = calcWorkflowProgress(w);
          const time = w.updated_at ? new Date(w.updated_at).toLocaleString('zh-CN') : '-';
          return `<tr>
            <td><strong>${w.name || '未命名'}</strong></td>
            <td>${nodeCount}</td>
            <td>
              <div class="wf-progress-bar"><div class="wf-progress-fill" style="width:${progress}%"></div></div>
              <span class="wf-progress-text">${progress}%</span>
            </td>
            <td style="color:var(--text2);font-size:12px">${time}</td>
            <td>
              <button class="wf-tbl-btn" onclick="openWorkflow('${w.id}')">继续编辑</button>
              <button class="wf-tbl-btn wf-tbl-btn-danger" onclick="deleteWorkflow('${w.id}')">删除</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  } catch(e) {
    list.innerHTML = '<div class="assets-empty">加载画布列表失败</div>';
  }
}

function countWorkflowNodes(drawflow) {
  try {
    const d = typeof drawflow === 'string' ? JSON.parse(drawflow) : drawflow;
    return Object.keys(d?.drawflow?.Home?.data || {}).length;
  } catch { return 0; }
}

function calcWorkflowProgress(w) {
  try {
    const d = typeof w.drawflow === 'string' ? JSON.parse(w.drawflow) : w.drawflow;
    const nodes = Object.values(d?.drawflow?.Home?.data || {});
    if (nodes.length === 0) return 0;
    // 统计：有预览或已完成状态的节点 / 总节点
    let done = 0;
    nodes.forEach(n => {
      const data = n.data || {};
      if (data._previewImg || data._previewVid || (data._statusClass && data._statusClass.includes('done'))) done++;
      else if (data._textareas && data._textareas.some(t => t && t.length > 10)) done += 0.5;
    });
    return Math.min(100, Math.round((done / nodes.length) * 100));
  } catch { return 0; }
}

function openWorkflow(id) {
  switchPage('workflow');
  setTimeout(() => {
    const iframe = document.getElementById('workflow-iframe');
    if (iframe) iframe.src = '/workflow.html?id=' + id;
  }, 100);
}

async function deleteWorkflow(id) {
  if (!confirm('确定删除此画布？不可恢复。')) return;
  try {
    await authFetch('/api/workflow/' + id, { method: 'DELETE' });
    loadWorkflowList();
  } catch(e) {
    alert('删除失败');
  }
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

    // 自动选择章节：仅在首次选择小说时跳到有内容的章节
    // 手动切换章节时（非首次选择），保持用户选择的章节不变
    if (isNewSelect) {
      const firstWithContent = (novel.chapters || []).find(c => c.content && c.content.trim());
      if (firstWithContent) nvCurrentChapter = firstWithContent.index;
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
    const outlineTitle = novel.outline?.chapters?.find(c => c.index === i)?.title || '';
    const displayTitle = outlineTitle ? `第${i}章·${outlineTitle}` : `第${i}章`;
    html += `<button class="nv-ch-tab ${active} ${done}" onclick="nvSwitchChapter(${i})" oncontextmenu="event.preventDefault();nvDeleteChapter(${i})" title="${esc(title)}（右键删除）">${esc(displayTitle)}</button>`;
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
  loadPtrImageModels();
}

async function loadPtrImageModels() {
  const sel = document.getElementById('ptr-model-select');
  if (!sel) return;
  try {
    const resp = await authFetch('/api/settings');
    const data = await resp.json();
    if (!data.success) return;
    const providers = data.data?.providers || [];
    let html = '<option value="auto">自动选择（按配置匹配）</option>';
    let count = 0;
    providers.forEach(p => {
      if (!p.enabled || !(p.api_key || p.api_key_masked)) return;
      const imageModels = (p.models || []).filter(m => m.enabled !== false && m.use === 'image');
      if (!imageModels.length) return;
      html += `<optgroup label="${esc(p.name || p.id)}">`;
      imageModels.forEach(m => {
        count++;
        html += `<option value="${esc(p.id + '::' + m.id)}">${esc(m.name || m.id)}</option>`;
      });
      html += '</optgroup>';
    });
    sel.innerHTML = html;
    console.log(`[Portrait] 加载 ${count} 个图片模型`);
  } catch (e) {
    console.warn('[Portrait] 加载模型列表失败:', e);
  }
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
    const imageModel = document.getElementById('ptr-model-select')?.value || 'auto';
    const res = await authFetch('/api/portrait/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_filename: ptrPhotoFilename, dim: ptrDim, name, image_model: imageModel })
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

async function loadCloneEngines() {
  try {
    const resp = await authFetch('/api/workbench/clone-engines');
    const data = await resp.json();
    const sel = document.getElementById('vc-engine-select');
    const hint = document.getElementById('vc-engine-hint');
    if (!sel) return;
    const engines = data.engines || [];
    const usable = engines.filter(e => e.usable);

    // 重置下拉
    sel.innerHTML = usable.length > 1
      ? `<option value="">自动（推荐 · 按优先链回退）</option>`
      : '';

    for (const e of engines) {
      const label = e.usable ? `${e.name} — ${e.desc}` : `${e.name} — ${e.reason}`;
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = label;
      opt.disabled = !e.usable;
      sel.appendChild(opt);
    }

    if (hint) {
      if (!usable.length) {
        hint.innerHTML = '⚠️ <b style="color:#f59e0b">未检测到可用克隆引擎</b>。请到「AI 配置」页面配置：阿里 DashScope（sk-* 且账号开通 voice_customization）或 火山引擎（格式 <code>appId:accessToken</code>），再回来克隆';
      } else {
        hint.innerHTML = `✓ 已检测到 <b style="color:#22c55e">${usable.length}</b> 个可用引擎：${usable.map(e => e.name).join('、')}`;
      }
    }

    sel.onchange = () => {
      if (!hint) return;
      const eng = engines.find(e => e.id === sel.value);
      if (eng) hint.innerHTML = `<b>${eng.name}</b>：${eng.desc}${eng.keyFormat ? `（Key 格式：<code>${eng.keyFormat}</code>）` : ''}`;
    };
  } catch (e) { console.warn('loadCloneEngines:', e.message); }
}

async function loadVoiceClonePage() {
  // 加载可用的克隆引擎填到下拉（带配置状态提示）
  loadCloneEngines();
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
      const providerName = v.clone_provider === 'aliyun-tts' ? '☁️ 阿里 CosyVoice' : v.clone_provider === 'volcengine' ? '🌋 火山引擎' : '';
      const statusTag = v.cloned
        ? `<span class="tag tag-green">${providerName || '语音包就绪'}</span>`
        : '<span class="tag tag-yellow">仅本地</span>';
      const statusHint = v.cloned
        ? `<div style="font-size:10px;color:#22c55e;margin-top:2px;">${providerName} 声音克隆已就绪</div>`
        : `<div style="font-size:10px;color:#8b8fa3;margin-top:2px;">可用于 TTS（配置火山引擎声音复刻效果更佳）</div>`;
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
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button onclick="vcPlayVoice('${v.id}')" style="padding:6px 14px;background:var(--bg3);color:var(--text);border:1px solid var(--border);border-radius:6px;font-size:12px;cursor:pointer;" title="播放你上传的原始样本">▶ 原样试听</button>
          ${v.cloned ? `<button onclick="vcPreviewCloneEffect('${v.id}', this)" style="padding:6px 14px;background:var(--accent);color:#000;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;" title="用克隆出的声音合成一段测试语句">🎵 克隆效果试听</button>` : ''}
          <button onclick="vcUseVoice('${v.id}','${esc(v.name)}')" style="padding:6px 14px;background:none;color:var(--text2);border:1px solid var(--border);border-radius:6px;font-size:12px;cursor:pointer;">使用此声音</button>
          <button onclick="vcDeleteVoice('${v.id}')" style="padding:6px 14px;background:rgba(239,68,68,.1);color:#ef4444;border:none;border-radius:6px;font-size:12px;cursor:pointer;margin-left:auto;">🗑 删除</button>
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

  const engine = document.getElementById('vc-engine-select')?.value || '';
  const fd = new FormData();
  fd.append('audio', vcUploadedFile);
  fd.append('name', name);
  if (engine) fd.append('engine', engine);
  try {
    s1.textContent = '已完成'; s1.style.color = '#22c55e';
    s2.textContent = '处理中...'; s2.style.color = 'var(--accent)';
    const resp = await authFetch('/api/workbench/upload-voice', { method: 'POST', body: fd });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);
    s2.textContent = '已完成'; s2.style.color = '#22c55e';
    const providerLabel = data.cloneProvider === 'aliyun-tts' ? '阿里 CosyVoice' : data.cloneProvider === 'volcengine' ? '火山引擎声音复刻' : '';
    s3.textContent = data.cloned ? `已完成（${providerLabel}）` : '跳过（未配置语音克隆API）';
    s3.style.color = data.cloned ? '#22c55e' : '#f59e0b';
    btn.textContent = data.cloned ? `✅ 克隆完成！(${providerLabel})` : '✅ 已保存（配置阿里 DashScope 或 火山引擎可克隆）';
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

// 用克隆后的声音合成一段测试台词，让用户听"克隆效果"
async function vcPreviewCloneEffect(id, btn) {
  const text = prompt('输入试听文本（<=100 字，留空用默认）', '你好，这里是我的克隆声音试听，欢迎使用 VIDO。');
  if (text === null) return;
  const label = btn.textContent; btn.textContent = '⏳ 合成中...'; btn.disabled = true;
  if (_globalAudio) { _globalAudio.pause(); _globalAudio.src = ''; _globalAudio = null; }
  try {
    const resp = await authFetch(`/api/workbench/voices/${id}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text || undefined, speed: 1.0 }),
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || '合成失败');
    _globalAudio = new Audio(data.url);
    _globalAudio.onended = () => { _globalAudio = null; };
    await _globalAudio.play();
  } catch (err) {
    alert('克隆试听失败: ' + err.message + '\n\n可能原因：\n- 克隆还没成功（看卡片右上角 tag 是否是绿色）\n- 阿里 / 火山 API Key 失效\n- 网络超时');
  } finally {
    btn.textContent = label; btn.disabled = false;
  }
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
// ═══════════════════════════════════════════════════
// AI 网剧（项目→剧集层级）
// ═══════════════════════════════════════════════════

let dramaProjects = [];
let currentDramaProject = null;
let currentDramaEpisode = null;
let dramaResult = null;
let dramaSelectedScene = -1;
let dramaMotions = [];
let dramaShotScales = [];
let dcpChars = []; // 创建项目弹窗用的角色

const DRAMA_MOTION_MAP = { '推进':'↗','后拉':'↙','左摇':'←','右摇':'→','上仰':'↑','下俯':'↓','环绕':'⟳','升镜':'⬆','降镜':'⬇','跟踪':'🏃','穿越':'✈','POV':'👁','荷兰角':'📐','甩镜':'💨','焦点转移':'🎯','手持':'🤳','稳定跟':'🎥','静止':'⏸','微推':'🔹','视差':'🔷','变焦推':'🔍','变焦拉':'🔎' };

function loadDramaPage() {
  loadDramaMotionLib();
  loadDramaProjectsList();
}

async function loadDramaMotionLib() {
  try { const r = await authFetch('/api/drama/motions'); const d = await r.json(); dramaMotions = d.data?.motions || []; dramaShotScales = d.data?.shot_scales || []; } catch {}
}

// ════════ 项目列表视图 ════════
async function loadDramaProjectsList() {
  document.getElementById('drama-view-projects').style.display = '';
  document.getElementById('drama-view-detail').style.display = 'none';
  try {
    const r = await authFetch('/api/drama/projects'); const d = await r.json();
    dramaProjects = d.data || [];
    renderDramaProjectGrid();
  } catch {}
}

function renderDramaProjectGrid() {
  const grid = document.getElementById('drama-proj-grid');
  if (!dramaProjects.length) { grid.innerHTML = '<div style="color:rgba(255,255,255,.25);text-align:center;padding:60px;grid-column:1/-1;font-size:13px">暂无网剧项目，点击上方按钮创建</div>'; return; }
  grid.innerHTML = dramaProjects.map(p => {
    const cover = p.cover_url ? `<img src="${p.cover_url}" />` : '<div class="ph">🎭</div>';
    const planned = p.episode_count || 10;
    const done = p.episodes_done || 0;
    // 全部生成完 (已完成集数 >= 计划集数) 就不显示编辑按钮
    const allDone = done >= planned;
    const editBtn = allDone
      ? `<button title="已完结，不可编辑" disabled style="opacity:.4;cursor:not-allowed;">已完结</button>`
      : `<button onclick="editDramaProject('${p.id}')">编辑</button>`;
    return `<div class="drama-proj-card" onclick="openDramaStudio('${p.id}')">
      <div class="drama-proj-cover">${cover}<div class="drama-proj-ep-badge">${done}/${p.episodes_total || 0} 集</div></div>
      <div class="drama-proj-body">
        <div class="drama-proj-name">${p.title || '未命名'}</div>
        <div class="drama-proj-meta">${p.style || '日系动漫'} · ${planned}集计划 · ${new Date(p.created_at).toLocaleDateString()}</div>
      </div>
      <div class="drama-proj-footer" onclick="event.stopPropagation()">
        <button onclick="openDramaStudio('${p.id}')">进入</button>
        ${editBtn}
        <button class="danger" onclick="deleteDramaProject('${p.id}')">删除</button>
      </div>
    </div>`;
  }).join('');
}

// 进入新版 drama-studio (替代旧 enterDramaProject)
function openDramaStudio(pid) {
  location.href = '/drama-studio.html?pid=' + encodeURIComponent(pid);
}
window.openDramaStudio = openDramaStudio;

// ════════ 编辑项目弹窗 (复用创建弹窗) ════════
let _editingDramaProjectId = null;
async function editDramaProject(pid) {
  try {
    const r = await authFetch('/api/drama/projects/' + pid);
    const j = await r.json();
    if (!j.success) return alert(j.error || '加载失败');
    const p = j.data;
    _editingDramaProjectId = pid;

    // 复用创建弹窗，预填值
    document.getElementById('drama-create-modal').style.display = 'flex';
    // 加载风格选项
    try {
      const r2 = await authFetch('/api/ai-cap/styles');
      const d2 = await r2.json();
      const sel = document.getElementById('dcp-style');
      sel.innerHTML = (d2.data || []).map(s => `<option value="${s.name}">${s.name}</option>`).join('');
    } catch {}
    // 加载真实模型
    await loadDcpModels();

    document.getElementById('dcp-title').value = p.title || '';
    document.getElementById('dcp-synopsis').value = p.synopsis || '';
    document.getElementById('dcp-style').value = p.style || '日系动漫';
    document.getElementById('dcp-motion').value = p.motion_preset || 'cinematic';
    document.getElementById('dcp-episodes').value = p.episode_count || 10;
    document.getElementById('dcp-aspect').value = p.aspect_ratio || '9:16';
    if (document.getElementById('dcp-scenes')) document.getElementById('dcp-scenes').value = p.scene_count || 6;
    if (document.getElementById('dcp-shot-dur')) document.getElementById('dcp-shot-dur').value = p.shot_duration || 8;
    if (document.getElementById('dcp-img-model')) document.getElementById('dcp-img-model').value = p.image_model || 'auto';
    if (document.getElementById('dcp-vid-model')) document.getElementById('dcp-vid-model').value = p.video_model || 'auto';
    dcpChars = p.characters || [];
    renderDcpCharTags();

    // 切换标题 + 按钮文本
    const modal = document.getElementById('drama-create-modal');
    const titleEl = modal.querySelector('div[style*="font-weight:700"]');
    if (titleEl) titleEl.textContent = '编辑网剧';
    const submitBtn = modal.querySelector('button.drama-btn-gen');
    if (submitBtn) {
      submitBtn.textContent = '保存修改';
      submitBtn.setAttribute('onclick', 'submitEditDramaProject()');
    }
  } catch (e) {
    alert('加载失败: ' + e.message);
  }
}
window.editDramaProject = editDramaProject;

async function submitEditDramaProject() {
  if (!_editingDramaProjectId) return;
  try {
    const fields = {
      title: document.getElementById('dcp-title').value.trim(),
      synopsis: document.getElementById('dcp-synopsis').value.trim(),
      style: document.getElementById('dcp-style').value,
      motion_preset: document.getElementById('dcp-motion').value,
      episode_count: parseInt(document.getElementById('dcp-episodes').value || '10'),
      aspect_ratio: document.getElementById('dcp-aspect').value,
      scene_count: parseInt(document.getElementById('dcp-scenes')?.value || '6'),
      shot_duration: parseInt(document.getElementById('dcp-shot-dur')?.value || '8'),
      image_model: document.getElementById('dcp-img-model')?.value || 'auto',
      video_model: document.getElementById('dcp-vid-model')?.value || 'auto',
      characters: dcpChars,
    };
    const r = await authFetch('/api/drama/projects/' + _editingDramaProjectId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    const j = await r.json();
    if (j.success) {
      _editingDramaProjectId = null;
      closeDramaCreateModal();
      // 重置弹窗为创建模式
      const modal = document.getElementById('drama-create-modal');
      const titleEl = modal.querySelector('div[style*="font-weight:700"]');
      if (titleEl) titleEl.textContent = '新建网剧';
      const submitBtn = modal.querySelector('button.drama-btn-gen');
      if (submitBtn) {
        submitBtn.textContent = '创建网剧';
        submitBtn.setAttribute('onclick', 'submitCreateDramaProject()');
      }
      loadDramaProjectsList();
      showToast?.('✓ 已保存修改', 'ok');
    } else {
      alert(j.error || '保存失败');
    }
  } catch (e) {
    alert('保存失败: ' + e.message);
  }
}
window.submitEditDramaProject = submitEditDramaProject;

// ════════ 创建项目弹窗 ════════
async function showCreateDramaProject() {
  document.getElementById('drama-create-modal').style.display = 'flex';
  dcpChars = [];
  document.getElementById('dcp-char-tags').innerHTML = '';
  document.getElementById('dcp-title').value = '';
  document.getElementById('dcp-synopsis').value = '';
  // 加载风格
  try { const r = await authFetch('/api/ai-cap/styles'); const d = await r.json(); const sel = document.getElementById('dcp-style'); sel.innerHTML = (d.data||[]).map(s=>`<option value="${s.name}">${s.name}</option>`).join(''); } catch {}
  // 加载真实图片+视频模型 (Seedance/Sora/Kling/NanoBanana 等)
  await loadDcpModels();
}

// 加载真实可用的图片/视频模型到 dcp 弹窗
async function loadDcpModels() {
  try {
    const res = await authFetch('/api/settings');
    const data = await res.json();
    if (!data.success) return;
    const imgSel = document.getElementById('dcp-img-model');
    const vidSel = document.getElementById('dcp-vid-model');
    if (!imgSel || !vidSel) return;
    let imgH = '<option value="">自动 (按画风优选)</option>';
    let vidH = '<option value="">自动 (按场景优选)</option>';
    for (const p of (data.data.providers || [])) {
      if (!p.enabled || !(p.api_key || p.api_key_masked)) continue;
      for (const m of (p.models || [])) {
        if (m.enabled === false) continue;
        const label = `${p.name} / ${m.name || m.id}`;
        const value = `${p.id}::${m.id}`;
        if (m.use === 'image') imgH += `<option value="${value}">${label}</option>`;
        if (m.use === 'video') vidH += `<option value="${value}">${label}</option>`;
      }
    }
    imgSel.innerHTML = imgH;
    vidSel.innerHTML = vidH;
  } catch (e) {
    console.warn('[loadDcpModels] failed:', e);
  }
}
window.loadDcpModels = loadDcpModels;
function closeDramaCreateModal() {
  document.getElementById('drama-create-modal').style.display = 'none';
  // 重置弹窗为创建模式 (关掉后下次打开是 + 新建)
  _editingDramaProjectId = null;
  const modal = document.getElementById('drama-create-modal');
  const titleEl = modal?.querySelector('div[style*="font-weight:700"]');
  if (titleEl) titleEl.textContent = '新建网剧';
  const submitBtn = modal?.querySelector('button.drama-btn-gen');
  if (submitBtn) {
    submitBtn.textContent = '创建网剧';
    submitBtn.setAttribute('onclick', 'submitCreateDramaProject()');
  }
}

function addDcpChar() { const n = prompt('角色名称'); if (!n) return; dcpChars.push({ name: n, description: '' }); renderDcpCharTags(); }
function importDcpCharFromLib() { showLibraryPicker('characters', { multiple: true, onSelect: items => { for (const c of items) dcpChars.push({ id: c.id, name: c.name, appearance_prompt: c.appearance_prompt || '' }); renderDcpCharTags(); } }); }
function renderDcpCharTags() { document.getElementById('dcp-char-tags').innerHTML = dcpChars.map((c,i) => `<div class="drama-char-tag">${c.name}<span class="remove" onclick="dcpChars.splice(${i},1);renderDcpCharTags()">&times;</span></div>`).join(''); }

async function submitCreateDramaProject() {
  const title = document.getElementById('dcp-title').value.trim();
  if (!title) return alert('请输入网剧标题');
  try {
    // 场景数/时长：若留空，后端按 AI 建议逻辑兜底（默认 6 / 8s）
    const scEl = document.getElementById('dcp-scenes');
    const durEl = document.getElementById('dcp-shot-dur');
    const scVal = scEl?.value?.trim();
    const durVal = durEl?.value?.trim();
    const payload = {
      title,
      synopsis: document.getElementById('dcp-synopsis').value.trim(),
      style: document.getElementById('dcp-style').value || '日系动漫',
      motion_preset: document.getElementById('dcp-motion').value || 'cinematic',
      episode_count: parseInt(document.getElementById('dcp-episodes').value || '10'),
      aspect_ratio: document.getElementById('dcp-aspect')?.value || '9:16',
      image_model: document.getElementById('dcp-img-model')?.value || 'auto',
      video_model: document.getElementById('dcp-vid-model')?.value || 'auto',
      characters: dcpChars,
    };
    // 只在用户明确填了值才传；否则让后端走默认/AI 推断
    if (scVal) payload.scene_count = parseInt(scVal);
    if (durVal) payload.shot_duration = parseInt(durVal);
    const r = await authFetch('/api/drama/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (d.success) { closeDramaCreateModal(); openDramaStudio(d.data.id); }
    else alert(d.error);
  } catch (e) { alert('创建失败: ' + e.message); }
}

// AI 推荐场景数 + 每镜时长
async function suggestSceneParams() {
  const title = document.getElementById('dcp-title')?.value?.trim() || '';
  const synopsis = document.getElementById('dcp-synopsis')?.value?.trim() || '';
  const style = document.getElementById('dcp-style')?.value || '';
  if (!title && !synopsis) { alert('请先填写故事简介或标题'); return; }
  const btn = document.getElementById('dcp-suggest-btn');
  const hint = document.getElementById('dcp-suggest-hint');
  if (btn) { btn.disabled = true; btn.textContent = '分析中…'; }
  if (hint) hint.textContent = 'AI 正在根据简介分析合适的节奏…';
  try {
    const r = await authFetch('/api/drama/suggest-scene-params', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, synopsis, style }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    const { scene_count, shot_duration, total_episode_seconds, reasoning } = j.data;
    const scEl = document.getElementById('dcp-scenes');
    const durEl = document.getElementById('dcp-shot-dur');
    if (scEl) scEl.value = scene_count;
    if (durEl) {
      // 如果选项里没有，则添加
      if (!Array.from(durEl.options).some(o => o.value === String(shot_duration))) {
        const opt = document.createElement('option');
        opt.value = shot_duration; opt.textContent = shot_duration + ' 秒';
        durEl.appendChild(opt);
      }
      durEl.value = shot_duration;
    }
    if (hint) hint.innerHTML = `✓ AI 建议 <b>${scene_count}</b> 场 × <b>${shot_duration}</b> 秒 = 每集 ${total_episode_seconds}s${reasoning ? '　<span style="color:var(--text2)">(' + reasoning + ')</span>' : ''}　<a href="#" onclick="event.preventDefault();document.getElementById('dcp-scenes').value='';document.getElementById('dcp-suggest-hint').textContent='';">清空</a>`;
  } catch (e) {
    if (hint) hint.innerHTML = '<span style="color:#f87171">建议失败：' + (e.message || '') + '</span>';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ AI 建议'; }
  }
}
window.suggestSceneParams = suggestSceneParams;

async function deleteDramaProject(pid) {
  if (!confirm('确定删除此网剧及所有剧集？')) return;
  try { await authFetch(`/api/drama/projects/${pid}`, { method: 'DELETE' }); loadDramaProjectsList(); } catch {}
}

// ════════ 项目详情视图 ════════
async function enterDramaProject(pid) {
  try {
    const r = await authFetch(`/api/drama/projects/${pid}`); const d = await r.json();
    if (!d.success) return alert(d.error);
    currentDramaProject = d.data;
    currentDramaEpisode = null;
    dramaResult = null;
    dramaSelectedScene = -1;

    document.getElementById('drama-view-projects').style.display = 'none';
    document.getElementById('drama-view-detail').style.display = '';
    document.getElementById('drama-detail-title').textContent = currentDramaProject.title;
    // 显示项目基本信息
    const motionLabels = { cinematic: '电影感', documentary: '纪录片', action: '动作片', mv: 'MV风格', romance: '浪漫' };
    const infoEl = document.getElementById('drama-project-info');
    if (infoEl) infoEl.innerHTML = [
      currentDramaProject.style ? `<span style="background:rgba(33,255,243,.08);color:var(--accent-color);padding:1px 8px;border-radius:99px">画风：${currentDramaProject.style}</span>` : '',
      currentDramaProject.motion_preset ? `<span style="background:rgba(255,246,0,.08);color:rgba(255,246,0,.7);padding:1px 8px;border-radius:99px">运镜：${motionLabels[currentDramaProject.motion_preset] || currentDramaProject.motion_preset}</span>` : '',
      `<span style="background:rgba(255,255,255,.05);padding:1px 8px;border-radius:99px">计划${currentDramaProject.episode_count || 10}集</span>`,
    ].filter(Boolean).join('');
    document.getElementById('drama-ep-title').textContent = '分镜时间轴';
    document.getElementById('drama-sb-list').innerHTML = '<div style="color:rgba(255,255,255,.25);text-align:center;padding:60px 20px;font-size:13px">选择左侧剧集或点击「生成新一集」</div>';
    document.getElementById('drama-right-panel').innerHTML = '<div style="color:rgba(255,255,255,.25);text-align:center;padding:40px 10px;font-size:13px">点击分镜查看属性</div>';

    renderDramaEpisodeList();
    loadDramaModels();
    loadDramaDetailStyles();

    // 自动选中第一个已完成的剧集
    const episodes = currentDramaProject.episodes || [];
    const firstDone = episodes.find(e => e.status === 'done');
    if (firstDone) {
      selectDramaEpisode(firstDone.id);
    }
  } catch (e) { alert('加载失败: ' + e.message); }
}

function backToDramaProjects() { loadDramaProjectsList(); }

async function loadDramaDetailStyles() {
  try {
    const r = await authFetch('/api/ai-cap/styles'); const d = await r.json();
    const sel = document.getElementById('drama-detail-style');
    if (!sel) return;
    sel.innerHTML = (d.data || []).map(s => `<option value="${s.name}"${s.name === currentDramaProject?.style ? ' selected' : ''}>${s.name}</option>`).join('');
  } catch {}
  // 运镜预设
  const motionSel = document.getElementById('drama-detail-motion');
  if (motionSel && currentDramaProject?.motion_preset) motionSel.value = currentDramaProject.motion_preset;
  // 输出比例
  const arSel = document.getElementById('drama-aspect-ratio');
  if (arSel && currentDramaProject?.aspect_ratio) arSel.value = currentDramaProject.aspect_ratio;
}

async function updateDramaProjectField(field, value) {
  if (!currentDramaProject) return;
  currentDramaProject[field] = value;
  try {
    await authFetch(`/api/drama/projects/${currentDramaProject.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value })
    });
  } catch {}
}

function renderDramaEpisodeList() {
  const list = document.getElementById('drama-episode-list');
  const episodes = currentDramaProject.episodes || [];
  if (!episodes.length) { list.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.25);padding:8px">暂无剧集</div>'; return; }
  list.innerHTML = episodes.map(ep => {
    const active = currentDramaEpisode?.id === ep.id ? ' active' : '';
    const statusMap = { done: '已完成', processing: '生成中', error: '失败', pending: '待生成', composed: '已合成' };
    return `<div class="drama-ep-item${active}" onclick="selectDramaEpisode('${ep.id}')">
      <div class="drama-ep-idx">${ep.episode_index}</div>
      <div class="drama-ep-name">${ep.title || '第' + ep.episode_index + '集'}</div>
      <div class="drama-ep-status ${ep.status}">${statusMap[ep.status] || ep.status}</div>
      <div class="drama-ep-actions" onclick="event.stopPropagation()">
        <button class="drama-ep-act-btn" title="重命名" onclick="renameDramaEpisode('${ep.id}')">✎</button>
        <button class="drama-ep-act-btn" title="编辑剧本" onclick="editDramaEpisodeTheme('${ep.id}')">📝</button>
        <button class="drama-ep-act-btn danger" title="删除剧集" onclick="deleteDramaEpisode('${ep.id}', ${ep.episode_index})">×</button>
      </div>
    </div>`;
  }).join('');
}

// ════════ 剧集 CRUD ════════
async function renameDramaEpisode(eid) {
  const ep = (currentDramaProject.episodes || []).find(e => e.id === eid);
  if (!ep) return;
  const newTitle = prompt('重命名剧集：', ep.title || `第${ep.episode_index}集`);
  if (!newTitle || newTitle === ep.title) return;
  try {
    const r = await authFetch(`/api/drama/projects/${currentDramaProject.id}/episodes/${eid}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle })
    });
    const d = await r.json();
    if (d.success) {
      ep.title = newTitle;
      renderDramaEpisodeList();
      if (currentDramaEpisode?.id === eid) {
        currentDramaEpisode.title = newTitle;
        const titleEl = document.getElementById('drama-ep-title');
        if (titleEl) titleEl.textContent = `${newTitle} — 分镜`;
      }
      showToast('已重命名', 'ok');
    } else alert('重命名失败: ' + d.error);
  } catch (e) { alert('重命名失败: ' + e.message); }
}

async function editDramaEpisodeTheme(eid) {
  const ep = (currentDramaProject.episodes || []).find(e => e.id === eid);
  if (!ep) return;
  const newTheme = prompt('编辑本集剧本/主题（保存后下次重生成时生效）：', ep.theme || '');
  if (newTheme === null) return;
  try {
    const r = await authFetch(`/api/drama/projects/${currentDramaProject.id}/episodes/${eid}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: newTheme })
    });
    const d = await r.json();
    if (d.success) {
      ep.theme = newTheme;
      showToast('剧本已保存', 'ok');
    } else alert('保存失败: ' + d.error);
  } catch (e) { alert('保存失败: ' + e.message); }
}

async function deleteDramaEpisode(eid, idx) {
  if (!confirm(`确定删除「第${idx}集」?\n此操作会同时删除该集所有分镜图、视频和成片文件,不可恢复。`)) return;
  try {
    const r = await authFetch(`/api/drama/projects/${currentDramaProject.id}/episodes/${eid}`, { method: 'DELETE' });
    const d = await r.json();
    if (d.success) {
      // 从本地列表移除
      currentDramaProject.episodes = (currentDramaProject.episodes || []).filter(e => e.id !== eid);
      // 如果删除的是当前选中的, 清空中央
      if (currentDramaEpisode?.id === eid) {
        currentDramaEpisode = null;
        dramaResult = null;
        const listEl = document.getElementById('drama-sb-list');
        if (listEl) listEl.innerHTML = '<div style="color:rgba(255,255,255,.25);text-align:center;padding:60px 20px;font-size:13px">选择左侧剧集或点击「生成新一集」</div>';
        document.getElementById('drama-ep-title').textContent = '分镜时间轴';
        const fp = document.getElementById('drama-final-panel'); if (fp) fp.style.display = 'none';
      }
      renderDramaEpisodeList();
      showToast(`已删除第 ${idx} 集`, 'ok');
    } else alert('删除失败: ' + d.error);
  } catch (e) { alert('删除失败: ' + e.message); }
}

async function selectDramaEpisode(eid) {
  try {
    const r = await authFetch(`/api/drama/projects/${currentDramaProject.id}/episodes/${eid}`);
    const d = await r.json();
    if (!d.success) return;
    currentDramaEpisode = d.data;
    dramaResult = d.data.result;
    dramaSelectedScene = -1;

    document.getElementById('drama-ep-title').textContent = `${currentDramaEpisode.title || '第' + currentDramaEpisode.episode_index + '集'} — 分镜`;

    if (dramaResult) renderDramaSBList();
    else document.getElementById('drama-sb-list').innerHTML = '<div style="color:rgba(255,255,255,.25);text-align:center;padding:60px">此剧集尚未生成</div>';

    document.getElementById('drama-right-panel').innerHTML = '<div style="color:rgba(255,255,255,.25);text-align:center;padding:40px 10px;font-size:13px">点击分镜查看属性</div>';
    renderDramaEpisodeList();
    // 渲染合成成片预览(如果之前已经合成过)
    if (typeof renderDramaFinalVideo === 'function') renderDramaFinalVideo();
  } catch {}
}

let _dramaGenerating = false;
async function createDramaEpisode() {
  if (!currentDramaProject || _dramaGenerating) return;
  _dramaGenerating = true;
  const btn = document.getElementById('drama-new-ep-btn');
  if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }

  try {
    const r = await authFetch(`/api/drama/projects/${currentDramaProject.id}/episodes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme: document.getElementById('drama-script')?.value?.trim() || '',
        sceneCount: parseInt(document.getElementById('drama-scene-count')?.value || '6'),
        durationPerScene: parseInt(document.getElementById('drama-duration')?.value || '8'),
        image_model: document.getElementById('drama-image-model')?.value || '',
        video_model: document.getElementById('drama-video-model')?.value || '',
        aspect_ratio: document.getElementById('drama-aspect-ratio')?.value || currentDramaProject?.aspect_ratio || '9:16',
      })
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);

    // 轮询进度
    pollDramaEpisodeProgress(d.data.id);
  } catch (e) {
    alert('生成失败: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '+ 生成新一集'; } _dramaGenerating = false;
  }
}

function pollDramaEpisodeProgress(eid) {
  const poll = async () => {
    try {
      const r = await authFetch(`/api/drama/projects/${currentDramaProject.id}/episodes/${eid}`);
      const d = await r.json();
      if (!d.success) return;
      updateDramaProgress(d.data);

      if (d.data.status === 'done') {
        // 刷新项目详情
        const pr = await authFetch(`/api/drama/projects/${currentDramaProject.id}`);
        const pd = await pr.json();
        if (pd.success) { currentDramaProject = pd.data; renderDramaEpisodeList(); }
        selectDramaEpisode(eid);
        const btn = document.getElementById('drama-new-ep-btn');
        if (btn) { btn.disabled = false; btn.textContent = '+ 生成新一集'; } _dramaGenerating = false;
        return;
      }
      if (d.data.status === 'error') {
        alert('生成失败: ' + (d.data.error_message || ''));
        const btn = document.getElementById('drama-new-ep-btn');
        if (btn) { btn.disabled = false; btn.textContent = '+ 生成新一集'; } _dramaGenerating = false;
        return;
      }
      setTimeout(poll, 2000);
    } catch { setTimeout(poll, 3000); }
  };
  poll();
}

async function loadDramaModels() {
  try {
    const res = await authFetch('/api/settings'); const data = await res.json(); if (!data.success) return;
    const imgSel = document.getElementById('drama-image-model');
    const vidSel = document.getElementById('drama-video-model');
    if (!imgSel || !vidSel) return;
    let imgH = '<option value="">自动</option>', vidH = '<option value="">自动</option>';
    for (const p of (data.data.providers || [])) {
      if (!p.enabled || !(p.api_key || p.api_key_masked)) continue;
      for (const m of (p.models || [])) {
        if (m.enabled === false) continue;
        const l = `${p.name}/${m.name||m.id}`, v = `${p.id}::${m.id}`;
        if (m.use === 'image') imgH += `<option value="${v}">${l}</option>`;
        if (m.use === 'video') vidH += `<option value="${v}">${l}</option>`;
      }
    }
    imgSel.innerHTML = imgH; vidSel.innerHTML = vidH;
  } catch {}
}

function updateDramaProgress(task) {
  const pct = task.progress || 0;
  // 新 10 步流水线
  const allSteps = ['screenwriter', 'director', 'visual', 'dialogue', 'tts', 'threeview', 'consistency', 'confirm', 'imagegen', 'done'];
  allSteps.forEach(s => {
    const el = document.getElementById('dp-' + s); if (el) el.classList.remove('active', 'done');
  });
  // 基于百分比标记已完成/活跃步骤
  const thresholds = [
    ['screenwriter', 10], ['director', 20], ['visual', 30], ['dialogue', 38],
    ['tts', 46], ['threeview', 58], ['consistency', 65], ['confirm', 67],
    ['imagegen', 97], ['done', 100]
  ];
  for (const [step, threshold] of thresholds) {
    const el = document.getElementById('dp-' + step);
    if (!el) continue;
    if (pct >= threshold) el.classList.add('done');
  }
  // 标记当前活跃步骤
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (pct < thresholds[i][1]) {
      const el = document.getElementById('dp-' + thresholds[i][0]);
      if (el) el.classList.add('active');
    } else break;
  }
  // 进度文字
  const msgEl = document.getElementById('drama-progress-msg');
  if (msgEl && task.message) msgEl.textContent = task.message;
}

// ════════ 分镜列表+编辑（复用逻辑） ════════
function renderDramaSBList() {
  if (!dramaResult?.scenes?.length) return;
  const list = document.getElementById('drama-sb-list');
  const info = document.getElementById('drama-scene-info');
  if (info) info.textContent = `${dramaResult.scenes.length} 个分镜 · 约 ${dramaResult.total_duration || 0}s`;
  list.innerHTML = dramaResult.scenes.map((s, i) => {
    const mi = DRAMA_MOTION_MAP[s.motion_name] || s.motion_icon || '→';
    const hasVideo = !!s.video_url;
    const thumb = s.image_url
      ? `<img src="${s.image_url}" />${hasVideo ? '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.3);font-size:20px;cursor:pointer" onclick="event.stopPropagation();previewDramaMedia(\'' + s.video_url + '\',\'video\')">▶</div>' : ''}`
      : s.image_error ? `<div class="dr-thumb-ph" style="font-size:10px;color:#ff4d6d;padding:4px;text-align:center;opacity:1" title="${s.image_error}">失败<br><span style="font-size:8px;opacity:.6">点击重试</span></div>`
      : '<div class="dr-thumb-ph">🎬</div>';
    return `<div class="drama-row${dramaSelectedScene===i?' selected':''}" onclick="selectDramaScene(${i})">
      <div class="dr-col-idx"><div class="dr-idx">${s.index||i+1}</div><div class="dr-dur">${s.duration||5}s</div></div>
      <div class="dr-col-thumb" onclick="event.stopPropagation();${s.image_error || !s.image_url ? `genDramaSceneImage(${i})` : s.image_url && !s.video_url ? `previewDramaMedia('${s.image_url}','image')` : ''}" style="cursor:pointer">${thumb}<div class="dr-camera-badge">${s.shot_scale||'中景'}</div></div>
      <div class="dr-col-content"><div class="dr-desc">${s.description||''}</div>${s.dialogue?`<div class="dr-dialogue">"${s.dialogue}"</div>`:''}${s.narrator?`<div class="dr-narrator">${s.narrator}</div>`:''}<div class="dr-tags"><span class="dr-tag motion">${mi} ${s.motion_name||''}</span>${s.emotion?`<span class="dr-tag emotion">${s.emotion}</span>`:''}${s.sfx?`<span class="dr-tag sfx">${s.sfx}</span>`:''}</div></div>
      <div class="dr-col-motion"><div class="dr-motion-icon">${mi}</div><div class="dr-motion-name">${s.motion_name||''}</div></div>
      <div class="dr-col-actions" onclick="event.stopPropagation()"><button class="dr-act-btn" onclick="selectDramaScene(${i})">编辑</button><button class="dr-act-btn" onclick="genDramaSceneImage(${i})">生图</button><button class="dr-act-btn primary" onclick="genDramaSceneVideo(${i})">视频</button></div>
    </div>`;
  }).join('');
}

function selectDramaScene(i) {
  dramaSelectedScene = i;
  document.querySelectorAll('.drama-row').forEach(r => r.classList.remove('selected'));
  document.querySelectorAll('.drama-row')[i]?.classList.add('selected');
  renderDramaRightPanel(i);
}

function renderDramaRightPanel(i) {
  const s = dramaResult?.scenes?.[i]; if (!s) return;
  const panel = document.getElementById('drama-right-panel');
  panel.innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:12px">分镜 #${s.index||i+1} 属性</div>
    <div class="dr-section"><div class="dr-section-label">画面描述</div><textarea class="drama-textarea" style="min-height:50px" onchange="updateDramaScene(${i},'description',this.value)">${s.description||''}</textarea></div>
    <div class="dr-section"><div class="dr-section-label">对话</div><input class="drama-textarea" style="min-height:0;padding:6px 8px" value="${(s.dialogue||'').replace(/"/g,'&quot;')}" onchange="updateDramaScene(${i},'dialogue',this.value)" /><div style="margin-top:4px"><div class="dr-section-label">旁白</div><input class="drama-textarea" style="min-height:0;padding:6px 8px" value="${(s.narrator||'').replace(/"/g,'&quot;')}" onchange="updateDramaScene(${i},'narrator',this.value)" /></div></div>
    <div class="dr-section"><div class="dr-section-label">运镜</div><div class="dr-motion-grid">${dramaMotions.map(m=>`<div class="dr-motion-item${s.motion_id===m.id?' active':''}" onclick="setDramaMotion(${i},'${m.id}',this)"><div class="mi-icon">${m.icon}</div><div class="mi-name">${m.name}</div></div>`).join('')}</div><div style="margin-top:6px;background:var(--bg);padding:5px 8px;border-radius:6px;font-size:10px;color:var(--accent-color)">${s.motion_prompt||''}</div></div>
    <div class="dr-section"><div class="dr-section-label">景别</div><div class="dr-shot-grid">${dramaShotScales.map(sh=>`<div class="dr-shot-item${s.shot_scale===sh.name?' active':''}" onclick="setDramaShot(${i},'${sh.name}',this)">${sh.name}</div>`).join('')}</div></div>
    <div class="dr-section"><div class="dr-section-label">情感</div><div class="dr-shot-grid">${['孤独','忧伤','沉静','温暖','紧张','震惊','浪漫','震撼','欢快'].map(e=>`<div class="dr-shot-item${s.emotion===e?' active':''}" onclick="setDramaEmotion(${i},'${e}',this)">${e}</div>`).join('')}</div></div>
    <div class="dr-section">
      <div class="dr-section-label">中文提示词（可编辑）</div>
      <textarea class="drama-textarea" style="min-height:100px;font-size:11px;line-height:1.7;white-space:pre-wrap" onchange="updateDramaScene(${i},'full_prompt_cn',this.value)">${(s.full_prompt_cn||'(未生成)').replace(/</g,'&lt;')}</textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:4px;gap:6px">
        <button class="drama-btn-sm" onclick="navigator.clipboard.writeText(dramaResult.scenes[${i}].full_prompt_cn||'')">复制</button>
        <button class="drama-btn-sm" onclick="refreshDramaPrompt(${i})">刷新提示词</button>
      </div>
    </div>
    <div style="display:flex;gap:6px"><button class="drama-btn-gen" style="flex:1;margin:0" onclick="genDramaSceneImage(${i})">生成分镜图</button><button class="drama-btn-gen" style="flex:1;margin:0;background:rgba(33,255,243,.15);color:var(--accent-color)" onclick="genDramaSceneVideo(${i})">生成视频</button></div>
  `;
}

function _dramaApiBase() { return `/api/drama/projects/${currentDramaProject?.id}/episodes/${currentDramaEpisode?.id}`; }

function updateDramaScene(i, field, value) {
  if (!dramaResult?.scenes?.[i]) return;
  dramaResult.scenes[i][field] = value;
  authFetch(`${_dramaApiBase()}/scenes/${i}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: value }) }).catch(() => {});
}

function setDramaMotion(i, motionId, el) {
  const m = dramaMotions.find(x => x.id === motionId); if (!m) return;
  Object.assign(dramaResult.scenes[i], { motion_id: m.id, motion_name: m.name, motion_icon: m.icon, motion_prompt: m.prompt_en });
  el.parentElement.querySelectorAll('.dr-motion-item').forEach(e => e.classList.remove('active')); el.classList.add('active');
  authFetch(`${_dramaApiBase()}/scenes/${i}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motion_id: m.id, motion_name: m.name, motion_icon: m.icon, motion_prompt: m.prompt_en }) }).then(() => { renderDramaSBList(); renderDramaRightPanel(i); }).catch(() => {});
}

function setDramaShot(i, name, el) {
  dramaResult.scenes[i].shot_scale = name;
  el.parentElement.querySelectorAll('.dr-shot-item').forEach(e => e.classList.remove('active')); el.classList.add('active');
  authFetch(`${_dramaApiBase()}/scenes/${i}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shot_scale: name }) }).then(() => { renderDramaSBList(); renderDramaRightPanel(i); }).catch(() => {});
}

function setDramaEmotion(i, emotion, el) {
  dramaResult.scenes[i].emotion = emotion;
  el.parentElement.querySelectorAll('.dr-shot-item').forEach(e => e.classList.remove('active')); el.classList.add('active');
  authFetch(`${_dramaApiBase()}/scenes/${i}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emotion }) }).catch(() => {});
}

async function refreshDramaPrompt(i) {
  try { const r = await authFetch(`${_dramaApiBase()}/scenes/${i}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visual_prompt: dramaResult.scenes[i].visual_prompt }) }); const d = await r.json(); if (d.success && d.data) { dramaResult.scenes[i] = { ...dramaResult.scenes[i], ...d.data }; renderDramaRightPanel(i); renderDramaSBList(); } } catch {}
}

async function genDramaSceneImage(i) {
  if (!currentDramaEpisode) return;
  // 找到按钮并显示loading
  const btns = document.querySelectorAll('.dr-act-btn');
  const btn = btns.length > i * 3 + 1 ? btns[i * 3 + 1] : null;
  if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }
  try {
    const r = await authFetch(`${_dramaApiBase()}/scenes/${i}/generate-video`, { method: 'POST' });
    const d = await r.json();
    if (d.success) {
      dramaResult.scenes[i].image_url = d.data.image_url;
      renderDramaSBList();
      if (dramaSelectedScene === i) renderDramaRightPanel(i);
    } else {
      // 友好提示速率限制
      if (d.error && d.error.includes('速率限制')) {
        alert('图片生成API速率限制，请等待30秒后重试。\n\n建议：在管理后台配置多个图片供应商以避免限流。');
      } else {
        alert('生成失败: ' + d.error);
      }
    }
  } catch (e) { alert('生成失败: ' + e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '生图'; } }
}

async function genDramaSceneVideo(i) {
  if (!currentDramaEpisode) return;
  const scene = dramaResult?.scenes?.[i];
  if (!scene?.image_url) return alert('请先生成分镜图，再生成视频');
  // 找操作列的视频按钮
  const allBtns = document.querySelectorAll('.dr-act-btn.primary');
  const btn = allBtns[i] || event?.target;
  if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
  // 状态提示
  const statusEl = document.getElementById('drama-scene-info');
  const origStatus = statusEl?.textContent;
  if (statusEl) statusEl.textContent = `场景${i + 1} 视频生成中（约30秒-3分钟）...`;
  try {
    const r = await authFetch(`${_dramaApiBase()}/scenes/${i}/make-video`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_model: document.getElementById('drama-video-model')?.value || '' })
    });
    const d = await r.json();
    if (d.success && d.data?.video_url) {
      dramaResult.scenes[i].video_url = d.data.video_url;
      renderDramaSBList();
      if (dramaSelectedScene === i) renderDramaRightPanel(i);
    } else alert('视频生成失败: ' + (d.error || '未知错误'));
  } catch (e) { alert('视频生成失败: ' + e.message); }
  finally {
    if (btn) { btn.disabled = false; btn.textContent = '视频'; }
    if (statusEl) statusEl.textContent = origStatus || '';
  }
}

async function generateAllDramaVideos() {
  if (!dramaResult?.scenes?.length || !currentDramaEpisode) return;
  const noImage = dramaResult.scenes.filter(s => !s.image_url);
  if (noImage.length) return alert(`还有 ${noImage.length} 个场景没有分镜图，请先生成全部分镜图`);

  const pending = dramaResult.scenes.filter(s => !s.video_url);
  if (!pending.length) return alert('所有场景已有视频');
  if (!confirm(`即将为 ${pending.length} 个场景逐个生成视频（每个约30秒-3分钟），期间请勿离开页面。确认继续？`)) return;

  const statusEl = document.getElementById('drama-scene-info');
  const total = dramaResult.scenes.length;
  let doneCount = dramaResult.scenes.filter(s => s.video_url).length;

  for (let i = 0; i < total; i++) {
    if (dramaResult.scenes[i].video_url) continue;
    if (statusEl) statusEl.textContent = `视频生成中 ${doneCount + 1}/${total}：场景${i + 1}...`;

    try {
      const r = await authFetch(`${_dramaApiBase()}/scenes/${i}/make-video`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_model: document.getElementById('drama-video-model')?.value || '' })
      });
      const d = await r.json();
      if (d.success && d.data?.video_url) {
        dramaResult.scenes[i].video_url = d.data.video_url;
        doneCount++;
        renderDramaSBList();
      } else {
        console.warn(`场景 ${i + 1} 视频失败:`, d.error);
        if (statusEl) statusEl.textContent = `场景${i + 1}失败: ${(d.error || '').substring(0, 30)}，继续下一个...`;
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      console.error(`场景 ${i + 1} 视频异常:`, e.message);
    }
  }

  if (statusEl) statusEl.textContent = `${total} 个分镜 · 约 ${dramaResult.total_duration || 0}s · 视频${doneCount}/${total}`;
  alert(`批量视频生成完成：${doneCount}/${total} 个成功`);
  renderDramaSBList();
}

// ════════ 一键合成成片(视频高质量模式) ════════
async function composeDramaFinal() {
  if (!dramaResult?.scenes?.length || !currentDramaEpisode) return;
  const noVideo = dramaResult.scenes.filter(s => !s.video_url);
  if (noVideo.length === dramaResult.scenes.length) {
    return alert('还没有任何分镜视频。\n\n请先点击"🎞 全部生成视频"为每个分镜生成视频, 或者用"⚡ 图片快速合成"直接从分镜图合成。');
  }
  if (noVideo.length > 0) {
    if (!confirm(`有 ${noVideo.length} 个分镜还没视频，是否只合成已有的 ${dramaResult.scenes.length - noVideo.length} 段?`)) return;
  }
  const btn = document.getElementById('drama-compose-btn');
  const status = document.getElementById('drama-final-status');
  if (btn) { btn.disabled = true; btn.textContent = '合成中...'; }
  if (status) { status.textContent = '🎬 视频合成中...'; status.style.color = '#fbbf24'; }
  try {
    const r = await authFetch(`${_dramaApiBase()}/compose`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    dramaResult.final_video_url = d.data.final_video_url;
    dramaResult.composed_clips = d.data.composed_clips;
    dramaResult.composed_with_voice = d.data.composed_with_voice;
    dramaResult.composed_at = new Date().toISOString();
    dramaResult.composed_mode = 'videos';
    renderDramaFinalVideo();
    showToast(`✓ 合成完成: ${d.data.composed_clips}/${d.data.total_scenes} 段`, 'ok');
  } catch (e) {
    if (status) { status.textContent = '合成失败'; status.style.color = '#ff4d6d'; }
    alert('合成失败: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🎬 视频高质量合成'; }
  }
}

// ════════ 图片快速合成(slideshow 模式, 不需要 i2v 视频) ════════
async function composeFromImages() {
  if (!dramaResult?.scenes?.length || !currentDramaEpisode) return;
  const noImage = dramaResult.scenes.filter(s => !s.image_url);
  if (noImage.length === dramaResult.scenes.length) {
    return alert('还没有任何分镜图。请等剧集 Agent 跑完所有分镜。');
  }
  if (noImage.length > 0) {
    if (!confirm(`有 ${noImage.length} 个分镜还没图片，是否只合成已有的 ${dramaResult.scenes.length - noImage.length} 段?`)) return;
  }
  const btn = document.getElementById('drama-compose-img-btn');
  const status = document.getElementById('drama-final-status');
  if (btn) { btn.disabled = true; btn.textContent = '合成中...'; }
  if (status) { status.textContent = '⚡ 图片合成中...'; status.style.color = '#21d4fd'; }
  try {
    const r = await authFetch(`${_dramaApiBase()}/compose-from-images`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    dramaResult.final_video_url = d.data.final_video_url;
    dramaResult.composed_clips = d.data.composed_clips;
    dramaResult.composed_with_voice = d.data.composed_with_voice;
    dramaResult.composed_at = new Date().toISOString();
    dramaResult.composed_mode = 'images';
    dramaResult.aspect_ratio = d.data.aspect_ratio;
    renderDramaFinalVideo();
    showToast(`✓ 图片快速合成完成: ${d.data.composed_clips} 段${d.data.composed_with_voice ? ' (含 ' + d.data.composed_with_voice + ' 段配音)' : ''}`, 'ok');
  } catch (e) {
    if (status) { status.textContent = '合成失败'; status.style.color = '#ff4d6d'; }
    alert('图片合成失败: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ 图片快速合成'; }
  }
}

function renderDramaFinalVideo() {
  const panel = document.getElementById('drama-final-panel');
  const wrap = document.getElementById('drama-final-wrap');
  const video = document.getElementById('drama-final-video');
  const meta = document.getElementById('drama-final-meta');
  const status = document.getElementById('drama-final-status');
  const dl = document.getElementById('drama-final-download');
  if (!panel) return;
  // 只要选了已生成的剧集就显示成片面板
  panel.style.display = (dramaResult && dramaResult.scenes?.length) ? '' : 'none';

  // 状态文字
  if (status) {
    if (dramaResult?.final_video_url) {
      const mode = dramaResult.composed_mode === 'images' ? '⚡ 图片快速' : (dramaResult.composed_mode === 'videos' ? '🎬 视频高质量' : '已合成');
      status.textContent = `${mode} · ${dramaResult.composed_clips || 0} 段${dramaResult.composed_with_voice ? ' · 含配音' : ''}`;
      status.style.color = '#00e5a0';
    } else {
      const sceneCount = dramaResult?.scenes?.length || 0;
      const imgCount = (dramaResult?.scenes || []).filter(s => s.image_url).length;
      const vidCount = (dramaResult?.scenes || []).filter(s => s.video_url).length;
      status.textContent = `未合成 · 共 ${sceneCount} 段 (图 ${imgCount}, 视频 ${vidCount})`;
      status.style.color = 'rgba(255,255,255,.5)';
    }
  }

  // 元信息
  if (meta) {
    if (dramaResult?.final_video_url) {
      meta.textContent = `${dramaResult.aspect_ratio || ''} · 约 ${dramaResult.total_duration || 0}s 时长`;
    } else {
      meta.textContent = '点击「⚡ 图片快速合成」直接从分镜图合成 (推荐, 速度快), 或先「🎞 全部生成视频」再「🎬 视频高质量合成」';
    }
  }

  // 视频预览
  if (wrap && video) {
    if (!dramaResult?.final_video_url) {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';
    const url = dramaResult.final_video_url + (dramaResult.composed_at ? `?t=${encodeURIComponent(dramaResult.composed_at)}` : '');
    video.src = url;
    if (dl) dl.href = (dramaResult.final_video_url || '').replace(/\/final$/, '/final/download');
  }
}

// ════════ 重新生成 Character Bible (角色一致性) ════════
async function regenCharacterBible() {
  if (!dramaResult || !currentDramaEpisode) {
    alert('请先选中一个已生成的剧集');
    return;
  }
  if (!confirm('重新生成角色一致性锁定表? 会调 LLM 重新分析所有角色的视觉特征并注入到每个分镜的 prompt 中(约 10-30 秒)。\n\n生成后,新生成的分镜图会用更严格的角色锁定。已生成的分镜图不会自动重画,需要单独点击"重新生成"。')) return;
  const btn = document.getElementById('drama-bible-btn');
  if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }
  try {
    const r = await authFetch(`${_dramaApiBase()}/regenerate-character-bible`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    dramaResult.character_bible = d.data.bible;
    showCharacterBibleDialog(d.data.bible);
    showToast(`✓ 已锁定 ${d.data.character_count} 个角色`, 'ok');
  } catch (e) {
    alert('生成失败: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🎭 角色一致性'; }
  }
}

function showCharacterBibleDialog(bible) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(8px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:30px';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  const chars = bible?.characters || [];
  const rules = bible?.global_rules || {};
  overlay.innerHTML = `<div style="background:#0d0d12;border:1px solid rgba(255,255,255,.1);border-radius:18px;width:880px;max-width:96vw;max-height:88vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 32px 80px rgba(0,0,0,.7)">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.06)">
      <div style="font-size:15px;font-weight:600;color:#fff">🎭 Character Bible — 角色一致性锁定表</div>
      <button onclick="this.closest('div[style*=\\'position:fixed\\']').remove()" style="width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.7);cursor:pointer">×</button>
    </div>
    <div style="overflow-y:auto;padding:20px 22px">
      ${chars.length === 0 ? '<div style="color:rgba(255,255,255,.4);text-align:center;padding:40px">暂无角色锁定</div>' : chars.map(c => `
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            ${c.three_view?.front ? `<img src="${c.three_view.front}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0"/>` : ''}
            <div>
              <div style="font-size:15px;font-weight:600;color:#fff">${c.name || ''}</div>
              <div style="font-size:11px;color:rgba(255,255,255,.5);margin-top:2px">${c.id_token_en || ''}</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:90px 1fr;gap:8px 14px;font-size:12px">
            <div style="color:rgba(255,255,255,.4)">面部锁定</div><div style="color:rgba(255,255,255,.85)">${escHtml(c.lock_face || '')}</div>
            <div style="color:rgba(255,255,255,.4)">身体</div><div style="color:rgba(255,255,255,.85)">${escHtml(c.lock_body || '')}</div>
            <div style="color:rgba(255,255,255,.4)">服装</div><div style="color:rgba(255,255,255,.85)">${escHtml(c.lock_wardrobe || '')}</div>
            <div style="color:rgba(255,255,255,.4)">标志特征</div><div style="color:rgba(255,255,255,.85)">${escHtml(c.lock_distinguishing || '无')}</div>
            <div style="color:rgba(255,255,255,.4)">禁止</div><div style="color:#ff7a8a">${escHtml(c.negative_lock || '')}</div>
          </div>
          <details style="margin-top:10px"><summary style="font-size:11px;color:rgba(255,255,255,.5);cursor:pointer">展开完整锁定 prompt</summary>
            <div style="background:rgba(0,0,0,.3);padding:10px;border-radius:6px;margin-top:6px;font-size:11px;color:rgba(255,255,255,.7);line-height:1.6;font-family:monospace">${escHtml(c.full_lock_prompt_en || '')}</div>
          </details>
        </div>
      `).join('')}
      ${rules.style_anchor || rules.color_palette || rules.lighting_anchor ? `
        <div style="background:rgba(167,139,250,.06);border:1px solid rgba(167,139,250,.2);border-radius:12px;padding:14px;font-size:12px">
          <div style="font-weight:600;color:#a78bfa;margin-bottom:8px">全局一致性规则</div>
          ${rules.lighting_anchor ? `<div style="margin-top:4px"><b style="color:rgba(255,255,255,.5)">光线:</b> ${escHtml(rules.lighting_anchor)}</div>` : ''}
          ${rules.color_palette ? `<div style="margin-top:4px"><b style="color:rgba(255,255,255,.5)">配色:</b> ${escHtml(rules.color_palette)}</div>` : ''}
          ${rules.style_anchor ? `<div style="margin-top:4px"><b style="color:rgba(255,255,255,.5)">画风:</b> ${escHtml(rules.style_anchor)}</div>` : ''}
        </div>
      ` : ''}
    </div>
  </div>`;
  document.body.appendChild(overlay);
}

// 预览弹层（图片/视频）
function previewDramaMedia(url, type) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer';
  overlay.onclick = () => overlay.remove();
  if (type === 'video') {
    overlay.innerHTML = `<video src="${url}" controls autoplay style="max-width:90vw;max-height:85vh;border-radius:12px" onclick="event.stopPropagation()"></video>`;
  } else {
    overlay.innerHTML = `<img src="${url}" style="max-width:90vw;max-height:85vh;border-radius:12px;object-fit:contain" />`;
  }
  document.body.appendChild(overlay);
}

async function saveDramaEpisode() {
  if (!currentDramaEpisode || !dramaResult) return alert('没有可保存的内容');
  try {
    const r = await authFetch(`/api/drama/projects/${currentDramaProject.id}/episodes/${currentDramaEpisode.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: dramaResult })
    });
    const d = await r.json();
    if (d.success) {
      const btn = event?.target;
      if (btn) { const orig = btn.textContent; btn.textContent = '已保存 ✓'; btn.style.color = '#00e5a0'; setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1500); }
    } else alert('保存失败: ' + d.error);
  } catch (e) { alert('保存失败: ' + e.message); }
}

function exportDramaScript() { if (dramaResult) { const b = new Blob([JSON.stringify(dramaResult,null,2)],{type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `drama_${dramaResult.title||'script'}.json`; a.click(); } }

// ═══ AI 漫画 ═══
// ═══════════════════════════════════════════
let comicStyle = '日系动漫';
let comicSelectedStyleId = null;
let comicPages = 4;
let comicPanelsPerPage = 4;
let comicCharacters = [];
let comicSelectedCharIds = []; // 从角色库选中的 ID
let comicCurrentTaskId = null;
let comicImageModels = [];
let comicSelectedModel = null; // null = auto

function loadComicPage() {
  loadComicImageModels();
  loadComicStyles();
  loadComicHistory();
}

// 动态加载风格库
async function loadComicStyles() {
  try {
    const res = await authFetch('/api/ai-cap/styles');
    const data = await res.json();
    const styles = data.data || [];
    const grid = document.getElementById('comic-style-grid');
    if (!grid) return;
    grid.innerHTML = styles.map((s, i) => {
      const active = s.name === comicStyle ? ' active' : '';
      return `<button class="comic-style-btn${active}" data-style="${escHtml(s.name)}" data-style-id="${s.id}" onclick="selectComicStyle(this)">${escHtml(s.name)}</button>`;
    }).join('');
    // 如果当前选中的不在列表中，选第一个
    if (!styles.find(s => s.name === comicStyle) && styles.length) {
      comicStyle = styles[0].name;
      comicSelectedStyleId = styles[0].id;
    }
  } catch (e) {
    // 回退硬编码
    const grid = document.getElementById('comic-style-grid');
    if (grid) grid.innerHTML = ['日系动漫','美式漫画','韩国漫画','少年漫画','少女漫画','水墨漫画','赛博朋克','欧式漫画']
      .map((s, i) => `<button class="comic-style-btn${i===0?' active':''}" data-style="${s}" onclick="selectComicStyle(this)">${s}</button>`).join('');
  }
}

function selectComicStyle(btn) {
  document.querySelectorAll('.comic-style-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  comicStyle = btn.dataset.style;
  comicSelectedStyleId = btn.dataset.styleId || null;
}

// 从角色库导入角色
function importComicCharFromLibrary() {
  showLibraryPicker('characters', {
    multiple: true,
    onSelect: (items) => {
      for (const c of items) {
        if (comicSelectedCharIds.includes(c.id)) continue;
        comicSelectedCharIds.push(c.id);
        comicCharacters.push({ id: c.id, name: c.name, description: c.appearance_prompt || c.appearance || c.personality || '', _fromLibrary: true });
      }
      renderComicCharacters();
    }
  });
}

function renderComicCharacters() {
  const list = document.getElementById('comic-char-list');
  if (!list) return;
  list.innerHTML = comicCharacters.map((c, i) => `
    <div class="comic-char-item" style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(255,255,255,.04);border-radius:8px;margin-bottom:4px">
      <span style="flex:1;font-size:13px">${escHtml(c.name)}${c._fromLibrary ? ' <span style="color:#21FFF3;font-size:10px">库</span>' : ''}</span>
      <button onclick="removeComicCharacter(${i})" style="background:none;border:none;color:rgba(255,255,255,.3);cursor:pointer;font-size:14px">&times;</button>
    </div>
  `).join('');
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
        styleId: comicSelectedStyleId,
        pages: comicPages,
        panels_per_page: comicPanelsPerPage,
        characters: chars.filter(c => !c._fromLibrary),
        character_ids: comicSelectedCharIds
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
  // 将作品类型映射到对应的权限模块 key（与侧边栏 data-perm 保持一致）
  const items = [
    { key: 'all',      label: '全部作品', perm: null,        count: Object.values(stats).reduce((s, n) => s + n, 0) },
    { key: 'avatar',   label: '数字人',   perm: 'avatar',    count: stats.avatar || 0 },
    { key: 'video',    label: 'AI 视频',  perm: 'create',    count: stats.video || 0 },
    { key: 'i2v',      label: '图生视频', perm: 'i2v',       count: stats.i2v || 0 },
    { key: 'portrait', label: 'AI 形象',  perm: 'portrait',  count: stats.portrait || 0 },
    { key: 'comic',    label: 'AI 漫画',  perm: 'comic',     count: stats.comic || 0 },
    { key: 'drama',    label: 'AI 网剧',  perm: 'drama',     count: stats.drama || 0 },
    { key: 'novel',    label: 'AI 小说',  perm: 'novel',     count: stats.novel || 0 },
  ];
  // 根据当前用户权限过滤
  const user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  const visible = items.filter(it => !it.perm || canSeeModule(user, it.perm));
  el.innerHTML = visible.map(it => `
    <div class="works-stat-card ${worksFilter === it.key ? 'active' : ''}" onclick="filterWorks('${it.key}',null)">
      <div class="works-stat-num">${it.count}</div>
      <div class="works-stat-label">${it.label}</div>
    </div>
  `).join('');
}

// 通用的模块可见性判断（同 applyPermissionVisibility 内的 canSee）
function canSeeModule(user, moduleKey) {
  if (!moduleKey) return true;
  const isAdmin = user && user.role === 'admin';
  const perms = user && Array.isArray(user.effective_permissions) ? user.effective_permissions : [];
  if (isAdmin || perms.includes('*')) return true;
  if (moduleKey === 'dashboard' || moduleKey === 'profile') return true;
  const prefix = 'enterprise:' + moduleKey + ':';
  return perms.some(p => p === moduleKey || (typeof p === 'string' && p.startsWith(prefix)));
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
      const poster = w.thumbnail_url ? ` poster="${authUrl(w.thumbnail_url)}"` : '';
      thumbContent = `<div class="work-card-thumb">
        <video src="${authUrl(w.stream_url)}" muted preload="metadata"${poster}></video>
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
      ? `<button class="work-card-btn" onclick="event.stopPropagation();window.open(authUrl('${w.download_url}'),'_blank')">下载</button>`
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
    openLightbox(authUrl(w.stream_url), w.title, 'video');
  } else if (w.media_type === 'image' && w.preview_url) {
    openLightbox(authUrl(w.preview_url), w.title);
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

// ══════════════════════════════════════════════════════
// AI 能力库 — 通用选择弹层
// ══════════════════════════════════════════════════════

let _libPickerCache = { characters: null, scenes: null, styles: null };

/**
 * 显示库选择弹层
 * @param {'characters'|'scenes'|'styles'} type
 * @param {Object} opts - { multiple: bool, onSelect: (items) => void }
 */
async function showLibraryPicker(type, opts = {}) {
  const { multiple = true, onSelect } = opts;
  const typeLabels = { characters: '角色库', scenes: '场景库', styles: '风格库' };
  const icons = { characters: '&#128100;', scenes: '&#127968;', styles: '&#127912;' };

  // 加载数据
  if (!_libPickerCache[type]) {
    try {
      const res = await authFetch(`/api/ai-cap/${type}`);
      const data = await res.json();
      _libPickerCache[type] = data.data || [];
    } catch { _libPickerCache[type] = []; }
  }
  const items = _libPickerCache[type];
  const selected = new Set();

  // 创建弹层
  const overlay = document.createElement('div');
  overlay.className = 'lib-picker-overlay';
  overlay.innerHTML = `
    <div class="lib-picker-box">
      <div class="lib-picker-header">
        <h3>从${typeLabels[type]}选择</h3>
        <button class="lib-picker-close" onclick="this.closest('.lib-picker-overlay').remove()">&times;</button>
      </div>
      <div class="lib-picker-body">
        ${items.length === 0
          ? `<div class="lib-picker-empty">暂无数据，请在管理后台「AI 能力」中添加</div>`
          : `<div class="lib-picker-grid">${items.map((item, i) => {
              const thumb = (item.ref_images?.[0] || item.ref_image)
                ? `<img src="${item.ref_images?.[0] || item.ref_image}" />`
                : `<span class="placeholder">${icons[type]}</span>`;
              const meta = type === 'characters' ? (item.personality || '').substring(0, 20)
                : type === 'scenes' ? (item.scene_type || '')
                : (item.category || '');
              return `<div class="lib-picker-item" data-idx="${i}" onclick="toggleLibPickerItem(this, ${multiple})">
                <div class="lib-picker-item-thumb">${thumb}</div>
                <div class="lib-picker-item-name">${escHtml(item.name)}</div>
                <div class="lib-picker-item-meta">${escHtml(meta)}</div>
              </div>`;
            }).join('')}</div>`
        }
      </div>
      <div class="lib-picker-footer">
        <button class="lib-picker-btn-cancel" onclick="this.closest('.lib-picker-overlay').remove()">取消</button>
        <button class="lib-picker-btn-confirm" id="lib-picker-confirm">确认选择</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  // 确认按钮
  overlay.querySelector('#lib-picker-confirm').onclick = () => {
    const selectedItems = [];
    overlay.querySelectorAll('.lib-picker-item.selected').forEach(el => {
      selectedItems.push(items[parseInt(el.dataset.idx)]);
    });
    if (onSelect) onSelect(selectedItems);
    overlay.remove();
  };
}

function toggleLibPickerItem(el, multiple) {
  if (!multiple) {
    el.parentElement.querySelectorAll('.lib-picker-item').forEach(e => e.classList.remove('selected'));
  }
  el.classList.toggle('selected');
}

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// 刷新库缓存
function invalidateLibCache(type) { if (type) _libPickerCache[type] = null; else _libPickerCache = { characters: null, scenes: null, styles: null }; }

// 启动
init();
