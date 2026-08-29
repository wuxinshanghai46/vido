#!/usr/bin/env node
'use strict';

// v278 的“线稿与分镜”合并合同已经废弃。本文件只保留一项职责：
// 证明旧合同不会重新进入正常执行、模型调用或前端导航。
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const routes = read('src/routes/storyAdWorkspace.js');
const pipeline = read('src/services/pipelineModelService.js');
const app = read('public/story-ad/app.js');
const storyboard = read('public/story-ad/views/storyboardView.js');

assert.match(routes, /LEGACY_STORYBOARD_SKETCH_ROUTE_DISABLED/);
assert.match(routes, /router\.all\('\/projects\/:taskId\/sketches/);
assert.match(routes, /rejectLegacySketchRoute/);
assert.doesNotMatch(pipeline, /['"]new_story_ad\.storyboard_sketch['"]\s*:/);
assert.match(app, /flow:\s*\['5', '剧情流向确认'\]/);
assert.match(app, /storyboard:\s*\['6', '人物场景分镜'\]/);
assert.match(app, /final:\s*\['7', '声音、视频与合成'\]/);
assert.match(routes, /LEGACY_STORY_FLOW_SKETCH_ROUTE_DISABLED/);
assert.doesNotMatch(pipeline, /['"]new_story_ad\.story_flow_sketch['"]\s*:/);
assert.doesNotMatch(storyboard, /\/sketches(?:\/|`|'|")/);
assert.doesNotMatch(storyboard, /生成分镜线稿图/);

console.log(JSON.stringify({
  passed: true,
  legacy_combined_contract: 'disabled',
  legacy_paid_calls: 0,
  current_workflow_steps: 7,
}));
