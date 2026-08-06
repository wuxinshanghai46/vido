'use strict';

function evidenceRows(value, kind, { clean, limit = 18 } = {}) {
  const keyLabels = {
    direction: '主光方向', color_temperature: '色温', fixtures: '灯具', notes: '补充说明',
    mode: '表面模式', seam_policy: '分缝策略', finish_distribution: '饰面分布',
    primary_surface_count: '主表面数量', secondary_surface_policy: '次表面策略', user_overrides: '用户覆盖项',
  };
  const rows = Array.isArray(value)
    ? value
    : (['string', 'number', 'boolean'].includes(typeof value) ? [{ value }]
      : (value && typeof value === 'object' ? Object.entries(value).flatMap(([key, entry]) => (
        Array.isArray(entry)
          ? entry.map(item => (item && typeof item === 'object' ? { key, ...item } : { key, value: item }))
          : [entry && typeof entry === 'object' ? { key, ...entry } : { key, value: entry }]
      )) : []));
  return rows.slice(0, limit).map((rawEntry, evidenceIndex) => {
    const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry : { value: rawEntry };
    const primitive = ['string', 'number', 'boolean'].includes(typeof entry.value) ? clean(entry.value, 260) : '';
    const explicitLabel = clean(entry.label_zh || entry.label || entry.name || entry.type, 120);
    const explicitDetail = clean(entry.detail || entry.description || entry.purpose || entry.material || entry.notes, 260);
    if (!explicitLabel && !explicitDetail && (!primitive || primitive === 'auto')) return null;
    const keyLabel = keyLabels[entry.key] || clean(entry.key, 120);
    const label = explicitLabel || (keyLabel && primitive ? keyLabel : (primitive || keyLabel || `${kind} ${evidenceIndex + 1}`));
    const detail = explicitDetail || (keyLabel && primitive && label !== primitive ? primitive : (primitive.length > 120 ? primitive : ''));
    return {
      id: clean(entry.id || entry.key || entry.asset_id || `${kind}_${evidenceIndex + 1}`, 100),
      kind,
      label,
      detail: detail === label ? '' : detail,
    };
  }).filter(entry => entry && (entry.label || entry.detail));
}

function projectSceneDossier({ contract = {}, asset = {}, spec = {}, imageUrl = '', clean, list }) {
  const rows = (value, kind) => evidenceRows(value, kind, { clean });
  const anchors = rows(contract.anchors, 'anchor');
  const geometry = rows(contract.geometry_facts, 'geometry');
  const materials = rows(contract.materials || asset.material_contract, 'material');
  const lighting = rows(contract.lighting, 'lighting');
  const propPlacements = rows(contract.requested_prop_placements || asset.requested_prop_placements || asset.prop_placements || spec.propPlacements || spec.prop_placements, 'prop');
  const topology = rows(asset.surface_topology, 'surface');
  const qaChecks = [
    ['空间锁', { pass: contract.full_space_lock, reasons: contract.verification?.reasons }],
    ['需求匹配', contract.requirement_qa],
    ['跨视角一致性', contract.cross_view_qa],
    ['空间覆盖', contract.spatial_coverage_qa],
    ['机位设计', contract.camera_design_qa],
    ['摄影真实感', contract.photographic_realism_qa],
  ].map(([label, row]) => ({
    label,
    pass: row?.pass,
    score: Number.isFinite(Number(row?.score)) ? Number(row.score) : null,
    reasons: list(row?.reasons || row?.mismatch_reasons).slice(0, 6).map(reason => clean(reason, 220)),
  })).filter(row => row.pass !== undefined || row.score !== null || row.reasons.length);
  return {
    schema_version: 1,
    view_order: ['master', 'reverse', 'interaction', 'detail', 'layout'],
    asset_groups: [...anchors, ...geometry, ...propPlacements, ...materials, ...lighting, ...topology].slice(0, 48),
    anchors,
    geometry_facts: geometry,
    prop_placements: propPlacements,
    materials,
    lighting,
    surface_topology: topology,
    qa_checks: qaChecks,
    source: asset.partial_checkpoint === true ? 'partial_checkpoint' : (imageUrl ? 'scene_asset' : 'scene_plan'),
  };
}

module.exports = { evidenceRows, projectSceneDossier };
