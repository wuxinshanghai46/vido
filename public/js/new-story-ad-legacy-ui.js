(() => {
  const ROOT_ID = 'dhNewStoryAdLegacyMount';
  const TASK_STORAGE_KEY = 'vido_new_story_ad_current_task_id';
  const SAMPLE_BRIEF = '我想做一条不锈钢产品的剧情广告：展示不锈钢可以打造高级背景墙、家居展台和不同纹理颜色搭配，让用户看到原料到高端空间效果的变化，节奏沉稳、有真人看细节，最后引导联系定制。';
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
    ['warm', '温暖叙事', '适合生活方式、家居、服务类剧情。'],
    ['premium', '高级质感', '适合品牌、空间、产品质感表达。'],
    ['tech', '科技律动', '适合软件、数据、效率工具。'],
  ];

  const state = {
    mounted: false,
    token: sessionStorage.getItem('vido_token') || localStorage.getItem('vido_token') || localStorage.getItem('token') || '',
    taskId: '',
    context: null,
    sceneConfig: null,
    blueprint: null,
    shots: [],
    contracts: [],
    keyframes: [],
    review: null,
    ttsAudio: null,
    videoClips: [],
    finalVideo: null,
    actorAsset: null,
    personAsset: null,
    personSpecLock: null,
    castProfiles: [],
    personGenerationProgress: null,
    productAsset: null,
    referenceAssets: [],
    bgmAsset: null,
    bgmProfile: 'auto',
    voiceId: '',
    voiceVolume: 1,
    bgmVolume: 0.16,
    outputRatio: '9:16',
    outputSize: 'standard',
    videoResolution: '720p',
    subtitleEnabled: true,
    pendingShotUploadIndex: null,
    controlledProduction: {
      environment: { mode: 'auto', custom: '' },
      product: { enabled: false, presence: 'medium', lockStrength: 'standard', methods: [] },
      style: { mode: 'classic', notes: '' },
      negative: { text: '' },
      uiExpanded: false,
    },
    controlAiPending: {},
    busy: false,
    currentStep: 1,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const root = () => document.getElementById(ROOT_ID);
  const within = sel => $(sel, root() || document);

  function routeStep() {
    try {
      const step = Number(new URLSearchParams(location.search || '').get('nsa_step') || 0);
      if (Number.isFinite(step) && step >= 1 && step <= 5) return Math.round(step);
    } catch {}
    return 1;
  }

  function routeTaskId() {
    try {
      return normalizeText(new URLSearchParams(location.search || '').get('nsa_task_id') || '', 100);
    } catch {
      return '';
    }
  }

  function storedTaskId() {
    try {
      return normalizeText(localStorage.getItem(TASK_STORAGE_KEY) || '', 100);
    } catch {
      return '';
    }
  }

  function rememberTaskId(taskId = state.taskId) {
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

  function normalizeText(value = '', max = 1000) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
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

  function compactUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw || /^blob:/i.test(raw) || /^data:/i.test(raw)) return '';
    return raw;
  }

  function actorUrls(asset = {}) {
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

  function actorReferenceKind(asset = {}) {
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
      description: asset.description || metadata.description || '授权真人/演员素材，会作为新剧情广告人物一致性参考。',
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
    const next = { ...spec, castMode };
    if (gender) next.gender = gender;
    if (age) next.age = age;
    if (origin) next.origin = origin;
    Object.entries(next).forEach(([key, value]) => {
      const el = root()?.querySelector(`[data-nsa-person-spec="${key}"]`);
      if (el && value !== undefined && value !== null) el.value = value;
    });
    state.personSpecLock = {
      source: asset.name || asset.actor_asset_id || asset.id || '已选演员',
      actor_asset_id: asset.actor_asset_id || asset.asset_library_id || asset.material_id || asset.id || '',
      gender,
      age,
      origin,
      castMode,
      expected_people: count || (castMode === 'group' ? 3 : (castMode === 'dual' ? 2 : 1)),
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
    $$('[data-nsa-person-spec]', root()).forEach(el => {
      const key = el.dataset.nsaPersonSpec;
      if (!key) return;
      spec[key] = String(el.value || '').trim();
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

  function assetPayloadList() {
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
    add(state.personAsset || state.actorAsset, 'person_reference');
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
      const err = new Error(apiErrorMessage(data?.error) || apiErrorMessage(data?.message) || raw.slice(0, 180) || `HTTP ${resp.status}`);
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data || {};
  }

  function setCopy() {
    const title = within('#dhNsaAdModeTitle');
    const sub = within('#dhNsaAdModeSub');
    if (title) title.textContent = '新剧情广告';
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
      ['#dhNsaAdGenerateFinalFrames', '按脚本生成真实关键帧'],
      ['#dhNsaAdGoCompose', '确认分镜，进入广告合成'],
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
      host.innerHTML = '<div class="dh-luxgen-empty"><b>新剧情广告界面模板未找到</b><span>请刷新页面后重试。</span></div>';
      return;
    }
    host.dataset.mounted = '1';
    state.mounted = true;
    setCopy();
    bind();
    showStep(routeStep(), { remember: false });
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
    const subject = state.sceneConfig?.advertised_subject || brief.slice(0, 36) || '新剧情广告';
    const person = collectPersonSpec();
    const personAsset = personAssetPayload();
    const castProfiles = state.castProfiles.length ? state.castProfiles : (castProfileFromPersonAsset() ? [castProfileFromPersonAsset()] : []);
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
      cast_mode: personSpec('castMode') || 'auto',
      voice_id: voiceId,
      subtitle: state.subtitleEnabled,
      voice_volume: state.voiceVolume,
      bgm_volume: state.bgmVolume,
      bgm_asset: state.bgmAsset,
      assets: assetPayloadList(),
      references: assetPayloadList(),
      person_spec: person,
      person_asset: personAsset,
      cast_profiles: castProfiles,
      person_context: {
        source: personAsset ? 'selected_real_actor_or_person_asset' : 'person_spec',
        person_spec: person,
        person_asset: personAsset,
        cast_profiles: castProfiles,
        person_notes: [personDescription(person)].filter(Boolean),
        real_person_locked: !!(personAsset && personAsset.real_person_reference),
        production_usable_actor: !!(personAsset && personAsset.production_usable_actor),
      },
      controlled_production: ctrl,
      forbidden: negative,
      source: 'new_story_ad_old_ui_clone',
    };
  }

  function personSpec(name) {
    const el = root()?.querySelector(`[data-nsa-person-spec="${name}"]`);
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

  function markSourceDirty() {
    state.taskId = '';
    rememberTaskId('');
    state.context = null;
    state.sceneConfig = null;
    state.blueprint = null;
    state.shots = [];
    state.contracts = [];
    state.keyframes = [];
    state.review = null;
    state.ttsAudio = null;
    state.videoClips = [];
    state.finalVideo = null;
  }

  function resetForNewSession() {
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
    state.productAsset = null;
    state.referenceAssets.forEach(revokePreview);
    state.referenceAssets = [];
    state.bgmAsset = null;
    state.bgmProfile = 'auto';
    state.voiceId = '';
    state.voiceVolume = 1;
    state.bgmVolume = 0.16;
    state.outputRatio = '9:16';
    state.outputSize = 'standard';
    state.videoResolution = '720p';
    state.subtitleEnabled = true;
    state.pendingShotUploadIndex = null;
    state.controlledProduction = {
      environment: { mode: 'auto', custom: '' },
      product: { enabled: false, presence: 'medium', lockStrength: 'standard', methods: [] },
      style: { mode: 'classic', notes: '' },
      negative: { text: '' },
      uiExpanded: false,
    };
    state.controlAiPending = {};
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
        if (el.dataset.nsaPersonSpec === 'origin') el.value = 'east_asian_cn';
        else if (el.dataset.nsaPersonSpec === 'age') el.value = 'match_brief';
        else el.value = el.querySelector('option')?.value || '';
      } else {
        el.value = '';
      }
    });
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
      productHost.innerHTML = url
        ? `<button type="button" class="dh-luxgen-product-card ${product.uploading ? 'uploading' : ''}" data-nsa-product-preview title="点击预览主体主图">
            <img src="${escapeHtml(url)}" alt="${escapeHtml(product.name || '商品/主体图')}">
            <b>商品/主体图</b><span>${escapeHtml(product.uploading ? `${product.name || '商品/主体图'} · 上传中` : (product.name || '已上传商品/主体图'))}</span>
          </button>`
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
        const urls = actorUrls(asset).slice(0, 4);
        const refLabel = actorReferenceLabel(asset);
        const genderLabel = actorGender(asset) === 'female' ? '女' : (actorGender(asset) === 'male' ? '男' : '');
        const desc = String(asset.description || asset.metadata?.description || '可作为新剧情广告人物一致性参考')
          .replace(/\s+/g, ' ')
          .replace(/CONSISTENT REAL CAMPAIGN CHARACTER ASSET:?/ig, '一致性演员参考')
          .replace(/Preserve face identity[\s\S]*$/i, '保持人物身份一致')
          .slice(0, 120);
        const imageStrip = urls.length
          ? urls.map((url, index) => `<span style="width:104px;height:140px;border-radius:8px;overflow:hidden;background:#0c1018;border:1px solid rgba(255,255,255,.10);display:flex;align-items:center;justify-content:center;flex-shrink:0"><img src="${escapeHtml(withAuthQuery(url))}" alt="视图${index + 1}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:contain;background:#05070b"></span>`).join('')
          : '<span style="width:104px;height:140px;border-radius:8px;background:#1b2230;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:rgba(255,255,255,.7)">无预览</span>';
        return `<button type="button" data-nsa-actor-material="${escapeHtml(asset.id || asset.actor_asset_id || '')}" style="width:100%;display:grid;grid-template-columns:minmax(220px,456px) minmax(0,1fr);gap:14px;text-align:left;align-items:center;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#fff;border-radius:12px;padding:12px;min-height:168px;cursor:pointer">
          <span style="display:flex;gap:8px;overflow:hidden">${imageStrip}</span>
          <span style="min-width:0;display:block">
            <b style="display:block;font-size:16px;line-height:1.25;margin-bottom:8px">${escapeHtml(asset.name || '角色素材')}</b>
            <small style="display:block;color:rgba(255,255,255,.72);line-height:1.55;margin-bottom:8px">${escapeHtml([refLabel, genderLabel, `${actorUrls(asset).length || 1} 张参考图`].filter(Boolean).join(' · '))}</small>
            <small style="display:block;color:rgba(255,255,255,.58);line-height:1.5;max-height:44px;overflow:hidden">${escapeHtml(desc || '可作为新剧情广告人物一致性参考')}</small>
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
      markSourceDirty();
      state.actorAsset = null;
      state.personAsset = actorMaterialToPersonAsset(asset);
      applyPersonAssetConstraints(state.personAsset);
      renderAll();
      close();
      toast(`已选择角色素材「${asset.name || '演员'}」，人物约束已同步`, 'success');
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
    if (state.personGenerationProgress?.active) {
      host.innerHTML = `<div class="dh-luxgen-character-sheet">
        <div class="dh-luxgen-person-thumb">生成中</div>
        <b>拟真一致性演员</b>
        <small>正在根据广告需求、人物设定和当前剧本上下文生成 4 视图演员参考。</small>
        ${personGenerationProgressHtml()}
      </div>`;
      return;
    }
    const asset = state.actorAsset || state.personAsset || null;
    if (!asset) {
      host.innerHTML = '<div class="dh-luxgen-person-empty">未选择人物来源；可上传真人参考或生成拟真演员。</div>';
      return;
    }
    const url = previewUrl(asset) || asset.view_images?.[0]?.url || '';
    host.innerHTML = `<div class="dh-luxgen-character-sheet">
      ${url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(asset.name || '人物参考')}" loading="lazy">` : '<div class="dh-luxgen-person-thumb">已选择</div>'}
      <b>${escapeHtml(asset.name || '人物参考')}</b>
      <small>${escapeHtml(asset.description || '仅用于当前新剧情广告任务的人物一致性参考。')}</small>
    </div>`;
  }

  function renderPerson() {
    const host = within('#dhNsaAdPersonCurrent');
    if (!host) return;
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
    const urls = actorUrls(asset);
    const src = previewUrl(asset) || urls[0] || '';
    const castMembers = actorCastMembers(asset).filter(member => member.image_url || member.name);
    const isReal = actorIsRealPerson(asset);
    const isSynthetic = actorIsSynthetic(asset);
    const isAi = actorReferenceKind(asset) === 'ai_generated';
    const actorId = asset.actor_asset_id || asset.asset_library_id || asset.material_id || '';
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
          ${member.image_url ? `<img src="${escapeHtml(withAuthQuery(member.image_url))}" alt="${escapeHtml(member.name || `角色${i + 1}`)}" loading="lazy" decoding="async">` : '<i class="dh-lux-actor-cast-placeholder">未生成</i>'}
          <b>${escapeHtml(member.name || member.cast_role || `角色${i + 1}`)}</b>
        </span>`).join('')}</div>`
      : '';
    const viewStrip = !castGrid && urls.length > 1
      ? `<div class="dh-lux-actor-views">${urls.slice(0, 6).map((url, i) => `<button type="button" title="演员参考 ${i + 1}"><img src="${escapeHtml(withAuthQuery(url))}" alt="演员参考 ${i + 1}" loading="lazy" decoding="async"><span>${i + 1}</span></button>`).join('')}</div>`
      : '';
    const warning = isAi && !isReal && !isSynthetic
      ? '<div style="margin-top:8px;padding:8px 10px;border:1px solid rgba(255,184,76,.5);border-radius:8px;color:#b7791f;background:rgba(255,184,76,.08);font-size:12px;line-height:1.5">非真人素材：只能作为 AI 拟真参考；真人广告请上传真人照片或选择授权真人演员。</div>'
      : '';
    host.innerHTML = `<div class="dh-luxgen-character-sheet ${asset.failed ? 'is-failed' : ''}">
      ${castGrid || (src ? `<button type="button" class="dh-lux-actor-main-preview" title="演员参考图"><img src="${escapeHtml(withAuthQuery(src))}" alt="${escapeHtml(asset.name || defaultName)}" loading="lazy" decoding="async"></button>` : '<div class="dh-luxgen-person-thumb">已选择</div>')}
      <b>${escapeHtml(asset.name || defaultName)}</b>
      <small>${escapeHtml(asset.uploading ? '真人照片上传中。' : (meta || asset.description || defaultDesc))}</small>
      ${viewStrip}
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

    const status = within('#dhNsaAdBgmStatus');
    const license = within('#dhNsaAdBgmLicense');
    const profileLabel = within('#dhNsaAdBgmProfileLabel');
    const profileDesc = within('#dhNsaAdBgmProfileDesc');
    const profileMenu = within('#dhNsaAdBgmProfileMenu');
    const profilesHost = within('#dhNsaAdBgmProfiles');
    const current = BGM_PROFILES.find(([id]) => id === state.bgmProfile) || BGM_PROFILES[0];
    if (profileLabel) profileLabel.textContent = current[1];
    if (profileDesc) profileDesc.textContent = current[2];
    if (profileMenu) {
      const open = !!profilesHost?.classList.contains('open');
      profileMenu.hidden = !open;
      profileMenu.innerHTML = BGM_PROFILES.map(([id, label, desc]) => `<button type="button" class="dh-luxgen-bgm-option ${id === state.bgmProfile ? 'active' : ''}" data-nsa-bgm-profile="${escapeHtml(id)}"><b>${escapeHtml(label)}</b><span>${escapeHtml(desc)}</span></button>`).join('');
    }
    if (status) status.textContent = state.bgmAsset ? (state.bgmAsset.name || '背景音乐已配置') : '未配置，可先合成无配乐广告片';
    if (license) license.textContent = state.bgmAsset ? '用户上传 · 请确认已获得商用授权' : '可先不配置背景音乐，成片后再补充。';
    const preview = within('#dhNsaAdBgmPreview');
    if (preview) {
      const url = previewUrl(state.bgmAsset);
      preview.innerHTML = url ? `<audio controls preload="none" src="${escapeHtml(url)}"></audio>` : '';
    }
  }

  function normalizeBundle(response = {}) {
    const bundle = response.bundle || response;
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
    state.finalVideo = outputs.final_video || response.final_video || state.finalVideo;
    state.taskId = response.task_id || response.task?.id || bundle.task?.id || state.taskId;
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

  function hydratePersonSpec(request = {}) {
    const spec = request.person_spec || request.personSpec || request.person_context?.person_spec || {};
    Object.entries(spec || {}).forEach(([key, value]) => {
      const el = root()?.querySelector(`[data-nsa-person-spec="${key}"]`);
      if (el && value !== undefined && value !== null) el.value = String(value);
    });
    const personAsset = request.person_asset || request.personAsset || request.person_context?.person_asset || null;
    if (personAsset && typeof personAsset === 'object') {
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
    if (person && typeof person === 'object' && !state.personAsset) {
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
    const task = bundle.task || {};
    const outputs = normalizeTaskOutputs(bundle);
    const request = outputs.context || task.request || {};
    state.taskId = task.id || request.task_id || request.taskId || state.taskId;
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

    setFieldValue('#dhNsaAdText', request.brief || request.content || task.brief || '');
    setFieldValue('#dhNsaAdDuration', request.duration_sec || request.duration || 30);
    state.outputRatio = request.output_ratio || request.outputRatio || state.outputRatio || '9:16';
    state.outputSize = request.output_size || request.outputSize || state.outputSize || 'standard';
    state.videoResolution = request.video_resolution || request.videoResolution || state.videoResolution || '720p';
    state.voiceId = request.voice_id || request.voiceId || state.voiceId || '';
    state.subtitleEnabled = request.subtitle !== false;
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

  async function restoreCurrentTask() {
    const id = routeTaskId() || storedTaskId() || await fallbackLatestTaskId();
    if (!id || state.taskId) return false;
    setBusy(true, '恢复当前新剧情广告任务中...');
    try {
      const r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}`);
      const bundle = r.bundle || r;
      if (!bundle?.task) throw new Error('任务不存在');
      hydrateTaskBundle(bundle);
      showStep(routeStep(), { remember: false });
      renderAll();
      return true;
    } catch (err) {
      rememberTaskId('');
      toast('当前任务恢复失败，请从任务中心重新打开或新建任务', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function setButtonLock(selector, locked, title = '') {
    const btn = within(selector);
    if (!btn) return;
    btn.disabled = !!state.busy || !!locked;
    if (btn.disabled) btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
    btn.classList.toggle('is-disabled', btn.disabled);
    if (title && locked) btn.title = title;
    else btn.removeAttribute('title');
  }

  function setButtonBusy(button, busy, label = '') {
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
    const brief = (within('#dhNsaAdText')?.value || '').trim();
    const hasBrief = brief.length >= 8;
    const hasScene = !!state.sceneConfig;
    const hasBlueprint = !!state.blueprint;
    const hasShots = Array.isArray(state.shots) && state.shots.length > 0;
    const hasActorInput = !!personSpec('appearanceText');

    setButtonLock('#dhNsaAdGenerate', !hasBrief, '请先填写至少 8 个字的广告需求');
    const generateBtn = within('#dhNsaAdGenerate');
    if (generateBtn) generateBtn.classList.toggle('is-next', hasBrief && !state.busy);
    setButtonLock('#dhNsaAdStoryboard', !hasScene && !state.taskId, '请先生成场景配置');
    setButtonLock('#dhNsaAdPreviewFrames', !hasBlueprint, '请先生成剧本');
    setButtonLock('#dhNsaAdGenerateFinalFrames', !hasShots, '请先生成分镜');
    setButtonLock('#dhNsaAdGoCompose', !hasShots, '请先生成分镜');
    setButtonLock('#dhNsaAdConfirmGenerate', !hasShots, '请先生成分镜');
    setButtonLock('#dhNsaAdGeneratePersonSheet', !hasBrief && !hasActorInput, '请先填写广告需求或人物设定');

    [
      '#dhNsaAdWrite',
      '#dhNsaAdClean',
      '#dhNsaAdSample',
      '#dhNsaAdSaveDraftStep2',
      '#dhNsaAdSaveDraftStep3',
      '#dhNsaAdSaveDraftStep4',
      '#dhNsaAdSaveDraftStep5',
      '#dhNsaAdVoiceOpen',
      '#dhNsaAdBgmUpload',
      '#dhNsaAdSubtitleStyleBtn',
      '#dhNsaAdProductDrop',
      '#dhNsaAdUploadPersonRef',
      '#dhNsaAdPickActorAsset',
      '#dhNsaAdAiPersonSpec',
    ].forEach(sel => setButtonLock(sel, false));
  }

  function setBusy(isBusy, label = '处理中...') {
    state.busy = !!isBusy;
    const host = within('#dhNsaAdLiveProgress');
    if (host) {
      host.hidden = !isBusy;
      host.innerHTML = isBusy
        ? `<div class="dh-lux-person-progress"><div class="dh-lux-person-progress-head"><b>${escapeHtml(label)}</b><span>running</span></div><div class="dh-lux-person-progress-track"><i style="width:42%"></i></div><small>正在生成当前阶段内容，请稍候。</small></div>`
        : '';
    }
    ['#dhNsaAdGenerate', '#dhNsaAdStoryboard', '#dhNsaAdPreviewFrames', '#dhNsaAdGenerateFinalFrames', '#dhNsaAdConfirmGenerate'].forEach(sel => {
      const btn = within(sel);
      if (btn) btn.disabled = !!isBusy;
    });
    updateLocks();
  }

  function showStep(step, opts = {}) {
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
    if (step === 1) return !!state.taskId || !!(within('#dhNsaAdText')?.value || '').trim();
    if (step === 2) return !!state.sceneConfig;
    if (step === 3) return !!state.blueprint;
    if (step === 4) return Array.isArray(state.shots) && state.shots.length > 0;
    if (step === 5) return !!(state.finalVideo?.video_url || state.finalVideo?.videoUrl);
    return false;
  }

  function canOpenStep(step) {
    if (step <= 1) return true;
    if (step === 2) return !!state.sceneConfig || !!state.taskId;
    if (step === 3) return !!state.blueprint || !!state.sceneConfig;
    if (step === 4) return Array.isArray(state.shots) && state.shots.length > 0 || !!state.blueprint;
    if (step === 5) return Array.isArray(state.shots) && state.shots.length > 0;
    return true;
  }

  function renderScene() {
    const host = within('#dhNsaAdSceneConfigHost');
    if (!host) return;
    if (!state.sceneConfig) {
      host.innerHTML = '<div class="dh-luxgen-empty"><b>还没有场景配置</b><span>回到第 1 步输入广告需求，点击“生成场景配置”。</span></div>';
      return;
    }
    const sc = state.sceneConfig || {};
    const rows = [
      ['广告主体', sc.advertised_subject],
      ['业务边界', sc.business_boundary],
      ['人物模式', sc.cast_mode],
      ['剧情策略', Array.isArray(sc.story_strategy) ? sc.story_strategy.join('；') : ''],
      ['禁止项', Array.isArray(sc.forbidden || sc.forbidden_elements) ? (sc.forbidden || sc.forbidden_elements).join('；') : ''],
    ];
    host.innerHTML = `<div class="dh-lux-asset-manifest">${rows.map(([k, v]) => `<div><b>${escapeHtml(k)}</b><span>${escapeHtml(v || '-')}</span></div>`).join('')}</div>`;
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
          ${beat.spoken_line ? `<div class="dh-task-segment-meta">台词/旁白：${escapeHtml(beat.spoken_line)}</div>` : ''}
          ${beat.visual_proof ? `<div class="dh-task-segment-meta">可见证据：${escapeHtml(beat.visual_proof)}</div>` : ''}
        </div>
      </div>`).join('')}</div>
    </div>`;
  }

  function renderStoryboard() {
    const host = within('#dhNsaAdFrameHost');
    const guard = within('#dhNsaAdCommercialGuard');
    if (guard) {
      const blocking = Array.isArray(state.review?.blocking_issues) ? state.review.blocking_issues : [];
      guard.innerHTML = state.review
        ? `<div class="${blocking.length ? 'dh-task-warning' : 'dh-task-ok'}">商用检查：${blocking.length ? `存在 ${blocking.length} 条需要处理的问题：${escapeHtml(blocking.join('；'))}` : '通过'}</div>`
        : '';
    }
    if (!host) return;
    if (!Array.isArray(state.shots) || !state.shots.length) {
      host.innerHTML = '<div class="dh-luxgen-empty"><b>还没有分镜</b><span>确认剧本后点击“生成分镜”。</span></div>';
      return;
    }
    host.innerHTML = state.shots.map((shot, i) => {
      const contract = state.contracts.find(x => Number(x.index || x.shot_index || 0) === Number(shot.index || shot.shot_index || i + 1)) || state.contracts[i] || {};
      const frame = state.keyframes[i] || {};
      const image = frame.image_url || frame.imageUrl || '';
      const dialogue = Array.isArray(shot.dialogue_lines)
        ? shot.dialogue_lines.map(d => `${d.speaker || ''}${d.speaker ? '：' : ''}${d.line || d.text || ''}`).filter(Boolean).join('；')
        : (shot.dialogue || '');
      return `<article class="dh-demo-frame-card">
        <div class="dh-demo-frame-preview">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(shot.title || `镜头 ${i + 1}`)}" loading="lazy">` : `<span>${String(i + 1).padStart(2, '0')}</span>`}</div>
        <div class="dh-demo-frame-body">
          <div class="dh-demo-frame-head"><b>${escapeHtml(shot.title || `镜头 ${i + 1}`)}</b><span>${escapeHtml(shot.duration || contract.duration || '')}s</span></div>
          <p><b>画面</b>：${escapeHtml(shot.visual || shot.visual_description || contract.visual || '')}</p>
          <p><b>动作</b>：${escapeHtml(shot.action || contract.action || '')}</p>
          ${shot.voiceover ? `<p><b>旁白</b>：${escapeHtml(shot.voiceover)}</p>` : ''}
          ${dialogue ? `<p><b>对白</b>：${escapeHtml(dialogue)}</p>` : ''}
          ${contract.subject_strategy ? `<p><b>合同策略</b>：${escapeHtml(contract.subject_strategy)}</p>` : ''}
        </div>
      </article>`;
    }).join('');
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

  function renderMedia() {
    const voiceSummary = within('#dhNsaAdVoiceSummary');
    const subtitleSummary = within('#dhNsaAdSubtitleSummary');
    if (voiceSummary) {
      const tracks = Array.isArray(state.ttsAudio?.tracks) ? state.ttsAudio.tracks : [];
      voiceSummary.textContent = tracks.length ? `已生成 ${tracks.length} 条音频` : '自动配音';
    }
    if (subtitleSummary) subtitleSummary.textContent = '跟随新分镜对白生成';
    const host = ensureMediaHost();
    const tracks = Array.isArray(state.ttsAudio?.tracks) ? state.ttsAudio.tracks : [];
    const clips = Array.isArray(state.videoClips) ? state.videoClips : [];
    const finalUrl = state.finalVideo?.video_url || state.finalVideo?.videoUrl || '';
    if (!tracks.length && !clips.length && !finalUrl) {
      host.innerHTML = '<div class="dh-task-empty-note">还没有生成配音、逐镜视频或成片。</div>';
      return;
    }
    host.innerHTML = `<div class="dh-task-create-section dh-task-create-section-wide">
      <div class="dh-task-detail-title">媒体生成结果</div>
      ${finalUrl ? `<video class="dh-task-detail-preview-video" src="${escapeHtml(finalUrl)}" controls playsinline></video>` : ''}
      <div class="dh-task-detail-value">${escapeHtml([
        tracks.length ? `配音 ${tracks.length} 条` : '',
        clips.length ? `视频镜头 ${clips.length} 条` : '',
        finalUrl ? '成片已生成' : '',
      ].filter(Boolean).join(' · ') || '等待生成')}</div>
    </div>`;
  }

  function syncPersonSpecControls() {
    const lock = state.personSpecLock || null;
    const generating = !!state.personGenerationProgress?.active;
    $$('[data-nsa-person-spec]', root()).forEach(el => {
      const field = el.dataset.nsaPersonSpec;
      const locked = !!(lock && ['castMode', 'gender', 'age', 'origin'].includes(field) && (field !== 'origin' || lock.origin) && (field !== 'age' || lock.age));
      el.disabled = locked || generating;
      el.title = generating
        ? '正在生成拟真演员，人物设定暂时锁定。'
        : (locked ? `已按人物一致性参考「${lock.source || '演员'}」锁定；如需更改，请重新选择或上传真人参考。` : '');
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
      stateBadge.textContent = state.keyframes.length ? `已生成 ${state.keyframes.length} 张关键帧` : (state.shots.length ? `已生成 ${state.shots.length} 镜分镜` : '待生成');
    }
    showStep(state.currentStep);
    syncPersonSpecControls();
    updateLocks();
  }

  function renderAll() {
    syncOptionControls();
    renderAdvancedControls();
    renderAssets();
    renderPerson();
    renderAudio();
    renderScene();
    renderBlueprint();
    renderStoryboard();
    renderMedia();
    renderStatus();
  }

  async function ensureTask() {
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

  async function runStage(stage, button) {
    const labels = {
      scene: '生成场景配置中...',
      blueprint: '生成剧本中...',
      storyboard: '生成分镜中...',
      keyframes: '生成真实关键帧中...',
      tts: '生成配音中...',
      video: '生成逐镜视频中...',
      compose: '合成成片中...',
    };
    setBusy(true, labels[stage] || '处理中...');
    setButtonBusy(button, true, labels[stage] || '处理中...');
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
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/storyboard`, { method: 'POST', body: {} });
        normalizeBundle(r);
        showStep(4);
      } else if (stage === 'keyframes') {
        if (!state.shots.length) normalizeBundle(await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/storyboard`, { method: 'POST', body: {} }));
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/keyframes`, { method: 'POST', body: {} });
        normalizeBundle(r);
        showStep(4);
      } else if (stage === 'tts') {
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/tts`, { method: 'POST', body: { voice_id: state.voiceId || '' } });
        normalizeBundle(r);
        showStep(5);
      } else if (stage === 'video') {
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/video`, { method: 'POST', body: { voice_id: state.voiceId || '' } });
        normalizeBundle(r);
        showStep(5);
      } else if (stage === 'compose') {
        r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/compose`, { method: 'POST', body: { voice_id: state.voiceId || '' } });
        normalizeBundle(r);
        showStep(5);
      }
      renderAll();
      toast('新剧情广告阶段已完成', 'success');
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

  async function runMediaChain(button) {
    if (!await runStage('tts', button)) return;
    if (!await runStage('video', button)) return;
    await runStage('compose', button);
  }

  async function assist(mode, button) {
    const body = payload();
    if (body.brief.length < 3) return toast('请先写一点广告方向', 'error');
    const label = mode === 'clean' ? '整理需求中...' : 'AI 写作中...';
    setBusy(true, label);
    setButtonBusy(button, true, label);
    try {
      const r = await api('/api/new-story-ad/assist', { method: 'POST', body: { ...body, mode } });
      if (r.brief && within('#dhNsaAdText')) within('#dhNsaAdText').value = r.brief;
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
      markSourceDirty();
      renderAll();
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
    if (asset.asset_library_id || asset.material_id || (asset.source === 'actor_library' && asset.actor_asset_id)) return asset;
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
        name: asset.name || '新剧情广告真人演员',
        image_url: imageUrl,
        extra_image_urls: Array.isArray(asset.extra_image_urls) ? asset.extra_image_urls.map(compactUrl).filter(Boolean) : [],
        view_images: viewImages,
        cast_assets: Array.isArray(asset.cast_assets) ? asset.cast_assets : [],
        view_count: Number(asset.view_count || viewImages.length || 1) || 1,
        source,
        description: asset.spec_description || asset.description || personDescription(),
        tags: ['新剧情广告', '真人演员'],
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
    markSourceDirty();
    renderAll();
    toast('商品/主体图正在上传...');
    try {
      const asset = await uploadAsset(file, 'product');
      revokePreview(state.productAsset);
      state.productAsset = { ...asset, previewUrl: asset.image_url || asset.url, uploading: false };
      renderAll();
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
      name: file.name || '真人参考',
      previewUrl: URL.createObjectURL(file),
      uploading: true,
      description: '用户上传的真人参考，只用于当前新剧情广告任务。',
    };
    state.actorAsset = null;
    markSourceDirty();
    renderAll();
    toast('真人参考正在上传...');
    try {
      const asset = await uploadAsset(file, 'person_reference');
      revokePreview(state.personAsset);
      state.personAsset = { ...asset, previewUrl: asset.image_url || asset.url, uploading: false, description: '用户上传的真人参考，只用于当前新剧情广告任务。' };
      renderAll();
      toast('真人参考已上传', 'success');
    } catch (err) {
      state.personAsset = { ...state.personAsset, uploading: false, failed: true };
      renderAll();
      toast(err.message || '真人参考上传失败', 'error');
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
      description: '用户上传的真人照片参考，会作为新剧情广告人物身份和气质锁定。',
    };
    state.actorAsset = null;
    state.personSpecLock = null;
    state.castProfiles = [];
    markSourceDirty();
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
        description: '用户上传的真人照片参考，会作为新剧情广告人物身份和气质锁定。',
      };
      applyPersonAssetConstraints(state.personAsset);
      renderAll();
      await persistPersonAssetToLibrary(state.personAsset, 'uploaded_person_reference');
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
      toast('BGM 已上传', 'success');
    } catch (err) {
      state.bgmAsset = { ...state.bgmAsset, uploading: false, failed: true };
      renderAll();
      toast(err.message || 'BGM 上传失败', 'error');
    }
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
    if (sec >= 60) return `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, '0')}秒`;
    return `${sec}秒`;
  }

  function personGenerationProgressHtml() {
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
        <span class="dh-lux-person-progress-stat"><em>耗时 ${escapeHtml(formatElapsedText(elapsed))}</em><i>${pct}%</i></span>
      </div>
      <div class="dh-lux-person-progress-track" aria-hidden="true"><i style="width:${pct}%"></i></div>
      <small>${escapeHtml(progress.message || '已提交生成请求，正在生成第 1/4 张。')}</small>
    </div>`;
  }

  function personDescription(spec = collectPersonSpec()) {
    const labels = {
      castMode: { auto: '按内容判断', single: '单人', dual: '双人对话', group: '多人 / 群体' },
      gender: { auto: '按故事判断', male: '男性', female: '女性', mixed: '双人/多人混合', all_male: '双人/多人全男性', all_female: '双人/多人全女性' },
      age: { match_brief: '按广告需求判断', young_adult: '青年 / 25-32', adult_30_40: '成熟青年 / 30-40', middle_40_55: '中年 / 40-55', senior_55_plus: '年长 / 55+' },
      origin: { east_asian_cn: '中国 / 东亚面孔', match_brief: '按广告需求判断', mixed_global: '多种族 / 国际化' },
    };
    return [
      `人物数量：${labels.castMode[spec.castMode] || spec.castMode || '按内容判断'}`,
      `人物性别：${labels.gender[spec.gender] || spec.gender || '按故事判断'}`,
      `人物年龄：${labels.age[spec.age] || spec.age || '按广告需求判断'}`,
      `地域/种族：${labels.origin[spec.origin] || spec.origin || '中国 / 东亚面孔'}`,
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
    const set = (key, value, forceDefault = false) => {
      const el = root()?.querySelector(`[data-nsa-person-spec="${key}"]`);
      if (!el || value === undefined || value === null || value === '') return 0;
      const current = String(el.value || '').trim();
      const shouldFill = !current
        || (forceDefault && ['auto', 'match_brief'].includes(current));
      if (!shouldFill) return 0;
      el.value = value;
      return 1;
    };
    let changed = 0;
    changed += set('castMode', normalized.castMode || 'single', true);
    changed += set('gender', normalized.gender || 'auto', true);
    changed += set('age', normalized.age || 'match_brief', true);
    changed += set('origin', normalized.origin || 'east_asian_cn', true);
    changed += set('roleName', normalized.roleName || '');
    changed += set('displayName', normalized.displayName || '');
    changed += set('appearanceText', normalized.appearanceText || '');
    changed += set('wardrobeText', normalized.wardrobeText || '');
    changed += set('hairMakeupText', normalized.hairMakeupText || '');
    changed += set('negativeText', normalized.negativeText || '');
    return changed;
  }

  function fallbackPersonSpecFromBrief(brief = '') {
    const isMale = /男|先生|老板|师傅|厂家|经理/.test(brief) && !/女|女士|美女|太太/.test(brief);
    const isFemale = /女|女士|美女|太太|模特/.test(brief);
    const isDual = /双人|两人|对话|客户.*顾问|经销商.*客户/.test(brief);
    const isGroup = /多人|团队|群像|一家人|员工/.test(brief);
    const productTone = /不锈钢|金属|建材|背景墙|材料/.test(brief);
    return {
      castMode: isGroup ? 'group' : (isDual ? 'dual' : 'single'),
      gender: isMale ? 'male' : (isFemale ? 'female' : 'auto'),
      age: /老板|厂家|经理|经销商|顾问/.test(brief) ? 'adult_30_40' : 'match_brief',
      origin: 'east_asian_cn',
      roleName: /经销商/.test(brief) ? '建材经销商 / 品牌顾问' : (/厂家|材料/.test(brief) ? '不锈钢材料品牌顾问' : '广告主角'),
      appearanceText: productTone
        ? '真实商业广告人物，五官自然，年龄感成熟可信，气质专业沉稳；表情克制、有信任感，适合在高端展厅或材料展示场景中观察细节。'
        : '符合广告需求的真实商业广告人物，五官自然，表情可信，气质干净专业，避免网红脸和过度磨皮。',
      wardrobeText: productTone
        ? '简洁商务休闲或高级展厅工作装，颜色以黑、白、灰、深蓝等低饱和色为主；服装干净合身，鞋和配饰克制，避免抢走不锈钢产品视觉重点。'
        : '服装贴合产品定位和使用场景，干净真实，颜色克制，避免夸张造型；鞋、配饰和整体风格保持商业广告质感。',
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
      markSourceDirty();
      renderAll();
      toast(changed ? '已根据当前剧情补齐人物设定，可继续手动微调' : '当前人物设定已有内容；如需重新生成，请先清空对应字段', changed ? 'success' : 'info');
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
      toast('拟真一致性演员已生成，可用于后续分镜人物一致性锁定', 'success');
    } catch (err) {
      state.personGenerationProgress = null;
      renderPerson();
      toast(err.message || '拟真演员生成失败', 'error');
    } finally {
      clearInterval(timer);
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
    host.addEventListener('click', e => {
      const target = e.target;
      const btn = target.closest('button, [role="button"], a');
      const step = target.closest('[data-nsa-step]');
      if (step) {
        e.preventDefault();
        e.stopPropagation();
        const n = Number(step.dataset.nsaStep || 1);
        if (!canOpenStep(n)) return toast('请先完成前置阶段', 'error');
        showStep(n);
        return;
      }
      const ratioBtn = target.closest('[data-nsa-ratio]');
      if (ratioBtn && host.contains(ratioBtn)) {
        e.preventDefault();
        e.stopPropagation();
        state.outputRatio = ratioBtn.dataset.nsaRatio || '9:16';
        markSourceDirty();
        renderAll();
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
        markSourceDirty();
        renderAll();
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
        markSourceDirty();
        renderAdvancedControls();
        renderStatus();
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
      const shotUpload = target.closest('[data-nsa-shot-upload]');
      if (shotUpload && host.contains(shotUpload)) {
        e.preventDefault();
        e.stopPropagation();
        state.pendingShotUploadIndex = Number(shotUpload.dataset.nsaShotUpload || 0);
        const input = within('#dhNsaAdAssetFile');
        if (input) input.click();
        return;
      }
      const shotRegenerate = target.closest('[data-nsa-shot-regenerate]');
      if (shotRegenerate && host.contains(shotRegenerate)) {
        e.preventDefault();
        e.stopPropagation();
        runStage('keyframes', shotRegenerate);
        return;
      }
      const bgmProfileToggle = target.closest('#dhNsaAdBgmProfileToggle');
      if (bgmProfileToggle && host.contains(bgmProfileToggle)) {
        e.preventDefault();
        e.stopPropagation();
        const picker = within('#dhNsaAdBgmProfiles');
        picker?.classList.toggle('open');
        renderAudio();
        return;
      }
      const bgmProfile = target.closest('[data-nsa-bgm-profile]');
      if (bgmProfile && host.contains(bgmProfile)) {
        e.preventDefault();
        e.stopPropagation();
        state.bgmProfile = bgmProfile.dataset.nsaBgmProfile || 'auto';
        within('#dhNsaAdBgmProfiles')?.classList.remove('open');
        renderAudio();
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
        dhNsaAdFillMissingFramesTop: () => runStage('keyframes', btn),
        dhNsaAdRegenerateFrames: () => runStage('keyframes', btn),
        dhNsaAdDetectStyle: () => runStage('scene', btn),
        dhNsaAdAutoVisuals: () => runStage('keyframes', btn),
        dhNsaAdGoCompose: () => showStep(5),
        dhNsaAdConfirmGenerate: () => runMediaChain(btn),
        dhNsaAdWrite: () => assist('write', btn),
        dhNsaAdClean: () => assist('clean', btn),
        dhNsaAdSample: () => { const text = within('#dhNsaAdText'); if (text) text.value = SAMPLE_BRIEF; renderStatus(); },
        dhNsaAdSaveDraftStep2: () => ensureTask().then(() => toast('新剧情广告任务已保存', 'success')).catch(err => toast(err.message, 'error')),
        dhNsaAdSaveDraftStep3: () => ensureTask().then(() => toast('新剧情广告任务已保存', 'success')).catch(err => toast(err.message, 'error')),
        dhNsaAdSaveDraftStep4: () => ensureTask().then(() => toast('新剧情广告任务已保存', 'success')).catch(err => toast(err.message, 'error')),
        dhNsaAdSaveDraftStep5: () => ensureTask().then(() => toast('新剧情广告任务已保存', 'success')).catch(err => toast(err.message, 'error')),
        dhNsaAdGeneratePersonSheet: () => generatePersonSheet(btn),
        dhNsaAdVoiceOpen: () => toast('配音选择面板稍后接入；当前使用默认配音设置。'),
        dhNsaAdMusicLibrary: () => toast('公开曲库稍后接入；当前可上传自有 BGM 或先合成无配乐成片。'),
        dhNsaAdBgmUpload: () => within('#dhNsaAdBgmFile')?.click(),
        dhNsaAdSubtitleStyleBtn: () => toast('字幕样式稍后接入；当前使用默认字幕。'),
        dhNsaAdProductDrop: () => within('#dhNsaAdProductFile')?.click(),
        dhNsaAdProductDropInline: () => within('#dhNsaAdProductFile')?.click(),
        dhNsaAdProductClear: () => { revokePreview(state.productAsset); state.productAsset = null; markSourceDirty(); renderAll(); toast('主体图已删除', 'success'); },
        dhNsaAdProductClearInline: () => { revokePreview(state.productAsset); state.productAsset = null; markSourceDirty(); renderAll(); toast('主体图已删除', 'success'); },
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
      if (target?.id === 'dhNsaAdText') {
        markSourceDirty();
        renderStatus();
        return;
      }
      if (target?.matches?.('[data-nsa-control-custom-env]')) {
        const ctrl = controlledProduction();
        ctrl.environment.custom = target.value || '';
        ctrl.uiExpanded = true;
        markSourceDirty();
        renderStatus();
        return;
      }
      if (target?.matches?.('[data-nsa-control-style-notes]')) {
        const ctrl = controlledProduction();
        ctrl.style.notes = target.value || '';
        ctrl.uiExpanded = true;
        markSourceDirty();
        renderStatus();
        return;
      }
      if (target?.matches?.('[data-nsa-control-negative]')) {
        const ctrl = controlledProduction();
        ctrl.negative.text = target.value || '';
        ctrl.uiExpanded = true;
        markSourceDirty();
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
        markSourceDirty();
        renderStatus();
      }
    });
    host.addEventListener('change', e => {
      const target = e.target;
      if (target?.matches?.('[data-nsa-control-product-enabled]')) {
        const ctrl = controlledProduction();
        ctrl.product.enabled = !!target.checked;
        ctrl.uiExpanded = true;
        markSourceDirty();
        renderAdvancedControls();
        renderStatus();
        return;
      }
      if (target?.matches?.('[data-nsa-control-product-presence]')) {
        const ctrl = controlledProduction();
        ctrl.product.presence = target.value || 'medium';
        ctrl.uiExpanded = true;
        markSourceDirty();
        renderStatus();
        return;
      }
      if (target?.matches?.('[data-nsa-control-product-lock]')) {
        const ctrl = controlledProduction();
        ctrl.product.lockStrength = target.value || 'standard';
        ctrl.uiExpanded = true;
        markSourceDirty();
        renderStatus();
        return;
      }
      if (target?.id === 'dhNsaAdDuration') {
        markSourceDirty();
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
        markSourceDirty();
        renderStatus();
      }
    });
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

  window.__newStoryAdLegacyUI = { mount, state, showStep, resetForNewSession };
  document.addEventListener('new-story-ad:mount', mount);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.querySelector('.dh-tab-pane[data-pane="new-story-ad"].active')) mount();
    });
  } else if (document.querySelector('.dh-tab-pane[data-pane="new-story-ad"].active')) {
    mount();
  }
})();
