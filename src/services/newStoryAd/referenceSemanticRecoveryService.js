const crypto = require('crypto');

const CHECKPOINT_VERSION = 'reference-semantic-recovery-v1';
const MAX_ATTEMPT_SUMMARIES = 6;
const MAX_BEST_DRAFT_BYTES = 512 * 1024;
const MAX_CONTRACT_FRAGMENT_BYTES = 256 * 1024;
const MAX_SEMANTIC_ARRAY_ITEMS = 240;
const MAX_SEMANTIC_TEXT_LENGTH = 4000;

const CONTRACTS = Object.freeze({
  story: Object.freeze({
    weight: 25,
    failure_codes: Object.freeze([
      'semantic_understanding_missing',
      'full_synopsis_missing',
      'narrative_mode_unclassified',
      'temporal_adjacency_mislabeled_as_causality',
      'story_summary_generic',
      'story_semantics_incomplete',
      'story_outline_incomplete',
      'plot_beats_incomplete',
    ]),
  }),
  timeline: Object.freeze({
    weight: 25,
    failure_codes: Object.freeze([
      'semantic_understanding_missing',
      'causal_chain_missing',
      'event_evidence_incomplete',
      'cause_or_progression_incomplete',
    ]),
  }),
  cast: Object.freeze({
    weight: 15,
    failure_codes: Object.freeze([
      'semantic_understanding_missing',
      'character_semantics_incomplete',
      'character_count_mismatch',
      'character_actions_missing',
      'character_actions_not_observed',
      'animal_actions_missing',
      'animal_prompts_missing',
      'animal_evidence_conflict',
    ]),
  }),
  scenes: Object.freeze({
    weight: 20,
    failure_codes: Object.freeze([
      'semantic_understanding_missing',
      'scene_semantics_incomplete',
      'scene_reference_invalid',
      'scene_event_mapping_incomplete',
      'scene_prompts_incomplete',
      'scene_locations_duplicated',
    ]),
  }),
  brand_audio: Object.freeze({
    weight: 15,
    failure_codes: Object.freeze([
      'semantic_understanding_missing',
      'brand_semantics_incomplete',
    ]),
  }),
});

// A repair model may update only the fields owned by the contracts requested in
// that repair round. Keep this map data-only and industry neutral: it describes
// semantic responsibilities, never products, locations, people or story genres.
const OWNED_FIELDS = Object.freeze({
  story: Object.freeze([
    'summary',
    'story_outline',
    'reference_understanding.story_summary',
  ]),
  timeline: Object.freeze([
    'plot_beats',
    'reference_understanding.causal_chain',
    'reference_understanding.facts',
    'reference_understanding.inferences',
    'reference_understanding.unknowns',
  ]),
  cast: Object.freeze([
    'character_prompts',
    'character_actions',
    'animal_prompts',
    'animal_actions',
    'reference_understanding.characters',
  ]),
  scenes: Object.freeze([
    'reference_understanding.scenes',
  ]),
  brand_audio: Object.freeze([
    'subtitle_cta',
    'reference_understanding.brand_role',
    'reference_understanding.audio_visual',
  ]),
});

const HARD_FAILURES = new Set([
  'provider_refusal',
  'visual_frame_coverage_incomplete',
  'source_product_environment_conflated',
  'truncated_evidence_text',
]);

const SEMANTIC_DRAFT_FIELDS = Object.freeze([
  'source_facts',
  'summary',
  'story_outline',
  'reference_understanding',
  'plot_beats',
  'character_prompts',
  'character_actions',
  'animal_prompts',
  'animal_actions',
  'subtitle_cta',
  'prompt_suggestions',
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function compactSemanticValue(value, {
  maxArrayItems = MAX_SEMANTIC_ARRAY_ITEMS,
  maxTextLength = MAX_SEMANTIC_TEXT_LENGTH,
} = {}) {
  if (typeof value === 'string') return value.length > maxTextLength ? value.slice(0, maxTextLength) : value;
  if (Array.isArray(value)) {
    return value.slice(0, maxArrayItems).map(item => compactSemanticValue(item, { maxArrayItems, maxTextLength }));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    compactSemanticValue(item, { maxArrayItems, maxTextLength }),
  ]));
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function cloneJson(value, fallback = {}) {
  if (value === undefined) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function ownPathValue(source = {}, path = '') {
  const parts = String(path || '').split('.').filter(Boolean);
  let cursor = source;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)
      || !Object.prototype.hasOwnProperty.call(cursor, part)) {
      return { found: false, value: undefined };
    }
    cursor = cursor[part];
  }
  return { found: true, value: cursor };
}

