const crypto = require('crypto');
const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const { cleanText } = require('./contextBuilder');
const verification = require('./visualVerificationService');
const personIdentity = require('./personIdentityContractService');

const VIEW_KEYS = ['master', 'reverse', 'interaction', 'detail'];
const REFERENCE_VIEW_KEYS = [...VIEW_KEYS, 'layout'];
const VIEW_ISSUE_CODES = new Set([
  'ROOT_SCENE_IDENTITY_INVALID',
  'ROOT_GEOMETRY_INVALID',
  'ROOT_MATERIAL_IDENTITY_INVALID',
  'LAYOUT_ROLE_INVALID',
  'LAYOUT_TOPOLOGY_INCOMPLETE',
  'REVERSE_COVERAGE_LOW',
  'INTERACTION_ZONE_MISSING',
  'CAMERA_DIVERSITY_LOW',
  'MATERIAL_DETAIL_WEAK',
  'MATERIAL_APPEARANCE_MISMATCH',
  'SURFACE_TOPOLOGY_INVALID',
  'NEGATIVE_VIOLATION',
  'PHOTOREALISM_INVALID',
  'CROSS_VIEW_DRIFT',
]);

function safeJson(raw = '') {
  const text = jsonRepair.stripMarkdown(raw);
  let parseError = null;
  try { return jsonRepair.parseJson(text, 'object'); } catch (error) { parseError = error; }
  // Some vision providers truncate verbose optional topology arrays even when
  // the three required QA gates at the start are complete. Salvage that valid
  // decision prefix locally instead of paying for another vision call or
  // discarding the generated images. normalizeContract reconstructs cameras
  // from the five authoritative view URLs when optional details are absent.
  const optionalStart = text.search(/,\s*"(?:anchors|zones|geometry_facts|materials|lighting|cameras)"\s*:/i);
  const objectStart = text.indexOf('{');
  if (objectStart >= 0 && optionalStart > objectStart) {
    const decisionPrefix = `${text.slice(objectStart, optionalStart).replace(/,\s*$/, '')}\n}`;
    try { return jsonRepair.parseJson(decisionPrefix, 'object'); } catch (error) { parseError = error; }
  }
  const error = new Error('视觉模型未返回有效 JSON');
  error.code = 'VISION_QA_SCHEMA_INVALID';
  error.retryable = true;
  error.parse_error = cleanText(parseError?.message || '', 240);
  throw error;
}

function stableId(prefix, value, index) {
  const normalized = cleanText(value, 80).toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '_')
    .replace(/^_+|_+$/g, '').slice(0, 48);
  return prefix + '_' + (normalized || index + 1);
}

function stringList(input, max = 24, itemMax = 240) {
  return (Array.isArray(input) ? input : [])
    .map(value => cleanText(typeof value === 'string' ? value : (value?.text || value?.description || value?.label || ''), itemMax))
    .filter(Boolean).slice(0, max);
}

function normalizeAnchors(input = []) {
  return (Array.isArray(input) ? input : []).map((item, index) => {
    const source = typeof item === 'string' ? { label: item } : (item || {});
    const label = cleanText(source.label || source.name || source.description || 'anchor ' + (index + 1), 120);
    return {
      id: cleanText(source.id || stableId('anchor', label, index), 100),
      label,
      kind: cleanText(source.kind || source.type || 'spatial_feature', 80),
      description: cleanText(source.description || source.visual || label, 300),
      relative_position: cleanText(source.relative_position || source.position || source.relation || '', 240),
      required: source.required !== false,
      visible_in_views: (Array.isArray(source.visible_in_views) ? source.visible_in_views : REFERENCE_VIEW_KEYS)
        .map(value => cleanText(value, 40)).filter(value => REFERENCE_VIEW_KEYS.includes(value)),
    };
  }).filter(item => item.label).slice(0, 24);
}

function normalizeZones(input = []) {
  return (Array.isArray(input) ? input : []).map((item, index) => {
    const source = typeof item === 'string' ? { label: item } : (item || {});
    const label = cleanText(source.label || source.name || source.purpose || 'zone ' + (index + 1), 120);
    const labelZh = cleanText(source.label_zh || source.labelZh || (/[㐀-鿿]/.test(label) ? label : ''), 120);
    const box = Array.isArray(source.normalized_box) ? source.normalized_box.map(Number).slice(0, 4) : [];
    return {
      id: cleanText(source.id || stableId('zone', label, index), 100),
      label,
      label_zh: labelZh,
      purpose: cleanText(source.purpose || source.description || label, 300),
      tags: stringList(source.tags || source.allowed_actions || [], 12, 80),
      normalized_box: box.length === 4 && box.every(Number.isFinite)
        ? box.map(value => Math.max(0, Math.min(1, value))) : [],
      visible_in_views: (Array.isArray(source.visible_in_views) ? source.visible_in_views : REFERENCE_VIEW_KEYS)
        .map(value => cleanText(value, 40)).filter(value => REFERENCE_VIEW_KEYS.includes(value)),
    };
  }).filter(item => item.label).slice(0, 24);
}

function normalizeCameras(input = [], views = []) {
  const list = Array.isArray(input) ? input : [];
  return VIEW_KEYS.map((key, index) => {
    const source = list.find(item => cleanText(item?.view_id || item?.key || '', 40) === key) || {};
    const view = (Array.isArray(views) ? views : []).find(item => cleanText(item?.key || item?.view || '', 40) === key) || views[index] || {};
    return {
      id: cleanText(source.id || 'camera_' + key, 100),
      view_id: key,
      label: cleanText(source.label || view.label || key, 100),
      reference_image_url: cleanText(view.url || view.image_url || source.reference_image_url || '', 1000),
      framing: cleanText(source.framing || '', 120),
      lens_class: cleanText(source.lens_class || source.lens || '', 80),
      orientation: cleanText(source.orientation || source.camera_direction || '', 160),
      allowed_zone_ids: stringList(source.allowed_zone_ids || [], 24, 100),
    };
  });
}

