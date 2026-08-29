function sectionList(sections = '') {
  return sections === 'all' ? ['all'] : String(sections).split(',').map(item => item.trim()).filter(Boolean);
}

const backgroundPrefetches = new Map();

function mergedBundle(state, incoming = {}, taskId, sections) {
  const current = state.bundle?.project?.id === taskId ? (state.bundle || {}) : {};
  const currentRevision = Number(current.revisions?.content || 0) || 0;
  const incomingRevision = Number(incoming.revisions?.content || currentRevision) || currentRevision;
  if (currentRevision && incomingRevision < currentRevision) {
    return { bundle: current, sections: state.bundleSections || [] };
  }
  const sameRevision = Boolean(currentRevision && incomingRevision === currentRevision);
  const base = sameRevision ? current : {};
  const bundle = {
    ...base,
    ...incoming,
    project: { ...(base.project || {}), ...(incoming.project || {}) },
    navigation: { ...(base.navigation || {}), ...(incoming.navigation || {}) },
    revisions: { ...(base.revisions || {}), ...(incoming.revisions || {}) },
  };
  const loaded = new Set(sameRevision ? (state.bundleSections || []) : []);
  sectionList(sections).forEach(item => loaded.add(item));
  return { bundle, sections: [...loaded] };
}

export async function loadProjectBundle({ request, set, state, taskId, sections = 'all' }) {
  const requestSeq = (state.bundleRequestSeq || 0) + 1;
  state.bundleRequestSeq = requestSeq;
  set({ loading: true, error: '' });
  try {
    if (state.bundle?.project?.id && state.bundle.project.id !== taskId) state.progressRevision = '';
    const data = await request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/bundle?sections=${encodeURIComponent(sections)}`);
    if (requestSeq !== state.bundleRequestSeq) return state.bundle;
    const merged = mergedBundle(state, data.bundle, taskId, sections);
    set({ bundle: merged.bundle, bundleSections: merged.sections, loading: false });
    return merged.bundle;
  } catch (error) {
    if (requestSeq !== state.bundleRequestSeq) return state.bundle;
    set({ loading: false, error: error.message });
    throw error;
  }
}

export async function refreshProjectBundle({ request, set, state, sections }) {
  const taskId = state.bundle?.project?.id;
  if (!taskId) return null;
  const requestSeq = (state.bundleRequestSeq || 0) + 1;
  state.bundleRequestSeq = requestSeq;
  const data = await request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/bundle?sections=${encodeURIComponent(sections)}`);
  if (requestSeq !== state.bundleRequestSeq || state.bundle?.project?.id !== taskId) return state.bundle;
  const merged = mergedBundle(state, data.bundle, taskId, sections);
  set({ bundle: merged.bundle, bundleSections: merged.sections });
  return merged.bundle;
}

export async function prefetchProjectBundle({ request, set, state, taskId, sections = 'all' }) {
  if (!taskId || state.bundle?.project?.id !== taskId) return state.bundle;
  const loaded = new Set(state.bundleSections || []);
  const wanted = sectionList(sections);
  if (loaded.has('all') || wanted.every(item => loaded.has(item))) return state.bundle;
  const key = `${taskId}:${sections}`;
  if (backgroundPrefetches.has(key)) return backgroundPrefetches.get(key);
  const promise = request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/bundle?sections=${encodeURIComponent(sections)}`)
    .then(data => {
      if (state.bundle?.project?.id !== taskId) return state.bundle;
      const merged = mergedBundle(state, data.bundle, taskId, sections);
      set({ bundle: merged.bundle, bundleSections: merged.sections });
      return merged.bundle;
    })
    .finally(() => backgroundPrefetches.delete(key));
  backgroundPrefetches.set(key, promise);
  return promise;
}
