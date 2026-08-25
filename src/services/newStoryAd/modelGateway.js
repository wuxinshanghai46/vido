const crypto = require('crypto');
const pipeline = require('../pipelineModelService');
const { loadSettings } = require('../settingsService');
const storage = require('./storageService');
const providerAdapters = require('./providerAdapterRegistry');
const cancellation = require('./cancellationContext');
const publicReferences = require('./publicReferenceService');
const localVisionReferences = require('./localVisionReferenceService');
const jsonRepair = require('./jsonRepairService');

const TEXT_MAX_CANDIDATES = Math.max(1, Math.min(6, Number(process.env.NEW_STORY_AD_TEXT_MAX_CANDIDATES) || 3));
const VISION_MAX_CANDIDATES = Math.max(1, Math.min(6, Number(process.env.NEW_STORY_AD_VISION_MAX_CANDIDATES) || 5));
const TEXT_STAGE_BUDGET_MS = Math.max(15000, Math.min(300000, Number(process.env.NEW_STORY_AD_TEXT_STAGE_BUDGET_MS) || 120000));
const REFERENCE_SYNTHESIS_STAGE = 'new_story_ad.reference_video_synthesis';
const RECENT_TEXT_SUCCESS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MANAGED_RECOVERY_FALLBACK_STAGES = new Set([
  REFERENCE_SYNTHESIS_STAGE,
  'new_story_ad.assist',
  'new_story_ad.person_plan_character',
  'new_story_ad.brief_dialogue',
  'new_story_ad.story_facts',
  'new_story_ad.story_facts_compact_retry',
  'new_story_ad.story_facts_repair',
  'new_story_ad.asset_plan_section_patch',
]);

const FALLBACKS = [
  { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 800, enabled: true },
  { provider_id: 'deepseek', model_id: 'deepseek-chat', priority: 900, enabled: true },
  { provider_id: 'openai', model_id: 'gpt-4o', priority: 910, enabled: true },
  { provider_id: 'openai', model_id: 'gpt-4o-mini', priority: 920, enabled: true },
];

const REFERENCE_SYNTHESIS_RECOVERY_FALLBACKS = [
  { provider_id: 'aiapi', model_id: 'deepseek-chat', priority: 850, enabled: true },
  ...FALLBACKS,
];

const STAGE_FALLBACKS = {
  'new_story_ad.asset_plan': FALLBACKS,
  'new_story_ad.person_plan_character': FALLBACKS,
  'new_story_ad.asset_plan_scene_recovery': FALLBACKS,
  'new_story_ad.asset_plan_missing_sections_recovery': FALLBACKS,
  'new_story_ad.asset_plan_section_patch': FALLBACKS,
  'new_story_ad.asset_plan_story_development': FALLBACKS,
  'new_story_ad.asset_plan_scene_coverage_recovery': FALLBACKS,
  'new_story_ad.scene_config': FALLBACKS,
  'new_story_ad.blueprint': FALLBACKS,
  'new_story_ad.storyboard_table': FALLBACKS,
  'new_story_ad.storyboard_rewrite': FALLBACKS,
  'new_story_ad.qa': FALLBACKS,
  'new_story_ad.scene_vision': FALLBACKS,
  'new_story_ad.scene_consistency_qa': FALLBACKS,
  'new_story_ad.reference_video_vision': FALLBACKS,
  'new_story_ad.reference_video_synthesis': REFERENCE_SYNTHESIS_RECOVERY_FALLBACKS,
  'new_story_ad.json_repair': FALLBACKS,
  'new_story_ad.blueprint_language_repair': FALLBACKS,
  'new_story_ad.blueprint_polish': FALLBACKS,
  'new_story_ad.storyboard_language_repair': FALLBACKS,
  'new_story_ad.assist': FALLBACKS,
  'new_story_ad.brief_dialogue': [
    { provider_id: 'apismile', model_id: 'gemini-2.5-flash', priority: 1, enabled: true },
    { provider_id: 'aiapi', model_id: 'deepseek-chat', priority: 2, enabled: true },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 3, enabled: true },
  ],
};

const STAGE_ROUTE_INHERITANCE = Object.freeze({
  'new_story_ad.asset_plan': 'new_story_ad.scene_config',
  'new_story_ad.asset_plan_scene_recovery': 'new_story_ad.scene_config',
  'new_story_ad.asset_plan_missing_sections_recovery': 'new_story_ad.scene_config',
  'new_story_ad.asset_plan_story_development': 'new_story_ad.scene_config',
  'new_story_ad.asset_plan_scene_coverage_recovery': 'new_story_ad.scene_config',
  'new_story_ad.blueprint_language_repair': 'new_story_ad.blueprint',
  'new_story_ad.blueprint_structure_repair': 'new_story_ad.blueprint',
  'new_story_ad.blueprint_polish': 'new_story_ad.blueprint',
  'new_story_ad.storyboard_language_repair': 'new_story_ad.storyboard_table',
});

function routeStage(stage = '') {
  const normalized = String(stage || '').trim();
  // Every registered model-calling stage is independently configurable in
  // 模型调用管理. Inheritance remains only for unknown legacy stage IDs.
  if (pipeline.getStageMeta(normalized)) return normalized;
  return STAGE_ROUTE_INHERITANCE[normalized] || normalized;
}

function modelKey(model) {
  const providerId = String(model?.provider_id || '').toLowerCase();
  const modelId = String(model?.model_id || '').toLowerCase();
  let channel = String(model?.billing_channel || model?.channel || '').toLowerCase();
  let endpoint = String(model?.endpoint || '').toLowerCase();
  let wallet = String(model?.wallet || model?.account_group || '').toLowerCase();
  let credential = '';
  try {
    const provider = (loadSettings().providers || []).find(item => providerMatches(item, providerId));
    const providerModel = (provider?.models || []).find(item => String(item.id || '').toLowerCase() === modelId) || {};
    channel = channel || String(providerModel.billing_channel || providerModel.channel || '').toLowerCase();
    endpoint = endpoint || String(providerModel.endpoint || provider?.api_url || '').toLowerCase();
    wallet = wallet || String(providerModel.wallet || providerModel.account_group || provider?.account_group || '').toLowerCase();
    if (provider?.api_key) {
      credential = crypto.createHash('sha256').update(String(provider.api_key)).digest('hex').slice(0, 12);
    }
  } catch {}
  return `${providerId}/${modelId}|channel=${channel || 'default'}|endpoint=${endpoint || 'default'}|wallet=${wallet || 'default'}|credential=${credential || 'none'}`;
}

