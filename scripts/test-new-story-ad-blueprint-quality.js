const assert = require('assert');
const {
  BLUEPRINT_RIGHTS_POLICY_VERSION,
  assessBlueprintQuality,
  assessDialogueNarrative,
  assessBlueprintRights,
  normalizeAuthorizedBrandPresentation,
  similarity,
} = require('../src/services/newStoryAd/blueprintQualityService');
const { normalizeBlueprint } = require('../src/services/newStoryAd/blueprintService');
const { alignShotsToBeats, normalizeShots } = require('../src/services/newStoryAd/storyboardTableService');

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
const firstPartyBrandAppearance = {
  ...premium,
  beats: premium.beats.map((beat, index) => index === 2
    ? { ...beat, plot: `${beat.plot}，佛山海和品牌标志在结尾出现。`, spoken_line: '佛山海和，让不锈钢成为空间设计的一部分。' }
    : beat),
};
assert.equal(assessBlueprintRights(firstPartyBrandAppearance).pass, true, '自有品牌名称和普通品牌露出不能误判为模型生成 Logo');
const normalizedBrandAppearance = normalizeAuthorizedBrandPresentation(firstPartyBrandAppearance);
assert.match(normalizedBrandAppearance.beats[2].plot, /后期叠加的已授权品牌素材/);
assert.doesNotMatch(normalizedBrandAppearance.beats[2].plot, /品牌标志/);
assert.match(normalizedBrandAppearance.beats[2].spoken_line, /佛山海和/, '自有品牌名称必须保留在台词中');
assert.equal(assessBlueprintQuality(normalizedBrandAppearance).pass, true);
const normalizedGeneratedBrandMark = normalizeAuthorizedBrandPresentation(rightsRisk);
assert.match(
  normalizedGeneratedBrandMark.beats[1].plot,
  /后期叠加的已授权品牌素材/,
  '精修结果中的 Logo 生成要求必须在再次调用模型前确定性改写为授权素材后期叠加',
);
assert.doesNotMatch(normalizedGeneratedBrandMark.beats[1].plot, /生成|变形/);
assert.equal(
  assessBlueprintRights(normalizedGeneratedBrandMark).issues.some(issue => /品牌标识/.test(issue)),
  false,
  '确定性版权修正后不能再因同一 Logo 表达耗尽精修重试',
);
assert.equal(assessBlueprintQuality(premium).pass, true);

const productionThinDialogue = {
  story_title: '材质发现',
  logline: '设计师带着空间难题接近材料墙，经过观察与触摸找到方案并作出选择。',
  target_duration: 30,
  dialogue_contract: {
    version: 'dialogue-arc-v1',
    target_chars_per_second: { min: 2.4, max: 4.8 },
  },
  beats: [
    { role: '冲突', dialogue_function: 'obstacle', duration: 5, plot: '设计师面对空旷墙面思考材料难题。', action: '她抱臂停下。', spoken_line: '又要温度，又要独特的质感…' },
    { role: '发现', dialogue_function: 'question', duration: 5, plot: '墙面显出铂棕纹理。', action: '她走近观察。', spoken_line: '嗯？这是…不锈钢？' },
    { role: '证明', dialogue_function: 'proof', duration: 5, plot: '光线掠过蚀刻肌理。', action: '她触摸纹理。', spoken_line: '原来肌理，可以如此细腻。' },
    { role: '转折', dialogue_function: 'value_shift', duration: 5, plot: '不同表面组合成完整墙面。', action: '她后退观察。', spoken_line: '原来…可以这样做。' },
    { role: '结果', dialogue_function: 'decision', duration: 5, plot: '设计方案在脑中成形。', action: '她拍下细节。', spoken_line: '就是它了。' },
    { role: '品牌收束', dialogue_function: 'brand_closure', duration: 5, plot: '材质特写后期叠加授权品牌素材。', action: '画面定格在纹理上。', spoken_line: '海和不锈钢。质感，超乎所想。' },
  ],
};
const thinDialogueReview = assessDialogueNarrative(productionThinDialogue);
assert.equal(thinDialogueReview.pass, false);
assert.equal(thinDialogueReview.metrics.total_characters, 49);
assert.equal(thinDialogueReview.metrics.chars_per_second, 1.63);
assert(thinDialogueReview.issues.some(issue => /台词总信息量不足/.test(issue)));
assert(thinDialogueReview.issues.some(issue => /泛化反应/.test(issue)));
assert(thinDialogueReview.issues.some(issue => /句式重复/.test(issue)));
assert.equal(assessBlueprintQuality(productionThinDialogue).pass, false, '生产中的单薄台词必须被质量门禁拒绝');

