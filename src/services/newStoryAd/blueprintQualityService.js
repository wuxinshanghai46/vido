const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const { ensureChineseOutput, mergeVisibleStrings } = require('./outputLanguageService');
const brandEnding = require('./brandEndingService');

const CLICHE_PATTERNS = [
  /宇宙般|行业领先|最大化.{0,8}预算|为.{0,10}赋能|更快[、，,].{0,8}更智能|一站式解决|开启.{0,8}新篇章|尽享|极致体验|万千可能/,
  /通过一个统一的平台|海量.{0,8}任你选|轻松实现|轻松化解|高效便捷|安全稳定可靠|量身设计|直观友好|完美解决方案|完美呈现|秘密武器|前所未有|惊艳的现实|发现新大陆|星辰般/,
];
const BLUEPRINT_RIGHTS_POLICY_VERSION = 'original-rights-v2';
const DIALOGUE_CONTRACT_VERSION = 'dialogue-arc-v1';
const CAUSAL_STORY_CONTRACT_VERSION = 'causal-story-v1';
const CAUSAL_ARC_TYPES = new Set(['conflict_resolution', 'transformation', 'demonstration', 'journey']);
const CAUSAL_ROLES = new Set(['setup', 'trigger', 'development', 'evidence', 'transformation', 'resolution', 'brand_closure']);
const DIALOGUE_FUNCTIONS = new Set(['setup_goal', 'obstacle', 'question', 'discovery', 'proof', 'value_shift', 'decision', 'result', 'resolution', 'brand_closure', 'development']);
const SPEECH_MODES = new Set(['dialogue', 'voiceover', 'silent', 'ambient_only']);
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

function conversationalSpeech(value = '') {
  const spoken = clean(value);
  if (!spoken) return false;
  return /[？?]/.test(spoken)
    || /(?:^|[，。！？；])(?:我|我们|咱们|你|你们)/.test(spoken)
    || /(?:感觉|觉得|没想到|原来|是不是|怎么|为什么|谁|有点|应该.{0,8}(?:吧|了)|吧[。！？]?|吗[？?]?|呢[？?]?)/.test(spoken);
}

function stringList(value, limit = 12) {
  return (Array.isArray(value) ? value : (value ? [value] : []))
    .map(clean)
    .filter(Boolean)
    .slice(0, limit);
}

function normalizedCausalRole(beat = {}, index = 0, total = 1) {
  const explicit = clean(beat.causal_role).toLowerCase().replace(/[\s-]+/g, '_');
  if (CAUSAL_ROLES.has(explicit)) return explicit;
  const fn = clean(beat.dialogue_function || beat.dialogue_intent).toLowerCase().replace(/[\s-]+/g, '_');
  if (['setup_goal', 'obstacle', 'question'].includes(fn)) return 'setup';
  if (['discovery', 'development'].includes(fn)) return index <= 0 ? 'trigger' : 'development';
  if (fn === 'proof') return 'evidence';
  if (fn === 'value_shift') return 'transformation';
  if (['decision', 'result', 'resolution'].includes(fn)) return 'resolution';
  if (fn === 'brand_closure') return 'brand_closure';
  const role = clean(`${beat.role || ''} ${beat.purpose || ''}`);
  if (/品牌|落版|收束|结尾/.test(role)) return 'brand_closure';
  if (/结果|解决|决定|完成|满足|认证/.test(role)) return 'resolution';
  if (/证明|证据|验证|对比/.test(role)) return 'evidence';
  if (/转折|转变|变化|发现|觉察/.test(role)) return 'transformation';
  if (/触发|开始|启动|介入/.test(role)) return 'trigger';
  if (/冲突|问题|困难|受阻|目标|需求|建立/.test(role)) return 'setup';
  if (index === 0) return 'setup';
  if (index === total - 1) return 'resolution';
  return 'development';
}

function orderedCausalStages(beats = []) {
  const roles = beats.map((beat, index) => normalizedCausalRole(beat, index, beats.length));
  const setupIndex = roles.findIndex(role => role === 'setup');
  const developmentIndex = roles.findIndex((role, index) => index > setupIndex
    && ['trigger', 'development', 'evidence', 'transformation'].includes(role));
  const resolutionIndex = roles.findIndex((role, index) => index > developmentIndex
    && ['resolution', 'brand_closure'].includes(role));
  return {
    roles,
    setup_index: setupIndex,
    development_index: developmentIndex,
    resolution_index: resolutionIndex,
    pass: setupIndex >= 0 && developmentIndex > setupIndex && resolutionIndex > developmentIndex,
  };
}

