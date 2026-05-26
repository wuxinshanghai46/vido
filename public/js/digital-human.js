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
    luxuryAd: {
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
      refAssets: [],
      assets: [],
      bgmAsset: null,
      uploading: false,
      pendingShotUploadIndex: null,
      keyframeGenerating: false,
      keyframeProgress: null,
      storyboardDetailed: false,
      segments: [],
      keyframes: [],
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
  const DH_VALID_TABS = ['step1', 'step2', 'step3', 'tasks', 'dual', 'plaza', 'works', 'voice-clone', 'product-dh', 'space-guide', 'luxury-ad'];
  const DH_LAST_TAB_KEY = 'vido_dh_active_tab';
  const SPACE_WORKFLOW_TABS = new Set(['space-guide']);

  function spacePaneForTab(tab) {
    return tab;
  }

  function isLuxuryAdModule() {
    return state.activeTab === 'luxury-ad';
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
      'space-guide': '📢 广告数字人',
      'luxury-ad': '🎞️ 高定广告片',
    }[tab] || '数字人';

    if (tab === 'step2') loadMyAvatars();
    if (tab === 'step3') { renderSelectedAvatar(); loadVoicesIfNeeded(); renderRunningTasksBanner(); }
    if (SPACE_WORKFLOW_TABS.has(tab)) {
      setSpaceModeForActiveTab();
      renderSpaceGuide();
      loadVoicesIfNeeded().then(renderSpaceVoiceOptions);
    }
    if (tab === 'luxury-ad') {
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
      ? '<div class="dh-space-preview-empty"><b>准备好了就开始</b><span>请先选择形象、上传多张参考画面或产品物料，再生成高定分镜关键帧。</span></div>'
      : '<div class="dh-space-preview-empty"><b>准备好了就开始</b><span>请先选择广告数字人形象、上传广告背景，再生成单镜头预览。</span></div>';
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
    if (state.avatarPickReturn === 'space-guide' || state.avatarPickReturn === 'luxury-ad') {
      const returnTab = state.avatarPickReturn;
      state.avatarPickReturn = '';
      renderSelectedAvatar();
      if (returnTab === 'luxury-ad') {
        if (state.luxuryAd.segments?.length) {
          state.luxuryAd.storyboardDetailed = false;
          state.luxuryAd.keyframes = [];
        }
        renderLuxuryAdPerson();
        renderLuxuryAdStoryboard();
        updateLuxuryAdStepLocks();
      } else renderSpaceGuide();
      toast(`已选中「${a.name}」，返回${returnTab === 'luxury-ad' ? '高定广告片' : '广告数字人'}`, 'success');
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
    if (scene === 'space-guide' || scene === 'luxury-ad') {
      renderSelectedAvatar();
      if (scene === 'luxury-ad') {
        if (state.luxuryAd.segments?.length) {
          state.luxuryAd.storyboardDetailed = false;
          state.luxuryAd.keyframes = [];
        }
        renderLuxuryAdPerson();
        renderLuxuryAdStoryboard();
        updateLuxuryAdStepLocks();
      } else renderSpaceGuide();
      toast(`已选中「${it.name}」，用于${scene === 'luxury-ad' ? '高定广告片' : '广告数字人'}`, 'success');
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
          <button class="dh-btn dh-btn-ghost" data-scene="space-guide" type="button">📢 广告数字人</button>
          <button class="dh-btn dh-btn-ghost" data-scene="luxury-ad" type="button">🎞️ 高定广告片</button>
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
        ? '广告数字人信息（产品/场景/卖点/目标人群/优惠，越具体越好）'
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
    const btn = document.querySelector(`[data-voice-preview="${CSS.escape(String(voiceId))}"]`);
    const oldText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '...';
      btn.classList.add('loading');
    }
    toast('正在准备试听...');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);
    try {
      let audio;
      let objectUrl = '';
      if (demoUrl) {
        audio = ensurePreviewAudio();
        audio.src = demoUrl;
      } else {
        const r = await fetch('/api/avatar/preview-voice', {
          method: 'POST',
          signal: ac.signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
          body: JSON.stringify({
            voiceId,
            text: previewText || '你好，这是 VIDO 数字人配音试听。现在你听到的是当前选择的音色。',
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
      if (!isTopviewVoice) {
        state.badVoices.add(voiceId);
        localStorage.setItem('dh_bad_voices', JSON.stringify([...state.badVoices]));
        if (state.s3.voiceId === voiceId) state.s3.voiceId = null;
        renderVoices();
      }
      const msg = err.name === 'AbortError'
        ? '超时'
        : isTopviewVoice
          ? '暂未返回可试听音频，但该音色仍可用于生成视频'
          : err.message;
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
    return `<div class="dh-task-percent">
      <div class="dh-task-percent-ring" style="--p:${pct}"><span>${pct}%</span></div>
      <div class="dh-task-percent-label">&#29983;&#25104;&#20013;</div>
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
    const toneLabel = displayMotionLabel(tone) || presetLabel(TONE_PRESETS, tone);
    const expressionLabel = displayMotionLabel(expression) || presetLabel(EXPRESSION_PRESETS, expression);
    const cameraLabel = displayMotionLabel(camera) || presetLabel(CAMERA_PRESETS, camera);
    const motionLabel = displayMotionLabel(motion);
    const meta = [
      tone && toneLabel ? `语调 ${toneLabel}` : '',
      expression && expressionLabel ? `表情 ${expressionLabel}` : '',
      camera && cameraLabel ? `镜头 ${cameraLabel}` : '',
      motion && motionLabel ? `动作 ${motionLabel}` : '',
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
    if (!max) return `<div class="dh-task-empty-note">暂无分镜/关键帧记录；新的广告任务会在生成中持续写入每个镜头。</div>`;
    return `<div class="dh-task-segment-list dh-task-storyboard-list">${Array.from({ length: max }, (_, i) => {
      const sc = sceneList[i] || {};
      const kf = frameList[i] || {};
      const clip = clipList[i] || {};
      const title = sc.title || kf.title || `镜头 ${i + 1}`;
      const roleRaw = sc.role || kf.role || '';
      const role = roleRaw ? luxuryShotRoleName(roleRaw) : '';
      const voice = sc.voiceover || kf.voiceover || sc.text || '';
      const visual = displayChineseText(sc.visual, sc.scene_content, sc.content_prompt, sc.display_visual, kf.visual, kf.scene_content, kf.content_prompt, kf.display_visual);
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
          ${motion ? `<div class="dh-task-segment-meta">镜头：${escapeHtml(motion)}</div>` : ''}
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  function renderTaskDetailPanel(data = {}) {
    const detail = data.createDetail || {};
    const type = getTaskType(data);
    const snapshot = data.snapshot || {};
    const segments = detail.segments || data.segments || snapshot.segments || data.retryPayload?.segments || [];
    const scenes = detail.scenes || data.scenes || snapshot.scenes || [];
    const keyframes = detail.keyframes || data.keyframes || snapshot.keyframes || [];
    const clips = detail.clips || data.clips || snapshot.clips || data.clip_urls || snapshot.clip_urls || [];
    const subtitle = detail.subtitle || data.subtitle || data.retryPayload?.subtitle || null;
    const basics = taskDetailItems([
      ['任务类型', detail.adMode || getTaskTypeLabel(type)],
      ['标题', detail.title || data.avatarName || ''],
      ['生成时长', detail.durationSec ? `${detail.durationSec}s` : ''],
      ['形象', detail.avatarName || ''],
      ['背景/产品图', detail.backgroundName || detail.productName || ''],
      ['配音', detail.voiceId || '自动/未指定'],
      ['广告风格', detail.adStyle || ''],
      ['镜头数量', detail.shotCount ? `${detail.shotCount} 镜头` : ''],
      ['字幕', subtitle ? (subtitle.show === false ? '关闭' : `${subtitle.style || 'popup'} · ${subtitle.fontSize || 60}px`) : ''],
    ]);
    const script = taskDetailValue(detail.text || data.textPreview || '');
    const prompts = taskDetailItems([
      ['镜头提示词', detail.scenePrompt || ''],
      ['镜头顺序', detail.cameraPrompt || ''],
      ['商品/场景', detail.productName || detail.backgroundName || ''],
    ]);
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
          <div class="dh-task-detail-title">文案</div>
          <div class="dh-task-script-box">${escapeHtml(script || '暂无文案记录')}</div>
        </section>
        <section class="dh-task-create-section dh-task-create-section-wide">
          <div class="dh-task-detail-title">切割与效果</div>
          ${renderTaskSegments(segments)}
        </section>
        <section class="dh-task-create-section dh-task-create-section-wide">
          <div class="dh-task-detail-title">分镜与关键帧</div>
          ${renderTaskStoryboards(scenes, keyframes, clips)}
        </section>
        <section class="dh-task-create-section dh-task-create-section-wide">
          <div class="dh-task-detail-title">镜头/生成描述</div>
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
    (state.luxuryAd.refAssets || state.luxuryAd.assets || []).forEach(revoke);
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
    state.luxuryAd.refAssets = [];
    state.luxuryAd.assets = [];
    state.luxuryAd.bgmAsset = null;
    state.luxuryAd.uploading = false;
    state.luxuryAd.pendingShotUploadIndex = null;
    state.luxuryAd.keyframeGenerating = false;
    state.luxuryAd.keyframeProgress = null;
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
    if (!quiet) toast('已清空高定广告片表单，可以重新创建', 'success');
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
    }[status] || '等待中';
  }

  function getTaskStageText(stage) {
    return {
      prepare_image: '准备形象',
      prepare_audio: '准备语音',
      detecting: '主体检测',
      submitting: '提交渲染',
      submitted: '等待调度',
      polling: '第三方渲染',
      running: '视频生成',
      storyboard: '生成分镜',
      keyframes: '生成关键帧',
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
    if (task?.taskType === 'luxury_ad' || adMode === 'luxury_ad' || generationMode.includes('luxury') || title.includes('高定广告片')) return 'luxury_ad';
    if (task?.taskType === 'product_ad') return 'product_ad';
    if (task?.taskType === 'digital_ad' || task?.taskType === 'space_guide') return 'digital_ad';
    return 'digital_human';
  }

  function getTaskTypeLabel(type) {
    return {
      digital_human: '数字人',
      product_ad: '商品口播视频',
      digital_ad: '广告数字人',
      luxury_ad: '高定广告片',
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
    const meta = state.s3.runningTasks.get(taskId);
    const stored = readVideoTasks().find(x => String(x.taskId) === String(taskId));
    const data = meta || stored;
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
        <div class="dh-task-detail-stage">${escapeHtml(getTaskStageText(data.stage))} · &#24050;&#29992; ${escapeHtml(String(elapsed))}s</div>
      </div>
      <div class="dh-task-detail-percent">${getTaskProgressPercent(data)}%</div>
    </div>
    ${renderProgressPreview(getTaskStageText(data.stage), `${escapeHtml(data.avatarName || '\u5f53\u524d\u4efb\u52a1')}`, elapsed, data)}
    ${detailPanel}`;
  }
  function renderTaskCenter() {
    const host = $('#dhTaskList');
    if (!host) { updateTaskBadge(); return; }
    const tasks = readVideoTasks();
    $$('#dhTaskTypeTabs [data-task-type]').forEach(btn => {
      const type = btn.dataset.taskType;
      const count = tasks.filter(t => getTaskType(t) === type).length;
      btn.classList.toggle('active', type === state.activeTaskType);
      btn.textContent = count ? `${getTaskTypeLabel(type)} ${count}` : getTaskTypeLabel(type);
    });
    updateTaskBadge();
    const scopedTasks = tasks.filter(t => getTaskType(t) === state.activeTaskType);
    if (!scopedTasks.length) {
      host.innerHTML = `<div class="dh-empty">
        <div class="dh-empty-icon">&#8987;</div>
        <div class="dh-empty-text">&#26242;&#26080;${getTaskTypeLabel(state.activeTaskType)}&#20219;&#21153;</div>
        <div class="dh-empty-sub">&#25552;&#20132;&#29983;&#25104;&#21518;&#21487;&#31163;&#24320;&#39029;&#38754;&#32487;&#32493;&#21019;&#24314;&#65292;&#36825;&#37324;&#20250;&#25353;&#31867;&#22411;&#38598;&#20013;&#23637;&#31034;&#36827;&#24230;</div>
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
      const created = t.startedAt ? new Date(t.startedAt).toLocaleString('zh-CN', { hour12: false }) : '--';
      const poster = t.thumbnailUrl || t.thumbnail_url || t.imageUrl || t.image_url || t.previewUrl
        || (t.taskId ? `/api/dh/videos/tasks/${encodeURIComponent(t.taskId)}/thumbnail` : '');
      const posterUrl = poster ? withAuthQuery(poster) : '';
      const taskRatio = String(t.ratio || t.aspectRatio || t.aspect_ratio || t.resolution || '').toLowerCase();
      const ratioClass = taskRatio.includes('16:9') || taskRatio.includes('1280x720') || taskRatio.includes('1920x1080')
        ? ' dh-task-thumb-landscape'
        : (taskRatio.includes('1:1') || taskRatio.includes('960x960') ? ' dh-task-thumb-square' : '');
      const preview = active
        ? `<div class="dh-task-thumb dh-task-thumb-running">${renderTaskPercentBlock(t)}</div>`
        : (t.videoUrl
          ? `<div class="dh-task-thumb dh-task-thumb-done${ratioClass}" data-task-preview="${escapeHtml(t.taskId)}" title="&#28857;&#20987;&#25918;&#22823;&#39044;&#35272;">
               ${posterUrl ? `<img class="dh-task-thumb-video" src="${escapeHtml(posterUrl)}" loading="lazy" decoding="async" alt="">` : ''}
               <span class="dh-task-thumb-play">&#9654;</span>
             </div>`
          : `<div class="dh-task-thumb dh-task-thumb-empty">${getTaskStatusText(t.status)}</div>`);
      const video = '';
      const error = t.error ? `<div class="dh-task-error">${escapeHtml(t.error)}</div>` : '';
      const subtitle = t.subtitleWarning
        ? `<div class="dh-task-warning">${escapeHtml(t.subtitleWarning)}</div>`
        : (t.subtitleBurned ? `<div class="dh-task-ok">&#23383;&#24149;&#24050;&#28903;&#24405;&#21040;&#35270;&#39057;</div>` : '');
      const progressBar = active ? `<div class="dh-task-progress-bar"><i style="width:${progressPct}%"></i></div>` : '';
      const canRetry = ['error', 'invalid', 'timeout'].includes(String(t.status || ''));
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
            <span>${getTaskStageText(t.stage)}</span>
            <span>${active ? `${progressPct}%` : escapeHtml(getTaskStatusText(t.status))}</span>
            <span>&#24050;&#29992; ${escapeHtml(elapsed)}</span>
          </div>
          ${progressBar}
          <div class="dh-task-text">${escapeHtml(t.textPreview || '')}</div>
          ${video}${subtitle}${error}
          <div class="dh-task-actions">
            ${t.videoUrl ? `<button class="dh-btn dh-btn-primary dh-btn-sm" data-task-preview="${escapeHtml(t.taskId)}">&#9654; &#25918;&#22823;&#39044;&#35272;</button>` : ''}
            ${canRetry ? `<button class="dh-btn dh-btn-primary dh-btn-sm" data-task-retry="${escapeHtml(t.taskId)}">&#8635; &#37325;&#26032;&#25552;&#20132;</button>` : ''}
            <button class="dh-btn dh-btn-ghost dh-btn-sm" data-task-focus="${escapeHtml(t.taskId)}">&#26597;&#30475;&#35814;&#24773;</button>
            ${t.videoUrl ? `<a class="dh-btn dh-btn-ghost dh-btn-sm" href="${escapeHtml(withAuthQuery(t.videoUrl))}" download>&#19979;&#36733;</a>` : ''}
            <button class="dh-btn dh-btn-ghost dh-btn-sm" data-tab-go="works">&#20316;&#21697;&#24211;</button>
            <button class="dh-btn dh-btn-ghost dh-btn-sm" data-task-remove="${escapeHtml(t.taskId)}">&#31227;&#38500;</button>
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
            title: t.title || payload?.title || detail.title || oldTask.avatarName || '广告数字人',
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
        toast(type === 'luxury_ad' ? '旧高定广告片任务缺少重提参数，请回高定广告片页面确认画面、文案和音色后提交' : '旧广告任务缺少重提参数，请回广告数字人页面确认背景、文案和音色后提交', 'error');
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
        avatarName: payload.title || oldTask.avatarName || '广告数字人',
        startedAt: Date.now(),
        status: 'submitted',
        stage: 'submitted',
        snapshot: null,
        previewUrl: r.keyframeUrl || payload.keyframes?.[0]?.image_url || payload.background_url || oldTask.previewUrl || '',
        textPreview: payload.text || oldTask.textPreview || '',
        retryPayload: payload,
        createDetail: {
          ...(oldTask.createDetail || {}),
          title: payload.title || oldTask.createDetail?.title || oldTask.avatarName || '广告数字人',
          durationSec: payload.duration_sec,
          text: payload.text || oldTask.textPreview || '',
          avatarId: payload.avatar_id || '',
          backgroundUrl: payload.background_url || '',
          voiceId: payload.voice_id || '',
          scenePrompt: payload.scene_prompt || '',
          cameraPrompt: payload.camera_prompt || '',
          adMode: payload.ad_mode === 'luxury_ad' ? '高定广告片' : '普通广告数字人',
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
      toast(type === 'luxury_ad' ? '已重新提交高定广告片任务' : '已重新提交广告数字人任务', 'success');
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
          <div class="av-badges"><span class="av-badge">${isLuxury ? '高定广告片' : '广告数字人'}</span><span class="av-badge">静态图驱动</span></div>
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
    const card = v => `<div class="dh-voice-opt ${v.isCloned ? 'cloned' : ''} ${String(v.id) === String(current) ? 'selected' : ''}" ${voiceDataAttr}="${escapeHtml(v.id)}">
      <div class="dh-voice-opt-icon">${v.providerIcon || genderIcon(v._gender || v.gender)}</div>
      <div class="dh-voice-opt-body">
        <div class="dh-voice-opt-name">${escapeHtml(v.name || v.id)} <span style="font-size:10px;color:var(--dh-text-muted)">${_genderLabel(v._gender || v.gender)}</span></div>
        <div class="dh-voice-opt-sub">${v.isCloned ? '我的声音' : '系统音色'}</div>
      </div>
      ${v.id ? `<button class="dh-voice-opt-preview" data-voice-preview="${escapeHtml(v.id)}" title="试听">▶</button>` : ''}
    </div>`;
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
          <div class="dh-voice-opt-sub">广告数字人必须选择一个可用音色后才能生成</div>
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
    if (host) host.innerHTML = html;
    if (modalHost) modalHost.innerHTML = html;
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
      file = await compressImageBeforeUpload(file);
      const fd = new FormData();
      fd.append('image', file);
      const r = await api('/api/dh/images/upload', { method: 'POST', body: fd });
      if (!r.success) throw new Error(r.error || '上传失败');
      const imageUrl = r.imageUrl || r.url || r.image_url || r.data?.imageUrl || r.data?.url || r.data?.image_url || '';
      if (!imageUrl) throw new Error('上传成功但没有返回图片地址');
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
    const images = files.filter(f => f?.type?.startsWith('image/')).slice(0, 8);
    if (!images.length) return toast('请上传图片文件', 'error');
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
        const compressed = await compressImageBeforeUpload(images[i]);
        const fd = new FormData();
        fd.append('image', compressed);
        const r = await api('/api/dh/images/upload', { method: 'POST', body: fd });
        if (!r.success) throw new Error(r.error || `第 ${i + 1} 张上传失败`);
        const imageUrl = r.imageUrl || r.url || r.image_url || r.data?.imageUrl || r.data?.url || r.data?.image_url || '';
        if (!imageUrl) throw new Error(`第 ${i + 1} 张上传成功但没有返回图片地址`);
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

  function setLuxuryAdReferenceAssets(refs = []) {
    const next = (Array.isArray(refs) ? refs : []).slice(0, 8);
    state.luxuryAd.refAssets = next;
    state.luxuryAd.assets = next;
    return next;
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
    return hasProduct || hasReference || !!state.selectedAvatar;
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
    if (!host) return;
    const current = state.luxuryAd.voiceId || '';
    const v = (state.voices || []).find(x => String(x.id || '') === String(current) && !state.badVoices.has(x.id));
    if (!v) {
      host.innerHTML = `<div class="dh-voice-opt-icon">TV</div>
        <div class="dh-voice-opt-body">
          <div class="dh-voice-opt-name">未选择配音</div>
          <div class="dh-voice-opt-sub">高定广告片必须手动选择声音</div>
        </div>`;
      return;
    }
    v._gender = _inferGender(v);
    const genderIcon = g => ({ female: '👩', male: '👨', child: '🧒', auto: '⚡' }[g] || '🎙️');
    host.innerHTML = `<div class="dh-voice-opt-icon">${v.providerIcon || genderIcon(v._gender || v.gender)}</div>
      <div class="dh-voice-opt-body">
        <div class="dh-voice-opt-name">${escapeHtml(v.name || v.id)} <span style="font-size:10px;color:var(--dh-text-muted)">${_genderLabel(v._gender || v.gender)}</span></div>
        <div class="dh-voice-opt-sub">${v.isCloned ? '我的声音' : '系统音色'}</div>
      </div>
      ${v.id ? `<button class="dh-voice-opt-preview" data-voice-preview="${escapeHtml(v.id)}" title="试听">▶</button>` : ''}`;
  }

  function luxuryAdHasBgm() {
    const bgm = state.luxuryAd.bgmAsset || {};
    return !!(bgm.file_url || bgm.file_path || bgm.url || bgm.path);
  }

  function renderLuxuryAdBgm() {
    const card = $('#dhLuxAdBgmCard');
    const status = $('#dhLuxAdBgmStatus');
    if (!card || !status) return;
    const bgm = state.luxuryAd.bgmAsset || null;
    const ready = luxuryAdHasBgm();
    card.classList.toggle('ready', ready);
    status.textContent = ready
      ? (bgm.original_name || bgm.name || '背景音乐已配置，成片合成后叠加')
      : '未配置，可先合成无配乐广告片';
  }

  function luxuryAssetPreviewUrl(asset = {}) {
    const raw = asset.previewUrl || asset.url || '';
    if (!raw) return '';
    return /^blob:/i.test(raw) ? raw : withAuthQuery(raw);
  }

  function renderLuxuryAdAssets() {
    const host = $('#dhLuxAdAssets');
    const productHost = $('#dhLuxAdProductAsset');
    const product = state.luxuryAd.productAsset || null;
    if (productHost) {
      const url = product ? luxuryAssetPreviewUrl(product) : '';
      productHost.innerHTML = url
        ? `<button type="button" class="dh-luxgen-product-card" data-lux-product-preview title="点击预览主产品图">
            <img src="${escapeHtml(url)}" alt="${escapeHtml(product.name || '主产品图')}">
            <b>主产品</b><span>${escapeHtml(product.name || '已上传产品图')}</span>
          </button>`
        : product?.uploading
          ? `<div class="dh-luxgen-product-empty uploading"><b>主商品图上传中</b><span>${escapeHtml(product.name || '正在上传')}</span></div>`
        : `<div class="dh-luxgen-product-empty">未上传主产品图</div>`;
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
        ? `<button type="button" class="dh-luxgen-asset" data-lux-asset-preview="${i}" title="点击预览第 ${i + 1} 镜画面：${escapeHtml(img.name || `分镜画面 ${i + 1}`)}">
            ${url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(img.name || `分镜画面 ${i + 1}`)}">` : ''}
            <b>${String(i + 1)}</b>${img.uploading && !url ? '<span>上传中</span>' : ''}
          </button>`
        : `<div class="dh-luxgen-asset ghost">${String(i + 1)}</div>`;
    }).join('');
  }

  function selectedAvatarImageUrl(a = state.selectedAvatar || {}) {
    return a.image_url || a.photo_url || a.cover_url || a.thumbnail_url || (a.id ? `/api/dh/my-avatars/${a.id}/thumbnail` : '');
  }

  function renderLuxuryAdPerson() {
    const host = $('#dhLuxAdPersonCurrent');
    if (!host) return;
    const a = state.selectedAvatar;
    if (!a) {
      host.innerHTML = `<span>未选</span><div class="dh-luxgen-person-copy"><b>不选人物也可以生成</b><small>人物只作为身份参考，不是动态站桩数字人。</small></div><button class="dh-btn dh-btn-ghost" id="dhLuxAdPickPerson" type="button">选择人物形象</button>`;
      return;
    }
    const src = selectedAvatarImageUrl(a);
    const isVideo = !!(a.sample_video_url || a.video_url);
    host.innerHTML = `<div class="dh-luxgen-person-thumb">${src ? `<img src="${escapeHtml(withAuthQuery(src))}" alt="${escapeHtml(a.name || '人物形象')}" data-fallback-src="${escapeHtml(withAuthQuery(a.image_url || a.photo_url || ''))}" onerror="window.__dhAvatarImageFallback&&window.__dhAvatarImageFallback(this)">` : '已选'}</div>
      <div class="dh-luxgen-person-copy"><b>${escapeHtml(a.name || '已选人物')}</b><small>${isVideo ? '已选视频/动态素材，但高定广告片只取身份参考来重绘进镜头。' : '作为人物身份参考，生成关键帧时会重绘融合到场景里。'}</small></div>
      <button class="dh-btn dh-btn-ghost" id="dhLuxAdPickPerson" type="button">更换人物</button>`;
  }

  function setLuxuryProgress(step = 'content') {
    const aliases = {
      assets: 'product',
      content: 'copy',
      storyboard: 'storyboard',
      frames: 'frames',
      keyframes: 'clips',
      video: 'final',
    };
    const normalized = aliases[step] || step;
    const order = ['copy', 'storyboard', 'product', 'frames', 'clips', 'final'];
    const activeIndex = Math.max(0, order.indexOf(normalized));
    $$('#dhLuxAdProgress > div').forEach((el, i) => el.classList.toggle('active', i <= activeIndex));
    const flowIndex = activeIndex;
    $$('.dh-luxgen-flow > span').forEach((el, i) => el.classList.toggle('active', i <= flowIndex));
  }

  function luxuryAdAssetSummary() {
    const product = state.luxuryAd.productAsset;
    const refs = luxuryAdReferenceAssets();
    return [
      product ? `主产品：${product.name || '已上传产品图'}` : '',
      ...refs
      .map((x, i) => (x?.url || x?.previewUrl || x?.name) ? `第${i + 1}镜画面：${x.name || '已上传图片'}` : '')
    ]
      .filter(Boolean)
      .join('；');
  }

  function luxuryAdGateState() {
    const text = ($('#dhLuxAdText')?.value || state.luxuryAd.content || '').trim();
    const segments = state.luxuryAd.segments || [];
    const refs = luxuryAdRefs();
    const keyframes = state.luxuryAd.keyframes || [];
    const contentReady = text.length >= 6;
    const storyboardReady = segments.length > 0;
    const detailedReady = !!state.luxuryAd.storyboardDetailed;
    const landingAssetsReady = luxuryAdHasLandingAssets();
    const productReady = !!state.luxuryAd.productAsset?.url && !state.luxuryAd.uploading;
    const assetsReady = contentReady;
    const previewReady = detailedReady && storyboardReady && keyframes.length >= segments.length && segments.every((_, i) => !!(keyframes[i]?.image_url || keyframes[i]?.imageUrl));
    let step = 0;
    let hint = '第 1 步：先描述你想做什么广告片，AI 只会先规划镜头数量、故事顺序和需要准备的画面。';
    if (state.luxuryAd.uploading) { step = 2; hint = '素材/分镜画面上传中，请稍等。'; }
    else if (!contentReady) { step = 0; hint = '第 1 步：写广告设想/需求；可以自己写，也可以点击 AI 帮我写。'; }
    else if (contentReady && !storyboardReady) { step = 1; hint = '第 2 步：让 AI 先判断大概需要几个分镜、每镜负责什么、需要哪些素材。'; }
    else if (storyboardReady && !detailedReady) {
      step = landingAssetsReady ? 3 : 2;
      hint = landingAssetsReady
        ? '第 4 步：素材已进入，可以生成专业分镜；这一步才会给出景别、时长、镜头提示词、成片广告词和转场。'
        : '第 3 步：可上传主商品、场景图或选择人物参考；也可以直接让 AI 自动生成画面和人物。';
    }
    else if (assetsReady && contentReady && storyboardReady && !previewReady) {
      step = refs.length ? 4 : 3;
      hint = refs.length
        ? `第 5 步：已上传 ${Math.max(0, refs.length - (productReady ? 1 : 0))} 张分镜/场景画面，专业分镜已生成，可以生成关键帧预览。`
        : '第 4 步：专业分镜已生成；下一步先生成静态关键帧预览。';
    }
    if (state.luxuryAd.keyframeGenerating) { step = 4; hint = state.luxuryAd.keyframeProgress?.message || '第 5 步：正在按分镜顺序生成每段镜头预览，请稍等。'; }
    if (assetsReady && contentReady && storyboardReady && previewReady) {
      step = 5;
      if (!state.luxuryAd.voiceId) hint = '关键帧预览已完成。下一步：先手动选择配音音色，再合成完整广告。';
      else hint = '第 6 步：关键帧预览已完成，合成时会逐镜生成动态视频并剪成完整广告片。';
    }
    return { text, refs, segments, keyframes, contentReady, storyboardReady, detailedReady, landingAssetsReady, productReady, assetsReady, previewReady, step, hint };
  }

  function setLuxuryButtonLock(selector, disabled, reason = '') {
    const el = $(selector);
    if (!el) return;
    el.disabled = !!disabled;
    if (reason) el.title = reason;
    else el.removeAttribute('title');
    el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  }

  function updateLuxuryAdStepLocks() {
    const gate = luxuryAdGateState();
    setLuxuryButtonLock('#dhLuxAdGenerate', state.luxuryAd.keyframeGenerating || !gate.contentReady, '请先写广告设想/需求，或点击 AI 帮我写');
    setLuxuryButtonLock(
      '#dhLuxAdStoryboard',
      state.luxuryAd.keyframeGenerating || !(gate.contentReady && gate.storyboardReady),
      !gate.contentReady ? '请先写广告设想/需求' : (!gate.storyboardReady ? '请先生成场景顺序' : '')
    );
    setLuxuryButtonLock('#dhLuxAdPreviewFrames', state.luxuryAd.keyframeGenerating || !(gate.contentReady && gate.storyboardReady && gate.detailedReady), !gate.storyboardReady ? '请先让 AI 分析场景顺序' : (!gate.detailedReady ? '请先根据素材生成专业分镜' : ''));
    const submitLocked = state.luxuryAd.keyframeGenerating
      || !(gate.contentReady && gate.storyboardReady && gate.previewReady)
      || !state.luxuryAd.voiceId;
    const submitReason = !gate.previewReady
      ? '请先生成关键帧预览'
      : (!state.luxuryAd.voiceId ? '请先手动选择配音音色' : '');
    setLuxuryButtonLock('#dhLuxAdConfirmGenerate', submitLocked, submitReason);
    const stepActions = [
      ['#dhLuxAdGenerate', gate.storyboardReady],
      ['#dhLuxAdStoryboard', gate.detailedReady],
      ['#dhLuxAdPreviewFrames', gate.previewReady],
      ['#dhLuxAdConfirmGenerate', false],
    ];
    let nextSelector = '';
    if (gate.contentReady && !gate.storyboardReady) nextSelector = '#dhLuxAdGenerate';
    else if (gate.contentReady && gate.storyboardReady && !gate.detailedReady) nextSelector = '#dhLuxAdStoryboard';
    else if (gate.contentReady && gate.storyboardReady && gate.detailedReady && !gate.previewReady) nextSelector = '#dhLuxAdPreviewFrames';
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
      if (copy) copy.textContent = locked ? '正在生成关键帧预览，暂不可替换画面' : (refCount ? `已上传 ${refCount} 张分镜画面，继续上传会追加到后面` : '按镜头顺序上传分镜画面，不替换主商品');
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
        ? (state.luxuryAd.keyframeProgress?.message || '正在生成关键帧预览，请稍等。')
        : `当前：${gate.hint}`;
    }
    renderLuxuryAdBgm();
    const requirementState = $('#dhLuxAdRequirementState');
    if (requirementState) {
      requirementState.textContent = gate.contentReady ? '广告设想已填写' : '第一步：待填写';
      requirementState.classList.toggle('ready', gate.contentReady);
    }
    const productState = $('#dhLuxAdProductState');
    if (productState) {
      productState.textContent = gate.productReady ? '主商品已锁定' : (state.luxuryAd.uploading ? '上传中' : '可选上传');
      productState.classList.toggle('ready', gate.productReady);
    }
    const frameState = $('#dhLuxAdFrameState');
    if (frameState) {
      const refCount = luxuryAdReferenceAssets().filter(x => x.url || x.previewUrl).length;
      frameState.textContent = refCount ? `已上传 ${refCount} 张` : '可选上传';
      frameState.classList.toggle('ready', refCount > 0);
    }

    $$('.dh-luxgen-flow > span').forEach((el, i) => {
      el.classList.toggle('done', i < gate.step);
      el.classList.toggle('active', i === gate.step);
      el.classList.toggle('locked', i > gate.step);
    });
    $$('.dh-luxgen-steps > div').forEach((el, i) => {
      el.classList.toggle('done', i < gate.step);
      el.classList.toggle('active', i === gate.step);
      el.classList.toggle('locked', i > gate.step);
    });
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
    if (subtitle) subtitle.value = state.luxuryAd.subtitle === false ? 'off' : 'on';
    const subtitleToggle = $('#dhLuxAdSubtitleToggle');
    if (subtitleToggle) subtitleToggle.checked = state.luxuryAd.subtitle !== false;
    const autoEnhance = $('#dhLuxAdAutoEnhance');
    if (autoEnhance) autoEnhance.checked = state.luxuryAd.autoEnhance !== false;
    const expandBrief = $('#dhLuxAdExpandBrief');
    if (expandBrief) expandBrief.checked = state.luxuryAd.expandBrief !== false;
    $$('[data-lux-ad-type]').forEach(b => b.classList.toggle('active', b.dataset.luxAdType === (state.luxuryAd.adType || 'auto')));
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
      <div class="dh-luxgen-writer-modal" role="dialog" aria-modal="true" aria-label="AI 帮我写高定广告片内容">
        <div class="dh-luxgen-writer-head">
          <div>
            <h3>AI 帮我写高定广告片内容</h3>
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
    const file = Array.from(fileList instanceof FileList ? fileList : (Array.isArray(fileList) ? fileList : [fileList])).find(f => f?.type?.startsWith('image/'));
    if (!file) return toast('请上传商品图片文件', 'error');
    if (state.luxuryAd.productAsset?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(state.luxuryAd.productAsset.previewUrl);
    state.luxuryAd.productAsset = {
      name: file.name || '主产品图',
      url: '',
      previewUrl: '',
      uploading: true,
    };
    state.luxuryAd.uploading = true;
    state.luxuryAd.keyframes = [];
    if (state.luxuryAd.segments?.length) state.luxuryAd.storyboardDetailed = false;
    renderLuxuryAdAssets();
    renderLuxuryAdStoryboard();
    updateLuxuryAdStepLocks();
    setLuxuryProgress('assets');
    toast('主产品图正在上传…');
    try {
      const compressed = await compressImageBeforeUpload(file);
      const fd = new FormData();
      fd.append('image', compressed);
      const r = await api('/api/dh/images/upload', { method: 'POST', body: fd });
      if (!r.success) throw new Error(r.error || '产品图上传失败');
      const imageUrl = r.imageUrl || r.url || r.image_url || r.data?.imageUrl || r.data?.url || r.data?.image_url || '';
      if (!imageUrl) throw new Error('产品图上传成功但没有返回图片地址');
      state.luxuryAd.productAsset = { ...state.luxuryAd.productAsset, url: imageUrl, previewUrl: imageUrl, uploading: false };
      state.luxuryAd.uploading = false;
      renderLuxuryAdAssets();
      updateLuxuryAdStepLocks();
      toast('主商品已上传，可用于后续镜头锁定广告主体', 'success');
    } catch (err) {
      state.luxuryAd.uploading = false;
      state.luxuryAd.productAsset = state.luxuryAd.productAsset ? { ...state.luxuryAd.productAsset, uploading: false } : null;
      renderLuxuryAdAssets();
      updateLuxuryAdStepLocks();
      toast('主产品图上传失败：' + err.message, 'error');
    }
  }

  async function uploadLuxuryAdAssets(fileList, { shotIndex = null } = {}) {
    if (state.luxuryAd.keyframeGenerating) return toast('正在生成画面预览，完成后再替换素材', 'error');
    const targetShot = luxuryAdNormalizeShotIndex(shotIndex);
    const currentRefs = luxuryAdReferenceAssets();
    const filledCount = currentRefs.filter(luxuryAdAssetFilled).length;
    const maxCount = targetShot !== null ? 1 : Math.max(0, 8 - filledCount);
    const files = Array.from(fileList instanceof FileList ? fileList : (Array.isArray(fileList) ? fileList : [fileList])).filter(f => f?.type?.startsWith('image/')).slice(0, maxCount);
    if (!files.length) return toast('请按镜头顺序上传场景、品牌、质感或细节画面', 'error');
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
        previewUrl: '',
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
    state.luxuryAd.uploading = true;
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
      for (let i = 0; i < files.length; i++) {
        const idx = targetShot !== null ? targetAssetIndex : assignedIndexes[i];
        if (!Number.isFinite(idx) || idx < 0) continue;
        const compressed = await compressImageBeforeUpload(files[i]);
        const fd = new FormData();
        fd.append('image', compressed);
        const r = await api('/api/dh/images/upload', { method: 'POST', body: fd });
        if (!r.success) throw new Error(r.error || `第 ${i + 1} 张上传失败`);
        const imageUrl = r.imageUrl || r.url || r.image_url || r.data?.imageUrl || r.data?.url || r.data?.image_url || '';
        if (!imageUrl) throw new Error(`第 ${i + 1} 张上传成功但没有返回图片地址`);
        state.luxuryAd.refAssets[idx] = { ...state.luxuryAd.refAssets[idx], url: imageUrl, previewUrl: imageUrl, uploading: false };
        setLuxuryAdReferenceAssets(state.luxuryAd.refAssets);
        renderLuxuryAdAssets();
        renderLuxuryAdStoryboard();
        updateLuxuryAdStepLocks();
      }
      state.luxuryAd.uploading = false;
      updateLuxuryAdStepLocks();
      toast(targetShot !== null ? `第 ${targetShot + 1} 个分镜画面已绑定，主商品图保持不变` : `已按空位追加 ${assignedIndexes.length} 张分镜画面，主商品图保持不变`, 'success');
    } catch (err) {
      state.luxuryAd.uploading = false;
      setLuxuryAdReferenceAssets(luxuryAdReferenceAssets().map(x => x ? ({ ...x, uploading: false }) : x));
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
        volume: 0.18,
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
    const text = [state.luxuryAd.content || '', state.luxuryAd.productAsset?.name || ''].join(' ');
    if (/钢|金属|板材|建材|材料|材质/i.test(text)) return 'material';
    if (/墙|艺术墙|背景墙|展墙/i.test(text)) return 'wall';
    return 'product';
  }

  function luxuryFallbackCopyByRole(role = '') {
    const r = String(role || '').toLowerCase();
    const isMaterial = ['material', 'wall'].includes(luxuryProductSubjectForCopy());
    const material = {
      hook: '一眼看见材质的高级感',
      display: '让材料成为空间主角',
      macro: '纹理在光影里更清晰',
      benefit: '高级空间，需要高级材质',
      proof: '细节经得起近看',
      cta: '定制方案，现在咨询',
    };
    const product = {
      hook: '第一眼，就记住它',
      display: '主角登场，价值看得见',
      macro: '细节被放大，质感被看见',
      benefit: '真实场景里，更懂需求',
      proof: '每一处细节，都是选择理由',
      cta: '现在咨询，了解更多方案',
    };
    const map = isMaterial ? material : product;
    return map[r] || map.display;
  }

  function luxuryFallbackVisualByRole(role = '') {
    const r = String(role || '').toLowerCase();
    const isMaterial = ['material', 'wall'].includes(luxuryProductSubjectForCopy());
    const material = {
      hook: '纯净深色背景或高端空间中，材料被一束侧光缓慢带出，表面纹理先被看见，再过渡到下一镜。',
      display: '中远景缓慢推进到完整应用画面，顶部灯光扫过表面，建立空间高级感和产品第一印象。',
      macro: '极近景贴近材质表面横向平移，纹理、边缘、反光和工艺细节被逐层放大。',
      benefit: '切入真实会所、展厅或设计空间，材料作为空间视觉中心，与灯光、墙面和陈设自然融合。',
      proof: '轻微环绕或移焦强调核心卖点，让观众看到材质差异、定制质感和经得起近看的细节。',
      cta: '固定收尾镜头留出字幕和行动引导空间，主商品与品牌记忆点清晰停留。',
    };
    const product = {
      hook: '干净背景中，主商品以克制光线缓慢出现，先建立品牌第一印象，再过渡到完整展示。',
      display: '中远景缓慢推进到主商品完整形态，主体位于画面中心，环境只服务于产品识别。',
      macro: '极近景贴近产品细节和关键结构，光线沿边缘移动，强调质感、做工和核心卖点。',
      benefit: '切入真实使用场景，主商品解决需求的瞬间被看见，画面保持高级、真实和克制。',
      proof: '用特写或轻微环绕强化一个可记忆卖点，让观众看见选择它的理由。',
      cta: '固定收尾镜头保留干净留白，品牌记忆和行动引导自然出现。',
    };
    const map = isMaterial ? material : product;
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

  function luxuryAdTopviewPrompt(seg = {}, index = 0) {
    const binding = luxuryAdShotBoundAssets(seg, index);
    const visual = String(seg.display_visual || seg.visual || seg.scene || '').trim();
    const motion = luxuryShotMotionLabel(seg);
    const productTag = '@主商品';
    const refTag = binding.ref ? ` 和 @分镜画面${binding.refIndex}` : '';
    const existing = String(seg.topview_prompt || seg.reference_prompt || '').trim();
    if (existing && !/@(?:参考|分镜画面)\d+/.test(existing)) return existing;
    if (existing && binding.ref) {
      const sameRef = new RegExp(`@(参考|分镜画面)${binding.refIndex}(?!\\d)`);
      if (sameRef.test(existing)) {
        return existing.replace(new RegExp(`@参考${binding.refIndex}(?!\\d)`, 'g'), `@分镜画面${binding.refIndex}`);
      }
    }
    return `使用 ${productTag}${refTag} 生成这一镜头：${visual || '按镜头任务呈现商品'}。镜头运动：${motion}。保持主商品身份、材质和构图稳定，不生成画面文字。`;
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
        reference_index: refIndex,
        reference_label: label,
        reference_mentions: refIndex > 0 ? ['@主商品', label] : ['@主商品'],
        topview_prompt: luxuryAdTopviewPrompt({ ...seg, reference_index: refIndex }, i),
        material_usage: luxuryShotMaterialUsage({ ...seg, reference_index: refIndex }, i),
        material_hint: luxuryShotMaterialUsage({ ...seg, reference_index: refIndex }, i),
        other: luxuryShotOtherText(seg),
      };
    });
  }

  function compactLuxurySegments(segments = []) {
    return applyLuxuryShotBindings(segments).map((seg, i) => ({
      index: i,
      title: seg.title || `镜头 ${i + 1}`,
      role: seg.role || seg.shot_role || 'display',
      story_stage: luxuryNormalizeSceneStage(seg.story_stage, seg.shot_role || seg.role || seg.type, i, segments.length || 5),
      shot_size: seg.shot_size || seg.framing || '',
      shot_angle: luxuryShotAngleText(seg),
      objective: seg.objective || seg.intent || seg.purpose || '',
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
      camera: seg.camera || seg.camera_motion || seg.motion || '',
      camera_label: seg.camera_label || luxuryShotMotionLabel(seg),
      reference_index: luxuryAdShotRefIndex(seg, i),
      reference_label: luxuryAdReferenceLabel(luxuryAdShotRefIndex(seg, i)),
      topview_prompt: luxuryAdTopviewPrompt(seg, i),
      material_usage: luxuryShotMaterialUsage(seg, i),
      material_hint: luxuryShotMaterialUsage(seg, i),
      other: luxuryShotOtherText(seg),
      transition: seg.transition || '',
      lighting_style: seg.lighting_style || seg.lighting || '',
      product_subject: seg.product_subject || '',
    }));
  }

  function compactLuxuryKeyframes(keyframes = [], segments = []) {
    const cleanSegments = compactLuxurySegments(segments);
    return (Array.isArray(keyframes) ? keyframes : []).map((kf, i) => {
      const seg = cleanSegments[i] || {};
      return {
        index: i,
        image_url: compactLuxuryUrl(kf.image_url || kf.imageUrl || ''),
        keyframe_id: kf.keyframe_id || kf.id || '',
        title: kf.title || seg.title || `镜头 ${i + 1}`,
        role: kf.role || seg.role || 'display',
        story_stage: luxuryNormalizeSceneStage(kf.story_stage || seg.story_stage, kf.role || seg.role, i, keyframes.length || segments.length || 5),
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
        camera: kf.camera || seg.camera || '',
        camera_label: kf.camera_label || seg.camera_label || '',
        reference_index: Number(kf.reference_index ?? seg.reference_index ?? 0),
        reference_label: kf.reference_label || seg.reference_label || '',
        active_reference_image: compactLuxuryUrl(kf.active_reference_image || ''),
      };
    }).filter(k => k.image_url);
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
      copy_direction: '这一镜最终给观众听到或看到的话，会在专业分镜阶段生成。',
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
    toast('已删除分镜，可以继续新增或重新生成专业分镜', 'success');
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
    const shotNames = ['开场分镜', '第二场景', '细节分镜', '场景转折', '卖点分镜', '收尾分镜', '补充场景', '记忆点'];
    const product = state.luxuryAd.productAsset || null;
    const productUrl = product ? luxuryAssetPreviewUrl(product) : '';
    const productUploading = !!product?.uploading && !productUrl;
    const refCount = luxuryAdReferenceAssets().filter(luxuryAdAssetFilled).length;
    host.innerHTML = `<div class="dh-luxgen-outline-board">
      <div class="dh-luxgen-outline-note">
        <b>先梳理场景顺序</b>
        <span>这里先把你的广告设想拆成“第 1 个分镜 → 第 2 个分镜 → 后续分镜 → 结束分镜”的制作清单。每个分镜先说明它在广告里干什么，再上传对应画面；下一步才补齐景别、镜头提示词、成片广告词和转场。</span>
        <div class="dh-luxgen-outline-note-actions">
          <button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-lux-outline-add>新增分镜</button>
        </div>
      </div>
      <div class="dh-luxgen-outline-product-summary">
        <div class="dh-luxgen-outline-product-copy">
          <b>主商品图：${productUrl ? '已上传 1 张' : (productUploading ? '上传中' : '未上传')}</b>
          <span>主商品图只用来锁定整条广告围绕哪个商品或产品系列；分镜画面才是一镜一张，用来放开场、场景、细节、人物、收尾等不同画面。</span>
          <small>参考案例可以理解为 1 个核心产品 + 6 张分镜画面，不是 6 个不同商品。</small>
        </div>
        <div class="dh-luxgen-outline-product-media">
          ${productUrl
            ? `<button type="button" class="dh-luxgen-product-card compact" data-lux-product-preview title="点击预览主商品图"><img src="${escapeHtml(productUrl)}" alt="${escapeHtml(product.name || '主商品图')}"><b>主商品</b><span>${escapeHtml(product.name || '已上传')}</span></button>`
            : productUploading
              ? `<div class="dh-luxgen-product-empty uploading"><b>主商品图上传中</b><span>${escapeHtml(product.name || '正在上传')}</span></div>`
            : `<button type="button" class="dh-btn dh-btn-ghost" id="dhLuxAdProductDropInline">上传主商品图</button>`}
          <span>分镜画面 ${refCount}/${segments.length || 0}</span>
        </div>
      </div>
      ${segments.map((seg, i) => {
        const roleValue = seg.stage_user_edited
          ? (seg.role || seg.shot_role || seg.type || luxuryAdDefaultRoleForIndex(i, segments.length || 1))
          : luxuryAdDefaultRoleForIndex(i, segments.length || 1);
        const role = luxuryShotRoleName(roleValue);
        const sequenceTitle = `第 ${i + 1} 个分镜`;
        const stage = luxuryNormalizeSceneStage(seg.stage_user_edited ? seg.story_stage : '', roleValue, i, segments.length || shotNames.length) || shotNames[i] || role;
        const title = seg.title || sequenceTitle;
        const objective = String(seg.objective || seg.intent || seg.purpose || luxuryShotVisualText(seg) || '确定这一镜的广告任务').replace(/\s+/g, ' ').slice(0, 110);
        const materialNeed = luxuryAdOutlineMaterialNeed(seg, i);
        const copyDirection = String(seg.copy_direction || seg.ad_copy || seg.voiceover || seg.narration || seg.subtitle || '').replace(/\s+/g, ' ').slice(0, 70) || '素材进入后生成成片广告词';
        const binding = luxuryAdShotBoundAssets(seg, i);
        const bound = binding.ref ? `已绑定 @分镜画面${binding.refIndex}` : '待上传/AI补图';
        const preview = binding.ref?.url || binding.ref?.previewUrl || '';
        const previewUrl = preview ? luxuryAssetPreviewUrl({ url: preview }) : '';
        const uploading = !!binding.ref?.uploading;
        return `<section class="dh-luxgen-outline-card">
          <div class="dh-luxgen-outline-side">
            <div class="dh-luxgen-outline-index">
              <span>${String(i + 1).padStart(2, '0')}</span>
              <b>${escapeHtml(sequenceTitle)}</b>
              <small>${escapeHtml(stage)}</small>
            </div>
            <button type="button" class="dh-luxgen-thumb dh-luxgen-outline-thumb ${preview ? 'has-image' : 'pending'}" ${preview ? `data-lux-shot-preview="${i}" title="点击预览"` : 'disabled'}>
              ${preview ? `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(sequenceTitle)}">` : `<span class="${uploading ? 'uploading' : ''}">${uploading ? '上传中...' : '待上传画面'}</span>`}
            </button>
            <div class="dh-luxgen-outline-bind">
              <span class="${preview ? 'ok' : ''}">${escapeHtml(uploading ? '上传中...' : bound)}</span>
              <button type="button" class="dh-luxgen-shot-upload" data-lux-shot-upload="${i}">${preview ? '替换该镜画面' : '上传该镜画面'}</button>
            </div>
          </div>
          <div class="dh-luxgen-outline-main">
            <div class="dh-luxgen-outline-top">
              <label class="dh-field">
                <span>分镜编号</span>
                <input class="dh-input" value="${escapeHtml(sequenceTitle)}" readonly>
              </label>
              <label class="dh-field">
                <span>这个分镜在片子里的位置</span>
                <select class="dh-input" data-lux-outline-field="role" data-lux-outline-index="${i}">
                  ${[
                    ['hook', '第 1 个分镜（开场）'],
                    ['display', '第 2 个分镜（承接）'],
                    ['macro', '第 3 个分镜（细节）'],
                    ['benefit', '中段分镜（场景/价值）'],
                    ['proof', '后段分镜（证明/强化）'],
                    ['cta', '结束分镜（收尾）'],
                  ].map(([value, label]) => `<option value="${value}" ${String(roleValue) === value ? 'selected' : ''}>${label}</option>`).join('')}
                </select>
              </label>
              <div class="dh-luxgen-outline-row-actions">
                <button type="button" class="dh-luxgen-edit" data-lux-shot-edit="${i}">高级修改</button>
                <button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-lux-outline-add="${i}">后面新增</button>
                <button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-lux-outline-move="up" data-lux-outline-index="${i}" ${i === 0 ? 'disabled' : ''}>上移</button>
                <button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-lux-outline-move="down" data-lux-outline-index="${i}" ${i === segments.length - 1 ? 'disabled' : ''}>下移</button>
                <button type="button" class="dh-btn dh-btn-ghost dh-btn-sm danger" data-lux-outline-delete="${i}">删除</button>
              </div>
            </div>
            <div class="dh-luxgen-outline-fields">
              <label class="dh-field">
                <span>这个分镜是干嘛的</span>
                <textarea class="dh-input" rows="3" data-lux-outline-field="objective" data-lux-outline-index="${i}">${escapeHtml(objective)}</textarea>
              </label>
              <label class="dh-field">
                <span>这个分镜需要什么画面</span>
                <textarea class="dh-input" rows="3" data-lux-outline-field="material_need" data-lux-outline-index="${i}">${escapeHtml(materialNeed)}</textarea>
              </label>
              <label class="dh-field">
                <span>观众听到/看到什么话</span>
                <textarea class="dh-input" rows="3" data-lux-outline-field="copy_direction" data-lux-outline-index="${i}">${escapeHtml(copyDirection)}</textarea>
              </label>
            </div>
            <div class="dh-luxgen-outline-footer">
              <span>当前只做场景顺序规划，暂不生成景别、时长和镜头运动。</span>
              <span class="dh-luxgen-status working">待专业分镜</span>
            </div>
          </div>
        </section>`;
      }).join('')}
    </div>`;
    updateLuxuryAdStepLocks();
  }

  function renderLuxuryAdStoryboard() {
    const host = $('#dhLuxAdStoryboardHost');
    if (!host) return;
    const segments = applyLuxuryShotBindings(state.luxuryAd.segments || []);
    const keyframes = state.luxuryAd.keyframes || [];
    if (!segments.length) {
      host.innerHTML = `<div class="dh-luxgen-empty">
        <b>还没有场景顺序</b>
        <span>先写广告设想/需求。AI 会先判断大概需要几个分镜、每个分镜负责什么、需要准备哪些画面；上传素材后才生成景别、时长、镜头提示词、成片广告词和转场。</span>
      </div>`;
      updateLuxuryAdStepLocks();
      return;
    }
    if (!state.luxuryAd.storyboardDetailed) {
      renderLuxuryAdOutline(host, segments);
      return;
    }
    const shotNames = ['开场分镜', '第二场景', '细节分镜', '场景转折', '卖点分镜', '收尾分镜', '补充场景', '记忆点'];
    host.innerHTML = `<table class="dh-luxgen-table dh-luxgen-sequence-table">
      <thead>
        <tr>
          <th style="width:96px">分镜号</th>
          <th style="width:190px">分镜使用素材（画面）</th>
          <th style="width:190px">拍摄角度及镜头（景别）</th>
          <th style="width:84px">时长（秒）</th>
          <th style="width:300px">镜头内容提示词</th>
          <th style="width:220px">成片旁白 / 字幕广告词</th>
          <th style="width:240px">其他</th>
          <th style="width:110px">状态</th>
          <th style="width:90px">操作</th>
        </tr>
      </thead>
      <tbody>
      ${segments.map((seg, i) => {
        const kf = keyframes[i] || {};
        const img = kf.image_url || kf.imageUrl || '';
        const binding = luxuryAdShotBoundAssets(seg, i);
        const boundImage = binding.ref?.url || binding.ref?.previewUrl || '';
        const preview = img || boundImage;
        const previewUrl = preview ? luxuryAssetPreviewUrl({ url: preview }) : '';
        const previewState = img ? 'has-image' : (preview ? 'pending-ref' : 'pending');
        const materialName = binding.items.map(x => `${x.label} ${x.name}`).join(' / ');
        const progressIndex = Number(state.luxuryAd.keyframeProgress?.current || 0);
        const isGeneratingShot = state.luxuryAd.keyframeGenerating && !img && i >= progressIndex;
        const refUploading = !!binding.ref?.uploading && !preview;
        const status = img ? '已生成静态预览' : (refUploading ? '上传中' : (isGeneratingShot ? '生成中' : '待生成关键帧'));
        const isLockedReference = String(kf.reference_mode || '').includes('reference_locked');
        const shotRole = luxuryShotRoleName(seg.shot_role || seg.role || seg.type);
        const storyStage = luxuryNormalizeSceneStage(seg.story_stage, seg.shot_role || seg.role || seg.type, i, segments.length || shotNames.length) || shotRole || shotNames[i] || '广告镜头';
        const shotSize = seg.shot_size || seg.framing || '';
        const shotAngle = luxuryShotAngleText(seg) || shotSize;
        const shotDuration = luxuryShotDurationLabel(seg, state.luxuryAd.durationSec, segments.length);
        const shotPurpose = String(seg.intent || seg.purpose || seg.objective || shotRole || '广告镜头').trim();
        const voiceText = luxuryShotNarrationText(seg);
        const promptText = luxuryShotContentPrompt(seg);
        const motionText = luxuryShotMotionLabel(seg);
        const materialUsage = luxuryShotMaterialUsage(seg, i);
        const otherText = luxuryShotOtherText(seg);
        return `<tr>
          <td>
            <div class="dh-luxgen-shot-cell">
              <span class="dh-luxgen-shot-no">${String(i + 1).padStart(2, '0')}</span>
              <b class="dh-luxgen-shot-title">${escapeHtml(seg.title || shotNames[i] || '镜头')}</b>
            </div>
          </td>
          <td>
            <button type="button" class="dh-luxgen-thumb ${previewState}" data-shot="${escapeHtml(img ? '已生成静态预览' : (binding.ref ? `分镜画面 ${binding.refIndex}` : '待上传场景图'))}" ${preview ? `data-lux-shot-preview="${i}" title="点击预览"` : 'disabled'}>${preview ? `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(seg.title || `镜头 ${i + 1}`)}">` : `<span class="${refUploading ? 'uploading' : ''}">${refUploading ? '上传中...' : '待上传场景图'}</span>`}</button>
            <div class="dh-luxgen-mini-bindings">${binding.items.map(item => `<span class="dh-luxgen-binding">${escapeHtml(item.label)}</span>`).join('')}</div>
            <button type="button" class="dh-luxgen-shot-upload" data-lux-shot-upload="${i}">${binding.ref ? '替换场景图' : '上传场景图'}</button>
          </td>
          <td>
            <div class="dh-luxgen-shot-plan"><b>${escapeHtml(storyStage)}</b><span>${escapeHtml(shotAngle || '按分镜生成镜头')}</span><small>${escapeHtml(shotPurpose)}</small></div>
          </td>
          <td><div class="dh-luxgen-shot-plan"><b>${escapeHtml(shotDuration.replace('s', ''))}</b></div></td>
          <td><div class="dh-luxgen-shot-visual"><b>${escapeHtml(promptText)}</b><span>镜头运动：${escapeHtml(motionText)}</span></div></td>
          <td><div class="dh-luxgen-shot-copy"><b>${escapeHtml(voiceText || '待生成广告词')}</b><span>观众最终听到或看到的话，不是镜头说明</span></div></td>
          <td><div class="dh-luxgen-shot-copy"><b>${escapeHtml(otherText)}</b><span class="dh-luxgen-material-name" title="${escapeHtml(materialName || materialUsage)}">${escapeHtml(materialUsage)}</span></div></td>
          <td><span class="dh-luxgen-status ${img ? 'ready' : ''} ${isGeneratingShot ? 'working' : ''}">${escapeHtml(status)}</span><span class="dh-luxgen-tag">${img ? (isLockedReference ? '已锁定参考' : '静态预览') : '待预览'}</span></td>
          <td>
            <div class="dh-luxgen-action-stack">
              <button type="button" class="dh-luxgen-edit" data-lux-shot-edit="${i}">修改</button>
              <button type="button" class="dh-btn dh-btn-ghost dh-btn-sm danger" data-lux-outline-delete="${i}">删除</button>
            </div>
          </td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>`;
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
      camera: ($('#dhLuxShotMotion')?.value || seg.camera || '').trim(),
      camera_label: ($('#dhLuxShotMotion')?.value || seg.camera_label || '').trim(),
      motion: ($('#dhLuxShotMotion')?.value || seg.motion || '').trim(),
      style_note: ($('#dhLuxShotOther')?.value || seg.style_note || '').trim(),
      other: ($('#dhLuxShotOther')?.value || seg.other || '').trim(),
      topview_prompt: ($('#dhLuxShotTopviewPrompt')?.value || seg.topview_prompt || '').trim(),
      reference_prompt: ($('#dhLuxShotTopviewPrompt')?.value || seg.reference_prompt || '').trim(),
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
    set('#dhLuxShotMotion', seg.motion || seg.camera_label || seg.camera);
    set('#dhLuxShotOther', seg.style_note || seg.other);
    set('#dhLuxShotTopviewPrompt', seg.topview_prompt || seg.reference_prompt);
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
          person_asset: state.selectedAvatar ? {
            id: state.selectedAvatar.id || '',
            name: state.selectedAvatar.name || '',
            type: state.selectedAvatar.avatar_type || state.selectedAvatar.type || '',
          } : null,
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
            <p>修改的是这一段场景的画面、广告词和镜头运动；保存后旧预览会失效，需要重新生成对应关键帧预览后再合成。</p>
          </div>
          <button class="dh-icon-btn" type="button" data-lux-shot-close>×</button>
        </div>
        <div class="dh-luxgen-writer-body">
          <div class="dh-luxgen-ai-edit">
            <label class="dh-field">
              <span>AI 修改要求</span>
              <textarea class="dh-input" id="dhLuxShotAiInstruction" rows="3" placeholder="把你想要的效果写给 AI，例如：这一镜从门店外景推进到产品细节，画面更有高级感，广告词像品牌片，不要写成说明文。"></textarea>
            </label>
            <div class="dh-luxgen-ai-edit-actions">
              <small>AI 会根据广告设想、当前分镜、素材绑定和你的要求，回填场景目标、镜头内容提示词、成片广告词、风格和转场。</small>
              <button class="dh-btn dh-btn-ghost" type="button" id="dhLuxShotAiRewrite">AI 修改这一镜</button>
            </div>
          </div>
          <div class="dh-luxgen-writer-grid">
            <label class="dh-field">
              <span>镜头名称</span>
              <input class="dh-input" id="dhLuxShotTitle" value="${escapeHtml(seg.title || '')}" maxlength="24">
            </label>
            <label class="dh-field">
              <span>场景顺序 / 分镜阶段</span>
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
            <textarea class="dh-input" id="dhLuxShotVoice" rows="3" placeholder="写观众最终听到或看到的话，例如：一眼看见材质的高级感。不要写镜头说明或提示词。">${escapeHtml(luxuryShotNarrationText(seg))}</textarea>
          </label>
          <label class="dh-field">
            <span>镜头运动</span>
            <textarea class="dh-input" id="dhLuxShotMotion" rows="3">${escapeHtml(luxuryShotMotionLabel(seg))}</textarea>
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

  async function buildLuxuryAdStoryboard({ autoNext = false, detail = false } = {}) {
    const text = ($('#dhLuxAdText')?.value || state.luxuryAd.content || '').trim();
    const refs = luxuryAdRefs();
    if (!text) return toast('请先输入广告设想、产品介绍或一句需求', 'error');
    if (detail && !state.luxuryAd.segments?.length) return toast('请先生成场景顺序，再生成专业分镜', 'error');
    state.luxuryAd.content = text;
    state.luxuryAd.durationSec = Number($('#dhLuxAdDuration')?.value || state.luxuryAd.durationSec || 30);
    state.luxuryAd.outputRatio = $('#dhLuxAdRatio')?.value || state.luxuryAd.outputRatio || '9:16';
    state.luxuryAd.outputSize = $('#dhLuxAdSize')?.value || state.luxuryAd.outputSize || 'standard';
    state.luxuryAd.subtitle = $('#dhLuxAdSubtitleToggle')
      ? !!$('#dhLuxAdSubtitleToggle')?.checked
      : (($('#dhLuxAdSubtitle')?.value || 'on') !== 'off');
    const btn = detail ? $('#dhLuxAdStoryboard') : (autoNext ? $('#dhLuxAdGenerate') : $('#dhLuxAdStoryboard'));
    const old = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = detail ? '生成专业分镜中…' : 'AI 分析场景顺序中…'; }
    setLuxuryProgress(detail ? 'frames' : 'storyboard');
    let ok = false;
    try {
      const lockedShotLimit = detail ? luxuryAdLockedShotLimit() : 0;
      let sourceSegments = detail ? clampLuxuryAdSegmentsToLockedAssets(state.luxuryAd.segments || []) : (state.luxuryAd.segments || []);
      if (detail && lockedShotLimit > 0 && sourceSegments.length !== (state.luxuryAd.segments || []).length) {
        state.luxuryAd.segments = sourceSegments;
        state.luxuryAd.keyframes = [];
        renderLuxuryAdStoryboard();
        toast(`已按上传的 ${lockedShotLimit} 张分镜画面锁定镜头数，不再补生成额外镜头`, 'info');
      }
      const shotCount = detail
        ? Math.max(1, Math.min(8, sourceSegments.length || lockedShotLimit || Math.round((state.luxuryAd.durationSec || 30) / 6)))
        : undefined;
      const r = await api('/api/dh/luxury-ad/storyboard', {
        method: 'POST',
        body: {
          text,
          duration_sec: state.luxuryAd.durationSec,
          shot_count: shotCount,
          product_name: state.luxuryAd.productAsset?.name || '由广告设想识别',
          asset_summary: luxuryAdAssetSummary() || (detail ? '用户未上传参考素材，本次按广告设想直接生成商品/场景/人物视觉，不要要求用户补传图片。' : '暂未上传图片，本次只生成场景顺序和素材清单'),
          ad_type: state.luxuryAd.adType || 'auto',
          output_ratio: state.luxuryAd.outputRatio || '9:16',
          expand_brief: state.luxuryAd.expandBrief !== false,
          planning_mode: detail ? 'detailed' : 'outline',
          product_asset: state.luxuryAd.productAsset || null,
          reference_assets: luxuryAdReferenceAssets().map((asset, i) => asset && (asset.url || asset.previewUrl || asset.name) ? ({
            index: i + 1,
            name: asset.name || `分镜画面 ${i + 1}`,
            url: compactLuxuryUrl(asset.url || ''),
          }) : null).filter(Boolean),
          outline_segments: detail ? compactLuxurySegments(sourceSegments) : [],
          person_asset: state.selectedAvatar ? {
            id: state.selectedAvatar.id || '',
            name: state.selectedAvatar.name || '',
            type: state.selectedAvatar.avatar_type || state.selectedAvatar.type || '',
          } : null,
        },
      });
      if (!r.success) throw new Error(r.error || '详细分镜生成失败');
      const nextSegments = applyLuxuryShotBindings((r.segments || []).slice(0, detail && shotCount ? shotCount : 8));
      state.luxuryAd.segments = detail && lockedShotLimit > 0 ? nextSegments.slice(0, lockedShotLimit) : nextSegments;
      state.luxuryAd.storyboardDetailed = !!detail || String(r.planning_mode || '').toLowerCase() === 'detailed';
      state.luxuryAd.keyframes = [];
      renderLuxuryAdStoryboard();
      toast(detail
        ? `专业分镜已生成：${state.luxuryAd.segments.length} 个镜头，现在可以生成关键帧预览`
        : `AI 已规划出 ${state.luxuryAd.segments.length} 个广告分镜，下一步补充商品、场景图或人物`, 'success');
      if (autoNext) setTimeout(() => $('.dh-luxgen-product-stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      ok = true;
    } catch (err) {
      toast((detail ? '高定广告片专业分镜生成失败：' : '高定广告片场景顺序生成失败：') + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = old || (detail ? '4 生成专业分镜' : (autoNext ? '2 生成场景顺序' : '重新生成场景顺序')); }
    }
    return ok;
  }

  async function autoGenerateLuxuryAdAiVisuals() {
    if (state.luxuryAd.keyframeGenerating) return toast('正在生成画面预览，请稍等', 'error');
    const text = ($('#dhLuxAdText')?.value || state.luxuryAd.content || '').trim();
    if (!text) return toast('请先填写广告设想/需求', 'error');
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
      if (btn) { btn.disabled = false; btn.innerHTML = old || 'AI 自动生成画面/人物'; }
    }
  }

  async function generateLuxuryAdKeyframes({ autoSubmit = false } = {}) {
    const text = ($('#dhLuxAdText')?.value || state.luxuryAd.content || '').trim();
    if (!text) return toast('请先输入广告设想/需求', 'error');
    if (!state.luxuryAd.segments?.length) return toast('请先完成第 2 步：AI 分析并生成分镜', 'error');
    if (!state.luxuryAd.storyboardDetailed) return toast('请先完成第 4 步：根据素材生成专业分镜，再生成关键帧预览', 'error');
    const refs = luxuryAdRefs();
    if (state.luxuryAd.uploading) return toast('商品或分镜画面还在上传，请稍等', 'error');
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
    const totalShots = Math.max(1, previewSegments.length || 1);
    const btn = $('#dhLuxAdPreviewFrames');
    const old = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = autoSubmit ? '生成关键帧预览…' : '生成关键帧预览…'; }
    const startedAt = Date.now();
    let progressTimer = null;
    state.luxuryAd.keyframeGenerating = true;
    state.luxuryAd.keyframeProgress = {
      current: 0,
      total: totalShots,
      startedAt,
      message: `正在生成静态关键帧预览：0/${totalShots}，已用 0 秒。`,
    };
    setLuxuryProgress('keyframes');
    renderLuxuryAdStoryboard();
    progressTimer = setInterval(() => {
      const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      const total = totalShots;
      const estimated = Math.min(Math.max(1, total - 1), Math.floor(elapsed / 35));
      state.luxuryAd.keyframeProgress = {
        current: estimated,
        total,
        startedAt,
        message: `正在生成静态关键帧预览：约 ${estimated}/${total}，已用 ${elapsed} 秒。系统会按每个镜头的商品、画面和提示词执行，通常需要 1-3 分钟。`,
      };
      renderLuxuryAdStoryboard();
    }, 1000);
    try {
      const r = await api('/api/dh/spaces/keyframes', {
        method: 'POST',
        body: {
          avatar_id: state.selectedAvatar?.id || '',
          background_url: compactLuxuryUrl(refs[0] || ''),
          reference_images: refs.slice(1).map(compactLuxuryUrl).filter(Boolean),
          text,
          product_name: state.luxuryAd.productAsset?.name || '',
          product_asset: state.luxuryAd.productAsset?.url
            ? { name: state.luxuryAd.productAsset.name || '', url: compactLuxuryUrl(state.luxuryAd.productAsset.url) }
            : null,
          reference_assets: luxuryAdReferenceAssets()
            .filter(luxuryAdAssetFilled)
            .map((asset, i) => ({ index: i + 1, name: asset.name || `分镜画面${i + 1}`, url: compactLuxuryUrl(asset.url || asset.previewUrl || '') }))
            .filter(x => x.url || x.name),
          asset_summary: luxuryAdAssetSummary(),
          scene_prompt: text,
          duration_sec: state.luxuryAd.durationSec,
          segments: compactLuxurySegments(previewSegments),
          ad_mode: 'luxury_ad',
          ad_style: 'luxury_soft',
          shot_count: totalShots,
          auto_enhance: state.luxuryAd.autoEnhance !== false,
          expand_brief: state.luxuryAd.expandBrief !== false,
          ...outputPayload(state.luxuryAd.outputRatio, state.luxuryAd.outputSize),
        },
      });
      if (!r.success) throw new Error(r.error || '关键帧预览生成失败');
      state.luxuryAd.keyframes = (r.keyframes || []).slice(0, totalShots);
      state.luxuryAd.keyframeProgress = {
        current: state.luxuryAd.keyframes.length,
        total: previewSegments.length || state.luxuryAd.keyframes.length,
        startedAt,
        message: `关键帧预览已完成：${state.luxuryAd.keyframes.length}/${previewSegments.length || state.luxuryAd.keyframes.length}（静态图；合成完整广告时才逐镜生成动态视频）。`,
      };
      if (r.scenes?.length) {
        const nextScenes = applyLuxuryShotBindings(r.scenes.map((sc, i) => ({ ...(previewSegments[i] || {}), ...sc })));
        state.luxuryAd.segments = lockedShotLimit > 0 ? nextScenes.slice(0, lockedShotLimit) : nextScenes.slice(0, totalShots);
      }
      state.luxuryAd.keyframeGenerating = false;
      renderLuxuryAdStoryboard();
      const lockedCount = state.luxuryAd.keyframes.filter(k => String(k.reference_mode || '').includes('reference_locked')).length;
      toast(lockedCount
        ? `已锁定 ${lockedCount} 个参考镜头作为静态预览，请点击“6 合成完整广告”；提交后会显示逐镜图生视频进度`
        : `已生成 ${state.luxuryAd.keyframes.length} 个镜头预览`, 'success');
      if (autoSubmit) await submitLuxuryAd();
    } catch (err) {
      state.luxuryAd.keyframeGenerating = false;
      state.luxuryAd.keyframeProgress = null;
      renderLuxuryAdStoryboard();
      toast('高定广告片关键帧预览生成失败：' + err.message, 'error');
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      state.luxuryAd.keyframeGenerating = false;
      updateLuxuryAdStepLocks();
      if (btn) { btn.disabled = false; btn.innerHTML = old || '5 生成关键帧预览'; }
    }
  }

  async function submitLuxuryAd() {
    const text = ($('#dhLuxAdText')?.value || state.luxuryAd.content || '').trim();
    if (!text) return toast('请先输入广告设想/需求', 'error');
    const refs = luxuryAdRefs();
    const lockedShotLimit = luxuryAdLockedShotLimit();
    if (lockedShotLimit > 0) {
      state.luxuryAd.segments = clampLuxuryAdSegmentsToLockedAssets(state.luxuryAd.segments || []);
      state.luxuryAd.keyframes = (state.luxuryAd.keyframes || []).slice(0, state.luxuryAd.segments.length);
    }
    if (!state.luxuryAd.keyframes?.some(k => k?.image_url)) return toast('请先点击“5 生成关键帧预览”，确认每段静态画面后再合成完整广告', 'error');
    const primaryFrame = state.luxuryAd.keyframes?.find(k => k?.image_url || k?.imageUrl)?.image_url || state.luxuryAd.keyframes?.find(k => k?.image_url || k?.imageUrl)?.imageUrl || '';
    const voiceId = state.luxuryAd.voiceId || '';
    if (!voiceId) return toast('请先手动选择配音音色；高定广告片不会自动选声音', 'error');
    const btn = $('#dhLuxAdConfirmGenerate');
    const old = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '提交生成中…'; }
    setLuxuryProgress('video');
    try {
      const title = '高定广告片';
      const productAsset = state.luxuryAd.productAsset || {};
      const referenceAssets = luxuryAdReferenceAssets();
      const payload = {
        avatar_id: state.selectedAvatar?.id || '',
        background_url: compactLuxuryUrl(refs[0] || primaryFrame),
        reference_images: refs.slice(1).map(compactLuxuryUrl).filter(Boolean),
        text,
        title,
        product_name: productAsset.name || '',
        product_asset: productAsset?.url ? { name: productAsset.name || '', url: compactLuxuryUrl(productAsset.url) } : null,
        reference_assets: referenceAssets
          .filter(luxuryAdAssetFilled)
          .map((asset, i) => ({ index: i + 1, name: asset.name || `分镜画面${i + 1}`, url: compactLuxuryUrl(asset.url || asset.previewUrl || '') }))
          .filter(x => x.url || x.name),
        asset_summary: luxuryAdAssetSummary(),
        voice_id: voiceId,
        duration_sec: state.luxuryAd.durationSec,
        subtitle: getDhSubtitlePayload(state.luxuryAd.subtitle !== false),
        scene_prompt: text,
          camera_prompt: '高定广告片：按分镜顺序生成镜头，镜头语言高级克制，保留产品故事与品牌质感。',
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
          retryPayload: payload,
          createDetail: {
            title,
            durationSec: state.luxuryAd.durationSec,
            text,
            backgroundUrl: refs[0],
            avatarName: state.selectedAvatar?.name || '',
            avatarId: state.selectedAvatar?.id || '',
            voiceId,
            adMode: '高定广告片',
            outputRatio: state.luxuryAd.outputRatio,
            outputSize: state.luxuryAd.outputSize,
            resolution: outputPixels(state.luxuryAd.outputRatio, state.luxuryAd.outputSize),
            segments: state.luxuryAd.segments || [],
            keyframes: state.luxuryAd.keyframes || [],
            submittedAt: new Date().toISOString(),
          },
        });
        pollVideoTask(state.luxuryAd.taskId);
      }
      state.activeTaskType = 'luxury_ad';
      toast('高定广告片任务已提交，任务中心会显示逐镜动态视频生成进度', 'success');
      renderTaskCenter();
      switchTab('tasks');
    } catch (err) {
      toast('高定广告片生成失败：' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = old || '6 合成完整广告'; }
    }
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
    })[scene] || '广告数字人';
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
    })[String(role || '').toLowerCase()] || '高定镜头';
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
    return '供应商队列：Topview Image2Video → 火山 Seedance → 漫路可灵 → 漫路海螺';
  }

  const SPACE_STANDARD_SAMPLE_TEXT = '大家现在看到的是这面定制展示墙。它的纹理层次非常丰富，在顶部射灯的照射下，会呈现出自然的金属光泽和空间纵深。我们把人物讲解区放在左侧，右侧完整保留展示面，这样观众既能看到讲解员，也能清楚看到空间亮点。';
  const SPACE_LUXURY_SAMPLE_TEXT = '用一支高定广告片呈现这面艺术墙的品牌质感。开场先建立完整空间氛围，再推进到材质纹理和光影细节，中段让人物与场景自然互动，突出定制工艺和高级质感，最后收束到品牌记忆点和咨询引导。';

  function syncSpaceModeCopyLabels() {
    const isLuxury = state.space.adMode === 'luxury';
    const titleInput = $('#dhSpaceTitle');
    const textInput = $('#dhSpaceText');
    const sceneInput = $('#dhSpaceScenePrompt');
    const copyLabel = $('#dhSpaceCopyLabel');
    const visualLabel = $('#dhSpaceVisualLabel');
    const visualHint = $('#dhSpaceVisualHint');
    const sampleBtn = $('#dhSpaceSampleText');
    if (copyLabel) copyLabel.textContent = isLuxury ? '高定广告脚本' : '广告文案';
    if (visualLabel) visualLabel.textContent = isLuxury ? '高定摄影 / 分镜提示词' : '画面提示词';
    if (visualHint) visualHint.textContent = isLuxury
      ? '高定广告片会拆成多镜头分镜，并为每镜头生成摄影解构、关键帧和图生视频提示。'
      : '普通广告使用展墙讲解画面；高定广告片使用多分镜。';
    if (sampleBtn) sampleBtn.textContent = isLuxury ? '填入高定示例' : '填入示例文案';
    if (titleInput) {
      const current = String(titleInput.value || '').trim();
      if (isLuxury && (!current || current === '广告数字人')) titleInput.value = '高定广告片';
      if (!isLuxury && current === '高定广告片') titleInput.value = '广告数字人';
      titleInput.placeholder = isLuxury ? '例如：高端艺术墙高定广告片' : '例如：高端艺术墙新品广告';
    }
    if (textInput) {
      const current = String(textInput.value || '').trim();
      if (isLuxury && current === SPACE_STANDARD_SAMPLE_TEXT) textInput.value = SPACE_LUXURY_SAMPLE_TEXT;
      if (!isLuxury && current === SPACE_LUXURY_SAMPLE_TEXT) textInput.value = SPACE_STANDARD_SAMPLE_TEXT;
      textInput.placeholder = isLuxury
        ? '写高定广告片脚本，例如：开场建立品牌空间，第二镜做材质特写，中段展示人物与场景互动，最后收束到品牌记忆点。'
        : '写数字人要说的话，例如：大家现在看到的是这面定制艺术墙，它的纹理层次非常丰富，在灯光下会呈现自然金属光泽。';
    }
    if (sceneInput) {
      sceneInput.placeholder = isLuxury
        ? '高定广告分镜：逆向摄影解构、焦段/景别/灯光、产品与人物位置、镜头运动和片尾留白。'
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
      : (state.space.adMode === 'luxury' ? '手动输入广告文案后，系统会生成高定分镜提示词。' : '手动输入广告文案后，系统会生成画面提示词，并拆出口播时间轴。');
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
        ? '确认关键帧并合成高定广告片'
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
          <b>高定分镜</b>
          <span>拆成 4-8 个镜头，逐镜头检查构图与卖点</span>
        </div>
        <div class="dh-story-card ghost">
          <div class="dh-story-thumb">03</div>
          <b>Topview I2V</b>
          <span>按关键帧逐镜头生成高定广告片段</span>
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
    if (pageTitle) pageTitle.textContent = isLuxury ? '高定广告片' : '广告数字人';
    const pageSub = $('#dhSpacePageSub');
    if (pageSub) pageSub.textContent = isLuxury
      ? '独立的多镜头广告片工作流：人物可选；选择人物后会锁定同一身份参考，逐镜头重绘融合。'
      : '普通广告数字人按单镜头展墙讲解生成，适合稳定导览和空间卖点说明。';
    const avatarTitle = $('#dhSpaceAvatarTitle');
    if (avatarTitle) avatarTitle.textContent = isLuxury ? '广告人物身份参考（可选）' : '广告数字人形象（可选）';
    const bgTitle = $('#dhSpaceBgTitle');
    if (bgTitle) bgTitle.textContent = isLuxury ? '参考画面 / 产品物料' : '广告背景 / 展示画面';
    const bgUploadHint = $('#dhSpaceBgUploadHint');
    if (bgUploadHint) bgUploadHint.textContent = isLuxury ? '按镜头顺序上传多张画面' : '上传广告背景图';
    const modePanel = $('#dhSpaceAdModePanel');
    if (modePanel) modePanel.style.display = 'none';
    const shot = $('#dhLuxuryShotCount');
    if (shot) shot.value = String(state.space.shotCount || 6);
    const title = $('#dhSpaceWorkbenchTitle');
    if (title) title.textContent = isLuxury ? '高定广告片工作流' : '单镜头预览';
    const sub = $('#dhSpaceWorkbenchSub');
    if (sub) sub.textContent = isLuxury
      ? '按 Topview Image2Video 参考流生成 4-8 个高定广告镜头；人物只变姿态和表情，不换脸。'
      : 'AI 会按上传背景和性别生成一位导览员，并先做自然融合质检；没有人物的预览不能合成。';
    const hint = $('#dhSpaceModeHint');
    if (hint) hint.textContent = isLuxury
      ? `当前风格：${luxuryStyleName(state.space.adStyle)}；多关键帧分镜链路会锁定人物身份、产品和参考画面。`
      : '普通广告数字人必须生成带人物的导览员预览，并通过质量检查后才能合成视频。';
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
              <span>普通广告数字人 · 视觉 1 个连续镜头 · 口播 ${speechSegments.length} 段，人物左侧讲解，右侧展示背景/产品空间</span>
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
      const modeLabel = isLuxury ? '高定广告片' : '普通广告数字人';
      box.innerHTML = `<div class="dh-storyboard-wrap">
        <div class="dh-storyboard-status">
          <div>
            <b>分镜看板已生成</b>
            <span>${modeLabel} · ${state.space.segments.length} 个镜头 · 下一步先生成每个镜头关键帧，确认效果后再合成视频${isLuxury ? ` · ${luxuryProviderQueueLabel()}` : ''}</span>
          </div>
          <button type="button" class="dh-btn dh-btn-primary dh-btn-sm" data-space-keyframes-from-board>${isLuxury ? '生成高定关键帧预览' : '生成分镜镜头预览'}</button>
        </div>
        <div class="dh-storyboard-grid${!isLuxury ? ' dh-storyboard-grid-single' : ''}">
          ${state.space.segments.map((seg, idx) => `<div class="dh-story-card">
            <div class="dh-story-thumb">${String(idx + 1).padStart(2, '0')}<span>待生成关键帧</span></div>
            <div class="dh-story-meta">
              <span>${fmtTime(seg.start)}-${fmtTime(seg.end)}</span>
              <span class="dh-story-badge">${escapeHtml(presetLabel(TONE_PRESETS, seg.tone || 'natural'))}</span>
            </div>
            <b>${escapeHtml(seg.title || (isLuxury ? `高定镜头 ${idx + 1}` : `分镜 ${idx + 1}`))}</b>
            <p>${escapeHtml(seg.text)}</p>
            ${isLuxury ? renderLuxuryShotDetails(seg) : ''}
            <span>${isLuxury ? `风格：${escapeHtml(luxuryStyleName(state.space.adStyle))} · 先生成 Topview/Image2 风格关键帧预览。` : '先按此段生成广告预览图。'}</span>
          </div>`).join('')}
        </div>
      </div>`;
    }
    updateSpaceStoryboardButtons();
    return state.space.segments;
  }

  async function writeAndSegmentSpaceScript() {
    const title = ($('#dhSpaceTitle')?.value || '广告数字人').trim();
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
          <button type="button" class="dh-btn dh-btn-primary dh-btn-sm" data-space-submit-from-board>${isLuxury ? '确认关键帧并合成高定广告片' : '确认预览并合成视频'}</button>
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
    const title = ($('#dhSpaceTitle')?.value || '广告数字人').trim();
    const shotCount = isLuxury ? Math.max(4, Math.min(8, Number(state.space.shotCount) || 6)) : 1;
    if (!isLuxury && !(state.space.speechSegments || []).length) {
      state.space.speechSegments = await buildSpaceSpeechSegments(text, durationSec);
      state.space.segments = state.space.speechSegments;
    }
    if (!isLuxury && state.space.guideMode === 'direct_keyframe') {
      state.space.guideMode = 'ai_guide';
      $$('[data-space-guide-mode]').forEach(b => b.classList.toggle('active', b.dataset.spaceGuideMode === 'ai_guide'));
      toast('普通广告数字人必须先生成带人物的导览员预览，纯背景不能作为合格首帧。', 'warning');
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
      const r = await api('/api/dh/spaces/keyframes', {
        method: 'POST',
        body: {
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
          ...outputPayload(state.space.outputRatio, state.space.outputSize),
        },
      });
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
          throw new Error('预览未通过强制质量检查：贴片、模板合成、小人角落结果不能作为合格广告数字人预览');
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
        title: '还不能生成广告数字人',
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

    const title = ($('#dhSpaceTitle')?.value || '广告数字人').trim();
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
      box.innerHTML = renderProgressPreview(isLuxury ? '生成高定关键帧' : '合成展墙讲解视频', isLuxury ? '后台会按高定风格生成多张 Image2 关键帧，再用 Topview Image2Video 逐镜头串联成片' : '后台会使用已确认的展墙讲解构图，生成左侧数字人讲解、右侧展示区稳定可见的连续口播视频', 0, {
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
        adMode: isLuxury ? '高定广告片' : '普通广告数字人',
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
        avatarName: isLuxury ? `${title || '高定广告片'} · ${luxuryStyleName(adStyle)}` : (title || state.selectedAvatar?.name || '广告数字人'),
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
            <div class="dh-render-stage-sub">${durationSec}s · ${isLuxury ? '多镜头高定广告片' : '展墙讲解口播'} · 预览图和视频都在后台生成，可以继续创建其他任务。</div>
            <button class="dh-btn dh-btn-primary dh-btn-sm" data-tab-go="tasks">查看任务中心</button>
          </div>
        </div>`;
      }
      updateSpaceStoryboardButtons();
      switchTab('tasks');
      resetSpaceGuideFormForNext();
      toast('广告数字人视频已提交到任务中心', 'success');
    } catch (err) {
      if (box) box.innerHTML = `<div class="dh-render-stage">
        <div class="dh-render-stage-name" style="color:var(--dh-error)">❌ 生成失败</div>
        <div class="dh-render-stage-sub">${escapeHtml(err.message)}</div>
      </div>`;
      toast('广告数字人提交失败：' + err.message, 'error');
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
            title: t.title || meta.createDetail?.title || meta.avatarName || '广告数字人',
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
        const stageMap = {
          prepare_image: { name: '🖼️ 准备形象', sub: '上传/归一化图片' },
          prepare_audio: { name: '🎤 准备语音', sub: '语音准备中' },
          detecting:     { name: '🔍 主体检测', sub: '抠出人物' },
          submitting:    { name: '⚡ 提交渲染', sub: '排队中' },
          submitted:     { name: '⏳ 等待中', sub: '已提交，等服务端调度' },
          polling:       { name: '⏳ 等待中', sub: '渲染中，请稍候' },
          running:       { name: '🎨 渲染中', sub: `引擎状态 ${t.cv_status || '...'}` },
          storyboard:    { name: '🧩 生成分镜', sub: t.message || '规划产品广告镜头' },
          keyframes:     { name: '🖼️ 生成关键帧', sub: t.message || '固定商品和场景画面' },
          guide_keyframe:{ name: '🖼️ 生成导览预览', sub: t.message || '融合讲解员和空间背景' },
          guide_video:   { name: '🎬 生成讲解视频', sub: t.message || '驱动数字人一镜到底讲解' },
          video:         { name: '🎞️ 图生视频', sub: t.message || 'Seedance 正在生成镜头' },
          topview_i2v:   { name: '🎞️ 图生视频', sub: t.message || 'Topview 正在生成动态镜头' },
          topview_i2v_error: { name: '⚠️ Topview 生成失败', sub: t.message || '正在尝试备用图生视频模型' },
          topview_m2v:   { name: '🎬 生成广告视频', sub: t.message || 'Topview 正在合成广告' },
          ad_lip_sync:   { name: '🎙️ 生成口型视频', sub: t.message || '正在驱动口型和动作' },
          post_effects:  { name: '✨ 字幕/特效合成', sub: '正在烧录字幕' },
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
        box.innerHTML = renderProgressPreview(getTaskStatusText(stored.status), `${getTaskStageText(stored.stage)} · ${escapeHtml(stored.avatarName || '')}`, stored.elapsed, stored);
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
    if (target.matches?.('input[type="file"]')) return;

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
      state.avatarPickReturn = isLuxuryAdModule() ? 'luxury-ad' : 'space-guide';
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
    if (closest('[data-lux-product-preview]')) {
      const product = state.luxuryAd.productAsset || {};
      const url = product.url || product.previewUrl || '';
      if (url) openImagePreviewModal(url, product.name || '主产品图');
      return;
    }
    const luxAssetPreview = closest('[data-lux-asset-preview]');
    if (luxAssetPreview) {
      const asset = luxuryAdReferenceAssets()[Number(luxAssetPreview.dataset.luxAssetPreview)];
      const url = asset?.url || asset?.previewUrl || '';
      if (url) openImagePreviewModal(url, asset?.name || '参考素材');
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
    if (closest('#dhLuxAdVoiceOpen')) {
      state.voiceModalTarget = 'luxury-ad';
      const modalSearch = $('#dhSpaceVoiceModalSearch');
      if (modalSearch) modalSearch.value = '';
      $('#dhSpaceVoiceModal').style.display = 'flex';
      renderSpaceVoiceOptions();
      setTimeout(() => $('#dhSpaceVoiceModalSearch')?.focus(), 30);
      return;
    }
    if (closest('#dhLuxAdPickPerson')) {
      state.avatarPickReturn = 'luxury-ad';
      switchTab('step2');
      return;
    }
    if (closest('#dhLuxAdSample')) {
      const input = $('#dhLuxAdText');
      if (input) input.value = SPACE_LUXURY_SAMPLE_TEXT;
      state.luxuryAd.content = SPACE_LUXURY_SAMPLE_TEXT;
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
    if (closest('#dhLuxAdAutoVisuals')) { autoGenerateLuxuryAdAiVisuals(); return; }
    if (closest('#dhLuxAdStoryboard')) { buildLuxuryAdStoryboard({ autoNext: false, detail: true }); return; }
    if (closest('#dhLuxAdGenerate')) { buildLuxuryAdStoryboard({ autoNext: true, detail: false }); return; }
    if (closest('#dhLuxAdPreviewFrames')) { generateLuxuryAdKeyframes({ autoSubmit: false }); return; }
    if (closest('#dhLuxAdConfirmGenerate')) {
      submitLuxuryAd();
      return;
    }
    const plazaUse = closest('[data-plaza-use]'); if (plazaUse) { e.stopPropagation(); usePlazaAvatar(plazaUse.dataset.plazaUse); return; }
    if (closest('#dhTaskRefresh')) { await restoreVideoTasks(); toast('任务状态已刷新', 'success'); return; }
    const taskTypeTab = closest('[data-task-type]');
    if (taskTypeTab) {
      state.activeTaskType = taskTypeTab.dataset.taskType || 'digital_human';
      renderTaskCenter();
      return;
    }
    const taskPreview = closest('[data-task-preview]');
    if (taskPreview) {
      const id = taskPreview.dataset.taskPreview;
      const meta = state.s3.runningTasks.get(id) || readVideoTasks().find(x => x.taskId === id);
      if (meta?.videoUrl) openVideoPreviewModal(meta.videoUrl, meta.avatarName || '数字人作品');
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
        toast('普通广告数字人已禁用纯背景首帧，必须先生成带人物的导览员预览。', 'warning');
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
      $('#dhSpaceVoiceModal').style.display = 'none';
      state.voiceModalTarget = 'space';
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

    // 音色
    const voiceCard = closest('[data-voice-id]');
    if (voiceCard && !target.closest('[data-voice-preview]')) { selectVoice(voiceCard.dataset.voiceId); return; }
    const voicePrevBtn = closest('[data-voice-preview]');
    if (voicePrevBtn) { e.stopPropagation(); previewVoice(voicePrevBtn.dataset.voicePreview); return; }
    const spaceVoiceCard = closest('[data-space-voice-id]');
    if (spaceVoiceCard && !target.closest('[data-voice-preview]')) {
      state.space.voiceId = spaceVoiceCard.dataset.spaceVoiceId || '';
      renderSpaceVoiceOptions();
      if (closest('#dhSpaceVoiceModal')) $('#dhSpaceVoiceModal').style.display = 'none';
      return;
    }
    const luxuryVoiceCard = closest('[data-luxury-voice-id]');
    if (luxuryVoiceCard && !target.closest('[data-voice-preview]')) {
      state.luxuryAd.voiceId = luxuryVoiceCard.dataset.luxuryVoiceId || '';
      renderLuxuryAdVoice();
      updateLuxuryAdStepLocks();
      if (closest('#dhSpaceVoiceModal')) {
        $('#dhSpaceVoiceModal').style.display = 'none';
        state.voiceModalTarget = 'space';
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
    const styleKey = state.s3.subtitle.style || 'popup';
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
    state.s3.subtitle.style = styleKey;
    $$('.dh-sub-style').forEach(b => b.classList.toggle('active', b.dataset.subStyle === styleKey));
    refreshSubtitlePreview();
  }

  function openSubtitleModal(target = 's3') {
    state.subtitleTarget = target === 'space' ? 'space' : (target === 'pdh' ? 'pdh' : 's3');
    const modal = $('#dhSubtitleModal');
    if (modal?.closest('.dh-tab-pane')) {
      ($('#dhApp') || document.body).appendChild(modal);
    }
    const sub = state.s3.subtitle;
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
        : $('#dhS3SubtitleOn');
    state.s3.subtitle = {
      show: showInput?.checked !== false,
      style: state.s3.subtitle.style || 'popup',
      smartEmphasis: $('#dhSubSmartEmphasis')?.checked !== false,
      fontName: $('#dhSubFont')?.value || '抖音美好体',
      fontSize: parseInt($('#dhSubSize')?.value) || 72,
      color: $('#dhSubColor')?.value || '',
      outlineColor: $('#dhSubOutline')?.value || '',
    };
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
    try {
      if (!pdh.segments || !pdh.segments.length) {
        pdh.segments = buildProductSegmentsLocal(text, pdh.targetDurationSec || Math.ceil(text.length / 4), pdhProductMeta().motion_style || 'hold');
        state.s3.segments = pdh.segments;
        renderPdhTimeline(pdh.segments);
      }
      const r = await fetch('/api/dh/product-ads/preview-voice', {
        method: 'POST',
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
      toast('试听失败：' + err.message, 'error');
    } finally {
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
    const luxProductFile = $('#dhLuxAdProductFile');
    if (luxProductFile) luxProductFile.addEventListener('change', e => {
      const files = e.target.files;
      if (files && files.length) uploadLuxuryAdProduct(files);
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
      state.luxuryAd.segments = [];
      state.luxuryAd.storyboardDetailed = false;
      state.luxuryAd.keyframes = [];
      renderLuxuryAdStoryboard();
      setLuxuryProgress('content');
      updateLuxuryAdStepLocks();
    });
    const luxDuration = $('#dhLuxAdDuration');
    if (luxDuration) luxDuration.addEventListener('change', e => handleLuxuryAdDurationChange(e.target.value));
    const luxRatio = $('#dhLuxAdRatio');
    if (luxRatio) luxRatio.addEventListener('change', e => { state.luxuryAd.outputRatio = e.target.value || '9:16'; state.luxuryAd.storyboardDetailed = false; state.luxuryAd.keyframes = []; updateLuxuryAdOutputHint(); renderLuxuryAdStoryboard(); });
    const luxSize = $('#dhLuxAdSize');
    if (luxSize) luxSize.addEventListener('change', e => { state.luxuryAd.outputSize = e.target.value || 'standard'; state.luxuryAd.storyboardDetailed = false; state.luxuryAd.keyframes = []; updateLuxuryAdOutputHint(); renderLuxuryAdStoryboard(); });
    const luxSubtitle = $('#dhLuxAdSubtitle');
    if (luxSubtitle) luxSubtitle.addEventListener('change', e => {
      state.luxuryAd.subtitle = e.target.value !== 'off';
      const toggle = $('#dhLuxAdSubtitleToggle');
      if (toggle) toggle.checked = state.luxuryAd.subtitle !== false;
    });
    const luxSubtitleToggle = $('#dhLuxAdSubtitleToggle');
    if (luxSubtitleToggle) luxSubtitleToggle.addEventListener('change', e => {
      state.luxuryAd.subtitle = !!e.target.checked;
      const select = $('#dhLuxAdSubtitle');
      if (select) select.value = state.luxuryAd.subtitle ? 'on' : 'off';
    });
    const luxAutoEnhance = $('#dhLuxAdAutoEnhance');
    if (luxAutoEnhance) luxAutoEnhance.addEventListener('change', e => { state.luxuryAd.autoEnhance = !!e.target.checked; state.luxuryAd.keyframes = []; renderLuxuryAdStoryboard(); });
    const luxExpandBrief = $('#dhLuxAdExpandBrief');
    if (luxExpandBrief) luxExpandBrief.addEventListener('change', e => { state.luxuryAd.expandBrief = !!e.target.checked; state.luxuryAd.segments = []; state.luxuryAd.storyboardDetailed = false; state.luxuryAd.keyframes = []; renderLuxuryAdStoryboard(); });
    updateOutputHints();
    switchTab(getInitialTab());
    await loadMyAvatars();
    renderProductMaterial();
    restoreVideoTasks();
    loadEngineStatus();
  }

  init();
})();
