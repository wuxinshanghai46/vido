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
  const hasScenePlan = Object.prototype.hasOwnProperty.call(ctx, 'scene_plan')
    && ctx.scene_plan
    && typeof ctx.scene_plan === 'object';
  return {
    source: {
      brief: ctx.brief,
      world_setting: ctx.world_setting,
      target_duration: ctx.target_duration,
      shot_count: ctx.shot_count,
      output_ratio: ctx.output_ratio,
      visible_text_policy: ctx.visible_text_policy,
      reference_analysis_id: ctx.reference_video_analysis?.analysis_id || ctx.reference_video_analysis?.id || '',
      reference_understanding: ctx.reference_video_analysis?.reference_understanding || null,
      reference_camera_intents: ctx.reference_video_analysis?.camera_intents || [],
      reference_source_facts: ctx.reference_video_analysis?.source_facts || {},
      reference_generated_brief: ctx.reference_video_analysis?.generated_brief || '',
    },
    creative: {
      production_mode: ctx.production_mode,
      story_setup_confirmed: ctx.story_setup_confirmed,
      creative_direction: ctx.creative_direction,
      story_structure: ctx.story_structure,
      original_brief: ctx.original_brief,
      brand_overlay: ctx.brand_overlay,
    },
    product: {
      product_subject: ctx.product_subject,
      product_presentation: ctx.product_presentation,
      assets: ctx.assets,
      product_contract: ctx.product_contract,
      product_control: ctx.controlled_production?.product_control,
    },
    scene: {
      scene_plan: hasScenePlan ? ctx.scene_plan : undefined,
      scene_spec: hasScenePlan ? undefined : ctx.scene_spec,
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
      video_quality: ctx.video_quality,
    },
  };
}

function scenePlanSpaces(plan = {}) {
  return (Array.isArray(plan?.spaces) ? plan.spaces : []).map((space, index) => {
    const id = String(space?.id || space?.space_id || space?.scene_id || '').trim();
    return {
      id: id || `space_${index + 1}`,
      scene_spec: space?.scene_spec || space?.sceneSpec || null,
    };
  });
}

function scenePlanDelta(previousPlan = {}, nextPlan = {}) {
  const before = new Map(scenePlanSpaces(previousPlan).map(space => [space.id, signature(space.scene_spec)]));
  const after = new Map(scenePlanSpaces(nextPlan).map(space => [space.id, signature(space.scene_spec)]));
  const compatible_scene_ids = [...after.keys()].filter(id => before.get(id) === after.get(id));
  const changed_scene_ids = [...new Set([
    ...[...before.keys()].filter(id => !after.has(id) || before.get(id) !== after.get(id)),
    ...[...after.keys()].filter(id => !before.has(id) || before.get(id) !== after.get(id)),
  ])];
  return {
    changed: signature(previousPlan) !== signature(nextPlan),
    compatible_scene_ids,
    changed_scene_ids,
  };
}

function compatibleSceneAssets(sceneAssets = [], delta = {}) {
  const compatible = new Set(Array.isArray(delta.compatible_scene_ids) ? delta.compatible_scene_ids : []);
  return (Array.isArray(sceneAssets) ? sceneAssets : []).filter((asset, index) => {
    const id = String(asset?.scene_id || asset?.space_id || asset?.id || `space_${index + 1}`).trim();
    return compatible.has(id);
  });
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

function invalidateOutputs(storage, taskId, scope = 'none', options = {}) {
  const scopes = Array.isArray(scope) ? scope : (scope && scope !== 'none' ? [scope] : []);
  const graph = {
    source: ['asset_plan', 'scene_config', 'scene_assets', 'blueprint_draft_checkpoint', 'blueprint', 'storyboard_table', 'storyboard_meta', 'storyboard_sketches', 'storyboard_sketch_batch', 'keyframe_contracts', 'keyframes', 'quality_review', 'tts_audio', 'video_clips', 'video_scene_blocks', 'final_video'],
    product: ['scene_config', 'scene_assets', 'blueprint_draft_checkpoint', 'blueprint', 'storyboard_table', 'storyboard_meta', 'storyboard_sketches', 'storyboard_sketch_batch', 'keyframe_contracts', 'keyframes', 'quality_review', 'tts_audio', 'video_clips', 'video_scene_blocks', 'final_video'],
    scene: ['scene_config', 'scene_assets', 'blueprint_draft_checkpoint', 'blueprint', 'storyboard_table', 'storyboard_sketches', 'storyboard_sketch_batch', 'keyframe_contracts', 'keyframes', 'tts_audio', 'video_clips', 'final_video'],
    person: ['blueprint_draft_checkpoint', 'blueprint', 'storyboard_table', 'storyboard_meta', 'storyboard_sketches', 'storyboard_sketch_batch', 'keyframe_contracts', 'keyframes', 'quality_review', 'tts_audio', 'video_clips', 'video_scene_blocks', 'final_video'],
    // A dossier/image refresh does not change the story meaning. Keep the
    // approved blueprint, text storyboard, scene bindings and voice, then
    // refresh only outputs that contain the previous visual identity.
    person_visual: ['storyboard_sketches', 'storyboard_sketch_batch', 'keyframe_contracts', 'keyframes', 'quality_review', 'video_clips', 'video_scene_blocks', 'final_video'],
    creative: ['blueprint_draft_checkpoint', 'blueprint', 'storyboard_table', 'storyboard_meta', 'storyboard_sketches', 'storyboard_sketch_batch', 'keyframe_contracts', 'keyframes', 'quality_review', 'tts_audio', 'video_clips', 'video_scene_blocks', 'final_video'],
    blueprint: ['storyboard_table', 'storyboard_meta', 'storyboard_sketches', 'storyboard_sketch_batch', 'keyframe_contracts', 'keyframes', 'quality_review', 'tts_audio', 'video_clips', 'video_scene_blocks', 'final_video'],
    storyboard: ['storyboard_sketches', 'storyboard_sketch_batch', 'keyframe_contracts', 'keyframes', 'quality_review', 'tts_audio', 'video_clips', 'video_scene_blocks', 'final_video'],
    voice: ['tts_audio', 'final_video'],
    compose: ['final_video'],
  };
  const preserveKinds = new Set(Array.isArray(options.preserveKinds) ? options.preserveKinds : []);
  const downstream = [...new Set(scopes.flatMap(domain => graph[domain] || []))]
    .filter(kind => !preserveKinds.has(kind));
  if (typeof storage.deleteOutputs === 'function') storage.deleteOutputs(taskId, downstream);
  else downstream.forEach(kind => storage.deleteOutput(taskId, kind));
  return downstream;
}

module.exports = {
  signature,
  domainSlices,
  changeDomains,
  changeScope,
  applyRevisions,
  invalidateOutputs,
  scenePlanDelta,
  compatibleSceneAssets,
};
