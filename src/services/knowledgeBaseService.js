/**
 * 知识库服务
 * 职责：
 *   1. 提供 KB 文档的上层查询与搜索 API
 *   2. 为各 agent 构建「可注入 systemPrompt 的上下文片段」
 *   3. 启动时增量 seed（已存在 id 跳过）
 *   4. 按团队（研发/运营）分组过滤 KB
 *   5. RAG 风格的动态关键词检索（供 agent 运行时自学习）
 *
 * collection: 'digital_human' | 'drama' | 'storyboard' | 'atmosphere' | 'production' | 'engineering'
 */
const db = require('../models/database');
const seedDocs = require('./knowledgeBaseSeed');
const fs = require('fs');
const path = require('path');

// 自定义 agent 存储（独立 JSON 文件）
const CUSTOM_AGENTS_FILE = path.resolve(__dirname, '../../outputs/custom_agents.json');

function loadCustomAgents() {
  try {
    if (!fs.existsSync(CUSTOM_AGENTS_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(CUSTOM_AGENTS_FILE, 'utf8'));
    return Array.isArray(data.agents) ? data.agents : [];
  } catch {
    return [];
  }
}

function saveCustomAgents(agents) {
  try {
    fs.mkdirSync(path.dirname(CUSTOM_AGENTS_FILE), { recursive: true });
    fs.writeFileSync(CUSTOM_AGENTS_FILE, JSON.stringify({ agents }, null, 2), 'utf8');
  } catch (e) {
    console.warn('[KB] 保存自定义 agent 失败:', e.message);
  }
}

function addCustomAgent(agent) {
  const agents = loadCustomAgents();
  // 去重
  if (agents.find(a => a.id === agent.id)) {
    throw new Error(`agent id 已存在: ${agent.id}`);
  }
  agents.push({ ...agent, custom: true, created_at: new Date().toISOString() });
  saveCustomAgents(agents);
  return agent;
}

function removeCustomAgent(agentId) {
  const agents = loadCustomAgents();
  const idx = agents.findIndex(a => a.id === agentId);
  if (idx === -1) return false;
  agents.splice(idx, 1);
  saveCustomAgents(agents);
  return true;
}

function getCustomAgent(agentId) {
  return loadCustomAgents().find(a => a.id === agentId);
}

// ———————————————————————————————————————————————
// 启动时增量 seed：已存在的 id 跳过，只新增
// ———————————————————————————————————————————————
function ensureSeeded() {
  const before = db.listKnowledgeDocs().length;
  db.bulkInsertKnowledgeDocs(seedDocs);
  const after = db.listKnowledgeDocs().length;
  const added = after - before;
  if (added > 0) {
    console.log(`[KB] seed: +${added} new docs (total ${after})`);
  }
  return { seeded: added > 0, added, total: after };
}

try { ensureSeeded(); } catch (e) {
  console.warn('[KB] 增量 seed 失败:', e.message);
}

// ———————————————————————————————————————————————
// 查询
// ———————————————————————————————————————————————
function listDocs(filter = {}) {
  return db.listKnowledgeDocs({ ...filter, enabledOnly: true });
}

function getDoc(id) {
  return db.getKnowledgeDoc(id);
}

function searchDocs(q, collection) {
  return db.listKnowledgeDocs({ q, collection, enabledOnly: true });
}

// ———————————————————————————————————————————————
// 为 agent 构建静态上下文（用于注入 systemPrompt）
// ———————————————————————————————————————————————
function buildAgentContext(agentType, opts = {}) {
  const { genre, maxDocs = 12, maxCharsPerDoc = 600, includeCache = true } = opts;

  let docs = db.listKnowledgeDocs({ appliesTo: agentType, enabledOnly: true });

  // 如果有全量学习缓存，附加缓存中的知识摘要（不重复）
  if (includeCache) {
    try {
      const cachePath = path.join(path.resolve(process.env.OUTPUT_DIR || './outputs'), 'agent_kb_cache.json');
      if (fs.existsSync(cachePath)) {
        const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        const agentCache = cache[agentType];
        if (agentCache?.knowledge?.length) {
          // 缓存存在，增加可用 docs 上限
          const cachedIds = new Set(docs.map(d => d.id));
          // 从缓存中补充不在当前查询结果中的知识摘要
          // （缓存中已有的知识以 title+summary 形式存储，注入时直接用）
        }
      }
    } catch {}
  }

  if (genre) {
    const g = String(genre).toLowerCase();
    docs.sort((a, b) => {
      const score = d => {
        let s = 0;
        if ((d.subcategory || '').toLowerCase().includes(g)) s += 10;
        if ((d.tags || []).some(t => String(t).toLowerCase().includes(g))) s += 5;
        if ((d.title || '').toLowerCase().includes(g)) s += 3;
        return s;
      };
      return score(b) - score(a);
    });
  }

  const picked = docs.slice(0, maxDocs);
  if (picked.length === 0) return '';

  const lines = picked.map(d => {
    const bullets = [];
    if (d.summary) bullets.push(d.summary);
    if (d.content) {
      const c = d.content.length > maxCharsPerDoc ? d.content.slice(0, maxCharsPerDoc) + '…' : d.content;
      bullets.push(c);
    }
    if ((d.prompt_snippets || []).length) {
      bullets.push('提示词片段: ' + d.prompt_snippets.slice(0, 6).join(' | '));
    }
    if ((d.keywords || []).length) {
      bullets.push('关键词: ' + d.keywords.slice(0, 12).join(', '));
    }
    const header = `【${d.collection}/${d.subcategory || '通用'}】${d.title}`;
    return `${header}\n${bullets.join('\n')}`;
  });

  return [
    '【知识库上下文（由管理后台知识库自动注入，请深度学习并严格遵循下列要点）】',
    ...lines,
    '【上下文结束】',
  ].join('\n\n');
}

// 全量 KB 注入：将该 Agent 的所有知识一次性注入（用于强制学习模式）
function buildFullKBContext(agentType, opts = {}) {
  const { maxCharsPerDoc = 800 } = opts;
  let docs = db.listKnowledgeDocs({ appliesTo: agentType, enabledOnly: true });
  if (docs.length === 0) return '';

  const lines = docs.map(d => {
    const parts = [];
    if (d.summary) parts.push(d.summary);
    if (d.content) {
      const c = d.content.length > maxCharsPerDoc ? d.content.slice(0, maxCharsPerDoc) + '…' : d.content;
      parts.push(c);
    }
    if ((d.prompt_snippets || []).length) {
      parts.push('提示词: ' + d.prompt_snippets.slice(0, 8).join(' | '));
    }
    return `【${d.collection}/${d.subcategory || '通用'}】${d.title}\n${parts.join('\n')}`;
  });

  return [
    `【${agentType} 全量知识库 — 共 ${docs.length} 条知识，请逐条学习并严格遵循】`,
    ...lines,
    '【全量知识库结束】',
  ].join('\n\n');
}

// ———————————————————————————————————————————————
// 【新】RAG 风格动态检索：供 agent 运行时"自学习"
//   - 根据用户 query 的关键词从 KB 动态检索最相关的 N 条
//   - 返回完整内容（不截断），供 agent 深度学习
//
// 用法：
//   const dynamicCtx = kb.searchForAgent('director', '沙漠 末日 孤独 长镜头', { limit: 5 });
// ———————————————————————————————————————————————
function searchForAgent(agentType, query, opts = {}) {
  const { limit = 5, maxCharsPerDoc = 600, team = null } = opts;
  if (!query) return '';

  // 1. 先取该 agent 可用的所有 docs
  let docs = db.listKnowledgeDocs({ appliesTo: agentType, enabledOnly: true });

  // 2. 如果指定了 team，再按团队过滤（双重保险：agent 属于此 team）
  if (team) {
    const teamAgentIds = AGENT_TYPES.filter(a => a.team === team).map(a => a.id);
    if (!teamAgentIds.includes(agentType)) return '';
  }

  // 3. 提取 query 关键词（简单 tokenize）
  const tokens = String(query)
    .toLowerCase()
    .split(/[\s,，。；、\/\|·\-—_]+/)
    .filter(t => t && t.length >= 2);

  if (tokens.length === 0) return '';

  // 4. 打分排序
  const scored = docs.map(d => {
    let score = 0;
    const haystack = [
      d.title, d.summary, d.subcategory,
      (d.tags || []).join(' '),
      (d.keywords || []).join(' '),
      (d.prompt_snippets || []).join(' '),
    ].filter(Boolean).join(' ').toLowerCase();
    const content = (d.content || '').toLowerCase();

    for (const tok of tokens) {
      if (d.title?.toLowerCase().includes(tok)) score += 20;
      if (d.subcategory?.toLowerCase().includes(tok)) score += 15;
      if ((d.tags || []).some(t => String(t).toLowerCase().includes(tok))) score += 10;
      if ((d.keywords || []).some(k => String(k).toLowerCase().includes(tok))) score += 8;
      if (haystack.includes(tok)) score += 3;
      if (content.includes(tok)) score += 1;
    }
    return { d, score };
  }).filter(x => x.score > 0);

  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, limit).map(x => x.d);

  if (picked.length === 0) return '';

  const lines = picked.map(d => {
    const bullets = [];
    if (d.summary) bullets.push(`摘要：${d.summary}`);
    if (d.content) {
      const c = d.content.length > maxCharsPerDoc ? d.content.slice(0, maxCharsPerDoc) + '…' : d.content;
      bullets.push(c);
    }
    if ((d.prompt_snippets || []).length) {
      bullets.push('可复用片段: ' + d.prompt_snippets.slice(0, 8).join(' | '));
    }
    const header = `【${d.collection}/${d.subcategory || '通用'}】${d.title}`;
    return `${header}\n${bullets.join('\n')}`;
  });

  return [
    '【动态检索到的知识（基于你当前任务的关键词匹配，请深度学习并在输出中体现）】',
    ...lines,
    '【动态知识结束】',
  ].join('\n\n');
}

