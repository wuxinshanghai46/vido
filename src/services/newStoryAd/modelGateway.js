const { callLLM } = require('../storyService');
const pipeline = require('../pipelineModelService');
const { loadSettings } = require('../settingsService');
const storage = require('./storageService');

const FALLBACKS = [
  { provider_id: 'deepseek', model_id: 'deepseek-chat', priority: 900, enabled: true },
  { provider_id: 'openai', model_id: 'gpt-4o', priority: 910, enabled: true },
  { provider_id: 'openai', model_id: 'gpt-4o-mini', priority: 920, enabled: true },
];

const STAGE_FALLBACKS = {
  'new_story_ad.scene_config': FALLBACKS,
  'new_story_ad.blueprint': FALLBACKS,
  'new_story_ad.storyboard_table': FALLBACKS,
  'new_story_ad.storyboard_rewrite': FALLBACKS,
  'new_story_ad.qa': FALLBACKS,
  'new_story_ad.json_repair': FALLBACKS,
  'new_story_ad.assist': FALLBACKS,
};

function modelKey(model) {
  return `${String(model?.provider_id || '').toLowerCase()}/${String(model?.model_id || '').toLowerCase()}`;
}

function storyUseMatches(model) {
  return ['story', 'chat', 'llm'].includes(String(model?.use || '').toLowerCase());
}

function providerMatches(provider, providerId) {
  const target = String(providerId || '').toLowerCase();
  return [provider.id, provider.preset, provider.name]
    .filter(Boolean)
    .some(v => String(v).toLowerCase() === target);
}

function settingsIndex() {
  const settings = loadSettings();
  const providers = Array.isArray(settings.providers) ? settings.providers : [];
  return { settings, providers };
}

function isConfiguredAndUsable(model) {
  if (!model || model.enabled === false || !model.provider_id || !model.model_id) return { ok: false, reason: 'disabled_or_incomplete' };
  const { providers } = settingsIndex();
  const provider = providers.find(p => p.enabled && p.api_key && providerMatches(p, model.provider_id));
  if (!provider) return { ok: false, reason: 'provider_disabled_or_missing_key' };
  const providerModel = (provider.models || []).find(m => String(m.id || '') === String(model.model_id || ''));
  if (!providerModel) return { ok: false, reason: 'model_not_found' };
  if (providerModel.enabled === false) return { ok: false, reason: 'model_disabled' };
  if (!storyUseMatches(providerModel)) return { ok: false, reason: 'model_not_text' };
  return { ok: true, provider, providerModel };
}

function settingsStoryCandidates() {
  const { providers } = settingsIndex();
  const rankProvider = (p) => {
    const hay = `${p.id || ''} ${p.preset || ''} ${p.name || ''}`.toLowerCase();
    if (/deepseek/.test(hay)) return 10;
    if (/openai/.test(hay)) return 20;
    if (/webang|maas|微众/.test(hay)) return 30;
    if (/deyunai|漫路/.test(hay)) return 40;
    if (/apismile/.test(hay)) return 50;
    return 100;
  };
  const out = [];
  providers
    .filter(p => p.enabled && p.api_key)
    .sort((a, b) => rankProvider(a) - rankProvider(b))
    .forEach((provider) => {
      (provider.models || [])
        .filter(m => m.enabled !== false && storyUseMatches(m))
        .forEach((m, i) => {
          out.push({
            provider_id: provider.id,
            model_id: m.id,
            priority: rankProvider(provider) + i,
            enabled: true,
          });
        });
    });
  return out;
}

function getHealthScore(model) {
  const health = storage.readHealth();
  const key = modelKey(model);
  const row = health[key] || {};
  if (row.cooldown_until && new Date(row.cooldown_until).getTime() > Date.now()) return -10000;
  const success = Number(row.success_count || 0);
  const failure = Number(row.failure_count || 0);
  const latency = Number(row.avg_latency_ms || 0);
  return success * 3 - failure * 5 - Math.min(5, Math.floor(latency / 30000));
}

