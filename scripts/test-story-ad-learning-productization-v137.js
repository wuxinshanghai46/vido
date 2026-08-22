const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const shotDesign = require('../src/services/newStoryAd/shotDesignService');
const keyframes = require('../src/services/newStoryAd/keyframeContractService');
const director = require('../src/services/newStoryAd/directorWorkspaceService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const sceneBlocks = require('../src/services/newStoryAd/sceneBlockService');

const actionContract = {
  participants: ['主角', '对手'], props: ['手提包'], spatial_relation: '两人隔桌相对，主角从左向右绕过桌角',
  camera_axis: '保持桌面180度轴线', screen_direction: '主角持续从左向右', start_pose: '主角左脚在前，右手握包',
  phases: { setup: '确认对手位置', anticipation: '重心后移', attack: '向前跨步并挥包', contact: '包与对手手臂接触', reaction: '对手后退半步', recovery: '主角收包站稳' },
  end_pose: '两人重新分开一臂距离', continuity_notes: '包始终在右手，动作切点保持方向一致',
};

const normalized = shotDesign.normalizeActionContract(actionContract);
assert.strictEqual(normalized.phases.contact, '包与对手手臂接触');
assert.strictEqual(normalized.participants.length, 2);
assert.match(shotDesign.actionContractSummary(normalized), /接触：包与对手手臂接触/);

const compiled = shotDesign.compileShotDesign({
  shot: { action_contract: actionContract, visual: '连续主场景中的双人动作', action: '主角绕桌挥包', shot_scope: 'environment' },
  sceneSurface: { mode: 'continuous', seam_policy: 'hidden' }, sceneText: '一整面连续空间，不得出现分割',
});
assert.ok(compiled.action_prompt.includes('起始姿态'));
assert.strictEqual(compiled.action_contract.phases.reaction, '对手后退半步');

const [contract] = keyframes.buildKeyframeContracts({ output_ratio: '16:9' }, [{
  index: 1, title: '绕桌交锋', visual: '两人在桌边交锋', action: '主角绕桌挥包', action_contract: actionContract,
}]);
assert.ok(contract.visual_contract.shot_design.action_prompt.includes('连续性'));
const authoredShot = { index: 1, title: '绕桌交锋', visual: '两人在桌边交锋', action: '主角绕桌挥包', action_contract: actionContract };
const keyframePrompt = storyAd.buildKeyframePrompt({ product_subject: '当前任务主体' }, authoredShot, contract, 0);
assert.match(keyframePrompt, /Action staging contract:/);
assert.match(keyframePrompt, /包与对手手臂接触/);
const motionPrompt = videoAdapter.clipPrompt(authoredShot, { product_subject: '当前任务主体' }, contract);
assert.match(motionPrompt, /Action beat contract:/);
assert.match(motionPrompt, /对手后退半步/);
const block = sceneBlocks.buildSceneBlocks([authoredShot], [contract])[0];
assert.match(sceneBlocks.generationPrompt(block, [authoredShot], [contract]), /action_contract/);

const projection = director.createDirectorWorkspace({
  task: { id: 'action-v137', title: '动作测试', status: 'working', content_revision: 1 },
  outputs: {
    context: { person_asset: { image_url: '/person.webp', view_images: [{ key: 'body_front', label: '全身正面', image_url: '/front.webp' }] } },
    blueprint: { characters: [{ name: '主角', clothing: '深色外套' }] },
    storyboard_table: [{
      index: 1, title: '绕桌交锋', purpose: '表现冲突升级', visual: '两人在桌边交锋', action: '主角绕桌挥包',
      action_contract: actionContract, shot_size: 'medium', camera_angle: 'eye_level', lens_mm: 35, camera_movement: 'tracking',
      zone_ids: ['left', 'right'], anchor_ids: ['table', 'door', 'chair'], entry_frame_state: '两人隔桌相对', exit_frame_state: '两人分开',
      keyframe_notes: '必须看清接触和后退反馈',
    }],
  },
  personProduction: { dossier: { atomic_assets: [{ kind: 'wardrobe', label: '服装细节', image_url: '/wardrobe.webp' }], expressions: [{ id: 'tense' }] }, action_assets: [] },
}, { sections: 'people,shots', shotLimit: 5 });
assert.strictEqual(projection.shots[0].action_contract.phase_count, 6);
assert.strictEqual(projection.shots[0].previs_3d.recommended, true);
assert.strictEqual(projection.shots[0].previs_3d.level, 'structured_3d');
assert.ok(projection.shots[0].director_card.performance.includes('包与对手手臂接触'));
assert.strictEqual(projection.people.completeness.score, 80);
assert.deepStrictEqual(projection.people.completeness.missing, ['动作连续性']);

const shotUi = fs.readFileSync(path.join(root, 'public/story-ad/views/shotDesignerView.js'), 'utf8');
const directorUi = fs.readFileSync(path.join(root, 'public/js/new-story-ad/director-workspace.js'), 'utf8');
const storyboardNormalizer = fs.readFileSync(path.join(root, 'src/services/newStoryAd/storyboardTableService.js'), 'utf8');
const manualNormalizer = fs.readFileSync(path.join(root, 'src/services/newStoryAd/storyAdService.js'), 'utf8');
assert.match(shotUi, /动作编排节拍/);
assert.match(shotUi, /data-action-phase/);
assert.match(directorUi, /人物完整度/);
assert.match(directorUi, /建议使用3D导演预演/);
assert.match(storyboardNormalizer, /action_contract: design\.action_contract/);
assert.match(manualNormalizer, /action_contract: design\.action_contract/);
console.log('story-ad learning productization: 24 assertions passed');
