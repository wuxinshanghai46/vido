(() => {
  async function wait({
    targetVersion = 0,
    timeoutMs = 20000,
    getCommittedVersion = () => 0,
    getLastError = () => null,
    cancelPendingTimer = () => {},
    isSaving = () => false,
    flush = async () => false,
  } = {}) {
    const target = Math.max(0, Number(targetVersion) || 0);
    const started = Date.now();
    while (getCommittedVersion() < target) {
      const lastError = getLastError();
      if (lastError) throw lastError;
      if (Date.now() - started > timeoutMs) {
        const error = new Error('人物或场景已经补齐，但服务器保存确认超时；页面不会显示成功，请稍后重试保存');
        error.code = 'AUTOSAVE_CONFIRM_TIMEOUT';
        throw error;
      }
      cancelPendingTimer();
      if (!isSaving()) await flush();
      if (getCommittedVersion() < target) await new Promise(resolve => setTimeout(resolve, 80));
    }
    return true;
  }

  window.NewStoryAdAutoSaveConfirmation = { wait };
})();
