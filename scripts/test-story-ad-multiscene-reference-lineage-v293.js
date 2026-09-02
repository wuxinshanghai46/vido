#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-storyboard-lineage-v293-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const storage = require('../src/services/newStoryAd/storageService');
const lineage = require('../src/services/newStoryAd/storyboardImageLineageService');
const storyFlow = require('../src/services/storyAdWorkspace/storyFlowContractService');
const sketchGate = require('../src/services/storyAdWorkspace/storyboardSketchGateService');
const sketches = require('../src/services/storyAdWorkspace/storyboardSketchService');
const imageGate = require('../src/services/storyAdWorkspace/storyboardImageConfirmationGateService');

const results = [];
let fixtureImageAdapterCalls = 0;

function sceneAsset(sceneId, name, revision) {
  const base = `/fixtures/${sceneId}/r${revision}`;
  return {
    id: sceneId,
    scene_id: sceneId,
    name,
    revision,
    scene_revision: revision,
    story_purpose: `${name}承担独立剧情段落并保持空间一致性`,
    view_images: [
      { key: 'master', image_url: `${base}/master.png` },
      { key: 'reverse', image_url: `${base}/reverse.png` },
      { key: 'interaction', image_url: `${base}/interaction.png` },
      { key: 'detail', image_url: `${base}/detail.png` },
      { key: 'layout', image_url: `${base}/layout.png` },
    ],
    scene_contract: {
      schema_version: 6,
      status: 'verified',
      requirement_qa: { pass: true },
      photographic_realism_qa: { pass: true },
      camera_design_qa: { pass: true },
      cross_view_qa: { pass: true },
      spatial_coverage_qa: { pass: true },
      layout_contract: { status: 'available' },
    },
  };
}

function createTask(taskId, request = {}) {
  storage.createTask({
    id: taskId,
    title: '多场景分镜 lineage 无模型回归',
    brief: '验证两个已确认场景在七镜剧情中的绑定、参考包和失效语义',
    user_id: 'fixture-owner',
    content_revision: 1,
    request: {
      brief: '验证两个已确认场景在七镜剧情中的绑定、参考包和失效语义',
      cast_mode: 'no_human',
      shot_count: 7,
      target_duration: 63,
      output_ratio: '9:16',
      ...request,
    },
  });
}

function shotFor(unit, index) {
  const shotIndex = index + 1;
  const isDetail = shotIndex === 5;
  const sceneView = isDetail ? 'detail' : (shotIndex === 2 ? 'interaction' : 'master');
  return {
    index: shotIndex,
    shot_index: shotIndex,
    shot_id: `shot_${shotIndex}`,
    source_beat_id: unit.beat_id,
    title: `镜头 ${shotIndex}`,
    role: isDetail ? '材质细节' : '剧情推进',
    purpose: isDetail ? '展示第二场景中的材质细节' : '建立并推进当前空间剧情',
    visual: isDetail
      ? '展示空间中，镜头贴近样板表面的纹理与反光，背景仍保持该展示空间的材质关系。'
      : `${unit.scene_id} 的整体空间关系清楚可识别，主体完成剧情节点 ${shotIndex}。`,
    action: `完成剧情节点 ${shotIndex}`,
    shot_size: isDetail ? 'close_up' : (sceneView === 'master' ? 'wide' : 'medium'),
    camera_angle: 'eye_level',
    camera_movement: 'slow_push',
    lens_mm: isDetail ? 70 : 35,
    expected_people: 0,
    expected_animals: 0,
    characters: [],
    character_ids: [],
    scene_id: unit.scene_id,
    scene_asset_id: unit.scene_id,
    scene_view: sceneView,
    transition_from: unit.transition_from,
    transition_reason: unit.transition_reason,
  };
}

