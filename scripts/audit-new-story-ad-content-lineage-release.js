const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { Client } = require('ssh2');

const root = path.resolve(__dirname, '..');
const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD || '';
const port = Number(process.env.VIDO_DEPLOY_PORT || 2222);
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const branch = 'codex/story-ad-v3-upgrade';

if (!password) throw new Error('VIDO_DEPLOY_PASSWORD is required');

function releaseFiles() {
  const source = fs.readFileSync(path.join(__dirname, 'deploy-new-story-ad-subject-scene-recovery.js'), 'utf8');
  const match = source.match(/const files = (\[[\s\S]*?\]);\r?\nconst stamp/);
  if (!match) throw new Error('无法读取生产发布清单');
  const files = vm.runInNewContext(match[1], Object.create(null));
  if (!Array.isArray(files) || !files.length) throw new Error('生产发布清单为空');
  return files.map(String);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function exec(client, command) {
  return new Promise((resolve, reject) => client.exec(command, (error, stream) => {
    if (error) return reject(error);
    let stdout = '';
    let stderr = '';
    stream.on('data', chunk => { stdout += chunk; });
    stream.stderr.on('data', chunk => { stderr += chunk; });
    stream.on('close', code => code === 0
      ? resolve(stdout)
      : reject(new Error(stderr || stdout || `remote audit failed (${code})`)));
  }));
}

function markerJson(output = '', marker = '') {
  const token = `${marker}=`;
  const start = String(output).lastIndexOf(token);
  if (start < 0) {
    const tail = String(output).slice(-1200).replace(/[^\S\r\n]+/g, ' ');
    const error = new Error(`生产审计没有返回 ${marker} 标记；远端输出末尾：${tail || '(empty)'}`);
    error.code = 'PRODUCTION_AUDIT_MARKER_MISSING';
    error.remote_output_tail = tail;
    throw error;
  }
  const line = String(output).slice(start + token.length).split(/\r?\n/, 1)[0];
  return JSON.parse(line);
}

async function publicHealth() {
  const response = await fetch('https://vido.smsend.cn/api/health', {
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: await response.json() };
}

(async () => {
  execFileSync('git', ['fetch', 'origin'], { cwd: root, stdio: 'ignore' });
  const files = releaseFiles();
  const localHashes = Object.fromEntries(files.map(file => [file, sha256(file)]));
  const localHead = git(['rev-parse', 'HEAD']);
  const originHead = git(['rev-parse', `origin/${branch}`]);
  const aheadBehind = git(['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`]);
  const trackedStatus = git(['status', '--short', '--untracked-files=no']);
  const payload = Buffer.from(JSON.stringify({ files, localHashes }), 'utf8').toString('base64');
  const probe = Buffer.from(`
    const crypto = require('crypto');
    const fs = require('fs');
    const { execFileSync } = require('child_process');
    const storage = require('./src/services/newStoryAd/storageService');
    const spec = JSON.parse(Buffer.from('${payload}', 'base64').toString('utf8'));
    const hashes = Object.fromEntries(spec.files.map(file => [
      file,
      crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    ]));
    const run = args => {
      try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }
      catch { return ''; }
    };
    const active = storage.listTasks({ limit: 1000 })
      .filter(task => task.active_generation_id)
      .map(task => ({
        id: task.id,
        stage: task.active_stage || task.stage || '',
        active_generation_id: task.active_generation_id,
      }));
    process.stdout.write('\\nAUDIT=' + JSON.stringify({
      hashes,
      active,
      git_branch: run(['branch', '--show-current']),
      git_head: run(['rev-parse', 'HEAD']),
      git_status_count: run(['status', '--short']).split(/\\r?\\n/).filter(Boolean).length,
    }) + '\\n');
  `, 'utf8').toString('base64');

  const client = new Client();
  await new Promise((resolve, reject) => {
    client.on('ready', resolve).on('error', reject);
    client.connect({ host, port, username, password, readyTimeout: 25000 });
  });
  try {
    const auditOutput = await exec(client, [
      `cd '${remoteRoot}'`,
      `node -e "eval(Buffer.from('${probe}','base64').toString('utf8'))"`,
    ].join(' && '));
    const pm2Output = await exec(client,
      "pm2 jlist | node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d).find(x=>x.name==='vido');process.stdout.write('PM2='+JSON.stringify({status:p?.pm2_env?.status,restarts:p?.pm2_env?.restart_time,uptime_seconds:Math.floor((Date.now()-(p?.pm2_env?.pm_uptime||Date.now()))/1000)})+'\\\\n')})\"");
    const healthOutput = await exec(client,
      "printf 'PRIVATE_HEALTH='; curl -fsS -w '|HTTP:%{http_code}\\n' http://127.0.0.1:4600/api/health");
    const audit = markerJson(auditOutput, 'AUDIT');
    const pm2 = markerJson(pm2Output, 'PM2');
    const mismatches = files.filter(file => audit.hashes[file] !== localHashes[file]);
    const privateHealthMatch = healthOutput.match(/PRIVATE_HEALTH=([\s\S]*?)\|HTTP:(\d+)/);
    const publicResult = await publicHealth();
    const result = {
      status: (
        localHead === originHead
        && aheadBehind === '0\t0'
        && mismatches.length === 0
        && pm2.status === 'online'
        && Number(privateHealthMatch?.[2]) === 200
        && publicResult.status === 200
        && publicResult.body?.database?.status === 'ok'
        && audit.active.length === 0
      ) ? 'PASS' : 'FAIL',
      branch,
      local_head: localHead,
      origin_head: originHead,
      ahead_behind: aheadBehind,
      local_tracked_status: trackedStatus.split(/\r?\n/).filter(Boolean),
      release_files_checked: files.length,
      release_hash_mismatches: mismatches,
      production_git_metadata: {
        branch: audit.git_branch,
        head: audit.git_head,
        status_count: audit.git_status_count,
        note: '生产采用历史 detached HEAD 加文件级发布；以发布清单哈希作为运行代码一致性依据。',
      },
      active_generation_count: audit.active.length,
      pm2,
      private_health_http: Number(privateHealthMatch?.[2] || 0),
      public_health: publicResult,
      model_or_media_calls_triggered: 0,
      task_writes: 0,
    };
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'PASS') process.exitCode = 1;
  } finally {
    client.end();
  }
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
