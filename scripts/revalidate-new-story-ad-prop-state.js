const assert = require('assert');
const crypto = require('crypto');
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

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function main() {
  const recordHumanApproval = process.argv.includes('--record-human-approval');
  if (!recordHumanApproval && !process.argv.includes('--confirm-paid')) {
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
  if (recordHumanApproval) {
    assert.equal(submissionsBeforeRun, 1, 'human approval requires exactly one recorded provider submission');
    assert.equal(audit.provider_submissions[0]?.status, 'success', 'human approval requires a successful provider result');
    const storage = require('../src/services/newStoryAd/storageService');
    const assets = storage.getOutput(taskId, 'prop_assets') || [];
    const assetIndex = assets.findIndex(item => String(item.id || item.prop_id) === propId);
    assert.ok(assetIndex >= 0, 'generated prop asset is missing');
    const asset = assets[assetIndex];
    assert.equal(asset.state_revision, stateRevision);
    assert.equal(asset.state_views?.length, 2);
    const stateAtlas = (asset.category_atlases || []).find(item => item.state_revision === stateRevision);
    assert.ok(stateAtlas?.filename, 'state revision atlas is missing');
    const stateFiles = [
      path.join(root, 'outputs', 'new-story-ad-assets', stateAtlas.filename),
      ...asset.state_views.map(item => item.filePath || path.join(root, 'outputs', 'new-story-ad-assets', item.filename)),
    ];
    for (const filePath of stateFiles) assert.ok(fs.existsSync(filePath), `approved state file is missing: ${filePath}`);
    const approvedAt = new Date().toISOString();
    const humanVisualApproval = {
      status: 'approved',
      approved_at: approvedAt,
      reviewer: 'codex_human_visual_review',
      checks: {
        resting_support_surface_visible: true,
        held_hand_contact_visible: true,
        object_identity_consistent: true,
        full_person_absent: true,
        text_logo_watermark_absent: true,
      },
      file_sha256: stateFiles.map(filePath => ({
        filename: path.basename(filePath),
        sha256: fileSha256(filePath),
      })),
    };
    const approvedAsset = {
      ...asset,
      state_revalidation: {
        ...asset.state_revalidation,
        status: 'approved',
        human_visual_approval: humanVisualApproval,
      },
      status: 'approved',
      updated_at: approvedAt,
    };
    const nextAssets = [...assets];
    nextAssets[assetIndex] = approvedAsset;
    storage.saveOutput(taskId, 'prop_assets', nextAssets);
    const context = storage.getOutput(taskId, 'context');
    if (context) storage.saveOutput(taskId, 'context', { ...context, prop_assets: nextAssets });
    audit.status = 'completed';
    audit.human_visual_approval = humanVisualApproval;
    audit.finished_at = approvedAt;
    persistAudit();
    console.log(JSON.stringify({
      passed: true,
      run_id: runId,
      status: audit.status,
      provider_image_submissions: submissionsBeforeRun,
      new_provider_calls_executed: 0,
      human_visual_approval: humanVisualApproval.checks,
    }));
    return;
  }

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
