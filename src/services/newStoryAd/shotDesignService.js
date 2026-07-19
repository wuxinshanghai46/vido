function clean(value = '', max = 600) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function structuredText(value, max = 600) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return clean(value, max);
  if (Array.isArray(value)) return clean(value.map(item => structuredText(item, max)).filter(Boolean).join('; '), max);
  if (typeof value === 'object') {
    const text = Object.entries(value)
      .map(([key, item]) => {
        const normalized = structuredText(item, max);
        return normalized ? `${clean(key, 80)}: ${normalized}` : '';
      })
      .filter(Boolean)
      .join('; ');
    return clean(text, max);
  }
  return clean(value, max);
}

function enumValue(value, allowed = [], fallback = '') {
  const normalized = clean(value, 60).toLowerCase().replace(/[\s-]+/g, '_');
  return allowed.includes(normalized) ? normalized : fallback;
}

const SHOT_SCOPES = ['auto', 'environment', 'product_comparison', 'character', 'brand_endcard'];
const SURFACE_MODES = ['auto', 'continuous', 'segmented', 'modular'];
const SEAM_POLICIES = ['auto', 'hidden', 'visible', 'task_defined'];
const FINISH_DISTRIBUTIONS = ['auto', 'uniform', 'gradient', 'regional', 'sample_comparison'];
const MOTION_EFFECTS = ['none', 'particle_assembly', 'fade', 'dissolve', 'material_flow', 'custom'];
const EFFECT_INTENSITIES = ['low', 'medium', 'high'];

function normalizeSurfaceTopology(input = null) {
  const raw = typeof input === 'string' ? { mode: input } : (input && typeof input === 'object' ? input : {});
  const topology = {
    mode: enumValue(raw.mode, SURFACE_MODES, 'auto'),
    seam_policy: enumValue(raw.seam_policy || raw.seamPolicy, SEAM_POLICIES, 'auto'),
    finish_distribution: enumValue(raw.finish_distribution || raw.finishDistribution, FINISH_DISTRIBUTIONS, 'auto'),
    notes: clean(raw.notes || raw.requirement || '', 500),
  };
  const meaningful = topology.mode !== 'auto'
    || topology.seam_policy !== 'auto'
    || topology.finish_distribution !== 'auto'
    || topology.notes;
  return meaningful ? topology : undefined;
}

/** Detect an explicit request for one uninterrupted primary surface. */
function hasContinuousSurfaceIntent(value = '') {
  const text = structuredText(value, 2400);
  if (!text) return false;
  return /一整面|整面(?:连续|完整)|连续(?:、|，|和|且)?完整|完整(?:、|，|和|且)?连续|一面完整的?(?:背景)?墙|连续基面|无缝(?:墙|基面|表面)|single\s+(?:continuous|uninterrupted)\s+(?:wall|surface|plane)|one\s+(?:continuous|uninterrupted)\s+(?:wall|surface|plane)|no\s+(?:visible\s+)?(?:panel|module|tile|grid|seam)/i.test(text)
    || /(?:禁止|不得|不要|严禁|避免)[^。；;]{0,48}(?:模块化|模块|拼板|板块|网格墙|样品墙|展示墙|可见接缝|拼缝)/i.test(text);
}

/** A regional finish is valid only when the task maps it to a named place. */
function hasExplicitFinishRegionMapping(value = '') {
  const text = structuredText(value, 2400);
  if (!text) return false;
  const spatialToken = '(?:左侧|右侧|上部|下部|顶部|底部|中央|中心|入口侧|出口侧|内侧|外侧|前部|后部|left|right|upper|lower|top|bottom|centre|center|entrance|exit|inner|outer|front|rear)';
  const finishToken = '(?:材质|饰面|纹理|表面|涂层|色彩|颜色|material|finish|texture|surface|coating|colou?r)';
  return new RegExp(`${spatialToken}[^。；;]{0,48}${finishToken}|${finishToken}[^。；;]{0,48}(?:位于|设置于|应用于|限定于|mapped\\s+to|placed\\s+at|applied\\s+to)[^。；;]{0,48}${spatialToken}`, 'i').test(text);
}