function score(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function qaContainers(input = {}) {
  return [
    input,
    input.cross_view_qa,
    input.requirement_qa,
    input.spatial_coverage_qa,
    input.scores,
    input.quality_dimensions,
    input.metrics,
  ].filter(Boolean);
}

function normalizeViewIssues(input = [], requested = {}) {
  const materialEvidenceMode = cleanText(requested.material_contract?.evidence_mode || '', 40);
  return (Array.isArray(input) ? input : []).map(item => {
    const source = item && typeof item === 'object' ? item : {};
    let code = cleanText(source.code || source.issue_code || '', 80).toUpperCase();
    let viewKeys = (Array.isArray(source.view_keys) ? source.view_keys : [source.view_key])
      .map(value => cleanText(value, 40)).filter(value => REFERENCE_VIEW_KEYS.includes(value));
    const evidence = cleanText(source.evidence || source.visual_evidence || '', 300);
    if (!VIEW_ISSUE_CODES.has(code) || !viewKeys.length || !evidence) return null;
    if (code === 'ROOT_MATERIAL_IDENTITY_INVALID' && materialEvidenceMode !== 'reference_exact') {
      code = 'MATERIAL_DETAIL_WEAK';
      viewKeys = ['detail'];
    }
    return {
      code,
      view_keys: [...new Set(viewKeys)],
      reason: cleanText(source.reason || source.message || code, 300),
      evidence,
      confidence: Math.max(0, Math.min(1, Number(source.confidence ?? 1) || 0)),
    };
  }).filter(item => item && item.confidence >= 0.6).slice(0, 12);
}

function firstScore(input = {}, keys = []) {
  const containers = qaContainers(input);
  for (const container of containers) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(container, key) && Number.isFinite(Number(container[key]))) {
        return Number(container[key]);
      }
    }
  }
  return 0;
}

function hasRequiredScores(input = {}, fields = []) {
  const containers = qaContainers(input);
  return fields.every(aliases => containers.some(container => aliases.some(key =>
    Object.prototype.hasOwnProperty.call(container, key) && Number.isFinite(Number(container[key]))
  )));
}

function normalizeRequestedTopology(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    mode: cleanText(source.mode || 'auto', 40),
    seam_policy: cleanText(source.seam_policy || source.seamPolicy || 'auto', 40),
    finish_distribution: cleanText(source.finish_distribution || source.finishDistribution || 'auto', 60),
    notes: cleanText(source.notes || '', 500),
  };
}

function normalizeRequirementQa(input = {}) {
  const reasons = stringList(input.mismatch_reasons || input.requirement_mismatch_reasons || [], 20, 300);
  const qa = {
    pass: false,
    layout_match_score: score(firstScore(input, ['layout_match_score', 'layout_fidelity_score', 'layout_match'])),
    material_light_match_score: score(firstScore(input, ['material_light_match_score', 'material_requirement_score', 'material_light_match'])),
    interaction_match_score: score(firstScore(input, ['interaction_match_score', 'interaction_space_score', 'interaction_match'])),
    surface_topology_match_score: score(firstScore(input, ['surface_topology_match_score', 'topology_match_score', 'surface_topology_match'])),
    negative_compliance_score: score(firstScore(input, ['negative_compliance_score', 'forbidden_compliance_score', 'negative_compliance'])),
    mismatch_reasons: reasons,
  };
  qa.pass = input.pass === true
    && qa.layout_match_score >= 0.75
    && qa.material_light_match_score >= 0.75
    && qa.interaction_match_score >= 0.7
    && qa.surface_topology_match_score >= 0.8
    && qa.negative_compliance_score >= 0.9
    && reasons.length === 0;
  return qa;
}

function buildLayoutContract(input = {}, options = {}) {
  const layoutView = (options.views || []).find(view => cleanText(view?.key || view?.view || '', 40) === 'layout');
  return {
    required: options.layoutRequired === true || !!layoutView,
    status: layoutView ? 'available' : (options.layoutRequired === true ? 'missing' : 'not_required'),
    mode: layoutView ? 'topdown_or_axonometric_reference' : 'topology_contract',
    reference_image_url: cleanText(layoutView?.url || layoutView?.image_url || '', 1000),
    zones: normalizeZones(input.zones || input.spatial_zones || []),
    anchors: normalizeAnchors(input.anchors || input.spatial_anchors || []),
    camera_path: stringList(input.camera_path || input.camera_paths || [], 16, 240),
  };
}

function referenceViewMap(input = {}, options = {}) {
  const result = {};
  const add = (key, url, source = '') => {
    const normalizedKey = cleanText(key, 40);
    const normalizedUrl = cleanText(url, 1000);
    if (!REFERENCE_VIEW_KEYS.includes(normalizedKey) || !normalizedUrl || result[normalizedKey]) return;
    result[normalizedKey] = { key: normalizedKey, url: normalizedUrl, source };
  };
  (Array.isArray(options.views) ? options.views : []).forEach(view => {
    add(view?.key || view?.view, view?.url || view?.image_url, 'views');
  });
  (Array.isArray(input.cameras) ? input.cameras : []).forEach(camera => {
    add(camera?.view_id || camera?.key, camera?.reference_image_url || camera?.url || camera?.image_url, 'cameras');
  });
  add('layout', input.layout_contract?.reference_image_url, 'layout_contract');
  return result;
}

