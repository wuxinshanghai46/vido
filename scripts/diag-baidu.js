// SSH 到服务器，真实 curl 测 OAuth + body_seg，看 401 根因
const { Client } = require('ssh2');
const pwd = process.env.VIDO_DEPLOY_PASSWORD;
if (!pwd) { console.error('need VIDO_DEPLOY_PASSWORD'); process.exit(1); }

const remote = `
set -e
cd /opt/vido/app
echo "▶ 读取 settings.json 里的 baidu-aip key..."
KEY=$(node -e "const j=require('./outputs/settings.json');const p=(j.providers||[]).find(x=>x.id==='baidu-aip');process.stdout.write(p.api_key||'')")
AK=$(echo "$KEY" | cut -d: -f1)
SK=$(echo "$KEY" | cut -d: -f2-)
echo "AK前4=\${AK:0:4}... SK前4=\${SK:0:4}..."

echo
echo "▶ 请求 OAuth token..."
TOKEN_RESP=$(curl -s "https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=$AK&client_secret=$SK")
echo "OAuth 响应: $TOKEN_RESP"
TOKEN=$(echo "$TOKEN_RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).access_token||'')}catch(e){console.log('')}}")

if [ -z "$TOKEN" ]; then
  echo "✗ 没拿到 token"; exit 1
fi
echo "Token 前 20: \${TOKEN:0:20}..."

echo
echo "▶ 拿一帧本地图片 base64..."
FRAME=/opt/vido/app/outputs/jimeng-matted/.matte_*/frames/f_00001.jpg
FRAME_FILE=$(ls $FRAME 2>/dev/null | head -1)
if [ -z "$FRAME_FILE" ]; then
  # 没有就临时抽一帧
  mkdir -p /tmp/diag
  /opt/vido/app/node_modules/ffmpeg-static/ffmpeg -y -i outputs/jimeng-assets/demo_20s_1776511412.mp4 -vframes 1 -q:v 3 /tmp/diag/frame1.jpg -loglevel error
  FRAME_FILE=/tmp/diag/frame1.jpg
fi
echo "使用帧: $FRAME_FILE  大小: $(stat -c%s $FRAME_FILE) 字节"

B64=$(base64 -w0 $FRAME_FILE)
echo "base64 长度: \${#B64}"

echo
echo "▶ 调用 body_seg..."
curl -sS -X POST \
  "https://aip.baidubce.com/rest/2.0/image-classify/v1/body_seg?access_token=$TOKEN" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "image=$B64" \
  --data-urlencode "type=foreground" \
  | head -c 500
echo
`;

const c = new Client();
c.on('ready', () => {
  c.exec(remote, (err, stream) => {
    if (err) { console.error(err); c.end(); return; }
    stream.on('close', (code) => { console.log(`\n▶ remote exit: ${code}`); c.end(); });
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
  });
});
c.on('error', e => { console.error(e.message); process.exit(2); });
c.connect({ host: '43.98.167.151', port: 22, username: 'root', password: pwd, readyTimeout: 20000 });
