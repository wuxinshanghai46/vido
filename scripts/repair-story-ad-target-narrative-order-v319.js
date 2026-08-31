#!/usr/bin/env node
'use strict';

const storage = require('../src/services/newStoryAd/storageService');
const flow = require('../src/services/storyAdWorkspace/storyFlowContractService');
const { buildKeyframeContracts } = require('../src/services/newStoryAd/keyframeContractService');
const freshness = require('../src/services/newStoryAd/keyframeContractFreshnessService');
const imageGate = require('../src/services/storyAdWorkspace/storyboardImageConfirmationGateService');

const TARGET_TASK_ID = 'b83fa67c-244a-4869-b3cc-df282fad5c59';
const EXPECTED_OLD_FLOW_FINGERPRINT = '2f5cfe5b851c9ffcc581a0d382b9c1bef2c077610e6a689f058d9d4e8748788f';
const EXPECTED_OLD_SCENES = ['space_02_exhibition', 'space_02_exhibition', 'space_02_exhibition', 'space_02_exhibition', 'space_01_showroom', 'space_01_showroom', 'space_02_exhibition'];
const EXPECTED_SEQUENCE = ['space_01_showroom', 'space_02_exhibition'];
const OLD_INDEX_ORDER = [6, 5, 1, 2, 3, 4, 7];

const taskId = String(process.argv[2] || '').trim();
const apply = process.argv.includes('--apply');
if (taskId !== TARGET_TASK_ID) throw Object.assign(new Error('该迁移只允许用于已核准的目标任务'), { code: 'TARGET_TASK_MISMATCH' });
const task = storage.getTask(taskId);
if (!task) throw Object.assign(new Error('TASK_NOT_FOUND'), { code: 'TASK_NOT_FOUND' });
if (task.active_generation_id) throw Object.assign(new Error('当前存在活动生成，拒绝迁移'), { code: 'ACTIVE_GENERATION_BLOCKED' });

const list = value => Array.isArray(value) ? value : [];
const beforeShots = list(storage.getOutput(taskId, 'storyboard_table'));
const beforeImages = list(storage.getOutput(taskId, 'storyboard_images'));
const beforeFlow = storage.getOutput(taskId, 'story_flow_contract') || {};
const beforeCalls = storage.listModelCalls(taskId).length;
const oldScenes = beforeShots.map(shot => String(shot.scene_id || shot.scene_asset_id || ''));
if (beforeShots.length !== 7 || oldScenes.join('|') !== EXPECTED_OLD_SCENES.join('|')) {
  throw Object.assign(new Error('目标任务已不再是核准过的旧分镜顺序，拒绝重复或越界迁移'), { code: 'SOURCE_STORYBOARD_CHANGED' });
}
if (String(beforeFlow.contract_fingerprint || beforeFlow.fingerprint || '') !== EXPECTED_OLD_FLOW_FINGERPRINT) {
  throw Object.assign(new Error('目标任务剧情流合同已变化，拒绝迁移'), { code: 'SOURCE_FLOW_CHANGED' });
}

function reindex(row, index) {
  const number = index + 1;
  const next = { ...row, shot_index: number };
  if (Object.hasOwn(next, 'index')) next.index = number;
  if (Object.hasOwn(next, 'shot_number')) next.shot_number = number;
  if (Object.hasOwn(next, 'shot_no')) next.shot_no = `SH${String(number).padStart(2, '0')}`;
  return next;
}

const migratedShots = OLD_INDEX_ORDER.map(oldIndex => beforeShots[oldIndex - 1]).map(reindex);
const newIndexByOld = new Map(OLD_INDEX_ORDER.map((oldIndex, newIndex) => [oldIndex, newIndex + 1]));
const migratedImages = beforeImages.map(image => ({ ...image, shot_index: newIndexByOld.get(Number(image.shot_index)) || Number(image.shot_index) }))
  .sort((a, b) => Number(a.shot_index) - Number(b.shot_index));
const compiled = freshness.compileCurrentTask(taskId);
const migratedContracts = buildKeyframeContracts(compiled.ctx, migratedShots);
const draft = flow.draft(taskId);
if (draft.narrative_scene_sequence.join('|') !== EXPECTED_SEQUENCE.join('|')) {
  throw Object.assign(new Error('剧情种子声明的场景顺序与核准值不一致'), { code: 'DECLARED_SEQUENCE_CHANGED' });
}
const suppliedUnits = draft.units.map((unit, index) => {
  const sceneId = index < 2 ? EXPECTED_SEQUENCE[0] : EXPECTED_SEQUENCE[1];
  const previousScene = index === 2 ? EXPECTED_SEQUENCE[0] : '';
  return {
    ...unit,
    scene_id: sceneId,
    transition_from: previousScene,
    transition_reason: previousScene ? '剧情种子明确要求先完成家居展示厅体验，再切换至高端商业展台。' : '',
  };
});
flow.validateUnits(draft, suppliedUnits, { requireExact: true });

const reportBase = {
  ok: true,
  task_id: taskId,
  mode: apply ? 'apply' : 'dry_run',
  before_scene_sequence: oldScenes,
  after_scene_sequence: migratedShots.map(shot => shot.scene_id || shot.scene_asset_id || ''),
  old_index_order: OLD_INDEX_ORDER,
  declared_scene_sequence: draft.narrative_scene_sequence,
  provider_calls: 0,
  model_calls_before: beforeCalls,
};
if (!apply) {
  console.log(JSON.stringify({ ...reportBase, applied: false, image_gate_before: imageGate.inspect(taskId) }, null, 2));
  process.exit(0);
}

storage.withWriteBatch(() => {
  storage.saveOutput(taskId, 'narrative_order_migration_v319', {
    status: 'applied',
    source_flow_fingerprint: EXPECTED_OLD_FLOW_FINGERPRINT,
    declared_scene_sequence: EXPECTED_SEQUENCE,
    old_index_order: OLD_INDEX_ORDER,
    provider_calls: 0,
    applied_at: new Date().toISOString(),
  });
  flow.repairSystem(taskId, suppliedUnits, { reason: 'deterministic_story_seed_order_repair_v319' });
  storage.saveOutput(taskId, 'storyboard_table', migratedShots);
  storage.saveOutput(taskId, 'storyboard_images', migratedImages);
  storage.saveOutput(taskId, 'keyframe_contracts', migratedContracts);
  const meta = storage.getOutput(taskId, 'storyboard_meta') || {};
  storage.saveOutput(taskId, 'storyboard_meta', {
    ...meta,
    narrative_order_repair_version: 319,
    narrative_order_repaired_at: new Date().toISOString(),
    narrative_scene_sequence: EXPECTED_SEQUENCE,
  });
});

const afterShots = list(storage.getOutput(taskId, 'storyboard_table'));
const afterCalls = storage.listModelCalls(taskId).length;
const afterSequence = afterShots.map(shot => String(shot.scene_id || shot.scene_asset_id || '')).filter((id, index, rows) => id !== rows[index - 1]);
const gate = imageGate.inspect(taskId);
const ok = afterSequence.join('|') === EXPECTED_SEQUENCE.join('|') && afterCalls === beforeCalls && gate.ready === false;
console.log(JSON.stringify({
  ...reportBase,
  ok,
  applied: true,
  after_collapsed_sequence: afterSequence,
  model_calls_after: afterCalls,
  model_call_delta: afterCalls - beforeCalls,
  image_gate_after: gate,
}, null, 2));
if (!ok) process.exitCode = 5;