function contractBeatRefs(contract = {}, key = '', beatCount = 0) {
  const refs = contract.beat_refs?.[key];
  return (Array.isArray(refs) ? refs : [])
    .map(Number)
    .filter(index => Number.isInteger(index) && index >= 1 && index <= beatCount);
}

function beatHasCausalEvidence(beat = {}) {
  const before = stringList(beat.state_before || beat.entry_state);
  const after = stringList(beat.state_after || beat.exit_state);
  return !!(
    (before.length && after.length)
    || stringList(beat.intended_changes || beat.intended_change).length
    || stringList(beat.visible_evidence || beat.evidence_requirements).length
    || clean(beat.why_next)
    || clean(beat.emotional_turn)
    || clean(beat.visual_proof || beat.evidence)
  );
}

/**
 * 通用剧情因果检查只验证结构，不按行业、场景或中文展示标签写死。
 * 新剧本使用 causal-story-v1 合同；历史剧本继续从稳定的技术职责推导。
 */
function assessCausalProgression(blueprint = {}) {
  const beats = Array.isArray(blueprint.beats) ? blueprint.beats : [];
  const ordered = orderedCausalStages(beats);
  const contract = blueprint.narrative_contract && typeof blueprint.narrative_contract === 'object'
    ? blueprint.narrative_contract
    : null;
  const issues = [];
  const contractRequired = blueprint.causal_contract_required === true;

  if (contractRequired && contract?.version !== CAUSAL_STORY_CONTRACT_VERSION) {
    issues.push('缺少可验证的通用因果叙事合同');
  }
  if (contract?.version === CAUSAL_STORY_CONTRACT_VERSION) {
    if (!CAUSAL_ARC_TYPES.has(clean(contract.arc_type).toLowerCase())) issues.push('叙事合同缺少有效的通用弧线类型');
    for (const key of ['setup', 'trigger', 'progression', 'result']) {
      if (!clean(contract[key])) issues.push(`叙事合同缺少${key}阶段`);
      if (!contractBeatRefs(contract, key, beats.length).length) issues.push(`叙事合同的${key}阶段没有绑定镜头`);
    }
  }
  if (!ordered.pass) issues.push('缺少按顺序可验证的起始、推进与结果');

  const evidenceCount = beats.filter(beatHasCausalEvidence).length;
  if (contractRequired && evidenceCount < Math.min(2, Math.max(1, beats.length - 1))) {
    issues.push('剧情缺少跨镜头可观察的状态变化或结果证据');
  }

  return {
    pass: issues.length === 0,
    issues: Array.from(new Set(issues)),
    contract_version: contract?.version || '',
    arc_type: clean(contract?.arc_type).toLowerCase(),
    ordered_stages: ordered,
    evidence_beat_count: evidenceCount,
  };
}

