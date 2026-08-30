export function retainActiveGenerationProgress(progressTask = {}, bundle = {}) {
  const reported = progressTask.generation_progress || null;
  const active = Boolean(progressTask.active_generation_id);
  return {
    project: reported || (active ? bundle?.project?.generation_progress : null),
    generation: reported || (active ? bundle?.generation?.progress : null),
  };
}
