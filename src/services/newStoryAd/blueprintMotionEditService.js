'use strict';

const revisionService = require('./revisionService');
const storyboardImageLineage = require('./storyboardImageLineageService');

const MOTION_FIELDS = new Set([
  'action', 'camera_movement', 'camera_movement_notes', 'video_prompt_override',
]);
const VOLATILE_FIELDS = new Set([
  'fingerprint', 'revision', 'created_at', 'updated_at', 'edited_at', 'edited_by_user',
]);

function stableObject(value, { omitMotion = false } = {}) {
  if (Array.isArray(value)) return value.map(item => stableObject(item, { omitMotion }));
  if (!value || typeof value !== 'object') return value ?? null;
  return Object.fromEntries(Object.keys(value).sort()
    .filter(key => !VOLATILE_FIELDS.has(key) && !(omitMotion && MOTION_FIELDS.has(key)))
    .map(key => [key, stableObject(value[key], { omitMotion })]));
}

function beatIdentity(beat = {}, index = 0) {
  return String(beat.shot_id || beat.id || beat.beat_id || `beat-${index + 1}`);
}

function plan(previous = {}, next = {}) {
  const before = Array.isArray(previous.beats) ? previous.beats : [];
  const after = Array.isArray(next.beats) ? next.beats : [];
  if (!before.length || before.length !== after.length) return { eligible: false, changed_indexes: [], reason: 'beat_count_changed' };
  const topBefore = { ...previous }; delete topBefore.beats;
  const topAfter = { ...next }; delete topAfter.beats;
  if (revisionService.signature(stableObject(topBefore)) !== revisionService.signature(stableObject(topAfter))) {
    return { eligible: false, changed_indexes: [], reason: 'blueprint_header_changed' };
  }
  const changedIndexes = [];
  for (let index = 0; index < before.length; index += 1) {
    if (beatIdentity(before[index], index) !== beatIdentity(after[index], index)) return { eligible: false, changed_indexes: [], reason: 'beat_identity_changed' };
    if (revisionService.signature(stableObject(before[index], { omitMotion: true })) !== revisionService.signature(stableObject(after[index], { omitMotion: true }))) {
      return { eligible: false, changed_indexes: [], reason: `non_motion_field_changed:${index + 1}` };
    }
    if (revisionService.signature(stableObject(before[index])) !== revisionService.signature(stableObject(after[index]))) changedIndexes.push(index);
  }
  return { eligible: changedIndexes.length > 0, changed_indexes: changedIndexes, reason: changedIndexes.length ? 'motion_only' : 'unchanged' };
}

function patchStoryboard(shots = [], blueprint = {}, changedIndexes = []) {
  const changed = new Set(changedIndexes.map(Number));
  const beats = Array.isArray(blueprint.beats) ? blueprint.beats : [];
  return shots.map((shot, index) => {
    if (!changed.has(index)) return { ...shot };
    const beat = beats[index] || {};
    const action = String(beat.action || '').trim();
    return {
      ...shot,
      action,
      visual_action: action,
      camera_movement: String(beat.camera_movement || '').trim(),
      camera_movement_notes: String(beat.camera_movement_notes || '').trim(),
      video_prompt_override: String(beat.video_prompt_override || '').trim(),
      edited_at: new Date().toISOString(),
      motion_only_edit: true,
    };
  });
}

function rebaseImages(images = [], shots = [], contentRevision = 1, changedIndexes = []) {
  const changed = new Set(changedIndexes.map(Number));
  return images.map((image, index) => {
    if (!image || typeof image !== 'object') return image;
    const shotIndex = Math.max(1, Number(image.shot_index || index + 1) || index + 1);
    const shot = shots[shotIndex - 1] || {};
    return {
      ...image,
      source_content_revision: Number(contentRevision),
      shot_contract_fingerprint: storyboardImageLineage.shotContractFingerprint(shot, shotIndex - 1),
      ...(changed.has(shotIndex - 1) ? {
        motion_only_rebased: true,
        motion_only_rebased_at: new Date().toISOString(),
      } : {}),
    };
  });
}

module.exports = { MOTION_FIELDS, plan, patchStoryboard, rebaseImages, stableObject };