function normalizeSpatialCoverageQa(input = {}, options = {}) {
  const explicit = input.spatial_coverage_qa && typeof input.spatial_coverage_qa === 'object';
  const source = explicit ? input.spatial_coverage_qa : {};
  const evidence = referenceViewMap(input, options);
  const masterUrl = evidence.master?.url || '';
  const reverseUrl = evidence.reverse?.url || '';
  const interactionUrl = evidence.interaction?.url || '';
  const hasLayout = !!evidence.layout?.url;
  const hasReverse = !!reverseUrl && !!masterUrl && reverseUrl !== masterUrl;
  const hasInteraction = !!interactionUrl && !!masterUrl
    && interactionUrl !== masterUrl && interactionUrl !== reverseUrl;
  const reasons = stringList(source.reasons || source.mismatch_reasons || [], 20, 300);
  const appendReason = reason => {
    if (reason && !reasons.includes(reason)) reasons.push(reason);
  };

  if (!explicit) {
    return {
      pass: false,
      layout_topology_score: null,
      camera_diversity_score: null,
      reverse_coverage_score: null,
      interaction_zone_score: null,
      coverage_status: 'legacy_partial',
      assessment_source: 'legacy_contract',
      legacy: true,
      full_space_lock: false,
      reasons: ['历史场景合同缺少独立空间覆盖验证，不能视为完整空间锁定'],
      mismatch_reasons: ['历史场景合同缺少独立空间覆盖验证，不能视为完整空间锁定'],
    };
  }

  const qa = {
    pass: false,
    layout_topology_score: score(firstScore(source, ['layout_topology_score', 'layout_coverage_score', 'topology_coverage_score'])),
    camera_diversity_score: score(firstScore(source, ['camera_diversity_score', 'view_diversity_score', 'camera_coverage_score'])),
    reverse_coverage_score: score(firstScore(source, ['reverse_coverage_score', 'reverse_view_score', 'reverse_spatial_score'])),
    interaction_zone_score: score(firstScore(source, ['interaction_zone_score', 'interaction_coverage_score', 'interaction_spatial_score'])),
    coverage_status: 'partial',
    assessment_source: 'vision_v3',
    legacy: false,
    full_space_lock: false,
    reasons,
  };
  if (!hasLayout) appendReason('缺少俯视或轴测布局参考，无法验证完整空间拓扑');
  if (!hasReverse) appendReason('缺少与主视角明确不同的反向或侧向参考，无法验证背向空间');
  if (!hasInteraction) appendReason('缺少独立互动位参考，无法验证人物活动区域和动线');
  if (qa.layout_topology_score < 0.8) appendReason('空间布局拓扑覆盖不足');
  if (qa.camera_diversity_score < 0.75) appendReason('参考机位差异不足，不能证明未展示区域');
  if (qa.reverse_coverage_score < 0.75) appendReason('反向或侧向空间覆盖不足');
  if (qa.interaction_zone_score < 0.7) appendReason('互动区域与动线覆盖不足');
  qa.pass = source.pass === true
    && hasLayout && hasReverse && hasInteraction
    && qa.layout_topology_score >= 0.8
    && qa.camera_diversity_score >= 0.75
    && qa.reverse_coverage_score >= 0.75
    && qa.interaction_zone_score >= 0.7
    && reasons.length === 0;
  qa.coverage_status = qa.pass ? 'complete' : 'partial';
  qa.full_space_lock = qa.pass;
  qa.mismatch_reasons = [...qa.reasons];
  return qa;
}

function normalizeContract(input = {}, options = {}) {
  const requestedInput = options.requested || {};
  const requested = {
    ...requestedInput,
    material_contract: requestedInput.material_contract || input.requested_material_contract || {},
    interaction_contract: requestedInput.interaction_contract || input.requested_interaction_contract || {},
  };
  const views = options.views || [];
  const sourceQa = input.cross_view_qa && typeof input.cross_view_qa === 'object' ? input.cross_view_qa : input;
  const hasExplicitRequirementQa = input.requirement_qa && typeof input.requirement_qa === 'object';
  const sourceRequirementQa = hasExplicitRequirementQa ? input.requirement_qa : input;
  const contract = {
    schema_version: 4,
    source_schema_version: Math.max(1, Number(input.schema_version || (input.view_issues ? 4 : (input.spatial_coverage_qa ? 3 : 2))) || 1),
    scene_id: cleanText(options.sceneId || input.scene_id, 120),
    scene_revision: Math.max(1, Number(options.revision || input.scene_revision || 1) || 1),
    status: cleanText(input.status || 'verified', 40),
    requested_layout: cleanText(requested.layout || input.requested_layout || '', 1000),
    requested_material_light: cleanText(requested.material_light || input.requested_material_light || '', 1000),
    requested_interaction: cleanText(requested.interaction || input.requested_interaction || '', 800),
    requested_style: cleanText(requested.style || input.requested_style || '', 800),
    requested_negative: cleanText(requested.negative || input.requested_negative || '', 1000),
    requested_surface_topology: normalizeRequestedTopology(requested.surface_topology || input.requested_surface_topology || {}),
    requested_material_contract: requested.material_contract || input.requested_material_contract || {},
    requested_interaction_contract: requested.interaction_contract || input.requested_interaction_contract || {},
    observed_summary: cleanText(input.observed_summary || input.summary || '', 1200),
    anchors: normalizeAnchors(input.anchors || input.spatial_anchors || []),
    zones: normalizeZones(input.zones || input.spatial_zones || []),
    geometry_facts: stringList(input.geometry_facts || input.geometry || [], 30, 320),
    materials: stringList(input.materials || input.material_palette || [], 24, 220),
    lighting: input.lighting && typeof input.lighting === 'object' ? {
      direction: cleanText(input.lighting.direction || '', 180),
      color_temperature: cleanText(input.lighting.color_temperature || input.lighting.temperature || '', 100),
      fixtures: stringList(input.lighting.fixtures || [], 16, 160),
      notes: cleanText(input.lighting.notes || '', 300),
    } : {},
    cameras: normalizeCameras(input.cameras || [], views),
    view_issues: normalizeViewIssues(input.view_issues || input.viewIssues || [], requested),
    cross_view_qa: {
      pass: sourceQa.pass === true,
      scene_consistency_score: score(firstScore(sourceQa, ['scene_consistency_score', 'scene_continuity', 'scene_consistency'])),
      geometry_consistency_score: score(firstScore(sourceQa, ['geometry_consistency_score', 'anchor_consistency_score', 'spatial_consistency', 'geometry_consistency'])),
      material_consistency_score: score(firstScore(sourceQa, ['material_consistency_score', 'material_match_score', 'material_fidelity', 'material_consistency'])),
      mismatch_reasons: stringList(sourceQa.mismatch_reasons || [], 20, 300),
    },
    requirement_qa: hasExplicitRequirementQa
      ? normalizeRequirementQa(sourceRequirementQa)
      : (input.status === 'verified' && sourceQa.pass === true
        ? {
          pass: true,
          layout_match_score: 1,
          material_light_match_score: 1,
          interaction_match_score: 1,
          surface_topology_match_score: 1,
          negative_compliance_score: 1,
          mismatch_reasons: [],
          legacy_assumed: true,
        }
        : normalizeRequirementQa(sourceRequirementQa)),
    verified_at: new Date().toISOString(),
  };
  const qa = contract.cross_view_qa;
  qa.pass = sourceQa.pass === true && qa.scene_consistency_score >= 0.72
    && qa.geometry_consistency_score >= 0.68 && qa.material_consistency_score >= 0.72;
  const unavailable = input.qa_unavailable === true || input.verification?.state === 'unavailable';
  contract.layout_contract = buildLayoutContract(input, {
    views,
    layoutRequired: options.layoutRequired === true || input.layout_contract?.required === true,
  });
  contract.spatial_coverage_qa = normalizeSpatialCoverageQa(input, { views });
  contract.compatibility_status = contract.spatial_coverage_qa.legacy ? 'legacy_partial' : 'current';
  // `status` remains the appearance/requirement compatibility gate for older
  // callers. A production-usable complete space lock must additionally check
  // `full_space_lock` / `spatial_coverage_qa.pass` (schema v4).
  const noActionableIssues = contract.view_issues.length === 0;
  contract.status = unavailable ? 'unverified' : (qa.pass && contract.requirement_qa.pass && noActionableIssues ? 'verified' : 'rejected');
  contract.full_space_lock = contract.schema_version >= 3
    && contract.status === 'verified'
    && contract.requirement_qa.pass === true
    && qa.pass === true
    && contract.spatial_coverage_qa.pass === true
    && contract.layout_contract.status === 'available'
    && noActionableIssues;
  contract.space_lock_status = contract.full_space_lock
    ? 'complete'
    : (contract.spatial_coverage_qa.legacy
      ? 'legacy_partial'
      : (unavailable
        ? 'unavailable'
        : (qa.pass && contract.requirement_qa.pass
          ? contract.spatial_coverage_qa.coverage_status
          : 'rejected')));
  if (unavailable) {
    contract.qa_unavailable = true;
    contract.qa_error_code = cleanText(input.qa_error_code || input.verification?.code || 'VISION_QA_UNAVAILABLE', 80);
    contract.qa_error = cleanText(input.qa_error || input.verification?.message || '', 500);
    contract.view_issues = [];
    // Unknown is not a zero score. Keep every QA gate nullable so the UI shows
    // "pending verification" instead of presenting an infrastructure failure
    // as a content rejection after the asset is normalized and saved again.
    contract.cross_view_qa = {
      pass: null,
      scene_consistency_score: null,
      geometry_consistency_score: null,
      material_consistency_score: null,
      mismatch_reasons: [],
    };
    contract.requirement_qa = {
      pass: null,
      layout_match_score: null,
      material_light_match_score: null,
      interaction_match_score: null,
      surface_topology_match_score: null,
      negative_compliance_score: null,
      mismatch_reasons: [],
    };
    contract.spatial_coverage_qa = {
      pass: null,
      layout_topology_score: null,
      camera_diversity_score: null,
      reverse_coverage_score: null,
      interaction_zone_score: null,
      coverage_status: 'unavailable',
      assessment_source: 'unavailable',
      legacy: false,
      full_space_lock: false,
      reasons: [],
      mismatch_reasons: [],
    };
  }
  contract.reference_fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    scene_id: contract.scene_id,
    scene_revision: contract.scene_revision,
    requested_layout: contract.requested_layout,
    requested_material_light: contract.requested_material_light,
    requested_interaction: contract.requested_interaction,
    requested_style: contract.requested_style,
    requested_negative: contract.requested_negative,
    requested_surface_topology: contract.requested_surface_topology,
    requested_material_contract: contract.requested_material_contract,
    requested_interaction_contract: contract.requested_interaction_contract,
    view_issues: contract.view_issues,
    cameras: contract.cameras.map(camera => ({ view_id: camera.view_id, reference_image_url: camera.reference_image_url })),
    layout_reference_image_url: contract.layout_contract.reference_image_url,
    spatial_coverage_schema: contract.schema_version,
  })).digest('hex');
  contract.verification = unavailable
    ? (input.verification || verification.unavailable({ code: contract.qa_error_code, message: contract.qa_error }))
    : (qa.pass && contract.requirement_qa.pass && contract.spatial_coverage_qa.pass
      ? verification.verified(input.vision_model || '')
      : verification.rejected(
        [...contract.view_issues.map(issue => issue.reason), ...contract.requirement_qa.mismatch_reasons, ...qa.mismatch_reasons, ...contract.spatial_coverage_qa.reasons],
        contract.requirement_qa.pass && qa.pass
          ? '场景视角覆盖不足，尚未形成完整空间锁定'
          : (contract.requirement_qa.pass ? '场景空间、结构或材质一致性未通过' : '场景未满足当前任务的布局、材质、表面结构或禁止项要求'),
      ));
  return contract;
}

