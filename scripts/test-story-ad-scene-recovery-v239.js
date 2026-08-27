'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-scene-recovery-v239-'));
process.env.DB_ENABLED = '0';

const checkpointProjection = require('../src/services/newStoryAd/sceneCheckpointProjectionService');
const sceneSpace = require('../src/services/newStoryAd/sceneSpaceContractService');

const requestId = 'scene_platform_request_detail';
const projected = checkpointProjection.projectSceneAssets([
  { kind: 'scene_config', payload: { spaces: [{ id: 'scene-a', name: '场景 A' }] } },
  {
    kind: 'scene_asset_checkpoint:scene-a',
    payload: {
      scene_id: 'scene-a', status: 'partial', last_error_code: 'UNKNOWN',
      views: {
        master: { status: 'succeeded', image_url: '/master.png', billing_state: 'confirmed', provider_submission_state: 'completed' },
        detail: {
          status: 'failed', error_code: 'UNKNOWN', error: '计费待核对', billing_state: 'unknown',
          provider_submission_state: 'submitted_unknown', submission_id: requestId,
        },
      },
    },
  },
], [{
  stage: 'new_story_ad.scene_extension_detail', submission_id: requestId,
  provider_id: 'webang-maas', model_id: 'gpt-image-2', provider_status: '504',
  error_code: 'PROVIDER_5XX_AMBIGUOUS', billing_state: 'unknown',
  provider_submission_state: 'submitted_unknown', latency_ms: 63360,
  updated_at: '2026-08-27T13:18:46.771Z',
}]);
assert.equal(projected.length, 1);
assert.equal(projected[0].checkpoint_error_code, 'PROVIDER_5XX_AMBIGUOUS');
assert.deepEqual(projected[0].view_statuses.detail, {
  state: 'billing_review', status: 'failed', error_code: 'PROVIDER_5XX_AMBIGUOUS', billing_state: 'unknown',
  submission_state: 'submitted_unknown', provider_id: 'webang-maas', model_id: 'gpt-image-2', http_status: '504',
  platform_request_id: requestId, provider_request_id: '', provider_task_id: '', duration_ms: 63360,
  message: '计费待核对',
});

const schemaError = Object.assign(new Error('场景五图 QA 缺少必需评分、真实摄影证据或逐图错误证据'), {
  code: 'VISION_QA_SCHEMA_INVALID',
  missing_fields: ['photographic_realism_qa.visible_evidence', 'view_issues.visible_evidence'],
  details: [
    { code: 'SCENE_QA_FIELD_MISSING', title: 'photographic_realism_qa.visible_evidence', message: '缺少真实摄影证据' },
    { code: 'SCENE_QA_FIELD_MISSING', title: 'view_issues.visible_evidence', message: '缺少逐图错误证据' },
  ],
  partial_scene_qa: {
    pass: false,
    requirement_qa: { pass: false, layout_match_score: 0.8, material_light_match_score: 0.7, interaction_match_score: 0.8, surface_topology_match_score: 0.8, negative_compliance_score: 1, mismatch_reasons: ['材质证据不足'] },
    photographic_realism_qa: { pass: false, photographic_realism_score: 0.7, physical_material_score: 0.7, natural_variation_score: 0.7, optical_capture_score: 0.7, real_photo_evidence: [], synthetic_signals: [], mismatch_reasons: [] },
    cross_view_qa: { pass: true, scene_consistency_score: 0.8, geometry_consistency_score: 0.8, material_consistency_score: 0.8, mismatch_reasons: [] },
    spatial_coverage_qa: { pass: true, layout_topology_score: 0.8, camera_diversity_score: 0.8, reverse_coverage_score: 0.8, interaction_zone_score: 0.8, reasons: [] },
    view_issues: [{ code: 'MATERIAL_DETAIL_WEAK', view_keys: ['detail'], reason: '材质证据不足', evidence: '细节图纹理不可定位', confidence: 0.8 }],
  },
});
const unverified = sceneSpace.buildUnverifiedContract({
  sceneId: 'scene-a', revision: 2,
  views: ['master', 'reverse', 'interaction', 'detail', 'layout'].map(key => ({ key, image_url: `/${key}.png` })),
  requested: {}, layoutRequired: true,
}, schemaError);
assert.deepEqual(unverified.qa_missing_fields, schemaError.missing_fields);
assert.equal(unverified.qa_schema_issues.length, 2);
assert.equal(unverified.view_issues[0].view_keys[0], 'detail');
assert.equal(unverified.full_space_lock, false);

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src/routes/newStoryAd.js'), 'utf8');
const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'src/services/newStoryAd/sceneAssetService.js'), 'utf8');
assert.match(routeSource, /scene-assets\/:sceneId\/fix/);
assert.match(routeSource, /deadlineMs: 20 \* 60 \* 1000/);
assert.match(routeSource, /LEGACY_SCENE_VERIFY_DISABLED/);
assert.match(routeSource, /LEGACY_SCENE_REPAIR_DISABLED/);
const legacyVerifyBlock = routeSource.slice(routeSource.indexOf("router.post('/tasks/:id/scene-assets/:sceneId/verify'"), routeSource.indexOf("router.post('/tasks/:id/scene-assets/:sceneId/repair'"));
const legacyRepairBlock = routeSource.slice(routeSource.indexOf("router.post('/tasks/:id/scene-assets/:sceneId/repair'"), routeSource.indexOf("router.post('/tasks/:id/scene-assets/:sceneId/fix'"));
assert.doesNotMatch(legacyVerifyBlock, /queueTaskStage|reverifySceneAsset/);
assert.doesNotMatch(legacyRepairBlock, /queueTaskStage|repairSceneAsset/);
assert.match(serviceSource, /async function fixSceneAsset/);
assert.match(serviceSource, /SCENE_QA_EVIDENCE_UNAVAILABLE/);
assert.match(serviceSource, /provider_image_call_count: 0/);

console.log(JSON.stringify({
  passed: true,
  historical_diagnostic_correlated: true,
  webang_duration_ms: 63360,
  qa_missing_fields_preserved: 2,
  image_calls: 0,
}));
