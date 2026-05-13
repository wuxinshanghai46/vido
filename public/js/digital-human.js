// ═══════════════════════════════════════════════
// 数字人 3 步向导前端
// ═══════════════════════════════════════════════
(() => {
  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => Array.from(p.querySelectorAll(s));

  const state = {
    token: sessionStorage.getItem('vido_token') || localStorage.getItem('vido_token') || localStorage.getItem('token') || null,
    // Step 1
    s1: {
      mode: 'generate', gender: 'female', style: 'free', ratio: '9:16',
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
      // 上传模式下的"人物+背景一键合成"功能
      compose: { bgImageUrl: '', bgImageName: '', placement: 'bottom', ratio: '9:16', mode: 'fast', sizePct: 76 },
      product: { imageUrl: '', preparedUrl: '', cutoutUrl: '', imageName: '', name: '', selling_points: '', motion_style: 'hold', scene: 'street' },
      previewUrl: null,            // 静态图 URL
      sampleVideoUrl: null,        // 动态预览 URL
      sampleTaskId: null,
      samplePollTimer: null,
    },
    // Step 2
    myAvatars: [],
    selectedAvatar: null,
    // Step 3
    s3: {
      script: '', segments: [], voiceId: null, taskId: null, pollTimer: null, motionEditIdx: -1, targetDurationSec: 30,
      writeMode: 'script', writeEntry: 'script', productMotionStyle: '',
      product: { enabled: false, imageUrl: '', imageName: '', name: '', audience: '', selling_points: '', offer: '', motion_style: 'hold' },
      subtitle: { show: true, style: 'popup', smartEmphasis: true, fontName: '抖音美好体', fontSize: 72, color: '', outlineColor: '' },
      // 多任务并行：taskId → { avatarName, startedAt, pollTimer, snapshot }
      runningTasks: new Map(),
    },
    space: {
      bgImageUrl: '',
      bgImageName: '',
      scene: 'auto',
      scenePrompt: '',
      camera: 'auto',
      cameraPrompt: '',
      voiceId: '',
      durationSec: 30,
      subtitle: true,
      segments: [],
      generationMode: 'storyboard',
      copyMode: 'manual',
      promptTimer: null,
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
    return (list.find(x => x.id === id)?.label) || id || '自然';
  }

  // ══════════════ API helper ══════════════
  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (!headers['Content-Type'] && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    const body = opts.body instanceof FormData ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined);
    const resp = await fetch(path, { ...opts, headers, body });
    if (resp.status === 401) { location.href = '/?login=1'; throw new Error('unauth'); }
    return resp.json();
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
  const DH_VALID_TABS = ['step1', 'step2', 'step3', 'tasks', 'dual', 'plaza', 'works', 'voice-clone', 'product-dh', 'space-guide'];
  const DH_LAST_TAB_KEY = 'vido_dh_active_tab';

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
    try {
      const savedTab = localStorage.getItem(DH_LAST_TAB_KEY);
      if (DH_VALID_TABS.includes(savedTab)) return savedTab;
    } catch {}
    return 'step1';
  }

  function switchTab(tab, opts = {}) {
    if (!tab) return;
    if (!DH_VALID_TABS.includes(tab)) tab = 'step1';
    state.activeTab = tab;
    if (opts.remember !== false) rememberActiveTab(tab);
    $$('.dh-nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
    $$('.dh-tab-pane').forEach(el => el.classList.toggle('active', el.dataset.pane === tab));
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
    }[tab] || '数字人';

    if (tab === 'step2') loadMyAvatars();
    if (tab === 'step3') { renderSelectedAvatar(); loadVoicesIfNeeded(); renderRunningTasksBanner(); }
    if (tab === 'space-guide') { renderSpaceGuide(); loadVoicesIfNeeded().then(renderSpaceVoiceOptions); }
    if (tab === 'tasks') renderTaskCenter();
    if (tab === 'dual')  { renderDualAvatars(); }
    if (tab === 'plaza') loadPlaza();
    if (tab === 'product-dh') pdhOnTabOpen();
    if (tab === 'works') loadWorks();
    if (tab === 'voice-clone') { bindVoiceCloneUpload(); loadVoiceClones(); /* aliyun token 卡片已下线，统一到后台 AI 配置 */ }
    try { delete document.documentElement.dataset.dhInitialTab; } catch {}
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
    state.s1.sampleVideoUrl = null;
    state.s1.sampleTaskId = null;
    if (state.s1.samplePollTimer) { clearInterval(state.s1.samplePollTimer); state.s1.samplePollTimer = null; }
    $('#dhS1SampleVideo').style.display = 'none';
    $('#dhS1SampleVideo').removeAttribute('src');
    $('#dhS1PreviewImg').style.display = 'block';
    $('#dhS1SampleArea').style.display = 'flex';
    $('#dhS1SampleRunning').style.display = 'none';
    $('#dhS1SampleDone').style.display = 'none';
    // 静态图生成后保存按钮就可用；动态预览只是可选验证
    $('#dhS1Save').disabled = !state.s1.previewUrl;
    $('#dhS1Save').title = state.s1.previewUrl ? '保存这张形象到「我的形象」' : '请先生成或上传一张静态形象图';
    const ph = $('#dhS1PreviewPlaceholder');
    if (ph) ph.style.display = '';
  }
  function _hidePlaceholder() {
    const ph = $('#dhS1PreviewPlaceholder');
    if (ph) ph.style.display = 'none';
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
    _checkFramingRatioConflict();
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
  }

  function renderS1Product() {
    const p = state.s1.product || {};
    const host = $('#dhS1ProductPreview');
    if (host) host.innerHTML = p.imageUrl
      ? `<img src="${escapeHtml(p.imageUrl)}" alt=""><span>${escapeHtml(p.imageName || '商品图')}</span>`
      : `<span>未上传商品图</span>`;
  }

  async function uploadS1ProductImage(file) {
    if (!file) return;
    if (!file.type?.startsWith('image/')) return toast('请上传商品图片', 'error');
    const fd = new FormData();
    fd.append('image', file);
    const btn = $('#dhS1ProductPickBtn');
    const old = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = '上传中…'; }
    try {
      const r = await fetch('/api/dh/products/upload', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + state.token },
        body: fd,
      });
      const data = await r.json();
      if (!data?.success) throw new Error(data?.error || '上传失败');
      state.s1.product = {
        ...(state.s1.product || {}),
        imageUrl: data.url,
        preparedUrl: data.preparedUrl || data.url,
        cutoutUrl: data.cutoutUrl || '',
        imageName: data.name || file.name,
      };
      state.s1.productFusedKey = '';
      renderS1Product();
        toast('商品图已上传，会用于生成商品数字人形象', 'success');
    } catch (err) {
      toast('商品图上传失败：' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old || '上传商品图'; }
      const input = $('#dhS1ProductFile'); if (input) input.value = '';
    }
  }

  function s1ProductFuseKey() {
    const p = state.s1.product || {};
    return [state.s1.previewUrl || '', p.imageUrl || '', p.preparedUrl || '', p.cutoutUrl || '', p.imageName || '', p.scene || 'street', state.s1.avatarType || ''].join('|');
  }

  async function ensureS1ProductFused() {
    if (state.s1.avatarType !== 'product') return state.s1.previewUrl;
    if (!state.s1.previewUrl) throw new Error('请先生成或上传人物照片');
        if (!state.s1.product?.imageUrl) throw new Error('商品数字人需要先上传商品图');
    const key = s1ProductFuseKey();
    if (state.s1.productFusedKey === key) return state.s1.previewUrl;

    const sceneId = state.s1.product?.scene || 'street';
    const sceneLabel = (state._productScenes.find(x => x.id === sceneId)?.label) || sceneId;
        toast(`正在「${sceneLabel}」场景里融合商品数字人，约 30-60 秒…`, '');
    const fused = await api('/api/dh/products/fuse-image', {
      method: 'POST',
      body: {
        image_url: state.s1.previewUrl,
        product: {
          image_url: state.s1.product.imageUrl,
          prepared_url: state.s1.product.preparedUrl || state.s1.product.imageUrl,
          cutout_url: state.s1.product.cutoutUrl || '',
          image_name: state.s1.product.imageName,
          name: state.s1.product.imageName || '',
          selling_points: '',
          motion_style: 'hold',
          scene: sceneId,
        },
      },
    });
          if (!fused?.success || !fused.imageUrl) throw new Error(fused?.error || '商品数字人融合失败');
    state.s1.previewUrl = fused.imageUrl;
    state.s1.productFusedKey = s1ProductFuseKey();
    const img = $('#dhS1PreviewImg');
    if (img) img.src = fused.imageUrl;
        toast(fused.fallback ? '已生成商品数字人形象（兜底合成）' : '已生成商品数字人形象', 'success');
    return state.s1.previewUrl;
  }

  // ══════════════ Step 1 · 文生图 ══════════════
  async function generateImage() {
    const description = $('#dhS1Desc').value.trim();
    if (state.s1.avatarType === 'product' && !state.s1.product?.imageUrl) {
      return toast('商品数字人需要先上传商品图', 'error');
    }
    $('#dhS1Loading').style.display = 'block';
    $('#dhS1Preview').style.display = 'none';
    $('#dhS1GenBtn').disabled = true;
    _hidePlaceholder();

    if (state.s1.avatarType === 'product') {
      toast('两阶段融合中：先生成基础人物，再融合商品+场景，约 60-90 秒…', '');
    }

    try {
      const r = await api('/api/dh/images/generate', {
        method: 'POST',
        body: {
          style: state.s1.style,
          gender: state.s1.gender,
          description,
          aspectRatio: state.s1.ratio,
          avatar_type: state.s1.avatarType,
          action: state.s1.action || 'natural',
          framing: state.s1.framing || 'half_body',
          background_image_url: state.s1.bgImageUrl || '',
          product: state.s1.avatarType === 'product' ? {
            image_url: state.s1.product.imageUrl,
            prepared_url: state.s1.product.preparedUrl || state.s1.product.imageUrl,
            cutout_url: state.s1.product.cutoutUrl || '',
            image_name: state.s1.product.imageName,
            name: state.s1.product.imageName || '',
            scene: state.s1.product.scene || 'street',
            selling_points: '',
            motion_style: 'hold',
          } : null,
        },
      });
      if (!r.success) throw new Error(r.error || '生成失败');
      resetS1Preview();
      state.s1.previewUrl = r.imageUrl;
      state.s1.fromUpload = false;
      $('#dhS1PreviewImg').src = r.imageUrl;
      $('#dhS1Preview').style.display = 'block';
      // 关键：resetS1Preview 把 dhS1Save 设了 disabled，这里要把它打开
      $('#dhS1Save').disabled = false;
      $('#dhS1Save').title = '保存这张形象到「我的形象」';
      _hidePlaceholder();
      // 给个默认名
      if (!$('#dhS1Name').value) {
        const label = { female: '小姐姐', male: '小哥哥', '': '形象' }[state.s1.gender] || '形象';
        $('#dhS1Name').value = `${{ idol_warm: '暖调', idol_cool: '冷调', documentary: '写实', office: '职场', beach: '海边', studio_plain: '影棚', live_studio: '直播间', business_formal: '商务', tech_lab: '科技', cafe_cozy: '咖啡馆', fitness_energy: '运动', anime_illus: '动漫' }[state.s1.style] || ''}${label}`;
      }
      toast('✨ 图生成完成 · 下面点"生成动态形象"验证驱动效果', 'success');
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
    toast('上传中…');
    file = await compressImageBeforeUpload(file);
    const fd = new FormData();
    fd.append('image', file);
    try {
      const r = await api('/api/dh/images/upload', { method: 'POST', body: fd });
      if (!r.success) throw new Error(r.error || '上传失败');
      resetS1Preview();
      state.s1.previewUrl = r.imageUrl;
      state.s1.fromUpload = true;  // 标记是上传，别污染 description
      $('#dhS1PreviewImg').src = r.imageUrl;
      $('#dhS1Preview').style.display = 'block';
      // 关键：resetS1Preview 把 dhS1Save 设了 disabled，这里要把它打开
      $('#dhS1Save').disabled = false;
      $('#dhS1Save').title = '保存这张形象到「我的形象」';
      _hidePlaceholder();
      if (!$('#dhS1Name').value) $('#dhS1Name').value = '我的形象_' + new Date().toLocaleDateString('zh-CN');
      // 上传的形象不带 AI 描述（那是用户自己的图）
      $('#dhS1Desc').value = '';
      toast('📤 上传完成 · 请手动确认下方性别（如不准）', 'success');
      _composeBtnSync();
      // 异步识别性别 → 仅建议，不自动覆盖用户手选
      detectUploadedGender(r.imageUrl).catch(() => {});
    } catch (err) {
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
  function openDescModal() {
    const current = $('#dhS1Desc').value.trim();
    $('#dhDescInput').value = current;
    $('#dhDescModal').style.display = 'flex';
    setTimeout(() => $('#dhDescInput').focus(), 80);
  }
  function closeDescModal() { $('#dhDescModal').style.display = 'none'; }

  async function submitDescEnhance() {
    const keywords = $('#dhDescInput').value.trim();
    if (!keywords) return toast('请先写一些想法', 'error');
    const btn = $('#dhDescSubmit');
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = '✍️ 扩写中…';
    try {
      const r = await api('/api/dh/describe/enhance', {
        method: 'POST',
        body: { style: state.s1.style, gender: state.s1.gender, keywords },
      });
      if (!r.success) throw new Error(r.error || 'AI 补全失败');
      $('#dhS1Desc').value = r.description;
      closeDescModal();
      toast('✨ 已补充描述（可在左侧文本框继续微调）', 'success');
    } catch (err) {
      toast('AI 补充失败：' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  // ══════════════ Step 1.5 · 动态预览样片 ══════════════
  async function generateSample() {
    if (!state.s1.previewUrl) return toast('请先生成或上传图片', 'error');
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
          waitHint = `（${Math.floor(elapsed / 60)} 分钟，厂商队列较慢，仍在继续等待）`;
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
    // 动态样片是可选验证，不再硬性要求 — 静态图也能直接保存到「我的形象」

    try {
      const isProduct = state.s1.avatarType === 'product';
      const productPayload = isProduct ? {
        image_url: state.s1.product?.imageUrl || '',
        prepared_url: state.s1.product?.preparedUrl || state.s1.product?.imageUrl || '',
        cutout_url: state.s1.product?.cutoutUrl || '',
        image_name: state.s1.product?.imageName || '',
        name: state.s1.product?.imageName || '',
        selling_points: '',
        motion_style: 'hold',
        scene: state.s1.product?.scene || 'street',
      } : null;
      let finalImageUrl = state.s1.previewUrl;
      if (isProduct) {
        finalImageUrl = await ensureS1ProductFused();
      }

      const r = await api('/api/dh/my-avatars', {
        method: 'POST',
        body: {
          name,
          imageUrl: finalImageUrl,
          sampleVideoUrl: state.s1.sampleVideoUrl || null,
          gender: state.s1.gender,
          style: state.s1.style,
          avatar_type: state.s1.avatarType,
          product: productPayload,
          source: state.s1.mode,
          // 上传的不记 AI 描述（那是用户自己的图）
          description: state.s1.fromUpload ? '' : ($('#dhS1Desc')?.value?.trim() || ''),
        },
      });
      if (!r.success) throw new Error(r.error || '保存失败');
      toast(state.s1.sampleVideoUrl ? '💾 已保存（含动态样片）' : '💾 已保存（静态）', 'success');
      // 清状态 + 跳 Step 2
      resetS1Preview();
      $('#dhS1Desc').value = '';
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
    const images = state.myAvatars.filter(a => !a.sample_video_url && !(a.avatar_type === 'product' || a.type === 'product'));
    const vc = $('#dhVideoCount'); if (vc) vc.textContent = videos.length;
    const ic = $('#dhImageCount'); if (ic) ic.textContent = images.length;
  }

  function _avatarCardHtml(a, opts = {}) {
    const selId = state.selectedAvatar?.id;
    const selected = a.id === selId;
    const img = a.image_url || a.photo_url || '';
    const video = a.sample_video_url || null;
    const sourceTag = a.source === 'upload' ? '📤 上传' : a.source === 'dual_generate' ? '👥 双人生成' : '🎨 AI 生成';
    const genderTag = a.gender === 'female' ? '女' : a.gender === 'male' ? '男' : '';
    const media = video
      ? `<video src="${video}" autoplay muted loop playsinline preload="metadata" poster="${img || `/api/dh/my-avatars/${a.id}/thumbnail`}" onclick="this.paused?this.play():this.pause()" onerror="this.outerHTML=&apos;<img src=\"${img || `/api/dh/my-avatars/${a.id}/thumbnail`}\">&apos;"></video>`
      : `<img src="${img}" alt="${escapeHtml(a.name)}" onerror="this.style.opacity=0.3">`;

    const promoting = state.promoting[a.id];
    const isProduct = a.avatar_type === 'product' || a.type === 'product';
    let actionRow;
    if (isProduct) {
      // 商品数字人：需要先生成动态形象才能选中生成视频
      if (video) {
        actionRow = `<div class="dh-av-card-actions">
          <button class="dh-btn dh-btn-primary dh-btn-sm" data-act="select" data-av-id="${a.id}">✓ 选中 → 自动写稿出片</button>
          <button class="dh-btn dh-btn-ghost dh-btn-sm" data-act="delete" data-av-id="${a.id}" title="删除">🗑️</button>
        </div>`;
      } else if (promoting) {
        actionRow = `<div class="dh-promote-progress" style="margin:0 14px 12px">
          <div class="dh-gen-spinner" style="width:14px;height:14px;border-width:2px;margin:0"></div>
          <span>${promoting.stage || '生成动态中'} · ${promoting.elapsed || 0}s</span>
        </div>`;
      } else {
        actionRow = `<div style="padding:0 14px 12px">
          <button class="dh-promote-btn" data-act="promote" data-av-id="${a.id}" style="background:linear-gradient(135deg,rgba(33,255,243,.18),rgba(255,246,0,.12));border:1px solid rgba(33,255,243,.35);color:#21FFF3">🎬 生成动态形象</button>
          <button class="dh-btn dh-btn-ghost dh-btn-sm" data-act="delete" data-av-id="${a.id}" style="margin-top:4px;width:100%" title="删除">🗑️ 删除</button>
        </div>`;
      }
    } else if (video) {
      actionRow = `<div class="dh-av-card-actions">
        <button class="dh-btn dh-btn-primary dh-btn-sm" data-act="select" data-av-id="${a.id}">✓ 选中用这个</button>
        <button class="dh-btn dh-btn-ghost dh-btn-sm" data-act="edit-av" data-av-id="${a.id}" title="编辑名称/性别">✎</button>
        <button class="dh-btn dh-btn-ghost dh-btn-sm" data-act="delete" data-av-id="${a.id}" title="删除">🗑️</button>
      </div>`;
    } else if (promoting) {
      actionRow = `<div class="dh-promote-progress" style="margin:0 14px 12px">
        <div class="dh-gen-spinner" style="width:14px;height:14px;border-width:2px;margin:0"></div>
        <span>${promoting.stage || '渲染中'} · ${promoting.elapsed || 0}s</span>
      </div>`;
    } else {
      actionRow = `<div style="padding:0 14px 12px">
        <button class="dh-promote-btn" data-act="promote" data-av-id="${a.id}">🎬 生成视频素材</button>
        <div style="display:flex;gap:4px;margin-top:4px">
          <button class="dh-btn dh-btn-ghost dh-btn-sm" data-act="select" data-av-id="${a.id}" style="flex:1" title="直接选中（无需先做视频素材）">✓ 选中</button>
          <button class="dh-btn dh-btn-ghost dh-btn-sm" data-act="edit-av" data-av-id="${a.id}" title="编辑名称/性别">✎</button>
          <button class="dh-btn dh-btn-ghost dh-btn-sm" data-act="delete" data-av-id="${a.id}" title="删除">🗑️</button>
        </div>
      </div>`;
    }

    return `<div class="dh-av-card ${selected ? 'selected' : ''}" data-av-id="${a.id}">
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
    const images = state.myAvatars.filter(a => !a.sample_video_url && !(a.avatar_type === 'product' || a.type === 'product')); // 含 generating

    // Tab：'image' | 'video' | 'product'，默认 video（视频素材可直接驱动说话）
    const dhTabbed = state._myAvTab || 'video';
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
      host.style.cssText = 'display:flex;gap:6px;padding:4px;background:var(--dh-bg-soft,#141519);border:1px solid var(--dh-border,#2A2D34);border-radius:999px;width:fit-content';
      host.innerHTML = mkTab('image', '📸 图片素材', images.length)
                     + mkTab('video', '🎬 视频素材', videos.length)
                     + mkTab('product', '🛍️ 商品数字人', products.length);
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
      videoGrid.innerHTML = list.map(a => _avatarCardHtml(a)).join('');
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

  async function selectAvatar(id) {
    const a = state.myAvatars.find(x => x.id === id);
    if (!a) return;
    const isProduct = a.avatar_type === 'product' || a.type === 'product';
    if (isProduct && !a.sample_video_url) {
      return toast('请先点「🎬 生成动态形象」，完成后再选中', 'error');
    }
    state.selectedAvatar = a;
    renderMyAvatars();
    if (state.avatarPickReturn === 'space-guide') {
      state.avatarPickReturn = '';
      renderSelectedAvatar();
      renderSpaceGuide();
      toast(`已选中「${a.name}」，返回广告数字人`, 'success');
      switchTab('space-guide');
      return;
    }
    if (isProduct) {
      toast(`已选中「${a.name}」，跳转第三步并自动写稿…`, 'success');
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
    const userAvatars = state.myAvatars.filter(a =>
      !(a.avatar_type === 'product' || a.type === 'product') &&
      a.source !== 'upload'
    );
    for (const a of userAvatars) {
      const imgUrl = a.image_url || a.photo_url || '';
      if (!imgUrl) continue;
      state.plaza.items.push({
        key: 'user_' + a.id,
        url: imgUrl,
        name: a.name,
        category: 'mine',
        gender: a.gender || 'neutral',
        _user: true,
        _avatarId: a.id,
        _avatarData: a,
      });
    }
    // 动态维护"我生成的"分类选项
    const sel = $('#dhPlazaCategory');
    if (sel) {
      const hasMine = !!sel.querySelector('option[value="mine"]');
      if (userAvatars.length > 0 && !hasMine) {
        const opt = document.createElement('option');
        opt.value = 'mine'; opt.textContent = '我生成的';
        sel.appendChild(opt);
      } else if (userAvatars.length === 0 && hasMine) {
        sel.querySelector('option[value="mine"]').remove();
      }
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
      if (cat === 'mine') return !!it._user;
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
        return `<div class="dh-plaza-card" data-plaza-key="${escapeHtml(it.key)}">
          <div class="dh-plaza-img"><img src="${escapeHtml(it.url)}" alt="${escapeHtml(it.name)}" loading="lazy" onerror="this.style.opacity=0.3"></div>
          <div class="dh-plaza-body">
            <div class="dh-plaza-name">${escapeHtml(it.name)}</div>
            <div class="dh-plaza-tags">
              <span class="dh-plaza-tag" style="background:rgba(255,246,0,.15);color:#FFF600;border-color:rgba(255,246,0,.3)">AI生成</span>
              ${genName ? `<span class="dh-plaza-tag">${genName}</span>` : ''}
            </div>
            <button class="dh-btn dh-btn-primary dh-btn-sm dh-plaza-use" data-plaza-use="${escapeHtml(it.key)}">📌 使用此形象</button>
          </div>
        </div>`;
      }
      const catName = state.plaza.categoryMap?.[it.category] || it.category;
      return `<div class="dh-plaza-card" data-plaza-key="${escapeHtml(it.key)}">
        <div class="dh-plaza-img"><img src="${it.url}" alt="${escapeHtml(it.name)}" loading="lazy" onerror="this.parentNode.parentNode.style.display='none'"></div>
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
    toast(`已选中「${it.name}」，去第三步写稿出片`, 'success');
    setTimeout(() => switchTab('step3'), 400);
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
      ? `<video src="${video}" autoplay muted loop playsinline preload="metadata" poster="${img || `/api/dh/my-avatars/${a.id}/thumbnail`}" onclick="this.paused?this.play():this.pause()" onerror="this.outerHTML=&apos;<img src=\"${img || `/api/dh/my-avatars/${a.id}/thumbnail`}\">&apos;"></video>`
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
    state.s3.writeEntry = mode;
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
        const textInput = $('#dhSpaceText');
        if (textInput) textInput.value = r.text;
        const prompt = buildSpacePromptFromText(r.text, topic);
        const promptInput = $('#dhSpaceScenePrompt');
        if (promptInput) promptInput.value = prompt;
        state.space.scenePrompt = prompt;
        state.space.durationSec = duration_sec;
        closeWriteModal();
        toast(`✨ 已生成广告文案和镜头提示词 · ${r.char_count} 字`, 'success');
        await buildSpaceStoryboardFromText(r.text, duration_sec);
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
      <div class="dh-motion-popover-title dh-motion-drag">第 ${idx + 1} 段 · ${fmtTime(seg.start)}-${fmtTime(seg.end)} · "${escapeHtml(seg.text.slice(0, 30))}..."</div>
      <div class="dh-motion-popover-title" style="margin-top:8px">常用动作</div>
      <div class="dh-motion-actions">
        ${ACTION_PRESETS.map(a => `<button class="dh-motion-action ${a.id === activeId ? 'active' : ''}" data-motion-preset="${a.id}">${a.name}</button>`).join('')}
      </div>
      <div class="dh-motion-popover-title">自定义（英文 prompt）</div>
      <input type="text" class="dh-input dh-motion-input" id="dhMotionCustom" placeholder="e.g. pointing at screen enthusiastically" value="${escapeHtml(seg.motion)}">
      <div class="dh-motion-popover-title" style="margin-top:10px">语调</div>
      <div class="dh-motion-actions">
        ${TONE_PRESETS.map(t => `<button class="dh-motion-action ${t.id === segTone ? 'active' : ''}" data-tone="${t.id}">${t.label}</button>`).join('')}
      </div>
      <input type="text" class="dh-input dh-motion-input" id="dhToneCustom" placeholder="可自定义中文语调，如：温柔但坚定" value="${escapeHtml(presetLabel(TONE_PRESETS, segTone))}">
      <div class="dh-motion-popover-title" style="margin-top:10px">表情</div>
      <div class="dh-motion-actions">
        ${EXPRESSION_PRESETS.map(ex => `<button class="dh-motion-action ${ex.id === seg.expression ? 'active' : ''}" data-expression="${ex.id}">${ex.label}</button>`).join('')}
      </div>
      <div class="dh-motion-popover-title" style="margin-top:10px">镜头</div>
      <div class="dh-motion-actions">
        ${CAMERA_PRESETS.map(c => `<button class="dh-motion-action ${c.id === segCamera ? 'active' : ''}" data-camera="${c.id}">${c.label}</button>`).join('')}
      </div>
      <input type="text" class="dh-input dh-motion-input" id="dhCameraCustom" placeholder="可自定义镜头，如：慢慢推进到商品特写" value="${escapeHtml(presetLabel(CAMERA_PRESETS, segCamera))}">
      <div class="dh-motion-foot">
        <button class="dh-btn dh-btn-ghost dh-btn-sm" id="dhMotionCancel">取消</button>
        <button class="dh-btn dh-btn-primary dh-btn-sm" id="dhMotionSave">保存</button>
      </div>
    `;
    // 定位
    const row = $(`.dh-tl-row[data-seg-idx="${idx}"]`);
    if (row) {
      const r = row.getBoundingClientRect();
      pop.style.top = Math.max(8, Math.min(window.innerHeight - 560, r.bottom + 8)) + 'px';
      pop.style.left = Math.max(8, Math.min(window.innerWidth - 460, r.right - 430)) + 'px';
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
    renderTimeline(state.s3.segments);
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

  // 精确性别识别（防火山/讯飞混入男声到女声组）
  function _inferGender(v) {
    if (v.gender && v.gender !== 'neutral' && v.gender !== 'auto') return v.gender;
    const n = (v.name || '') + ' ' + (v.id || '');
    if (/child|kid|童|小宝/i.test(n)) return 'child';
    // 女性强关键词（覆盖讯飞/火山的常见女声命名）
    if (/female|girl|女|甜美|温柔|知性|清亮|萌妹|温婉|小萍|晶儿|雯雯|小乔|小溪|小馨|甜心|娇憨|御姐|淑女|客服/i.test(n)) return 'female';
    // 男性强关键词
    if (/male(?!\s*\/)|boy|男|磁性|沉稳|成熟|稳重|少年|沉思|青年|大叔|许久|哲|锤锤|博睿|奥特|Kazi|Douji|Jam|Luodo/i.test(n)) return 'male';
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
        <div class="dh-voice-opt-sub">${escapeHtml(v.provider || '')} ${v.isCloned ? '· 我的声音' : ''}</div>
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

  async function previewVoice(voiceId) {
    if (!voiceId) return;
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
      const r = await fetch('/api/avatar/preview-voice', {
        method: 'POST',
        signal: ac.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
        body: JSON.stringify({ voiceId, text: '你好，这是试听。' }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
      await audio.play();
    } catch (err) {
      state.badVoices.add(voiceId);
      localStorage.setItem('dh_bad_voices', JSON.stringify([...state.badVoices]));
      if (state.s3.voiceId === voiceId) state.s3.voiceId = null;
      renderVoices();
      toast('试听失败：' + (err.name === 'AbortError' ? '超时' : err.message), 'error');
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

  function renderTaskPercentBlock(task = {}) {
    const pct = getTaskProgressPercent(task);
    return `<div class="dh-task-percent">
      <div class="dh-task-percent-ring" style="--p:${pct}"><span>${pct}%</span></div>
      <div class="dh-task-percent-label">&#29983;&#25104;&#20013;</div>
    </div>`;
  }

  function taskDetailRows(data = {}) {
    const detail = data.createDetail || {};
    const rows = [
      ['\u4efb\u52a1\u7c7b\u578b', getTaskTypeLabel(getTaskType(data))],
      ['\u6807\u9898', detail.title || data.avatarName || ''],
      ['\u751f\u6210\u65f6\u957f', detail.durationSec ? `${detail.durationSec}s` : ''],
      ['\u5f62\u8c61', detail.avatarName || ''],
      ['\u80cc\u666f/\u4ea7\u54c1\u56fe', detail.backgroundName || detail.productName || ''],
      ['\u914d\u97f3', detail.voiceId || '\u81ea\u52a8/\u672a\u6307\u5b9a'],
      ['\u6587\u6848', detail.text || data.textPreview || ''],
      ['\u955c\u5934\u63d0\u793a\u8bcd', detail.scenePrompt || ''],
      ['\u955c\u5934\u987a\u5e8f', detail.cameraPrompt || ''],
    ].filter(([, v]) => v !== undefined && v !== null && String(v).trim());
    return rows.map(([k, v]) => `<div class="dh-task-detail-row">
      <div class="dh-task-detail-key">${escapeHtml(k)}</div>
      <div class="dh-task-detail-value">${escapeHtml(v)}</div>
    </div>`).join('');
  }

  function renderTaskDetailPanel(data = {}) {
    const rows = taskDetailRows(data);
    if (!rows) return '';
    return `<div class="dh-task-detail-panel">
      <div class="dh-task-detail-title">&#21019;&#24314;&#20869;&#23481;</div>
      <div class="dh-task-detail-grid">${rows}</div>
    </div>`;
  }

  function resetSpaceGuideFormForNext() {
    state.space.bgImageUrl = '';
    state.space.bgImageName = '';
    state.space.scenePrompt = '';
    state.space.cameraPrompt = '';
    state.space.segments = [];
    state.space.copyMode = 'manual';
    ['#dhSpaceTitle', '#dhSpaceText', '#dhSpaceScenePrompt', '#dhSpaceCameraPrompt'].forEach(sel => {
      const el = $(sel);
      if (el) el.value = '';
    });
    const preview = $('#dhSpacePreview');
    if (preview) preview.innerHTML = '<div class="dh-space-preview-empty"><b>&#24050;&#25552;&#20132;&#21040;&#20219;&#21153;&#20013;&#24515;</b><span>&#34920;&#21333;&#24050;&#28165;&#31354;&#65292;&#21487;&#20197;&#32487;&#32493;&#21019;&#24314;&#19979;&#19968;&#20010;&#24191;&#21578;&#25968;&#23383;&#20154;&#12290;</span></div>';
    renderSpaceGuide();
    renderSpaceCopyMode();
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
    if (task?.taskType === 'product_ad') return 'product_ad';
    if (task?.taskType === 'digital_ad' || task?.taskType === 'space_guide') return 'digital_ad';
    return 'digital_human';
  }

  function getTaskTypeLabel(type) {
    return {
      digital_human: '数字人',
      product_ad: '商品数字人',
      digital_ad: '广告数字人',
    }[type] || '数字人';
  }

  // 视频放大预览 modal — 任务中心 / 作品库共用
  function openVideoPreviewModal(videoUrl, title) {
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
    v.src = videoUrl;
    v.currentTime = 0;
    modal.querySelector('.dh-video-modal-download').href = videoUrl;
    modal.classList.add('open');
    setTimeout(() => v.play().catch(() => {}), 50);
  }
  function closeVideoPreviewModal() {
    const modal = document.getElementById('dhVideoPreviewModal');
    if (!modal) return;
    const v = modal.querySelector('.dh-video-modal-video');
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    modal.classList.remove('open');
  }

  // 任务进度弹窗 —— 替代原本"查看进度"跳回 step3 的行为
  function openTaskProgressModal(taskId) {
    let modal = document.getElementById('dhTaskProgressModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'dhTaskProgressModal';
      modal.className = 'dh-video-modal';
      modal.innerHTML = `
        <div class="dh-video-modal-backdrop" data-modal-close></div>
        <div class="dh-video-modal-card" style="max-width:480px">
          <div class="dh-video-modal-head">
            <span class="dh-video-modal-title">任务进度</span>
            <button class="dh-video-modal-close" data-modal-close type="button" title="关闭">×</button>
          </div>
          <div class="dh-task-progress-modal-body" style="padding:24px 20px"></div>
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
    const title = modal.querySelector('.dh-modal-title');
    if (title) title.textContent = '\u4efb\u52a1\u8be6\u60c5';
    if (!body) return;
    if (!data) {
      body.innerHTML = `<div class="dh-render-stage"><div class="dh-render-stage-name">&#20219;&#21153;&#24050;&#19981;&#23384;&#22312;</div></div>`;
      return;
    }
    const elapsed = data.elapsed || Math.round((Date.now() - (data.startedAt || Date.now())) / 1000);
    const detailPanel = renderTaskDetailPanel(data);
    if (data.videoUrl || data.video_url) {
      const url = data.videoUrl || data.video_url;
      body.innerHTML = `<div class="dh-render-stage">
        <div class="dh-render-stage-name">&#10003; &#29983;&#25104;&#23436;&#25104; · ${escapeHtml(data.avatarName || '')}</div>
        <div class="dh-render-stage-sub">&#24050;&#33258;&#21160;&#20445;&#23384;&#21040;&#20316;&#21697;&#24211;</div>
      </div>
      ${detailPanel}
      <video class="dh-render-video" src="${escapeHtml(url)}" controls playsinline style="margin-top:12px;width:100%;border-radius:8px"></video>`;
      return;
    }
    if (data.status === 'error' || data.status === 'invalid' || data.status === 'timeout') {
      body.innerHTML = `<div class="dh-render-stage">
        <div class="dh-render-stage-name" style="color:var(--dh-error)">&#10005; ${escapeHtml(getTaskStatusText(data.status))}</div>
        <div class="dh-render-stage-sub">${escapeHtml(data.error || '')}</div>
      </div>
      ${detailPanel}`;
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
      const preview = active
        ? `<div class="dh-task-thumb dh-task-thumb-running">${renderTaskPercentBlock(t)}</div>`
        : (t.videoUrl
          ? `<div class="dh-task-thumb dh-task-thumb-done" data-task-preview="${escapeHtml(t.taskId)}" title="&#28857;&#20987;&#25918;&#22823;&#39044;&#35272;">
               <video class="dh-task-thumb-video" src="${escapeHtml(t.videoUrl)}#t=0.1" preload="metadata" muted playsinline></video>
               <span class="dh-task-thumb-play">&#9654;</span>
             </div>`
          : `<div class="dh-task-thumb dh-task-thumb-empty">${getTaskStatusText(t.status)}</div>`);
      const video = t.videoUrl
        ? `<video class="dh-task-video" src="${escapeHtml(t.videoUrl)}" controls playsinline data-task-preview="${escapeHtml(t.taskId)}" title="&#28857;&#20987;&#25918;&#22823;&#39044;&#35272;"></video>`
        : '';
      const error = t.error ? `<div class="dh-task-error">${escapeHtml(t.error)}</div>` : '';
      const subtitle = t.subtitleWarning
        ? `<div class="dh-task-warning">${escapeHtml(t.subtitleWarning)}</div>`
        : (t.subtitleBurned ? `<div class="dh-task-ok">&#23383;&#24149;&#24050;&#28903;&#24405;&#21040;&#35270;&#39057;</div>` : '');
      const progressBar = active ? `<div class="dh-task-progress-bar"><i style="width:${progressPct}%"></i></div>` : '';
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
            <button class="dh-btn dh-btn-ghost dh-btn-sm" data-task-focus="${escapeHtml(t.taskId)}">&#26597;&#30475;&#35814;&#24773;</button>
            ${t.videoUrl ? `<a class="dh-btn dh-btn-ghost dh-btn-sm" href="${escapeHtml(t.videoUrl)}" download>&#19979;&#36733;</a>` : ''}
            <button class="dh-btn dh-btn-ghost dh-btn-sm" data-tab-go="works">&#20316;&#21697;&#24211;</button>
            <button class="dh-btn dh-btn-ghost dh-btn-sm" data-task-remove="${escapeHtml(t.taskId)}">&#31227;&#38500;</button>
          </div>
        </div>
      </div>`;
    }).join('');
  }
  function syncRunningTask(taskId, patch = {}) {
    const current = state.s3.runningTasks.get(taskId) || {};
    const next = { ...current, ...patch };
    state.s3.runningTasks.set(taskId, next);
    upsertVideoTask({ taskId, ...next });
    return next;
  }

  function restoreVideoTasks() {
    renderTaskCenter();
    readVideoTasks()
      .filter(t => ACTIVE_TASK_STATUSES.has(t.status))
      .forEach(t => {
        if (state.s3.runningTasks.has(t.taskId)) return;
        state.s3.runningTasks.set(t.taskId, { ...t, snapshot: null });
        pollVideoTask(t.taskId);
      });
  }

  function renderSpaceGuide() {
    const host = $('#dhSpaceAvatar');
    if (host) {
      const a = state.selectedAvatar;
      if (!a) {
        host.innerHTML = `<div class="dh-selected-empty">
          <div class="dh-empty-icon">▥</div>
          <div>从「我的形象」选择一个数字人</div>
          <button class="dh-link-btn" data-space-pick-avatar>去选择形象 →</button>
        </div>`;
      } else {
        const img = a.image_url || a.photo_url || '';
        const video = a.sample_video_url || '';
        host.innerHTML = `${video
          ? `<video src="${escapeHtml(video)}" autoplay muted loop playsinline poster="${escapeHtml(img)}"></video>`
          : `<img src="${escapeHtml(img)}" alt="${escapeHtml(a.name || '数字人')}">`}
          <div class="av-name">${escapeHtml(a.name || '已选形象')}</div>
          <div class="av-badges"><span class="av-badge">广告数字人</span></div>
          <button class="av-switch-btn" data-space-pick-avatar>↻ 切换形象</button>`;
      }
    }

    const bgPreview = $('#dhSpaceBgPreview');
    const bgDrop = $('#dhSpaceBgDrop');
    const bgImg = $('#dhSpaceBgImg');
    if (bgPreview && bgDrop && bgImg) {
      if (state.space.bgImageUrl) {
        bgImg.src = state.space.bgImageUrl;
        bgPreview.style.display = '';
        bgDrop.style.display = 'none';
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
    const current = state.space.voiceId || '';
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
    const card = v => `<div class="dh-voice-opt ${v.isCloned ? 'cloned' : ''} ${String(v.id) === String(current) ? 'selected' : ''}" data-space-voice-id="${escapeHtml(v.id)}">
      <div class="dh-voice-opt-icon">${v.providerIcon || genderIcon(v._gender || v.gender)}</div>
      <div class="dh-voice-opt-body">
        <div class="dh-voice-opt-name">${escapeHtml(v.name || v.id)} <span style="font-size:10px;color:var(--dh-text-muted)">${_genderLabel(v._gender || v.gender)}</span></div>
        <div class="dh-voice-opt-sub">${escapeHtml(v.provider || '')} ${v.isCloned ? '· 我的声音' : ''}</div>
      </div>
      ${v.id ? `<button class="dh-voice-opt-preview" data-voice-preview="${escapeHtml(v.id)}" title="试听">▶</button>` : ''}
    </div>`;
    const selectedVoice = (state.voices || []).find(v => String(v.id) === String(current) && !state.badVoices.has(v.id));
    const currentHost = $('#dhSpaceVoiceCurrent');
    if (currentHost) {
      currentHost.innerHTML = selectedVoice ? `
        <div class="dh-voice-opt-icon">${selectedVoice.providerIcon || genderIcon(selectedVoice._gender || selectedVoice.gender)}</div>
        <div class="dh-voice-opt-body">
          <div class="dh-voice-opt-name">${escapeHtml(selectedVoice.name || selectedVoice.id)} <span style="font-size:10px;color:var(--dh-text-muted)">${_genderLabel(selectedVoice._gender || selectedVoice.gender)}</span></div>
          <div class="dh-voice-opt-sub">${escapeHtml(selectedVoice.provider || '')} ${selectedVoice.isCloned ? '· 我的声音' : ''}</div>
        </div>
        ${selectedVoice.id ? `<button class="dh-voice-opt-preview" data-voice-preview="${escapeHtml(selectedVoice.id)}" title="试听">▶</button>` : ''}`
        : `<div class="dh-voice-opt-icon">!</div>
        <div class="dh-voice-opt-body">
          <div class="dh-voice-opt-name">未选择配音音色</div>
          <div class="dh-voice-opt-sub">广告数字人必须选择一个可用音色后才能生成</div>
        </div>`;
    }
    let html = !list.length ? `<div class="dh-voice-group"><div class="dh-voice-group-title">配音音色</div>
      <div class="dh-empty" style="padding:12px">暂无可用音色，请先到声音克隆或模型配置中添加音色。</div>
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
    try {
      file = await compressImageBeforeUpload(file);
      const fd = new FormData();
      fd.append('image', file);
      const r = await api('/api/dh/images/upload', { method: 'POST', body: fd });
      if (!r.success) throw new Error(r.error || '上传失败');
      const imageUrl = r.imageUrl || r.url || r.image_url || r.data?.imageUrl || r.data?.url || r.data?.image_url || '';
      if (!imageUrl) throw new Error('上传成功但没有返回图片地址');
      state.space.bgImageUrl = imageUrl;
      state.space.bgImageName = file.name || 'space-bg';
      renderSpaceGuide();
      toast('空间背景已上传', 'success');
    } catch (err) {
      toast('背景上传失败：' + err.message, 'error');
    }
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

  function buildSpacePromptFromText(text, extra = '') {
    const src = String(text || '').trim();
    const hint = String(extra || '').trim();
    const compact = src.replace(/\s+/g, '').slice(0, 180);
    const hasCta = /(预约|下单|咨询|购买|领取|扫码|联系|到店|体验|抢购)/.test(src);
    const hasMaterial = /(材质|纹理|金属|木纹|石材|灯光|质感|细节|工艺|空间)/.test(src + hint);
    const hasProduct = /(产品|商品|品牌|新品|卖点|功能|效果|定制)/.test(src + hint);
    const shots = [
      '第一镜展示广告背景或完整空间，保留主体构图和品牌展示区',
      hasMaterial || hasProduct ? '第二镜缓慢推进到产品、材质、灯光或核心卖点细节' : '第二镜推进到画面中最有辨识度的视觉重点',
      '第三镜数字人站在左侧自然讲解，右侧完整展示背景/产品画面',
      hasCta ? '最后镜头收束到购买、预约或咨询引导，画面保持干净可信' : '最后镜头给到记忆点收束，保持导览感和高级感',
    ];
    return `${shots.join('；')}。整体镜头稳定、真实商业广告质感，人物口型和文案节奏一致，不要额外字幕、贴纸、无关人物或夸张转场。${compact ? `文案核心：${compact}` : ''}`.slice(0, 360);
  }

  function renderSpaceCopyMode() {
    $$('[data-space-copy-mode]').forEach(b => b.classList.toggle('active', b.dataset.spaceCopyMode === (state.space.copyMode || 'manual')));
    const hint = $('#dhSpacePromptHint');
    if (hint) hint.textContent = state.space.copyMode === 'ai'
      ? 'AI 生成会先打开弹窗收集产品、场景、卖点、目标人群等信息，再自动写广告文案和镜头提示词。'
      : '手动输入广告文案后，系统会根据内容自动生成右侧镜头提示词。';
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

  async function buildSpaceStoryboardFromText(text, durationSec) {
    const s = await api('/api/dh/scripts/segment', {
      method: 'POST',
      body: { text, target_duration_sec: durationSec },
    });
    if (!s.success) throw new Error(s.error || '拆分失败');
    state.space.segments = s.segments || [];
    const box = $('#dhSpacePreview');
    if (box) {
      box.innerHTML = `<div class="dh-storyboard-grid">
        ${state.space.segments.map((seg, idx) => `<div class="dh-story-card">
          <div class="dh-story-thumb">${String(idx + 1).padStart(2, '0')}</div>
          <div class="dh-story-meta">
            <span>${fmtTime(seg.start)}-${fmtTime(seg.end)}</span>
            <span class="dh-story-badge">${escapeHtml(presetLabel(TONE_PRESETS, seg.tone || 'natural'))}</span>
          </div>
          <b>${escapeHtml(seg.title || `分镜 ${idx + 1}`)}</b>
          <p>${escapeHtml(seg.text)}</p>
          <span>下一步会按此段生成广告首帧，并用 Seedance 串联成片。</span>
        </div>`).join('')}
      </div>`;
    }
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
      toast(`AI 已生成并拆成 ${state.space.segments.length} 段`, 'success');
    } catch (err) {
      toast('分镜看板生成失败：' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = old || '生成分镜看板'; }
    }
  }

  async function submitSpaceGuide() {
    const missing = [];
    if (!state.selectedAvatar) missing.push('人物形象');
    if (!state.space.bgImageUrl) missing.push('广告背景');
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
    const cameraPrompt = '';
    const subtitleOn = $('#dhSpaceSubtitleOn')?.checked !== false;
    state.space.durationSec = durationSec;
    state.space.scenePrompt = scenePrompt;
    state.space.cameraPrompt = cameraPrompt;
    const box = $('#dhSpacePreview');
    if (box) {
      box.innerHTML = renderProgressPreview('生成广告首帧', '后台会先按看板生成多张关键帧，再用提示词串联并交给 Seedance 合成视频', 0, {
        previewUrl: state.space.bgImageUrl,
      });
    }

    try {
      let segments = state.space.segments || [];
      if (!segments.length || segments.map(x => x.text).join('').slice(0, 20) !== text.slice(0, 20)) {
        const s = await api('/api/dh/scripts/segment', {
          method: 'POST',
          body: { text, target_duration_sec: durationSec },
        });
        if (s.success) segments = state.space.segments = s.segments || [];
      }
      const r = await api('/api/dh/spaces/generate', {
        method: 'POST',
        body: {
          avatar_id: state.selectedAvatar.id,
          background_url: state.space.bgImageUrl,
          text,
          title,
          voice_id: voiceId || null,
          scene: 'auto',
          camera: 'auto',
          scene_prompt: scenePrompt,
          camera_prompt: 'AI 根据广告内容、背景画面和文案自动选择镜头运动',
          duration_sec: durationSec,
          segments,
          subtitle: getDhSubtitlePayload(subtitleOn),
          generation_mode: 'topview',
        },
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
        avatarName: state.selectedAvatar.name || '',
        avatarId: state.selectedAvatar.id || '',
        voiceId: voiceId || '',
        submittedAt: new Date().toISOString(),
      };
      const taskMeta = {
        taskId: r.taskId,
        avatarName: title || state.selectedAvatar.name,
        startedAt: Date.now(),
        status: 'submitted',
        stage: 'submitted',
        snapshot: null,
        previewUrl: r.keyframeUrl || state.space.bgImageUrl,
        textPreview: `${durationSec}s · 可控分镜 · ${text.slice(0, 60)}`,
        taskType: 'digital_ad',
        createDetail,
      };
      syncRunningTask(r.taskId, taskMeta);
      pollVideoTask(r.taskId);
      state.activeTaskType = 'digital_ad';
      if (box) {
        box.innerHTML = `<div class="dh-space-result">
          <div>
            <div class="dh-render-stage-name">已提交到任务中心</div>
            <div class="dh-render-stage-sub">${durationSec}s · AI 自动镜头 · 首帧和视频都在后台生成，可以继续创建其他任务。</div>
            <button class="dh-btn dh-btn-primary dh-btn-sm" data-tab-go="tasks">查看任务中心</button>
          </div>
        </div>`;
      }
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
    box.innerHTML = renderProgressPreview('提交中', '按管理端选择的数字人模型生成');

    try {
      const r = await api('/api/dh/videos/generate', {
        method: 'POST',
        body: {
          avatar_id: state.selectedAvatar.id,
          text,
          voice_id: state.s3.voiceId || null,
          title: state.selectedAvatar.name,
          segments: state.s3.segments || [],
          subtitle: state.s3.subtitle || null,
          product: productApiPayload(state.s3.product),
        },
      });
      if (!r.success) throw new Error(r.error || '提交失败');
      state.s3.taskId = r.taskId;
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
    if (!isProductAvatar) return toast('只有商品数字人可以生成 Topview 式广告介绍片', 'error');
    const product = productApiPayload(state.s3.product);
    if (!product?.image_url) return toast('商品介绍片需要商品图，请先补传商品', 'error');
    const topic = $('#dhS3Text')?.value.trim()
      || [product.name, product.selling_points].filter(Boolean).join('，')
      || '生成一条产品介绍短视频';
    const ok = await DhConfirm({
      title: '生成 Topview 式产品介绍片',
      message: '系统会自动生成分镜关键帧，再用 Seedance 串成产品广告片。',
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
    if (box) box.innerHTML = renderProgressPreview('提交中', '准备产品介绍片');
    try {
      const r = await api('/api/dh/product-ads/generate', {
        method: 'POST',
        body: {
          avatar_id: state.selectedAvatar.id,
          product,
          topic,
          duration_sec: Math.max(14, Math.min(28, Number(state.s3.targetDurationSec) || 18)),
          voice_id: state.s3.voiceId || null,
          subtitle: state.s3.subtitle || null,
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
        submittedAt: new Date().toISOString(),
      };
      const taskMeta = {
        taskId: r.taskId,
        taskType: 'product_ad',
        createDetail,
        avatarName: `${product.name || product.image_name || '商品'} · 广告介绍片`,
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
      toast('已提交广告介绍片任务，可以继续做其他内容', 'success');
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
    const MAX = 10 * 60 * 1000;

    const tick = async () => {
      try {
        const box = (state.s3.taskId === taskId) ? $('#dhRenderBox') : null;
        const endpoint = meta.taskType === 'product_ad'
          ? `/api/dh/product-ads/${taskId}`
          : (meta.taskType === 'space_guide' || meta.taskType === 'digital_ad')
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
        meta.snapshot = t;
        const stageMap = {
          prepare_image: { name: '🖼️ 准备形象', sub: '上传/归一化图片' },
          prepare_audio: { name: '🎤 准备语音', sub: 'TTS 准备中' },
          detecting:     { name: '🔍 主体检测', sub: '抠出人物' },
          submitting:    { name: '⚡ 提交渲染', sub: '排队中' },
          submitted:     { name: '⏳ 等待中', sub: '已提交，等服务端调度' },
          polling:       { name: '⏳ 等待中', sub: '渲染中，请稍候' },
          running:       { name: '🎨 渲染中', sub: `引擎状态 ${t.cv_status || '...'}` },
          storyboard:    { name: '🧩 生成分镜', sub: t.message || '规划产品广告镜头' },
          keyframes:     { name: '🖼️ 生成关键帧', sub: t.message || '固定商品和场景画面' },
          guide_keyframe:{ name: '🖼️ 生成导览首帧', sub: t.message || '融合讲解员和空间背景' },
          guide_video:   { name: '🎬 生成讲解视频', sub: t.message || '驱动数字人一镜到底讲解' },
          video:         { name: '🎞️ 图生视频', sub: t.message || 'Seedance 正在生成镜头' },
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
        });
        refreshTaskProgressModal();

        const doneVideoUrl = t.video_url || t.videoUrl;
        if (t.status === 'done' && doneVideoUrl) {
          clearInterval(meta.pollTimer);
          state.s3.runningTasks.delete(taskId);
          upsertVideoTask({
            taskId,
            status: 'done',
            stage: 'done',
            elapsed,
            videoUrl: doneVideoUrl,
            subtitleBurned: !!t.subtitle_burned,
            subtitleWarning: t.subtitle_warning || '',
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
            <a class="dh-btn dh-btn-ghost dh-btn-sm" href="${doneVideoUrl}" download>⬇ 下载</a>
            <button class="dh-btn dh-btn-ghost dh-btn-sm" data-tab-go="works">📚 作品库</button>
          </div>`;
          toast(`🎉 ${meta.avatarName || ''} 渲染完成`, 'success');
          return;
        }
        if (t.status === 'error') {
          clearInterval(meta.pollTimer);
          state.s3.runningTasks.delete(taskId);
          upsertVideoTask({
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
            error: '轮询超时，请去作品库刷新或重新提交。',
          });
          toast(`${meta.avatarName || ''} 轮询超时，请去作品库刷新`, 'error');
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
          ? `<video src="${video}" autoplay muted loop playsinline preload="metadata" poster="${img || `/api/dh/my-avatars/${a.id}/thumbnail`}" onclick="this.paused?this.play():this.pause()" onerror="this.outerHTML=&apos;<img src=\"${img || `/api/dh/my-avatars/${a.id}/thumbnail`}\">&apos;"></video>`
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
            <div style="display:flex;gap:6px;margin-top:8px"><a class="dh-btn dh-btn-ghost dh-btn-sm" href="${t.video_url}" download>⬇ 下载</a><button class="dh-btn dh-btn-ghost dh-btn-sm" data-tab-go="works">📚 作品库</button></div>`;
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
        // 优先级：服务端预生成首帧 → 数字人形象图 → on-demand 抽帧端点 → 兜底空
        // <video poster> 不能带 Authorization header → 用 ?token=xxx 走 auth 中间件 query 参数
        const tokenQ = state.token ? ('?token=' + encodeURIComponent(state.token)) : '';
        const onDemandPoster = `/api/dh/videos/tasks/${t.id}/thumbnail${tokenQ}`;
        const poster = t.thumbnail_url || t.imageUrl || t.image_url || onDemandPoster;
        const title = t.title || '未命名';
        const when = t.created_at ? new Date(t.created_at).toLocaleString('zh-CN') : '';
        const posterAttr = poster ? `poster="${escapeHtml(poster)}"` : '';
        // 字幕状态徽章
        let subBadge = '';
        if (t.subtitle_warning) {
          subBadge = `<span style="display:inline-block;padding:1px 6px;background:rgba(255,77,109,0.15);border:1px solid var(--dh-error);color:var(--dh-error);border-radius:4px;font-size:10px;margin-left:6px" title="${escapeHtml(t.subtitle_warning)}">⚠️ 字幕失败</span>`;
        } else if (t.subtitle_burned) {
          subBadge = `<span style="display:inline-block;padding:1px 6px;background:rgba(33,255,243,0.10);border:1px solid var(--dh-primary);color:var(--dh-primary);border-radius:4px;font-size:10px;margin-left:6px">📝 含字幕</span>`;
        }
        return `<div class="dh-av-card">
          <video src="${escapeHtml(url)}" ${posterAttr} controls playsinline preload="metadata" style="object-fit:contain;background:#000"></video>
          <div class="dh-av-card-meta">
            <div class="dh-av-card-name"><span>${escapeHtml(title)}</span>${subBadge}</div>
            <div class="dh-av-card-sub">${when}</div>
          </div>
          <div class="dh-av-card-actions">
            <a class="dh-btn dh-btn-ghost dh-btn-sm" href="${escapeHtml(url)}" download style="flex:1;justify-content:center">⬇ 下载</a>
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
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.play();
      const provider = r.headers.get('X-Clone-Provider') || '';
      toast(`🔊 播放中${provider ? '（' + provider + '）' : ''}`, 'success');
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
  document.addEventListener('click', async (e) => {
    const target = e.target;
    const closest = s => target.closest(s);

    const navItem = closest('.dh-nav-item'); if (navItem?.dataset.tab) { switchTab(navItem.dataset.tab); return; }
    const spacePickAvatar = closest('[data-space-pick-avatar]');
    if (spacePickAvatar) {
      state.avatarPickReturn = 'space-guide';
      switchTab('step2');
      return;
    }
    const tabGo = closest('[data-tab-go]'); if (tabGo) { switchTab(tabGo.dataset.tabGo); return; }
    const plazaUse = closest('[data-plaza-use]'); if (plazaUse) { e.stopPropagation(); usePlazaAvatar(plazaUse.dataset.plazaUse); return; }
    if (closest('#dhTaskRefresh')) { restoreVideoTasks(); toast('任务状态已刷新', 'success'); return; }
    const taskTypeTab = closest('[data-task-type]');
    if (taskTypeTab) {
      state.activeTaskType = taskTypeTab.dataset.taskType || 'digital_human';
      renderTaskCenter();
      return;
    }
    if (closest('#dhTaskClearDone')) {
      writeVideoTasks(readVideoTasks().filter(t => ACTIVE_TASK_STATUSES.has(t.status)));
      toast('已清理完成/失败任务', 'success');
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
    if (closest('#dhSpaceBgDrop')) { $('#dhSpaceBgFile')?.click(); return; }
    if (closest('#dhSpaceBgClear')) {
      state.space.bgImageUrl = '';
      state.space.bgImageName = '';
      renderSpaceGuide();
      return;
    }
    if (closest('#dhSpaceVoiceOpen')) {
      const modalSearch = $('#dhSpaceVoiceModalSearch');
      if (modalSearch) modalSearch.value = '';
      $('#dhSpaceVoiceModal').style.display = 'flex';
      renderSpaceVoiceOptions();
      setTimeout(() => $('#dhSpaceVoiceModalSearch')?.focus(), 30);
      return;
    }
    if (closest('[data-space-voice-close]') || target === $('#dhSpaceVoiceModal')) {
      $('#dhSpaceVoiceModal').style.display = 'none';
      return;
    }
    if (closest('#dhSpaceSampleText')) {
      const text = '大家现在看到的是这面定制展示墙。它的纹理层次非常丰富，在顶部射灯的照射下，会呈现出自然的金属光泽和空间纵深。我们把人物讲解区放在左侧，右侧完整保留展示面，这样观众既能看到讲解员，也能清楚看到空间亮点。';
      const input = $('#dhSpaceText');
      if (input) input.value = text;
      state.space.segments = [];
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
    if (closest('#dhSpaceSubmit')) { submitSpaceGuide(); return; }

    // Step 1
    const modeBtn = closest('.dh-mode-btn'); if (modeBtn) { setMode(modeBtn.dataset.mode); return; }
    const s1TypeBtn = closest('[data-s1-avatar-type]'); if (s1TypeBtn) { setS1AvatarType(s1TypeBtn.dataset.s1AvatarType); return; }
    if (closest('#dhS1ProductPickBtn')) { $('#dhS1ProductFile')?.click(); return; }
const gChip = closest('[data-gender]'); if (gChip) { selectGender(gChip.dataset.gender); return; }
    const sCard = closest('[data-style]'); if (sCard) { selectStyle(sCard.dataset.style); return; }
    const rChip = closest('[data-ratio]'); if (rChip) { selectRatio(rChip.dataset.ratio); return; }
    const s1Action = closest('[data-s1-action]'); if (s1Action) { selectS1Action(s1Action.dataset.s1Action); return; }
    const s1Frm = closest('[data-s1-framing]'); if (s1Frm) { selectS1Framing(s1Frm.dataset.s1Framing); return; }
    if (closest('#dhS1BgPickBtn')) { document.getElementById('dhS1BgFile')?.click(); return; }
    if (closest('#dhS1BgClear')) { clearS1Background(); return; }
    if (closest('#dhS1GenBtn')) { generateImage(); return; }
    if (closest('#dhS1Regen')) { if (state.s1.mode === 'generate') generateImage(); else $('#dhS1UploadFile').click(); return; }
    if (closest('#dhS1SampleBtn')) { generateSample(); return; }
    if (closest('#dhS1DescAIBtn')) { e.preventDefault(); openDescModal(); return; }
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
    if (closest('#dhSpaceSubtitleStyleBtn')) { openSubtitleModal('space'); return; }
    if (closest('[data-subtitle-close]')) { closeSubtitleModal(); return; }
    const subStyleBtn = closest('.dh-sub-style');
    if (subStyleBtn) { setActiveSubStyle(subStyleBtn.dataset.subStyle); return; }
    const subPreset = closest('[data-sub-preset]');
    if (subPreset) { applySubPreset(subPreset.dataset.subPreset); return; }
    if (closest('#dhSubtitleSave')) { saveSubtitleSettings(); return; }

    // Step 2
    const selBtn = closest('[data-act="select"]'); if (selBtn) { selectAvatar(selBtn.dataset.avId); return; }
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

    // Step 2 promote 图片→视频
    const promoteBtn = closest('[data-act="promote"]');
    if (promoteBtn) { promoteToVideo(promoteBtn.dataset.avId); return; }

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
    state.subtitleTarget = target === 'space' ? 'space' : 's3';
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
    const showInput = state.subtitleTarget === 'space' ? $('#dhSpaceSubtitleOn') : $('#dhS3SubtitleOn');
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
    if (s3On) s3On.checked = state.s3.subtitle.show !== false;
    if (spaceOn) {
      spaceOn.checked = state.s3.subtitle.show !== false;
      state.space.subtitle = state.s3.subtitle.show !== false;
    }
    closeSubtitleModal();
    toast(`字幕已保存：${SUB_STYLE_LABELS[state.s3.subtitle.style] || state.s3.subtitle.style}`, 'success');
  }

  document.addEventListener('input', (e) => {
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
    const grid = $('#pdhMyAvGrid');
    if (!grid) return;
    const avs = (state.myAvatars || []).filter(a => a.imageUrl);
    if (!avs.length) {
      grid.innerHTML = '<div class="dh-empty" style="font-size:12px;padding:10px;text-align:center"><div class="dh-empty-icon" style="font-size:20px">📂</div><div>暂无形象</div></div>';
      return;
    }
    grid.innerHTML = avs.map(a => `<div class="dh-av-card" data-pdh-pick-av="${escapeHtml(a.id)}" style="cursor:pointer">
      <div class="dh-av-thumb">${a.imageUrl ? `<img src="${escapeHtml(a.imageUrl)}" alt="">` : '<div class="dh-av-placeholder">👤</div>'}</div>
      <div class="dh-av-name" style="font-size:11px">${escapeHtml(a.name || '形象')}</div>
    </div>`).join('');
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
    return (state.voices || []).find(v => String(v.id || '') === String(pdh.voiceId || '')) || null;
  }

  function pdhRenderVoiceCurrent() {
    const host = $('#pdhVoiceCurrent');
    if (!host) return;
    const v = pdhSelectedVoice();
    host.innerHTML = v ? `
      <div class="dh-voice-opt-icon">${v.providerIcon || genderIcon(v._gender || v.gender)}</div>
      <div class="dh-voice-opt-body">
        <div class="dh-voice-opt-name">${escapeHtml(v.name || v.id)}</div>
        <div class="dh-voice-opt-sub">${escapeHtml(v.provider || v.providerId || 'TTS')} ${v.isCloned ? '· 我的声音' : ''}</div>
      </div>
      ${v.id ? `<button class="dh-voice-opt-preview" data-voice-preview="${escapeHtml(v.id)}" title="试听">▶</button>` : ''}
    ` : `
      <div class="dh-voice-opt-icon">🎙️</div>
      <div class="dh-voice-opt-body">
        <div class="dh-voice-opt-name">请选择配音音色</div>
        <div class="dh-voice-opt-sub">优先使用阿里等低成本 TTS，Topview 兼容</div>
      </div>
    `;
  }

  async function pdhOpenVoiceModal() {
    await pdhLoadVoices();
    openVoiceModal({
      currentVoiceId: pdh.voiceId || '',
      onSelect: voiceId => {
        pdh.voiceId = voiceId || '';
        const input = $('#pdhVoiceSelect');
        if (input) input.value = pdh.voiceId;
        pdhRenderVoiceCurrent();
      },
    });
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

  // ── 商品数字人：融合商品形象，结果保存到我的形象 ──
  async function pdhGenerate() {
    if (pdh.running) return;
    const voiceId = ($('#pdhVoiceSelect')?.value || pdh.voiceId || '').trim();
    const missing = [];
    if (!pdh.personUrl) missing.push('人物照片');
    if (!pdh.productUrl) missing.push('商品图');
    if (!voiceId) missing.push('配音音色');
    if (missing.length) {
      await DhConfirm({
        title: '还不能生成商品数字人',
        message: '请先补齐必填内容后再生成。',
        detail: missing.map(x => `缺少：${x}`).join('<br>'),
        confirmText: '我知道了',
        cancelText: '关闭',
        type: 'warning',
      });
      return;
    }
    pdh.voiceId = voiceId;

    pdh.running = true;
    const productName = ($('#pdhProductNameInput')?.value || '').trim() || '商品';
    pdh.productName = productName;

    const btn = $('#pdhGenerateBtn');
    if (btn) { btn.disabled = true; btn.textContent = '融合中…'; }

    // 每次生成新增一张卡，画廊保留历史（像看板）
    pdhHideEmpty();
    const cardId = 'pdhFuse_' + Date.now();
    pdhAddCard(cardId, `广告形象`, '生成中', 'pdh2-result-tag-blue');
    pdhCardMsg(cardId, 'Topview Step 1: 商品去背景 → Step 2: 替换到人物图 → Step 3: 生成商品数字人视频…');

    try {
      const r = await api('/api/dh/products/fuse-image', {
        method: 'POST',
        body: { image_url: pdh.personUrl, product: { image_url: pdh.productUrl, name: productName } },
      });
      if (!r.success) throw new Error(r.error || '融合失败');
      const savedAvatar = await pdhSaveToAvatars(r.imageUrl, productName, {
        imageUrl: pdh.productUrl,
        image_name: productName,
        name: productName,
        topview_image_id: r.topview?.imageId || '',
        topview_task_id: r.topview?.taskId || '',
        topview: r.topview || null,
      });
      const ad = await api('/api/dh/product-ads/generate', {
        method: 'POST',
        body: {
          avatar_id: savedAvatar?.id,
          product: { image_url: pdh.productUrl, name: productName, image_name: productName },
          topic: `${productName} 商品数字人口播介绍`,
          duration_sec: 18,
          voice_id: voiceId,
          voice_provider: pdhSelectedVoice()?.providerId || '',
          subtitle: getDhSubtitlePayload(true),
        },
      });
      if (ad.success && ad.taskId) {
        const taskMeta = {
          taskId: ad.taskId,
          taskType: 'product_ad',
          avatarName: `${productName} · 商品数字人`,
          startedAt: Date.now(),
          status: 'submitted',
          stage: 'submitted',
          snapshot: null,
          previewUrl: pdh.productUrl,
          textPreview: `${productName} 商品数字人口播介绍`,
          createDetail: {
            title: `${productName} 商品数字人`,
            durationSec: 18,
            text: `${productName} 商品数字人口播介绍`,
            productName,
            backgroundUrl: pdh.productUrl,
            avatarName: productName,
            voiceId,
            submittedAt: new Date().toISOString(),
          },
        };
        syncRunningTask(ad.taskId, taskMeta);
        pollVideoTask(ad.taskId);
        state.activeTaskType = 'product_ad';
      }

      pdhCardTag(cardId, '完成', 'pdh2-result-tag-green');
      pdhCardBody(cardId, `
        <div style="position:relative;border-radius:8px;overflow:hidden">
          <img src="${escapeHtml(r.imageUrl)}" style="width:100%;aspect-ratio:3/4;object-fit:cover;display:block">
          <div style="position:absolute;bottom:0;left:0;right:0;padding:8px;background:linear-gradient(transparent,rgba(0,0,0,.82))">
            <button class="pdh2-save-btn" data-pdh-save="${escapeHtml(r.imageUrl)}" data-pdh-name="${escapeHtml(productName)}" disabled
              style="width:100%;padding:7px 0;font-size:12px;font-weight:700;background:linear-gradient(135deg,#21FFF3,#FFF600);color:#0D0E12;border:none;border-radius:5px;cursor:pointer">
              已保存并提交广告任务
            </button>
          </div>
        </div>
      `);
      renderTaskCenter();
      renderRunningTasksBanner();
      switchTab('tasks');
      toast('商品数字人已保存，并提交到任务中心', 'success');
    } catch (e) {
      pdhCardTag(cardId, '失败', 'pdh2-result-tag-yellow');
      pdhCardBody(cardId, `<span style="color:var(--dh-danger);font-size:12px">${escapeHtml(e.message)}</span>`);
      toast(e.message, 'error');
    } finally {
      pdh.running = false;
      if (btn) { btn.disabled = false; btn.textContent = '生成广告形象'; }
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
    pdhLoadMyAv();
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
        toast('已保存 → 去「我的形象」→「商品数字人」生成动态形象', 'success');
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
    pdhBindEvents();
    const plazaCat = $('#dhPlazaCategory');
    if (plazaCat) plazaCat.addEventListener('change', e => { state.plaza.category = e.target.value; renderPlaza(); });
    const plazaGen = $('#dhPlazaGender');
    if (plazaGen) plazaGen.addEventListener('change', e => { state.plaza.gender = e.target.value; renderPlaza(); });
    const spaceBgFile = $('#dhSpaceBgFile');
    if (spaceBgFile) spaceBgFile.addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) uploadSpaceBackground(f);
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
    const spaceSubtitle = $('#dhSpaceSubtitleOn');
    if (spaceSubtitle) spaceSubtitle.addEventListener('change', e => { state.space.subtitle = !!e.target.checked; state.s3.subtitle.show = !!e.target.checked; });
    const spaceScenePrompt = $('#dhSpaceScenePrompt');
    if (spaceScenePrompt) spaceScenePrompt.addEventListener('input', e => { state.space.scenePrompt = e.target.value || ''; });
    const spaceCameraPrompt = $('#dhSpaceCameraPrompt');
    if (spaceCameraPrompt) spaceCameraPrompt.addEventListener('input', e => { state.space.cameraPrompt = e.target.value || ''; });
    const spaceDuration = $('#dhSpaceDuration');
    if (spaceDuration) spaceDuration.addEventListener('change', e => { state.space.durationSec = Number(e.target.value) || 30; state.space.segments = []; });
    const spaceText = $('#dhSpaceText');
    if (spaceText) spaceText.addEventListener('input', () => { state.space.segments = []; autoBuildSpacePromptFromManualText(); });
    switchTab(getInitialTab());
    await loadMyAvatars();
    renderProductMaterial();
    restoreVideoTasks();
    loadEngineStatus();
  }

  init();
})();
