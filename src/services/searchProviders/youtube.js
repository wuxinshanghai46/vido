/** YouTube Data API v3 search */
const axios = require('axios');

module.exports = {
  name: 'YouTube',
  platform: 'youtube',
  requiresKey: true,
  description: '需要 YouTube Data API v3 Key（在 Google Cloud Console 免费申请）',
  configSchema: {
    api_key: { type: 'password', label: 'API Key（GCP）' },
    region: { type: 'string', default: 'CN', label: '区域代码（如 US/JP/CN）' },
  },

  async search({ keyword = '', limit = 24 } = {}, config = {}) {
    const apiKey = config.api_key || process.env.YOUTUBE_API_KEY;
    if (!apiKey) throw new Error('未配置 YouTube API Key');
    if (!keyword) throw new Error('YouTube 必须传 keyword');

    // step 1: search.list 拿 videoIds
    const sr = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q: keyword,
        type: 'video',
        maxResults: Math.min(limit, 25),
        order: 'viewCount',
        regionCode: config.region || undefined,
        key: apiKey,
      },
      timeout: 12000,
    });
    const ids = (sr.data?.items || []).map(it => it.id?.videoId).filter(Boolean);
    if (!ids.length) return { items: [], message: '无结果' };

    // step 2: videos.list 拿统计信息
    const vr = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        part: 'snippet,statistics,contentDetails',
        id: ids.join(','),
        key: apiKey,
      },
      timeout: 12000,
    });

    const items = (vr.data?.items || []).map(v => {
      // ISO 8601 PT1H2M3S 转秒
      const dur = v.contentDetails?.duration || '';
      const m = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      const sec = m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
      const min = Math.floor(sec / 60); const r = sec % 60;
      return {
        id: 'yt_' + v.id,
        platform: 'youtube',
        platform_name: 'YouTube',
        title: v.snippet?.title || '',
        transcript: v.snippet?.description || '',
        tags: v.snippet?.tags || [],
        author: v.snippet?.channelTitle || '',
        cover: v.snippet?.thumbnails?.high?.url || v.snippet?.thumbnails?.default?.url || '',
        video_url: 'https://www.youtube.com/watch?v=' + v.id,
        views: +(v.statistics?.viewCount || 0),
        likes: +(v.statistics?.likeCount || 0),
        comments: +(v.statistics?.commentCount || 0),
        duration: sec > 0 ? `${min}:${String(r).padStart(2, '0')}` : '',
        published_at: v.snippet?.publishedAt || null,
        source: 'youtube-api',
      };
    });
    return { items, message: `匹配 ${items.length} 条` };
  },

  async health(config = {}) {
    const apiKey = config.api_key || process.env.YOUTUBE_API_KEY;
    if (!apiKey) return { ok: false, message: '未配置 API Key' };
    try {
      await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: { part: 'snippet', q: 'test', type: 'video', maxResults: 1, key: apiKey }, timeout: 5000,
      });
      return { ok: true, message: 'API Key 有效' };
    } catch (e) {
      return { ok: false, message: e.response?.data?.error?.message || e.message };
    }
  },
};
