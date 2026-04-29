const path=require('path'),fs=require('fs'),{Client}=require('ssh2');
const HOST=process.env.VIDO_DEPLOY_HOST,PASSWORD=process.env.VIDO_DEPLOY_PASSWORD;
const FILES=['src/routes/digitalHuman.js','public/js/digital-human.js'];
const REPO=path.resolve(__dirname,'..');
function conn(){return new Promise((r,j)=>{const c=new Client();c.on('ready',()=>r(c));c.on('error',j);c.connect({host:HOST,port:22,username:'root',password:PASSWORD,readyTimeout:25000});});}
function so(c){return new Promise((r,j)=>c.sftp((e,s)=>e?j(e):r(s)));}
function up(s,l,r){return new Promise((res,rej)=>s.fastPut(l,r,e=>e?rej(e):res()));}
function ex(c,cmd){return new Promise(res=>c.exec(cmd,(e,s)=>{if(e)return res(e.message);let o='';s.on('data',d=>o+=d);s.stderr.on('data',d=>o+=d);s.on('close',()=>res(o));}));}
(async()=>{const c=await conn();const sf=await so(c);for(const r of FILES){await up(sf,path.join(REPO,r),path.posix.join('/opt/vido/app',r.split(path.sep).join('/')));console.log('  ↑',r);}console.log((await ex(c,'pm2 reload vido --update-env 2>&1')).trim());await new Promise(r=>setTimeout(r,1500));console.log((await ex(c,'curl -s -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:4600/api/health')).trim());c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