function buildUnverifiedContract(options = {}, error = null) {
  const contract = normalizeContract({ status: 'unverified' }, options);
  contract.status = 'unverified';
  contract.qa_unavailable = true;
  contract.qa_error_code = cleanText(error?.code || 'VISION_QA_UNAVAILABLE', 80);
  contract.qa_error = cleanText(error?.message || '视觉验收暂不可用', 500);
  contract.verification = verification.unavailable(error || { code: contract.qa_error_code, message: contract.qa_error });
  contract.vision_model = '';
  contract.view_issues = [];
  contract.cross_view_qa = {
    pass: null,
    scene_consistency_score: null,
    geometry_consistency_score: null,
    material_consistency_score: null,
    mismatch_reasons: [],
  };
  contract.requirement_qa = {
    pass: null,
    layout_match_score: null,
    material_light_match_score: null,
    interaction_match_score: null,
    surface_topology_match_score: null,
    negative_compliance_score: null,
    mismatch_reasons: [],
  };
  contract.spatial_coverage_qa = {
    pass: null,
    layout_topology_score: null,
    camera_diversity_score: null,
    reverse_coverage_score: null,
    interaction_zone_score: null,
    coverage_status: 'unavailable',
    assessment_source: 'unavailable',
    legacy: false,
    full_space_lock: false,
    reasons: [],
    mismatch_reasons: [],
  };
  contract.space_lock_status = 'unavailable';
  contract.full_space_lock = false;
  return contract;
}

