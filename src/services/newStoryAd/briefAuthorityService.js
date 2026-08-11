'use strict';

const GENERIC_SUBJECTS = new Set(['', '当前广告主体', '广告主体', '当前产品', '商品主体', '产品主体', '待明确的展示主体']);

function text(value = '', max = 3000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function explicitSubject(context = {}) {
  const subject = text(context.product_subject || context.productSubject, 200);
  return GENERIC_SUBJECTS.has(subject) ? '' : subject;
}

function hasProductAsset(context = {}) {
  const primary = context.product_asset || context.productAsset;
  if (primary && typeof primary === 'object' && (primary.url || primary.image_url || primary.imageUrl || primary.file_path)) return true;
  return (Array.isArray(context.assets) ? context.assets : []).some((asset) => {
    const type = text(asset?.type || asset?.asset_type || asset?.kind || asset?.role, 100);
    return /产品|商品|包装|货品|product|goods|package|packshot/i.test(type)
      && Boolean(asset?.url || asset?.image_url || asset?.imageUrl || asset?.file_path);
  });
}

function explicitReferenceSubject(context = {}) {
  return text(context.reference_video_analysis?.source_facts?.product_or_service, 200);
}

function briefHasCommercialSubject(brief = '') {
  const value = text(brief, 3000);
  if (!value) return false;
  if (/(?:没有|无|不含|不要)(?:任何)?(?:商品|产品|品牌|服务)|纯剧情|纯故事|故事短片|剧情短片/.test(value)
    && !/(?:商品|产品|品牌|服务)(?:是|为|名为|名称|叫|：|:)|(?:推广|宣传|介绍|展示)(?:这款|该|我们的|一款|一个)?(?:商品|产品|品牌|服务)/.test(value)) return false;
  return /(?:商品|产品|品牌|服务)(?:是|为|名为|名称|叫|：|:)/.test(value)
    || /(?:推广|宣传|介绍|展示|售卖|购买|下单)(?:这款|该|我们的|一款|一个)?(?:商品|产品|品牌|服务|平台|软件|应用|小程序|设备|材料)/i.test(value)
    || /(?:厂家|厂商|企业|公司|商家).{0,50}(?:产品|商品|服务|平台|软件|应用|设备|材料|原材料|门窗|家具|家电|包装)/i.test(value)
    || /(?:产品|商品|服务|平台|软件|应用|设备|材料|原材料|门窗|家具|家电|包装).{0,20}(?:厂家|厂商|企业|公司|商家)/i.test(value)
    || /为.{0,40}(?:产品|商品|服务|平台|软件|应用|设备|材料|原材料|门窗|家具|家电|包装|机器人).{0,20}(?:制作|生成|打造).{0,8}广告/i.test(value)
    || /(?:核心卖点|产品卖点|商品卖点|购买意愿|下单转化|销售转化|产品功能|服务优势|品牌认知)/.test(value);
}

function contentMode(context = {}) {
  const selectedMode = text(context.content_mode || context.contentMode, 60).toLowerCase().replace(/[\s-]+/g, '_');
  const selectedSource = text(context.content_mode_source || context.contentModeSource, 60).toLowerCase().replace(/[\s-]+/g, '_');
  const hasStoredPresentation = Boolean(context.product_presentation || context.productPresentation);
  const userSelected = selectedSource === 'user' || (!selectedSource && !hasStoredPresentation);
  if (userSelected && ['narrative_story', 'story', 'plot'].includes(selectedMode)) return 'narrative_story';
  if (userSelected && ['commercial_subject', 'commercial_ad', 'advertisement', 'ad'].includes(selectedMode)) return 'commercial_subject';
  const explicitMode = text(context.product_presentation?.mode || context.productPresentation?.mode, 60).toLowerCase().replace(/[\s-]+/g, '_');
  if (explicitSubject(context) || hasProductAsset(context) || explicitReferenceSubject(context)) return 'commercial_subject';
  if (explicitMode === 'narrative_story') return 'narrative_story';
  if (explicitMode && explicitMode !== 'auto') return 'commercial_subject';
  return briefHasCommercialSubject(context.brief || context.content) ? 'commercial_subject' : 'narrative_story';
}

function eraCastContract(brief = '') {
  const value = text(brief, 3000);
  const parallel = /交替|交错|交织|双线|对照|平行|两个时空|两条时间线/.test(value);
  const explicitDistinctPeople = /两个(?:独立)?(?:人物|角色|主角)|两位(?:人物|角色|主角)|分别(?:是|为).{1,20}(?:与|和|、).{1,20}|(?:各|分别各)(?:有|为|是)一位(?:人物|角色|主角|女孩|男孩|女性|男性)|不同(?:人物|角色|主角)/.test(value);
  const samePerson = /同一(?:个)?(?:人|人物|角色)|一个人(?:分别|跨越|穿梭)|一人分饰|换装|穿越|前世今生|跨时空的同一个/.test(value);
  if (parallel && explicitDistinctPeople && !samePerson) {
    return {
      count: 2,
      cast_mode: 'dual',
      distinct_roles: true,
      rule: '并行或对照叙事中，用户明确声明的两个独立人物必须分别保留；只有明确写同一人物、换装或一人分饰时才可合并。',
    };
  }
  return null;
}

function explicitSceneRequirements(brief = '') {
  const value = text(brief, 3000);
  const results = [];
  const add = (candidate = '') => {
    const raw = text(candidate, 60);
    const nestedPlace = raw.match(/(?:女孩|女孩子|女生|女子|男孩|男生|男子|人物|主角|她|他)\s*在\s*([^，。；;]{2,24}?)(?:里|中|内)?(?:漫步|行走|散步|奔跑|停留|驻足|相遇|回望|穿行|穿梭)/)?.[1];
    const cleaned = text(nestedPlace || raw, 60)
      .replace(/^(?:一个|一处|一片|位于|设置在|发生在)/, '')
      .replace(/(?:里面|之中|当中|里|中|内)$/, '')
      .trim();
    if (cleaned.length >= 2 && cleaned.length <= 24 && !results.includes(cleaned)) results.push(cleaned);
  };
  const patterns = [
    /(?:场景|地点|空间)(?:是|为|设定为|设置为|：|:)\s*([^，。；;\n]{2,40})/g,
    /(?:一个|一位)?(?:女孩|女孩子|女生|女子|男孩|男生|男子|人物|主角|她|他)\s*在\s*([^，。；;\n]{2,24}?)(?:里|中|内)?(?:漫步|行走|散步|奔跑|停留|驻足|相遇|回望|穿行|穿梭)/g,
    /\b在\s*([^，。；;\n]{2,24}?)(?:里|中|内)?(?:漫步|行走|散步|奔跑|停留|驻足|相遇|回望|穿行|穿梭)/g,
  ];
  patterns.forEach((pattern) => {
    for (const match of value.matchAll(pattern)) add(match[1]);
  });
  return results.slice(0, 8);
}

function planAuthorityIssues(plan = {}, context = {}) {
  const issues = [];
  const expectedPeople = Math.max(0, Number(context.expected_people || 0) || 0);
  const cast = Array.isArray(plan.cast_profiles) ? plan.cast_profiles : [];
  const authorityCastCount = new Set(cast.map(item => text(item?.source_identity_id || item?.id, 120)).filter(Boolean)).size;
  if (expectedPeople > 0 && cast.length !== expectedPeople && authorityCastCount !== expectedPeople) {
    issues.push(`人物数量应为 ${expectedPeople}，模型返回 ${cast.length}`);
  }
  const requiredPlaces = explicitSceneRequirements(context.brief);
  const spaces = Array.isArray(plan.scene_plan?.spaces) ? plan.scene_plan.spaces : [];
  const sceneEvidence = spaces.map(space => [
    space.name, space.description, space.story_purpose,
    space.scene_spec?.layoutText, space.scene_spec?.materialLightText, space.scene_spec?.interactionText,
  ].filter(Boolean).join(' ')).join(' ');
  requiredPlaces.forEach((place) => {
    if (!sceneEvidence.includes(place)) issues.push(`明确场景“${place}”未被保留`);
  });
  return issues;
}

function assertPlanAuthority(plan = {}, context = {}) {
  const issues = planAuthorityIssues(plan, context);
  if (!issues.length) return plan;
  const error = new Error(`人物与场景方案偏离用户原始要求：${issues.join('；')}`);
  error.code = 'ASSET_PLAN_USER_FACT_DRIFT';
  error.status = 422;
  error.retryable = true;
  throw error;
}

module.exports = {
  GENERIC_SUBJECTS,
  briefHasCommercialSubject,
  contentMode,
  eraCastContract,
  explicitSceneRequirements,
  explicitSubject,
  planAuthorityIssues,
  assertPlanAuthority,
};
