/**
 * VIDO AI 团队服务
 *
 * 实现 4 个新的可调用 agent（另 3 个为 KB-only 知识增强）：
 *   1. agentMarketResearch  — 🎯 市场调研官
 *   2. agentCopywriter      — 📝 文案策划
 *   3. agentEditor          — ✂️ 剪辑顾问
 *   4. agentLocalizer       — 🌍 本地化
 *
 * KB-only 知识增强（通过 applies_to 注入到现有流程，无独立 agent 函数）：
 *   - 🎨 art_director 注入到导演/氛围/人物一致性
 *   - 📈 growth_ops 注入到 copywriter / market_research
 *   - 🎩 executive_producer 作为"协调者"知识
 */

const { callLLM } = require('./storyService');
const kb = require('./knowledgeBaseService');

// ———————————————————————————————————————————————
// 通用工具：JSON 修复 + 超时保护
// ———————————————————————————————————————————————
function repairJSON(raw) {
  if (!raw) return null;
  let s = raw.trim();
  // 去掉代码块围栏
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // 找第一个 { 和最后一个 }
  const first = s.indexOf('{');
  const firstArr = s.indexOf('[');
  if (first === -1 && firstArr === -1) {
    // 不是 JSON，原样返回
    return { raw: s };
  }
  const start = (firstArr !== -1 && (first === -1 || firstArr < first)) ? firstArr : first;
  const endChar = s[start] === '[' ? ']' : '}';
  const last = s.lastIndexOf(endChar);
  if (last === -1) return { raw: s };
  try {
    return JSON.parse(s.slice(start, last + 1));
  } catch {
    return { raw: s };
  }
}

// ═══════════════════════════════════════════════════
// Agent 1: 市场调研官 Market Research
// ═══════════════════════════════════════════════════
/**
 * 调研一个题材/关键词在全网的热度、爆款特征、竞品参考
 * @param {object} params
 * @param {string} params.query - 调研的题材/关键词/话题
 * @param {string} [params.platform] - 平台（抖音/快手/小红书/tiktok/youtube/全网）
 * @param {string} [params.market] - 市场（国内/美国/英国/日本/东南亚 等）
 * @param {string} [params.goal] - 调研目标（选题 / 竞品分析 / 用户画像 / 趋势追踪）
 */
async function agentMarketResearch({ query, platform = '全网', market = '国内', goal = '选题' }) {
  const kbContext = kb.buildAgentContext('market_research', { genre: query, maxDocs: 5 });

  const systemPrompt = `你是一名顶级市场调研官，对标 Perplexity + Gemini 的能力。
你的专业：内容热度监控、竞品拆解、趋势追踪、用户画像建模。

【核心工作原则】
1. 数据驱动：不臆测，给具体数字（即便是估算也要说明依据）
2. 三维拆解：内容 × 投流 × 数据
3. 辨识窗口期：说清这个题材现在是"机会期 / 红海期 / 夕阳期"
4. 给出可执行建议：不要只分析不决策

【输出要求】
严格输出 JSON，不要任何额外文字，不要 markdown 代码块。

${kbContext}`;

  const userPrompt = `请对以下题材进行全面市场调研：

题材/关键词：${query}
平台：${platform}
市场：${market}
调研目标：${goal}

请输出以下 JSON 结构：
{
  "summary": "一句话结论（100 字内）",
  "market_phase": "机会期 | 上升期 | 成熟期 | 红海期 | 夕阳期",
  "opportunity_score": 0-100 的机会值,
  "user_persona": {
    "who": "目标用户画像（年龄/性别/职业/地域）",
    "what": "他们爱看什么题材元素",
    "when": "他们在什么时间场景观看",
    "why": "他们为什么会点开这类内容"
  },
  "content_features": [
    "爆款内容的 5-8 个共性特征"
  ],
  "top_hooks": [
    "这个赛道被验证有效的 3-5 个开篇钩子"
  ],
  "competitor_reference": [
    { "name": "竞品/头部账号名称", "strength": "他们强在哪", "weakness": "可以被超越的点" }
  ],
  "traffic_strategy": {
    "platform_priority": ["建议优先投放的 1-3 个平台"],
    "ad_creative_angle": "投流素材应该突出的角度",
    "estimated_cpm_range": "CPM 参考区间（元）"
  },
  "window_assessment": "当前窗口期的具体判断 + 建议进入 or 观望 or 错位竞争",
  "actionable_suggestions": [
    "3-5 条立即可执行的建议"
  ],
  "data_caveats": "本报告的数据局限性（说明哪些是估算 / 需用户自行验证）"
}`;

  const raw = await callLLM(systemPrompt, userPrompt);
  return repairJSON(raw);
}

