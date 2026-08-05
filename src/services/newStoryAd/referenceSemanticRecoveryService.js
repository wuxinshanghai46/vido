const crypto = require('crypto');

const CHECKPOINT_VERSION = 'reference-semantic-recovery-v1';
const MAX_ATTEMPT_SUMMARIES = 6;
const MAX_BEST_DRAFT_BYTES = 64 * 1024;

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

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
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
  return [];
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
  const serialized = JSON.stringify(draft);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BEST_DRAFT_BYTES) {
    const error = new Error(`参考语义候选超过持久化上限 ${MAX_BEST_DRAFT_BYTES} bytes`);
    error.code = 'REFERENCE_SEMANTIC_CANDIDATE_TOO_LARGE';
    error.retryable = true;
    throw error;
  }
  return JSON.parse(serialized);
}

function emptyCheckpoint(inputFingerprint = '') {
  const contractStates = Object.fromEntries(Object.entries(CONTRACTS).map(([name, contract]) => [name, {
    complete: false,
    failures: ['not_attempted'],
    weight: contract.weight,
  }]));
  return {
    version: CHECKPOINT_VERSION,
    input_fingerprint: String(inputFingerprint || ''),
    best_candidate: null,
    contract_states: contractStates,
    attempt_summaries: [],
    repair_rounds: [],
    updated_at: '',
  };
}

function candidateRank(candidate = {}) {
  return [
    candidate.audit?.valid === true ? 1 : 0,
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

function retainBestCandidate(checkpoint = {}, {
  analysis = {},
  model = '',
  candidateIndex = 0,
  savedAt = new Date().toISOString(),
} = {}) {
  const base = checkpoint?.version === CHECKPOINT_VERSION
    ? checkpoint
    : emptyCheckpoint(checkpoint?.input_fingerprint);
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
  const summary = {
    model: candidate.model,
    candidate_index: candidate.candidate_index,
    digest: candidate.digest,
    score: audit.score,
    valid: audit.valid,
    failures: audit.failures.slice(0, 20),
    saved_at: savedAt,
  };
  const bestCandidate = isBetterCandidate(candidate, base.best_candidate)
    ? candidate
    : base.best_candidate;
  return {
    ...base,
    best_candidate: bestCandidate,
    contract_states: bestCandidate?.audit?.contracts || base.contract_states,
    attempt_summaries: [...(base.attempt_summaries || []), summary].slice(-MAX_ATTEMPT_SUMMARIES),
    updated_at: savedAt,
  };
}

function checkpointMatches(checkpoint = {}, inputFingerprint = '') {
  return checkpoint.version === CHECKPOINT_VERSION
    && Boolean(inputFingerprint)
    && checkpoint.input_fingerprint === inputFingerprint;
}

function publicProgress(checkpoint = {}) {
  const audit = checkpoint.best_candidate?.audit || {
    contracts: checkpoint.contract_states || {},
    valid: false,
    score: 0,
  };
  const states = Object.fromEntries(Object.entries(audit.contracts || {}).map(([name, state]) => [name, {
    complete: state?.complete === true,
    failures: Array.isArray(state?.failures) ? state.failures.slice(0, 8) : [],
  }]));
  return {
    version: CHECKPOINT_VERSION,
    valid: audit.valid === true,
    completed: Object.values(states).filter(state => state.complete).length,
    total: Object.keys(CONTRACTS).length,
    score: Number(audit.score || 0),
    missing_contracts: Object.entries(states).filter(([, state]) => !state.complete).map(([name]) => name),
    contracts: states,
  };
}

function mergeContractPatch(base = {}, patch = {}, contractNames = []) {
  const names = new Set(Array.isArray(contractNames) ? contractNames : []);
  const result = JSON.parse(JSON.stringify(base || {}));
  const incoming = patch && typeof patch === 'object' ? patch : {};
  const proposedUnderstanding = incoming.reference_understanding && typeof incoming.reference_understanding === 'object'
    ? incoming.reference_understanding : {};
  result.reference_understanding = result.reference_understanding && typeof result.reference_understanding === 'object'
    ? { ...result.reference_understanding } : {};
  if (names.has('story')) {
    if (incoming.summary !== undefined) result.summary = incoming.summary;
    if (incoming.story_outline !== undefined) result.story_outline = incoming.story_outline;
    if (proposedUnderstanding.story_summary !== undefined) {
      result.reference_understanding.story_summary = proposedUnderstanding.story_summary;
    }
  }
  if (names.has('timeline')) {
    if (incoming.plot_beats !== undefined) result.plot_beats = incoming.plot_beats;
    ['causal_chain', 'facts', 'inferences', 'unknowns'].forEach(field => {
      if (proposedUnderstanding[field] !== undefined) result.reference_understanding[field] = proposedUnderstanding[field];
    });
  }
  if (names.has('cast')) {
    ['character_prompts', 'character_actions', 'animal_prompts', 'animal_actions'].forEach(field => {
      if (incoming[field] !== undefined) result[field] = incoming[field];
    });
    if (proposedUnderstanding.characters !== undefined) {
      result.reference_understanding.characters = proposedUnderstanding.characters;
    }
  }
  if (names.has('scenes') && proposedUnderstanding.scenes !== undefined) {
    result.reference_understanding.scenes = proposedUnderstanding.scenes;
  }
  if (names.has('brand_audio')) {
    ['brand_role', 'audio_visual'].forEach(field => {
      if (proposedUnderstanding[field] !== undefined) result.reference_understanding[field] = proposedUnderstanding[field];
    });
    if (incoming.subtitle_cta !== undefined) result.subtitle_cta = incoming.subtitle_cta;
  }
  return result;
}

module.exports = {
  CHECKPOINT_VERSION,
  CONTRACTS,
  MAX_ATTEMPT_SUMMARIES,
  MAX_BEST_DRAFT_BYTES,
  fingerprint,
  auditContracts,
  missingContracts,
  isRepairable,
  extractSemanticDraft,
  emptyCheckpoint,
  retainBestCandidate,
  checkpointMatches,
  publicProgress,
  mergeContractPatch,
  _private: { stableValue, candidateRank, isBetterCandidate, failuresFrom },
};
