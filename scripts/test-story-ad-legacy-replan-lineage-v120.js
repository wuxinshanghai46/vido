'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-legacy-replan-lineage-v120-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const storage = require('../src/services/newStoryAd/storageService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const checkpointLineage = require('../src/services/newStoryAd/assetPlanCheckpointLineageService');
const storySceneCoverage = require('../src/services/newStoryAd/storySceneCoverageService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const jobs = require('../src/services/newStoryAd/jobService');
const publication = require('../src/services/newStoryAd/assetPlanPublicationService');

const originalGenerateText = modelGateway.generateText;

(async () => {
  const taskId = 'legacy-replan-lineage-v120';
  const context = {
    request_id: taskId,
    brief: '两位普通人在共同解决一次社区停电后消除误解，并在恢复照明时达成和解。',
    content_mode: 'narrative_story',
    content_mode_source: 'user',
    product_subject: '',
    product_presentation: { mode: 'narrative_story', subject: '' },
    story_scene_contract_version: storySceneCoverage.CONTRACT_VERSION,
    expected_people: 2,
    cast_mode: 'dual',
    target_duration: 60,
    shot_count: 10,
    output_ratio: '9:16',
    cast_profiles: [],
    characters: [],
    pet_profiles: [],
    prop_assets: [],
    scene_assets: [{ id: 'legacy_scene', status: 'planned' }],
    assets: [],
    forbidden: [],
    creative_direction: {},
    performance: {},
  };
  storage.createTask({ id: taskId, brief: context.brief, content_revision: 5, request: context });
  storage.saveOutput(taskId, 'context', context);
  storage.updateTask(taskId, {
    status: 'failed',
    stage: 'scene_config_failed',
    planning_migration_state: 'legacy_assets_read_only',
    legacy_planning_read_only: true,
  });
  const task = storage.getTask(taskId);
  const currentFingerprint = assetPlan.fingerprint(task, context);
  storage.saveOutput(taskId, 'asset_plan_draft_checkpoint', {
    status: 'narrative_identity_recovered',
    fingerprint: currentFingerprint,
    content_mode: 'narrative_story',
    reusable: true,
    valid_sections: ['cast_profiles', 'prop_plan'],
    missing_sections: ['scene_plan', 'story_seed'],
    payload: {
      cast_profiles: [{ id: 'legacy_person', name: '旧人物规划' }],
      prop_plan: [{ id: 'legacy_prop', name: '旧道具规划' }],
      scene_plan: { spaces: [] },
      story_seed: {},
    },
  });

  const decision = checkpointLineage.compatibility(task, storage.getOutput(taskId, 'asset_plan_draft_checkpoint'), {
    fingerprint: currentFingerprint,
    contentMode: 'narrative_story',
    requireReusable: true,
  });
  assert.equal(decision.reusable, false);
  assert(decision.issues.includes('task_legacy_planning_read_only'));
  assert(decision.issues.includes('checkpoint_bundle_mismatch'));
  assert.equal(storyAd.sceneConfigStageBudgetMs(taskId), 450000, '旧任务不得按旧检查点错误分配单阶段预算');
  assert.equal(jobs.deadlineRecoveryState(taskId, 'scene_config'), null, '失败提示不得宣称旧检查点可只补缺失区段');

  let unifiedPlanningCalls = 0;
  modelGateway.generateText = async options => {
    if (options.stage === 'new_story_ad.asset_plan') {
      unifiedPlanningCalls += 1;
      const error = new Error('CURRENT_BUNDLE_REPLAN_REACHED');
      error.code = 'TEST_CURRENT_BUNDLE_REPLAN_REACHED';
      throw error;
    }
    throw new Error(`旧检查点被错误复用并进入阶段：${options.stage}`);
  };
  await assert.rejects(
    () => assetPlan.generate(taskId, { replan_scene_coverage: true }),
    error => error?.code === 'TEST_CURRENT_BUNDLE_REPLAN_REACHED',
  );
  assert.equal(unifiedPlanningCalls, 1, '显式重新规划必须进入当前 bundle 的完整规划，而不是续用旧 draft');
  assert.equal(publication.activeRecord(taskId), null, '当前规划失败时不得激活旧计划');
  assert.equal(storage.getTask(taskId).legacy_planning_read_only, true, '只有当前规划成功后才能解除隔离');

  const currentPatch = checkpointLineage.currentPlanningTaskPatch();
  assert.equal(currentPatch.planning_migration_state, 'current_bundle');
  assert.equal(currentPatch.legacy_planning_read_only, false);
  assert.match(currentPatch.required_bundle_id, /^[a-f0-9]{64}$/);

  console.log(JSON.stringify({
    passed: true,
    checks: 13,
    legacy_checkpoint_reused: false,
    current_bundle_replan_calls: unifiedPlanningCalls,
    stale_checkpoint_budget_ms: 450000,
    stale_recovery_projection: false,
    active_plan_after_failure: false,
    real_model_calls: 0,
    paid_calls: 0,
  }));
})().finally(() => {
  modelGateway.generateText = originalGenerateText;
  fs.rmSync(outputDir, { recursive: true, force: true });
}).catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
