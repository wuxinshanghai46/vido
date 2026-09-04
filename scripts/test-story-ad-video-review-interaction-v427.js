'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const decision = require('../src/services/newStoryAd/videoQaDecisionService');
const catalog = require('../src/services/newStoryAd/mediaCatalogService');

const voiceover = decision.merge({
  audioQa: { pass: false, problems: ['旁白漏词'] },
  visualQa: { pass: false, problems: ['人物没有完成靠近动作'], failure_dimensions: ['action_fulfillment'], failure_labels_zh: ['动作与镜头意图'] },
  speechMode: 'offscreen_voiceover',
});
assert.equal(voiceover.pass, false);
assert.deepEqual(voiceover.failure_labels_zh, ['旁白声音不合格', '动作与镜头意图']);
assert(!voiceover.failure_labels_zh.some(label => label.includes('口型')), '旁白失败不得显示口型问题');

const dialogue = decision.merge({
  audioQa: { pass: false, problems: ['口型偏移'] },
  visualQa: { pass: true, problems: [], failure_dimensions: [], failure_labels_zh: [] },
  speechMode: 'on_camera_dialogue',
});
assert.deepEqual(dialogue.failure_labels_zh, ['对白声音与口型不合格']);

const items = catalog.rows({ video_clips: [{
  shot_index: 0,
  video_url: '/api/new-story-ad/videos/rejected.mp4',
  qa: { pass: false, failure_labels_zh: ['旁白声音不合格', '动作与镜头意图'] },
}] }, 'clips');
assert.equal(items.length, 1);
assert.equal(items[0].status, 'qa_failed');
assert.equal(items[0].qa_pass, false);
assert.deepEqual(items[0].qa_failure_labels_zh, ['旁白声音不合格', '动作与镜头意图']);

const root = path.join(__dirname, '..');
const finalView = fs.readFileSync(path.join(root, 'public/story-ad/views/finalView.js'), 'utf8');
const clipPresentation = fs.readFileSync(path.join(root, 'public/story-ad/views/clipReviewPresentation.js'), 'utf8');
const theme = fs.readFileSync(path.join(root, 'public/story-ad/dialogue-theme.css'), 'utf8');
const service = fs.readFileSync(path.join(root, 'src/services/newStoryAd/storyAdService.js'), 'utf8');
assert(clipPresentation.includes('controls: isVideo'), '分镜视频必须提供完整播放控件，而非仅静音悬停');
assert(clipPresentation.includes('ready: shotCount > 0 && passed.length >= shotCount'));
assert(finalView.includes('审片通过 ${passedClips.length}/${shots.length}'));
assert(clipPresentation.includes('重新生成未通过镜头'));
assert(!finalView.includes("${clips.length && !finalVideo ? '<button class=\"btn primary\" type=\"button\" data-compose>"), '存在失败片段时不能出现合成按钮');
assert(theme.includes('#storyAdApp .btn{display:inline-flex;min-width:112px;min-height:42px'));
assert(theme.includes('.generation-card.is-video .generation-media video.media'));
assert(theme.includes('object-fit:contain'), '竖版视频必须完整显示，不能 16:9 cover 裁切');
assert(service.indexOf('let visualQa;') > service.indexOf('const audioQa ='), '音频审片后仍必须执行独立视觉审片');
assert(service.includes("qaDeferral.preserve(clips, index, clip, error, 'visual')"), '视觉审片线路不可用时必须保留已付费视频供稍后复审');
assert(service.includes('videoQaDecision.merge'));

console.log(JSON.stringify({ passed: true, checks: 19, paid_model_calls: 0 }));
