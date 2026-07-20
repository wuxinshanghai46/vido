/** 压缩浏览器恢复响应中的重复上下文，不修改任何已存储任务数据。 */
function compactPublicTaskBundle(bundle = {}) {
  if (!bundle || typeof bundle !== 'object') return bundle;
  const outputs = bundle.outputs && typeof bundle.outputs === 'object' && !Array.isArray(bundle.outputs)
    ? { ...bundle.outputs }
    : bundle.outputs;
  const hasContextOutput = outputs?.context && typeof outputs.context === 'object';
  const task = bundle.task && typeof bundle.task === 'object' ? { ...bundle.task } : bundle.task;
  const compact = { ...bundle, task, outputs };

  if (hasContextOutput) {
    const context = { ...outputs.context };
    if (outputs.scene_assets) delete context.scene_assets;
    if (outputs.person_contract) delete context.person_contract;
    outputs.context = context;
    if (task) delete task.request;
    delete compact.context;
  }
  return compact;
}

module.exports = { compactPublicTaskBundle };