async function analyzeSceneViews(options = {}) {
  const requested = options.requested || {};
  const views = options.views || [];
  const request = {
    taskId: options.taskId || '',
    stage: 'new_story_ad.scene_vision',
    systemPrompt: [
      'You are a strict scene continuity and spatial-geometry inspector for a general-purpose commercial video system.',
      'Analyze only the supplied images and current request. Never assume a fixed industry, location, person or object.',
      'Evaluate three independent gates: requirement fidelity, cross-view visual consistency, and spatial/view coverage completeness.',
      'Return JSON only. Images are ordered master, reverse/side, interaction position, detail, with an optional fifth top-down/axonometric layout reference.',
    ].join('\n'),
    userPrompt: 'Requested scene constraints: ' + JSON.stringify(requested) + '\n'
      + 'First verify that the generated scene obeys the requested layout, material/light, visual style or photographic medium, interaction space, surface topology/seam policy and negative requirements. Then verify all views belong to one physically coherent scene. '
      + 'The optional fifth layout image is a master-derived high-oblique photograph of the same finished location. Use it primarily for topology, coordinates, access points and anchor placement, but also reject it when it depicts an unrelated location, anchor system, material identity or lighting design. '
      + 'For all five views, material identity and surface topology are independent: visual continuity or hidden seams must never justify replacing the requested material with a nearby generic finish. '
      + 'Use requested.material_reference_available as the evidence flag. When it is not true, do not fail solely because a proprietary, trade or unfamiliar finish name cannot be visually proven from memory; evaluate only the observable colour, grain, reflectance, roughness, directionality, patina, translucency or micro-relief cues explicitly stated in material_light. '
      + 'For continuous hidden-seam surfaces, distinguish illumination from construction: a smooth reflection or lighting gradient is not a seam by itself. Count a seam only when there is a coherent geometric edge, gap, groove, recess or sustained boundary that visibly divides the primary plane; a full-height or full-width dividing line is valid failure evidence. '
      + 'When the requested medium is real photography, cinematic realism or an on-location commercial shoot, fail requirement_qa if the images visibly read as architectural visualization, CGI, a dollhouse/floor-plan render, a sterile virtual showroom or a material catalogue render. '
      + 'Return one JSON object with: pass boolean; status string; observed_summary string; '
      + 'requirement_qa object containing pass, layout_match_score, material_light_match_score, interaction_match_score, surface_topology_match_score, negative_compliance_score and mismatch_reasons; '
      + 'cross_view_qa object containing pass, scene_consistency_score, geometry_consistency_score, material_consistency_score and mismatch_reasons. Every score is a REQUIRED EVALUATED number from 0 to 1. '
      + 'spatial_coverage_qa object containing pass, layout_topology_score, camera_diversity_score, reverse_coverage_score, interaction_zone_score and reasons. Every score is a REQUIRED EVALUATED number from 0 to 1. '
      + 'view_issues is a REQUIRED array. Every failed gate must add at least one object with code, exact view_keys, concise reason, visible evidence and confidence. Free-text reasons are display-only and must never be used to decide paid regeneration. '
      + 'Allowed codes: ROOT_SCENE_IDENTITY_INVALID, ROOT_GEOMETRY_INVALID, ROOT_MATERIAL_IDENTITY_INVALID, LAYOUT_ROLE_INVALID, LAYOUT_TOPOLOGY_INCOMPLETE, REVERSE_COVERAGE_LOW, INTERACTION_ZONE_MISSING, CAMERA_DIVERSITY_LOW, MATERIAL_DETAIL_WEAK, MATERIAL_APPEARANCE_MISMATCH, SURFACE_TOPOLOGY_INVALID, NEGATIVE_VIOLATION, PHOTOREALISM_INVALID, CROSS_VIEW_DRIFT. Allowed view keys: master, reverse, interaction, detail, layout. '
      + 'Use a ROOT code only when the canonical master scene itself is unusable and all derived views must change. Otherwise identify only the failing view. Without an attached material reference, a proprietary name is still a generation target but never sufficient evidence for ROOT_MATERIAL_IDENTITY_INVALID; judge only observable cues and use MATERIAL_DETAIL_WEAK on detail when evidence is insufficient. '
      + 'The interaction image depicts an empty scene: require empty clearance, a reachable target and an access route; never require a visible person. '
      + 'Overall pass may be true only when requirement_qa.pass, cross_view_qa.pass and spatial_coverage_qa.pass are all true. Use concise Simplified Chinese for every mismatch reason. '
      + 'anchors object array with id, label, kind, description, relative_position, required and visible_in_views; '
      + 'zones object array with id, label, label_zh, purpose, tags, normalized_box and visible_in_views; '
      + 'Every zone label_zh is required and must be a concise Simplified Chinese display name. Keep id stable and language-neutral; never derive or replace id during translation. '
      + 'geometry_facts string array; materials string array; lighting object; cameras object array. '
      + 'Never copy placeholder scores. Calculate every score from the supplied images. pass=true cannot have a zero score. '
      + 'Fail requirement_qa when a requested continuous surface becomes segmented/modular, a hidden-seam requirement becomes visibly jointed, required layout/material/light is missing, or a forbidden element appears. '
      + 'Fail cross_view_qa when fixed architecture, anchor placement, dominant material family or lighting logic changes. '
      + 'For a complete spatial lock, spatial_coverage_qa must fail if the layout/top-down/high-oblique reference is missing or role-invalid, reverse/side is not meaningfully different from master, interaction does not establish the action zone, or camera diversity is insufficient. '
      + 'A valid fifth layout view must use a genuinely elevated steep downward camera, show most of the usable ground/base footprint, make task-appropriate boundaries or edges, access points, fixed anchors, circulation and action-zone relations readable together, and relocate meaningfully from the master camera. Reject a mild high-angle commercial shot, frontal elevation, close crop, master reframe, ceiling-dominant enclosed view, or an unrelated plan/miniature/CGI view. '
      + 'The detail image does not count as reverse-space or layout coverage. Do not infer unseen space from visual consistency alone. Do not fail cross_view_qa merely because camera perspective changes. '
      + 'Keep the complete JSON under 3500 characters. Put requirement_qa, cross_view_qa, spatial_coverage_qa and view_issues before optional details. Use at most 3 concise reasons per gate, 6 view issues, 5 anchors, 3 zones, 8 geometry facts, 5 materials and 5 cameras; keep each description under 80 characters.',
    imageUrls: views.map(view => view.url || view.image_url).filter(Boolean),
    maxTokens: 3500,
  };
  let result = await modelGateway.generateVision(request);
  let parsed = safeJson(result.text);
  const sceneScoreFields = [
    ['scene_consistency_score', 'scene_continuity', 'scene_consistency'],
    ['geometry_consistency_score', 'anchor_consistency_score', 'spatial_consistency', 'geometry_consistency'],
    ['material_consistency_score', 'material_match_score', 'material_fidelity', 'material_consistency'],
  ];
  const requirementScoreFields = [
    ['layout_match_score', 'layout_fidelity_score', 'layout_match'],
    ['material_light_match_score', 'material_requirement_score', 'material_light_match'],
    ['interaction_match_score', 'interaction_space_score', 'interaction_match'],
    ['surface_topology_match_score', 'topology_match_score', 'surface_topology_match'],
    ['negative_compliance_score', 'forbidden_compliance_score', 'negative_compliance'],
  ];
  const spatialCoverageScoreFields = [
    ['layout_topology_score', 'layout_coverage_score', 'topology_coverage_score'],
    ['camera_diversity_score', 'view_diversity_score', 'camera_coverage_score'],
    ['reverse_coverage_score', 'reverse_view_score', 'reverse_spatial_score'],
    ['interaction_zone_score', 'interaction_coverage_score', 'interaction_spatial_score'],
  ];
  const lacksIssueEvidence = candidate => {
    const requirementQa = candidate.requirement_qa || candidate;
    const crossViewQa = candidate.cross_view_qa || candidate;
    const spatialQa = candidate.spatial_coverage_qa || candidate;
    const failed = requirementQa.pass === false || crossViewQa.pass === false || spatialQa.pass === false
      || firstScore(requirementQa, ['layout_match_score']) < 0.75
      || firstScore(requirementQa, ['material_light_match_score']) < 0.75
      || firstScore(requirementQa, ['interaction_match_score']) < 0.7
      || firstScore(requirementQa, ['surface_topology_match_score']) < 0.8
      || firstScore(requirementQa, ['negative_compliance_score']) < 0.9
      || firstScore(crossViewQa, ['scene_consistency_score']) < 0.72
      || firstScore(crossViewQa, ['geometry_consistency_score']) < 0.68
      || firstScore(crossViewQa, ['material_consistency_score']) < 0.72
      || firstScore(spatialQa, ['layout_topology_score']) < 0.8
      || firstScore(spatialQa, ['camera_diversity_score']) < 0.75
      || firstScore(spatialQa, ['reverse_coverage_score']) < 0.75
      || firstScore(spatialQa, ['interaction_zone_score']) < 0.7;
    return failed && normalizeViewIssues(candidate.view_issues || candidate.viewIssues || [], requested).length === 0;
  };
  if (!hasRequiredScores(parsed, sceneScoreFields)
    || !hasRequiredScores(parsed, requirementScoreFields)
    || !hasRequiredScores(parsed, spatialCoverageScoreFields)
    || lacksIssueEvidence(parsed)) {
    result = await modelGateway.generateVision({
      ...request,
      userPrompt: request.userPrompt + '\nYour previous response omitted required scores or exact per-view issue evidence. Return the exact nested QA schema and view_issues. Every failed gate must identify an allowed code and exact view_keys; do not use free text as a substitute.',
    });
    parsed = safeJson(result.text);
  }
  if (!hasRequiredScores(parsed, sceneScoreFields)
    || !hasRequiredScores(parsed, requirementScoreFields)
    || !hasRequiredScores(parsed, spatialCoverageScoreFields)
    || lacksIssueEvidence(parsed)) {
    const error = new Error('场景视觉 QA 缺少必需评分或逐图错误证据');
    error.code = 'VISION_QA_SCHEMA_INVALID';
    error.retryable = true;
    throw error;
  }
  const contract = normalizeContract(parsed, {
    sceneId: options.sceneId,
    revision: options.revision,
    views,
    requested,
    layoutRequired: options.layoutRequired === true,
  });
  const layoutAcquisition = options.layoutAcquisition && typeof options.layoutAcquisition === 'object'
    ? options.layoutAcquisition
    : null;
  if (layoutAcquisition) {
    contract.layout_contract = {
      ...contract.layout_contract,
      layout_role_pass: layoutAcquisition.pass === true,
      layout_role_score: score(layoutAcquisition.layout_role_score),
      footprint_coverage_score: score(layoutAcquisition.footprint_coverage_score),
      camera_relocation_score: score(layoutAcquisition.camera_relocation_score),
      scene_identity_score: score(layoutAcquisition.scene_identity_score),
    };
  }
  if (layoutAcquisition?.pass === false) {
    contract.layout_contract.status = 'invalid';
    contract.spatial_coverage_qa.pass = false;
    contract.spatial_coverage_qa.layout_topology_score = Math.min(
      contract.spatial_coverage_qa.layout_topology_score,
      score(layoutAcquisition.footprint_coverage_score),
    );
    contract.spatial_coverage_qa.reasons = [...new Set([
      ...(contract.spatial_coverage_qa.reasons || []),
      ...(layoutAcquisition.reasons || []),
      '第5张俯视布局未通过高俯角全貌角色验证',
    ])].slice(0, 4);
    contract.view_issues = [...contract.view_issues, {
      code: 'LAYOUT_ROLE_INVALID',
      view_keys: ['layout'],
      reason: cleanText(layoutAcquisition.reasons?.[0] || '俯视布局未通过全貌视角验证', 300),
      evidence: 'layout preflight scores below role thresholds',
      confidence: 1,
    }];
    contract.status = 'rejected';
    contract.space_lock_status = 'rejected';
    contract.full_space_lock = false;
  }
  contract.vision_model = result.used_model || '';
  contract.verification = contract.full_space_lock === true
    ? verification.verified(result.used_model)
    : verification.rejected(
      [...contract.view_issues.map(issue => issue.reason), ...contract.requirement_qa.mismatch_reasons, ...contract.cross_view_qa.mismatch_reasons, ...contract.spatial_coverage_qa.reasons],
      contract.requirement_qa.pass && contract.cross_view_qa.pass
        ? '场景视角覆盖不足，尚未形成完整空间锁定'
        : (contract.requirement_qa.pass ? '场景空间、结构或材质一致性未通过' : '场景未满足当前任务的布局、材质、表面结构或禁止项要求'),
    );
  return contract;
}

