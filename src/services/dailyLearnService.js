/**
 * 每日自动学习服务
 *
 * 功能：
 *   1. 每天 00:00 自动触发（Node 原生 setTimeout，无新依赖）
 *   2. 从所有 knowledgeSources 拉取新知识并增量写入 KB
 *   3. 对每个 agent 计算"今天新增了哪些相关的 KB 条目"
 *   4. 为每个 agent 生成 daily digest 写入 docs/learning/YYYY-MM-DD/<agent_id>.md
 *   5. 生成总日 digest 写入 docs/learning/YYYY-MM-DD/_summary.md
 *   6. 写入会话日志 docs/sessions/YYYY-MM-DD.md 记录学习事件
 */

const fs = require('fs');
const path = require('path');
const db = require('../models/database');
const kb = require('./knowledgeBaseService');
const sources = require('./knowledgeSources');

// ═══════════════════════════════════════════════════
// 【v7 统一日志目录】所有日志集中在 docs/logs/ 下
//   docs/logs/
//     ├── sessions/        对话会话日志 (按天)
//     ├── learning/        每日学习 digest (按天)
//     ├── changes/         代码/配置修改日志 (按天)
//     ├── deployments/     部署记录 (按天)
//     └── README.md        日志索引
// ═══════════════════════════════════════════════════
const LOGS_ROOT = path.resolve(__dirname, '../../docs/logs');
const LEARNING_DIR = path.join(LOGS_ROOT, 'learning');
const SESSIONS_DIR = path.join(LOGS_ROOT, 'sessions');
const CHANGES_DIR = path.join(LOGS_ROOT, 'changes');
const DEPLOYMENTS_DIR = path.join(LOGS_ROOT, 'deployments');
const STATE_FILE = path.resolve(__dirname, '../../outputs/daily_learn_state.json');

// 启动时一次性迁移：docs/sessions / docs/learning → docs/logs/{sessions,learning}
function migrateLogsFromLegacy() {
  try {
    fs.mkdirSync(LOGS_ROOT, { recursive: true });
    fs.mkdirSync(LEARNING_DIR, { recursive: true });
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.mkdirSync(CHANGES_DIR, { recursive: true });
    fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });

    const legacyMap = [
      { from: path.resolve(__dirname, '../../docs/sessions'), to: SESSIONS_DIR },
      { from: path.resolve(__dirname, '../../docs/learning'), to: LEARNING_DIR },
    ];
    for (const { from, to } of legacyMap) {
      if (!fs.existsSync(from)) continue;
      const entries = fs.readdirSync(from);
      for (const entry of entries) {
        const src = path.join(from, entry);
        const dst = path.join(to, entry);
        if (fs.existsSync(dst)) continue;
        try {
          fs.renameSync(src, dst);
        } catch {
          // 跨设备重命名失败 → 复制
          copyRecursive(src, dst);
        }
      }
      // 清理空目录
      try {
        if (fs.readdirSync(from).length === 0) fs.rmdirSync(from);
      } catch {}
    }
  } catch (e) {
    console.warn('[DailyLearn] 日志迁移失败:', e.message);
  }
}

function copyRecursive(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      copyRecursive(path.join(src, f), path.join(dst, f));
    }
  } else {
    fs.copyFileSync(src, dst);
  }
}

// 启动时立即迁移 + 确保 README 存在
migrateLogsFromLegacy();
ensureLogsReadme();

