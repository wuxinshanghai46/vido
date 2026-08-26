'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-scene-config-deadline-v109-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const storage = require('../src/services/newStoryAd/storageService');
const jobs = require('../src/services/newStoryAd/jobService');
const service = require('../src/services/newStoryAd/storyAdService');
const checkpointLineage = require('../src/services/newStoryAd/assetPlanCheckpointLineageService');

function waitUntil(predicate, timeoutMs = 8000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('scene config deadline test timed out'));
      }
    }, 15);
  });
}

async function main() {
  const created = service.createTask({
    brief: '两位普通人在社区活动中从误解到合作，按用户内容补足过程。',
    content_mode: 'narrative_story',
    content_mode_source: 'user',
    product_subject: '',
    target_duration: 60,
    shot_count: 10,
  }, { id: 'deadline-owner', role: 'user' });
  const taskId = created.task.id;

  assert.equal(service.sceneConfigStageBudgetMs(taskId), 450000, '故事与场景都缺失时必须分别预留三个候选预算');
  storage.saveOutput(taskId, 'asset_plan_draft_checkpoint', {
    ...checkpointLineage.checkpointFields(storage.getTask(taskId)),
    fingerprint: require('../src/services/newStoryAd/assetPlanService').fingerprint(storage.getTask(taskId), storage.getOutput(taskId, 'context')),
    content_mode: 'narrative_story',
    status: 'narrative_story_locked',
    reusable: true,
    valid_sections: ['cast_profiles', 'prop_plan', 'story_seed'],
    missing_sections: ['scene_plan'],
    payload: {
      cast_profiles: [{ id: 'person_1' }, { id: 'person_2' }],
      prop_plan: [{ id: 'prop_1' }],
      story_seed: { plot_beats: [{ id: 'beat_1' }] },
      scene_plan: { spaces: [] },
    },
  });
  assert.equal(service.sceneConfigStageBudgetMs(taskId), 240000, '故事检查点已锁定时只能为缺失场景阶段计算预算');
  assert.equal(service.sceneConfigStageBudgetMs(taskId, { replan_scene_coverage: true }), 450000, '主动重建场景覆盖会同时重建故事与场景，必须使用双阶段预算');

  const currentContext = storage.getOutput(taskId, 'context');
  storage.saveOutput(taskId, 'context', { ...currentContext, story_scene_contract_version: 3 });
  assert.equal(service.sceneConfigStageBudgetMs(taskId), 450000, '旧场景合同升级时不得误用单阶段预算');
  storage.saveOutput(taskId, 'context', currentContext);

  const recovery = jobs.deadlineRecoveryState(taskId, 'scene_config');
  assert.deepEqual(recovery.valid_sections, ['cast_profiles', 'prop_plan', 'story_seed']);
  assert.deepEqual(recovery.missing_sections, ['scene_plan']);
  assert.match(recovery.message, /已保留人物、道具、故事规划/);
  assert.match(recovery.message, /只继续生成缺失的场景规划/);

  const queued = jobs.queueStage({
    taskId,
    stage: 'scene_config',
    deadlineMs: 5000,
    execute: async () => {
      await new Promise(resolve => setTimeout(resolve, 6000));
    },
  });
  assert.equal(queued.accepted, true);
  await waitUntil(() => storage.getTask(taskId)?.error_code === 'STAGE_DEADLINE_EXCEEDED');
  const task = storage.getTask(taskId);
  const stage = (storage.getTaskBundle(taskId, { diagnostics: true }).stages || [])
    .find(item => item.stage === 'scene_config');
  const checkpoint = storage.getOutput(taskId, 'asset_plan_draft_checkpoint');
  assert.equal(task.retryable, true);
  assert.match(task.error, /已保留人物、道具、故事规划/);
  assert.match(task.error, /不会重复生成已完成区段/);
  assert.equal(stage.diagnostics.partial_results_saved, true);
  assert.equal(stage.diagnostics.deadline_ms, 5000, '队列保留最小安全时限并记录真实预算');
  assert.deepEqual(stage.diagnostics.missing_sections, ['scene_plan']);
  assert.deepEqual(checkpoint.valid_sections, ['cast_profiles', 'prop_plan', 'story_seed'], '超时收尾不得覆盖可恢复检查点');
  assert.equal((storage.getTaskBundle(taskId, { diagnostics: true }).model_calls || []).length, 0);

  const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/newStoryAd.js'), 'utf8');
  assert.match(routeSource, /router\.post\('\/tasks\/:id\/scene-config'[\s\S]*?LEGACY_SCENE_CONFIG_ROUTE_DISABLED[\s\S]*?status = 410/, '旧 scene-config 路由必须保持不可重试拒绝壳');
  assert.match(routeSource, /router\.post\('\/tasks\/:id\/scene-plan'[\s\S]*?sceneConfigStageBudgetMs\(task\.id, \{ replan_scene_coverage: true \}\)/, '当前 scene-plan 路由必须保留场景规划安全预算');

  console.log(JSON.stringify({
    passed: true,
    full_two_phase_budget_ms: 450000,
    resumed_scene_only_budget_ms: 240000,
    forced_replan_budget_ms: 450000,
    stale_contract_upgrade_budget_ms: 450000,
    checkpoint_preserved_on_deadline: true,
    partial_state_message_accurate: true,
    legacy_scene_config_route_disabled: true,
    scene_plan_route_uses_safe_budget: true,
    real_model_calls: 0,
  }, null, 2));
}

main().finally(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
}).catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
