// 临时诊断脚本：SSH 到生产机，拉 fullbody / outpaint 相关错误日志
const { Client } = require('ssh2');

const HOST = process.env.VIDO_PROD_HOST;
const PASS = process.env.VIDO_PROD_PASS;
if (!HOST || !PASS) {
  console.error('需要 VIDO_PROD_HOST 和 VIDO_PROD_PASS 环境变量');
  process.exit(1);
}

const CMDS = [
  'pm2 list',
  'pm2 logs vido --err --lines 200 --nostream 2>&1 | grep -E -i "fullbody|outpaint|全身|seedream|nanobanana" | tail -80',
  'pm2 logs vido --lines 200 --nostream 2>&1 | grep -E -i "fullbody|outpaint|全身" | tail -80',
  'ls -lah /opt/vido/app/outputs/presets/ 2>&1 | grep -i fullbody | tail -10',
  'tail -200 /root/.pm2/logs/vido-error.log 2>&1 | grep -E -i "fullbody|outpaint|全身|sharp|seedream" | tail -40',
  'node -e "try{const s=JSON.parse(require(\\"fs\\").readFileSync(\\"/opt/vido/app/outputs/settings.json\\",\\"utf-8\\"));const ark=(s.providers||[]).find(p=>/volces|火山方舟/i.test((p.api_url||\\"\\")+(p.name||\\"\\")));console.log(\\"ark provider:\\", ark?{id:ark.id,hasKey:!!ark.api_key,models:(ark.models||[]).map(m=>({id:m.id,use:m.use})).slice(0,10)}:null);}catch(e){console.log(\\"err\\",e.message)}"',
];

const conn = new Client();
conn.on('ready', async () => {
  for (const cmd of CMDS) {
    console.log('\n────── $', cmd.slice(0, 120));
    await new Promise((resolve) => {
      conn.exec(cmd, (err, stream) => {
        if (err) { console.log('exec err:', err.message); return resolve(); }
        stream.on('close', () => resolve());
        stream.on('data', d => process.stdout.write(d.toString()));
        stream.stderr.on('data', d => process.stderr.write(d.toString()));
      });
    });
  }
  conn.end();
}).on('error', e => {
  console.error('SSH error:', e.message);
  process.exit(2);
}).connect({
  host: HOST, port: 22, username: 'root', password: PASS, readyTimeout: 15000,
});
