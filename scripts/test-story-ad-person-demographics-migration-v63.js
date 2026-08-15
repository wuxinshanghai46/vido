'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-person-demographics-v63-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const storage = require('../src/services/newStoryAd/storageService');
const migration = require('./migrate-story-ad-person-demographics-v63');

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || null)).digest('hex');
}

function missingProfile() {
  return {
    id: 'shen_yanci_ancient',
    name: '沈砚辞（古代）',
    role: '古代侠客，成年男性，云知月的恋人',
    appearanceText: '原创古代侠客外貌，沉静坚定',
    wardrobeText: '深色古代侠装',
    look_profiles: [{
      id: 'shen_yanci_ancient_look',
      name: '古代侠客造型',
      scene_ids: ['ancient_courtyard'],
      wardrobeText: '深色古代侠装',
    }],
  };
}

function scenePlan() {
  return {
    advertised_subject: '',
    cast_mode: 'single',
    scene_mode: 'single',
    spaces: [{ id: 'ancient_courtyard', name: '古代庭院', description: '月下庭院' }],
  };
}

function createMigratable(id) {
  const castProfiles = [missingProfile()];
  const context = {
    request_id: id,
    brief: '成年侠客沈砚辞在古代庭院守望恋人，全部人物均为原创虚构角色',
    content_mode: 'narrative_story',
    cast_mode: 'single',
    expected_people: 1,
    cast_profiles: castProfiles,
    narrative_cast_profiles: castProfiles,
    person_spec: { expectedPeople: 1 },
    context_only_marker: 'must-not-expand-task-request',
  };
  const taskRequest = { ...context, context_only_marker: undefined, request_only_marker: 'must-remain' };
  storage.createTask({ id, status: 'done', stage: 'final_done', content_revision: 8, brief: context.brief, request: taskRequest });
  storage.saveOutput(id, 'context', context);
  storage.saveOutput(id, 'asset_plan', {
    cast_profiles: castProfiles,
    scene_plan: scenePlan(),
    fingerprint: 'legacy-fingerprint',
  });
  storage.saveOutput(id, 'asset_plan_active', {
    plan_id: 'stable-active-plan-id',
    active_revision: 3,
    fingerprint: 'legacy-fingerprint',
    plan: {
      plan_id: 'stable-inner-plan-id',
      status: 'active',
      cast_profiles: castProfiles,
      scene_plan: scenePlan(),
      fingerprint: 'legacy-fingerprint',
    },
  });
  storage.saveOutput(id, 'asset_plan_candidate', {
    plan_id: 'stable-candidate-plan-id',
    candidate_revision: 4,
    fingerprint: 'legacy-fingerprint',
    plan: {
      plan_id: 'stable-candidate-inner-id',
      status: 'candidate',
      cast_profiles: castProfiles,
      scene_plan: scenePlan(),
      fingerprint: 'legacy-fingerprint',
    },
  });
  return context;
}

function invariant(taskId) {
  const context = storage.getOutput(taskId, 'context');
  const asset = storage.getOutput(taskId, 'asset_plan');
  const active = storage.getOutput(taskId, 'asset_plan_active');
  const candidate = storage.getOutput(taskId, 'asset_plan_candidate');
  return {
    ids: context.cast_profiles.map(item => item.id),
    lookIds: context.cast_profiles.map(item => (item.look_profiles || []).map(look => look.id)),
    scenes: [asset.scene_plan, active.plan.scene_plan, candidate.plan.scene_plan].map(digest),
    planIds: [active.plan_id, active.plan.plan_id, candidate.plan_id, candidate.plan.plan_id],
  };
}

function assertDemographics(taskId) {
  const outputs = [
    storage.getOutput(taskId, 'context'),
    storage.getOutput(taskId, 'asset_plan'),
    storage.getOutput(taskId, 'asset_plan_active').plan,
    storage.getOutput(taskId, 'asset_plan_candidate').plan,
  ];
  outputs.forEach((output, index) => {
    const row = output.cast_profiles[0];
    assert.match(String(row.age || row.age_range || ''), /\d{1,3}\s*(?:岁|~|～|-|—|–|至|到)/u, `副本${index}必须补齐年龄`);
    assert.equal(row.ethnicity, '未指定（原创角色，可修改）', `副本${index}未知地域不得猜测族裔`);
    assert.equal(row.age_source, 'platform_story_inference', `副本${index}必须保留年龄来源`);
    assert.equal(row.ethnicity_source, 'user_confirmable_default', `副本${index}必须保留原创默认来源`);
  });
}

