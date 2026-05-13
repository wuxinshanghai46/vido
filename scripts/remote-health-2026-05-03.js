const { Client } = require('ssh2');

const c = new Client();
const cmd = `
pm2 jlist | node - <<'NODE'
let d='';
process.stdin.on('data', c => d += c).on('end', () => {
  const p = JSON.parse(d).find(x => x.name === 'vido');
  if (!p) { console.log('pm2 app not found'); return; }
  console.log(JSON.stringify({
    status: p.pm2_env.status,
    restarts: p.pm2_env.restart_time,
    PORT: p.pm2_env.env && p.pm2_env.env.PORT,
    pm_cwd: p.pm2_env.pm_cwd
  }, null, 2));
});
NODE
echo ---PORTS---
ss -ltnp 2>/dev/null | grep -E 'node|:3007|:4600' || true
echo ---HEALTH---
for p in 3007 4600 80; do
  printf "$p "
  curl -s -o /tmp/vido-health-$p.out -w "%{http_code}" http://127.0.0.1:$p/api/health
  echo
  head -c 180 /tmp/vido-health-$p.out || true
  echo
done
echo ---LOGS---
pm2 logs vido --lines 35 --nostream --raw 2>&1 | tail -35
`;

c.on('ready', () => {
  c.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
    stream.on('close', code => {
      c.end();
      process.exit(code || 0);
    });
  });
}).on('error', err => {
  console.error(err.message);
  process.exit(1);
}).connect({
  host: process.env.VIDO_DEPLOY_HOST || '43.98.167.151',
  port: Number(process.env.VIDO_DEPLOY_PORT || 22),
  username: process.env.VIDO_DEPLOY_USER || 'root',
  password: process.env.VIDO_DEPLOY_PASSWORD,
  readyTimeout: 25000,
});
