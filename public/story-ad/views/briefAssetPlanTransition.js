export async function createAssetPlanAndRefresh(store, taskId) {
  let planError = null;
  try {
    await store.runStage('scene-config');
  } catch (error) {
    planError = error;
  }
  try {
    await store.loadBundle(taskId, 'summary,assets');
  } catch (error) {
    planError ||= error;
  }
  return planError;
}