try {
  createMigratable('demographics-migratable');
  const before = invariant('demographics-migratable');
  const dryRun = migration.preview('demographics-migratable');
  assert.equal(dryRun.changed, true);
  assert.equal(storage.getOutput('demographics-migratable', 'person_demographics_migration_backup_v63'), null, 'dry-run不得写备份');
  assert.equal(storage.getOutput('demographics-migratable', 'context').cast_profiles[0].age, undefined, 'dry-run不得改上下文');

  const applied = migration.apply('demographics-migratable');
  assert.equal(applied.applied, true);
  assert.equal(applied.model_calls_delta, 0, '迁移不得触发模型调用');
  assertDemographics('demographics-migratable');
  assert.equal(
    storage.getOutput('demographics-migratable', 'context').asset_plan_generated_cast_fingerprint,
    storage.canonicalFingerprint(storage.getOutput('demographics-migratable', 'context').cast_profiles),
    '派生人物指纹必须使用与资产计划相同的canonical算法',
  );
  assert.deepEqual(invariant('demographics-migratable'), before, '人物、造型、场景与计划稳定ID不得变化');
  assert(storage.getOutput('demographics-migratable', 'person_demographics_migration_backup_v63'), '应用前必须写可恢复备份');
  assert.equal(storage.readDb().model_calls.length, 0);
  const migratedRequest = storage.getTask('demographics-migratable').request;
  assert.equal(migratedRequest.request_only_marker, 'must-remain', '迁移必须保留原任务请求字段');
  assert.equal(migratedRequest.context_only_marker, undefined, '迁移不得把完整context扩写进task.request权威');
  assert(migratedRequest.cast_profiles[0].age, 'task.request作为context缺失时的恢复来源，必须同步人口字段');
  assert.equal(migration.apply('demographics-migratable').applied, false, '迁移必须幂等');

  createMigratable('demographics-active-blocked');
  storage.updateTask('demographics-active-blocked', { active_generation_id: 'generation-running' });
  const activeBefore = digest(storage.getTaskBundle('demographics-active-blocked'));
  assert.throws(
    () => migration.apply('demographics-active-blocked'),
    error => error.code === 'PERSON_DEMOGRAPHICS_MIGRATION_ACTIVE_TASK_BLOCKED',
    '活动生成必须在任何写入前阻断迁移',
  );
  assert.equal(digest(storage.getTaskBundle('demographics-active-blocked')), activeBefore, '活动生成阻断后不得部分写入');

  createMigratable('demographics-billing-blocked');
  storage.saveModelCall({
    id: 'unknown-charge',
    task_id: 'demographics-billing-blocked',
    stage: 'person_generation',
    status: 'failed',
    provider_submission_state: 'submitted_unknown',
    billing_state: 'unknown',
  });
  const billingBefore = digest(storage.getTaskBundle('demographics-billing-blocked'));
  assert.throws(
    () => migration.apply('demographics-billing-blocked'),
    error => error.code === 'PERSON_DEMOGRAPHICS_MIGRATION_BILLING_UNKNOWN_BLOCKED',
    '未核清计费必须在任何写入前阻断迁移',
  );
  assert.equal(digest(storage.getTaskBundle('demographics-billing-blocked')), billingBefore, '计费未知阻断后不得部分写入');

  console.log(JSON.stringify({
    passed: true,
    copies_updated: ['context', 'asset_plan', 'asset_plan_active', 'asset_plan_candidate'],
    stable_ids_preserved: true,
    active_generation_blocked: true,
    billing_unknown_blocked: true,
    idempotent: true,
    model_calls: 0,
    paid_calls: 0,
  }));
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
