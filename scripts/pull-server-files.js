#!/usr/bin/env node
// SFTP 拉取服务器指定文件到本地 _server_sync/ 镜像目录（不覆盖工作树）
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = '43.98.167.151', USER = 'root';
const PASS = process.env.VIDO_SSH_PASS;
if (!PASS) { console.error('需 VIDO_SSH_PASS'); process.exit(1); }

const REMOTE_BASE = '/opt/vido/app';
const LOCAL_BASE = path.join(__dirname, '..', '_server_sync');

// 默认 4/28 增量；可通过 FILES env (逗号分隔) 覆盖
const DEFAULT_FILES = [
  'src/routes/avatar.js',
  'src/services/aliyunVoiceService.js',
  'public/js/home.js',
  'public/js/auth.js',
];
const files = process.env.FILES ? process.env.FILES.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_FILES;

const conn = new Client();
conn.on('ready', () => {
  conn.sftp(async (err, sftp) => {
    if (err) { console.error('sftp err:', err); process.exit(2); }
    let ok = 0, fail = 0;
    for (const rel of files) {
      const remote = `${REMOTE_BASE}/${rel}`;
      const local = path.join(LOCAL_BASE, rel.replace(/\//g, path.sep));
      fs.mkdirSync(path.dirname(local), { recursive: true });
      try {
        await new Promise((res, rej) => sftp.fastGet(remote, local, e => e ? rej(e) : res()));
        const sz = fs.statSync(local).size;
        console.log(`✓ ${rel}  ${sz}B`);
        ok++;
      } catch (e) {
        console.log(`✗ ${rel}  ${e.message}`);
        fail++;
      }
    }
    console.log(`\n完成: ${ok} 成功, ${fail} 失败 → ${LOCAL_BASE}`);
    conn.end();
  });
}).on('error', e => { console.error(e.message); process.exit(2); })
  .connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 15000 });
