#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-story-ad-backend-projection-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd');
const productResolver = require('../src/services/newStoryAd/productAssetResolverService');
const productIdentity = require('../src/services/newStoryAd/productIdentityContractService');
const bundles = require('../src/services/storyAdWorkspace/projectBundleService');
const graphs = require('../src/services/storyAdWorkspace/graphProjectionService');

const user = { id: 'backend-projection-owner', role: 'user' };

function createTask(name, productSubject) {
  return storyAd.createTask({
    project_name: name,
    brief: `为${productSubject}制作一支结构完整的剧情广告。`,
    product_subject: productSubject,
    cast_mode: 'no_human',
  }, user).task.id;
}

function testProductResolverAndProjection() {
  const materialPresentation = productResolver.productPresentation({
    product_subject: '当前广告主体',
    brief: '为不锈钢原材料制作广告，人物从展示墙介绍铂棕碎钻纹理和高级金属背景墙。',
  });
  assert.equal(materialPresentation.mode, 'material_surface');
  assert.equal(materialPresentation.standalone_generation_supported, false);
  assert.match(materialPresentation.subject, /不锈钢/);
  const robotPresentation = productResolver.productPresentation({ product_subject: '模块化服务机器人', brief: '展示机器人的分解与精确组合过程' });
  assert.equal(robotPresentation.mode, 'standalone_product');
  assert.equal(robotPresentation.standalone_generation_supported, true);
  const canonical = { id: 'product-primary', type: 'product', image_url: '/same-product.png', name: '主商品' };
  const duplicateLegacy = { id: 'legacy-copy', type: 'product', image_url: '/same-product.png', name: '历史副本' };
  const secondary = { id: 'legacy-second', type: 'product', image_url: '/second-product.png', name: '历史商品二' };
  const resolved = productResolver.productAssets({
    product_asset: canonical,
    assets: [duplicateLegacy, secondary, { id: 'scene', type: 'scene', image_url: '/scene.png' }],
  });
  assert.deepEqual(resolved.map(item => item.id), ['product-primary', 'legacy-second'], '商品媒体必须按主资产优先并按 URL 去重');

  const canonicalContract = productIdentity.buildProductContract({
    product_subject: '主商品',
    product_asset: canonical,
    product_contract: {
      status: 'verified',
      reference_qa: { pass: true, identity_score: 1, shape_score: 1, color_score: 1, material_score: 1 },
    },
  });
  assert.equal(canonicalContract.reference_images[0], '/same-product.png');
  assert.notEqual(canonicalContract.status, 'not_applicable', 'canonical product_asset 必须进入商品合同');
  assert.notEqual(canonicalContract.status, 'verified', '新媒体没有匹配旧指纹时不得伪 verified');

  const emptyContract = productIdentity.buildProductContract({
    product_subject: '只有文字的商品主题',
    product_contract: {
      status: 'verified',
      reference_qa: { pass: true, identity_score: 1, shape_score: 1, color_score: 1, material_score: 1 },
    },
  });
  assert.equal(emptyContract.status, 'not_applicable');
  assert.deepEqual(emptyContract.reference_images, []);

  const historicalTaskId = createTask('历史商品素材投影', '历史商品');
  const historicalContext = storage.getOutput(historicalTaskId, 'context');
  storage.saveOutput(historicalTaskId, 'context', {
    ...historicalContext,
    product_asset: null,
    assets: [{ id: 'legacy-product', type: 'product', name: '历史商品图', image_url: '/legacy-product.png' }],
  });
  const historicalBundle = bundles.buildProjectBundle(historicalTaskId, { sections: 'assets', user });
  assert.equal(historicalBundle.assets.products.length, 1);
  assert.equal(historicalBundle.assets.products[0].id, 'legacy-product');
  assert.equal(historicalBundle.assets.products[0].image_url, '/legacy-product.png', '历史 context.assets 商品媒体必须恢复到商品卡');

  const neutralTaskId = createTask('材料中性参考来源投影', '不锈钢材料表面');
  const neutralContext = storage.getOutput(neutralTaskId, 'context');
  storage.saveOutput(neutralTaskId, 'context', {
    ...neutralContext,
    product_presentation: { mode: 'material_surface', standalone_generation_supported: false },
    product_asset: {
      id: 'material-neutral-reference', type: 'product_material', image_url: '/neutral-reference.png',
      source: 'new_story_ad_subject_reference_generator', reference_only: true, user_owned: false,
    },
  });
  const neutralProduct = bundles.buildProjectBundle(neutralTaskId, { sections: 'assets', user }).assets.products[0];
  assert.equal(neutralProduct.source, 'new_story_ad_subject_reference_generator', '前端必须拿到AI中性参考图来源');
  assert.equal(neutralProduct.reference_only, true, '前端必须拿到仅参考标记，不能冒充真实材料样片');
  assert.equal(neutralProduct.user_owned, false, 'AI中性参考图不得投影成用户自有样片');

  const emptyTaskId = createTask('无商品素材占位', '语义商品主题');
  const emptyBundle = bundles.buildProjectBundle(emptyTaskId, { sections: 'assets', user });
  assert.equal(emptyBundle.assets.products.length, 1, '无素材时仍保留语义商品占位');
  assert.equal(emptyBundle.assets.products[0].image_url, '');
  assert.notEqual(emptyBundle.assets.products[0].status, 'verified');
}

