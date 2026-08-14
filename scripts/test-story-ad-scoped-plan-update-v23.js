const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.tmp', 'story-ad-scoped-plan-update-v23');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const publication = require('../src/services/newStoryAd/assetPlanPublicationService');

const taskId = 'scoped-plan-update-v23';
storage.createTask({
  id: taskId,
  title: '分域方案回归',
  brief: '一名人物在固定展厅完成展示',
  request: { content_mode: 'commercial_subject' },
  content_revision: 1,
  status: 'draft',
});
storage.saveOutput(taskId, 'context', { content_mode: 'commercial_subject', brief: '一名人物在固定展厅完成展示' });

const base = {
  cast_profiles: [{ id: 'person-1', name: '林岚', look_profiles: [{ id: 'look-1', name: '标准造型' }] }],
  narrative_cast_profiles: [{ id: 'person-1', name: '林岚' }],
  pet_profiles: [],
  prop_plan: [],
  story_seed: { logline: '林岚在展厅完成展示' },
  advertised_subject_contract: { subject: '展示服务' },
  scene_plan: {
    cast_mode: 'single',
    spaces: [{ id: 'world-1', name: '主展厅', scene_spec: { layoutText: '固定入口和中央展台' } }],
  },
};
const overrides = {
  assignments: [{
    character_id: 'person-1', world_id: 'world-1', look_id: 'look-1',
    presence: 'confirmed', blocking: '中央展台左侧', camera_id: 'camera-a',
  }],
};

const personOnly = { ...base, cast_profiles: [{ ...base.cast_profiles[0], role: '讲解者' }] };
assert.equal(assetPlan.assertScopedPlanIsolation(base, personOnly, 'person', overrides), true);
assert.throws(
  () => assetPlan.assertScopedPlanIsolation(base, { ...personOnly, cast_profiles: [{ ...personOnly.cast_profiles[0], id: 'person-new' }] }, 'person', overrides),
  error => error?.code === 'PERSON_PLAN_STABLE_ID_CHANGED',
);
assert.throws(
  () => assetPlan.assertScopedPlanIsolation(base, { ...personOnly, cast_profiles: [{ ...personOnly.cast_profiles[0], look_profiles: [{ id: 'look-new' }] }] }, 'person', overrides),
  error => error?.code === 'PERSON_PLAN_BINDING_ORPHANED',
);

const sceneOnly = {
  ...base,
  scene_plan: { ...base.scene_plan, spaces: [{ ...base.scene_plan.spaces[0], description: '更新材质与光线说明' }] },
};
assert.equal(assetPlan.assertScopedPlanIsolation(base, sceneOnly, 'scene', overrides), true);
assert.throws(
  () => assetPlan.assertScopedPlanIsolation(base, { ...sceneOnly, scene_plan: { ...sceneOnly.scene_plan, spaces: [{ ...sceneOnly.scene_plan.spaces[0], id: 'world-new' }] } }, 'scene', overrides),
  error => error?.code === 'SCENE_PLAN_STABLE_ID_CHANGED',
);
assert.throws(
  () => assetPlan.assertScopedPlanIsolation(base, { ...sceneOnly, cast_profiles: [{ ...base.cast_profiles[0], role: '越界改写' }] }, 'scene', overrides),
  error => error?.code === 'ASSET_PLAN_SCOPED_UPDATE_CROSSTALK',
);

storage.saveOutput(taskId, publication.ACTIVE_KIND, {
  plan_id: 'old-plan', active_revision: 1, content_revision: 1, fingerprint: 'old-fingerprint',
  release_envelope: { producer_bundle_id: 'old-bundle' },
  plan: { ...base, status: 'active', content_revision: 1, fingerprint: 'old-fingerprint', release_envelope: { producer_bundle_id: 'old-bundle' } },
});
const personPublished = publication.publish(taskId, personOnly, { fingerprint: 'current-fingerprint', scope: 'person', source: 'test' });
const afterPerson = publication.eligibility(taskId, { fingerprint: 'current-fingerprint' });
assert.equal(afterPerson.eligible, false);
assert.equal(afterPerson.person.eligible, true);
assert.equal(afterPerson.scene.eligible, false);
assert(afterPerson.issues.includes('scene_plan_stale'));

publication.publish(taskId, { ...personPublished, scene_plan: sceneOnly.scene_plan }, { fingerprint: 'current-fingerprint', scope: 'scene', source: 'test' });
const afterScene = publication.eligibility(taskId, { fingerprint: 'current-fingerprint' });
assert.equal(afterScene.eligible, true);
assert.equal(afterScene.person.eligible, true);
assert.equal(afterScene.scene.eligible, true);

const personUi = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterView.js'), 'utf8');
const sceneUi = fs.readFileSync(path.join(root, 'public/story-ad/views/sceneWorldPage.js'), 'utf8');
const sceneStatusUi = fs.readFileSync(path.join(root, 'public/story-ad/views/scenePlanStatus.js'), 'utf8');
const statusUi = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPlanningDetailsStatus.js'), 'utf8');
assert(personUi.includes("runStage('person-plan')"));
assert(!personUi.includes("data-build-scenes"));
assert(sceneUi.includes('bindScenePlanUpdate'));
assert(sceneStatusUi.includes("runStage('scene-plan')"));
assert(statusUi.includes('本次只更新人物文字方案'));
assert(sceneStatusUi.includes('本次只更新场景文字方案'));

console.log(JSON.stringify({
  success: true,
  scoped_isolation_cases: 6,
  stable_person_id_guard: true,
  stable_scene_id_guard: true,
  look_binding_guard: true,
  domain_publication_sequence: ['person_current_scene_stale', 'person_current_scene_current'],
  real_model_calls: 0,
}, null, 2));

fs.rmSync(outputDir, { recursive: true, force: true });
