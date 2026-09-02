'use strict';

const storage = require('../newStoryAd/storageService');
const sceneReadability = require('../newStoryAd/sceneReadabilityContractService');
const scenePlanningAuthority = require('../newStoryAd/scenePlanningAuthorityService');
const storyboardImageLineage = require('../newStoryAd/storyboardImageLineageService');
const storyboardSubjectQa = require('../newStoryAd/storyboardSubjectQaService');

function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function clean(value = '', max = 1600) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
const { legacyShotContractFingerprint, shotContractFingerprint } = storyboardImageLineage;

function inspect(taskId) {
  const task = storage.getTask(taskId);
  if (!task) return { ready: false, code: 'TASK_NOT_FOUND', reason: '项目不存在', total: 0, confirmed: 0 };
  const shots = list(storage.getOutput(taskId, 'storyboard_table'));
  const images = list(storage.getOutput(taskId, 'storyboard_images'));
  const storedReferencePacks = storage.getOutput(taskId, 'shot_reference_packs');
  const referencePacks = Array.isArray(storedReferencePacks) ? storedReferencePacks : [];
  const baseContext = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneAssets = scenePlanningAuthority.enrichSceneAssets(
    list(storage.getOutput(taskId, 'scene_assets')),
    storage.getOutput(taskId, 'scene_config') || {},
    baseContext,
    storage.getOutput(taskId, 'scene_world_overrides') || {},
  );
  const sceneById = new Map(sceneAssets.map(asset => [clean(asset.scene_id || asset.id, 160), asset]));
  const byIndex = new Map(images.map(item => [Number(item.shot_index), item]));
  const promptOverrides = new Map(list(storage.getOutput(taskId, 'storyboard_image_prompt_overrides')).map(item => [Number(item.shot_index), item]));
  const missing = [];
  const stale = [];
  const staleReasons = {};
  shots.forEach((shot, index) => {
    const shotIndex = Number(shot.shot_index || shot.index || index + 1) || index + 1;
    const image = byIndex.get(shotIndex);
    if (!image?.image_url) missing.push(shotIndex);
    else {
      const lineageVersion = Number(image.lineage_schema_version || 0);
      const expectedShotFingerprints = lineageVersion >= 2
        ? [shotContractFingerprint(shot, index)]
        : [legacyShotContractFingerprint(shot, index), shotContractFingerprint(shot, index)];
      const legacyContractStale = !expectedShotFingerprints.includes(image.shot_contract_fingerprint);
      const pack = referencePacks[index] || null;
      const currentSceneId = clean(shot.scene_id || shot.scene_asset_id, 160);
      const currentScene = sceneById.get(currentSceneId) || null;
      const currentSceneRevision = Math.max(0, Number(currentScene?.scene_revision || currentScene?.revision || 0) || 0);
      const identityView = sceneReadability.identityView(currentScene || {});
      const identityReference = clean(identityView?.image_url || identityView?.url || currentScene?.image_url, 1200);
      const wantedView = clean(shot.scene_view || shot.sceneView, 80);
      const selectedView = list(currentScene?.view_images).find(view => clean(view.key || view.view || view.view_id, 80) === wantedView) || identityView;
      const selectedReference = clean(selectedView?.image_url || selectedView?.url, 1200);
      const modernLineage = lineageVersion >= 1;
      const reasons = [];
      const currentPromptFingerprint = clean(promptOverrides.get(shotIndex)?.fingerprint, 160);
      if (clean(image.prompt_override_fingerprint, 160) !== currentPromptFingerprint) reasons.push('STORYBOARD_PROMPT_CHANGED');
      if (legacyContractStale) reasons.push('SHOT_CONTRACT_CHANGED');
      if (Number(image.source_content_revision || 0) > 0
        && Number(image.source_content_revision) !== Number(task.content_revision || 1)) reasons.push('CONTENT_REVISION_CHANGED');
      if (modernLineage && clean(image.scene_id, 160) !== currentSceneId) reasons.push('SCENE_BINDING_CHANGED');
      if (modernLineage && currentSceneRevision > 0 && Number(image.scene_revision || 0) !== currentSceneRevision) reasons.push('SCENE_REVISION_CHANGED');
      if (modernLineage && identityReference && clean(image.scene_reference_url, 1200) !== identityReference) reasons.push('SCENE_IDENTITY_REFERENCE_CHANGED');
      if (modernLineage && selectedReference !== identityReference
        && clean(image.scene_view_reference_url, 1200) !== selectedReference) reasons.push('SCENE_VIEW_REFERENCE_CHANGED');
      if (modernLineage && !image.reference_pack_fingerprint) reasons.push('REFERENCE_PACK_MISSING');
      if (modernLineage && pack?.fingerprint
        && clean(image.reference_pack_fingerprint, 160) !== clean(pack.fingerprint, 160)) reasons.push('REFERENCE_PACK_CHANGED');
      if (Number(image.lineage_schema_version || 0) >= 2 && !image.scene_planning_fingerprint) reasons.push('SCENE_PLANNING_LINEAGE_MISSING');
      if (image.scene_planning_fingerprint && currentScene?.scene_planning_fingerprint
        && clean(image.scene_planning_fingerprint, 160) !== clean(currentScene.scene_planning_fingerprint, 160)) reasons.push('SCENE_PLANNING_CHANGED');
      if (Number(image.subject_qa_policy_version || 0) < storyboardSubjectQa.QA_POLICY_VERSION) reasons.push('SUBJECT_COUNT_QA_POLICY_OUTDATED');
      else if (image.subject_count_qa?.pass !== true) reasons.push('SUBJECT_COUNT_QA_FAILED');
      if (reasons.length) {
        stale.push(shotIndex);
        staleReasons[shotIndex] = [...new Set(reasons)];
      }
    }
  });
  // Current lineage and subject-QA evidence are part of the production
  // contract. A completed image with stale evidence is a candidate for review,
  // not an authoritative frame that may enter paid video generation.
  const ready = shots.length > 0 && !missing.length && !stale.length;
  return {
    ready,
    code: ready ? '' : 'STORYBOARD_IMAGES_REQUIRED',
    reason: ready
      ? '全部人物场景分镜图已准备好，可以继续生成后续画面。'
      : (stale.length
        ? `镜头 ${stale.join('、')} 的人物、主体或场景质检血缘已过期，请逐镜重新生成并通过当前质检后继续。`
        : `请先生成全部人物场景分镜图（当前已生成 ${Math.max(0, shots.length - missing.length)}/${shots.length}）。`),
    total: shots.length,
    confirmed: Math.max(0, shots.length - missing.length),
    missing_indexes: missing,
    unconfirmed_indexes: [],
    stale_indexes: stale,
    review_indexes: stale,
    stale_reasons: staleReasons,
  };
}

function assertReady(taskId) {
  const state = inspect(taskId);
  if (state.ready) return state;
  throw Object.assign(new Error(state.reason), { code: state.code, status: state.code === 'TASK_NOT_FOUND' ? 404 : 409, retryable: false, details: state });
}

module.exports = { assertReady, inspect };