function prepareMultiSceneTask(taskId) {
  createTask(taskId);
  const sceneAssets = [
    sceneAsset('scene_exhibition', '高端商业展厅', 1),
    sceneAsset('scene_showroom', '现代家居展示空间', 2),
  ];
  const assignments = [
    'scene_exhibition', 'scene_exhibition', 'scene_exhibition', 'scene_exhibition',
    'scene_showroom', 'scene_showroom', 'scene_exhibition',
  ];
  const beats = assignments.map((sceneId, index) => ({
    beat_id: `beat_${index + 1}`,
    beat_index: index + 1,
    title: `剧情节点 ${index + 1}`,
    plot: sceneId === 'scene_exhibition'
      ? `在高端商业展厅推进第 ${index + 1} 个剧情动作`
      : `在现代家居展示空间推进第 ${index + 1} 个剧情动作`,
    action: `完成动作 ${index + 1}`,
    scene_id: sceneId,
  }));
  const sceneConfig = {
    spaces: sceneAssets.map(asset => ({
      scene_id: asset.scene_id,
      name: asset.name,
      required_in_story: true,
      story_purpose: asset.story_purpose,
      covered_beat_ids: beats.filter(beat => beat.scene_id === asset.scene_id).map(beat => beat.beat_id),
    })),
  };
  storage.saveOutput(taskId, 'context', {
    brief: '两场景七镜剧情',
    cast_mode: 'no_human',
    scene_setup_confirmed: true,
    output_ratio: '9:16',
    scene_assets: sceneAssets,
    scene_plan: sceneConfig,
  });
  storage.saveOutput(taskId, 'blueprint', {
    title: '两场景七镜剧情',
    story_title: '两场景七镜剧情',
    fingerprint: `blueprint:${taskId}`,
    beats,
  });
  storage.saveOutput(taskId, 'scene_assets', sceneAssets);
  storage.saveOutput(taskId, 'scene_config', sceneConfig);

  const draft = storyFlow.draft(taskId);
  const confirmation = storyFlow.confirm(taskId, draft.units, { id: 'fixture-owner' });
  assert.equal(confirmation.model_call_count, 0, '结构化剧情流确认不得登记模型调用');
  assert.equal(confirmation.contract.status, 'confirmed');

  const shots = confirmation.contract.units.map(shotFor);
  const assetById = new Map(sceneAssets.map(asset => [asset.scene_id, asset]));
  const contracts = shots.map(shot => ({
    shot_index: shot.shot_index,
    fingerprint: `keyframe-contract:${taskId}:${shot.shot_index}`,
    visual_contract: { purpose: shot.purpose },
    scene_lock: {
      scene_id: shot.scene_id,
      scene_revision: assetById.get(shot.scene_id).revision,
      scene_view: shot.scene_view,
      camera_id: `${shot.scene_id}:${shot.scene_view}`,
    },
  }));
  storage.saveOutput(taskId, 'storyboard_table', shots);
  storage.saveOutput(taskId, 'storyboard_meta', { status: 'ready' });
  storage.saveOutput(taskId, 'quality_review', {
    pass: true,
    passed: true,
    blocking_issues: [],
    rewrite_issues: [],
  });
  storage.saveOutput(taskId, 'keyframe_contracts', contracts);
  return { sceneAssets, assignments, shots, contracts };
}

async function runCase(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration_ms: Date.now() - started });
  } catch (error) {
    results.push({
      name,
      passed: false,
      duration_ms: Date.now() - started,
      error: error.message,
      code: error.code || '',
      stack: error.stack || String(error),
    });
  }
}

async function testMultiSceneCoverageAndExactBinding() {
  const taskId = 'lineage-v293-multiscene';
  const fixture = prepareMultiSceneTask(taskId);
  const flow = storyFlow.inspect(taskId);
  const gate = sketchGate.inspect(taskId);
  assert.equal(flow.ready, true);
  assert.equal(flow.total, 7);
  assert.equal(gate.ready, true, gate.reason);
  assert.deepEqual(
    fixture.assignments.reduce((counts, sceneId) => ({ ...counts, [sceneId]: (counts[sceneId] || 0) + 1 }), {}),
    { scene_exhibition: 5, scene_showroom: 2 },
  );
  assert.deepEqual(gate.scene_readability.scenes.map(scene => ({
    scene_id: scene.scene_id,
    ready: scene.ready,
  })), [
    { scene_id: 'scene_exhibition', ready: true },
    { scene_id: 'scene_showroom', ready: true },
  ]);
  const prepared = sketches.prepareSketchGeneration(taskId, 5);
  assert.equal(prepared.sceneAsset.scene_id, 'scene_showroom', '第 5 镜不得回退到第一个场景');
  assert.equal(prepared.shot.scene_view, 'detail');
  assert.match(prepared.sceneReference, /scene_showroom\/r2\/master\.png$/);
  assert.match(prepared.sceneViewReference, /scene_showroom\/r2\/detail\.png$/);
  assert.equal(storage.listModelCalls(taskId).length, 0);
}