function ensureLogsReadme() {
  const readmePath = path.join(LOGS_ROOT, 'README.md');
  if (fs.existsSync(readmePath)) return;
  const content = `# VIDO 项目日志索引

> 由 **📋 项目助理 agent (project_assistant)** 自动维护
> 所有日志按类型分目录，按日期分文件

## 目录结构

\`\`\`
docs/logs/
├── sessions/           # 对话会话日志（人机交互记录）
│   └── YYYY-MM-DD.md
├── learning/           # 每日 00:00 自动学习 digest
│   └── YYYY-MM-DD/
│       ├── _summary.md         # 当日总结
│       └── <agent_id>.md       # 每个 agent 的学习报告
├── changes/            # 代码/配置修改日志
│   └── YYYY-MM-DD.md
├── deployments/        # 部署记录
│   └── YYYY-MM-DD.md
└── README.md           # 本文件
\`\`\`

## 日志类型说明

### 📝 sessions - 会话日志
记录用户与 Claude Code 的每次对话，包含：
- 用户需求
- 关键决策
- 文件修改摘要
- 用户反馈
- 用户偏好积累

### 🎓 learning - 每日学习
每天 00:00 由 \`dailyLearnService\` 自动触发：
1. 从所有 knowledgeSources 拉取新知识
2. 增量写入 KB
3. 为 22 个 agent 各生成一份 digest
4. 追加事件到当天 sessions 日志

### 🔧 changes - 修改日志
代码/配置/数据的修改历史，便于事后回溯。

### 🚀 deployments - 部署日志
每次部署到生产的详细记录（部署时间 / 改动清单 / 验证结果）。

## 项目助理协议

每次对话启动时：
1. Glob 扫描 \`docs/logs/sessions/*.md\` + \`docs/logs/changes/*.md\`
2. 读取最近 3-5 天
3. 内化上下文

对话进行中：
- 每个"有意义的操作单元"完成后追加到对应目录
- 跨天自动归档到新文件

## API 端点

- \`GET /api/admin/logs/tree\` - 返回完整日志树
- \`POST /api/admin/daily-learn/trigger\` - 手动触发每日学习
- \`GET /api/admin/daily-learn/recent?days=3\` - 读最近 N 天 digest
`;
  try {
    fs.writeFileSync(readmePath, content, 'utf8');
  } catch (e) {
    console.warn('[DailyLearn] README 写入失败:', e.message);
  }
}

// ———————————————————————————————————————————————
// 状态持久化（记录上次运行时间 + 上次 KB 快照）
// ———————————————————————————————————————————————
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch {}
  return { lastRunAt: null, lastSnapshot: [] };
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.warn('[DailyLearn] saveState failed:', e.message);
  }
}

// ———————————————————————————————————————————————
// 主流程：每日学习
// ———————————————————————————————————————————————
async function runDailyLearn({ manual = false } = {}) {
  const runId = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const startTime = new Date();
  console.log(`[DailyLearn] 🌅 开始每日学习 (${manual ? '手动' : '自动'}) - ${today}`);

  const state = loadState();
  const existingIds = new Set(state.lastSnapshot);

  // Step 1: 从所有 source 拉新知识
  let fetchResults = {};
  let newDocsFromSources = [];
  try {
    fetchResults = await sources.fetchAllSources({
      lastRunAt: state.lastRunAt,
      existingIds,
    });
    for (const [sid, result] of Object.entries(fetchResults)) {
      if (result.docs) newDocsFromSources.push(...result.docs);
    }
  } catch (e) {
    console.error('[DailyLearn] fetchAllSources failed:', e.message);
  }

  // Step 2: 增量写入 KB
  if (newDocsFromSources.length > 0) {
    try {
      db.bulkInsertKnowledgeDocs(newDocsFromSources);
      console.log(`[DailyLearn] ✓ 从 source 新增 ${newDocsFromSources.length} 条 KB`);
    } catch (e) {
      console.warn('[DailyLearn] bulkInsert failed:', e.message);
    }
  }

  // Step 3: 计算昨今 KB 差分
  const currentDocs = db.listKnowledgeDocs({ enabledOnly: true });
  const currentIds = new Set(currentDocs.map(d => d.id));
  const newDocs = currentDocs.filter(d => !existingIds.has(d.id));

  console.log(`[DailyLearn] KB 快照变化: ${state.lastSnapshot.length} → ${currentDocs.length} (+${newDocs.length})`);

  // Step 4: 为每个 agent 生成 daily digest
  const agentTypes = kb.listAgentTypes();
  const digestDir = path.join(LEARNING_DIR, today);
  fs.mkdirSync(digestDir, { recursive: true });

  const agentDigests = [];
  for (const agent of agentTypes) {
    const agentNewDocs = newDocs.filter(d => (d.applies_to || []).includes(agent.id));
    const digest = generateAgentDigest(agent, agentNewDocs, currentDocs);
    const filePath = path.join(digestDir, `${agent.id}.md`);
    fs.writeFileSync(filePath, digest, 'utf8');
    agentDigests.push({
      agent_id: agent.id,
      agent_name: agent.name,
      new_docs_count: agentNewDocs.length,
      total_docs: currentDocs.filter(d => (d.applies_to || []).includes(agent.id)).length,
      digest_file: `docs/learning/${today}/${agent.id}.md`,
    });
  }

  // Step 5: 生成总日 digest
  const summary = generateDailySummary({
    today,
    startTime,
    fetchResults,
    newDocsFromSources: newDocsFromSources.length,
    totalKBChange: {
      before: state.lastSnapshot.length,
      after: currentDocs.length,
      added: newDocs.length,
    },
    agentDigests,
  });
  fs.writeFileSync(path.join(digestDir, '_summary.md'), summary, 'utf8');

  // Step 6: 追加到会话日志
  appendToSessionLog(today, {
    runId,
    manual,
    newDocsCount: newDocs.length,
    agentCount: agentTypes.length,
  });

  // Step 7: 保存状态
  saveState({
    lastRunAt: startTime.toISOString(),
    lastSnapshot: Array.from(currentIds),
  });

  const duration = Date.now() - runId;
  console.log(`[DailyLearn] 🎓 完成 (耗时 ${duration}ms) - 新增 ${newDocs.length} 条 / ${agentTypes.length} 个 agent 已生成 digest`);

  return {
    success: true,
    today,
    duration_ms: duration,
    new_docs: newDocs.length,
    total_docs: currentDocs.length,
    agent_digests: agentDigests,
    summary_file: `docs/learning/${today}/_summary.md`,
  };
}

