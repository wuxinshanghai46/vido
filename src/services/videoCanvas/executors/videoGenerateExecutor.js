const path = require('path');
const { combinedPrompt, mediaInputs, publicUrl } = require('./helpers');

async function execute(node, context) {
  const prompt = combinedPrompt(node, context);
  if (!prompt) throw new Error('视频生成缺少提示词');
  const images = mediaInputs(context, 'image');
  if (node.type === 'image-to-video' && !images.length) throw new Error('图生视频缺少上游图片');
  if (context.stub) {
    const target = context.outputPath('mp4');
    require('fs').writeFileSync(target, Buffer.from('VIDEO_CANVAS_STUB_VIDEO'));
    return { artifacts: [{ kind: 'video', filePath: target, metadata: { duration: Number(node.config.duration) || 5, stub: true } }], provider: 'stub', model: 'stub-video', billingState: 'not_submitted', actualCost: 0 };
  }
  const provider = node.config.provider || 'deyunai'; const model = node.config.model || '';
  if (!model) throw new Error('请选择视频模型');
  const { generateVideoClip } = require('../../videoService');
  const output = context.outputPath('mp4');
  context.onProviderRequestStarted?.({ provider, model });
  const result = await generateVideoClip({
    prompt, duration: Math.max(3, Math.min(15, Number(node.config.duration) || 5)),
    outputDir: path.dirname(output), filename: path.basename(output, '.mp4'),
    video_provider: provider, video_model: model, image_url: images[0] ? publicUrl(images[0]) : undefined,
    aspectRatio: node.config.aspectRatio || '16:9', userId: context.run.user_id, agentId: 'video_canvas_video',
    onSubmitted: info => context.onProviderSubmitted?.({ provider, model, providerTaskId: info?.taskId || info?.id || '', billingState: 'unknown' }),
  });
  return { artifacts: [{ kind: 'video', filePath: result.filePath, metadata: { duration: Number(node.config.duration) || 5 } }], provider, model, providerTaskId: result.providerTaskId || '', billingState: 'confirmed', actualCost: context.nodeRun.estimated_cost };
}

module.exports = { execute };
