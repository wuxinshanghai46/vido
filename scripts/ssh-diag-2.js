const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  const cmd = `
    echo "=== 1. digital-human.js 语法检查 ===";
    cd /opt/vido/app && node -c public/js/digital-human.js 2>&1 | head -5;
    echo "";
    echo "=== 2. 最近 extract / radarService 错误 ===";
    pm2 logs vido --lines 200 --nostream --err 2>&1 | grep -iE "radar|extract|500|TypeError|Error.*at" | tail -20;
    echo "";
    echo "=== 3. 测试 extract 端点 ===";
    TOKEN=$(curl -s -X POST http://127.0.0.1:4600/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).data.access_token||'')}catch{console.log('')}})");
    echo "extract 测试结果:";
    curl -s -X POST "http://127.0.0.1:4600/api/radar/extract?token=$TOKEN" -H "Content-Type: application/json" -d '{"url":"https://v.douyin.com/JmrzKWnn-go/"}' | head -c 500;
  `;
  c.exec(cmd, (err, stream) => {
    if (err) { console.log(err); c.end(); return; }
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', () => c.end());
  });
}).on('error', e => console.log('ERR', e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.argv[2], readyTimeout: 25000 });
