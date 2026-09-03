'use strict';
const storage = require('./storageService');
const assetPlan = require('./assetPlanService');
const lineage = require('./assetPlanCastLineageService');
const publication = require('./assetPlanPublicationService');
const { randomUUID } = require('crypto');
const VISUAL_FIELDS = new Set(['assetId', 'actor_asset_id', 'actor_id', 'sourceType', 'referenceImageUrl',
  'image_url', 'extra_image_urls', 'view_images', 'person_contract', 'identityLock']);
const MEDIA_KINDS = ['person_contract', 'scene_config', 'scene_assets', 'prop_assets', 'storyboard_images', 'tts_audio'];
const semanticCast = profiles => (profiles || []).map(profile => Object.fromEntries(Object.entries(profile).filter(([key]) => !VISUAL_FIELDS.has(key))));
function blocked(message) { throw Object.assign(new Error(message), { code: 'CAST_LINEAGE_REPAIR_NOT_PROVEN', status: 409 }); }
function plan(taskId) {
  const task = storage.getTask(taskId);
  if (!task) blocked('任务不存在');
  if (task.active_generation_id || ['running', 'queued'].includes(task.status)) blocked('任务仍在生成，不能修正校验记录');
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const active = publication.activeRecord(taskId), source = active?.plan;
  if (!source || source.publication_scope !== 'scene' || source.source !== 'initial_scene_plan_section_completion') blocked('不属于已证实的首次场景校验问题');
  const strict = lineage.fingerprint(context.cast_profiles || []);
  if (strict === context.asset_plan_generated_cast_fingerprint
    || storage.canonicalFingerprint(context.cast_profiles || []) !== context.asset_plan_generated_cast_fingerprint) blocked('人物指纹不是已证实的序列化差异');
  const current = assetPlan.fingerprint(task, context);
  const repairedContext = { ...context, asset_plan_generated_cast_fingerprint: strict };
  const repaired = assetPlan.fingerprint(task, repairedContext);
  if (['person', 'scene'].some(domain => source.domain_state?.[domain]?.bundle_id !== source.release_envelope?.producer_bundle_id
    || Number(source.domain_state?.[domain]?.content_revision) !== Number(task.content_revision))) blocked('人物和场景不属于同一内容及方案版本');
  if (current !== source.fingerprint || current !== active.fingerprint
    || source.domain_state?.scene?.fingerprint !== current
    || source.domain_state?.person?.fingerprint !== repaired) blocked('人物或场景输入存在其他变化，不能自动同步');
  if (lineage.fingerprint(semanticCast(context.cast_profiles)) !== lineage.fingerprint(semanticCast(source.cast_profiles))) blocked('人物文字设定与已确认方案不同');
  const compatibility = publication.releaseCompatibility({ task, context, plan: source, activeRecord: active,
    candidate: storage.getOutput(taskId, publication.CANDIDATE_KIND), fingerprint: current });
  if (!compatibility.compatible) blocked(`方案合同不能安全同步：${compatibility.issues.join('、')}`);
  const request = task.request || {};
  if (assetPlan.fingerprint(task, request) !== current) blocked('任务与上下文的输入不一致');
  const media = Object.fromEntries(MEDIA_KINDS.map(kind => [kind, storage.getOutput(taskId, kind)]));
  return { task, context, active, source, media, repairedContext: { ...repairedContext, asset_plan_fingerprint: repaired },
    repairedRequest: { ...request, asset_plan_generated_cast_fingerprint: lineage.fingerprint(request.cast_profiles || []), asset_plan_fingerprint: repaired },
    repairedFingerprint: repaired, sourceFingerprint: lineage.fingerprint({ task, context, active, media }),
    mediaFingerprint: lineage.fingerprint(media), modelCalls: storage.listModelCalls(taskId).length };
}
function apply(taskId, expectedFingerprint) {
  const prepared = plan(taskId);
  if (!expectedFingerprint || expectedFingerprint !== prepared.sourceFingerprint) blocked('任务状态已改变，请重新核对');
  const receiptId = `cast_lineage_repair:${randomUUID()}`;
  storage.withWriteBatch(() => {
    storage.saveOutput(taskId, receiptId, { status: 'prepared', previous: { task: prepared.task, context: prepared.context,
      active: prepared.active, asset_plan: storage.getOutput(taskId, 'asset_plan'), candidate: storage.getOutput(taskId, publication.CANDIDATE_KIND) },
      source_fingerprint: prepared.sourceFingerprint, repaired_fingerprint: prepared.repairedFingerprint });
    storage.saveOutput(taskId, 'context', prepared.repairedContext);
    const next = publication.publish(taskId, prepared.source, { fingerprint: prepared.repairedFingerprint,
      source: 'proven_initial_scene_cast_lineage_repair', scope: 'all' });
    storage.saveOutput(taskId, 'asset_plan', next);
    storage.updateTask(taskId, { request: prepared.repairedRequest, required_bundle_id: next.release_envelope.producer_bundle_id }, { systemFinalization: true });
    const currentMedia = Object.fromEntries(MEDIA_KINDS.map(kind => [kind, storage.getOutput(taskId, kind)]));
    if (lineage.fingerprint(currentMedia) !== prepared.mediaFingerprint || storage.listModelCalls(taskId).length !== prepared.modelCalls) blocked('校验同步意外影响了素材或模型记录');
    const ready = publication.eligibility(taskId, { fingerprint: prepared.repairedFingerprint });
    if (!ready.eligible) blocked(`校验同步未闭环：${ready.issues.join('、')}`);
    storage.saveOutput(taskId, receiptId, { ...storage.getOutput(taskId, receiptId), status: 'completed', media_unchanged: true, model_calls: 0 });
  });
  return { repaired: true, media_unchanged: true, model_calls: 0, receipt: receiptId };
}
module.exports = { plan, apply };
