'use strict';
const assert = require('assert');
const { createService } = require('../src/services/newStoryAd/subjectRecoveryPreflightService');
const castLineage = require('../src/services/newStoryAd/assetPlanCastLineageService');
function fixture(compatible = true, { failAfterWrite = false } = {}) {
  let task = { id: 'task-v81', content_revision: 4, request: { revisions: { person_semantic: 2 } } };
  let context = { cast_profiles: [{ id: 'person-1' }], revisions: { person_semantic: 2 } };
  const outputs = new Map([['context', context]]); let writes = 0, contextWritten = false;
  const canonicalFingerprint = value => JSON.stringify(value);
  const storage = { getTask: () => task, getOutput: (_id, kind) => outputs.get(kind) || null, listOutputs: () => [{ kind: 'subject_asset_checkpoint:old', payload: checkpoint }], readDb: () => ({}), canonicalFingerprint,
    saveOutput: (_id, kind, value) => { outputs.set(kind, value); if (kind === 'context') { context = value; contextWritten = true; } writes += 1; },
    updateTask: (_id, patch) => { task = { ...task, ...patch }; writes += 1; },
    withWriteBatch(fn) { const bt = structuredClone(task), bc = structuredClone(context), bo = new Map(outputs), bw = writes, bWritten = contextWritten;
      try { return fn(); } catch (error) { task = bt; context = bc; outputs.clear(); bo.forEach((v, k) => outputs.set(k, v)); writes = bw; contextWritten = bWritten; throw error; } },
  };
  const checkpoint = { status: 'failed', input_profiles: { humans: [{ id: 'person-1', displayName: '人物1', wardrobeText: '银耳钉' }] }, targets: [{ kind: 'human', id: 'person-1', index: 0, key: 'human:person-1' }], person_dossier_checkpoints: { a: { status: 'completed' }, b: { status: 'completed' }, c: { status: 'failed', billing_review: { state: 'not_billed' } } } };
  const subjectAssets = { resolveCounts: () => ({ people: 1, pets: 0 }), humanMemberSpecs: () => [{ id: 'person-1' }], petMemberSpecs: () => [],
    requestedSubjectTargets: () => ({ selected: [{ kind: 'human', id: 'person-1', index: 0, key: 'human:person-1' }] }), personProfileResumeCompatible: (before, after) => before.id === after.id,
    personProfileResumeCompatibility: () => compatible ? { compatible: true, differences: [] } : { compatible: false, differences: [{ subject_id: 'person-1', display_name: '人物1', field: 'look_profiles.0.accessories', field_path: 'look_profiles.0.accessories', reason_code: 'positive_structure_changed', before: { length: 4, fingerprint: 'before' }, after: { length: 4, fingerprint: 'after' }, action: 'review_required' }] },
    resumablePartialCheckpoint: () => compatible ? checkpoint : null };
  const assetPlan = { fingerprint: (_task, ctx) => ctx.asset_plan_generated_cast_fingerprint === castLineage.fingerprint(ctx.cast_profiles) && ctx.revisions?.person_semantic === 1 ? 'ACTIVE' : 'CURRENT' };
  const publication = { activeRecord: () => ({ fingerprint: 'ACTIVE', plan: { fingerprint: 'ACTIVE', cast_profiles: [{ id: 'person-1' }] } }),
    eligibility: (_id, { fingerprint }) => {
      const eligible = fingerprint === 'ACTIVE' && !(failAfterWrite && contextWritten);
      return { eligible, issues: eligible ? [] : ['input_fingerprint_mismatch'] };
    } };
  const taskStateAudit = { billingRiskForTask: () => ({ active_unknown_billing: [], unquarantined_unknown_billing: [] }) };
  return { service: createService({ storage, subjectAssets, assetPlan, publication, taskStateAudit }), writes: () => writes };
}
const body = { cast_profiles: [{ id: 'person-1' }], subject_targets: [{ kind: 'human', id: 'person-1', index: 0 }] };
const safe = fixture(), preview = safe.service.preview('task-v81', body);
assert.equal(preview.state, 'safe_rebase_available'); assert.equal(preview.retained_count, 2); assert.equal(preview.missing_count, 1); assert.equal(preview.model_call_count, 0);
const before = safe.writes(); assert.throws(() => safe.service.apply('task-v81', body, 'stale'), e => e.code === 'SUBJECT_RECOVERY_PREFLIGHT_STALE'); assert.equal(safe.writes(), before);
assert.equal(safe.service.apply('task-v81', body, preview.proof_token).state, 'ready'); assert.equal(safe.service.preview('task-v81', body).state, 'ready');
const blocked = fixture(false), report = blocked.service.preview('task-v81', body), blockedWrites = blocked.writes();
assert.equal(report.state, 'blocked'); assert.throws(() => blocked.service.apply('task-v81', body, report.proof_token), e => e.code === 'SUBJECT_RECOVERY_PREFLIGHT_BLOCKED'); assert.equal(blocked.writes(), blockedWrites);
assert(report.differences.some(item => item.subject_id === 'person-1' && item.field === 'look_profiles.0.accessories'
  && item.before?.fingerprint && item.after?.fingerprint && item.reason_code === 'positive_structure_changed'),
  'blocked preflight must expose the specific person/field and redacted before/after summaries');
