export async function loadProjectList({ request, set }, options = {}) {
  set({ loading: true, error: '' });
  try {
    const query = new URLSearchParams({ limit: String(options.limit || 50), page: String(options.page || 1) });
    if (options.status) query.set('status', options.status);
    const data = await request(`/api/story-ad/projects?${query}`);
    set({ projects: data.projects || [], stats: data.stats || {}, projectListScope: data.scope || 'current_user', loading: false });
    return data;
  } catch (error) {
    set({ loading: false, error: error.message });
    throw error;
  }
}
