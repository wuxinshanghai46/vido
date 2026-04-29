/**
 * 搜索 providers 注册中心
 *
 * 每个 provider 实现统一接口：
 *   {
 *     id: 'bilibili-popular',
 *     name: 'B站每日热门',
 *     platform: 'bilibili',
 *     requiresKey: false,         // 是否需要 API Key/Cookie
 *     defaultEnabled: true,
 *     async search({ keyword, limit = 24, region }, config) → { items: [...], message }
 *     async health(config) → { ok: true, message }
 *   }
 *
 * items 字段标准化：
 *   { id, platform, platform_name, title, transcript, tags[], author, author_avatar,
 *     cover, video_url, views, likes, comments, duration, published_at, source, raw }
 *
 * 配置持久化到 outputs/search_providers.json:
 *   { providers: { 'youtube': { enabled: true, api_key: '...' }, ... } }
 */

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.resolve(__dirname, '../../../outputs/search_providers.json');

// 各 provider 模块
const providers = {
  'bilibili-popular':  require('./bilibiliPopular'),
  'bilibili-region':   require('./bilibiliRegion'),
  'youtube':           require('./youtube'),
  'weibo':             require('./weibo'),
  'douyin-headless':   require('./douyinHeadless'),
  'xiaohongshu-headless': require('./xiaohongshuHeadless'),
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch {}
  // 默认配置：所有 provider 默认禁用，让用户在设置页主动开启
  // （爆款复刻定位是短视频，B 站长视频站默认不开）
  return {
    providers: {
      'bilibili-popular': { enabled: true },   // 默认开（不需登录、API 稳）
      'bilibili-region':  { enabled: false, region: 'all' },
      'youtube':          { enabled: false, api_key: '' },
      'weibo':            { enabled: false, cookie: '' },
      'douyin-headless':  { enabled: true },   // 默认开（带扫码 cookie 后效果好）
      'xiaohongshu-headless': { enabled: true },
    },
  };
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

function listProviders() {
  return Object.entries(providers).map(([id, p]) => ({
    id,
    name: p.name,
    platform: p.platform,
    requires_key: p.requiresKey || false,
    description: p.description || '',
    config_schema: p.configSchema || {},
  }));
}

function getProvider(id) {
  return providers[id];
}

/** 并行调用所有启用的 provider
 * @param platforms 可选数组 ['douyin','xiaohongshu',...] 仅调对应平台的 provider
 * @param sort 可选 'comprehensive'|'most_play'|'most_like'|'newest'|'completion'
 */
async function searchAll({ keyword, limit = 24, region, platforms, sort = 'comprehensive' }) {
  const config = loadConfig();
  let enabled = Object.entries(config.providers || {})
    .filter(([id, c]) => c.enabled && providers[id]);

  // 按 platforms 过滤
  if (platforms && platforms.length && !platforms.includes('all')) {
    enabled = enabled.filter(([id]) => {
      const p = providers[id];
      return platforms.includes(p.platform) || (p.platform === 'multi');
    });
  }

  const results = [];
  const sources = [];

  await Promise.all(enabled.map(async ([id, providerConfig]) => {
    const p = providers[id];
    try {
      const r = await p.search({ keyword, limit, region }, providerConfig);
      const items = (r.items || []).map(it => ({ ...it, provider_id: id }));
      results.push(...items);
      sources.push({
        provider_id: id,
        name: p.name,
        platform: p.platform,
        count: items.length,
        status: r.needs_login ? 'needs_login' : 'ok',
        message: r.message || '',
        needs_login: !!r.needs_login,
        login_platform: r.login_platform || null,
      });
    } catch (err) {
      sources.push({
        provider_id: id,
        name: p.name,
        platform: p.platform,
        count: 0,
        status: 'error',
        message: err.message,
      });
    }
  }));

  // 兜底：所有 provider 都没结果时调 MCP media-crawler search_keyword
  if (!results.length) {
    try {
      const mcpManager = require('../mcpManager');
      const instances = mcpManager.listInstances ? mcpManager.listInstances() : [];
      const crawler = instances.find(i => i.id === 'media-crawler' && i.status === 'running');
      if (crawler) {
        const platformArg = (platforms && platforms.length && !platforms.includes('all')) ? platforms[0] : 'all';
        const r = await mcpManager.callTool('media-crawler', 'search_keyword', { keyword, platform: platformArg, limit });
        const text = r?.content?.[0]?.text;
        if (text) {
          const data = JSON.parse(text);
          if (data.success && Array.isArray(data.results) && data.results.length) {
            results.push(...data.results.map(it => ({ ...it, provider_id: 'mcp-media-crawler', source: it.platform + '-mcp' })));
            sources.push({
              provider_id: 'mcp-media-crawler', name: 'MCP media-crawler 兜底',
              platform: 'multi', count: data.results.length, status: 'ok',
              message: '所有 headless provider 失败，走 MCP 兜底'
            });
          }
        }
      }
    } catch (err) {
      sources.push({ provider_id: 'mcp-media-crawler', name: 'MCP 兜底', platform: 'multi', count: 0, status: 'error', message: err.message });
    }
  }

  // 按 sort 排序
  const sortFns = {
    most_play: (a, b) => (b.views || 0) - (a.views || 0),
    most_like: (a, b) => (b.likes || 0) - (a.likes || 0),
    newest: (a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0),
    completion: (a, b) => (b.likes || 0) / Math.max(b.views || 1, 1) - (a.likes || 0) / Math.max(a.views || 1, 1),
    comprehensive: (a, b) => (b.views || 0) * 0.6 + (b.likes || 0) * 4 - ((a.views || 0) * 0.6 + (a.likes || 0) * 4),
  };
  const sortFn = sortFns[sort] || sortFns.comprehensive;
  results.sort(sortFn);

  return { results, sources, total: results.length };
}

module.exports = { listProviders, getProvider, loadConfig, saveConfig, searchAll };
