const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  const cmd = `
    echo "=== 1. 最近 extract 报错（详细）===";
    pm2 logs vido --lines 500 --nostream 2>&1 | grep -B 1 -A 8 -iE "Radar.*失败|extract.*error|extractContent|/api/radar/extract" | tail -60;
    echo "";
    echo "=== 2. mcpManager 中 media-crawler 状态 ===";
    cd /opt/vido/app && node -e "
      const m = require('./src/services/mcpManager');
      const insts = m.listInstances();
      const mc = insts.find(i => i.id === 'media-crawler');
      console.log('media-crawler:', mc ? JSON.stringify({status: mc.status, tools: (mc.tools||[]).map(t=>t.name)}) : 'NOT FOUND');
    " 2>&1
  `;
  c.exec(cmd, (err, stream) => {
    if (err) { console.log(err); c.end(); return; }
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', () => c.end());
  });
}).on('error', e => console.log('ERR', e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.argv[2], readyTimeout: 25000 });
