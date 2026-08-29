const assert = require('assert');
const { auditPipelineCapabilities } = require('../src/services/pipelineCapabilityAuditService');
const pipeline = require('../src/services/pipelineModelService');

function main() {
  const report = auditPipelineCapabilities();
  assert.strictEqual(report.summary.group_count, Object.keys(pipeline.listSchema()).length);
  const registeredStageCount = Object.values(pipeline.listSchema()).reduce((total, stages) => total + stages.length, 0);
  assert.strictEqual(report.summary.stage_count, registeredStageCount, '能力审计汇总必须覆盖权威注册表中的全部阶段');
  assert.ok(report.stages.some(stage => stage.stage_id === 'new_story_ad.brief_dialogue'), '导演对话阶段必须进入平台能力审计');
  const enrollment = report.stages.find(stage => stage.stage_id === 'voice.enrollment');
  assert.ok(enrollment, '授权声音素材自动注册必须进入平台能力审计');
  assert.ok(enrollment.enabled_model_count > 0, '授权声音素材自动注册必须有启用模型');
  assert.strictEqual(report.summary.stages_without_enabled_model, 4);
  assert.deepStrictEqual(report.stages.filter(stage => !stage.enabled_model_count).map(stage => stage.stage_id).sort(), [
    'new_story_ad.asset_plan_scene_coverage_recovery',
    'new_story_ad.scene_depth',
    'new_story_ad.scene_panorama',
    'new_story_ad.scene_spatial_reconstruction',
  ], 'optional 6DoF and true panorama stages must remain fail-closed until a verified provider is configured');
  assert.equal(pipeline.isStageModelAllowed('new_story_ad.scene_panorama', {
    provider_id: 'smscrw', model_id: 'gpt-image-2',
  }), false, 'ordinary 3:2 image models must not be routed into the paid panorama stage');
  assert.equal(pipeline.isStageModelAllowed('new_story_ad.scene_panorama', {
    provider_id: 'verified-panorama', model_id: 'equirectangular-v1',
    capabilities: Object.fromEntries(pipeline.NEW_STORY_AD_PANORAMA_REQUIRED_CAPABILITIES.map(key => [key, true])),
  }), true, 'model management may enable a panorama route only with the complete explicit capability contract');
  for (const stageId of [
    'imggen.i2v',
    'drama.scene_image',
    'drama.video_clip',
    'new_story_ad.asset_plan',
    'new_story_ad.asset_plan_section_patch',
    'new_story_ad.reference_video_vision',
    'new_story_ad.reference_video_synthesis',
    'new_story_ad.story_facts',
    'new_story_ad.story_facts_compact_retry',
    'new_story_ad.story_facts_repair',
    'new_story_ad.storyboard_image',
    'new_story_ad.scene_panorama',
    'new_story_ad.scene_panorama_qa',
    'new_story_ad.scene_extension_atlas',
    'new_story_ad.scene_extension_master',
    'new_story_ad.scene_extension_layout',
    'new_story_ad.scene_extension_reverse',
    'new_story_ad.scene_extension_interaction',
    'new_story_ad.scene_extension_detail',
    'new_story_ad.scene_depth',
    'new_story_ad.scene_spatial_reconstruction',
    'new_story_ad.scene_spatial_qa',
  ]) {
    const row = report.stages.find(stage => stage.stage_id === stageId);
    assert.ok(row, `${stageId} must exist in audit`);
    assert.ok(row.business_reference_count > 0, `${stageId} must be connected to business code`);
  }
  const nativeAudio = report.advanced_chain_findings.find(item => item.capability === 'new_story_ad_native_audio');
  assert.strictEqual(nativeAudio.status, 'intentionally_disabled_to_avoid_double_audio_and_billing');
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /api_key|password|secret|token/i);
  console.log(`pipeline capability audit tests passed: ${report.summary.referenced_stage_count}/${report.summary.stage_count} stages statically referenced`);
}

main();
