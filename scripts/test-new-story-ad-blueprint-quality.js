const assert = require('assert');
const {
  BLUEPRINT_RIGHTS_POLICY_VERSION,
  CAUSAL_STORY_CONTRACT_VERSION,
  assessCausalProgression,
  assessBlueprintQuality,
  assessDialogueNarrative,
  preferQualityCandidate,
  mergePolishedBlueprint,
  assessBlueprintRights,
  normalizeAuthorizedBrandPresentation,
  similarity,
} = require('../src/services/newStoryAd/blueprintQualityService');
const {
  normalizeBlueprint,
  explicitSegmentCount,
  authoredSpeechPlan,
  explicitAuthoredSegments,
  alignBlueprintToAuthoredSegments,
} = require('../src/services/newStoryAd/blueprintService');
const { internallyRecoverable } = require('../src/services/newStoryAd/textStageRecoveryService');
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
const durationAwareProductionDraft = {
  story_title: '三类空间的金属质感',
  logline: '依次展示社区、会所和展厅如何用不同不锈钢纹理形成各自的空间气质。',
  target_duration: 60,
  dialogue_contract: {
    version: 'dialogue-arc-v1',
    target_chars_per_second: { min: 2.4, max: 4.8 },
    speech_policy: 'full_track',
  },
  narrative_contract: {
    version: 'causal-story-v1', arc_type: 'demonstration',
    setup: '建立空间需求', trigger: '比较纹理', progression: '依次验证三类空间', result: '形成定制决定',
    beat_refs: { setup: [1], trigger: [2], progression: [3, 4, 5], result: [6] },
  },
  beats: Array.from({ length: 6 }, (_, index) => ({
    duration: 10,
    role: `空间验证 ${index + 1}`,
    visual: `第 ${index + 1} 个空间呈现清晰可见的墙面纹理和光线变化。`,
    action: `镜头沿墙面移动并在第 ${index + 1} 种材质细节前停下。`,
    spoken_line: [
      '社区大堂的墙面既要沉稳，也要让人一进门就感受到细致层次。',
      '做旧钢板保留自然斑驳，让大面积墙面稳重但不显得沉闷。',
      '横向拉丝把光线柔和拉开，会所空间因此更安静也更精致。',
      '铂棕碎钻把灯光分成细密亮点，让展厅陈列自然成为视觉焦点。',
      '三种纹理对应三种空间气质，颜色和尺寸还能继续按现场调整。',
      '从材料到墙面效果，海和不锈钢为不同项目提供完整定制支持。',
    ][index],
    causal_role: ['setup', 'trigger', 'development', 'evidence', 'transformation', 'brand_closure'][index],
    dialogue_function: ['setup_goal', 'discovery', 'development', 'proof', 'decision', 'brand_closure'][index],
    speech_mode: 'voiceover',
    state_before: [`空间 ${index + 1} 尚未呈现材质效果`],
    state_after: [`空间 ${index + 1} 已呈现对应材质效果`],
    intended_changes: [`验证第 ${index + 1} 种空间气质`],
    visible_evidence: [`第 ${index + 1} 种墙面纹理与灯光关系清晰可见`],
  })),
};
const durationAwareReview = assessBlueprintQuality(durationAwareProductionDraft);
assert.equal(durationAwareReview.pass, true,
  `10 秒镜头必须使用按时长计算的口播容量，不能再被固定 42 字上限误判：${durationAwareReview.issues.join('；')}`);
