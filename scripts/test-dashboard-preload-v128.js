#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const dashboard = require('../src/routes/dashboard')._test;

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const ui = read('public/js/dashboard-workbench.js');
const html = read('public/index.html');
const storage = read('src/services/newStoryAd/storageService.js');
const repository = read('src/repositories/contentRecordRepository.js');
const route = read('src/routes/dashboard.js');

assert.equal(dashboard.storyAdVideoCandidate({ status: 'done', stage: 'scene_config_done' }), false,
  '场景配置完成不等于已有成片，首页不得读取成片和关键帧');
assert.equal(dashboard.storyAdVideoCandidate({ status: 'completed', stage: 'keyframe_contract_ready' }), false,
  '关键帧合同完成不等于已有成片');
assert.equal(dashboard.storyAdVideoCandidate({ status: 'completed', stage: 'final_video_done' }), true);
assert.equal(dashboard.storyAdVideoCandidate({ status: 'published', stage: '' }), true);
assert.equal(dashboard.storyAdVideoCandidate({ status: 'running', stage: 'video_generation' }), false);
assert.match(route, /if \(!storyAdVideoCandidate\(record\)\) return;/);

assert.match(storage, /listRowsForUser\('tasks', userId\)/,
  '剧情广告任务必须在数据库读取阶段按用户缩小范围');
assert.match(repository, /user_id = \? OR user_id IS NULL OR user_id = ''/,
  '用户过滤必须保留历史未回填顶层 user_id 的兼容记录');
assert.match(repository, /key\.startsWith\(userListPrefix\)/,
  '任务写入后必须失效按用户缓存');

assert.match(ui, /SUMMARY_CACHE_MAX_AGE_MS/);
assert.match(ui, /sessionStorage\.getItem\(key\)/);
assert.match(ui, /sessionStorage\.setItem\(key/);
assert.match(ui, /vido-dashboard-summary:v\$\{SUMMARY_CACHE_VERSION\}:\$\{owner\}/,
  '首页缓存必须按账号隔离');
assert.match(ui, /if \(cached\) applySummary\(cached\);/,
  '刷新时必须先展示上次成功数据，再后台更新');
assert.match(ui, /if \(loadPromise\) return loadPromise;/,
  '首页初始化和路由切换不得重复请求摘要');
assert.ok(ui.indexOf('if (cached) applySummary(cached);') < ui.indexOf("authFetch('/api/dashboard/summary')"),
  '缓存渲染必须早于网络请求');
assert.match(ui, /if \(!cached\) showLoadError\(\)/,
  '后台刷新失败时不得清空已经展示的缓存');
assert.match(html, /dashboard-workbench\.js\?v=20260821-dashboard-preload-v128/,
  '首页必须使用新的脚本缓存键');

console.log(JSON.stringify({ passed: true, checks: 19, scope: 'dashboard-preload-v128', model_calls: 0, paid_calls: 0 }));
