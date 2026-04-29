#!/usr/bin/env node
/**
 * 把 Hifly token upsert 到生产服务器 /data/vido/outputs/settings.json，
 * 然后 pm2 reload vido，最后用生产 /api/settings 列表验证 hifly 已就位。
 *
 * 用法: VIDO_SSH_PASS='xxx' HIFLY_TOKEN='yyy' node scripts/setup-hifly-prod.js
 */
const { Client } = require('ssh2');

const HOST = '43.98.167.151', USER = 'root';
const PASS = process.env.VIDO_SSH_PASS;
const TOKEN = process.env.HIFLY_TOKEN;
if (!PASS) { console.error('需 VIDO_SSH_PASS'); process.exit(1); }
if (!TOKEN) { console.error('需 HIFLY_TOKEN'); process.exit(1); }

const SETTINGS_PATH = '/data/vido/outputs/settings.json';
const BACKUP_PATH = `/data/vido/outputs/settings.json.bak.${Date.now()}`;

function exec(conn, cmd) {
  return new Promise((resolve) => {
    let out = '', err = '';
    conn.exec(cmd, (e, stream) => {
      if (e) return resolve({ ok: false, err: String(e) });
      stream.on('close', (code) => resolve({ ok: code === 0, code, out: out.trim(), err: err.trim() }));
      stream.on('data', d => out += d);
      stream.stderr.on('data', d => err += d);
    });
  });
}

function sftpReadJson(sftp, path) {
  return new Promise((resolve, reject) => {
    sftp.readFile(path, 'utf8', (e, data) => {
      if (e) return reject(e);
      try { resolve(JSON.parse(data)); } catch (pe) { reject(pe); }
    });
  });
}

function sftpWriteJson(sftp, path, obj) {
  return new Promise((resolve, reject) => {
    sftp.writeFile(path, JSON.stringify(obj, null, 2), 'utf8', (e) => e ? reject(e) : resolve());
  });
}

const conn = new Client();
conn.on('ready', () => {
  conn.sftp(async (e, sftp) => {
    if (e) { console.error('sftp err:', e); process.exit(2); }
    try {
      // 1. 备份
      const bk = await exec(conn, `cp ${SETTINGS_PATH} ${BACKUP_PATH}`);
      if (!bk.ok) throw new Error('backup failed: ' + bk.err);
      console.log(`✓ 备份: ${BACKUP_PATH}`);

      // 2. 读
      const settings = await sftpReadJson(sftp, SETTINGS_PATH);
      settings.providers = settings.providers || [];

      const isHifly = (p) => /hifly|lingverse/i.test((p.id || '') + '|' + (p.preset || '') + '|' + (p.name || ''));
      let prov = settings.providers.find(isHifly);

      const stub = {
        id: 'hifly',
        name: '飞影 Hifly',
        preset: 'hifly',
        api_key: TOKEN,
        api_url: 'https://hfw-api.hifly.cc',
        enabled: true,
        created_at: new Date().toISOString(),
        models: [
          { id: 'hifly', model_id: 'hifly', name: '飞影口型同步', use: 'avatar', enabled: true },
        ],
      };

      if (prov) {
        prov.api_key = TOKEN;
        prov.api_url = prov.api_url || stub.api_url;
        prov.enabled = true;
        prov.updated_at = new Date().toISOString();
        if (!prov.models || !prov.models.length) prov.models = stub.models;
        console.log('✓ 更新现有 hifly provider:', prov.id);
      } else {
        settings.providers.push(stub);
        console.log('✓ 新增 hifly provider: hifly');
      }

      // 3. 写回
      await sftpWriteJson(sftp, SETTINGS_PATH, settings);
      console.log('✓ 写回 settings.json');

      // 4. pm2 reload
      const r = await exec(conn, 'pm2 reload vido --update-env');
      console.log('▶ pm2 reload:', r.ok ? 'OK' : 'FAIL');
      if (r.out) console.log(r.out.split('\n').slice(-5).join('\n'));

      // 5. 服务器上烟测 getCredit（本地不能直连飞影外网？应该可以，但验证生产路径更准）
      const probe = await exec(conn, `cd /opt/vido/app && node -e "require('./src/services/hiflyService').getCredit().then(c=>console.log('getCredit OK',c)).catch(e=>{console.error('getCredit FAIL',e.message);process.exit(1)})"`);
      console.log('▶ 生产 getCredit:', probe.out);
      if (probe.err) console.log('[stderr]', probe.err);
    } catch (e) {
      console.error('错误:', e.message);
      process.exit(2);
    } finally {
      conn.end();
    }
  });
}).on('error', e => { console.error(e.message); process.exit(2); })
  .connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 15000 });