assert.equal(durationAwareReview.issues.some(issue => /台词过长/.test(issue)), false);
const retainedBetterDraft = preferQualityCandidate(
  { blueprint: { id: 'better' }, review: { pass: false, issues: ['单一局部问题'], score: 0.92 } },
  { blueprint: { id: 'degraded' }, review: { pass: false, issues: ['全稿过短', '句式重复'], score: 0.84 } },
);
assert.equal(retainedBetterDraft.blueprint.id, 'better', '精修候选变差时必须保留上一版最佳初稿，不能连续三轮累积退化');
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
const speakerBindingOriginal = {
  characters: [
    { id: 'character_1', name: '林岚', role: '设计师' },
    { id: 'character_2', name: '陈先生', role: '客户' },
  ],
  beats: [{
    speech_mode: 'dialogue', speaker: '旁白', speaker_id: 'narrator',
    spoken_line: '金属拉丝这个质感不错，就定这个系列吧。',
  }],
};
const speakerBindingRepaired = mergePolishedBlueprint(speakerBindingOriginal, {
  beats: [{ speech_mode: 'dialogue', speaker: '陈先生', speaker_id: 'character_2' }],
});
assert.deepEqual(
  { speaker: speakerBindingRepaired.beats[0].speaker, speaker_id: speakerBindingRepaired.beats[0].speaker_id },
  { speaker: '陈先生', speaker_id: 'character_2' },
  '精修模型纠正的说话人必须通过人物合同校验后成对写回，不能继续保留 narrator 冲突',
);
const invalidSpeakerBinding = mergePolishedBlueprint(speakerBindingOriginal, {
  beats: [{ speech_mode: 'dialogue', speaker: '陌生人', speaker_id: 'unknown_character' }],
});
assert.equal(invalidSpeakerBinding.beats[0].speaker, '旁白', '未在人物合同中的模型说话人不得写入');
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

const confirmedDualIncomplete = {
  story_title: '两人介绍方案',
  logline: '设计师向客户展示不锈钢空间方案。',
  characters: [{ id: 'designer', name: '林岚', role: '设计师', gender: 'female', age_range: '32 岁' }],
  beats: [{
    role: '介绍方案', plot: '林岚站在展厅介绍墙面材料。', action: '她抬手指向墙面纹理。',
    speech_mode: 'dialogue', speaker: '陈先生', spoken_line: '这面墙会是什么效果？',
  }],
};
const confirmedDualReview = assessBlueprintQuality(confirmedDualIncomplete, {
  brief_intake: { cast_intent: { confirmed: true, mode: 'dual', expected_people: 2 } },
  expected_people: 2,
});
assert.equal(confirmedDualReview.pass, false);
['包含 1 位', '光影氛围', '声音设计', '运镜设计', '制作提示', '说话人未绑定'].forEach(message => {
  assert(confirmedDualReview.issues.some(issue => issue.includes(message)), `确认制作合同应拦截：${message}`);
});

const warmLifestyleStory = {
  story_title: '雪球的活力一天',
  logline: '雪球和家人在草坪尽情运动，回家后主动享用狗粮补充能量，满足地回到家人身边。',
  target_duration: 30,
  causal_contract_required: true,
  narrative_contract: {
    version: CAUSAL_STORY_CONTRACT_VERSION,
    arc_type: 'transformation',
    setup: '雪球和家人在户外进行高强度活动。',
    trigger: '活动结束后，一家人回家为雪球准备狗粮。',
    progression: '雪球听到狗粮入碗后主动跑来并持续进食。',
    result: '雪球满足地回到家人身边，产品的适口性和能量补充得到可见证明。',
    beat_refs: { setup: [1], trigger: [2], progression: [3, 4], result: [5, 6] },
  },
  dialogue_contract: {
    version: 'dialogue-arc-v1',
    target_chars_per_second: { min: 2.4, max: 4.8 },
  },
  beats: [
    { role: '快乐出发', causal_role: 'setup', dialogue_function: 'setup_goal', duration: 5, plot: '草坪上，雪球和家人追逐飞盘。', action: '雪球加速奔跑并接住飞盘。', state_before: ['户外活动刚开始'], state_after: ['雪球进入持续运动状态'], intended_changes: ['运动强度提升'], visible_evidence: ['奔跑速度和跳跃动作'], spoken_line: '阳光正好，雪球已经等不及今天的飞盘游戏了。' },
    { role: '尽情奔跑', causal_role: 'trigger', dialogue_function: 'question', duration: 5, plot: '一轮运动结束，雪球开心地跑回家人身边。', action: '雪球吐着舌头摇尾回应。', state_before: ['雪球持续运动'], state_after: ['活动结束并准备回家'], intended_changes: ['从运动转入休息'], visible_evidence: ['自然喘气但精神活跃'], spoken_line: '跑了这么久，它补充能量的时候也快到了。' },
    { role: '回家补充', causal_role: 'development', dialogue_function: 'discovery', duration: 5, plot: '家中用餐角落，林悦拿出狗粮。', action: '她打开包装并走向干净食盆。', state_before: ['食盆为空'], state_after: ['开始准备狗粮'], intended_changes: ['产品进入用餐流程'], visible_evidence: ['包装和食盆同时入镜'], spoken_line: '回到家，先给雪球准备它熟悉的这一餐。' },
    { role: '美味认证', causal_role: 'evidence', dialogue_function: 'proof', duration: 5, plot: '颗粒落入食盆，雪球闻声主动跑来。', action: '雪球靠近食盆并自然进食。', state_before: ['狗粮刚倒入食盆'], state_after: ['雪球持续主动进食'], intended_changes: ['从等待变为进食'], visible_evidence: ['主动靠近、连续进食和摇尾'], spoken_line: '听见熟悉的声音，它的选择已经很直接了。' },
    { role: '温馨陪伴', causal_role: 'resolution', dialogue_function: 'decision', duration: 5, plot: '雪球吃完后回到林悦和小杰身边。', action: '一家人轻抚雪球并相视微笑。', state_before: ['雪球正在进食'], state_after: ['进食完成并回归家庭互动'], intended_changes: ['完成能量补充'], visible_evidence: ['空食盆、满足神态和主动亲近'], spoken_line: '吃得满足，下一次陪伴也会继续充满活力。' },
    { role: '品牌落版', causal_role: 'brand_closure', dialogue_function: 'brand_closure', duration: 5, plot: '产品包装与雪球同框，后期叠加已授权品牌素材。', action: '雪球在包装旁轻轻摇尾。', state_before: ['家庭互动完成'], state_after: ['产品价值与品牌完成收束'], intended_changes: ['进入品牌落版'], visible_evidence: ['产品包装和健康活跃的雪球'], spoken_line: '每一餐的认真，都是给家人长久的爱与活力。' },
  ],
};
assert.equal(assessCausalProgression(warmLifestyleStory).pass, true, '温馨日常广告不应被强制要求戏剧危机');
assert.equal(assessBlueprintQuality(warmLifestyleStory).pass, true, '有状态变化、产品介入和可见结果的温馨广告应通过');

