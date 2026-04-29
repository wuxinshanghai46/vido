const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  c.exec('echo "=== 所有块设备 ===" && lsblk -f && echo && echo "=== 所有挂载点 ===" && df -hT | grep -vE "tmpfs|devtmpfs|overlay" && echo && echo "=== 挂载信息 ===" && mount | grep -vE "tmpfs|devtmpfs|proc|sys|cgroup" && echo && echo "=== 未挂载的数据盘（有文件系统但未 mount） ===" && lsblk -rno NAME,FSTYPE,MOUNTPOINT | awk "$2 != \\"\\" && $3 == \\"\\"" && echo && echo "=== outputs 目录结构 + 大小 ===" && du -sh /opt/vido/app/outputs/* 2>/dev/null | sort -h | tail -20 && echo && echo "=== OUTPUT_DIR 环境变量 ===" && grep -i output /opt/vido/app/.env', (e, s) => {
    let o = '';
    s.on('close', () => { console.log(o); c.end(); }).on('data', d => o += d.toString()).stderr.on('data', d => o += d.toString());
  });
});
c.on('error', e => console.error(e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.env.VIDO_DEPLOY_PASSWORD });
