/**
 * 内容雷达服务
 * 功能：视频内容提取（文案/标签/分析）、AI改写、一键复刻
 */
const db = require('../models/database');
const { v4: uuidv4 } = require('uuid');

/**
 * 解析平台和账号信息
 */
function parsePlatformUrl(url) {
  if (/douyin\.com|v\.douyin/i.test(url)) return { platform: 'douyin', name: '抖音' };
  if (/kuaishou\.com|v\.kuaishou/i.test(url)) return { platform: 'kuaishou', name: '快手' };
  if (/channels\.weixin|视频号/i.test(url)) return { platform: 'wechat', name: '视频号' };
  if (/xiaohongshu\.com|xhslink/i.test(url)) return { platform: 'xiaohongshu', name: '小红书' };
  if (/bilibili\.com|b23\.tv/i.test(url)) return { platform: 'bilibili', name: 'B站' };
  return { platform: 'other', name: '其他' };
}

/**
 * 从视频URL提取内容（AI分析）
 */
async function extractContent(videoUrl, userId) {
  const { callLLM } = require('./storyService');
  const { platform, name: platformName } = parsePlatformUrl(videoUrl);

  const systemPrompt = `你是一个专业的短视频内容分析师。用户提供视频链接，你需要基于链接信息和平台特征进行分析。
输出严格JSON格式，不要输出其他内容。`;

  const userPrompt = `分析以下${platformName}视频链接，推测并生成内容分析：
URL: ${videoUrl}

输出JSON格式：
{
  "title": "推测的视频标题（20字内）",
  "transcript": "推测的视频口播文案（200-500字，模拟真实口播风格）",
  "tags": ["标签1", "标签2", "标签3"],
  "style": "视频风格（口播/带货/知识科普/故事/生活记录）",
  "hook": "开头钩子（吸引观众停留的第一句话）",
  "structure": "内容结构分析（如：痛点引入→解决方案→行动号召）",
  "highlights": ["爆款要素1", "爆款要素2", "爆款要素3"]
}`;

  const result = await callLLM(systemPrompt, userPrompt);
  let parsed;
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result);
  } catch {
    parsed = { title: '内容分析', transcript: result, tags: [], style: '未知', hook: '', structure: '', highlights: [] };
  }

  const contentId = uuidv4();
  db.insertContent({
    id: contentId,
    user_id: userId,
    video_url: videoUrl,
    platform,
    platform_name: platformName,
    title: parsed.title || '',
    transcript: parsed.transcript || '',
    tags: parsed.tags || [],
    style: parsed.style || '',
    hook: parsed.hook || '',
    structure: parsed.structure || '',
    highlights: parsed.highlights || [],
    status: 'done'
  });

  return { id: contentId, ...parsed, platform, platformName };
}

/**
 * AI改写文案
 */
async function rewriteContent(contentId, style, userId) {
  const content = db.getContent(contentId);
  if (!content) throw new Error('内容不存在');

  const { callLLM } = require('./storyService');
  const styleMap = {
    'oral': '口播风格：亲切自然，像跟朋友聊天，适当使用反问和感叹',
    'sell': '带货风格：痛点引入→产品亮点→限时优惠→行动号召',
    'knowledge': '知识科普风格：引发好奇→核心干货→总结升华，专业但不枯燥',
    'story': '故事风格：悬念开场→情节发展→反转/感悟，注重情感共鸣',
    'same': '保持原文风格，但替换具体内容使其成为原创'
  };

  const systemPrompt = '你是一个专业的短视频文案改写专家。保留原文的爆款结构和节奏，替换具体内容使其成为原创。直接输出改写后的纯文案文本。';
  const userPrompt = `请改写以下视频文案：

原文案：
${content.transcript}

改写风格：${styleMap[style] || styleMap.same}

要求：
- 保留原文的结构和节奏
- 替换具体产品/人物/数据，使其不构成抄袭
- 保留"钩子"开头的吸引力
- 字数与原文相近
- 直接输出纯文案，不要加标题/注释`;

  const rewritten = await callLLM(systemPrompt, userPrompt);
  return { original: content.transcript, rewritten, style };
}

/**
 * 一键复刻：改写 → TTS → 视频生成
 */
async function replicateContent({ contentId, voiceId, style, avatarImage, userId, onProgress }) {
  const content = db.getContent(contentId);
  if (!content) throw new Error('内容不存在');

  const taskId = uuidv4();
  db.insertReplicateTask({
    id: taskId,
    user_id: userId,
    content_id: contentId,
    status: 'processing',
    title: content.title || '复刻任务'
  });

  try {
    // 步骤1: AI改写
    onProgress?.({ step: 'rewrite', message: 'AI 改写文案中...' });
    const { rewritten } = await rewriteContent(contentId, style || 'same', userId);

    // 步骤2: TTS 生成语音
    onProgress?.({ step: 'tts', message: '生成语音配音...' });
    const { generateSpeech } = require('./ttsService');
    const fs = require('fs');
    const path = require('path');
    const audioDir = path.join(__dirname, '../../outputs/replicate', taskId);
    fs.mkdirSync(audioDir, { recursive: true });
    const audioFile = await generateSpeech(rewritten, path.join(audioDir, 'voice'), { voiceId });

    // 步骤3: 如果有数字人形象，生成数字人视频
    let videoPath = null;
    if (avatarImage) {
      onProgress?.({ step: 'video', message: '生成数字人视频...' });
      const { generateAvatarVideo } = require('./avatarService');
      const result = await generateAvatarVideo({
        imageUrl: avatarImage,
        text: rewritten,
        voiceId: voiceId || '',
        ratio: '9:16',
        model: 'cogvideox-flash',
        expression: 'natural',
        background: 'studio',
        onProgress
      });
      videoPath = result.videoPath;
    }

    db.updateReplicateTask(taskId, {
      status: 'done',
      rewritten_text: rewritten,
      audio_path: audioFile,
      video_path: videoPath
    });

    onProgress?.({ step: 'done', message: '复刻完成！' });
    return { taskId, rewritten, audioFile, videoPath };
  } catch (err) {
    db.updateReplicateTask(taskId, { status: 'error', error: err.message });
    throw err;
  }
}

module.exports = { parsePlatformUrl, extractContent, rewriteContent, replicateContent };