// ═══════════════════════════════════════════════════
// Agent 2: 文案策划 Copywriter
// ═══════════════════════════════════════════════════
/**
 * 为视频 / 项目生成平台化文案包（标题 / 描述 / hashtag / 封面文字 / 金句）
 * @param {object} params
 * @param {string} params.content - 视频内容描述 / 剧情梗概
 * @param {string} params.platform - 目标平台（douyin/xiaohongshu/bilibili/tiktok/youtube/instagram）
 * @param {string} [params.genre] - 题材类型
 * @param {number} [params.variantCount=5] - 标题变体数量
 */
async function agentCopywriter({ content, platform = 'douyin', genre = '', variantCount = 5 }) {
  const kbContext = kb.buildAgentContext('copywriter', { genre, maxDocs: 4 });

  const platformGuide = {
    douyin: '抖音：15-25 字直接钩子 + 3-5 个 hashtag + 情绪化表达',
    xiaohongshu: '小红书：20-30 字精致标题 + 100-300 字正文 + 10-20 个 hashtag + 适量 emoji',
    bilibili: 'B 站：25-40 字玩梗或专业 + 1-3 个 hashtag + 反常识',
    kuaishou: '快手：15-20 字接地气 + 2-4 个 hashtag + 情感真实',
    tiktok: 'TikTok：150-300 chars POV style + 4-8 hashtags + trending',
    youtube: 'YouTube Shorts: 40-70 chars question + answer + #Shorts',
    instagram: 'Instagram Reels: 100-250 chars aesthetic + 15-20 hashtags + emojis',
  };

  const systemPrompt = `你是一名顶级短视频文案策划，对标 ChatGPT + Claude 的写作能力。
你的专业：爆款标题、平台化文案、hashtag 策略、封面文字、金句生成。

【平台要求】
${platformGuide[platform] || platformGuide.douyin}

【核心原则】
1. 标题必须 3 秒内抓住眼球
2. 严格遵守平台字数/风格限制
3. 封面文字 = 第二标题，不重复但互补
4. 提供多变体供 A/B 测试
5. Hashtag 按大/中/小/品牌词分层组合

严格输出 JSON，不要任何额外文字。

${kbContext}`;

  const userPrompt = `为以下视频生成 ${platform} 平台文案包：

视频内容：${content}
${genre ? '题材类型：' + genre : ''}
标题变体数量：${variantCount}

输出 JSON：
{
  "platform": "${platform}",
  "titles": [
    { "text": "标题文本", "formula": "所用公式（数字/悬念/反转/对比等）", "length": 字数 }
  ],
  "description": "平台文案正文（按平台要求）",
  "hashtags": {
    "big": ["1-3 个大词（百万级播放）"],
    "medium": ["2-4 个中词"],
    "small": ["2-4 个小词/长尾"],
    "brand": ["1-2 个品牌词"]
  },
  "thumbnail_text": {
    "main": "封面主文字（3-5 字，粗体大字）",
    "sub": "封面副文字（可选，5-10 字）",
    "color": "推荐色彩（如 黄+黑 / 白+红）"
  },
  "golden_phrases": [
    "3-5 条可用于视频高潮的金句"
  ],
  "cta": "CTA 行动号召文案"
}

必须生成 ${variantCount} 个标题变体，每个使用不同的公式。`;

  const raw = await callLLM(systemPrompt, userPrompt);
  return repairJSON(raw);
}

