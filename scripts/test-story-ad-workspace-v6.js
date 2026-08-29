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
const { normalizeAppearanceAgeText } = require('../src/services/storyAdWorkspace/personTextProjectionService');
const graphProjection = require('../src/services/storyAdWorkspace/graphProjectionService');
const graphLayouts = require('../src/services/storyAdWorkspace/graphLayoutService');
const sketches = require('../src/services/storyAdWorkspace/storyboardSketchService');
const storyFlowGate = require('../src/services/storyAdWorkspace/storyFlowSketchGateService');
const productAssets = require('../src/services/newStoryAd/productAssetResolverService');

const owner = { id: 'workspace-owner', role: 'user' };
const otherUser = { id: 'workspace-other', role: 'user' };

assert.equal(productAssets.productPresentation({
  content_mode: 'commercial_subject',
  brief: '红色金属漆高性能跑车在雨后道路完成加速与过弯',
  product_subject: '高性能红色电动跑车',
  product_presentation: { mode: 'material_surface', source: 'brief_semantics', description: '旧的场景材料推断' },
}).mode, 'standalone_product', '用户明确写明跑车后必须重算旧的语义推断，金属漆不得把整车误判为表面材料');
assert.equal(productAssets.productPresentation({
  content_mode: 'commercial_subject', brief: '展示304不锈钢墙面板材纹理', product_subject: '304不锈钢墙板',
}).mode, 'material_surface', '真实板材仍应保持场景材料模式');

assert.equal(
  normalizeAppearanceAgeText('年龄约28-，东方古典气质的现代女性'),
  '年龄约28岁，东方古典气质的现代女性',
  '工作区必须把被截断的年龄范围尾巴投影为可读实际年龄',
);

