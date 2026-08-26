#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { sceneAssets } = require('../src/services/storyAdWorkspace/projectBundleService');
const sceneSpace = require('../src/services/newStoryAd/sceneSpaceContractService');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function fixtureScene(id, suffix, options = {}) {
  const keys = options.keys || ['master', 'reverse', 'interaction', 'detail', 'layout'];
  return {
    scene_id: id,
    name: `场景${suffix}`,
    view_images: keys.map(key => ({ key, image_url: `/${suffix}-${key}.png` })),
    failed_view_keys: options.failed || [],
    requested_prop_placements: [{ id: `prop-${suffix}`, label: `道具${suffix}`, detail: `只属于${suffix}` }],
    surface_topology: { mode: 'segmented', notes: `表面${suffix}` },
    material_contract: { primary: `材质${suffix}` },
    scene_contract: {
      full_space_lock: options.locked !== false,
      anchors: [`锚点${suffix}`],
      geometry_facts: [`几何${suffix}`],
      materials: [`材质证据${suffix}`],
      lighting: { direction: `灯光${suffix}` },
      layout_contract: { reference_image_url: `/${suffix}-layout.png` },
      requirement_qa: { pass: options.locked !== false, mismatch_reasons: options.locked === false ? [`冲突${suffix}`] : [] },
      cross_view_qa: { pass: options.locked !== false },
    },
  };
}

function testProjectionAndIsolation() {
  const outputs = {
    scene_config: {
      spaces: [
        { id: 'scene-a', name: '场景A', story_purpose: '用途A', scene_spec: { layoutText: '布局A', materialLightText: '材质光线A' } },
        { id: 'scene-b', name: '场景B', story_purpose: '用途B', scene_spec: { layoutText: '布局B', materialLightText: '材质光线B' } },
      ],
    },
    scene_assets: [fixtureScene('scene-a', 'a'), fixtureScene('scene-b', 'b', { keys: ['master', 'reverse', 'detail'], failed: ['interaction'], locked: false })],
    storyboard_table: [
      { shot_id: 'SH-A', scene_id: 'scene-a' },
      { shot_id: 'SH-B', scene_id: 'scene-b' },
    ],
  };
  const scenes = sceneAssets(outputs, {});
  assert.equal(scenes.length, 2);
  assert.deepEqual(scenes[0].scene_card.view_order, ['master', 'reverse', 'interaction', 'detail', 'layout']);
  assert.equal(scenes[0].scene_card.schema_version, 1);
  assert(scenes[0].scene_card.anchors.some(row => row.label.includes('锚点a')), '字符串证据必须保留原文');
  assert(scenes[0].scene_card.geometry_facts.some(row => row.label.includes('几何a')));
  assert(scenes[0].scene_card.prop_placements.some(row => row.label === '道具a'));
  assert(scenes[0].scene_card.materials.some(row => row.label.includes('材质证据a')));
  assert(scenes[0].scene_card.lighting.some(row => row.detail === '灯光a' || row.label === '灯光a'));
  assert(!scenes[0].scene_card.lighting.some(row => /color_temperature|fixtures|notes/.test(row.label)), '空技术字段不得作为用户资产展示');
  assert(scenes[0].scene_card.surface_topology.some(row => /表面a|segmented/.test(`${row.label}${row.detail}`)));
  assert(scenes[0].scene_card.qa_checks.some(row => row.label === '空间锁' && row.pass === true));
  assert(scenes[1].scene_card.qa_checks.some(row => row.label === '空间锁' && row.pass === false));
  assert.deepEqual(scenes[0].shot_refs, ['SH-A']);
  assert.deepEqual(scenes[1].shot_refs, ['SH-B']);
  assert(!JSON.stringify(scenes[0]).includes('只属于b'), '多场景资产不得串用');
  assert(!JSON.stringify(scenes[1]).includes('只属于a'), '多场景资产不得串用');
  assert.deepEqual(scenes[1].failed_view_keys, ['interaction']);
  assert.match(scenes[0].generation_prompt, /场景：场景A[\s\S]*空间结构：布局A[\s\S]*视觉风格：/, '场景卡必须直接提供可核对的结构化生图提示词');
  assert.equal(scenes[0].generation_prompt_source, 'scene_plan_compiled');
}

