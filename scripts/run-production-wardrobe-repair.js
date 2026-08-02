'use strict';

const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');

const taskId = String(process.argv[2] || process.env.VIDO_TASK_ID || '').trim();
if (!taskId) throw new Error('Usage: node scripts/run-production-wardrobe-repair.js <task-id>');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const backupDir = `/opt/vido/backups/wardrobe-visual-repair-${stamp}`;
const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
const client = new Client();

function exec(command) {
  return new Promise((resolve, reject) => client.exec(command, (error, stream) => {
    if (error) return reject(error);
    let stdout = ''; let stderr = '';
    stream.on('data', chunk => { stdout += chunk; });
    stream.stderr.on('data', chunk => { stderr += chunk; });
    stream.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || stdout.trim() || `Remote exit ${code}`)));
  }));
}

client.on('ready', async () => {
  try {
    const active = await exec(`cd ${quote(remoteRoot)} && node scripts/run-with-pm2-env.js vido node scripts/check-new-story-ad-active-tasks.js`);
    console.log(active);
    const activeJson = active.split(/\r?\n/).reverse().find(line => line.trim().startsWith('{'));
    if (activeJson && Number(JSON.parse(activeJson).active_count || 0) > 0) throw new Error('Production has active generation tasks; repair stopped.');

    const backupScript = Buffer.from(`
      const fs=require('fs'); const path=require('path');
      const target=${JSON.stringify(backupDir)}; fs.mkdirSync(target,{recursive:true});
      const config=require('./src/db/sqlite').getDbConfig();
      const files=['outputs/new_story_ad_db.json',config.path,config.path+'-wal',config.path+'-shm'].filter(Boolean);
      const copied=[];
      for(const file of files){if(fs.existsSync(file)){const name=path.basename(file);fs.copyFileSync(file,path.join(target,name));copied.push({file,name,bytes:fs.statSync(file).size});}}
      console.log(JSON.stringify({backup:target,copied,db_enabled:config.enabled}));
    `, 'utf8').toString('base64');
    const backup = await exec(`cd ${quote(remoteRoot)} && node scripts/run-with-pm2-env.js vido node -e ${quote(`eval(Buffer.from('${backupScript}','base64').toString('utf8'))`)}`);
    console.log(backup);

    const repair = await exec(`cd ${quote(remoteRoot)} && node scripts/run-with-pm2-env.js vido node scripts/repair-story-ad-wearable-details.js ${quote(taskId)} --apply --force`);
    console.log(repair);

    const auditScript = Buffer.from(`
      const storage=require('./src/services/newStoryAd/storageService'); const id=${JSON.stringify(taskId)};
      const task=storage.getTask(id); const context=storage.getOutput(id,'context')||{}; const root=context.person_asset||{};
      const assets=Array.isArray(root.cast_assets)&&root.cast_assets.length?root.cast_assets:[root];
      const rows=assets.map(asset=>({id:asset.id||asset.actor_asset_id,accessories:(asset.accessory_details||[]).map(x=>({key:x.key,url:x.image_url})),wardrobe:(asset.wardrobe_details?.items||[]).map(x=>({key:x.key,url:x.image_url})),wardrobe_source:asset.wardrobe_details?.source}));
      console.log(JSON.stringify({task_id:id,status:task?.status,stage:task?.active_stage,active_generation_id:task?.active_generation_id||'',content_revision:task?.content_revision,model_calls:storage.getTaskBundle(id).model_calls.length,rows}));
    `, 'utf8').toString('base64');
    const audit = await exec(`cd ${quote(remoteRoot)} && node scripts/run-with-pm2-env.js vido node -e ${quote(`eval(Buffer.from('${auditScript}','base64').toString('utf8'))`)}`);
    console.log(audit);
    const health = await exec(`pm2 jlist | node -e ${quote(`let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d).find(x=>x.name==='vido');console.log(JSON.stringify({status:p?.pm2_env?.status,restarts:p?.pm2_env?.restart_time}))})`)} && curl -fsS http://127.0.0.1:4600/api/health && curl -fsS https://vido.smsend.cn/api/health`);
    console.log(health);
    console.log(`BACKUP=${backupDir}`);
    client.end();
  } catch (error) {
    console.error(error.message || error);
    client.end();
    process.exitCode = 1;
  }
}).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect(connectionOptions({ host, port: 22, username: 'root' }));
