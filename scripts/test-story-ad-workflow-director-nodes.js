#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const graphProjection = require('../src/services/storyAdWorkspace/graphProjectionService');

async function loadModule() {
  const file = path.join(__dirname, '..', 'public', 'story-ad', 'views', 'workflowDirectorNodes.js');
  const source = fs.readFileSync(file, 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function baseGraph(shotCount = 1) {
  const shots = Array.from({ length: shotCount }, (_, index) => ({
    id: `shot:${index + 1}`, type: 'shot', group: 'shots', title: `镜头 ${index + 1}`, status: 'ready',
    position: { x: 1460, y: 80 + index * 190 }, detail: { shot_index: index + 1, bindings: { scene_id: 'world-generic' } },
  }));
  const clips = Array.from({ length: shotCount }, (_, index) => ({
    id: `clip:${index + 1}`, type: 'clip', group: 'media', title: `视频 ${index + 1}`, status: 'ready',
    position: { x: 1940, y: 80 + index * 190 }, detail: { shot_index: index + 1 },
  }));
  return {
    revision: 7,
    nodes: [
      { id: 'reference:analysis-1', type: 'reference', group: 'input', title: '参考素材', position: { x: 60, y: 80 }, detail: {} },
      { id: 'person:person-1', type: 'person', group: 'assets', title: '人物', position: { x: 520, y: 80 }, detail: { revision: 3 } },
      { id: 'product:product-1', type: 'product', group: 'assets', title: '主体', position: { x: 520, y: 270 }, detail: { revision: 4 } },
      { id: 'scene:world-generic', type: 'scene', group: 'assets', title: '场景', position: { x: 520, y: 460 }, detail: { revision: 5 } },
      ...shots,
      ...clips,
    ],
    edges: [],
    clusters: [],
    stats: {},
  };
}

function bundle(overrides = {}) {
  return {
    project: { id: 'task-generic' },
    reference: { analysis_id: 'analysis-1', revision: 6, status: 'completed', confirmation_status: 'confirmed', confirmed_revision: 6 },
    assets: {
      people: [{ id: 'person-1', revision: 3 }],
      products: [{ id: 'product-1', revision: 4 }],
      scenes: [{ id: 'world-generic', revision: 5 }],
    },
    scene_worlds: [{ id: 'world-generic', name: '通用空间', revision: 5, source_asset: { id: 'world-generic', source_revision: 2 } }],
    director_scenes: [{
      director_scene_id: 'director:world-generic', world_id: 'world-generic', revision: 8, world_revision: 5,
      source_revision: 2, status: 'active_verified', compatibility_status: 'current',
      entity_refs: [
        { entity_id: 'person-1', entity_revision: 3, kind: 'person' },
        { entity_id: 'product-1', entity_revision: 4, kind: 'product' },
      ],
      camera_count: 2, path_count: 1, snapshot_count: 1,
    }],
    ...overrides,
  };
}

async function main() {
  const module = await loadModule();
  const graph = baseGraph(2);
  const original = JSON.stringify(graph);
  const projected = module.projectWorkflowDirectorNodes(graph, bundle());

  const serverGraph = graphProjection.projectGraph({
    project: { id: 'task-generic' },
    brief: { text: '任意行业均可使用的完整故事目标' },
    reference: {
      analysis_id: 'analysis-1', status: 'completed',
      reference_understanding: { contract_version: 'reference-understanding-v6', story_summary: { short_synopsis: '完整故事摘要' }, causal_chain: [{ id: 'event-1' }], characters: [], scenes: [{ scene_id: 'world-generic' }], unknowns: [] },
      understanding_confirmation: { status: 'confirmed', ready: true },
    },
    assets: bundle().assets,
    scene_worlds: bundle().scene_worlds,
    director_scenes: bundle().director_scenes,
    storyboard: { shots: [{ shot_index: 1, scene_id: 'world-generic', title: '通用镜头' }], sketches: [] },
    generation: { keyframes: [], clips: [{ shot_index: 1, status: 'ready' }] },
  });
  const serverUnderstanding = serverGraph.nodes.find(node => node.type === 'reference_understanding');
  const serverDirector = serverGraph.nodes.find(node => node.type === 'director_scene');
  const serverAnimation = serverGraph.nodes.find(node => node.type === 'director_animation');
  assert(serverUnderstanding && serverDirector && serverAnimation, '服务端图谱必须权威投影参考理解、导演台和导演动画');
  assert.deepStrictEqual(Object.keys(serverDirector.detail.entity_refs[0]).sort(), ['entity_id', 'entity_revision', 'kind']);
  assert(!('entities' in serverDirector.detail) && !('cameras' in serverDirector.detail) && !('paths' in serverDirector.detail));
  assert(serverGraph.edges.some(edge => edge.source === serverDirector.id && edge.target === 'shot:1' && edge.kind === 'directs'));
  assert(serverGraph.edges.some(edge => edge.source === serverAnimation.id && edge.target === 'clip:1' && edge.kind === 'drives_motion'));

  assert.strictEqual(JSON.stringify(graph), original, '投影不得修改服务端原图对象');
  assert(projected.nodes.some(node => node.type === 'reference_understanding'), '参考素材应升级为参考理解节点');
  const director = projected.nodes.find(node => node.type === 'director_scene');
  const animation = projected.nodes.find(node => node.type === 'director_animation');
  assert(director && animation, '应投影导演台与导演动画节点');
  assert.deepStrictEqual(Object.keys(director.detail.entity_refs[0]).sort(), ['entity_id', 'entity_revision', 'kind'], '导演引用不能复制人物正文');
  assert(!('entities' in director.detail) && !('cameras' in director.detail) && !('paths' in director.detail), '节点只保存引用、revision和计数');
  assert.strictEqual(director.detail.revision, 8);
  assert.strictEqual(director.detail.sync_status, 'current');
  assert.strictEqual(animation.detail.director_revision, 8);
  assert(projected.edges.some(edge => edge.source === 'person:person-1' && edge.target === director.id && edge.kind === 'stages'));
  assert(projected.edges.some(edge => edge.source === 'scene:world-generic' && edge.target === director.id && edge.kind === 'stages'));
  assert(projected.edges.some(edge => edge.source === director.id && edge.target === 'shot:1' && edge.kind === 'directs'));
  assert(projected.edges.some(edge => edge.source === animation.id && edge.target === 'clip:1' && edge.kind === 'drives_motion'));
  assert.strictEqual(projected.nodes.find(node => node.id === 'clip:1').position.x, 2480, '仅默认媒体列应为导演列留出空间');

  const contracts = module.workflowNodeContracts('director_scene');
  assert.deepStrictEqual(contracts.inputs.map(item => item.contract), ['SceneReference', 'PersonReference', 'ProductReference']);
  assert.deepStrictEqual(contracts.outputs.map(item => item.contract), ['DirectorScene', 'ShotReferencePack']);
  const panel = module.workflowNodePanelMarkup(director);
  assert(panel.includes('data-open-workflow-director="world-generic"'));
  assert(panel.includes('ShotReferencePack'));
  assert(!panel.includes('<script>'));

  const staleBundle = bundle({
    assets: { people: [{ id: 'person-1', revision: 9 }], products: [{ id: 'product-1', revision: 4 }], scenes: [{ id: 'world-generic', revision: 6 }] },
    scene_worlds: [{ id: 'world-generic', name: '任意行业空间', revision: 6, source_asset: { id: 'world-generic', source_revision: 3 } }],
  });
  const stale = module.projectWorkflowDirectorNodes(baseGraph(), staleBundle).nodes.find(node => node.type === 'director_scene');
  assert.strictEqual(stale.status, 'stale');
  assert.strictEqual(stale.detail.stale_refs.length, 1);
  assert.strictEqual(stale.detail.stale_world, true);
  assert(module.workflowNodePanelMarkup(stale).includes('视频生成不会静默使用旧版本'));

  const conflictBundle = bundle({ director_scenes: [{
    director_scene_id: 'director:world-generic', world_id: 'world-generic', revision: 9, world_revision: 5,
    status: 'draft', compatibility_status: 'conflict', entity_refs: [],
  }] });
  const conflict = module.projectWorkflowDirectorNodes(baseGraph(), conflictBundle).nodes.find(node => node.type === 'director_scene');
  assert.strictEqual(conflict.status, 'conflict');
  assert(module.workflowNodePanelMarkup(conflict).includes('当前草稿不会静默覆盖'));

  const fallback = module.projectWorkflowDirectorNodes(baseGraph(), { ...bundle(), director_scenes: undefined });
  const fallbackDirector = fallback.nodes.find(node => node.type === 'director_scene');
  assert.deepStrictEqual(fallbackDirector.detail.entity_refs.map(item => item.entity_id).sort(), ['person-1', 'product-1']);

  const twice = module.projectWorkflowDirectorNodes(projected, bundle());
  assert.strictEqual(twice.nodes.filter(node => node.type === 'director_scene').length, 1, '重复投影不能新增重复导演节点');
  assert.strictEqual(new Set(twice.edges.map(edge => edge.id)).size, twice.edges.length, '重复投影不能新增重复连线');

  const serverProjected = baseGraph();
  serverProjected.nodes.push({
    id: 'director:world-generic', type: 'director_scene', group: 'director', title: '权威导演台', position: { x: 1460, y: 80 },
    detail: { director_scene_id: 'director:world-generic', world_id: 'world-generic', revision: 8, world_revision: 5, entity_refs: [] },
  }, {
    id: 'director-animation:world-generic', type: 'director_animation', group: 'director', title: '权威导演动画', position: { x: 1460, y: 270 },
    detail: { world_id: 'world-generic', director_revision: 8, path_count: 1 },
  });
  serverProjected.edges.push({ id: 'director:world-generic:animates:director-animation:world-generic', source: 'director:world-generic', target: 'director-animation:world-generic', kind: 'animates' });
  const compatible = module.projectWorkflowDirectorNodes(serverProjected, bundle());
  assert.strictEqual(compatible.nodes.filter(node => node.type === 'director_animation').length, 1, '服务端权威动画节点不能被兼容层重复投影');
  assert.strictEqual(compatible.edges.filter(edge => edge.source === 'director:world-generic' && edge.target === 'director-animation:world-generic').length, 1, '服务端权威导演连线不能重复');

  const largeGraph = baseGraph(120);
  const started = process.hrtime.bigint();
  const large = module.projectWorkflowDirectorNodes(largeGraph, bundle());
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.strictEqual(large.nodes.filter(node => node.type === 'shot').length, 120);
  assert.strictEqual(large.edges.filter(edge => edge.kind === 'directs').length, 120);
  assert(elapsedMs < 500, `120镜投影耗时异常：${elapsedMs.toFixed(2)}ms`);

  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'story-ad', 'views', 'workflowDirectorNodes.js'), 'utf8');
  ['汽车', '美妆', '家居', '餐饮', '房地产'].forEach(keyword => assert(!source.includes(keyword), `不应写死行业：${keyword}`));
  console.log(JSON.stringify({ success: true, checks: 37, nodes_120: large.nodes.length, edges_120: large.edges.length, projection_ms: Number(elapsedMs.toFixed(2)), server_projection: true }));
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
