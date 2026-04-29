#!/usr/bin/env node
// 列出服务器 /opt/vido/app 中近期改动的源码文件
const { Client } = require('ssh2');
const HOST = '43.98.167.151', USER = 'root';
const PASS = process.env.VIDO_SSH_PASS;
if (!PASS) { console.error('需 VIDO_SSH_PASS'); process.exit(1); }

const SINCE = process.env.SINCE_DATE || '2026-04-22';
const REPO = '/opt/vido/app';

const findCmd = `cd ${REPO} && find src public scripts MCP docs CLAUDE.md package.json package-lock.json -type f \\( -name '*.js' -o -name '*.json' -o -name '*.html' -o -name '*.css' -o -name '*.md' -o -name '*.py' -o -name '*.svg' -o -name '*.ico' \\) -newermt '${SINCE}' 2>/dev/null | grep -v 'node_modules' | grep -v '/outputs/' | grep -v '/.git/' | xargs -I{} stat -c '%Y	%s	{}' {} 2>/dev/null | sort -rn | head -300`;

const conn = new Client();
conn.on('ready', () => {
  let out = '', err = '';
  conn.exec(findCmd, (e, stream) => {
    if (e) { console.error(e); process.exit(2); }
    stream.on('close', () => {
      const lines = out.trim().split('\n').filter(Boolean);
      console.log(`# 服务器自 ${SINCE} 起改动的源文件: ${lines.length} 个 (top 300)\n`);
      for (const ln of lines) {
        const [mtime, size, ...rest] = ln.split('\t');
        const file = rest.join('\t');
        const dt = new Date(parseInt(mtime, 10) * 1000).toISOString().replace('T', ' ').slice(0, 16);
        console.log(`${dt}  ${String(size).padStart(8)}B  ${file}`);
      }
      if (err) console.error('[stderr]', err);
      conn.end();
    });
    stream.on('data', d => out += d);
    stream.stderr.on('data', d => err += d);
  });
}).on('error', e => { console.error(e.message); process.exit(2); })
  .connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 15000 });
