// 删除 5 个用户识别到的多视图预设，等下次点卡片时用新 seed + 更强 negative 重生成
// 3 原有: india-1 / anime-1 / anime-2
// 2 新加: male-edu-2（理工教授）/ female-life-2（美食博主）
const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  c.exec('cd /opt/vido/app/outputs/presets && for f in avatar_india-1.png avatar_anime-1.png avatar_anime-2.png avatar_male-edu-2.png avatar_female-life-2.png; do if [ -f $f ]; then echo "删除: $f"; rm $f; fi; done && echo "---剩余预设---" && ls avatar_*.png | wc -l && echo "---"', (e, s) => {
    let o = '';
    s.on('close', () => { console.log(o); c.end(); }).on('data', d => o += d.toString()).stderr.on('data', d => o += d.toString());
  });
});
c.on('error', e => console.error(e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD });
