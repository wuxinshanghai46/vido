'use strict';

const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');

const taskId = String(process.argv[2] || '').trim();
const apply = process.argv.includes('--apply');
if (!/^[a-f0-9-]{36}$/i.test(taskId)) {
  console.error('Usage: node scripts/migrate-story-ad-v101-target-checkpoint.js <task-id> [--apply]');
  process.exit(2);
}

const remoteScript = String.raw`
  const fs = require('fs');
  const path = require('path');
  const storage = require('./src/services/newStoryAd/storageService');
  const assetPlan = require('./src/services/newStoryAd/assetPlanService');
  const taskId = ${JSON.stringify(taskId)};
  const apply = ${JSON.stringify(apply)};
  const task = storage.getTask(taskId);
  const context = storage.getOutput(taskId, 'context') || task?.request || {};
  const checkpoint = storage.getOutput(taskId, 'asset_plan_draft_checkpoint');
  if (!task || !checkpoint) throw new Error('TARGET_TASK_OR_CHECKPOINT_NOT_FOUND');
  if (String(context.content_mode || '') !== 'narrative_story') throw new Error('TARGET_NOT_NARRATIVE_STORY');
  if (String(context.product_subject || '').trim() || String(context.advertised_subject_contract?.subject || '').trim()) {
    throw new Error('TARGET_HAS_COMMERCIAL_INPUT');
  }
  const valid = [...(checkpoint.valid_sections || [])].sort();
  const missing = [...(checkpoint.missing_sections || [])].sort();
  if (valid.join(',') !== ['cast_profiles', 'prop_plan', 'scene_plan'].sort().join(',') || missing.join(',') !== 'story_seed') {
    throw new Error('TARGET_CHECKPOINT_SHAPE_CHANGED');
  }
  const beforeCalls = (storage.getTaskBundle(taskId, { diagnostics: true }).model_calls || []).length;
  const payload = assetPlan.normalizeContentModeMarkers(checkpoint.payload || {}, context);
  const violations = assetPlan.rawContentModeViolations(payload, context);
  if (violations.length) throw new Error('TARGET_STILL_HAS_CONTENT_MODE_VIOLATIONS:' + violations.join(','));
  const migrated = {
    ...checkpoint,
    fingerprint: assetPlan.fingerprint(task, context),
    content_mode: 'narrative_story',
    reusable: assetPlan.reusableDraftPayload(payload, context),
    valid_sections: assetPlan.validAssetPlanSections(payload, context),
    missing_sections: assetPlan.missingAssetPlanSections(payload, context),
    payload,
    migration: {
      from: 'generation-mode-isolation-v100',
      to: 'generation-mode-validation-v101',
      migrated_at: new Date().toISOString(),
      reason: 'canonicalize narrative marker and adopt semantic input fingerprint',
    },
    updated_at: new Date().toISOString(),
  };
  if (!migrated.reusable || migrated.missing_sections.join(',') !== 'story_seed') {
    throw new Error('MIGRATED_CHECKPOINT_NOT_RECOVERY_SAFE');
  }
  let backupPath = '';
  if (apply) {
    const backupDir = '/opt/vido/backups/story-ad-v101-checkpoint-migrations';
    fs.mkdirSync(backupDir, { recursive: true });
    backupPath = path.join(backupDir, taskId + '-' + Date.now() + '.json');
    fs.writeFileSync(backupPath, JSON.stringify({ task_id: taskId, checkpoint }, null, 2), { mode: 0o600 });
    storage.saveOutput(taskId, 'asset_plan_draft_checkpoint', migrated, { content_revision: task.content_revision });
    storage.updateTask(taskId, { retryable: true });
  }
  const after = storage.getOutput(taskId, 'asset_plan_draft_checkpoint');
  const afterCalls = (storage.getTaskBundle(taskId, { diagnostics: true }).model_calls || []).length;
  console.log(JSON.stringify({
    apply,
    task_id: taskId,
    task_status: storage.getTask(taskId)?.status,
    before_fingerprint: checkpoint.fingerprint,
    target_fingerprint: migrated.fingerprint,
    stored_fingerprint: after?.fingerprint,
    advertised_subject_before: checkpoint.payload?.scene_plan?.advertised_subject || '',
    advertised_subject_after: (apply ? after : migrated)?.payload?.scene_plan?.advertised_subject || '',
    valid_sections: (apply ? after : migrated)?.valid_sections,
    missing_sections: (apply ? after : migrated)?.missing_sections,
    reusable: (apply ? after : migrated)?.reusable,
    model_calls_before: beforeCalls,
    model_calls_after: afterCalls,
    backup_path: backupPath,
  }, null, 2));
`;

const encoded = Buffer.from(remoteScript, 'utf8').toString('base64');
const client = new Client();
client.on('ready', () => {
  client.exec(`cd /opt/vido/app && node -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`, (error, stream) => {
    if (error) throw error;
    stream.on('data', chunk => process.stdout.write(chunk));
    stream.stderr.on('data', chunk => process.stderr.write(chunk));
    stream.on('close', code => {
      client.end();
      process.exitCode = code || 0;
    });
  });
}).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect(connectionOptions());
