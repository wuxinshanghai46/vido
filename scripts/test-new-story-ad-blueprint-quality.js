const assert = require('assert');
const {
  BLUEPRINT_RIGHTS_POLICY_VERSION,
  assessBlueprintQuality,
  assessBlueprintRights,
  similarity,
} = require('../src/services/newStoryAd/blueprintQualityService');

const weak = {
  logline: 'A developer discovers a platform.',
  beats: [
    { role: '卖点', plot: '开发者操作平台，展示安全稳定。', action: '开发者操作平台，展示安全稳定。', spoken_line: '通过一个统一的平台，访问宇宙般的 AI 模型。' },
    { role: '卖点', plot: '界面显示价格。', action: '', spoken_line: '享受行业领先的价格，最大化您的预算。' },
    { role: '品牌', plot: '品牌出现。', action: '', spoken_line: '为您的创作赋能，更快、更智能。' },
  ],
};

const premium = {
  logline: '交付前夜，开发者在多个模型接口之间反复切换；一次连接中断后，她改用统一平台，终于在截止时间前稳定完成演示。',
  beats: [
    { role: '冲突', plot: '深夜工位上，三个接口窗口同时报警，倒计时只剩十分钟。', action: '林思源连续重试连接，最后一个窗口再次变红。', spoken_line: '又断了……还剩十分钟。' },
    { role: '转折', plot: '统一平台面板打开，安全校验完成，连接状态由红转绿。', action: '她粘贴一次 Token，依次点亮需要的模型。', spoken_line: '一次接入，先把链路稳住。' },
    { role: '结果', plot: '演示页面顺利跑完，发送按钮旁的倒计时停在两分钟。', action: '她确认成本明细后点击发送，靠回椅背松了口气。', spoken_line: '交付了，费用也在预算里。' },
  ],
};

assert(similarity(weak.beats[0].plot, weak.beats[0].action) > 0.9);
assert.equal(assessBlueprintQuality(weak).pass, false);
assert(assessBlueprintQuality(weak).issues.some(issue => /套话|翻译腔/.test(issue)));
assert(assessBlueprintQuality(weak).issues.some(issue => /画面与动作重复/.test(issue)));
const directionOnly = { logline: '开发者完成任务。', beats: [
  { role: '冲突', plot: '连接中断。', action: '她尝试重连。', spoken_line: '又断了。' },
  { role: '转折', plot: '连接恢复。', action: '她重新接入。', spoken_line: '（看到结果后，露出微笑）' },
  { role: '结果', plot: '任务完成。', action: '她点击发送。', spoken_line: '赶上了。' },
] };
assert(assessBlueprintQuality(directionOnly).issues.some(issue => /只有表演提示/.test(issue)));
const unverifiedLogo = { logline: '项目遇到问题后得到解决。', beats: [
  { role: '冲突', plot: '连接中断。', action: '她尝试重连。', spoken_line: '又断了。' },
  { role: '转折', plot: '无数AI模型Logo在空中汇聚。', action: '她选择模型。', spoken_line: '这个合适。' },
  { role: '结果', plot: '任务完成。', action: '她点击发送。', spoken_line: '赶上了。' },
] };
assert(assessBlueprintQuality(unverifiedLogo).issues.some(issue => /第三方模型 Logo/.test(issue)));
const rightsRisk = {
  logline: '主角用一比一复刻知名动画角色的方式解决问题。',
  beats: [
    { role: '冲突', plot: '原样还原电影海报画面。', action: '明星换脸成为经典游戏角色。', spoken_line: '照着某导演的风格拍。' },
    { role: '转折', plot: '品牌 Logo 从粒子中生成。', action: 'Logo 变形成角色。', spoken_line: '想办法绕过审核。' },
    { role: '结果', plot: '复刻画面完成。', action: '主角展示结果。', spoken_line: '这样就好了。' },
  ],
};
const rightsAssessment = assessBlueprintRights(rightsRisk);
assert.equal(rightsAssessment.pass, false);
assert.equal(rightsAssessment.policy_version, BLUEPRINT_RIGHTS_POLICY_VERSION);
assert(rightsAssessment.issues.some(issue => /复刻/.test(issue)));
assert(rightsAssessment.issues.some(issue => /公众人物|换脸/.test(issue)));
assert(rightsAssessment.issues.some(issue => /审核/.test(issue)));
assert(rightsAssessment.issues.some(issue => /品牌标识/.test(issue)));
const authorizedOverlay = {
  ...premium,
  beats: premium.beats.map((beat, index) => index === 2
    ? { ...beat, plot: `${beat.plot}，结尾后期叠加已授权品牌 Logo 素材。` }
    : beat),
};
assert.equal(assessBlueprintRights(authorizedOverlay).pass, true, '已授权品牌素材必须允许后期叠加，不能要求模型生成 Logo');
assert.equal(assessBlueprintQuality(premium).pass, true);
console.log('PASS new story ad premium blueprint quality');
