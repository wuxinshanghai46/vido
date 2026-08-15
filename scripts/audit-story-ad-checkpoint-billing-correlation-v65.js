'use strict';

const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');

function quote(value) { return `'${String(value).replace(/'/g, `'"'"'`)}'`; }
function source() { return `
const storage=require('./src/services/newStoryAd/storageService');
const db=storage.readDb();
const text=v=>String(v??'').trim();
const outputs=[...(db.outputs||[])].sort((a,b)=>text(b.updated_at||b.payload?.updated_at).localeCompare(text(a.updated_at||a.payload?.updated_at)));
const latest=new Map();
for(const row of outputs){
 if(!text(row.kind).startsWith('subject_asset_checkpoint:'))continue;
 for(const [mapKey,unit] of Object.entries(row.payload?.person_dossier_checkpoints||{})){
  const key=text(unit.key)||mapKey;if(!latest.has(key))latest.set(key,{...unit,key,task_id:row.task_id});
 }
}
const unknown=[...latest.values()].filter(x=>text(x.billing_state)==='unknown'||text(x.provider_submission_state)==='submitted_unknown');
const calls=db.model_calls||[];
const match=u=>calls.filter(c=>text(c.task_id)===text(u.task_id)&&((text(c.submission_id)&&text(c.submission_id)===text(u.key))||(text(u.provider_task_id)&&text(c.provider_task_id)===text(u.provider_task_id))||(text(u.provider_request_id)&&text(c.provider_request_id)===text(u.provider_request_id))));
const matches=unknown.map(u=>({unit:u,calls:match(u)}));
const quarantined=new Set((db.generation_runs||[]).map(r=>text(r.legacy_model_call_id)).filter(Boolean));
const explicit=[];
for(const row of outputs){
 const kind=text(row.kind),payload=row.payload||{};
 const push=(key,unit)=>{if(unit)explicit.push({key,kind,task_id:row.task_id,...unit});};
 if(kind.startsWith('subject_asset_checkpoint:'))for(const [key,unit] of Object.entries(payload.person_dossier_checkpoints||{}))push(text(unit.key)||key,unit);
 if(kind.startsWith('prop_asset_checkpoint:'))for(const [key,unit] of Object.entries(payload.units||{}))push(text(unit.key)||key,unit);
 if(kind.startsWith('scene_asset_checkpoint:'))for(const [key,unit] of Object.entries(payload.views||{}))push(kind+'#'+key,unit);
}
const explicitByKey=new Map();for(const item of explicit){if(!explicitByKey.has(item.key))explicitByKey.set(item.key,item)}
const explicitLatest=[...explicitByKey.values()].filter(x=>text(x.billing_state)==='unknown'||text(x.provider_submission_state)==='submitted_unknown');
const explicitMatches=explicitLatest.map(u=>({unit:u,calls:match(u)}));
console.log(JSON.stringify({read_only:true,latest_checkpoint_units:latest.size,checkpoint_unknown:unknown.length,explicit_checkpoint_unknown:explicitLatest.length,explicit_by_kind:Object.fromEntries([...new Set(explicitLatest.map(x=>x.kind.split(':')[0]))].map(k=>[k,explicitLatest.filter(x=>x.kind.startsWith(k+':')).length])),matched_model_unknown:matches.filter(x=>x.calls.some(c=>text(c.billing_state)==='unknown')).length,matched_model_blank:matches.filter(x=>x.calls.some(c=>!text(c.billing_state))).length,unmatched:matches.filter(x=>!x.calls.length).length,explicit_matched_model_unknown:explicitMatches.filter(x=>x.calls.some(c=>text(c.billing_state)==='unknown')).length,explicit_matched_model_blank:explicitMatches.filter(x=>x.calls.some(c=>!text(c.billing_state))).length,explicit_unmatched:explicitMatches.filter(x=>!x.calls.length).length,unknown_model_calls:calls.filter(c=>text(c.billing_state)==='unknown').length,quarantined_unknown_model_calls:calls.filter(c=>text(c.billing_state)==='unknown'&&quarantined.has(text(c.id))).length,checkpoint_statuses:Object.fromEntries([...new Set(unknown.map(x=>text(x.status)))].map(s=>[s,unknown.filter(x=>text(x.status)===s).length]))}));` }

function main() {
  const encoded = Buffer.from(source()).toString('base64');
  const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/current';
  const command = `cd ${quote(remoteRoot)} && node scripts/run-with-pm2-env.js vido node -e ${quote(`eval(Buffer.from('${encoded}','base64').toString())`)}`;
  const client = new Client();
  client.on('ready', () => client.exec(command, (error, stream) => {
    if (error) throw error;
    let stdout = '', stderr = '';
    stream.on('data', chunk => { stdout += chunk; }); stream.stderr.on('data', chunk => { stderr += chunk; });
    stream.on('close', code => { client.end(); if (code) { console.error(stderr.trim()); process.exitCode = 1; } else console.log(stdout.trim()); });
  })).on('error', error => { console.error(error.message); process.exitCode = 1; }).connect(connectionOptions({
    host: process.env.VIDO_DEPLOY_HOST || '43.98.167.151', port: Number(process.env.VIDO_DEPLOY_PORT || 2222), username: process.env.VIDO_DEPLOY_USER || 'root',
  }));
}

if (require.main === module) main();
module.exports = { source };