async function validateLayoutAcquisition(options = {}) {
  const imageUrls = [options.masterUrl, options.layoutUrl].filter(Boolean);
  const request = {
    taskId: options.taskId || '',
    stage: 'new_story_ad.scene_vision',
    systemPrompt: [
      'You are a strict role validator for a general-purpose spatial reference acquisition system.',
      'Image 1 is the master appearance reference. Image 2 is the candidate high-oblique whole-location acquisition view.',
      'Judge only camera role, footprint readability, same-location identity and camera relocation. Never assume a fixed industry, indoor room, outdoor site, material or object category.',
      'Return JSON only with pass, layout_role_score, footprint_coverage_score, scene_identity_score, camera_relocation_score and reasons.',
    ].join('\n'),
    userPrompt: 'Current task spatial constraints: ' + JSON.stringify(options.requested || {}).slice(0, 5000) + '\n'
      + 'The candidate passes only when it uses a genuinely elevated 65-80 degree downward camera; shows most of the usable ground/base footprint; makes scene-appropriate boundaries or edges, access points, fixed anchors, circulation and action-zone relations readable together; remains the same physical location as the master; and does not preserve the master crop or camera sector. '
      + 'For an enclosed location, a prominent ceiling plane is evidence that the camera is not steep enough. A mild high-angle commercial shot, frontal elevation, close crop, master reframe, plan illustration, miniature/dollhouse, cutaway, CGI view or unrelated location must fail. '
      + 'Every score must be an evaluated number from 0 to 1. Use concise Simplified Chinese reasons and never copy placeholder scores.',
    imageUrls,
    maxTokens: 1200,
    timeoutMs: Math.max(15000, Number(options.timeoutMs) || 60000),
    maxCandidates: Math.max(1, Math.min(3, Number(options.maxCandidates) || 2)),
    stageBudgetMs: Math.max(30000, Number(options.stageBudgetMs) || 90000),
  };
  const gateway = options.gateway || modelGateway;
  const result = await gateway.generateVision(request);
  const parsed = safeJson(result.text);
  const fields = [
    ['layout_role_score'],
    ['footprint_coverage_score'],
    ['scene_identity_score'],
    ['camera_relocation_score'],
  ];
  if (!hasRequiredScores(parsed, fields)) {
    const error = new Error('俯视布局前置验证缺少必需评分字段');
    error.code = 'VISION_QA_SCHEMA_INVALID';
    error.retryable = true;
    throw error;
  }
  const normalized = {
    layout_role_score: score(parsed.layout_role_score),
    footprint_coverage_score: score(parsed.footprint_coverage_score),
    scene_identity_score: score(parsed.scene_identity_score),
    camera_relocation_score: score(parsed.camera_relocation_score),
    reasons: stringList(parsed.reasons || parsed.mismatch_reasons || [], 4, 180),
    vision_model: result.used_model || '',
  };
  normalized.pass = parsed.pass === true
    && normalized.layout_role_score >= 0.82
    && normalized.footprint_coverage_score >= 0.8
    && normalized.scene_identity_score >= 0.75
    && normalized.camera_relocation_score >= 0.8;
  if (!normalized.pass && !normalized.reasons.length) {
    normalized.reasons.push('俯视布局未达到高俯角、全貌覆盖、同场景或机位迁移要求');
  }
  return normalized;
}

