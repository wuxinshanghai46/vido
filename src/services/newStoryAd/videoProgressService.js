const storage = require('./storageService');

const VIDEO_SHOT_STATUS_PREFIX = 'video_shot_status_';

function videoShotStatusKind(index = 0) {
  return `${VIDEO_SHOT_STATUS_PREFIX}${Math.max(0, Number(index) || 0) + 1}`;
}

function listVideoShotStatuses(taskId = '', total = 0) {
  const count = Math.max(0, Number(total) || 0);
  if (count) return Array.from({ length: count }, (_, index) => storage.getOutput(taskId, videoShotStatusKind(index)) || null);
  return storage.listOutputs(taskId)
    .filter(row => String(row.kind || '').startsWith(VIDEO_SHOT_STATUS_PREFIX))
    .sort((a, b) => Number(String(a.kind).slice(VIDEO_SHOT_STATUS_PREFIX.length)) - Number(String(b.kind).slice(VIDEO_SHOT_STATUS_PREFIX.length)))
    .map(row => row.payload || null);
}

function updateVideoProgress(taskId = '', total = 0, extra = {}) {
  const statuses = listVideoShotStatuses(taskId, total);
  const task = storage.getTask(taskId) || {};
  const previous = task.generation_progress?.stage === 'video' ? task.generation_progress : {};
  const generationId = String(extra.generation_id || task.active_generation_id || previous.generation_id || '');
  const generationChanged = generationId && generationId !== String(previous.generation_id || '');
  const now = new Date().toISOString();
  const terminal = new Set(['qa_passed', 'qa_failed', 'failed', 'cancelled']);
  const active = new Set(['queued', 'submitting', 'provider_submitted', 'provider_running', 'downloading', 'normalizing', 'generated', 'video_qa']);
  const unitGroups = new Map();
  statuses.filter(Boolean).forEach((item, index) => {
    const key = String(item.scene_block_id || item.provider_task_id || `shot-${Number(item.index || 0) || index + 1}`);
    if (!unitGroups.has(key)) unitGroups.set(key, []);
    unitGroups.get(key).push(item);
  });
  const units = [...unitGroups.entries()].map(([id, members]) => ({
    id,
    member_indexes: [...new Set(members.flatMap(item => Array.isArray(item.scene_block_members) && item.scene_block_members.length ? item.scene_block_members : [item.index]).map(Number).filter(Boolean))].sort((a, b) => a - b),
    active: members.some(item => active.has(item.lifecycle)),
    generated: members.some(item => ['generated', 'video_qa', 'qa_passed', 'qa_failed'].includes(item.lifecycle)),
    failed: members.some(item => item.lifecycle === 'failed') && !members.some(item => ['generated', 'video_qa', 'qa_passed', 'qa_failed'].includes(item.lifecycle)),
  }));
  const progress = {
    ...previous,
    stage: 'video',
    status: 'running',
    generation_id: generationId,
    started_at: generationChanged
      ? (task.generation_started_at || task.generation_queued_at || now)
      : (previous.started_at || task.generation_started_at || task.generation_queued_at || now),
    updated_at: now,
    total: Math.max(Number(total) || 0, statuses.length),
    queued: statuses.filter(item => item?.lifecycle === 'queued').length,
    active: statuses.filter(item => active.has(item?.lifecycle)).length,
    generated: statuses.filter(item => ['generated', 'video_qa', 'qa_passed', 'qa_failed'].includes(item?.lifecycle)).length,
    qa_passed: statuses.filter(item => item?.lifecycle === 'qa_passed').length,
    failed: statuses.filter(item => ['qa_failed', 'failed'].includes(item?.lifecycle)).length,
    completed: statuses.filter(item => terminal.has(item?.lifecycle)).length,
    active_indexes: statuses.filter(item => active.has(item?.lifecycle)).map(item => Number(item.index || 0)).filter(Boolean),
    units_total: units.length,
    units_active: units.filter(unit => unit.active).length,
    units_generated: units.filter(unit => unit.generated).length,
    units_failed: units.filter(unit => unit.failed).length,
    active_units: units.filter(unit => unit.active).map(unit => ({ id: unit.id, member_indexes: unit.member_indexes })),
    last_heartbeat_at: statuses.map(item => item?.last_heartbeat_at || '').filter(Boolean).sort().slice(-1)[0] || '',
    ...extra,
  };
  storage.updateTask(taskId, { generation_progress: progress });
  return progress;
}

function updateVideoShotStatus(taskId = '', index = 0, patch = {}, total = 0) {
  const kind = videoShotStatusKind(index);
  const previous = storage.getOutput(taskId, kind) || {};
  const now = new Date().toISOString();
  const lifecycle = patch.lifecycle || previous.lifecycle || 'pending';
  const health = ['qa_passed'].includes(lifecycle) ? 'passed'
    : (['qa_failed', 'failed', 'cancelled'].includes(lifecycle) ? 'failed' : 'running');
  const next = {
    ...previous,
    ...patch,
    shot_index: index,
    index: index + 1,
    lifecycle,
    health,
    queued_at: patch.queued_at || previous.queued_at || (lifecycle === 'queued' ? now : ''),
    started_at: Object.prototype.hasOwnProperty.call(patch, 'started_at')
      ? patch.started_at
      : (previous.started_at || (['submitting', 'provider_submitted', 'provider_running'].includes(lifecycle) ? now : '')),
    finished_at: ['qa_passed', 'qa_failed', 'failed', 'cancelled'].includes(lifecycle) ? (patch.finished_at || now) : '',
    last_heartbeat_at: patch.last_heartbeat_at || now,
    updated_at: now,
  };
  storage.saveOutput(taskId, kind, next);
  updateVideoProgress(taskId, total || next.total_shots || 0);
  return next;
}

module.exports = {
  videoShotStatusKind,
  listVideoShotStatuses,
  updateVideoShotStatus,
  updateVideoProgress,
};
