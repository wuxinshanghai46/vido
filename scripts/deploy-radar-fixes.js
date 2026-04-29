// 部署：搜索 500 修复 + douyin 排行同步 + 删除红框区
const path=require('path'),{Client}=require('ssh2');
const HOST=process.env.VIDO_DEPLOY_HOST,PASSWORD=process.env.VIDO_DEPLOY_PASSWORD;
const FILES=[
  'src/routes/radar.js',
  'src/services/radarService.js',
  'public/replicate.html',
];
const REPO=path.resolve(__dirname,'..');
function conn(){return new Promise((r,j)=>{const c=new Client();c.on('ready',()=>r(c));c.on('error',j);c.connect({host:HOST,port:22,username:'root',password:PASSWORD,readyTimeout:25000});});}
function so(c){return new Promise((r,j)=>c.sftp((e,s)=>e?j(e):r(s)));}
function up(s,l,r){return new Promise((res,rej)=>s.fastPut(l,r,e=>e?rej(e):res()));}
function ex(c,cmd){return new Promise(res=>c.exec(cmd,(e,s)=>{if(e)return res(e.message);let o='';s.on('data',d=>o+=d);s.stderr.on('data',d=>o+=d);s.on('close',()=>res(o));}));}
(async()=>{
  const c=await conn();const sf=await so(c);
  for(const r of FILES){
    await up(sf,path.join(REPO,r),path.posix.join('/opt/vido/app',r.split(path.sep).join('/')));
    console.log('  ↑',r);
  }
  console.log((await ex(c,'pm2 reload vido --update-env 2>&1')).trim());
  await new Promise(r=>setTimeout(r,1500));
  console.log((await ex(c,'curl -s -o /dev/null -w "health=%{http_code}\\n" http://127.0.0.1:4600/api/health')).trim());

  // 测试新 ranking 接口
  console.log('==test ranking endpoints==');
  console.log((await ex(c,`TOKEN=$(curl -s -X POST http://127.0.0.1:4600/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).data.access_token||'')}catch{console.log('')}})") && \
    echo "[ranking/videos]" && curl -s -w " http=%{http_code}\\n" "http://127.0.0.1:4600/api/radar/ranking/videos?sort=likes&token=$TOKEN" | head -c 400 && echo "" && \
    echo "[ranking/bloggers]" && curl -s -w " http=%{http_code}\\n" "http://127.0.0.1:4600/api/radar/ranking/bloggers?token=$TOKEN" | head -c 400 && echo "" && \
    echo "[ranking/stats]" && curl -s -w " http=%{http_code}\\n" "http://127.0.0.1:4600/api/radar/ranking/stats?token=$TOKEN" | head -c 400`)).trim());

  // 测试 extract 容错 — 给一个不存在的 URL，看是否返回友好错误而非崩溃
  console.log('==test extract resilience==');
  console.log((await ex(c,`TOKEN=$(curl -s -X POST http://127.0.0.1:4600/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).data.access_token||'')}catch{console.log('')}})") && \
    curl -s -w " http=%{http_code}\\n" -X POST "http://127.0.0.1:4600/api/radar/extract?token=$TOKEN" -H "Content-Type: application/json" -d '{"url":"https://www.douyin.com/video/0000000000000000000"}' | head -c 800`)).trim());
  c.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