function failureDomainKey(model = {}) {
  const providerId = String(model.provider_id || '').trim().toLowerCase();
  const modelId = String(model.model_id || '').trim().toLowerCase();
  let endpoint = String(model.endpoint || '').trim().toLowerCase();
  let wallet = String(model.wallet || model.account_group || '').trim().toLowerCase();
  let credential = '';
  try {
    const provider = (loadSettings().providers || []).find(item => providerMatches(item, providerId));
    const providerModel = (provider?.models || []).find(item => String(item.id || '').trim().toLowerCase() === modelId) || {};
    endpoint = endpoint || String(providerModel.endpoint || provider?.api_url || provider?.base_url || '').trim().toLowerCase();
    wallet = wallet || String(providerModel.wallet || providerModel.account_group || provider?.account_group || '').trim().toLowerCase();
    if (provider?.api_key) credential = crypto.createHash('sha256').update(String(provider.api_key)).digest('hex').slice(0, 12);
  } catch {}
  let endpointIdentity = endpoint;
  try {
    const parsed = new URL(endpoint);
    endpointIdentity = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {}
  return `endpoint=${endpointIdentity || `provider:${providerId || 'unknown'}`}|wallet=${wallet || 'default'}|credential=${credential || 'none'}`;
}

function rateLimitDomainHealthKey(model = {}) {
  return `rate_limit_domain:${crypto.createHash('sha256').update(failureDomainKey(model)).digest('hex').slice(0, 32)}`;
}

const failureDomainSubmissionTails = new Map();

async function acquireFailureDomainSubmission(model = {}) {
  const key = rateLimitDomainHealthKey(model);
  const previous = failureDomainSubmissionTails.get(key) || Promise.resolve();
  let openNext;
  const gate = new Promise(resolve => { openNext = resolve; });
  const tail = previous.catch(() => {}).then(() => gate);
  failureDomainSubmissionTails.set(key, tail);
  await previous.catch(() => {});
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openNext();
    if (failureDomainSubmissionTails.get(key) === tail) failureDomainSubmissionTails.delete(key);
  };
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
  const contract = providerAdapters.validateDeyunaiTextContract(provider, providerModel);
  if (!contract.ok) return contract;
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
    if (/glm-4\.6v/.test(id)) return 0;
    if (/gemini-2\.5-pro/.test(id)) return 1;
    if (/glm-4\.5v/.test(id)) return 1;
    if (id === 'glm-4v') return 2;
    if (/gemini-2\.5-flash/.test(id)) return 2;
    if (/glm-4v-flash/.test(id)) return 3;
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
  const row = healthState(model);
  if (row.circuit_open) return -10000;
  const success = Number(row.success_count || 0);
  const failure = Number(row.failure_count || 0);
  const consecutiveFailure = Number(row.consecutive_failure_count || 0);
  const latency = Number(row.avg_latency_ms || 0);
  return success * 2 - failure * 4 - consecutiveFailure * 40 - Math.min(8, Math.floor(latency / 15000));
}

function healthState(model) {
  const health = storage.readHealth();
  const row = health[modelKey(model)] || {};
  const domain = health[rateLimitDomainHealthKey(model)] || {};
  const modelCooldownUntil = row.cooldown_until ? new Date(row.cooldown_until).getTime() : 0;
  const domainCooldownUntil = domain.cooldown_until ? new Date(domain.cooldown_until).getTime() : 0;
  const cooldownUntil = Math.max(
    Number.isFinite(modelCooldownUntil) ? modelCooldownUntil : 0,
    Number.isFinite(domainCooldownUntil) ? domainCooldownUntil : 0,
  );
  const domainRateLimited = Number.isFinite(domainCooldownUntil) && domainCooldownUntil > Date.now();
  return {
    ...row,
    circuit_open: row.blocked_until_config_change === true
      || cooldownUntil > Date.now(),
    cooldown_remaining_ms: Math.max(0, cooldownUntil - Date.now()),
    rate_limit_domain_cooldown: domainRateLimited,
    last_error_code: row.blocked_until_config_change === true
      ? String(row.last_error_code || 'AUTH_CONFIG')
      : (domainRateLimited ? 'RATE_LIMIT' : String(row.last_error_code || '')),
  };
}

function textReliabilityTier(model, at = Date.now()) {
  const row = healthState(model);
  const successCount = Number(row.success_count || 0);
  const failureCount = Number(row.failure_count || 0);
  const lastSuccessAt = Date.parse(row.last_success_at || '');
  if (successCount > 0 && Number.isFinite(lastSuccessAt)
    && at - lastSuccessAt <= RECENT_TEXT_SUCCESS_WINDOW_MS) return 0;
  if (successCount > 0) return 1;
  if (failureCount <= 0) return 2;
  return 3;
}

/**
 * Reference synthesis is an expensive terminal stage. Prefer endpoints that
 * have actually succeeded recently so three unverified configuration entries
 * cannot consume the complete attempt budget ahead of proven fallbacks.
 */
function preferReliableTextCandidates(candidates = [], stage = '', at = Date.now()) {
  if (String(stage || '') !== REFERENCE_SYNTHESIS_STAGE) return candidates.slice();
  return candidates
    .map((model, index) => ({ model, index, tier: textReliabilityTier(model, at) }))
    .sort((left, right) => left.tier - right.tier || left.index - right.index)
    .map(item => item.model);
}

