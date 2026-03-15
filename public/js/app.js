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
}

function loadTheme() {
  const saved = localStorage.getItem('vido-theme');
  if (saved) switchTheme(saved);
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
  document.getElementById('user-name').textContent = user.username;
  document.getElementById('user-avatar').textContent = user.username[0].toUpperCase();
  document.getElementById('credits-display').textContent = user.credits;
  if (user.role === 'admin') document.getElementById('admin-link').style.display = '';
  return true;
}

function updateCreditsDisplay() {
  fetchCurrentUser().then(() => {
    const u = getCurrentUser();
    if (u) document.getElementById('credits-display').textContent = u.credits;
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
function switchPage(page, opts) {
  if (page === 'settings') return; // AI 配置已移至后台
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (!pageEl) return;
  pageEl.classList.add('active');
  const navEl = document.querySelector('[data-page="' + page + '"]');
  if (navEl) navEl.classList.add('active');
  if (page === 'projects') loadProjects();
  if (page === 'i2v') loadI2VPage();
  if (page === 'avatar') loadAvatarPage();
  if (page === 'imggen') loadImgGenPage();
  if (page === 'create' && !(opts && opts.keepProject)) {
    resetForm();
  }
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
function toggleVoice(enabled) {
  voiceEnabled = enabled;
  document.getElementById('voice-options').style.display = enabled ? 'block' : 'none';
  document.getElementById('voice-off-hint').style.display = enabled ? 'none' : 'block';
  if (enabled && allVoices.length === 0) loadVoices();
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
  document.getElementById('srp-scene-desc').value = s.description || '';
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
  renderScenes();
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
  let html = `<div class="srp-mp-opt ${!curProvider ? 'active' : ''}" onclick="selectSceneVideoModel('','')">
    <span style="opacity:.6">🔄</span> 跟随全局默认
  </div>`;
  if (videoModelsCache && videoModelsCache.length) {
    const groups = {};
    for (const m of videoModelsCache) {
      if (!groups[m.providerId]) groups[m.providerId] = { name: m.providerName, id: m.providerId, models: [] };
      groups[m.providerId].models.push(m);
    }
    for (const g of Object.values(groups)) {
      const icon = VM_PROVIDER_ICONS[g.id] || '🔹';
      html += `<div style="padding:4px 10px 2px;opacity:.5;font-size:10px;font-weight:600">${icon} ${esc(g.name)}</div>`;
      for (const m of g.models) {
        const active = m.providerId === curProvider && m.modelId === curModel;
        html += `<div class="srp-mp-opt ${active ? 'active' : ''}" onclick="selectSceneVideoModel('${esc(m.providerId)}','${esc(m.modelId)}')">
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
function renderTimeline() {
  const clips = document.getElementById('tl-clips');
  const ruler = document.getElementById('tl-ruler');
  if (!clips || !ruler) return;
  const zoom = studioTlZoom; // pixels per second
  const pixPerSec = zoom * 10;
  // Ruler ticks
  const totalSecs = 60;
  ruler.style.width = (totalSecs * pixPerSec) + 'px';
  let rulerHtml = '';
  for (let i = 0; i <= totalSecs; i += 5) {
    rulerHtml += `<div class="tl-ruler-tick" style="left:${i * pixPerSec}px"><div class="tl-ruler-line"></div><div class="tl-ruler-txt">0:${String(i).padStart(2,'0')}</div></div>`;
  }
  ruler.innerHTML = rulerHtml;
  // Clips from customScenes or a default set
  const items = customScenes.length ? customScenes : [];
  let offset = 0;
  const totalDurSecs = items.reduce((sum, s) => sum + (s.duration || 10), 0);
  const neededWidth = Math.max(totalSecs, totalDurSecs + 10) * pixPerSec;
  clips.style.width = neededWidth + 'px';
  ruler.style.width = neededWidth + 'px';
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

function tlTogglePlay() {
  const btn = document.getElementById('tl-play-btn');
  if (!btn) return;
  const playing = btn.dataset.playing === '1';
  btn.dataset.playing = playing ? '0' : '1';
  btn.innerHTML = playing
    ? '<svg width="10" height="12" viewBox="0 0 10 12"><path d="M1 1.5l8 4.5-8 4.5z" fill="currentColor"/></svg>'
    : '<svg width="10" height="12" viewBox="0 0 10 12"><rect x="1" y="1" width="3" height="10" rx="1" fill="currentColor"/><rect x="6" y="1" width="3" height="10" rx="1" fill="currentColor"/></svg>';
}

// ═══ 音乐轨道（时间轴内） ═══
function renderMusicTrack() {
  const track = document.getElementById('tl-music-track');
  if (!track) return;
  if (!musicFilePath || !musicDuration) { track.style.display = 'none'; return; }
  track.style.display = 'flex';

  const pixPerSec = studioTlZoom * 10;
  const area = document.getElementById('tl-music-area');
  const fullBar = document.getElementById('tl-music-full-bar');
  const clip = document.getElementById('tl-music-clip');
  if (!area || !clip) return;

  // 区域宽度跟随视频轨道
  const totalW = Math.max(musicDuration, 60) * pixPerSec;
  area.style.width = totalW + 'px';

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
  const area = document.getElementById('tl-music-area');
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
  audio.addEventListener('timeupdate', () => {
    if (musicPlayMode === 'trim' && audio.currentTime >= musicTrimEnd) {
      stopMusicPlayback();
    }
  });
  audio.addEventListener('ended', () => { stopMusicPlayback(); });
}

let musicPlayMode = 'none'; // 'none' | 'full' | 'trim'

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
  'fal-ai/seedance/v2/text-to-video':   { dim: 'both', action: 3, note: 'Seedance 2.0 T2V，12文件多模态输入，动作极强' },
  'fal-ai/seedance/v2/image-to-video':  { dim: 'both', action: 3, note: 'Seedance 2.0 I2V，角色一致性引擎' },
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
    const durMap = { 15: '15秒', 30: '30秒', 60: '1分钟', 120: '2分钟', 180: '3分钟' };
    const durText = durMap[tpl.duration] || '';
    document.querySelectorAll('.dur-btn').forEach(b => {
      b.classList.toggle('active', b.textContent.trim() === durText);
    });
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
  const max = el.id === 'input-theme' ? 5000 : 1000;
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
function quickAIStory() {
  const ta = document.getElementById('input-theme');
  if (!ta.value.trim()) {
    ta.placeholder = '请先输入内容描述，再点击智能创作...';
    ta.focus();
    setTimeout(() => { ta.placeholder = '描述你想要的视频内容，越详细效果越好...'; }, 3000);
  }
  // 实际生成在 startGeneration 中完成，这里只是 UX 提示
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
    // 设置音源（使用上传路径的文件名构建 URL）
    if (!audio.src || audio.src === '') {
      audio.src = musicFilePath.replace(/\\/g, '/');
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
    const estSecs = count * 8; // avg 8s per scene
    const estMin = estSecs >= 60 ? Math.floor(estSecs/60) + '分' + (estSecs%60 ? (estSecs%60) + '秒' : '') : estSecs + '秒';
    hint.textContent = `建议 ${estMin}（${count} 个场景）`;
    hint.style.display = 'inline';
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

// ═══ 中央画布状态 ═══
// state: 'idle' | 'generating' | 'done' | 'preview'
function setCanvasState(state) {
  show('canvas-idle', state === 'idle');
  show('canvas-gen-overlay', state === 'generating');
  const vid = document.getElementById('center-video');
  if (vid) vid.style.display = (state === 'done' || state === 'preview') ? 'block' : 'none';
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

// ═══ 视频预览 ═══
function openPreview(projectId, title) {
  const id = projectId || currentProjectId; if (!id) return;
  document.getElementById('modal-title').textContent = title || '视频预览';
  document.getElementById('modal-video-src').src = authUrl('/api/projects/' + id + '/stream');
  const v = document.getElementById('modal-video'); v.load(); v.play().catch(()=>{});
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
    footer.innerHTML = '<span style="color:var(--text3);font-size:11px;margin-right:6px">场景：</span>' +
      '<button class="clip-btn active" onclick="playFull(\''+pid+'\',this)">完整</button>' +
      clips.map((c,i)=>`<button class="clip-btn" onclick="playClip('${pid}','${c.id}',${i},this)">场景 ${i+1}</button>`).join('');
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
  document.getElementById('modal-video-src').src = ''; v.load();
  document.getElementById('video-modal').classList.remove('open');
}
function closeModal(e) { if (e.target.id==='video-modal') closePreview(); }

// ═══ 图片大图弹窗 ═══
function openLightbox(src, caption) {
  const box = document.getElementById('img-lightbox');
  const img = document.getElementById('lightbox-img');
  const cap = document.getElementById('lightbox-caption');
  if (!box || !img) return;
  img.src = src;
  if (cap) cap.textContent = caption || '';
  box.classList.add('open');
}
function closeLightbox(e) {
  if (e && e.target !== document.getElementById('img-lightbox') && !e.target.classList.contains('lightbox-close')) return;
  const box = document.getElementById('img-lightbox');
  if (box) box.classList.remove('open');
}

// ═══ 项目列表 ═══
async function loadProjects() {
  const grid = document.getElementById('projects-grid');
  grid.innerHTML = '<div class="loading-placeholder">加载中...</div>';
  try {
    const res = await authFetch('/api/projects'); const data = await res.json();
    if (!data.success || !data.data.length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🎬</div><div class="empty-title">还没有项目</div><div class="empty-sub">去创作你的第一个 AI 视频吧</div></div>';
      return;
    }
    const badge = document.getElementById('project-count');
    if (badge) { badge.textContent = data.data.length; badge.style.display = ''; }
    const sc = { pending:'s-pending', done:'s-done', error:'s-error', generating_story:'s-running', generating_videos:'s-running', merging:'s-running' };
    const sl = { pending:'等待中', done:'已完成', error:'出错', generating_story:'生成剧情', generating_videos:'生成视频', merging:'合成中' };
    grid.innerHTML = data.data.map(p => `
      <div class="project-card" onclick="viewProject('${p.id}')" style="cursor:pointer">
        <div class="project-thumb">🎬</div>
        <div class="project-title">${esc(p.title)}</div>
        <div class="project-theme">${esc(p.theme)}</div>
        <div class="project-meta">
          <span class="project-status ${sc[p.status]||'s-pending'}">${sl[p.status]||p.status}</span>
          <span class="project-date">${fmt(p.created_at)}</span>
        </div>
        ${p.status==='done' ? `
        <div class="project-actions" onclick="event.stopPropagation()">
          <button class="pa-btn pa-primary" onclick="openPreview('${p.id}','${esc(p.title)}')">▶ 预览</button>
          <button class="pa-btn pa-secondary" onclick="viewProject('${p.id}')">🔄 再编辑</button>
          <a class="pa-btn pa-secondary" href="/editor.html?id=${p.id}">✂ 剪辑</a>
          <a class="pa-btn pa-secondary" href="${authUrl('/api/projects/'+p.id+'/download')}">↓</a>
        </div>` : p.status==='error' ? `
        <div class="project-actions" onclick="event.stopPropagation()">
          <button class="pa-btn pa-secondary" style="flex:1" onclick="viewProject('${p.id}')">查看详情</button>
        </div>` : `
        <div class="project-actions" onclick="event.stopPropagation()">
          <button class="pa-btn pa-secondary" style="flex:1" onclick="viewProject('${p.id}')">查看进度</button>
        </div>`}
      </div>`).join('');
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

function loadAvatarPage() {
  loadAvModels();
}

async function loadAvModels() {
  try {
    const resp = await authFetch('/api/settings');
    const data = await resp.json();
    const providers = data.providers || [];
    const container = document.getElementById('av-model-selector');
    let html = `<div class="ig-model-opt active" data-model="auto" onclick="selectAvModel(this)">
      <span class="ig-model-icon">A</span>
      <div class="ig-model-info"><div class="ig-model-name">自动选择</div><div class="ig-model-desc">根据配置自动匹配</div></div>
    </div>`;
    providers.forEach(p => {
      (p.models || []).forEach(m => {
        if (m.use === 'avatar') {
          html += `<div class="ig-model-opt" data-model="${m.id}" data-provider="${p.id}" onclick="selectAvModel(this)">
            <span class="ig-model-icon">${(p.name || p.id)[0].toUpperCase()}</span>
            <div class="ig-model-info"><div class="ig-model-name">${esc(m.name || m.id)}</div><div class="ig-model-desc">${esc(p.name || p.id)}</div></div>
          </div>`;
        }
      });
    });
    container.innerHTML = html;
  } catch {}
}

function selectAvModel(el) {
  document.querySelectorAll('#av-model-selector .ig-model-opt').forEach(o => o.classList.remove('active'));
  el.classList.add('active');
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

function handleAvatarUpload(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = function(e) {
    const uploadCard = document.querySelector('.av-avatar-upload');
    uploadCard.innerHTML = `<img src="${e.target.result}" style="width:52px;height:52px;border-radius:50%;object-fit:cover" /><span>自定义</span>`;
    uploadCard.dataset.avatar = 'custom';
    selectAvatar(uploadCard);
  };
  reader.readAsDataURL(file);
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
    card.querySelector('.av-bg-preview').style.backgroundImage = `url(${e.target.result})`;
    card.querySelector('.av-bg-preview').style.backgroundSize = 'cover';
    card.querySelector('.av-bg-preview').classList.remove('av-bg-upload-ph');
  };
  reader.readAsDataURL(input.files[0]);
  selectAvatarBg(card);
}

function setAvatarRatio(ratio, btn) {
  avatarRatio = ratio;
  document.querySelectorAll('.av-ratio-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

async function startAvatarGeneration() {
  const btn = document.getElementById('av-gen-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="sto-li-spin">&#8635;</span> 生成中...';

  const text = document.getElementById('av-text-input')?.value || '';
  if (avatarDrive === 'text' && !text.trim()) {
    alert('请输入数字人要说的话');
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 2l9 5-9 5V2z" fill="currentColor"/></svg> 生成数字人视频';
    return;
  }

  // Show generating state in preview
  const previewBox = document.getElementById('av-preview-box');
  previewBox.innerHTML = `
    <div class="av-preview-empty" style="animation:fadeUp .3s ease">
      <div class="sto-li-spin" style="font-size:32px;color:var(--accent)">&#8635;</div>
      <div class="av-preview-text">正在生成数字人视频...</div>
      <div class="av-preview-sub">预计需要 1-3 分钟</div>
    </div>`;

  // Simulate generation (backend API would go here)
  setTimeout(() => {
    previewBox.innerHTML = `
      <div class="av-preview-empty" style="animation:fadeUp .3s ease">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" stroke="var(--success)" stroke-width="2"/><path d="M15 24l6 6 12-12" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div class="av-preview-text" style="color:var(--success)">数字人视频已生成</div>
        <div class="av-preview-sub">功能即将上线，敬请期待</div>
      </div>`;
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 2l9 5-9 5V2z" fill="currentColor"/></svg> 生成数字人视频';
  }, 3000);
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

// 启动
init();
