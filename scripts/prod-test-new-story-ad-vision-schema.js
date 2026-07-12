const path = require('path');
const root = process.env.VIDO_APP_ROOT || process.cwd();
const storage = require(path.join(root, 'src/services/newStoryAd/storageService'));
const mediaAdapter = require(path.join(root, 'src/services/newStoryAd/mediaAdapter'));
const modelGateway = require(path.join(root, 'src/services/newStoryAd/modelGateway'));
const sceneSpace = require(path.join(root, 'src/services/newStoryAd/sceneSpaceContractService'));

async function main() {
  const tasks = storage.listTasks({ limit: 100 });
  let reference = '';
  for (const task of tasks) {
    const assets = storage.getOutput(task.id, 'scene_assets');
    for (const asset of (Array.isArray(assets) ? assets : [])) {
      const view = (asset.view_images || []).find(item => item.key === 'master') || asset.view_images?.[0];
      reference = mediaAdapter.absolutePublicImageUrl(view?.url || view?.image_url || asset.image_url || '');
      if (reference) break;
    }
    if (reference) break;
  }
  if (!reference) throw new Error('no scene reference found');
  const result = await modelGateway.generateVision({
    taskId: '',
    stage: 'new_story_ad.scene_consistency_qa',
    systemPrompt: 'Compare two supplied commercial-scene images. Return JSON only.',
    userPrompt: 'The two images are intentionally identical. Return exactly {"pass":true,"status":"passed","scene_consistency_score":0.99,"anchor_consistency_score":0.99,"camera_match_score":0.99,"material_match_score":0.99,"mismatch_reasons":[],"forbidden_new_elements":[]}.',
    imageUrls: [reference, reference],
    maxTokens: 1500,
  });
  const normalized = await sceneSpace.reviewKeyframe({
    taskId: '',
    sceneReferenceUrl: reference,
    generatedUrl: reference,
    contract: { scene_id: 'schema-validation', scene_revision: 1 },
    shot: { title: 'identical reference validation', scene_view: 'master' },
  });
  console.log(JSON.stringify({ used_model: result.used_model, raw_text: result.text, normalized }, null, 2));
  if (!normalized.pass) process.exitCode = 1;
}
main().catch(error => {
  console.error(JSON.stringify({
    code: error.code || '',
    error: error.message || String(error),
    qa_response_excerpt: error.qa_response_excerpt || '',
  }, null, 2));
  process.exitCode = 1;
});
