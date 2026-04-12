/**
 * Token 使用追踪服务
 *
 * 功能：
 *   1. 维护各模型的定价表（$/1M tokens）
 *   2. record() 记录每次调用 → outputs/token_usage.json
 *   3. getStats() 聚合统计（按 provider/model/agent/日期）
 *   4. 预算管理（可配置月度预算，计算剩余）
 */

const db = require('../models/database');
const { v4: uuidv4 } = require('uuid');

// ═══════════════════════════════════════════════════
// 定价表（USD / 1M tokens，[input_price, output_price]）
// 来源：各厂商 2025 年 10 月官方公开定价
// 未匹配的模型会被记为 0 费用
// ═══════════════════════════════════════════════════
const PRICING = {
  // OpenAI
  'gpt-4o':              [2.50, 10.00],
  'gpt-4o-mini':         [0.15, 0.60],
  'gpt-4o-2024-11-20':   [2.50, 10.00],
  'gpt-4-turbo':         [10.00, 30.00],
  'gpt-4':               [30.00, 60.00],
  'gpt-3.5-turbo':       [0.50, 1.50],
  'o1':                  [15.00, 60.00],
  'o1-mini':             [3.00, 12.00],
  'o1-preview':          [15.00, 60.00],
  'sora':                [0, 0],  // 视频模型，按时长计费，单独处理

  // Anthropic Claude
  'claude-opus-4-6':     [15.00, 75.00],
  'claude-sonnet-4-6':   [3.00, 15.00],
  'claude-haiku-4-5':    [0.80, 4.00],
  'claude-3-5-sonnet-20241022': [3.00, 15.00],
  'claude-3-5-haiku-20241022':  [0.80, 4.00],
  'claude-3-opus-20240229':     [15.00, 75.00],

  // Google Gemini
  'gemini-2.0-flash':    [0.10, 0.40],
  'gemini-2.0-pro':      [1.25, 5.00],
  'gemini-1.5-pro':      [1.25, 5.00],
  'gemini-1.5-flash':    [0.075, 0.30],

  // DeepSeek
  'deepseek-chat':       [0.14, 0.28],
  'deepseek-reasoner':   [0.55, 2.19],
  'deepseek-v3':         [0.14, 0.28],

  // 阿里通义
  'qwen-max':            [2.80, 8.40],
  'qwen-plus':           [0.80, 2.00],
  'qwen-turbo':          [0.30, 0.60],
  'qwen2.5-72b':         [0.80, 2.00],

  // 字节豆包
  'doubao-pro-4k':       [0.80, 2.00],
  'doubao-pro-32k':      [0.80, 2.00],
  'doubao-pro-128k':     [5.00, 9.00],
  'doubao-lite-4k':      [0.30, 0.60],

  // Kimi
  'moonshot-v1-8k':      [1.68, 1.68],
  'moonshot-v1-32k':     [3.36, 3.36],
  'moonshot-v1-128k':    [8.40, 8.40],

  // 智谱 GLM
  'glm-4-plus':          [7.00, 7.00],
  'glm-4-0520':          [14.00, 14.00],
  'glm-4-air':           [0.14, 0.14],
  'glm-4-flash':         [0, 0],  // 免费

  // 百度文心
  'ernie-4.0':           [16.80, 16.80],
  'ernie-3.5':           [1.68, 1.68],
  'ernie-speed':         [0, 0],

  // Grok / xAI
  'grok-2':              [2.00, 10.00],
  'grok-beta':           [5.00, 15.00],

  // 视频模型（按秒计费，这里放占位，需要单独的 video pricing）
  // kling 视频: ~$0.10/s
  // sora 视频: ~$0.50/s
  // veo: ~$0.35/s
};

// 视频模型的单位价格（USD / 秒）
const VIDEO_PRICING = {
  'kling-v1':       0.05,
  'kling-v2':       0.10,
  'kling-v2-master':0.15,
  'sora-2':         0.50,
  'veo-3':          0.35,
  'veo-3.1':        0.35,
  'runway-gen-4':   0.20,
  'luma-ray-2':     0.10,
  'pika-2.1':       0.08,
  'seedance-2.0':   0.10,
  'hailuo-01':      0.08,
  'cogvideox':      0,  // 免费
  'hunyuan-video':  0,  // 开源
};

