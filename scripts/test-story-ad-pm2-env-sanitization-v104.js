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
    env: {
      cwd: '/opt/vido/releases/old-nested',
      PM_CWD: '/opt/vido/releases/old-case-variant',
      STORY_AD_BUILD_ID: 'old-build',
      BUSINESS_FLAG: 'kept',
    },
  },
}, {
  CWD: '/opt/vido/releases/old-base',
  API_PROVIDER: 'kept-base',
});

for (const key of ['cwd', 'CWD', 'pm_cwd', 'PM_CWD', 'pm_exec_path', 'exec_interpreter', 'pm_id']) {
  assert.equal(Object.prototype.hasOwnProperty.call(env, key), false, `PM2 控制字段不得进入业务环境：${key}`);
}
assert.equal(env.API_PROVIDER, 'kept-base');
assert.equal(env.BUSINESS_FLAG, 'kept');
assert.equal(env.STORY_AD_BUILD_ID, 'old-build', '业务环境仍由发布启动参数在最终 start env 中覆盖');

const releaseSource = fs.readFileSync(path.join(__dirname, 'story-ad-pm2-release.js'), 'utf8');
const deleteCandidate = releaseSource.lastIndexOf("pm2(['delete', candidateName])");
const startProduction = releaseSource.indexOf('start(appName, 4600)');
assert(deleteCandidate >= 0 && deleteCandidate < startProduction, '切换时必须先停止候选进程再启动正式进程，避免共享 SQLite 启动写竞争');

console.log(JSON.stringify({ passed: true, checks: 11, scope: 'story-ad-pm2-env-sanitization-v104', model_calls: 0 }));
