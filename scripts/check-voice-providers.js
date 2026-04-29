const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  c.exec('cat /opt/vido/app/outputs/settings.json | node -e "let d=\'\';process.stdin.on(\'data\',c=>d+=c).on(\'end\',()=>{const j=JSON.parse(d);(j.providers||[]).filter(p=>/voice|clone|tts|vocal|fish|aliyun-tts|minimax|elevenlabs|xunfei|volc/i.test((p.id||\'\')+(p.name||\'\'))).forEach(p=>{console.log(\'■ \'+p.name+\' (id=\'+p.id+\') enabled=\'+p.enabled+\' has_key=\'+!!p.api_key+\' url=\'+(p.api_url||\'-\'));});})"', (e, s) => {
    let o = '';
    s.on('close', () => { console.log(o); c.end(); }).on('data', d => o += d.toString()).stderr.on('data', d => o += d.toString());
  });
});
c.on('error', e => console.error(e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD });
