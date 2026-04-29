const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  c.exec('pm2 jlist | node -e "let d=\'\';process.stdin.on(\'data\',c=>d+=c).on(\'end\',()=>{const j=JSON.parse(d).find(x=>x.name===\'vido\');console.log(\'status=\'+j.pm2_env.status+\' uptime_sec=\'+Math.floor((Date.now()-j.pm2_env.pm_uptime)/1000)+\' restarts=\'+j.pm2_env.restart_time)})" && ls -la /opt/vido/app/src/services/tutorialProducer.js 2>&1 && echo --- && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4600/api/health', (err, stream) => {
    if (err) { console.error(err); c.end(); return; }
    stream.on('close', () => c.end()).on('data', d => process.stdout.write(d.toString())).stderr.on('data', d => process.stderr.write(d.toString()));
  });
});
c.on('error', e => console.error(e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD, readyTimeout: 20000 });
