// 拉取生产 settings.json，列出与 matting/抠图/人像分割相关的 provider 及其模型
const { Client } = require('ssh2');

const c = new Client();
c.on('ready', () => {
  c.exec('cat /opt/vido/app/outputs/settings.json', (err, stream) => {
    if (err) { console.error(err); c.end(); return; }
    let out = '';
    stream.on('close', () => {
      try {
        const j = JSON.parse(out);
        const want = ['jimeng', 'volcengine', 'volc', 'baidu', 'aliyun', 'tencent', 'replicate', 'modelscope'];
        const matched = (j.providers || []).filter(p =>
          want.some(w =>
            (p.id || '').toLowerCase().includes(w) ||
            (p.preset || '').toLowerCase().includes(w) ||
            (p.name || '').toLowerCase().includes(w)
          )
        );
        console.log(`\n=== 生产 settings.json 中与候选抠图/视觉供应商匹配的 provider: ${matched.length} 个 ===`);
        matched.forEach(p => {
          console.log(`\n■ ${p.name || p.id} (id=${p.id}, preset=${p.preset || '-'})`);
          console.log(`  api_url: ${p.api_url || '-'}`);
          console.log(`  api_key: ${p.api_key ? 'YES' : 'NO'}`);
          console.log(`  enabled: ${p.enabled}`);
          const models = p.models || [];
          console.log(`  models: ${models.length} 个`);
          models.forEach(m => {
            const hint = /seg|matting|matte|portrait|bg|抠|分割|人像|mask|chroma|alpha/i.test(`${m.id} ${m.name || ''}`) ? '  ⬅️ 抠图/分割候选' : '';
            console.log(`    - ${m.id} | use=${m.use || '?'} | type=${m.type || '?'} | ${(m.name || '').slice(0, 70)}${hint}`);
          });
        });
      } catch (e) {
        console.error('parse err:', e.message);
      }
      c.end();
    });
    stream.on('data', d => out += d.toString());
  });
});
c.on('error', e => console.error('ssh err:', e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD, readyTimeout: 20000 });