function setOwnPath(target = {}, path = '', value) {
  const parts = String(path || '').split('.').filter(Boolean);
  if (!parts.length) return target;
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (['__proto__', 'prototype', 'constructor'].includes(part)) return target;
    const current = cursor[part];
    if (!current || typeof current !== 'object' || Array.isArray(current)) cursor[part] = {};
    cursor = cursor[part];
  }
  const leaf = parts.at(-1);
  if (!['__proto__', 'prototype', 'constructor'].includes(leaf)) cursor[leaf] = cloneJson(value, value);
  return target;
}

function ownedFragment(value = {}, contractName = '') {
  const fragment = {};
  for (const path of OWNED_FIELDS[contractName] || []) {
    const owned = ownPathValue(value, path);
    if (owned.found) setOwnPath(fragment, path, owned.value);
  }
  return fragment;
}

function boundedOwnedFragment(value = {}, contractName = '') {
  const fragment = ownedFragment(value, contractName);
  if (jsonBytes(fragment) <= MAX_CONTRACT_FRAGMENT_BYTES) return fragment;
  const compacted = compactSemanticValue(fragment, {
    maxArrayItems: MAX_SEMANTIC_ARRAY_ITEMS,
    maxTextLength: Math.floor(MAX_SEMANTIC_TEXT_LENGTH / 2),
  });
  if (jsonBytes(compacted) > MAX_CONTRACT_FRAGMENT_BYTES) {
    const error = new Error(`Reference semantic ${contractName} fragment exceeds ${MAX_CONTRACT_FRAGMENT_BYTES} bytes after bounded compaction`);
    error.code = 'REFERENCE_SEMANTIC_CONTRACT_FRAGMENT_TOO_LARGE';
    error.contract = contractName;
    error.retryable = true;
    throw error;
  }
  return compacted;
}

function mergeOwnedFragments(base = {}, fragments = {}) {
  const result = cloneJson(base, {});
  for (const name of Object.keys(CONTRACTS)) {
    const fragment = fragments?.[name]?.fragment || fragments?.[name] || {};
    for (const path of OWNED_FIELDS[name] || []) {
      const owned = ownPathValue(fragment, path);
      if (owned.found) setOwnPath(result, path, owned.value);
    }
  }
  return result;
}

function failuresFrom(value = {}) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (Array.isArray(value.failures)) return value.failures.map(String).filter(Boolean);
  if (Array.isArray(value.error?.failures)) return value.error.failures.map(String).filter(Boolean);
  if (Array.isArray(value.reference_understanding?.completeness?.failures)) {
    const failures = value.reference_understanding.completeness.failures.map(String).filter(Boolean);
    if (!failures.length && value.reference_understanding.completeness.valid === false) {
      return ['semantic_understanding_missing'];
    }
    return failures;
  }
  return ['semantic_understanding_missing'];
}

function auditContracts(value = {}) {
  const failures = [...new Set(failuresFrom(value))];
  const knownFailureCodes = new Set(Object.values(CONTRACTS).flatMap(contract => contract.failure_codes));
  const hardFailures = failures.filter(code => HARD_FAILURES.has(code));
  const unknownFailures = failures.filter(code => !knownFailureCodes.has(code) && !HARD_FAILURES.has(code));
  const contracts = Object.fromEntries(Object.entries(CONTRACTS).map(([name, contract]) => {
    const contractFailures = failures.filter(code => contract.failure_codes.includes(code));
    return [name, {
      complete: contractFailures.length === 0,
      failures: contractFailures,
      weight: contract.weight,
    }];
  }));
  const completed = Object.values(contracts).filter(contract => contract.complete).length;
  const score = Object.values(contracts).reduce((total, contract) => (
    total + (contract.complete ? contract.weight : 0)
  ), 0);
  return {
    valid: failures.length === 0,
    failures,
    contracts,
    completed,
    total: Object.keys(CONTRACTS).length,
    score,
    hard_failures: hardFailures,
    unknown_failures: unknownFailures,
  };
}

function missingContracts(audit = {}) {
  return Object.entries(audit.contracts || {})
    .filter(([, state]) => state?.complete !== true)
    .map(([name]) => name);
}

