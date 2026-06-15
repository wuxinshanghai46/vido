// ═══════════════════════════════════════════════
// 数字人 3 步向导前端
// ═══════════════════════════════════════════════
(() => {
  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => Array.from(p.querySelectorAll(s));
  const OUTPUT_SIZE_LABELS = { standard: '标准', hd: '高清', fullhd: '超清' };
  const OUTPUT_SIZE_MAP = {
    '9:16': { standard: '720×1280', hd: '900×1600', fullhd: '1080×1920' },
    '16:9': { standard: '1280×720', hd: '1600×900', fullhd: '1920×1080' },
    '1:1': { standard: '1024×1024', hd: '1280×1280', fullhd: '1536×1536' },
    '3:4': { standard: '768×1024', hd: '960×1280', fullhd: '1080×1440' },
    '4:3': { standard: '1024×768', hd: '1280×960', fullhd: '1440×1080' },
  };

  function outputPixels(ratio = '9:16', size = 'standard') {
    return OUTPUT_SIZE_MAP[ratio]?.[size] || OUTPUT_SIZE_MAP['9:16'].standard;
  }

  function outputPayload(ratio, size) {
    const pixels = outputPixels(ratio, size);
    return { aspect_ratio: ratio, aspectRatio: ratio, output_size: size, outputSize: size, resolution: pixels, pixels };
  }

  function luxuryAspectRatioStyle(ratio = '9:16') {
    const m = String(ratio || '').match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
    if (!m) return '--dh-frame-ratio: 16 / 9;';
    const w = Math.max(1, Number(m[1]) || 16);
    const h = Math.max(1, Number(m[2]) || 9);
    return `--dh-frame-ratio: ${w} / ${h};`;
  }

  const SPACE_GUIDE_TRACKS_MODE = 'showroom_guide_tracks';
  function spaceGuideGenerationMode(isLuxury) {
    return isLuxury ? 'luxury_storyboard' : SPACE_GUIDE_TRACKS_MODE;
  }
  function isRejectedShowroomGuidePreview(kf) {
    const plan = kf?.shot_plan || {};
    const referenceMode = String(kf?.reference_mode || '').toLowerCase();
    const kind = String(plan.kind || '').toLowerCase();
    const fusionModel = String(plan.fusion_model || '').toLowerCase();
    return referenceMode === 'showroom_guide_template_composite'
      || kind === 'showroom_guide_template_composite'
      || kind === 'template_showroom_guide'
      || fusionModel === 'deterministic-template-composite';
  }
  function isQualifiedShowroomGuidePreview(kf) {
    return !!(
      kf &&
      kf.image_url &&
      kf.keyframe_id &&
      kf.reference_mode === 'showroom_guide_strict' &&
      !isRejectedShowroomGuidePreview(kf) &&
      kf.qa?.pass !== false
    );
  }

  const state = {
    token: sessionStorage.getItem('vido_token') || localStorage.getItem('vido_token') || localStorage.getItem('token') || null,
    // Step 1
    s1: {
      mode: 'generate', gender: 'female', style: 'free', ratio: '9:16', outputSize: 'standard',
      avatarType: 'normal',
      // 动作姿势 —— 因为 lip-sync 模型不接受动作 prompt，所以在生成形象图时就 baked-in
      // 'natural' 是默认值（自然口播姿势），用户可以选其它姿势让形象图就摆出对应造型
      action: 'natural',
      // 构图：headshot / half_body(默认) / full_body / close_up
      // 选半身/全身才能看见动作姿势和服装下半身（模型默认偏脸部特写）
      framing: 'half_body',
      // 自定义背景图 URL（用户上传，nano-banana 多 ref 融合）
      bgImageUrl: '',
      bgImageName: '',
      bgImageExplicit: false,
      // 上传模式下的"人物+背景一键合成"功能
      compose: { bgImageUrl: '', bgImageName: '', placement: 'bottom', ratio: '9:16', mode: 'fast', sizePct: 76 },
      product: { imageUrl: '', preparedUrl: '', cutoutUrl: '', imageName: '', name: '', selling_points: '', motion_style: 'hold', scene: 'street' },
      previewUrl: null,            // 静态图 URL
      productFusedKey: '',
      productFusedUrl: '',
      productFusing: false,
      sampleVideoUrl: null,        // 动态预览 URL
      sampleTaskId: null,
      samplePollTimer: null,
    },
    // Step 2
    myAvatars: [],
    selectedAvatar: null,
    // Step 3
    s3: {
      script: '', segments: [], voiceId: null, taskId: null, pollTimer: null, motionEditIdx: -1, targetDurationSec: 30, outputRatio: '9:16', outputSize: 'standard',
      writeMode: 'script', writeEntry: 'script', productMotionStyle: '',
      product: { enabled: false, imageUrl: '', imageName: '', name: '', audience: '', selling_points: '', offer: '', motion_style: 'hold' },
      subtitle: { show: true, style: 'popup', smartEmphasis: true, fontName: '抖音美好体', fontSize: 72, color: '', outlineColor: '' },
      // 多任务并行：taskId → { avatarName, startedAt, pollTimer, snapshot }
      runningTasks: new Map(),
    },
    space: {
      bgImageUrl: '',
      bgPreviewUrl: '',
      bgImageName: '',
      bgUploading: false,
      referenceImages: [],
      scene: 'auto',
      scenePrompt: '',
      camera: 'auto',
      cameraPrompt: '',
      voiceId: '',
      durationSec: 30,
      subtitle: true,
      segments: [],
      speechSegments: [],
      visualSegments: [],
      keyframes: [],
      generationMode: 'storyboard',
      adMode: 'standard',
      adStyle: 'luxury_soft',
      shotCount: 6,
      guideMode: 'ai_guide',
      guideGender: 'female',
      strictKeyframeId: '',
      copyMode: 'manual',
      promptTimer: null,
      outputRatio: '16:9',
      outputSize: 'standard',
    },
    currentUser: null,
    luxuryAd: {
      currentStep: 1,
      flowMode: 'material',
      content: '',
      adType: 'auto',
      durationSec: 30,
      outputRatio: '9:16',
      outputSize: 'standard',
      subtitle: true,
      autoEnhance: true,
      expandBrief: true,
      voiceId: '',
      productAsset: null,
      personAsset: null,
      personSpec: {
        castMode: 'auto',
        gender: 'auto',
        age: 'match_brief',
        origin: 'east_asian_cn',
      },
      briefInfo: null,
      briefRefAssets: [],
      visualReferenceBrief: null,
      assetManifest: null,
      visualLocks: null,
      globalVisualBible: null,
      briefUploading: false,
      refAssets: [],
      assets: [],
      bgmAsset: null,
      bgmProfile: 'auto',
      voiceVolume: 1,
      bgmVolume: 0.16,
      openMusic: { query: '', results: [], loading: false, note: '' },
      voiceDirection: 'story_dynamic',
      uploading: false,
      pendingShotUploadIndex: null,
      sceneGenerating: false,
      scriptGenerating: false,
      keyframeGenerating: false,
      keyframeProgress: null,
      keyframeError: '',
      keyframeErrorDetails: null,
      personGenerationError: null,
      personGenerationProgress: null,
      workflowProgress: null,
      usageRows: [],
      usageSummary: null,
      usageByStep: {},
      usageTaskRows: [],
      usageTaskSummary: null,
      usageRequestKeys: {},
      productionContract: null,
      productionProjectId: '',
      productionProject: null,
      storyboardDetailed: false,
      segments: [],
      keyframes: [],
      storyboardSheets: [],
      taskId: '',
      taskUrl: '',
    },
    // 音色列表（从 /api/avatar/voice-list 拉）
    voices: [],
    voicesLoaded: false,
    badVoices: new Set(JSON.parse(localStorage.getItem('dh_bad_voices') || '[]')),
    avatarPickReturn: '',
    // 双人
    dual: {
      avatarA: null, avatarB: null, layout: 'hstack',
      pickRole: 'a', taskId: null, pollTimer: null,
      segments: [],
    },
    // 定制主持人弹窗
    hostModal: { forRole: 'a', mode: 'ai', genderCombo: 'mf', age: '青年', pickA: null, pickB: null },
    // 图片→视频 promote 的活跃任务（avatarId → pollTimer/taskId）
    promoting: {},
    // 声音克隆
    voiceClone: { file: null, name: '', gender: 'female', list: [] },
    activeTab: 'step1',
    activeTaskType: 'digital_human',
    activeTaskStatus: 'pending',
    luxuryAdProjects: [],
    luxuryAdProjectsLoading: false,
    luxuryAdProjectsLoadedAt: 0,
    subtitleTarget: 's3',
    voiceModalTarget: 'space',
  };

  // 动作预设（用户可选 / 自定义）
  const ACTION_PRESETS = [
    // —— 基础交流 ——
    { id: 'natural',      name: '自然交谈',   en: 'natural speaking, subtle head movements, look at camera' },
    { id: 'greet',        name: '打招呼',     en: 'waving hello, friendly greeting gesture' },
    { id: 'nod',          name: '点头认同',   en: 'nodding in agreement, confident expression' },
    { id: 'shake_head',   name: '轻轻摇头',   en: 'gently shaking head, reflective expression' },
    { id: 'lean_in',      name: '靠近强调',   en: 'leaning slightly forward to emphasize the point' },
    { id: 'wave_bye',     name: '挥手再见',   en: 'waving goodbye warmly, friendly closing gesture' },
    // —— 手势说明 ——
    { id: 'open_palms',   name: '开掌说明',   en: 'both hands open palms up explaining, welcoming posture' },
    { id: 'raise_hand',   name: '举手说明',   en: 'raising one hand to explain clearly' },
    { id: 'count_finger', name: '数手指',     en: 'counting on fingers, explaining points one by one' },
    { id: 'compare',      name: '左右对比',   en: 'comparing two ideas with left and right hand gestures' },
    { id: 'point_down',   name: '点击下方',   en: 'pointing downward with index finger, looking at camera' },
    { id: 'point_up',     name: '指向上方',   en: 'pointing upward with index finger, directing attention' },
    { id: 'point_side',   name: '侧向指引',   en: 'pointing to the side, guiding viewer attention naturally' },
    { id: 'number1',      name: '比数字1',    en: 'holding up one finger, counting gesture' },
    { id: 'push_forward', name: '推手前伸',   en: 'pushing both hands forward, stopping or emphasizing a boundary' },
    // —— 情绪表达 ——
    { id: 'excited',      name: '兴奋',       en: 'excited gesture, eyes wide, energetic smile' },
    { id: 'thoughtful',   name: '沉思',       en: 'thinking expression, hand near chin, eyes thoughtful' },
    { id: 'look_down',    name: '低头思考',   en: 'looking down briefly, thoughtful pause before speaking' },
    { id: 'surprised',    name: '夸张惊喜',   en: 'exaggerated surprised reaction, wide eyes, jaw drop' },
    { id: 'celebrate',    name: '庆祝欢呼',   en: 'raising both fists in celebration, joyful expression' },
    { id: 'whisper',      name: '低声耳语',   en: 'leaning close as if sharing a secret, hushed conspiratorial tone' },
    { id: 'serious_look', name: '严肃直视',   en: 'serious direct eye contact, authoritative upright posture' },
    // —— 互动号召 ——
    { id: 'heart',        name: '比心',       en: 'making a heart sign with both hands, warm smile' },
    { id: 'like',         name: '点赞',       en: 'giving a thumbs up, encouraging smile' },
    { id: 'peace',        name: '比V手势',    en: 'making peace/victory sign with two fingers, playful smile' },
    { id: 'ok_sign',      name: '比OK手势',   en: 'making OK sign with hand, approval gesture' },
    { id: 'high_five',    name: '击掌邀请',   en: 'offering a high-five gesture toward the viewer' },
    { id: 'hug',          name: '张臂拥抱',   en: 'spreading arms wide in welcoming hug gesture' },
    { id: 'invite',       name: '邀请关注',   en: 'inviting gesture towards the viewer, friendly smile' },
    { id: 'clap',         name: '鼓掌',       en: 'clapping hands enthusiastically, celebrating achievement' },
    // —— 产品展示 ——
    { id: 'hold_item',    name: '展示产品',   en: 'holding up a product to camera, presenting with pride' },
    { id: 'bow',          name: '鞠躬致谢',   en: 'respectful bow, grateful sincere expression' },
    { id: 'arms_cross',   name: '双手交叉',   en: 'arms crossed, authoritative confident posture' },
    { id: 'look_around',  name: '环顾四周',   en: 'looking around with curiosity, as if discovering something new' },
    { id: 'think_deep',   name: '深度思考',   en: 'deep in thought, rubbing chin slowly, eyes looking sideways' },
  ];
  const TONE_PRESETS = [
    // 基础
    { id: 'natural',       label: '自然' },    { id: 'calm',          label: '平静' },
    { id: 'serious',       label: '认真' },    { id: 'excited',       label: '兴奋' },
    { id: 'encouraging',   label: '鼓励' },    { id: 'warm',          label: '温暖' },
    { id: 'firm',          label: '坚定' },    { id: 'curious',       label: '好奇' },
    { id: 'confident',     label: '自信' },    { id: 'gentle',        label: '柔和' },
    { id: 'urgent',        label: '紧迫' },    { id: 'humorous',      label: '轻松' },
    // 进阶
    { id: 'mysterious',    label: '神秘' },    { id: 'moved',         label: '感动' },
    { id: 'playful',       label: '俏皮' },    { id: 'authoritative', label: '威严' },
    { id: 'comforting',    label: '安慰' },    { id: 'deep',          label: '低沉' },
    { id: 'sarcastic',     label: '调侃' },    { id: 'passionate',    label: '激情' },
    { id: 'nostalgic',     label: '怀旧' },    { id: 'inspiring',     label: '激励' },
  ];
  const LUXURY_VOICE_DIRECTIONS = [
    {
      id: 'story_dynamic',
      label: '按剧情起伏',
      desc: '每个镜头按台词自动变化，痛点更紧，转折更亮，收尾更有行动感。',
      preview: '前面还在焦虑，下一秒就看到解决办法。节奏要跟着剧情走，重点一句一句打出来。',
    },
    {
      id: 'anxious_relief',
      label: '焦虑到释然',
      desc: '适合痛点强、先制造紧张再给解决方案的广告。',
      preview: '事情卡住的时候，真的会让人很焦虑。但当流程跑通，整个人会一下子松下来。',
    },
    {
      id: 'excited_sales',
      label: '兴奋种草',
      desc: '适合新品、功能亮点、强转化场景，语速更有推进感。',
      preview: '这个点很关键。它不是多一个功能，而是把原来麻烦的步骤直接变简单。',
    },
    {
      id: 'happy_bright',
      label: '开心轻快',
      desc: '适合轻松、生活化、结果让人愉悦的广告。',
      preview: '用起来顺手，效果也看得见。整个过程轻松很多，心情自然也会变好。',
    },
    {
      id: 'premium_trust',
      label: '高端信任',
      desc: '适合高端品牌、B2B、专业服务，稳重但保留关键词停顿。',
      preview: '好的系统不需要喧哗。它只需要稳定、清晰，并且在关键时刻交付结果。',
    },
  ];
  const LUXURY_BGM_PROFILES = [
    { id: 'auto', label: '自动推荐', desc: '按广告内容搜索真实纯音乐。' },
    { id: 'majestic-brand', label: '品牌大片', desc: '管弦、钢琴、宽广叙事，适合品牌形象片。' },
    { id: 'epic-cinematic', label: '大气管弦', desc: '真实管弦乐感，适合恢弘开场。' },
    { id: 'inspirational-anthem', label: '励志企业', desc: '钢琴/弦乐为主，适合团队与愿景。' },
    { id: 'warm-corporate', label: '品牌温暖', desc: '温和钢琴、轻企业感，适合服务与生活。' },
    { id: 'documentary-human', label: '纪录片温度', desc: '温柔钢琴和氛围铺底，适合人物和案例。' },
    { id: 'chinese-grand', label: '东方国风', desc: '东方器乐和庄重叙事，适合文化品牌。' },
    { id: 'cinematic-story', label: '剧情叙事', desc: '钢琴/弦乐叙事，适合故事广告。' },
  ];
  const EXPRESSION_PRESETS = [
    { id: 'natural',    label: '自然' },  { id: 'smile',      label: '微笑' },
    { id: 'serious',    label: '严肃' },  { id: 'excited',    label: '兴奋' },
    { id: 'calm',       label: '平静' },  { id: 'thoughtful', label: '思考' },
    { id: 'surprised',  label: '惊讶' },  { id: 'concerned',  label: '关切' },
    { id: 'confident',  label: '自信' },  { id: 'friendly',   label: '亲和' },
    { id: 'focused',    label: '专注' },  { id: 'moved',      label: '感动' },
    { id: 'proud',      label: '自豪' },  { id: 'playful',    label: '俏皮' },
    { id: 'nervous',    label: '紧张' },  { id: 'curious',    label: '好奇' },
  ];
  const CAMERA_PRESETS = [
    // 基础
    { id: 'static',       label: '固定镜头',   en: 'static medium shot, perfectly stable camera, professional framing' },
    { id: 'push_in',      label: '缓慢推进',   en: 'very slow gentle camera push-in, builds intimacy and emphasis' },
    { id: 'pull_back',    label: '轻微拉远',   en: 'slight camera pull-back, reveals context and product naturally' },
    { id: 'handheld',     label: '手持感',     en: 'subtle handheld camera feel, organic natural movement, smooth and stable' },
    // 构图变换
    { id: 'close_up',     label: '特写镜头',   en: 'close-up on face and upper body, intimate personal connection' },
    { id: 'wide_shot',    label: '全身远景',   en: 'wide shot showing full body, spacious confident environment feel' },
    { id: 'low_angle',    label: '仰拍',       en: 'low angle shot looking up at subject, powerful authoritative perspective' },
    { id: 'high_angle',   label: '俯拍',       en: 'slightly high angle looking down, approachable storytelling perspective' },
    { id: 'dutch_angle',  label: '荷兰角',     en: 'slight dutch angle tilt, dynamic creative energetic feeling' },
    // 运动镜头
    { id: 'pan_product',  label: '平移看商品', en: 'subtle pan from presenter toward product area, natural reveal' },
    { id: 'slow_zoom',    label: '慢速推焦',   en: 'very slow deliberate zoom in on key moment, tension building' },
    { id: 'rack_focus',   label: '移焦切换',   en: 'rack focus shift between subject and product, dramatic reveal' },
    { id: 'tracking',     label: '跟踪镜头',   en: 'camera tracking movement following subject, smooth flowing motion' },
    { id: 'whip_pan',     label: '快速横扫',   en: 'whip pan transition energy, dynamic scene change momentum' },
  ];
  function presetLabel(list, id) {
    return ((Array.isArray(list) ? list : []).find(x => x.id === id)?.label) || id || '自然';
  }

  function displayChineseText(...values) {
    for (const value of values) {
      const s = String(value || '').replace(/\s+/g, ' ').trim();
      if (s && /[\u4e00-\u9fff]/.test(s)) return s;
    }
    return '';
  }

  function displayMotionLabel(value = '') {
    const raw = String(value || '').replace(/\s+/g, ' ').trim();
    const key = raw.toLowerCase().replace(/[\s-]+/g, '_');
    const map = {
      slow_push_in: '缓慢推进',
      push_in: '缓慢推进',
      smooth_slide: '平滑横移',
      slide: '平滑横移',
      macro_push: '微距推进',
      focus_shift: '焦点转移',
      rack_focus: '移焦切换',
      hold: '稳定停留',
      static: '固定镜头',
      premium: '高级克制',
      calm: '平静',
      natural: '自然',
    };
    if (map[key]) return map[key];
    if (/push/.test(key)) return '缓慢推进';
    if (/slide|pan/.test(key)) return '平滑横移';
    if (/macro/.test(key)) return '微距推进';
    if (/focus/.test(key)) return '焦点转移';
    if (/hold|static/.test(key)) return '稳定停留';
    return /[\u4e00-\u9fff]/.test(raw) ? raw : '';
  }

  // ══════════════ API helper ══════════════
  function apiErrorMessage(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.message || '';
    if (typeof value === 'object') {
      const nested = value.error && value.error !== value ? apiErrorMessage(value.error) : '';
      return value.message || value.msg || value.error_description || nested || value.code || '';
    }
    return String(value);
  }

  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (!headers['Content-Type'] && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    const body = opts.body instanceof FormData ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined);
    const resp = await fetch(path, { ...opts, headers, body });
    if (resp.status === 401) { location.href = '/?login=1'; throw new Error('unauth'); }
    const contentType = resp.headers.get('content-type') || '';
    const raw = await resp.text();
    let data = null;
    if (raw && contentType.includes('application/json')) {
      try { data = JSON.parse(raw); } catch (err) { throw new Error('接口返回 JSON 格式异常：' + err.message); }
    } else if (raw) {
      try { data = JSON.parse(raw); } catch {}
    }
    if (!resp.ok) {
      const message = apiErrorMessage(data?.error) || apiErrorMessage(data?.message) || (raw ? raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) : '');
      const err = new Error(message || `接口请求失败 (${resp.status})`);
      err.data = data || null;
      err.status = resp.status;
      throw err;
    }
    if (!data) {
      const hint = raw && raw.trim().startsWith('<')
        ? '接口返回了页面内容，不是 JSON；可能是登录过期、代理跳转或服务端路由异常'
        : '接口返回为空或格式异常';
      throw new Error(hint);
    }
    return data;
  }

  async function loadCurrentUserForDh() {
    try {
      const r = await api('/api/auth/me');
      state.currentUser = r?.data || null;
    } catch (err) {
      console.warn('[dh] current user load failed:', err.message || err);
      state.currentUser = null;
    }
  }

  function withAuthQuery(url) {
    if (!state.token || !url || /^(data|blob):/i.test(url)) return url;
    if (/^https?:\/\//i.test(url)) {
      try {
        const u = new URL(url, location.origin);
        if (u.origin !== location.origin) return url;
        u.searchParams.set('token', state.token);
        return u.pathname + u.search + u.hash;
      } catch { return url; }
    }
    const join = url.includes('?') ? '&' : '?';
    return `${url}${join}token=${encodeURIComponent(state.token)}`;
  }

  function workDownloadUrl(t, fallbackUrl) {
    if (t?.id) return withAuthQuery(`/api/dh/videos/tasks/${encodeURIComponent(t.id)}/download`);
    return withAuthQuery(fallbackUrl || '');
  }

  let activeDetachedAudio = null;
  function stopAudibleMedia({ keep = null, reset = false } = {}) {
    $$('audio, video').forEach(el => {
      if (el === keep) return;
      if (el.tagName === 'VIDEO' && el.muted) return;
      try { el.pause(); } catch {}
      if (reset) {
        try { el.currentTime = 0; } catch {}
      }
    });
    if (activeDetachedAudio && activeDetachedAudio !== keep) {
      try { activeDetachedAudio.pause(); } catch {}
      try { activeDetachedAudio.src = ''; } catch {}
      activeDetachedAudio = null;
    }
  }

  function markDetachedAudio(audio) {
    if (!audio) return audio;
    if (activeDetachedAudio && activeDetachedAudio !== audio) {
      try { activeDetachedAudio.pause(); } catch {}
      try { activeDetachedAudio.src = ''; } catch {}
    }
    activeDetachedAudio = audio;
    audio.addEventListener('ended', () => {
      if (activeDetachedAudio === audio) activeDetachedAudio = null;
    }, { once: true });
    return audio;
  }

  // ══════════════ Toast ══════════════
  // ════════ 通用确认弹窗（替代 confirm()）════════
  function DhConfirm({ title = '确认', message = '', detail = '', confirmText = '确定', cancelText = '取消', type = 'primary' } = {}) {
    return new Promise(resolve => {
      const old = document.getElementById('__dh_confirm_mask');
      if (old) old.remove();
      const mask = document.createElement('div');
      mask.id = '__dh_confirm_mask';
      mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;animation:vmf 0.18s ease';
      const okColor = type === 'danger'
        ? 'background:linear-gradient(135deg,#FF5470,#ec4899);color:white'
        : 'background:linear-gradient(135deg,#21FFF3,#FFF600);color:#0D0E12';
      mask.innerHTML = `
        <div style="background:#141519;border:1px solid #2D3038;border-radius:14px;width:100%;max-width:440px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.5);animation:vmp 0.2s cubic-bezier(0.34,1.56,0.64,1)" onclick="event.stopPropagation()">
          <div style="padding:20px 22px 14px">
            <div style="font-size:16px;font-weight:700;color:#E8EAED;margin-bottom:8px">${title}</div>
            <div style="font-size:14px;color:#B8BCC4;line-height:1.6">${message}</div>
            ${detail ? `<div style="font-size:12px;color:#6B7280;margin-top:10px;background:#1E2025;padding:10px 12px;border-radius:7px;line-height:1.6">${detail}</div>` : ''}
          </div>
          <div style="padding:12px 22px 18px;display:flex;justify-content:flex-end;gap:8px">
            <button class="dh-btn dh-btn-ghost" id="__dhcCancel">${cancelText}</button>
            <button class="dh-btn" style="${okColor};border:0;font-weight:700" id="__dhcOk">${confirmText}</button>
          </div>
        </div>
      `;
      mask.addEventListener('click', e => { if (e.target === mask) { mask.remove(); resolve(false); } });
      document.body.appendChild(mask);
      document.getElementById('__dhcOk').onclick = () => { mask.remove(); resolve(true); };
      document.getElementById('__dhcCancel').onclick = () => { mask.remove(); resolve(false); };
    });
  }

  // 编辑形象的名称/性别
  async function editAvatar(id) {
    const a = state.myAvatars.find(x => x.id === id);
    if (!a) return toast('找不到该形象', 'error');
    const result = await new Promise(resolve => {
      const old = document.getElementById('__dh_edit_mask');
      if (old) old.remove();
      const mask = document.createElement('div');
      mask.id = '__dh_edit_mask';
      mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px';
      mask.innerHTML = `
        <div style="background:#141519;border:1px solid #2D3038;border-radius:14px;width:100%;max-width:440px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.5)" onclick="event.stopPropagation()">
          <div style="padding:18px 22px;border-bottom:1px solid #2D3038;display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:15px;font-weight:700;color:#E8EAED">✎ 编辑形象</div>
            <button id="__dhEditClose" style="background:transparent;border:0;color:#6B7280;cursor:pointer;font-size:22px">×</button>
          </div>
          <div style="padding:20px 22px">
            <div style="margin-bottom:14px">
              <label style="font-size:12px;color:#B8BCC4;font-weight:600;display:block;margin-bottom:6px">形象名称</label>
              <input id="__dhEditName" type="text" value="${escapeHtml(a.name || '')}" maxlength="30"
                style="width:100%;background:#1E2025;border:1px solid #2D3038;color:#E8EAED;padding:10px 14px;border-radius:8px;font-size:14px;outline:none" />
            </div>
            <div>
              <label style="font-size:12px;color:#B8BCC4;font-weight:600;display:block;margin-bottom:6px">性别</label>
              <div style="display:flex;gap:8px">
                <label style="flex:1;cursor:pointer">
                  <input type="radio" name="__dhEditGender" value="female" ${a.gender==='female'?'checked':''} style="display:none" />
                  <div data-g="female" style="padding:10px 14px;text-align:center;border:1px solid ${a.gender==='female'?'#21FFF3':'#2D3038'};border-radius:8px;color:${a.gender==='female'?'#21FFF3':'#B8BCC4'};font-size:13px">♀ 女</div>
                </label>
                <label style="flex:1;cursor:pointer">
                  <input type="radio" name="__dhEditGender" value="male" ${a.gender==='male'?'checked':''} style="display:none" />
                  <div data-g="male" style="padding:10px 14px;text-align:center;border:1px solid ${a.gender==='male'?'#21FFF3':'#2D3038'};border-radius:8px;color:${a.gender==='male'?'#21FFF3':'#B8BCC4'};font-size:13px">♂ 男</div>
                </label>
                <label style="flex:1;cursor:pointer">
                  <input type="radio" name="__dhEditGender" value="" ${!a.gender?'checked':''} style="display:none" />
                  <div data-g="" style="padding:10px 14px;text-align:center;border:1px solid ${!a.gender?'#21FFF3':'#2D3038'};border-radius:8px;color:${!a.gender?'#21FFF3':'#B8BCC4'};font-size:13px">不限</div>
                </label>
              </div>
            </div>
          </div>
          <div style="padding:14px 22px;border-top:1px solid #2D3038;display:flex;justify-content:flex-end;gap:8px">
            <button class="dh-btn dh-btn-ghost" id="__dhEditCancel">取消</button>
            <button class="dh-btn dh-btn-primary" id="__dhEditSave">💾 保存</button>
          </div>
        </div>
      `;
      mask.addEventListener('click', e => { if (e.target === mask) { mask.remove(); resolve(null); } });
      document.body.appendChild(mask);
      // 性别 radio 切换
      mask.querySelectorAll('label[style*="cursor:pointer"]').forEach(lbl => {
        lbl.addEventListener('click', e => {
          mask.querySelectorAll('div[data-g]').forEach(d => {
            d.style.borderColor = '#2D3038';
            d.style.color = '#B8BCC4';
          });
          const div = lbl.querySelector('div[data-g]');
          if (div) {
            div.style.borderColor = '#21FFF3';
            div.style.color = '#21FFF3';
            const radio = lbl.querySelector('input[type=radio]');
            if (radio) radio.checked = true;
          }
        });
      });
      document.getElementById('__dhEditClose').onclick = () => { mask.remove(); resolve(null); };
      document.getElementById('__dhEditCancel').onclick = () => { mask.remove(); resolve(null); };
      document.getElementById('__dhEditSave').onclick = () => {
        const name = document.getElementById('__dhEditName').value.trim();
        const genderRadio = mask.querySelector('input[name=__dhEditGender]:checked');
        const gender = genderRadio?.value || '';
        if (!name) return toast('名称不能为空', 'error');
        mask.remove();
        resolve({ name, gender });
      };
    });
    if (!result) return;
    try {
      const r = await fetch(`/api/dh/my-avatars/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
        body: JSON.stringify(result),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || '保存失败');
      Object.assign(a, result);
      renderMyAvatars();
      toast('✅ 已保存', 'success');
    } catch (e) { toast('保存失败：' + e.message, 'error'); }
  }

  function toast(msg, type = '') {
    const el = $('#dhToast');
    el.textContent = msg;
    el.className = 'dh-toast ' + type;
    el.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  // ══════════════ Tabs ══════════════
  const DH_VALID_TABS = ['step1', 'step2', 'step3', 'tasks', 'dual', 'plaza', 'works', 'voice-clone', 'product-dh', 'space-guide', 'material-film', 'luxury-ad'];
  const DH_LAST_TAB_KEY = 'vido_dh_active_tab';
  const SPACE_WORKFLOW_TABS = new Set(['space-guide']);

  function spacePaneForTab(tab) {
    if (tab === 'material-film') return 'luxury-ad';
    return tab;
  }

  function isLuxuryAdModule() {
    return state.activeTab === 'luxury-ad' || state.activeTab === 'material-film';
  }

  function setSpaceModeForActiveTab({ reset = false } = {}) {
    if (!SPACE_WORKFLOW_TABS.has(state.activeTab)) return;
    const nextMode = isLuxuryAdModule() ? 'luxury' : 'standard';
    const changed = state.space.adMode !== nextMode;
    state.space.adMode = nextMode;
    if (reset || changed) {
      state.space.segments = [];
      state.space.speechSegments = [];
      state.space.visualSegments = [];
      state.space.keyframes = [];
      state.space.strictKeyframeId = '';
      state.space.scenePrompt = '';
      state.space.cameraPrompt = '';
      ['#dhSpaceScenePrompt', '#dhSpaceCameraPrompt'].forEach(sel => {
        const el = $(sel);
        if (el) el.value = '';
      });
    }
  }

  function rememberActiveTab(tab) {
    if (!DH_VALID_TABS.includes(tab)) return;
    try { localStorage.setItem(DH_LAST_TAB_KEY, tab); } catch {}
    try {
      const url = new URL(location.href);
      url.searchParams.set('tab', tab);
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch {}
  }

  function getInitialTab() {
    try {
      const urlTab = new URLSearchParams(location.search).get('tab');
      if (DH_VALID_TABS.includes(urlTab)) return urlTab;
    } catch {}
    return 'step1';
  }

  function switchTab(tab, opts = {}) {
    if (!tab) return;
    if (!DH_VALID_TABS.includes(tab)) tab = 'step1';
    if (tab !== state.activeTab) stopAudibleMedia({ reset: true });
    state.activeTab = tab;
    if (opts.remember !== false) rememberActiveTab(tab);
    $$('.dh-nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
    const paneTab = spacePaneForTab(tab);
    $$('.dh-tab-pane').forEach(el => el.classList.toggle('active', el.dataset.pane === paneTab));
    $('#dhCrumb').textContent = {
      step1: '① 生成形象',
      step2: '② 我的形象',
      step3: '③ 生成数字人',
      tasks: '⏳ 任务中心',
      dual:  '👥 双人对话',
      plaza: '🎭 形象广场',
      works: '🎬 作品库',
      'product-dh': '🛍️ 商品数字人',
      'space-guide': '📢 素材审片',
      'material-film': '📢 素材审片',
      'luxury-ad': '🎞️ 剧情广告',
    }[tab] || '数字人';

    if (tab === 'step2') loadMyAvatars();
    if (tab === 'step3') { renderSelectedAvatar(); loadVoicesIfNeeded(); renderRunningTasksBanner(); }
    if (SPACE_WORKFLOW_TABS.has(tab)) {
      setSpaceModeForActiveTab();
      renderSpaceGuide();
      loadVoicesIfNeeded().then(renderSpaceVoiceOptions);
    }
    if (tab === 'material-film') {
      setLuxuryAdFlowMode('material');
      renderLuxuryAd();
      loadVoicesIfNeeded().then(() => {
        renderLuxuryAdVoice();
        updateLuxuryAdStepLocks();
      });
    }
    if (tab === 'luxury-ad') {
      setLuxuryAdFlowMode('story');
      renderLuxuryAd();
      loadVoicesIfNeeded().then(() => {
        renderLuxuryAdVoice();
        updateLuxuryAdStepLocks();
      });
    }
    if (tab === 'tasks') renderTaskCenter();
    if (tab === 'dual')  { renderDualAvatars(); }
    if (tab === 'plaza') loadPlaza();
    if (tab === 'product-dh') pdhOnTabOpen();
    if (tab === 'works') loadWorks();
    if (tab === 'voice-clone') { bindVoiceCloneUpload(); loadVoiceClones(); /* aliyun token 卡片已下线，统一到后台 AI 配置 */ }
    try { delete document.documentElement.dataset.dhInitialTab; } catch {}
  }

  function startNewSpaceGuideSession(tab = 'space-guide') {
    state.selectedAvatar = null;
    resetSpaceGuideFormForNext({ quiet: true });
    if (tab === 'luxury-ad') resetLuxuryAdFormForNext({ quiet: true });
    state.space.adMode = tab === 'luxury-ad' ? 'luxury' : 'standard';
    const preview = $('#dhSpacePreview');
    if (preview) preview.innerHTML = state.space.adMode === 'luxury'
      ? '<div class="dh-space-preview-empty"><b>准备好了就开始</b><span>请先选择形象、上传多张参考画面或产品物料，再生成剧情分镜关键帧。</span></div>'
      : '<div class="dh-space-preview-empty"><b>准备好了就开始</b><span>请先选择素材审片形象、上传广告背景，再生成单镜头预览。</span></div>';
    renderSpaceGuide();
  }

  // ══════════════ Step 1 · 模式切换 + 选择 ══════════════
  function setMode(mode) {
    state.s1.mode = mode;
    $$('.dh-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    $$('.dh-mode-pane').forEach(p => p.classList.toggle('active', p.dataset.modePane === mode));
    resetS1Preview();
  }

  function resetS1Preview() {
    $('#dhS1Preview').style.display = 'none';
    state.s1.previewUrl = null;
    state.s1.productFusedKey = '';
    state.s1.productFusedUrl = '';
    state.s1.productFusing = false;
    state.s1.sampleVideoUrl = null;
    state.s1.sampleTaskId = null;
    if (state.s1.samplePollTimer) { clearInterval(state.s1.samplePollTimer); state.s1.samplePollTimer = null; }
    $('#dhS1SampleVideo').style.display = 'none';
    $('#dhS1SampleVideo').removeAttribute('src');
    $('#dhS1PreviewImg').style.display = 'block';
    const fuseOverlay = $('#dhS1ProductFuseOverlay');
    if (fuseOverlay) fuseOverlay.style.display = 'none';
    $('#dhS1SampleArea').style.display = 'flex';
    $('#dhS1SampleRunning').style.display = 'none';
    $('#dhS1SampleDone').style.display = 'none';
    // 静态图生成后保存按钮就可用；动态预览只是可选验证
    $('#dhS1Save').disabled = !state.s1.previewUrl;
    $('#dhS1Save').title = state.s1.previewUrl ? '保存这张形象到「我的形象」' : '请先生成或上传一张静态形象图';
    refreshS1PreviewActions();
    const ph = $('#dhS1PreviewPlaceholder');
    if (ph) ph.style.display = '';
  }
  function _hidePlaceholder() {
    const ph = $('#dhS1PreviewPlaceholder');
    if (ph) ph.style.display = 'none';
  }

  function isS1ProductMode() {
    const productChipActive = !!document.querySelector('[data-s1-avatar-type="product"].active');
    const productFields = $('#dhS1ProductFields');
    const productFieldsVisible = !!(productFields && productFields.style.display !== 'none');
    return state.s1.avatarType === 'product' || productChipActive || productFieldsVisible;
  }

  function isS1ProductFused() {
    return !!(
      isS1ProductMode() &&
      state.s1.previewUrl &&
      state.s1.productFusedUrl &&
      state.s1.previewUrl === state.s1.productFusedUrl
    );
  }

  function refreshS1PreviewActions() {
    const isProduct = isS1ProductMode();
    if (isProduct && state.s1.avatarType !== 'product') state.s1.avatarType = 'product';
    const fused = isS1ProductFused();
    const hasPreview = !!state.s1.previewUrl;
    const fusing = !!state.s1.productFusing;
    const sampleArea = $('#dhS1SampleArea');
    const saveBtn = $('#dhS1Save');
    const regenBtn = $('#dhS1Regen');
    const composeBox = $('#dhComposeBox');
    const fuseOverlay = $('#dhS1ProductFuseOverlay');
    if (fuseOverlay) fuseOverlay.style.display = fusing ? 'flex' : 'none';
    if (composeBox) composeBox.style.display = isProduct ? 'none' : '';
    if (sampleArea) sampleArea.style.display = isProduct ? 'none' : 'flex';
    if (regenBtn) {
      if (isProduct) {
        const ready = hasPreview && isServerImageUrl(state.s1.previewUrl) && isServerImageUrl(state.s1.product?.imageUrl) && !state.s1.product?.uploading;
        regenBtn.disabled = !ready || fusing;
        regenBtn.textContent = fusing ? '正在生成商品数字人形象…' : (fused ? '↻ 重新合成商品数字人' : '🪄 合成商品数字人形象');
        regenBtn.title = !hasPreview ? '请先上传或生成一张人物照片'
          : (!isServerImageUrl(state.s1.previewUrl) ? '人物照片仍在上传，请稍等'
            : (!isServerImageUrl(state.s1.product?.imageUrl) || state.s1.product?.uploading ? '商品图仍在上传，请稍等' : ''));
        regenBtn.classList.toggle('dh-btn-primary', !fused);
        regenBtn.classList.toggle('dh-btn-ghost', !!fused);
      } else {
        regenBtn.disabled = false;
        regenBtn.textContent = '↻ 重新生成图';
        regenBtn.title = '';
        regenBtn.classList.remove('dh-btn-primary');
        regenBtn.classList.add('dh-btn-ghost');
      }
    }
    if (saveBtn) {
      saveBtn.style.display = (!isProduct || fused) ? '' : 'none';
      saveBtn.disabled = !hasPreview || fusing || (isProduct && !fused);
      saveBtn.textContent = isProduct ? '💾 保存到商品数字人' : '💾 保存到我的形象';
      saveBtn.title = isProduct && !fused ? '请先合成商品数字人形象' : (hasPreview ? '保存这张形象到「我的形象」' : '请先生成或上传一张静态形象图');
    }
  }

  function selectGender(g) {
    state.s1.gender = g;
    $$('[data-gender]').forEach(b => b.classList.toggle('active', b.dataset.gender === g));
  }
  function selectStyle(s) {
    state.s1.style = s;
    $$('[data-style]').forEach(b => b.classList.toggle('active', b.dataset.style === s));
  }
  function selectRatio(r) {
    state.s1.ratio = r;
    $$('[data-ratio]').forEach(b => b.classList.toggle('active', b.dataset.ratio === r));
    updateOutputHints();
    _checkFramingRatioConflict();
  }

  function updateOutputHints() {
    const s1 = $('#dhS1OutputHint');
    if (s1) s1.textContent = `当前输出：${state.s1.ratio} · ${outputPixels(state.s1.ratio, state.s1.outputSize)}`;
    const s3 = $('#dhS3OutputHint');
    if (s3) s3.textContent = `${state.s3.outputRatio} · ${outputPixels(state.s3.outputRatio, state.s3.outputSize)}`;
    const pdh = $('#pdhOutputHint');
    if (pdh) pdh.textContent = `${state.s3.outputRatio} · ${outputPixels(state.s3.outputRatio, state.s3.outputSize)}`;
    const sp = $('#dhSpaceOutputHint');
    if (sp) sp.textContent = `${state.space.outputRatio} · ${outputPixels(state.space.outputRatio, state.space.outputSize)}`;
  }
  function selectS1Action(id) {
    state.s1.action = id || 'natural';
    $$('[data-s1-action]').forEach(b => b.classList.toggle('active', b.dataset.s1Action === state.s1.action));
  }
  function selectS1Framing(id) {
    state.s1.framing = id || 'half_body';
    $$('[data-s1-framing]').forEach(b => b.classList.toggle('active', b.dataset.s1Framing === state.s1.framing));
    _checkFramingRatioConflict();
  }
  // 全身 + 横屏（16:9 / 1:1）= 物理冲突 — 横屏画面塞站立全身效果差，提醒用户
  let _conflictToastedAt = 0;
  function _checkFramingRatioConflict() {
    const r = state.s1.ratio;
    const f = state.s1.framing;
    const isHoriz = r === '16:9' || r === '1:1';
    if (f === 'full_body' && isHoriz) {
      // 同一秒不重复打扰
      if (Date.now() - _conflictToastedAt < 1500) return;
      _conflictToastedAt = Date.now();
      toast(`⚠️ ${r} 横屏 + 全身：横向画框塞站立全身效果差，建议改用 9:16 竖屏`, '');
    }
  }
  // 自定义背景：上传 → /api/dh/images/upload → 拿 imageUrl 存到 state
  // 同时读图片真实比例，自动把"画面比例"chip 切到最接近的预设（避免后端 cover 裁切丢失大块背景）
  async function uploadS1Background(file) {
    if (!file.type.startsWith('image/')) return toast('背景必须是图片', 'error');
    if (file.size > 30 * 1024 * 1024) return toast('背景图超过 30MB', 'error');
    toast('上传背景图…');
    file = await compressImageBeforeUpload(file);

    // 同步读 bg 实际比例
    let bgRatio = null;
    try {
      const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(); r.readAsDataURL(file); });
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(); i.src = dataUrl; });
      bgRatio = im.naturalWidth / im.naturalHeight;
    } catch {}

    const fd = new FormData();
    fd.append('image', file);
    try {
      const r = await api('/api/dh/images/upload', { method: 'POST', body: fd });
      if (!r.success) throw new Error(r.error || '上传失败');
      state.s1.bgImageUrl = r.imageUrl;
      state.s1.bgImageName = file.name;
      state.s1.bgImageExplicit = true;
      const img = document.getElementById('dhS1BgImg');
      if (img) img.src = r.imageUrl;
      const prev = document.getElementById('dhS1BgPreview');
      if (prev) prev.style.display = 'block';
      const hint = document.getElementById('dhS1BgHint');
      if (hint) hint.textContent = '已选: ' + file.name.slice(0, 24);

      // 按 bgRatio 自动选最接近的预设画面比例
      if (bgRatio) {
        let chosen = null;
        if (bgRatio > 1.6) chosen = '16:9';
        else if (bgRatio < 0.65) chosen = '9:16';
        else if (Math.abs(bgRatio - 1) < 0.1) chosen = '1:1';
        else if (bgRatio < 1) chosen = '3:4';
        else chosen = '4:3';
        if (chosen && chosen !== state.s1.ratio) {
          state.s1.ratio = chosen;
          $$('[data-ratio]').forEach(b => b.classList.toggle('active', b.dataset.ratio === chosen));
          toast(`✅ 背景已就绪 · 画面比例已自动跟随 → ${chosen}（避免裁切）`, 'success');
        } else {
          toast('✅ 背景图已选好，下次生成会使用', 'success');
        }
      } else {
        toast('✅ 背景图已选好，下次生成会使用', 'success');
      }
    } catch (err) {
      toast('背景上传失败：' + err.message, 'error');
    }
  }
  function clearS1Background() {
    state.s1.bgImageUrl = '';
    state.s1.bgImageName = '';
    state.s1.bgImageExplicit = false;
    const prev = document.getElementById('dhS1BgPreview');
    if (prev) prev.style.display = 'none';
    const hint = document.getElementById('dhS1BgHint');
    if (hint) hint.textContent = '不选用风格自带背景';
  }

  // ══════════════ 上传模式：人物 + 背景一键合成 ══════════════
  const DH_IMAGE_UPLOAD_LIMITS = {
    // 原图先允许进入浏览器压缩流程；真正发到后端前仍受 maxCompressedSize 约束。
    maxRawSize: 32 * 1024 * 1024,
    // 多图同时选择时限制原始总量，避免浏览器一次解码过多大图卡死页面。
    maxBatchBytes: 96 * 1024 * 1024,
    // 后端 multer 当前限制是 12MB，压缩后的文件必须严格小于这个值。
    maxCompressedSize: 12 * 1024 * 1024,
    timeoutMs: 45000,
  };

  // 客户端图片压缩：>=600KB 的非透明图先 canvas 缩到 max 1920px / JPEG q0.85，再上传
  // 显著缩短大图（手机原图 5-10MB）的上传时间
  async function compressImageBeforeUpload(file, { maxDim = 1920, quality = 0.85, threshold = 600 * 1024 } = {}) {
    try {
      if (!file || !file.type?.startsWith('image/')) return file;
      // 跳过：小文件 / GIF（动图）/ SVG
      if (file.size < threshold) return file;
      if (/^image\/(gif|svg\+xml)$/i.test(file.type)) return file;
      // 读图
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error('FileReader 失败'));
        r.readAsDataURL(file);
      });
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('图片解码失败'));
        i.src = dataUrl;
      });
      const longSide = Math.max(img.naturalWidth, img.naturalHeight);
      if (longSide <= maxDim && file.size < 2 * 1024 * 1024) return file; // 已经够小且尺寸合适
      const scale = Math.min(1, maxDim / longSide);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      // 白底（避免 PNG 透明 → JPEG 黑底）
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob) return file;
      // 不强制压缩失败的情况
      if (blob.size >= file.size * 0.95) return file;
      const newName = file.name.replace(/\.[^.]+$/, '') + '_c.jpg';
      const out = new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() });
      console.log(`[compress] ${file.name} ${(file.size/1024).toFixed(0)}KB → ${(out.size/1024).toFixed(0)}KB (${w}x${h})`);
      return out;
    } catch (err) {
      console.warn('[compress] 压缩失败，原图上传:', err.message);
      return file;
    }
  }

  function pickUploadableImages(fileList, { maxCount = 8, label = '图片' } = {}) {
    const all = Array.from(fileList instanceof FileList ? fileList : (Array.isArray(fileList) ? fileList : [fileList])).filter(Boolean);
    const images = all.filter(f => f?.type?.startsWith('image/'));
    if (!images.length) return { files: [], error: `请上传${label}文件` };
    const oversize = images.find(f => Number(f.size || 0) > DH_IMAGE_UPLOAD_LIMITS.maxRawSize);
    if (oversize) {
      return { files: [], error: `${oversize.name || label} 超过 12MB，请先压缩后再上传` };
    }
    const total = images.reduce((sum, f) => sum + Number(f.size || 0), 0);
    if (total > DH_IMAGE_UPLOAD_LIMITS.maxBatchBytes) {
      return { files: [], error: `本次选择的${label}总大小超过 36MB，请分批上传` };
    }
    return { files: images.slice(0, maxCount), error: '' };
  }

  async function apiWithTimeout(path, opts = {}, timeoutMs = DH_IMAGE_UPLOAD_LIMITS.timeoutMs) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      return await api(path, { ...opts, signal: opts.signal || ac.signal });
    } catch (err) {
      if (err?.name === 'AbortError') throw new Error('上传超时，请检查网络或压缩图片后重试');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function sha256UploadFile(file) {
    if (!window.crypto?.subtle || !file?.arrayBuffer) return '';
    const buffer = await file.arrayBuffer();
    const digest = await window.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function uploadDhImage(file, options = {}) {
    // 所有图片上传统一先走客户端压缩，避免剧情广告参考图继续原图慢传。
    const compressed = await compressImageBeforeUpload(file, {
      maxDim: options.maxDim || 1600,
      quality: options.quality || 0.82,
      threshold: options.threshold || 300 * 1024,
    });
    // 不做假成功：压缩后仍超过后端上限就直接报错，让用户换更小/更清晰的文件。
    if (Number(compressed?.size || 0) > DH_IMAGE_UPLOAD_LIMITS.maxCompressedSize) {
      throw new Error(`${compressed.name || file.name || '图片'} 压缩后仍超过 12MB，请先压缩后再上传`);
    }
    const uploadRole = options.role || 'reference';
    const contentHash = await sha256UploadFile(compressed);
    if (contentHash) {
      // Server-side asset cache lookup happens before uploading bytes. A cache
      // hit means the same compressed image is already stored on the data disk.
      const cached = await apiWithTimeout(`/api/dh/assets/lookup?sha256=${encodeURIComponent(contentHash)}&role=${encodeURIComponent(uploadRole)}`, {
        method: 'GET',
      }, options.timeoutMs || DH_IMAGE_UPLOAD_LIMITS.timeoutMs);
      if (cached?.success && cached.found) {
        const cachedUrl = cached.imageUrl || cached.url || cached.image_url || cached.asset?.url || '';
        if (cachedUrl) return cachedUrl;
      }
    }
    const fd = new FormData();
    fd.append('image', compressed);
    if (contentHash) fd.append('sha256', contentHash);
    fd.append('role', uploadRole);
    const r = await apiWithTimeout('/api/dh/images/upload', { method: 'POST', body: fd }, options.timeoutMs || DH_IMAGE_UPLOAD_LIMITS.timeoutMs);
    if (!r.success) throw new Error(r.error || '上传失败');
    const imageUrl = r.imageUrl || r.url || r.image_url || r.data?.imageUrl || r.data?.url || r.data?.image_url || '';
    if (!imageUrl) throw new Error('上传成功但没有返回图片地址');
    return imageUrl;
  }

  function _composeBtnSync() {
    const btn = document.getElementById('dhComposeBtn');
    if (!btn) return;
    const ready = !!state.s1.previewUrl && !!state.s1.compose.bgImageUrl;
    btn.disabled = !ready;
    btn.title = !state.s1.previewUrl ? '请先在上方上传一张人物图'
      : !state.s1.compose.bgImageUrl ? '请先选择一张背景图'
      : '保真抠像合成（不重绘人物）';
  }
  async function uploadComposeBg(file) {
    if (!file.type.startsWith('image/')) return toast('背景必须是图片', 'error');
    if (file.size > 30 * 1024 * 1024) return toast('背景图超过 30MB', 'error');
    toast('上传背景图…');
    const t0 = Date.now();
    file = await compressImageBeforeUpload(file);
    const fd = new FormData();
    fd.append('image', file);
    try {
      const r = await api('/api/dh/images/upload', { method: 'POST', body: fd });
      if (!r.success) throw new Error(r.error || '上传失败');
      state.s1.compose.bgImageUrl = r.imageUrl;
      state.s1.compose.bgImageName = file.name;
      const img = document.getElementById('dhComposeBgImg');
      if (img) img.src = r.imageUrl;
      const prev = document.getElementById('dhComposeBgPreview');
      if (prev) prev.style.display = 'block';
      const hint = document.getElementById('dhComposeBgHint');
      if (hint) hint.textContent = '已选: ' + file.name.slice(0, 24);
      _composeBtnSync();
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      toast(`✅ 背景已就绪 (${elapsed}s)，点 🪄 合成`, 'success');
    } catch (err) {
      toast('背景上传失败：' + err.message, 'error');
    }
  }
  function clearComposeBg() {
    state.s1.compose.bgImageUrl = '';
    state.s1.compose.bgImageName = '';
    const prev = document.getElementById('dhComposeBgPreview');
    if (prev) prev.style.display = 'none';
    const hint = document.getElementById('dhComposeBgHint');
    if (hint) hint.textContent = '未选背景';
    _composeBtnSync();
  }
  async function runComposeScene() {
    if (!state.s1.previewUrl) return toast('请先上传人物图', 'error');
    if (!state.s1.compose.bgImageUrl) return toast('请先选择背景图', 'error');
    state.s1.compose.mode = 'fast';
    const btn = document.getElementById('dhComposeBtn');
    const old = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 保真抠像合成中…'; }
    $('#dhS1Loading') && ($('#dhS1Loading').style.display = 'block');
    try {
      const sizePct = Math.max(55, Math.min(95, parseInt(state.s1.compose.sizePct) || 76));
      const r = await api('/api/dh/images/compose-scene', {
        method: 'POST',
        body: {
          person_image_url: state.s1.previewUrl,
          background_image_url: state.s1.compose.bgImageUrl,
          aspectRatio: state.s1.compose.ratio || '9:16',
          output_size: state.s1.outputSize,
          resolution: outputPixels(state.s1.compose.ratio || '9:16', state.s1.outputSize),
          placement: state.s1.compose.placement || 'bottom',
          mode: 'fast',
          person_height_pct: sizePct / 100,
        },
      });
      if (!r.success) throw new Error((r.error || '合成失败') + (r.hint ? ` · ${r.hint}` : ''));
      // 替换预览 = 合成结果（保留 fromUpload=true 让"上传形象不带 AI 描述"逻辑继续生效）
      state.s1.previewUrl = r.imageUrl;
      state.s1.sampleVideoUrl = null;
      $('#dhS1PreviewImg').src = r.imageUrl;
      $('#dhS1Preview').style.display = 'block';
      $('#dhS1Save').disabled = false;
      $('#dhS1Save').title = '保存这张形象到「我的形象」';
      refreshS1PreviewActions();
      _hidePlaceholder();
      toast('🪄 保真合成完成 · 可保存到「我的形象」', 'success');
    } catch (err) {
      toast('合成失败：' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old || '🪄 合成场景图'; }
      $('#dhS1Loading') && ($('#dhS1Loading').style.display = 'none');
      _composeBtnSync();
    }
  }
  // 把 ACTION_PRESETS 渲染成可选 chip 行（按分组 4 个一组写大类标题）
  function renderS1ActionPicker() {
    const host = document.getElementById('dhS1ActionList');
    if (!host) return;
    // 简化：直接平铺所有动作（chip 自动 wrap），放在最前面的"自然交谈"是默认
    host.innerHTML = ACTION_PRESETS
      .map(a => `<button class="dh-motion-action ${a.id === state.s1.action ? 'active' : ''}" data-s1-action="${a.id}" type="button">${a.name}</button>`)
      .join('');
  }

  function setS1AvatarType(type) {
    state.s1.avatarType = type === 'product' ? 'product' : 'normal';
    $$('[data-s1-avatar-type]').forEach(b => b.classList.toggle('active', b.dataset.s1AvatarType === state.s1.avatarType));
    const box = $('#dhS1ProductFields');
    if (box) box.style.display = state.s1.avatarType === 'product' ? '' : 'none';
    const genBtn = $('#dhS1GenBtn');
    if (genBtn) genBtn.innerHTML = state.s1.avatarType === 'product'
      ? '<span>✨</span> 生成商品数字人形象'
      : '<span>✨</span> 生成形象';
    const saveBtn = $('#dhS1Save');
    if (saveBtn) saveBtn.textContent = state.s1.avatarType === 'product'
      ? '💾 保存到商品数字人'
      : '💾 保存到我的形象';
    refreshS1PreviewActions();
  }

  function selectS1ProductMotion(motion) {
    const value = ['hold', 'point', 'explain', 'demo', 'closeup'].includes(motion) ? motion : 'hold';
    state.s1.product = { ...(state.s1.product || {}), motion_style: value };
    state.s1.productFusedKey = '';
    state.s1.productFusedUrl = '';
    $$('[data-s1-product-motion]').forEach(b => b.classList.toggle('active', b.dataset.s1ProductMotion === value));
    refreshS1PreviewActions();
  }

  function renderS1Product() {
    const p = state.s1.product || {};
    const host = $('#dhS1ProductPreview');
    if (!host) return;
    if (p.imageUrl) {
      host.innerHTML = `<img src="${escapeHtml(p.imageUrl)}" alt=""><span>${escapeHtml(p.imageName || '商品图')}${p.uploading ? ' · 上传中…' : ''}</span>`;
    } else if (p.uploading) {
      host.innerHTML = `<span>上传中…</span>`;
    } else {
      host.innerHTML = `<span></span>`;
    }
  }

  async function uploadS1ProductImage(file) {
    if (!file) return;
    if (!file.type?.startsWith('image/')) return toast('请上传商品图片', 'error');
    if (file.size > 30 * 1024 * 1024) return toast('商品图超过 30MB', 'error');
    const fd = new FormData();
    fd.append('image', file);
    const btn = $('#dhS1ProductPickBtn');
    const old = btn?.textContent;
    const prevProduct = { ...(state.s1.product || {}) };
    const localPreview = URL.createObjectURL(file);
    if (btn) { btn.disabled = true; btn.textContent = '上传中…'; }
    state.s1.product = {
      ...(state.s1.product || {}),
      uploading: true,
      imageUrl: localPreview,
      preparedUrl: '',
      cutoutUrl: '',
      imageName: file.name || '商品图',
    };
    state.s1.productFusedKey = '';
    state.s1.productFusedUrl = '';
    renderS1Product();
    try {
      const r = await fetch('/api/dh/products/upload', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + state.token },
        body: fd,
      });
      const raw = await r.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch {}
      if (!data) throw new Error(raw?.trim().startsWith('<') ? '上传接口返回了页面内容，请刷新后重新登录再试' : '上传接口返回格式异常');
      if (!r.ok) throw new Error(data?.error || data?.message || '上传失败');
      if (!data?.success) throw new Error(data?.error || '上传失败');
      state.s1.product = {
        ...(state.s1.product || {}),
        uploading: false,
        imageUrl: data.url,
        preparedUrl: data.preparedUrl || data.url,
        cutoutUrl: data.cutoutUrl || '',
        imageName: data.name || file.name,
      };
      state.s1.productFusedKey = '';
      state.s1.productFusedUrl = '';
      renderS1Product();
      refreshS1PreviewActions();
        toast('商品图已上传，会用于生成商品数字人形象', 'success');
    } catch (err) {
      state.s1.product = { ...prevProduct, uploading: false };
      renderS1Product();
      toast('商品图上传失败：' + err.message, 'error');
    } finally {
      URL.revokeObjectURL(localPreview);
      if (btn) { btn.disabled = false; btn.textContent = old || '上传商品图'; }
      const input = $('#dhS1ProductFile'); if (input) input.value = '';
    }
  }

  function s1ProductFuseKey() {
    const p = state.s1.product || {};
    return [state.s1.previewUrl || '', p.imageUrl || '', p.preparedUrl || '', p.cutoutUrl || '', p.imageName || '', p.scene || 'street', p.motion_style || 'hold', state.s1.avatarType || ''].join('|');
  }

  function normalizeImagePath(url) {
    try {
      const u = new URL(String(url || ''), location.origin);
      return u.pathname.replace(/\/+/g, '/');
    } catch {
      return String(url || '').split('?')[0].split('#')[0].trim();
    }
  }

  function sameImageUrl(a, b) {
    const aa = normalizeImagePath(a);
    const bb = normalizeImagePath(b);
    return !!aa && !!bb && aa === bb;
  }

  function cacheBustImageUrl(url) {
    if (!url || /^data:|^blob:/i.test(url)) return url;
    const join = url.includes('?') ? '&' : '?';
    return `${url}${join}_dhf=${Date.now()}`;
  }

  function sameOriginAssetUrl(url) {
    const raw = String(url || '');
    const marker = '/public/jimeng-assets/';
    const idx = raw.indexOf(marker);
    if (idx >= 0) {
      const pathPart = raw.slice(idx).split('#')[0];
      return pathPart;
    }
    return url;
  }

  function isServerImageUrl(url) {
    return !!url && !/^blob:|^data:/i.test(String(url));
  }

  function setPreviewImageChecked(img, url) {
    if (!img) return Promise.resolve(sameOriginAssetUrl(url));
    const displayUrl = sameOriginAssetUrl(url);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        console.warn('[DH/product-fuse] preview image loading slowly:', displayUrl);
        toast('成品图已生成，图片加载较慢，请稍等片刻', '');
        resolve(displayUrl);
      }, 60000);
      const cleanup = () => {
        clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
      };
      img.onload = () => { cleanup(); resolve(displayUrl); };
      img.onerror = () => { cleanup(); reject(new Error('成品图加载失败')); };
      img.src = cacheBustImageUrl(displayUrl);
    });
  }

  function markS1ProductFused(imageUrl, topview = null) {
    state.s1.previewUrl = imageUrl;
    state.s1.productFusedUrl = imageUrl;
    state.s1.productFusedKey = s1ProductFuseKey();
    if (topview) {
      state.s1.product = {
        ...(state.s1.product || {}),
        topview_image_id: topview.imageId || topview.image_id || topview.topview_image_id || state.s1.product?.topview_image_id || '',
        topview_task_id: topview.taskId || topview.task_id || topview.topview_task_id || state.s1.product?.topview_task_id || '',
        remove_background_task_id: topview.removeBackgroundTaskId || topview.remove_background_task_id || state.s1.product?.remove_background_task_id || '',
        provider: topview.provider || state.s1.product?.provider || 'topview',
      };
    }
  }

  async function pollS1ProductFuseTask(taskId, sceneLabel) {
    const started = Date.now();
    const maxWait = 10 * 60 * 1000;
    let lastMinute = -1;
    while (Date.now() - started < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const r = await api('/api/dh/products/fuse-image/tasks/' + encodeURIComponent(taskId));
      const task = r?.task || {};
      if (task.status === 'done' && task.imageUrl) return task;
      if (task.status === 'error') throw new Error(task.error || '商品数字人融合失败');
      const minute = Math.floor((Date.now() - started) / 60000);
      if (minute !== lastMinute && minute > 0) {
        lastMinute = minute;
        toast(`正在「${sceneLabel}」场景里融合商品数字人，已等待 ${minute} 分钟…`, '');
      }
    }
    throw new Error('合成等待超时，请稍后刷新查看结果或重新提交');
  }

  async function ensureS1ProductFused() {
    if (!isS1ProductMode()) return state.s1.previewUrl;
    state.s1.avatarType = 'product';
    if (!state.s1.previewUrl) throw new Error('请先生成或上传人物照片');
    if (!isServerImageUrl(state.s1.previewUrl)) throw new Error('人物照片仍在上传，请等上传完成后再合成');
    if (!state.s1.product?.imageUrl) throw new Error('商品数字人需要先上传商品图');
    if (!isServerImageUrl(state.s1.product?.imageUrl) || state.s1.product?.uploading) throw new Error('商品图仍在上传，请等上传完成后再合成');
    const key = s1ProductFuseKey();
    if (state.s1.productFusedKey === key && state.s1.productFusedUrl && state.s1.previewUrl === state.s1.productFusedUrl) {
      return state.s1.previewUrl;
    }

    const sceneId = state.s1.product?.scene || 'street';
    const sceneLabel = ((Array.isArray(state._productScenes) ? state._productScenes : []).find(x => x.id === sceneId)?.label) || sceneId;
        toast(`正在「${sceneLabel}」场景里融合商品数字人，约 30-60 秒…`, '');
    const sourcePreviewUrl = state.s1.previewUrl;
    const submitted = await api('/api/dh/products/fuse-image/async', {
      method: 'POST',
      body: {
        image_url: sourcePreviewUrl,
        product: {
          image_url: state.s1.product.imageUrl,
          prepared_url: state.s1.product.preparedUrl || state.s1.product.imageUrl,
          cutout_url: state.s1.product.cutoutUrl || '',
          image_name: state.s1.product.imageName,
          name: state.s1.product.imageName || '',
          gender: state.s1.gender || '',
          selling_points: '',
          motion_style: state.s1.product.motion_style || 'hold',
          scene: sceneId,
        },
      },
    });
    if (!submitted?.success || !submitted.taskId) throw new Error(submitted?.error || '商品数字人融合提交失败');
    const fused = await pollS1ProductFuseTask(submitted.taskId, sceneLabel);
    if (!fused.imageUrl || sameImageUrl(fused.imageUrl, sourcePreviewUrl)) {
      throw new Error('后端没有返回新的商品数字人成品图，请重新点击合成或更换更清晰的商品图');
    }
    const img = $('#dhS1PreviewImg');
    const displayImageUrl = await setPreviewImageChecked(img, fused.imageUrl);
    markS1ProductFused(displayImageUrl || fused.imageUrl, fused.topview || null);
    refreshS1PreviewActions();
        toast('已生成商品数字人形象', 'success');
    return state.s1.previewUrl;
  }

  // ══════════════ Step 1 · 文生图 ══════════════
  async function generateImage() {
    const description = $('#dhS1Desc').value.trim();
    const sceneDescription = $('#dhS1SceneDesc')?.value?.trim() || '';
    const isProduct = isS1ProductMode();
    if (isProduct) state.s1.avatarType = 'product';
    if (isProduct && !state.s1.product?.imageUrl) {
      return toast('商品数字人需要先上传商品图', 'error');
    }
    $('#dhS1Loading').style.display = 'block';
    $('#dhS1Preview').style.display = 'none';
    $('#dhS1GenBtn').disabled = true;
    _hidePlaceholder();

    if (isProduct) {
      toast('两阶段融合中：先生成基础人物，再融合商品+场景，约 60-90 秒…', '');
    }

    try {
      const useS1Background = !!(state.s1.bgImageUrl && state.s1.bgImageExplicit);
      const r = await api('/api/dh/images/generate', {
        method: 'POST',
        body: {
          style: state.s1.style,
          gender: state.s1.gender,
          description,
          scene_description: sceneDescription,
          aspectRatio: state.s1.ratio,
          output_size: state.s1.outputSize,
          resolution: outputPixels(state.s1.ratio, state.s1.outputSize),
          avatar_type: isProduct ? 'product' : state.s1.avatarType,
          action: state.s1.action || 'natural',
          framing: state.s1.framing || 'half_body',
          background_image_url: useS1Background ? state.s1.bgImageUrl : '',
          use_background_image: useS1Background,
          product: isProduct ? {
            image_url: state.s1.product.imageUrl,
            prepared_url: state.s1.product.preparedUrl || state.s1.product.imageUrl,
            cutout_url: state.s1.product.cutoutUrl || '',
            image_name: state.s1.product.imageName,
            name: state.s1.product.imageName || '',
            gender: state.s1.gender || '',
            scene: state.s1.product.scene || 'street',
            selling_points: '',
            motion_style: state.s1.product.motion_style || 'hold',
          } : null,
        },
      });
      if (!r.success) throw new Error(r.error || '生成失败');
      resetS1Preview();
      state.s1.previewUrl = r.imageUrl;
      state.s1.framingWarning = r.warning || '';
      state.s1.fromUpload = false;
      if (isProduct && r.topview?.imageId) {
        markS1ProductFused(r.imageUrl, r.topview);
      } else {
        state.s1.productFusedKey = '';
        state.s1.productFusedUrl = '';
      }
      $('#dhS1PreviewImg').src = r.imageUrl;
      $('#dhS1Preview').style.display = 'block';
      // 关键：resetS1Preview 把 dhS1Save 设了 disabled，这里要把它打开
      $('#dhS1Save').disabled = false;
      $('#dhS1Save').title = '保存这张形象到「我的形象」';
      refreshS1PreviewActions();
      _hidePlaceholder();
      // 给个默认名
      if (!$('#dhS1Name').value) {
        const label = { female: '小姐姐', male: '小哥哥', '': '形象' }[state.s1.gender] || '形象';
        $('#dhS1Name').value = `${{ idol_warm: '暖调', idol_cool: '冷调', documentary: '写实', office: '职场', beach: '海边', studio_plain: '影棚', live_studio: '直播间', business_formal: '商务', tech_lab: '科技', cafe_cozy: '咖啡馆', fitness_energy: '运动', anime_illus: '动漫' }[state.s1.style] || ''}${label}`;
      }
      toast(r.warning || '✨ 图生成完成 · 下面点"生成动态形象"验证驱动效果', r.warning ? '' : 'success');
    } catch (err) {
      toast('生成失败：' + err.message, 'error');
    } finally {
      $('#dhS1Loading').style.display = 'none';
      $('#dhS1GenBtn').disabled = false;
    }
  }

  // ══════════════ Step 1 · 上传 ══════════════
  function bindUpload() {
    const zone = $('#dhS1Upload');
    const input = $('#dhS1UploadFile');
    if (!zone || !input) return;
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if (f) uploadFile(f);
    });
    input.addEventListener('change', () => {
      const f = input.files[0];
      if (f) uploadFile(f);
    });
  }

  async function uploadFile(file) {
    if (!file.type.startsWith('image/')) return toast('只支持图片', 'error');
    if (file.size > 30 * 1024 * 1024) return toast('图片超过 30MB', 'error');
    const originalName = file.name || '';
    const localPreview = URL.createObjectURL(file);
    resetS1Preview();
    state.s1.previewUrl = localPreview;
    state.s1.productFusedKey = '';
    state.s1.productFusedUrl = '';
    state.s1.fromUpload = true;
    $('#dhS1PreviewImg').src = localPreview;
    $('#dhS1Preview').style.display = 'block';
    $('#dhS1Save').disabled = true;
    $('#dhS1Save').title = '图片正在上传，上传完成后可保存';
    refreshS1PreviewActions();
    _hidePlaceholder();
    toast('已显示本地预览，正在上传…');
    const uploadImage = await compressImageBeforeUpload(file);
    const fd = new FormData();
    fd.append('image', uploadImage);
    try {
      const r = await api('/api/dh/images/upload', { method: 'POST', body: fd });
      if (!r.success) throw new Error(r.error || '上传失败');
      if (state.s1.previewUrl && state.s1.previewUrl.startsWith('blob:')) URL.revokeObjectURL(state.s1.previewUrl);
      state.s1.previewUrl = r.imageUrl;
      state.s1.productFusedKey = '';
      state.s1.productFusedUrl = '';
      state.s1.fromUpload = true;  // 标记是上传，别污染 description
      $('#dhS1PreviewImg').src = r.imageUrl;
      $('#dhS1Preview').style.display = 'block';
      // 关键：resetS1Preview 把 dhS1Save 设了 disabled，这里要把它打开
      $('#dhS1Save').disabled = false;
      $('#dhS1Save').title = '保存这张形象到「我的形象」';
      refreshS1PreviewActions();
      _hidePlaceholder();
      if (!$('#dhS1Name').value) $('#dhS1Name').value = '我的形象_' + new Date().toLocaleDateString('zh-CN');
      // 上传的形象不带 AI 描述（那是用户自己的图）
      $('#dhS1Desc').value = '';
      const sceneInput = $('#dhS1SceneDesc');
      if (sceneInput) sceneInput.value = '';
      toast('📤 上传完成 · 请手动确认下方性别（如不准）', 'success');
      _composeBtnSync();
      // 异步识别性别 → 仅建议，不自动覆盖用户手选
      detectUploadedGender(r.imageUrl).catch(() => {});
    } catch (err) {
      $('#dhS1Save').disabled = true;
      $('#dhS1Save').title = '上传失败，请重新选择图片';
      refreshS1PreviewActions();
      toast('上传失败：' + err.message, 'error');
    }
  }

  // 上传图后通过视觉模型识别性别 → 仅给提示；不自动改已选 chip，避免模型误判覆盖用户选择。
  async function detectUploadedGender(imageUrl) {
    try {
      const r = await api('/api/dh/images/detect-gender', { method: 'POST', body: { imageUrl } });
      if (!r?.success || !r.gender) return;
      if (r.gender !== 'male' && r.gender !== 'female') return;
      // 如果用户当前选择与 AI 判断一致，不做任何事
      if (state.s1.gender === r.gender) return;
      // 不一致：只提示，让用户自己决定（不 selectGender，避免 AI 误判把男改成女）
      const aiLabel = r.gender === 'female' ? '女' : '男';
      const curLabel = state.s1.gender === 'female' ? '女' : '男';
      toast(`🧠 AI 识别这张图像是【${aiLabel}】，你目前选的是【${curLabel}】。如果不对请在上方手动切换。`, '');
    } catch {}
  }

  // Step 1 · AI 补充描述（弹窗输入 · 不再直接用底栏关键词）
  let descModalTarget = 'person';
  function setDescModalMode(mode) {
    descModalTarget = mode === 'scene' ? 'scene' : 'person';
    const isScene = descModalTarget === 'scene';
    const title = $('#dhDescModalTitle');
    const label = $('#dhDescModalLabel');
    const input = $('#dhDescInput');
    const row = $('#dhDescPresetRow');
    const submit = $('#dhDescSubmit');
    if (title) title.textContent = isScene ? '✨ AI 编写场景' : '✨ AI 补充人物';
    if (label) label.textContent = isScene
      ? '想要什么样的背景空间？（可留空；留空时使用干净棚拍幕布背景，不自动生成室内/窗边场景）'
      : '想要什么样的人物？（随便写，AI 会扩成详细人物描述）';
    if (input) {
      input.placeholder = isScene
        ? '如：温暖咖啡馆、干净直播间、浅灰影棚幕布、科技展厅'
        : '如：黑长直发戴金丝眼镜，米色毛衣，温柔知性';
      input.maxLength = isScene ? 180 : 300;
    }
    if (submit) submit.innerHTML = isScene ? '✨ 生成场景' : '✨ 让 AI 扩写';
    if (row) {
      row.innerHTML = isScene
        ? `
            <button class="dh-chip dh-chip-sm" data-desc-preset="干净浅灰影棚幕布，柔和棚拍光，背景轻微布纹">影棚幕布</button>
            <button class="dh-chip dh-chip-sm" data-desc-preset="温暖木质咖啡馆，黄昏柔光，窗边绿植和木桌，背景轻微虚化">温暖咖啡馆</button>
            <button class="dh-chip dh-chip-sm" data-desc-preset="现代简洁直播间，柔和补光，干净桌面和浅色背景墙">直播间</button>
            <button class="dh-chip dh-chip-sm" data-desc-preset="高级商务办公室，玻璃隔断，柔和自然光，背景简洁专业">商务办公</button>
            <button class="dh-chip dh-chip-sm" data-desc-preset="极简科技展厅，冷白灯光，浅灰金属质感，背景干净有层次">科技展厅</button>
          `
        : `
            <button class="dh-chip dh-chip-sm" data-desc-preset="温柔知性大学生">温柔知性大学生</button>
            <button class="dh-chip dh-chip-sm" data-desc-preset="精英女高管">精英女高管</button>
            <button class="dh-chip dh-chip-sm" data-desc-preset="潮酷直播达人">潮酷直播达人</button>
            <button class="dh-chip dh-chip-sm" data-desc-preset="邻家治愈系">邻家治愈系</button>
            <button class="dh-chip dh-chip-sm" data-desc-preset="商务英俊顾问">商务英俊顾问</button>
          `;
    }
  }
  function openDescModal() {
    setDescModalMode('person');
    const current = $('#dhS1Desc').value.trim();
    $('#dhDescInput').value = current;
    $('#dhDescModal').style.display = 'flex';
    setTimeout(() => $('#dhDescInput').focus(), 80);
  }
  function openSceneDescModal() {
    setDescModalMode('scene');
    const current = $('#dhS1SceneDesc')?.value?.trim() || '';
    $('#dhDescInput').value = current;
    $('#dhDescModal').style.display = 'flex';
    setTimeout(() => $('#dhDescInput').focus(), 80);
  }
  function closeDescModal() { $('#dhDescModal').style.display = 'none'; }

  async function submitDescEnhance() {
    const keywords = $('#dhDescInput').value.trim();
    if (!keywords && descModalTarget !== 'scene') return toast('请先写一些想法', 'error');
    const btn = $('#dhDescSubmit');
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = descModalTarget === 'scene' ? '🏞️ 生成中…' : '✍️ 扩写中…';
    try {
      const isScene = descModalTarget === 'scene';
      const r = await api(isScene ? '/api/dh/scene/enhance' : '/api/dh/describe/enhance', {
        method: 'POST',
        body: isScene
          ? { style: state.s1.style, gender: state.s1.gender, keywords, person_description: $('#dhS1Desc')?.value?.trim() || '' }
          : { style: state.s1.style, gender: state.s1.gender, keywords },
      });
      if (!r.success) throw new Error(r.error || (isScene ? 'AI 场景生成失败' : 'AI 补全失败'));
      if (isScene) $('#dhS1SceneDesc').value = r.scene_description || r.description || '';
      else $('#dhS1Desc').value = r.description;
      closeDescModal();
      toast(isScene ? '✨ 已生成场景描述（可继续微调）' : '✨ 已补充人物描述（可继续微调）', 'success');
    } catch (err) {
      toast((descModalTarget === 'scene' ? 'AI 场景失败：' : 'AI 补充失败：') + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  // ══════════════ Step 1.5 · 动态预览样片 ══════════════
  async function generateSample() {
    if (!state.s1.previewUrl) return toast('请先生成或上传图片', 'error');
    if (isS1ProductMode()) return toast('商品数字人形象先完成商品融合后直接保存，不在这里生成动态样片', 'error');
    $('#dhS1SampleArea').style.display = 'none';
    $('#dhS1SampleRunning').style.display = 'flex';
    // 动态预览跑的时候，保存按钮仍可用 —— 用户可以直接保存静态图，不必等
    $('#dhS1SampleStage').textContent = '正在生成动态形象，可以直接保存或等结果';
    $('#dhS1SampleElapsed').textContent = '0s';
    try {
      await ensureS1ProductFused();
      const r = await api('/api/dh/samples/generate', {
        method: 'POST',
        body: { image_url: state.s1.previewUrl, sample_text: '你好，我是 AI 数字人。' },
      });
      if (!r.success) throw new Error(r.error || '提交失败');
      state.s1.sampleTaskId = r.taskId;
      pollSample(r.taskId);
    } catch (err) {
      $('#dhS1SampleRunning').style.display = 'none';
      $('#dhS1SampleArea').style.display = 'flex';
      toast('样片生成失败：' + err.message, 'error');
    }
  }

  function pollSample(taskId) {
    if (state.s1.samplePollTimer) clearInterval(state.s1.samplePollTimer);
    const start = Date.now();
    const SOFT_WAIT = 5 * 60 * 1000;
    const MAX = 20 * 60 * 1000;
    const stageMap = {
      prepare_image: '🖼️ 准备照片中',
      prepare_audio: '🎤 准备配音中',
      detecting: '🔍 识别人脸中',
      submitting: '⚡ 提交动态形象',
      running: '🎬 AI 正在让你的形象动起来',
      polling: '🎬 AI 正在让你的形象动起来',
      pending: '⏳ 动态形象排队中',
      queued: '⏳ 动态形象排队中',
      post_effects: '✨ 后期处理中',
      done: '✅ 完成',
    };
    const tick = async () => {
      try {
        const r = await api('/api/dh/samples/' + taskId);
        if (!r?.success) return;
        const t = r.task;
        const elapsed = Math.round((Date.now() - start) / 1000);
        $('#dhS1SampleElapsed').textContent = elapsed + 's';
        const friendlyStage = stageMap[t.stage] || stageMap[t.status] || '🎬 AI 正在生成动态形象';
        let waitHint = '';
        if (Date.now() - start > SOFT_WAIT) {
          waitHint = `（${Math.floor(elapsed / 60)} 分钟，生成队列较慢，仍在继续等待）`;
        } else if (elapsed > 60) {
          waitHint = `（${Math.floor(elapsed / 60)} 分钟，通常 1-5 分钟）`;
        }
        $('#dhS1SampleStage').textContent = friendlyStage + waitHint;

        if (t.status === 'done' && t.video_url) {
          clearInterval(state.s1.samplePollTimer);
          state.s1.samplePollTimer = null;
          state.s1.sampleVideoUrl = t.video_url;
          // 切到视频预览
          $('#dhS1PreviewImg').style.display = 'none';
          const v = $('#dhS1SampleVideo');
          v.src = t.video_url;
          v.style.display = 'block';
          v.play().catch(() => {});
          // 显示完成提示 + 解锁保存
          $('#dhS1SampleRunning').style.display = 'none';
          $('#dhS1SampleArea').style.display = 'flex';
          $('#dhS1SampleBtn').innerHTML = '↻ 再生成一次样片';
          $('#dhS1SampleDone').style.display = 'block';
          $('#dhS1Save').disabled = false;
          $('#dhS1Save').title = '';
          toast(`🎉 样片已出 · 耗时 ${elapsed}s`, 'success');
          return;
        }
        if (t.status === 'error') {
          clearInterval(state.s1.samplePollTimer);
          state.s1.samplePollTimer = null;
          $('#dhS1SampleRunning').style.display = 'none';
          $('#dhS1SampleArea').style.display = 'flex';
          // 动态预览失败不影响保存静态图
          toast('样片失败：' + (t.error || '') + '（不影响保存静态形象）', 'error');
          return;
        }
        if (Date.now() - start > MAX) {
          clearInterval(state.s1.samplePollTimer);
          state.s1.samplePollTimer = null;
          $('#dhS1SampleRunning').style.display = 'none';
          $('#dhS1SampleArea').style.display = 'flex';
          toast('动态形象仍未完成，已停止等待，请重试或换图', 'error');
        }
      } catch (err) { console.warn('sample poll', err); }
    };
    tick();
    state.s1.samplePollTimer = setInterval(tick, 6000);
  }

  // skipSample 废弃 — 强制要求生成样片再保存

  // ══════════════ Step 1 · 保存到我的形象 ══════════════
  async function saveAvatar() {
    console.log('[saveAvatar] click, previewUrl=', !!state.s1.previewUrl, 'name=', $('#dhS1Name').value);
    const name = $('#dhS1Name').value.trim();
    if (!name) { toast('请输入形象名称', 'error'); alert('保存失败：请输入形象名称'); return; }
    if (!state.s1.previewUrl) { toast('请先生成或上传图片', 'error'); alert('保存失败：请先生成或上传图片'); return; }
    const isProduct = isS1ProductMode();
    if (isProduct) state.s1.avatarType = 'product';
    if (isProduct && !isS1ProductFused()) {
      refreshS1PreviewActions();
      toast('请先点击“合成商品数字人形象”，成功后再保存', 'error');
      return;
    }
    // 动态样片是可选验证，不再硬性要求 — 静态图也能直接保存到「我的形象」

    try {
      const saveBtn = $('#dhS1Save');
      if (isProduct && saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '正在保存商品数字人…'; }
      let finalImageUrl = state.s1.previewUrl;
      if (isProduct) finalImageUrl = state.s1.productFusedUrl || state.s1.previewUrl;
      const productPayload = isProduct ? {
        image_url: state.s1.product?.imageUrl || '',
        prepared_url: state.s1.product?.preparedUrl || state.s1.product?.imageUrl || '',
        cutout_url: state.s1.product?.cutoutUrl || '',
        image_name: state.s1.product?.imageName || '',
        name: state.s1.product?.imageName || '',
        gender: state.s1.gender || '',
        selling_points: '',
        motion_style: state.s1.product?.motion_style || 'hold',
        scene: state.s1.product?.scene || 'street',
        topview_image_id: state.s1.product?.topview_image_id || '',
        topview_task_id: state.s1.product?.topview_task_id || '',
        remove_background_task_id: state.s1.product?.remove_background_task_id || '',
        provider: state.s1.product?.provider || 'topview',
      } : null;

      const r = await api('/api/dh/my-avatars', {
        method: 'POST',
        body: {
          name,
          imageUrl: finalImageUrl,
          sampleVideoUrl: state.s1.sampleVideoUrl || null,
          gender: state.s1.gender,
          style: state.s1.style,
          avatar_type: isProduct ? 'product' : state.s1.avatarType,
          product: productPayload,
          source: isProduct ? 'product-avatar' : state.s1.mode,
          // 上传的不记 AI 描述（那是用户自己的图）
          description: state.s1.fromUpload ? '' : ($('#dhS1Desc')?.value?.trim() || ''),
          scene_description: state.s1.fromUpload ? '' : ($('#dhS1SceneDesc')?.value?.trim() || ''),
        },
      });
      if (!r.success) throw new Error(r.error || '保存失败');
      toast(isProduct ? '已保存到我的形象 → 商品数字人' : (state.s1.sampleVideoUrl ? '💾 已保存（含动态样片）' : '💾 已保存（静态）'), 'success');
      // 清状态 + 跳 Step 2
      resetS1Preview();
      $('#dhS1Desc').value = '';
      const sceneInput = $('#dhS1SceneDesc');
      if (sceneInput) sceneInput.value = '';
      $('#dhS1Name').value = '';
      state.s1.avatarType = 'normal';
      state.s1.product = { imageUrl: '', preparedUrl: '', cutoutUrl: '', imageName: '', name: '', selling_points: '', motion_style: 'hold', scene: 'street' };
      setS1AvatarType('normal');
      renderS1Product();
      state.selectedAvatar = r.data;
      // 新形象立即同步到广场（仅 AI 生成的）
      if (r.data) {
        const imgUrl = r.data.image_url || finalImageUrl;
        if (imgUrl && !(r.data.avatar_type === 'product') && r.data.source !== 'upload') {
          state.myAvatars = state.myAvatars.filter(a => a.id !== r.data.id);
          state.myAvatars.unshift(r.data);
          if (state.plaza.loaded) { _syncUserAvatarsToPlaza(); }
        }
      }
      switchTab('step2');
    } catch (err) {
      console.error('[saveAvatar] failed:', err);
      toast('保存失败：' + err.message, 'error');
      alert('保存失败：' + err.message);
    } finally {
      const saveBtn = $('#dhS1Save');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = isS1ProductMode() ? '💾 保存到商品数字人' : '💾 保存到我的形象';
        refreshS1PreviewActions();
      }
    }
  }

  async function fuseS1ProductAvatar() {
    if (!isS1ProductMode()) return;
    state.s1.avatarType = 'product';
    if (state.s1.productFusing) return;
    if (!state.s1.previewUrl) return toast('请先上传或生成一张人物照片', 'error');
    if (!state.s1.product?.imageUrl) return toast('请先上传商品图', 'error');
    if (!isServerImageUrl(state.s1.previewUrl)) return toast('人物照片仍在上传，请等上传完成后再合成', 'error');
    if (!isServerImageUrl(state.s1.product?.imageUrl) || state.s1.product?.uploading) return toast('商品图仍在上传，请等上传完成后再合成', 'error');
    const btn = $('#dhS1Regen');
    const old = btn?.textContent;
    state.s1.productFusing = true;
    refreshS1PreviewActions();
    if (btn) { btn.disabled = true; btn.textContent = '正在生成商品数字人形象…'; }
    try {
      await ensureS1ProductFused();
      refreshS1PreviewActions();
    } catch (err) {
      const msg = /Failed to fetch|NetworkError|Load failed/i.test(err.message || '')
        ? '网络连接中断，请稍后查看是否已生成，或重新点击合成'
        : err.message;
      toast('商品数字人合成失败：' + msg, 'error');
    } finally {
      state.s1.productFusing = false;
      if (btn) { btn.disabled = false; btn.textContent = old || '🪄 合成商品数字人形象'; }
      refreshS1PreviewActions();
    }
  }

  // ══════════════ Step 2 · 我的形象列表 ══════════════
  async function loadMyAvatars() {
    try {
      const r = await api('/api/dh/my-avatars');
      state.myAvatars = r?.data || [];
      renderMyAvatars();
      updateAvCountBadge();
      // 自动恢复未完成的 promote 轮询
      _resumeRunningPromotes();
      // 同步到广场（如果广场已加载）
      if (state.plaza.loaded) { _syncUserAvatarsToPlaza(); renderPlaza(); }
    } catch (err) {
      console.warn(err);
    }
  }

  function updateAvCountBadge() {
    const n = state.myAvatars.length;
    const b = $('#dhMyAvCount');
    if (b) { b.style.display = n ? 'inline-block' : 'none'; b.textContent = n; }
    const products = state.myAvatars.filter(a => a.avatar_type === 'product' || a.type === 'product');
    const videos = state.myAvatars.filter(a => a.sample_video_url && !(a.avatar_type === 'product' || a.type === 'product'));
    const images = state.myAvatars.filter(a => !(a.avatar_type === 'product' || a.type === 'product'));
    const vc = $('#dhVideoCount'); if (vc) vc.textContent = videos.length;
    const ic = $('#dhImageCount'); if (ic) ic.textContent = images.length;
  }

  function _avatarCardHtml(a, opts = {}) {
    const pickMode = !!opts.pickMode || !!state.avatarPickReturn;
    const view = opts.view || '';
    const forceImageView = view === 'image';
    const selId = state.selectedAvatar?.id;
    const selected = a.id === selId;
    const img = a.image_url || a.photo_url || '';
    const hasVideo = !!(a.sample_video_url || a.video_url);
    const video = forceImageView ? null : (a.sample_video_url || a.video_url || null);
    const sourceTag = forceImageView && hasVideo ? '📸 图片素材 · 已有视频' : (a.source === 'upload' ? '📤 上传' : a.source === 'dual_generate' ? '👥 双人生成' : '🎨 AI 生成');
    const genderTag = a.gender === 'female' ? '女' : a.gender === 'male' ? '男' : '';
    const thumb = a.id ? `/api/dh/my-avatars/${a.id}/thumbnail` : img;
    const fallbackImg = img || thumb;
    const safeFallback = escapeHtml(withAuthQuery(fallbackImg));
    const safeThumb = escapeHtml(withAuthQuery(thumb));
    const media = `<div class="dh-av-media ${video ? 'dh-av-media-video' : ''}" ${video ? `data-avatar-video-preview="${escapeHtml(withAuthQuery(video))}" data-avatar-title="${escapeHtml(a.name || '视频素材')}" title="点击播放视频"` : ''}>${video
      ? `<img src="${safeThumb}" alt="${escapeHtml(a.name)}" loading="lazy" decoding="async" data-fallback-src="${safeFallback}" onerror="window.__dhAvatarImageFallback&&window.__dhAvatarImageFallback(this)"><span class="dh-task-thumb-play">▶</span>`
      : `<img src="${safeThumb}" alt="${escapeHtml(a.name)}" data-fallback-src="${safeFallback}" onerror="window.__dhAvatarImageFallback&&window.__dhAvatarImageFallback(this)">`
    }</div>`;

    const promoting = state.promoting[a.id];
    const isProduct = a.avatar_type === 'product' || a.type === 'product';
    let actionRow;
    if (isProduct) {
      if (promoting) {
        actionRow = `<div class="dh-promote-progress" style="margin:0 14px 12px">
          <div class="dh-gen-spinner" style="width:14px;height:14px;border-width:2px;margin:0"></div>
          <span>${promoting.stage || '生成动态中'} · ${promoting.elapsed || 0}s</span>
        </div>`;
      } else {
        actionRow = `<div class="dh-av-card-actions">
          ${pickMode ? `<button class="dh-btn dh-btn-primary dh-btn-sm" data-act="select" data-av-id="${a.id}">✓ 选中素材</button>` : ''}
          <button class="dh-btn dh-btn-ghost dh-btn-sm" data-act="edit-av" data-av-id="${a.id}" title="编辑名称/性别">✎</button>
          <button class="dh-btn dh-btn-ghost dh-btn-sm" data-act="delete" data-av-id="${a.id}" title="删除">🗑️</button>
        </div>`;
      }
    } else if (video) {
      actionRow = `<div class="dh-av-card-actions">
        ${pickMode ? `<button class="dh-btn dh-btn-primary dh-btn-sm" data-act="select" data-av-id="${a.id}">✓ 选中用这个</button>` : ''}
        <button class="dh-btn dh-btn-ghost dh-btn-sm" data-act="edit-av" data-av-id="${a.id}" title="编辑名称/性别">✎</button>
        <button class="dh-btn dh-btn-ghost dh-btn-sm" data-act="delete" data-av-id="${a.id}" title="删除">🗑️</button>
      </div>`;
    } else if (promoting) {
      actionRow = `<div class="dh-promote-progress" style="margin:0 14px 12px">
        <div class="dh-gen-spinner" style="width:14px;height:14px;border-width:2px;margin:0"></div>
        <span>${promoting.stage || '渲染中'} · ${promoting.elapsed || 0}s</span>
      </div>`;
    } else {
      actionRow = `<div class="dh-av-card-actions">
        ${pickMode ? `<button class="dh-btn dh-btn-primary dh-btn-sm" data-act="select" data-av-id="${a.id}">✓ 选中</button>` : (hasVideo && forceImageView ? `<button class="dh-btn dh-btn-ghost dh-btn-sm" type="button" onclick="window._dhSwitchAvTab&&window._dhSwitchAvTab('video')">查看视频素材</button>` : `<button class="dh-btn dh-btn-primary dh-btn-sm" data-act="promote" data-av-id="${a.id}">🎬 生成视频素材</button>`)}
        <button class="dh-btn dh-btn-ghost dh-btn-sm" data-act="edit-av" data-av-id="${a.id}" title="编辑名称/性别">✎</button>
        <button class="dh-btn dh-btn-ghost dh-btn-sm" data-act="delete" data-av-id="${a.id}" title="删除">🗑️</button>
      </div>`;
    }

    return `<div class="dh-av-card ${isProduct ? 'dh-av-card-product' : ''} ${selected ? 'selected' : ''}" data-av-id="${a.id}">
      ${media}
      <div class="dh-av-card-meta">
        <div class="dh-av-card-name">
          <span>${escapeHtml(a.name)}</span>
          ${selected ? '<span class="dh-av-tag">已选中</span>' : ''}
        </div>
        <div class="dh-av-card-sub">
          <span>${sourceTag}</span>${genderTag ? `<span>· ${genderTag}</span>` : ''}
        </div>
      </div>
      ${actionRow}
    </div>`;
  }

  function renderMyAvatars() {
    const videoGrid = $('#dhVideoGrid');
    if (!videoGrid) return;
    // 两类：图片素材（含正在 promote 中的）/ 视频素材
    const products = state.myAvatars.filter(a => a.avatar_type === 'product' || a.type === 'product');
    const videos = state.myAvatars.filter(a => a.sample_video_url && !(a.avatar_type === 'product' || a.type === 'product'));
    const images = state.myAvatars.filter(a => !(a.avatar_type === 'product' || a.type === 'product')); // 图片素材始终保留，视频素材独立展示

    // Tab：'image' | 'video' | 'product'，默认 video（视频素材可直接驱动说话）
    const dhTabbed = state._myAvTab || 'image';
    state._myAvTab = dhTabbed;

    // 注入 Tab Bar 到 HTML 里预留的 #dhMyAvTabsHost
    const host = document.getElementById('dhMyAvTabsHost');
    if (host) {
      const mkTab = (key, label, count) => {
        const active = key === dhTabbed;
        const cls = active
          ? 'background:linear-gradient(135deg,#21FFF3,#FFF600);color:#0D0E12;font-weight:700'
          : 'color:var(--dh-text-muted)';
        return `<button onclick="window._dhSwitchAvTab('${key}')" style="padding:8px 18px;border-radius:999px;border:0;cursor:pointer;font-size:13px;background:transparent;${cls}">${label} <span style="opacity:0.7">${count}</span></button>`;
      };
      host.style.cssText = 'display:flex;gap:6px;padding:4px;background:var(--dh-bg-soft,#141519);border:1px solid var(--dh-border,#2A2D34);border-radius:999px;width:fit-content;align-items:center;flex-wrap:wrap';
      host.innerHTML = mkTab('image', '📸 图片素材', images.length)
                     + mkTab('video', '🎬 视频素材', videos.length)
                     + mkTab('product', '🛍️ 商品数字人', products.length)
                     + (state.avatarPickReturn ? `<button class="dh-link-btn" data-tab-go="plaza" style="padding:8px 12px">去形象广场选 →</button>` : '');
    }

    // 渲染当前 Tab
    const list = dhTabbed === 'product' ? products : dhTabbed === 'video' ? videos : images;
    if (!list.length) {
      const empties = {
        image: { icon: '📸', text: '还没有图片形象', sub: '去 Step1 生成或上传一张照片' },
        video: { icon: '🎬', text: '还没有视频素材', sub: '在「📸 图片素材」点「🎬 生成视频素材」' },
        product: { icon: '🛍️', text: '还没有商品数字人', sub: '去 Step1 选择「商品数字人」并上传商品图生成' },
      };
      const e = empties[dhTabbed];
      videoGrid.innerHTML = `<div class="dh-empty">
        <div class="dh-empty-icon">${e.icon}</div>
        <div class="dh-empty-text">${e.text}</div>
        <div class="dh-empty-sub">${e.sub}</div>
      </div>`;
    } else {
      videoGrid.innerHTML = list.map(a => _avatarCardHtml(a, { pickMode: !!state.avatarPickReturn, view: dhTabbed })).join('');
    }
  }

  // Tab 切换 — 我的形象
  window._dhSwitchAvTab = function(key) {
    state._myAvTab = key;
    renderMyAvatars();
  };

  // Tab 切换 — 声音克隆（克隆 / 列表）
  window._dhSwitchVcTab = function(key) {
    const paneClone = document.getElementById('dhVcPaneClone');
    const paneList = document.getElementById('dhVcPaneList');
    const tabClone = document.getElementById('dhVcTabClone');
    const tabList = document.getElementById('dhVcTabList');
    if (!paneClone || !paneList) return;
    const isList = key === 'list';
    paneClone.style.display = isList ? 'none' : '';
    paneList.style.display = isList ? '' : 'none';
    const activeStyle = 'background:linear-gradient(135deg,#21FFF3,#FFF600);color:#0D0E12;font-weight:700';
    const idleStyle = 'background:transparent;color:var(--dh-text-muted)';
    const baseStyle = 'padding:8px 18px;border-radius:999px;border:0;cursor:pointer;font-size:13px';
    if (tabClone) tabClone.style.cssText = baseStyle + ';' + (isList ? idleStyle : activeStyle);
    if (tabList) tabList.style.cssText = baseStyle + ';' + (isList ? activeStyle : idleStyle);
  };

  // 图片 → 视频 promote（持久化 task_id 到 portrait，刷新页面也能恢复）
  async function promoteToVideo(avatarId) {
    try {
      const r = await api(`/api/dh/my-avatars/${avatarId}/promote-to-video`, { method: 'POST' });
      if (!r.success) throw new Error(r.error || '提交失败');
      state.promoting[avatarId] = { taskId: r.taskId, elapsed: 0, stage: '提交中' };
      // 立即把 task_id 写到 portrait（刷新后 loadMyAvatars 能恢复）
      try {
        await api(`/api/dh/my-avatars/${avatarId}`, {
          method: 'PATCH',
          body: { sample_task_id: r.taskId, sample_status: 'running', sample_started_at: Date.now() },
        });
        // 更新内存
        const a = state.myAvatars.find(x => x.id === avatarId);
        if (a) { a.sample_task_id = r.taskId; a.sample_status = 'running'; }
      } catch {}
      // 留在「图片素材」Tab，正在生成中的图片会显示进度条
      state._myAvTab = 'image';
      renderMyAvatars();
      pollPromote(avatarId, r.taskId);
    } catch (err) {
      toast('失败：' + err.message, 'error');
    }
  }

  // 加载 my-avatars 后，自动恢复未完成的 promote 任务的轮询
  function _resumeRunningPromotes() {
    (state.myAvatars || []).forEach(a => {
      if (!a.sample_video_url && a.sample_task_id && !state.promoting[a.id]) {
        const elapsed = a.sample_started_at ? Math.round((Date.now() - a.sample_started_at) / 1000) : 0;
        // 超过 10 分钟的认为已僵死，不再恢复
        if (elapsed > 600) return;
        console.log(`[DH] 恢复轮询 promote 任务 avatar=${a.id} task=${a.sample_task_id} elapsed=${elapsed}s`);
        state.promoting[a.id] = { taskId: a.sample_task_id, elapsed, stage: '恢复轮询中' };
        pollPromote(a.id, a.sample_task_id);
      }
    });
  }

  function pollPromote(avatarId, taskId) {
    const start = Date.now();
    const MAX = 5 * 60 * 1000;
    const stageMap = { prepare_image:'🖼️ 准备图片', detecting:'🔍 检测人脸', submitting:'⚡ 提交渲染', running:'🎨 AI 渲染中', post_effects:'✨ 后处理', done:'✅ 完成' };
    const tick = async () => {
      try {
        const r = await api('/api/dh/samples/' + taskId);
        if (!r?.success) return;
        const t = r.task;
        const elapsed = Math.round((Date.now() - start) / 1000);
        const info = state.promoting[avatarId];
        if (info) { info.elapsed = elapsed; info.stage = stageMap[t.stage] || t.stage || '渲染中'; }
        if (t.status === 'done' && t.video_url) {
          // 回写到 portrait_db（PATCH 内部会自动 sample_status='done', sample_task_id=null）
          try {
            await api(`/api/dh/my-avatars/${avatarId}`, { method: 'PATCH', body: { sample_video_url: t.video_url } });
          } catch {}
          delete state.promoting[avatarId];
          clearInterval(state.promoting[avatarId + '_timer']);
          // 切到「已生成视频」Tab 让用户立即看到结果
          state._myAvTab = 'video';
          await loadMyAvatars();
          toast(`🎉 已升级为视频素材 · 耗时 ${elapsed}s`, 'success');
          return;
        }
        if (t.status === 'error') {
          // 标记失败到 portrait（让用户能看到失败状态）
          try {
            await api(`/api/dh/my-avatars/${avatarId}`, { method: 'PATCH', body: { sample_status: 'failed', sample_task_id: null } });
          } catch {}
          delete state.promoting[avatarId];
          clearInterval(state.promoting[avatarId + '_timer']);
          await loadMyAvatars();
          toast('失败：' + (t.error || ''), 'error');
          return;
        }
        renderMyAvatars();
        if (Date.now() - start > MAX) {
          delete state.promoting[avatarId];
          clearInterval(state.promoting[avatarId + '_timer']);
          toast('超时', 'error');
        }
      } catch (err) { console.warn('promote poll', err); }
    };
    tick();
    state.promoting[avatarId + '_timer'] = setInterval(tick, 6000);
  }

  function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  window.__dhAvatarMissingNode = function() {
    const box = document.createElement('div');
    box.className = 'dh-av-img-missing';
    const text = document.createElement('span');
    text.textContent = '图片未同步到本地';
    box.appendChild(text);
    return box;
  };

  window.__dhAvatarImageFallback = function(img) {
    if (!img) return;
    const fallback = img.dataset?.fallbackSrc || '';
    if (fallback && img.src !== fallback && !img.dataset.triedFallback) {
      img.dataset.triedFallback = '1';
      img.src = fallback;
      setTimeout(() => {
        if (!img.complete || img.naturalWidth < 2) img.replaceWith(window.__dhAvatarMissingNode());
      }, 800);
      return;
    }
    img.replaceWith(window.__dhAvatarMissingNode());
  };

  window.__dhAvatarVideoFallback = function(video) {
    if (!video) return;
    const fallback = video.dataset?.fallbackSrc || '';
    if (fallback) {
      const img = document.createElement('img');
      img.src = fallback;
      img.onerror = () => img.replaceWith(window.__dhAvatarMissingNode());
      video.replaceWith(img);
    } else {
      video.replaceWith(window.__dhAvatarMissingNode());
    }
  };

  window.__dhTaskCoverFallback = function(media) {
    if (!media) return;
    const cover = media.closest?.('.dh-task-thumb-cover');
    if (!cover) return;
    cover.classList.add('is-missing');
    cover.querySelectorAll('img, video').forEach(node => {
      try { node.removeAttribute('src'); } catch {}
      node.remove();
    });
  };

  function openImagePreview(src, title = '') {
    if (!src) return;
    let mask = document.getElementById('__dh_image_preview');
    if (!mask) {
      mask = document.createElement('div');
      mask.id = '__dh_image_preview';
      mask.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.86);display:none;align-items:center;justify-content:center;padding:36px';
      mask.innerHTML = `<button type="button" data-img-preview-close style="position:absolute;top:18px;right:22px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;border-radius:999px;padding:8px 12px;cursor:pointer">关闭</button><div style="max-width:min(92vw,1100px);max-height:88vh;text-align:center"><img alt="" style="max-width:100%;max-height:82vh;object-fit:contain;border-radius:10px"><div style="margin-top:10px;color:rgba(255,255,255,.78);font-size:13px"></div></div>`;
      document.body.appendChild(mask);
      mask.addEventListener('click', e => { if (e.target === mask || e.target.closest('[data-img-preview-close]')) mask.style.display = 'none'; });
    }
    const img = mask.querySelector('img');
    const cap = mask.querySelector('div div');
    if (img) img.src = src;
    if (cap) cap.textContent = title || '';
    mask.style.display = 'flex';
  }

  async function selectAvatar(id) {
    const a = state.myAvatars.find(x => x.id === id);
    if (!a) return;
    const isProduct = a.avatar_type === 'product' || a.type === 'product';
    state.selectedAvatar = a;
    renderMyAvatars();
    if (state.avatarPickReturn === 'step3') {
      state.avatarPickReturn = '';
      renderSelectedAvatar();
      toast(`已选中「${a.name}」，返回生成数字人`, 'success');
      switchTab('step3');
      return;
    }
    if (state.avatarPickReturn === 'space-guide' || state.avatarPickReturn === 'material-film' || state.avatarPickReturn === 'luxury-ad') {
      const returnTab = state.avatarPickReturn;
      state.avatarPickReturn = '';
      renderSelectedAvatar();
      if (returnTab === 'luxury-ad' || returnTab === 'material-film') {
        if (state.luxuryAd.segments?.length) state.luxuryAd.keyframes = [];
        renderLuxuryAdPerson();
        renderLuxuryAdStoryboard();
        updateLuxuryAdStepLocks();
      } else renderSpaceGuide();
      const returnLabel = returnTab === 'luxury-ad' ? '剧情广告' : (returnTab === 'material-film' ? '素材审片' : '素材审片');
      toast(`已选中「${a.name}」，返回${returnLabel}`, 'success');
      switchTab(returnTab);
      return;
    }
    if (isProduct) {
      toast(`已选中「${a.name}」，可生成商品口播视频`, 'success');
      switchTab('step3');
      setTimeout(() => autoWriteProductScript(a), 700);
    } else {
      toast(`已选中「${a.name}」，去第三步写稿出片`, 'success');
      setTimeout(() => switchTab('step3'), 500);
    }
  }

  async function autoWriteProductScript(avatar) {
    const topic = (avatar.name || '商品').replace(/^商品_/, '').replace(/_\d+$/, '');
    const textArea = $('#dhS3Text');
    if (textArea) { textArea.value = ''; textArea.placeholder = '✨ AI 正在自动写稿…'; }
    try {
      const r = await api('/api/dh/scripts/write', {
        method: 'POST',
        body: { topic, duration_sec: 30, style: 'energetic', mode: 'product', product: { name: topic } },
      });
      if (!r.success) throw new Error(r.error || '写稿失败');
      if (textArea) { textArea.value = r.text; textArea.placeholder = ''; }
      updateS3Meta();
      toast(`✨ 写好 ${r.char_count || ''} 字，正在自动拆分段落…`, 'success');
      await segmentScript(30);
    } catch (e) {
      if (textArea) textArea.placeholder = '';
      toast('自动写稿失败：' + e.message, 'error');
    }
  }

  // ══════════════ 形象广场 ══════════════
  state.plaza = { items: [], category: '', gender: '', loaded: false };

  // 将 state.myAvatars 中的 AI 生成形象同步到广场 items（可重复调用）
  function _syncUserAvatarsToPlaza() {
    // 保留预设条目，移除旧的用户条目
    state.plaza.items = state.plaza.items.filter(it => !it._user);
    const userAvatars = (state.myAvatars || []).filter(a => {
      if (!a || a.source === 'upload') return false;
      return a.source === 'generate' || a.source === 'product-dh' || a.source === 'dual_generate'
        || a.avatar_type === 'product' || a.type === 'product';
    });
    for (const a of userAvatars) {
      const imgUrl = a.image_url || a.photo_url || '';
      if (!imgUrl) continue;
      const isProduct = a.avatar_type === 'product' || a.type === 'product';
      const isVideo = !!a.sample_video_url && !isProduct;
      state.plaza.items.push({
        key: 'user_' + a.id,
        url: imgUrl,
        name: a.name,
        category: isProduct ? 'mine_product' : 'mine_video',
        gender: a.gender || 'neutral',
        assetKind: isProduct ? 'product' : (isVideo ? 'video' : 'image'),
        _user: true,
        _avatarId: a.id,
        _avatarData: a,
      });
    }
    // 动态维护"我生成的"分类选项
    const sel = $('#dhPlazaCategory');
    if (sel) {
      [
        ['mine_video', '生成视频素材'],
        ['mine_product', '商品数字人素材'],
      ].forEach(([value, label]) => {
        const hasItems = state.plaza.items.some(it => it.category === value);
        const existing = sel.querySelector(`option[value="${value}"]`);
        if (hasItems && !existing) {
          const opt = document.createElement('option');
          opt.value = value; opt.textContent = label;
          sel.appendChild(opt);
        } else if (!hasItems && existing) {
          existing.remove();
          if (state.plaza.category === value) state.plaza.category = '';
        }
      });
    }
  }

  async function loadPlaza() {
    const grid = $('#dhPlazaGrid');
    if (!grid) return;
    if (!state.plaza.loaded) {
      grid.innerHTML = '<div class="dh-empty"><div class="dh-empty-icon">⏳</div><div class="dh-empty-text">加载中...</div></div>';
      try {
        const r = await fetch('/api/avatar/presets', {
          headers: state.token ? { Authorization: 'Bearer ' + state.token } : {},
        }).then(x => x.json());
        const avatars = r?.avatars || {};
        const meta = r?.avatarMeta || {};
        const cats = r?.categories || [];
        const items = Object.keys(avatars)
          .filter(key => avatars[key])
          .map(key => ({
            key,
            url: avatars[key],
            name: meta[key]?.name || key,
            category: meta[key]?.category || 'general',
            gender: meta[key]?.gender || 'neutral',
          }));
        state.plaza.items = items;
        state.plaza.categoryMap = cats.reduce((m, c) => (m[c.id] = c.name, m), {});
        state.plaza.loaded = true;
        const sel = $('#dhPlazaCategory');
        if (sel && sel.options.length <= 1) {
          cats.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id; opt.textContent = c.name;

            sel.appendChild(opt);
          });
        }
      } catch (err) {
        grid.innerHTML = '<div class="dh-empty"><div class="dh-empty-icon">⚠️</div><div class="dh-empty-text">加载失败：' + escapeHtml(err.message || '网络错误') + '</div></div>';
        return;
      }
    }
    // 同步用户 AI 生成的形象到广场
    if (state.myAvatars.length === 0) {
      try {
        const ur = await api('/api/dh/my-avatars');
        state.myAvatars = ur?.data || [];
      } catch (e) { /* ignore */ }
    }
    _syncUserAvatarsToPlaza();
    renderPlaza();
  }

  function renderPlaza() {
    const grid = $('#dhPlazaGrid');
    const countEl = $('#dhPlazaCount');
    if (!grid) return;
    const cat = state.plaza.category, gen = state.plaza.gender;
    const list = state.plaza.items.filter(it => {
      if (gen && it.gender !== gen && it.gender !== 'neutral') return false;
      if (!cat) return true;
      if (cat === 'mine_video' || cat === 'mine_product') return it.category === cat;
      return !it._user && it.category === cat;
    });
    if (countEl) countEl.textContent = `共 ${list.length} 个`;
    if (!list.length) {
      grid.innerHTML = '<div class="dh-empty"><div class="dh-empty-icon">📭</div><div class="dh-empty-text">没有符合条件的形象</div></div>';
      return;
    }
    grid.innerHTML = list.map(it => {
      const genName = it.gender === 'female' ? '女' : it.gender === 'male' ? '男' : '';
      if (it._user) {
        const kindLabel = it.category === 'mine_product' ? '商品数字人素材' : '生成视频素材';
        const kindStyle = it.category === 'mine_product'
          ? 'background:rgba(33,255,243,.14);color:#21FFF3;border-color:rgba(33,255,243,.28)'
          : 'background:rgba(255,246,0,.15);color:#FFF600;border-color:rgba(255,246,0,.3)';
        return `<div class="dh-plaza-card" data-plaza-key="${escapeHtml(it.key)}">
          <div class="dh-plaza-img"><img src="${escapeHtml(it.url)}" alt="${escapeHtml(it.name)}" loading="lazy" decoding="async" onerror="this.style.opacity=0.3"></div>
          <div class="dh-plaza-body">
            <div class="dh-plaza-name">${escapeHtml(it.name)}</div>
            <div class="dh-plaza-tags">
              <span class="dh-plaza-tag" style="${kindStyle}">${kindLabel}</span>
              ${genName ? `<span class="dh-plaza-tag">${genName}</span>` : ''}
            </div>
            <button class="dh-btn dh-btn-primary dh-btn-sm dh-plaza-use" data-plaza-use="${escapeHtml(it.key)}">📌 使用此形象</button>
          </div>
        </div>`;
      }
      const catName = state.plaza.categoryMap?.[it.category] || it.category;
      return `<div class="dh-plaza-card" data-plaza-key="${escapeHtml(it.key)}">
        <div class="dh-plaza-img"><img src="${it.url}" alt="${escapeHtml(it.name)}" loading="lazy" decoding="async" onerror="this.parentNode.parentNode.style.display='none'"></div>
        <div class="dh-plaza-body">
          <div class="dh-plaza-name">${escapeHtml(it.name)}</div>
          <div class="dh-plaza-tags">
            <span class="dh-plaza-tag dh-plaza-tag-cyan">${escapeHtml(catName)}</span>
            ${genName ? `<span class="dh-plaza-tag">${genName}</span>` : ''}
          </div>
          <button class="dh-btn dh-btn-primary dh-btn-sm dh-plaza-use" data-plaza-use="${escapeHtml(it.key)}">📌 使用此形象</button>
        </div>
      </div>`;
    }).join('');
  }

  async function usePlazaAvatar(key) {
    const it = state.plaza.items.find(x => x.key === key);
    if (!it) return;
    const scene = await chooseAvatarUseScene(it);
    if (!scene) return;
    if (it._user) {
      // 用户 AI 生成的形象，直接用原始 avatar 数据
      state.selectedAvatar = it._avatarData;
    } else {
      state.selectedAvatar = {
        id: 'preset_' + it.key,
        name: it.name,
        image_url: it.url,
        photo_url: it.url,
        gender: it.gender,
        source: 'preset',
        avatar_type: 'normal',
      };
    }
    if (scene === 'space-guide' || scene === 'material-film' || scene === 'luxury-ad') {
      renderSelectedAvatar();
      if (scene === 'luxury-ad' || scene === 'material-film') {
        if (state.luxuryAd.segments?.length) state.luxuryAd.keyframes = [];
        renderLuxuryAdPerson();
        renderLuxuryAdStoryboard();
        updateLuxuryAdStepLocks();
      } else renderSpaceGuide();
      toast(`已选中「${it.name}」，用于${scene === 'luxury-ad' ? '剧情广告' : (scene === 'material-film' ? '素材审片' : '素材审片')}`, 'success');
      switchTab(scene);
    } else if (scene === 'product-dh') {
      const av = it._avatarData;
      if (!av || !(av.avatar_type === 'product' || av.type === 'product')) {
        toast('只有商品数字人素材可以用于商品数字人', 'error');
        return;
      }
      pdhSelectProductAvatar(av.id);
      toast(`已选中「${it.name}」，用于商品数字人`, 'success');
      switchTab('product-dh');
    } else {
      renderSelectedAvatar();
      toast(`已选中「${it.name}」，用于生成数字人`, 'success');
      switchTab('step3');
    }
  }

  function chooseAvatarUseScene(it) {
    return new Promise(resolve => {
      const old = document.getElementById('__dh_use_scene_mask');
      if (old) old.remove();
      const isProduct = it?._avatarData && (it._avatarData.avatar_type === 'product' || it._avatarData.type === 'product');
      const mask = document.createElement('div');
      mask.id = '__dh_use_scene_mask';
      mask.style.cssText = 'position:fixed;inset:0;z-index:19000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:24px';
      mask.innerHTML = `<div style="width:min(420px,92vw);background:#111318;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:18px;color:#fff;box-shadow:0 18px 60px rgba(0,0,0,.45)">
        <div style="font-weight:800;font-size:17px;margin-bottom:6px">使用「${escapeHtml(it?.name || '形象')}」到哪里？</div>
        <div style="font-size:12px;color:rgba(255,255,255,.62);margin-bottom:14px">选择一个数字人场景后会带着这个形象进入对应工作台。</div>
        <div style="display:grid;gap:10px">
          <button class="dh-btn dh-btn-primary" data-scene="step3" type="button">③ 生成数字人</button>
          <button class="dh-btn dh-btn-ghost" data-scene="material-film" type="button">📢 素材审片</button>
          <button class="dh-btn dh-btn-ghost" data-scene="luxury-ad" type="button">🎞️ 剧情广告</button>
          ${isProduct ? '<button class="dh-btn dh-btn-ghost" data-scene="product-dh" type="button">🛍️ 商品数字人</button>' : ''}
          <button class="dh-link-btn" data-scene="" type="button">取消</button>
        </div>
      </div>`;
      document.body.appendChild(mask);
      mask.addEventListener('click', e => {
        const btn = e.target.closest('[data-scene]');
        if (!btn && e.target !== mask) return;
        const val = btn ? btn.dataset.scene : '';
        mask.remove();
        resolve(val || '');
      });
    });
  }

  async function deleteAvatar(id) {
    const ok = await DhConfirm({
      title: '🗑 删除形象',
      message: '确定删除这个形象？',
      detail: '已生成的视频不会被删除',
      confirmText: '确认删除',
      type: 'danger',
    });
    if (!ok) return;
    try {
      const r = await api('/api/dh/my-avatars/' + id, { method: 'DELETE' });
      if (!r.success) throw new Error(r.error || '删除失败');
      if (state.selectedAvatar?.id === id) state.selectedAvatar = null;
      await loadMyAvatars();
      toast('已删除', 'success');
    } catch (err) {
      toast('删除失败：' + err.message, 'error');
    }
  }

  // ══════════════ Step 3 · 写稿 + 拆分 + 出片 ══════════════
  function renderSelectedAvatar() {
    const host = $('#dhSelectedAv');
    if (!host) return;
    const a = state.selectedAvatar;
    if (!a) {
      host.innerHTML = `<div class="dh-selected-empty">
        <div class="dh-empty-icon">👤</div>
        <div>尚未选择形象</div>
        <button class="dh-link-btn" data-tab-go="step2">去我的形象选一个 →</button>
      </div>`;
      return;
    }
    const img = a.image_url || a.photo_url || '';
    const video = a.sample_video_url || null;
    const media = video
      ? `<video src="${video}" autoplay muted loop playsinline preload="metadata" poster="${img || `/api/dh/my-avatars/${a.id}/thumbnail`}" onclick="this.paused?this.play():this.pause()" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<img src=&quot;${img || `/api/dh/my-avatars/${a.id}/thumbnail`}&quot;>')"></video>`
      : `<img src="${img}" alt="${escapeHtml(a.name)}">`;

    const badges = [];
    if (a.avatar_type === 'product' || a.type === 'product') badges.push('<span class="av-badge source">🛍️ 商品数字人</span>');
    if (video) badges.push('<span class="av-badge dynamic">🎬 动态</span>');
    if (a.gender === 'female') badges.push('<span class="av-badge">♀ 女</span>');
    else if (a.gender === 'male') badges.push('<span class="av-badge">♂ 男</span>');
    if (a.style) {
      const styleMap = { idol_warm: '偶像暖调', idol_cool: '偶像冷调', documentary: '写实', office: '职场', beach: '海边', studio_plain: '影棚' };
      badges.push(`<span class="av-badge">${styleMap[a.style] || a.style}</span>`);
    }
    if (a.source) badges.push(`<span class="av-badge source">${a.source === 'upload' ? '📤 上传' : '🎨 AI 生成'}</span>`);

    const created = a.created_at ? new Date(a.created_at).toLocaleString('zh-CN', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    const meta = created ? `<div class="av-meta">🕐 ${created}</div>` : '';

    host.innerHTML = `${media}
      <div class="av-name">${escapeHtml(a.name)}</div>
      <div class="av-badges">${badges.join('')}</div>
      ${meta}
      <button class="av-switch-btn" data-tab-go="step2">↻ 切换到其他形象</button>`;
    const isProduct = a.avatar_type === 'product' || a.type === 'product';
    if (isProduct) {
      state.s3.writeMode = 'product';
      state.s3.product = {
        ...(state.s3.product || {}),
        enabled: true,
        imageUrl: a.product?.image_url || a.product_image_url || '',
        preparedUrl: a.product?.prepared_url || a.product?.preparedUrl || a.product_cutout_url || a.product?.cutout_url || a.product?.image_url || a.product_image_url || '',
        cutoutUrl: a.product?.cutout_url || a.product?.cutoutUrl || a.product_cutout_url || '',
        imageName: a.product?.image_name || a.product_image_name || '',
        name: a.product?.name || '',
        selling_points: a.product?.selling_points || '',
        motion_style: a.product?.motion_style || 'hold',
      };
    } else {
      state.s3.product = { ...(state.s3.product || {}), enabled: false, imageUrl: '', preparedUrl: '', cutoutUrl: '', imageName: '', name: '', selling_points: '', motion_style: 'hold' };
    }
    setProductMode(isProduct);
    renderSpaceGuide();
  }

  // AI 写稿：点按钮先开弹窗，让用户写内容/要点；在弹窗里提交
  function openWriteModal() {
    const m = document.getElementById('dhWriteModal');
    if (!m) { toast('AI 写稿弹窗未就绪，请刷新页面', 'error'); return; }
    const input = document.getElementById('dhWriteInput');
    if (input) input.value = '';
    const mode = state.s3.writeMode === 'product' ? 'product' : 'script';
    if (!state.s3.writeEntry || state.s3.writeEntry === 'script' || state.s3.writeEntry === 'product') {
      state.s3.writeEntry = mode;
    }
    setWriteMode(mode);
    // 双保险：同时 add show class + 直接清掉 inline display:none
    m.classList.add('show');
    m.style.display = 'flex';
    m.style.removeProperty && m.style.removeProperty('visibility');
    setTimeout(() => input?.focus(), 80);
  }
  function openSpaceWriteModal() {
    const m = document.getElementById('dhWriteModal');
    if (!m) { toast('AI 写稿弹窗未就绪，请刷新页面', 'error'); return; }
    state.space.copyMode = 'ai';
    state.s3.writeEntry = 'space';
    renderSpaceCopyMode();
    setWriteMode('space');
    const input = document.getElementById('dhWriteInput');
    if (input) input.value = '';
    const duration = $('#dhWriteDuration');
    if (duration) duration.value = String(state.space.durationSec || 30);
    m.classList.add('show');
    m.style.display = 'flex';
    m.style.removeProperty && m.style.removeProperty('visibility');
    setTimeout(() => input?.focus(), 80);
  }
  function closeWriteModal() {
    const m = document.getElementById('dhWriteModal');
    if (!m) return;
    m.classList.remove('show');
    m.style.display = 'none';
  }

  function setWriteMode(mode) {
    state.s3.writeMode = mode === 'product' ? 'product' : mode === 'space' ? 'space' : 'script';
    const lockedEntry = state.s3.writeEntry || state.s3.writeMode || 'script';
    const modeTabs = $('#dhWriteModeTabs');
    if (modeTabs) modeTabs.style.display = lockedEntry === 'space' ? 'none' : '';
    $$('[data-write-mode]').forEach(b => {
      b.classList.toggle('active', b.dataset.writeMode === state.s3.writeMode);
      b.style.display = (lockedEntry === 'product' && b.dataset.writeMode !== 'product') || (lockedEntry === 'script' && b.dataset.writeMode === 'space') ? 'none' : '';
    });
    const isProduct = state.s3.writeMode === 'product';
    const isSpace = state.s3.writeMode === 'space';
    const fields = $('#dhProductWriteFields');
    if (fields) fields.style.display = isProduct ? '' : 'none';
    const presetRow = $('#dhWritePresetRow');
    if (presetRow) presetRow.style.display = isSpace ? 'none' : '';
    const label = $('#dhWriteTopicLabel');
    if (label) label.textContent = isProduct
      ? '商品场景 / 口播重点'
      : isSpace
        ? '素材审片信息（产品/场景/卖点/目标人群/优惠，越具体越好）'
        : '要写的内容 / 主题 / 要点（越具体写稿越精准）';
    const input = $('#dhWriteInput');
    if (input) input.placeholder = isProduct
      ? '例如：做一条 30 秒电商口播，开头抓住痛点，中间展示商品亮点，结尾引导下单。'
      : isSpace
        ? '例如：高端定制艺术墙，目标客户是别墅和高端门店业主，卖点是金属纹理、灯光层次、可定制尺寸，希望镜头先看整体空间，再推到材质细节，最后引导预约设计。'
      : '例如：介绍下我自己，我叫小明，从事电商行业 5 年，擅长直播带货。希望用亲切接地气的口吻，重点讲我的经验和爆品案例。';
    const style = $('#dhWriteStyle');
    if (style && (isProduct || isSpace)) style.value = 'promo';
    if (isProduct) setProductMode(true);
    renderProductMaterial();
  }

  function setProductMode(enabled) {
    state.s3.product = { ...(state.s3.product || {}), enabled: !!enabled };
    if (enabled) {
      state.s3.subtitle.show = true;
      const subOn = $('#dhS3SubtitleOn');
      if (subOn) subOn.checked = true;
    }
    $$('[data-product-mode]').forEach(b => b.classList.toggle('active', (b.dataset.productMode === 'product') === !!enabled));
    renderProductMaterial();
  }

  function productApiPayload(p) {
    if (!p || !p.enabled) return null;
    return {
      ...p,
      image_url: p.image_url || p.imageUrl || '',
      prepared_url: p.prepared_url || p.preparedUrl || p.cutoutUrl || p.imageUrl || '',
      cutout_url: p.cutout_url || p.cutoutUrl || '',
      image_name: p.image_name || p.imageName || '',
    };
  }

  function renderProductMaterial() {
    const p = state.s3.product || {};
    const selected = state.selectedAvatar || {};
    const selectedIsProduct = selected.avatar_type === 'product' || selected.type === 'product';
    p.enabled = selectedIsProduct;
    const panel = $('#dhProductPanel');
    if (panel) panel.style.display = selectedIsProduct ? '' : 'none';
    const adBtn = $('#dhProductAdBtn');
    if (adBtn) adBtn.style.display = selectedIsProduct ? 'inline-flex' : 'none';
    const pickBtn = $('#dhProductPickBtn');
    if (pickBtn) pickBtn.style.display = selectedIsProduct && !p.imageUrl ? '' : 'none';
    $$('[data-product-mode]').forEach(b => b.classList.toggle('active', (b.dataset.productMode === 'product') === !!p.enabled));
    const html = p.imageUrl
      ? `<img src="${escapeHtml(p.imageUrl)}" alt=""><div><div style="color:var(--dh-text);font-weight:700">${escapeHtml(p.imageName || p.name || '商品素材')}</div><div style="margin-top:3px">已随商品数字人形象融合，生成视频时不再作为浮层贴图</div></div>`
      : `<div class="dh-product-empty">该商品数字人缺少商品图，请回到形象生成阶段补充</div>`;
    const main = $('#dhProductPreview');
    if (main) main.innerHTML = html;
    if (panel) {
      panel.classList.toggle('has-product', !!p.imageUrl && !!p.enabled);
      panel.classList.toggle('disabled', !p.enabled);
    }
  }

  async function uploadProductImage(file) {
    if (!file) return;
    if (!file.type?.startsWith('image/')) return toast('请上传商品图片', 'error');
    const fd = new FormData();
    fd.append('image', file);
    const btns = ['#dhProductPickBtn', '#dhProductWritePickBtn'].map(s => $(s)).filter(Boolean);
    btns.forEach(b => { b.disabled = true; b.dataset.oldText = b.textContent; b.textContent = '上传中…'; });
    try {
      const contentHash = await sha256UploadFile(file);
      if (contentHash) {
        const cached = await apiWithTimeout(`/api/dh/assets/lookup?sha256=${encodeURIComponent(contentHash)}&role=product`, { method: 'GET' });
        const cachedUrl = cached?.imageUrl || cached?.url || cached?.asset?.url || '';
        if (cached?.success && cached.found && cachedUrl) {
          state.s3.product = {
            ...(state.s3.product || {}),
            enabled: true,
            imageUrl: cachedUrl,
            preparedUrl: cachedUrl,
            cutoutUrl: '',
            imageName: cached.asset?.name || file.name,
          };
          renderProductMaterial();
          toast('商品素材已从服务器缓存复用', 'success');
          return;
        }
        fd.append('sha256', contentHash);
      }
      const r = await fetch('/api/dh/products/upload', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + state.token },
        body: fd,
      });
      const data = await r.json();
      if (!data?.success) throw new Error(data?.error || '上传失败');
      state.s3.product = {
        ...(state.s3.product || {}),
        enabled: true,
        imageUrl: data.url,
        preparedUrl: data.preparedUrl || data.url,
        cutoutUrl: data.cutoutUrl || '',
        imageName: data.name || file.name,
      };
      renderProductMaterial();
      toast('商品素材已上传', 'success');
    } catch (err) {
      toast('商品上传失败：' + err.message, 'error');
    } finally {
      btns.forEach(b => { b.disabled = false; b.textContent = b.dataset.oldText || '上传商品'; });
      ['#dhProductFile', '#dhProductWriteFile'].forEach(s => { const input = $(s); if (input) input.value = ''; });
    }
  }

  function clearProductImage() {
    state.s3.product = { ...(state.s3.product || {}), imageUrl: '', preparedUrl: '', cutoutUrl: '', imageName: '' };
    renderProductMaterial();
  }

  function applyProductMotions(style) {
    const motionMap = {
      hold: ['holding the product near chest, presenting it clearly to camera', 'gently rotating the product to show details', 'pointing at product features while smiling'],
      point: ['pointing toward the product area with one hand', 'gesturing to highlight key product benefits', 'inviting viewers to look at the product'],
      compare: ['comparing before and after with both hands', 'gesturing left and right to compare two options', 'nodding confidently while summarizing the better choice'],
      demo: ['opening the product package naturally', 'demonstrating how to use the product with hands', 'showing the result to camera with a confident smile'],
    };
    const motions = motionMap[style] || motionMap.hold;
    const total = state.s3.segments?.length || 1;
    state.s3.segments = (state.s3.segments || []).map((seg, i) => ({
      ...seg,
      expression: i === 0 ? 'friendly' : (seg.expression || 'smile'),
      tone: i === 0 ? 'curious' : i === total - 1 ? 'encouraging' : (seg.tone || 'warm'),
      motion: motions[i % motions.length],
      camera: style === 'demo' ? 'close_up' : style === 'compare' ? 'pan_product' : (seg.camera || (i === 0 ? 'push_in' : 'static')),
    }));
  }

  function normalizeSpeechCopy(text) {
    return String(text || '')
      .replace(/\[[^\]]{1,80}\]/g, '')
      .replace(/（[^）]{1,80}）/g, '')
      .replace(/[·•●◆◇★☆]+/g, '，')
      .replace(/[…]{2,}|\.{3,}/g, '。')
      .replace(/[，,、]{2,}/g, '，')
      .replace(/[；;：:]+/g, '，')
      .replace(/[。.!！？?]{2,}/g, '。')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildProductSegmentsLocal(text, durationSec, motionStyle = 'hold') {
    const src = normalizeSpeechCopy(text);
    if (!src) return [];
    const target = Math.max(10, Math.min(60, Number(durationSec) || Math.ceil(src.length / 4) || 18));
    const pieces = src
      .split(/(?<=[。！？!?])\s*/)
      .map(s => s.trim())
      .filter(Boolean);
    const chunks = [];
    let buf = '';
    for (const p of pieces.length ? pieces : [src]) {
      if ((buf + p).length <= 44 || !buf) buf += p;
      else { chunks.push(buf); buf = p; }
    }
    if (buf) chunks.push(buf);
    while (chunks.length < 3 && chunks.some(s => s.length > 34)) {
      const idx = chunks.findIndex(s => s.length > 34);
      const s = chunks[idx];
      const mid = Math.ceil(s.length / 2);
      chunks.splice(idx, 1, s.slice(0, mid), s.slice(mid));
    }
    const list = chunks.slice(0, 6);
    const totalChars = list.reduce((n, s) => n + Math.max(1, s.length), 0);
    let cursor = 0;
    const motionMap = {
      hold: ['holding the product near chest, front side facing camera', 'gently rotating the product to reveal details', 'pointing at the product feature with index finger', 'presenting the product closer to camera with confident smile'],
      point: ['pointing at the product clearly', 'open-palm gesture explaining the benefit', 'pointing toward the camera for emphasis', 'inviting viewer attention with one hand'],
      compare: ['left-right comparison gesture', 'showing before and after with both hands', 'nodding while comparing product benefits', 'confident summary gesture'],
      demo: ['demonstrating product use with hands', 'close-up product handling', 'showing the usage result to camera', 'holding product steady for final call-to-action'],
    };
    const motions = motionMap[motionStyle] || motionMap.hold;
    const tones = ['curious', 'confident', 'encouraging', 'warm', 'urgent', 'encouraging'];
    const expressions = ['curious', 'confident', 'friendly', 'smile', 'excited', 'confident'];
    const cameras = ['push_in', 'close_up', 'pan_product', 'static', 'handheld', 'push_in'];
    return list.map((segText, i) => {
      const isLast = i === list.length - 1;
      const dur = isLast ? Math.max(3, target - cursor) : Math.max(3, Math.round(target * Math.max(1, segText.length) / totalChars));
      const start = cursor;
      const end = Math.min(target, start + dur);
      cursor = end;
      return {
        index: i,
        text: segText,
        start,
        end,
        duration: Math.max(1, end - start),
        expression: expressions[i] || 'friendly',
        tone: tones[i] || 'warm',
        motion: motions[i % motions.length],
        camera: cameras[i] || 'static',
      };
    });
  }

  async function submitWriteScript() {
    const topic = $('#dhWriteInput').value.trim();
    if (!topic) return toast('请输入要写的内容/主题', 'error');
    const duration_sec = parseInt($('#dhWriteDuration').value) || 30;
    state.s3.targetDurationSec = duration_sec;
    const style = $('#dhWriteStyle').value;
    const product = state.s3.writeMode === 'product' ? {
      name: $('#dhProductName')?.value.trim() || '',
      audience: $('#dhProductAudience')?.value.trim() || '',
      selling_points: $('#dhProductSellingPoints')?.value.trim() || '',
      offer: $('#dhProductOffer')?.value.trim() || '',
      motion_style: $('#dhProductMotionStyle')?.value || 'hold',
      image_url: state.s3.product?.imageUrl || '',
      image_name: state.s3.product?.imageName || '',
    } : null;
    if (state.s3.writeMode === 'product' && !product.name) return toast('请输入商品名称', 'error');
    state.s3.product = { ...(state.s3.product || {}), ...product };
    state.s3.productMotionStyle = product?.motion_style || '';
    const btn = $('#dhWriteSubmit');
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = '✍️ 写稿中…';
    try {
      const r = await api('/api/dh/scripts/write', {
        method: 'POST',
        body: { topic, duration_sec, style, mode: state.s3.writeMode, product },
      });
      if (!r.success) throw new Error(r.error || '写稿失败');
      if (state.s3.writeMode === 'space') {
        applySpaceGeneratedCopy({ text: r.text, durationSec: duration_sec, topic });
        closeWriteModal();
        try {
          await buildSpaceStoryboardFromText(r.text, duration_sec);
          toast(state.space.adMode === 'luxury'
            ? `✨ 已生成广告文案、镜头提示词和 ${state.space.segments.length} 个分镜`
            : `✨ 已生成广告文案、画面提示词和 ${state.space.speechSegments.length || state.space.segments.length} 段口播时间轴`,
            'success');
        } catch (segErr) {
          toast(`✨ 广告文案已显示，时间轴稍后可重试：${segErr.message}`, 'warning');
        }
        return;
      }
      if (state.s3.writeEntry === 'pdh-product') {
        const text = $('#pdhScriptText');
        if (text) text.value = r.text;
        updatePdhScriptMeta();
        closeWriteModal();
        pdh.segments = buildProductSegmentsLocal(r.text, duration_sec, product?.motion_style || 'hold');
        state.s3.segments = pdh.segments;
        pdh.targetDurationSec = Math.max(...pdh.segments.map(s => Number(s.end) || 0), duration_sec);
        renderPdhTimeline(pdh.segments);
        toast(`✨ 商品口播稿已生成 · ${r.char_count} 字，已自动拆成 ${pdh.segments.length} 段`, 'success');
        return;
      }
      $('#dhS3Text').value = r.text;
      updateS3Meta();
      closeWriteModal();
      toast(`✨ 写好了 ${r.char_count} 字 / 约 ${r.duration_sec} 秒 · 自动拆分中…`, 'success');
      await segmentScript(duration_sec);
      if (state.s3.writeMode === 'product') {
        applyProductMotions(product.motion_style);
        renderTimeline(state.s3.segments);
      }
    } catch (err) {
      toast('写稿失败：' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  async function segmentScript(durationOverride) {
    const text = $('#dhS3Text').value.trim();
    if (text.length < 10) return toast('台词太短', 'error');
    const target_duration_sec = Number(durationOverride || state.s3.targetDurationSec || Math.ceil(text.length / 4) || 30);
    $('#dhS3SegmentBtn').disabled = true;
    try {
      const r = await api('/api/dh/scripts/segment', {
        method: 'POST',
        body: { text, target_duration_sec },
      });
      if (!r.success) throw new Error(r.error || '拆分失败');
      state.s3.segments = r.segments;
      renderTimeline(r.segments);
      state.s3.targetDurationSec = r.total_duration || target_duration_sec;
      toast(`🧩 已拆成 ${r.segments.length} 段，总时长 ${r.total_duration}s`, 'success');
    } catch (err) {
      toast('拆分失败：' + err.message, 'error');
    } finally {
      $('#dhS3SegmentBtn').disabled = false;
    }
  }

  function renderTimeline(segments) {
    const host = $('#dhS3TimelineBody');
    if (!host) return;
    host.innerHTML = segments.map((s, i) => {
      const tone = s.tone || s.delivery || s.voice_tone || 'natural';
      const motion = s.motion || 'natural speaking';
      const expression = s.expression || 'natural';
      const camera = s.camera || 'static';
      const metaTitle = `expression: ${expression}\ntone: ${tone}\ncamera: ${camera}\nmotion: ${motion}`;
      return `<div class="dh-tl-row" data-seg-idx="${i}">
      <div class="dh-tl-time">${fmtTime(s.start)}-${fmtTime(s.end)}</div>
      <div class="dh-tl-text">${escapeHtml(s.text)}</div>
      <div class="dh-tl-motion" title="${escapeHtml(metaTitle)}">
        <span class="dh-tl-chip">表情 ${escapeHtml(presetLabel(EXPRESSION_PRESETS, expression))}</span>
        <span class="dh-tl-chip">语调 ${escapeHtml(presetLabel(TONE_PRESETS, tone))}</span>
        <span class="dh-tl-chip">镜头 ${escapeHtml(presetLabel(CAMERA_PRESETS, camera))}</span>
        <span class="dh-tl-motion-text">${escapeHtml(motion)}</span>
      </div>
      <button class="dh-tl-edit" data-edit-seg="${i}" title="编辑表情/语调/动作">✎</button>
    </div>`;
    }).join('');
    $('#dhS3Timeline').style.display = 'block';
  }

  // ══════════════ 时间轴动作编辑 ══════════════
  function openMotionEditor(idx) {
    state.s3.motionEditIdx = idx;
    const seg = state.s3.segments[idx];
    if (!seg) return;
    $$('.dh-tl-row').forEach(r => r.classList.toggle('editing', parseInt(r.dataset.segIdx) === idx));

    let pop = $('#dhMotionPopover');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'dhMotionPopover';
      pop.className = 'dh-motion-popover';
      document.body.appendChild(pop);
    }
    const activeId = ACTION_PRESETS.find(a => a.en === seg.motion)?.id;
    const segTone = seg.tone || seg.delivery || seg.voice_tone || 'natural';
    const segCamera = seg.camera || 'static';
    pop.innerHTML = `
      <div class="dh-motion-head dh-motion-drag">
        <div class="dh-motion-title">第 ${idx + 1} 段 · ${fmtTime(seg.start)}-${fmtTime(seg.end)}</div>
        <div class="dh-motion-desc">${escapeHtml(seg.text.slice(0, 54))}${seg.text.length > 54 ? '...' : ''}</div>
      </div>
      <div class="dh-motion-editor-grid">
        <section class="dh-motion-section">
          <div class="dh-motion-popover-title">语调（影响分段语音）</div>
          <div class="dh-motion-actions dh-motion-actions-compact">
            ${TONE_PRESETS.map(t => `<button class="dh-motion-action ${t.id === segTone ? 'active' : ''}" data-tone="${t.id}">${t.label}</button>`).join('')}
          </div>
          <input type="text" class="dh-input dh-motion-input" id="dhToneCustom" placeholder="可自定义中文语调，如：温柔但坚定" value="${escapeHtml(presetLabel(TONE_PRESETS, segTone))}">
        </section>
        <section class="dh-motion-section">
          <div class="dh-motion-popover-title">表情（写入视频提示词）</div>
          <div class="dh-motion-actions dh-motion-actions-compact">
            ${EXPRESSION_PRESETS.map(ex => `<button class="dh-motion-action ${ex.id === seg.expression ? 'active' : ''}" data-expression="${ex.id}">${ex.label}</button>`).join('')}
          </div>
        </section>
        <section class="dh-motion-section">
          <div class="dh-motion-popover-title">动作（写入视频提示词）</div>
          <div class="dh-motion-actions dh-motion-actions-compact">
            ${ACTION_PRESETS.map(a => `<button class="dh-motion-action ${a.id === activeId ? 'active' : ''}" data-motion-preset="${a.id}">${a.name}</button>`).join('')}
          </div>
          <input type="text" class="dh-input dh-motion-input" id="dhMotionCustom" placeholder="e.g. pointing at screen enthusiastically" value="${escapeHtml(seg.motion)}">
        </section>
        <section class="dh-motion-section">
          <div class="dh-motion-popover-title">镜头（写入视频提示词）</div>
          <div class="dh-motion-actions dh-motion-actions-compact">
            ${CAMERA_PRESETS.map(c => `<button class="dh-motion-action ${c.id === segCamera ? 'active' : ''}" data-camera="${c.id}">${c.label}</button>`).join('')}
          </div>
          <input type="text" class="dh-input dh-motion-input" id="dhCameraCustom" placeholder="可自定义镜头，如：慢慢推进到商品特写" value="${escapeHtml(presetLabel(CAMERA_PRESETS, segCamera))}">
        </section>
      </div>
      <div class="dh-motion-foot">
        <button class="dh-btn dh-btn-ghost dh-btn-sm" id="dhMotionCancel">取消</button>
        <button class="dh-btn dh-btn-primary dh-btn-sm" id="dhMotionSave">保存</button>
      </div>
    `;
    // 定位
    const row = $(`.dh-tl-row[data-seg-idx="${idx}"]`);
    if (row) {
      const r = row.getBoundingClientRect();
      pop.style.top = Math.max(8, Math.min(window.innerHeight - 520, r.bottom + 8)) + 'px';
      pop.style.left = Math.max(8, Math.min(window.innerWidth - 780, r.left)) + 'px';
    }
    pop.classList.add('show');
    bindMotionPopoverDrag(pop);
  }

  function bindMotionPopoverDrag(pop) {
    const handle = pop.querySelector('.dh-motion-drag');
    if (!handle || handle.dataset.dragBound) return;
    handle.dataset.dragBound = '1';
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const rect = pop.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      const origX = rect.left, origY = rect.top;
      handle.setPointerCapture?.(e.pointerId);
      const move = (ev) => {
        const x = Math.max(8, Math.min(window.innerWidth - rect.width - 8, origX + ev.clientX - startX));
        const y = Math.max(8, Math.min(window.innerHeight - rect.height - 8, origY + ev.clientY - startY));
        pop.style.left = x + 'px';
        pop.style.top = y + 'px';
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  function closeMotionEditor() {
    const pop = $('#dhMotionPopover');
    if (pop) pop.classList.remove('show');
    $$('.dh-tl-row').forEach(r => r.classList.remove('editing'));
    state.s3.motionEditIdx = -1;
  }

  function saveMotion() {
    const idx = state.s3.motionEditIdx;
    if (idx < 0) return;
    const pop = $('#dhMotionPopover');
    const custom = $('#dhMotionCustom').value.trim();
    const toneCustom = $('#dhToneCustom')?.value.trim();
    const exprBtn = pop.querySelector('[data-expression].active');
    const toneBtn = pop.querySelector('[data-tone].active');
    const motionBtn = pop.querySelector('[data-motion-preset].active');
    const cameraBtn = pop.querySelector('[data-camera].active');
    const cameraCustom = $('#dhCameraCustom')?.value.trim();
    const seg = state.s3.segments[idx];
    if (!seg) return;
    if (motionBtn) {
      const preset = ACTION_PRESETS.find(a => a.id === motionBtn.dataset.motionPreset);
      if (preset) seg.motion = preset.en;
    }
    if (custom) seg.motion = custom;
    if (toneBtn) seg.tone = toneBtn.dataset.tone;
    if (toneCustom && (!toneBtn || toneCustom !== presetLabel(TONE_PRESETS, toneBtn.dataset.tone))) seg.tone = toneCustom;
    if (exprBtn) seg.expression = exprBtn.dataset.expression;
    if (cameraBtn) seg.camera = cameraBtn.dataset.camera;
    if (cameraCustom && (!cameraBtn || cameraCustom !== presetLabel(CAMERA_PRESETS, cameraBtn.dataset.camera))) seg.camera = cameraCustom;
    if (state.activeTab === 'product-dh') {
      pdh.segments = state.s3.segments || [];
      renderPdhTimeline(pdh.segments);
    } else {
      renderTimeline(state.s3.segments);
    }
    closeMotionEditor();
    toast('已更新', 'success');
  }
  function fmtTime(s) { const m = Math.floor(s / 60), x = s % 60; return m ? `${m}:${String(x).padStart(2, '0')}` : `${x}s`; }

  function updateS3Meta() {
    const t = $('#dhS3Text').value;
    $('#dhS3Count').textContent = t.length;
    $('#dhS3Dur').textContent = Math.ceil(t.length / 4);
  }

  // ══════════════ 音色列表 ══════════════
  async function loadVoicesIfNeeded() {
    if (state.voicesLoaded) return;
    try {
      const r = await fetch('/api/avatar/voice-list?_t=' + Date.now(), {
        headers: { 'Authorization': 'Bearer ' + state.token, 'Cache-Control': 'no-cache' },
      });
      const j = await r.json();
      if (!j?.success) throw new Error('加载音色失败');
      state.voices = j.voices || [];
      state.voicesLoaded = true;
      renderVoices();
    } catch (err) {
      console.warn('loadVoices', err);
    }
  }

  // 精确性别识别（防火山/讯飞/阿里返回性别不准时混入错误分组）
  function _inferGender(v) {
    const rawGender = String(v.gender || '').trim().toLowerCase();
    const n = `${v.name || ''} ${v.id || ''} ${v.provider || ''}`;
    if (/^(female|male|child|neutral|auto)$/.test(rawGender)) return rawGender;
    if (/child|kid|童|儿童|小宝|longhua/i.test(n)) return 'child';
    const maleWord = /(^|[^a-z])male([^a-z]|$)/i;
    const maleStrong = /boy|男|男声|男性|磁性|沉稳|成熟|稳重|少年|青年|大叔|先生|许久|哲|锤锤|博睿|奥特|Kazi|Douji|Jam|Luodo|longcheng|longshu|longxiaocheng|longxiang|longyuan|longanyang|longhua|aisjiuxu|aisfzh|x4_yeting|x4_xiaoguo|x4_pengfei|zh_male/i;
    const femaleWord = /(^|[^a-z])female([^a-z]|$)/i;
    const femaleStrong = /girl|女|女声|女性|甜美|温柔|知性|清亮|萌妹|温婉|小萍|晶儿|雯雯|小乔|小溪|小馨|甜心|娇憨|御姐|淑女|客服|longxiaochun|longxiaoxia|longwan|loongbella|loongstella|zh_female/i;
    if (maleWord.test(n) || maleStrong.test(n)) return 'male';
    // 女性强关键词（覆盖讯飞/火山的常见女声命名）
    if (femaleWord.test(n) || femaleStrong.test(n)) return 'female';
    if (rawGender && rawGender !== 'neutral' && rawGender !== 'auto') return rawGender;
    return 'neutral';
  }
  function _genderLabel(g) { return ({ female: '♀ 女', male: '♂ 男', child: '🧒 童', neutral: '🎙️', auto: '⚡' })[g] || '🎙️'; }

  function luxuryVoiceDirection() {
    const id = state.luxuryAd.voiceDirection || 'story_dynamic';
    return LUXURY_VOICE_DIRECTIONS.find(x => x.id === id) || LUXURY_VOICE_DIRECTIONS[0];
  }

  function luxuryVoicePreviewText() {
    const dir = luxuryVoiceDirection();
    const segments = Array.isArray(state.luxuryAd.segments) ? state.luxuryAd.segments : [];
    const scripted = segments
      .map(seg => luxuryShotNarrationText(seg) || seg.voiceover || seg.text || '')
      .filter(Boolean)
      .slice(0, 2)
      .join('。');
    return (scripted && scripted.length >= 12 ? scripted : dir.preview).slice(0, 90);
  }

  function luxuryVoiceRecommendationContext() {
    const dir = luxuryVoiceDirection();
    const text = [
      state.luxuryAd.content,
      state.luxuryAd.briefText,
      state.luxuryAd.briefInfo?.title,
      state.luxuryAd.briefInfo?.product,
      state.luxuryAd.briefInfo?.audience,
      state.luxuryAd.briefInfo?.tone,
      ...(Array.isArray(state.luxuryAd.segments) ? state.luxuryAd.segments.flatMap(seg => [
        seg.title,
        seg.story_stage,
        seg.emotion,
        seg.mood,
        seg.objective,
        seg.voiceover,
        seg.narration,
        seg.dialogue,
        seg.text,
      ]) : []),
    ].filter(Boolean).join(' ');
    const lower = text.toLowerCase();
    let profile = dir.id || 'story_dynamic';
    if (/高端|信任|专业|企业|b2b|品牌|稳重|权威|premium|corporate|trust/i.test(lower)) profile = 'premium_trust';
    else if (/焦虑|痛点|卡住|压力|担心|释然|relief|anxious/i.test(lower)) profile = 'anxious_relief';
    else if (/新品|种草|转化|促销|活动|立刻|马上|增长|excited|sales/i.test(lower)) profile = 'excited_sales';
    else if (/开心|轻松|生活|温暖|亲和|服务|happy|warm|bright/i.test(lower)) profile = 'happy_bright';
    const labelMap = {
      premium_trust: '高端信任',
      anxious_relief: '焦虑到释然',
      excited_sales: '兴奋种草',
      happy_bright: '开心轻快',
      story_dynamic: '剧情起伏',
    };
    return { profile, label: labelMap[profile] || dir.label || '剧情起伏', text: lower };
  }

  function luxuryVoiceKeywordScore(v = {}, ctx = luxuryVoiceRecommendationContext()) {
    const name = `${v.name || ''} ${v.id || ''} ${v.provider || ''}`.toLowerCase();
    const gender = v._gender || _inferGender(v);
    let score = 0;
    if (v.isCloned) score += 4;
    if (gender === 'child') score -= 20;
    if (/test|demo|试听|测试/i.test(name)) score -= 8;
    const has = re => re.test(name);
    if (ctx.profile === 'premium_trust') {
      if (gender === 'male') score += 8;
      if (gender === 'neutral') score += 3;
      if (has(/沉稳|成熟|稳重|磁性|低沉|专业|新闻|商务|男|male|deep|calm|trust|narrator/)) score += 12;
      if (has(/甜美|萌|童|可爱|cute|child/)) score -= 8;
    } else if (ctx.profile === 'anxious_relief') {
      if (gender === 'female' || gender === 'male') score += 4;
      if (has(/自然|真实|温柔|知性|稳|叙事|旁白|calm|natural|story|narrator/)) score += 10;
      if (has(/激情|兴奋|喊麦|童|cute/)) score -= 5;
    } else if (ctx.profile === 'excited_sales') {
      if (has(/活力|元气|清亮|年轻|热情|兴奋|促销|女|男|bright|energetic|sales|happy/)) score += 12;
      if (gender === 'female') score += 4;
      if (has(/低沉|严肃|新闻|沉稳/)) score -= 4;
    } else if (ctx.profile === 'happy_bright') {
      if (gender === 'female') score += 6;
      if (has(/温柔|甜美|亲和|清亮|开心|轻快|自然|warm|bright|happy|soft/)) score += 12;
      if (has(/低沉|严肃|威严|新闻/)) score -= 6;
    } else {
      if (has(/自然|旁白|叙事|知性|沉稳|温柔|natural|story|narrator|calm/)) score += 10;
      if (gender === 'neutral') score += 2;
    }
    return score;
  }

  function recommendedLuxuryVoice() {
    const ctx = luxuryVoiceRecommendationContext();
    const voices = (state.voices || [])
      .filter(v => v?.id && !state.badVoices.has(v.id))
      .map(v => {
        v._gender = _inferGender(v);
        return v;
      });
    if (!voices.length) return null;
    const ranked = voices
      .map(v => ({ voice: v, score: luxuryVoiceKeywordScore(v, ctx) }))
      .sort((a, b) => b.score - a.score);
    const picked = ranked[0]?.voice || voices[0];
    return picked ? { voice: picked, ctx, score: ranked[0]?.score || 0 } : null;
  }

  function renderLuxuryVoiceDirection() {
    const host = $('#dhLuxAdVoiceDirection');
    if (!host) return;
    const current = luxuryVoiceDirection();
    host.innerHTML = `<small>配音方向</small>
      <div class="dh-luxgen-voice-chips">
        ${LUXURY_VOICE_DIRECTIONS.map(item => `<button type="button" class="dh-luxgen-voice-chip ${item.id === current.id ? 'active' : ''}" data-lux-voice-direction="${escapeHtml(item.id)}">${escapeHtml(item.label)}</button>`).join('')}
      </div>
      <p>${escapeHtml(current.desc)} 试听会使用当前广告台词或该方向示例。</p>`;
  }

  function renderVoices() {
    const host = $('#dhVoiceList');
    if (!host) return;
    const q = ($('#dhVoiceSearch')?.value || '').trim().toLowerCase();
    const filtered = state.voices.filter(v => {
      if (state.badVoices.has(v.id)) return false;
      if (!q) return true;
      const hay = (v.name + ' ' + (v.provider || '') + ' ' + (v.gender || '')).toLowerCase();
      return hay.includes(q);
    });
    $('#dhVoiceCount').textContent = filtered.length > 1 ? `· ${filtered.length} 个可选` : '';

    // 修正每个音色的 gender
    filtered.forEach(v => { v._gender = _inferGender(v); });

    // 按性别分组（女/男/童/中性），克隆音色单独顶部
    const clones = filtered.filter(v => v.isCloned);
    const others = filtered.filter(v => !v.isCloned);
    const byGender = { female: [], male: [], child: [], neutral: [] };
    for (const v of others) {
      const g = v._gender || 'neutral';
      (byGender[g] || byGender.neutral).push(v);
    }
    const groupLabel = { female: '👩 女声', male: '👨 男声', child: '🧒 童声', neutral: '🎙️ 其他' };
    const genderIcon = g => ({ female: '👩', male: '👨', child: '🧒', auto: '⚡' }[g] || '🎙️');
    const voiceCard = v => `<div class="dh-voice-opt ${v.isCloned ? 'cloned' : ''} ${v.id === state.s3.voiceId ? 'selected' : ''}" data-voice-id="${escapeHtml(v.id)}">
      <div class="dh-voice-opt-icon">${v.providerIcon || genderIcon(v._gender || v.gender)}</div>
      <div class="dh-voice-opt-body">
        <div class="dh-voice-opt-name">${escapeHtml(v.name)} <span style="font-size:10px;color:var(--dh-text-muted)">${_genderLabel(v._gender || v.gender)}</span></div>
        <div class="dh-voice-opt-sub">${v.isCloned ? '我的声音' : '系统音色'}</div>
      </div>
      ${v.id ? `<button class="dh-voice-opt-preview" data-voice-preview="${escapeHtml(v.id)}" title="试听">▶</button>` : ''}
    </div>`;

    let html = '';
    // 始终显示"我的克隆"分组（即使 0 个也给用户一个去克隆的入口）
    if (clones.length) {
      html += `<div class="dh-voice-group"><div class="dh-voice-group-title">我的声音（${clones.length}）</div>${clones.map(voiceCard).join('')}</div>`;
    } else {
      html += `<div class="dh-voice-group"><div class="dh-voice-group-title">我的声音（0）</div>
        <div class="dh-voice-opt cloned" data-tab-go="voice-clone" style="cursor:pointer">
          <div class="dh-voice-opt-icon">＋</div>
          <div class="dh-voice-opt-body">
            <div class="dh-voice-opt-name">＋ 去克隆我的声音</div>
            <div class="dh-voice-opt-sub">上传 30-180 秒录音 · 生成后自动出现在这里</div>
          </div>
        </div>
      </div>`;
    }
    for (const g of ['female', 'male', 'child', 'neutral']) {
      const voices = byGender[g] || [];
      if (!voices.length) continue;
      html += `<div class="dh-voice-group"><div class="dh-voice-group-title">${groupLabel[g]}（${voices.length}）</div>${voices.map(voiceCard).join('')}</div>`;
    }
    host.innerHTML = html || `<div class="dh-empty" style="padding:20px"><div class="dh-empty-text">无匹配音色</div></div>`;
  }

  function selectVoice(voiceId) {
    // 区分 null（未选）/ ''（选了「自动」）/ 'xxx'（选了具体音色）
    state.s3.voiceId = (voiceId === undefined || voiceId === null) ? null : String(voiceId);
    renderVoices();
  }

  async function previewVoice(voiceId, previewText = '') {
    if (!voiceId) return;
    stopAudibleMedia({ reset: true });
    const voice = (state.voices || []).find(v => String(v.id || '') === String(voiceId)) || {};
    const providerId = String(voice.providerId || voice.provider_id || voice.provider || '').toLowerCase();
    const isTopviewVoice = providerId.includes('topview');
    const demoUrl = voice.demoAudioUrl || voice.demo_audio_url || voice.preview_url || voice.previewUrl || voice.sample_url || '';
    const useExpressivePreview = !!previewText;
    const btn = document.querySelector(`[data-voice-preview="${CSS.escape(String(voiceId))}"]`);
    const oldText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '...';
      btn.classList.add('loading');
    }
    toast('正在准备试听...');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), useExpressivePreview ? 90000 : 30000);
    try {
      let audio;
      let objectUrl = '';
      if (demoUrl) {
        audio = ensurePreviewAudio();
        audio.src = demoUrl;
      } else {
        const r = await fetch('/api/dh/tts/preview-voice', {
          method: 'POST',
          signal: ac.signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
          body: JSON.stringify({
            voice_id: voiceId,
            voiceId,
            text: previewText || '你好，这是 VIDO 数字人配音试听。先听这一句的自然开场，再听中段的情绪推进，最后用更有感染力的语气收住。',
            segments: useExpressivePreview ? compactLuxurySegments(state.luxuryAd.segments || []) : [],
            voice_direction: useExpressivePreview ? (state.luxuryAd.voiceDirection || 'story_dynamic') : '',
            gender: voice._gender || voice.gender || '',
            providerId: voice.providerId || voice.provider_id || '',
            provider: voice.provider || '',
          }),
        });
        if (!r.ok) {
          let detail = '';
          try { detail = (await r.json())?.error || ''; } catch {}
          throw new Error(detail || ('HTTP ' + r.status));
        }
        const blob = await r.blob();
        if (!/^audio\//i.test(blob.type || '') || blob.size < 2048) {
          let detail = '';
          try { detail = await blob.text(); } catch {}
          throw new Error(detail || '试听音频为空或格式不可播放');
        }
        objectUrl = URL.createObjectURL(blob);
        audio = ensurePreviewAudio();
        audio.src = objectUrl;
      }
      if (objectUrl) audio.addEventListener('ended', () => URL.revokeObjectURL(objectUrl), { once: true });
      audio.muted = false;
      audio.volume = 1;
      audio.currentTime = 0;
      try { audio.load(); } catch {}
      markDetachedAudio(audio);
      await audio.play();
    } catch (err) {
      const rawMsg = String(err.message || '');
      const transient = err.name === 'AbortError'
        || /timeout|timed out|network|fetch|aborted|超时|网络/i.test(rawMsg);
      if (!isTopviewVoice && !transient) {
        state.badVoices.add(voiceId);
        localStorage.setItem('dh_bad_voices', JSON.stringify([...state.badVoices]));
        if (state.s3.voiceId === voiceId) state.s3.voiceId = null;
        if (state.luxuryAd.voiceId === voiceId) state.luxuryAd.voiceId = '';
        if (state.space.voiceId === voiceId) state.space.voiceId = '';
        renderVoices();
        renderLuxuryAdVoice();
        renderSpaceVoiceOptions();
        updateLuxuryAdStepLocks();
        saveLuxuryAdDraft({ silent: true }).catch(() => {});
      }
      const providerName = voice.provider || voice.providerId || voice.provider_id || '当前 TTS 供应商';
      const expired = /token|access.?key|api.?key|unauthori[sz]ed|鉴权|认证|过期|expired|401|403/i.test(rawMsg);
      const msg = err.name === 'AbortError'
        ? (useExpressivePreview ? '整稿试听仍在合成中，生产环境可能需要 1 分钟以上；音色已保留，可稍后重试或直接合成' : '超时')
        : isTopviewVoice
          ? '暂未返回可试听音频，但该音色仍可用于生成视频'
          : expired
            ? `${providerName} Token/API Key 已过期或无效，已临时移除该音色；请到 AI 配置更新后再用。`
            : rawMsg;
      toast('试听失败：' + msg, 'error');
    } finally {
      clearTimeout(timer);
      if (btn) {
        btn.disabled = false;
        btn.textContent = oldText || '▶';
        btn.classList.remove('loading');
      }
    }
  }

  function getSelectedAvatarPreviewUrl() {
    const a = state.selectedAvatar || {};
    return a.sample_video_url || a.video_url || a.image_url || (a.id ? `/api/dh/my-avatars/${a.id}/thumbnail` : '');
  }

  function renderProgressPreview(stageName, sub, elapsed, meta = {}) {
    const pct = getTaskProgressPercent({ ...meta, elapsed });
    const remain = elapsed != null ? Math.max(1, Math.ceil((180 - Math.min(170, elapsed)) / 60)) : 4;
    return `<div class="dh-progress-clean">
      <div class="dh-progress-clean-title">${escapeHtml(stageName || '生成中')}</div>
      <div class="dh-progress-ring" style="--p:${pct}">
        <span>${pct}%</span>
      </div>
      <div class="dh-progress-clean-sub">${escapeHtml(sub || '')} · 预计约 ${remain} 分钟</div>
    </div>`;
  }

  function getTaskProgressPercent(task = {}) {
    if (task.status === 'draft' || task.status === 'working') return Math.max(1, Math.min(99, Number(task.progress || 1)));
    if (task.status === 'done' || task.stage === 'done') return 100;
    if (task.status === 'error' || task.status === 'invalid' || task.status === 'timeout') return Math.max(1, Number(task.progress || 1));
    const stageBase = {
      submitted: 8, preparing: 12, prepare_image: 14, prepare_audio: 18,
      detecting: 22, submitting: 28, polling: 35, running: 42,
      storyboard: 18, keyframes: 36, guide_keyframe: 34, guide_video: 58,
      video: 64, post_effects: 88,
    };
    const stage = task.stage || task.status || 'submitted';
    const base = stageBase[stage] ?? 10;
    const elapsed = Number(task.elapsed || (task.startedAt ? Math.round((Date.now() - task.startedAt) / 1000) : 0));
    const timeBoost = Math.min(22, Math.floor(elapsed / 10));
    const explicit = Number(task.progress);
    const estimated = base + timeBoost;
    return Math.max(6, Math.min(96, Math.max(Number.isFinite(explicit) ? explicit : 0, estimated)));
  }

  function getTaskPollTimeoutMs(taskType = '') {
    const type = String(taskType || '').toLowerCase();
    if (type === 'product_ad') return 25 * 60 * 1000;
    if (type === 'digital_ad' || type === 'space_guide' || type === 'luxury_ad') return 30 * 60 * 1000;
    return 12 * 60 * 1000;
  }

  function renderTaskPercentBlock(task = {}) {
    const pct = getTaskProgressPercent(task);
    const label = task.status === 'draft' || task.status === 'working' ? getTaskStatusText(task.status) : '&#29983;&#25104;&#20013;';
    return `<div class="dh-task-percent">
      <div class="dh-task-percent-ring" style="--p:${pct}"><span>${pct}%</span></div>
      <div class="dh-task-percent-label">${label}</div>
    </div>`;
  }

  function taskCoverInitial(task = {}) {
    const title = String(task.avatarName || task.title || getTaskTypeLabel(getTaskType(task)) || 'VIDO').trim();
    const hit = title.match(/[A-Za-z0-9]/);
    return (hit ? hit[0] : title.slice(0, 1) || 'V').toUpperCase();
  }

  function taskCoverText(task = {}) {
    const type = getTaskType(task);
    if (type === 'luxury_ad') return '剧情广告片';
    if (type === 'material_film') return '素材审片';
    if (type === 'product_ad') return '商品口播';
    return getTaskTypeLabel(type) || '视频任务';
  }

  function renderTaskCoverFallback(task = {}) {
    return `<div class="dh-task-cover-fallback" aria-hidden="true">
      <b>${escapeHtml(taskCoverInitial(task))}</b>
      <span>${escapeHtml(taskCoverText(task))}</span>
      <small>${escapeHtml(getTaskStatusText(task.status))}</small>
    </div>`;
  }

  function renderTaskImageCover(task = {}, posterUrl = '', ratioClass = '', attrs = '') {
    return `<div class="dh-task-thumb dh-task-thumb-done dh-task-thumb-cover${posterUrl ? '' : ' is-missing'}${ratioClass}" ${attrs}>
      ${posterUrl ? `<img class="dh-task-thumb-video" src="${escapeHtml(posterUrl)}" loading="lazy" decoding="async" alt="${escapeHtml(taskCoverText(task))}" onerror="window.__dhTaskCoverFallback&&window.__dhTaskCoverFallback(this)">` : ''}
      ${renderTaskCoverFallback(task)}
    </div>`;
  }

  function renderTaskVideoCover(task = {}, videoUrl = '', posterUrl = '', ratioClass = '') {
    if (!videoUrl) return renderTaskImageCover(task, posterUrl, ratioClass);
    return `<div class="dh-task-thumb dh-task-thumb-done dh-task-thumb-cover${ratioClass}" data-task-preview="${escapeHtml(task.taskId)}" title="&#28857;&#20987;&#25918;&#22823;&#39044;&#35272;">
      <video class="dh-task-thumb-video" src="${escapeHtml(videoUrl)}" ${posterUrl ? `poster="${escapeHtml(posterUrl)}"` : ''} muted playsinline preload="metadata" onerror="window.__dhTaskCoverFallback&&window.__dhTaskCoverFallback(this)"></video>
      ${renderTaskCoverFallback(task)}
      <span class="dh-task-thumb-play">&#9654;</span>
    </div>`;
  }

  function taskDetailValue(v) {
    return v !== undefined && v !== null && String(v).trim() ? String(v).trim() : '';
  }

  function taskDetailItems(items) {
    const rows = (items || []).filter(([, v]) => taskDetailValue(v));
    if (!rows.length) return '';
    return `<div class="dh-task-detail-grid">${rows.map(([k, v]) => `<div class="dh-task-detail-row">
      <div class="dh-task-detail-key">${escapeHtml(k)}</div>
      <div class="dh-task-detail-value">${escapeHtml(v)}</div>
    </div>`).join('')}</div>`;
  }

  function taskSegmentLabel(seg = {}, idx = 0) {
    const start = seg.start ?? seg.startTime ?? 0;
    const end = seg.end ?? seg.endTime ?? '';
    const tone = seg.tone || seg.delivery || seg.voice_tone || '';
    const expression = seg.expression || '';
    const motion = seg.motion || '';
    const camera = seg.camera || '';
    const action = seg.action || seg.visual_action || '';
    const emotion = seg.emotion || seg.mood || '';
    const objective = seg.objective || seg.purpose || '';
    const toneLabel = displayMotionLabel(tone) || presetLabel(TONE_PRESETS, tone);
    const expressionLabel = displayMotionLabel(expression) || presetLabel(EXPRESSION_PRESETS, expression);
    const cameraLabel = displayMotionLabel(camera) || presetLabel(CAMERA_PRESETS, camera);
    const motionLabel = displayMotionLabel(motion);
    const meta = [
      tone && toneLabel ? `语调 ${toneLabel}` : '',
      expression && expressionLabel ? `表情 ${expressionLabel}` : '',
      camera && cameraLabel ? `镜头 ${cameraLabel}` : '',
      motion && motionLabel ? `动作 ${motionLabel}` : '',
      action ? `行为 ${action}` : '',
      emotion ? `情绪 ${emotion}` : '',
      objective ? `目的 ${objective}` : '',
    ].filter(Boolean).join(' · ');
    return { index: idx + 1, time: `${fmtTime(start)}-${fmtTime(end)}`, text: seg.text || seg.voiceover || '', meta };
  }

  function renderTaskSegments(segments = []) {
    const list = Array.isArray(segments) ? segments.filter(s => s && (s.text || s.voiceover)) : [];
    if (!list.length) return `<div class="dh-task-empty-note">这条任务没有保存分段数据；新提交的任务会自动记录切割、语调、动作和镜头。</div>`;
    return `<div class="dh-task-segment-list">${list.map((seg, i) => {
      const item = taskSegmentLabel(seg, i);
      return `<div class="dh-task-segment-row">
        <div class="dh-task-segment-time">${escapeHtml(item.time)}</div>
        <div class="dh-task-segment-main">
          <div class="dh-task-segment-text">${escapeHtml(item.text)}</div>
          ${item.meta ? `<div class="dh-task-segment-meta">${escapeHtml(item.meta)}</div>` : ''}
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  function renderTaskStoryboards(scenes = [], keyframes = [], clips = []) {
    const sceneList = Array.isArray(scenes) ? scenes : [];
    const frameList = Array.isArray(keyframes) ? keyframes : [];
    const clipList = Array.isArray(clips) ? clips : [];
    const max = Math.max(sceneList.length, frameList.length, clipList.length);
    if (!max) return `<div class="dh-task-empty-note">暂无分镜记录；新的广告任务会在生成中持续写入每个镜头。</div>`;
    return `<div class="dh-task-segment-list dh-task-storyboard-list">${Array.from({ length: max }, (_, i) => {
      const sc = sceneList[i] || {};
      const kf = frameList[i] || {};
      const clip = clipList[i] || {};
      const title = sc.title || kf.title || `镜头 ${i + 1}`;
      const roleRaw = sc.role || kf.role || '';
      const role = roleRaw ? luxuryShotRoleName(roleRaw) : '';
      const voice = sc.voiceover || kf.voiceover || sc.text || '';
      const visual = displayChineseText(sc.visual, sc.scene_content, sc.content_prompt, sc.display_visual, kf.visual, kf.scene_content, kf.content_prompt, kf.display_visual);
      const action = displayChineseText(sc.action, sc.visual_action, kf.action, kf.visual_action);
      const emotion = displayChineseText(sc.emotion, sc.mood, kf.emotion, kf.mood);
      const audio = displayChineseText(sc.sfx_audio, sc.audio, kf.sfx_audio, kf.audio);
      const motion = displayChineseText(sc.camera_label, sc.transition, kf.camera_label, kf.transition) || displayMotionLabel(sc.camera || sc.motion || kf.camera || kf.motion || '');
      const img = kf.image_url || sc.image_url || '';
      const clipUrl = typeof clip === 'string' ? clip : (clip.video_url || clip.videoUrl || clip.url || '');
      return `<div class="dh-task-segment-row dh-task-storyboard-row">
        <div class="dh-task-segment-time">${String(i + 1).padStart(2, '0')}</div>
        <div class="dh-task-segment-main">
          <div class="dh-task-segment-text">${escapeHtml(title)}${role ? ` · ${escapeHtml(role)}` : ''}</div>
          ${img ? `<img src="${escapeHtml(withAuthQuery(img))}" alt="${escapeHtml(title)}" style="width:120px;max-height:80px;object-fit:cover;border-radius:6px;margin:8px 0;border:1px solid var(--dh-border)">` : ''}
          ${clipUrl ? `<video src="${escapeHtml(withAuthQuery(clipUrl))}" controls playsinline preload="metadata" style="width:160px;max-height:100px;object-fit:cover;border-radius:6px;margin:8px 0;border:1px solid var(--dh-border)"></video>` : ''}
          ${voice ? `<div class="dh-task-segment-meta">口播：${escapeHtml(voice)}</div>` : ''}
          ${visual ? `<div class="dh-task-segment-meta">画面：${escapeHtml(visual)}</div>` : ''}
          ${action ? `<div class="dh-task-segment-meta">动作：${escapeHtml(action)}</div>` : ''}
          ${emotion ? `<div class="dh-task-segment-meta">情绪：${escapeHtml(emotion)}</div>` : ''}
          ${motion ? `<div class="dh-task-segment-meta">镜头：${escapeHtml(motion)}</div>` : ''}
          ${audio ? `<div class="dh-task-segment-meta">声音：${escapeHtml(audio)}</div>` : ''}
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  function renderTaskDetailPanel(data = {}) {
    const detail = data.createDetail || {};
    const type = getTaskType(data);
    const isLuxury = type === 'luxury_ad';
    const project = data.project || {};
    const projectDraft = project.draft || {};
    const snapshot = data.snapshot || {};
    const segments = detail.segments || data.segments || snapshot.segments || project.scenes || projectDraft.scenes || data.retryPayload?.segments || [];
    const scenes = detail.scenes || data.scenes || snapshot.scenes || project.scenes || projectDraft.scenes || [];
    const keyframes = detail.keyframes || data.keyframes || snapshot.keyframes || project.keyframes || projectDraft.keyframes || [];
    const clips = detail.clips || data.clips || snapshot.clips || data.clip_urls || snapshot.clip_urls || project.clips || project.clip_urls || [];
    const subtitle = detail.subtitle || data.subtitle || project.subtitle || projectDraft.subtitle || data.retryPayload?.subtitle || null;
    const bgm = detail.bgmAsset || data.bgmAsset || project.bgm_asset || projectDraft.bgm_asset || data.retryPayload?.bgm_asset || null;
    const person = detail.personAsset || project.person_asset || projectDraft.person_asset || data.retryPayload?.person_asset || null;
    const product = detail.productAsset || project.product_asset || projectDraft.product_asset || data.retryPayload?.product_asset || null;
    const materialAssets = detail.materialAssets || data.material_assets || data.retryPayload?.material_assets || project.reference_assets || projectDraft.reference_assets || [];
    const basics = taskDetailItems([
      ['任务类型', detail.adMode || getTaskTypeLabel(type)],
      ['标题', detail.title || data.avatarName || project.title || project.brief_info?.title || ''],
      ['生成时长', (detail.durationSec || project.duration_sec) ? `${detail.durationSec || project.duration_sec}s` : ''],
      ['形象', detail.avatarName || person?.name || person?.actor_asset_id || ''],
      ['背景/产品图', detail.backgroundName || detail.productName || product?.name || project.brief_info?.product || ''],
      ['配音', detail.voiceName || detail.voiceId || '自动/未指定'],
      ['BGM', bgm ? `${bgm.name || bgm.original_name || bgm.matched_mood || '已配置'}${bgm.volume ? ` · 音量 ${Math.round(Number(bgm.volume) * 100)}%` : ''}` : ''],
      ['广告风格', detail.adStyle || ''],
      ['镜头数量', (detail.shotCount || scenes.length || keyframes.length) ? `${detail.shotCount || scenes.length || keyframes.length} 镜头` : ''],
      ['素材数量', Array.isArray(materialAssets) && materialAssets.length ? `${materialAssets.length} 个素材` : ''],
      ['字幕', subtitle ? (subtitle.show === false ? '关闭' : `${subtitle.style || 'popup'} · ${subtitle.fontSize || 60}px`) : ''],
    ]);
    const script = taskDetailValue(detail.text || project.text || project.brief_text || data.textPreview || '');
    const prompts = taskDetailItems([
      ['镜头提示词', detail.scenePrompt || ''],
      ['镜头顺序', detail.cameraPrompt || ''],
      ['商品/场景', detail.productName || detail.backgroundName || ''],
      ['配音字幕', detail.composeNote || ''],
      ['生成流程', detail.workflow || ''],
    ]);
    const sectionLabels = isLuxury ? {
      copy: '广告需求',
      segments: '剧本',
      storyboard: '分镜',
      prompts: '配音 / 字幕 / 合成',
    } : {
      copy: '文案',
      segments: '切割与效果',
      storyboard: '分镜与关键帧',
      prompts: '镜头/生成描述',
    };
    return `<div class="dh-task-create-panel">
      <div class="dh-task-create-head">
        <div>
          <div class="dh-task-create-eyebrow">创建界面回看</div>
          <div class="dh-task-create-title">${escapeHtml(detail.title || data.avatarName || getTaskTypeLabel(type))}</div>
        </div>
        <div class="dh-task-create-pill">${escapeHtml(getTaskTypeLabel(type))}</div>
      </div>
      <div class="dh-task-create-layout">
        <section class="dh-task-create-section">
          <div class="dh-task-detail-title">基础配置</div>
          ${basics || '<div class="dh-task-empty-note">暂无基础配置记录</div>'}
        </section>
        <section class="dh-task-create-section">
          <div class="dh-task-detail-title">${sectionLabels.copy}</div>
          <div class="dh-task-script-box">${escapeHtml(script || '暂无文案记录')}</div>
        </section>
        <section class="dh-task-create-section dh-task-create-section-wide">
          <div class="dh-task-detail-title">${sectionLabels.segments}</div>
          ${renderTaskSegments(segments)}
        </section>
        <section class="dh-task-create-section dh-task-create-section-wide">
          <div class="dh-task-detail-title">${sectionLabels.storyboard}</div>
          ${renderTaskStoryboards(scenes, keyframes, clips)}
        </section>
        <section class="dh-task-create-section dh-task-create-section-wide">
          <div class="dh-task-detail-title">${sectionLabels.prompts}</div>
          ${prompts || '<div class="dh-task-empty-note">暂无镜头提示词记录</div>'}
        </section>
      </div>
    </div>`;
  }

  function resetSpaceGuideFormForNext({ quiet = false } = {}) {
    state.space.bgImageUrl = '';
    if (state.space.bgPreviewUrl && state.space.bgPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(state.space.bgPreviewUrl);
    (state.space.referenceImages || []).forEach(img => {
      if (img?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(img.previewUrl);
    });
    state.space.bgPreviewUrl = '';
    state.space.bgImageName = '';
    state.space.bgUploading = false;
    state.space.referenceImages = [];
    state.space.scenePrompt = '';
    state.space.cameraPrompt = '';
    state.space.segments = [];
    state.space.speechSegments = [];
    state.space.visualSegments = [];
    state.space.keyframes = [];
    state.space.strictKeyframeId = '';
    state.space.copyMode = 'manual';
    state.space.adMode = isLuxuryAdModule() ? 'luxury' : 'standard';
    state.space.adStyle = 'luxury_soft';
    state.space.shotCount = 6;
    ['#dhSpaceTitle', '#dhSpaceText', '#dhSpaceScenePrompt', '#dhSpaceCameraPrompt'].forEach(sel => {
      const el = $(sel);
      if (el) el.value = '';
    });
    const preview = $('#dhSpacePreview');
    if (preview && !quiet) preview.innerHTML = '<div class="dh-space-preview-empty"><b>&#24050;&#25552;&#20132;&#21040;&#20219;&#21153;&#20013;&#24515;</b><span>&#34920;&#21333;&#24050;&#28165;&#31354;&#65292;&#21487;&#20197;&#32487;&#32493;&#21019;&#24314;&#19979;&#19968;&#20010;&#24191;&#21578;&#25968;&#23383;&#20154;&#12290;</span></div>';
    renderSpaceGuide();
    renderSpaceCopyMode();
  }

  function resetLuxuryAdFormForNext({ quiet = false } = {}) {
    const revoke = asset => {
      const url = asset?.previewUrl || '';
      if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
    };
    revoke(state.luxuryAd.productAsset);
    revoke(state.luxuryAd.personAsset);
    (state.luxuryAd.refAssets || state.luxuryAd.assets || []).forEach(revoke);
    state.luxuryAd.currentStep = 1;
    state.luxuryAd.content = '';
    state.luxuryAd.adType = 'auto';
    state.luxuryAd.durationSec = 30;
    state.luxuryAd.outputRatio = '9:16';
    state.luxuryAd.outputSize = 'standard';
    state.luxuryAd.subtitle = true;
    state.luxuryAd.autoEnhance = true;
    state.luxuryAd.expandBrief = true;
    state.luxuryAd.voiceId = '';
    state.luxuryAd.productAsset = null;
    state.luxuryAd.personAsset = null;
    state.luxuryAd.personGenerationError = null;
    state.luxuryAd.personSpec = {
      castMode: 'auto',
      gender: 'auto',
      age: 'match_brief',
      origin: 'east_asian_cn',
    };
    state.luxuryAd.briefInfo = null;
    (state.luxuryAd.briefRefAssets || []).forEach(revoke);
    state.luxuryAd.refAssets = [];
    state.luxuryAd.assets = [];
    state.luxuryAd.briefRefAssets = [];
    state.luxuryAd.visualReferenceBrief = null;
    state.luxuryAd.assetManifest = null;
    state.luxuryAd.visualLocks = null;
    state.luxuryAd.globalVisualBible = null;
    state.luxuryAd.briefUploading = false;
    state.luxuryAd.bgmAsset = null;
    state.luxuryAd.uploading = false;
    state.luxuryAd.pendingShotUploadIndex = null;
    state.luxuryAd.sceneGenerating = false;
    state.luxuryAd.scriptGenerating = false;
    state.luxuryAd.keyframeGenerating = false;
    state.luxuryAd.keyframeProgress = null;
    state.luxuryAd.workflowProgress = null;
    state.luxuryAd.usageRows = [];
    state.luxuryAd.usageSummary = null;
    state.luxuryAd.usageByStep = {};
    state.luxuryAd.usageTaskRows = [];
    state.luxuryAd.usageTaskSummary = null;
    state.luxuryAd.usageRequestKeys = {};
    state.luxuryAd.productionContract = null;
    state.luxuryAd.productionProjectId = '';
    state.luxuryAd.productionProject = null;
    state.luxuryAd.storyboardDetailed = false;
    state.luxuryAd.segments = [];
    state.luxuryAd.keyframes = [];
    state.luxuryAd.taskId = '';
    state.luxuryAd.taskUrl = '';
    ['#dhLuxAdText'].forEach(sel => {
      const el = $(sel);
      if (el) el.value = '';
    });
    renderLuxuryAd();
    if (!quiet) toast('已清空剧情广告表单，可以重新创建', 'success');
  }
  const DH_TASK_STORE_KEY = 'dh_video_tasks_v1';
  const ACTIVE_TASK_STATUSES = new Set(['submitted', 'running', 'polling', 'preparing']);

  function readVideoTasks() {
    try {
      const list = JSON.parse(localStorage.getItem(DH_TASK_STORE_KEY) || '[]');
      return Array.isArray(list) ? list.filter(t => t && t.taskId) : [];
    } catch {
      return [];
    }
  }

  function writeVideoTasks(list) {
    const trimmed = (Array.isArray(list) ? list : [])
      .filter(t => t && t.taskId)
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
      .slice(0, 50);
    localStorage.setItem(DH_TASK_STORE_KEY, JSON.stringify(trimmed));
    renderTaskCenter();
  }

  function upsertVideoTask(task) {
    const list = readVideoTasks();
    const idx = list.findIndex(t => String(t.taskId) === String(task.taskId));
    const next = {
      ...(idx >= 0 ? list[idx] : {}),
      ...task,
      updatedAt: Date.now(),
    };
    if (idx >= 0) list[idx] = next;
    else list.unshift(next);
    writeVideoTasks(list);
    return next;
  }

  function removeStoredVideoTask(taskId) {
    writeVideoTasks(readVideoTasks().filter(t => String(t.taskId) !== String(taskId)));
  }

  function getTaskStatusText(status) {
    return {
      submitted: '已提交',
      running: '生成中',
      polling: '生成中',
      preparing: '准备中',
      done: '已完成',
      error: '失败',
      invalid: '已失效',
      timeout: '超时',
      draft: '草稿',
      working: '待继续',
      ready: '待合成',
      failed: '需处理',
    }[status] || '等待中';
  }

  function getTaskStageText(stage, task = null) {
    const isLuxury = task ? getTaskType(task) === 'luxury_ad' : false;
    return {
      prepare_image: '准备形象',
      prepare_audio: '准备语音',
      detecting: '主体检测',
      submitting: '提交渲染',
      submitted: '等待调度',
      polling: '第三方渲染',
      running: '视频生成',
      storyboard: isLuxury ? '生成剧本' : '生成分镜',
      keyframes: isLuxury ? '生成分镜' : '生成关键帧',
      draft: '制作进度已保存',
      script_reviewing: '剧本待继续编辑',
      frame_generating: '真实关键帧生成中',
      frame_reviewing: '分镜待继续编辑',
      frame_ready: '关键帧已就绪',
      video_generating: '成片生成中',
      video_ready: '成片已就绪',
      video: '图生视频',
      post_effects: '字幕/特效合成',
      done: '成品保存',
    }[stage] || '后台处理中';
  }

  function updateTaskBadge() {
    const badge = $('#dhTaskCount');
    if (!badge) return;
    const active = readVideoTasks().filter(t => ACTIVE_TASK_STATUSES.has(t.status)).length;
    badge.textContent = String(active);
    badge.style.display = active ? 'inline-flex' : 'none';
  }

  function getTaskType(task) {
    const adMode = String(task?.ad_mode || task?.adMode || task?.retryPayload?.ad_mode || task?.createDetail?.adMode || '').toLowerCase();
    const generationMode = String(task?.generation_mode || task?.generationMode || task?.retryPayload?.generation_mode || '').toLowerCase();
    const title = String(task?.title || task?.avatarName || task?.createDetail?.title || '').toLowerCase();
    if (task?.taskType === 'luxury_ad' || adMode === 'luxury_ad' || generationMode.includes('luxury') || title.includes('剧情广告')) return 'luxury_ad';
    if (task?.taskType === 'material_film' || adMode === 'material_film' || generationMode.includes('material_film') || title.includes('素材成片') || title.includes('素材审片')) return 'material_film';
    if (task?.taskType === 'product_ad') return 'product_ad';
    if (task?.taskType === 'digital_ad' || task?.taskType === 'space_guide') return 'digital_ad';
    return 'digital_human';
  }

  function normalizeTaskTextKey(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  function luxuryTaskProjectId(task = {}) {
    return String(
      task.projectId ||
      task.project?.id ||
      task.production_project_id ||
      task.productionProjectId ||
      task.retryPayload?.production_project_id ||
      task.retryPayload?.project_id ||
      task.createDetail?.productionProjectId ||
      '',
    ).trim();
  }

  function luxuryTaskTextKey(task = {}) {
    return normalizeTaskTextKey(
      task.project?.text ||
      task.retryPayload?.text ||
      task.createDetail?.text ||
      task.text ||
      task.textPreview ||
      '',
    );
  }

  function taskCenterDedupeKey(task = {}) {
    const type = getTaskType(task);
    if (type !== 'luxury_ad') return `${type}:${task.taskId || ''}`;
    const projectId = luxuryTaskProjectId(task);
    if (projectId) return `luxury-project:${projectId}`;
    const textKey = luxuryTaskTextKey(task);
    if (textKey) return `luxury-text:${textKey}`;
    return `luxury-task:${task.taskId || ''}`;
  }

  function mergeLuxuryTaskGroup(items = []) {
    const list = items.filter(Boolean);
    if (list.length <= 1) return list[0] || null;
    const projectTask = list.find(t => t.isLuxuryProjectDraft);
    const activeTask = list.find(t => ACTIVE_TASK_STATUSES.has(t.status));
    const doneTask = list.find(t => t.status === 'done' && (t.videoUrl || t.video_url));
    const newest = list.slice().sort((a, b) => (b.startedAt || b.updatedAt || 0) - (a.startedAt || a.updatedAt || 0))[0];
    const primary = activeTask || doneTask || projectTask || newest;
    return {
      ...(projectTask || {}),
      ...(primary || {}),
      project: projectTask?.project || primary?.project || null,
      projectId: projectTask?.projectId || luxuryTaskProjectId(primary) || '',
      isLuxuryProjectDraft: !!projectTask && !activeTask && !doneTask,
      taskId: activeTask?.taskId || doneTask?.taskId || projectTask?.taskId || primary?.taskId,
      startedAt: Math.max(...list.map(t => Number(t.startedAt || t.updatedAt || 0) || 0)),
    };
  }

  function taskCenterVisibleTasks(rawTasks = []) {
    const groups = new Map();
    (Array.isArray(rawTasks) ? rawTasks : []).filter(Boolean).forEach(task => {
      const key = taskCenterDedupeKey(task);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    });
    return Array.from(groups.values()).map(group => {
      const first = group[0] || {};
      return getTaskType(first) === 'luxury_ad' ? mergeLuxuryTaskGroup(group) : first;
    }).filter(Boolean);
  }

  function getTaskTypeLabel(type) {
    return {
      digital_human: '数字人',
      product_ad: '商品口播视频',
      material_film: '素材审片',
      digital_ad: '空间导览',
      luxury_ad: '剧情广告',
    }[type] || '数字人';
  }

  const warmedVideoUrls = new Set();
  function warmVideoPreviews(urls = []) {
    (urls || []).filter(Boolean).slice(0, 2).forEach(raw => {
      const url = String(raw || '');
      if (!url || warmedVideoUrls.has(url)) return;
      warmedVideoUrls.add(url);
      try {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        v.playsInline = true;
        v.src = url + (url.includes('#') ? '' : '#t=0.1');
        v.load();
      } catch {}
    });
  }

  // 视频放大预览 modal — 任务中心 / 作品库共用
  function openVideoPreviewModal(videoUrl, title) {
    stopAudibleMedia({ reset: true });
    let modal = document.getElementById('dhVideoPreviewModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'dhVideoPreviewModal';
      modal.className = 'dh-video-modal';
      modal.innerHTML = `
        <div class="dh-video-modal-backdrop" data-modal-close></div>
        <div class="dh-video-modal-card">
          <div class="dh-video-modal-head">
            <span class="dh-video-modal-title"></span>
            <button class="dh-video-modal-close" data-modal-close type="button" title="关闭">×</button>
          </div>
          <video class="dh-video-modal-video" controls playsinline></video>
          <div class="dh-video-modal-actions">
            <a class="dh-btn dh-btn-ghost dh-btn-sm dh-video-modal-download" download>下载</a>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => {
        if (e.target.closest('[data-modal-close]')) closeVideoPreviewModal();
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.classList.contains('open')) closeVideoPreviewModal();
      });
    }
    modal.querySelector('.dh-video-modal-title').textContent = title || '预览';
    const v = modal.querySelector('.dh-video-modal-video');
    v.preload = 'auto';
    if (v.dataset.src !== videoUrl) {
      v.src = videoUrl;
      v.dataset.src = videoUrl;
      try { v.currentTime = 0; } catch {}
    }
    modal.querySelector('.dh-video-modal-download').href = withAuthQuery(videoUrl);
    modal.classList.add('open');
    setTimeout(() => {
      stopAudibleMedia({ keep: v, reset: true });
      v.play().catch(() => {});
    }, 50);
  }
  function closeVideoPreviewModal() {
    const modal = document.getElementById('dhVideoPreviewModal');
    if (!modal) return;
    const v = modal.querySelector('.dh-video-modal-video');
    if (v) v.pause();
    modal.classList.remove('open');
  }

  function openImagePreviewModal(imageUrl, title) {
    if (!imageUrl) return;
    stopAudibleMedia({ reset: false });
    let modal = document.getElementById('dhImagePreviewModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'dhImagePreviewModal';
      modal.className = 'dh-video-modal dh-image-modal';
      modal.innerHTML = `
        <div class="dh-video-modal-backdrop" data-modal-close></div>
        <div class="dh-video-modal-card dh-image-modal-card">
          <div class="dh-video-modal-head">
            <span class="dh-video-modal-title"></span>
            <button class="dh-video-modal-close" data-modal-close type="button" title="关闭">×</button>
          </div>
          <img class="dh-image-modal-img" alt="镜头预览">
          <div class="dh-video-modal-actions">
            <a class="dh-btn dh-btn-ghost dh-btn-sm dh-image-modal-open" target="_blank" rel="noopener">打开原图</a>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => {
        if (e.target.closest('[data-modal-close]')) modal.classList.remove('open');
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.classList.contains('open')) modal.classList.remove('open');
      });
    }
    const url = withAuthQuery(imageUrl);
    modal.querySelector('.dh-video-modal-title').textContent = title || '镜头预览';
    modal.querySelector('.dh-image-modal-img').src = url;
    modal.querySelector('.dh-image-modal-open').href = url;
    modal.classList.add('open');
  }

  function luxuryFailedKeyframeCandidates(details = null) {
    const rawAttempts = [
      details?.attempts,
      details?.details?.attempts,
      details?.raw?.attempts,
      details?.raw?.details?.attempts,
      details?.raw?.details?.details?.attempts,
      details?.candidate_images,
      details?.details?.candidate_images,
      details?.raw?.details?.candidate_images,
    ].find(Array.isArray) || [];
    const seen = new Set();
    return rawAttempts
      .filter(a => a && a.ok !== true && (a.image_url || a.imageUrl || a.url || a.candidate_url))
      .map((a, i) => {
        const url = a.image_url || a.imageUrl || a.url || a.candidate_url || '';
        const shotIndex = Number.isFinite(Number(a.shot_index)) ? Number(a.shot_index) : 0;
        return {
          ...a,
          _candidateIndex: i,
          _shotIndex: Math.max(0, shotIndex),
          _url: url,
          _label: [a.provider_id || a.provider, a.model_id || a.model].filter(Boolean).join('/') || '图片模型',
          _reason: String(a.candidate_label || a.qa?.reason || a.error || '视觉 QA 未通过').slice(0, 260),
          _review: luxuryCandidateManualReviewState(a),
        };
      })
      .filter(a => {
        const key = `${a._shotIndex}|${a._url}`;
        if (!a._url || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function luxuryCandidateQaScore(candidate = {}) {
    const qa = candidate.qa || candidate.vision_qa || candidate.quality_qa || {};
    const direct = Number(qa.score ?? qa.overall_score ?? qa.match_score ?? candidate.score ?? candidate.qa_score);
    if (Number.isFinite(direct)) return Math.max(0, Math.min(100, direct));
    const dims = qa.quality_dimensions || candidate.quality_dimensions || {};
    const values = Object.values(dims).map(Number).filter(Number.isFinite);
    if (values.length) return Math.round(values.reduce((sum, n) => sum + n, 0) / values.length);
    return 0;
  }

  function luxuryCandidateManualReviewState(candidate = {}) {
    const qa = candidate.qa || candidate.vision_qa || candidate.quality_qa || {};
    const score = luxuryCandidateQaScore(candidate);
    const hardMismatch = [
      qa.subject_match,
      qa.storyboard_match,
      qa.product_match,
      qa.identity_match,
      qa.character_match,
    ].some(v => v === false);
    const explicitReject = qa.explicit_reject === true || qa.reject === true || candidate.explicit_reject === true;
    const minScore = 70;
    const adoptable = false;
    const reason = hardMismatch || explicitReject
      ? `QA ${score || '未评分'}，存在硬性错配，只能预览`
      : `失败候选图未通过正式 QA，只能预览诊断，不能保留到镜头`;
    return { score, minScore, adoptable, reason, hardMismatch, explicitReject };
  }

  function openLuxuryFailedCandidatesModal() {
    const candidates = luxuryFailedKeyframeCandidates(state.luxuryAd.keyframeErrorDetails);
    if (!candidates.length) {
      toast('当前错误里没有可查看的失败候选图', 'error');
      return;
    }
    stopAudibleMedia({ reset: false });
    let modal = document.getElementById('dhLuxFailedCandidateModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'dhLuxFailedCandidateModal';
      modal.className = 'dh-video-modal dh-lux-failed-modal';
      modal.innerHTML = `
        <div class="dh-video-modal-backdrop" data-modal-close></div>
        <div class="dh-video-modal-card dh-lux-failed-modal-card">
          <div class="dh-video-modal-head">
            <span class="dh-video-modal-title">失败候选图</span>
            <button class="dh-video-modal-close" data-modal-close type="button" title="关闭">×</button>
          </div>
          <div class="dh-lux-failed-modal-body"></div>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => {
        if (e.target.closest('[data-modal-close]')) modal.classList.remove('open');
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.classList.contains('open')) modal.classList.remove('open');
      });
    }
    const body = modal.querySelector('.dh-lux-failed-modal-body');
    body.innerHTML = candidates.map((item, i) => `
      <article class="dh-lux-failed-candidate">
        <button type="button" class="dh-lux-failed-candidate-img" data-lux-failed-preview="${i}" title="预览候选图">
          <img src="${escapeHtml(withAuthQuery(item._url))}" alt="失败候选图 ${i + 1}">
        </button>
        <div>
          <b>镜头 ${item._shotIndex + 1} · ${escapeHtml(item._label)}</b>
          <em>${escapeHtml(item._review.reason)}</em>
          <span>${escapeHtml(item._reason)}</span>
          <small>${escapeHtml(item.fallback_mode || item.prompt_mode || 'QA rejected candidate')}</small>
          <div class="dh-lux-failed-candidate-actions">
            <button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-lux-failed-preview="${i}">预览</button>
            ${item._review.adoptable
              ? `<button type="button" class="dh-btn dh-btn-primary dh-btn-sm" data-lux-adopt-failed="${i}">保留到第 ${item._shotIndex + 1} 镜</button>`
              : `<button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" disabled title="${escapeHtml(item._review.reason)}">不可保留</button>`}
          </div>
        </div>
      </article>`).join('');
    modal.classList.add('open');
  }

  async function adoptLuxuryFailedCandidate(candidateIndex) {
    const candidates = luxuryFailedKeyframeCandidates(state.luxuryAd.keyframeErrorDetails);
    const item = candidates[Number(candidateIndex)];
    if (!item?._url) return;
    if (!item._review?.adoptable) {
      toast(item._review?.reason || '失败候选图未通过正式 QA，不能保留到分镜', 'error');
      return;
    }
    const idx = Math.max(0, Number(item._shotIndex || 0));
    const seg = (state.luxuryAd.segments || [])[idx] || {};
    const keyframes = Array.isArray(state.luxuryAd.keyframes) ? state.luxuryAd.keyframes.slice() : [];
    while (keyframes.length <= idx) keyframes.push({});
    keyframes[idx] = {
      ...keyframes[idx],
      title: keyframes[idx]?.title || seg.title || `镜头 ${idx + 1}`,
      image_url: item._url,
      imageUrl: item._url,
      adopted_failed_candidate: true,
      adopted_from_qa_failure: true,
      adopted_model: item._label,
      qa: item.qa || null,
    };
    state.luxuryAd.keyframes = keyframes;
    renderLuxuryAd();
    document.getElementById('dhLuxFailedCandidateModal')?.classList.remove('open');
    toast(`已保留到第 ${idx + 1} 镜，可继续后续分镜或单镜重试`, 'success');
    // 中文说明：当前关键帧失败候选图默认禁止保留；此分支只兼容未来显式授权的审片流程。
    await saveLuxuryAdDraft({ silent: true, projectState: 'frame_reviewing' }).catch(() => null);
  }

  // 任务进度弹窗 —— 替代原本"查看进度"跳回 step3 的行为
  function openTaskProgressModal(taskId) {
    stopAudibleMedia({ reset: false });
    let modal = document.getElementById('dhTaskProgressModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'dhTaskProgressModal';
      modal.className = 'dh-video-modal';
      modal.innerHTML = `
        <div class="dh-video-modal-backdrop" data-modal-close></div>
        <div class="dh-video-modal-card dh-task-detail-modal-card">
          <div class="dh-video-modal-head">
            <span class="dh-video-modal-title">任务进度</span>
            <button class="dh-video-modal-close" data-modal-close type="button" title="关闭">×</button>
          </div>
          <div class="dh-task-progress-modal-body"></div>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => {
        if (e.target.closest('[data-modal-close]')) closeTaskProgressModal();
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.classList.contains('open')) closeTaskProgressModal();
      });
    }
    modal.dataset.taskId = taskId;
    modal.classList.add('open');
    refreshTaskProgressModal();
  }
  function findTaskCenterTask(taskId) {
    const id = String(taskId || '');
    const projectTasks = (state.luxuryAdProjects || []).map(luxuryAdProjectToTask);
    return state.s3.runningTasks.get(id)
      || readVideoTasks().find(x => String(x.taskId) === id)
      || projectTasks.find(x => String(x.taskId) === id || String(x.projectId) === id)
      || null;
  }
  function closeTaskProgressModal() {
    const modal = document.getElementById('dhTaskProgressModal');
    if (!modal) return;
    delete modal.dataset.taskId;
    modal.classList.remove('open');
  }
  // 由 pollVideoTask 在每个 tick 后调用，让弹窗内容跟着任务状态更新
  function refreshTaskProgressModal() {
    const modal = document.getElementById('dhTaskProgressModal');
    if (!modal || !modal.classList.contains('open')) return;
    const taskId = modal.dataset.taskId;
    if (!taskId) return;
    const data = findTaskCenterTask(taskId);
    const body = modal.querySelector('.dh-task-progress-modal-body');
    const title = modal.querySelector('.dh-video-modal-title');
    if (title) title.textContent = '任务详情';
    if (!body) return;
    if (!data) {
      body.innerHTML = `<div class="dh-render-stage"><div class="dh-render-stage-name">&#20219;&#21153;&#24050;&#19981;&#23384;&#22312;</div></div>`;
      return;
    }
    const elapsed = data.elapsed || Math.round((Date.now() - (data.startedAt || Date.now())) / 1000);
    const detailPanel = renderTaskDetailPanel(data);
    if (data.videoUrl || data.video_url) {
      const url = data.videoUrl || data.video_url;
      if (body.dataset.doneVideoUrl === url) {
        warmVideoPreviews([url]);
        return;
      }
      body.dataset.doneVideoUrl = url;
      body.innerHTML = `<div class="dh-render-stage">
        <div class="dh-render-stage-name">&#10003; &#29983;&#25104;&#23436;&#25104; · ${escapeHtml(data.avatarName || '')}</div>
        <div class="dh-render-stage-sub">&#24050;&#33258;&#21160;&#20445;&#23384;&#21040;&#20316;&#21697;&#24211;</div>
      </div>
      ${detailPanel}
      <div class="dh-task-detail-preview">
        <video class="dh-task-detail-preview-video" src="${escapeHtml(url)}" controls playsinline preload="auto"></video>
        <div class="dh-video-modal-actions">
          <button class="dh-btn dh-btn-primary dh-btn-sm" data-task-preview="${escapeHtml(data.taskId || taskId)}">放大预览</button>
          <a class="dh-btn dh-btn-ghost dh-btn-sm" href="${escapeHtml(withAuthQuery(url))}" download>下载</a>
        </div>
      </div>`;
      warmVideoPreviews([url]);
      return;
    }
    delete body.dataset.doneVideoUrl;
    if (data.status === 'error' || data.status === 'invalid' || data.status === 'timeout') {
      body.innerHTML = `<div class="dh-render-stage">
        <div class="dh-render-stage-name" style="color:var(--dh-error)">&#10005; ${escapeHtml(getTaskStatusText(data.status))}</div>
        <div class="dh-render-stage-sub">${escapeHtml(data.error || '')}</div>
      </div>
      ${detailPanel}
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="dh-btn dh-btn-primary dh-btn-sm" data-task-retry="${escapeHtml(data.taskId)}">&#8635; &#37325;&#26032;&#25552;&#20132;</button>
        <button class="dh-btn dh-btn-ghost dh-btn-sm" data-task-remove="${escapeHtml(data.taskId)}">&#31227;&#38500;&#20219;&#21153;</button>
      </div>`;
      return;
    }
    body.innerHTML = `<div class="dh-task-detail-head">
      <div>
        <div class="dh-task-detail-status">${escapeHtml(getTaskStatusText(data.status))}</div>
        <div class="dh-task-detail-stage">${escapeHtml(getTaskStageText(data.stage, data))} · &#24050;&#29992; ${escapeHtml(String(elapsed))}s</div>
      </div>
      <div class="dh-task-detail-percent">${getTaskProgressPercent(data)}%</div>
    </div>
    ${renderProgressPreview(getTaskStageText(data.stage, data), `${escapeHtml(data.avatarName || '\u5f53\u524d\u4efb\u52a1')}`, elapsed, data)}
    ${detailPanel}`;
  }
  function renderTaskCenter() {
    const host = $('#dhTaskList');
    if (!host) { updateTaskBadge(); return; }
    if (state.activeTaskType === 'luxury_ad') refreshLuxuryAdProjectsForTaskCenter({ silent: true });
    const projectTasks = state.activeTaskType === 'luxury_ad'
      ? (state.luxuryAdProjects || []).map(luxuryAdProjectToTask)
      : [];
    const tasks = taskCenterVisibleTasks([...readVideoTasks(), ...projectTasks]);
    $$('#dhTaskTypeTabs [data-task-type]').forEach(btn => {
      const type = btn.dataset.taskType;
      const count = tasks.filter(t => getTaskType(t) === type).length;
      btn.classList.toggle('active', type === state.activeTaskType);
      btn.textContent = count ? `${getTaskTypeLabel(type)} ${count}` : getTaskTypeLabel(type);
    });
    $$('#dhTaskStatusTabs [data-task-status]').forEach(btn => {
      const status = btn.dataset.taskStatus || 'pending';
      const count = tasks.filter(t => getTaskType(t) === state.activeTaskType && (status === 'all' || taskStatusBucket(t.status) === status)).length;
      btn.classList.toggle('active', status === state.activeTaskStatus);
      btn.textContent = count ? `${btn.dataset.label || btn.textContent.replace(/\s+\d+$/, '')} ${count}` : (btn.dataset.label || btn.textContent.replace(/\s+\d+$/, ''));
    });
    updateTaskBadge();
    const scopedTasks = tasks.filter(t => getTaskType(t) === state.activeTaskType)
      .filter(t => state.activeTaskStatus === 'all' || taskStatusBucket(t.status) === state.activeTaskStatus);
    if (!scopedTasks.length) {
      const statusLabel = $(`#dhTaskStatusTabs [data-task-status="${state.activeTaskStatus}"]`)?.dataset?.label || '';
      host.innerHTML = `<div class="dh-empty">
        <div class="dh-empty-icon">&#8987;</div>
        <div class="dh-empty-text">暂无${getTaskTypeLabel(state.activeTaskType)}${statusLabel ? statusLabel : ''}任务</div>
        <div class="dh-empty-sub">&#21046;&#20316;&#36807;&#31243;&#20013;&#28857;&#20987;&#20445;&#23384;&#36827;&#24230;&#65292;&#21047;&#26032;&#21518;&#21487;&#20174;&#36825;&#37324;&#32487;&#32493;&#23436;&#25104;</div>
      </div>`;
      return;
    }
    const ordered = scopedTasks.slice().sort((a, b) => {
      const aw = ACTIVE_TASK_STATUSES.has(a.status) ? 1 : 0;
      const bw = ACTIVE_TASK_STATUSES.has(b.status) ? 1 : 0;
      return bw - aw || (b.startedAt || 0) - (a.startedAt || 0);
    });
    host.innerHTML = ordered.map(t => {
      const active = ACTIVE_TASK_STATUSES.has(t.status);
      const progressPct = getTaskProgressPercent(t);
      const elapsed = t.elapsed != null
        ? `${t.elapsed}s`
        : (t.startedAt ? `${Math.max(0, Math.round((Date.now() - t.startedAt) / 1000))}s` : '--');
      const elapsedLabel = t.isLuxuryProjectDraft ? '已保存' : `&#24050;&#29992; ${escapeHtml(elapsed)}`;
      const created = t.startedAt ? new Date(t.startedAt).toLocaleString('zh-CN', { hour12: false }) : '--';
      const videoUrl = t.videoUrl || t.video_url || '';
      const poster = t.thumbnailUrl || t.thumbnail_url || t.imageUrl || t.image_url || t.previewUrl || '';
      const posterUrl = poster ? withAuthQuery(poster) : '';
      const playableVideoUrl = videoUrl ? withAuthQuery(videoUrl) : '';
      const taskRatio = String(t.ratio || t.aspectRatio || t.aspect_ratio || t.resolution || '').toLowerCase();
      const ratioClass = taskRatio.includes('16:9') || taskRatio.includes('1280x720') || taskRatio.includes('1920x1080')
        ? ' dh-task-thumb-landscape'
        : (taskRatio.includes('1:1') || taskRatio.includes('960x960') ? ' dh-task-thumb-square' : '');
      const preview = t.isLuxuryProjectDraft
        ? renderTaskImageCover(t, posterUrl, ratioClass)
        : active
        ? `<div class="dh-task-thumb dh-task-thumb-running">${renderTaskPercentBlock(t)}</div>`
        : (playableVideoUrl
          ? renderTaskVideoCover(t, playableVideoUrl, posterUrl, ratioClass)
          : renderTaskImageCover(t, posterUrl, ratioClass));
      const video = '';
      const error = t.error ? `<div class="dh-task-error">${escapeHtml(t.error)}</div>` : '';
      const subtitle = t.subtitleWarning
        ? `<div class="dh-task-warning">${escapeHtml(t.subtitleWarning)}</div>`
        : (t.subtitleBurned ? `<div class="dh-task-ok">&#23383;&#24149;&#24050;&#28903;&#24405;&#21040;&#35270;&#39057;</div>` : '');
      const progressBar = active ? `<div class="dh-task-progress-bar"><i style="width:${progressPct}%"></i></div>` : '';
      const canRetry = !t.isLuxuryProjectDraft && ['error', 'invalid', 'timeout'].includes(String(t.status || ''));
      return `<div class="dh-task-card ${active ? 'active' : ''}" data-task-id="${escapeHtml(t.taskId)}">
        ${preview}
        <div class="dh-task-main">
          <div class="dh-task-head">
            <div>
              <div class="dh-task-title">${escapeHtml(t.avatarName || '\u6570\u5b57\u4eba\u4efb\u52a1')}</div>
              <div class="dh-task-sub">${escapeHtml(getTaskTypeLabel(getTaskType(t)))} · ID ${escapeHtml(String(t.taskId).slice(0, 8))} · ${escapeHtml(created)}</div>
            </div>
            <span class="dh-task-status ${escapeHtml(t.status || '')}">${getTaskStatusText(t.status)}</span>
          </div>
          <div class="dh-task-progress">
            <span>${getTaskStageText(t.stage, t)}</span>
            <span>${active ? `${progressPct}%` : escapeHtml(getTaskStatusText(t.status))}</span>
            <span>${elapsedLabel}</span>
          </div>
          ${progressBar}
          <div class="dh-task-text">${escapeHtml(t.textPreview || '')}</div>
          ${video}${subtitle}${error}
          <div class="dh-task-actions">
            ${t.isLuxuryProjectDraft ? `<button class="dh-btn dh-btn-primary dh-btn-sm" data-lux-project-continue="${escapeHtml(t.projectId)}">继续制作</button>` : ''}
            ${t.isLuxuryProjectDraft ? `<button class="dh-btn dh-btn-ghost dh-btn-sm" data-task-focus="${escapeHtml(t.taskId)}">查看详情</button>` : ''}
            ${playableVideoUrl ? `<button class="dh-btn dh-btn-primary dh-btn-sm" data-task-preview="${escapeHtml(t.taskId)}">&#9654; &#25918;&#22823;&#39044;&#35272;</button>` : ''}
            ${canRetry ? `<button class="dh-btn dh-btn-primary dh-btn-sm" data-task-retry="${escapeHtml(t.taskId)}">&#8635; &#37325;&#26032;&#25552;&#20132;</button>` : ''}
            ${!t.isLuxuryProjectDraft ? `<button class="dh-btn dh-btn-ghost dh-btn-sm" data-task-focus="${escapeHtml(t.taskId)}">&#26597;&#30475;&#35814;&#24773;</button>` : ''}
            ${playableVideoUrl ? `<a class="dh-btn dh-btn-ghost dh-btn-sm" href="${escapeHtml(playableVideoUrl)}" download>&#19979;&#36733;</a>` : ''}
            ${!t.isLuxuryProjectDraft ? `<button class="dh-btn dh-btn-ghost dh-btn-sm" data-tab-go="works">&#20316;&#21697;&#24211;</button>` : ''}
            ${t.isLuxuryProjectDraft ? `<button class="dh-btn dh-btn-ghost dh-btn-sm" data-lux-project-delete="${escapeHtml(t.projectId)}">删除</button>` : `<button class="dh-btn dh-btn-ghost dh-btn-sm" data-task-remove="${escapeHtml(t.taskId)}">&#31227;&#38500;</button>`}
          </div>
        </div>
      </div>`;
    }).join('');
    // 列表页只加载封面，真实 video 只在放大预览时创建，避免任务多时抢占带宽。
  }
  function syncRunningTask(taskId, patch = {}) {
    const current = state.s3.runningTasks.get(taskId) || {};
    const next = { ...current, ...patch };
    state.s3.runningTasks.set(taskId, next);
    upsertVideoTask({ taskId, ...next });
    return next;
  }

  function replaceRetriedTask(oldTaskId, newTaskId) {
    const oldMeta = state.s3.runningTasks.get(oldTaskId);
    if (oldMeta?.pollTimer) clearInterval(oldMeta.pollTimer);
    state.s3.runningTasks.delete(oldTaskId);
    removeStoredVideoTask(oldTaskId);
    const modal = document.getElementById('dhTaskProgressModal');
    if (modal?.dataset?.taskId && String(modal.dataset.taskId) === String(oldTaskId)) {
      modal.dataset.taskId = String(newTaskId || '');
    }
  }

  async function retryVideoTask(taskId) {
    const oldTask = readVideoTasks().find(t => String(t.taskId) === String(taskId))
      || state.s3.runningTasks.get(taskId);
    if (!oldTask) {
      toast('任务记录不存在，无法重新提交', 'error');
      return;
    }
    const type = getTaskType(oldTask);
    if (ACTIVE_TASK_STATUSES.has(oldTask.status)) {
      toast('任务仍在生成中，请勿重复提交', 'error');
      return;
    }
    let payload = oldTask.retryPayload || null;
    if (type === 'digital_ad' || type === 'luxury_ad') {
      if (!payload?.background_url || !payload?.text || !payload?.voice_id) {
        try {
          const remote = await api(`/api/dh/spaces/${encodeURIComponent(taskId)}`);
          const t = remote?.task || {};
          const detail = oldTask.createDetail || {};
          const adMode = t.ad_mode || payload?.ad_mode || (String(detail.adMode || '').includes('高定') ? 'luxury_ad' : 'showroom_guide');
          payload = {
            avatar_id: t.avatar_id || payload?.avatar_id || detail.avatarId || '',
            background_url: t.background_url || payload?.background_url || detail.backgroundUrl || oldTask.previewUrl || '',
            text: t.text || payload?.text || detail.text || oldTask.textPreview || '',
            title: t.title || payload?.title || detail.title || oldTask.avatarName || '素材审片',
            voice_id: t.voice_id || payload?.voice_id || detail.voiceId || '',
            scene: t.scene || payload?.scene || 'auto',
            camera: t.camera || payload?.camera || 'auto',
            scene_prompt: t.scene_prompt || payload?.scene_prompt || detail.scenePrompt || '',
            camera_prompt: t.camera_prompt || payload?.camera_prompt || detail.cameraPrompt || 'AI 根据广告内容、背景画面和文案自动选择镜头运动',
            duration_sec: t.duration_sec || payload?.duration_sec || detail.durationSec || 18,
            segments: t.segments || payload?.segments || detail.segments || [],
            speech_segments: t.speech_segments || payload?.speech_segments || detail.speechSegments || [],
            keyframes: t.keyframes || payload?.keyframes || detail.keyframes || [],
            guide_gender: t.guide_gender || payload?.guide_gender || detail.guideGender || 'female',
            subtitle: t.subtitle || payload?.subtitle || detail.subtitle || null,
            generation_mode: t.generation_mode || payload?.generation_mode || spaceGuideGenerationMode(adMode === 'luxury_ad'),
            ad_mode: adMode,
            ad_style: t.ad_style || payload?.ad_style || detail.adStyle || 'luxury_soft',
            shot_count: t.shot_count || payload?.shot_count || detail.shotCount || undefined,
            ...outputPayload(t.ratio || payload?.aspect_ratio || detail.outputRatio || '16:9', t.output_size || payload?.output_size || detail.outputSize || 'standard'),
          };
        } catch (err) {
          console.warn('retry fetch ad task failed', err);
        }
      }
      if (!payload?.background_url || !String(payload?.text || '').trim() || !String(payload?.voice_id || '').trim()) {
        switchTab(type === 'luxury_ad' ? 'luxury-ad' : 'space-guide');
        toast(type === 'luxury_ad' ? '旧剧情广告任务缺少重提参数，请回剧情广告页面确认画面、文案和音色后提交' : '旧广告任务缺少重提参数，请回素材审片页面确认背景、文案和音色后提交', 'error');
        return;
      }
      const needsStrictKeyframe = payload.strict_mode === true
        || payload.strict_mode === 'true'
        || payload.generation_mode === 'showroom_guide_strict'
        || (payload.ad_mode === 'showroom_guide' && payload.generation_mode === SPACE_GUIDE_TRACKS_MODE);
      if (needsStrictKeyframe) {
        const submitAsTracks = payload.ad_mode === 'showroom_guide' && payload.generation_mode === SPACE_GUIDE_TRACKS_MODE;
        toast('首帧记录已重新生成，正在提交视频任务...', 'info');
        const k = await api('/api/dh/spaces/keyframes', {
          method: 'POST',
          body: {
            ...payload,
            keyframes: [],
            keyframe_id: '',
            generation_mode: 'showroom_guide_strict',
            strict_mode: true,
            ad_mode: 'showroom_guide',
          },
        });
        if (!k.success) throw new Error(k.error || '重新生成首帧失败');
        const freshKeyframeId = k.keyframe_id || k.keyframes?.[0]?.keyframe_id || '';
        if (!freshKeyframeId) throw new Error('重新生成首帧失败：未返回 keyframe_id');
        payload = {
          ...payload,
          keyframes: k.keyframes || [],
          keyframe_id: freshKeyframeId,
          generation_mode: submitAsTracks ? SPACE_GUIDE_TRACKS_MODE : 'showroom_guide_strict',
          strict_mode: !submitAsTracks,
          ad_mode: 'showroom_guide',
          aspect_ratio: k.ratio || payload.aspect_ratio,
          output_size: k.output_size || payload.output_size,
        };
      }
      const r = await api('/api/dh/spaces/generate', {
        method: 'POST',
        body: { ...payload, replaces_task_id: taskId },
      });
      if (!r.success || !r.taskId) throw new Error(r.error || '重新提交失败');
      replaceRetriedTask(taskId, r.taskId);
      const taskMeta = {
        taskId: r.taskId,
        taskType: type === 'luxury_ad' || payload.ad_mode === 'luxury_ad' ? 'luxury_ad' : 'digital_ad',
        avatarName: payload.title || oldTask.avatarName || '素材审片',
        startedAt: Date.now(),
        status: 'submitted',
        stage: 'submitted',
        snapshot: null,
        previewUrl: r.keyframeUrl || payload.keyframes?.[0]?.image_url || payload.background_url || oldTask.previewUrl || '',
        textPreview: payload.text || oldTask.textPreview || '',
        retryPayload: payload,
        createDetail: {
          ...(oldTask.createDetail || {}),
          title: payload.title || oldTask.createDetail?.title || oldTask.avatarName || '素材审片',
          durationSec: payload.duration_sec,
          text: payload.text || oldTask.textPreview || '',
          avatarId: payload.avatar_id || '',
          backgroundUrl: payload.background_url || '',
          voiceId: payload.voice_id || '',
          scenePrompt: payload.scene_prompt || '',
          cameraPrompt: payload.camera_prompt || '',
          adMode: payload.ad_mode === 'luxury_ad' ? '剧情广告' : '素材审片',
          adStyle: payload.ad_style || '',
          guideGender: payload.guide_gender || '',
          shotCount: payload.shot_count || '',
          segments: payload.segments || [],
          speechSegments: payload.speech_segments || [],
          keyframes: payload.keyframes || [],
          subtitle: payload.subtitle || null,
          outputRatio: payload.aspect_ratio || payload.aspectRatio || '16:9',
          outputSize: payload.output_size || payload.outputSize || 'standard',
          submittedAt: new Date().toISOString(),
        },
      };
      syncRunningTask(r.taskId, taskMeta);
      pollVideoTask(r.taskId);
      state.activeTaskType = type === 'luxury_ad' ? 'luxury_ad' : 'digital_ad';
      renderTaskCenter();
      toast(type === 'luxury_ad' ? '已重新提交剧情广告任务' : '已重新提交素材审片任务', 'success');
      return;
    }
    if (type !== 'product_ad') {
      toast('当前任务类型暂不支持一键重新提交', 'error');
      return;
    }
    if (!payload?.avatar_id || !payload?.voice_id) {
      try {
        const remote = await api(`/api/dh/product-ads/${encodeURIComponent(taskId)}`);
        const t = remote?.task || {};
        payload = {
          avatar_id: t.avatar_id || payload?.avatar_id || oldTask.createDetail?.avatarId || '',
          product: t.product || payload?.product || null,
          topic: t.topic || payload?.topic || oldTask.createDetail?.text || oldTask.textPreview || '',
          title: t.title || payload?.title || oldTask.createDetail?.title || '',
          duration_sec: t.duration_sec || payload?.duration_sec || oldTask.createDetail?.durationSec || 18,
          segments: t.segments || payload?.segments || oldTask.createDetail?.segments || [],
          voice_id: t.voice_id || payload?.voice_id || oldTask.createDetail?.voiceId || '',
          voice_provider: t.voice_provider || payload?.voice_provider || oldTask.createDetail?.voiceProvider || '',
          subtitle: t.subtitle || payload?.subtitle || null,
        };
      } catch (err) {
        console.warn('retry fetch task failed', err);
      }
    }
    if (!payload?.avatar_id || !String(payload?.voice_id || '').trim()) {
      switchTab('product-dh');
      toast('旧任务缺少重提参数，请重新选择商品形象和音色后提交', 'error');
      return;
    }
    const r = await api('/api/dh/product-ads/generate', {
      method: 'POST',
      body: { ...payload, replaces_task_id: taskId },
    });
    if (!r.success || !r.taskId) throw new Error(r.error || '重新提交失败');
    replaceRetriedTask(taskId, r.taskId);
    const taskMeta = {
      taskId: r.taskId,
      taskType: 'product_ad',
      avatarName: payload.title || oldTask.avatarName || '商品口播视频',
      startedAt: Date.now(),
      status: 'submitted',
      stage: 'submitted',
      snapshot: null,
      previewUrl: payload.product?.image_url || oldTask.previewUrl || '',
      textPreview: payload.topic || oldTask.textPreview || '',
      retryPayload: payload,
      createDetail: {
        ...(oldTask.createDetail || {}),
        title: payload.title || oldTask.createDetail?.title || oldTask.avatarName || '商品口播视频',
        durationSec: payload.duration_sec,
        text: payload.topic || oldTask.textPreview || '',
        avatarId: payload.avatar_id,
        productName: payload.product?.name || payload.product?.image_name || oldTask.createDetail?.productName || '',
        backgroundUrl: payload.product?.image_url || oldTask.createDetail?.backgroundUrl || '',
        voiceId: payload.voice_id,
        voiceProvider: payload.voice_provider || '',
        segments: payload.segments || [],
        submittedAt: new Date().toISOString(),
      },
    };
    syncRunningTask(r.taskId, taskMeta);
    pollVideoTask(r.taskId);
    state.activeTaskType = 'product_ad';
    renderTaskCenter();
    toast('已重新提交商品口播视频任务', 'success');
  }

  function normalizeRemoteVideoTask(t = {}) {
    const taskId = t.id || t.taskId;
    if (!taskId) return null;
    const mode = String(t.mode || t.source || t.generation_mode || '').toLowerCase();
    const adMode = String(t.ad_mode || '').toLowerCase();
    const taskType = mode.includes('product_ad') || mode.includes('product_avatar') || adMode.includes('product')
      ? 'product_ad'
      : (mode.includes('luxury_ad') || adMode.includes('luxury')
        ? 'luxury_ad'
        : (mode.includes('digital_ad') || mode.includes('showroom') || adMode.includes('showroom') ? 'digital_ad' : 'digital_human'));
    const createdAt = t.created_at || t.startedAt || t.createdAt || Date.now();
    const startedAt = typeof createdAt === 'number' ? createdAt : (Date.parse(createdAt) || Date.now());
    return {
      taskId,
      taskType,
      status: t.status || 'done',
      stage: t.stage || (t.status === 'done' ? 'done' : ''),
      progress: Number(t.progress) || (t.status === 'done' ? 100 : 0),
      avatarName: t.title || t.avatarName || getTaskTypeLabel(taskType),
      textPreview: t.text || t.textPreview || '',
      videoUrl: t.videoUrl || t.video_url || '',
      thumbnailUrl: t.thumbnailUrl || t.thumbnail_url || '',
      imageUrl: t.imageUrl || t.image_url || '',
      ratio: t.ratio || t.aspectRatio || t.aspect_ratio || '',
      resolution: t.resolution || '',
      outputSize: t.output_size || t.outputSize || '',
      subtitleBurned: !!(t.subtitle_burned || t.subtitleBurned),
      subtitleWarning: t.subtitle_warning || t.subtitleWarning || '',
      production_project_id: t.production_project_id || t.productionProjectId || t.project_id || '',
      projectId: t.production_project_id || t.productionProjectId || t.project_id || '',
      scenes: t.scenes || [],
      keyframes: t.keyframes || [],
      clips: t.clips || t.clip_urls || [],
      startedAt,
      updatedAt: Date.now(),
    };
  }

  async function restoreVideoTasks() {
    const local = readVideoTasks();
    try {
      const r = await api('/api/dh/videos/tasks');
      const remoteTasks = (r?.data || []).map(normalizeRemoteVideoTask).filter(Boolean);
      if (remoteTasks.length) {
        const merged = new Map(local.map(t => [String(t.taskId), t]));
        remoteTasks.forEach(t => {
          const old = merged.get(String(t.taskId)) || {};
          merged.set(String(t.taskId), { ...old, ...t });
        });
        writeVideoTasks(Array.from(merged.values()));
      } else {
        renderTaskCenter();
      }
    } catch (err) {
      console.warn('[DH/tasks] restore from server failed:', err);
      renderTaskCenter();
    }
    readVideoTasks()
      .filter(t => ACTIVE_TASK_STATUSES.has(t.status))
      .forEach(t => {
        if (state.s3.runningTasks.has(t.taskId)) return;
        state.s3.runningTasks.set(t.taskId, { ...t, snapshot: null });
        pollVideoTask(t.taskId);
      });
  }

  function renderSpaceGuide() {
    const isLuxury = state.space.adMode === 'luxury';
    const host = $('#dhSpaceAvatar');
    if (host) {
      const a = state.selectedAvatar;
      if (!a) {
        host.innerHTML = `<div class="dh-selected-empty">
          <div class="dh-empty-icon">▥</div>
          <div>${isLuxury ? '可选：选择一个人物身份参考；系统会保持多镜头人物一致性' : '从「我的形象」选择一个数字人'}</div>
          <button class="dh-link-btn" data-space-pick-avatar>去选择形象 →</button>
        </div>`;
      } else {
        const rawImg = a.image_url || a.photo_url || '';
        const img = a.id ? `/api/dh/my-avatars/${a.id}/thumbnail` : rawImg;
        host.innerHTML = `${img
          ? `<img src="${escapeHtml(withAuthQuery(img))}" alt="${escapeHtml(a.name || '数字人')}" loading="eager" decoding="async" fetchpriority="high" onerror="this.onerror=null;this.src='${escapeHtml(withAuthQuery(rawImg || (a.id ? `/api/dh/my-avatars/${a.id}/thumbnail` : '')))}'">`
          : `<div class="dh-selected-empty"><div class="dh-empty-icon">▥</div><div>这个形象缺少可用封面图</div><button class="dh-link-btn" data-space-pick-avatar>重新选择形象 →</button></div>`}
          <div class="av-name">${escapeHtml(a.name || '已选形象')}</div>
          <div class="av-badges"><span class="av-badge">${isLuxury ? '剧情广告' : '素材审片'}</span><span class="av-badge">静态图驱动</span></div>
          <div class="dh-field-hint" style="margin-top:6px">${isLuxury ? '高定片会把形象作为同一人物身份参考逐镜头重绘进场景；锁定脸型、发型、年龄感和服装风格，只改变姿态、表情和镜头角度。' : '生成时使用形象静态图保持身份；动态预览只用于查看人物效果，不直接作为广告视频输入。'}</div>
          <button class="av-switch-btn" data-space-pick-avatar>↻ 切换形象</button>`;
      }
    }

    const bgPreview = $('#dhSpaceBgPreview');
    const bgDrop = $('#dhSpaceBgDrop');
    const bgImg = $('#dhSpaceBgImg');
    if (bgPreview && bgDrop && bgImg) {
      const previewUrl = state.space.bgPreviewUrl || state.space.bgImageUrl;
      if (previewUrl) {
        bgImg.src = previewUrl;
        bgImg.loading = 'eager';
        bgImg.decoding = 'async';
        bgPreview.style.display = '';
        bgDrop.style.display = 'none';
        const hint = bgPreview.querySelector('[data-space-bg-uploading]');
        if (hint) {
          const refs = state.space.referenceImages || [];
          hint.innerHTML = isLuxury && refs.length
            ? `<div>${state.space.bgUploading ? '参考素材正在上传...' : `已上传 ${refs.filter(x => x.url).length} 张参考素材`}</div>
              <div class="dh-luxury-ref-strip">
                ${refs.map((img, idx) => `<span class="dh-luxury-ref-thumb ${idx === 0 ? 'primary' : ''}">
                  <img src="${escapeHtml(img.previewUrl || img.url)}" alt="${escapeHtml(img.name || `参考素材 ${idx + 1}`)}">
                  <b>${idx === 0 ? '主' : idx + 1}</b>
                </span>`).join('')}
              </div>`
            : (state.space.bgUploading ? '本地预览已显示，正在上传到服务器...' : '');
        }
      } else {
        bgPreview.style.display = 'none';
        bgDrop.style.display = '';
      }
    }

    $$('[data-space-scene]').forEach(b => b.classList.toggle('active', b.dataset.spaceScene === state.space.scene));
    $$('[data-space-camera]').forEach(b => b.classList.toggle('active', b.dataset.spaceCamera === state.space.camera));
    const scenePrompt = $('#dhSpaceScenePrompt');
    if (scenePrompt && document.activeElement !== scenePrompt) scenePrompt.value = state.space.scenePrompt || '';
    const cameraPrompt = $('#dhSpaceCameraPrompt');
    if (cameraPrompt && document.activeElement !== cameraPrompt) cameraPrompt.value = state.space.cameraPrompt || '';
    const duration = $('#dhSpaceDuration');
    if (duration) duration.value = String(state.space.durationSec || 30);
    const subtitle = $('#dhSpaceSubtitleOn');
    if (subtitle) subtitle.checked = state.space.subtitle !== false && state.s3.subtitle.show !== false;
    renderSpaceAdMode();
    renderSpaceCopyMode();
    renderSpaceVoiceOptions();
  }

  function renderSpaceVoiceOptions() {
    const select = $('#dhSpaceVoiceSelect');
    if (select) {
      const current = state.space.voiceId || '';
      const list = (state.voices || []).filter(v => v.id && !state.badVoices.has(v.id));
      const merged = [{ id: '', name: '请选择配音音色', provider: '系统' }, ...list];
      select.innerHTML = merged.map(v => `<option value="${escapeHtml(v.id || '')}" ${String(v.id || '') === String(current) ? 'selected' : ''}>${escapeHtml(v.name || v.id || '请选择配音音色')}</option>`).join('');
      if (!merged.some(v => String(v.id || '') === String(current))) select.value = '';
      return;
    }
    const host = $('#dhSpaceVoiceList');
    const modalHost = $('#dhSpaceVoiceModalList');
    if (!host && !modalHost) return;
    const modalTarget = state.voiceModalTarget === 'luxury-ad' ? 'luxury-ad' : 'space';
    const current = modalTarget === 'luxury-ad' ? (state.luxuryAd.voiceId || '') : (state.space.voiceId || '');
    const q = ($('#dhSpaceVoiceModalSearch')?.value || $('#dhSpaceVoiceSearch')?.value || '').trim().toLowerCase();
    const list = (state.voices || []).filter(v => {
      if (!v.id) return false;
      if (state.badVoices.has(v.id)) return false;
      if (!q) return true;
      return `${v.name || ''} ${v.provider || ''} ${v.gender || ''}`.toLowerCase().includes(q);
    });
    list.forEach(v => { v._gender = _inferGender(v); });
    const clones = list.filter(v => v.isCloned);
    const others = list.filter(v => !v.isCloned);
    const byGender = { female: [], male: [], child: [], neutral: [] };
    for (const v of others) (byGender[v._gender || 'neutral'] || byGender.neutral).push(v);
    const groupLabel = { female: '👩 女声', male: '👨 男声', child: '🧒 童声', neutral: '🎙️ 其他' };
    const genderIcon = g => ({ female: '👩', male: '👨', child: '🧒', auto: '⚡' }[g] || '🎙️');
    const voiceDataAttr = modalTarget === 'luxury-ad' ? 'data-luxury-voice-id' : 'data-space-voice-id';
    const rec = modalTarget === 'luxury-ad' ? recommendedLuxuryVoice() : null;
    const recVoiceId = rec?.voice?.id ? String(rec.voice.id) : '';
    const card = v => {
      const isSelected = String(v.id) === String(current);
      const isRecommended = String(v.id) === recVoiceId;
      return `<div class="dh-voice-opt ${v.isCloned ? 'cloned' : ''} ${isSelected ? 'selected dh-voice-opt-selected' : ''} ${isRecommended ? 'dh-luxgen-voice-recommend' : ''}" ${voiceDataAttr}="${escapeHtml(v.id)}" ${isSelected ? 'aria-current="true"' : ''}>
      <div class="dh-voice-opt-icon">${v.providerIcon || genderIcon(v._gender || v.gender)}</div>
      <div class="dh-voice-opt-body">
        ${(isSelected || isRecommended) ? `<div class="dh-voice-status-row">${isSelected ? '<span class="dh-voice-status-badge selected">当前已选</span>' : ''}${isRecommended ? '<span class="dh-voice-status-badge recommend">推荐</span>' : ''}</div>` : ''}
        <div class="dh-voice-opt-name">${escapeHtml(v.name || v.id)} <span style="font-size:10px;color:var(--dh-text-muted)">${_genderLabel(v._gender || v.gender)}</span></div>
        <div class="dh-voice-opt-sub">${v.isCloned ? '我的声音' : '系统音色'}${isRecommended ? ` · 按内容推荐：${escapeHtml(rec.ctx.label)}` : ''}</div>
        ${isRecommended ? `<div class="dh-luxgen-voice-reason">更适合当前广告内容的情绪、节奏和旁白方向。</div>` : ''}
      </div>
      ${v.id ? `<button class="dh-voice-opt-preview" data-voice-preview="${escapeHtml(v.id)}" title="试听">▶</button>` : ''}
      ${isSelected ? '<div class="dh-voice-selected-check" aria-hidden="true">✓</div>' : ''}
    </div>`;
    };
    const selectedVoice = (state.voices || []).find(v => String(v.id) === String(current) && !state.badVoices.has(v.id));
    const currentHost = $('#dhSpaceVoiceCurrent');
    if (currentHost && modalTarget !== 'luxury-ad') {
      currentHost.innerHTML = selectedVoice ? `
        <div class="dh-voice-opt-icon">${selectedVoice.providerIcon || genderIcon(selectedVoice._gender || selectedVoice.gender)}</div>
        <div class="dh-voice-opt-body">
          <div class="dh-voice-opt-name">${escapeHtml(selectedVoice.name || selectedVoice.id)} <span style="font-size:10px;color:var(--dh-text-muted)">${_genderLabel(selectedVoice._gender || selectedVoice.gender)}</span></div>
          <div class="dh-voice-opt-sub">${selectedVoice.isCloned ? '我的声音' : '系统音色'}</div>
        </div>
        ${selectedVoice.id ? `<button class="dh-voice-opt-preview" data-voice-preview="${escapeHtml(selectedVoice.id)}" title="试听">▶</button>` : ''}`
        : `<div class="dh-voice-opt-icon">!</div>
        <div class="dh-voice-opt-body">
          <div class="dh-voice-opt-name">未选择配音音色</div>
          <div class="dh-voice-opt-sub">素材审片必须选择一个可用音色后才能生成</div>
        </div>`;
    }
    let html = !list.length ? `<div class="dh-voice-group"><div class="dh-voice-group-title">配音音色</div>
      <div class="dh-empty" style="padding:12px">暂无可用音色，请先到声音克隆或配置中添加音色。</div>
    </div>` : '';
    if (clones.length) html += `<div class="dh-voice-group"><div class="dh-voice-group-title">我的声音（${clones.length}）</div>${clones.map(card).join('')}</div>`;
    for (const g of ['female', 'male', 'child', 'neutral']) {
      const voices = byGender[g] || [];
      if (voices.length) html += `<div class="dh-voice-group"><div class="dh-voice-group-title">${groupLabel[g]}（${voices.length}）</div>${voices.map(card).join('')}</div>`;
    }
    if (modalTarget === 'luxury-ad') {
      const dir = luxuryVoiceDirection();
      const recLine = rec?.voice ? `推荐旁白：${rec.voice.name || rec.voice.id} · ${rec.ctx.label}` : '暂无可推荐音色';
      html = `<div class="dh-luxgen-voice-modal-brief">
        <b>当前配音方向：${escapeHtml(dir.label)}</b>
        <span>${escapeHtml(dir.desc)} ${escapeHtml(recLine)}。点每个音色的试听，会用当前广告台词或该方向示例来判断是否合适。</span>
      </div>${html}`;
    }
    if (host) host.innerHTML = html;
    if (modalHost) modalHost.innerHTML = html;
  }

  function closeSpaceVoiceModal() {
    const modal = $('#dhSpaceVoiceModal');
    if (modal) modal.style.display = 'none';
    stopAudibleMedia({ reset: true });
    state.voiceModalTarget = 'space';
  }

  async function uploadSpaceBackground(file) {
    if (!file) return;
    const files = Array.from(file instanceof FileList ? file : (Array.isArray(file) ? file : [file])).filter(Boolean);
    if (state.space.adMode === 'luxury') return uploadLuxuryReferenceImages(files);
    file = files[0];
    if (!file.type?.startsWith('image/')) return toast('请上传图片文件', 'error');
    const originalName = file.name || 'space-bg';
    if (state.space.bgPreviewUrl && state.space.bgPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(state.space.bgPreviewUrl);
    state.space.bgPreviewUrl = URL.createObjectURL(file);
    state.space.bgImageName = originalName;
    state.space.bgUploading = true;
    state.space.keyframes = [];
    state.space.strictKeyframeId = '';
    renderSpaceGuide();
    toast('背景本地预览已显示，正在上传…');
    try {
      const imageUrl = await uploadDhImage(file, { role: 'space_background' });
      state.space.bgImageUrl = imageUrl;
      if (state.space.bgPreviewUrl && state.space.bgPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(state.space.bgPreviewUrl);
      state.space.bgPreviewUrl = imageUrl;
      state.space.bgImageName = originalName;
      state.space.bgUploading = false;
      renderSpaceGuide();
      toast('空间背景已上传', 'success');
    } catch (err) {
      state.space.bgUploading = false;
      renderSpaceGuide();
      toast('背景上传失败：' + err.message, 'error');
    }
  }

  async function uploadLuxuryReferenceImages(files) {
    const picked = pickUploadableImages(files, { maxCount: 8, label: '参考素材' });
    const images = picked.files;
    if (!images.length) return toast(picked.error || '请上传图片文件', 'error');
    (state.space.referenceImages || []).forEach(img => {
      if (img?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(img.previewUrl);
    });
    state.space.referenceImages = images.map((f, i) => ({
      name: f.name || `参考素材 ${i + 1}`,
      url: '',
      previewUrl: URL.createObjectURL(f),
      uploading: true,
    }));
    state.space.bgImageUrl = '';
    state.space.bgPreviewUrl = state.space.referenceImages[0]?.previewUrl || '';
    state.space.bgImageName = state.space.referenceImages[0]?.name || '';
    state.space.bgUploading = true;
    state.space.keyframes = [];
    state.space.strictKeyframeId = '';
    renderSpaceGuide();
    toast(`已选择 ${images.length} 张参考素材，正在上传…`);
    try {
      for (let i = 0; i < images.length; i++) {
        const imageUrl = await uploadDhImage(images[i], { role: 'luxury_sequence_reference' });
        state.space.referenceImages[i] = { ...state.space.referenceImages[i], url: imageUrl, previewUrl: imageUrl, uploading: false };
        if (i === 0) {
          state.space.bgImageUrl = imageUrl;
          state.space.bgPreviewUrl = imageUrl;
          state.space.bgImageName = state.space.referenceImages[i].name;
        }
        renderSpaceGuide();
      }
      state.space.bgUploading = false;
      renderSpaceGuide();
      toast(`已上传 ${state.space.referenceImages.length} 张高定参考素材`, 'success');
    } catch (err) {
      state.space.bgUploading = false;
      state.space.referenceImages = (state.space.referenceImages || []).map(x => ({ ...x, uploading: false }));
      renderSpaceGuide();
      toast('参考素材上传失败：' + err.message, 'error');
    }
  }

  function luxuryAdRefs() {
    const product = state.luxuryAd.productAsset?.url ? [state.luxuryAd.productAsset.url] : [];
    const refs = (state.luxuryAd.refAssets || state.luxuryAd.assets || []).map(x => x?.url).filter(Boolean);
    return [...product, ...refs].filter((x, i, arr) => x && arr.indexOf(x) === i);
  }

  function compactLuxuryUrl(value = '') {
    const s = String(value || '').trim();
    if (!s || /^blob:/i.test(s) || /^data:/i.test(s)) return '';
    return s;
  }

  function luxuryAdReferenceAssets() {
    return state.luxuryAd.refAssets || state.luxuryAd.assets || [];
  }

  function luxuryAdAnyAssetUploading() {
    // 统一从真实资产状态计算“是否上传中”，不再用单个全局开关误伤后续选择。
    return !!(
      state.luxuryAd.productAsset?.uploading ||
      state.luxuryAd.personAsset?.uploading ||
      luxuryAdReferenceAssets().some(x => x?.uploading) ||
      luxuryAdBriefReferenceAssets().some(x => x?.uploading)
    );
  }

  function syncLuxuryAdUploadFlags() {
    // briefUploading 只代表需求参考图是否仍在传；uploading 代表任意高定图片素材仍在传。
    state.luxuryAd.briefUploading = luxuryAdBriefReferenceAssets().some(x => x?.uploading);
    state.luxuryAd.uploading = luxuryAdAnyAssetUploading();
    return state.luxuryAd.uploading;
  }

  function luxuryAdLocalOnlyPreviewAssets() {
    // 找出只有本地 blob 预览、没有服务器 URL 的素材；这些图不能提交给后端生成。
    const localOnly = asset => asset && !asset.url && !asset.image_url && /^blob:/i.test(asset.previewUrl || '');
    return [
      state.luxuryAd.productAsset,
      state.luxuryAd.personAsset,
      ...luxuryAdReferenceAssets(),
      ...luxuryAdBriefReferenceAssets(),
    ].filter(localOnly);
  }

  function assertLuxuryAdNoLocalOnlyPreviews(stageLabel = '生成') {
    // 严格阻断无法被服务器读取的本地预览图，不做任何自动忽略或兜底。
    const bad = luxuryAdLocalOnlyPreviewAssets();
    if (!bad.length) return;
    throw new Error(`${stageLabel}前还有 ${bad.length} 张图片没有上传成功，请删除后重新上传`);
  }

  function revokeLuxuryBlobPreview(asset = {}) {
    // 上传完成后释放本地 blob 预览，避免多图上传时浏览器内存持续增长。
    const url = asset?.previewUrl || '';
    if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
  }

  function setLuxuryAdReferenceAssets(refs = []) {
    const next = (Array.isArray(refs) ? refs : []).slice(0, 8);
    state.luxuryAd.refAssets = next;
    state.luxuryAd.assets = next;
    return next;
  }

  function luxuryAdIsMaterialMode() {
    return (state.luxuryAd.flowMode || 'material') === 'material';
  }

  function setLuxuryAdFlowMode(mode = 'material') {
    const next = mode === 'story' ? 'story' : 'material';
    const changed = state.luxuryAd.flowMode !== next;
    state.luxuryAd.flowMode = next;
    if (!changed) return;
    state.luxuryAd.currentStep = 1;
    state.luxuryAd.storyboardDetailed = false;
    state.luxuryAd.segments = [];
    state.luxuryAd.keyframes = [];
    state.luxuryAd.storyboardSheets = [];
    state.luxuryAd.keyframeError = '';
    state.luxuryAd.keyframeErrorDetails = null;
    state.luxuryAd.personGenerationError = null;
    state.luxuryAd.keyframePlanningOnly = false;
    state.luxuryAd.productionContract = null;
    state.luxuryAd.productionProjectId = '';
    state.luxuryAd.productionProject = null;
  }

  function luxuryMaterialAssetUrls() {
    const urls = [];
    const add = value => {
      const url = compactLuxuryUrl(value || '');
      if (url && !/^blob:/i.test(url) && !urls.includes(url)) urls.push(url);
    };
    add(state.luxuryAd.productAsset?.url || state.luxuryAd.productAsset?.image_url || '');
    filledLuxuryAdBriefReferences().forEach(asset => add(asset.url || asset.image_url || asset.previewUrl || ''));
    luxuryAdReferenceAssets().forEach(asset => add(asset.url || asset.image_url || asset.previewUrl || ''));
    return urls.slice(0, 12);
  }

  function renderLuxuryAdModeUi() {
    const material = luxuryAdIsMaterialMode();
    const title = $('#dhLuxAdModeTitle');
    const sub = $('#dhLuxAdModeSub');
    const modeRow = $('#dhLuxAdModeRow');
    if (modeRow) modeRow.remove();
    if (title) title.textContent = material ? '素材审片' : '剧情广告';
    if (sub) {
      sub.textContent = material
        ? '选择演员、上传多张素材，AI 生成广告词后直接合成基础广告；不生成分镜图片。'
        : '广告需求 → 场景配置 → 剧本生成 → 分镜生成 → 广告合成。点击合成后进入任务中心查看全量内容。';
    }
    const labels = material
      ? [
        ['广告需求', '说明产品和卖点'],
        ['素材/演员', '上传素材并选演员'],
        ['广告词', 'AI 生成口播文案'],
        ['剪辑方案', '按素材节奏合成'],
        ['成片合成', '配音/字幕/BGM'],
      ]
      : [
        ['广告需求', '一句话输入'],
        ['场景配置', '人物 / 场景 / 主体'],
        ['剧本生成', '按时间段拆解'],
        ['分镜生成', '形象和镜头'],
        ['广告合成', '配音 / 字幕 / 视频'],
      ];
    $$('#dhLuxAdSteps > [data-lux-step]').forEach(el => {
      const idx = Math.max(0, Number(el.dataset.luxStep || 1) - 1);
      const span = el.querySelector('span');
      const small = el.querySelector('small');
      if (span) span.textContent = labels[idx]?.[0] || span.textContent;
      if (small) small.textContent = labels[idx]?.[1] || small.textContent;
    });
    const generate = $('#dhLuxAdGenerate');
    if (generate) generate.textContent = material ? '生成广告词方案' : '生成场景配置';
    const storyboard = $('#dhLuxAdStoryboard');
    if (storyboard) storyboard.textContent = material ? '确认素材和广告词' : '确认基础信息，生成剧本';
    const preview = $('#dhLuxAdPreviewFrames');
    if (preview) preview.textContent = material ? '跳过分镜，进入合成' : '确认剧本和人物，生成分镜';
    const submit = $('#dhLuxAdConfirmGenerate');
    if (submit) submit.textContent = material ? '合成素材成片' : '合成广告';
    const step3Title = $('#dhLuxAdStep3Title');
    if (step3Title) step3Title.innerHTML = `<span class="dh-luxgen-step-pill">3</span>${material ? '广告词方案' : '剧本生成'}`;
    const step3Copy = $('#dhLuxAdStep3Copy');
    if (step3Copy) step3Copy.textContent = material
      ? '根据广告需求和上传素材生成口播广告词，不进入剧情分镜生成。'
      : '按剧本审核表生成：每一镜包含秒数、画面、动作、台词、目的和确认状态；剧本确认后再选择真人演员来源并进入分镜。';
    const step4Title = $('#dhLuxAdStep4Title');
    if (step4Title) step4Title.innerHTML = `<span class="dh-luxgen-step-pill">4</span>${material ? '剪辑方案' : '分镜生成'}`;
    const step4Copy = $('#dhLuxAdStep4Copy');
    if (step4Copy) step4Copy.textContent = material
      ? '素材成片只确认素材顺序、演员和口播节奏；不会生成分镜图片，也不会触发分镜 QA。'
      : '分镜把人物形象、主体画面和镜头语言一起确认。每个分镜左侧是画面框，右侧是时间、内容、动作表情、镜头、声音字幕和 AI 指令。';
    const frameGuideTitle = $('#dhLuxAdFrameGuideTitle');
    if (frameGuideTitle) frameGuideTitle.textContent = material ? '素材剪辑确认' : '按剧本生成';
    const frameGuideCopy = $('#dhLuxAdFrameGuideCopy');
    if (frameGuideCopy) frameGuideCopy.textContent = material
      ? '基础版素材成片不生成分镜图片；确认素材、演员、广告词和配音后直接进入合成。'
      : '分镜必须严格沿用第 3 步已确认的镜头、人物、台词和动作；如果生成结果缺镜头、乱改主体或与剧本不一致，系统会报错而不是自动兜底。';
    const frameSectionTitle = $('#dhLuxAdFrameSectionTitle');
    if (frameSectionTitle) frameSectionTitle.textContent = material ? '剪辑方案' : '分镜结果';
  }

  function luxuryAdFilledReferenceAssets() {
    return luxuryAdReferenceAssets().filter(luxuryAdAssetFilled);
  }

  function luxuryAdLockedShotLimit() {
    const refCount = luxuryAdFilledReferenceAssets().length;
    if (refCount > 0) return Math.min(8, refCount);
    return 0;
  }

  function clampLuxuryAdSegmentsToLockedAssets(segments = []) {
    const list = Array.isArray(segments) ? segments : [];
    const limit = luxuryAdLockedShotLimit();
    return limit > 0 ? list.slice(0, limit) : list;
  }

  function luxuryAdNormalizeShotIndex(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.min(7, Math.floor(n));
  }

  function luxuryAdAssetFilled(asset) {
    return !!(asset && (asset.url || asset.previewUrl || asset.name || asset.uploading));
  }

  function luxuryAdNextEmptyRefSlot(refs = [], from = 0) {
    for (let i = Math.max(0, from); i < 8; i += 1) {
      if (!luxuryAdAssetFilled(refs[i])) return i;
    }
    return -1;
  }

  function luxuryAdHasLandingAssets() {
    const hasProduct = !!(state.luxuryAd.productAsset?.url || state.luxuryAd.productAsset?.previewUrl);
    const hasReference = luxuryAdReferenceAssets().some(x => x && (x.url || x.previewUrl || x.name));
    return hasProduct || hasReference;
  }

  function luxuryAdStoryNeedsProfessionalScript() {
    return !!(state.luxuryAd.segments?.length && !state.luxuryAd.storyboardDetailed);
  }

  function ensureLuxuryAdVoice() {
    if (state.luxuryAd.voiceId) return state.luxuryAd.voiceId;
    const first = (state.voices || []).find(v => v.id && !state.badVoices.has(v.id));
    if (first) state.luxuryAd.voiceId = first.id;
    return state.luxuryAd.voiceId || '';
  }

  function updateLuxuryAdOutputHint() {
    const ratio = $('#dhLuxAdRatio')?.value || state.luxuryAd.outputRatio || '9:16';
    const size = $('#dhLuxAdSize')?.value || state.luxuryAd.outputSize || 'standard';
    state.luxuryAd.outputRatio = ratio;
    state.luxuryAd.outputSize = size;
    const hint = $('#dhLuxAdOutputHint');
    if (hint) hint.textContent = `${ratio} · ${outputPixels(ratio, size)}`;
  }

  function renderLuxuryAdVoice() {
    const host = $('#dhLuxAdVoiceCurrent');
    renderLuxuryVoiceDirection();
    if (!host) return;
    const current = state.luxuryAd.voiceId || '';
    const v = (state.voices || []).find(x => String(x.id || '') === String(current) && !state.badVoices.has(x.id));
    const genderIcon = g => ({ female: '👩', male: '👨', child: '🧒', auto: '⚡' }[g] || '🎙️');
    if (!v) {
      const rec = recommendedLuxuryVoice();
      if (rec?.voice) {
        const rv = rec.voice;
        rv._gender = _inferGender(rv);
        host.innerHTML = `<div class="dh-voice-opt-icon">${rv.providerIcon || genderIcon(rv._gender || rv.gender)}</div>
          <div class="dh-voice-opt-body">
            <div class="dh-voice-opt-name">推荐：${escapeHtml(rv.name || rv.id)} <span style="font-size:10px;color:var(--dh-text-muted)">${_genderLabel(rv._gender || rv.gender)}</span></div>
            <div class="dh-voice-opt-sub">按内容推荐 · ${escapeHtml(rec.ctx.label)} · 先试听，满意后选用</div>
            <div class="dh-luxgen-voice-recommend-actions">
              <button class="dh-btn dh-btn-primary dh-btn-sm" type="button" data-lux-recommended-voice="${escapeHtml(rv.id)}">选用推荐</button>
              <button class="dh-btn dh-btn-ghost dh-btn-sm" type="button" data-voice-preview="${escapeHtml(rv.id)}">试听</button>
            </div>
          </div>`;
        return;
      }
      host.innerHTML = `<div class="dh-voice-opt-icon">TV</div>
        <div class="dh-voice-opt-body">
          <div class="dh-voice-opt-name">未选择配音</div>
          <div class="dh-voice-opt-sub">剧情广告必须手动选择声音</div>
        </div>`;
      return;
    }
    v._gender = _inferGender(v);
    host.innerHTML = `<div class="dh-voice-opt-icon">${v.providerIcon || genderIcon(v._gender || v.gender)}</div>
      <div class="dh-voice-opt-body">
        <div class="dh-voice-opt-name">${escapeHtml(v.name || v.id)} <span style="font-size:10px;color:var(--dh-text-muted)">${_genderLabel(v._gender || v.gender)}</span></div>
        <div class="dh-voice-opt-sub">${v.isCloned ? '我的声音' : '系统音色'}</div>
      </div>
      ${v.id ? `<button class="dh-voice-opt-preview" data-voice-preview="${escapeHtml(v.id)}" title="试听">▶</button>` : ''}`;
  }

  function luxuryAdHasBgm() {
    const bgm = state.luxuryAd.bgmAsset || {};
    return !!(bgm.file_url || bgm.file_path || bgm.url || bgm.path || bgm.background_music_url || bgm.music_url);
  }

  function normalizeLuxuryAdBgmAsset(bgm = null) {
    if (!bgm || typeof bgm !== 'object') return null;
    let publicUrl = [
      bgm.file_url,
      bgm.url,
      bgm.preview_url,
      bgm.background_music_url,
      bgm.music_url,
    ].map(x => String(x || '').trim()).find(x => /^https?:\/\//i.test(x) || x.startsWith('/')) || '';
    if (!publicUrl) {
      const pathLike = String(bgm.file_path || bgm.path || '').trim();
      const filename = pathLike.split(/[\\/]/).pop() || '';
      if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(filename)) {
        publicUrl = `/api/projects/music/${encodeURIComponent(filename)}`;
      }
    }
    const raw = publicUrl || bgm.file_path || bgm.path || '';
    if (!raw) return null;
    return {
      ...bgm,
      name: bgm.name || bgm.original_name || bgm.title || '背景音乐',
      original_name: bgm.original_name || bgm.name || bgm.title || '背景音乐',
      file_url: publicUrl,
      url: publicUrl,
      file_path: bgm.file_path || bgm.path || '',
      path: bgm.path || bgm.file_path || '',
    };
  }

  function clampLuxuryAudioVolume(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function luxuryAdVoiceVolume() {
    return clampLuxuryAudioVolume(state.luxuryAd.voiceVolume, 1, 0.6, 1.2);
  }

  function luxuryAdBgmVolume() {
    return clampLuxuryAudioVolume(state.luxuryAd.bgmVolume ?? state.luxuryAd.bgmAsset?.volume, 0.16, 0, 0.35);
  }

  function luxuryAdBgmAssetPayload() {
    if (!luxuryAdHasBgm()) return null;
    return {
      ...(normalizeLuxuryAdBgmAsset(state.luxuryAd.bgmAsset) || state.luxuryAd.bgmAsset || {}),
      volume: luxuryAdBgmVolume(),
      voice_volume: luxuryAdVoiceVolume(),
    };
  }

  function luxuryAdSubtitleEnabled() {
    const cfg = state.luxuryAd.subtitle;
    if (cfg === false) return false;
    if (cfg && typeof cfg === 'object' && cfg.show === false) return false;
    return true;
  }

  function getLuxuryAdSubtitlePayload(show = luxuryAdSubtitleEnabled()) {
    const saved = state.luxuryAd.subtitle && typeof state.luxuryAd.subtitle === 'object' ? state.luxuryAd.subtitle : {};
    return {
      ...(state.s3.subtitle || {}),
      ...saved,
      show,
      style: saved.style || state.s3.subtitle?.style || 'popup',
      smartEmphasis: saved.smartEmphasis ?? state.s3.subtitle?.smartEmphasis ?? true,
      fontName: saved.fontName || state.s3.subtitle?.fontName || '抖音美好体',
      fontSize: Number(saved.fontSize || state.s3.subtitle?.fontSize) || 72,
      color: saved.color || state.s3.subtitle?.color || '#FFFFFF',
      outlineColor: saved.outlineColor || state.s3.subtitle?.outlineColor || '#000000',
    };
  }

  function renderLuxuryAdAudioMix() {
    const voiceSlider = $('#dhLuxAdVoiceVolume');
    const bgmSlider = $('#dhLuxAdBgmVolume');
    const voiceLabel = $('#dhLuxAdVoiceVolumeLabel');
    const bgmLabel = $('#dhLuxAdBgmVolumeLabel');
    const voicePct = Math.round(luxuryAdVoiceVolume() * 100);
    const bgmPct = Math.round(luxuryAdBgmVolume() * 100);
    if (voiceSlider && document.activeElement !== voiceSlider) voiceSlider.value = String(voicePct);
    if (bgmSlider && document.activeElement !== bgmSlider) bgmSlider.value = String(bgmPct);
    if (voiceLabel) voiceLabel.textContent = `${voicePct}%`;
    if (bgmLabel) bgmLabel.textContent = `${bgmPct}%`;
    if (state.luxuryAd.bgmAsset) {
      state.luxuryAd.bgmAsset.volume = luxuryAdBgmVolume();
      state.luxuryAd.bgmAsset.voice_volume = luxuryAdVoiceVolume();
    }
  }

  function renderLuxuryAdBgm() {
    const card = $('#dhLuxAdBgmCard');
    const status = $('#dhLuxAdBgmStatus');
    const license = $('#dhLuxAdBgmLicense');
    const profilesHost = $('#dhLuxAdBgmProfiles');
    const profileLabel = $('#dhLuxAdBgmProfileLabel');
    const profileDesc = $('#dhLuxAdBgmProfileDesc');
    const profileMenu = $('#dhLuxAdBgmProfileMenu');
    const profileToggle = $('#dhLuxAdBgmProfileToggle');
    if (!card || !status) return;
    const bgm = state.luxuryAd.bgmAsset || null;
    const ready = luxuryAdHasBgm();
    const main = $('#dhLuxAdBgmPreview', card) || card.querySelector('.dh-luxgen-bgm-main');
    const currentProfile = state.luxuryAd.bgmProfile || 'auto';
    const activeProfile = LUXURY_BGM_PROFILES.find(item => item.id === currentProfile) || LUXURY_BGM_PROFILES[0];
    const menuOpen = !!profilesHost?.classList.contains('open');
    card.classList.toggle('ready', ready);
    renderLuxuryAdAudioMix();
    if (profileLabel) profileLabel.textContent = activeProfile.label;
    if (profileDesc) profileDesc.textContent = activeProfile.desc;
    if (profileMenu) {
      profileMenu.innerHTML = LUXURY_BGM_PROFILES.map(item => `<button type="button" class="dh-luxgen-bgm-option ${item.id === activeProfile.id ? 'active' : ''}" data-lux-bgm-profile="${escapeHtml(item.id)}" title="${escapeHtml(item.desc)}">
        <b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.desc)}</span>
      </button>`).join('');
      profileMenu.hidden = !menuOpen;
    }
    if (profileToggle) profileToggle.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');
    status.textContent = ready
      ? (bgm.original_name || bgm.name || '背景音乐已配置，成片合成后叠加')
      : '未配置，可先合成无配乐广告片';
    if (license) {
      if (ready) {
        const source = bgm.source || (bgm.auto_matched ? '自动匹配' : '用户上传');
        const auth = bgm.license || bgm.license_name || '请确认已获得商用授权';
        const mood = bgm.matched_mood ? ` · ${bgm.matched_mood}` : '';
        license.textContent = `${source}${mood} · ${auth}`;
      } else {
        license.textContent = '可选择曲风并生成本地免第三方采样 BGM，也可上传自有授权音乐。';
      }
    }
    let audio = $('#dhLuxAdBgmAudio');
    const normalizedBgm = normalizeLuxuryAdBgmAsset(bgm);
    const audioUrl = ready ? (normalizedBgm?.file_url || normalizedBgm?.url || '') : '';
    if (ready && audioUrl && main) {
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = 'dhLuxAdBgmAudio';
        audio.controls = true;
        audio.preload = 'none';
        main.appendChild(audio);
      }
      const src = withAuthQuery(audioUrl);
      if (audio.getAttribute('src') !== src) audio.setAttribute('src', src);
    } else if (audio) {
      try { audio.pause(); } catch {}
      audio.removeAttribute('src');
      audio.remove();
    }
  }

  function openMusicSearchText() {
    return [
      state.luxuryAd.briefText,
      state.luxuryAd.content,
      state.luxuryAd.briefInfo?.product,
      state.luxuryAd.briefInfo?.product_subject,
      state.luxuryAd.briefInfo?.audience,
      state.luxuryAd.briefInfo?.selling_point,
      state.luxuryAd.briefInfo?.tone,
      ...(Array.isArray(state.luxuryAd.segments) ? state.luxuryAd.segments.map(s => [
        s.title,
        s.story_stage,
        s.role,
        s.objective,
        s.emotion,
        s.mood,
        s.action,
        s.visual,
        s.voiceover,
        s.narration,
        s.sfx_audio,
      ].filter(Boolean).join(' ')) : []),
    ].filter(Boolean).join(' ').slice(0, 1200);
  }

  function ensureOpenMusicModal() {
    let modal = $('#dhOpenMusicModal');
    if (modal) {
      bindOpenMusicModalEvents(modal);
      return modal;
    }
    modal = document.createElement('div');
    modal.id = 'dhOpenMusicModal';
    modal.className = 'dh-modal dh-open-music-modal';
    modal.hidden = true;
    modal.style.display = 'none';
    modal.innerHTML = `<div class="dh-modal-card dh-open-music-card">
      <div class="dh-modal-head">
        <div>
          <div class="dh-modal-title">公开曲库</div>
          <div class="dh-open-music-sub">只推荐真实纯音乐，过滤电子、游戏、音效类素材；CC BY 曲目需保留作者署名。</div>
        </div>
        <button class="dh-icon-btn" type="button" data-open-music-close aria-label="关闭公开曲库">×</button>
      </div>
      <div class="dh-open-music-search">
        <input class="dh-input" id="dhOpenMusicQuery" placeholder="例如：orchestral cinematic / inspiring piano / corporate acoustic">
        <button class="dh-btn dh-btn-primary dh-btn-sm" type="button" id="dhOpenMusicSearchBtn">搜索</button>
      </div>
      <div class="dh-open-music-note" id="dhOpenMusicNote"></div>
      <div class="dh-open-music-list" id="dhOpenMusicList"></div>
    </div>`;
    document.body.appendChild(modal);
    bindOpenMusicModalEvents(modal);
    return modal;
  }

  function bindOpenMusicModalEvents(modal) {
    if (!modal || modal.dataset.boundOpenMusicClose === 'true') return;
    modal.dataset.boundOpenMusicClose = 'true';
    modal.addEventListener('click', e => {
      const target = e.target;
      if (target?.closest?.('[data-open-music-close]') || target === modal) {
        e.preventDefault();
        e.stopPropagation();
        closeOpenMusicModal();
      }
    }, true);
    modal.addEventListener('pointerdown', e => {
      const target = e.target;
      if (target?.closest?.('[data-open-music-close]')) {
        e.preventDefault();
        e.stopPropagation();
        closeOpenMusicModal();
      }
    }, true);
  }

  function renderOpenMusicModal() {
    const modal = ensureOpenMusicModal();
    const list = $('#dhOpenMusicList', modal);
    const note = $('#dhOpenMusicNote', modal);
    const queryInput = $('#dhOpenMusicQuery', modal);
    const lib = state.luxuryAd.openMusic || {};
    if (queryInput && document.activeElement !== queryInput) queryInput.value = lib.query || '';
    if (note) note.textContent = lib.loading ? '正在搜索公开曲库…' : `${lib.note || '优先选择 CC0；CC BY 可商用但需要保留作者和来源署名。'}${Array.isArray(lib.results) && lib.results.length ? ` 当前显示 ${lib.results.length} 首。` : ''}`;
    if (!list) return;
    if (lib.loading) {
      list.innerHTML = '<div class="dh-open-music-empty">搜索中…</div>';
      return;
    }
    const results = Array.isArray(lib.results) ? lib.results : [];
    if (!results.length) {
      list.innerHTML = '<div class="dh-open-music-empty">暂无结果。可以换成 “orchestral cinematic music” 或 “inspiring piano corporate”。</div>';
      return;
    }
    list.innerHTML = results.map(item => `<article class="dh-open-music-item">
      <div class="dh-open-music-meta">
        <b>${escapeHtml(item.title || '未命名音乐')}</b>
        <span>${escapeHtml(item.creator || 'Unknown')} · ${escapeHtml(item.license_label || item.license || '开放许可')}</span>
        ${item.recommend_reason ? `<span>${escapeHtml(item.recommend_reason)}</span>` : ''}
        ${item.foreign_landing_url ? `<a href="${escapeHtml(item.foreign_landing_url)}" target="_blank" rel="noopener">查看来源页</a>` : ''}
      </div>
      <audio controls preload="none" src="${escapeHtml(item.url || '')}"></audio>
      <button class="dh-btn dh-btn-primary dh-btn-sm" type="button" data-open-music-import="${escapeHtml(item.id)}">选用</button>
    </article>`).join('');
    $$('audio', list).forEach(audio => {
      audio.addEventListener('play', () => {
        $$('audio', list).forEach(other => {
          if (other === audio) return;
          try {
            other.pause();
            other.currentTime = 0;
          } catch {}
        });
      });
    });
  }

  function closeOpenMusicModal() {
    const modal = $('#dhOpenMusicModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.classList.remove('show');
    modal.hidden = true;
    modal.style.display = 'none';
    stopAudibleMedia({ reset: true });
  }

  async function searchOpenMusic(customQuery = '') {
    const modal = ensureOpenMusicModal();
    modal.hidden = false;
    modal.style.display = 'flex';
    modal.classList.add('open');
    const queryInput = $('#dhOpenMusicQuery', modal);
    const query = String(customQuery || queryInput?.value || '').trim();
    stopAudibleMedia({ reset: true });
    state.luxuryAd.openMusic = { ...(state.luxuryAd.openMusic || {}), query, loading: true, results: [], note: '' };
    renderOpenMusicModal();
    try {
      const params = new URLSearchParams({
        profile_id: state.luxuryAd.bgmProfile || 'auto',
        text: openMusicSearchText(),
        page_size: '24',
      });
      if (query) params.set('q', query);
      const r = await api(`/api/dh/luxury-ad/open-music/search?${params.toString()}`, { method: 'GET' });
      state.luxuryAd.openMusic = {
        query: r.query || query,
        results: Array.isArray(r.results) ? r.results : [],
        loading: false,
        note: r.license_note || '',
      };
      renderOpenMusicModal();
    } catch (err) {
      state.luxuryAd.openMusic = { ...(state.luxuryAd.openMusic || {}), loading: false, note: err.message || '公开曲库搜索失败' };
      renderOpenMusicModal();
      toast(err.message || '公开曲库搜索失败', 'error');
    }
  }

  async function importOpenMusic(id) {
    const item = (state.luxuryAd.openMusic?.results || []).find(x => String(x.id) === String(id));
    if (!item) return;
    closeOpenMusicModal();
    try {
      toast('正在导入公开曲目，完成后会自动配置到 BGM…', 'info');
      const r = await api('/api/dh/luxury-ad/open-music/import', { method: 'POST', body: { item } });
      if (!r.success || !r.bgm_asset) throw new Error(r.error || '公开曲目导入失败');
      state.luxuryAd.bgmAsset = {
        ...r.bgm_asset,
        volume: luxuryAdBgmVolume(),
        voice_volume: luxuryAdVoiceVolume(),
      };
      renderLuxuryAdBgm();
      updateLuxuryAdStepLocks();
      await saveLuxuryAdDraft({ silent: true });
      toast(`已选用：${r.bgm_asset.name || '公开曲目'}`, 'success');
    } catch (err) {
      toast(err.message || '公开曲目导入失败', 'error');
    }
  }

  function luxuryAssetPreviewUrl(asset = {}) {
    const raw = asset.previewUrl || asset.url || '';
    if (!raw) return '';
    return /^blob:/i.test(raw) ? raw : withAuthQuery(raw);
  }

  function luxuryAdBriefReferenceAssets() {
    return Array.isArray(state.luxuryAd.briefRefAssets) ? state.luxuryAd.briefRefAssets : [];
  }

  function filledLuxuryAdBriefReferences() {
    return luxuryAdBriefReferenceAssets().filter(x => x && (x.url || x.previewUrl || x.name || x.uploading));
  }

  function renderLuxuryAdBriefRefs() {
    const host = $('#dhLuxAdBriefRefs');
    const drop = $('#dhLuxAdBriefRefDrop');
    const refs = luxuryAdBriefReferenceAssets();
    syncLuxuryAdUploadFlags();
    const hasRefs = refs.some(x => x && (x.url || x.previewUrl || x.name || x.uploading));
    if (drop) {
      const uploading = !!state.luxuryAd.briefUploading;
      drop.classList.toggle('locked', false);
      drop.setAttribute('aria-disabled', 'false');
      const copy = drop.querySelector('span');
      if (copy) {
        copy.textContent = uploading
          ? '继续添加'
          : (hasRefs ? '继续添加' : '产品 / 人物 / 场景 / 竞品');
      }
    }
    if (!host) return;
    if (!hasRefs) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = refs.map((asset, i) => {
      if (!asset || !(asset.url || asset.previewUrl || asset.name || asset.uploading)) return '';
      const url = luxuryAssetPreviewUrl(asset);
      const role = String(asset.role || asset.type || 'auto');
      return `<div class="dh-luxgen-brief-ref-card ${asset.uploading ? 'uploading' : ''}">
        ${url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(asset.name || `需求参考图 ${i + 1}`)}">` : ''}
        <b>#${i + 1}</b>
        <span>${escapeHtml(asset.failed ? `${asset.name || `需求参考图 ${i + 1}`} · 上传失败` : (asset.uploading ? `${asset.name || `需求参考图 ${i + 1}`} · 上传中` : (asset.name || `需求参考图 ${i + 1}`)))}</span>
        <select class="dh-lux-ref-role" data-lux-brief-ref-role="${i}" ${asset.uploading ? 'disabled' : ''} title="标注这张参考图的用途">
          ${[
            ['auto', '自动识别'],
            ['product', '产品'],
            ['person', '人物'],
            ['scene', '场景'],
            ['prop', '道具/细节'],
            ['ui', 'UI/界面'],
            ['style', '风格/竞品'],
          ].map(([value, label]) => `<option value="${value}" ${role === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        <button type="button" data-lux-brief-ref-remove="${i}" title="删除参考图">×</button>
      </div>`;
    }).join('');
  }

  function renderLuxuryAdAssets() {
    const host = $('#dhLuxAdAssets');
    const productHost = $('#dhLuxAdProductAsset');
    const productClear = $('#dhLuxAdProductClear');
    const product = state.luxuryAd.productAsset || null;
    syncLuxuryAdUploadFlags();
    if (productHost) {
      const url = product ? luxuryAssetPreviewUrl(product) : '';
      productHost.innerHTML = url
        ? `<button type="button" class="dh-luxgen-product-card ${product.uploading ? 'uploading' : ''}" data-lux-product-preview title="点击预览主体主图">
            <img src="${escapeHtml(url)}" alt="${escapeHtml(product.name || '主体主图')}">
            <b>主体主图</b><span>${escapeHtml(product.failed ? `${product.name || '主体主图'} · 上传失败` : (product.uploading ? `${product.name || '主体主图'} · 上传中` : (product.name || '已上传主体图')))}</span>
          </button>`
        : product?.uploading
          ? `<div class="dh-luxgen-product-empty uploading"><b>主体主图上传中</b><span>${escapeHtml(product.name || '正在上传')}</span></div>`
        : `<div class="dh-luxgen-product-empty">未上传主体主图</div>`;
    }
    if (productClear) {
      const hasProduct = !!(product && (product.url || product.previewUrl || product.name || product.uploading));
      productClear.hidden = !hasProduct;
      productClear.disabled = !hasProduct || !!product?.uploading || !!state.luxuryAd.keyframeGenerating;
    }
    if (!host) return;
    const assets = luxuryAdReferenceAssets();
    const hasAnyAsset = assets.some(x => x && (x.url || x.previewUrl || x.name || x.uploading));
    if (!hasAnyAsset) {
      host.innerHTML = `<div class="dh-luxgen-asset ghost">开场</div>
        <div class="dh-luxgen-asset ghost">近景</div>
        <div class="dh-luxgen-asset ghost">远景</div>
        <div class="dh-luxgen-asset ghost">+</div>`;
      return;
    }
    const slotCount = Math.min(8, Math.max(4, assets.length));
    host.innerHTML = Array.from({ length: slotCount }, (_, i) => {
      const img = assets[i] || null;
      const url = img ? luxuryAssetPreviewUrl(img) : '';
      return img
        ? `<button type="button" class="dh-luxgen-asset ${img.uploading ? 'uploading' : ''}" data-lux-asset-preview="${i}" title="点击预览第 ${i + 1} 镜画面：${escapeHtml(img.name || `分镜画面 ${i + 1}`)}">
            ${url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(img.name || `分镜画面 ${i + 1}`)}">` : ''}
            <b>${String(i + 1)}</b>${img.failed ? '<span>上传失败</span>' : (img.uploading ? '<span>上传中</span>' : '')}
          </button>`
        : `<div class="dh-luxgen-asset ghost">${String(i + 1)}</div>`;
    }).join('');
  }

  function selectedAvatarImageUrl(a = state.selectedAvatar || {}) {
    return a.image_url || a.photo_url || a.cover_url || a.thumbnail_url || (a.id ? `/api/dh/my-avatars/${a.id}/thumbnail` : '');
  }

  const LUXURY_PERSON_SPEC_LABELS = {
    castMode: {
      auto: 'AI 按内容判断',
      single: '单人',
      dual: '双人对话',
      group: '多人 / 群体',
    },
    origin: {
      east_asian_cn: '中国 / 东亚面孔',
      southeast_asian: '东南亚',
      white_european: '欧美白人',
      black_african: '非洲裔 / 黑人',
      middle_eastern: '中东',
      south_asian: '南亚',
      latino: '拉美',
      mixed_global: '多种族 / 国际化',
      match_brief: '按广告需求判断',
    },
    gender: {
      auto: 'AI 按故事判断',
      male: '男性',
      female: '女性',
      mixed: '双人/多人混合',
      all_male: '双人/多人全男性',
      all_female: '双人/多人全女性',
    },
    age: {
      match_brief: '按广告需求判断',
      infant_0_1: '婴儿 / 0-1',
      toddler_1_3: '幼儿 / 1-3',
      child_4_7: '儿童 / 4-7',
      child_8_12: '少儿 / 8-12',
      teen_13_17: '青少年 / 13-17',
      young_adult: '青年 / 25-32',
      adult_30_40: '成熟青年 / 30-40',
      middle_40_55: '中年 / 40-55',
      senior_55_plus: '年长 / 55+',
    },
  };

  function luxuryAdPersonSpec() {
    state.luxuryAd.personSpec = {
      castMode: 'auto',
      gender: 'auto',
      age: 'match_brief',
      origin: 'east_asian_cn',
      ...(state.luxuryAd.personSpec || {}),
    };
    return state.luxuryAd.personSpec;
  }

  function syncLuxuryPersonSpecControls() {
    const spec = luxuryAdPersonSpec();
    const lock = state.luxuryAd.personSpecLock || null;
    $$('[data-lux-person-spec]').forEach(el => {
      const field = el.dataset.luxPersonSpec;
      if (!field) return;
      el.value = spec[field] || '';
      const locked = !!(lock && (field === 'castMode' || field === 'gender' || field === 'origin' || field === 'age') && (field !== 'origin' || lock.origin) && (field !== 'age' || lock.age));
      el.disabled = locked;
      el.title = locked ? `已按人物一致性参考「${lock.source || '演员'}」锁定；如需更改，请重新选择或上传真人参考。` : '';
    });
  }

  function luxuryAdPersonDescription(specOverride = null) {
    const spec = specOverride || luxuryAdPersonSpec();
    const castMode = LUXURY_PERSON_SPEC_LABELS.castMode[spec.castMode] || spec.castMode || '单人';
    const gender = LUXURY_PERSON_SPEC_LABELS.gender[spec.gender] || String(spec.gender || '').trim() || 'AI 按故事判断';
    const age = LUXURY_PERSON_SPEC_LABELS.age[spec.age] || String(spec.age || '').trim() || '按广告需求判断';
    const origin = LUXURY_PERSON_SPEC_LABELS.origin[spec.origin] || String(spec.origin || '').trim() || '按广告需求判断';
    const referencePerson = selectedAvatarImageUrl(state.selectedAvatar || {}) ? (state.selectedAvatar?.name || '已选数字人形象') : '';
    return [
      `人物数量：${castMode}`,
      `人物性别：${gender}`,
      `人物年龄：${age}`,
      `地域/种族：${origin}`,
      referencePerson ? `参考数字人形象：${referencePerson}` : '',
      'AI 生成只作为拟真演员参考；需要真人请上传真人照片或使用授权真人演员素材。',
      '姓名、五官、发型、服装、道具、气质、动作和妆造必须由 AI 在剧本人物表里生成。',
    ].filter(Boolean).join('；');
  }

  function luxuryAdPersonGenerationSpec() {
    const spec = { ...luxuryAdPersonSpec() };
    const current = state.luxuryAd.personAsset || null;
    if (current && luxuryAdActorReferenceKind(current) === 'ai_generated') {
      spec.gender = 'auto';
      spec.origin = spec.origin || 'east_asian_cn';
    }
    return spec;
  }

  function luxuryPersonGenderLabel(value = '') {
    const raw = String(value || '').replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    const key = raw.toLowerCase();
    if (LUXURY_PERSON_SPEC_LABELS.gender[key]) return LUXURY_PERSON_SPEC_LABELS.gender[key];
    if (/^female$|woman|girl|女/.test(key)) return '女性';
    if (/^male$|man|boy|男/.test(key)) return '男性';
    if (/mixed|both|混合|男女/.test(key)) return '混合性别';
    return raw;
  }

  function luxuryPersonOriginLabel(value = '') {
    const raw = String(value || '').replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    const key = raw.toLowerCase();
    if (LUXURY_PERSON_SPEC_LABELS.origin[key]) return LUXURY_PERSON_SPEC_LABELS.origin[key];
    if (/east[_\s-]?asian|asian[_\s-]?cn|china|chinese|中国|东亚/.test(key)) return '中国 / 东亚面孔';
    if (/southeast/.test(key)) return '东南亚';
    if (/white|european|caucasian/.test(key)) return '欧美白人';
    if (/black|african/.test(key)) return '非洲裔 / 黑人';
    if (/middle[_\s-]?eastern/.test(key)) return '中东';
    if (/south[_\s-]?asian/.test(key)) return '南亚';
    if (/latino|latin/.test(key)) return '拉美';
    return raw;
  }

  function luxuryPersonAgeSpecValue(value = '') {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (/infant|baby|newborn|0[_\s-]?1|婴儿|宝宝|新生儿|母婴|奶粉|乳制品/.test(raw)) return 'infant_0_1';
    if (/toddler|1[_\s-]?3|幼儿/.test(raw)) return 'toddler_1_3';
    if (/child[_\s-]?4|4[_\s-]?7|儿童|小孩/.test(raw)) return 'child_4_7';
    if (/child[_\s-]?8|8[_\s-]?12|少儿|小学生/.test(raw)) return 'child_8_12';
    if (/teen|13[_\s-]?17|青少年|少年|少女|中学生/.test(raw)) return 'teen_13_17';
    if (/young[_\s-]?adult|25|26|27|28|29|30|31|32|青年|年轻/.test(raw)) return 'young_adult';
    if (/adult[_\s-]?30|30[_\s-]?40|33|34|35|36|37|38|39|成熟青年/.test(raw)) return 'adult_30_40';
    if (/middle|40|45|50|55|中年/.test(raw)) return 'middle_40_55';
    if (/senior|55|60|65|年长|老年/.test(raw)) return 'senior_55_plus';
    if (/match|auto|brief|按/.test(raw)) return 'match_brief';
    return '';
  }

  function luxuryPersonGenderSpecValue(value = '') {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (/^(male|man|adult_man|男性|男士|男人|男)$/.test(raw) || /\bmale\b|man|男/.test(raw)) return 'male';
    if (/^(female|woman|adult_woman|女性|女士|女人|女)$/.test(raw) || /\bfemale\b|woman|女/.test(raw)) return 'female';
    if (/mixed|both|混合|男女/.test(raw)) return 'mixed';
    return '';
  }

  function luxuryPersonConfirmedGender(...values) {
    for (const value of values) {
      const gender = luxuryPersonGenderSpecValue(value);
      if (gender === 'male' || gender === 'female') return gender;
    }
    return '';
  }

  function luxuryPersonOriginSpecValue(value = '') {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (/east[_\s-]?asian|asian[_\s-]?cn|china|chinese|中国|东亚/.test(raw)) return 'east_asian_cn';
    if (/southeast/.test(raw)) return 'southeast_asian';
    if (/white|european|caucasian/.test(raw)) return 'white_european';
    if (/black|african/.test(raw)) return 'black_african';
    if (/middle[_\s-]?eastern/.test(raw)) return 'middle_eastern';
    if (/south[_\s-]?asian/.test(raw)) return 'south_asian';
    if (/latino|latin/.test(raw)) return 'latino';
    return '';
  }

  function luxuryAdActorReferenceKind(asset = {}) {
    const source = String(asset.source || asset.metadata?.source || '').toLowerCase();
    const kind = String(asset.reference_kind || asset.metadata?.reference_kind || '').toLowerCase();
    const text = [asset.name, asset.description, asset.metadata?.name, asset.metadata?.prompt, kind]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (/real_photo|uploaded_photo|human_photo/.test(kind)) return 'real_photo';
    if (/synthetic_realistic_actor|generated_real_actor|realistic_actor/.test(kind)) return 'synthetic_realistic_actor';
    if (/ai_generated/.test(kind)) return 'ai_generated';
    if (/uploaded|真人照片|real_photo|human_photo/.test(source)) return 'real_photo';
    if (/local_actor_library_generated/.test(source) || /fixed real actor asset|realistic actor|真人感演员|真人演员包/.test(text)) return 'synthetic_realistic_actor';
    if (/generated|ai|person_sheet/.test(source)) return 'ai_generated';
    return kind || 'unknown';
  }

  function luxuryAdActorReferenceLabel(asset = {}) {
    const kind = luxuryAdActorReferenceKind(asset);
    if (kind === 'real_photo') return '真人照片参考';
    if (kind === 'synthetic_realistic_actor') return 'AI 真人感演员包';
    if (kind === 'ai_generated') return 'AI 拟真演员参考';
    return '演员参考';
  }

  function luxuryAdActorIsAiGenerated(asset = {}) {
    return luxuryAdActorReferenceKind(asset) === 'ai_generated';
  }

  function luxuryAdActorIsRealPerson(asset = {}) {
    if (!asset || typeof asset !== 'object') return false;
    const metadata = asset.metadata || {};
    const source = String(asset.source || metadata.source || asset.type || '').toLowerCase();
    const kind = String(luxuryAdActorReferenceKind(asset) || '').toLowerCase();
    const tags = Array.isArray(asset.tags)
      ? asset.tags.join(' ')
      : Array.isArray(metadata.tags)
        ? metadata.tags.join(' ')
        : '';
    const text = [source, kind, tags, asset.name, asset.description, metadata.reference_kind]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (asset.is_ai_generated === true || metadata.is_ai_generated === true || kind === 'ai_generated') return false;
    return /real_photo|uploaded_photo|uploaded_person_reference|human_photo|authorized_real_actor|licensed_actor|真人照片|授权真人|真人演员/.test(text);
  }

  function luxuryAdActorIsSyntheticRealistic(asset = {}) {
    return luxuryAdActorReferenceKind(asset) === 'synthetic_realistic_actor'
      || asset.production_usable_actor === true
      || asset.metadata?.production_usable_actor === true;
  }

  function luxuryAdActorUsableForKeyframes(asset = {}) {
    return luxuryAdActorIsRealPerson(asset) || luxuryAdActorIsSyntheticRealistic(asset);
  }

  function compactLuxuryErrorReceipt(receipt = null) {
    if (!receipt || typeof receipt !== 'object') return null;
    const clone = JSON.parse(JSON.stringify(receipt));
    if (clone.request?.headers?.Authorization) clone.request.headers.Authorization = '[hidden]';
    if (clone.token) clone.token = '[hidden]';
    return clone;
  }

  function renderLuxuryFullErrorReceipt(receipt = null, title = '完整错误回执') {
    const safe = compactLuxuryErrorReceipt(receipt);
    if (!safe) return '';
    let json = '';
    try { json = JSON.stringify(safe, null, 2); } catch { json = String(safe); }
    return `<details class="dh-lux-error-receipt">
      <summary>${escapeHtml(title)}</summary>
      <pre>${escapeHtml(json)}</pre>
    </details>`;
  }

  function applyLuxuryPersonAssetConstraints(asset = {}) {
    if (!asset || typeof asset !== 'object') return;
    const metadata = asset.metadata || {};
    const spec = luxuryAdPersonSpec();
    const isRealPerson = luxuryAdActorReferenceKind(asset) === 'real_photo';
    const gender = luxuryPersonGenderSpecValue(asset.gender || metadata.gender || metadata.sex || asset.description || metadata.prompt || '');
    const age = luxuryPersonAgeSpecValue(asset.age || asset.age_range || metadata.age || metadata.age_range || metadata.prompt || asset.description || '');
    const origin = luxuryPersonOriginSpecValue(asset.origin || asset.region || asset.ethnicity || asset.race || metadata.origin || metadata.region || metadata.ethnicity || metadata.race || metadata.prompt || asset.description || '');
    const next = { ...spec, castMode: 'single' };
    if (gender) next.gender = gender;
    else if (isRealPerson) next.gender = 'auto';
    if (age) next.age = age;
    if (origin) next.origin = origin;
    state.luxuryAd.personSpec = next;
    state.luxuryAd.personSpecLock = {
      source: asset.name || asset.actor_asset_id || asset.id || '已选演员',
      actor_asset_id: asset.actor_asset_id || asset.asset_library_id || asset.material_id || asset.id || '',
      gender: gender || '',
      age: age || '',
      origin: origin || '',
      castMode: 'single',
      reference_kind: luxuryAdActorReferenceKind(asset),
    };
    syncLuxuryPersonSpecControls();
  }

  function ensureLuxuryPersonAssetConstraints() {
    const asset = state.luxuryAd.personAsset || null;
    if (!asset || asset.uploading || !(asset.url || asset.image_url || asset.previewUrl)) return;
    const actorKey = asset.actor_asset_id || asset.asset_library_id || asset.material_id || asset.id || '';
    if (!actorKey) return;
    const lockKey = state.luxuryAd.personSpecLock?.actor_asset_id || '';
    if (lockKey !== actorKey) applyLuxuryPersonAssetConstraints(asset);
  }

  function luxuryAdPersonAssetPayload() {
    const generated = state.luxuryAd.personAsset;
    if (generated && (generated.url || generated.image_url || generated.previewUrl)) {
      const referenceKind = luxuryAdActorReferenceKind(generated);
      const isAiGenerated = referenceKind === 'ai_generated';
      const isSyntheticActor = referenceKind === 'synthetic_realistic_actor'
        || generated.production_usable_actor === true
        || generated.metadata?.production_usable_actor === true;
      return {
        id: generated.id || 'luxury_ad_person_sheet',
        actor_asset_id: generated.actor_asset_id || generated.asset_library_id || generated.material_id || '',
        actor_id: generated.actor_id || generated.metadata?.actor_id || '',
        name: generated.name || (isSyntheticActor ? 'AI 真人感一致性演员' : (isAiGenerated ? 'AI 拟真演员三视图' : '真人照片参考')),
        type: generated.type || 'luxury_ad_character_sheet',
        source: generated.source || 'person_asset',
        reference_kind: referenceKind,
        is_ai_generated: isAiGenerated,
        production_usable_actor: isSyntheticActor,
        real_person_reference: referenceKind === 'real_photo',
        gender: luxuryPersonConfirmedGender(generated.detected_gender, generated.gender, generated.metadata?.detected_gender, generated.metadata?.gender),
        detected_gender: luxuryPersonConfirmedGender(generated.detected_gender, generated.metadata?.detected_gender),
        age: generated.age || generated.age_range || generated.metadata?.age || generated.metadata?.age_range || '',
        origin: generated.origin || generated.metadata?.origin || '',
        image_url: compactLuxuryUrl(generated.url || generated.image_url || generated.previewUrl || ''),
        extra_image_urls: Array.isArray(generated.extra_image_urls) ? generated.extra_image_urls.map(compactLuxuryUrl).filter(Boolean) : [],
        view_count: generated.view_count || 3,
        description: generated.spec_description || generated.description || luxuryAdPersonDescription(),
      };
    }
    const a = state.selectedAvatar;
    if (!a) return null;
    return {
      id: a.id || '',
      actor_asset_id: a.actor_asset_id || '',
      name: a.name || '已选人物',
      type: a.avatar_type || a.type || 'selected_avatar',
      source: a.source || 'selected_avatar',
      image_url: compactLuxuryUrl(selectedAvatarImageUrl(a)),
      extra_image_urls: Array.isArray(a.extra_image_urls) ? a.extra_image_urls.map(compactLuxuryUrl).filter(Boolean) : [],
      view_count: 1,
      description: a.description || a.prompt || '',
    };
  }

  function luxuryAdPersonDesignReady() {
    if (luxuryAdIsMaterialMode()) return true;
    const segments = Array.isArray(state.luxuryAd.segments) ? state.luxuryAd.segments : [];
    const brief = state.luxuryAd.briefInfo || {};
    return segments.length > 0 && !!(brief.title || brief.theme || state.luxuryAd.storyboardDetailed);
  }

  function luxuryAdPersonDesignGateMessage() {
    return '请先生成基础信息/人物设定，再生成 AI 真人感演员包';
  }

  function luxuryAdPersonContextPayload(specOverride = null) {
    const spec = specOverride || luxuryAdPersonSpec();
    const brief = state.luxuryAd.briefInfo || {};
    const segments = compactLuxurySegments(state.luxuryAd.segments || []);
    const source = state.luxuryAd.storyboardDetailed ? 'script_character_table' : (segments.length ? 'scene_config_person_draft' : 'brief_only');
    const personNotes = [
      luxuryAdPersonDescription(spec),
      brief.title ? `片名：${brief.title}` : '',
      brief.theme ? `主题：${brief.theme}` : '',
      brief.style ? `风格：${brief.style}` : '',
      ...segments.slice(0, 6).map((seg, i) => [
        `镜头${i + 1}`,
        seg.title || seg.story_stage || '',
        seg.content_prompt || seg.visual || seg.display_visual || '',
        seg.action || seg.visual_action || '',
        seg.narration || seg.voiceover || seg.subtitle || '',
      ].filter(Boolean).join('：')),
    ].filter(Boolean);
    return {
      source,
      brief_info: brief,
      person_spec: spec,
      person_notes: personNotes,
      scene_segments: segments.slice(0, 6),
      script_ready: !!state.luxuryAd.storyboardDetailed,
    };
  }

  function luxuryActorAssetUrls(asset = {}) {
    return [
      asset.image_url || asset.file_url || asset.url || '',
      ...(Array.isArray(asset.extra_image_urls) ? asset.extra_image_urls : []),
      ...(Array.isArray(asset.extra_images) ? asset.extra_images : []),
    ].map(compactLuxuryUrl).filter(Boolean);
  }

  function luxuryActorUrlsFromSources(...sources) {
    const urls = [];
    const push = value => {
      const url = compactLuxuryUrl(value || '');
      if (url && !urls.includes(url)) urls.push(url);
    };
    const walk = source => {
      if (!source) return;
      if (typeof source === 'string') return push(source);
      if (Array.isArray(source)) return source.forEach(walk);
      if (typeof source !== 'object') return;
      push(source.image_url || source.imageUrl || source.file_url || source.url || source.previewUrl || '');
      [
        source.extra_image_urls,
        source.extra_images,
        source.image_urls,
        source.images,
        source.views,
      ].forEach(walk);
      if (Array.isArray(source.outputs)) {
        source.outputs.forEach(item => push(item?.url || item?.image_url || item?.imageUrl || item?.file_url || ''));
      }
    };
    sources.forEach(walk);
    return urls;
  }

  function luxuryActorAssetViewLabel(index = 0) {
    return ['正面', '侧面/半侧', '动作'][Number(index) || 0] || `参考 ${Number(index) + 1}`;
  }

  function luxuryPersonGenerationErrorExplanation(error = {}) {
    const code = String(error.code || error.reason || '').toUpperCase();
    const msg = String(error.message || error.error || '');
    const raw = JSON.stringify(error.raw || error.details || error || {});
    const text = `${code} ${msg} ${raw}`;
    if (/AUDITSUBMITILLEGAL|SUBMIT\s+IS\s+ILLEGAL|审核|敏感|ILLEGAL/i.test(text)) {
      return '模型平台提交审核拒绝：通常是人物描述、参考图或提示词触发了平台内容审核。需要调整人物描述/参考图后重新生成。';
    }
    if (/LUXURY_ACTOR_FRAME_ORIENTATION_FAILED|不是竖构图|landscape_or_not_vertical|9:16/i.test(text)) {
      return '演员包构图质检未通过：模型返回了横图或非竖向演员定妆照，容易只露半身；系统已拒绝入库。';
    }
    if (/LUXURY_ACTOR_FRAMING_QA_FAILED|构图 QA|FRAMING_QA|LOWER_BODY|TROUSERS|GARMENT|半身|头像|WAIST_UP|BUST|HEADSHOT/i.test(text)) {
      return '演员包构图质检未通过：系统检测到人物仍是头像/半身，或看不到裤子/裙子等下半身证据，因此没有写入演员库。请重新生成或调整模型链路。';
    }
    if (/PANXXXO100IFR|INTERNAL SERVER ERROR|CODE=500|HTTP\s*500/i.test(text)) {
      return '上游图片模型返回 500：不是前端缓存问题，通常是该模型通道内部错误或当前参数组合不被通道接受。需要查看完整错误回执和模型链路。';
    }
    if (/NO_IMAGE|没有返回图片|未返回图片|RETURNED NO IMAGE/i.test(text)) {
      return '模型请求完成但没有返回可用图片：说明本次通道没有产出可入库的演员图，不能继续当作人物锁。';
    }
    if (/UNAUTH|401|LOGIN/i.test(text)) {
      return '登录态或权限异常：请刷新后确认账号仍有访问人物演员包接口的权限。';
    }
    if (/TIMEOUT|超时/i.test(text)) {
      return '模型生成超时：人物包需要连续生成多张参考图，当前通道耗时过长未完成。';
    }
    return '人物演员包生成失败：请展开完整错误回执查看具体模型、状态码和返回内容。';
  }

  function luxuryPersonGenerationUserAction(error = {}) {
    const code = String(error.code || '').toUpperCase();
    const msg = String(error.message || error.error || '');
    const raw = JSON.stringify(error.raw || error.details || error || {});
    const text = `${code} ${msg} ${raw}`;
    // 中文说明：完整模型回执很长，只放在折叠详情；主界面只给用户能执行的中文结论。
    if (/LUXURY_ACTOR_FRAMING_QA_FAILED|LOWER_BODY|TROUSERS|GARMENT|BUST|HEADSHOT|WAIST_UP|半身|头像|胸像/i.test(text)) {
      return '这次不是系统继续乱跑，而是图片模型把演员画成了头像/胸像/半身，系统按商用人物锁规则拦截了。当前已改为单次失败即停止；请调整人物描述/参考图后重新生成。';
    }
    if (/AUDITSUBMITILLEGAL|SUBMIT\s+IS\s+ILLEGAL|审核|ILLEGAL/i.test(text)) {
      return '当前人物描述或参考图被上游平台审核拒绝。请把人物描述改得更中性，或换一张参考图后重试。';
    }
    if (/MODEL_NOT_CONFIGURED|未在模型调用管理|候选/i.test(text)) {
      return '人物包模型链路没有可运行图片模型，请先到模型调用管理启用 luxury_ad.person_sheet 的图片模型。';
    }
    if (/500|INTERNAL SERVER ERROR|NO_IMAGE|未返回图片|没有返回图片/i.test(text)) {
      return '上游图片通道没有产出可用演员图。系统不会把失败图写入演员库，可以切换模型或直接重试。';
    }
    return '系统没有把失败结果写入演员库。完整模型链路已折叠在下方，方便排查供应商或 QA 原因。';
  }

  function luxuryPersonFailedCandidates(error = {}) {
    const attempts = [
      ...(Array.isArray(error.details?.attempts) ? error.details.attempts : []),
      ...(Array.isArray(error.raw?.details?.attempts) ? error.raw.details.attempts : []),
      ...(Array.isArray(error.raw?.attempts) ? error.raw.attempts : []),
    ];
    const seen = new Set();
    return attempts.map((a, i) => {
      const url = compactLuxuryUrl(a.candidate_url || a.image_url || a.url || '');
      if (!url || seen.has(url)) return null;
      seen.add(url);
      return {
        index: i,
        url,
        label: a.candidate_label || a.retry || '失败候选图',
        provider: [a.provider_id || a.provider, a.model_id || a.model].filter(Boolean).join('/'),
        reason: a.qa?.reason || a.qa?.observed || a.error || '',
      };
    }).filter(Boolean).slice(0, 8);
  }

  function renderLuxuryPersonFailedCandidates(error = {}) {
    const candidates = luxuryPersonFailedCandidates(error);
    if (!candidates.length) {
      return `<div class="dh-lux-person-candidates dh-lux-person-candidates-empty">
        <b>本次没有可保留候选图</b>
        <small>上游审核拒绝或生成结果没有返回可访问图片，系统没有把失败图写入演员库。请重新生成，或上传真人参考/角色素材后继续。</small>
      </div>`;
    }
    // 中文说明：失败候选图只能人工选择保留，不能自动冒充 QA 通过的商用演员包。
    return `<div class="dh-lux-person-candidates">
      <b>可预览失败候选图</b>
      <div>${candidates.map((item, i) => `<article>
        <button type="button" data-lux-person-failed-preview="${i}" title="预览候选图"><img src="${escapeHtml(withAuthQuery(item.url))}" alt="${escapeHtml(item.label)}"></button>
        <span>${escapeHtml(item.provider || item.label)}</span>
        <small>${escapeHtml(String(item.reason || '').slice(0, 90))}</small>
        <button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-lux-person-failed-adopt="${i}">保留为人物参考</button>
      </article>`).join('')}</div>
    </div>`;
  }

  function luxuryPersonGenerationProgressHtml() {
    const progress = state.luxuryAd.personGenerationProgress;
    if (!progress || !progress.active) return '';
    const pct = Math.max(6, Math.min(96, Math.round(Number(progress.percent) || 6)));
    return `<div class="dh-lux-person-progress">
      <div class="dh-lux-person-progress-head">
        <b>${escapeHtml(progress.label || '正在生成演员包')}</b>
        <span>${pct}%</span>
      </div>
      <div class="dh-lux-person-progress-track" aria-hidden="true"><i style="width:${pct}%"></i></div>
      <small>${escapeHtml(progress.phase || '准备生成')} · ${escapeHtml(progress.message || '正在生成正面、侧面/半侧和动作参考图。')}</small>
    </div>`;
  }

  function luxuryActorMaterialToPersonAsset(asset = {}) {
    const urls = luxuryActorAssetUrls(asset);
    const metadata = asset.metadata || {};
    const source = asset.source || metadata.source || '';
    const explicitKind = String(asset.reference_kind || metadata.reference_kind || '').toLowerCase();
    let referenceKind = explicitKind || 'unknown';
    if (/real_photo|uploaded_photo|human_photo/i.test(explicitKind) || /uploaded|real_photo|human_photo/i.test(source)) {
      referenceKind = 'real_photo';
    } else if (/synthetic_realistic_actor|generated_real_actor|realistic_actor/i.test(explicitKind) || /local_actor_library_generated/i.test(source)) {
      referenceKind = 'synthetic_realistic_actor';
    } else if (/ai_generated/i.test(explicitKind) || /generated|ai/i.test(source)) {
      referenceKind = 'ai_generated';
    }
    return {
      id: asset.id || '',
      actor_asset_id: asset.actor_asset_id || metadata.actor_asset_id || asset.id || '',
      actor_id: asset.actor_id || metadata.actor_id || '',
      material_id: asset.id || '',
      name: asset.name || '角色素材',
      type: 'actor_material',
      source: source || 'actor_library',
      reference_kind: referenceKind,
      is_ai_generated: referenceKind === 'ai_generated',
      production_usable_actor: referenceKind === 'synthetic_realistic_actor' || asset.production_usable_actor === true || metadata.production_usable_actor === true,
      gender: asset.gender || metadata.gender || '',
      origin: asset.origin || asset.region || asset.ethnicity || metadata.origin || metadata.region || metadata.ethnicity || metadata.race || '',
      metadata,
      url: urls[0] || '',
      image_url: urls[0] || '',
      previewUrl: urls[0] || '',
      extra_image_urls: urls.slice(1),
      view_count: Number(asset.view_count || urls.length) || 1,
      description: asset.description || asset.metadata?.description || '',
    };
  }

  async function persistLuxuryPersonAssetToLibrary(asset = {}, source = 'luxury_ad') {
    const url = compactLuxuryUrl(asset.image_url || asset.url || asset.previewUrl || '');
    if (!url || /^blob:/i.test(url) || asset.actor_asset_id || asset.asset_library_id) return null;
    try {
      const body = {
        type: 'character',
        name: asset.name || '剧情广告演员',
        image_url: url,
        extra_image_urls: Array.isArray(asset.extra_image_urls) ? asset.extra_image_urls.map(compactLuxuryUrl).filter(Boolean) : [],
        view_count: Number(asset.view_count || 1) || 1,
        source,
        description: asset.spec_description || asset.description || luxuryAdPersonDescription(),
        tags: ['剧情广告', '演员'],
        metadata: {
          role: 'actor',
          from: source,
          reference_kind: asset.reference_kind || (source === 'uploaded_person_reference' ? 'real_photo' : 'ai_generated'),
          source: asset.source || source,
          gender: asset.gender || '',
          origin: asset.origin || '',
          is_ai_generated: !!asset.is_ai_generated,
          person_spec: luxuryAdPersonSpec(),
        },
      };
      const r = await api('/api/assets', { method: 'POST', body });
      const saved = r?.data || null;
      if (saved?.id && state.luxuryAd.personAsset && (state.luxuryAd.personAsset.image_url || state.luxuryAd.personAsset.url) === url) {
        state.luxuryAd.personAsset = {
          ...state.luxuryAd.personAsset,
          actor_asset_id: saved.id,
          asset_library_id: saved.id,
          material_id: saved.id,
          source: 'actor_library',
        };
        renderLuxuryAdPerson();
      }
      return saved;
    } catch (err) {
      console.warn('[luxuryAd] save actor asset failed:', err.message || err);
      return null;
    }
  }

  async function openLuxuryAdActorLibrary() {
    let items = [];
    try {
      const r = await api('/api/assets?type=character');
      items = Array.isArray(r?.data) ? r.data : [];
    } catch (err) {
      return toast('角色素材库加载失败：' + err.message, 'error');
    }
    const old = document.getElementById('__dh_lux_actor_library');
    if (old) old.remove();
    const mask = document.createElement('div');
    mask.id = '__dh_lux_actor_library';
    mask.style.cssText = 'position:fixed;inset:0;z-index:19000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:24px';
    const cards = items.length ? items.map(asset => {
      const urls = luxuryActorAssetUrls(asset);
      const thumb = urls[0] || '';
      const refLabel = luxuryAdActorReferenceLabel(asset);
      const genderLabel = luxuryPersonGenderLabel(asset.gender || asset.metadata?.gender || '');
      const ageLabel = LUXURY_PERSON_SPEC_LABELS.age[luxuryPersonAgeSpecValue(asset.age || asset.age_range || asset.metadata?.age || asset.metadata?.age_range || '')] || '';
      return `<button type="button" data-lux-actor-material="${escapeHtml(asset.id)}" style="display:flex;gap:10px;text-align:left;align-items:center;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#fff;border-radius:10px;padding:10px;min-height:86px">
        <span style="width:64px;height:64px;border-radius:8px;overflow:hidden;background:#1b2230;display:flex;align-items:center;justify-content:center;flex-shrink:0">${thumb ? `<img src="${escapeHtml(withAuthQuery(thumb))}" alt="" style="width:100%;height:100%;object-fit:cover">` : '角色'}</span>
        <span style="min-width:0;display:block">
          <b style="display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(asset.name || '角色素材')}</b>
          <small style="display:block;margin-top:4px;color:rgba(255,255,255,.66);line-height:1.35">${escapeHtml([refLabel, genderLabel, ageLabel, `${urls.length || 1} 张参考图`].filter(Boolean).join(' · '))}<br>${escapeHtml(asset.description || '可作为剧情广告人物一致性参考')}</small>
        </span>
      </button>`;
    }).join('') : '<div style="padding:28px;text-align:center;color:rgba(255,255,255,.72)">角色素材库还没有可用演员。先上传真人参考或生成 AI 真人感演员包后会自动入库。</div>';
    mask.innerHTML = `<div style="width:min(760px,94vw);max-height:82vh;overflow:hidden;background:#111318;border:1px solid rgba(255,255,255,.14);border-radius:14px;color:#fff;box-shadow:0 18px 60px rgba(0,0,0,.45);display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1)">
        <div><b>角色素材库</b><div style="font-size:12px;color:rgba(255,255,255,.62);margin-top:3px">选择一个人物一致性参考，后续剧本、分镜和关键帧会使用同一个 actor_id。</div></div>
        <button type="button" data-lux-actor-close style="border:0;background:transparent;color:#fff;font-size:20px;cursor:pointer">×</button>
      </div>
      <div style="padding:14px;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">${cards}</div>
    </div>`;
    document.body.appendChild(mask);
    const close = () => mask.remove();
    mask.addEventListener('click', e => {
      if (e.target === mask || e.target.closest('[data-lux-actor-close]')) return close();
      const btn = e.target.closest('[data-lux-actor-material]');
      if (!btn) return;
      const asset = items.find(x => x.id === btn.dataset.luxActorMaterial);
      if (!asset) return;
      state.selectedAvatar = null;
      state.luxuryAd.personAsset = luxuryActorMaterialToPersonAsset(asset);
      applyLuxuryPersonAssetConstraints(state.luxuryAd.personAsset);
      state.luxuryAd.keyframes = [];
      renderLuxuryAdPerson();
      renderLuxuryAdStoryboard();
      updateLuxuryAdStepLocks();
      close();
      const gender = luxuryPersonGenderLabel(luxuryPersonConfirmedGender(
        state.luxuryAd.personAsset.detected_gender,
        state.luxuryAd.personAsset.gender,
        state.luxuryAd.personSpecLock?.gender,
      ));
      const age = LUXURY_PERSON_SPEC_LABELS.age[state.luxuryAd.personSpecLock?.age || state.luxuryAd.personAsset.age || ''] || '';
      toast(`已选择角色素材「${asset.name || '演员'}」${[gender ? `人物性别已同步为${gender}` : '', age ? `年龄已同步为${age}` : ''].filter(Boolean).join('，')}`, 'success');
    });
  }

  function renderLuxuryAdPerson() {
    const host = $('#dhLuxAdPersonCurrent');
    ensureLuxuryPersonAssetConstraints();
    syncLuxuryPersonSpecControls();
    renderLuxuryAdPostScriptPerson();
    if (!host) return;
    const generated = state.luxuryAd.personAsset;
    if (generated && (generated.url || generated.image_url || generated.previewUrl || generated.uploading || generated.failed)) {
      const src = generated.url || generated.image_url || generated.previewUrl || '';
      const actorUrls = luxuryActorAssetUrls(generated);
      const actorId = generated.actor_asset_id || generated.asset_library_id || generated.material_id || '';
      const isAiActor = luxuryAdActorIsAiGenerated(generated);
      const isSyntheticActor = luxuryAdActorIsSyntheticRealistic(generated);
      const isRealActor = luxuryAdActorIsRealPerson(generated) || luxuryAdActorReferenceKind(generated) === 'real_photo';
      const genderText = generated.gender
        ? `性别：${luxuryPersonGenderLabel(generated.gender)}`
        : (isRealActor ? '性别：按真人照片参考' : '');
      const ageText = generated.age || generated.age_range
        ? `年龄：${LUXURY_PERSON_SPEC_LABELS.age[luxuryPersonAgeSpecValue(generated.age || generated.age_range)] || generated.age || generated.age_range}`
        : '';
      const actorMeta = [
        generated.source ? luxuryAdActorReferenceLabel(generated) : '',
        actorId ? '已绑定 actor_id' : '',
        actorUrls.length ? `${actorUrls.length} 张演员参考` : '',
        genderText,
        ageText,
      ].filter(Boolean).join(' · ');
      const defaultName = isSyntheticActor ? 'AI 真人感一致性演员' : (isAiActor ? 'AI 拟真演员三视图' : '真人照片参考');
      const defaultDesc = isSyntheticActor
        ? '这是按广告需求、剧本人物表和分镜上下文生成的真人感一致性演员，会作为后续分镜的人物一致性锁。'
        : isAiActor
        ? '这是 AI 生成的拟真演员参考，不等同于真实真人照片。需要真人请上传真人照片或使用授权真人演员素材。'
        : '真人照片参考会作为广告人物身份和气质锁定。';
      const realPersonWarning = isAiActor
        ? '<div style="margin-top:8px;padding:8px 10px;border:1px solid rgba(255,184,76,.5);border-radius:8px;color:#ffd28a;background:rgba(255,184,76,.08);font-size:12px;line-height:1.5">非真人素材：只能作为 AI 拟真参考，真实关键帧会要求真人照片或授权真人演员。</div>'
        : '';
      const errorHtml = generated.failed && state.luxuryAd.personGenerationError
        ? `<div class="dh-lux-person-error"><b>人物演员包生成失败</b><span>${escapeHtml(luxuryPersonGenerationErrorExplanation(state.luxuryAd.personGenerationError))}</span><small>${escapeHtml(luxuryPersonGenerationUserAction(state.luxuryAd.personGenerationError))}</small>${renderLuxuryPersonFailedCandidates(state.luxuryAd.personGenerationError)}${renderLuxuryFullErrorReceipt(state.luxuryAd.personGenerationError, '人物接口完整错误回执')}</div>`
        : '';
      const loadingText = isSyntheticActor ? '正在按角色库标准生成正面、侧面和动作演员照。' : (isAiActor ? '正在生成正面、侧面、背面三视图。' : '真人照片上传中。');
      const progressHtml = generated.uploading ? luxuryPersonGenerationProgressHtml() : '';
      const previewButtons = actorUrls.length
        ? `<div class="dh-lux-actor-views">${actorUrls.slice(0, 6).map((url, i) => `<button type="button" data-lux-person-preview="${i}" title="预览${escapeHtml(luxuryActorAssetViewLabel(i))}">
            <img src="${escapeHtml(withAuthQuery(url))}" alt="${escapeHtml(luxuryActorAssetViewLabel(i))}">
            <span>${escapeHtml(luxuryActorAssetViewLabel(i))}</span>
          </button>`).join('')}</div>`
        : '';
      host.innerHTML = `<div class="dh-luxgen-character-sheet ${generated.failed ? 'is-failed' : ''}">
        ${src ? `<button type="button" class="dh-lux-actor-main-preview" data-lux-person-preview="0" title="点击预览演员参考图"><img src="${escapeHtml(withAuthQuery(src))}" alt="${escapeHtml(generated.name || defaultName)}"></button>` : '<div class="dh-luxgen-person-thumb">生成中</div>'}
        <b>${escapeHtml(generated.name || defaultName)}</b>
        <small>${escapeHtml(generated.uploading ? loadingText : (actorMeta || generated.description || defaultDesc))}</small>
        ${progressHtml}
        ${previewButtons}
        ${realPersonWarning}
        ${errorHtml}
      </div>`;
      return;
    }
    const a = state.selectedAvatar;
    if (!a) {
      host.innerHTML = `<span>未选</span><div class="dh-luxgen-person-copy"><b>可不选人物</b><small>先生成基础信息/人物设定后可生成 AI 真人感演员包；真人请上传照片或选授权演员。</small></div>`;
      return;
    }
    const src = selectedAvatarImageUrl(a);
    const isVideo = !!(a.sample_video_url || a.video_url);
    host.innerHTML = `<div class="dh-luxgen-person-thumb">${src ? `<img src="${escapeHtml(withAuthQuery(src))}" alt="${escapeHtml(a.name || '人物形象')}" data-fallback-src="${escapeHtml(withAuthQuery(a.image_url || a.photo_url || ''))}" onerror="window.__dhAvatarImageFallback&&window.__dhAvatarImageFallback(this)">` : '已选'}</div>
      <div class="dh-luxgen-person-copy"><b>${escapeHtml(a.name || '已选人物')}</b><small>${isVideo ? '已选视频/动态素材，但剧情广告只取身份参考来重绘进镜头。' : '作为人物身份参考，生成分镜时会重绘融合到场景里。'}</small></div>`;
  }

  function renderLuxuryAdPersonSourceCopy() {
    const sourceWrap = document.querySelector('.dh-demo-person-source');
    const copy = sourceWrap?.querySelector('.dh-demo-copy');
    if (!copy) return;
    const asset = state.luxuryAd.personAsset || null;
    const isReal = asset && (luxuryAdActorIsRealPerson(asset) || luxuryAdActorReferenceKind(asset) === 'real_photo');
    const isAi = asset && luxuryAdActorIsAiGenerated(asset);
    copy.textContent = isReal
      ? '当前已使用真人照片参考，系统会按这张真人图锁定人物身份和气质；AI 演员包不会参与本次真人参考。'
      : isAi
        ? '当前是 AI 拟真演员参考，不等同于真人照片；需要真人广告请上传真人照片或选择授权真人演员。'
        : '用于锁定剧本人物数量、地域/种族、对白关系和后续分镜一致性；上传真人照片/授权演员才按真人参考处理。';
  }

  function renderLuxuryAdPostScriptPerson() {
    const host = $('#dhLuxAdPostScriptPerson');
    if (!host) return;
    host.hidden = false;
    renderLuxuryAdPersonSourceCopy();
  }

  function setLuxuryProgress(step = 'content') {
    const aliases = {
      assets: 'config',
      product: 'config',
      content: 'demand',
      copy: 'demand',
      storyboard: 'config',
      outline: 'config',
      frames: 'script',
      script: 'script',
      keyframes: 'storyboard',
      clips: 'storyboard',
      video: 'compose',
      final: 'compose',
    };
    const normalized = aliases[step] || step;
    const order = ['demand', 'config', 'script', 'storyboard', 'compose'];
    const activeIndex = Math.max(0, order.indexOf(normalized));
    $$('#dhLuxAdProgress > div').forEach((el, i) => el.classList.toggle('active', i <= activeIndex));
    const flowIndex = activeIndex;
    $$('.dh-luxgen-flow > span').forEach((el, i) => el.classList.toggle('active', i <= flowIndex));
  }

  function luxuryWorkflowProgressPhase(detail, elapsedSec) {
    const phases = detail
      ? [
          [0, '编剧梳理故事结构'],
          [35, '拆解每个镜头的画面和动作'],
          [95, '校验人物、对白和主体一致性'],
          [155, '审稿并整理剧本表'],
        ]
      : [
          [0, '解析广告需求和主体'],
          [8, '规划场景顺序'],
          [18, '整理素材和人物配置'],
          [30, '生成基础信息表'],
        ];
    let current = phases[0][1];
    phases.forEach(([sec, label]) => {
      if (elapsedSec >= sec) current = label;
    });
    return current;
  }

  function luxuryWorkflowProgressMarkup(progress) {
    if (!progress || !progress.active) return '';
    const rawPct = Math.round(Number(progress.percent) || 6);
    const pct = progress.done || rawPct >= 100 ? 100 : Math.max(6, Math.min(96, rawPct));
    return `
      <div class="dh-luxgen-live-head">
        <span>${escapeHtml(progress.label || '生成中')}</span>
        <b>${pct}%</b>
      </div>
      <div class="dh-luxgen-live-track" aria-hidden="true"><i style="width:${pct}%"></i></div>
      <div class="dh-luxgen-live-meta">
        <span>${escapeHtml(progress.phase || '正在生成')}</span>
        <small>${escapeHtml(progress.message || '请保持页面打开，完成后会自动进入下一步。')}</small>
      </div>`;
  }

  function renderLuxuryWorkflowProgressBox(box, progress) {
    if (!box) return;
    if (!progress || !progress.active) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = luxuryWorkflowProgressMarkup(progress);
  }

  function renderLuxuryWorkflowProgress() {
    const progress = state.luxuryAd.workflowProgress;
    renderLuxuryWorkflowProgressBox($('#dhLuxAdLiveProgress'), progress);
    renderLuxuryWorkflowProgressBox($('#dhLuxAdScriptProgress'), progress);
    renderLuxuryWorkflowProgressBox($('#dhLuxAdFrameProgress'), progress);
  }

  function formatLuxuryUsageCost(value, currency = 'usd') {
    const n = Number(value) || 0;
    if (currency === 'cny') return `¥${n.toFixed(n >= 1 ? 2 : 4)}`;
    return `$${n.toFixed(n >= 1 ? 4 : 6)}`;
  }

  function canViewLuxuryModelUsage() {
    const user = state.currentUser || null;
    const perms = Array.isArray(user?.effective_permissions) ? user.effective_permissions : [];
    if (user?.role === 'admin' || perms.includes('*')) return true;
    return perms.some(p => p === 'model_usage' || (typeof p === 'string' && p.startsWith('enterprise:model_usage:')));
  }

  function canViewLuxuryInternalPipeline() {
    const user = state.currentUser || null;
    const perms = Array.isArray(user?.effective_permissions) ? user.effective_permissions : [];
    if (user?.role === 'admin' || perms.includes('*')) return true;
    return perms.some(p => [
      'model_usage',
      'luxury_ad_debug',
      'luxury_ad_pipeline_debug',
    ].includes(p) || (typeof p === 'string' && (
      p.startsWith('enterprise:model_usage:')
      || p.startsWith('enterprise:luxury_ad_debug:')
      || p.startsWith('enterprise:luxury_ad_pipeline_debug:')
    )));
  }

  function luxuryUsageStepFromRequestKey(key = '') {
    const raw = String(key || '');
    if (raw.startsWith('outline_')) return 2;
    if (raw.startsWith('detail_')) return 3;
    if (raw.startsWith('keyframes_')) return 4;
    if (raw.startsWith('compose_') || raw.startsWith('submit_')) return 5;
    return Number(state.luxuryAd.currentStep || 1) || 1;
  }

  function mergeLuxuryUsageRows(...groups) {
    const seen = new Set();
    const merged = [];
    groups.flat().filter(Boolean).forEach(row => {
      const key = row.id || [row.request_id, row.agent_id, row.provider, row.model, row.created_at, row.input_tokens, row.output_tokens, row.cost_usd].join('|');
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(row);
    });
    return merged.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }

  function summarizeLuxuryUsageRows(rows = []) {
    const summary = rows.reduce((acc, r) => {
      acc.calls += 1;
      acc.input_tokens += Number(r.input_tokens) || 0;
      acc.output_tokens += Number(r.output_tokens) || 0;
      acc.total_tokens += Number(r.total_tokens) || 0;
      acc.image_count += Number(r.image_count) || 0;
      acc.cost_usd += Number(r.cost_usd) || 0;
      acc.cost_cny += Number(r.cost_cny) || 0;
      return acc;
    }, { calls: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, image_count: 0, cost_usd: 0, cost_cny: 0 });
    summary.cost_usd = Number(summary.cost_usd.toFixed(6));
    summary.cost_cny = Number(summary.cost_cny.toFixed(4));
    return summary;
  }

  function currentLuxuryUsageRows() {
    const step = Number(state.luxuryAd.currentStep || 1);
    return state.luxuryAd.usageByStep?.[step]?.rows || [];
  }

  function renderLuxuryAdUsage() {
    const box = $('#dhLuxAdUsagePanel');
    if (!box) return;
    if (!canViewLuxuryModelUsage()) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    const rows = currentLuxuryUsageRows();
    const summary = state.luxuryAd.usageTaskSummary || summarizeLuxuryUsageRows(state.luxuryAd.usageTaskRows || []);
    if (!rows.length && !(state.luxuryAd.usageTaskRows || []).length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    const totalTokens = Number(summary.total_tokens) || rows.reduce((s, r) => s + (Number(r.total_tokens) || 0), 0);
    const imageCount = Number(summary.image_count) || rows.reduce((s, r) => s + (Number(r.image_count) || 0), 0);
    const costUsd = Number(summary.cost_usd) || rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
    const costCny = Number(summary.cost_cny) || rows.reduce((s, r) => s + (Number(r.cost_cny) || 0), 0);
    const recent = rows.slice(0, 12).map(r => {
      const model = [r.provider, r.model].filter(Boolean).join('/');
      const tokens = Number(r.total_tokens) ? `${Number(r.input_tokens) || 0}+${Number(r.output_tokens) || 0} tok` : (Number(r.image_count) ? `${Number(r.image_count)} 张图` : '-');
      const stage = r.agent_id || r.operation || r.category || '-';
      return `
        <div class="dh-luxgen-usage-row">
          <b>${escapeHtml(stage)}</b>
          <code>${escapeHtml(model || '-')}</code>
          <span>${escapeHtml(tokens)}</span>
          <span>${formatLuxuryUsageCost(r.cost_cny, 'cny')}</span>
        </div>`;
    }).join('');
    const step = Number(state.luxuryAd.currentStep || 1);
    box.innerHTML = `
      <div class="dh-luxgen-usage-head">
        <span>本次模型消耗</span>
        <small>汇总为本次任务全量 · 下方为第 ${step} 步明细</small>
      </div>
      <div class="dh-luxgen-usage-grid">
        <div class="dh-luxgen-usage-card"><span>调用</span><b>${Number(summary.calls) || rows.length}</b></div>
        <div class="dh-luxgen-usage-card"><span>Token</span><b>${totalTokens}</b></div>
        <div class="dh-luxgen-usage-card"><span>图片</span><b>${imageCount}</b></div>
        <div class="dh-luxgen-usage-card"><span>费用</span><b>${formatLuxuryUsageCost(costCny, 'cny')} / ${formatLuxuryUsageCost(costUsd, 'usd')}</b></div>
      </div>
      <div class="dh-luxgen-usage-list">${recent || '<div class="dh-luxgen-usage-row"><b>当前阶段暂无调用</b><code>-</code><span>-</span><span>-</span></div>'}</div>`;
  }

  async function refreshLuxuryAdUsage(requestKey) {
    const key = String(requestKey || '').trim();
    if (!key || !canViewLuxuryModelUsage()) {
      renderLuxuryAdUsage();
      return;
    }
    try {
      const r = await api(`/api/dh/usage/recent?request_key=${encodeURIComponent(key)}&limit=80`);
      if (r?.success) {
        const step = luxuryUsageStepFromRequestKey(key);
        const rows = Array.isArray(r.rows) ? r.rows : [];
        state.luxuryAd.usageRows = rows;
        state.luxuryAd.usageSummary = r.summary || null;
        state.luxuryAd.usageByStep = state.luxuryAd.usageByStep || {};
        state.luxuryAd.usageByStep[step] = { rows, summary: r.summary || summarizeLuxuryUsageRows(rows), request_key: key };
        state.luxuryAd.usageRequestKeys = { ...(state.luxuryAd.usageRequestKeys || {}), [step]: key };
        state.luxuryAd.usageTaskRows = mergeLuxuryUsageRows(state.luxuryAd.usageTaskRows || [], rows);
        state.luxuryAd.usageTaskSummary = summarizeLuxuryUsageRows(state.luxuryAd.usageTaskRows);
        renderLuxuryAdUsage();
      }
    } catch (err) {
      if (err.status !== 403) console.warn('[luxuryAd] usage refresh failed:', err.message || err);
    }
  }

  function startLuxuryWorkflowProgress({ detail = false } = {}) {
    const startedAt = Date.now();
    const estimateSec = detail ? 210 : 38;
    const label = detail ? '剧本生成中' : '场景配置生成中';
    const tick = () => {
      const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const curved = 100 * (1 - Math.exp(-elapsedSec / (estimateSec * 0.58)));
      const percent = Math.min(92, Math.max(8, curved));
      state.luxuryAd.workflowProgress = {
        active: true,
        detail,
        startedAt,
        elapsedSec,
        percent,
        label,
        phase: luxuryWorkflowProgressPhase(detail, elapsedSec),
        message: detail
          ? '编剧、动作、镜头和审稿 agent 正在协同生成，人物数量/性别/对白会在链路内校验。'
          : '正在把一句话需求拆成基础信息、场景顺序和主体来源。'
      };
      renderLuxuryWorkflowProgress();
      updateLuxuryAdStepLocks();
    };
    tick();
    return setInterval(tick, 1000);
  }

  function updateLuxuryWorkflowProgress(message, percent) {
    if (!state.luxuryAd.workflowProgress) return;
    state.luxuryAd.workflowProgress = {
      ...state.luxuryAd.workflowProgress,
      percent: percent === undefined ? state.luxuryAd.workflowProgress.percent : percent,
      message,
    };
    renderLuxuryWorkflowProgress();
  }

  function updateLuxuryKeyframeWorkflowProgress({ current = 0, total = 1, startedAt = Date.now(), message = '' } = {}) {
    const elapsedSec = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    const doneRatio = total > 0 ? Math.max(0, Math.min(1, Number(current || 0) / total)) : 0;
    const timeCurve = 1 - Math.exp(-elapsedSec / 95);
    const percent = Math.min(96, Math.max(8, Math.round((doneRatio * 72) + (timeCurve * 18) + 8)));
    state.luxuryAd.workflowProgress = {
      active: true,
      detail: true,
      keyframes: true,
      startedAt,
      elapsedSec,
      percent,
      label: '分镜生成中',
      phase: current > 0 ? `正在处理第 ${Math.min(total, current + 1)} / ${total} 镜` : '准备逐镜生成',
      message: message || `正在按已确认剧本生成分镜：${current}/${total}。`,
    };
    renderLuxuryWorkflowProgress();
  }

  function stopLuxuryWorkflowProgress(timer) {
    if (timer) clearInterval(timer);
    state.luxuryAd.workflowProgress = null;
    renderLuxuryWorkflowProgress();
  }

  function reconcileLuxuryAdGenerationState() {
    const hasOutline = Array.isArray(state.luxuryAd.segments) && state.luxuryAd.segments.length > 0;
    const hasScript = hasOutline && !!state.luxuryAd.storyboardDetailed;
    let changed = false;
    if (hasOutline && state.luxuryAd.sceneGenerating) {
      state.luxuryAd.sceneGenerating = false;
      changed = true;
    }
    if (hasScript && state.luxuryAd.scriptGenerating) {
      state.luxuryAd.scriptGenerating = false;
      changed = true;
    }
    const progress = state.luxuryAd.workflowProgress;
    if (progress?.active && !progress.keyframes) {
      const progressIsDone = (progress.detail && hasScript) || (!progress.detail && hasOutline);
      if (progressIsDone || (!state.luxuryAd.sceneGenerating && !state.luxuryAd.scriptGenerating)) {
        state.luxuryAd.workflowProgress = null;
        changed = true;
      }
    }
    if (changed) renderLuxuryWorkflowProgress();
    return changed;
  }

  function updateLuxuryStoryStageHeading() {
    const pill = $('#dhLuxStoryStagePill');
    const title = $('#dhLuxStoryStageTitle');
    if (!pill || !title) return;
    const hasScript = !!state.luxuryAd.storyboardDetailed;
    const hasFrames = (state.luxuryAd.keyframes || []).some(k => k?.image_url || k?.imageUrl);
    if (hasFrames) {
      pill.textContent = '4';
      title.textContent = '分镜生成';
    } else if (hasScript) {
      pill.textContent = '3';
      title.textContent = '剧本生成';
    } else {
      pill.textContent = '2';
      title.textContent = '场景配置';
    }
  }

  function luxuryAdAssetSummary() {
    const product = state.luxuryAd.productAsset;
    const briefRefs = Array.isArray(state.luxuryAd.briefRefAssets) ? state.luxuryAd.briefRefAssets : [];
    const refs = luxuryAdReferenceAssets();
    return [
      product ? `主产品：${product.name || '已上传产品图'}` : '',
      ...briefRefs
      .map((x, i) => (x?.url || x?.previewUrl || x?.name) ? `需求参考图${i + 1}：${x.name || '已上传图片'}（由AI自动判断用途，不锁定分镜数）` : ''),
      ...refs
      .map((x, i) => (x?.url || x?.previewUrl || x?.name) ? `第${i + 1}镜画面：${x.name || '已上传图片'}` : '')
    ]
      .filter(Boolean)
      .join('；');
  }

  function parseLuxuryBriefTags(value) {
    if (Array.isArray(value)) return value.map(x => String(x || '').trim()).filter(Boolean).slice(0, 8);
    return String(value || '').split(/[，,、|/]/).map(x => x.trim()).filter(Boolean).slice(0, 8);
  }

  function normalizeLuxuryCharacterName(raw = '', fallback = '') {
    const value = String(raw || '').replace(/\s+/g, '').trim();
    return (value || fallback || '人物').slice(0, 12);
  }

  function normalizeLuxuryCharacterRole(raw = '', fallback = '') {
    return String(raw || fallback || '广告角色').replace(/\s+/g, ' ').trim().slice(0, 18);
  }

  function cleanLuxuryCharacterField(value = '') {
    const chunks = String(value || '')
      .replace(/\s+/g, ' ')
      .split(/[；;。]\s*/)
      .map(x => x.trim())
      .filter(Boolean);
    const seen = new Set();
    return chunks.filter(chunk => {
      if (/^(性别|地域\/?族裔|地域|民族|族裔)[:：]/.test(chunk)) return false;
      const key = chunk.replace(/[，,\s]/g, '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join('；').trim();
  }

  function luxuryCharacterTextFromObject(c = {}, fallbackIndex = 0) {
    if (!c || typeof c !== 'object') return null;
    const name = normalizeLuxuryCharacterName(c.name || c.character || c.label, fallbackIndex === 0 ? '讲解者' : '客户');
    const role = normalizeLuxuryCharacterRole(c.role || c.identity || c.job || c.position, fallbackIndex === 0 ? '主讲 / 引导者' : '客户 / 决策者');
    const gender = luxuryPersonGenderLabel(c.gender || c.sex || '');
    const origin = luxuryPersonOriginLabel(c.origin || c.nationality || c.region || c.from || c.hometown || c.ethnicity || c.race || c.face_type || '');
    const appearanceParts = [
      c.age || c.age_range ? `年龄：${c.age || c.age_range}` : '',
      c.ethnicity || c.race || c.face_type ? `面孔/种族：${c.ethnicity || c.race || c.face_type}` : '',
      c.face || c.facial_features ? `五官：${c.face || c.facial_features}` : '',
      c.hair || c.hairstyle ? `发型：${c.hair || c.hairstyle}` : '',
      c.body || c.body_type ? `身形：${c.body || c.body_type}` : '',
      cleanLuxuryCharacterField(c.appearance || c.look || c.visual_description || c.description || ''),
    ];
    const appearance = cleanLuxuryCharacterField(appearanceParts.filter(Boolean).join('；'));
    const outfit = cleanLuxuryCharacterField(c.outfit || c.clothing || c.wardrobe || '');
    const prop = cleanLuxuryCharacterField(c.prop || c.holding || c.hand_prop || c.handheld || c.accessory || c.accessories || '');
    const action = cleanLuxuryCharacterField(c.action || c.behavior || c.motion || '');
    return {
      name,
      role,
      gender,
      origin,
      description: [appearance, outfit ? `服装：${outfit}` : '', prop ? `手部/道具：${prop}` : '', action ? `动作习惯：${action}` : ''].filter(Boolean).join('；').slice(0, 220),
    };
  }

  function normalizeLuxuryCharacters(incoming = {}, segments = [], text = '') {
    const incomingCharacters = []
      .concat(Array.isArray(incoming.characters) ? incoming.characters : [])
      .concat(Array.isArray(incoming.character_profiles) ? incoming.character_profiles : []);
    const raw = incomingCharacters.length
      ? incomingCharacters
      : []
        .concat(...(Array.isArray(segments) ? segments.map(s => Array.isArray(s.characters) ? s.characters : []) : []))
        .concat(...(Array.isArray(segments) ? segments.map(s => Array.isArray(s.character_profiles) ? s.character_profiles : []) : []));
    const seen = new Set();
    const normalized = raw
      .map((c, i) => typeof c === 'string'
        ? { name: normalizeLuxuryCharacterName(c, i === 0 ? '讲解者' : '客户'), role: i === 0 ? '主讲 / 引导者' : '客户 / 决策者', description: '' }
        : luxuryCharacterTextFromObject(c, i))
      .filter(Boolean)
      .filter(c => {
        const key = c.name || `${c.role}|${c.gender}|${c.origin}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4);
    return normalized.map((c, i) => ({
      name: c.name || '',
      role: c.role || '',
      gender: c.gender || '',
      origin: c.origin || '',
      description: c.description || '',
    }));
  }

  function deriveLuxuryBriefInfo(text = '', segments = [], incoming = {}) {
    const source = String(text || '').replace(/\s+/g, ' ').trim();
    const isRobot = /机器人|AI|智能|科技|未来/i.test(source);
    const isProduct = /产品|商品|主商品|卖点|材质|钢材|家具|空间|展厅/.test(source);
    const selectedDuration = Number(state.luxuryAd.durationSec) || 30;
    const inferredDuration = /15\s*秒|15s/i.test(source)
      ? 15
      : (/45\s*秒|45s/.test(source) ? 45 : (/60\s*秒|60s|一分钟/.test(source) ? 60 : selectedDuration));
    const incomingDuration = Number(incoming.duration_sec || incoming.duration || 0);
    const durationValue = incomingDuration || inferredDuration;
    const inferredRatio = incoming.aspect_ratio || incoming.ratio || state.luxuryAd.outputRatio || '9:16';
    const titleUserEdited = !!incoming.title_user_edited;
    const autoTitle = normalizeLuxuryBriefTitle(incoming.title || source);
    const info = {
      title: titleUserEdited ? String(incoming.title || '').trim() : autoTitle,
      title_user_edited: titleUserEdited,
      theme: incoming.theme || incoming.category || (isRobot ? '通用广告' : (isProduct ? '产品宣传' : '品牌广告')),
      style: incoming.style || incoming.visual_style || (isRobot ? '电影感 · 高能快节奏' : '高端商业广告'),
      duration_sec: durationValue || 30,
      aspect_ratio: inferredRatio,
      style_tags: parseLuxuryBriefTags(incoming.style_tags || incoming.styleTags || (isRobot ? '电影感,用户实拍,竖版9:16,暖色低调,慢动作高潮' : '商业质感,真实场景,高级光影,产品清晰')),
      role_notes: incoming.role_notes || incoming.role || (isRobot ? '真实用户 / 真人演员，不是数字人站桩' : '按剧本需要安排真人广告演员或无人物镜头'),
      characters: normalizeLuxuryCharacters(incoming, segments, source),
    };
    info.title = String(info.title || '').replace(/^[:：\s]+/, '').slice(0, 24);
    info.theme = String(info.theme || '').slice(0, 24);
    info.style = String(info.style || '').slice(0, 48);
    info.duration_sec = Math.max(5, Math.min(90, Math.round(Number(info.duration_sec) || 30)));
    info.aspect_ratio = ['9:16', '16:9', '1:1', '4:3', '3:4', '21:9'].includes(String(info.aspect_ratio)) ? String(info.aspect_ratio) : '9:16';
    info.role_notes = String(info.role_notes || '').slice(0, 80);
    return info;
  }

  function normalizeLuxuryBriefTitle(value = '') {
    const raw = String(value || '').replace(/\s+/g, ' ').trim();
    const isEnglish = /^[\x00-\x7F\s.,!?;:'"()&/-]+$/.test(raw) && /[A-Za-z]/.test(raw);
    if (isEnglish) {
      const words = raw
        .replace(/[^A-Za-z0-9\s&-]/g, ' ')
        .split(/\s+/)
        .filter(w => !/^(i|we|want|need|make|create|a|an|the|ad|video|for|about|with|to|of)$/i.test(w))
        .slice(0, 4);
      return (words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') || 'Brand Film').slice(0, 24);
    }
    const cleaned = raw
      .replace(/^(我想做|我要做|帮我做|做一个|做一条|生成一个|请做一个|一个)/, '')
      .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
      .replace(/广告片|宣传片|视频|介绍|展示/g, '')
      .slice(0, 8);
    return cleaned || '品牌短片';
  }

  function syncLuxuryBriefInfoToControls(info = state.luxuryAd.briefInfo || {}) {
    info = (info && typeof info === 'object') ? info : {};
    const duration = Number(info.duration_sec || state.luxuryAd.durationSec || 30);
    state.luxuryAd.durationSec = duration;
    state.luxuryAd.outputRatio = info.aspect_ratio || state.luxuryAd.outputRatio || '9:16';
    const durationSelect = $('#dhLuxAdDuration');
    if (durationSelect) {
      const value = String(duration);
      if (![...durationSelect.options].some(o => o.value === value)) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = `${value} 秒`;
        durationSelect.appendChild(opt);
      }
      durationSelect.value = value;
    }
    const ratioSelect = $('#dhLuxAdRatio');
    if (ratioSelect) {
      const ratioValue = state.luxuryAd.outputRatio || '9:16';
      if (![...ratioSelect.options].some(o => o.value === ratioValue)) {
        const opt = document.createElement('option');
        opt.value = ratioValue;
        opt.textContent = ratioValue;
        ratioSelect.appendChild(opt);
      }
      ratioSelect.value = ratioValue;
    }
    $$('.dh-chip[data-lux-ratio]').forEach(b => b.classList.toggle('active', b.dataset.luxRatio === state.luxuryAd.outputRatio));
    updateLuxuryAdOutputHint();
  }

  function saveLuxuryAdBriefField(field, value) {
    const current = deriveLuxuryBriefInfo(state.luxuryAd.content, state.luxuryAd.segments || [], state.luxuryAd.briefInfo || {});
    const next = { ...current };
    if (field === 'duration_sec') next.duration_sec = Math.max(5, Math.min(90, Math.round(Number(value) || current.duration_sec || 30)));
    else if (field === 'aspect_ratio') next.aspect_ratio = value || current.aspect_ratio || '9:16';
    else if (field === 'style_tags') next[field] = parseLuxuryBriefTags(value);
    else {
      next[field] = String(value || '').trim();
      if (field === 'title') next.title_user_edited = true;
    }
    state.luxuryAd.briefInfo = deriveLuxuryBriefInfo(state.luxuryAd.content, state.luxuryAd.segments || [], next);
    state.luxuryAd.storyboardDetailed = false;
    state.luxuryAd.keyframes = [];
    syncLuxuryBriefInfoToControls(state.luxuryAd.briefInfo);
    updateLuxuryAdStepLocks();
  }

  function luxuryAdGateState() {
    reconcileLuxuryAdGenerationState();
    const text = ($('#dhLuxAdText')?.value || state.luxuryAd.content || '').trim();
    const segments = state.luxuryAd.segments || [];
    const refs = luxuryAdRefs();
    const keyframes = state.luxuryAd.keyframes || [];
    const materialMode = luxuryAdIsMaterialMode();
    const materialAssetCount = luxuryMaterialAssetUrls().length;
    const contentReady = text.length >= 6;
    const storyboardReady = segments.length > 0;
    const detailedReady = materialMode ? contentReady : !!state.luxuryAd.storyboardDetailed;
    const titleReady = !storyboardReady || !!String(state.luxuryAd.briefInfo?.title || '').trim();
    const sceneGenerating = !!state.luxuryAd.sceneGenerating;
    const scriptGenerating = !!state.luxuryAd.scriptGenerating;
    const landingAssetsReady = luxuryAdHasLandingAssets();
    const productReady = !!state.luxuryAd.productAsset?.url && !state.luxuryAd.uploading;
    const assetsReady = contentReady;
    const previewReady = materialMode
      ? (contentReady && materialAssetCount > 0)
      : detailedReady && storyboardReady && keyframes.length >= segments.length && segments.every((_, i) => !!(keyframes[i]?.image_url || keyframes[i]?.imageUrl));
    let step = 0;
    let hint = materialMode
      ? '第 1 步：先写广告需求，再上传素材、选择演员和配音。'
      : '第 1 步：先描述你想做什么广告，AI 会先生成视频基础信息。';
    if (materialMode) {
      if (!contentReady) {
        step = 0;
        hint = '第 1 步：写清产品、卖点、目标客户和收束方式。';
      } else if (!materialAssetCount) {
        step = 1;
        hint = '第 2 步：上传产品图、场景图、界面截图或门店素材；也可以从角色素材库选择演员。';
      } else if (!state.luxuryAd.voiceId) {
        step = 4;
        hint = '素材已就绪。第 5 步：请选择配音音色，并从公开曲库或上传自有授权 BGM 后合成。';
      } else {
        step = 4;
        hint = '素材、广告词和配音已就绪，可以合成素材成片。';
      }
      return { text, refs, segments, keyframes, materialMode, materialAssetCount, contentReady, storyboardReady, detailedReady, titleReady, sceneGenerating, scriptGenerating, landingAssetsReady, productReady, assetsReady, previewReady, step, hint };
    }
    if (sceneGenerating) { step = 1; hint = '正在生成场景配置，请稍等。'; }
    else if (scriptGenerating) { step = 2; hint = '正在生成剧本；生成完成后会立即显示剧本审核表，确认合适后再进入分镜。'; }
    else if (state.luxuryAd.briefUploading) { step = 0; hint = '需求参考图上传中，请稍等。'; }
    else if (state.luxuryAd.uploading) { step = 1; hint = '场景素材上传中，请稍等。'; }
    else if (!contentReady) { step = 0; hint = '第 1 步：写广告需求；可以自己写，也可以点击 AI 帮我写。'; }
    else if (contentReady && !storyboardReady) { step = 1; hint = '第 2 步：生成视频基础信息，先确定标题、主题、风格、时长和比例。'; }
    else if (storyboardReady && !titleReady) {
      step = 1;
      hint = '请先填写 4-8 个汉字或简短英文标题，再生成剧本。';
    }
    else if (storyboardReady && !detailedReady) {
      step = 2;
      hint = landingAssetsReady
        ? '第 3 步：基础信息已确认，可以生成剧本；剧本会写清楚每个时间段的画面、动作、台词、目的和情绪。'
        : '第 2 步：可上传主商品作为主体来源；也可以直接让 AI 按基础信息生成剧本。';
    }
    else if (assetsReady && contentReady && storyboardReady && !previewReady) {
      step = detailedReady ? 3 : 2;
      hint = refs.length
        ? `第 4 步：已上传 ${Math.max(0, refs.length - (productReady ? 1 : 0))} 张分镜/场景画面，剧本已生成，可以生成分镜。`
        : '第 4 步：剧本已生成；下一步生成分镜画面，确认镜头、动作、表情和声音。';
    }
    if (state.luxuryAd.keyframeGenerating) { step = 3; hint = state.luxuryAd.keyframeProgress?.message || '第 4 步：正在按剧本生成每段分镜，请稍等。'; }
    if (assetsReady && contentReady && storyboardReady && previewReady) {
      step = 4;
      if (!state.luxuryAd.voiceId) hint = '分镜已生成。下一步：先手动选择配音音色，确认字幕，再合成广告。';
      else hint = '第 5 步：分镜、配音和字幕已就绪，合成时会逐镜生成动态视频并剪成完整广告片。';
    }
    return { text, refs, segments, keyframes, materialMode, materialAssetCount, contentReady, storyboardReady, detailedReady, titleReady, sceneGenerating, scriptGenerating, landingAssetsReady, productReady, assetsReady, previewReady, step, hint };
  }

  function setLuxuryButtonLock(selector, disabled, reason = '') {
    const el = $(selector);
    if (!el) return;
    el.disabled = !!disabled;
    if (reason) el.title = reason;
    else el.removeAttribute('title');
    el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  }

  function luxuryAdMaxReachableStep(gate = luxuryAdGateState()) {
    if (gate.materialMode) return gate.contentReady ? 5 : 1;
    if (gate.sceneGenerating) return 1;
    if (gate.scriptGenerating) return 2;
    if (gate.previewReady) return 5;
    if (gate.detailedReady && gate.storyboardReady) return 4;
    if (gate.storyboardReady) return 3;
    if (gate.contentReady) return 2;
    return 1;
  }

  function syncLuxuryAdStepPanels(gate = luxuryAdGateState()) {
    const maxStep = luxuryAdMaxReachableStep(gate);
    let current = Math.max(1, Math.min(5, Number(state.luxuryAd.currentStep || 1)));
    if (current > maxStep) current = maxStep;
    state.luxuryAd.currentStep = current;
    $$('#dhLuxAdSteps > [data-lux-step]').forEach(el => {
      const step = Number(el.dataset.luxStep || 0);
      el.classList.toggle('done', step < current && step <= maxStep);
      el.classList.toggle('active', step === current);
      el.classList.toggle('locked', step > maxStep);
      el.setAttribute('aria-disabled', step > maxStep ? 'true' : 'false');
    });
    $$('.dh-luxgen-stage[data-panel], .dh-demo-stage[data-panel]').forEach(panel => {
      panel.classList.toggle('active', Number(panel.dataset.panel || 0) === current);
    });
    renderLuxuryAdUsage();
  }

  function showLuxuryAdStep(step, { silent = false } = {}) {
    const target = Math.max(1, Math.min(5, Number(step || 1)));
    const gate = luxuryAdGateState();
    const maxStep = luxuryAdMaxReachableStep(gate);
    if (target > maxStep) {
      if (!silent) toast(gate.hint || '请先完成前置步骤', 'error');
      return false;
    }
    state.luxuryAd.currentStep = target;
    syncLuxuryAdStepPanels(gate);
    const view = document.querySelector('.dh-view');
    if (view) view.scrollTo({ top: 0, behavior: 'smooth' });
    return true;
  }

  function updateLuxuryAdComposeCards(gate = luxuryAdGateState()) {
    const shots = state.luxuryAd.segments?.length || 0;
    const frames = (state.luxuryAd.keyframes || []).filter(k => k?.image_url || k?.imageUrl).length;
    const voice = (state.voices || []).find(v => String(v.id || '') === String(state.luxuryAd.voiceId || ''));
    const ratio = state.luxuryAd.outputRatio || '9:16';
    const seconds = state.luxuryAd.durationSec || 30;
    const material = gate.materialMode;
    const materialCount = gate.materialAssetCount || 0;
    const setText = (selector, value) => { const el = $(selector); if (el) el.textContent = value; };
    setText('#dhLuxAdComposeSummary', material ? `${materialCount} 个素材 · ${seconds} 秒 · ${ratio}` : (frames ? `${frames} 分镜 · ${seconds} 秒 · ${ratio}` : '未生成分镜'));
    setText('#dhLuxAdTaskMeta', `提交后进入任务中心 · ${seconds} 秒 · ${ratio}`);
    setText('#dhLuxAdSceneSummary', material ? `${materialCount} 个用户素材` : (gate.storyboardReady ? `${shots} 个场景配置` : '待生成'));
    setText('#dhLuxAdScriptSummary', material ? '按广告需求生成口播广告词' : (gate.detailedReady ? `${shots} 镜头 · 按时间段拆解` : '待生成'));
    setText('#dhLuxAdFrameSummary', material
      ? '基础版不生成分镜图片'
      : (state.luxuryAd.keyframePlanningOnly
        ? '审核板已生成 · 待真实关键帧'
        : (gate.previewReady ? `已确认 ${frames} 个分镜` : (frames ? `${frames}/${shots} 个分镜` : '待生成'))));
    setText('#dhLuxAdVoiceSummary', voice ? (voice.name || voice.label || state.luxuryAd.voiceId) : '未选择');
    const subCfg = getLuxuryAdSubtitlePayload();
    setText('#dhLuxAdSubtitleSummary', luxuryAdSubtitleEnabled()
      ? `${SUB_STYLE_LABELS[subCfg.style] || subCfg.style || '默认'} · ${subCfg.fontSize || 72}px`
      : '关闭字幕');
  }

  function updateLuxuryAdStepLocks() {
    renderLuxuryAdModeUi();
    const gate = luxuryAdGateState();
    updateLuxuryStoryStageHeading();
    const busyGenerating = gate.sceneGenerating || gate.scriptGenerating || state.luxuryAd.keyframeGenerating || state.luxuryAd.briefUploading;
    setLuxuryButtonLock('#dhLuxAdGenerate', busyGenerating || !gate.contentReady, gate.contentReady ? gate.hint : '请先写广告需求，或点击 AI 帮我写');
    setLuxuryButtonLock(
      '#dhLuxAdStoryboard',
      gate.materialMode ? (busyGenerating || !gate.contentReady) : (busyGenerating || !(gate.contentReady && gate.storyboardReady && gate.titleReady)),
      gate.materialMode
        ? (busyGenerating ? gate.hint : (!gate.contentReady ? '请先写广告需求' : ''))
        : (busyGenerating ? gate.hint : (!gate.contentReady ? '请先写广告需求' : (!gate.storyboardReady ? '请先生成场景配置' : (!gate.titleReady ? '请先填写标题' : ''))))
    );
    setLuxuryButtonLock('#dhLuxAdScriptRegenerateTop', gate.materialMode ? (busyGenerating || !gate.contentReady) : (busyGenerating || !(gate.contentReady && gate.storyboardReady && gate.titleReady)), busyGenerating ? gate.hint : (!gate.storyboardReady && !gate.materialMode ? '请先生成场景配置' : (!gate.titleReady && !gate.materialMode ? '请先填写标题' : '')));
    setLuxuryButtonLock('#dhLuxAdPreviewFrames', gate.materialMode ? (busyGenerating || !gate.contentReady) : (busyGenerating || !(gate.contentReady && gate.storyboardReady && gate.detailedReady)), busyGenerating ? gate.hint : (!gate.storyboardReady && !gate.materialMode ? '请先生成场景配置' : (!gate.detailedReady && !gate.materialMode ? '请先生成剧本' : '')));
    const previewBtn = $('#dhLuxAdPreviewFrames');
    if (previewBtn && !gate.materialMode && state.luxuryAd.keyframePlanningOnly && !busyGenerating) {
      previewBtn.textContent = '生成真实关键帧';
    }
    const personSheetLocked = gate.materialMode
      ? (busyGenerating || !gate.contentReady)
      : (busyGenerating || !gate.contentReady || !luxuryAdPersonDesignReady());
    setLuxuryButtonLock('#dhLuxAdGeneratePersonSheet', personSheetLocked, busyGenerating ? gate.hint : (!gate.contentReady ? '请先填写广告需求' : (!luxuryAdPersonDesignReady() && !gate.materialMode ? luxuryAdPersonDesignGateMessage() : '')));
    const submitLocked = gate.materialMode
      ? (busyGenerating || !gate.contentReady || !gate.materialAssetCount || !state.luxuryAd.voiceId)
      : state.luxuryAd.keyframeGenerating
      || gate.sceneGenerating
      || gate.scriptGenerating
      || !(gate.contentReady && gate.storyboardReady && gate.previewReady)
      || !state.luxuryAd.voiceId;
    const submitReason = gate.materialMode
      ? (!gate.contentReady ? '请先写广告需求' : (!gate.materialAssetCount ? '请先上传至少一张素材' : (!state.luxuryAd.voiceId ? '请先手动选择配音音色' : '')))
      : !gate.previewReady
      ? '请先生成分镜'
      : (!state.luxuryAd.voiceId ? '请先手动选择配音音色' : '');
    setLuxuryButtonLock('#dhLuxAdConfirmGenerate', submitLocked, submitReason);
    const stepActions = [
      ['#dhLuxAdGenerate', gate.storyboardReady],
      ['#dhLuxAdStoryboard', gate.detailedReady],
      ['#dhLuxAdPreviewFrames', gate.previewReady],
      ['#dhLuxAdConfirmGenerate', false],
    ];
    let nextSelector = '';
    if (gate.materialMode && gate.contentReady && !gate.materialAssetCount) nextSelector = '#dhLuxAdGenerate';
    else if (gate.contentReady && !gate.storyboardReady) nextSelector = '#dhLuxAdGenerate';
    else if (gate.contentReady && gate.storyboardReady && !gate.detailedReady) nextSelector = '#dhLuxAdStoryboard';
    else if (gate.contentReady && gate.storyboardReady && gate.detailedReady && !gate.previewReady) nextSelector = '#dhLuxAdPreviewFrames';
    else if (gate.materialMode && gate.contentReady && gate.materialAssetCount && state.luxuryAd.voiceId) nextSelector = '#dhLuxAdConfirmGenerate';
    else if (gate.previewReady && state.luxuryAd.voiceId) nextSelector = '#dhLuxAdConfirmGenerate';
    stepActions.forEach(([selector, done]) => {
      const el = $(selector);
      if (!el) return;
      el.classList.toggle('is-done', !!done);
      el.classList.toggle('is-next', selector === nextSelector && !el.disabled);
    });

    const drop = $('#dhLuxAdAssetDrop');
    if (drop) {
      const locked = !!state.luxuryAd.keyframeGenerating;
      drop.classList.toggle('locked', locked);
      drop.setAttribute('aria-disabled', locked ? 'true' : 'false');
      drop.title = locked ? '正在生成画面预览，完成后再替换素材' : '';
      const copy = drop.querySelector('span');
      const refCount = luxuryAdReferenceAssets().filter(x => x.url).length;
      if (copy) copy.textContent = locked ? '正在生成分镜，暂不可替换画面' : (refCount ? `已上传 ${refCount} 张分镜画面，继续上传会追加到后面` : '按镜头顺序上传分镜画面，不替换主商品');
    }
    const productDrop = $('#dhLuxAdProductDrop');
    if (productDrop) {
      const locked = !!state.luxuryAd.keyframeGenerating;
      productDrop.classList.toggle('locked', locked);
      productDrop.setAttribute('aria-disabled', locked ? 'true' : 'false');
      productDrop.title = locked ? '正在生成画面预览，完成后再替换产品图' : '';
      const copy = productDrop.querySelector('span');
      if (copy) copy.textContent = locked ? '正在生成画面预览，暂不可替换产品图' : (gate.productReady ? '产品图已锁定，替换只影响主产品' : '产品图单独保存，后续顺序画面不会覆盖主商品');
    }

    const hint = $('#dhLuxAdGateHint');
    if (hint) {
      hint.textContent = gate.hint;
      hint.classList.toggle('ready', gate.previewReady);
    }
    const progressHint = $('#dhLuxAdProgressHint');
    if (progressHint) {
      progressHint.textContent = state.luxuryAd.keyframeGenerating
        ? (state.luxuryAd.keyframeProgress?.message || '正在生成分镜，请稍等。')
        : `当前：${gate.hint}`;
    }
    renderLuxuryWorkflowProgress();
    $('#dhLuxAdGenerate')?.classList.toggle('is-generating', !!gate.sceneGenerating);
    $('#dhLuxAdStoryboard')?.classList.toggle('is-generating', !!gate.scriptGenerating);
    $('#dhLuxAdPreviewFrames')?.classList.toggle('is-generating', !!state.luxuryAd.keyframeGenerating);
    renderLuxuryAdBgm();
    renderLuxuryAdBriefRefs();
    const requirementState = $('#dhLuxAdRequirementState');
    if (requirementState) {
      requirementState.textContent = gate.contentReady ? '广告需求已填写' : '第一步：待填写';
      requirementState.classList.toggle('ready', gate.contentReady);
    }
    const productState = $('#dhLuxAdProductState');
    if (productState) {
      productState.textContent = gate.productReady ? '主商品已锁定' : (state.luxuryAd.uploading ? '上传中' : '可选上传');
      productState.classList.toggle('ready', gate.productReady);
    }
    const frameState = $('#dhLuxAdFrameState');
    if (frameState) {
      if (gate.materialMode) {
        const materialCount = gate.materialAssetCount || 0;
        frameState.textContent = materialCount ? `素材 ${materialCount} 个` : '待上传素材';
        frameState.classList.toggle('ready', materialCount > 0);
      } else {
        const refCount = luxuryAdReferenceAssets().filter(x => x.url || x.previewUrl).length;
        frameState.textContent = refCount ? `已上传 ${refCount} 张` : '可选上传';
        frameState.classList.toggle('ready', refCount > 0);
      }
    }

    syncLuxuryAdStepPanels(gate);
    updateLuxuryAdComposeCards(gate);
  }

  function renderLuxuryAd() {
    const text = $('#dhLuxAdText');
    if (text && document.activeElement !== text) text.value = state.luxuryAd.content || '';
    const duration = $('#dhLuxAdDuration');
    if (duration) duration.value = String(state.luxuryAd.durationSec || 30);
    const ratio = $('#dhLuxAdRatio');
    if (ratio) ratio.value = state.luxuryAd.outputRatio || '9:16';
    const size = $('#dhLuxAdSize');
    if (size) size.value = state.luxuryAd.outputSize || 'standard';
    const subtitle = $('#dhLuxAdSubtitle');
    if (subtitle) subtitle.value = luxuryAdSubtitleEnabled() ? 'on' : 'off';
    const subtitleToggle = $('#dhLuxAdSubtitleToggle');
    if (subtitleToggle) subtitleToggle.checked = luxuryAdSubtitleEnabled();
    const autoEnhance = $('#dhLuxAdAutoEnhance');
    if (autoEnhance) autoEnhance.checked = state.luxuryAd.autoEnhance !== false;
    const expandBrief = $('#dhLuxAdExpandBrief');
    if (expandBrief) expandBrief.checked = state.luxuryAd.expandBrief !== false;
    $$('[data-lux-ad-type]').forEach(b => b.classList.toggle('active', b.dataset.luxAdType === (state.luxuryAd.adType || 'auto')));
    $$('[data-lux-ratio]').forEach(b => b.classList.toggle('active', b.dataset.luxRatio === (state.luxuryAd.outputRatio || '9:16')));
    updateLuxuryAdOutputHint();
    renderLuxuryAdAssets();
    renderLuxuryAdPerson();
    renderLuxuryAdVoice();
    renderLuxuryAdStoryboard();
    updateLuxuryAdStepLocks();
  }

  function openLuxuryAdWriterModal() {
    const current = ($('#dhLuxAdText')?.value || state.luxuryAd.content || '').trim();
    const mask = document.createElement('div');
    mask.className = 'dh-luxgen-writer-mask';
    mask.innerHTML = `
      <div class="dh-luxgen-writer-modal" role="dialog" aria-modal="true" aria-label="AI 帮我写剧情广告内容">
        <div class="dh-luxgen-writer-head">
          <div>
            <h3>AI 帮我写剧情广告内容</h3>
            <p>给一点产品、卖点或目标客户，AI 会先写成广告词/需求，再用于生成详细分镜。</p>
          </div>
          <button class="dh-icon-btn" type="button" data-lux-writer-close>×</button>
        </div>
        <div class="dh-luxgen-writer-body">
          <label class="dh-field">
            <span>产品/品牌</span>
            <input class="dh-input" id="dhLuxWriterName" placeholder="例如：钢材成品站、艺术墙、高端定制家具">
          </label>
          <label class="dh-field">
            <span>核心卖点</span>
            <textarea class="dh-input" id="dhLuxWriterPoints" rows="4" placeholder="例如：金属肌理、灯光纹理、定制工艺、适合高端会所和设计师客户">${escapeHtml(current)}</textarea>
          </label>
          <div class="dh-luxgen-writer-grid">
            <label class="dh-field">
              <span>目标客户</span>
              <input class="dh-input" id="dhLuxWriterAudience" placeholder="例如：设计师、高端业主、品牌方">
            </label>
            <label class="dh-field">
              <span>画面风格</span>
              <select class="dh-input" id="dhLuxWriterTone">
                <option value="高端品牌广告，克制、有质感">高端品牌广告</option>
                <option value="产品宣传，清晰突出卖点">产品宣传</option>
                <option value="品牌故事，强调调性和记忆点">品牌故事</option>
                <option value="空间展示，突出场景和氛围">空间展示</option>
              </select>
            </label>
          </div>
        </div>
        <div class="dh-luxgen-writer-foot">
          <button class="dh-btn dh-btn-ghost" type="button" data-lux-writer-close>取消</button>
          <button class="dh-btn dh-btn-primary" type="button" id="dhLuxWriterGenerate">生成广告词/需求</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    const close = () => mask.remove();
    mask.addEventListener('click', e => {
      if (e.target === mask || e.target.closest('[data-lux-writer-close]')) close();
    });
    $('#dhLuxWriterName')?.focus();
    $('#dhLuxWriterGenerate')?.addEventListener('click', async () => {
      const name = ($('#dhLuxWriterName')?.value || '').trim();
      const points = ($('#dhLuxWriterPoints')?.value || '').trim();
      const audience = ($('#dhLuxWriterAudience')?.value || '').trim();
      const tone = ($('#dhLuxWriterTone')?.value || '').trim();
      const topic = [
        name ? `产品/品牌：${name}` : '',
        points ? `卖点/资料：${points}` : '',
        audience ? `目标客户：${audience}` : '',
        tone ? `画面风格：${tone}` : '',
      ].filter(Boolean).join('\n');
      if (!topic) return toast('请至少填写产品、卖点或目标客户', 'error');
      const btn = $('#dhLuxWriterGenerate');
      const old = btn?.innerHTML;
      if (btn) { btn.disabled = true; btn.innerHTML = 'AI 写作中…'; }
      try {
        const r = await api('/api/dh/scripts/write', {
          method: 'POST',
          body: {
            topic,
            duration_sec: state.luxuryAd.durationSec || Number($('#dhLuxAdDuration')?.value || 30),
            style: state.luxuryAd.adType || 'auto',
            tone,
            mode: 'luxury_ad',
          },
        });
        if (!r.success) throw new Error(r.error || 'AI 写作失败');
        state.luxuryAd.content = (r.text || '').trim();
        state.luxuryAd.briefInfo = null;
        state.luxuryAd.segments = [];
        state.luxuryAd.storyboardDetailed = false;
        state.luxuryAd.keyframes = [];
        const input = $('#dhLuxAdText');
        if (input) input.value = state.luxuryAd.content;
        renderLuxuryAdStoryboard();
        setLuxuryProgress('content');
        updateLuxuryAdStepLocks();
        toast('AI 已写好广告词/需求，可继续生成详细分镜', 'success');
        close();
      } catch (err) {
        toast('AI 帮写失败：' + err.message, 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = old || '生成广告词/需求'; }
      }
    });
  }

  async function rewriteLuxuryAdContent() {
    const text = ($('#dhLuxAdText')?.value || state.luxuryAd.content || '').trim();
    if (!text) {
      openLuxuryAdWriterModal();
      return;
    }
    const btn = $('#dhLuxAdClean');
    const old = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = 'AI 整理中…'; }
    try {
      const r = await api('/api/dh/scripts/write', {
        method: 'POST',
        body: {
          topic: text,
          duration_sec: state.luxuryAd.durationSec || Number($('#dhLuxAdDuration')?.value || 30),
          style: state.luxuryAd.adType || 'auto',
          tone: '高端品牌广告，克制、有质感',
          mode: 'luxury_ad',
        },
      });
      if (!r.success) throw new Error(r.error || 'AI 整理失败');
      state.luxuryAd.content = (r.text || '').trim();
      state.luxuryAd.briefInfo = null;
      state.luxuryAd.segments = [];
      state.luxuryAd.storyboardDetailed = false;
      state.luxuryAd.keyframes = [];
      const input = $('#dhLuxAdText');
      if (input) input.value = state.luxuryAd.content;
      renderLuxuryAdStoryboard();
      setLuxuryProgress('content');
      updateLuxuryAdStepLocks();
      toast('AI 已整理成广告片需求，可继续生成详细分镜', 'success');
    } catch (err) {
      toast('AI 整理内容失败：' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = old || 'AI 帮我整理内容'; }
    }
  }

  async function uploadLuxuryAdProduct(fileList) {
    if (state.luxuryAd.keyframeGenerating) return toast('正在生成画面预览，完成后再替换素材', 'error');
    const picked = pickUploadableImages(fileList, { maxCount: 1, label: '商品图片' });
    const file = picked.files[0];
    if (!file) return toast(picked.error || '请上传商品图片文件', 'error');
    if (state.luxuryAd.productAsset?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(state.luxuryAd.productAsset.previewUrl);
    state.luxuryAd.productAsset = {
      name: file.name || '主产品图',
      url: '',
      previewUrl: URL.createObjectURL(file),
      uploading: true,
    };
    syncLuxuryAdUploadFlags();
    state.luxuryAd.keyframes = [];
    if (state.luxuryAd.segments?.length) state.luxuryAd.storyboardDetailed = false;
    renderLuxuryAdAssets();
    renderLuxuryAdStoryboard();
    updateLuxuryAdStepLocks();
    setLuxuryProgress('assets');
    toast('主产品图正在上传…');
    try {
      const imageUrl = await uploadDhImage(file, { role: 'product' });
      revokeLuxuryBlobPreview(state.luxuryAd.productAsset);
      state.luxuryAd.productAsset = { ...state.luxuryAd.productAsset, url: imageUrl, previewUrl: imageUrl, uploading: false };
      syncLuxuryAdUploadFlags();
      renderLuxuryAdAssets();
      updateLuxuryAdStepLocks();
      toast('主商品已上传，可用于后续镜头锁定广告主体', 'success');
    } catch (err) {
      state.luxuryAd.productAsset = state.luxuryAd.productAsset ? { ...state.luxuryAd.productAsset, uploading: false, failed: true } : null;
      syncLuxuryAdUploadFlags();
      renderLuxuryAdAssets();
      updateLuxuryAdStepLocks();
      toast('主产品图上传失败：' + err.message, 'error');
    }
  }

  function clearLuxuryAdProduct() {
    const product = state.luxuryAd.productAsset || null;
    if (!product) return;
    if (state.luxuryAd.keyframeGenerating) return toast('正在生成画面预览，完成后再删除主体图', 'error');
    if (product.uploading) return toast('主体图正在上传，上传完成后再删除', 'error');
    revokeLuxuryBlobPreview(product);
    state.luxuryAd.productAsset = null;
    syncLuxuryAdUploadFlags();
    state.luxuryAd.keyframes = [];
    if (state.luxuryAd.segments?.length) state.luxuryAd.storyboardDetailed = false;
    renderLuxuryAdAssets();
    renderLuxuryAdStoryboard();
    updateLuxuryAdStepLocks();
    setLuxuryProgress('config');
    toast('主体图已删除，可以重新上传或让 AI 按广告需求生成主体', 'success');
  }

  async function uploadLuxuryAdPersonReference(fileList) {
    if (state.luxuryAd.keyframeGenerating) return toast('正在生成分镜，完成后再替换人物参考', 'error');
    const text = ($('#dhLuxAdText')?.value || state.luxuryAd.content || '').trim();
    if (!text) return toast('请先填写广告需求，再确认人物来源', 'error');
    const picked = pickUploadableImages(fileList, { maxCount: 1, label: '真人参考图片' });
    const file = picked.files[0];
    if (!file) return toast(picked.error || '请上传真人参考图片', 'error');
    if (state.luxuryAd.personAsset?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(state.luxuryAd.personAsset.previewUrl);
    state.luxuryAd.personAsset = {
      id: 'uploaded_person_reference',
      name: '真人照片参考',
      original_name: file.name || '',
      type: 'uploaded_person_reference',
      source: 'uploaded_person_reference',
      reference_kind: 'real_photo',
      is_ai_generated: false,
      real_person_reference: true,
      url: '',
      previewUrl: URL.createObjectURL(file),
      uploading: true,
      view_count: 1,
      description: '用户上传的真人照片参考，会作为广告人物身份和气质参考。',
    };
    state.luxuryAd.personSpecLock = null;
    state.selectedAvatar = null;
    syncLuxuryAdUploadFlags();
    renderLuxuryAdPerson();
    updateLuxuryAdStepLocks();
    toast('人物参考正在上传…');
    try {
      const imageUrl = await uploadDhImage(file, { role: 'person_reference' });
      const detectedGender = await detectLuxuryAdPersonGender(imageUrl);
      revokeLuxuryBlobPreview(state.luxuryAd.personAsset);
      state.luxuryAd.personAsset = {
        ...state.luxuryAd.personAsset,
        id: 'uploaded_person_reference',
        name: '真人照片参考',
        type: 'uploaded_person_reference',
        source: 'uploaded_person_reference',
        reference_kind: 'real_photo',
        is_ai_generated: false,
        real_person_reference: true,
        url: imageUrl,
        image_url: imageUrl,
        previewUrl: imageUrl,
        uploading: false,
        gender: detectedGender || '',
        detected_gender: detectedGender || '',
      };
      applyLuxuryPersonAssetConstraints(state.luxuryAd.personAsset);
      syncLuxuryAdUploadFlags();
      state.luxuryAd.keyframes = [];
      renderLuxuryAdPerson();
      renderLuxuryAdStoryboard();
      updateLuxuryAdStepLocks();
      persistLuxuryPersonAssetToLibrary(state.luxuryAd.personAsset, 'uploaded_person_reference');
      toast('真人照片参考已上传，会用于后续剧本和分镜保持人物一致', 'success');
    } catch (err) {
      state.luxuryAd.personAsset = state.luxuryAd.personAsset ? { ...state.luxuryAd.personAsset, uploading: false, failed: true } : null;
      syncLuxuryAdUploadFlags();
      renderLuxuryAdPerson();
      updateLuxuryAdStepLocks();
      toast('人物参考上传失败：' + err.message, 'error');
    }
  }

  async function detectLuxuryAdPersonGender(imageUrl = '') {
    const url = compactLuxuryUrl(imageUrl);
    if (!url) return '';
    try {
      const r = await api('/api/dh/images/detect-gender', { method: 'POST', body: { imageUrl: url } });
      const gender = String(r?.gender || '').toLowerCase();
      return gender === 'male' || gender === 'female' ? gender : '';
    } catch {
      return '';
    }
  }

  async function generateLuxuryAdPersonSheet() {
    const text = ($('#dhLuxAdText')?.value || state.luxuryAd.content || '').trim();
    if (!text) return toast('请先填写广告需求，AI 才知道人物应该是谁', 'error');
    if (!luxuryAdIsMaterialMode() && !luxuryAdPersonDesignReady()) {
      return toast(luxuryAdPersonDesignGateMessage(), 'error');
    }
    const generationSpec = luxuryAdPersonGenerationSpec();
    const personDescription = luxuryAdPersonDescription(generationSpec);
    const referenceCandidate = luxuryAdPersonAssetPayload();
    const referenceKind = luxuryAdActorReferenceKind(referenceCandidate || {});
    const referencePerson = referenceKind === 'real_photo' || referenceKind === 'synthetic_realistic_actor'
      ? referenceCandidate
      : null;
    const btn = $('#dhLuxAdGeneratePersonSheet');
    const old = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '生成演员包中…'; }
    state.luxuryAd.personGenerationError = null;
    const personProgressStages = [
      { at: 0, percent: 10, phase: '准备人物设定', message: '读取广告需求、人物性别、年龄和地域约束。' },
      { at: 2500, percent: 24, phase: '生成正面定妆照', message: '要求竖构图、全身或膝上以上，锁定发型和同一套服装。' },
      { at: 8500, percent: 48, phase: '生成侧面/半侧参考', message: '复用同一脸型、发型、服装和身形比例。' },
      { at: 15000, percent: 70, phase: '生成动作参考照', message: '同一演员进入剧本需要的动作姿态，检查衣服和发型不漂移。' },
      { at: 22000, percent: 86, phase: '构图 QA 与素材入库', message: '检查是否看得到裤子/膝盖等下半身证据，通过后才绑定 actor_id。' },
    ];
    const updatePersonProgress = () => {
      const start = state.luxuryAd.personGenerationProgress?.startedAt || Date.now();
      const elapsed = Date.now() - start;
      let stage = personProgressStages[0];
      personProgressStages.forEach(item => { if (elapsed >= item.at) stage = item; });
      state.luxuryAd.personGenerationProgress = {
        active: true,
        startedAt: start,
        label: 'AI 真人感演员包',
        percent: stage.percent,
        phase: stage.phase,
        message: stage.message,
      };
      renderLuxuryAdPerson();
    };
    state.luxuryAd.personGenerationProgress = {
      active: true,
      startedAt: Date.now(),
      label: 'AI 真人感演员包',
      percent: 10,
      phase: '准备人物设定',
      message: '读取广告需求、人物性别、年龄和地域约束。',
    };
    const personProgressTimer = setInterval(updatePersonProgress, 1400);
    state.luxuryAd.personAsset = {
      id: 'luxury_ad_actor_package',
      name: 'AI 真人感一致性演员',
      type: 'luxury_ad_actor_package',
      source: 'local_actor_library_generated',
      reference_kind: 'synthetic_realistic_actor',
      is_ai_generated: false,
      production_usable_actor: true,
      url: '',
      previewUrl: '',
      uploading: true,
      view_count: 3,
      gender: generationSpec.gender === 'male' || generationSpec.gender === 'female' ? generationSpec.gender : '',
      age: generationSpec.age || '',
      origin: generationSpec.origin || '',
      // 中文说明：演员包只锁定人物一致性，行业、职业、年龄和动作必须由用户内容/剧本推导。
      description: '正在根据广告需求、剧本人物表和分镜上下文生成真人感一致性演员包。',
      spec_description: personDescription,
    };
    state.selectedAvatar = null;
    renderLuxuryAdPerson();
    const requestKey = luxuryPersonSheetRequestKey();
    try {
      const requestBody = {
        brief: text,
        scene_config: compactLuxurySegments(state.luxuryAd.segments || []).slice(0, 5),
        description: personDescription,
        person_spec: generationSpec,
        person_context: luxuryAdPersonContextPayload(generationSpec),
        flow_mode: state.luxuryAd.flowMode || (luxuryAdIsMaterialMode() ? 'material' : 'story'),
        reference_person: referencePerson,
        output_ratio: '9:16',
        request_key: requestKey,
        request_async: true,
      };
      let r;
      try {
        r = await api('/api/dh/luxury-ad/person-sheet', {
          method: 'POST',
          body: requestBody,
        });
      } catch (submitErr) {
        // 中文说明：人物包是长任务，提交连接可能被浏览器/代理切断；只要 request_key 已发出，就继续轮询后台结果。
        if (!isLuxuryStoryboardLongRunningError(submitErr)) throw submitErr;
      }
      if (r?.status === 'accepted' && r?.request_key) {
        state.luxuryAd.personGenerationProgress = {
          ...(state.luxuryAd.personGenerationProgress || {}),
          active: true,
          label: 'AI 真人感演员包',
          percent: 88,
          phase: '后台生成中',
          message: '人物包已提交到后台，正在等待模型和 QA 返回。',
        };
        renderLuxuryAdPerson();
        r = await pollLuxuryPersonSheetResult(requestKey, { timeoutMs: 0, missingRetryMs: 0 });
      } else if (!r && requestKey) {
        r = await pollLuxuryPersonSheetResult(requestKey, { timeoutMs: 0, missingRetryMs: 45000 });
      }
      if (!r.success) throw new Error(r.error || '人物演员包生成失败');
      const imageUrl = r.imageUrl || r.image_url || r.url || r.character?.image_url || '';
      if (!imageUrl) throw new Error('人物演员包生成成功但没有返回图片地址');
      const character = r.character || {};
      const actorUrls = luxuryActorUrlsFromSources(character, r.actor_asset, r, r.outputs);
      const primaryActorUrl = actorUrls[0] || imageUrl;
      const extraActorUrls = actorUrls.filter(url => url && url !== primaryActorUrl).slice(0, 8);
      const detectedGender = await detectLuxuryAdPersonGender(primaryActorUrl);
      state.luxuryAd.personGenerationError = null;
      state.luxuryAd.personGenerationProgress = {
        active: true,
        startedAt: state.luxuryAd.personGenerationProgress?.startedAt || Date.now(),
        label: 'AI 真人感演员包',
        percent: 96,
        phase: '演员包生成完成',
        message: '已返回正面、侧面/半侧和动作参考图，正在更新页面。',
      };
      state.luxuryAd.personAsset = {
        id: character.id || character.actor_asset_id || 'luxury_ad_actor_package',
        actor_id: character.actor_id || r.actor_asset?.actor_id || '',
        actor_asset_id: character.actor_asset_id || r.actor_asset?.actor_asset_id || '',
        name: character.name || 'AI 真人感一致性演员',
        type: character.type || 'luxury_ad_actor_package',
        source: character.source || 'local_actor_library_generated',
        reference_kind: character.reference_kind || 'synthetic_realistic_actor',
        is_ai_generated: character.is_ai_generated === true,
        production_usable_actor: character.production_usable_actor !== false,
        gender: detectedGender || character.gender || generationSpec.gender || '',
        detected_gender: detectedGender || character.detected_gender || '',
        age: character.age || character.age_range || generationSpec.age || '',
        origin: character.origin || generationSpec.origin || '',
        url: primaryActorUrl,
        image_url: primaryActorUrl,
        previewUrl: primaryActorUrl,
        extra_image_urls: extraActorUrls,
        view_count: Math.max(1, actorUrls.length || (1 + extraActorUrls.length)),
        uploading: false,
        description: character.description || 'AI 真人感一致性演员包：正面定妆、侧面/半侧、动作参考。',
        spec_description: personDescription,
      };
      applyLuxuryPersonAssetConstraints(state.luxuryAd.personAsset);
      state.luxuryAd.keyframes = [];
      renderLuxuryAdPerson();
      renderLuxuryAdStoryboard();
      updateLuxuryAdStepLocks();
      persistLuxuryPersonAssetToLibrary(state.luxuryAd.personAsset, 'local_actor_library_generated');
      toast('AI 真人感一致性演员包已生成，并会写入角色素材库用于后续分镜人物一致性锁定', 'success');
    } catch (err) {
      state.luxuryAd.personGenerationError = {
        endpoint: '/api/dh/luxury-ad/person-sheet',
        status: err?.status || err?.data?.status || 0,
        code: err?.data?.code || err?.code || 'PERSON_ACTOR_PACKAGE_FAILED',
        message: err?.data?.message || err?.data?.error || err.message || '人物演员包生成失败',
        details: err?.data?.details || null,
        raw: err?.data || null,
      };
      state.luxuryAd.personGenerationProgress = null;
      state.luxuryAd.personAsset = {
        id: 'luxury_ad_actor_package_failed',
        name: 'AI 真人感一致性演员',
        type: 'luxury_ad_actor_package',
        source: 'local_actor_library_generated',
        reference_kind: 'synthetic_realistic_actor',
        is_ai_generated: false,
        production_usable_actor: true,
        url: '',
        previewUrl: '',
        uploading: false,
        failed: true,
        view_count: 3,
        gender: generationSpec.gender === 'male' || generationSpec.gender === 'female' ? generationSpec.gender : '',
        age: generationSpec.age || '',
        origin: generationSpec.origin || '',
        description: '人物演员包生成失败，请展开完整错误回执查看模型链路。',
        error: err?.data?.message || err?.data?.error || err.message || '',
        spec_description: personDescription,
      };
      renderLuxuryAdPerson();
      toast('AI 生成人物演员包失败：' + luxuryPersonGenerationErrorExplanation(state.luxuryAd.personGenerationError), 'error');
    } finally {
      clearInterval(personProgressTimer);
      if (state.luxuryAd.personGenerationProgress?.active) {
        state.luxuryAd.personGenerationProgress = null;
        renderLuxuryAdPerson();
      }
      if (btn) { btn.disabled = false; btn.innerHTML = old || 'AI 真人感演员包'; }
      updateLuxuryAdStepLocks();
    }
  }

  function adoptLuxuryPersonFailedCandidate(index = 0) {
    const candidates = luxuryPersonFailedCandidates(state.luxuryAd.personGenerationError || {});
    const item = candidates[Number(index) || 0];
    if (!item?.url) return toast('没有可保留的人物候选图', 'error');
    state.luxuryAd.personGenerationError = null;
    state.luxuryAd.personGenerationProgress = null;
    state.luxuryAd.personAsset = {
      id: `manual_actor_candidate_${Date.now()}`,
      name: '人工保留人物参考',
      type: 'luxury_ad_actor_package',
      source: 'manual_failed_person_sheet_candidate',
      reference_kind: 'synthetic_realistic_actor',
      is_ai_generated: true,
      production_usable_actor: true,
      manual_override: true,
      url: item.url,
      image_url: item.url,
      previewUrl: item.url,
      extra_image_urls: [],
      view_count: 1,
      uploading: false,
      description: `人工从未通过 QA 的人物包候选图中保留：${item.provider || item.label || '候选图'}。后续分镜会把它作为人物身份参考，但建议仍优先上传真人参考或角色素材。`,
    };
    state.selectedAvatar = null;
    applyLuxuryPersonAssetConstraints(state.luxuryAd.personAsset);
    state.luxuryAd.keyframes = [];
    renderLuxuryAdPerson();
    renderLuxuryAdStoryboard();
    updateLuxuryAdStepLocks();
    persistLuxuryPersonAssetToLibrary(state.luxuryAd.personAsset, 'manual_failed_person_sheet_candidate');
    saveLuxuryAdDraft({ silent: true }).catch(() => {});
    toast('已人工保留为人物参考，可继续生成分镜；如需更稳定一致性，建议上传真人参考', 'success');
  }

  async function uploadLuxuryAdBriefReferences(fileList) {
    if (state.luxuryAd.sceneGenerating || state.luxuryAd.scriptGenerating || state.luxuryAd.keyframeGenerating) {
      return toast('正在生成中，完成后再上传需求参考图', 'error');
    }
    const existing = luxuryAdBriefReferenceAssets();
    const remaining = Math.max(0, 6 - existing.filter(x => x && (x.url || x.previewUrl || x.name || x.uploading)).length);
    const picked = pickUploadableImages(fileList, { maxCount: remaining, label: '需求参考图' });
    const files = picked.files;
    if (!files.length) return toast(remaining <= 0 ? '需求参考图最多上传 6 张' : (picked.error || '请上传图片文件'), 'error');
    const start = existing.length;
    const next = [...existing];
    files.forEach((f, i) => {
      next[start + i] = {
        name: f.name || `需求参考图 ${start + i + 1}`,
        url: '',
        previewUrl: URL.createObjectURL(f),
        uploading: true,
      };
    });
    state.luxuryAd.briefRefAssets = next;
    syncLuxuryAdUploadFlags();
    // 上传需求参考图会改变 AI 分析输入，因此必须清空已生成的场景/剧本/分镜。
    state.luxuryAd.briefInfo = null;
    state.luxuryAd.visualReferenceBrief = null;
    state.luxuryAd.segments = [];
    state.luxuryAd.storyboardDetailed = false;
    state.luxuryAd.keyframes = [];
    renderLuxuryAdBriefRefs();
    renderLuxuryAdStoryboard();
    updateLuxuryAdStepLocks();
    toast(`已选择 ${files.length} 张需求参考图，正在上传…`);
    try {
      // 每张图独立上传、独立回填 URL，避免第 2 张被第 1 张阻塞。
      const results = await Promise.allSettled(files.map(async (file, i) => {
        const idx = start + i;
        const imageUrl = await uploadDhImage(file, { role: 'brief_reference' });
        revokeLuxuryBlobPreview(state.luxuryAd.briefRefAssets[idx]);
        state.luxuryAd.briefRefAssets[idx] = {
          ...state.luxuryAd.briefRefAssets[idx],
          url: imageUrl,
          previewUrl: imageUrl,
          uploading: false,
        };
        renderLuxuryAdBriefRefs();
      }));
      syncLuxuryAdUploadFlags();
      updateLuxuryAdStepLocks();
      const failed = results.filter(x => x.status === 'rejected');
      if (failed.length) {
        // 失败的图片不伪装成成功，只停止上传态并保留本地预览方便用户删除重传。
        state.luxuryAd.briefRefAssets = luxuryAdBriefReferenceAssets().map((x, i) => {
          const localBatchIndex = i - start;
          const failedHere = localBatchIndex >= 0 && results[localBatchIndex]?.status === 'rejected';
          return failedHere ? ({ ...x, uploading: false, failed: true }) : x;
        });
        syncLuxuryAdUploadFlags();
        renderLuxuryAdBriefRefs();
        toast(`${failed.length} 张需求参考图上传失败，其余已保留`, 'error');
      } else {
        toast('需求参考图已上传，AI 会在生成场景配置和剧本时自动分析', 'success');
      }
    } catch (err) {
      // 这里是队列级异常；不兜底成功，只把未结束项标成失败态。
      state.luxuryAd.briefRefAssets = luxuryAdBriefReferenceAssets().map((x, i) => {
        const inThisBatch = i >= start && i < start + files.length;
        return inThisBatch && x ? ({ ...x, uploading: false, failed: true }) : x;
      });
      syncLuxuryAdUploadFlags();
      renderLuxuryAdBriefRefs();
      updateLuxuryAdStepLocks();
      toast('需求参考图上传失败：' + err.message, 'error');
    }
  }

  async function uploadLuxuryAdAssets(fileList, { shotIndex = null } = {}) {
    if (state.luxuryAd.keyframeGenerating) return toast('正在生成画面预览，完成后再替换素材', 'error');
    const targetShot = luxuryAdNormalizeShotIndex(shotIndex);
    const currentRefs = luxuryAdReferenceAssets();
    const filledCount = currentRefs.filter(luxuryAdAssetFilled).length;
    const maxCount = targetShot !== null ? 1 : Math.max(0, 8 - filledCount);
    const picked = pickUploadableImages(fileList, { maxCount, label: '顺序画面' });
    const files = picked.files;
    if (!files.length) return toast(picked.error || '请按镜头顺序上传场景、品牌、质感或细节画面', 'error');
    let start = luxuryAdNextEmptyRefSlot(currentRefs, 0);
    let targetAssetIndex = null;
    if (targetShot !== null) {
      targetAssetIndex = Math.min(7, targetShot);
      start = targetAssetIndex;
    }
    const nextRefs = [...currentRefs];
    const assignedIndexes = [];
    let cursor = Math.max(0, start);
    files.forEach((f, i) => {
      const idx = targetShot !== null ? targetAssetIndex : luxuryAdNextEmptyRefSlot(nextRefs, cursor);
      if (idx < 0) return;
      cursor = idx + 1;
      assignedIndexes.push(idx);
      if (nextRefs[idx]?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(nextRefs[idx].previewUrl);
      nextRefs[idx] = {
        name: f.name || `分镜画面 ${idx + 1}`,
        url: '',
        previewUrl: URL.createObjectURL(f),
        uploading: true,
      };
    });
    setLuxuryAdReferenceAssets(nextRefs);
    if (targetShot !== null && state.luxuryAd.segments?.[targetShot]) {
      const refIndex = targetAssetIndex + 1;
      state.luxuryAd.segments[targetShot] = {
        ...state.luxuryAd.segments[targetShot],
        reference_index: refIndex,
        reference_label: luxuryAdReferenceLabel(refIndex),
        reference_mentions: ['@主商品', luxuryAdReferenceLabel(refIndex)],
        user_edited: true,
      };
    }
    syncLuxuryAdUploadFlags();
    if (targetShot !== null && Array.isArray(state.luxuryAd.keyframes)) state.luxuryAd.keyframes[targetShot] = {};
    else {
      state.luxuryAd.keyframes = [];
      if (state.luxuryAd.segments?.length) state.luxuryAd.storyboardDetailed = false;
    }
    renderLuxuryAdAssets();
    renderLuxuryAdStoryboard();
    updateLuxuryAdStepLocks();
    toast(targetShot !== null ? `正在上传第 ${targetShot + 1} 镜场景图…` : `已选择 ${files.length} 张顺序画面，正在上传…`);
    try {
      // 顺序画面并发上传，槽位仍按 assignedIndexes 固定，不会因为先后完成而乱序。
      const results = await Promise.allSettled(files.map(async (file, i) => {
        const idx = targetShot !== null ? targetAssetIndex : assignedIndexes[i];
        if (!Number.isFinite(idx) || idx < 0) return null;
        const imageUrl = await uploadDhImage(file, { role: 'luxury_sequence_reference' });
        revokeLuxuryBlobPreview(state.luxuryAd.refAssets[idx]);
        state.luxuryAd.refAssets[idx] = { ...state.luxuryAd.refAssets[idx], url: imageUrl, previewUrl: imageUrl, uploading: false };
        setLuxuryAdReferenceAssets(state.luxuryAd.refAssets);
        renderLuxuryAdAssets();
        renderLuxuryAdStoryboard();
        updateLuxuryAdStepLocks();
        return imageUrl;
      }));
      const failed = results.filter(x => x.status === 'rejected');
      if (failed.length) {
        // 失败的槽位不继续上传态，仍显示本地预览，让用户明确看到哪张需要删除重传。
        setLuxuryAdReferenceAssets(luxuryAdReferenceAssets().map((x, idx) => {
          const localBatchIndex = assignedIndexes.indexOf(idx);
          const failedHere = localBatchIndex >= 0 && results[localBatchIndex]?.status === 'rejected';
          return failedHere ? ({ ...x, uploading: false, failed: true }) : x;
        }));
        syncLuxuryAdUploadFlags();
        renderLuxuryAdAssets();
        renderLuxuryAdStoryboard();
        updateLuxuryAdStepLocks();
        return toast(`${failed.length} 张顺序画面上传失败，其余已保留`, 'error');
      }
      syncLuxuryAdUploadFlags();
      updateLuxuryAdStepLocks();
      toast(targetShot !== null ? `第 ${targetShot + 1} 个分镜画面已绑定，主商品图保持不变` : `已按空位追加 ${assignedIndexes.length} 张分镜画面，主商品图保持不变`, 'success');
    } catch (err) {
      // 这里是队列级异常；不伪造服务器 URL，只退出上传态并提示真实错误。
      setLuxuryAdReferenceAssets(luxuryAdReferenceAssets().map((x, idx) => (
        assignedIndexes.includes(idx) && x ? ({ ...x, uploading: false, failed: true }) : x
      )));
      syncLuxuryAdUploadFlags();
      renderLuxuryAdAssets();
      renderLuxuryAdStoryboard();
      updateLuxuryAdStepLocks();
      toast('顺序画面上传失败：' + err.message, 'error');
    }
  }

  async function uploadLuxuryAdBgm(fileList) {
    const file = Array.from(fileList instanceof FileList ? fileList : (Array.isArray(fileList) ? fileList : [fileList]))
      .find(f => f && (String(f.type || '').startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name || '')));
    if (!file) return toast('请上传背景音乐音频文件', 'error');
    const btn = $('#dhLuxAdBgmUpload');
    const old = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '上传中…'; }
    try {
      const fd = new FormData();
      fd.append('music', file);
      const r = await api('/api/projects/upload-music', { method: 'POST', body: fd });
      if (!r.success) throw new Error(r.error || '背景音乐上传失败');
      const data = r.data || {};
      state.luxuryAd.bgmAsset = {
        name: data.original_name || file.name || '背景音乐',
        original_name: data.original_name || file.name || '背景音乐',
        file_url: data.file_url || '',
        file_path: data.file_path || '',
        volume: luxuryAdBgmVolume(),
        voice_volume: luxuryAdVoiceVolume(),
        source: '用户上传',
        license: '用户自有或已获授权音乐',
      };
      renderLuxuryAdBgm();
      updateLuxuryAdStepLocks();
      setLuxuryProgress('bgm');
      toast('背景音乐已配置，会作为最后后期步骤叠加到成片', 'success');
    } catch (err) {
      toast('背景音乐上传失败：' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = old || '上传背景音乐'; }
    }
  }

  function luxuryShotDurationLabel(seg = {}, fallbackTotal = 30, count = 1) {
    const raw = Number(seg.duration || seg.duration_sec || seg.seconds || seg.end - seg.start);
    const seconds = Number.isFinite(raw) && raw > 0
      ? raw
      : Math.max(3, Math.round((Number(fallbackTotal) || 30) / Math.max(1, count || 1)));
    return `${Math.round(seconds)}s`;
  }

  function luxuryShotMotionLabel(seg = {}) {
    const raw = String(seg.camera_label || seg.camera_motion || seg.camera || seg.motion || seg.video_prompt || seg.i2v_brief || '')
      .replace(/\s+/g, ' ')
      .trim();
    const key = raw.toLowerCase().replace(/\s+/g, '_');
    if (!raw || raw.length > 48 || /prompt|exact uploaded|preserve product|广告需求|按广告内容|主产品\s*\d|镜头参考\s*\d/i.test(raw)) {
      if (key.includes('macro')) return '微距推进';
      if (key.includes('focus')) return '焦点转移';
      if (key.includes('slide') || key.includes('pan')) return '平滑横移';
      if (key.includes('push')) return '缓慢推进';
      if (key.includes('hold') || key.includes('static')) return '稳定停留';
      return '按分镜生成镜头运动';
    }
    const map = {
      slow_push_in: '缓慢推进',
      smooth_slide: '平滑横移',
      macro_push: '微距推进',
      focus_shift: '焦点转移',
      hold: '稳定停留',
    };
    return map[key] || raw;
  }

  function luxuryLooksLikeBriefCopy(value = '') {
    const s = String(value || '').replace(/\s+/g, ' ').trim();
    if (!s) return true;
    return s.length > 44
      || /(请做|帮我|我想|我要|需求|广告需求|卖点[\/／]?资料|目标客户|画面风格|产品\/品牌|不要像|最后引导|按广告需求|按广告内容|参考素材摘要|第一眼看|我要一个|我需要)/.test(s)
      || /(主产品|镜头参考)\s*\d+\s*[:：]/.test(s)
      || /\.(png|jpe?g|webp|gif)/i.test(s);
  }

  function luxuryProductSubjectForCopy() {
    return 'confirmed_subject';
  }

  function luxuryFallbackCopyByRole(role = '') {
    const r = String(role || '').toLowerCase();
    const map = {
      hook: '问题出现，需求变清楚',
      display: '主体出现，答案更具体',
      macro: '关键细节，被清楚看见',
      benefit: '真实体验，变化更自然',
      proof: '证据成立，选择更放心',
      cta: '现在行动，获取适合方案',
    };
    return map[r] || map.display;
  }

  function luxuryFallbackVisualByRole(role = '') {
    const r = String(role || '').toLowerCase();
    const map = {
      hook: '已确认的真实场景中，主体相关的问题或期待被清楚建立，画面不替换行业和主体。',
      display: '主体以用户需求、素材或剧本确认的方式出现，主体、人物和环境关系清楚。',
      macro: '靠近主体的关键证据或使用细节，只放大当前业务真正需要看见的内容。',
      benefit: '真实使用或互动场景中，主体带来的变化被人物动作、结果或对比自然说明。',
      proof: '通过一个已确认的证据点证明主体价值，不新增无关道具、场地或 UI。',
      cta: '主体与行动意图在同一画面内收束，留出后期字幕空间但不生成画面文字。',
    };
    return map[r] || map.display;
  }

  function luxuryShotVoiceText(seg = {}) {
    const raw = String(seg.ad_copy || seg.subtitle || seg.voiceover || seg.text || '').replace(/\s+/g, ' ').trim();
    if (luxuryLooksLikeBriefCopy(raw)) return luxuryFallbackCopyByRole(seg.shot_role || seg.role || seg.type);
    return raw.slice(0, 34);
  }

  function luxuryShotVisualText(seg = {}) {
    const raw = String(seg.scene_content || seg.display_visual || seg.visual || seg.scene || '').replace(/\s+/g, ' ').trim();
    if (luxuryLooksLikeBriefCopy(raw)
      || /^(按|根据).*(生成|推进)/.test(raw)
      || /主商品作为视觉中心|主商品占据画面中心|建立高端广告氛围|突出高级感|突出空间搭配效果|按广告需求|按广告内容/.test(raw)) {
      return luxuryFallbackVisualByRole(seg.shot_role || seg.role || seg.type);
    }
    return (raw || luxuryFallbackVisualByRole(seg.shot_role || seg.role || seg.type)).slice(0, 96);
  }

  function luxuryShotContentPrompt(seg = {}) {
    const raw = String(seg.content_prompt || seg.scene_prompt || seg.scene_content || seg.display_visual || seg.visual || seg.scene || '').replace(/\s+/g, ' ').trim();
    const visual = luxuryShotVisualText(seg);
    if (!raw || luxuryLooksLikeBriefCopy(raw) || /^(按|根据).*(生成|推进)/.test(raw)) return visual;
    return raw.slice(0, 180);
  }

  function luxuryShotNarrationText(seg = {}) {
    const raw = String(seg.narration || seg.voiceover || seg.ad_copy || seg.subtitle || seg.text || '').replace(/\s+/g, ' ').trim();
    if (luxuryLooksLikeBriefCopy(raw)) return luxuryFallbackCopyByRole(seg.shot_role || seg.role || seg.type);
    return raw.slice(0, 60);
  }

  function luxuryShotAngleText(seg = {}) {
    return String(seg.shot_angle || seg.angle || seg.shot_size || seg.framing || '').replace(/\s+/g, ' ').trim();
  }

  function luxuryShotMaterialUsage(seg = {}, index = 0) {
    const binding = luxuryAdShotBoundAssets(seg, index);
    const raw = String(seg.material_usage || seg.material_hint || seg.source_material || '').replace(/\s+/g, ' ').trim();
    if (raw) {
      if (/@(?:参考|分镜画面)\d+/.test(raw)) {
        if (binding.ref) {
          return raw
            .replace(/@参考\d+/g, `@分镜画面${binding.refIndex}`)
            .replace(/@分镜画面\d+/g, `@分镜画面${binding.refIndex}`)
            .slice(0, 90);
        }
        return '@主商品 / 未上传分镜画面时由 AI 按镜头提示生成';
      }
      return raw.slice(0, 90);
    }
    if (binding.ref) return `@主商品 + @分镜画面${binding.refIndex}`;
    return '@主商品 / 未上传分镜画面时由 AI 按镜头提示生成';
  }

  function luxuryShotOtherText(seg = {}) {
    const raw = String(seg.other || seg.style_note || seg.tone_note || '').replace(/\s+/g, ' ').trim();
    const lighting = String(seg.lighting_style || seg.lighting || '').replace(/\s+/g, ' ').trim();
    const transition = String(seg.transition || seg.transition_note || '').replace(/\s+/g, ' ').trim();
    const parts = [];
    if (raw) parts.push(raw.replace(/旁白\/广告词/g, '旁白/字幕'));
    if (lighting && !raw.includes(lighting)) parts.push(`光线：${lighting}`);
    if (transition && !raw.includes(transition)) parts.push(`转场：${transition}`);
    if (!parts.length) parts.push(luxuryShotStyleNote(seg));
    return parts.join('；').slice(0, 180);
  }

  function luxuryShotActionText(seg = {}) {
    const raw = String(seg.action || seg.visual_action || seg.characters_action || seg.action_prompt || '').replace(/\s+/g, ' ').trim();
    const productOnly = luxuryIsMaterialProductShot(seg) && !luxuryCoreShotRequiresPerson(seg);
    if (raw && !luxuryLooksLikeBriefCopy(raw)) {
      if (productOnly && luxuryTextLooksLikeHumanInstruction(raw)) {
        return raw
          .replace(/人物或镜头/g, '镜头')
          .replace(/人物与场景/g, '产品与场景')
          .replace(/人物/g, '主体')
          .replace(/真人讲解者|讲解者|讲解员|导购|顾问|主持人|演员/g, '镜头')
          .replace(/手势|指向|触摸|走入|走进|入场|带观众/g, '镜头引导')
          .slice(0, 120);
      }
      return raw.slice(0, 120);
    }
    const role = String(seg.shot_role || seg.role || seg.type || '').toLowerCase();
    if (role === 'hook') return '人物或主体用一个明确动作引出当前问题或期待。';
    if (role === 'macro') return '人物手部或主体关键部位完成一次细节展示动作。';
    if (role === 'benefit' || role === 'proof') return '人物或主体完成体验、展示、确认或对比动作，让价值通过证据成立。';
    if (role === 'cta') return '人物或主体完成收束动作，表达选择、确认或行动意图。';
    return '人物或主体按剧本完成当前动作，动作与广告词同步。';
  }

  function luxuryShotEmotionText(seg = {}) {
    const raw = String(seg.emotion || seg.mood || seg.atmosphere || seg.expression || seg.tone || '').replace(/\s+/g, ' ').trim();
    if (raw && !luxuryLooksLikeBriefCopy(raw)) return raw.slice(0, 90);
    const role = String(seg.shot_role || seg.role || seg.type || '').toLowerCase();
    if (role === 'hook') return '安静、克制、带一点期待感。';
    if (role === 'macro') return '专注、细腻，突出高级质感。';
    if (role === 'cta') return '确定、清晰、可信。';
    return '自然放松，有真实商业广告的呼吸感。';
  }

  function luxuryShotAudioText(seg = {}) {
    const raw = String(seg.sfx_audio || seg.sfx || seg.audio || seg.sound || seg.sound_design || '').replace(/\s+/g, ' ').trim();
    if (raw && !luxuryLooksLikeBriefCopy(raw)) return raw.slice(0, 110);
    const role = String(seg.shot_role || seg.role || seg.type || '').toLowerCase();
    if (role === 'macro') return '轻微质感声、柔和提示音，配合细节推进。';
    if (role === 'cta') return '音乐收束，字幕或品牌提示清晰落点。';
    return '低频氛围音乐，环境声轻，不盖过配音和字幕。';
  }

  function luxuryAdShotRefIndex(seg = {}, index = 0) {
    const refs = luxuryAdReferenceAssets();
    const hasRefAt = idx => {
      const ref = refs[idx - 1];
      return !!(ref && (ref.url || ref.previewUrl || ref.name || ref.uploading));
    };
    const raw = Number(seg.reference_index ?? seg.referenceImageIndex ?? seg.ref_index);
    if (!refs.length) return 0;
    if (Number.isFinite(raw) && raw > 0) {
      const idx = Math.round(raw);
      if (idx > refs.length || !hasRefAt(idx)) return 0;
      if (seg.user_edited) return idx;
      return idx === index + 1 ? idx : (hasRefAt(index + 1) ? index + 1 : 0);
    }
    return hasRefAt(index + 1) ? index + 1 : 0;
  }

  function luxuryAdReferenceLabel(refIndex = 0) {
    return Number(refIndex) > 0 ? `@分镜画面${Number(refIndex)}` : '@主商品';
  }

  function luxuryAdShotBoundAssets(seg = {}, index = 0) {
    const product = state.luxuryAd.productAsset || null;
    const refs = luxuryAdReferenceAssets();
    const refIndex = luxuryAdShotRefIndex(seg, index);
    const ref = refIndex > 0 ? refs[refIndex - 1] : null;
    const items = [
      { key: 'product', label: '@主商品', name: product?.name || '主产品图', asset: product },
    ];
    if (ref) items.push({ key: `ref-${refIndex}`, label: `@分镜画面${refIndex}`, name: ref.name || `分镜画面 ${refIndex}`, asset: ref });
    return { refIndex, ref, items };
  }

  function luxuryTextLooksLikeHumanInstruction(value = '') {
    return /真人|人物|讲解员|讲解者|导购|顾问|主持人|演员|入场|走入|走进|带观众|手势|指向|触摸|person_required|person|human|presenter|actor|walks? in|walking into|enters? the frame|pointing|gesture/i.test(String(value || ''));
  }

  function luxuryIsMaterialProductShot(seg = {}) {
    const text = [
      state.luxuryAd.productSubject,
      state.luxuryAd.productName,
      seg.title,
      seg.objective,
      seg.intent,
      seg.purpose,
      seg.content_prompt,
      seg.scene_content,
      seg.display_visual,
      seg.visual,
    ].filter(Boolean).join(' ');
    return /钢|金属|板材|建材|材料|材质|幕墙|墙面|外立面|展墙|展厅|建筑|steel|metal|panel|sheet|facade|wall|material|building|showroom/i.test(text);
  }

  function luxuryCoreShotRequiresPerson(seg = {}) {
    const text = [
      seg.title,
      seg.objective,
      seg.intent,
      seg.purpose,
      seg.content_prompt,
      seg.scene_content,
      seg.display_visual,
      seg.visual,
    ].filter(Boolean).join(' ');
    if (/真人|人物出镜|同一人物|真人讲解者|讲解员|讲解者|导购|顾问|主持人|模特|入场|走入|走进|带观众|手势|指向|触摸|person|human|presenter|host|model|woman|man|girl|boy|walks? in|walking into|enters? the frame|standing beside|pointing at|gesture/i.test(text)) return true;
    if (luxuryIsMaterialProductShot(seg)) return false;
    return /人物|手部|手势|指向|触摸|走入|走进|入场|表情|person|human|hand|gesture|point|touch|walk/i.test(String(seg.action || seg.visual_action || ''));
  }

  function luxuryAdProductionGate(segments = [], { finalKeyframes = false } = {}) {
    const list = Array.isArray(segments) ? segments : [];
    const humanShotIndexes = list
      .map((seg, i) => luxuryCoreShotRequiresPerson(seg) ? i + 1 : 0)
      .filter(Boolean);
    const person = luxuryAdPersonAssetPayload();
    const personUrl = compactLuxuryUrl(person?.image_url || person?.url || '');
    const actorUploading = !!state.luxuryAd.personAsset?.uploading;
    const actorReady = !!personUrl && !/^blob:/i.test(personUrl) && !actorUploading;
    const actorIsAi = !!person && luxuryAdActorIsAiGenerated(person);
    const actorIsRealPerson = !!person && luxuryAdActorIsRealPerson(person);
    const actorUsableForKeyframes = !!person && luxuryAdActorUsableForKeyframes(person);
    const blocked = !!finalKeyframes && humanShotIndexes.length > 0 && (!actorReady || !actorUsableForKeyframes);
    const reason = actorUploading
      ? '人物参考仍在上传或生成中，不能进入真实关键帧。'
      : actorReady && actorIsAi
        ? '真实关键帧已停止：当前选择的是普通 AI 拟真参考，不是可用于人物锁的真人照片/AI 真人感演员包。请重新生成演员包、上传真人参考或选择角色库演员。'
        : '有人物镜头但还没有确认可用演员参考。请先生成 AI 真人感演员包、上传真人参考或选择角色素材库演员。';
    return {
      stage: finalKeyframes ? 'final_keyframe_gate' : 'storyboard_review_gate',
      human_required: humanShotIndexes.length > 0,
      human_shot_indexes: humanShotIndexes,
      actor_reference: {
        status: actorReady ? (actorUsableForKeyframes ? 'confirmed' : 'not_real_person') : 'missing',
        source: person?.type || '',
        name: person?.name || '',
        image_url: personUrl,
        reference_kind: person?.reference_kind || '',
        is_ai_generated: actorIsAi,
        real_person_reference: actorIsRealPerson,
        production_usable_actor: actorUsableForKeyframes,
      },
      final_keyframes_ready: !blocked,
      blocked,
      reason: blocked ? reason : '',
    };
  }

  function luxuryProductOnlyPrompt(seg = {}, index = 0) {
    const binding = luxuryAdShotBoundAssets(seg, index);
    const visual = String(seg.display_visual || seg.visual || seg.scene_content || seg.content_prompt || '').trim();
    const refTag = binding.ref ? ` 和 @分镜画面${binding.refIndex}` : '';
    return `使用 @主商品${refTag} 生成这一镜头：${visual || '按确认业务主体呈现当前镜头证据'}。保持已确认主体、场景证据、构图和光线稳定。画面只呈现当前镜头确认的主体/服务/场景证据，不加入额外主体或画面文字。`;
  }

  function luxuryAdTopviewPrompt(seg = {}, index = 0) {
    const binding = luxuryAdShotBoundAssets(seg, index);
    const visual = String(seg.display_visual || seg.visual || seg.scene || '').trim();
    const motion = luxuryShotMotionLabel(seg);
    const productTag = '@主商品';
    const refTag = binding.ref ? ` 和 @分镜画面${binding.refIndex}` : '';
    const existing = String(seg.topview_prompt || seg.reference_prompt || '').trim();
    const productOnly = luxuryIsMaterialProductShot(seg) && !luxuryCoreShotRequiresPerson(seg);
    if (productOnly && luxuryTextLooksLikeHumanInstruction(existing)) return luxuryProductOnlyPrompt(seg, index);
    if (existing && !/@(?:参考|分镜画面)\d+/.test(existing)) return existing;
    if (existing && binding.ref) {
      const sameRef = new RegExp(`@(参考|分镜画面)${binding.refIndex}(?!\\d)`);
      if (sameRef.test(existing)) {
        return existing.replace(new RegExp(`@参考${binding.refIndex}(?!\\d)`, 'g'), `@分镜画面${binding.refIndex}`);
      }
    }
    if (productOnly) return luxuryProductOnlyPrompt(seg, index);
    return `使用 ${productTag}${refTag} 生成这一镜头：${visual || '按镜头任务呈现确认主体'}。镜头运动：${motion}。保持已确认主体、人物、场景证据和构图稳定，不生成画面文字。`;
  }

  function luxuryNormalizeUiOverlay(value, seg = {}) {
    const raw = value && typeof value === 'object'
      ? value
      : (String(value || '').trim() ? { content: String(value || '').trim() } : null);
    const source = [
      raw?.type,
      raw?.content,
      raw?.motion,
      raw?.style,
      seg.action,
      seg.visual,
      seg.content_prompt,
    ].filter(Boolean).join(' ');
    if (!raw && !/(UI|app|screen|phone|mobile|popup|card|notification|dashboard|chart|waveform|check|tick|order|chat|message|interface|floating|hologram|overlay|弹窗|卡片|界面|手机|订单|通知|勾|对勾|确认|数据|波形|图表|悬浮|全息|智能体|助手)/i.test(source)) return null;
    const type = String(raw?.type || '').trim()
      || (/(check|tick|确认|对勾|勾)/i.test(source) ? 'confirmation_badge'
        : (/(waveform|音频|波形)/i.test(source) ? 'audio_waveform'
          : (/(dashboard|chart|数据|图表)/i.test(source) ? 'data_panel'
            : (/(chat|message|消息|对话)/i.test(source) ? 'message_cards' : 'app_ui_cards'))));
    const placement = String(raw?.placement || raw?.position || '').trim()
      || (/(phone|mobile|手机)/i.test(source) ? '贴近手机屏幕' : '主体旁侧悬浮，不遮挡人脸和产品');
    const content = String(raw?.content || raw?.text || source || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    const motion = String(raw?.motion || raw?.animation || '').trim()
      || (/(check|tick|确认|对勾|勾)/i.test(source) ? '轻微弹出并柔和发光' : '半透明卡片轻滑入场后稳定停留');
    const style = String(raw?.style || '').trim() || '极简半透明玻璃质感，无无关文字';
    return { type, placement, content, motion, style };
  }

  function luxuryUiOverlaySummary(value, seg = {}) {
    const ui = luxuryNormalizeUiOverlay(value, seg);
    if (!ui) return '';
    return [ui.type, ui.placement, ui.content, ui.motion].filter(Boolean).join(' · ');
  }

  function luxuryShotStyleNote(seg = {}) {
    const raw = String(seg.style_note || seg.other || seg.tone_note || '').replace(/\s+/g, ' ').trim();
    if (raw) return raw.replace(/旁白\/广告词/g, '成片广告词').slice(0, 120);
    const copy = luxuryShotVoiceText(seg);
    const stage = luxuryNormalizeSceneStage(seg.story_stage, seg.shot_role || seg.role || seg.type);
    return `成片广告词：${copy || '待生成'}；风格：${stage}，克制高级，画面干净，不出现无关文字。`;
  }

  function applyLuxuryShotBindings(segments = []) {
    return (Array.isArray(segments) ? segments : []).map((seg, i) => {
      const refIndex = luxuryAdShotRefIndex(seg, i);
      const label = luxuryAdReferenceLabel(refIndex);
      return {
        ...seg,
        story_stage: luxuryNormalizeSceneStage(seg.story_stage, seg.shot_role || seg.role || seg.type, i, segments.length || 5),
        shot_size: seg.shot_size || seg.framing || '',
        shot_angle: luxuryShotAngleText(seg),
        content_prompt: luxuryShotContentPrompt(seg),
        narration: luxuryShotNarrationText(seg),
        ad_copy: luxuryShotNarrationText(seg),
        style_note: luxuryShotStyleNote(seg),
        voiceover: luxuryShotNarrationText(seg),
        subtitle: luxuryShotNarrationText(seg),
        text: luxuryShotNarrationText(seg),
        scene_content: luxuryShotVisualText(seg),
        visual: luxuryShotVisualText(seg),
        display_visual: luxuryShotVisualText(seg),
        action: luxuryShotActionText(seg),
        visual_action: luxuryShotActionText(seg),
        emotion: luxuryShotEmotionText(seg),
        mood: luxuryShotEmotionText(seg),
        sfx_audio: luxuryShotAudioText(seg),
        reference_index: refIndex,
        reference_label: label,
        reference_mentions: refIndex > 0 ? ['@主商品', label] : ['@主商品'],
        topview_prompt: luxuryAdTopviewPrompt({ ...seg, reference_index: refIndex }, i),
        ui_overlay: luxuryNormalizeUiOverlay(seg.ui_overlay || seg.uiOverlay || seg.overlay_prompt || seg.vfx_prompt || null, seg),
        material_usage: luxuryShotMaterialUsage({ ...seg, reference_index: refIndex }, i),
        material_hint: luxuryShotMaterialUsage({ ...seg, reference_index: refIndex }, i),
        other: luxuryShotOtherText(seg),
      };
    });
  }

  function luxuryShotObjectiveText(seg = {}) {
    return String(
      seg.objective
      || seg.intent
      || seg.purpose
      || seg.script_purpose
      || seg.purpose_label
      || seg.ui_overlay?.content
      || seg.uiOverlay?.content
      || seg.source_beat?.spoken_intent
      || seg.source_beat?.character_goal
      || seg.source_beat?.solution_step
      || ''
    ).trim();
  }

  function compactLuxurySegments(segments = []) {
    return applyLuxuryShotBindings(segments).map((seg, i) => {
      const shotIndex = luxuryFrameIndex(seg, i);
      return {
        index: shotIndex,
        title: seg.title || `镜头 ${shotIndex + 1}`,
        role: seg.role || seg.shot_role || 'display',
        story_stage: luxuryNormalizeSceneStage(seg.story_stage, seg.shot_role || seg.role || seg.type, shotIndex, segments.length || 5),
        shot_size: seg.shot_size || seg.framing || '',
        shot_angle: luxuryShotAngleText(seg),
        objective: luxuryShotObjectiveText(seg),
        purpose: seg.purpose || seg.script_purpose || seg.purpose_label || '',
        script_purpose: seg.script_purpose || seg.purpose_label || seg.purpose || '',
        duration: seg.duration || seg.duration_sec || 6,
        content_prompt: luxuryShotContentPrompt(seg),
        narration: luxuryShotNarrationText(seg),
        ad_copy: luxuryShotNarrationText(seg),
        style_note: luxuryShotStyleNote(seg),
        voiceover: luxuryShotNarrationText(seg),
        subtitle: luxuryShotNarrationText(seg),
        text: luxuryShotNarrationText(seg),
        scene_content: luxuryShotVisualText(seg),
        visual: luxuryShotVisualText(seg),
        display_visual: luxuryShotVisualText(seg),
        action: luxuryShotActionText(seg),
        visual_action: luxuryShotActionText(seg),
        emotion: luxuryShotEmotionText(seg),
        mood: luxuryShotEmotionText(seg),
        sfx_audio: luxuryShotAudioText(seg),
        camera: seg.camera || seg.camera_motion || seg.motion || '',
        camera_label: seg.camera_label || luxuryShotMotionLabel(seg),
        reference_index: luxuryAdShotRefIndex(seg, shotIndex),
        reference_label: luxuryAdReferenceLabel(luxuryAdShotRefIndex(seg, shotIndex)),
        topview_prompt: luxuryAdTopviewPrompt(seg, shotIndex),
        material_usage: luxuryShotMaterialUsage(seg, shotIndex),
        material_hint: luxuryShotMaterialUsage(seg, shotIndex),
        other: luxuryShotOtherText(seg),
        transition: seg.transition || '',
        lighting_style: seg.lighting_style || seg.lighting || '',
        product_subject: seg.product_subject || '',
        storyboard_director_agent: !!seg.storyboard_director_agent,
        scene_type_lock: seg.scene_type_lock || '',
        environment_lock: seg.environment_lock || '',
        visual_contract: seg.visual_contract || null,
        qa_contract: seg.qa_contract || '',
        director_prompt: seg.director_prompt || '',
        reference_prompt: seg.reference_prompt || '',
        ui_overlay: luxuryNormalizeUiOverlay(seg.ui_overlay || seg.uiOverlay || seg.overlay_prompt || seg.vfx_prompt || null, seg),
        // Strict handoff fields: these are generated by the backend storyboard
        // compiler and must be preserved when requesting keyframes.
        strict_storyboard_contract_required: !!seg.strict_storyboard_contract_required,
        strict_storyboard_contract: seg.strict_storyboard_contract || null,
        prompt_preflight: seg.prompt_preflight || null,
        compiled_image_prompt: seg.compiled_image_prompt || '',
      };
    });
  }

  function compactLuxuryKeyframes(keyframes = [], segments = []) {
    const cleanSegments = compactLuxurySegments(segments);
    return (Array.isArray(keyframes) ? keyframes : []).map((kf, i) => {
      const shotIndex = luxuryFrameIndex(kf, i);
      const seg = cleanSegments.find(item => luxuryFrameIndex(item, -1) === shotIndex) || cleanSegments[i] || {};
      return {
        index: shotIndex,
        image_url: compactLuxuryUrl(kf.image_url || kf.imageUrl || ''),
        keyframe_id: kf.keyframe_id || kf.id || '',
        title: kf.title || seg.title || `镜头 ${shotIndex + 1}`,
        role: kf.role || seg.role || 'display',
        story_stage: luxuryNormalizeSceneStage(kf.story_stage || seg.story_stage, kf.role || seg.role, shotIndex, keyframes.length || segments.length || 5),
        shot_size: kf.shot_size || seg.shot_size || '',
        duration: kf.duration || seg.duration || 6,
        ad_copy: kf.ad_copy || kf.voiceover || seg.ad_copy || seg.voiceover || '',
        style_note: kf.style_note || seg.style_note || '',
        voiceover: kf.voiceover || seg.voiceover || '',
        subtitle: kf.subtitle || seg.subtitle || '',
        text: kf.text || seg.text || '',
        scene_content: kf.scene_content || seg.scene_content || '',
        visual: kf.visual || seg.visual || '',
        display_visual: kf.display_visual || seg.display_visual || '',
        action: kf.action || seg.action || '',
        emotion: kf.emotion || seg.emotion || '',
        sfx_audio: kf.sfx_audio || seg.sfx_audio || '',
        camera: kf.camera || seg.camera || '',
        camera_label: kf.camera_label || seg.camera_label || '',
        reference_index: Number(kf.reference_index ?? seg.reference_index ?? 0),
        reference_label: kf.reference_label || seg.reference_label || '',
        active_reference_image: compactLuxuryUrl(kf.active_reference_image || ''),
        ui_overlay: luxuryNormalizeUiOverlay(kf.ui_overlay || seg.ui_overlay || null, { ...seg, ...kf }),
      };
    }).filter(k => k.image_url);
  }

  function luxuryFrameHasImage(frame = {}) {
    return !!(frame && (frame.image_url || frame.imageUrl || frame.url));
  }

  function luxuryFrameIndex(frame = {}, fallback = 0) {
    const raw = frame?.shot_index ?? frame?.index ?? frame?.scene_index ?? frame?.shotNo ?? frame?.shot_no;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    return fallback;
  }

  function luxuryFrameHasExplicitIndex(frame = {}) {
    return ['shot_index', 'index', 'scene_index', 'shotNo', 'shot_no'].some(key => {
      const n = Number(frame?.[key]);
      return Number.isFinite(n) && n >= 0;
    });
  }

  function luxurySelectItemsForShotRequest(items = [], singleIndex = null, total = 0) {
    const list = Array.isArray(items) ? items : [];
    if (!Number.isInteger(singleIndex)) return list.slice(0, total || list.length);
    const exact = list.filter((item, i) => {
      if (!luxuryFrameHasExplicitIndex(item)) return false;
      return luxuryFrameIndex(item, i) === singleIndex;
    });
    if (exact.length) return exact.slice(0, 1);
    if (list.length === 1 && !luxuryFrameHasExplicitIndex(list[0])) {
      return [{ ...(list[0] || {}), index: singleIndex, shot_index: singleIndex }];
    }
    return [];
  }

  function mergeLuxuryKeyframesPreservingImages(existing = [], incoming = [], total = 0) {
    const incomingMax = (Array.isArray(incoming) ? incoming : []).reduce((max, frame, i) => Math.max(max, luxuryFrameIndex(frame, i) + 1), 0);
    const size = Math.max(total || 0, existing.length || 0, incoming.length || 0, incomingMax);
    const incomingByIndex = new Map();
    (Array.isArray(incoming) ? incoming : []).forEach((frame, i) => incomingByIndex.set(luxuryFrameIndex(frame, i), frame || {}));
    return Array.from({ length: size }, (_, i) => {
      const next = incomingByIndex.has(i) ? (incomingByIndex.get(i) || {}) : {};
      const prev = existing[i] || {};
      if (luxuryFrameHasImage(next)) return next;
      if (luxuryFrameHasImage(prev)) return prev;
      return Object.keys(next).length ? next : prev;
    });
  }

  function luxuryAdOutlineMaterialNeed(seg = {}, index = 0) {
    const raw = String(seg.required_material || seg.material_need || seg.material_requirement || seg.material_usage || seg.material_hint || '').replace(/\s+/g, ' ').trim();
    if (raw && !/@(?:主商品|参考|分镜画面)\d*/.test(raw)) return raw.slice(0, 80);
    const role = String(seg.role || seg.shot_role || seg.type || '').toLowerCase();
    if (index === 0 || role === 'hook') return '开场氛围图、主商品第一印象或能代表品牌质感的画面';
    if (role === 'macro') return '产品细节、材质纹理、工艺特写或可放大的局部图';
    if (role === 'benefit') return '真实使用场景、空间应用图或目标客户会理解的场景画面';
    if (role === 'proof') return '卖点证明、对比细节、工艺过程或可信的结果画面';
    if (role === 'cta') return '品牌结尾、完整产品展示或适合放行动引导的干净画面';
    return '主商品图、产品应用图、品牌图或这一镜需要出现的场景参考';
  }

  function saveLuxuryAdOutlineField(index, field, value) {
    const idx = Number(index);
    if (!Number.isFinite(idx) || idx < 0 || !state.luxuryAd.segments?.[idx]) return;
    const clean = String(value || '').trim();
    const seg = state.luxuryAd.segments[idx];
    const next = { ...seg, user_edited: true };
    if (field === 'title') next.title = clean || seg.title || `镜头 ${idx + 1}`;
    if (field === 'role') {
      next.role = clean || 'display';
      next.story_stage = luxuryShotRoleName(next.role);
      next.stage_user_edited = true;
    }
    if (field === 'objective') {
      next.objective = clean;
      next.intent = clean;
      next.purpose = clean;
    }
    if (field === 'material_need') {
      next.material_need = clean;
      next.required_material = clean;
      next.material_requirement = clean;
    }
    if (field === 'copy_direction') {
      next.copy_direction = clean;
    }
    state.luxuryAd.segments[idx] = next;
    state.luxuryAd.storyboardDetailed = false;
    if (Array.isArray(state.luxuryAd.keyframes) && state.luxuryAd.keyframes.length) state.luxuryAd.keyframes = [];
    updateLuxuryAdStepLocks();
  }

  function luxuryAdDefaultRoleForIndex(index = 0, total = 6) {
    const roles = ['hook', 'display', 'macro', 'benefit', 'proof', 'cta'];
    if (index <= 0) return 'hook';
    if (index >= Math.max(1, total) - 1) return 'cta';
    return roles[Math.min(index, roles.length - 2)] || 'benefit';
  }

  function createLuxuryAdManualSegment(index = 0, total = 6) {
    const role = luxuryAdDefaultRoleForIndex(index, total);
    const stage = luxuryNormalizeSceneStage('', role, index, total);
    return {
      index,
      title: `第 ${index + 1} 个分镜`,
      role,
      story_stage: stage,
      objective: '写清楚这一镜在广告里要表达什么、解决什么。',
      material_need: '上传这一镜需要的画面；没有画面时，AI 会按这里的说明补图。',
      required_material: '上传这一镜需要的画面；没有画面时，AI 会按这里的说明补图。',
      material_requirement: '上传这一镜需要的画面；没有画面时，AI 会按这里的说明补图。',
      copy_direction: '这一镜最终给观众听到或看到的话，会在剧本生成阶段生成。',
      duration: Math.max(3, Math.round((Number(state.luxuryAd.durationSec) || 30) / Math.max(1, total))),
      material_usage: '@主商品 / 待绑定分镜画面',
      user_edited: true,
    };
  }

  function normalizeLuxuryAdSegmentOrder() {
    const segments = Array.isArray(state.luxuryAd.segments) ? state.luxuryAd.segments : [];
    const total = Math.max(1, segments.length);
    state.luxuryAd.segments = segments.map((seg, i) => {
      const role = seg.stage_user_edited
        ? (seg.role || seg.shot_role || luxuryAdDefaultRoleForIndex(i, total))
        : luxuryAdDefaultRoleForIndex(i, total);
      const title = /^第\s*\d+\s*个分镜$/.test(String(seg.title || '').trim())
        ? `第 ${i + 1} 个分镜`
        : seg.title;
      return {
        ...seg,
        index: i,
        title: title || `第 ${i + 1} 个分镜`,
        role,
        story_stage: luxuryNormalizeSceneStage(seg.stage_user_edited ? seg.story_stage : '', role, i, total),
      };
    });
  }

  function markLuxuryAdStructureChanged({ keepDetailed = false } = {}) {
    normalizeLuxuryAdSegmentOrder();
    if (!keepDetailed) state.luxuryAd.storyboardDetailed = false;
    if (Array.isArray(state.luxuryAd.keyframes) && state.luxuryAd.keyframes.length) state.luxuryAd.keyframes = [];
    renderLuxuryAdStoryboard();
    updateLuxuryAdStepLocks();
  }

  function rebalanceLuxuryAdSegmentDurations(totalDurationSec) {
    const duration = Math.max(5, Number(totalDurationSec) || Number(state.luxuryAd.durationSec) || 30);
    const segments = Array.isArray(state.luxuryAd.segments) ? state.luxuryAd.segments : [];
    if (!segments.length) return false;
    const base = Math.floor((duration / segments.length) * 10) / 10;
    let used = 0;
    state.luxuryAd.segments = segments.map((seg, i) => {
      const isLast = i === segments.length - 1;
      const nextDuration = isLast ? Math.max(1, Math.round((duration - used) * 10) / 10) : Math.max(1, base);
      const start = Math.round(used * 10) / 10;
      const end = Math.round((used + nextDuration) * 10) / 10;
      used = end;
      return {
        ...seg,
        duration: nextDuration,
        duration_sec: nextDuration,
        seconds: nextDuration,
        start,
        end,
      };
    });
    if (Array.isArray(state.luxuryAd.keyframes) && state.luxuryAd.keyframes.length) {
      state.luxuryAd.keyframes = state.luxuryAd.keyframes.map((kf, i) => {
        const seg = state.luxuryAd.segments[i] || {};
        const nextDuration = Number(seg.duration || seg.duration_sec || seg.seconds) || kf.duration || 6;
        return { ...kf, duration: nextDuration, duration_sec: nextDuration, seconds: nextDuration };
      });
    }
    return true;
  }

  function handleLuxuryAdDurationChange(value) {
    const nextDuration = Math.max(5, Number(value) || 30);
    const previousDuration = Number(state.luxuryAd.durationSec) || 30;
    state.luxuryAd.durationSec = nextDuration;
    const hadSegments = rebalanceLuxuryAdSegmentDurations(nextDuration);
    state.luxuryAd.taskId = '';
    state.luxuryAd.taskUrl = '';
    updateLuxuryAdOutputHint();
    renderLuxuryAdStoryboard();
    updateLuxuryAdStepLocks();
    if (hadSegments && nextDuration !== previousDuration) {
      toast(`已切换为 ${nextDuration} 秒，原广告结构和上传素材已保留，并重新分配了每个分镜时长`, 'success');
    }
  }

  function addLuxuryAdSegment(afterIndex = null) {
    const segments = Array.isArray(state.luxuryAd.segments) ? [...state.luxuryAd.segments] : [];
    if (segments.length >= 8) return toast('最多 8 个分镜，建议先删除不需要的分镜', 'error');
    const insertAt = Number.isFinite(Number(afterIndex))
      ? Math.min(segments.length, Math.max(0, Number(afterIndex) + 1))
      : segments.length;
    segments.splice(insertAt, 0, createLuxuryAdManualSegment(insertAt, segments.length + 1));
    state.luxuryAd.segments = segments;
    const refs = luxuryAdReferenceAssets();
    refs.splice(insertAt, 0, null);
    setLuxuryAdReferenceAssets(refs);
    if (Array.isArray(state.luxuryAd.keyframes)) state.luxuryAd.keyframes.splice(insertAt, 0, {});
    markLuxuryAdStructureChanged();
    toast(`已新增第 ${insertAt + 1} 个分镜`, 'success');
  }

  async function deleteLuxuryAdSegment(index) {
    const idx = Number(index);
    const segments = Array.isArray(state.luxuryAd.segments) ? [...state.luxuryAd.segments] : [];
    if (!Number.isFinite(idx) || idx < 0 || idx >= segments.length) return;
    if (segments.length <= 1) return toast('至少保留 1 个分镜', 'error');
    const ok = await DhConfirm({
      title: '删除这个分镜？',
      message: `会删除第 ${idx + 1} 个分镜，并清空后续已生成的预览视频。`,
      detail: '主商品不会被删除；分镜画面会按顺序重新对齐。',
      confirmText: '删除分镜',
      type: 'danger',
    });
    if (!ok) return;
    segments.splice(idx, 1);
    const refs = luxuryAdReferenceAssets();
    refs.splice(idx, 1);
    const nextRefs = setLuxuryAdReferenceAssets(refs);
    state.luxuryAd.segments = segments.map((seg, i) => {
      const refIndex = luxuryAdAssetFilled(nextRefs[i]) ? i + 1 : 0;
      return {
        ...seg,
        reference_index: refIndex,
        reference_label: luxuryAdReferenceLabel(refIndex),
        reference_mentions: refIndex > 0 ? ['@主商品', luxuryAdReferenceLabel(refIndex)] : ['@主商品'],
        user_edited: true,
      };
    });
    if (Array.isArray(state.luxuryAd.keyframes)) state.luxuryAd.keyframes.splice(idx, 1);
    markLuxuryAdStructureChanged({ keepDetailed: state.luxuryAd.storyboardDetailed });
    toast('已删除分镜，可以继续新增或重新生成剧本', 'success');
  }

  function moveLuxuryAdSegment(index, direction) {
    const idx = Number(index);
    const segments = Array.isArray(state.luxuryAd.segments) ? [...state.luxuryAd.segments] : [];
    const nextIdx = idx + (direction === 'up' ? -1 : 1);
    if (!Number.isFinite(idx) || idx < 0 || idx >= segments.length || nextIdx < 0 || nextIdx >= segments.length) return;
    [segments[idx], segments[nextIdx]] = [segments[nextIdx], segments[idx]];
    const refs = luxuryAdReferenceAssets();
    [refs[idx], refs[nextIdx]] = [refs[nextIdx], refs[idx]];
    const nextRefs = setLuxuryAdReferenceAssets(refs);
    state.luxuryAd.segments = segments.map((seg, i) => {
      const refIndex = luxuryAdAssetFilled(nextRefs[i]) ? i + 1 : 0;
      return {
        ...seg,
        reference_index: refIndex,
        reference_label: luxuryAdReferenceLabel(refIndex),
        reference_mentions: refIndex > 0 ? ['@主商品', luxuryAdReferenceLabel(refIndex)] : ['@主商品'],
        user_edited: true,
      };
    });
    if (Array.isArray(state.luxuryAd.keyframes)) [state.luxuryAd.keyframes[idx], state.luxuryAd.keyframes[nextIdx]] = [state.luxuryAd.keyframes[nextIdx], state.luxuryAd.keyframes[idx]];
    markLuxuryAdStructureChanged({ keepDetailed: state.luxuryAd.storyboardDetailed });
  }

  function renderLuxuryAdOutline(host, segments = []) {
    const info = deriveLuxuryBriefInfo(state.luxuryAd.content, segments, state.luxuryAd.briefInfo || {});
    state.luxuryAd.briefInfo = info;
    syncLuxuryBriefInfoToControls(info);
    const scenePlan = state.luxuryAd.storyboardDetailed ? (Array.isArray(segments) ? segments : []).slice(0, 18) : [];
    const product = state.luxuryAd.productAsset || null;
    const productUrl = product ? luxuryAssetPreviewUrl(product) : '';
    const productUploading = !!product?.uploading && !productUrl;
    const field = (label, name, value, attrs = '') => `<label class="dh-luxgen-brief-row">
      <span>${escapeHtml(label)}</span>
      <input class="dh-input" data-lux-brief-field="${escapeHtml(name)}" value="${escapeHtml(value || '')}" ${attrs}>
    </label>`;
    host.innerHTML = `<div class="dh-luxgen-brief-board">
      <details class="dh-luxgen-brief-details" open>
        <summary>
          <span><b>基础信息已整理</b><small>${escapeHtml(info.title || '未填写标题')} · ${escapeHtml(info.style || '高端商业广告')} · ${Number(info.duration_sec) || 30} 秒 · ${escapeHtml(info.aspect_ratio || '9:16')}</small></span>
          <em>基础信息可编辑</em>
        </summary>
        <section class="dh-luxgen-brief-panel">
        <div class="dh-luxgen-brief-grid">
          ${field('标题', 'title', info.title)}
          ${field('主题', 'theme', info.theme)}
          ${field('风格', 'style', info.style)}
          <label class="dh-luxgen-brief-row">
            <span>时长</span>
            <select class="dh-input" data-lux-brief-field="duration_sec">
              ${[15, 30, 45, 60].map(v => `<option value="${v}" ${Number(info.duration_sec) === v ? 'selected' : ''}>${v} 秒</option>`).join('')}
            </select>
          </label>
          <label class="dh-luxgen-brief-row">
            <span>比例</span>
            <select class="dh-input" data-lux-brief-field="aspect_ratio">
              ${['9:16', '16:9', '1:1', '4:3', '3:4'].map(v => `<option value="${v}" ${String(info.aspect_ratio) === v ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="dh-luxgen-brief-tags">
          <div>
            <b>风格基调</b>
            <input class="dh-input" data-lux-brief-field="style_tags" value="${escapeHtml((info.style_tags || []).join('、'))}" placeholder="如：商业质感、真实场景、高级光影、产品清晰">
            <button class="dh-btn dh-btn-ghost dh-btn-sm" type="button" id="dhLuxAdDetectStyle">AI 重新识别</button>
          </div>
        </div>
        </section>
      </details>
      <div class="dh-luxgen-outline-product-summary">
        <div class="dh-luxgen-outline-product-copy">
          <b>主体来源：${productUrl ? '主体主图已锁定' : (productUploading ? '上传中' : '按广告需求生成')}</b>
          <span>主体来源会应用到后续剧本、分镜画面和最终画面生成，用来锁定广告围绕的商品、空间、品牌物或核心视觉。没有上传时，系统按广告需求生成主体。</span>
        </div>
        <div class="dh-luxgen-outline-product-media">
          ${productUrl
            ? `<div class="dh-luxgen-outline-product-actions"><button type="button" class="dh-luxgen-product-card compact" data-lux-product-preview title="点击预览主体主图"><img src="${escapeHtml(productUrl)}" alt="${escapeHtml(product.name || '主体主图')}"><b>主体主图</b><span>${escapeHtml(product.name || '已上传')}</span></button><button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" id="dhLuxAdProductClearInline">删除主体图</button></div>`
            : productUploading
              ? `<div class="dh-luxgen-product-empty uploading"><b>主体主图上传中</b><span>${escapeHtml(product.name || '正在上传')}</span></div>`
              : `<button type="button" class="dh-btn dh-btn-ghost" id="dhLuxAdProductDropInline">上传主体主图</button>`}
        </div>
      </div>
      <section class="dh-luxgen-brief-scenes">
        <div class="dh-luxgen-brief-scenes-head">
          <b>${state.luxuryAd.storyboardDetailed ? '剧本生成依据' : '等待完整剧本'}</b>
          <span>${state.luxuryAd.storyboardDetailed ? '后续会按这些已确认镜头生成图片分镜。' : '竞品式流程：完整剧本未生成前不展示镜头行，避免把草稿当成最终分镜。'}</span>
        </div>
        <div class="dh-luxgen-brief-scene-grid">
          ${scenePlan.length ? scenePlan.map((seg, i) => {
        const roleValue = seg.stage_user_edited
          ? (seg.role || seg.shot_role || seg.type || luxuryAdDefaultRoleForIndex(i, segments.length || 1))
          : luxuryAdDefaultRoleForIndex(i, segments.length || 1);
        const role = luxuryShotRoleName(roleValue);
        const stage = luxuryNormalizeSceneStage(seg.stage_user_edited ? seg.story_stage : '', roleValue, i, scenePlan.length || 5) || role;
        const objective = String(seg.objective || seg.intent || seg.purpose || luxuryShotVisualText(seg) || '确定这一段在广告中的作用').replace(/\s+/g, ' ').slice(0, 96);
        const materialNeed = luxuryAdOutlineMaterialNeed(seg, i);
        return `<article class="dh-luxgen-brief-scene">
          <span>${String(i + 1).padStart(2, '0')}</span>
          <b>${escapeHtml(stage)}</b>
          <p>${escapeHtml(objective)}</p>
          <small>${escapeHtml(materialNeed)}</small>
        </article>`;
      }).join('') : `<article class="dh-luxgen-brief-scene"><span>…</span><b>等待剧本</b><p>确认基础信息后生成完整剧本审核表。</p><small>剧本生成完成后会直接展示镜、秒、画面、动作、台词、目的和状态，供你审核。</small></article>`}
        </div>
      </section>
    </div>`;
    updateLuxuryAdStepLocks();
  }

  function luxuryAdEmptyBlock(title, text) {
    return `<div class="dh-luxgen-empty"><b>${escapeHtml(title)}</b><span>${escapeHtml(text)}</span></div>`;
  }

  function luxuryAdShotTimeRange(seg = {}, i = 0, count = 1) {
    if (Number.isFinite(Number(seg.start)) && Number.isFinite(Number(seg.end))) {
      return `${Math.round(Number(seg.start) * 10) / 10}-${Math.round(Number(seg.end) * 10) / 10}s`;
    }
    const dur = Number(seg.duration || seg.duration_sec || seg.seconds || 0)
      || Math.max(3, Math.round((Number(state.luxuryAd.durationSec) || 30) / Math.max(1, count || 1)));
    const start = Math.round(i * dur * 10) / 10;
    const end = Math.round((start + dur) * 10) / 10;
    return `${start}-${end}s`;
  }

  function luxuryAdShotSeconds(seg = {}, fallbackTotal = 30, count = 1) {
    const raw = Number(seg.duration || seg.duration_sec || seg.seconds || 0);
    const seconds = Number.isFinite(raw) && raw > 0
      ? raw
      : Math.max(2, Math.round((Number(fallbackTotal) || 30) / Math.max(1, count || 1)));
    return Math.round(seconds * 10) / 10;
  }

  function luxuryScriptPurposeLabel(seg = {}, i = 0, total = 1) {
    const raw = String(seg.script_purpose || seg.purpose_label || '').trim();
    if (raw) return raw.slice(0, 24);
    const defaults = ['痛点', 'context', 'product_reveal', 'feature_1', 'feature_2', 'demo', 'proof', 'comparison', 'offer', '收束'];
    if (total >= 8) return defaults[Math.min(i, defaults.length - 1)] || 'beat';
    const role = String(seg.role || seg.shot_role || '').toLowerCase();
    if (role.includes('hook')) return '痛点';
    if (role.includes('macro')) return 'product_reveal';
    if (role.includes('benefit')) return 'feature';
    if (role.includes('proof')) return 'proof';
    if (role.includes('cta') || role.includes('end')) return '收束';
    return i === 0 ? '开场' : (i >= total - 1 ? '收束' : 'context');
  }

  function renderLuxuryCharacterCards(info = {}) {
    const characters = Array.isArray(info.characters) ? info.characters : [];
    if (!characters.length) return '';
    return `<section class="dh-luxgen-character-panel">
      <div class="dh-luxgen-character-head">
        <b>人物表</b>
        <span>用于后续分镜、人物一致性和对白关系。</span>
      </div>
      <div class="dh-luxgen-character-grid">
        ${characters.map((c, i) => `<article class="dh-luxgen-character-card">
          <strong>${escapeHtml(c.name || `人物 ${i + 1}`)}</strong>
          <small>${escapeHtml([
            c.role || (i === 0 ? '主讲 / 引导者' : '客户 / 决策者'),
            c.gender ? `性别：${luxuryPersonGenderLabel(c.gender)}` : '',
            c.origin ? `地域/族裔：${luxuryPersonOriginLabel(c.origin)}` : '',
          ].filter(Boolean).join(' · '))}</small>
          <p>${escapeHtml(c.description || '真实成年人，外貌、服装、发型、手部道具和动作习惯会在分镜中继续补全。')}</p>
        </article>`).join('')}
      </div>
    </section>`;
  }

  function renderLuxuryGlobalVisualBible() {
    const bible = state.luxuryAd.globalVisualBible || {};
    const rows = [
      ['风格', bible.style],
      ['色调', bible.tone],
      ['光照', bible.lighting],
      ['主场景', bible.main_scene],
    ].filter(([, value]) => String(value || '').trim());
    const characters = Array.isArray(bible.character_table)
      ? bible.character_table.filter(c => c && (c.name || c.appearance || c.role)).slice(0, 6)
      : [];
    const locks = bible.locks_summary && typeof bible.locks_summary === 'object'
      ? Object.entries(bible.locks_summary).filter(([, value]) => String(value || '').trim()).slice(0, 6)
      : [];
    if (!rows.length && !characters.length && !locks.length) return '';
    return `<section class="dh-luxgen-global-bible">
      <div class="dh-luxgen-character-head">
        <b>高级 · 全局视觉</b>
        <span>风格、色调、光照、人物、主场景会进入每个镜头执行包。</span>
      </div>
      ${rows.length ? `<div class="dh-lux-lock-grid">${rows.map(([label, value]) => `<div><small>${escapeHtml(label)}</small><b>${escapeHtml(String(value || '').slice(0, 180))}</b></div>`).join('')}</div>` : ''}
      ${characters.length ? `<div class="dh-luxgen-character-grid">${characters.map((c, i) => `<article class="dh-luxgen-character-card">
        <strong>${escapeHtml(c.name || `人物 ${i + 1}`)}</strong>
        <small>${escapeHtml([c.role, c.gender, c.origin].filter(Boolean).join(' · '))}</small>
        <p>${escapeHtml(c.appearance || c.outfit || c.behavior || '固定人物身份会进入每个有人物的镜头。')}</p>
      </article>`).join('')}</div>` : ''}
      ${locks.length ? `<div class="dh-lux-sheet-locks"><div class="dh-lux-sheet-lock-group"><small>锁定规则</small><div>${locks.map(([label, value]) => `<span><b>${escapeHtml(label)}</b>${escapeHtml(String(value || '').slice(0, 100))}</span>`).join('')}</div></div></div>` : ''}
    </section>`;
  }

  function luxuryShotDialogueText(seg = {}, characters = [], i = 0) {
    const rawDialogue = Array.isArray(seg.dialogue_lines)
      ? seg.dialogue_lines.join('\n')
      : String(seg.dialogue || seg.dialogue_text || seg.conversation || '').trim();
    if (rawDialogue) return rawDialogue.slice(0, 260);
    const voice = luxuryShotNarrationText(seg);
    if (!characters || characters.length < 2) return voice || '待生成广告词';
    if (voice && /[：:]/.test(voice)) return voice;
    return voice || '待生成广告词';
  }

  function validateLuxuryAdScriptSegments(segments = [], info = {}, { detail = true } = {}) {
    const errors = [];
    const list = Array.isArray(segments) ? segments : [];
    if (!list.length) errors.push('没有返回任何镜头。');
    const spec = luxuryAdPersonSpec();
    const castMode = String(spec.castMode || 'single');
    const expectedPeople = castMode === 'single' ? 1 : (castMode === 'group' ? 3 : 2);
    const characters = Array.isArray(info.characters) ? info.characters : [];
    if (detail && expectedPeople > 0 && characters.length < expectedPeople) {
      errors.push(`人物表数量不完整：当前 ${characters.length} 个，人物配置要求 ${expectedPeople} 个。`);
    }
    if (detail && castMode === 'single' && characters.length > 1) {
      errors.push(`人物配置为单人，但人物表返回了 ${characters.length} 个人物。`);
    }
    characters.slice(0, expectedPeople).forEach((c, i) => {
      if (!String(c.name || '').trim()) errors.push(`人物表第 ${i + 1} 个缺少人名。`);
      if (!String(c.gender || '').trim()) errors.push(`人物表「${c.name || i + 1}」缺少性别。`);
      if (!String(c.origin || '').trim()) errors.push(`人物表「${c.name || i + 1}」缺少地域/族裔/来源。`);
      const desc = String(c.description || '').trim();
      if (desc.length < 24) errors.push(`人物表「${c.name || i + 1}」描述过短，需要包含年龄、长相、发型、服装、手持物和动作习惯。`);
    });
    const scriptSpeakers = new Set();
    list.forEach((seg, i) => {
      const n = i + 1;
      const scenePayload = JSON.stringify(seg || {});
      if (/[?？]{3,}|�/.test(scenePayload)) errors.push(`第 ${n} 镜包含乱码或无法识别的占位符。`);
      if (!String(luxuryShotContentPrompt(seg) || '').trim()) errors.push(`第 ${n} 镜缺少画面内容。`);
      if (!String(luxuryShotActionText(seg) || '').trim()) errors.push(`第 ${n} 镜缺少动作/表情。`);
      if (!luxuryShotObjectiveText(seg)) errors.push(`第 ${n} 镜缺少编剧目的。`);
      const dialogue = Array.isArray(seg.dialogue_lines)
        ? seg.dialogue_lines.join('\n')
        : String(seg.dialogue || seg.dialogue_text || seg.conversation || '').trim();
      const voice = luxuryShotNarrationText(seg);
      if (expectedPeople >= 2) {
        const namedLines = dialogue.split(/\n+/).filter(x => /[：:]/.test(x));
        const speakerNames = new Set(namedLines.map(x => x.split(/[：:]/)[0].trim()).filter(Boolean));
        speakerNames.forEach(name => scriptSpeakers.add(name));
        if (!dialogue && !voice) errors.push(`第 ${n} 镜缺少台词/旁白。`);
      } else if (castMode === 'single') {
        const namedLines = dialogue.split(/\n+/).filter(x => /[：:]/.test(x));
        const speakerNames = new Set(namedLines.map(x => x.split(/[：:]/)[0].trim()).filter(Boolean));
        if (speakerNames.size > 1) errors.push(`第 ${n} 镜是单人模式，但对白出现了 ${speakerNames.size} 个说话人。`);
        if (!voice && !dialogue) errors.push(`第 ${n} 镜缺少单人旁白/台词。`);
      } else if (!voice && !dialogue) {
        errors.push(`第 ${n} 镜缺少台词/旁白。`);
      }
    });
    if (expectedPeople >= 2 && scriptSpeakers.size < 2) {
      errors.push(`双人剧本没有体现至少两个人名的对话，当前说话人 ${scriptSpeakers.size} 个。`);
    }
    if (errors.length) throw new Error(errors.slice(0, 8).join('；'));
    return true;
  }

  function validateLuxuryAdKeyframes(keyframes = [], segments = []) {
    const errors = [];
    const frames = Array.isArray(keyframes) ? keyframes : [];
    if (frames.length !== segments.length) errors.push(`分镜数量不一致：剧本 ${segments.length} 镜，返回 ${frames.length} 张。`);
    segments.forEach((seg, i) => {
      const kf = frames[i] || {};
      const expectedIndex = luxuryFrameIndex(seg, i);
      const labelIndex = luxuryFrameIndex(kf, expectedIndex);
      const shotLabel = `第 ${labelIndex + 1} 镜`;
      if (luxuryFrameHasExplicitIndex(kf) && labelIndex !== expectedIndex) {
        errors.push(`第 ${expectedIndex + 1} 镜返回了第 ${labelIndex + 1} 镜的内容。`);
      }
      if (!(kf.image_url || kf.imageUrl)) errors.push(`${shotLabel}没有生成图片。`);
      const referenceLocked = String(kf.reference_mode || '').includes('reference_locked');
      const qa = kf.qa || kf.shot_plan?.qa || null;
      if (!referenceLocked) {
        if (!qa) errors.push(`${shotLabel}缺少视觉 QA 结果，不能进入成片。`);
        else if (qa.pass !== true && qa.accepted_with_warning !== true) errors.push(`${shotLabel}视觉 QA 未通过：${qa.reason || '未说明原因'}`);
      }
      const dims = qa?.quality_dimensions || {};
      const lowDims = [
        ['realism', '真实感', 76],
        ['asset_fidelity', '素材保真', 76],
        ['scene_continuity', '场景连续', 72],
        ['product_fidelity', '产品保真', 74],
      ].filter(([key, , min]) => Number(dims[key]) > 0 && Number(dims[key]) < min);
      if (!referenceLocked && lowDims.length) {
        errors.push(`${shotLabel} QA 维度不足：${lowDims.map(([key, label]) => `${label}${Math.round(Number(dims[key]))}`).join('、')}`);
      }
    });
    if (errors.length) throw new Error(errors.slice(0, 8).join('；'));
    return true;
  }

  function validateLuxuryAdStoryboardPlan(scenes = [], expectedSegments = []) {
    const list = Array.isArray(scenes) ? scenes : [];
    const expected = Array.isArray(expectedSegments) ? expectedSegments : [];
    const errors = [];
    if (!list.length) errors.push('规划分镜没有返回镜头表。');
    if (expected.length && list.length !== expected.length) {
      errors.push(`规划分镜数量不一致：剧本 ${expected.length} 镜，返回 ${list.length} 镜。`);
    }
    list.forEach((seg, i) => {
      const n = i + 1;
      if (!String(luxuryShotContentPrompt(seg) || '').trim()) errors.push(`第 ${n} 镜缺少画面内容。`);
      if (!String(luxuryShotActionText(seg) || '').trim()) errors.push(`第 ${n} 镜缺少动作/表情。`);
      if (!String(luxuryShotNarrationText(seg) || seg.dialogue || seg.dialogue_text || '').trim()) errors.push(`第 ${n} 镜缺少台词/旁白。`);
    });
    if (errors.length) throw new Error(errors.slice(0, 8).join('；'));
    return true;
  }

  // Keep rejected images out of the primary result. A failed candidate wall makes
  // the workflow look like a usable storyboard even when the visual contract failed.
  function renderLuxuryKeyframeErrorDetails(details = null) {
    const attempts = Array.isArray(details?.attempts) ? details.attempts.filter(Boolean).slice(0, 8) : [];
    const failedCandidates = luxuryFailedKeyframeCandidates(details);
    const receiptHtml = renderLuxuryFullErrorReceipt(details, '分镜接口完整错误回执');
    if (!attempts.length) {
      return `${failedCandidates.length ? `<div class="dh-lux-error-actions"><button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-lux-failed-candidates>查看失败内容（${failedCandidates.length}）</button></div>` : ''}${receiptHtml}`;
    }
    const label = a => [a?.provider_id || a?.provider, a?.model_id || a?.model].filter(Boolean).join('/');
    const firstProviderFail = attempts.find(a => !a.ok && !a.qa);
    const firstQaFail = attempts.find(a => a.qa && a.qa.pass !== true && a.qa.accepted_with_warning !== true);
    const preflightFail = attempts.find(a => String(a?.provider_id || a?.provider || '') === 'preflight');
    const topviewAttempts = attempts.filter(a => /topview/i.test(label(a)));
    const topviewAllFailed = topviewAttempts.length > 0
      && topviewAttempts.every(a => !a.ok && /All tasks failed|5000|quota|balance|余额|insufficient/i.test(String(a.error || '')));
    const summaryParts = [
      topviewAllFailed ? 'Topview 图片通道全部失败：请优先检查 Topview 余额、额度或账号授权。' : '',
      preflightFail ? String(preflightFail.error || '当前缺少可执行的真人一致性商业片链路。').slice(0, 180) : '',
      firstProviderFail ? `首个生成通道 ${label(firstProviderFail) || '图片模型'} 未返回可用图片：${String(firstProviderFail.error || '未知错误').slice(0, 140)}` : '',
      firstQaFail ? `后续候选图已出图但被视觉 QA 拒绝：${String(firstQaFail.qa?.reason || firstQaFail.error || '画面与剧本/资产锁不一致').slice(0, 140)}` : '',
    ].filter(Boolean);
    const failedLabels = attempts
      .filter(a => !a.ok)
      .map(a => label(a) || '未知模型')
      .filter(Boolean)
      .slice(0, 6);
    return `<div class="dh-lux-error-attempts">
      ${summaryParts.length ? `<div class="dh-lux-error-summary">${summaryParts.map(x => `<span>${escapeHtml(x)}</span>`).join('')}</div>` : ''}
      <div class="dh-lux-error-summary"><span>${escapeHtml(failedLabels.length ? `已阻止/拒绝的通道：${failedLabels.join('、')}` : '没有可展示的合格候选图。')}</span></div>
      ${failedCandidates.length ? `<div class="dh-lux-error-actions"><button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-lux-failed-candidates>查看失败内容（${failedCandidates.length}）</button><span>仅用于诊断，不再允许保留失败候选图</span></div>` : ''}
      ${receiptHtml}
    </div>`;
  }

  function renderLuxuryAdScriptTable(host, segments) {
    if (!host) return;
    if (!segments.length) {
      host.innerHTML = luxuryAdEmptyBlock('还没有剧本', '请先完成基础信息配置，再点击“确认基础信息，生成剧本”。');
      return;
    }
    if (!state.luxuryAd.storyboardDetailed) {
      host.innerHTML = luxuryAdEmptyBlock('等待生成剧本', '基础信息已生成。确认人物、主体和素材来源后，点击“确认基础信息，生成剧本”。');
      return;
    }
    const info = state.luxuryAd.briefInfo || deriveLuxuryBriefInfo(state.luxuryAd.content, segments, {});
    const characters = Array.isArray(info.characters) ? info.characters : [];
    const totalSeconds = Math.round(segments.reduce((sum, seg) => sum + luxuryAdShotSeconds(seg, state.luxuryAd.durationSec, segments.length), 0) * 10) / 10;
    host.innerHTML = `<div class="dh-demo-script-review">
      <div>
        <h4>剧本审核</h4>
        <p>第 1 版 · 待确认 · ${escapeHtml(info.title || '剧情广告')} · 共 ${segments.length} 镜 · 总时长 ${totalSeconds} 秒</p>
      </div>
      <div class="dh-demo-script-actions">
        <button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" id="dhLuxAdScriptRegenerate">重新生成整版</button>
        <span class="dh-luxgen-status ready">待确认</span>
      </div>
    </div>
    <div class="dh-luxgen-live-progress dh-luxgen-script-progress" id="dhLuxAdScriptProgress" hidden></div>
    <div class="dh-demo-script-mainline">
      <b>剧本主线</b>
      <span>${escapeHtml([info.style || '高端商业广告', info.theme || '品牌广告', `${segments.length} 个镜头`, characters.length >= 2 ? '双人互动对白' : '旁白/单人讲解'].filter(Boolean).join(' · '))}</span>
    </div>
    ${renderLuxuryGlobalVisualBible()}
    ${renderLuxuryCharacterCards(info)}
    <table class="dh-demo-table">
      <thead>
        <tr>
          <th style="width:84px">镜</th>
          <th style="width:74px">秒</th>
          <th>画面</th>
          <th>动作</th>
          <th>台词</th>
          <th style="width:160px">目的</th>
          <th style="width:128px">状态</th>
        </tr>
      </thead>
      <tbody>
        ${segments.map((seg, i) => {
          const visual = luxuryShotContentPrompt(seg);
          const action = luxuryShotActionText(seg);
          const voice = luxuryShotDialogueText(seg, characters, i);
          const purpose = luxuryScriptPurposeLabel(seg, i, segments.length);
          const mood = luxuryShotEmotionText(seg);
          const seconds = luxuryAdShotSeconds(seg, state.luxuryAd.durationSec, segments.length);
          return `<tr ${i === 0 ? 'class="is-active"' : ''}>
            <td>${String(i + 1).padStart(2, '0')}</td>
            <td>${escapeHtml(String(seconds))}</td>
            <td><b>${escapeHtml(visual)}</b><span>${escapeHtml(mood)}</span></td>
            <td>${escapeHtml(action)}</td>
            <td class="dh-demo-dialogue">${escapeHtml(voice || '待生成广告词')}</td>
            <td>${escapeHtml(purpose)}</td>
            <td><span class="dh-luxgen-status ready">待确认</span><button type="button" class="dh-luxgen-edit" data-lux-shot-edit="${i}">编辑</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
    renderLuxuryWorkflowProgress();
  }

  function renderLuxuryStoryboardSheet(segments = [], keyframes = []) {
    if (!segments.length) return '';
    const totalSeconds = Math.round(segments.reduce((sum, seg) => sum + luxuryAdShotSeconds(seg, state.luxuryAd.durationSec, segments.length), 0) * 10) / 10;
    const ratio = String(state.luxuryAd.outputRatio || '9:16');
    const ratioStyle = luxuryAspectRatioStyle(ratio);
    const planningOnly = state.luxuryAd.keyframePlanningOnly === true;
    const manifest = state.luxuryAd.assetManifest
      || segments.find(x => x?.asset_manifest)?.asset_manifest
      || keyframes.find(x => x?.asset_manifest)?.asset_manifest
      || null;
    const locks = state.luxuryAd.visualLocks
      || segments.find(x => x?.visual_locks)?.visual_locks
      || keyframes.find(x => x?.visual_locks)?.visual_locks
      || null;
    const items = Array.isArray(manifest?.items) ? manifest.items.slice(0, 6) : [];
    const lockRows = [
      ['真实场景', locks?.reality_lock?.scene_basis || locks?.reality_lock?.prompt],
      ['产品保真', locks?.product_lock?.subject || locks?.product_lock?.prompt],
      ['人物一致', locks?.character_lock?.prompt],
      ['场景连续', locks?.scene_lock?.scene_basis || locks?.scene_lock?.prompt],
      ['UI浮层', locks?.ui_lock?.prompt],
      ['风格边界', locks?.style_lock?.prompt],
    ].filter(([, value]) => value).slice(0, 6);
    const generatedFrameCount = Array.isArray(keyframes) ? keyframes.filter(luxuryFrameHasImage).length : 0;
    const generatedSheets = !planningOnly && generatedFrameCount >= segments.length && Array.isArray(state.luxuryAd.storyboardSheets)
      ? state.luxuryAd.storyboardSheets.filter(x => x && (x.image_url || x.imageUrl || x.url) && !luxuryStoryboardSheetIsPlanningOnly(x))
      : [];
    return `<section class="dh-lux-storyboard-sheet" aria-label="专业分镜板">
      <div class="dh-lux-sheet-head">
        <div>
          <b>${escapeHtml(state.luxuryAd.briefInfo?.title || '剧情广告分镜板')}</b>
          <span>${segments.length} 镜 · ${totalSeconds} 秒 · ${escapeHtml(ratio)} · live action storyboard · ${planningOnly ? '当前为审核分镜板，真实关键帧尚未生成' : '真实关键帧生成后进入成片流程'}</span>
        </div>
        <em>Storyboard Workbench</em>
      </div>
      ${generatedSheets.length ? `<div class="dh-lux-sheet-output">
        <div class="dh-lux-sheet-output-title">
          <b>${planningOnly ? '审核分镜板' : '真实分镜板成品'}</b>
          <span>${generatedSheets.length} 页 · ${planningOnly ? '仅用于审核镜头和动作，不能直接合成广告' : '可进入绘制首帧/成片流程'}</span>
        </div>
        <div class="dh-lux-sheet-output-grid">
          ${generatedSheets.map((sheet, i) => {
            const src = luxuryAssetPreviewUrl({ url: sheet.image_url || sheet.imageUrl || sheet.url || '' });
            return `<a href="${escapeHtml(src)}" target="_blank" rel="noopener" class="dh-lux-sheet-output-card">
              <img src="${escapeHtml(src)}" alt="分镜板第 ${i + 1} 页">
              <span>第 ${i + 1} 页 · 镜头 ${escapeHtml(String(sheet.shot_start || ''))}-${escapeHtml(String(sheet.shot_end || ''))}</span>
            </a>`;
          }).join('')}
        </div>
      </div>` : ''}
      ${(items.length || lockRows.length) ? `<div class="dh-lux-sheet-locks">
        ${items.length ? `<div class="dh-lux-sheet-lock-group">
          <small>资产合同</small>
          <div>${items.map((item, i) => `<span><b>${escapeHtml(luxuryRoleLabel(item.role))}</b>${escapeHtml(item.name || item.observed || `素材 ${i + 1}`)}</span>`).join('')}</div>
        </div>` : ''}
        ${lockRows.length ? `<div class="dh-lux-sheet-lock-group">
          <small>视觉锁</small>
          <div>${lockRows.map(([label, value]) => `<span><b>${escapeHtml(label)}</b>${escapeHtml(String(value || '').slice(0, 80))}</span>`).join('')}</div>
        </div>` : ''}
      </div>` : ''}
      <div class="dh-lux-sheet-grid">
        ${segments.map((seg, i) => {
          const kf = keyframes[i] || {};
          const img = kf.image_url || kf.imageUrl || '';
          const preview = img ? luxuryAssetPreviewUrl({ url: img }) : '';
          const timeRange = luxuryAdShotTimeRange(seg, i, segments.length);
          const pendingLabel = `镜头 ${String(i + 1).padStart(2, '0')} · 待生成分镜图`;
          const camera = luxuryShotMotionLabel(seg);
          const action = luxuryShotActionText(seg);
          const ui = luxuryUiOverlaySummary(seg.ui_overlay || kf.ui_overlay || null, seg);
          return `<article class="dh-lux-sheet-shot ${preview ? 'has-preview' : ''}">
            <header><strong>${String(i + 1).padStart(2, '0')}</strong><span>${escapeHtml(timeRange)}</span></header>
            ${preview ? `<button type="button" class="dh-lux-sheet-frame has-linked-preview" style="${ratioStyle}" data-lux-shot-preview="${i}" title="查看第 ${i + 1} 镜全图">
              <img src="${escapeHtml(preview)}" alt="镜头 ${i + 1} 已生成分镜图">
              <span>已生成 · 点击查看</span>
            </button>` : `<div class="dh-lux-sheet-frame pending" style="${ratioStyle}"><span>${escapeHtml(pendingLabel)}</span></div>`}
            <dl>
              <div><dt>CAMERA</dt><dd>${escapeHtml(camera || seg.shot_angle || '待定')}</dd></div>
              <div><dt>ACTION</dt><dd>${escapeHtml(action || luxuryShotContentPrompt(seg))}</dd></div>
              <div><dt>UI/VFX</dt><dd>${escapeHtml(ui || 'none')}</dd></div>
              <div><dt>QA</dt><dd>${renderLuxuryFrameQaDimensions(kf) || '<span class="dh-lux-sheet-qa-pending">等待质检</span>'}</dd></div>
            </dl>
          </article>`;
        }).join('')}
      </div>
    </section>`;
  }

  function luxuryStoryboardSheetIsPlanningOnly(sheet = {}) {
    const kind = String(sheet.kind || sheet.mode || sheet.reference_mode || '').toLowerCase();
    const url = String(sheet.image_url || sheet.imageUrl || sheet.url || '').toLowerCase();
    return sheet.planning_only === true
      || sheet.planningOnly === true
      || /planning|review|placeholder/.test(kind)
      || /storyboard_sheet_[^/]*_plan_/.test(url)
      || /_plan_/.test(url);
  }

  function luxuryRoleLabel(role = '') {
    const map = {
      product: '产品',
      person: '人物',
      scene: '场景',
      prop: '道具',
      detail: '细节',
      ui: 'UI',
      style: '风格',
      mixed: '混合',
      auto: '自动',
    };
    return map[String(role || '').toLowerCase()] || String(role || '自动');
  }

  function renderLuxuryAssetLocksPanel(segments = [], keyframes = []) {
    const manifest = state.luxuryAd.assetManifest
      || segments.find(x => x?.asset_manifest)?.asset_manifest
      || keyframes.find(x => x?.asset_manifest)?.asset_manifest
      || null;
    const locks = state.luxuryAd.visualLocks
      || segments.find(x => x?.visual_locks)?.visual_locks
      || keyframes.find(x => x?.visual_locks)?.visual_locks
      || null;
    const items = Array.isArray(manifest?.items) ? manifest.items.slice(0, 10) : [];
    if (!items.length && !locks) return '';
    const lockRows = [
      ['reality_lock', '真实场景', locks?.reality_lock?.scene_basis || locks?.reality_lock?.prompt],
      ['product_lock', '产品保真', locks?.product_lock?.subject || locks?.product_lock?.prompt],
      ['character_lock', '人物一致', locks?.character_lock?.prompt],
      ['scene_lock', '场景连续', locks?.scene_lock?.scene_basis || locks?.scene_lock?.prompt],
      ['prop_lock', '道具证据', locks?.prop_lock?.prompt],
      ['ui_lock', 'UI浮层', locks?.ui_lock?.prompt],
      ['style_lock', '风格边界', locks?.style_lock?.prompt],
    ].filter(([, , value]) => value);
    return `<section class="dh-lux-lock-panel">
      <div class="dh-lux-lock-head">
        <b>资产合同 / 视觉锁</b>
        <span>生成和 QA 会按这些锁执行；修改参考图用途后需要重新生成。</span>
      </div>
      ${items.length ? `<div class="dh-lux-asset-manifest">
        ${items.map((item, i) => `<article>
          <strong>${escapeHtml(luxuryRoleLabel(item.role))}</strong>
          <b>${escapeHtml(item.name || item.url || `素材 ${i + 1}`)}</b>
          <span>${escapeHtml([item.observed, item.must_keep ? `保留：${item.must_keep}` : '', item.usage ? `用途：${item.usage}` : '', item.avoid ? `避免：${item.avoid}` : ''].filter(Boolean).join('；') || '等待分析')}</span>
        </article>`).join('')}
      </div>` : ''}
      ${lockRows.length ? `<div class="dh-lux-lock-grid">
        ${lockRows.map(([key, label, value]) => `<div><small>${escapeHtml(label)}</small><b>${escapeHtml(String(value || '').slice(0, 180))}</b></div>`).join('')}
      </div>` : ''}
    </section>`;
  }

  function renderLuxuryFrameQaDimensions(kf = {}) {
    const qa = kf.qa || kf.shot_plan?.qa || null;
    const dims = qa?.quality_dimensions || {};
    const rows = [
      ['realism', '真实感'],
      ['asset_fidelity', '素材保真'],
      ['character_consistency', '人物一致'],
      ['scene_continuity', '场景连续'],
      ['product_fidelity', '产品保真'],
      ['ui_overlay', 'UI浮层'],
    ].map(([key, label]) => {
      const value = Number(dims[key]);
      return Number.isFinite(value) && value > 0
        ? `<span class="${value >= 76 ? 'pass' : (value >= 70 ? 'warn' : 'fail')}">${escapeHtml(label)} ${Math.round(value)}</span>`
        : '';
    }).filter(Boolean);
    if (!rows.length) return '';
    return `<div class="dh-lux-qa-dims">${rows.join('')}</div>`;
  }

  function luxuryAdIsSoftwareWorkflow() {
    const text = [
      state.luxuryAd.productAsset?.name,
      state.luxuryAd.briefInfo?.product_subject,
      state.luxuryAd.content,
      ...(state.luxuryAd.segments || []).flatMap(seg => [seg.title, seg.text, seg.visual, seg.action, seg.voiceover, seg.material_usage]),
    ].filter(Boolean).join(' ');
    if (/钢|金属|板材|建材|材料|材质|外立面|墙面|steel|metal|panel|facade|material/i.test(text)) return false;
    const creativeVideo = /视频创作|漫剧|短剧|剧情广告|视频生成|文生视频|图生视频|分镜|剧本|剪辑|成片|数字人|创作工具|AI视频|video\s*(creation|generation|editing)|storyboard|script|drama|comic|manga/i.test(text);
    const orderWorkflow = /AI\s*Order\s*Assistant|Order\s*Assistant|订单助手|智能订单|智能点餐|订单管理|采购订单|采购单|库存管理|补货|库存预警|排单|收银|点餐|OMS|WMS|ordering|order\s*management|purchase\s*order|procurement|inventory|restock|retail\s*ops|store\s*ops/i.test(text);
    if (orderWorkflow) return true;
    if (creativeVideo) return false;
    const softwareSubject = /软件|系统|SaaS|小程序|应用|App\b|APP\b|后台|看板|仪表盘|界面|数据|算法|人工智能|workflow|software|dashboard|interface|screen|app|service/i.test(text);
    const concreteWorkflow = /流程|审批|工单|客服|CRM|ERP|排期|调度|报表|表单|同步|协同|自动化|管理后台|业务操作|workflow|ticket|approval|crm|erp|report|form|sync|automation|operation/i.test(text);
    return softwareSubject && concreteWorkflow;
  }

  function luxuryAttemptKey(attempt = {}) {
    return [attempt.provider_id || attempt.provider, attempt.model_id || attempt.model].filter(Boolean).join('/');
  }

  function luxuryAttemptStatus(attempts = [], provider = '', model = '') {
    const needle = `${provider}/${model}`.toLowerCase();
    const hit = attempts.find(a => luxuryAttemptKey(a).toLowerCase() === needle);
    if (!hit) return '';
    return hit.ok || hit.qa?.pass === true || hit.qa?.accepted_with_warning === true ? 'ready' : 'fail';
  }

  function renderLuxuryCommercialGuard() {
    const hosts = ['#dhLuxAdCapabilityStrip', '#dhLuxAdCommercialGuard']
      .map(selector => $(selector))
      .filter(Boolean);
    if (!hosts.length) return;
    if (luxuryAdIsMaterialMode() || !canViewLuxuryInternalPipeline()) {
      hosts.forEach(host => {
        host.hidden = true;
        host.innerHTML = '';
      });
      return;
    }
    hosts.forEach(host => {
      host.hidden = false;
    });
    const segments = state.luxuryAd.segments || [];
    const keyframes = state.luxuryAd.keyframes || [];
    const details = state.luxuryAd.keyframeErrorDetails || null;
    const attempts = Array.isArray(details?.attempts) ? details.attempts.filter(Boolean) : [];
    const hasActorAsset = !!(state.luxuryAd.personAsset?.url
      || state.luxuryAd.productionContract?.actor_reference?.status === 'confirmed'
      || keyframes.find(k => k?.character_lock?.actor_asset || k?.visual_locks?.character_lock?.actor_asset));
    const actorLabel = hasActorAsset ? '人物一致性参考已启用' : '待选人物参考';
    const actorSub = hasActorAsset
      ? '后端会把正脸/侧脸/动作参考作为人物一致性锁。'
      : '建议先生成 AI 真人感演员包、上传真人参考或选择角色素材库演员。';
    const workflow = luxuryAdIsSoftwareWorkflow();
    const finishedFrames = keyframes.filter(k => k?.image_url || k?.imageUrl).length;
    const totalFrames = Math.max(segments.length || 0, finishedFrames);
    const topviewAttempts = attempts.filter(a => /topview/i.test(luxuryAttemptKey(a)));
    const topviewAllFailed = topviewAttempts.length > 0
      && topviewAttempts.every(a => !a.ok && /All tasks failed|5000|quota|balance|余额|insufficient/i.test(String(a.error || '')));
    const qaAttempt = attempts.find(a => a.qa) || null;
    const personSheetChain = [
      ['deyunai', 'gpt-image-2', '漫路 GPT Image 2', false],
      ['deyunai', 'nano-banana-pro', '漫路 Nano Banana Pro', false],
      ['deyunai', 'nano-banana', '漫路 Nano Banana', false],
      ['deyunai', 'qwen-image', '漫路 Qwen Image', false],
      ['topview', 'topview-gpt-image-2', 'Topview GPT Image 2', true],
    ];
    const keyframeChain = [
      ['deyunai', 'gpt-image-2', '漫路 GPT Image 2', false],
      ['deyunai', 'nano-banana-pro', '漫路 Nano Banana Pro', false],
      ['deyunai', 'nano-banana', '漫路 Nano Banana', false],
      ['deyunai', 'qwen-image-edit', '漫路 Qwen Image Edit', false],
      ['deyunai', 'doubao-seedream-4-0-250828', '漫路 Seedream 4.0', false],
      ['topview', 'topview-gpt-image-2', 'Topview GPT Image 2', true],
    ];
    const videoChain = [
      ['webang-seedance', 'doubao-seedance-2-0-260128', '微众 Seedance 2.0', false],
      ['webang-seedance', 'doubao-seedance-2-0-fast-260128', '微众 Seedance 2.0 Fast', false],
      ['topview', 'topview-image2video-pro', 'Topview I2V Pro', true],
      ['deyunai', 'kling-v2.5-turbo-pro', '漫路 Kling 2.5', false],
      ['deyunai', 'hailuo-02-fast', '漫路 Hailuo 02 Fast', false],
    ];
    const chainChipHtml = chain => chain.map(([provider, model, label, disabled]) => {
      const status = luxuryAttemptStatus(attempts, provider, model);
      return `<span class="${disabled ? 'disabled' : status}">${escapeHtml(label)}${disabled ? ' · 已停用' : ''}</span>`;
    }).join('');
    const cards = [
      ['演员库 / 人物锁', actorLabel, actorSub, hasActorAsset ? 'ready' : 'warn'],
      ['产品类型识别', workflow ? '软件/服务工作流' : '按需求识别主体', workflow ? '只使用 brief、素材或剧本明确要求的载体证据，不套订单/货架模板。' : '按确认主体、场景和业务证据生成。', workflow ? 'ready' : ''],
      ['模型调用链', attempts.length ? '已记录最近一次尝试' : '按模型调用管理执行', '人物演员包走 luxury_ad.person_sheet；分镜图走 luxury_ad.keyframe；成片视频走 luxury_ad.video。', topviewAllFailed ? 'fail' : (attempts.length ? 'warn' : '')],
      ['严格 QA 门禁', qaAttempt ? `最近评分 ${qaAttempt.qa?.score ?? '-'}` : '等待生成后评分', 'Vision QA 会检查人物一致、剧情动作、写实度、产品/场景和 UI 遮挡。', qaAttempt?.qa?.pass ? 'ready' : (qaAttempt ? 'warn' : '')],
    ].map(([title, value, sub, cls]) => `<div class="dh-lux-commercial-guard-card ${cls || ''}"><small>${escapeHtml(title)}</small><b>${escapeHtml(value)}</b><span>${escapeHtml(sub)}</span></div>`).join('');
    const note = topviewAllFailed
      ? '最近一次失败是 Topview 图片通道全部返回 All tasks failed。优先检查 Topview 余额/额度/账号授权；这不是剧情 QA 放行问题。'
      : (state.luxuryAd.keyframeGenerating
        ? (state.luxuryAd.keyframeProgress?.message || '正在生成分镜。')
        : (finishedFrames ? `当前已生成 ${finishedFrames}/${totalFrames || finishedFrames} 个真实分镜。` : '确认剧本后会先按演员和工作流合同生成关键帧，失败时这里会显示模型链路和原因。'));
    const html = `<section>
      <div class="dh-lux-commercial-guard-head">
        <div><b>商用分镜生成链路</b><span>人物一致性参考、软件工作流、模型调用管理和严格 QA 会在这里显性展示。</span></div>
        <em>${escapeHtml(state.luxuryAd.keyframeGenerating ? '生成中' : (finishedFrames ? '已有结果' : '待生成'))}</em>
      </div>
      <div class="dh-lux-commercial-guard-grid">${cards}</div>
      <div class="dh-lux-model-chain-group">
        <small>人物演员包链</small>
        <div class="dh-lux-model-chain">${chainChipHtml(personSheetChain)}</div>
      </div>
      <div class="dh-lux-model-chain-group">
        <small>第 4 步分镜图片链</small>
        <div class="dh-lux-model-chain">${chainChipHtml(keyframeChain)}<span class="${qaAttempt ? (qaAttempt.qa?.pass ? 'ready' : 'fail') : ''}">QA: Gemini 2.5 Flash</span></div>
      </div>
      <div class="dh-lux-model-chain-group">
        <small>第 5 步视频合成链</small>
        <div class="dh-lux-model-chain">${chainChipHtml(videoChain)}</div>
      </div>
      <div class="dh-lux-commercial-guard-note">${escapeHtml(note)}</div>
    </section>`;
    hosts.forEach(host => {
      host.innerHTML = html;
    });
  }

  function renderLuxuryProductionContractStatus() {
    const contract = state.luxuryAd.productionContract || null;
    if (!contract || typeof contract !== 'object') return '';
    const humanShots = Array.isArray(contract.human_shot_indexes) ? contract.human_shot_indexes : [];
    const actor = contract.actor_reference || {};
    const rows = [
      ['人物镜头', humanShots.length ? `第 ${humanShots.join('、')} 镜` : '无强制人物镜头'],
      ['演员参考', actor.status === 'confirmed' ? (actor.name || '已确认') : '未确认'],
      ['真实关键帧', contract.final_keyframes_ready ? '可进入' : '等待资产/模型'],
    ];
    return `<section class="dh-lux-lock-panel">
      <div class="dh-lux-lock-head">
        <b>制作合同</b>
        <span>${escapeHtml(contract.blocked || contract.final_keyframes_ready === false ? (contract.reason || '等待确认关键资产') : '已按分镜合同约束后续生成')}</span>
      </div>
      <div class="dh-lux-lock-grid">
        ${rows.map(([label, value]) => `<div><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></div>`).join('')}
      </div>
    </section>`;
  }

  function renderLuxuryStoryboardBriefingContent(segments = [], keyframes = []) {
    return [
      renderLuxuryProductionProjectStatus(),
      renderLuxuryProductionContractStatus(),
      renderLuxuryAssetLocksPanel(segments, keyframes),
      renderLuxuryGlobalVisualBible(),
    ].filter(Boolean).join('');
  }

  function renderLuxuryStoryboardBriefingEntry(segments = [], keyframes = []) {
    const html = renderLuxuryStoryboardBriefingContent(segments, keyframes);
    if (!html) return '';
    const project = state.luxuryAd.productionProject || {};
    const title = project.title || state.luxuryAd.briefInfo?.title || '剧情广告';
    const count = Math.max(
      Array.isArray(segments) ? segments.length : 0,
      Array.isArray(keyframes) ? keyframes.length : 0
    );
    return `<section class="dh-lux-storyboard-briefing-entry">
      <div>
        <b>分镜制作说明</b>
        <span>${escapeHtml(title)} · ${count || 0} 个镜头 · 查看制作合同、资产合同、视觉锁和全局画面规则。</span>
      </div>
      <button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-lux-storyboard-briefing>查看说明</button>
    </section>`;
  }

  function ensureLuxuryStoryboardBriefingModal() {
    let modal = $('#dhLuxuryStoryboardBriefingModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'dhLuxuryStoryboardBriefingModal';
    modal.className = 'dh-video-modal dh-lux-storyboard-briefing-modal';
    modal.innerHTML = `<div class="dh-video-modal-backdrop" data-lux-storyboard-briefing-close></div>
      <div class="dh-video-modal-card dh-lux-storyboard-briefing-card">
        <div class="dh-video-modal-head">
          <span class="dh-video-modal-title">分镜制作说明</span>
          <button class="dh-video-modal-close" data-lux-storyboard-briefing-close type="button" title="关闭">×</button>
        </div>
        <div class="dh-lux-storyboard-briefing-body"></div>
      </div>`;
    modal.addEventListener('click', e => {
      if (e.target.closest('[data-lux-storyboard-briefing-close]')) closeLuxuryStoryboardBriefingModal();
    });
    document.body.appendChild(modal);
    return modal;
  }

  function openLuxuryStoryboardBriefingModal() {
    const modal = ensureLuxuryStoryboardBriefingModal();
    const body = modal.querySelector('.dh-lux-storyboard-briefing-body');
    const html = renderLuxuryStoryboardBriefingContent(state.luxuryAd.segments || [], state.luxuryAd.keyframes || []);
    if (body) body.innerHTML = html || luxuryAdEmptyBlock('暂无说明', '完成剧本和分镜生成后，这里会显示制作合同、资产合同和视觉锁。');
    modal.classList.add('open');
  }

  function closeLuxuryStoryboardBriefingModal() {
    $('#dhLuxuryStoryboardBriefingModal')?.classList.remove('open');
  }

  function luxuryProductionProjectStageLabel(stage = '') {
    const map = {
      draft: '制作进度已保存',
      script_reviewing: '剧本待继续编辑',
      frame_generating: '真实关键帧生成中',
      frame_reviewing: '分镜板待继续编辑',
      actor_required: '等待人物一致性参考',
      model_required: '等待保参考模型',
      frame_failed: '关键帧失败',
      frame_ready: '关键帧已就绪',
      video_generating: '成片生成中',
      video_ready: '成片已就绪',
    };
    return map[String(stage || '').trim()] || '生产包已建立';
  }

  function applyLuxuryProductionProject(project = null) {
    if (!project || typeof project !== 'object') return;
    state.luxuryAd.productionProject = project;
    state.luxuryAd.productionProjectId = project.id || state.luxuryAd.productionProjectId || '';
    if (project.production_contract) state.luxuryAd.productionContract = project.production_contract;
  }

  function luxuryAdCurrentDraftPayload(projectState = '') {
    const text = ($('#dhLuxAdText')?.value || state.luxuryAd.content || '').trim();
    // 中文注释：这里仅保存当前制作事实，不按行业补写兜底内容，避免把用户 brief 改成固定场景。
    return {
      project_id: state.luxuryAd.productionProjectId || state.luxuryAd.productionProject?.id || '',
      production_project_id: state.luxuryAd.productionProjectId || state.luxuryAd.productionProject?.id || '',
      project_state: projectState || (state.luxuryAd.keyframeError ? 'frame_failed' : (state.luxuryAd.keyframes?.length ? 'frame_ready' : (state.luxuryAd.storyboardDetailed ? 'frame_reviewing' : 'script_reviewing'))),
      flow_mode: state.luxuryAd.flowMode || 'story',
      text,
      title: state.luxuryAd.briefInfo?.title || '剧情广告项目',
      brief_info: state.luxuryAd.briefInfo || null,
      duration_sec: state.luxuryAd.durationSec || Number($('#dhLuxAdDuration')?.value || 30),
      aspect_ratio: state.luxuryAd.outputRatio || $('#dhLuxAdRatio')?.value || '9:16',
      output_size: state.luxuryAd.outputSize || $('#dhLuxAdSize')?.value || 'standard',
      current_step: state.luxuryAd.currentStep || 1,
      storyboard_detailed: !!state.luxuryAd.storyboardDetailed,
      keyframe_planning_only: !!state.luxuryAd.keyframePlanningOnly,
      ad_type: state.luxuryAd.adType || 'auto',
      auto_enhance: state.luxuryAd.autoEnhance !== false,
      expand_brief: state.luxuryAd.expandBrief !== false,
      voice_id: state.luxuryAd.voiceId || '',
      voice_direction: state.luxuryAd.voiceDirection || 'story_dynamic',
      subtitle: getLuxuryAdSubtitlePayload(),
      person_spec: luxuryAdPersonSpec(),
      person_asset: luxuryAdPersonAssetPayload(),
      product_asset: state.luxuryAd.productAsset || null,
      brief_reference_assets: filledLuxuryAdBriefReferences(),
      reference_assets: luxuryAdReferenceAssets().filter(luxuryAdAssetFilled),
      bgm_asset: luxuryAdBgmAssetPayload(),
      bgm_profile: state.luxuryAd.bgmProfile || 'auto',
      voice_volume: luxuryAdVoiceVolume(),
      bgm_volume: luxuryAdBgmVolume(),
      scenes: compactLuxurySegments(state.luxuryAd.segments || []),
      keyframes: state.luxuryAd.keyframes || [],
      storyboard_sheets: state.luxuryAd.storyboardSheets || [],
      production_contract: state.luxuryAd.productionContract || null,
      asset_manifest: state.luxuryAd.assetManifest || null,
      visual_locks: state.luxuryAd.visualLocks || null,
      global_visual_bible: state.luxuryAd.globalVisualBible || null,
      keyframe_error: state.luxuryAd.keyframeError || '',
    };
  }

  async function saveLuxuryAdDraft({ silent = false, projectState = '' } = {}) {
    const payload = luxuryAdCurrentDraftPayload(projectState);
    if (!payload.text && !payload.scenes.length && !payload.keyframes.length) {
      if (!silent) toast('当前还没有可保存的制作内容', 'error');
      return null;
    }
    const r = await api('/api/dh/luxury-ad/projects/save', { method: 'POST', body: payload });
    if (r?.production_project || r?.project) applyLuxuryProductionProject(r.production_project || r.project);
    await refreshLuxuryAdProjectsForTaskCenter({ force: true, silent: true });
    if (!silent) toast('制作进度已保存到任务中心', 'success');
    return r?.production_project || r?.project || null;
  }

  function ensureLuxuryResumeModal() {
    let modal = document.getElementById('dhLuxuryResumeModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'dhLuxuryResumeModal';
    modal.className = 'dh-video-modal dh-lux-resume-modal';
    modal.innerHTML = `
      <div class="dh-video-modal-backdrop" data-lux-resume-close></div>
      <div class="dh-video-modal-card dh-lux-resume-modal-card">
        <div class="dh-video-modal-head">
          <span class="dh-video-modal-title">继续制作剧情广告</span>
          <button class="dh-video-modal-close" data-lux-resume-close type="button" title="关闭">×</button>
        </div>
        <div class="dh-lux-resume-modal-body"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => {
      if (e.target.closest('[data-lux-resume-close]')) closeLuxuryResumeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal.classList.contains('open')) closeLuxuryResumeModal();
    });
    return modal;
  }

  function openLuxuryResumeModal() {
    const pane = document.querySelector('[data-pane="luxury-ad"]');
    if (!pane) return false;
    const modal = ensureLuxuryResumeModal();
    const body = modal.querySelector('.dh-lux-resume-modal-body');
    if (!body) return false;
    if (!state.luxuryResumeModalAnchor) {
      state.luxuryResumeModalAnchor = document.createComment('luxury-ad-pane-anchor');
      pane.parentNode?.insertBefore(state.luxuryResumeModalAnchor, pane);
    }
    body.appendChild(pane);
    pane.classList.add('active');
    pane.dataset.resumeModal = 'true';
    modal.classList.add('open');
    return true;
  }

  function luxuryAdProjectResumeUrl(projectId = '') {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'luxury-ad');
    url.searchParams.set('luxury_project', String(projectId || ''));
    url.hash = '';
    return url.toString();
  }

  async function restoreLuxuryAdProjectFromUrl() {
    const params = new URLSearchParams(window.location.search || '');
    const projectId = String(params.get('luxury_project') || '').trim();
    if (!projectId) return false;
    try {
      const r = await api(`/api/dh/luxury-ad/projects/${encodeURIComponent(projectId)}`);
      restoreLuxuryAdProject(r.project, { modal: false, fromUrl: true });
      return true;
    } catch (err) {
      toast('打开制作项目失败：' + err.message, 'error');
      return false;
    }
  }

  function closeLuxuryResumeModal() {
    const modal = document.getElementById('dhLuxuryResumeModal');
    const pane = document.querySelector('[data-pane="luxury-ad"][data-resume-modal="true"]');
    if (pane && state.luxuryResumeModalAnchor?.parentNode) {
      state.luxuryResumeModalAnchor.parentNode.insertBefore(pane, state.luxuryResumeModalAnchor);
      delete pane.dataset.resumeModal;
      pane.classList.toggle('active', state.activeTab === 'luxury-ad' || state.activeTab === 'material-film');
    }
    if (modal) modal.classList.remove('open');
    renderTaskCenter();
  }

  function restoreLuxuryAdProject(project = null, opts = {}) {
    if (!project || typeof project !== 'object') return;
    const draft = project.draft_state || {};
    const inferredStep = project.keyframes?.length
      ? 5
      : (['frame_reviewing', 'frame_ready', 'frame_failed'].includes(project.project_state) || project.storyboard_sheets?.length
        ? 4
        : (project.scenes?.length ? 3 : 1));
    state.luxuryAd.content = project.text || state.luxuryAd.content || '';
    // 中文注释：旧页面补存可能把 current_step 写成 1；恢复时以已保存产物和项目阶段为准。
    state.luxuryAd.currentStep = Math.max(Number(draft.current_step || 1), inferredStep);
    state.luxuryAd.flowMode = draft.flow_mode || project.flow_mode || 'story';
    state.luxuryAd.durationSec = Number(project.duration_sec || state.luxuryAd.durationSec || 30);
    state.luxuryAd.outputRatio = project.ratio || state.luxuryAd.outputRatio || '9:16';
    state.luxuryAd.outputSize = project.output_size || state.luxuryAd.outputSize || 'standard';
    state.luxuryAd.adType = draft.ad_type || state.luxuryAd.adType || 'auto';
    state.luxuryAd.autoEnhance = draft.auto_enhance !== false;
    state.luxuryAd.expandBrief = draft.expand_brief !== false;
    state.luxuryAd.voiceId = draft.voice_id || state.luxuryAd.voiceId || '';
    state.luxuryAd.voiceDirection = draft.voice_direction || state.luxuryAd.voiceDirection || 'story_dynamic';
    state.luxuryAd.subtitle = draft.subtitle && typeof draft.subtitle === 'object'
      ? draft.subtitle
      : (draft.subtitle !== false);
    state.luxuryAd.personSpec = draft.person_spec || state.luxuryAd.personSpec;
    const restoredPersonAsset = draft.person_asset || state.luxuryAd.personAsset || null;
    const contractActorAsset = project.production_contract?.actor_asset
      || project.production_contract?.actor_reference
      || null;
    if (restoredPersonAsset) {
      const restoredUrls = luxuryActorUrlsFromSources(restoredPersonAsset, contractActorAsset);
      state.luxuryAd.personAsset = {
        ...restoredPersonAsset,
        ...(contractActorAsset && !restoredPersonAsset.actor_asset_id ? {
          actor_id: contractActorAsset.actor_id || restoredPersonAsset.actor_id || '',
          actor_asset_id: contractActorAsset.actor_asset_id || restoredPersonAsset.actor_asset_id || '',
        } : {}),
        extra_image_urls: restoredUrls.slice(1),
        view_count: Math.max(Number(restoredPersonAsset.view_count || 0), restoredUrls.length || 1),
      };
    } else {
      state.luxuryAd.personAsset = null;
    }
    state.luxuryAd.productAsset = draft.product_asset || state.luxuryAd.productAsset || null;
    state.luxuryAd.briefRefAssets = draft.brief_reference_assets || [];
    state.luxuryAd.refAssets = draft.reference_assets || [];
    state.luxuryAd.bgmAsset = normalizeLuxuryAdBgmAsset(
      draft.bgm_asset
        || project.bgm_asset
        || project.background_music
        || project.backgroundMusic
        || project.music
        || null
    );
    state.luxuryAd.bgmProfile = draft.bgm_profile || state.luxuryAd.bgmAsset?.matched_genre || 'auto';
    state.luxuryAd.voiceVolume = clampLuxuryAudioVolume(draft.voice_volume ?? state.luxuryAd.bgmAsset?.voice_volume, 1, 0.6, 1.2);
    state.luxuryAd.bgmVolume = clampLuxuryAudioVolume(draft.bgm_volume ?? state.luxuryAd.bgmAsset?.volume, 0.16, 0, 0.35);
    if (state.luxuryAd.bgmAsset) {
      state.luxuryAd.bgmAsset.volume = luxuryAdBgmVolume();
      state.luxuryAd.bgmAsset.voice_volume = luxuryAdVoiceVolume();
    }
    state.luxuryAd.briefInfo = project.brief_info || state.luxuryAd.briefInfo || null;
    state.luxuryAd.assetManifest = project.asset_manifest || null;
    state.luxuryAd.visualLocks = project.visual_locks || null;
    state.luxuryAd.globalVisualBible = project.global_visual_bible || null;
    state.luxuryAd.productionContract = project.production_contract || null;
    state.luxuryAd.productionProject = project;
    state.luxuryAd.productionProjectId = project.id || '';
    state.luxuryAd.storyboardDetailed = !!draft.storyboard_detailed || ['frame_reviewing', 'frame_ready', 'frame_failed', 'video_generating', 'video_ready'].includes(project.project_state);
    state.luxuryAd.keyframePlanningOnly = !!draft.keyframe_planning_only;
    state.luxuryAd.segments = Array.isArray(project.scenes) ? project.scenes : [];
    state.luxuryAd.keyframes = Array.isArray(project.keyframes) ? project.keyframes : [];
    state.luxuryAd.storyboardSheets = Array.isArray(project.storyboard_sheets) ? project.storyboard_sheets : [];
    state.luxuryAd.keyframeError = project.last_error || '';
    state.luxuryAd.keyframeErrorDetails = project.last_error ? { production_project: project } : null;
    state.luxuryAd.sceneGenerating = false;
    state.luxuryAd.scriptGenerating = false;
    state.luxuryAd.workflowProgress = null;
    const input = $('#dhLuxAdText');
    if (input) input.value = state.luxuryAd.content || '';
    syncLuxuryBriefInfoToControls(state.luxuryAd.briefInfo);
    syncLuxuryPersonSpecControls();
    const inModal = opts.modal === true && openLuxuryResumeModal();
    if (!inModal) switchTab('luxury-ad');
    showLuxuryAdStep(Math.max(1, Math.min(5, Number(state.luxuryAd.currentStep || 1))), { silent: true });
    renderLuxuryAd();
    if (!inModal) {
      requestAnimationFrame(() => {
        const target = document.querySelector('#dhLuxAdPanel') || document.querySelector('[data-pane="luxury-ad"]');
        target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      });
    }
    toast('已从任务中心恢复制作进度', 'success');
  }

  function luxuryAdProjectToTask(project = {}) {
    const keyframes = Array.isArray(project.keyframes) ? project.keyframes : [];
    const scenes = Array.isArray(project.scenes) ? project.scenes : [];
    const keyframeCount = keyframes.filter(k => k?.image_url || k?.imageUrl || k?.url).length;
    const shotCount = scenes.length;
    const inferredReady = keyframeCount > 0 && (!shotCount || keyframeCount >= shotCount);
    const status = project.status === 'failed' ? 'failed' : ((project.status === 'ready' || inferredReady) ? 'ready' : 'draft');
    const firstKeyframe = keyframes.find(k => k?.image_url || k?.imageUrl || k?.url) || null;
    const firstSheet = (Array.isArray(project.storyboard_sheets) ? project.storyboard_sheets : []).find(s => s?.image_url || s?.imageUrl || s?.url) || null;
    const thumbnailUrl = project.thumbnail_url
      || project.cover_url
      || project.visual_asset?.master_sheet_url
      || project.visual_asset?.sheet_url
      || firstKeyframe?.image_url
      || firstKeyframe?.imageUrl
      || firstKeyframe?.url
      || firstSheet?.image_url
      || firstSheet?.imageUrl
      || firstSheet?.url
      || '';
    return {
      taskId: `luxury_project_${project.id}`,
      projectId: project.id,
      isLuxuryProjectDraft: true,
      taskType: 'luxury_ad',
      status,
      stage: project.project_state || 'storyboard',
      avatarName: project.title || project.brief_info?.title || '剧情广告制作中',
      startedAt: Date.parse(project.updated_at || project.created_at || '') || Date.now(),
      ratio: project.ratio || '',
      thumbnailUrl,
      imageUrl: thumbnailUrl,
      textPreview: project.text || '',
      progress: status === 'ready' ? 90 : (shotCount ? (keyframeCount ? 75 : 45) : 15),
      project,
    };
  }

  function taskStatusBucket(status = '') {
    if (['draft', 'working', 'ready', 'error', 'invalid', 'timeout', 'failed'].includes(status)) return 'pending';
    if (ACTIVE_TASK_STATUSES.has(status)) return 'generating';
    if (status === 'done') return 'done';
    return 'pending';
  }

  async function refreshLuxuryAdProjectsForTaskCenter({ force = false, silent = false } = {}) {
    if (state.luxuryAdProjectsLoading) return;
    if (!force && Date.now() - Number(state.luxuryAdProjectsLoadedAt || 0) < 20000) return;
    state.luxuryAdProjectsLoading = true;
    try {
      const r = await api('/api/dh/luxury-ad/projects?limit=80');
      state.luxuryAdProjects = Array.isArray(r.projects) ? r.projects : [];
      state.luxuryAdProjectsLoadedAt = Date.now();
      renderTaskCenter();
    } catch (err) {
      if (!silent) toast('剧情广告制作进度读取失败：' + err.message, 'error');
    } finally {
      state.luxuryAdProjectsLoading = false;
    }
  }

  function renderLuxuryProductionProjectStatus() {
    const project = state.luxuryAd.productionProject || null;
    if (!project || typeof project !== 'object') return '';
    const visual = project.visual_asset || {};
    const sheetCount = Number(visual.sheet_count || (Array.isArray(visual.segment_sheet_urls) ? visual.segment_sheet_urls.length : 0)) || 0;
    const frameCount = Array.isArray(project.keyframes) ? project.keyframes.filter(k => k?.image_url || k?.imageUrl).length : 0;
    const shotCount = Array.isArray(project.scenes) ? project.scenes.length : (state.luxuryAd.segments || []).length;
    const idText = project.id ? String(project.id).slice(0, 8) : '未落盘';
    return `<section class="dh-lux-lock-panel">
      <div class="dh-lux-lock-head">
        <b>生产包</b>
        <span>${escapeHtml(luxuryProductionProjectStageLabel(project.project_state))} · ${escapeHtml(idText)}</span>
      </div>
      <div class="dh-lux-lock-grid">
        <div><small>项目阶段</small><b>${escapeHtml(luxuryProductionProjectStageLabel(project.project_state))}</b></div>
        <div><small>分镜板</small><b>${sheetCount ? `${sheetCount} 页已保存` : '未保存'}</b></div>
        <div><small>真实关键帧</small><b>${frameCount}/${shotCount || 0}</b></div>
      </div>
    </section>`;
  }

  function renderMaterialFilmStoryboard(sceneHost, scriptHost, frameHost) {
    const text = (state.luxuryAd.content || $('#dhLuxAdText')?.value || '').trim();
    const assets = luxuryMaterialAssetUrls();
    const segments = Array.isArray(state.luxuryAd.segments) ? state.luxuryAd.segments : [];
    const actor = luxuryAdPersonAssetPayload();
    const actorName = actor?.name || state.selectedAvatar?.name || '未选择演员';
    const duration = Number(state.luxuryAd.durationSec || 30);
    const ratio = state.luxuryAd.outputRatio || '9:16';
    if (sceneHost) {
      sceneHost.innerHTML = `
        <div class="dh-luxgen-outline-grid">
          <div class="dh-demo-card"><small>制作模式</small><b>素材成片</b><span>上传素材 + 演员 + 广告词，直接合成基础广告。</span></div>
          <div class="dh-demo-card"><small>素材数量</small><b>${assets.length ? `${assets.length} 个素材` : '未上传素材'}</b><span>${assets.length ? '这些素材会作为剪辑画面来源。' : '请上传产品、人物、场景或界面素材。'}</span></div>
          <div class="dh-demo-card"><small>演员</small><b>${escapeHtml(actorName)}</b><span>${actor ? '已作为口播/人物参考进入合成。' : '可从角色素材库选择，或上传真人参考。'}</span></div>
          <div class="dh-demo-card"><small>规格</small><b>${duration}s · ${escapeHtml(ratio)}</b><span>最终合成走素材成片接口，不调用分镜图片模型。</span></div>
        </div>`;
    }
    if (scriptHost) {
      scriptHost.innerHTML = segments.length
        ? `<div class="dh-luxgen-storyboard">
          ${segments.map((seg, i) => `<article>
            <b>${String(i + 1).padStart(2, '0')} · ${escapeHtml(seg.title || `广告词段落 ${i + 1}`)}</b>
            <span>${escapeHtml(luxuryAdShotTimeRange(seg, i, segments.length))}</span>
            <p>${escapeHtml(luxuryShotNarrationText(seg) || seg.visual || seg.text || '')}</p>
          </article>`).join('')}
        </div>`
        : luxuryAdEmptyBlock('还没有广告词方案', '点击“生成广告词方案”，系统会按素材成片生成 4 段口播文案。');
    }
    if (frameHost) {
      const thumbHtml = assets.slice(0, 8).map((url, i) => {
        const preview = luxuryAssetPreviewUrl({ url });
        return `<button type="button" class="dh-demo-frame-visual" data-lux-material-preview="${i}" title="点击预览素材">
          <img src="${escapeHtml(preview)}" alt="素材 ${i + 1}">
          <b>${String(i + 1).padStart(2, '0')} · 素材画面</b>
          <span>用于剪辑成片</span>
        </button>`;
      }).join('');
      frameHost.innerHTML = `
        <div class="dh-demo-script-review">
          <div>
            <b>素材成片不生成分镜图片</b>
            <span>${assets.length ? `已准备 ${assets.length} 个素材，确认配音后可合成` : '请先上传至少一张素材'}</span>
          </div>
          <button type="button" class="dh-luxgen-edit" data-lux-material-compose>${assets.length ? '进入成片合成' : '等待素材'}</button>
        </div>
        ${thumbHtml ? `<div class="dh-demo-frame-list">${thumbHtml}</div>` : luxuryAdEmptyBlock('还没有素材', '回到第 1 步或第 2 步上传产品、人物、场景、界面素材。')}
      `;
    }
    renderLuxuryAdPostScriptPerson();
    updateLuxuryAdStepLocks();
  }

  function renderLuxuryAdFrameCards(host, segments, keyframes) {
    if (!host) return;
    if (!segments.length || !state.luxuryAd.storyboardDetailed) {
      host.innerHTML = luxuryAdEmptyBlock('还没有分镜', '先生成并确认剧本，再点击“确认剧本，生成分镜”。');
      return;
    }
    const disabledAttr = state.luxuryAd.keyframeGenerating ? 'disabled' : '';
    const errorText = String(state.luxuryAd.keyframeError || '').trim();
    const errorDetailsHtml = renderLuxuryKeyframeErrorDetails(state.luxuryAd.keyframeErrorDetails);
    const planningOnly = state.luxuryAd.keyframePlanningOnly === true;
    const sheetCount = Array.isArray(state.luxuryAd.storyboardSheets)
      ? state.luxuryAd.storyboardSheets.filter(x => x && (x.image_url || x.imageUrl || x.url)).length
      : 0;
    const ratioStyle = luxuryAspectRatioStyle(state.luxuryAd.outputRatio || '9:16');
    const generatedFrameCount = Array.isArray(keyframes) ? keyframes.filter(luxuryFrameHasImage).length : 0;
    const missingFrameCount = Math.max(0, segments.length - generatedFrameCount);
    const reviewLabel = sheetCount
      ? `审核板 ${segments.length} 个镜头 · ${sheetCount} 页`
      : `镜头表 ${segments.length} 个镜头 · ${generatedFrameCount ? `已保留 ${generatedFrameCount} 张真实关键帧` : '真实关键帧未生成'}`;
    const regenerateLabel = planningOnly ? '生成真实关键帧' : '重新生成真实关键帧';
    const planningNotice = planningOnly && !errorText
      ? `<div class="dh-lux-keyframe-notice">
          <b>${sheetCount ? '当前只完成了审核分镜板' : '当前只完成了镜头表'}</b>
          <span>${sheetCount ? '这些审核板用于检查镜头、动作、台词和人物一致性。' : '当前没有审核板图片，先按镜头表检查内容。'}确认无误后点击“生成真实关键帧”。</span>
        </div>`
      : '';
    host.innerHTML = `
      <div class="dh-demo-script-review">
        <div>
          <b>分镜结果</b>
          <span>${state.luxuryAd.keyframeGenerating ? '正在按剧本生成分镜' : (planningOnly ? reviewLabel : `共 ${segments.length} 个镜头`)}</span>
        </div>
        <div class="dh-lux-frame-actions">
          ${missingFrameCount ? `<button type="button" class="dh-luxgen-edit" id="dhLuxAdFillMissingFrames" ${disabledAttr}>补齐未生成镜头（${missingFrameCount}）</button>` : ''}
          <button type="button" class="dh-luxgen-edit" id="dhLuxAdRegenerateFrames" ${disabledAttr}>${regenerateLabel}</button>
        </div>
      </div>
      <div class="dh-luxgen-live-progress dh-luxgen-script-progress" id="dhLuxAdFrameProgress" hidden></div>
      ${planningNotice}
      ${errorText ? `<div class="dh-demo-script-review dh-lux-keyframe-error"><b>${planningOnly ? '关键帧待重新生成' : '分镜生成已停止'}</b><span>${escapeHtml(errorText)}</span>${errorDetailsHtml}</div>` : ''}
      ${renderLuxuryStoryboardBriefingEntry(segments, keyframes)}
      ${renderLuxuryStoryboardSheet(segments, keyframes)}
    ` + segments.map((seg, i) => {
      const kf = keyframes[i] || {};
      const img = kf.image_url || kf.imageUrl || '';
      const binding = luxuryAdShotBoundAssets(seg, i);
      const boundImage = binding.ref?.url || binding.ref?.previewUrl || '';
      const preview = img || boundImage;
      const previewUrl = preview ? luxuryAssetPreviewUrl({ url: preview }) : '';
      const progressIndex = Number(state.luxuryAd.keyframeProgress?.current || 0);
      const isGeneratingShot = state.luxuryAd.keyframeGenerating && !img && i >= progressIndex;
      const refUploading = !!binding.ref?.uploading && !preview;
      const status = img ? '已生成分镜' : (refUploading ? '上传中' : (isGeneratingShot ? '生成中' : '待生成分镜'));
      const isLockedReference = String(kf.reference_mode || '').includes('reference_locked');
      const storyStage = luxuryNormalizeSceneStage(seg.story_stage, seg.shot_role || seg.role || seg.type, i, segments.length) || luxuryShotRoleName(seg.role || seg.shot_role) || '广告镜头';
      const shotAngle = luxuryShotAngleText(seg) || seg.shot_size || storyStage;
      const voiceText = luxuryShotNarrationText(seg);
      const promptText = luxuryShotContentPrompt(seg);
      const actionText = luxuryShotActionText(seg);
      const emotionText = luxuryShotEmotionText(seg);
      const audioText = luxuryShotAudioText(seg);
      const uiOverlayText = luxuryUiOverlaySummary(seg.ui_overlay || kf.ui_overlay || null, seg);
      const materialUsage = luxuryShotMaterialUsage(seg, i);
      const materialName = binding.items.map(x => `${x.label} ${x.name}`).join(' / ');
      const timeRange = luxuryAdShotTimeRange(seg, i, segments.length);
      // Strict contract preview: expose the exact fields that decide whether
      // the backend is allowed to spend image-generation cost for this shot.
      const strictContract = seg.strict_storyboard_contract || kf.strict_storyboard_contract || kf.shot_plan?.strict_storyboard_contract || null;
      const promptPreflight = seg.prompt_preflight || kf.prompt_preflight || kf.shot_plan?.prompt_preflight || null;
      const compiledPrompt = seg.compiled_image_prompt || kf.compiled_image_prompt || kf.shot_plan?.compiled_image_prompt || '';
      const mustShow = Array.isArray(strictContract?.must_show) ? strictContract.must_show.join('；') : '';
      const mustNotShow = Array.isArray(strictContract?.must_not_show) ? strictContract.must_not_show.join('；') : '';
      const preflightText = promptPreflight?.pass ? '预检通过' : (promptPreflight ? '预检未通过' : '等待预检');
      const frameLocks = kf.visual_locks || seg.visual_locks || null;
      const lockPrompt = [
        frameLocks?.reality_lock?.scene_basis ? `真实场景：${frameLocks.reality_lock.scene_basis}` : '',
        frameLocks?.product_lock?.subject ? `产品：${frameLocks.product_lock.subject}` : '',
        frameLocks?.scene_lock?.scene_basis ? `场景：${frameLocks.scene_lock.scene_basis}` : '',
        frameLocks?.ui_lock?.prompt ? 'UI：后期浮层锁' : '',
      ].filter(Boolean).join('；');
      const uiPost = kf.shot_plan?.ui_overlay_post || kf.ui_overlay_post || null;
      return `<article class="dh-demo-frame-card">
        <button type="button" class="dh-demo-frame-visual ${preview ? '' : 'pending'}" style="${ratioStyle}" ${preview ? `data-lux-shot-preview="${i}" title="查看第 ${i + 1} 镜全图"` : 'disabled'}>
          ${preview ? `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(seg.title || `镜头 ${i + 1}`)}">` : ''}
          <b>${String(i + 1).padStart(2, '0')} · ${escapeHtml(seg.title || storyStage)}</b>
          <span>${escapeHtml(timeRange)} · ${escapeHtml(status)}${isLockedReference ? ' · 已锁定参考' : ''}${preview ? ' · 点击查看全图' : ''}</span>
        </button>
        <div class="dh-demo-frame-info">
          <div class="dh-demo-card"><small>时间 / 目的</small><b>${escapeHtml(timeRange)} · ${escapeHtml(seg.objective || seg.intent || seg.purpose || storyStage)}</b><span>${escapeHtml(emotionText || '按广告节奏推进。')}</span></div>
          <div class="dh-demo-card"><small>内容 / 台词</small><b>${escapeHtml(promptText)}</b><span>台词：${escapeHtml(voiceText || '待生成')}</span></div>
          <div class="dh-demo-card"><small>动作 / 表情</small><b>${escapeHtml(actionText)}</b><span>${escapeHtml(emotionText)}</span></div>
          <div class="dh-demo-card"><small>镜头 / 构图</small><b>${escapeHtml(shotAngle)}</b><span>镜头运动：${escapeHtml(luxuryShotMotionLabel(seg))}</span></div>
          <div class="dh-demo-card"><small>声音 / 字幕</small><b>${escapeHtml(audioText)}</b><span>字幕：${escapeHtml(voiceText || '待生成')}</span></div>
          <div class="dh-demo-card"><small>UI / VFX</small><b>${escapeHtml(uiOverlayText || '无 UI 浮层')}</b><span>${escapeHtml(uiOverlayText ? '作为画面内的产品交互层参与分镜提示词。' : '当前镜头不强制生成弹窗、卡片或界面特效。')}</span></div>
          <div class="dh-demo-card"><small>后期 UI / QA</small><b>${escapeHtml(uiPost?.applied ? '已后期合成 UI 浮层' : '未触发后期 UI 合成')}</b><span>${escapeHtml(uiPost?.applied ? 'UI 已进入最终关键帧并再次质检。' : '无 UI 需求或等待关键帧生成。')}</span>${renderLuxuryFrameQaDimensions(kf) || '<span>等待 QA 维度评分</span>'}</div>
          <div class="dh-demo-card"><small>本镜视觉锁</small><b>${escapeHtml(lockPrompt || '等待资产锁')}</b><span>${escapeHtml(frameLocks ? '人物/产品/场景/道具/UI 会进入后端严格合约。' : '当前镜头尚未收到 visual_locks。')}</span></div>
          <div class="dh-demo-card"><small>AI 生成指令</small><b>${escapeHtml(luxuryAdTopviewPrompt(seg, i))}</b><span>${escapeHtml(materialUsage)}${materialName ? ` · ${escapeHtml(materialName)}` : ''}</span></div>
          <div class="dh-demo-card"><small>严格合约 / 预检</small><b>${escapeHtml(preflightText)}</b><span>必须出现：${escapeHtml(mustShow || '待生成')}；禁止：${escapeHtml(mustNotShow || '待生成')}</span></div>
          <div class="dh-demo-card wide"><small>图片提示词编译结果</small><b>${escapeHtml(compiledPrompt || '等待后端编译')}</b><span>该提示词是图片模型唯一执行指令；缺失时后端会停止。</span></div>
          <div class="dh-demo-card wide"><small>操作</small><b>${escapeHtml(status)}</b><span>
            ${img ? `<button type="button" class="dh-luxgen-edit" disabled>已选用此图</button> <button type="button" class="dh-luxgen-edit" data-lux-shot-preview="${i}">查看全图</button>` : ''}
            <button type="button" class="dh-luxgen-edit" data-lux-shot-regenerate="${i}" ${disabledAttr}>重新生成本镜</button>
            <button type="button" class="dh-luxgen-edit" data-lux-shot-edit="${i}">编辑分镜</button>
            <button type="button" class="dh-luxgen-shot-upload" data-lux-shot-upload="${i}">${binding.ref ? '替换分镜画面' : '上传分镜画面'}</button>
          </span></div>
        </div>
      </article>`;
    }).join('');
    renderLuxuryWorkflowProgress();
  }

  function renderLuxuryAdStoryboard() {
    reconcileLuxuryAdGenerationState();
    const sceneHost = $('#dhLuxAdSceneConfigHost') || $('#dhLuxAdStoryboardHost');
    const scriptHost = $('#dhLuxAdScriptHost');
    const frameHost = $('#dhLuxAdFrameHost');
    const segments = applyLuxuryShotBindings(state.luxuryAd.segments || []);
    const keyframes = state.luxuryAd.keyframes || [];
    renderLuxuryCommercialGuard();
    if (luxuryAdIsMaterialMode()) {
      renderMaterialFilmStoryboard(sceneHost, scriptHost, frameHost);
      return;
    }
    if (state.luxuryAd.sceneGenerating) {
      if (sceneHost) sceneHost.innerHTML = luxuryAdEmptyBlock('基础信息生成中', '正在分析广告需求、主体来源、真实场景和全局视觉。生成完成前不展示草稿镜头。');
      if (scriptHost) scriptHost.innerHTML = luxuryAdEmptyBlock('等待剧本', '基础信息完成后再生成剧本审核表。');
      if (frameHost) frameHost.innerHTML = luxuryAdEmptyBlock('等待分镜', '剧本确认后才会生成图片分镜。');
      renderLuxuryAdPostScriptPerson();
      updateLuxuryAdStepLocks();
      return;
    }
    if (state.luxuryAd.scriptGenerating) {
      if (sceneHost) renderLuxuryAdOutline(sceneHost, segments);
      if (scriptHost) {
        if (segments.length) renderLuxuryAdScriptTable(scriptHost, segments);
        else scriptHost.innerHTML = `<div class="dh-luxgen-empty"><b>剧本生成中</b><span>正在生成可审核剧本表；完成后会立即显示镜、秒、画面、动作、台词、目的和状态。若不满意，可点击上方“重新生成剧本”。</span></div>`;
      }
      if (frameHost) frameHost.innerHTML = luxuryAdEmptyBlock('等待分镜', '剧本审核通过后才会调用图片模型。');
      renderLuxuryAdPostScriptPerson();
      updateLuxuryAdStepLocks();
      return;
    }
    if (!segments.length) {
      if (sceneHost) sceneHost.innerHTML = luxuryAdEmptyBlock('还没有基础信息', '先写广告需求。AI 会先解析标题、主题、风格、时长和比例。');
      if (scriptHost) scriptHost.innerHTML = luxuryAdEmptyBlock('还没有剧本', '请先完成基础信息配置，再生成剧本。');
      if (frameHost) frameHost.innerHTML = luxuryAdEmptyBlock('还没有分镜', '确认剧本后再生成分镜。');
      renderLuxuryAdPostScriptPerson();
      updateLuxuryAdStepLocks();
      return;
    }
    if (sceneHost) renderLuxuryAdOutline(sceneHost, segments);
    renderLuxuryAdScriptTable(scriptHost, segments);
    renderLuxuryAdPostScriptPerson();
    renderLuxuryAdFrameCards(frameHost, segments, keyframes);
    updateLuxuryAdStepLocks();
  }

  function readLuxuryShotEditorSegment(seg = {}) {
    const ref = Math.max(0, Number($('#dhLuxShotReference')?.value || seg.reference_index || 0));
    return {
      ...seg,
      reference_index: ref,
      reference_label: luxuryAdReferenceLabel(ref),
      title: ($('#dhLuxShotTitle')?.value || seg.title || '').trim(),
      role: $('#dhLuxShotRole')?.value || seg.role || 'display',
      story_stage: luxuryShotRoleName($('#dhLuxShotRole')?.value || seg.role || 'display'),
      shot_size: ($('#dhLuxShotSize')?.value || seg.shot_size || '').trim(),
      shot_angle: ($('#dhLuxShotSize')?.value || seg.shot_angle || '').trim(),
      objective: ($('#dhLuxShotObjective')?.value || seg.objective || '').trim(),
      duration: Math.max(2, Math.min(12, Number($('#dhLuxShotDuration')?.value || seg.duration || 6))),
      content_prompt: ($('#dhLuxShotVisual')?.value || seg.content_prompt || '').trim(),
      scene_content: ($('#dhLuxShotVisual')?.value || seg.scene_content || '').trim(),
      visual: ($('#dhLuxShotVisual')?.value || seg.visual || '').trim(),
      display_visual: ($('#dhLuxShotVisual')?.value || seg.display_visual || '').trim(),
      narration: ($('#dhLuxShotVoice')?.value || seg.narration || '').trim(),
      voiceover: ($('#dhLuxShotVoice')?.value || seg.voiceover || '').trim(),
      ad_copy: ($('#dhLuxShotVoice')?.value || seg.ad_copy || '').trim(),
      subtitle: ($('#dhLuxShotVoice')?.value || seg.subtitle || '').trim(),
      text: ($('#dhLuxShotVoice')?.value || seg.text || '').trim(),
      action: ($('#dhLuxShotAction')?.value || seg.action || seg.visual_action || '').trim(),
      visual_action: ($('#dhLuxShotAction')?.value || seg.visual_action || seg.action || '').trim(),
      emotion: ($('#dhLuxShotEmotion')?.value || seg.emotion || seg.mood || '').trim(),
      mood: ($('#dhLuxShotEmotion')?.value || seg.mood || seg.emotion || '').trim(),
      sfx_audio: ($('#dhLuxShotAudio')?.value || seg.sfx_audio || seg.sfx || seg.audio || '').trim(),
      camera: ($('#dhLuxShotMotion')?.value || seg.camera || '').trim(),
      camera_label: ($('#dhLuxShotMotion')?.value || seg.camera_label || '').trim(),
      motion: ($('#dhLuxShotMotion')?.value || seg.motion || '').trim(),
      style_note: ($('#dhLuxShotOther')?.value || seg.style_note || '').trim(),
      other: ($('#dhLuxShotOther')?.value || seg.other || '').trim(),
      topview_prompt: ($('#dhLuxShotTopviewPrompt')?.value || seg.topview_prompt || '').trim(),
      reference_prompt: ($('#dhLuxShotTopviewPrompt')?.value || seg.reference_prompt || '').trim(),
      ui_overlay: luxuryNormalizeUiOverlay($('#dhLuxShotUiOverlay')?.value || seg.ui_overlay || '', seg),
    };
  }

  function fillLuxuryShotEditorFromSegment(seg = {}) {
    const set = (selector, value) => {
      const el = $(selector);
      if (el && value !== undefined && value !== null && String(value).trim()) el.value = String(value);
    };
    set('#dhLuxShotTitle', seg.title);
    if ($('#dhLuxShotRole') && seg.role) $('#dhLuxShotRole').value = seg.role;
    set('#dhLuxShotSize', seg.shot_angle || seg.shot_size);
    set('#dhLuxShotDuration', seg.duration);
    set('#dhLuxShotObjective', seg.objective || seg.intent || seg.purpose);
    set('#dhLuxShotVisual', seg.content_prompt || seg.scene_content || seg.visual || seg.display_visual);
    set('#dhLuxShotVoice', seg.voiceover || seg.narration || seg.ad_copy || seg.subtitle || seg.text);
    set('#dhLuxShotAction', seg.action || seg.visual_action || seg.characters_action);
    set('#dhLuxShotEmotion', seg.emotion || seg.mood || seg.atmosphere || seg.expression);
    set('#dhLuxShotAudio', seg.sfx_audio || seg.sfx || seg.audio || seg.sound);
    set('#dhLuxShotMotion', seg.motion || seg.camera_label || seg.camera);
    set('#dhLuxShotOther', seg.style_note || seg.other);
    set('#dhLuxShotTopviewPrompt', seg.topview_prompt || seg.reference_prompt);
    set('#dhLuxShotUiOverlay', luxuryUiOverlaySummary(seg.ui_overlay || seg.uiOverlay || seg.overlay_prompt || seg.vfx_prompt || null, seg));
    const ref = Number(seg.reference_index || 0);
    const refSelect = $('#dhLuxShotReference');
    if (refSelect && Number.isFinite(ref) && ref >= 0 && Array.from(refSelect.options).some(o => Number(o.value) === ref)) {
      refSelect.value = String(ref);
    }
  }

  async function aiRewriteLuxuryShot(index, seg = {}) {
    const instruction = ($('#dhLuxShotAiInstruction')?.value || '').trim();
    if (instruction.length < 4) return toast('请先写清楚希望 AI 怎么修改这一镜头', 'error');
    const btn = $('#dhLuxShotAiRewrite');
    const old = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = 'AI 修改中…'; }
    try {
      const current = readLuxuryShotEditorSegment(seg);
      const r = await api('/api/dh/luxury-ad/shot-rewrite', {
        method: 'POST',
        body: {
          instruction,
          brief: state.luxuryAd.content || $('#dhLuxAdText')?.value || '',
          segment: current,
          index,
          total: state.luxuryAd.segments?.length || 1,
          duration_sec: state.luxuryAd.durationSec || 30,
          product_name: state.luxuryAd.productAsset?.name || '',
          asset_summary: luxuryAdAssetSummary(),
          output_ratio: state.luxuryAd.outputRatio || '9:16',
          product_asset: state.luxuryAd.productAsset || null,
          reference_assets: luxuryAdReferenceAssets().map((asset, i) => asset && (asset.url || asset.previewUrl || asset.name) ? ({
            index: i + 1,
            name: asset.name || `分镜画面 ${i + 1}`,
            url: compactLuxuryUrl(asset.url || ''),
          }) : null).filter(Boolean),
          person_asset: luxuryAdPersonAssetPayload(),
        },
      });
      if (!r.success || !r.segment) throw new Error(r.error || 'AI 修改失败');
      fillLuxuryShotEditorFromSegment(r.segment);
      toast('AI 已重写这一镜头，请检查后保存', 'success');
    } catch (err) {
      toast('AI 修改失败：' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = old || 'AI 修改这一镜'; }
    }
  }

  function openLuxuryShotEditor(index) {
    const idx = Number(index);
    const seg = (state.luxuryAd.segments || [])[idx];
    if (!seg) return toast('镜头不存在，请重新生成详细分镜', 'error');
    if (state.luxuryAd.keyframeGenerating) return toast('正在生成画面预览，完成后再修改分镜', 'error');
    const role = seg.shot_role || seg.role || seg.type || '';
    const duration = Math.round((Number(seg.duration || seg.duration_sec || seg.seconds || 0) || Number(luxuryShotDurationLabel(seg, state.luxuryAd.durationSec, state.luxuryAd.segments.length).replace(/[^\d.]/g, '')) || 6) * 10) / 10;
    const refAssets = luxuryAdReferenceAssets()
      .map((asset, i) => asset && (asset.url || asset.previewUrl || asset.name) ? { ...asset, _slotIndex: i } : null)
      .filter(Boolean);
    const currentRefIndex = luxuryAdShotRefIndex(seg, idx);
    const mask = document.createElement('div');
    mask.className = 'dh-luxgen-writer-mask';
    mask.innerHTML = `
      <div class="dh-luxgen-writer-modal" role="dialog" aria-modal="true" aria-label="修改广告分镜">
        <div class="dh-luxgen-writer-head">
          <div>
            <h3>修改第 ${idx + 1} 个广告分镜</h3>
            <p>修改的是这一段场景的画面、动作表情、广告词、镜头运动和声音；保存后旧分镜会失效，需要重新生成对应分镜后再合成。</p>
          </div>
          <button class="dh-icon-btn" type="button" data-lux-shot-close>×</button>
        </div>
        <div class="dh-luxgen-writer-body">
          <div class="dh-luxgen-ai-edit">
            <label class="dh-field">
              <span>AI 修改要求</span>
              <textarea class="dh-input" id="dhLuxShotAiInstruction" rows="3" placeholder="把你想要的效果写给 AI，例如：这一镜从真实问题推进到主体证据，画面更可信，广告词像品牌片，不要写成说明文。"></textarea>
            </label>
            <div class="dh-luxgen-ai-edit-actions">
              <small>AI 会根据广告需求、当前分镜、素材绑定和你的要求，回填场景目标、动作表情、镜头内容、成片广告词、声音和转场。</small>
              <button class="dh-btn dh-btn-ghost" type="button" id="dhLuxShotAiRewrite">AI 修改这一镜</button>
            </div>
          </div>
          <div class="dh-luxgen-writer-grid">
            <label class="dh-field">
              <span>镜头名称</span>
              <input class="dh-input" id="dhLuxShotTitle" value="${escapeHtml(seg.title || '')}" maxlength="24">
            </label>
            <label class="dh-field">
              <span>场景位置 / 分镜阶段</span>
              <select class="dh-input" id="dhLuxShotRole">
                ${[
                  ['hook', '开场分镜'],
                  ['display', '第二场景'],
                  ['macro', '细节分镜'],
                  ['benefit', '场景转折'],
                  ['proof', '卖点分镜'],
                  ['cta', '收尾分镜'],
                ].map(([value, label]) => `<option value="${value}" ${String(role) === value ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="dh-luxgen-writer-grid">
            <label class="dh-field">
              <span>拍摄角度及镜头（景别）</span>
              <input class="dh-input" id="dhLuxShotSize" value="${escapeHtml(luxuryShotAngleText(seg))}" placeholder="例如：微观全景 / 固定镜头">
            </label>
            <label class="dh-field">
              <span>预计时长（秒）</span>
              <input class="dh-input" id="dhLuxShotDuration" type="number" min="2" max="12" step="0.1" value="${escapeHtml(String(duration || 6))}">
            </label>
          </div>
          <div class="dh-luxgen-writer-grid">
            <label class="dh-field">
              <span>分镜使用素材（画面）</span>
              <select class="dh-input" id="dhLuxShotReference">
                <option value="0" ${currentRefIndex === 0 ? 'selected' : ''}>@主商品</option>
                ${refAssets.map(asset => {
                  const value = asset._slotIndex + 1;
                  return `<option value="${value}" ${currentRefIndex === value ? 'selected' : ''}>@分镜画面${value} · ${escapeHtml(asset.name || `画面 ${value}`)}</option>`;
                }).join('')}
              </select>
            </label>
            <label class="dh-field">
              <span>这一镜讲什么 / 起什么作用</span>
              <input class="dh-input" id="dhLuxShotObjective" value="${escapeHtml(seg.objective || seg.intent || seg.purpose || '')}" placeholder="这一段在广告故事里负责什么">
            </label>
          </div>
          <label class="dh-field">
            <span>镜头内容提示词</span>
            <textarea class="dh-input" id="dhLuxShotVisual" rows="4" placeholder="写清楚这一镜画面里出现什么、主体如何运动、如何过渡。这里不是广告词。">${escapeHtml(luxuryShotContentPrompt(seg))}</textarea>
          </label>
          <label class="dh-field">
            <span>成片旁白 / 字幕广告词</span>
            <textarea class="dh-input" id="dhLuxShotVoice" rows="3" placeholder="写观众最终听到或看到的话，例如：关键变化，现在看得见。不要写镜头说明或提示词。">${escapeHtml(luxuryShotNarrationText(seg))}</textarea>
          </label>
          <div class="dh-luxgen-writer-grid">
            <label class="dh-field">
              <span>动作 / 表情</span>
              <textarea class="dh-input" id="dhLuxShotAction" rows="3" placeholder="例如：人物眉头放松，手势展开，主体证据从问题状态变成清晰结果。">${escapeHtml(luxuryShotActionText(seg))}</textarea>
            </label>
            <label class="dh-field">
              <span>情绪 / 氛围</span>
              <textarea class="dh-input" id="dhLuxShotEmotion" rows="3" placeholder="例如：先焦虑，再轻松，画面安静可信。">${escapeHtml(luxuryShotEmotionText(seg))}</textarea>
            </label>
          </div>
          <label class="dh-field">
            <span>UI 浮层 / 视觉特效</span>
            <textarea class="dh-input" id="dhLuxShotUiOverlay" rows="3" placeholder="例如：主体旁出现克制的半透明结果提示，不遮挡人物、手部和主体证据。">${escapeHtml(luxuryUiOverlaySummary(seg.ui_overlay || seg.uiOverlay || seg.overlay_prompt || seg.vfx_prompt || null, seg))}</textarea>
          </label>
          <label class="dh-field">
            <span>镜头运动</span>
            <textarea class="dh-input" id="dhLuxShotMotion" rows="3">${escapeHtml(luxuryShotMotionLabel(seg))}</textarea>
          </label>
          <label class="dh-field">
            <span>SFX / 声音</span>
            <textarea class="dh-input" id="dhLuxShotAudio" rows="3" placeholder="例如：轻柔提示音、纸张翻动声、低频氛围音乐。">${escapeHtml(luxuryShotAudioText(seg))}</textarea>
          </label>
          <label class="dh-field">
            <span>其他（风格 / 光线 / 转场）</span>
            <textarea class="dh-input" id="dhLuxShotOther" rows="3" placeholder="例如：风格：极简明亮；光线：侧逆光；转场：溶化进入下一镜">${escapeHtml(luxuryShotOtherText(seg))}</textarea>
          </label>
        </div>
        <div class="dh-luxgen-writer-foot">
          <button class="dh-btn dh-btn-ghost" type="button" data-lux-shot-close>取消</button>
          <button class="dh-btn dh-btn-primary" type="button" id="dhLuxShotSave">保存修改</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    const close = () => mask.remove();
    mask.addEventListener('click', e => {
      if (e.target === mask || e.target.closest('[data-lux-shot-close]')) close();
    });
    $('#dhLuxShotAiRewrite')?.addEventListener('click', () => aiRewriteLuxuryShot(idx, seg));
    $('#dhLuxShotSave')?.addEventListener('click', () => {
      const editedRef = Math.max(0, Number($('#dhLuxShotReference')?.value || 0));
      const editedVisual = ($('#dhLuxShotVisual')?.value || '').trim();
      const editedMotion = ($('#dhLuxShotMotion')?.value || '').trim();
      const promptSeed = {
        ...seg,
        reference_index: editedRef,
        display_visual: editedVisual,
        visual: editedVisual,
        scene_content: editedVisual,
        action: ($('#dhLuxShotAction')?.value || '').trim(),
        visual_action: ($('#dhLuxShotAction')?.value || '').trim(),
        emotion: ($('#dhLuxShotEmotion')?.value || '').trim(),
        mood: ($('#dhLuxShotEmotion')?.value || '').trim(),
        sfx_audio: ($('#dhLuxShotAudio')?.value || '').trim(),
        ui_overlay: luxuryNormalizeUiOverlay($('#dhLuxShotUiOverlay')?.value || '', seg),
        camera: editedMotion,
        camera_label: editedMotion,
        motion: editedMotion,
      };
      const hiddenPrompt = seg.topview_prompt || seg.reference_prompt || luxuryAdTopviewPrompt(promptSeed, idx);
      const next = {
        ...seg,
        reference_index: editedRef,
        reference_label: luxuryAdReferenceLabel(editedRef),
        reference_mentions: editedRef > 0 ? ['@主商品', luxuryAdReferenceLabel(editedRef)] : ['@主商品'],
        title: ($('#dhLuxShotTitle')?.value || '').trim() || seg.title,
        role: $('#dhLuxShotRole')?.value || seg.role || 'display',
        story_stage: luxuryShotRoleName($('#dhLuxShotRole')?.value || seg.role || 'display'),
        shot_size: ($('#dhLuxShotSize')?.value || '').trim(),
        shot_angle: ($('#dhLuxShotSize')?.value || '').trim(),
        objective: ($('#dhLuxShotObjective')?.value || '').trim(),
        duration: Math.max(2, Math.min(12, Number($('#dhLuxShotDuration')?.value || seg.duration || 6))),
        content_prompt: ($('#dhLuxShotVisual')?.value || '').trim(),
        narration: ($('#dhLuxShotVoice')?.value || '').trim(),
        ad_copy: ($('#dhLuxShotVoice')?.value || '').trim(),
        style_note: ($('#dhLuxShotOther')?.value || '').trim() || `风格：克制高级；转场：${($('#dhLuxShotMotion')?.value || '').trim() || '顺接下一镜'}`,
        other: ($('#dhLuxShotOther')?.value || '').trim(),
        voiceover: ($('#dhLuxShotVoice')?.value || '').trim(),
        subtitle: ($('#dhLuxShotVoice')?.value || '').trim(),
        text: ($('#dhLuxShotVoice')?.value || '').trim(),
        scene_content: ($('#dhLuxShotVisual')?.value || '').trim(),
        visual: ($('#dhLuxShotVisual')?.value || '').trim(),
        display_visual: ($('#dhLuxShotVisual')?.value || '').trim(),
        action: ($('#dhLuxShotAction')?.value || '').trim(),
        visual_action: ($('#dhLuxShotAction')?.value || '').trim(),
        emotion: ($('#dhLuxShotEmotion')?.value || '').trim(),
        mood: ($('#dhLuxShotEmotion')?.value || '').trim(),
        sfx_audio: ($('#dhLuxShotAudio')?.value || '').trim(),
        ui_overlay: luxuryNormalizeUiOverlay($('#dhLuxShotUiOverlay')?.value || '', promptSeed),
        camera: ($('#dhLuxShotMotion')?.value || '').trim(),
        camera_label: ($('#dhLuxShotMotion')?.value || '').trim(),
        motion: ($('#dhLuxShotMotion')?.value || '').trim(),
        topview_prompt: hiddenPrompt,
        reference_prompt: hiddenPrompt,
        material_usage: editedRef > 0 ? `@主商品 + ${luxuryAdReferenceLabel(editedRef)}` : '@主商品 / AI 按镜头提示生成画面',
        material_hint: editedRef > 0 ? `@主商品 + ${luxuryAdReferenceLabel(editedRef)}` : '@主商品 / AI 按镜头提示生成画面',
        user_edited: true,
      };
      state.luxuryAd.segments = (state.luxuryAd.segments || []).map((item, i) => i === idx ? next : item);
      if (Array.isArray(state.luxuryAd.keyframes) && state.luxuryAd.keyframes[idx]?.image_url) {
        state.luxuryAd.keyframes[idx] = {};
        toast('已保存修改，这个镜头需要重新生成预览', 'success');
      } else {
        toast('已保存分镜修改', 'success');
      }
      close();
      renderLuxuryAdStoryboard();
    });
    setTimeout(() => $('#dhLuxShotTitle')?.focus(), 30);
  }

  function luxuryStoryboardRequestKey(detail = false) {
    return `${detail ? 'detail' : 'outline'}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function luxuryKeyframeRequestKey(onlyIndex = null) {
    const shot = Number.isInteger(onlyIndex) ? `shot${onlyIndex + 1}` : 'all';
    return `keyframes_${shot}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function luxuryPersonSheetRequestKey() {
    return `person_sheet_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  async function pollLuxuryStoryboardResult(requestKey, { detail = false, timeoutMs = 0, missingRetryMs = 45000 } = {}) {
    const started = Date.now();
    let lastStatus = '';
    let seenServerJob = false;
    const runningMessage = detail
      ? '剧本生成中，后台会持续生成到完成，完成后自动进入下一步。'
      : '场景配置生成中，后台会持续生成到完成，完成后自动进入下一步。';
    while (!timeoutMs || Date.now() - started < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      try {
        const r = await api(`/api/dh/luxury-ad/storyboard/result/${encodeURIComponent(requestKey)}`);
        seenServerJob = true;
        if (r.status === 'done' && r.result) return r.result;
        if (r.status === 'error') throw new Error(r.error || '生成失败');
        if (r.status && r.status !== lastStatus) {
          lastStatus = r.status;
          updateLuxuryWorkflowProgress(runningMessage, Math.max(88, state.luxuryAd.workflowProgress?.percent || 88));
        }
      } catch (err) {
        const missingResult = /还未产生|已过期|missing|404/i.test(String(err.message || ''));
        if (!missingResult) throw err;
        if (!seenServerJob && missingRetryMs && Date.now() - started >= missingRetryMs) {
          const retryErr = new Error('RESULT_MISSING_AFTER_DISCONNECT');
          retryErr.code = 'RESULT_MISSING_AFTER_DISCONNECT';
          throw retryErr;
        }
        updateLuxuryWorkflowProgress(runningMessage, Math.max(88, state.luxuryAd.workflowProgress?.percent || 88));
      }
    }
    throw new Error('服务器仍在生成，请稍后刷新页面或重新进入本步骤查看');
  }

  async function pollLuxuryKeyframeResult(requestKey, { timeoutMs = 0, totalShots = 1, missingRetryMs = 45000 } = {}) {
    const started = Date.now();
    let lastStatus = '';
    const missingUntil = Date.now() + Math.max(0, Number(missingRetryMs) || 0);
    while (!timeoutMs || Date.now() - started < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      let r;
      try {
        r = await api(`/api/dh/spaces/keyframes/result/${encodeURIComponent(requestKey)}`);
      } catch (err) {
        if (err?.status === 404 && Date.now() < missingUntil) continue;
        if (isLuxuryStoryboardLongRunningError(err)) continue;
        throw err;
      }
      if (r.status === 'done' && r.result) return r.result;
      if (r.status === 'error') {
        const err = new Error(r.error || '分镜生成失败');
        err.data = { code: r.code || r.details?.code || '', details: r.details || {}, production_project: r.details?.production_project || null };
        err.status = r.http_status || r.status_code || 422;
        throw err;
      }
      if (r.status && r.status !== lastStatus) {
        lastStatus = r.status;
        const elapsed = Math.max(1, Math.round((Date.now() - started) / 1000));
        if (r.production_project) applyLuxuryProductionProject(r.production_project);
        state.luxuryAd.keyframeProgress = {
          current: Math.min(Math.max(0, Number(state.luxuryAd.keyframeProgress?.current || 0)), totalShots),
          total: totalShots,
          startedAt: state.luxuryAd.keyframeProgress?.startedAt || started,
          message: `分镜生成时间较长，正在等待同一任务返回结果，已用 ${elapsed} 秒。`,
        };
        updateLuxuryKeyframeWorkflowProgress(state.luxuryAd.keyframeProgress);
      }
    }
    throw new Error('服务器仍在生成分镜，请稍后刷新页面或重新进入本步骤查看');
  }

  async function pollLuxuryPersonSheetResult(requestKey, { timeoutMs = 0, missingRetryMs = 45000 } = {}) {
    const started = Date.now();
    let seenServerJob = false;
    const missingUntil = Date.now() + Math.max(0, Number(missingRetryMs) || 0);
    while (!timeoutMs || Date.now() - started < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      try {
        const r = await api(`/api/dh/luxury-ad/person-sheet/result/${encodeURIComponent(requestKey)}`);
        seenServerJob = true;
        if (r.status === 'done' && r.result) return r.result;
        if (r.status === 'error') {
          const err = new Error(r.error || '人物演员包生成失败');
          err.data = r.details || null;
          throw err;
        }
        state.luxuryAd.personGenerationProgress = {
          ...(state.luxuryAd.personGenerationProgress || {}),
          active: true,
          label: 'AI 真人感演员包',
          phase: '后台生成中',
          message: '服务器正在继续生成演员包，页面会自动刷新结果。',
          percent: Math.max(86, Number(state.luxuryAd.personGenerationProgress?.percent || 86)),
        };
        renderLuxuryAdPerson();
      } catch (err) {
        const missing = err?.status === 404 || /还未产生|已过期|missing|404/i.test(String(err.message || ''));
        if (missing && (!seenServerJob || Date.now() < missingUntil)) continue;
        if (isLuxuryStoryboardLongRunningError(err)) continue;
        throw err;
      }
    }
    throw new Error('服务器仍在生成演员包，请稍后重新进入本步骤查看');
  }

  function isLuxuryStoryboardLongRunningError(err) {
    const status = Number(err?.status || err?.data?.status || 0);
    const message = String(err?.message || '');
    return [502, 503, 504].includes(status)
      || /Gateway\s*Time-?out|Gateway\s*Timeout|Bad\s*Gateway|Service\s*Unavailable|Failed to fetch|ERR_EMPTY_RESPONSE|NetworkError|Load failed/i.test(message);
  }

  function luxuryKeyframeErrorMessage(err) {
    const code = String(err?.data?.code || err?.code || '').trim();
    const msg = String(err?.message || '').trim();
    const attempts = Array.isArray(err?.data?.details?.attempts) ? err.data.details.attempts : [];
    if (attempts.length) {
      const label = a => [a?.provider_id || a?.provider, a?.model_id || a?.model].filter(Boolean).join('/');
      const gptImage2 = attempts.find(a => /gpt-image-2/i.test(label(a)));
      const qaRejectedAttempt = attempts.find(a => a.qa && a.qa.pass !== true && a.qa.accepted_with_warning !== true);
      const allQaRejected = attempts.some(a => a.qa) && attempts.filter(a => a.qa).every(a => a.qa.pass !== true && a.qa.accepted_with_warning !== true);
      const topviewAttempts = attempts.filter(a => /topview/i.test(label(a)));
      const topviewAllFailed = topviewAttempts.length > 0
        && topviewAttempts.every(a => !a.ok && /All tasks failed|5000|quota|balance|余额|insufficient/i.test(String(a.error || '')));
      if (topviewAllFailed) {
        return '分镜生成已停止：Topview 图片通道全部返回 All tasks failed。请优先检查 Topview 余额、额度或账号授权；系统没有跳过严格 QA，也没有生成可商用关键帧。';
      }
      if (gptImage2 && !gptImage2.ok && /500|Internal Server Error|provider error|未返回图片|no image|未返回图片数据/i.test(String(gptImage2.error || ''))) {
        return [
          '分镜生成已停止：DeyunAI GPT Image 2 通道返回 500，未返回可用图片数据。',
          qaRejectedAttempt ? '后续图片候选已生成，但视觉 QA 判定画面与剧本/资产锁不一致。' : '',
          '这不是“余额不足”，需要检查 GPT Image 2 企业接口参数/通道状态，同时按候选图 QA 原因调整镜头合同或参考图。',
        ].filter(Boolean).join('');
      }
      if (allQaRejected) {
        return '分镜生成已停止：图片候选已生成，但全部未通过视觉 QA，主要是画面主体、场景、人物一致性或资产锁与剧本不一致。请展开候选明细查看具体模型和被拒绝图片。';
      }
    }
    const qaFailed = code === 'LUXURY_KEYFRAME_STORYBOARD_QA_FAILED'
      || /QA未通过|剧本一致性|storyboard[_\s-]*match|Wrong product|Wrong scene|Missing required|视觉质检.*拒绝|分镜图.*不一致/i.test(msg);
    if (code === 'LUXURY_KEYFRAME_QA_UNAVAILABLE') {
      return '分镜生成已停止：当前视觉质检模型不可用，系统无法确认生成画面是否严格符合剧本。请到模型调用管理为 luxury_ad.keyframe_qa 配置可用多模态质检模型；如果已配置但仍返回 Insufficient quota，请检查漫路视觉/海外通道额度、模型分组授权，或切换可用视觉模型。';
    }
    if (qaFailed) {
      return `分镜图未通过剧本一致性检查：${msg || '画面主体、场景、动作或镜头意图与已确认剧本不一致，请调整该镜头后重试。'}`;
    }
    if (code === 'PROVIDER_LIMIT_EXCEEDED' || err?.status === 429 || /quota|rate limit|额度|上限|Too Many Requests/i.test(msg)) {
      return '分镜生成已停止：当前图片或视觉质检模型通道返回额度/频率限制，不等同于账户总余额不足。请切换可用模型、检查对应模型通道额度/分组授权，或稍后重试。系统不会跳过剧本一致性检查。';
    }
    return msg || '分镜生成失败';
  }

  async function buildLuxuryAdStoryboard({ autoNext = false, detail = false, triggerButton = null } = {}) {
    if (luxuryAdIsMaterialMode()) {
      buildMaterialFilmCopyPlan();
      return true;
    }
    const text = ($('#dhLuxAdText')?.value || state.luxuryAd.content || '').trim();
    const refs = luxuryAdRefs();
    if (!text) return toast('请先输入广告需求、产品介绍或一句话想法', 'error');
    if (state.luxuryAd.briefUploading) return toast('需求参考图仍在上传，请稍等', 'error');
    if (state.luxuryAd.uploading) return toast('图片仍在上传，请稍等', 'error');
    try {
      // 生成场景/剧本前必须保证所有可见预览都有服务端 URL。
      assertLuxuryAdNoLocalOnlyPreviews(detail ? '生成剧本' : '生成场景配置');
    } catch (err) {
      return toast(err.message, 'error');
    }
    if (detail && !state.luxuryAd.segments?.length) return toast('请先生成场景配置，再生成剧本', 'error');
    if (detail && !String(state.luxuryAd.briefInfo?.title || '').trim()) return toast('请先填写标题，再生成剧本', 'error');
    state.luxuryAd.content = text;
    state.luxuryAd.durationSec = Number($('#dhLuxAdDuration')?.value || state.luxuryAd.durationSec || 30);
    state.luxuryAd.outputRatio = $('#dhLuxAdRatio')?.value || state.luxuryAd.outputRatio || '9:16';
    state.luxuryAd.outputSize = $('#dhLuxAdSize')?.value || state.luxuryAd.outputSize || 'standard';
    state.luxuryAd.subtitle = getLuxuryAdSubtitlePayload($('#dhLuxAdSubtitleToggle')
      ? !!$('#dhLuxAdSubtitleToggle')?.checked
      : (($('#dhLuxAdSubtitle')?.value || 'on') !== 'off'));
    const btn = triggerButton || (
      detail ? $('#dhLuxAdStoryboard') : (autoNext ? $('#dhLuxAdGenerate') : $('#dhLuxAdStoryboard'))
    );
    const old = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = detail ? '生成剧本中…' : '生成场景配置中…'; }
    state.luxuryAd.sceneGenerating = !detail;
    state.luxuryAd.scriptGenerating = !!detail;
    syncLuxuryAdStepPanels();
    updateLuxuryAdStepLocks();
    setLuxuryProgress(detail ? 'frames' : 'storyboard');
    const progressTimer = startLuxuryWorkflowProgress({ detail });
    let ok = false;
    let activeRequestKey = '';
    try {
      const lockedShotLimit = detail ? luxuryAdLockedShotLimit() : 0;
      let sourceSegments = detail ? clampLuxuryAdSegmentsToLockedAssets(state.luxuryAd.segments || []) : (state.luxuryAd.segments || []);
      if (detail && lockedShotLimit > 0 && sourceSegments.length !== (state.luxuryAd.segments || []).length) {
        state.luxuryAd.segments = sourceSegments;
        state.luxuryAd.keyframes = [];
        renderLuxuryAdStoryboard();
        toast(`已按上传的 ${lockedShotLimit} 张分镜画面锁定镜头数，不再补生成额外镜头`, 'info');
      }
      const defaultScriptShots = Math.max(4, Math.min(12, Math.round((state.luxuryAd.durationSec || 30) / 3)));
      const shotCount = detail
        ? (lockedShotLimit > 0
          ? Math.max(1, Math.min(12, lockedShotLimit))
          : Math.max(1, Math.min(12, defaultScriptShots)))
        : undefined;
      const requestKey = luxuryStoryboardRequestKey(detail);
      activeRequestKey = requestKey;
      const personAssetForGender = state.luxuryAd.personAsset || null;
      const personAssetGender = luxuryPersonConfirmedGender(personAssetForGender?.detected_gender, personAssetForGender?.gender);
      if (personAssetForGender && !['male', 'female'].includes(personAssetGender)) {
        const personImageUrl = personAssetForGender.image_url || personAssetForGender.url || personAssetForGender.previewUrl || '';
        const detectedGender = await detectLuxuryAdPersonGender(personImageUrl);
        if (detectedGender) {
          state.luxuryAd.personAsset = {
            ...personAssetForGender,
            gender: detectedGender,
            detected_gender: detectedGender,
          };
          applyLuxuryPersonAssetConstraints(state.luxuryAd.personAsset);
          renderLuxuryAdPerson();
        }
      }
      const requestBody = {
        production_project_id: state.luxuryAd.productionProjectId || state.luxuryAd.productionProject?.id || '',
        project_id: state.luxuryAd.productionProjectId || state.luxuryAd.productionProject?.id || '',
        text,
        duration_sec: state.luxuryAd.durationSec,
        shot_count: shotCount,
        product_name: state.luxuryAd.productAsset?.name || '',
        asset_summary: luxuryAdAssetSummary() || (detail ? '用户未上传参考素材，本次按广告需求直接生成商品/场景/人物视觉，不要要求用户补传图片。' : '暂未上传图片，本次只生成场景配置和素材清单'),
        ad_type: state.luxuryAd.adType || 'auto',
        output_ratio: state.luxuryAd.outputRatio || '9:16',
        expand_brief: state.luxuryAd.expandBrief !== false,
        planning_mode: detail ? 'detailed' : 'outline',
        product_asset: state.luxuryAd.productAsset || null,
        brief_reference_assets: filledLuxuryAdBriefReferences().map((asset, i) => ({
          index: i + 1,
          name: asset.name || `需求参考图 ${i + 1}`,
          role: asset.role || asset.type || '',
          url: compactLuxuryUrl(asset.url || asset.previewUrl || ''),
        })).filter(x => x.url || x.name),
        visual_reference_brief: state.luxuryAd.visualReferenceBrief || null,
        reference_assets: luxuryAdReferenceAssets().map((asset, i) => asset && (asset.url || asset.previewUrl || asset.name) ? ({
          index: i + 1,
          name: asset.name || `分镜画面 ${i + 1}`,
          url: compactLuxuryUrl(asset.url || ''),
        }) : null).filter(Boolean),
        outline_segments: detail ? compactLuxurySegments(sourceSegments) : [],
        person_spec: luxuryAdPersonSpec(),
        person_asset: luxuryAdPersonAssetPayload(),
        request_key: requestKey,
        request_async: true,
      };
      let r;
      try {
        r = await api('/api/dh/luxury-ad/storyboard', {
          method: 'POST',
          body: requestBody,
        });
        if (r.status === 'accepted') {
          updateLuxuryWorkflowProgress(detail ? '剧本生成中，正在等待后台任务返回结果。' : '场景配置生成中，正在等待后台任务返回结果。', 94);
          r = await pollLuxuryStoryboardResult(requestKey, { detail, timeoutMs: 0, missingRetryMs: 0 });
        }
      } catch (err) {
        if (!isLuxuryStoryboardLongRunningError(err)) throw err;
        updateLuxuryWorkflowProgress(detail ? '剧本生成时间较长，正在等待同一任务返回结果。' : '场景配置生成时间较长，正在等待同一任务返回结果。', 94);
        while (!r) {
          try {
            r = await pollLuxuryStoryboardResult(requestKey, { detail, timeoutMs: 0, missingRetryMs: 0 });
          } catch (pollErr) {
            if (pollErr?.code !== 'RESULT_MISSING_AFTER_DISCONNECT') throw pollErr;
            try {
              r = await api('/api/dh/luxury-ad/storyboard', {
                method: 'POST',
                body: requestBody,
              });
            } catch (retryErr) {
              if (!isLuxuryStoryboardLongRunningError(retryErr)) throw retryErr;
            }
          }
        }
      }
      if (!r.success) throw new Error(r.error || '详细分镜生成失败');
      const nextSegments = applyLuxuryShotBindings((r.segments || []).slice(0, detail && shotCount ? shotCount : 8));
      const titleOverride = state.luxuryAd.briefInfo?.title_user_edited
        ? { title: state.luxuryAd.briefInfo.title || '', title_user_edited: true }
        : {};
      const nextInfo = deriveLuxuryBriefInfo(text, nextSegments, { ...(r.brief_info || state.luxuryAd.briefInfo || {}), ...titleOverride });
      if (r.visual_reference_brief) state.luxuryAd.visualReferenceBrief = r.visual_reference_brief;
      if (r.asset_manifest) state.luxuryAd.assetManifest = r.asset_manifest;
      if (r.visual_locks) state.luxuryAd.visualLocks = r.visual_locks;
      if (r.global_visual_bible) state.luxuryAd.globalVisualBible = r.global_visual_bible;
      if (r.production_project) applyLuxuryProductionProject(r.production_project);
      else if (r.production_project_id) state.luxuryAd.productionProjectId = r.production_project_id;
      if (!detail && r.person_spec && typeof r.person_spec === 'object') {
        const prevSpec = luxuryAdPersonSpec();
        state.luxuryAd.personSpec = { ...prevSpec, ...r.person_spec };
        syncLuxuryPersonSpecControls();
        renderLuxuryAdPerson();
      }
      if (detail) validateLuxuryAdScriptSegments(nextSegments, nextInfo, { detail: true });
      state.luxuryAd.briefInfo = nextInfo;
      syncLuxuryBriefInfoToControls(state.luxuryAd.briefInfo);
      state.luxuryAd.segments = detail && lockedShotLimit > 0 ? nextSegments.slice(0, lockedShotLimit) : nextSegments;
      state.luxuryAd.storyboardDetailed = !!detail || String(r.planning_mode || '').toLowerCase() === 'detailed';
      state.luxuryAd.keyframes = [];
      state.luxuryAd.storyboardSheets = [];
      state.luxuryAd.productionContract = null;
      renderLuxuryAdStoryboard();
      saveLuxuryAdDraft({ silent: true }).catch(() => {});
      toast(detail
        ? `剧本已生成：${state.luxuryAd.segments.length} 个镜头，现在确认人物来源后再生成分镜`
        : `AI 已生成视频基础信息和广告结构，下一步确认主体后生成剧本`, 'success');
      state.luxuryAd.sceneGenerating = false;
      state.luxuryAd.scriptGenerating = false;
      showLuxuryAdStep(detail ? 3 : 2, { silent: true });
      ok = true;
    } catch (err) {
      toast((detail ? '剧情广告剧本生成失败：' : '剧情广告场景配置生成失败：') + err.message, 'error');
    } finally {
      state.luxuryAd.sceneGenerating = false;
      state.luxuryAd.scriptGenerating = false;
      if (activeRequestKey) await refreshLuxuryAdUsage(activeRequestKey);
      stopLuxuryWorkflowProgress(progressTimer);
      if (btn) { btn.disabled = false; btn.innerHTML = old || (detail ? '重新生成剧本' : (autoNext ? '2 生成场景配置' : '重新生成场景配置')); }
      syncLuxuryAdStepPanels();
      updateLuxuryAdStepLocks();
    }
    return ok;
  }

  async function autoGenerateLuxuryAdAiVisuals() {
    if (luxuryAdIsMaterialMode()) {
      buildMaterialFilmCopyPlan();
      return;
    }
    if (state.luxuryAd.keyframeGenerating) return toast('正在生成分镜，请稍等', 'error');
    const text = ($('#dhLuxAdText')?.value || state.luxuryAd.content || '').trim();
    if (!text) return toast('请先填写广告需求', 'error');
    const btn = $('#dhLuxAdAutoVisuals');
    const old = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = 'AI 生成中…'; }
    try {
      if (!state.luxuryAd.segments?.length) {
        const outlineOk = await buildLuxuryAdStoryboard({ autoNext: false, detail: false });
        if (!outlineOk) return;
      }
      if (!state.luxuryAd.storyboardDetailed) {
        const detailOk = await buildLuxuryAdStoryboard({ autoNext: false, detail: true });
        if (!detailOk) return;
      }
      await generateLuxuryAdKeyframes({ autoSubmit: false });
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = old || 'AI 自动完成到分镜'; }
    }
  }

  async function generateLuxuryAdKeyframes({ autoSubmit = false, onlyIndex = null, force = false } = {}) {
    if (luxuryAdIsMaterialMode()) {
      buildMaterialFilmCopyPlan();
      showLuxuryAdStep(5, { silent: true });
      return;
    }
    const text = ($('#dhLuxAdText')?.value || state.luxuryAd.content || '').trim();
    if (!text) return toast('请先输入广告需求', 'error');
    if (!state.luxuryAd.segments?.length) return toast('请先完成第 2 步：生成场景配置', 'error');
    if (!state.luxuryAd.storyboardDetailed) return toast('请先完成第 3 步：生成剧本，再生成分镜', 'error');
    const refs = luxuryAdRefs();
    if (state.luxuryAd.uploading) return toast('商品或分镜画面还在上传，请稍等', 'error');
    try {
      // 分镜生成会把图片 URL 发给后端，所以本地 blob 预览不能进入该步骤。
      assertLuxuryAdNoLocalOnlyPreviews('生成分镜');
    } catch (err) {
      return toast(err.message, 'error');
    }
    const lockedShotLimit = luxuryAdLockedShotLimit();
    let previewSegments = state.luxuryAd.segments || [];
    if (lockedShotLimit > 0) {
      const lockedSegments = clampLuxuryAdSegmentsToLockedAssets(previewSegments);
      if (lockedSegments.length !== previewSegments.length) {
        state.luxuryAd.segments = lockedSegments;
        state.luxuryAd.keyframes = [];
        previewSegments = lockedSegments;
        renderLuxuryAdStoryboard();
        toast(`已按上传的 ${lockedShotLimit} 张分镜画面锁定镜头数，不再补生成额外镜头`, 'info');
      }
    }
    try {
      validateLuxuryAdScriptSegments(previewSegments, state.luxuryAd.briefInfo || {}, { detail: true });
    } catch (err) {
      toast('剧本未通过一致性检查：' + err.message, 'error');
      return;
    }
    const singleIndex = Number.isInteger(onlyIndex) ? onlyIndex : null;
    if (singleIndex !== null && (singleIndex < 0 || singleIndex >= previewSegments.length)) return toast('要重新生成的镜头不存在', 'error');
    const requestSegments = singleIndex === null ? previewSegments : [previewSegments[singleIndex]];
    const totalShots = Math.max(1, requestSegments.length || 1);
    const btn = singleIndex === null ? $('#dhLuxAdPreviewFrames') : document.querySelector(`[data-lux-shot-regenerate="${singleIndex}"]`);
    const old = btn?.innerHTML;
    const reviewOnlyRequest = singleIndex === null && !force;
    const productionGate = luxuryAdProductionGate(requestSegments, { finalKeyframes: !reviewOnlyRequest });
    state.luxuryAd.productionContract = productionGate;
    if (productionGate.blocked) {
      state.luxuryAd.keyframeError = productionGate.reason;
      state.luxuryAd.keyframeErrorDetails = {
        reason: 'actor_reference_required',
        production_contract: productionGate,
        attempts: [{
          provider_id: 'preflight',
          model_id: 'actor-reference-gate',
          ok: false,
          error: productionGate.reason,
        }],
      };
      renderLuxuryAdStoryboard();
      updateLuxuryAdStepLocks();
      return toast(productionGate.reason, 'error');
    }
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = singleIndex === null
        ? (reviewOnlyRequest ? '生成审核分镜板…' : '生成真实关键帧…')
        : '生成本镜…';
    }
    const startedAt = Date.now();
    let progressTimer = null;
    state.luxuryAd.keyframeGenerating = true;
    state.luxuryAd.keyframeError = '';
    state.luxuryAd.keyframeErrorDetails = null;
    state.luxuryAd.keyframePlanningOnly = false;
    if (singleIndex === null || force) {
      state.luxuryAd.keyframes = [];
      state.luxuryAd.storyboardSheets = [];
    }
    else state.luxuryAd.keyframes = (state.luxuryAd.keyframes || []).map((item, i) => i === singleIndex ? {} : item);
    state.luxuryAd.keyframeProgress = {
      current: 0,
      total: totalShots,
      startedAt,
      message: singleIndex === null
        ? (reviewOnlyRequest
          ? `正在生成审核分镜板：0/${totalShots}，已用 0 秒。`
          : `正在生成真实关键帧：0/${totalShots}，已用 0 秒。`)
        : `正在重新生成第 ${singleIndex + 1} 镜，已用 0 秒。`,
    };
    updateLuxuryKeyframeWorkflowProgress(state.luxuryAd.keyframeProgress);
    setLuxuryProgress('keyframes');
    showLuxuryAdStep(4, { silent: true });
    renderLuxuryAdStoryboard();
    let activeRequestKey = '';
    let keepWorkflowProgress = false;
    progressTimer = setInterval(() => {
      const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      const total = totalShots;
      const estimated = Math.min(Math.max(1, total - 1), Math.floor(elapsed / 35));
      state.luxuryAd.keyframeProgress = {
        current: estimated,
        total,
        startedAt,
        message: singleIndex === null
          ? (reviewOnlyRequest
            ? `正在生成审核分镜板：约 ${estimated}/${total}，已用 ${elapsed} 秒。系统只整理镜头表、画面、动作和分镜板，不调用最终关键帧模型。`
            : `正在生成真实关键帧：约 ${estimated}/${total}，已用 ${elapsed} 秒。系统会按同一真人演员、剧情动作和写实摄影要求逐镜生成，通常需要 1-3 分钟。`)
          : `正在重新生成第 ${singleIndex + 1} 镜，已用 ${elapsed} 秒。`,
      };
      updateLuxuryKeyframeWorkflowProgress(state.luxuryAd.keyframeProgress);
      renderLuxuryAdStoryboard();
    }, 1000);
    try {
      const requestKey = luxuryKeyframeRequestKey(singleIndex);
      activeRequestKey = requestKey;
      if (!state.luxuryAd.productionProjectId && singleIndex === null) {
        await saveLuxuryAdDraft({ silent: true, projectState: 'frame_reviewing' }).catch(() => null);
      }
      const requestBody = {
        avatar_id: state.selectedAvatar?.id || '',
        background_url: compactLuxuryUrl(refs[0] || ''),
        reference_images: refs.slice(1).map(compactLuxuryUrl).filter(Boolean),
        text,
        product_name: state.luxuryAd.productAsset?.name || '',
        product_asset: state.luxuryAd.productAsset?.url
          ? { name: state.luxuryAd.productAsset.name || '', url: compactLuxuryUrl(state.luxuryAd.productAsset.url) }
          : null,
        brief_reference_assets: filledLuxuryAdBriefReferences().map((asset, i) => ({
          index: i + 1,
          name: asset.name || `需求参考图 ${i + 1}`,
          role: asset.role || asset.type || '',
          url: compactLuxuryUrl(asset.url || asset.previewUrl || ''),
        })).filter(x => x.url || x.name),
        visual_reference_brief: state.luxuryAd.visualReferenceBrief || null,
        global_visual_bible: state.luxuryAd.globalVisualBible || null,
        production_contract: state.luxuryAd.productionContract || null,
        production_project_id: state.luxuryAd.productionProjectId || '',
        brief_info: state.luxuryAd.briefInfo || null,
        person_asset: luxuryAdPersonAssetPayload(),
        person_spec: luxuryAdPersonSpec(),
        reference_assets: luxuryAdReferenceAssets()
          .filter(luxuryAdAssetFilled)
          .map((asset, i) => ({ index: i + 1, name: asset.name || `分镜画面${i + 1}`, url: compactLuxuryUrl(asset.url || asset.previewUrl || '') }))
          .filter(x => x.url || x.name),
        asset_summary: luxuryAdAssetSummary(),
        scene_prompt: text,
        duration_sec: state.luxuryAd.durationSec,
        segments: compactLuxurySegments(requestSegments),
        ad_mode: 'luxury_ad',
        ad_style: 'luxury_soft',
        shot_count: singleIndex === null ? totalShots : previewSegments.length,
        auto_enhance: state.luxuryAd.autoEnhance !== false,
        expand_brief: state.luxuryAd.expandBrief !== false,
        request_key: requestKey,
        request_async: true,
        storyboard_review_only: singleIndex === null && !force,
        storyboard_final_keyframes: !!force || singleIndex !== null,
        ...outputPayload(state.luxuryAd.outputRatio, state.luxuryAd.outputSize),
      };
      let r;
      try {
        r = await api('/api/dh/spaces/keyframes', {
          method: 'POST',
          body: requestBody,
        });
        if (r?.status === 'accepted' && r?.request_key) {
          r = await pollLuxuryKeyframeResult(requestKey, { timeoutMs: 0, totalShots });
        }
      } catch (err) {
        if (!isLuxuryStoryboardLongRunningError(err)) throw err;
        state.luxuryAd.keyframeProgress = {
          current: Math.max(0, Number(state.luxuryAd.keyframeProgress?.current || 0)),
          total: totalShots,
          startedAt,
          message: '分镜生成时间较长，正在等待同一任务返回结果。',
        };
        updateLuxuryKeyframeWorkflowProgress(state.luxuryAd.keyframeProgress);
        r = await pollLuxuryKeyframeResult(requestKey, { timeoutMs: 0, totalShots });
      }
      if (!r.success) throw new Error(r.error || '分镜生成失败');
      const nextKeyframes = luxurySelectItemsForShotRequest(r.keyframes || [], singleIndex, totalShots);
      const nextStoryboardSheets = Array.isArray(r.storyboard_sheets) ? r.storyboard_sheets : [];
      const returnedScenes = luxurySelectItemsForShotRequest(r.scenes || [], singleIndex, totalShots);
      const planningSheetMode = r.storyboard_mode === 'planning_sheet'
        || r.reference_mode === 'storyboard_planning_sheet'
        || r.keyframe_generation_status === 'failed'
        || (!nextKeyframes.length && returnedScenes.length === totalShots && (nextStoryboardSheets.length || r.keyframe_error || r.details));
      const deferredPlanning = planningSheetMode && r.keyframe_generation_status === 'deferred_for_review';
      if (r.production_project) applyLuxuryProductionProject(r.production_project);
      else if (r.production_project_id) state.luxuryAd.productionProjectId = r.production_project_id;
      if (r.asset_manifest) state.luxuryAd.assetManifest = r.asset_manifest;
      if (r.visual_locks) state.luxuryAd.visualLocks = r.visual_locks;
      if (r.global_visual_bible) state.luxuryAd.globalVisualBible = r.global_visual_bible;
      if (r.production_contract) state.luxuryAd.productionContract = r.production_contract;
      if (planningSheetMode) {
        validateLuxuryAdStoryboardPlan(returnedScenes.length ? returnedScenes : requestSegments, requestSegments);
      } else {
        validateLuxuryAdKeyframes(nextKeyframes, requestSegments);
      }
      if (singleIndex === null) {
        const existingFrames = Array.isArray(state.luxuryAd.keyframes) ? state.luxuryAd.keyframes : [];
        const existingSheets = Array.isArray(state.luxuryAd.storyboardSheets) ? state.luxuryAd.storyboardSheets : [];
        if (returnedScenes.length) state.luxuryAd.segments = applyLuxuryShotBindings(returnedScenes);
        state.luxuryAd.keyframes = planningSheetMode
          ? mergeLuxuryKeyframesPreservingImages(existingFrames, nextKeyframes, previewSegments.length || totalShots)
          : nextKeyframes;
        state.luxuryAd.storyboardSheets = nextStoryboardSheets.length ? nextStoryboardSheets : existingSheets;
        state.luxuryAd.keyframePlanningOnly = planningSheetMode;
      } else {
        const existingFrames = Array.isArray(state.luxuryAd.keyframes) ? state.luxuryAd.keyframes : [];
        const merged = Array.from({ length: previewSegments.length }, (_, i) => existingFrames[i] || {});
        merged[singleIndex] = nextKeyframes[0];
        state.luxuryAd.keyframes = merged;
        if (returnedScenes[0]) {
          const mergedSegments = Array.from({ length: previewSegments.length }, (_, i) => previewSegments[i] || {});
          mergedSegments[singleIndex] = returnedScenes[0];
          state.luxuryAd.segments = applyLuxuryShotBindings(mergedSegments);
        }
      }
      if (!planningSheetMode) state.luxuryAd.keyframePlanningOnly = false;
      state.luxuryAd.keyframeProgress = {
        current: planningSheetMode ? totalShots : (singleIndex === null ? state.luxuryAd.keyframes.length : totalShots),
        total: singleIndex === null ? (previewSegments.length || state.luxuryAd.keyframes.length || totalShots) : totalShots,
        startedAt,
        message: planningSheetMode
          ? (deferredPlanning
            ? `镜头表已生成：${totalShots}/${totalShots}。请先审核剧情、演员和写实风格，再生成真实关键帧。`
            : `镜头表已生成：${totalShots}/${totalShots}。关键帧生成未通过 QA，可先审核镜头表并重新生成关键帧。`)
          : singleIndex === null
          ? `分镜已完成：${state.luxuryAd.keyframes.length}/${previewSegments.length || state.luxuryAd.keyframes.length}（静态分镜；合成广告时才逐镜生成动态视频）。`
          : `第 ${singleIndex + 1} 镜已重新生成。`,
      };
      state.luxuryAd.workflowProgress = {
        active: true,
        done: true,
        detail: true,
        keyframes: true,
        startedAt,
        elapsedSec: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
        percent: 100,
        label: planningSheetMode ? '镜头表已生成' : '分镜生成完成',
        phase: planningSheetMode ? (deferredPlanning ? '待生成真实关键帧' : '关键帧待重新生成') : '已完成剧本一致性检查',
        message: state.luxuryAd.keyframeProgress.message,
      };
      keepWorkflowProgress = planningSheetMode;
      state.luxuryAd.keyframeGenerating = false;
      state.luxuryAd.keyframeError = planningSheetMode ? (deferredPlanning ? '' : (r.keyframe_error || '关键帧生成未通过 QA，已先生成可审核分镜板')) : '';
      state.luxuryAd.keyframeErrorDetails = planningSheetMode ? (deferredPlanning ? null : (r.details || null)) : null;
      renderLuxuryAdStoryboard();
      saveLuxuryAdDraft({ silent: true, projectState: planningSheetMode ? 'frame_reviewing' : 'frame_ready' }).catch(() => {});
      const lockedCount = state.luxuryAd.keyframes.filter(k => String(k.reference_mode || '').includes('reference_locked')).length;
      toast(singleIndex !== null
        ? `第 ${singleIndex + 1} 镜已重新生成`
        : planningSheetMode
          ? (deferredPlanning ? '已生成可审核镜头表，确认后再生成真实关键帧' : '已先生成可审核镜头表，关键帧可重新生成')
        : (lockedCount
          ? `已锁定 ${lockedCount} 个参考镜头作为分镜，请点击“合成广告”；提交后会显示逐镜图生视频进度`
          : `已生成 ${state.luxuryAd.keyframes.length} 个分镜`), 'success');
      if (autoSubmit && !planningSheetMode) await submitLuxuryAd();
    } catch (err) {
      state.luxuryAd.keyframeGenerating = false;
      state.luxuryAd.keyframeProgress = null;
      const failedPayload = err?.data && typeof err.data === 'object' ? err.data : null;
      const partialKeyframes = luxurySelectItemsForShotRequest(failedPayload?.keyframes || [], singleIndex, totalShots);
      const partialScenes = luxurySelectItemsForShotRequest(failedPayload?.scenes || [], singleIndex, totalShots);
      const partialSheets = Array.isArray(failedPayload?.storyboard_sheets) ? failedPayload.storyboard_sheets : [];
      if (partialScenes.length) state.luxuryAd.segments = applyLuxuryShotBindings(partialScenes);
      if (partialKeyframes.length) {
        state.luxuryAd.keyframes = mergeLuxuryKeyframesPreservingImages(
          state.luxuryAd.keyframes || [],
          partialKeyframes,
          previewSegments.length || state.luxuryAd.segments?.length || totalShots,
        );
      }
      if (partialSheets.length) state.luxuryAd.storyboardSheets = partialSheets;
      if (failedPayload?.production_project) applyLuxuryProductionProject(failedPayload.production_project);
      else if (failedPayload?.production_project_id) state.luxuryAd.productionProjectId = failedPayload.production_project_id;
      state.luxuryAd.keyframeError = luxuryKeyframeErrorMessage(err);
      state.luxuryAd.keyframeErrorDetails = {
        endpoint: '/api/dh/spaces/keyframes',
        status: err?.status || err?.data?.status || 0,
        code: err?.data?.code || err?.code || '',
        message: err?.data?.message || err?.data?.error || err.message || '',
        ...(err?.data?.details || {}),
        raw: err?.data || null,
      };
      if (err?.data?.details?.production_project) applyLuxuryProductionProject(err.data.details.production_project);
      else if (err?.data?.details?.production_project_id) state.luxuryAd.productionProjectId = err.data.details.production_project_id;
      if (err?.data?.details?.production_contract) state.luxuryAd.productionContract = err.data.details.production_contract;
      renderLuxuryAdStoryboard();
      saveLuxuryAdDraft({ silent: true, projectState: 'frame_failed' }).catch(() => {});
      toast('剧情广告分镜生成失败：' + state.luxuryAd.keyframeError, 'error');
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      state.luxuryAd.keyframeGenerating = false;
      if (!keepWorkflowProgress) state.luxuryAd.workflowProgress = null;
      if (activeRequestKey) await refreshLuxuryAdUsage(activeRequestKey);
      renderLuxuryWorkflowProgress();
      updateLuxuryAdStepLocks();
      if (btn) { btn.disabled = false; btn.innerHTML = old || (singleIndex === null ? '4 生成分镜' : '重新生成本镜'); }
    }
  }

  function luxuryMissingKeyframeIndexes() {
    const segments = Array.isArray(state.luxuryAd.segments) ? state.luxuryAd.segments : [];
    const keyframes = Array.isArray(state.luxuryAd.keyframes) ? state.luxuryAd.keyframes : [];
    return segments
      .map((_, i) => i)
      .filter(i => !luxuryFrameHasImage(keyframes[i]));
  }

  async function fillMissingLuxuryAdKeyframes() {
    const missing = luxuryMissingKeyframeIndexes();
    if (!missing.length) return toast('当前没有缺失的分镜图', 'info');
    for (const idx of missing) {
      if (luxuryFrameHasImage((state.luxuryAd.keyframes || [])[idx])) continue;
      await generateLuxuryAdKeyframes({ autoSubmit: false, onlyIndex: idx });
      if (!luxuryFrameHasImage((state.luxuryAd.keyframes || [])[idx])) break;
    }
  }

  async function submitLuxuryAd() {
    if (luxuryAdIsMaterialMode()) return submitMaterialFilmAd();
    const text = ($('#dhLuxAdText')?.value || state.luxuryAd.content || '').trim();
    if (!text) return toast('请先输入广告需求', 'error');
    const refs = luxuryAdRefs();
    const lockedShotLimit = luxuryAdLockedShotLimit();
    if (lockedShotLimit > 0) {
      state.luxuryAd.segments = clampLuxuryAdSegmentsToLockedAssets(state.luxuryAd.segments || []);
      state.luxuryAd.keyframes = (state.luxuryAd.keyframes || []).slice(0, state.luxuryAd.segments.length);
    }
    if (state.luxuryAd.keyframePlanningOnly) return toast('当前只有可审核分镜板，关键帧还未通过 QA。请先重新生成关键帧，再合成广告', 'error');
    if (!state.luxuryAd.keyframes?.some(k => k?.image_url)) return toast('请先点击“4 生成分镜”，确认每段画面后再合成广告', 'error');
    try {
      validateLuxuryAdKeyframes(state.luxuryAd.keyframes || [], state.luxuryAd.segments || []);
    } catch (err) {
      return toast('成片前检查未通过：' + err.message, 'error');
    }
    try {
      // 合成广告前再次检查，防止中途删除/失败的素材混入最终提交。
      assertLuxuryAdNoLocalOnlyPreviews('合成广告');
    } catch (err) {
      return toast(err.message, 'error');
    }
    const primaryFrame = state.luxuryAd.keyframes?.find(k => k?.image_url || k?.imageUrl)?.image_url || state.luxuryAd.keyframes?.find(k => k?.image_url || k?.imageUrl)?.imageUrl || '';
    const voiceId = state.luxuryAd.voiceId || '';
    if (!voiceId) return toast('请先手动选择配音音色；剧情广告不会自动选声音', 'error');
    const btn = $('#dhLuxAdConfirmGenerate');
    const old = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '提交合成中…'; }
    setLuxuryProgress('video');
    try {
      const title = '剧情广告';
      const productAsset = state.luxuryAd.productAsset || {};
      const referenceAssets = luxuryAdReferenceAssets();
      const selectedVoice = (state.voices || []).find(v => String(v.id || '') === String(voiceId)) || {};
      const subtitlePayload = getLuxuryAdSubtitlePayload();
      const payload = {
        avatar_id: state.selectedAvatar?.id || '',
        background_url: compactLuxuryUrl(refs[0] || primaryFrame),
        reference_images: refs.slice(1).map(compactLuxuryUrl).filter(Boolean),
        production_project_id: state.luxuryAd.productionProjectId || state.luxuryAd.productionProject?.id || '',
        project_id: state.luxuryAd.productionProjectId || state.luxuryAd.productionProject?.id || '',
        text,
        title,
        product_name: productAsset.name || '',
        product_asset: productAsset?.url ? { name: productAsset.name || '', url: compactLuxuryUrl(productAsset.url) } : null,
        brief_reference_assets: filledLuxuryAdBriefReferences().map((asset, i) => ({
          index: i + 1,
          name: asset.name || `需求参考图 ${i + 1}`,
          role: asset.role || asset.type || '',
          url: compactLuxuryUrl(asset.url || asset.previewUrl || ''),
        })).filter(x => x.url || x.name),
        visual_reference_brief: state.luxuryAd.visualReferenceBrief || null,
        global_visual_bible: state.luxuryAd.globalVisualBible || null,
        person_asset: luxuryAdPersonAssetPayload(),
        brief_info: state.luxuryAd.briefInfo || deriveLuxuryBriefInfo(text, state.luxuryAd.segments || {}),
        reference_assets: referenceAssets
          .filter(luxuryAdAssetFilled)
          .map((asset, i) => ({ index: i + 1, name: asset.name || `分镜画面${i + 1}`, url: compactLuxuryUrl(asset.url || asset.previewUrl || '') }))
          .filter(x => x.url || x.name),
        asset_summary: luxuryAdAssetSummary(),
        voice_id: voiceId,
        voice_direction: state.luxuryAd.voiceDirection || 'story_dynamic',
        duration_sec: state.luxuryAd.durationSec,
        subtitle: subtitlePayload,
        bgm_asset: luxuryAdBgmAssetPayload(),
        scene_prompt: text,
          camera_prompt: '剧情广告：按分镜顺序生成镜头，镜头语言高级克制，保留产品故事与品牌质感。',
        ad_mode: 'luxury_ad',
        ad_style: 'luxury_soft',
        shot_count: state.luxuryAd.segments.length || 4,
        auto_enhance: state.luxuryAd.autoEnhance !== false,
        expand_brief: state.luxuryAd.expandBrief !== false,
        keyframes: compactLuxuryKeyframes(state.luxuryAd.keyframes || [], state.luxuryAd.segments || []),
        segments: compactLuxurySegments(state.luxuryAd.segments || []),
        speech_segments: compactLuxurySegments(state.luxuryAd.segments || []),
        generation_mode: 'luxury_storyboard',
        ...outputPayload(state.luxuryAd.outputRatio, state.luxuryAd.outputSize),
      };
      const r = await api('/api/dh/spaces/generate', {
        method: 'POST',
        body: payload,
      });
      if (!r.success) throw new Error(r.error || '提交失败');
      state.luxuryAd.taskId = r.taskId || r.task_id || '';
      state.luxuryAd.taskUrl = r.videoUrl || r.video_url || '';
      if (state.luxuryAd.taskId) {
        syncRunningTask(state.luxuryAd.taskId, {
          taskId: state.luxuryAd.taskId,
          avatarName: title,
          startedAt: Date.now(),
          status: 'submitted',
          stage: 'submitted',
          snapshot: null,
          previewUrl: state.luxuryAd.keyframes?.[0]?.image_url || refs[0] || primaryFrame,
          textPreview: `${state.luxuryAd.durationSec}s · ${state.luxuryAd.segments.length || 4} 镜头 · ${text.slice(0, 50)}`,
          taskType: 'luxury_ad',
          production_project_id: state.luxuryAd.productionProjectId || state.luxuryAd.productionProject?.id || '',
          projectId: state.luxuryAd.productionProjectId || state.luxuryAd.productionProject?.id || '',
          retryPayload: payload,
          createDetail: {
            title,
            productionProjectId: state.luxuryAd.productionProjectId || state.luxuryAd.productionProject?.id || '',
            durationSec: state.luxuryAd.durationSec,
            text,
            backgroundUrl: refs[0],
            avatarName: state.selectedAvatar?.name || '',
            avatarId: state.selectedAvatar?.id || '',
            voiceId,
            voiceName: selectedVoice.name || selectedVoice.label || voiceId,
            adMode: '剧情广告',
            outputRatio: state.luxuryAd.outputRatio,
            outputSize: state.luxuryAd.outputSize,
            resolution: outputPixels(state.luxuryAd.outputRatio, state.luxuryAd.outputSize),
            productName: productAsset.name || '',
            briefInfo: state.luxuryAd.briefInfo || deriveLuxuryBriefInfo(text, state.luxuryAd.segments || {}),
            personName: luxuryAdPersonAssetPayload()?.name || '',
            personAsset: luxuryAdPersonAssetPayload(),
            scenePrompt: text,
            cameraPrompt: '按已确认剧本和分镜逐镜生成视频，保持人物/产品/场景一致。',
            segments: state.luxuryAd.segments || [],
            scenes: state.luxuryAd.segments || [],
            keyframes: state.luxuryAd.keyframes || [],
            subtitle: subtitlePayload,
            bgmAsset: luxuryAdBgmAssetPayload(),
            shotCount: state.luxuryAd.segments.length || state.luxuryAd.keyframes.length || 4,
            composeNote: `${selectedVoice.name || voiceId} · ${subtitlePayload?.show === false ? '字幕关闭' : '自动字幕开启'} · ${luxuryAdHasBgm() ? 'BGM 已配置' : '无 BGM'} · 提交后在任务中心查看逐镜视频`,
            workflow: '广告需求 → 场景配置 → 剧本生成 → 分镜生成 → 广告合成（配音 / 字幕 / 视频）',
            submittedAt: new Date().toISOString(),
          },
        });
        pollVideoTask(state.luxuryAd.taskId);
      }
      state.activeTaskType = 'luxury_ad';
        toast('剧情广告任务已提交，任务中心会显示剧本、分镜、配音、字幕和逐镜视频生成进度', 'success');
      renderTaskCenter();
      switchTab('tasks');
    } catch (err) {
      toast('剧情广告生成失败：' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = old || '合成广告'; }
    }
  }

  async function submitMaterialFilmAd() {
    const text = ($('#dhLuxAdText')?.value || state.luxuryAd.content || '').trim();
    if (!text) return toast('请先输入广告需求', 'error');
    const materialUrls = luxuryMaterialAssetUrls();
    if (!materialUrls.length) return toast('请先上传至少一张产品/场景/界面素材', 'error');
    const voiceId = state.luxuryAd.voiceId || '';
    if (!voiceId) return toast('请先手动选择配音音色', 'error');
    const btn = $('#dhLuxAdConfirmGenerate');
    const old = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '提交素材成片中…'; }
    setLuxuryProgress('video');
    try {
      const title = state.luxuryAd.briefInfo?.title || '素材成片';
      const selectedVoice = (state.voices || []).find(v => String(v.id || '') === String(voiceId)) || {};
      const subtitlePayload = getLuxuryAdSubtitlePayload();
      const payload = {
        text,
        title,
        voice_id: voiceId,
        voice_direction: state.luxuryAd.voiceDirection || 'story_dynamic',
        duration_sec: state.luxuryAd.durationSec || 30,
        material_assets: materialUrls,
        reference_images: materialUrls.slice(1),
        background_url: materialUrls[0],
        person_asset: luxuryAdPersonAssetPayload(),
        subtitle: subtitlePayload,
        bgm_asset: luxuryAdBgmAssetPayload(),
        generation_mode: 'material_film',
        ad_mode: 'material_film',
        ...outputPayload(state.luxuryAd.outputRatio, state.luxuryAd.outputSize),
      };
      const r = await api('/api/dh/material-film/generate', {
        method: 'POST',
        body: payload,
      });
      if (!r.success) throw new Error(r.error || '提交失败');
      state.luxuryAd.taskId = r.taskId || r.task_id || '';
      if (state.luxuryAd.taskId) {
        syncRunningTask(state.luxuryAd.taskId, {
          taskId: state.luxuryAd.taskId,
          avatarName: title,
          startedAt: Date.now(),
          status: 'submitted',
          stage: 'submitted',
          previewUrl: materialUrls[0],
          textPreview: `${state.luxuryAd.durationSec || 30}s · ${materialUrls.length} 素材 · ${text.slice(0, 50)}`,
          taskType: 'material_film',
          retryPayload: payload,
          createDetail: {
            title,
            durationSec: state.luxuryAd.durationSec || 30,
            text,
            voiceId,
            voiceName: selectedVoice.name || selectedVoice.label || voiceId,
            adMode: '素材成片',
            outputRatio: state.luxuryAd.outputRatio,
            outputSize: state.luxuryAd.outputSize,
            materialAssets: materialUrls,
            personAsset: luxuryAdPersonAssetPayload(),
            subtitle: subtitlePayload,
            bgmAsset: luxuryAdBgmAssetPayload(),
            workflow: '广告需求 → 素材/演员 → 广告词 → 本地剪辑合成 → 配音/字幕/BGM',
            submittedAt: new Date().toISOString(),
          },
        });
        pollVideoTask(state.luxuryAd.taskId);
      }
      state.activeTaskType = 'material_film';
      toast('素材成片任务已提交，任务中心会显示合成进度', 'success');
      renderTaskCenter();
      switchTab('tasks');
    } catch (err) {
      toast('素材成片提交失败：' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = old || '合成素材成片'; }
    }
  }

  function buildMaterialFilmCopyPlan() {
    const text = ($('#dhLuxAdText')?.value || state.luxuryAd.content || '').trim();
    if (!text) return toast('请先输入广告需求', 'error');
    const assets = luxuryMaterialAssetUrls();
    const duration = Number(state.luxuryAd.durationSec || 30);
    const title = normalizeLuxuryBriefTitle(text) || '素材成片';
    const beats = [
      ['开场钩子', `先点明用户痛点：${text.slice(0, 52)}`],
      ['核心卖点', '展示上传素材里的产品、界面、门店或场景证据，说明最关键优势。'],
      ['信任证明', '用素材画面承接功能、品质、案例或服务能力，避免空泛口号。'],
      ['行动收束', '用一句明确行动号召收尾，引导咨询、体验、比稿或下单。'],
    ];
    state.luxuryAd.briefInfo = deriveLuxuryBriefInfo(text, [], {
      title,
      theme: '素材成片',
      style: '真实素材剪辑 + 演员口播',
      duration_sec: duration,
      aspect_ratio: state.luxuryAd.outputRatio || '9:16',
      style_tags: ['素材剪辑', '真人口播', '商业广告', '快速成片'],
    });
    state.luxuryAd.segments = beats.map(([titleText, visual], i) => {
      const start = Math.round((duration / beats.length) * i);
      const end = Math.round((duration / beats.length) * (i + 1));
      return {
        index: i + 1,
        start,
        end,
        duration: Math.max(2, end - start),
        title: titleText,
        visual,
        action: i === 0 ? '演员开场介绍，素材快速切入。' : '素材画面按卖点节奏切换，演员口播承接。',
        dialogue: visual,
        voiceover: visual,
        camera: '素材轻推拉，字幕跟随口播节奏。',
        purpose: titleText,
      };
    });
    state.luxuryAd.storyboardDetailed = true;
    state.luxuryAd.keyframes = [];
    syncLuxuryBriefInfoToControls(state.luxuryAd.briefInfo);
    renderLuxuryAdStoryboard();
    updateLuxuryAdStepLocks();
    showLuxuryAdStep(5, { silent: true });
    toast(assets.length ? `素材成片广告词方案已生成，已识别 ${assets.length} 个素材` : '广告词方案已生成，请继续上传素材', 'success');
  }

  function ensurePreviewAudio() {
    let audio = $('#dhPreviewAudio');
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'dhPreviewAudio';
      audio.preload = 'auto';
      audio.controls = true;
      audio.style.cssText = 'position:fixed;left:-9999px;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.appendChild(audio);
    }
    return audio;
  }

  function spaceSceneName(scene) {
    return ({
      auto: 'AI 自动识别',
      gallery_wall: '展厅艺术墙',
      showroom: '品牌展厅',
      retail_store: '门店导购',
      model_room: '样板间讲解',
      museum_gallery: '博物馆展陈',
      exhibition_booth: '展会展位',
      hotel_lobby: '酒店大堂',
      office_showroom: '企业展厅',
      real_estate: '房产空间',
      auto_showroom: '汽车展厅',
      custom: '自定义场景',
    })[scene] || '素材审片';
  }

  function spaceCameraName(camera) {
    return ({
      auto: 'AI 自动处理',
      push_in: '缓慢推近',
      static: '稳定定机位',
      handheld: '轻微手持感',
      pan_right: '向右平移',
      walkthrough: '导览穿行',
      orbit: '轻微环绕',
      wide_to_detail: '全景到细节',
      rack_focus: '移焦强调',
      custom: '自定义镜头',
    })[camera] || 'AI 自动处理镜头';
  }

  function luxuryStyleName(style) {
    return ({
      luxury_soft: '奢侈品柔光',
      millennial_film: '千禧胶片',
      dark_fantasy: '暗黑奇幻',
      epic_cg: '史诗 CG',
      lifestyle: '生活方式广告',
      tech_product: '科技产品片',
    })[style] || '奢侈品柔光';
  }

  function luxuryStylePrompt(style) {
    return ({
      luxury_soft: 'luxury commercial, soft studio lighting, premium materials, elegant slow camera movement, refined reflections',
      millennial_film: 'millennial film commercial, nostalgic grain, warm flash photography, fashion editorial framing, stylish lifestyle mood',
      dark_fantasy: 'dark fantasy commercial, dramatic contrast, mysterious atmosphere, sculptural product lighting, cinematic shadows',
      epic_cg: 'epic CG advertising film, grand cinematic scale, volumetric light, precise product hero shot, high-end VFX mood',
      lifestyle: 'premium lifestyle advertisement, natural real-life scene, aspirational but authentic, clean product storytelling',
      tech_product: 'high-end technology product film, clean futuristic light, macro details, glossy surfaces, precise motion design',
    })[style] || 'luxury commercial, soft studio lighting, premium materials, elegant slow camera movement';
  }

  function luxuryShotRoleName(role) {
    return ({
      hook: '开场分镜',
      atmosphere: '氛围分镜',
      macro: '细节分镜',
      display: '第二场景',
      benefit: '场景转折',
      proof: '卖点分镜',
      cta: '收尾分镜',
      endcard: '片尾分镜',
    })[String(role || '').toLowerCase()] || '剧情镜头';
  }

  function luxuryNormalizeSceneStage(value = '', role = '', index = 0, total = 5) {
    const raw = String(value || '').replace(/\s+/g, '').trim();
    if (!raw) return luxuryShotRoleName(role) || `第${index + 1}场景`;
    if (/钩子|亮相|卖点讲解|卖点强化|品牌收束|行动引导|场景亮点|广告阶段|产品展示/.test(raw)) {
      if (index === 0) return '开场分镜';
      if (index >= total - 1) return '收尾分镜';
      return luxuryShotRoleName(role) || `第${index + 1}场景`;
    }
    if (raw === '第二分镜') return '第二场景';
    if (/^第\d+镜头$/.test(raw)) return luxuryShotRoleName(role) || `第${index + 1}场景`;
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 16);
  }

  function compactLuxuryMetaLine(seg = {}) {
    const photo = seg.photography || seg.reverse_cinematography || {};
    const camera = seg.camera_plan || seg.camera_movement || {};
    return [
      photo.framing || photo.composition || '',
      photo.lens || '',
      camera.movement || camera.motion || '',
      camera.focus || '',
    ].map(x => displayChineseText(x) || displayMotionLabel(x)).filter(Boolean).slice(0, 4).join(' · ');
  }

  function renderLuxuryShotDetails(seg = {}) {
    if (!seg || (seg.workflow_type !== 'luxury_ad_storyboard' && !seg.image2_brief && !seg.i2v_brief && !seg.asset_prep)) return '';
    const role = luxuryShotRoleName(seg.shot_role || seg.role);
    const photoLine = compactLuxuryMetaLine(seg);
    const prep = displayChineseText(seg.asset_prep, seg.product_lock, seg.material_hint);
    const i2v = displayChineseText(seg.camera_label, seg.transition, seg.motion) || displayMotionLabel(seg.camera || seg.motion || '');
    return `<div class="dh-luxury-shot-details">
      <span>参考镜头：${escapeHtml(role)}${photoLine ? ` · ${escapeHtml(photoLine)}` : ''}</span>
      ${prep ? `<span>素材处理：${escapeHtml(String(prep).slice(0, 120))}</span>` : ''}
      ${i2v ? `<span>运动方式：${escapeHtml(String(i2v).slice(0, 140))}</span>` : ''}
    </div>`;
  }

  function luxuryProviderQueueLabel() {
    return '供应商队列：保参考 Image2 关键帧 → Seedance2 / Topview I2V / 可灵 / 海螺图生视频';
  }

  const SPACE_STANDARD_SAMPLE_TEXT = '大家现在看到的是这面定制展示墙。它的纹理层次非常丰富，在顶部射灯的照射下，会呈现出自然的金属光泽和空间纵深。我们把人物讲解区放在左侧，右侧完整保留展示面，这样观众既能看到讲解员，也能清楚看到空间亮点。';
  const SPACE_LUXURY_SAMPLE_TEXT = '用一支剧情广告呈现这面艺术墙的品牌质感。开场先建立完整空间氛围，再推进到材质纹理和光影细节，中段让人物与场景自然互动，突出定制工艺和高级质感，最后收束到品牌记忆点和咨询引导。';

  function syncSpaceModeCopyLabels() {
    const isLuxury = state.space.adMode === 'luxury';
    const titleInput = $('#dhSpaceTitle');
    const textInput = $('#dhSpaceText');
    const sceneInput = $('#dhSpaceScenePrompt');
    const copyLabel = $('#dhSpaceCopyLabel');
    const visualLabel = $('#dhSpaceVisualLabel');
    const visualHint = $('#dhSpaceVisualHint');
    const sampleBtn = $('#dhSpaceSampleText');
    if (copyLabel) copyLabel.textContent = isLuxury ? '剧情广告脚本' : '广告文案';
    if (visualLabel) visualLabel.textContent = isLuxury ? '高定摄影 / 分镜提示词' : '画面提示词';
    if (visualHint) visualHint.textContent = isLuxury
      ? '剧情广告会拆成多镜头分镜，并为每镜头生成摄影解构、关键帧和图生视频提示。'
      : '普通广告使用展墙讲解画面；剧情广告使用多分镜。';
    if (sampleBtn) sampleBtn.textContent = isLuxury ? '填入高定示例' : '填入示例文案';
    if (titleInput) {
      const current = String(titleInput.value || '').trim();
      if (isLuxury && (!current || current === '素材审片' || current === '广告数字人')) titleInput.value = '剧情广告';
      if (!isLuxury && current === '剧情广告') titleInput.value = '素材审片';
      titleInput.placeholder = isLuxury ? '例如：高端艺术墙剧情广告' : '例如：高端艺术墙新品广告';
    }
    if (textInput) {
      const current = String(textInput.value || '').trim();
      if (isLuxury && current === SPACE_STANDARD_SAMPLE_TEXT) textInput.value = SPACE_LUXURY_SAMPLE_TEXT;
      if (!isLuxury && current === SPACE_LUXURY_SAMPLE_TEXT) textInput.value = SPACE_STANDARD_SAMPLE_TEXT;
      textInput.placeholder = isLuxury
        ? '写剧情广告脚本，例如：开场建立品牌空间，第二镜做材质特写，中段展示人物与场景互动，最后收束到品牌记忆点。'
        : '写数字人要说的话，例如：大家现在看到的是这面定制艺术墙，它的纹理层次非常丰富，在灯光下会呈现自然金属光泽。';
    }
    if (sceneInput) {
      sceneInput.placeholder = isLuxury
        ? '剧情广告分镜：逆向摄影解构、焦段/景别/灯光、产品与人物位置、镜头运动和片尾留白。'
        : '展厅导览式口播广告：人物位于画面左侧三分之一自然讲解，右侧保留完整展示墙/产品空间，暖色展示灯突出材质纹理，稳定机位配合极慢推近。';
    }
  }

  function getDhSubtitlePayload(show = true) {
    return {
      ...(state.s3.subtitle || {}),
      show,
      fontName: state.s3.subtitle?.fontName || '抖音美好体',
      fontSize: Number(state.s3.subtitle?.fontSize) || 72,
      color: state.s3.subtitle?.color || '#FFFFFF',
      outlineColor: state.s3.subtitle?.outlineColor || '#000000',
    };
  }
  function getPdhSubtitlePayload() {
    const on = $('#pdhSubtitleOn');
    return getDhSubtitlePayload(on?.checked !== false);
  }

  function buildSpacePromptFromText(text, extra = '') {
    const src = String(text || '').trim();
    const hint = String(extra || '').trim();
    const compact = src.replace(/\s+/g, '').slice(0, 180);
    const isLuxury = state.space.adMode === 'luxury';
    const styleName = luxuryStyleName(state.space.adStyle);
    const hasCta = /(预约|下单|咨询|购买|领取|扫码|联系|到店|体验|抢购)/.test(src);
    const hasMaterial = /(材质|纹理|金属|木纹|石材|灯光|质感|细节|工艺|空间)/.test(src + hint);
    const hasProduct = /(产品|商品|品牌|新品|卖点|功能|效果|定制)/.test(src + hint);
    const shots = isLuxury
      ? [
        `第一镜按「${styleName}」建立品牌氛围和完整场景`,
        hasMaterial || hasProduct ? '第二镜做产品/材质/光影微距特写，锁定质感和形态' : '第二镜做核心视觉符号特写，锁定高级感',
        '第三镜给人物或使用场景，保持人物、服装、产品和背景一致',
        '中段镜头用全参考关键帧串联卖点，避免换脸、换场景和产品变形',
        hasCta ? '最后镜头收束到购买/咨询/品牌口号，保留片尾包装空间' : '最后镜头收束到品牌记忆点，保留片尾包装空间',
      ]
      : [
        '展厅导览式口播广告，数字人从左侧前景缓慢走入或向前半步到左侧三分之一，身体微侧向右侧展示区',
        '讲解动作必须明确：手从腰部自然抬起，指向或扫向右侧展示区/材质/产品细节；视线先跟随手看目标，再回到镜头',
        '右侧三分之二保留完整广告背景、产品墙或空间展示区，品牌信息和主体纹理清晰可见',
        hasMaterial || hasProduct ? '暖色展示灯勾勒材质、纹理、工艺和核心卖点，画面有高级商业广告质感' : '暖色展示灯营造真实空间层次，画面有高级商业广告质感',
        '镜头语言为一镜到底的慢速导览推进，带轻微横向视差和空间延展，人物口型、表情、走位和手势跟随口播节奏自然变化',
        hasCta ? '收尾时人物以轻微手势引导右侧展示区和咨询转化，整体保持沉稳可信的导购感' : '收尾时人物保持亲和讲解姿态，整体保持沉稳可信的导购感',
      ];
    if (isLuxury) {
      return `${shots.join('；')}。整体镜头稳定、真实商业广告质感，人物口型和文案节奏一致，不要额外字幕、贴纸、无关人物或夸张转场。${compact ? `文案核心：${compact}` : ''}`.slice(0, 360);
    }
    return `${shots.join('；')}。画面干净克制，空间、人物和产品比例协调，适合生成一条连续的展墙讲解广告。${compact ? `文案核心：${compact}` : ''}`.slice(0, 360);
  }

  function setFieldValueAndNotify(selector, value) {
    const el = $(selector);
    if (!el) return null;
    el.value = value || '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el;
  }

  function applySpaceGeneratedCopy({ text, durationSec, topic = '' }) {
    const copy = String(text || '').trim();
    const prompt = buildSpacePromptFromText(copy, topic);
    state.space.copyMode = 'ai';
    state.space.durationSec = Number(durationSec) || state.space.durationSec || 30;
    state.space.scenePrompt = prompt;
    state.space.segments = [];
    state.space.speechSegments = [];
    state.space.visualSegments = [];
    state.space.keyframes = [];
    renderSpaceCopyMode();
    setFieldValueAndNotify('#dhSpaceText', copy);
    setFieldValueAndNotify('#dhSpaceScenePrompt', prompt);
    const duration = $('#dhSpaceDuration');
    if (duration) duration.value = String(state.space.durationSec);
    $('#dhSpaceText')?.focus();
  }

  function renderSpaceCopyMode() {
    $$('[data-space-copy-mode]').forEach(b => b.classList.toggle('active', b.dataset.spaceCopyMode === (state.space.copyMode || 'manual')));
    const hint = $('#dhSpacePromptHint');
    if (hint) hint.textContent = state.space.copyMode === 'ai'
      ? (state.space.adMode === 'luxury' ? 'AI 会写广告文案、镜头提示词并生成高定多分镜。' : 'AI 会写广告文案、生成画面提示词，并拆出口播时间轴。')
      : (state.space.adMode === 'luxury' ? '手动输入广告文案后，系统会生成剧情分镜提示词。' : '手动输入广告文案后，系统会生成画面提示词，并拆出口播时间轴。');
    updateSpaceStoryboardButtons();
  }

  function updateSpaceStoryboardButtons() {
    const text = ($('#dhSpaceText')?.value || '').trim();
    const hasBoard = Array.isArray(state.space.segments) && state.space.segments.length > 0;
    const hasKeyframes = Array.isArray(state.space.keyframes) && state.space.keyframes.some(k => k?.image_url);
    const writeBtn = $('#dhSpaceAIWrite');
    if (writeBtn) {
      writeBtn.textContent = !text && state.space.copyMode === 'ai'
        ? (state.space.adMode === 'luxury' ? 'AI 写稿并生成分镜' : 'AI 写稿并拆时间轴')
        : hasBoard
          ? (state.space.adMode === 'luxury' ? '重新生成分镜看板' : '重新生成口播时间轴')
          : (state.space.adMode === 'luxury' ? '生成分镜看板' : '生成口播时间轴');
      writeBtn.title = !text
        ? (state.space.adMode === 'luxury' ? '先 AI 写广告文案，再自动拆成分镜看板' : '先 AI 写广告文案，再自动拆成口播时间轴')
        : (state.space.adMode === 'luxury' ? '根据广告文案和镜头提示词拆成可检查的分镜卡片' : '根据广告文案拆成时间、内容、语气和动作段落');
    }
    const submit = $('#dhSpaceSubmit');
    const validGuidePreview = state.space.adMode !== 'luxury' && isQualifiedShowroomGuidePreview(state.space.keyframes?.[0]);
    if (submit) submit.textContent = hasKeyframes
      ? (state.space.adMode === 'luxury'
        ? '确认关键帧并合成剧情广告'
        : (validGuidePreview ? '确认合格预览并合成视频' : '预览不合格，请重新生成'))
      : (state.space.adMode === 'luxury' ? '生成分镜关键帧预览' : '生成带人物导览预览');
  }

  function renderSpaceModeEmptyPreview({ force = false } = {}) {
    const box = $('#dhSpacePreview');
    if (!box) return;
    const current = box.textContent || '';
    const canReplace = force
      || !current.trim()
      || current.includes('展墙讲解预览')
      || current.includes('准备好了就开始')
      || current.includes('表单已清空');
    if (!canReplace) return;
    if (state.space.adMode === 'luxury') {
      box.innerHTML = `<div class="dh-storyboard-empty">
        <div class="dh-story-card ghost">
          <div class="dh-story-thumb">01</div>
          <b>参考素材</b>
          <span>上传产品、场景、品牌或首帧参考画面</span>
        </div>
        <div class="dh-story-card ghost">
          <div class="dh-story-thumb">02</div>
          <b>剧情分镜</b>
          <span>拆成 4-8 个镜头，逐镜头检查构图与卖点</span>
        </div>
        <div class="dh-story-card ghost">
          <div class="dh-story-thumb">03</div>
          <b>图生视频</b>
          <span>按关键帧逐镜头生成剧情广告段</span>
        </div>
        <div class="dh-story-card ghost">
          <div class="dh-story-thumb">04</div>
          <b>成片包装</b>
          <span>拼接、配音、字幕并输出完整广告片</span>
        </div>
      </div>`;
      return;
    }
    box.innerHTML = `<div class="dh-storyboard-empty">
      <div class="dh-story-card ghost">
        <div class="dh-story-thumb">01</div>
        <b>展墙讲解预览</b>
        <span>人物左侧，右侧保留展示墙/产品空间</span>
      </div>
      <div class="dh-story-card ghost">
        <div class="dh-story-thumb">02</div>
        <b>口播时间轴</b>
        <span>按原文拆分时间、语气、字幕和手势</span>
      </div>
      <div class="dh-story-card ghost">
        <div class="dh-story-thumb">03</div>
        <b>单镜头成片</b>
        <span>稳定慢推，不切镜、不换场景</span>
      </div>
      <div class="dh-story-card ghost">
        <div class="dh-story-thumb">04</div>
        <b>任务中心</b>
        <span>后台合成口播、字幕和最终视频</span>
      </div>
    </div>`;
  }

  function renderSpaceAdMode() {
    const isLuxury = state.space.adMode === 'luxury';
    syncSpaceModeCopyLabels();
    $$('[data-space-ad-mode]').forEach(b => b.classList.toggle('active', b.dataset.spaceAdMode === state.space.adMode));
    $$('[data-space-guide-mode]').forEach(b => b.classList.toggle('active', b.dataset.spaceGuideMode === (state.space.guideMode || 'direct_keyframe')));
    $$('[data-space-guide-gender]').forEach(b => b.classList.toggle('active', b.dataset.spaceGuideGender === (state.space.guideGender || 'female')));
    $$('[data-luxury-style]').forEach(b => b.classList.toggle('active', b.dataset.luxuryStyle === state.space.adStyle));
    const settings = $('#dhLuxurySettings');
    if (settings) settings.style.display = isLuxury ? 'grid' : 'none';
    const pageTitle = $('#dhSpacePageTitle');
    if (pageTitle) pageTitle.textContent = isLuxury ? '剧情广告' : '素材审片';
    const pageSub = $('#dhSpacePageSub');
    if (pageSub) pageSub.textContent = isLuxury
      ? '独立的多镜头广告片工作流：人物可选；选择人物后会锁定同一身份参考，逐镜头重绘融合。'
      : '素材审片按单镜头展墙讲解生成，适合稳定导览和空间卖点说明。';
    const avatarTitle = $('#dhSpaceAvatarTitle');
    if (avatarTitle) avatarTitle.textContent = isLuxury ? '广告人物身份参考（可选）' : '素材审片形象（可选）';
    const bgTitle = $('#dhSpaceBgTitle');
    if (bgTitle) bgTitle.textContent = isLuxury ? '参考画面 / 产品物料' : '广告背景 / 展示画面';
    const bgUploadHint = $('#dhSpaceBgUploadHint');
    if (bgUploadHint) bgUploadHint.textContent = isLuxury ? '按镜头顺序上传多张画面' : '上传广告背景图';
    const modePanel = $('#dhSpaceAdModePanel');
    if (modePanel) modePanel.style.display = 'none';
    const shot = $('#dhLuxuryShotCount');
    if (shot) shot.value = String(state.space.shotCount || 6);
    const title = $('#dhSpaceWorkbenchTitle');
    if (title) title.textContent = isLuxury ? '剧情广告工作流' : '单镜头预览';
    const sub = $('#dhSpaceWorkbenchSub');
    if (sub) sub.textContent = isLuxury
      ? '按 Image2 关键帧 + 图生视频参考流生成剧情广告镜头；人物只变姿态和表情，不换脸。'
      : 'AI 会按上传背景和性别生成一位导览员，并先做自然融合质检；没有人物的预览不能合成。';
    const hint = $('#dhSpaceModeHint');
    if (hint) hint.textContent = isLuxury
      ? `当前风格：${luxuryStyleName(state.space.adStyle)}；多关键帧分镜链路会锁定人物身份、产品和参考画面。`
      : '素材审片必须生成带人物的导览员预览，并通过质量检查后才能合成视频。';
    const guideModePanel = $('#dhSpaceGuideModePanel');
    if (guideModePanel) guideModePanel.style.display = isLuxury ? 'none' : 'flex';
    const guideGenderPanel = $('#dhSpaceGuideGenderPanel');
    if (guideGenderPanel) guideGenderPanel.style.display = (!isLuxury && state.space.guideMode === 'ai_guide' && !state.selectedAvatar) ? 'block' : 'none';
    renderSpaceModeEmptyPreview();
    updateSpaceStoryboardButtons();
  }

  function autoBuildSpacePromptFromManualText({ immediate = false } = {}) {
    if (state.space.copyMode === 'ai') return;
    if (state.space.promptTimer) clearTimeout(state.space.promptTimer);
    const run = () => {
      const text = ($('#dhSpaceText')?.value || '').trim();
      const promptInput = $('#dhSpaceScenePrompt');
      if (!text || !promptInput) return;
      const next = buildSpacePromptFromText(text);
      promptInput.value = next;
      state.space.scenePrompt = next;
    };
    if (immediate) run();
    else state.space.promptTimer = setTimeout(run, 450);
  }

  function buildSpaceSpeechSegmentsLocal(text, durationSec) {
    const src = normalizeSpeechCopy(text).replace(/\s+/g, '');
    if (!src) return [];
    const target = Math.max(8, Math.min(120, Number(durationSec) || Math.ceil(src.length / 4) || 30));
    const pieces = src
      .split(/(?<=[。！？!?])\s*/)
      .map(s => s.trim())
      .filter(Boolean);
    const chunks = [];
    let buf = '';
    for (const p of pieces.length ? pieces : [src]) {
      if ((buf + p).length <= 46 || !buf) buf += p;
      else { chunks.push(buf); buf = p; }
    }
    if (buf) chunks.push(buf);
    while (chunks.length < 3 && chunks.some(s => s.length > 36)) {
      const idx = chunks.findIndex(s => s.length > 36);
      const s = chunks[idx];
      const cut = Math.ceil(s.length / 2);
      chunks.splice(idx, 1, s.slice(0, cut), s.slice(cut));
    }
    const list = chunks.slice(0, 8);
    const totalChars = list.reduce((n, s) => n + Math.max(1, s.length), 0) || 1;
    let cursor = 0;
    const tones = ['friendly', 'confident', 'warm', 'focused', 'encouraging', 'gentle', 'firm', 'encouraging'];
    return list.map((segText, i) => {
      const isLast = i === list.length - 1;
      const dur = isLast ? Math.max(1, target - cursor) : Math.max(2, Math.round(target * Math.max(1, segText.length) / totalChars));
      const start = cursor;
      const end = isLast ? target : Math.min(target, start + dur);
      cursor = end;
      return {
        index: i,
        title: `时间段 ${i + 1}`,
        text: segText,
        start,
        end,
        duration: Math.max(1, end - start),
        tone: tones[i] || 'warm',
        expression: i === 0 ? 'friendly' : i === list.length - 1 ? 'confident' : 'natural',
        motion: i === 0 ? 'open-palm welcome gesture' : i === list.length - 1 ? 'gentle call-to-action gesture' : 'subtle hand gesture toward the right display wall',
        camera: 'single_take_push_in',
      };
    });
  }

  async function buildSpaceSpeechSegments(text, durationSec) {
    // 普通广告必须保留用户/AI 已写好的原文，不能让 LLM 分段时改写成无关内容。
    return buildSpaceSpeechSegmentsLocal(text, durationSec);
  }

  async function buildSpaceStoryboardFromText(text, durationSec) {
    const isLuxury = state.space.adMode === 'luxury';
    const shotCount = isLuxury ? Math.max(4, Math.min(8, Number(state.space.shotCount) || 6)) : 1;
    if (!isLuxury) {
      const dur = Math.max(8, Number(durationSec) || 10);
      const speechSegments = await buildSpaceSpeechSegments(text, dur);
      state.space.speechSegments = speechSegments;
      state.space.segments = speechSegments;
      state.space.visualSegments = [{
        title: '单镜头展墙讲解',
        text,
        start: 0,
        end: dur,
        duration: dur,
        tone: 'professional',
        role: 'showroom_guide',
        camera: 'push_in',
      }];
      state.space.keyframes = [];
      const box = $('#dhSpacePreview');
      if (box) {
        box.innerHTML = `<div class="dh-storyboard-wrap">
          <div class="dh-storyboard-status">
            <div>
          <b>口播时间轴已生成</b>
          <span>素材审片 · 视觉 1 个连续镜头 · 口播 ${speechSegments.length} 段，人物左侧讲解，右侧展示背景/产品空间</span>
            </div>
            <button type="button" class="dh-btn dh-btn-primary dh-btn-sm" data-space-keyframes-from-board>生成展墙讲解预览</button>
          </div>
          <div class="dh-storyboard-grid">
            ${speechSegments.map((seg, idx) => `<div class="dh-story-card dh-speech-segment-card">
              <div class="dh-story-meta">
                <span>${fmtTime(seg.start || 0)}-${fmtTime(seg.end || '')}</span>
                <span class="dh-story-badge">${escapeHtml(presetLabel(TONE_PRESETS, seg.tone || 'warm'))}</span>
              </div>
              <b>${escapeHtml(seg.title || `时间段 ${idx + 1}`)}</b>
              <p>${escapeHtml(seg.text)}</p>
              <span>语气、停顿、手势和字幕按本段变化；画面保持展墙讲解构图。</span>
            </div>`).join('')}
          </div>
        </div>`;
      }
      updateSpaceStoryboardButtons();
      return state.space.segments;
    }
    const s = await api('/api/dh/scripts/segment', {
      method: 'POST',
      body: { text, target_duration_sec: durationSec, preferred_count: shotCount || undefined },
    });
    if (!s.success) throw new Error(s.error || '拆分失败');
    state.space.segments = (s.segments || []).slice(0, shotCount || 5);
    state.space.keyframes = [];
    const box = $('#dhSpacePreview');
    if (box) {
      const modeLabel = isLuxury ? '剧情广告' : '素材审片';
      box.innerHTML = `<div class="dh-storyboard-wrap">
        <div class="dh-storyboard-status">
          <div>
            <b>分镜看板已生成</b>
            <span>${modeLabel} · ${state.space.segments.length} 个镜头 · 下一步先生成每个镜头关键帧，确认效果后再合成视频${isLuxury ? ` · ${luxuryProviderQueueLabel()}` : ''}</span>
          </div>
          <button type="button" class="dh-btn dh-btn-primary dh-btn-sm" data-space-keyframes-from-board>${isLuxury ? '生成剧情关键帧预览' : '生成分镜镜头预览'}</button>
        </div>
        <div class="dh-storyboard-grid${!isLuxury ? ' dh-storyboard-grid-single' : ''}">
          ${state.space.segments.map((seg, idx) => `<div class="dh-story-card">
            <div class="dh-story-thumb">${String(idx + 1).padStart(2, '0')}<span>待生成关键帧</span></div>
            <div class="dh-story-meta">
              <span>${fmtTime(seg.start)}-${fmtTime(seg.end)}</span>
              <span class="dh-story-badge">${escapeHtml(presetLabel(TONE_PRESETS, seg.tone || 'natural'))}</span>
            </div>
            <b>${escapeHtml(seg.title || (isLuxury ? `剧情镜头 ${idx + 1}` : `分镜 ${idx + 1}`))}</b>
            <p>${escapeHtml(seg.text)}</p>
            ${isLuxury ? renderLuxuryShotDetails(seg) : ''}
            <span>${isLuxury ? `风格：${escapeHtml(luxuryStyleName(state.space.adStyle))} · 先生成保参考 Image2 风格关键帧预览。` : '先按此段生成广告预览图。'}</span>
          </div>`).join('')}
        </div>
      </div>`;
    }
    updateSpaceStoryboardButtons();
    return state.space.segments;
  }

  async function writeAndSegmentSpaceScript() {
    const title = ($('#dhSpaceTitle')?.value || '素材审片').trim();
    const durationSec = Number($('#dhSpaceDuration')?.value || state.space.durationSec || 30);
    const text = ($('#dhSpaceText')?.value || '').trim();
    const scenePrompt = ($('#dhSpaceScenePrompt')?.value || '').trim();
    const cameraPrompt = ($('#dhSpaceCameraPrompt')?.value || '').trim();
    state.space.durationSec = durationSec;
    state.space.scenePrompt = scenePrompt;
    state.space.cameraPrompt = cameraPrompt;
    const btn = $('#dhSpaceAIWrite');
    const old = btn?.innerHTML;
    if (!text) return openSpaceWriteModal();
    if (btn) { btn.disabled = true; btn.innerHTML = '生成中…'; }
    try {
      if (!scenePrompt) autoBuildSpacePromptFromManualText({ immediate: true });
      await buildSpaceStoryboardFromText(text, durationSec);
      toast(state.space.adMode === 'luxury'
        ? `分镜看板已生成：${state.space.segments.length} 个镜头，下一步生成关键帧预览`
        : `口播时间轴已生成：${state.space.speechSegments.length || state.space.segments.length} 段，下一步生成展墙讲解预览`,
        'success');
    } catch (err) {
      toast((state.space.adMode === 'luxury' ? '分镜看板' : '口播时间轴') + '生成失败：' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = old || (state.space.adMode === 'luxury' ? '生成分镜看板' : '生成口播时间轴'); }
    }
  }

  function renderSpaceKeyframeBoard() {
    const isLuxury = state.space.adMode === 'luxury';
    const segments = state.space.segments || [];
    const keyframes = state.space.keyframes || [];
    const isGuidePreview = !isLuxury && keyframes.length === 1;
    const speechCount = (state.space.speechSegments || state.space.segments || []).length;
    const box = $('#dhSpacePreview');
    if (!box) return;
    box.innerHTML = `<div class="dh-storyboard-wrap">
      <div class="dh-storyboard-status">
        <div>
          <b>${isLuxury ? '镜头预览图已生成' : '展墙讲解预览已生成'}</b>
          <span>${isLuxury ? `${keyframes.length} 个镜头预览图 · 点击任意卡片可放大查看；确认后才会逐镜头生成视频并合成成片 · ${luxuryProviderQueueLabel()}` : `点击预览图可放大查看；口播时间轴共 ${speechCount} 段，会用于配音节奏和字幕`}</span>
        </div>
        <div class="dh-storyboard-status-actions">
          <button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-space-keyframes-from-board>${isLuxury ? '重新生成关键帧' : '重新生成预览'}</button>
          <button type="button" class="dh-btn dh-btn-primary dh-btn-sm" data-space-submit-from-board>${isLuxury ? '确认关键帧并合成剧情广告' : '确认预览并合成视频'}</button>
        </div>
      </div>
      <div class="dh-storyboard-grid${isGuidePreview ? ' dh-storyboard-grid-guide' : ''}">
        ${keyframes.map((kf, idx) => {
          const seg = segments[idx] || kf || {};
          const shotFocus = kf.shot_plan?.focus || '镜头构图';
          return `<div class="dh-story-card dh-story-card-ready${isGuidePreview ? ' dh-story-card-guide' : ''}" ${kf.image_url ? `data-space-keyframe-preview="${idx}"` : ''} title="${kf.image_url ? '点击放大查看镜头预览图' : ''}">
            <div class="dh-story-thumb">${kf.image_url ? `<img src="${escapeHtml(withAuthQuery(kf.image_url))}" alt="${escapeHtml(kf.title || `镜头 ${idx + 1}`)}">` : `${String(idx + 1).padStart(2, '0')}<span>生成失败</span>`}</div>
            <div class="dh-story-meta">
              <span>${isGuidePreview ? '预览图' : `${fmtTime(seg.start || kf.start || 0)}-${fmtTime(seg.end || kf.end || '')}`}</span>
              ${isGuidePreview ? '' : `<span class="dh-story-badge">${escapeHtml(shotFocus)}</span>`}
            </div>
            <b>${escapeHtml(kf.title || seg.title || `镜头 ${idx + 1}`)}</b>
            ${isGuidePreview ? '' : `<p>${escapeHtml(kf.voiceover || seg.text || '')}</p>
            ${isLuxury ? renderLuxuryShotDetails(kf.workflow_type ? kf : seg) : ''}
            <span>${kf.reference_mode === 'direct_uploaded_keyframe' ? '直接首帧：视频会从这张上传画面开始生成，不再替换里面的人物。' : (kf.reference_mode === 'integrated_avatar_background' ? '自然融合首帧：按你选的人物和上传背景生成同一张画面，减少贴片感。' : (kf.reference_mode === 'generated_showroom_guide' ? 'AI 自然导览员：未选择人物时由系统在背景里生成一位讲解员。' : (kf.reference_mode === 'seedream_showroom_guide' ? '参考视频风格：按上传背景在场景内生成导览员，优先保证人物与背景自然融合。' : (kf.reference_mode === 'fused_showroom_guide' ? 'AI 融合首帧：人物会按上传背景的光线、空间和透视重新生成进场景里。' : (kf.reference_mode === 'locked_composite' ? (isLuxury ? '素材锁定：人物和背景来自你的上传图；构图按该镜头提示词变化。' : '素材锁定兜底：人物和背景来自你的上传图；已尽量匹配光线和阴影。') : '这张图会作为该镜头的视频起始画面。')))))}</span>`}
          </div>`;
        }).join('')}
      </div>
      ${!isLuxury && (state.space.speechSegments || []).length ? `<div class="dh-storyboard-status" style="margin-top:12px">
        <div><b>口播时间轴</b><span>${state.space.speechSegments.length} 段内容已生成，会用于后续配音、字幕和动作节奏。</span></div>
      </div>` : ''}
    </div>`;
    updateSpaceStoryboardButtons();
  }

  async function generateSpaceKeyframes() {
    const missing = [];
    const isLuxury = state.space.adMode === 'luxury';
    if (!state.space.bgImageUrl) missing.push(isLuxury ? '参考画面/产品物料' : '广告背景');
    const text = ($('#dhSpaceText')?.value || '').trim();
    if (!text) missing.push('广告文案');
    if (missing.length) return toast('请先补齐：' + missing.join('、'), 'error');
    const durationSec = Number($('#dhSpaceDuration')?.value || state.space.durationSec || 30);
    if (!state.space.segments?.length) await buildSpaceStoryboardFromText(text, durationSec);
    const title = ($('#dhSpaceTitle')?.value || '素材审片').trim();
    const shotCount = isLuxury ? Math.max(4, Math.min(8, Number(state.space.shotCount) || 6)) : 1;
    if (!isLuxury && !(state.space.speechSegments || []).length) {
      state.space.speechSegments = await buildSpaceSpeechSegments(text, durationSec);
      state.space.segments = state.space.speechSegments;
    }
    if (!isLuxury && state.space.guideMode === 'direct_keyframe') {
      state.space.guideMode = 'ai_guide';
      $$('[data-space-guide-mode]').forEach(b => b.classList.toggle('active', b.dataset.spaceGuideMode === 'ai_guide'));
      toast('素材审片必须先生成带人物的导览员预览，纯背景不能作为合格首帧。', 'warning');
    }
    const btn = $('#dhSpaceSubmit');
    const old = btn?.textContent || '';
    if (btn) { btn.disabled = true; btn.textContent = isLuxury ? '生成关键帧中…' : '生成预览中…'; }
    const box = $('#dhSpacePreview');
    if (box) box.innerHTML = renderProgressPreview(
      isLuxury ? '生成分镜关键帧' : '生成展墙讲解预览',
      isLuxury ? '正在逐镜头生成可预览的广告关键帧，完成后再确认合成视频' : '正在按人物+背景生成同一张自然融合首帧，避免抠图贴片感',
      0,
      { previewUrl: state.space.bgImageUrl },
    );
    try {
      const requestKey = isLuxury ? `space_luxury_keyframes_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : '';
      let r;
      const requestBody = {
          avatar_id: isLuxury ? (state.selectedAvatar?.id || '') : '',
          background_url: state.space.bgImageUrl,
          reference_images: isLuxury
            ? (state.space.referenceImages || []).map(x => x.url).filter(Boolean)
            : undefined,
          text,
          title,
          scene_prompt: ($('#dhSpaceScenePrompt')?.value || state.space.scenePrompt || '').trim(),
          duration_sec: durationSec,
          segments: state.space.segments || [],
          guide_gender: !isLuxury ? (state.space.guideGender || 'female') : '',
          ad_mode: isLuxury ? 'luxury_ad' : 'showroom_guide',
          generation_mode: isLuxury ? 'luxury_storyboard' : 'showroom_guide_strict',
          strict_mode: !isLuxury,
          ad_style: state.space.adStyle || 'luxury_soft',
          shot_count: shotCount,
          request_key: requestKey,
          request_async: isLuxury,
          ...outputPayload(state.space.outputRatio, state.space.outputSize),
      };
      try {
        r = await api('/api/dh/spaces/keyframes', {
          method: 'POST',
          body: requestBody,
        });
        if (isLuxury && r?.status === 'accepted' && r?.request_key) {
          r = await pollLuxuryKeyframeResult(requestKey, { timeoutMs: 0, totalShots: shotCount });
        }
      } catch (err) {
        if (!isLuxury || !isLuxuryStoryboardLongRunningError(err)) throw err;
        r = await pollLuxuryKeyframeResult(requestKey, { timeoutMs: 0, totalShots: shotCount });
      }
      if (!r.success) {
        const err = new Error(r.error || (isLuxury ? '生成关键帧失败' : '生成预览失败'));
        err.data = r;
        throw err;
      }
      if (!isLuxury) {
        const kf = r.keyframes?.[0] || null;
        if (!r.strict || !r.keyframe_id || !isQualifiedShowroomGuidePreview(kf)) {
          state.space.strictKeyframeId = '';
          state.space.keyframes = [];
          throw new Error('预览未通过强制质量检查：贴片、模板合成、小人角落结果不能作为合格素材审片预览');
        }
      }
      const previousSegments = state.space.segments || [];
      const scenes = r.scenes || [];
      if (isLuxury) {
        state.space.segments = scenes.map((sc, i) => ({
          ...(previousSegments[i] || {}),
          ...sc,
          start: previousSegments[i]?.start ?? sc.start ?? 0,
          end: previousSegments[i]?.end ?? sc.end ?? previousSegments[i]?.endTime ?? '',
          text: sc.voiceover || previousSegments[i]?.text || sc.text || '',
        }));
      } else {
        state.space.visualSegments = scenes;
        state.space.segments = (state.space.speechSegments || previousSegments || []);
        state.space.strictKeyframeId = r.keyframe_id || r.keyframes?.[0]?.keyframe_id || '';
      }
      state.space.keyframes = (r.keyframes || []).map((kf, i) => ({
        ...((isLuxury ? state.space.segments : state.space.visualSegments)?.[i] || {}),
        ...kf,
      }));
      renderSpaceKeyframeBoard();
      toast(isLuxury ? `已生成 ${state.space.keyframes.length} 个镜头关键帧，请确认效果后再合成视频` : '已生成展墙讲解预览，请确认人物站位和右侧展示区后再合成视频', 'success');
    } catch (err) {
      const detail = err.data?.details || {};
      const code = err.data?.code || '';
      const stage = err.data?.stage || '';
      const failedChecks = Array.isArray(detail.failed_checks) ? detail.failed_checks : [];
      const maskedIssues = detail.masked_qa?.issues || [];
      const attemptIssues = (detail.scene_candidate_details?.qa_attempts || [])
        .flatMap(x => x.qa?.issues || (x.error ? [x.error] : []));
      const qaHint = [...failedChecks, ...maskedIssues, ...attemptIssues]
        .filter(Boolean)
        .slice(0, 3)
        .join('；');
      const codeHint = code ? `[${code}${stage ? '/' + stage : ''}] ` : '';
      toast((isLuxury ? '生成镜头关键帧失败：' : '生成展墙讲解预览失败：') + codeHint + err.message + (qaHint ? `（${qaHint}）` : ''), 'error');
      if (state.space.segments?.length) buildSpaceStoryboardFromText(text, durationSec).catch(() => {});
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old || (isLuxury ? '生成分镜关键帧预览' : '生成展墙讲解预览'); }
      updateSpaceStoryboardButtons();
    }
  }

  async function submitSpaceGuide() {
    const missing = [];
    const isLuxury = state.space.adMode === 'luxury';
    if (!state.space.bgImageUrl) missing.push(isLuxury ? '参考画面/产品物料' : '广告背景');
    if (!(state.space.voiceId || '').trim()) missing.push('配音音色');
    if (missing.length) {
      await DhConfirm({
        title: '还不能生成素材审片',
        message: '请先补齐必填内容后再生成。',
        detail: missing.map(x => `缺少：${x}`).join('<br>'),
        confirmText: '我知道了',
        cancelText: '关闭',
        type: 'warning',
      });
      return;
    }
    const text = ($('#dhSpaceText')?.value || '').trim();
    if (!text) return toast('请先填写广告文案', 'error');
    if (text.length > 1000) return toast('广告文案不能超过 1000 字', 'error');

    const title = ($('#dhSpaceTitle')?.value || '素材审片').trim();
    const voiceId = (state.space.voiceId || '').trim();
    const durationSec = Number($('#dhSpaceDuration')?.value || state.space.durationSec || Math.max(10, Math.ceil(text.length / 4)));
    const scenePrompt = ($('#dhSpaceScenePrompt')?.value || state.space.scenePrompt || '').trim();
    const cameraPrompt = ($('#dhSpaceCameraPrompt')?.value || state.space.cameraPrompt || '一镜到底展厅导览：缓慢向前推进，轻微横向视差，场景徐徐展开；镜头跟随讲解员手势从人物过渡到展示墙/产品细节，再回到人物推荐').trim();
    const subtitleOn = $('#dhSpaceSubtitleOn')?.checked !== false;
    const adStyle = state.space.adStyle || 'luxury_soft';
    const shotCount = isLuxury ? Math.max(4, Math.min(8, Number(state.space.shotCount) || 6)) : 1;
    state.space.durationSec = durationSec;
    state.space.scenePrompt = scenePrompt;
    state.space.cameraPrompt = cameraPrompt;
    if (!state.space.keyframes?.some(k => k?.image_url)) {
      await generateSpaceKeyframes();
      toast('请先检查镜头预览效果，确认后再点击合成视频', 'warning');
      return;
    }
    if (!isLuxury && !isQualifiedShowroomGuidePreview(state.space.keyframes?.[0])) {
      state.space.strictKeyframeId = '';
      state.space.keyframes = [];
      state.space.visualSegments = [];
      renderSpaceKeyframeBoard();
      toast('当前预览不合格：贴片、模板合成、小人角落结果不能合成视频，请重新生成自然融合预览。', 'error');
      return;
    }
    const box = $('#dhSpacePreview');
    if (box) {
      box.innerHTML = renderProgressPreview(isLuxury ? '生成剧情关键帧' : '合成展墙讲解视频', isLuxury ? '后台会按剧情广告风格生成多张保参考关键帧，再用已配置的图生视频模型逐镜头串联成片' : '后台会使用已确认的展墙讲解构图，生成左侧数字人讲解、右侧展示区稳定可见的连续口播视频', 0, {
        previewUrl: state.space.bgImageUrl,
      });
    }

    try {
      let segments = state.space.segments || [];
      let speechSegments = state.space.speechSegments || [];
      if (!isLuxury) {
        if (!speechSegments.length || speechSegments.map(x => x.text).join('').slice(0, 20) !== text.slice(0, 20)) {
          speechSegments = await buildSpaceSpeechSegments(text, durationSec);
          state.space.speechSegments = speechSegments;
          state.space.segments = speechSegments;
        }
        segments = state.space.visualSegments?.length
          ? state.space.visualSegments
          : [{ title: '单镜头展墙讲解', text, voiceover: text, start: 0, end: durationSec, duration: durationSec, role: 'showroom_guide' }];
      } else if (!segments.length || segments.map(x => x.text).join('').slice(0, 20) !== text.slice(0, 20)) {
        const s = await api('/api/dh/scripts/segment', {
          method: 'POST',
          body: { text, target_duration_sec: durationSec, preferred_count: shotCount },
        });
        if (s.success) segments = state.space.segments = s.segments || [];
      }
      const adPayload = {
        avatar_id: (!isLuxury && state.space.guideMode === 'ai_guide') ? '' : (state.selectedAvatar?.id || ''),
        background_url: state.space.bgImageUrl,
        reference_images: isLuxury
          ? (state.space.referenceImages || []).map(x => x.url).filter(Boolean)
          : undefined,
        text,
        title,
        voice_id: voiceId || null,
        scene: 'auto',
        camera: 'auto',
        scene_prompt: scenePrompt,
        camera_prompt: cameraPrompt || '一镜到底展厅导览：缓慢向前推进，轻微横向视差，场景徐徐展开；镜头跟随讲解员手势从人物过渡到展示墙/产品细节，再回到人物推荐',
        duration_sec: durationSec,
        segments,
        speech_segments: isLuxury ? segments : speechSegments,
        keyframes: state.space.keyframes || [],
        keyframe_id: !isLuxury ? (state.space.strictKeyframeId || state.space.keyframes?.[0]?.keyframe_id || '') : '',
        guide_gender: !isLuxury ? (state.space.guideGender || 'female') : '',
        subtitle: getDhSubtitlePayload(subtitleOn),
        generation_mode: spaceGuideGenerationMode(isLuxury),
        strict_mode: false,
        ad_mode: isLuxury ? 'luxury_ad' : 'showroom_guide',
        ad_style: adStyle,
        shot_count: shotCount || undefined,
        ...outputPayload(state.space.outputRatio, state.space.outputSize),
      };
      const r = await api('/api/dh/spaces/generate', {
        method: 'POST',
        body: adPayload,
      });
      if (!r.success) throw new Error(r.error || '提交失败');
      const createDetail = {
        title,
        durationSec,
        text,
        scenePrompt,
        cameraPrompt,
        backgroundName: state.space.bgImageName || '',
        backgroundUrl: state.space.bgImageUrl || '',
        avatarName: state.selectedAvatar?.name || '',
        avatarId: state.selectedAvatar?.id || '',
        voiceId: voiceId || '',
        adMode: isLuxury ? '剧情广告' : '素材审片',
        adStyle: isLuxury ? luxuryStyleName(adStyle) : '',
        guideGender: !isLuxury ? (state.space.guideGender || 'female') : '',
        shotCount: shotCount || '',
        outputRatio: state.space.outputRatio,
        outputSize: state.space.outputSize,
        resolution: outputPixels(state.space.outputRatio, state.space.outputSize),
        segments,
        speechSegments,
        keyframes: state.space.keyframes || [],
        subtitle: getDhSubtitlePayload(subtitleOn),
        submittedAt: new Date().toISOString(),
      };
      const taskMeta = {
        taskId: r.taskId,
        avatarName: isLuxury ? `${title || '剧情广告'} · ${luxuryStyleName(adStyle)}` : (title || state.selectedAvatar?.name || '素材审片'),
        startedAt: Date.now(),
        status: 'submitted',
        stage: 'submitted',
        snapshot: null,
        previewUrl: r.keyframeUrl || state.space.bgImageUrl,
        textPreview: isLuxury ? `${durationSec}s · ${shotCount} 镜头 · ${luxuryStyleName(adStyle)} · ${text.slice(0, 50)}` : `${durationSec}s · 单镜头展墙讲解 · ${text.slice(0, 60)}`,
        taskType: 'digital_ad',
        retryPayload: adPayload,
        createDetail,
      };
      syncRunningTask(r.taskId, taskMeta);
      pollVideoTask(r.taskId);
      state.activeTaskType = 'digital_ad';
      if (box) {
        box.innerHTML = `<div class="dh-space-result">
          <div>
            <div class="dh-render-stage-name">已提交到任务中心</div>
            <div class="dh-render-stage-sub">${durationSec}s · ${isLuxury ? '多镜头剧情广告' : '展墙讲解口播'} · 预览图和视频都在后台生成，可以继续创建其他任务。</div>
            <button class="dh-btn dh-btn-primary dh-btn-sm" data-tab-go="tasks">查看任务中心</button>
          </div>
        </div>`;
      }
      updateSpaceStoryboardButtons();
      switchTab('tasks');
      resetSpaceGuideFormForNext();
      toast('素材审片视频已提交到任务中心', 'success');
    } catch (err) {
      if (box) box.innerHTML = `<div class="dh-render-stage">
        <div class="dh-render-stage-name" style="color:var(--dh-error)">❌ 生成失败</div>
        <div class="dh-render-stage-sub">${escapeHtml(err.message)}</div>
      </div>`;
      toast('素材审片提交失败：' + err.message, 'error');
    }
  }

  async function submitVideo() {
    if (!state.selectedAvatar) return toast('请先在「我的形象」选一个', 'error');
    if (state.s3.voiceId === null || state.s3.voiceId === undefined) {
      toast('请先在左侧"音色"列表里选择一个声音（自动 / 我的克隆 / 系统音色）', 'error');
      // 高亮音色面板，给用户视觉引导
      const list = document.getElementById('dhVoiceList');
      if (list) {
        list.scrollIntoView({ behavior: 'smooth', block: 'center' });
        list.style.boxShadow = '0 0 0 3px rgba(255,77,109,0.4)';
        setTimeout(() => { list.style.boxShadow = ''; }, 2000);
      }
      return;
    }
    const text = $('#dhS3Text').value.trim();
    if (!text) return toast('请先写好台词', 'error');
    if (text.length > 1000) return toast('台词不能超过 1000 字（Omni 单次上限）', 'error');

    // 字幕开了但没拆分 → 先自动拆分（否则烧录不出字幕）
    if (state.s3.subtitle?.show && (!state.s3.segments || state.s3.segments.length === 0)) {
      toast('字幕开启中，自动拆分台词…', '');
      try { await segmentScript(); } catch {}
    }

    const selectedVoice = state.voices.find(v => String(v.id) === String(state.s3.voiceId));
    if (state.s3.product?.enabled && !state.s3.product?.imageUrl) {
      return toast('商品数字人模式需要先上传商品图片', 'error');
    }
    const preflight = [
      `形象：${state.selectedAvatar.name || '已选择'}`,
      `音色：${selectedVoice?.name || (state.s3.voiceId ? state.s3.voiceId : '自动')}`,
      `模式：${state.s3.product?.enabled ? `商品数字人（${state.s3.product?.imageName || '已上传商品'}）` : '普通数字人'}`,
      `字幕：${state.s3.subtitle?.show ? `开启（${state.s3.segments?.length || 0} 段）` : '关闭'}`,
      `台词：${text.length} 字，预计 ${Math.ceil(text.length / 4)} 秒`,
      `规格：${state.s3.outputRatio} · ${outputPixels(state.s3.outputRatio, state.s3.outputSize)}`,
      `引擎：按管理端 avatar.lip_sync 配置链路执行`,
    ].join('<br>');
    const ok = await DhConfirm({
      title: '生成前预检',
      message: '请确认本次数字人生成配置。',
      detail: preflight,
      confirmText: '开始生成',
      type: 'primary',
    });
    if (!ok) return;

    // 进度 UI
    const box = $('#dhRenderBox');
    box.innerHTML = renderProgressPreview('提交中', '正在按当前配置生成');

    try {
      const r = await api('/api/dh/videos/generate', {
        method: 'POST',
        body: {
          avatar_id: state.selectedAvatar.id,
          text,
          voice_id: state.s3.voiceId || null,
          title: state.selectedAvatar.name,
          segments: state.s3.segments || [],
          subtitle: getDhSubtitlePayload(state.s3.subtitle?.show !== false),
          product: productApiPayload(state.s3.product),
          ...outputPayload(state.s3.outputRatio, state.s3.outputSize),
        },
      });
      if (!r.success) throw new Error(r.error || '提交失败');
      state.s3.taskId = r.taskId;
      const durationSec = Math.max(10, Math.ceil(text.length / 4));
      const createDetail = {
        title: state.selectedAvatar.name || '数字人成片',
        durationSec,
        text,
        avatarName: state.selectedAvatar.name || '',
        avatarId: state.selectedAvatar.id || '',
        voiceId: state.s3.voiceId || '',
        productName: state.s3.product?.enabled ? (state.s3.product?.imageName || state.s3.product?.name || '商品') : '',
        backgroundUrl: state.s3.product?.enabled ? (state.s3.product?.imageUrl || '') : '',
        segments: state.s3.segments || [],
        subtitle: getDhSubtitlePayload(state.s3.subtitle?.show !== false),
        outputRatio: state.s3.outputRatio,
        outputSize: state.s3.outputSize,
        resolution: outputPixels(state.s3.outputRatio, state.s3.outputSize),
        scenePrompt: (state.s3.segments || []).map((s, i) => {
          const bits = [s.camera ? `镜头${i + 1}:${presetLabel(CAMERA_PRESETS, s.camera)}` : '', s.motion ? `动作:${s.motion}` : ''].filter(Boolean);
          return bits.join(' · ');
        }).filter(Boolean).join('\n'),
        submittedAt: new Date().toISOString(),
      };
      const taskMeta = {
        taskId: r.taskId,
        taskType: 'digital_human',
        avatarName: state.selectedAvatar.name,
        startedAt: Date.now(),
        status: 'submitted',
        stage: 'submitted',
        snapshot: null,
        previewUrl: getSelectedAvatarPreviewUrl(),
        textPreview: text.slice(0, 80),
        createDetail,
      };
      // 加入后台任务中心（切换 tab 或继续创建不会停止轮询）
      syncRunningTask(r.taskId, taskMeta);
      pollVideoTask(r.taskId);
      state.activeTaskType = 'digital_human';
      switchTab('tasks');
      // 任务中心是唯一的进度展示位置 —— 切走后清空 step3 的渲染框，
      // 用户回到"生成数字人"时不应该再看到上一次的进度内容。
      state.s3.taskId = null;
      box.innerHTML = '';
      toast('🎬 已提交到任务中心，可以继续创建下一个数字人', 'success');
    } catch (err) {
      box.innerHTML = `<div class="dh-render-stage">
        <div class="dh-render-stage-name" style="color:var(--dh-error)">❌ 失败</div>
        <div class="dh-render-stage-sub">${escapeHtml(err.message)}</div>
      </div>`;
      toast('提交失败：' + err.message, 'error');
    }
  }

  async function submitProductAd() {
    if (!state.selectedAvatar) return toast('请先选择商品数字人形象', 'error');
    const isProductAvatar = state.selectedAvatar.avatar_type === 'product' || state.selectedAvatar.type === 'product';
    if (!isProductAvatar) return toast('只有商品数字人素材可以生成商品口播视频', 'error');
    const product = productApiPayload(state.s3.product);
    if (!product?.image_url) return toast('商品口播视频需要商品图，请先补传商品', 'error');
    const topic = $('#dhS3Text')?.value.trim()
      || [product.name, product.selling_points].filter(Boolean).join('，')
      || '生成一条商品口播短视频';
    const ok = await DhConfirm({
      title: '生成商品口播视频',
      message: '系统会自动生成分镜关键帧，再合成商品成片并进入任务中心。',
      detail: [
        `商品：${product.name || product.image_name || '已上传商品'}`,
        `形象：${state.selectedAvatar.name || '已选择'}`,
        '流程：分镜 → 关键帧 → 图生视频 → 口播字幕 → 作品库',
      ].join('<br>'),
      confirmText: '开始生成',
      type: 'primary',
    });
    if (!ok) return;

    const box = $('#dhRenderBox');
    if (box) box.innerHTML = renderProgressPreview('提交中', '准备商品口播视频');
    try {
      const r = await api('/api/dh/product-ads/generate', {
        method: 'POST',
        body: {
          avatar_id: state.selectedAvatar.id,
          product,
          topic,
          duration_sec: Math.max(14, Math.min(28, Number(state.s3.targetDurationSec) || 18)),
          voice_id: state.s3.voiceId || null,
          subtitle: getDhSubtitlePayload(state.s3.subtitle?.show !== false),
          ...outputPayload(state.s3.outputRatio, state.s3.outputSize),
        },
      });
      if (!r.success) throw new Error(r.error || '提交失败');
      state.s3.taskId = r.taskId;
      const createDetail = {
        title: product.name || product.image_name || '',
        durationSec: Math.max(14, Math.min(28, Number(state.s3.targetDurationSec) || 18)),
        text: topic,
        productName: product.name || product.image_name || '',
        backgroundName: product.image_name || product.name || '',
        backgroundUrl: product.image_url || '',
        avatarName: state.selectedAvatar.name || '',
        avatarId: state.selectedAvatar.id || '',
        voiceId: state.s3.voiceId || '',
        segments: state.s3.segments || [],
        subtitle: getDhSubtitlePayload(state.s3.subtitle?.show !== false),
        outputRatio: state.s3.outputRatio,
        outputSize: state.s3.outputSize,
        resolution: outputPixels(state.s3.outputRatio, state.s3.outputSize),
        submittedAt: new Date().toISOString(),
      };
      const taskMeta = {
        taskId: r.taskId,
        taskType: 'product_ad',
        createDetail,
        avatarName: `${product.name || product.image_name || '商品'} · 商品口播视频`,
        startedAt: Date.now(),
        status: 'submitted',
        stage: 'submitted',
        snapshot: null,
        previewUrl: product.image_url,
        textPreview: topic.slice(0, 80),
      };
      syncRunningTask(r.taskId, taskMeta);
      pollVideoTask(r.taskId);
      state.activeTaskType = 'product_ad';
      switchTab('tasks');
      state.s3.taskId = null;
      if (box) box.innerHTML = '';
      toast('已提交商品口播视频任务，可以继续做其他内容', 'success');
    } catch (err) {
      if (box) box.innerHTML = `<div class="dh-render-stage">
        <div class="dh-render-stage-name" style="color:var(--dh-error)">❌ 失败</div>
        <div class="dh-render-stage-sub">${escapeHtml(err.message)}</div>
      </div>`;
      toast('提交失败：' + err.message, 'error');
    }
  }

  async function pollVideoTask(taskId) {
    // 多任务并行：每个 task 各自一个 timer，存到 runningTasks
    const meta = state.s3.runningTasks.get(taskId) || { avatarName: '', startedAt: Date.now() };
    if (meta.pollTimer) clearInterval(meta.pollTimer);
    state.s3.runningTasks.set(taskId, meta);
    const start = meta.startedAt || Date.now();
    const MAX = getTaskPollTimeoutMs(meta.taskType);

    const tick = async () => {
      try {
        const box = (state.s3.taskId === taskId) ? $('#dhRenderBox') : null;
        const endpoint = meta.taskType === 'product_ad'
          ? `/api/dh/product-ads/${taskId}`
          : (meta.taskType === 'space_guide' || meta.taskType === 'digital_ad' || meta.taskType === 'luxury_ad')
            ? `/api/dh/spaces/${taskId}`
            : `/api/avatar/jimeng-omni/tasks/${taskId}`;
        const r = await api(endpoint);
        if (!r?.success) {
          meta.pollFailCount = (meta.pollFailCount || 0) + 1;
          const errMsg = r?.error || '任务状态丢失';
          if (/task not found/i.test(errMsg) || meta.pollFailCount >= 3) {
            clearInterval(meta.pollTimer);
            state.s3.runningTasks.delete(taskId);
            upsertVideoTask({
              ...meta,
              taskId,
              status: 'invalid',
              stage: 'invalid',
              error: '服务重启或第三方任务异常导致进度丢失，请重新提交。',
            });
            if (box) box.innerHTML = `<div class="dh-render-stage">
              <div class="dh-render-stage-name" style="color:var(--dh-error)">❌ 任务已失效</div>
              <div class="dh-render-stage-sub">服务重启或第三方任务异常导致进度丢失，请重新点击生成。</div>
            </div>`;
            toast('生成任务已失效，请重新提交', 'error');
          }
          return;
        }
        const t = r.task;
        meta.pollFailCount = 0;
        if (meta.taskType === 'product_ad' && t) {
          meta.retryPayload = meta.retryPayload || {
            avatar_id: t.avatar_id || meta.createDetail?.avatarId || '',
            product: t.product || null,
            topic: t.topic || meta.textPreview || '',
            title: t.title || meta.createDetail?.title || '',
            duration_sec: t.duration_sec || meta.createDetail?.durationSec || 18,
            segments: t.segments || meta.createDetail?.segments || [],
            voice_id: t.voice_id || meta.createDetail?.voiceId || '',
            voice_provider: t.voice_provider || meta.createDetail?.voiceProvider || '',
            subtitle: t.subtitle || null,
            ...outputPayload(t.ratio || meta.createDetail?.outputRatio || state.s3.outputRatio, t.output_size || meta.createDetail?.outputSize || state.s3.outputSize),
          };
        }
        if ((meta.taskType === 'digital_ad' || meta.taskType === 'space_guide' || meta.taskType === 'luxury_ad') && t) {
          meta.retryPayload = meta.retryPayload || {
            avatar_id: t.avatar_id || meta.createDetail?.avatarId || '',
            background_url: t.background_url || meta.createDetail?.backgroundUrl || meta.previewUrl || '',
            text: t.text || meta.createDetail?.text || meta.textPreview || '',
            title: t.title || meta.createDetail?.title || meta.avatarName || '素材审片',
            voice_id: t.voice_id || meta.createDetail?.voiceId || '',
            scene: t.scene || 'auto',
            camera: t.camera || 'auto',
            scene_prompt: t.scene_prompt || meta.createDetail?.scenePrompt || '',
            camera_prompt: t.camera_prompt || meta.createDetail?.cameraPrompt || '',
            duration_sec: t.duration_sec || meta.createDetail?.durationSec || 18,
            segments: t.segments || meta.createDetail?.segments || [],
            speech_segments: t.speech_segments || meta.createDetail?.speechSegments || [],
            keyframes: t.keyframes || meta.createDetail?.keyframes || [],
            clips: t.clips || meta.createDetail?.clips || [],
            guide_gender: t.guide_gender || meta.createDetail?.guideGender || 'female',
            subtitle: t.subtitle || meta.createDetail?.subtitle || null,
            generation_mode: t.generation_mode || spaceGuideGenerationMode(t.ad_mode === 'luxury_ad'),
            ad_mode: t.ad_mode || 'showroom_guide',
            ad_style: t.ad_style || 'luxury_soft',
            shot_count: t.shot_count || meta.createDetail?.shotCount || undefined,
            ...outputPayload(t.ratio || meta.createDetail?.outputRatio || '16:9', t.output_size || meta.createDetail?.outputSize || 'standard'),
          };
        }
        meta.snapshot = t;
        const isLuxuryTask = getTaskType(meta) === 'luxury_ad';
        const stageMap = {
          prepare_image: { name: '🖼️ 准备形象', sub: '上传/归一化图片' },
          prepare_audio: { name: '🎤 准备语音', sub: '语音准备中' },
          detecting:     { name: '🔍 主体检测', sub: '抠出人物' },
          submitting:    { name: '⚡ 提交渲染', sub: '排队中' },
          submitted:     { name: '⏳ 等待中', sub: '已提交，等服务端调度' },
          polling:       { name: '⏳ 等待中', sub: '渲染中，请稍候' },
          running:       { name: '🎨 渲染中', sub: `引擎状态 ${t.cv_status || '...'}` },
          storyboard:    { name: isLuxuryTask ? '🧩 生成剧本' : '🧩 生成分镜', sub: t.message || (isLuxuryTask ? '生成画面、动作、台词和目的' : '规划产品广告镜头') },
          keyframes:     { name: isLuxuryTask ? '🖼️ 生成分镜' : '🖼️ 生成关键帧', sub: t.message || (isLuxuryTask ? '生成每段分镜画面' : '固定商品和场景画面') },
          guide_keyframe:{ name: '🖼️ 生成导览预览', sub: t.message || '融合讲解员和空间背景' },
          guide_video:   { name: '🎬 生成讲解视频', sub: t.message || '驱动数字人一镜到底讲解' },
          video:         { name: '🎞️ 图生视频', sub: t.message || 'Seedance 正在生成镜头' },
          topview_i2v:   { name: '🎞️ 图生视频', sub: t.message || '正在生成动态镜头' },
          topview_i2v_error: { name: '⚠️ 图生视频生成失败', sub: t.message || '正在尝试备用图生视频模型' },
          topview_m2v:   { name: '🎬 生成广告视频', sub: t.message || 'Topview 正在合成广告' },
          ad_lip_sync:   { name: '🎙️ 生成口型视频', sub: t.message || '正在驱动口型和动作' },
          post_effects:  { name: '✨ 字幕/特效合成', sub: isLuxuryTask ? '正在合成配音、字幕和成片' : '正在烧录字幕' },
          done:          { name: '✅ 完成', sub: '' },
        };
        const elapsed = Math.round((Date.now() - start) / 1000);
        const stg = stageMap[t.stage] || { name: '⏳ 等待中', sub: '' };
        syncRunningTask(taskId, {
          ...meta,
          status: t.status || 'running',
          stage: t.stage || 'running',
          elapsed,
          videoUrl: t.video_url || t.videoUrl || meta.videoUrl,
          error: t.error || '',
          subtitleBurned: !!t.subtitle_burned,
          subtitleWarning: t.subtitle_warning || '',
          snapshot: t,
          scenes: t.scenes || meta.scenes || meta.createDetail?.scenes || [],
          keyframes: t.keyframes || meta.keyframes || meta.createDetail?.keyframes || [],
          clips: t.clips || t.clip_urls || meta.clips || meta.createDetail?.clips || [],
          createDetail: {
            ...(meta.createDetail || {}),
            scenes: t.scenes || meta.createDetail?.scenes || [],
            keyframes: t.keyframes || meta.createDetail?.keyframes || [],
            clips: t.clips || t.clip_urls || meta.createDetail?.clips || [],
            shotCount: t.shot_count || meta.createDetail?.shotCount || '',
          },
        });
        refreshTaskProgressModal();

        const doneVideoUrl = t.video_url || t.videoUrl;
        if (t.status === 'done' && doneVideoUrl) {
          clearInterval(meta.pollTimer);
          state.s3.runningTasks.delete(taskId);
          upsertVideoTask({
            ...meta,
            taskId,
            status: 'done',
            stage: 'done',
            elapsed,
            videoUrl: doneVideoUrl,
            subtitleBurned: !!t.subtitle_burned,
            subtitleWarning: t.subtitle_warning || '',
            scenes: t.scenes || meta.scenes || meta.createDetail?.scenes || [],
            keyframes: t.keyframes || meta.keyframes || meta.createDetail?.keyframes || [],
            clips: t.clips || t.clip_urls || meta.clips || meta.createDetail?.clips || [],
            createDetail: {
              ...(meta.createDetail || {}),
              scenes: t.scenes || meta.createDetail?.scenes || [],
              keyframes: t.keyframes || meta.createDetail?.keyframes || [],
              clips: t.clips || t.clip_urls || meta.createDetail?.clips || [],
              shotCount: t.shot_count || meta.createDetail?.shotCount || '',
            },
          });
          // 字幕状态提示（让用户知道字幕到底烧没烧上）
          let subtitleNote = '';
          if (t.subtitle_warning) {
            subtitleNote = `<div style="margin-top:6px;padding:8px 10px;background:rgba(255,77,109,0.10);border:1px solid var(--dh-error);border-radius:6px;font-size:12px;color:var(--dh-error)">⚠️ ${escapeHtml(t.subtitle_warning)}</div>`;
          } else if (t.subtitle_burned) {
            subtitleNote = `<div style="margin-top:6px;padding:6px 10px;background:rgba(33,255,243,0.06);border:1px solid var(--dh-primary);border-radius:6px;font-size:12px;color:var(--dh-primary)">✅ 字幕已烧录到视频</div>`;
          }
          if (box) box.innerHTML = `<div class="dh-render-stage">
            <div class="dh-render-stage-name">✅ 生成完成 · ${escapeHtml(meta.avatarName || '')}</div>
            <div class="dh-render-stage-sub">耗时 ${elapsed}s · 已自动保存到作品库</div>
          </div>
          <video class="dh-render-video" src="${doneVideoUrl}" controls playsinline></video>
          ${subtitleNote}
          <div style="display:flex;gap:6px;margin-top:8px">
            <a class="dh-btn dh-btn-ghost dh-btn-sm" href="${escapeHtml(withAuthQuery(doneVideoUrl))}" download>⬇ 下载</a>
            <button class="dh-btn dh-btn-ghost dh-btn-sm" data-tab-go="works">📚 作品库</button>
          </div>`;
          warmVideoPreviews([doneVideoUrl]);
          toast(`🎉 ${meta.avatarName || ''} 渲染完成`, 'success');
          return;
        }
        if (t.status === 'error') {
          clearInterval(meta.pollTimer);
          state.s3.runningTasks.delete(taskId);
          upsertVideoTask({
            ...meta,
            taskId,
            status: 'error',
            stage: t.stage || 'error',
            elapsed,
            error: t.error || '渲染失败',
          });
          if (box) box.innerHTML = `<div class="dh-render-stage">
            <div class="dh-render-stage-name" style="color:var(--dh-error)">❌ 渲染失败</div>
            <div class="dh-render-stage-sub">${escapeHtml(t.error || '')}</div>
          </div>`;
          toast(`渲染失败：${meta.avatarName || ''} · ${t.error || ''}`, 'error');
          return;
        }

        if (box) box.innerHTML = renderProgressPreview(stg.name, stg.sub || '正在生成预览效果', elapsed, meta);

        if (Date.now() - start > MAX) {
          clearInterval(meta.pollTimer);
          state.s3.runningTasks.delete(taskId);
          upsertVideoTask({
            taskId,
            status: 'timeout',
            stage: t.stage || 'timeout',
            elapsed,
            error: '轮询超时，可点击重新提交再跑一次。',
            retryPayload: meta.retryPayload || null,
          });
          toast(`${meta.avatarName || ''} 轮询超时，可重新提交`, 'error');
        }
      } catch (err) {
        console.warn('poll', err);
      }
    };
    tick();
    meta.pollTimer = setInterval(tick, 6000);
  }

  // 渲染"生成中"横幅 — 显示在 Step 3 顶部，列出所有 in-flight 任务
  function renderRunningTasksBanner() {
    document.getElementById('dhS3RunningBanner')?.remove();
    renderTaskCenter();
  }
  // 切到指定任务的进度框
  window._dhFocusRunning = function(taskId) {
    state.s3.taskId = taskId;
    switchTab('step3');
    renderRunningTasksBanner();
    // 让现有的 tick 立即写入主 box（下一次 6s 周期会写）— 同时手动触发一次
    const meta = state.s3.runningTasks.get(taskId);
    const t = meta?.snapshot;
    const box = $('#dhRenderBox');
    if (box && t) {
      const stageName = (s) => ({
        prepare_image:'🖼️ 准备形象', prepare_audio:'🎤 准备语音', detecting:'🔍 主体检测',
        submitting:'⚡ 提交渲染', submitted:'⏳ 等待中', polling:'⏳ 等待中',
        running:'🎨 渲染中', post_effects:'✨ 特效合成', done:'✅ 完成',
      }[s] || '⏳ 等待中');
      const elapsed = Math.round((Date.now() - (meta.startedAt || Date.now())) / 1000);
      box.innerHTML = renderProgressPreview(stageName(t.stage), `当前任务 · ${escapeHtml(meta.avatarName || '')}`, elapsed, meta);
    }
    const stored = readVideoTasks().find(t => String(t.taskId) === String(taskId));
    if (box && stored && !t) {
      if (stored.videoUrl) {
        box.innerHTML = `<div class="dh-render-stage">
          <div class="dh-render-stage-name">✅ 生成完成 · ${escapeHtml(stored.avatarName || '')}</div>
          <div class="dh-render-stage-sub">已自动保存到作品库</div>
        </div>
        <video class="dh-render-video" src="${escapeHtml(stored.videoUrl)}" controls playsinline></video>`;
        warmVideoPreviews([stored.videoUrl]);
      } else {
        box.innerHTML = renderProgressPreview(getTaskStatusText(stored.status), `${getTaskStageText(stored.stage, stored)} · ${escapeHtml(stored.avatarName || '')}`, stored.elapsed, stored);
      }
    }
  };

  // ══════════════ 双人对话 ══════════════
  function renderDualAvatars() {
    ['a', 'b'].forEach(role => {
      const host = $('#dhDual' + role.toUpperCase());
      if (!host) return;
      const a = state.dual['avatar' + role.toUpperCase()];
      if (!a) {
        host.innerHTML = `<div class="dh-selected-empty">
          <div class="dh-empty-icon">👤</div>
          <div>未选择</div>
          <button class="dh-link-btn" data-dual-pick="${role}">从「我的形象」选 →</button>
        </div>`;
      } else {
        const img = a.image_url || '';
        const video = a.sample_video_url;
        const media = video
          ? `<video src="${video}" autoplay muted loop playsinline preload="metadata" poster="${img || `/api/dh/my-avatars/${a.id}/thumbnail`}" onclick="this.paused?this.play():this.pause()" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<img src=&quot;${img || `/api/dh/my-avatars/${a.id}/thumbnail`}&quot;>')"></video>`
          : `<img src="${img}" alt="${escapeHtml(a.name)}">`;
        host.innerHTML = `${media}
          <div class="av-name">${escapeHtml(a.name)}</div>
          <button class="av-switch-btn" data-dual-pick="${role}">↻ 换一个</button>`;
      }
    });
    updateDualCount();
  }

  // ══════════════ 定制主持人弹窗 ══════════════
  function openHostModal(forRole) {
    state.hostModal.forRole = forRole;
    state.hostModal.pickA = null;
    state.hostModal.pickB = null;
    $('#dhPick1Name').textContent = '未选';
    $('#dhPick2Name').textContent = '未选';
    setHostMode('ai');
    $('#dhCustomHostModal').style.display = 'flex';
    renderHostPickGrid();
  }
  function closeHostModal() { $('#dhCustomHostModal').style.display = 'none'; }

  function setHostMode(mode) {
    state.hostModal.mode = mode;
    $$('[data-host-mode]').forEach(b => b.classList.toggle('active', b.dataset.hostMode === mode));
    $$('[data-host-mode-pane]').forEach(p => p.classList.toggle('active', p.dataset.hostModePane === mode));
  }

  function renderHostPickGrid() {
    const grid = $('#dhHostPickGrid');
    if (!grid) return;
    // 只展示视频素材
    const videos = state.myAvatars.filter(a => a.sample_video_url);
    if (!videos.length) {
      grid.innerHTML = `<div class="dh-empty" style="grid-column:1/-1">
        <div class="dh-empty-icon">🎬</div>
        <div class="dh-empty-text">尚无视频素材，先去"我的形象"生成几个</div>
      </div>`;
      return;
    }
    const pickedIds = [state.hostModal.pickA?.id, state.hostModal.pickB?.id];
    grid.innerHTML = videos.map(a => {
      const picked = pickedIds.includes(a.id);
      const img = a.image_url || '';
      return `<div class="dh-av-card ${picked ? 'pick-selected' : ''}" data-host-pick="${a.id}">
        <video src="${a.sample_video_url}" autoplay muted loop playsinline preload="metadata" poster="${img}" onclick="this.paused?this.play():this.pause()"></video>
        <div class="dh-av-card-meta">
          <div class="dh-av-card-name"><span>${escapeHtml(a.name)}</span></div>
          <div class="dh-av-card-sub">${a.gender === 'female' ? '女' : a.gender === 'male' ? '男' : ''}</div>
        </div>
      </div>`;
    }).join('');
  }

  function togglePickHost(avatarId) {
    const a = state.myAvatars.find(x => x.id === avatarId);
    if (!a) return;
    const h = state.hostModal;
    if (h.pickA?.id === avatarId) { h.pickA = null; }
    else if (h.pickB?.id === avatarId) { h.pickB = null; }
    else if (!h.pickA) { h.pickA = a; }
    else if (!h.pickB) { h.pickB = a; }
    else { h.pickB = a; } // 替换 B
    $('#dhPick1Name').textContent = h.pickA?.name || '未选';
    $('#dhPick2Name').textContent = h.pickB?.name || '未选';
    renderHostPickGrid();
  }

  function confirmPickHosts() {
    const { pickA, pickB } = state.hostModal;
    if (!pickA || !pickB) return toast('请选两位', 'error');
    state.dual.avatarA = pickA;
    state.dual.avatarB = pickB;
    closeHostModal();
    renderDualAvatars();
    toast(`A=${pickA.name} · B=${pickB.name}`, 'success');
  }

  async function generateAIHosts() {
    const genderCombo = $$('[data-host-gender]').find(b => b.classList.contains('active'))?.dataset.hostGender || 'mf';
    const age = $$('[data-host-age]').find(b => b.classList.contains('active'))?.dataset.hostAge || '青年';
    const description = $('#dhHostDesc').value.trim();
    const brand = $('#dhHostBrand').value.trim();

    $('#dhHostAIGenBtn').disabled = true;
    $('#dhHostGenLoading').style.display = 'block';
    try {
      const r = await api('/api/dh/dual/generate-hosts', {
        method: 'POST',
        body: { gender_combo: genderCombo, age, description, brand },
      });
      if (!r.success) throw new Error(r.error || '生成失败');
      state.dual.avatarA = r.hostA;
      state.dual.avatarB = r.hostB;
      // 刷新 my-avatars
      await loadMyAvatars();
      closeHostModal();
      renderDualAvatars();
      toast('🎉 两位主持人已生成（图片已存到"我的形象"）', 'success');
      // 提示需要升级为视频
      setTimeout(() => toast('提示：去"我的形象"把两位升级成视频素材，才能出对话视频', ''), 2500);
    } catch (err) {
      toast('失败：' + err.message, 'error');
    } finally {
      $('#dhHostAIGenBtn').disabled = false;
      $('#dhHostGenLoading').style.display = 'none';
    }
  }

  // ══════════════ 双人剧本解析为时间轴 ══════════════
  async function dualWriteScript() {
    const topic = $('#dhDualTopic').value.trim();
    if (!topic) return toast('请先填主题', 'error');
    const duration_sec = parseInt($('#dhDualDuration').value) || 60;
    $('#dhDualWriteBtn').disabled = true;
    try {
      const r = await api('/api/dh/dual/write-script', {
        method: 'POST',
        body: { topic, duration_sec },
      });
      if (!r.success) throw new Error(r.error);
      $('#dhDualScript').value = r.script;
      updateDualCount();
      toast('✨ 剧本生成完成', 'success');
    } catch (err) {
      toast('失败：' + err.message, 'error');
    } finally {
      $('#dhDualWriteBtn').disabled = false;
    }
  }

  function parseDualTimeline() {
    const script = $('#dhDualScript').value.trim();
    if (!script) return toast('先写剧本', 'error');
    // 按行拆；每行 A:/B: 是一段
    const segments = [];
    let cursor = 0;
    (script.split(/\r?\n/) || []).forEach(line => {
      const m = line.match(/^\s*([AaBb])\s*[:：]\s*(.+)$/);
      if (!m) return;
      const speaker = m[1].toUpperCase();
      const text = m[2].trim();
      if (!text) return;
      const dur = Math.max(2, Math.round(text.length / 4));
      segments.push({
        index: segments.length,
        speaker,
        text,
        start: cursor,
        end: cursor + dur,
        expression: 'natural',
        motion: 'natural speaking, subtle head movements, look at camera',
      });
      cursor += dur;
    });
    if (!segments.length) return toast('脚本需含 A:/B: 两种台词', 'error');
    state.dual.segments = segments;
    renderDualTimeline();
    toast(`🧩 已拆成 ${segments.length} 段 · 总时长 ${cursor}s`, 'success');
  }

  function renderDualTimeline() {
    const host = $('#dhDualTimelineBody');
    if (!host) return;
    host.innerHTML = state.dual.segments.map(s => `<div class="dh-tl-row" data-dual-seg-idx="${s.index}">
      <div class="dh-tl-time" style="color:${s.speaker === 'A' ? 'var(--dh-primary)' : '#ec4899'}">${s.speaker} · ${fmtTime(s.start)}-${fmtTime(s.end)}</div>
      <div class="dh-tl-text" contenteditable="true" data-dual-seg-text="${s.index}">${escapeHtml(s.text)}</div>
      <div class="dh-tl-motion" title="${escapeHtml(s.motion)}">${escapeHtml(s.expression)} · ${escapeHtml(s.motion).slice(0,40)}</div>
      <button class="dh-tl-edit" data-dual-edit-seg="${s.index}" title="改动作">✎</button>
    </div>`).join('');
    $('#dhDualTimeline').style.display = 'block';
  }

  function openDualMotionEditor(idx) {
    const seg = state.dual.segments[idx];
    if (!seg) return;
    $$('.dh-tl-row').forEach(r => r.classList.toggle('editing', parseInt(r.dataset.dualSegIdx) === idx));

    let pop = $('#dhMotionPopover');
    if (!pop) { pop = document.createElement('div'); pop.id = 'dhMotionPopover'; pop.className = 'dh-motion-popover'; document.body.appendChild(pop); }
    const activeId = ACTION_PRESETS.find(a => a.en === seg.motion)?.id;
    pop.innerHTML = `
      <div class="dh-motion-popover-title">第 ${idx + 1} 段（${seg.speaker}）· "${escapeHtml(seg.text.slice(0, 30))}..."</div>
      <div class="dh-motion-popover-title" style="margin-top:8px">常用动作</div>
      <div class="dh-motion-actions">
        ${ACTION_PRESETS.map(a => `<button class="dh-motion-action ${a.id === activeId ? 'active' : ''}" data-motion-preset="${a.id}">${a.name}</button>`).join('')}
      </div>
      <div class="dh-motion-popover-title">自定义（英文）</div>
      <input type="text" class="dh-input dh-motion-input" id="dhMotionCustom" value="${escapeHtml(seg.motion)}">
      <div class="dh-motion-popover-title" style="margin-top:10px">表情</div>
      <div class="dh-motion-actions">
        ${['natural','smile','serious','excited','calm'].map(ex => `<button class="dh-motion-action ${ex === seg.expression ? 'active' : ''}" data-expression="${ex}">${ex}</button>`).join('')}
      </div>
      <div class="dh-motion-foot">
        <button class="dh-btn dh-btn-ghost dh-btn-sm" id="dhMotionCancel">取消</button>
        <button class="dh-btn dh-btn-primary dh-btn-sm" id="dhDualMotionSave" data-dual-idx="${idx}">保存</button>
      </div>
    `;
    const row = $(`.dh-tl-row[data-dual-seg-idx="${idx}"]`);
    if (row) {
      const r = row.getBoundingClientRect();
      pop.style.top = Math.min(window.innerHeight - 420, r.bottom + 8) + 'px';
      pop.style.left = Math.max(8, Math.min(window.innerWidth - 380, r.right - 360)) + 'px';
    }
    pop.classList.add('show');
  }

  function saveDualMotion(idx) {
    const seg = state.dual.segments[idx];
    if (!seg) return;
    const pop = $('#dhMotionPopover');
    const custom = $('#dhMotionCustom').value.trim();
    const exprBtn = pop.querySelector('[data-expression].active');
    const motionBtn = pop.querySelector('[data-motion-preset].active');
    if (motionBtn) {
      const preset = ACTION_PRESETS.find(a => a.id === motionBtn.dataset.motionPreset);
      if (preset) seg.motion = preset.en;
    }
    if (custom) seg.motion = custom;
    if (exprBtn) seg.expression = exprBtn.dataset.expression;
    renderDualTimeline();
    closeMotionEditor();
    toast('已更新', 'success');
  }

  function updateDualSegText(idx, text) {
    const seg = state.dual.segments[idx];
    if (seg) seg.text = text.trim();
  }

  function parseDualScript(script) {
    const aLines = [], bLines = [];
    let current = null;
    (script || '').split(/\n/).forEach(line => {
      const m = line.match(/^\s*([AaBb])\s*[:：]\s*(.*)$/);
      if (m) {
        current = m[1].toUpperCase();
        const text = (m[2] || '').trim();
        if (text) (current === 'A' ? aLines : bLines).push(text);
      } else if (current && line.trim()) {
        (current === 'A' ? aLines : bLines).push(line.trim());
      }
    });
    return { aText: aLines.join('。'), bText: bLines.join('。') };
  }

  function updateDualCount() {
    const script = $('#dhDualScript')?.value || '';
    const { aText, bText } = parseDualScript(script);
    $('#dhDualCount').textContent = script.length;
    $('#dhDualACount').textContent = aText.length;
    $('#dhDualBCount').textContent = bText.length;
  }

  async function submitDual() {
    const a = state.dual.avatarA, b = state.dual.avatarB;
    if (!a) return toast('请选择 A 形象', 'error');
    if (!b) return toast('请选择 B 形象', 'error');
    const script = $('#dhDualScript').value.trim();
    if (!script) return toast('请写对白', 'error');
    const { aText, bText } = parseDualScript(script);
    if (!aText || !bText) return toast('脚本需同时包含 A: 和 B: 两种台词', 'error');

    const box = $('#dhDualRender');
    box.innerHTML = `<div class="dh-render-stage">
      <div class="dh-render-stage-name">📤 提交中</div>
      <div class="dh-render-stage-sub">为 A 和 B 同时调 Jimeng Omni…</div>
    </div>
    <div class="dh-gen-spinner" style="align-self:center;margin:8px auto"></div>`;

    try {
      const r = await api('/api/dh/dual/generate', {
        method: 'POST',
        body: {
          avatarA_id: a.id, avatarB_id: b.id,
          script,
          voice_a: state.s3.voiceId || null,
          voice_b: state.s3.voiceId || null,
          layout: state.dual.layout,
        },
      });
      if (!r.success) throw new Error(r.error || '提交失败');
      state.dual.taskId = r.taskId;
      pollDual(r.taskId);
    } catch (err) {
      box.innerHTML = `<div class="dh-render-stage"><div class="dh-render-stage-name" style="color:var(--dh-error)">❌ 失败</div><div class="dh-render-stage-sub">${escapeHtml(err.message)}</div></div>`;
      toast('失败：' + err.message, 'error');
    }
  }

  async function pollDual(taskId) {
    clearInterval(state.dual.pollTimer);
    const start = Date.now();
    const MAX = 15 * 60 * 1000;
    const box = $('#dhDualRender');
    const tick = async () => {
      try {
        const r = await api('/api/dh/dual/tasks/' + taskId);
        if (!r?.success) return;
        const t = r.task;
        const elapsed = Math.round((Date.now() - start) / 1000);
        if (t.status === 'done' && t.video_url) {
          clearInterval(state.dual.pollTimer);
          box.innerHTML = `<div class="dh-render-stage"><div class="dh-render-stage-name">✅ 完成</div><div class="dh-render-stage-sub">耗时 ${elapsed}s · 已保存到作品库</div></div>
            <video class="dh-render-video" src="${t.video_url}" controls playsinline></video>
            <div style="display:flex;gap:6px;margin-top:8px"><a class="dh-btn dh-btn-ghost dh-btn-sm" href="${escapeHtml(withAuthQuery(t.video_url))}" download>⬇ 下载</a><button class="dh-btn dh-btn-ghost dh-btn-sm" data-tab-go="works">📚 作品库</button></div>`;
          warmVideoPreviews([t.video_url]);
          toast('🎉 双人视频完成', 'success');
          return;
        }
        if (t.status === 'error') {
          clearInterval(state.dual.pollTimer);
          box.innerHTML = `<div class="dh-render-stage"><div class="dh-render-stage-name" style="color:var(--dh-error)">❌ 失败</div><div class="dh-render-stage-sub">${escapeHtml(t.error || '')}</div></div>`;
          return;
        }
        const stageMap = {
          submitting_a: '🎭 A 提交中', submitting_b: '🎭 B 提交中',
          rendering_a: '🎨 A 渲染中', rendering_b: '🎨 B 渲染中',
          rendering_both: '🎨 AB 并行渲染',
          composing: '🎬 FFmpeg 合成中',
        };
        box.innerHTML = `<div class="dh-render-stage"><div class="dh-render-stage-name">${stageMap[t.stage] || t.stage || '渲染中…'}</div><div class="dh-render-stage-sub">已用 ${elapsed}s</div></div><div class="dh-gen-spinner" style="align-self:center;margin:10px auto"></div>`;
        if (Date.now() - start > MAX) { clearInterval(state.dual.pollTimer); toast('超时', 'error'); }
      } catch (err) { console.warn('dual poll', err); }
    };
    tick();
    state.dual.pollTimer = setInterval(tick, 6000);
  }

  // ══════════════ 作品库 ══════════════
  async function loadWorks() {
    try {
      const r = await api('/api/dh/videos/tasks');
      // 只保留 Step 3 生成的数字人正片（production / digital_human）；
      // Step 1 的"动态预览样片"、上传形象的 promote 样片 (kind=sample) 不计入作品库。
      const allWithVideo = (r?.data || []).filter(t => t.videoUrl || t.video_url || t.local_path);
      const productions = allWithVideo.filter(t => {
        const kind = t.kind || 'production';
        return kind !== 'sample';
      });
      const grid = $('#dhWorksGrid');
      if (!productions.length) {
        grid.className = 'dh-avatar-grid';
        grid.innerHTML = `<div class="dh-empty"><div class="dh-empty-icon">🎬</div>
          <div class="dh-empty-text">还没有作品</div>
          <div class="dh-empty-sub">去第三步生成一个</div></div>`;
        return;
      }
      grid.className = 'dh-works-container';

      const renderCard = (t) => {
        const url = t.videoUrl || t.video_url;
        const tokenQ = state.token ? ('?token=' + encodeURIComponent(state.token)) : '';
        const onDemandPoster = `/api/dh/videos/tasks/${t.id}/thumbnail${tokenQ}`;
        const poster = t.thumbnail_url || t.imageUrl || t.image_url || onDemandPoster;
        const title = t.title || '未命名';
        const when = t.created_at ? new Date(t.created_at).toLocaleString('zh-CN') : '';
        const posterUrl = poster ? withAuthQuery(poster) : '';
        // 字幕状态徽章
        let subBadge = '';
        if (t.subtitle_warning) {
          subBadge = `<span style="display:inline-block;padding:1px 6px;background:rgba(255,77,109,0.15);border:1px solid var(--dh-error);color:var(--dh-error);border-radius:4px;font-size:10px;margin-left:6px" title="${escapeHtml(t.subtitle_warning)}">⚠️ 字幕失败</span>`;
        } else if (t.subtitle_burned) {
          subBadge = `<span style="display:inline-block;padding:1px 6px;background:rgba(33,255,243,0.10);border:1px solid var(--dh-primary);color:var(--dh-primary);border-radius:4px;font-size:10px;margin-left:6px">📝 含字幕</span>`;
        }
        return `<div class="dh-av-card">
          <button type="button" class="dh-work-cover" data-work-preview="${escapeHtml(t.id)}" title="点击播放">
            ${posterUrl ? `<img src="${escapeHtml(posterUrl)}" alt="${escapeHtml(title)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.closest('.dh-work-cover').classList.add('is-missing');this.remove()">` : ''}
            <span class="dh-work-cover-missing">封面生成中</span>
            <span class="dh-work-play">▶</span>
          </button>
          <div class="dh-av-card-meta">
            <div class="dh-av-card-name"><span>${escapeHtml(title)}</span>${subBadge}</div>
            <div class="dh-av-card-sub">${when}</div>
          </div>
          <div class="dh-av-card-actions">
            <a class="dh-btn dh-btn-ghost dh-btn-sm" href="${escapeHtml(workDownloadUrl(t, url))}" download style="flex:1;justify-content:center">⬇ 下载</a>
            <button class="dh-btn dh-btn-ghost dh-btn-sm" data-act="work-delete" data-work-id="${t.id}" title="删除">🗑️</button>
          </div>
        </div>`;
      };

      let html = '';
      html += `<div class="dh-section-title"><h2>🎬 数字人作品（${productions.length}）</h2>
        <span style="font-size:12px;color:var(--dh-text-muted)">Step 3 · 正式成片</span></div>
        <div class="dh-avatar-grid">${productions.map(renderCard).join('')}</div>`;
      grid.innerHTML = html;
    } catch (err) {
      console.warn(err);
    }
  }

  async function deleteWork(id) {
    const ok = await DhConfirm({
      title: '🗑 删除作品',
      message: '确定删除这个作品？',
      detail: '同时删除视频文件，不可恢复',
      confirmText: '永久删除',
      type: 'danger',
    });
    if (!ok) return;
    try {
      const r = await api('/api/dh/videos/tasks/' + id, { method: 'DELETE' });
      if (!r.success) throw new Error(r.error || '删除失败');
      toast('已删除', 'success');
      loadWorks();
    } catch (err) {
      toast('删除失败：' + err.message, 'error');
    }
  }

  // ══════════════ 声音克隆 ══════════════
  let vcBindDone = false;
  function bindVoiceCloneUpload() {
    if (vcBindDone) return;
    const zone = $('#dhVcUpload');
    const input = $('#dhVcFile');
    if (!zone || !input) return;
    vcBindDone = true;
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if (f) setVcFile(f);
    });
    input.addEventListener('change', () => { const f = input.files[0]; if (f) setVcFile(f); });
  }
  function setVcFile(file) {
    if (!/^audio\//.test(file.type) && !/\.(mp3|wav|m4a|ogg)$/i.test(file.name)) return toast('仅支持音频', 'error');
    if (file.size > 50 * 1024 * 1024) return toast('超过 50MB', 'error');
    state.voiceClone.file = file;
    $('#dhVcPreview').style.display = 'block';
    const url = URL.createObjectURL(file);
    $('#dhVcAudio').src = url;
    $('#dhVcFileInfo').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
  }

  async function submitVoiceClone() {
    const name = $('#dhVcName').value.trim();
    if (!name) return toast('请输入声音名称', 'error');
    const file = state.voiceClone.file;
    if (!file) return toast('请上传音频', 'error');
    const gender = $$('[data-vc-gender]').find(b => b.classList.contains('active'))?.dataset.vcGender || 'female';
    // 上传时附带严格朗读的参考文本，帮助阿里定制音色对齐训练
    const referenceText = $('#dhVcScript')?.textContent?.trim() || '';

    $('#dhVcSubmit').disabled = true;
    $('#dhVcSubmit').textContent = '🎙️ 克隆中（1-3 分钟）…';
    const fd = new FormData();
    fd.append('audio', file);
    fd.append('name', name);
    fd.append('gender', gender);
    if (referenceText) fd.append('reference_text', referenceText);
    try {
      const r = await fetch('/api/workbench/upload-voice', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + state.token },
        body: fd,
      });
      const data = await r.json();
      if (!data?.success) throw new Error(data?.error || '克隆失败');
      if (data.training) {
        toast(`⏳ 阿里 CosyVoice 2 已提交异步训练（task=${(data.aliyun_task_id||'').slice(0,8)}…），约 3-15 分钟完成，列表会自动刷新`, 'success');
      } else if (data.cloned) {
        toast(`🎉 克隆成功（${data.cloneProvider}）· 已滚动到「我的克隆声音」板块，点 🔊 测试声音听效果`, 'success');
        // 自动滚到克隆列表板块
        setTimeout(() => {
          const target = $('#dhVoiceCloneList');
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      } else {
        // 把三家具体错因呈给用户，别再只说"占位失败"
        const reasons = (data.tried || []).map(t => `· ${t.id}: ${t.error || '未知'}`).join('\n');
        const msg = '⚠️ 三家克隆全部失败：\n' + reasons + '\n\n解决：拿阿里 sk-* 或 火山 appId:accessToken';
        alert(msg);
        toast('三家克隆都失败了，详情见弹窗', 'error');
      }
      state.voiceClone.file = null;
      $('#dhVcFile').value = '';
      $('#dhVcName').value = '';
      $('#dhVcPreview').style.display = 'none';
      loadVoiceClones();
    } catch (err) {
      toast('失败：' + err.message, 'error');
    } finally {
      $('#dhVcSubmit').disabled = false;
      $('#dhVcSubmit').textContent = '🎤 开始克隆';
    }
  }

  async function loadVoiceClones({ skipImmediateRefresh = false } = {}) {
    try {
      const r = await fetch('/api/workbench/voices', { headers: { Authorization: 'Bearer ' + state.token } });
      const data = await r.json();
      // 包含所有非 ready 的状态（training/training_timeout/aliyun_failed/volc_failed）让用户能看到状态
      state.voiceClone.list = (data?.voices || []).filter(v =>
        v.cloned || v.status === 'training' || v.status === 'training_timeout'
        || v.status === 'aliyun_failed' || v.status === 'volc_failed'
        || v.aliyun_task_id || v.volc_speaker_id
      );
      renderVoiceClones();

      const hasTraining = state.voiceClone.list.some(v => v.status === 'training' && !v.aliyun_voice_id);
      const hasVolcTraining = state.voiceClone.list.some(v => v.status === 'training' && v.volc_speaker_id);

      // 首次加载时如果有训练中的记录 → 立刻打一次远端状态查询，不等 30s 轮询，
      // 避免已经 ready 的卡片一直挂"训练中"文案。
      if ((hasTraining || hasVolcTraining) && !skipImmediateRefresh) {
        await refreshTrainingStatuses();
        // refresh 完再拉一次列表，拿到最新 status 后用 skipImmediateRefresh 避免递归
        return loadVoiceClones({ skipImmediateRefresh: true });
      }

      if ((hasTraining || hasVolcTraining) && !state.voiceClone._pollTimer) {
        state.voiceClone._pollTimer = setInterval(async () => {
          await refreshTrainingStatuses();
          await loadVoiceClones({ skipImmediateRefresh: true });
        }, 30000);
      } else if (!hasTraining && !hasVolcTraining && state.voiceClone._pollTimer) {
        clearInterval(state.voiceClone._pollTimer);
        state.voiceClone._pollTimer = null;
      }
    } catch (err) { console.warn('loadVoiceClones', err); }
  }

  async function refreshTrainingStatuses() {
    const training = (state.voiceClone.list || []).filter(v => v.status === 'training');
    for (const v of training) {
      try {
        // 阿里走 refresh-status，火山走 refresh-volc-status
        const endpoint = v.clone_provider === 'volcengine' || v.volc_speaker_id
          ? 'refresh-volc-status'
          : 'refresh-status';
        await fetch('/api/workbench/voices/' + v.id + '/' + endpoint, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + state.token },
        });
      } catch {}
    }
  }

  function _providerLabel(v) {
    if (v.aliyun_voice_id) return '☁️ 阿里 CosyVoice 定制音色（永久 voice_id · 真克隆 · 优先使用）';
    if (v.volc_speaker_id && v.status === 'ready') return '🌋 火山 ICL 2.0 旧版（speaker_id=' + String(v.volc_speaker_id).slice(0, 16) + '）· 可升级到阿里';
    if (v.volc_speaker_id && v.status === 'training') return '⏳ 火山 ICL 2.0 训练中…（约 5-15 分钟）';
    if (v.volc_speaker_id) return '🌋 火山 ICL 2.0 旧版（speaker_id=' + String(v.volc_speaker_id).slice(0, 16) + '）';
    if (v.status === 'training') return '⏳ 阿里定制音色训练中…（约 3-15 分钟，完成后自动刷新）';
    if (v.clone_provider === 'aliyun-zeroshot' || v.aliyun_mode === 'zeroshot') return '⚠️ 非真克隆（阿里零样本降级已废弃 · 请删除重传走火山）';
    return '已克隆';
  }

  function renderVoiceClones() {
    const host = $('#dhVoiceCloneList');
    const cnt = $('#dhVoiceCloneCount');
    const tabCnt = document.getElementById('dhVcTabCount');
    const list = state.voiceClone.list;
    if (cnt) cnt.textContent = list.length;
    if (tabCnt) tabCnt.textContent = list.length;
    if (!host) return;
    if (!list.length) {
      host.innerHTML = `<div class="dh-empty"><div class="dh-empty-icon">🎙️</div><div class="dh-empty-text">还没有克隆声音</div><div class="dh-empty-sub">上传录音开始克隆</div></div>`;
      return;
    }
    host.innerHTML = list.map(v => {
      const isZeroshot = v.clone_provider === 'aliyun-zeroshot' || v.aliyun_mode === 'zeroshot';
      const isFailed = ['training_timeout', 'aliyun_failed', 'volc_failed'].includes(v.status);
      const isReal = !!(v.aliyun_voice_id || (v.volc_speaker_id && v.status === 'ready'));
      const isReady = isReal && !isFailed;
      const isTraining = v.status === 'training' && !isReady && !isFailed;
      const failBadge = v.status === 'training_timeout' ? '❌ 训练超时'
        : v.status === 'aliyun_failed' ? '❌ 阿里训练失败'
        : v.status === 'volc_failed' ? '❌ 火山训练失败'
        : '❌ 失败';
      const statusHtml = isZeroshot
        ? `<div class="dh-vc-status err" style="background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid #ef4444">⚠️ 非真克隆</div>`
        : isFailed
        ? `<div class="dh-vc-status err" style="background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid #ef4444" title="${escapeHtml(v.last_error || '')}">${failBadge}</div>`
        : isTraining
        ? `<div class="dh-vc-status pending">⏳ 训练中</div>`
        : `<div class="dh-vc-status ok">✓ 可用</div>`;
      const testBtnAttrs = isReady
        ? `data-vc-preview="${v.id}"`
        : isFailed
        ? `disabled title="${escapeHtml(v.last_error || '训练失败')}"`
        : 'disabled title="此记录不是真克隆，请点🗑 删除后重新上传走火山声音复刻"';
      const genderLabel = v.gender === 'male' ? '♂ 男' : '♀ 女';
      return `<div class="dh-vc-card ${isReady ? 'cloned' : 'pending'}" data-vc-id="${v.id}">
      <div class="dh-vc-head">
        <div class="dh-vc-name" style="display:flex;align-items:center;gap:8px">
          <span>🎤 ${escapeHtml(v.name || '未命名')}</span>
          <button data-vc-edit="${v.id}" title="编辑名称/性别" style="background:transparent;border:0;color:var(--dh-text-muted);cursor:pointer;font-size:13px;padding:2px 6px;border-radius:4px">✎</button>
        </div>
        ${statusHtml}
      </div>
      <div class="dh-vc-provider">${genderLabel}</div>
      <audio class="dh-vc-audio" src="/api/workbench/voices/${v.id}/play?token=${encodeURIComponent(state.token)}" controls preload="none"></audio>
      ${isZeroshot ? `<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);padding:10px 12px;border-radius:8px;font-size:12px;color:#ef4444;margin-top:8px;line-height:1.6">
        ⚠️ <b>这条记录不是真克隆</b><br>
        当初阿里 DashScope 账户没开 voice_customization 权限，代码降级到"零样本兜底"——但实际上 DashScope 没有真正的零样本 API，合成出来的是默认预设音色在念文本，不是你的声音。<br>
        <b>请点下方 🗑 删除</b>，然后重新上传录音。这次火山预分配槽位 S_v9sfomt02 会生效，合成出来就是你的真声音。
      </div>` : ''}
      ${isFailed ? `<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);padding:10px 12px;border-radius:8px;font-size:12px;color:#ef4444;margin-top:8px;line-height:1.6">
        ❌ <b>克隆训练失败</b><br>
        ${escapeHtml(v.last_error || '训练超时或服务端错误')}<br>
        点右下 <b>🔁 重新上传</b> 保持原名称/性别直接重试，或 <b>🗑 删除</b> 彻底清掉。如多次失败可检查阿里/火山 API Key 配置。
      </div>` : ''}
      <div style="font-size:11px;color:var(--dh-text-muted);margin-top:6px">🔊 测试声音：输入任意文字，用你的音色朗读出来（默认 0.85 倍速，中文自然语速）</div>
      <div class="dh-vc-preview-input">
        <input type="text" placeholder="输入要测试的文字（例如：大家好，我是小明）" data-vc-preview-text="${v.id}" ${isReady ? '' : 'disabled'}>
        <button ${testBtnAttrs} style="background:var(--dh-gradient);color:#0D0E12;border:0;font-weight:600">🔊 测试声音</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11px;color:var(--dh-text-muted)">
        <span>语速</span>
        <input type="range" min="0.5" max="1.5" step="0.05" value="0.85" data-vc-speed="${v.id}" style="flex:1;accent-color:var(--dh-primary)" ${isReady ? '' : 'disabled'}>
        <span data-vc-speed-label="${v.id}" style="font-family:monospace;min-width:3em;text-align:right">0.85×</span>
      </div>
      <div class="dh-vc-actions">
        ${isFailed ? `<button data-vc-retry-same="${v.id}" style="background:var(--dh-gradient);color:#0D0E12;border:0;font-weight:600" title="用之前上传的录音文件再次提交克隆 API，无需重选文件">🔁 重试训练</button><button data-vc-retry-newfile="${v.id}" title="重新选择音频文件并上传">📁 换新文件</button>` : ''}
        ${v.volc_speaker_id && !v.aliyun_voice_id && !isFailed ? `<button data-vc-reclone-aliyun="${v.id}" style="background:linear-gradient(135deg,#10b981,#21fff3);color:#0D0E12;border:0;font-weight:600" title="用阿里 CosyVoice 重新复刻这条录音，完成后会优先使用阿里">☁️ 升级到阿里</button>` : ''}
        <button data-vc-delete="${v.id}">🗑 删除</button>
      </div>
    </div>`;
    }).join('');
  }

  // 用同份录音文件再次提交克隆（不重新选文件 — 解决"重新上传"歧义）
  async function retryWithSameAudio(id) {
    const v = state.voiceClone.list.find(x => x.id === id);
    if (!v) return toast('找不到该记录', 'error');
    const ok = await DhConfirm({
      title: '🔁 重试训练',
      message: `用「${escapeHtml(v.name)}」之前上传的录音文件重新提交训练`,
      detail: '不需要重选文件，直接调阿里 CosyVoice 同步复刻',
      confirmText: '开始重试',
      type: 'primary',
    });
    if (!ok) return;
    toast('⏳ 正在用原录音重新调阿里 CosyVoice 复刻...');
    try {
      const r = await fetch(`/api/workbench/voices/${id}/reclone-aliyun`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || '失败');
      toast(`✅ 重试成功！voice_id=${d.aliyun_voice_id?.slice(0,32)}...`, 'success');
      loadVoiceClones();
    } catch (err) {
      toast('重试失败：' + err.message, 'error');
    }
  }

  // 把火山旧版 voice 升级到阿里：用同一录音文件重跑阿里 CosyVoice 复刻
  async function recloneWithAliyun(id) {
    const v = state.voiceClone.list.find(x => x.id === id);
    if (!v) return toast('找不到该克隆记录', 'error');
    const ok = await DhConfirm({
      title: '☁️ 升级到阿里 CosyVoice',
      message: `将「${escapeHtml(v.name)}」用阿里 CosyVoice 重新复刻`,
      detail: '不会删除火山的 speaker_id，只是新增阿里 voice_id 并优先使用',
      confirmText: '开始升级',
      type: 'primary',
    });
    if (!ok) return;
    toast('⏳ 正在用阿里 CosyVoice 复刻...');
    try {
      const r = await fetch(`/api/workbench/voices/${id}/reclone-aliyun`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || '失败');
      toast(`✅ 升级成功！现在用阿里 voice_id=${d.aliyun_voice_id?.slice(0,32)}...`, 'success');
      loadVoiceClones();
    } catch (err) {
      toast('升级失败：' + err.message, 'error');
    }
  }

  // 失败卡片"重新上传"：保持原 name/gender，触发文件选择器 → 删旧记录 → 重走克隆流程
  function retryFailedVoice(id) {
    const voice = state.voiceClone.list.find(v => v.id === id);
    if (!voice) return toast('找不到该克隆记录', 'error');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = async () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) return;
      if (!/^audio\//.test(file.type) && !/\.(mp3|wav|m4a|ogg)$/i.test(file.name)) return toast('仅支持音频', 'error');
      if (file.size > 50 * 1024 * 1024) return toast('超过 50MB', 'error');

      // 先删掉旧的失败记录（不可恢复，但旧记录已失败没价值）
      try {
        await fetch('/api/workbench/voices/' + id, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + state.token },
        });
      } catch {}

      // 再用原 name/gender 重新上传
      const fd = new FormData();
      fd.append('audio', file);
      fd.append('name', voice.name || '我的声音');
      fd.append('gender', voice.gender || 'female');
      const referenceText = $('#dhVcScript')?.textContent?.trim();
      if (referenceText) fd.append('reference_text', referenceText);

      toast('🔁 正在重新上传并提交克隆…', '');
      try {
        const r = await fetch('/api/workbench/upload-voice', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + state.token },
          body: fd,
        });
        const data = await r.json();
        if (!data?.success) throw new Error(data?.error || '克隆失败');
        if (data.training) {
          toast(`⏳ 已重新提交阿里训练（task=${(data.aliyun_task_id||'').slice(0,8)}…），3-15 分钟完成自动刷新`, 'success');
        } else if (data.cloned) {
          toast(`🎉 克隆成功（${data.cloneProvider}）`, 'success');
        } else {
          const reasons = (data.tried || []).map(t => `· ${t.id}: ${t.error || '未知'}`).join('\n');
          alert('⚠️ 三家克隆全部失败：\n' + reasons);
        }
        loadVoiceClones();
      } catch (err) {
        toast('重传失败：' + err.message, 'error');
      }
    };
    input.click();
  }

  async function previewClonedVoice(id) {
    stopAudibleMedia({ reset: true });
    const input = document.querySelector(`[data-vc-preview-text="${id}"]`);
    const text = input?.value?.trim() || '你好，这是我的克隆声音测试';
    const speedEl = document.querySelector(`[data-vc-speed="${id}"]`);
    const speed = speedEl ? parseFloat(speedEl.value) : 0.85;
    toast(`🔊 合成测试中（${speed}× 速度，约 2-5 秒）…`);
    try {
      const r = await fetch('/api/workbench/voices/' + id + '/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
        body: JSON.stringify({ text, speed }),
      });
      if (!r.ok) {
        let errMsg = 'HTTP ' + r.status;
        try { const j = await r.json(); if (j?.error) errMsg = j.error; } catch {}
        throw new Error(errMsg);
      }
      const ct = r.headers.get('content-type') || '';
      if (!ct.startsWith('audio/')) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || '服务端未返回音频');
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = markDetachedAudio(new Audio(url));
      audio.onended = () => URL.revokeObjectURL(url);
      audio.play();
      toast('🔊 播放中', 'success');
    } catch (err) {
      const msg = err.message || '未知错误';
      // 账号资源未开通是火山常见硬错（仅能通过控制台开通），用 alert 呈现完整原因 + 跳转指引。
      if (/not granted|resource not granted|未开通|3001|声音复刻合成/.test(msg)) {
        toast('测试失败（账号未开通火山声音复刻合成资源）', 'error');
        const go = confirm(
          '🛑 火山账号没有"声音复刻合成"资源，合成被火山服务器拒绝（HTTP 403 / code=3001）。\n\n' +
          '完整返回：\n' + msg + '\n\n' +
          '解决：去火山引擎控制台 → 语音技术 → 声音复刻 → 资源包，开通/购买"合成"资源包。\n\n' +
          '训练资源和合成资源是两个独立购买项。你的账号目前只开了训练，没开合成。\n\n' +
          '点"确定"打开火山控制台页面，"取消"留在当前页。'
        );
        if (go) window.open('https://console.volcengine.com/speech/service/8', '_blank');
        return;
      }
      toast('测试失败：' + msg, 'error');
    }
  }

  function openVoiceCloneEditDialog(v) {
    return new Promise(resolve => {
      const old = document.getElementById('__dh_voice_edit_mask');
      if (old) old.remove();
      const currentGender = v.gender === 'male' ? 'male' : 'female';
      const mask = document.createElement('div');
      mask.id = '__dh_voice_edit_mask';
      mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);backdrop-filter:blur(5px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px';
      mask.innerHTML = `
        <div style="width:100%;max-width:480px;background:#141519;border:1px solid #2D3038;border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,0.55);overflow:hidden" onclick="event.stopPropagation()">
          <div style="padding:18px 22px;border-bottom:1px solid #2D3038;display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:16px;font-weight:800;color:#E8EAED">编辑克隆声音</div>
              <div style="font-size:12px;color:#7D8596;margin-top:4px">修改后会同步到数字人生成功能里的音色列表</div>
            </div>
            <button id="__dhVoiceEditClose" type="button" style="width:32px;height:32px;border:1px solid #2D3038;border-radius:8px;background:#1E2025;color:#B8BCC4;cursor:pointer;font-size:18px">×</button>
          </div>
          <div style="padding:20px 22px 4px">
            <label style="display:block;font-size:12px;font-weight:700;color:#B8BCC4;margin-bottom:8px">声音名称</label>
            <input id="__dhVoiceEditName" type="text" maxlength="30" value="${escapeHtml(v.name || '')}" placeholder="例如：温柔女声"
              style="width:100%;box-sizing:border-box;background:#0D0E12;border:1px solid #2D3038;color:#E8EAED;padding:12px 14px;border-radius:10px;font-size:14px;outline:none" />
            <div style="display:flex;align-items:center;justify-content:space-between;margin:16px 0 8px">
              <label style="font-size:12px;font-weight:700;color:#B8BCC4">性别</label>
              <span style="font-size:11px;color:#6B7280">用于分组和默认推荐</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <button type="button" data-voice-edit-gender="female" style="padding:14px;border-radius:10px;border:1px solid ${currentGender === 'female' ? '#21FFF3' : '#2D3038'};background:${currentGender === 'female' ? 'rgba(33,255,243,0.09)' : '#0D0E12'};color:${currentGender === 'female' ? '#21FFF3' : '#B8BCC4'};cursor:pointer;text-align:left">
                <div style="font-size:15px;font-weight:800">♀ 女声</div>
                <div style="font-size:11px;color:#7D8596;margin-top:4px">温柔、清亮、知性</div>
              </button>
              <button type="button" data-voice-edit-gender="male" style="padding:14px;border-radius:10px;border:1px solid ${currentGender === 'male' ? '#21FFF3' : '#2D3038'};background:${currentGender === 'male' ? 'rgba(33,255,243,0.09)' : '#0D0E12'};color:${currentGender === 'male' ? '#21FFF3' : '#B8BCC4'};cursor:pointer;text-align:left">
                <div style="font-size:15px;font-weight:800">♂ 男声</div>
                <div style="font-size:11px;color:#7D8596;margin-top:4px">沉稳、磁性、清晰</div>
              </button>
            </div>
            <div id="__dhVoiceEditErr" style="min-height:18px;margin-top:10px;font-size:12px;color:#FF5470"></div>
          </div>
          <div style="padding:16px 22px 20px;display:flex;justify-content:flex-end;gap:10px">
            <button class="dh-btn dh-btn-ghost" type="button" id="__dhVoiceEditCancel">取消</button>
            <button class="dh-btn dh-btn-primary" type="button" id="__dhVoiceEditSave">保存修改</button>
          </div>
        </div>`;
      let gender = currentGender;
      const close = value => { mask.remove(); resolve(value); };
      const updateGender = next => {
        gender = next;
        mask.querySelectorAll('[data-voice-edit-gender]').forEach(btn => {
          const active = btn.dataset.voiceEditGender === gender;
          btn.style.borderColor = active ? '#21FFF3' : '#2D3038';
          btn.style.background = active ? 'rgba(33,255,243,0.09)' : '#0D0E12';
          btn.style.color = active ? '#21FFF3' : '#B8BCC4';
        });
      };
      const save = () => {
        const name = mask.querySelector('#__dhVoiceEditName').value.trim().slice(0, 30);
        const err = mask.querySelector('#__dhVoiceEditErr');
        if (!name) {
          err.textContent = '声音名称不能为空';
          mask.querySelector('#__dhVoiceEditName').focus();
          return;
        }
        close({ name, gender });
      };
      mask.addEventListener('click', e => { if (e.target === mask) close(null); });
      mask.querySelector('#__dhVoiceEditClose').onclick = () => close(null);
      mask.querySelector('#__dhVoiceEditCancel').onclick = () => close(null);
      mask.querySelector('#__dhVoiceEditSave').onclick = save;
      mask.querySelectorAll('[data-voice-edit-gender]').forEach(btn => {
        btn.addEventListener('click', () => updateGender(btn.dataset.voiceEditGender));
      });
      mask.querySelector('#__dhVoiceEditName').addEventListener('keydown', e => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') close(null);
      });
      document.body.appendChild(mask);
      setTimeout(() => {
        const input = mask.querySelector('#__dhVoiceEditName');
        input.focus();
        input.select();
      }, 50);
    });
  }

  async function editVoiceClone(id) {
    const v = state.voiceClone.list.find(x => x.id === id);
    if (!v) return toast('找不到该声音', 'error');
    const result = await openVoiceCloneEditDialog(v);
    if (!result) return;
    try {
      const r = await fetch('/api/workbench/voices/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
        body: JSON.stringify(result),
      });
      const data = await r.json();
      if (!data?.success) throw new Error(data?.error || '更新失败');
      toast('已更新', 'success');
      loadVoiceClones();
    } catch (err) {
      toast('失败：' + err.message, 'error');
    }
  }

  async function deleteVoiceClone(id) {
    const ok = await DhConfirm({
      title: '🗑 删除克隆声音',
      message: '删除这个克隆声音？',
      detail: '不可恢复，已用此声音生成的视频不受影响',
      confirmText: '永久删除',
      type: 'danger',
    });
    if (!ok) return;
    try {
      const r = await fetch('/api/workbench/voices/' + id, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + state.token },
      });
      const data = await r.json();
      if (!data?.success) throw new Error(data?.error || '删除失败');
      toast('已删除', 'success');
      loadVoiceClones();
    } catch (err) {
      toast('失败：' + err.message, 'error');
    }
  }

  // ══════════════ Aliyun Token 管理 ══════════════
  async function loadAliyunTokenCard() {
    const view = $('#dhAliyunTokenView');
    const time = $('#dhAliyunTokenTime');
    const subtitle = $('#dhAliyunTokenSubtitle');
    if (!view) return;
    try {
      const r = await fetch('/api/dh/aliyun-token/view', { headers: { Authorization: 'Bearer ' + state.token } });
      const d = await r.json();
      if (d?.success) {
        view.textContent = d.token_preview || '(未设置)';
        const isPermanent = d.token_type === 'dashscope' || d.token_type === 'unknown';
        if (subtitle) {
          subtitle.innerHTML = isPermanent
            ? '· <span style="color:#10b981">DashScope sk-* API Key · 永久有效</span>'
            : '· <span style="color:#f59e0b">⚠ 旧版 NLS AccessToken（24h 过期）· 建议改用智能语音 2.0 sk-* Key</span>';
        }
        if (d.updated_at) {
          const dt = new Date(d.updated_at);
          if (isPermanent) {
            time.innerHTML = dt.toLocaleString('zh-CN') + ` · <span style="color:#10b981">永久有效</span>`;
          } else {
            const hoursAgo = Math.floor((Date.now() - dt.getTime()) / 3600000);
            time.innerHTML = dt.toLocaleString('zh-CN') + (hoursAgo >= 24 ? ` <span style="color:#ef4444">❌ 已过期 ${hoursAgo}h</span>` : hoursAgo >= 20 ? ` <span style="color:#f59e0b">⚠ ${hoursAgo}h · 即将过期</span>` : ` · ${hoursAgo}h 前`);
          }
        } else {
          time.textContent = isPermanent ? '永久有效（无需更换）' : '未知';
        }
      } else {
        view.textContent = '(未配置)';
        if (subtitle) subtitle.textContent = '· 尚未配置 API Key';
      }
    } catch {}
  }
  function openAliyunTokenModal() {
    $('#dhAliyunTokenInput').value = '';
    $('#dhAliyunTokenModal').style.display = 'flex';
    setTimeout(() => $('#dhAliyunTokenInput').focus(), 80);
  }
  function closeAliyunTokenModal() { $('#dhAliyunTokenModal').style.display = 'none'; }
  async function saveAliyunToken() {
    const token = $('#dhAliyunTokenInput').value.trim();
    if (!token) return toast('请粘贴 Token', 'error');
    const btn = $('#dhAliyunTokenSave');
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = '保存中…';
    try {
      const r = await fetch('/api/dh/aliyun-token/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
        body: JSON.stringify({ token }),
      });
      const d = await r.json();
      if (!d?.success) throw new Error(d?.error || '保存失败');
      toast(`✅ 已保存（${d.type === 'dashscope' ? '智能语音 2.0 sk-* API Key · 永久有效' : '⚠ 旧版 NLS Token · 24h 过期，建议改用 sk-* Key'}）`, 'success');
      closeAliyunTokenModal();
      loadAliyunTokenCard();
    } catch (err) {
      toast('保存失败：' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  // ══════════════ 引擎状态 ══════════════
  async function loadEngineStatus() {
    try {
      const r = await api('/api/dh/status');
      if (!r?.success) return;
      const e = r.engines;
      const box = $('#dhEngineStatus');
      if (!box) return;
      box.innerHTML = [
        ['Seedream 文生图', e.seedream.available],
        ['Jimeng Omni', e.jimeng_omni.available],
        ['Wan-Animate', e.wan_animate.available],
        ['飞影免费', e.hifly_free.available],
        ['飞影付费', e.hifly_paid.available],
      ].map(([n, ok]) => `<div class="${ok ? 'ok' : 'bad'}">${ok ? '●' : '○'} ${n}</div>`).join('');
    } catch {}
  }

  // ══════════════ 事件绑定 ══════════════
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAudibleMedia({ reset: false });
  });
  window.addEventListener('pagehide', () => stopAudibleMedia({ reset: false }));

  document.addEventListener('click', async (e) => {
    const target = e.target;
    const closest = s => target.closest(s);
    if (!closest('audio, video, [data-voice-preview], [data-vc-preview], #pdhPreviewScriptBtn, [data-preview-video], .dh-video-modal-card')) {
      stopAudibleMedia({ reset: false });
    }
    const openMusicModal = $('#dhOpenMusicModal');
    if (closest('[data-open-music-close]') || (openMusicModal?.classList.contains('open') && target === openMusicModal)) {
      closeOpenMusicModal();
      return;
    }
    if (closest('[data-lux-storyboard-briefing]')) {
      openLuxuryStoryboardBriefingModal();
      return;
    }
    if (closest('[data-lux-storyboard-briefing-close]')) {
      closeLuxuryStoryboardBriefingModal();
      return;
    }
    if (target.matches?.('input[type="file"]')) return;

    const bgmPicker = closest('#dhLuxAdBgmProfiles');
    const bgmProfileToggle = closest('#dhLuxAdBgmProfileToggle');
    if (bgmProfileToggle) {
      const menu = $('#dhLuxAdBgmProfileMenu');
      const willOpen = !bgmPicker?.classList.contains('open');
      bgmPicker?.classList.toggle('open', willOpen);
      bgmProfileToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (menu) menu.hidden = !willOpen;
      return;
    }
    if (!bgmPicker) {
      const picker = $('#dhLuxAdBgmProfiles');
      const toggle = $('#dhLuxAdBgmProfileToggle');
      const menu = $('#dhLuxAdBgmProfileMenu');
      picker?.classList.remove('open');
      toggle?.setAttribute('aria-expanded', 'false');
      if (menu) menu.hidden = true;
    }
    const openMusicImport = closest('[data-open-music-import]');
    if (openMusicImport) {
      importOpenMusic(openMusicImport.dataset.openMusicImport);
      return;
    }
    if (closest('#dhOpenMusicSearchBtn')) {
      searchOpenMusic();
      return;
    }

    const luxStep = closest('[data-lux-step]');
    if (luxStep) {
      showLuxuryAdStep(Number(luxStep.dataset.luxStep || 1));
      return;
    }

    const navItem = closest('.dh-nav-item');
    if (navItem?.dataset.tab) {
      if (SPACE_WORKFLOW_TABS.has(navItem.dataset.tab)) startNewSpaceGuideSession(navItem.dataset.tab);
      if (navItem.dataset.tab === 'step2') state.avatarPickReturn = '';
      switchTab(navItem.dataset.tab);
      if (navItem.dataset.s1Shortcut === 'product') {
        setS1AvatarType('product');
        toast('已切到「生成形象」里的商品数字人形象模块', 'success');
        setTimeout(() => $('#dhS1ProductFields')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
      }
      return;
    }
    const spacePickAvatar = closest('[data-space-pick-avatar]');
    if (spacePickAvatar) {
      state.avatarPickReturn = state.activeTab === 'material-film' ? 'material-film' : (isLuxuryAdModule() ? 'luxury-ad' : 'space-guide');
      switchTab('step2');
      return;
    }
    const tabGo = closest('[data-tab-go]');
    if (tabGo) {
      if (SPACE_WORKFLOW_TABS.has(tabGo.dataset.tabGo)) startNewSpaceGuideSession(tabGo.dataset.tabGo);
      if (tabGo.dataset.tabGo === 'step2' && state.activeTab === 'step3') state.avatarPickReturn = 'step3';
      else if (tabGo.dataset.tabGo === 'step2') state.avatarPickReturn = '';
      switchTab(tabGo.dataset.tabGo);
      if (tabGo.dataset.s1Shortcut === 'product') {
        setS1AvatarType('product');
        setTimeout(() => $('#dhS1ProductFields')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
      }
      return;
    }
    const luxType = closest('[data-lux-ad-type]');
    if (luxType) {
      state.luxuryAd.adType = luxType.dataset.luxAdType || 'auto';
      $$('[data-lux-ad-type]').forEach(b => b.classList.toggle('active', b === luxType));
      return;
    }
    const luxRatio = closest('[data-lux-ratio]');
    if (luxRatio) {
      const ratioValue = luxRatio.dataset.luxRatio || '9:16';
      state.luxuryAd.outputRatio = ratioValue;
      const ratioSelect = $('#dhLuxAdRatio');
      if (ratioSelect) ratioSelect.value = ratioValue;
      $$('[data-lux-ratio]').forEach(b => b.classList.toggle('active', b === luxRatio));
      state.luxuryAd.storyboardDetailed = false;
      state.luxuryAd.globalVisualBible = null;
      state.luxuryAd.keyframes = [];
      updateLuxuryAdOutputHint();
      renderLuxuryAdStoryboard();
      updateLuxuryAdStepLocks();
      return;
    }
    const shotUpload = closest('[data-lux-shot-upload]');
    if (shotUpload) {
      if (state.luxuryAd.keyframeGenerating) {
        toast('正在生成画面预览，完成后再替换场景图', 'error');
        return;
      }
      const shotIndex = luxuryAdNormalizeShotIndex(shotUpload.dataset.luxShotUpload);
      if (shotIndex === null) {
        toast('没有识别到要绑定的分镜位置，请重新点击该分镜的上传按钮', 'error');
        return;
      }
      state.luxuryAd.pendingShotUploadIndex = shotIndex;
      const fileInput = $('#dhLuxAdAssetFile');
      if (fileInput) {
        fileInput.dataset.luxShotUpload = String(shotIndex);
        fileInput.click();
      }
      return;
    }
    if (closest('#dhLuxAdAssetDrop')) {
      if (state.luxuryAd.keyframeGenerating) {
        toast('正在生成画面预览，完成后再替换素材', 'error');
        return;
      }
      state.luxuryAd.pendingShotUploadIndex = null;
      const fileInput = $('#dhLuxAdAssetFile');
      if (fileInput) {
        delete fileInput.dataset.luxShotUpload;
        fileInput.click();
      }
      return;
    }
    const briefRefRemove = closest('[data-lux-brief-ref-remove]');
    if (briefRefRemove) {
      const idx = Number(briefRefRemove.dataset.luxBriefRefRemove);
      const refs = luxuryAdBriefReferenceAssets();
      if (Number.isFinite(idx) && refs[idx]) {
        if (refs[idx].previewUrl?.startsWith('blob:')) URL.revokeObjectURL(refs[idx].previewUrl);
        state.luxuryAd.briefRefAssets = refs.filter((_, i) => i !== idx);
        state.luxuryAd.visualReferenceBrief = null;
        state.luxuryAd.assetManifest = null;
        state.luxuryAd.visualLocks = null;
        state.luxuryAd.globalVisualBible = null;
        state.luxuryAd.briefInfo = null;
        state.luxuryAd.segments = [];
        state.luxuryAd.storyboardDetailed = false;
        state.luxuryAd.keyframes = [];
        renderLuxuryAdBriefRefs();
        renderLuxuryAdStoryboard();
        updateLuxuryAdStepLocks();
        toast('已删除需求参考图，后续会重新分析剩余图片', 'success');
      }
      return;
    }
    if (closest('#dhLuxAdBriefRefDrop')) {
      if (state.luxuryAd.sceneGenerating || state.luxuryAd.scriptGenerating || state.luxuryAd.keyframeGenerating) {
        toast('当前正在处理，请稍后再上传参考图', 'error');
        return;
      }
      $('#dhLuxAdBriefRefFile')?.click();
      return;
    }
    const outlineAdd = closest('[data-lux-outline-add]');
    if (outlineAdd) {
      const raw = outlineAdd.dataset.luxOutlineAdd;
      addLuxuryAdSegment(raw === '' || raw == null ? null : Number(raw));
      return;
    }
    const outlineDelete = closest('[data-lux-outline-delete]');
    if (outlineDelete) {
      await deleteLuxuryAdSegment(Number(outlineDelete.dataset.luxOutlineDelete));
      return;
    }
    const outlineMove = closest('[data-lux-outline-move]');
    if (outlineMove) {
      moveLuxuryAdSegment(Number(outlineMove.dataset.luxOutlineIndex), outlineMove.dataset.luxOutlineMove);
      return;
    }
    if (closest('#dhLuxAdProductDrop')) {
      if (state.luxuryAd.keyframeGenerating) {
        toast('正在生成画面预览，完成后再替换产品图', 'error');
        return;
      }
      $('#dhLuxAdProductFile')?.click();
      return;
    }
    if (closest('#dhLuxAdProductDropInline')) {
      if (state.luxuryAd.keyframeGenerating) {
        toast('正在生成画面预览，完成后再替换产品图', 'error');
        return;
      }
      $('#dhLuxAdProductFile')?.click();
      return;
    }
    if (closest('#dhLuxAdProductClear') || closest('#dhLuxAdProductClearInline')) {
      clearLuxuryAdProduct();
      return;
    }
    if (closest('[data-lux-product-preview]')) {
      const product = state.luxuryAd.productAsset || {};
      const url = product.url || product.previewUrl || '';
      if (url) openImagePreviewModal(url, product.name || '主产品图');
      return;
    }
    const luxPersonPreview = closest('[data-lux-person-preview]');
    if (luxPersonPreview) {
      const idx = Number(luxPersonPreview.dataset.luxPersonPreview || 0);
      const asset = state.luxuryAd.personAsset || {};
      const urls = luxuryActorAssetUrls(asset);
      const url = urls[idx] || urls[0] || '';
      if (url) openImagePreviewModal(url, `${asset.name || '演员参考'} · ${luxuryActorAssetViewLabel(idx)}`);
      return;
    }
    const luxPersonFailedPreview = closest('[data-lux-person-failed-preview]');
    if (luxPersonFailedPreview) {
      const item = luxuryPersonFailedCandidates(state.luxuryAd.personGenerationError || {})[Number(luxPersonFailedPreview.dataset.luxPersonFailedPreview || 0)];
      if (item?.url) openImagePreviewModal(item.url, item.provider || item.label || '人物候选图');
      return;
    }
    const luxPersonFailedAdopt = closest('[data-lux-person-failed-adopt]');
    if (luxPersonFailedAdopt) {
      adoptLuxuryPersonFailedCandidate(Number(luxPersonFailedAdopt.dataset.luxPersonFailedAdopt || 0));
      return;
    }
    const luxAssetPreview = closest('[data-lux-asset-preview]');
    if (luxAssetPreview) {
      const asset = luxuryAdReferenceAssets()[Number(luxAssetPreview.dataset.luxAssetPreview)];
      const url = asset?.url || asset?.previewUrl || '';
      if (url) openImagePreviewModal(url, asset?.name || '参考素材');
      return;
    }
    const luxMaterialPreview = closest('[data-lux-material-preview]');
    if (luxMaterialPreview) {
      const url = luxuryMaterialAssetUrls()[Number(luxMaterialPreview.dataset.luxMaterialPreview)] || '';
      if (url) openImagePreviewModal(url, '素材成片素材');
      return;
    }
    const luxShotEdit = closest('[data-lux-shot-edit]');
    if (luxShotEdit) {
      openLuxuryShotEditor(Number(luxShotEdit.dataset.luxShotEdit));
      return;
    }
    const luxShotPreview = closest('[data-lux-shot-preview]');
    if (luxShotPreview) {
      const idx = Number(luxShotPreview.dataset.luxShotPreview);
      const kf = (state.luxuryAd.keyframes || [])[idx] || {};
      const seg = (state.luxuryAd.segments || [])[idx] || {};
      const binding = luxuryAdShotBoundAssets(seg, idx);
      const url = kf.image_url || kf.imageUrl || binding.ref?.url || binding.ref?.previewUrl || state.luxuryAd.productAsset?.url || '';
      if (url) openImagePreviewModal(url, `镜头 ${idx + 1} 画面预览`);
      return;
    }
    if (closest('[data-lux-failed-candidates]')) {
      openLuxuryFailedCandidatesModal();
      return;
    }
    const luxFailedPreview = closest('[data-lux-failed-preview]');
    if (luxFailedPreview) {
      const candidates = luxuryFailedKeyframeCandidates(state.luxuryAd.keyframeErrorDetails);
      const item = candidates[Number(luxFailedPreview.dataset.luxFailedPreview)];
      if (item?._url) openImagePreviewModal(item._url, `失败候选图 · 镜头 ${item._shotIndex + 1}`);
      return;
    }
    const luxAdoptFailed = closest('[data-lux-adopt-failed]');
    if (luxAdoptFailed) {
      await adoptLuxuryFailedCandidate(Number(luxAdoptFailed.dataset.luxAdoptFailed));
      return;
    }
    if (closest('#dhLuxAdVoiceOpen')) {
      state.voiceModalTarget = 'luxury-ad';
      const modalSearch = $('#dhSpaceVoiceModalSearch');
      if (modalSearch) modalSearch.value = '';
      $('#dhSpaceVoiceModal').style.display = 'flex';
      renderSpaceVoiceOptions();
      setTimeout(() => $('#dhSpaceVoiceModalSearch')?.focus(), 30);
      return;
    }
    if (closest('#dhLuxAdUploadPersonRef')) {
      $('#dhLuxAdPersonFile')?.click();
      return;
    }
    if (closest('#dhLuxAdPickActorAsset')) {
      openLuxuryAdActorLibrary();
      return;
    }
    if (closest('#dhLuxAdGeneratePersonSheet')) {
      generateLuxuryAdPersonSheet();
      return;
    }
    if (closest('#dhLuxAdPickPerson')) {
      state.luxuryAd.personAsset = null;
      state.avatarPickReturn = 'luxury-ad';
      switchTab('step2');
      return;
    }
    if (closest('#dhLuxAdSample')) {
      const input = $('#dhLuxAdText');
      if (input) input.value = SPACE_LUXURY_SAMPLE_TEXT;
      state.luxuryAd.content = SPACE_LUXURY_SAMPLE_TEXT;
      state.luxuryAd.briefInfo = null;
      state.luxuryAd.segments = [];
      state.luxuryAd.storyboardDetailed = false;
      state.luxuryAd.keyframes = [];
      renderLuxuryAdStoryboard();
      setLuxuryProgress('content');
      updateLuxuryAdStepLocks();
      return;
    }
    if (closest('#dhLuxAdWrite')) { openLuxuryAdWriterModal(); return; }
    if (closest('#dhLuxAdClean')) { rewriteLuxuryAdContent(); return; }
    if (closest('#dhLuxAdSaveDraft') || closest('#dhLuxAdSaveDraftStep2') || closest('#dhLuxAdSaveDraftStep3') || closest('#dhLuxAdSaveDraftStep4') || closest('#dhLuxAdSaveDraftStep5')) {
      const btn = closest('#dhLuxAdSaveDraft') || closest('#dhLuxAdSaveDraftStep2') || closest('#dhLuxAdSaveDraftStep3') || closest('#dhLuxAdSaveDraftStep4') || closest('#dhLuxAdSaveDraftStep5');
      const old = btn?.innerHTML;
      try {
        if (btn) { btn.disabled = true; btn.innerHTML = '保存中…'; }
        await saveLuxuryAdDraft({ silent: false });
      } catch (err) {
        toast('保存制作进度失败：' + err.message, 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = old || '保存进度'; }
      }
      return;
    }
    const luxDetectStyleBtn = closest('#dhLuxAdDetectStyle');
    if (luxDetectStyleBtn) { await buildLuxuryAdStoryboard({ autoNext: false, detail: false, triggerButton: luxDetectStyleBtn }); return; }
    if (closest('#dhLuxAdAutoVisuals')) { autoGenerateLuxuryAdAiVisuals(); return; }
    const luxStoryboardBtn = closest('#dhLuxAdStoryboard');
    if (luxStoryboardBtn) {
      if (luxuryAdIsMaterialMode()) buildMaterialFilmCopyPlan();
      else await buildLuxuryAdStoryboard({ autoNext: false, detail: true, triggerButton: luxStoryboardBtn });
      return;
    }
    const luxScriptRegenerateBtn = closest('#dhLuxAdScriptRegenerate') || closest('#dhLuxAdScriptRegenerateTop');
    if (luxScriptRegenerateBtn) {
      if (luxuryAdIsMaterialMode()) buildMaterialFilmCopyPlan();
      else await buildLuxuryAdStoryboard({ autoNext: false, detail: true, triggerButton: luxScriptRegenerateBtn });
      return;
    }
    const luxGenerateBtn = closest('#dhLuxAdGenerate');
    if (luxGenerateBtn) {
      if (luxuryAdIsMaterialMode()) buildMaterialFilmCopyPlan();
      else await buildLuxuryAdStoryboard({ autoNext: true, detail: false, triggerButton: luxGenerateBtn });
      return;
    }
    if (closest('#dhLuxAdFillMissingFrames')) { fillMissingLuxuryAdKeyframes(); return; }
    if (closest('#dhLuxAdRegenerateFrames')) { generateLuxuryAdKeyframes({ autoSubmit: false, force: true }); return; }
    const luxuryShotRegenerate = closest('[data-lux-shot-regenerate]');
    if (luxuryShotRegenerate) {
      const idx = Number(luxuryShotRegenerate.dataset.luxShotRegenerate);
      generateLuxuryAdKeyframes({ autoSubmit: false, onlyIndex: idx });
      return;
    }
    if (closest('#dhLuxAdPreviewFrames')) {
      if (luxuryAdIsMaterialMode()) showLuxuryAdStep(5);
      else generateLuxuryAdKeyframes({ autoSubmit: false, force: state.luxuryAd.keyframePlanningOnly === true });
      return;
    }
    if (closest('#dhLuxAdGoCompose') || closest('[data-lux-material-compose]')) { showLuxuryAdStep(5); return; }
    if (closest('#dhLuxAdConfirmGenerate')) {
      if (luxuryAdIsMaterialMode()) submitMaterialFilmAd();
      else submitLuxuryAd();
      return;
    }
    const plazaUse = closest('[data-plaza-use]'); if (plazaUse) { e.stopPropagation(); usePlazaAvatar(plazaUse.dataset.plazaUse); return; }
    if (closest('#dhTaskRefresh')) {
      await restoreVideoTasks();
      await refreshLuxuryAdProjectsForTaskCenter({ force: true, silent: true });
      toast('任务状态已刷新', 'success');
      return;
    }
    const taskTypeTab = closest('[data-task-type]');
    if (taskTypeTab) {
      state.activeTaskType = taskTypeTab.dataset.taskType || 'digital_human';
      renderTaskCenter();
      return;
    }
    const taskStatusTab = closest('[data-task-status]');
    if (taskStatusTab) {
      state.activeTaskStatus = taskStatusTab.dataset.taskStatus || 'pending';
      renderTaskCenter();
      return;
    }
    const luxProjectContinue = closest('[data-lux-project-continue]');
    if (luxProjectContinue) {
      const id = luxProjectContinue.dataset.luxProjectContinue;
      const opened = window.open(luxuryAdProjectResumeUrl(id), '_blank', 'noopener');
      if (!opened) window.location.href = luxuryAdProjectResumeUrl(id);
      return;
    }
    const luxProjectDelete = closest('[data-lux-project-delete]');
    if (luxProjectDelete) {
      const id = luxProjectDelete.dataset.luxProjectDelete;
      if (!id) return;
      try {
        await api(`/api/dh/luxury-ad/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
        state.luxuryAdProjects = (state.luxuryAdProjects || []).filter(x => String(x.id || '') !== String(id));
        if (state.luxuryAd.productionProjectId === id) {
          state.luxuryAd.productionProjectId = '';
          state.luxuryAd.productionProject = null;
        }
        await refreshLuxuryAdProjectsForTaskCenter({ force: true, silent: true });
        renderTaskCenter();
        toast('待继续任务已删除', 'success');
      } catch (err) {
        toast('删除失败：' + err.message, 'error');
      }
      return;
    }
    const taskPreview = closest('[data-task-preview]');
    if (taskPreview) {
      const id = taskPreview.dataset.taskPreview;
      const meta = state.s3.runningTasks.get(id) || readVideoTasks().find(x => x.taskId === id);
      const url = meta?.videoUrl || meta?.video_url || '';
      if (url) openVideoPreviewModal(url, meta.avatarName || '数字人作品');
      return;
    }
    const taskFocus = closest('[data-task-focus]');
    if (taskFocus) { openTaskProgressModal(taskFocus.dataset.taskFocus); return; }
    const taskRetry = closest('[data-task-retry]');
    if (taskRetry) {
      try {
        taskRetry.disabled = true;
        await retryVideoTask(taskRetry.dataset.taskRetry);
      } catch (err) {
        toast('重新提交失败：' + err.message, 'error');
      } finally {
        taskRetry.disabled = false;
      }
      return;
    }
    const workPreview = closest('[data-work-preview]');
    if (workPreview) {
      const id = workPreview.dataset.workPreview;
      const card = workPreview.closest('.dh-av-card');
      const title = card?.querySelector('.dh-av-card-name span')?.textContent || '数字人作品';
      try {
        const r = await api('/api/dh/videos/tasks/' + encodeURIComponent(id));
        const t = r?.data || {};
        const url = t.videoUrl || t.video_url;
        if (!r?.success || !url) throw new Error(r?.error || '视频地址不存在');
        openVideoPreviewModal(url, title);
      } catch (err) {
        toast('打开视频失败：' + err.message, 'error');
      }
      return;
    }
    const spaceKeyframePreview = closest('[data-space-keyframe-preview]');
    if (spaceKeyframePreview) {
      const idx = Number(spaceKeyframePreview.dataset.spaceKeyframePreview);
      const kf = state.space.keyframes?.[idx];
      if (kf?.image_url) openImagePreviewModal(kf.image_url, kf.title || `镜头 ${idx + 1}`);
      return;
    }
    const taskRemove = closest('[data-task-remove]');
    if (taskRemove) {
      const id = taskRemove.dataset.taskRemove;
      const meta = state.s3.runningTasks.get(id);
      if (meta?.pollTimer) clearInterval(meta.pollTimer);
      state.s3.runningTasks.delete(id);
      removeStoredVideoTask(id);
      toast('任务已移除', 'success');
      return;
    }

    const spaceScene = closest('[data-space-scene]');
    if (spaceScene) {
      state.space.scene = spaceScene.dataset.spaceScene || 'gallery_wall';
      renderSpaceGuide();
      return;
    }
    const spaceCamera = closest('[data-space-camera]');
    if (spaceCamera) {
      state.space.camera = spaceCamera.dataset.spaceCamera || 'push_in';
      renderSpaceGuide();
      return;
    }
    const spaceAdMode = closest('[data-space-ad-mode]');
    if (spaceAdMode) {
      state.space.adMode = spaceAdMode.dataset.spaceAdMode === 'luxury' ? 'luxury' : 'standard';
      state.space.segments = [];
      state.space.speechSegments = [];
      state.space.visualSegments = [];
      state.space.keyframes = [];
      state.space.strictKeyframeId = '';
      autoBuildSpacePromptFromManualText({ immediate: true });
      renderSpaceAdMode();
      return;
    }
    const spaceGuideMode = closest('[data-space-guide-mode]');
    if (spaceGuideMode) {
      if (spaceGuideMode.dataset.spaceGuideMode !== 'ai_guide') {
        state.space.guideMode = 'ai_guide';
        state.space.keyframes = [];
        state.space.visualSegments = [];
        state.space.strictKeyframeId = '';
        renderSpaceAdMode();
        toast('素材审片已禁用纯背景首帧，必须先生成带人物的导览员预览。', 'warning');
        return;
      }
      state.space.guideMode = spaceGuideMode.dataset.spaceGuideMode === 'ai_guide' ? 'ai_guide' : 'direct_keyframe';
      state.space.keyframes = [];
      state.space.visualSegments = [];
      state.space.strictKeyframeId = '';
      renderSpaceAdMode();
      return;
    }
    const spaceGuideGender = closest('[data-space-guide-gender]');
    if (spaceGuideGender) {
      state.space.guideGender = spaceGuideGender.dataset.spaceGuideGender === 'male' ? 'male' : 'female';
      state.space.keyframes = [];
      state.space.visualSegments = [];
      renderSpaceAdMode();
      return;
    }
    const luxuryStyle = closest('[data-luxury-style]');
    if (luxuryStyle) {
      state.space.adStyle = luxuryStyle.dataset.luxuryStyle || 'luxury_soft';
      state.space.segments = [];
      state.space.speechSegments = [];
      state.space.visualSegments = [];
      state.space.keyframes = [];
      autoBuildSpacePromptFromManualText({ immediate: true });
      renderSpaceAdMode();
      return;
    }
    if (closest('#dhSpaceBgDrop')) { $('#dhSpaceBgFile')?.click(); return; }
    if (closest('#dhSpaceBgClear')) {
      if (state.space.bgPreviewUrl && state.space.bgPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(state.space.bgPreviewUrl);
      (state.space.referenceImages || []).forEach(img => {
        if (img?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(img.previewUrl);
      });
      state.space.bgImageUrl = '';
      state.space.bgPreviewUrl = '';
      state.space.bgImageName = '';
      state.space.referenceImages = [];
      state.space.bgUploading = false;
      state.space.keyframes = [];
      state.space.visualSegments = [];
      state.space.strictKeyframeId = '';
      renderSpaceGuide();
      return;
    }
    if (closest('#dhSpaceVoiceOpen')) {
      state.voiceModalTarget = 'space';
      const modalSearch = $('#dhSpaceVoiceModalSearch');
      if (modalSearch) modalSearch.value = '';
      $('#dhSpaceVoiceModal').style.display = 'flex';
      renderSpaceVoiceOptions();
      setTimeout(() => $('#dhSpaceVoiceModalSearch')?.focus(), 30);
      return;
    }
    if (closest('[data-space-voice-close]') || target === $('#dhSpaceVoiceModal')) {
      closeSpaceVoiceModal();
      return;
    }
    if (closest('#dhSpaceSampleText')) {
      const text = state.space.adMode === 'luxury' ? SPACE_LUXURY_SAMPLE_TEXT : SPACE_STANDARD_SAMPLE_TEXT;
      const input = $('#dhSpaceText');
      if (input) input.value = text;
      state.space.segments = [];
      state.space.speechSegments = [];
      state.space.visualSegments = [];
      state.space.copyMode = 'manual';
      renderSpaceCopyMode();
      autoBuildSpacePromptFromManualText({ immediate: true });
      return;
    }
    const spaceCopyMode = closest('[data-space-copy-mode]');
    if (spaceCopyMode) {
      state.space.copyMode = spaceCopyMode.dataset.spaceCopyMode === 'ai' ? 'ai' : 'manual';
      renderSpaceCopyMode();
      if (state.space.copyMode === 'ai') openSpaceWriteModal();
      else autoBuildSpacePromptFromManualText({ immediate: true });
      return;
    }
    if (closest('#dhSpaceAIWrite')) { writeAndSegmentSpaceScript(); return; }
    if (closest('[data-space-keyframes-from-board]')) { generateSpaceKeyframes(); return; }
    if (closest('[data-space-submit-from-board]')) { submitSpaceGuide(); return; }
    if (closest('#dhSpaceSubmit')) {
      if (state.space.keyframes?.some(k => k?.image_url)) submitSpaceGuide();
      else generateSpaceKeyframes();
      return;
    }

    // Step 1
    const modeBtn = closest('.dh-mode-btn'); if (modeBtn) { setMode(modeBtn.dataset.mode); return; }
    const s1TypeBtn = closest('[data-s1-avatar-type]'); if (s1TypeBtn) { setS1AvatarType(s1TypeBtn.dataset.s1AvatarType); return; }
    const s1ProductMotionBtn = closest('[data-s1-product-motion]'); if (s1ProductMotionBtn) { selectS1ProductMotion(s1ProductMotionBtn.dataset.s1ProductMotion); return; }
    if (closest('#dhS1ProductPickBtn')) { $('#dhS1ProductFile')?.click(); return; }
const gChip = closest('[data-gender]'); if (gChip) { selectGender(gChip.dataset.gender); return; }
    const sCard = closest('[data-style]'); if (sCard) { selectStyle(sCard.dataset.style); return; }
    const rChip = closest('[data-ratio]'); if (rChip) { selectRatio(rChip.dataset.ratio); return; }
    const s1Action = closest('[data-s1-action]'); if (s1Action) { selectS1Action(s1Action.dataset.s1Action); return; }
    const s1Frm = closest('[data-s1-framing]'); if (s1Frm) { selectS1Framing(s1Frm.dataset.s1Framing); return; }
    if (closest('#dhS1BgPickBtn')) { document.getElementById('dhS1BgFile')?.click(); return; }
    if (closest('#dhS1BgClear')) { clearS1Background(); return; }
    if (closest('#dhS1GenBtn')) { generateImage(); return; }
    if (closest('#dhS1Regen')) {
      if (isS1ProductMode() && state.s1.product?.imageUrl && state.s1.previewUrl) {
        state.s1.avatarType = 'product';
        state.s1.productFusedKey = '';
        state.s1.productFusedUrl = '';
        state.s1.product = {
          ...(state.s1.product || {}),
          topview_image_id: '',
          topview_task_id: '',
          remove_background_task_id: '',
        };
        fuseS1ProductAvatar();
      } else if (state.s1.mode === 'generate') {
        generateImage();
      } else {
        $('#dhS1UploadFile').click();
      }
      return;
    }
    if (closest('#dhS1SampleBtn')) { generateSample(); return; }
    if (closest('#dhS1DescAIBtn')) { e.preventDefault(); openDescModal(); return; }
    if (closest('#dhS1SceneAIBtn')) { e.preventDefault(); openSceneDescModal(); return; }
    if (closest('[data-desc-close]')) { closeDescModal(); return; }
    const descPreset = closest('[data-desc-preset]');
    if (descPreset) { $('#dhDescInput').value = descPreset.dataset.descPreset; return; }
    if (closest('#dhDescSubmit')) { submitDescEnhance(); return; }

    // AI 写稿弹窗
    if (closest('[data-write-close]')) { closeWriteModal(); return; }
    const writeModeBtn = closest('[data-write-mode]');
    if (writeModeBtn) { setWriteMode(writeModeBtn.dataset.writeMode); return; }
    const productModeBtn = closest('[data-product-mode]');
    if (productModeBtn) { setProductMode(productModeBtn.dataset.productMode === 'product'); return; }
    if (closest('#dhProductPickBtn')) { $('#dhProductFile')?.click(); return; }
    if (closest('#dhProductClearBtn')) { clearProductImage(); return; }
    const writePreset = closest('[data-write-preset]');
    if (writePreset) { $('#dhWriteInput').value = writePreset.dataset.writePreset; return; }
    if (closest('#dhWriteSubmit')) { submitWriteScript(); return; }
    if (closest('#dhS1Save')) { saveAvatar(); return; }

    // 字幕
    if (closest('#dhS3SubtitleStyleBtn')) { openSubtitleModal('s3'); return; }
    if (closest('#pdhSubtitleStyleBtn')) { openSubtitleModal('pdh'); return; }
    if (closest('#dhSpaceSubtitleStyleBtn')) { openSubtitleModal('space'); return; }
    if (closest('#dhLuxAdSubtitleStyleBtn')) { openSubtitleModal('luxury-ad'); return; }
    if (closest('[data-subtitle-close]')) { closeSubtitleModal(); return; }
    const subStyleBtn = closest('.dh-sub-style');
    if (subStyleBtn) { setActiveSubStyle(subStyleBtn.dataset.subStyle); return; }
    const subPreset = closest('[data-sub-preset]');
    if (subPreset) { applySubPreset(subPreset.dataset.subPreset); return; }
    if (closest('#dhSubtitleSave')) { saveSubtitleSettings(); return; }

    // Step 2
    const avatarVideoPreview = closest('[data-avatar-video-preview]');
    if (avatarVideoPreview) {
      openVideoPreviewModal(avatarVideoPreview.dataset.avatarVideoPreview, avatarVideoPreview.dataset.avatarTitle || '视频素材');
      return;
    }
    const avImg = closest('.dh-av-media img');
    if (avImg) {
      const card = closest('[data-av-id]');
      const av = state.myAvatars.find(x => String(x.id) === String(card?.dataset.avId));
      openImagePreview(avImg.src || av?.image_url || av?.photo_url || '', av?.name || '');
      return;
    }
    const plazaImg = closest('.dh-plaza-img img');
    if (plazaImg) {
      const card = closest('[data-plaza-key]');
      const it = state.plaza.items.find(x => x.key === card?.dataset.plazaKey);
      openImagePreview(plazaImg.src || it?.url || '', it?.name || '');
      return;
    }
    const selBtn = closest('[data-act="select"]'); if (selBtn) { selectAvatar(selBtn.dataset.avId); return; }
    const promoteBtn = closest('[data-act="promote"]'); if (promoteBtn) { promoteToVideo(promoteBtn.dataset.avId); return; }
    const delBtn = closest('[data-act="delete"]'); if (delBtn) { deleteAvatar(delBtn.dataset.avId); return; }
    const editAvBtn = closest('[data-act="edit-av"]'); if (editAvBtn) { editAvatar(editAvBtn.dataset.avId); return; }

    // Step 3
    if (closest('#dhS3WriteBtn')) { openWriteModal(); return; }
    if (closest('#dhS3SegmentBtn')) { segmentScript(); return; }
    if (closest('#dhS3SubmitBtn')) { submitVideo(); return; }
    if (closest('#dhProductAdBtn')) { submitProductAd(); return; }

    // 时间轴编辑
    const editBtn = closest('[data-edit-seg]');
    if (editBtn) { openMotionEditor(parseInt(editBtn.dataset.editSeg)); return; }
    const motionPreset = closest('[data-motion-preset]');
    if (motionPreset) {
      const pop = $('#dhMotionPopover');
      pop.querySelectorAll('[data-motion-preset]').forEach(b => b.classList.remove('active'));
      motionPreset.classList.add('active');
      const preset = ACTION_PRESETS.find(a => a.id === motionPreset.dataset.motionPreset);
      if (preset) $('#dhMotionCustom').value = preset.en;
      return;
    }
    const exprBtn = closest('[data-expression]');
    if (exprBtn) {
      const pop = $('#dhMotionPopover');
      pop.querySelectorAll('[data-expression]').forEach(b => b.classList.remove('active'));
      exprBtn.classList.add('active');
      return;
    }
    const toneBtn = closest('[data-tone]');
    if (toneBtn) {
      const pop = $('#dhMotionPopover');
      pop.querySelectorAll('[data-tone]').forEach(b => b.classList.remove('active'));
      toneBtn.classList.add('active');
      const toneInput = $('#dhToneCustom');
      if (toneInput) toneInput.value = presetLabel(TONE_PRESETS, toneBtn.dataset.tone);
      return;
    }
    const cameraBtn = closest('[data-camera]');
    if (cameraBtn) {
      const pop = $('#dhMotionPopover');
      pop.querySelectorAll('[data-camera]').forEach(b => b.classList.remove('active'));
      cameraBtn.classList.add('active');
      const cameraInput = $('#dhCameraCustom');
      if (cameraInput) cameraInput.value = presetLabel(CAMERA_PRESETS, cameraBtn.dataset.camera);
      return;
    }
    if (closest('#dhMotionSave')) { saveMotion(); return; }
    if (closest('#dhMotionCancel')) { closeMotionEditor(); return; }
    const luxVoiceDirection = closest('[data-lux-voice-direction]');
    if (luxVoiceDirection) {
      state.luxuryAd.voiceDirection = luxVoiceDirection.dataset.luxVoiceDirection || 'story_dynamic';
      renderLuxuryAdVoice();
      renderSpaceVoiceOptions();
      saveLuxuryAdDraft({ silent: true }).catch(() => {});
      return;
    }
    const luxRecommendedVoice = closest('[data-lux-recommended-voice]');
    if (luxRecommendedVoice) {
      state.luxuryAd.voiceId = luxRecommendedVoice.dataset.luxRecommendedVoice || '';
      renderLuxuryAdVoice();
      renderSpaceVoiceOptions();
      updateLuxuryAdStepLocks();
      saveLuxuryAdDraft({ silent: true }).catch(() => {});
      toast('已选用推荐旁白声音', 'success');
      return;
    }
    const luxBgmProfile = closest('[data-lux-bgm-profile]');
    if (luxBgmProfile) {
      state.luxuryAd.bgmProfile = luxBgmProfile.dataset.luxBgmProfile || 'auto';
      state.luxuryAd.bgmAsset = null;
      $('#dhLuxAdBgmProfiles')?.classList.remove('open');
      $('#dhLuxAdBgmProfileToggle')?.setAttribute('aria-expanded', 'false');
      const profileMenu = $('#dhLuxAdBgmProfileMenu');
      if (profileMenu) profileMenu.hidden = true;
      renderLuxuryAdBgm();
      updateLuxuryAdStepLocks();
      saveLuxuryAdDraft({ silent: true }).catch(() => {});
      return;
    }

    // 音色
    const voiceCard = closest('[data-voice-id]');
    if (voiceCard && !target.closest('[data-voice-preview]')) { selectVoice(voiceCard.dataset.voiceId); return; }
    const voicePrevBtn = closest('[data-voice-preview]');
    if (voicePrevBtn) {
      e.stopPropagation();
      const isLuxuryVoicePreview = !!voicePrevBtn.closest('#dhLuxAdVoiceCurrent')
        || (!!voicePrevBtn.closest('#dhSpaceVoiceModal') && state.voiceModalTarget === 'luxury-ad');
      previewVoice(voicePrevBtn.dataset.voicePreview, isLuxuryVoicePreview ? luxuryVoicePreviewText() : '');
      return;
    }
    const spaceVoiceCard = closest('[data-space-voice-id]');
    if (spaceVoiceCard && !target.closest('[data-voice-preview]')) {
      state.space.voiceId = spaceVoiceCard.dataset.spaceVoiceId || '';
      renderSpaceVoiceOptions();
      if (closest('#dhSpaceVoiceModal')) closeSpaceVoiceModal();
      return;
    }
    const luxuryVoiceCard = closest('[data-luxury-voice-id]');
    if (luxuryVoiceCard && !target.closest('[data-voice-preview]')) {
      state.luxuryAd.voiceId = luxuryVoiceCard.dataset.luxuryVoiceId || '';
      renderLuxuryAdVoice();
      updateLuxuryAdStepLocks();
      if (closest('#dhSpaceVoiceModal')) {
        closeSpaceVoiceModal();
      }
      return;
    }
    const pdhVoiceCard = closest('[data-pdh-voice-id]');
    if (pdhVoiceCard && !target.closest('[data-voice-preview]')) {
      pdh.voiceId = pdhVoiceCard.dataset.pdhVoiceId || '';
      pdh.voice = (state.voices || []).find(v => String(v.id || '') === String(pdh.voiceId || '')) || null;
      state.s3.voiceId = pdh.voiceId;
      const input = $('#pdhVoiceSelect');
      if (input) input.value = pdh.voiceId;
      pdhRenderVoiceCurrent();
      pdhRenderVoiceModalList();
      pdhCloseVoiceModal();
      return;
    }
    if (closest('[data-pdh-voice-close]') || target === $('#pdhVoiceModal')) {
      pdhCloseVoiceModal();
      return;
    }

    const pdhProductAvatar = closest('[data-pdh-product-avatar]');
    if (pdhProductAvatar) {
      pdhSelectProductAvatar(pdhProductAvatar.dataset.pdhProductAvatar);
      closePdhAvatarModal();
      return;
    }
    if (closest('#pdhPickAvatarBtn')) { openPdhAvatarModal(); return; }
    if (closest('[data-pdh-avatar-close]') || target === $('#pdhAvatarModal')) { closePdhAvatarModal(); return; }

    // 作品删除
    const workDelBtn = closest('[data-act="work-delete"]');
    if (workDelBtn) { deleteWork(workDelBtn.dataset.workId); return; }

    // 阿里 Token 管理
    if (closest('#dhAliyunTokenBtn')) { openAliyunTokenModal(); return; }
    if (closest('[data-aliyun-token-close]')) { closeAliyunTokenModal(); return; }
    if (closest('#dhAliyunTokenSave')) { saveAliyunToken(); return; }
    if (closest('#dhVcCopyScript')) {
      const txt = $('#dhVcScript')?.textContent || '';
      navigator.clipboard?.writeText(txt).then(() => toast('已复制，请按此朗读', 'success')).catch(() => {});
      return;
    }

    // 声音克隆
    const vcGenderBtn = closest('[data-vc-gender]');
    if (vcGenderBtn) { $$('[data-vc-gender]').forEach(b => b.classList.toggle('active', b === vcGenderBtn)); return; }
    if (closest('#dhVcSubmit')) { submitVoiceClone(); return; }
    const vcPreviewBtn = closest('[data-vc-preview]');
    if (vcPreviewBtn) { previewClonedVoice(vcPreviewBtn.dataset.vcPreview); return; }
    const vcRetrySame = closest('[data-vc-retry-same]');
    if (vcRetrySame) { retryWithSameAudio(vcRetrySame.dataset.vcRetrySame); return; }
    const vcRetryNew = closest('[data-vc-retry-newfile]');
    if (vcRetryNew) { retryFailedVoice(vcRetryNew.dataset.vcRetryNewfile); return; }
    const vcDelBtn = closest('[data-vc-delete]');
    if (vcDelBtn) { deleteVoiceClone(vcDelBtn.dataset.vcDelete); return; }
    const vcEditBtn = closest('[data-vc-edit]');
    if (vcEditBtn) { editVoiceClone(vcEditBtn.dataset.vcEdit); return; }
    const vcRecloneAliyun = closest('[data-vc-reclone-aliyun]');
    if (vcRecloneAliyun) { recloneWithAliyun(vcRecloneAliyun.dataset.vcRecloneAliyun); return; }

    // 双人定制主持人
    const customHostBtn = closest('[data-custom-host]');
    if (customHostBtn) { openHostModal(customHostBtn.dataset.customHost); return; }
    if (closest('[data-custom-host-close]')) { closeHostModal(); return; }
    const hostModeBtn = closest('[data-host-mode]');
    if (hostModeBtn) { setHostMode(hostModeBtn.dataset.hostMode); return; }
    const hostGenderBtn = closest('[data-host-gender]');
    if (hostGenderBtn) { $$('[data-host-gender]').forEach(b => b.classList.toggle('active', b === hostGenderBtn)); return; }
    const hostAgeBtn = closest('[data-host-age]');
    if (hostAgeBtn) { $$('[data-host-age]').forEach(b => b.classList.toggle('active', b === hostAgeBtn)); return; }
    const hostDescPreset = closest('[data-host-desc-preset]');
    if (hostDescPreset) { $('#dhHostDesc').value = hostDescPreset.textContent.trim() + '：' + hostDescPreset.dataset.hostDescPreset; return; }
    if (closest('#dhHostAIGenBtn')) { generateAIHosts(); return; }
    const hostPick = closest('[data-host-pick]');
    if (hostPick) { togglePickHost(hostPick.dataset.hostPick); return; }
    if (closest('#dhHostPickConfirm')) { confirmPickHosts(); return; }

    // 双人剧本
    if (closest('#dhDualWriteBtn')) { dualWriteScript(); return; }
    if (closest('#dhDualParseBtn')) { parseDualTimeline(); return; }
    const dualEditSeg = closest('[data-dual-edit-seg]');
    if (dualEditSeg) { openDualMotionEditor(parseInt(dualEditSeg.dataset.dualEditSeg)); return; }
    const dualSaveBtn = closest('#dhDualMotionSave');
    if (dualSaveBtn) { saveDualMotion(parseInt(dualSaveBtn.dataset.dualIdx)); return; }

    const dualLayout = closest('[data-dual-layout]');
    if (dualLayout) {
      state.dual.layout = dualLayout.dataset.dualLayout;
      $$('[data-dual-layout]').forEach(b => b.classList.toggle('active', b === dualLayout));
      return;
    }
    if (closest('#dhDualSubmit')) { submitDual(); return; }
  });

  // 双人时间轴文字 contenteditable 保存
  document.addEventListener('blur', (e) => {
    const cell = e.target.closest?.('[data-dual-seg-text]');
    if (cell) updateDualSegText(parseInt(cell.dataset.dualSegText), cell.textContent || '');
  }, true);

  // ══════════════ 字幕设置 ══════════════
  const SUBTITLE_PRESETS = {
    white:  { color: '#FFFFFF', outlineColor: '#000000' },
    yellow: { color: '#FFF600', outlineColor: '#000000' },
    pink:   { color: '#ec4899', outlineColor: '#000000' },
    cyan:   { color: '#21FFF3', outlineColor: '#000000' },
    green:  { color: '#22c55e', outlineColor: '#000000' },
    red:    { color: '#ef4444', outlineColor: '#FFFFFF' },
    purple: { color: '#a78bfa', outlineColor: '#000000' },
  };

  // 字幕动效预设描述（与后端 effectsService.SUBTITLE_STYLE_PRESETS 一一对应）
  const SUB_STYLE_LABELS = {
    classic: '经典静态', popup: '弹跳出现', bouncy: '律动跳字',
    karaoke: '卡拉OK 逐字高亮', neon: '霓虹发光', comic: '漫画黄底黑字',
    news: '新闻条 黑底白字', emphasis: '关键词强调',
    fire: '火焰燃烧', shake: '地震抖动', gold: '土豪金',
    matrix: '科技矩阵', film: '电影字幕', pink: '少女粉', wave: '波浪摇摆', zoom: '冲击放大',
  };

  function refreshSubtitlePreview() {
    const stage = document.getElementById('dhSubPreviewStage');
    const el = document.getElementById('dhSubPreviewText');
    if (!el || !stage) return;
    const activeSubtitle = state.subtitleTarget === 'luxury-ad'
      ? getLuxuryAdSubtitlePayload()
      : state.s3.subtitle;
    const styleKey = activeSubtitle.style || 'popup';
    const fontName = ($('#dhSubFont')?.value || '抖音美好体').trim();
    const sizeRaw = parseInt($('#dhSubSize')?.value) || 72;
    const previewSize = Math.max(14, Math.round(sizeRaw * 0.5));
    const userColor = $('#dhSubColor')?.value || '';
    const userOutline = $('#dhSubOutline')?.value || '';

    // 应用样式 key 到预览容器（CSS 在 .dh-sub-preview-stage[data-sub-style=...] 上写）
    stage.dataset.subStyle = styleKey;
    stage.dataset.subPos = (styleKey === 'comic') ? 'top' : 'bottom';

    el.style.fontFamily = `"${fontName}", "Microsoft YaHei", "PingFang SC", sans-serif`;
    el.style.setProperty('--sub-size', previewSize + 'px');
    if (userColor) el.style.setProperty('--sub-color', userColor);
    else el.style.removeProperty('--sub-color');
    if (userOutline) el.style.setProperty('--sub-outline', userOutline);
    else el.style.removeProperty('--sub-outline');

    // 关键词强调样式：把数字/限时词包成 <em>
    const sample = '限时秒杀 仅需99元 立刻抢购';
    if (styleKey === 'emphasis') {
      el.innerHTML = sample
        .replace(/(\d+(?:\.\d+)?[元%折天]?)/g, '<em class="sub-key">$1</em>')
        .replace(/(限时|秒杀|立刻|马上|必抢|爆款|福利|包邮)/g, '<em class="sub-key">$1</em>');
    } else if (styleKey === 'karaoke') {
      // 把字符切开，CSS 动画给每个字依次染黄
      const chars = Array.from(sample);
      el.innerHTML = chars.map((c, i) =>
        c === ' ' ? ' ' : `<em class="sub-kara" style="animation-delay:${i * 0.18}s">${c}</em>`
      ).join('');
    } else {
      el.textContent = sample;
    }
  }

  function setActiveSubStyle(styleKey) {
    if (state.subtitleTarget === 'luxury-ad') {
      state.luxuryAd.subtitle = {
        ...getLuxuryAdSubtitlePayload(),
        style: styleKey,
      };
    } else {
      state.s3.subtitle.style = styleKey;
    }
    $$('.dh-sub-style').forEach(b => b.classList.toggle('active', b.dataset.subStyle === styleKey));
    refreshSubtitlePreview();
  }

  function openSubtitleModal(target = 's3') {
    state.subtitleTarget = target === 'space' ? 'space'
      : (target === 'pdh' ? 'pdh'
        : (target === 'luxury-ad' ? 'luxury-ad' : 's3'));
    const modal = $('#dhSubtitleModal');
    if (modal?.closest('.dh-tab-pane')) {
      ($('#dhApp') || document.body).appendChild(modal);
    }
    const sub = state.subtitleTarget === 'luxury-ad'
      ? getLuxuryAdSubtitlePayload()
      : state.s3.subtitle;
    if ($('#dhSubFont')) $('#dhSubFont').value = sub.fontName || '抖音美好体';
    if ($('#dhSubSize')) $('#dhSubSize').value = sub.fontSize || 72;
    if ($('#dhSubColor')) $('#dhSubColor').value = sub.color || '#FFFFFF';
    if ($('#dhSubOutline')) $('#dhSubOutline').value = sub.outlineColor || '#000000';
    if ($('#dhSubSmartEmphasis')) $('#dhSubSmartEmphasis').checked = sub.smartEmphasis !== false;
    modal.style.display = 'flex';
    setActiveSubStyle(sub.style || 'popup');
  }
  function closeSubtitleModal() { $('#dhSubtitleModal').style.display = 'none'; }
  function applySubPreset(id) {
    const p = SUBTITLE_PRESETS[id];
    if (!p) return;
    $('#dhSubColor').value = p.color;
    $('#dhSubOutline').value = p.outlineColor;
    $$('.dh-sub-preset').forEach(b => b.classList.toggle('active', b.dataset.subPreset === id));
    refreshSubtitlePreview();
  }
  function saveSubtitleSettings() {
    const showInput = state.subtitleTarget === 'space' ? $('#dhSpaceSubtitleOn')
      : state.subtitleTarget === 'pdh' ? $('#pdhSubtitleOn')
        : state.subtitleTarget === 'luxury-ad' ? $('#dhLuxAdSubtitleToggle')
        : $('#dhS3SubtitleOn');
    const nextSubtitle = {
      show: showInput?.checked !== false,
      style: state.subtitleTarget === 'luxury-ad'
        ? (getLuxuryAdSubtitlePayload().style || 'popup')
        : (state.s3.subtitle.style || 'popup'),
      smartEmphasis: $('#dhSubSmartEmphasis')?.checked !== false,
      fontName: $('#dhSubFont')?.value || '抖音美好体',
      fontSize: parseInt($('#dhSubSize')?.value) || 72,
      color: $('#dhSubColor')?.value || '',
      outlineColor: $('#dhSubOutline')?.value || '',
    };
    if (state.subtitleTarget === 'luxury-ad') {
      state.luxuryAd.subtitle = nextSubtitle;
      const toggle = $('#dhLuxAdSubtitleToggle');
      const select = $('#dhLuxAdSubtitle');
      if (toggle) toggle.checked = nextSubtitle.show !== false;
      if (select) select.value = nextSubtitle.show === false ? 'off' : 'on';
      updateLuxuryAdStepLocks();
      saveLuxuryAdDraft({ silent: true }).catch(() => {});
      closeSubtitleModal();
      toast(`字幕已保存：${SUB_STYLE_LABELS[nextSubtitle.style] || nextSubtitle.style}`, 'success');
      return;
    }
    state.s3.subtitle = nextSubtitle;
    const s3On = $('#dhS3SubtitleOn');
    const spaceOn = $('#dhSpaceSubtitleOn');
    const pdhOn = $('#pdhSubtitleOn');
    if (s3On) s3On.checked = state.s3.subtitle.show !== false;
    if (spaceOn) {
      spaceOn.checked = state.s3.subtitle.show !== false;
      state.space.subtitle = state.s3.subtitle.show !== false;
    }
    if (pdhOn) pdhOn.checked = state.s3.subtitle.show !== false;
    closeSubtitleModal();
    toast(`字幕已保存：${SUB_STYLE_LABELS[state.s3.subtitle.style] || state.s3.subtitle.style}`, 'success');
  }

  document.addEventListener('input', (e) => {
    if (e.target.dataset?.luxPersonSpec) {
      const field = e.target.dataset.luxPersonSpec;
      luxuryAdPersonSpec()[field] = e.target.value || '';
      if (state.luxuryAd.storyboardDetailed) {
        state.luxuryAd.storyboardDetailed = false;
        state.luxuryAd.keyframes = [];
      }
      if (state.luxuryAd.personAsset && !state.luxuryAd.personAsset.uploading) {
        state.luxuryAd.personAsset = null;
        state.luxuryAd.keyframes = [];
        renderLuxuryAdPerson();
        updateLuxuryAdStepLocks();
      }
      return;
    }
    if (e.target.dataset?.luxBriefField) {
      saveLuxuryAdBriefField(e.target.dataset.luxBriefField, e.target.value);
      return;
    }
    if (e.target.dataset?.luxOutlineField) {
      saveLuxuryAdOutlineField(e.target.dataset.luxOutlineIndex, e.target.dataset.luxOutlineField, e.target.value);
      return;
    }
    if (e.target.id === 'dhS3Text') updateS3Meta();
    if (e.target.id === 'dhDualScript') updateDualCount();
    if (e.target.id === 'dhVoiceSearch') renderVoices();
    if (e.target.dataset?.vcSpeed) {
      const id = e.target.dataset.vcSpeed;
      const label = document.querySelector(`[data-vc-speed-label="${id}"]`);
      if (label) label.textContent = Number(e.target.value).toFixed(2) + '×';
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.dataset?.luxPersonSpec) {
      const field = e.target.dataset.luxPersonSpec;
      luxuryAdPersonSpec()[field] = e.target.value || '';
      if (state.luxuryAd.storyboardDetailed) {
        state.luxuryAd.storyboardDetailed = false;
        state.luxuryAd.keyframes = [];
        toast('人物配置已变更，请重新生成剧本，避免人物和对白不一致。', 'info');
      }
      if (state.luxuryAd.personAsset && !state.luxuryAd.personAsset.uploading) {
        state.luxuryAd.personAsset = null;
        state.luxuryAd.keyframes = [];
      }
      renderLuxuryAdPerson();
      renderLuxuryAdStoryboard();
      updateLuxuryAdStepLocks();
      return;
    }
    if (e.target.dataset?.luxBriefField) {
      saveLuxuryAdBriefField(e.target.dataset.luxBriefField, e.target.value);
      renderLuxuryAdStoryboard();
      return;
    }
    if (e.target.dataset?.luxOutlineField) {
      saveLuxuryAdOutlineField(e.target.dataset.luxOutlineIndex, e.target.dataset.luxOutlineField, e.target.value);
      renderLuxuryAdStoryboard();
      return;
    }
    if (e.target.id === 'dhS3SubtitleOn') {
      state.s3.subtitle.show = e.target.checked;
      const spaceOn = $('#dhSpaceSubtitleOn');
      if (spaceOn) {
        spaceOn.checked = e.target.checked;
        state.space.subtitle = e.target.checked;
      }
      toast(e.target.checked ? '✅ 字幕已开' : '字幕已关', '');
    }
    if (e.target.id === 'dhSpaceSubtitleOn') {
      state.space.subtitle = e.target.checked;
      state.s3.subtitle.show = e.target.checked;
      const s3On = $('#dhS3SubtitleOn');
      if (s3On) s3On.checked = e.target.checked;
      toast(e.target.checked ? '✅ 字幕已开' : '字幕已关', '');
    }
    if (e.target.id === 'pdhSubtitleOn') {
      state.s3.subtitle.show = e.target.checked;
      toast(e.target.checked ? '✅ 商品字幕已开' : '商品字幕已关', '');
    }
    if (e.target.id === 'dhSubSmartEmphasis') {
      state.s3.subtitle.smartEmphasis = e.target.checked;
    }
    if (e.target.id === 'dhProductFile') {
      uploadProductImage(e.target.files?.[0]);
    }
    if (e.target.id === 'dhS1ProductFile') {
      uploadS1ProductImage(e.target.files?.[0]);
    }
    // 字幕样式弹窗里 select / color input 变化 → 刷预览
    if (['dhSubFont','dhSubSize','dhSubColor','dhSubOutline'].includes(e.target.id)) {
      refreshSubtitlePreview();
    }
  });
  // color input 拖动时实时刷新（input 事件触发频率更高）
  document.addEventListener('input', (e) => {
    if (['dhSubColor','dhSubOutline'].includes(e.target.id)) refreshSubtitlePreview();
  });

  // ══════════════════════════════════════════════════════
  // 商品数字人 Topview双栏（一键生成）
  // ══════════════════════════════════════════════════════
  const pdh = {
    photoTab: 'upload',   // 'upload' | 'ai-gen' | 'my-av'
    gender: 'female',
    style: 'idol_warm',
    personUrl: null,
    productUrl: null,
    productName: '',
    voiceId: '',
    fusedUrl: null,
    motionVideoUrl: null,
    motionTaskId: null,
    motionPollTimer: null,
    savedAvatarId: null,
    selectedAvatarId: '',
    segments: [],
    targetDurationSec: 18,
    running: false,
  };

  // ── 画廊 helpers ──
  function pdhGallery() { return $('#pdhGallery'); }
  function pdhEmptyState() { return $('#pdhEmptyState'); }

  function pdhHideEmpty() {
    const el = pdhEmptyState(); if (el) el.style.display = 'none';
  }

  function pdhAddCard(id, label, tag, tagClass) {
    pdhHideEmpty();
    const gallery = pdhGallery(); if (!gallery) return;
    // 强制 grid 布局，不依赖 CSS（避免老 CSS 缓存导致卡片撑满整列）
    gallery.style.cssText = 'flex:1;overflow-y:auto;padding:20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,240px));gap:16px;align-content:flex-start;justify-content:flex-start';
    const div = document.createElement('div');
    div.className = 'pdh2-prog-card';
    div.id = id;
    div.style.cssText = 'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px;width:100%;box-sizing:border-box';
    div.innerHTML = `
      <div class="pdh2-prog-stage" style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <div class="pdh2-prog-label" style="font-size:12px;font-weight:600;color:rgba(255,255,255,.8)">${label}</div>
        <span class="pdh2-result-tag ${tagClass}" id="${id}Tag" style="padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600">${tag}</span>
        <span class="pdh2-prog-sub" id="${id}Sub" style="font-size:11px;color:var(--dh-text-muted);margin-left:auto"></span>
      </div>
      <div id="${id}Body" style="min-height:40px;display:flex;align-items:center;gap:8px;color:var(--dh-text-muted);font-size:12px">
        <div class="dh-gen-spinner" style="width:14px;height:14px;border-width:2px;margin:0"></div>
        <span id="${id}Msg">准备中…</span>
      </div>`;
    gallery.appendChild(div);
    return div;
  }

  function pdhCardMsg(id, msg) {
    const el = document.getElementById(id + 'Msg'); if (el) el.textContent = msg;
  }
  function pdhCardBody(id, html) {
    const el = document.getElementById(id + 'Body');
    if (!el) return;
    // Reset from the flex/spinner state used during loading
    el.style.cssText = 'display:block;padding:0';
    el.innerHTML = html;
  }
  function pdhCardTag(id, text, cls) {
    const el = document.getElementById(id + 'Tag');
    if (el) { el.textContent = text; el.className = `pdh2-result-tag ${cls}`; }
  }

  function pdhResetForNextTask() {
    pdh.selectedAvatarId = '';
    pdh.voiceId = '';
    pdh.voice = null;
    pdh.segments = [];
    pdh.targetDurationSec = 18;
    pdh.productUrl = null;
    pdh.productName = '';
    pdh.fusedUrl = null;
    pdh.motionVideoUrl = null;
    pdh.motionTaskId = null;
    pdh.savedAvatarId = null;
    state.s3.voiceId = null;
    state.s3.segments = [];
    const voiceInput = $('#pdhVoiceSelect');
    if (voiceInput) voiceInput.value = '';
    const title = $('#pdhVideoTitleInput');
    if (title) title.value = '';
    const script = $('#pdhScriptText');
    if (script) script.value = '';
    pdhRenderVoiceCurrent();
    updatePdhScriptMeta();
    renderPdhTimeline([]);
    pdhSelectProductAvatar('', { silent: true });
    const box = $('#pdhRenderBox');
    if (box) {
      box.innerHTML = `<div class="dh-render-idle">
        <div class="dh-empty-icon">🛍️</div>
        <div>准备好了就开始</div>
        <div style="font-size:12px;color:var(--dh-text-muted);margin-top:12px">先选择商品数字人形象，再生成完整商品口播数字人</div>
      </div>`;
    }
  }

  // ── 人物选择 ──
  function pdhSetPhotoTab(tab) {
    pdh.photoTab = tab;
    $$('[data-pdh-tab]', $('#pdhPhotoTabs')).forEach(b => b.classList.toggle('active', b.dataset.pdhTab === tab));
    $$('[data-pdh-photo-pane]').forEach(el => el.classList.toggle('active', el.dataset.pdhPhotoPane === tab));
    if (tab === 'my-av') pdhLoadMyAv();
  }

  function pdhShowPerson(url) {
    pdh.personUrl = url;
    const preview = $('#pdhPersonPreview');
    const img = $('#pdhPersonImg');
    if (img) img.src = url;
    if (preview) preview.style.display = 'flex';
    // 隐藏上传区和各 pane
    $$('[data-pdh-photo-pane]').forEach(el => el.style.display = 'none');
    $('#pdhPhotoTabs').style.display = 'none';
  }

  function pdhClearPerson() {
    pdh.personUrl = null;
    const preview = $('#pdhPersonPreview'); if (preview) preview.style.display = 'none';
    $$('[data-pdh-photo-pane]').forEach(el => el.style.display = '');
    const tabs = $('#pdhPhotoTabs'); if (tabs) tabs.style.display = '';
    pdhSetPhotoTab(pdh.photoTab);
  }

  async function pdhUploadPerson(file) {
    if (!file || !file.type?.startsWith('image/')) return toast('请上传图片文件', 'error');
    const zone = $('#pdhPersonUpload'); if (zone) zone.style.opacity = '0.5';
    try {
      const fd = new FormData(); fd.append('image', file);
      const r = await fetch('/api/dh/images/upload', { method: 'POST', headers: { Authorization: `Bearer ${state.token}` }, body: fd });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '上传失败');
      pdhShowPerson(j.imageUrl || j.url);
    } catch (e) { toast(e.message, 'error'); }
    finally { if (zone) zone.style.opacity = ''; }
  }

  async function pdhAIGenPerson() {
    const btn = $('#pdhAIGenBtn');
    const status = $('#pdhGenStatus');
    if (btn) btn.disabled = true;
    if (status) status.style.display = 'flex';
    try {
      const r = await api('/api/dh/images/generate', {
        method: 'POST',
        body: { style: pdh.style, gender: pdh.gender, avatar_type: 'normal' },
      });
      if (!r.success) throw new Error(r.error || 'AI 生成失败');
      pdhShowPerson(r.imageUrl);
    } catch (e) { toast(e.message, 'error'); }
    finally {
      if (btn) btn.disabled = false;
      if (status) status.style.display = 'none';
    }
  }

  function pdhLoadMyAv() {
    const grid = $('#pdhProductAvatarGrid') || $('#pdhMyAvGrid');
    if (!grid) return;
    const products = (state.myAvatars || []).filter(a => a.avatar_type === 'product' || a.type === 'product');
    if (!products.length) {
      grid.innerHTML = `<div class="dh-empty" style="font-size:12px;padding:14px;text-align:center">
        <div class="dh-empty-icon" style="font-size:20px">🛍️</div>
        <div>暂无商品数字人形象</div>
        <button type="button" class="dh-link-btn" data-tab-go="step1" data-s1-shortcut="product">去生成形象创建</button>
      </div>`;
      pdhSelectProductAvatar('');
      return;
    }
    if (pdh.selectedAvatarId && !products.some(a => String(a.id) === String(pdh.selectedAvatarId))) {
      pdh.selectedAvatarId = '';
    }
    grid.innerHTML = products.map(a => {
      const img = a.image_url || a.imageUrl || a.photo_url || '';
      const productName = a.product?.name || a.product?.image_name || a.product_image_name || '已融合商品';
      const active = String(a.id) === String(pdh.selectedAvatarId);
      return `<div class="dh-av-card ${active ? 'active' : ''}" data-pdh-product-avatar="${escapeHtml(a.id)}" style="cursor:pointer;border-color:${active ? 'var(--dh-primary)' : ''}">
        <div class="dh-av-thumb">${img ? `<img src="${escapeHtml(img)}" alt="">` : '<div class="dh-av-placeholder">🛍️</div>'}</div>
        <div class="dh-av-name" style="font-size:11px">${escapeHtml(a.name || '商品数字人')}</div>
        <div style="font-size:10px;color:var(--dh-text-muted);padding:0 8px 8px">${escapeHtml(productName)}</div>
      </div>`;
    }).join('');
    renderPdhSelectedAvatar();
    renderPdhProductInfo();
  }

  function pdhSelectedProductAvatar() {
    return (state.myAvatars || []).find(a => String(a.id) === String(pdh.selectedAvatarId)) || null;
  }

  function pdhSelectProductAvatar(id, opts = {}) {
    pdh.selectedAvatarId = id ? String(id) : '';
    const avatar = pdhSelectedProductAvatar();
    const preview = $('#pdhSelectedProductAvatar');
    const img = $('#pdhSelectedProductAvatarImg');
    if (preview) preview.style.display = avatar ? 'flex' : 'none';
    if (img && avatar) img.src = avatar.image_url || avatar.imageUrl || avatar.photo_url || '';
    $$('[data-pdh-product-avatar]').forEach(card => {
      const active = String(card.dataset.pdhProductAvatar) === String(pdh.selectedAvatarId);
      card.classList.toggle('active', active);
      card.style.borderColor = active ? 'var(--dh-primary)' : '';
    });
    renderPdhSelectedAvatar();
    renderPdhProductInfo();
    if (avatar && !opts.silent) toast('已选择商品数字人形象', 'success');
  }

  function pdhProductMeta(avatar = pdhSelectedProductAvatar()) {
    const p = avatar?.product || {};
    return {
      ...p,
      image_url: p.image_url || p.imageUrl || avatar?.product_image_url || '',
      image_name: p.image_name || p.imageName || avatar?.product_image_name || '',
      name: p.name || p.image_name || p.imageName || avatar?.name || '',
      selling_points: p.selling_points || '',
      motion_style: p.motion_style || 'hold',
    };
  }

  function renderPdhSelectedAvatar() {
    const host = $('#pdhSelectedAv');
    if (!host) return;
    const avatar = pdhSelectedProductAvatar();
    if (!avatar) {
      host.innerHTML = `<div class="dh-selected-empty">
        <div class="dh-empty-icon">🛍️</div>
        <div>尚未选择商品数字人形象</div>
        <button class="dh-link-btn" id="pdhPickAvatarBtn" type="button">选择商品形象 →</button>
      </div>`;
      return;
    }
    const img = avatar.image_url || avatar.imageUrl || avatar.photo_url || '';
    const product = pdhProductMeta(avatar);
    host.innerHTML = `
      ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(avatar.name || '商品数字人')}">` : '<div class="dh-selected-empty"><div class="dh-empty-icon">🛍️</div></div>'}
      <div class="av-name">${escapeHtml(avatar.name || '商品数字人')}</div>
      <div class="av-badges"><span class="av-badge source">🛍️ 商品数字人</span><span class="av-badge">${escapeHtml(product.name || '已融合商品')}</span></div>
      <button class="av-switch-btn" id="pdhPickAvatarBtn" type="button">↻ 更换商品形象</button>`;
  }

  function renderPdhProductInfo() {
    const host = $('#pdhProductInfoText');
    if (!host) return;
    const panel = $('#pdhProductInfoPanel');
    const title = $('#pdhProductInfoTitle');
    const avatar = pdhSelectedProductAvatar();
    const product = pdhProductMeta(avatar);
    if (panel) panel.style.display = '';
    if (!avatar) {
      if (title) title.textContent = '商品信息';
      host.textContent = '选择商品数字人形象后读取已融合商品信息，无需再次上传商品图';
      return;
    }
    if (title) title.textContent = '已融合商品';
    host.textContent = ['已融合：' + (product.name || product.image_name || '商品'), product.selling_points || '可在 AI 写稿里补充卖点'].filter(Boolean).join(' · ');
  }

  function openPdhAvatarModal() {
    const m = $('#pdhAvatarModal');
    const grid = $('#pdhProductAvatarGrid') || $('#pdhMyAvGrid');
    if (grid && !(state.myAvatars || []).length) {
      grid.innerHTML = `<div class="dh-empty" style="font-size:12px;padding:18px;text-align:center">
        <div class="dh-gen-spinner" style="width:22px;height:22px;margin:0 auto 10px"></div>
        <div>正在加载商品数字人形象...</div>
      </div>`;
    }
    if (m) m.style.display = 'flex';
    loadMyAvatars().then(() => {
      pdhLoadMyAv();
    }).catch(() => {
      pdhLoadMyAv();
    });
  }

  function closePdhAvatarModal() {
    const m = $('#pdhAvatarModal');
    if (m) m.style.display = 'none';
  }

  async function pdhLoadVoices() {
    await loadVoicesIfNeeded();
    const select = $('#pdhVoiceSelect');
    if (!select) return;
    const list = (state.voices || []).filter(v => v.id && !state.badVoices.has(v.id));
    select.value = pdh.voiceId || '';
    if (pdh.voiceId && !list.some(v => String(v.id) === String(pdh.voiceId))) {
      pdh.voiceId = '';
      select.value = '';
    }
    pdhRenderVoiceCurrent();
  }

  function pdhSelectedVoice() {
    return (state.voices || []).find(v => String(v.id || '') === String(pdh.voiceId || ''))
      || (pdh.voice && String(pdh.voice.id || '') === String(pdh.voiceId || '') ? pdh.voice : null)
      || null;
  }

  function pdhRenderVoiceCurrent() {
    const host = $('#pdhVoiceCurrent');
    if (!host) return;
    const v = pdhSelectedVoice();
    host.innerHTML = v ? `
      <div class="dh-voice-opt-icon">${v.providerIcon || genderIcon(v._gender || v.gender)}</div>
      <div class="dh-voice-opt-body">
        <div class="dh-voice-opt-name">${escapeHtml(v.name || v.id)}</div>
        <div class="dh-voice-opt-sub">${v.isCloned ? '我的声音' : '系统音色'}</div>
      </div>
      ${v.id ? `<button class="dh-voice-opt-preview" data-voice-preview="${escapeHtml(v.id)}" title="试听">▶</button>` : ''}
    ` : `
      <div class="dh-voice-opt-icon">🎙️</div>
      <div class="dh-voice-opt-body">
        <div class="dh-voice-opt-name">请选择配音音色</div>
        <div class="dh-voice-opt-sub">系统会自动适配当前商品视频流程</div>
      </div>
    `;
  }

  function pdhProductMetaForRequest() {
    const productName = ($('#pdhProductNameInput')?.value || pdh.productName || '').trim() || '商品';
    return {
      image_url: pdh.productUrl || '',
      imageUrl: pdh.productUrl || '',
      name: productName,
      image_name: productName,
      topview_image_id: '',
      topview_task_id: '',
    };
  }

  function pdhEnsureVoiceModal() {
    let modal = $('#pdhVoiceModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'pdhVoiceModal';
    modal.className = 'dh-modal dh-space-voice-modal';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="dh-modal-body dh-space-voice-modal-body">
        <div class="dh-modal-head">
          <div>
            <div>选择配音</div>
            <div class="dh-modal-sub">公共音色、我的声音和试听都在这里选择</div>
          </div>
          <button class="dh-link-btn" type="button" data-pdh-voice-close>×</button>
        </div>
        <div class="dh-space-voice-tools">
          <input type="text" id="pdhVoiceModalSearch" class="dh-input dh-input-sm" placeholder="搜索配音名或性别">
        </div>
        <div class="dh-voice-list dh-space-voice-modal-list" id="pdhVoiceModalList"></div>
        <div class="dh-modal-foot">
          <button class="dh-btn dh-btn-ghost" type="button" data-pdh-voice-close>取消</button>
          <button class="dh-btn dh-btn-primary" type="button" data-pdh-voice-close>确认</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    $('#pdhVoiceModalSearch')?.addEventListener('input', pdhRenderVoiceModalList);
    return modal;
  }

  function pdhRenderVoiceModalList() {
    const host = $('#pdhVoiceModalList');
    if (!host) return;
    const q = ($('#pdhVoiceModalSearch')?.value || '').trim().toLowerCase();
    const list = (state.voices || []).filter(v => {
      if (!v.id || state.badVoices.has(v.id)) return false;
      if (!q) return true;
      return `${v.name || ''} ${v.provider || v.providerId || ''} ${v.gender || ''}`.toLowerCase().includes(q);
    });
    list.forEach(v => { v._gender = _inferGender(v); });
    const clones = list.filter(v => v.isCloned);
    const others = list.filter(v => !v.isCloned);
    const byGender = { female: [], male: [], child: [], neutral: [] };
    for (const v of others) (byGender[v._gender || 'neutral'] || byGender.neutral).push(v);
    const groupLabel = { female: '女声', male: '男声', child: '童声', neutral: '其他' };
    const genderIcon = g => ({ female: '女', male: '男', child: '童', auto: '⚡' }[g] || '声');
    const card = v => `<div class="dh-voice-opt ${v.isCloned ? 'cloned' : ''} ${String(v.id) === String(pdh.voiceId || '') ? 'selected' : ''}" data-pdh-voice-id="${escapeHtml(v.id)}">
      <div class="dh-voice-opt-icon">${v.providerIcon || genderIcon(v._gender || v.gender)}</div>
      <div class="dh-voice-opt-body">
        <div class="dh-voice-opt-name">${escapeHtml(v.name || v.id)} <span style="font-size:10px;color:var(--dh-text-muted)">${_genderLabel(v._gender || v.gender)}</span></div>
        <div class="dh-voice-opt-sub">${v.isCloned ? '我的声音' : '系统音色'}</div>
      </div>
      <button class="dh-voice-opt-preview" data-voice-preview="${escapeHtml(v.id)}" title="试听">▶</button>
    </div>`;
    let html = '';
    if (clones.length) html += `<div class="dh-voice-group"><div class="dh-voice-group-title">我的声音（${clones.length}）</div>${clones.map(card).join('')}</div>`;
    for (const g of ['female', 'male', 'child', 'neutral']) {
      const voices = byGender[g] || [];
      if (voices.length) html += `<div class="dh-voice-group"><div class="dh-voice-group-title">${groupLabel[g]}（${voices.length}）</div>${voices.map(card).join('')}</div>`;
    }
    host.innerHTML = html || `<div class="dh-empty" style="padding:20px"><div class="dh-empty-text">暂无可用音色</div></div>`;
  }

  function pdhCloseVoiceModal() {
    const modal = $('#pdhVoiceModal');
    if (modal) modal.style.display = 'none';
  }

  function pdhSelectedVoiceId() {
    const inputValue = ($('#pdhVoiceSelect')?.value || '').trim();
    const cardValue = $('#pdhVoiceCurrent [data-voice-preview]')?.dataset?.voicePreview || '';
    const value = inputValue || pdh.voiceId || cardValue || state.s3.voiceId || '';
    if (value) {
      pdh.voiceId = String(value).trim();
      const input = $('#pdhVoiceSelect');
      if (input && input.value !== pdh.voiceId) input.value = pdh.voiceId;
    }
    return String(value || '').trim();
  }

  function updatePdhScriptMeta() {
    const text = $('#pdhScriptText')?.value || '';
    const count = $('#pdhScriptCount');
    const dur = $('#pdhScriptDur');
    if (count) count.textContent = text.length;
    if (dur) dur.textContent = Math.ceil(text.length / 4);
  }

  async function pdhSegmentScript(durationOverride) {
    const text = ($('#pdhScriptText')?.value || '').trim();
    if (text.length < 10) return toast('台词太短', 'error');
    const target_duration_sec = Number(durationOverride || pdh.targetDurationSec || Math.ceil(text.length / 4) || 18);
    const btn = $('#pdhSegmentBtn');
    if (btn) btn.disabled = true;
    try {
      pdh.segments = buildProductSegmentsLocal(text, target_duration_sec, pdhProductMeta().motion_style || 'hold');
      state.s3.segments = pdh.segments;
      pdh.targetDurationSec = Math.max(...pdh.segments.map(s => Number(s.end) || 0), target_duration_sec);
      renderPdhTimeline(pdh.segments);
      toast(`🧩 已自动拆成 ${pdh.segments.length} 段，总时长 ${pdh.targetDurationSec}s`, 'success');
    } catch (err) {
      toast('拆分失败：' + err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function previewPdhScriptVoice() {
    const text = ($('#pdhScriptText')?.value || '').trim();
    if (text.length < 4) return toast('请先生成或填写台词，再试听整稿', 'error');
    const voiceId = pdhSelectedVoiceId();
    if (!voiceId) {
      toast('请先选择配音音色', 'error');
      pdhOpenVoiceModal();
      return;
    }
    stopAudibleMedia({ reset: true });
    const btn = $('#pdhPreviewScriptBtn');
    const old = btn?.textContent || '';
    if (btn) { btn.disabled = true; btn.textContent = '试听中…'; }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 90000);
    try {
      if (!pdh.segments || !pdh.segments.length) {
        pdh.segments = buildProductSegmentsLocal(text, pdh.targetDurationSec || Math.ceil(text.length / 4), pdhProductMeta().motion_style || 'hold');
        state.s3.segments = pdh.segments;
        renderPdhTimeline(pdh.segments);
      }
      const r = await fetch('/api/dh/tts/preview-voice', {
        method: 'POST',
        signal: ac.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
        body: JSON.stringify({ voice_id: voiceId, text, segments: pdh.segments || [] }),
      });
      if (!r.ok) {
        let detail = '';
        try { detail = (await r.json())?.error || ''; } catch {}
        throw new Error(detail || ('HTTP ' + r.status));
      }
      const blob = await r.blob();
      if (!/^audio\//i.test(blob.type || '') || blob.size < 2048) throw new Error('试听音频为空或格式不可播放');
      const objectUrl = URL.createObjectURL(blob);
      const audio = ensurePreviewAudio();
      audio.src = objectUrl;
      audio.addEventListener('ended', () => URL.revokeObjectURL(objectUrl), { once: true });
      audio.muted = false;
      audio.volume = 1;
      audio.currentTime = 0;
      try { audio.load(); } catch {}
      markDetachedAudio(audio);
      await audio.play();
      toast('正在播放分段语调整稿试听', 'success');
    } catch (err) {
      toast('试听失败：' + (err.name === 'AbortError' ? '整稿试听仍在合成中，请稍后重试或直接合成' : err.message), 'error');
    } finally {
      clearTimeout(timer);
      if (btn) { btn.disabled = false; btn.textContent = old || '▶ 试听整稿'; }
    }
  }

  function renderPdhTimeline(segments) {
    const host = $('#pdhTimelineBody');
    if (!host) return;
    host.innerHTML = (segments || []).map((s, i) => {
      const tone = s.tone || s.delivery || s.voice_tone || 'natural';
      const motion = s.motion || 'natural speaking';
      const expression = s.expression || 'natural';
      const camera = s.camera || 'static';
      return `<div class="dh-tl-row" data-seg-idx="${i}">
        <div class="dh-tl-time">${fmtTime(s.start || 0)}-${fmtTime(s.end || 0)}</div>
        <div class="dh-tl-text">${escapeHtml(s.text || '')}</div>
        <div class="dh-tl-motion">
          <span class="dh-tl-chip">表情 ${escapeHtml(presetLabel(EXPRESSION_PRESETS, expression))}</span>
          <span class="dh-tl-chip">语调 ${escapeHtml(presetLabel(TONE_PRESETS, tone))}</span>
          <span class="dh-tl-chip">动作 ${escapeHtml((motion || '').slice(0, 22))}</span>
          <span class="dh-tl-chip">镜头 ${escapeHtml(presetLabel(CAMERA_PRESETS, camera))}</span>
        </div>
        <button class="dh-tl-edit" data-edit-seg="${i}" title="编辑语气/动作/镜头">✎</button>
      </div>`;
    }).join('');
    const box = $('#pdhTimeline');
    if (box) box.style.display = (segments || []).length ? 'block' : 'none';
  }

  function openPdhWriteModal() {
    const avatar = pdhSelectedProductAvatar();
    if (!avatar) {
      toast('请先选择商品数字人形象', 'error');
      openPdhAvatarModal();
      return;
    }
    const product = pdhProductMeta(avatar);
    state.s3.writeEntry = 'pdh-product';
    state.s3.writeMode = 'product';
    state.s3.product = {
      ...(state.s3.product || {}),
      enabled: true,
      imageUrl: product.image_url || '',
      imageName: product.image_name || product.name || '',
      name: product.name || product.image_name || '',
      selling_points: product.selling_points || '',
      motion_style: product.motion_style || 'hold',
    };
    setWriteMode('product');
    const name = $('#dhProductName');
    const points = $('#dhProductSellingPoints');
    const motion = $('#dhProductMotionStyle');
    if (name && !name.value) name.value = product.name || product.image_name || '';
    if (points && !points.value) points.value = product.selling_points || '';
    if (motion) motion.value = product.motion_style || 'hold';
    openWriteModal();
  }

  async function submitProductAdFromAvatar(avatarId, product = null, opts = {}) {
    const avatar = (state.myAvatars || []).find(a => String(a.id) === String(avatarId)) || null;
    const productMeta = product || avatar?.product || {};
    const productName = productMeta.name || productMeta.image_name || avatar?.name || '商品';
    const voiceId = (opts.voiceId || pdhSelectedVoiceId()).trim();
    const durationSec = Math.max(10, Math.min(60, Number(opts.durationSec) || 18));
    const outputRatio = opts.outputRatio || state.s3.outputRatio || '9:16';
    const outputSize = opts.outputSize || state.s3.outputSize || 'standard';
    const videoTitle = (opts.title || $('#pdhVideoTitleInput')?.value || '').trim();
    const topic = (opts.topic || `${productName} 商品口播视频`).trim();
    const segments = Array.isArray(opts.segments) ? opts.segments : [];
    if (!voiceId) {
      if (avatar) {
        state.selectedAvatar = avatar;
        switchTab('step3');
        renderSelectedAvatar();
      }
      toast('请先在第三步选择配音音色，再生成商品口播视频', 'error');
      return null;
    }
    const r = await api('/api/dh/product-ads/generate', {
      method: 'POST',
      body: {
        avatar_id: avatarId,
        product: productMeta?.image_url ? productMeta : {
          image_url: productMeta.imageUrl || pdh.productUrl || '',
          name: productName,
          image_name: productName,
        },
        topic,
        title: videoTitle || `${productName} 商品口播视频`,
        duration_sec: durationSec,
        segments,
        voice_id: voiceId,
        voice_provider: pdhSelectedVoice()?.providerId || '',
        subtitle: getPdhSubtitlePayload(),
        ...outputPayload(outputRatio, outputSize),
      },
    });
    if (!r.success || !r.taskId) throw new Error(r.error || '提交商品口播视频失败');
    const retryPayload = {
      avatar_id: avatarId,
      product: productMeta?.image_url ? productMeta : {
        image_url: productMeta.imageUrl || pdh.productUrl || '',
        name: productName,
        image_name: productName,
      },
      topic,
      title: videoTitle || `${productName} 商品口播视频`,
      duration_sec: durationSec,
      segments,
      voice_id: voiceId,
      voice_provider: pdhSelectedVoice()?.providerId || '',
      subtitle: getPdhSubtitlePayload(),
      ...outputPayload(outputRatio, outputSize),
    };
    const taskMeta = {
      taskId: r.taskId,
      taskType: 'product_ad',
      avatarName: videoTitle || `${productName} · 商品口播视频`,
      startedAt: Date.now(),
      status: 'submitted',
      stage: 'submitted',
      snapshot: null,
      previewUrl: productMeta.image_url || productMeta.imageUrl || avatar?.image_url || pdh.productUrl || '',
      textPreview: topic,
      retryPayload,
      createDetail: {
        title: videoTitle || `${productName} 商品口播视频`,
        durationSec,
        text: topic,
        avatarId,
        productName,
        backgroundUrl: productMeta.image_url || productMeta.imageUrl || pdh.productUrl || '',
        avatarName: productName,
        voiceId,
        voiceProvider: retryPayload.voice_provider,
        segments,
        outputRatio,
        outputSize,
        resolution: outputPixels(outputRatio, outputSize),
        submittedAt: new Date().toISOString(),
      },
    };
    syncRunningTask(r.taskId, taskMeta);
    pollVideoTask(r.taskId);
    state.activeTaskType = 'product_ad';
    renderTaskCenter();
    renderRunningTasksBanner();
    return r.taskId;
  }

  async function pdhOpenVoiceModal() {
    await pdhLoadVoices();
    const modal = pdhEnsureVoiceModal();
    const search = $('#pdhVoiceModalSearch');
    if (search) search.value = '';
    modal.style.display = 'flex';
    pdhRenderVoiceModalList();
    setTimeout(() => search?.focus(), 30);
  }

  // ── 商品上传 ──
  function pdhShowProduct(url) {
    pdh.productUrl = url;
    const img = $('#pdhProductImg'); if (img) img.src = url;
    const drop = $('#pdhProductDrop'); if (drop) drop.style.display = 'none';
    const preview = $('#pdhProductPreview'); if (preview) preview.style.display = 'flex';
  }

  function pdhClearProduct() {
    pdh.productUrl = null;
    const drop = $('#pdhProductDrop'); if (drop) drop.style.display = 'block';
    const preview = $('#pdhProductPreview'); if (preview) preview.style.display = 'none';
  }

  async function pdhUploadProduct(file) {
    if (!file || !file.type?.startsWith('image/')) return toast('请上传图片文件', 'error');
    const drop = $('#pdhProductDrop'); if (drop) drop.style.opacity = '0.5';
    try {
      const fd = new FormData(); fd.append('image', file);
      const r = await fetch('/api/dh/products/upload', { method: 'POST', headers: { Authorization: `Bearer ${state.token}` }, body: fd });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '上传失败');
      pdh.productName = ($('#pdhProductNameInput')?.value || '').trim() || j.name || '商品';
      pdhShowProduct(j.url);
    } catch (e) { toast(e.message, 'error'); }
    finally { if (drop) drop.style.opacity = ''; }
  }

  // ── 商品数字人：使用已保存的商品形象素材生成完整口播视频 ──
  async function pdhGenerate() {
    if (pdh.running) return;
    const avatar = pdhSelectedProductAvatar();
    const voiceId = pdhSelectedVoiceId();
    if (!avatar) {
      const ok = await DhConfirm({
        title: '还不能生成商品数字人',
        message: '请先选择一个商品数字人形象素材。',
        detail: '商品数字人形象在「生成形象」里创建，保存后会进入「我的形象 → 商品数字人」。',
        confirmText: '去创建商品形象',
        cancelText: '关闭',
        type: 'warning',
      });
      if (ok) { switchTab('step1'); setS1AvatarType('product'); }
      return;
    }
    if (!voiceId) {
      toast('请先选择配音音色，再生成商品口播视频', 'error');
      pdhOpenVoiceModal();
      return;
    }
    pdh.voiceId = voiceId;

    pdh.running = true;
    const product = avatar.product || {};
    const productName = product.name || product.image_name || avatar.name || '商品';
    const videoTitle = ($('#pdhVideoTitleInput')?.value || '').trim();
    const scriptText = ($('#pdhScriptText')?.value || '').trim();
    const topic = scriptText || `${productName} 商品口播视频`;
    if (scriptText && (!pdh.segments || !pdh.segments.length)) {
      await pdhSegmentScript(Math.max(12, Math.ceil(scriptText.length / 4)));
    }

    const btn = $('#pdhGenerateBtn');
    if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }

    pdhHideEmpty();
    const cardId = 'pdhVideo_' + Date.now();
    pdhAddCard(cardId, `商品口播视频`, '提交中', 'pdh2-result-tag-blue');
    pdhCardMsg(cardId, '正在提交商品数字人成片任务…');

    try {
      const taskId = await submitProductAdFromAvatar(avatar.id, product, {
        voiceId,
        topic,
        title: videoTitle || `${productName} 商品口播视频`,
        durationSec: pdh.targetDurationSec || Math.max(12, Math.ceil(topic.length / 4)),
        segments: pdh.segments || [],
        outputRatio: state.s3.outputRatio,
        outputSize: state.s3.outputSize,
      });
      pdhCardTag(cardId, '完成', 'pdh2-result-tag-green');
      pdhCardBody(cardId, `
        <div style="font-size:12px;color:var(--dh-text);line-height:1.7">
          <div>已提交到任务中心</div>
          <div style="color:var(--dh-text-muted)">任务：${escapeHtml(taskId || '')}</div>
          <button type="button" class="dh-btn dh-btn-primary dh-btn-sm" data-tab-go="tasks" style="margin-top:8px;width:100%">查看任务中心</button>
        </div>
      `);
      toast('商品数字人成片已提交到任务中心', 'success');
      pdhResetForNextTask();
      switchTab('tasks');
    } catch (e) {
      pdhCardTag(cardId, '失败', 'pdh2-result-tag-yellow');
      pdhCardBody(cardId, `<span style="color:var(--dh-danger);font-size:12px">${escapeHtml(e.message)}</span>`);
      toast(e.message, 'error');
    } finally {
      pdh.running = false;
      if (btn) { btn.disabled = false; btn.textContent = '生成商品口播视频'; }
    }
  }

  async function pdhSaveToAvatars(imageUrl, productName, productMeta = null) {
    const r = await api('/api/dh/my-avatars', {
      method: 'POST',
      body: {
        name: `商品_${productName}_${Date.now()}`,
        imageUrl,
        avatar_type: 'product',
        source: 'product-dh',
        product: productMeta || { name: productName },
      },
    });
    if (!r.success) throw new Error(r.error || '保存失败');
    const av = r.avatar || r.data;
    if (av) { state.myAvatars.unshift(av); updateAvCountBadge(); }
    return av;
  }

  function pdhOnTabOpen() {
    pdhLoadVoices();
    loadMyAvatars().then(pdhLoadMyAv).catch(() => pdhLoadMyAv());
  }

  function pdhBindEvents() {
    // 照片 tab 切换
    $$('[data-pdh-tab]').forEach(btn => btn.addEventListener('click', () => pdhSetPhotoTab(btn.dataset.pdhTab)));

    // 性别/风格 chips
    $$('[data-pdh-gender]').forEach(b => b.addEventListener('click', () => {
      pdh.gender = b.dataset.pdhGender;
      $$('[data-pdh-gender]').forEach(x => x.classList.toggle('active', x.dataset.pdhGender === pdh.gender));
    }));
    $$('[data-pdh-style]').forEach(b => b.addEventListener('click', () => {
      pdh.style = b.dataset.pdhStyle;
      $$('[data-pdh-style]').forEach(x => x.classList.toggle('active', x.dataset.pdhStyle === pdh.style));
    }));

    // 上传人物
    const personUpload = $('#pdhPersonUpload');
    const personFile = $('#pdhPersonFile');
    if (personUpload) personUpload.addEventListener('click', () => personFile?.click());
    if (personFile) personFile.addEventListener('change', e => { if (e.target.files[0]) pdhUploadPerson(e.target.files[0]); });
    if (personUpload) {
      personUpload.addEventListener('dragover', e => { e.preventDefault(); personUpload.style.borderColor = '#21FFF3'; });
      personUpload.addEventListener('dragleave', () => { personUpload.style.borderColor = ''; });
      personUpload.addEventListener('drop', e => {
        e.preventDefault(); personUpload.style.borderColor = '';
        if (e.dataTransfer.files[0]) pdhUploadPerson(e.dataTransfer.files[0]);
      });
    }

    // AI 生成人物
    const aiGenBtn = $('#pdhAIGenBtn');
    if (aiGenBtn) aiGenBtn.addEventListener('click', pdhAIGenPerson);

    // 从"我的形象"选
    document.addEventListener('click', e => {
      const card = e.target.closest('[data-pdh-pick-av]');
      if (!card) return;
      const av = state.myAvatars?.find(a => String(a.id) === card.dataset.pdhPickAv);
      if (av) { pdhShowPerson(av.imageUrl || av.sampleVideoUrl); toast('已选择形象', 'success'); }
    });

    // 更换人物
    const personResel = $('#pdhPersonResel');
    if (personResel) personResel.addEventListener('click', pdhClearPerson);

    // 上传商品
    const productDrop = $('#pdhProductDrop');
    const productFile = $('#pdhProductFile');
    if (productDrop) productDrop.addEventListener('click', () => productFile?.click());
    if (productFile) productFile.addEventListener('change', e => { if (e.target.files[0]) pdhUploadProduct(e.target.files[0]); });
    if (productDrop) {
      productDrop.addEventListener('dragover', e => { e.preventDefault(); productDrop.style.borderColor = '#21FFF3'; });
      productDrop.addEventListener('dragleave', () => { productDrop.style.borderColor = ''; });
      productDrop.addEventListener('drop', e => {
        e.preventDefault(); productDrop.style.borderColor = '';
        if (e.dataTransfer.files[0]) pdhUploadProduct(e.dataTransfer.files[0]);
      });
    }

    // 更换商品
    const productResel = $('#pdhProductResel');
    if (productResel) productResel.addEventListener('click', pdhClearProduct);

    // 生成商品形象
    const generateBtn = $('#pdhGenerateBtn');
    if (generateBtn) generateBtn.addEventListener('click', pdhGenerate);
    const pdhWriteBtn = $('#pdhWriteBtn');
    if (pdhWriteBtn) pdhWriteBtn.addEventListener('click', openPdhWriteModal);
    const pdhSegmentBtn = $('#pdhSegmentBtn');
    if (pdhSegmentBtn) pdhSegmentBtn.addEventListener('click', () => pdhSegmentScript());
    const pdhPreviewScriptBtn = $('#pdhPreviewScriptBtn');
    if (pdhPreviewScriptBtn) pdhPreviewScriptBtn.addEventListener('click', previewPdhScriptVoice);
    const pdhScriptText = $('#pdhScriptText');
    if (pdhScriptText) pdhScriptText.addEventListener('input', () => { pdh.segments = []; updatePdhScriptMeta(); });
    const pdhSubtitleOn = $('#pdhSubtitleOn');
    if (pdhSubtitleOn) pdhSubtitleOn.addEventListener('change', e => { state.s3.subtitle.show = !!e.target.checked; });
    const pdhSubtitleBtn = $('#pdhSubtitleStyleBtn');
    if (pdhSubtitleBtn) pdhSubtitleBtn.addEventListener('click', () => openSubtitleModal('pdh'));
    const pdhVoiceSelect = $('#pdhVoiceSelect');
    if (pdhVoiceSelect) pdhVoiceSelect.addEventListener('change', e => { pdh.voiceId = e.target.value || ''; });
    const pdhVoiceOpenBtn = $('#pdhVoiceOpenBtn');
    if (pdhVoiceOpenBtn) pdhVoiceOpenBtn.addEventListener('click', pdhOpenVoiceModal);
    const pdhVoiceCurrent = $('#pdhVoiceCurrent');
    if (pdhVoiceCurrent) pdhVoiceCurrent.addEventListener('click', e => {
      if (e.target.closest('[data-voice-preview]')) return;
      pdhOpenVoiceModal();
    });

    // 保存到我的形象（事件委托，因为卡片是动态添加的）
    document.addEventListener('click', async e => {
      const btn = e.target.closest('.pdh2-save-btn');
      if (!btn) return;
      const imageUrl = btn.dataset.pdhSave;
      const productName = btn.dataset.pdhName || '商品';
      if (btn._saving) return;
      btn._saving = true;
      const origText = btn.textContent;
      btn.textContent = '保存中…';
      btn.style.opacity = '0.7';
      try {
        await pdhSaveToAvatars(imageUrl, productName);
        btn.textContent = '✓ 已保存';
        btn.style.background = 'rgba(0,200,80,0.85)';
        toast('已保存到「我的形象」的商品数字人素材', 'success');
        // 自动跳到我的形象 product tab
        setTimeout(() => { switchTab('step2'); window._dhSwitchAvTab('product'); }, 900);
      } catch (err) {
        btn._saving = false;
        btn.textContent = origText;
        btn.style.opacity = '';
        toast(err.message, 'error');
      }
    });
  }

  async function init() {
    if (!state.token) { location.href = '/?login=1'; return; }
    await loadCurrentUserForDh();
    renderLuxuryAdUsage();
    bindUpload();
    setS1AvatarType(state.s1.avatarType || 'normal');
    selectS1ProductMotion(state.s1.product?.motion_style || 'hold');
    renderS1Product();
    renderS1ActionPicker();
    // 绑定自定义背景文件 input 的 change 事件
    const bgFile = document.getElementById('dhS1BgFile');
    if (bgFile) bgFile.addEventListener('change', () => {
      const f = bgFile.files[0];
      if (f) uploadS1Background(f);
      bgFile.value = '';
    });
    // 上传模式 · 一键合成场景图 — 绑事件
    const composeBgFile = document.getElementById('dhComposeBgFile');
    if (composeBgFile) composeBgFile.addEventListener('change', () => {
      const f = composeBgFile.files[0];
      if (f) uploadComposeBg(f);
      composeBgFile.value = '';
    });
    const composePickBtn = document.getElementById('dhComposeBgPickBtn');
    if (composePickBtn) composePickBtn.addEventListener('click', () => composeBgFile?.click());
    const composeClear = document.getElementById('dhComposeBgClear');
    if (composeClear) composeClear.addEventListener('click', clearComposeBg);
    const composeBtn = document.getElementById('dhComposeBtn');
    if (composeBtn) composeBtn.addEventListener('click', runComposeScene);
    document.querySelectorAll('[data-compose-place]').forEach(b => {
      b.addEventListener('click', () => {
        state.s1.compose.placement = b.dataset.composePlace;
        document.querySelectorAll('[data-compose-place]').forEach(x => x.classList.toggle('active', x.dataset.composePlace === state.s1.compose.placement));
      });
    });
    document.querySelectorAll('[data-compose-ratio]').forEach(b => {
      b.addEventListener('click', () => {
        state.s1.compose.ratio = b.dataset.composeRatio;
        document.querySelectorAll('[data-compose-ratio]').forEach(x => x.classList.toggle('active', x.dataset.composeRatio === state.s1.compose.ratio));
      });
    });
    // 上传人物照必须保真：仅允许 fast 抠像合成，不提供 AI 重绘入口。
    function _syncComposeModeUI() {
      state.s1.compose.mode = 'fast';
      document.querySelectorAll('[data-compose-mode]').forEach(x => x.classList.toggle('active', x.dataset.composeMode === state.s1.compose.mode));
      const fastOpts = document.getElementById('dhComposeFastOpts');
      if (fastOpts) fastOpts.style.display = '';
      _composeBtnSync();
    }
    document.querySelectorAll('[data-compose-mode]').forEach(b => {
      b.addEventListener('click', () => {
        state.s1.compose.mode = 'fast';
        _syncComposeModeUI();
      });
    });
    // 人物大小 slider
    const sizeSlider = document.getElementById('dhComposeSize');
    const sizeLabel = document.getElementById('dhComposeSizeLabel');
    if (sizeSlider) sizeSlider.addEventListener('input', () => {
      const v = parseInt(sizeSlider.value, 10);
      state.s1.compose.sizePct = v;
      if (sizeLabel) sizeLabel.textContent = v + '%';
    });
    _syncComposeModeUI();
    const subOn = $('#dhS3SubtitleOn');
    if (subOn) subOn.checked = state.s3.subtitle.show !== false;
    const s1OutputSize = $('#dhS1OutputSize');
    if (s1OutputSize) s1OutputSize.addEventListener('change', e => { state.s1.outputSize = e.target.value || 'standard'; updateOutputHints(); });
    const s3OutputRatio = $('#dhS3OutputRatio');
    if (s3OutputRatio) s3OutputRatio.addEventListener('change', e => { state.s3.outputRatio = e.target.value || '9:16'; updateOutputHints(); });
    const s3OutputSize = $('#dhS3OutputSize');
    if (s3OutputSize) s3OutputSize.addEventListener('change', e => { state.s3.outputSize = e.target.value || 'standard'; updateOutputHints(); });
    const pdhOutputRatio = $('#pdhOutputRatio');
    if (pdhOutputRatio) pdhOutputRatio.addEventListener('change', e => { state.s3.outputRatio = e.target.value || '9:16'; const s3 = $('#dhS3OutputRatio'); if (s3) s3.value = state.s3.outputRatio; updateOutputHints(); });
    const pdhOutputSize = $('#pdhOutputSize');
    if (pdhOutputSize) pdhOutputSize.addEventListener('change', e => { state.s3.outputSize = e.target.value || 'standard'; const s3 = $('#dhS3OutputSize'); if (s3) s3.value = state.s3.outputSize; updateOutputHints(); });
    pdhBindEvents();
    const plazaCat = $('#dhPlazaCategory');
    if (plazaCat) plazaCat.addEventListener('change', e => { state.plaza.category = e.target.value; renderPlaza(); });
    const plazaGen = $('#dhPlazaGender');
    if (plazaGen) plazaGen.addEventListener('change', e => { state.plaza.gender = e.target.value; renderPlaza(); });
    const spaceBgFile = $('#dhSpaceBgFile');
    if (spaceBgFile) spaceBgFile.addEventListener('change', e => {
      const files = e.target.files;
      if (files && files.length) uploadSpaceBackground(files);
      e.target.value = '';
    });
    const spaceBgDrop = $('#dhSpaceBgDrop');
    if (spaceBgDrop) spaceBgDrop.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        $('#dhSpaceBgFile')?.click();
      }
    });
    const spaceVoiceSearch = $('#dhSpaceVoiceSearch');
    if (spaceVoiceSearch) spaceVoiceSearch.addEventListener('input', renderSpaceVoiceOptions);
    const spaceVoiceModalSearch = $('#dhSpaceVoiceModalSearch');
    if (spaceVoiceModalSearch) spaceVoiceModalSearch.addEventListener('input', renderSpaceVoiceOptions);
    const spaceVoiceSelect = $('#dhSpaceVoiceSelect');
    if (spaceVoiceSelect) spaceVoiceSelect.addEventListener('change', e => { state.space.voiceId = e.target.value || ''; });
    const luxuryShotCount = $('#dhLuxuryShotCount');
    if (luxuryShotCount) luxuryShotCount.addEventListener('change', e => {
      state.space.shotCount = Math.max(4, Math.min(8, Number(e.target.value) || 6));
      state.space.segments = [];
      state.space.speechSegments = [];
      state.space.visualSegments = [];
      state.space.keyframes = [];
      renderSpaceAdMode();
    });
    const spaceSubtitle = $('#dhSpaceSubtitleOn');
    if (spaceSubtitle) spaceSubtitle.addEventListener('change', e => { state.space.subtitle = !!e.target.checked; state.s3.subtitle.show = !!e.target.checked; });
    const spaceScenePrompt = $('#dhSpaceScenePrompt');
    if (spaceScenePrompt) spaceScenePrompt.addEventListener('input', e => { state.space.scenePrompt = e.target.value || ''; });
    const spaceCameraPrompt = $('#dhSpaceCameraPrompt');
    if (spaceCameraPrompt) spaceCameraPrompt.addEventListener('input', e => { state.space.cameraPrompt = e.target.value || ''; });
    const spaceDuration = $('#dhSpaceDuration');
    if (spaceDuration) spaceDuration.addEventListener('change', e => { state.space.durationSec = Number(e.target.value) || 30; state.space.segments = []; state.space.speechSegments = []; state.space.visualSegments = []; state.space.keyframes = []; updateSpaceStoryboardButtons(); });
    const spaceOutputRatio = $('#dhSpaceOutputRatio');
    if (spaceOutputRatio) spaceOutputRatio.addEventListener('change', e => { state.space.outputRatio = e.target.value || '16:9'; state.space.segments = []; state.space.speechSegments = []; state.space.visualSegments = []; state.space.keyframes = []; updateOutputHints(); updateSpaceStoryboardButtons(); });
    const spaceOutputSize = $('#dhSpaceOutputSize');
    if (spaceOutputSize) spaceOutputSize.addEventListener('change', e => { state.space.outputSize = e.target.value || 'standard'; state.space.segments = []; state.space.speechSegments = []; state.space.visualSegments = []; state.space.keyframes = []; updateOutputHints(); updateSpaceStoryboardButtons(); });
    const spaceText = $('#dhSpaceText');
    if (spaceText) spaceText.addEventListener('input', () => { state.space.segments = []; state.space.speechSegments = []; state.space.visualSegments = []; state.space.keyframes = []; autoBuildSpacePromptFromManualText(); updateSpaceStoryboardButtons(); });
    const luxAssetFile = $('#dhLuxAdAssetFile');
    if (luxAssetFile) luxAssetFile.addEventListener('change', e => {
      const files = e.target.files;
      if (files && files.length) {
        const rawShotIndex = state.luxuryAd.pendingShotUploadIndex !== null && state.luxuryAd.pendingShotUploadIndex !== undefined
          ? state.luxuryAd.pendingShotUploadIndex
          : e.target.dataset.luxShotUpload;
        const shotIndex = luxuryAdNormalizeShotIndex(rawShotIndex);
        uploadLuxuryAdAssets(files, { shotIndex });
      }
      state.luxuryAd.pendingShotUploadIndex = null;
      delete e.target.dataset.luxShotUpload;
      e.target.value = '';
    });
    const luxBriefRefFile = $('#dhLuxAdBriefRefFile');
    if (luxBriefRefFile) luxBriefRefFile.addEventListener('change', e => {
      const files = e.target.files;
      if (files && files.length) uploadLuxuryAdBriefReferences(files);
      e.target.value = '';
    });
    const luxProductFile = $('#dhLuxAdProductFile');
    if (luxProductFile) luxProductFile.addEventListener('change', e => {
      const files = e.target.files;
      if (files && files.length) uploadLuxuryAdProduct(files);
      e.target.value = '';
    });
    const luxPersonFile = $('#dhLuxAdPersonFile');
    if (luxPersonFile) luxPersonFile.addEventListener('change', e => {
      const files = e.target.files;
      if (files && files.length) uploadLuxuryAdPersonReference(files);
      e.target.value = '';
    });
    const luxBgmFile = $('#dhLuxAdBgmFile');
    if (luxBgmFile) luxBgmFile.addEventListener('change', e => {
      const files = e.target.files;
      if (files && files.length) uploadLuxuryAdBgm(files);
      e.target.value = '';
    });
    const luxBgmUpload = $('#dhLuxAdBgmUpload');
    if (luxBgmUpload) luxBgmUpload.addEventListener('click', () => $('#dhLuxAdBgmFile')?.click());
    const luxMusicLibrary = $('#dhLuxAdMusicLibrary');
    if (luxMusicLibrary) luxMusicLibrary.addEventListener('click', () => searchOpenMusic());
    const bindAudioVolumeSlider = (selector, key, min, max, scale = 100) => {
      const el = $(selector);
      if (!el) return;
      el.addEventListener('input', e => {
        state.luxuryAd[key] = clampLuxuryAudioVolume(Number(e.target.value) / scale, key === 'bgmVolume' ? 0.16 : 1, min, max);
        renderLuxuryAdAudioMix();
      });
      el.addEventListener('change', () => saveLuxuryAdDraft({ silent: true }));
    };
    bindAudioVolumeSlider('#dhLuxAdVoiceVolume', 'voiceVolume', 0.6, 1.2);
    bindAudioVolumeSlider('#dhLuxAdBgmVolume', 'bgmVolume', 0, 0.35);
    document.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target?.id === 'dhOpenMusicQuery') {
        e.preventDefault();
        searchOpenMusic();
      }
      if (e.key === 'Escape') closeOpenMusicModal();
      if (e.key === 'Escape') closeLuxuryStoryboardBriefingModal();
    });
    const luxProductDrop = $('#dhLuxAdProductDrop');
    if (luxProductDrop) {
      luxProductDrop.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (state.luxuryAd.keyframeGenerating) return toast('正在生成画面预览，完成后再替换产品图', 'error');
          $('#dhLuxAdProductFile')?.click();
        }
      });
      luxProductDrop.addEventListener('dragover', e => {
        e.preventDefault();
        if (state.luxuryAd.keyframeGenerating) return;
        luxProductDrop.classList.add('dragover');
      });
      luxProductDrop.addEventListener('dragleave', () => luxProductDrop.classList.remove('dragover'));
      luxProductDrop.addEventListener('drop', e => {
        e.preventDefault();
        luxProductDrop.classList.remove('dragover');
        if (state.luxuryAd.keyframeGenerating) return toast('正在生成画面预览，完成后再替换产品图', 'error');
        if (e.dataTransfer?.files?.length) uploadLuxuryAdProduct(e.dataTransfer.files);
      });
    }
    const luxBriefRefDrop = $('#dhLuxAdBriefRefDrop');
    if (luxBriefRefDrop) {
      luxBriefRefDrop.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (state.luxuryAd.sceneGenerating || state.luxuryAd.scriptGenerating || state.luxuryAd.keyframeGenerating) {
            toast('当前正在处理，请稍后再上传参考图', 'error');
            return;
          }
          $('#dhLuxAdBriefRefFile')?.click();
        }
      });
      luxBriefRefDrop.addEventListener('dragover', e => {
        e.preventDefault();
        if (state.luxuryAd.sceneGenerating || state.luxuryAd.scriptGenerating || state.luxuryAd.keyframeGenerating) return;
        luxBriefRefDrop.classList.add('dragover');
      });
      luxBriefRefDrop.addEventListener('dragleave', () => luxBriefRefDrop.classList.remove('dragover'));
      luxBriefRefDrop.addEventListener('drop', e => {
        e.preventDefault();
        luxBriefRefDrop.classList.remove('dragover');
        if (state.luxuryAd.sceneGenerating || state.luxuryAd.scriptGenerating || state.luxuryAd.keyframeGenerating) {
          toast('当前正在处理，请稍后再上传参考图', 'error');
          return;
        }
        if (e.dataTransfer?.files?.length) uploadLuxuryAdBriefReferences(e.dataTransfer.files);
      });
    }
    const luxAssetDrop = $('#dhLuxAdAssetDrop');
    if (luxAssetDrop) {
      luxAssetDrop.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (state.luxuryAd.keyframeGenerating) {
            toast('正在生成画面预览，完成后再替换素材', 'error');
            return;
          }
          $('#dhLuxAdAssetFile')?.click();
        }
      });
      luxAssetDrop.addEventListener('dragover', e => {
        e.preventDefault();
        if (state.luxuryAd.keyframeGenerating) return;
        luxAssetDrop.classList.add('dragover');
      });
      luxAssetDrop.addEventListener('dragleave', () => luxAssetDrop.classList.remove('dragover'));
      luxAssetDrop.addEventListener('drop', e => {
        e.preventDefault();
        luxAssetDrop.classList.remove('dragover');
        if (state.luxuryAd.keyframeGenerating) {
          toast('正在生成画面预览，完成后再替换素材', 'error');
          return;
        }
        if (e.dataTransfer?.files?.length) uploadLuxuryAdAssets(e.dataTransfer.files);
      });
    }
    const luxText = $('#dhLuxAdText');
    if (luxText) luxText.addEventListener('input', e => {
      state.luxuryAd.content = e.target.value || '';
      state.luxuryAd.briefInfo = null;
      state.luxuryAd.visualReferenceBrief = null;
      state.luxuryAd.assetManifest = null;
      state.luxuryAd.visualLocks = null;
      state.luxuryAd.globalVisualBible = null;
      state.luxuryAd.segments = [];
      state.luxuryAd.storyboardDetailed = false;
      state.luxuryAd.keyframes = [];
      renderLuxuryAdStoryboard();
      setLuxuryProgress('content');
      updateLuxuryAdStepLocks();
    });
    document.addEventListener('change', e => {
      const roleSelect = e.target.closest?.('[data-lux-brief-ref-role]');
      if (!roleSelect) return;
      const idx = Number(roleSelect.dataset.luxBriefRefRole);
      const refs = luxuryAdBriefReferenceAssets();
      if (!Number.isFinite(idx) || !refs[idx]) return;
      refs[idx] = { ...refs[idx], role: roleSelect.value || 'auto', type: roleSelect.value || 'auto' };
      state.luxuryAd.briefRefAssets = refs;
      state.luxuryAd.visualReferenceBrief = null;
      state.luxuryAd.assetManifest = null;
      state.luxuryAd.visualLocks = null;
      state.luxuryAd.globalVisualBible = null;
      state.luxuryAd.briefInfo = null;
      state.luxuryAd.segments = [];
      state.luxuryAd.storyboardDetailed = false;
      state.luxuryAd.keyframes = [];
      renderLuxuryAdBriefRefs();
      renderLuxuryAdStoryboard();
      updateLuxuryAdStepLocks();
      toast('已更新参考图用途，后续会按新角色重新分析素材', 'success');
    });
    const luxDuration = $('#dhLuxAdDuration');
    if (luxDuration) luxDuration.addEventListener('change', e => handleLuxuryAdDurationChange(e.target.value));
    const luxRatio = $('#dhLuxAdRatio');
    if (luxRatio) luxRatio.addEventListener('change', e => { state.luxuryAd.outputRatio = e.target.value || '9:16'; state.luxuryAd.storyboardDetailed = false; state.luxuryAd.globalVisualBible = null; state.luxuryAd.keyframes = []; updateLuxuryAdOutputHint(); renderLuxuryAdStoryboard(); });
    const luxSize = $('#dhLuxAdSize');
    if (luxSize) luxSize.addEventListener('change', e => { state.luxuryAd.outputSize = e.target.value || 'standard'; state.luxuryAd.storyboardDetailed = false; state.luxuryAd.globalVisualBible = null; state.luxuryAd.keyframes = []; updateLuxuryAdOutputHint(); renderLuxuryAdStoryboard(); });
    const luxSubtitle = $('#dhLuxAdSubtitle');
    if (luxSubtitle) luxSubtitle.addEventListener('change', e => {
      state.luxuryAd.subtitle = getLuxuryAdSubtitlePayload(e.target.value !== 'off');
      const toggle = $('#dhLuxAdSubtitleToggle');
      if (toggle) toggle.checked = luxuryAdSubtitleEnabled();
      updateLuxuryAdStepLocks();
      saveLuxuryAdDraft({ silent: true }).catch(() => {});
    });
    const luxSubtitleToggle = $('#dhLuxAdSubtitleToggle');
    if (luxSubtitleToggle) luxSubtitleToggle.addEventListener('change', e => {
      state.luxuryAd.subtitle = getLuxuryAdSubtitlePayload(!!e.target.checked);
      const select = $('#dhLuxAdSubtitle');
      if (select) select.value = luxuryAdSubtitleEnabled() ? 'on' : 'off';
      updateLuxuryAdStepLocks();
      saveLuxuryAdDraft({ silent: true }).catch(() => {});
    });
    const luxAutoEnhance = $('#dhLuxAdAutoEnhance');
    if (luxAutoEnhance) luxAutoEnhance.addEventListener('change', e => { state.luxuryAd.autoEnhance = !!e.target.checked; state.luxuryAd.keyframes = []; renderLuxuryAdStoryboard(); });
    const luxExpandBrief = $('#dhLuxAdExpandBrief');
    if (luxExpandBrief) luxExpandBrief.addEventListener('change', e => { state.luxuryAd.expandBrief = !!e.target.checked; state.luxuryAd.segments = []; state.luxuryAd.storyboardDetailed = false; state.luxuryAd.keyframes = []; renderLuxuryAdStoryboard(); });
    updateOutputHints();
    switchTab(getInitialTab());
    await restoreLuxuryAdProjectFromUrl();
    renderLuxuryAdStoryboard();
    updateLuxuryAdStepLocks();
    await loadMyAvatars();
    renderProductMaterial();
    restoreVideoTasks();
    loadEngineStatus();
  }

  init();
})();
