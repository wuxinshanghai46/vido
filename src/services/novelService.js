require('dotenv').config();
const OpenAI = require('openai');

const GENRE_LABELS = {
  fantasy: '奇幻', wuxia: '武侠', xianxia: '仙侠', scifi: '科幻',
  romance: '言情', mystery: '悬疑', horror: '恐怖', urban: '都市', historical: '历史'
};
const STYLE_LABELS = {
  descriptive: '细腻描写', concise: '简练干脆', literary: '文学性强',
  humorous: '幽默风趣', poetic: '诗意唯美'
};
const TYPE_LABELS = {
  flash: '超短篇小说（闪小说/微型小说）', short: '短篇小说', long: '长篇小说'
};
const TYPE_HINTS = {
  flash: '结构紧凑，一个核心场景或转折，结尾留有余韵',
  short: '起承转合完整，人物鲜明，节奏紧凑',
  long: '多线叙事，人物群像丰满，世界观宏大，伏笔呼应'
};

// 获取可用的 LLM 配置（优先 settings，回退 env）
function getNovelConfig(preferredProvider) {
  try {
    const { loadSettings } = require('./settingsService');
    const settings = loadSettings();
    for (const provider of settings.providers) {
      if (!provider.enabled || !provider.api_key) continue;
      if (preferredProvider && provider.id !== preferredProvider) continue;
      const model = (provider.models || []).find(m => m.enabled !== false && m.use === 'story');
      if (model) return { apiKey: provider.api_key, baseURL: provider.api_url, model: model.id, providerId: provider.id };
    }
    // 未指定 provider 时，取任何 story model
    if (preferredProvider) {
      for (const provider of settings.providers) {
        if (!provider.enabled || !provider.api_key) continue;
        const model = (provider.models || []).find(m => m.enabled !== false && m.use === 'story');
        if (model) return { apiKey: provider.api_key, baseURL: provider.api_url, model: model.id, providerId: provider.id };
      }
    }
  } catch {}
  // Fallback env
  if (process.env.DEEPSEEK_API_KEY) return { apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat', providerId: 'deepseek' };
  if (process.env.OPENAI_API_KEY) return { apiKey: process.env.OPENAI_API_KEY, baseURL: null, model: 'gpt-4o', providerId: 'openai' };
  return null;
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
  return models;
}

function createClient(config) {
  const opts = { apiKey: config.apiKey };
  if (config.baseURL) opts.baseURL = config.baseURL;
  return new OpenAI(opts);
}

// 生成大纲
async function generateOutline({ title, genre, style, chapterCount = 10, description = '', provider, novelType = 'short' }) {
  const config = getNovelConfig(provider);
  if (!config) throw new Error('未配置 AI 供应商');
  const genreLabel = GENRE_LABELS[genre] || genre;
  const styleLabel = STYLE_LABELS[style] || style;
  const typeLabel = TYPE_LABELS[novelType] || '短篇小说';
  const typeHint = TYPE_HINTS[novelType] || '';

  const systemPrompt = `你是一位顶级${typeLabel}作家和故事架构师，精通叙事结构和角色塑造。

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
${description ? `- 故事描述：${description}` : ''}

严格要求：
1. 每章摘要60-120字，必须具体到事件和情感
2. 章节间有因果逻辑链，不是松散的场景罗列
3. 提取并列出主要角色（含性格和变化弧线）
4. 前1/4章节建立世界观和冲突，中间1/2升级矛盾，最后1/4推向高潮和结局`;

  const client = createClient(config);
  const completion = await client.chat.completions.create({
    model: config.model,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  });
  const text = completion.choices[0].message.content;
  // 提取 JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI 返回格式异常');
  return JSON.parse(jsonMatch[0]);
}

// 流式生成章节
async function generateChapterStream({ outline, chapterIndex, chapters = [], genre, style, chapterWords = 2000, provider, novelType = 'short' }, onChunk) {
  const config = getNovelConfig(provider);
  if (!config) throw new Error('未配置 AI 供应商');

  const chapter = outline.chapters.find(c => c.index === chapterIndex);
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
  const totalChapters = outline.chapters?.length || chapterCount;
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

  const userPrompt = `【故事简介】
${outline.synopsis}

${charInfo}【完整大纲】
${allChapterSummaries}

${previousContext}【当前任务】
撰写第${chapter.index}章「${chapter.title}」（${position}）
剧情要点：${chapter.summary}
${chapter.function ? `叙事功能：${chapter.function}` : ''}

请严格按照上述剧情要点开始撰写正文：`;

  const client = createClient(config);
  const stream = await client.chat.completions.create({
    model: config.model,
    max_tokens: 8192,
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  });

  let fullText = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      fullText += delta;
      onChunk(delta);
    }
  }
  return fullText;
}

// 流式优化文本
async function refineTextStream({ text, instruction, genre, style, provider }, onChunk) {
  const config = getNovelConfig(provider);
  if (!config) throw new Error('未配置 AI 供应商');

  const genreLabel = GENRE_LABELS[genre] || genre || '';
  const styleLabel = STYLE_LABELS[style] || style || '';

  const systemPrompt = `你是一位专业的小说编辑和润色专家${genreLabel ? `，擅长${genreLabel}题材` : ''}。
请根据用户的指令优化以下文本，保持${styleLabel || '原有'}文风。
直接输出优化后的完整文本，不要添加任何解释。`;

  const userPrompt = `优化指令：${instruction}

原文：
${text}

请输出优化后的文本：`;

  const client = createClient(config);
  const stream = await client.chat.completions.create({
    model: config.model,
    max_tokens: 8192,
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  });

  let fullText = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      fullText += delta;
      onChunk(delta);
    }
  }
  return fullText;
}

module.exports = { getAvailableModels, generateOutline, generateChapterStream, refineTextStream };