const genericDemonstrationStory = {
  logline: '同一块材料经过不同光线与角度验证，最终呈现清楚可比较的表面结果。',
  causal_contract_required: true,
  narrative_contract: {
    version: CAUSAL_STORY_CONTRACT_VERSION,
    arc_type: 'demonstration',
    setup: '展示材料未经操作时的初始表面。',
    trigger: '改变光线与观察角度。',
    progression: '通过近景和对比画面记录纹理与反射变化。',
    result: '观众看到材料在目标空间中的真实效果。',
    beat_refs: { setup: [1], trigger: [2], progression: [2, 3], result: [4] },
  },
  beats: [
    { role: '初始观察', causal_role: 'setup', plot: '材料在自然光下保持初始状态。', action: '镜头平稳靠近表面。', state_before: ['远景观察'], state_after: ['进入近景观察'], spoken_line: '先从没有修饰的自然光开始观察。' },
    { role: '改变光线', causal_role: 'trigger', plot: '侧光掠过材料表面。', action: '灯光从左向右缓慢移动。', intended_changes: ['光线方向改变'], visible_evidence: ['纹理阴影随光线移动'], spoken_line: '换一个角度，纹理的深浅开始清楚起来。' },
    { role: '细节对比', causal_role: 'evidence', plot: '两个角度并排展示反射差异。', action: '画面在同一尺度下完成对比。', state_before: ['单角度观察'], state_after: ['双角度证据并列'], visible_evidence: ['反射范围和纹理方向'], spoken_line: '不是滤镜，差异来自真实表面和入射方向。' },
    { role: '空间呈现', causal_role: 'resolution', plot: '材料进入目标空间形成完整效果。', action: '镜头拉远展示材料与环境关系。', state_before: ['局部证据完成'], state_after: ['空间效果得到确认'], visible_evidence: ['材料与环境光保持一致'], spoken_line: '细节经得起比较，放进空间也保持同样质感。' },
  ],
};
assert.equal(assessBlueprintQuality(genericDemonstrationStory).pass, true, '无人产品证明型广告也应使用同一通用因果合同');

