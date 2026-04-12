#!/usr/bin/env node
const { Client } = require('ssh2');

const SCRIPT = `
cd /opt/vido/app && node -e "
const tracker = require('./src/services/tokenTracker');

console.log('=== 模块加载 ===');
console.log('tracker.record:', typeof tracker.record);
console.log('tracker.getStats:', typeof tracker.getStats);
console.log('tracker.getServerMetrics:', typeof tracker.getServerMetrics);
console.log('tracker.checkAlerts:', typeof tracker.checkAlerts);
console.log();

console.log('=== 服务器指标 ===');
const m = tracker.getServerMetrics();
console.log('platform:', m.platform, m.arch);
console.log('cpu:', m.cpu.count, 'cores,', m.cpu.usage_percent + '%');
console.log('memory:', m.memory.used_gb + '/' + m.memory.total_gb + ' GB (' + m.memory.used_percent + '%)');
console.log('uptime:', m.uptime_seconds + 's');
console.log();

console.log('=== 预算状态 ===');
const budget = tracker.getBudgetStatus();
console.log('has_budget:', budget.has_budget);
console.log('used_cost:', budget.used_cost_usd);

console.log();
console.log('=== 告警 ===');
const alerts = tracker.checkAlerts();
console.log('alerts:', alerts.length);
alerts.forEach(a => console.log(' -', a.level, a.type, ':', a.message));
"
echo
echo '=== 生产 content modules ==='
TOKEN=\\$(curl -s -X POST http://127.0.0.1:4600/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' 2>/dev/null | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
curl -s "http://127.0.0.1:4600/api/admin/contents/modules" -H "Authorization: Bearer \\$TOKEN" | head -c 300
echo
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