async function testMasterAndDetailReferencePack() {
  const taskId = 'lineage-v293-reference-pack';
  prepareMultiSceneTask(taskId);
  const prepared = sketches.prepareSketchGeneration(taskId, 5);
  const pack = prepared.referencePack;
  const persisted = storage.getOutput(taskId, 'shot_reference_packs');
  assert.equal(pack.schema_version, 4);
  assert.equal(pack.scene_id, 'scene_showroom');
  assert.equal(pack.scene_revision, 2);
  assert.equal(persisted[4].fingerprint, pack.fingerprint);
  const byRole = new Map(pack.references.map(reference => [reference.role, reference]));
  assert.match(byRole.get('scene_identity')?.url || '', /scene_showroom\/r2\/master\.png$/,
    '细节镜必须携带用于锁定空间身份的 master 参考');
  assert.match(byRole.get('scene_view')?.url || '', /scene_showroom\/r2\/detail\.png$/,
    '细节镜必须同时携带当前 detail 视图参考');
  assert.match(byRole.get('scene_layout')?.url || '', /scene_showroom\/r2\/layout\.png$/);
  assert.ok(pack.scene_identity_reference_hash);
  assert.ok(pack.scene_view_reference_hash);
  assert.equal(storage.listModelCalls(taskId).length, 0);
}

async function testGeneratedImageLineageAndPackInvalidation() {
  const taskId = 'lineage-v293-generated-image';
  prepareMultiSceneTask(taskId);
  let capturedRequest = null;
  const mediaAdapter = {
    generateImage: async request => {
      fixtureImageAdapterCalls += 1;
      capturedRequest = request;
      return { image_url: '/fixtures/generated/shot-5.png', provider_used: 'fixture-no-network' };
    },
  };
  const compositionService = { assertSingleFrame: async () => ({ passed: true }) };
  const subjectQaService = { assert: async () => ({ pass: true, policy_version: 2, status: 'verified' }) };
  const result = await sketches.generateSketch(taskId, 5, {
    confirmed: true,
    client_request_id: 'fixture-generation:shot-5',
  }, { mediaAdapter, compositionService, subjectQaService });
  const pack = storage.getOutput(taskId, 'shot_reference_packs')[4];
  const image = result.sketch;
  assert.equal(image.lineage_schema_version, 2);
  assert.equal(image.subject_qa_policy_version, 2);
  assert.equal(image.subject_count_qa.pass, true);
  assert.match(capturedRequest.prompt, /同一身份不得因动作路径、镜面、时间阶段或构图需要被复制/);
  assert.match(capturedRequest.prompt, /本张图只呈现这个决定性瞬间/);
  assert.ok(image.scene_planning_fingerprint);
  assert.equal(image.scene_id, 'scene_showroom');
  assert.equal(image.scene_revision, 2);
  assert.match(image.scene_reference_url, /scene_showroom\/r2\/master\.png$/);
  assert.match(image.scene_view_reference_url, /scene_showroom\/r2\/detail\.png$/);
  assert.equal(image.reference_pack_fingerprint, pack.fingerprint);
  assert.equal(image.generation_id, 'fixture-generation:shot-5');
  assert.ok(image.reference_roles.some(reference => reference.role === 'scene_identity' && reference.reference_hash));
  assert.ok(image.reference_roles.some(reference => reference.role === 'scene_view' && reference.reference_hash));
  assert.ok(capturedRequest.referenceImages.some(url => /scene_showroom\/r2\/master\.png$/.test(url)));
  assert.ok(capturedRequest.referenceImages.some(url => /scene_showroom\/r2\/detail\.png$/.test(url)));
  assert.equal(storage.listModelCalls(taskId).length, 0);

  const customPrompt = '陈默单独站在整面背景墙前，右手只触碰中央铜色样板，保持中广景和完整墙面。';
  const promptSave = sketches.savePromptOverride(taskId, 5, customPrompt, { id: 'fixture-editor' });
  assert.equal(promptSave.changed, true);
  const promptStale = imageGate.inspect(taskId);
  assert.deepEqual(promptStale.stale_indexes, [5]);
  assert.deepEqual(promptStale.stale_reasons[5], ['STORYBOARD_PROMPT_CHANGED']);
  const regenerated = await sketches.generateSketch(taskId, 5, {
    confirmed: true,
    client_request_id: 'fixture-generation:shot-5:custom-prompt',
  }, { mediaAdapter, compositionService, subjectQaService });
  assert.match(capturedRequest.prompt, new RegExp(customPrompt));
  assert.equal(regenerated.sketch.prompt_override_fingerprint, promptSave.override.fingerprint);
  assert.equal(regenerated.sketch.applied_editable_prompt, customPrompt);
  assert.ok(!imageGate.inspect(taskId).stale_indexes.includes(5));
  assert.equal(storage.listModelCalls(taskId).length, 0);

  const changedPacks = storage.getOutput(taskId, 'shot_reference_packs');
  changedPacks[4] = {
    ...changedPacks[4],
    scene_view_reference_hash: 'fixture-changed-detail-reference',
    fingerprint: 'fixture-changed-reference-pack-fingerprint',
  };
  storage.saveOutput(taskId, 'shot_reference_packs', changedPacks);
  assert.ok(imageGate.inspect(taskId).stale_indexes.includes(5),
    '参考包权威指纹变化后，已有现代图片必须失效');
}