// ———————————————————————————————————————————————
// 为单个 agent 生成 digest
// ———————————————————————————————————————————————
function generateAgentDigest(agent, newDocs, allDocs) {
  const today = new Date().toISOString().slice(0, 10);
  const agentDocs = allDocs.filter(d => (d.applies_to || []).includes(agent.id));

  const lines = [];
  lines.push(`# ${agent.emoji} ${agent.name} 每日学习报告`);
  lines.push('');
  lines.push(`> 日期: ${today}  `);
  lines.push(`> Agent ID: \`${agent.id}\`  `);
  lines.push(`> 团队: ${agent.team === 'rd' ? '🔬 研发团队' : '📣 市场运营团队'}  `);
  lines.push(`> 层级: ${agent.layer}  `);
  lines.push('');
  lines.push('## 个人档案');
  lines.push(`- **职责**: ${agent.desc || '-'}`);
  lines.push(`- **技能**: ${(agent.skills || []).join(' / ')}`);
  lines.push('');
  lines.push('## 知识库状态');
  lines.push(`- **总知识**: ${agentDocs.length} 条`);
  lines.push(`- **今日新增**: ${newDocs.length} 条`);
  lines.push('');

  if (newDocs.length > 0) {
    lines.push('## 🆕 今日新学习的内容');
    newDocs.forEach((doc, i) => {
      lines.push(`### ${i + 1}. ${doc.title}`);
      lines.push(`- **合集**: \`${doc.collection}/${doc.subcategory || '通用'}\``);
      if (doc.summary) lines.push(`- **摘要**: ${doc.summary}`);
      if ((doc.keywords || []).length) lines.push(`- **关键词**: ${doc.keywords.slice(0, 10).join(', ')}`);
      if (doc.source) lines.push(`- **来源**: ${doc.source}`);
      lines.push('');
      if (doc.content) {
        const preview = doc.content.slice(0, 500) + (doc.content.length > 500 ? '…' : '');
        lines.push('**核心内容**:');
        lines.push('```');
        lines.push(preview);
        lines.push('```');
        lines.push('');
      }
    });

    lines.push('## 📝 学习反思');
    lines.push(`作为一名 **${agent.name}**，我今天新学到了 ${newDocs.length} 条知识。`);
    lines.push(`这些知识将在下次任务中自动注入到我的 system prompt，帮助我做出更专业的决策。`);
    lines.push('');
  } else {
    lines.push('## 今日无新增学习');
    lines.push('');
    lines.push('知识库中没有新增与我相关的内容。');
    lines.push('已有的 ' + agentDocs.length + ' 条知识继续作为我的能力基座。');
    lines.push('');
  }

  lines.push('---');
  lines.push(`*此报告由 VIDO 项目助理每日 00:00 自动生成*`);

  return lines.join('\n');
}

