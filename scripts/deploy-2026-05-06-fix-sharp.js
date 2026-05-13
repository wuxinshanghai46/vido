#!/usr/bin/env node
/**
 * 修服务器 sharp 不兼容 Node 16 的问题
 *   server: Node 16.20.2，当前 sharp 需要 Node 18+ → 装 sharp@0.32.6（last to support Node 14+）
 *
 * 用法：
 *   VIDO_DEPLOY_HOST=43.98.167.151 VIDO_DEPLOY_USER=root VIDO_DEPLOY_PASSWORD='...' \
 *     node scripts/deploy-2026-05-06-fix-sharp.js
 */
const { Client } = require('ssh2');
const HOST = process.env.VIDO_DEPLOY_HOST;
const USER = process.env.VIDO_DEPLOY_USER || 'root';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const PORT = parseInt(process.env.VIDO_DEPLOY_PORT || '22', 10);
if (!HOST || !PASSWORD) { console.error('miss env'); process.exit(1); }
const REMOTE_ROOT = '/opt/vido/app';

function exec(c, cmd, timeout = 600000) {
  return new Promise((resolve) => {
    c.exec(cmd, (err, stream) => {
      if (err) return resolve({ code: -1, out: '', errOut: err.message });
      let out = '', errOut = '';
      const t = setTimeout(() => { stream.end(); resolve({ code: -2, out, errOut: errOut + ' (timeout)' }); }, timeout);
      stream.on('close', code => { clearTimeout(t); resolve({ code, out, errOut }); });
      stream.on('data', d => out += d.toString());
      stream.stderr.on('data', d => errOut += d.toString());
    });
  });
}

(async () => {
  const c = new Client();
  await new Promise((res, rej) => c.on('ready', res).on('error', rej).connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 30000 }));
  console.log('connected');

  console.log('\n▶ 当前 sharp 版本');
  let r = await exec(c, `cd ${REMOTE_ROOT} && node -e "try{const p=require('./node_modules/sharp/package.json');console.log(p.version)}catch(e){console.log('not loadable: '+e.message.split('\\n')[0])}"`);
  console.log(' ', (r.out || r.errOut).trim());

  console.log('\n▶ 安装 sharp@0.32.6（Node 16 兼容）');
  // 用 --no-save 不动 package.json（local + server lockfile 会一致性问题，避免触发）
  r = await exec(c, `cd ${REMOTE_ROOT} && npm install sharp@0.32.6 --no-save --silent 2>&1 | tail -30`, 600000);
  console.log((r.out || r.errOut).trim());

  console.log('\n▶ 验证 sharp + 百度抠像合成可用');
  r = await exec(c, `cd ${REMOTE_ROOT} && node -e "
    (async () => {
      try {
        const sharp = require('sharp');
        console.log('sharp version:', sharp.versions.sharp || require('./node_modules/sharp/package.json').version);
        const buf = await sharp({create:{width:200,height:200,channels:3,background:{r:200,g:100,b:100}}}).png().toBuffer();
        console.log('sharp create png OK:', buf.length, 'B');
        const baidu = require('./src/services/baiduMattingService');
        const tok = await baidu.getAccessToken();
        console.log('baidu access_token OK len=' + tok.length);
        const fg = await baidu.segmentFrame(buf, 'foreground');
        console.log('baidu segmentFrame OK:', fg.length, 'B');
      } catch (e) { console.log('FAIL:', e.message); }
    })();
  "`);
  console.log((r.out || r.errOut).trim());

  console.log('\n▶ pm2 reload vido');
  r = await exec(c, `pm2 reload vido --update-env 2>&1 || pm2 restart vido 2>&1`);
  console.log((r.out || r.errOut).trim().split('\n').slice(-5).join('\n'));

  // health 给 PM2 几秒起来
  await new Promise(r => setTimeout(r, 4000));
  r = await exec(c, `curl -s -m 5 -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/api/health`);
  console.log('  /api/health:', r.out.trim());

  c.end();
  console.log('\n✓ 完成');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
