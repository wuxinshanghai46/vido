function sectionList(sections = '') {
  return sections === 'all' ? ['all'] : String(sections).split(',').map(item => item.trim()).filter(Boolean);
}

export async function loadProjectBundle({ request, set, state, taskId, sections = 'all' }) {
  set({ loading: true, error: '' });
  try {
    if (state.bundle?.project?.id && state.bundle.project.id !== taskId) state.progressRevision = '';
    const data = await request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/bundle?sections=${encodeURIComponent(sections)}`);
    set({ bundle: data.bundle, bundleSections: sectionList(sections), loading: false });
    return data.bundle;
  } catch (error) {
    set({ loading: false, error: error.message });
    throw error;
  }
}

export async function refreshProjectBundle({ request, set, state, sections }) {
  const taskId = state.bundle?.project?.id;
  if (!taskId) return null;
  const data = await request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/bundle?sections=${encodeURIComponent(sections)}`);
  const current = state.bundle || {};
  const next = {
    ...current,
    ...data.bundle,
    project: { ...(current.project || {}), ...(data.bundle.project || {}) },
    navigation: { ...(current.navigation || {}), ...(data.bundle.navigation || {}) },
    revisions: { ...(current.revisions || {}), ...(data.bundle.revisions || {}) },
  };
  const loaded = new Set(state.bundleSections || []);
  sectionList(sections).forEach(item => loaded.add(item));
  set({ bundle: next, bundleSections: [...loaded] });
  return next;
}