const storyDrivenDialogue = {
  ...productionThinDialogue,
  beats: [
    { role: '冲突', dialogue_function: '冲突', plot: '设计师面对空旷墙面思考材料难题。', action: '她翻看方案并停在墙前。', spoken_line: '客户要温度和质感，可普通材料撑不起整面空间。' },
    { role: '发现', dialogue_function: 'question', plot: '墙面显出铂棕纹理。', action: '她走近辨认表面。', spoken_line: '等等，这种细腻的纹理，真的是不锈钢？' },
    { role: '证明', dialogue_function: 'proof', plot: '光线掠过蚀刻肌理。', action: '她用指尖确认表面起伏。', spoken_line: '纹理这么细，光线走过也没有生硬的反光。' },
    { role: '转折', dialogue_function: 'value_shift', plot: '不同表面组合成完整墙面。', action: '她后退比较颜色与质感。', spoken_line: '颜色、拉丝和做旧能组合，设计思路一下就打开了。' },
    { role: '结果', dialogue_function: 'decision', plot: '设计方案在脑中成形。', action: '她拍下细节发给客户。', spoken_line: '细节和空间都对得上，这套材料可以真正落地。' },
    { role: '品牌收束', dialogue_function: 'brand_closure', plot: '材质特写后期叠加授权品牌素材。', action: '画面定格在纹理上。', spoken_line: '就选佛山海和，让不锈钢真正成为设计的一部分。' },
  ],
};
const normalizedStoryDialogue = normalizeBlueprint(storyDrivenDialogue, {
  brief: '用真人慢节奏展示不锈钢纹理如何解决空间设计难题。',
  product_subject: '佛山海和不锈钢',
  target_duration: 30,
  cast_mode: 'single',
  characters: [{ name: '苏晚', role: '设计师' }],
});
assert.equal(normalizedStoryDialogue.dialogue_contract.version, 'dialogue-arc-v1');
assert.equal(normalizedStoryDialogue.target_duration, 30);
assert.equal(normalizedStoryDialogue.beats.reduce((sum, beat) => sum + beat.duration_sec, 0), 30);
assert(normalizedStoryDialogue.beats.every(beat => beat.dialogue_function));
assert.equal(normalizedStoryDialogue.beats[0].dialogue_function, 'obstacle', '中文叙事职责必须归一为稳定枚举');
assert.equal(assessBlueprintQuality(normalizedStoryDialogue).pass, true, '有冲突、证据、价值转折和决定的台词应通过');
const alignedDialogueShots = alignShotsToBeats([
  { index: 1, visual: '设计师面对墙面。', action: '她停下思考。', voiceover: '短句被模型压薄。', speech_mode: 'offscreen_voiceover' },
], [normalizedStoryDialogue.beats[0]]);
assert.equal(alignedDialogueShots[0].voiceover, normalizedStoryDialogue.beats[0].spoken_line, '分镜必须继承已确认剧本台词');
assert.equal(alignedDialogueShots[0].blueprint_spoken_line, normalizedStoryDialogue.beats[0].spoken_line);
assert.equal(alignedDialogueShots[0].dialogue_function, normalizedStoryDialogue.beats[0].dialogue_function);
const normalizedDialogueShots = normalizeShots(alignedDialogueShots, { target_duration: 5, characters: [], scene_assets: [] });
assert.equal(normalizedDialogueShots[0].voiceover, normalizedStoryDialogue.beats[0].spoken_line, '分镜标准化不得再次缩短剧本台词');
assert.equal(normalizedDialogueShots[0].dialogue_lines[0].line, normalizedStoryDialogue.beats[0].spoken_line, '对白轨也必须与已确认剧本一致');
console.log('PASS new story ad premium blueprint quality');
