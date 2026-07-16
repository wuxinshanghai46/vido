const { combinedPrompt } = require('./helpers');

async function execute(node, context) {
  const prompt = combinedPrompt(node, context);
  if (!prompt) throw new Error('文本生成缺少提示词');
  if (context.stub) {
    const text = node.type === 'structured-text' ? JSON.stringify({ summary: prompt.slice(0, 120), stub: true }) : `[测试结果] ${prompt}`;
    return { artifacts: [{ kind: node.type === 'structured-text' ? 'json' : 'text', text }], provider: 'stub', model: 'stub-text', billingState: 'not_submitted', actualCost: 0 };
  }
  const { callLLM } = require('../../storyService');
  const system = node.type === 'structured-text'
    ? '你是视频创作工作流中的结构化文本节点。严格输出 JSON，不要输出 Markdown。'
    : '你是视频创作工作流中的文本节点。根据输入完成任务，输出可直接供下游使用的结果。';
  context.onProviderRequestStarted?.({ provider: 'platform-llm', model: node.config.model || 'auto' });
  const text = await callLLM(system, prompt, { userId: context.run.user_id, agentId: 'video_canvas_text', requestId: context.attempt.id });
  return { artifacts: [{ kind: node.type === 'structured-text' ? 'json' : 'text', text }], provider: 'platform-llm', model: node.config.model || 'auto', billingState: 'confirmed', actualCost: context.nodeRun.estimated_cost };
}

module.exports = { execute };
