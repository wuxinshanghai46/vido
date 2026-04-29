/** B站搜索（有关键字走 search API；无关键字回落 popular） */
const axios = require('axios');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Referer': 'https://www.bilibili.com/',
  'Cookie': 'buvid3=A4B1F7D2-3E5C-4A1B-9D8C-E7F1A2B3C4D5infoc',
};

function _fmtDuration(sec) {
  if (!sec) return '';
  if (typeof sec === 'string' && /:/.test(sec)) return sec;
  const s = +sec; const m = Math.floor(s / 60); const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function _stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = {
  name: 'B 站搜索',
  platform: 'bilibili',
  requiresKey: false,
  description: '有关键字 → 真实搜索接口；无关键字 → 全站热门 50 条',

  async search({ keyword = '', limit = 24 } = {}, config = {}) {
    if (keyword) {
      // 真实关键字搜索 — 不匹配就返回空，不再 fallback popular
      try {
        const r = await axios.get('https://api.bilibili.com/x/web-interface/wbi/search/type', {
          params: { search_type: 'video', keyword, page: 1, page_size: Math.min(limit, 30), order: 'totalrank' },
          timeout: 12000, headers: HEADERS,
        });
        const list = r.data?.data?.result || [];
        const items = list.slice(0, limit).map(v => ({
          id: 'bili_sr_' + v.bvid,
          platform: 'bilibili',
          platform_name: 'B站',
          title: _stripHtml(v.title),
          transcript: _stripHtml(v.description || ''),
          tags: (v.tag || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 5),
          author: v.author || '',
          author_avatar: v.upic ? (v.upic.startsWith('http') ? v.upic : 'https:' + v.upic) : '',
          cover: v.pic ? (v.pic.startsWith('http') ? v.pic : 'https:' + v.pic) : '',
          video_url: v.arcurl || ('https://www.bilibili.com/video/' + v.bvid),
          views: v.play || 0,
          likes: v.like || 0,
          comments: v.video_review || 0,
          duration: _fmtDuration(v.duration),
          published_at: v.pubdate ? new Date(v.pubdate * 1000).toISOString() : null,
          source: 'bilibili-search',
        }));
        return { items, message: `搜索匹配 ${items.length} 条` };
      } catch (e) {
        // search 失败（如 wbi 签名变更） → 不再 fallback popular，让上层走其它 provider 或 MCP
        return { items: [], message: 'B站 search API 失败：' + e.message };
      }
    }

    // 无关键字 → 全站热门
    const r = await axios.get('https://api.bilibili.com/x/web-interface/popular', {
      params: { ps: 50, pn: 1 },
      timeout: 12000, headers: HEADERS,
    });
    const all = r.data?.data?.list || [];
    const items = all.slice(0, limit).map(v => ({
      id: 'bili_pop_' + v.bvid,
      platform: 'bilibili', platform_name: 'B站',
      title: v.title || '', transcript: v.desc || '',
      tags: v.tname ? [v.tname] : [],
      author: v.owner?.name || '', author_avatar: v.owner?.face || '',
      cover: v.pic || '',
      video_url: v.short_link_v2 || ('https://www.bilibili.com/video/' + v.bvid),
      views: v.stat?.view || 0, likes: v.stat?.like || 0, comments: v.stat?.reply || 0,
      duration: _fmtDuration(v.duration),
      published_at: v.pubdate ? new Date(v.pubdate * 1000).toISOString() : null,
      source: 'bilibili-popular',
    }));
    return { items, message: '全站热门' };
  },

  async health() {
    try {
      const r = await axios.get('https://api.bilibili.com/x/web-interface/popular', { params: { ps: 1 }, timeout: 5000 });
      return { ok: r.data?.code === 0, message: r.data?.message };
    } catch (e) { return { ok: false, message: e.message }; }
  },
};
