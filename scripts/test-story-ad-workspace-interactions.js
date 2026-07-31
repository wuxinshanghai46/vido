#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-story-ad-interactions-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd');
const bundles = require('../src/services/storyAdWorkspace/projectBundleService');

const user = { id: 'interaction-owner', role: 'user' };

function sceneViews() {
  return [
    { key: 'master', label: '主视角', image_url: '/interior-master.png' },
    { key: 'reverse', label: '反向视角', image_url: '/interior-reverse.png' },
    { key: 'interaction', label: '互动位', image_url: '/interior-interaction.png' },
    { key: 'detail', label: '材质细节', image_url: '/interior-detail.png' },
    { key: 'layout', label: '俯视布局', image_url: '/layout.png' },
  ];
}

function sceneContract() {
  const views = sceneViews();
  return {
    schema_version: 6,
    status: 'verified',
    full_space_lock: true,
    space_lock_status: 'complete',
    verification: { state: 'verified', reasons: [] },
    layout_contract: { required: true, status: 'available', reference_image_url: '/layout.png' },
    zones: [{ id: 'zone-window', label_zh: '全景窗互动区', purpose: '人物演示推拉窗' }],
    cameras: views.filter(view => view.key !== 'layout').map((view, index) => ({
      id: `cam-${view.key}`, view_id: view.key, label: view.label,
      role: { master: '建立空间关系', reverse: '验证背向空间', interaction: '验证动作区', detail: '验证关键材质' }[view.key],
      framing: view.key === 'detail' ? '近景特写' : '广角全景',
      lens_class: view.key === 'detail' ? '50-85mm detail' : '24-35mm wide',
      height_class: view.key === 'detail' ? 'surface_level' : 'eye_level',
      orientation: `${view.key} camera direction`, estimated_azimuth_degrees: [20, 130, 75, 70][index],
      estimated_pitch_degrees: [2, 1, 0, -12][index], azimuth_delta_from_master_degrees: view.key === 'reverse' ? 110 : null,
      normalized_position: [[0.1, 0.8], [0.82, 0.25], [0.32, 0.68], [0.5, 0.55]][index],
      look_at: [[0.6, 0.4], [0.42, 0.58], [0.58, 0.48], [0.57, 0.5]][index],
      position_confidence: 0.9, target_description: `${view.key} target`, allowed_zone_ids: ['zone-window'],
      requirement_refs: view.key === 'interaction' ? ['interaction'] : ['layout'],
      visible_evidence: `${view.key} visible evidence`, pass: true, mismatch_reasons: [],
    })),
    requirement_qa: { pass: true, layout_match_score: 0.96, material_light_match_score: 0.96, interaction_match_score: 0.95, surface_topology_match_score: 0.96, negative_compliance_score: 0.98, mismatch_reasons: [] },
    cross_view_qa: { pass: true, scene_consistency_score: 0.97, geometry_consistency_score: 0.96, material_consistency_score: 0.97, mismatch_reasons: [] },
    spatial_coverage_qa: { pass: true, coverage_score: 0.96, layout_topology_score: 0.96, camera_diversity_score: 0.95, reverse_coverage_score: 0.95, interaction_zone_score: 0.95, reasons: [] },
    camera_design_qa: { pass: true, role_definition_score: 0.95, requirement_mapping_score: 0.94, direction_evidence_score: 0.92, parameter_completeness_score: 0.96, layout_mapping_score: 0.91, mismatch_reasons: [] },
    photographic_realism_qa: { pass: true, photographic_realism_score: 0.93, physical_material_score: 0.92, natural_variation_score: 0.9, optical_capture_score: 0.91, real_photo_evidence: ['natural optical falloff'], synthetic_signals: [], mismatch_reasons: [] },
  };
}

