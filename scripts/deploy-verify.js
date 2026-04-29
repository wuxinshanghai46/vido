#!/usr/bin/env node
/**
 * 部署后快速校验 — 通过 SSH 检查：
 *  1. PM2 vido 状态
 *  2. 新代码里的关键字符串是否到位（jimeng_realman_avatar_picture_omni_v15）
 *  3. /api/health 本地可达
 *  4. jimeng provider 里是否有 use='avatar' 的模型
 *  5. 最近 20 行 PM2 日志（看有没有启动 error）
 */
const { Client } = require('ssh2');

const HOST = process.env.VIDO_DEPLOY_HOST;
const USER = process.env.VIDO_DEPLOY_USER || 'root';
const PASSWORD = process.env.VIDO_DEPLOY_PASSWORD;
const REMOTE_ROOT = process.env.VIDO_DEPLOY_REMOTE || '/opt/vido/app';

if (!HOST || !PASSWORD) { console.error('need VIDO_DEPLOY_*'); process.exit(1); }

function runExec(c, cmd) {
  return new Promise((resolve) => {
    c.exec(cmd, (err, stream) => {
      if (err) return resolve({ code: -1, out: '', errOut: err.message });
      let out = '', errOut = '';
      stream.on('close', (code) => resolve({ code, out, errOut }));
      stream.on('data', d => out += d.toString());
      stream.stderr.on('data', d => errOut += d.toString());
    });
  });
}

(async () => {
  const c = new Client();
  c.on('ready', async () => {
    const checks = [
      ['pm2 jlist | node -e "let d=\'\';process.stdin.on(\'data\',c=>d+=c).on(\'end\',()=>{const j=JSON.parse(d).find(x=>x.name===\'vido\');console.log(j?\'status=\'+j.pm2_env.status+\' restarts=\'+j.pm2_env.restart_time+\' uptime_ms=\'+(Date.now()-j.pm2_env.pm_uptime):\'NOT FOUND\')})"', 'PM2 vido'],
      [`grep -c 'jimeng_realman_avatar_picture_omni_v15' ${REMOTE_ROOT}/src/services/jimengAvatarService.js`, 'jimeng req_key 行数'],
      [`grep -c '/jimeng-omni/generate' ${REMOTE_ROOT}/src/routes/avatar.js`, 'Omni 路由行数'],
      [`grep -c "jimeng_realman_avatar_picture_omni_v15" ${REMOTE_ROOT}/src/services/settingsService.js`, 'settings 预设行数'],
      [`ls -la ${REMOTE_ROOT}/public/jimeng-omni.html`, '前端页面'],
      [`ls -la ${REMOTE_ROOT}/outputs/jimeng-assets 2>&1 | head -3`, 'assets 目录（应自动创建）'],
      ['curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/jimeng-omni.html', 'HTTP 页面'],
      ['curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/api/avatar/jimeng-omni/tasks -H "accept: application/json"', 'HTTP 任务列表（应 401）'],
      [`node -e "const s=require('${REMOTE_ROOT}/src/services/settingsService');const x=s.loadSettings();const p=(x.providers||[]).find(y=>y.id==='jimeng'||y.preset==='jimeng');if(!p){console.log('NO jimeng provider');process.exit(0)}console.log('api_key format ok='+(p.api_key&&p.api_key.includes(':')));console.log('models count='+ (p.models||[]).length);console.log('avatar models='+((p.models||[]).filter(m=>m.use==='avatar').map(m=>m.id).join(',')||'NONE'))"`, 'Jimeng provider 配置'],
      ['pm2 logs vido --lines 30 --nostream --raw 2>&1 | tail -30', 'PM2 最近 30 行日志'],
    ];
    for (const [cmd, label] of checks) {
      const r = await runExec(c, cmd);
      console.log(`\n─── ${label} ───`);
      console.log((r.out || r.errOut).trim() || '(空)');
    }
    c.end();
  });
  c.on('error', (e) => { console.error(e.message); process.exit(2); });
  c.connect({ host: HOST, port: 22, username: USER, password: PASSWORD, readyTimeout: 20000 });
})();