/** Resolve contradictory select values and free-text requirements before generation. */
function resolveSurfaceTopology(input = null, contextText = '') {
  const topology = normalizeSurfaceTopology(input);
  const notes = topology?.notes || '';
  const continuous = topology?.mode === 'continuous' || hasContinuousSurfaceIntent([contextText, notes]);
  if (!continuous) return topology;
  const regionalMapped = hasExplicitFinishRegionMapping([contextText, notes]);
  const requestedDistribution = topology?.finish_distribution || 'auto';
  const finishDistribution = requestedDistribution === 'gradient'
    ? 'gradient'
    : (requestedDistribution === 'regional' && regionalMapped ? 'regional' : 'uniform');
  return {
    mode: 'continuous',
    seam_policy: 'hidden',
    finish_distribution: finishDistribution,
    notes,
  };
}

function normalizeMaterialContract(input = {}, options = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const sourceText = clean(options.sourceText || source.source_text || source.sourceText || '', 1000);
  const topology = resolveSurfaceTopology(options.topology, sourceText) || {};
  const referenceAvailable = options.referenceAvailable === true;
  const observableCues = Array.isArray(source.observable_cues || source.observableCues)
    ? (source.observable_cues || source.observableCues).map(value => clean(value, 100)).filter(Boolean).slice(0, 8)
    : [];
  return {
    source_text: sourceText,
    evidence_mode: referenceAvailable ? 'reference_exact' : 'observable_only',
    source_authority: referenceAvailable ? 'task_text_and_reference' : 'task_text',
    dominant_finish: clean(source.dominant_finish || source.dominantFinish || sourceText, 300),
    observable_cues: observableCues,
    surface_mode: topology.mode || 'auto',
    seam_policy: topology.seam_policy || 'auto',
    finish_distribution: topology.finish_distribution || 'auto',
    generation_scope: topology.mode === 'continuous' || topology.seam_policy === 'hidden'
      ? 'one_dominant_coherent_finish'
      : (topology.finish_distribution === 'regional' ? 'task_mapped_regions' : 'task_defined'),
    validation_rule: referenceAvailable
      ? 'match_attached_reference_and_observable_task_cues'
      : 'judge_only_observable_cues_written_in_task',
  };
}

function normalizeMotionEffect(input = null) {
  const raw = typeof input === 'string' ? { type: input } : (input && typeof input === 'object' ? input : {});
  const effect = {
    type: enumValue(raw.type, MOTION_EFFECTS, 'none'),
    source_state: clean(raw.source_state || raw.sourceState || '', 500),
    target_state: clean(raw.target_state || raw.targetState || '', 500),
    timeline: clean(raw.timeline || '', 700),
    intensity: enumValue(raw.intensity, EFFECT_INTENSITIES, 'medium'),
    preserve_scene_geometry: raw.preserve_scene_geometry !== false && raw.preserveSceneGeometry !== false,
    reference_asset_id: clean(raw.reference_asset_id || raw.referenceAssetId || '', 180),
    notes: clean(raw.notes || raw.requirement || '', 500),
  };
  const meaningful = effect.type !== 'none'
    || effect.source_state
    || effect.target_state
    || effect.timeline
    || effect.reference_asset_id
    || effect.notes;
  return meaningful ? effect : undefined;
}

function normalizeShotDesign(shot = {}) {
  const scope = enumValue(shot.shot_scope || shot.shotScope, SHOT_SCOPES, 'auto');
  return {
    shot_scope: scope,
    surface_topology: normalizeSurfaceTopology(shot.surface_topology || shot.surfaceTopology),
    motion_effect: normalizeMotionEffect(shot.motion_effect || shot.motionEffect),
  };
}

