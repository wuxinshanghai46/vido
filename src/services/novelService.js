require('dotenv').config();
const axios = require('axios');
const OpenAI = require('openai');
const kb = require('./knowledgeBaseService');

const GENRE_LABELS = {
  fantasy: '奇幻', wuxia: '武侠', xianxia: '仙侠', scifi: '科幻',
  romance: '言情', mystery: '悬疑', horror: '恐怖', urban: '都市', historical: '历史',
  game: '游戏', realism: '现实', rebirth: '重生', crossing: '穿越', light: '轻小说'
};
const STYLE_LABELS = {
  descriptive: '细腻描写', concise: '简练干脆', literary: '文学性强',
  humorous: '幽默风趣', poetic: '诗意唯美'
};
const TYPE_LABELS = {
  flash: '短篇小说', short: '中篇小说', long: '长篇小说'
};
const TYPE_HINTS = {
  flash: '结构紧凑，人物关系清楚，一个核心转折或完整短故事',
  short: '起承转合完整，人物群像清晰，至少包含主线、阻力线和关系线',
  long: '多线叙事，人物群像丰满，世界观宏大，伏笔呼应'
};
const CULTURE_LABELS = {
  chinese: '中国语境',
  overseas: '海外语境',
  mixed: '中外混合语境'
};
const NOVEL_CHAT_TIMEOUT_MS = Math.max(5000, Number(process.env.NOVEL_CHAT_TIMEOUT_MS) || 60000);
const NOVEL_STREAM_TIMEOUT_MS = Math.max(15000, Number(process.env.NOVEL_STREAM_TIMEOUT_MS) || 90000);
const NOVEL_AUTO_ATTEMPT_LIMIT = Math.max(1, Number(process.env.NOVEL_AUTO_ATTEMPT_LIMIT) || 3);

function cultureInstruction(culturalRegion = 'chinese') {
  if (culturalRegion === 'overseas') {
    return '人物姓名、地名、社会关系和文化细节使用海外语境；可以使用英文/欧式/日韩等非中文姓名，但必须和题材匹配。';
  }
  if (culturalRegion === 'mixed') {
    return '允许中外混合设定，但必须解释人物姓名、地点和文化背景的来源，不能随机混搭。';
  }
  return '默认使用中国语境：人物姓名必须是自然中文名，地点、宗族/门派/公司/官府等社会关系也应符合中文读者习惯；除非用户明确要求海外，不要生成英文名或外国地名。';
}

function buildCompactOutlinePrompt({ title, genreLabel, styleLabel, typeLabel, chapterCount, novelType, culturalRegion, description }) {
  return {
    system: `你是专业小说架构师。只输出合法 JSON，不要 Markdown。必须忠于用户素材，不许补假设定、不许模板兜底、不许固定人物名。信息不足时写入 gaps。${cultureInstruction(culturalRegion)}`,
    user: `请基于以下素材生成小说大纲任务书。要求：
1. chapters 必须恰好 ${chapterCount} 章。
2. 每章必须有具体事件、阻力、选择、代价、情绪变化、反转/线索/回收、感官锚点、章尾钩子。
3. ${novelType === 'long' ? '长篇至少 8 个可用戏剧角色' : novelType === 'short' ? '中篇至少 5 个可用戏剧角色' : '短篇按素材需要生成角色'}；必须包含主角、反派或阻力方、盟友/关系压力、信息/转折承载者、代价/风险角色。角色必须能从素材直接推出，不能乱起名。
4. relationships 必须把整部小说中人物和剧情压力关联起来，from/to 必须对应 characters.name。
5. 必须写清 inciting_incident、core_problem、conflict_engine、stakes、escalation_path。
输出 JSON 字段：synopsis, logline, promise, inciting_incident, core_problem, conflict_engine, stakes, escalation_path, genre, theme, world{era,setting,rules,taboos,cost,tone,visual_style}, characters[], relationships[], locations[], timeline[], conflicts[], chapters[], writing_rules[], gaps[], manga_adaptation。
注意：下面的字段说明不是示例数量。chapters 数组必须实际展开 ${chapterCount} 个章节对象，index 从 1 到 ${chapterCount}；characters 至少输出目标数量的可用戏剧角色；relationships 至少覆盖主线冲突、同盟/压力、信息线和反派/阻力线。
characters 每项含 id,name,gender,role,identity,goal,motivation,conflict,weakness,personality,arc,voice,evidence。
chapters 每项含 index,title,summary,function,pov,dramatic_question,scene_goal,obstacle,choice,cost,emotional_shift,reversal,clue,payoff,sensory_anchor,characters,key_events,hook。
项目：标题=${title}；题材=${genreLabel}；风格=${styleLabel}；篇幅=${typeLabel}；文化语境=${CULTURE_LABELS[culturalRegion] || CULTURE_LABELS.chinese}
素材：
${description}`
  };
}

function sourceLength(value = '') {
  const meaningfulChars = String(value || '').match(/[0-9A-Za-z\u3400-\u9FFF\uF900-\uFAFF]/g);
  return meaningfulChars ? meaningfulChars.length : 0;
}

function ensureSufficientSource({ mode = 'idea', title = '', idea = '', sourceText = '', description = '' } = {}) {
  const body = mode === 'import' ? sourceText : `${idea}\n${description}`;
  const min = mode === 'import' ? 120 : 16;
  if (sourceLength(body) < min) {
    const error = new Error(mode === 'import'
      ? '导入内容太少，无法可靠分析世界观和大纲。请粘贴更多正文、简介或章节梗概后再生成。'
      : '小说想法太少，无法可靠生成世界观和大纲。请至少补充主角、目标、冲突、背景或一个关键事件。');
    error.status = 400;
    error.code = 'INSUFFICIENT_NOVEL_SOURCE';
    throw error;
  }
  if (mode !== 'import' && !sourceLength(idea) && !sourceLength(description) && !sourceLength(title)) {
    const error = new Error('请先输入小说想法，不能只靠空白或默认配置生成。');
    error.status = 400;
    error.code = 'INSUFFICIENT_NOVEL_SOURCE';
    throw error;
  }
}

function characterScaleRule({ novelType = 'short', chapterCount = 5, description = '', title = '' } = {}) {
  const text = `${title} ${description}`.toLowerCase();
  const hasEnsembleSignal = /群像|家族|门派|宗门|王朝|帝国|公司|集团|学校|班级|小队|团队|战争|权谋|商战|江湖|末日|基地|多线|多主角|众生相/.test(text);
  const hasSmallCastSignal = /独角戏|一个人|单人|双人|两个人|二人|密室|日记|书信|心理|内心|夫妻|情侣|父女|母女|父子|母子|师徒/.test(text);
  const isLargeByLength = Number(chapterCount) >= 20 || novelType === 'long';
  const isTinyByLength = Number(chapterCount) <= 3 || novelType === 'flash';
  const scale = hasEnsembleSignal || (isLargeByLength && !hasSmallCastSignal)
    ? 'ensemble'
    : hasSmallCastSignal || isTinyByLength
      ? 'focused'
      : 'balanced';
  const guide = {
    focused: '按故事真实需要决定人物数量：明确的独角戏、双人关系或密室心理故事可以保持小人物结构；但只要不是独角戏，也必须至少有阻力方或关系压力来源，不要为了热闹硬塞人物。',
    balanced: '按用户原始需求和核心冲突决定人物数量：中篇通常需要主角、反派/阻力方、盟友或关系压力、信息/转折人物等可用戏剧角色；缺少姓名或关系证据时写入 gaps，不要编造。',
    ensemble: '如果用户想法天然是家族、门派、公司、王朝、战争、小队或多线叙事，可以扩展为群像；长篇通常需要主角阵营、明确反派/阻力方、竞争者、盟友、信息携带者、牺牲/代价角色和势力代表。每个人都必须能从用户需求推导出叙事功能，不能凑名单。'
  };
  return { scale, text: guide[scale] || guide.balanced };
}

// 获取可用的 LLM 配置（优先 settings，回退 env）
function getNovelModelPriority(provider = {}, model = {}) {
  const text = `${provider.id || ''} ${provider.name || ''} ${provider.preset || ''} ${model.id || ''} ${model.name || ''}`.toLowerCase();
  if (/deepseek-chat|deepseek/.test(text)) return 1;
  if (/aiapi/.test(text)) return 2;
  if (/glm|zhipu|智谱/.test(text)) return 3;
  if (/gemini-2\.5-flash/.test(text)) return 4;
  if (/claude|qwen|kimi/.test(text)) return 5;
  if (/gpt[-_ ]?4|gpt4/.test(text)) return 6;
  if (/gemini/.test(text)) return 7;
  if (/gpt[-_ ]?5\.5|gpt5\.5/.test(text)) return 8;
  return 5;
}

function sortNovelModelCandidates(candidates) {
  return candidates.sort((a, b) => {
    const priority = getNovelModelPriority(a.provider, a.model) - getNovelModelPriority(b.provider, b.model);
    if (priority !== 0) return priority;
    return String(a.model.name || a.model.id || '').localeCompare(String(b.model.name || b.model.id || ''));
  });
}

