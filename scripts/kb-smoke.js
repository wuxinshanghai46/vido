#!/usr/bin/env node
// Production smoke test — run a series of checks over SSH
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST;
const USER = process.env.VIDO_DEPLOY_USER || 'root';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;

const REMOTE_CHECK = `
set -e
echo '--- HTTP /api/health ---'
curl -s http://127.0.0.1:4600/api/health
echo
echo
echo '--- KB file ---'
ls -la /opt/vido/app/outputs/knowledge_base.json
echo
echo '--- KB service (local require) ---'
cd /opt/vido/app && node -e "
const kb = require('./src/services/knowledgeBaseService');
const docs = kb.listDocs();
const by = {};
docs.forEach(d => by[d.collection] = (by[d.collection] || 0) + 1);
console.log('KB total:', docs.length, 'by:', JSON.stringify(by));
console.log('collections:', kb.listCollections().map(c => c.id).join(','));
console.log();
console.log('=== director context (genre=悬疑) ===');
const ctx = kb.buildAgentContext('director', { genre: '悬疑', maxDocs: 2 });
console.log('length:', ctx.length, 'chars');
console.log(ctx.slice(0, 500));
"
echo
echo '--- PM2 status ---'
pm2 jlist 2>/dev/null | node -e "
let d='';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  try {
    const j = JSON.parse(d).find(x => x.name === 'vido');
    if (j) console.log('status:', j.pm2_env.status, 'restarts:', j.pm2_env.restart_time);
  } catch(e) { console.log('(err)', e.message) }
});
"
`;

const c = new Client();
c.on('ready', () => {
  c.exec(REMOTE_CHECK, (err, stream) => {
    if (err) { console.error(err); c.end(); return; }
    stream.on('close', () => c.end());
    stream.on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
  });
});
c.on('error', e => console.error('SSH error:', e.message));
c.connect({ host: HOST, username: USER, password: PASSWORD, readyTimeout: 20000 });
