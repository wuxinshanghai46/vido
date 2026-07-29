(() => {
  const VERSION = '20260730-director-workspace-v1';
  const cache = new Map();
  const inFlight = new Map();
  let observer = null;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));

  function ensureStyle() {
    if (document.querySelector('link[data-nsa-director-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/css/new-story-ad-director-workspace.css?v=${VERSION}`;
    link.dataset.nsaDirectorStyle = '1';
    document.head.appendChild(link);
  }

  function taskId() {
    const stateId = window.__newStoryAdLegacyUI?.state?.taskId;
    if (stateId) return String(stateId);
    try {
      return new URLSearchParams(location.search || '').get('nsa_task_id') || '';
    } catch {
      return '';
    }
  }

  function sectionHost(id) {
    return document.getElementById(id);
  }

  function empty(message) {
    return `<div class="dh-nsa-director-empty">${escapeHtml(message)}</div>`;
  }

  function tags(rows = [], kind = '') {
    const values = Array.isArray(rows) ? rows.filter(Boolean) : [];
    if (!values.length) return '';
    return `<div class="dh-nsa-director-tags ${kind}">${values.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>`;
  }

  function imageStrip(rows = [], label = '参考资产') {
    const items = (Array.isArray(rows) ? rows : []).filter(item => item?.image_url);
    if (!items.length) return '';
    return `<div class="dh-nsa-director-images" aria-label="${escapeHtml(label)}">${items.map(item => `
      <figure>
        <img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.label || label)}" loading="lazy" decoding="async">
        <figcaption>${escapeHtml(item.label || label)}</figcaption>
      </figure>`).join('')}</div>`;
  }

  async function readWorkspace(sections, options = {}) {
    const id = taskId();
    if (!id) return null;
    const offset = Math.max(0, Number(options.shotOffset || 0) || 0);
    const limit = Math.max(1, Math.min(20, Number(options.shotLimit || 12) || 12));
    const key = `${id}|${sections}|${offset}|${limit}`;
    const cached = cache.get(key);
    if (!options.force && cached && Date.now() - cached.at < 5000) return cached.data;
    if (inFlight.has(key)) return inFlight.get(key);
    const query = new URLSearchParams({
      sections,
      shot_offset: String(offset),
      shot_limit: String(limit),
      candidate_limit: '3',
    });
    const promise = window.NewStoryAdApi.request(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/director-workspace?${query}`)
      .then(data => {
        cache.set(key, { at: Date.now(), data });
        return data;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  }

  function renderPeople(people = {}) {
    const characters = Array.isArray(people.characters) ? people.characters : [];
    const cards = characters.map(character => `
      <article class="dh-nsa-director-card person">
        ${character.image_url ? `<img class="dh-nsa-director-cover" src="${escapeHtml(character.image_url)}" alt="${escapeHtml(character.name)}" loading="lazy" decoding="async">` : ''}
        <div>
          <small>${escapeHtml(character.role || '剧情人物')}</small>
          <h4>${escapeHtml(character.name)}</h4>
          ${character.profile ? `<p>${escapeHtml(character.profile)}</p>` : ''}
          ${character.wardrobe ? `<p><b>造型：</b>${escapeHtml(character.wardrobe)}</p>` : ''}
          ${character.story_function ? `<p><b>剧情职责：</b>${escapeHtml(character.story_function)}</p>` : ''}
        </div>
      </article>`).join('');
    const actions = (people.action_pack || []).map(action => `
      <article class="dh-nsa-director-action">
        ${action.image_url ? `<img src="${escapeHtml(action.image_url)}" alt="第 ${Number(action.shot_index) || 1} 镜动作" loading="lazy" decoding="async">` : ''}
        <div>
          <b>第 ${Number(action.shot_index) || 1} 镜 · ${escapeHtml(action.key_action || '剧情动作')}</b>
          <span>开始：${escapeHtml(action.start_pose || '待生成')}</span>
          <span>结束：${escapeHtml(action.end_pose || '待生成')}</span>
          ${action.hand_contact ? `<span>手部/接触：${escapeHtml(action.hand_contact)}</span>` : ''}
          ${action.expression_change ? `<span>表情变化：${escapeHtml(action.expression_change)}</span>` : ''}
        </div>
      </article>`).join('');
    return `
      <section class="dh-nsa-director-block">
        <div class="dh-nsa-director-title"><div><small>角色档案</small><h3>人物与剧情动作</h3></div><span>${characters.length} 人 · ${(people.action_pack || []).length} 组动作</span></div>
        <div class="dh-nsa-director-grid">${cards || empty('当前广告不需要人物，或人物档案尚未生成。')}</div>
        ${imageStrip(people.identity_views, '人物一致性参考')}
        ${actions ? `<div class="dh-nsa-director-actions">${actions}</div>` : '<p class="dh-nsa-director-note">生成故事板后，系统会只为剧情真正使用的动作建立“开始—关键动作—结束”动作包。</p>'}
      </section>`;
  }

  function renderSceneStates(states = []) {
    if (!states.length) return '<p class="dh-nsa-director-note">剧情生成后，这里会显示场景中物件、人物和光线的前后状态。</p>';
    return `<ol class="dh-nsa-scene-timeline">${states.map(state => `
      <li>
        <b>${escapeHtml(state.label || `第 ${state.shot_index || ''} 镜`)}</b>
        ${tags(state.state_before, 'before')}
        ${tags(state.visible_change, 'change')}
        ${tags(state.state_after, 'after')}
      </li>`).join('')}</ol>`;
  }

  function renderScenes(scenes = []) {
    return `
      <section class="dh-nsa-director-block">
        <div class="dh-nsa-director-title"><div><small>场景档案</small><h3>空间、互动与状态变化</h3></div><span>${scenes.length} 个场景</span></div>
        <div class="dh-nsa-director-scene-list">${scenes.map(scene => `
          <article class="dh-nsa-director-scene">
            <header><div><small>${escapeHtml(scene.story_purpose || '剧情承载空间')}</small><h4>${escapeHtml(scene.name)}</h4></div><span>${escapeHtml(scene.verification_status || '待生成')}</span></header>
            <p>${escapeHtml(scene.description || '待补充空间描述')}</p>
            ${scene.material_light ? `<p><b>材质与光线：</b>${escapeHtml(scene.material_light)}</p>` : ''}
            ${scene.interaction ? `<p><b>人物/产品如何使用：</b>${escapeHtml(scene.interaction)}</p>` : ''}
            ${tags((scene.zones || []).map(zone => zone.label || zone.purpose), 'zones')}
            ${imageStrip(scene.views, `${scene.name}参考视图`)}
            <div class="dh-nsa-director-state-head">剧情中的场景变化</div>
            ${renderSceneStates(scene.state_timeline || [])}
          </article>`).join('') || empty('尚未形成场景档案。')}</div>
      </section>`;
  }

  function renderAssets(data) {
    const host = sectionHost('dhNsaDirectorAssetsHost');
    if (!host) return;
    host.innerHTML = `${renderPeople(data?.people || {})}${renderScenes(data?.scenes || [])}`;
  }

  function renderStory(story = {}) {
    const arc = story.arc || {};
    const arcRows = [
      ['开场状态', arc.setup],
      ['触发事件', arc.trigger],
      ['行动与推进', arc.progression],
      ['结果证明', arc.result],
      ['品牌收束', arc.closure],
    ].filter(([, value]) => value);
    return `
      <section class="dh-nsa-director-block">
        <div class="dh-nsa-director-title"><div><small>剧情蓝图</small><h3>${escapeHtml(story.title || '等待生成剧情')}</h3></div><span>${(story.beats || []).length} 个剧情节点</span></div>
        ${story.logline ? `<p class="dh-nsa-director-logline">${escapeHtml(story.logline)}</p>` : ''}
        <div class="dh-nsa-director-arc">${arcRows.map(([label, value]) => `<article><b>${label}</b><span>${escapeHtml(value)}</span></article>`).join('') || empty('生成剧情后显示完整因果链。')}</div>
        <ol class="dh-nsa-director-beats">${(story.beats || []).map(beat => `
          <li>
            <span>${Number(beat.index) || 1}</span>
            <div>
              <small>${escapeHtml(beat.narrative_function || '剧情节点')}</small>
              <h4>${escapeHtml(beat.title)}</h4>
              <p>${escapeHtml(beat.plot || beat.action || '')}</p>
              ${beat.action ? `<p><b>行动：</b>${escapeHtml(beat.action)}</p>` : ''}
              ${tags(beat.visible_evidence, 'evidence')}
              ${beat.spoken_line ? `<blockquote>${escapeHtml(beat.spoken_line)}</blockquote>` : ''}
            </div>
          </li>`).join('')}</ol>
      </section>`;
  }

  function shotCard(shot = {}) {
    const preview = shot.keyframe?.image_url;
    const candidateCount = (shot.keyframe?.candidates || []).length + (shot.video?.candidates || []).length;
    return `
      <article class="dh-nsa-director-shot">
        <div class="dh-nsa-director-shot-preview">
          ${preview ? `<img src="${escapeHtml(preview)}" alt="第 ${Number(shot.index)} 镜" loading="lazy" decoding="async">` : '<span>等待关键帧</span>'}
          <i>${Number(shot.duration) || 0}s</i>
        </div>
        <div class="dh-nsa-director-shot-copy">
          <header><span>${Number(shot.index) || 1}</span><div><small>${escapeHtml(shot.narrative_function || '剧情镜头')}</small><h4>${escapeHtml(shot.title)}</h4></div></header>
          <p>${escapeHtml(shot.visual || '')}</p>
          ${shot.action ? `<p><b>人物/主体动作：</b>${escapeHtml(shot.action)}</p>` : ''}
          ${shot.expression ? `<p><b>情绪：</b>${escapeHtml(shot.expression)}</p>` : ''}
          ${shot.scene?.name ? `<p><b>场景：</b>${escapeHtml(shot.scene.name)}${shot.scene.zone ? ` · ${escapeHtml(shot.scene.zone)}` : ''}</p>` : ''}
          <div class="dh-nsa-director-state-row">
            <div><small>开始状态</small>${tags(shot.state_before, 'before')}</div>
            <div><small>本镜变化</small>${tags(shot.visible_change, 'change')}</div>
            <div><small>结束状态</small>${tags(shot.state_after, 'after')}</div>
          </div>
          ${tags(shot.evidence, 'evidence')}
          ${shot.voiceover ? `<blockquote>${escapeHtml(shot.voiceover)}</blockquote>` : ''}
          ${imageStrip(shot.lineage_inputs, '本镜使用的素材')}
          <footer><span>${candidateCount ? `${candidateCount} 个候选` : '尚未生成候选'}</span><span>${escapeHtml(shot.video?.status || shot.keyframe?.status || '')}</span></footer>
        </div>
      </article>`;
  }

  function continuityBanner(continuity = {}) {
    const pass = continuity.pass === true;
    const incomplete = Array.isArray(continuity.incomplete_shots) ? continuity.incomplete_shots : [];
    return `<div class="dh-nsa-director-continuity ${pass ? 'pass' : 'warning'}">
      <b>${pass ? '剧情、动作与场景状态连续' : '存在需要处理的连续性缺口'}</b>
      <span>${pass ? `已检查 ${Number(continuity.checked_boundaries) || 0} 个镜头交接。` : `${(continuity.issues || []).length} 个交接问题，${incomplete.length} 个镜头状态不完整。`}</span>
      ${tags((continuity.issues || []).slice(0, 6), 'warning')}
    </div>`;
  }

  function pager(pagination = {}, target = 'story') {
    const currentStart = Number(pagination.shot_offset || 0) + 1;
    const currentEnd = Math.min(Number(pagination.shot_total || 0), Number(pagination.shot_offset || 0) + Number(pagination.shot_limit || 0));
    if (!pagination.shot_total) return '';
    return `<div class="dh-nsa-director-pager">
      <span>第 ${currentStart}-${currentEnd} 镜，共 ${Number(pagination.shot_total)} 镜</span>
      <div>
        <button type="button" data-nsa-director-page="${Math.max(0, Number(pagination.shot_offset) - Number(pagination.shot_limit))}" data-nsa-director-target="${target}" ${Number(pagination.shot_offset) <= 0 ? 'disabled' : ''}>上一页</button>
        <button type="button" data-nsa-director-page="${Number(pagination.next_shot_offset || 0)}" data-nsa-director-target="${target}" ${pagination.has_more_shots ? '' : 'disabled'}>下一页</button>
      </div>
    </div>`;
  }

  function renderStoryShots(data) {
    const host = sectionHost('dhNsaDirectorStoryHost');
    if (!host) return;
    host.innerHTML = `${renderStory(data?.story || {})}${continuityBanner(data?.continuity || {})}
      <section class="dh-nsa-director-block">
        <div class="dh-nsa-director-title"><div><small>导演故事板</small><h3>观众会看到什么、发生什么</h3></div></div>
        <div class="dh-nsa-director-shot-list">${(data?.shots || []).map(shotCard).join('') || empty('确认剧情蓝图后生成导演故事板。')}</div>
        ${pager(data?.pagination, 'story')}
      </section>`;
  }

  function renderCandidates(data) {
    const host = sectionHost('dhNsaDirectorCandidatesHost');
    if (!host) return;
    const shots = (data?.candidates || []).map(item => ({
      index: item.shot_index,
      title: item.title,
      keyframe: item.keyframe,
      video: item.video,
      lineage_inputs: item.lineage_inputs,
      narrative_function: '候选素材与来源',
      visual: '确认本镜使用的人物、场景、产品和关键帧，再选择最终视频候选。',
      state_before: [],
      visible_change: [],
      state_after: [],
      evidence: [],
      scene: {},
    }));
    host.innerHTML = `${continuityBanner(data?.continuity || {})}
      <section class="dh-nsa-director-block">
        <div class="dh-nsa-director-title"><div><small>候选视频工作台</small><h3>逐镜素材来源与候选结果</h3></div><span>只重做不合格镜头</span></div>
        <div class="dh-nsa-director-shot-list">${shots.map(shotCard).join('') || empty('生成关键帧后显示逐镜素材来源，生成视频后显示候选结果。')}</div>
        ${pager(data?.pagination, 'candidates')}
      </section>`;
  }

  function setLoading(hostId, label) {
    const host = sectionHost(hostId);
    if (host) host.innerHTML = `<div class="dh-nsa-director-loading">${escapeHtml(label)}</div>`;
  }

  function setError(hostId, error) {
    const host = sectionHost(hostId);
    if (host) host.innerHTML = `<div class="dh-nsa-director-error"><b>导演工作台加载失败</b><span>${escapeHtml(error?.message || error || '请稍后重试')}</span><button type="button" data-nsa-director-refresh>重新读取</button></div>`;
  }

  async function loadStep(step = 0, options = {}) {
    const id = taskId();
    if (!id || !window.NewStoryAdApi?.request) return;
    ensureStyle();
    if (step === 2) {
      setLoading('dhNsaDirectorAssetsHost', '正在读取人物与场景档案…');
      try { renderAssets(await readWorkspace('people,scenes', options)); } catch (error) { setError('dhNsaDirectorAssetsHost', error); }
    }
    if (step === 4) {
      setLoading('dhNsaDirectorStoryHost', '正在读取剧情蓝图与导演故事板…');
      try { renderStoryShots(await readWorkspace('story,shots,continuity', options)); } catch (error) { setError('dhNsaDirectorStoryHost', error); }
    }
    if (step === 5) {
      setLoading('dhNsaDirectorCandidatesHost', '正在读取候选素材与来源…');
      try { renderCandidates(await readWorkspace('candidates,continuity', options)); } catch (error) { setError('dhNsaDirectorCandidatesHost', error); }
    }
  }

  function activeStep() {
    const active = document.querySelector('#dhNewStoryAdLegacyMount .dh-luxgen-stage.active');
    return Number(active?.dataset?.panel || 0) || Number(window.__newStoryAdLegacyUI?.state?.currentStep || 0) || 0;
  }

  function refreshCurrent(options = {}) {
    cache.clear();
    return loadStep(activeStep(), { ...options, force: true });
  }

  function bind() {
    document.addEventListener('click', event => {
      const step = event.target?.closest?.('[data-nsa-step]')?.dataset?.nsaStep;
      if (step) setTimeout(() => loadStep(Number(step)), 0);
      const refresh = event.target?.closest?.('[data-nsa-director-refresh]');
      if (refresh) refreshCurrent();
      const page = event.target?.closest?.('[data-nsa-director-page]');
      if (page && !page.disabled) {
        const offset = Math.max(0, Number(page.dataset.nsaDirectorPage || 0) || 0);
        const target = page.dataset.nsaDirectorTarget;
        loadStep(target === 'candidates' ? 5 : 4, { shotOffset: offset, force: true });
      }
    }, true);
    document.addEventListener('new-story-ad:restore-finished', () => loadStep(activeStep(), { force: true }));
    document.addEventListener('new-story-ad:media-modules-ready', () => loadStep(activeStep(), { force: true }));
    const mount = document.getElementById('dhNewStoryAdLegacyMount');
    if (mount && !observer) {
      observer = new MutationObserver(mutations => {
        if (mutations.some(item => item.type === 'attributes' && item.attributeName === 'class')) loadStep(activeStep());
      });
      mount.querySelectorAll('.dh-luxgen-stage').forEach(stage => observer.observe(stage, { attributes: true, attributeFilter: ['class'] }));
    }
  }

  function mount() {
    ensureStyle();
    bind();
    loadStep(activeStep());
  }

  window.NewStoryAdDirectorWorkspace = {
    mount,
    loadStep,
    refresh: refreshCurrent,
    clearCache: () => cache.clear(),
  };
  document.addEventListener('new-story-ad:mount', mount);
})();
