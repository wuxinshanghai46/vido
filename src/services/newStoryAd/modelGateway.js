const pipeline = require('../pipelineModelService');
const { loadSettings } = require('../settingsService');
const storage = require('./storageService');
const providerAdapters = require('./providerAdapterRegistry');
const cancellation = require('./cancellationContext');
const publicReferences = require('./publicReferenceService');

const TEXT_MAX_CANDIDATES = Math.max(1, Math.min(6, Number(process.env.NEW_STORY_AD_TEXT_MAX_CANDIDATES) || 3));
const TEXT_STAGE_BUDGET_MS = Math.max(15000, Math.min(300000, Number(process.env.NEW_STORY_AD_TEXT_STAGE_BUDGET_MS) || 120000));

const FALLBACKS = [
  { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 800, enabled: true },
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
  'new_story_ad.scene_vision': FALLBACKS,
  'new_story_ad.scene_consistency_qa': FALLBACKS,
  'new_story_ad.json_repair': FALLBACKS,
  'new_story_ad.blueprint_language_repair': FALLBACKS,
  'new_story_ad.blueprint_polish': FALLBACKS,
  'new_story_ad.storyboard_language_repair': FALLBACKS,
  'new_story_ad.assist': FALLBACKS,
};

function modelKey(model) {
  const providerId = String(model?.provider_id || '').toLowerCase();
  const modelId = String(model?.model_id || '').toLowerCase();
  let channel = String(model?.billing_channel || model?.channel || '').toLowerCase();
  let endpoint = String(model?.endpoint || '').toLowerCase();
  let wallet = String(model?.wallet || model?.account_group || '').toLowerCase();
  try {
    const provider = (loadSettings().providers || []).find(item => providerMatches(item, providerId));
    const providerModel = (provider?.models || []).find(item => String(item.id || '').toLowerCase() === modelId) || {};
    channel = channel || String(providerModel.billing_channel || providerModel.channel || '').toLowerCase();
    endpoint = endpoint || String(providerModel.endpoint || provider?.api_url || '').toLowerCase();
    wallet = wallet || String(providerModel.wallet || providerModel.account_group || provider?.account_group || '').toLowerCase();
  } catch {}
  return `${providerId}/${modelId}|channel=${channel || 'default'}|endpoint=${endpoint || 'default'}|wallet=${wallet || 'default'}`;
}

function storyUseMatches(model) {
  return ['story', 'chat', 'llm'].includes(String(model?.use || '').toLowerCase());
}

