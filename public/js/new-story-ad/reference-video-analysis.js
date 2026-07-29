(() => {
  const state = {
    mounted: false,
    analysis: null,
    uploadSession: null,
    pollTimer: null,
    mappingFingerprint: '',
  };

  const $ = selector => document.querySelector(selector);
  const api = () => window.NewStoryAdApi;

  function notify(message, tone = 'info') {
    if (typeof window.showToast === 'function') window.showToast(message, tone);
    else if (tone === 'error') console.error(message);
  }

  function setProgress(analysis = {}) {
    const wrap = $('#dhNsaReferenceVideoProgress');
    const running = ['queued', 'running', 'cancelling'].includes(analysis.status);
    if (wrap) wrap.hidden = !running && !analysis.progress;
    const progress = Math.max(0, Math.min(100, Number(analysis.progress || 0)));
    const bar = wrap?.querySelector('progress');
    if (bar) bar.value = progress;
    const percent = $('#dhNsaReferenceVideoPercent');
    if (percent) percent.textContent = `${progress}%`;
    const phase = $('#dhNsaReferenceVideoPhase');
    if (phase) phase.textContent = analysis.phase || '等待分析';
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

  function renderDraft(analysis = {}) {
    const draft = $('#dhNsaReferenceVideoDraft');
    const body = $('#dhNsaReferenceVideoDraftBody');
    const result = analysis.result;
    if (!draft || !body) return;
    draft.hidden = !result;
    body.replaceChildren();
    if (!result) return;
    const summary = document.createElement('p');
    summary.textContent = result.summary || '分析已完成';
    body.appendChild(summary);
    appendList(body, '剧情结构', (result.plot_beats || []).map(item => `${item.purpose || '剧情节点'} · ${item.rhythm || '节奏待定'}`));
    appendList(body, '机位与运镜意图', (result.camera_intents || []).map(item => (
      `${item.start_shot_size || '镜头'} → ${item.end_shot_size || '镜头'}；${item.movement || '固定'}；${item.angle || '平视'}；约 ${item.lens_estimate_mm || '?'}mm；证据 ${item.evidence_timestamps?.join('s / ') || '—'}s`
    )));
    appendList(body, '人物动作（通用角色）', (result.character_actions || []).map(item => (
      `${item.start_pose || ''} → ${item.key_action || ''} → ${item.end_pose || ''}；${item.prop_contact || '无道具接触'}；${item.expression_change || '表情连续'}`
    )));
    const brief = document.createElement('details');
    brief.open = true;
    const briefTitle = document.createElement('summary');
    briefTitle.textContent = '可回填的广告需求草稿';
    const pre = document.createElement('pre');
    pre.textContent = result.generated_brief || '';
    brief.append(briefTitle, pre);
    body.appendChild(brief);
  }

  function render(analysis = state.analysis || {}) {
    state.analysis = analysis?.id ? analysis : state.analysis;
    const current = analysis?.status === 'uploading' ? analysis : (state.analysis || {});
    const status = $('#dhNsaReferenceVideoState');
    const labels = {
      uploaded: '已上传',
      queued: '排队中',
      running: '分析中',
      cancelling: '取消中',
      cancelled: '已取消',
      completed: '分析完成',
      failed: '分析失败',
      uploading: '上传中',
    };
    if (status) status.textContent = labels[current.status] || '未上传';
    const fileName = $('#dhNsaReferenceVideoFileName');
    if (fileName && current.source?.original_name) {
      const meta = current.source.metadata || {};
      fileName.textContent = `${current.source.original_name} · ${Number(meta.duration_seconds || 0).toFixed(1)} 秒 · ${meta.width || 0}×${meta.height || 0}`;
    }
    const start = $('#dhNsaReferenceVideoStart');
    if (start) start.disabled = !current.id || !['uploaded', 'cancelled', 'failed'].includes(current.status);
    const cancel = $('#dhNsaReferenceVideoCancel');
    if (cancel) cancel.hidden = !state.uploadSession && !['queued', 'running', 'cancelling'].includes(current.status);
    const remove = $('#dhNsaReferenceVideoDelete');
    if (remove) remove.hidden = !current.id || ['queued', 'running', 'cancelling'].includes(current.status);
    setProgress(current);
    renderDraft(current);
    if (current.error?.message) notify(current.error.message, 'error');
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
      if (['queued', 'running', 'cancelling'].includes(result.analysis?.status)) {
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
      if (pick) pick.disabled = false;
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
      render({});
      notify('参考视频上传已取消', 'success');
      return;
    }
    if (!state.analysis?.id) return;
    try {
      const result = await api().request(`/api/new-story-ad/reference-video-analyses/${encodeURIComponent(state.analysis.id)}/cancel`, { method: 'POST' });
      render(result.analysis);
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
      render({});
      const name = $('#dhNsaReferenceVideoFileName');
      if (name) name.textContent = 'MP4 / MOV / WebM，最长 180 秒，最大 200MB';
      notify('参考视频及分析草稿已删除', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function applyDraft(mode = 'merge') {
    const text = String(state.analysis?.result?.generated_brief || '').trim();
    const input = $('#dhNsaAdText');
    if (!text || !input) return;
    const current = String(input.value || '').trim();
    const next = mode === 'replace' ? text : [current, text].filter(Boolean).join('\n\n');
    input.value = next.slice(0, Number(input.maxLength || 1800));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    notify(mode === 'replace' ? '已用分析草稿替换广告需求' : '已将分析草稿合并到广告需求', 'success');
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
      if (event.target?.closest?.('#dhNsaReferenceVideoPick')) $('#dhNsaReferenceVideoFile')?.click();
      if (event.target?.closest?.('#dhNsaReferenceVideoStart')) start();
      if (event.target?.closest?.('#dhNsaReferenceVideoCancel')) cancel();
      if (event.target?.closest?.('#dhNsaReferenceVideoDelete')) remove();
      const apply = event.target?.closest?.('[data-nsa-reference-apply]');
      if (apply) applyDraft(apply.dataset.nsaReferenceApply);
    });
    document.addEventListener('change', event => {
      if (event.target?.id !== 'dhNsaReferenceVideoFile') return;
      const file = event.target.files?.[0];
      event.target.value = '';
      upload(file);
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
