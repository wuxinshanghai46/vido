'use strict';
function clean(value = '', max = 800) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }
function values(value, max = 20) { return (Array.isArray(value) ? value : String(value || '').split(/[、,，；;]/)).map(item => clean(item?.name || item?.label || item, 160)).filter(Boolean).slice(0, max); }
function normalize(scene = {}, index = 0) {
  const input = scene.place_lineage || scene.placeLineage || {}, sceneId = clean(scene.id || scene.scene_id || `scene_${index + 1}`, 120);
  return {
    place_id: clean(input.place_id || scene.place_id || sceneId, 120), place_lineage_id: clean(input.place_lineage_id || scene.place_lineage_id || input.place_id || scene.place_id || sceneId, 120),
    continuity_type: clean(input.continuity_type || scene.continuity_type || 'independent', 60), era: clean(input.era || scene.era || scene.scene_spec?.era || '', 80),
    preserved_anchors: values(input.preserved_anchors || scene.preserved_anchors), removed_elements: values(input.removed_elements || scene.removed_elements),
    rebuilt_elements: values(input.rebuilt_elements || scene.rebuilt_elements), added_elements: values(input.added_elements || scene.added_elements),
    access_route: clean(input.access_route || scene.access_route, 400), forbidden_elements: values(input.forbidden_elements || scene.forbidden_elements || scene.scene_spec?.negativeText),
  };
}
function modernRebuiltBambooForest(overrides = {}) { return normalize({ id: overrides.place_id || 'bamboo_forest', place_lineage: {
  place_id: overrides.place_id || 'bamboo_forest', place_lineage_id: overrides.place_lineage_id || 'bamboo_forest_across_eras', continuity_type: 'same_rebuilt', era: 'modern',
  preserved_anchors: ['竹林地貌', '竹海核心区域', '古代重逢机位的空间朝向'], removed_elements: ['古代土路', '废弃旧设施'], rebuilt_elements: ['现代新建竹林景区道路或林间道路'],
  added_elements: ['克制的现代导视与安全设施'], access_route: '从现代新建林间道路进入同一竹林旧址，城市道路仅可作为短暂转场', forbidden_elements: ['城市主干道', '摩天楼', '密集车流', '普通城市街景'], ...overrides,
} }); }
module.exports = { normalize, modernRebuiltBambooForest };
