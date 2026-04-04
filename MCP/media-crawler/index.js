/**
 * Media Crawler MCP Server
 * 多平台自媒体内容采集 MCP 工具
 * 支持：抖音、小红书、快手、B站、微博
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import axios from 'axios';

const server = new McpServer({
  name: 'media-crawler',
  version: '1.0.0',
  description: '多平台自媒体内容采集工具 — 抖音/小红书/快手/B站/微博'
});

// ═══ 通用工具函数 ═══

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const PC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchPage(url, options = {}) {
  const resp = await axios.get(url, {
    timeout: options.timeout || 15000,
    maxRedirects: 5,
    headers: {
      'User-Agent': options.mobile !== false ? MOBILE_UA : PC_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': options.referer || '',
      ...(options.headers || {})
    },
    validateStatus: () => true
  });
  return typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
}

function extractMeta(html) {
  const get = (pattern) => { const m = html.match(pattern); return m ? m[1].trim() : ''; };
  return {
    title: get(/<title[^>]*>([^<]+)<\/title>/i) || get(/property="og:title"\s+content="([^"]+)/i),
    description: get(/name="description"\s+content="([^"]+)/i) || get(/property="og:description"\s+content="([^"]+)/i),
    image: get(/property="og:image"\s+content="([^"]+)/i),
    author: get(/"(?:nickname|author_name|author|name)"\s*:\s*"([^"]+)/i),
    videoUrl: get(/property="og:video"\s+content="([^"]+)/i) || get(/"playAddr"\s*:\s*"([^"]+)/i),
  };
}

function extractJsonLD(html) {
  const matches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
  const results = [];
  for (const m of matches) {
    try {
      const json = m.replace(/<\/?script[^>]*>/gi, '');
      results.push(JSON.parse(json));
    } catch {}
  }
  return results;
}

function extractVideoLinks(html, platform) {
  const patterns = {
    douyin: [/href="(https?:\/\/(?:www\.)?douyin\.com\/video\/\d+[^"]*?)"/gi, /href="(https?:\/\/v\.douyin\.com\/[^"]+)"/gi],
    xiaohongshu: [/href="(https?:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item)\/[^"]+)"/gi],
    kuaishou: [/href="(https?:\/\/(?:www\.)?kuaishou\.com\/short-video\/[^"]+)"/gi, /href="(https?:\/\/v\.kuaishou\.com\/[^"]+)"/gi],
    bilibili: [/href="(https?:\/\/(?:www\.)?bilibili\.com\/video\/[^"]+)"/gi, /href="(https?:\/\/b23\.tv\/[^"]+)"/gi],
    weibo: [/href="(https?:\/\/(?:m\.)?weibo\.com\/\d+\/[^"]+)"/gi]
  };
  const links = new Set();
  for (const pat of (patterns[platform] || [])) {
    let m;
    while ((m = pat.exec(html)) !== null) links.add(m[1]);
  }
  return [...links];
}

function extractTags(html) {
  const tags = new Set();
  // #hashtag
  (html.match(/#([^\s#<"]{1,30})/g) || []).forEach(t => tags.add(t.replace('#', '')));
  // JSON中的tag
  (html.match(/"tag(?:_?name)?"\s*:\s*"([^"]+)"/gi) || []).forEach(m => {
    const v = m.match(/"([^"]+)"$/);
    if (v) tags.add(v[1]);
  });
  return [...tags].slice(0, 15);
}

function detectPlatform(url) {
  if (/douyin\.com|v\.douyin/i.test(url)) return 'douyin';
  if (/xiaohongshu\.com|xhslink/i.test(url)) return 'xiaohongshu';
  if (/kuaishou\.com|v\.kuaishou/i.test(url)) return 'kuaishou';
  if (/bilibili\.com|b23\.tv/i.test(url)) return 'bilibili';
  if (/weibo\.com/i.test(url)) return 'weibo';
  return 'unknown';
}

const PLATFORM_NAMES = {
  douyin: '抖音', xiaohongshu: '小红书', kuaishou: '快手',
  bilibili: 'B站', weibo: '微博', unknown: '未知平台'
};

// ═══ 平台特化抓取逻辑 ═══

async function crawlDouyin(url) {
  const html = await fetchPage(url, { referer: 'https://www.douyin.com/' });
  const meta = extractMeta(html);
  const jsonLD = extractJsonLD(html);

  // 抖音内嵌数据
  const renderDataMatch = html.match(/window\.__RENDER_DATA__\s*=\s*'([^']+)'/);
  let renderData = null;
  if (renderDataMatch) {
    try { renderData = JSON.parse(decodeURIComponent(renderDataMatch[1])); } catch {}
  }

  // 从 SSR 数据提取
  const descMatch = html.match(/"desc"\s*:\s*"([^"]{5,500})"/);
  const statsMatch = html.match(/"digg_count"\s*:\s*(\d+)/);
  const commentMatch = html.match(/"comment_count"\s*:\s*(\d+)/);
  const shareMatch = html.match(/"share_count"\s*:\s*(\d+)/);
  const nicknameMatch = html.match(/"nickname"\s*:\s*"([^"]+)"/);
  const uidMatch = html.match(/"uid"\s*:\s*"(\d+)"/);

  return {
    platform: 'douyin',
    platformName: '抖音',
    title: meta.title || (descMatch ? descMatch[1] : ''),
    description: meta.description || (descMatch ? descMatch[1] : ''),
    author: nicknameMatch ? nicknameMatch[1] : meta.author,
    authorId: uidMatch ? uidMatch[1] : '',
    coverImage: meta.image,
    videoUrl: meta.videoUrl,
    tags: extractTags(html),
    stats: {
      likes: statsMatch ? parseInt(statsMatch[1]) : 0,
      comments: commentMatch ? parseInt(commentMatch[1]) : 0,
      shares: shareMatch ? parseInt(shareMatch[1]) : 0
    },
    rawText: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 2000)
  };
}

async function crawlXiaohongshu(url) {
  const html = await fetchPage(url, { referer: 'https://www.xiaohongshu.com/' });
  const meta = extractMeta(html);

  // 小红书内嵌数据
  const initDataMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})\s*<\/script>/);
  let noteData = null;
  if (initDataMatch) {
    try {
      const cleaned = initDataMatch[1].replace(/undefined/g, 'null');
      noteData = JSON.parse(cleaned);
    } catch {}
  }

  const descMatch = html.match(/"desc"\s*:\s*"([^"]{5,2000})"/);
  const titleMatch = html.match(/"title"\s*:\s*"([^"]{2,100})"/);
  const nicknameMatch = html.match(/"nickname"\s*:\s*"([^"]+)"/);
  const likeMatch = html.match(/"liked_count"\s*:\s*"?(\d+)/);
  const collectMatch = html.match(/"collected_count"\s*:\s*"?(\d+)/);

  return {
    platform: 'xiaohongshu',
    platformName: '小红书',
    title: (titleMatch ? titleMatch[1] : '') || meta.title,
    description: (descMatch ? descMatch[1] : '') || meta.description,
    author: nicknameMatch ? nicknameMatch[1] : meta.author,
    coverImage: meta.image,
    tags: extractTags(html),
    stats: {
      likes: likeMatch ? parseInt(likeMatch[1]) : 0,
      collects: collectMatch ? parseInt(collectMatch[1]) : 0
    },
    rawText: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 2000)
  };
}

async function crawlKuaishou(url) {
  const html = await fetchPage(url, { referer: 'https://www.kuaishou.com/' });
  const meta = extractMeta(html);

  const captionMatch = html.match(/"caption"\s*:\s*"([^"]{5,500})"/);
  const nicknameMatch = html.match(/"(?:user_?name|nick(?:name)?|kwaiId)"\s*:\s*"([^"]+)"/i);
  const likeMatch = html.match(/"likeCount"\s*:\s*(\d+)/);
  const viewMatch = html.match(/"viewCount"\s*:\s*(\d+)/);

  return {
    platform: 'kuaishou',
    platformName: '快手',
    title: (captionMatch ? captionMatch[1] : '') || meta.title,
    description: meta.description,
    author: nicknameMatch ? nicknameMatch[1] : meta.author,
    coverImage: meta.image,
    tags: extractTags(html),
    stats: {
      likes: likeMatch ? parseInt(likeMatch[1]) : 0,
      views: viewMatch ? parseInt(viewMatch[1]) : 0
    },
    rawText: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 2000)
  };
}

async function crawlBilibili(url) {
  // B站用PC UA效果更好
  const html = await fetchPage(url, { mobile: false, referer: 'https://www.bilibili.com/' });
  const meta = extractMeta(html);

  const titleMatch = html.match(/"title"\s*:\s*"([^"]{2,200})"/);
  const descMatch = html.match(/"desc"\s*:\s*"([^"]{5,1000})"/);
  const ownerMatch = html.match(/"owner"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
  const viewMatch = html.match(/"view"\s*:\s*(\d+)/);
  const likeMatch = html.match(/"like"\s*:\s*(\d+)/);
  const danmakuMatch = html.match(/"danmaku"\s*:\s*(\d+)/);

  return {
    platform: 'bilibili',
    platformName: 'B站',
    title: (titleMatch ? titleMatch[1] : '') || meta.title,
    description: (descMatch ? descMatch[1] : '') || meta.description,
    author: ownerMatch ? ownerMatch[1] : meta.author,
    coverImage: meta.image,
    tags: extractTags(html),
    stats: {
      views: viewMatch ? parseInt(viewMatch[1]) : 0,
      likes: likeMatch ? parseInt(likeMatch[1]) : 0,
      danmaku: danmakuMatch ? parseInt(danmakuMatch[1]) : 0
    },
    rawText: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 2000)
  };
}

async function crawlWeibo(url) {
  const html = await fetchPage(url, { mobile: true, referer: 'https://m.weibo.cn/' });
  const meta = extractMeta(html);

  const textMatch = html.match(/"text"\s*:\s*"([^"]{10,2000})"/);
  const nicknameMatch = html.match(/"screen_name"\s*:\s*"([^"]+)"/);
  const repostMatch = html.match(/"reposts_count"\s*:\s*(\d+)/);
  const commentMatch = html.match(/"comments_count"\s*:\s*(\d+)/);
  const likeMatch = html.match(/"attitudes_count"\s*:\s*(\d+)/);

  return {
    platform: 'weibo',
    platformName: '微博',
    title: meta.title,
    description: textMatch ? textMatch[1].replace(/<[^>]+>/g, '') : meta.description,
    author: nicknameMatch ? nicknameMatch[1] : meta.author,
    coverImage: meta.image,
    tags: extractTags(html),
    stats: {
      reposts: repostMatch ? parseInt(repostMatch[1]) : 0,
      comments: commentMatch ? parseInt(commentMatch[1]) : 0,
      likes: likeMatch ? parseInt(likeMatch[1]) : 0
    },
    rawText: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 2000)
  };
}

// ═══ MCP Tools 定义 ═══

// 1. 通用视频/内容提取
server.tool(
  'extract_content',
  '从视频/笔记链接提取内容（自动识别平台：抖音/小红书/快手/B站/微博）',
  { url: z.string().describe('视频或笔记链接') },
  async ({ url }) => {
    const platform = detectPlatform(url);
    let result;
    try {
      switch (platform) {
        case 'douyin': result = await crawlDouyin(url); break;
        case 'xiaohongshu': result = await crawlXiaohongshu(url); break;
        case 'kuaishou': result = await crawlKuaishou(url); break;
        case 'bilibili': result = await crawlBilibili(url); break;
        case 'weibo': result = await crawlWeibo(url); break;
        default:
          const html = await fetchPage(url);
          const meta = extractMeta(html);
          result = { platform: 'unknown', platformName: '未知', title: meta.title, description: meta.description, author: meta.author, tags: extractTags(html), stats: {} };
      }
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message, platform }) }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...result }) }] };
  }
);

// 2. 博主主页抓取
server.tool(
  'crawl_creator',
  '抓取博主/创作者主页，获取最新视频列表',
  {
    url: z.string().describe('博主主页链接'),
    platform: z.enum(['douyin', 'xiaohongshu', 'kuaishou', 'bilibili', 'weibo', 'auto']).default('auto').describe('平台')
  },
  async ({ url, platform }) => {
    const p = platform === 'auto' ? detectPlatform(url) : platform;
    try {
      const html = await fetchPage(url, {
        referer: `https://www.${p === 'bilibili' ? 'bilibili' : p}.com/`,
        mobile: p !== 'bilibili'
      });
      const meta = extractMeta(html);
      const videoLinks = extractVideoLinks(html, p);
      const tags = extractTags(html);

      // 提取作者信息
      const nicknameMatch = html.match(/"(?:nickname|screen_name|name|user_name)"\s*:\s*"([^"]+)"/i);
      const followersMatch = html.match(/"(?:follower_count|fans_count|mFansCount)"\s*:\s*"?(\d+)/i);
      const descMatch = html.match(/"(?:signature|desc|bio|description)"\s*:\s*"([^"]{2,200})"/i);

      return { content: [{ type: 'text', text: JSON.stringify({
        success: true,
        platform: p,
        platformName: PLATFORM_NAMES[p],
        author: nicknameMatch ? nicknameMatch[1] : meta.author,
        followers: followersMatch ? parseInt(followersMatch[1]) : 0,
        bio: descMatch ? descMatch[1] : '',
        videoLinks: videoLinks.slice(0, 20),
        videoCount: videoLinks.length,
        tags
      }) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }] };
    }
  }
);

// 3. 批量提取视频列表
server.tool(
  'batch_extract',
  '批量提取多个视频/笔记链接的内容',
  { urls: z.array(z.string()).describe('视频链接列表（最多10个）') },
  async ({ urls }) => {
    const results = [];
    for (const url of urls.slice(0, 10)) {
      const platform = detectPlatform(url);
      try {
        let result;
        switch (platform) {
          case 'douyin': result = await crawlDouyin(url); break;
          case 'xiaohongshu': result = await crawlXiaohongshu(url); break;
          case 'kuaishou': result = await crawlKuaishou(url); break;
          case 'bilibili': result = await crawlBilibili(url); break;
          case 'weibo': result = await crawlWeibo(url); break;
          default: result = { platform: 'unknown', title: url, description: '' };
        }
        results.push({ url, success: true, ...result });
      } catch (err) {
        results.push({ url, success: false, error: err.message });
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, results }) }] };
  }
);

// 4. 搜索热门内容（基于平台公开页面）
server.tool(
  'search_trending',
  '获取平台热门/推荐内容',
  { platform: z.enum(['douyin', 'xiaohongshu', 'bilibili', 'weibo']).describe('平台') },
  async ({ platform }) => {
    const trendUrls = {
      douyin: 'https://www.douyin.com/hot',
      xiaohongshu: 'https://www.xiaohongshu.com/explore',
      bilibili: 'https://www.bilibili.com/v/popular/rank/all',
      weibo: 'https://m.weibo.cn/api/container/getIndex?containerid=106003type%3D25%26t%3D3%26disable_hot%3D1%26filter_type%3Drealtimehot'
    };
    try {
      const html = await fetchPage(trendUrls[platform], { mobile: platform !== 'bilibili' });
      const titles = [];
      // 提取热门标题
      const titlePatterns = [
        /"(?:title|desc|text|content|word)"\s*:\s*"([^"]{5,100})"/gi
      ];
      for (const pat of titlePatterns) {
        let m;
        while ((m = pat.exec(html)) !== null && titles.length < 30) {
          const t = m[1].replace(/<[^>]+>/g, '').trim();
          if (t.length > 4 && !titles.includes(t)) titles.push(t);
        }
      }
      const links = extractVideoLinks(html, platform);
      return { content: [{ type: 'text', text: JSON.stringify({
        success: true, platform, platformName: PLATFORM_NAMES[platform],
        trending: titles.slice(0, 20),
        links: links.slice(0, 10)
      }) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }] };
    }
  }
);

// 5. 平台检测
server.tool(
  'detect_platform',
  '检测链接属于哪个平台',
  { url: z.string().describe('链接') },
  async ({ url }) => {
    const p = detectPlatform(url);
    return { content: [{ type: 'text', text: JSON.stringify({ platform: p, platformName: PLATFORM_NAMES[p] }) }] };
  }
);

// ═══ MCP Resources 定义 ═══

server.resource(
  'supported-platforms',
  'mcp://media-crawler/platforms',
  async () => ({
    contents: [{
      uri: 'mcp://media-crawler/platforms',
      text: JSON.stringify({
        platforms: [
          { id: 'douyin', name: '抖音', features: ['视频提取', '博主信息', '标签', '互动数据'] },
          { id: 'xiaohongshu', name: '小红书', features: ['笔记提取', '博主信息', '标签', '收藏数'] },
          { id: 'kuaishou', name: '快手', features: ['视频提取', '博主信息', '播放数'] },
          { id: 'bilibili', name: 'B站', features: ['视频提取', 'UP主信息', '弹幕数', '标签'] },
          { id: 'weibo', name: '微博', features: ['微博提取', '博主信息', '转发/评论/点赞'] }
        ]
      })
    }]
  })
);

// ═══ 启动 ═══
const transport = new StdioServerTransport();
await server.connect(transport);
