export async function createAssetPlanAndRefresh(store, taskId) {
  let planError = null;
  try {
    await store.loadBundle(taskId, 'summary,assets');
  } catch (error) {
    planError ||= error;
  }
  return planError;
}
