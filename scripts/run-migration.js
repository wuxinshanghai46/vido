// 上传迁移脚本到服务器并流式执行
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const c = new Client();
c.on('ready', () => {
  const scriptContent = fs.readFileSync(path.resolve(__dirname, 'migrate-to-data-disk.sh'), 'utf-8');
  const remotePath = '/root/migrate-to-data-disk.sh';
  c.sftp((err, sftp) => {
    if (err) { console.error(err); c.end(); return; }
    sftp.writeFile(remotePath, scriptContent, { mode: 0o755 }, (err2) => {
      if (err2) { console.error('上传失败:', err2.message); c.end(); return; }
      console.log('✓ 脚本已上传到', remotePath);
      console.log('');
      // 执行
      c.exec(`bash ${remotePath}`, (err3, stream) => {
        if (err3) { console.error(err3); c.end(); return; }
        stream.on('close', (code) => {
          console.log(`\n▶ 远程退出码: ${code}`);
          c.end();
          process.exit(code || 0);
        });
        stream.on('data', d => process.stdout.write(d.toString()));
        stream.stderr.on('data', d => process.stderr.write(d.toString()));
      });
    });
  });
});
c.on('error', e => { console.error('SSH err:', e.message); process.exit(2); });
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD, readyTimeout: 20000, keepaliveInterval: 30000 });
