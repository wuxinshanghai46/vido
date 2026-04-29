const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  const cmd = `
    TOKEN=$(curl -s -X POST http://127.0.0.1:4600/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).data.access_token||'')}catch{console.log('')}})")
    echo "=== 调用 extract（用户实际格式 - 含分享文案）==="
    curl -s -w "\\n[HTTP=%{http_code}]\\n" -X POST "http://127.0.0.1:4600/api/radar/extract?token=$TOKEN" -H "Content-Type: application/json" -d '{"url":"https://v.douyin.com/JmrzKWnn-go/ Yzt:/ 06/15 z@G.lv"}' | head -c 800
    echo ""
    echo "=== 直接 fetch iesdouyin SSR（douyin 包同款方法） ==="
    curl -s -L -A "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1" "https://v.douyin.com/JmrzKWnn-go/" -o /tmp/dy.html -w "code=%{http_code} size=%{size_download} final=%{url_effective}\\n"
    echo "is HTML?"
    head -c 200 /tmp/dy.html
  `;
  c.exec(cmd, (err, stream) => {
    if (err) { console.log(err); c.end(); return; }
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', () => c.end());
  });
}).on('error', e => console.log('ERR', e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.argv[2], readyTimeout: 25000 });
