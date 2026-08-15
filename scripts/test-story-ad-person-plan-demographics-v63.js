const assert = require('assert');

const assetPlan = require('../src/services/newStoryAd/assetPlanService');

function sourceWith(profile) {
  return {
    cast_profiles: [profile],
    pet_profiles: [],
    prop_plan: [],
    scene_plan: {
      advertised_subject: '',
      cast_mode: 'single',
      scene_mode: 'single',
      spaces: [{
        id: 'story_room',
        name: '故事空间',
        description: '人物完成主要剧情动作的室内空间',
        story_purpose: '承载人物行动与关系变化',
        scene_spec: {
          layoutText: '房门、窗户和家具位置固定',
          materialLightText: '自然材质与柔和室内光',
          interactionText: '人物在固定动线中完成动作',
          negativeText: '禁止水印和无关人物',
          storyStates: [],
          interactionAnchors: [],
          routes: [],
          propPlacements: [],
        },
      }],
      asset_strategy: [],
      story_strategy: ['先建立人物关系，再推进剧情冲突'],
      forbidden: ['禁止复制任何真人身份'],
      suggested_shot_count: 5,
    },
    story_seed: {
      logline: '人物在故事空间中完成一次关键抉择',
      opening: '人物进入空间',
      development: '人物关系发生变化',
      turning_point: '人物作出决定',
      resolution: '人物承担决定的结果',
    },
  };
}

function context(overrides = {}) {
  return {
    content_mode: 'narrative_story',
    brief: '原创剧情短片',
    cast_mode: 'single',
    expected_people: 1,
    cast_profiles: [],
    ...overrides,
  };
}

function profile(overrides = {}) {
  return {
    id: 'person_1',
    name: '林清',
    role: '故事主角',
    appearanceText: '原创人物，沉静坚定，五官与体态均为虚构设计',
    wardrobeText: '原创日常服装',
    hairMakeupText: '原创自然发型与妆容',
    negativeText: '禁止复制任何真人身份',
    ...overrides,
  };
}

// 可从明确上下文确定时，年龄和原创外貌来源必须在方案标准化阶段形成，
// 不能把空字段留给资产中心末端才报错。
const explicitContext = context({
  brief: '30岁中国女性林清在雨夜作出关键抉择，角色必须为原创虚构人物',
  world_setting: { country_region: '中国', country_region_confirmed: true },
});
const contextual = assetPlan.normalizePlan(sourceWith(profile()), explicitContext);
const contextualPerson = contextual.cast_profiles[0];
assert.match(
  String(contextualPerson.age || contextualPerson.age_range || ''),
  /\d{1,3}\s*(?:岁|~|～|-|—|–|至|到)/u,
  '明确写有30岁的剧情上下文必须在人物方案阶段形成结构化年龄',
);
assert(
  String(contextualPerson.ethnicity || contextualPerson.ethnic_appearance || '').trim(),
  '已确认地区且要求原创人物时，方案阶段必须形成可审阅的原创族裔外貌设定',
);
assert(
  String(contextualPerson.age_source || '').trim(),
  '自动补齐年龄必须保留来源，避免后续把推断伪装成用户输入',
);
assert(
  String(contextualPerson.ethnicity_source || '').trim(),
  '自动补齐原创族裔外貌必须保留来源',
);

// 未知地区不得臆造真实族裔，但仍应形成明确、可修改的原创默认值。
const unknownRegion = assetPlan.normalizePlan(sourceWith(profile({
  age: '28~35岁',
  age_source: 'model_story_inference',
})), context({ brief: '林清是一名成年女性，角色必须为原创虚构人物' }));
assert.strictEqual(
  unknownRegion.cast_profiles[0].ethnicity,
  '未指定（原创角色，可修改）',
  '上下文未确认地区时只能使用可修改的原创默认值，不得猜测真实族裔',
);
assert(
  String(unknownRegion.cast_profiles[0].ethnicity_source || '').trim(),
  '原创默认值也必须记录来源',
);

// 模型或用户已经给出的结构化值属于权威输入，不得被自动补齐覆盖。
const preserved = assetPlan.normalizePlan(sourceWith(profile({
  age: '42岁',
  age_source: 'user',
  ethnicity: '原创东亚外貌设计',
  ethnicity_source: 'user',
})), context());
assert.strictEqual(preserved.cast_profiles[0].age, '42岁');
assert.strictEqual(preserved.cast_profiles[0].ethnicity, '原创东亚外貌设计');
assert.strictEqual(preserved.cast_profiles[0].age_source, 'user');
assert.strictEqual(preserved.cast_profiles[0].ethnicity_source, 'user');

