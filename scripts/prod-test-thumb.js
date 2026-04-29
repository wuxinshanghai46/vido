const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  // 直接在生产用 curl 测试 thumbnail 端点
  const cmd = `
    cd /opt/vido/app
    # 1. 拿 admin token
    TOKEN=$(curl -s -X POST http://127.0.0.1:4600/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).data.access_token||'')}catch{console.log('')}})")
    echo "TOKEN前缀: \${TOKEN:0:30}..."
    
    # 2. 拿一个真实 avatar task id
    TID=$(node -e "const db=require('./src/models/database');const ts=db.listAvatarTasks().filter(t=>(t.videoPath||t.local_path)&&require('fs').existsSync(t.videoPath||t.local_path));console.log(ts[0]?.id||'')")
    echo "task id: \$TID"
    
    # 3. 拿视频列表，看 thumbnail_url 字段
    echo "--- /api/dh/videos/tasks 第 1 条字段 ---"
    curl -s "http://127.0.0.1:4600/api/dh/videos/tasks?token=\$TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const t=j.data?.[0];if(!t)return console.log('no data');console.log('id:',t.id);console.log('videoUrl:',t.videoUrl);console.log('image_url:',t.image_url);console.log('thumbnail_url:',t.thumbnail_url);console.log('videoPath:',t.videoPath)})"
    
    # 4. 直接 curl thumbnail 端点
    echo "--- thumbnail 端点 ---"
    curl -s -o /tmp/thumb.jpg -w "http=%{http_code} size=%{size_download} ct=%{content_type}\n" "http://127.0.0.1:4600/api/dh/videos/tasks/\$TID/thumbnail?token=\$TOKEN"
    ls -la /tmp/thumb.jpg 2>&1
    file /tmp/thumb.jpg 2>&1
  `;
  c.exec(cmd, (err, stream) => {
    if (err) { console.log(err); c.end(); return; }
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', () => c.end());
  });
}).on('error', e => console.log('ERR', e.message));
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: process.argv[2], readyTimeout: 25000 });