// ———————————————————————————————————————————————
// 【新】团队视图：按团队 (rd/ops) 过滤 KB
// ———————————————————————————————————————————————
function listDocsForTeam(team, filter = {}) {
  const teamAgentIds = AGENT_TYPES.filter(a => a.team === team).map(a => a.id);
  const all = db.listKnowledgeDocs({ ...filter, enabledOnly: true });
  return all.filter(d => (d.applies_to || []).some(a => teamAgentIds.includes(a)));
}

function listAgentsByTeam(team) {
  return AGENT_TYPES.filter(a => a.team === team);
}

// 为团队内某个 agent 统计知识条数
function getAgentStats(agentId) {
  const docs = db.listKnowledgeDocs({ appliesTo: agentId, enabledOnly: true });
  return {
    agentId,
    total_docs: docs.length,
    by_collection: docs.reduce((acc, d) => {
      acc[d.collection] = (acc[d.collection] || 0) + 1;
      return acc;
    }, {}),
  };
}

// ———————————————————————————————————————————————
// 合集元信息
// ———————————————————————————————————————————————
const COLLECTIONS = [
  // ———— 运营团队使用的知识库（内容创作 + 市场营销 + 数据分析）————
  {
    id: 'digital_human',
    name: '数字人知识库',
    team: 'ops',
    desc: '数字人直播/带货/口播/AI 分身的资产与提示词',
    subcategories: ['角色资产库', '口播话术', '带货脚本', '口型与表情', '直播场景', '音色与人设'],
  },
  {
    id: 'drama',
    name: '网剧知识库',
    team: 'ops',
    desc: '网剧/漫剧题材与爆款公式（爽文/男频/女频/悬疑/情感/恐怖/穿越/古装/仙侠/末日等）',
    subcategories: [
      '爽文', '男频文', '女频文', '悬疑文', '情感文', '恐怖小说',
      '穿越文', '古装文', '末日文', '仙侠文', '玄幻文', '武侠文',
      '校园文', '职场文', '重生文',
      '爆款公式', '开篇钩子',
    ],
  },
  {
    id: 'storyboard',
    name: '分镜库',
    team: 'ops',
    desc: '分镜语言/景别/构图/镜头运动/节奏控制/转场/剪辑语法',
    subcategories: ['景别矩阵', '运镜公式', '构图法则', '节奏控制', '转场技法', '分镜模板'],
  },
  {
    id: 'atmosphere',
    name: '氛围库',
    team: 'ops',
    desc: '氛围提示词/光影/色彩/质感/电影感关键词/经典电影美学包',
    subcategories: ['电影感', '材质感', '光影', '色彩', '天气与烟雾', '后期质感', '混合范式'],
  },
  {
    id: 'production',
    name: '制片与运营库',
    team: 'ops',
    desc: '艺术总监 / 市场调研 / 文案 / 剪辑 / 本地化 / 运营 / 制片',
    subcategories: ['市场调研', '艺术总监', '文案策划', '剪辑技巧', '本地化', '运营增长', '制片协调'],
  },
  // ———— 研发团队使用的知识库（只有工程技术）————
  {
    id: 'engineering',
    name: '研发工程库',
    team: 'rd',
    desc: '技术研发：多语言 / 多模型 / 多组件 / 爬虫 / ComfyUI / 工作流 / 测试 / UI设计 / 运维 / 自学习',
    subcategories: [
      '多语言开发', '多模型集成', '多组件设计', '爬虫开发',
      'ComfyUI', '工作流编排',
      '测试工程', 'UI设计', '运维工程',  // v10 新增
      '自学习机制',
    ],
  },
];