function assessDialogueNarrative(blueprint = {}) {
  const contract = blueprint.dialogue_contract || {};
  if (contract.version !== DIALOGUE_CONTRACT_VERSION) {
    return { pass: true, issues: [], enforced: false, metrics: {} };
  }
  const beats = Array.isArray(blueprint.beats) ? blueprint.beats : [];
  const characters = Array.isArray(blueprint.characters) ? blueprint.characters : [];
  const targetDuration = Math.max(1, Number(blueprint.target_duration || 0)
    || beats.reduce((sum, beat) => sum + Math.max(0, Number(beat.duration || beat.duration_sec || 0) || 0), 0)
    || 30);
  const lines = beats.map(beat => clean(beat.spoken_line || beat.voiceover || beat.copy));
  const counts = lines.map(spokenCharacterCount);
  const totalCharacters = counts.reduce((sum, count) => sum + count, 0);
  const maxRate = Math.max(3.2, Number(contract.target_chars_per_second?.max || 4.8) || 4.8);
  const sparse = contract.speech_policy === 'authored_sparse';
  const authoredLineCount = Math.max(0, Number(contract.authored_line_count || 0) || 0);
  const voicedBeatCount = lines.filter(Boolean).length;
  const maxTotal = Math.ceil(targetDuration * maxRate);
  const issues = [];
  const warnings = [];
  if (totalCharacters > maxTotal) issues.push(`台词总量超过自然口播容量：${targetDuration} 秒最多约 ${maxTotal} 个有效字，当前 ${totalCharacters} 个`);
  if (sparse && authoredLineCount && voicedBeatCount > authoredLineCount) {
    issues.push(`用户只提供了 ${authoredLineCount} 处口播，当前生成了 ${voicedBeatCount} 处，不能擅自给静默镜头补台词`);
  }

  beats.forEach((beat, index) => {
    const n = index + 1;
    const spoken = lines[index];
    const duration = Math.max(1, Number(beat.duration || beat.duration_sec || targetDuration / Math.max(1, beats.length)) || 1);
    const fn = clean(beat.dialogue_function || beat.dialogue_intent);
    const speechMode = clean(beat.speech_mode).toLowerCase().replace(/[\s-]+/g, '_');
    const dialogueLines = (Array.isArray(beat.dialogue_lines) ? beat.dialogue_lines : []).map(line => ({
      speech_mode: clean(line?.speech_mode || line?.kind).toLowerCase().replace(/[\s-]+/g, '_'),
      speaker: clean(line?.speaker),
      speaker_id: clean(line?.speaker_id),
      line: clean(line?.line || line?.text),
    })).filter(line => line.line);
    const firstDialogueLine = dialogueLines[0];
    if (dialogueLines.length && ['silent', 'ambient_only'].includes(speechMode)) issues.push(`第 ${n} 镜存在声音内容但顶层被标记为静默`);
    if (firstDialogueLine && (speechMode !== firstDialogueLine.speech_mode || spoken !== firstDialogueLine.line)) issues.push(`第 ${n} 镜声音摘要与声音明细不一致`);
    dialogueLines.forEach((line, lineIndex) => {
      if (line.speech_mode === 'voiceover') {
        if (line.speaker !== '旁白' || line.speaker_id !== 'narrator') issues.push(`第 ${n} 镜第 ${lineIndex + 1} 条旁白标识不正确`);
        if (conversationalSpeech(line.line)) issues.push(`第 ${n} 镜第 ${lineIndex + 1} 条内容是人物口语或现场提问，不能标记为旁白；应改为人物对白，或重写成客观介绍式旁白`);
      } else if (line.speech_mode === 'dialogue') {
        const character = characters.find(item => clean(item?.name) === line.speaker || clean(item?.id) === line.speaker_id);
        if (!character || clean(character?.name) !== line.speaker || clean(character?.id) !== line.speaker_id) issues.push(`第 ${n} 镜第 ${lineIndex + 1} 条人物对白未绑定明确说话人`);
      } else {
        issues.push(`第 ${n} 镜第 ${lineIndex + 1} 条声音内容类型无效`);
      }
    });
    const silent = ['silent', 'ambient_only'].includes(speechMode) || (sparse && !lines[index]);
    const maximum = Math.max(18, Math.ceil(duration * 5.2));
    if (!silent && counts[index] > maximum) issues.push(`第 ${n} 镜台词超过镜头口播容量：${duration} 秒最多约 ${maximum} 个有效字，当前 ${counts[index]} 个`);
    if (!fn) issues.push(`第 ${n} 镜缺少 dialogue_function，无法验证台词在故事中的职责`);
    if (!silent && genericReactionLine(lines[index])) issues.push(`第 ${n} 镜台词只有泛化反应，没有推进意图、证据或决定`);
  });

  const voicedBeats = beats.map((beat, index) => ({ beat, index, line: lines[index] })).filter(item => item.line);
  voicedBeats.forEach((item, voicedIndex) => {
    const fn = clean(item.beat.dialogue_function || item.beat.dialogue_intent).toLowerCase().replace(/[\s-]+/g, '_');
    if (fn !== 'question') return;
    const next = voicedBeats[voicedIndex + 1];
    if (!next) {
      issues.push(`第 ${item.index + 1} 镜提出问题后没有回应、证据或结果`);
      return;
    }
    const nextFn = clean(next.beat.dialogue_function || next.beat.dialogue_intent).toLowerCase().replace(/[\s-]+/g, '_');
    if (['decision', 'result', 'resolution', 'brand_closure'].includes(nextFn)) {
      issues.push(`第 ${item.index + 1} 镜提出问题后直接进入第 ${next.index + 1} 镜的决定，缺少回应或可见证据`);
    }
  });

  const stages = new Set(beats
    .filter((_beat, index) => !!lines[index])
    .map(beat => dialogueArcStage(beat.dialogue_function || beat.dialogue_intent))
    .filter(Boolean));
  if (!sparse && beats.length >= 3 && !stages.has('setup')) issues.push('台词弧线缺少目标、问题或阻力');
  if (!sparse && beats.length >= 3 && !stages.has('development')) issues.push('台词弧线缺少发现、证据或价值转变');
  if (!sparse && beats.length >= 3 && !stages.has('resolution')) issues.push('台词弧线缺少决定、结果或品牌收束');

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
    warnings: Array.from(new Set(warnings)),
    enforced: true,
    metrics: {
      target_duration: targetDuration,
      total_characters: totalCharacters,
      chars_per_second: Math.round((totalCharacters / targetDuration) * 100) / 100,
      max_total_characters: maxTotal,
      speech_policy: sparse ? 'authored_sparse' : 'full_track',
      voiced_beat_count: voicedBeatCount,
      authored_line_count: authoredLineCount,
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
      if (/(?:不要|禁止|不得|避免).{0,12}(?:logo|标志|商标|品牌字样)/i.test(value)) return;
      if (EXPLICIT_GENERATED_LOGO_PATTERN.test(value)) {
        next[field] = value
          .split(/(?<=[。！？；;!?])/)
          .map(clause => EXPLICIT_GENERATED_LOGO_PATTERN.test(clause)
            ? '画面预留干净的品牌落版区域，成片阶段后期叠加的已授权品牌素材。'
            : clause)
          .join('');
        return;
      }
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

function assessBlueprintQuality(blueprint = {}, ctx = {}) {
  const beats = Array.isArray(blueprint.beats) ? blueprint.beats : [];
  const characters = Array.isArray(blueprint.characters) ? blueprint.characters : [];
  const castIntent = ctx.brief_intake?.cast_intent || ctx.cast_intent || {};
  const productionContractRequired = castIntent.confirmed === true;
  const expectedPeople = castIntent.mode === 'no_human' ? 0 : Math.max(0, Number(castIntent.expected_people || ctx.expected_people || 0));
  const sparse = blueprint.dialogue_contract?.speech_policy === 'authored_sparse';
  const narrationOnly = clean(ctx.speech_presentation || blueprint.dialogue_contract?.speech_presentation || '').toLowerCase() === 'narration_only';
  const durationAwareDialogue = blueprint.dialogue_contract?.version === DIALOGUE_CONTRACT_VERSION;
  const issues = [];
  if (productionContractRequired && characters.filter(item => item?.on_screen !== false).length !== expectedPeople) {
    issues.push(`已确认 ${expectedPeople} 位出镜人物，但剧情蓝图包含 ${characters.filter(item => item?.on_screen !== false).length} 位`);
  }
  if (!clean(blueprint.logline)) issues.push('缺少清晰的故事主线');
  characters.forEach((character, index) => {
    const prefix = `第 ${index + 1} 个角色`;
    if (!clean(character?.name)) issues.push(`${prefix}缺少姓名`);
    if (!clean(character?.role)) issues.push(`${prefix}缺少剧情职责`);
    if (!clean(character?.gender)) issues.push(`${prefix}缺少性别`);
    if (!clean(character?.age_range || character?.age)) issues.push(`${prefix}缺少年龄或年龄范围`);
  });
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
    const speechMode = clean(beat.speech_mode).toLowerCase().replace(/[\s-]+/g, '_');
    const detailedLines = (Array.isArray(beat.dialogue_lines) ? beat.dialogue_lines : []).map(line => ({
      speech_mode: clean(line?.speech_mode || line?.kind).toLowerCase().replace(/[\s-]+/g, '_'),
      speaker: clean(line?.speaker), speaker_id: clean(line?.speaker_id), line: clean(line?.line || line?.text),
    })).filter(line => line.line);
    if (detailedLines.length && ['silent', 'ambient_only'].includes(speechMode)) issues.push(`第 ${n} 镜存在声音内容但顶层被标记为静默`);
    if (detailedLines[0] && (speechMode !== detailedLines[0].speech_mode || spoken !== detailedLines[0].line)) issues.push(`第 ${n} 镜声音摘要与声音明细不一致`);
    if (narrationOnly && (speechMode === 'dialogue' || detailedLines.some(line => line.speech_mode === 'dialogue'))) {
      issues.push(`第 ${n} 镜违反纯旁白合同：出镜人物不得说话，声音内容必须重写为客观介绍式旁白`);
    }
    detailedLines.forEach((line, lineIndex) => {
      if (line.speech_mode === 'voiceover') {
        if (line.speaker !== '旁白' || line.speaker_id !== 'narrator') issues.push(`第 ${n} 镜第 ${lineIndex + 1} 条旁白标识不正确`);
        if (conversationalSpeech(line.line)) issues.push(`第 ${n} 镜第 ${lineIndex + 1} 条内容是人物口语或现场提问，不能标记为旁白；应改为人物对白，或重写成客观介绍式旁白`);
      }
      if (line.speech_mode === 'dialogue') {
        const bound = characters.find(item => clean(item?.name) === line.speaker || clean(item?.id) === line.speaker_id);
        if (!bound || clean(bound?.name) !== line.speaker || clean(bound?.id) !== line.speaker_id) issues.push(`第 ${n} 镜第 ${lineIndex + 1} 条人物对白未绑定明确说话人`);
      }
      if (!['dialogue', 'voiceover'].includes(line.speech_mode)) issues.push(`第 ${n} 镜第 ${lineIndex + 1} 条声音内容类型无效`);
    });
    if (!spoken && !['silent', 'ambient_only'].includes(speechMode)) issues.push(`第 ${n} 镜未说明使用对白、旁白还是静默画面`);
    const spokenWithoutDirections = spoken.replace(/^[（(][^）)]*[）)]\s*/g, '').replace(/^[…。.，,、\s]+|[…。.，,、\s]+$/g, '');
    if (spoken && !spokenWithoutDirections) issues.push(`第 ${n} 镜台词只有表演提示，没有实际对白`);
    if (/^[（(].*[）)]/.test(spoken)) issues.push(`第 ${n} 镜台词混入表演提示`);
    if (productionContractRequired) {
      if (!clean(beat.lighting_mood)) issues.push(`第 ${n} 镜缺少光影氛围`);
      const soundReady = clean(beat.sound_mode) === 'silent'
        ? !!clean(beat.explicit_silence_reason)
        : !!(clean(beat.ambient_sound) || (Array.isArray(beat.sfx) && beat.sfx.length) || clean(beat.music_cue) || clean(beat.audio_bridge));
      if (!soundReady) issues.push(`第 ${n} 镜缺少声音设计`);
      if (!clean(beat.camera_movement)) issues.push(`第 ${n} 镜缺少运镜设计`);
      if (!clean(beat.prompt_notes || beat.keyframe_prompt_override)) issues.push(`第 ${n} 镜缺少制作提示`);
      if (spoken && beat.speech_mode === 'dialogue' && !characters.some(character => clean(character.name) === clean(beat.speaker))) {
        issues.push(`第 ${n} 镜说话人未绑定已确认剧情人物`);
      }
    }
    // 新版台词合同会按单镜时长核算自然口播容量；固定 42 字上限会把
    // 10 秒等长镜头的合格台词误判为过长，并诱发全稿无谓重写。
    if (!durationAwareDialogue && spoken.length > 42) issues.push(`第 ${n} 镜台词过长`);
    if (CLICHE_PATTERNS.some(pattern => pattern.test(`${spoken} ${visual}`))) issues.push(`第 ${n} 镜存在广告套话或翻译腔`);
    if (/(?:无数|知名|各种|不同).{0,12}(?:AI)?模型\s*[Ll]ogo/.test(visual)) issues.push(`第 ${n} 镜包含未经确认的第三方模型 Logo`);
  });
  const spokenText = beats.map(beat => clean(beat.spoken_line || beat.voiceover || '')).join(' ');
  if (CLICHE_PATTERNS.some(pattern => pattern.test(spokenText))) issues.push('整体文案存在广告套话');
  const causal = assessCausalProgression(blueprint);
  issues.push(...causal.issues);
  const dialogue = assessDialogueNarrative(blueprint);
  issues.push(...dialogue.issues);
  const rights = assessBlueprintRights(blueprint);
  issues.push(...rights.issues);
  return {
    pass: issues.length === 0,
    issues: Array.from(new Set(issues)),
    score: Math.max(0, Math.round((1 - Math.min(0.8, issues.length * 0.08)) * 100) / 100),
    causal,
    dialogue,
    rights,
  };
}

