async function execute(node, context) {
  if (context.stub) {
    const target = context.outputPath('wav'); require('fs').writeFileSync(target, Buffer.from('VIDEO_CANVAS_STUB_MUSIC'));
    return { artifacts: [{ kind: 'audio', filePath: target, metadata: { stub: true } }], provider: 'stub', model: 'stub-music', billingState: 'not_submitted', actualCost: 0 };
  }
  const { generateMusic } = require('../../musicService');
  context.onProviderRequestStarted?.({ provider: node.config.provider || 'auto', model: node.config.model || 'auto' });
  const result = await generateMusic({ scenes: [{ description: node.config.prompt || '' }], genre: node.config.genre || 'cinematic', mood: node.config.mood || 'epic', duration: Number(node.config.duration) || 30, projectId: context.run.project_id });
  if (!result?.filePath) throw new Error('音乐生成失败');
  return { artifacts: [{ kind: 'audio', filePath: result.filePath, metadata: { source: result.source } }], provider: result.source || 'local', model: node.config.model || 'auto', billingState: result.source === 'local' ? 'not_submitted' : 'confirmed', actualCost: result.source === 'local' ? 0 : context.nodeRun.estimated_cost };
}
module.exports = { execute };