// ———————————————————————————————————————————————
// Agent 类型（team 含义：
//   rd = 研发团队（造 VIDO 平台本身的人，只有工程师）
//   ops = 市场运营团队（用 VIDO 运营 AI 视频业务的人，含内容创作 + 市场 + 运营）
// ）
// ———————————————————————————————————————————————
const AGENT_TYPES = [
  // ═════ 研发团队 R&D（造平台的工程师，6 人）═════
  { id: 'backend_engineer', name: '后端工程师', emoji: '🔧', team: 'rd', layer: 'engineering',
    skills: ['Node.js', 'Python', 'Go', 'Rust', 'API 设计', '数据库'],
    desc: '多语言后端，擅长 AI 视频服务的高并发架构' },
  { id: 'frontend_engineer', name: '前端工程师', emoji: '💻', team: 'rd', layer: 'engineering',
    skills: ['React', 'Vue', '原生 JS', '微前端', 'WebGL'],
    desc: '多框架前端，擅长 AI 创作 SaaS UI 工程化' },
  { id: 'algorithm_engineer', name: '算法工程师', emoji: '🧠', team: 'rd', layer: 'engineering',
    skills: ['LLM', 'Diffusion', '多模型集成', 'RAG', 'Fine-tuning'],
    desc: '熟悉 OpenAI/Anthropic/Google/DeepSeek/字节/阿里 全量 API' },
  { id: 'comfyui_engineer', name: 'ComfyUI 工程师', emoji: '🧩', team: 'rd', layer: 'engineering',
    skills: ['节点开发', '工作流设计', '自定义组件', 'ControlNet', 'LoRA 管理'],
    desc: '精通 ComfyUI 核心架构与自定义节点开发' },
  { id: 'crawler_engineer', name: '爬虫工程师', emoji: '🕷️', team: 'rd', layer: 'engineering',
    skills: ['Playwright', 'Puppeteer', 'Scrapy', '反爬对抗', '分布式'],
    desc: '抖音/快手/小红书/TikTok 数据采集专家' },
  { id: 'workflow_engineer', name: '工作流工程师', emoji: '🔄', team: 'rd', layer: 'engineering',
    skills: ['Coze', 'Dify', 'n8n', '工作流编排', '错误处理', '步骤合规'],
    desc: '基于 Coze/ComfyUI 模式构建严格合规的工作流' },
  // 【v10 新增】测试 / UI / 大模型 / 组件 / 运维 5 个 R&D 工程角色
  { id: 'test_engineer', name: '测试工程师', emoji: '🧪', team: 'rd', layer: 'engineering',
    skills: ['黑盒测试', '白盒测试', '自动化测试', '性能测试', '安全测试', 'Jest/Playwright/k6'],
    desc: '全栈测试：单元/集成/E2E/性能/安全，精通测试金字塔和 CI/CD 集成' },
  { id: 'ui_designer', name: 'UI/UX 设计师', emoji: '🖌️', team: 'rd', layer: 'engineering',
    skills: ['设计系统', '组件库', 'Figma', '多端 UI 风格', '用户研究', '原型设计', 'Material/HIG/Fluent'],
    desc: '精通各类设计系统（Material Design / Apple HIG / Microsoft Fluent / Ant Design），负责 VIDO 前后端界面与组件设计' },
  { id: 'llm_engineer', name: '大模型工程师', emoji: '🤖', team: 'rd', layer: 'engineering',
    skills: ['模型接入', 'Prompt 工程', 'Fine-tuning', '模型评估', '路由策略', 'RAG', 'Function Calling'],
    desc: '熟悉 OpenAI/Anthropic/Google/DeepSeek/字节/阿里等全量 API，快速将新模型接入业务并调优' },
  { id: 'component_engineer', name: '组件工程师', emoji: '🧩', team: 'rd', layer: 'engineering',
    skills: ['MCP 协议', 'Skills 系统', '插件架构', '第三方集成', 'Webhook', 'OAuth'],
    desc: '负责接入各类 MCP 连接器、Claude Skills、外部 API 组件，并设计插件识别与调用机制' },
  { id: 'ops_engineer', name: '运维工程师', emoji: '🛡️', team: 'rd', layer: 'engineering',
    skills: ['Docker/K8s', 'CI/CD', '监控告警', '网络安全', 'WAF', '灾难恢复', 'PM2/Nginx'],
    desc: '快速搭建部署 / 服务器性能监控 / 安全防控 / 零宕机部署 / 灾难恢复 / SRE Golden Signals' },

  // 【v12 新增】管理层 - 产品经理 + 项目经理（研发团队的管理核心）
  { id: 'product_manager', name: '产品经理', emoji: '📋', team: 'rd', layer: 'orchestration',
    skills: ['需求分析', 'PRD 撰写', '用户故事', '业务建模', '平台架构理解', '视觉审美', '产品规划', '优先级决策'],
    desc: '既懂业务也懂研发。了解 VIDO 整个平台业务逻辑、实现过程，为后期升级与优化做规划。具备良好视觉审美，能与 UI 设计师对齐' },
  { id: 'project_manager', name: '项目经理', emoji: '🎯', team: 'rd', layer: 'orchestration',
    skills: ['任务承接', '工作分配', '进度跟踪', '风险管理', 'Scrum/Kanban', '跨职能协作', '复盘总结'],
    desc: '研发团队的直接管理者。承接所有任务后按研发工作流拆解分发：需求→PM、UI→设计师、开发→研发、测试→测试、部署→运维，全程跟进' },

  // ═════ 市场运营团队 Ops（用平台运营业务，15 人）═════

  // 内容创作（用 VIDO 产出 AI 视频内容）
  { id: 'screenwriter', name: '编剧', emoji: '✍️', team: 'ops', layer: 'creative',
    skills: ['剧情结构', '对白', '人物弧光', '多集连贯'],
    desc: '世界级漫剧编剧，对标 Seedance 2.0 多镜头叙事' },
  { id: 'director', name: '导演', emoji: '🎬', team: 'ops', layer: 'creative',
    skills: ['分镜设计', '景别选择', '运镜语言', '节奏控制'],
    desc: '电影级导演，对标 Nolan/Villeneuve/Fincher 的视觉语言' },
  { id: 'character_consistency', name: '人物一致性', emoji: '🎭', team: 'ops', layer: 'creative',
    skills: ['角色 Bible', '外貌锁定', 'ID Token', '视觉一致性'],
    desc: 'AI 时代角色设定师，确保跨镜头跨集的视觉一致性' },
  { id: 'art_director', name: '艺术总监', emoji: '🎨', team: 'ops', layer: 'creative',
    skills: ['Style Bible', 'Moodboard', '色彩心理', '系列美学'],
    desc: '系列视觉锚点的建立者和守护者' },

  // 内容制作（把剧本变成成片）
  { id: 'storyboard', name: '分镜师', emoji: '🎥', team: 'ops', layer: 'production',
    skills: ['Shot List', '分镜模板', 'match cut', '构图法则'],
    desc: '精通 Sora 2 / Veo 3.1 / Kling 2.5 多模型 prompt schema' },
  { id: 'atmosphere', name: '氛围师', emoji: '🌫️', team: 'ops', layer: 'production',
    skills: ['电影感', 'high contrast + haze', 'semi metallic', 'volumetric'],
    desc: '电影级氛围关键词库 + 经典电影美学包（沙丘/BR2049/布达佩斯等）' },
  { id: 'digital_human', name: '数字人', emoji: '👤', team: 'ops', layer: 'production',
    skills: ['角色资产库', '口型同步', 'TTS 克隆', '直播话术'],
    desc: '掌握 HeyGen/Synthesia/硅基/Hedra 全工具链' },
  { id: 'editor', name: '剪辑师', emoji: '✂️', team: 'ops', layer: 'production',
    skills: ['Walter Murch 六原则', '音乐驱动剪辑', '3 秒钩子', '转场'],
    desc: '精通 12 种转场 + Match Cut + J/L Cut + Smash Cut' },

  // 市场营销（推广和变现）
  { id: 'market_research', name: '市场调研官', emoji: '🎯', team: 'ops', layer: 'strategy',
    skills: ['热点监控', '竞品分析', '用户画像', '趋势追踪'],
    desc: '对标 Perplexity + Gemini 的全网数据调研能力' },
  { id: 'copywriter', name: '文案策划', emoji: '📝', team: 'ops', layer: 'marketing',
    skills: ['爆款标题', '平台化文案', 'Hashtag 策略', '封面设计', '金句'],
    desc: '对标 ChatGPT + Claude 的多平台文案能力' },
  { id: 'localizer', name: '本地化专家', emoji: '🌍', team: 'ops', layer: 'marketing',
    skills: ['中译英', '文化重写', '题材转译', '多市场适配'],
    desc: '不是翻译，是文化重写。ReelShort/DramaBox 出海专家' },
  { id: 'growth_ops', name: '运营增长', emoji: '📈', team: 'ops', layer: 'marketing',
    skills: ['投流策略', 'A/B 测试', '账号矩阵', 'ROI 优化'],
    desc: '巨量引擎/磁力金牛/千川/Meta Ads 全平台投流' },
  { id: 'social_media_ops', name: '社媒运营', emoji: '📱', team: 'ops', layer: 'marketing',
    skills: ['账号运营', '评论区管理', '私信回复', '社群建设', 'KOL 合作'],
    desc: '矩阵账号日常运营与社区氛围维护' },
  { id: 'data_analyst', name: '数据分析师', emoji: '📊', team: 'ops', layer: 'strategy',
    skills: ['数据看板', '指标拆解', '归因分析', '预测建模'],
    desc: '从播放/完播/付费/留存全链路数据分析' },
  { id: 'executive_producer', name: '制片/总监制', emoji: '🎩', team: 'ops', layer: 'orchestration',
    skills: ['全流程协调', '决策框架', '资源调配', '风险管理'],
    desc: '对标 MoliliClaw 的全流程协调能力' },
  { id: 'project_assistant', name: '项目助理', emoji: '📋', team: 'ops', layer: 'orchestration',
    skills: ['会话日志记录', '每日学习汇总', '修改日志追踪', '部署日志', '跨会话记忆', '日志检索'],
    desc: '负责 VIDO 项目所有操作日志的记录/汇总/检索/跨会话记忆。每天 00:00 自动触发学习任务，每次对话启动自动读取历史日志提供上下文' },
];