function preferQualityCandidate(current = {}, candidate = {}) {
  const currentReview = current.review || assessBlueprintQuality(current.blueprint || {});
  const candidateReview = candidate.review || assessBlueprintQuality(candidate.blueprint || {});
  if (candidateReview.pass && !currentReview.pass) return { ...candidate, review: candidateReview };
  if (currentReview.pass && !candidateReview.pass) return { ...current, review: currentReview };
  const currentIssues = Array.isArray(currentReview.issues) ? currentReview.issues.length : Number.MAX_SAFE_INTEGER;
  const candidateIssues = Array.isArray(candidateReview.issues) ? candidateReview.issues.length : Number.MAX_SAFE_INTEGER;
  if (candidateIssues < currentIssues) return { ...candidate, review: candidateReview };
  if (currentIssues < candidateIssues) return { ...current, review: currentReview };
  return Number(candidateReview.score || 0) > Number(currentReview.score || 0)
    ? { ...candidate, review: candidateReview }
    : { ...current, review: currentReview };
}

function preserveCharacterNames(original = {}, candidate = {}) {
  const result = candidate;
  if (Array.isArray(original.characters) && Array.isArray(result.characters)) {
    result.characters = result.characters.map((character, index) => ({
      ...character,
      id: original.characters[index]?.id || character.id,
      name: original.characters[index]?.name || character.name,
      role: original.characters[index]?.role || character.role,
      gender: original.characters[index]?.gender || character.gender,
      age_range: original.characters[index]?.age_range || original.characters[index]?.age || character.age_range || character.age,
      relationship: original.characters[index]?.relationship || character.relationship,
      on_screen: original.characters[index]?.on_screen ?? character.on_screen,
    }));
  }
  return result;
}

