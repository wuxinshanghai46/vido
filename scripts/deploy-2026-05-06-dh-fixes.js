#!/usr/bin/env node
/**
 * 部署 2026-05-06 数字人三处修复 + baidu-aip 配置
 *
 * 用法：
 *   VIDO_DEPLOY_HOST=43.98.167.151 \
 *   VIDO_DEPLOY_USER=root \
 *   VIDO_DEPLOY_PASSWORD='...' \
 *   BAIDU_AK=xxx BAIDU_SK=yyy \
 *   node scripts/deploy-2026-05-06-dh-fixes.js
 *
 * 改动：
 *   - 自定义背景两阶段管线失败不再静默 fallback，明确报错
 *   - 移除「保存到我的形象」必须先生成动态样片的硬性限制
 *   - 新增 POST /api/dh/images/compose-scene（人物图+背景图 → 百度抠像 sharp 合成）
 *   - 新增 baidu-aip provider 到 settings.json（如不存在）
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST;
const USER = process.env.VIDO_DEPLOY_USER || 'root';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const PORT = parseInt(process.env.VIDO_DEPLOY_PORT || '22', 10);
const REMOTE_ROOT = '/opt/vido/app';
const PM2_APP = 'vido';

const BAIDU_AK = process.env.BAIDU_AK || '';
const BAIDU_SK = process.env.BAIDU_SK || '';

if (!HOST || !PASSWORD) {
  console.error('ERROR: 缺少 VIDO_DEPLOY_HOST / VIDO_DEPLOY_PASSWORD');
  process.exit(1);
}

const FILES = [
  'src/routes/digitalHuman.js',
  'public/digital-human.html',
  'public/js/digital-human.js',
  'public/css/digital-human-wizard.css',
];

const REPO_ROOT = path.resolve(__dirname, '..');

function connect() {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => resolve(c));
    c.on('error', reject);
    c.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 30000 });
  });
}
function sftpOpen(c) { return new Promise((res, rej) => c.sftp((err, s) => err ? rej(err) : res(s))); }
function sftpUpload(sftp, local, remote) {
  return new Promise((resolve, reject) => sftp.fastPut(local, remote, e => e ? reject(e) : resolve()));
}
function exec(c, cmd) {
  return new Promise((resolve, reject) => {
    c.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream.on('close', code => resolve({ code, out, errOut }));
      stream.on('data', d => out += d.toString());
      stream.stderr.on('data', d => errOut += d.toString());
    });
  });
}

(async () => {
  console.log(`▶ 连接 ${USER}@${HOST}`);
  const c = await connect();
  const sftp = await sftpOpen(c);

  // 1) 备份 + 上传 3 个文件
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  console.log(`\n▶ 备份远端老版本（${stamp}）`);
  for (const rel of FILES) {
    const r = await exec(c, `cd ${REMOTE_ROOT} && [ -f ${rel} ] && cp -p ${rel} ${rel}.bak-${stamp} || echo no_backup`);
    console.log(`  ${rel}: ${(r.out || r.errOut).trim()}`);
  }

  console.log(`\n▶ 上传`);
  for (const rel of FILES) {
    const local = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(local)) { console.log(`  ⊘ 本地缺失: ${rel}`); continue; }
    const remote = path.posix.join(REMOTE_ROOT, rel.replace(/\\/g, '/'));
    await sftpUpload(sftp, local, remote);
    const sz = fs.statSync(local).size;
    console.log(`  ↑ ${rel} (${sz} bytes)`);
  }

  // 2) 配置 baidu-aip provider（如已存在且 key 同则不动；否则写入/更新）
  if (BAIDU_AK && BAIDU_SK) {
    console.log(`\n▶ 配置 baidu-aip provider`);
    const apiKey = `${BAIDU_AK}:${BAIDU_SK}`;
    // 用 base64 把要执行的 node 代码塞过去，避免 shell 转义问题
    const nodeSnippet = `
      const path=require('path');
      const fs=require('fs');
      const settingsPath=path.join('${REMOTE_ROOT}','outputs','settings.json');
      let s={};try{s=JSON.parse(fs.readFileSync(settingsPath,'utf8'))}catch(e){s={providers:[]}}
      s.providers=s.providers||[];
      const apiKey=${JSON.stringify(apiKey)};
      const existing=s.providers.find(p=>p.id==='baidu-aip'||p.preset==='baidu-aip');
      const preset={name:'百度 AI 开放平台',api_url:'https://aip.baidubce.com',defaultModels:[{id:'body_seg',name:'人像分割（0.004 元/次 · 视频抠像用·逐帧）',type:'matting',use:'matting'}]};
      if(existing){
        if(existing.api_key!==apiKey){existing.api_key=apiKey;existing.enabled=true;if(!existing.models||!existing.models.length)existing.models=preset.defaultModels;console.log('[baidu-aip] 已存在 → 更新 api_key')}
        else console.log('[baidu-aip] 已存在且 key 相同，跳过')
      }else{
        s.providers.push({id:'baidu-aip',preset:'baidu-aip',name:preset.name,api_url:preset.api_url,api_key:apiKey,enabled:true,models:preset.defaultModels});
        console.log('[baidu-aip] 新增')
      }
      fs.writeFileSync(settingsPath,JSON.stringify(s,null,2));
      const v=JSON.parse(fs.readFileSync(settingsPath,'utf8'));
      const p=v.providers.find(x=>x.id==='baidu-aip');
      console.log(JSON.stringify({id:p.id,hasKey:!!p.api_key,fmt:p.api_key&&p.api_key.includes(':')?'AK:SK':'BAD',models:p.models.map(m=>m.id)}));
    `.trim();
    const b64 = Buffer.from(nodeSnippet).toString('base64');
    const r = await exec(c, `cd ${REMOTE_ROOT} && echo ${b64} | base64 -d | node`);
    console.log((r.out || r.errOut).trim());
  } else {
    console.log(`\n▶ 跳过 baidu-aip 配置（未提供 BAIDU_AK / BAIDU_SK）`);
  }

  // 3) 重启 PM2
  console.log(`\n▶ 重启 PM2 ${PM2_APP}`);
  const r1 = await exec(c, `pm2 reload ${PM2_APP} --update-env 2>&1 || pm2 restart ${PM2_APP} 2>&1`);
  console.log((r1.out || r1.errOut).trim().split('\n').slice(-5).join('\n'));

  // 4) 健康检查 + 新端点存在性
  console.log(`\n▶ 验证`);
  const r2 = await exec(c, `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/api/health`);
  console.log('  /api/health:', r2.out.trim());
  const r3 = await exec(c, `curl -s -X POST -H "Content-Type: application/json" -d '{}' http://127.0.0.1:4600/api/dh/images/compose-scene`);
  console.log('  POST /api/dh/images/compose-scene (no auth):', r3.out.trim());
  // 简单验证 baidu-aip 配置在 server 端能跑通
  if (BAIDU_AK && BAIDU_SK) {
    const r4 = await exec(c, `cd ${REMOTE_ROOT} && node -e "
      (async () => {
        const baidu = require('./src/services/baiduMattingService');
        const sharp = require('sharp');
        const buf = await sharp({create:{width:200,height:200,channels:3,background:{r:200,g:100,b:100}}}).png().toBuffer();
        try {
          const tok = await baidu.getAccessToken();
          console.log('access_token: OK len=' + tok.length);
          const fg = await baidu.segmentFrame(buf, 'foreground');
          console.log('segmentFrame: OK ' + fg.length + 'B');
        } catch (e) { console.log('FAIL: ' + e.message); }
      })();
    "`);
    console.log('  baidu_matting smoke:\n   ', (r4.out || r4.errOut).trim().replace(/\n/g, '\n    '));
  }

  c.end();
  console.log('\n✓ 部署完成');
})().catch(e => {
  console.error('\n✗ 部署失败:', e.message);
  process.exit(1);
});
