/**
 * 知识源 Knowledge Sources
 *
 * 可插拔的 KB 数据来源。每个 source 实现 fetch() 返回新的 KB 文档数组。
 *
 * 内置 3 种基础 source：
 *   1. session_digest  —— 从 docs/sessions/ 的会话日志提炼经验型知识
 *   2. rss_feeds       —— 从配置的 RSS 订阅源获取行业新闻（空配置时跳过）
 *   3. manual_file     —— 从 outputs/kb_manual/*.json 加载用户手动投喂
 *
 * 未来 crawler_engineer 可以加：
 *   - douyin_hot       —— 抖音热门（需反爬）
 *   - tech_blogs       —— 工程博客 RSS
 *   - arxiv            —— 新论文摘要
 *   - youtube_trends   —— YouTube 趋势
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const learningTime = require('./learningTimeService');

// ———————————————————————————————————————————————
// Source 基类
// ———————————————————————————————————————————————
class KnowledgeSource {
  constructor(id, name, opts = {}) {
    this.id = id;
    this.name = name;
    this.enabled = opts.enabled !== false;
    this.opts = opts;
  }

  /**
   * 拉取新知识
   * @param {object} context - { lastRunAt, existingIds }
   * @returns {Promise<Array>} - 新的 KB 文档数组（符合 seedDocs 格式）
   */
  async fetch(context) {
    throw new Error('Not implemented');
  }
}

// ———————————————————————————————————————————————
// Source 1: Session Digest - 从会话日志提炼知识
// ———————————————————————————————————————————————
class SessionDigestSource extends KnowledgeSource {
  constructor(opts = {}) {
    super('session_digest', '会话日志提炼', opts);
  }

  async fetch(context) {
    // 优先读新路径 docs/logs/sessions/，回退到旧路径 docs/sessions/
    const newSessionDir = path.resolve(context.sessionsDir || this.opts.sessionsDir || path.resolve(__dirname, '../../docs/logs/sessions'));
    const legacySessionDir = path.resolve(__dirname, '../../docs/sessions');
    const sessionDir = fs.existsSync(newSessionDir) ? newSessionDir : legacySessionDir;
    if (!fs.existsSync(sessionDir)) return [];

    const files = fs.readdirSync(sessionDir).filter(f => f.endsWith('.md')).sort().reverse();
    if (files.length === 0) return [];

    // 只看昨天和今天的日志
    const today = learningTime.dateKey();
    const yesterday = learningTime.previousDateKey();
    const recentFiles = files.filter(f => f.includes(today) || f.includes(yesterday));
    if (recentFiles.length === 0) return [];

    // 提取"决策/经验/用户偏好"段落，生成一条知识
    const docs = [];
    for (const file of recentFiles) {
      const content = fs.readFileSync(path.join(sessionDir, file), 'utf8');

      // 统一解析项目助理的真实事件标题。候选知识仍需审核，不能因标题中出现关键词就直接成为运行时规则。
      const sections = this.extractKnowledgeSections(content);
      for (const { type, heading, text, index } of sections) {
        if (!text || text.length < 20) continue;
        const stableHeading = this.hash(`${heading}\n${text}`).slice(0, 12);
        const id = `kb_session_${file.replace('.md', '')}_${type}_${stableHeading || index}`;
        if ((context.existingIds || new Set()).has(id)) continue;

        docs.push({
          id,
          source_type: 'session_digest',
          collection: 'engineering',
          subcategory: '自学习机制',
          title: `[session] ${file.replace('.md', '')} ${heading}`,
          summary: `从 ${file} 提取的${type}候选，审核后才能进入正式知识库`,
          content: text.slice(0, 2000),
          facts: type === '验证' ? text.split('\n').map(value => value.replace(/^[-*]\s*/, '').trim()).filter(Boolean).slice(0, 12) : [],
          inferences: [],
          limitations: ['会话日志只能证明项目内决策与执行记录，不能替代外部文章原文或供应商能力证据。'],
          tags: ['session', '知识候选', type],
          keywords: ['session digest', 'auto-extracted'],
          prompt_snippets: [],
          applies_to: this.appliesTo(type),
          source: `docs/logs/sessions/${file} - 候选提取`,
          source_label: `docs/logs/sessions/${file}#${heading}`,
          lang: 'zh',
          enabled: true,
        });
      }
    }
    return docs;
  }

  extractSection(md, title) {
    const re = new RegExp(`##[^\\n]*${title}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`, 'i');
    const m = md.match(re);
    return m ? m[1].trim() : '';
  }

  extractKnowledgeSections(md = '') {
    const rows = [];
    const re = /(?:^|\r?\n)##\s+([^\r\n]+)\r?\n([\s\S]*?)(?=\r?\n##\s+|$)/g;
    const types = [
      ['决策', /决策|决定|授权/],
      ['用户偏好', /用户偏好|偏好|禁忌/],
      ['需求', /用户需求|用户要求|需求/],
      ['反馈', /用户反馈|反馈/],
      ['根因', /根因|Bug|缺陷|异常/],
      ['验证', /验证|验收|核对|审计|发布结果/],
    ];
    let match;
    while ((match = re.exec(String(md || ''))) !== null) {
      const heading = match[1].trim();
      if (/当日概览|事件流水|每日学习事件/.test(heading)) continue;
      const type = types.find(([, pattern]) => pattern.test(heading))?.[0];
      if (!type) continue;
      rows.push({ heading, type, text: match[2].trim(), index: rows.length + 1 });
    }
    return rows;
  }