function normalizedCandidateContract(value = {}, fallback = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const previous = fallback && typeof fallback === 'object' ? fallback : {};
  const arcType = clean(source.arc_type || previous.arc_type).toLowerCase();
  const beatRefs = source.beat_refs && typeof source.beat_refs === 'object' ? source.beat_refs : previous.beat_refs;
  return {
    version: CAUSAL_STORY_CONTRACT_VERSION,
    arc_type: CAUSAL_ARC_TYPES.has(arcType) ? arcType : (previous.arc_type || 'journey'),
    setup: clean(source.setup || previous.setup),
    trigger: clean(source.trigger || previous.trigger),
    progression: clean(source.progression || previous.progression),
    result: clean(source.result || previous.result),
    beat_refs: Object.fromEntries(['setup', 'trigger', 'progression', 'result'].map(key => [
      key,
      (Array.isArray(beatRefs?.[key]) ? beatRefs[key] : []).map(Number).filter(Number.isInteger),
    ])),
  };
}

function mergePolishedBlueprint(original = {}, candidate = {}) {
  const merged = mergeVisibleStrings(original, candidate);
  const characters = Array.isArray(original.characters) ? original.characters : [];
  const characterByName = new Map(characters.map(character => [clean(character?.name), character]).filter(([name]) => name));
  const characterById = new Map(characters.map(character => [clean(character?.id), character]).filter(([id]) => id));
  if (candidate.narrative_contract && typeof candidate.narrative_contract === 'object') {
    merged.narrative_contract = normalizedCandidateContract(candidate.narrative_contract, original.narrative_contract);
  }
  if (Array.isArray(merged.beats) && Array.isArray(candidate.beats)) {
    merged.beats = merged.beats.map((beat, index) => {
      const next = candidate.beats[index] || {};
      const causalRole = clean(next.causal_role).toLowerCase().replace(/[\s-]+/g, '_');
      const dialogueFunction = clean(next.dialogue_function || next.dialogue_intent).toLowerCase().replace(/[\s-]+/g, '_');
      const speechMode = clean(next.speech_mode).toLowerCase().replace(/[\s-]+/g, '_');
      const authoritativeSpeaker = characterByName.get(clean(next.speaker)) || characterById.get(clean(next.speaker_id));
      const speakerBinding = speechMode === 'voiceover'
        ? { speaker: '旁白', speaker_id: 'narrator' }
        : (speechMode === 'dialogue' && authoritativeSpeaker
          ? { speaker: clean(authoritativeSpeaker.name), speaker_id: clean(authoritativeSpeaker.id) }
          : {});
      return {
        ...beat,
        ...(CAUSAL_ROLES.has(causalRole) ? { causal_role: causalRole } : {}),
        ...(DIALOGUE_FUNCTIONS.has(dialogueFunction) ? { dialogue_function: dialogueFunction } : {}),
        ...(SPEECH_MODES.has(speechMode) ? { speech_mode: speechMode } : {}),
        ...speakerBinding,
        state_before: stringList(next.state_before || beat.state_before),
        state_after: stringList(next.state_after || beat.state_after),
        intended_changes: stringList(next.intended_changes || next.intended_change || beat.intended_changes),
        visible_evidence: stringList(next.visible_evidence || next.evidence_requirements || beat.visible_evidence),
      };
    });
  }
  return merged;
}

