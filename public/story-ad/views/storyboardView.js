import { request } from '../api.js?v=20260830-production-v284';
import { elapsedTimeTag, emptyState, escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js?v=20260830-production-v284';
import { bindMediaLightbox } from './mediaLightbox.js?v=20260830-production-v284';
import { bindGenerationModelPicker, loadGenerationModelPicker } from './generationModelPicker.js?v=20260830-production-v284';

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

const SHOT_SIZE_LABELS = Object.freeze({ extreme_wide: '大远景', wide: '全景', full: '全身景', medium: '中景', medium_close: '中近景', close_up: '特写', extreme_close_up: '大特写', macro: '微距' });
const CAMERA_LABELS = Object.freeze({ static: '固定机位', push: '推镜', pull: '拉镜', pan: '摇镜', tilt: '俯仰摇镜', tracking: '跟拍', orbit: '环绕', handheld: '手持' });

const pendingSketches = new Map();

function productionCell(value, fallback = '—') {
  const text = Array.isArray(value) ? value.filter(Boolean).join('、') : String(value || '').trim();
  return escapeHtml(text || fallback);
}

function shotSound(shot = {}) {
  return [shot.ambient_sound, ...(Array.isArray(shot.sfx) ? shot.sfx : []), shot.music_cue].filter(Boolean).join('；');
}

function shotPromptPreview(shot = {}) {
  return [
    shot.visual || shot.visual_description,
    shot.action || shot.visual_action,
    SHOT_SIZE_LABELS[shot.shot_size] || shot.shot_type || shot.shot_size,
    shot.lighting_mood || shot.light_atmosphere || shot.lighting,
    CAMERA_LABELS[shot.camera_movement] || shot.camera_movement,
    shot.keyframe_notes,
  ].filter(Boolean).join('；');
}

function shotSpeechDraft(shot = {}) {
  const mode = String(shot.speech_mode || 'offscreen_voiceover');
  const line = mode === 'on_camera_dialogue'
    ? (shot.dialogue_lines?.[0]?.line || shot.dialogue_lines?.[0]?.text || shot.dialogue || '')
    : (shot.voiceover || shot.narration || '');
  return { mode, line, speakerId: shot.dialogue_lines?.[0]?.speaker_id || shot.speaker_id || '',
    speaker: shot.dialogue_lines?.[0]?.speaker || shot.speaker || '',
    performance: shot.voice_tone || shot.voice_performance || '', timing: shot.voiceover_timing || '' };
}

function shotVoiceEditor(shot = {}, bundle = {}, disabled = '') {
  const draft = shotSpeechDraft(shot);
  const people = Array.isArray(bundle.assets?.people) ? bundle.assets.people : [];
  const options = people.map(item => {
    const profile = item.profile || item;
    const id = profile.id || item.id || '';
    const name = profile.displayName || profile.name || item.name || '人物';
    return `<option value="${escapeHtml(id)}" data-speaker-name="${escapeHtml(name)}" ${String(id) === String(draft.speakerId) || name === draft.speaker ? 'selected' : ''}>${escapeHtml(name)}</option>`;
  }).join('');
  return `<section class="shot-voice-editor" data-shot-voice-editor>
    <div class="shot-voice-editor-head"><div><b>对白与声音表演</b><small>这里的选择会写入配音、口型同步和视频镜头合同，不属于人物外观资产。</small></div><span class="status-tag is-neutral">按镜头设置</span></div>
    <div class="form-grid two">
      <label class="field"><span>声音方式</span><select class="select" data-shot-speech-mode ${disabled}><option value="offscreen_voiceover" ${draft.mode === 'offscreen_voiceover' || draft.mode === 'voiceover' ? 'selected' : ''}>画外旁白（不做口型）</option><option value="on_camera_dialogue" ${['on_camera_dialogue','dialogue','lip_sync'].includes(draft.mode) ? 'selected' : ''}>人物出镜对白（同步口型）</option><option value="silent" ${draft.mode === 'silent' ? 'selected' : ''}>无对白</option></select></label>
      <label class="field"><span>说话人物</span><select class="select" data-shot-speaker ${disabled}><option value="">旁白 / 自动</option>${options}</select></label>
      <label class="field full"><span>实际说出的内容</span><textarea class="textarea" rows="2" data-shot-spoken-line ${disabled}>${escapeHtml(draft.line)}</textarea></label>
      <label class="field full"><span>语气、节奏与停连</span><textarea class="textarea" rows="2" data-shot-voice-performance placeholder="如：克制、语速稍慢；关键词前短暂停顿，句尾自然收住。" ${disabled}>${escapeHtml(draft.performance)}</textarea></label>
      <label class="field full"><span>对白与动作时机</span><input class="input" data-shot-voice-timing value="${escapeHtml(draft.timing)}" placeholder="如：人物抬眼后 0.5 秒开口，最后一个字结束后切镜" ${disabled}></label>
    </div><div class="shot-inline-actions"><button class="btn" type="button" data-save-shot-voice ${disabled}>保存本镜对白设置</button></div>
  </section>`;
}

function shotRow(shot = {}, index = 0, bundle = {}) {
  const shotIndex = Number(shot.shot_index || shot.index || index + 1) || index + 1;
  const bindings = friendlyBindings(bundle, shot);
  const shotSize = SHOT_SIZE_LABELS[shot.shot_size] || shot.shot_type || shot.shot_size;
  const camera = CAMERA_LABELS[shot.camera_movement] || shot.camera_movement;
  const prompt = [shotPromptPreview(shot), bindings.length ? `绑定资产：${bindings.map(item => item.label).join('、')}` : ''].filter(Boolean).join('；');
  return `<div class="shot-row storyboard-complete-row" data-storyboard-shot="${shotIndex}">
    <b>SH${String(shotIndex).padStart(2, '0')}</b>
    <span class="shot-duration">${Number(shot.duration || shot.duration_sec || 3) || 3}s</span>
    <span class="shot-copy"><b>${escapeHtml(shot.title || `镜头 ${shotIndex}`)}</b><small>${escapeHtml(shot.visual || shot.visual_description || shot.action || '')}</small><span class="shot-binding-chips">${bindings.map(item => `<em data-shot-binding-chip title="${escapeHtml(item.id)}">${escapeHtml(item.label)}</em>`).join('')}</span></span>
    <span class="shot-production-cell">${productionCell(shotSize, '待设计')}</span>
    <span class="shot-production-cell">${productionCell(shot.lighting_mood || shot.light_atmosphere || shot.lighting, '随场景光线')}</span>
    <span>${escapeHtml(shot.voiceover || shot.narration || '—')}</span>
    <span class="shot-production-cell">${productionCell(shotSound(shot), '环境原声')}</span>
    <span class="shot-production-cell">${productionCell(camera, '固定机位')}</span>
    <details class="shot-prompt-preview"><summary>查看镜头提示</summary><p>${productionCell(prompt, '确认场景与资产后自动形成')}</p></details>
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

function sketchCard(shot, sketch = {}, index = 0, gate = {}, bundle = {}) {
  const shotIndex = Number(shot.shot_index || shot.index || index + 1) || index + 1;
  const disabled = gate.ready === false ? 'disabled' : '';
  return `<article class="card sketch-card sketch-tile ${gate.ready === false ? 'is-gated' : ''}" data-sketch-shot="${shotIndex}">
    <div class="sketch-tile-media" data-sketch-image-host="${shotIndex}">${mediaPreview(sketch, { label: `SH${String(shotIndex).padStart(2, '0')} · ${shot.title || `镜头 ${shotIndex}`}`, width: 960, symbol: '分镜图', zoomable: true, zoomGroup: 'storyboard-images' })}<span class="sketch-shot-number">SH${String(shotIndex).padStart(2, '0')}</span></div>
    <div class="sketch-tile-copy"><div><h2>${escapeHtml(shot.title || `镜头 ${shotIndex}`)}</h2><p>${escapeHtml(shot.visual || shot.visual_description || shot.action || '')}</p></div><span class="status-tag is-${sketch.status === 'confirmed' ? 'success' : 'neutral'}">${escapeHtml(sketch.status === 'confirmed' ? '已确认' : (sketch.status === 'skipped' ? '已跳过' : '待确认'))}</span></div>
    <details class="sketch-tile-editor"><summary>构图约束与操作</summary><div class="form-grid">
        <label class="field full"><span>构图约束</span><textarea class="textarea" rows="4" data-sketch-notes placeholder="确认主体数量、站位、景别、视线和运动方向。" ${disabled}>${escapeHtml(sketch.composition_notes || '')}</textarea></label>
        <div class="field full">${shotVoiceEditor(shot, bundle, disabled)}</div>
        <div class="field full sketch-action-bar">
          <input class="hidden-input" type="file" accept="image/png,image/jpeg,image/webp" data-sketch-file>
          <div class="sketch-actions" role="group" aria-label="镜头 ${shotIndex} 分镜图操作">
            <button class="btn ${sketch.image_url ? '' : 'primary'}" type="button" data-generate-sketch ${disabled}>${sketch.image_url ? '重新生成' : '生成分镜图'}</button>
            <button class="btn" type="button" data-upload-sketch ${disabled}>上传分镜图</button>
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
  const processed = Math.max(0, Math.min(requested, Number(batch.processed ?? batch.completed ?? 0) || 0));
  const succeeded = Math.max(0, Math.min(processed, Number(batch.succeeded ?? batch.completed ?? 0) || 0));
  const failed = Math.max(0, processed - succeeded);
  const percent = requested ? Math.round((processed / requested) * 100) : 100;
  const activeIndexes = Array.isArray(batch.active_indexes) ? batch.active_indexes.map(Number).filter(Boolean) : [];
  const title = status === 'failed' ? '分镜图批次已停止' : (status === 'succeeded' ? '分镜图批次已完成' : '正在并行生成分镜图');
  return `<div class="sketch-batch-progress is-${escapeHtml(status)}" role="status" aria-live="polite">
    <div class="sketch-batch-progress-head"><b>${title}</b><span>处理 ${processed}/${requested} · 成功 ${succeeded}${failed ? ` · 失败 ${failed}` : ''} · ${percent}%</span></div>
    ${active ? `<div class="project-progress-track" aria-hidden="true"><i style="width:${percent}%"></i></div>` : ''}
    <small>${activeIndexes.length ? `当前并行：第 ${activeIndexes.join('、')} 镜。` : ''}${escapeHtml(batch.message || '')} ${elapsedTimeTag({ startedAt: batch.started_at, finishedAt: batch.finished_at, active })}</small>
  </div>`;
}

function sketchGateReason(gate = {}, fallback = '镜头结构核对通过后才能继续。') {
  const reason = gate?.reason;
  if (typeof reason === 'string' && reason.trim() && !reason.includes('[object Object]')) return reason.trim();
  if (reason && typeof reason === 'object') {
    const nested = reason.message || reason.reason || reason.detail || reason.error;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  const issue = Array.isArray(gate?.issues)
    ? gate.issues.find(item => typeof item === 'string' && item.trim() && !item.includes('[object Object]'))
    : '';
  return issue || fallback;
}

function checkpointPreview(shots = [], total = 0) {
  const rows = Array.isArray(shots) ? shots : [];
  if (!rows.length) return '';
  return `<section class="storyboard-checkpoint-preview" aria-label="已保存镜头合同">
    <div><b>已保存 ${rows.length}/${Math.max(rows.length, Number(total) || 0)} 个镜头合同</b><span>这些结果不会重复生成；继续后只补缺失镜头，全部合同完成后才开始分镜图片。</span></div>
    <ol>${rows.map((shot, index) => `<li><strong>SH${String(Number(shot.index || shot.shot_index || index + 1)).padStart(2, '0')}</strong><span>${escapeHtml(shot.title || shot.purpose || `镜头 ${index + 1}`)}</span></li>`).join('')}</ol>
  </section>`;
}

export async function mount(host, context) {
  if (context.route?.params?.get('stage') === 'shot') {
    const shotDesigner = await import('./shotDesignerView.js?v=20260830-production-v284');
    return shotDesigner.mount(host, context);
  }
  const { bundle, store } = context;
  const shots = Array.isArray(bundle?.storyboard?.shots) ? bundle.storyboard.shots : [];
  const checkpointShots = Array.isArray(bundle?.storyboard?.partial_shots) ? bundle.storyboard.partial_shots : [];
  const checkpointTotal = Math.max(checkpointShots.length, Number(bundle?.storyboard?.checkpoint?.total || bundle?.storyboard?.status?.checkpoint_total || 0));
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(shots.length / pageSize));
  const requestedPage = Math.max(1, Number(context.route?.params?.get('page')) || 1);
  const page = Math.min(pageCount, requestedPage);
  const pageStart = (page - 1) * pageSize;
  const visibleShots = shots.slice(pageStart, pageStart + pageSize);
  const pageNav = shots.length > pageSize ? `<nav class="storyboard-pagination" aria-label="分镜分页"><span>第 ${page}/${pageCount} 页 · 共 ${shots.length} 镜</span><button class="btn small" type="button" data-storyboard-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button><button class="btn small" type="button" data-storyboard-page="${page + 1}" ${page >= pageCount ? 'disabled' : ''}>下一页</button></nav>` : '';
  const isReferenceDraft = bundle?.storyboard?.source === 'reference_analysis_projection';
  const sketches = Array.isArray(bundle?.storyboard?.images) ? bundle.storyboard.images : [];
  const sketchByShot = new Map(sketches.map(item => [Number(item.shot_index), item]));
  const generatedSketchCount = shots.filter((shot, index) => sketchByShot.get(Number(shot.shot_index || shot.index || index + 1))?.image_url).length;
  const resolvedSketchCount = shots.filter((shot, index) => sketchByShot.get(Number(shot.shot_index || shot.index || index + 1))?.status === 'confirmed').length;
  const missingSketchCount = Math.max(0, shots.length - generatedSketchCount);
  const regenerateAllSketches = missingSketchCount === 0 && generatedSketchCount > 0;
  const sketchBatchTargetCount = regenerateAllSketches ? shots.length : missingSketchCount;
  const sketchGate = bundle?.storyboard?.sketch_gate || { ready: false, reason: '镜头结构状态尚未核对，请刷新页面。', issues: [] };
  const gateReason = sketchGateReason(sketchGate);
  const completedHistorical = Boolean(
    bundle?.project?.final_video_url
    || bundle?.generation?.final_video?.video_url
    || bundle?.navigation?.steps?.final?.completed === true,
  );
  const gateWarningVisible = !isReferenceDraft && !sketchGate.ready && !completedHistorical;
  const completedHistoryMessage = completedHistorical && !sketchGate.ready
    ? '这是已完成项目的历史结果。旧版本缺少的新结构字段不会在只读查看时继续报错；只有明确重做本步骤时才会重新校验。'
    : '';
  let sketchBatch = bundle?.storyboard?.image_batch || null;
  const sketchModelPicker = await loadGenerationModelPicker(bundle.project.id, 'new_story_ad.storyboard_image', { label: '分镜模型' });
  const sketchBatchActive = ['queued', 'running'].includes(String(sketchBatch?.status || ''));
  const storyboardActive = bundle?.project?.active_stage === 'storyboard' && !!bundle?.project?.active_generation_id;
  const storyboardFailed = !shots.length && !storyboardActive
    && String(bundle?.project?.status || '').toLowerCase() === 'failed'
    && String(bundle?.project?.stage || '').toLowerCase().includes('storyboard');
  if (storyboardFailed) pendingSketches.delete(bundle.project.id);
  const defaultPanel = shots.length && (sketchGate.ready || sketches.length) ? 'sketches' : 'shots';
  const mainSketchAction = shots.length
    ? (missingSketchCount
      ? `<button class="btn primary" type="button" data-generate-sketch-batch ${sketchBatchActive || !sketchGate.ready ? 'disabled' : ''}>${sketchBatchActive ? '分镜图生成中' : `生成人物场景分镜图（${missingSketchCount}）`}</button>`
      : `<button class="btn" type="button" data-generate-sketch-batch data-regenerate-all="true" ${sketchBatchActive || !sketchGate.ready ? 'disabled' : ''}>${sketchBatchActive ? '分镜图生成中' : `重新生成人物场景分镜图（${shots.length}）`}</button>`)
    : `<button class="btn primary" type="button" data-prepare-storyboard-sketch ${storyboardActive ? 'disabled' : ''}>${storyboardActive ? '正在整理镜头结构…' : (checkpointShots.length ? `继续整理并生成分镜（缺 ${Math.max(0, checkpointTotal - checkpointShots.length)} 镜）` : '生成分镜')}</button>`;
  const guideMessage = isReferenceDraft
    ? '这里仅显示参考视频提取的逐镜草稿。可逐镜打开编辑，确认剧情、动作和时长；机位、景别和运镜在镜头设计中继续优化。'
    : (completedHistoryMessage || (storyboardFailed
      ? (checkpointShots.length
        ? `镜头结构整理未完成，已保存 ${checkpointShots.length}/${checkpointTotal} 个有效镜头。继续后只补缺失镜头，完成后自动开始分镜图片。`
        : '镜头结构整理未完成，尚未开始分镜图片生成。可重新点击“生成分镜”，系统不会改写前四步内容或场景图片。')
      : (!shots.length
        ? (storyboardActive
          ? '系统正在自动绑定固定人物与固定场景，并整理景别、机位、运镜和时长；通过后会继续生成黑白分镜图。'
          : '点击“生成分镜”后，系统会先自动完成剧情节点与固定人物、固定场景的绑定校验，再建立 Shot List 并继续生成黑白分镜图。')
        : (sketchGate.ready
          ? '分镜图可生成或上传；全部确认后，黑白构图会作为必需参考进入彩色关键帧。'
          : `人物场景分镜需要修正：${gateReason}`))));
  const headerAction = isReferenceDraft
    ? '<button class="btn primary" type="button" data-save-reference-storyboard>保存参考分镜草稿</button>'
    : (completedHistorical && !sketchGate.ready
      ? '<span class="status-tag is-neutral">历史完成内容 · 只读</span>'
      : '');
  const primaryAction = !isReferenceDraft && !(completedHistorical && !sketchGate.ready)
    ? `${sketchModelPicker.html}${mainSketchAction}`
    : '';
  host.innerHTML = `
    <section class="view-head">
      <div><h1>人物场景分镜</h1><p>系统自动核对剧情流向并绑定前四步已确认的人物与场景，再生成 Shot List 和黑白分镜画面。</p>${isReferenceDraft ? '<span class="status-tag is-neutral">参考视频逐镜草稿 · 待优化</span>' : ''}</div>
      ${headerAction ? `<div class="view-actions">${headerAction}</div>` : ''}
    </section>
    <div class="guide ${storyboardFailed || (shots.length && gateWarningVisible) ? 'is-danger' : ''}">${escapeHtml(guideMessage)}</div>
    ${primaryAction ? `<div class="storyboard-primary-actions">${primaryAction}</div>` : ''}
    <div class="tabs">
      <button class="tab ${defaultPanel === 'shots' ? 'active' : ''}" type="button" role="tab" aria-selected="${defaultPanel === 'shots'}" data-board-tab="shots">镜头结构 ${shots.length}${checkpointShots.length ? ` · 暂存 ${checkpointShots.length}/${checkpointTotal}` : ''}</button>
      <button class="tab ${defaultPanel === 'sketches' ? 'active' : ''}" type="button" role="tab" aria-selected="${defaultPanel === 'sketches'}" data-board-tab="sketches" ${sketchGate.ready || sketches.length ? '' : 'disabled'}>人物场景分镜图 ${generatedSketchCount}/${shots.length}</button>
    </div>
    <section data-board-panel="shots" ${defaultPanel === 'shots' ? '' : 'hidden'}>
      ${shots.length ? `<div class="card shot-table"><div class="shot-table-scroll">
        <div class="shot-row header storyboard-complete-row"><span>镜头</span><span>时长</span><span>画面描述</span><span>景别</span><span>光影氛围</span><span>对白 / 旁白</span><span>音效</span><span>运镜</span><span>镜头提示词</span><span>操作</span></div>
        ${visibleShots.map((shot, index) => shotRow(shot, pageStart + index, bundle)).join('')}
      </div></div>${!isReferenceDraft ? '<div class="storyboard-secondary-action"><button class="btn quiet" type="button" data-regenerate-storyboard>重新整理镜头结构</button></div>' : ''}${pageNav}` : (checkpointShots.length
        ? checkpointPreview(checkpointShots, checkpointTotal)
        : `<div class="card storyboard-empty-card">${emptyState({
          title: storyboardActive ? '正在整理镜头结构' : '镜头结构尚未建立',
          body: storyboardActive ? '人物与场景绑定后，将并行整理镜头合同；成功项会立即保存并显示在这里。' : '点击上方“生成分镜”，系统会建立逐镜合同并自动继续生成分镜图。',
        })}</div>`)}
    </section>
    <section data-board-panel="sketches" ${defaultPanel === 'sketches' ? '' : 'hidden'}>
      ${shots.length ? `<div class="storyboard-stage-bar"><div><b>人物场景分镜图</b><span>${sketchGate.ready ? `已建立 ${shots.length} 个分镜；当前画面 ${generatedSketchCount}/${shots.length}，确认或跳过 ${resolvedSketchCount}/${shots.length}。` : escapeHtml(gateReason)}</span></div></div>` : ''}
      <div data-sketch-batch-host>${sketchBatchMarkup(sketchBatch, missingSketchCount || generatedSketchCount)}</div>
      ${shots.length ? `<div class="storyboard-sketch-grid">${visibleShots.map((shot, index) => sketchCard(shot, sketchByShot.get(Number(shot.shot_index || shot.index || pageStart + index + 1)) || {}, pageStart + index, sketchGate, bundle)).join('')}</div>${pageNav}` : `<div class="card">${emptyState({ title: '正在准备人物场景分镜', body: '分镜合同建立后会在这里显示分镜图生成进度和结果。' })}</div>`}
    </section>`;

  bindMediaLightbox(host);
  const selectedSketchModel = bindGenerationModelPicker(host, sketchModelPicker);

  host.querySelectorAll('[data-board-tab]').forEach(button => {
    button.addEventListener('click', () => {
      host.querySelectorAll('[data-board-tab]').forEach(item => item.classList.toggle('active', item === button));
      host.querySelectorAll('[data-board-tab]').forEach(item => item.setAttribute('aria-selected', String(item === button)));
      host.querySelectorAll('[data-board-panel]').forEach(panel => { panel.hidden = panel.dataset.boardPanel !== button.dataset.boardTab; });
    });
  });
  if (sketchBatchActive || defaultPanel === 'sketches') host.querySelector('[data-board-tab="sketches"]')?.click();
  host.querySelectorAll('[data-storyboard-page]').forEach(button => button.addEventListener('click', () => {
    const targetPage = Math.max(1, Math.min(pageCount, Number(button.dataset.storyboardPage) || 1));
    context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=storyboard&page=${targetPage}`);
  }));

  const generateStoryboard = async button => {
    try {
      setButtonBusy(button, true, '正在提交…', { elapsed: true });
      const optimisticTotal = Math.max(1, checkpointTotal || bundle?.story_flow?.contract?.units?.length || 1);
      store.beginStageSubmission?.('storyboard', optimisticTotal, checkpointShots.length
        ? `正在继续整理镜头结构；已保存 ${checkpointShots.length}/${optimisticTotal}，只补缺失镜头。`
        : '正在提交镜头结构整理任务；进度会立即显示。', {
        processed: checkpointShots.length,
        completed: checkpointShots.length,
        current_index: Math.min(optimisticTotal, checkpointShots.length + 1),
      });
      await store.runStage('storyboard');
      toast('镜头结构整理已开始，页面顶部会显示进度和耗时。', 'success');
      return true;
    } catch (error) {
      toast(error.message, 'danger');
      try { await store.refreshSections?.('summary,shots'); } catch {}
      return false;
    } finally {
      setButtonBusy(button, false);
    }
  };
  host.querySelector('[data-prepare-storyboard-sketch]')?.addEventListener('click', async event => {
    const model = selectedSketchModel();
    if (!model) return toast('请先选择本次分镜生成模型。', 'danger');
    pendingSketches.set(bundle.project.id, { image_model: model, client_request_id: globalThis.crypto?.randomUUID?.() || `${Date.now()}` });
    if (!await generateStoryboard(event.currentTarget)) pendingSketches.delete(bundle.project.id);
  });
  host.querySelector('[data-regenerate-storyboard]')?.addEventListener('click', async event => {
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
    ? `重新生成人物场景分镜图（${shots.length}）`
    : `生成人物场景分镜图（${missingSketchCount}）`;
  const renderSketchBatch = progress => {
    sketchBatch = progress || null;
    const batchHost = host.querySelector('[data-sketch-batch-host]');
    if (batchHost) batchHost.innerHTML = sketchBatchMarkup(sketchBatch, sketchBatchTargetCount || generatedSketchCount);
    const active = ['queued', 'running'].includes(String(sketchBatch?.status || ''));
    if (batchButton) {
      batchButton.disabled = active;
      batchButton.textContent = active ? `分镜图生成中 ${sketchBatch.processed ?? sketchBatch.completed ?? 0}/${sketchBatch.requested || sketchBatchTargetCount}` : batchButtonLabel();
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
    });
    bindMediaLightbox(host);
  };
  const finishSketchBatch = async progress => {
    if (batchFinalizing || disposed) return;
    batchFinalizing = true;
    if (sketchBatchPollTimer) clearTimeout(sketchBatchPollTimer);
    renderSketchBatch(progress);
    pendingSketches.delete(bundle.project.id);
    const failed = progress?.status === 'failed';
    toast(failed ? progress.message : `人物场景分镜图已完成 ${progress?.completed || 0}/${progress?.requested || 0}，结果显示在下方镜头卡片中。`, failed ? 'danger' : 'success');
    await context.refreshShell();
    document.querySelector('[data-board-tab="sketches"]')?.click();
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
      setButtonBusy(button, true, `正在启动 0/${targetCount}…`, { elapsed: true });
      renderSketchBatch({ status: 'running', requested: targetCount, completed: 0, message: '批次已提交，生成结果会逐镜保存到下方镜头卡片。' });
      sketchBatchPollTimer = setTimeout(pollSketchBatch, 500);
      const data = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/storyboard-images/generate-batch`, {
        method: 'POST',
        body: { confirmed: true, regenerate_all: regenerateAll, image_model: options.imageModel || selectedSketchModel(), client_request_id: options.clientRequestId || globalThis.crypto?.randomUUID?.() || `${Date.now()}` },
        timeoutMs: 45 * 60 * 1000,
      });
      pendingSketches.delete(bundle.project.id);
      await finishSketchBatch(data.progress || {
        status: 'succeeded', requested: data.requested, completed: data.completed,
      });
    } catch (error) {
      if (error.code !== 'SKETCH_BATCH_IN_PROGRESS') pendingSketches.delete(bundle.project.id);
      toast(error.code === 'SKETCH_BATCH_IN_PROGRESS' ? '已连接正在执行的分镜图批次。' : error.message, error.code === 'SKETCH_BATCH_IN_PROGRESS' ? 'warning' : 'danger');
      sketchBatchPollTimer = setTimeout(pollSketchBatch, 100);
    } finally {
      if (!disposed && !['queued', 'running'].includes(String(sketchBatch?.status || ''))) setButtonBusy(button, false);
    }
  };
  batchButton?.addEventListener('click', event => startSketchBatch(event.currentTarget));
  const pendingSketch = pendingSketches.get(bundle.project.id);
  if (pendingSketch && shots.length && sketchGate.ready && !sketchBatchActive && missingSketchCount > 0 && batchButton) {
    window.setTimeout(() => startSketchBatch(batchButton, {
      imageModel: pendingSketch.image_model,
      clientRequestId: pendingSketch.client_request_id,
    }), 0);
  }
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
    const current = sketchByShot.get(shotIndex) || { id: `storyboard-image-${shotIndex}`, shot_index: shotIndex, status: 'draft' };
    const next = {
      ...current,
      ...patch,
      shot_index: shotIndex,
      composition_notes: card.querySelector('[data-sketch-notes]')?.value?.trim() || patch.composition_notes || current.composition_notes || '',
    };
    sketchByShot.set(shotIndex, next);
    await store.saveStoryboardImages([...sketchByShot.values()]);
    await context.refreshShell();
  }

  async function saveShotVoice(card) {
    const shotIndex = Number(card.dataset.sketchShot);
    const sourceIndex = shots.findIndex((shot, index) => Number(shot.shot_index || shot.index || index + 1) === shotIndex);
    if (sourceIndex < 0) return;
    const mode = card.querySelector('[data-shot-speech-mode]')?.value || 'offscreen_voiceover';
    const speakerSelect = card.querySelector('[data-shot-speaker]');
    const speakerId = speakerSelect?.value || '';
    const speaker = speakerSelect?.selectedOptions?.[0]?.dataset?.speakerName || '';
    const line = card.querySelector('[data-shot-spoken-line]')?.value?.trim() || '';
    const performance = card.querySelector('[data-shot-voice-performance]')?.value?.trim() || '';
    const timing = card.querySelector('[data-shot-voice-timing]')?.value?.trim() || '';
    if (mode === 'on_camera_dialogue' && (!speakerId || !line)) throw new Error('人物出镜对白必须选择说话人物并填写实际说出的内容。');
    const next = shots.map((shot, index) => index === sourceIndex ? {
      ...shot,
      speech_mode: mode,
      speaker_id: mode === 'on_camera_dialogue' ? speakerId : '',
      speaker: mode === 'on_camera_dialogue' ? speaker : '',
      voiceover: mode === 'offscreen_voiceover' ? line : '',
      narration: mode === 'offscreen_voiceover' ? line : '',
      dialogue_lines: mode === 'on_camera_dialogue' ? [{ speech_mode: 'dialogue', speaker_id: speakerId, speaker, line }] : [],
      voice_tone: performance,
      voice_performance: performance,
      voiceover_timing: timing,
      _nsa_user_edited_fields: { ...(shot._nsa_user_edited_fields || {}), speech_mode: true, dialogue_lines: true, voiceover: true, voice_tone: true, voiceover_timing: true },
    } : shot);
    await store.saveStoryboard(next);
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
        toast('人物场景分镜图已上传。', 'success');
      } catch (error) {
        toast(error.message, 'danger');
      }
    });
    card.querySelector('[data-confirm-sketch]').addEventListener('click', async event => {
      const button = event.currentTarget;
      try {
        setButtonBusy(button, true, '确认中…');
        await saveShotVoice(card);
        await saveSketch(card, { status: 'confirmed' });
        toast(`镜头 ${shotIndex} 构图已确认。`, 'success');
      } catch (error) {
        toast(error.message, 'danger');
      } finally {
        setButtonBusy(button, false);
      }
    });
    card.querySelector('[data-generate-sketch]').addEventListener('click', async event => {
      const button = event.currentTarget;
      try {
        setButtonBusy(button, true, '生成中…', { elapsed: true });
        const data = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/storyboard-images/${shotIndex}/generate`, {
          method: 'POST',
          body: { confirmed: true, image_model: selectedSketchModel() },
          timeoutMs: 360000,
        });
        sketchByShot.set(shotIndex, data.sketch);
        toast(`镜头 ${shotIndex} 人物场景分镜图已生成。`, 'success');
        await context.refreshShell();
      } catch (error) {
        toast(error.message, 'danger');
      } finally {
        setButtonBusy(button, false);
      }
    });
    card.querySelector('[data-save-shot-voice]')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      try {
        setButtonBusy(button, true, '保存中…');
        await saveShotVoice(card);
        toast(`镜头 ${shotIndex} 的对白、声音方式和表演节奏已写入生成合同。`, 'success');
        await context.refreshShell();
      } catch (error) { toast(error.message, 'danger'); setButtonBusy(button, false); }
    });
  });
  return () => {
    disposed = true;
    if (sketchBatchPollTimer) clearTimeout(sketchBatchPollTimer);
  };
}