function visionUseMatches(model) {
  const use = String(model?.use || model?.type || '').toLowerCase();
  const id = String(model?.id || model?.model_id || '').toLowerCase();
  return ['vision', 'vlm', 'multimodal'].includes(use)
    || (storyUseMatches(model) && /(?:gpt-4o(?:-mini)?|gemini-(?:2|3))/.test(id));
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

function isConfiguredAndUsable(model, capability = 'story') {
  if (!model || model.enabled === false || !model.provider_id || !model.model_id) return { ok: false, reason: 'disabled_or_incomplete' };
  const { providers } = settingsIndex();
  const provider = providers.find(p => p.enabled && p.api_key && providerMatches(p, model.provider_id));
  if (!provider) return { ok: false, reason: 'provider_disabled_or_missing_key' };
  const providerModel = (provider.models || []).find(m => String(m.id || '') === String(model.model_id || ''));
  if (!providerModel) return { ok: false, reason: 'model_not_found' };
  if (providerModel.enabled === false) return { ok: false, reason: 'model_disabled' };
  if (capability === 'vision' ? !visionUseMatches(providerModel) : !storyUseMatches(providerModel)) {
    return { ok: false, reason: capability === 'vision' ? 'model_not_vision' : 'model_not_text' };
  }
  return { ok: true, provider, providerModel };
}

function settingsVisionCandidates() {
  const { providers } = settingsIndex();
  const rankProvider = (provider) => {
    const hay = `${provider.id || ''} ${provider.preset || ''} ${provider.name || ''}`.toLowerCase();
    if (/deyunai|漫路/.test(hay)) return 10;
    if (/zhipu|智谱/.test(hay)) return 20;
    if (/volc|ark|火山|seedance/.test(hay)) return 30;
    if (/openai/.test(hay)) return 40;
    return 100;
  };
  const out = [];
  const rankModel = (model) => {
    const id = String(model?.id || '').toLowerCase();
    if (id === 'gpt-4o') return 0;
    if (/gemini-2\.5-pro/.test(id)) return 1;
    if (/gemini-2\.5-flash/.test(id)) return 2;
    if (['vision', 'vlm', 'multimodal'].includes(String(model?.use || model?.type || '').toLowerCase())) return 3;
    if (/gemini/.test(id)) return 4;
    if (/gpt-4o-mini/.test(id)) return 5;
    return 20;
  };
  providers
    .filter(provider => provider.enabled && provider.api_key)
    .sort((a, b) => rankProvider(a) - rankProvider(b))
    .forEach(provider => {
      (provider.models || [])
        .filter(model => model.enabled !== false && visionUseMatches(model))
        .forEach((model, index) => out.push({
          provider_id: provider.id,
          model_id: model.id,
          priority: rankProvider(provider) + rankModel(model) + (index / 1000),
          enabled: true,
        }));
    });
  return out;
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
  const consecutiveFailure = Number(row.consecutive_failure_count || 0);
  const latency = Number(row.avg_latency_ms || 0);
  return success * 2 - failure * 4 - consecutiveFailure * 40 - Math.min(8, Math.floor(latency / 15000));
}

function healthState(model) {
  const row = storage.readHealth()[modelKey(model)] || {};
  const cooldownUntil = row.cooldown_until ? new Date(row.cooldown_until).getTime() : 0;
  return {
    ...row,
    circuit_open: Number.isFinite(cooldownUntil) && cooldownUntil > Date.now(),
    cooldown_remaining_ms: Number.isFinite(cooldownUntil) ? Math.max(0, cooldownUntil - Date.now()) : 0,
  };
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
    consecutive_failure_count: 0,
  };
  const classified = ok ? null : classifyError(error);
  const requestRejected = classified && ['INPUT_PERSON_PRIVACY', 'INPUT_SENSITIVE_CONTENT', 'INVALID_PROVIDER_INPUT'].includes(classified.code);
  if (ok) {
    row.success_count = Number(row.success_count || 0) + 1;
    row.consecutive_failure_count = 0;
    row.cooldown_until = '';
    row.last_error_code = '';
    row.last_success_at = new Date().toISOString();
  } else if (requestRejected) {
    // User/input compliance failures do not mean the model endpoint is
    // unhealthy and must never open a provider circuit or reorder models.
    row.last_error_code = classified.code;
    row.last_rejected_at = new Date().toISOString();
  } else {
    row.failure_count = Number(row.failure_count || 0) + 1;
    row.consecutive_failure_count = Number(row.consecutive_failure_count || 0) + 1;
    row.last_error_code = classifyError(error).code;
    row.last_failed_at = new Date().toISOString();
    const code = row.last_error_code;
    if (/AUTH_CONFIG|MODEL_CONFIG/.test(code)) {
      row.cooldown_until = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    } else if (code === 'PROVIDER_BILLING') {
      row.cooldown_until = new Date(Date.now() + 10 * 60 * 1000).toISOString();
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
  const inheritedStage = ['new_story_ad.blueprint_language_repair', 'new_story_ad.blueprint_polish'].includes(stage)
    ? 'new_story_ad.blueprint'
    : (stage === 'new_story_ad.storyboard_language_repair' ? 'new_story_ad.storyboard_table' : stage);
  const configured = pipeline.pickAllEnabled(inheritedStage);
  const defaults = STAGE_FALLBACKS[stage] || FALLBACKS;
  const configuredOrSettings = configured.length ? configured : settingsStoryCandidates();
  return uniqueModels([...configuredOrSettings, ...defaults])
    .map((m, i) => ({ ...m, fallback_rank: i + 1 }))
    .filter(m => isConfiguredAndUsable(m).ok)
    .filter(m => !healthState(m).circuit_open)
    .sort((a, b) => {
      const priorityDelta = Number(a.priority || 999) - Number(b.priority || 999);
      if (priorityDelta) return priorityDelta;
      return getHealthScore(b) - getHealthScore(a);
    });
}

function candidatesForVisionStage(stage) {
  const configured = pipeline.pickAllEnabled(stage);
  return uniqueModels([...configured, ...settingsVisionCandidates()])
    .map((model, index) => ({ ...model, fallback_rank: index + 1 }))
    .filter(model => isConfiguredAndUsable(model, 'vision').ok)
    .filter(model => !healthState(model).circuit_open)
    .sort((a, b) => {
      const priorityDelta = Number(a.priority || 999) - Number(b.priority || 999);
      return priorityDelta || (getHealthScore(b) - getHealthScore(a));
    });
}

function classifyError(error) {
  const msg = String(error?.message || error || '');
  const explicitCode = String(error?.code || '');
  if (['INPUT_PERSON_PRIVACY', 'INPUT_SENSITIVE_CONTENT', 'INVALID_PROVIDER_INPUT'].includes(explicitCode)) {
    return { code: explicitCode, retryable: false };
  }
  if (explicitCode === 'PROVIDER_RESPONSE_INVALID') return { code: explicitCode, retryable: true };
  if (['RATE_LIMIT', 'PROVIDER_5XX', 'TIMEOUT_OR_NETWORK'].includes(explicitCode)) return { code: explicitCode, retryable: true };
  if (['PROVIDER_BILLING', 'AUTH_CONFIG', 'MODEL_CONFIG'].includes(explicitCode)) return { code: explicitCode, retryable: false };
  if (/InputImageSensitiveContentDetected\.PrivacyInformation|input image may contain real person|PrivacyInformation/i.test(msg)) return { code: 'INPUT_PERSON_PRIVACY', retryable: false };
  if (/SensitiveContentDetected|sensitive content/i.test(msg)) return { code: 'INPUT_SENSITIVE_CONTENT', retryable: false };
  if (/InvalidParameter|BadRequest|parameter .* not valid|cannot be mixed/i.test(msg)) return { code: 'INVALID_PROVIDER_INPUT', retryable: false };
  if (/timeout|timed\s*out|ETIMEDOUT|ECONNRESET|socket hang up/i.test(msg)) return { code: 'TIMEOUT_OR_NETWORK', retryable: true };
  if (/insufficient quota|account balance not enough|insufficient balance|balance not enough|["']code["']\s*:\s*(1005|1102)/i.test(msg)) return { code: 'PROVIDER_BILLING', retryable: false };
  if (/429|rate limit|quota/i.test(msg)) return { code: 'RATE_LIMIT', retryable: true };
  if (/token not valid|invalid.*token|api key|unauthorized|401|403/i.test(msg)) return { code: 'AUTH_CONFIG', retryable: false };
  if (/configuration not found|model.*not found|model_not_found|不是可用|没有可用配置|not available|disabled/i.test(msg)) return { code: 'MODEL_CONFIG', retryable: false };
  if (/JSON_PARSE|Unexpected end|Unexpected token/i.test(msg)) return { code: 'MODEL_JSON', retryable: true };
  if (/\bHTTP\s*5\d\d\b|\bstatus(?:\s*code)?\s*[:=]?\s*5\d\d\b|Internal Server Error|Service Unavailable/i.test(msg)) return { code: 'PROVIDER_5XX', retryable: true };
  return { code: 'UNKNOWN', retryable: false };
}

async function generateText({
  taskId = '',
  stage,
  systemPrompt,
  userPrompt,
  maxTokens = 4000,
  temperature = 0.3,
  timeoutMs = 90000,
  skipKb = true,
  maxCandidates = TEXT_MAX_CANDIDATES,
  stageBudgetMs = TEXT_STAGE_BUDGET_MS,
} = {}) {
  if (!stage) throw new Error('剧情广告模型调用缺少阶段标识。');
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
    const error = new Error(`${stage} 没有未熔断的可用文本模型，已立即停止本阶段`);
    error.code = 'MODEL_CIRCUIT_OPEN';
    error.retryable = true;
    throw error;
  }
  const failed = [];
  const stageStarted = Date.now();
  const attemptCandidates = candidates.slice(0, Math.max(1, Math.min(TEXT_MAX_CANDIDATES, Number(maxCandidates) || TEXT_MAX_CANDIDATES)));
  for (let i = 0; i < attemptCandidates.length; i += 1) {
    cancellation.throwIfCancelled(taskId);
    if (Date.now() - stageStarted >= Math.max(5000, Number(stageBudgetMs) || TEXT_STAGE_BUDGET_MS)) break;
    const model = attemptCandidates[i];
    const start = Date.now();
    try {
      const result = await providerAdapters.generateText({
        model: { ...model, _stageId: stage },
        stage,
        taskId,
        systemPrompt,
        userPrompt,
        maxTokens,
        temperature,
        timeoutMs,
        signal: cancellation.signal(),
      });
      cancellation.throwIfCancelled(taskId);
      const text = result.text;
      const latency = Date.now() - start;
      recordHealth(model, { ok: true, latencyMs: latency });
      storage.saveModelCall({
        task_id: taskId,
        stage,
        provider_id: model.provider_id,
        model_id: model.model_id,
        adapter: result.adapter || '',
        family: result.family || '',
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
      if (cancellation.signal()?.aborted) cancellation.throwIfCancelled(taskId);
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
        adapter: '',
        family: '',
        status: 'failed',
        error_code: classified.code,
        error_message: String(err.message || err).slice(0, 500),
        latency_ms: latency,
        fallback_rank: i + 1,
      });
      if (!classified.retryable && i >= attemptCandidates.length - 1) break;
    }
  }
  const retryable = failed.some(item => ['TIMEOUT_OR_NETWORK', 'RATE_LIMIT', 'PROVIDER_5XX', 'MODEL_JSON'].includes(item.code));
  const err = new Error(`${stage} 模型失败预算已耗尽：实际尝试 ${failed.length}/${candidates.length}；${failed.map(x => `${x.provider_id}/${x.model_id}:${x.code}`).join('；')}`);
  err.code = retryable ? 'MODEL_ATTEMPTS_EXHAUSTED' : (failed[0]?.code || 'MODEL_UNAVAILABLE');
  err.retryable = retryable;
  err.attempted_count = failed.length;
  err.candidate_count = candidates.length;
  err.failed_models = failed;
  throw err;
}

async function generateVision({
  taskId = '',
  stage = 'new_story_ad.scene_consistency_qa',
  systemPrompt = '',
  userPrompt = '',
  imageUrls = [],
  maxTokens = 4000,
  timeoutMs = 120000,
  maxCandidates = Math.min(2, TEXT_MAX_CANDIDATES),
  stageBudgetMs = TEXT_STAGE_BUDGET_MS,
} = {}) {
  const referenceDiagnostics = publicReferences.normalizeVisionReferences(imageUrls, { max: 8 });
  const urls = referenceDiagnostics.urls;
  if (!urls.length) {
    const error = new Error(`${stage} 缺少可供视觉模型读取的公网参考图`);
    error.code = 'VISION_REFERENCE_UNAVAILABLE';
    error.retryable = false;
    error.reference_diagnostics = referenceDiagnostics;
    throw error;
  }
  if (process.env.NEW_STORY_AD_MOCK_LLM === '1') {
    return {
      text: JSON.stringify({
        pass: true,
        status: 'verified',
        scene_consistency_score: 0.92,
        anchor_consistency_score: 0.9,
        camera_match_score: 0.9,
        material_match_score: 0.92,
        mismatch_reasons: [],
        anchors: [],
        zones: [],
        geometry_facts: [],
        materials: [],
        lighting: {},
      }),
      used_model: 'mock/new-story-ad-vision',
      fallback_used: false,
      failed_models: [],
      latency_ms: 1,
    };
  }
  const candidates = candidatesForVisionStage(stage);
  if (!candidates.length) {
    const error = new Error(`${stage} 没有未熔断的可用视觉模型，已立即停止本阶段`);
    error.code = 'VISION_CIRCUIT_OPEN';
    error.retryable = true;
    throw error;
  }
  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        ...urls.map(url => ({ type: 'image_url', image_url: { url } })),
      ],
    },
  ];
  const failed = [];
  const stageStarted = Date.now();
  const attemptCandidates = candidates.slice(0, Math.max(1, Math.min(TEXT_MAX_CANDIDATES, Number(maxCandidates) || 1)));
  for (let i = 0; i < attemptCandidates.length; i += 1) {
    cancellation.throwIfCancelled(taskId);
    if (Date.now() - stageStarted >= Math.max(5000, Number(stageBudgetMs) || TEXT_STAGE_BUDGET_MS)) break;
    const model = attemptCandidates[i];
    const start = Date.now();
    try {
      const result = await providerAdapters.generateText({
        model: { ...model, _stageId: stage },
        stage,
        taskId,
        systemPrompt,
        userPrompt,
        messages,
        maxTokens,
        timeoutMs,
        signal: cancellation.signal(),
      });
      cancellation.throwIfCancelled(taskId);
      const latency = Date.now() - start;
      recordHealth(model, { ok: true, latencyMs: latency });
      storage.saveModelCall({
        task_id: taskId, stage, provider_id: model.provider_id, model_id: model.model_id,
        adapter: result.adapter || '', family: result.family || '', status: 'success',
        latency_ms: latency, fallback_rank: i + 1,
      });
      return {
        text: result.text,
        used_model: `${model.provider_id}/${model.model_id}`,
        fallback_used: i > 0,
        failed_models: failed,
        latency_ms: latency,
      };
    } catch (err) {
      if (cancellation.signal()?.aborted) cancellation.throwIfCancelled(taskId);
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
        task_id: taskId, stage, provider_id: model.provider_id, model_id: model.model_id,
        status: 'failed', error_code: classified.code,
        error_message: String(err.message || err).slice(0, 500), latency_ms: latency,
        fallback_rank: i + 1,
      });
    }
  }
  const error = new Error(`${stage} 视觉模型全部失败：${failed.map(item => `${item.provider_id}/${item.model_id}:${item.code}`).join('；')}`);
  error.code = 'VISION_QA_UNAVAILABLE';
  error.retryable = failed.some(item => /TIMEOUT|RATE_LIMIT|NETWORK|5XX/.test(item.code));
  error.failed_models = failed;
  throw error;
}

