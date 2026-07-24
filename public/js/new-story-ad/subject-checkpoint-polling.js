(() => {
  function stop(state = {}) {
    if (state.subjectCheckpointTimer) clearInterval(state.subjectCheckpointTimer);
    state.subjectCheckpointTimer = null;
  }

  function resume(options = {}) {
    const {
      state,
      api,
      hydrateTaskBundle,
      renderAll,
      intervalMs = 2500,
    } = options;
    if (!state || typeof api !== 'function' || typeof hydrateTaskBundle !== 'function') return false;
    stop(state);
    if (!state.taskId || !state.personGenerationProgress?.active
      || !state.personGenerationProgress?.restoredFromCheckpoint) return false;
    const trackedTaskId = String(state.taskId);
    let polling = false;
    state.subjectCheckpointTimer = setInterval(async () => {
      if (polling || String(state.taskId) !== trackedTaskId
        || !state.personGenerationProgress?.active
        || !state.personGenerationProgress?.restoredFromCheckpoint) {
        if (String(state.taskId) !== trackedTaskId || !state.personGenerationProgress?.active) stop(state);
        return;
      }
      polling = true;
      try {
        const response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(trackedTaskId)}?compact=1`);
        hydrateTaskBundle(response.bundle || response);
        if (typeof renderAll === 'function') renderAll();
        if (!state.personGenerationProgress?.active) stop(state);
      } catch {
        // Keep the persisted checkpoint visible and retry without creating a new paid request.
      } finally {
        polling = false;
      }
    }, intervalMs);
    return true;
  }

  window.NewStoryAdSubjectCheckpointPolling = { stop, resume };
})();
