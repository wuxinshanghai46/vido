'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-generation-unit-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const units = require('../src/services/newStoryAd/generationUnitService');
const circuits = require('../src/services/newStoryAd/providerCircuitBreakerService');

const identity = {
  work_id: 'work-generation-1',
  domain: 'video',
  target_permanent_id: 'shot_perm_1',
  operation: 'generate_video',
  input_fingerprint: 'input-fingerprint-v1',
  spec_revision: 1,
  provider_id: 'provider-a',
  model_id: 'model-a',
};

try {
  const first = units.claim(identity);
  assert.strictEqual(first.claimed, true);
  assert.strictEqual(first.unit.state, 'ready');
  assert.strictEqual(first.unit.billing_state, 'not_submitted');
  assert.strictEqual(first.unit.automatic_retry_allowed, false);

  const duplicate = units.claim(identity);
  assert.strictEqual(duplicate.claimed, false);
  assert.strictEqual(duplicate.duplicate, true);
  assert.strictEqual(duplicate.unit.id, first.unit.id);

  const queued = units.transition(first.unit.id, 'queued', {}, { expected_version: 1, reason: 'test_queue' });
  assert.strictEqual(queued.unit_version, 2);
  assert.throws(
    () => units.transition(first.unit.id, 'cancelled', {}, { expected_version: 1 }),
    error => error.code === 'GENERATION_UNIT_VERSION_CONFLICT',
  );
  assert.throws(
    () => units.transition(first.unit.id, 'succeeded', { billing_state: 'confirmed' }),
    error => error.code === 'GENERATION_STATE_TRANSITION_INVALID',
  );

  const submitted = units.transition(first.unit.id, 'submitted', {
    provider_submission_state: 'submitted',
    billing_state: 'unknown',
    provider_task_id: 'provider-task-1',
  }, { expected_version: 2, reason: 'provider_accepted' });
  assert.strictEqual(submitted.state, 'billing_unknown', '未知计费必须直接锁定，而不能伪装成 submitted');
} catch (error) {
  if (error.code !== 'GENERATION_BILLING_UNKNOWN_STATE_REQUIRED') throw error;
  const queued = storage.listGenerationRuns()[0];
  const submitted = units.transition(queued.id, 'submitted', {
    provider_submission_state: 'submitted',
    billing_state: 'confirmed',
    provider_task_id: 'provider-task-1',
  }, { expected_version: queued.unit_version, reason: 'provider_accepted' });
  const unknown = units.transition(submitted.id, 'billing_unknown', {
    provider_submission_state: 'submitted_unknown',
    billing_state: 'unknown',
    error_code: 'PROVIDER_5XX_AMBIGUOUS',
  }, { expected_version: submitted.unit_version, reason: 'ambiguous_provider_failure' });
  assert.strictEqual(unknown.retry_blocked, true);
  assert.throws(
    () => units.assertAutomaticRetryAllowed(unknown),
    retryError => retryError.code === 'GENERATION_BILLING_REVIEW_REQUIRED',
  );
  assert.throws(
    () => units.claim({ ...identity, input_fingerprint: 'input-fingerprint-v2', spec_revision: 2 }),
    claimError => claimError.code === 'GENERATION_BILLING_REVIEW_REQUIRED',
  );
  assert.throws(
    () => units.transition(unknown.id, 'failed_terminal', { billing_state: 'not_billed' }),
    transitionError => transitionError.code === 'GENERATION_BILLING_RECONCILIATION_REQUIRED',
  );
  const reconciled = units.reconcileBilling(unknown.id, {
    outcome: 'failed_terminal', billing_state: 'not_billed', reviewer: 'test-reviewer', evidence: 'provider invoice checked',
  }, { expected_version: unknown.unit_version });
  assert.strictEqual(reconciled.state, 'failed_terminal');
  assert.strictEqual(reconciled.billing_state, 'not_billed');

  const second = units.claim({ ...identity, input_fingerprint: 'input-fingerprint-v2', spec_revision: 2 });
  assert.strictEqual(second.claimed, true);
  assert.notStrictEqual(second.unit.id, unknown.id);
  assert.throws(
    () => units.claim({ ...identity, target_permanent_id: 'shot_perm_2', input_fingerprint: '' }),
    identityError => identityError.code === 'GENERATION_UNIT_IDENTITY_REQUIRED',
  );
  const otherTarget = units.claim({ ...identity, target_permanent_id: 'shot_perm_2' });
  assert.notStrictEqual(otherTarget.unit.idempotency_key, second.unit.idempotency_key);

  const cancelledIdentity = { ...identity, target_permanent_id: 'shot_cancelled', input_fingerprint: 'cancelled-input' };
  const cancelled = units.claim(cancelledIdentity);
  const cancelledQueued = units.transition(cancelled.unit.id, 'queued', {}, { expected_version: cancelled.unit.unit_version });
  const cancelledTerminal = units.transition(cancelled.unit.id, 'cancelled', {
    billing_state: 'not_submitted', provider_submission_state: 'not_submitted',
  }, { expected_version: cancelledQueued.unit_version });
  assert.strictEqual(units.claim(cancelledIdentity).claimed, false, '普通重复请求不得重开取消单元');
  const restarted = units.claim(cancelledIdentity, { explicit_user_retry: true });
  assert.strictEqual(restarted.claimed, true);
  assert.strictEqual(restarted.restarted, true);
  assert.strictEqual(restarted.unit.id, cancelledTerminal.id);
  assert.strictEqual(restarted.unit.state, 'ready');

  circuits.recordFailure({ provider_id: 'provider-a', failure_class: 'timeout' }, { now_ms: 1000, threshold: 2, cooldown_ms: 1000 });
  const opened = circuits.recordFailure({ provider_id: 'provider-a', failure_class: 'timeout' }, { now_ms: 1500, threshold: 2, cooldown_ms: 1000 });
  assert.strictEqual(opened.state, 'open');
  assert.throws(
    () => circuits.assertAvailable('provider-a', 'timeout', { now_ms: 1600 }),
    circuitError => circuitError.code === 'PROVIDER_CIRCUIT_OPEN',
  );
  assert.strictEqual(circuits.inspect('provider-b', 'timeout', { now_ms: 1600 }).available, true);
  assert.strictEqual(circuits.inspect('provider-a', 'timeout', { now_ms: 2600 }).probe, true);
  circuits.recordSuccess('provider-a', 'timeout', { now_ms: 2700 });
  assert.strictEqual(circuits.inspect('provider-a', 'timeout', { now_ms: 2800 }).available, true);

  console.log(JSON.stringify({
    passed: true,
    idempotency_reuse: true,
    stale_write_blocked: true,
    illegal_transition_blocked: true,
    billing_unknown_quarantined: true,
    automatic_paid_retry: 0,
    manual_reconciliation_required: true,
    provider_circuit_persisted: true,
  }));
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
