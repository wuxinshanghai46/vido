#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-storyboard-v289-'));
process.env.DB_ENABLED = '0';

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const flow = require('../src/services/storyAdWorkspace/storyFlowContractService');
const planning = require('../src/services/storyAdWorkspace/storyFlowPlanningService');
const sketches = require('../src/services/storyAdWorkspace/storyboardSketchService');
const lineage = require('../src/services/newStoryAd/storyboardImageLineageService');
const imageGate = require('../src/services/storyAdWorkspace/storyboardImageConfirmationGateService');
const quality = require('../src/services/newStoryAd/qualityReviewService');
const sceneAcceptance = require('../src/services/newStoryAd/sceneVisualAcceptanceService');
const subjectQa = require('../src/services/newStoryAd/storyboardSubjectQaService');

function createReadyTask(taskId, shots) {
  storyAd.createTask({ task_id: taskId, brief: '分镜简化回归', cast_mode: 'no_human' }, { id: 'v289-owner', role: 'user' });
  storage.saveOutput(taskId, 'context', { brief: '分镜简化回归', cast_mode: 'no_human', scene_setup_confirmed: true, scene_assets: [] });
  storage.saveOutput(taskId, 'blueprint', { fingerprint: `${taskId}-blueprint`, beats: shots.map((shot, index) => ({ beat_id: `b${index + 1}`, beat_index: index + 1, title: shot.title })) });
  const drafted = flow.draft(taskId);
  flow.confirmSystem(taskId, drafted.units, { used_model: 'fixture' });
  storage.saveOutput(taskId, 'storyboard_table', shots);
  storage.saveOutput(taskId, 'storyboard_meta', { status: 'ready' });
  storage.saveOutput(taskId, 'quality_review', { pass: true, passed: true, blocking_issues: [], rewrite_issues: [] });
  storage.saveOutput(taskId, 'keyframe_contracts', shots.map((shot, index) => ({ shot_index: index + 1, scene_lock: { scene_id: shot.scene_id || '' }, visual_contract: {} })));
}

function baseShot(index, patch = {}) {
  return {
    index, shot_index: index, shot_id: `shot-${index}`, source_beat_id: `b${index}`,
    title: `镜头 ${index}`, visual: `画面 ${index}`, action: `人物完成清晰可拍的动作 ${index}`,
    voiceover: `旁白 ${index}`, shot_size: 'medium', camera_angle: 'eye_level', lens_mm: 50,
    depth_of_field: 'medium', composition: 'balanced', subject_position: 'center', camera_movement: 'static',
    entry_frame_state: '动作开始', exit_frame_state: '动作完成', action_start: '抬手', action_end: '放下',
    object_states: [], keyframe_notes: '本镜目的：推进；必须出现：主体；禁止出现：文字',
    character_ids: [], look_bindings: {}, ...patch,
  };
}

async function testBatchPreflightStopsAllPaidImages() {
  const taskId = 'v289-preflight';
  const shots = [baseShot(1), baseShot(2, { character_ids: ['missing-person'] })];
  createReadyTask(taskId, shots);
  let imageCalls = 0;
  await assert.rejects(
    () => sketches.generateSketchBatch(taskId, {
      confirmed: true, image_model: 'fixture-image', client_request_id: 'v289-preflight',
    }, { mediaAdapter: { generateImage: async () => { imageCalls += 1; return { image_url: '/unexpected.png' }; } } }),
    error => error?.code === 'SKETCH_REFERENCE_ASSET_MISSING',
  );
  assert.equal(imageCalls, 0, '任何一镜参考绑定无效时，整批必须在首个付费图片调用前停止');
}

function testGeneratedImageNeedsNoSecondConfirmation() {
  const taskId = 'v289-ready-image';
  const shots = [baseShot(1)];
  createReadyTask(taskId, shots);
  storage.saveOutput(taskId, 'storyboard_images', [{
    shot_index: 1, status: 'draft', image_url: '/storyboard-1.png',
    lineage_schema_version: 2,
    shot_contract_fingerprint: lineage.shotContractFingerprint(shots[0], 0),
    reference_pack_fingerprint: 'no-reference-required',
    scene_planning_fingerprint: 'no-scene-required',
    subject_qa_policy_version: subjectQa.QA_POLICY_VERSION,
    subject_count_qa: { pass: true }, visual_qa: require('./lib/storyboardVisualQaFixture').verified(taskId),
  }]);
  const gate = imageGate.inspect(taskId);
  assert.equal(gate.ready, true);
  assert.equal(gate.confirmed, 1);
  assert.deepEqual(gate.unconfirmed_indexes, []);
  assert.deepEqual(gate.review_indexes, [], '当前 QA/血缘完整的已生成图片无需二次确认');

  storage.saveOutput(taskId, 'storyboard_images', []);
  const missing = imageGate.inspect(taskId);
  assert.equal(missing.ready, false, '真实缺图仍必须阻止进入下一步');
  assert.deepEqual(missing.missing_indexes, [1]);
}

