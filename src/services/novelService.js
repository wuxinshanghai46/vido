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

  const systemPrompt = `你是一位专业的${typeLabel}作家和策划人。请根据用户的需求生成小说大纲。
${typeHint ? `创作要求：${typeHint}。` : ''}
输出必须是合法 JSON 格式，不要包含代码块标记，格式如下：
{
  "synopsis": "故事简介（50-100字）",
  "chapters": [
    { "index": 1, "title": "章节标题", "summary": "该章主要剧情（30-60字）" }
  ]
}`;

  const userPrompt = `请为以下${typeLabel}生成 ${chapterCount} 章的详细大纲：
- 标题：${title}
- 题材：${genreLabel}
- 文风：${styleLabel}
${description ? `- 补充描述：${description}` : ''}

请确保章节间剧情连贯递进，有清晰的起承转合。`;

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

  // 构建前文摘要
  let previousContext = '';
  if (chapters.length > 0) {
    const recent = chapters.slice(-2);
    previousContext = '前文摘要：\n' + recent.map(c => `第${c.index}章「${c.title}」：${(c.content || '').slice(0, 300)}...`).join('\n') + '\n\n';
  }

  const systemPrompt = `你是一位擅长${typeLabel}的${genreLabel}题材资深作家，文风${styleLabel}。
${typeHint ? `创作特点：${typeHint}。` : ''}
请根据大纲和前文内容，撰写小说的指定章节。要求：
- 字数约 ${chapterWords} 字
- 文笔流畅自然，情节引人入胜
- 保持与前文的连贯性
- 对话和心理描写丰富
- 直接输出正文内容，不要重复章节标题`;

  const userPrompt = `小说大纲简介：${outline.synopsis}

${previousContext}当前要写的章节：
第${chapter.index}章「${chapter.title}」
剧情要点：${chapter.summary}

请开始撰写正文：`;

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