function mockName(seed = '', idx = 0) {
  const surnames = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜';
  const given = '安然宁清雅知辰一诺可言景舟明远若初思予嘉禾亦晨书衡子墨云舒';
  const text = `${seed || 'new_story_ad_mock'}|${idx}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const base = Math.abs(hash >>> 0);
  const surname = surnames[base % surnames.length];
  const first = given[(base + idx * 5) % given.length];
  const second = given[(Math.floor(base / 11) + idx * 7) % given.length];
  return `${surname}${second === first ? first : `${first}${second}`}`;
}

function mockResponse(stage, userPrompt = '') {
  const primaryName = mockName(userPrompt || stage, 0);
  const supportName = mockName(userPrompt || stage, 1);
  if (/blueprint/.test(stage)) {
    return JSON.stringify({
      story_title: '任务专属剧情广告蓝图',
      logline: '目标用户遇到当前任务描述的问题，广告主体以可见动作解决并形成结果证明。',
      characters: [{ name: primaryName, role: '按当前任务生成的核心人物', profile: '真实人物，承担当前任务需要的主要动作' }],
      beats: [
        { beat_index: 1, role: '痛点', plot: '目标用户看见当前任务里的具体问题', spoken_line: '这个问题需要被更清楚地解决。', visual_proof: '当前任务的问题证据清晰可见' },
        { beat_index: 2, role: '主体亮相', plot: '当前广告主体进入并开始处理', spoken_line: '现在用更直接的方式处理。', visual_proof: '广告主体与问题证据同框' },
        { beat_index: 3, role: '结果证明', plot: '处理结果被看见', spoken_line: '变化已经清楚呈现出来。', visual_proof: '结果变化明确' },
      ],
    });
  }
  if (/qa/.test(stage)) {
    return JSON.stringify({ pass: true, blocking_issues: [], rewrite_issues: [], warnings: [], scores: { commercial: 0.86, shootability: 0.88, character_consistency: 0.9 } });
  }
  if (/assist/.test(stage)) {
    return JSON.stringify({
      brief: '根据当前用户填写的广告需求生成任务专属剧情广告：保留原始产品或服务、目标用户、核心卖点、期望场景和引导动作，不替换成固定行业模板。',
      product_subject: '当前任务广告主体',
      cast_mode: 'auto',
      shot_count: 3,
      forbidden: ['未授权行业', '旧任务人物', '与当前任务无关的主体'],
      characters: [
        { name: primaryName, role: '当前任务核心人物' },
        { name: supportName, role: '当前任务辅助人物' },
      ],
    });
  }
  return JSON.stringify([
    { index: 1, title: '问题出现', role: '痛点', duration: 5, visual: '当前任务场景里，目标用户面对清晰可见的问题证据。', action: `${primaryName}停下当前动作并指出问题来源。`, voiceover: '这个问题需要被更清楚地解决。', dialogue_lines: [{ speaker: primaryName, line: '这里的问题已经影响到了结果。' }], purpose: '痛点', characters: [{ name: primaryName, action: '发现问题' }] },
    { index: 2, title: '主体介入', role: '主体亮相', duration: 8, visual: '当前广告主体与问题证据同框出现。', action: `${primaryName}开始处理并展示当前任务需要的核心步骤。`, voiceover: '现在用更直接的方式处理。', dialogue_lines: [{ speaker: primaryName, line: '先看最关键的一步。' }], purpose: '亮相', characters: [{ name: primaryName, action: '操作或展示主体' }] },
    { index: 3, title: '结果证明', role: '结果证明', duration: 7, visual: '当前任务的结果变化形成可见对比。', action: `${primaryName}确认处理结果并自然收束。`, voiceover: '变化已经清楚呈现出来。', dialogue_lines: [{ speaker: primaryName, line: '现在结果已经清楚了。' }], purpose: '证明', characters: [{ name: primaryName, action: '确认结果' }] },
  ]);
}

module.exports = {
  candidatesForStage,
  candidatesForVisionStage,
  generateText,
  generateVision,
  classifyError,
  isConfiguredAndUsable,
  recordHealth,
  getHealthScore,
  healthState,
};