function providerRetryDelayMs(error = {}, at = Date.now()) {
  const headers = error?.response?.headers || error?.headers || {};
  const header = (name) => {
    if (typeof headers?.get === 'function') return String(headers.get(name) || '').trim();
    const key = Object.keys(headers || {}).find(item => String(item).toLowerCase() === name);
    return String(key ? headers[key] : '').trim();
  };
  const explicit = Number(error?.provider_retry_after_ms || error?.retryAfterMs
    || error?.response?.data?.retry_after_ms || 0);
  let delay = Number.isFinite(explicit) && explicit > 0 ? explicit : 0;
  const retryAfter = header('retry-after');
  if (!delay && /^\d+(?:\.\d+)?$/.test(retryAfter)) delay = Number(retryAfter) * 1000;
  if (!delay && retryAfter) {
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) delay = retryAt - Number(at || Date.now());
  }
  if (!delay) {
    const bodySeconds = Number(error?.response?.data?.retry_after || error?.response?.data?.error?.retry_after || 0);
    if (Number.isFinite(bodySeconds) && bodySeconds > 0) delay = bodySeconds * 1000;
  }
  return delay > 0 ? Math.max(1000, Math.min(24 * 60 * 60 * 1000, Math.ceil(delay))) : 0;
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
  const requestRejected = classified && (
    ['INPUT_PERSON_PRIVACY', 'INPUT_SENSITIVE_CONTENT', 'INVALID_PROVIDER_INPUT'].includes(classified.code)
    || (classified.code === 'PROVIDER_REQUEST_REJECTED'
      && error?.response_diagnostics?.kind === 'structured_output_request')
  );
  if (ok) {
    const stickyCooldownUntil = row.sticky_cooldown_until ? new Date(row.sticky_cooldown_until).getTime() : 0;
    const stickyCooldownActive = Number.isFinite(stickyCooldownUntil) && stickyCooldownUntil > Date.now();
    row.success_count = Number(row.success_count || 0) + 1;
    row.consecutive_failure_count = 0;
    row.cooldown_until = stickyCooldownActive ? row.sticky_cooldown_until : '';
    if (!stickyCooldownActive) row.sticky_cooldown_until = '';
    row.blocked_until_config_change = false;
    if (!stickyCooldownActive) row.last_error_code = '';
    row.last_success_at = new Date().toISOString();
  } else if (requestRejected) {
    // User/input/request-shape failures do not mean the model endpoint is
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
      row.cooldown_until = '';
      row.blocked_until_config_change = true;
    } else if (code === 'PROVIDER_BILLING') {
      row.cooldown_until = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    } else if (code === 'PROVIDER_REQUEST_REJECTED') {
      row.cooldown_until = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    } else if (/TIMEOUT|RATE_LIMIT|NETWORK|PROVIDER_5XX/.test(code)) {
      const retryDelayMs = code === 'RATE_LIMIT' ? providerRetryDelayMs(error) : 0;
      row.cooldown_until = new Date(Date.now() + (retryDelayMs || 5 * 60 * 1000)).toISOString();
      if (code === 'RATE_LIMIT' || code === 'PROVIDER_5XX') row.sticky_cooldown_until = row.cooldown_until;
    }
  }
  if (latencyMs) {
    const old = Number(row.avg_latency_ms || 0);
    row.avg_latency_ms = old ? Math.round(old * 0.75 + latencyMs * 0.25) : latencyMs;
  }
  row.updated_at = new Date().toISOString();
  health[key] = row;
  if (!ok && classified?.code === 'RATE_LIMIT') {
    const domainKey = rateLimitDomainHealthKey(model);
    const currentDomain = health[domainKey] || {};
    const currentUntil = Date.parse(currentDomain.cooldown_until || '');
    const nextUntil = Date.parse(row.cooldown_until || '');
    health[domainKey] = {
      kind: 'rate_limit_domain',
      provider_id: model.provider_id,
      state: 'cooldown',
      cooldown_until: new Date(Math.max(
        Number.isFinite(currentUntil) ? currentUntil : 0,
        Number.isFinite(nextUntil) ? nextUntil : Date.now() + 5 * 60 * 1000,
      )).toISOString(),
      last_error_code: 'RATE_LIMIT',
      updated_at: new Date().toISOString(),
    };
  }
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

/**
 * Keep the configured priority order, but spend the limited attempt budget on
 * independent failure domains before trying a second model from the same upstream.
 * A provider-wide outage must not consume every text attempt.
 */
function diversifyTextCandidates(candidates = []) {
  const firstByProvider = [];
  const remaining = [];
  const seen = new Set();
  (candidates || []).forEach((model) => {
    const domain = failureDomainKey(model);
    if (domain && !seen.has(domain)) {
      seen.add(domain);
      firstByProvider.push(model);
    } else {
      remaining.push(model);
    }
  });
  return [...firstByProvider, ...remaining];
}

function candidatesForStage(stage) {
  const inheritedStage = routeStage(stage);
  const configured = typeof pipeline.pickAllEnabledWithDefault === 'function'
    ? pipeline.pickAllEnabledWithDefault(inheritedStage)
    : pipeline.pickAllEnabled(inheritedStage);
  const strictManaged = pipeline.isStrictPipelineManagedStage
    ? pipeline.isStrictPipelineManagedStage(stage)
    : String(stage || '').startsWith('new_story_ad.');
  const defaults = STAGE_FALLBACKS[stage] || FALLBACKS;
  const configuredOrSettings = strictManaged ? configured : (configured.length ? configured : settingsStoryCandidates());
  const managedRecoveryPool = strictManaged && String(stage || '') === REFERENCE_SYNTHESIS_STAGE
    ? [...configuredOrSettings, ...defaults]
    : configuredOrSettings;
  const ranked = uniqueModels(strictManaged ? managedRecoveryPool : [...configuredOrSettings, ...defaults])
    .map((m, i) => ({ ...m, fallback_rank: i + 1 }))
    .filter(m => isConfiguredAndUsable(m).ok)
    .filter(m => !healthState(m).circuit_open)
    .sort((a, b) => {
      const priorityDelta = Number(a.priority || 999) - Number(b.priority || 999);
      if (priorityDelta) return priorityDelta;
      return getHealthScore(b) - getHealthScore(a);
    });
  return preferReliableTextCandidates(diversifyTextCandidates(ranked), stage);
}

