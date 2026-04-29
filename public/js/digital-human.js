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
      mode: 'generate', gender: 'female', style: 'idol_warm', ratio: '9:16',
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
      script: '', segments: [], voiceId: null, taskId: null, pollTimer: null, motionEditIdx: -1,
      subtitle: { show: false, fontName: '抖音美好体', fontSize: 72, color: '#FFFFFF', outlineColor: '#000000' },
      // 多任务并行：taskId → { avatarName, startedAt, pollTimer, snapshot }
      runningTasks: new Map(),
    },
    // 音色列表（从 /api/avatar/voice-list 拉）
    voices: [],
    voicesLoaded: false,
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
  };

  // 动作预设（用户可选 / 自定义）
  const ACTION_PRESETS = [
    { id: 'natural',     name: '自然交谈',   en: 'natural speaking, subtle head movements, look at camera' },
    { id: 'greet',       name: '打招呼',     en: 'waving hello, friendly greeting gesture' },
    { id: 'heart',       name: '比心',       en: 'making a heart sign with both hands, warm smile' },
    { id: 'like',        name: '点赞',       en: 'giving a thumbs up, encouraging smile' },
    { id: 'point_down',  name: '点击下方',   en: 'pointing downward with index finger, looking at camera' },
    { id: 'number1',     name: '比数字1',    en: 'holding up one finger, counting gesture' },
    { id: 'hold_item',   name: '展示产品',   en: 'holding up a product to camera, presenting' },
    { id: 'open_palms',  name: '开掌说明',   en: 'both hands open palms up explaining, welcoming posture' },
    { id: 'count_finger',name: '数手指',     en: 'counting on fingers, explaining points one by one' },
    { id: 'thoughtful',  name: '沉思',       en: 'thinking expression, hand near chin' },
    { id: 'excited',     name: '兴奋',       en: 'excited gesture, eyes wide, energetic smile' },
    { id: 'nod',         name: '点头认同',   en: 'nodding in agreement, confident expression' },
  ];

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
  function switchTab(tab) {
    if (!tab) return;
    state.activeTab = tab;
    $$('.dh-nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
    $$('.dh-tab-pane').forEach(el => el.classList.toggle('active', el.dataset.pane === tab));
    $('#dhCrumb').textContent = {
      step1: '① 生成形象',
      step2: '② 我的形象',
      step3: '③ 生成数字人',
      dual:  '👥 双人对话',
      works: '🎬 作品库',
    }[tab] || '数字人';

    if (tab === 'step2') loadMyAvatars();
    if (tab === 'step3') { renderSelectedAvatar(); loadVoicesIfNeeded(); renderRunningTasksBanner(); }
    if (tab === 'dual')  { renderDualAvatars(); }
    if (tab === 'works') loadWorks();
    if (tab === 'voice-clone') { bindVoiceCloneUpload(); loadVoiceClones(); /* aliyun token 卡片已下线，统一到后台 AI 配置 */ }
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
    state.s1.sampleVideoUrl = null;
    state.s1.sampleTaskId = null;
    if (state.s1.samplePollTimer) { clearInterval(state.s1.samplePollTimer); state.s1.samplePollTimer = null; }
    $('#dhS1SampleVideo').style.display = 'none';
    $('#dhS1SampleVideo').removeAttribute('src');
    $('#dhS1PreviewImg').style.display = 'block';
    $('#dhS1SampleArea').style.display = 'flex';
    $('#dhS1SampleRunning').style.display = 'none';
    $('#dhS1SampleDone').style.display = 'none';
    $('#dhS1Save').disabled = false;  // 不强制要求先做动态测试，图生成完就能直接保存
    $('#dhS1Save').title = '保存到我的形象';
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
  }

  // ══════════════ Step 1 · 文生图 ══════════════
  async function generateImage() {
    const description = $('#dhS1Desc').value.trim();
    $('#dhS1Loading').style.display = 'block';
    $('#dhS1Preview').style.display = 'none';
    $('#dhS1GenBtn').disabled = true;
    _hidePlaceholder();

    try {
      const r = await api('/api/dh/images/generate', {
        method: 'POST',
        body: {
          style: state.s1.style,
          gender: state.s1.gender,
          description,
          aspectRatio: state.s1.ratio,
        },
      });
      if (!r.success) throw new Error(r.error || '生成失败');
      resetS1Preview();
      state.s1.previewUrl = r.imageUrl;
      state.s1.fromUpload = false;
      $('#dhS1PreviewImg').src = r.imageUrl;
      $('#dhS1Preview').style.display = 'block';
      _hidePlaceholder();
      // 给个默认名
      if (!$('#dhS1Name').value) {
        const label = { female: '小姐姐', male: '小哥哥', '': '形象' }[state.s1.gender] || '形象';
        $('#dhS1Name').value = `${{ idol_warm: '暖调', idol_cool: '冷调', documentary: '写实', office: '职场', beach: '海边', studio_plain: '影棚', live_studio: '直播间', business_formal: '商务', tech_lab: '科技', cafe_cozy: '咖啡馆', fitness_energy: '运动', anime_illus: '动漫' }[state.s1.style] || ''}${label}`;
      }
      toast('✨ 图生成完成 · 下面点"生成动态预览"验证驱动效果', 'success');
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
    if (file.size > 20 * 1024 * 1024) return toast('图片超过 20MB', 'error');
    const fd = new FormData();
    fd.append('image', file);
    toast('上传中…');
    try {
      const r = await api('/api/dh/images/upload', { method: 'POST', body: fd });
      if (!r.success) throw new Error(r.error || '上传失败');
      resetS1Preview();
      state.s1.previewUrl = r.imageUrl;
      state.s1.fromUpload = true;  // 标记是上传，别污染 description
      $('#dhS1PreviewImg').src = r.imageUrl;
      $('#dhS1Preview').style.display = 'block';
      _hidePlaceholder();
      if (!$('#dhS1Name').value) $('#dhS1Name').value = '我的形象_' + new Date().toLocaleDateString('zh-CN');
      // 上传的形象不带 AI 描述（那是用户自己的图）
      $('#dhS1Desc').value = '';
      toast('📤 上传完成 · 请手动确认下方性别（如不准）', 'success');
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
    $('#dhS1SampleStage').textContent = '提交中…';
    $('#dhS1SampleElapsed').textContent = '0s';
    try {
      const r = await api('/api/dh/samples/generate', {
        method: 'POST',
        body: { image_url: state.s1.previewUrl },
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
    const MAX = 5 * 60 * 1000;
    const stageMap = {
      prepare_image: '🖼️ 准备照片中',
      prepare_audio: '🎤 准备配音中',
      detecting: '🔍 识别人脸中',
      submitting: '⚡ 提交 AI 渲染',
      running: '🎨 AI 正在让你的形象动起来',
      polling: '🎨 AI 正在让你的形象动起来',
      pending: '⏳ 排队中',
      queued: '⏳ 排队中',
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
        const friendlyStage = stageMap[t.stage] || stageMap[t.status] || '🎨 AI 正在生成…';
        $('#dhS1SampleStage').textContent = friendlyStage + (elapsed > 60 ? `（${Math.floor(elapsed/60)} 分钟，正常 1-3 分钟）` : '');

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
          toast('样片失败：' + (t.error || ''), 'error');
          return;
        }
        if (Date.now() - start > MAX) {
          clearInterval(state.s1.samplePollTimer);
          toast('样片渲染超时', 'error');
        }
      } catch (err) { console.warn('sample poll', err); }
    };
    tick();
    state.s1.samplePollTimer = setInterval(tick, 6000);
  }

  // skipSample 废弃 — 强制要求生成样片再保存

  // ══════════════ Step 1 · 保存到我的形象 ══════════════
  async function saveAvatar() {
    const name = $('#dhS1Name').value.trim();
    if (!name) return toast('请输入形象名称', 'error');
    if (!state.s1.previewUrl) return toast('请先生成或上传图片', 'error');

    try {
      const r = await api('/api/dh/my-avatars', {
        method: 'POST',
        body: {
          name,
          imageUrl: state.s1.previewUrl,
          sampleVideoUrl: state.s1.sampleVideoUrl || null,
          gender: state.s1.gender,
          style: state.s1.style,
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
      state.selectedAvatar = r.data;
      switchTab('step2');
    } catch (err) {
      toast('保存失败：' + err.message, 'error');
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
    } catch (err) {
      console.warn(err);
    }
  }

  function updateAvCountBadge() {
    const n = state.myAvatars.length;
    const b = $('#dhMyAvCount');
    if (b) { b.style.display = n ? 'inline-block' : 'none'; b.textContent = n; }
    const videos = state.myAvatars.filter(a => a.sample_video_url);
    const images = state.myAvatars.filter(a => !a.sample_video_url);
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
    let actionRow;
    if (video) {
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
    const videos = state.myAvatars.filter(a => a.sample_video_url);
    const images = state.myAvatars.filter(a => !a.sample_video_url); // 含 generating

    // Tab：'image' | 'video'，默认 video（视频素材可直接驱动说话）
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
                     + mkTab('video', '🎬 视频素材', videos.length);
    }

    // 渲染当前 Tab
    const list = dhTabbed === 'video' ? videos : images;
    if (!list.length) {
      const empties = {
        image: { icon: '📸', text: '还没有图片形象', sub: '去 Step1 生成或上传一张照片' },
        video: { icon: '🎬', text: '还没有视频素材', sub: '在「📸 图片素材」点「🎬 生成视频素材」' },
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
    state.selectedAvatar = a;
    renderMyAvatars();
    toast(`已选中「${a.name}」，去第三步写稿出片`, 'success');
    setTimeout(() => switchTab('step3'), 500);
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
    if (video) badges.push('<span class="av-badge dynamic">🎬 动态</span>');
    if (a.gender === 'female') badges.push('<span class="av-badge">♀ 女</span>');
    else if (a.gender === 'male') badges.push('<span class="av-badge">♂ 男</span>');
    if (a.style) {
      const styleMap = { idol_warm: '偶像暖调', idol_cool: '偶像冷调', documentary: '写实', office: '职场', beach: '海边', studio_plain: '影棚' };
      badges.push(`<span class="av-badge">${styleMap[a.style] || a.style}</span>`);
    }
    if (a.source) badges.push(`<span class="av-badge source">${a.source === 'upload' ? '📤 上传' : '🎨 AI 生成'}</span>`);

    const desc = a.description ? `<div class="av-desc">${escapeHtml(a.description)}</div>` : '';
    const created = a.created_at ? new Date(a.created_at).toLocaleString('zh-CN', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    const meta = created ? `<div class="av-meta">🕐 ${created}</div>` : '';

    host.innerHTML = `${media}
      <div class="av-name">${escapeHtml(a.name)}</div>
      <div class="av-badges">${badges.join('')}</div>
      ${desc}
      ${meta}
      <button class="av-switch-btn" data-tab-go="step2">↻ 切换到其他形象</button>`;
  }

  // AI 写稿：点按钮先开弹窗，让用户写内容/要点；在弹窗里提交
  function openWriteModal() {
    const m = document.getElementById('dhWriteModal');
    if (!m) { toast('AI 写稿弹窗未就绪，请刷新页面', 'error'); return; }
    const input = document.getElementById('dhWriteInput');
    if (input) input.value = '';
    // 双保险：同时 add show class + 直接清掉 inline display:none
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

  async function submitWriteScript() {
    const topic = $('#dhWriteInput').value.trim();
    if (!topic) return toast('请输入要写的内容/主题', 'error');
    const duration_sec = parseInt($('#dhWriteDuration').value) || 30;
    const style = $('#dhWriteStyle').value;
    const btn = $('#dhWriteSubmit');
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = '✍️ 写稿中…';
    try {
      const r = await api('/api/dh/scripts/write', {
        method: 'POST',
        body: { topic, duration_sec, style },
      });
      if (!r.success) throw new Error(r.error || '写稿失败');
      $('#dhS3Text').value = r.text;
      updateS3Meta();
      closeWriteModal();
      toast(`✨ 写好了 ${r.char_count} 字 / 约 ${r.duration_sec} 秒 · 自动拆分中…`, 'success');
      await segmentScript();
    } catch (err) {
      toast('写稿失败：' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  async function segmentScript() {
    const text = $('#dhS3Text').value.trim();
    if (text.length < 10) return toast('台词太短', 'error');
    $('#dhS3SegmentBtn').disabled = true;
    try {
      const r = await api('/api/dh/scripts/segment', {
        method: 'POST',
        body: { text },
      });
      if (!r.success) throw new Error(r.error || '拆分失败');
      state.s3.segments = r.segments;
      renderTimeline(r.segments);
      toast(`🧩 已拆成 ${r.segments.length} 段，总时长 ≈ ${r.total_duration}s`, 'success');
    } catch (err) {
      toast('拆分失败：' + err.message, 'error');
    } finally {
      $('#dhS3SegmentBtn').disabled = false;
    }
  }

  function renderTimeline(segments) {
    const host = $('#dhS3TimelineBody');
    if (!host) return;
    host.innerHTML = segments.map((s, i) => `<div class="dh-tl-row" data-seg-idx="${i}">
      <div class="dh-tl-time">${fmtTime(s.start)}-${fmtTime(s.end)}</div>
      <div class="dh-tl-text">${escapeHtml(s.text)}</div>
      <div class="dh-tl-motion" title="${escapeHtml(s.motion)}">${escapeHtml(s.expression)} · ${escapeHtml(s.motion)}</div>
      <button class="dh-tl-edit" data-edit-seg="${i}" title="编辑表情/动作">✎</button>
    </div>`).join('');
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
    pop.innerHTML = `
      <div class="dh-motion-popover-title">第 ${idx + 1} 段 · ${fmtTime(seg.start)}-${fmtTime(seg.end)} · "${escapeHtml(seg.text.slice(0, 30))}..."</div>
      <div class="dh-motion-popover-title" style="margin-top:8px">常用动作</div>
      <div class="dh-motion-actions">
        ${ACTION_PRESETS.map(a => `<button class="dh-motion-action ${a.id === activeId ? 'active' : ''}" data-motion-preset="${a.id}">${a.name}</button>`).join('')}
      </div>
      <div class="dh-motion-popover-title">自定义（英文 prompt）</div>
      <input type="text" class="dh-input dh-motion-input" id="dhMotionCustom" placeholder="e.g. pointing at screen enthusiastically" value="${escapeHtml(seg.motion)}">
      <div class="dh-motion-popover-title" style="margin-top:10px">表情</div>
      <div class="dh-motion-actions">
        ${['natural','smile','serious','excited','calm'].map(ex => `<button class="dh-motion-action ${ex === seg.expression ? 'active' : ''}" data-expression="${ex}">${ex}</button>`).join('')}
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
      pop.style.top = Math.min(window.innerHeight - 420, r.bottom + 8) + 'px';
      pop.style.left = Math.max(8, Math.min(window.innerWidth - 380, r.right - 360)) + 'px';
    }
    pop.classList.add('show');
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
    const exprBtn = pop.querySelector('[data-expression].active');
    const motionBtn = pop.querySelector('[data-motion-preset].active');
    const seg = state.s3.segments[idx];
    if (!seg) return;
    if (motionBtn) {
      const preset = ACTION_PRESETS.find(a => a.id === motionBtn.dataset.motionPreset);
      if (preset) seg.motion = preset.en;
    }
    if (custom) seg.motion = custom;
    if (exprBtn) seg.expression = exprBtn.dataset.expression;
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
    toast('生成试听片段…');
    try {
      const r = await fetch('/api/avatar/preview-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
        body: JSON.stringify({ voiceId, text: '你好，这是音色试听效果。' }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
    } catch (err) {
      toast('试听失败：' + err.message, 'error');
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

    // 进度 UI
    const box = $('#dhRenderBox');
    box.innerHTML = `<div class="dh-render-stage">
      <div class="dh-render-stage-name">📤 提交中</div>
      <div class="dh-render-stage-sub">让 Jimeng Omni 开始驱动你的形象说话…</div>
    </div>
    <div class="dh-gen-spinner" style="align-self:center"></div>`;

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
        },
      });
      if (!r.success) throw new Error(r.error || '提交失败');
      state.s3.taskId = r.taskId;
      // 加入多任务表（切换 tab 不会停止）
      state.s3.runningTasks.set(r.taskId, {
        avatarName: state.selectedAvatar.name,
        startedAt: Date.now(),
        snapshot: null,
      });
      renderRunningTasksBanner();
      pollVideoTask(r.taskId);
      toast('🎬 已提交，可切到其他面板，生成会在后台继续', 'success');
    } catch (err) {
      box.innerHTML = `<div class="dh-render-stage">
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
        const r = await api(`/api/avatar/jimeng-omni/tasks/${taskId}`);
        if (!r?.success) return;
        const t = r.task;
        meta.snapshot = t;
        renderRunningTasksBanner();
        // 仅当当前查看的就是这个任务时，更新主 render box
        const box = (state.s3.taskId === taskId) ? $('#dhRenderBox') : null;
        const stageMap = {
          prepare_image: { name: '🖼️ 准备形象', sub: '上传/归一化图片' },
          prepare_audio: { name: '🎤 准备语音', sub: 'TTS 准备中' },
          detecting:     { name: '🔍 主体检测', sub: '抠出人物' },
          submitting:    { name: '⚡ 提交到 Jimeng', sub: '排队中' },
          submitted:     { name: '⏳ 等待中', sub: '已提交，等服务端调度' },
          polling:       { name: '⏳ 等待中', sub: '渲染中，请稍候' },
          running:       { name: '🎨 Jimeng 渲染中', sub: `CV 状态 ${t.cv_status || '...'}` },
          post_effects:  { name: '✨ 特效合成', sub: '叠花字/贴图' },
          done:          { name: '✅ 完成', sub: '' },
        };
        const elapsed = Math.round((Date.now() - start) / 1000);
        const stg = stageMap[t.stage] || { name: '⏳ 等待中', sub: '' };

        if (t.status === 'done' && t.video_url) {
          clearInterval(meta.pollTimer);
          state.s3.runningTasks.delete(taskId);
          renderRunningTasksBanner();
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
          <video class="dh-render-video" src="${t.video_url}" controls playsinline></video>
          ${subtitleNote}
          <div style="display:flex;gap:6px;margin-top:8px">
            <a class="dh-btn dh-btn-ghost dh-btn-sm" href="${t.video_url}" download>⬇ 下载</a>
            <button class="dh-btn dh-btn-ghost dh-btn-sm" data-tab-go="works">📚 作品库</button>
          </div>`;
          toast(`🎉 ${meta.avatarName || ''} 渲染完成`, 'success');
          return;
        }
        if (t.status === 'error') {
          clearInterval(meta.pollTimer);
          state.s3.runningTasks.delete(taskId);
          renderRunningTasksBanner();
          if (box) box.innerHTML = `<div class="dh-render-stage">
            <div class="dh-render-stage-name" style="color:var(--dh-error)">❌ 渲染失败</div>
            <div class="dh-render-stage-sub">${escapeHtml(t.error || '')}</div>
          </div>`;
          toast(`渲染失败：${meta.avatarName || ''} · ${t.error || ''}`, 'error');
          return;
        }

        // 慢提示：>5min 时建议改用更短台词或换引擎
        let slowHint = '';
        if (elapsed > 300) {
          slowHint = `<div style="margin-top:10px;padding:10px 12px;background:rgba(255,246,0,0.06);border:1px solid rgba(255,246,0,0.3);border-radius:8px;font-size:11px;color:var(--dh-text-soft);line-height:1.7">
            ⏱️ 当前引擎：<b>火山即梦 Omni v1.5</b> · 每秒视频约渲染 8-15 秒<br>
            🚀 提速建议：① 缩短台词（&lt;100 字）；② 换<b>飞影免费通道</b>（首页"零成本一键生成"）；③ 用预设视频素材
          </div>`;
        }
        if (box) box.innerHTML = `<div class="dh-render-stage">
          <div class="dh-render-stage-name">${stg.name}</div>
          <div class="dh-render-stage-sub">${stg.sub} · 已用 ${elapsed}s · 引擎：jimeng-omni-v15</div>
        </div>
        <div class="dh-gen-spinner" style="align-self:center;margin:10px auto"></div>${slowHint}`;

        if (Date.now() - start > MAX) {
          clearInterval(meta.pollTimer);
          state.s3.runningTasks.delete(taskId);
          renderRunningTasksBanner();
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
    const pane = document.querySelector('.dh-tab-pane[data-pane="step3"]');
    if (!pane) return;
    let banner = document.getElementById('dhS3RunningBanner');
    const list = Array.from(state.s3.runningTasks.entries());
    if (!list.length) {
      if (banner) banner.remove();
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'dhS3RunningBanner';
      banner.style.cssText = 'background:linear-gradient(135deg,rgba(33,255,243,0.10),rgba(255,246,0,0.06));border:1px solid var(--dh-primary,#21FFF3);border-radius:12px;padding:12px 14px;margin-bottom:14px;display:flex;flex-direction:column;gap:8px';
      // 插到 wizard-head 之后
      const head = pane.querySelector('.dh-wizard-head');
      if (head?.parentNode) head.parentNode.insertBefore(banner, head.nextSibling);
      else pane.insertBefore(banner, pane.firstChild);
    }
    const stageName = (s) => ({
      prepare_image:'🖼️ 准备形象', prepare_audio:'🎤 准备语音', detecting:'🔍 主体检测',
      submitting:'⚡ 提交渲染', submitted:'⏳ 等待中', polling:'⏳ 等待中',
      running:'🎨 渲染中', post_effects:'✨ 特效合成', done:'✅ 完成',
    }[s] || '⏳ 等待中');
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dh-primary,#21FFF3)">
        <span class="dh-gen-spinner" style="width:14px;height:14px;border-width:2px;margin:0"></span>
        ⏳ 后台生成中（${list.length} 个任务，可继续操作其他面板）
      </div>
      ${list.map(([id, m]) => {
        const elapsed = Math.round((Date.now() - (m.startedAt || Date.now())) / 1000);
        const stg = stageName(m.snapshot?.stage);
        const isCurrent = state.s3.taskId === id;
        return `<div style="display:flex;align-items:center;gap:10px;padding:6px 10px;background:var(--dh-bg-soft,#141519);border-radius:8px;font-size:12px;${isCurrent ? 'border:1px solid var(--dh-primary,#21FFF3)' : ''}">
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🎬 ${escapeHtml(m.avatarName || '未命名')}</span>
          <span style="color:var(--dh-text-muted)">${stg}</span>
          <span style="color:var(--dh-text-muted);font-family:monospace">${elapsed}s</span>
          <button onclick="window._dhFocusRunning('${id}')" style="background:transparent;border:1px solid var(--dh-border);color:var(--dh-text);padding:2px 8px;border-radius:6px;cursor:pointer;font-size:11px">查看</button>
        </div>`;
      }).join('')}`;
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
      box.innerHTML = `<div class="dh-render-stage">
        <div class="dh-render-stage-name">${stageName(t.stage)} · ${escapeHtml(meta.avatarName || '')}</div>
        <div class="dh-render-stage-sub">已用 ${elapsed}s</div>
      </div>
      <div class="dh-gen-spinner" style="align-self:center;margin:10px auto"></div>`;
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

  async function editVoiceClone(id) {
    const v = state.voiceClone.list.find(x => x.id === id);
    if (!v) return toast('找不到该声音', 'error');
    const newName = prompt('编辑声音名称：', v.name || '');
    if (newName === null) return;
    const trimmed = (newName || '').trim().slice(0, 30);
    if (!trimmed) return toast('名称不能为空', 'error');
    const newGender = prompt('性别（输入 female 或 male）：', v.gender || 'female');
    if (newGender === null) return;
    const g = (newGender || '').trim().toLowerCase();
    if (!['female', 'male'].includes(g)) return toast('性别必须是 female 或 male', 'error');
    try {
      const r = await fetch('/api/workbench/voices/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
        body: JSON.stringify({ name: trimmed, gender: g }),
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
    const tabGo = closest('[data-tab-go]'); if (tabGo) { switchTab(tabGo.dataset.tabGo); return; }

    // Step 1
    const modeBtn = closest('.dh-mode-btn'); if (modeBtn) { setMode(modeBtn.dataset.mode); return; }
    const gChip = closest('[data-gender]'); if (gChip) { selectGender(gChip.dataset.gender); return; }
    const sCard = closest('[data-style]'); if (sCard) { selectStyle(sCard.dataset.style); return; }
    const rChip = closest('[data-ratio]'); if (rChip) { selectRatio(rChip.dataset.ratio); return; }
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
    const writePreset = closest('[data-write-preset]');
    if (writePreset) { $('#dhWriteInput').value = writePreset.dataset.writePreset; return; }
    if (closest('#dhWriteSubmit')) { submitWriteScript(); return; }
    if (closest('#dhS1Save')) { saveAvatar(); return; }

    // 字幕
    if (closest('#dhS3SubtitleStyleBtn')) { openSubtitleModal(); return; }
    if (closest('[data-subtitle-close]')) { closeSubtitleModal(); return; }
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
    if (closest('#dhMotionSave')) { saveMotion(); return; }
    if (closest('#dhMotionCancel')) { closeMotionEditor(); return; }

    // 音色
    const voiceCard = closest('[data-voice-id]');
    if (voiceCard && !target.closest('[data-voice-preview]')) { selectVoice(voiceCard.dataset.voiceId); return; }
    const voicePrevBtn = closest('[data-voice-preview]');
    if (voicePrevBtn) { e.stopPropagation(); previewVoice(voicePrevBtn.dataset.voicePreview); return; }

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

  function refreshSubtitlePreview() {
    const el = document.getElementById('dhSubPreviewText');
    if (!el) return;
    const fontName = ($('#dhSubFont')?.value || '抖音美好体').trim();
    const sizeRaw = parseInt($('#dhSubSize')?.value) || 72;
    // 预览框是缩小版（aspect-ratio 16/9），按原画 1080 高度等比缩放字号
    const previewSize = Math.max(14, Math.round(sizeRaw * 0.5));
    const color = $('#dhSubColor')?.value || '#FFFFFF';
    const outline = $('#dhSubOutline')?.value || '#000000';
    el.style.fontFamily = `"${fontName}", "Microsoft YaHei", "PingFang SC", sans-serif`;
    el.style.fontSize = previewSize + 'px';
    el.style.color = color;
    // 用 text-shadow 模拟描边效果（4 个方向各 1px）
    el.style.textShadow = `-1.5px -1.5px 0 ${outline}, 1.5px -1.5px 0 ${outline}, -1.5px 1.5px 0 ${outline}, 1.5px 1.5px 0 ${outline}, 0 0 6px rgba(0,0,0,0.5)`;
  }

  function openSubtitleModal() {
    const sub = state.s3.subtitle;
    $('#dhSubFont').value = sub.fontName;
    $('#dhSubSize').value = sub.fontSize;
    $('#dhSubColor').value = sub.color;
    $('#dhSubOutline').value = sub.outlineColor;
    $('#dhSubtitleModal').style.display = 'flex';
    refreshSubtitlePreview();
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
    state.s3.subtitle = {
      show: $('#dhS3SubtitleOn').checked,
      fontName: $('#dhSubFont').value,
      fontSize: parseInt($('#dhSubSize').value) || 72,
      color: $('#dhSubColor').value,
      outlineColor: $('#dhSubOutline').value,
    };
    closeSubtitleModal();
    toast('字幕样式已保存', 'success');
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
      toast(e.target.checked ? '✅ 字幕已开' : '字幕已关', '');
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

  // ══════════════ Init ══════════════
  async function init() {
    if (!state.token) { location.href = '/?login=1'; return; }
    bindUpload();
    switchTab('step1');
    await loadMyAvatars();
    loadEngineStatus();
  }

  init();
})();
