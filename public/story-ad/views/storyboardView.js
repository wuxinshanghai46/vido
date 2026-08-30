import { request } from '../api.js?v=20260830-production-v307';
import { elapsedTimeTag, emptyState, escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js?v=20260830-production-v307';
import { bindMediaLightbox } from './mediaLightbox.js?v=20260830-production-v307';
import { bindGenerationModelPicker, loadGenerationModelPicker } from './generationModelPicker.js?v=20260830-production-v307';
import { generationModelPickerPlaceholder } from './generationModelPlaceholder.js?v=20260830-production-v307';

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
  const lookId = String(shot.look_id || Object.values(shot.look_bindings || {})[0] || '');
  const lookOwner = (assets.people || []).map(item => item.profile || {}).find(profile => (
    (profile.look_profiles || []).some(look => String(look.id || '') === lookId)
  ));
  const look = (lookOwner?.look_profiles || []).find(item => String(item.id || '') === lookId);
  return [
    shot.source_beat_id ? { id: shot.source_beat_id, label: `剧情：${shot.source_beat_id}` } : null,
    sceneId ? { id: sceneId, label: `场景：${scene?.name || shot.scene_name || '已绑定场景'} · r${Number(shot.scene_revision || scene?.revision || 1)}` } : null,
    cameraId ? { id: cameraId, label: `机位：${camera?.label || camera?.role || '已绑定机位'}` } : null,
    lookId ? { id: lookId, label: `造型：${lookOwner?.displayName || lookOwner?.name || '人物'} · ${look?.name || '未知造型'}` } : null,
    ...characterIds.map(id => {
      const subject = subjects.find(entry => [entry.item.id, entry.item.asset_id, entry.item.subject_id].filter(Boolean).includes(id));
      return { id, label: `${subject?.label || '主体'}：${subject?.item?.name || subject?.item?.role || '已绑定主体'} · r${Number(subject?.item?.revision || 0)}` };
    }),
    shot.sound_profile_id ? { id: shot.sound_profile_id, label: `声音档案：${shot.sound_profile_id}` } : null,
  ].filter(Boolean);
}

function compactBindingSummary(bundle = {}, shot = {}) {
  const bindings = friendlyBindings(bundle, shot)
    .map(item => item.label)
    .filter(label => /^(人物|动物|场景)：/.test(label))
    .map(label => label.replace(/ · r\d+$/u, ''));
  return bindings.length ? bindings.join(' · ') : '人物与场景由系统自动匹配';
}

function sceneSequenceMarkup(bundle = {}, shots = []) {
  const scenes = Array.isArray(bundle?.assets?.scenes) ? bundle.assets.scenes : [];
  const groups = [];
  shots.forEach((shot, index) => {
    const sceneId = String(shot.scene_id || shot.scene_asset_id || '');
    const scene = scenes.find(item => [item.id, item.asset_id, item.scene_id].filter(Boolean).map(String).includes(sceneId));
    const previous = groups[groups.length - 1];
    if (previous?.sceneId === sceneId) previous.count += 1;
    else groups.push({
      sceneId,
      name: scene?.name || shot.scene_name || `场景 ${groups.length + 1}`,
      count: 1,
      start: index + 1,
      reason: shot.transition_reason || scene?.story_purpose || shot.purpose || '',
    });
  });
  if (!groups.length) return '';
  const nodes = groups.map((group, index) => {
    const shotRange = `SH${String(group.start).padStart(2, '0')} 起 · ${group.count} 镜`;
    const reason = String(group.reason || '').trim();
    const tooltip = reason ? `剧情依据：${reason}` : `${group.name} · ${shotRange}`;
    return `<li title="${escapeHtml(tooltip)}" aria-label="${escapeHtml(`${group.name}，${shotRange}${reason ? `，剧情依据：${reason}` : ''}`)}"><span>${index + 1}</span><div><b>${escapeHtml(group.name)}</b><small>${shotRange}</small>${reason ? `<p>${escapeHtml(reason)}</p>` : ''}</div></li>`;
  }).join('');
  return `<section class="storyboard-scene-sequence" aria-label="分镜场景顺序"><div><b>场景顺序</b><span title="系统已按剧情固定地点；切换发生在相邻场景节点之间">按剧情固定地点</span></div><ol>${nodes}</ol></section>`;
}