// TTS 模型按字符计费（USD / 1M chars）
const TTS_PRICING = {
  'elevenlabs-turbo-v2':  15.00,
  'elevenlabs-multilingual-v2': 30.00,
  'openai-tts-1':         15.00,
  'openai-tts-1-hd':      30.00,
  'fish-audio':           0,  // 自部署免费
  'minimax-speech-02':    1.00,
};

// 图像模型按张计费（USD / 张）
const IMAGE_PRICING = {
  'dall-e-3':             0.04,
  'dall-e-3-hd':          0.08,
  'stable-diffusion-xl':  0.002,
  'flux-pro':             0.05,
  'flux-dev':             0.025,
  'flux-schnell':         0.003,
  'midjourney':           0.02,
  'seedream-5':           0.01,
};

// ═══════════════════════════════════════════════════
// record - 记录一次调用
// ═══════════════════════════════════════════════════
/**
 * @param {object} p
 * @param {string} p.provider         - 如 'openai' / 'deepseek' / 'anthropic'
 * @param {string} p.model            - 如 'gpt-4o' / 'deepseek-chat'
 * @param {string} p.category         - 'llm' | 'video' | 'image' | 'tts'
 * @param {number} [p.inputTokens=0]
 * @param {number} [p.outputTokens=0]
 * @param {number} [p.videoSeconds=0] - 视频时长（秒）
 * @param {number} [p.imageCount=0]   - 图像张数
 * @param {number} [p.ttsChars=0]     - TTS 字符数
 * @param {number} [p.durationMs=0]   - 调用耗时
 * @param {string} [p.status='success'] - 'success' | 'fail'
 * @param {string} [p.userId]
 * @param {string} [p.agentId]
 * @param {string} [p.requestId]
 * @param {string} [p.errorMsg]
 */
