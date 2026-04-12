#!/usr/bin/env node
// v6 production smoke test
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST;
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;

const REMOTE_SCRIPT = `
set -e
echo '=== pm2 logs (DailyLearn) ==='
pm2 logs vido --lines 30 --nostream 2>&1 | grep -E 'DailyLearn|注册|listen' | head -10
echo
echo '=== services load test ==='
cd /opt/vido/app && node -e "
const dl = require('./src/services/dailyLearnService');
const orch = require('./src/services/agentOrchestrator');
const src = require('./src/services/knowledgeSources');
console.log('dailyLearnService:', typeof dl.runDailyLearn, typeof dl.scheduleDaily);
console.log('agentOrchestrator:', typeof orch.executeAgent, typeof orch.autoExecute);
console.log('knowledgeSources:', src.listSources().length, 'sources');
"
echo
echo '=== auth + endpoints test ==='
TOKEN=\\$(curl -s -X POST http://127.0.0.1:4600/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{console.log(JSON.parse(d).data.access_token)})')
echo "token len: \\$\\{#TOKEN\\}"
echo
echo '=== /api/admin/daily-learn/sources ==='
curl -s http://127.0.0.1:4600/api/admin/daily-learn/sources -H "Authorization: Bearer \\$TOKEN" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("sources:", j.data?.length, j.data?.map(s=>s.id).join(","))})'
echo
echo '=== /api/ai-team/roster ==='
curl -s http://127.0.0.1:4600/api/ai-team/roster -H "Authorization: Bearer \\$TOKEN" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("agents:",j.data?.length,"(callable:",j.data?.filter(a=>a.callable).length+")")})'
echo
echo '=== 手动触发 daily-learn ==='
curl -s -X POST http://127.0.0.1:4600/api/admin/daily-learn/trigger -H "Authorization: Bearer \\$TOKEN" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);if(j.success){console.log("duration:",j.data.duration_ms+"ms, new_docs:",j.data.new_docs+", digests:",j.data.agent_digests.length)}else console.log("FAIL:",j.error)})'
echo
echo '=== 验证 digest 文件 ==='
ls -la /opt/vido/app/docs/learning/ 2>&1 | head -5
`;

const c = new Client();
c.on('ready', () => {
  c.exec(REMOTE_SCRIPT, (err, stream) => {
    if (err) { console.error(err); c.end(); return; }
    stream.on('close', () => c.end());
    stream.on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
  });
});
c.on('error', e => console.error('SSH error:', e.message));
c.connect({ host: HOST, username: 'root', password: PASSWORD, readyTimeout: 20000 });
