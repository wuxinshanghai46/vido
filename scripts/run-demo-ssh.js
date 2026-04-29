/**
 * SSH 到新服务器，streaming 跑 demo-auto-produce.js
 * 用法：
 *   VIDO_DEPLOY_PASSWORD='...' node scripts/run-demo-ssh.js "<主题>" <时长>
 */
const { Client } = require('ssh2');

const topic = process.argv[2] || 'AI 数字人口播 3 招反智商税秘笈·实测有效';
const duration = parseInt(process.argv[3] || '20', 10);
const pwd = process.env.VIDO_DEPLOY_PASSWORD;
if (!pwd) { console.error('need VIDO_DEPLOY_PASSWORD'); process.exit(1); }

const c = new Client();
c.on('ready', () => {
  console.log(`▶ SSH connected, 触发 demo (topic=${topic}, duration=${duration})`);
  // 注意：topic 传参需转义；用 base64 避免 shell 引号地狱
  const topicB64 = Buffer.from(topic, 'utf-8').toString('base64');
  const cmd = `cd /opt/vido/app && TOPIC=$(echo ${topicB64} | base64 -d) && node scripts/demo-auto-produce.js "$TOPIC" ${duration} http://43.98.167.151:4600`;
  c.exec(cmd, (err, stream) => {
    if (err) { console.error(err); c.end(); return; }
    stream.on('close', (code) => {
      console.log(`\n▶ remote 退出码: ${code}`);
      c.end();
      process.exit(code || 0);
    });
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
  });
});
c.on('error', e => { console.error('SSH err:', e.message); process.exit(2); });
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: pwd, readyTimeout: 20000, keepaliveInterval: 30000 });
