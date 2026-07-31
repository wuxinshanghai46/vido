#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-story-ad-workspace-v6-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd');
const projectBundles = require('../src/services/storyAdWorkspace/projectBundleService');
const graphProjection = require('../src/services/storyAdWorkspace/graphProjectionService');
const sketches = require('../src/services/storyAdWorkspace/storyboardSketchService');

const owner = { id: 'workspace-owner', role: 'user' };
const otherUser = { id: 'workspace-other', role: 'user' };

/** 建立不依赖模型的真实任务与真实产物。 */
function seedProject() {
  const created = storyAd.createTask({
    brief: '制作一支突出耐用性和便捷操作的剧情广告。',
    product_subject: '测试商品',
    cast_mode: 'single',
    output_ratio: '16:9',
    target_duration: 12,
  }, owner);
  const taskId = created.task.id;
  const context = storage.getOutput(taskId, 'context');
  storage.saveOutput(taskId, 'context', {
    ...context,
    person_asset: {
      id: 'person-current',
      name: '主要人物',
      image_url: '/api/new-story-ad/assets/person-current.png',
      status: 'verified',
    },
    product_asset: {
      id: 'product-current',
      name: '测试商品',
      image_url: '/api/new-story-ad/assets/product-current.png',
      status: 'verified',
    },
  });
  storage.saveOutput(taskId, 'blueprint', {
    story_title: '真实任务剧情',
    logline: '人物在生活场景中完成一次明确体验。',
    beats: [{ beat_index: 1, title: '开始', visual: '人物进入场景。', duration: 4 }],
  });
  storage.saveOutput(taskId, 'storyboard_table', [
    {
      shot_index: 1,
      title: '建立环境',
      visual: '人物从画面左侧进入室内空间。',
      action: '人物走向商品。',
      duration: 4,
      scene_id: 'scene-current',
      character_ids: ['person-current'],
      camera_movement: '缓慢推进',
    },
    {
      shot_index: 2,
      title: '展示操作',
      visual: '人物完成操作并观察结果。',
      action: '手部完成一次操作。',
      duration: 4,
      scene_id: 'scene-current',
      character_ids: ['person-current'],
    },
  ]);
  storage.updateTask(taskId, { shot_count: 2, stage: 'storyboard_done', status: 'working' });
  return taskId;
}

/** 验证项目数据包、关系画布、用户隔离和线稿版本闭环。 */
async function main() {
  const taskId = seedProject();
  const list = projectBundles.listProjects({ userId: owner.id });
  assert.equal(list.projects.length, 1);
  assert.equal(list.projects[0].id, taskId);
  assert.match(list.projects[0].display_id, /^SA-\d{8}-/);
  assert.equal(projectBundles.listProjects({ userId: otherUser.id }).projects.length, 0, '任务中心不得泄漏其他用户项目');

  const bundle = projectBundles.buildProjectBundle(taskId, { sections: 'all', user: owner });
  assert.equal(bundle.project.id, taskId);
  assert.equal(bundle.brief.text, '制作一支突出耐用性和便捷操作的剧情广告。');
  assert.equal(bundle.storyboard.shots.length, 2);
  assert(bundle.assets.people.some(item => item.id === 'person-current'));
  assert(bundle.assets.products.some(item => item.id === 'product-current'));
  assert(bundle.payload_bytes > 0 && bundle.payload_bytes < 200000, 'Project Bundle 首包必须保持轻量');

  const graph = graphProjection.projectGraph(bundle);
  assert.equal(graph.read_only, true);
  assert(graph.nodes.some(node => node.id === 'shot:1'));
  assert(graph.nodes.some(node => node.id === 'person:person-current'));
  assert(graph.edges.some(edge => edge.target === 'shot:1'));
  assert(graph.clusters.every(cluster => cluster.width > 0 && cluster.height > 0));
  assert(graph.bounds.width > 0 && graph.bounds.height > 0);

  const draft = sketches.saveSketches(taskId, [{
    shot_index: 1,
    status: 'draft',
    image_url: '/api/new-story-ad/assets/sketch-current.png',
    composition_notes: '人物位于左侧，商品位于右侧。',
  }], owner);
  assert.equal(draft.changed, true);
  const unchanged = sketches.saveSketches(taskId, draft.sketches, owner);
  assert.equal(unchanged.changed, false, '同一份线稿不得制造重复版本');

  const confirmed = sketches.saveSketches(taskId, [{
    ...draft.sketches[0],
    status: 'confirmed',
  }], owner);
  assert.equal(confirmed.changed, true);
  let shot = storage.getOutput(taskId, 'storyboard_table')[0];
  assert(shot.keyframe_notes.includes('线稿构图约束：人物位于左侧，商品位于右侧。'));
  const confirmedAgain = sketches.saveSketches(taskId, confirmed.sketches, owner);
  assert.equal(confirmedAgain.changed, false);
  shot = storage.getOutput(taskId, 'storyboard_table')[0];
  assert.equal((shot.keyframe_notes.match(/线稿构图约束：/g) || []).length, 1, '构图约束不得重复追加');

  const generated = await sketches.generateSketch(taskId, 2, {
    confirmed: true,
    client_request_id: 'sketch-test-request',
  }, {
    mediaAdapter: {
      generateImage: async options => {
        assert.equal(options.singleAttempt, true, '线稿必须限制为单次图片调用');
        assert.equal(options.shotIndex, 1);
        assert(!options.prompt.includes('SH04'));
        return { image_url: '/api/new-story-ad/assets/generated-sketch.png', provider_used: 'test/provider' };
      },
    },
  });
  assert.equal(generated.sketch.status, 'draft');
  assert.equal(generated.sketch.shot_index, 2);
  assert.equal(storage.getOutput(taskId, 'storyboard_sketches').length, 2);
  await assert.rejects(
    sketches.generateSketch(taskId, 2, { confirmed: false }, { mediaAdapter: { generateImage: async () => ({}) } }),
    error => error?.code === 'SKETCH_GENERATION_CONFIRMATION_REQUIRED',
  );

  console.log('story-ad workspace v6 service tests: 24 checks passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