async function testProductVerificationCallBoundary() {
  let visionCalls = 0;
  const verified = await productIdentity.verifyProductContract({
    taskId: 'workspace-product-verification',
    ctx: {
      product_subject: '待验证商品',
      product_asset: { id: 'canonical-product', type: 'product', image_url: 'https://example.com/product.png' },
    },
    gateway: {
      async generateVision() {
        visionCalls += 1;
        return { text: '{}', used_model: 'test/vision' };
      },
    },
    repair: {
      async parseOrRepair() {
        return { pass: true, identity_score: 0.94, shape_score: 0.91, color_score: 0.9, material_score: 0.86, conflicts: [] };
      },
    },
  });
  assert.equal(visionCalls, 1, '一次显式商品验证只允许调用一次视觉模型');
  assert.equal(verified.status, 'verified');

  const noMedia = await productIdentity.verifyProductContract({
    taskId: 'workspace-product-no-media',
    ctx: { product_subject: '只有文字的商品' },
    gateway: { async generateVision() { visionCalls += 1; throw new Error('无素材不得调用视觉模型'); } },
    repair: { async parseOrRepair() { throw new Error('无素材不得进入解析'); } },
  });
  assert.equal(noMedia.status, 'not_applicable');
  assert.equal(visionCalls, 1, '没有商品媒体时必须保持零新增视觉调用');

  let malformedVisionCalls = 0;
  let malformedTextCalls = 0;
  const malformed = await productIdentity.verifyProductContract({
    taskId: 'workspace-product-malformed-json',
    ctx: {
      product_subject: '异常 JSON 商品',
      product_asset: { id: 'malformed-product', type: 'product', image_url: 'https://example.com/malformed-product.png' },
    },
    gateway: {
      async generateVision() {
        malformedVisionCalls += 1;
        return { text: 'not valid json at all', used_model: 'test/vision' };
      },
      async generateText() {
        malformedTextCalls += 1;
        return { text: '{}' };
      },
    },
  });
  assert.equal(malformedVisionCalls, 1, '异常 JSON 路径仍只允许一次视觉调用');
  assert.equal(malformedTextCalls, 0, '商品验证 JSON 异常不得自动追加文本模型修复调用');
  assert.equal(malformed.status, 'unverified');
  assert.equal(malformed.verification_error_code, 'VISION_QA_SCHEMA_INVALID');
}

