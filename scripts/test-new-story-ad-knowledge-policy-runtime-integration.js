'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
process.env.DB_ENABLED = '0';

const runtime = require('../src/services/newStoryAd/knowledgePolicyRuntimeService');
const snapshotService = require('../src/services/newStoryAd/knowledgePolicySnapshotService');
const wearableEvidence = require('../src/services/newStoryAd/wearableEvidencePolicyService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const sceneBlocks = require('../src/services/newStoryAd/sceneBlockService');
const videoLineage = require('../src/services/newStoryAd/videoLineageService');
const personQa = require('../src/services/newStoryAd/personConsistencyQaService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');

function policyDoc(id, enforcement, instruction, qaChecks = []) {
  return {
    id: `doc-${id}`,
    title: id,
    enabled: true,
    runtime_policy: { schema_version: 1, rules: [{
      id, version: 1, status: 'active', priority: 100, enforcement,
      conflict_key: id, stages: ['keyframe'], asset_types: ['shot'],
      instruction, qa_checks: qaChecks,
    }] },
  };
}

function testPinnedSnapshotDoesNotDrift() {
  const snapshot = snapshotService.buildSnapshot({
    taskId: 'snapshot-stability-task',
    selectors: [{ stage: 'keyframe', assetType: 'shot' }],
    docs: [policyDoc('stable-rule', 'hard', 'stable generation phrase')],
    createdAt: '2026-08-06T00:00:00.000Z',
  });
  const present = runtime.resolve({ stage: 'keyframe', assetType: 'shot' }, { knowledge_policy_snapshot: snapshot });
  const laterSelector = runtime.resolve({ stage: 'keyframe', assetType: 'person' }, { knowledge_policy_snapshot: snapshot });
  assert(present.prompt_block.includes('stable generation phrase'));
  assert.strictEqual(laterSelector.prompt_block, '', 'a pinned legacy snapshot must not read a newer live selector');
}

async function testWearablesAreLocalFirst() {
  const definitions = [{ key: 'ring', label: 'Ring' }, { key: 'watch', label: 'Watch' }];
  let generatedDefinitions = [];
  const composites = {
    explicitAccessoryDefinitions: () => definitions,
    composeWearableDetails: async ({ definitions: selected }) => selected.map(item => ({ ...item, image_url: `/local/${item.key}.png`, model_call_count: 0 })),
    generateWearableDetails: async ({ definitions: selected }) => {
      generatedDefinitions = selected;
      return selected.map(item => ({ ...item, image_url: `/enhanced/${item.key}.png`, model_call_count: 1 }));
    },
  };
  const ordinary = await wearableEvidence.resolve({ assetId: 'p1', profile: {} }, { composites });
  assert.strictEqual(ordinary.trace.model_call_count, 0);
  assert.strictEqual(generatedDefinitions.length, 0, 'ordinary accessories must not call the model');
  const critical = await wearableEvidence.resolve({ assetId: 'p1', profile: { criticalAccessoryKeys: ['ring'] } }, { composites });
  assert.deepStrictEqual(generatedDefinitions.map(item => item.key), ['ring']);
  assert.strictEqual(critical.trace.model_call_count, 1, 'only the explicitly critical accessory may use one enhancement call');
  assert.strictEqual(critical.items.find(item => item.key === 'watch').evidence_mode, 'local_crop');
}

function testKeyframePromptKeepsCompletePolicy() {
  const phrase = 'Preserve the complete visible accessory evidence phrase.';
  const exclusion = 'never drop the verified accessory detail';
  const prompt = storyAd.buildKeyframePrompt(
    { brief: 'general campaign', product_subject: 'current service', output_ratio: '9:16', cast_mode: 'no_human', forbidden: [] },
    { title: 'Evidence', visual: 'A real task workspace', action: 'camera moves slowly', characters: [] },
    { visual_contract: {}, knowledge_policy_generation: {
      prompt_block: `Knowledge policy contract (task facts remain authoritative):\nHARD: ${phrase}`,
      negative_constraints: [exclusion],
    } },
    0,
    {},
  );
  assert(prompt.includes(phrase), 'final provider keyframe prompt must retain the complete policy phrase');
  assert(prompt.includes(exclusion), 'final provider keyframe prompt must retain the policy exclusion');
  assert(prompt.length <= 2400, `keyframe prompt exceeded existing provider budget: ${prompt.length}`);
}

function testSceneAndVideoPromptsConsumeBoundedPolicy() {
  const policy = {
    prompt_block: 'Knowledge policy contract (task facts remain authoritative):\nHARD: KEEP_RUNTIME_SCENE_FACTS',
    negative_constraints: ['NO_UNREQUESTED_RUNTIME_ELEMENTS'],
  };
  const base = sceneAssets.buildSceneSheetPrompt({ ctx: { brief: 'generic current-task location' } });
  const scenePrompt = sceneAssets.buildSceneSheetPrompt({ ctx: { brief: 'generic current-task location' }, knowledgePolicy: policy });
  assert(scenePrompt.includes('KEEP_RUNTIME_SCENE_FACTS'));
  assert(scenePrompt.includes('NO_UNREQUESTED_RUNTIME_ELEMENTS'));
  assert(scenePrompt.length - base.length <= 1500, 'knowledge rules must not bloat the scene provider prompt');
  const videoPrompt = videoAdapter.clipPrompt(
    { title: 'current shot', visual: 'current scene', action: 'slow move' },
    {},
    { knowledge_policy_video_generation: policy },
  );
  assert(videoPrompt.includes('KEEP_RUNTIME_SCENE_FACTS'));
  assert(videoPrompt.includes('NO_UNREQUESTED_RUNTIME_ELEMENTS'));
}

function testLongSceneBlockKeepsVideoPolicy() {
  const phrase = 'VIDEO_POLICY_MUST_SURVIVE_LONG_SCENE_BLOCK';
  const block = {
    first_index: 0, member_indexes: [0], beats: [{ shot_index: 1, visual: 'x'.repeat(9000), action: 'move' }],
    generation_mode: 'single_shot', id: 'block-1', duration_sec: 4,
  };
  const prompt = sceneBlocks.generationPrompt(block, [{}], [{
    knowledge_policy_video_generation: { prompt_block: `Knowledge policy contract:\nHARD: ${phrase}` },
  }]);
  assert(prompt.includes(phrase), 'scene-block provider prompt must retain video policy under a long contract');
  assert(prompt.includes('Generation unit contract'), 'bounded scene-block prompt must retain its authoritative unit contract tail');
  assert(prompt.length <= 3950, `scene-block prompt exceeded provider budget: ${prompt.length}`);
}

function testVideoGenerationAndQaFingerprintsAreIsolated() {
  const base = {
    shot: { id: 's1', title: 'shot', visual: 'visual', action: 'move' }, index: 0,
    keyframe: { image_url: '/frame.png', current_generation_status: 'accepted' }, ctx: { output_ratio: '9:16' },
    modelRoute: 'provider/model', qaPolicyVersion: 'qa-v1', motionPrompt: 'move',
  };
  const contract = {
    knowledge_policy_video_generation: { generation_fingerprint: 'generation-a' },
    knowledge_policy_video_qa: { qa_fingerprint: 'qa-a' },
  };
  const first = videoLineage.buildShotLineage({ ...base, contract });
  const qaChanged = videoLineage.buildShotLineage({ ...base, contract: { ...contract, knowledge_policy_video_qa: { qa_fingerprint: 'qa-b' } } });
  const generationChanged = videoLineage.buildShotLineage({ ...base, contract: { ...contract, knowledge_policy_video_generation: { generation_fingerprint: 'generation-b' } } });
  assert.strictEqual(first.fingerprint, qaChanged.fingerprint, 'QA-only changes must not trigger paid regeneration');
  assert.notStrictEqual(first.qa_fingerprint, qaChanged.qa_fingerprint);
  assert.notStrictEqual(first.fingerprint, generationChanged.fingerprint, 'generation policy changes must invalidate video lineage');
  const clip = { video_url: '/clip.mp4', qa: { pass: true, status: 'verified' }, lineage: first, lineage_fingerprint: first.fingerprint };
  assert.strictEqual(videoLineage.reuseDecision(clip, qaChanged).reason, 'qa_policy_changed');
  assert.strictEqual(videoLineage.reviewableDecision(clip, qaChanged).reviewable, true);
}

async function testPersonQaConsumesKnowledgeChecks() {
  let capturedPrompt = '';
  const gateway = { generateVision: async (input) => { capturedPrompt = input.userPrompt; return { text: '{}' }; } };
  const repair = { parseOrRepair: async () => ({ pass: true, visible_human: false, conflicts: [] }) };
  await personQa.reviewPersonKeyframe({
    taskId: 'qa-task', ctx: { cast_mode: 'no_human' }, shot: { characters: [] },
    contract: { knowledge_policy_qa: { qa_checks: ['verify the complete accessory evidence'] } },
    generatedUrl: '/generated.png', gateway, repair,
  });
  assert(capturedPrompt.includes('verify the complete accessory evidence'), 'person keyframe QA must consume knowledge checks');
}

function testAdminProjectionAndAutomaticPersonWiring() {
  const root = path.resolve(__dirname, '..');
  const admin = fs.readFileSync(path.join(root, 'src/routes/admin.js'), 'utf8');
  const adminUi = fs.readFileSync(path.join(root, 'public/js/admin-vue-knowledgebase.js'), 'utf8');
  const drawer = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPlanningDetails.js'), 'utf8');
  const subject = fs.readFileSync(path.join(root, 'src/services/newStoryAd/subjectAssetBundleService.js'), 'utf8');
  assert(admin.includes('normalizeRuntimePolicy(body.runtime_policy)'), 'admin writes must validate executable rules');
  assert(adminUi.includes('runtimePolicyText') && adminUi.includes('body.runtime_policy = null'), 'admin UI must save and clear runtime rules');
  assert(drawer.includes('knowledgePolicyTrace(item)') && !drawer.includes('policy.prompt_block'), 'asset drawer must show compact trace without KB prompt text');
  assert(subject.includes('wearableEvidence.resolve('), 'automatic AI people must use local-first accessory evidence');
  assert(!subject.includes('dossierComposites.generateWearableDetails('), 'automatic AI people must not bypass the local-first accessory policy');
}

async function main() {
  testPinnedSnapshotDoesNotDrift();
  await testWearablesAreLocalFirst();
  testKeyframePromptKeepsCompletePolicy();
  testSceneAndVideoPromptsConsumeBoundedPolicy();
  testLongSceneBlockKeepsVideoPolicy();
  testVideoGenerationAndQaFingerprintsAreIsolated();
  await testPersonQaConsumesKnowledgeChecks();
  testAdminProjectionAndAutomaticPersonWiring();
  console.log(JSON.stringify({ passed: true, real_model_calls: 0 }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
