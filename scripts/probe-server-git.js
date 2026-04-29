#!/usr/bin/env node
// 一次性脚本：调查服务器 /opt/vido/app 仓库状态，密码通过 env var 传入
const { Client } = require('ssh2');

const HOST = '43.98.167.151';
const USER = 'root';
const PASS = process.env.VIDO_SSH_PASS;
const REPO = '/opt/vido/app';

if (!PASS) {
  console.error('需要环境变量 VIDO_SSH_PASS');
  process.exit(1);
}

const probes = [
  ['hostname + uname', 'hostname && uname -a'],
  ['app dir', `ls -la ${REPO} | head -25`],
  ['is git repo?', `cd ${REPO} && git rev-parse --is-inside-work-tree 2>&1 || echo NOT_A_GIT_REPO`],
  ['HEAD + branch', `cd ${REPO} && git rev-parse HEAD 2>&1 && git rev-parse --abbrev-ref HEAD 2>&1`],
  ['recent commits', `cd ${REPO} && git log --oneline -10 2>&1`],
  ['status (concise)', `cd ${REPO} && git status --short 2>&1 | head -50`],
  ['status count', `cd ${REPO} && git status --short 2>&1 | wc -l`],
  ['remotes', `cd ${REPO} && git remote -v 2>&1`],
  ['untracked count', `cd ${REPO} && git ls-files --others --exclude-standard 2>&1 | wc -l`],
  ['pm2 status', 'pm2 jlist 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); [print(p[\\"name\\"], p[\\"pm2_env\\"][\\"status\\"], \\"restart=\\"+str(p[\\"pm2_env\\"][\\"restart_time\\"])) for p in d]" 2>&1 || pm2 status 2>&1 | head -20'],
  ['disk', `df -h ${REPO} | tail -1`],
];

function exec(conn, cmd) {
  return new Promise((resolve) => {
    let out = '', err = '';
    conn.exec(cmd, (e, stream) => {
      if (e) return resolve({ ok: false, err: String(e) });
      stream.on('close', () => resolve({ ok: true, out: out.trim(), err: err.trim() }));
      stream.on('data', (d) => out += d);
      stream.stderr.on('data', (d) => err += d);
    });
  });
}

const conn = new Client();
conn.on('ready', async () => {
  for (const [label, cmd] of probes) {
    process.stdout.write(`\n========== ${label} ==========\n`);
    const r = await exec(conn, cmd);
    if (r.out) process.stdout.write(r.out + '\n');
    if (r.err) process.stdout.write('[stderr] ' + r.err + '\n');
  }
  conn.end();
}).on('error', (e) => {
  console.error('SSH 错误:', e.message);
  process.exit(2);
}).connect({
  host: HOST,
  port: 22,
  username: USER,
  password: PASS,
  readyTimeout: 15000,
});
