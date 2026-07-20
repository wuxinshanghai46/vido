const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const { ensureChineseOutput, mergeVisibleStrings } = require('./outputLanguageService');

const CLICHE_PATTERNS = [
  /宇宙般|行业领先|最大化.{0,8}预算|为.{0,10}赋能|更快[、，,].{0,8}更智能|一站式解决|开启.{0,8}新篇章|尽享|极致体验|万千可能/,
  /通过一个统一的平台|海量.{0,8}任你选|轻松实现|轻松化解|高效便捷|安全稳定可靠|量身设计|直观友好|完美解决方案|完美呈现|秘密武器|前所未有|惊艳的现实|发现新大陆|星辰般/,
];
const BLUEPRINT_RIGHTS_POLICY_VERSION = 'original-rights-v1';
const RIGHTS_RISK_PATTERNS = [
  { pattern: /(?:一比一|1\s*[:：]\s*1).{0,12}(?:复刻|还原|照搬)|(?:复刻|照搬|原样还原).{0,20}(?:电影|影视|动漫|动画|游戏|广告|海报|专辑|角色|画面)/i, issue: '包含对受保护作品或角色的复刻要求' },
  { pattern: /(?:模仿|仿照|照着|in the style of).{0,25}(?:导演|艺术家|摄影师|画师|作者|电影|影视|动画|动漫|游戏|广告|画风|风格)/i, issue: '包含指定创作者或受保护作品风格的模仿要求' },
  { pattern: /(?:明星|名人|公众人物|艺人|网红|偶像).{0,20}(?:脸|面容|肖像|形象|换脸|同款|声音)|(?:换脸|人脸替换).{0,20}(?:明星|名人|公众人物|艺人|网红|偶像)/i, issue: '包含未经确认授权的公众人物肖像或换脸要求' },
  { pattern: /(?:知名|经典|影视|动漫|动画|游戏|第三方).{0,16}(?:IP|角色|人物).{0,20}(?:出镜|登场|同款|复刻|还原|扮演)/i, issue: '包含未经确认授权的第三方 IP 或角色' },
  { pattern: /(?:绕过|规避|避开|骗过).{0,12}(?:审核|审查|版权|风控|安全策略)|(?:过审方法|审核绕过)/i, issue: '包含规避供应商审核或安全策略的要求' },
];

function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function chineseBigrams(value = '') {
  const chars = clean(value).replace(/[^\u3400-\u9fffA-Za-z0-9]/g, '');
  const out = new Set();
  for (let i = 0; i < chars.length - 1; i += 1) out.add(chars.slice(i, i + 2));
  return out;
}

