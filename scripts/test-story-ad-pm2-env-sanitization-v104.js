#!/usr/bin/env node
'use strict';

const assert = require('assert');
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

console.log(JSON.stringify({ passed: true, checks: 10, scope: 'story-ad-pm2-env-sanitization-v104', model_calls: 0 }));
