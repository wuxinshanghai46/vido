'use strict';

const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');

const taskId = String(process.argv[2] || '').trim();
if (!/^[a-f0-9-]{36}$/i.test(taskId)) {
  console.error('Usage: node scripts/inspect-prod-story-ad-billing-gate.js <task-id>');
  process.exit(2);
}

const remoteScript = String.raw`
  const storage = require('./src/services/newStoryAd/storageService');
  const audit = require('./src/services/newStoryAd/taskStateAuditService');
  const authorization = require('./src/services/newStoryAd/visualAssetBillingAuthorizationService');
  const taskId = ${JSON.stringify(taskId)};
  const task = storage.getTask(taskId) || {};
  const outputs = storage.listOutputs(taskId);
  const generations = storage.listGenerationRuns({ task_id: taskId });
  const calls = storage.listModelCalls(taskId);
  const risk = audit.billingRiskForTask({ outputs, generation_runs: generations, model_calls: calls }, taskId);
  const reviews = authorization.listBillingReviews(taskId);
  const compact = item => ({
    id: item.id || '', source: item.source || '', source_lineage: item.source_lineage || '',
    source_kind: item.source_kind || '', checkpoint_key: item.checkpoint_key || '',
    stage: item.stage || item.domain || '', state: item.state || item.status || '',
    provider_submission_state: item.provider_submission_state || '', billing_state: item.billing_state || '',
    retry_authorized: item.retry_authorized === true, retry_authorization_key: item.retry_authorization_key || '',
    legacy_model_call_id: item.legacy_model_call_id || '', legacy_checkpoint_key: item.legacy_checkpoint_key || '',
    created_at: item.created_at || '', updated_at: item.updated_at || '',
  });
  const latestCalls = calls.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 12);
  console.log(JSON.stringify({
    task: {
      id: task.id || taskId, status: task.status || '', stage: task.stage || '',
      active_generation_id: task.active_generation_id || '', active_target_generations: task.active_target_generations || {},
      updated_at: task.updated_at || '',
    },
    review_batch: reviews,
    billing_risk: {
      all_unknown: risk.all_unknown_billing.map(compact),
      active_unknown: risk.active_unknown_billing.map(compact),
      generation_units: risk.unknown_billing_units.map(compact),
      unquarantined_unknown: risk.unquarantined_unknown_billing.map(compact),
    },
    latest_model_calls: latestCalls.map(call => ({
      id: call.id || '', stage: call.stage || '', status: call.status || '',
      provider_submission_state: call.provider_submission_state || '', billing_state: call.billing_state || '',
      provider_id: call.provider_id || '', model_id: call.model_id || '', created_at: call.created_at || '',
    })),
  }, null, 2));
`;

const encoded = Buffer.from(remoteScript).toString('base64');
const client = new Client();
client.on('ready', () => {
  client.exec(`cd /opt/vido/current && node -e "eval(Buffer.from('${encoded}','base64').toString())"`, (error, stream) => {
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
