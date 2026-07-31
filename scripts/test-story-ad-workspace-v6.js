#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-story-ad-workspace-v6-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd');
const projectBundles = require('../src/services/storyAdWorkspace/projectBundleService');
const graphProjection = require('../src/services/storyAdWorkspace/graphProjectionService');
const graphLayouts = require('../src/services/storyAdWorkspace/graphLayoutService');
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
    expected_people: 1,
    expected_animals: 1,
    cast_profiles: [{
      id: 'cast-current',
      displayName: '主要人物',
      roleName: '产品体验角色',
      appearanceText: '东亚成年女性，鹅蛋脸，身形匀称，气质自然可信。',
      wardrobeText: '固定穿雾蓝色针织上衣和象牙白长裤。',
      hairMakeupText: '固定深棕色低发髻和自然淡妆。',
      negativeText: '禁止年龄、服装和发型漂移。',
    }],
    person_asset: {
      id: 'person-current',
      actor_id: 'cast-current',
      name: '主要人物',
      image_url: '/api/new-story-ad/assets/person-current.png',
      cover_image_url: '/api/new-story-ad/assets/person-current-dossier.png',
      dossier_sheet: {
        image_url: '/api/new-story-ad/assets/person-current-dossier.png',
        width: 1536,
        height: 1024,
      },
      view_images: [
        { key: 'front', url: '/api/new-story-ad/assets/person-current.png' },
        { key: 'side', url: '/api/new-story-ad/assets/person-current-side.png' },
        { key: 'back', url: '/api/new-story-ad/assets/person-current-back.png' },
        { key: 'action', url: '/api/new-story-ad/assets/person-current-action.png' },
      ],
      status: 'verified',
    },
    pet_profiles: [{
      id: 'pet-current',
      name: '雪球',
      type: '犬',
      breed: '萨摩耶',
      appearance: '成年白色萨摩耶，佩戴天蓝色项圈。',
      reference_images: [
        '/api/new-story-ad/assets/pet-current-front.png',
        '/api/new-story-ad/assets/pet-current-side.png',
        '/api/new-story-ad/assets/pet-current-back.png',
        '/api/new-story-ad/assets/pet-current-action.png',
      ],
    }],
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
  assert.equal(bundle.assets.people[0].profile.id, 'cast-current', 'V6 必须把持久化人物档案投影到生成请求');
  assert.equal(bundle.assets.people[0].dossier_sheet.image_url, '/api/new-story-ad/assets/person-current-dossier.png');
  assert.equal(bundle.assets.people[0].view_images.length, 4);
  assert.equal(bundle.assets.animals[0].image_url, '/api/new-story-ad/assets/pet-current-front.png', '旧宠物 reference_images 必须恢复为可见封面');
  assert.equal(bundle.assets.animals[0].view_images.length, 4, '旧宠物四视图必须完整投影');
  assert(bundle.assets.products.some(item => item.id === 'product-current'));
  assert(bundle.payload_bytes > 0 && bundle.payload_bytes < 200000, 'Project Bundle 首包必须保持轻量');

  const assetCenterSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterView.js'), 'utf8')
    .replace(/^import\s+.*?;\s*$/gm, '')
    .replace(/\bexport\s+/g, '');
  const assetCenterSandbox = {};
  vm.runInNewContext(`${assetCenterSource}\nglobalThis.__subjectGenerationPayload = subjectGenerationPayload;`, assetCenterSandbox, {
    filename: 'assetCenterView.browser-contract.js',
  });
  const subjectGenerationPayload = assetCenterSandbox.__subjectGenerationPayload;
  const allSubjects = subjectGenerationPayload(bundle, null, 'workspace-all-subjects');
  assert.equal(allSubjects.cast_profiles.length, 1);
  assert.equal(allSubjects.pet_profiles.length, 1);
  assert.equal(allSubjects.request_key, 'workspace-all-subjects');
  const onePerson = subjectGenerationPayload(bundle, bundle.assets.people[0], 'workspace-one-person');
  assert.deepEqual(onePerson.subject_targets, [{ kind: 'human', id: 'cast-current', index: 0 }]);
  assert.equal(onePerson.regenerate_selected, true);
  assert.notEqual(bundle.assets.people[0].asset_id, bundle.assets.people[0].subject_id, '卡片资产 ID 与生成主体 ID 必须分离');
  const missingCompanion = {
    ...bundle,
    assets: {
      ...bundle.assets,
      people: [
        bundle.assets.people[0],
        {
          id: 'draft-card-2', asset_id: 'draft-card-2', subject_id: 'cast-draft-2', kind: 'person',
          profile: {
            id: 'cast-draft-2', displayName: '第二人物', roleName: '配角', age: 'adult_30_40',
            appearanceText: '成年男性，身形挺拔，气质专业。', wardrobeText: '深灰色西装与黑色皮鞋。',
            hairMakeupText: '短发整洁，自然妆面。', negativeText: '禁止服装漂移。',
          },
          view_images: [], status: 'draft',
        },
      ],
    },
  };
  const selectedWithMissing = subjectGenerationPayload(missingCompanion, missingCompanion.assets.people[0], 'workspace-missing-companion');
  assert.deepEqual(selectedWithMissing.subject_targets, [
    { kind: 'human', id: 'cast-current', index: 0 },
    { kind: 'human', id: 'cast-draft-2', index: 1 },
  ], '逐人物生成必须自动包含其他缺少可复用四视图的主体');

  const graph = graphProjection.projectGraph(bundle);
  assert.equal(graph.read_only, true);
  assert(graph.nodes.some(node => node.id === 'shot:1'));
  assert(graph.nodes.some(node => node.id === 'person:person-current'));
  assert(graph.edges.some(edge => edge.target === 'shot:1'));
  assert(graph.clusters.every(cluster => cluster.width > 0 && cluster.height > 0));
  assert(graph.bounds.width > 0 && graph.bounds.height > 0);
  const mediaGraph = graphProjection.projectGraph({
    ...bundle,
    generation: {
      keyframes: [{ shot_index: 1, image_url: '/api/new-story-ad/assets/keyframe-current.png', status: 'accepted' }],
      clips: [{ shot_index: 1, video_url: '/api/new-story-ad/video/current', status: 'accepted' }],
      final_video: { video_url: '/api/new-story-ad/final/current', status: 'done' },
    },
  });
  assert.equal(mediaGraph.nodes.find(node => node.id === 'keyframe:1').media_url, '/api/new-story-ad/assets/keyframe-current.png');
  assert.equal(mediaGraph.nodes.find(node => node.id === 'clip:1').media_url, '/api/new-story-ad/video/current');
  assert.equal(mediaGraph.nodes.find(node => node.id.startsWith('final:')).media_url, '/api/new-story-ad/final/current');

  const contentRevisionBeforeLayout = storage.getTask(taskId).content_revision;
  const allowedNodeIds = new Set(graph.nodes.map(node => node.id));
  const initialLayout = graphLayouts.getLayout(taskId, { allowedNodeIds });
  assert.equal(initialLayout.layout_revision, 0);
  assert.deepEqual(initialLayout.nodes, []);
  const movedNode = graph.nodes.find(node => node.id === 'person:person-current');
  const savedLayout = graphLayouts.saveLayout(taskId, {
    layout_revision: 0,
    source_graph_revision: graph.revision,
    nodes: [
      { id: movedNode.id, x: 880, y: 420 },
      { id: 'stale-node', x: 50, y: 50 },
    ],
    viewport: { zoom: 1.25, pan_x: -320, pan_y: 84 },
  }, { allowedNodeIds, user: owner });
  assert.equal(savedLayout.changed, true);
  assert.equal(savedLayout.layout.layout_revision, 1);
  assert.equal(savedLayout.layout.nodes.length, 1, '布局只能保存当前图谱中的稳定节点 ID');
  assert.equal(storage.getTask(taskId).content_revision, contentRevisionBeforeLayout, '保存画布布局不得修改剧情内容版本');
  const restoredLayout = graphLayouts.getLayout(taskId, { allowedNodeIds });
  assert.equal(restoredLayout.nodes[0].x, 880);
  assert.equal(restoredLayout.viewport.zoom, 1.25);
  const mergedGraph = graphLayouts.mergeGraph(graphProjection.projectGraph(bundle), restoredLayout);
  assert.equal(mergedGraph.read_only, false);
  assert.equal(mergedGraph.layout_revision, 1);
  assert.deepEqual(mergedGraph.nodes.find(node => node.id === movedNode.id).position, { x: 880, y: 420 });
  assert(mergedGraph.clusters.every(cluster => cluster.width > 0 && cluster.height > 0));
  const unchangedLayout = graphLayouts.saveLayout(taskId, {
    layout_revision: 1,
    source_graph_revision: graph.revision,
    nodes: restoredLayout.nodes,
    viewport: restoredLayout.viewport,
  }, { allowedNodeIds, user: owner });
  assert.equal(unchangedLayout.changed, false, '相同布局不得制造新布局版本');
  assert.throws(
    () => graphLayouts.saveLayout(taskId, {
      layout_revision: 0,
      source_graph_revision: graph.revision,
      nodes: restoredLayout.nodes,
      viewport: restoredLayout.viewport,
    }, { allowedNodeIds, user: otherUser }),
    error => error?.code === 'GRAPH_LAYOUT_REVISION_CONFLICT' && error?.current_layout_revision === 1,
    '旧页面不得覆盖新布局',
  );
  const resetLayout = graphLayouts.resetLayout(taskId, {
    layout_revision: 1,
    source_graph_revision: graph.revision,
  }, { allowedNodeIds, user: owner });
  assert.equal(resetLayout.layout.layout_revision, 2);
  assert.equal(resetLayout.layout.reset, true);
  assert.deepEqual(resetLayout.layout.nodes, []);
  assert.equal(storage.getTask(taskId).content_revision, contentRevisionBeforeLayout, '重置画布布局不得修改剧情内容版本');
  assert.throws(
    () => graphLayouts.saveLayout(taskId, {
      layout_revision: 1,
      source_graph_revision: graph.revision,
      nodes: restoredLayout.nodes,
    }, { allowedNodeIds, user: owner }),
    error => error?.code === 'GRAPH_LAYOUT_REVISION_CONFLICT' && error?.current_layout_revision === 2,
    '重置后布局版本不得回退形成并发覆盖',
  );

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

  console.log('story-ad workspace v6 service tests: project bundle, editable graph layout and sketches passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