function isRepairable(audit = {}, { minimumScore = 50 } = {}) {
  return audit.valid !== true
    && Number(audit.score || 0) >= minimumScore
    && !audit.hard_failures?.length
    && !audit.unknown_failures?.length
    && missingContracts(audit).length > 0;
}

function extractSemanticDraft(analysis = {}) {
  const draft = {};
  for (const field of SEMANTIC_DRAFT_FIELDS) {
    if (analysis[field] !== undefined) draft[field] = analysis[field];
  }
  const cloned = cloneJson(draft, {});
  if (jsonBytes(cloned) <= MAX_BEST_DRAFT_BYTES) return cloned;
  const compacted = compactSemanticValue(cloned);
  if (jsonBytes(compacted) > MAX_BEST_DRAFT_BYTES) {
    const error = new Error(`Reference semantic candidate exceeds ${MAX_BEST_DRAFT_BYTES} bytes after bounded compaction`);
    error.code = 'REFERENCE_SEMANTIC_CANDIDATE_TOO_LARGE';
    error.retryable = true;
    throw error;
  }
  return compacted;
}

function emptyCheckpoint(inputFingerprint = '') {
  const contractStates = Object.fromEntries(Object.entries(CONTRACTS).map(([name, contract]) => [name, {
    complete: false,
    status: 'not_attempted',
    failures: ['not_attempted'],
    weight: contract.weight,
  }]));
  return {
    version: CHECKPOINT_VERSION,
    input_fingerprint: String(inputFingerprint || ''),
    best_candidate: null,
    contract_candidates: Object.fromEntries(Object.keys(CONTRACTS).map(name => [name, null])),
    contract_states: contractStates,
    attempt_summaries: [],
    repair_rounds: [],
    updated_at: '',
  };
}

function candidateRank(candidate = {}) {
  return [
    candidate.audit?.valid === true ? 1 : 0,
    candidate.audit?.hard_failures?.length || candidate.audit?.unknown_failures?.length ? 0 : 1,
    Number(candidate.audit?.score || 0),
    -Number(candidate.audit?.failures?.length || 0),
  ];
}

function isBetterCandidate(next = {}, current = null) {
  if (!current) return true;
  const nextRank = candidateRank(next);
  const currentRank = candidateRank(current);
  for (let index = 0; index < nextRank.length; index += 1) {
    if (nextRank[index] !== currentRank[index]) return nextRank[index] > currentRank[index];
  }
  return false;
}

function normalizedCheckpoint(checkpoint = {}) {
  const empty = emptyCheckpoint(checkpoint?.input_fingerprint);
  if (checkpoint?.version !== CHECKPOINT_VERSION) return empty;
  const normalized = {
    ...empty,
    ...checkpoint,
    contract_candidates: {
      ...empty.contract_candidates,
      ...(checkpoint.contract_candidates || {}),
    },
    contract_states: {
      ...empty.contract_states,
      ...(checkpoint.contract_states || {}),
    },
    attempt_summaries: Array.isArray(checkpoint.attempt_summaries)
      ? checkpoint.attempt_summaries.slice(-MAX_ATTEMPT_SUMMARIES)
      : [],
    repair_rounds: Array.isArray(checkpoint.repair_rounds) ? checkpoint.repair_rounds : [],
  };
  // In-place schema migration for v1 checkpoints written before per-contract
  // candidates existed. Rebuild only owned fragments from the retained draft;
  // never duplicate that entire draft for every contract.
  const storedBestBlocked = normalized.best_candidate?.audit?.hard_failures?.length > 0
    || normalized.best_candidate?.audit?.unknown_failures?.length > 0;
  for (const [name, contract] of Object.entries(CONTRACTS)) {
    if (!normalized.contract_candidates[name]
      && !storedBestBlocked
      && normalized.best_candidate?.audit?.contracts?.[name]?.complete === true) {
      const fragment = boundedOwnedFragment(normalized.best_candidate.draft || {}, name);
      normalized.contract_candidates[name] = {
        model: normalized.best_candidate.model || 'stored-semantic-checkpoint',
        candidate_index: Number(normalized.best_candidate.candidate_index || 0),
        digest: fingerprint(fragment),
        source_digest: normalized.best_candidate.digest || fingerprint(normalized.best_candidate.draft || {}),
        source_score: Number(normalized.best_candidate.audit?.score || 0),
        source_failure_count: Number(normalized.best_candidate.audit?.failures?.length || 0),
        source_valid: normalized.best_candidate.audit?.valid === true,
        fragment,
        saved_at: normalized.best_candidate.saved_at || normalized.updated_at || '',
      };
    }
    if (normalized.contract_candidates[name]) {
      normalized.contract_states[name] = {
        complete: true,
        status: 'complete',
        failures: [],
        weight: contract.weight,
        source_digest: normalized.contract_candidates[name].source_digest,
      };
    }
  }
  return normalized;
}

