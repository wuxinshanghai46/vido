'use strict';

function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function clean(value, max = 240) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }
function normalizedPoint(value) {
  if (!Array.isArray(value) || value.length < 2) return [];
  const finite = item => Number.isFinite(Number(item)) ? Number(item) : 0.5;
  return value.slice(0, 2).map(item => Math.max(0, Math.min(1, finite(item))));
}

function animalWorldMatrix(bundle = {}, worlds = [], options = {}) {
  const assignments = list(options.assignments);
  const storyboard = list(bundle.storyboard?.shots);
  return list(bundle.assets?.animals).map((animal, index) => {
    const subjectId = clean(animal.subject_id || animal.id || animal.asset_id || `animal-${index + 1}`, 120);
    const name = clean(animal.name || animal.profile?.displayName || animal.profile?.species || `动物 ${index + 1}`, 120);
    return {
      character_id: subjectId, subject_id: subjectId, kind: 'animal',
      species: clean(animal.profile?.species || animal.role || animal.profile?.breed || animal.name, 80), name,
      cells: worlds.map(world => {
        const explicit = assignments.find(item => clean(item.character_id || item.subject_id, 120) === subjectId && clean(item.world_id, 120) === clean(world.id, 120));
        const matched = storyboard.filter(shot => String(shot.scene_id || shot.scene_asset_id || '') === String(world.id)
          && (list(shot.character_ids).map(String).includes(subjectId) || `${shot.visual || ''} ${shot.action || ''}`.includes(name)));
        return {
          world_id: world.id, presence: clean(explicit?.presence, 30) || (matched.length ? 'confirmed' : (worlds.length === 1 ? 'suggested' : 'unassigned')),
          shot_count: matched.length, role: clean(explicit?.role || matched.map(shot => shot.action).filter(Boolean).join('；'), 260),
          blocking_position: normalizedPoint(explicit?.blocking_position || explicit?.position_on_layout || explicit?.position),
          entry_point: normalizedPoint(explicit?.entry_point || explicit?.entry_position), exit_point: normalizedPoint(explicit?.exit_point || explicit?.exit_position),
          route_points: list(explicit?.route_points || explicit?.path_points).map(normalizedPoint).filter(point => point.length),
          camera_id: clean(explicit?.camera_id, 120), source: explicit ? 'manual' : (matched.length ? 'current_storyboard' : 'none'),
        };
      }),
    };
  });
}

module.exports = { animalWorldMatrix };