function getNovelConfigs(preferredProvider) {
  try {
    const { loadSettings } = require('./settingsService');
    const settings = loadSettings();
    const candidates = [];
    for (const provider of settings.providers) {
      if (!provider.enabled || !provider.api_key) continue;
      if (preferredProvider && provider.id !== preferredProvider) continue;
      for (const model of (provider.models || [])) {
        if (model.enabled !== false && model.use === 'story') {
          candidates.push({ provider, model });
        }
      }
    }
    const selectedModels = sortNovelModelCandidates(candidates);
    if (selectedModels.length) {
      return selectedModels.map(selected => ({
        apiKey: selected.provider.api_key,
        baseURL: selected.provider.api_url,
        model: selected.model.id,
        providerId: selected.provider.id,
        providerName: selected.provider.name || selected.provider.id,
        modelName: selected.model.name || selected.model.id,
        channel: selected.model.channel || ''
      }));
    }
    // 未指定 provider 时，按小说模型优先级取任何 story model
    if (preferredProvider) {
      const fallbackCandidates = [];
      for (const provider of settings.providers) {
        if (!provider.enabled || !provider.api_key) continue;
        for (const model of (provider.models || [])) {
          if (model.enabled !== false && model.use === 'story') {
            fallbackCandidates.push({ provider, model });
          }
        }
      }
      const fallback = sortNovelModelCandidates(fallbackCandidates)[0];
      if (fallback) {
        return [{
          apiKey: fallback.provider.api_key,
          baseURL: fallback.provider.api_url,
          model: fallback.model.id,
          providerId: fallback.provider.id,
          providerName: fallback.provider.name || fallback.provider.id,
          modelName: fallback.model.name || fallback.model.id,
          channel: fallback.model.channel || ''
        }];
      }
    }
  } catch {}
  // Fallback env
  const envConfigs = [];
  if ((!preferredProvider || preferredProvider === 'deepseek') && process.env.DEEPSEEK_API_KEY) {
    envConfigs.push({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat', providerId: 'deepseek', providerName: 'DeepSeek', modelName: 'DeepSeek Chat' });
  }
  if ((!preferredProvider || preferredProvider === 'openai') && process.env.OPENAI_API_KEY) {
    envConfigs.push({ apiKey: process.env.OPENAI_API_KEY, baseURL: null, model: 'gpt-4o', providerId: 'openai', providerName: 'OpenAI', modelName: 'GPT-4o' });
  }
  return envConfigs;
}

function getNovelConfig(preferredProvider) {
  return getNovelConfigs(preferredProvider)[0] || null;
}

function isDeyunaiConfig(config = {}) {
  return config.providerId === 'deyunai' || /deyunai|漫路/i.test(`${config.providerId || ''} ${config.providerName || ''}`);
}

function isDeyunaiOverseasModel(config = {}) {
  const model = String(config.model || '').toLowerCase();
  return isDeyunaiConfig(config) && (
    config.channel === 'overseas'
    || /^gpt-|^o[1-9]|^claude-|^gemini-(?!3\.1-flash-lite-preview)|^grok-/i.test(model)
  );
}

function normaliseCompletion(completion) {
  if (typeof completion === 'string') {
    try { return JSON.parse(completion); } catch { return completion; }
  }
  return completion;
}

function completionText(completion) {
  const parsed = normaliseCompletion(completion);
  const message = parsed?.choices?.[0]?.message || {};
  return cleanString(message.content || message.reasoning_content || parsed?.choices?.[0]?.text || '');
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label}超时（${Math.round(timeoutMs / 1000)}秒）`);
      error.code = 'NOVEL_MODEL_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// 获取所有可用于小说生成的模型列表
function getAvailableModels() {
  const models = [];
  try {
    const { loadSettings } = require('./settingsService');
    const settings = loadSettings();
    for (const provider of settings.providers) {
      if (!provider.enabled || !provider.api_key) continue;
      for (const model of (provider.models || [])) {
        if (model.enabled === false) continue;
        if (model.use === 'story') {
          models.push({ providerId: provider.id, providerName: provider.name || provider.id, modelId: model.id, modelName: model.name || model.id });
        }
      }
    }
  } catch {}
  // env fallbacks
  if (process.env.DEEPSEEK_API_KEY && !models.find(m => m.providerId === 'deepseek')) {
    models.push({ providerId: 'deepseek', providerName: 'DeepSeek', modelId: 'deepseek-chat', modelName: 'DeepSeek Chat' });
  }
  if (process.env.OPENAI_API_KEY && !models.find(m => m.providerId === 'openai')) {
    models.push({ providerId: 'openai', providerName: 'OpenAI', modelId: 'gpt-4o', modelName: 'GPT-4o' });
  }
  return models.sort((a, b) => {
    const pa = getNovelModelPriority({ id: a.providerId, name: a.providerName }, { id: a.modelId, name: a.modelName });
    const pb = getNovelModelPriority({ id: b.providerId, name: b.providerName }, { id: b.modelId, name: b.modelName });
    if (pa !== pb) return pa - pb;
    return String(a.modelName || a.modelId || '').localeCompare(String(b.modelName || b.modelId || ''));
  });
}

function createClient(config, timeoutMs = NOVEL_CHAT_TIMEOUT_MS) {
  const opts = { apiKey: config.apiKey, timeout: timeoutMs };
  if (config.baseURL) {
    opts.baseURL = config.baseURL;
    if (isDeyunaiOverseasModel(config) && !opts.baseURL.includes('/c35/')) {
      opts.baseURL = opts.baseURL.replace(/\/v1\/?$/, '/c35/v1');
      opts.defaultHeaders = { ...(opts.defaultHeaders || {}), vendor: 'API_VENDOR' };
    }
  }
  return new OpenAI(opts);
}

function buildCompletionEndpoint(config) {
  let baseURL = config.baseURL || 'https://api.openai.com/v1';
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json'
  };
  if (isDeyunaiOverseasModel(config) && !baseURL.includes('/c35/')) {
    baseURL = baseURL.replace(/\/v1\/?$/, '/c35/v1');
    headers.vendor = 'API_VENDOR';
  }
  return {
    url: `${baseURL.replace(/\/$/, '')}/chat/completions`,
    headers
  };
}

async function createChatCompletionHttp(config, { messages, max_tokens }) {
  const endpoint = buildCompletionEndpoint(config);
  const payload = {
    model: config.model,
    max_tokens,
    messages
  };
  if (/deepseek|openai|aiapi|zhipu/i.test(`${config.providerId || ''} ${config.baseURL || ''}`)) {
    payload.response_format = { type: 'json_object' };
  }
  const response = await axios.post(endpoint.url, payload, {
    headers: endpoint.headers,
    timeout: NOVEL_CHAT_TIMEOUT_MS,
    validateStatus: () => true
  });
  if (response.status < 200 || response.status >= 300) {
    const body = response.data ? JSON.stringify(response.data).slice(0, 300) : 'no body';
    const error = new Error(`${response.status} status code (${body})`);
    error.status = response.status;
    throw error;
  }
  return normaliseCompletion(response.data);
}

function parseModelJson(text, label = 'AI 返回') {
  const jsonMatch = String(text || '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`${label}格式异常：没有 JSON 对象`);
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    throw new Error(`${label}JSON 解析失败：${error.message}`);
  }
}

function extractJsonObjectText(text, label = 'AI 返回') {
  const jsonMatch = String(text || '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`${label}格式异常：没有 JSON 对象`);
  return jsonMatch[0];
}

async function parseModelJsonWithRepair({ text, label = 'AI 返回', provider, stage = 'JSON 结构修复' }) {
  const jsonText = extractJsonObjectText(text, label);
  try {
    return JSON.parse(jsonText);
  } catch (parseError) {
    const result = await createChatCompletionWithAttempts({
      preferredProvider: provider,
      stage,
      max_tokens: Math.min(12000, Math.max(3000, Math.ceil(jsonText.length * 1.4))),
      messages: [
        {
          role: 'system',
          content: 'You repair malformed JSON syntax only. Output legal JSON only. Do not add, delete, invent, summarize, translate, rename, or reinterpret any story content. Preserve all strings and fields as much as possible. If a fragment is impossible to recover syntactically, keep the closest original string value rather than inventing content.'
        },
        {
          role: 'user',
          content: `The following model output failed JSON.parse with this error:\n${parseError.message}\n\nRepair JSON syntax only. Do not change the story facts or fill missing story content.\n\nMalformed JSON:\n${jsonText}`
        }
      ]
    });
    return parseModelJson(completionText(result.completion), `${label}结构修复返回`);
  }
}

function selectAutoNovelCandidates(configs) {
  const picked = [];
  const seen = new Set();
  for (const config of configs) {
    if (picked.length >= NOVEL_AUTO_ATTEMPT_LIMIT) break;
    if (/reasoner|(^|[-_])r1($|[-_])|deepseek-r1/i.test(`${config.model} ${config.modelName || ''}`)) continue;
    const key = `${config.providerId}/${config.model}`;
    if (!seen.has(key)) {
      picked.push(config);
      seen.add(key);
    }
  }
  return picked.slice(0, NOVEL_AUTO_ATTEMPT_LIMIT);
}

async function createChatCompletionWithAttempts({ preferredProvider, messages, max_tokens, stage = '小说生成' }) {
  const configs = getNovelConfigs(preferredProvider);
  if (!configs.length) throw new Error('未配置 AI 供应商');
  const attempts = [];
  const candidateConfigs = (preferredProvider ? configs : selectAutoNovelCandidates(configs)).slice(0, NOVEL_AUTO_ATTEMPT_LIMIT);
  for (const config of candidateConfigs) {
    const attempt = {
      provider_id: config.providerId,
      provider_name: config.providerName,
      model_id: config.model,
      model_name: config.modelName,
      ok: false
    };
    try {
      const completion = await createChatCompletionHttp(config, { messages, max_tokens });
      attempt.ok = true;
      attempts.push(attempt);
      return { completion, config, attempts };
    } catch (error) {
      attempt.status = error.status || error.code || null;
      attempt.error = error.message;
      attempts.push(attempt);
      if (preferredProvider) break;
    }
  }
  const summary = attempts.map(a => `${a.provider_id}/${a.model_id}: ${a.error || 'failed'}`).join('；');
  const error = new Error(`${stage}失败：${summary}`);
  error.attempts = attempts;
  throw error;
}

async function createStreamingCompletionWithAttempts({ preferredProvider, messages, max_tokens, stage = '小说生成', onChunk }) {
  const configs = getNovelConfigs(preferredProvider);
  if (!configs.length) throw new Error('未配置 AI 供应商');
  const attempts = [];
  const candidateConfigs = (preferredProvider ? configs : selectAutoNovelCandidates(configs)).slice(0, NOVEL_AUTO_ATTEMPT_LIMIT);
  for (const config of candidateConfigs) {
    const attempt = {
      provider_id: config.providerId,
      provider_name: config.providerName,
      model_id: config.model,
      model_name: config.modelName,
      ok: false
    };
    try {
      const client = createClient(config, NOVEL_STREAM_TIMEOUT_MS);
      const stream = await withTimeout(client.chat.completions.create({
        model: config.model,
        max_tokens,
        stream: true,
        messages
      }), NOVEL_STREAM_TIMEOUT_MS, `${config.providerId}/${config.model}`);
      const chunks = [];
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) chunks.push(delta);
      }
      const text = chunks.join('');
      if (!text.trim()) throw new Error('模型未返回正文内容');
      attempt.ok = true;
      attempts.push(attempt);
      chunks.forEach(chunk => onChunk?.(chunk));
      return { text, config, attempts };
    } catch (error) {
      attempt.status = error.status || error.code || null;
      attempt.error = error.message;
      attempts.push(attempt);
      if (preferredProvider) break;
    }
  }
  const summary = attempts.map(a => `${a.provider_id}/${a.model_id}: ${a.error || 'failed'}`).join('；');
  const error = new Error(`${stage}失败：${summary}`);
  error.attempts = attempts;
  throw error;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildNovelKbContext(stage = 'novel', opts = {}) {
  try {
    return kb.buildAgentContext('screenwriter', {
      genre: [
        stage,
        opts.genre,
        opts.novelType,
        'novel',
        'medium novel',
        'chapter taskbook',
        'scene writing',
        'dialogue',
        'reversal',
        'continuity'
      ].filter(Boolean).join(' '),
      maxDocs: opts.maxDocs || 10,
      maxCharsPerDoc: opts.maxCharsPerDoc || 900
    });
  } catch {
    return '';
  }
}

const NOVEL_SOURCE_FIDELITY_RULES = `Novel source fidelity rules:
1. Do not invent missing people, names, relationships, powers, world rules, endings, or causes just to complete a schema.
2. If the source only says "female lead", "reborn person", "landlord", or another stable role label, use that exact label as a temporary identifier and mark the gap. Never replace it with a random name.
3. If there is not enough evidence for a character, relationship, location, motivation, or fact, leave it empty or mark it as a gap. No hardcoded placeholders, no template fallback, no fake completeness.
4. Every added detail must be traceable to user material, saved outline, existing chapter text, or a direct and necessary inference from them.
5. Missing information is a product signal, not a license to fabricate.`;

const NOVEL_FULL_PIPELINE_QUALITY_GATE = `Professional novel quality gate for every stage:
1. This must read as fiction, not a progress report. Use scenes, choices, pressure, dialogue subtext, sensory anchors, and consequences.
2. Characters need external goals, inner motives, weak spots, distinct voices, and changing relationships. Do not treat them as labels.
3. Worldbuilding must create pressure: rules, taboos, cost, scarcity, institutions, danger, and boundaries that affect choices.
4. Each chapter needs a taskbook: scene goal, obstacle, active choice, cost, emotional shift, reveal or reversal, clue/payoff, sensory anchor, and hook.
5. Maintain point of view discipline. Do not use omniscient jumps or let characters know facts they could not know.
6. Dialogue must carry conflict or concealment. Avoid empty exchanges, generic agreement, and explanatory Q&A.
7. Review, refinement, and fact extraction must enforce the same standard instead of merely rephrasing text.`;

function chapterTaskbookText(chapter = {}) {
  const rows = [
    ['Scene goal', chapter.scene_goal],
    ['Obstacle', chapter.obstacle],
    ['Emotional shift', chapter.emotional_shift],
    ['Reversal or reveal', chapter.reversal],
    ['Clue', chapter.clue],
    ['Payoff', chapter.payoff],
    ['Sensory anchor', chapter.sensory_anchor],
    ['Hook', chapter.hook],
    ['POV', chapter.pov],
    ['Key events', asArray(chapter.key_events).join(' / ')],
    ['Characters', asArray(chapter.characters).join(' / ')]
  ];
  return rows
    .map(([label, value]) => [label, cleanString(value)].filter(Boolean).join(': '))
    .filter(line => line.includes(': '))
    .join('\n');
}

function characterRoleText(character = {}) {
  return [
    character.name,
    character.role,
    character.identity,
    character.goal,
    character.motivation,
    character.conflict,
    character.arc,
    character.evidence
  ].map(cleanString).filter(Boolean).join(' ');
}

function hasCharacterRole(characters = [], pattern) {
  return asArray(characters).some(character => pattern.test(characterRoleText(character)));
}

function isPlaceholderLabel(value) {
  const text = cleanString(value);
  if (!text) return true;
  return /^(角色名|角色[abcABC一二三四五六七八九十0-9]*|地点名|场景[一二三四五六七八九十0-9]*|未命名|主角|配角|反派|character|location|scene)$/i.test(text);
}

function normalizeGender(value = '') {
  const text = cleanString(value).toLowerCase();
  if (/^(female|woman|girl|f)$/.test(text) || /女|女性|少女|姑娘|母亲|姐姐|妹妹|妻|皇后|公主/.test(text)) return 'female';
  if (/^(male|man|boy|m)$/.test(text) || /男|男性|少年|父亲|哥哥|弟弟|丈夫|皇帝|王子/.test(text)) return 'male';
  return '';
}

function normalizeNovelOutline(raw = {}, novel = {}) {
  const chapterSource = raw.chapters || raw.chapter_blueprint || raw.chapter_plan || raw.chapter_outline || raw.chapter_outlines || raw.chapter_tasks || raw.episodes;
  const chapters = asList(chapterSource).map((chapter, index) => ({
    index: Number(chapter.index) || index + 1,
    title: cleanString(chapter.title) || `Chapter ${index + 1}`,
    summary: cleanString(chapter.summary),
    function: cleanString(chapter.function),
    pov: cleanString(chapter.pov),
    dramatic_question: cleanString(chapter.dramatic_question),
    scene_goal: cleanString(chapter.scene_goal),
    obstacle: cleanString(chapter.obstacle),
    choice: cleanString(chapter.choice),
    cost: cleanString(chapter.cost),
    emotional_shift: cleanString(chapter.emotional_shift),
    reversal: cleanString(chapter.reversal),
    clue: cleanString(chapter.clue),
    payoff: cleanString(chapter.payoff),
    sensory_anchor: cleanString(chapter.sensory_anchor),
    hook: cleanString(chapter.hook),
    characters: asArray(chapter.characters).map(cleanString).filter(Boolean),
    key_events: asArray(chapter.key_events).map(cleanString).filter(Boolean)
  }));

  const characters = asArray(raw.characters).map((character, index) => {
    const name = cleanString(character.name);
    return {
      id: cleanString(character.id) || (name ? `char_${index + 1}` : ''),
      name,
      role: cleanString(character.role),
      gender: normalizeGender(character.gender || character.sex || character.gender_presentation),
      identity: cleanString(character.identity),
      goal: cleanString(character.goal),
      motivation: cleanString(character.motivation),
      conflict: cleanString(character.conflict),
      weakness: cleanString(character.weakness),
      personality: cleanString(character.personality),
      arc: cleanString(character.arc),
      voice: cleanString(character.voice),
      evidence: cleanString(character.evidence)
    };
  }).filter(character => character.name && !isPlaceholderLabel(character.name));

  const relationships = asArray(raw.relationships).map((relationship, index) => ({
    id: cleanString(relationship.id) || `rel_${index + 1}`,
    from: cleanString(relationship.from),
    to: cleanString(relationship.to),
    type: cleanString(relationship.type),
    description: cleanString(relationship.description),
    tension: cleanString(relationship.tension),
    evidence: cleanString(relationship.evidence)
  })).filter(item => item.from && item.to && !isPlaceholderLabel(item.from) && !isPlaceholderLabel(item.to));

  const locations = asArray(raw.locations).map((location, index) => {
    const name = cleanString(location.name);
    return {
      id: cleanString(location.id) || (name ? `loc_${index + 1}` : ''),
      name,
      type: cleanString(location.type),
      description: cleanString(location.description),
      visual_keywords: asArray(location.visual_keywords).map(cleanString).filter(Boolean)
    };
  }).filter(location => (location.name && !isPlaceholderLabel(location.name)) || location.description);

  const timeline = asArray(raw.timeline).map((event, index) => ({
    order: Number(event.order) || index + 1,
    chapter: Number(event.chapter) || null,
    event: cleanString(event.event),
    impact: cleanString(event.impact)
  })).filter(item => item.event);

  const conflicts = asArray(raw.conflicts).map((conflict, index) => ({
    id: cleanString(conflict.id) || `conflict_${index + 1}`,
    type: cleanString(conflict.type),
    description: cleanString(conflict.description),
    stakes: cleanString(conflict.stakes)
  })).filter(item => item.description || item.stakes);

  const world = raw.world && typeof raw.world === 'object' ? raw.world : {};
  const mangaAdaptation = raw.manga_adaptation && typeof raw.manga_adaptation === 'object' ? raw.manga_adaptation : {};

  const gaps = asArray(raw.gaps).map(cleanString).filter(Boolean).slice(0, 20);

  return {
    synopsis: cleanString(raw.synopsis),
    logline: cleanString(raw.logline),
    promise: cleanString(raw.promise || raw.story_promise || raw.work_promise),
    inciting_incident: cleanString(raw.inciting_incident || raw.cause || raw.trigger),
    core_problem: cleanString(raw.core_problem || raw.central_problem),
    conflict_engine: cleanString(raw.conflict_engine),
    stakes: cleanString(raw.stakes),
    escalation_path: cleanString(raw.escalation_path),
    genre: cleanString(raw.genre) || cleanString(novel.genre),
    theme: cleanString(raw.theme),
    world: {
      era: cleanString(world.era),
      setting: cleanString(world.setting),
      rules: cleanString(world.rules),
      taboos: cleanString(world.taboos),
      cost: cleanString(world.cost),
      tone: cleanString(world.tone),
      visual_style: cleanString(world.visual_style)
    },
    writing_rules: asArray(raw.writing_rules).map(cleanString).filter(Boolean).slice(0, 30),
    gaps,
    characters,
    relationships,
    locations,
    timeline,
    conflicts,
    chapters,
    manga_adaptation: {
      core_visuals: asArray(mangaAdaptation.core_visuals).map(cleanString).filter(Boolean),
      recurring_symbols: asArray(mangaAdaptation.recurring_symbols).map(cleanString).filter(Boolean),
      episode_suggestion: cleanString(mangaAdaptation.episode_suggestion)
    }
  };
}

function normalizeNovelSeedPlan(raw = {}, input = {}) {
  const type = ['flash', 'short', 'long'].includes(cleanString(raw.novel_type)) ? cleanString(raw.novel_type) : (input.novelType || 'short');
  const genre = cleanString(raw.genre) || cleanString(input.genre);
  const chapterCount = Number(raw.chapter_count) || Number(input.chapterCount) || (type === 'long' ? 20 : type === 'flash' ? 1 : 5);
  const chapterWords = Number(raw.chapter_words) || Number(input.chapterWords) || (type === 'long' ? 3000 : type === 'flash' ? 1500 : 2000);
  return {
    title: cleanString(raw.title) || cleanString(input.title) || cleanString(input.idea).slice(0, 18),
    genre,
    subtype: cleanString(raw.subtype) || cleanString(input.subtype),
    channel: cleanString(raw.channel) || cleanString(input.channel),
    style: cleanString(raw.style) || cleanString(input.style) || 'descriptive',
    cultural_region: ['chinese', 'overseas', 'mixed'].includes(cleanString(raw.cultural_region)) ? cleanString(raw.cultural_region) : (input.culturalRegion || 'chinese'),
    novel_type: type,
    chapter_count: Math.max(1, Math.min(200, chapterCount)),
    chapter_words: Math.max(300, Math.min(10000, chapterWords)),
    logline: cleanString(raw.logline),
    description: cleanString(raw.description || raw.worldview || raw.synopsis) || cleanString(input.idea || input.sourceText).slice(0, 1200),
    audience: cleanString(raw.audience),
    core_conflict: cleanString(raw.core_conflict),
    long_goal: cleanString(raw.long_goal),
    continuity_rules: cleanString(raw.continuity_rules),
    source_summary: cleanString(raw.source_summary),
    imported_status: cleanString(raw.imported_status),
    tags: asArray(raw.tags).map(cleanString).filter(Boolean).slice(0, 12),
    gaps: asArray(raw.gaps).map(cleanString).filter(Boolean).slice(0, 20),
    next_steps: asArray(raw.next_steps).map(cleanString).filter(Boolean).slice(0, 12)
  };
}

function outlineQualityIssues(outline = {}, { novelType = 'short', chapterCount = 0 } = {}) {
  const issues = [];
  const chapters = asArray(outline.chapters);
  const characters = asArray(outline.characters);
  const conflicts = asArray(outline.conflicts);
  const gaps = asArray(outline.gaps).join('\n');
  if (Number(chapterCount) > 0 && chapters.length !== Number(chapterCount)) {
    issues.push(`Chapter count mismatch. Expected exactly ${Number(chapterCount)} chapters, got ${chapters.length}.`);
  }
  const singleCharacterAllowed = /single[- ]character|solo|one person|独角戏|单人|一个人/.test(`${outline.promise || ''}\n${outline.synopsis || ''}\n${gaps}`.toLowerCase());
  const expectedCharacters = novelType === 'long'
    ? 8
    : novelType === 'short'
      ? 5
      : 2;
  if (!singleCharacterAllowed && novelType !== 'flash' && Number(chapterCount || chapters.length) >= 4 && characters.length < 2) {
    issues.push('The dossier has fewer than two usable dramatic roles. Add only source-supported or directly inferred roles that create pressure, help, opposition, information, or relationship tension; if unsupported, write the missing role evidence into gaps.');
  }
  if (!singleCharacterAllowed && novelType !== 'flash' && Number(chapterCount || chapters.length) >= 4 && characters.length < expectedCharacters) {
    issues.push(`The character network is too small for this length. Target at least ${expectedCharacters} evidence-backed dramatic roles for ${novelType}: protagonist, antagonist/opposition force, ally or relationship pressure, information/turn carrier, and cost/stakes role. Use stable role labels when names are unsupported; put naming gaps in gaps.`);
  }
  if (!singleCharacterAllowed && novelType !== 'flash' && !hasCharacterRole(characters, /反派|敌|阻力|对手|竞争|威胁| antagonist|opponent|rival|pressure|obstacle/i)) {
    issues.push('Missing antagonist or opposition role. A medium/long novel needs a visible person, faction, institution, environment, or relationship force that repeatedly pressures the protagonist. Do not fake a villain name; infer only a supported opposition role or write the gap.');
  }
  if (!singleCharacterAllowed && novelType === 'long' && !hasCharacterRole(characters, /盟友|同伴|伙伴|帮手|关系压力|亲人|朋友|ally|companion|support|relationship/i)) {
    issues.push('Missing ally/relationship-pressure role for a long novel. Add a supported role that complicates or supports the protagonist, or record the missing evidence in gaps.');
  }
  if (!singleCharacterAllowed && novelType !== 'flash' && !hasCharacterRole(characters, /线索|信息|秘密|转折|知情|见证|messenger|informant|witness|reveal|information/i)) {
    issues.push('Missing information or turn-carrier role. Add a supported role that reveals, hides, controls, or distorts key information, or record the missing evidence in gaps.');
  }
  if (!cleanString(outline.inciting_incident)) issues.push('Missing inciting incident: explain what event forces the story to start now.');
  if (!cleanString(outline.core_problem)) issues.push('Missing core problem: define the concrete unresolved problem readers track.');
  if (!cleanString(outline.conflict_engine)) issues.push('Missing conflict engine: define who/what keeps producing conflict and why it cannot be solved immediately.');
  if (!cleanString(outline.stakes)) issues.push('Missing stakes: define what is lost if the protagonist fails.');
  if (conflicts.length < 2) issues.push('Conflict list is too thin. Include external, internal, relationship, or world-rule conflicts with specific stakes, only when supported by source or direct inference.');
  chapters.forEach(chapter => {
    const missing = [];
    if (!cleanString(chapter.dramatic_question)) missing.push('dramatic_question');
    if (!cleanString(chapter.obstacle)) missing.push('obstacle');
    if (!cleanString(chapter.choice)) missing.push('choice');
    if (!cleanString(chapter.cost)) missing.push('cost');
    if (!cleanString(chapter.hook)) missing.push('hook');
    if (missing.length) issues.push(`Chapter ${chapter.index || '?'} is missing ${missing.join(', ')}.`);
  });
  const blandSummaryCount = chapters.filter(chapter => /开始|逐渐|深入|展开|准备|调查|面对|揭开|发现/.test(cleanString(chapter.summary)) && cleanString(chapter.summary).length < 90).length;
  if (blandSummaryCount >= Math.max(2, Math.ceil(chapters.length / 3))) {
    issues.push('Too many chapter summaries read like report-like event labels. Rewrite them as concrete scene tasks with cause, pressure, choice, cost, and turn.');
  }
  return issues.slice(0, 12);
}

async function repairOutlineQuality({ outline, issues, title, genre, style, chapterCount, description, provider, novelType, culturalRegion, kbContext }) {
  if (!issues.length) return outline;
  const result = await createChatCompletionWithAttempts({
    preferredProvider: provider,
    stage: '修复小说大纲质量',
    max_tokens: 5000,
    messages: [
      {
        role: 'system',
        content: `You are a senior novel story editor. Repair the outline quality without fabricating unsupported facts. Output legal JSON only. ${cultureInstruction(culturalRegion)}`
      },
      kbContext ? { role: 'system', content: kbContext } : null,
      { role: 'user', content: NOVEL_SOURCE_FIDELITY_RULES },
      { role: 'user', content: NOVEL_FULL_PIPELINE_QUALITY_GATE },
      {
        role: 'user',
        content: `The previous outline is too weak. Repair it using the same user source and the same no-fallback rules.

Quality issues:
${issues.map((item, index) => `${index + 1}. ${item}`).join('\n')}

Required additions:
- inciting_incident: the event that starts the story now
- core_problem: the concrete unresolved problem
- conflict_engine: the recurring source of pressure
- stakes: what is lost on failure
- escalation_path: how pressure rises chapter by chapter
- at least two usable dramatic roles for a medium/long story unless the source is explicitly a solo story
- medium stories should normally include at least five evidence-backed dramatic roles; long stories should normally include at least eight. Required functions: protagonist, antagonist/opposition force, ally or relationship pressure, information/turn carrier, and cost/stakes role
- antagonist/opposition can be a person, faction, institution, environment, or relationship force, but it must be visible in the outline and repeatedly generate pressure
- every chapter must include dramatic_question, obstacle, choice, cost, emotional_shift, reversal/clue/payoff, sensory_anchor, hook

Do not add fake names or fake relationships. If a role is directly inferred but unnamed, use the stable role label from source or function, such as "避难所掌控者", "物资竞争者", "传递末世线索的人", and put the naming gap into gaps. Do not use generic placeholders like Character A or unnamed villain.

Project:
Title: ${title}
Genre: ${genre}
Style: ${style}
Chapters: ${chapterCount}
Novel type: ${novelType}
Source and saved dossier:
${description}

Previous outline JSON:
${JSON.stringify(outline)}`
      }
    ].filter(Boolean)
  });
  const repairedJson = await parseModelJsonWithRepair({
    text: completionText(result.completion),
    label: '大纲质量修复 Agent 返回',
    provider,
    stage: '修复大纲质量返回 JSON'
  });
  const repaired = normalizeNovelOutline(repairedJson, { title, genre, style, chapterCount, description, novelType, culturalRegion });
  repaired._meta = {
    provider_id: result.config.providerId,
    model_id: result.config.model,
    provider_name: result.config.providerName,
    model_name: result.config.modelName,
    attempts: result.attempts
  };
  return repaired;
}

async function completeOutlineChapters({ outline, title, genre, style, chapterCount, description, provider, novelType, culturalRegion }) {
  const result = await createChatCompletionWithAttempts({
    preferredProvider: provider,
    stage: '补齐小说章节任务书',
    max_tokens: Math.min(6000, Math.max(2600, Number(chapterCount || 1) * 520)),
    messages: [
      {
        role: 'system',
        content: `你是小说章节架构师。只输出合法 JSON，不要 Markdown。必须忠于素材，不许兜底、不许乱编、不许固定模板。${cultureInstruction(culturalRegion)}`
      },
      {
        role: 'user',
        content: `请只补齐 chapters 数组，必须恰好 ${chapterCount} 章，index 从 1 到 ${chapterCount}。每章都要是可直接交给作者开写的任务书，不能流水账。
每章字段必须包含：index,title,summary,function,pov,dramatic_question,scene_goal,obstacle,choice,cost,emotional_shift,reversal,clue,payoff,sensory_anchor,characters,key_events,hook。
每章 summary 写具体事件、压力、选择、代价和变化。章节之间必须有因果递进。

项目标题：${title}
题材：${genre}
风格：${style}
篇幅：${novelType}
素材：${description}
已有人物：${JSON.stringify(asArray(outline.characters).map(c => ({ name: c.name, role: c.role, goal: c.goal, conflict: c.conflict })).slice(0, 12))}
已有冲突：${JSON.stringify(asArray(outline.conflicts).slice(0, 8))}
已有大纲摘要：${JSON.stringify({ synopsis: outline.synopsis, inciting_incident: outline.inciting_incident, core_problem: outline.core_problem, conflict_engine: outline.conflict_engine, stakes: outline.stakes, escalation_path: outline.escalation_path })}

输出格式：
{ "chapters": [ ...恰好 ${chapterCount} 个章节对象... ] }`
      }
    ]
  });
  const json = await parseModelJsonWithRepair({
    text: completionText(result.completion),
    label: '章节补齐 Agent 返回',
    provider,
    stage: '修复章节补齐 JSON'
  });
  const completed = normalizeNovelOutline({ ...outline, chapters: json.chapters }, { title, genre, style, chapterCount, description, novelType, culturalRegion });
  if (asArray(completed.chapters).length < Number(chapterCount)) {
    const existing = asArray(completed.chapters);
    const missingIndexes = [];
    for (let i = 1; i <= Number(chapterCount); i += 1) {
      if (!existing.some(chapter => Number(chapter.index) === i)) missingIndexes.push(i);
    }
    const fillResult = await createChatCompletionWithAttempts({
      preferredProvider: provider,
      stage: '补齐缺失章节',
      max_tokens: Math.min(5000, Math.max(1800, missingIndexes.length * 650)),
      messages: [
        { role: 'system', content: `你是小说章节架构师。只输出合法 JSON，不要 Markdown。必须忠于素材，不许兜底、不许乱编。${cultureInstruction(culturalRegion)}` },
        {
          role: 'user',
          content: `已有章节数量不足。请只输出缺失章节，不能重写已有章节。
缺失章节 index：${missingIndexes.join(', ')}
每个章节必须包含 index,title,summary,function,pov,dramatic_question,scene_goal,obstacle,choice,cost,emotional_shift,reversal,clue,payoff,sensory_anchor,characters,key_events,hook。
项目标题：${title}
素材：${description}
已有章节：${JSON.stringify(existing.map(ch => ({ index: ch.index, title: ch.title, summary: ch.summary, hook: ch.hook })))}
已有角色：${JSON.stringify(asArray(outline.characters).map(c => ({ name: c.name, role: c.role })).slice(0, 12))}
输出格式：{ "chapters": [ ...只包含缺失章节... ] }`
        }
      ]
    });
    const fillJson = await parseModelJsonWithRepair({
      text: completionText(fillResult.completion),
      label: '缺失章节补齐 Agent 返回',
      provider,
      stage: '修复缺失章节 JSON'
    });
    const merged = [...existing, ...asArray(fillJson.chapters)]
      .sort((a, b) => Number(a.index) - Number(b.index));
    const normalizedMerged = normalizeNovelOutline({ ...outline, chapters: merged }, { title, genre, style, chapterCount, description, novelType, culturalRegion });
    completed.chapters = normalizedMerged.chapters;
    completed._fill_meta = {
      provider_id: fillResult.config.providerId,
      model_id: fillResult.config.model,
      provider_name: fillResult.config.providerName,
      model_name: fillResult.config.modelName,
      attempts: fillResult.attempts
    };
  }
  completed._meta = {
    provider_id: result.config.providerId,
    model_id: result.config.model,
    provider_name: result.config.providerName,
    model_name: result.config.modelName,
    attempts: result.attempts
  };
  return completed;
}

async function analyzeNovelSeed({ mode = 'idea', idea = '', sourceText = '', title = '', genre = '', subtype = '', channel = '', novelType = 'short', chapterCount = 5, chapterWords = 2000, style = 'descriptive', culturalRegion = 'chinese', provider }) {
  const inputText = mode === 'import'
    ? String(sourceText || '').slice(0, 18000)
    : String(idea || '').slice(0, 6000);
  if (!inputText.trim()) throw new Error(mode === 'import' ? '请上传或粘贴已有作品内容' : '请先输入小说想法');
  ensureSufficientSource({ mode, idea, sourceText, title });
  const kbContext = buildNovelKbContext('novel project initialization and story promise', {
    genre: [genre, subtype, channel].filter(Boolean).join(' '),
    novelType
  });

  const craftPrompt = `长篇小说创作质量红线（必须执行，写入 writing_rules 并体现在所有字段里）：
1. 先像资深小说作者一样回看人设、世界观、剧情承诺和用户要求，再生成；严禁 OOC、无动机行为、无依据补设定、机械流水账。
2. 作品必须有清晰“作品承诺”：读者为什么继续看、主角长期目标是什么、冲突升级路径是什么、最终爽点/情感兑现方向是什么。
3. 世界观不能只写背景介绍，必须包含主要舞台、运行规则、禁区/代价/边界、会制造冲突的机制，以及不可写崩规则。
4. 人物不是名单：每个主要人物必须有 gender、具体叙事身份、外在目标、内在动机、弱点/误判、人物弧光、说话方式，并能服务章节或关系。
5. 关系网不是装饰：relationships 必须写出 from/to/type/tension/evidence，只有可以从大纲或用户材料直接推导的关系才能出现。
6. 章节大纲不能像流水账。每章都要包含事件、人物情绪变化、冲突推进、伏笔或回收、章尾钩子；章节之间必须有因果链。
7. 禁止上帝视角乱跳、角色无理由知晓信息、短时间频繁切视角；单章单场景尽量固定核心感官和心理线。
8. 正文写作必须 show don't tell：通过动作、对话、场景细节和心理活动表现情绪，不写问答式流水账，不写泛泛总结。
9. 对话要有角色声口和潜台词，禁止“嗯、哦、好、是”等无效敷衍回复堆叠。
10. 如果输入不足以写出真正小说档案，必须返回 gaps，不要用模板内容凑完整。`;

  const result = await createChatCompletionWithAttempts({
    preferredProvider: provider,
    stage: mode === 'import' ? '分析导入作品' : '分析创作想法',
    max_tokens: 3500,
    messages: [
      {
        role: 'system',
        content: `你是长篇网文项目初始化 Agent。你的任务是深度理解用户给出的真实需求，生成可保存的小说项目初始化方案。只输出合法 JSON，不要 Markdown。严禁写死模板，严禁把用户没有提供或文本无法推出的设定当成事实，严禁为了显得完整而乱补世界观、人物、动机、结局。缺失项保持为空字符串或空数组，并在 gaps 里明确列出需要用户确认的问题。${cultureInstruction(culturalRegion)}`
      },
      {
        role: 'user',
        content: craftPrompt
      },
      kbContext ? { role: 'system', content: kbContext } : null,
      { role: 'user', content: NOVEL_SOURCE_FIDELITY_RULES },
      { role: 'user', content: NOVEL_FULL_PIPELINE_QUALITY_GATE },
      {
        role: 'user',
        content: `模式：${mode === 'import' ? '导入已有作品并分析补充' : '从想法生成小说项目'}
用户预设：
- 标题：${title || '未填写，需 AI 拟定'}
- 题材：${genre || '自动判断'}
- 细分类型：${subtype || '自动判断'}
- 读者方向：${channel || '自动判断'}
- 篇幅：${novelType || 'short'}
- 章节数：${chapterCount}
- 每章字数：${chapterWords}
- 风格：${style || 'descriptive'}
- 文化/命名语境：${CULTURE_LABELS[culturalRegion] || CULTURE_LABELS.chinese}

请输出：
{
  "title": "书名，导入作品优先识别原书名；想法模式只能基于原始内容拟定，无法判断则留空",
  "genre": "题材标签，优先使用用户选择；无法判断则留空",
  "subtype": "细分类型，必须来自用户选择或文本证据；无法判断则留空",
  "channel": "读者方向，必须来自用户选择或文本证据；无法判断则留空",
  "style": "descriptive/concise/literary/humorous/poetic 之一",
  "cultural_region": "chinese/overseas/mixed 之一",
  "novel_type": "flash/short/long 之一",
  "chapter_count": 章节数,
  "chapter_words": 每章目标字数,
  "logline": "一句话卖点",
  "description": "只基于原始内容整理出的世界观、主角、核心冲突、连载方向；不确定处不要编造",
  "audience": "目标读者",
  "core_conflict": "核心冲突",
  "long_goal": "长期目标",
  "continuity_rules": "不能写崩的规则",
  "source_summary": "如果是导入作品，概括已有内容；想法模式则概括创作种子",
  "imported_status": "new/imported_partial/imported_full",
  "tags": ["标签"],
  "gaps": ["仍缺失或需要用户确认的点"],
  "next_steps": ["下一步建议"]
}

原始内容：
${inputText}`
      }
    ].filter(Boolean)
  });
  const planJson = await parseModelJsonWithRepair({
    text: completionText(result.completion),
    label: '项目初始化 Agent 返回',
    provider,
    stage: '修复项目初始化 JSON'
  });
  const plan = normalizeNovelSeedPlan(planJson, {
    idea,
    sourceText,
    title,
    genre,
    subtype,
    channel,
    novelType,
    chapterCount,
    chapterWords,
    style,
    culturalRegion
  });
  if (!cleanString(plan.title) || !cleanString(plan.description)) {
    const error = new Error('当前输入不足以形成可靠的小说项目档案。请补充主角、背景、目标和核心冲突后再生成。');
    error.status = 400;
    error.code = 'INSUFFICIENT_NOVEL_SOURCE';
    throw error;
  }
  plan._meta = {
    provider_id: result.config.providerId,
    model_id: result.config.model,
    provider_name: result.config.providerName,
    model_name: result.config.modelName,
    attempts: result.attempts
  };
  return plan;
}

// 生成大纲
async function generateOutline({ title, genre, style, chapterCount = 10, description = '', provider, novelType = 'short', culturalRegion = 'chinese' }) {
  ensureSufficientSource({ mode: 'idea', title, idea: description, description });
  const genreLabel = GENRE_LABELS[genre] || genre;
  const styleLabel = STYLE_LABELS[style] || style;
  const typeLabel = TYPE_LABELS[novelType] || '短篇小说';
  const typeHint = TYPE_HINTS[novelType] || '';
  const characterScale = characterScaleRule({ novelType, chapterCount, description, title });
  const compactOutline = buildCompactOutlinePrompt({ title, genreLabel, styleLabel, typeLabel, chapterCount, novelType, culturalRegion, description });
  const kbContext = kb.buildAgentContext('screenwriter', {
    genre: [genre, novelType, '小说', '中篇', '大纲', '对白', '反转'].filter(Boolean).join(' '),
    maxDocs: 5,
    maxCharsPerDoc: 500
  });

  const systemPrompt = `你是一位顶级${typeLabel}作家和故事架构师，精通叙事结构和角色塑造。
${cultureInstruction(culturalRegion)}

【最高优先级：用户需求忠实度】
- 只能基于用户原始想法、导入文本、用户保存的世界观/规则和已存在作品档案来生成。
- 严禁把没有文本证据的时代、地点、人物关系、超能力、末世原因、情感线、结局方向写成事实。
- 信息不足时不要兜底写通用故事；必须在 gaps 数组里列出需要用户补充的问题，并让相关字段保持空或克制。
- 可以补足叙事结构，但每个新增人物/地点/冲突都必须能从用户需求中推导，并在角色职责里体现其必要性。

【大纲架构法则】
- 故事脊柱：每个章节必须推动核心冲突向前发展，不能原地踏步
- 三幕结构：开篇（建立世界观+核心悬念）→ 发展（层层升级冲突+角色成长）→ 高潮结局（最大冲突+情感爆发+余韵）
- 人物弧线：主角必须有清晰的内在变化（从A状态到B状态）
- 每章钩子：每章结尾必须有悬念或情感钩子，让读者想看下一章
- 伏笔设计：前面章节埋下伏笔，后面章节回收，形成叙事闭环

【章节摘要要求】
- 每章摘要60-120字，必须包含：本章核心事件 + 角色情感变化 + 下章悬念
- 标注本章的叙事功能（铺垫/冲突/转折/高潮/收束）

${typeHint ? `【篇幅特点】${typeHint}` : ''}
【人物规模要求】
- ${characterScale.text}
- 人物规模必须由用户想法和小说内容决定：如果是独角戏/双人戏/密室心理故事，就保持小人物结构；如果是家族、门派、公司、王朝、战争、小队或多线故事，再自然扩展为群像。
- 中篇/长篇必须有明确反派或阻力方功能位：可以是人、组织、制度、竞争者、危险环境、资源稀缺或关系压力，但必须在章节里持续制造阻力。
- 中篇通常至少需要 5 个可用戏剧角色，长篇通常至少需要 8 个可用戏剧角色：主角、反派/阻力方、盟友或关系压力、信息/转折携带者、代价/风险承载者。没有姓名证据时使用可追溯的稳定功能称谓，并写入 gaps；不能编假姓名。
- 人物不能只有“主角/配角/反派”三类；如果文本足以支撑人物，必须写出具体叙事身份和剧情功能。
- 不知道姓名时不要随机起名，也不要用“未命名主角/未命名女主/未命名反派”等固定占位兜底；如果用户原文只提供“女主/重生者/房东”等身份称谓，只能原样使用该称谓作为临时标识并写入 gaps；如果连稳定称谓都没有，characters 留空并写入 gaps。
- 不知道关系、动机、世界规则、末世原因、结局方向时，不要编造；把缺失内容写入 gaps。
- 每个主要人物都必须被至少一个章节或一条关系使用，不能只出现在人物名单里。

输出必须是合法 JSON 格式，不要包含代码块标记：
{
  "synopsis": "故事简介（80-150字，包含世界观+核心冲突+主角困境）",
  "characters": [
    { "name": "角色名", "role": "主角/配角/反派", "personality": "性格特征", "arc": "角色变化弧线" }
  ],
  "chapters": [
    { "index": 1, "title": "章节标题（有文学感）", "summary": "详细剧情摘要（60-120字）", "function": "叙事功能（铺垫/冲突/转折/高潮/收束）" }
  ]
}`;

  const userPrompt = `请为以下${typeLabel}生成 ${chapterCount} 章的专业大纲：
- 标题：${title}
- 题材：${genreLabel}
- 文风：${styleLabel}
- 文化/命名语境：${CULTURE_LABELS[culturalRegion] || CULTURE_LABELS.chinese}
${description ? `- 故事描述：${description}` : ''}

严格要求：
1. 每章摘要60-120字，必须具体到事件和情感
2. 章节间有因果逻辑链，不是松散的场景罗列
3. 根据故事内容自行决定主要/重要角色数量（含身份、性格、目标、动机、变化弧线）；缺少证据时不要扩写人物，把问题写入 gaps
4. 前1/4章节建立世界观和冲突，中间1/2升级矛盾，最后1/4推向高潮和结局`;

  const conflictQualityPrompt = `Novel conflict quality gate:
1. The outline must explain why the story starts now: inciting_incident cannot be vague.
2. The outline must expose a concrete core_problem and a recurring conflict_engine. A quiet premise still needs pressure, scarcity, risk, opposition, secrecy, moral cost, or relationship tension.
3. The protagonist cannot only "survive" or "investigate"; every major movement needs a visible want, a blocker, a forced choice, a cost, and a changed situation.
4. A medium novel normally needs at least two usable dramatic roles unless the source explicitly demands a solo story. Roles can be stable labels from source or directly inferred functions, but do not invent fake names or fake relationships.
5. For medium and long fiction, a story without an antagonist/opposition force is structurally weak. The opposition may be a villain, competitor, institution, faction, family pressure, dangerous environment, or scarcity system, but it must repeatedly block the protagonist.
6. A medium novel should normally have at least five usable dramatic roles; a long novel should normally have at least eight. Required functions: protagonist, antagonist/opposition, ally or relationship pressure, information/turn carrier, and cost/stakes role.
7. If the source cannot support a role, relationship, or conflict, leave it out and write the gap. Do not use fallback templates.`;

  const structurePrompt = `请严格输出一个完整小说作品档案 JSON，不要输出 Markdown，不要输出人物关系图图片。字段必须包含：
{
  "synopsis": "故事简介",
  "logline": "一句话卖点",
  "promise": "作品承诺：读者期待、长期目标、冲突升级和兑现方向",
  "inciting_incident": "事件起因：什么事迫使故事现在开始",
  "core_problem": "突出问题：读者持续追问的具体问题",
  "conflict_engine": "矛盾引擎：谁/什么不断制造阻力，以及为什么不能立刻解决",
  "stakes": "失败代价：主角失败会失去什么",
  "escalation_path": "升级路径：压力如何一章比一章更强",
  "genre": "题材",
  "theme": "主题",
  "world": { "era": "时代背景", "setting": "世界观/主要舞台", "rules": "世界规则", "taboos": "不可越界/不可写崩规则", "cost": "力量/选择/情感的代价", "tone": "情绪基调", "visual_style": "可视化风格" },
  "characters": [
    { "id": "char_1", "name": "角色名", "gender": "male/female/unknown", "role": "具体叙事身份，不只写主角/配角/反派", "identity": "社会/势力/剧情身份", "goal": "外在目标", "motivation": "内在动机", "conflict": "核心矛盾", "weakness": "弱点或误判", "personality": "性格", "arc": "人物成长弧线", "voice": "说话方式/声口", "evidence": "来自用户材料或大纲的依据" }
  ],
  "relationships": [
    { "from": "角色A", "to": "角色B", "type": "关系类型", "description": "关系说明", "tension": "冲突/情感张力", "evidence": "关系依据" }
  ],
  "locations": [
    { "name": "地点名", "type": "地点类型", "description": "地点说明", "visual_keywords": ["画面关键词"] }
  ],
  "timeline": [
    { "order": 1, "chapter": 1, "event": "关键事件", "impact": "对人物或主线的影响" }
  ],
  "conflicts": [
    { "type": "外部/内部/关系/世界", "description": "冲突说明", "stakes": "失败代价" }
  ],
  "chapters": [
    { "index": 1, "title": "章节标题", "summary": "120-220字具体剧情任务书，必须写清事件、阻力、选择、代价和情绪变化", "function": "铺垫/冲突/转折/高潮/收束", "pov": "视角角色", "dramatic_question": "本章不可替代的戏剧问题", "scene_goal": "本章场景目标", "obstacle": "本章阻力", "choice": "主角本章必须做出的选择", "cost": "选择造成的代价", "emotional_shift": "人物情绪/关系变化", "reversal": "反转或新信息", "clue": "伏笔/线索", "payoff": "回收或兑现", "sensory_anchor": "可写成场面的具体物件/感官锚点", "characters": ["出场角色"], "key_events": ["关键事件"], "hook": "章尾钩子" }
  ],
  "writing_rules": ["从参考写作规则沉淀出的本书写作纪律"],
  "gaps": ["仍需用户确认或补充的信息"],
  "manga_adaptation": { "core_visuals": ["核心视觉"], "recurring_symbols": ["反复出现的视觉符号"], "episode_suggestion": "改编为漫剧时的分集建议" }
}
章节数量必须等于 ${chapterCount}。人物关系必须是可存储、可渲染的数据，不允许只写“见关系图”。`;

  const contentExtractionPrompt = `抽取规则（必须遵守）：
1. characters、relationships、locations 必须从当前小说标题、故事描述、世界观、章节剧情里抽取或合理命名，不允许照抄“角色A/角色B/角色名/地点名/场景1/角色1”等模板占位词。
2. 如果故事描述没有给出明确姓名，不要随机生成姓名，也不要用“未命名主角/未命名女主/未命名反派”等固定占位兜底；只能使用用户原文已有的名字或身份称谓。没有稳定称谓时 characters 留空，并在 gaps 里说明缺少真实人物标识。
3. relationships.from 和 relationships.to 必须能在 characters.name 中找到对应角色。
4. 不要为了凑字段编固定内容；提取不到的非核心字段可以留空数组。人物列表必须来自当前小说内容或由当前设定自然推导，角色职责不能重复。
5. 不要为了满足格式而补不存在的人物、地点、势力、恋爱线或敌对关系。
6. relationships 只能描述用户文本明确给出或可直接推导的关键关系；无法判断时留空并写入 gaps。`;

  const outlineCraftPrompt = `长篇小说创作质量红线（必须执行，写入 writing_rules 并体现在所有字段里）：
1. 先像资深小说作者一样回看人设、世界观、剧情承诺和用户要求，再生成；严禁 OOC、无动机行为、无依据补设定、机械流水账。
2. 作品必须有清晰“作品承诺”：读者为什么继续看、主角长期目标是什么、冲突升级路径是什么、最终爽点/情感兑现方向是什么。
3. 世界观不能只写背景介绍，必须包含主要舞台、运行规则、禁区/代价/边界、会制造冲突的机制，以及不可写崩规则。
4. 人物不是名单：每个主要人物必须有 gender、具体叙事身份、外在目标、内在动机、弱点/误判、人物弧光、说话方式，并能服务章节或关系。
5. 关系网不是装饰：relationships 必须写出 from/to/type/tension/evidence，只有可以从大纲或用户材料直接推导的关系才能出现。
6. 章节大纲不能像流水账。每章都要包含事件、人物情绪变化、冲突推进、伏笔或回收、章尾钩子；章节之间必须有因果链。
7. 禁止上帝视角乱跳、角色无理由知晓信息、短时间频繁切视角；单章单场景尽量固定核心感官和心理线。
8. 正文写作必须 show don't tell：通过动作、对话、场景细节和心理活动表现情绪，不写问答式流水账，不写泛泛总结。
9. 对话要有角色声口和潜台词，禁止“嗯、哦、好、是”等无效敷衍回复堆叠。
10. 如果输入不足以写出真正小说档案，必须返回 gaps，不要用模板内容凑完整。`;

  const mediumNovelCraftPrompt = `中篇小说章节任务书质量门槛（必须执行）：
1. 中篇不是 6 个事件标题。每章必须像“可直接交给作者开写的任务书”，至少包含：场景目标、阻力、人物选择、情绪变化、反转/新信息、伏笔或回收、感官锚点、章尾钩子。
2. 摘要必须是 120-220 字的具体剧情段落，禁止“开始囤积物资/遇到女主/揭开真相/展开决战”这类流水账句。
3. 每章必须有不可替代的戏剧问题：本章主角想要什么、谁或什么阻止她、她付出什么代价、读者得到什么新认知。
4. 人物只取自用户材料或可直接推导的稳定称谓；不足时留空并写 gaps，不为热闹补假人物。
5. 章节间必须因果递进：上一章的选择制造下一章的麻烦；下一章不能只是换一个任务名。
6. 每章至少一个“可写成场面”的具体动作或物件，例如清单、门锁、药箱、停电、邻居敲门、账本、录音等；物件必须来自用户材料或由世界规则直接推导。`;

  const result = await createChatCompletionWithAttempts({
    preferredProvider: provider,
    stage: '生成大纲',
    max_tokens: 5200,
    messages: [
      { role: 'system', content: compactOutline.system },
      kbContext ? { role: 'system', content: kbContext } : null,
      { role: 'user', content: NOVEL_SOURCE_FIDELITY_RULES },
      { role: 'user', content: conflictQualityPrompt },
      { role: 'user', content: compactOutline.user }
    ].filter(Boolean)
  });
  const completion = result.completion;
  const text = completionText(completion);
  // 提取 JSON
  const outlineJson = await parseModelJsonWithRepair({
    text,
    label: '大纲 Agent 返回',
    provider,
    stage: '修复大纲 JSON'
  });
  let outline = normalizeNovelOutline(outlineJson, { title, genre, style, chapterCount, description, novelType, culturalRegion });
  if (Number(chapterCount) > 0 && asArray(outline.chapters).length !== Number(chapterCount)) {
    const completed = await completeOutlineChapters({
      outline,
      title,
      genre,
      style,
      chapterCount,
      description,
      provider,
      novelType,
      culturalRegion
    });
    outline = {
      ...outline,
      chapters: completed.chapters,
      _chapter_completion_meta: completed._meta
    };
  }
  const qualityIssues = outlineQualityIssues(outline, { novelType, chapterCount });
  if (qualityIssues.length && process.env.NOVEL_OUTLINE_REPAIR === '1') {
    const repaired = await repairOutlineQuality({
      outline,
      issues: qualityIssues,
      title,
      genre,
      style,
      chapterCount,
      description,
      provider,
      novelType,
      culturalRegion,
      kbContext
    });
    outline = repaired;
    outline._quality_repair_issues = qualityIssues;
  } else if (qualityIssues.length) {
    outline._quality_repair_issues = qualityIssues;
  }
  // Gaps are non-blocking review notes for missing names/details. Regeneration should
  // still reread the user's source material and produce a usable draft dossier.
  if (!(outline.characters || []).length) {
    const error = new Error('作品大纲没有提取到任何具体人物。请补充故事想法或重新生成。');
    error.status = 400;
    error.code = 'INSUFFICIENT_NOVEL_SOURCE';
    error.attempts = result.attempts;
    throw error;
  }
  outline._meta = {
    provider_id: outline._meta?.provider_id || result.config.providerId,
    model_id: outline._meta?.model_id || result.config.model,
    provider_name: outline._meta?.provider_name || result.config.providerName,
    model_name: outline._meta?.model_name || result.config.modelName,
    attempts: [...(result.attempts || []), ...asArray(outline._meta?.attempts)]
  };
  return outline;
}

// 流式生成章节
async function generateChapterStream({ outline, chapterIndex, chapters = [], genre, style, chapterWords = 2000, provider, novelType = 'short' }, onChunk) {
  const chapter = outline.chapters.find(c => c.index === chapterIndex);
  const draftKbContext = buildNovelKbContext('chapter drafting scene dialogue prose', { genre, novelType });
  const draftTaskbook = chapterTaskbookText(chapter || {});
  if (!chapter) throw new Error(`大纲中不存在第 ${chapterIndex} 章`);

  const genreLabel = GENRE_LABELS[genre] || genre;
  const styleLabel = STYLE_LABELS[style] || style;
  const typeLabel = TYPE_LABELS[novelType] || '短篇小说';
  const typeHint = TYPE_HINTS[novelType] || '';

  // 构建完整上下文
  const allChapterSummaries = (outline.chapters || []).map(c => `第${c.index}章「${c.title}」：${c.summary}`).join('\n');

  // 前文内容（取最近2章，每章最多500字）
  let previousContext = '';
  if (chapters.length > 0) {
    const sorted = [...chapters].sort((a, b) => a.index - b.index);
    const beforeCurrent = sorted.filter(c => c.index < chapterIndex && c.content);
    const recent = beforeCurrent.slice(-2);
    if (recent.length) {
      previousContext = '【前文内容回顾】\n' + recent.map(c => `第${c.index}章「${c.title}」：\n${(c.content || '').slice(0, 500)}${(c.content || '').length > 500 ? '...' : ''}`).join('\n\n') + '\n\n';
    }
  }

  // 角色信息
  const charInfo = outline.characters?.length
    ? '【角色设定】\n' + outline.characters.map(c => `- ${c.name}（${c.role || '角色'}）：${c.personality || ''}${c.arc ? '，变化弧线：' + c.arc : ''}`).join('\n') + '\n\n'
    : '';

  // 当前章节在全局中的位置
  const totalChapters = outline.chapters?.length || 1;
  const position = chapterIndex <= Math.ceil(totalChapters * 0.25) ? '开篇阶段（建立世界观和人物）'
    : chapterIndex <= Math.ceil(totalChapters * 0.75) ? '发展阶段（升级冲突和角色成长）'
    : '高潮收束阶段（最大冲突+情感爆发）';

  const systemPrompt = `你是一位顶级${typeLabel}作家，${genreLabel}题材大师，文风${styleLabel}。

【写作法则】
- 严格按照大纲的剧情要点展开，不偏离大纲设定
- 展示而非叙述（Show, don't tell）：用场景、对话、动作展现情节，而非平铺直叙
- 对话要有性格：每个角色说话方式不同，对话推动剧情
- 环境描写服务情绪：景物描写要配合角色心理状态
- 节奏控制：紧张段落用短句，抒情段落用长句
- 章节末尾留钩子：让读者有继续阅读的冲动
- 与前文保持绝对连贯：人名、地名、设定、伏笔不能矛盾
${typeHint ? `- 篇幅特点：${typeHint}` : ''}

字数要求：约 ${chapterWords} 字
直接输出正文，不要章节标题，不要作者注释。`;

  const chapterQualityPrompt = `Chapter drafting requirements:
${NOVEL_SOURCE_FIDELITY_RULES}

${NOVEL_FULL_PIPELINE_QUALITY_GATE}

For this chapter, execute the taskbook instead of summarizing it. Open in a concrete scene. Give the POV character a visible objective, resistance, a choice under pressure, and a consequence. Use dialogue only when it changes power, emotion, information, or trust. Keep the prose specific; avoid report-like sentences such as "they began to investigate" without showing the investigative action.`;

  const userPrompt = `【故事简介】
${outline.synopsis}

${charInfo}【完整大纲】
${allChapterSummaries}

${previousContext}【当前任务】
撰写第${chapter.index}章「${chapter.title}」（${position}）
剧情要点：${chapter.summary}
${chapter.function ? `叙事功能：${chapter.function}` : ''}
${draftTaskbook ? `\nChapter taskbook:\n${draftTaskbook}` : ''}

请严格按照上述剧情要点开始撰写正文：`;

  const result = await createStreamingCompletionWithAttempts({
    preferredProvider: provider,
    stage: '生成章节',
    max_tokens: 8192,
    messages: [
      { role: 'system', content: systemPrompt },
      draftKbContext ? { role: 'system', content: draftKbContext } : null,
      { role: 'user', content: chapterQualityPrompt },
      { role: 'user', content: userPrompt }
    ].filter(Boolean),
    onChunk
  });
  return {
    text: result.text,
    provider_id: result.config.providerId,
    model_id: result.config.model,
    attempts: result.attempts
  };
}

// 流式优化文本
async function refineTextStream({ text, instruction, genre, style, provider }, onChunk) {
  const genreLabel = GENRE_LABELS[genre] || genre || '';
  const styleLabel = STYLE_LABELS[style] || style || '';
  const kbContext = buildNovelKbContext('novel refinement prose editing dialogue scene tension', { genre });
  const refineQualityPrompt = `Refinement quality gate:
${NOVEL_SOURCE_FIDELITY_RULES}

${NOVEL_FULL_PIPELINE_QUALITY_GATE}

Do not merely decorate the prose with adjectives. Preserve all established facts and character knowledge. Improve scene pressure, physical action, dialogue subtext, sensory specificity, paragraph rhythm, and emotional causality. Do not add new characters, relationships, powers, backstory, or plot conclusions unless the user's instruction explicitly provides them.`;

  const systemPrompt = `你是一位专业的小说编辑和润色专家${genreLabel ? `，擅长${genreLabel}题材` : ''}。
请根据用户的指令优化以下文本，保持${styleLabel || '原有'}文风。
直接输出优化后的完整文本，不要添加任何解释。`;

  const userPrompt = `优化指令：${instruction}

原文：
${text}

请输出优化后的文本：`;

  const result = await createStreamingCompletionWithAttempts({
    preferredProvider: provider,
    stage: '文本优化',
    max_tokens: 8192,
    messages: [
      { role: 'system', content: systemPrompt },
      kbContext ? { role: 'system', content: kbContext } : null,
      { role: 'user', content: refineQualityPrompt },
      { role: 'user', content: userPrompt }
    ].filter(Boolean),
    onChunk
  });
  return {
    text: result.text,
    provider_id: result.config.providerId,
    model_id: result.config.model,
    attempts: result.attempts
  };
}

function chapterContextPayload(novel = {}, chapterIndex, chapter = {}) {
  const outlineChapter = novel.outline?.chapters?.find(c => Number(c.index) === Number(chapterIndex)) || {};
  return {
    title: novel.title || '',
    genre: novel.genre || '',
    style: novel.style || '',
    logline: novel.logline || novel.contract?.logline || '',
    contract: novel.contract || {},
    story_bible: novel.story_bible || {},
    entities: asArray(novel.entities),
    relationships: asArray(novel.relationships),
    plot_threads: asArray(novel.plot_threads),
    foreshadows: asArray(novel.foreshadows),
    memory_items: asArray(novel.memory_items).slice(-30),
    outline_chapter: outlineChapter,
    chapter: {
      index: Number(chapterIndex),
      title: chapter.title || outlineChapter.title || '',
      content: chapter.content || ''
    }
  };
}

function normalizeReviewReport(raw = {}, chapterIndex) {
  const issues = asArray(raw.issues).map((issue, index) => ({
    id: cleanString(issue.id) || `issue_${index + 1}`,
    type: cleanString(issue.type),
    severity: cleanString(issue.severity),
    description: cleanString(issue.description),
    evidence: cleanString(issue.evidence),
    suggestion: cleanString(issue.suggestion)
  })).filter(issue => issue.description || issue.evidence || issue.suggestion);
  return {
    chapter_index: Number(chapterIndex),
    summary: cleanString(raw.summary),
    score: Number(raw.score) || null,
    passed: Boolean(raw.passed),
    ooc: cleanString(raw.ooc),
    continuity: cleanString(raw.continuity),
    timeline: cleanString(raw.timeline),
    pacing: cleanString(raw.pacing),
    hook: cleanString(raw.hook),
    retention: cleanString(raw.retention),
    issues,
    created_at: new Date().toISOString()
  };
}

function normalizeChapterFacts(raw = {}, chapterIndex) {
  return {
    chapter_index: Number(chapterIndex),
    status: 'committed',
    summary: cleanString(raw.summary),
    events: asArray(raw.events).map(event => ({
      type: cleanString(event.type),
      description: cleanString(event.description || event),
      characters: asArray(event.characters).map(cleanString).filter(Boolean),
      location: cleanString(event.location),
      evidence: cleanString(event.evidence)
    })).filter(event => event.description),
    character_changes: asArray(raw.character_changes).map(item => ({
      name: cleanString(item.name),
      aliases: asArray(item.aliases).map(cleanString).filter(Boolean),
      role: cleanString(item.role),
      identity: cleanString(item.identity),
      goal: cleanString(item.goal),
      motivation: cleanString(item.motivation),
      weakness: cleanString(item.weakness),
      current_state: cleanString(item.current_state),
      change: cleanString(item.change),
      evidence: cleanString(item.evidence)
    })).filter(item => item.name && !isPlaceholderLabel(item.name)),
    relationship_changes: asArray(raw.relationship_changes).map(item => ({
      from: cleanString(item.from),
      to: cleanString(item.to),
      type: cleanString(item.type),
      status: cleanString(item.status),
      description: cleanString(item.description),
      tension: cleanString(item.tension),
      evidence: cleanString(item.evidence)
    })).filter(item => item.from && item.to && !isPlaceholderLabel(item.from) && !isPlaceholderLabel(item.to)),
    location_changes: asArray(raw.location_changes).map(item => ({
      name: cleanString(item.name),
      type: cleanString(item.type),
      description: cleanString(item.description),
      evidence: cleanString(item.evidence)
    })).filter(item => item.name || item.description),
    plot_thread_updates: asArray(raw.plot_thread_updates).map(item => ({
      title: cleanString(item.title),
      type: cleanString(item.type),
      status: cleanString(item.status),
      description: cleanString(item.description),
      stakes: cleanString(item.stakes),
      evidence: cleanString(item.evidence)
    })).filter(item => item.title || item.description),
    foreshadow_updates: asArray(raw.foreshadow_updates).map(item => ({
      description: cleanString(item.description),
      status: cleanString(item.status),
      payoff_chapter: Number(item.payoff_chapter) || null,
      risk: cleanString(item.risk),
      evidence: cleanString(item.evidence)
    })).filter(item => item.description),
    memory_items: asArray(raw.memory_items).map(item => ({
      type: cleanString(item.type),
      text: cleanString(item.text || item),
      importance: Number(item.importance) || 1,
      evidence: cleanString(item.evidence)
    })).filter(item => item.text),
    ignored_relationships: [],
    committed_at: new Date().toISOString()
  };
}

async function reviewChapter({ novel, chapterIndex, provider }) {
  const chapter = asArray(novel.chapters).find(c => Number(c.index) === Number(chapterIndex));
  if (!chapter || !cleanString(chapter.content)) throw new Error('当前章节没有正文，无法审查');
  const context = chapterContextPayload(novel, chapterIndex, chapter);
  const kbContext = buildNovelKbContext('chapter review continuity craft quality gate', {
    genre: novel.genre,
    novelType: novel.novel_type
  });
  const reviewQualityPrompt = `Review quality gate:
${NOVEL_SOURCE_FIDELITY_RULES}

${NOVEL_FULL_PIPELINE_QUALITY_GATE}

Judge whether the chapter actually performs the outline taskbook. Flag report-like summaries, generic plot beats, fake completeness, weak character motive, unclear world pressure, empty dialogue, missing sensory anchor, POV violations, continuity breaks, and hooks that do not create a concrete next question. Do not invent issues; cite evidence from the chapter or context.`;
  const result = await createChatCompletionWithAttempts({
    preferredProvider: provider || novel.provider,
    stage: '章节审查',
    max_tokens: 3000,
    messages: [
      {
        role: 'system',
        content: `你是长篇网文审稿 Agent。只根据给定小说合同、已有人物/剧情记忆和当前章节正文审查，不允许编造未出现的事实。输出合法 JSON，不要 Markdown。`
      },
      kbContext ? { role: 'system', content: kbContext } : null,
      { role: 'user', content: reviewQualityPrompt },
      {
        role: 'user',
        content: `请审查当前章节的一致性、OOC、时间线、设定冲突、节奏和追读力。必须输出：
{
  "summary": "审查摘要",
  "score": 0-100,
  "passed": true/false,
  "ooc": "人物是否 OOC",
  "continuity": "设定/前文连续性",
  "timeline": "时间线问题",
  "pacing": "节奏问题",
  "hook": "章尾钩子",
  "retention": "追读力判断",
  "issues": [
    { "type": "ooc/continuity/timeline/pacing/hook/logic", "severity": "low/medium/high", "description": "问题", "evidence": "正文证据", "suggestion": "修改建议" }
  ]
}
如果没有发现问题，issues 必须为空数组，不要为了凑数写假问题。

上下文 JSON：
${JSON.stringify(context)}`
      }
    ].filter(Boolean)
  });
  const completion = result.completion;
  const reviewJson = await parseModelJsonWithRepair({
    text: completionText(completion),
    label: '审稿 Agent 返回',
    provider: provider || novel.provider,
    stage: '修复审稿 JSON'
  });
  const report = normalizeReviewReport(reviewJson, chapterIndex);
  report.provider_id = result.config.providerId;
  report.model_id = result.config.model;
  report.attempts = result.attempts;
  return report;
}

async function extractChapterFacts({ novel, chapterIndex, provider }) {
  const chapter = asArray(novel.chapters).find(c => Number(c.index) === Number(chapterIndex));
  if (!chapter || !cleanString(chapter.content)) throw new Error('当前章节没有正文，无法提交事实');
  const context = chapterContextPayload(novel, chapterIndex, chapter);
  const factsQualityPrompt = `Fact extraction fidelity gate:
${NOVEL_SOURCE_FIDELITY_RULES}

Extract only evidence-backed facts from the current chapter and provided context. Do not create people, relationships, locations, plot threads, foreshadows, motives, or memory items to make the database look complete. If a relationship or name is unclear, leave the corresponding array empty. Evidence must be a short phrase from the chapter or an explicit context field.`;
  const result = await createChatCompletionWithAttempts({
    preferredProvider: provider || novel.provider,
    stage: '章节事实抽取',
    max_tokens: 4500,
    messages: [
      {
        role: 'system',
        content: `你是长篇小说数据 Agent。任务是从当前章节正文抽取可沉淀事实，用于后续记忆、人物状态、关系图谱和剧情线。只抽正文中有证据的事实，不允许补固定模板，不允许猜测。输出合法 JSON，不要 Markdown。`
      },
      { role: 'user', content: factsQualityPrompt },
      {
        role: 'user',
        content: `请从当前章节抽取事实。必须输出：
{
  "summary": "本章事实摘要",
  "events": [{ "type": "plot/action/reveal/decision", "description": "事件", "characters": ["人物名"], "location": "地点", "evidence": "正文证据" }],
  "character_changes": [{ "name": "人物名", "aliases": [], "role": "身份/角色", "identity": "身份", "goal": "目标", "motivation": "动机", "weakness": "弱点", "current_state": "本章结束状态", "change": "变化", "evidence": "正文证据" }],
  "relationship_changes": [{ "from": "人物A", "to": "人物B", "type": "关系类型", "status": "当前状态", "description": "变化说明", "tension": "张力", "evidence": "正文证据" }],
  "location_changes": [{ "name": "地点", "type": "地点类型", "description": "新增或变化", "evidence": "正文证据" }],
  "plot_thread_updates": [{ "title": "剧情线名称", "type": "main/sub/romance/growth/antagonist", "status": "open/progress/resolved", "description": "进展", "stakes": "利害关系", "evidence": "正文证据" }],
  "foreshadow_updates": [{ "description": "伏笔或回收", "status": "setup/payoff/open", "payoff_chapter": null, "risk": "风险", "evidence": "正文证据" }],
  "memory_items": [{ "type": "character/relationship/world/plot/location", "text": "后续必须记住的事实", "importance": 1-5, "evidence": "正文证据" }]
}
抽取不到的字段返回空数组。人物名必须是正文或已有上下文中的具体名字，不允许“主角/角色A/某人”等占位。

上下文 JSON：
${JSON.stringify(context)}`
      }
    ]
  });
  const completion = result.completion;
  const factsJson = await parseModelJsonWithRepair({
    text: completionText(completion),
    label: '数据 Agent 返回',
    provider: provider || novel.provider,
    stage: '修复事实抽取 JSON'
  });
  const facts = normalizeChapterFacts(factsJson, chapterIndex);
  facts.provider_id = result.config.providerId;
  facts.model_id = result.config.model;
  facts.attempts = result.attempts;
  return facts;
}

module.exports = {
  getAvailableModels,
  analyzeNovelSeed,
  generateOutline,
  generateChapterStream,
  refineTextStream,
  reviewChapter,
  extractChapterFacts,
  normalizeNovelOutline
};
