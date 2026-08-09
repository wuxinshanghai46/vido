export function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function worldById(bundle = {}, id = '') {
  return list(bundle.scene_worlds).find(world => String(world.id) === String(id));
}
