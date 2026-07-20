const assert = require('assert');
const { localReview, internalProcessHits } = require('../src/services/newStoryAd/qualityReviewService');
const { alignShotsToBeats, missingBeatIndexes } = require('../src/services/newStoryAd/storyboardTableService');

const validShots = [
  { index: 1, visual: '开发者打开 AI 模型库，清晰看到不同能力分类', action: '她移动鼠标浏览不同模型卡片并停在目标分类', voiceover: '海量模型，按需选择。' },
  { index: 2, visual: '统一工作台展示模型选择与价格对比', action: '她选择适合当前项目的模型并确认使用', voiceover: '一个入口，灵活调用。' },
  { index: 3, visual: '项目成果在屏幕上完整呈现', action: '她查看最终结果并满意地点头确认', voiceover: '让创作更快落地。' },
];

const validReview = localReview({ expected_storyboard_count: 3, brief: '介绍 AI 模型聚合平台' }, validShots);
assert(!validReview.blocking_issues.some(issue => issue.includes('内部流程')), '正常的模型业务表达不应被误判');
assert.deepStrictEqual(internalProcessHits('模型库、模型选择、灵活调用 AI 模型'), []);
assert(internalProcessHits('后台重试后模型返回失败，Prompt 进入 QA').length >= 3, '应识别真实内部流程描述');

const badReview = localReview({}, [{
  visual: '后台任务正在执行',
  action: '系统在模型返回失败后进行重试',
  voiceover: '请等待 QA 审核。',
}]);
assert(badReview.blocking_issues.some(issue => issue.includes('后台流程')));
assert(badReview.blocking_issues.some(issue => issue.includes('模型内部状态')));

const countReview = localReview({ expected_storyboard_count: 6 }, validShots.concat(validShots.slice(0, 2)));
assert(countReview.blocking_issues.some(issue => issue.includes('需要 6，实际 5')));

const dialogueDriftReview = localReview({}, [{
  visual: '设计师观察材料表面与空间关系。',
  action: '她触摸纹理后确认方案。',
  dialogue_function: 'proof',
  blueprint_spoken_line: '纹理这么细，光线走过也没有生硬的反光。',
  voiceover: '原来可以这样。',
}]);
assert(dialogueDriftReview.blocking_issues.some(issue => /偏离已确认剧本/.test(issue)), '分镜不得把已确认台词再次压薄');

const beats = Array.from({ length: 6 }, (_, index) => ({ beat_index: index + 1 }));
const aligned = alignShotsToBeats([{ index: 1 }, { index: 2 }], beats.slice(4));
assert.deepStrictEqual(aligned.map(shot => shot.index), [5, 6], '分块模型的局部索引应映射回全局 beat 索引');
assert.deepStrictEqual(missingBeatIndexes(beats, [{ index: 1 }, { index: 2 }, { index: 4 }, { index: 6 }]), [3, 5]);

console.log('new story ad storyboard guards: ok');