function attemptIdentity(summary = {}) {
  return fingerprint({
    input_fingerprint: summary.input_fingerprint || '',
    model: summary.model || '',
    candidate_index: Number(summary.candidate_index || 0),
    digest: summary.digest || '',
    status: summary.status || '',
    error_code: summary.error_code || '',
  });
}

function recordAttempt(checkpoint = {}, {
  model = '',
  candidateIndex = 0,
  digest = '',
  rawText = '',
  status = 'failed',
  errorCode = '',
  errorMessage = '',
  score = 0,
  valid = false,
  failures = [],
  savedAt = new Date().toISOString(),
} = {}) {
  const base = normalizedCheckpoint(checkpoint);
  const safeDigest = String(digest || (rawText ? fingerprint(String(rawText)) : ''));
  const summary = {
    input_fingerprint: base.input_fingerprint,
    model: String(model || ''),
    candidate_index: Math.max(0, Number(candidateIndex || 0)),
    digest: safeDigest,
    status: String(status || 'failed'),
    error_code: String(errorCode || ''),
    error_message: String(errorMessage || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    score: Number(score || 0),
    valid: valid === true,
    failures: (Array.isArray(failures) ? failures : []).map(String).filter(Boolean).slice(0, 20),
    saved_at: savedAt,
  };
  summary.id = attemptIdentity(summary);
  if (base.attempt_summaries.some(item => item?.id === summary.id)) return base;
  return {
    ...base,
    attempt_summaries: [...base.attempt_summaries, summary].slice(-MAX_ATTEMPT_SUMMARIES),
    updated_at: savedAt,
  };
}

function contractCandidateRank(candidate = {}) {
  return [
    Number(candidate.source_score || 0),
    -Number(candidate.source_failure_count || 0),
    Number(candidate.source_valid === true),
  ];
}

function isBetterContractCandidate(next = {}, current = null) {
  if (!current) return true;
  const nextRank = contractCandidateRank(next);
  const currentRank = contractCandidateRank(current);
  for (let index = 0; index < nextRank.length; index += 1) {
    if (nextRank[index] !== currentRank[index]) return nextRank[index] > currentRank[index];
  }
  return false;
}

function retainBestCandidate(checkpoint = {}, {
  analysis = {},
  model = '',
  candidateIndex = 0,
  savedAt = new Date().toISOString(),
} = {}) {
  const base = normalizedCheckpoint(checkpoint);
  const audit = auditContracts(analysis);
  const draft = extractSemanticDraft(analysis);
  const candidate = {
    model: String(model || ''),
    candidate_index: Math.max(0, Number(candidateIndex || 0)),
    digest: fingerprint(draft),
    audit,
    draft,
    saved_at: savedAt,
  };
  const bestCandidate = isBetterCandidate(candidate, base.best_candidate)
    ? candidate
    : base.best_candidate;
  const contractCandidates = { ...base.contract_candidates };
  const contractStates = { ...base.contract_states };
  const candidateBlocked = audit.hard_failures.length > 0 || audit.unknown_failures.length > 0;
  for (const [name, contract] of Object.entries(CONTRACTS)) {
    const state = audit.contracts[name] || { complete: false, failures: [] };
    if (state.complete && !candidateBlocked) {
      const fragment = boundedOwnedFragment(draft, name);
      const contractCandidate = {
        model: candidate.model,
        candidate_index: candidate.candidate_index,
        digest: fingerprint(fragment),
        source_digest: candidate.digest,
        source_score: audit.score,
        source_failure_count: audit.failures.length,
        source_valid: audit.valid,
        fragment,
        saved_at: savedAt,
      };
      if (isBetterContractCandidate(contractCandidate, contractCandidates[name])) {
        contractCandidates[name] = contractCandidate;
      }
    }
    if (contractCandidates[name]) {
      contractStates[name] = {
        complete: true,
        status: 'complete',
        failures: [],
        weight: contract.weight,
        source_digest: contractCandidates[name].source_digest,
      };
    } else {
      contractStates[name] = {
        complete: false,
        status: candidateBlocked ? 'blocked' : 'missing',
        failures: (candidateBlocked ? [...audit.hard_failures, ...audit.unknown_failures] : (state.failures || [])).slice(0, 20),
        weight: contract.weight,
      };
    }
  }
  const next = recordAttempt({
    ...base,
    best_candidate: bestCandidate,
    contract_candidates: contractCandidates,
    contract_states: contractStates,
  }, {
    model: candidate.model,
    candidateIndex: candidate.candidate_index,
    digest: candidate.digest,
    status: audit.valid ? 'valid' : (candidateBlocked ? 'blocked' : 'partial'),
    score: audit.score,
    valid: audit.valid,
    failures: audit.failures,
    savedAt,
  });
  return {
    ...next,
    best_candidate: bestCandidate,
    contract_candidates: contractCandidates,
    contract_states: contractStates,
  };
}

function checkpointMatches(checkpoint = {}, inputFingerprint = '') {
  return checkpoint.version === CHECKPOINT_VERSION
    && Boolean(inputFingerprint)
    && checkpoint.input_fingerprint === inputFingerprint;
}

function compositeDraft(checkpoint = {}) {
  const base = normalizedCheckpoint(checkpoint);
  return mergeOwnedFragments(base.best_candidate?.draft || {}, base.contract_candidates);
}

function publicProgress(checkpoint = {}) {
  const base = normalizedCheckpoint(checkpoint);
  const states = Object.fromEntries(Object.entries(base.contract_states || {}).map(([name, state]) => [name, {
    complete: state?.complete === true,
    status: String(state?.status || (state?.complete ? 'complete' : 'missing')),
    failures: Array.isArray(state?.failures) ? state.failures.slice(0, 8) : [],
  }]));
  const completed = Object.values(states).filter(state => state.complete).length;
  const score = Object.entries(states).reduce((total, [name, state]) => (
    total + (state.complete ? Number(CONTRACTS[name]?.weight || 0) : 0)
  ), 0);
  const progressFingerprint = fingerprint({
    version: CHECKPOINT_VERSION,
    input_fingerprint: base.input_fingerprint,
    states,
    best_digest: base.best_candidate?.digest || '',
    attempts: (base.attempt_summaries || []).map(item => item?.id || ''),
  });
  return {
    version: CHECKPOINT_VERSION,
    valid: completed === Object.keys(CONTRACTS).length,
    completed,
    total: Object.keys(CONTRACTS).length,
    score,
    missing_contracts: Object.entries(states).filter(([, state]) => !state.complete).map(([name]) => name),
    contracts: states,
    attempt_count: base.attempt_summaries.length,
    best_score: Number(base.best_candidate?.audit?.score || 0),
    progress_fingerprint: progressFingerprint.slice(0, 24),
  };
}

function mergeContractPatch(base = {}, patch = {}, contractNames = []) {
  const names = [...new Set((Array.isArray(contractNames) ? contractNames : [])
    .map(String).filter(name => Object.prototype.hasOwnProperty.call(CONTRACTS, name)))];
  const result = cloneJson(base, {});
  const incoming = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  for (const name of names) {
    for (const path of OWNED_FIELDS[name] || []) {
      const owned = ownPathValue(incoming, path);
      if (owned.found) setOwnPath(result, path, owned.value);
    }
  }
  return result;
}

module.exports = {
  CHECKPOINT_VERSION,
  CONTRACTS,
  OWNED_FIELDS,
  MAX_ATTEMPT_SUMMARIES,
  MAX_BEST_DRAFT_BYTES,
  MAX_CONTRACT_FRAGMENT_BYTES,
  MAX_SEMANTIC_ARRAY_ITEMS,
  fingerprint,
  auditContracts,
  missingContracts,
  isRepairable,
  extractSemanticDraft,
  emptyCheckpoint,
  recordAttempt,
  retainBestCandidate,
  checkpointMatches,
  compositeDraft,
  publicProgress,
  mergeContractPatch,
  _private: {
    stableValue,
    candidateRank,
    isBetterCandidate,
    failuresFrom,
    ownedFragment,
    boundedOwnedFragment,
    mergeOwnedFragments,
    compactSemanticValue,
    jsonBytes,
    normalizedCheckpoint,
    attemptIdentity,
    isBetterContractCandidate,
  },
};
