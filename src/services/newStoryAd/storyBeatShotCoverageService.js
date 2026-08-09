'use strict';

const crypto = require('crypto');

const CONTRACT_VERSION = 'story-beat-shot-coverage-v6';
const FORBIDDEN_CINEMATOGRAPHY_KEYS = new Set([
  'camera', 'camera_id', 'camera_angle', 'camera_movement', 'shot_size', 'shot_type',
  'lens', 'lens_mm', 'depth_of_field', 'composition', 'subject_position', 'scene_view',
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function text(value, max = 800) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(value) { return Array.isArray(value) ? value : []; }

function strings(value, max = 64) {
  return [...new Set(list(value).map(item => text(
    typeof item === 'string' ? item : (item?.description || item?.text || item?.requirement || item?.id),
    500,
  )).filter(Boolean))].slice(0, max);
}

function normalizeBeat(row = {}, index = 0) {
  const storyBeatId = text(row.story_beat_id || row.beat_id || row.id || `story_beat_${index + 1}`, 160);
  const evidence = strings(row.required_evidence || row.visible_evidence || row.evidence_requirements);
  const actions = strings(row.visible_actions || row.action_steps || row.actions);
  const changes = strings(row.state_changes || row.intended_changes || row.changes);
  const summary = text(row.summary || row.plot || row.content || row.description || row.purpose, 1200);
  const obligations = [
    ...evidence.map((description, obligationIndex) => ({
      obligation_id: `${storyBeatId}:evidence:${obligationIndex + 1}`,
      kind: 'evidence', description,
    })),
    ...actions.map((description, obligationIndex) => ({
      obligation_id: `${storyBeatId}:action:${obligationIndex + 1}`,
      kind: 'action', description,
    })),
    ...changes.map((description, obligationIndex) => ({
      obligation_id: `${storyBeatId}:change:${obligationIndex + 1}`,
      kind: 'state_change', description,
    })),
  ];
  if (!obligations.length && summary) {
    obligations.push({ obligation_id: `${storyBeatId}:story:1`, kind: 'story', description: summary });
  }
  return {
    story_beat_id: storyBeatId,
    source_index: Math.max(1, Number(row.beat_index || row.index || index + 1) || index + 1),
    role: text(row.role || row.phase || row.story_phase, 120),
    summary,
    spoken_line: text(row.spoken_line || row.voiceover || row.copy, 300),
    dialogue_function: text(row.dialogue_function || row.dialogue_intent, 160),
    scene_id: text(row.scene_id || row.sceneId, 160),
    state_before: strings(row.state_before || row.entry_state),
    state_after: strings(row.state_after || row.exit_state),
    invariants: strings(row.invariants || row.continuity_requirements),
    duration_hint: Math.max(0, Number(row.duration_hint || row.duration_sec || row.duration || 0) || 0),
    obligations,
  };
}

function splitBalanced(items, count) {
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor((index * items.length) / count);
    const end = Math.floor(((index + 1) * items.length) / count);
    return items.slice(start, Math.max(start + (items.length ? 1 : 0), end));
  });
}

function minimumUnits(beat, options) {
  const byObligation = Math.ceil(beat.obligations.length / options.max_obligations_per_unit);
  const byDuration = beat.duration_hint > 0 ? Math.ceil(beat.duration_hint / options.max_shot_duration) : 1;
  return Math.max(1, byObligation, byDuration);
}

function allocationFor(beats, options) {
  const allocation = beats.map(beat => minimumUnits(beat, options));
  const requested = Math.max(beats.length, options.target_shots);
  let remaining = Math.max(0, requested - allocation.reduce((sum, value) => sum + value, 0));
  const priorities = beats.map((beat, index) => ({
    index,
    score: beat.obligations.length + (beat.duration_hint / options.max_shot_duration),
  })).sort((left, right) => right.score - left.score || left.index - right.index);
  let cursor = 0;
  while (remaining > 0 && priorities.length) {
    allocation[priorities[cursor % priorities.length].index] += 1;
    remaining -= 1;
    cursor += 1;
  }
  return allocation;
}

