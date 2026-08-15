'use strict';

const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const port = Number(process.env.VIDO_DEPLOY_PORT || 2222);
const username = process.env.VIDO_DEPLOY_USER || 'root';
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/current';

function quote(value) { return `'${String(value).replace(/'/g, `'"'"'`)}'`; }
function source(taskId) {
  return `
const storage=require('./src/services/newStoryAd/storageService');
const assetPlan=require('./src/services/newStoryAd/assetPlanService');
const id=${JSON.stringify(taskId)};
const task=storage.getTask(id)||{};
const context=storage.getOutput(id,'context')||task.request||{};
const active=storage.getOutput(id,'asset_plan_active')||{};
const checkpointRows=storage.listOutputs(id).filter(row=>String(row.kind||'').startsWith('subject_asset_checkpoint:')).sort((a,b)=>String(b.updated_at||b.payload?.updated_at||'').localeCompare(String(a.updated_at||a.payload?.updated_at||'')));
const latestCheckpoint=checkpointRows.find(row=>Object.keys(row.payload?.person_dossier_checkpoints||{}).length)||null;
const units=Object.values(latestCheckpoint?.payload?.person_dossier_checkpoints||{});
const calls=(storage.getTaskBundle(id,{diagnostics:true}).model_calls||[]);
console.log(JSON.stringify({read_only:true,task_id:id,latest_checkpoint_kind:latestCheckpoint?.kind||'',checkpoint_units:units.length,completed:units.filter(x=>x.status==='completed').length,submitted_unknown:units.filter(x=>x.billing_state==='unknown'||x.provider_submission_state==='submitted_unknown').length,failed_safe:units.filter(x=>x.status==='failed'&&x.billing_state!=='unknown').length,current_fingerprint:assetPlan.fingerprint(task,context),stored_context_fingerprint:context.asset_plan_fingerprint||'',active_fingerprint:(active.plan||active).fingerprint||'',person_revision:context.revisions?.person||0,cast_count:(context.cast_profiles||[]).length,model_calls:calls.length,blank_model_call_billing:calls.filter(x=>!x.billing_state).length,unknown_model_call_billing:calls.filter(x=>x.billing_state==='unknown').length}));`;
}

function command(taskId) {
  const encoded = Buffer.from(source(taskId)).toString('base64');
  return `cd ${quote(remoteRoot)} && node scripts/run-with-pm2-env.js vido node -e ${quote(`eval(Buffer.from('${encoded}','base64').toString())`)}`;
}

function main() {
  const taskId = String(process.argv.find(arg => arg.startsWith('--task=')) || '').split('=').slice(1).join('=').trim();
  if (!taskId) throw new Error('Usage: node scripts/audit-story-ad-visual-generation-lineage-v65.js --task=<task-id>');
  const client = new Client();
  client.on('ready', () => client.exec(command(taskId), (error, stream) => {
    if (error) throw error;
    let stdout = '', stderr = '';
    stream.on('data', chunk => { stdout += chunk; });
    stream.stderr.on('data', chunk => { stderr += chunk; });
    stream.on('close', code => {
      client.end();
      if (code !== 0) { console.error(stderr.trim()); process.exitCode = 1; return; }
      console.log(stdout.trim());
    });
  })).on('error', error => { console.error(error.message); process.exitCode = 1; })
    .connect(connectionOptions({ host, port, username }));
}

if (require.main === module) main();
module.exports = { command, source };
