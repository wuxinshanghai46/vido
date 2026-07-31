'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const assets = read('public/story-ad/views/assetCenterView.js');
assert.match(assets, /reference-dossier-board/);
assert.match(assets, /参考档案预览/);
assert.match(assets, /查看原始四视图/);

const plot = read('public/story-ad/views/plotRoomView.js');
assert.match(plot, /mode:\s*'story_beat'/);
assert.match(plot, /AI 帮写/);
assert.match(plot, /confirmDialog\('删除后/);
assert.match(plot, /beat-actions/);

const storyboard = read('public/story-ad/views/storyboardView.js');
assert.match(storyboard, /sketch-action-bar/);
assert.match(storyboard, /上传参考线稿/);
assert.match(storyboard, /本镜跳过/);

const shot = read('public/story-ad/views/shotDesignerView.js');
assert.match(shot, /拍摄机位/);
assert.match(shot, /平视/);
assert.match(shot, /浅景深（主体清楚）/);
assert.match(shot, /shot-readable-summary/);
assert.match(shot, /查看技术标识/);
assert.doesNotMatch(shot, /\['scene_id', '场景 ID'\]/);

const finalView = read('public/story-ad/views/finalView.js');
assert.match(finalView, /class="final-video"[^>]*controls/);
assert.match(finalView, /下载原始成片/);
assert.match(finalView, /<details class="card generation-section generation-details">/);
assert.doesNotMatch(finalView, /mediaPreview\(finalVideo/);

const workspaceCss = read('public/story-ad/workspace.css');
assert.match(workspaceCss, /\.final-video\s*\{[^}]*width:\s*auto;[^}]*max-width:\s*100%;[^}]*height:\s*auto;/s);

const uiSource = read('public/story-ad/components/ui.js').replace(/\bexport\s+/g, '');
const sandbox = {};
vm.runInNewContext(`${uiSource}\nglobalThis.__mediaPreview = mediaPreview;`, sandbox, { filename: 'story-ad-ui-contract.js' });
assert.match(sandbox.__mediaPreview({ media_url: '/api/assets/frame' }, { label: '帧' }), /<img/);
assert.match(sandbox.__mediaPreview({ media_url: '/api/media/final', type: 'final' }, { label: '成片' }), /<video/);
assert.match(sandbox.__mediaPreview({ thumbnail_url: '/api/assets/poster', video_url: '/api/media/clip' }, { label: '视频浏览' }), /<img/);

console.log('story-ad workspace v6 UI regression contracts passed');