function normalizeKeyframeQa(input = {}) {
  const modelPass = input.pass === true;
  const modelReasons = stringList(input.mismatch_reasons || [], 16, 300);
  const qa = {
    pass: false,
    model_pass: modelPass,
    status: cleanText(input.status || '', 40),
    scene_consistency_score: score(firstScore(input, ['scene_consistency_score', 'scene_continuity', 'scene_consistency'])),
    anchor_consistency_score: score(firstScore(input, ['anchor_consistency_score', 'spatial_anchor_consistency', 'anchor_consistency'])),
    camera_match_score: score(firstScore(input, ['camera_match_score', 'camera_match', 'view_match'])),
    material_match_score: score(firstScore(input, ['material_match_score', 'material_fidelity', 'material_match'])),
    mismatch_reasons: modelReasons,
    review_notes: [],
    forbidden_new_elements: stringList(input.forbidden_new_elements || [], 16, 220),
  };
  // The numeric contract is the authoritative decision. Vision providers
  // sometimes return pass=false for subjective composition notes even while
  // all four scene-continuity scores satisfy the published thresholds. Those
  // notes are useful for review but must not become a hidden fifth veto.
  qa.pass = qa.scene_consistency_score >= 0.72
    && qa.anchor_consistency_score >= 0.65 && qa.camera_match_score >= 0.65
    && qa.material_match_score >= 0.7 && qa.forbidden_new_elements.length === 0;
  if (qa.pass && modelReasons.length) {
    qa.review_notes = modelReasons;
    qa.mismatch_reasons = [];
  }
  qa.decision_basis = 'numeric_scene_contract';
  qa.status = qa.pass ? 'passed' : 'failed';
  return qa;
}

function positiveShotText(shot = {}) {
  const layers = Array.isArray(shot.visual_layers)
    ? shot.visual_layers.map(layer => typeof layer === 'string' ? layer : (layer?.content || layer?.text || ''))
    : [];
  return [
    shot.title,
    shot.visual,
    shot.visual_description,
    shot.story_visual,
    shot.promo_visual,
    shot.action,
    shot.visual_action,
    shot.content_prompt,
    ...layers,
  ].filter(Boolean).join(' ');
}

function keyframeSceneContract(contract = {}, shot = {}) {
  const next = { ...(contract || {}) };
  const personAuthorized = personIdentity.shotPersonPresence(shot, {}).required;
  const shotText = positiveShotText(shot);
  const brandCopyAuthorized = /品牌|标识|标志|文字|字幕|标语|logo|slogan|brand\s*(?:name|mark|copy)?/i.test(shotText);
  const clauses = String(next.negative || '').split(/[；;\n]/).map(value => value.trim()).filter(Boolean);
  next.negative = clauses.map(clause => {
    const emptyScenePersonRule = /空场景|(?:不要|不得|不能|禁止)(?:画面中)?出现(?:任何)?(?:真人|人物|模特|背影|侧脸|手|身体局部|人形剪影|人物倒影)(?:[、，,]|$)/i.test(clause);
    if (personAuthorized && emptyScenePersonRule) return '';
    const copyRule = /(?:禁止|不要|不得|不能|避免).*(?:文字|logo|品牌标识|标语|字幕)/i.test(clause);
    if (brandCopyAuthorized && copyRule) {
      return /水印|日期戳/i.test(clause)
        ? '禁止未要求的水印、日期戳或随机文字；当前镜头明确要求的品牌文字与标识除外'
        : '';
    }
    return clause;
  }).filter(Boolean).join('；');
  next.final_shot_authorizations = {
    person: personAuthorized,
    requested_brand_copy_or_logo: brandCopyAuthorized,
    note: 'These authorizations come only from the current shot. Empty-scene capture restrictions must not override them.',
  };
  return next;
}

function staticShotContract(shot = {}) {
  const {
    transition_type, transitionType, transition, transition_reason, transitionReason,
    audio_bridge, ambient_sound, sfx, music_cue, voiceover_timing,
    ...still
  } = shot || {};
  return {
    ...still,
    static_qa_scope: {
      still_image_only: true,
      temporal_effects_not_evaluated: true,
      omitted_temporal_fields: [transition_type, transitionType, transition, transition_reason, transitionReason]
        .filter(Boolean).length,
    },
  };
}