const keywordOnlyStory = {
  logline: '多个卖点依次出现，但彼此之间没有状态变化。',
  causal_contract_required: true,
  narrative_contract: {
    version: CAUSAL_STORY_CONTRACT_VERSION,
    arc_type: 'demonstration',
    setup: '展示卖点一。',
    trigger: '展示卖点二。',
    progression: '展示卖点三。',
    result: '品牌出现。',
    beat_refs: { setup: [1], trigger: [2], progression: [3], result: [4] },
  },
  beats: [
    { role: '冲突', causal_role: 'setup', plot: '卡片显示卖点一。', action: '第一张卡片出现。', spoken_line: '这是第一个产品卖点。' },
    { role: '转折', causal_role: 'trigger', plot: '卡片显示卖点二。', action: '第二张卡片出现。', spoken_line: '这是第二个产品卖点。' },
    { role: '证明', causal_role: 'evidence', plot: '卡片显示卖点三。', action: '第三张卡片出现。', spoken_line: '这是第三个产品卖点。' },
    { role: '结果', causal_role: 'resolution', plot: '品牌名称出现。', action: '画面停在品牌名称。', spoken_line: '以上就是全部卖点。' },
  ],
};
const keywordOnlyReview = assessCausalProgression(keywordOnlyStory);
assert.equal(keywordOnlyReview.pass, false, '仅写冲突、转折、结果标签不能伪造因果推进');
assert(keywordOnlyReview.issues.some(issue => /状态变化|结果证据/.test(issue)));

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
assert(!thinDialogueReview.issues.some(issue => /台词总信息量不足|至少约|建议约/.test(issue)), '不得用最低字数代替剧情完整性判断');
assert(thinDialogueReview.issues.some(issue => /泛化反应/.test(issue)));
assert(thinDialogueReview.issues.some(issue => /句式重复/.test(issue)));
assert.equal(assessBlueprintQuality(productionThinDialogue).pass, false, '生产中的单薄台词必须被质量门禁拒绝');

