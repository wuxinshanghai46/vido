const assert = require('assert');
const fs = require('fs');
const path = require('path');

function argumentValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find(value => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function safeError(error) {
  return {
    code: String(error?.code || 'ERROR'),
    message: String(error?.message || error || '').slice(0, 1000),
    billing_state: String(error?.billingState || error?.billing_state || ''),
    provider_submission_state: String(error?.providerSubmissionState || error?.provider_submission_state || ''),
    provider_request_id: String(error?.providerRequestId || error?.provider_request_id || ''),
    provider_task_id: String(error?.providerTaskId || error?.provider_task_id || ''),
  };
}

async function main() {
  if (!process.argv.includes('--confirm-paid')) {
    throw new Error('Refusing real supplier call without --confirm-paid');
  }
  if (process.env.NEW_STORY_AD_MOCK_IMAGE === '1' || process.env.NEW_STORY_AD_MOCK_LLM === '1') {
    throw new Error('Real prop state revalidation cannot run while mock generation is enabled');
  }
  const root = path.resolve(__dirname, '..');
  const sourceRunId = argumentValue('source-run-id');
  const taskId = argumentValue('task-id', `${sourceRunId}-props`);
  const propId = argumentValue('prop-id', 'silver_entry_key');
  const stateRevision = Math.max(2, Number(argumentValue('state-revision', '2')) || 2);
  assert.ok(sourceRunId, '--source-run-id is required');
  assert.equal(taskId, `${sourceRunId}-props`, 'task id must be the original audited prop task');
  assert.equal(propId, 'silver_entry_key', 'this authorization is limited to the audited silver key');
  assert.equal(stateRevision, 2, 'this authorization is limited to state revision 2');

  process.env.DB_ENABLED = '0';
  const runId = `prop-state-revalidation-${sourceRunId}-v${stateRevision}`;
  const auditDir = path.join(root, 'outputs', 'audits', 'prop-state-revalidation', runId);
  const auditPath = path.join(auditDir, 'audit.json');
  fs.mkdirSync(auditDir, { recursive: true });
  let audit = fs.existsSync(auditPath)
    ? JSON.parse(fs.readFileSync(auditPath, 'utf8'))
    : {
      schema_version: 1,
      run_id: runId,
      source_run_id: sourceRunId,
      task_id: taskId,
      prop_id: propId,
      state_revision: stateRevision,
      authorized_image_submission_cap: 1,
      provider_submissions: [],
      status: 'running',
      started_at: new Date().toISOString(),
    };
  const persistAudit = () => {
    const temp = `${auditPath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(audit, null, 2), 'utf8');
    fs.renameSync(temp, auditPath);
  };
  persistAudit();
  const submissionsBeforeRun = audit.provider_submissions.length;
  assert.ok(submissionsBeforeRun <= 1, 'recorded submissions exceed the authorized cap');

  const deyunai = require('../src/services/deyunaiService');
  const originalGenerateImage = deyunai.generateImage;
  deyunai.generateImage = async options => {
    let row = null;
    const originalOnSubmitting = options.onSubmitting;
    const originalOnSubmitted = options.onSubmitted;
    const observed = {
      ...options,
      onSubmitting: async event => {
        if (audit.provider_submissions.length >= 1) {
          const error = new Error('authorized image submission cap 1 reached');
          error.code = 'PROP_STATE_REVALIDATION_BUDGET_EXHAUSTED';
          error.billingState = 'not_submitted';
          throw error;
        }
        if (typeof originalOnSubmitting === 'function') await originalOnSubmitting(event);
        row = {
          number: 1,
          unit: 'states_v2',
          client_request_id: String(options.clientRequestId || ''),
          model: String(options.model || ''),
          reference_count: Array.isArray(options.referenceImages) ? options.referenceImages.length : 0,
          status: 'submitting',
          started_at: new Date().toISOString(),
        };
        audit.provider_submissions.push(row);
        persistAudit();
      },
      onSubmitted: async event => {
        if (row) {
          row.provider_request_id = String(event?.providerRequestId || '');
          row.provider_task_id = String(event?.taskId || '');
          row.provider_submission_state = String(event?.status || 'submitted');
          persistAudit();
        }
        if (typeof originalOnSubmitted === 'function') await originalOnSubmitted(event);
      },
    };
    const startedAt = Date.now();
    try {
      const result = await originalGenerateImage(observed);
      if (row) {
        Object.assign(row, {
          status: 'success',
          duration_ms: Date.now() - startedAt,
          provider_request_id: String(result?.providerRequestId || row.provider_request_id || ''),
          provider_task_id: String(result?.taskId || row.provider_task_id || ''),
          finished_at: new Date().toISOString(),
        });
      }
      persistAudit();
      return result;
    } catch (error) {
      if (row) {
        Object.assign(row, {
          status: 'failed',
          duration_ms: Date.now() - startedAt,
          error: safeError(error),
          finished_at: new Date().toISOString(),
        });
      }
      persistAudit();
      throw error;
    }
  };

  const storage = require('../src/services/newStoryAd/storageService');
  const propAssets = require('../src/services/newStoryAd/propAssetService');
  const existing = (storage.getOutput(taskId, 'prop_assets') || [])
    .find(item => String(item.id || item.prop_id) === propId);
  assert.ok(existing, 'audited prop asset is missing');
  assert.equal(existing.view_images?.length, 4, 'audited prop identity views are incomplete');
  assert.equal(existing.state_views?.length, 2, 'audited original state views are incomplete');
  const identityBefore = existing.view_images.map(item => item.image_url || item.url);

  try {
    const result = await propAssets.regeneratePropStates(taskId, {
      prop_id: propId,
      state_revision: stateRevision,
    });
    const callsThisRun = audit.provider_submissions.length - submissionsBeforeRun;
    assert.ok(callsThisRun === 0 || callsThisRun === 1, 'state revalidation exceeded one submission');
    assert.equal(result.state_revalidation?.provider_calls_this_run, callsThisRun);
    assert.deepStrictEqual(
      result.view_images.map(item => item.image_url || item.url),
      identityBefore,
      'identity views changed during state-only revalidation',
    );
    assert.equal(result.state_views.length, 2);
    assert.equal(result.state_revision, stateRevision);
    audit.status = callsThisRun === 1 ? 'generated_pending_human_approval' : 'checkpoint_reused';
    audit.finished_at = new Date().toISOString();
    audit.result = {
      identity_views_preserved: true,
      state_view_count: result.state_views.length,
      state_revision: result.state_revision,
      state_atlas: result.category_atlases.find(item => item.state_revision === stateRevision) || null,
      state_views: result.state_views,
      provider_calls_this_run: callsThisRun,
      checkpoint_hits: result.state_revalidation.checkpoint_hits,
    };
    persistAudit();
    console.log(JSON.stringify({
      passed: true,
      run_id: runId,
      status: audit.status,
      provider_image_submissions: callsThisRun,
      identity_views_preserved: true,
      state_view_count: result.state_views.length,
      audit_path: auditPath,
    }));
  } catch (error) {
    audit.status = 'failed';
    audit.error = safeError(error);
    audit.finished_at = new Date().toISOString();
    persistAudit();
    throw error;
  }
}

main().catch(error => {
  console.error(JSON.stringify({ passed: false, error: safeError(error) }, null, 2));
  process.exitCode = 1;
});
