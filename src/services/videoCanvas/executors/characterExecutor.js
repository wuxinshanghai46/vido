const imageExecutor = require('./imageGenerateExecutor');

const VIEWS = ['正面主视图', '侧面视图', '背面视图', '动作视图', '面部特写', '商品持物视图'];

async function execute(node, context) {
  const count = Math.max(1, Math.min(6, Number(node.config.views) || 1));
  const basePrompt = node.config.prompt || '';
  const tasks = VIEWS.slice(0, count).map(async (view, index) => {
    const result = await imageExecutor.execute({ ...node, type: 'image-generate', config: { ...node.config, prompt: `${basePrompt}\n视图要求：${view}` } }, context);
    return (result.artifacts || []).map(item => ({ ...item, metadata: { ...(item.metadata || {}), view, viewIndex: index } }));
  });
  const groups = await Promise.all(tasks);
  return { artifacts: groups.flat(), provider: node.config.provider || (context.stub ? 'stub' : 'deyunai'), model: node.config.model || 'auto', billingState: context.stub ? 'not_submitted' : 'confirmed', actualCost: context.stub ? 0 : context.nodeRun.estimated_cost };
}

module.exports = { execute };