// ———————————————————————————————————————————————
// 上层 API
// ———————————————————————————————————————————————
function listCollections() { return COLLECTIONS; }

// v9: listAgentTypes 现在合并内置 22 个 + 自定义
function listAgentTypes() {
  const custom = loadCustomAgents();
  return [...AGENT_TYPES, ...custom];
}

// 组装网剧 pipeline 上下文（保留向后兼容）
function buildDramaPipelineContext(genre) {
  return {
    screenwriter: buildAgentContext('screenwriter', { genre, maxDocs: 4 }),
    director: buildAgentContext('director', { genre, maxDocs: 4 }),
    characterConsistency: buildAgentContext('character_consistency', { genre, maxDocs: 3 }),
    atmosphere: buildAgentContext('atmosphere', { genre, maxDocs: 4 }),
    storyboard: buildAgentContext('storyboard', { genre, maxDocs: 3 }),
  };
}

// ───────────────────────────────────────────────
// 【v9 新增】全平台统一 KB 注入入口：scene → agent(s) 映射
// 用法: const ctx = injectKB({ scene: 'digital_human', query: '产品推广 口播' });
// 返回可直接 prepend 到 systemPrompt 的文本（无匹配返回 ''）
// ───────────────────────────────────────────────
const SCENE_AGENT_MAP = {
  // 数字人
  digital_human: ['digital_human', 'copywriter'],
  avatar_text:   ['digital_human', 'copywriter'],
  avatar_script: ['digital_human', 'copywriter'],
  // 剧情/编剧
  story:         ['screenwriter'],
  screenwriter:  ['screenwriter'],
  drama:         ['screenwriter', 'director'],
  // 分镜/导演
  storyboard:    ['storyboard', 'director'],
  director:      ['director', 'storyboard'],
  // 图像 / 美术
  image:         ['art_director', 'atmosphere'],
  character_image: ['character_consistency', 'art_director'],
  background_image: ['art_director', 'atmosphere'],
  // 视频
  video:         ['director', 'storyboard', 'atmosphere'],
  video_prompt:  ['storyboard', 'atmosphere'],
  // 剪辑
  editor:        ['editor'],
  // 文案/标题/运营
  copy:          ['copywriter'],
  title:         ['copywriter'],
  cover:         ['copywriter', 'art_director'],
  // 本地化
  localize:      ['localizer'],
  // 市场调研
  research:      ['market_research', 'data_analyst'],
  // 工程（内部研发）
  code:          ['backend_engineer', 'algorithm_engineer'],
  frontend:      ['frontend_engineer', 'ui_designer'],
};

