#!/usr/bin/env node
const { Client } = require('ssh2');

const SCRIPT = `
cd /opt/vido/app && node -e "
const kb = require('./src/services/knowledgeBaseService');
const dl = require('./src/services/dailyLearnService');

console.log('=== 团队 roster ===');
const types = kb.listAgentTypes();
const rd = types.filter(a => a.team === 'rd');
const ops = types.filter(a => a.team === 'ops');
console.log('rd:', rd.length, '| ops:', ops.length);
const pa = types.find(a => a.id === 'project_assistant');
console.log('project_assistant:', pa ? '✓ ' + pa.emoji + ' ' + pa.name : '✗ 缺失');
console.log();

console.log('=== KB 统计 ===');
const docs = kb.listDocs();
const by = {};
docs.forEach(d => by[d.collection] = (by[d.collection] || 0) + 1);
console.log('total:', docs.length);
console.log('by collection:', JSON.stringify(by));
console.log();

const eng = docs.filter(d => d.collection === 'engineering');
const engSub = {};
eng.forEach(d => engSub[d.subcategory] = (engSub[d.subcategory] || 0) + 1);
console.log('engineering subcategories:', JSON.stringify(engSub));
"
echo
echo '=== 生产 docs/logs/ 目录 ==='
ls -la /opt/vido/app/docs/logs/ 2>&1 || echo '(不存在)'
echo
echo '=== sessions ==='
ls /opt/vido/app/docs/logs/sessions/ 2>&1 || echo '(空)'
echo
echo '=== learning ==='
ls /opt/vido/app/docs/logs/learning/ 2>&1 || echo '(空)'
echo
echo '=== 旧 docs/sessions/ 应该已经迁移了 ==='
ls /opt/vido/app/docs/sessions/ 2>&1 || echo '✓ 旧目录已清理'
ls /opt/vido/app/docs/learning/ 2>&1 || echo '✓ 旧目录已清理'
`;

const c = new Client();
c.on('ready', () => {
  c.exec(SCRIPT, (err, stream) => {
    if (err) { console.error(err); c.end(); return; }
    stream.on('close', () => c.end());
    stream.on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
  });
});
c.on('error', e => console.error('SSH error:', e.message));
c.connect({ host: process.env.VIDO_DEPLOY_HOST, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD, readyTimeout: 20000 });