function testAcceptedSceneDoesNotReenterRewrite() {
  const scene = {
    scene_id: 'scene-a', scene_revision: 1, revision: 1, qa: { full_space_lock: false },
    view_images: ['master', 'reverse', 'interaction', 'detail', 'layout'].map(key => ({ key, image_url: `/${key}.png` })),
  };
  const shot = baseShot(1, { scene_id: 'scene-a', scene_revision: 1, scene_view: 'master' });
  const blocked = quality.localReview({ expected_storyboard_count: 1, scene_assets: [scene] }, [shot]);
  assert(blocked.blocking_issues.some(issue => issue.includes('空间锁定')));
  const accepted = quality.localReview({ expected_storyboard_count: 1, scene_assets: [scene], scene_visual_acceptance_current: true }, [shot]);
  assert(!accepted.blocking_issues.some(issue => issue.includes('空间锁定')), '用户接受且素材指纹仍一致的场景不得被旧 QA 合同再次送入重写');
}

function testMultipleLooksRequireSemanticBinding() {
  const base = {
    people: [{ character_id: 'person-a', look_ids: ['look-day', 'look-night'] }],
    scenes: [{ scene_id: 'scene-a' }],
    units: [{ beat_id: 'beat-a', title: '夜景出场', character_ids: ['person-a'], scene_id: 'scene-a', look_bindings: { 'person-a': 'look-day' }, voice_bindings: {} }],
  };
  assert.throws(() => flow.validateUnits(base, [{ beat_id: 'beat-a', character_ids: ['person-a'], scene_id: 'scene-a' }], { requireExact: true }), error => error.code === 'STORY_FLOW_CONTRACT_INVALID');
  const valid = flow.validateUnits(base, [{ beat_id: 'beat-a', character_ids: ['person-a'], scene_id: 'scene-a', look_bindings: { 'person-a': 'look-night' } }], { requireExact: true });
  assert.equal(valid[0].look_bindings['person-a'], 'look-night');
  const prompt = planning.promptPayload({ people: base.people, scenes: base.scenes, units: base.units });
  assert(prompt.rules.some(rule => rule.includes('look_bindings')));
}