const child = assetPlan.normalizePlan(sourceWith(profile({
  role: '儿童主角', appearanceText: '原创小学生角色',
})), context({ brief: '儿童主角在放学后作出选择' }));
assert.strictEqual(child.cast_profiles[0].age, '6~12岁', '儿童主角不得被“主角”二字误补为25~35岁');

const young = assetPlan.normalizePlan(sourceWith(profile({
  role: '年轻恋人', appearanceText: '原创青年人物',
})), context({ brief: '年轻恋人在竹海重逢' }));
assert.strictEqual(young.cast_profiles[0].age, '20~30岁', '明确青年阶段必须高于通用成人角色规则');

// 生产“星月神话”四人等价输入：多人物不能扫描整段 brief 猜年龄，
// 但每张人物卡自身已经包含侠客、恋人、少女或现代转世重逢等明确阶段/成人语义。
const starMoonSource = sourceWith(profile());
starMoonSource.cast_profiles = [
  profile({ id: 'shen_yanci_ancient', name: '沈砚辞（古代）', role: '男主；古代侠客；云知月的恋人；千年守望者', appearanceText: '古代侠客造型' }),
  profile({ id: 'shen_yanci_modern', name: '沈砚辞（现代）', role: '男主；现代身份；云知月的恋人；千年守望者', appearanceText: '现代守望者造型' }),
  profile({ id: 'yun_zhiyue_ancient_identity', name: '云知月', role: '古代女主；沈砚辞的恋人；为爱赴死者', appearanceText: '古代少女造型' }),
  profile({ id: 'yun_zhiyue_reincarnation', name: '云知月的转世', role: '现代转世之人；竹海重逢中的白月光般女子', appearanceText: '现代原创人物造型' }),
];
const starMoon = assetPlan.normalizePlan(starMoonSource, context({
  expected_people: 4,
  cast_mode: 'ensemble',
  brief: '跨越古今的原创爱情故事',
}));
assert.deepStrictEqual(
  starMoon.cast_profiles.map(item => item.age),
  ['25~35岁', '25~35岁', '13~17岁', '25~35岁'],
  '星月四个人物必须仅依据各自人物卡证据形成可审阅年龄，且少女阶段优先于成人角色词',
);
assert(starMoon.cast_profiles.every(item => item.ethnicity === '未指定（原创角色，可修改）'));

// 生产等价：多人物方案不会把整份 brief 作为某一个人的年龄证据，
// 每张人物档案自身的角色/外貌语义都必须形成可审阅年龄。
const starProfiles = [
  profile({ id: 'shen_yanci_ancient', name: '沈砚辞（古代）', role: '男主；古代侠客；云知月的恋人；千年守望者' }),
  profile({ id: 'shen_yanci_modern', name: '沈砚辞（现代）', role: '男主；古代侠客；云知月的恋人；千年守望者' }),
  profile({ id: 'yun_zhiyue_ancient_identity', name: '云知月', role: '古代女主；沈砚辞的恋人；为保护沈砚辞而死的少女' }),
  profile({
    id: 'yun_zhiyue_reincarnation',
    name: '云知月的转世',
    role: '现代转世之人；竹海重逢中的白月光般女子',
    appearanceText: '眉眼清秀，气质干净安静，有白月光般的疏淡与温柔',
  }),
];
const starDemographics = starProfiles.map(item => assetPlan.normalizeProfileDemographics(
  item, item, context({ brief: '古代恋人跨越千年，在现代竹海与女主的转世重逢' }), starProfiles.length,
));
starDemographics.forEach((item, index) => {
  assert.match(
    String(item.age || item.age_range || ''),
    /\d{1,3}\s*(?:岁|~|～|-|—|–|至|到)/u,
    `生产等价星月人物${index + 1}必须在方案阶段形成可用年龄`,
  );
  assert.equal(item.ethnicity, '未指定（原创角色，可修改）', `生产等价星月人物${index + 1}必须形成原创外貌默认值`);
});

// 真正没有年龄事实、成年语义或可用人物描述时必须继续阻断，不能靠删除门禁变绿。
const trulyMissing = sourceWith(profile({
  role: '',
  appearanceText: '',
  age: '',
  ethnicity: '',
}));
const missingSections = assetPlan.missingAssetPlanSections(trulyMissing, context({ brief: '原创剧情短片' }));
assert(
  missingSections.includes('cast_profiles'),
  `人物核心事实确实缺失时必须阻断 cast_profiles，实际缺失项：${missingSections.join(', ')}`,
);

console.log('story-ad person plan demographics v63 passed');