function sketchCard(shot, sketch = {}, index = 0, gate = {}, bundle = {}, generationActive = false, needsGeneration = false) {
  const shotIndex = Number(shot.shot_index || shot.index || index + 1) || index + 1;
  const disabled = gate.ready === false ? 'disabled' : '';
  const imageReady = Boolean(sketch.image_url || sketch.imageUrl || sketch.url);
  const waiting = generationActive && (!imageReady || needsGeneration);
  return `<article class="card sketch-card sketch-tile ${gate.ready === false ? 'is-gated' : ''} ${waiting ? 'is-waiting' : ''}" data-sketch-shot="${shotIndex}"${waiting ? ' aria-busy="true"' : ''}>
    <div class="sketch-tile-media" data-sketch-image-host="${shotIndex}">${mediaPreview(sketch, { label: `SH${String(shotIndex).padStart(2, '0')} · ${shot.title || `镜头 ${shotIndex}`}`, width: 960, symbol: '分镜图', zoomable: true, zoomGroup: 'storyboard-images' })}<span class="sketch-shot-number">SH${String(shotIndex).padStart(2, '0')}</span></div>
    <div class="sketch-tile-copy"><div><h2>${escapeHtml(shot.title || `镜头 ${shotIndex}`)}</h2><p>${escapeHtml(compactBindingSummary(bundle, shot))}</p></div></div>
    <details class="sketch-tile-editor"><summary>调整</summary><div class="sketch-action-bar">
      <input class="hidden-input" type="file" accept="image/png,image/jpeg,image/webp" data-sketch-file>
      <div class="sketch-actions" role="group" aria-label="镜头 ${shotIndex} 分镜图调整">
        <button class="btn ${sketch.image_url ? '' : 'primary'}" type="button" data-generate-sketch ${disabled}>${sketch.image_url ? '重新生成本镜' : '生成本镜'}</button>
        <button class="btn" type="button" data-upload-sketch ${disabled}>上传替换</button>
      </div>
    </div></details>
  </article>`;
}

function checkpointShotCard(shot, index = 0, bundle = {}) {
  const shotIndex = Number(shot.shot_index || shot.index || index + 1) || index + 1;
  return `<article class="card sketch-card sketch-tile is-checkpoint" data-checkpoint-shot="${shotIndex}">
    <div class="sketch-tile-media"><div class="media-placeholder"><span>镜头结构已保存</span></div><span class="sketch-shot-number">SH${String(shotIndex).padStart(2, '0')}</span></div>
    <div class="sketch-tile-copy"><div><h2>${escapeHtml(shot.title || `镜头 ${shotIndex}`)}</h2><p>${escapeHtml(compactBindingSummary(bundle, shot))}</p></div><span class="status-tag is-neutral">待出图</span></div>
  </article>`;
}

function liveGenerationShotCard(shot, sketch = {}, index = 0, bundle = {}) {
  const shotIndex = Number(shot.shot_index || shot.index || index + 1) || index + 1;
  const ready = Boolean(sketch.image_url || sketch.imageUrl || sketch.url);
  return `<article class="card sketch-card sketch-tile is-live-generation ${ready ? '' : 'is-waiting'}"${ready ? '' : ' aria-busy="true"'}>
    <div class="sketch-tile-media">${mediaPreview(sketch, { label: `SH${String(shotIndex).padStart(2, '0')} · ${shot.title || `镜头 ${shotIndex}`}`, width: 960, symbol: ready ? '分镜图' : '等待出图', zoomable: ready, zoomGroup: 'storyboard-images' })}<span class="sketch-shot-number">SH${String(shotIndex).padStart(2, '0')}</span></div>
    <div class="sketch-tile-copy"><div><h2>${escapeHtml(shot.title || `镜头 ${shotIndex}`)}</h2><p>${escapeHtml(compactBindingSummary(bundle, shot))}</p></div><span class="status-tag ${ready ? 'is-ready' : 'is-neutral'}">${ready ? '已完成' : '生成中'}</span></div>
  </article>`;
}

