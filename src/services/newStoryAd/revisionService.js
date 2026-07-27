const crypto = require('crypto');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value ?? null;
  return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined && !['created_at', 'updated_at', 'previewUrl', 'uploading', 'progress'].includes(key))
    .map(key => [key, canonical(value[key])]));
}

function signature(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function domainSlices(ctx = {}) {
  return {
    source: {
      brief: ctx.brief,
      target_duration: ctx.target_duration,
      shot_count: ctx.shot_count,
      output_ratio: ctx.output_ratio,
      production_mode: ctx.production_mode,
      visible_text_policy: ctx.visible_text_policy,
    },
    creative: {
      creative_direction: ctx.creative_direction,
      story_structure: ctx.story_structure,
      original_brief: ctx.original_brief,
    },
    product: {
      product_subject: ctx.product_subject,
      assets: ctx.assets,
      product_contract: ctx.product_contract,
      product_control: ctx.controlled_production?.product_control,
    },
    scene: {
      scene_spec: ctx.scene_spec,
      scene_mode: ctx.scene_mode,
      environment: ctx.controlled_production?.environment_control,
      style: ctx.controlled_production?.style_control,
      negative: ctx.controlled_production?.negative_control,
    },
    person: {
      person_spec: ctx.person_spec,
      person_asset: ctx.person_asset,
      person_contract: ctx.person_contract,
      cast_profiles: ctx.cast_profiles,
      person_context: ctx.person_context,
      characters: ctx.characters,
      cast_mode: ctx.cast_mode,
      expected_people: ctx.expected_people,
      expected_animals: ctx.expected_animals,
      pet_profiles: ctx.pet_profiles,
      pet_contract: ctx.pet_contract,
    },
    voice: {
      voice_id: ctx.voice_id,
      voice_name: ctx.voice_name,
      include_voiceover: ctx.include_voiceover,
      voice_volume: ctx.voice_volume,
    },
    compose: {
      bgm_asset: ctx.bgm_asset,
      bgm_profile: ctx.bgm_profile,
      bgm_volume: ctx.bgm_volume,
      subtitle: ctx.subtitle,
      subtitle_style: ctx.subtitle_style,
      subtitle_config: ctx.subtitle_config,
      video_resolution: ctx.video_resolution,
    },
  };
}

function changeDomains(previous = {}, next = {}, explicit = '') {
  const before = domainSlices(previous);
  const after = domainSlices(next);
  const changed = Object.keys(after).filter(domain => signature(before[domain]) !== signature(after[domain]));
  const requested = Array.isArray(explicit)
    ? explicit
    : String(explicit || '').split(/[,\s]+/);
  requested
    .map(value => String(value || '').trim().toLowerCase())
    .filter(value => value && value !== 'none' && Object.prototype.hasOwnProperty.call(after, value))
    .forEach(value => {
      if (!changed.includes(value)) changed.push(value);
    });
  return changed;
}

function changeScope(previous = {}, next = {}, explicit = '') {
  const changed = changeDomains(previous, next, explicit);
  const priority = ['source', 'product', 'scene', 'person', 'creative', 'voice', 'compose'];
  return priority.find(domain => changed.includes(domain)) || 'none';
}

function applyRevisions(previous = {}, next = {}, scope = 'none') {
  const domains = Array.isArray(scope) ? scope : (scope && scope !== 'none' ? [scope] : []);
  const old = previous.revisions || {};
  const revisions = {
    source: Math.max(1, Number(old.source || 1) || 1),
    scene: Math.max(1, Number(old.scene || 1) || 1),
    person: Math.max(1, Number(old.person || 1) || 1),
    product: Math.max(1, Number(old.product || 1) || 1),
    creative: Math.max(1, Number(old.creative || 1) || 1),
    voice: Math.max(1, Number(old.voice || 1) || 1),
    compose: Math.max(1, Number(old.compose || 1) || 1),
  };
  if (domains.includes('source')) revisions.source += 1;
  if (domains.includes('scene') || domains.includes('source')) revisions.scene += 1;
  if (domains.includes('person') || domains.includes('source')) revisions.person += 1;
  if (domains.includes('product') || domains.includes('source')) revisions.product += 1;
  if (domains.includes('creative') || domains.includes('source')) revisions.creative += 1;
  if (domains.includes('voice')) revisions.voice += 1;
  if (domains.includes('compose')) revisions.compose += 1;
  return { ...next, revisions };
}

function invalidateOutputs(storage, taskId, scope = 'none') {
  const scopes = Array.isArray(scope) ? scope : (scope && scope !== 'none' ? [scope] : []);
  const graph = {
    source: ['scene_config', 'scene_assets', 'blueprint', 'storyboard_table', 'storyboard_meta', 'keyframe_contracts', 'keyframes', 'quality_review', 'tts_audio', 'video_clips', 'video_scene_blocks', 'final_video'],
    product: ['scene_config', 'scene_assets', 'blueprint', 'storyboard_table', 'storyboard_meta', 'keyframe_contracts', 'keyframes', 'quality_review', 'tts_audio', 'video_clips', 'video_scene_blocks', 'final_video'],
    scene: ['scene_config', 'scene_assets', 'blueprint', 'storyboard_table', 'keyframe_contracts', 'keyframes', 'tts_audio', 'video_clips', 'final_video'],
    person: ['blueprint', 'storyboard_table', 'storyboard_meta', 'keyframe_contracts', 'keyframes', 'quality_review', 'tts_audio', 'video_clips', 'video_scene_blocks', 'final_video'],
    creative: ['blueprint', 'storyboard_table', 'storyboard_meta', 'keyframe_contracts', 'keyframes', 'quality_review', 'tts_audio', 'video_clips', 'video_scene_blocks', 'final_video'],
    blueprint: ['storyboard_table', 'storyboard_meta', 'keyframe_contracts', 'keyframes', 'quality_review', 'tts_audio', 'video_clips', 'video_scene_blocks', 'final_video'],
    storyboard: ['keyframe_contracts', 'keyframes', 'quality_review', 'tts_audio', 'video_clips', 'video_scene_blocks', 'final_video'],
    voice: ['tts_audio', 'final_video'],
    compose: ['final_video'],
  };
  const downstream = [...new Set(scopes.flatMap(domain => graph[domain] || []))];
  downstream.forEach(kind => storage.deleteOutput(taskId, kind));
  return downstream;
}

module.exports = {
  signature,
  domainSlices,
  changeDomains,
  changeScope,
  applyRevisions,
  invalidateOutputs,
};
