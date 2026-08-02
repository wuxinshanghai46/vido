'use strict';

const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');

const taskId = String(process.argv[2] || process.env.VIDO_TASK_ID || '').trim();
if (!/^[a-f0-9-]{36}$/i.test(taskId)) throw new Error('Usage: node scripts/run-production-storyboard-contract-repair.js <task-id>');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const backupDir = `/opt/vido/backups/storyboard-contract-repair-${stamp}`;
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

function remoteNode(command) {
  return `cd ${quote(remoteRoot)} && node scripts/run-with-pm2-env.js vido node ${command}`;
}

client.on('ready', async () => {
  try {
    const active = await exec(remoteNode('scripts/check-new-story-ad-active-tasks.js'));
    console.log(active);
    const activeJson = active.split(/\r?\n/).reverse().find(line => line.trim().startsWith('{'));
    if (activeJson && Number(JSON.parse(activeJson).active_count || 0) > 0) throw new Error('Production has active generation tasks; repair stopped.');

    const dryRun = await exec(remoteNode(`scripts/repair-story-ad-storyboard-contracts.js --task ${quote(taskId)}`));
    console.log(`DRY_RUN=${dryRun}`);
    const dryAudit = JSON.parse(dryRun);
    if (!dryAudit.shot_count) throw new Error('Dry-run found no storyboard shots.');
    if ((dryAudit.blocking_issues || []).length || (dryAudit.rewrite_issues || []).length) throw new Error('Dry-run review did not pass; repair stopped.');

    const backupScript = Buffer.from(`
      const fs=require('fs'); const path=require('path');
      const target=${JSON.stringify(backupDir)}; fs.mkdirSync(target,{recursive:true});
      const config=require('./src/db/sqlite').getDbConfig();
      const files=['outputs/new_story_ad_db.json',config.path,config.path+'-wal',config.path+'-shm'].filter(Boolean);
      const copied=[];
      for(const file of files){if(fs.existsSync(file)){const name=path.basename(file);fs.copyFileSync(file,path.join(target,name));copied.push({file,name,bytes:fs.statSync(file).size});}}
      if(!copied.length) throw new Error('No production data file was backed up');
      console.log(JSON.stringify({backup:target,copied,db_enabled:config.enabled}));
    `, 'utf8').toString('base64');
    const backup = await exec(remoteNode(`-e ${quote(`eval(Buffer.from('${backupScript}','base64').toString('utf8'))`)}`));
    console.log(`BACKUP_AUDIT=${backup}`);

    const applied = await exec(remoteNode(`scripts/repair-story-ad-storyboard-contracts.js --task ${quote(taskId)} --apply`));
    console.log(`APPLY=${applied}`);

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
