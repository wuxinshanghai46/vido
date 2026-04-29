/** 微博综合搜索（无需登录的 wbi/api 走 cookie 偶尔失效，自动降级） */
const axios = require('axios');

module.exports = {
  name: '微博',
  platform: 'weibo',
  requiresKey: false,
  description: '可选填 cookie 提升稳定性；无 cookie 时降级到匿名抓取（部分内容受限）',
  configSchema: {
    cookie: { type: 'password', label: '微博 Cookie（可选，提升稳定性）' },
  },

  async search({ keyword = '', limit = 24 } = {}, config = {}) {
    if (!keyword) throw new Error('微博必须传 keyword');
    const cookie = config.cookie || process.env.WEIBO_COOKIE || '';
    try {
      const r = await axios.get('https://m.weibo.cn/api/container/getIndex', {
        params: {
          containerid: '100103type=1&q=' + keyword + '&t=',
          page_type: 'searchall',
        },
        timeout: 12000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
          'Referer': 'https://m.weibo.cn/search?containerid=100103type=1&q=' + encodeURIComponent(keyword),
          ...(cookie ? { Cookie: cookie } : {}),
        }
      });
      const cards = r.data?.data?.cards || [];
      const items = [];
      cards.forEach(card => {
        // card_type=9 是微博内容卡，11 是分组（递归取 card_group）
        const groups = card.card_type === 11 ? (card.card_group || []) : [card];
        groups.forEach(c => {
          const mblog = c.mblog || {};
          if (!mblog.id) return;
          const pageInfo = mblog.page_info || {};
          // 优先取视频微博
          const isVideo = pageInfo.type === 'video' || pageInfo.media_info;
          items.push({
            id: 'wb_' + mblog.id,
            platform: 'weibo',
            platform_name: '微博',
            title: (mblog.text || '').replace(/<[^>]+>/g, '').slice(0, 100),
            transcript: (mblog.text || '').replace(/<[^>]+>/g, ''),
            tags: [],
            author: mblog.user?.screen_name || '',
            author_avatar: mblog.user?.profile_image_url || '',
            cover: pageInfo.page_pic?.url || mblog.pics?.[0]?.url || '',
            video_url: 'https://m.weibo.cn/status/' + mblog.id,
            views: mblog.attitudes_count || 0,
            likes: mblog.attitudes_count || 0,
            comments: mblog.comments_count || 0,
            shares: mblog.reposts_count || 0,
            duration: '',
            published_at: mblog.created_at ? new Date(mblog.created_at).toISOString() : null,
            source: 'weibo-mobile',
            is_video: isVideo,
          });
        });
      });
      // 优先视频，其次综合
      items.sort((a, b) => (b.is_video ? 1 : 0) - (a.is_video ? 1 : 0));
      return { items: items.slice(0, limit), message: cookie ? '带 cookie 抓取' : '匿名抓取' };
    } catch (e) {
      throw new Error('微博抓取失败: ' + e.message);
    }
  },

  async health(config = {}) {
    try {
      await axios.get('https://m.weibo.cn/api/container/getIndex', {
        params: { containerid: '100103type=1&q=测试' },
        timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      return { ok: true, message: '可访问' };
    } catch (e) { return { ok: false, message: e.message }; }
  },
};
