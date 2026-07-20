const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const { ensureChineseOutput, mergeVisibleStrings } = require('./outputLanguageService');

const CLICHE_PATTERNS = [
  /宇宙般|行业领先|最大化.{0,8}预算|为.{0,10}赋能|更快[、，,].{0,8}更智能|一站式解决|开启.{0,8}新篇章|尽享|极致体验|万千可能/,
  /通过一个统一的平台|海量.{0,8}任你选|轻松实现|轻松化解|高效便捷|安全稳定可靠|量身设计|直观友好|完美解决方案|完美呈现|秘密武器|前所未有|惊艳的现实|发现新大陆|星辰般/,
];
const BLUEPRINT_RIGHTS_POLICY_VERSION = 'original-rights-v2';
const DIALOGUE_CONTRACT_VERSION = 'dialogue-arc-v1';
const EXPLICIT_GENERATED_LOGO_PATTERN = /(?:logo|标志|商标|品牌字样).{0,18}(?:生成|形成|汇聚|变形|浮现|拼成|长出)|(?:生成|形成|汇聚|变形|浮现|拼成|长出).{0,18}(?:logo|标志|商标|品牌字样)/i;
const BRAND_MARK_PATTERN = /(?:品牌\s*)?(?:logo|标志|商标|品牌字样)/gi;
const BRAND_VISUAL_FIELDS = ['plot', 'visual', 'story_visual', 'promo_visual', 'action', 'visual_proof'];
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

function spokenCharacterCount(value = '') {
  return clean(value).replace(/[^\u3400-\u9fffA-Za-z0-9]/g, '').length;
}

