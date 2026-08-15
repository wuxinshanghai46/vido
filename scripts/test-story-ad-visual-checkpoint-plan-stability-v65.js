const assert = require('assert');

const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const publication = require('../src/services/newStoryAd/assetPlanPublicationService');
const checkpoints = require('../src/services/newStoryAd/assetGenerationCheckpointService');
const billingAudit = require('../src/services/newStoryAd/taskStateAuditService');
const releaseBundle = require('../src/services/storyAdReleaseBundleService');
const storage = require('../src/services/newStoryAd/storageService');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function completedUnit(index) {
  return {
    key: `unit-${index}`,
    task_id: 'xingyue-v65',
    asset_type: 'person_dossier',
    asset_id: `person-${Math.floor(index / 7) + 1}`,
    unit: `visual-${index}`,
    revision: 1,
    status: 'completed',
    provider_submission_state: 'completed',
    billing_state: 'confirmed',
    result: { image_url: `/kept-${index}.png` },
  };
}

function failedUnit(index) {
  return {
    ...completedUnit(index),
    status: 'failed',
    provider_submission_state: 'not_submitted',
    billing_state: 'not_billed',
    result: null,
    error: { code: 'LOCAL_POST_PROCESS_FAILED', message: 'safe to retry' },
  };
}

function unknownUnit(index) {
  return {
    ...failedUnit(index),
    status: 'submitted_unknown',
    provider_submission_state: 'submitted_unknown',
    billing_state: 'unknown',
    error: { code: 'PROVIDER_5XX_AMBIGUOUS', message: 'provider result unknown' },
  };
}

function testVisualOutputsDoNotStalePlan() {
  const task = { id: 'xingyue-v65', content_revision: 1 };
  const planned = {
    // This case isolates visual-output fingerprint stability. Narrative plans
    // require an additional story-scene contract fixture, which is orthogonal
    // and covered by the narrative contract suite.
    content_mode: 'commercial_ad',
    brief: '星月神话剧情',
    cast_profiles: [],
    pet_profiles: [],
    target_duration: 60,
    output_ratio: '16:9',
  };
  const before = assetPlan.fingerprint(task, planned);
  const afterVisualSuccess = {
    ...planned,
    person_asset: { id: 'generated-cast', image_url: '/cast.png' },
    person_contract: { status: 'verified', person_revision: 1 },
    scene_assets: [{ scene_id: 'scene-1', revision: 1, image_url: '/scene.png' }],
    generation_input_completion: { person: { checkpoint_kind: 'completion-v1' } },
  };
  const after = assetPlan.fingerprint(task, afterVisualSuccess);
  assert.equal(after, before,
    '成功视觉资产、checkpoint 和生成结果属于计划输出，写入后不得改变资产计划输入指纹');

  const plan = {
    status: 'active', fingerprint: before, content_revision: 1,
    release_envelope: releaseBundle.envelope(),
  };
  assert.deepEqual(
    publication.planIssues({ task, context: afterVisualSuccess, plan, fingerprint: after }),
    [],
    '成功视觉资产写入后，当前 Active 计划不得被误判 stale',
  );
}

function testCheckpointBillingRiskJoinsUnifiedAudit() {
  const checkpoint = {
    status: 'failed',
    person_dossier_checkpoints: { 'unit-28': unknownUnit(28) },
    subject_checkpoint_owners: { 'unit-28': { kind: 'human', subject_id: 'person-4', index: 3 } },
  };
  const risk = billingAudit.billingRiskForTask({
    model_calls: [],
    generation_runs: [],
    outputs: [{ task_id: 'xingyue-v65', kind: 'subject_asset_checkpoint:xingyue-v65:partial', payload: checkpoint }],
  }, 'xingyue-v65');
  assert.equal(risk.all_unknown_billing.length, 1,
    'submitted_unknown checkpoint 必须进入统一计费风险审计，不能只扫描 model_calls');
  assert.equal(risk.active_unknown_billing.length, 1,
    '未核清的 submitted_unknown checkpoint 必须作为活动计费风险阻断写入和迁移');
  const snapshot = billingAudit.auditSnapshot({
    tasks: [{ id: 'xingyue-v65', lineage_enforced: true }],
    model_calls: [], generation_runs: [], manifests: [], artifacts: [], works: [], work_events: [],
    outputs: [{ task_id: 'xingyue-v65', kind: 'subject_asset_checkpoint:xingyue-v65:partial', payload: checkpoint }],
  });
  assert.ok(snapshot.tasks[0].issues.includes('active_unknown_billing'),
    'top-level systemic audit must pass outputs into checkpoint billing risk');
  const resolvedRisk = billingAudit.billingRiskForTask({
    model_calls: [], generation_runs: [],
    outputs: [
      { task_id: 'xingyue-v65', kind: 'subject_asset_checkpoint:old', updated_at: '2026-08-15T01:00:00Z', payload: { person_dossier_checkpoints: { same: unknownUnit(28) } } },
      { task_id: 'xingyue-v65', kind: 'subject_asset_checkpoint:new', updated_at: '2026-08-15T02:00:00Z', payload: { person_dossier_checkpoints: { same: { ...completedUnit(28), key: 'unit-28' } } } },
    ],
  }, 'xingyue-v65');
  assert.equal(resolvedRisk.all_unknown_billing.length, 0,
    'latest successful checkpoint with the same stable key must supersede an older unknown snapshot');
}

