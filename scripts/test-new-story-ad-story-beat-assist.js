'use strict';

const assert = require('assert');
const { normalizeAssistedStoryBeat } = require('../src/services/newStoryAd/storyAdService');

function testNormalizesOneBeatWithoutBorrowingOtherState() {
  const current = {
    id: 'beat-stable-id',
    title: '原情节点',
    visual: '人物进入当前任务场景。',
    action: '人物走向商品。',
    spoken_line: '原台词',
    visual_proof: '展示商品真实状态。',
    duration: 4,
  };
  const result = normalizeAssistedStoryBeat({
    story_beat: {
      title: '体验开始',
      visual: '人物在已确认场景中拿起商品并开始体验。',
      action: '人物自然拿起商品。',
      duration: 999,
    },
    unrelated_beat: { title: '不得进入结果' },
  }, current);

  assert.equal(result.title, '体验开始');
  assert.equal(result.spoken_line, '原台词', '模型未返回的用户台词必须保留');
  assert.equal(result.visual_proof, '展示商品真实状态。');
  assert.equal(result.duration, 30, '情节点时长必须限制在编辑器边界内');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'id'), false, 'AI 帮写不得替换稳定 ID');
}

function testFallsBackToCurrentBeatAndMinimumDuration() {
  const result = normalizeAssistedStoryBeat({ story_beat: { duration: -4 } }, {
    title: '保留标题',
    visual: '保留画面',
    duration: 3,
  });
  assert.equal(result.title, '保留标题');
  assert.equal(result.visual, '保留画面');
  assert.equal(result.duration, 1);
}

testNormalizesOneBeatWithoutBorrowingOtherState();
testFallsBackToCurrentBeatAndMinimumDuration();
console.log('new story ad story beat assist tests passed');