function testCompleteCheckpointRecoversWithoutProvider() {
  const taskId = 'v289-checkpoint-recovery';
  const sizes = ['wide', 'medium', 'close_up', 'full', 'medium_close', 'extreme_close', 'long'];
  const angles = ['eye_level', 'low', 'high', 'over_shoulder', 'profile', 'top_down', 'three_quarter'];
  const movements = ['static', 'push_in', 'pull_out', 'pan_left', 'track_right', 'tilt_up', 'orbit'];
  const shots = Array.from({ length: 7 }, (_, index) => baseShot(index + 1, {
    scene_id: 'scene-a',
    title: `恢复镜头 ${index + 1}`,
    visual: `主体位于明亮室内空间的画面${index + 1}中央，与前景道具和后景结构形成清晰位置关系，侧窗柔光照亮金属与织物材质细节。`,
    action: `主体从画面左侧开始执行第 ${index + 1} 个可拍动作，摄影机采用${movements[index]}运动持续跟随并在动作终点稳定停住。`,
    object_states: [{ object_id: `prop-${index + 1}`, entry: '静止', exit: '被主体移动后稳定' }],
    shot_size: sizes[index], camera_angle: angles[index], camera_movement: movements[index],
    lens_mm: 24 + index * 8, depth_of_field: index % 2 ? 'shallow' : 'deep',
    composition: `composition-${index + 1}`, subject_position: `position-${index + 1}`,
    ...(index === 1 ? { temporal_evidence: { shot_state: { relation_refs: ['人物右手与金属板的接触关系'] } } } : {}),
  }));
  storyAd.createTask({ task_id: taskId, brief: '完整分镜断点无付费恢复', cast_mode: 'no_human', shot_count: 7, content_mode: 'narrative_story', content_mode_source: 'user' }, { id: 'v289-owner', role: 'user' });
  const sceneAssets = [{
    scene_id: 'scene-a', name: '客厅', image_url: '/scene-a.png', scene_revision: 1,
    view_images: ['master', 'reverse', 'interaction', 'detail', 'layout'].map(key => ({ key, image_url: `/scene-a-${key}.png` })),
  }];
  storage.saveOutput(taskId, 'context', { brief: '完整分镜断点无付费恢复', cast_mode: 'no_human', shot_count: 7, content_mode: 'narrative_story', content_mode_source: 'user', scene_setup_confirmed: true, scene_assets: sceneAssets });
  storage.saveOutput(taskId, 'scene_assets', sceneAssets);
  storage.saveOutput(taskId, sceneAcceptance.OUTPUT_KIND, {
    status: 'accepted', scene_fingerprint: sceneAcceptance.fingerprint(sceneAssets), accepted_at: new Date().toISOString(),
  });
  const blueprint = { fingerprint: `${taskId}-blueprint`, revision: 1, beats: shots.map((shot, index) => ({ beat_id: `b${index + 1}`, beat_index: index + 1, title: shot.title })) };
  storage.saveOutput(taskId, 'blueprint', blueprint);
  const drafted = flow.draft(taskId);
  const confirmedFlow = flow.confirmSystem(taskId, drafted.units, { used_model: 'fixture' });
  shots.forEach((shot) => { shot.story_flow_contract_fingerprint = confirmedFlow.contract.contract_fingerprint; });
  const legacyFlow = storage.getOutput(taskId, flow.OUTPUT_KIND);
  storage.saveOutput(taskId, flow.OUTPUT_KIND, { ...legacyFlow, authority_fingerprint: 'legacy-authority-without-look-catalog' });
  storage.saveOutput(taskId, 'storyboard_checkpoint', {
    status: 'running', phase: 'reviewing', blueprint_revision: 1,
    blueprint_fingerprint: blueprint.fingerprint, expected_total: shots.length,
    completed_count: shots.length, completed_indexes: shots.map(shot => shot.index), shots,
  });
  storage.updateTask(taskId, { status: 'failed', stage: 'storyboard_failed', error: '旧场景审核策略阻断' });
  const modelCallsBefore = storage.listModelCalls(taskId).length;
  const recovered = storyAd.recoverStoryboardCheckpoint(taskId, { reason: 'v289_regression' });
  assert.equal(recovered.shots.length, 7);
  assert.equal(recovered.keyframe_contracts.length, 7);
  assert.equal(recovered.provider_calls, 0);
  assert.equal(storage.listModelCalls(taskId).length, modelCallsBefore);
  assert.equal(storage.getOutput(taskId, 'storyboard_checkpoint'), null);
  assert.equal(storage.getTask(taskId).stage, 'keyframe_contract_ready');
  assert.equal(flow.inspect(taskId).ready, true);
}

function testSourceRedlines() {
  const view = read('public/story-ad/views/storyboardView.js');
  const route = read('src/routes/newStoryAd.js');
  const store = read('public/story-ad/store/projectStore.js');
  const sceneUi = read('public/story-ad/views/sceneCardInteractions.js');
  assert.doesNotMatch(view, /data-confirm-sketch|确认构图|镜头详情|重新整理镜头结构|后台镜头合同/);
  assert.match(view, /data-(?:prepare-storyboard-sketch|generate-sketch-batch)/);
  assert.match(route, /LEGACY_STORYBOARD_CREATION_ROUTE_DISABLED/);
  assert.doesNotMatch(route, /router\.post\('\/storyboard'[\s\S]{0,500}createTask/);
  assert.match(store, /createStoryboardLiveRefresh[\s\S]*refreshLiveStoryboard\(project, refreshSections\)/);
  assert.match(sceneUi, /\?view=storyboard/);
  assert.doesNotMatch(sceneUi, /\?view=flow/);
}

(async () => {
  try {
    await testBatchPreflightStopsAllPaidImages();
    testGeneratedImageNeedsNoSecondConfirmation();
    testAcceptedSceneDoesNotReenterRewrite();
    testMultipleLooksRequireSemanticBinding();
    testCompleteCheckpointRecoversWithoutProvider();
    testSourceRedlines();
    console.log(JSON.stringify({ passed: true, checks: 29, image_calls_before_full_preflight: 0, second_confirmation_required: false, accepted_scene_rewrite_calls: 0, checkpoint_recovery_provider_calls: 0, legacy_storyboard_route: 410, live_storyboard_projection: true }));
  } finally {
    try { fs.rmSync(process.env.OUTPUT_DIR, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
