const crypto = require('crypto');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value ?? null;
  return Object.fromEntries(Object.keys(value).sort()
    .filter(key => !['created_at', 'updated_at', 'previewUrl', 'uploading', 'progress'].includes(key))
    .map(key => [key, canonical(value[key])]));
}

function signature(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function changeScope(previous = {}, next = {}, explicit = '') {
  const requested = String(explicit || '').trim().toLowerCase();
  if (['source', 'scene', 'person', 'product', 'none'].includes(requested)) return requested;
  const personBefore = {
    person_spec: previous.person_spec,
    person_asset: previous.person_asset,
    cast_profiles: previous.cast_profiles,
    person_context: previous.person_context,
    characters: previous.characters,
    cast_mode: previous.cast_mode,
    expected_people: previous.expected_people,
    expected_animals: previous.expected_animals,
    pet_profiles: previous.pet_profiles,
    pet_contract: previous.pet_contract,
  };
  const personAfter = {
    person_spec: next.person_spec,
    person_asset: next.person_asset,
    cast_profiles: next.cast_profiles,
    person_context: next.person_context,
    characters: next.characters,
    cast_mode: next.cast_mode,
    expected_people: next.expected_people,
    expected_animals: next.expected_animals,
    pet_profiles: next.pet_profiles,
    pet_contract: next.pet_contract,
  };
  const sceneBefore = {
    scene_spec: previous.scene_spec,
    environment: previous.controlled_production?.environment_control,
    style: previous.controlled_production?.style_control,
    negative: previous.controlled_production?.negative_control,
  };
  const sceneAfter = {
    scene_spec: next.scene_spec,
    environment: next.controlled_production?.environment_control,
    style: next.controlled_production?.style_control,
    negative: next.controlled_production?.negative_control,
  };
  const productBefore = {
    product_subject: previous.product_subject,
    assets: previous.assets,
    product_control: previous.controlled_production?.product_control,
  };
  const productAfter = {
    product_subject: next.product_subject,
    assets: next.assets,
    product_control: next.controlled_production?.product_control,
  };
  const sourceBefore = {
    brief: previous.brief,
    target_duration: previous.target_duration,
    shot_count: previous.shot_count,
    output_ratio: previous.output_ratio,
  };
  const sourceAfter = {
    brief: next.brief,
    target_duration: next.target_duration,
    shot_count: next.shot_count,
    output_ratio: next.output_ratio,
  };
  if (signature(sourceBefore) !== signature(sourceAfter)) return 'source';
  if (signature(productBefore) !== signature(productAfter)) return 'product';
  if (signature(sceneBefore) !== signature(sceneAfter)) return 'scene';
  if (signature(personBefore) !== signature(personAfter)) return 'person';
  return 'none';
}

function applyRevisions(previous = {}, next = {}, scope = 'none') {
  const old = previous.revisions || {};
  const revisions = {
    source: Math.max(1, Number(old.source || 1) || 1),
    scene: Math.max(1, Number(old.scene || 1) || 1),
    person: Math.max(1, Number(old.person || 1) || 1),
    product: Math.max(1, Number(old.product || 1) || 1),
  };
  if (scope === 'source') revisions.source += 1;
  if (scope === 'scene' || scope === 'source') revisions.scene += 1;
  if (scope === 'person' || scope === 'source') revisions.person += 1;
  if (scope === 'product' || scope === 'source') revisions.product += 1;
  return { ...next, revisions };
}

function invalidateOutputs(storage, taskId, scope = 'none') {
  const downstream = {
    source: ['scene_config', 'blueprint', 'storyboard_table', 'keyframe_contracts', 'keyframes', 'tts_audio', 'video_clips', 'final_video'],
    product: ['scene_config', 'blueprint', 'storyboard_table', 'keyframe_contracts', 'keyframes', 'tts_audio', 'video_clips', 'final_video'],
    scene: ['scene_config', 'scene_assets', 'blueprint', 'storyboard_table', 'keyframe_contracts', 'keyframes', 'tts_audio', 'video_clips', 'final_video'],
    person: ['blueprint', 'storyboard_table', 'keyframe_contracts', 'keyframes', 'tts_audio', 'video_clips', 'final_video'],
    none: [],
  }[scope] || [];
  downstream.forEach(kind => storage.deleteOutput(taskId, kind));
  return downstream;
}

module.exports = {
  signature,
  changeScope,
  applyRevisions,
  invalidateOutputs,
};
