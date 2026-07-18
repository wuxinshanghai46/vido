const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.tmp', 'new-story-ad-spatial-generation-order');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_PUBLIC_BASE_URL = 'https://test.invalid';

const storage = require('../src/services/newStoryAd/storageService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const sceneSpace = require('../src/services/newStoryAd/sceneSpaceContractService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');

async function main() {
  const taskId = 'spatial-generation-order-test';
  const context = {
    brief: 'Lock one reusable commercial interior before storyboard generation.',
    product_subject: 'current task subject',
    scene_spec: {
      layoutText: 'One complete room with a main wall, entrance, sofa, table and empty interaction zone.',
      materialLightText: 'Continuous metal feature wall with warm grazing light and realistic stone floor.',
      interactionText: 'Keep a reachable action zone beside the table and an unobstructed route from the entrance.',
      negativeText: 'No people, no text, no duplicated furniture and no visible decorative panel seams.',
      surfaceTopology: {
        mode: 'continuous',
        seam_policy: 'hidden',
        finish_distribution: 'regional',
      },
    },
  };
  storage.createTask({ id: taskId, title: 'spatial generation order', request: context });
  storage.saveOutput(taskId, 'context', context);

  const calls = [];
  let activeImageCalls = 0;
  let peakImageCalls = 0;
  const originalGenerateImage = mediaAdapter.generateImage;
  const originalAnalyze = sceneSpace.analyzeSceneViews;
  mediaAdapter.generateImage = async options => {
    calls.push(options);
    const callNumber = calls.length;
    activeImageCalls += 1;
    peakImageCalls = Math.max(peakImageCalls, activeImageCalls);
    await new Promise(resolve => setTimeout(resolve, 5));
    const url = `/mock-scene-view-${callNumber}.png`;
    activeImageCalls -= 1;
    return { url, image_url: url, provider_used: 'mock/spatial-order' };
  };
  sceneSpace.analyzeSceneViews = async options => ({
    schema_version: 3,
    status: 'verified',
    observed_summary: 'One locked room represented by five distinct spatial views.',
    cross_view_qa: {
      pass: true,
      scene_consistency_score: 0.96,
      geometry_consistency_score: 0.95,
      material_consistency_score: 0.96,
      mismatch_reasons: [],
    },
    requirement_qa: {
      pass: true,
      layout_match_score: 0.96,
      material_light_match_score: 0.95,
      interaction_match_score: 0.94,
      surface_topology_match_score: 0.96,
      negative_compliance_score: 0.97,
      mismatch_reasons: [],
    },
    spatial_coverage_qa: {
      pass: true,
      layout_topology_score: 0.95,
      camera_diversity_score: 0.92,
      reverse_coverage_score: 0.9,
      interaction_zone_score: 0.9,
      reasons: [],
    },
    layout_contract: { required: true, status: 'available' },
    cameras: options.views.map(view => ({ view_id: view.key, reference_image_url: view.url })),
  });

  try {
    const generated = await sceneAssets.generateSceneAsset(taskId, {
      scene_id: 'locked-room',
      scene_spec: context.scene_spec,
      aspect_ratio: '16:9',
    });
    const asset = generated.scene_asset;

    assert.equal(sceneAssets.needsLayoutView({ layout: 'one simple wall' }), true);
    assert.deepEqual(sceneAssets.REQUIRED_SCENE_VIEW_KEYS, ['layout', 'master', 'reverse', 'interaction', 'detail']);
    assert.equal(calls.length, 5, 'one generation call per required asset, with no service-level retry');
    assert.equal(peakImageCalls, 3, 'reverse, interaction and detail must run in parallel after layout and master are ready');
    assert.match(calls[0].filename, /_layout_/);
    assert.deepEqual(calls[0].referenceImages || [], []);
    assert.match(calls[0].prompt, /SPATIAL BLUEPRINT/i);
    assert.match(calls[0].prompt, /complete floor boundary, walls, openings/i);

    assert.match(calls[1].filename, /_master_/);
    assert.deepEqual(calls[1].referenceImages, ['/mock-scene-view-1.png']);
    assert.equal(calls[1].requireReferences, true);
    assert.match(calls[1].prompt, /MASTER ESTABLISHING VIEW/i);
    assert.match(calls[1].prompt, /supplied reference image is the spatial blueprint/i);
    assert.match(calls[1].prompt, /spatial blueprint is the canonical authority/i);

    for (const call of calls.slice(2)) {
      assert.deepEqual(call.referenceImages, ['/mock-scene-view-1.png', '/mock-scene-view-2.png']);
      assert.equal(call.requireReferences, true);
      assert.match(call.prompt, /Reference image 1 is the spatial blueprint.*Reference image 2 is the master establishing view/i);
      assert.match(call.prompt, /blueprint geometry first and master-view appearance second/i);
      assert.match(call.prompt, /no people/i);
    }
    assert.match(calls[2].filename, /_reverse_/);
    assert.match(calls[2].prompt, /at least about 90 degrees of azimuth change/i);
    assert.match(calls[2].prompt, /not a small reframing|near-identical composition/i);
    assert.match(calls[3].filename, /_interaction_/);
    assert.match(calls[3].prompt, /human eye\/chest height/i);
    assert.match(calls[3].prompt, /empty standing\/action clearance/i);
    assert.match(calls[4].filename, /_detail_/);
    assert.match(calls[4].prompt, /close or macro crop/i);
    assert.match(calls[4].prompt, /must not be another wide room view/i);

    assert.deepEqual(asset.view_images.map(view => view.key), ['master', 'reverse', 'interaction', 'detail', 'layout']);
    assert.equal(asset.image_url, '/mock-scene-view-2.png', 'master remains the historical primary thumbnail');
    assert.equal(asset.view_count, 5);
    assert.equal(asset.layout_contract.required, true);
    assert.equal(asset.view_acquisition.layout_policy, 'required_for_all_new_scenes');
    assert.deepEqual(asset.view_acquisition.generation_order, ['layout', 'master', 'reverse', 'interaction', 'detail']);
    assert.deepEqual(asset.view_acquisition.reference_graph, {
      layout: [],
      master: ['layout'],
      reverse: ['layout', 'master'],
      interaction: ['layout', 'master'],
      detail: ['layout', 'master'],
    });

    console.log(JSON.stringify({
      success: true,
      generation_order: asset.view_acquisition.generation_order,
      stored_view_order: asset.view_images.map(view => view.key),
      generation_calls: calls.length,
      peak_parallel_image_calls: peakImageCalls,
      all_views_empty_scene: calls.every(call => /no people/i.test(call.prompt)),
      primary_view_backward_compatible: asset.image_url === '/mock-scene-view-2.png',
    }, null, 2));
  } finally {
    mediaAdapter.generateImage = originalGenerateImage;
    sceneSpace.analyzeSceneViews = originalAnalyze;
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