function dialogueArcStage(value = '') {
  const fn = clean(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (['setup_goal', 'obstacle', 'question'].includes(fn)) return 'setup';
  if (['discovery', 'proof', 'value_shift', 'development'].includes(fn)) return 'development';
  if (['decision', 'result', 'resolution', 'brand_closure'].includes(fn)) return 'resolution';
  return '';
}

function genericReactionLine(value = '') {
  const spoken = clean(value).replace(/[，。！？…,.!?\s]/g, '');
  return /^(?:就是它了|就这样|这样就好|可以这样做|原来可以这样做|原来是这样|太棒了|真不错|没想到)$/.test(spoken)
    || (/^(?:嗯|哦|啊|咦|原来|没想到)/.test(spoken) && spoken.length <= 7);
}

function assessDialogueNarrative(blueprint = {}) {
  const contract = blueprint.dialogue_contract || {};
  if (contract.version !== DIALOGUE_CONTRACT_VERSION) {
    return { pass: true, issues: [], enforced: false, metrics: {} };
  }
  const beats = Array.isArray(blueprint.beats) ? blueprint.beats : [];
  const targetDuration = Math.max(1, Number(blueprint.target_duration || 0)
    || beats.reduce((sum, beat) => sum + Math.max(0, Number(beat.duration || beat.duration_sec || 0) || 0), 0)
    || 30);
  const lines = beats.map(beat => clean(beat.spoken_line || beat.voiceover || beat.copy));
  const counts = lines.map(spokenCharacterCount);
  const totalCharacters = counts.reduce((sum, count) => sum + count, 0);
  const minRate = Math.max(1.8, Number(contract.target_chars_per_second?.min || 2.4) || 2.4);
  const maxRate = Math.max(minRate, Number(contract.target_chars_per_second?.max || 4.8) || 4.8);
  const minTotal = Math.max(beats.length * 6, Math.round(targetDuration * minRate));
  const maxTotal = Math.ceil(targetDuration * maxRate);
  const issues = [];
  if (totalCharacters < minTotal) issues.push(`台词总信息量不足：${targetDuration} 秒至少约 ${minTotal} 个有效字，当前 ${totalCharacters} 个`);
  if (totalCharacters > maxTotal) issues.push(`台词总量超过自然口播容量：${targetDuration} 秒最多约 ${maxTotal} 个有效字，当前 ${totalCharacters} 个`);

  beats.forEach((beat, index) => {
    const n = index + 1;
    const duration = Math.max(1, Number(beat.duration || beat.duration_sec || targetDuration / Math.max(1, beats.length)) || 1);
    const fn = clean(beat.dialogue_function || beat.dialogue_intent);
    const minimum = fn === 'brand_closure' ? 4 : Math.max(6, Math.round(duration * 1.8));
    const maximum = Math.max(18, Math.ceil(duration * 5.2));
    if (counts[index] < minimum) issues.push(`第 ${n} 镜台词信息量不足：${duration} 秒至少约 ${minimum} 个有效字，当前 ${counts[index]} 个`);
    if (counts[index] > maximum) issues.push(`第 ${n} 镜台词超过镜头口播容量：${duration} 秒最多约 ${maximum} 个有效字，当前 ${counts[index]} 个`);
    if (!fn) issues.push(`第 ${n} 镜缺少 dialogue_function，无法验证台词在故事中的职责`);
    if (genericReactionLine(lines[index])) issues.push(`第 ${n} 镜台词只有泛化反应，没有推进意图、证据或决定`);
  });

  const stages = new Set(beats.map(beat => dialogueArcStage(beat.dialogue_function || beat.dialogue_intent)).filter(Boolean));
  if (beats.length >= 3 && !stages.has('setup')) issues.push('台词弧线缺少目标、问题或阻力');
  if (beats.length >= 3 && !stages.has('development')) issues.push('台词弧线缺少发现、证据或价值转变');
  if (beats.length >= 3 && !stages.has('resolution')) issues.push('台词弧线缺少决定、结果或品牌收束');

  const meaningful = lines.map(line => line.replace(/[^\u3400-\u9fffA-Za-z0-9]/g, ''));
  const repeatedOpeners = new Map();
  meaningful.forEach(line => {
    if (line.length < 4) return;
    const opener = line.slice(0, 2);
    repeatedOpeners.set(opener, (repeatedOpeners.get(opener) || 0) + 1);
  });
  const repeated = [...repeatedOpeners.entries()].filter(([, count]) => count >= 2).map(([opener]) => opener);
  if (repeated.length) issues.push(`台词句式重复：多镜重复以“${repeated.join('、')}”开头`);
  const ellipsisLines = lines.filter(line => /…|\.{3,}/.test(line)).length;
  if (ellipsisLines >= 2) issues.push(`台词过度依赖省略停顿：${ellipsisLines} 镜使用省略号`);

  return {
    pass: issues.length === 0,
    issues: Array.from(new Set(issues)),
    enforced: true,
    metrics: {
      target_duration: targetDuration,
      total_characters: totalCharacters,
      chars_per_second: Math.round((totalCharacters / targetDuration) * 100) / 100,
      min_total_characters: minTotal,
      max_total_characters: maxTotal,
      arc_stages: [...stages],
    },
  };
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

function normalizeAuthorizedBrandPresentation(blueprint = {}) {
  const result = JSON.parse(JSON.stringify(blueprint || {}));
  if (!Array.isArray(result.beats)) return result;
  result.beats = result.beats.map(beat => {
    const next = { ...(beat || {}) };
    BRAND_VISUAL_FIELDS.forEach(field => {
      const value = String(next[field] || '');
      if (!/(?:logo|标志|商标|品牌字样)/i.test(value)) return;
      if (EXPLICIT_GENERATED_LOGO_PATTERN.test(value)) return;
      if (/(?:不要|禁止|不得|避免).{0,12}(?:logo|标志|商标|品牌字样)/i.test(value)) return;
      next[field] = value.replace(BRAND_MARK_PATTERN, '后期叠加的已授权品牌素材');
    });
    return next;
  });
  return result;
}

function assessBlueprintRights(blueprint = {}) {
  const text = blueprintVisibleText(blueprint);
  const issues = RIGHTS_RISK_PATTERNS.filter(item => item.pattern.test(text)).map(item => item.issue);
  const generatedLogo = EXPLICIT_GENERATED_LOGO_PATTERN.test(text);
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
  const dialogue = assessDialogueNarrative(blueprint);
  issues.push(...dialogue.issues);
  const rights = assessBlueprintRights(blueprint);
  issues.push(...rights.issues);
  return {
    pass: issues.length === 0,
    issues: Array.from(new Set(issues)),
    score: Math.max(0, Math.round((1 - Math.min(0.8, issues.length * 0.08)) * 100) / 100),
    dialogue,
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
  const safeBlueprint = normalizeAuthorizedBrandPresentation(blueprint);
  const before = assessBlueprintQuality(safeBlueprint);
  if (!force && before.pass) return { blueprint: safeBlueprint, polished: false, before, after: before, model_meta: null };
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
      '台词必须承担故事推进，不能把人物目标、阻力、发现、可见证据、价值变化和最终决定只写在 plot、visual、action 或 why_next 中。',
      '保持每镜 dialogue_function 不变，并让 spoken_line 真正完成该职责；整条片子的台词必须形成“目标/阻力 → 发现/证据 → 决定/结果”的听觉叙事弧线。',
      '按 dialogue_contract 的口播密度修正台词。正常 4-6 秒镜头通常需要约 10-22 个有意义的中文字，品牌落版可以更短；简短不等于空泛。',
      '禁止用“原来……可以这样做”“就是它了”“太棒了”等泛化反应充当整句；每句至少补入具体意图、问题、材质/产品证据、后果或决定之一。',
      '相邻镜头不要重复“原来”“没想到”等相同开头，也不要依靠连续省略号制造虚假的情绪推进。',
      'spoken_line 只能写最终会被说出来的话，禁止加入括号、语气说明、表演提示、说话人标签或纯表情描述。',
      '除非用户明确提供，画面中不得出现真实第三方模型 Logo、品牌标识、虚构价格数字或未经证实的行业对比；可以使用通用模型卡片和抽象指标。',
      '所有人物、场景、剧情和视觉表达必须原创。不得复刻影视、动漫、游戏、广告、海报或专辑画面，不得模仿指定导演、艺术家、摄影师或在世创作者风格。',
      '不得使用明星、名人、公众人物或第三方角色的肖像、声音、换脸或同款形象；人物应为当前任务原创角色，后续真人演员只能来自平台已授权素材。',
      '用户明确提供的自有品牌名称和产品事实可以自然出现在台词、旁白和可编辑字幕中；视觉 Logo、商标或品牌字标只能标记为“后期叠加已授权品牌素材”，不得要求图片模型生成、变形或猜测。',
      '不得编写任何绕过版权、内容审核、人脸审核或供应商安全策略的指令。',
      '画面字段写镜头中看见的构图、主体和状态；动作字段只写人物或主体发生的动作与变化，二者不得复制。',
      '保持原故事事实、广告主体、人物身份与姓名、镜头数量和顺序，不得增加未经用户提供的功能、数据、品牌背书或价格承诺。',
      '结尾行动号召应自然承接剧情结果；品牌名称可以简洁说出，视觉品牌标识必须使用已授权素材后期叠加，不喊空洞口号。',
      '发现的问题必须逐条消除；不要因为原文已有某个表达就保留翻译腔、第三方 Logo、夸张隐喻或空洞口号，可以在不改变事实的前提下彻底重写这些句子。',
      'role 和剧情推进必须清楚体现冲突、转折与结果的因果关系；可以使用更自然的具体名称，但不能把整条片子重新写成并列卖点。',
      '所有用户可见内容使用自然简体中文；JSON 键、技术枚举、数字和 ID 不变。',
    ].join('\n'),
    userPrompt: `任务上下文：${JSON.stringify({ brief: ctx.brief || '', product_subject: ctx.product_subject || '', business_boundary: ctx.business_boundary || '', target_duration: ctx.target_duration || 30, forbidden: ctx.forbidden || [], characters: ctx.characters || [] }).slice(0, 9000)}\n\n当前蓝图：${JSON.stringify(safeBlueprint).slice(0, 22000)}\n\n这是第 ${attempt}/${maxAttempts} 轮精修。必须解决的问题：${before.issues.join('；') || '按精品标准进一步提升'}\n\n返回与当前蓝图相同结构和相同 beat 数量的完整 JSON。`,
    maxTokens: 8000,
    temperature: 0.55,
  });
  const parsed = await jsonRepair.parseOrRepair({ raw: result.text, expected: 'object', modelGateway, taskId, stage: 'new_story_ad.json_repair' });
  if (!Array.isArray(parsed.beats) || parsed.beats.length !== (safeBlueprint.beats || []).length) {
    const error = new Error('精品剧本精修改变了镜头数量，已拒绝保存');
    error.code = 'BLUEPRINT_POLISH_STRUCTURE_INVALID';
    error.retryable = false;
    throw error;
  }
  const merged = preserveCharacterNames(safeBlueprint, mergeVisibleStrings(safeBlueprint, parsed));
  const language = await ensureChineseOutput({ payload: merged, kind: 'blueprint', taskId, context: ctx });
  const safePayload = normalizeAuthorizedBrandPresentation(language.payload);
  const after = assessBlueprintQuality(safePayload);
  if (!after.pass) {
    if (attempt < maxAttempts) {
      const retry = await polishBlueprint(ctx, safePayload, { taskId, force: true, attempt: attempt + 1, maxAttempts, onProgress });
      return { ...retry, before };
    }
    const error = new Error(`精品剧本精修后仍未通过质量门槛：${after.issues.join('；')}`);
    error.code = 'BLUEPRINT_POLISH_QUALITY_FAILED';
    error.retryable = false;
    error.quality_diagnostics = { before, after };
    throw error;
  }
  return {
    blueprint: safePayload,
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
  normalizeAuthorizedBrandPresentation,
  assessDialogueNarrative,
  polishBlueprint,
  similarity,
};
