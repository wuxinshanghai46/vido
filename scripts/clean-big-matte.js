// 清理服务器上超大 qtrle MOV（旧代码产物）释放磁盘
const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  c.exec('du -sh /opt/vido/app/outputs/jimeng-matted/ 2>/dev/null && echo "---删除 .mov 和 0 字节文件---" && find /opt/vido/app/outputs/jimeng-matted/ -name "*.mov" -size +100M -exec rm -v {} \\; 2>&1 && find /opt/vido/app/outputs/jimeng-matted/ -empty -type f -exec rm -v {} \\; 2>&1 && find /opt/vido/app/outputs/jimeng-matted/ -type d -empty -exec rmdir {} \\; 2>&1 && echo "---清理后---" && du -sh /opt/vido/app/outputs/jimeng-matted/ 2>/dev/null && df -h / | tail -2', (e, s) => {
    let o = '';
    s.on('close', () => { console.log(o); c.end(); }).on('data', d => o += d.toString()).stderr.on('data', d => o += d.toString());
  });
});
c.on('error', e => console.error(e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD });
