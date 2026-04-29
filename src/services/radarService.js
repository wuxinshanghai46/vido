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
 * 抓取网页内容
 */
async function fetchPageContent(url) {
  const axios = require('axios');
  try {
    // 跟随重定向，模拟移动端浏览器
    const resp = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
    const html = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);

    // 提取有用文本：title, description, 正文
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descMatch = html.match(/name=["']description["']\s+content=["']([^"']+)/i)
      || html.match(/property=["']og:description["']\s+content=["']([^"']+)/i);
    const titleOG = html.match(/property=["']og:title["']\s+content=["']([^"']+)/i);

    // 提取视频描述（各平台特征）
    const descPatterns = [
      /desc["\s:]+["']?([^"'<]{10,500})/i,
      /content["\s:]+["']([^"']{20,500})/i,
      /"text"\s*:\s*"([^"]{10,500})"/,
      /data-desc=["']([^"']+)/i,
      /class=["'][^"']*desc[^"']*["'][^>]*>([^<]{10,500})/i
    ];
    let bodyText = '';
    for (const pat of descPatterns) {
      const m = html.match(pat);
      if (m && m[1].length > bodyText.length) bodyText = m[1];
    }

    // 提取标签
    const tagMatches = html.match(/#[^\s#<]{1,20}/g) || [];
    const tags = [...new Set(tagMatches.map(t => t.replace('#', '')))].slice(0, 10);

    // 提取作者
    const authorMatch = html.match(/["'](?:author|nickname|name)["']\s*:\s*["']([^"']+)/i)
      || html.match(/class=["'][^"']*author[^"']*["'][^>]*>([^<]+)/i);

    const pageTitle = (titleOG?.[1] || titleMatch?.[1] || '').trim();
    const pageDesc = (descMatch?.[1] || '').trim();
    const author = (authorMatch?.[1] || '').trim();

    // 去除 HTML 标签获取纯文本片段
    const textContent = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .substring(0, 3000);

    return {
      title: pageTitle,
      description: pageDesc,
      bodyText: bodyText || pageDesc,
      author,
      tags,
      rawText: textContent,
      finalUrl: resp.request?.res?.responseUrl || url
    };
  } catch (err) {
    console.warn(`[Radar] 网页抓取失败: ${err.message}`);
    return { title: '', description: '', bodyText: '', author: '', tags: [], rawText: '', finalUrl: url };
  }
}

/**
 * 尝试通过 MCP media-crawler 工具提取内容
 */
async function tryMcpExtract(url) {
  try {
    const mcpManager = require('./mcpManager');
    const instances = mcpManager.listInstances();
    const crawler = instances.find(i => i.id === 'media-crawler' && i.status === 'running');
    if (!crawler) return null;

    const result = await mcpManager.callTool('media-crawler', 'extract_content', { url });
    if (!result?.content?.[0]?.text) return null;
    const data = JSON.parse(result.content[0].text);
    if (!data.success) return null;
    console.log(`[Radar] MCP media-crawler 提取成功: ${data.title || url}`);
    return data;
  } catch (err) {
    console.warn(`[Radar] MCP 提取失败，回退到内置: ${err.message}`);
    return null;
  }
}

/**
 * 尝试通过 MCP media-crawler 抓取博主主页
 */
async function tryMcpCrawlCreator(url) {
  try {
    const mcpManager = require('./mcpManager');
    const instances = mcpManager.listInstances();
    const crawler = instances.find(i => i.id === 'media-crawler' && i.status === 'running');
    if (!crawler) return null;

    const result = await mcpManager.callTool('media-crawler', 'crawl_creator', { url, platform: 'auto' });
    if (!result?.content?.[0]?.text) return null;
    const data = JSON.parse(result.content[0].text);
    return data.success ? data : null;
  } catch (err) {
    console.warn(`[Radar] MCP 博主抓取失败: ${err.message}`);
    return null;
  }
}

/**
 * 从视频URL提取内容（优先 MCP → 内置抓取 → AI分析）
 */
async function extractContent(videoUrl, userId) {
  const { callLLM } = require('./storyService');
  const { platform, name: platformName } = parsePlatformUrl(videoUrl);

  // ━━━ 抖音优先走 douyinExtract（无 MCP 依赖，直接 fetch iesdouyin SSR）━━━
  if (platform === 'douyin') {
    try {
      const { getDouyinVideoInfo } = require('./douyinExtract');
      const info = await getDouyinVideoInfo(videoUrl);
      console.log(`[Radar] 抖音 iesdouyin SSR 提取成功: ${info.title} · ${info.author}`);
      const contentId = uuidv4();
      db.insertContent({
        id: contentId,
        user_id: userId,
        video_url: info.share_url,
        platform: 'douyin',
        platform_name: '抖音',
        title: info.title || '',
        transcript: info.transcript || '',
        tags: info.tags || [],
        author: info.author || '',
        author_avatar: info.author_avatar || '',
        author_id: info.author_id || '',
        cover: info.cover || '',
        views: info.views || 0,
        likes: info.likes || 0,
        comments: info.comments || 0,
        duration: info.duration || 0,
        upload_date: info.upload_date,
        crawled: true,
        source: info.source,
        status: 'done',
      });
      return { id: contentId, ...info, platformName: '抖音' };
    } catch (e) {
      console.warn('[Radar] douyinExtract 失败，走通用回退:', e.message);
      // 不 throw，继续走通用 MCP/axios 路径
    }
  }

  // 第0步：尝试 MCP media-crawler（更精准的平台特化爬虫）
  const mcpData = await tryMcpExtract(videoUrl);

  // 第1步：内置抓取（MCP 失败时的回退）
  console.log(`[Radar] 正在抓取 ${platformName} 页面: ${videoUrl}`);
  const page = mcpData ? {
    title: mcpData.title || '',
    description: mcpData.description || '',
    bodyText: mcpData.description || '',
    author: mcpData.author || '',
    tags: mcpData.tags || [],
    rawText: mcpData.rawText || mcpData.description || '',
    finalUrl: videoUrl
  } : await fetchPageContent(videoUrl);

  const hasRealContent = page.title || page.bodyText || page.rawText.length > 100;

  // 第2步：用AI分析抓取到的内容
  const systemPrompt = `你是一个专业的短视频内容分析师。分析以下从${platformName}网页抓取到的内容。
${hasRealContent ? '基于实际抓取的网页数据进行分析。' : '无法抓取到网页内容（可能需要登录），请基于URL推测。'}
输出严格JSON格式，不要输出其他内容。`;

  const crawledInfo = hasRealContent ? `
抓取到的页面信息：
- 标题: ${page.title}
- 描述: ${page.description}
- 正文摘要: ${page.bodyText.substring(0, 500)}
- 作者: ${page.author}
- 标签: ${page.tags.join(', ')}
- 页面文本片段: ${page.rawText.substring(0, 1000)}` : '';

  const userPrompt = `分析以下${platformName}视频内容：
URL: ${videoUrl}
${crawledInfo}

输出JSON格式：
{
  "title": "视频标题（20字内）",
  "transcript": "视频口播文案（200-500字，${hasRealContent ? '基于抓取内容还原' : '模拟口播风格'}）",
  "tags": ["标签1", "标签2", "标签3"],
  "style": "视频风格（口播/带货/知识科普/故事/生活记录）",
  "hook": "开头钩子",
  "structure": "内容结构分析",
  "highlights": ["爆款要素1", "爆款要素2", "爆款要素3"],
  "author": "作者名称"
}`;

  // LLM 解析有可能慢或不可用 — 给一个最长 25s 兜底，超时/失败则降级到原始页面数据
  let result = '';
  let llmFailed = null;
  try {
    result = await Promise.race([
      callLLM(systemPrompt, userPrompt),
      new Promise((_, rej) => setTimeout(() => rej(new Error('LLM 解析超时（>25s）')), 25000)),
    ]);
  } catch (e) {
    llmFailed = e.message;
    console.warn('[Radar] LLM 解析失败，使用原始抓取数据:', e.message);
  }

  let parsed;
  if (result) {
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result);
    } catch {
      parsed = { title: page.title || '内容分析', transcript: page.bodyText || result, tags: page.tags, style: '未知', hook: '', structure: '', highlights: [] };
    }
  } else if (hasRealContent) {
    // 有真实抓取数据，LLM 失败时降级返回原始数据
    parsed = {
      title: page.title || platformName + '视频',
      transcript: page.bodyText || page.rawText.substring(0, 500),
      tags: page.tags || [],
      style: '未知',
      hook: '', structure: '',
      highlights: llmFailed ? [`AI 解析失败：${llmFailed}`] : [],
      author: page.author || '',
    };
  } else {
    // 抓取 + LLM 全失败 → 不写垃圾记录，直接抛错
    const reasons = [];
    if (!hasRealContent) reasons.push('页面抓取失败（可能需要登录或目标平台限制）');
    if (llmFailed) reasons.push('AI 解析失败：' + llmFailed);
    throw new Error(reasons.join(' · '));
  }

  // 合并抓取数据和AI分析
  if (!parsed.title && page.title) parsed.title = page.title;
  if (page.tags.length && !parsed.tags?.length) parsed.tags = page.tags;
  if (!parsed.author && page.author) parsed.author = page.author;

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
    author: parsed.author || page.author || '',
    crawled: hasRealContent,
    status: 'done'
  });

  return { id: contentId, ...parsed, platform, platformName, crawled: hasRealContent };
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

module.exports = { parsePlatformUrl, extractContent, rewriteContent, replicateContent, tryMcpCrawlCreator };