function testSceneCameraProjection() {
  const projectedViews = [
    { key: 'master', image_url: '/master.png' },
    { key: 'reverse', image_url: '/reverse.png' },
    { key: 'interaction', image_url: '/interaction.png' },
    { key: 'detail', image_url: '/detail.png' },
    { key: 'layout', image_url: '/layout-view.png' },
  ];
  assert.equal(bundles.projectSceneCamera({
    id: 'cam-explicit', view_id: 'master', reference_image_url: '/master-explicit.png',
  }, projectedViews).image_url, '/master-explicit.png', '机位自带 reference_image_url 必须优先');
  assert.equal(bundles.projectSceneCamera({ id: 'cam-fallback', view_id: 'reverse' }, projectedViews).image_url, '/reverse.png');
  assert.equal(bundles.projectSceneCamera({ id: 'cam-missing', view_id: 'missing' }, projectedViews).image_url, '');
  assert.equal(bundles.projectSceneCamera({ id: 'cam-layout', view_id: 'layout' }, projectedViews).image_url, '', '机位不得借用 layout 图');
  const movingCamera = bundles.projectSceneCamera({ id: 'cam-move', movement: '从入口缓慢推进至展示墙', duration_sec: 4 }, projectedViews);
  assert.equal(movingCamera.movement, '从入口缓慢推进至展示墙');
  assert.equal(movingCamera.duration, 4);

  const taskId = createTask('场景机位图片投影', '空间产品');
  const context = storage.getOutput(taskId, 'context');
  storage.saveOutput(taskId, 'context', context);
  storage.saveOutput(taskId, 'scene_config', {
    scene_mode: 'single',
    spaces: [{ id: 'scene-room', name: '测试空间', scene_spec: {
      layoutText: '入口、主体区和背景形成连续空间边界',
      materialLightText: '暖灰石材与拉丝金属，左侧窗光配合顶部柔光',
      interactionText: '人物从入口走向主体展示区',
      negativeText: '禁止改变空间边界和主要材质',
    } }],
  });
  storage.saveOutput(taskId, 'scene_assets', [{
    id: 'scene-room',
    scene_id: 'scene-room',
    name: '测试空间',
    image_url: '/master.png',
    view_images: projectedViews,
    scene_contract: {
      status: 'verified',
      layout_contract: { status: 'available', reference_image_url: '/layout-contract.png' },
      cameras: [
        { id: 'cam-master', view_id: 'master', reference_image_url: '/master.png' },
        { id: 'cam-reverse', view_id: 'reverse' },
        { id: 'cam-interaction', view_id: 'interaction' },
        { id: 'cam-missing', view_id: 'missing' },
      ],
    },
  }]);

  const bundle = bundles.buildProjectBundle(taskId, { sections: 'assets', user });
  const scene = bundle.assets.scenes[0];
  assert(scene.scene_spec.materialLightText.startsWith('暖灰石材与拉丝金属，左侧窗光配合顶部柔光'), '项目投影必须原样保留用户提供的 materialLightText 前缀');
  assert.match(scene.scene_spec.materialLightText, /AI补齐：/, '不完整的材质光线合同必须追加可核验的物理一致性约束');
  assert(scene.scene_spec.layoutText.startsWith('入口、主体区和背景形成连续空间边界'));
  assert.match(scene.scene_spec.layoutText, /AI补齐：/, '不完整的空间布局合同必须追加可拍摄的区域与纵深关系');
  assert.equal(scene.scene_spec.materials, scene.scene_spec.materialLightText, '兼容展示字段不得丢失组合材质光线合同');
  assert.equal(scene.scene_spec.light, scene.scene_spec.materialLightText, '兼容展示字段不得丢失组合材质光线合同');
  assert.equal(scene.cameras.length, 4);
  assert.equal(scene.cameras[0].image_url, '/master.png');
  assert.equal(scene.cameras[1].image_url, '/reverse.png', '缺少显式图片时必须按稳定 view_id 回退');
  assert.equal(scene.cameras[2].image_url, '/interaction.png');
  assert.equal(scene.cameras[3].image_url, '/detail.png');
  assert.equal(scene.layout.image_url, '/layout-view.png', '本地化后的 layout 必须保持独立来源');
}

