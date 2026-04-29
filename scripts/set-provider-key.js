#!/usr/bin/env node
/**
 * 往生产 settings.json 里写/更新 baidu-aip 抠图 provider
 * 用法：VIDO_DEPLOY_PASSWORD='...' BAIDU_AIP_KEY='API_KEY:SECRET_KEY' node scripts/set-provider-key.js
 * 不把 key 写入任何代码/日志/memory
 */
const { Client } = require('ssh2');

const apiKey = process.env.BAIDU_AIP_KEY;
const pwd = process.env.VIDO_DEPLOY_PASSWORD;
if (!apiKey || !pwd) { console.error('need BAIDU_AIP_KEY + VIDO_DEPLOY_PASSWORD'); process.exit(1); }

const providerEntry = {
  id: 'baidu-aip',
  preset: 'baidu-aip',
  name: '百度 AI 开放平台',
  api_url: 'https://aip.baidubce.com',
  api_key: apiKey,
  enabled: true,
  models: [
    { id: 'body_seg', name: '人像分割（0.004元/次·视频抠像·逐帧）', type: 'matting', use: 'matting', enabled: true },
  ],
};

// 远程 node 脚本：读 settings.json → upsert provider → 写回
const remoteScript = `node -e "
const fs = require('fs');
const p = '/opt/vido/app/outputs/settings.json';
const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
j.providers = j.providers || [];
const entry = JSON.parse(Buffer.from(process.env.E, 'base64').toString('utf-8'));
const idx = j.providers.findIndex(x => x.id === entry.id);
if (idx >= 0) {
  j.providers[idx] = { ...j.providers[idx], ...entry };
  console.log('UPDATED', entry.id);
} else {
  j.providers.push(entry);
  console.log('ADDED', entry.id);
}
fs.writeFileSync(p, JSON.stringify(j, null, 2));
const v = j.providers.find(x=>x.id===entry.id);
console.log('models:', v.models.length, 'enabled:', v.enabled, 'has_key:', !!v.api_key);
"`;

const entryB64 = Buffer.from(JSON.stringify(providerEntry), 'utf-8').toString('base64');
const cmd = `E='${entryB64}' ${remoteScript}`;

const c = new Client();
c.on('ready', () => {
  c.exec(cmd, (err, stream) => {
    if (err) { console.error(err); c.end(); return; }
    stream.on('close', () => c.end()).on('data', d => process.stdout.write(d.toString())).stderr.on('data', d => process.stderr.write(d.toString()));
  });
});
c.on('error', e => { console.error(e.message); process.exit(2); });
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: pwd, readyTimeout: 20000 });
