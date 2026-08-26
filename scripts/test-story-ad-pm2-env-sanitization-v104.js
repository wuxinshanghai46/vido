#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildPm2Env } = require('./run-with-pm2-env');

const env = buildPm2Env({
  pm2_env: {
    cwd: '/opt/vido/releases/old-top-level',
    pm_cwd: '/opt/vido/releases/old-pm-cwd',
    pm_exec_path: '/opt/vido/releases/old/src/server.js',
    exec_interpreter: '/old/node',
    pm_id: 9,
    name: 'vido',
    namespace: 'default',
    env: {
      cwd: '/opt/vido/releases/old-nested',
      PM_CWD: '/opt/vido/releases/old-case-variant',
      STORY_AD_BUILD_ID: 'old-build',
      name: 'vido',
      namespace: 'default',
      BUSINESS_FLAG: 'kept',
    },
  },
}, {
  CWD: '/opt/vido/releases/old-base',
  API_PROVIDER: 'kept-base',
});

for (const key of ['cwd', 'CWD', 'pm_cwd', 'PM_CWD', 'pm_exec_path', 'exec_interpreter', 'pm_id', 'name', 'namespace']) {
  assert.equal(Object.prototype.hasOwnProperty.call(env, key), false, `PM2 控制字段不得进入业务环境：${key}`);
}
assert.equal(env.API_PROVIDER, 'kept-base');
assert.equal(env.BUSINESS_FLAG, 'kept');
assert.equal(env.STORY_AD_BUILD_ID, 'old-build', '业务环境仍由发布启动参数在最终 start env 中覆盖');

const releaseSource = fs.readFileSync(path.join(__dirname, 'story-ad-pm2-release.js'), 'utf8');
assert(releaseSource.includes("String(item?.pm2_env?.env?.PORT || item?.pm2_env?.PORT || '') === '4601'"), '候选清理必须识别历史错误命名但占用 4601 的 PM2 进程');
assert(releaseSource.includes("pm2(['delete', String(id)])"), '候选清理必须按精确 pm_id 删除，不能误删主生产同名进程');
const deleteCandidate = releaseSource.lastIndexOf("pm2(['delete', candidateName])");
const startProduction = releaseSource.indexOf('start(appName, 4600)');
assert(deleteCandidate >= 0 && deleteCandidate < startProduction, '切换时必须先停止候选进程再启动正式进程，避免共享 SQLite 启动写竞争');
assert(releaseSource.includes("process.env.VIDO_PM2_LOG_DIR || '/data/vido/logs/pm2'"), 'PM2 日志必须默认写入数据盘');
assert(releaseSource.includes("'--output', path.join(logDir, `${safeName}-out.log`)"), 'stdout 必须使用数据盘日志目录');
assert(releaseSource.includes("'--error', path.join(logDir, `${safeName}-error.log`)"), 'stderr 必须使用数据盘日志目录');
assert(releaseSource.includes("fs.mkdirSync(logDir, { recursive: true, mode: 0o750 })"), '启动前必须创建受限权限日志目录');

console.log(JSON.stringify({ passed: true, checks: 15, scope: 'story-ad-pm2-env-sanitization-v104', data_disk_logs: true, model_calls: 0 }));
