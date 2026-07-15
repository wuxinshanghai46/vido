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
    lines.push('Surface topology lock: depict the specified primary surface as one continuous, uninterrupted construction plane, not as repeated modules or a multi-panel decorative grid.');
  } else if (topology?.mode === 'segmented') {
    lines.push('Surface topology lock: intentional segmented construction is required; make the segment logic physically coherent and task-specific.');
  } else if (topology?.mode === 'modular') {
    lines.push('Surface topology lock: a modular system is required; preserve its repeat logic and physical assembly details.');
  }
  if (topology?.seam_policy === 'hidden') lines.push('Seam policy: hide construction joints and edge closures from the visible composition; do not invent evenly spaced vertical or horizontal divisions.');
  if (topology?.seam_policy === 'visible') lines.push('Seam policy: visible joints are intentional evidence and must follow the task-defined construction logic.');
  if (topology?.seam_policy === 'task_defined') lines.push('Seam policy: follow only seams explicitly required by this shot or its task references; do not add generic decorative divisions.');
  if (topology?.finish_distribution === 'uniform') lines.push('Finish distribution: keep one coherent finish across the visible primary surface.');
  if (topology?.finish_distribution === 'gradient') lines.push('Finish distribution: use one continuous gradient without turning it into separate panels or sample blocks.');
  if (topology?.finish_distribution === 'regional') lines.push('Finish distribution: regional variation is allowed only where the shot explicitly places it; preserve the underlying continuous construction topology.');
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
  normalizeMotionEffect,
  normalizeShotDesign,
  surfacePrompt,
  keyframeEffectPrompt,
  motionEffectPrompt,
};