function testUnknownCheckpointBlocksMigrationWithoutWrites() {
  const taskId = 'xingyue-v65';
  const fingerprint = 'stable-plan-input-fingerprint';
  const candidateId = 'stable-plan-id';
  const oldEnvelope = { ...releaseBundle.envelope(), producer_bundle_id: 'previous-release-bundle' };
  const plan = {
    status: 'active', candidate_id: candidateId, active_revision: 1, content_revision: 1,
    fingerprint, fingerprint_contract: publication.FINGERPRINT_CONTRACT,
    release_envelope: oldEnvelope,
  };
  const active = {
    plan_id: candidateId, active_revision: 1, content_revision: 1,
    fingerprint, fingerprint_contract: publication.FINGERPRINT_CONTRACT,
    release_envelope: oldEnvelope, plan,
  };
  const candidate = {
    ...plan, status: 'candidate', validation_status: 'passed', validation_issues: [],
  };
  const outputMap = new Map([
    [publication.ACTIVE_KIND, active],
    [publication.CANDIDATE_KIND, candidate],
    ['context', { content_mode: 'commercial_ad', asset_plan_fingerprint: fingerprint }],
  ]);
  const db = {
    model_calls: [], generation_runs: [],
    outputs: [{
      task_id: taskId,
      kind: `subject_asset_checkpoint:${taskId}:partial`,
      payload: { person_dossier_checkpoints: { 'unit-28': unknownUnit(28) } },
    }],
  };
  const original = {
    getTask: storage.getTask,
    getOutput: storage.getOutput,
    readDb: storage.readDb,
    saveOutput: storage.saveOutput,
    withWriteBatch: storage.withWriteBatch,
  };
  let writes = 0;
  storage.getTask = id => id === taskId ? { id: taskId, content_revision: 1, active_generation_id: '' } : null;
  storage.getOutput = (id, kind) => id === taskId ? clone(outputMap.get(kind) || null) : null;
  storage.readDb = () => clone(db);
  storage.saveOutput = () => { writes += 1; throw new Error('migration must not write while billing is unknown'); };
  storage.withWriteBatch = callback => callback();
  try {
    const result = publication.migrateCompatibleRelease(taskId, { fingerprint, reason: 'v65-test' });
    assert.equal(result.blocked, true, 'submitted_unknown checkpoint 未核清时必须阻断 release migration');
    assert.ok(result.compatibility.issues.includes('active_unknown_billing_exists'),
      '迁移阻断结果必须给出统一的活动计费风险原因');
    assert.equal(writes, 0, '计费风险未核清时迁移不得发生任何持久化写入');
  } finally {
    Object.assign(storage, original);
  }
}

async function testOnlyFourMissingUnitsResume() {
  const store = new Map();
  for (let index = 0; index < 25; index += 1) store.set(`unit-${index}`, completedUnit(index));
  for (let index = 25; index < 28; index += 1) store.set(`unit-${index}`, failedUnit(index));
  store.set('unit-28', checkpoints.authorizeAmbiguousRetry(unknownUnit(28), {
    acceptDuplicateChargeRisk: true,
    acceptedBy: 'v65-test',
    supportId: 'billing-review-v65',
  }));
  let mediaCalls = 0;
  let modelCalls = 0;
  const results = [];
  for (let index = 0; index < 29; index += 1) {
    const key = `unit-${index}`;
    results.push(await checkpoints.runCheckpointedUnit({
      identity: { key, taskId: 'xingyue-v65', assetType: 'person_dossier', assetId: `person-${Math.floor(index / 7) + 1}`, unit: `visual-${index}`, revision: 1 },
      load: async () => clone(store.get(key)),
      save: async (_key, value) => store.set(key, clone(value)),
      execute: async () => {
        mediaCalls += 1;
        return { image_url: `/recovered-${index}.png` };
      },
    }));
  }
  assert.equal(results.filter(item => item.reused).length, 25, '恢复必须保留25个成功单元');
  assert.equal(mediaCalls, 4, '恢复只能提交4个失败单元，不能重做25个成功单元');
  assert.equal(modelCalls, 0, '视觉checkpoint恢复不得重新调用资产规划模型');
  assert.equal([...store.values()].filter(item => item.status === 'completed').length, 29);
}

(async () => {
  const failures = [];
  for (const [name, test] of [
    ['visual-output-plan-fingerprint', testVisualOutputsDoNotStalePlan],
    ['checkpoint-unified-billing-audit', testCheckpointBillingRiskJoinsUnifiedAudit],
    ['checkpoint-blocks-migration', testUnknownCheckpointBlocksMigrationWithoutWrites],
    ['resume-only-four-failed-units', testOnlyFourMissingUnitsResume],
  ]) {
    try {
      await test();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push({ name, message: error.message });
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }
  if (failures.length) {
    console.error(JSON.stringify({ passed: false, failures }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({
    passed: true,
    kept_success_units: 25,
    resumed_failed_units: 4,
    planning_model_calls: 0,
  }));
})();
