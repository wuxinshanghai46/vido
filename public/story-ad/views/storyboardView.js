import { request } from '../api.js?v=20260813-ui-v238';
import { bindMediaLightbox, emptyState, escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js?v=20260813-ui-v238';
import { confirmDialog } from '../components/dialog.js?v=20260813-ui-v238';

export function friendlyBindings(bundle = {}, shot = {}) {
  const assets = bundle.assets || {};
  const scenes = Array.isArray(assets.scenes) ? assets.scenes : [];
  const subjects = [
    ...(Array.isArray(assets.people) ? assets.people.map(item => ({ item, label: '人物' })) : []),
    ...(Array.isArray(assets.animals) ? assets.animals.map(item => ({ item, label: '动物' })) : []),
    ...(Array.isArray(assets.products) ? assets.products.map(item => ({ item, label: '商品' })) : []),
    ...(Array.isArray(assets.props) ? assets.props.map(item => ({ item, label: '道具' })) : []),
  ];
  const sceneId = shot.scene_id || shot.scene_asset_id || '';
  const scene = scenes.find(item => [item.id, item.asset_id].filter(Boolean).includes(sceneId));
  const cameraId = shot.camera_id || '';
  const camera = (scene?.cameras || []).find(item => [item.id, item.camera_id].filter(Boolean).includes(cameraId));
  const characterIds = Array.isArray(shot.character_ids) ? shot.character_ids : [];
  const lookId = String(shot.look_id || '');
  const lookOwner = (assets.people || []).map(item => item.profile || {}).find(profile => (
    (profile.look_profiles || []).some(look => String(look.id || '') === lookId)
  ));
  const look = (lookOwner?.look_profiles || []).find(item => String(item.id || '') === lookId);
  return [
    sceneId ? { id: sceneId, label: `场景：${scene?.name || shot.scene_name || '已绑定场景'}` } : null,
    cameraId ? { id: cameraId, label: `机位：${camera?.label || camera?.role || '已绑定机位'}` } : null,
    lookId ? { id: lookId, label: `造型：${lookOwner?.displayName || lookOwner?.name || '人物'} · ${look?.name || '未知造型'}` } : null,
    ...characterIds.map(id => {
      const subject = subjects.find(entry => [entry.item.id, entry.item.asset_id, entry.item.subject_id].filter(Boolean).includes(id));
      return { id, label: `${subject?.label || '主体'}：${subject?.item?.name || subject?.item?.role || '已绑定主体'}` };
    }),
  ].filter(Boolean);
}

function shotRow(shot = {}, index = 0, bundle = {}) {
  const shotIndex = Number(shot.shot_index || shot.index || index + 1) || index + 1;
  const bindings = friendlyBindings(bundle, shot);
  return `<div class="shot-row" data-storyboard-shot="${shotIndex}">
    <b>SH${String(shotIndex).padStart(2, '0')}</b>
    <span class="shot-copy"><b>${escapeHtml(shot.title || `镜头 ${shotIndex}`)}</b><small>${escapeHtml(shot.visual || shot.visual_description || shot.action || '')}</small></span>
    <span>${escapeHtml(shot.voiceover || shot.narration || '—')}</span>
    <span class="binding-chips">${bindings.length ? bindings.map(item => `<span class="chip ok" title="${escapeHtml(item.id)}">${escapeHtml(item.label)}</span>`).join('') : '<span class="chip">未绑定</span>'}</span>
    <button class="btn small" type="button" data-edit-shot="${shotIndex}" aria-expanded="false">编辑分镜</button>
    <form class="shot-inline-editor" data-shot-inline-editor="${shotIndex}" hidden>
      <label class="field"><span>分镜名称</span><input class="input" name="title" value="${escapeHtml(shot.title || `镜头 ${shotIndex}`)}"></label>
      <label class="field"><span>时长（秒）</span><input class="input" name="duration" type="number" min="1" max="15" step="1" value="${Number(shot.duration || shot.duration_sec || 3) || 3}"></label>
      <label class="field full"><span>画面内容</span><textarea class="textarea" name="visual" rows="3">${escapeHtml(shot.visual || shot.visual_description || '')}</textarea></label>
      <label class="field full"><span>人物 / 商品动作</span><textarea class="textarea" name="action" rows="2">${escapeHtml(shot.action || shot.visual_action || '')}</textarea></label>
      <label class="field full"><span>旁白 / 台词</span><textarea class="textarea" name="voiceover" rows="2">${escapeHtml(shot.voiceover || shot.narration || '')}</textarea></label>
      <div class="shot-inline-actions"><button class="btn" type="button" data-cancel-inline-shot>取消</button><button class="btn primary" type="submit" data-save-inline-shot>保存本镜</button></div>
    </form>
  </div>`;
}

function sketchCard(shot, sketch = {}, index = 0, gate = {}) {
  const shotIndex = Number(shot.shot_index || shot.index || index + 1) || index + 1;
  const disabled = gate.ready === false ? 'disabled' : '';
  return `<article class="card sketch-card sketch-tile ${gate.ready === false ? 'is-gated' : ''}" data-sketch-shot="${shotIndex}">
    <div class="sketch-tile-media">${mediaPreview(sketch, { label: `SH${String(shotIndex).padStart(2, '0')} · ${shot.title || `镜头 ${shotIndex}`}`, width: 960, symbol: '线稿', zoomable: true, zoomGroup: 'storyboard-sketches' })}<span class="sketch-shot-number">SH${String(shotIndex).padStart(2, '0')}</span></div>
    <div class="sketch-tile-copy"><div><h2>${escapeHtml(shot.title || `镜头 ${shotIndex}`)}</h2><p>${escapeHtml(shot.visual || shot.visual_description || shot.action || '')}</p></div><span class="status-tag is-${sketch.status === 'confirmed' ? 'success' : 'neutral'}">${escapeHtml(sketch.status === 'confirmed' ? '已确认' : (sketch.status === 'skipped' ? '已跳过' : '待确认'))}</span></div>
    <details class="sketch-tile-editor"><summary>构图约束与操作</summary><div class="form-grid">
        <label class="field full"><span>构图约束</span><textarea class="textarea" rows="4" data-sketch-notes placeholder="确认主体数量、站位、景别、视线和运动方向。" ${disabled}>${escapeHtml(sketch.composition_notes || '')}</textarea></label>
        <div class="field full sketch-action-bar">
          <input class="hidden-input" type="file" accept="image/png,image/jpeg,image/webp" data-sketch-file>
          <div class="sketch-actions" role="group" aria-label="镜头 ${shotIndex} 线稿操作">
            <button class="btn ${sketch.image_url ? '' : 'primary'}" type="button" data-generate-sketch ${disabled}>${sketch.image_url ? '重新生成' : '生成线稿'}</button>
            <button class="btn" type="button" data-upload-sketch ${disabled}>上传线稿</button>
            <button class="btn quiet" type="button" data-skip-sketch ${disabled}>跳过本镜</button>
            <button class="btn primary sketch-confirm-action" type="button" data-confirm-sketch ${disabled}>确认构图</button>
          </div>
        </div>
      </div></details>
  </article>`;
}

function sketchBatchMarkup(batch = null, total = 0) {
  if (!batch || typeof batch !== 'object') return '';
  const status = String(batch.status || '');
  const active = ['queued', 'running'].includes(status);
  const requested = Math.max(0, Number(batch.requested || total) || 0);
  const completed = Math.max(0, Math.min(requested, Number(batch.completed || 0) || 0));
  const percent = requested ? Math.round((completed / requested) * 100) : 100;
  const title = status === 'failed' ? '线稿批次已停止' : (status === 'succeeded' ? '线稿批次已完成' : '正在批量生成线稿');
  return `<div class="sketch-batch-progress is-${escapeHtml(status)}" role="status" aria-live="polite">
    <div class="sketch-batch-progress-head"><b>${title}</b><span>${completed}/${requested} · ${percent}%</span></div>
    ${active ? `<div class="project-progress-track" aria-hidden="true"><i style="width:${percent}%"></i></div>` : ''}
    <small>${escapeHtml(batch.message || '')}</small>
  </div>`;
}

export async function mount(host, context) {
  if (context.route?.params?.get('stage') === 'shot') {
    const shotDesigner = await import('./shotDesignerView.js?v=20260813-ui-v238');
    return shotDesigner.mount(host, context);
  }
  const { bundle, store } = context;
  const shots = Array.isArray(bundle?.storyboard?.shots) ? bundle.storyboard.shots : [];
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(shots.length / pageSize));
  const requestedPage = Math.max(1, Number(context.route?.params?.get('page')) || 1);
  const page = Math.min(pageCount, requestedPage);
  const pageStart = (page - 1) * pageSize;
  const visibleShots = shots.slice(pageStart, pageStart + pageSize);
  const pageNav = shots.length > pageSize ? `<nav class="storyboard-pagination" aria-label="分镜分页"><span>第 ${page}/${pageCount} 页 · 共 ${shots.length} 镜</span><button class="btn small" type="button" data-storyboard-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button><button class="btn small" type="button" data-storyboard-page="${page + 1}" ${page >= pageCount ? 'disabled' : ''}>下一页</button></nav>` : '';
  const isReferenceDraft = bundle?.storyboard?.source === 'reference_analysis_projection';
  const sketches = Array.isArray(bundle?.storyboard?.sketches) ? bundle.storyboard.sketches : [];
  const sketchByShot = new Map(sketches.map(item => [Number(item.shot_index), item]));
  const generatedSketchCount = shots.filter((shot, index) => sketchByShot.get(Number(shot.shot_index || shot.index || index + 1))?.image_url).length;
  const resolvedSketchCount = shots.filter((shot, index) => ['confirmed', 'skipped'].includes(sketchByShot.get(Number(shot.shot_index || shot.index || index + 1))?.status)).length;
  const missingSketchCount = Math.max(0, shots.length - generatedSketchCount);
  const regenerateAllSketches = missingSketchCount === 0 && generatedSketchCount > 0;
  const sketchBatchTargetCount = regenerateAllSketches ? shots.length : missingSketchCount;
  const sketchGate = bundle?.storyboard?.sketch_gate || { ready: false, reason: '文字分镜状态尚未核对，请刷新页面。', issues: [] };
  let sketchBatch = bundle?.storyboard?.sketch_batch || null;
  const sketchBatchActive = ['queued', 'running'].includes(String(sketchBatch?.status || ''));
  host.innerHTML = `
    <section class="view-head">
      <div><h1>分镜台</h1><p>文字分镜决定剧情和动作；线稿只确认构图与衔接，不直接生成付费视频。</p>${isReferenceDraft ? '<span class="status-tag is-neutral">参考视频逐镜草稿 · 待优化</span>' : ''}</div>
      <div class="view-actions">${shots.length ? (isReferenceDraft
        ? '<button class="btn primary" type="button" data-save-reference-storyboard>保存参考分镜草稿</button>'
        : `<button class="btn" type="button" data-regenerate-storyboard>批量重生成文字分镜</button><button class="btn primary" type="button" ${sketchGate.ready ? (resolvedSketchCount >= shots.length ? 'data-open-shot-design' : 'data-open-sketches') : 'disabled'}>${sketchGate.ready ? (resolvedSketchCount >= shots.length ? '进入镜头设计' : '下一步：线稿分镜') : '文字分镜审核未通过'}</button>`)
        : '<button class="btn primary" type="button" data-generate-storyboard>生成文字分镜</button>'}</div>
    </section>
    <div class="guide ${!isReferenceDraft && !sketchGate.ready ? 'is-danger' : ''}">${isReferenceDraft ? '这里仅显示参考视频提取的逐镜草稿。可逐镜打开编辑，确认剧情、动作和时长；机位、景别和运镜在镜头设计中继续优化。' : (sketchGate.ready ? '线稿可逐镜生成、上传或跳过；确认后构图约束会写入现有分镜并使关键帧合同按版本重建。' : `线稿已锁定：${escapeHtml(sketchGate.reason || '文字分镜审核通过后才能继续。')} 请先修改或重新生成文字分镜。`)}</div>
    <div class="tabs">
      <button class="tab active" type="button" role="tab" aria-selected="true" data-board-tab="shots">文字分镜 ${shots.length}</button>
      <button class="tab" type="button" role="tab" aria-selected="false" data-board-tab="sketches" ${sketchGate.ready ? '' : 'disabled'}>线稿分镜 ${generatedSketchCount}/${shots.length}</button>
    </div>
    <section data-board-panel="shots">
      ${shots.length ? `<div class="card shot-table">
        <div class="shot-row header"><span>镜头</span><span>剧情与动作</span><span>旁白 / 台词</span><span>绑定资产</span><span>操作</span></div>
        ${visibleShots.map((shot, index) => shotRow(shot, pageStart + index, bundle)).join('')}
      </div>${pageNav}` : `<div class="card">${emptyState({
        title: '还没有文字分镜',
        body: '先确认剧情蓝图，再生成与剧情情节点一一对应的镜头。',
        action: '生成文字分镜',
        actionId: 'generate-storyboard',
      })}</div>`}
    </section>
    <section data-board-panel="sketches" hidden>
      ${shots.length ? `<div class="storyboard-stage-bar"><div><b>第二步 · 线稿分镜</b><span>${sketchGate.ready ? `文字分镜已审核通过 ${shots.length} 镜；当前线稿 ${generatedSketchCount}/${shots.length}，确认或跳过 ${resolvedSketchCount}/${shots.length}。` : escapeHtml(sketchGate.reason || '文字分镜审核通过后才能生成线稿。')}</span></div>${missingSketchCount ? `<button class="btn primary" type="button" data-generate-sketch-batch ${sketchBatchActive || !sketchGate.ready ? 'disabled' : ''}>${sketchBatchActive ? '线稿批次生成中' : `批量生成全部缺失线稿（${missingSketchCount}）`}</button>` : `<div class="storyboard-stage-actions"><span class="status-tag is-success">线稿已全部生成</span><button class="btn" type="button" data-generate-sketch-batch data-regenerate-all="true" ${sketchBatchActive || !sketchGate.ready ? 'disabled' : ''}>${sketchBatchActive ? '线稿批次生成中' : `批量重生成全部线稿（${shots.length}）`}</button></div>`}</div>` : ''}
      <div data-sketch-batch-host>${sketchBatchMarkup(sketchBatch, missingSketchCount || generatedSketchCount)}</div>
      ${shots.length ? `<div class="storyboard-sketch-grid">${visibleShots.map((shot, index) => sketchCard(shot, sketchByShot.get(Number(shot.shot_index || shot.index || pageStart + index + 1)) || {}, pageStart + index, sketchGate)).join('')}</div>${pageNav}` : `<div class="card">${emptyState({ title: '没有可确认的镜头', body: '生成文字分镜后再处理线稿。' })}</div>`}
    </section>`;

  bindMediaLightbox(host);

  host.querySelectorAll('[data-board-tab]').forEach(button => {
    button.addEventListener('click', () => {
      host.querySelectorAll('[data-board-tab]').forEach(item => item.classList.toggle('active', item === button));
      host.querySelectorAll('[data-board-tab]').forEach(item => item.setAttribute('aria-selected', String(item === button)));
      host.querySelectorAll('[data-board-panel]').forEach(panel => { panel.hidden = panel.dataset.boardPanel !== button.dataset.boardTab; });
    });
  });
  if (sketchBatchActive) host.querySelector('[data-board-tab="sketches"]')?.click();
  host.querySelectorAll('[data-storyboard-page]').forEach(button => button.addEventListener('click', () => {
    const targetPage = Math.max(1, Math.min(pageCount, Number(button.dataset.storyboardPage) || 1));
    context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=storyboard&page=${targetPage}`);
  }));

  const generateStoryboard = async button => {
    try {
      setButtonBusy(button, true, '正在提交…', { elapsed: true });
      await store.runStage('storyboard');
      toast('文字分镜生成任务已提交，页面顶部会持续显示本次进度、耗时和当前阶段。', 'success');
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  };
  host.querySelector('[data-generate-storyboard]')?.addEventListener('click', event => generateStoryboard(event.currentTarget));
  host.querySelector('[data-empty-action="generate-storyboard"]')?.addEventListener('click', event => generateStoryboard(event.currentTarget));
  host.querySelector('[data-regenerate-storyboard]')?.addEventListener('click', async event => {
    if (!await confirmDialog(`将一次性重新生成 ${shots.length} 镜文字分镜。已手动编辑的内容可能被新版覆盖，旧线稿和下游结果会按版本失效。`, {
      title: '批量重生成文字分镜', confirmText: '确认批量生成',
    })) return;
    await generateStoryboard(event.currentTarget);
  });
  host.querySelector('[data-open-sketches]')?.addEventListener('click', () => host.querySelector('[data-board-tab="sketches"]')?.click());
  host.querySelector('[data-save-reference-storyboard]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, '保存中…');
      const confirmed = shots.map(shot => ({
        ...shot,
        source: shot.source === 'reference_analysis_projection' ? 'user_confirmed_reference' : shot.source,
        projection_only: false,
      }));
      await store.saveStoryboard(confirmed);
      toast('参考视频分镜草稿已保存，可继续逐镜优化。', 'success');
      await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  });
  host.querySelector('[data-open-shot-design]')?.addEventListener('click', () => context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=storyboard&stage=shot`));
  let disposed = false;
  let sketchBatchPollTimer = null;
  let batchFinalizing = false;
  const batchButton = host.querySelector('[data-generate-sketch-batch]');
  const batchButtonLabel = () => regenerateAllSketches
    ? `批量重生成全部线稿（${shots.length}）`
    : `批量生成全部缺失线稿（${missingSketchCount}）`;
  const renderSketchBatch = progress => {
    sketchBatch = progress || null;
    const batchHost = host.querySelector('[data-sketch-batch-host]');
    if (batchHost) batchHost.innerHTML = sketchBatchMarkup(sketchBatch, sketchBatchTargetCount || generatedSketchCount);
    const active = ['queued', 'running'].includes(String(sketchBatch?.status || ''));
    if (batchButton) {
      batchButton.disabled = active;
      batchButton.textContent = active ? `线稿生成中 ${sketchBatch.completed || 0}/${sketchBatch.requested || sketchBatchTargetCount}` : batchButtonLabel();
    }
  };
  const finishSketchBatch = async progress => {
    if (batchFinalizing || disposed) return;
    batchFinalizing = true;
    if (sketchBatchPollTimer) clearTimeout(sketchBatchPollTimer);
    renderSketchBatch(progress);
    const failed = progress?.status === 'failed';
    toast(failed ? progress.message : `线稿已完成 ${progress?.completed || 0}/${progress?.requested || 0}，结果显示在下方镜头卡片中。`, failed ? 'danger' : 'success');
    await context.refreshShell();
    document.querySelector('[data-board-tab="sketches"]')?.click();
  };
  const pollSketchBatch = async () => {
    if (disposed || batchFinalizing) return;
    try {
      const data = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sketches/generate-batch`);
      renderSketchBatch(data.progress);
      if (['succeeded', 'failed'].includes(data.progress?.status)) return finishSketchBatch(data.progress);
    } catch {}
    if (!disposed) sketchBatchPollTimer = setTimeout(pollSketchBatch, 1500);
  };
  if (sketchBatchActive) sketchBatchPollTimer = setTimeout(pollSketchBatch, 300);

  batchButton?.addEventListener('click', async event => {
    const regenerateAll = event.currentTarget.dataset.regenerateAll === 'true';
    const targetCount = regenerateAll ? shots.length : missingSketchCount;
    const confirmBody = regenerateAll
      ? `将按已审核通过的文字分镜一次性重新生成 ${targetCount} 张线稿，每镜调用一次 gpt-image-2，并覆盖现有线稿。人物、商品与场景参考图会重新绑定。`
      : `将按文字分镜顺序一次性生成 ${targetCount} 张缺失线稿，每镜调用一次 gpt-image-2。已存在的线稿不会重复生成；失败后重试只补缺失项。`;
    if (!await confirmDialog(confirmBody, {
      title: regenerateAll ? '批量重生成全部线稿' : '批量生成线稿', confirmText: `确认生成 ${targetCount} 张`,
    })) return;
    const button = event.currentTarget;
    try {
      batchFinalizing = false;
      setButtonBusy(button, true, `正在启动 0/${targetCount}…`, { elapsed: true });
      renderSketchBatch({ status: 'running', requested: targetCount, completed: 0, message: '批次已提交，生成结果会逐镜保存到下方镜头卡片。' });
      sketchBatchPollTimer = setTimeout(pollSketchBatch, 500);
      const data = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sketches/generate-batch`, {
        method: 'POST',
        body: { confirmed: true, regenerate_all: regenerateAll, client_request_id: globalThis.crypto?.randomUUID?.() || `${Date.now()}` },
        timeoutMs: 45 * 60 * 1000,
      });
      await finishSketchBatch(data.progress || {
        status: 'succeeded', requested: data.requested, completed: data.completed,
      });
    } catch (error) {
      toast(error.code === 'SKETCH_BATCH_IN_PROGRESS' ? '已连接正在执行的线稿批次。' : error.message, error.code === 'SKETCH_BATCH_IN_PROGRESS' ? 'warning' : 'danger');
      sketchBatchPollTimer = setTimeout(pollSketchBatch, 100);
    } finally {
      if (!disposed && !['queued', 'running'].includes(String(sketchBatch?.status || ''))) setButtonBusy(button, false);
    }
  });
  const closeInlineEditor = row => {
    const editor = row?.querySelector('[data-shot-inline-editor]');
    const button = row?.querySelector('[data-edit-shot]');
    if (editor) editor.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  };
  host.querySelectorAll('[data-edit-shot]').forEach(button => button.addEventListener('click', () => {
    const row = button.closest('[data-storyboard-shot]');
    const editor = row?.querySelector('[data-shot-inline-editor]');
    if (!editor) return;
    const opening = editor.hidden;
    host.querySelectorAll('[data-storyboard-shot]').forEach(closeInlineEditor);
    editor.hidden = !opening;
    button.setAttribute('aria-expanded', String(opening));
    if (opening) editor.querySelector('input, textarea')?.focus();
  }));
  host.querySelectorAll('[data-cancel-inline-shot]').forEach(button => button.addEventListener('click', () => closeInlineEditor(button.closest('[data-storyboard-shot]'))));
  host.querySelectorAll('[data-shot-inline-editor]').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    const shotIndex = Number(form.dataset.shotInlineEditor);
    const sourceIndex = shots.findIndex((shot, index) => Number(shot.shot_index || shot.index || index + 1) === shotIndex);
    if (sourceIndex < 0) return;
    const data = new FormData(form);
    const current = shots[sourceIndex];
    const visual = String(data.get('visual') || '').trim();
    const action = String(data.get('action') || '').trim();
    const voiceover = String(data.get('voiceover') || '').trim();
    const next = shots.map((shot, index) => index === sourceIndex ? {
      ...shot,
      title: String(data.get('title') || '').trim() || current.title || `镜头 ${shotIndex}`,
      duration: Math.max(1, Math.min(15, Number(data.get('duration')) || 3)),
      duration_sec: Math.max(1, Math.min(15, Number(data.get('duration')) || 3)),
      visual,
      visual_description: visual,
      action,
      visual_action: action,
      voiceover,
      narration: voiceover,
      _nsa_user_edited_fields: { ...(shot._nsa_user_edited_fields || {}), title: true, duration: true, visual: true, action: true, voiceover: true },
    } : shot);
    const button = form.querySelector('[data-save-inline-shot]');
    try {
      setButtonBusy(button, true, '保存中…');
      await store.saveStoryboard(next);
      toast(`分镜 ${shotIndex} 已保存，旧关键帧和视频会按新版本失效。`, 'success');
      await context.refreshShell();
    } catch (error) {
      setButtonBusy(button, false);
      toast(error.message, 'danger');
    }
  }));

  async function saveSketch(card, patch) {
    const shotIndex = Number(card.dataset.sketchShot);
    const current = sketchByShot.get(shotIndex) || { id: `storyboard-sketch-${shotIndex}`, shot_index: shotIndex, status: 'draft' };
    const next = {
      ...current,
      ...patch,
      shot_index: shotIndex,
      composition_notes: card.querySelector('[data-sketch-notes]')?.value?.trim() || patch.composition_notes || current.composition_notes || '',
    };
    sketchByShot.set(shotIndex, next);
    await store.saveSketches([...sketchByShot.values()]);
    await context.refreshShell();
  }

  host.querySelectorAll('[data-sketch-shot]').forEach(card => {
    const shotIndex = Number(card.dataset.sketchShot);
    card.querySelector('[data-upload-sketch]').addEventListener('click', () => card.querySelector('[data-sketch-file]').click());
    card.querySelector('[data-sketch-file]').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const uploaded = await store.upload(file, 'storyboard_sketch');
        const asset = uploaded.asset || uploaded.data;
        await saveSketch(card, { status: 'draft', image_url: asset.image_url || asset.url || '', source: 'upload' });
        toast('线稿已上传。', 'success');
      } catch (error) {
        toast(error.message, 'danger');
      }
    });
    card.querySelector('[data-skip-sketch]').addEventListener('click', async () => {
      try {
        await saveSketch(card, { status: 'skipped' });
        toast(`镜头 ${shotIndex} 已跳过线稿。`, 'success');
      } catch (error) { toast(error.message, 'danger'); }
    });
    card.querySelector('[data-confirm-sketch]').addEventListener('click', async event => {
      const button = event.currentTarget;
      try {
        setButtonBusy(button, true, '确认中…');
        await saveSketch(card, { status: 'confirmed' });
        toast(`镜头 ${shotIndex} 构图已确认。`, 'success');
      } catch (error) {
        toast(error.message, 'danger');
      } finally {
        setButtonBusy(button, false);
      }
    });
    card.querySelector('[data-generate-sketch]').addEventListener('click', async event => {
      if (!await confirmDialog(`将为镜头 ${shotIndex} 调用一次图片生成，用于低成本线稿确认。`, {
        title: '生成镜头线稿',
        confirmText: '确认生成',
      })) return;
      const button = event.currentTarget;
      try {
        setButtonBusy(button, true, '生成中…', { elapsed: true });
        const data = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sketches/${shotIndex}/generate`, {
          method: 'POST',
          body: { confirmed: true },
          timeoutMs: 360000,
        });
        sketchByShot.set(shotIndex, data.sketch);
        toast(`镜头 ${shotIndex} 线稿已生成。`, 'success');
        await context.refreshShell();
      } catch (error) {
        toast(error.message, 'danger');
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
  return () => {
    disposed = true;
    if (sketchBatchPollTimer) clearTimeout(sketchBatchPollTimer);
  };
}