// ———————————————————————————————————————————————
// 生成总日 summary
// ———————————————————————————————————————————————
function generateDailySummary({ today, startTime, fetchResults, newDocsFromSources, totalKBChange, agentDigests }) {
  const lines = [];
  lines.push(`# VIDO AI 团队每日学习总结 - ${today}`);
  lines.push('');
  lines.push(`> 自动生成于 ${startTime.toISOString()}  `);
  lines.push(`> 触发时机: 每日 00:00 UTC  `);
  lines.push('');
  lines.push('## 📊 学习概览');
  lines.push('');
  lines.push(`- **KB 总量变化**: ${totalKBChange.before} → ${totalKBChange.after} (+${totalKBChange.added})`);
  lines.push(`- **从 source 新增**: ${newDocsFromSources} 条`);
  lines.push(`- **涉及 agent 数**: ${agentDigests.length}`);
  lines.push(`- **产出 digest 文件**: ${agentDigests.length + 1} 份`);
  lines.push('');

  lines.push('## 🧩 知识源采集结果');
  lines.push('');
  for (const [sid, result] of Object.entries(fetchResults)) {
    if (result.error) {
      lines.push(`- ❌ \`${sid}\`: 失败 - ${result.error}`);
    } else {
      lines.push(`- ✅ \`${sid}\`: ${result.count} 条`);
    }
  }
  lines.push('');

  lines.push('## 👥 Agent 学习明细');
  lines.push('');
  lines.push('| Agent | 团队 | 今日新增 | 总知识 |');
  lines.push('|---|---|---|---|');

  const agentTypes = kb.listAgentTypes();
  const agentMap = {};
  agentTypes.forEach(a => { agentMap[a.id] = a; });
  const rdAgents = agentDigests.filter(d => agentMap[d.agent_id]?.team === 'rd');
  const opsAgents = agentDigests.filter(d => agentMap[d.agent_id]?.team === 'ops');

  rdAgents.forEach(d => {
    const a = agentMap[d.agent_id] || {};
    lines.push(`| ${a.emoji || ''} ${d.agent_name} | 🔬 研发 | ${d.new_docs_count} | ${d.total_docs} |`);
  });
  opsAgents.forEach(d => {
    const a = agentMap[d.agent_id] || {};
    lines.push(`| ${a.emoji || ''} ${d.agent_name} | 📣 运营 | ${d.new_docs_count} | ${d.total_docs} |`);
  });
  lines.push('');

  lines.push('## 📁 Digest 文件');
  lines.push('');
  agentDigests.forEach(d => {
    lines.push(`- [${d.agent_name}](${d.agent_id}.md) - ${d.new_docs_count} 条新增`);
  });
  lines.push('');
  lines.push('---');
  lines.push(`*由 dailyLearnService 自动生成*`);

  return lines.join('\n');
}

// ———————————————————————————————————————————————
// 追加到会话日志
// ———————————————————————————————————————————————
function appendToSessionLog(today, data) {
  try {
    const logFile = path.join(SESSIONS_DIR, `${today}.md`);
    const timestamp = new Date().toTimeString().slice(0, 5);
    const entry = `
## [${timestamp}] 每日学习事件${data.manual ? '（手动触发）' : '（自动 00:00）'}
- KB 新增: ${data.newDocsCount} 条
- Agent digest: ${data.agentCount} 份
- 详情: docs/learning/${today}/_summary.md
`;
    // 如果日志文件不存在就创建
    if (!fs.existsSync(logFile)) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      const header = `# VIDO 会话日志 - ${today}\n\n> 自动生成 · 项目助理维护 · 一天一文件\n\n## 当日概览\n\n自动化任务记录\n\n## 事件流水\n`;
      fs.writeFileSync(logFile, header, 'utf8');
    }
    fs.appendFileSync(logFile, entry, 'utf8');
  } catch (e) {
    console.warn('[DailyLearn] appendToSessionLog failed:', e.message);
  }
}

// ———————————————————————————————————————————————
// 调度器：每天 00:00 执行
// ———————————————————————————————————————————————
function scheduleDaily(hour = 0, minute = 0) {
  const schedule = () => {
    const now = new Date();
    const next = new Date();
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next - now;

    console.log(`[DailyLearn] ⏰ 下次运行: ${next.toLocaleString()} (${Math.round(delay / 1000 / 60)} 分钟后)`);

    setTimeout(async () => {
      try {
        await runDailyLearn({ manual: false });
      } catch (e) {
        console.error('[DailyLearn] 运行失败:', e.message);
      }
      schedule();  // 递归注册下一次
    }, delay);
  };

  schedule();
}

