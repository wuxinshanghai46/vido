export async function loadMediaPage({ request, state }, options = {}) {
  const taskId = state.bundle?.project?.id;
  if (!taskId) throw new Error('请先创建项目。');
  const params = new URLSearchParams({
    kind: options.kind || 'all',
    offset: String(Math.max(0, Number(options.offset) || 0)),
    limit: String(Math.max(1, Math.min(100, Number(options.limit) || 24))),
  });
  const data = await request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/media?${params}`);
  return data.catalog;
}

export async function loadMoreMedia({ request, state, set }, kind = 'keyframes', limit = 24) {
  const generation = state.bundle?.generation || {};
  const field = kind === 'clips' ? 'clips' : (kind === 'audio' ? 'sound_journey' : 'keyframes');
  const current = Array.isArray(generation[field]) ? generation[field] : [];
  const catalog = await loadMediaPage({ request, state }, { kind, offset: current.length, limit });
  const nextGeneration = {
    ...generation,
    [field]: [...current, ...(catalog.items || [])],
    media_catalog: { ...(generation.media_catalog || {}), [kind]: catalog },
  };
  set({ bundle: { ...(state.bundle || {}), generation: nextGeneration } });
  return catalog;
}