function surfacePrompt(surface = null, shotScope = 'auto') {
  const topology = normalizeSurfaceTopology(surface);
  const scope = enumValue(shotScope, SHOT_SCOPES, 'auto');
  if (!topology && scope === 'auto') return '';
  const lines = [];
  if (scope !== 'auto') lines.push(`Shot scope: ${scope}.`);
  if (scope === 'product_comparison') {
    lines.push('This is an isolated product/sample comparison insert. Divisions between samples belong only to this insert and must not redefine the topology of the master environment used by other shots.');
  }
  if (topology?.mode === 'continuous') {
    lines.push('Surface topology lock: ONE monolithic uninterrupted visual plane. ZERO full-height/full-width boundaries, gaps, grooves, grids, sample zones or modules. Task construction nouns do not authorize segmentation.');
  } else if (topology?.mode === 'segmented') {
    lines.push('Surface topology lock: intentional segmented construction is required; make the segment logic physically coherent and task-specific.');
  } else if (topology?.mode === 'modular') {
    lines.push('Surface topology lock: a modular system is required; preserve its repeat logic and physical assembly details.');
  }
  if (topology?.seam_policy === 'hidden') lines.push('Seam policy: ZERO visible joints, including faint or recessive ones. Fully conceal assembly; no floor-to-ceiling or full-width line or tonal edge.');
  if (topology?.seam_policy === 'visible') lines.push('Seam policy: visible joints are intentional evidence and must follow the task-defined construction logic.');
  if (topology?.seam_policy === 'task_defined') lines.push('Seam policy: follow only seams explicitly required by this shot or its task references; do not add generic decorative divisions.');
  if (topology?.finish_distribution === 'uniform') lines.push('Finish distribution: one coherent dominant finish over the primary surface. Allow only boundary-free micro-variation; no blocks, bands, swatches or region edges.');
  if (topology?.finish_distribution === 'gradient') lines.push('Finish distribution: use one continuous gradient without turning it into separate swatches or sample blocks.');
  if (topology?.finish_distribution === 'regional') lines.push('Finish distribution: use regional variation only at the explicitly named task location. Blend the transition without a seam, border, groove, gap or full-span tonal division, and preserve one continuous construction topology.');
  if (topology?.finish_distribution === 'sample_comparison') lines.push('Finish distribution: show clearly distinguishable comparison samples as product evidence within this shot only.');
  if (topology?.notes) lines.push(`Task-specific surface note: ${topology.notes}`);
  return lines.join('\n');
}

function keyframeEffectPrompt(input = null) {
  const effect = normalizeMotionEffect(input);
  if (!effect) return '';
  const lines = [`Motion effect plan: ${effect.type}; intensity ${effect.intensity}.`];
  if (effect.type === 'particle_assembly') {
    lines.push('START KEYFRAME rule: the target is not yet fully formed; show the authored source particles/material and keep a clean target area for later convergence.');
  }
  if (effect.source_state) lines.push(`Effect source state visible in keyframe: ${effect.source_state}`);
  if (effect.target_state) lines.push(`Later animation target (do not prematurely complete it in the start keyframe): ${effect.target_state}`);
  if (effect.preserve_scene_geometry) lines.push('Preserve the locked scene geometry, surface topology, camera and lighting throughout the effect.');
  if (effect.reference_asset_id) lines.push(`Target reference asset: ${effect.reference_asset_id}; use it as the identity/shape target when available.`);
  if (effect.notes) lines.push(`Task-specific effect note: ${effect.notes}`);
  return lines.join('\n');
}

function motionEffectPrompt(input = null) {
  const effect = normalizeMotionEffect(input);
  if (!effect) return '';
  const lines = [`Within-shot motion effect: ${effect.type}; intensity ${effect.intensity}.`];
  if (effect.source_state) lines.push(`Start from: ${effect.source_state}`);
  if (effect.target_state) lines.push(`End at: ${effect.target_state}`);
  if (effect.timeline) lines.push(`Required effect timeline: ${effect.timeline}`);
  if (effect.type === 'particle_assembly') lines.push('Animate many physically plausible particles or grains flowing and converging into the authored target silhouette; the target must emerge progressively from the particles, then hold stable at the end. Do not substitute a simple opacity fade or dissolve.');
  if (effect.preserve_scene_geometry) lines.push('Do not bend, replace, segment or redesign the surrounding scene while the effect runs.');
  if (effect.reference_asset_id) lines.push(`Use target reference asset ${effect.reference_asset_id} as the exact assembly target when the asset is attached.`);
  if (effect.notes) lines.push(`Effect note: ${effect.notes}`);
  return lines.join('\n');
}

module.exports = {
  SHOT_SCOPES,
  SURFACE_MODES,
  SEAM_POLICIES,
  FINISH_DISTRIBUTIONS,
  MOTION_EFFECTS,
  EFFECT_INTENSITIES,
  structuredText,
  normalizeSurfaceTopology,
  hasContinuousSurfaceIntent,
  hasExplicitFinishRegionMapping,
  resolveSurfaceTopology,
  normalizeMaterialContract,
  normalizeMotionEffect,
  normalizeShotDesign,
  surfacePrompt,
  keyframeEffectPrompt,
  motionEffectPrompt,
};