function record(p) {
  try {
    const {
      provider, model, category = 'llm',
      inputTokens = 0, outputTokens = 0,
      videoSeconds = 0, imageCount = 0, ttsChars = 0,
      durationMs = 0, status = 'success',
      userId = null, agentId = null, requestId = null,
      errorMsg = null,
    } = p;

    // 计算成本
    let cost = 0;
    if (category === 'llm') {
      const [inPrice, outPrice] = PRICING[model] || [0, 0];
      cost = (inputTokens / 1_000_000) * inPrice + (outputTokens / 1_000_000) * outPrice;
    } else if (category === 'video') {
      const unitPrice = VIDEO_PRICING[model] || 0;
      cost = videoSeconds * unitPrice;
    } else if (category === 'image') {
      const unitPrice = IMAGE_PRICING[model] || 0;
      cost = imageCount * unitPrice;
    } else if (category === 'tts') {
      const unitPrice = TTS_PRICING[model] || 0;
      cost = (ttsChars / 1_000_000) * unitPrice;
    }

    const row = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      provider, model, category,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      video_seconds: videoSeconds,
      image_count: imageCount,
      tts_chars: ttsChars,
      cost_usd: Number(cost.toFixed(6)),
      duration_ms: durationMs,
      status,
      user_id: userId,
      agent_id: agentId,
      request_id: requestId,
      error_msg: errorMsg,
    };

    db.insertTokenUsage(row);
    return row;
  } catch (e) {
    console.warn('[TokenTracker] record failed:', e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════
// getStats - 聚合统计
// ═══════════════════════════════════════════════════
function getStats({ from, to, days } = {}) {
  // 默认最近 7 天
  if (!from && days) {
    const d = new Date(Date.now() - days * 86400000);
    from = d.toISOString();
  }
  if (!from) {
    from = new Date(Date.now() - 7 * 86400000).toISOString();
  }

  const records = db.listTokenUsage({ from, to });

  const stats = {
    range: { from, to: to || new Date().toISOString() },
    total_calls: records.length,
    total_tokens: records.reduce((s, r) => s + (r.total_tokens || 0), 0),
    total_input_tokens: records.reduce((s, r) => s + (r.input_tokens || 0), 0),
    total_output_tokens: records.reduce((s, r) => s + (r.output_tokens || 0), 0),
    total_cost_usd: Number(records.reduce((s, r) => s + (r.cost_usd || 0), 0).toFixed(4)),
    total_video_seconds: records.reduce((s, r) => s + (r.video_seconds || 0), 0),
    total_image_count: records.reduce((s, r) => s + (r.image_count || 0), 0),
    success_count: records.filter(r => r.status === 'success').length,
    fail_count: records.filter(r => r.status === 'fail').length,
  };

  // 按 category 汇总
  stats.by_category = groupAggregate(records, 'category');
  // 按 provider 汇总
  stats.by_provider = groupAggregate(records, 'provider');
  // 按 model 汇总
  stats.by_model = groupAggregate(records, 'model');
  // 按 agent 汇总
  stats.by_agent = groupAggregate(records, 'agent_id');
  // 按天汇总（最多 30 天）
  stats.by_day = groupByDay(records);

  return stats;
}

function groupAggregate(records, field) {
  const groups = {};
  for (const r of records) {
    const key = r[field] || '(unknown)';
    if (!groups[key]) {
      groups[key] = {
        key,
        calls: 0,
        tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        success: 0,
        fail: 0,
      };
    }
    const g = groups[key];
    g.calls++;
    g.tokens += r.total_tokens || 0;
    g.input_tokens += r.input_tokens || 0;
    g.output_tokens += r.output_tokens || 0;
    g.cost_usd += r.cost_usd || 0;
    if (r.status === 'success') g.success++;
    else g.fail++;
  }
  return Object.values(groups)
    .map(g => ({ ...g, cost_usd: Number(g.cost_usd.toFixed(4)) }))
    .sort((a, b) => b.cost_usd - a.cost_usd);
}

function groupByDay(records) {
  const byDay = {};
  for (const r of records) {
    const day = r.timestamp?.slice(0, 10) || 'unknown';
    if (!byDay[day]) {
      byDay[day] = { day, calls: 0, tokens: 0, cost_usd: 0 };
    }
    byDay[day].calls++;
    byDay[day].tokens += r.total_tokens || 0;
    byDay[day].cost_usd += r.cost_usd || 0;
  }
  return Object.values(byDay)
    .map(d => ({ ...d, cost_usd: Number(d.cost_usd.toFixed(4)) }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

// 最近 N 条调用
function listRecent(limit = 50) {
  const records = db.listTokenUsage();
  return records.slice(0, limit);
}

// ═══════════════════════════════════════════════════
// 预算管理
// ═══════════════════════════════════════════════════
const BUDGET_FILE = require('path').resolve(__dirname, '../../outputs/token_budget.json');
const fs = require('fs');

function loadBudget() {
  try {
    if (fs.existsSync(BUDGET_FILE)) {
      return JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
    }
  } catch {}
  return { monthly_budget_usd: 0, alert_threshold: 0.8 };  // 0 = 无限
}

function saveBudget(budget) {
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(budget, null, 2), 'utf8');
}

function getBudgetStatus() {
  const budget = loadBudget();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const records = db.listTokenUsage({ from: monthStart.toISOString() });
  const usedCost = records.reduce((s, r) => s + (r.cost_usd || 0), 0);

  const hasBudget = budget.monthly_budget_usd > 0;
  return {
    monthly_budget_usd: budget.monthly_budget_usd,
    alert_threshold: budget.alert_threshold,
    month_start: monthStart.toISOString(),
    used_cost_usd: Number(usedCost.toFixed(4)),
    remaining_usd: hasBudget ? Number((budget.monthly_budget_usd - usedCost).toFixed(4)) : null,
    used_percent: hasBudget ? Number((usedCost / budget.monthly_budget_usd * 100).toFixed(1)) : null,
    alerting: hasBudget && (usedCost / budget.monthly_budget_usd) >= budget.alert_threshold,
    has_budget: hasBudget,
  };
}

// ═══════════════════════════════════════════════════
// 服务器监控（CPU / 内存 / uptime / 负载）
// ═══════════════════════════════════════════════════
function getServerMetrics() {
  const os = require('os');
  const process = require('process');

  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const loadAvg = os.loadavg();

  // CPU 使用率 (avg of all cores)
  let totalIdle = 0, totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  }
  const cpuUsagePercent = ((1 - totalIdle / totalTick) * 100).toFixed(1);

  // 进程内存
  const procMem = process.memoryUsage();

  return {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    node_version: process.version,
    uptime_seconds: Math.floor(process.uptime()),
    system_uptime_seconds: Math.floor(os.uptime()),
    cpu: {
      count: cpus.length,
      model: cpus[0]?.model || 'unknown',
      usage_percent: parseFloat(cpuUsagePercent),
      load_avg_1m: loadAvg[0],
      load_avg_5m: loadAvg[1],
      load_avg_15m: loadAvg[2],
    },
    memory: {
      total_bytes: totalMem,
      used_bytes: usedMem,
      free_bytes: freeMem,
      used_percent: Number(((usedMem / totalMem) * 100).toFixed(1)),
      total_gb: Number((totalMem / 1024 / 1024 / 1024).toFixed(2)),
      used_gb: Number((usedMem / 1024 / 1024 / 1024).toFixed(2)),
    },
    process_memory: {
      rss_mb: Number((procMem.rss / 1024 / 1024).toFixed(1)),
      heap_used_mb: Number((procMem.heapUsed / 1024 / 1024).toFixed(1)),
      heap_total_mb: Number((procMem.heapTotal / 1024 / 1024).toFixed(1)),
      external_mb: Number((procMem.external / 1024 / 1024).toFixed(1)),
    },
  };
}

// ═══════════════════════════════════════════════════
// 告警检查（简单阈值）
// ═══════════════════════════════════════════════════
function checkAlerts() {
  const alerts = [];

  // 预算告警
  const budget = getBudgetStatus();
  if (budget.alerting) {
    alerts.push({
      level: 'warning',
      type: 'budget',
      message: `本月 Token 消耗已达预算 ${budget.used_percent}% ($${budget.used_cost_usd}/$${budget.monthly_budget_usd})`,
    });
  }

  // 服务器告警
  const metrics = getServerMetrics();
  if (metrics.memory.used_percent > 90) {
    alerts.push({
      level: 'critical',
      type: 'memory',
      message: `内存使用率 ${metrics.memory.used_percent}% 已超 90%`,
    });
  }
  if (metrics.cpu.usage_percent > 80) {
    alerts.push({
      level: 'warning',
      type: 'cpu',
      message: `CPU 使用率 ${metrics.cpu.usage_percent}% 已超 80%`,
    });
  }
  if (metrics.cpu.load_avg_5m > metrics.cpu.count * 2) {
    alerts.push({
      level: 'warning',
      type: 'load',
      message: `5 分钟负载 ${metrics.cpu.load_avg_5m} 过高`,
    });
  }

  // 最近失败率告警
  const recent = db.listTokenUsage({
    from: new Date(Date.now() - 3600000).toISOString(),  // 最近 1 小时
  });
  if (recent.length >= 10) {
    const failRate = recent.filter(r => r.status === 'fail').length / recent.length;
    if (failRate > 0.2) {
      alerts.push({
        level: 'critical',
        type: 'fail_rate',
        message: `最近 1 小时失败率 ${(failRate * 100).toFixed(1)}% 超过 20%`,
      });
    }
  }

  return alerts;
}

module.exports = {
  record,
  getStats,
  listRecent,
  loadBudget,
  saveBudget,
  getBudgetStatus,
  getServerMetrics,
  checkAlerts,
  PRICING,
  VIDEO_PRICING,
  TTS_PRICING,
  IMAGE_PRICING,
};