// ═══════════════════════════════════════════════════
// Agent 3: 剪辑顾问 Editor
// ═══════════════════════════════════════════════════
/**
 * 为分镜脚本 / 成片 shot list 提供剪辑建议（节奏 / 转场 / 音乐 / 钩子）
 * @param {object} params
 * @param {array}  params.shots - shot list 数组，每项 { index, description, duration, emotion?, ... }
 * @param {string} [params.genre] - 题材类型
 * @param {string} [params.targetDuration] - 目标总时长（30s / 60s / 90s / 180s）
 * @param {string} [params.mood] - 目标情绪（紧张 / 浪漫 / 悲伤 / 燃 / 甜 / 爽）
 */
async function agentEditor({ shots, genre = '', targetDuration = '60s', mood = '' }) {
  const kbContext = kb.buildAgentContext('editor', { genre, maxDocs: 4 });

  const systemPrompt = `你是一名顶级剪辑师，熟知 Walter Murch 六大剪辑原则（情绪 > 故事 > 节奏 > 视线 > 构图 > 空间）。
你的专业：节奏控制、转场技法、音乐驱动剪辑、3 秒钩子设计。

【核心原则】
1. Emotion first（51% 权重）— 剪辑服务情绪
2. 前 3 秒必须有钩子（决定完播率）
3. BPM 必须与画面节奏匹配
4. 转场有目的（不是炫技）
5. ASL (Average Shot Length) 按情绪调整

【任务】
为输入的分镜脚本提供专业剪辑建议，包括：
- 每镜时长优化
- 剪辑点位置（硬切 / L-Cut / J-Cut / Match Cut / Smash Cut / 淡入淡出 等）
- 音乐 BPM 建议
- 开场 3 秒钩子方案
- 节奏变化曲线

严格输出 JSON，不要任何额外文字。

${kbContext}`;

  const userPrompt = `请为以下 shot list 提供完整的剪辑建议：

目标时长：${targetDuration}
题材：${genre || '通用'}
目标情绪：${mood || '默认'}

Shot list：
${JSON.stringify(shots, null, 2)}

输出 JSON：
{
  "total_duration": "建议总时长",
  "target_asl": "平均镜头长度（秒）",
  "pacing_curve": "节奏曲线描述（如 慢-快-爆-慢）",
  "bgm": {
    "recommended_bpm": "推荐 BPM 范围",
    "genre": "音乐类型（ballad/edm/rock/classical/pop）",
    "mood": "音乐情绪",
    "key_beats": "关键卡点位置（秒）"
  },
  "opening_hook": {
    "type": "Action Cut / Visual Shock / Quick Cut Tease / Mystery Hook / Direct Address",
    "design": "开场 3 秒的具体剪法"
  },
  "shot_edits": [
    {
      "shot_index": 1,
      "suggested_duration": 秒数,
      "cut_to_next": "硬切 | L-Cut | J-Cut | Match Cut | Smash Cut | Dissolve | Whip Pan",
      "note": "剪辑意图说明"
    }
  ],
  "transitions": [
    "整体建议使用的 3-5 种转场技法"
  ],
  "rhythm_notes": "节奏变化详细说明",
  "risk_warnings": [
    "潜在的剪辑问题 / 需要避免的陷阱"
  ]
}`;

  const raw = await callLLM(systemPrompt, userPrompt);
  return repairJSON(raw);
}

