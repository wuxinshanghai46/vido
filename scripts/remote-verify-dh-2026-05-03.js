const { Client } = require('ssh2');

const cmd = `
set -e
echo HTML
curl -s -o /tmp/dh.html -w "%{http_code} %{size_download}\\n" http://127.0.0.1:4600/digital-human.html
grep -o "/js/digital-human.js?v=[0-9]*" /tmp/dh.html | tail -1
echo JS
curl -s -o /tmp/dh.js -w "%{http_code} %{size_download}\\n" "http://127.0.0.1:4600/js/digital-human.js?v=45"
node --check /tmp/dh.js
echo HEALTH
curl -s -o /tmp/h -w "%{http_code}\\n" http://127.0.0.1:4600/api/health
head -c 160 /tmp/h
echo
`;

const c = new Client();
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
