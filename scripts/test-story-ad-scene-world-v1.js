const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sceneWorlds = require('../src/services/storyAdWorkspace/sceneWorldService');
const releaseConfig = require('../config/story-ad-release.json');

function scene(id, name, description, extra = {}) {
  return {
    id,
    name,
    description,
    story_purpose: extra.story_purpose || '',
    zones: extra.zones || [],
    cameras: extra.cameras || [],
    scene_spec: extra.scene_spec || {},
    view_images: extra.view_images || [],
    panorama_images: extra.panorama_images || [],
    revision: 3,
  };
}

const bundle = {
  project: { id: 'scene-world-test' },
  revisions: { content: 7 },
  brief: { text: '通用行业多人物多场景广告' },
  assets: {
    people: [
      { id: 'p1', subject_id: 'p1', name: '林岚', profile: { displayName: '林岚', wardrobeText: '深蓝工作服、黑色安全鞋、银色腕表' } },
      { id: 'p2', subject_id: 'p2', name: '周启', profile: { displayName: '周启', wardrobeText: '白色实验服、护目镜' } },
      { id: 'p3', subject_id: 'p3', name: '苏遥', profile: { displayName: '苏遥', wardrobeText: '品牌定制服装与耳饰' } },
    ],
    animals: [],
    products: [{ id: 'product-1' }],
    scenes: [
      scene('factory', '智能工厂', '大型车间、设备区域与人员移动路线', {
        zones: [{ id: 'line', label: '生产线' }, { id: 'control', label: '控制区' }],
        cameras: [
          { id: 'factory-wide', label: '生产线总览', normalized_position: [0.1, 0.2], look_at: [0.5, 0.5] },
          { id: 'factory-follow', label: '人物跟随机位', normalized_position: [0.8, 0.6], look_at: [0.45, 0.45] },
        ],
        view_images: [
          { key: 'master', label: '主视角', image_url: '/assets/factory-master.png' },
          { key: 'reverse', label: '反向视角', image_url: '/assets/factory-reverse.png' },
          { key: 'layout', label: '俯视布局', image_url: '/assets/factory-layout.png' },
        ],
        scene_spec: { scene_experience_contract: { representation: 'physical', extent: 'enclosed', actor_blocking_required: true } },
      }),
      scene('road', '开放空间', '按结构化合同呈现开放范围', { view_images: [{ key: 'master', image_url: '/assets/road.png' }], scene_spec: { scene_experience_contract: { representation: 'physical', extent: 'open' } } }),
      scene('app', '数字界面', '按结构化合同呈现数字状态', { view_images: [{ key: 'master', image_url: '/assets/app.png' }], scene_spec: { scene_experience_contract: { representation: 'digital', extent: 'screen' } } }),
      scene('cg', '抽象空间', '按结构化合同呈现抽象视觉', { view_images: [{ key: 'master', image_url: '/assets/cg.png' }], scene_spec: { scene_experience_contract: { representation: 'abstract', extent: 'stage' } } }),
    ],
  },
  asset_editor: {
    scene_plan: {
      routes: [
        { from_scene_id: 'factory', to_scene_id: 'road', transition_reason: '人物动作接续到车辆出发', audio_bridge: '机器声延续为道路环境声' },
        { from_scene_id: 'road', to_scene_id: 'app', transition_reason: '车载屏幕推进到APP界面' },
        { from_scene_id: 'app', to_scene_id: 'cg', transition_reason: '产品图标推进到微观材质世界' },
      ],
    },
  },
  storyboard: {
    shots: [
      { scene_id: 'factory', characters: ['林岚'], action: '沿生产线讲解' },
      { scene_id: 'factory', characters: ['周启'], action: '检查设备' },
      { scene_id: 'road', characters: ['苏遥'], action: '驾驶车辆' },
    ],
  },
};

