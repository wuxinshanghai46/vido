const { combinedPrompt, mediaInputs, publicUrl } = require('./helpers');

async function execute(node, context) {
  const prompt = combinedPrompt(node, context);
  if (!prompt) throw new Error('图片生成缺少提示词');
  if (context.stub) {
    const target = context.outputPath('svg');
    const safe = prompt.replace(/[&<>"']/g, '').slice(0, 80);
    require('fs').writeFileSync(target, `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="#eef2ff"/><text x="60" y="520" font-size="36" fill="#25305b">${safe}</text></svg>`);
    return { artifacts: [{ kind: 'image', filePath: target, metadata: { mimeType: 'image/svg+xml', preview: true } }], provider: 'stub', model: 'stub-image', billingState: 'not_submitted', actualCost: 0 };
  }

  const references = mediaInputs(context, 'image').map(item => item.storage_path || publicUrl(item)).filter(Boolean);
  const model = String(node.config.model || '').trim();
  const provider = String(node.config.provider || '').trim();
  if (!provider || !model) throw new Error('请选择图片供应商和模型');
  context.onProviderRequestStarted?.({ provider, model });

  if (provider === 'deyunai') {
    const dy = require('../../deyunaiService');
    const result = await dy.generateImage({
      model,
      prompt,
      n: 1,
      size: node.config.size || '1024x1024',
      aspectRatio: node.config.aspectRatio || '1:1',
      referenceImages: references,
      userId: context.run.user_id,
      agentId: 'video_canvas_image',
    });
    const url = result.urls?.[0];
    if (!url) throw new Error('图片生成没有返回结果');
    context.onProviderSubmitted?.({ provider, model, providerTaskId: result.taskId || '', billingState: 'confirmed' });
    return { artifacts: [{ kind: 'image', remoteUrl: url }], provider, model, providerTaskId: result.taskId || '', billingState: 'confirmed', actualCost: context.nodeRun.estimated_cost };
  }

  const { generateDramaImage } = require('../../imageService');
  const result = await generateDramaImage({
    prompt,
    filename: `video_canvas_${context.nodeRun.id}_${Date.now()}`,
    aspectRatio: node.config.aspectRatio || '1:1',
    resolution: node.config.resolution || '1K',
    referenceImages: references,
    image_model: `${provider}::${model}`,
  });
  context.onProviderSubmitted?.({ provider, model, providerTaskId: '', billingState: 'confirmed' });
  return { artifacts: [{ kind: 'image', filePath: result.filePath }], provider, model, billingState: 'confirmed', actualCost: context.nodeRun.estimated_cost };
}

module.exports = { execute };
