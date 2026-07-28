(() => {
  /**
   * 统一把人物、场景和文本辅写接入步骤级取消契约，避免各入口自行维护 generation_id。
   */
  function request(stage = 'assist', ctx = {}, options = {}) {
    const flow = window.NewStoryAdGenerationFlow;
    if (!flow?.requestInlineGeneration) {
      const error = new Error('可取消生成模块未加载，请刷新页面后重试');
      error.code = 'CANCELLATION_MODULE_NOT_READY';
      throw error;
    }
    return flow.requestInlineGeneration(stage, ctx, options);
  }

  window.NewStoryAdCancelableGeneration = { request };
})();
