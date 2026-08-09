const assert = require('assert');
const { auditPipelineCapabilities } = require('../src/services/pipelineCapabilityAuditService');

function main() {
  const report = auditPipelineCapabilities();
  assert.strictEqual(report.summary.group_count, 9);
  assert.strictEqual(report.summary.stage_count, 101);
  assert.strictEqual(report.summary.stages_without_enabled_model, 3);
  assert.deepStrictEqual(report.stages.filter(stage => !stage.enabled_model_count).map(stage => stage.stage_id).sort(), [
    'new_story_ad.asset_plan_scene_coverage_recovery',
    'new_story_ad.scene_depth',
    'new_story_ad.scene_spatial_reconstruction',
  ], 'only optional 6DoF stages may remain fail-closed until a verified provider is configured');
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
    'new_story_ad.storyboard_sketch',
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