function planCoverage({
  beats = [],
  target_shots = 0,
  target_duration = 0,
  max_shot_duration = 6,
  max_obligations_per_unit = 2,
} = {}) {
  const normalizedBeats = list(beats).map(normalizeBeat);
  if (!normalizedBeats.length) {
    const error = new Error('story_beat_shot_coverage_beats_missing');
    error.code = 'SHOT_COVERAGE_PLAN_INVALID';
    error.status = 422;
    throw error;
  }
  const options = {
    target_shots: Math.max(0, Math.round(Number(target_shots) || 0)),
    target_duration: Math.max(0, Number(target_duration) || 0),
    max_shot_duration: Math.max(1, Math.min(30, Number(max_shot_duration) || 6)),
    max_obligations_per_unit: Math.max(1, Math.min(12, Math.round(Number(max_obligations_per_unit) || 2))),
  };
  const allocations = allocationFor(normalizedBeats, options);
  const totalUnits = allocations.reduce((sum, value) => sum + value, 0);
  const defaultDuration = options.target_duration > 0
    ? Math.min(options.max_shot_duration, options.target_duration / totalUnits)
    : Math.min(3, options.max_shot_duration);
  let globalSequence = 0;
  const beatCoverage = normalizedBeats.map((beat, beatIndex) => {
    const count = allocations[beatIndex];
    const groups = splitBalanced(beat.obligations, count);
    const beatDuration = beat.duration_hint > 0
      ? Math.min(options.max_shot_duration, beat.duration_hint / count)
      : defaultDuration;
    const coverageUnits = groups.map((obligations, segmentIndex) => {
      globalSequence += 1;
      const coverageId = `${beat.story_beat_id}:coverage:${segmentIndex + 1}`;
      const priorObligation = segmentIndex > 0 ? groups[segmentIndex - 1].slice(-1)[0] : null;
      return {
        coverage_id: coverageId,
        story_beat_id: beat.story_beat_id,
        global_sequence: globalSequence,
        segment_index: segmentIndex + 1,
        segment_count: count,
        role: beat.role,
        narrative_instruction: text([
          beat.summary,
          count > 1 ? `推进该剧情节拍的第 ${segmentIndex + 1}/${count} 个可见状态` : '',
        ].filter(Boolean).join('；'), 1400),
        obligation_ids: obligations.map(item => item.obligation_id),
        required_evidence: obligations.filter(item => item.kind === 'evidence').map(item => item.description),
        visible_actions: obligations.filter(item => item.kind === 'action').map(item => item.description),
        intended_changes: obligations.filter(item => item.kind === 'state_change').map(item => item.description),
        entry_state: segmentIndex === 0
          ? beat.state_before
          : (priorObligation ? [`前一覆盖单元已完成：${priorObligation.description}`] : []),
        exit_state: segmentIndex === count - 1
          ? beat.state_after
          : obligations.slice(-1).map(item => `本覆盖单元完成：${item.description}`),
        invariants: beat.invariants,
        duration_budget_sec: Number(beatDuration.toFixed(3)),
        spoken_line: segmentIndex === 0 ? beat.spoken_line : '',
        dialogue_function: beat.dialogue_function,
        scene_id: beat.scene_id,
      };
    });
    return {
      story_beat_id: beat.story_beat_id,
      source_index: beat.source_index,
      required_shot_count: count,
      obligation_count: beat.obligations.length,
      coverage_units: coverageUnits,
    };
  });
  const payload = {
    contract_version: CONTRACT_VERSION,
    beat_count: normalizedBeats.length,
    shot_coverage_count: totalUnits,
    beat_coverage: beatCoverage,
  };
  const plan = {
    ...payload,
    coverage_hash: hash(payload),
  };
  validateCoveragePlan(plan);
  return plan;
}

function coverageUnits(plan = {}) {
  return list(plan.beat_coverage).flatMap(row => list(row.coverage_units));
}

function forbiddenKeys(value, prefix = '') {
  if (Array.isArray(value)) return value.flatMap((item, index) => forbiddenKeys(item, `${prefix}[${index}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [...(FORBIDDEN_CINEMATOGRAPHY_KEYS.has(key) ? [path] : []), ...forbiddenKeys(child, path)];
  });
}

function validateCoveragePlan(plan = {}) {
  const issues = [];
  if (plan.contract_version !== CONTRACT_VERSION) issues.push('contract_version_mismatch');
  const rows = list(plan.beat_coverage);
  const units = coverageUnits(plan);
  if (!rows.length) issues.push('beat_coverage_missing');
  rows.forEach((row, index) => {
    if (!row.story_beat_id) issues.push(`beat_coverage[${index}].story_beat_id_missing`);
    if (!list(row.coverage_units).length) issues.push(`beat_coverage[${index}].coverage_units_missing`);
    if (Number(row.required_shot_count) !== list(row.coverage_units).length) {
      issues.push(`beat_coverage[${index}].required_shot_count_mismatch`);
    }
  });
  const ids = units.map(unit => unit.coverage_id);
  if (new Set(ids).size !== ids.length) issues.push('coverage_id_duplicate');
  if (Number(plan.shot_coverage_count) !== units.length) issues.push('shot_coverage_count_mismatch');
  issues.push(...forbiddenKeys(units).map(path => `cinematography_forbidden:${path}`));
  const expectedHash = hash({
    contract_version: plan.contract_version,
    beat_count: plan.beat_count,
    shot_coverage_count: plan.shot_coverage_count,
    beat_coverage: plan.beat_coverage,
  });
  if (plan.coverage_hash !== expectedHash) issues.push('coverage_hash_mismatch');
  if (issues.length) {
    const error = new Error(`shot_coverage_plan_invalid:${issues.join('|')}`);
    error.code = 'SHOT_COVERAGE_PLAN_INVALID';
    error.status = 422;
    error.retryable = false;
    error.issues = issues;
    throw error;
  }
  return true;
}

module.exports = {
  CONTRACT_VERSION,
  FORBIDDEN_CINEMATOGRAPHY_KEYS,
  planCoverage,
  validateCoveragePlan,
  coverageUnits,
};