function sketchBatchMarkup(batch = null, total = 0) {
  if (!batch || typeof batch !== 'object') return '';
  const status = String(batch.status || '');
  const active = ['queued', 'running'].includes(status);
  const requested = Math.max(0, Number(batch.requested || total) || 0);
  const processed = Math.max(0, Math.min(requested, Number(batch.processed ?? batch.completed ?? 0) || 0));
  const succeeded = Math.max(0, Math.min(processed, Number(batch.succeeded ?? batch.completed ?? 0) || 0));
  const failed = Math.max(0, processed - succeeded);
  const percent = requested ? Math.round((processed / requested) * 100) : 100;
  const indeterminate = active && (status === 'queued' || percent === 0);
  const title = status === 'failed' ? '分镜生成已停止' : (status === 'succeeded' ? '分镜生成已完成' : '正在生成分镜');
  return `<div class="sketch-batch-progress is-${escapeHtml(status)} ${indeterminate ? 'is-indeterminate' : ''}" role="${status === 'failed' ? 'alert' : 'status'}" aria-live="polite">
    <div class="sketch-batch-progress-head"><b>${title}</b><span>已完成 ${processed}/${requested}${failed ? ` · ${failed} 镜需重试` : ''} · ${percent}%</span></div>
    ${active ? `<div class="project-progress-track ${indeterminate ? 'is-indeterminate' : ''}" aria-hidden="true"><i style="width:${percent}%"></i></div>` : ''}
    <small>${status === 'failed' ? '已完成的画面会保留；再次继续只处理未完成镜头。' : (active ? '人物与场景正在自动匹配，完成的画面会逐镜显示。' : '所有画面已保存。')} ${elapsedTimeTag({ startedAt: batch.started_at, finishedAt: batch.finished_at, active })}</small>
  </div>`;
}

function progressPhaseLabel(progress = {}, failed = false) {
  if (failed) return '镜头结构生成已停止';
  const phase = String(progress.phase || '').toLowerCase();
  if (phase.includes('rewrite')) return '正在修正镜头结构';
  if (phase === 'reviewing') return '正在核对镜头与剧情';
  if (phase === 'preparing' || phase === '正在提交') return '正在启动分镜生成';
  return '正在生成镜头结构';
}

function storyboardProgressMarkup({ batch = null, progress = {}, active = false, failed = false, completed = 0, total = 0, startedAt = '', finishedAt = '' } = {}) {
  if (batch && typeof batch === 'object') return sketchBatchMarkup(batch, total);
  if (!active && !failed) return '';
  const requested = Math.max(1, Number(total) || 1);
  const processed = Math.max(0, Math.min(requested, Number(completed) || 0));
  const reportedPercent = Number(progress.percent);
  const percent = Number.isFinite(reportedPercent)
    ? Math.max(0, Math.min(100, Math.round(reportedPercent)))
    : Math.round((processed / requested) * 100);
  const indeterminate = active && percent === 0;
  const phaseTitle = progressPhaseLabel(progress, failed);
  return `<div class="sketch-batch-progress is-${failed ? 'failed' : 'running'} ${indeterminate ? 'is-indeterminate' : ''}" role="${failed ? 'alert' : 'status'}" aria-live="polite">
    <div class="sketch-batch-progress-head"><b>${phaseTitle}</b><span>已完成 ${processed}/${requested} · ${percent}%</span></div>
    ${active ? `<div class="project-progress-track ${indeterminate ? 'is-indeterminate' : ''}" aria-hidden="true"><i style="width:${percent}%"></i></div>` : ''}
    <small>${failed ? '已完成的镜头结构会保留；分镜图片尚未开始，继续后只处理未完成镜头。' : '系统正在按剧情核对人物、场景、机位和站位；已完成的镜头结构会立即显示。'} ${elapsedTimeTag({ startedAt, finishedAt, active })}</small>
  </div>`;
}