function injectKB({ scene, query, limit = 4, maxCharsPerDoc = 500 } = {}) {
  if (!scene) return '';
  const agents = SCENE_AGENT_MAP[scene];
  if (!agents || !agents.length) return '';

  const chunks = [];
  for (const agentType of agents) {
    try {
      let ctx;
      if (query) {
        ctx = searchForAgent(agentType, query, { limit, maxCharsPerDoc });
      } else {
        ctx = buildAgentContext(agentType, { maxDocs: limit, maxCharsPerDoc });
      }
      if (ctx) chunks.push(ctx);
    } catch {}
  }
  return chunks.join('\n\n');
}

module.exports = {
  listDocs,
  getDoc,
  searchDocs,
  buildAgentContext,
  buildDramaPipelineContext,
  injectKB,         // v9 新增：全平台统一 KB 注入入口
  searchForAgent,   // v5 新增：RAG 动态检索
  listDocsForTeam,  // v5 新增：团队过滤
  listAgentsByTeam, // v5 新增：团队名单
  getAgentStats,    // v5 新增：单 agent 知识统计
  listCollections,
  listAgentTypes,
  ensureSeeded,
  COLLECTIONS,
  AGENT_TYPES,
  // v9 新增：自定义 agent
  loadCustomAgents,
  addCustomAgent,
  removeCustomAgent,
  getCustomAgent,
  buildFullKBContext,  // 全量 KB 注入（强制学习模式）
};