const storyDrivenDialogue = {
  ...productionThinDialogue,
  characters: [{ id: 'designer', name: '苏晚', role: '设计师', gender: 'female', age_range: '28~35岁' }],
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

const explicitAuthoredContext = {
  brief: `剧情结构：
[镜头1] 清晨外景，宠物跑向草地。旁白：今天从一次奔跑开始
[镜头2] 宠物追逐飞盘。
[镜头3] 回家后主人准备食物。旁白：回家补充熟悉的一餐
[镜头4] 宠物吃完后回到主人身边。`,
  product_subject: '当前任务产品',
  target_duration: 32,
  cast_mode: 'animal',
};
assert.equal(explicitSegmentCount(explicitAuthoredContext), 4, '[镜头N] 必须被识别为用户显式镜头结构');
assert.deepEqual(authoredSpeechPlan(explicitAuthoredContext), {
  policy: 'authored_sparse',
  authored_line_count: 2,
  segment_count: 4,
});
const sparseBlueprint = normalizeBlueprint({
  logline: '宠物完成户外活动后回家进食，并以满足状态收束。',
  beats: [
    { plot: '宠物跑向草地。', action: '宠物开始奔跑。', spoken_line: '今天从一次奔跑开始', speech_mode: 'voiceover' },
    { plot: '宠物追逐飞盘。', action: '宠物接住飞盘。', spoken_line: '', speech_mode: 'silent' },
    { plot: '主人准备食物。', action: '食物落入食盆。', spoken_line: '回家补充熟悉的一餐', speech_mode: 'voiceover' },
    { plot: '宠物回到主人身边。', action: '宠物满足地摇尾。', spoken_line: '', speech_mode: 'ambient_only' },
  ],
}, explicitAuthoredContext);
assert.equal(sparseBlueprint.beats.length, 4);
assert.equal(sparseBlueprint.dialogue_contract.speech_policy, 'authored_sparse');
assert.equal(sparseBlueprint.beats.filter(beat => beat.spoken_line).length, 2, '稀疏旁白任务不得给静默镜头自动补台词');
assert.equal(assessDialogueNarrative(sparseBlueprint).pass, true);
assert.equal(assessBlueprintQuality(sparseBlueprint).issues.some(issue => /缺少可说出口的台词/.test(issue)), false);

const productionNineShotContext = {
  brief: `分镜脚本：
• [镜头1] 远景 - 林悦、小杰和雪球在草坪上追逐飞盘。
• [镜头2] 中景 - 林悦将飞盘抛向远处。
• [镜头3] 特写/慢动作 - 雪球跳起接住飞盘。
• [镜头4] 中景 - 雪球跑回家人身边。 • 旁白 (VO)：每一次尽情奔跑，都需要满满的能量支持。
• [镜头5] 转场 - 一家人回到家中，林悦拿出狗粮包装袋。
• [镜头6] 特写 - 狗粮颗粒落入食盆。
• [镜头7] 近景 - 雪球跑来进食并摇动尾巴。
• [镜头8] 中景 - 林悦和小杰看着雪球进食。 • 旁白 (VO)：美味与营养，是给它最好的奖赏。
• [镜头9] 结尾画面 - 产品包装与满足的雪球在当前客厅场景中自然收束。`,
  product_subject: '狗粮',
  target_duration: 30,
  cast_mode: 'human_pet',
};
assert.equal(explicitSegmentCount(productionNineShotContext), 9);
assert.equal(explicitAuthoredSegments(productionNineShotContext).length, 9);
assert.deepEqual(authoredSpeechPlan(productionNineShotContext), {
  policy: 'authored_sparse',
  authored_line_count: 2,
  segment_count: 9,
}, '带 (VO) 限定词的旁白必须被识别为稀疏口播');
const sixBeatDraft = {
  logline: '一家人与宠物从户外活动回家进食。',
  beats: Array.from({ length: 6 }, (_, index) => ({
    beat_index: index + 1,
    plot: index < 5 ? `模型初稿第 ${index + 1} 镜` : '',
    action: index < 5 ? `模型动作第 ${index + 1} 镜` : '',
    spoken_line: `模型擅自补写的第 ${index + 1} 镜台词`,
  })),
};
const alignedNineShot = alignBlueprintToAuthoredSegments(productionNineShotContext, sixBeatDraft);
assert.equal(alignedNineShot.beats.length, 9, '六镜残稿必须按用户九镜结构确定性补齐，不能再次依赖模型数量');
assert.match(alignedNineShot.beats[5].plot, /狗粮颗粒落入食盆/);
assert.match(alignedNineShot.beats[8].plot, /当前客厅场景中自然收束/);
assert.equal(alignedNineShot.beats.filter(beat => beat.spoken_line).length, 2, '确定性补齐不得给七个静默镜头发明台词');
const normalizedNineShot = normalizeBlueprint(alignedNineShot, productionNineShotContext);
assert.equal(normalizedNineShot.beats.length, 9);
assert.equal(normalizedNineShot.beats.filter(beat => beat.spoken_line).length, 2);
assert.equal(internallyRecoverable({ code: 'BLUEPRINT_POLISH_QUALITY_FAILED', retryable: false }), false);
assert.equal(internallyRecoverable({ code: 'BLUEPRINT_EXPLICIT_STRUCTURE_INCOMPLETE', retryable: true }), false);
const maximumExplicitContext = {
  brief: `剧情结构：${Array.from({ length: 18 }, (_, index) => `[镜头${index + 1}] ${'动作细节'.repeat(90)} ${index + 1}`).join('\n')}`,
};
assert.equal(explicitAuthoredSegments(maximumExplicitContext).length, 18, '最大 18 镜且长文本时不得被 6000 字符截断');
assert.equal(alignBlueprintToAuthoredSegments(maximumExplicitContext, { beats: [] }).beats.length, 18);

const nearBoundaryDialogue = {
  target_duration: 16,
  dialogue_contract: {
    version: 'dialogue-arc-v1',
    target_chars_per_second: { min: 2.4, max: 4.8 },
  },
  beats: [
    { duration: 8, dialogue_function: 'setup_goal', spoken_line: '这一镜已经包含清楚信息量' },
    { duration: 8, dialogue_function: 'resolution', spoken_line: '第二镜用更完整的结果说明把整条口播信息补足并自然完成最后收束' },
  ],
};
const nearBoundaryReview = assessDialogueNarrative(nearBoundaryDialogue);
assert.equal(nearBoundaryReview.pass, true, '比建议值少一个字不应机械地拒绝整条剧本');
assert.deepEqual(nearBoundaryReview.warnings, [], '不得继续输出最低字数或密度建议');
console.log('PASS new story ad premium blueprint quality');
