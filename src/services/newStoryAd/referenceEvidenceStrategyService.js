const CONTRACT_VERSION = 'adaptive-evidence-strategy-v1';

const INTENTS = Object.freeze([
  'entity',
  'scene',
  'action',
  'transition',
  'brand_text',
]);

const INTENT_SET = new Set(INTENTS);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rounded(value) {
  return Number(finite(value).toFixed(3));
}

function normalizedRange(value = [], duration = 0) {
  const source = Array.isArray(value) ? value.slice(0, 2).map(Number) : [];
  if (source.length !== 2 || !source.every(Number.isFinite) || source[1] <= source[0]) return [];
  const safeDuration = Math.max(0, finite(duration));
  const start = Math.max(0, source[0]);
  const end = safeDuration > 0 ? Math.min(safeDuration, source[1]) : source[1];
  return end > start ? [rounded(start), rounded(end)] : [];
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeIntents(values = []) {
  return unique((Array.isArray(values) ? values : [values])
    .map(value => String(value || '').trim().toLowerCase())
    .filter(value => INTENT_SET.has(value)));
}

/**
 * Route generic evidence dimensions by temporal role. These dimensions describe
 * observable capabilities, not industries, products, locations, or story genres.
 */
function routeFrameIntents(sample = {}, segment = {}) {
  const role = String(sample.sample_role || sample.role || 'representative').trim().toLowerCase();
  const explicit = normalizeIntents(sample.intents || sample.required_intents);
  if (explicit.length) return explicit;

  const routes = {
    opening: ['entity', 'scene', 'transition', 'brand_text'],
    midpoint: ['entity', 'action', 'brand_text'],
    closing: ['entity', 'action', 'transition', 'brand_text'],
    representative: INTENTS,
  };
  const routed = routes[role] || INTENTS;
  return normalizeIntents([
    ...routed,
    ...(Array.isArray(segment.required_intents) ? segment.required_intents : []),
  ]);
}

function sampleAt(segment, role, ratio) {
  const [start, end] = segment.range;
  const length = end - start;
  let timestamp;
  if (role === 'opening') timestamp = start + Math.min(0.25, length * 0.15);
  else if (role === 'closing') timestamp = end - Math.min(0.25, length * 0.15);
  else timestamp = start + (length * ratio);
  const sample = {
    timestamp_seconds: rounded(timestamp),
    shot_index: segment.shot_index,
    shot_range: segment.range.slice(),
    sample_role: role,
    detection_source: String(segment.source || 'adaptive_segment'),
  };
  sample.intents = routeFrameIntents(sample, segment);
  return sample;
}

/**
 * Short segments use one representative observation, medium segments preserve
 * their entry and exit states, and longer segments additionally observe the
 * midpoint where actions and state changes are most likely to be missed.
 */
function planSegmentSamples(input = {}, options = {}) {
  const duration = Math.max(0, finite(options.duration || input.duration_seconds));
  const range = normalizedRange(input.range || input.shot_range, duration);
  if (!range.length) return [];
  const segment = {
    ...input,
    range,
    shot_index: Math.max(1, Math.round(finite(input.shot_index, 1))),
  };
  const length = range[1] - range[0];
  const shortThreshold = Math.max(0.2, finite(options.short_segment_seconds, 0.9));
  const longThreshold = Math.max(shortThreshold, finite(options.long_segment_seconds, 2.4));

  if (length <= shortThreshold) return [sampleAt(segment, 'representative', 0.5)];
  if (length <= longThreshold) {
    return [sampleAt(segment, 'opening', 0.15), sampleAt(segment, 'closing', 0.85)];
  }
  return [
    sampleAt(segment, 'opening', 0.15),
    sampleAt(segment, 'midpoint', 0.5),
    sampleAt(segment, 'closing', 0.85),
  ];
}

function representativeSample(segment) {
  const sample = sampleAt(segment, 'representative', 0.5);
  sample.detection_source = `${sample.detection_source}_budget_anchor`;
  return sample;
}

function optionalPriority(sample, segment) {
  const length = segment.range[1] - segment.range[0];
  const roleWeight = sample.sample_role === 'midpoint' ? 3 : 2;
  const declaredRisk = Math.max(0, finite(segment.change_score || segment.risk_score || segment.motion_score));
  return (declaredRisk * 1000) + (length * 10) + roleWeight;
}

function sameSample(left, right) {
  return Number(left.shot_index) === Number(right.shot_index)
    && Math.abs(Number(left.timestamp_seconds) - Number(right.timestamp_seconds)) < 0.04;
}

/**
 * Build a bounded plan without silently dropping an entire detected segment.
 * When optional samples exceed the budget, every segment keeps one complete
 * representative anchor and remaining slots are assigned by generic change risk.
 */
function buildAdaptiveEvidencePlan({
  duration = 0,
  segments = [],
  max_frames = 40,
  short_segment_seconds = 0.9,
  long_segment_seconds = 2.4,
} = {}) {
  const safeDuration = Math.max(0.1, finite(duration, 0.1));
  const normalizedSegments = (Array.isArray(segments) ? segments : []).map((segment, index) => {
    const range = normalizedRange(segment?.range || segment?.shot_range, safeDuration);
    return range.length ? {
      ...segment,
      range,
      shot_index: Math.max(1, Math.round(finite(segment?.shot_index, index + 1))),
    } : null;
  }).filter(Boolean);
  const maxFrames = Math.max(1, Math.round(finite(max_frames, 40)));
  if (!normalizedSegments.length) {
    return {
      contract_version: CONTRACT_VERSION,
      frames: [],
      segment_count: 0,
      budget: { max_frames: maxFrames, desired_frame_count: 0, selected_frame_count: 0, optional_frames_omitted: 0 },
    };
  }
  if (normalizedSegments.length > maxFrames) {
    const error = new Error(`检测到 ${normalizedSegments.length} 个证据片段，超过 ${maxFrames} 帧预算，不能静默丢弃片段`);
    error.code = 'REFERENCE_EVIDENCE_SEGMENT_BUDGET_EXCEEDED';
    error.status = 422;
    error.retryable = false;
    error.segment_count = normalizedSegments.length;
    error.max_frames = maxFrames;
    throw error;
  }

  const planningOptions = { duration: safeDuration, short_segment_seconds, long_segment_seconds };
  const desiredBySegment = normalizedSegments.map(segment => planSegmentSamples(segment, planningOptions));
  const desired = desiredBySegment.flat();
  let selected = desired.slice();

  if (desired.length > maxFrames) {
    const anchors = normalizedSegments.map(representativeSample);
    const optional = desired.map(sample => {
      const segment = normalizedSegments.find(item => item.shot_index === sample.shot_index);
      return { sample, priority: optionalPriority(sample, segment) };
    }).filter(item => !anchors.some(anchor => sameSample(anchor, item.sample)))
      .sort((left, right) => right.priority - left.priority
        || left.sample.timestamp_seconds - right.sample.timestamp_seconds);
    selected = [...anchors, ...optional.slice(0, Math.max(0, maxFrames - anchors.length)).map(item => item.sample)];
  }

  selected.sort((left, right) => left.timestamp_seconds - right.timestamp_seconds
    || left.shot_index - right.shot_index);
  const frames = selected.map((sample, index) => ({
    ...sample,
    frame_id: `F${String(index + 1).padStart(3, '0')}`,
    strategy_version: CONTRACT_VERSION,
  }));
  return {
    contract_version: CONTRACT_VERSION,
    frames,
    segment_count: normalizedSegments.length,
    sampled_segment_count: new Set(frames.map(frame => frame.shot_index)).size,
    required_intents: INTENTS.slice(),
    budget: {
      max_frames: maxFrames,
      desired_frame_count: desired.length,
      selected_frame_count: frames.length,
      optional_frames_omitted: Math.max(0, desired.length - frames.length),
      limited: desired.length > maxFrames,
    },
  };
}

function own(row, key) {
  return Object.prototype.hasOwnProperty.call(row || {}, key);
}

function populated(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return String(value || '').trim().length > 0;
}

function explicitObservation(row, keys = []) {
  return keys.some(key => own(row, key) && (
    typeof row[key] === 'boolean'
    || populated(row[key])
    || Array.isArray(row[key])
  ));
}

/** Infer which generic observations a normalized evidence row actually answered. */
function inferCoveredIntents(row = {}) {
  const declared = normalizeIntents(row.covered_intents || row.intent_coverage);
  const covered = new Set(declared);
  if (row.entity_observation_complete === true || explicitObservation(row, [
    'entities', 'people', 'product_or_service', 'human_presence', 'animal_presence',
  ])) covered.add('entity');
  if (row.scene_observation_complete === true || explicitObservation(row, [
    'scene_id', 'environment', 'layout', 'materials', 'lighting',
  ])) covered.add('scene');
  if (row.action_observation_complete === true || explicitObservation(row, [
    'actions', 'action', 'human_actions', 'animal_actions', 'subject_motion',
  ])) covered.add('action');
  if (row.transition_observation_complete === true || explicitObservation(row, [
    'transition', 'transition_type', 'scene_change', 'state_change',
  ])) covered.add('transition');
  if (row.brand_text_observation_complete === true || explicitObservation(row, [
    'visible_text', 'brand_text', 'brand', 'logo', 'product_or_service',
  ])) covered.add('brand_text');
  return INTENTS.filter(intent => covered.has(intent));
}

function evidenceRows(input = []) {
  return (Array.isArray(input) ? input : []).flatMap(item => (
    Array.isArray(item?.payload?.frames) ? item.payload.frames : [item]
  )).filter(Boolean);
}

/**
 * Coverage is measured by required frame-intent slots, not only by frame IDs.
 * A frame can therefore be returned while action or transition coverage remains
 * incomplete, preventing an inaccurate "32/32 means everything is understood".
 */
function computeCoverage(plan = {}, evidence = []) {
  const frames = Array.isArray(plan) ? plan : (Array.isArray(plan?.frames) ? plan.frames : []);
  const rows = evidenceRows(evidence);
  const rowsById = new Map(rows.map(row => [String(row.frame_id || ''), row]));
  const dimensions = Object.fromEntries(INTENTS.map(intent => [intent, {
    required: 0,
    covered: 0,
    ratio: 1,
    missing_frame_ids: [],
  }]));
  const frameResults = frames.map(frame => {
    const frameId = String(frame.frame_id || '');
    const expected = normalizeIntents(frame.intents).length ? normalizeIntents(frame.intents) : INTENTS.slice();
    const actual = inferCoveredIntents(rowsById.get(frameId) || {});
    const missing = expected.filter(intent => !actual.includes(intent));
    expected.forEach(intent => {
      dimensions[intent].required += 1;
      if (actual.includes(intent)) dimensions[intent].covered += 1;
      else dimensions[intent].missing_frame_ids.push(frameId);
    });
    return {
      frame_id: frameId,
      shot_index: Number(frame.shot_index || 0),
      required_intents: expected,
      covered_intents: actual,
      missing_intents: missing,
      complete: missing.length === 0,
    };
  });
  INTENTS.forEach(intent => {
    const row = dimensions[intent];
    row.missing_frame_ids = unique(row.missing_frame_ids);
    row.ratio = row.required ? Number((row.covered / row.required).toFixed(3)) : 1;
  });
  const expectedShots = unique(frames.map(frame => String(frame.shot_index || '')).filter(Boolean));
  const coveredShots = unique(frameResults.filter(frame => frame.complete).map(frame => String(frame.shot_index || '')).filter(Boolean));
  const requiredSlots = INTENTS.reduce((sum, intent) => sum + dimensions[intent].required, 0);
  const coveredSlots = INTENTS.reduce((sum, intent) => sum + dimensions[intent].covered, 0);
  const missingFrameIds = unique(frameResults.filter(frame => !frame.complete).map(frame => frame.frame_id));
  return {
    contract_version: CONTRACT_VERSION,
    complete: frames.length > 0 && missingFrameIds.length === 0,
    required_slot_count: requiredSlots,
    covered_slot_count: coveredSlots,
    overall_ratio: requiredSlots ? Number((coveredSlots / requiredSlots).toFixed(3)) : 0,
    expected_frame_count: frames.length,
    returned_frame_count: frames.filter(frame => rowsById.has(String(frame.frame_id || ''))).length,
    complete_frame_count: frameResults.filter(frame => frame.complete).length,
    expected_shot_count: expectedShots.length,
    covered_shot_count: coveredShots.length,
    missing_frame_ids: missingFrameIds,
    dimensions,
    frames: frameResults,
  };
}

module.exports = {
  CONTRACT_VERSION,
  INTENTS,
  normalizeIntents,
  routeFrameIntents,
  planSegmentSamples,
  buildAdaptiveEvidencePlan,
  inferCoveredIntents,
  computeCoverage,
  _private: { normalizedRange, sampleAt, evidenceRows },
};
