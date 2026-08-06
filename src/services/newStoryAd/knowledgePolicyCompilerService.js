const crypto = require('crypto');
const ruleSchema = require('./knowledgeRuleSchemaService');

const POLICY_SCHEMA_VERSION = ruleSchema.POLICY_SCHEMA_VERSION;
const CACHE_TTL_MS = Math.max(1000, Math.min(300000, Number(process.env.NEW_STORY_AD_KB_POLICY_CACHE_TTL_MS || 30000) || 30000));
// Keep the complete generation-policy addition below roughly 1,500 characters.
// This prevents future KB growth from crowding out task-specific prompt facts.
const DEFAULT_BUDGET = Object.freeze({ hard: 900, soft: 250, negative: 200, qa: 1200 });
const BUDGET_LIMITS = Object.freeze({ hard: 900, soft: 250, negative: 200, qa: 1200 });
const MAX_COMPILE_CACHE = 256;
let sourceCache = { expiresAt: 0, rules: [], fingerprint: '' };
const compileCache = new Map();

function clean(value, max = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function normalizedList(value) {
  return [...new Set((Array.isArray(value) ? value : value ? [value] : [])
    .map(item => clean(item, 160).toLowerCase()).filter(Boolean))].sort();
}

function flattenRules(docs = []) {
  const rules = [];
  for (const doc of docs) {
    if (!doc || doc.enabled === false) continue;
    const runtime = doc.runtime_policy || doc.runtimePolicy;
    if (!runtime) continue;
    const normalized = ruleSchema.normalizeRuntimePolicy(runtime);
    for (const rule of normalized.rules) {
      rules.push({
        ...rule,
        source_doc_id: clean(doc.id, 200),
        source_title: clean(doc.title, 240),
      });
    }
  }
  return rules.sort((a, b) => b.priority - a.priority || b.version - a.version || a.id.localeCompare(b.id));
}

function sourceSnapshot(now = Date.now()) {
  if (sourceCache.expiresAt > now) return sourceCache;
  // Read the runtime authority directly. Requiring knowledgeBaseService here
  // would synchronously load every editorial seed file on the first paid stage.
  // Server startup still owns seeding; generation only reads the persisted set.
  const database = require('../../models/database');
  const rules = flattenRules(database.listKnowledgeDocs({ enabledOnly: true }));
  sourceCache = { expiresAt: now + CACHE_TTL_MS, rules, fingerprint: hash(rules) };
  compileCache.clear();
  return sourceCache;
}

function selectorMatches(rule, input) {
  const capabilities = new Set(input.capabilities);
  if (rule.stages.length && !rule.stages.includes('*') && !rule.stages.includes(input.stage)) return false;
  if (rule.asset_types.length && !rule.asset_types.includes('*') && !rule.asset_types.includes(input.assetType)) return false;
  if (rule.providers.length && !rule.providers.includes('*') && !rule.providers.includes(input.providerId)) return false;
  if (rule.models.length && !rule.models.includes('*') && !rule.models.includes(input.modelId)) return false;
  return rule.required_capabilities.every(value => capabilities.has(value));
}

function deterministicBucket(taskId, rule) {
  if (!taskId) return 100;
  const digest = crypto.createHash('sha256').update(`${taskId}\n${rule.id}\n${rule.version}`).digest();
  return digest.readUInt32BE(0) % 100;
}

function resolveConflicts(rules = []) {
  const winners = [];
  const conflicts = [];
  const byConflict = new Map();
  for (const rule of rules) {
    const prior = byConflict.get(rule.conflict_key);
    if (prior) {
      conflicts.push({ kept: prior.id, kept_version: prior.version, dropped: rule.id, dropped_version: rule.version, conflict_key: rule.conflict_key });
      continue;
    }
    byConflict.set(rule.conflict_key, rule);
    winners.push(rule);
  }
  return { winners, conflicts };
}

function takeWithinBudget(items, limit, valueFor) {
  const selected = [];
  const dropped = [];
  let used = 0;
  const seen = new Set();
  for (const item of items) {
    const value = clean(valueFor(item));
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    if (used + value.length > limit) { dropped.push(item.id); continue; }
    selected.push({ item, value });
    seen.add(key);
    used += value.length;
  }
  return { selected, dropped, used };
}

function boundedBudget(value, key) {
  const fallback = DEFAULT_BUDGET[key];
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(BUDGET_LIMITS[key], Math.floor(numeric)));
}

function normalizeBudget(value = {}) {
  return Object.fromEntries(Object.keys(DEFAULT_BUDGET).map(key => [key, boundedBudget(value[key], key)]));
}

function compactSummary(policy = {}) {
  return {
    schema_version: POLICY_SCHEMA_VERSION,
    fingerprint: clean(policy.fingerprint, 80),
    source_fingerprint: clean(policy.source_fingerprint, 80),
    generation_fingerprint: clean(policy.generation_fingerprint, 80),
    qa_fingerprint: clean(policy.qa_fingerprint, 80),
    rule_ids: (policy.rule_ids || []).slice(0, 24),
    shadow_rule_ids: (policy.shadow_rule_ids || []).slice(0, 24),
    compile_ms: Number(policy.compile_ms || 0),
    cache_hit: policy.cache_hit === true,
  };
}

