/**
 * 抖音视频信息提取（独立模块·复刻自 douyin/douyin/src/services/douyin.ts）
 *
 * 流程：
 *   1. fetch 短链跟随 redirect 拿 finalUrl，正则提 /video/(\d+)
 *   2. fetch iesdouyin SSR 页 https://www.iesdouyin.com/share/video/{id}/ 拿 HTML
 *   3. 正则提 window._ROUTER_DATA 拿 JSON
 *   4. 遍历 loaderData 找 videoInfoRes.item_list[0]
 *   5. 标准化为 { id, title, transcript, tags, author, cover, video_url, stats... }
 *
 * 不依赖 MCP / Puppeteer / Python，纯 axios + 正则。
 * 移动端 UA + Mobile/Safari 头。
 */

const axios = require('axios');

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

function _extractUrl(text) {
  if (!text) return null;
  const m = String(text).match(/https?:\/\/[^\s<>"'，。！？、；：）》\]]+/i);
  return m ? m[0].replace(/[.,;:!?]+$/, '') : null;
}

async function _resolveVideoId(url) {
  const resp = await axios.get(url, {
    maxRedirects: 5,
    timeout: 15000,
    headers: { 'User-Agent': MOBILE_UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    validateStatus: () => true,
  });
  const finalUrl = resp.request?.res?.responseUrl || url;
  const m1 = finalUrl.match(/\/video\/(\d+)/);
  if (m1) return { id: m1[1], finalUrl };
  const m2 = finalUrl.match(/\/note\/(\d+)/);
  if (m2) return { id: m2[1], finalUrl };
  // 也有可能 finalUrl 已经是 share/video/xxx 格式
  const m3 = finalUrl.match(/share\/(?:video|note)\/(\d+)/);
  if (m3) return { id: m3[1], finalUrl };
  throw new Error(`无法从 URL 提取 video_id: ${finalUrl}`);
}

/**
 * 通过 iesdouyin SSR 页提取单个视频完整信息
 * @param {string} shareUrl 抖音短链 / 完整链接 / 含分享文案的字符串
 * @returns {Promise<object>} 标准化后的内容对象
 */
async function getDouyinVideoInfo(shareUrl) {
  const url = _extractUrl(shareUrl) || shareUrl;
  const { id: videoId, finalUrl } = await _resolveVideoId(url);

  const pageUrl = `https://www.iesdouyin.com/share/video/${videoId}/`;
  const resp = await axios.get(pageUrl, {
    timeout: 15000,
    headers: { 'User-Agent': MOBILE_UA },
  });
  const html = String(resp.data || '');

  // 抖音的 _ROUTER_DATA 可能是 JSON 字符串（带转义）也可能是 JS 对象
  // 用宽松正则 + JSON.parse 兜底
  const routerMatch = html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]+?\});?\s*<\/script>/);
  if (!routerMatch) {
    // 兜底：尝试更宽松匹配
    const m2 = html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]+?\})\s*<\/script/);
    if (!m2) throw new Error('iesdouyin 页面没有 _ROUTER_DATA（可能是登录墙或视频已删）');
    routerMatch[1] = m2[1];
  }

  let routerData;
  try {
    routerData = JSON.parse(routerMatch[1]);
  } catch (e) {
    throw new Error('解析 _ROUTER_DATA JSON 失败: ' + e.message);
  }

  let item = null;
  for (const key of Object.keys(routerData.loaderData || {})) {
    const val = routerData.loaderData[key];
    if (val?.videoInfoRes?.item_list?.[0]) {
      item = val.videoInfoRes.item_list[0];
      break;
    }
  }
  if (!item) throw new Error('未找到视频数据（可能已删/被屏蔽/需登录）');

  const stats = item.statistics || {};
  const author = item.author || {};
  const video = item.video || {};
  const tags = (item.text_extra || []).filter(t => t.type === 1).map(t => t.hashtag_name).filter(Boolean);

  return {
    id: item.aweme_id || videoId,
    platform: 'douyin',
    platform_name: '抖音',
    title: item.desc || '',
    transcript: item.desc || '',  // douyin 没有真口播文本，用描述兜底
    description: item.desc || '',
    tags,
    cover: video.cover?.url_list?.[0] || video.origin_cover?.url_list?.[0] || '',
    video_url: video.play_addr?.url_list?.[0] || '',
    share_url: `https://www.douyin.com/video/${item.aweme_id || videoId}`,
    duration: Math.round((video.duration || 0) / 1000),
    views: stats.play_count || 0,
    likes: stats.digg_count || 0,
    comments: stats.comment_count || 0,
    shares: stats.share_count || 0,
    collects: stats.collect_count || 0,
    author: author.nickname || '',
    author_id: author.unique_id || author.short_id || '',
    author_avatar: author.avatar_thumb?.url_list?.[0] || '',
    author_sec_uid: author.sec_uid || '',
    upload_date: item.create_time ? new Date(item.create_time * 1000).toISOString() : null,
    source: 'douyin-iesdouyin-ssr',
    crawled: true,
  };
}

module.exports = {
  getDouyinVideoInfo,
  _extractUrl,
};