function recordHealth(model, { ok, error = null, latencyMs = 0 } = {}) {
  if (!model) return;
  const health = storage.readHealth();
  const key = modelKey(model);
  const row = health[key] || {
    provider_id: model.provider_id,
    model_id: model.model_id,
    success_count: 0,
    failure_count: 0,
    avg_latency_ms: 0,
  };
  if (ok) {
    row.success_count = Number(row.success_count || 0) + 1;
    row.cooldown_until = '';
    row.last_error_code = '';
  } else {
    row.failure_count = Number(row.failure_count || 0) + 1;
    row.last_error_code = classifyError(error).code;
    row.last_failed_at = new Date().toISOString();
    const code = row.last_error_code;
    if (row.failure_count >= 3 && /CONFIG|AUTH|MODEL/.test(code)) {
      row.cooldown_until = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    } else if (/TIMEOUT|RATE_LIMIT|NETWORK/.test(code)) {
      row.cooldown_until = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    }
  }
  if (latencyMs) {
    const old = Number(row.avg_latency_ms || 0);
    row.avg_latency_ms = old ? Math.round(old * 0.75 + latencyMs * 0.25) : latencyMs;
  }
  row.updated_at = new Date().toISOString();
  health[key] = row;
  storage.writeHealth(health);
}

function uniqueModels(models) {
  const seen = new Set();
  return (models || []).filter((model) => {
    const key = modelKey(model);
    if (!key || key === '/') return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function candidatesForStage(stage) {
  const configured = pipeline.pickAllEnabled(stage);
  const defaults = STAGE_FALLBACKS[stage] || FALLBACKS;
  const configuredOrSettings = configured.length ? configured : settingsStoryCandidates();
  return uniqueModels([...configuredOrSettings, ...defaults])
    .map((m, i) => ({ ...m, fallback_rank: i + 1 }))
    .filter(m => isConfiguredAndUsable(m).ok)
    .sort((a, b) => {
      const healthDelta = getHealthScore(b) - getHealthScore(a);
      if (healthDelta) return healthDelta;
      return Number(a.priority || 999) - Number(b.priority || 999);
    });
}

function classifyError(error) {
  const msg = String(error?.message || error || '');
  if (/timeout|ETIMEDOUT|ECONNRESET/i.test(msg)) return { code: 'TIMEOUT_OR_NETWORK', retryable: true };
  if (/429|rate limit|quota/i.test(msg)) return { code: 'RATE_LIMIT', retryable: true };
  if (/api key|unauthorized|401|403/i.test(msg)) return { code: 'AUTH_CONFIG', retryable: true };
  if (/model.*not found|model_not_found|不是可用|没有可用配置|not available|disabled/i.test(msg)) return { code: 'MODEL_CONFIG', retryable: true };
  if (/JSON_PARSE|Unexpected end|Unexpected token/i.test(msg)) return { code: 'MODEL_JSON', retryable: true };
  if (/5\d\d|503|502|500/i.test(msg)) return { code: 'PROVIDER_5XX', retryable: true };
  return { code: 'UNKNOWN', retryable: false };
}

async function generateText({
  taskId = '',
  stage,
  systemPrompt,
  userPrompt,
  maxTokens = 4000,
  temperature = 0.3,
  skipKb = true,
} = {}) {
  if (!stage) throw new Error('newStoryAd modelGateway requires stage');
  if (process.env.NEW_STORY_AD_MOCK_LLM === '1') {
    const text = mockResponse(stage, userPrompt);
    return {
      text,
      used_model: 'mock/new-story-ad',
      fallback_used: false,
      failed_models: [],
      latency_ms: 1,
    };
  }
  const candidates = candidatesForStage(stage);
  if (!candidates.length) {
    throw new Error(`${stage} 没有可用文本模型：已过滤关闭供应商、无 Key、disabled 模型和非文本模型`);
  }
  const failed = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const model = candidates[i];
    const start = Date.now();
    try {
      const text = await callLLM(systemPrompt, userPrompt, {
        preferredStoryModel: { ...model, _stageId: stage },
        pipelineStageId: stage,
        agentId: stage,
        requestId: taskId ? `${taskId}:${stage}` : stage,
        maxTokens,
        temperature,
        skipKB: skipKb,
      });
      const latency = Date.now() - start;
      recordHealth(model, { ok: true, latencyMs: latency });
      storage.saveModelCall({
        task_id: taskId,
        stage,
        provider_id: model.provider_id,
        model_id: model.model_id,
        status: 'success',
        latency_ms: latency,
        fallback_rank: i + 1,
      });
      return {
        text,
        used_model: `${model.provider_id}/${model.model_id}`,
        fallback_used: i > 0,
        failed_models: failed,
        latency_ms: latency,
      };
    } catch (err) {
      const latency = Date.now() - start;
      const classified = classifyError(err);
      failed.push({
        provider_id: model.provider_id,
        model_id: model.model_id,
        code: classified.code,
        message: String(err.message || err).slice(0, 300),
      });
      recordHealth(model, { ok: false, error: err, latencyMs: latency });
      storage.saveModelCall({
        task_id: taskId,
        stage,
        provider_id: model.provider_id,
        model_id: model.model_id,
        status: 'failed',
        error_code: classified.code,
        error_message: String(err.message || err).slice(0, 500),
        latency_ms: latency,
        fallback_rank: i + 1,
      });
      if (!classified.retryable && i >= candidates.length - 1) break;
    }
  }
  const err = new Error(`${stage} 模型全部失败：${failed.map(x => `${x.provider_id}/${x.model_id}:${x.code}`).join('；')}`);
  err.failed_models = failed;
  throw err;
}

function mockResponse(stage) {
  if (/blueprint/.test(stage)) {
    return JSON.stringify({
      story_title: '新剧情广告测试蓝图',
      logline: '用户遇到具体问题，广告主体以可见动作解决并形成结果证明。',
      characters: [{ name: '主角A', role: '核心人物', profile: '真实人物，承担主要动作' }],
      beats: [
        { beat_index: 1, role: '痛点', plot: '用户看见具体问题', spoken_line: '这个问题每天都在拖慢效率。', visual_proof: '问题证据清晰可见' },
        { beat_index: 2, role: '主体亮相', plot: '广告主体进入并开始处理', spoken_line: '现在换一种更清楚的处理方式。', visual_proof: '主体与问题同框' },
        { beat_index: 3, role: '结果证明', plot: '结果变化被看见', spoken_line: '处理后的变化一眼就能看出来。', visual_proof: '前后对比明确' },
      ],
    });
  }
  if (/qa/.test(stage)) {
    return JSON.stringify({ pass: true, blocking_issues: [], rewrite_issues: [], warnings: [], scores: { commercial: 0.86, shootability: 0.88, character_consistency: 0.9 } });
  }
  if (/assist/.test(stage)) {
    return JSON.stringify({
      brief: '为一款企业知识库软件生成 30 秒多人剧情广告：张经理、李工和王总在会议室发现资料混乱，随后打开系统展示自动整理、快速检索和客户汇报依据清晰的变化。画面要有高级感，但每一镜都落到具体动作和可见证据。',
      product_subject: '企业知识库软件',
      cast_mode: 'multi',
      shot_count: 3,
      forbidden: ['宠物', '机器人', '旧任务人物'],
      characters: [
        { name: '张经理', role: '项目负责人' },
        { name: '李工', role: '技术同事' },
        { name: '王总', role: '客户决策人' },
      ],
    });
  }
  return JSON.stringify([
    { index: 1, title: '问题出现', role: '痛点', duration: 5, visual: '真实场景里，用户面对清晰可见的问题证据。', action: '用户停下操作并指向问题来源。', voiceover: '这个问题每天都在拖慢效率。', dialogue_lines: [{ speaker: '张经理', line: '这些资料每天都在拖慢交付。' }, { speaker: '李工', line: '我先把问题来源标出来。' }], purpose: '痛点', characters: [{ name: '张经理', action: '发现问题' }, { name: '李工', action: '标注问题' }] },
    { index: 2, title: '主体介入', role: '主体亮相', duration: 8, visual: '广告主体与问题证据同框出现。', action: '主体开始处理并展示核心步骤。', voiceover: '现在换一种更清楚的处理方式。', dialogue_lines: [{ speaker: '李工', line: '我打开系统，先看自动整理结果。' }, { speaker: '张经理', line: '项目资料已经能按客户检索了。' }], purpose: '亮相', characters: [{ name: '李工', action: '操作主体' }, { name: '张经理', action: '查看结果' }] },
    { index: 3, title: '结果证明', role: '结果证明', duration: 7, visual: '前后结果形成可见对比。', action: '用户确认处理结果并自然收束。', voiceover: '处理后的变化一眼就能看出来。', dialogue_lines: [{ speaker: '王总', line: '现在交付依据清楚多了。' }, { speaker: '张经理', line: '这版可以直接进入客户汇报。' }], purpose: '证明', characters: [{ name: '王总', action: '确认结果' }, { name: '张经理', action: '收束汇报' }] },
  ]);
}

module.exports = {
  candidatesForStage,
  generateText,
  classifyError,
  isConfiguredAndUsable,
  recordHealth,
};