function candidatesForVisionStage(stage) {
  const configured = typeof pipeline.pickAllEnabledWithDefault === 'function'
    ? pipeline.pickAllEnabledWithDefault(stage)
    : pipeline.pickAllEnabled(stage);
  const strictManaged = pipeline.isStrictPipelineManagedStage
    ? pipeline.isStrictPipelineManagedStage(stage)
    : String(stage || '').startsWith('new_story_ad.');
  const pool = strictManaged ? configured : (configured.length ? configured : settingsVisionCandidates());
  const ranked = uniqueModels(pool)
    .map((model, index) => ({ ...model, fallback_rank: index + 1 }))
    .filter(model => isConfiguredAndUsable(model, 'vision').ok)
    .filter(model => !healthState(model).circuit_open)
    .sort((a, b) => {
      const priorityDelta = Number(a.priority || 999) - Number(b.priority || 999);
      return priorityDelta || (getHealthScore(b) - getHealthScore(a));
    });
  return diversifyVisionCandidates(preferReferenceVisionCandidates(ranked, stage));
}

function visionAvailability(stage) {
  const configured = typeof pipeline.pickAllEnabledWithDefault === 'function'
    ? pipeline.pickAllEnabledWithDefault(stage)
    : pipeline.pickAllEnabled(stage);
  const strictManaged = pipeline.isStrictPipelineManagedStage
    ? pipeline.isStrictPipelineManagedStage(stage)
    : String(stage || '').startsWith('new_story_ad.');
  const source = strictManaged ? 'model_call_management' : (configured.length ? 'stage_route' : 'settings_fallback');
  const pool = uniqueModels(strictManaged ? configured : (configured.length ? configured : settingsVisionCandidates()));
  const models = pool.map((model) => {
    const configuredState = isConfiguredAndUsable(model, 'vision');
    const health = configuredState.ok ? healthState(model) : {};
    const circuitOpen = configuredState.ok && health.circuit_open === true;
    return {
      provider_id: model.provider_id,
      model_id: model.model_id,
      available: configuredState.ok && !circuitOpen,
      reason: !configuredState.ok
        ? configuredState.reason
        : (circuitOpen ? (health.last_error_code || 'circuit_open') : 'available'),
      retry_after_ms: circuitOpen ? Number(health.cooldown_remaining_ms || 0) : 0,
    };
  });
  return {
    stage,
    source,
    available_count: models.filter(item => item.available).length,
    models,
  };
}

function preferReferenceVisionCandidates(candidates = [], stage = '') {
  if (!/reference_video_vision/i.test(String(stage || ''))) return candidates.slice();
  const providerOrder = [];
  const buckets = new Map();
  candidates.forEach(model => {
    const providerId = String(model?.provider_id || '').toLowerCase();
    if (!buckets.has(providerId)) {
      buckets.set(providerId, []);
      providerOrder.push(providerId);
    }
    buckets.get(providerId).push(model);
  });
  const modelRank = (model) => {
    const id = String(model?.model_id || '').toLowerCase();
    if (/gemini-2\.5-flash/.test(id)) return 0;
    if (/glm-4\.6v/.test(id)) return 1;
    if (/gemini-2\.5-pro/.test(id)) return 2;
    if (/glm-4\.5v/.test(id)) return 3;
    if (/gpt-4o/.test(id)) return 4;
    return 5;
  };
  return providerOrder.flatMap(providerId => buckets.get(providerId)
    .map((model, index) => ({ model, index }))
    .sort((a, b) => modelRank(a.model) - modelRank(b.model) || a.index - b.index)
    .map(item => item.model));
}

function diversifyVisionCandidates(candidates = []) {
  const seen = new Set();
  const firstByProvider = [];
  const remaining = [];
  candidates.forEach(model => {
    const providerId = String(model?.provider_id || '').toLowerCase();
    if (providerId && !seen.has(providerId)) {
      seen.add(providerId);
      firstByProvider.push(model);
    } else {
      remaining.push(model);
    }
  });
  return firstByProvider.concat(remaining);
}

