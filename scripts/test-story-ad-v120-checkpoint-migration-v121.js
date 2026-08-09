'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-v120-checkpoint-migration-v121-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const storage = require('../src/services/newStoryAd/storageService');
const releaseBundle = require('../src/services/storyAdReleaseBundleService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const sectionRecovery = require('../src/services/newStoryAd/assetPlanSectionRecoveryContractService');
const coverage = require('../src/services/newStoryAd/storySceneCoverageService');
const migration = require('./migrate-story-ad-v120-checkpoints');

const sourceBundle = 'b'.repeat(64);
const sourceBuild = migration.SOURCE_BUILD_DEFAULT;
const options = { sourceBundle, sourceBuild };

function sourceEnvelope(contentRevision = 1) {
  return {
    producer_bundle_id: sourceBundle,
    build_id: sourceBuild,
    contract_version: migration.SOURCE_CONTRACT,
    ...migration.SOURCE_SEMANTICS,
    content_revision: contentRevision,
  };
}

function narrativeContext(id) {
  return {
    request_id: id,
    brief: 'Two neighbors restore community lighting after an outage and resolve a misunderstanding.',
    content_mode: 'narrative_story',
    content_mode_source: 'user',
    product_subject: '',
    product_presentation: { mode: 'narrative_story', subject: '' },
    story_scene_contract_version: coverage.CONTRACT_VERSION,
    expected_people: 2,
    cast_mode: 'dual',
    target_duration: 30,
    shot_count: 6,
    output_ratio: '9:16',
    cast_profiles: [],
    pet_profiles: [],
    prop_assets: [],
    scene_assets: [],
    assets: [],
  };
}

function partialStoryScene() {
  const phases = ['opening', 'development', 'development', 'turning_point', 'development', 'resolution'];
  const beats = phases.map((phase, index) => ({
    id: `beat_${index + 1}`,
    phase,
    era: 'same_day',
    time_anchor: `step_${index + 1}`,
    location: index < 3 ? 'community_corridor' : 'utility_room',
    production_state: index < 3 ? 'power_outage' : 'lighting_recovery',
    production_scene_key: index < 3 ? 'corridor' : 'utility',
    transition_type: index === 0 ? 'opening' : (index === 3 ? 'composite_change' : 'continuity'),
    scene_change_reason: index === 3 ? 'location_and_environment_change' : 'continuous_action',
    summary: `visible_action_${index + 1}`,
    cause: `cause_${index + 1}`,
    consequence: `consequence_${index + 1}`,
  }));
  return coverage.compileAssetPlan({
    story_seed: {
      logline: 'Two neighbors cooperate through a power outage and reconcile.',
      opening: 'The outage establishes a shared problem.',
      development: 'They trace the fault and coordinate a repair.',
      turning_point: 'They discover the source of their misunderstanding.',
      resolution: 'The light returns and they reconcile.',
      plot_beats: beats,
    },
  });
}

function createPartialTask(id, { activeGeneration = '', crosstalk = false } = {}) {
  const context = narrativeContext(id);
  storage.createTask({ id, brief: context.brief, content_revision: 3, request: context });
  storage.saveOutput(id, 'context', context);
  if (activeGeneration) storage.updateTask(id, { active_generation_id: activeGeneration });
  const task = storage.getTask(id);
  const payload = partialStoryScene();
  if (crosstalk) payload.scene_plan.advertised_subject = 'unexpected_product';
  storage.saveOutput(id, 'asset_plan_draft_checkpoint', {
    checkpoint_id: `v120-${id}`,
    status: 'asset_plan_sections_missing',
    contract_version: 'asset-plan-section-recovery-v1',
    generation_id: `v120-generation-${id}`,
    fingerprint: assetPlan.fingerprint(task, context),
    content_revision: 3,
    content_mode: 'narrative_story',
    reusable: true,
    valid_sections: ['story_seed', 'scene_plan'],
    missing_sections: ['cast_profiles', 'prop_plan'],
    payload,
    release_envelope: sourceEnvelope(3),
  });
  return storage.getTask(id);
}

function createCommercialActiveTask(id) {
  const context = {
    request_id: id,
    brief: 'Create a commercial for the Atlas Smart Lock focused on secure keyless entry.',
    content_mode: 'commercial_subject',
    content_mode_source: 'user',
    product_subject: 'Atlas Smart Lock',
    product_presentation: { mode: 'commercial_subject', subject: 'Atlas Smart Lock' },
    expected_people: 0,
    cast_mode: 'no_human',
    target_duration: 15,
    shot_count: 4,
    output_ratio: '9:16',
  };
  storage.createTask({ id, brief: context.brief, content_revision: 2, request: context });
  storage.saveOutput(id, 'context', context);
  const task = storage.getTask(id);
  const fingerprint = assetPlan.fingerprint(task, context);
  const plan = {
    status: 'active',
    content_mode: 'commercial_subject',
    content_revision: 2,
    fingerprint,
    active_revision: 4,
    release_envelope: sourceEnvelope(2),
    cast_profiles: [],
    prop_plan: [{ id: 'product', name: 'Atlas Smart Lock', type: 'advertised_product' }],
    story_seed: { logline: 'Atlas Smart Lock demonstrates secure keyless entry.' },
    scene_plan: {
      advertised_subject: 'Atlas Smart Lock',
      spaces: [{ id: 'entryway', name: 'Entryway', description: 'A residential entryway', story_purpose: 'Product demonstration' }],
    },
  };
  storage.saveOutput(id, 'asset_plan_active', {
    plan_id: 'v120-commercial-plan',
    active_revision: 4,
    content_revision: 2,
    fingerprint,
    release_envelope: sourceEnvelope(2),
    plan,
  });
  return storage.getTask(id);
}

try {
  const task = createPartialTask('valid-partial-story-scene');
  const dryRun = migration.analyze(task, options);
  assert.equal(dryRun.state, 'migratable');
  assert.deepStrictEqual(dryRun.draft.valid_sections.sort(), ['scene_plan', 'story_seed']);
  assert.deepStrictEqual(dryRun.draft.missing_sections.sort(), ['cast_profiles', 'prop_plan']);
  assert.equal(storage.getOutput(task.id, migration.RECORD_KIND), null, 'dry-run must not write migration state');

  const applied = migration.applyMigration(task, dryRun);
  assert.equal(applied.applied, true);
  assert.equal(applied.model_calls, 0);
  assert.equal(applied.paid_calls, 0);
  const checkpoint = storage.getOutput(task.id, 'asset_plan_draft_checkpoint');
  assert.equal(checkpoint.contract_version, sectionRecovery.CONTRACT_VERSION);
  assert.equal(checkpoint.release_envelope.producer_bundle_id, releaseBundle.identity().bundle_id);
  assert.equal(checkpoint.release_migration.source_bundle_id, sourceBundle);
  assert.match(checkpoint.release_migration.source_checkpoint_hash, /^[a-f0-9]{64}$/);
  assert.match(checkpoint.checkpoint_id, /^migrated-checkpoint-[a-f0-9]{32}$/);
  assert.deepStrictEqual(checkpoint.valid_sections.sort(), ['scene_plan', 'story_seed']);
  assert.deepStrictEqual(checkpoint.missing_sections.sort(), ['cast_profiles', 'prop_plan']);
  assert.equal(storage.getOutput(task.id, 'asset_plan_active'), null, 'partial story/scene checkpoint must not become Active');
  const compatibility = sectionRecovery.checkpointCompatibility(storage.getTask(task.id), checkpoint, {
    ctx: narrativeContext(task.id),
    fingerprint: checkpoint.fingerprint,
    generation_id: checkpoint.generation_id,
  });
  assert.equal(compatibility.compatible, true, compatibility.issues.join(','));

  const repeated = migration.applyMigration(storage.getTask(task.id), migration.analyze(storage.getTask(task.id), options));
  assert.equal(repeated.idempotent_skip, true);
  assert.equal(migration.analyze(storage.getTask(task.id), options).state, 'already_migrated');

  const blocked = migration.analyze(createPartialTask('blocked-active-generation', { activeGeneration: 'running-generation' }), options);
  assert.equal(blocked.state, 'blocked_active_generation');
  assert.equal(storage.getOutput(blocked.task_id, migration.RECORD_KIND), null);
  const preflightProtected = createPartialTask('global-preflight-no-partial-writes');
  const blockedApply = childProcess.spawnSync(process.execPath, [
    path.join(__dirname, 'migrate-story-ad-v120-checkpoints.js'),
    '--apply', '--summary-only', '--source-build', sourceBuild, '--source-bundle', sourceBundle,
  ], { env: process.env, encoding: 'utf8' });
  assert.equal(blockedApply.status, 3, blockedApply.stderr || blockedApply.stdout);
  assert.equal(storage.getOutput(preflightProtected.id, migration.RECORD_KIND), null, 'global blocked preflight must prevent partial migration writes');
  assert.equal(storage.getOutput(preflightProtected.id, 'asset_plan_draft_checkpoint').release_envelope.producer_bundle_id, sourceBundle);

  const crosstalk = migration.analyze(createPartialTask('blocked-content-mode-crosstalk', { crosstalk: true }), options);
  assert.equal(crosstalk.state, 'replan_required');
  assert(crosstalk.issues.some(issue => issue.startsWith('draft_content_mode:')));

  const commercialTask = createCommercialActiveTask('valid-commercial-active');
  const commercialReport = migration.analyze(commercialTask, options);
  assert.equal(commercialReport.state, 'migratable', commercialReport.issues.join(','));
  assert.equal(commercialReport.active.valid, true);
  migration.applyMigration(commercialTask, commercialReport);
  const commercialActive = storage.getOutput(commercialTask.id, 'asset_plan_active');
  assert.equal(commercialActive.active_revision, 5);
  assert.notEqual(commercialActive.plan_id, 'v120-commercial-plan');
  assert.equal(commercialActive.plan.scene_plan.advertised_subject, 'Atlas Smart Lock');
  assert.equal(commercialActive.plan.release_envelope.producer_bundle_id, releaseBundle.identity().bundle_id);

  const rollback = migration.rollbackTask(storage.getTask(task.id));
  assert.equal(rollback.rolled_back, true);
  const restored = storage.getOutput(task.id, 'asset_plan_draft_checkpoint');
  assert.equal(restored.release_envelope.producer_bundle_id, sourceBundle);
  assert.equal(restored.contract_version, 'asset-plan-section-recovery-v1');
  assert.equal(storage.readDb().model_calls.length, 0);

  console.log(JSON.stringify({
    passed: true,
    checks: 34,
    dry_run_writes: 0,
    migrated_valid_sections: ['story_seed', 'scene_plan'],
    missing_sections: ['cast_profiles', 'prop_plan'],
    partial_promoted_to_active: false,
    crosstalk_blocked: true,
    active_generation_blocked: true,
    blocked_preflight_atomic: true,
    commercial_active_preserved: true,
    stale_plan_id_rotated: true,
    idempotent: true,
    rollback: true,
    model_calls: 0,
    paid_calls: 0,
  }));
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
