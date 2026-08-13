'use strict';

const assert = require('assert');
const contracts = require('../src/services/newStoryAd/goldenProjectContractService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');

const registry = contracts.readRegistry();
assert.deepStrictEqual(registry.projects.map(project => project.request.content_form), [
  'commercial_live_action', 'narrative_live_action', 'comic_narrative',
]);
for (const project of registry.projects) assert.strictEqual(contracts.validateDefinition(project).ok, true);

function passingBundle(project) {
  const pack = contracts.validateDefinition(project).pack;
  const sceneCount = project.expected.min_scene_count;
  const scenes = Array.from({ length: sceneCount }, (_, index) => ({ id: `${project.id}-scene-${index + 1}`, permanent_id: `${project.id}-scene-${index + 1}`, name: `场景${index + 1}` }));
  const storyboard = scenes.map((scene, index) => ({ id: `${project.id}-shot-${index + 1}`, permanent_id: `${project.id}-shot-${index + 1}`, scene_permanent_id: scene.permanent_id, duration_sec: 5 }));
  const requestFacts = contextBuilder.buildContext(project.request);
  requestFacts.capability_pack = pack;
  const subjects = [...(project.request.characters || []), ...(project.request.pet_profiles || [])].map(item => ({ ...item, permanent_id: item.id }));
  const replanSnapshots = Array.from({ length: project.expected.replan_cycles + 1 }, () => ({
    subjects: subjects.map(item => ({ ...item })),
    scenes: scenes.map(item => ({ ...item })),
    assets: [{ id: 'asset-1', reused: true }],
  }));
  return {
    task: { id: `${project.id}-task`, status: 'done' },
    work: { mode: 'authoritative', domain_fingerprints: { compose: 'compose-fingerprint' } },
    outputs: {
      context: requestFacts, scene_config: { scenes },
      blueprint: { title: project.label, synopsis: project.request.brief }, storyboard_table: storyboard,
      keyframes: storyboard.map((_, index) => ({ id: `frame-${index + 1}`, image_url: `/assets/frame-${index + 1}.png`, qa: { pass: true } })),
      tts_audio: { audio_url: '/assets/voice.mp3' },
      video_clips: storyboard.map((_, index) => ({ id: `clip-${index + 1}`, shot_index: index, video_url: `/assets/clip-${index + 1}.mp4`, qa: { pass: true } })),
      final_video: { video_url: '/assets/final.mp4', technical_qa: { pass: true } },
    },
    generation_runs: [{ id: 'unit-1', state: 'succeeded', automatic_retry_allowed: false }],
    replan_snapshots: replanSnapshots,
    acceptance_evidence: {
      ui_assertions: [...project.expected.ui_assertions],
      media_assertions: [...project.expected.media_assertions],
    },
  };
}

for (const project of registry.projects) {
  const bundle = passingBundle(project);
  const passing = contracts.validateResult(project, bundle);
  assert.strictEqual(passing.ok, true, JSON.stringify(passing));
  assert.strictEqual(passing.release_eligible, false, '确定性无费用契约不得伪装成真实生产链路验收');
  const overwritten = structuredClone(bundle);
  overwritten.outputs.context.brief = '模型覆盖后的另一个需求';
  assert(contracts.validateResult(project, overwritten).issues.includes('user_brief_changed'));
  const duplicated = structuredClone(bundle);
  duplicated.outputs.storyboard_table.push({ ...duplicated.outputs.storyboard_table[0] });
  assert(contracts.validateResult(project, duplicated).issues.includes('duplicate_shot_identity'));
  const unknownBilling = structuredClone(bundle);
  unknownBilling.generation_runs[0].state = 'billing_unknown';
  assert(contracts.validateResult(project, unknownBilling).issues.includes('generation_not_closed'));
  const lostReplan = structuredClone(bundle);
  lostReplan.replan_snapshots[2].scenes[0].permanent_id = 'changed-scene-id';
  assert(contracts.validateResult(project, lostReplan).issues.includes('replan_identity_or_asset_reuse_unproven'));
  const omittedFact = structuredClone(bundle);
  omittedFact.outputs.blueprint = { title: project.label, synopsis: '未包含用户要求事实' };
  assert(contracts.validateResult(project, omittedFact).issues.includes('required_user_fact_missing'));
  const missingUiEvidence = structuredClone(bundle);
  missingUiEvidence.acceptance_evidence.ui_assertions = [];
  assert(contracts.validateResult(project, missingUiEvidence).issues.includes('ui_acceptance_evidence_missing'));
  assert(contracts.validateResult(project, bundle, { require_real_evidence: true }).issues.includes('real_route_evidence_missing'));
}

console.log(JSON.stringify({ passed: true, projects: registry.projects.length, forms: registry.projects.map(item => item.request.content_form), authority_overwrite_blocked: true, duplicate_identity_blocked: true, unknown_billing_blocked: true, three_replans_verified: true }));
