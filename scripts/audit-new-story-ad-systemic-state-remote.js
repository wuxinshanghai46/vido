'use strict';

const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const port = Number(process.env.VIDO_DEPLOY_PORT || 2222);
const username = process.env.VIDO_DEPLOY_USER || 'root';
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';

function remoteAuditSource() {
  return String.raw`
const storage = require('./src/services/newStoryAd/storageService');
const rows = value => Array.isArray(value) ? value : [];
const text = value => String(value ?? '').trim();
const running = new Set(['queued', 'submitted', 'accepted', 'polling', 'running', 'generating', 'retrying']);
const db = storage.readDb();
const tasks = rows(db.tasks), outputs = rows(db.outputs), manifests = rows(db.manifests), artifacts = rows(db.artifacts);
const generations = rows(db.generation_runs), works = rows(db.works), workEvents = rows(db.work_events), calls = rows(db.model_calls);
const taskIds = new Set(tasks.map(row => text(row.id)).filter(Boolean));
const outputTaskIds = new Set(outputs.map(row => text(row.task_id)).filter(Boolean));
const unknownBilling = calls.filter(call => text(call.billing_state).toLowerCase() === 'unknown');
const report = {
  schema_version: 1, read_only: true, source: 'production_ssh',
  task_count: tasks.length,
  lineage_enforced_count: tasks.filter(task => task.lineage_enforced === true).length,
  lineage_missing_count: tasks.filter(task => task.lineage_enforced !== true).length,
  output_count: outputs.length, manifest_count: manifests.length, artifact_count: artifacts.length,
  generation_run_count: generations.length, work_count: works.length, work_event_count: workEvents.length,
  active_generation_count: generations.filter(run => running.has(text(run.state || run.status).toLowerCase())).length,
  unknown_billing_count: unknownBilling.length,
  active_unknown_billing_count: unknownBilling.filter(call => running.has(text(call.provider_submission_state || call.status).toLowerCase())).length,
  orphan_output_task_count: [...outputTaskIds].filter(id => !taskIds.has(id)).length,
};
console.log(JSON.stringify(report));
`;
}

function shellQuote(value) { return `'${String(value).replace(/'/g, `'"'"'`)}'`; }
function buildRemoteCommand() {
  const encoded = Buffer.from(remoteAuditSource(), 'utf8').toString('base64');
  return `cd ${shellQuote(remoteRoot)} && node -e ${shellQuote(`eval(Buffer.from('${encoded}','base64').toString('utf8'))`)}`;
}

function main() {
  const client = new Client();
  client.on('ready', () => {
    client.exec(buildRemoteCommand(), (error, stream) => {
      if (error) { console.error(error.message || error); client.end(); process.exitCode = 1; return; }
      let stdout = '', stderr = '';
      stream.on('data', chunk => { stdout += chunk; });
      stream.stderr.on('data', chunk => { stderr += chunk; });
      stream.on('close', code => {
        client.end();
        if (code !== 0) { console.error(stderr.trim() || `remote audit exited ${code}`); process.exitCode = 1; return; }
        const report = JSON.parse(stdout.trim());
        if (report.source !== 'production_ssh' || report.read_only !== true) throw new Error('INVALID_REMOTE_AUDIT_EVIDENCE');
        console.log(JSON.stringify(report));
      });
    });
  }).on('error', error => { console.error(error.message || error); process.exitCode = 1; })
    .connect(connectionOptions({ host, port, username }));
}

if (require.main === module) main();

module.exports = { buildRemoteCommand, remoteAuditSource };
