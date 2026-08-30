export function createStoryboardLiveRefresh(intervalMs = 1500) {
  let refreshedAt = 0;
  return async function refreshLiveStoryboard(project = {}, refreshSections = async () => {}) {
    if (project.active_stage !== 'storyboard' || Date.now() - refreshedAt < intervalMs) return false;
    refreshedAt = Date.now();
    await refreshSections('shots');
    return true;
  };
}
