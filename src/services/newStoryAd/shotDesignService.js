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

function openValue(value, fallback = '') {
  const normalized = clean(value, 60).toLowerCase().replace(/[\s-]+/g, '_');
  // 开放字段允许任务创造新语义，但过滤无法成为稳定机器键的内容。
  return /^[a-z0-9_:\u4e00-\u9fff]+$/i.test(normalized) ? normalized : fallback;
}

// 下列值是旧任务兼容建议，不是 V2.0 的行业或场景白名单。
const SHOT_SCOPES = ['auto', 'environment', 'product_comparison', 'character', 'brand_endcard'];
const SURFACE_MODES = ['auto', 'continuous', 'segmented', 'modular'];
const SEAM_POLICIES = ['auto', 'hidden', 'visible', 'task_defined'];
const FINISH_DISTRIBUTIONS = ['auto', 'uniform', 'gradient', 'regional', 'sample_comparison'];
const SECONDARY_SURFACE_POLICIES = ['auto', 'forbidden', 'task_defined'];
const MOTION_EFFECTS = ['none', 'particle_assembly', 'fade', 'dissolve', 'material_flow', 'custom'];
const EFFECT_INTENSITIES = ['low', 'medium', 'high'];

function normalizeSurfaceTopology(input = null) {
  const raw = typeof input === 'string' ? { mode: input } : (input && typeof input === 'object' ? input : {});
  const topology = {
    mode: openValue(raw.mode, 'auto'),
    seam_policy: openValue(raw.seam_policy || raw.seamPolicy, 'auto'),
    finish_distribution: openValue(raw.finish_distribution || raw.finishDistribution, 'auto'),
    primary_surface_count: Number.isInteger(Number(raw.primary_surface_count ?? raw.primarySurfaceCount))
      ? Math.max(1, Math.min(12, Number(raw.primary_surface_count ?? raw.primarySurfaceCount)))
      : null,
    secondary_surface_policy: openValue(raw.secondary_surface_policy || raw.secondarySurfacePolicy, 'auto'),
    notes: clean(raw.notes || raw.requirement || '', 500),
  };
  const meaningful = topology.mode !== 'auto'
    || topology.seam_policy !== 'auto'
    || topology.finish_distribution !== 'auto'
    || topology.primary_surface_count !== null
    || topology.secondary_surface_policy !== 'auto'
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

/** Detect explicit geometry cardinality without treating it as a seamless-finish request. */
function hasSinglePrimarySurfaceIntent(value = '') {
  const text = structuredText(value, 3000);
  if (!text) return false;
  return /(?:仅|只|唯一|单独)?\s*(?:设置|保留|展示|使用|采用|需要|要|为|是|由)?\s*(?:一|1)\s*(?:面|堵)\s*(?:主|主体|主要|核心)?\s*(?:展示|背景|材料|材质|形象)?\s*墙(?:面)?|(?:一|1)\s*面(?:的)?面板|单(?:一|独)?\s*(?:主|主体|主要)?\s*(?:展示|背景|材料|材质)?\s*(?:墙|墙面|平面)|(?:only|exactly|single|one)\s+(?:primary\s+|main\s+|display\s+|feature\s+|material\s+)*(?:wall|plane|surface)\b/i.test(text);
}

/** A regional finish is valid only when the task maps it to a named place. */
function hasExplicitFinishRegionMapping(value = '') {
  const text = structuredText(value, 2400);
  if (!text) return false;
  const spatialToken = '(?:左侧|右侧|上部|下部|顶部|底部|中央|中心|入口侧|出口侧|内侧|外侧|前部|后部|left|right|upper|lower|top|bottom|centre|center|entrance|exit|inner|outer|front|rear)';
  const finishToken = '(?:材质|饰面|纹理|表面|涂层|色彩|颜色|material|finish|texture|surface|coating|colou?r)';
  return new RegExp(`${spatialToken}[^。；;]{0,48}${finishToken}|${finishToken}[^。；;]{0,48}(?:位于|设置于|应用于|限定于|mapped\\s+to|placed\\s+at|applied\\s+to)[^。；;]{0,48}${spatialToken}`, 'i').test(text);
}

/** Detect language that would make an image model physically divide a surface. */
function hasSegmentedSurfaceIntent(value = '') {
  const text = structuredText(value, 3000);
  if (!text) return false;
  return /拼接|拼板|板块|模块(?:化)?|网格(?:墙)?|样品墙|展示墙|分区(?:墙|饰面|表面)|不同(?:材质|质感|饰面|颜色|色彩|涂层|面料|车漆|样品)[^。；;]{0,30}(?:拼|组合|并列)|panel(?:led|s)?|tile(?:d|s)?|grid|modular|segmented|patchwork|visible\s+(?:joint|seam)|sample\s+(?:wall|grid|blocks?)|(?:different|multiple|contrasting)\s+(?:materials?|finishes?|textures?|colou?rs?|coatings?)[^.;]{0,40}(?:combin|splic|contrast|arrang|side\s+by\s+side)/i.test(text);
}

/** Resolve contradictory select values and free-text requirements before generation. */
function resolveSurfaceTopology(input = null, contextText = '') {
  const topology = normalizeSurfaceTopology(input);
  const notes = topology?.notes || '';
  const singlePrimary = topology?.primary_surface_count === 1 || hasSinglePrimarySurfaceIntent([contextText, notes]);
  const continuous = topology?.mode === 'continuous' || hasContinuousSurfaceIntent([contextText, notes]);
  const regionalMapped = hasExplicitFinishRegionMapping([contextText, notes]);
  const requestedDistribution = topology?.finish_distribution || 'auto';
  const finishDistribution = requestedDistribution === 'gradient'
    ? 'gradient'
    : (requestedDistribution === 'regional' && regionalMapped
      ? 'regional'
      : ((continuous || singlePrimary) ? 'uniform' : requestedDistribution));
  if (!continuous && !singlePrimary) return topology;
  return {
    mode: continuous ? 'continuous' : (topology?.mode || 'auto'),
    seam_policy: continuous ? 'hidden' : (topology?.seam_policy || 'auto'),
    finish_distribution: finishDistribution,
    primary_surface_count: singlePrimary ? 1 : (topology?.primary_surface_count ?? null),
    secondary_surface_policy: singlePrimary ? 'forbidden' : (topology?.secondary_surface_policy || 'auto'),
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
    primary_surface_count: topology.primary_surface_count ?? null,
    secondary_surface_policy: topology.secondary_surface_policy || 'auto',
    generation_scope: topology.primary_surface_count === 1
      ? 'one_primary_surface'
      : topology.mode === 'continuous' || topology.seam_policy === 'hidden'
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
    type: openValue(raw.type, 'none'),
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
  const scope = openValue(shot.shot_scope || shot.shotScope, 'auto');
  return {
    shot_scope: scope,
    surface_topology: normalizeSurfaceTopology(shot.surface_topology || shot.surfaceTopology),
    motion_effect: normalizeMotionEffect(shot.motion_effect || shot.motionEffect),
  };
}

/**
 * Compile the editable shot description and the bound scene contract into one
 * generation-time surface contract. The scene owns environment topology;
 * isolated product/sample comparison inserts may own their local topology.
 */
function compileShotDesign({ shot = {}, sceneSurface = null, sceneText = '' } = {}) {
  const normalized = normalizeShotDesign(shot);
  const shotText = structuredText([
    shot.visual,
    shot.content_prompt,
    shot.action,
    shot.visual_action,
    shot.keyframe_notes,
    shot.material_usage,
    normalized.surface_topology?.notes,
  ], 3000);
  const sceneContext = structuredText([sceneText, sceneSurface], 3000);
  const resolvedScene = resolveSurfaceTopology(sceneSurface, sceneContext);
  const sceneRequiresContinuity = resolvedScene?.mode === 'continuous'
    || resolvedScene?.seam_policy === 'hidden'
    || hasContinuousSurfaceIntent(sceneContext);
  const isolatedComparison = normalized.shot_scope === 'product_comparison';
  const shotRequestsSegmentation = ['segmented', 'modular'].includes(normalized.surface_topology?.mode)
    || normalized.surface_topology?.seam_policy === 'visible'
    || normalized.surface_topology?.finish_distribution === 'sample_comparison'
    || hasSegmentedSurfaceIntent(shotText);

  if (sceneRequiresContinuity && !isolatedComparison) {
    const effectiveSurface = resolveSurfaceTopology({
      ...(resolvedScene || {}),
      mode: 'continuous',
      seam_policy: 'hidden',
      notes: clean(resolvedScene?.notes || normalized.surface_topology?.notes || '', 500),
    }, sceneContext);
    return {
      ...normalized,
      surface_topology: effectiveSurface,
      surface_resolution: {
        authority: 'scene_contract',
        conflict: shotRequestsSegmentation,
        reason: shotRequestsSegmentation
          ? 'shot_segmentation_intent_reinterpreted_as_finish_variation'
          : 'scene_continuous_surface_inherited',
        ...(shotRequestsSegmentation ? { prompt_semantics_version: 2 } : {}),
      },
    };
  }

  const effectiveSurface = isolatedComparison
    ? (normalizeSurfaceTopology(normalized.surface_topology) || resolvedScene)
    : (resolveSurfaceTopology(normalized.surface_topology, shotText) || resolvedScene);
  return {
    ...normalized,
    surface_topology: effectiveSurface,
    surface_resolution: {
      authority: isolatedComparison && normalized.surface_topology ? 'isolated_shot_contract' : (normalized.surface_topology ? 'shot_contract' : (resolvedScene ? 'scene_contract' : 'none')),
      conflict: false,
      reason: isolatedComparison ? 'isolated_product_comparison_scope' : 'no_cross_contract_conflict',
    },
  };
}

function compileBoundShotDesign(shot = {}, sceneLock = null, sceneAsset = null) {
  return compileShotDesign({
    shot,
    sceneSurface: sceneLock?.spatial_contract?.surface_topology
      || sceneAsset?.scene_contract?.surface_topology
      || sceneAsset?.surface_topology
      || null,
    sceneText: [sceneLock?.layout_summary, sceneLock?.material_summary, sceneAsset?.layout_summary, sceneAsset?.material_summary],
  });
}

function surfaceConflictPrompt(resolution = null) {
  if (resolution?.conflict !== true) return '';
  return 'Surface conflict resolution (authoritative): interpret all combining, splicing or contrasting finishes only as boundary-free colour, reflectivity and microtexture variation on the SAME monolithic plane. They do not authorize panels, tiles, sample blocks, grids, zones or joints.';
}

function negativeSurfaceSentence(value = '') {
  return /(?:禁止|不得|不要|严禁|避免|不能|不可)[^。；;]{0,80}(?:拼接|拼板|板块|模块|网格|样品墙|展示墙|分区|接缝)|\b(?:no|never|forbid|avoid|without)\b[^.;]{0,100}(?:panel|tile|grid|module|segment|patchwork|sample|seam|joint)/i.test(value);
}

/**
 * Rewrite only the narrative rendering sent to image providers. The stored
 * storyboard remains untouched, but a scene-authoritative continuous surface
 * must never be described to the provider as physically segmented.
 */
function resolveSurfaceNarrative(value = '', resolution = null) {
  const source = clean(value, 3000);
  if (!source || resolution?.conflict !== true) return source;
  return source
    .split(/([。！？；;.!?])/)
    .map(segment => {
      if (!segment || /^[。！？；;.!?]$/.test(segment) || negativeSurfaceSentence(segment)) return segment;
      let next = segment;
      next = next.replace(
        /(?:等)?不同(?:材质|质感|饰面|颜色|色彩|涂层|面料|车漆|样品)[^。；;]{0,30}?(?:和谐|自然|无缝)?(?:拼接|组合|并列)(?:并列|组合)?(?:而成)?/g,
        '这些任务指定质感在同一连续基面上通过无边界的颜色、反射率和微纹理变化自然过渡',
      );
      next = next.replace(/(?:和谐|自然)?拼接(?:而成)?/g, '在同一连续基面上无边界自然过渡');
      next = next.replace(/(?:拼板|模块化板块|矩形拼板|网格分割|样品墙|展示墙|分区墙)/g, '同一连续基面上的微观纹理变化');
      next = next.replace(/不同区域/g, '同一连续基面上的不同观察位置');
      next = next.replace(
        /((?:材质|质感|饰面|颜色|色彩)[^。；;]{0,24}?)(?:组合|并列)(?:并列|组合)?/g,
        '$1在同一连续基面上无边界过渡呈现',
      );
      next = next.replace(
        /\b(?:(?:patchwork|panelled|paneled|tiled|modular|segmented|sample\s+(?:wall|grid|blocks?))(?:\s+(?:patchwork|panelled|paneled|tiled|modular|segmented))*)\b/gi,
        'boundary-free optical and microtexture variation across one continuous plane',
      );
      next = next.replace(
        /\b(?:different|multiple|contrasting)\s+(?:materials?|finishes?|textures?|colou?rs?|coatings?)(?:\s+(?:are|is|be|being|to\s+be))?\s+(?:combine|combining|combined|splice|splicing|spliced|contrast|contrasted|arrange|arranged)\b/gi,
        'task-supported finish qualities transition without boundaries across one continuous plane',
      );
      return next.replace(/呈现呈现/g, '呈现');
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function narrativeSegments(prompt = '') {
  const labels = /^(?:Campaign brief|Advertised subject|User-edited visual override|Visual|Action|Current shot action|Dialogue or copy|Composition|Subject lock|Commercial evidence|Style):/i;
  return String(prompt || '')
    .split(/\r?\n|\s+\|\s+/)
    .map(value => value.trim())
    .filter(value => labels.test(value));
}

function unresolvedSurfaceNarratives(prompt = '') {
  return narrativeSegments(prompt)
    .filter(value => !negativeSurfaceSentence(value))
    .filter(value => hasSegmentedSurfaceIntent(value));
}

function surfacePromptInvariantIssues(prompt = '', design = {}) {
  if (design?.surface_resolution?.conflict !== true) return [];
  const source = String(prompt || '');
  const issues = [];
  if (!/Surface conflict resolution \(authoritative\):/i.test(source)) issues.push('missing_surface_conflict_resolution');
  if (!/Surface topology lock: ONE monolithic uninterrupted visual plane/i.test(source)) issues.push('missing_continuous_surface_lock');
  if (!/Seam policy: ZERO visible joints/i.test(source)) issues.push('missing_hidden_seam_lock');
  const unresolved = unresolvedSurfaceNarratives(source);
  if (unresolved.length) issues.push('unresolved_segmented_surface_narrative');
  return issues;
}

function assertSurfacePromptConsistent(prompt = '', design = {}) {
  const issues = surfacePromptInvariantIssues(prompt, design);
  if (!issues.length) return prompt;
  const error = new Error(`关键帧提示词仍包含未消解的场景表面冲突：${issues.join(', ')}`);
  error.code = 'KEYFRAME_PROMPT_CONTRACT_CONFLICT';
  error.status = 422;
  error.retryable = false;
  error.details = { issues, unresolved_segments: unresolvedSurfaceNarratives(prompt).map(value => clean(value, 240)).slice(0, 4) };
  throw error;
}

function surfacePrompt(surface = null, shotScope = 'auto') {
  const topology = normalizeSurfaceTopology(surface);
  const scope = openValue(shotScope, 'auto');
  if (!topology && scope === 'auto') return '';
  const lines = [];
  if (scope !== 'auto') lines.push(`Shot scope: ${scope}.`);
  if (scope === 'product_comparison') {
    lines.push('This is an isolated product/sample comparison insert. Divisions between samples belong only to this insert and must not redefine the topology of the master environment used by other shots.');
  }
  if (topology?.primary_surface_count === 1) {
    lines.push('Geometry cardinality lock: EXACTLY ONE prominent task-material display/background plane. Do not create a second feature wall, repeated wall bay, partition, projecting return, niche, alcove, pilaster, column or freestanding panel carrying the task material.');
    lines.push('Ordinary room boundaries may exist only as visually recessive context; they must not read as additional task-material display surfaces.');
  }
  if (topology?.secondary_surface_policy === 'forbidden') {
    lines.push('Secondary surface policy: FORBIDDEN. Do not duplicate, wrap, mirror or continue the authored feature surface onto side planes or columns.');
  }
  if (topology?.mode === 'continuous') {
    lines.push('Surface topology lock: ONE monolithic uninterrupted visual plane; ZERO full-height/full-width boundaries, gaps, grooves, grids, sample zones, panels or modules.');
  } else if (topology?.mode === 'segmented') {
    lines.push('Surface topology lock: intentional segmented construction is required; make the segment logic physically coherent and task-specific.');
  } else if (topology?.mode === 'modular') {
    lines.push('Surface topology lock: a modular system is required; preserve its repeat logic and physical assembly details.');
  }
  if (topology?.seam_policy === 'hidden') lines.push('Seam policy: ZERO visible joints or sustained dividing edges; conceal all assembly.');
  if (topology?.seam_policy === 'visible') lines.push('Seam policy: visible joints are intentional evidence and must follow the task-defined construction logic.');
  if (topology?.seam_policy === 'task_defined') lines.push('Seam policy: follow only seams explicitly required by this shot or its task references; do not add generic decorative divisions.');
  if (topology?.finish_distribution === 'uniform') lines.push('Finish distribution: one coherent dominant finish over the primary surface with boundary-free micro-variation; no blocks, bands, swatches or region edges.');
  if (topology?.finish_distribution === 'gradient') lines.push('Finish distribution: use one continuous gradient without turning it into separate swatches or sample blocks.');
  if (topology?.finish_distribution === 'regional') lines.push('Finish distribution: use regional variation only at the explicitly named task location. Blend the transition without a seam, border, groove, gap or full-span tonal division, and preserve one continuous construction topology.');
  if (topology?.finish_distribution === 'sample_comparison') lines.push('Finish distribution: show clearly distinguishable comparison samples as product evidence within this shot only.');
  if (topology?.mode && !SURFACE_MODES.includes(topology.mode)) lines.push(`Task-authored surface mode: ${topology.mode}; interpret it only through this task's evidence and notes.`);
  if (topology?.seam_policy && !SEAM_POLICIES.includes(topology.seam_policy)) lines.push(`Task-authored seam policy: ${topology.seam_policy}; do not replace it with a generic industry convention.`);
  if (topology?.finish_distribution && !FINISH_DISTRIBUTIONS.includes(topology.finish_distribution)) lines.push(`Task-authored finish distribution: ${topology.finish_distribution}; preserve the current task's explicit spatial mapping.`);
  if (topology?.notes) lines.push(`Task-specific surface note: ${clean(topology.notes, 240)}`);
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
  SECONDARY_SURFACE_POLICIES,
  MOTION_EFFECTS,
  EFFECT_INTENSITIES,
  structuredText,
  normalizeSurfaceTopology,
  hasContinuousSurfaceIntent,
  hasSinglePrimarySurfaceIntent,
  hasSegmentedSurfaceIntent,
  hasExplicitFinishRegionMapping,
  resolveSurfaceTopology,
  normalizeMaterialContract,
  normalizeMotionEffect,
  normalizeShotDesign,
  compileShotDesign,
  compileBoundShotDesign,
  surfacePrompt,
  surfaceConflictPrompt,
  resolveSurfaceNarrative,
  unresolvedSurfaceNarratives,
  surfacePromptInvariantIssues,
  assertSurfacePromptConsistent,
  keyframeEffectPrompt,
  motionEffectPrompt,
};