async function reviewKeyframe(options = {}) {
  const sceneContract = keyframeSceneContract(options.contract || {}, options.shot || {});
  const shotContract = staticShotContract(options.shot || {});
  const layoutReferenceUrl = cleanText(options.layoutReferenceUrl || '', 1000);
  const reviewImages = [options.sceneReferenceUrl, layoutReferenceUrl, options.generatedUrl].filter(Boolean);
  const request = {
    taskId: options.taskId || '',
    stage: 'new_story_ad.scene_consistency_qa',
    systemPrompt: [
      'You are a strict scene-continuity visual QA inspector for general-purpose commercial storyboards.',
      layoutReferenceUrl
        ? 'Image 1 is the required commercial camera reference, Image 2 is the auxiliary whole-space layout blueprint, and Image 3 is the generated keyframe.'
        : 'Image 1 is the required empty scene/camera reference. Image 2 is the generated keyframe.',
      layoutReferenceUrl
        ? 'Use the layout blueprint only to verify topology, zones, entrances and fixed-anchor relationships. Do not require the generated commercial keyframe to copy the blueprint camera angle.'
        : '',
      'Judge spatial identity, fixed anchors, camera intent, material family and newly invented architecture.',
      'This stage evaluates scene continuity only. Do not judge subjective aesthetics, symmetry, balance, actor placement, copy layout, or ordinary foreground occlusion here. A required actor covering part of a surface does not break that surface topology.',
      'Only treat framing or occlusion as a scene failure when it contradicts the selected camera contract or makes every required scene anchor impossible to identify.',
      'People and the advertised subject may be added when required by the shot.',
      'A person named or described in the shot contract is authorized even though the empty scene reference contains no person. Never reject that required actor merely for being absent from the empty reference.',
      'The empty scene reference may contain capture-only negatives such as no people or no brand copy. For the final keyframe, explicit current-shot people, products, copy and logos override those capture-only restrictions.',
      'When the shot requires pointing, touching, operating, holding or gaze interaction, verify that the intended target is visibly present, physically reachable and aligned with the hand/finger/eyeline. Reject unexplained empty-air gestures.',
      'Judge only the anchor_ids explicitly required by the current shot contract. For detail, macro or tight close-up shots, do not require unrelated wide-scene furniture or distant anchors outside the intended framing; instead verify local material, structure, camera intent and the selected anchor.',
      'This is a still-image QA step. Never fail a keyframe for not proving fade, dissolve, animation, camera motion, timing, gradual appearance or any other temporal effect. Those belong to video/composition QA. Judge only the intended visible end-state and available layout space.',
      'Return JSON only. Never use fixed industry expectations.',
      'All mismatch_reasons and forbidden_new_elements entries must be concise Simplified Chinese written for ordinary product users.',
    ].join('\n'),
    userPrompt: 'Scene contract for this final keyframe: ' + JSON.stringify(sceneContract).slice(0, 10000)
      + '\nStatic shot contract: ' + JSON.stringify(shotContract).slice(0, 5000)
      + '\nTemporal QA boundary: ignore transition, dissolve, fade, animation and gradual-appearance timing. Do not mention their absence in any failure reason.'
      + '\nReturn one JSON object with pass boolean, status string, '
      + 'scene_consistency_score, anchor_consistency_score, camera_match_score and material_match_score '
      + 'as REQUIRED EVALUATED numbers from 0 to 1, plus mismatch_reasons and forbidden_new_elements string arrays. '
      + 'Never copy placeholder scores. Calculate every score from the supplied images. pass=true cannot have a zero score. '
      + 'The numeric thresholds are authoritative: set pass=false only when at least one evaluated score is below its threshold or forbidden_new_elements is non-empty. Put non-blocking composition observations in mismatch_reasons without lowering pass. '
      + 'Fail for another space, incompatible required-anchor movement, changed dominant material structure, '
      + 'selected-camera contradiction, or unsupported new architecture.'
      + '\nUse Simplified Chinese for every reason string. Do not return English reason text.',
    imageUrls: reviewImages,
    maxTokens: 3000,
    timeoutMs: Math.max(15000, Number(options.timeoutMs) || 60000),
    maxCandidates: Math.max(1, Math.min(3, Number(options.maxCandidates) || 2)),
    stageBudgetMs: Math.max(30000, Number(options.stageBudgetMs) || 90000),
  };
  const gateway = options.gateway || modelGateway;
  let result = await gateway.generateVision(request);
  let parsed = safeJson(result.text);
  const keyframeScoreFields = [
    ['scene_consistency_score', 'scene_continuity', 'scene_consistency'],
    ['anchor_consistency_score', 'spatial_anchor_consistency', 'anchor_consistency'],
    ['camera_match_score', 'camera_match', 'view_match'],
    ['material_match_score', 'material_fidelity', 'material_match'],
  ];
  if (!hasRequiredScores(parsed, keyframeScoreFields)) {
    result = await gateway.generateVision({
      ...request,
      userPrompt: request.userPrompt + '\nYour previous response omitted required numeric score fields. Return the exact schema with all four numeric scores from 0 to 1.',
    });
    parsed = safeJson(result.text);
  }
  if (!hasRequiredScores(parsed, keyframeScoreFields)) {
    const error = new Error('关键帧视觉 QA 返回结构缺少必需评分字段');
    error.code = 'VISION_QA_SCHEMA_INVALID';
    error.retryable = true;
    throw error;
  }
  const normalized = normalizeKeyframeQa(parsed);
  const allZero = [
    normalized.scene_consistency_score,
    normalized.anchor_consistency_score,
    normalized.camera_match_score,
    normalized.material_match_score,
  ].every(value => value === 0);
  if (allZero && !normalized.mismatch_reasons.length && !normalized.forbidden_new_elements.length) {
    const error = new Error('关键帧视觉 QA 未能读取或评估参考图片，供应商返回全零评分且没有原因');
    error.code = 'VISION_QA_IMAGE_UNREADABLE';
    error.retryable = true;
    error.qa_response_excerpt = cleanText(result.text, 1200);
    throw error;
  }
  return {
    ...normalized,
    vision_model: result.used_model || '',
    checked_at: new Date().toISOString(),
    ...(process.env.NEW_STORY_AD_QA_DEBUG === '1'
      ? { provider_response_excerpt: cleanText(result.text, 1200) }
      : {}),
  };
}

module.exports = {
  VIEW_KEYS,
  REFERENCE_VIEW_KEYS,
  VIEW_ISSUE_CODES,
  analyzeSceneViews,
  buildUnverifiedContract,
  normalizeContract,
  normalizeAnchors,
  normalizeZones,
  normalizeViewIssues,
  normalizeRequirementQa,
  normalizeSpatialCoverageQa,
  keyframeSceneContract,
  staticShotContract,
  normalizeKeyframeQa,
  reviewKeyframe,
  validateLayoutAcquisition,
};