function classifyError(error) {
  const msg = String(error?.message || error || '');
  const explicitCode = String(error?.code || '');
  if (['INPUT_PERSON_PRIVACY', 'INPUT_SENSITIVE_CONTENT', 'INVALID_PROVIDER_INPUT'].includes(explicitCode)) {
    return { code: explicitCode, retryable: false };
  }
  if (['PROVIDER_RESPONSE_INVALID', 'PROVIDER_EMPTY_RESPONSE', 'REFERENCE_VIDEO_EVIDENCE_COVERAGE_INVALID'].includes(explicitCode)) {
    return { code: explicitCode, retryable: true };
  }
  if (['RATE_LIMIT', 'PROVIDER_5XX', 'TIMEOUT_OR_NETWORK'].includes(explicitCode)) return { code: explicitCode, retryable: true };
  if (['PROVIDER_BILLING', 'AUTH_CONFIG', 'MODEL_CONFIG'].includes(explicitCode)) return { code: explicitCode, retryable: false };
  if (/InputImageSensitiveContentDetected\.PrivacyInformation|input image may contain real person|PrivacyInformation/i.test(msg)) return { code: 'INPUT_PERSON_PRIVACY', retryable: false };
  if (/SensitiveContentDetected|sensitive content/i.test(msg)) return { code: 'INPUT_SENSITIVE_CONTENT', retryable: false };
  if (/AuditSubmitIllegal|submit.*illegal|content audit|审核|违规|safety|policy/i.test(msg)) return { code: 'PROVIDER_CONTENT_AUDIT', retryable: false };
  if (/prompt:\s*size must be between|prompt.*(?:too long|length|limit)/i.test(msg)) return { code: 'INVALID_PROVIDER_INPUT', retryable: false };
  if (/InvalidParameter|BadRequest|parameter .* not valid|cannot be mixed/i.test(msg)) return { code: 'INVALID_PROVIDER_INPUT', retryable: false };
  if (/timeout|timed\s*out|ETIMEDOUT|ECONNRESET|socket hang up|connection error|fetch failed|upstream connect error|disconnect\/reset|reset before headers|connection termination/i.test(msg)) return { code: 'TIMEOUT_OR_NETWORK', retryable: true };
  if (/insufficient quota|account balance not enough|insufficient balance|balance not enough|["']code["']\s*:\s*(1005|1102)/i.test(msg)) return { code: 'PROVIDER_BILLING', retryable: false };
  if (/429|rate limit|quota/i.test(msg)) return { code: 'RATE_LIMIT', retryable: true };
  if (/token not valid|invalid.*token|api key|unauthorized|401|403|令牌.*(?:过期|无效|不正确)|验证不正确/i.test(msg)) return { code: 'AUTH_CONFIG', retryable: false };
  if (/configuration not found|model.*not found|model_not_found|不是可用|没有可用配置|not available|disabled/i.test(msg)) return { code: 'MODEL_CONFIG', retryable: false };
  if (/JSON_PARSE|Unexpected end|Unexpected token/i.test(msg)) return { code: 'MODEL_JSON', retryable: true };
  if (/(?:\bHTTP\s*)?400\s*status code\s*\(no body\)|\bHTTP\s*400\b.*(?:no body|empty body)/i.test(msg)) {
    return { code: 'PROVIDER_REQUEST_REJECTED', retryable: false };
  }
  if (/\bHTTP\s*5\d\d\b|\bstatus(?:\s*code)?\s*[:=]?\s*5\d\d\b|Internal Server Error|Service Unavailable/i.test(msg)) return { code: 'PROVIDER_5XX', retryable: true };
  return { code: 'UNKNOWN', retryable: false };
}

function textCallBillingEvidence(error, classified = {}, responseReceived = false) {
  const explicitBilling = String(error?.billingState || error?.billing_state || '').trim().toLowerCase();
  const explicitSubmission = String(error?.providerSubmissionState || error?.provider_submission_state || '').trim().toLowerCase();
  if (explicitBilling || explicitSubmission) {
    return {
      billing_state: explicitBilling || (explicitSubmission === 'not_submitted' ? 'not_billed' : 'unknown'),
      provider_submission_state: explicitSubmission || (explicitBilling === 'unknown' ? 'submitted_unknown' : 'completed'),
    };
  }
  if (responseReceived || ['PROVIDER_RESPONSE_INVALID', 'MODEL_JSON', 'PROVIDER_EMPTY_RESPONSE'].includes(classified.code)) {
    return { billing_state: 'confirmed', provider_submission_state: 'completed' };
  }
  if (['TIMEOUT_OR_NETWORK', 'PROVIDER_5XX'].includes(classified.code)) {
    return { billing_state: 'unknown', provider_submission_state: 'submitted_unknown' };
  }
  return { billing_state: 'not_billed', provider_submission_state: 'submission_rejected' };
}

function parseStructuredJson(text = '', request = null, adapterMeta = null) {
  const normalized = providerAdapters.normalizeStructuredOutput(request);
  if (!normalized) return { parsed: null, diagnostics: null };
  const raw = String(text || '').trim();
  try {
    // Deterministic local parsing accepts fenced JSON, explanatory prefixes,
    // balanced JSON blocks and harmless truncation/trailing commas. This runs
    // before any extra model repair, so a provider's useful JSON is not billed
    // for twice merely because it added prose around the object.
    const parsed = jsonRepair.parseJson(raw, 'object');
    if (normalized.mode === 'json_object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
      throw new Error('Structured output root must be a JSON object');
    }
    return { parsed, diagnostics: null };
  } catch (error) {
    const diagnostics = {
      kind: 'structured_output_response',
      requested_mode: normalized.mode,
      applied_mode: adapterMeta?.applied_mode || '',
      native: adapterMeta?.native === true,
      degraded: adapterMeta?.degraded === true,
      parse_error: String(error.message || error).slice(0, 240),
      response_length: raw.length,
      response_excerpt: raw.slice(0, 300),
    };
    const invalid = new Error(`Structured output was not valid JSON: ${diagnostics.parse_error}`);
    invalid.code = 'PROVIDER_RESPONSE_INVALID';
    invalid.retryable = true;
    invalid.response_diagnostics = diagnostics;
    throw invalid;
  }
}

async function runSemanticValidation(validateText, text, meta = {}, stage = '') {
  if (typeof validateText !== 'function') return true;
  try {
    const validation = await validateText(text, meta);
    if (validation !== false) return true;
    const error = new Error(`${stage} 模型返回内容未通过业务语义校验`);
    error.code = 'PROVIDER_RESPONSE_INVALID';
    error.retryable = true;
    throw error;
  } catch (error) {
    if (['PROVIDER_RESPONSE_INVALID', 'USER_CANCELLED'].includes(String(error?.code || ''))) throw error;
    const rawIssues = (error?.story_scene_coverage_issues || error?.content_mode_violations || [])
      .map(issue => String(issue || '').slice(0, 500))
      .filter(Boolean);
    const prioritizedIssues = [
      ...rawIssues.filter(issue => !/\.plot_beats\[\d+\]/.test(issue)),
      ...rawIssues.filter(issue => /\.plot_beats\[\d+\]/.test(issue)),
    ].filter((issue, index, rows) => rows.indexOf(issue) === index);
    const invalid = new Error(String(error?.message || `${stage} 模型返回内容未通过业务语义校验`));
    invalid.code = 'PROVIDER_RESPONSE_INVALID';
    invalid.retryable = true;
    invalid.validation_code = String(error?.code || 'BUSINESS_SEMANTIC_VALIDATION_FAILED');
    invalid.response_diagnostics = {
      kind: 'business_semantic_validation',
      validation_code: invalid.validation_code,
      issues: prioritizedIssues.slice(0, 100),
      issue_count: rawIssues.length,
      issues_truncated: prioritizedIssues.length > 100,
      response_length: String(text || '').length,
    };
    throw invalid;
  }
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
  maxCandidates = null,
  stageBudgetMs = TEXT_STAGE_BUDGET_MS,
  validateText = null,
  structuredOutput = null,
  _candidateModels = null,
  _generateText = null,
} = {}) {
  if (!stage) throw new Error('剧情广告模型调用缺少阶段标识。');
  if (String(stage).startsWith('new_story_ad.') && !pipeline.getStageMeta(stage)) {
    const error = new Error(`${stage} 尚未登记到模型调用管理，已在调用供应商前停止`);
    error.code = 'MODEL_STAGE_NOT_REGISTERED';
    error.status = 409;
    error.retryable = false;
    throw error;
  }
  if (process.env.NEW_STORY_AD_MOCK_LLM === '1') {
    const text = mockResponse(stage, userPrompt);
    const structured = parseStructuredJson(text, structuredOutput, { applied_mode: 'mock', native: false, degraded: false });
    return {
      text,
      parsed_json: structured.parsed,
      structured_output: structuredOutput ? { requested_mode: providerAdapters.normalizeStructuredOutput(structuredOutput)?.mode || '', applied_mode: 'mock', native: false, degraded: false } : null,
      used_model: 'mock/new-story-ad',
      fallback_used: false,
      failed_models: [],
      latency_ms: 1,
    };
  }
  const candidates = Array.isArray(_candidateModels) ? _candidateModels : candidatesForStage(stage);
  if (!candidates.length) {
    const error = new Error(`${stage} 没有未熔断的可用文本模型，已立即停止本阶段`);
    error.code = 'MODEL_CIRCUIT_OPEN';
    error.retryable = true;
    throw error;
  }
  const failed = [];
  let lastCandidateText = '';
  let lastCandidateParsedJson = null;
  const stageStarted = Date.now();
  const stageCandidateCap = String(stage || '') === REFERENCE_SYNTHESIS_STAGE
    ? Math.max(TEXT_MAX_CANDIDATES, 5)
    : TEXT_MAX_CANDIDATES;
  const requestedCandidateCount = Number(maxCandidates);
  const attemptCandidates = candidates.slice(0, Math.max(1, Math.min(
    stageCandidateCap,
    requestedCandidateCount > 0 ? requestedCandidateCount : stageCandidateCap,
  )));
  for (let i = 0; i < attemptCandidates.length; i += 1) {
    cancellation.throwIfCancelled(taskId);
    if (Date.now() - stageStarted >= Math.max(5000, Number(stageBudgetMs) || TEXT_STAGE_BUDGET_MS)) break;
    const model = attemptCandidates[i];
    const liveHealth = healthState(model);
    if (liveHealth.rate_limit_domain_cooldown) {
      failed.push({
        provider_id: model.provider_id,
        model_id: model.model_id,
        code: String(liveHealth.last_error_code || 'RATE_LIMIT'),
        message: 'provider cooldown active; request not submitted',
        response_diagnostics: null,
        retry_after_ms: Math.max(0, Number(liveHealth.cooldown_remaining_ms || 0)),
        skipped: true,
      });
      continue;
    }
    const start = Date.now();
    let candidateText = '';
    let candidateParsed = null;
    try {
      const result = await (typeof _generateText === 'function' ? _generateText : providerAdapters.generateText)({
        model: { ...model, _stageId: stage },
        stage,
        taskId,
        systemPrompt,
        userPrompt,
        maxTokens,
        temperature,
        timeoutMs,
        signal: cancellation.signal(),
        structuredOutput,
      });
      cancellation.throwIfCancelled(taskId);
      const text = result.text;
      candidateText = text;
      lastCandidateText = text;
      const structured = parseStructuredJson(text, structuredOutput, result.structured_output);
      candidateParsed = structured.parsed;
      lastCandidateParsedJson = structured.parsed;
      await runSemanticValidation(validateText, text, {
        model,
        result,
        parsed_json: structured.parsed,
        structured_output: result.structured_output || null,
        candidate_index: i,
      }, stage);
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
        provider_submission_state: 'completed',
        billing_state: 'confirmed',
        failure_domain_id: failureDomainKey(model),
        provider_request_id: result.provider_request_id || '',
        latency_ms: latency,
        fallback_rank: i + 1,
        provider_reason: result.structured_output
          ? `structured_output:${result.structured_output.requested_mode}->${result.structured_output.applied_mode}`
          : '',
      });
      return {
        text,
        parsed_json: structured.parsed,
        structured_output: result.structured_output || null,
        used_model: `${model.provider_id}/${model.model_id}`,
        fallback_used: i > 0,
        failed_models: failed,
        latency_ms: latency,
        provider_request_id: result.provider_request_id || '',
      };
    } catch (err) {
      if (cancellation.signal()?.aborted) cancellation.throwIfCancelled(taskId);
      const latency = Date.now() - start;
      const classified = classifyError(err);
      const billingEvidence = textCallBillingEvidence(err, classified, Boolean(candidateText));
      failed.push({
        provider_id: model.provider_id,
        model_id: model.model_id,
        code: classified.code,
        message: String(err.message || err).slice(0, 300),
        response_diagnostics: err.response_diagnostics || null,
        provider_request_id: err.providerRequestId || err.provider_request_id || '',
        ...billingEvidence,
      });
      if (candidateText) {
        err.candidate_text = candidateText;
        err.candidate_parsed_json = candidateParsed;
      }
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
        provider_reason: err.response_diagnostics?.kind
          ? `${err.response_diagnostics.kind}:${err.response_diagnostics.requested_mode || ''}->${err.response_diagnostics.applied_mode || ''}`
          : '',
        latency_ms: latency,
        provider_status: err.provider_status || err.status || err.response?.status || '',
        provider_error_code: err.code || err.response?.data?.error?.code || '',
        provider_request_id: err.providerRequestId || err.provider_request_id || '',
        failure_domain_id: failureDomainKey(model),
        fallback_rank: i + 1,
        ...billingEvidence,
      });
      if (billingEvidence.billing_state === 'unknown') break;
      if (['INPUT_PERSON_PRIVACY', 'INPUT_SENSITIVE_CONTENT', 'PROVIDER_CONTENT_AUDIT', 'INVALID_PROVIDER_INPUT']
        .includes(classified.code)) break;
      if (['PROVIDER_RESPONSE_INVALID', 'MODEL_JSON', 'PROVIDER_EMPTY_RESPONSE'].includes(classified.code)
        && !MANAGED_RECOVERY_FALLBACK_STAGES.has(String(stage || ''))) break;
      if (!classified.retryable && i >= attemptCandidates.length - 1) break;
    }
  }
  const retryable = failed.some(item => [
    'TIMEOUT_OR_NETWORK',
    'RATE_LIMIT',
    'PROVIDER_5XX',
    'MODEL_JSON',
    'PROVIDER_RESPONSE_INVALID',
    'PROVIDER_EMPTY_RESPONSE',
  ].includes(item.code));
  const err = new Error(
    `${stage} 模型调用失败：实际尝试 ${failed.length}/${attemptCandidates.length} 个本阶段候选`
    + `（全部可用候选 ${candidates.length} 个）；`
    + failed.map(x => `${x.provider_id}/${x.model_id}:${x.code}`).join('；'),
  );
  const directedRepairCode = failed.length === 1 && ['PROVIDER_RESPONSE_INVALID', 'MODEL_JSON', 'PROVIDER_EMPTY_RESPONSE'].includes(failed[0]?.code)
    ? failed[0].code
    : '';
  err.code = directedRepairCode || (retryable ? 'MODEL_ATTEMPTS_EXHAUSTED' : (failed[0]?.code || 'MODEL_UNAVAILABLE'));
  err.retryable = retryable;
  err.attempted_count = failed.length;
  err.candidate_count = attemptCandidates.length;
  err.available_candidate_count = candidates.length;
  err.failed_models = failed;
  const unknownBilling = failed.find(item => item.billing_state === 'unknown');
  if (unknownBilling) {
    err.billingState = 'unknown';
    err.billing_state = 'unknown';
    err.providerSubmissionState = unknownBilling.provider_submission_state || 'submitted_unknown';
    err.provider_submission_state = err.providerSubmissionState;
  }
  if (lastCandidateText) {
    err.candidate_text = lastCandidateText;
    err.candidate_parsed_json = lastCandidateParsedJson;
  }
  throw err;
}