function testHumanFacingSemanticProjection() {
  const taskId = storyAd.createTask({
    project_name: '中文语义投影',
    brief: '人物在完整空间中展示不锈钢背景墙，并用旧钢板做对比。',
    product_subject: '不锈钢材料',
    cast_mode: 'single',
    expected_people: 1,
  }, user).task.id;
  const context = storage.getOutput(taskId, 'context');
  storage.saveOutput(taskId, 'context', {
    ...context,
    person_asset: {
      id: 'person-semantic',
      dossier_sheet: { image_url: '/dossier.png', layout: 'reference_character_dossier_v4' },
      view_images: [{ key: 'front', image_url: '/front.png' }],
      expressions: [{ key: 'neutral', label: 'neutral', image_url: '/neutral.png' }, { key: 'natural_smile', image_url: '/smile.png' }],
      accessory_details: [{ key: 'shoes', label: 'shoes', image_url: '/shoes.png' }],
      wardrobe_details: { items: [{ key: 'fabric_drape', label: '面料光泽与垂坠', image_url: '/fabric.png' }] },
    },
  });
  const bundle = bundles.buildProjectBundle(taskId, { sections: 'summary,assets', user });
  assert.deepEqual(bundle.assets.people[0].expressions.map(item => item.label), ['自然平静', '自然微笑']);
  assert.equal(bundle.assets.people[0].accessory_details[0].label, '鞋履细节');
  assert.equal(bundle.assets.people[0].wardrobe_details[0].label, '面料光泽与垂坠');
  assert.match(bundle.brief.benchmark_strategy.opening_hook, /完整空间|旧方案/);
  assert.match(bundle.brief.benchmark_strategy.prompt_method, /摄影机轨迹/);
}

function graphFixture() {
  const longBrief = `这是超过二百二十字的完整广告需求，必须在详情中保留。${'剧情信息与商品约束。'.repeat(50)}`;
  const longVisual = `这是完整镜头视觉正文。${'人物沿着既定路线移动，场景和商品状态保持连续。'.repeat(35)}`;
  return {
    project: { id: 'graph-detail-task' },
    brief: {
      text: longBrief,
      product_subject: '测试商品',
      target_duration: 30,
      output_ratio: '9:16',
    },
    assets: {},
    story: {
      blueprint: {
        story_title: '完整剧情',
        logline: '人物通过一次真实体验理解商品价值。',
        summary: '从问题建立、体验过程到结果证明的完整叙事。',
        beats: [
          { title: '问题建立', content: '人物遇到明确问题。', purpose: '建立动机。' },
          { title: '结果证明', action: '人物完成体验。', voiceover: '结果自然证明商品价值。' },
        ],
      },
    },
    story_flow: {
      contract: { status: 'confirmed', units: [{ beat_id: 'beat-1', beat_index: 1, title: '体验流向', action: '人物进入场景并完成体验', state_before: '场景外', state_after: '完成体验', character_ids: ['cast-linyue'], scene_id: 'scene-room' }] },
    },
    storyboard: {
      shots: [{
        shot_id: 'SH01',
        source_beat_id: 'beat-1',
        shot_index: 1,
        title: '体验商品',
        visual: longVisual,
        action: '人物走到商品前并完成一次明确操作。',
        narration: '旁白说明操作带来的真实变化。',
        dialogue_lines: [{ speaker: '林悦', text: '这个变化很清楚。' }],
        purpose: '用动作和结果证明卖点。',
        scene_id: 'scene-room',
        camera_id: 'cam-master',
        character_ids: ['cast-linyue'],
        duration: 5,
        transition_from: 'scene-outside',
        transition_type: 'match_cut',
        transition_duration_sec: 0.4,
        transition_reason: '保持动作方向连续。',
      }],
      images: [{ shot_id: 'SH01', shot_index: 1, image_url: '/storyboard-sh01.png' }],
    },
    generation: {
      keyframes: [
        { shot_index: 1, status: 'failed' },
        { shot_index: 1, status: 'blocked' },
      ],
      clips: [{ shot_index: 1, status: 'queued' }],
    },
  };
}