// ———————————————————————————————————————————————
// 只读最近 N 天的 digest（给 agent 启动时读取）
// ———————————————————————————————————————————————
function readRecentDigests(days = 3) {
  if (!fs.existsSync(LEARNING_DIR)) return [];
  const dirs = fs.readdirSync(LEARNING_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse()
    .slice(0, days);
  return dirs.map(date => {
    const summaryFile = path.join(LEARNING_DIR, date, '_summary.md');
    return {
      date,
      summary: fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf8').slice(0, 3000) : '(no summary)',
    };
  });
}

// ———————————————————————————————————————————————
// 强制全量学习：让所有 Agent 一次性学习全部 KB
// 生成精简摘要并缓存到 outputs/agent_kb_cache.json
// 后续每次 buildAgentContext 可以自动附加这个缓存
// ———————————————————————————————————————————————
async function forceFullStudy() {
  const kb = require('./knowledgeBaseService');
  const today = new Date().toISOString().slice(0, 10);
  console.log(`[ForceStudy] 🎓 开始强制全量学习...`);

  const agentTypes = kb.listAgentTypes();
  const allDocs = kb.listDocs({ enabledOnly: true });
  const digestDir = path.join(LEARNING_DIR, today);
  fs.mkdirSync(digestDir, { recursive: true });

  const results = [];
  for (const agent of agentTypes) {
    const agentDocs = allDocs.filter(d => (d.applies_to || []).includes(agent.id));
    // 生成全量 digest（包含所有知识的完整内容）
    const digest = generateFullStudyDigest(agent, agentDocs);
    const filePath = path.join(digestDir, `${agent.id}_full.md`);
    fs.writeFileSync(filePath, digest, 'utf8');

    results.push({
      agent_id: agent.id,
      agent_name: agent.name,
      total_docs: agentDocs.length,
      digest_file: filePath,
    });
    console.log(`[ForceStudy] ✓ ${agent.name}: ${agentDocs.length} 条知识已学习`);
  }

  // 保存学习缓存：每个 agent 的知识摘要
  const cacheFile = path.join(path.resolve(process.env.OUTPUT_DIR || './outputs'), 'agent_kb_cache.json');
  const cache = {};
  for (const agent of agentTypes) {
    const agentDocs = allDocs.filter(d => (d.applies_to || []).includes(agent.id));
    cache[agent.id] = {
      total_docs: agentDocs.length,
      last_study: new Date().toISOString(),
      // 存储每条知识的核心内容（title + summary）供快速注入
      knowledge: agentDocs.map(d => ({
        id: d.id,
        title: d.title,
        collection: d.collection,
        summary: d.summary || '',
        key_points: (d.prompt_snippets || []).slice(0, 5),
      })),
    };
  }
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), 'utf8');

  console.log(`[ForceStudy] 🎓 全量学习完成: ${agentTypes.length} 个 Agent / ${allDocs.length} 条知识`);
  return {
    success: true,
    agent_count: agentTypes.length,
    total_docs: allDocs.length,
    results,
    cache_file: cacheFile,
  };
}

function generateFullStudyDigest(agent, docs) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push(`# ${agent.emoji} ${agent.name} 全量知识学习报告`);
  lines.push(`> 日期: ${today} · 强制全量学习模式`);
  lines.push(`> 总知识条数: ${docs.length}`);
  lines.push('');

  // 按 collection 分组
  const groups = {};
  docs.forEach(d => {
    const key = d.collection || 'unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });

  for (const [collection, collDocs] of Object.entries(groups)) {
    lines.push(`## 📚 ${collection} (${collDocs.length} 条)`);
    lines.push('');
    collDocs.forEach((d, i) => {
      lines.push(`### ${i + 1}. ${d.title}`);
      if (d.summary) lines.push(`**摘要**: ${d.summary}`);
      if (d.content) lines.push(`**内容**: ${d.content}`);
      if ((d.prompt_snippets || []).length) lines.push(`**提示词**: ${d.prompt_snippets.join(' | ')}`);
      if ((d.keywords || []).length) lines.push(`**关键词**: ${d.keywords.join(', ')}`);
      lines.push('');
    });
  }

  lines.push('---');
  lines.push(`*强制全量学习 · ${today} · VIDO AI 团队*`);
  return lines.join('\n');
}

module.exports = {
  runDailyLearn,
  scheduleDaily,
  readRecentDigests,
  generateAgentDigest,
  forceFullStudy,
};