async function generateVision({
  taskId = '',
  stage = 'new_story_ad.scene_consistency_qa',
  systemPrompt = '',
  userPrompt = '',
  imageUrls = [],
  imageDataUrls = [],
  maxTokens = 4000,
  timeoutMs = 120000,
  maxCandidates = VISION_MAX_CANDIDATES,
  stageBudgetMs = TEXT_STAGE_BUDGET_MS,
  validateText = null,
  structuredOutput = null,
  _candidateModels = null,
  _generateText = null,
} = {}) {
  if (String(stage).startsWith('new_story_ad.') && !pipeline.getStageMeta(stage)) {
    const error = new Error(`${stage} 尚未登记到模型调用管理，已在调用供应商前停止`);
    error.code = 'MODEL_STAGE_NOT_REGISTERED';
    error.status = 409;
    error.retryable = false;
    throw error;
  }
  const referenceDiagnostics = publicReferences.normalizeVisionReferences(imageUrls, { max: 8 });
  const urls = referenceDiagnostics.urls;
  const suppliedEmbeddedUrls = (Array.isArray(imageDataUrls) ? imageDataUrls : [])
    .map(value => String(value || '').trim())
    .filter(value => /^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(value))
    .slice(0, 8);
  const localEmbeddedUrls = suppliedEmbeddedUrls.length >= urls.length
    ? []
    : await localVisionReferences.dataUrlsFor(imageUrls, { max: 8 });
  const embeddedUrls = (suppliedEmbeddedUrls.length >= urls.length
    ? suppliedEmbeddedUrls
    : localEmbeddedUrls).slice(0, 8);
  if (!urls.length) {
    const error = new Error(`${stage} 缺少可供视觉模型读取的公网参考图`);
    error.code = 'VISION_REFERENCE_UNAVAILABLE';
    error.retryable = false;
    error.reference_diagnostics = referenceDiagnostics;
    throw error;
  }
  if (process.env.NEW_STORY_AD_MOCK_LLM === '1') {
    const text = JSON.stringify({
        pass: true,
        status: 'verified',
        scene_consistency_score: 0.92,
        anchor_consistency_score: 0.9,
        camera_match_score: 0.9,
        material_match_score: 0.92,
        mismatch_reasons: [],
        requirement_qa: {
          pass: true,
          layout_match_score: 0.94,
          material_light_match_score: 0.93,
          interaction_match_score: 0.9,
          surface_topology_match_score: 0.94,
          negative_compliance_score: 0.98,
          mismatch_reasons: [],
        },
        spatial_coverage_qa: {
          pass: true,
          layout_topology_score: 0.92,
          camera_diversity_score: 0.9,
          reverse_coverage_score: 0.9,
          interaction_zone_score: 0.9,
          reasons: [],
        },
        anchors: [],
        zones: [],
        geometry_facts: [],
        materials: [],
        lighting: {},
      });
    const structured = parseStructuredJson(text, structuredOutput, { applied_mode: 'mock', native: false, degraded: false });
    return {
      text,
      parsed_json: structured.parsed,
      structured_output: structuredOutput ? { requested_mode: providerAdapters.normalizeStructuredOutput(structuredOutput)?.mode || '', applied_mode: 'mock', native: false, degraded: false } : null,
      used_model: 'mock/new-story-ad-vision',
      fallback_used: false,
      failed_models: [],
      latency_ms: 1,
    };
  }
  const candidates = Array.isArray(_candidateModels) ? _candidateModels : candidatesForVisionStage(stage);
  if (!candidates.length) {
    const error = new Error(`${stage} 没有未熔断的可用视觉模型，已立即停止本阶段`);
    error.code = 'VISION_CIRCUIT_OPEN';
    error.retryable = true;
    const availability = visionAvailability(stage);
    error.failed_models = availability.models
      .filter(item => !item.available)
      .map(item => ({
        provider_id: item.provider_id,
        model_id: item.model_id,
        code: String(item.reason || 'unavailable').toUpperCase(),
        retry_after_ms: item.retry_after_ms,
      }));
    error.retry_after_ms = Math.max(0, ...error.failed_models.map(item => Number(item.retry_after_ms || 0)));
    throw error;
  }
  const failed = [];
  let lastCandidateText = '';
  let lastCandidateParsedJson = null;
  const stageStarted = Date.now();
  const attemptCandidates = candidates.slice(0, Math.max(1, Math.min(VISION_MAX_CANDIDATES, Number(maxCandidates) || 1)));
  for (let i = 0; i < attemptCandidates.length; i += 1) {
    cancellation.throwIfCancelled(taskId);
    const model = attemptCandidates[i];
    const releaseFailureDomain = await acquireFailureDomainSubmission(model);
    try {
      cancellation.throwIfCancelled(taskId);
      const attemptTimeoutMs = visionAttemptTimeoutForBudget({
        timeoutMs,
        stageBudgetMs,
        elapsedMs: Date.now() - stageStarted,
        remainingCandidates: attemptCandidates.length - i,
      });
      if (attemptTimeoutMs <= 0) continue;
      const liveHealth = healthState(model);
      if (liveHealth.rate_limit_domain_cooldown) {
        failed.push({
          provider_id: model.provider_id,
          model_id: model.model_id,
          code: String(liveHealth.last_error_code || 'RATE_LIMIT'),
          message: 'provider cooldown active; request not submitted',
          response_diagnostics: null,
          retry_after_ms: Math.max(0, Number(liveHealth.cooldown_remaining_ms || 0)),
          skipped: true,
        });
        continue;
      }
      const start = Date.now();
      let candidateText = '';
      let candidateParsedJson = null;
      try {
      const candidateImageUrls = embeddedUrls.length >= urls.length ? embeddedUrls : urls;
      const messages = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            ...candidateImageUrls.map(url => ({ type: 'image_url', image_url: { url } })),
          ],
        },
      ];
      const result = await (typeof _generateText === 'function' ? _generateText : providerAdapters.generateText)({
        model: { ...model, _stageId: stage },
        stage,
        taskId,
        systemPrompt,
        userPrompt,
        messages,
        maxTokens,
        timeoutMs: attemptTimeoutMs,
        signal: cancellation.signal(),
        structuredOutput,
      });
      cancellation.throwIfCancelled(taskId);
      candidateText = result.text;
      lastCandidateText = result.text;
      const structured = parseStructuredJson(result.text, structuredOutput, result.structured_output);
      candidateParsedJson = structured.parsed;
      lastCandidateParsedJson = structured.parsed;
      await runSemanticValidation(validateText, result.text, {
        model,
        result,
        parsed_json: structured.parsed,
        structured_output: result.structured_output || null,
        candidate_index: i,
      }, stage);
      const latency = Date.now() - start;
      recordHealth(model, { ok: true, latencyMs: latency });
      storage.saveModelCall({
        task_id: taskId, stage, provider_id: model.provider_id, model_id: model.model_id,
        adapter: result.adapter || '', family: result.family || '', status: 'success',
        latency_ms: latency, fallback_rank: i + 1,
        provider_reason: result.structured_output
          ? `structured_output:${result.structured_output.requested_mode}->${result.structured_output.applied_mode}`
          : '',
      });
      return {
        text: result.text,
        parsed_json: structured.parsed,
        structured_output: result.structured_output || null,
        used_model: `${model.provider_id}/${model.model_id}`,
        fallback_used: i > 0,
        failed_models: failed,
        latency_ms: latency,
      };
      } catch (err) {
        if (cancellation.signal()?.aborted) cancellation.throwIfCancelled(taskId);
        const latency = Date.now() - start;
        const classified = classifyError(err);
        const failure = {
          provider_id: model.provider_id,
          model_id: model.model_id,
          code: classified.code,
          message: String(err.message || err).slice(0, 300),
          response_diagnostics: err.response_diagnostics || null,
          retry_after_ms: 0,
        };
        if (candidateText) {
          err.candidate_text = candidateText;
          err.candidate_parsed_json = candidateParsedJson;
        }
        recordHealth(model, { ok: false, error: err, latencyMs: latency });
        failure.retry_after_ms = Math.max(0, Number(healthState(model).cooldown_remaining_ms || 0));
        failed.push(failure);
        storage.saveModelCall({
          task_id: taskId, stage, provider_id: model.provider_id, model_id: model.model_id,
          status: 'failed', error_code: classified.code,
          error_message: String(err.message || err).slice(0, 500), latency_ms: latency,
          fallback_rank: i + 1,
        });
      }
    } finally {
      releaseFailureDomain();
    }
  }
  const error = new Error(`${stage} 视觉模型全部失败：${failed.map(item => `${item.provider_id}/${item.model_id}:${item.code}`).join('；')}`);
  error.code = 'VISION_QA_UNAVAILABLE';
  error.retryable = failed.some(item => /TIMEOUT|RATE_LIMIT|NETWORK|5XX|PROVIDER_RESPONSE_INVALID|PROVIDER_EMPTY_RESPONSE/.test(item.code));
  error.failed_models = failed;
  error.retry_after_ms = Math.max(0, ...failed.map(item => Number(item.retry_after_ms || 0)));
  if (lastCandidateText) {
    error.candidate_text = lastCandidateText;
    error.candidate_parsed_json = lastCandidateParsedJson;
  }
  throw error;
}

