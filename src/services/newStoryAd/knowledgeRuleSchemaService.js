const POLICY_SCHEMA_VERSION = 1;
const RULE_STATUSES = new Set(['active', 'shadow', 'canary', 'draft', 'retired']);
const ENFORCEMENT_LEVELS = new Set(['hard', 'soft', 'qa_only']);
const POLICY_FIELDS = new Set(['schema_version', 'rules']);
const RULE_FIELDS = new Set([
  'id', 'version', 'status', 'priority', 'enforcement', 'conflict_key',
  'stages', 'asset_types', 'providers', 'models', 'required_capabilities',
  'instruction', 'negative', 'qa_checks', 'canary_percent',
]);
const IDENTIFIER = /^[a-z0-9][a-z0-9._*-]{0,159}$/i;

function schemaError(message, path = 'runtime_policy') {
  const error = new Error(`${path}: ${message}`);
  error.code = 'KNOWLEDGE_RUNTIME_POLICY_INVALID';
  error.status = 422;
  error.path = path;
  return error;
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function rejectUnknownFields(value, allowed, path) {
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length) throw schemaError(`不支持字段 ${unknown.join(', ')}`, path);
}

function integer(value, { min, max, fallback, path }) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!Number.isInteger(Number(value))) throw schemaError('必须是整数', path);
  const normalized = Number(value);
  if (normalized < min || normalized > max) throw schemaError(`必须介于 ${min} 和 ${max} 之间`, path);
  return normalized;
}

function text(value, { max, fallback = '', required = false, path }) {
  if (value === undefined || value === null) value = fallback;
  if (typeof value !== 'string') throw schemaError('必须是字符串', path);
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (required && !normalized) throw schemaError('不能为空', path);
  if (normalized.length > max) throw schemaError(`长度不能超过 ${max}`, path);
  return normalized;
}

function identifier(value, { fallback = '', required = false, path }) {
  const normalized = text(value, { max: 160, fallback, required, path }).toLowerCase();
  if (normalized && !IDENTIFIER.test(normalized)) throw schemaError('只能包含字母、数字、点、星号、下划线或短横线', path);
  return normalized;
}

function identifierList(value, { maxItems, path }) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw schemaError('必须是数组', path);
  if (value.length > maxItems) throw schemaError(`最多 ${maxItems} 项`, path);
  return [...new Set(value.map((entry, index) => identifier(entry, {
    required: true,
    path: `${path}[${index}]`,
  })))];
}

function textList(value, { maxItems, maxChars, path }) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw schemaError('必须是数组', path);
  if (value.length > maxItems) throw schemaError(`最多 ${maxItems} 项`, path);
  return [...new Set(value.map((entry, index) => text(entry, {
    max: maxChars,
    required: true,
    path: `${path}[${index}]`,
  })))];
}

function normalizeRule(value, index = 0) {
  const path = `runtime_policy.rules[${index}]`;
  if (!plainObject(value)) throw schemaError('必须是对象', path);
  rejectUnknownFields(value, RULE_FIELDS, path);
  const status = identifier(value.status, { fallback: 'draft', path: `${path}.status` });
  if (!RULE_STATUSES.has(status)) throw schemaError(`不支持状态 ${status}`, `${path}.status`);
  const enforcement = identifier(value.enforcement, { fallback: 'soft', path: `${path}.enforcement` });
  if (!ENFORCEMENT_LEVELS.has(enforcement)) throw schemaError(`不支持执行级别 ${enforcement}`, `${path}.enforcement`);
  const rule = {
    id: identifier(value.id, { required: true, path: `${path}.id` }),
    version: integer(value.version, { min: 1, max: 1000000, fallback: 1, path: `${path}.version` }),
    status,
    priority: integer(value.priority, { min: 0, max: 1000, fallback: 0, path: `${path}.priority` }),
    enforcement,
    conflict_key: identifier(value.conflict_key, { fallback: value.id, path: `${path}.conflict_key` }),
    stages: identifierList(value.stages, { maxItems: 12, path: `${path}.stages` }),
    asset_types: identifierList(value.asset_types, { maxItems: 24, path: `${path}.asset_types` }),
    providers: identifierList(value.providers, { maxItems: 24, path: `${path}.providers` }),
    models: identifierList(value.models, { maxItems: 24, path: `${path}.models` }),
    required_capabilities: identifierList(value.required_capabilities, { maxItems: 32, path: `${path}.required_capabilities` }),
    instruction: text(value.instruction, { max: 1800, path: `${path}.instruction` }),
    negative: text(value.negative, { max: 900, path: `${path}.negative` }),
    qa_checks: textList(value.qa_checks, { maxItems: 16, maxChars: 500, path: `${path}.qa_checks` }),
    canary_percent: integer(value.canary_percent, {
      min: 0,
      max: 100,
      fallback: status === 'canary' ? 0 : 100,
      path: `${path}.canary_percent`,
    }),
  };
  if (enforcement === 'qa_only' && !rule.qa_checks.length) {
    throw schemaError('qa_only 规则必须包含 qa_checks', path);
  }
  if (enforcement !== 'qa_only' && !rule.instruction && !rule.negative) {
    throw schemaError('生成规则必须包含 instruction 或 negative', path);
  }
  return rule;
}

function normalizeRuntimePolicy(value) {
  if (!plainObject(value)) throw schemaError('必须是对象');
  rejectUnknownFields(value, POLICY_FIELDS, 'runtime_policy');
  const schemaVersion = integer(value.schema_version, {
    min: POLICY_SCHEMA_VERSION,
    max: POLICY_SCHEMA_VERSION,
    fallback: POLICY_SCHEMA_VERSION,
    path: 'runtime_policy.schema_version',
  });
  if (!Array.isArray(value.rules)) throw schemaError('rules 必须是数组');
  if (value.rules.length > 64) throw schemaError('rules 最多 64 项');
  const rules = value.rules.map(normalizeRule);
  const identities = new Set();
  for (const rule of rules) {
    const identity = `${rule.id}@${rule.version}`;
    if (identities.has(identity)) throw schemaError(`规则版本重复 ${identity}`);
    identities.add(identity);
  }
  return { schema_version: schemaVersion, rules };
}

function mergeVersionedRuntimePolicy(existing, seeded) {
  const current = existing ? normalizeRuntimePolicy(existing) : { schema_version: POLICY_SCHEMA_VERSION, rules: [] };
  const incoming = normalizeRuntimePolicy(seeded);
  const identities = new Set(current.rules.map(rule => `${rule.id}@${rule.version}`));
  const additions = incoming.rules.filter(rule => !identities.has(`${rule.id}@${rule.version}`));
  return {
    changed: additions.length > 0,
    added: additions.map(rule => `${rule.id}@${rule.version}`),
    policy: {
      schema_version: Math.max(current.schema_version, incoming.schema_version),
      rules: [...current.rules, ...additions],
    },
  };
}

module.exports = {
  POLICY_SCHEMA_VERSION,
  RULE_STATUSES,
  ENFORCEMENT_LEVELS,
  schemaError,
  normalizeRule,
  normalizeRuntimePolicy,
  mergeVersionedRuntimePolicy,
};
