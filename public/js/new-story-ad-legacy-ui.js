(() => {
  const ROOT_ID = 'dhNewStoryAdLegacyMount';
  const TASK_STORAGE_KEY = 'vido_new_story_ad_current_task_id';
  const SAMPLE_BRIEF = '我想做一条品牌剧情广告：写清产品或服务、目标用户、核心卖点、期望场景和最后的引导动作。剧情要有真人或主体细节，节奏清晰，最后引导用户咨询或下单。';
  const VIDEO_RESOLUTION_LABELS = { '480p': '480p', '720p': '720p', '1080p': '1080p', '4k': '4K' };
  const CONTROL_ENVIRONMENT_OPTIONS = [
    ['auto', '自动'],
    ['indoor', '室内'],
    ['outdoor', '室外'],
    ['mixed', '室内+室外'],
    ['tech_commercial', '科技感商业'],
    ['custom', '自定义'],
  ];
  const CONTROL_PRODUCT_METHODS = [
    ['detail', '细节特写'],
    ['in_hand', '手持展示'],
    ['usage_demo', '使用演示'],
    ['scene_evidence', '场景证据'],
    ['proof', '效果证明'],
    ['cta', '收束引导'],
  ];
  const BGM_PROFILES = [
    ['auto', '自动匹配', '按广告内容自动选择曲风。'],
    ['warm', '温暖叙事', '适合生活方式、服务类或情感表达类剧情。'],
    ['premium', '高级质感', '适合品牌、空间、产品质感表达。'],
    ['tech', '科技律动', '适合软件、数据、效率工具。'],
  ];

  const SUBTITLE_STYLES = [
    ['popup', '弹跳出现', '主流推荐 · 抖音同款'],
    ['bouncy', '律动跳字', '节奏感 · 黄字'],
    ['karaoke', '卡拉OK', '逐字高亮 · 跟唱感'],
    ['neon', '霓虹发光', '赛博 · 直播间'],
    ['comic', '漫画黄底', '综艺感 · 顶部'],
    ['news', '新闻条', '黑底白字 · 严肃'],
    ['emphasis', '关键词强调', '数字/限时词自动放大'],
    ['classic', '经典静态', '白字黑边 · 传统'],
    ['fire', '火焰燃烧', '激情感 · 促销'],
    ['shake', '地震抖动', '紧张感 · 爆点'],
    ['gold', '土豪金', '奢华感 · 高端'],
    ['matrix', '科技矩阵', '未来感 · 科技'],
    ['film', '电影字幕', '大片感 · 纪录'],
    ['pink', '少女粉', '生活感 · 小红书'],
    ['wave', '波浪摇摆', '活力感 · 综艺'],
    ['zoom', '冲击放大', '爆款感 · 开场'],
  ];

  function subtitleStyleLabel(id = '') {
    return (SUBTITLE_STYLES.find(([key]) => key === id) || SUBTITLE_STYLES[0])[1];
  }

  const state = {
    mounted: false,
    token: sessionStorage.getItem('vido_token') || localStorage.getItem('vido_token') || localStorage.getItem('token') || '',
    taskId: '',
    context: null,
    sceneConfig: null,
    blueprint: null,
    storyboardStatus: null,
    shots: [],
    contracts: [],
    keyframes: [],
    review: null,
    ttsAudio: null,
    videoClips: [],
    videoShotStatuses: [],
    finalVideo: null,
    actorAsset: null,
    personAsset: null,
    personSpecLock: null,
    castProfiles: [],
    personGenerationProgress: null,
    sceneAssets: [],
    pendingChangeScope: 'none',
    sceneGenerationProgress: null,
    productAsset: null,
    referenceAssets: [],
    bgmAsset: null,
    bgmProfile: 'auto',
    voiceId: '',
    voiceName: '',
    voiceList: [],
    voiceGenderFilter: 'all',
    voiceLoading: false,
    musicLibrary: {
      query: '',
      results: [],
      page: 0,
      pageCount: 0,
      resultCount: 0,
      hasMore: false,
      note: '',
      loading: false,
    },
    voiceVolume: 1,
    bgmVolume: 0.16,
    outputRatio: '9:16',
    outputSize: 'standard',
    videoResolution: '720p',
    subtitleEnabled: true,
    subtitleStyle: 'popup',
    subtitleOptions: {
      smartEmphasis: true,
      fontName: '抖音美好体',
      fontSize: 72,
      color: '',
      outlineColor: '',
    },
    pendingShotUploadIndex: null,
    controlledProduction: {
      environment: { mode: 'auto', custom: '' },
      product: { enabled: false, presence: 'medium', lockStrength: 'standard', methods: [] },
      style: { mode: 'classic', notes: '' },
      negative: { text: '' },
      uiExpanded: false,
    },
    controlAiPending: {},
    blueprintDirty: false,
    storyboardDirty: false,
    taskStatus: '',
    taskStage: '',
    taskError: '',
    taskErrorCode: '',
    autoSaveStatus: 'idle',
    autoSaveMessage: '自动保存已开启',
    autoSaveLastAt: '',
    stageProgress: null,
    stageProgressTimer: null,
    activeGenerationId: '',
    activeStage: '',
    generationProgress: null,
    generationStartedAt: '',
    cancelRequested: false,
    adminVideoMonitorTimer: null,
    adminVideoMonitorLoading: false,
    busy: false,
    restoringTask: false,
    restoreError: '',
    currentStep: 1,
    shotEditorIndex: -1,
    shotEditorSnapshot: null,
  };

  let nsaVoicePreviewAudio = null;
  let nsaVoicePreviewObjectUrl = '';
  let nsaVoiceLoadPromise = null;
  let nsaMusicPreviewAudio = null;
  let autoSaveTimer = null;
  let autoSaveInFlight = false;
  let autoSaveVersion = 0;
  let autoSaveCommittedVersion = 0;
  const AUTO_SAVE_DELAY_MS = 900;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const root = () => document.getElementById(ROOT_ID);
  const within = sel => $(sel, root() || document);

  function activeField(selector) {
    const fields = $$(selector, root() || document);
    return fields.find(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects?.().length)) || fields[0] || null;
  }

  function writeAllFields(selector, value) {
    const fields = $$(selector, root() || document);
    fields.forEach(el => { el.value = value; });
    return fields.length;
  }

  function routeStep() {
    if (window.NewStoryAdTaskStore?.routeStep) return window.NewStoryAdTaskStore.routeStep();
    try {
      const step = Number(new URLSearchParams(location.search || '').get('nsa_step') || 0);
      if (Number.isFinite(step) && step >= 1 && step <= 5) return Math.round(step);
    } catch {}
    return 1;
  }

  function routeTaskId() {
    if (window.NewStoryAdTaskStore?.routeTaskId) return window.NewStoryAdTaskStore.routeTaskId();
    try {
      return normalizeText(new URLSearchParams(location.search || '').get('nsa_task_id') || '', 100);
    } catch {
      return '';
    }
  }

  function storedTaskId() {
    if (window.NewStoryAdTaskStore?.storedTaskId) return window.NewStoryAdTaskStore.storedTaskId();
    try {
      return normalizeText(localStorage.getItem(TASK_STORAGE_KEY) || '', 100);
    } catch {
      return '';
    }
  }

  function rememberTaskId(taskId = state.taskId) {
    if (window.NewStoryAdTaskStore?.rememberTaskId) {
      window.NewStoryAdTaskStore.rememberTaskId(taskId || '', state.currentStep);
      return;
    }
    const id = normalizeText(taskId || '', 100);
    try {
      if (id) localStorage.setItem(TASK_STORAGE_KEY, id);
      else localStorage.removeItem(TASK_STORAGE_KEY);
    } catch {}
    try {
      const url = new URL(location.href);
      url.searchParams.set('tab', 'new-story-ad');
      if (id) url.searchParams.set('nsa_task_id', id);
      else url.searchParams.delete('nsa_task_id');
      if (state.currentStep) url.searchParams.set('nsa_step', String(Math.max(1, Math.min(5, Number(state.currentStep) || 1))));
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch {}
  }

  function rememberRouteStep(step = state.currentStep) {
    if (window.NewStoryAdTaskStore?.rememberRouteStep) {
      window.NewStoryAdTaskStore.rememberRouteStep(step, state.taskId || '');
      return;
    }
    try {
      const url = new URL(location.href);
      url.searchParams.set('tab', 'new-story-ad');
      url.searchParams.set('nsa_step', String(Math.max(1, Math.min(5, Number(step) || 1))));
      if (state.taskId) url.searchParams.set('nsa_task_id', state.taskId);
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch {}
  }

  function escapeHtml(value = '') {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function verificationView(contract = null, qaKey = '', subject = '资产') {
    const qa = contract?.[qaKey] && typeof contract[qaKey] === 'object' ? contract[qaKey] : {};
    const status = String(contract?.status || 'unverified');
    const details = contract?.verification && typeof contract.verification === 'object' ? contract.verification : {};
    const reasons = [
      ...(Array.isArray(details.reasons) ? details.reasons : []),
      ...(Array.isArray(qa.mismatch_reasons) ? qa.mismatch_reasons : []),
      ...(Array.isArray(qa.conflicts) ? qa.conflicts : []),
    ].map(value => String(value || '').trim()).filter(Boolean);
    const uniqueReasons = [...new Set(reasons)].slice(0, 6);
    const scoreLabels = {
      identity_score: '身份', age_score: '年龄', wardrobe_score: '服装', body_score: '体态',
      shape_score: '形状', color_score: '颜色', material_score: '材质', product_score: '主体',
    };
    const scores = Object.entries(scoreLabels).map(([key, label]) => ({ label, value: Number(qa[key]) }))
      .filter(item => Number.isFinite(item.value) && item.value > 0)
      .map(item => ({ ...item, percent: Math.round(Math.max(0, Math.min(1, item.value)) * 100) }));
    if (status === 'verified' && qa.pass === true) {
      return { status, tone: 'verified', label: `${subject}已验证`, message: details.message || '当前资产版本已通过一致性验证', reasons: [], scores };
    }
    if (status === 'rejected') {
      return { status, tone: 'rejected', label: `${subject}未通过`, message: details.message || uniqueReasons[0] || '视觉一致性未达到使用要求', reasons: uniqueReasons, scores };
    }
    if (details.state === 'unavailable' || contract?.qa_unavailable === true) {
      return { status, tone: 'unavailable', label: `${subject}验证异常`, message: details.message || '视觉审核暂时不可用，请稍后重试', reasons: uniqueReasons, scores: [] };
    }
    return { status, tone: 'unverified', label: `${subject}待验证`, message: details.message || '首次使用或资产版本变化后需要验证一次', reasons: uniqueReasons, scores };
  }

  function verificationDetailsHtml(view = {}) {
    const lines = [view.message, ...(view.reasons || []).filter(reason => reason !== view.message)].filter(Boolean);
    if (!lines.length || view.tone === 'verified') return '';
    return `<div class="dh-nsa-verification-details is-${escapeHtml(view.tone || 'unverified')}">
      <b>${escapeHtml(view.label || '验证说明')}</b>
      ${(view.scores || []).length ? `<div class="dh-nsa-verification-scores">${view.scores.map(item => `<em>${escapeHtml(item.label)} ${item.percent}%</em>`).join('')}</div>` : ''}
      ${lines.map(line => `<span>${escapeHtml(line)}</span>`).join('')}
    </div>`;
  }

  function normalizeText(value = '', max = 1000) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  const TECHNICAL_LABELS = {
    extreme_wide: '大远景', wide: '远景', full: '全身景', medium: '中景', medium_close: '中近景',
    close_up: '近景', extreme_close_up: '特写', macro: '微距',
    eye_level: '平视', high_angle: '俯拍', low_angle: '仰拍', overhead: '顶视', dutch: '倾斜机位',
    over_shoulder: '越肩视角', pov: '主观视角',
    deep: '深景深', shallow: '浅景深', ultra_shallow: '极浅景深',
    none: '无转场', hard_cut: '直接切换', cut_on_action: '动作切换', match_cut: '匹配切换',
    dissolve: '叠化', fade: '淡入淡出',
  };

  function technicalLabel(value = '') {
    const key = normalizeText(value, 80);
    return TECHNICAL_LABELS[key] || key.replace(/_/g, ' ');
  }

  const PROMPT_LABEL_TEXT = {
    story: '剧情画面',
    character: '人物',
    product: '产品/商品',
    material: '材质/材料',
    space: '空间',
    comparison: '对比/说明',
    emotion: '情绪',
    process: '过程',
    proof: '证明',
    brand: '品牌',
    offer: '卖点',
    result: '结果',
    action: '动作',
    lighting: '光线氛围',
    camera: '镜头设计',
    composition: '构图方式',
    ui: '界面呈现',
    dialogue: '台词内容',
    endcard: '收尾画面',
    packshot: '产品定格',
  };
  const SHOT_TYPE_TEXT = {
    insert: '细节插入镜头',
    medium: '中景',
    close_up: '特写',
    closeup: '特写',
    product_detail: '产品细节',
    reaction: '反应镜头',
    endcard: '收束画面',
    packshot: '产品定格',
    wide: '全景',
  };

  function editorFriendlyPromptText(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const entries = raw.split(/\s*[;；\n]+\s*/).map(item => item.trim()).filter(Boolean);
    const output = [];

    entries.forEach((entry, entryIndex) => {
      const pair = entry.match(/^([a-z][a-z0-9_-]*)\s*[：:]\s*(.*)$/i);
      if (pair) {
        const key = String(pair[1] || '').toLowerCase();
        const content = String(pair[2] || '').replace(/\s+/g, ' ').trim();
        if (PROMPT_LABEL_TEXT[key] && content) {
          output.push(`${PROMPT_LABEL_TEXT[key]}：${content}`);
          return;
        }
        if (SHOT_TYPE_TEXT[key] && !content) {
          output.push(`镜头类型：${SHOT_TYPE_TEXT[key]}`);
          return;
        }
      }

      const token = entry.toLowerCase();
      if (SHOT_TYPE_TEXT[token]) {
        output.push(`镜头类型：${SHOT_TYPE_TEXT[token]}`);
        return;
      }

      // 已经是用户可读中文或未知业务专有内容时原样保留，避免写死行业词汇。
      output.push(entryIndex === 0 && /^[a-z_ -]+$/i.test(entry) ? `镜头说明：${entry}` : entry);
    });

    return output.join('\n') || raw;
  }

  function outputPixels(ratio = '9:16', size = 'standard') {
    const table = {
      '9:16': { standard: '720×1280', hd: '900×1600', fullhd: '1080×1920' },
      '16:9': { standard: '1280×720', hd: '1600×900', fullhd: '1920×1080' },
      '1:1': { standard: '1024×1024', hd: '1280×1280', fullhd: '1536×1536' },
      '3:4': { standard: '768×1024', hd: '960×1280', fullhd: '1080×1440' },
      '4:3': { standard: '1024×768', hd: '1280×960', fullhd: '1440×1080' },
    };
    return table[ratio]?.[size] || table['9:16'].standard;
  }

  function previewUrl(asset = {}) {
    if (!asset || typeof asset !== 'object') return '';
    return asset.previewUrl || asset.image_url || asset.imageUrl || asset.file_url || asset.url || '';
  }

  function revokePreview(asset = {}) {
    const url = asset?.previewUrl || '';
    if (url && url.startsWith('blob:')) {
      try { URL.revokeObjectURL(url); } catch {}
    }
  }

  function withAuthQuery(url = '') {
    const raw = String(url || '').trim();
    if (!raw || /^blob:/i.test(raw) || /^data:/i.test(raw)) return raw;
    if (/^\/api\/new-story-ad\/assets\//i.test(raw)) return raw;
    if (!state.token) return raw;
    try {
      const u = new URL(raw, location.origin);
      if (u.origin === location.origin) u.searchParams.set('token', state.token);
      return u.pathname + u.search + u.hash;
    } catch {
      const join = raw.includes('?') ? '&' : '?';
      return `${raw}${join}token=${encodeURIComponent(state.token)}`;
    }
  }

  function currentUserIsAdmin() {
    if (!state.token) return false;
    try {
      const part = String(state.token).split('.')[1] || '';
      const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
      return String(JSON.parse(atob(base64) || '{}').role || '').toLowerCase() === 'admin';
    } catch {
      return false;
    }
  }

  function compactUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw || /^blob:/i.test(raw) || /^data:/i.test(raw)) return '';
    return raw;
  }

  function actorUrls(asset = {}) {
    if (window.NewStoryAdActors?.collectUrls) return window.NewStoryAdActors.collectUrls(asset);
    const urls = [];
    const push = value => {
      const url = compactUrl(value);
      if (url && !urls.includes(url)) urls.push(url);
    };
    const walk = value => {
      if (!value) return;
      if (typeof value === 'string') return push(value);
      if (Array.isArray(value)) return value.forEach(walk);
      if (typeof value !== 'object') return;
      push(value.image_url || value.imageUrl || value.file_url || value.url || value.previewUrl || '');
      [
        value.extra_image_urls,
        value.extra_images,
        value.image_urls,
        value.images,
        value.view_images,
        value.views,
        value.cast_assets,
      ].forEach(walk);
    };
    walk(asset);
    return urls;
  }

  const ACTOR_VIEW_LABELS = {
    front: '正面',
    side: '侧面',
    back: '背面',
    action: '动作',
  };

  function actorViewKey(value = '', index = 0) {
    if (window.NewStoryAdActors?.viewKey) return window.NewStoryAdActors.viewKey(value, index);
    const raw = String(value || '').toLowerCase();
    if (/front|frontal|main|primary|正面/.test(raw)) return 'front';
    if (/side|profile|semi|half|侧面|半侧/.test(raw)) return 'side';
    if (/back|rear|背面/.test(raw)) return 'back';
    if (/action|pose|gesture|motion|动作/.test(raw)) return 'action';
    return ['front', 'side', 'back', 'action'][Number(index) || 0] || `view_${index + 1}`;
  }

  function actorViewLabel(key = '', index = 0) {
    if (window.NewStoryAdActors?.viewLabel) return window.NewStoryAdActors.viewLabel(key, index);
    return ACTOR_VIEW_LABELS[key] || `参考 ${Number(index) + 1}`;
  }

  function actorViewEntries(asset = {}) {
    if (window.NewStoryAdActors?.viewEntries) return window.NewStoryAdActors.viewEntries(asset);
    const metadata = asset?.metadata || {};
    const sourceViews = Array.isArray(asset?.view_images) && asset.view_images.length
      ? asset.view_images
      : (Array.isArray(metadata.view_images) ? metadata.view_images : []);
    const entries = [];
    const seen = new Set();
    const push = (view, index = entries.length) => {
      const url = compactUrl(typeof view === 'string' ? view : (view?.url || view?.image_url || view?.imageUrl || view?.file_url || view?.previewUrl || ''));
      if (!url || seen.has(url)) return;
      seen.add(url);
      const key = actorViewKey(typeof view === 'string' ? '' : (view?.key || view?.view || view?.label || ''), index);
      entries.push({
        key,
        label: (typeof view === 'object' && view?.label && !/^(front|side|back|action)$/i.test(String(view.label))) ? view.label : actorViewLabel(key, index),
        url,
      });
    };
    sourceViews.forEach(push);
    if (!entries.length) actorUrls(asset).slice(0, 4).forEach((url, index) => push({ url, key: actorViewKey('', index) }, index));
    return entries;
  }

  function actorReferenceKind(asset = {}) {
    if (window.NewStoryAdActors?.referenceKind) return window.NewStoryAdActors.referenceKind(asset);
    const metadata = asset.metadata || {};
    const source = String(asset.source || metadata.source || asset.type || '').toLowerCase();
    const kind = String(asset.reference_kind || metadata.reference_kind || '').toLowerCase();
    const text = [source, kind, asset.name, asset.description, metadata.name, metadata.prompt]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (/real_photo|uploaded_photo|uploaded_person_reference|human_photo|authorized_real_actor|licensed_actor|真人照片|授权真人|真人演员/.test(text)) return 'real_photo';
    if (/synthetic_realistic_actor|generated_real_actor|realistic_actor|local_actor_library_generated|真人感演员|真人演员包/.test(text)) return 'synthetic_realistic_actor';
    if (/ai_generated|person_sheet|generated|ai/.test(text)) return 'ai_generated';
    return kind || 'unknown';
  }

  function actorReferenceLabel(asset = {}) {
    if (window.NewStoryAdActors?.referenceLabel) return window.NewStoryAdActors.referenceLabel(asset);
    const kind = actorReferenceKind(asset);
    if (kind === 'real_photo') return '真人照片参考';
    if (kind === 'synthetic_realistic_actor') return '拟真一致性演员';
    if (kind === 'ai_generated') return 'AI 拟真演员参考';
    return '演员参考';
  }

  function actorIsRealPerson(asset = {}) {
    return actorReferenceKind(asset) === 'real_photo';
  }

  function actorIsSynthetic(asset = {}) {
    return actorReferenceKind(asset) === 'synthetic_realistic_actor'
      || asset.production_usable_actor === true
      || asset.metadata?.production_usable_actor === true;
  }

  function personGenderValue(value = '') {
    if (window.NewStoryAdActors?.genderValue) return window.NewStoryAdActors.genderValue(value);
    const raw = String(value || '').toLowerCase();
    if (/female|woman|girl|女/.test(raw)) return 'female';
    if (/male|man|boy|男/.test(raw)) return 'male';
    return '';
  }

  function personAgeValue(value = '') {
    const raw = String(value || '').toLowerCase();
    if (/55|60|senior|年长|老年/.test(raw)) return 'senior_55_plus';
    if (/40|45|50|middle|中年/.test(raw)) return 'middle_40_55';
    if (/30|35|成熟/.test(raw)) return 'adult_30_40';
    if (/17|18|20|25|young|青年/.test(raw)) return 'young_adult_17_25';
    if (/teen|13|14|15|16|青少年/.test(raw)) return 'teen_13_17';
    return '';
  }

  function personOriginValue(value = '') {
    const raw = String(value || '').toLowerCase();
    if (/china|chinese|east_asian|asian|中国|东亚/.test(raw)) return 'east_asian_cn';
    if (/southeast|东南亚/.test(raw)) return 'southeast_asian';
    if (/white|europe|欧美|白人/.test(raw)) return 'white_european';
    if (/black|african|非洲|黑人/.test(raw)) return 'black_african';
    if (/middle.east|中东/.test(raw)) return 'middle_eastern';
    if (/south.asian|南亚/.test(raw)) return 'south_asian';
    if (/latino|latin|拉美/.test(raw)) return 'latino';
    return '';
  }

  function actorCastMembers(asset = {}) {
    const raw = Array.isArray(asset.cast_assets) && asset.cast_assets.length
      ? asset.cast_assets
      : [{ cast_member_index: 1, cast_role: '核心人物', image_url: actorUrls(asset)[0] || '' }];
    return raw.map((member, index) => {
      const urls = actorUrls(member);
      return {
        ...member,
        cast_member_index: Number(member.cast_member_index || index + 1) || index + 1,
        cast_role: member.cast_role || member.role || `角色${index + 1}`,
        name: member.name || member.cast_role || `角色${index + 1}`,
        urls,
        image_url: urls[0] || member.image_url || member.url || '',
      };
    });
  }

  function actorMaterialToPersonAsset(asset = {}) {
    const metadata = asset.metadata || {};
    const urls = actorUrls(asset);
    const explicitViews = Array.isArray(asset.view_images) && asset.view_images.length
      ? asset.view_images
      : (Array.isArray(metadata.view_images) ? metadata.view_images : []);
    const kind = actorReferenceKind(asset);
    return {
      id: asset.id || asset.actor_asset_id || '',
      actor_asset_id: asset.actor_asset_id || metadata.actor_asset_id || asset.id || '',
      actor_id: asset.actor_id || metadata.actor_id || '',
      material_id: asset.id || '',
      name: asset.name || metadata.name || '真人演员素材',
      type: 'actor_material',
      source: asset.source || metadata.source || 'actor_library',
      reference_kind: kind,
      real_person_reference: kind === 'real_photo',
      is_ai_generated: kind === 'ai_generated',
      production_usable_actor: kind === 'synthetic_realistic_actor' || asset.production_usable_actor === true || metadata.production_usable_actor === true,
      gender: asset.gender || metadata.gender || '',
      detected_gender: asset.detected_gender || metadata.detected_gender || '',
      age: asset.age || asset.age_range || metadata.age || metadata.age_range || '',
      origin: asset.origin || asset.region || asset.ethnicity || metadata.origin || metadata.region || metadata.ethnicity || '',
      url: urls[0] || '',
      image_url: urls[0] || '',
      previewUrl: urls[0] || '',
      extra_image_urls: urls.slice(1),
      view_images: explicitViews,
      cast_assets: Array.isArray(asset.cast_assets) ? asset.cast_assets : (Array.isArray(metadata.cast_assets) ? metadata.cast_assets : []),
      cast_mode: asset.cast_mode || metadata.cast_mode || '',
      expected_people: asset.expected_people || metadata.expected_people || '',
      person_count: asset.person_count || metadata.person_count || '',
      view_count: Number(asset.view_count || urls.length) || 1,
      description: asset.description || metadata.description || '授权真人/演员素材，会作为剧情广告人物一致性参考。',
      metadata,
    };
  }

  function applyPersonAssetConstraints(asset = {}) {
    if (!asset || typeof asset !== 'object') return;
    const spec = collectPersonSpec();
    const gender = personGenderValue(asset.detected_gender || asset.gender || asset.metadata?.detected_gender || asset.metadata?.gender || '');
    const age = personAgeValue(asset.age || asset.age_range || asset.metadata?.age || asset.metadata?.age_range || asset.description || '');
    const origin = personOriginValue(asset.origin || asset.region || asset.ethnicity || asset.metadata?.origin || asset.metadata?.region || asset.description || '');
    const rawCastMode = String(asset.cast_mode || asset.castMode || asset.metadata?.cast_mode || '').toLowerCase();
    const memberCount = Array.isArray(asset.cast_assets) ? asset.cast_assets.length : 0;
    const count = Number(asset.expected_people || asset.person_count || asset.metadata?.expected_people || memberCount || 0);
    const castMode = ['single', 'dual', 'group'].includes(rawCastMode)
      ? rawCastMode
      : (count >= 3 ? 'group' : (count === 2 ? 'dual' : 'single'));
    const next = { ...spec, castMode, expectedPeople: count || '' };
    if (gender) next.gender = gender;
    if (age) next.age = age;
    if (origin) next.origin = origin;
    Object.entries(next).forEach(([key, value]) => {
      if (value !== undefined && value !== null) writeAllFields(`[data-nsa-person-spec="${key}"]`, value);
    });
    state.personSpecLock = {
      source: asset.name || asset.actor_asset_id || asset.id || '已选演员',
      actor_asset_id: asset.actor_asset_id || asset.asset_library_id || asset.material_id || asset.id || '',
      gender,
      age,
      origin,
      castMode,
      expected_people: count || (castMode === 'dual' ? 2 : (castMode === 'single' ? 1 : 0)),
      reference_kind: actorReferenceKind(asset),
    };
    syncCastProfilesFromPersonAsset(asset);
  }

  function castProfileFromPersonAsset(asset = state.personAsset || state.actorAsset) {
    if (!asset || asset.uploading || asset.failed) return null;
    const urls = actorUrls(asset);
    const primaryUrl = compactUrl(asset.image_url || asset.url || asset.previewUrl || urls[0] || '');
    const assetId = asset.actor_asset_id || asset.asset_library_id || asset.material_id || asset.id || '';
    if (!primaryUrl && !assetId) return null;
    const spec = collectPersonSpec();
    const outfit = String(spec.wardrobeText || asset.outfit || '').trim() || '保持演员素材中的同一套服装、发型和整体气质';
    return {
      id: 'cast_primary',
      name: spec.displayName || asset.name || '核心人物',
      displayName: spec.displayName || '',
      roleName: spec.roleName || '广告核心人物',
      sourceType: actorReferenceKind(asset),
      assetId,
      actor_asset_id: asset.actor_asset_id || '',
      actor_id: asset.actor_id || '',
      referenceImageUrl: primaryUrl,
      image_url: primaryUrl,
      extra_image_urls: urls.slice(1),
      gender: spec.gender || asset.gender || '',
      origin: spec.origin || asset.origin || '',
      appearance: {
        gender: spec.gender || asset.gender || '',
        ageRange: spec.age || asset.age || '',
        origin: spec.origin || asset.origin || '',
        userPrompt: [spec.appearanceText, asset.spec_description || asset.description, primaryUrl ? '已锁定真人/演员素材脸型、五官、身形和真实照片质感' : ''].filter(Boolean).join('；'),
        temperament: spec.temperamentText || '',
      },
      wardrobe: { mode: 'auto', userPrompt: outfit },
      hairMakeup: { userPrompt: spec.hairMakeupText || '保持演员素材发型和妆造一致' },
      outfit,
      negativeText: spec.negativeText || '',
      description: [spec.appearanceText, outfit ? `服装：${outfit}` : '', spec.hairMakeupText ? `发型妆造：${spec.hairMakeupText}` : ''].filter(Boolean).join('；'),
      identityLock: { face: true, outfit: true },
    };
  }

  function syncCastProfilesFromPersonAsset(asset = state.personAsset || state.actorAsset) {
    const profile = castProfileFromPersonAsset(asset);
    state.castProfiles = profile ? [profile] : [];
  }

  function personAssetPayload() {
    const asset = state.personAsset || state.actorAsset || null;
    if (!asset || asset.uploading || asset.failed) return null;
    const urls = actorUrls(asset);
    const imageUrl = compactUrl(asset.image_url || asset.url || asset.previewUrl || urls[0] || '');
    const assetId = asset.actor_asset_id || asset.asset_library_id || asset.material_id || asset.id || '';
    if (!imageUrl && !assetId) return null;
    const kind = actorReferenceKind(asset);
    return {
      id: asset.id || assetId || 'new_story_person_asset',
      actor_asset_id: asset.actor_asset_id || asset.asset_library_id || asset.material_id || '',
      actor_id: asset.actor_id || asset.metadata?.actor_id || '',
      material_id: asset.material_id || asset.asset_library_id || '',
      cast_mode: asset.cast_mode || asset.castMode || asset.metadata?.cast_mode || '',
      expected_people: asset.expected_people || asset.person_count || asset.metadata?.expected_people || '',
      person_count: asset.person_count || asset.expected_people || asset.metadata?.person_count || '',
      cast_assets: Array.isArray(asset.cast_assets) ? asset.cast_assets : [],
      name: asset.name || (kind === 'real_photo' ? '真人照片参考' : '拟真一致性演员'),
      type: asset.type || 'new_story_ad_actor',
      source: asset.source || 'person_asset',
      reference_kind: kind,
      is_ai_generated: kind === 'ai_generated',
      production_usable_actor: actorIsSynthetic(asset),
      real_person_reference: kind === 'real_photo',
      gender: asset.gender || asset.detected_gender || asset.metadata?.gender || '',
      detected_gender: asset.detected_gender || asset.metadata?.detected_gender || '',
      age: asset.age || asset.age_range || asset.metadata?.age || asset.metadata?.age_range || '',
      origin: asset.origin || asset.metadata?.origin || '',
      image_url: imageUrl,
      url: imageUrl,
      extra_image_urls: urls.slice(1),
      view_images: Array.isArray(asset.view_images) ? asset.view_images : [],
      view_count: asset.view_count || asset.view_images?.length || urls.length || 1,
      description: asset.spec_description || asset.description || personDescription(),
    };
  }

  function normalizeControlledProduction(input = state.controlledProduction) {
    const src = input && typeof input === 'object' ? input : {};
    const environment = src.environment || {};
    const product = src.product || {};
    const style = src.style || {};
    const negative = src.negative || {};
    const envValues = new Set(CONTROL_ENVIRONMENT_OPTIONS.map(([value]) => value));
    const methodValues = new Set(CONTROL_PRODUCT_METHODS.map(([value]) => value));
    return {
      environment: {
        mode: envValues.has(environment.mode) ? environment.mode : 'auto',
        custom: normalizeText(environment.custom, 160),
      },
      product: {
        enabled: product.enabled === true,
        presence: ['low', 'medium', 'high'].includes(product.presence) ? product.presence : 'medium',
        lockStrength: ['loose', 'standard', 'strict'].includes(product.lockStrength) ? product.lockStrength : 'standard',
        methods: Array.isArray(product.methods) ? product.methods.filter(x => methodValues.has(x)) : [],
      },
      style: {
        mode: 'classic',
        notes: normalizeText(style.notes, 300),
      },
      negative: {
        text: normalizeText(negative.text, 300),
      },
      uiExpanded: src.uiExpanded === true,
    };
  }

  function controlledProduction() {
    state.controlledProduction = normalizeControlledProduction(state.controlledProduction);
    return state.controlledProduction;
  }

  function controlledEnabled(ctrl = controlledProduction()) {
    return ctrl.environment.mode !== 'auto'
      || !!ctrl.environment.custom
      || ctrl.product.enabled === true
      || !!ctrl.style.notes
      || !!ctrl.negative.text;
  }

  function controlledPayload() {
    const ctrl = controlledProduction();
    const enabled = controlledEnabled(ctrl);
    return {
      enabled,
      mode: enabled ? 'controlled' : 'classic',
      environment_control: {
        mode: ctrl.environment.mode,
        custom: ctrl.environment.custom,
      },
      product_control: {
        enabled: ctrl.product.enabled === true,
        presence: ctrl.product.presence,
        lock_strength: ctrl.product.lockStrength,
        methods: ctrl.product.methods,
      },
      style_control: {
        mode: 'classic',
        notes: ctrl.style.notes,
      },
      negative_control: {
        text: ctrl.negative.text,
      },
    };
  }

  function collectPersonSpec() {
    const spec = {};
    const keys = new Set($$('[data-nsa-person-spec]', root()).map(el => el.dataset.nsaPersonSpec).filter(Boolean));
    keys.forEach(key => {
      const el = activeField(`[data-nsa-person-spec="${key}"]`);
      spec[key] = String(el?.value || '').trim();
    });
    return spec;
  }

  function splitNegativeText(text = '') {
    return normalizeText(text, 500)
      .split(/[；;\n。]+/)
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 20);
  }

  function assetPayloadList(options = {}) {
    const list = [];
    const add = (asset, type) => {
      if (!asset) return;
      const url = previewUrl(asset);
      if (!url || url.startsWith('blob:')) return;
      list.push({
        id: asset.id || `${type}_${list.length + 1}`,
        type,
        url,
        image_url: asset.image_url || (asset.mimetype?.startsWith('audio/') ? '' : url),
        name: asset.name || asset.original_name || type,
        description: asset.description || '',
      });
    };
    add(state.productAsset, 'product');
    if (options.includePerson !== false) add(state.personAsset || state.actorAsset, 'person_reference');
    state.referenceAssets.forEach(asset => add(asset, 'storyboard_reference'));
    return list;
  }

  function toast(message, type = '') {
    if (typeof window.toast === 'function') return window.toast(message, type);
    const el = $('#dhToast');
    if (!el) return;
    el.textContent = message;
    el.className = `dh-toast ${type || ''}`;
    el.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.style.display = 'none'; }, 3200);
  }

  function apiErrorMessage(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') return value.message || value.msg || value.error_description || apiErrorMessage(value.error) || value.code || '';
    return String(value);
  }

  let refreshPromise = null;
  async function refreshAuth() {
    if (window.NewStoryAdApi?.refreshAuth) {
      return window.NewStoryAdApi.refreshAuth((token) => { state.token = token; });
    }
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const resp = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!resp.ok) return false;
        const data = await resp.json();
        const token = data?.success && data?.data?.access_token;
        if (!token) return false;
        state.token = token;
        sessionStorage.setItem('vido_token', token);
        localStorage.setItem('vido_token', token);
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => { refreshPromise = null; }, 1200);
      }
    })();
    return refreshPromise;
  }

  async function api(path, opts = {}) {
    if (window.NewStoryAdApi?.request) {
      return window.NewStoryAdApi.request(path, {
        ...opts,
        token: state.token,
        onToken: (token) => { state.token = token; },
      });
    }
    const headers = { ...(opts.headers || {}) };
    if (!headers['Content-Type'] && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const body = opts.body instanceof FormData ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined);
    let resp = await fetch(path, { ...opts, credentials: opts.credentials || 'include', headers, body });
    if (resp.status === 401 && await refreshAuth()) {
      const retryHeaders = { ...headers };
      if (state.token) retryHeaders.Authorization = `Bearer ${state.token}`;
      resp = await fetch(path, { ...opts, credentials: opts.credentials || 'include', headers: retryHeaders, body });
    }
    if (resp.status === 401) {
      location.href = '/?login=1&target=' + encodeURIComponent('/digital-human?tab=new-story-ad');
      throw new Error('unauth');
    }
    const raw = await resp.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    if (!resp.ok || data?.success === false) {
      const isHtmlError = /^\s*<!doctype html|^\s*<html[\s>]/i.test(raw || '');
      const friendly = isHtmlError && resp.status === 404
        ? `接口不存在或服务仍是旧版本，请重启服务后再试：${path}`
        : (isHtmlError ? `接口返回了 HTML 错误页：HTTP ${resp.status}` : '');
      const err = new Error(apiErrorMessage(data?.error) || apiErrorMessage(data?.message) || friendly || raw.slice(0, 180) || `HTTP ${resp.status}`);
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data || {};
  }

  function setCopy() {
    const title = within('#dhNsaAdModeTitle');
    const sub = within('#dhNsaAdModeSub');
    if (title) title.textContent = '剧情广告';
    if (sub) sub.textContent = '广告需求 → 场景配置 → 剧本生成 → 分镜生成 → 广告合成。点击合成后进入任务中心查看全量内容。';
    const text = within('#dhNsaAdText');
    if (text) {
      text.placeholder = '例如：我想做一条品牌剧情广告。写清产品、目标用户、核心卖点、期望场景和最后引导动作。';
    }
    const gate = within('#dhNsaAdGateHint');
    if (gate) gate.textContent = '先描述你想做什么广告；AI 会先生成场景配置，确认后再生成剧本和分镜。';
    const cap = within('#dhNsaAdCapabilityStrip');
    if (cap) {
      cap.innerHTML = '';
      cap.hidden = true;
    }
    const stepButtons = [
      ['#dhNsaAdGenerate', '生成场景配置'],
      ['#dhNsaAdStoryboard', '确认基础信息，生成剧本'],
      ['#dhNsaAdPreviewFrames', '确认剧本，生成分镜'],
      ['#dhNsaAdGenerateFinalFrames', '按脚本生成真实画面'],
      ['#dhNsaAdRegenerateAllShotVideos', '重新生成全部视频'],
      ['#dhNsaAdGenerateShotVideos', '补齐/修复镜头视频'],
      ['#dhNsaAdGoCompose', '分镜视频全部通过，进入广告合成'],
      ['#dhNsaAdConfirmGenerate', '合成广告'],
    ];
    stepButtons.forEach(([selector, label]) => {
      const btn = within(selector);
      if (btn) btn.textContent = label;
    });
  }

  function mount() {
    const host = root();
    if (!host) return;
    if (state.mounted && host.dataset.mounted === '1') return;
    if (!within('#dhNsaAdText') || !within('#dhNsaAdSteps')) {
      host.innerHTML = '<div class="dh-luxgen-empty"><b>剧情广告界面模板未找到</b><span>请刷新页面后重试。</span></div>';
      return;
    }
    host.dataset.mounted = '1';
    state.mounted = true;
    setCopy();
    bind();
    state.restoringTask = !!(routeTaskId() || storedTaskId()) && !state.taskId;
    showStep(state.restoringTask ? 1 : routeStep(), { remember: false });
    renderAll();
    restoreCurrentTask();
  }

  function payload() {
    const brief = (within('#dhNsaAdText')?.value || '').trim();
    const duration = Number(within('#dhNsaAdDuration')?.value || 30);
    const ratio = within('#dhNsaAdRatio')?.value || state.outputRatio || '9:16';
    const size = within('#dhNsaAdSize')?.value || state.outputSize || 'standard';
    const videoResolution = within('#dhNsaAdVideoResolution')?.value || state.videoResolution || '720p';
    const voiceId = state.voiceId || '';
    const subject = state.sceneConfig?.advertised_subject || brief.slice(0, 36) || '剧情广告';
    const person = collectPersonSpec();
    const noHuman = person.castMode === 'no_human';
    const personAsset = noHuman ? null : personAssetPayload();
    const sceneAssets = window.NewStoryAdSceneAssets?.payload?.(state) || state.sceneAssets || [];
    const sceneSpec = window.NewStoryAdSceneAssets?.specPayload?.() || {};
    const castProfiles = noHuman ? [] : (state.castProfiles.length ? state.castProfiles : (castProfileFromPersonAsset() ? [castProfileFromPersonAsset()] : []));
    const assets = assetPayloadList({ includePerson: !noHuman });
    const ctrl = controlledPayload();
    const negative = [
      ...splitNegativeText(ctrl.negative_control.text),
    ];
    return {
      brief,
      content: brief,
      product_subject: subject,
      duration_sec: duration,
      duration,
      output_ratio: ratio,
      output_size: size,
      video_resolution: videoResolution,
      cast_mode: noHuman ? 'no_human' : (person.castMode || 'auto'),
      expected_people: noHuman ? 0 : (Number(person.expectedPeople || 0) || undefined),
      production_mode: within('#dhNsaAdProductionMode')?.value || 'auto',
      voice_id: voiceId,
      voice_name: state.voiceName || '',
      include_voiceover: !!voiceId,
      subtitle: state.subtitleEnabled,
      subtitle_style: state.subtitleStyle || 'popup',
      subtitle_config: {
        show: state.subtitleEnabled,
        style: state.subtitleStyle || 'popup',
        ...(state.subtitleOptions || {}),
      },
      voice_volume: state.voiceVolume,
      bgm_volume: state.bgmVolume,
      bgm_profile: state.bgmProfile || 'auto',
      bgm_asset: state.bgmAsset,
      assets,
      references: assets,
      person_spec: noHuman ? { castMode: 'no_human' } : person,
      person_asset: personAsset,
      scene_spec: sceneSpec,
      scene_assets: sceneAssets,
      cast_profiles: castProfiles,
      person_context: {
        source: noHuman ? 'no_human_mode' : (personAsset ? 'selected_real_actor_or_person_asset' : 'person_spec'),
        person_spec: noHuman ? { castMode: 'no_human' } : person,
        person_asset: personAsset,
        cast_profiles: castProfiles,
        person_notes: noHuman ? [] : [personDescription(person)].filter(Boolean),
        real_person_locked: !!(personAsset && personAsset.real_person_reference),
        production_usable_actor: !!(personAsset && personAsset.production_usable_actor),
      },
      controlled_production: ctrl,
      forbidden: negative,
      source: 'new_story_ad_legacy_style_ui',
      change_scope: state.pendingChangeScope || 'none',
    };
  }

  function personSpec(name) {
    const el = activeField(`[data-nsa-person-spec="${name}"]`);
    return el ? String(el.value || '').trim() : '';
  }

  function syncOptionControls() {
    const ratioSelect = within('#dhNsaAdRatio');
    const sizeSelect = within('#dhNsaAdSize');
    const resolutionSelect = within('#dhNsaAdVideoResolution');
    if (ratioSelect) ratioSelect.value = state.outputRatio;
    if (sizeSelect) state.outputSize = sizeSelect.value || state.outputSize || 'standard';
    if (resolutionSelect) resolutionSelect.value = state.videoResolution;
    $$('[data-nsa-ratio]', root()).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.nsaRatio === state.outputRatio);
    });
    $$('[data-nsa-video-resolution]', root()).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.nsaVideoResolution === state.videoResolution);
    });
    const hint = within('#dhNsaAdOutputHint');
    if (hint) {
      hint.textContent = `${state.outputRatio} · 关键帧 ${outputPixels(state.outputRatio, state.outputSize)} · 视频 ${VIDEO_RESOLUTION_LABELS[state.videoResolution] || '720p'}`;
    }
    const taskMeta = within('#dhNsaAdTaskMeta');
    if (taskMeta) taskMeta.textContent = `提交后进入任务中心 · ${Number(within('#dhNsaAdDuration')?.value || 30)} 秒 · ${state.outputRatio}`;
  }

  function markSourceDirty(scope = 'source') {
    const priority = { none: 0, person: 1, scene: 2, product: 3, source: 4 };
    const current = state.pendingChangeScope || 'none';
    state.pendingChangeScope = priority[scope] >= priority[current] ? scope : current;
    if (scope === 'source') {
      state.context = null;
      state.sceneConfig = null;
      state.sceneAssets = [];
      state.sceneGenerationProgress = null;
    } else if (scope === 'scene' || scope === 'product') {
      // Keep the last confirmed base information and scene previews visible
      // while the user edits dependent controls. The pending scope is sent to
      // the server, which performs revision invalidation only when the user
      // actually saves or regenerates instead of blanking the page on input.
      state.sceneGenerationProgress = null;
    }
    state.blueprint = null;
    state.shots = [];
    state.contracts = [];
    state.keyframes = [];
    state.review = null;
    state.ttsAudio = null;
    state.videoClips = [];
    state.videoShotStatuses = [];
    state.finalVideo = null;
  }

  function resetForNewSession() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    autoSaveInFlight = false;
    autoSaveVersion = 0;
    autoSaveCommittedVersion = 0;
    state.taskId = '';
    rememberTaskId('');
    markSourceDirty();
    revokePreview(state.actorAsset);
    revokePreview(state.personAsset);
    revokePreview(state.productAsset);
    revokePreview(state.bgmAsset);
    state.actorAsset = null;
    state.personAsset = null;
    state.personSpecLock = null;
    state.castProfiles = [];
    state.personGenerationProgress = null;
    state.sceneAssets = [];
    state.sceneGenerationProgress = null;
    state.productAsset = null;
    state.referenceAssets.forEach(revokePreview);
    state.referenceAssets = [];
    state.bgmAsset = null;
    state.bgmProfile = 'auto';
    state.voiceId = '';
    state.voiceName = '';
    state.voiceVolume = 1;
    state.bgmVolume = 0.16;
    state.outputRatio = '9:16';
    state.outputSize = 'standard';
    state.videoResolution = '720p';
    state.subtitleEnabled = true;
    state.subtitleStyle = 'popup';
    state.pendingShotUploadIndex = null;
    state.controlledProduction = {
      environment: { mode: 'auto', custom: '' },
      product: { enabled: false, presence: 'medium', lockStrength: 'standard', methods: [] },
      style: { mode: 'classic', notes: '' },
      negative: { text: '' },
      uiExpanded: false,
    };
    state.controlAiPending = {};
    state.blueprintDirty = false;
    state.storyboardDirty = false;
    state.taskStatus = '';
    state.taskStage = '';
    state.taskError = '';
    state.taskErrorCode = '';
    state.autoSaveStatus = 'idle';
    state.autoSaveMessage = '自动保存已开启';
    state.autoSaveLastAt = '';
    state.activeGenerationId = '';
    state.activeStage = '';
    state.generationProgress = null;
    state.generationStartedAt = '';
    state.cancelRequested = false;
    state.busy = false;
    ['#dhNsaAdText', '#dhNsaAdVoiceId'].forEach(sel => {
      const el = within(sel);
      if (el) el.value = '';
    });
    ['#dhNsaAdProductFile', '#dhNsaAdPersonFile', '#dhNsaAdAssetFile', '#dhNsaAdBgmFile'].forEach(sel => {
      const el = within(sel);
      if (el) el.value = '';
    });
    $$('[data-nsa-person-spec]', root()).forEach(el => {
      if (el.tagName === 'SELECT') {
        if (el.dataset.nsaPersonSpec === 'origin') el.value = 'match_brief';
        else if (el.dataset.nsaPersonSpec === 'age') el.value = 'match_brief';
        else el.value = el.querySelector('option')?.value || '';
      } else {
        el.value = '';
      }
    });
    window.NewStoryAdSceneAssets?.clearSpecInputs?.();
    showStep(1, { remember: false });
    setBusy(false);
    renderAll();
  }

  function renderAdvancedControls() {
    const host = within('#dhNsaAdControlledProduction');
    if (!host) return;
    const ctrl = controlledProduction();
    const enabled = controlledEnabled(ctrl);
    const methodSet = new Set(ctrl.product.methods || []);
    const pending = state.controlAiPending || {};
    const styleBusy = !!pending.style;
    const negativeBusy = !!pending.negative;
    host.innerHTML = `
      <details class="dh-luxgen-control-box" data-nsa-control-box ${ctrl.uiExpanded ? 'open' : ''}>
        <summary>
          <span>
            <b>高级设置</b>
            <small>${enabled ? '已启用增强控制，后续会按下方约束生成' : '默认不启用，不影响当前剧情广告流程'}</small>
          </span>
          <span class="dh-luxgen-control-meta ${enabled ? 'is-controlled' : 'is-classic'}">
            <i>${ctrl.uiExpanded ? '收起设置' : '展开设置'}</i>
          </span>
        </summary>
        <div class="dh-luxgen-control-note">
          需要固定场景方向、商品露出、画面风格或禁止项时再展开填写；不填写时按广告需求自动判断。
        </div>
        <div class="dh-luxgen-control-grid">
          <section class="dh-luxgen-control-card">
            <div class="dh-luxgen-control-title"><span><b>场景方向</b><span>限定镜头发生的空间方向，具体业务边界仍按当前需求判断。</span></span></div>
            <div class="dh-luxgen-segmented" role="group" aria-label="场景方向">
              ${CONTROL_ENVIRONMENT_OPTIONS.map(([value, label]) => `<button type="button" data-nsa-control-env="${value}" class="${ctrl.environment.mode === value ? 'active' : ''}">${label}</button>`).join('')}
            </div>
            <input class="dh-input" data-nsa-control-custom-env placeholder="自定义场景要求：空间、时间、光线或动线" value="${escapeHtml(ctrl.environment.custom)}">
          </section>
          <section class="dh-luxgen-control-card">
            <div class="dh-luxgen-control-title"><span><b>商品融入</b><span>要求商品/服务成为镜头证据，可设置出现频率、锁定程度和展示方式。</span></span></div>
            <label class="dh-luxgen-inline-check"><input type="checkbox" data-nsa-control-product-enabled ${ctrl.product.enabled ? 'checked' : ''}> <span>按镜头规则要求商品入镜</span></label>
            <div class="dh-luxgen-control-fields">
              <label><span>入镜强度</span><select class="dh-input" data-nsa-control-product-presence>
                <option value="low" ${ctrl.product.presence === 'low' ? 'selected' : ''}>低：只在必要镜头出现</option>
                <option value="medium" ${ctrl.product.presence === 'medium' ? 'selected' : ''}>中：关键镜头必须出现</option>
                <option value="high" ${ctrl.product.presence === 'high' ? 'selected' : ''}>高：多数镜头有证据</option>
              </select></label>
              <label><span>锁定强度</span><select class="dh-input" data-nsa-control-product-lock>
                <option value="loose" ${ctrl.product.lockStrength === 'loose' ? 'selected' : ''}>宽松：类别正确</option>
                <option value="standard" ${ctrl.product.lockStrength === 'standard' ? 'selected' : ''}>标准：外观和用途一致</option>
                <option value="strict" ${ctrl.product.lockStrength === 'strict' ? 'selected' : ''}>严格：按上传商品图锁定</option>
              </select></label>
            </div>
            <div class="dh-luxgen-check-grid">
              ${CONTROL_PRODUCT_METHODS.map(([value, label]) => `<label><input type="checkbox" data-nsa-control-product-method="${value}" ${methodSet.has(value) ? 'checked' : ''}> <span>${label}</span></label>`).join('')}
            </div>
          </section>
          <section class="dh-luxgen-control-card">
            <div class="dh-luxgen-control-title"><span><b>风格方向</b><span>控制画面质感、光线和真实程度。</span></span><button type="button" data-nsa-control-ai="style" class="${styleBusy ? 'is-generating is-busy' : ''}" ${styleBusy ? 'disabled aria-busy="true"' : ''}>${styleBusy ? escapeHtml(pending.style) : 'AI 帮写'}</button></div>
            <textarea class="dh-input" rows="4" data-nsa-control-style-notes placeholder="写清本次任务的画面风格、光线、真实程度和禁止偏离方向。">${escapeHtml(ctrl.style.notes)}</textarea>
          </section>
          <section class="dh-luxgen-control-card">
            <div class="dh-luxgen-control-title"><span><b>禁止项</b><span>明确不能出现的画面、人物、商品或风格错误。</span></span><button type="button" data-nsa-control-ai="negative" class="${negativeBusy ? 'is-generating is-busy' : ''}" ${negativeBusy ? 'disabled aria-busy="true"' : ''}>${negativeBusy ? escapeHtml(pending.negative) : 'AI 帮写'}</button></div>
            <textarea class="dh-input" rows="4" data-nsa-control-negative placeholder="写清本次任务明确不能出现的画面、人物、商品、载体或风格错误。">${escapeHtml(ctrl.negative.text)}</textarea>
          </section>
        </div>
      </details>`;
    host.querySelectorAll('[data-nsa-control-ai]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        aiWriteControl(button.dataset.nsaControlAi || '', button);
      }, true);
    });
  }

  function renderAssets() {
    const productHost = within('#dhNsaAdProductAsset');
    const productClear = within('#dhNsaAdProductClear');
    const product = state.productAsset || null;
    if (productHost) {
      const url = previewUrl(product);
      const productContract = state.context?.product_contract || product?.product_contract || null;
      const productVerified = productContract?.status === 'verified' && productContract?.reference_qa?.pass === true;
      const productVerification = verificationView(productContract, 'reference_qa', '产品');
      productHost.innerHTML = url
        ? `<button type="button" class="dh-luxgen-product-card ${product.uploading ? 'uploading' : ''}" data-nsa-product-preview title="点击预览主体主图">
            <img src="${escapeHtml(url)}" alt="${escapeHtml(product.name || '商品/主体图')}">
            <b>商品/主体图</b><span>${escapeHtml(product.uploading ? `${product.name || '商品/主体图'} · 上传中` : (product.name || '已上传商品/主体图'))}</span>
          </button><div class="dh-nsa-verification-row"><span class="dh-nsa-verification-badge is-${escapeHtml(productVerification.tone)}">${escapeHtml(productVerification.label)}</span>${!productVerified && state.taskId ? '<button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-nsa-product-verify>验证产品</button>' : ''}</div>${verificationDetailsHtml(productVerification)}`
        : '<div class="dh-luxgen-product-empty">未上传商品/主体图</div>';
    }
    if (productClear) {
      const hasProduct = !!(product && (previewUrl(product) || product.name || product.uploading));
      productClear.hidden = !hasProduct;
      productClear.disabled = !hasProduct || !!product?.uploading || !!state.busy;
    }
    const assetHost = within('#dhNsaAdAssets');
    if (assetHost) {
      const assets = state.referenceAssets || [];
      const hasAny = assets.some(x => previewUrl(x) || x.name || x.uploading);
      if (!hasAny) {
        assetHost.innerHTML = '<div class="dh-luxgen-asset ghost">开场</div><div class="dh-luxgen-asset ghost">近景</div><div class="dh-luxgen-asset ghost">远景</div><div class="dh-luxgen-asset ghost">+</div>';
      } else {
        const slotCount = Math.min(8, Math.max(4, assets.length));
        assetHost.innerHTML = Array.from({ length: slotCount }, (_, i) => {
          const asset = assets[i] || null;
          const url = previewUrl(asset);
          return asset && url
            ? `<button type="button" class="dh-luxgen-asset ${asset.uploading ? 'uploading' : ''}" data-nsa-asset-preview="${i}" title="点击预览第 ${i + 1} 镜画面">
                <img src="${escapeHtml(url)}" alt="${escapeHtml(asset.name || `分镜画面 ${i + 1}`)}"><b>${i + 1}</b>${asset.uploading ? '<span>上传中</span>' : ''}
              </button>`
            : `<div class="dh-luxgen-asset ghost">${i + 1}</div>`;
        }).join('');
      }
    }
  }

  async function openActorLibrary() {
    if (window.NewStoryAdActorLibrary?.open) {
      return window.NewStoryAdActorLibrary.open({
        api,
        escapeHtml,
        withAuthQuery,
        actorUrls,
        actorReferenceLabel,
        personGenderValue,
        toast,
        onSelect: (asset) => {
          markSourceDirty('person');
          state.actorAsset = null;
          state.personAsset = actorMaterialToPersonAsset(asset);
          applyPersonAssetConstraints(state.personAsset);
          renderAll();
          scheduleAutoSave('actor_select', { immediate: true });
          toast(`已选择角色素材「${asset.name || '演员'}」，人物约束正在自动保存`, 'success');
        },
      });
    }
    let items = [];
    let activeGenderFilter = 'all';
    const old = document.getElementById('__dh_nsa_actor_library');
    if (old) old.remove();
    const mask = document.createElement('div');
    mask.id = '__dh_nsa_actor_library';
    mask.style.cssText = 'position:fixed;inset:0;z-index:19000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:24px';
    mask.innerHTML = `<div style="width:min(960px,96vw);max-height:86vh;overflow:hidden;background:#111318;border:1px solid rgba(255,255,255,.14);border-radius:14px;color:#fff;box-shadow:0 18px 60px rgba(0,0,0,.45);display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1)">
        <div><b>选择真人演员/演员库</b><div style="font-size:12px;color:rgba(255,255,255,.62);margin-top:3px">选择授权真人或已入库人物参考；后续剧本、分镜和关键帧会使用同一个人物参考。</div></div>
        <button type="button" data-nsa-actor-close style="border:0;background:transparent;color:#fff;font-size:20px;cursor:pointer">×</button>
      </div>
      <div data-nsa-actor-tabs style="display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.08)">
        <button type="button" data-nsa-actor-filter="all" style="border:1px solid rgba(89,213,255,.55);background:linear-gradient(135deg,#39c7f3,#78e277);color:#06131a;border-radius:999px;padding:7px 16px;font-weight:800;cursor:pointer">全部</button>
        <button type="button" data-nsa-actor-filter="female" style="border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;border-radius:999px;padding:7px 16px;font-weight:800;cursor:pointer">女</button>
        <button type="button" data-nsa-actor-filter="male" style="border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;border-radius:999px;padding:7px 16px;font-weight:800;cursor:pointer">男</button>
      </div>
      <div data-nsa-actor-body style="padding:14px;overflow:auto;display:flex;flex-direction:column;gap:12px">
        <div style="padding:28px;text-align:center;color:rgba(255,255,255,.72)">正在加载演员库...</div>
      </div>
    </div>`;
    document.body.appendChild(mask);
    const close = () => mask.remove();
    const bodyEl = mask.querySelector('[data-nsa-actor-body]');
    const tabEl = mask.querySelector('[data-nsa-actor-tabs]');
    const actorGender = asset => personGenderValue(asset.gender || asset.detected_gender || asset.metadata?.gender || asset.metadata?.detected_gender || '');
    const updateTabs = () => {
      tabEl?.querySelectorAll('[data-nsa-actor-filter]').forEach(btn => {
        const active = btn.dataset.nsaActorFilter === activeGenderFilter;
        btn.style.border = active ? '1px solid rgba(89,213,255,.55)' : '1px solid rgba(255,255,255,.14)';
        btn.style.background = active ? 'linear-gradient(135deg,#39c7f3,#78e277)' : 'rgba(255,255,255,.06)';
        btn.style.color = active ? '#06131a' : '#fff';
      });
    };
    const renderActorRows = () => {
      updateTabs();
      if (!bodyEl) return;
      const filtered = activeGenderFilter === 'all' ? items : items.filter(asset => actorGender(asset) === activeGenderFilter);
      if (!filtered.length) {
        bodyEl.innerHTML = `<div style="padding:30px;text-align:center;color:rgba(255,255,255,.72)">${activeGenderFilter === 'all' ? '演员库还没有可选人物。真人演员请先上传真人参考；AI 拟真演员可先生成演员包后入库。' : '当前分类没有可选演员。'}</div>`;
        return;
      }
      bodyEl.innerHTML = filtered.map(asset => {
        const urls = actorUrls(asset).slice(0, 1);
        const refLabel = actorReferenceLabel(asset);
        const genderLabel = actorGender(asset) === 'female' ? '女' : (actorGender(asset) === 'male' ? '男' : '');
        const desc = String(asset.description || asset.metadata?.description || '可作为剧情广告人物一致性参考')
          .replace(/\s+/g, ' ')
          .replace(/CONSISTENT REAL CAMPAIGN CHARACTER ASSET:?/ig, '一致性演员参考')
          .replace(/Preserve face identity[\s\S]*$/i, '保持人物身份一致')
          .slice(0, 120);
        const imageStrip = urls.length
          ? urls.map((url, index) => `<span style="width:104px;height:140px;border-radius:8px;overflow:hidden;background:#0c1018;border:1px solid rgba(255,255,255,.10);display:flex;align-items:center;justify-content:center;flex-shrink:0"><img src="${escapeHtml(assetThumbUrl(url, 320))}" alt="视图${index + 1}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:contain;background:#05070b"></span>`).join('')
          : '<span style="width:104px;height:140px;border-radius:8px;background:#1b2230;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:rgba(255,255,255,.7)">无预览</span>';
        return `<button type="button" data-nsa-actor-material="${escapeHtml(asset.id || asset.actor_asset_id || '')}" style="width:100%;display:grid;grid-template-columns:minmax(220px,456px) minmax(0,1fr);gap:14px;text-align:left;align-items:center;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#fff;border-radius:12px;padding:12px;min-height:168px;cursor:pointer">
          <span style="display:flex;gap:8px;overflow:hidden">${imageStrip}</span>
          <span style="min-width:0;display:block">
            <b style="display:block;font-size:16px;line-height:1.25;margin-bottom:8px">${escapeHtml(asset.name || '角色素材')}</b>
            <small style="display:block;color:rgba(255,255,255,.72);line-height:1.55;margin-bottom:8px">${escapeHtml([refLabel, genderLabel, `${actorUrls(asset).length || 1} 张参考图`].filter(Boolean).join(' · '))}</small>
            <small style="display:block;color:rgba(255,255,255,.58);line-height:1.5;max-height:44px;overflow:hidden">${escapeHtml(desc || '可作为剧情广告人物一致性参考')}</small>
          </span>
        </button>`;
      }).join('');
    };
    mask.addEventListener('click', e => {
      if (e.target === mask || e.target.closest('[data-nsa-actor-close]')) return close();
      const filterBtn = e.target.closest('[data-nsa-actor-filter]');
      if (filterBtn) {
        activeGenderFilter = filterBtn.dataset.nsaActorFilter || 'all';
        renderActorRows();
        return;
      }
      const btn = e.target.closest('[data-nsa-actor-material]');
      if (!btn) return;
      const asset = items.find(x => String(x.id || x.actor_asset_id || '') === String(btn.dataset.nsaActorMaterial || ''));
      if (!asset) return;
      markSourceDirty('person');
      state.actorAsset = null;
      state.personAsset = actorMaterialToPersonAsset(asset);
      applyPersonAssetConstraints(state.personAsset);
      renderAll();
      close();
      scheduleAutoSave('actor_select', { immediate: true });
      toast(`已选择角色素材「${asset.name || '演员'}」，人物约束正在自动保存`, 'success');
    });
    try {
      const r = await api('/api/assets?type=character&limit=120&fast=1');
      items = Array.isArray(r?.data) ? r.data : [];
    } catch (err) {
      if (bodyEl) bodyEl.innerHTML = `<div style="padding:28px;text-align:center;color:#ffb4b4">角色素材库加载失败：${escapeHtml(err.message || err)}</div>`;
      toast('角色素材库加载失败：' + (err.message || err), 'error');
      return;
    }
    renderActorRows();
  }

  function renderPerson() {
    const host = within('#dhNsaAdPersonCurrent');
    if (!host) return;
    if (isNoHumanMode()) {
      host.innerHTML = '<span class="dh-luxgen-person-badge">无人物</span><div class="dh-luxgen-person-copy"><b>纯产品 / 纯场景广告</b><small>人物素材、演员、人数和人物描述均不会进入剧本、分镜或视频生成。</small></div>';
      return;
    }
    if (state.personGenerationProgress?.active) {
      host.innerHTML = `<div class="dh-luxgen-character-sheet">
        <div class="dh-luxgen-person-thumb">生成中</div>
        <b>拟真一致性演员</b>
        <small>正在根据广告需求、人物设定和当前剧本上下文生成演员参考。</small>
        ${personGenerationProgressHtml()}
      </div>`;
      return;
    }
    const asset = state.personAsset || state.actorAsset || null;
    if (!asset) {
      host.innerHTML = '<span class="dh-luxgen-person-badge">未选择</span><div class="dh-luxgen-person-copy"><b>可不选人物</b><small>可先用 AI 补齐人物设定；真人演员请选择演员库或上传真人参考。</small></div>';
      return;
    }
    const viewEntries = actorViewEntries(asset);
    const urls = viewEntries.map(view => view.url);
    const src = previewUrl(asset) || urls[0] || '';
    const castMembers = actorCastMembers(asset).filter(member => member.image_url || member.name);
    const isReal = actorIsRealPerson(asset);
    const isSynthetic = actorIsSynthetic(asset);
    const isAi = actorReferenceKind(asset) === 'ai_generated';
    const actorId = asset.actor_asset_id || asset.asset_library_id || asset.material_id || '';
    const personContract = asset.person_contract || state.context?.person_contract || null;
    const verificationStatus = personContract?.status || (asset.production_usable_actor === true ? 'legacy_unverified' : 'unverified');
    const verified = verificationStatus === 'verified' && personContract?.cross_view_qa?.pass === true;
    const personVerification = verificationView(personContract, 'cross_view_qa', '人物');
    const meta = [
      actorReferenceLabel(asset),
      actorId ? '已绑定人物参考' : '',
      castMembers.length > 1 ? `${castMembers.length} 个独立人物` : '',
      urls.length ? `${urls.length} 张演员参考` : '',
      asset.gender || asset.detected_gender ? `性别：${personGenderValue(asset.gender || asset.detected_gender) === 'female' ? '女' : '男'}` : '',
    ].filter(Boolean).join(' · ');
    const defaultName = castMembers.length > 1
      ? (asset.cast_mode === 'group' ? '拟真多人演员组' : '拟真双人演员组')
      : (isReal ? '真人照片参考' : (isSynthetic ? '拟真一致性演员' : 'AI 拟真演员参考'));
    const defaultDesc = isReal
      ? '真人照片参考会作为广告人物身份、气质和后续镜头一致性锁定。'
      : isSynthetic
        ? '这是可复用的拟真一致性演员，会作为后续剧本、分镜和关键帧的人物锁。'
        : '这是 AI 拟真演员参考；需要真人广告请上传真人照片或选择授权真人演员。';
    const castGrid = castMembers.length > 1
      ? `<div class="dh-lux-actor-cast-grid">${castMembers.map((member, i) => `<span>
          ${member.image_url ? `<img src="${escapeHtml(assetThumbUrl(member.image_url, 320))}" alt="${escapeHtml(member.name || `角色${i + 1}`)}" loading="lazy" decoding="async">` : '<i class="dh-lux-actor-cast-placeholder">未生成</i>'}
          <b>${escapeHtml(member.name || member.cast_role || `角色${i + 1}`)}</b>
        </span>`).join('')}</div>`
      : '';
    const viewStrip = !castGrid && viewEntries.length > 1
      ? `<div class="dh-lux-actor-views">${viewEntries.slice(0, 6).map((view, i) => `<button type="button" data-nsa-person-preview="${i}" title="${escapeHtml(view.label)}"><img src="${escapeHtml(assetThumbUrl(view.url, 360))}" alt="${escapeHtml(view.label)}" loading="lazy" decoding="async"><span>${escapeHtml(view.label)}</span></button>`).join('')}</div>`
      : '';
    const warning = isAi && !isReal && !isSynthetic
      ? '<div style="margin-top:8px;padding:8px 10px;border:1px solid rgba(255,184,76,.5);border-radius:8px;color:#b7791f;background:rgba(255,184,76,.08);font-size:12px;line-height:1.5">非真人素材：只能作为 AI 拟真参考；真人广告请上传真人照片或选择授权真人演员。</div>'
      : '';
    host.innerHTML = `<div class="dh-luxgen-character-sheet ${asset.failed ? 'is-failed' : ''}">
      ${castGrid || (src ? `<button type="button" class="dh-lux-actor-main-preview" data-nsa-person-preview="0" title="${escapeHtml(viewEntries[0]?.label || '演员参考图')}"><img src="${escapeHtml(assetThumbUrl(src, 480))}" alt="${escapeHtml(asset.name || defaultName)}" loading="lazy" decoding="async"></button>` : '<div class="dh-luxgen-person-thumb">已选择</div>')}
      <b>${escapeHtml(asset.name || defaultName)}</b>
      <small>${escapeHtml(asset.uploading ? '真人照片上传中。' : (meta || asset.description || defaultDesc))}</small>
      ${viewStrip}
      <div class="dh-nsa-verification-row">
        <span class="dh-nsa-verification-badge is-${escapeHtml(personVerification.tone)}">${escapeHtml(personVerification.label)}</span>
        ${!verified && state.taskId ? '<button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-nsa-person-verify>重新验证</button>' : ''}
      </div>
      ${verificationDetailsHtml(personVerification)}
      ${warning}
    </div>`;
  }

  function renderAudio() {
    const voiceSlider = within('#dhNsaAdVoiceVolume');
    const bgmSlider = within('#dhNsaAdBgmVolume');
    const voiceLabel = within('#dhNsaAdVoiceVolumeLabel');
    const bgmLabel = within('#dhNsaAdBgmVolumeLabel');
    if (voiceSlider && document.activeElement !== voiceSlider) voiceSlider.value = String(Math.round(state.voiceVolume * 100));
    if (bgmSlider && document.activeElement !== bgmSlider) bgmSlider.value = String(Math.round(state.bgmVolume * 100));
    if (voiceLabel) voiceLabel.textContent = `${Math.round(state.voiceVolume * 100)}%`;
    if (bgmLabel) bgmLabel.textContent = `${Math.round(state.bgmVolume * 100)}%`;

    const voiceCurrent = within('#dhNsaAdVoiceCurrent');
    if (voiceCurrent) {
      const selectedVoice = (state.voiceList || []).find(v => String(v.id || '') === String(state.voiceId || ''));
      const name = state.voiceName || selectedVoice?.name || (state.voiceId ? state.voiceId : '无配音');
      const provider = selectedVoice?.provider || selectedVoice?.providerId || (state.voiceId ? '已选择，可用于旁白合成' : '选填 · 将直接生成无旁白视频');
      voiceCurrent.innerHTML = `<div class="dh-voice-opt-icon">TV</div>
        <div class="dh-voice-opt-body">
          <div class="dh-voice-opt-name">${escapeHtml(name)}</div>
          <div class="dh-voice-opt-sub">${escapeHtml(provider)}</div>
        </div>`;
    }

    const status = within('#dhNsaAdBgmStatus');
    const license = within('#dhNsaAdBgmLicense');
    if (status) status.textContent = state.bgmAsset ? (state.bgmAsset.name || '背景音乐已配置') : '未配置，可先合成无配乐广告片';
    if (license) {
      const source = state.bgmAsset?.source || (state.bgmAsset ? '用户上传' : '');
      const licenseText = state.bgmAsset?.license || state.bgmAsset?.license_name || '';
      license.textContent = state.bgmAsset
        ? [source, licenseText || '请确认已获得商用授权'].filter(Boolean).join(' · ')
        : '可从公开曲库选择授权纯音乐，也可上传自有音乐；不配置时将生成无配乐成片。';
    }
    const preview = within('#dhNsaAdBgmPreview');
    if (preview) {
      const url = previewUrl(state.bgmAsset);
      preview.innerHTML = url ? `<audio controls preload="none" src="${escapeHtml(withAuthQuery(url))}"></audio>` : '';
    }

    const subtitleSelect = within('#dhNsaAdSubtitle');
    const subtitleToggle = within('#dhNsaAdSubtitleToggle');
    if (subtitleSelect && document.activeElement !== subtitleSelect) subtitleSelect.value = state.subtitleEnabled ? 'on' : 'off';
    if (subtitleToggle && document.activeElement !== subtitleToggle) subtitleToggle.checked = !!state.subtitleEnabled;
  }

  function normalizeBundle(response = {}) {
    if (window.NewStoryAdStateSync?.normalizeBundle) {
      return window.NewStoryAdStateSync.normalizeBundle(response, {
        state,
        rememberTaskId,
      });
    }
    const bundle = response.bundle || response;
    const task = response.task || bundle.task || {};
    const outputs = bundle.outputs || {};
    state.context = outputs.context || response.context || state.context;
    state.sceneConfig = outputs.scene_config || response.scene_config || state.sceneConfig;
    state.blueprint = outputs.blueprint || response.blueprint || state.blueprint;
    state.shots = outputs.storyboard_table || response.shots || state.shots || [];
    state.contracts = outputs.keyframe_contracts || response.keyframe_contracts || state.contracts || [];
    state.keyframes = outputs.keyframes || response.keyframes || state.keyframes || [];
    state.review = outputs.quality_review || response.review || state.review;
    state.ttsAudio = outputs.tts_audio || response.tts_audio || state.ttsAudio;
    state.videoClips = outputs.video_clips || response.video_clips || state.videoClips || [];
    state.videoShotStatuses = response.video_shot_statuses || bundle.video_shot_statuses || state.videoShotStatuses || [];
    state.finalVideo = outputs.final_video || response.final_video || state.finalVideo;
    if (window.NewStoryAdSceneAssets?.hydrate) {
      window.NewStoryAdSceneAssets.hydrate(state, {
        request: state.context || {},
        outputs,
        response,
      });
    } else {
      state.sceneAssets = outputs.scene_assets || response.scene_assets || state.context?.scene_assets || state.sceneAssets || [];
    }
    state.taskId = response.task_id || response.task?.id || bundle.task?.id || state.taskId;
    const pendingKeyframeSubmission = state.stageProgress?.active === true
      && state.stageProgress?.stage === 'keyframes'
      && state.stageProgress?.submissionPending === true;
    const trackedGenerationId = String(state.stageProgress?.active ? state.stageProgress?.generationId || '' : '');
    const incomingActiveId = String(task.active_generation_id || '');
    const incomingGenerationId = String(task.generation_progress?.generation_id || '');
    const staleGenerationResponse = trackedGenerationId && (incomingActiveId
      ? incomingActiveId !== trackedGenerationId
      : (!incomingGenerationId || incomingGenerationId !== trackedGenerationId));
    if (!pendingKeyframeSubmission && !staleGenerationResponse) {
      state.activeGenerationId = task.active_generation_id || '';
      state.activeStage = task.active_stage || '';
      if (!trackedGenerationId || !incomingGenerationId || trackedGenerationId === incomingGenerationId) {
        state.generationProgress = task.generation_progress || null;
      }
    }
    state.generationStartedAt = task.generation_started_at || task.generation_queued_at || task.generation_progress?.started_at || '';
    if (state.stageProgress?.active && state.activeGenerationId
      && (!state.stageProgress.generationId || state.stageProgress.generationId === state.activeGenerationId)) {
      const startedAt = Date.parse(state.generationStartedAt);
      if (Number.isFinite(startedAt)) {
        state.stageProgress.generationId = state.activeGenerationId;
        state.stageProgress.startedAt = startedAt;
      }
    }
    if (!state.activeGenerationId) state.cancelRequested = false;
    if (state.taskId) rememberTaskId(state.taskId);
  }

  function normalizeTaskOutputs(bundle = {}) {
    const raw = bundle.outputs || {};
    if (!Array.isArray(raw)) return raw && typeof raw === 'object' ? raw : {};
    return Object.fromEntries(raw.map(item => [item.kind, item.payload]));
  }

  function setFieldValue(selector, value) {
    const el = within(selector);
    if (!el || value === undefined || value === null) return;
    el.value = String(value);
  }

  function hydrateControlledProduction(request = {}) {
    const ctrl = request.controlled_production || request.controlledProduction || {};
    const environment = ctrl.environment || ctrl.environment_control || {};
    const product = ctrl.product || ctrl.product_control || {};
    const style = ctrl.style || ctrl.style_control || {};
    const negative = ctrl.negative || ctrl.negative_control || {};
    state.controlledProduction = normalizeControlledProduction({
      environment: {
        mode: environment.mode,
        custom: environment.custom,
      },
      product: {
        enabled: product.enabled === true,
        presence: product.presence,
        lockStrength: product.lockStrength || product.lock_strength,
        methods: product.methods,
      },
      style: {
        mode: style.mode,
        notes: style.notes,
      },
      negative: {
        text: negative.text,
      },
      uiExpanded: ctrl.uiExpanded === true || ctrl.enabled === true || ctrl.mode === 'controlled',
    });
  }

  function assetThumbUrl(url = '', width = 420) {
    const raw = withAuthQuery(url);
    if (!/^\/api\/new-story-ad\/assets\//i.test(raw)) return raw;
    const size = Math.max(160, Math.min(960, Number(width) || 420));
    return `${raw}${raw.includes('?') ? '&' : '?'}thumb=${size}`;
  }

  function isFallbackPersonAsset(asset = {}) {
    if (!asset || typeof asset !== 'object') return false;
    const metadata = asset.metadata || {};
    const source = [
      asset.generated_by,
      metadata.generated_by,
      asset.source,
      metadata.source,
      asset.status,
      metadata.status,
    ].filter(Boolean).join(' ').toLowerCase();
    return asset.fallback_used === true
      || metadata.fallback_used === true
      || Boolean(asset.fallback_reason || metadata.fallback_reason)
      || /person_sheet\.fallback|fallback_actor_library/.test(source);
  }

  function hydratePersonSpec(request = {}) {
    const spec = request.person_spec || request.personSpec || request.person_context?.person_spec || {};
    Object.entries(spec || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) writeAllFields(`[data-nsa-person-spec="${key}"]`, String(value));
    });
    const personAsset = request.person_asset || request.personAsset || request.person_context?.person_asset || null;
    if (personAsset && typeof personAsset === 'object' && !isFallbackPersonAsset(personAsset)) {
      state.personAsset = {
        ...personAsset,
        previewUrl: personAsset.previewUrl || personAsset.image_url || personAsset.url || '',
      };
      state.actorAsset = state.personAsset;
      applyPersonAssetConstraints(state.personAsset);
    } else {
      state.castProfiles = Array.isArray(request.cast_profiles || request.castProfiles)
        ? (request.cast_profiles || request.castProfiles)
        : [];
    }
  }

  function hydrateAssets(request = {}) {
    const assets = Array.isArray(request.assets) ? request.assets : (Array.isArray(request.references) ? request.references : []);
    const byType = (type) => assets.find(asset => String(asset?.type || '').toLowerCase() === type);
    const product = request.product_asset || byType('product');
    if (product && typeof product === 'object') {
      state.productAsset = {
        ...product,
        previewUrl: product.previewUrl || product.image_url || product.url || product.file_url || '',
      };
    }
    const person = request.person_asset || byType('person_reference');
    if (person && typeof person === 'object' && !state.personAsset && !isFallbackPersonAsset(person)) {
      state.personAsset = {
        ...person,
        previewUrl: person.previewUrl || person.image_url || person.url || person.file_url || '',
      };
      state.actorAsset = state.personAsset;
    }
    state.referenceAssets = assets
      .filter(asset => asset && String(asset.type || '').toLowerCase() === 'storyboard_reference')
      .map((asset, index) => ({
        ...asset,
        id: asset.id || `restored_reference_${index + 1}`,
        previewUrl: asset.previewUrl || asset.image_url || asset.url || asset.file_url || '',
      }));
    if (request.bgm_asset) state.bgmAsset = request.bgm_asset;
  }

  function hydrateTaskBundle(bundle = {}) {
    if (window.NewStoryAdStateSync?.hydrateTaskBundle) {
      return window.NewStoryAdStateSync.hydrateTaskBundle(bundle, {
        state,
        within,
        root,
        rememberTaskId,
        hydrateControlledProduction,
        applyPersonAssetConstraints,
      });
    }
    const task = bundle.task || {};
    const outputs = normalizeTaskOutputs(bundle);
    const request = outputs.context || task.request || {};
    state.taskId = task.id || request.task_id || request.taskId || state.taskId;
    const pendingKeyframeSubmission = state.stageProgress?.active === true
      && state.stageProgress?.stage === 'keyframes'
      && state.stageProgress?.submissionPending === true;
    const trackedGenerationId = String(state.stageProgress?.active ? state.stageProgress?.generationId || '' : '');
    const incomingActiveId = String(task.active_generation_id || '');
    const incomingGenerationId = String(task.generation_progress?.generation_id || '');
    const staleGenerationResponse = trackedGenerationId && (incomingActiveId
      ? incomingActiveId !== trackedGenerationId
      : (!incomingGenerationId || incomingGenerationId !== trackedGenerationId));
    if (!pendingKeyframeSubmission && !staleGenerationResponse) {
      state.activeGenerationId = task.active_generation_id || '';
      state.activeStage = task.active_stage || '';
      if (!trackedGenerationId || !incomingGenerationId || trackedGenerationId === incomingGenerationId) {
        state.generationProgress = task.generation_progress || null;
      }
    }
    state.generationStartedAt = task.generation_started_at || task.generation_queued_at || task.generation_progress?.started_at || '';
    if (!state.activeGenerationId) state.cancelRequested = false;
    state.context = outputs.context || request || state.context;
    state.sceneConfig = outputs.scene_config || state.sceneConfig;
    state.blueprint = outputs.blueprint || state.blueprint;
    state.shots = outputs.storyboard_table || state.shots || [];
    state.contracts = outputs.keyframe_contracts || state.contracts || [];
    state.keyframes = outputs.keyframes || state.keyframes || [];
    state.review = outputs.quality_review || state.review;
    state.ttsAudio = outputs.tts_audio || state.ttsAudio;
    state.videoClips = outputs.video_clips || state.videoClips || [];
    state.finalVideo = outputs.final_video || state.finalVideo;
    if (window.NewStoryAdSceneAssets?.hydrate) {
      window.NewStoryAdSceneAssets.hydrate(state, { request, outputs, response: bundle });
    } else {
      state.sceneAssets = outputs.scene_assets || request.scene_assets || request.sceneAssets || state.sceneAssets || [];
    }

    setFieldValue('#dhNsaAdText', request.brief || request.content || task.brief || '');
    setFieldValue('#dhNsaAdDuration', request.duration_sec || request.duration || 30);
    state.outputRatio = request.output_ratio || request.outputRatio || state.outputRatio || '9:16';
    state.outputSize = request.output_size || request.outputSize || state.outputSize || 'standard';
    state.videoResolution = request.video_resolution || request.videoResolution || state.videoResolution || '720p';
    setFieldValue('#dhNsaAdProductionMode', request.production_mode || request.productionMode || 'auto');
    state.voiceId = request.voice_id || request.voiceId || state.voiceId || '';
    state.voiceName = request.voice_name || request.voiceName || state.voiceName || '';
    state.subtitleEnabled = request.subtitle !== false;
    state.subtitleStyle = request.subtitle_style || request.subtitleStyle || state.subtitleStyle || 'popup';
    const subtitleConfig = request.subtitle_config || request.subtitleConfig || {};
    state.subtitleEnabled = subtitleConfig.show === false ? false : state.subtitleEnabled;
    state.subtitleStyle = subtitleConfig.style || state.subtitleStyle;
    state.subtitleOptions = {
      ...state.subtitleOptions,
      smartEmphasis: subtitleConfig.smartEmphasis !== false,
      fontName: subtitleConfig.fontName || state.subtitleOptions.fontName,
      fontSize: Number(subtitleConfig.fontSize || state.subtitleOptions.fontSize) || 72,
      color: subtitleConfig.color || '',
      outlineColor: subtitleConfig.outlineColor || '',
    };
    state.voiceVolume = Number(request.voice_volume || request.voiceVolume || state.voiceVolume || 1) || 1;
    state.bgmVolume = Number(request.bgm_volume || request.bgmVolume || state.bgmVolume || 0.16) || 0.16;
    state.bgmProfile = request.bgm_profile || request.bgmProfile || state.bgmProfile || 'auto';
    setFieldValue('#dhNsaAdVoiceId', state.voiceId);
    hydrateControlledProduction(request);
    hydratePersonSpec(request);
    hydrateAssets(request);
    if (state.taskId) rememberTaskId(state.taskId);
  }

  async function fallbackLatestTaskId() {
    if (routeTaskId() || storedTaskId() || routeStep() <= 1) return '';
    try {
      const r = await api('/api/new-story-ad/tasks?limit=1');
      const task = Array.isArray(r.tasks) ? r.tasks[0] : null;
      return normalizeText(task?.taskId || task?.id || '', 100);
    } catch {
      return '';
    }
  }

  function personSpecSignature(value = {}) {
    const spec = value && typeof value === 'object' ? value : {};
    const pairs = Object.keys(spec)
      .sort()
      .map(key => [key, normalizeText(spec[key], 800).toLowerCase()])
      .filter(([, val]) => val);
    return pairs.length ? JSON.stringify(pairs) : '';
  }

  function applyRecoveredPersonAsset(asset = {}) {
    if (!asset || typeof asset !== 'object' || isFallbackPersonAsset(asset)) return false;
    state.personAsset = {
      ...asset,
      previewUrl: asset.previewUrl || asset.image_url || asset.url || asset.file_url || '',
    };
    state.actorAsset = state.personAsset;
    applyPersonAssetConstraints(state.personAsset);
    return true;
  }

  async function recoverPersonAssetFromLibrary(bundle = {}) {
    if (state.personAsset || state.actorAsset) return false;
    const outputs = normalizeTaskOutputs(bundle);
    const sources = [
      bundle.context,
      bundle.task?.request,
      outputs.context,
    ].filter(Boolean);
    const ids = [];
    const addId = value => {
      const id = normalizeText(value || '', 160);
      if (id && !ids.includes(id)) ids.push(id);
    };
    sources.forEach(src => {
      const asset = src.person_asset || src.personAsset || src.person_context?.person_asset || {};
      if (asset && typeof asset === 'object' && !isFallbackPersonAsset(asset)) {
        addId(asset.actor_asset_id || asset.asset_library_id || asset.material_id || asset.id);
        if (asset.image_url || asset.url || asset.file_url) {
          applyRecoveredPersonAsset(asset);
          return;
        }
      }
      addId(src.actor_asset_id || src.actorAssetId || src.person_asset_id || src.personAssetId);
    });
    if (state.personAsset) return true;
    for (const id of ids) {
      try {
        const r = await api(`/api/assets/${encodeURIComponent(id)}`);
        const asset = r?.data || null;
        if (applyRecoveredPersonAsset(asset)) return true;
      } catch {}
    }
    const taskSpec = sources
      .map(src => personSpecSignature(src.person_spec || src.personSpec || src.person_context?.person_spec || {}))
      .find(Boolean);
    if (taskSpec) {
      try {
        const r = await api('/api/assets?type=character&limit=300&fast=1');
        const items = Array.isArray(r?.data) ? r.data : [];
        const matched = items.find(asset => {
          const metadata = asset?.metadata || {};
          return !isFallbackPersonAsset(asset) && personSpecSignature(metadata.person_spec || asset.person_spec || {}) === taskSpec;
        });
        if (applyRecoveredPersonAsset(matched)) return true;
      } catch {}
    }
    return false;
  }

  async function restoreCurrentTask() {
    const id = routeTaskId() || storedTaskId() || await fallbackLatestTaskId();
    if (!id || state.taskId) return false;
    state.restoringTask = true;
    state.restoreError = '';
    renderAll();
    try {
      const r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}`);
      const bundle = r.bundle || r;
      if (!bundle?.task) throw new Error('任务不存在');
      hydrateTaskBundle(bundle);
      await recoverPersonAssetFromLibrary(bundle);
      const desiredStep = window.NewStoryAdTaskStore?.resumeStep
        ? window.NewStoryAdTaskStore.resumeStep(bundle.task || {}, bundle.outputs || {}, state.storyboardStatus)
        : routeStep();
      showStep(desiredStep, { remember: false });
      rememberRouteStep(desiredStep);
      renderAll();
      resumeActiveGeneration();
      return true;
    } catch (err) {
      rememberTaskId('');
      state.restoreError = err.message || '无法读取任务数据';
      toast('当前任务恢复失败：' + state.restoreError, 'error');
      return false;
    } finally {
      state.restoringTask = false;
      renderAll();
    }
  }

  function resumeActiveGeneration() {
    if (!state.activeGenerationId || !state.taskId || !window.NewStoryAdGenerationFlow?.waitForStage) return false;
    const persistedStage = state.activeStage || 'generation';
    const uiStage = persistedStage === 'scene_config' ? 'scene' : persistedStage;
    const label = window.NewStoryAdGenerationFlow.STAGE_LABELS?.[uiStage] || '正在生成中...';
    startStageProgress(uiStage, label, { resume: true });
    setBusy(true, label);
    window.NewStoryAdGenerationFlow.waitForStage(state.taskId, persistedStage, generationFlowContext())
      .then(bundle => {
        normalizeBundle(bundle);
        if (persistedStage === 'storyboard'
          && window.NewStoryAdGenerationFlow.storyboardIsReady(bundle, state)) showStep(4);
        renderAll();
      })
      .catch(error => {
        if (error.data) normalizeBundle(error.data);
        renderAll();
        toast(error.message || '生成任务已结束', error.code === 'USER_CANCELLED' ? 'info' : 'error');
      })
      .finally(() => setBusy(false));
    return true;
  }

  function setButtonLock(selector, locked, title = '', options = {}) {
    if (window.NewStoryAdButtonState?.setButtonLock) {
      return window.NewStoryAdButtonState.setButtonLock(selector, locked, title, options, { state, within });
    }
    const btn = within(selector);
    if (!btn) return;
    const busyLocked = !!state.busy && !options.allowBusy;
    btn.disabled = busyLocked || !!locked;
    if (btn.disabled) btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
    btn.classList.toggle('is-disabled', btn.disabled);
    if (title && locked) btn.title = title;
    else btn.removeAttribute('title');
  }

  function setButtonBusy(button, busy, label = '') {
    if (window.NewStoryAdButtonState?.setButtonBusy) {
      return window.NewStoryAdButtonState.setButtonBusy(button, busy, label, { updateLocks });
    }
    if (!button) return;
    if (busy) {
      if (!button.dataset.nsaOriginalText) button.dataset.nsaOriginalText = button.textContent.trim();
      if (label) button.textContent = label;
      button.disabled = true;
      button.classList.add('is-generating', 'is-busy');
      button.setAttribute('aria-busy', 'true');
    } else {
      if (button.dataset.nsaOriginalText) {
        button.textContent = button.dataset.nsaOriginalText;
        delete button.dataset.nsaOriginalText;
      }
      button.disabled = false;
      button.classList.remove('is-generating', 'is-busy');
      button.removeAttribute('aria-busy');
      updateLocks();
    }
  }

  function updateLocks() {
    if (window.NewStoryAdButtonState?.updateLocks) {
      return window.NewStoryAdButtonState.updateLocks({ state, within, getPersonSpec: personSpec });
    }
    const brief = (within('#dhNsaAdText')?.value || '').trim();
    const hasBrief = brief.length >= 8;
    const hasScene = !!state.sceneConfig;
    const hasBlueprint = !!state.blueprint;
    const hasShots = Array.isArray(state.shots) && state.shots.length > 0;
    const compose = composeReadiness();
    const hasActorInput = !!personSpec('appearanceText');

    setButtonLock('#dhNsaAdGenerate', !hasBrief, '请先填写至少 8 个字的广告需求');
    const generateBtn = within('#dhNsaAdGenerate');
    if (generateBtn) generateBtn.classList.toggle('is-next', hasBrief && !state.busy);
    setButtonLock('#dhNsaAdStoryboard', !hasBrief && !state.taskId, '请先填写至少 8 个字的广告需求');
    setButtonLock('#dhNsaAdPreviewFrames', !hasBlueprint, '请先生成剧本');
    setButtonLock('#dhNsaAdGenerateFinalFrames', !hasShots, '请先生成分镜');
    setButtonLock('#dhNsaAdGoCompose', !compose.ready, compose.message || '请先生成并审核全部分镜');
    setButtonLock('#dhNsaAdConfirmGenerate', !compose.ready, compose.message || '请先生成并审核全部分镜');
    setButtonLock('#dhNsaAdGeneratePersonSheet', !hasBrief && !hasActorInput, '请先填写广告需求或人物设定', { allowBusy: true });
    setButtonLock('#dhNsaAdGenerateSceneSheet', !hasBrief, '请先填写至少 8 个字的广告需求', { allowBusy: true });
    setButtonLock('#dhNsaAdAddSceneSheet', !hasBrief, '请先填写至少 8 个字的广告需求', { allowBusy: true });
    setButtonLock('#dhNsaAdAiSceneSpec', !hasBrief, '请先填写至少 8 个字的广告需求', { allowBusy: true });

    [
      '#dhNsaAdWrite',
      '#dhNsaAdClean',
      '#dhNsaAdSample',
      '#dhNsaAdVoiceOpen',
      '#dhNsaAdBgmUpload',
      '#dhNsaAdSubtitleStyleBtn',
      '#dhNsaAdProductDrop',
      '#dhNsaAdUploadPersonRef',
      '#dhNsaAdPickActorAsset',
      '#dhNsaAdAiPersonSpec',
    ].forEach(sel => setButtonLock(sel, false));
  }

  function stageItemCount(stage = '') {
    if (stage === 'storyboard') return Math.max(1, blueprintBeats().length || state.shots.length || 1);
    if (stage === 'keyframes') return Math.max(1, state.shots.length || state.contracts.length || state.keyframes.length || 1);
    return 1;
  }

  function completedKeyframeCount() {
    if (window.NewStoryAdKeyframes?.completedCount) return window.NewStoryAdKeyframes.completedCount(state.keyframes);
    return (Array.isArray(state.keyframes) ? state.keyframes : []).filter(frame => frame && (frame.image_url || frame.imageUrl || frame.url)).length;
  }

  function keyframeStatus() {
    if (window.NewStoryAdKeyframes?.status) return window.NewStoryAdKeyframes.status(state.keyframes || [], state.shots || []);
    const total = Math.max((state.shots || []).length, (state.keyframes || []).length);
    const completed = (state.keyframes || []).filter(frame => frame && (frame.image_url || frame.imageUrl || frame.url)).length;
    return { total, completed, missing: Math.max(0, total - completed), failed: 0, missing_indexes: [] };
  }

  function isNoHumanMode() {
    return personSpec('castMode') === 'no_human';
  }

  function composeReadiness() {
    if (window.NewStoryAdStepNavigation?.composeReadiness) {
      return window.NewStoryAdStepNavigation.composeReadiness({ state });
    }
    const kf = keyframeStatus();
    const total = Math.max(Number(kf.total || 0), state.shots.length || 0);
    const passed = Number(kf.fresh_pass || 0);
    const ready = total > 0 && total === state.shots.length && passed === total && Number(kf.needs_regeneration || 0) === 0;
    return { ready, total, passed, message: ready ? '' : `当前版本仅通过 ${passed}/${total} 镜，请先修复未通过审核的镜头` };
  }

  function videoClipAt(index) {
    return (Array.isArray(state.videoClips) ? state.videoClips : []).find((clip, clipIndex) => {
      if (!clip) return false;
      if (Number.isInteger(Number(clip.shot_index))) return Number(clip.shot_index) === index;
      if (Number.isInteger(Number(clip.index))) return Number(clip.index) === index + 1;
      return clipIndex === index;
    }) || {};
  }

  function videoShotStatusAt(index) {
    return (Array.isArray(state.videoShotStatuses) ? state.videoShotStatuses : []).find((status, statusIndex) => {
      if (!status) return false;
      const rawIndex = Number(status.index || status.shot_index || status.shotIndex);
      return Number.isInteger(rawIndex) ? rawIndex === index + 1 : statusIndex === index;
    }) || {};
  }

  function videoShotFailureDetail(index) {
    const clip = videoClipAt(index);
    const status = videoShotStatusAt(index);
    const labels = [
      ...(Array.isArray(clip.qa?.failure_labels_zh) ? clip.qa.failure_labels_zh : []),
      ...(Array.isArray(clip.cross_shot_qa?.failure_labels_zh) ? clip.cross_shot_qa.failure_labels_zh : []),
      ...(Array.isArray(status.qa_failure_labels_zh) ? status.qa_failure_labels_zh : []),
      ...(Array.isArray(status.cross_shot_failure_labels_zh) ? status.cross_shot_failure_labels_zh : []),
    ];
    const problems = [
      ...(Array.isArray(clip.qa?.problems) ? clip.qa.problems : []),
      ...(Array.isArray(clip.cross_shot_qa?.problems) ? clip.cross_shot_qa.problems : []),
      ...(Array.isArray(status.qa_problems) ? status.qa_problems : []),
      ...(Array.isArray(status.cross_shot_qa_problems) ? status.cross_shot_qa_problems : []),
    ];
    const code = String(clip.error_code || status.error_code || '').toUpperCase();
    const friendlyCodes = {
      INPUT_PERSON_PRIVACY: '人物首帧被服务商隐私规则拦截，未生成视频',
      VIDEO_FRAME_QA_FAILED: '视频已生成，但画面审核未通过',
      CROSS_SHOT_CONTINUITY_FAILED: '视频已生成，但与上一镜的连续性审核未通过',
      PROVIDER_BILLING: '视频服务商账户或额度异常',
      USER_CANCELLED: '本次生成已取消',
    };
    const notSubmitted = !clip.video_url && !clip.videoUrl && !clip.file_path
      && status.provider_submission_state === 'not_submitted';
    const prefix = notSubmitted ? '未提交视频模型' : (friendlyCodes[code] || status.error || clip.error || '');
    const detail = [...new Set(labels.concat(problems).concat(prefix).filter(Boolean))];
    return {
      code,
      title: notSubmitted ? '未生成、未产生本镜视频' : (clip.video_url || clip.videoUrl || clip.file_path ? '已生成，但未通过审核' : '生成失败'),
      text: detail.join('；') || '当前镜头尚未获得可用视频，请查看状态后只修复本镜。',
      notSubmitted,
    };
  }

  function videoShotView(index) {
    const clip = videoClipAt(index);
    const status = videoShotStatusAt(index);
    const hasVideo = !!(clip.video_url || clip.videoUrl || clip.file_path);
    const lifecycle = String(status.lifecycle || '').toLowerCase();
    const qaFailed = clip.qa?.pass === false || clip.cross_shot_qa?.pass === false
      || !!clip.error_code || ['qa_failed', 'failed'].includes(lifecycle);
    const qaPassed = hasVideo && !qaFailed && clip.qa?.pass === true
      && clip.cross_shot_qa?.pass !== false;
    const running = ['queued', 'submitting', 'provider_submitted', 'provider_running', 'downloading', 'normalizing'].includes(lifecycle);
    const reviewing = hasVideo && !qaPassed && !qaFailed
      || ['generated', 'video_qa'].includes(lifecycle);
    if (qaPassed || lifecycle === 'qa_passed') return { key: 'passed', label: '视频审核通过', shortLabel: '已通过', tone: 'pass', hasVideo: true, clip, status };
    if (qaFailed) {
      const failure = videoShotFailureDetail(index);
      return { key: 'failed', label: hasVideo ? '视频已生成但审核未通过' : (failure.notSubmitted ? '未提交生成' : '视频生成失败'), shortLabel: failure.notSubmitted ? '未提交' : '失败', tone: 'failed', hasVideo, clip, status, failure };
    }
    if (reviewing) return { key: 'reviewing', label: '视频已生成，等待审核', shortLabel: '待审核', tone: 'review', hasVideo: true, clip, status };
    if (running) return { key: 'running', label: '视频生成中', shortLabel: '生成中', tone: 'running', hasVideo, clip, status };
    if (lifecycle === 'cancelled') return { key: 'cancelled', label: '视频生成已取消', shortLabel: '已取消', tone: 'cancelled', hasVideo, clip, status };
    return { key: 'missing', label: '视频尚未生成', shortLabel: '未生成', tone: 'missing', hasVideo: false, clip, status };
  }

  function videoStatusSummary() {
    const items = state.shots.map((_, index) => videoShotView(index));
    return items.reduce((summary, item) => {
      summary[item.key] = Number(summary[item.key] || 0) + 1;
      return summary;
    }, { total: items.length, passed: 0, reviewing: 0, running: 0, failed: 0, cancelled: 0, missing: 0 });
  }

  function videoPlanItems({ regenerateAll = false, onlyIndex = null, regenerateExisting = false } = {}) {
    return state.shots.map((shot, index) => ({
      index,
      title: shot.title || `第 ${index + 1} 镜`,
      view: videoShotView(index),
    })).filter(item => {
      if (Number.isInteger(Number(onlyIndex))) return item.index === Number(onlyIndex);
      return regenerateAll || item.view.key !== 'passed';
    }).map(item => ({
      ...item,
      action: item.view.hasVideo ? (regenerateAll || regenerateExisting ? '重新生成' : '复审现有视频，不自动重做') : '补充生成',
    }));
  }

  function videoClipApproved(clip = {}) {
    return !!(clip.video_url || clip.videoUrl || clip.file_path)
      && !clip.error_code
      && clip.qa?.pass === true
      && clip.cross_shot_qa?.pass !== false;
  }

  function videoGenerationEstimate({ regenerateAll = false, onlyIndex = null } = {}) {
    const indexes = onlyIndex !== null && onlyIndex !== undefined && Number.isInteger(Number(onlyIndex))
      ? [Number(onlyIndex)]
      : state.shots.map((_, index) => index);
    const targets = regenerateAll ? indexes : indexes.filter(index => !videoClipApproved(videoClipAt(index)));
    const generationIndexes = regenerateAll ? targets : targets.filter(index => !videoShotView(index).hasVideo);
    return { count: targets.length, indexes: targets, generationCount: generationIndexes.length, generationIndexes, reviewCount: targets.length - generationIndexes.length, total: state.shots.length };
  }

  function stopStageProgress() {
    if (state.stageProgressTimer) {
      clearInterval(state.stageProgressTimer);
      state.stageProgressTimer = null;
    }
    state.stageProgress = null;
  }

  function stageProgressSnapshot(label = '') {
    if (window.NewStoryAdProgress?.snapshot) {
      return window.NewStoryAdProgress.snapshot({
        progress: state.stageProgress || {},
        label,
        total: stageItemCount(state.stageProgress?.stage || ''),
        completed: completedKeyframeCount(),
        serverProgress: state.generationProgress || null,
        taskStage: state.taskStage || state.activeStage || '',
        taskStatus: state.taskStatus || '',
        finalVideoReady: !!(state.finalVideo?.video_url || state.finalVideo?.videoUrl),
      });
    }
    const progress = state.stageProgress || {};
    const stage = progress.stage || '';
    const total = Math.max(1, Number(progress.total || stageItemCount(stage)) || 1);
    const elapsed = Math.max(0, Date.now() - (Number(progress.startedAt || 0) || Date.now()));
    if (stage === 'single_keyframe') {
      const shotNo = Math.max(1, Number(progress.shotNo || progress.targetIndex + 1 || 1) || 1);
      return {
        title: `正在重新生成第 ${shotNo} 镜真实关键帧`,
        stat: `已耗时 ${formatElapsedText(elapsed)}`,
        percent: 0,
        indeterminate: true,
        message: `当前正在重新生成第 ${shotNo} 镜，完成后会自动替换本镜图片。`,
      };
    }
    if (stage === 'keyframes') {
      const completed = Math.min(total, Number(state.generationProgress?.processed) || 0);
      const current = Math.min(total, completed + 1);
      const pct = Math.round((completed / total) * 100);
      return {
        title: `\u751f\u6210\u771f\u5b9e\u5173\u952e\u5e27\u4e2d\uff1a\u7b2c ${current}/${total} \u955c`,
        stat: `\u5df2\u8017\u65f6 ${formatElapsedText(elapsed)} \u00b7 \u5df2\u5904\u7406 ${completed}/${total} \u00b7 ${pct}%`,
        percent: pct,
        indeterminate: completed === 0,
        message: `\u5df2\u5b8c\u6210 ${completed}/${total} \u5f20\u5173\u952e\u5e27\uff1b\u5f53\u524d\u6b63\u5728\u751f\u6210\u7b2c ${current} \u955c\uff0c\u5b8c\u6210\u4e00\u5f20\u4f1a\u81ea\u52a8\u66f4\u65b0\u3002`,
      };
    }
    if (stage === 'storyboard') {
      return {
        title: `\u751f\u6210\u5206\u955c\u8868\u4e2d\uff1a\u5171 ${total} \u955c`,
        stat: `\u5df2\u8017\u65f6 ${formatElapsedText(elapsed)}`,
        percent: 0,
        indeterminate: true,
        message: '\u6b63\u5728\u6309\u5df2\u786e\u8ba4\u5267\u672c\u751f\u6210\u5206\u955c\u8868\uff0c\u5e76\u8fdb\u884c\u955c\u5934\u3001\u52a8\u4f5c\u3001\u53f0\u8bcd\u548c\u5546\u4e1a\u4e00\u81f4\u6027\u68c0\u67e5\u3002',
      };
    }
    return {
      title: label || progress.label || '\u5904\u7406\u4e2d...',
      stat: `\u5df2\u8017\u65f6 ${formatElapsedText(elapsed)}`,
      percent: 0,
      indeterminate: true,
      message: progress.message || '\u6b63\u5728\u6267\u884c\u5f53\u524d\u9636\u6bb5\uff0c\u8bf7\u7a0d\u5019\u3002',
    };
  }

  function renderStageProgress(label = '') {
    const snap = stageProgressSnapshot(label);
    const canCancel = !!state.taskId && (!!state.activeGenerationId || !!state.stageProgress?.active || !!state.sceneGenerationProgress?.active);
    return `<div class="dh-lux-person-progress${snap.indeterminate ? ' is-indeterminate' : ''}">
      <div class="dh-lux-person-progress-head">
        <b>${escapeHtml(snap.title)}</b>
        <div class="dh-nsa-progress-actions">
          <span class="dh-lux-person-progress-stat"><em>${escapeHtml(snap.stat)}</em></span>
          ${currentUserIsAdmin() && state.taskId && ['video', 'media', 'compose'].includes(String(state.stageProgress?.stage || '')) ? '<button type="button" class="dh-nsa-admin-monitor-btn" data-nsa-admin-video-monitor>查看镜头进度</button>' : ''}
          ${canCancel ? `<button type="button" class="dh-nsa-cancel-generation" data-nsa-cancel-generation ${state.cancelRequested ? 'disabled' : ''}>${state.cancelRequested ? '正在取消...' : '取消生成'}</button>` : ''}
        </div>
      </div>
      <div class="dh-lux-person-progress-track" aria-hidden="true"><i style="width:${snap.indeterminate ? 28 : snap.percent}%"></i></div>
      <small>${escapeHtml(snap.message)}</small>
    </div>`;
  }
  function startStageProgress(stage = '', label = '', { resume = false } = {}) {
    stopStageProgress();
    const previousGenerationId = String(state.generationProgress?.generation_id || state.activeGenerationId || '');
    const persistedStart = resume && state.activeGenerationId
      ? Date.parse(state.generationStartedAt || '')
      : NaN;
    const total = stageItemCount(stage);
    state.stageProgress = {
      active: true,
      stage,
      label,
      total,
      generationId: resume ? state.activeGenerationId : '',
      previousGenerationId: resume ? '' : previousGenerationId,
      submissionPending: stage === 'keyframes' && !resume,
      startedAt: Number.isFinite(persistedStart) ? persistedStart : Date.now(),
    };
    if (stage === 'keyframes' && !resume) {
      state.activeGenerationId = '';
      state.activeStage = 'keyframes';
      state.generationProgress = {
        stage: 'keyframes',
        status: 'submitting',
        target_total: total,
        processed: 0,
        succeeded: 0,
        failed: 0,
        current_index: 1,
        generation_id: '',
      };
    }
    const intervalMs = stage === 'keyframes' ? 2000 : 1000;
    state.stageProgressTimer = setInterval(async () => {
      const activeProgress = state.stageProgress;
      if (!activeProgress?.active) return;
      if (stage === 'keyframes' && state.taskId) {
        try {
          const r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(state.taskId)}`);
          if (!state.stageProgress?.active || state.stageProgress !== activeProgress) return;
          normalizeBundle(r);
        } catch {}
      }
      if (!state.stageProgress?.active || state.stageProgress !== activeProgress) return;
      setBusy(true, label);
    }, intervalMs);
  }
  function startSingleKeyframeProgress(index = 0, label = '') {
    stopStageProgress();
    const shotNo = Math.max(1, Number(index) + 1 || 1);
    const previousGenerationId = String(state.generationProgress?.generation_id || state.activeGenerationId || '');
    state.stageProgress = {
      active: true,
      stage: 'single_keyframe',
      label,
      total: 1,
      targetIndex: Number(index) || 0,
      shotNo,
      generationId: '',
      previousGenerationId,
      submissionPending: true,
      startedAt: Date.now(),
    };
    state.stageProgressTimer = setInterval(() => {
      if (!state.stageProgress?.active) return;
      setBusy(true, label);
    }, 1000);
  }
  function setBusy(isBusy, label = '处理中...') {
    if (!isBusy) stopStageProgress();
    state.busy = !!isBusy;
    const host = within('#dhNsaAdLiveProgress');
    if (host) {
      host.hidden = !isBusy;
      host.innerHTML = isBusy
        ? renderStageProgress(label)
        : '';
    }
    ['#dhNsaAdGenerate', '#dhNsaAdStoryboard', '#dhNsaAdPreviewFrames', '#dhNsaAdGenerateFinalFrames', '#dhNsaAdConfirmGenerate'].forEach(sel => {
      const btn = within(sel);
      if (btn) btn.disabled = !!isBusy;
    });
    updateLocks();
  }

  function showStep(step, opts = {}) {
    if (window.NewStoryAdStepNavigation?.showStep) {
      return window.NewStoryAdStepNavigation.showStep(step, opts, {
        state,
        root,
        within,
        queryAll: $$,
        rememberRouteStep,
      });
    }
    state.currentStep = Math.max(1, Math.min(5, Number(step) || 1));
    $$('.dh-luxgen-stage', root()).forEach(panel => {
      panel.classList.toggle('active', Number(panel.dataset.panel || 0) === state.currentStep);
    });
    $$('[data-nsa-step]', root()).forEach(item => {
      const n = Number(item.dataset.nsaStep || 0);
      item.classList.toggle('active', n === state.currentStep);
      item.classList.toggle('done', stepReady(n));
      item.classList.toggle('locked', n > 1 && !canOpenStep(n));
    });
    if (opts.remember !== false) rememberRouteStep(state.currentStep);
  }

  function stepReady(step) {
    if (window.NewStoryAdStepNavigation?.stepReady) {
      return window.NewStoryAdStepNavigation.stepReady(step, { state, within });
    }
    if (step === 1) return !!state.taskId || !!(within('#dhNsaAdText')?.value || '').trim();
    if (step === 2) return !!state.sceneConfig;
    if (step === 3) return !!state.blueprint;
    if (step === 4) return state.storyboardStatus && typeof state.storyboardStatus.ready === 'boolean'
      ? state.storyboardStatus.ready
      : (Array.isArray(state.shots) && state.shots.length > 0);
    if (step === 5) return !!(state.finalVideo?.video_url || state.finalVideo?.videoUrl);
    return false;
  }

  function canOpenStep(step) {
    if (window.NewStoryAdStepNavigation?.canOpenStep) {
      return window.NewStoryAdStepNavigation.canOpenStep(step, { state });
    }
    if (step <= 1) return true;
    if (step === 2) return !!state.sceneConfig || !!state.taskId;
    if (step === 3) return !!state.blueprint || !!state.sceneConfig;
    if (step === 4) return Array.isArray(state.shots) && state.shots.length > 0 || !!state.blueprint;
    if (step === 5) return stepReady(4);
    return true;
  }

  function formatCastMode(value = '') {
    const raw = String(value || '').trim().toLowerCase();
    const labels = {
      auto: '自动判断',
      single: '单人物展示 / 导览',
      dual: '双人物对话 / 互动',
      multi: '多人剧情 / 群体展示',
      group: '多人剧情 / 群体展示',
      no_human: '无人物，仅产品 / 空间 / 材料',
      none: '无人物，仅产品 / 空间 / 材料',
      animal: '动物 / 宠物主体',
      pet: '动物 / 宠物主体',
    };
    return labels[raw] || value || '-';
  }

  function renderDraftSceneInfo() {
    const brief = (within('#dhNsaAdText')?.value || '').trim();
    const subject = state.context?.product_subject || payload().product_subject || (brief ? brief.slice(0, 36) : '当前广告主体');
    const rows = [
      ['广告主体', subject || '按广告需求判断'],
      ['业务边界', brief ? '待 AI 根据当前广告需求确认，不继承其他任务。' : '待填写广告需求'],
      ['人物/主体模式', formatCastMode(personSpec('castMode') || state.context?.cast_mode || 'auto')],
      ['剧情策略', '待生成基础信息后确认'],
      ['禁止项', '按当前任务禁止项和高级设置判断'],
    ];
    return `<div class="dh-lux-asset-manifest is-draft">${rows.map(([k, v]) => `<div><b>${escapeHtml(k)}</b><span>${escapeHtml(v || '-')}</span></div>`).join('')}</div>`;
  }

  function renderScene() {
    const host = within('#dhNsaAdSceneConfigHost');
    if (!host) return;
    if (!state.sceneConfig) {
      host.innerHTML = renderDraftSceneInfo();
      return;
    }
    const sc = state.sceneConfig || {};
    const rows = [
      ['广告主体', sc.advertised_subject],
      ['业务边界', sc.business_boundary],
      ['人物/主体模式', sc.cast_mode],
      ['剧情策略', Array.isArray(sc.story_strategy) ? sc.story_strategy.join('；') : ''],
      ['禁止项', Array.isArray(sc.forbidden || sc.forbidden_elements) ? (sc.forbidden || sc.forbidden_elements).join('；') : ''],
    ];
    const displayRows = rows.map(([k, v]) => (v === sc.cast_mode ? [k, formatCastMode(sc.cast_mode || sc.castMode)] : [k, v]));
    host.innerHTML = `<div class="dh-lux-asset-manifest">${displayRows.map(([k, v]) => `<div><b>${escapeHtml(k)}</b><span>${escapeHtml(v || '-')}</span></div>`).join('')}</div>`;
  }

  function blueprintBeats() {
    if (!state.blueprint || typeof state.blueprint !== 'object') return [];
    if (!Array.isArray(state.blueprint.beats)) state.blueprint.beats = [];
    return state.blueprint.beats;
  }

  function blueprintBeatDuration(beat = {}, index = 0, total = 1) {
    const explicit = Number(beat.duration || beat.duration_sec || beat.seconds || 0);
    if (Number.isFinite(explicit) && explicit > 0) return Math.max(1, Math.round(explicit));
    const target = Number(state.context?.target_duration || state.context?.duration_sec || state.context?.duration || 30) || 30;
    return Math.max(2, Math.round(target / Math.max(1, total || 1)));
  }

  function fallbackBlueprintSpokenLine(beat = {}, index = 0) {
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const proof = clean(beat.visual_proof || beat.evidence || beat.purpose || beat.objective || '');
    const visual = clean(beat.visual || beat.story_visual || beat.promo_visual || beat.plot || '');
    const action = clean(beat.action || beat.character_action || beat.behavior || '');
    const subject = clean(state.context?.product_subject || state.sceneConfig?.advertised_subject || payload().product_subject || '当前主体');
    const pick = text => text.length > 32 ? text.slice(0, 32).replace(/[，。；、,\s]*$/, '') : text;
    if (proof) return `这一镜看清${pick(proof)}。`;
    if (action) return `先看${pick(action)}。`;
    if (visual) return `这里呈现${pick(visual)}。`;
    return `继续看${pick(subject)}的第 ${index + 1} 个关键画面。`;
  }

  function normalizeSpeechText(value = '') {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/^(?:字幕|屏幕字幕|字幕文案|旁白|台词|对白|解说|画外音|配音)\s*[:：]\s*/i, '')
      .trim();
  }

  function blueprintFieldValue(beat = {}, field = '', index = 0, total = 1) {
    if (field === 'duration') return String(blueprintBeatDuration(beat, index, total));
    if (field === 'title') return beat.title || beat.role || beat.story_role || `镜头 ${index + 1}`;
    if (field === 'visual') return beat.visual || beat.story_visual || beat.promo_visual || beat.plot || '';
    if (field === 'action') return beat.action || beat.character_action || beat.behavior || '';
    if (field === 'spoken_line') return normalizeSpeechText(beat.spoken_line || beat.voiceover || beat.copy || beat.dialogue) || fallbackBlueprintSpokenLine(beat, index);
    if (field === 'visual_proof') return beat.visual_proof || beat.evidence || beat.promo_visual || beat.purpose || '';
    if (field === 'purpose') return beat.purpose || beat.objective || beat.role || '';
    return beat[field] || '';
  }

  function normalizeBlueprintForSave() {
    const bp = state.blueprint && typeof state.blueprint === 'object' ? state.blueprint : {};
    const beats = Array.isArray(bp.beats) ? bp.beats : [];
    return {
      ...bp,
      story_title: bp.story_title || bp.title || '剧情广告剧本',
      logline: bp.logline || bp.summary || '',
      beats: beats.map((beat, i) => {
        const total = beats.length || 1;
        const duration = blueprintBeatDuration(beat, i, total);
        const title = blueprintFieldValue(beat, 'title', i, total);
        const visual = blueprintFieldValue(beat, 'visual', i, total);
        const action = blueprintFieldValue(beat, 'action', i, total);
        const spoken = blueprintFieldValue(beat, 'spoken_line', i, total);
        const proof = blueprintFieldValue(beat, 'visual_proof', i, total);
        const purpose = blueprintFieldValue(beat, 'purpose', i, total);
        return {
          ...beat,
          beat_index: i + 1,
          index: i + 1,
          duration,
          duration_sec: duration,
          title,
          role: beat.role || title || purpose || 'story',
          plot: visual || action || beat.plot || '',
          visual,
          story_visual: visual,
          action,
          spoken_line: spoken,
          voiceover: spoken,
          visual_proof: proof,
          purpose,
          confirmed: beat.confirmed !== false,
        };
      }).filter(beat => beat.plot || beat.visual || beat.action || beat.spoken_line || beat.visual_proof),
    };
  }

  function updateBlueprintField(target) {
    if (!target?.matches?.('[data-nsa-blueprint-field]')) return false;
    const beats = blueprintBeats();
    const index = Number(target.dataset.nsaBlueprintIndex || 0);
    const field = target.dataset.nsaBlueprintField || '';
    const beat = beats[index];
    if (!beat || !field) return true;
    const value = field === 'duration'
      ? Math.max(1, Math.min(15, Number(target.value || 0) || blueprintBeatDuration(beat, index, beats.length)))
      : target.value || '';
    if (field === 'duration') {
      beat.duration = value;
      beat.duration_sec = value;
    } else if (field === 'visual') {
      beat.visual = value;
      beat.story_visual = value;
      beat.plot = value || beat.plot || '';
    } else if (field === 'spoken_line') {
      beat.spoken_line = value;
      beat.voiceover = value;
    } else if (field === 'visual_proof') {
      beat.visual_proof = value;
      beat.evidence = value;
    } else {
      beat[field] = value;
      if (field === 'title') beat.role = value || beat.role;
    }
    state.blueprintDirty = true;
    state.storyboardStatus = { ready: false, stale: true, reason: 'BLUEPRINT_EDITED' };
    return true;
  }

  function blueprintMetrics() {
    const beats = blueprintBeats();
    const totalSeconds = beats.reduce((sum, beat, i) => sum + blueprintBeatDuration(beat, i, beats.length), 0);
    const avgSeconds = Math.round((totalSeconds / Math.max(1, beats.length)) * 10) / 10;
    return { beats, totalSeconds, avgSeconds };
  }

  function refreshBlueprintMetrics() {
    const bp = state.blueprint || {};
    const { beats, totalSeconds, avgSeconds } = blueprintMetrics();
    const title = bp.story_title || bp.title || '剧情广告';
    const summary = within('[data-nsa-blueprint-summary]');
    if (summary) summary.textContent = `第 1 版 · 待确认 · ${title} · 共 ${beats.length} 镜 · 总时长 ${totalSeconds} 秒`;
    const totalEl = within('[data-nsa-blueprint-total]');
    if (totalEl) totalEl.textContent = `${totalSeconds} 秒`;
    const countEl = within('[data-nsa-blueprint-count]');
    if (countEl) countEl.textContent = `${beats.length} 镜`;
    const avgEl = within('[data-nsa-blueprint-avg]');
    if (avgEl) avgEl.textContent = `${avgSeconds} 秒/镜`;
  }

  function renderBlueprint() {
    const host = within('#dhNsaAdScriptHost');
    if (!host) return;
    if (!state.blueprint) {
      host.innerHTML = '<div class="dh-luxgen-empty"><b>还没有剧本</b><span>请先完成场景配置，再点击“生成剧本”。</span></div>';
      return;
    }
    const bp = state.blueprint || {};
    const beats = Array.isArray(bp.beats) ? bp.beats : [];
    if (!beats.length) {
      host.innerHTML = '<div class="dh-luxgen-empty"><b>剧本为空</b><span>请重新生成剧本，或添加镜头后再进入分镜。</span></div>';
      return;
    }
    const { totalSeconds, avgSeconds } = blueprintMetrics();
    host.innerHTML = `<div class="dh-demo-script-review">
      <div>
        <h4>剧本审核</h4>
        <p data-nsa-blueprint-summary>第 1 版 · 待确认 · ${escapeHtml(bp.story_title || bp.title || '剧情广告')} · 共 ${beats.length} 镜 · 总时长 ${totalSeconds} 秒</p>
      </div>
      <div class="dh-demo-script-actions">
        <button type="button" class="dh-luxgen-edit" data-nsa-blueprint-add>添加一镜</button>
        <span class="dh-luxgen-status ready">可编辑</span>
      </div>
    </div>
    <div class="dh-lux-script-stats">
      <span><small>最终时长</small><b data-nsa-blueprint-total>${escapeHtml(String(totalSeconds))} 秒</b></span>
      <span><small>镜头数量</small><b data-nsa-blueprint-count>${beats.length} 镜</b></span>
      <span><small>平均镜长</small><b data-nsa-blueprint-avg>${escapeHtml(String(avgSeconds))} 秒/镜</b></span>
      <em>这里调整秒数、画面、动作、台词和补充说明后，会先保存到剧情广告任务，再生成分镜。</em>
    </div>
    <div class="dh-demo-script-mainline">
      <b>脚本主线</b>
      <span>${escapeHtml(bp.logline || bp.summary || '按当前广告需求生成，可继续补充每一镜细节。')}</span>
    </div>
    <div class="dh-demo-script-overview dh-lux-script-checklist">
      <b>生成分镜图前先确认</b>
      <span>如果需要加时间、补画面或改台词，直接在下方逐镜修改；确认后再点击“确认脚本，生成分镜”。</span>
    </div>
    <table class="dh-demo-table">
      <thead>
        <tr>
          <th style="width:58px">镜</th>
          <th style="width:74px">秒</th>
          <th style="width:24%">画面</th>
          <th style="width:21%">动作</th>
          <th style="width:18%">台词/旁白</th>
          <th style="width:18%">目的/补充</th>
          <th style="width:104px">状态</th>
          <th style="width:72px">编辑</th>
        </tr>
      </thead>
      <tbody>
        ${beats.map((beat, i) => {
          const missing = [
            !blueprintFieldValue(beat, 'visual', i, beats.length) ? '缺画面' : '',
            !blueprintFieldValue(beat, 'action', i, beats.length) ? '缺动作' : '',
            !blueprintFieldValue(beat, 'spoken_line', i, beats.length) ? '缺台词' : '',
          ].filter(Boolean);
          return `<tr>
            <td>${i + 1}</td>
            <td><input class="dh-input dh-lux-shot-duration-input" type="number" min="1" max="15" step="1" value="${escapeHtml(blueprintFieldValue(beat, 'duration', i, beats.length))}" data-nsa-blueprint-index="${i}" data-nsa-blueprint-field="duration"></td>
            <td><textarea class="dh-input dh-lux-script-cell-input" rows="4" data-nsa-blueprint-index="${i}" data-nsa-blueprint-field="visual">${escapeHtml(blueprintFieldValue(beat, 'visual', i, beats.length))}</textarea></td>
            <td><textarea class="dh-input dh-lux-script-cell-input" rows="4" data-nsa-blueprint-index="${i}" data-nsa-blueprint-field="action">${escapeHtml(blueprintFieldValue(beat, 'action', i, beats.length))}</textarea></td>
            <td><textarea class="dh-input dh-lux-script-cell-input" rows="4" data-nsa-blueprint-index="${i}" data-nsa-blueprint-field="spoken_line">${escapeHtml(blueprintFieldValue(beat, 'spoken_line', i, beats.length))}</textarea></td>
            <td><textarea class="dh-input dh-lux-script-cell-input" rows="4" data-nsa-blueprint-index="${i}" data-nsa-blueprint-field="visual_proof">${escapeHtml(blueprintFieldValue(beat, 'visual_proof', i, beats.length) || blueprintFieldValue(beat, 'purpose', i, beats.length))}</textarea></td>
            <td><span class="dh-luxgen-status ${missing.length ? 'error' : 'ready'}">${escapeHtml(missing.length ? missing.join(' / ') : '可确认')}</span></td>
            <td><button type="button" class="dh-luxgen-edit danger" data-nsa-blueprint-delete="${i}" ${beats.length <= 1 ? 'disabled' : ''}>删除</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
    return;
    host.innerHTML = `<div class="dh-task-create-panel">
      <div class="dh-task-create-section dh-task-create-section-wide">
        <div class="dh-task-detail-title">${escapeHtml(bp.story_title || '剧本生成结果')}</div>
        <div class="dh-task-detail-value">${escapeHtml(bp.logline || '')}</div>
      </div>
      <div class="dh-task-segment-list">${beats.map((beat, i) => `<div class="dh-task-segment-row">
        <div class="dh-task-segment-time">${String(beat.beat_index || i + 1).padStart(2, '0')}</div>
        <div class="dh-task-segment-main">
          <div class="dh-task-segment-text">${escapeHtml(beat.role || beat.title || `剧情 Beat ${i + 1}`)}</div>
          <div class="dh-task-segment-meta">${escapeHtml(beat.plot || beat.visual || '')}</div>
          ${blueprintFieldValue(beat, 'spoken_line', i, beats.length) ? `<div class="dh-task-segment-meta">台词/旁白：${escapeHtml(blueprintFieldValue(beat, 'spoken_line', i, beats.length))}</div>` : ''}
          ${beat.visual_proof ? `<div class="dh-task-segment-meta">可见证据：${escapeHtml(beat.visual_proof)}</div>` : ''}
        </div>
      </div>`).join('')}</div>
    </div>`;
  }

  function nestedFieldValue(source = {}, path = '') {
    return String(path || '').split('.').reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), source);
  }

  function displayFieldValue(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.map(displayFieldValue).filter(Boolean).join('；');
    if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${displayFieldValue(item)}`).filter(Boolean).join('；');
    return String(value);
  }

  function setNestedField(source = {}, path = '', value) {
    const keys = String(path || '').split('.').filter(Boolean);
    if (!keys.length) return source;
    let current = source;
    keys.forEach((key, index) => {
      if (index === keys.length - 1) current[key] = value;
      else {
        if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) current[key] = {};
        current = current[key];
      }
    });
    return source;
  }

  function shotFieldValue(shot = {}, contract = {}, field = '') {
    if (field === 'duration') return shot.duration || shot.duration_sec || contract.duration || '';
    if (field === 'visual') return editorFriendlyPromptText(shot.visual || shot.visual_description || shot.content_prompt || contract.visual || '');
    if (field === 'action') return shot.action || shot.visual_action || contract.action || '';
    if (field === 'voiceover') return normalizeSpeechText(shot.voiceover || shot.narration || shot.ad_copy || shot.subtitle || '');
    if (field === 'purpose') return shot.purpose || shot.objective || shot.role || contract.subject_strategy || '';
    if (field === 'scene_id') return shot.scene_id || shot.scene_asset_id || contract.scene_lock?.scene_id || '';
    if (field === 'scene_view') return shot.scene_view || contract.scene_lock?.scene_view || '';
    if (field === 'scene_zone') return shot.scene_zone_label_zh || contract.scene_lock?.scene_zone_label_zh || shot.scene_zone || contract.scene_lock?.scene_zone || '';
    if (field === 'transition_reason') return shot.transition_reason || contract.scene_lock?.transition_reason || '';
    if (field.includes('.')) return nestedFieldValue(shot, field) ?? '';
    return displayFieldValue(shot[field] || '');
  }

  function updateShotField(target) {
    if (!target?.matches?.('[data-nsa-shot-field]')) return false;
    const index = Number(target.dataset.nsaShotIndex || 0);
    const field = target.dataset.nsaShotField || '';
    const shot = state.shots[index];
    if (!shot || !field) return true;
    const value = field === 'duration'
      ? Math.max(1, Math.min(15, Number(target.value || 0) || Number(shot.duration || 3) || 3))
      : (target.type === 'checkbox' ? target.checked : target.value || '');
    shot._nsa_user_edited_fields = { ...(shot._nsa_user_edited_fields || {}), [field]: true };
    if (field === 'duration') { shot.duration = value; shot.duration_sec = value; }
    else if (field === 'visual') {
      const visual = editorFriendlyPromptText(value);
      shot.visual = visual;
      shot.visual_description = visual;
      shot.content_prompt = visual;
      shot.user_visual_override = true;
    }
    else if (field === 'action') { shot.action = value; shot.visual_action = value; }
    else if (field === 'voiceover') { const speech = normalizeSpeechText(value); shot.voiceover = speech; shot.narration = speech; shot.subtitle = speech; }
    else if (field === 'purpose') { shot.purpose = value; shot.objective = value; shot.role = value; shot.keyframe_notes = value; shot.material_usage = value; }
    else if (field === 'scene_id') {
      const matchedIndex = (state.sceneAssets || []).findIndex(asset => String(asset.scene_id || asset.id || '') === String(value));
      const matched = matchedIndex >= 0 ? state.sceneAssets[matchedIndex] : null;
      shot.scene_id = value;
      shot.scene_asset_id = value;
      shot.scene_name = matched?.name || shot.scene_name || '';
    }
    else if (field === 'scene_view') { shot.scene_view = value; }
    else if (field === 'scene_zone') {
      // 中文名称只用于展示；zone_ids/scene_zone_id 是生成与 QA 使用的稳定绑定，不在此处改写。
      shot.scene_zone_label_zh = value;
      shot.scene_zone = value;
    }
    else if (field === 'transition_reason') { shot.transition_reason = value; }
    else if (field.includes('.')) { setNestedField(shot, field, value); }
    else { shot[field] = value; }
    shot.edited_at = new Date().toISOString();
    state.storyboardDirty = true;
    return true;
  }

  function syncShotFieldsFromDom(index = 0, scope = host) {
    const shotIndex = Math.max(0, Number(index) || 0);
    $$(`[data-nsa-shot-index="${shotIndex}"][data-nsa-shot-field]`, scope || root()).forEach(updateShotField);
    return state.shots[shotIndex] || null;
  }

  function closeShotEditorModal({ keepChanges = false, rerender = true } = {}) {
    const index = Number(state.shotEditorIndex);
    if (!keepChanges && index >= 0 && state.shotEditorSnapshot) {
      state.shots[index] = state.shotEditorSnapshot;
    }
    document.querySelector('.dh-nsa-shot-edit-modal')?.remove();
    document.documentElement.classList.remove('dh-nsa-modal-open');
    state.shotEditorIndex = -1;
    state.shotEditorSnapshot = null;
    if (rerender) renderStoryboard();
  }

  function shotAssistPayload(index = 0) {
    const compactShot = shot => {
      if (!shot || typeof shot !== 'object') return null;
      const { _prompt_preview, candidates, ...rest } = shot;
      return rest;
    };
    const sceneAssets = (state.sceneAssets || []).map((asset, assetIndex) => ({
      scene_id: asset.scene_id || asset.id || `scene_${assetIndex + 1}`,
      name: asset.name || `场景 ${assetIndex + 1}`,
      zones: asset.zones || asset.scene_zones || [],
      views: (asset.views || asset.view_images || []).map(view => ({ key: view.key || view.view || '', label: view.label || view.name || '' })),
    }));
    return {
      previous_shot: compactShot(state.shots[index - 1]),
      current_shot: compactShot(state.shots[index]),
      next_shot: compactShot(state.shots[index + 1]),
      scene_assets: sceneAssets,
    };
  }

  function hydrateShotEditorFields(index = 0, modal = document) {
    const shot = state.shots[index] || {};
    $$(`[data-nsa-shot-index="${index}"][data-nsa-shot-field]`, modal).forEach(field => {
      const name = field.dataset.nsaShotField || '';
      const value = shotFieldValue(shot, {}, name);
      if (field.type === 'checkbox') field.checked = value !== false && value !== 'false';
      else field.value = value ?? '';
    });
  }

  function applyAssistedShotSettings(index = 0, settings = {}, modal = document) {
    const current = state.shots[index] || {};
    const next = {
      ...current,
      ...settings,
      scene_id: current.scene_id || current.scene_asset_id || '',
      scene_asset_id: current.scene_asset_id || current.scene_id || '',
      surface_topology: { ...(current.surface_topology || {}), ...(settings.surface_topology || {}) },
      motion_effect: { ...(current.motion_effect || {}), ...(settings.motion_effect || {}) },
      _nsa_user_edited_fields: { ...(current._nsa_user_edited_fields || {}) },
      edited_at: new Date().toISOString(),
    };
    if (settings.visual !== undefined) {
      next.visual = settings.visual;
      next.visual_description = settings.visual;
      next.content_prompt = settings.visual;
      next.user_visual_override = true;
    }
    if (settings.action !== undefined) next.visual_action = settings.action;
    if (settings.voiceover !== undefined) {
      next.narration = settings.voiceover;
      next.subtitle = settings.voiceover;
    }
    if (settings.purpose !== undefined) {
      next.objective = settings.purpose;
      next.role = settings.purpose;
      next.keyframe_notes = settings.purpose;
      next.material_usage = settings.purpose;
    }
    if (settings.scene_zone !== undefined) next.scene_zone_label_zh = settings.scene_zone;
    Object.keys(settings || {}).forEach(key => { next._nsa_user_edited_fields[key] = true; });
    state.shots[index] = next;
    hydrateShotEditorFields(index, modal);
    if (settings.motion_effect?.type && settings.motion_effect.type !== 'none') modal.querySelector('.dh-nsa-shot-design-editor')?.setAttribute('open', '');
    return next;
  }

  async function runShotAiAssist(index = 0, modal, button) {
    if (!modal || !button) return;
    syncShotFieldsFromDom(index, modal);
    const instruction = String(modal.querySelector('[data-nsa-shot-ai-instruction]')?.value || '').trim();
    const status = modal.querySelector('[data-nsa-shot-ai-status]');
    setButtonBusy(button, true, 'AI 分析中...');
    if (status) status.textContent = '正在结合当前脚本、场景绑定和前后镜连续性整理设置…';
    try {
      const id = await ensureTask();
      const response = await api('/api/new-story-ad/assist', {
        method: 'POST',
        body: {
          ...payload(),
          task_id: id,
          mode: 'shot_settings',
          user_instruction: instruction,
          shot_assist_context: shotAssistPayload(index),
        },
      });
      const settings = response.shot_settings || response.shotSettings;
      if (!settings || typeof settings !== 'object') throw new Error('AI 没有返回可用的镜头设置');
      applyAssistedShotSettings(index, settings, modal);
      state.storyboardDirty = true;
      scheduleAutoSave('shot_ai_assist', { immediate: true });
      if (status) status.textContent = 'AI 已填写到表单，系统正在自动保存；尚未生成图片或视频。';
      toast(`第 ${index + 1} 镜已由 AI 补齐设置并自动保存`, 'success');
    } catch (error) {
      if (status) status.textContent = error.message || 'AI 帮写失败，请稍后重试。';
      toast(error.message || 'AI 帮写镜头设置失败', 'error');
    } finally {
      setButtonBusy(button, false);
    }
  }

  function openShotEditorModal(index = 0) {
    const shotIndex = Math.max(0, Number(index) || 0);
    if (!state.shots[shotIndex]) return;
    if (document.querySelector('.dh-nsa-shot-edit-modal')) {
      scheduleAutoSave('shot_editor_switch', { immediate: true });
      closeShotEditorModal({ keepChanges: true, rerender: true });
    }
    const editor = within(`[data-nsa-shot-editor="${shotIndex}"]`);
    if (!editor) return;
    state.shotEditorIndex = shotIndex;
    state.shotEditorSnapshot = JSON.parse(JSON.stringify(state.shots[shotIndex]));
    const modal = document.createElement('div');
    modal.className = 'dh-modal dh-nsa-shot-edit-modal';
    modal.style.display = 'flex';
    modal.innerHTML = `<div class="dh-modal-body dh-nsa-shot-edit-modal-body" role="dialog" aria-modal="true" aria-labelledby="dhNsaShotEditTitle">
      <div class="dh-modal-head">
        <div>
          <div class="dh-modal-title" id="dhNsaShotEditTitle">编辑第 ${shotIndex + 1} 镜</div>
          <div class="dh-modal-sub">修改只作用于当前分镜并会自动保存；重新生成本镜后应用到新画面。</div>
        </div>
        <button class="dh-modal-close-btn" type="button" data-nsa-shot-edit-close aria-label="关闭编辑弹窗" title="关闭">×</button>
      </div>
      <section class="dh-nsa-shot-ai-assist" aria-label="AI 镜头设置助手">
        <div class="dh-nsa-shot-ai-copy">
          <b>不知道这些参数怎么填？让 AI 按脚本设置</b>
          <small>调用文字 AI 读取本镜、前后镜和当前场景；填写后自动保存，但不会生成图片或视频。</small>
        </div>
        <div class="dh-nsa-shot-ai-row">
          <textarea class="dh-input" rows="2" data-nsa-shot-ai-instruction placeholder="可不填，直接让 AI 按当前脚本判断；也可以补充你希望本镜如何呈现"></textarea>
          <button type="button" class="dh-btn dh-btn-primary" data-nsa-shot-ai-run>AI 帮我设置</button>
        </div>
        <div class="dh-nsa-shot-ai-tools">
          <span>快速告诉 AI：</span>
          <button type="button" data-nsa-shot-ai-preset="优先保证与前后镜的场景、主体位置、动作方向和道具状态连续。">优先连续性</button>
          <button type="button" data-nsa-shot-ai-preset="突出当前镜头的主要人物、商品或品牌主体，其它元素只作辅助，不改变任务原有场景。">突出主体</button>
          <button type="button" data-nsa-shot-ai-preset="根据当前镜头目的设计自然的镜头运动和动态效果，同时保持人物、商品和场景结构稳定。">增强动态</button>
          <nav class="dh-nsa-shot-jumps" aria-label="镜头设置分区">
            <button type="button" data-nsa-shot-jump=".dh-nsa-frame-scene">场景</button>
            <button type="button" data-nsa-shot-jump=".dh-nsa-editor-basic">画面与台词</button>
            <button type="button" data-nsa-shot-jump=".dh-nsa-shot-design-editor">结构与效果</button>
            <button type="button" data-nsa-shot-jump=".dh-nsa-continuity-editor">镜头连续性</button>
          </nav>
        </div>
        <div class="dh-nsa-shot-ai-status" data-nsa-shot-ai-status>可以直接点击，也可以先写一句要求；所有修改都会自动保存。</div>
      </section>
      <div class="dh-nsa-shot-edit-scroll" data-nsa-shot-edit-content></div>
      <div class="dh-modal-foot dh-nsa-shot-edit-foot">
        <span class="dh-nsa-autosave-status is-idle" data-nsa-shot-autosave-status hidden>修改后自动保存</span>
        <button type="button" class="dh-btn dh-btn-primary" data-nsa-shot-done>完成</button>
      </div>
    </div>`;
    editor.hidden = false;
    modal.querySelector('[data-nsa-shot-edit-content]')?.appendChild(editor);
    modal.addEventListener('click', async event => {
      const preset = event.target.closest('[data-nsa-shot-ai-preset]');
      if (preset) {
        event.preventDefault();
        const input = modal.querySelector('[data-nsa-shot-ai-instruction]');
        if (input) input.value = preset.dataset.nsaShotAiPreset || '';
        input?.focus();
        return;
      }
      const jump = event.target.closest('[data-nsa-shot-jump]');
      if (jump) {
        event.preventDefault();
        const target = modal.querySelector(jump.dataset.nsaShotJump || '');
        if (target?.matches('details')) target.open = true;
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const aiRun = event.target.closest('[data-nsa-shot-ai-run]');
      if (aiRun) {
        event.preventDefault();
        await runShotAiAssist(shotIndex, modal, aiRun);
        return;
      }
      const close = event.target.closest('[data-nsa-shot-edit-close]');
      if (event.target === modal || close) {
        event.preventDefault();
        syncShotFieldsFromDom(shotIndex, modal);
        scheduleAutoSave('shot_editor_close', { immediate: true });
        closeShotEditorModal({ keepChanges: true, rerender: true });
        return;
      }
      const done = event.target.closest('[data-nsa-shot-done]');
      if (done) {
        event.preventDefault();
        syncShotFieldsFromDom(shotIndex, modal);
        scheduleAutoSave('shot_editor_done', { immediate: true });
        closeShotEditorModal({ keepChanges: true, rerender: true });
      }
    });
    const syncShotEditorAutoSave = event => {
      if (!updateShotField(event.target)) return;
      const status = modal.querySelector('[data-nsa-shot-autosave-status]');
      if (status) status.textContent = '有更改，正在自动保存…';
      scheduleAutoSave('shot_editor_field');
    };
    modal.addEventListener('input', syncShotEditorAutoSave);
    modal.addEventListener('change', syncShotEditorAutoSave);
    modal.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        syncShotFieldsFromDom(shotIndex, modal);
        scheduleAutoSave('shot_editor_escape', { immediate: true });
        closeShotEditorModal({ keepChanges: true, rerender: true });
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        modal.querySelector('[data-nsa-shot-done]')?.click();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter(el => !el.hidden && el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    document.documentElement.classList.add('dh-nsa-modal-open');
    document.body.appendChild(modal);
    modal.querySelector('textarea, input, select')?.focus();
  }

  function renderStoryboard() {
    const host = within('#dhNsaAdFrameHost');
    const guard = within('#dhNsaAdCommercialGuard');
    const costHint = within('#dhNsaAdVideoCostHint');
    if (costHint && (!Array.isArray(state.shots) || !state.shots.length)) costHint.hidden = true;
    if (guard) {
      const blocking = Array.isArray(state.review?.blocking_issues) ? state.review.blocking_issues : [];
      guard.innerHTML = state.restoreErrorCode === 'STORYBOARD_OUTPUT_MISSING'
        ? `<div class="dh-task-warning">${escapeHtml(state.restoreError)}</div>`
        : state.review
        ? `<div class="${blocking.length ? 'dh-task-warning' : 'dh-task-ok'}">${blocking.length ? `\u5206\u955c QA \u53d1\u73b0 ${blocking.length} \u4e2a\u95ee\u9898\uff1a${escapeHtml(blocking.join('\uff1b'))}` : '\u5206\u955c QA \u5df2\u901a\u8fc7'}</div>`
        : '';
    }
    if (!host) return;
    if (state.restoreError && (!Array.isArray(state.shots) || !state.shots.length)) {
      host.innerHTML = `<div class="dh-luxgen-empty"><b>任务内容读取失败</b><span>${escapeHtml(state.restoreError)}。请返回任务中心刷新；普通用户只能继续制作自己的任务。</span></div>`;
      return;
    }
    if (state.restoringTask && (!Array.isArray(state.shots) || !state.shots.length)) {
      host.innerHTML = '<div class="dh-luxgen-empty"><b>正在恢复分镜结果</b><span>正在读取任务中心保存的分镜和关键帧，请稍候。</span></div>';
      return;
    }
    if (!Array.isArray(state.shots) || !state.shots.length) {
      host.innerHTML = '<div class="dh-luxgen-empty"><b>\u8fd8\u6ca1\u6709\u5206\u955c</b><span>\u8bf7\u5148\u751f\u6210\u5206\u955c\u8868\u6216\u771f\u5b9e\u5173\u952e\u5e27\u3002</span></div>';
      return;
    }
    if (costHint) {
      const estimate = videoGenerationEstimate();
      const summary = videoStatusSummary();
      const summaryChips = [
        ['pass', `已通过 ${summary.passed}`],
        ['review', `待审核 ${summary.reviewing}`],
        ['running', `生成中 ${summary.running}`],
        ['failed', `失败 ${summary.failed}`],
        ['cancelled', `已取消 ${summary.cancelled}`],
        ['missing', `未生成 ${summary.missing}`],
      ].filter(([, label]) => !/ 0$/.test(label)).map(([tone, label]) => `<span class="is-${tone}">${label}</span>`).join('');
      costHint.hidden = false;
      costHint.innerHTML = `<div class="dh-nsa-video-status-summary"><b>镜头视频状态</b>${summaryChips}</div><p>${estimate.count
        ? `本轮处理 ${estimate.count} 个镜头：最多新增生成 ${estimate.generationCount} 个，已有视频只重新审核；审核仍未通过时保留现有视频，由你选择接受或仅重做本镜，不会自动连续“抽卡”。`
        : '当前镜头视频均已通过；除非手动选择“仅重做本镜视频”或“重新生成全部视频”，否则不会新增视频消耗。'}</p>`;
    }
    if (window.NewStoryAdStoryboard?.normalizeShots) {
      state.shots = window.NewStoryAdStoryboard.normalizeShots(state.shots, state.sceneAssets || []);
    }
    host.innerHTML = `<div class="dh-nsa-frame-list">${state.shots.map((shot, i) => {
      const contract = state.contracts.find(x => Number(x.index || x.shot_index || 0) === Number(shot.index || shot.shot_index || i + 1)) || state.contracts[i] || {};
      const frame = state.keyframes[i] || {};
      const image = window.NewStoryAdKeyframes?.frameUrl ? window.NewStoryAdKeyframes.frameUrl(frame) : (frame.image_url || frame.imageUrl || frame.url || '');
      const preview = image ? withAuthQuery(image) : '';
      const videoClip = videoClipAt(i);
      const videoView = videoShotView(i);
      const videoFailure = videoView.key === 'failed' ? (videoView.failure || videoShotFailureDetail(i)) : null;
      const shotVideoUrl = videoClip.video_url || videoClip.videoUrl || '';
      const shotVideoReady = !!shotVideoUrl;
      const shotVideoBlockMembers = Array.isArray(videoClip.scene_block_members)
        ? videoClip.scene_block_members.map(Number).filter(Number.isInteger)
        : [];
      const shotVideoIsContinuousBlock = shotVideoBlockMembers.length > 1;
      const shotVideoQaPassed = shotVideoReady && videoClip.qa?.pass === true && videoClip.cross_shot_qa?.pass !== false;
      const shotVideoQaFailed = shotVideoReady && (videoClip.qa?.pass === false || videoClip.cross_shot_qa?.pass === false || !!videoClip.error_code);
      const shotVideoState = shotVideoQaPassed ? 'is-passed' : (shotVideoQaFailed ? 'is-failed' : 'is-review');
      const shotVideoLabel = shotVideoQaPassed
        ? '视频已生成并审核通过'
        : (shotVideoQaFailed ? '视频已生成，但审核未通过，可播放检查' : '视频已生成，等待审核');
      const shotVideoPoster = image ? withAuthQuery(assetThumbUrl(image, 520)) : '';
      const dialogue = Array.isArray(shot.dialogue_lines)
        ? shot.dialogue_lines.map(d => `${d.speaker || ''}${d.speaker ? '\uff1a' : ''}${d.line || d.text || ''}`).filter(Boolean).join('\uff1b')
        : (shot.dialogue || shot.voiceover || '');
      const duration = shotFieldValue(shot, contract, 'duration');
      const title = window.NewStoryAdKeyframes?.frameTitle ? window.NewStoryAdKeyframes.frameTitle(shot, i) : (shot.title || `\u7b2c ${i + 1} \u955c`);
      const visualSummary = shotFieldValue(shot, contract, 'visual') || '未填写画面说明';
      const actionSummary = shotFieldValue(shot, contract, 'action') || '未填写镜头动作';
      const voiceoverSummary = shotFieldValue(shot, contract, 'voiceover') || dialogue || '本镜无台词或旁白';
      const sceneName = shot.scene_name || contract.scene_lock?.scene_name || contract.scene_lock?.observed_summary || '';
      const sceneZone = shot.scene_zone_label_zh || shot.scene_zone || '';
      const sceneView = shot.scene_view_label_zh || shot.scene_view || shot.camera_view || '';
      const transition = technicalLabel(shot.transition_type || '');
      const sceneSummary = [sceneName, sceneView, sceneZone, transition, shot.transition_reason].filter(Boolean).join(' · ') || '按任务场景与连续性合同生成';
      const cameraSummary = [technicalLabel(shot.shot_size || shot.shot_type), technicalLabel(shot.camera_angle), shot.lens_mm ? `${shot.lens_mm}mm` : '', technicalLabel(shot.camera_movement)].filter(Boolean).join(' · ') || '按镜头目的判断';
      const soundSummary = [shot.ambient_sound, Array.isArray(shot.sfx) ? shot.sfx.join('、') : shot.sfx, shot.music_cue].filter(Boolean).join('；') || '跟随整片声音设计';
      const scopeLabels = { auto: '按任务判断', environment: '环境镜头', product_comparison: '产品/样品对比', character: '人物镜头', brand_endcard: '品牌收尾' };
      const surfaceLabels = { auto: '', continuous: '连续完整表面', segmented: '分段表面', modular: '模块化表面' };
      const effectLabels = { none: '', particle_assembly: '粒子/流沙汇聚', fade: '淡入', dissolve: '溶解', material_flow: '材质流动', custom: '自定义效果' };
      const effectSummary = [
        shot.shot_scope && shot.shot_scope !== 'auto' ? scopeLabels[shot.shot_scope] : '',
        surfaceLabels[shot.surface_topology?.mode || 'auto'],
        effectLabels[shot.motion_effect?.type || 'none'],
      ].filter(Boolean).join(' · ');
      const candidates = Array.isArray(frame.candidates) ? frame.candidates : [];
      const reviewableCandidate = candidates.slice().reverse().find(candidate => candidate.status === 'qa_unavailable' || candidate.qa?.status === 'unavailable');
      const qaUnavailable = String(frame.current_generation_status || '') === 'qa_unavailable' || !!reviewableCandidate;
      const currentFailed = !qaUnavailable && !!(frame.regeneration_error || frame.error || frame.error_code || ['rejected', 'failed', 'blocked'].includes(String(frame.current_generation_status || '')));
      const qaOutdated = !!preview && (Number(frame.qa_policy_version || 0) < 2 || frame.contract_outdated === true || String(frame.current_generation_status || '') === 'outdated') && !frame.regeneration_error;
      const qaPassed = !!preview && !currentFailed && !qaOutdated && frame.qa?.pass === true;
      const manualAccepted = qaPassed && frame.qa?.manual_override === true;
      const qaState = qaUnavailable || currentFailed || qaOutdated ? 'warning' : (qaPassed ? 'pass' : 'pending');
      const qaLabel = qaUnavailable
        ? '审核服务异常'
        : (frame.regeneration_error
        ? '新版本未通过'
        : (currentFailed
          ? '生成失败'
            : (qaOutdated ? (frame.contract_outdated ? '需重新生成' : '需重新验证') : (manualAccepted ? '人工已确认' : (qaPassed ? 'QA 已通过' : '待验证')))));
      const qaDetail = qaUnavailable
        ? '新图已经生成，但视觉审核服务超时或返回格式异常。可直接重新验证此图，无需重新生成图片。'
        : (frame.regeneration_error
        ? '新版本未通过，当前继续显示上一版可用画面。'
        : (currentFailed
          ? '本镜头生成失败，请重新生成。'
          : (qaOutdated
            ? (frame.contract_outdated
              ? '镜头设置已修改，当前画面仍为上一版本。重新生成后新设置才会生效。'
              : '当前画面由旧版审核规则生成，需按最新规则重新验证。')
            : (manualAccepted ? '自动 QA 的原始结论已保留；该画面由用户人工确认符合创作意图并采用。' : (qaPassed ? '当前版本视觉 QA 已通过。' : '等待当前版本完成视觉 QA。')))));
      const headerSummary = [cameraSummary, sceneName].filter(Boolean).join(' · ');
      const showStatusNotice = qaUnavailable || currentFailed || qaOutdated;
      const ratioMatch = String(state.outputRatio || '9:16').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
      const frameRatio = ratioMatch ? `${Number(ratioMatch[1]) || 9} / ${Number(ratioMatch[2]) || 16}` : '9 / 16';
      const candidateStrip = candidates.length > 1 || candidates.some(candidate => ['rejected', 'qa_unavailable'].includes(candidate.status))
        ? `<div class="dh-nsa-candidate-strip"><b>\u5019\u9009\u5ba1\u7247</b><div>${candidates.map((candidate, candidateIndex) => {
            const candidateUrl = candidate.image_url || candidate.imageUrl || '';
            const accepted = candidate.qa?.pass === true && candidate.status !== 'rejected';
            const manualCandidate = candidate.qa?.manual_override === true || candidate.status === 'manual_accepted';
            const reviewable = candidate.status === 'qa_unavailable' || candidate.qa?.status === 'unavailable';
            const selected = String(frame.selected_candidate_id || '') === String(candidate.id || '');
            const confirmRetained = accepted && selected && !!frame.regeneration_error && Number(candidate.qa_policy_version || 0) >= 2
              && !!contract.contract_fingerprint && candidate.contract_fingerprint === contract.contract_fingerprint;
            const needsHumanRebind = accepted && selected && !confirmRetained && (currentFailed || qaOutdated);
            return `<span class="dh-nsa-candidate ${accepted ? 'is-accepted' : (reviewable ? 'is-review' : 'is-rejected')} ${selected ? 'is-selected' : ''}">
              <button type="button" data-nsa-candidate-preview="${i}:${candidateIndex}" title="\u67e5\u770b\u5019\u9009 ${candidateIndex + 1}">${candidateUrl ? `<img src="${escapeHtml(assetThumbUrl(candidateUrl, 320))}" alt="\u5019\u9009 ${candidateIndex + 1}" loading="lazy" decoding="async">` : `<i>${candidateIndex + 1}</i>`}</button>
              ${reviewable ? `<button type="button" class="dh-nsa-candidate-review" data-nsa-candidate-review="${i}:${escapeHtml(candidate.id || '')}">重新验证</button>` : ''}
              ${accepted && (!selected || confirmRetained) ? `<button type="button" class="dh-nsa-candidate-use" data-nsa-candidate-use="${i}:${escapeHtml(candidate.id || '')}">${confirmRetained ? '确认沿用旧版' : '\u9009\u7528'}</button>` : ((!accepted || needsHumanRebind) && candidateUrl ? `<button type="button" class="dh-nsa-candidate-override" data-nsa-candidate-override="${i}:${escapeHtml(candidate.id || '')}">${needsHumanRebind ? '人工确认沿用' : '人工确认采用'}</button>` : `<em>${manualCandidate ? '人工已采用' : (selected ? '\u5df2\u9009' : '\u672a\u901a\u8fc7')}</em>`)}
            </span>`;
          }).join('')}</div></div>`
        : '';
      return `<article class="dh-nsa-frame-card" style="--dh-nsa-frame-ratio:${frameRatio}">
        <header class="dh-nsa-frame-head">
          <div class="dh-nsa-frame-identity">
            <span class="dh-nsa-shot-number" aria-label="第 ${i + 1} 镜">${String(i + 1).padStart(2, '0')}</span>
            <div class="dh-nsa-frame-title"><b title="${escapeHtml(title)}">${escapeHtml(title)}</b><small>${escapeHtml(headerSummary)}</small></div>
          </div>
          <div class="dh-nsa-frame-head-meta">
            <label class="dh-nsa-duration" title="镜头时长"><input type="number" min="1" max="15" step="1" value="${escapeHtml(duration || 3)}" aria-label="第 ${i + 1} 镜时长" data-nsa-shot-index="${i}" data-nsa-shot-field="duration"><em>秒</em></label>
            <span class="dh-nsa-qa-badge is-${qaState}" title="${escapeHtml(qaDetail)}">分镜图：${escapeHtml(qaLabel)}</span>
            <span class="dh-nsa-video-status-badge is-${escapeHtml(videoView.tone)}" title="${escapeHtml(videoView.status.error || videoView.label)}">${escapeHtml(videoView.label)}</span>
          </div>
        </header>
        ${showStatusNotice ? `<div class="dh-nsa-frame-status-note"><span>${escapeHtml(qaDetail)}</span>${reviewableCandidate ? `<button type="button" data-nsa-candidate-review="${i}:${escapeHtml(reviewableCandidate.id || '')}">重新验证此图</button>` : `<button type="button" data-nsa-shot-regenerate="${i}">重新生成</button>`}</div>` : ''}
        <div class="dh-nsa-frame-media">
          ${shotVideoReady ? `<section class="dh-nsa-shot-video-result ${shotVideoState}">
            <div><b>本镜视频</b><span>${shotVideoLabel}</span></div>
            <video src="${escapeHtml(withAuthQuery(shotVideoUrl))}" ${shotVideoPoster ? `poster="${escapeHtml(shotVideoPoster)}"` : ''} controls playsinline preload="none"></video>
          </section>` : (window.NewStoryAdKeyframes?.previewButtonHtml ? window.NewStoryAdKeyframes.previewButtonHtml({ frame, shot, index: i, previewUrl: preview, imageUrl: image ? withAuthQuery(image) : '', escapeHtml }) : `<button type="button" class="dh-nsa-frame-preview ${preview ? '' : 'pending'}" ${preview ? `data-nsa-frame-preview="${i}" title="\u70b9\u51fb\u67e5\u770b\u7b2c ${i + 1} \u955c\u5927\u56fe"` : 'disabled'}>
            ${preview ? `<img src="${escapeHtml(preview)}" alt="${escapeHtml(title)}" loading="lazy" decoding="async">` : `<span>${String(i + 1).padStart(2, '0')}</span>`}
            <b>${String(i + 1).padStart(2, '0')} \u00b7 ${escapeHtml(title)}</b>
            <small>${preview ? '\u70b9\u51fb\u67e5\u770b\u5927\u56fe' : '\u7b49\u5f85\u751f\u6210\u5173\u952e\u5e27'}</small>
          </button>`)}
          ${candidateStrip}
        </div>
        ${videoFailure ? `<div class="dh-nsa-video-failure-detail ${videoFailure.notSubmitted ? 'is-not-submitted' : ''}">
          <b>${escapeHtml(videoFailure.title)}</b>
          <span>${escapeHtml(videoFailure.text)}</span>
          ${videoFailure.code ? `<small>状态码：${escapeHtml(videoFailure.code)}</small>` : ''}
        </div>` : ''}
        <div class="dh-nsa-frame-editor">
          <div class="dh-nsa-frame-summary">
            <section><b>镜头 / 构图</b><span>${escapeHtml(cameraSummary)}</span></section>
            <section><b>场景 / 连续性</b><span>${escapeHtml(sceneSummary)}</span></section>
            <section class="is-wide"><b>画面</b><span>${escapeHtml(visualSummary)}</span></section>
            <section><b>动作</b><span>${escapeHtml(actionSummary)}</span></section>
            <section><b>台词 / 声音</b><span>${escapeHtml(voiceoverSummary)}${soundSummary ? `<small>${escapeHtml(soundSummary)}</small>` : ''}</span></section>
            ${effectSummary ? `<section class="is-wide"><b>表面结构 / 动态效果</b><span>${escapeHtml(effectSummary)}</span></section>` : ''}
          </div>
          ${frame.regeneration_error ? `<p class="dh-nsa-frame-warning"><b>${escapeHtml(window.NewStoryAdKeyframes?.isQaInfrastructureError?.(frame.regeneration_error, frame.regeneration_error_code) ? '本轮视觉审核服务异常，当前仍显示上一版画面。' : '新版本未通过，当前仍显示上一版画面。')}</b>${escapeHtml(window.NewStoryAdKeyframes?.friendlyError ? window.NewStoryAdKeyframes.friendlyError(frame.regeneration_error, frame.regeneration_error_code) : frame.regeneration_error)}</p>` : ''}
          ${(frame.error || (frame.image_url && !image)) ? `<p class="dh-nsa-frame-error">${escapeHtml(window.NewStoryAdKeyframes?.friendlyError ? window.NewStoryAdKeyframes.friendlyError(frame.error || '关键帧图片地址已失效，请重新生成本镜头。', frame.error_code) : (frame.error || '关键帧图片地址已失效，请重新生成本镜头。'))}</p>` : ''}
          <div class="dh-nsa-frame-settings" data-nsa-shot-editor="${i}" hidden>
            <div class="dh-nsa-frame-settings-grid">
              ${window.NewStoryAdStoryboard?.bindingHtml ? window.NewStoryAdStoryboard.bindingHtml({ shot, index: i, sceneAssets: state.sceneAssets || [], escapeHtml }) : ''}
              <section class="dh-nsa-editor-section dh-nsa-editor-basic">
                <div class="dh-nsa-editor-section-head"><b>画面、动作与台词</b><small>这里决定本镜实际要拍什么，是重新生成时优先级最高的内容。</small></div>
                <label class="dh-nsa-visual-field">
                  <span class="dh-nsa-visual-field-title"><b>完整画面说明</b><small>人物/商品、环境、位置、材质、光线和画面关系</small></span>
                  <textarea class="dh-input dh-nsa-visual-editor" rows="6" data-nsa-shot-index="${i}" data-nsa-shot-field="visual">${escapeHtml(shotFieldValue(shot, contract, 'visual'))}</textarea>
                </label>
                <div class="dh-nsa-editor-section-fields">
                  <label><span>镜头动作</span><textarea class="dh-input" rows="3" data-nsa-shot-index="${i}" data-nsa-shot-field="action">${escapeHtml(shotFieldValue(shot, contract, 'action'))}</textarea></label>
                  <label><span>台词 / 旁白</span><textarea class="dh-input" rows="2" data-nsa-shot-index="${i}" data-nsa-shot-field="voiceover">${escapeHtml(shotFieldValue(shot, contract, 'voiceover') || dialogue)}</textarea></label>
                  <label class="is-wide"><span>本镜目的 / 补充</span><textarea class="dh-input" rows="2" data-nsa-shot-index="${i}" data-nsa-shot-field="purpose">${escapeHtml(shotFieldValue(shot, contract, 'purpose'))}</textarea></label>
                </div>
              </section>
          <details class="dh-nsa-shot-design-editor">
            <summary>本镜表面结构与动态效果</summary>
            <p class="dh-nsa-shot-design-help">用于说明本镜中的表面是连续、分段还是样品对比，以及画面内是否发生粒子汇聚、淡入等变化。不确定时保持“按任务判断”或“无”。这些设置只作用于本镜，不会反向定义其它镜头。</p>
            <div class="dh-nsa-editor-section-fields">
            <label><span>镜头作用域</span><select class="dh-input" data-nsa-shot-index="${i}" data-nsa-shot-field="shot_scope">
              ${[['auto','按任务判断'],['environment','环境镜头'],['product_comparison','产品/样品对比'],['character','人物镜头'],['brand_endcard','品牌收尾']].map(([value,label]) => `<option value="${value}" ${String(shot.shot_scope || 'auto') === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select></label>
            <label><span>主表面结构</span><select class="dh-input" data-nsa-shot-index="${i}" data-nsa-shot-field="surface_topology.mode">
              ${[['auto','按任务判断'],['continuous','连续完整表面'],['segmented','明确分段表面'],['modular','模块化结构']].map(([value,label]) => `<option value="${value}" ${String(shot.surface_topology?.mode || 'auto') === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select></label>
            <label><span>拼缝策略</span><select class="dh-input" data-nsa-shot-index="${i}" data-nsa-shot-field="surface_topology.seam_policy">
              ${[['auto','按任务判断'],['hidden','隐藏可见拼缝'],['visible','明确显示拼缝'],['task_defined','仅显示任务指定拼缝']].map(([value,label]) => `<option value="${value}" ${String(shot.surface_topology?.seam_policy || 'auto') === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select></label>
            <label><span>饰面分布</span><select class="dh-input" data-nsa-shot-index="${i}" data-nsa-shot-field="surface_topology.finish_distribution">
              ${[['auto','按任务判断'],['uniform','统一饰面'],['gradient','连续渐变'],['regional','连续基面上的局部变化'],['sample_comparison','样品对比']].map(([value,label]) => `<option value="${value}" ${String(shot.surface_topology?.finish_distribution || 'auto') === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select></label>
            <label class="is-wide"><span>表面结构补充</span><textarea class="dh-input" rows="2" data-nsa-shot-index="${i}" data-nsa-shot-field="surface_topology.notes">${escapeHtml(shotFieldValue(shot, contract, 'surface_topology.notes'))}</textarea></label>
            <label><span>动态效果</span><select class="dh-input" data-nsa-shot-index="${i}" data-nsa-shot-field="motion_effect.type">
              ${[['none','无'],['particle_assembly','粒子/流沙汇聚'],['fade','淡入'],['dissolve','溶解'],['material_flow','材质流动'],['custom','自定义效果']].map(([value,label]) => `<option value="${value}" ${String(shot.motion_effect?.type || 'none') === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select></label>
            <label><span>效果强度</span><select class="dh-input" data-nsa-shot-index="${i}" data-nsa-shot-field="motion_effect.intensity">
              ${[['low','轻'],['medium','中'],['high','强']].map(([value,label]) => `<option value="${value}" ${String(shot.motion_effect?.intensity || 'medium') === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select></label>
            <label><span>起始状态</span><textarea class="dh-input" rows="2" data-nsa-shot-index="${i}" data-nsa-shot-field="motion_effect.source_state">${escapeHtml(shotFieldValue(shot, contract, 'motion_effect.source_state'))}</textarea></label>
            <label><span>目标状态</span><textarea class="dh-input" rows="2" data-nsa-shot-index="${i}" data-nsa-shot-field="motion_effect.target_state">${escapeHtml(shotFieldValue(shot, contract, 'motion_effect.target_state'))}</textarea></label>
            <label class="is-wide"><span>时间轴</span><textarea class="dh-input" rows="2" placeholder="例如：0-1 秒保持；1-3.5 秒汇聚；3.5-4.5 秒成形；最后稳定" data-nsa-shot-index="${i}" data-nsa-shot-field="motion_effect.timeline">${escapeHtml(shotFieldValue(shot, contract, 'motion_effect.timeline'))}</textarea></label>
            <label><span>目标参考素材 ID（可选）</span><input class="dh-input" value="${escapeHtml(shotFieldValue(shot, contract, 'motion_effect.reference_asset_id'))}" data-nsa-shot-index="${i}" data-nsa-shot-field="motion_effect.reference_asset_id"></label>
            <label class="dh-nsa-inline-check"><input type="checkbox" ${shot.motion_effect?.preserve_scene_geometry !== false ? 'checked' : ''} data-nsa-shot-index="${i}" data-nsa-shot-field="motion_effect.preserve_scene_geometry"><span>效果过程中保持场景几何不变</span></label>
            <label class="is-wide"><span>效果补充</span><textarea class="dh-input" rows="2" data-nsa-shot-index="${i}" data-nsa-shot-field="motion_effect.notes">${escapeHtml(shotFieldValue(shot, contract, 'motion_effect.notes'))}</textarea></label>
            </div>
          </details>
          <details class="dh-nsa-continuity-editor">
            <summary>镜头语言与前后镜连续性</summary>
            <p class="dh-nsa-shot-design-help">景别、焦段和构图控制怎么拍；入镜/出镜状态、运动方向和道具状态用于衔接前后镜。不熟悉摄影参数时可保持默认，让 AI 按镜头目的判断。</p>
            <div class="dh-nsa-editor-section-fields">
            <label><span>景别</span><select class="dh-input" data-nsa-shot-index="${i}" data-nsa-shot-field="shot_size">${['','extreme_wide','wide','full','medium','medium_close','close_up','extreme_close_up','macro'].map(value => `<option value="${value}" ${String(shot.shot_size || '') === value ? 'selected' : ''}>${value ? technicalLabel(value) : '按镜头目的判断'}</option>`).join('')}</select></label>
            <label><span>机位角度</span><select class="dh-input" data-nsa-shot-index="${i}" data-nsa-shot-field="camera_angle">${['','eye_level','high_angle','low_angle','overhead','dutch','over_shoulder','pov'].map(value => `<option value="${value}" ${String(shot.camera_angle || '') === value ? 'selected' : ''}>${value ? technicalLabel(value) : '按镜头目的判断'}</option>`).join('')}</select></label>
            <label><span>焦段（mm）</span><input class="dh-input" type="number" min="0" max="300" step="1" value="${escapeHtml(shotFieldValue(shot, contract, 'lens_mm'))}" placeholder="如 24 / 35 / 50 / 85" data-nsa-shot-index="${i}" data-nsa-shot-field="lens_mm"></label>
            <label><span>景深</span><select class="dh-input" data-nsa-shot-index="${i}" data-nsa-shot-field="depth_of_field">${['','deep','medium','shallow','ultra_shallow'].map(value => `<option value="${value}" ${String(shot.depth_of_field || '') === value ? 'selected' : ''}>${value ? technicalLabel(value) : '按镜头目的判断'}</option>`).join('')}</select></label>
            <label><span>构图</span><input class="dh-input" value="${escapeHtml(shotFieldValue(shot, contract, 'composition'))}" data-nsa-shot-index="${i}" data-nsa-shot-field="composition"></label>
            <label><span>主体位置</span><input class="dh-input" value="${escapeHtml(shotFieldValue(shot, contract, 'subject_position'))}" data-nsa-shot-index="${i}" data-nsa-shot-field="subject_position"></label>
            <label><span>镜头运动</span><input class="dh-input" value="${escapeHtml(shotFieldValue(shot, contract, 'camera_movement'))}" data-nsa-shot-index="${i}" data-nsa-shot-field="camera_movement"></label>
            <label><span>入镜状态</span><textarea class="dh-input" rows="2" data-nsa-shot-index="${i}" data-nsa-shot-field="entry_frame_state">${escapeHtml(shotFieldValue(shot, contract, 'entry_frame_state'))}</textarea></label>
            <label><span>出镜状态</span><textarea class="dh-input" rows="2" data-nsa-shot-index="${i}" data-nsa-shot-field="exit_frame_state">${escapeHtml(shotFieldValue(shot, contract, 'exit_frame_state'))}</textarea></label>
            <label><span>运动方向</span><input class="dh-input" value="${escapeHtml(shotFieldValue(shot, contract, 'screen_direction'))}" data-nsa-shot-index="${i}" data-nsa-shot-field="screen_direction"></label>
            <label><span>人物视线</span><input class="dh-input" value="${escapeHtml(shotFieldValue(shot, contract, 'eyeline'))}" data-nsa-shot-index="${i}" data-nsa-shot-field="eyeline"></label>
            <label><span>摄影轴线</span><input class="dh-input" value="${escapeHtml(shotFieldValue(shot, contract, 'camera_axis'))}" data-nsa-shot-index="${i}" data-nsa-shot-field="camera_axis"></label>
            <label><span>产品与道具状态</span><input class="dh-input" value="${escapeHtml(shotFieldValue(shot, contract, 'object_states'))}" data-nsa-shot-index="${i}" data-nsa-shot-field="object_states"></label>
            <label><span>转场类型</span><select class="dh-input" data-nsa-shot-index="${i}" data-nsa-shot-field="transition_type">
              ${['none','hard_cut','cut_on_action','match_cut','dissolve','fade'].map(value => `<option value="${value}" ${String(shot.transition_type || '') === value ? 'selected' : ''}>${technicalLabel(value)}</option>`).join('')}
            </select></label>
            <label><span>转场原因</span><input class="dh-input" value="${escapeHtml(shotFieldValue(shot, contract, 'transition_reason'))}" data-nsa-shot-index="${i}" data-nsa-shot-field="transition_reason"></label>
            <label><span>环境声</span><input class="dh-input" value="${escapeHtml(shotFieldValue(shot, contract, 'ambient_sound'))}" data-nsa-shot-index="${i}" data-nsa-shot-field="ambient_sound"></label>
            <label><span>动作 / 物体音效</span><input class="dh-input" value="${escapeHtml(shotFieldValue(shot, contract, 'sfx'))}" data-nsa-shot-index="${i}" data-nsa-shot-field="sfx"></label>
            <label><span>音乐节点</span><input class="dh-input" value="${escapeHtml(shotFieldValue(shot, contract, 'music_cue'))}" data-nsa-shot-index="${i}" data-nsa-shot-field="music_cue"></label>
            <label><span>旁白与动作时机</span><input class="dh-input" value="${escapeHtml(shotFieldValue(shot, contract, 'voiceover_timing'))}" data-nsa-shot-index="${i}" data-nsa-shot-field="voiceover_timing"></label>
            <label><span>跨镜声音桥</span><input class="dh-input" value="${escapeHtml(shotFieldValue(shot, contract, 'audio_bridge'))}" data-nsa-shot-index="${i}" data-nsa-shot-field="audio_bridge"></label>
            </div>
              </details>
              ${contract.subject_strategy ? `<details class="dh-nsa-frame-contract"><summary>查看生成约束</summary><p>${escapeHtml(contract.subject_strategy)}</p></details>` : ''}
              ${shot._prompt_preview ? `<details class="dh-nsa-prompt-preview" open><summary>最终生成提示词（仅预览，未生成媒体）</summary><b>关键帧提示词</b><pre>${escapeHtml(shot._prompt_preview.keyframe_prompt || '')}</pre><b>视频动作提示词</b><pre>${escapeHtml(shot._prompt_preview.motion_prompt || '')}</pre></details>` : ''}
            </div>
          </div>
          <div class="dh-nsa-frame-actions">
            <button type="button" class="dh-luxgen-edit" data-nsa-shot-edit="${i}">编辑</button>
            <button type="button" class="dh-luxgen-edit" data-nsa-prompt-preview="${i}">${shot._prompt_preview ? '刷新提示词预览' : '查看生成提示词'}</button>
            <button type="button" class="dh-luxgen-edit" data-nsa-shot-regenerate="${i}">重新生成分镜图</button>
            ${preview ? `<button type="button" class="dh-luxgen-edit" data-nsa-frame-preview="${i}">分镜图</button>` : ''}
            ${shotVideoReady ? `<button type="button" class="dh-luxgen-edit" data-nsa-video-regenerate="${i}">${shotVideoIsContinuousBlock ? '重做连续镜组视频' : '仅重做本镜视频'}</button>` : ''}
            ${shotVideoQaFailed ? `<button type="button" class="dh-luxgen-edit" data-nsa-video-accept="${i}">接受当前视频</button>` : ''}
          </div>
        </div>
      </article>`;
    }).join('')}</div>`;
  }

  function ensureMediaHost() {
    let host = within('#dhNsaAdMediaResult');
    if (host) return host;
    const panel = root()?.querySelector('.dh-luxgen-stage[data-panel="5"] .dh-demo-canvas') || root();
    host = document.createElement('div');
    host.id = 'dhNsaAdMediaResult';
    host.className = 'dh-task-create-panel';
    panel?.appendChild(host);
    return host;
  }

  function videoFailureDetails(clips = []) {
    return (Array.isArray(clips) ? clips : []).map((clip, index) => {
      if (!clip || (!clip.error_code && clip.qa?.pass !== false && clip.cross_shot_qa?.pass !== false)) return null;
      const labels = [
        ...(Array.isArray(clip.qa?.failure_labels_zh) ? clip.qa.failure_labels_zh : []),
        ...(Array.isArray(clip.cross_shot_qa?.failure_labels_zh) ? clip.cross_shot_qa.failure_labels_zh : []),
      ];
      const problems = [
        ...(Array.isArray(clip.qa?.problems) ? clip.qa.problems : []),
        ...(Array.isArray(clip.cross_shot_qa?.problems) ? clip.cross_shot_qa.problems : []),
      ];
      return {
        index: index + 1,
        title: state.shots?.[index]?.title || `镜头 ${index + 1}`,
        reason: [...new Set(labels.concat(problems))].filter(Boolean).join('；') || clip.error || '当前版本视频审核未通过',
        attempt: Number(clip.repair_attempt || 0),
      };
    }).filter(Boolean);
  }

  function renderMedia() {
    const voiceSummary = within('#dhNsaAdVoiceSummary');
    const subtitleSummary = within('#dhNsaAdSubtitleSummary');
    if (voiceSummary) {
      const tracks = Array.isArray(state.ttsAudio?.tracks) ? state.ttsAudio.tracks : [];
      voiceSummary.textContent = tracks.length ? `已生成 ${tracks.length} 条音频` : '自动配音';
    }
    if (subtitleSummary) subtitleSummary.textContent = '跟随新分镜对白生成';
    if (subtitleSummary) {
      const styleLabel = subtitleStyleLabel(state.subtitleStyle || 'popup');
      subtitleSummary.textContent = state.subtitleEnabled ? `已开启 · ${styleLabel}` : '不生成字幕';
    }
    const host = ensureMediaHost();
    const tracks = Array.isArray(state.ttsAudio?.tracks) ? state.ttsAudio.tracks : [];
    const clips = Array.isArray(state.videoClips) ? state.videoClips : [];
    const continuousBlocks = [...new Set(clips.filter(clip => Array.isArray(clip?.scene_block_members) && clip.scene_block_members.length > 1).map(clip => clip.scene_block_id).filter(Boolean))];
    const finalUrl = state.finalVideo?.video_url || state.finalVideo?.videoUrl || '';
    const videoProgress = state.generationProgress?.stage === 'video' || state.generationProgress?.stage === 'compose'
      ? state.generationProgress
      : null;
    const totalVideoShots = Math.max(Number(videoProgress?.total || 0), state.shots.length, clips.length);
    const qaApprovedFromClips = clips.filter(clip => clip
      && (clip.video_url || clip.videoUrl || clip.file_path)
      && !clip.error_code
      && clip.qa?.pass === true
      && clip.cross_shot_qa?.pass !== false).length;
    const approvedVideoShots = Math.max(0, Math.min(totalVideoShots, Number(videoProgress?.qa_passed ?? qaApprovedFromClips) || 0));
    const generatedVideoShots = Math.max(approvedVideoShots, Math.min(totalVideoShots, Number(videoProgress?.generated ?? 0) || 0));
    const failedVideoShots = Math.max(0, Math.min(totalVideoShots, Number(videoProgress?.failed ?? Math.max(0, totalVideoShots - approvedVideoShots)) || 0));
    const mediaActive = !!state.activeGenerationId
      || state.stageProgress?.active === true
      || (state.taskStatus === 'running' && ['video', 'video_repair', 'compose', 'media'].includes(String(state.taskStage || state.activeStage || '')));
    const mediaFailed = !mediaActive && state.taskStatus === 'failed';
    const failureDetails = videoFailureDetails(clips);
    const compose = composeReadiness();
    const composeSummary = within('#dhNsaAdComposeSummary');
    const progressHint = within('#dhNsaAdProgressHint');
    const gate = within('#dhNsaAdComposeGate');
    const restoreFailed = !!state.restoreError && (!Array.isArray(state.shots) || !state.shots.length);
    const restoring = !restoreFailed && state.restoringTask && (!Array.isArray(state.shots) || !state.shots.length);
    if (composeSummary) {
      composeSummary.textContent = restoreFailed
        ? '任务内容读取失败'
        : (restoring
        ? '正在恢复任务数据'
        : (compose.total
        ? `${compose.passed}/${compose.total} 镜当前版本审核通过`
        : '尚未生成真实分镜'));
    }
    if (progressHint) {
      progressHint.textContent = restoreFailed
        ? state.restoreError
        : (restoring
        ? '正在读取已确认的分镜和关键帧，请稍候'
        : (compose.ready
        ? '分镜视频已全部通过；本步骤只生成可选配音、字幕、音乐并拼接最终成片'
        : compose.message));
    }
    if (gate) {
      const failed = mediaFailed && state.taskError;
      gate.hidden = !restoreFailed && !restoring && compose.ready && !failed;
      gate.className = `dh-nsa-compose-gate ${restoring ? 'is-loading' : ((restoreFailed || failed) ? 'is-error' : 'is-warning')}`;
      gate.innerHTML = restoreFailed
        ? `<b>任务内容读取失败</b><span>${escapeHtml(state.restoreError)}。请返回任务中心刷新；普通用户只能继续制作自己的任务。</span>`
        : (restoring
        ? '<b>正在恢复任务</b><span>已确认的分镜和真实关键帧正在载入，请勿重新生成。</span>'
        : (failed
        ? `<b>本次合成未完成</b><span>${escapeHtml(state.taskError)}</span><span>分镜视频不会在本步骤重新生成；请检查配音、字幕、音乐或拼接设置后重试。</span><button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-nsa-return-keyframes>查看分镜视频</button>`
        : `<b>暂不能合成</b><span>${escapeHtml(compose.message || '请先完成全部分镜视频审核')}</span><button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-nsa-return-keyframes>返回分镜处理</button>`));
    }
    if (!tracks.length && !clips.length && !finalUrl) {
      host.innerHTML = '<div class="dh-task-empty-note">分镜视频已在第 4 步确认；这里尚未生成最终成片。</div>';
      return;
    }
    host.innerHTML = `<div class="dh-task-create-section dh-task-create-section-wide">
      <div class="dh-task-detail-title">媒体生成结果</div>
      <div class="dh-nsa-media-result-state ${finalUrl ? 'is-success' : (mediaFailed ? 'is-failed' : (mediaActive ? 'is-running' : 'is-incomplete'))}" data-nsa-media-result-state>
        <b>${finalUrl ? '成片合成成功' : (mediaFailed ? '本次合成失败' : (mediaActive ? '正在生成媒体' : '最终成片尚未生成'))}</b>
        <span>${finalUrl
          ? '最终成片已生成，可以直接播放。'
          : (mediaFailed
            ? `最终成片没有生成，因此这里不会出现成片播放器。${state.taskError ? `失败原因：${escapeHtml(state.taskError)}` : ''}`
            : (mediaActive ? '后台仍在处理镜头或最终封装，请等待真实状态更新。' : '当前只有中间片段记录，不代表最终成片成功。'))}</span>
        ${mediaFailed && state.taskErrorCode ? `<em>错误代码：${escapeHtml(state.taskErrorCode)}</em>` : ''}
      </div>
      ${finalUrl ? `<video class="dh-task-detail-preview-video" src="${escapeHtml(finalUrl)}" controls playsinline></video>` : ''}
      <div class="dh-task-detail-value">${escapeHtml([
        tracks.length ? `配音 ${tracks.length} 条` : '',
        totalVideoShots ? `有效镜头 ${approvedVideoShots}/${totalVideoShots}` : '',
        generatedVideoShots > approvedVideoShots ? `已落地待审核 ${generatedVideoShots - approvedVideoShots}` : '',
        failedVideoShots ? `未通过 ${failedVideoShots}` : '',
        continuousBlocks.length ? `连续场景段 ${continuousBlocks.length} 组` : '',
        finalUrl ? '最终成片已生成' : '最终成片未生成',
      ].filter(Boolean).join(' · ') || '等待生成')}</div>
      ${mediaFailed && failureDetails.length ? `<div class="dh-nsa-media-failure-list">${failureDetails.map(item => `<div><b>第 ${item.index} 镜${item.title ? `「${escapeHtml(item.title)}」` : ''}</b><span>${escapeHtml(item.reason)}${item.attempt ? `（已自动修复 ${item.attempt} 次）` : ''}</span></div>`).join('')}</div>` : ''}
    </div>`;
  }

  function syncPersonSpecControls() {
    const lock = state.personSpecLock || null;
    const generating = !!state.personGenerationProgress?.active;
    const noHuman = isNoHumanMode();
    within('#dhNsaAdPostScriptPerson')?.classList.toggle('is-no-human', noHuman);
    $$('[data-nsa-cast-mode-quick]', root()).forEach(button => {
      const active = button.dataset.nsaCastModeQuick === personSpec('castMode');
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.disabled = generating;
    });
    $$('[data-nsa-person-spec]', root()).forEach(el => {
      const field = el.dataset.nsaPersonSpec;
      const locked = !!(lock && ['gender', 'age', 'origin'].includes(field) && (field !== 'origin' || lock.origin) && (field !== 'age' || lock.age));
      el.disabled = generating || (noHuman && field !== 'castMode') || locked;
      el.title = generating
        ? '正在生成拟真演员，人物设定暂时锁定。'
        : (noHuman && field !== 'castMode'
          ? '无人物模式下不会使用人物设定。'
          : (locked ? `已按人物一致性参考「${lock.source || '演员'}」锁定；如需更改，请重新选择或上传真人参考。` : ''));
    });
  }

  function renderStatus() {
    const badge = within('#dhNsaAdRequirementState');
    if (badge) {
      badge.textContent = state.taskId ? `任务 ${String(state.taskId).slice(0, 8)}` : '待创建';
      badge.className = 'dh-luxgen-badge';
    }
    const stateBadge = within('#dhNsaAdFrameState');
    if (stateBadge) {
      const kf = keyframeStatus();
      const parts = [
        `当前版本通过 ${kf.fresh_pass || 0}/${kf.total}`,
        kf.retained_previous ? `保留旧版 ${kf.retained_previous}` : '',
        kf.outdated ? `旧版待验证 ${kf.outdated}` : '',
        kf.failed ? `生成失败 ${kf.failed}` : '',
        Math.max(0, Number(kf.missing || 0) - Number(kf.failed || 0)) ? `尚缺 ${Math.max(0, Number(kf.missing || 0) - Number(kf.failed || 0))}` : '',
      ].filter(Boolean);
      stateBadge.textContent = kf.total
        ? parts.join(' · ')
        : (state.shots.length ? `已生成 ${state.shots.length} 镜分镜` : '待生成');
    }
    const fillMissing = within('#dhNsaAdFillMissingFramesTop');
    if (fillMissing) {
      const kf = keyframeStatus();
      fillMissing.hidden = !(kf.total && kf.needs_regeneration > 0);
      fillMissing.textContent = kf.needs_regeneration > 0 ? `补齐或修复镜头（${kf.needs_regeneration}）` : '补齐或修复镜头';
    }
    showStep(state.currentStep);
    syncPersonSpecControls();
    updateLocks();
  }

  function renderSceneAssets() {
    if (window.NewStoryAdSceneAssets?.render) {
      window.NewStoryAdSceneAssets.render({
        host: within('#dhNsaAdSceneAssetCurrent'),
        state,
      });
    }
  }

  function renderAll() {
    syncOptionControls();
    renderAdvancedControls();
    renderAssets();
    renderPerson();
    renderSceneAssets();
    renderAudio();
    renderScene();
    renderBlueprint();
    renderStoryboard();
    renderMedia();
    renderStatus();
    renderAutoSaveStatus();
  }

  async function ensureTask() {
    if (window.NewStoryAdTaskPersistence?.ensureTask) {
      return window.NewStoryAdTaskPersistence.ensureTask({
        state,
        payload,
        api,
        rememberTaskId,
        renderStatus,
      });
    }
    if (state.taskId) return state.taskId;
    const body = payload();
    if (body.brief.length < 8) throw new Error('请先填写至少 8 个字的广告需求');
    const created = await api('/api/new-story-ad/tasks', { method: 'POST', body });
    state.taskId = created.task?.id || created.task_id || created.taskId || '';
    state.context = created.context || null;
    rememberTaskId(state.taskId);
    renderStatus();
    return state.taskId;
  }

  async function saveCurrentTaskProgress(opts = {}) {
    if (window.NewStoryAdTaskPersistence?.saveCurrentTaskProgress) {
      return window.NewStoryAdTaskPersistence.saveCurrentTaskProgress(opts, {
        state,
        payload,
        api,
        rememberTaskId,
        renderStatus,
        renderAll,
        toast,
        normalizeBundle,
        normalizeBlueprintForSave,
        normalizeSpeechText,
        saveSceneAssetsProgress,
      });
    }
    const id = await ensureTask();
    let progressStage = 'draft';
    if (state.sceneConfig) progressStage = 'scene_config_done';
    if (state.blueprint) progressStage = 'blueprint_done';
    if (Array.isArray(state.shots) && state.shots.length) progressStage = 'keyframe_contract_ready';
    if (Array.isArray(state.keyframes) && state.keyframes.some(frame => frame && (frame.image_url || frame.imageUrl || frame.url))) progressStage = 'keyframes_ready';
    if (Array.isArray(state.ttsAudio?.tracks) && state.ttsAudio.tracks.length) progressStage = 'tts_ready';
    if (Array.isArray(state.videoClips) && state.videoClips.some(clip => clip?.video_url || clip?.videoUrl || clip?.file_path)) progressStage = 'video_ready';
    if (state.finalVideo?.video_url || state.finalVideo?.videoUrl) progressStage = 'final_video_ready';
    const sceneAssets = window.NewStoryAdSceneAssets?.payload?.(state) || state.sceneAssets || [];
    const r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: {
        ...payload(),
        task_id: id,
        save_progress: true,
        progress_stage: progressStage,
        progress_snapshot: {
          context: state.context || null,
          scene_config: state.sceneConfig || null,
          blueprint: state.blueprint ? normalizeBlueprintForSave() : null,
          storyboard_table: Array.isArray(state.shots) ? state.shots : [],
          keyframe_contracts: Array.isArray(state.contracts) ? state.contracts : [],
          keyframes: Array.isArray(state.keyframes) ? state.keyframes : [],
          scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [],
          quality_review: state.review || null,
          tts_audio: state.ttsAudio || null,
          video_clips: Array.isArray(state.videoClips) ? state.videoClips : [],
          final_video: state.finalVideo || null,
        },
      },
    });
    state.pendingChangeScope = 'none';
    normalizeBundle(r);
    if (typeof window.__dhRefreshNewStoryAdTasks === 'function') {
      window.__dhRefreshNewStoryAdTasks().catch(() => {});
    }
    renderAll();
    if (opts.silent !== true) toast('剧情广告任务已保存，可在任务中心继续制作', 'success');
    return id;
  }

  function renderAutoSaveStatus() {
    const status = state.autoSaveStatus || 'idle';
    const text = state.autoSaveMessage || '自动保存已开启';
    $$('[data-nsa-autosave-status], [data-nsa-shot-autosave-status]', document).forEach(el => {
      el.className = `dh-nsa-autosave-status is-${status}`;
      el.textContent = text;
      el.setAttribute('aria-live', 'polite');
      el.hidden = status !== 'error';
    });
  }

  function setAutoSaveStatus(status = 'idle', message = '') {
    state.autoSaveStatus = status;
    state.autoSaveMessage = message || ({
      idle: '自动保存已开启',
      pending: '有更改，等待自动保存…',
      saving: '正在自动保存…',
      saved: '已自动保存',
      error: '自动保存失败',
    }[status] || '自动保存已开启');
    renderAutoSaveStatus();
  }

  function scheduleAutoSave(reason = 'content_change', options = {}) {
    autoSaveVersion += 1;
    setAutoSaveStatus('pending', '有更改，等待自动保存…');
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    const delay = options.immediate === true ? 0 : AUTO_SAVE_DELAY_MS;
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      flushAutoSave(reason).catch(() => {});
    }, delay);
  }

  async function persistAutoSaveChanges() {
    const id = await ensureTask();
    if (state.blueprintDirty && state.blueprint) {
      await saveBlueprintEdits(id);
      state.storyboardStatus = { ready: false, stale: true, reason: 'BLUEPRINT_EDITED' };
      state.contracts = [];
      state.keyframes = [];
      state.review = null;
      state.ttsAudio = null;
      state.videoClips = [];
      state.finalVideo = null;
      return id;
    }
    if (state.storyboardDirty && Array.isArray(state.shots) && state.shots.length) {
      await saveStoryboardEdits(id);
      state.storyboardDirty = false;
      state.keyframes = [];
      state.review = null;
      state.ttsAudio = null;
      state.videoClips = [];
      state.finalVideo = null;
      return id;
    }
    return saveCurrentTaskProgress({ silent: true, render: false });
  }

  async function flushAutoSave(reason = 'content_change') {
    if (autoSaveInFlight) return false;
    if (state.restoringTask || state.busy || state.activeGenerationId) {
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        autoSaveTimer = null;
        flushAutoSave(reason).catch(() => {});
      }, 1200);
      return false;
    }
    const brief = String(within('#dhNsaAdText')?.value || state.context?.brief || '').trim();
    if (!state.taskId && brief.length < 8) {
      setAutoSaveStatus('pending', '继续填写，满 8 个字后自动保存');
      return false;
    }
    const savingVersion = autoSaveVersion;
    autoSaveInFlight = true;
    setAutoSaveStatus('saving', '正在自动保存…');
    try {
      await persistAutoSaveChanges();
      autoSaveCommittedVersion = savingVersion;
      state.autoSaveLastAt = new Date().toISOString();
      const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setAutoSaveStatus('saved', `已自动保存 · ${time}`);
      renderStatus();
      return true;
    } catch (error) {
      setAutoSaveStatus('error', `自动保存失败：${error.message || '请检查网络后重试'}`);
      toast(`自动保存失败：${error.message || error}`, 'error');
      return false;
    } finally {
      autoSaveInFlight = false;
      if (autoSaveVersion > Math.max(savingVersion, autoSaveCommittedVersion)) scheduleAutoSave('queued_change', { immediate: true });
    }
  }

  async function saveCurrentTaskProgressFromButton(button = null) {
    setButtonBusy(button, true, '保存中...');
    try {
      return await saveCurrentTaskProgress();
    } catch (err) {
      toast(err.message || '保存进度失败', 'error');
      return null;
    } finally {
      setButtonBusy(button, false);
    }
  }

  async function saveSceneAssetsProgress(taskId = state.taskId) {
    if (window.NewStoryAdTaskPersistence?.saveSceneAssetsProgress) {
      return window.NewStoryAdTaskPersistence.saveSceneAssetsProgress(taskId, {
        state,
        api,
        normalizeBundle,
      });
    }
    if (!taskId) return null;
    const sceneAssets = window.NewStoryAdSceneAssets?.payload?.(state) || state.sceneAssets || [];
    const r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/scene-assets`, {
      method: 'PUT',
      body: { scene_assets: sceneAssets },
    });
    normalizeBundle(r);
    if (typeof window.__dhRefreshNewStoryAdTasks === 'function') {
      await window.__dhRefreshNewStoryAdTasks();
    }
    return r;
  }

  async function saveBlueprintEdits(taskId = state.taskId) {
    if (window.NewStoryAdTaskPersistence?.saveBlueprintEdits) {
      return window.NewStoryAdTaskPersistence.saveBlueprintEdits(taskId, {
        state,
        api,
        normalizeBundle,
        normalizeBlueprintForSave,
      });
    }
    if (!state.blueprint || !taskId) return null;
    const blueprint = normalizeBlueprintForSave();
    state.blueprint = blueprint;
    const r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/blueprint`, {
      method: 'PUT',
      body: { blueprint },
    });
    normalizeBundle(r);
    state.blueprintDirty = false;
    return r;
  }

  async function saveStoryboardEdits(taskId = state.taskId) {
    if (window.NewStoryAdTaskPersistence?.saveStoryboardEdits) {
      const response = await window.NewStoryAdTaskPersistence.saveStoryboardEdits(taskId, {
        state,
        api,
        normalizeBundle,
        normalizeSpeechText,
      });
      state.storyboardDirty = false;
      return response;
    }
    if (!taskId || !Array.isArray(state.shots) || !state.shots.length) return null;
    const shots = state.shots.map((shot, index) => {
      const duration = shot.duration || shot.duration_sec || 3;
      const visual = shot.visual || shot.visual_description || shot.content_prompt || '';
      const action = shot.action || shot.visual_action || '';
      const voiceover = normalizeSpeechText(shot.voiceover || shot.narration || shot.ad_copy || shot.subtitle || '');
      const purpose = shot.purpose || shot.objective || shot.role || '';
      const userEditedFields = shot._nsa_user_edited_fields || {};
      const userVisualOverride = shot.user_visual_override === true || userEditedFields.visual === true;
      const editedVisualLock = userVisualOverride
        ? [purpose, visual].filter(Boolean).join('\n')
        : purpose;
      return {
        ...shot,
        _prompt_preview: undefined,
        index: index + 1,
        shot_index: index + 1,
        duration,
        duration_sec: duration,
        visual,
        visual_description: visual,
        content_prompt: visual,
        action,
        visual_action: action,
        voiceover,
        narration: voiceover,
        subtitle: voiceover,
        purpose,
        objective: purpose,
        role: purpose || shot.role || '',
        keyframe_notes: editedVisualLock || shot.keyframe_notes || '',
        material_usage: editedVisualLock || shot.material_usage || '',
        user_visual_override: userVisualOverride,
        _nsa_user_edited_fields: userEditedFields,
        scene_id: shot.scene_id || shot.scene_asset_id || '',
        scene_asset_id: shot.scene_asset_id || shot.scene_id || '',
        scene_name: shot.scene_name || '',
        scene_view: shot.scene_view || '',
        scene_zone: shot.scene_zone || '',
        scene_zone_id: shot.scene_zone_id || shot.zone_ids?.[0] || '',
        scene_zone_label_zh: shot.scene_zone_label_zh || shot.scene_zone || '',
        zone_ids: Array.isArray(shot.zone_ids) ? shot.zone_ids : [],
        anchor_ids: Array.isArray(shot.anchor_ids) ? shot.anchor_ids : [],
        transition_from: shot.transition_from || '',
        transition_reason: shot.transition_reason || '',
      };
    });
    const r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/storyboard`, {
      method: 'PUT',
      body: { shots },
    });
    normalizeBundle(r);
    state.storyboardDirty = false;
    return r;
  }

  async function regenerateSingleKeyframe(index = 0, button = null) {
    const shotNo = Number(index) + 1;
    const label = `\u6b63\u5728\u91cd\u65b0\u751f\u6210\u7b2c ${shotNo} \u955c...`;
    startSingleKeyframeProgress(index, label);
    setBusy(true, label);
    setButtonBusy(button, true, label);
    try {
      const id = await ensureTask();
      await saveStoryboardEdits(id);
      const r = window.NewStoryAdGenerationFlow?.startStage
        ? await window.NewStoryAdGenerationFlow.startStage(id, 'keyframes', { only_index: Number(index) || 0 }, generationFlowContext(button))
        : await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/keyframes`, { method: 'POST', body: { only_index: Number(index) || 0 } });
      normalizeBundle(r);
      renderAll();
      toast(`\u7b2c ${shotNo} \u955c\u5df2\u91cd\u65b0\u751f\u6210`, 'success');
      return true;
    } catch (err) {
      if (err.data) normalizeBundle(err.data);
      renderAll();
      toast(err.message || `\u7b2c ${shotNo} \u955c\u91cd\u65b0\u751f\u6210\u5931\u8d25`, 'error');
      return false;
    } finally {
      setButtonBusy(button, false);
      setBusy(false);
    }
  }

  async function previewSingleShotPrompts(index = 0, button = null) {
    const shotNo = Number(index) + 1;
    setButtonBusy(button, true, '整理提示词...');
    try {
      const id = await ensureTask();
      const shot = syncShotFieldsFromDom(index, host);
      const response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/prompt-preview`, {
        method: 'POST',
        body: { shot_index: Number(index) || 0, shot },
      });
      if (state.shots[index]) state.shots[index]._prompt_preview = response;
      renderStoryboard();
      toast(`第 ${shotNo} 镜提示词已更新预览，没有生成图片或视频`, 'success');
      return response;
    } catch (error) {
      toast(error.message || `第 ${shotNo} 镜提示词预览失败`, 'error');
      return null;
    } finally {
      setButtonBusy(button, false);
    }
  }

  function generationFlowContext(button = null) {
    return {
      button,
      state,
      api,
      payload,
      ensureTask,
      normalizeBundle,
      renderAll,
      toast,
      showStep,
      saveBlueprintEdits,
      saveStoryboardEdits,
      startStageProgress,
      setBusy,
      setButtonBusy,
      mediaStagePayload,
      getBriefInput: () => within('#dhNsaAdText'),
    };
  }

  function mediaStagePayload() {
    return {
      voice_id: state.voiceId || '',
      voice_name: state.voiceName || '',
      include_voiceover: !!state.voiceId,
      auto_tts: !!state.voiceId,
      voice_volume: state.voiceVolume,
      bgm_volume: state.bgmVolume,
      bgm_profile: state.bgmProfile || 'auto',
      bgm_asset: state.bgmAsset || null,
      subtitle: state.subtitleEnabled,
      subtitle_style: state.subtitleStyle || 'popup',
      subtitle_config: {
        show: state.subtitleEnabled,
        style: state.subtitleStyle || 'popup',
        ...(state.subtitleOptions || {}),
      },
    };
  }

  function visualVideoStagePayload(button = null) {
    const regenerateAll = button?.id === 'dhNsaAdRegenerateAllShotVideos';
    const singleIndex = button?.dataset?.nsaVideoRegenerate === undefined ? null : Number(button.dataset.nsaVideoRegenerate);
    return {
      ...mediaStagePayload(),
      include_voiceover: false,
      auto_tts: false,
      visual_only: true,
      missing_only: !regenerateAll,
      force_regenerate_all: regenerateAll,
      ...(Number.isInteger(singleIndex) ? { only_indexes: [singleIndex], force_regenerate_indexes: [singleIndex] } : {}),
      auto_repair: false,
      max_auto_repairs: 0,
    };
  }

  async function runStage(stage, button) {
    if (window.NewStoryAdGenerationFlow?.runStage) {
      try {
        return await window.NewStoryAdGenerationFlow.runStage(stage, generationFlowContext(button));
      } catch (err) {
        console.error('[newStoryAd] generation-flow failed:', err.message || err);
        toast(err.message || '阶段执行失败', 'error');
        return false;
      }
    }
    const labels = {
      scene: '生成场景配置中...',
      blueprint: '生成剧本中...',
      storyboard: '\u751f\u6210\u5206\u955c\u8868\u4e2d...',
      keyframes: '生成真实画面中...',
      tts: '生成配音中...',
      video: '生成逐镜视频中...',
      compose: '合成成片中...',
    };
    const busyLabel = labels[stage] || '\u5904\u7406\u4e2d...';
    startStageProgress(stage, busyLabel);
    setBusy(true, busyLabel);
    setButtonBusy(button, true, busyLabel);
    try {
      const id = await ensureTask();
      let r = null;
      if (stage === 'scene') {
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/scene-config`, { method: 'POST', body: {} });
        normalizeBundle(r);
        showStep(2);
      } else if (stage === 'blueprint') {
        if (!state.sceneConfig) normalizeBundle(await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/scene-config`, { method: 'POST', body: {} }));
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/blueprint`, { method: 'POST', body: {} });
        normalizeBundle(r);
        showStep(3);
      } else if (stage === 'storyboard') {
        if (!state.blueprint) normalizeBundle(await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/blueprint`, { method: 'POST', body: {} }));
        if (state.blueprint) await saveBlueprintEdits(id);
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/storyboard`, { method: 'POST', body: {} });
        normalizeBundle(r);
        showStep(4);
      } else if (stage === 'keyframes') {
        if (!state.shots.length) normalizeBundle(await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/storyboard`, { method: 'POST', body: {} }));
        if (state.shots.length) await saveStoryboardEdits(id);
        const missingOnly = button?.id === 'dhNsaAdFillMissingFramesTop';
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/keyframes`, { method: 'POST', body: missingOnly ? { missing_only: true } : {} });
        normalizeBundle(r);
        showStep(4);
      } else if (stage === 'tts') {
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/tts`, { method: 'POST', body: mediaStagePayload() });
        normalizeBundle(r);
        showStep(5);
      } else if (stage === 'video') {
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/video`, { method: 'POST', body: visualVideoStagePayload(button) });
        normalizeBundle(r);
        showStep(4);
      } else if (stage === 'compose') {
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/compose`, { method: 'POST', body: mediaStagePayload() });
        normalizeBundle(r);
        showStep(5);
      }
      renderAll();
      if (stage === 'keyframes') {
        const kf = r?.keyframe_status || r?.keyframeStatus || r?.bundle?.keyframe_status || keyframeStatus();
        if (kf.missing > 0) toast(`真实画面已生成 ${kf.completed}/${kf.total}，还差 ${kf.missing} 张，请点击补齐未生成镜头`, 'error');
        else if (r?.skipped) toast(`真实画面已完整：${kf.completed}/${kf.total}，无需补齐`, 'success');
        else toast(`真实画面已生成完成：${kf.completed}/${kf.total}`, 'success');
      } else {
        toast('剧情广告阶段已完成', 'success');
      }
      return true;
    } catch (err) {
      if (err.data) normalizeBundle(err.data);
      renderAll();
      toast(err.message || '阶段执行失败', 'error');
      return false;
    } finally {
      setButtonBusy(button, false);
      setBusy(false);
    }
  }

  async function cancelCurrentGeneration() {
    if (!window.NewStoryAdGenerationFlow?.cancelStage) return false;
    const cancelled = await window.NewStoryAdGenerationFlow.cancelStage(generationFlowContext());
    if (cancelled) {
      root()?.querySelectorAll('.is-busy, [aria-busy="true"]').forEach(button => {
        if (button.matches?.('button, [role="button"]')) setButtonBusy(button, false);
      });
      setBusy(false);
      renderAll();
    }
    return cancelled;
  }

  async function runMediaChain(button) {
    const compose = composeReadiness();
    if (!compose.ready) {
      showStep(4);
      renderAll();
      toast(compose.message || '请先修复所有未通过审核的镜头，再合成广告', 'error');
      return false;
    }
    if (window.NewStoryAdGenerationFlow?.runMediaChain) {
      try {
        return await window.NewStoryAdGenerationFlow.runMediaChain(generationFlowContext(button));
      } catch (err) {
        console.warn('[newStoryAd] media-chain fallback:', err.message || err);
      }
    }
    if (state.voiceId && !await runStage('tts', button)) return false;
    return runStage('compose', button);
  }

  async function assist(mode, button) {
    if (window.NewStoryAdGenerationFlow?.assist) {
      try {
        const result = await window.NewStoryAdGenerationFlow.assist(mode, generationFlowContext(button));
        if (result) {
          markSourceDirty('source');
          scheduleAutoSave('brief_assist');
        }
        return result;
      } catch (err) {
        console.warn('[newStoryAd] assist fallback:', err.message || err);
      }
    }
    const body = payload();
    if (body.brief.length < 3) return toast('请先写一点广告方向', 'error');
    const label = mode === 'clean' ? '整理需求中...' : 'AI 写作中...';
    setBusy(true, label);
    setButtonBusy(button, true, label);
    try {
      const r = await api('/api/new-story-ad/assist', { method: 'POST', body: { ...body, mode } });
      if (r.brief && within('#dhNsaAdText')) within('#dhNsaAdText').value = r.brief;
      markSourceDirty('source');
      scheduleAutoSave('brief_assist');
      toast('需求已整理', 'success');
    } catch (err) {
      toast(err.message || '需求整理失败', 'error');
    } finally {
      setButtonBusy(button, false);
      setBusy(false);
    }
  }

  function firstPendingControlAiLabel() {
    const pending = state.controlAiPending || {};
    return pending.style || pending.negative || '';
  }

  async function aiWriteControl(field = '', button = null) {
    const brief = (within('#dhNsaAdText')?.value || '').trim();
    if (!brief) return toast('请先填写广告需求，AI 才能按内容帮你写控制项', 'error');
    if (state.controlAiPending?.[field]) return;
    const mode = field === 'negative' ? 'negative_control' : 'style_control';
    const topic = field === 'negative'
      ? `${brief}\n请只整理画面禁止项，每条以“不要/禁止/避免/不能”开头，用分号分隔。`
      : `${brief}\n请只补充画面风格方向，包含真实程度、光线、质感和镜头情绪，不要写完整剧本。`;
    const label = field === 'negative' ? '整理禁止项中...' : '整理风格方向中...';
    state.controlAiPending = { ...(state.controlAiPending || {}), [field]: label };
    setBusy(true, label);
    setButtonBusy(button, true, label);
    renderAdvancedControls();
    try {
      const r = await api('/api/new-story-ad/assist', { method: 'POST', body: { ...payload(), brief: topic, mode } });
      const text = normalizeText(r.brief || r.text || r.content || '', 300);
      if (!text) throw new Error('AI 没有返回可用内容');
      const ctrl = controlledProduction();
      if (field === 'negative') ctrl.negative.text = text;
      else ctrl.style.notes = text;
      ctrl.uiExpanded = true;
      markSourceDirty('scene');
      renderAll();
      scheduleAutoSave('control_ai');
      toast(field === 'negative' ? '禁止项已整理' : '风格方向已整理', 'success');
    } catch (err) {
      toast(err.message || 'AI 帮写失败', 'error');
    } finally {
      const pending = { ...(state.controlAiPending || {}) };
      delete pending[field];
      state.controlAiPending = pending;
      setButtonBusy(button, false);
      const nextLabel = firstPendingControlAiLabel();
      if (nextLabel) setBusy(true, nextLabel);
      else setBusy(false);
      renderAdvancedControls();
    }
  }

  async function uploadAsset(file, role = 'asset') {
    if (window.NewStoryAdUploads?.upload) {
      return window.NewStoryAdUploads.upload({ api, file, role });
    }
    if (!file) throw new Error('请选择文件');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('role', role);
    const r = await api('/api/new-story-ad/upload', { method: 'POST', body: fd });
    const asset = r.asset || r.data || {};
    const url = asset.image_url || asset.file_url || r.image_url || r.file_url || r.url || '';
    if (!url) throw new Error('上传成功但没有返回文件地址');
    return {
      ...asset,
      url,
      image_url: asset.image_url || (asset.mimetype?.startsWith?.('audio/') ? '' : url),
      file_url: asset.file_url || url,
      name: asset.name || file.name || role,
    };
  }

  async function detectPersonGender(imageUrl = '') {
    if (window.NewStoryAdUploads?.detectPersonGender) {
      return window.NewStoryAdUploads.detectPersonGender({ api, imageUrl, compactUrl });
    }
    const url = compactUrl(imageUrl);
    if (!url) return '';
    try {
      const r = await api('/api/dh/images/detect-gender', { method: 'POST', body: { imageUrl: url } });
      const gender = String(r?.gender || '').toLowerCase();
      return gender === 'male' || gender === 'female' ? gender : '';
    } catch {
      return '';
    }
  }

  async function persistPersonAssetToLibrary(asset = {}, source = 'new_story_ad_uploaded_person_reference') {
    const imageUrl = compactUrl(asset.image_url || asset.url || asset.previewUrl || '');
    if (!imageUrl || /^blob:/i.test(imageUrl)) return null;
    const metadata = asset.metadata || {};
    const generatedBy = String(asset.generated_by || metadata.generated_by || '').toLowerCase();
    const assetSource = String(asset.source || metadata.source || '').toLowerCase();
    const alreadyLibraryAsset = asset.asset_library_id
      || asset.material_id
      || (asset.actor_asset_id && (
        asset.public_actor_library === true
        || asset.source === 'actor_library'
        || assetSource === 'new_story_ad_actor_sheet'
        || generatedBy === 'new_story_ad.person_sheet'
      ));
    if (alreadyLibraryAsset) return asset;
    try {
      const viewImages = Array.isArray(asset.view_images)
        ? asset.view_images.map(view => ({
          ...view,
          url: compactUrl(view?.url || view?.image_url || view?.imageUrl || view?.file_url || ''),
          image_url: compactUrl(view?.image_url || view?.url || view?.imageUrl || view?.file_url || ''),
        })).filter(view => view.url || view.image_url)
        : [];
      const body = {
        type: 'character',
        name: asset.name || '剧情广告真人演员',
        image_url: imageUrl,
        extra_image_urls: Array.isArray(asset.extra_image_urls) ? asset.extra_image_urls.map(compactUrl).filter(Boolean) : [],
        view_images: viewImages,
        cast_assets: Array.isArray(asset.cast_assets) ? asset.cast_assets : [],
        view_count: Number(asset.view_count || viewImages.length || 1) || 1,
        source,
        description: asset.spec_description || asset.description || personDescription(),
        tags: ['剧情广告', '真人演员'],
        metadata: {
          role: 'actor',
          from: source,
          module: 'new_story_ad',
          reference_kind: asset.reference_kind || (source === 'uploaded_person_reference' ? 'real_photo' : actorReferenceKind(asset)),
          source: asset.source || source,
          actor_id: asset.actor_id || '',
          actor_asset_id: asset.actor_asset_id || '',
          gender: asset.gender || asset.detected_gender || '',
          origin: asset.origin || '',
          cast_mode: asset.cast_mode || asset.castMode || '',
          expected_people: asset.expected_people || asset.person_count || '',
          view_images: viewImages,
          cast_assets: Array.isArray(asset.cast_assets) ? asset.cast_assets : [],
          person_spec: collectPersonSpec(),
          real_person_reference: actorReferenceKind(asset) === 'real_photo',
          production_usable_actor: actorIsSynthetic(asset),
        },
      };
      const r = await api('/api/assets', { method: 'POST', body });
      const saved = r?.data || null;
      if (saved?.id && state.personAsset && compactUrl(state.personAsset.image_url || state.personAsset.url) === imageUrl) {
        state.personAsset = {
          ...state.personAsset,
          actor_asset_id: saved.id,
          asset_library_id: saved.id,
          material_id: saved.id,
          source: 'actor_library',
        };
        applyPersonAssetConstraints(state.personAsset);
        renderAll();
      }
      if (saved?.id && state.actorAsset && compactUrl(state.actorAsset.image_url || state.actorAsset.url) === imageUrl) {
        state.actorAsset = {
          ...state.actorAsset,
          actor_asset_id: saved.id,
          asset_library_id: saved.id,
          material_id: saved.id,
          source: 'actor_library',
        };
        applyPersonAssetConstraints(state.actorAsset);
        renderAll();
      }
      return saved;
    } catch (err) {
      console.warn('[newStoryAd] save actor asset failed:', err.message || err);
      return null;
    }
  }

  async function uploadProductFile(file) {
    if (!file) return;
    revokePreview(state.productAsset);
    state.productAsset = {
      name: file.name || '商品/主体图',
      previewUrl: URL.createObjectURL(file),
      uploading: true,
    };
    markSourceDirty('product');
    renderAll();
    toast('商品/主体图正在上传...');
    try {
      const asset = await uploadAsset(file, 'product');
      revokePreview(state.productAsset);
      state.productAsset = { ...asset, previewUrl: asset.image_url || asset.url, uploading: false };
      renderAll();
      scheduleAutoSave('product_upload');
      toast('商品/主体图已上传', 'success');
    } catch (err) {
      state.productAsset = { ...state.productAsset, uploading: false, failed: true };
      renderAll();
      toast(err.message || '商品/主体图上传失败', 'error');
    }
  }

  async function uploadPersonFile(file) {
    if (!file) return;
    revokePreview(state.personAsset);
    state.personAsset = {
      id: 'uploaded_person_reference',
      name: '真人照片参考',
      original_name: file.name || '',
      type: 'uploaded_person_reference',
      source: 'uploaded_person_reference',
      reference_kind: 'real_photo',
      is_ai_generated: false,
      real_person_reference: true,
      previewUrl: URL.createObjectURL(file),
      uploading: true,
      view_count: 1,
      description: '用户上传的真人照片参考，会作为剧情广告人物身份和气质锁定。',
    };
    state.actorAsset = null;
    state.personSpecLock = null;
    state.castProfiles = [];
    markSourceDirty('person');
    renderAll();
    toast('真人参考正在上传...');
    try {
      const asset = await uploadAsset(file, 'person_reference');
      const imageUrl = asset.image_url || asset.url || '';
      const detectedGender = await detectPersonGender(imageUrl);
      revokePreview(state.personAsset);
      state.personAsset = {
        ...asset,
        id: 'uploaded_person_reference',
        name: '真人照片参考',
        type: 'uploaded_person_reference',
        source: 'uploaded_person_reference',
        reference_kind: 'real_photo',
        is_ai_generated: false,
        real_person_reference: true,
        image_url: imageUrl,
        url: imageUrl,
        previewUrl: imageUrl,
        uploading: false,
        gender: detectedGender || '',
        detected_gender: detectedGender || '',
        view_count: 1,
        description: '用户上传的真人照片参考，会作为剧情广告人物身份和气质锁定。',
      };
      applyPersonAssetConstraints(state.personAsset);
      renderAll();
      await persistPersonAssetToLibrary(state.personAsset, 'uploaded_person_reference');
      scheduleAutoSave('person_upload');
      toast('真人照片参考已上传并写入角色素材库，会用于后续剧本、分镜和关键帧保持人物一致', 'success');
    } catch (err) {
      state.personAsset = state.personAsset ? { ...state.personAsset, uploading: false, failed: true } : null;
      renderAll();
      toast(err.message || '真人参考上传失败', 'error');
    }
  }

  async function uploadReferenceFiles(files, shotIndex = null) {
    const picked = Array.from(files || []).filter(file => file && /^image\//.test(file.type || '')).slice(0, 8);
    if (!picked.length) return toast('请上传图片素材', 'error');
    markSourceDirty();
    picked.forEach((file, i) => {
      const asset = { name: file.name || `分镜参考 ${i + 1}`, previewUrl: URL.createObjectURL(file), uploading: true };
      const index = shotIndex === null || shotIndex === undefined ? state.referenceAssets.length : Number(shotIndex);
      state.referenceAssets[index + i] = asset;
    });
    renderAll();
    for (let i = 0; i < picked.length; i += 1) {
      const file = picked[i];
      const index = shotIndex === null || shotIndex === undefined ? state.referenceAssets.findIndex(a => a?.name === file.name && a.uploading) : Number(shotIndex) + i;
      try {
        const asset = await uploadAsset(file, 'storyboard_reference');
        revokePreview(state.referenceAssets[index]);
        state.referenceAssets[index] = { ...asset, previewUrl: asset.image_url || asset.url, uploading: false };
      } catch (err) {
        state.referenceAssets[index] = { ...state.referenceAssets[index], uploading: false, failed: true };
        toast(err.message || '参考素材上传失败', 'error');
      }
      renderAll();
    }
    scheduleAutoSave('reference_upload');
    toast('参考素材已处理', 'success');
  }

  async function uploadBgmFile(file) {
    if (!file) return;
    revokePreview(state.bgmAsset);
    state.bgmAsset = { name: file.name || '背景音乐', previewUrl: URL.createObjectURL(file), uploading: true };
    renderAll();
    toast('BGM 正在上传...');
    try {
      const asset = await uploadAsset(file, 'bgm');
      revokePreview(state.bgmAsset);
      state.bgmAsset = { ...asset, previewUrl: asset.file_url || asset.url, uploading: false };
      renderAll();
      scheduleAutoSave('bgm_upload');
      toast('BGM 已上传', 'success');
    } catch (err) {
      state.bgmAsset = { ...state.bgmAsset, uploading: false, failed: true };
      renderAll();
      toast(err.message || 'BGM 上传失败', 'error');
    }
  }

  function ensureNsaModal(id, title) {
    let modal = document.getElementById(id);
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = id;
    modal.className = 'dh-nsa-modal';
    modal.innerHTML = `<div class="dh-nsa-modal-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="dh-nsa-modal-head">
        <b>${escapeHtml(title)}</b>
        <button type="button" class="dh-modal-close-btn" data-nsa-modal-close aria-label="关闭弹窗" title="关闭">×</button>
      </div>
      <div class="dh-nsa-modal-content" data-nsa-modal-body></div>
    </div>`;
    modal.addEventListener('click', e => {
      if (e.target === modal || e.target.closest('[data-nsa-modal-close]')) {
        if (modal.id === 'dhNsaVoicePickerModal') stopNsaVoicePreview();
        if (modal.id === 'dhNsaMusicLibraryModal') stopNsaMusicPreview();
        hideNsaModal(modal);
      }
    });
    modal.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (modal.id === 'dhNsaVoicePickerModal') stopNsaVoicePreview();
        if (modal.id === 'dhNsaMusicLibraryModal') stopNsaMusicPreview();
        hideNsaModal(modal);
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), audio[controls], [tabindex]:not([tabindex="-1"])'))
        .filter(el => !el.hidden && el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    document.body.appendChild(modal);
    return modal;
  }

  function showNsaModal(modal) {
    if (modal) {
      document.documentElement.classList.add('dh-nsa-modal-open');
      modal.style.display = 'flex';
      modal.querySelector('[data-nsa-modal-body] input, [data-nsa-modal-body] textarea, [data-nsa-modal-body] select, [data-nsa-modal-body] button, [data-nsa-modal-close]')?.focus();
    }
  }

  function hideNsaModal(modal) {
    if (modal) modal.style.display = 'none';
    if (modal?.id === 'dhNsaAdminVideoMonitorModal' && state.adminVideoMonitorTimer) {
      clearInterval(state.adminVideoMonitorTimer);
      state.adminVideoMonitorTimer = null;
    }
    document.documentElement.classList.remove('dh-nsa-modal-open');
  }

  function adminVideoMonitorHtml(data = {}) {
    const shots = Array.isArray(data.shots) ? data.shots : [];
    const progress = data.generation_progress || {};
    const healthLabels = {
      pending: '待处理', running: '运行中', provider_running: '模型生成中',
      suspected_stuck: '疑似卡住', passed: '审核通过', failed: '失败',
    };
    const lifecycleLabels = {
      pending: '待处理', queued: '排队', submitting: '提交模型', provider_submitted: '模型已接收',
      provider_running: '模型生成中', downloading: '下载视频', normalizing: '视频标准化',
      generated: '视频已生成', video_qa: '质量审核中', qa_passed: '审核通过', qa_failed: '审核失败',
      failed: '生成失败', cancelled: '已取消',
    };
    const fmtTime = value => {
      const time = Date.parse(value || '');
      return time ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : '--';
    };
    const summary = [
      `总镜头 ${Number(progress.total ?? shots.length)}`,
      `已生成 ${Number(progress.generated ?? shots.filter(shot => shot.file_exists).length)}`,
      `已通过 ${Number(progress.qa_passed ?? shots.filter(shot => shot.health === 'passed').length)}`,
      `失败 ${Number(progress.failed ?? shots.filter(shot => shot.health === 'failed').length)}`,
      progress.effective_concurrency ? `并发 ${Number(progress.effective_concurrency)}` : '',
      progress.scene_block_count ? `场景段 ${Number(progress.scene_block_count)}（连续 ${Number(progress.continuous_scene_block_count || 0)}）` : '',
    ].filter(Boolean).join(' · ');
    if (!shots.length) return `<div class="dh-nsa-admin-monitor-empty"><b>尚未进入逐镜视频生成</b><span>${escapeHtml(summary || '等待后台生成任务启动。')}</span></div>`;
    return `<div class="dh-nsa-admin-monitor-summary">
      <b>${escapeHtml(summary)}</b><span>每 5 秒自动刷新 · 数据更新时间 ${escapeHtml(fmtTime(data.generated_at))}</span>
    </div><div class="dh-nsa-admin-monitor-grid">${shots.map((shot, index) => {
      const started = Date.parse(shot.started_at || shot.provider_submitted_at || '') || 0;
      const finished = Date.parse(shot.finished_at || '') || Date.now();
      const elapsed = started ? formatElapsedText(Math.max(0, finished - started)) : '--';
      const provider = shot.provider_used || [shot.provider_id, shot.model_id].filter(Boolean).join('/') || '--';
      const problems = [
        ...(Array.isArray(shot.qa_problems) ? shot.qa_problems : []),
        ...(Array.isArray(shot.cross_shot_qa_problems) ? shot.cross_shot_qa_problems : []),
      ].filter(Boolean);
      return `<article class="dh-nsa-admin-shot is-${escapeHtml(shot.health || 'pending')}">
        <div class="dh-nsa-admin-shot-head"><b>第 ${Number(shot.index || index + 1)} 镜 · ${escapeHtml(shot.title || `镜头 ${index + 1}`)}</b><em>${escapeHtml(healthLabels[shot.health] || shot.health || '待处理')}</em></div>
        <div class="dh-nsa-admin-shot-stage">${escapeHtml(lifecycleLabels[shot.lifecycle] || shot.lifecycle || '待处理')} · 耗时 ${escapeHtml(elapsed)}</div>
        ${shot.scene_block_id ? `<div>连续场景段：${escapeHtml(shot.scene_block_id)} · 包含镜头 ${(shot.scene_block_members || []).map(Number).filter(Boolean).join('、') || Number(shot.index || index + 1)}</div>` : ''}
        <div>模型：${escapeHtml(provider)}</div>
        <div>供应商任务：${escapeHtml(shot.provider_task_id || '--')} · ${escapeHtml(shot.provider_status || '--')}</div>
        <div>最后心跳：${escapeHtml(fmtTime(shot.last_heartbeat_at || shot.updated_at))} · 文件落地：${shot.file_exists ? '是' : '否'}</div>
        <div>自动修复：${Number(shot.repair_attempt || 0)} 次 · QA：${escapeHtml(shot.qa_status || '--')}</div>
        ${shot.video_url ? `<video src="${escapeHtml(withAuthQuery(shot.video_url))}" controls playsinline preload="metadata"></video>` : ''}
        ${problems.length ? `<div class="dh-nsa-admin-shot-error">审核问题：${escapeHtml(problems.join('；'))}</div>` : ''}
        ${shot.error ? `<div class="dh-nsa-admin-shot-error">错误：${escapeHtml(shot.error)}${shot.error_code ? `（${escapeHtml(shot.error_code)}）` : ''}</div>` : ''}
      </article>`;
    }).join('')}</div>`;
  }

  async function refreshAdminVideoMonitor() {
    if (!currentUserIsAdmin() || !state.taskId || state.adminVideoMonitorLoading) return;
    const modal = ensureNsaModal('dhNsaAdminVideoMonitorModal', '超管 · 分镜生成监控');
    const body = modal.querySelector('[data-nsa-modal-body]');
    state.adminVideoMonitorLoading = true;
    if (body && !body.dataset.loaded) body.innerHTML = '<div class="dh-nsa-admin-monitor-empty"><b>正在读取真实生成状态...</b></div>';
    try {
      const data = await api(`/api/new-story-ad/admin/tasks/${encodeURIComponent(state.taskId)}/video-monitor?_t=${Date.now()}`);
      if (body) {
        body.dataset.loaded = '1';
        body.innerHTML = adminVideoMonitorHtml(data);
      }
    } catch (error) {
      if (body) body.innerHTML = `<div class="dh-nsa-admin-monitor-empty"><b>监控读取失败</b><span>${escapeHtml(error.message || '请稍后重试')}</span></div>`;
    } finally {
      state.adminVideoMonitorLoading = false;
    }
  }

  function confirmNsaAction({
    title = '确认操作',
    summary = '',
    description = '',
    confirmLabel = '确认',
    cancelLabel = '取消',
    tone = 'primary',
    facts = [],
    items = [],
    note = '',
  } = {}) {
    return new Promise(resolve => {
      const modal = document.createElement('div');
      modal.className = `dh-nsa-modal dh-nsa-confirm-modal is-${tone}`;
      const factHtml = facts.length ? `<div class="dh-nsa-confirm-facts">${facts.map(fact => `<span class="is-${escapeHtml(fact.tone || 'neutral')}"><b>${escapeHtml(fact.value)}</b><small>${escapeHtml(fact.label)}</small></span>`).join('')}</div>` : '';
      const itemHtml = items.length ? `<div class="dh-nsa-confirm-list"><div class="dh-nsa-confirm-list-head"><b>本次处理范围</b><span>共 ${items.length} 个镜头</span></div>${items.map(item => `<div class="dh-nsa-confirm-shot"><i>${String(Number(item.index || 0) + 1).padStart(2, '0')}</i><span><b>${escapeHtml(item.title || `第 ${Number(item.index || 0) + 1} 镜`)}</b><small>${escapeHtml(item.view?.label || item.status || '')}</small></span><em>${escapeHtml(item.action || '')}</em></div>`).join('')}</div>` : '';
      modal.innerHTML = `<div class="dh-nsa-confirm-panel" role="dialog" aria-modal="true" aria-labelledby="dhNsaConfirmTitle">
        <div class="dh-nsa-confirm-head">
          <span class="dh-nsa-confirm-icon" aria-hidden="true">${tone === 'danger' ? '!' : '✓'}</span>
          <div><b id="dhNsaConfirmTitle">${escapeHtml(title)}</b>${summary ? `<span>${escapeHtml(summary)}</span>` : ''}</div>
          <button type="button" class="dh-modal-close-btn" data-nsa-confirm-cancel aria-label="关闭弹窗">×</button>
        </div>
        <div class="dh-nsa-confirm-body">
          ${description ? `<p>${escapeHtml(description)}</p>` : ''}
          ${factHtml}
          ${itemHtml}
          ${note ? `<div class="dh-nsa-confirm-note">${escapeHtml(note)}</div>` : ''}
        </div>
        <div class="dh-nsa-confirm-actions">
          <button type="button" class="dh-btn dh-btn-ghost" data-nsa-confirm-cancel>${escapeHtml(cancelLabel)}</button>
          <button type="button" class="dh-btn dh-nsa-confirm-submit" data-nsa-confirm-submit>${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
      let settled = false;
      const finish = accepted => {
        if (settled) return;
        settled = true;
        modal.remove();
        if (!document.querySelector('.dh-nsa-modal[style*="display: flex"], .dh-nsa-confirm-modal')) document.documentElement.classList.remove('dh-nsa-modal-open');
        resolve(accepted);
      };
      modal.addEventListener('click', event => {
        if (event.target === modal || event.target.closest('[data-nsa-confirm-cancel]')) finish(false);
        else if (event.target.closest('[data-nsa-confirm-submit]')) finish(true);
      });
      modal.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      });
      document.body.appendChild(modal);
      document.documentElement.classList.add('dh-nsa-modal-open');
      modal.style.display = 'flex';
      modal.querySelector('[data-nsa-confirm-cancel]')?.focus();
    });
  }

  function openAdminVideoMonitor() {
    if (!currentUserIsAdmin() || !state.taskId) return;
    const modal = ensureNsaModal('dhNsaAdminVideoMonitorModal', '超管 · 分镜生成监控');
    showNsaModal(modal);
    refreshAdminVideoMonitor();
    if (state.adminVideoMonitorTimer) clearInterval(state.adminVideoMonitorTimer);
    state.adminVideoMonitorTimer = setInterval(() => {
      if (modal.style.display === 'none') return;
      refreshAdminVideoMonitor();
    }, 5000);
  }

  async function loadNsaVoices(force = false) {
    if (!force && Array.isArray(state.voiceList) && state.voiceList.length) return state.voiceList;
    if (!force && nsaVoiceLoadPromise) return nsaVoiceLoadPromise;
    state.voiceLoading = true;
    const request = (async () => {
      const query = force ? `?_t=${Date.now()}` : '';
      const [availableResult, recordedResult] = await Promise.allSettled([
        api(`/api/avatar/voice-list${query}`),
        api(`/api/workbench/voices${query}`),
      ]);
      if (availableResult.status === 'rejected' && recordedResult.status === 'rejected') throw availableResult.reason;
      const availableResponse = availableResult.status === 'fulfilled' ? availableResult.value : {};
      const recordedResponse = recordedResult.status === 'fulfilled' ? recordedResult.value : {};
      const available = Array.isArray(availableResponse.voices)
        ? availableResponse.voices
        : (Array.isArray(availableResponse.data?.voices) ? availableResponse.data.voices : []);
      const recorded = (Array.isArray(recordedResponse.voices) ? recordedResponse.voices : [])
        .filter(voice => String(voice?.id || '').trim())
        .map(voice => ({
          ...voice,
          provider: voice.aliyun_voice_id ? '我的录音 · 已克隆' : `我的录音 · ${voice.status || '待克隆'}`,
          providerId: 'custom-recording',
          preview_url: `/api/workbench/voices/${encodeURIComponent(voice.id)}/play`,
          isRecorded: true,
          isCloned: !!voice.cloned,
          selectable: !!voice.aliyun_voice_id,
        }));
      const seen = new Set();
      state.voiceList = [...recorded, ...available].filter(voice => {
        const id = String(voice?.id || '').trim();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      try {
        sessionStorage.setItem('vido_nsa_voice_catalog', JSON.stringify(state.voiceList));
      } catch {}
      return state.voiceList;
    })();
    nsaVoiceLoadPromise = request;
    try {
      return await request;
    } finally {
      state.voiceLoading = false;
      if (nsaVoiceLoadPromise === request) nsaVoiceLoadPromise = null;
    }
  }

  function voiceDisplay(voice = {}) {
    const name = voice.name || voice.title || voice.id || '未命名音色';
    const provider = voice.provider || voice.providerId || '系统';
    const genderKey = nsaVoiceGender(voice);
    const gender = genderKey === 'female' ? ' · 女声' : (genderKey === 'male' ? ' · 男声' : '');
    return { name, sub: `${provider}${gender}` };
  }

  function nsaVoiceGender(voice = {}) {
    const raw = String(voice.gender || voice.sex || voice.tags?.gender || '').trim().toLowerCase();
    if (/female|woman|girl|女/.test(raw)) return 'female';
    if (/male|man|boy|男/.test(raw)) return 'male';
    return 'unknown';
  }

  function nsaVoiceDemoUrl(voice = {}) {
    return voice.expressiveDemoUrl
      || voice.expressive_demo_url
      || voice.emotionDemoUrl
      || voice.emotion_demo_url
      || voice.demoAudioUrl
      || voice.demo_audio_url
      || voice.preview_url
      || voice.previewUrl
      || voice.sample_url
      || '';
  }

  function stopNsaVoicePreview() {
    if (nsaVoicePreviewAudio) {
      try { nsaVoicePreviewAudio.pause(); } catch {}
      nsaVoicePreviewAudio.removeAttribute('src');
      nsaVoicePreviewAudio = null;
    }
    if (nsaVoicePreviewObjectUrl) {
      try { URL.revokeObjectURL(nsaVoicePreviewObjectUrl); } catch {}
      nsaVoicePreviewObjectUrl = '';
    }
  }

  async function previewNsaVoice(voiceId = '', button = null) {
    const voice = (state.voiceList || []).find(item => String(item?.id || '') === String(voiceId)) || {};
    if (!voiceId) return;
    stopNsaVoicePreview();
    const oldText = button?.textContent || '▶ 试听';
    if (button) { button.disabled = true; button.textContent = '生成中…'; }
    try {
      const demoUrl = nsaVoiceDemoUrl(voice);
      let audioUrl = demoUrl;
      if (!audioUrl) {
        const shotText = (state.shots || []).map(shot => shot.voiceover || shot.narration || shot.dialogue || shot.ad_copy || '').find(Boolean);
        const previewText = normalizeText(shotText || '您好，这里是剧情广告配音试听。', 160);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000);
        let response;
        try {
          response = await fetch('/api/dh/tts/preview-voice', {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
            },
            body: JSON.stringify({
              voice_id: voiceId,
              voiceId,
              text: previewText,
              gender: voice.gender || voice._gender || '',
              providerId: voice.providerId || voice.provider_id || '',
              provider: voice.provider || '',
            }),
          });
        } finally {
          clearTimeout(timeout);
        }
        if (!response?.ok) {
          let detail = '';
          try { detail = (await response.json())?.error || ''; } catch {}
          throw new Error(detail || `HTTP ${response?.status || 500}`);
        }
        const blob = await response.blob();
        if (!/^audio\//i.test(blob.type || '') || blob.size < 2048) throw new Error('试听音频为空或格式不可播放');
        nsaVoicePreviewObjectUrl = URL.createObjectURL(blob);
        audioUrl = nsaVoicePreviewObjectUrl;
      }
      nsaVoicePreviewAudio = new Audio(audioUrl);
      nsaVoicePreviewAudio.preload = 'auto';
      nsaVoicePreviewAudio.volume = 1;
      nsaVoicePreviewAudio.addEventListener('ended', stopNsaVoicePreview, { once: true });
      await nsaVoicePreviewAudio.play();
      if (button) button.textContent = '■ 停止';
      toast('正在播放音色试听', 'success');
    } catch (err) {
      stopNsaVoicePreview();
      toast(`试听失败：${err.name === 'AbortError' ? '生成超时，请稍后重试' : (err.message || '当前音色不可试听')}`, 'error');
    } finally {
      if (button && !nsaVoicePreviewAudio) {
        button.disabled = false;
        button.textContent = oldText;
      } else if (button) {
        button.disabled = false;
        nsaVoicePreviewAudio?.addEventListener('ended', () => { button.textContent = oldText; }, { once: true });
      }
    }
  }

  function renderNsaVoiceModal() {
    const modal = ensureNsaModal('dhNsaVoicePickerModal', '选择旁白配音');
    const body = modal.querySelector('[data-nsa-modal-body]');
    const voices = Array.isArray(state.voiceList) ? state.voiceList : [];
    body.innerHTML = `<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;">
        <input class="dh-input" data-nsa-voice-filter placeholder="搜索音色名称、供应商、性别" style="flex:1;">
        <button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-nsa-voice-refresh>刷新音色</button>
      </div>
      <div data-nsa-voice-genders style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 12px;">
        <span class="dh-nsa-picker-label">声音性别</span>
        ${[['all', '全部'], ['female', '女声'], ['male', '男声']].map(([id, label]) => `<button type="button" class="dh-btn dh-btn-sm ${state.voiceGenderFilter === id ? 'dh-btn-primary' : 'dh-btn-ghost'}" data-nsa-voice-gender="${id}">${label}</button>`).join('')}
      </div>
      <div data-nsa-voice-list style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">
        <div class="dh-nsa-picker-card dh-nsa-voice-card ${state.voiceId ? '' : 'is-selected'}" data-nsa-voice-card data-nsa-voice-optional="1" data-nsa-voice-gender="unknown" data-nsa-voice-search="不使用配音 无配音 剪映 后期">
          <button type="button" class="dh-nsa-picker-select" data-nsa-voice-select="">
            <b>不使用配音（选填）</b>
            <span>直接生成无旁白视频，后期可在剪映添加</span>
            ${state.voiceId ? '' : '<small class="is-selected-note">当前选择</small>'}
          </button>
        </div>
        ${voices.map(voice => {
          const display = voiceDisplay(voice);
          const id = String(voice.id || '');
          return `<div class="dh-nsa-picker-card dh-nsa-voice-card ${id === state.voiceId ? 'is-selected' : ''}" data-nsa-voice-card data-nsa-voice-gender="${nsaVoiceGender(voice)}" data-nsa-voice-search="${escapeHtml(`${display.name} ${display.sub}`.toLowerCase())}">
            <button type="button" class="dh-nsa-picker-select" data-nsa-voice-select="${escapeHtml(id)}" ${voice.selectable === false ? 'disabled' : ''}>
              <b>${escapeHtml(display.name)}</b>
              <span>${escapeHtml(display.sub)}</span>
              ${id === state.voiceId ? '<small class="is-selected-note">已选择</small>' : ''}
              ${voice.selectable === false ? '<small class="is-warning-note">录音已保留，完成声音克隆后即可用于配音</small>' : ''}
            </button>
            <button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-nsa-voice-preview="${escapeHtml(id)}" aria-label="试听${escapeHtml(display.name)}">▶ 试听</button>
          </div>`;
        }).join('')}
        ${state.voiceLoading ? '<div class="dh-task-empty-note">音色正在后台加载，可先选择“无配音”继续合成。</div>' : (!voices.length ? '<div class="dh-task-empty-note">暂无其他可用音色；无配音模式仍可正常合成。</div>' : '')}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px;">
        <button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-nsa-voice-record>🎤 录制 / 管理我的声音</button>
      </div>`;
    body.querySelector('[data-nsa-voice-refresh]')?.addEventListener('click', async () => {
      try {
        const pending = loadNsaVoices(true);
        renderNsaVoiceModal();
        await pending;
        renderNsaVoiceModal();
      } catch (err) {
        toast(err.message || '音色列表刷新失败', 'error');
      }
    });
    const applyVoiceFilters = () => {
      const q = String(body.querySelector('[data-nsa-voice-filter]')?.value || '').trim().toLowerCase();
      const gender = state.voiceGenderFilter || 'all';
      body.querySelectorAll('[data-nsa-voice-card]').forEach(card => {
        const matchesQuery = !q || String(card.dataset.nsaVoiceSearch || '').includes(q);
        const matchesGender = card.dataset.nsaVoiceOptional === '1' || gender === 'all' || card.dataset.nsaVoiceGender === gender;
        card.style.display = matchesQuery && matchesGender ? '' : 'none';
      });
    };
    body.querySelector('[data-nsa-voice-filter]')?.addEventListener('input', applyVoiceFilters);
    body.querySelectorAll('[data-nsa-voice-gender]').forEach(btn => btn.addEventListener('click', () => {
      state.voiceGenderFilter = btn.dataset.nsaVoiceGender || 'all';
      body.querySelectorAll('[data-nsa-voice-gender]').forEach(item => {
        item.classList.toggle('dh-btn-primary', item === btn);
        item.classList.toggle('dh-btn-ghost', item !== btn);
      });
      applyVoiceFilters();
    }));
    applyVoiceFilters();
    body.querySelector('[data-nsa-voice-record]')?.addEventListener('click', () => {
      stopNsaVoicePreview();
      hideNsaModal(modal);
      document.querySelector('[data-tab="voice-clone"]')?.click();
    });
    body.querySelector('[data-nsa-voice-list]')?.addEventListener('click', async e => {
      const preview = e.target.closest('[data-nsa-voice-preview]');
      if (preview) {
        e.preventDefault();
        const id = preview.dataset.nsaVoicePreview || '';
        if (nsaVoicePreviewAudio && preview.textContent.includes('停止')) {
          stopNsaVoicePreview();
          preview.textContent = '▶ 试听';
          return;
        }
        await previewNsaVoice(id, preview);
        return;
      }
      const btn = e.target.closest('[data-nsa-voice-select]');
      if (!btn) return;
      const id = btn.dataset.nsaVoiceSelect || '';
      const voice = (state.voiceList || []).find(v => String(v.id || '') === id) || {};
      const changed = id !== String(state.voiceId || '');
      state.voiceId = id;
      state.voiceName = voice.name || id || '';
      if (changed) {
        state.ttsAudio = null;
        state.videoClips = [];
        state.finalVideo = null;
      }
      setFieldValue('#dhNsaAdVoiceId', state.voiceId);
      renderAll();
      stopNsaVoicePreview();
      hideNsaModal(modal);
      scheduleAutoSave('voice_select');
      toast(id ? '配音已选择' : '已设为无配音，可直接生成视频', 'success');
    });
  }

  function openNsaVoiceModal() {
    const modal = ensureNsaModal('dhNsaVoicePickerModal', '选择旁白配音');
    if (!state.voiceList.length) {
      try {
        const cached = JSON.parse(sessionStorage.getItem('vido_nsa_voice_catalog') || '[]');
        if (Array.isArray(cached)) state.voiceList = cached;
      } catch {}
    }
    state.voiceLoading = !state.voiceList.length;
    renderNsaVoiceModal();
    showNsaModal(modal);
    loadNsaVoices(false).then(() => {
      if (modal.style.display !== 'none') renderNsaVoiceModal();
    }).catch(err => {
      state.voiceLoading = false;
      if (modal.style.display !== 'none') renderNsaVoiceModal();
      toast(err.message || '音色列表加载失败，无配音模式仍可使用', 'error');
    });
  }

  function musicSearchText() {
    return normalizeText([
      within('#dhNsaAdText')?.value || '',
      state.context?.brief || '',
      state.blueprint?.title || '',
      state.bgmProfile || '',
    ].filter(Boolean).join(' '), 600);
  }

  function stopNsaMusicPreview(except = null) {
    if (nsaMusicPreviewAudio && nsaMusicPreviewAudio !== except) {
      try {
        nsaMusicPreviewAudio.pause();
        nsaMusicPreviewAudio.currentTime = 0;
      } catch {}
    }
    if (!except || nsaMusicPreviewAudio !== except) nsaMusicPreviewAudio = except;
  }

  function renderNsaMusicModal(results = [], note = '', query = '', meta = {}) {
    stopNsaMusicPreview();
    const modal = ensureNsaModal('dhNsaMusicLibraryModal', '公开曲库');
    const body = modal.querySelector('[data-nsa-modal-body]');
    const page = Math.max(1, Number(meta.page) || 1);
    const pageCount = Math.max(page, Number(meta.pageCount) || page);
    const resultCount = Math.max(results.length, Number(meta.resultCount) || 0);
    const hasMore = meta.hasMore === true && page < pageCount;
    body.innerHTML = `<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;">
        <input class="dh-input" data-nsa-music-query value="${escapeHtml(String(query || '').slice(0, 80))}" placeholder="输入曲名、风格或乐器，如：古筝、国风、钢琴" style="flex:1;">
        <button type="button" class="dh-btn dh-btn-primary dh-btn-sm" data-nsa-music-search>搜索</button>
      </div>
      <div data-nsa-music-profiles style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:0 0 12px;">
        ${BGM_PROFILES.map(([id, label, desc]) => `<button type="button" class="dh-nsa-picker-card dh-nsa-music-profile ${id === state.bgmProfile ? 'is-selected' : ''}" data-nsa-music-profile="${escapeHtml(id)}">
          <b>${escapeHtml(label)}</b>
          <small>${escapeHtml(desc)}</small>
        </button>`).join('')}
      </div>
      ${note ? `<p class="dh-nsa-picker-note">${escapeHtml(note)}</p>` : ''}
      <div class="dh-nsa-picker-meta">
        <span>已加载 ${results.length} 首${resultCount ? ` · 当前检索约 ${resultCount} 首` : ''}</span>
        <span>第 ${page} / ${pageCount} 页</span>
      </div>
      <div data-nsa-music-list style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;">
        ${results.map((item, index) => {
          const title = item.title_zh || item.titleZh || item.title || item.name || `公开曲目 ${index + 1}`;
          const creator = item.creator || item.author || item.source || '';
          const url = item.preview_url || item.previewUrl || item.url || item.file_url || '';
          const license = item.license_label || item.licenseLabel || item.license || item.license_name || 'public';
          return `<div class="dh-nsa-picker-card dh-nsa-music-card">
            <b style="display:block;margin-bottom:4px;">${escapeHtml(title)}</b>
            <small class="dh-nsa-picker-secondary">${escapeHtml([creator, license].filter(Boolean).join(' · '))}</small>
            ${url ? `<audio controls preload="none" data-nsa-music-preview src="${escapeHtml(url)}" style="width:100%;height:32px;"></audio>` : ''}
            <button type="button" class="dh-btn dh-btn-primary dh-btn-sm" data-nsa-music-import="${index}" style="margin-top:8px;">导入使用</button>
          </div>`;
        }).join('') || '<div class="dh-task-empty-note">暂无曲目，换一个关键词再试。</div>'}
      </div>
      <div style="display:flex;justify-content:center;padding:16px 0 2px;">
        ${hasMore ? `<button type="button" class="dh-btn dh-btn-ghost" data-nsa-music-more>加载更多（第 ${page + 1} 页）</button>` : '<span class="dh-nsa-picker-secondary">已加载当前检索可访问的全部结果</span>'}
      </div>`;
    body.querySelector('[data-nsa-music-search]')?.addEventListener('click', () => {
      const q = body.querySelector('[data-nsa-music-query]')?.value || '';
      openNsaMusicLibrary(q);
    });
    body.querySelector('[data-nsa-music-query]')?.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      openNsaMusicLibrary(e.currentTarget.value || '');
    });
    body.querySelectorAll('[data-nsa-music-profile]').forEach(btn => btn.addEventListener('click', () => {
      state.bgmProfile = btn.dataset.nsaMusicProfile || 'auto';
      scheduleAutoSave('bgm_profile');
      const q = body.querySelector('[data-nsa-music-query]')?.value || '';
      openNsaMusicLibrary(q);
    }));
    body.querySelector('[data-nsa-music-more]')?.addEventListener('click', e => {
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = '正在加载...';
      openNsaMusicLibrary(query, { page: page + 1, append: true });
    });
    body.querySelector('[data-nsa-music-list]')?.addEventListener('play', e => {
      const audio = e.target.closest?.('[data-nsa-music-preview]');
      if (!audio) return;
      stopNsaMusicPreview(audio);
      body.querySelectorAll('[data-nsa-music-preview]').forEach(other => {
        if (other === audio || other.paused) return;
        try { other.pause(); other.currentTime = 0; } catch {}
      });
      audio.addEventListener('ended', () => {
        if (nsaMusicPreviewAudio === audio) nsaMusicPreviewAudio = null;
      }, { once: true });
    }, true);
    body.querySelector('[data-nsa-music-list]')?.addEventListener('click', async e => {
      const btn = e.target.closest('[data-nsa-music-import]');
      if (!btn) return;
      const item = results[Number(btn.dataset.nsaMusicImport)] || null;
      if (!item) return;
      btn.disabled = true;
      btn.textContent = '导入中...';
      try {
        const r = await api('/api/new-story-ad/music/import', { method: 'POST', body: { item } });
        state.bgmAsset = r.bgm_asset || r.bgmAsset || r.asset || item;
        renderAll();
        stopNsaMusicPreview();
        hideNsaModal(ensureNsaModal('dhNsaMusicLibraryModal', '公开曲库'));
        scheduleAutoSave('music_select');
        toast('背景音乐已导入', 'success');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '导入使用';
        toast(err.message || '公开曲目导入失败', 'error');
      }
    });
  }

  async function openNsaMusicLibrary(query = '', { page = 1, append = false } = {}) {
    const modal = ensureNsaModal('dhNsaMusicLibraryModal', '公开曲库');
    const body = modal.querySelector('[data-nsa-modal-body]');
    const normalizedQuery = String(query || '').trim();
    const requestedPage = Math.max(1, Number(page) || 1);
    if (!append) body.innerHTML = '<div class="dh-task-empty-note">正在搜索可商用免费版权音乐...</div>';
    showNsaModal(modal);
    state.musicLibrary.loading = true;
    try {
      const params = new URLSearchParams({
        q: normalizedQuery,
        profile_id: state.bgmProfile || 'auto',
        text: musicSearchText(),
        page: String(requestedPage),
        page_size: '20',
      });
      const r = await api(`/api/new-story-ad/music/search?${params.toString()}`);
      const incoming = Array.isArray(r.results) ? r.results : [];
      const previous = append && state.musicLibrary.query === normalizedQuery ? state.musicLibrary.results : [];
      const seen = new Set();
      const merged = [...previous, ...incoming].filter(item => {
        const key = String(item?.url || item?.id || '');
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      state.musicLibrary = {
        query: normalizedQuery,
        results: merged,
        page: Number(r.page) || requestedPage,
        pageCount: Number(r.page_count || r.pageCount) || requestedPage,
        resultCount: Number(r.result_count || r.resultCount) || merged.length,
        hasMore: r.has_more === true || r.hasMore === true,
        note: r.license_note || r.query || '',
        loading: false,
      };
      renderNsaMusicModal(merged, state.musicLibrary.note, normalizedQuery, state.musicLibrary);
    } catch (err) {
      state.musicLibrary.loading = false;
      if (append && state.musicLibrary.results.length) {
        renderNsaMusicModal(state.musicLibrary.results, `${state.musicLibrary.note || ''}；加载下一页失败：${err.message || '请稍后重试'}`, normalizedQuery, state.musicLibrary);
      } else {
        body.innerHTML = `<div class="dh-task-empty-note">${escapeHtml(err.message || '公开曲库搜索失败')}</div>`;
      }
    }
  }

  function openNsaSubtitleStyleModal() {
    const modal = ensureNsaModal('dhNsaSubtitleStyleModal', '字幕样式');
    const body = modal.querySelector('[data-nsa-modal-body]');
    const options = state.subtitleOptions || {};
    body.innerHTML = `<div class="dh-subtitle-modal-scroll">
      <div style="margin-bottom:18px;">
        <div style="font-size:12px;color:#64748b;margin-bottom:6px;">实时预览（最终成片使用同一套 ASS 字幕效果）</div>
        <div class="dh-sub-preview-stage" data-nsa-sub-preview-stage data-sub-style="${escapeHtml(state.subtitleStyle || 'popup')}" data-sub-pos="bottom">
          <span class="dh-sub-preview-text" data-nsa-sub-preview-text>限时秒杀 仅需99元 立刻抢购</span>
        </div>
      </div>
      <div class="dh-field">
        <label>字幕动效</label>
        <div class="dh-sub-style-grid">
          ${SUBTITLE_STYLES.map(([id, label, desc]) => `<button type="button" class="dh-sub-style ${id === state.subtitleStyle ? 'active' : ''}" data-nsa-subtitle-style="${escapeHtml(id)}">
            <span class="dh-sub-style-thumb ${escapeHtml(id)}"><b>${id === 'emphasis' ? '99<em>元</em>' : '嗨~'}</b></span>
            <span class="dh-sub-style-name">${escapeHtml(label)}</span>
            <span class="dh-sub-style-desc">${escapeHtml(desc)}</span>
          </button>`).join('')}
        </div>
      </div>
      <label class="dh-switch" style="margin:12px 0;display:flex;align-items:center;gap:8px;">
        <input type="checkbox" data-nsa-sub-smart ${options.smartEmphasis !== false ? 'checked' : ''}>
        <span>智能识别并强调关键词（数字、价格、限时词和重点词）</span>
      </label>
      <details style="margin-top:8px;">
        <summary style="cursor:pointer;color:#64748b;font-size:12px;padding:8px 0;">高级：字体、字号与颜色</summary>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;padding-top:8px;">
          <label class="dh-field"><span>字体</span><select class="dh-input" data-nsa-sub-font>
            ${['抖音美好体', '思源黑体', '微软雅黑', 'Noto Sans SC', '宋体', '黑体'].map(name => `<option value="${escapeHtml(name)}" ${name === (options.fontName || '抖音美好体') ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
          </select></label>
          <label class="dh-field"><span>字号</span><select class="dh-input" data-nsa-sub-size>
            ${[56, 72, 80, 96].map(size => `<option value="${size}" ${Number(options.fontSize || 72) === size ? 'selected' : ''}>${size}</option>`).join('')}
          </select></label>
          <label class="dh-field"><span>字体颜色</span><input type="color" class="dh-input" data-nsa-sub-color value="${escapeHtml(options.color || '#FFFFFF')}"></label>
          <label class="dh-field"><span>描边颜色</span><input type="color" class="dh-input" data-nsa-sub-outline value="${escapeHtml(options.outlineColor || '#000000')}"></label>
        </div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:#64748b;">
          <input type="checkbox" data-nsa-sub-custom-color ${options.color || options.outlineColor ? 'checked' : ''}> 使用上面的自定义颜色；关闭则使用各动效的设计默认色
        </label>
      </details>
      <div style="display:flex;justify-content:flex-end;margin-top:16px;">
        <button type="button" class="dh-btn dh-btn-primary" data-nsa-subtitle-save>保存字幕设置</button>
      </div>
    </div>`;

    const refreshPreview = () => {
      const stage = body.querySelector('[data-nsa-sub-preview-stage]');
      const text = body.querySelector('[data-nsa-sub-preview-text]');
      const style = body.querySelector('[data-nsa-subtitle-style].active')?.dataset.nsaSubtitleStyle || state.subtitleStyle || 'popup';
      if (!stage || !text) return;
      stage.dataset.subStyle = style;
      stage.dataset.subPos = style === 'comic' ? 'top' : 'bottom';
      text.style.fontFamily = `"${body.querySelector('[data-nsa-sub-font]')?.value || '抖音美好体'}", "Microsoft YaHei", sans-serif`;
      text.style.setProperty('--sub-size', `${Math.max(14, Math.round((Number(body.querySelector('[data-nsa-sub-size]')?.value) || 72) * 0.5))}px`);
      const useCustom = body.querySelector('[data-nsa-sub-custom-color]')?.checked;
      if (useCustom) {
        text.style.setProperty('--sub-color', body.querySelector('[data-nsa-sub-color]')?.value || '#FFFFFF');
        text.style.setProperty('--sub-outline', body.querySelector('[data-nsa-sub-outline]')?.value || '#000000');
      } else {
        text.style.removeProperty('--sub-color');
        text.style.removeProperty('--sub-outline');
      }
      const sample = '限时秒杀 仅需99元 立刻抢购';
      if (style === 'emphasis') {
        text.innerHTML = '限时秒杀 仅需<em class="sub-key">99元</em> 立刻抢购';
      } else if (style === 'karaoke') {
        text.innerHTML = Array.from(sample).map((char, index) => char === ' ' ? ' ' : `<em class="sub-kara" style="animation-delay:${index * 0.18}s">${escapeHtml(char)}</em>`).join('');
      } else {
        text.textContent = sample;
      }
    };
    body.querySelectorAll('[data-nsa-subtitle-style]').forEach(btn => btn.addEventListener('click', () => {
      body.querySelectorAll('[data-nsa-subtitle-style]').forEach(item => item.classList.toggle('active', item === btn));
      refreshPreview();
    }));
    ['[data-nsa-sub-font]', '[data-nsa-sub-size]', '[data-nsa-sub-color]', '[data-nsa-sub-outline]', '[data-nsa-sub-custom-color]'].forEach(selector => {
      body.querySelector(selector)?.addEventListener('input', refreshPreview);
      body.querySelector(selector)?.addEventListener('change', refreshPreview);
    });
    body.querySelector('[data-nsa-subtitle-save]')?.addEventListener('click', () => {
      state.subtitleStyle = body.querySelector('[data-nsa-subtitle-style].active')?.dataset.nsaSubtitleStyle || 'popup';
      state.subtitleEnabled = true;
      const useCustom = body.querySelector('[data-nsa-sub-custom-color]')?.checked;
      state.subtitleOptions = {
        smartEmphasis: body.querySelector('[data-nsa-sub-smart]')?.checked !== false,
        fontName: body.querySelector('[data-nsa-sub-font]')?.value || '抖音美好体',
        fontSize: Number(body.querySelector('[data-nsa-sub-size]')?.value) || 72,
        color: useCustom ? (body.querySelector('[data-nsa-sub-color]')?.value || '#FFFFFF') : '',
        outlineColor: useCustom ? (body.querySelector('[data-nsa-sub-outline]')?.value || '#000000') : '',
      };
      renderAll();
      hideNsaModal(modal);
      scheduleAutoSave('subtitle_style');
      toast(`字幕样式已更新：${subtitleStyleLabel(state.subtitleStyle)}`, 'success');
    });
    refreshPreview();
    showNsaModal(modal);
  }

  function openPreview(url = '', title = '预览') {
    if (!url) return;
    if (typeof window.openImagePreviewModal === 'function' && !/\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i.test(url)) {
      window.openImagePreviewModal(url, title);
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  function formatElapsedText(ms = 0) {
    const sec = Math.max(0, Math.round(Number(ms) / 1000) || 0);
    if (sec >= 60) return `${Math.floor(sec / 60)}\u5206${String(sec % 60).padStart(2, '0')}\u79d2`;
    return `${sec}\u79d2`;
  }

  function personGenerationProgressHtml() {
    if (window.NewStoryAdActors?.progressHtml) return window.NewStoryAdActors.progressHtml(state.personGenerationProgress, escapeHtml);
    const progress = state.personGenerationProgress;
    if (!progress || !progress.active) return '';
    const startedAt = Number(progress.startedAt || 0) || Date.now();
    const elapsed = Math.max(0, Date.now() - startedAt);
    const basePct = Math.round(Number(progress.percent) || 10);
    const softPct = basePct >= 82 ? Math.min(94, basePct + Math.floor(Math.max(0, elapsed - 22000) / 9000)) : basePct;
    const pct = Math.max(8, Math.min(96, softPct));
    return `<div class="dh-lux-person-progress">
      <div class="dh-lux-person-progress-head">
        <b>${escapeHtml(progress.label || '正在生成演员包')}</b>
        <div class="dh-nsa-progress-actions">
          <span class="dh-lux-person-progress-stat"><em>耗时 ${escapeHtml(formatElapsedText(elapsed))}</em><i>${pct}%</i></span>
          <button type="button" class="dh-nsa-cancel-generation" data-nsa-cancel-generation ${state.cancelRequested ? 'disabled' : ''}>${state.cancelRequested ? '正在取消...' : '取消生成'}</button>
        </div>
      </div>
      <div class="dh-lux-person-progress-track" aria-hidden="true"><i style="width:${pct}%"></i></div>
      <small>${escapeHtml(progress.message || '已提交生成请求，正在生成第 1/4 张。')}</small>
    </div>`;
  }

  function personDescription(spec = collectPersonSpec()) {
    const labels = {
      castMode: { auto: '按内容判断', no_human: '无人物 / 只拍主体', animal: '动物 / 宠物主体', single: '单人', dual: '双人对话', group: '多人 / 群体' },
      gender: { auto: '按故事判断', male: '男性', female: '女性', mixed: '双人/多人混合', all_male: '双人/多人全男性', all_female: '双人/多人全女性' },
      age: { match_brief: '按广告需求判断', young_adult_17_25: '年轻成人 / 17-25', young_adult: '青年 / 25-32', adult_30_40: '成熟青年 / 30-40', middle_40_55: '中年 / 40-55', senior_55_plus: '年长 / 55+' },
      origin: { east_asian_cn: '中国 / 东亚面孔', match_brief: '按广告需求判断', mixed_global: '多种族 / 国际化' },
    };
    return [
      `人物数量：${labels.castMode[spec.castMode] || spec.castMode || '按内容判断'}`,
      `人物性别：${labels.gender[spec.gender] || spec.gender || '按故事判断'}`,
      `人物年龄：${labels.age[spec.age] || spec.age || '按广告需求判断'}`,
      `地域/种族：${labels.origin[spec.origin] || spec.origin || '按广告需求判断'}`,
      spec.displayName ? `人物姓名：${spec.displayName}` : '',
      spec.roleName ? `人物身份：${spec.roleName}` : '',
      spec.appearanceText ? `外貌气质：${spec.appearanceText}` : '',
      spec.wardrobeText ? `穿着服装：${spec.wardrobeText}` : '',
      spec.hairMakeupText ? `发型妆造：${spec.hairMakeupText}` : '',
      spec.negativeText ? `人物禁止项：${spec.negativeText}` : '',
      'AI 生成只作为拟真演员参考；需要真人请上传真人照片或使用授权真人演员素材。',
      '没有手动填写姓名时，编剧必须为每个出场人物生成正式姓名；服装、发型、妆造和身份必须进入人物档案。',
    ].filter(Boolean).join('；');
  }

  function applyPersonSpecSuggestion(suggestion = {}) {
    const normalized = suggestion && typeof suggestion === 'object' ? suggestion : {};
    const set = (key, value, { overwrite = false, defaults = [] } = {}) => {
      const el = activeField(`[data-nsa-person-spec="${key}"]`);
      if (!el || value === undefined || value === null || value === '') return 0;
      const current = String(el.value || '').trim();
      const shouldFill = !current
        || overwrite
        || defaults.includes(current);
      if (!shouldFill) return 0;
      if (current === String(value).trim()) return 0;
      writeAllFields(`[data-nsa-person-spec="${key}"]`, value);
      return 1;
    };
    let changed = 0;
    changed += set('castMode', normalized.castMode || 'single', { defaults: ['auto'] });
    changed += set('gender', normalized.gender || 'auto', { defaults: ['auto'] });
    changed += set('age', normalized.age || 'match_brief', { defaults: ['match_brief'] });
    changed += set('origin', normalized.origin || 'match_brief', { defaults: ['match_brief'] });
    changed += set('roleName', normalized.roleName || '');
    changed += set('displayName', normalized.displayName || '');
    changed += set('appearanceText', normalized.appearanceText || '', { overwrite: true });
    changed += set('wardrobeText', normalized.wardrobeText || '', { overwrite: true });
    changed += set('hairMakeupText', normalized.hairMakeupText || '', { overwrite: true });
    changed += set('negativeText', normalized.negativeText || '', { overwrite: true });
    return changed;
  }

  function fallbackPersonSpecFromBrief(brief = '') {
    const isMale = /男|先生|老板|师傅|经理/.test(brief) && !/女|女士|美女|太太/.test(brief);
    const isFemale = /女|女士|美女|太太|模特/.test(brief);
    const isDual = /双人|两人|对话|客户.*顾问|销售.*客户|经销商.*客户/.test(brief);
    const isGroup = /多人|团队|群像|一家人|员工/.test(brief);
    const noHuman = /无人|无人物|不出现人|不要人物|只拍产品|只拍空间|纯产品|纯空间/.test(brief);
    const animal = /动物|宠物|萌宠/.test(brief);
    return {
      castMode: noHuman ? 'no_human' : (animal ? 'animal' : (isGroup ? 'group' : (isDual ? 'dual' : 'single'))),
      gender: isMale ? 'male' : (isFemale ? 'female' : 'auto'),
      age: /老板|经理|经销商|顾问|专家|负责人/.test(brief) ? 'adult_30_40' : 'match_brief',
      origin: 'match_brief',
      roleName: /顾问|销售|经销商|导购/.test(brief) ? '品牌顾问 / 商业讲解人' : '广告主角',
      appearanceText: '符合当前广告需求的真实商业广告人物，五官自然，表情可信，气质干净专业；根据任务内容、目标用户和剧情关系判断年龄感、职业感和亲和度，避免网红脸和过度磨皮。',
      wardrobeText: '服装贴合当前产品定位、使用场景和目标客群，干净真实，颜色克制；鞋、配饰和整体风格保持商业广告质感，不抢主体画面。',
      hairMakeupText: '发型整洁自然，妆容清爽克制，皮肤保留真实质感；可有轻微商务妆、自然眉眼和干净发际线，避免厚重滤镜、夸张美瞳或塑料感皮肤。',
      negativeText: '不要卡通、不要塑料感皮肤、不要多余人物、不要水印文字、不要夸张变形；不要网红脸、廉价服装、过度磨皮、表情浮夸或与产品定位不符的造型。',
    };
  }

  async function fillPersonSpecFromBrief(button = null) {
    const brief = (within('#dhNsaAdText')?.value || '').trim();
    if (!brief) return toast('请先填写广告需求，再确认人物来源', 'error');
    const label = '补齐中...';
    setButtonBusy(button, true, label);
    try {
      let suggestion = null;
      try {
        const r = await api('/api/new-story-ad/assist', {
          method: 'POST',
          body: {
            ...payload(),
            brief,
            mode: 'person_spec',
            person_spec: collectPersonSpec(),
          },
        });
        suggestion = r.person_spec || r.personSpec || null;
      } catch (err) {
        suggestion = fallbackPersonSpecFromBrief(brief);
      }
      const changed = applyPersonSpecSuggestion(suggestion || fallbackPersonSpecFromBrief(brief));
      markSourceDirty('person');
      renderAll();
      scheduleAutoSave('person_spec_assist');
      toast(changed ? '已按当前年龄、性别和人物选择重新校准人物设定' : '当前人物设定已经与所选条件一致', changed ? 'success' : 'info');
    } finally {
      setButtonBusy(button, false);
    }
  }

  function fallbackSceneSpecFromBrief(brief = '') {
    return {
      layoutText: `围绕当前广告需求建立一个可连续拍摄的真实商业空间：明确主体展示区、人物行动区、前景和背景层次，保证多个镜头能在同一空间内切换视角而不跳场。`,
      materialLightText: `材质、色彩和光线按广告主体定位判断，保持真实摄影质感、自然商业布光和统一色温；材质细节清晰可读，避免廉价棚拍、过度虚化或不相关装饰。`,
      interactionText: `预留后续可放置人物或商品的空白站位、展示区、近景特写区和移动镜头路径；当前场景四视图必须保持空场景，只表现空间结构、可互动区域和镜头位置，不生成人物。`,
      negativeText: `不要出现真人、背影、侧脸、手、身体局部、模特、人形剪影或人物倒影；不要出现与当前广告需求无关的空间；不要文字水印、品牌乱入、卡通或三维渲染感；不要突然换场景、换材质、换光线方向。`,
    };
  }

  async function fillSceneSpecFromBrief(button = null) {
    const brief = (within('#dhNsaAdText')?.value || '').trim();
    if (!brief) return toast('请先填写广告需求，再补齐场景空间设定', 'error');
    const label = '补齐场景中...';
    setButtonBusy(button, true, label);
    try {
      let suggestion = null;
      try {
        const r = await api('/api/new-story-ad/assist', {
          method: 'POST',
          body: {
            ...payload(),
            brief,
            mode: 'scene_spec',
            scene_spec: window.NewStoryAdSceneAssets?.specPayload?.() || {},
          },
        });
        suggestion = r.scene_spec || r.sceneSpec || null;
      } catch (err) {
        suggestion = fallbackSceneSpecFromBrief(brief);
      }
      const changed = window.NewStoryAdSceneAssets?.applySpecSuggestion?.(suggestion || fallbackSceneSpecFromBrief(brief));
      markSourceDirty('scene');
      renderAll();
      scheduleAutoSave('scene_spec_assist');
      toast(changed ? '已根据当前需求补齐场景空间设定，可继续手动微调' : '当前场景设定已有内容；如需重新生成，请先清空对应字段', changed ? 'success' : 'info');
    } finally {
      setButtonBusy(button, false);
    }
  }

  async function generatePersonSheet(button) {
    if (state.personGenerationProgress?.active) return toast('正在生成拟真演员，人物数量、性别、年龄、外貌、穿着等约束已提交给后台，生成完成或失败后再修改。', 'error');
    const description = [
      personSpec('appearanceText'),
      personSpec('wardrobeText') ? `服装：${personSpec('wardrobeText')}` : '',
      personSpec('hairMakeupText') ? `发型妆造：${personSpec('hairMakeupText')}` : '',
      personSpec('negativeText') ? `禁止：${personSpec('negativeText')}` : '',
      payload().brief,
    ].filter(Boolean).join('；');
    if (description.length < 8) return toast('请先填写广告需求或人物设定', 'error');
    const generationSpec = collectPersonSpec();
    const generationId = window.crypto?.randomUUID?.() || `person_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await ensureTask();
    state.activeGenerationId = generationId;
    state.activeStage = 'person_sheet';
    state.cancelRequested = false;
    const specDescription = personDescription(generationSpec);
    const stages = [
      { at: 0, percent: 10, message: '已完成 0/4 张，正在生成第 1/4 张。' },
      { at: 2500, percent: 28, message: '已完成 0/4 张，正在生成第 1/4 张。' },
      { at: 8500, percent: 58, message: '已完成 1/4 张，正在生成第 2/4 张。' },
      { at: 15000, percent: 78, message: '已完成 2/4 张，正在生成第 3/4 张。' },
      { at: 21500, percent: 88, message: '已完成 3/4 张，正在生成第 4/4 张。' },
    ];
    const updateProgress = () => {
      const start = state.personGenerationProgress?.startedAt || Date.now();
      const elapsed = Date.now() - start;
      let stage = stages[0];
      stages.forEach(item => { if (elapsed >= item.at) stage = item; });
      state.personGenerationProgress = {
        active: true,
        startedAt: start,
        label: '拟真演员',
        percent: stage.percent,
        message: stage.message,
      };
      renderPerson();
    };
    state.personGenerationProgress = {
      active: true,
      startedAt: Date.now(),
      label: '拟真演员',
      percent: 10,
      message: '已完成 0/4 张，正在生成第 1/4 张。',
    };
    setButtonBusy(button, true, '生成拟真演员中...');
    renderPerson();
    const timer = setInterval(updateProgress, 1400);
    try {
      const r = await api('/api/new-story-ad/person-sheet', {
        method: 'POST',
        body: {
          brief: payload().brief,
          content: payload().brief,
          description: description || specDescription,
          person_spec: generationSpec,
          gender: personSpec('gender') || 'auto',
          age: personSpec('age') || '',
          cast_mode: personSpec('castMode') || 'auto',
          expected_people: Number(personSpec('expectedPeople') || 0) || undefined,
          task_id: state.taskId || '',
          generation_id: generationId,
        },
      });
      state.actorAsset = r.actor_asset || r.character || r.actor || r.asset || r;
      if (state.actorAsset && typeof state.actorAsset === 'object') {
        state.actorAsset.name = state.actorAsset.name || '拟真一致性演员';
        state.actorAsset.description = state.actorAsset.description || '拟真一致性演员：可用于后续分镜人物一致性锁定。';
        state.actorAsset.spec_description = state.actorAsset.spec_description || specDescription;
        state.actorAsset.reference_kind = state.actorAsset.reference_kind || 'synthetic_realistic_actor';
        state.actorAsset.production_usable_actor = state.actorAsset.production_usable_actor !== false;
        applyPersonAssetConstraints(state.actorAsset);
      }
      state.personAsset = null;
      state.personGenerationProgress = null;
      renderPerson();
      persistPersonAssetToLibrary(state.actorAsset, 'new_story_ad_person_sheet').catch(() => {});
      await saveCurrentTaskProgress({ silent: true });
      toast('拟真一致性演员已生成并保存，可用于后续分镜人物一致性锁定', 'success');
    } catch (err) {
      state.personGenerationProgress = null;
      renderPerson();
      toast(err.message || '拟真演员生成失败', err.code === 'USER_CANCELLED' ? 'info' : 'error');
    } finally {
      clearInterval(timer);
      if (state.activeGenerationId === generationId) {
        state.activeGenerationId = '';
        state.activeStage = '';
        state.cancelRequested = false;
      }
      state.personGenerationProgress = null;
      setButtonBusy(button, false);
      renderPerson();
    }
  }

  function renderActor() {
    renderPerson();
  }

  function bind() {
    const host = root();
    if (!host || host.dataset.bound === '1') return;
    host.dataset.bound = '1';
    host.addEventListener('click', async e => {
      const target = e.target;
      const castModeQuick = target.closest('[data-nsa-cast-mode-quick]');
      if (castModeQuick && host.contains(castModeQuick)) {
        e.preventDefault();
        e.stopPropagation();
        const mode = castModeQuick.dataset.nsaCastModeQuick === 'no_human' ? 'no_human' : 'auto';
        writeAllFields('[data-nsa-person-spec="castMode"]', mode);
        activeField('[data-nsa-person-spec="castMode"]')?.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      const btn = target.closest('button, [role="button"], a');
      const adminVideoMonitor = target.closest('[data-nsa-admin-video-monitor]');
      if (adminVideoMonitor && host.contains(adminVideoMonitor)) {
        e.preventDefault();
        e.stopPropagation();
        openAdminVideoMonitor();
        return;
      }
      const cancelGeneration = target.closest('[data-nsa-cancel-generation]');
      if (cancelGeneration && host.contains(cancelGeneration)) {
        e.preventDefault();
        e.stopPropagation();
        await cancelCurrentGeneration();
        return;
      }
      const step = target.closest('[data-nsa-step]');
      if (step) {
        e.preventDefault();
        e.stopPropagation();
        const n = Number(step.dataset.nsaStep || 1);
        if (!canOpenStep(n)) {
          const message = n === 5 ? composeReadiness().message : '请先完成前置阶段';
          return toast(message || '请先完成前置阶段', 'error');
        }
        showStep(n);
        return;
      }
      const returnKeyframes = target.closest('[data-nsa-return-keyframes]');
      if (returnKeyframes && host.contains(returnKeyframes)) {
        e.preventDefault();
        e.stopPropagation();
        showStep(4);
        return;
      }
      const ratioBtn = target.closest('[data-nsa-ratio]');
      if (ratioBtn && host.contains(ratioBtn)) {
        e.preventDefault();
        e.stopPropagation();
        state.outputRatio = ratioBtn.dataset.nsaRatio || '9:16';
        markSourceDirty('source');
        renderAll();
        scheduleAutoSave('output_ratio');
        return;
      }
      const resolutionBtn = target.closest('[data-nsa-video-resolution]');
      if (resolutionBtn && host.contains(resolutionBtn)) {
        e.preventDefault();
        e.stopPropagation();
        const value = resolutionBtn.dataset.nsaVideoResolution || '720p';
        state.videoResolution = VIDEO_RESOLUTION_LABELS[value] ? value : '720p';
        syncOptionControls();
        renderStatus();
        scheduleAutoSave('video_resolution');
        return;
      }
      const envBtn = target.closest('[data-nsa-control-env]');
      if (envBtn && host.contains(envBtn)) {
        e.preventDefault();
        e.stopPropagation();
        const ctrl = controlledProduction();
        ctrl.environment.mode = envBtn.dataset.nsaControlEnv || 'auto';
        if (ctrl.environment.mode === 'tech_commercial' && !ctrl.style.notes) {
          ctrl.style.notes = '科技感商业广告质感；保留真实拍摄感和产品可读性，UI 只作为轻量增强层。';
        }
        ctrl.uiExpanded = true;
        markSourceDirty('scene');
        renderAll();
        scheduleAutoSave('environment_control');
        return;
      }
      const controlAi = target.closest('[data-nsa-control-ai]');
      if (controlAi && host.contains(controlAi)) {
        return;
      }
      const methodInput = target.closest('[data-nsa-control-product-method]');
      if (methodInput && host.contains(methodInput)) {
        e.stopPropagation();
        const ctrl = controlledProduction();
        const value = methodInput.dataset.nsaControlProductMethod || '';
        const methods = new Set(ctrl.product.methods || []);
        if (methodInput.checked) methods.add(value);
        else methods.delete(value);
        ctrl.product.methods = Array.from(methods).filter(Boolean);
        ctrl.uiExpanded = true;
        markSourceDirty('product');
        renderAdvancedControls();
        renderStatus();
        scheduleAutoSave('product_method');
        return;
      }
      const productPreview = target.closest('[data-nsa-product-preview]');
      if (productPreview && host.contains(productPreview)) {
        e.preventDefault();
        e.stopPropagation();
        openPreview(previewUrl(state.productAsset), state.productAsset?.name || '商品/主体图');
        return;
      }
      const assetPreview = target.closest('[data-nsa-asset-preview]');
      if (assetPreview && host.contains(assetPreview)) {
        e.preventDefault();
        e.stopPropagation();
        const asset = state.referenceAssets[Number(assetPreview.dataset.nsaAssetPreview || 0)];
        openPreview(previewUrl(asset), asset?.name || '参考素材');
        return;
      }
      const personPreview = target.closest('[data-nsa-person-preview]');
      if (personPreview && host.contains(personPreview)) {
        e.preventDefault();
        e.stopPropagation();
        const asset = state.personAsset || state.actorAsset || null;
        const entry = actorViewEntries(asset)[Number(personPreview.dataset.nsaPersonPreview || 0)] || null;
        if (entry?.url) openPreview(withAuthQuery(entry.url), `${asset?.name || '人物参考'} · ${entry.label || ''}`);
        return;
      }
      const candidatePreview = target.closest('[data-nsa-candidate-preview]');
      if (candidatePreview && host.contains(candidatePreview)) {
        e.preventDefault();
        e.stopPropagation();
        const [shotIndex, candidateIndex] = String(candidatePreview.dataset.nsaCandidatePreview || '').split(':').map(Number);
        const candidate = state.keyframes?.[shotIndex]?.candidates?.[candidateIndex];
        if (candidate?.image_url || candidate?.imageUrl) openPreview(withAuthQuery(candidate.image_url || candidate.imageUrl), `\u7b2c ${shotIndex + 1} \u955c\u5019\u9009 ${candidateIndex + 1}`);
        return;
      }
      const candidateReview = target.closest('[data-nsa-candidate-review]');
      if (candidateReview && host.contains(candidateReview)) {
        e.preventDefault();
        e.stopPropagation();
        const raw = String(candidateReview.dataset.nsaCandidateReview || '');
        const separator = raw.indexOf(':');
        const shotIndex = Number(raw.slice(0, separator));
        const candidateId = raw.slice(separator + 1);
        if (!state.taskId || separator < 1 || !candidateId) {
          toast('无法识别要重新验证的候选画面', 'error');
          return;
        }
        setButtonBusy(candidateReview, true, '验证中...');
        try {
          const response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(state.taskId)}/keyframes/${shotIndex}/candidates/${encodeURIComponent(candidateId)}/review`, { method: 'POST', body: {} });
          state.keyframes = response.keyframes || state.keyframes;
          if (response.status === 'accepted') {
            state.videoClips = [];
            state.finalVideo = null;
            toast('现有候选画面已通过 QA 并采用，没有重新生成图片', 'success');
          } else if (response.status === 'qa_unavailable') {
            toast('视觉审核服务仍然异常，原图已保留，可稍后再次验证', 'warning');
          } else {
            toast(`重新验证完成：${response.qa?.mismatch_reasons?.join('；') || response.qa?.error || '画面未通过当前要求'}`, 'error');
          }
          renderAll();
        } catch (error) {
          toast(error.message || '候选画面重新验证失败', 'error');
        } finally {
          setButtonBusy(candidateReview, false);
        }
        return;
      }
      const candidateOverride = target.closest('[data-nsa-candidate-override]');
      if (candidateOverride && host.contains(candidateOverride)) {
        e.preventDefault();
        e.stopPropagation();
        const raw = String(candidateOverride.dataset.nsaCandidateOverride || '');
        const separator = raw.indexOf(':');
        const shotIndex = Number(raw.slice(0, separator));
        const candidateId = raw.slice(separator + 1);
        if (!state.taskId || separator < 1 || !candidateId) {
          toast('无法识别要人工确认的候选画面', 'error');
          return;
        }
        const confirmed = await confirmNsaAction({
          title: `人工采用第 ${shotIndex + 1} 镜候选图`,
          summary: '覆盖自动审核结论，但完整保留原始记录',
          description: '请确认你已经查看大图，并且接受当前画面与创作要求之间的差异。',
          confirmLabel: '确认采用',
          tone: 'primary',
          facts: [{ value: '0', label: '新增生成消耗', tone: 'pass' }],
          note: '这一步不会重新生成图片。系统会记录人工确认人、时间和原始 QA 结果。',
        });
        if (!confirmed) return;
        setButtonBusy(candidateOverride, true, '确认中...');
        try {
          const response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(state.taskId)}/keyframes/${shotIndex}/candidates/${encodeURIComponent(candidateId)}/manual-accept`, {
            method: 'POST',
            body: { reason: '用户在分镜页确认当前画面符合创作意图', source: 'story_ad_keyframe_review' },
          });
          state.keyframes = response.keyframes || state.keyframes;
          state.videoClips = [];
          state.finalVideo = null;
          renderAll();
          toast(`第 ${shotIndex + 1} 镜已人工确认采用，原始 QA 记录已保留`, 'success');
        } catch (error) {
          toast(error.message || '人工确认候选画面失败', 'error');
        } finally {
          setButtonBusy(candidateOverride, false);
        }
        return;
      }
      const candidateUse = target.closest('[data-nsa-candidate-use]');
      if (candidateUse && host.contains(candidateUse)) {
        e.preventDefault();
        e.stopPropagation();
        const raw = String(candidateUse.dataset.nsaCandidateUse || '');
        const separator = raw.indexOf(':');
        const shotIndex = Number(raw.slice(0, separator));
        const candidateId = raw.slice(separator + 1);
        setButtonBusy(candidateUse, true, '\u9009\u7528\u4e2d...');
        try {
          const response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(state.taskId)}/keyframes/${shotIndex}/select`, { method: 'PUT', body: { candidate_id: candidateId } });
          state.keyframes = response.keyframes || state.keyframes;
          state.videoClips = [];
          state.finalVideo = null;
          renderAll();
          toast('\u5df2\u9009\u7528\u901a\u8fc7 QA \u7684\u5019\u9009\u5173\u952e\u5e27，下游视频将按新图重新生成', 'success');
        } catch (error) {
          toast(error.message || '\u5019\u9009\u5173\u952e\u5e27\u9009\u7528\u5931\u8d25', 'error');
        } finally {
          setButtonBusy(candidateUse, false);
        }
        return;
      }
      const personVerify = target.closest('[data-nsa-person-verify]');
      if (personVerify && host.contains(personVerify)) {
        e.preventDefault();
        e.stopPropagation();
        setButtonBusy(personVerify, true, '验证中...');
        try {
          const response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(state.taskId)}/person-verify`, { method: 'POST', body: {} });
          const asset = state.personAsset || state.actorAsset || {};
          const next = { ...asset, ...(response.person_asset || {}), person_contract: response.person_contract };
          if (state.personAsset) state.personAsset = next;
          else state.actorAsset = next;
          state.context = { ...(state.context || {}), person_asset: next, person_contract: response.person_contract };
          renderAll();
          const result = verificationView(response.person_contract, 'cross_view_qa', '人物');
          toast(result.message || result.label, result.tone === 'verified' ? 'success' : (result.tone === 'unavailable' ? 'warning' : 'error'));
        } catch (error) {
          toast(error.message || '人物重新验证失败', 'error');
        } finally {
          setButtonBusy(personVerify, false);
        }
        return;
      }
      const productVerify = target.closest('[data-nsa-product-verify]');
      if (productVerify && host.contains(productVerify)) {
        e.preventDefault();
        e.stopPropagation();
        setButtonBusy(productVerify, true, '验证中...');
        try {
          const response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(state.taskId)}/product-verify`, { method: 'POST', body: {} });
          state.context = { ...(state.context || {}), product_contract: response.product_contract };
          if (state.productAsset) state.productAsset = { ...state.productAsset, product_contract: response.product_contract };
          renderAll();
          const result = verificationView(response.product_contract, 'reference_qa', '产品');
          toast(result.message || result.label, result.tone === 'verified' ? 'success' : (result.tone === 'unavailable' ? 'warning' : 'error'));
        } catch (error) {
          toast(error.message || '产品验证失败', 'error');
        } finally {
          setButtonBusy(productVerify, false);
        }
        return;
      }
      const sceneVerify = target.closest('[data-nsa-scene-verify]');
      if (sceneVerify && host.contains(sceneVerify)) {
        e.preventDefault();
        e.stopPropagation();
        await window.NewStoryAdSceneAssets?.verify?.({ state, api, normalizeBundle, renderAll, setButtonBusy, toast, button: sceneVerify, sceneId: sceneVerify.dataset.nsaSceneVerify });
        return;
      }
      const scenePreview = target.closest('[data-nsa-scene-preview]');
      if (scenePreview && host.contains(scenePreview)) {
        e.preventDefault();
        e.stopPropagation();
        const [assetRaw, viewRaw] = String(scenePreview.dataset.nsaScenePreview || '0:0').split(':');
        const asset = (state.sceneAssets || [])[Number(assetRaw || 0)] || null;
        const views = Array.isArray(asset?.view_images) ? asset.view_images : [];
        const entry = views[Number(viewRaw || 0)] || null;
        const url = entry?.url || entry?.image_url || '';
        if (url) openPreview(withAuthQuery(url), `${asset?.name || '场景四视图'} · ${entry.label || ''}`);
        return;
      }
      const sceneSelect = target.closest('[data-nsa-scene-select]');
      if (sceneSelect && host.contains(sceneSelect)) {
        e.preventDefault();
        e.stopPropagation();
        state.sceneSelectedIndex = Number(sceneSelect.dataset.nsaSceneSelect || 0) || 0;
        renderAll();
        return;
      }
      const sceneDelete = target.closest('[data-nsa-scene-delete]');
      if (sceneDelete && host.contains(sceneDelete)) {
        e.preventDefault();
        e.stopPropagation();
        const index = Number(sceneDelete.dataset.nsaSceneDelete || -1);
        if (!Number.isInteger(index) || index < 0 || index >= (state.sceneAssets || []).length) return;
        const removed = (state.sceneAssets || [])[index];
        state.sceneAssets = (state.sceneAssets || []).filter((_, i) => i !== index);
        state.sceneSelectedIndex = Math.max(0, Math.min(state.sceneAssets.length - 1, Number(state.sceneSelectedIndex || 0)));
        renderAll();
        if (state.taskId) {
          saveSceneAssetsProgress(state.taskId).then(() => {
            renderAll();
            toast(`已删除 ${removed?.name || '场景空间锁'}`, 'success');
          }).catch(err => {
            toast(err.message || '场景删除保存失败', 'error');
          });
        } else {
          toast(`已删除 ${removed?.name || '场景空间锁'}`, 'success');
        }
        return;
      }
      const blueprintAdd = target.closest('[data-nsa-blueprint-add]');
      if (blueprintAdd && host.contains(blueprintAdd)) {
        e.preventDefault();
        e.stopPropagation();
        const beats = blueprintBeats();
        beats.push({
          beat_index: beats.length + 1,
          duration: 3,
          duration_sec: 3,
          title: `补充镜头 ${beats.length + 1}`,
          role: '补充',
          plot: '',
          visual: '',
          action: '',
          spoken_line: '',
          visual_proof: '',
          confirmed: true,
        });
        state.blueprintDirty = true;
        state.storyboardStatus = { ready: false, stale: true, reason: 'BLUEPRINT_EDITED' };
        renderBlueprint();
        scheduleAutoSave('blueprint_add');
        return;
      }
      const blueprintDelete = target.closest('[data-nsa-blueprint-delete]');
      if (blueprintDelete && host.contains(blueprintDelete)) {
        e.preventDefault();
        e.stopPropagation();
        const beats = blueprintBeats();
        const index = Number(blueprintDelete.dataset.nsaBlueprintDelete || 0);
        if (beats.length <= 1) return toast('至少保留 1 个镜头', 'error');
        beats.splice(index, 1);
        beats.forEach((beat, i) => { beat.beat_index = i + 1; beat.index = i + 1; });
        state.blueprintDirty = true;
        state.storyboardStatus = { ready: false, stale: true, reason: 'BLUEPRINT_EDITED' };
        renderBlueprint();
        scheduleAutoSave('blueprint_delete');
        return;
      }
      const shotUpload = target.closest('[data-nsa-shot-upload]');
      if (shotUpload && host.contains(shotUpload)) {
        e.preventDefault();
        e.stopPropagation();
        state.pendingShotUploadIndex = Number(shotUpload.dataset.nsaShotUpload || 0);
        const input = within('#dhNsaAdAssetFile');
        if (input) input.click();
        return;
      }
      const framePreview = target.closest('[data-nsa-frame-preview]');
      if (framePreview && host.contains(framePreview)) {
        e.preventDefault();
        e.stopPropagation();
        const index = Number(framePreview.dataset.nsaFramePreview || 0);
        const frame = state.keyframes[index] || {};
        const url = frame.image_url || frame.imageUrl || frame.url || '';
        if (url) openPreview(withAuthQuery(url), `\u7b2c ${index + 1} \u955c\u5927\u56fe`);
        else toast(`\u7b2c ${index + 1} \u955c\u6682\u65e0\u53ef\u9884\u89c8\u56fe\u7247`, 'info');
        return;
      }
      const shotEdit = target.closest('[data-nsa-shot-edit]');
      if (shotEdit && host.contains(shotEdit)) {
        e.preventDefault();
        e.stopPropagation();
        openShotEditorModal(Number(shotEdit.dataset.nsaShotEdit || 0));
        return;
      }
      const shotEditClose = target.closest('[data-nsa-shot-edit-close]');
      if (shotEditClose && host.contains(shotEditClose)) {
        e.preventDefault();
        e.stopPropagation();
        closeShotEditorModal({ keepChanges: false, rerender: true });
        return;
      }
      const promptPreview = target.closest('[data-nsa-prompt-preview]');
      if (promptPreview && host.contains(promptPreview)) {
        e.preventDefault();
        e.stopPropagation();
        await previewSingleShotPrompts(Number(promptPreview.dataset.nsaPromptPreview || 0), promptPreview);
        return;
      }
      const shotRegenerate = target.closest('[data-nsa-shot-regenerate]');
      if (shotRegenerate && host.contains(shotRegenerate)) {
        e.preventDefault();
        e.stopPropagation();
        const index = Number(shotRegenerate.dataset.nsaShotRegenerate || 0);
        syncShotFieldsFromDom(index, host);
        toast(`\u5df2\u63d0\u4ea4\u7b2c ${index + 1} \u955c\u91cd\u65b0\u751f\u6210`, 'info');
        await regenerateSingleKeyframe(index, shotRegenerate);
        return;
      }
      const videoRegenerate = target.closest('[data-nsa-video-regenerate]');
      if (videoRegenerate && host.contains(videoRegenerate)) {
        e.preventDefault();
        e.stopPropagation();
        const index = Number(videoRegenerate.dataset.nsaVideoRegenerate || 0);
        const members = videoClipAt(index).scene_block_members;
        const linked = Array.isArray(members) ? members.map(Number).filter(Number.isInteger) : [];
        const scope = linked.length > 1
          ? `第 ${linked.join('、')} 镜属于同一个连续镜组，将作为一段视频一起重做`
          : `仅重新生成第 ${index + 1} 镜视频`;
        const plan = linked.length > 1
          ? linked.flatMap(member => videoPlanItems({ onlyIndex: member - 1, regenerateExisting: true }))
          : videoPlanItems({ onlyIndex: index, regenerateExisting: true });
        if (!await confirmNsaAction({
          title: linked.length > 1 ? '重做连续镜组视频' : `重做第 ${index + 1} 镜视频`,
          summary: scope,
          description: '系统使用当前已审核分镜图作为视频首帧，只执行一次生成，不会自动连续重试。',
          confirmLabel: linked.length > 1 ? '确认重做镜组' : '确认重做本镜',
          tone: 'danger',
          facts: [{ value: '1 次', label: '预计模型生成', tone: 'warning' }, { value: '0 次', label: '自动重试', tone: 'pass' }],
          items: plan,
          note: '连续镜组会按一段视频生成，费用与对应总时长有关。',
        })) return;
        await runStage('video', videoRegenerate);
        return;
      }
      const videoAccept = target.closest('[data-nsa-video-accept]');
      if (videoAccept && host.contains(videoAccept)) {
        e.preventDefault();
        e.stopPropagation();
        const index = Number(videoAccept.dataset.nsaVideoAccept || 0);
        if (!await confirmNsaAction({
          title: `接受第 ${index + 1} 镜当前视频`,
          summary: '人工确认后允许进入最终合成',
          description: '请确认你已经完整播放本镜视频，并接受自动 QA 指出的差异。',
          confirmLabel: '确认接受当前视频',
          tone: 'primary',
          facts: [{ value: '0', label: '新增生成消耗', tone: 'pass' }],
          items: videoPlanItems({ onlyIndex: index }).map(item => ({ ...item, action: '人工接受' })),
          note: '自动 QA 的原始结论仍会保留，之后也可以再次重做本镜视频。',
        })) return;
        setButtonBusy(videoAccept, true, '确认中...');
        try {
          const id = await ensureTask();
          const response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/video/${index}/manual-accept`, {
            method: 'POST',
            body: { reason: '用户已在分镜页面查看并接受当前视频效果', source: 'story_ad_ui' },
          });
          normalizeBundle(response);
          renderAll();
          toast(`第 ${index + 1} 镜已人工确认接受，没有重新生成视频`, 'success');
        } catch (error) {
          toast(error.message || `第 ${index + 1} 镜确认失败`, 'error');
        } finally {
          setButtonBusy(videoAccept, false);
        }
        return;
      }
      if (!btn || !host.contains(btn)) return;
      const id = btn.id || '';
      const handled = {
        dhNsaAdGenerate: () => runStage('scene', btn),
        dhNsaAdStoryboard: () => runStage('blueprint', btn),
        dhNsaAdPreviewFrames: () => runStage('storyboard', btn),
        dhNsaAdScriptRegenerateTop: () => runStage('blueprint', btn),
        dhNsaAdRegenerateScriptFromStep4: () => runStage('blueprint', btn),
        dhNsaAdGenerateFinalFrames: () => runStage('keyframes', btn),
        dhNsaAdRegenerateAllShotVideos: async () => {
          const estimate = videoGenerationEstimate({ regenerateAll: true });
          const plan = videoPlanItems({ regenerateAll: true });
          const existingCount = plan.filter(item => item.view.hasVideo).length;
          if (!await confirmNsaAction({
            title: '重新生成全部镜头视频',
            summary: `将处理全部 ${estimate.count} 个镜头，已有视频也会被新版本替换`,
            description: '这是全量重做操作。每个独立镜头或连续镜组只提交一次，不会因 QA 失败自动继续重抽。',
            confirmLabel: `确认重新生成 ${estimate.count} 镜`,
            tone: 'danger',
            facts: [
              { value: String(estimate.count), label: '处理镜头', tone: 'warning' },
              { value: String(existingCount), label: '将替换已有视频', tone: existingCount ? 'danger' : 'neutral' },
              { value: '0', label: '自动重试', tone: 'pass' },
            ],
            items: plan,
            note: '点击确认后才会进入生成状态；点击取消不会改变按钮和任务状态。',
          })) return false;
          return runStage('video', btn);
        },
        dhNsaAdGenerateShotVideos: async () => {
          const estimate = videoGenerationEstimate();
          if (!estimate.count) return toast('当前镜头视频均已通过，无需补齐或修复', 'success');
          const plan = videoPlanItems();
          const missingCount = plan.filter(item => !item.view.hasVideo).length;
          const reviewCount = plan.filter(item => item.view.hasVideo).length;
          if (!await confirmNsaAction({
            title: '补齐或修复镜头视频',
            summary: `只处理 ${estimate.count} 个未通过、未审核或缺失的镜头`,
            description: '已通过的视频保持不动；已有但未通过的视频只按最新规则复审，复审仍未通过也不会自动付费重做。',
            confirmLabel: `确认处理 ${estimate.count} 镜`,
            tone: 'primary',
            facts: [
              { value: String(missingCount), label: '未生成', tone: missingCount ? 'warning' : 'neutral' },
              { value: String(reviewCount), label: '先审核', tone: reviewCount ? 'review' : 'neutral' },
              { value: '0', label: '自动重试', tone: 'pass' },
            ],
            items: plan,
            note: `点击确认后才开始处理；本轮最多新增生成 ${missingCount} 个缺失镜头，已有视频复审不产生新的视频生成费用。`,
          })) return false;
          return runStage('video', btn);
        },
        dhNsaAdFillMissingFramesTop: () => runStage('keyframes', btn),
        dhNsaAdRegenerateFrames: () => runStage('keyframes', btn),
        dhNsaAdDetectStyle: () => runStage('scene', btn),
        dhNsaAdAutoVisuals: () => runStage('keyframes', btn),
        dhNsaAdGoCompose: () => {
          const compose = composeReadiness();
          if (!compose.ready) return toast(compose.message || '请先修复所有未通过审核的镜头', 'error');
          return showStep(5);
        },
        dhNsaAdConfirmGenerate: () => runMediaChain(btn),
        dhNsaAdWrite: () => assist('write', btn),
        dhNsaAdClean: () => assist('clean', btn),
        dhNsaAdSample: () => {
          const text = within('#dhNsaAdText');
          if (text) text.value = SAMPLE_BRIEF;
          markSourceDirty('source');
          renderStatus();
          scheduleAutoSave('sample_brief');
        },
        dhNsaAdGeneratePersonSheet: () => generatePersonSheet(btn),
        dhNsaAdAiSceneSpec: () => fillSceneSpecFromBrief(btn),
        dhNsaAdGenerateSceneSheet: () => {
          if (!window.NewStoryAdSceneAssets?.generate) return toast('场景四视图模块未加载，请刷新页面后重试。', 'error');
          return window.NewStoryAdSceneAssets.generate({
            state,
            ensureTask,
            api,
            payload,
            normalizeBundle,
            renderAll,
            setBusy,
            setButtonBusy,
            toast,
            button: btn,
            append: false,
          });
        },
        dhNsaAdAddSceneSheet: () => {
          if (!window.NewStoryAdSceneAssets?.generate) return toast('场景四视图模块未加载，请刷新页面后重试。', 'error');
          return window.NewStoryAdSceneAssets.generate({
            state,
            ensureTask,
            api,
            payload,
            normalizeBundle,
            renderAll,
            setBusy,
            setButtonBusy,
            toast,
            button: btn,
            append: true,
          });
        },
        dhNsaAdVoiceOpen: () => openNsaVoiceModal(),
        dhNsaAdMusicLibrary: () => openNsaMusicLibrary(),
        dhNsaAdBgmUpload: () => within('#dhNsaAdBgmFile')?.click(),
        dhNsaAdBgmClear: () => {
          revokePreview(state.bgmAsset);
          state.bgmAsset = null;
          state.finalVideo = null;
          renderAll();
          scheduleAutoSave('bgm_clear');
          toast('已设为无背景音乐，可直接合成', 'success');
        },
        dhNsaAdSubtitleStyleBtn: () => openNsaSubtitleStyleModal(),
        dhNsaAdProductDrop: () => within('#dhNsaAdProductFile')?.click(),
        dhNsaAdProductDropInline: () => within('#dhNsaAdProductFile')?.click(),
        dhNsaAdProductClear: () => { revokePreview(state.productAsset); state.productAsset = null; markSourceDirty('product'); renderAll(); scheduleAutoSave('product_clear'); toast('主体图已删除', 'success'); },
        dhNsaAdProductClearInline: () => { revokePreview(state.productAsset); state.productAsset = null; markSourceDirty('product'); renderAll(); scheduleAutoSave('product_clear'); toast('主体图已删除', 'success'); },
        dhNsaAdAssetDrop: () => within('#dhNsaAdAssetFile')?.click(),
        dhNsaAdUploadPersonRef: () => within('#dhNsaAdPersonFile')?.click(),
        dhNsaAdPickActorAsset: () => openActorLibrary(),
        dhNsaAdAiPersonSpec: () => fillPersonSpecFromBrief(btn),
      }[id];
      if (!handled) return;
      e.preventDefault();
      e.stopPropagation();
      handled();
    }, true);
    host.addEventListener('input', e => {
      const target = e.target;
      if (updateShotField(target)) {
        renderStatus();
        return;
      }
      if (updateBlueprintField(target)) {
        refreshBlueprintMetrics();
        renderStatus();
        return;
      }
      if (target?.id === 'dhNsaAdText') {
        markSourceDirty('source');
        renderStatus();
        return;
      }
      if (target?.matches?.('[data-nsa-control-custom-env]')) {
        const ctrl = controlledProduction();
        ctrl.environment.custom = target.value || '';
        ctrl.uiExpanded = true;
        markSourceDirty('scene');
        renderStatus();
        return;
      }
      if (target?.matches?.('[data-nsa-control-style-notes]')) {
        const ctrl = controlledProduction();
        ctrl.style.notes = target.value || '';
        ctrl.uiExpanded = true;
        markSourceDirty('scene');
        renderStatus();
        return;
      }
      if (target?.matches?.('[data-nsa-control-negative]')) {
        const ctrl = controlledProduction();
        ctrl.negative.text = target.value || '';
        ctrl.uiExpanded = true;
        markSourceDirty('scene');
        renderStatus();
        return;
      }
      if (target?.id === 'dhNsaAdVoiceVolume') {
        state.voiceVolume = Math.max(0.6, Math.min(1.2, Number(target.value || 100) / 100));
        renderAudio();
        return;
      }
      if (target?.id === 'dhNsaAdBgmVolume') {
        state.bgmVolume = Math.max(0, Math.min(0.35, Number(target.value || 16) / 100));
        renderAudio();
        return;
      }
      if (target?.matches?.('[data-nsa-person-spec]')) {
        markSourceDirty('person');
        renderStatus();
        return;
      }
      if (target?.matches?.('[data-nsa-scene-spec]')) {
        markSourceDirty('scene');
        renderStatus();
      }
    });
    host.addEventListener('change', e => {
      const target = e.target;
      if (updateShotField(target)) {
        renderStatus();
        return;
      }
      if (updateBlueprintField(target)) {
        refreshBlueprintMetrics();
        renderStatus();
        return;
      }
      if (target?.matches?.('[data-nsa-control-product-enabled]')) {
        const ctrl = controlledProduction();
        ctrl.product.enabled = !!target.checked;
        ctrl.uiExpanded = true;
        markSourceDirty('product');
        renderAdvancedControls();
        renderStatus();
        return;
      }
      if (target?.matches?.('[data-nsa-control-product-presence]')) {
        const ctrl = controlledProduction();
        ctrl.product.presence = target.value || 'medium';
        ctrl.uiExpanded = true;
        markSourceDirty('product');
        renderStatus();
        return;
      }
      if (target?.matches?.('[data-nsa-control-product-lock]')) {
        const ctrl = controlledProduction();
        ctrl.product.lockStrength = target.value || 'standard';
        ctrl.uiExpanded = true;
        markSourceDirty('product');
        renderStatus();
        return;
      }
      if (target?.id === 'dhNsaAdDuration') {
        markSourceDirty('source');
        syncOptionControls();
        renderStatus();
        return;
      }
      if (target?.id === 'dhNsaAdRatio') {
        state.outputRatio = target.value || '9:16';
        markSourceDirty();
        renderAll();
        return;
      }
      if (target?.id === 'dhNsaAdSize') {
        state.outputSize = target.value || 'standard';
        markSourceDirty();
        renderAll();
        return;
      }
      if (target?.id === 'dhNsaAdVideoResolution') {
        state.videoResolution = VIDEO_RESOLUTION_LABELS[target.value] ? target.value : '720p';
        syncOptionControls();
        return;
      }
      if (target?.id === 'dhNsaAdSceneMode') {
        markSourceDirty('scene');
        renderStatus();
        return;
      }
      if (target?.id === 'dhNsaAdSubtitleToggle') {
        state.subtitleEnabled = !!target.checked;
        const select = within('#dhNsaAdSubtitle');
        if (select) select.value = state.subtitleEnabled ? 'on' : 'off';
        renderStatus();
        return;
      }
      if (target?.id === 'dhNsaAdSubtitle') {
        state.subtitleEnabled = target.value !== 'off';
        const toggle = within('#dhNsaAdSubtitleToggle');
        if (toggle) toggle.checked = state.subtitleEnabled;
        renderStatus();
        return;
      }
      if (target?.id === 'dhNsaAdProductFile') {
        const file = target.files?.[0];
        target.value = '';
        uploadProductFile(file);
        return;
      }
      if (target?.id === 'dhNsaAdPersonFile') {
        const file = target.files?.[0];
        target.value = '';
        uploadPersonFile(file);
        return;
      }
      if (target?.id === 'dhNsaAdAssetFile') {
        const files = target.files;
        const shotIndex = state.pendingShotUploadIndex;
        state.pendingShotUploadIndex = null;
        target.value = '';
        uploadReferenceFiles(files, shotIndex);
        return;
      }
      if (target?.id === 'dhNsaAdBgmFile') {
        const file = target.files?.[0];
        target.value = '';
        uploadBgmFile(file);
        return;
      }
      if (target?.matches?.('[data-nsa-person-spec]')) {
        markSourceDirty('person');
        if (target.dataset.nsaPersonSpec === 'castMode') {
          renderAll();
          toast(target.value === 'no_human'
            ? '已切换为无人物模式，人物素材和演员不会进入后续生成'
            : '已恢复按内容判断人物，当前设置会自动保存', 'success');
        } else {
          renderStatus();
        }
      }
    });
    const scheduleFieldAutoSave = e => {
      const target = e.target;
      if (!target?.matches?.('input:not([type="file"]):not([type="search"]), textarea, select')) return;
      scheduleAutoSave('form_field');
    };
    host.addEventListener('input', scheduleFieldAutoSave);
    host.addEventListener('change', scheduleFieldAutoSave);
    host.addEventListener('toggle', e => {
      const details = e.target;
      if (!details?.matches?.('[data-nsa-control-box]')) return;
      const ctrl = controlledProduction();
      ctrl.uiExpanded = !!details.open;
      const label = details.querySelector('.dh-luxgen-control-meta i');
      if (label) label.textContent = details.open ? '收起设置' : '展开设置';
    }, true);
    ['#dhNsaAdProductDrop', '#dhNsaAdAssetDrop'].forEach(selector => {
      const drop = within(selector);
      if (!drop) return;
      drop.addEventListener('dragover', event => {
        event.preventDefault();
        drop.classList.add('dragover');
      });
      drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
      drop.addEventListener('drop', event => {
        event.preventDefault();
        drop.classList.remove('dragover');
        if (selector === '#dhNsaAdProductDrop') uploadProductFile(event.dataTransfer?.files?.[0]);
        else uploadReferenceFiles(event.dataTransfer?.files || []);
      });
    });
  }

  window.__newStoryAdLegacyUI = { mount, state, showStep, renderAll, resetForNewSession };
  document.addEventListener('new-story-ad:mount', mount);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.querySelector('.dh-tab-pane[data-pane="new-story-ad"].active')) mount();
    });
  } else if (document.querySelector('.dh-tab-pane[data-pane="new-story-ad"].active')) {
    mount();
  }
})();

