export async function acceptCurrentScenes({ state, request, refreshSections }) {
  const taskId = state.bundle?.project?.id;
  if (!taskId) throw new Error('请先创建项目。');
  const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/scene-acceptance`, {
    method: 'POST', body: {}, timeoutMs: 30000,
  });
  const bundle = await refreshSections('summary,assets,story,shots');
  return { ...data, bundle };
}
