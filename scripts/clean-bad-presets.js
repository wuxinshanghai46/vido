// 删掉 3 个生成不合规的预设（印度男性/动漫少女/动漫少年）→ 用户下次点卡片会自动重生成（用我们的新 seed + 强 negative prompt）
const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  c.exec('cd /opt/vido/app/outputs/presets && for f in avatar_india-1.png avatar_anime-1.png avatar_anime-2.png; do if [ -f $f ]; then echo "删除: $f"; rm $f; fi; done && echo "---" && ls -la avatar_india-1.png avatar_anime-1.png avatar_anime-2.png 2>&1', (e, s) => {
    let o = '';
    s.on('close', () => { console.log(o); c.end(); }).on('data', d => o += d.toString()).stderr.on('data', d => o += d.toString());
  });
});
c.on('error', e => console.error(e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD });
