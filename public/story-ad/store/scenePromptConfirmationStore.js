export async function confirmScenePrompt({ state, request, refreshSections }, scene = {}) {
  const taskId = state.bundle?.project?.id;
  const sceneId = String(scene.id || scene.scene_id || '');
  if (!taskId || !sceneId) throw new Error('未找到需要确认的场景。');
  const confirmation = scene.prompt_confirmation || {};
  const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/scene-prompts/${encodeURIComponent(sceneId)}/confirm`, {
    method: 'POST',
    body: { confirmation_id: confirmation.confirmation_id || '' },
  });
  await refreshSections('summary,assets');
  return data;
}
