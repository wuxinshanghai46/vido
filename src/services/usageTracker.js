/**
 * VIDO Usage Tracker — 按实际调用模型记录 Token + 费用
 * 追加写入 outputs/usage_log.jsonl，不阻塞主流程
 */
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.resolve(process.env.OUTPUT_DIR || './outputs', 'usage_log.jsonl');

// USD per 1M tokens (promptTokens × in + completionTokens × out) / 1e6
// 图像/视频模型用 perCall（每次调用固定费用 USD）
const MODEL_PRICES = {
  'deepseek-chat':              { in: 0.14,  out: 0.28  },
  'deepseek-reasoner':          { in: 0.55,  out: 2.19  },
  'deepseek-v3':                { in: 0.27,  out: 1.10  },
  'gpt-4o':                     { in: 2.5,   out: 10    },
  'gpt-4o-mini':                { in: 0.15,  out: 0.60  },
  'gpt-4-turbo':                { in: 10,    out: 30    },
  'gpt-3.5-turbo':              { in: 0.5,   out: 1.5   },
  'claude-opus-4-7':            { in: 15,    out: 75    },
  'claude-sonnet-4-6':          { in: 3,     out: 15    },
  'claude-haiku-4-5-20251001':  { in: 0.80,  out: 4     },
  'claude-3-5-sonnet-20241022': { in: 3,     out: 15    },
  'claude-3-5-haiku-20241022':  { in: 0.80,  out: 4     },
  'qwen-max':                   { in: 2.40,  out: 9.60  },
  'qwen-plus':                  { in: 0.30,  out: 1.20  },
  'qwen-turbo':                 { in: 0.05,  out: 0.20  },
  // 图像（每次调用）
  'nano-banana':                { perCall: 0.04 },
  'seedream-3-0':               { perCall: 0.05 },
};

function estimateCost(model, promptTokens, completionTokens) {
  if (!model) return 0;
  // 模糊匹配：找最长前缀
  let p = MODEL_PRICES[model];
  if (!p) {
    for (const k of Object.keys(MODEL_PRICES)) {
      if (model.includes(k) || k.includes(model.split('-').slice(0, 2).join('-'))) { p = MODEL_PRICES[k]; break; }
    }
  }
  if (!p) return 0;
  if (p.perCall) return p.perCall;
  return ((promptTokens || 0) * p.in + (completionTokens || 0) * p.out) / 1_000_000;
}

/**
 * 记录一次 AI 调用
 * @param {object} event
 *   type        - 'llm' | 'image' | 'video' | 'tts'
 *   provider    - provider id (e.g. 'deepseek', 'openai')
 *   model       - 实际调用的模型 id
 *   promptTokens     - input tokens (LLM)
 *   completionTokens - output tokens (LLM)
 *   costUsd     - 若已知直接传，否则自动估算
 *   durationMs  - 耗时
 *   userId      - 用户 id（可选）
 *   source      - 来源 ('workflow' | 'story' | 'dh' | 'i2v' | ...)
 *   workflowId  - 工作流 id（source=workflow 时）
 *   stepId      - 步骤 id
 */
function trackUsage(event) {
  const costUsd = event.costUsd != null
    ? event.costUsd
    : estimateCost(event.model, event.promptTokens, event.completionTokens);
  const rec = { ts: Date.now(), ...event, costUsd };
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(rec) + '\n');
  } catch (e) {
    console.warn('[usageTracker] write failed:', e.message);
  }
  try {
    const tokenTracker = require('./tokenTracker');
    tokenTracker.record({
      type: event.type || event.category || 'llm',
      provider: event.provider,
      model: event.model,
      promptTokens: event.promptTokens,
      completionTokens: event.completionTokens,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      totalTokens: event.totalTokens,
      videoSeconds: event.videoSeconds,
      imageCount: event.imageCount,
      ttsChars: event.ttsChars,
      costUsd,
      durationMs: event.durationMs,
      status: event.status || 'success',
      userId: event.userId,
      agentId: event.agentId || event.stepId,
      requestId: event.requestId || event.workflowId,
      source: event.source || 'usageTracker',
      operation: event.operation,
      workflowId: event.workflowId,
      stepId: event.stepId,
      usageSource: event.usageSource || 'actual',
      errorMsg: event.errorMsg,
    });
  } catch (e) {
    console.warn('[usageTracker] tokenTracker bridge failed:', e.message);
  }
  return rec;
}

function readUsage({ limit = 500, userId, source, since } = {}) {
  if (!fs.existsSync(LOG_FILE)) return [];
  const raw = fs.readFileSync(LOG_FILE, 'utf8').trim();
  if (!raw) return [];
  let recs = raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (userId) recs = recs.filter(r => r.userId === userId);
  if (source) recs = recs.filter(r => r.source === source);
  if (since) recs = recs.filter(r => r.ts >= since);
  return recs.slice(-limit).reverse();
}

function usageSummary({ hours = 24, userId } = {}) {
  const since = Date.now() - hours * 3600 * 1000;
  const recs = readUsage({ limit: 20000, userId, since });
  const byModel = {};
  let totalCost = 0;
  for (const r of recs) {
    const k = r.model || 'unknown';
    if (!byModel[k]) byModel[k] = { model: k, provider: r.provider, calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };
    byModel[k].calls++;
    byModel[k].promptTokens += r.promptTokens || 0;
    byModel[k].completionTokens += r.completionTokens || 0;
    byModel[k].costUsd += r.costUsd || 0;
    totalCost += r.costUsd || 0;
  }
  return {
    hours,
    totalCalls: recs.length,
    totalCostUsd: Number(totalCost.toFixed(6)),
    models: Object.values(byModel).sort((a, b) => b.costUsd - a.costUsd),
  };
}

module.exports = { trackUsage, readUsage, usageSummary, estimateCost };
