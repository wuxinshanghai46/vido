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
    return true;
  }

  function renderDraft(analysis = {}) {
    const draft = $('#dhNsaReferenceVideoDraft');
    const status = $('#dhNsaReferenceVideoDraftStatus');
    const completed = analysis.status === 'completed' && !!analysis.result;
    if (draft) draft.hidden = !completed;
    if (status && completed) {
      status.textContent = '中文分析内容已自动填入上方“广告需求”文本框，可直接检查和修改。';
    }
    if (completed && fillRequirementFromAnalysis(analysis)) setModal(false);
  }

  function render(analysis = state.analysis || {}) {
    state.analysis = analysis?.id ? analysis : state.analysis;
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
      stopPolling();
      state.analysis = null;
      state.mappingFingerprint = '';
      state.autoFilledAnalysisId = '';
      state.lastErrorKey = '';
      render({});
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
        analysis_scope: 'creative_structure_only',
        camera_intents: analysis.result?.camera_intents || [],
        character_actions: analysis.result?.character_actions || [],
        scene_view_mapping: analysis.scene_view_mapping || null,
        identity_extraction_allowed: false,
      };
    },
    mapCurrentSceneViews,
  };
  document.addEventListener('new-story-ad:mount', bind);
  if (document.readyState !== 'loading') bind();
})();