/** 建立不依赖模型的真实任务与真实产物。 */
function seedProject() {
  const created = storyAd.createTask({
    content_mode: 'commercial_subject',
    content_mode_source: 'user',
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
  storage.saveOutput(taskId, 'storyboard_meta', { status: 'ready', source: 'generated' });
  storage.saveOutput(taskId, 'quality_review', { passed: true, blocking_issues: [], rewrite_issues: [] });
  storage.saveOutput(taskId, 'keyframe_contracts', [1, 2].map(index => ({ shot_index: index, scene_lock: { scene_id: 'scene-current', scene_view: 'master' } })));
  storage.updateTask(taskId, { shot_count: 2, stage: 'keyframe_contract_ready', status: 'done' });
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
  assert(bundle.navigation.counts.assets >= 3, '已生成或已上传资产必须计入侧栏');
  assert.equal(bundle.navigation.counts.subject_assets, 3, '人物资产步骤只能统计人物、动物、商品与 LOGO，不能混入场景和道具');
  assert.equal(bundle.navigation.counts.ready_subject_assets, 3, '已就绪主体资产必须使用与资产中心相同的分类口径');
  assert.equal(bundle.project.content_mode, 'commercial_subject', '项目列表摘要必须携带内容类型');
  assert.equal(bundle.project.content_mode_source, 'user', '项目列表摘要必须保留内容类型来源');

  const placeholderTask = storyAd.createTask({
    content_mode: 'commercial_subject',
    content_mode_source: 'user',
    brief: '仅创建项目，不生成任何资产。',
    product_subject: '只有文字描述的广告主体',
    cast_mode: 'none',
    expected_people: 0,
    expected_animals: 0,
  }, owner).task.id;
  const placeholderBundle = projectBundles.buildProjectBundle(placeholderTask, { sections: 'all', user: owner });
  assert.equal(placeholderBundle.navigation.counts.assets, 0, '只有文字占位不得伪装成已生成资产');
  assert.equal(placeholderBundle.navigation.counts.subject_assets, 0, '随场景生成的商品占位不得计入待完成人物/主体资产');
  assert.equal(placeholderBundle.navigation.counts.ready_subject_assets, 0, '只有文字占位不得计入已就绪主体资产');
  assert.equal(placeholderBundle.navigation.counts.planned_assets, 0, 'not_applicable 商品不是独立资产生成计划');
  storyAd.updateStoryboardTable(placeholderTask, [{
    title: '无版本漂移镜头',
    visual: '商品保持在画面中央，镜头静止展示。',
    action: '主体保持稳定。',
    duration: 3,
    shot_size: 'medium',
    camera_angle: 'eye_level',
    camera_movement: 'static',
  }], owner, { expected_content_revision: storage.getTask(placeholderTask).content_revision });
  const normalizedStoryboard = storage.getOutput(placeholderTask, 'storyboard_table');
  const storyboardRevision = storage.getTask(placeholderTask).content_revision;
  storyAd.updateStoryboardTable(placeholderTask, normalizedStoryboard, owner, {
    expected_content_revision: storyboardRevision,
  });
  assert.equal(
    storage.getTask(placeholderTask).content_revision,
    storyboardRevision,
    '未修改内容的再次保存不得因 edited_at 等投影字段制造新版本并阻塞下一环节',
  );
  const referenceContractTask = storyAd.createTask({ content_mode: 'narrative_story', content_mode_source: 'user', brief: '参考视频镜头合同测试' }, owner).task.id;
  storyAd.updateStoryboardTable(referenceContractTask, [{
    title: '参考镜头',
    visual: '一家三口在客厅落地窗前交流。',
    action: '三人同时看向窗外。',
    duration: 4,
    scene_id: 'reference-scene-1',
    shot_size: 'wide',
    camera_angle: 'eye_level',
    camera_movement: 'static',
    source: 'reference_analysis_projection',
  }], owner, { expected_content_revision: storage.getTask(referenceContractTask).content_revision });
  const referenceContractShot = storage.getOutput(referenceContractTask, 'storyboard_table')[0];
  assert.match(referenceContractShot.entry_frame_state, /^镜头开始：/);
  assert.match(referenceContractShot.exit_frame_state, /^镜头结束：/);
  const workflowStateTask = storyAd.createTask({ content_mode: 'narrative_story', content_mode_source: 'user', brief: '工作流确认状态测试' }, owner).task.id;
  const assetConfirmation = storyAd.updateTaskRequest(workflowStateTask, {
    asset_setup_confirmed: true,
    base_content_revision: storage.getTask(workflowStateTask).content_revision,
  }, owner);
  assert.equal(assetConfirmation.context.asset_setup_confirmed, true);
  assert.deepEqual(assetConfirmation.changed_domains, [], '纯资产确认不得伪装成创意内容变化');
  const shotConfirmation = storyAd.updateTaskRequest(workflowStateTask, {
    shot_design_confirmed: true,
    base_content_revision: storage.getTask(workflowStateTask).content_revision,
  }, owner);
  assert.equal(shotConfirmation.context.asset_setup_confirmed, true, '确认镜头不得反向取消已经完成的资产环节');
  assert.equal(shotConfirmation.context.shot_design_confirmed, true);
  assert.deepEqual(shotConfirmation.changed_domains, [], '纯镜头确认不得触发内容失效传播');
  assert(bundle.payload_bytes > 0 && bundle.payload_bytes < 200000, 'Project Bundle 首包必须保持轻量');

  const assetCenterSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterView.js'), 'utf8')
    .replace(/^import\s+.*?;\s*$/gm, '')
    .replace(/\bexport\s+/g, '');
  const assetPersonStateSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterPersonState.js'), 'utf8')
    .replace(/^import\s+.*?;\s*$/gm, '')
    .replace(/\bexport\s+/g, '');
  const assetCenterSandbox = {};
  vm.runInNewContext(`${assetPersonStateSource}\n${assetCenterSource}\nglobalThis.__subjectGenerationPayload = subjectGenerationPayload;`, assetCenterSandbox, {
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
  ], '单人物入口只提交当前主体；首次整批生成必须使用“生成全部缺失人物 / 动物”入口');

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
    spacing_version: 2,
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
  const legacyInvertedNodes = graph.nodes.map(item => {
    if (item.group === 'story') return { id: item.id, x: 1020, y: item.position.y };
    if (item.group === 'assets') return { id: item.id, x: 520, y: item.position.y };
    return { id: item.id, x: item.position.x, y: item.position.y };
  });
  const migratedLegacyGraph = graphLayouts.mergeGraph(graphProjection.projectGraph(bundle), {
    layout_revision: 7,
    source_graph_revision: graph.revision,
    nodes: legacyInvertedNodes,
  });
  const migratedStoryX = Math.min(...migratedLegacyGraph.nodes.filter(node => node.group === 'story').map(node => node.position.x));
  const migratedAssetX = Math.min(...migratedLegacyGraph.nodes.filter(node => node.group === 'assets').map(node => node.position.x));
  assert(migratedStoryX < migratedAssetX, '旧任务保存的倒置坐标必须迁移为剧情在身份资产之前');
  assert.equal(migratedLegacyGraph.layout.stage_order_rebased, true);
  assert.equal(
    migratedLegacyGraph.nodes.find(node => node.group === 'story').position.y,
    graph.nodes.find(node => node.group === 'story').position.y,
    '旧布局迁移不得改变阶段内的纵向排列',
  );
  const unchangedLayout = graphLayouts.saveLayout(taskId, {
    layout_revision: 1,
    source_graph_revision: graph.revision,
    spacing_version: 2,
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

  const flowState = storyFlowGate.blueprintState(taskId);
  storage.saveOutput(taskId, 'story_flow_sketches', flowState.beats.map((beat, index) => ({
    beat_index: Number(beat.beat_index || beat.index || index + 1) || index + 1,
    image_url: `/api/new-story-ad/assets/flow-${index + 1}.png`,
    status: 'confirmed',
    source_blueprint_fingerprint: flowState.fingerprint,
    source_content_revision: Number(flowState.task.content_revision || 1) || 1,
  })));

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
  assert(shot.keyframe_notes.includes('分镜构图约束：人物位于左侧，商品位于右侧。'));
  const confirmedAgain = sketches.saveSketches(taskId, confirmed.sketches, owner);
  assert.equal(confirmedAgain.changed, false);
  shot = storage.getOutput(taskId, 'storyboard_table')[0];
  assert.equal((shot.keyframe_notes.match(/分镜构图约束：/g) || []).length, 1, '构图约束不得重复追加');

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
  assert.equal(storage.getOutput(taskId, 'storyboard_images').length, 2);
  await assert.rejects(
    sketches.generateSketch(taskId, 2, { confirmed: false }, { mediaAdapter: { generateImage: async () => ({}) } }),
    error => error?.code === 'SKETCH_GENERATION_CONFIRMATION_REQUIRED',
  );

  console.log('story-ad workspace service tests: project bundle, editable graph layout and storyboard images passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
