async function execute(node, context) {
  if (node.type === 'text-input') return { artifacts: [{ kind: 'text', text: node.config.text || '' }] };
  if (['image-upload', 'video-upload'].includes(node.type)) {
    const artifactId = String(node.config.artifactId || '');
    const artifact = context.getArtifact(artifactId);
    if (!artifact || artifact.project_id !== context.project.id || artifact.status !== 'ready') throw new Error('素材不存在或不属于当前项目');
    return { reuseArtifactIds: [artifactId] };
  }
  throw new Error(`素材执行器不支持 ${node.type}`);
}

module.exports = { execute };
