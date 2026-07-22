const revisionService = require('./revisionService');

const BOUNDARY_REPAIR_POLICY_VERSION = 'cross-unit-visual-anchor-v2';
const DIRECT_TAIL_FIRST_FRAME = 'previous_tail_first_frame';
const MANAGED_DUAL_REFERENCE = 'approved_keyframe_and_previous_tail_private_assets';

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

function keyframePresence(keyframe = {}) {
  const value = text(keyframe.qa?.person?.person_presence || keyframe.person_presence).toLowerCase();
  if (['person', 'full', 'principal'].includes(value)) return 'person';
  if (['partial', 'hand', 'arm', 'body_part'].includes(value)) return 'partial';
  if (['none', 'no_human', 'empty'].includes(value)) return 'none';
  return 'unknown';
}

function approvedKeyframe(keyframe = {}) {
  return !!text(keyframe.image_url || keyframe.imageUrl || keyframe.url) && keyframe.qa?.pass === true;
}

function sceneLockIdentity(contract = {}, shot = {}) {
  const lock = contract.scene_lock || {};
  const id = text(lock.scene_id || lock.id || shot.scene_id || shot.sceneId);
  const revision = text(lock.scene_revision ?? lock.revision ?? shot.scene_revision ?? shot.sceneRevision);
  return id ? `${id}@${revision || 'unknown'}` : '';
}

function personLockIdentity(contract = {}) {
  const person = contract.cast_lock?.person_contract || contract.person_contract || {};
  const id = text(person.person_id || person.identity_id || person.id || person.name);
  const revision = text(person.person_revision ?? person.revision);
  const wardrobe = text(person.wardrobe_fingerprint || person.wardrobe_id || person.wardrobe_lock || person.wardrobe);
  if (!id && !revision && !wardrobe) return '';
  return `${id || 'verified-person'}@${revision || 'unknown'}#${wardrobe || 'unknown'}`;
}

function assessDirectTailCapability({ previousShot = {}, currentShot = {}, previousKeyframe = {}, currentKeyframe = {}, previousContract = {}, currentContract = {} } = {}) {
  const previousPresence = keyframePresence(previousKeyframe);
  const currentPresence = keyframePresence(currentKeyframe);
  const previousScene = sceneLockIdentity(previousContract, previousShot);
  const currentScene = sceneLockIdentity(currentContract, currentShot);
  const previousPerson = personLockIdentity(previousContract);
  const currentPerson = personLockIdentity(currentContract);
  const reasons = [];
  if (!approvedKeyframe(previousKeyframe) || !approvedKeyframe(currentKeyframe)) reasons.push('approved_keyframe_evidence_incomplete');
  if (currentPresence === 'person' && previousPresence !== 'person') reasons.push('partial_tail_cannot_lock_full_person');
  if (currentPresence === 'partial' && !['person', 'partial'].includes(previousPresence)) reasons.push('tail_missing_required_person_state');
  if (previousScene && currentScene && previousScene !== currentScene) reasons.push('scene_lock_changes_across_boundary');
  if (!previousScene || !currentScene) reasons.push('scene_lock_identity_incomplete');
  if (currentPresence === 'person' && (!previousPerson || !currentPerson || previousPerson !== currentPerson)) reasons.push('person_or_wardrobe_lock_not_proven_equal');
  return {
    safe: reasons.length === 0,
    reasons,
    previous_person_presence: previousPresence,
    current_person_presence: currentPresence,
    previous_scene_lock: previousScene,
    current_scene_lock: currentScene,
    previous_person_lock: previousPerson,
    current_person_lock: currentPerson,
  };
}

function inputStrategy(options = {}) {
  const requested = text(options.boundary_repair_input_mode || options.boundaryRepairInputMode).toLowerCase();
  return ['managed_dual_reference', 'managed_dual_references', MANAGED_DUAL_REFERENCE].includes(requested)
    ? MANAGED_DUAL_REFERENCE
    : DIRECT_TAIL_FIRST_FRAME;
}

function buildContract({ clips = [], shots = [], keyframes = [], contracts = [], index = 0 } = {}) {
  if (!Number.isInteger(index) || index <= 0) return null;
  const qa = clips[index]?.cross_shot_qa || {};
  if (qa.pass !== false) return null;
  const previousShot = shots[index - 1] || {};
  const currentShot = shots[index] || {};
  const directTailCapability = assessDirectTailCapability({
    previousShot, currentShot,
    previousKeyframe: keyframes[index - 1] || {}, currentKeyframe: keyframes[index] || {},
    previousContract: contracts[index - 1] || {}, currentContract: contracts[index] || {},
  });
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
    direct_tail_capability: directTailCapability,
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
  const managed = contract.input_strategy === MANAGED_DUAL_REFERENCE;
  return [
    'BOUNDARY REPAIR IS MANDATORY.',
    managed
      ? 'Reference image 1 is the approved current-unit keyframe and controls identity, wardrobe, scene and composition. Reference image 2 is the actual tail frame of the preceding generated unit and controls the opening hand position, body pose, gaze/screen direction, prop state and action handoff.'
      : 'The supplied first frame is the actual tail frame of the preceding generated unit and is the authoritative opening state for hand position, body pose, gaze/screen direction, prop state and action handoff. The approved current-unit keyframe remains the QA target, not a second provider image input.',
    managed
      ? 'Open from a state that is visually compatible with reference image 2, then continue into reference image 1 and the authored current action. Do not restart, recast, mirror, teleport or duplicate the person.'
      : 'Continue directly from the supplied first frame into the authored current action while preserving identity, wardrobe and scene. Do not restart, recast, mirror, teleport or duplicate the person.',
    details,
    `Boundary repair contract: ${contract.fingerprint}.`,
  ].filter(Boolean).join(' ');
}

function buildContracts({ clips = [], shots = [], keyframes = [], contracts = [], indexes = [] } = {}) {
  const requested = indexes.length ? indexes : clips.map((_, index) => index);
  return Object.fromEntries(requested
    .map(Number)
    .filter(Number.isInteger)
    .map(index => [index, buildContract({ clips, shots, keyframes, contracts, index })])
    .filter(([, contract]) => contract));
}

module.exports = {
  BOUNDARY_REPAIR_POLICY_VERSION,
  DIRECT_TAIL_FIRST_FRAME,
  MANAGED_DUAL_REFERENCE,
  previousTailImageUrl,
  providerSupportsBoundaryReference,
  assessDirectTailCapability,
  inputStrategy,
  buildContract,
  buildContracts,
  repairInstruction,
};
