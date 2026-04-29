/** B站分区热门（按品类拉热门，比 popular 更精准） */
const axios = require('axios');

// B站分区 rid 列表（精选常用 14 个）
const REGIONS = [
  { rid: 1,    name: '动画',        key: 'animation' },
  { rid: 13,   name: '番剧',        key: 'bangumi' },
  { rid: 167,  name: '国创',        key: 'guochuang' },
  { rid: 3,    name: '音乐',        key: 'music' },
  { rid: 129,  name: '舞蹈',        key: 'dance' },
  { rid: 4,    name: '游戏',        key: 'game' },
  { rid: 36,   name: '知识',        key: 'knowledge' },
  { rid: 188,  name: '科技',        key: 'tech' },
  { rid: 234,  name: '运动',        key: 'sports' },
  { rid: 223,  name: '汽车',        key: 'car' },
  { rid: 160,  name: '生活',        key: 'life' },
  { rid: 211,  name: '美食',        key: 'food' },
  { rid: 217,  name: '动物圈',      key: 'animal' },
  { rid: 119,  name: '鬼畜',        key: 'kichiku' },
  { rid: 155,  name: '时尚',        key: 'fashion' },
  { rid: 5,    name: '娱乐',        key: 'ent' },
  { rid: 181,  name: '影视',        key: 'cinema' },
  { rid: 11,   name: '电视剧',      key: 'tv' },
];

function _fmtDuration(sec) {
  if (!sec) return '';
  const s = +sec; const m = Math.floor(s / 60); const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

module.exports = {
  name: 'B 站分区热门',
  platform: 'bilibili',
  requiresKey: false,
  description: '可按 18 个分区筛选热门视频',
  configSchema: {
    region: { type: 'select', options: ['all', ...REGIONS.map(r => r.key)], default: 'all', label: '默认分区' },
  },

  REGIONS,

  async search({ keyword = '', limit = 24, region } = {}, config = {}) {
    const targetRegion = region || config.region || 'all';
    const targetRids = targetRegion === 'all' ? REGIONS.map(r => r.rid) : [REGIONS.find(r => r.key === targetRegion)?.rid].filter(Boolean);

    const allVideos = [];
    // 并行拉取所有目标分区
    await Promise.all(targetRids.slice(0, 6).map(async rid => {
      try {
        // ranking_v2 是带星级排名的接口（有真实数据）
        const r = await axios.get('https://api.bilibili.com/x/web-interface/ranking/v2', {
          params: { rid, type: 'all' },
          timeout: 8000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://www.bilibili.com/',
            'Cookie': 'buvid3=A4B1F7D2-3E5C-4A1B-9D8C-E7F1A2B3C4D5infoc',
          }
        });
        const list = r.data?.data?.list || [];
        list.forEach(v => allVideos.push(v));
      } catch (e) {
        console.warn(`[bilibili-region rid=${rid}] failed:`, e.message);
      }
    }));

    const matched = keyword ? allVideos.filter(v => {
      const hay = (v.title || '') + ' ' + (v.owner?.name || '') + ' ' + (v.desc || '') + ' ' + (v.tname || '');
      return hay.toLowerCase().includes(keyword.toLowerCase());
    }) : allVideos;

    const list = matched.slice(0, limit);
    const items = list.map(v => ({
      id: 'bili_rgn_' + v.bvid,
      platform: 'bilibili',
      platform_name: 'B站·' + (v.tname || '分区'),
      title: v.title || '',
      transcript: v.desc || '',
      tags: v.tname ? [v.tname] : [],
      author: v.owner?.name || '',
      author_avatar: v.owner?.face || '',
      cover: v.pic || '',
      video_url: 'https://www.bilibili.com/video/' + v.bvid,
      views: v.stat?.view || 0,
      likes: v.stat?.like || 0,
      comments: v.stat?.reply || 0,
      duration: _fmtDuration(v.duration),
      published_at: v.pubdate ? new Date(v.pubdate * 1000).toISOString() : null,
      source: 'bilibili-region',
      region: v.tname,
    }));

    return {
      items,
      message: `共拉取 ${allVideos.length} 条分区热门${keyword ? `，匹配 ${matched.length} 条` : ''}`,
    };
  },

  async health() {
    try {
      const r = await axios.get('https://api.bilibili.com/x/web-interface/ranking/v2', { params: { rid: 4, type: 'all' }, timeout: 5000 });
      return { ok: r.data?.code === 0, message: r.data?.message };
    } catch (e) { return { ok: false, message: e.message }; }
  },
};