const worlds = sceneWorlds.buildSceneWorlds(bundle);
assert.strictEqual(worlds.length, 4, 'must create every requested scene world');
assert.strictEqual(worlds[0].cameras.length, 2, 'camera count must follow content instead of forcing four cameras');
assert.strictEqual(worlds[0].capabilities.supports_character_blocking, false, 'without verified geometry and navmesh, blocking must stay disabled');
assert.strictEqual(worlds[0].capabilities.supports_photo_views, true, 'existing scene images must enable the real-photo viewer');
assert.strictEqual(worlds[0].capabilities.supports_panorama, false, 'ordinary perspective images must not be labeled as 360 panorama');
assert.strictEqual(worlds[0].source_asset.photo_view_count, 3);
assert.strictEqual(worlds[0].source_asset.layout_image_url, '/assets/factory-layout.png');
assert.strictEqual(worlds[1].capabilities.map_mode, 'route_map');
assert.strictEqual(worlds[1].capabilities.supports_panorama, false, 'physical scenes without panorama assets must not advertise 360');
assert.strictEqual(worlds[2].capabilities.world_mode, 'digital_state');
assert.strictEqual(worlds[2].capabilities.supports_panorama, false, 'digital UI must not receive a fake panorama');
assert.strictEqual(worlds[2].capabilities.map_mode, 'state_graph');
assert.strictEqual(worlds[3].capabilities.world_mode, 'abstract_cg');
assert.strictEqual(worlds[3].capabilities.supports_3d_proxy, true);
assert.strictEqual(worlds[0].portals[0].to_world_id, 'road');

const manifest = sceneWorlds.productionManifest(bundle, worlds);
assert.deepStrictEqual(manifest.counts, {
  people: 3,
  animals: 0,
  products: 1,
  worlds: 4,
  planned_scenes: 4,
  pending_scenes: 0,
  cameras: 2,
  transitions: 3,
});
assert.strictEqual(manifest.character_world_matrix.length, 3);
const plannedOnly = sceneWorlds.buildSceneWorlds({ assets: { scenes: [scene('planned', '只有方案', '尚未生成图片')] } });
assert.strictEqual(plannedOnly.length, 1, 'text-only scene plans must enter SceneWorld preassignment before paid visual generation');
assert.strictEqual(plannedOnly[0].visual_authority_ready, false, 'planned scenes must stay visibly pending until visual authority exists');
assert.strictEqual(manifest.character_world_matrix[0].cells.find(cell => cell.world_id === 'factory').presence, 'confirmed');
assert.strictEqual(manifest.character_world_matrix[2].cells.find(cell => cell.world_id === 'road').presence, 'confirmed');

const explicit = sceneWorlds.inferCapabilities(scene('custom', '用户自定义场景', '纯产品空间', {
  scene_spec: { capabilities: { supports_panorama: true, supports_structure_map: false } },
}));
assert.strictEqual(explicit.supports_panorama, false, 'a flag without a verified 2:1 authority must never create panorama capability');
assert.strictEqual(explicit.supports_structure_map, false, 'explicit false must override inference');

const assetLedMap = sceneWorlds.inferCapabilities(scene('gallery', '光影艺廊', '安静的艺术空间', {
  view_images: [{ key: 'master', image_url: '/master.png' }, { key: 'layout', image_url: '/layout.png' }],
}));
assert.strictEqual(assetLedMap.supports_structure_map, true, 'layout asset must enable structure map without indoor keywords');
assert.strictEqual(assetLedMap.map_mode, 'structure_map', 'layout asset must select structure map mode');

