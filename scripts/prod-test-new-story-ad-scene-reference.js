const path = require('path');
const root = process.env.VIDO_APP_ROOT || process.cwd();
const storage = require(path.join(root, 'src/services/newStoryAd/storageService'));
const mediaAdapter = require(path.join(root, 'src/services/newStoryAd/mediaAdapter'));
const sceneSpace = require(path.join(root, 'src/services/newStoryAd/sceneSpaceContractService'));

async function main() {
  const tasks = storage.listTasks({ limit: 100 });
  let selected = null;
  for (const task of tasks) {
    const assets = storage.getOutput(task.id, 'scene_assets');
    if (!Array.isArray(assets)) continue;
    for (const asset of assets) {
      const master = (asset.view_images || []).find(view => view.key === 'master') || asset.view_images?.[0];
      const url = mediaAdapter.absolutePublicImageUrl(master?.url || master?.image_url || asset.image_url || '');
      if (url) {
        selected = { task, asset, url };
        break;
      }
    }
    if (selected) break;
  }
  if (!selected) throw new Error('生产任务中没有可用于验证的场景参考图');
  const started = Date.now();
  const result = await mediaAdapter.generateImage({
    stage: 'new_story_ad.keyframe',
    prompt: [
      'Use the supplied image as the exact scene reference.',
      'Generate one photorealistic commercial camera frame inside the same physical space.',
      'Keep fixed architecture, openings, large anchor objects, material family, color palette and lighting direction unchanged.',
      'Do not add people, text, logos, new rooms or unsupported architecture.',
    ].join('\n'),
    filename: 'prod_scene_reference_validation_' + Date.now(),
    aspectRatio: '16:9',
    resolution: '2K',
    imageModel: 'deyunai/gpt-image-2',
    referenceImages: [selected.url],
    requireReferences: true,
    inputFidelity: 'high',
  });
  const generatedUrl = mediaAdapter.absolutePublicImageUrl(result.url || result.image_url || '');
  if (!generatedUrl) throw new Error('真实参考图测试未返回图片 URL');
  const qa = await sceneSpace.reviewKeyframe({
    taskId: '',
    sceneReferenceUrl: selected.url,
    generatedUrl,
    contract: selected.asset.scene_contract || {
      scene_id: selected.asset.scene_id || selected.asset.id,
      scene_revision: selected.asset.scene_revision || 1,
      layout_summary: selected.asset.layout_summary || '',
      material_summary: selected.asset.material_summary || '',
    },
    shot: { title: '生产参考图能力验证', scene_view: 'master', action: '保持原空间的空场景摄影机验证' },
  });
  console.log(JSON.stringify({
    success: result.reference_preserving === true && result.reference_count === 1,
    provider_used: result.provider_used || '',
    reference_preserving: result.reference_preserving === true,
    reference_count: result.reference_count || 0,
    latency_ms: Date.now() - started,
    qa,
    generated_url: generatedUrl,
    source_task_id: selected.task.id,
  }, null, 2));
  if (result.reference_preserving !== true || result.reference_count !== 1) process.exitCode = 1;
}

main().catch(error => {
  console.error(JSON.stringify({
    success: false,
    code: error.code || 'PROD_REFERENCE_TEST_FAILED',
    retryable: error.retryable === true,
    error: String(error.message || error),
  }));
  process.exitCode = 1;
});