function similarity(a, b) {
  const left = chineseBigrams(a);
  const right = chineseBigrams(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  left.forEach(item => { if (right.has(item)) common += 1; });
  return common / Math.max(1, Math.min(left.size, right.size));
}

function blueprintVisibleText(blueprint = {}) {
  const beats = Array.isArray(blueprint.beats) ? blueprint.beats : [];
  return [
    blueprint.story_title, blueprint.logline,
    ...beats.flatMap(beat => [
      beat.role, beat.plot, beat.visual, beat.story_visual, beat.promo_visual,
      beat.action, beat.spoken_line, beat.voiceover, beat.visual_proof,
    ]),
  ].map(clean).filter(Boolean).join(' ');
}

function assessBlueprintRights(blueprint = {}) {
  const text = blueprintVisibleText(blueprint);
  const issues = RIGHTS_RISK_PATTERNS.filter(item => item.pattern.test(text)).map(item => item.issue);
  const generatedLogo = /(?:logo|标志|商标).{0,18}(?:生成|形成|汇聚|变形|浮现|出现)|(?:生成|形成|汇聚|变形|浮现).{0,18}(?:logo|标志|商标)/i.test(text);
  const authorizedOverlay = /(?:授权|用户上传|品牌素材|后期叠加|后期合成|后期落版).{0,20}(?:logo|标志|商标)|(?:logo|标志|商标).{0,20}(?:授权|用户上传|品牌素材|后期叠加|后期合成|后期落版)/i.test(text);
  if (generatedLogo && !authorizedOverlay) issues.push('要求生成或变形品牌标识，应改为后期叠加已授权品牌素材');
  return {
    pass: issues.length === 0,
    issues: Array.from(new Set(issues)),
    policy_version: BLUEPRINT_RIGHTS_POLICY_VERSION,
  };
}

function assessBlueprintQuality(blueprint = {}) {
  const beats = Array.isArray(blueprint.beats) ? blueprint.beats : [];
  const issues = [];
  if (!clean(blueprint.logline)) issues.push('缺少清晰的故事主线');
  if (CLICHE_PATTERNS.some(pattern => pattern.test(`${clean(blueprint.story_title)} ${clean(blueprint.logline)}`))) issues.push('标题或故事主线存在广告套话');
  if (beats.length < 3) issues.push('剧情推进层次不足');
  beats.forEach((beat, index) => {
    const n = index + 1;
    const visual = clean(beat.visual || beat.story_visual || beat.promo_visual || beat.plot);
    const action = clean(beat.action || beat.character_action || beat.behavior);
    const spoken = clean(beat.spoken_line || beat.voiceover || beat.copy);
    if (!visual) issues.push(`第 ${n} 镜缺少具体可拍画面`);
    if (!action) issues.push(`第 ${n} 镜缺少独立动作设计`);
    if (visual && action && similarity(visual, action) >= 0.72) issues.push(`第 ${n} 镜画面与动作重复`);
    if (!spoken) issues.push(`第 ${n} 镜缺少可说出口的台词`);
    const spokenWithoutDirections = spoken.replace(/^[（(][^）)]*[）)]\s*/g, '').replace(/^[…。.，,、\s]+|[…。.，,、\s]+$/g, '');
    if (spoken && !spokenWithoutDirections) issues.push(`第 ${n} 镜台词只有表演提示，没有实际对白`);
    if (/^[（(].*[）)]/.test(spoken)) issues.push(`第 ${n} 镜台词混入表演提示`);
    if (spoken.length > 42) issues.push(`第 ${n} 镜台词过长`);
    if (CLICHE_PATTERNS.some(pattern => pattern.test(`${spoken} ${visual}`))) issues.push(`第 ${n} 镜存在广告套话或翻译腔`);
    if (/(?:无数|知名|各种|不同).{0,12}(?:AI)?模型\s*[Ll]ogo/.test(visual)) issues.push(`第 ${n} 镜包含未经确认的第三方模型 Logo`);
  });
  const spokenText = beats.map(beat => clean(beat.spoken_line || beat.voiceover || '')).join(' ');
  if (CLICHE_PATTERNS.some(pattern => pattern.test(spokenText))) issues.push('整体文案存在广告套话');
  const roles = beats.map(beat => clean(beat.role || beat.purpose)).join(' ');
  if (beats.length >= 4 && !/(冲突|受阻|失败|危机|压力|问题|转折|反转|结果|解决|收束)/.test(roles)) issues.push('缺少冲突、转折与结果的因果推进');
  const rights = assessBlueprintRights(blueprint);
  issues.push(...rights.issues);
  return {
    pass: issues.length === 0,
    issues: Array.from(new Set(issues)),
    score: Math.max(0, Math.round((1 - Math.min(0.8, issues.length * 0.08)) * 100) / 100),
    rights,
  };
}

function preserveCharacterNames(original = {}, candidate = {}) {
  const result = candidate;
  if (Array.isArray(original.characters) && Array.isArray(result.characters)) {
    result.characters = result.characters.map((character, index) => ({
      ...character,
      name: original.characters[index]?.name || character.name,
    }));
  }
  return result;
}

