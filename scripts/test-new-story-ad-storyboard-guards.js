const assert = require('assert');
const { localReview, internalProcessHits } = require('../src/services/newStoryAd/qualityReviewService');
const { alignShotsToBeats, missingBeatIndexes, normalizeShots } = require('../src/services/newStoryAd/storyboardTableService');

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

const detailedShots = Array.from({ length: 4 }, (_, index) => ({
  index: index + 1,
  title: `动态镜头 ${index + 1}`,
  purpose: `推进第 ${index + 1} 个叙事节点`,
  visual: `当前任务主体位于经过明确描述的场景区域 ${index + 1}，画面写清前后层次、主体比例、任务相关材质与光线关系，并保留相邻镜头需要的空间锚点。`,
  action: `主体从本镜起始姿态完成第 ${index + 1} 个可见动作，镜头按本镜目的运动并停在明确的结束状态。`,
  voiceover: `这是第 ${index + 1} 个经过确认的叙事信息。`,
  dialogue_function: 'progress',
  shot_size: ['wide', 'medium', 'close_up', 'medium_close'][index],
  camera_angle: ['eye_level', 'over_shoulder', 'high_angle', 'low_angle'][index],
  lens_mm: [24, 35, 50, 85][index],
  depth_of_field: ['deep', 'medium', 'shallow', 'ultra_shallow'][index],
  composition: `按第 ${index + 1} 镜叙事目的设计的构图`,
  subject_position: `主体位于第 ${index + 1} 镜所需位置`,
  entry_frame_state: `第 ${index + 1} 镜可见的初始人物与物体状态`,
  exit_frame_state: `第 ${index + 1} 镜可见的结束人物与物体状态`,
  action_start: `第 ${index + 1} 镜动作起点`,
  action_end: `第 ${index + 1} 镜动作终点`,
  camera_movement: ['static', 'push_in', 'tracking', 'pull_out'][index],
  object_states: `第 ${index + 1} 镜道具位置与开关状态保持明确`,
  keyframe_notes: `本镜目的：完成节点 ${index + 1}；必须出现：当前任务主体与场景锚点；禁止出现：未授权人物、产品和场景。`,
}));
const detailedReview = localReview({ expected_storyboard_count: 4 }, detailedShots);
assert.deepStrictEqual(detailedReview.blocking_issues, [], '动态精细分镜应通过本地硬门禁');

const structuredNotesShot = normalizeShots([{
  ...detailedShots[0],
  emotional_turn: '这一段故意写得很长，不能挤掉后面的关键帧合同字段。'.repeat(6),
  selling_point: '卖点说明同样不能覆盖本镜目的、必须出现和禁止出现。'.repeat(6),
  keyframe_notes: {
    purpose: '建立传统材料与设计材料的价值反差',
    must_appear: ['当前任务人物', '经过授权的产品材料', '已确认场景锚点'],
    must_avoid: ['未授权人物', '无关品牌文字', '水印'],
  },
}], { product_subject: '经过授权的产品材料', forbidden: ['水印'] })[0];
assert(!structuredNotesShot.keyframe_notes.includes('[object Object]'), '结构化关键帧合同不得被字符串化为 object Object');
assert.match(structuredNotesShot.keyframe_notes, /^本镜目的：.+；必须出现：.+；禁止出现：.+$/);
assert.deepStrictEqual(localReview({}, [structuredNotesShot]).blocking_issues, [], '结构化关键帧合同归一化后必须通过三段硬门禁');

const legacyPollutedNotesShot = normalizeShots([{
  ...detailedShots[1],
  keyframe_notes: '情绪/转折：人物发现材质差异；宣传卖点：温暖纹理；[object Object]',
}], { product_subject: '铂棕碎钻材料' })[0];
assert(!legacyPollutedNotesShot.keyframe_notes.includes('[object Object]'), '历史字符串污染不得进入关键帧合同');
const normalizedAgain = normalizeShots([legacyPollutedNotesShot], { product_subject: '铂棕碎钻材料' })[0];
assert.strictEqual(normalizedAgain.keyframe_notes, legacyPollutedNotesShot.keyframe_notes, '关键帧合同重复归一化必须保持幂等');

const namedCharacterReview = localReview({ brief: '人物故事与材料对比', characters: [{ name: '苏晚' }] }, [{
  ...detailedShots[2],
  visual_layers: [],
  story_visual: '',
  visual: '同一束光线下并列展示两块材料，苏晚的手部从左侧悬停到右侧点触。',
  action: '苏晚先观察传统材料，再将手指移向新材料并轻轻点触。',
}]);
assert(!namedCharacterReview.rewrite_issues.some(issue => /故事视觉维度偏弱/.test(issue)), '已确认人物姓名及可拍动作必须计入故事视觉证据');

const viewRestrictedZoneScene = {
  scene_id: 'scene_verified',
  scene_revision: 1,
  view_images: ['master', 'reverse', 'interaction', 'detail', 'layout'].map(key => ({ key, url: `https://example.com/${key}.png` })),
  scene_contract: {
    schema_version: 6,
    status: 'verified',
    requirement_qa: { pass: true },
    photographic_realism_qa: { pass: true },
    camera_design_qa: { pass: true },
    cross_view_qa: { pass: true },
    spatial_coverage_qa: { pass: true },
    layout_contract: { status: 'available' },
    zones: [{ id: 'zone_master_only', visible_in_views: ['master'] }],
  },
};
const viewRestrictedZoneReview = localReview({ scene_assets: [viewRestrictedZoneScene] }, [{
  ...detailedShots[0],
  scene_id: 'scene_verified',
  scene_revision: 1,
  scene_view: 'detail',
  camera_id: 'camera_detail',
  scene_zone: '材质细节',
  zone_ids: [],
}]);
assert(!viewRestrictedZoneReview.rewrite_issues.some(issue => /zone_ids/.test(issue)), '当前镜位没有可见区域时不得伪造 zone_ids 或误报缺失');

const garbledReview = localReview({}, [{ ...detailedShots[0], subject_position: '????????????????' }]);
assert(garbledReview.blocking_issues.some(issue => /乱码或连续问号/.test(issue)), '连续问号必须在分镜阶段硬阻断');

const copiedCameraReview = localReview({}, detailedShots.map((shot, index) => ({
  ...shot,
  index: index + 1,
  shot_size: 'medium',
  camera_angle: 'eye_level',
  lens_mm: 50,
  depth_of_field: 'medium',
  composition: '固定模板构图',
  subject_position: '固定模板主体位置',
})));
assert(copiedCameraReview.blocking_issues.some(issue => /固定模板/.test(issue)), '全局精细化不得把同一机位模板复制给多数镜头');

const beats = Array.from({ length: 6 }, (_, index) => ({ beat_index: index + 1 }));
const aligned = alignShotsToBeats([{ index: 1 }, { index: 2 }], beats.slice(4));
assert.deepStrictEqual(aligned.map(shot => shot.index), [5, 6], '分块模型的局部索引应映射回全局 beat 索引');
assert.deepStrictEqual(missingBeatIndexes(beats, [{ index: 1 }, { index: 2 }, { index: 4 }, { index: 6 }]), [3, 5]);

console.log('new story ad storyboard guards: ok');
