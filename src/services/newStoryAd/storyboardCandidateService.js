'use strict';
const storage = require('./storageService');
const { v4: uuidv4 } = require('uuid');
const compositionService = require('../storyAdWorkspace/storyboardImageCompositionService');
const storyboardSubjectQa = require('./storyboardSubjectQaService');
const visualQa = require('./storyboardVisualQaService');
const { shotContractFingerprint } = require('./storyboardImageLineageService');
const clean = (value, max) => String(value || '').trim().slice(0, max);

function reviewSource(taskId, shot, numericIndex) {
  const fingerprint = shotContractFingerprint(shot, numericIndex - 1);
  const existing = (storage.getOutput(taskId, 'storyboard_images') || []).find(item => Number(item.shot_index) === numericIndex && item.shot_contract_fingerprint === fingerprint);
  if (existing) return existing;
  return storage.listOutputs(taskId).filter(item => item.kind.startsWith('storyboard_image_candidate:') && Number(item.payload?.shot_index) === numericIndex && item.payload?.shot_contract_fingerprint === fingerprint)
    .sort((a, b) => String(b.payload.created_at).localeCompare(String(a.payload.created_at)))[0]?.payload || null;
}
async function reviewCandidate({ taskId, shot, numericIndex, generated, context, contract, sceneAsset, domainContract }, dependencies = {}) {
  // Persist each paid result before any QA can reject it. Independent output
  // keys avoid concurrent read/modify/write loss and preserve rejected media.
  const candidateKind = `storyboard_image_candidate:${numericIndex}:${uuidv4()}`;
  const candidate = { shot_index: numericIndex, image_url: clean(generated.image_url || generated.url, 1200),
    status: 'pending_review', shot_contract_fingerprint: shotContractFingerprint(shot, numericIndex - 1),
    scene_id: shot.scene_id, subject_count_contract: domainContract.subject_counts,
    created_at: new Date().toISOString() };
  storage.saveOutput(taskId, candidateKind, candidate);
  let subjectCountQa, visualReview;
  try {
    await (dependencies.compositionService || compositionService).assertSingleFrame(generated);
    subjectCountQa = await (dependencies.subjectQaService || storyboardSubjectQa).assert({
    taskId,
    shot,
    generatedUrl: clean(generated.image_url || generated.url, 1200),
    domainContract,
    });
    visualReview = await (dependencies.visualQaService || visualQa).review({
      taskId, ctx: context, shot, contract, sceneAsset, generatedUrl: candidate.image_url,
    });
    if (visualReview.pass !== true) throw Object.assign(new Error('本镜人物、场景或商品一致性未通过，请在分镜阶段修复，现有音频保留'), {
      code: 'STORYBOARD_VISUAL_QA_REJECTED', status: 422, visual_qa: visualReview,
    });
    const currentShots = storage.getOutput(taskId, 'storyboard_table') || [];
    const currentShot = currentShots.find((item, index) => Number(item.shot_index || item.index || index + 1) === numericIndex);
    const currentContext = storage.getOutput(taskId, 'context') || storage.getTask(taskId)?.request || {};
    if (!currentShot || shotContractFingerprint(currentShot, numericIndex - 1) !== candidate.shot_contract_fingerprint
      || visualQa.identityFingerprint(currentContext) !== visualQa.identityFingerprint(context)) {
      throw Object.assign(new Error('质检期间镜头合同已改变，候选图片已保留但不会覆盖当前分镜'), { code: 'STORYBOARD_CANDIDATE_AUTHORITY_CHANGED' });
    }
    storage.saveOutput(taskId, candidateKind, { ...candidate, status: 'verified', subject_count_qa: subjectCountQa, visual_qa: visualReview });
  } catch (error) {
    storage.saveOutput(taskId, candidateKind, { ...candidate, status: 'rejected', error_code: error.code || 'STORYBOARD_QA_FAILED',
      subject_count_qa: error.subject_qa || subjectCountQa || null, visual_qa: error.visual_qa || visualReview || null });
    throw error;
  }
  return { subjectCountQa, visualReview };
}
module.exports = { reviewSource, reviewCandidate };