async function polishBlueprint(ctx, blueprint, { taskId = '', force = false, attempt = 1, maxAttempts = 3, onProgress = null } = {}) {
  const before = assessBlueprintQuality(blueprint);
  if (!force && before.pass) return { blueprint, polished: false, before, after: before, model_meta: null };
  if (typeof onProgress === 'function') {
    try {
      onProgress({
        stage: 'blueprint', phase: 'quality_polish', completed: 4, total: 6,
        message: `正在进行第 ${attempt}/${maxAttempts} 轮剧情质量与版权/IP 风险修正。`,
      });
    } catch {}
  }
  const result = await modelGateway.generateText({
    taskId,
    stage: 'new_story_ad.blueprint_polish',
    systemPrompt: [
      '你是资深广告导演与中文剧情文案总监。只返回严格 JSON 对象。',
      '把现有蓝图精修成一条真正可拍、有人物动机、有冲突、有转折、有结果的精品短剧情广告，而不是功能清单、产品说明书或卖点口播合集。',
      '所有行业通用：只依据当前任务内容创作，不套用固定行业、固定场景、固定人物或固定故事模板。',
      '每个卖点必须由人物选择、可见动作、界面/产品反馈或结果变化证明；不要让人物直接念卖点。',
      '台词必须像真人会说的话，简短、自然、有上下文；避免“宇宙般、行业领先、为您赋能、最大化预算、更快更智能、一站式”等广告套话。',
      'spoken_line 只能写最终会被说出来的话，禁止加入括号、语气说明、表演提示、说话人标签或纯表情描述。',
      '除非用户明确提供，画面中不得出现真实第三方模型 Logo、品牌标识、虚构价格数字或未经证实的行业对比；可以使用通用模型卡片和抽象指标。',
      '所有人物、场景、剧情和视觉表达必须原创。不得复刻影视、动漫、游戏、广告、海报或专辑画面，不得模仿指定导演、艺术家、摄影师或在世创作者风格。',
      '不得使用明星、名人、公众人物或第三方角色的肖像、声音、换脸或同款形象；人物应为当前任务原创角色，后续真人演员只能来自平台已授权素材。',
      '用户明确提供的自有品牌和产品事实可以保留在文字中，但 Logo、商标和品牌字样只能标记为“后期叠加已授权品牌素材”，不得要求图片模型生成、变形或猜测。',
      '不得编写任何绕过版权、内容审核、人脸审核或供应商安全策略的指令。',
      '画面字段写镜头中看见的构图、主体和状态；动作字段只写人物或主体发生的动作与变化，二者不得复制。',
      '保持原故事事实、广告主体、人物身份与姓名、镜头数量和顺序，不得增加未经用户提供的功能、数据、品牌背书或价格承诺。',
      '结尾行动号召应自然承接剧情结果，品牌露出简洁，不喊空洞口号。',
      '发现的问题必须逐条消除；不要因为原文已有某个表达就保留翻译腔、第三方 Logo、夸张隐喻或空洞口号，可以在不改变事实的前提下彻底重写这些句子。',
      'role 和剧情推进必须清楚体现冲突、转折与结果的因果关系；可以使用更自然的具体名称，但不能把整条片子重新写成并列卖点。',
      '所有用户可见内容使用自然简体中文；JSON 键、技术枚举、数字和 ID 不变。',
    ].join('\n'),
    userPrompt: `任务上下文：${JSON.stringify({ brief: ctx.brief || '', product_subject: ctx.product_subject || '', business_boundary: ctx.business_boundary || '', target_duration: ctx.target_duration || 30, forbidden: ctx.forbidden || [], characters: ctx.characters || [] }).slice(0, 9000)}\n\n当前蓝图：${JSON.stringify(blueprint).slice(0, 22000)}\n\n这是第 ${attempt}/${maxAttempts} 轮精修。必须解决的问题：${before.issues.join('；') || '按精品标准进一步提升'}\n\n返回与当前蓝图相同结构和相同 beat 数量的完整 JSON。`,
    maxTokens: 8000,
    temperature: 0.55,
  });
  const parsed = await jsonRepair.parseOrRepair({ raw: result.text, expected: 'object', modelGateway, taskId, stage: 'new_story_ad.json_repair' });
  if (!Array.isArray(parsed.beats) || parsed.beats.length !== (blueprint.beats || []).length) {
    const error = new Error('精品剧本精修改变了镜头数量，已拒绝保存');
    error.code = 'BLUEPRINT_POLISH_STRUCTURE_INVALID';
    error.retryable = false;
    throw error;
  }
  const merged = preserveCharacterNames(blueprint, mergeVisibleStrings(blueprint, parsed));
  const language = await ensureChineseOutput({ payload: merged, kind: 'blueprint', taskId, context: ctx });
  const after = assessBlueprintQuality(language.payload);
  if (!after.pass) {
    if (attempt < maxAttempts) {
      const retry = await polishBlueprint(ctx, language.payload, { taskId, force: true, attempt: attempt + 1, maxAttempts, onProgress });
      return { ...retry, before };
    }
    const error = new Error(`精品剧本精修后仍未通过质量门槛：${after.issues.join('；')}`);
    error.code = 'BLUEPRINT_POLISH_QUALITY_FAILED';
    error.retryable = false;
    error.quality_diagnostics = { before, after };
    throw error;
  }
  return {
    blueprint: language.payload,
    polished: true,
    before,
    after,
    model_meta: { used_model: result.used_model, fallback_used: result.fallback_used, failed_models: result.failed_models || [] },
  };
}

module.exports = {
  BLUEPRINT_RIGHTS_POLICY_VERSION,
  assessBlueprintQuality,
  assessBlueprintRights,
  polishBlueprint,
  similarity,
};
