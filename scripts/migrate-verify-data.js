#!/usr/bin/env node
/**
 * 对比新旧服务器的 outputs/ 数据完整性
 */
const { Client } = require('ssh2');

const OLD = { host: '119.29.128.12', username: 'root', password: process.env.OLD_SERVER_PASS, readyTimeout: 30000 };
const NEW = { host: '43.98.167.151', username: 'root', password: process.env.NEW_SERVER_PASS, readyTimeout: 30000 };
const ROOT = '/opt/vido/app';
const SYNC = '/root/yunwei/vido-sync'; // 运维同步目录（若存在）

function connect(cfg) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => resolve(c));
    c.on('error', reject);
    c.connect(cfg);
  });
}

function exec(c, cmd) {
  return new Promise(resolve => {
    c.exec(cmd, (err, stream) => {
      if (err) return resolve({ code: -1, out: err.message });
      let out = '';
      stream.on('close', code => resolve({ code, out: out.trim() }));
      stream.on('data', d => out += d.toString());
      stream.stderr.on('data', d => out += d.toString());
    });
  });
}

async function summary(c, label) {
  console.log(`\n===== ${label} =====`);

  // 整个 app 目录
  const app = await exec(c, `du -sh ${ROOT} 2>/dev/null`);
  console.log(`${ROOT}: ${app.out}`);

  // outputs 目录总大小
  const outs = await exec(c, `du -sh ${ROOT}/outputs 2>/dev/null || echo "(无)"`);
  console.log(`outputs/: ${outs.out}`);

  // outputs 下每一级子目录
  const subs = await exec(c, `du -sh ${ROOT}/outputs/* 2>/dev/null | sort -k2`);
  console.log(`outputs/ 子目录:\n${subs.out.split('\n').map(l => '  ' + l).join('\n')}`);

  // 关键 JSON DB
  console.log('\n关键 DB 文件:');
  const dbs = [
    'outputs/vido_db.json',
    'outputs/edit_db.json',
    'outputs/drama_db.json',
    'outputs/avatar_db.json',
    'outputs/comic_db.json',
    'outputs/i2v_db.json',
    'outputs/auth_db.json',
    'outputs/users.json',
    'outputs/settings.json',
    'outputs/knowledge_base.json',
    'outputs/voice_library.json',
    'outputs/apicatalog.json',
    'outputs/api_accounts.json',
  ];
  for (const f of dbs) {
    const r = await exec(c, `ls -lh ${ROOT}/${f} 2>/dev/null | awk '{print $5, $9}' || echo "缺失"`);
    console.log(`  ${f}: ${r.out || '(空)'}`);
  }

  // 文件计数（各介质）
  console.log('\n产物计数:');
  const counts = [
    { label: '视频 .mp4', pat: `${ROOT}/outputs -type f -name "*.mp4"` },
    { label: '音频 .wav/.mp3', pat: `${ROOT}/outputs \\( -name "*.wav" -o -name "*.mp3" \\) -type f` },
    { label: '图片 .png/.jpg', pat: `${ROOT}/outputs \\( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" \\) -type f` },
  ];
  for (const { label, pat } of counts) {
    const r = await exec(c, `find ${pat} 2>/dev/null | wc -l`);
    console.log(`  ${label}: ${r.out} 个`);
  }

  // 运维同步目录
  const sync = await exec(c, `ls ${SYNC} 2>/dev/null | head && echo "---" && du -sh ${SYNC} 2>/dev/null || echo "(无 vido-sync)"`);
  console.log(`\nvido-sync:\n${sync.out}`);

  // public/uploads 若存在
  const up = await exec(c, `ls ${ROOT}/public/uploads 2>/dev/null | wc -l; du -sh ${ROOT}/public/uploads 2>/dev/null`);
  console.log(`\npublic/uploads: ${up.out}`);
}

(async () => {
  const [oldC, newC] = await Promise.all([connect(OLD), connect(NEW)]);

  await summary(oldC, '旧服务器 119.29.128.12');
  await summary(newC, '新服务器 43.98.167.151');

  console.log('\n===== 账号数据对比 =====');
  // 用户数
  for (const [c, label] of [[oldC, '旧'], [newC, '新']]) {
    const users = await exec(c, `node -e "try{const d=require('${ROOT}/outputs/auth_db.json');console.log('auth_db users:', (d.users||[]).length)}catch(e){console.log('auth_db:',e.message)}" 2>&1`);
    const vido = await exec(c, `node -e "try{const d=require('${ROOT}/outputs/vido_db.json');console.log('vido_db projects:', (d.projects||[]).length);console.log('vido_db characters:', (d.characters||[]).length);console.log('vido_db scenes:', (d.scenes||[]).length)}catch(e){console.log('vido_db:',e.message)}" 2>&1`);
    const drama = await exec(c, `node -e "try{const d=require('${ROOT}/outputs/drama_db.json');console.log('drama projects:', (d.projects||[]).length);console.log('drama episodes:', (d.episodes||[]).length)}catch(e){console.log('drama:',e.message)}" 2>&1`);
    console.log(`\n[${label}]`);
    console.log(users.out);
    console.log(vido.out);
    console.log(drama.out);
  }

  console.log('\n===== settings.json 关键字段 =====');
  for (const [c, label] of [[oldC, '旧'], [newC, '新']]) {
    const sz = await exec(c, `stat -c%s ${ROOT}/outputs/settings.json 2>/dev/null || echo 0`);
    const providers = await exec(c, `node -e "try{const d=require('${ROOT}/outputs/settings.json');console.log('providers:', (d.providers||[]).length);console.log('mcps:', (d.mcps||[]).length);console.log('skills:', (d.skills||[]).length)}catch(e){console.log('err:',e.message)}" 2>&1`);
    console.log(`\n[${label}] settings.json ${sz.out} bytes\n${providers.out}`);
  }

  oldC.end();
  newC.end();
})();
