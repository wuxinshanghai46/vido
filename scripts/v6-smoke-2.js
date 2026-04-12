#!/usr/bin/env node
// v6 production smoke test using http module + direct service calls
const { Client } = require('ssh2');

const SCRIPT = `
cd /opt/vido/app && node -e "
(async () => {
  // 直接调用 service 层，避开 HTTP/token 问题
  const dl = require('./src/services/dailyLearnService');
  const orch = require('./src/services/agentOrchestrator');
  const src = require('./src/services/knowledgeSources');
  const kb = require('./src/services/knowledgeBaseService');

  console.log('=== 模块加载 ===');
  console.log('dailyLearnService.runDailyLearn:', typeof dl.runDailyLearn);
  console.log('dailyLearnService.scheduleDaily:', typeof dl.scheduleDaily);
  console.log('agentOrchestrator.executeAgent:', typeof orch.executeAgent);
  console.log('agentOrchestrator.autoExecute:', typeof orch.autoExecute);
  console.log('knowledgeSources:', src.listSources().length, 'sources');
  console.log();

  console.log('=== 团队结构 ===');
  const types = kb.listAgentTypes();
  const rd = types.filter(a => a.team === 'rd');
  const ops = types.filter(a => a.team === 'ops');
  console.log('rd:', rd.length, 'agents');
  console.log('ops:', ops.length, 'agents');
  console.log();

  console.log('=== 手动触发 daily learn ===');
  const result = await dl.runDailyLearn({ manual: true });
  console.log('success:', result.success);
  console.log('duration:', result.duration_ms + 'ms');
  console.log('new_docs:', result.new_docs);
  console.log('total_docs:', result.total_docs);
  console.log('agent_digests:', result.agent_digests.length);
  console.log('summary:', result.summary_file);
})().catch(e => { console.error('TEST ERROR:', e.message, e.stack); process.exit(1); });
"
echo
echo '=== /opt/vido/app/docs/learning/ ==='
ls /opt/vido/app/docs/learning/ 2>&1 | head -5
echo
echo '=== 今天的 digest 文件 ==='
ls /opt/vido/app/docs/learning/\\$(date +%Y-%m-%d)/ 2>&1 | head -10
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