async function polishBlueprint(ctx, blueprint, { taskId = '', force = false, attempt = 1, maxAttempts = 3, onProgress = null } = {}) {
  const safeBlueprint = brandEnding.applyToBlueprint(normalizeAuthorizedBrandPresentation(blueprint), ctx);
  const before = assessBlueprintQuality(safeBlueprint, ctx);
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
      '把现有蓝图精修成一条真正可拍、有明确因果推进和可见结果的精品短剧情广告，而不是功能清单、产品说明书或卖点口播合集。',
      '根据当前任务选择 conflict_resolution、transformation、demonstration 或 journey 中最合适的通用叙事弧线；不得为了形式完整强行制造用户没有要求的危机、失败、拒绝、不适或负面状态。',
      'narrative_contract 必须使用 causal-story-v1，并填写 setup、trigger、progression、result 及对应 beat_refs。每镜 causal_role 必须使用 setup、trigger、development、evidence、transformation、resolution、brand_closure 之一。',
      '每镜用 state_before、state_after、intended_changes、visible_evidence 记录真实可拍的变化；这些内容只能来自当前用户需求、人物、宠物、产品和场景合同。',
      '所有行业通用：只依据当前任务内容创作，不套用固定行业、固定场景、固定人物或固定故事模板。',
      ctx.brief_intake?.cast_intent?.background_people === true
        ? '本任务明确为 1 位背景出镜人物：必须保留其触摸、走过、驻足等画面动作和人物一致性，但广告中不得介绍姓名、职业、个人故事，不得把背景人物升级为主角、客户决策者或产品讲解者。'
        : '',
      '每个卖点必须由人物选择、可见动作、界面/产品反馈或结果变化证明；不要让人物直接念卖点。',
      '台词必须像真人会说的话，简短、自然、有上下文；避免“宇宙般、行业领先、为您赋能、最大化预算、更快更智能、一站式”等广告套话。',
      '台词必须承担故事推进，不能把人物目标、阻力、发现、可见证据、价值变化和最终决定只写在 plot、visual、action 或 why_next 中。',
      '人物明确提问后，必须先由另一人物回应，或用独立镜头给出可见证据，再进入选择、决定或结果；必要时在不改变总镜头数的前提下合并前面的重复铺垫并重排提问、回应、决定。',
      '允许在不改变镜头事实、数量和顺序的前提下，修正错误的 dialogue_function 与 speech_mode，使职责和实际台词一致。',
      '当问题涉及说话人时，必须同时修正 speaker 与 speaker_id：dialogue 只能绑定当前 characters 中同一人物的精确 name/id；voiceover 只能使用旁白/narrator。',
      safeBlueprint.dialogue_contract?.speech_policy === 'authored_sparse'
        ? `用户采用稀疏口播：最多保留 ${safeBlueprint.dialogue_contract?.authored_line_count || 0} 个有声镜头。不得给 silent 或 ambient_only 镜头新增台词；剧情因果可由可见动作、状态与证据完成。`
        : '整条片子的台词必须形成“目标/阻力 → 发现/证据 → 决定/结果”的听觉叙事弧线。',
      '按 dialogue_contract 修正声音表达：台词必须承担清晰的剧情职责并能在镜头时长内自然说完；由画面动作、环境声或音乐承担叙事的镜头应明确标记 silent 或 ambient_only，不要为凑长度硬塞旁白。',
      '禁止用“原来……可以这样做”“就是它了”“太棒了”等泛化反应充当整句；每句至少补入具体意图、问题、材质/产品证据、后果或决定之一。',
      '相邻镜头不要重复“原来”“没想到”等相同开头，也不要依靠连续省略号制造虚假的情绪推进。',
      'spoken_line 只能写最终会被说出来的话，禁止加入括号、语气说明、表演提示、说话人标签或纯表情描述。',
      '除非用户明确提供，画面中不得出现真实第三方模型 Logo、品牌标识、虚构价格数字或未经证实的行业对比；可以使用通用模型卡片和抽象指标。',
      '所有人物、场景、剧情和视觉表达必须原创。不得复刻影视、动漫、游戏、广告、海报或专辑画面，不得模仿指定导演、艺术家、摄影师或在世创作者风格。',
      '不得使用明星、名人、公众人物或第三方角色的肖像、声音、换脸或同款形象；人物应为当前任务原创角色，后续真人演员只能来自平台已授权素材。',
      '用户明确提供的自有品牌名称和产品事实可以自然出现在台词、旁白和可编辑字幕中；视觉 Logo、商标或品牌字标只能标记为“后期叠加已授权品牌素材”，不得要求图片模型生成、变形或猜测。',
      brandEnding.enabled(ctx)
        ? '本任务已有上传且确认授权的 Logo。最后一镜必须保留当前故事场景并预留无遮挡安全区，授权原图将在视频完成后精确叠加。'
        : '本任务没有有效授权 Logo。删除所有视觉 Logo、品牌落版和安全区要求，让剧情在当前场景中自然结束；不得把旧需求里的 Logo 文字改写成虚假的已授权素材。',
      '不得编写任何绕过版权、内容审核、人脸审核或供应商安全策略的指令。',
      '画面字段写镜头中看见的构图、主体和状态；动作字段只写人物或主体发生的动作与变化，二者不得复制。',
      '保持原故事事实、广告主体、人物身份与姓名、镜头数量和顺序，不得增加未经用户提供的功能、数据、品牌背书或价格承诺。',
      '结尾行动号召应自然承接剧情结果；品牌名称可以简洁说出，视觉品牌标识必须使用已授权素材后期叠加，不喊空洞口号。',
      '发现的问题必须逐条消除；不要因为原文已有某个表达就保留翻译腔、第三方 Logo、夸张隐喻或空洞口号，可以在不改变事实的前提下彻底重写这些句子。',
      '用户可见的 role 可以使用自然名称，不需要包含“冲突、转折、结果”等固定词；平台通过 narrative_contract 和 causal_role 校验因果关系。',
      '所有用户可见内容使用自然简体中文；JSON 键、技术枚举、数字和 ID 不变。',
    ].join('\n'),
    userPrompt: `任务上下文：${JSON.stringify({ brief: ctx.brief || '', product_subject: ctx.product_subject || '', business_boundary: ctx.business_boundary || '', target_duration: ctx.target_duration || 30, forbidden: ctx.forbidden || [], characters: ctx.characters || [], cast_intent: ctx.brief_intake?.cast_intent || ctx.cast_intent || null, expected_people: ctx.expected_people || 0 }).slice(0, 9000)}\n\n当前蓝图：${JSON.stringify(safeBlueprint).slice(0, 22000)}\n\n这是第 ${attempt}/${maxAttempts} 轮精修。必须解决的问题：${before.issues.join('；') || '按精品标准进一步提升'}\n\n返回与当前蓝图相同结构和相同 beat 数量的完整 JSON。`,
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
  const merged = preserveCharacterNames(safeBlueprint, mergePolishedBlueprint(safeBlueprint, parsed));
  const language = await ensureChineseOutput({ payload: merged, kind: 'blueprint', taskId, context: ctx });
  const safePayload = brandEnding.applyToBlueprint(normalizeAuthorizedBrandPresentation(language.payload), ctx);
  const after = assessBlueprintQuality(safePayload, ctx);
  if (!after.pass) {
    const best = preferQualityCandidate(
      { blueprint: safeBlueprint, review: before },
      { blueprint: safePayload, review: after },
    );
    if (attempt < maxAttempts) {
      const retry = await polishBlueprint(ctx, best.blueprint, { taskId, force: true, attempt: attempt + 1, maxAttempts, onProgress });
      return { ...retry, before };
    }
    const error = new Error(`精品剧本精修后仍未通过质量门槛：${best.review.issues.join('；')}`);
    error.code = 'BLUEPRINT_POLISH_QUALITY_FAILED';
    error.retryable = false;
    error.quality_diagnostics = { before, after: best.review };
    error.rejected_blueprint = best.blueprint;
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
  CAUSAL_STORY_CONTRACT_VERSION,
  assessCausalProgression,
  assessBlueprintQuality,
  assessBlueprintRights,
  normalizeAuthorizedBrandPresentation,
  assessDialogueNarrative,
  preferQualityCandidate,
  mergePolishedBlueprint,
  polishBlueprint,
  similarity,
};
