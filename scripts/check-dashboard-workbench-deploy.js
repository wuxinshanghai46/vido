const { Client } = require('ssh2');
const client = new Client();
client.on('ready', () => {
  client.exec("cd /opt/vido/app && sha256sum src/routes/dashboard.js public/index.html public/css/dashboard-workbench.css public/js/dashboard-workbench.js; pm2 status vido --no-color; echo HEALTH; curl -sS -m 8 -w '\\nHTTP:%{http_code}\\n' http://127.0.0.1:4600/api/health", (error, stream) => {
    if (error) throw error;
    stream.on('data', chunk => process.stdout.write(chunk));
    stream.stderr.on('data', chunk => process.stderr.write(chunk));
    stream.on('close', code => { client.end(); process.exitCode = code || 0; });
  });
}).on('error', error => { console.error(error.message || error); process.exitCode = 1; }).connect({
  host: process.env.VIDO_DEPLOY_HOST || '43.98.167.151', port: 22, username: 'root',
  password: process.env.VIDO_DEPLOY_PASSWORD, readyTimeout: 25000,
});