  appliesTo(type = '') {
    if (type === '根因' || type === '验证') return ['project_manager', 'project_assistant', 'test_engineer', 'workflow_engineer'];
    if (type === '需求' || type === '反馈') return ['product_manager', 'project_manager', 'project_assistant'];
    return ['project_manager', 'project_assistant', 'executive_producer'];
  }

  hash(value = '') {
    let h = 0;
    for (let i = 0; i < value.length; i++) h = ((h << 5) - h + value.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }
}

// ———————————————————————————————————————————————
// Source 2: RSS Feeds - 从配置的 RSS 源获取
// ———————————————————————————————————————————————
class RSSFeedsSource extends KnowledgeSource {
  constructor(opts = {}) {
    super('rss_feeds', 'RSS 订阅源', opts);
    this.feeds = opts.feeds || [];  // [{ url, collection, subcategory, applies_to }]
  }

  async fetch(context) {
    if (this.feeds.length === 0) return [];

    const docs = [];
    for (const feed of this.feeds) {
      try {
        const items = await this.fetchRSS(feed.url);
        for (const item of items.slice(0, 5)) {
          const id = `kb_rss_${this.hash(item.link)}`;
          if ((context.existingIds || new Set()).has(id)) continue;
          docs.push({
            id,
            collection: feed.collection || 'engineering',
            subcategory: feed.subcategory || '行业资讯',
            title: `[RSS] ${item.title}`,
            summary: item.description?.slice(0, 200) || '',
            content: item.description || '',
            tags: ['rss', 'industry-news'],
            keywords: [],
            prompt_snippets: [],
            applies_to: feed.applies_to || ['market_research'],
            source: `RSS: ${feed.url} / ${item.link}`,
            lang: feed.lang || 'zh',
            enabled: true,
          });
        }
      } catch (e) {
        console.warn(`[KB Source] RSS fetch failed: ${feed.url}: ${e.message}`);
      }
    }
    return docs;
  }

  async fetchRSS(url) {
    // 极简 RSS 解析（不引入额外依赖，只处理标准 RSS 2.0 / Atom）
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const xml = await r.text();
      return this.parseRSS(xml);
    } catch (e) {
      throw e;
    }
  }

  parseRSS(xml) {
    const items = [];
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = itemRegex.exec(xml)) !== null) {
      const block = m[1];
      const title = this.extractTag(block, 'title');
      const link = this.extractTag(block, 'link');
      const description = this.extractTag(block, 'description');
      if (title && link) items.push({ title, link, description });
    }
    return items;
  }

  extractTag(block, tag) {
    const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i'));
    return m ? m[1].trim() : '';
  }

  hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }
}

// ———————————————————————————————————————————————
// Source 3: Manual File - 用户手动投喂
// ———————————————————————————————————————————————
class ManualFileSource extends KnowledgeSource {
  constructor(opts = {}) {
    super('manual_file', '手动投喂', opts);
  }

  async fetch(context) {
    const dir = path.resolve(context.manualDir || this.opts.manualDir || path.join(process.env.OUTPUT_DIR || path.resolve(__dirname, '../../outputs'), 'kb_manual'));
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const docs = [];
    for (const file of files) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        const items = Array.isArray(content) ? content : [content];
        for (const item of items) {
          if (!item.id) item.id = `kb_manual_${uuidv4().slice(0, 8)}`;
          if ((context.existingIds || new Set()).has(item.id)) continue;
          docs.push({
            collection: 'engineering',
            subcategory: '手动投喂',
            tags: ['manual'],
            keywords: [],
            prompt_snippets: [],
            applies_to: ['executive_producer'],
            lang: 'zh',
            enabled: true,
            ...item,
            source: item.source || `manual: ${file}`,
          });
        }
      } catch (e) {
        console.warn(`[KB Source] Manual file parse failed: ${file}: ${e.message}`);
      }
    }
    return docs;
  }
}

// ———————————————————————————————————————————————
// Source 注册表（可通过 listSources / addSource 动态管理）
// ———————————————————————————————————————————————
const sources = [
  new SessionDigestSource(),
  new RSSFeedsSource({ feeds: [] }),  // 默认空，用户可配置
  new ManualFileSource(),
];

function listSources() {
  return sources.map(s => ({ id: s.id, name: s.name, enabled: s.enabled }));
}

function getSource(id) {
  return sources.find(s => s.id === id);
}

function addSource(source) {
  sources.push(source);
}

async function fetchAllSources(context = {}) {
  const results = {};
  for (const source of sources) {
    if (!source.enabled) continue;
    try {
      const docs = await source.fetch(context);
      results[source.id] = { count: docs.length, docs };
    } catch (e) {
      results[source.id] = { count: 0, error: e.message };
    }
  }
  return results;
}

module.exports = {
  KnowledgeSource,
  SessionDigestSource,
  RSSFeedsSource,
  ManualFileSource,
  listSources,
  getSource,
  addSource,
  fetchAllSources,
};
