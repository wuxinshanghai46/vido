#!/usr/bin/env node
const { Client } = require('ssh2');

const HOST = process.env.VIDO_SYNC_HOST;
const USER = process.env.VIDO_SYNC_USER || 'root';
const PASSWORD = process.env.VIDO_SYNC_PASSWORD;
const PORT = parseInt(process.env.VIDO_SYNC_PORT || '22', 10);
const REMOTE_ROOT = process.env.VIDO_SYNC_REMOTE || '/opt/vido/app';

if (!HOST || !PASSWORD) {
  console.error('miss env');
  process.exit(1);
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream
        .on('close', (code) => resolve({ code, stdout, stderr }))
        .on('data', (d) => (stdout += d.toString('utf8')))
        .stderr.on('data', (d) => (stderr += d.toString('utf8')));
    });
  });
}

(async () => {
  const conn = new Client();
  await new Promise((res, rej) => conn.on('ready', res).on('error', rej).connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 30000 }));

  for (const cmd of [
    `ls -la ${REMOTE_ROOT} | head -30`,
    `cd ${REMOTE_ROOT} && ls -1 | head -30`,
    `cd ${REMOTE_ROOT} && find . -maxdepth 2 -type f | head -20`,
    `cd ${REMOTE_ROOT} && find . -maxdepth 1 -type d`,
    `which sha256sum`,
    `cd ${REMOTE_ROOT} && find . -maxdepth 2 -type f -name '*.json' | xargs -r sha256sum | head -5`,
  ]) {
    console.log('\n# ' + cmd);
    const r = await exec(conn, cmd);
    console.log('exit=' + r.code + ' stderr=' + r.stderr.slice(0, 200));
    console.log(r.stdout.slice(0, 2000));
  }
  conn.end();
})().catch((e) => { console.error(e); process.exit(1); });
