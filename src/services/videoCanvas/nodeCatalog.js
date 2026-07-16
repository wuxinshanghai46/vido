const PORTS = Object.freeze({
  text: 'text/plain', json: 'application/json', image: 'image/*', video: 'video/*', audio: 'audio/*', any: '*/*',
});

const NODE_CATALOG = Object.freeze({
  'text-input': node('文本输入', 'input', {}, { text: PORTS.text }, { free: true, requiredConfig: ['text'] }),
  'text-generate': node('文本生成', 'generate', { prompt: PORTS.text }, { text: PORTS.text }, { cost: 0.002, requiredConfig: ['prompt'] }),
  'structured-text': node('结构化文本', 'generate', { prompt: PORTS.text }, { json: PORTS.json, text: PORTS.text }, { cost: 0.003, requiredConfig: ['prompt'] }),
  'image-upload': node('图片素材', 'input', {}, { image: PORTS.image }, { free: true, requiredConfig: ['artifactId'] }),
  'image-generate': node('图片生成', 'generate', { prompt: PORTS.text, reference: PORTS.image }, { image: PORTS.image }, { cost: 0.04, requiredConfig: ['prompt'] }),
  'image-edit': node('图片编辑', 'generate', { prompt: PORTS.text, image: PORTS.image }, { image: PORTS.image }, { cost: 0.04, requiredInputs: ['image'], requiredConfig: ['prompt'] }),
  character: node('人物形象', 'generate', { prompt: PORTS.text, reference: PORTS.image }, { image: PORTS.image }, { cost: 0.04, costMultiplier: 'views', requiredConfig: ['prompt'] }),
  'text-to-video': node('文生视频', 'generate', { prompt: PORTS.text }, { video: PORTS.video }, { costPerSecond: 0.12, requiredConfig: ['prompt'] }),
  'image-to-video': node('图生视频', 'generate', { prompt: PORTS.text, image: PORTS.image }, { video: PORTS.video }, { costPerSecond: 0.12, requiredInputs: ['image'], requiredConfig: ['prompt'] }),
  'video-upload': node('视频素材', 'input', {}, { video: PORTS.video }, { free: true, requiredConfig: ['artifactId'] }),
  'video-trim': node('视频裁剪', 'local', { video: PORTS.video }, { video: PORTS.video }, { free: true, requiredInputs: ['video'] }),
  voice: node('语音合成', 'generate', { text: PORTS.text }, { audio: PORTS.audio }, { costPerChar: 0.000004 }),
  music: node('音乐', 'generate', { prompt: PORTS.text }, { audio: PORTS.audio }, { cost: 0.1 }),
  subtitle: node('字幕', 'local', { video: PORTS.video, text: PORTS.text }, { video: PORTS.video }, { free: true, requiredInputs: ['video'] }),
  merge: node('合成导出', 'local', { video: PORTS.video, audio: PORTS.audio }, { video: PORTS.video }, { free: true, requiredInputs: ['video'], multiInput: true }),
  select: node('结果选择', 'control', { input: PORTS.any }, { output: PORTS.any }, { free: true, requiredInputs: ['input'], multiInput: true }),
  batch: node('批量分支', 'control', { input: PORTS.any }, { output: PORTS.any }, { free: true, requiredInputs: ['input'] }),
  condition: node('条件分支', 'control', { input: PORTS.any }, { yes: PORTS.any, no: PORTS.any }, { free: true, requiredInputs: ['input'] }),
});

function node(label, category, inputs, outputs, policy = {}) {
  return { version: 1, label, category, inputs, outputs, policy };
}

function compatible(outputType, inputType) {
  if (!outputType || !inputType) return false;
  if (outputType === PORTS.any || inputType === PORTS.any) return true;
  if (outputType === inputType) return true;
  return inputType.endsWith('/*') && outputType.startsWith(inputType.slice(0, -1));
}

function estimateNodeCost(type, config = {}) {
  const policy = NODE_CATALOG[type]?.policy || {};
  if (policy.free) return 0;
  if (policy.costPerSecond) return Number((policy.costPerSecond * Math.max(1, Number(config.duration) || 5)).toFixed(6));
  if (policy.costPerChar) return Number((policy.costPerChar * String(config.text || config.prompt || '').length).toFixed(6));
  if (policy.costMultiplier) return Number(((policy.cost || 0) * Math.max(1, Number(config[policy.costMultiplier]) || 1)).toFixed(6));
  return Number(policy.cost || 0);
}

module.exports = { NODE_CATALOG, PORTS, compatible, estimateNodeCost };
