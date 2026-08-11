'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-era-identity-v170-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';

const authority = require('../src/services/newStoryAd/briefAuthorityService');
const personLooks = require('../src/services/newStoryAd/personLookProfileService');
const projection = require('../src/services/newStoryAd/subjectCheckpointProjectionService');
const personProjection = require('../src/services/storyAdWorkspace/personLookProjectionService');
const storage = require('../src/services/newStoryAd/storageService');
const migration = require('./migrate-story-ad-era-identities-v170');
const countMigration = require('./migrate-story-ad-person-count-contract-v174');
const sectionRecovery = require('../src/services/newStoryAd/assetPlanSectionRecoveryContractService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const personCountContract = require('../src/services/newStoryAd/personCountContractService');

const brief = '男女主古代相爱，男主活过千年亲自来到现代，随后遇见女主的转世。';
const male = {
  id: 'shen_yanci', name: '沈砚辞', role: '男主，活过千年的本人',
  look_profiles: [
    { id: 'shen_a', story_state: '古代', wardrobeText: '古代侠装' },
    { id: 'shen_m', story_state: '现代', wardrobeText: '现代衬衫' },
  ],
};
const female = {
  id: 'yun_zhiyue', name: '云知月', role: '古代女主，现代转世之人',
  look_profiles: [
    { id: 'yun_a', story_state: '古代', wardrobeText: '古代襦裙' },
    { id: 'yun_m', story_state: '现代', wardrobeText: '现代白裙' },
  ],
};

function run() {
  assert.equal(personCountContract.contract({ cast_mode: 'multi', expected_people: 4 }).planning_cast_count, 4,
    'ordinary explicit people count must remain authoritative when no era cards exist');
  assert.equal(personCountContract.contract({ cast_mode: 'no_human', expected_people: 4 }).planning_cast_count, 0,
    'no-human contract must override legacy counts');
  const contract = authority.eraCastContract(brief);
  assert.equal(contract.count, 3, '男主本人延续 + 古代女主 + 现代转世应是三个叙事身份');
  assert.match(contract.rule, /转世.*独立.*姓名/);

  const split = personLooks.splitCrossEraProfiles([male, female], { brief });
  assert.deepEqual(split.map(item => item.displayName), [
    '沈砚辞（古代）', '沈砚辞（现代）', '云知月（古代）', '林知月（现代）',
  ]);
  assert.deepEqual(split.map(item => item.identity_continuity), [
    'same_person', 'same_person', 'reincarnation', 'reincarnation',
  ]);
  assert.equal(split[0].source_identity_id, split[1].source_identity_id, '本人穿越的古今档案必须共享身份来源');
  assert.notEqual(split[2].source_identity_id, split[3].source_identity_id, '转世必须是新的身份来源');
  const newlyBuiltContext = contextBuilder.buildContext({
    brief,
    content_mode: 'narrative_story',
    content_mode_source: 'user',
    product_presentation: { mode: 'narrative_story' },
    cast_mode: 'dual',
    expected_people: 2,
    cast_profiles: [male, female],
  });
  assert.equal(newlyBuiltContext.narrative_identity_count, 3, 'new users must receive the split count contract during intake');
  assert.equal(newlyBuiltContext.planning_cast_count, 3);
  assert.equal(newlyBuiltContext.visual_asset_count, 4);
  assert.equal(newlyBuiltContext.cast_profiles.length, 4);

  const namedFemale = personLooks.splitCrossEraProfiles([{
    ...female,
    look_profiles: [female.look_profiles[0], { ...female.look_profiles[1], character_name: '顾念', name_source: 'planner_generated' }],
  }], { brief });
  assert.equal(namedFemale[1].displayName, '顾念（现代）', '方案阶段生成的现代姓名必须高于兼容回退名');
  const productionLikeMale = personLooks.splitCrossEraProfiles([{
    ...male,
    role: '男主，古代侠客，云知月的恋人，千年守望者',
  }], { brief: '沈砚辞因旧日奇缘活过千年，现代来到竹海，遇见云知月的转世。' });
  assert.equal(productionLikeMale[1].displayName, '沈砚辞（现代）', '他人转世词不得误伤活到现代的本人');

  storage.createTask({
    id: 'era-migration-task', status: 'scene_config_failed', stage: 'scene_config_failed', brief,
    request: { brief, cast_profiles: [male, female], expected_people: 2, cast_mode: 'dual' },
  });
  storage.saveOutput('era-migration-task', 'context', { brief, cast_profiles: [male, female], expected_people: 2, cast_mode: 'dual' });
  storage.saveOutput('era-migration-task', 'asset_plan_active', { cast_profiles: [male, female], scene_plan: { cast_mode: 'dual', spaces: [] } });
  const report = migration.apply('era-migration-task');
  assert.equal(report.applied, true);
  const migrated = storage.getOutput('era-migration-task', 'context');
  assert.equal(migrated.cast_profiles.length, 4);
  assert.equal(migrated.expected_people, 4);
  assert.equal(migrated.narrative_cast_profiles.length, 3);
  assert.equal(migrated.narrative_identity_count, 3);
  assert.equal(migrated.planning_cast_count, 3);
  assert.equal(migrated.visual_asset_count, 4);
  assert.equal(migrated.cast_mode, 'multi');
  assert.deepEqual(sectionRecovery.expectedCastRule(migrated), { kind: 'exact', count: 3 });
  assert.doesNotThrow(() => sectionRecovery.assertRequiredSectionsCandidate({
    cast_profiles: migrated.narrative_cast_profiles,
  }, ['cast_profiles'], migrated));
  assert.throws(() => sectionRecovery.assertRequiredSectionsCandidate({
    cast_profiles: migrated.cast_profiles,
  }, ['cast_profiles'], migrated), /cast_profiles_count_mismatch:4\/3/);
  const planningPrompt = contextBuilder.contextPrompt({
    ...migrated,
    content_mode: 'narrative_story', product_presentation: { mode: 'narrative_story' },
    characters: [], assets: [], forbidden: [], brand_overlay: {}, creative_direction: {}, controlled_production: {},
  });
  assert.match(planningPrompt, /剧情身份精确数量：3/);
  assert.match(planningPrompt, /分时代视觉资产数量：4/);
  const normalizedPlan = assetPlan.normalizePlan({
    cast_profiles: migrated.narrative_cast_profiles,
    prop_plan: [],
    story_seed: { logline: '跨时代重逢' },
    scene_plan: {
      advertised_subject: '', cast_mode: 'multi', scene_mode: 'single',
      spaces: [{
        id: 'ancient-courtyard', name: '古代庭院', description: '古代庭院', story_purpose: '古代相识',
        scene_spec: { layoutText: '庭院', materialLightText: '月光', interactionText: '人物相见', negativeText: '现代物件' },
      }],
    },
  }, { ...migrated, content_mode: 'narrative_story' });
  assert.equal(normalizedPlan.narrative_cast_profiles.length, 3);
  assert.equal(normalizedPlan.cast_profiles.length, 4);
  assert(storage.getOutput('era-migration-task', 'era_identity_migration_backup_v170'), '迁移前必须保留可恢复备份');
  assert.equal(migration.apply('era-migration-task').applied, false, '迁移必须幂等');

  storage.createTask({
    id: 'already-visual-migrated-task', status: 'scene_config_failed', stage: 'scene_config_failed', brief,
    request: { brief, cast_profiles: split, expected_people: 4, cast_mode: 'multi' },
  });
  storage.saveOutput('already-visual-migrated-task', 'context', {
    brief, cast_profiles: split, expected_people: 4, cast_mode: 'multi',
  });
  storage.saveOutput('already-visual-migrated-task', 'asset_plan_active', {
    cast_profiles: split, scene_plan: { cast_mode: 'multi', spaces: [] },
  });
  const countReport = countMigration.apply('already-visual-migrated-task');
  assert.equal(countReport.applied, true);
  const countMigrated = storage.getOutput('already-visual-migrated-task', 'context');
  assert.equal(countMigrated.planning_cast_count, 3);
  assert.equal(countMigrated.visual_asset_count, 4);
  assert.equal(countMigrated.expected_people, 4);
  assert.equal(countMigration.apply('already-visual-migrated-task').applied, false, 'count contract migration must be idempotent');

  const checkpoint = {
    status: 'failed', updated_at: new Date().toISOString(),
    person_dossier_checkpoints: {
      male_body: { status: 'completed', unit: 'body', result: { image_url: '/male-ancient.png' } },
      female_body: { status: 'completed', unit: 'body', result: { image_url: '/female-ancient.png' } },
    },
    subject_checkpoint_owners: {
      male_body: { subject_id: 'shen_yanci', index: 0 },
      female_body: { subject_id: 'yun_zhiyue', index: 1 },
    },
  };
  const people = migrated.cast_profiles.map((profile, index) => ({ id: profile.id, subject_id: profile.id, profile: personProjection.personProfile(profile, index) }));
  assert.equal(people[2].profile.lineage_identity_id, 'yun_zhiyue', '项目视图不得过滤旧图保留所需的 lineage 字段');
  const projected = projection.mergePeople(people, { 'subject_asset_checkpoint:test': checkpoint });
  assert.equal(projected[0].image_url, '/male-ancient.png');
  assert.equal(projected[2].image_url, '/female-ancient.png');
  assert.equal(projected[1].image_url, undefined, '现代男主不能错误复用古代已生成图');
  assert.equal(projected[3].image_url, undefined, '现代转世不能错误复用前世已生成图');

  storage.createTask({ id: 'active-era-task', status: 'running', stage: 'scene_config', brief, request: { brief } });
  assert.throws(() => migration.preview('active-era-task'), error => error.code === 'ERA_IDENTITY_MIGRATION_ACTIVE_TASK_BLOCKED');
  console.log(JSON.stringify({ passed: true, checks: 48, cards: split.length, identities: contract.count, model_calls: 0 }));
}

try { run(); } finally { fs.rmSync(outputDir, { recursive: true, force: true }); }