function main() {
  const created = storyAd.createTask({
    project_name: '用户命名的全景窗广告',
    brief: '制作一支展示全景窗采光与推拉体验的家庭剧情广告。',
    product_subject: '新标门窗',
    cast_mode: 'no_human',
  }, user);
  const taskId = created.task.id;
  assert.equal(created.task.title, '用户命名的全景窗广告', '创建时必须使用用户项目名称');
  assert.equal(created.context.project_name, '用户命名的全景窗广告');

  storyAd.updateTaskRequest(taskId, {
    brief: '更新广告目标但不应该改项目名称。',
    product_subject: '另一个产品主题',
    base_content_revision: 1,
    client_edit_seq: 1,
  }, user);
  assert.equal(storage.getTask(taskId).title, '用户命名的全景窗广告', '无关保存不得改写项目名称');

  const renamed = storyAd.updateTaskRequest(taskId, {
    project_name: '用户重新命名的项目',
    base_content_revision: storage.getTask(taskId).content_revision,
    client_edit_seq: 2,
  }, user);
  assert.equal(storage.getTask(taskId).title, '用户重新命名的项目');
  assert.equal(renamed.context.project_name, '用户重新命名的项目');

  const context = storage.getOutput(taskId, 'context');
  storage.saveOutput(taskId, 'context', {
    ...context,
    assets: [{ id: 'scene-reference-loose', role: 'scene_reference', name: '用户上传的客厅参考', image_url: '/loose-reference.png' }],
    person_asset: {
      id: 'person-dossier', actor_id: 'cast-dossier', name: '林悦', cover_image_url: '/dossier.png',
      dossier_sheet: { image_url: '/dossier.png' },
      category_atlases: [{ kind: 'identity', label: '身份图集', image_url: '/identity-atlas.png' }],
      atomic_assets: [{ kind: 'expression', key: 'smile', label: '微笑', image_url: '/smile.png' }],
      identity_views: [{ key: 'front', label: '正面', image_url: '/front.png' }],
      expressions: [{ key: 'calm', label: '平静', image_url: '/calm.png' }],
      base_actions: [{ key: 'stand', label: '站姿', image_url: '/stand.png' }],
      subject_profile: {
        id: 'cast-dossier', displayName: '林悦', roleName: '产品体验角色', appearanceText: '自然可信',
        wardrobeText: '浅色家居服', hairMakeupText: '低发髻', negativeText: '禁止身份漂移',
      },
    },
    cast_profiles: [{
      id: 'cast-dossier', displayName: '林悦', roleName: '产品体验角色', appearanceText: '自然可信',
      wardrobeText: '浅色家居服', hairMakeupText: '低发髻', negativeText: '禁止身份漂移',
    }],
    expected_people: 1,
    cast_mode: 'single',
  });
  storage.saveOutput(taskId, 'scene_config', {
    scene_mode: 'multi',
    spaces: [
      {
        id: 'scene-exterior', name: '现代住宅外景', description: '住宅外立面与全景窗关系', story_purpose: '建立产品所在建筑',
        scene_spec: { layoutText: '住宅入口与外立面', materialText: '石材与金属窗框', weather: '晴', timeOfDay: '上午', lightText: '侧逆光' },
      },
      {
        id: 'scene-interior', name: '全景窗现代客厅', description: '客厅与全景窗互动空间', story_purpose: '人物演示推拉与采光',
        scene_spec: { layoutText: '沙发、茶几与全景窗', materialText: '木地板与玻璃', weather: '晴', timeOfDay: '上午', lightText: '窗外自然光' },
      },
    ],
    routes: [{ from_scene_id: 'scene-exterior', to_scene_id: 'scene-interior', time_continuity: '同一上午', weather_continuity: '晴朗', light_continuity: '自然光连续', transition_reason: '人物从室外进入客厅' }],
  });
  storage.saveOutput(taskId, 'scene_assets', [{
    scene_id: 'scene-interior', name: '全景窗现代客厅', image_url: '/interior.png', scene_revision: 3,
    generation_contract_version: 7,
    view_images: sceneViews(),
    scene_contract: sceneContract(),
  }]);
  storage.saveOutput(taskId, 'storyboard_table', [{ shot_id: 'SH01', scene_id: 'scene-interior', title: '推开全景窗' }]);

  const bundle = bundles.buildProjectBundle(taskId, { sections: 'all', user });
  assert.equal(bundle.project.title, '用户重新命名的项目');
  assert.equal(bundle.project.name_source, 'user');
  assert.equal(bundle.brief.project_name, '用户重新命名的项目');
  assert.equal(bundle.assets.scenes.length, 3, '两个计划场景与一个未绑定参考都必须可见');
  const interior = bundle.assets.scenes.find(item => item.id === 'scene-interior');
  assert(interior, '计划和生成资产必须按 scene_id 合并');
  assert.equal(bundle.assets.scenes.filter(item => item.id === 'scene-interior').length, 1, '同一场景不得重复卡片');
  assert.equal(interior.planned, true);
  assert.equal(interior.image_url, '/interior.png');
  assert.equal(interior.zones[0].label, '全景窗互动区');
  assert.equal(interior.cameras[0].lens, '24-35mm wide');
  assert.equal(interior.view_images[0].intent, '建立空间关系');
  assert.equal(interior.layout.image_url, '/layout.png');
  assert.deepEqual(interior.shot_refs, ['SH01']);
  assert.equal(typeof interior.qa.full_space_lock, 'boolean', '详情必须展示规范化后的真实空间锁状态');
  assert.equal(typeof interior.qa.camera_pass, 'boolean', '详情必须展示真实机位 QA 状态');
  assert.equal(bundle.assets.scenes.find(item => item.id === 'scene-exterior').status, 'planned');
  assert.equal(bundle.assets.scenes.find(item => item.id === 'scene-reference-loose').reference_only, true);

  const person = bundle.assets.people[0];
  assert.equal(person.category_atlases.length, 1);
  assert.equal(person.atomic_assets.length, 1);
  assert.equal(person.identity_views.length, 1);
  assert.equal(person.expressions.length, 1);
  assert.equal(person.base_actions.length, 1);
  assert(bundle.payload_bytes > 0 && bundle.payload_bytes < 200000, '补充场景和档案详情后首包仍需小于 200KB');

  const index = fs.readFileSync(path.join(__dirname, '../public/story-ad/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../public/story-ad/app.js'), 'utf8');
  const tokens = [...index.matchAll(/story-ad\/(?:styles|workspace|workflow|app)\.(?:css|js)\?v=([^"']+)/g)].map(match => match[1]);
  assert(tokens.length >= 4 && new Set(tokens).size === 1, '入口 CSS 与 app 必须使用同一发布 token');
  assert(!app.includes('编辑器</button>') && !app.includes('素材</button>') && !app.includes('模板</button>') && !app.includes('设置</button>'), '剧情广告顶栏不得再显示无关平台导航');
  assert(app.includes(`?v=${tokens[0]}`), '动态视图必须与入口使用同一发布 token');

  console.log('story-ad workspace interaction tests: 32 checks passed');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