async function testModernImageInvalidatesWhenSceneAuthorityChanges() {
  const taskId = 'lineage-v293-scene-change';
  prepareMultiSceneTask(taskId);
  const prepared = sketches.prepareSketchGeneration(taskId, 5);
  storage.saveOutput(taskId, 'storyboard_images', [{
    id: 'modern-shot-5',
    shot_index: 5,
    status: 'ready',
    image_url: '/fixtures/generated/modern-shot-5.png',
    lineage_schema_version: 2,
    scene_id: 'scene_showroom',
    scene_revision: 2,
    scene_reference_url: prepared.sceneReference,
    scene_view_reference_url: prepared.sceneViewReference,
    reference_pack_fingerprint: prepared.referencePack.fingerprint,
    scene_planning_fingerprint: prepared.sceneAsset.scene_planning_fingerprint,
    shot_contract_fingerprint: sketches.shotContractFingerprint(prepared.shot, 4),
    source_content_revision: 1,
    subject_qa_policy_version: 2,
    subject_count_qa: { pass: true },
  }]);
  assert.ok(!imageGate.inspect(taskId).stale_indexes.includes(5));
  const changedAssets = storage.getOutput(taskId, 'scene_assets').map(asset => (
    asset.scene_id === 'scene_showroom' ? sceneAsset('scene_showroom', asset.name, 3) : asset
  ));
  storage.saveOutput(taskId, 'scene_assets', changedAssets);
  storage.updateTask(taskId, { content_revision: 2 });
  assert.ok(imageGate.inspect(taskId).stale_indexes.includes(5),
    '场景 revision/参考 URL 变化后，即使旧参考包尚未重新编译，现代图片也必须失效');
}

async function testLegacyImageCompatibilityAndChangeInvalidation() {
  const taskId = 'lineage-v293-legacy-image';
  createTask(taskId, { shot_count: 1 });
  const legacyShot = {
    shot_index: 1,
    shot_id: 'legacy-shot-1',
    source_beat_id: 'legacy-beat-1',
    scene_id: 'legacy-scene',
    visual: '旧任务中的已生成画面',
    action: '展示空间',
    shot_size: 'wide',
    camera_angle: 'eye_level',
    camera_movement: 'static',
    lens_mm: 35,
    character_ids: [],
  };
  storage.saveOutput(taskId, 'scene_assets', [sceneAsset('legacy-scene', '旧任务场景', 1)]);
  storage.saveOutput(taskId, 'storyboard_table', [legacyShot]);
  storage.saveOutput(taskId, 'storyboard_images', [{
    id: 'legacy-image-1',
    shot_index: 1,
    status: 'ready',
    image_url: '/fixtures/generated/legacy-image-1.png',
    shot_contract_fingerprint: lineage.legacyShotContractFingerprint(legacyShot, 0),
    source_content_revision: 1,
  }]);
  const compatible = imageGate.inspect(taskId);
  assert.equal(compatible.ready, false, '旧图片缺少当前 QA/血缘时不得继续作为可生成视频的权威首帧');
  assert.deepEqual(compatible.stale_reasons[1], ['SUBJECT_COUNT_QA_POLICY_OUTDATED']);

  storage.saveOutput(taskId, 'scene_assets', [sceneAsset('legacy-scene', '旧任务场景', 2)]);
  storage.updateTask(taskId, { content_revision: 2 });
  const changed = imageGate.inspect(taskId);
  assert.deepEqual(changed.stale_indexes, [1],
    '兼容读取不等于永久复用：任务或场景权威版本变化后，旧图片必须失效');
}

