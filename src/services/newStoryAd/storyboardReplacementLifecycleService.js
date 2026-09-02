'use strict';

const historicalRecovery = require('./historicalDomainRecoveryService');

const VISUAL_DOWNSTREAM_KINDS = Object.freeze([
  'storyboard_images', 'storyboard_image_batch', 'storyboard_sketches', 'storyboard_sketch_batch',
  'storyboard_image_prompt_overrides', 'shot_reference_packs', 'continuity_contracts',
  'keyframes', 'keyframe_provider_audit', 'video_clips', 'video_scene_blocks',
  'final_video', 'edit_timeline', 'media_runtime_context', 'video_generation_authorization',
  'video_cost_authorization',
]);
const AUDIO_DOWNSTREAM_KINDS = Object.freeze(['tts_audio', 'audio_timeline', 'audio_license_ledger']);

function finalizeForcedReplacement({ storage, taskId, previousTtsAudio, nextShots, audioApprovalKind = '' }) {
  const compatibility = historicalRecovery.audioCompatibility(
    Array.isArray(nextShots) ? nextShots : [],
    historicalRecovery.tracksFrom(previousTtsAudio),
  );
  storage.deleteOutputs(taskId, VISUAL_DOWNSTREAM_KINDS);
  if (!compatibility.compatible) {
    storage.deleteOutputs(taskId, AUDIO_DOWNSTREAM_KINDS);
    if (audioApprovalKind) storage.deleteOutput(taskId, audioApprovalKind);
  }
  const task = storage.getTask(taskId) || {};
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const nextContext = {
    ...context,
    shot_confirmed: true,
    shot_design_confirmed: false,
  };
  storage.saveOutput(taskId, 'context', nextContext);
  storage.updateTask(taskId, { request: nextContext, updated_at: new Date().toISOString() });
  const result = {
    audio_preserved: compatibility.compatible,
    audio_compatibility_issues: compatibility.issues,
    invalidated_kinds: [...VISUAL_DOWNSTREAM_KINDS, ...(compatibility.compatible ? [] : [...AUDIO_DOWNSTREAM_KINDS, audioApprovalKind].filter(Boolean))],
  };
  storage.saveOutput(taskId, 'storyboard_meta', {
    ...(storage.getOutput(taskId, 'storyboard_meta') || {}),
    forced_replacement_at: new Date().toISOString(),
    downstream_invalidated: result.invalidated_kinds,
    tts_preserved: result.audio_preserved,
  });
  return result;
}

module.exports = { AUDIO_DOWNSTREAM_KINDS, VISUAL_DOWNSTREAM_KINDS, finalizeForcedReplacement };
