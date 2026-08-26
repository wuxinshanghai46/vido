export async function saveScenePrompt({ state, request }, scene = {}, generationPrompt = '') {
  const taskId = state.bundle?.project?.id;
  const sceneId = String(scene.id || scene.scene_id || '');
  if (!taskId || !sceneId) throw new Error('未找到需要编辑的场景。');
  const promptState = scene.prompt_state || scene.prompt_confirmation || {};
  const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/scene-prompts/${encodeURIComponent(sceneId)}`, {
    method: 'PUT',
    body: {
      base_prompt_version_id: promptState.prompt_version_id || promptState.confirmation_id || '',
      generation_prompt: String(generationPrompt || '').trim(),
    },
  });
  return data;
}