const apiSource = fs.readFileSync(path.join(root, 'public/story-ad/api.js'), 'utf8');
const releaseSource = fs.readFileSync(path.join(root, 'public/story-ad/release.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(root, 'public/js/new-story-ad/bootstrap.js'), 'utf8');
const workspaceSource = fs.readFileSync(path.join(root, 'public/story-ad/views/sceneWorldView.js'), 'utf8');
const workspaceCss = fs.readFileSync(path.join(root, 'public/story-ad/workspace.css'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'public/story-ad/app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'public/story-ad/index.html'), 'utf8');

assert(apiSource.includes(`./release.js?v=${releaseConfig.build_id}`));
assert(releaseSource.includes(`CLIENT_BUILD_ID = ${JSON.stringify(releaseConfig.build_id)}`));
assert(releaseSource.includes(`CLIENT_CONTRACT_VERSION = ${JSON.stringify(releaseConfig.contract_version)}`));
assert(apiSource.includes("headers['X-VIDO-Client-Build']"));
assert(serverSource.includes("code: 'CLIENT_BUILD_EXPIRED'"));
assert(serverSource.includes('STORY_AD_CONTRACT_VERSION = storyAdRelease.contract_version'));
assert(serverSource.includes("legacy_story_ad_ui_enabled: false"));
assert(serverSource.includes("res.redirect(302, '/story-ad/')"));
const loadStart = bootstrapSource.indexOf('async function loadStoryAd()');
const loadEnd = bootstrapSource.indexOf('/** 人物档案生产', loadStart);
const loadBody = bootstrapSource.slice(loadStart, loadEnd);
assert(loadBody.includes('location.assign(target)'), 'legacy entry must redirect to the new workspace');
assert(!loadBody.includes('loadScript('), 'legacy entry must not load legacy UI scripts');
assert(workspaceSource.includes('initNativeSceneWorldViewer'));
assert(workspaceSource.includes('initSceneWorldViewer'));
assert(workspaceSource.includes('scene-world-photo-viewer'));
assert(workspaceSource.includes('data-focus-observation'));
assert(workspaceSource.includes("'real-photo'"));
assert(workspaceSource.includes('data-media-original="${escapeHtml(node.image_url)}"'), 'dynamic scene view must bind the selected source as media-delivery authority');
assert(workspaceSource.includes('image.src = previewUrl(node.image_url, 960)'), 'dynamic scene view must load the selected source through the cached preview route without stale candidates or a full PNG race');
assert(workspaceCss.includes('.scene-world-photo-error[hidden]{display:none}'), 'loaded scene image must suppress the stale error overlay');
assert(workspaceCss.includes('.scene-world-photo-stage>img{position:absolute;inset:0;'), 'portrait and landscape scene images must be constrained to the visible stage instead of overflowing and being clipped');
assert(workspaceCss.includes('max-width:100%;max-height:100%;object-fit:contain;object-position:center;cursor:default'), 'scene images must remain fully visible and must not advertise a second lightbox window');
assert(!workspaceSource.includes('bindMediaLightbox(overlay)'), 'the scene studio must switch photos in place instead of stacking a media lightbox');
assert(!workspaceSource.includes('data-open-director-studio'), 'camera viewing must remain in the current scene studio instead of stacking the director overlay');
assert(workspaceSource.includes('机位切换（当前窗口）'));
assert.match(workspaceSource, /overlay\.querySelectorAll\('\[data-focus-observation\]'\)[\s\S]{0,300}showPhoto\(node\);/u, 'ordinary observation selection must stay in photo-view mode');
assert.match(workspaceSource, /overlay\.querySelectorAll\('\[data-focus-camera\]'\)[\s\S]{0,500}showPhoto\(node, 'camera'\);/u, 'camera selection must replace the current stage content directly and preserve camera mode');
assert(workspaceSource.includes("host.dataset.viewerEngine = 'native-canvas'"));
assert(!workspaceSource.includes("import('/vendor/three.module.min.js')"));
assert(workspaceSource.includes('data-focus-camera'));
assert(workspaceSource.includes('character-world-matrix'));
assert(appSource.includes(releaseConfig.build_id));
assert(indexSource.includes(releaseConfig.build_id));
assert(!appSource.includes('20260803-person-age-lightbox-r33'));

console.log(JSON.stringify({
  success: true,
  worlds: worlds.length,
  cameras: manifest.counts.cameras,
  transitions: manifest.counts.transitions,
  matrix_rows: manifest.character_world_matrix.length,
  old_entry_redirected: true,
  client_build_gate: true,
}, null, 2));