function compile(input = {}, options = {}) {
  const started = process.hrtime.bigint();
  const rules = options.docs ? flattenRules(options.docs) : null;
  const snapshot = rules ? { rules, fingerprint: hash(rules) } : sourceSnapshot();
  const selector = {
    stage: clean(input.stage, 120).toLowerCase(),
    assetType: clean(input.assetType || input.asset_type, 120).toLowerCase(),
    providerId: clean(input.providerId || input.provider_id, 160).toLowerCase(),
    modelId: clean(input.modelId || input.model_id, 160).toLowerCase(),
    capabilities: normalizedList(input.capabilities),
    mode: clean(input.mode || process.env.NEW_STORY_AD_KB_POLICY_MODE || 'active', 40).toLowerCase() === 'shadow' ? 'shadow' : 'active',
  };
  const taskId = clean(input.taskId || input.task_id, 200);
  const budget = normalizeBudget(input.budget || {});
  const canarySensitive = snapshot.rules.some(rule => rule.status === 'canary' && selectorMatches(rule, selector));
  const cacheKey = hash({ source: snapshot.fingerprint, selector, budget, task_id: canarySensitive ? taskId : '' });
  if (!options.docs && compileCache.has(cacheKey)) {
    return { ...compileCache.get(cacheKey), compile_ms: 0, cache_hit: true };
  }

  const matching = snapshot.rules.filter(rule => selectorMatches(rule, selector));
  const activeCandidates = [];
  const shadowCandidates = [];
  const canarySkipped = [];
  for (const rule of matching) {
    if (rule.status === 'draft' || rule.status === 'retired') continue;
    if (selector.mode === 'shadow' || rule.status === 'shadow') {
      shadowCandidates.push(rule);
    } else if (rule.status === 'active') {
      activeCandidates.push(rule);
    } else if (rule.status === 'canary') {
      if (deterministicBucket(taskId, rule) < rule.canary_percent) activeCandidates.push(rule);
      else { shadowCandidates.push(rule); canarySkipped.push(`${rule.id}@${rule.version}`); }
    }
  }
  const activeResolution = resolveConflicts(activeCandidates);
  const shadowResolution = resolveConflicts(shadowCandidates);
  const active = activeResolution.winners;
  const shadow = shadowResolution.winners;
  const generationRules = active.filter(rule => rule.enforcement !== 'qa_only');
  const hard = takeWithinBudget(generationRules.filter(rule => rule.enforcement === 'hard'), budget.hard, rule => rule.instruction);
  const soft = takeWithinBudget(generationRules.filter(rule => rule.enforcement === 'soft'), budget.soft, rule => rule.instruction);
  const negatives = takeWithinBudget(generationRules, budget.negative, rule => rule.negative);
  const qaRows = active.flatMap(rule => rule.qa_checks.map(value => ({ ...rule, qa_value: value })));
  const qa = takeWithinBudget(qaRows, budget.qa, rule => rule.qa_value);
  const generationRuleIds = [...new Set([
    ...hard.selected,
    ...soft.selected,
    ...negatives.selected,
  ].map(row => `${row.item.id}@${row.item.version}`))];
  const qaRuleIds = [...new Set(qa.selected.map(row => `${row.item.id}@${row.item.version}`))];
  const promptLines = [
    ...hard.selected.map(row => `HARD: ${row.value}`),
    ...soft.selected.map(row => `GUIDANCE: ${row.value}`),
  ];
  const payload = {
    schema_version: POLICY_SCHEMA_VERSION,
    source_fingerprint: snapshot.fingerprint,
    selector,
    rule_ids: active.map(rule => `${rule.id}@${rule.version}`),
    generation_rule_ids: generationRuleIds,
    eligible_generation_rule_ids: generationRules.map(rule => `${rule.id}@${rule.version}`),
    qa_rule_ids: qaRuleIds,
    shadow_rule_ids: shadow.map(rule => `${rule.id}@${rule.version}`),
    canary_skipped_rule_ids: canarySkipped,
    source_doc_ids: [...new Set(active.map(rule => rule.source_doc_id))],
    prompt_block: promptLines.length ? `Knowledge policy contract (task facts remain authoritative):\n${promptLines.join('\n')}` : '',
    negative_constraints: negatives.selected.map(row => row.value),
    qa_checks: qa.selected.map(row => row.value),
    dropped_rule_ids: [...new Set([...hard.dropped, ...soft.dropped, ...negatives.dropped, ...qa.dropped])],
    conflicts: [...activeResolution.conflicts, ...shadowResolution.conflicts],
    budget,
    budget_used: { hard: hard.used, soft: soft.used, negative: negatives.used, qa: qa.used },
  };
  payload.generation_fingerprint = hash({
    schema_version: payload.schema_version,
    stage: selector.stage,
    asset_type: selector.assetType,
    prompt_block: payload.prompt_block,
    negative_constraints: payload.negative_constraints,
    generation_rule_ids: payload.generation_rule_ids,
  });
  payload.qa_fingerprint = hash({
    schema_version: payload.schema_version,
    stage: selector.stage,
    asset_type: selector.assetType,
    qa_checks: payload.qa_checks,
    qa_rule_ids: payload.qa_rule_ids,
  });
  payload.fingerprint = hash({ generation_fingerprint: payload.generation_fingerprint, qa_fingerprint: payload.qa_fingerprint });
  payload.compile_ms = Number(process.hrtime.bigint() - started) / 1e6;
  payload.cache_hit = false;
  if (!options.docs) {
    if (compileCache.size >= MAX_COMPILE_CACHE) compileCache.delete(compileCache.keys().next().value);
    compileCache.set(cacheKey, { ...payload });
  }
  return payload;
}

function clearCache() {
  sourceCache = { expiresAt: 0, rules: [], fingerprint: '' };
  compileCache.clear();
}

module.exports = {
  POLICY_SCHEMA_VERSION,
  DEFAULT_BUDGET,
  BUDGET_LIMITS,
  compile,
  compactSummary,
  flattenRules,
  deterministicBucket,
  normalizeBudget,
  clearCache,
  hash,
};
