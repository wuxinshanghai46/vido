async function execute(node, context) {
  const upstreamText = context.inputArtifacts.filter(item => ['text', 'json'].includes(item.kind)).map(item => item.metadata?.text || '').filter(Boolean).join('\n');
  const text = String(node.config.text || upstreamText || '').trim();
  if (!text) throw new Error('语音节点缺少文本');
  if (context.stub) {
    const target = context.outputPath('wav'); require('fs').writeFileSync(target, Buffer.from('VIDEO_CANVAS_STUB_AUDIO'));
    return { artifacts: [{ kind: 'audio', filePath: target, metadata: { text, stub: true } }], provider: 'stub', model: 'stub-voice', billingState: 'not_submitted', actualCost: 0 };
  }
  const { generateSpeech } = require('../../ttsService'); const output = context.outputPath('mp3');
  context.onProviderRequestStarted?.({ provider: node.config.provider || 'auto', model: node.config.voiceId || 'auto' });
  await generateSpeech(text, output, { gender: node.config.gender || 'female', speed: Number(node.config.speed) || 1, voiceId: node.config.voiceId || null });
  return { artifacts: [{ kind: 'audio', filePath: output, metadata: { text } }], provider: node.config.provider || 'auto', model: node.config.voiceId || 'auto', billingState: 'confirmed', actualCost: context.nodeRun.estimated_cost };
}
module.exports = { execute };