function testGraphStructuredDetailsAndStableIds() {
  const fixture = graphFixture();
  const graph = graphs.projectGraph(fixture);
  const repeated = graphs.projectGraph(fixture);
  const brief = graph.nodes.find(node => node.type === 'brief');
  assert.equal(brief.subtitle.length, 220, '卡片摘要继续受 220 字限制');
  assert(brief.detail.full_text.length > 220, 'brief 详情不得复用摘要截断');
  assert.equal(brief.detail.product_subject, '测试商品');
  assert.equal(brief.detail.duration, 30);
  assert.equal(brief.detail.ratio, '9:16');

  const story = graph.nodes.find(node => node.type === 'story');
  assert.equal(story.detail.beats.length, 2);
  assert.equal(story.detail.beats[0].title, '问题建立');
  assert(story.detail.beats[0].content.includes('建立动机'));
  assert(story.detail.beats[1].content.includes('结果自然证明商品价值'));

  const shot = graph.nodes.find(node => node.type === 'shot');
  assert(shot.detail.visual.length > 220, 'shot 视觉正文不得被卡片摘要截断');
  assert.equal(shot.detail.action, '人物走到商品前并完成一次明确操作。');
  assert.equal(shot.detail.narration, '旁白说明操作带来的真实变化。');
  assert.deepEqual(shot.detail.dialogue_lines, [{ speaker: '林悦', text: '这个变化很清楚。' }]);
  assert.equal(shot.detail.bindings.scene_id, 'scene-room');
  assert.equal(shot.detail.bindings.camera_id, 'cam-master');
  assert.deepEqual(shot.detail.bindings.character_ids, ['cast-linyue']);
  assert.equal(shot.detail.transition.type, 'match_cut');
  assert.equal(shot.media_url, '/storyboard-sh01.png', '人物场景分镜图必须成为对应 shot 节点媒体');
  const flowNode = graph.nodes.find(node => node.type === 'story_flow');
  assert.equal(flowNode.media_url, '', '剧情流向确认是零费用结构化节点，不得继续展示或消费旧流向图片');
  assert.equal(flowNode.detail.model_call_count, 0);
  assert(graph.edges.some(edge => edge.source === flowNode.id && edge.target === shot.id && edge.kind === 'directs'));

  const keyframes = graph.nodes.filter(node => node.type === 'keyframe');
  const repeatedKeyframes = repeated.nodes.filter(node => node.type === 'keyframe');
  assert.equal(keyframes.length, 2);
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, graph.nodes.length, 'graph node id 必须全局唯一');
  assert.deepEqual(keyframes.map(node => node.id), repeatedKeyframes.map(node => node.id), '重复 keyframe ID 修复必须跨投影稳定');
  assert.equal(keyframes[0].id, 'keyframe:1', '第一个 keyframe 保留历史稳定 ID');
  assert.notEqual(keyframes[1].id, 'keyframe:1');
  const clip = graph.nodes.find(node => node.type === 'clip');
  assert(graph.edges.some(edge => edge.source === keyframes[0].id && edge.target === clip.id && edge.kind === 'animates'));

  const duplicateFixture = graphFixture();
  duplicateFixture.storyboard.shots.push({ ...duplicateFixture.storyboard.shots[0], shot_id: 'SH01-duplicate' });
  duplicateFixture.generation.clips.push({ shot_index: 1, status: 'failed', id: 'clip-duplicate' });
  const duplicateGraph = graphs.projectGraph(duplicateFixture);
  assert.equal(new Set(duplicateGraph.nodes.map(item => item.id)).size, duplicateGraph.nodes.length, '重复 shot、clip 与 keyframe 均不得产生重复节点 ID');
  assert.equal(new Set(duplicateGraph.edges.map(item => item.id)).size, duplicateGraph.edges.length, '重复关系必须收敛为唯一边');

  const largeFixture = graphFixture();
  const longField = '大型项目正文与连续性约束。'.repeat(800);
  largeFixture.storyboard.shots = Array.from({ length: 200 }, (_, index) => ({
    ...largeFixture.storyboard.shots[0],
    shot_id: `SH${index + 1}`,
    shot_index: index + 1,
    title: `大型镜头 ${index + 1}`,
    visual: longField,
    action: longField,
    narration: longField,
    dialogue_lines: Array.from({ length: 30 }, (__, lineIndex) => ({ speaker: `角色${lineIndex}`, text: longField })),
    purpose: longField,
    transition_reason: longField,
    transition_match_anchor: longField,
  }));
  largeFixture.storyboard.images = [];
  largeFixture.generation = { keyframes: [], clips: [] };
  const largeGraphBytes = Buffer.byteLength(JSON.stringify(graphs.projectGraph(largeFixture)));
  assert(largeGraphBytes < 3 * 1024 * 1024, `200 镜工作流投影必须小于 3 MiB，实际 ${largeGraphBytes} bytes`);
}

async function main() {
  testProductResolverAndProjection();
  await testProductVerificationCallBoundary();
  testSceneCameraProjection();
  testHumanFacingSemanticProjection();
  testGraphStructuredDetailsAndStableIds();
  console.log('story-ad workspace backend projection tests: 57 checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