function testSceneContractIdempotence() {
  const contract = sceneSpace.normalizeContract({
    scene_id: 'scene-idempotent',
    requested_story_states: [{ id: 'state-1' }],
    requested_interaction_anchors: [{ id: 'anchor-1' }],
    requested_routes: [{ id: 'route-1' }],
    requested_prop_placements: [{ id: 'prop-1', label: '固定道具' }],
    anchors: ['入口'],
  }, { sceneId: 'scene-idempotent', views: [] });
  const normalizedAgain = sceneSpace.normalizeContract(contract, { sceneId: 'scene-idempotent', views: [] });
  assert.deepEqual(normalizedAgain.requested_story_states, contract.requested_story_states);
  assert.deepEqual(normalizedAgain.requested_interaction_anchors, contract.requested_interaction_anchors);
  assert.deepEqual(normalizedAgain.requested_routes, contract.requested_routes);
  assert.deepEqual(normalizedAgain.requested_prop_placements, contract.requested_prop_placements, '场景合同重复规范化不得丢失道具摆放');
}

function testUiAndExportBoundaries() {
  const card = read('public/story-ad/views/sceneDossierCard.js');
  const exporter = read('public/story-ad/views/sceneDossierExport.js');
  const assetCenter = read('public/story-ad/views/assetCenterView.js');
  const sceneWorldPage = read('public/story-ad/views/sceneWorldPage.js');
  const scenePromptPreview = read('public/story-ad/views/scenePromptPreview.js');
  const scenePromptEditor = read('public/story-ad/views/scenePromptEditor.js');
  const details = read('public/story-ad/views/assetCenterPlanningDetails.js');
  const world = read('public/story-ad/views/sceneWorldView.js');
  const api = read('public/story-ad/api.js');
  const css = read('public/story-ad/scene-dossier.css');
  const html = read('public/story-ad/index.html');

  assert(card.includes("['master', 'reverse', 'interaction', 'detail', 'layout']"), '场景档案必须固定五类证据槽位');
  assert(card.includes('usedUrls.has(url)') && card.includes('没有使用其他视图冒充'), '同一图片不得跨槽复用');
  assert(card.includes("import('./sceneDossierExport.js"), '高清导出必须按需加载');
  assert(assetCenter.includes("group === 'scenes' ? sceneDetail") && sceneWorldPage.includes('renderSceneWorldWorkspace(bundle)'), '场景摘要与场景世界必须同时存在，并由独立场景流程承载');
  assert(!assetCenter.includes('data-generate-scene='), '资产中心不得继续保留场景生成入口');
  const sceneWorldModules = `${sceneWorldPage}\n${scenePromptPreview}`;
  assert(sceneWorldModules.includes('data-generate-scene=') && sceneWorldModules.includes('data-scene-detail-tab="prompt"'), '场景生成与提示词核对必须归属场景页模块');
  assert.match(scenePromptPreview, /generationStarted \? 'images' : 'prompt'/u, '未生图场景默认提示词，已有或生成中的场景默认画面');
  assert.match(scenePromptPreview, /data-default-scene-tab/u, '场景卡必须显式投影默认标签页');
  assert.match(scenePromptPreview, /data-scene-prompt-editor=/u, '正式场景提示词必须提供可编辑文本区');
  assert.doesNotMatch(scenePromptPreview, /data-save-scene-prompt=|data-confirm-scene-prompt=/u, '场景提示词不得再要求显式保存或确认');
  assert.match(scenePromptEditor, /bindTextAutosave/u, '场景提示词必须自动保存到服务端权威版本');
  assert(details.includes('renderSceneDossierCard(item)') && details.includes('bindSceneDossierCard(drawer, item)'), '完整档案必须在场景抽屉内渲染并绑定');
  assert(details.includes("event.key === 'Escape'") && details.includes('returnFocus?.focus?.()'), '抽屉必须支持 Escape 与焦点恢复');
  assert(api.indexOf("options.responseType === 'blob'") < api.indexOf('const text = await response.text()'), '原图读取必须走受版本保护的 Blob 请求');
  assert(exporter.includes('const WIDTH = 1800') && exporter.includes('const HEIGHT = 2400'));
  assert(exporter.includes("request(url, { responseType: 'blob'") && exporter.includes('model_call_count: 0'));
  assert(!/generate(?:Image|Vision|Text)|runStage\(|fetch\([^)]*\/generate/i.test(exporter), '本地导出不得触发生成或任务阶段');
  assert(world.includes('data-plan-scene-experience') && world.includes('data-world-mode="panorama"'), '可选的3D/360规划与查看入口不得被场景档案替换');
  assert(!world.includes('data-generate-panorama'), '场景世界不得绕过统一制作图谱恢复旧的单项全景付费入口');
  assert(css.includes('@media(max-width:820px)') && css.includes('.drawer.is-scene-drawer{width:100vw'), '移动端场景抽屉必须使用完整视口宽度');
  assert(html.includes('/story-ad/scene-dossier.css'));
}

testProjectionAndIsolation();
testSceneContractIdempotence();
testUiAndExportBoundaries();
console.log(JSON.stringify({ passed: true, projection_scenes: 2, fixed_view_slots: 5, export: '1800x2400', model_calls: 0 }));