const concreteDifference = report.differences.find(item => item.subject_id && (item.subject_name || item.display_name)
  && item.field && item.reason_code
  && (Object.hasOwn(item, 'before_summary') || Object.hasOwn(item, 'before'))
  && (Object.hasOwn(item, 'after_summary') || Object.hasOwn(item, 'after')));
assert(concreteDifference,
  'an unsafe profile must report person id/name, field, reason code and before/after summaries instead of only a generic checkpoint message');
assert.match(concreteDifference.message, /人物1.*配饰.*变化/,
  'the public UI message must identify the affected person and field in Chinese');
assert.doesNotMatch(JSON.stringify(concreteDifference), /(?:system_prompt|raw_prompt|api[_-]?key|authorization)/i,
  'the public compatibility difference must not expose internal prompts or credentials');
const failedRebase = fixture(true, { failAfterWrite: true }), failedPreview = failedRebase.service.preview('task-v81', body), failedWrites = failedRebase.writes();
assert.equal(failedPreview.state, 'safe_rebase_available');
assert.throws(() => failedRebase.service.apply('task-v81', body, failedPreview.proof_token), e => e.code === 'SUBJECT_RECOVERY_PREFLIGHT_REBASE_FAILED');
assert.equal(failedRebase.writes(), failedWrites, 'a failed post-write eligibility check must roll back backup, context and task writes atomically');
assert.equal(failedRebase.service.preview('task-v81', body).state, 'safe_rebase_available', 'rollback must restore the original recoverable state');
const routeCalls = [], registered = [];
require('../src/routes/newStoryAd/visualAssetBillingRoutes')({
  post: (path, handler) => registered.push({ method: 'POST', path, handler }),
  get: (path, handler) => registered.push({ method: 'GET', path, handler }),
}, {
  asyncRoute: handler => handler, taskForReq: () => routeCalls.push('ownership'), userFromReq: () => ({ id: 'user-v81' }),
  authorization: { authorizeTaskRetry() {}, authorizeTaskRetryBatch() {}, listBillingReviews() { return {}; } },
  recoveryPreflight: { preview: () => { routeCalls.push('preview'); return { state: 'ready', model_call_count: 0 }; } },
});
const route = registered.find(item => item.path.endsWith('/subject-recovery-preflight'));
assert(route && route.method === 'POST');
(async () => {
  let response;
  await route.handler({ params: { id: 'task-v81' }, body: { generation_payload: body } }, {
    setHeader() {}, json(value) { response = value; },
  });
  assert.deepEqual(routeCalls, ['ownership', 'preview'], 'route ownership must run before the preflight service');
  assert.equal(response.state, 'ready');
  console.log(JSON.stringify({ passed: true, stale_zero_writes: true, blocked_zero_writes: true, failed_rebase_zero_writes: true, ownership_before_service: true, model_calls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
