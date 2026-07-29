(() => {
  const state = {
    mounted: false,
    analysis: null,
    uploadSession: null,
    pollTimer: null,
    mappingFingerprint: '',
    autoFilledAnalysisId: '',
    modalOpen: false,
    lastErrorKey: '',
    explicitlyRemoved: false,
  };

  const $ = selector => document.querySelector(selector);
  const api = () => window.NewStoryAdApi;

  function notify(message, tone = 'info') {
    if (typeof window.showToast === 'function') window.showToast(message, tone);
    else if (tone === 'error') console.error(message);
  }

  function setProgress(analysis = {}) {
    const wrap = $('#dhNsaReferenceVideoProgress');
    const running = ['uploading', 'importing', 'queued', 'running', 'cancelling'].includes(analysis.status);
    if (wrap) wrap.hidden = !running;
    const progress = Math.max(0, Math.min(100, Number(analysis.progress || 0)));
    const bar = wrap?.querySelector('progress');
    if (bar) bar.value = progress;
    const percent = $('#dhNsaReferenceVideoPercent');
    if (percent) percent.textContent = `${progress}%`;
    const phase = $('#dhNsaReferenceVideoPhase');
    if (phase) phase.textContent = analysis.phase || '等待分析';
  }

  function setModal(open) {
    const modal = $('#dhNsaReferenceVideoModal');
    state.modalOpen = !!open;
    if (!modal) return;
    modal.hidden = !state.modalOpen;
    modal.setAttribute('aria-hidden', state.modalOpen ? 'false' : 'true');
    document.body.classList.toggle('dh-nsa-reference-modal-open', state.modalOpen);
    if (state.modalOpen) {
      setTimeout(() => ($('#dhNsaReferenceVideoUrl') || $('#dhNsaReferenceVideoPick'))?.focus(), 0);
    }
  }

  function appendList(parent, title, values = []) {
    if (!values.length) return;
    const section = document.createElement('section');
    const heading = document.createElement('b');
    heading.textContent = title;
    section.appendChild(heading);
    const list = document.createElement('ul');
    values.forEach(value => {
      const item = document.createElement('li');
      item.textContent = value;
      list.appendChild(item);
    });
    section.appendChild(list);
    parent.appendChild(section);
  }

  function creativeDirectionText(result = {}) {
    const outline = result.story_outline || {};
    const beats = Array.isArray(result.plot_beats) ? result.plot_beats : [];
    const actions = Array.isArray(result.character_actions) ? result.character_actions : [];
    const cameras = Array.isArray(result.camera_intents) ? result.camera_intents : [];
    return [
      outline.logline ? `【核心故事线】${outline.logline}` : '',
      [outline.opening, outline.development, outline.turning_point, outline.resolution].filter(Boolean).length
        ? `【剧情展开】${[
          outline.opening ? `开端：${outline.opening}` : '',
          outline.development ? `发展：${outline.development}` : '',
          outline.turning_point ? `转折：${outline.turning_point}` : '',
          outline.resolution ? `结局：${outline.resolution}` : '',
        ].filter(Boolean).join('；')}`
        : '',
      beats.length ? `【剧情节拍】${beats.map((item, index) => `${index + 1}. ${item.purpose || item.description || ''}`).join('；')}` : '',
      actions.length ? `【人物动作】${actions.map((item, index) => `${index + 1}. ${item.start_pose || ''} → ${item.key_action || ''} → ${item.end_pose || ''}`).join('；')}` : '',
      cameras.length ? `【机位与运镜】${cameras.map((item, index) => `${index + 1}. ${item.movement || '固定'}，${item.start_shot_size || ''}到${item.end_shot_size || ''}`).join('；')}` : '',
    ].filter(Boolean).join('\n');
  }

  function referenceScenePlan(result = {}) {
    const facts = result.source_facts || {};
    const scenes = Array.isArray(result.scene_prompts) ? result.scene_prompts : [];
    if (!scenes.length) return null;
    const spaces = scenes.slice(0, 12).map((scene, index) => ({
      id: `reference_space_${index + 1}`,
      space_id: `reference_space_${index + 1}`,
      scene_id: `reference_space_${index + 1}`,
      name: scene.location_type || `参考视频空间 ${index + 1}`,
      description: scene.layout_prompt || facts.layout || '',
      story_purpose: Array.isArray(scene.beat_refs) && scene.beat_refs.length
        ? `承载参考剧情节拍 ${scene.beat_refs.join('、')}`
        : '承载参考视频识别出的剧情与展示动作',
      scene_spec: {
        mode: scenes.length > 1 ? 'multi' : 'single',
        layoutText: scene.layout_prompt || facts.layout || '',
        materialLightText: scene.material_light_prompt
          || [...(Array.isArray(facts.materials) ? facts.materials : []), facts.lighting].filter(Boolean).join('；'),
        interactionText: scene.interaction_prompt
          || (Array.isArray(facts.human_actions) ? facts.human_actions.join('；') : ''),
        negativeText: scene.negative_prompt || '禁止凭空替换参考视频中的产品类别、物理空间和核心材质；禁止无关文字、水印和旧任务内容',
        materialContract: {
          dominant_finish: (Array.isArray(facts.materials) ? facts.materials : []).join('、'),
          observable_cues: [
            ...(Array.isArray(facts.materials) ? facts.materials : []),
            ...(Array.isArray(facts.colors) ? facts.colors : []),
          ].filter(Boolean),
          source_authority: 'reference_video_evidence',
        },
      },
    }));
    return {
      scene_mode: spaces.length > 1 ? 'multi' : 'single',
      advertised_subject: facts.product_or_service || '',
      spaces,
    };
  }

  function scenePlanHasContent(plan = {}, spec = {}) {
    const values = [
      spec.layoutText,
      spec.materialLightText,
      spec.interactionText,
      spec.negativeText,
      ...(Array.isArray(plan.spaces) ? plan.spaces.flatMap(space => {
        const item = space.scene_spec || space.sceneSpec || {};
        return [item.layoutText, item.materialLightText, item.interactionText, item.negativeText];
      }) : []),
    ];
    return values.some(value => String(value || '').trim());
  }

  function adoptReferenceAnalysis(analysis = {}) {
    const result = analysis.result || analysis;
    const legacy = window.__newStoryAdLegacyUI;
    if (result.analysis_quality?.valid !== true || !legacy?.state) return false;
    let changed = false;
    const creativeInput = $('#dhNsaAdCreativeDirection');
    const creativeText = creativeDirectionText(result);
    if (creativeInput && !String(creativeInput.value || '').trim() && creativeText) {
      creativeInput.value = creativeText.slice(0, Number(creativeInput.maxLength || 4000));
      creativeInput.dispatchEvent(new Event('input', { bubbles: true }));
      creativeInput.dispatchEvent(new Event('change', { bubbles: true }));
      changed = true;
    }
    const currentSpec = window.NewStoryAdSceneAssets?.specPayload?.() || {};
    const currentPlan = window.NewStoryAdSceneAssets?.planPayload?.(legacy.state, currentSpec) || legacy.state.sceneConfig || {};
    const plan = referenceScenePlan(result);
    if (plan && !scenePlanHasContent(currentPlan, currentSpec)
      && window.NewStoryAdSceneAssets?.applyPlan?.(legacy.state, plan)) {
      legacy.markSourceDirty?.('scene');
      legacy.renderAll?.();
      legacy.scheduleAutoSave?.('reference_video_projection');
      changed = true;
    }
    return changed;
  }

  function fillRequirementFromAnalysis(analysis = {}) {
    const result = analysis.result;
    const text = String(result?.generated_brief || '').trim();
    const input = $('#dhNsaAdText');
    if (!analysis.id || analysis.status !== 'completed' || !text || !input) return false;
    if (state.autoFilledAnalysisId === analysis.id) return false;
    const maxLength = Number(input.maxLength || 1800);
    const current = String(input.value || '').trim();
    const prefix = '【参考视频分析补充】\n';
    const next = current && !current.includes(text)
      ? `${current}\n\n${prefix}${text}`
      : text;
    input.value = next.slice(0, maxLength);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    state.autoFilledAnalysisId = analysis.id;
    input.focus({ preventScroll: true });
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    notify(
      next.length > maxLength
        ? '分析完成，中文内容已填入广告需求文本框；受长度限制，末尾内容已截断，请直接检查和修改'
        : '分析完成，中文内容已填入广告需求文本框，请直接检查和修改',
      'success',
    );
    adoptReferenceAnalysis(analysis);
    return true;
  }

  function reset(options = {}) {
    stopPolling();
    state.analysis = null;
    state.uploadSession = null;
    state.mappingFingerprint = '';
    state.autoFilledAnalysisId = '';
    state.lastErrorKey = '';
    state.explicitlyRemoved = options.explicit === true;
    state.modalOpen = false;
    render({});
    setModal(false);
  }

  function hydrate(saved = null) {
    if (!saved || typeof saved !== 'object' || !saved.analysis_id) {
      reset();
      return null;
    }
    const id = String(saved.analysis_id || '').trim();
    state.analysis = {
      id,
      status: saved.status || 'completed',
      result: {
        schema_version: Number(saved.schema_version || 3) || 3,
        analysis_scope: saved.analysis_scope || 'reference_content_and_creative_structure',
        generated_brief: saved.generated_brief || '',
        source_facts: saved.source_facts || {},
        analysis_quality: saved.analysis_quality || {},
        story_outline: saved.story_outline || {},
        plot_beats: saved.plot_beats || [],
        character_prompts: saved.character_prompts || [],
        scene_prompts: saved.scene_prompts || [],
        camera_intents: saved.camera_intents || [],
        character_actions: saved.character_actions || [],
        prompt_suggestions: saved.prompt_suggestions || {},
        transcript: { status: saved.transcript_status || '' },
        warnings: saved.warnings || [],
      },
      scene_view_mapping: saved.scene_view_mapping || null,
    };
    state.mappingFingerprint = '';
    state.autoFilledAnalysisId = id;
    state.lastErrorKey = '';
    state.explicitlyRemoved = false;
    render(state.analysis);
    return state.analysis;
  }

  function renderDraft(analysis = {}) {
    const draft = $('#dhNsaReferenceVideoDraft');
    const status = $('#dhNsaReferenceVideoDraftStatus');
    const completed = analysis.status === 'completed' && !!analysis.result;
    if (draft) draft.hidden = !completed;
    if (status && completed) {
      status.textContent = '完整剧情、人物提示词、场景提示词、动作和机位运镜已填入“广告需求”，修改后会以你的版本进入剧情生成。';
    }
    if (completed && fillRequirementFromAnalysis(analysis)) setModal(false);
  }

  function render(analysis = state.analysis || {}) {
    state.analysis = analysis?.id ? analysis : state.analysis;
    if (analysis?.id) state.explicitlyRemoved = false;
    const current = analysis?.status === 'uploading' ? analysis : (state.analysis || {});
    const status = $('#dhNsaReferenceVideoState');
    const labels = {
      importing: '读取链接中',
      uploaded: '已上传',
      queued: '排队中',
      running: '分析中',
      cancelling: '取消中',
      cancelled: '已取消',
      completed: '分析完成',
      failed: '分析失败',
      uploading: '上传中',
    };
    if (status) status.textContent = labels[current.status] || '未添加';
    const fileNames = [
      $('#dhNsaReferenceVideoFileName'),
      $('#dhNsaReferenceVideoDialogFileName'),
    ].filter(Boolean);
    if (fileNames.length && current.source?.original_name) {
      const meta = current.source.metadata || {};
      const text = meta.duration_seconds
        ? `${current.source.original_name} · ${Number(meta.duration_seconds).toFixed(1)} 秒 · ${meta.width || 0}×${meta.height || 0}`
        : (current.source.display_url || current.source.original_name);
      fileNames.forEach(target => { target.textContent = text; });
    }
    const assets = [
      $('#dhNsaReferenceVideoAsset'),
      $('#dhNsaReferenceVideoDialogAsset'),
    ].filter(Boolean);
    const hasAsset = !!state.uploadSession || !!current.id || !!current.source?.original_name;
    assets.forEach(target => { target.hidden = !hasAsset; });
    const assetStatuses = [
      $('#dhNsaReferenceVideoAssetStatus'),
      $('#dhNsaReferenceVideoDialogAssetStatus'),
    ].filter(Boolean);
    if (hasAsset) {
      const text = current.error?.message || current.phase || labels[current.status] || '等待处理';
      assetStatuses.forEach(target => { target.textContent = text; });
    }
    const busy = state.uploadSession || ['importing', 'queued', 'running', 'cancelling'].includes(current.status);
    const occupied = !!state.uploadSession || !!current.id;
    const pick = $('#dhNsaReferenceVideoPick');
    if (pick) pick.disabled = !!occupied;
    const linkRead = $('#dhNsaReferenceVideoLinkRead');
    if (linkRead) linkRead.disabled = !!occupied;
    const linkInput = $('#dhNsaReferenceVideoUrl');
    if (linkInput) linkInput.disabled = !!occupied;
    const open = $('#dhNsaReferenceVideoOpen');
    if (open) open.textContent = occupied ? '查看参考视频' : '添加参考视频';
    const start = $('#dhNsaReferenceVideoStart');
    if (start) start.disabled = !current.id
      || !current.source?.metadata?.duration_seconds
      || !['uploaded', 'cancelled', 'failed'].includes(current.status);
    const clears = [
      $('#dhNsaReferenceVideoClear'),
      $('#dhNsaReferenceVideoDialogClear'),
    ].filter(Boolean);
    clears.forEach(clear => {
      clear.hidden = !hasAsset;
      clear.title = busy ? '取消当前处理' : '删除参考视频';
      clear.setAttribute('aria-label', busy ? '取消当前参考视频处理' : '删除参考视频');
    });
    setProgress(current);
    renderDraft(current);
    const errorKey = current.error?.message ? `${current.id}:${current.error.code || ''}:${current.error.message}` : '';
    if (errorKey && errorKey !== state.lastErrorKey) {
      state.lastErrorKey = errorKey;
      notify(current.error.message, 'error');
    }
  }

  function stopPolling() {
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }

  async function poll() {
    if (!state.analysis?.id) return;
    try {
      const result = await api().request(`/api/new-story-ad/reference-video-analyses/${encodeURIComponent(state.analysis.id)}`);
      render(result.analysis);
      if (['importing', 'queued', 'running', 'cancelling'].includes(result.analysis?.status)) {
        state.pollTimer = setTimeout(poll, 1200);
      } else {
        stopPolling();
      }
    } catch (error) {
      stopPolling();
      notify(error.message, 'error');
    }
  }

  async function upload(file) {
    if (!file) return;
    if (state.uploadSession || ['importing', 'queued', 'running', 'cancelling'].includes(state.analysis?.status)) {
      notify('当前参考视频任务仍在处理中，请先等待或取消', 'error');
      return;
    }
    if (!$('#dhNsaReferenceVideoRights')?.checked) {
      notify('请先确认拥有参考视频的分析与使用权', 'error');
      return;
    }
    const form = new FormData();
    form.append('file', file);
    form.append('rights_confirmed', 'true');
    const pick = $('#dhNsaReferenceVideoPick');
    if (pick) pick.disabled = true;
    try {
      if (file.size > 10 * 1024 * 1024) {
        await uploadChunked(file);
        return;
      }
      const result = await api().request('/api/new-story-ad/reference-video-analyses', {
        method: 'POST',
        body: form,
        timeoutMs: 180000,
      });
      render(result.analysis);
      notify('参考视频已上传，确认后可开始分析', 'success');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      if (pick) pick.disabled = !!state.analysis?.id || !!state.uploadSession;
    }
  }

  async function readLink() {
    const input = $('#dhNsaReferenceVideoUrl');
    const button = $('#dhNsaReferenceVideoLinkRead');
    const videoUrl = String(input?.value || '').trim();
    if (state.uploadSession || ['importing', 'queued', 'running', 'cancelling'].includes(state.analysis?.status)) {
      notify('当前参考视频任务仍在处理中，请先等待或取消', 'error');
      return;
    }
    if (!videoUrl) {
      notify('请先粘贴公开视频链接', 'error');
      input?.focus();
      return;
    }
    if (!$('#dhNsaReferenceVideoRights')?.checked) {
      notify('请先确认拥有参考视频的分析与使用权', 'error');
      return;
    }
    if (button) button.disabled = true;
    try {
      const result = await api().request('/api/new-story-ad/reference-video-links', {
        method: 'POST',
        body: {
          video_url: videoUrl,
          rights_confirmed: true,
        },
        timeoutMs: 30000,
      });
      render(result.analysis);
      stopPolling();
      state.pollTimer = setTimeout(poll, 500);
      notify('正在安全读取链接视频；读取完成后可开始智能分析', 'success');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      if (button) button.disabled = ['importing', 'queued', 'running', 'cancelling'].includes(state.analysis?.status);
    }
  }

  async function uploadChunked(file) {
    const chunkSize = 5 * 1024 * 1024;
    const created = await api().request('/api/new-story-ad/reference-video-upload-sessions', {
      method: 'POST',
      body: {
        file_name: file.name,
        size_bytes: file.size,
        mimetype: file.type || 'application/octet-stream',
        last_modified: file.lastModified || 0,
        chunk_size: chunkSize,
        rights_confirmed: true,
      },
    });
    state.uploadSession = created.session;
    render({
      status: 'uploading',
      progress: 0,
      phase: '正在准备断点续传',
      source: { original_name: file.name, metadata: {} },
    });
    const received = new Set(created.session.received_chunks || []);
    for (let index = 0; index < created.session.total_chunks; index += 1) {
      if (received.has(index)) continue;
      if (!state.uploadSession) throw new Error('参考视频上传已取消');
      const form = new FormData();
      form.append('file', file.slice(index * chunkSize, Math.min(file.size, (index + 1) * chunkSize)), `chunk-${index}.part`);
      const result = await api().request(
        `/api/new-story-ad/reference-video-upload-sessions/${encodeURIComponent(created.session.id)}/chunks/${index}`,
        { method: 'POST', body: form, timeoutMs: 120000 },
      );
      state.uploadSession = result.session;
      const progress = Math.round((result.session.received_chunks.length / result.session.total_chunks) * 95);
      render({
        status: 'uploading',
        progress,
        phase: `断点续传 ${result.session.received_chunks.length}/${result.session.total_chunks}`,
        source: { original_name: file.name, metadata: {} },
      });
    }
    const completed = await api().request(
      `/api/new-story-ad/reference-video-upload-sessions/${encodeURIComponent(created.session.id)}/complete`,
      { method: 'POST', timeoutMs: 180000 },
    );
    state.uploadSession = null;
    render(completed.analysis);
    notify('参考视频已分片上传并完成校验，确认后可开始分析', 'success');
  }

  async function start() {
    if (!state.analysis?.id) return;
    try {
      const result = await api().request(`/api/new-story-ad/reference-video-analyses/${encodeURIComponent(state.analysis.id)}/start`, { method: 'POST' });
      render(result.analysis);
      stopPolling();
      state.pollTimer = setTimeout(poll, 500);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function cancel() {
    if (state.uploadSession?.id) {
      const sessionId = state.uploadSession.id;
      state.uploadSession = null;
      try {
        await api().request(`/api/new-story-ad/reference-video-upload-sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      } catch {}
      stopPolling();
      render({});
      notify('参考视频上传已取消', 'success');
      return;
    }
    if (!state.analysis?.id) return;
    try {
      const result = await api().request(`/api/new-story-ad/reference-video-analyses/${encodeURIComponent(state.analysis.id)}/cancel`, { method: 'POST' });
      render(result.analysis);
      stopPolling();
      state.pollTimer = setTimeout(poll, 300);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function remove() {
    if (!state.analysis?.id) return;
    try {
      await api().request(`/api/new-story-ad/reference-video-analyses/${encodeURIComponent(state.analysis.id)}`, { method: 'DELETE' });
      reset({ explicit: true });
      const urlInput = $('#dhNsaReferenceVideoUrl');
      if (urlInput) urlInput.value = '';
      [$('#dhNsaReferenceVideoFileName'), $('#dhNsaReferenceVideoDialogFileName')]
        .filter(Boolean)
        .forEach(name => { name.textContent = '参考视频'; });
      notify('参考视频及分析草稿已删除', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function clearCurrent() {
    const status = state.analysis?.status;
    if (state.uploadSession || ['importing', 'queued', 'running', 'cancelling'].includes(status)) {
      await cancel();
      return;
    }
    await remove();
  }

  async function mapCurrentSceneViews() {
    if (state.analysis?.status !== 'completed') return;
    const sceneAssets = window.__newStoryAdLegacyUI?.state?.sceneAssets || [];
    if (!sceneAssets.length) return;
    const fingerprint = sceneAssets.map(item => `${item.id || ''}:${item.view_key || item.kind || ''}`).join('|');
    if (!fingerprint || fingerprint === state.mappingFingerprint) return;
    state.mappingFingerprint = fingerprint;
    try {
      const result = await api().request(`/api/new-story-ad/reference-video-analyses/${encodeURIComponent(state.analysis.id)}/map-scene-views`, {
        method: 'POST',
        body: { scene_assets: sceneAssets },
      });
      state.analysis.scene_view_mapping = result.mapping;
      const target = $('#dhNsaReferenceVideoSceneMapping');
      if (!target) return;
      target.hidden = false;
      target.replaceChildren();
      const title = document.createElement('b');
      title.textContent = '运镜意图 → 当前场景机位映射';
      target.appendChild(title);
      appendList(target, '', (result.mapping?.mappings || []).map(item => (
        `${item.camera_intent_id}：${item.mapped_view || '未映射'} · ${item.execution}`
      )));
    } catch (error) {
      state.mappingFingerprint = '';
      console.warn('[new-story-ad] scene view mapping failed', error);
    }
  }

  function bind() {
    if (state.mounted) return;
    state.mounted = true;
    document.addEventListener('click', event => {
      if (event.target?.closest?.('#dhNsaReferenceVideoOpen')) setModal(true);
      if (event.target?.closest?.('#dhNsaReferenceVideoClose, [data-nsa-reference-video-close]')) setModal(false);
      if (event.target?.closest?.('#dhNsaReferenceVideoPick')) $('#dhNsaReferenceVideoFile')?.click();
      if (event.target?.closest?.('#dhNsaReferenceVideoLinkRead')) readLink();
      if (event.target?.closest?.('#dhNsaReferenceVideoStart')) start();
      if (event.target?.closest?.('#dhNsaReferenceVideoClear, #dhNsaReferenceVideoDialogClear')) clearCurrent();
    });
    document.addEventListener('change', event => {
      if (event.target?.id !== 'dhNsaReferenceVideoFile') return;
      const file = event.target.files?.[0];
      event.target.value = '';
      upload(file);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.modalOpen) {
        event.preventDefault();
        setModal(false);
        return;
      }
      if (event.target?.id === 'dhNsaReferenceVideoUrl' && event.key === 'Enter') {
        event.preventDefault();
        readLink();
      }
    });
    setInterval(mapCurrentSceneViews, 2500);
  }

  window.NewStoryAdReferenceVideoAnalysis = {
    bind,
    current: () => state.analysis,
    taskPayload: () => {
      const analysis = state.analysis;
      if (!analysis?.id || analysis.status !== 'completed') return null;
      return {
        analysis_id: analysis.id,
        status: analysis.status,
        schema_version: Number(analysis.result?.schema_version || 3) || 3,
        analysis_scope: analysis.result?.analysis_scope || 'reference_content_and_creative_structure',
        generated_brief: analysis.result?.generated_brief || '',
        source_facts: analysis.result?.source_facts || {},
        analysis_quality: analysis.result?.analysis_quality || {},
        story_outline: analysis.result?.story_outline || {},
        plot_beats: analysis.result?.plot_beats || [],
        character_prompts: analysis.result?.character_prompts || [],
        scene_prompts: analysis.result?.scene_prompts || [],
        camera_intents: analysis.result?.camera_intents || [],
        character_actions: analysis.result?.character_actions || [],
        prompt_suggestions: analysis.result?.prompt_suggestions || {},
        scene_view_mapping: analysis.scene_view_mapping || null,
        transcript_status: analysis.result?.transcript?.status || '',
        warnings: analysis.result?.warnings || [],
        identity_extraction_allowed: false,
      };
    },
    taskPayloadOrSaved: saved => state.explicitlyRemoved
      ? null
      : (window.NewStoryAdReferenceVideoAnalysis.taskPayload()
        || (saved && typeof saved === 'object' ? saved : null)),
    hydrate,
    reset,
    wasExplicitlyRemoved: () => state.explicitlyRemoved,
    adoptReferenceAnalysis,
    referenceScenePlan,
    creativeDirectionText,
    mapCurrentSceneViews,
  };
  document.addEventListener('new-story-ad:mount', bind);
  if (document.readyState !== 'loading') bind();
})();