export async function mount(host, context) {
  if (context.route?.params?.get('stage') === 'shot') {
    const shotDesigner = await import('./shotDesignerView.js?v=20260830-production-v307');
    return shotDesigner.mount(host, context);
  }
  const { bundle, store } = context;
  const shots = Array.isArray(bundle?.storyboard?.shots) ? bundle.storyboard.shots : [];
  const checkpointShots = Array.isArray(bundle?.storyboard?.partial_shots) ? bundle.storyboard.partial_shots : [];
  const displayShots = shots.length ? shots : checkpointShots;
  const checkpointTotal = Math.max(checkpointShots.length, Number(bundle?.storyboard?.checkpoint?.total || bundle?.storyboard?.status?.checkpoint_total || 0));
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(displayShots.length / pageSize));
  const requestedPage = Math.max(1, Number(context.route?.params?.get('page')) || 1);
  const page = Math.min(pageCount, requestedPage);
  const pageStart = (page - 1) * pageSize;
  const visibleShots = displayShots.slice(pageStart, pageStart + pageSize);
  const pageNav = displayShots.length > pageSize ? `<nav class="storyboard-pagination" aria-label="分镜分页"><span>第 ${page}/${pageCount} 页 · 共 ${displayShots.length} 镜</span><button class="btn small" type="button" data-storyboard-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button><button class="btn small" type="button" data-storyboard-page="${page + 1}" ${page >= pageCount ? 'disabled' : ''}>下一页</button></nav>` : '';
  const isReferenceDraft = bundle?.storyboard?.source === 'reference_analysis_projection';
  const sketches = Array.isArray(bundle?.storyboard?.images) ? bundle.storyboard.images : [];
  const sketchByShot = new Map(sketches.map(item => [Number(item.shot_index), item]));
  const generatedSketchCount = shots.filter((shot, index) => sketchByShot.get(Number(shot.shot_index || shot.index || index + 1))?.image_url).length;
  const imageGate = bundle?.storyboard?.image_gate || null;
  const pendingSketchIndexes = new Set([
    ...(Array.isArray(imageGate?.missing_indexes) ? imageGate.missing_indexes : []),
    ...(Array.isArray(imageGate?.stale_indexes) ? imageGate.stale_indexes : []),
  ].map(Number));
  const staleSketchIndexes = Array.isArray(imageGate?.stale_indexes) ? imageGate.stale_indexes.map(Number) : [];
  const validSketchCount = imageGate && Number(imageGate.total) === shots.length
    ? Math.max(0, Number(imageGate.confirmed || 0) || 0)
    : generatedSketchCount;
  const missingSketchCount = Math.max(0, shots.length - validSketchCount);
  const regenerateAllSketches = missingSketchCount === 0 && generatedSketchCount > 0;
  const sketchBatchTargetCount = regenerateAllSketches ? shots.length : missingSketchCount;
  const sketchGate = bundle?.storyboard?.sketch_gate || { ready: false, reason: '镜头结构状态尚未核对，请刷新页面。', issues: [] };
  const completedHistorical = Boolean(
    bundle?.project?.final_video_url
    || bundle?.generation?.final_video?.video_url
    || bundle?.navigation?.steps?.final?.completed === true,
  );
  let sketchBatch = bundle?.storyboard?.image_batch || null;
  const sketchBatchActive = ['queued', 'running'].includes(String(sketchBatch?.status || ''));
  const storyboardActive = bundle?.project?.active_stage === 'storyboard' && !!bundle?.project?.active_generation_id;
  let sketchModelPicker = storyboardActive
    ? { taskId: bundle.project.id, stage: 'new_story_ad.storyboard_image', selected: '', html: '' }
    : generationModelPickerPlaceholder(bundle.project.id, 'new_story_ad.storyboard_image', { label: '分镜模型' });
  const storyboardFailed = !shots.length && !storyboardActive
    && String(bundle?.project?.status || '').toLowerCase() === 'failed'
    && String(bundle?.project?.stage || '').toLowerCase().includes('storyboard');
  const gateBlocked = shots.length > 0 && !sketchGate.ready && !completedHistorical && !isReferenceDraft && !sketchBatchActive;
  const mainSketchAction = shots.length
    ? (gateBlocked
      ? `<button class="btn primary" type="button" data-prepare-storyboard-sketch ${storyboardActive ? 'disabled' : ''}>${storyboardActive ? '正在生成分镜…' : '重新生成分镜'}</button>`
      : (missingSketchCount
      ? `<button class="btn primary" type="button" data-generate-sketch-batch ${sketchBatchActive || !sketchGate.ready ? 'disabled' : ''}>${sketchBatchActive ? '分镜生成中' : `继续生成分镜（${missingSketchCount}）`}</button>`
      : `<button class="btn" type="button" data-generate-sketch-batch data-regenerate-all="true" ${sketchBatchActive || !sketchGate.ready ? 'disabled' : ''}>${sketchBatchActive ? '分镜生成中' : `全部重新生成（${shots.length}）`}</button>`))
    : `<button class="btn primary" type="button" data-prepare-storyboard-sketch ${storyboardActive ? 'disabled' : ''}>${storyboardActive ? '正在生成分镜…' : (checkpointShots.length ? '继续生成分镜' : '生成分镜')}</button>`;
  const headerAction = isReferenceDraft
    ? '<button class="btn primary" type="button" data-save-reference-storyboard>保存参考分镜草稿</button>'
    : (completedHistorical && !sketchGate.ready
      ? '<span class="status-tag is-neutral">历史完成内容 · 只读</span>'
      : '');
  const primaryAction = !isReferenceDraft && !(completedHistorical && !sketchGate.ready)
    ? `${sketchModelPicker.html}${mainSketchAction}`
    : '';
  host.innerHTML = `
    <div class="storyboard-simple-view">
      <section class="view-head storyboard-view-head">
        <div><h1>人物场景分镜</h1><p>${isReferenceDraft ? '保存参考视频提取的分镜草稿后，系统会继续自动匹配人物与场景。' : '系统会根据已确认的剧情自动匹配人物与场景，直接生成分镜画面。'}</p></div>
        ${headerAction ? `<div class="view-actions">${headerAction}</div>` : ''}
      </section>
      ${primaryAction ? `<div class="storyboard-primary-actions">${primaryAction}</div>` : ''}
      ${sceneSequenceMarkup(bundle, displayShots)}
      ${staleSketchIndexes.length ? `<div class="storyboard-stale-notice" role="status"><b>${staleSketchIndexes.length} 镜需更新</b><span>镜头或场景参考已变化；其他 ${Math.max(0, shots.length - staleSketchIndexes.length)} 镜会保留，继续生成只处理失效镜头。</span></div>` : ''}
      <div data-sketch-batch-host>${storyboardProgressMarkup({
        batch: storyboardActive || (String(sketchBatch?.status || '') === 'succeeded' && missingSketchCount > 0) ? null : sketchBatch,
        progress: bundle?.project?.generation_progress || bundle?.generation?.progress || {},
        active: storyboardActive || sketchBatchActive,
        failed: storyboardFailed || gateBlocked,
        completed: shots.length ? validSketchCount : checkpointShots.length,
        total: shots.length || checkpointTotal || 1,
        startedAt: bundle?.project?.generation_progress?.started_at || bundle?.project?.generation_started_at || '',
        finishedAt: bundle?.project?.generation_progress?.finished_at || '',
      })}</div>
      <div data-storyboard-live-results>${displayShots.length ? `<div class="storyboard-sketch-grid">${visibleShots.map((shot, index) => shots.length
        ? sketchCard(shot, sketchByShot.get(Number(shot.shot_index || shot.index || pageStart + index + 1)) || {}, pageStart + index, sketchGate, bundle, sketchBatchActive, pendingSketchIndexes.has(Number(shot.shot_index || shot.index || pageStart + index + 1)))
        : checkpointShotCard(shot, pageStart + index, bundle)).join('')}</div>${pageNav}` : `<div class="card storyboard-empty-card">${emptyState({ title: storyboardActive ? '正在生成分镜' : '还没有分镜画面', body: storyboardActive ? '镜头结构保存后会立即显示在这里。' : '选择模型并点击“生成分镜”即可开始。' })}</div>`}</div>
      ${shots.length && missingSketchCount === 0 ? `<div class="storyboard-next-action"><div><b>分镜画面已完成</b><span>确认当前镜头后，可继续进入声音、视频与合成。</span></div><button class="btn primary" type="button" data-confirm-storyboard>确认分镜，进入视频生成</button></div>` : ''}
    </div>`;

  bindMediaLightbox(host);
  let selectedSketchModel = bindGenerationModelPicker(host, sketchModelPicker);
  if (!storyboardActive) {
    loadGenerationModelPicker(bundle.project.id, 'new_story_ad.storyboard_image', { label: '分镜模型' }).then(loaded => {
      if (!host.isConnected) return;
      const shell = host.querySelector('[data-generation-model-picker="new_story_ad.storyboard_image"]');
      if (!shell) return;
      shell.outerHTML = loaded.html;
      sketchModelPicker = loaded;
      selectedSketchModel = bindGenerationModelPicker(host, loaded);
    }).catch(error => {
      const shell = host.querySelector('[data-generation-model-picker="new_story_ad.storyboard_image"]');
      if (shell) shell.innerHTML = `<span>分镜模型</span><select disabled><option>载入失败</option></select>`;
      toast(`模型列表载入失败：${error.message}`, 'danger');
    });
  }
  const renderStoryboardStageProgress = currentBundle => {
    const project = currentBundle?.project || {};
    const progress = project.generation_progress || currentBundle?.generation?.progress || {};
    const active = project.active_stage === 'storyboard' && !!project.active_generation_id;
    if (!active) return;
    const total = Math.max(1, Number(progress.target_total || progress.total || checkpointTotal || 1));
    const completed = Math.max(0, Number(progress.completed ?? progress.processed ?? checkpointShots.length) || 0);
    const batchHost = host.querySelector('[data-sketch-batch-host]');
    if (batchHost) batchHost.innerHTML = storyboardProgressMarkup({
      progress, active: true, completed, total,
      startedAt: progress.started_at || project.generation_started_at || '',
    });
    if (!shots.length) {
      const formalShots = Array.isArray(currentBundle?.storyboard?.shots) ? currentBundle.storyboard.shots : [];
      const partialShotsNow = Array.isArray(currentBundle?.storyboard?.partial_shots) ? currentBundle.storyboard.partial_shots : [];
      const liveShots = formalShots.length ? formalShots : partialShotsNow;
      const liveImages = Array.isArray(currentBundle?.storyboard?.images) ? currentBundle.storyboard.images : [];
      const liveImageByShot = new Map(liveImages.map(item => [Number(item.shot_index), item]));
      const resultsHost = host.querySelector('[data-storyboard-live-results]');
      if (resultsHost && liveShots.length) {
        resultsHost.innerHTML = `<div class="storyboard-sketch-grid ${formalShots.length ? 'storyboard-live-generation' : 'storyboard-checkpoint-preview'}">${liveShots.map((shot, index) => formalShots.length
          ? liveGenerationShotCard(shot, liveImageByShot.get(Number(shot.shot_index || shot.index || index + 1)) || {}, index, currentBundle)
          : checkpointShotCard(shot, index, currentBundle)).join('')}</div>`;
        bindMediaLightbox(resultsHost);
      }
    }
    const action = host.querySelector('[data-prepare-storyboard-sketch]');
    if (action) { action.disabled = true; action.textContent = '正在整理镜头结构…'; }
  };
  const unsubscribeProgress = store.subscribe?.(state => renderStoryboardStageProgress(state.bundle));

  host.querySelector('[data-confirm-storyboard]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, '正在进入…');
      await store.updateRequest({ shot_design_confirmed: true }, { skipRefresh: true });
      context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=final`);
    } catch (error) {
      toast(error.message, 'danger');
      setButtonBusy(button, false);
    }
  });

  host.querySelectorAll('[data-storyboard-page]').forEach(button => button.addEventListener('click', () => {
    const targetPage = Math.max(1, Math.min(pageCount, Number(button.dataset.storyboardPage) || 1));
    context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=storyboard&page=${targetPage}`);
  }));

  const generateStoryboard = async (button, options = {}) => {
    let accepted = false;
    try {
      setButtonBusy(button, true, '正在提交…');
      const optimisticTotal = Math.max(1, checkpointTotal || bundle?.story_flow?.contract?.units?.length || 1);
      store.beginStageSubmission?.('storyboard', optimisticTotal, checkpointShots.length
        ? `正在继续生成分镜；已完成 ${checkpointShots.length}/${optimisticTotal}，只处理未完成镜头。`
        : '正在启动分镜生成；系统会自动匹配人物与场景。', {
        processed: checkpointShots.length,
        completed: checkpointShots.length,
        current_index: Math.min(optimisticTotal, checkpointShots.length + 1),
      });
      await store.runStage('storyboard', options);
      accepted = true;
      toast('分镜生成已开始，画面会逐镜保存并显示。', 'success');
      return true;
    } catch (error) {
      toast(error.message, 'danger');
      try { await store.refreshSections?.('summary,shots'); } catch {}
      return false;
    } finally {
      if (!accepted) setButtonBusy(button, false);
    }
  };
  host.querySelector('[data-prepare-storyboard-sketch]')?.addEventListener('click', async event => {
    const model = selectedSketchModel();
    if (!model) return toast('请先选择本次分镜生成模型。', 'danger');
    await generateStoryboard(event.currentTarget, {
      generate_images: true,
      confirmed: true,
      user_initiated_direct_generation: true,
      image_model: model,
      client_request_id: globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
    });
  });
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
      toast('参考视频分镜草稿已保存，可继续生成分镜。', 'success');
      await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  });
  let disposed = false;
  let sketchBatchPollTimer = null;
  let batchFinalizing = false;
  const batchButton = host.querySelector('[data-generate-sketch-batch]');
  const batchButtonLabel = () => regenerateAllSketches
    ? `全部重新生成（${shots.length}）`
    : `继续生成分镜（${missingSketchCount}）`;
  const renderSketchBatch = progress => {
    sketchBatch = progress || null;
    const batchHost = host.querySelector('[data-sketch-batch-host]');
    if (batchHost) batchHost.innerHTML = sketchBatchMarkup(sketchBatch, sketchBatchTargetCount || generatedSketchCount);
    const active = ['queued', 'running'].includes(String(sketchBatch?.status || ''));
    host.querySelectorAll('[data-sketch-shot]').forEach(card => {
      const shotIndex = Number(card.dataset.sketchShot || 0);
      const ready = Boolean(sketchByShot.get(shotIndex)?.image_url) && !pendingSketchIndexes.has(shotIndex);
      card.classList.toggle('is-waiting', active && !ready);
      if (active && !ready) card.setAttribute('aria-busy', 'true');
      else card.removeAttribute('aria-busy');
    });
    if (batchButton) {
      batchButton.dataset.processed = String(sketchBatch.processed ?? sketchBatch.completed ?? 0);
      batchButton.disabled = active;
      batchButton.textContent = active ? '生成中' : batchButtonLabel();
    }
  };
  const renderSketchResults = rows => {
    (Array.isArray(rows) ? rows : []).forEach(sketch => {
      const shotIndex = Number(sketch.shot_index || 0);
      if (!shotIndex || !sketch.image_url) return;
      sketchByShot.set(shotIndex, sketch);
      const shot = shots.find((item, index) => Number(item.shot_index || item.index || index + 1) === shotIndex) || {};
      const mediaHost = host.querySelector(`[data-sketch-image-host="${shotIndex}"]`);
      if (!mediaHost) return;
      mediaHost.innerHTML = `${mediaPreview(sketch, { label: `SH${String(shotIndex).padStart(2, '0')} · ${shot.title || `镜头 ${shotIndex}`}`, width: 960, symbol: '分镜图', zoomable: true, zoomGroup: 'storyboard-images' })}<span class="sketch-shot-number">SH${String(shotIndex).padStart(2, '0')}</span>`;
      const card = mediaHost.closest('[data-sketch-shot]');
      pendingSketchIndexes.delete(shotIndex);
      card?.classList.remove('is-waiting');
      card?.removeAttribute('aria-busy');
    });
    bindMediaLightbox(host);
  };
  const finishSketchBatch = async progress => {
    if (batchFinalizing || disposed) return;
    batchFinalizing = true;
    if (sketchBatchPollTimer) clearTimeout(sketchBatchPollTimer);
    renderSketchBatch(progress);
    const failed = progress?.status === 'failed';
    toast(failed ? '分镜生成已停止，已完成的画面会保留。' : `分镜已完成 ${progress?.completed || 0}/${progress?.requested || 0}。`, failed ? 'danger' : 'success');
    await context.refreshShell();
  };
  const pollSketchBatch = async () => {
    if (disposed || batchFinalizing) return;
    try {
      const data = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/storyboard-images/generate-batch`);
      renderSketchBatch(data.progress);
      renderSketchResults(data.sketches);
      if (['succeeded', 'failed'].includes(data.progress?.status)) return finishSketchBatch(data.progress);
    } catch {}
    if (!disposed) sketchBatchPollTimer = setTimeout(pollSketchBatch, 1500);
  };
  if (sketchBatchActive) sketchBatchPollTimer = setTimeout(pollSketchBatch, 300);

  const startSketchBatch = async (button, options = {}) => {
    const regenerateAll = options.regenerateAll === true || button?.dataset.regenerateAll === 'true';
    const targetCount = regenerateAll ? shots.length : missingSketchCount;
    try {
      batchFinalizing = false;
      setButtonBusy(button, true, '正在提交…');
      renderSketchBatch({ status: 'running', requested: targetCount, completed: 0, message: '批次已提交，生成结果会逐镜保存到下方镜头卡片。' });
      sketchBatchPollTimer = setTimeout(pollSketchBatch, 500);
      const data = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/storyboard-images/generate-batch`, {
        method: 'POST',
        body: { confirmed: true, regenerate_all: regenerateAll, image_model: options.imageModel || selectedSketchModel(), client_request_id: options.clientRequestId || globalThis.crypto?.randomUUID?.() || `${Date.now()}` },
        timeoutMs: 45 * 60 * 1000,
      });
      await finishSketchBatch(data.progress || {
        status: 'succeeded', requested: data.requested, completed: data.completed,
      });
    } catch (error) {
      toast(error.code === 'SKETCH_BATCH_IN_PROGRESS' ? '已连接正在执行的分镜图批次。' : error.message, error.code === 'SKETCH_BATCH_IN_PROGRESS' ? 'warning' : 'danger');
      sketchBatchPollTimer = setTimeout(pollSketchBatch, 100);
    } finally {
      if (!disposed && !['queued', 'running'].includes(String(sketchBatch?.status || ''))) setButtonBusy(button, false);
    }
  };
  batchButton?.addEventListener('click', event => startSketchBatch(event.currentTarget));
  async function saveSketch(card, patch) {
    const shotIndex = Number(card.dataset.sketchShot);
    const current = sketchByShot.get(shotIndex) || { id: `storyboard-image-${shotIndex}`, shot_index: shotIndex, status: 'draft' };
    const next = {
      ...current,
      ...patch,
      shot_index: shotIndex,
    };
    sketchByShot.set(shotIndex, next);
    await store.saveStoryboardImages([...sketchByShot.values()]);
    await context.refreshShell();
  }

  host.querySelectorAll('[data-sketch-shot]').forEach(card => {
    const shotIndex = Number(card.dataset.sketchShot);
    card.querySelector('[data-upload-sketch]').addEventListener('click', () => card.querySelector('[data-sketch-file]').click());
    card.querySelector('[data-sketch-file]').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const uploaded = await store.upload(file, 'storyboard_image');
        const asset = uploaded.asset || uploaded.data;
        await saveSketch(card, { status: 'draft', image_url: asset.image_url || asset.url || '', source: 'upload' });
        toast(`镜头 ${shotIndex} 已上传。`, 'success');
      } catch (error) {
        toast(error.message, 'danger');
      }
    });
    card.querySelector('[data-generate-sketch]').addEventListener('click', async event => {
      const button = event.currentTarget;
      try {
        const imageModel = selectedSketchModel();
        if (!imageModel) return toast('请先选择本次分镜生成模型。', 'danger');
        setButtonBusy(button, true, '生成中…', { elapsed: true });
        const data = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/storyboard-images/${shotIndex}/generate`, {
          method: 'POST',
          body: { confirmed: true, image_model: imageModel },
          timeoutMs: 360000,
        });
        sketchByShot.set(shotIndex, data.sketch);
        toast(`镜头 ${shotIndex} 已生成。`, 'success');
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
    unsubscribeProgress?.();
    if (sketchBatchPollTimer) clearTimeout(sketchBatchPollTimer);
  };
}
