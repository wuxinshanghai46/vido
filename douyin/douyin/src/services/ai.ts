import { getConfig } from "../config.js";

export interface RewriteOptions {
  text: string;
  style?: string;
  prompt?: string;
}

/** 风格预设 */
const STYLE_PRESETS: Record<string, string> = {
  "爆款口播": "你是一个短视频爆款文案专家。请逐段重写以下文案，用更具吸引力、适合口语表达的短视频风格，保持原意和原文长度不变，不要省略任何内容。开头要有钩子吸引用户停留。",
  "专业科普": "你是一个专业知识科普创作者。请逐段重写以下文案，用严谨但通俗的语言，让普通人也能听懂。保持原文长度和所有论点不变，不要缩减内容。",
  "幽默搞笑": "你是一个喜剧段子手。请逐段重写以下文案，用幽默、夸张、有梗的风格，让观众忍不住笑出来。保持原文长度和所有核心信息不变，不要省略内容。",
  "口语带货": "你是一个顶级直播带货主播。请逐段重写以下文案，用亲切、有感染力的口语化风格，突出卖点和用户痛点。保持原文长度不变，不要缩减内容。",
  "情感走心": "你是一个情感类短视频创作者。请逐段重写以下文案，用真诚、走心、能引起共鸣的语气，注意节奏和情绪的起伏。保持原文长度不变，不要省略内容。",
  "新闻播报": "你是一个新闻主播。请逐段重写以下文案，用正式、客观的播报风格，措辞严谨、逻辑清晰。保持原文长度和所有信息不变，不要缩减内容。",
};

/** 调用 LLM API 改写文案 */
export async function rewriteText(options: RewriteOptions): Promise<string> {
  const config = getConfig();

  if (!config.ai.apiKey) {
    throw new Error("未配置 AI API Key，请在 config.json5 中设置 ai.apiKey");
  }

  // 构建 system prompt
  const systemPrompt = `你是一个专业的配音文案生成器。请严格按照用户的风格指令对原始文本进行重写。

核心要求：
1. 重写后的文案长度必须与原文基本一致（字数差异不超过10%），不得大幅缩减内容
2. 保留原文的所有核心论点、举例、数据和论证过程，不要省略或概括
3. 最终输出的只能是用于配音的纯文本，不要包含任何多余的解释、Markdown、标题或动作提示
4. 保持口语化，适合直接朗读配音`;

  // 构建 user prompt
  let userPrompt: string;
  if (options.prompt) {
    // 路径 B：用户自定义指令
    userPrompt = `[风格指令] ${options.prompt}\n\n[原始文本]\n${options.text}`;
  } else if (options.style && STYLE_PRESETS[options.style]) {
    // 路径 A 变体：选择了预设风格
    userPrompt = `[风格指令] ${STYLE_PRESETS[options.style]}\n\n[原始文本]\n${options.text}`;
  } else {
    // 路径 A：默认保底
    userPrompt = `[风格指令] 你是一个短视频爆款文案专家。请逐段重写以下文案，用更具吸引力、适合口语表达的短视频风格，保持原意和原文长度不变，不要缩减或省略任何内容。开头加一个吸引人的钩子。\n\n[原始文本]\n${options.text}`;
  }

  const res = await fetch(config.ai.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.ai.apiKey}`,
    },
    body: JSON.stringify({
      model: config.ai.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI API 调用失败 (${res.status}): ${err}`);
  }

  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content || "";
}

/** 获取可用风格列表 */
export function getStylePresets(): string[] {
  return Object.keys(STYLE_PRESETS);
}
