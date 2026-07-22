const revisionService = require('./revisionService');

const BOUNDARY_REPAIR_POLICY_VERSION = 'cross-unit-visual-anchor-v1';

function text(value = '') {
  return String(value || '').trim();
}

function clipped(value = '', limit = 240) {
  return text(value).slice(0, Math.max(1, Number(limit) || 240));
}

function previousTailImageUrl(clips = [], index = 0) {
  const frames = Array.isArray(clips[index - 1]?.qa?.frames) ? clips[index - 1].qa.frames : [];
  const ordered = frames
    .filter(frame => frame && text(frame.image_url || frame.imageUrl || frame.url))
    .sort((a, b) => Number(a.second || 0) - Number(b.second || 0));
  const tail = ordered[ordered.length - 1] || {};
  return text(tail.image_url || tail.imageUrl || tail.url);
}

function providerSupportsBoundaryReference(providerRoute = '') {
  return /^deyunai\/doubao-seedance-2-0(?:-|$)/i.test(text(providerRoute));
}

function buildContract({ clips = [], shots = [], index = 0 } = {}) {
  if (!Number.isInteger(index) || index <= 0) return null;
  const qa = clips[index]?.cross_shot_qa || {};
  if (qa.pass !== false) return null;
  const previousShot = shots[index - 1] || {};
  const currentShot = shots[index] || {};
  const failureDimensions = [...new Set((Array.isArray(qa.failure_dimensions) ? qa.failure_dimensions : []).slice(0, 8).map(value => clipped(value, 80)).filter(Boolean))];
  const failureLabels = [...new Set((Array.isArray(qa.failure_labels_zh) ? qa.failure_labels_zh : []).slice(0, 8).map(value => clipped(value, 120)).filter(Boolean))];
  const problems = [...new Set((Array.isArray(qa.problems) ? qa.problems : []).slice(0, 8).map(value => clipped(value, 240)).filter(Boolean))];
  const source = {
    policy_version: BOUNDARY_REPAIR_POLICY_VERSION,
    boundary_index: index,
    previous_shot_index: index - 1,
    current_shot_index: index,
    previous_tail_image_url: previousTailImageUrl(clips, index),
    failure_dimensions: failureDimensions,
    failure_labels_zh: failureLabels,
    problems,
    qa_retry_instruction: clipped(qa.retry_instruction, 500),
    previous_exit_frame_state: clipped(previousShot.exit_frame_state, 220),
    current_entry_frame_state: clipped(currentShot.entry_frame_state, 220),
    previous_screen_direction: clipped(previousShot.screen_direction, 80),
    current_screen_direction: clipped(currentShot.screen_direction, 80),
    previous_action: clipped(previousShot.action || previousShot.visual_action, 300),
    current_action: clipped(currentShot.action || currentShot.visual_action, 300),
  };
  return { ...source, fingerprint: revisionService.signature(source) };
}

function repairInstruction(contract = {}) {
  if (!contract || !contract.fingerprint) return '';
  const details = [
    contract.failure_dimensions?.length ? `Failed continuity dimensions: ${contract.failure_dimensions.join(', ')}.` : '',
    contract.problems?.length ? `Observed problems: ${contract.problems.join('; ')}.` : '',
    contract.qa_retry_instruction ? `QA instruction: ${contract.qa_retry_instruction}` : '',
    contract.previous_exit_frame_state ? `Previous unit exit state: ${contract.previous_exit_frame_state}.` : '',
    contract.current_entry_frame_state ? `Current unit entry state: ${contract.current_entry_frame_state}.` : '',
    contract.previous_screen_direction ? `Previous screen direction: ${contract.previous_screen_direction}.` : '',
    contract.current_screen_direction ? `Current screen direction: ${contract.current_screen_direction}.` : '',
  ].filter(Boolean).join(' ');
  return [
    'BOUNDARY REPAIR IS MANDATORY.',
    'Reference image 1 is the approved current-unit keyframe and controls identity, wardrobe, scene and composition.',
    'Reference image 2 is the actual tail frame of the preceding generated unit and controls the opening hand position, body pose, gaze/screen direction, prop state and action handoff.',
    'Open from a state that is visually compatible with reference image 2, then continue into reference image 1 and the authored current action. Do not restart, recast, mirror, teleport or duplicate the person.',
    details,
    `Boundary repair contract: ${contract.fingerprint}.`,
  ].filter(Boolean).join(' ');
}

function buildContracts({ clips = [], shots = [], indexes = [] } = {}) {
  const requested = indexes.length ? indexes : clips.map((_, index) => index);
  return Object.fromEntries(requested
    .map(Number)
    .filter(Number.isInteger)
    .map(index => [index, buildContract({ clips, shots, index })])
    .filter(([, contract]) => contract));
}

module.exports = {
  BOUNDARY_REPAIR_POLICY_VERSION,
  previousTailImageUrl,
  providerSupportsBoundaryReference,
  buildContract,
  buildContracts,
  repairInstruction,
};
