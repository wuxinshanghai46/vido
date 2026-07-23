#!/usr/bin/env node
const { execFileSync } = require('child_process');
const { Client } = require('ssh2');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const port = Number(process.env.VIDO_DEPLOY_PORT || 22);
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD;
const remoteRoot = process.env.VIDO_DEPLOY_REMOTE || '/opt/vido/app';
const branch = process.env.VIDO_DEPLOY_BRANCH || 'codex/story-ad-v3-upgrade';
const expectedRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: require('path').resolve(__dirname, '..'),
  encoding: 'utf8',
}).trim();
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const backupDir = `/opt/vido/backups/story-ad-v2-${stamp}`;

if (!password) throw new Error('缺少 VIDO_DEPLOY_PASSWORD，已停止部署。');

const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
const client = new Client();

/** 在同一个 SSH 会话内执行命令，并保留退出码和错误输出。 */
function exec(command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let stdout = '';
      let stderr = '';
      stream.on('data', chunk => { stdout += chunk; });
      stream.stderr.on('data', chunk => { stderr += chunk; });
      stream.on('close', code => {
        if (code === 0) return resolve(stdout.trim());
        reject(new Error(stderr.trim() || stdout.trim() || `远程命令退出码 ${code}`));
      });
    });
  });
}

client.on('ready', async () => {
  let previousRevision = '';
  let switchedRevision = false;
  try {
    // 发布前只允许处理干净工作树，避免覆盖生产机器上的临时修复。
    const preflight = await exec([
      `cd ${quote(remoteRoot)}`,
      'test -z "$(git status --porcelain)"',
      'git rev-parse HEAD',
    ].join(' && '));
    previousRevision = preflight.split(/\r?\n/).pop().trim();

    // 先保存旧提交的完整 Git bundle 和提交号，任何后续步骤失败都可原子回滚。
    await exec([
      `mkdir -p ${quote(backupDir)}`,
      `cd ${quote(remoteRoot)}`,
      `git bundle create ${quote(`${backupDir}/before-v2.bundle`)} HEAD`,
      `printf '%s\\n' ${quote(previousRevision)} > ${quote(`${backupDir}/previous-head.txt`)}`,
    ].join(' && '));

    // 精确抓取目标分支并校验提交号，禁止部署到本地未验收的其他远端提交。
    const fetchedRevision = await exec([
      `cd ${quote(remoteRoot)}`,
      `git fetch origin ${quote(`refs/heads/${branch}`)}`,
      'git rev-parse FETCH_HEAD',
    ].join(' && '));
    if (fetchedRevision.trim() !== expectedRevision) {
      throw new Error(`远程分支提交 ${fetchedRevision.trim()} 与本地验收提交 ${expectedRevision} 不一致`);
    }

    await exec(`cd ${quote(remoteRoot)} && git checkout --detach ${quote(expectedRevision)}`);
    switchedRevision = true;

    // 生产环境先完成完整 V2.0/V3 回归和关键入口语法检查，通过后才重载服务。
    const regression = await exec([
      `cd ${quote(remoteRoot)}`,
      'node --check src/server.js',
      'node --check public/js/new-story-ad/bootstrap.js',
      'node --check src/services/newStoryAd/temporalEvidenceGraphService.js',
      'npm run story-ad:v2:test',
    ].join(' && '));

    // PM2 在线不等于端口已经监听；必须等待真实健康接口稳定返回。
    const health = await exec([
      `cd ${quote(remoteRoot)}`,
      'pm2 reload vido --update-env >/dev/null',
      'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do sleep 5; curl -fsS http://127.0.0.1:4600/api/health >/dev/null && break; [ "$i" = 12 ] && exit 1; done',
      'test "$(git rev-parse HEAD)" = ' + quote(expectedRevision),
      'test -z "$(git status --porcelain)"',
      'pm2 jlist | node -e "let d=\\\"\\\";process.stdin.on(\\\"data\\\",c=>d+=c).on(\\\"end\\\",()=>{const p=JSON.parse(d).find(x=>x.name===\\\"vido\\\");if(!p||p.pm2_env.status!==\\\"online\\\")process.exit(1);console.log(\\\"PM2_STATUS=online\\\")})"',
      'echo HEALTH_HTTP=200',
      'git rev-parse HEAD',
      'git rev-parse HEAD^{tree}',
    ].join(' && '));

    const compactRegression = regression.split(/\r?\n/).filter(line => (
      /测试通过|tests passed|: ok|reliability tests passed|NEW_STORY_AD/.test(line)
    ));
    console.log(JSON.stringify({
      success: true,
      previous_revision: previousRevision,
      deployed_revision: expectedRevision,
      backup_dir: backupDir,
      regression: compactRegression,
      health: health.split(/\r?\n/),
    }, null, 2));
    client.end();
  } catch (error) {
    // 只要已经切换代码，任何测试、重载或健康失败都会恢复旧提交并重新加载服务。
    if (switchedRevision && previousRevision) {
      try {
        await exec([
          `cd ${quote(remoteRoot)}`,
          `git checkout --detach ${quote(previousRevision)}`,
          'pm2 reload vido --update-env >/dev/null',
        ].join(' && '));
      } catch (rollbackError) {
        console.error(`生产回滚失败：${rollbackError.message || rollbackError}`);
      }
    }
    console.error(`剧情广告 V2.0 部署失败：${error.message || error}`);
    client.end();
    process.exitCode = 1;
  }
}).on('error', error => {
  console.error(`SSH 连接失败：${error.message || error}`);
  process.exitCode = 1;
}).connect({
  host,
  port,
  username,
  password,
  readyTimeout: 25000,
  keepaliveInterval: 15000,
});
