'use strict';

const fs = require('fs');

function createAdminOnly(userFromReq) {
  return (req, res, next) => {
    if (String(userFromReq(req).role || '').toLowerCase() !== 'admin') {
      return res.status(403).json({
        success: false,
        code: 'ADMIN_REQUIRED',
        error: '视频生成单元监控仅管理员可见',
      });
    }
    return next();
  };
}

function monitorHealth(row = {}, now = Date.now()) {
  if (row.lifecycle === 'qa_passed') return 'passed';
  if (['qa_failed', 'failed', 'cancelled'].includes(row.lifecycle)) return 'failed';
  const active = ['queued', 'submitting', 'provider_submitted', 'provider_running', 'downloading', 'normalizing', 'generated', 'video_qa'];
  const heartbeat = Date.parse(row.last_heartbeat_at || row.updated_at || '') || 0;
  if (active.includes(row.lifecycle) && heartbeat && now - heartbeat > 120000) return 'suspected_stuck';
  if (row.provider_task_id && ['provider_submitted', 'provider_running', 'downloading'].includes(row.lifecycle)) return 'provider_running';
  if (active.includes(row.lifecycle)) return 'running';
  return 'pending';
}

function buildVideoMonitorPayload(task, deps, options = {}) {
  const { storage, videoAdapter, videoGenerationUnits, service } = deps;
  const fileSystem = options.fileSystem || fs;
  const now = Number(options.now || Date.now());
  const storyboard = storage.getOutput(task.id, 'storyboard_table') || [];
  const contracts = storage.getOutput(task.id, 'keyframe_contracts') || [];
  const clips = storage.getOutput(task.id, 'video_clips') || [];
  const repairHistory = storage.getOutput(task.id, 'video_repair_history') || [];
  const pipelinePolicy = storage.getOutput(task.id, 'video_pipeline_policy') || null;
  const sceneBlocks = storage.getOutput(task.id, 'video_scene_blocks') || [];
  const context = storage.getOutput(task.id, 'context') || task.request || {};
  const statuses = videoAdapter.listVideoShotStatuses(task.id, storyboard.length);
  const shots = Array.from({ length: Math.max(storyboard.length, statuses.length, clips.length) }, (_, index) => {
    const clip = clips[index] || {};
    const hasOutput = !!(clip.video_url || clip.videoUrl || clip.file_path);
    const legacyFailed = !!clip.error_code || clip.qa?.pass === false || clip.cross_shot_qa?.pass === false;
    const inferredLifecycle = legacyFailed
      ? 'qa_failed'
      : (clip.qa?.pass === true ? 'qa_passed' : (hasOutput ? 'generated' : 'pending'));
    const row = statuses[index] || {
      shot_index: index,
      index: index + 1,
      lifecycle: inferredLifecycle,
      provider_task_id: clip.provider_task_id || '',
      provider_status: clip.provider_status || '',
      error: clip.error || '',
      error_code: clip.error_code || '',
      qa_status: clip.qa?.pass === true ? 'passed' : (legacyFailed ? 'failed' : ''),
      legacy_inferred: true,
    };
    const filePath = row.file_path || clip.file_path || '';
    return {
      ...row,
      shot_index: index,
      index: index + 1,
      title: row.title || storyboard[index]?.title || contracts[index]?.title || `镜头 ${index + 1}`,
      health: monitorHealth(row, now),
      file_path: filePath,
      file_exists: !!(filePath && fileSystem.existsSync(filePath)),
      video_url: row.video_url || clip.video_url || clip.videoUrl || '',
      provider_used: clip.provider_used || [row.provider_id, row.model_id].filter(Boolean).join('/'),
      qa: clip.qa || null,
      cross_shot_qa: clip.cross_shot_qa || null,
      repair_attempt: Number(clip.repair_attempt || row.repair_attempt || 0),
      pipeline_policy_version: clip.pipeline_policy_version || pipelinePolicy?.version || '',
      lineage_fingerprint: clip.lineage_fingerprint || '',
    };
  });
  const bundle = service.publicTaskBundle(task.id, { diagnostics: true, includeVideoMonitor: true });
  const summary = service.taskSummary(task);
  return {
    success: true,
    task_id: task.id,
    task: summary,
    actor: {
      name: context.person_asset?.name || context.person_spec?.displayName || context.person_spec?.roleName || '',
      asset_id: context.person_asset?.id || context.person_asset?.actor_id || '',
      verified: context.person_contract?.status === 'verified',
    },
    generation_progress: summary.generation_progress || null,
    generation_units: videoGenerationUnits.projectVideoGenerationUnits(shots, sceneBlocks),
    shots,
    repair_history: repairHistory,
    pipeline_policy: pipelinePolicy,
    scene_blocks: sceneBlocks,
    stages: bundle.stages,
    model_calls: bundle.model_calls,
    generated_at: new Date(now).toISOString(),
  };
}

function registerVideoMonitorRoute(router, deps) {
  const { asyncRoute, userFromReq, storage } = deps;
  router.get('/admin/tasks/:id/video-monitor', createAdminOnly(userFromReq), asyncRoute(async (req, res) => {
    const task = storage.getTask(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: '任务不存在' });
    return res.json(buildVideoMonitorPayload(task, deps));
  }));
}

module.exports = {
  buildVideoMonitorPayload,
  createAdminOnly,
  monitorHealth,
  registerVideoMonitorRoute,
};