function visionAttemptTimeoutForBudget({
  timeoutMs = 120000,
  stageBudgetMs = TEXT_STAGE_BUDGET_MS,
  elapsedMs = 0,
  remainingCandidates = 1,
} = {}) {
  const totalBudget = Math.max(5000, Number(stageBudgetMs) || TEXT_STAGE_BUDGET_MS);
  const remainingBudget = totalBudget - Math.max(0, Number(elapsedMs) || 0);
  if (remainingBudget < 5000) return 0;
  const attempts = Math.max(1, Number(remainingCandidates) || 1);
  const fairShare = Math.floor(remainingBudget / attempts);
  return Math.max(5000, Math.min(
    Math.max(5000, Number(timeoutMs) || 120000),
    fairShare,
  ));
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
  failureDomainKey,
  rateLimitDomainHealthKey,
  acquireFailureDomainSubmission,
  diversifyTextCandidates,
  candidatesForVisionStage,
  visionAvailability,
  diversifyVisionCandidates,
  diversifyTextCandidates,
  preferReferenceVisionCandidates,
  preferReliableTextCandidates,
  routeStage,
  STAGE_ROUTE_INHERITANCE,
  generateText,
  generateVision,
  visionAttemptTimeoutForBudget,
  parseStructuredJson,
  classifyError,
  textCallBillingEvidence,
  providerRetryDelayMs,
  isConfiguredAndUsable,
  recordHealth,
  getHealthScore,
  healthState,
};