// ═══════════════════════════════════════════════════
// Agent 4: 本地化 Localizer
// ═══════════════════════════════════════════════════
/**
 * 将剧本/文案本地化到目标市场（不只是翻译，而是文化重写）
 * @param {object} params
 * @param {string} params.content - 要本地化的内容（剧本 / 对白 / 文案）
 * @param {string} params.sourceLang - 源语言（zh / en / ja / ko）
 * @param {string} params.targetMarket - 目标市场（us / uk / jp / kr / id / th / vn / ph）
 * @param {string} [params.contentType=script] - script / dialogue / title / description
 */
async function agentLocalizer({ content, sourceLang = 'zh', targetMarket = 'us', contentType = 'script' }) {
  const kbContext = kb.buildAgentContext('localizer', { maxDocs: 3 });

  const marketMap = {
    us: { lang: 'English (US)', culture: '美国市场，偏好 Werewolf/Billionaire CEO/Rebirth 题材，直接外放' },
    uk: { lang: 'English (UK)', culture: '英国市场，偏好 Royal/Aristocrat/Regency，优雅克制' },
    jp: { lang: '日本語', culture: '日本市场，偏好纯爱/日常/异世界，含蓄暧昧' },
    kr: { lang: '한국어', culture: '韩国市场，偏好财阀/复仇虐恋/鬼怪，反转密集' },
    id: { lang: 'Bahasa Indonesia', culture: '印尼市场，偏好豪门/家族/灵异，注意伊斯兰禁忌' },
    th: { lang: 'ภาษาไทย', culture: '泰国市场，偏好豪门/灵异/宫廷，注意王室和佛教禁忌' },
    vn: { lang: 'Tiếng Việt', culture: '越南市场，偏好中式穿越/家族/爱情' },
    ph: { lang: 'Filipino', culture: '菲律宾市场，偏好家族/宗教/灰姑娘' },
  };

  const target = marketMap[targetMarket] || marketMap.us;

  const systemPrompt = `你是一名顶级本地化专家，对标 DeepL + RecCloud 的能力。
你的专业：不只是翻译，是**文化重写**。

【核心原则】
1. 题材转译：中文霸总 → Western Billionaire / Royal / Werewolf
2. 场景替换：北京四合院 → Manhattan brownstone
3. 称呼简化：不用中文辈分（叔/婶/哥/姐），直接用名字
4. 俚语本土化：用当地 Gen-Z 俚语
5. 文化雷区：避免当地宗教/政治/性/暴力禁忌
6. 语气调整：中文含蓄 → 英文直接（或保留含蓄感看市场）

【目标市场】
${target.lang}
${target.culture}

严格输出 JSON，不要任何额外文字。

${kbContext}`;

  const userPrompt = `请将以下内容本地化到"${target.lang}"目标市场：

内容类型：${contentType}
源语言：${sourceLang}
目标市场：${targetMarket}

原始内容：
${content}

输出 JSON：
{
  "target_language": "${target.lang}",
  "target_market": "${targetMarket}",
  "localized_content": "本地化后的完整内容（不是直译，是文化重写）",
  "key_changes": [
    "列出做了哪些重要文化改写（每条说明：原 → 改 → 原因）"
  ],
  "cultural_warnings": [
    "提醒用户注意的文化敏感点"
  ],
  "character_name_suggestions": [
    { "original": "原中文名", "localized": "本地化后的名字", "reason": "为什么这样改" }
  ],
  "scene_replacements": [
    { "original": "原场景", "replacement": "本地化场景", "reason": "原因" }
  ],
  "tone_adjustment": "本地化后的语气相比原文有什么调整",
  "market_fit_score": "此内容在目标市场的适配度 0-100",
  "improvement_suggestions": [
    "如果要进一步提升市场契合度的建议"
  ]
}`;

  const raw = await callLLM(systemPrompt, userPrompt);
  return repairJSON(raw);
}

module.exports = {
  agentMarketResearch,
  agentCopywriter,
  agentEditor,
  agentLocalizer,
};
