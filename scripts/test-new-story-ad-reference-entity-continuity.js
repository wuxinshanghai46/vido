const assert = require('assert');
const continuity = require('../src/services/newStoryAd/referenceEntityContinuityService');
const referenceVideo = require('../src/services/newStoryAd/referenceVideoAnalysisService');
const semanticRecovery = require('../src/services/newStoryAd/referenceSemanticRecoveryService');

const sequentialPeople = continuity.buildContinuity([
  {
    frame_id: 'F001', shot_index: 1, timestamp_seconds: 0.5, human_count: 1,
    people: [{ appearance: '短发青年男性，深色夹克', position: '画面左侧', action: '走入空间' }],
    environment: '开放式大厅入口', layout: '玻璃门与前台位于同一大厅', lighting: '自然光',
  },
  {
    frame_id: 'F002', shot_index: 2, timestamp_seconds: 2.5, human_count: 1,
    people: [{ appearance: '长发成年女性，浅色套装', position: '画面中央', action: '拿起展示主体' }],
    environment: '开放式大厅展示区', layout: '前台后方的同一大厅', lighting: '自然光',
  },
]);
assert.equal(sequentialPeople.max_simultaneous_humans, 1);
assert.equal(sequentialPeople.distinct_human_count, 2, '从未同屏的不同人物必须形成两个稳定人物轨迹');

const samePersonDrift = continuity.buildContinuity([
  {
    frame_id: 'F010', shot_index: 3, human_count: 1,
    people: [{ appearance: '短发青年男性，深蓝夹克', position: '左侧', action: '转身' }],
    environment: '工作室', layout: '桌面位于中央', lighting: '侧光',
  },
  {
    frame_id: 'F011', shot_index: 3, human_count: 1,
    people: [{ appearance: '深蓝夹克的短发青年男性', position: '右侧', action: '走向桌面' }],
    environment: '工作室近景', layout: '中央桌面与背景墙保持不变', lighting: '侧光',
  },
]);
assert.equal(samePersonDrift.distinct_human_count, 1, '同一人物换站位和描述语序不能被拆成两人');
assert.equal(samePersonDrift.scene_tracks.length, 1, '同一镜头内的空间描述漂移不能拆成两个场景');

const twoAnimals = continuity.buildContinuity([
  {
    frame_id: 'F020', shot_index: 4, animal_count: 2,
    animals: [
      { species: '犬', appearance: '棕色短毛，红色项圈', position: '左侧', action: '向前跑' },
      { species: '犬', appearance: '白色长毛，蓝色项圈', position: '右侧', action: '坐下' },
    ],
    environment: '草地', layout: '两只犬分列左右', lighting: '日光',
  },
  {
    frame_id: 'F021', shot_index: 4, animal_count: 2,
    animals: [
      { species: '犬', appearance: '棕色短毛并佩戴红项圈', position: '中央', action: '停下' },
      { species: '犬', appearance: '白色长毛并佩戴蓝项圈', position: '右侧', action: '起身' },
    ],
    environment: '草地近景', layout: '两只犬仍在同一片草地', lighting: '日光',
  },
]);
assert.equal(twoAnimals.distinct_animal_count, 2, '两只同种宠物必须保留两个稳定动物轨迹');
assert.ok(twoAnimals.animal_tracks.every(track => track.observations.length === 2), '每只宠物动作必须绑定自己的跨帧轨迹');

assert.ok(!JSON.stringify({ sequentialPeople, samePersonDrift, twoAnimals }).match(/汽车|餐饮|医疗|教育|家具/), '连续性核心不能依赖行业模板');

let checkpoint = semanticRecovery.emptyCheckpoint('performance-fixture');
checkpoint = semanticRecovery.retainBestCandidate(checkpoint, {
  analysis: {
    summary: '有效候选摘要',
    reference_understanding: {
      completeness: { valid: false, failures: ['scene_semantics_incomplete'] },
      story_summary: { full_synopsis: '已完成的长故事'.repeat(1000) },
    },
  },
  model: 'fixture/model',
});
const publicFailure = referenceVideo._private.publicRecord({
  id: 'public-performance-fixture', status: 'failed', progress: 82,
  evidence_frames: [],
  _visual_evidence_cache: {
    batches: [{ raw_text: '私有视觉证据'.repeat(100000) }],
    failed_attempts: {},
  },
  _semantic_checkpoint: checkpoint,
  _synthesis_raw: { text: '私有语义原文'.repeat(100000) },
});
const serializedPublicFailure = JSON.stringify(publicFailure);
assert.equal(publicFailure.progress, 82, '语义失败必须保留真实进度，不能把已完成证据显示成0%');
assert.ok(serializedPublicFailure.length < 12000, '轮询响应不能序列化或下发私有视觉/语义大缓存');
assert.ok(!serializedPublicFailure.includes('私有视觉证据'));
assert.ok(!serializedPublicFailure.includes('私有语义原文'));
assert.equal(publicFailure.semantic_contract_progress.total, 5);
console.log('reference entity continuity tests passed');
