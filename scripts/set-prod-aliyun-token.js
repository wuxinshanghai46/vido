#!/usr/bin/env node
/**
 * 把阿里 token 写入生产服务器的 outputs/settings.json
 *
 * 用法：
 *   VIDO_DEPLOY_HOST=43.98.167.151 VIDO_DEPLOY_PASSWORD='...' \
 *     ALIYUN_TOKEN=59f81f2e59b046e1a9e3a4578a0e1927 \
 *     node scripts/set-prod-aliyun-token.js
 */
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST;
const USER = process.env.VIDO_DEPLOY_USER || 'root';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const TOKEN = process.env.ALIYUN_TOKEN;
const REMOTE_SETTINGS = '/data/vido/outputs/settings.json';

if (!HOST || !PASSWORD || !TOKEN) {
  console.error('ERROR: 缺少 VIDO_DEPLOY_HOST / VIDO_DEPLOY_PASSWORD / ALIYUN_TOKEN');
  process.exit(1);
}

const conn = new Client();
conn.on('ready', () => {
  // 读取 → 合并 → 写回
  const cmd = `node -e "
    const fs = require('fs');
    const p = '${REMOTE_SETTINGS}';
    const s = JSON.parse(fs.readFileSync(p, 'utf-8'));
    let prov = (s.providers||[]).find(x => x.id === 'aliyun-tts');
    const tokenType = /^sk-/.test('${TOKEN}') ? 'dashscope' : /^[0-9a-f]{32}$/i.test('${TOKEN}') ? 'nls' : 'unknown';
    const defaultName = tokenType === 'nls' ? '阿里云语音（NLS AccessToken · 24h）' : '阿里云百炼（DashScope）';
    if (!prov) {
      prov = { id: 'aliyun-tts', preset: 'aliyun-tts', name: defaultName, api_url: '', api_key: '${TOKEN}', enabled: true, models: [], token_updated_at: Date.now() };
      s.providers.push(prov);
    } else {
      prov.api_key = '${TOKEN}';
      prov.enabled = true;
      prov.token_updated_at = Date.now();
      if (!prov.name || !/(NLS|DashScope|百炼|阿里云语音)/.test(prov.name)) prov.name = defaultName;
    }
    fs.writeFileSync(p, JSON.stringify(s, null, 2));
    console.log('✓ Aliyun token 已写入 ' + p + ' · type=' + tokenType + ' · updated_at=' + new Date(prov.token_updated_at).toISOString());
  "`;
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err); process.exit(1); }
    stream.on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
    stream.on('close', (code) => {
      conn.exec('pm2 reload vido --update-env', (err2, s2) => {
        if (err2) { console.error(err2); process.exit(1); }
        s2.on('data', d => process.stdout.write(d));
        s2.stderr.on('data', d => process.stderr.write(d));
        s2.on('close', () => { conn.end(); process.exit(code); });
      });
    });
  });
}).connect({ host: HOST, username: USER, password: PASSWORD, port: 22 });