async function testZeroPercentInterruptedBatchIsTerminal() {
  const taskId = 'lineage-v293-zero-percent';
  createTask(taskId, { shot_count: 3 });
  storage.saveOutput(taskId, 'storyboard_image_batch', {
    id: 'interrupted-zero-percent-batch',
    status: 'running',
    requested: 3,
    completed: 0,
    processed: 0,
    succeeded: 0,
    percent: 0,
    target_indexes: [1, 2, 3],
    started_at: new Date(Date.now() - 60_000).toISOString(),
    finished_at: '',
  });
  const state = sketches.getSketchBatch(taskId);
  assert.equal(state.active, false);
  assert.equal(state.progress.status, 'failed');
  assert.equal(state.progress.error_code, 'SKETCH_BATCH_INTERRUPTED');
  assert.equal(state.progress.requested, 3);
  assert.equal(state.progress.completed, 0);
  assert.equal(state.progress.processed, 0);
  assert.equal(state.progress.percent, 0);
  assert.ok(state.progress.finished_at, '0% 中断批次必须写入终态时间，不能继续显示 running');
  const task = storage.getTask(taskId);
  assert.equal(task.generation_progress.status, 'failed');
  assert.equal(task.generation_progress.percent, 0);
  assert.equal(storage.listModelCalls(taskId).length, 0);
}

function testStoryboardWaitAndCompactLayoutContract() {
  const view = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/storyboardView.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../public/story-ad/storyboard-simple.css'), 'utf8');
  assert.match(view, /image_gate/);
  assert.match(view, /pendingSketchIndexes/);
  assert.match(view, /is-indeterminate/);
  assert.doesNotMatch(view, /storyboard-stale-notice/, '非阻塞的建议复核数量不得继续占用整页横幅');
  assert.match(view, /剧情依据/);
  assert.match(css, /storyboard-simple-view \.sketch-tile-media \.media \{[^}]*object-fit:cover/s);
  assert.match(css, /storyboard-scene-sequence ol\{[^}]*flex:1 1 auto/s);
  assert.doesNotMatch(view, /aspect-ratio:\$\{Number\(ratio\[1\]\)/);
  assert.match(css, /storyboard-progress-indeterminate/);
  assert.match(css, /storyboard-card-shimmer/);
  assert.doesNotMatch(css, /storyboard-scene-sequence li\{[^}]*min-width:max-content/);
}

function testDirectorConventionalPointerContract() {
  const view = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/directorStudioView.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../public/story-ad/director-studio.css'), 'utf8');
  assert.match(view, /event\.button === 0 && !hit/);
  assert.match(view, /mode === 'drag-entity'/);
  assert.match(view, /mode === 'orbit'/);
  assert.match(view, /正在旋转观察视角/);
  assert.match(view, /pointercancel/);
  assert.match(css, /cursor:grab/);
  assert.match(css, /is-orbiting\{cursor:grabbing\}/);
  assert.match(css, /touch-action:none/);
}

(async () => {
  try {
    await runCase('multi_scene_identifiable_coverage_and_exact_binding', testMultiSceneCoverageAndExactBinding);
    await runCase('scene_master_plus_detail_reference_pack', testMasterAndDetailReferencePack);
    await runCase('generated_image_scene_and_reference_lineage', testGeneratedImageLineageAndPackInvalidation);
    await runCase('modern_image_scene_authority_change_invalidation', testModernImageInvalidatesWhenSceneAuthorityChanges);
    await runCase('legacy_image_compatibility_and_change_invalidation', testLegacyImageCompatibilityAndChangeInvalidation);
    await runCase('zero_percent_interrupted_batch_terminal_state', testZeroPercentInterruptedBatchIsTerminal);
    await runCase('storyboard_compact_layout_and_visible_wait_state', testStoryboardWaitAndCompactLayoutContract);
    await runCase('director_left_drag_rotation_and_feedback', testDirectorConventionalPointerContract);

    const failed = results.filter(result => !result.passed);
    const modelCalls = storage.listTasks().reduce((total, task) => total + storage.listModelCalls(task.id).length, 0);
    const report = {
      passed: failed.length === 0,
      checks: results.length,
      passed_checks: results.length - failed.length,
      failed_checks: failed.length,
      fixture_image_adapter_calls: fixtureImageAdapterCalls,
      external_provider_calls: 0,
      recorded_model_calls: modelCalls,
      production_writes: 0,
      results: results.map(({ stack, ...result }) => result),
    };
    console.log(JSON.stringify(report, null, 2));
    if (failed.length) {
      failed.forEach(result => console.error(`\n[${result.name}]\n${result.stack}`));
      process.exitCode = 1;
    }
  } finally {
    try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
