const fs = require('fs');
const revisionService = require('./revisionService');

const VIDEO_PIPELINE_POLICY_VERSION = 'general-video-contract-v2';

function cleanAssetIdentity(value = '') {
  return String(value || '').trim().split('?')[0];
}

function shotIdentity(shot = {}, index = 0) {
  return String(shot.shot_id || shot.id || shot.key || `shot-${index + 1}`);
}

function buildShotLineage({
  shot = {}, index = 0, contract = {}, keyframe = {}, ctx = {}, blueprint = {},
  storyboardMeta = {}, modelRoute = '', speechMode = '', motionPrompt = '', audio = {}, sceneBlock = null,
} = {}) {
  const payload = {
    policy_version: VIDEO_PIPELINE_POLICY_VERSION,
    shot_id: shotIdentity(shot, index),
    shot_index: index + 1,
    shot_signature: revisionService.signature({
      title: shot.title, purpose: shot.purpose || shot.role, visual: shot.visual || shot.visual_description,
      action: shot.action || shot.visual_action, camera: shot.camera || shot.camera_movement,
      duration: shot.duration_sec || shot.duration, characters: shot.characters, dialogue: shot.dialogue || shot.voiceover,
      continuity: shot.continuity || shot.continuity_contract, design: shot.shot_design || shot.motion_effect,
    }),
    source_revision: Number(ctx.revisions?.source || 1),
    scene_revision: Number(ctx.revisions?.scene || contract.scene_lock?.scene_revision || 1),
    person_revision: Number(ctx.revisions?.person || contract.cast_lock?.person_contract?.person_revision || 1),
    product_revision: Number(ctx.revisions?.product || contract.product_lock?.product_revision || 1),
    blueprint_revision: Number(blueprint.revision || storyboardMeta.blueprint_revision || 0),
    blueprint_fingerprint: String(blueprint.fingerprint || storyboardMeta.blueprint_fingerprint || ''),
    storyboard_revision: Number(storyboardMeta.revision || storyboardMeta.storyboard_revision || 0),
    storyboard_fingerprint: String(storyboardMeta.fingerprint || storyboardMeta.storyboard_fingerprint || ''),
    contract_revision: Number(contract.contract_revision || contract.revision || 0),
    contract_fingerprint: String(contract.contract_fingerprint || ''),
    keyframe_generation_id: String(keyframe.current_generation_id || keyframe.generation_id || keyframe.id || ''),
    keyframe_contract_fingerprint: String(keyframe.contract_fingerprint || keyframe.current_contract_fingerprint || ''),
    keyframe_asset: cleanAssetIdentity(keyframe.image_url || keyframe.imageUrl || keyframe.url || ''),
    keyframe_acceptance: String(keyframe.current_generation_status || keyframe.status || ''),
    person_contract_fingerprint: String(contract.cast_lock?.person_contract?.person_fingerprint || ctx.person_contract?.person_fingerprint || ''),
    product_contract_fingerprint: String(contract.product_lock?.product_fingerprint || ctx.product_contract?.product_fingerprint || ''),
    scene_contract_signature: revisionService.signature(contract.scene_lock || {}),
    speech_mode: String(speechMode || ''),
    motion_prompt_signature: revisionService.signature(String(motionPrompt || '')),
    audio_signature: revisionService.signature({
      url: cleanAssetIdentity(audio.audio_url || audio.audioUrl || audio.url || ''),
      voice_id: audio.voice_id || audio.voiceId || '',
      duration: audio.duration_sec || audio.duration || 0,
    }),
    output_ratio: String(ctx.output_ratio || ''),
    video_resolution: String(ctx.video_resolution || ''),
    scene_block_policy_version: String(sceneBlock?.policy_version || ''),
    scene_block_id: String(sceneBlock?.id || ''),
    scene_block_fingerprint: String(sceneBlock?.fingerprint || ''),
    scene_block_members: Array.isArray(sceneBlock?.member_indexes) ? sceneBlock.member_indexes.map(index => index + 1) : [],
    model_route: String(modelRoute || '').toLowerCase(),
  };
  return { ...payload, fingerprint: revisionService.signature(payload) };
}

function clipHasUsableFile(clip = {}) {
  if (!clip || clip.error_code || clip.error) return false;
  if (clip.file_path) return fs.existsSync(clip.file_path);
  return !!(clip.video_url || clip.videoUrl);
}

function qaApproved(clip = {}) {
  return clip.qa?.pass === true && clip.cross_shot_qa?.pass !== false;
}

function canAdoptLegacyClip(clip = {}, expected = {}) {
  // Independent legacy clips cannot be treated as a continuous scene block;
  // the provider must generate that spatial sequence in one call.
  if (Array.isArray(expected.scene_block_members) && expected.scene_block_members.length > 1) return false;
  return clipHasUsableFile(clip)
    && qaApproved(clip)
    && String(clip.provider_used || clip.providerUsed || '').toLowerCase() === expected.model_route
    && revisionService.signature(String(clip.motion_prompt || '')) === expected.motion_prompt_signature
    && (!clip.qa?.contract_fingerprint || clip.qa.contract_fingerprint === expected.contract_fingerprint);
}

function reuseDecision(clip = {}, expected = {}, { allowLegacyAdoption = true } = {}) {
  if (!clipHasUsableFile(clip)) return { reusable: false, reason: 'missing_or_failed_clip' };
  if (!qaApproved(clip)) return { reusable: false, reason: 'qa_not_approved' };
  const actual = clip.lineage_fingerprint || clip.lineage?.fingerprint || '';
  if (actual && actual === expected.fingerprint) return { reusable: true, reason: 'lineage_match' };
  if (!actual && allowLegacyAdoption && canAdoptLegacyClip(clip, expected)) return { reusable: true, adopted: true, reason: 'safe_legacy_adoption' };
  return { reusable: false, reason: actual ? 'lineage_changed' : 'legacy_lineage_unverified' };
}

function attachLineage(clip = {}, lineage = {}, extra = {}) {
  return {
    ...clip,
    lineage,
    lineage_fingerprint: lineage.fingerprint || '',
    pipeline_policy_version: VIDEO_PIPELINE_POLICY_VERSION,
    ...extra,
  };
}

module.exports = {
  VIDEO_PIPELINE_POLICY_VERSION,
  buildShotLineage,
  clipHasUsableFile,
  qaApproved,
  reuseDecision,
  attachLineage,
};
