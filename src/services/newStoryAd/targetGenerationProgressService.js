'use strict';

function key(stage = '', scopeId = '') {
  return `${String(stage || '')}:${String(scopeId || '')}`;
}

function maps(task = {}) {
  return {
    active: task.active_target_generations && typeof task.active_target_generations === 'object'
      ? { ...task.active_target_generations } : {},
    progress: task.target_generation_progress && typeof task.target_generation_progress === 'object'
      ? { ...task.target_generation_progress } : {},
  };
}

function aggregate(task = {}, stage = '') {
  const state = maps(task);
  const selectedStage = String(stage || task.active_stage || task.generation_progress?.stage || '');
  const stageRows = Object.entries(state.progress)
    .filter(([targetKey, row]) => String(row?.stage || targetKey.split(':')[0]) === selectedStage)
    .map(([targetKey, row]) => ({ target_key: targetKey, ...row }));
  const batchRow = [...stageRows].reverse().find(row => String(row.mode || '') === 'scene_batch') || null;
  const concreteSceneRows = stageRows.filter(row => row.target_key !== 'scene_asset:scene-batch');
  const rows = batchRow && concreteSceneRows.length ? concreteSceneRows : stageRows;
  if (!rows.length) return task.generation_progress || null;
  const activeKeys = new Set(Object.keys(state.active));
  const activeRows = rows.filter(row => activeKeys.has(row.target_key));
  const relevant = activeRows.length
    ? rows
    : rows.filter(row => ['done', 'completed', 'succeeded', 'failed', 'cancelled'].includes(String(row.status || '').toLowerCase()));
  const source = relevant.length ? relevant : rows;
  const total = source.reduce((sum, row) => sum + Math.max(0, Number(row.target_total || row.total || 0) || 0), 0);
  const processed = source.reduce((sum, row) => sum + Math.max(0, Number(row.processed || row.completed || 0) || 0), 0);
  const succeeded = source.reduce((sum, row) => sum + Math.max(0, Number(row.succeeded || 0) || 0), 0);
  const failed = source.reduce((sum, row) => sum + Math.max(0, Number(row.failed || 0) || 0), 0);
  const latest = [...source].sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || ''))).pop() || {};
  const sceneIds = [...new Set(source.map(row => String(row.scene_id || row.scope_id || '')).filter(Boolean))];
  const singleLaneDetails = source.length === 1 ? Object.fromEntries([
    'mode', 'view_keys', 'active_view_keys', 'completed_view_keys', 'view_states', 'verification_state',
    'image_target_total', 'image_processed', 'image_succeeded', 'image_failed', 'image_percent',
    'current_view_key', 'current_view_label', 'current_scene_progress',
  ].filter(field => source[0][field] !== undefined).map(field => [field, source[0][field]])) : {};
  const anyFailed = source.some(row => String(row.status || '').toLowerCase() === 'failed');
  const anyCancelled = source.some(row => String(row.status || '').toLowerCase() === 'cancelled');
  const allCompleted = source.length > 0 && source.every(row => String(row.status || '').toLowerCase() === 'completed');
  const directLaneRunning = !activeRows.length && source.some(row => ['queued', 'running', 'verifying']
    .includes(String(row.status || '').toLowerCase()));
  const running = activeRows.length > 0 || directLaneRunning;
  const status = running
    ? (source.length === 1 && String(source[0].status || '').toLowerCase() === 'verifying' ? 'verifying' : 'running')
    : (anyFailed ? 'failed' : (anyCancelled ? 'cancelled' : (allCompleted ? 'completed' : 'done')));
  return {
    schema_version: 2,
    stage: selectedStage,
    generation_id: String((activeRows[activeRows.length - 1] || latest).generation_id || ''),
    status,
    phase: running
      ? (activeRows.length
        ? (activeRows.some(row => row.phase === 'verification') ? 'verification' : 'generation')
        : (latest.phase || 'generation'))
      : 'complete',
    target_total: total,
    processed,
    succeeded,
    failed,
    percent: total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : (running ? 0 : 100),
    active_target_keys: activeRows.map(row => row.target_key),
    active_scene_ids: activeRows.map(row => String(row.scene_id || row.scope_id || '')).filter(Boolean),
    ...(sceneIds.length === 1 ? { scene_id: sceneIds[0] } : {}),
    ...singleLaneDetails,
    ...(batchRow ? {
      mode: 'scene_batch',
      batch_scene_ids: Array.isArray(batchRow.batch_scene_ids) ? batchRow.batch_scene_ids : [],
      current_scene_id: String(batchRow.current_scene_id || ''),
      current_scene_name: String(batchRow.current_scene_name || ''),
      current_action: String(batchRow.current_action || ''),
      message: String(batchRow.message || ''),
    } : {}),
    started_at: source.map(row => row.started_at).filter(Boolean).sort()[0] || '',
    updated_at: latest.updated_at || new Date().toISOString(),
    ...(!running ? { finished_at: latest.finished_at || latest.updated_at || new Date().toISOString() } : {}),
  };
}

function upsert(task = {}, options = {}) {
  const stage = String(options.stage || '');
  const scopeId = String(options.scopeId || options.scope_id || '');
  const targetKey = key(stage, scopeId);
  const state = maps(task);
  if (options.resetStageIfIdle === true
    && !Object.keys(state.active).some(value => value.startsWith(`${stage}:`))) {
    Object.keys(state.progress).filter(value => value.startsWith(`${stage}:`)).forEach(value => delete state.progress[value]);
  }
  const previous = state.progress[targetKey] || {};
  const now = options.updatedAt || new Date().toISOString();
  state.progress[targetKey] = {
    ...previous,
    ...(options.progress || {}),
    stage,
    scope_id: scopeId,
    scene_id: options.sceneId || options.scene_id || previous.scene_id || scopeId,
    generation_id: options.generationId || options.generation_id || previous.generation_id || '',
    status: options.status || options.progress?.status || previous.status || 'queued',
    started_at: previous.started_at || options.startedAt || options.started_at || now,
    updated_at: now,
    ...(['done', 'succeeded', 'failed', 'cancelled'].includes(String(options.status || '').toLowerCase())
      ? { finished_at: options.finishedAt || options.finished_at || now }
      : {}),
  };
  const next = { ...task, target_generation_progress: state.progress };
  return {
    target_generation_progress: state.progress,
    generation_progress: aggregate(next, stage),
  };
}

module.exports = { aggregate, key, maps, upsert };
