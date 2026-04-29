const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  c.exec('ls -la /opt/vido/app/public/js/app.js /opt/vido/app/public/index.html | head -5 && echo "---" && grep -c "jimeng-omni-matte" /opt/vido/app/public/js/app.js && grep -c "aiWriteAvatarScriptMain" /opt/vido/app/public/js/app.js && echo "---" && pm2 jlist 2>/dev/null | node -e "let d=\\\"\\\";process.stdin.on(\\\"data\\\",c=>d+=c).on(\\\"end\\\",()=>{try{const j=JSON.parse(d).find(x=>x.name===\\\"vido\\\");console.log(\\\"pm2=\\\",j.pm2_env.status,\\\"restarts=\\\",j.pm2_env.restart_time,\\\"up_sec=\\\",Math.floor((Date.now()-j.pm2_env.pm_uptime)/1000))}catch(e){console.log(\\\"err\\\",e.message)}})" && echo "---" && curl -s -o /dev/null -w "html=%{http_code}\\n" http://127.0.0.1:4600/index.html && curl -s -o /dev/null -w "write-script=%{http_code}\\n" -X POST http://127.0.0.1:4600/api/avatar/jimeng-omni/write-script -H "Content-Type: application/json" -d "{}"', (err, stream) => {
    if (err) { console.error(err); c.end(); return; }
    stream.on('close', () => c.end()).on('data', d => process.stdout.write(d.toString())).stderr.on('data', d => process.stderr.write(d.toString()));
  });
});
c.on('error', e => console.error(e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD });
