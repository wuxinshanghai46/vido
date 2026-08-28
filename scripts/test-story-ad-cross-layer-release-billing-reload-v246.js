#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.tmp', 'story-ad-cross-layer-release-billing-reload-v246');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const storage = require('../src/services/newStoryAd/storageService');
const gateway = require('../src/services/newStoryAd/modelGateway');
const jobs = require('../src/services/newStoryAd/jobService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');

const VIEW_KEYS = ['master', 'layout', 'reverse', 'interaction', 'detail'];
let checks = 0;
function check(value, message) { checks += 1; assert(value, message); }
function equal(actual, expected, message) { checks += 1; assert.strictEqual(actual, expected, message); }
function deepEqual(actual, expected, message) { checks += 1; assert.deepStrictEqual(actual, expected, message); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function waitFor(predicate, message, timeoutMs = 4000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error(message));
      setTimeout(poll, 15);
    };
    poll();
  });
}

function publicPlanStatusRenderer() {
  const source = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPlanReleaseStatus.js'), 'utf8')
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/\bexport\s+/g, '');
  const sandbox = { personPlanTechnicalDetails: () => '' };
  vm.runInNewContext(`${source}\nglobalThis.__render = personPlanBlockedView;`, sandbox, {
    filename: 'assetCenterPlanReleaseStatus.js',
  });
  return sandbox.__render;
}

function testReleaseStatusDoesNotLeakInternalIssues() {
  const render = publicPlanStatusRenderer();
  const internalIssues = [
    'active_plan_bundle_mismatch',
    'person_plan_stale',
    'scene_plan_stale',
    'unknown_billing_unquarantined',
  ];
  const releaseSync = render({
    eligible: false,
    issues: internalIssues,
    release_sync_pending: true,
    release_migration: { compatible: true, migration_required: true },
  }, false, { isAdmin: false });
  check(releaseSync.includes('role="status"'), 'release-sync blocked state must remain a readable public status region');
  check(releaseSync.includes('data-release-migration-only="true"'), 'compatible release sync must use the controlled migration action');
  internalIssues.forEach(issue => check(!releaseSync.includes(issue), `public release-sync HTML must not leak ${issue}`));

  const blocked = render({
    eligible: false,
    issues: ['task_current_planning_stage_failed', ...internalIssues],
    release_migration: { compatible: false, migration_required: false },
  }, false, { isAdmin: false });
  check(blocked.includes('重新生成人物方案'), 'blocked public state must use readable user-facing copy');
  internalIssues.forEach(issue => check(!blocked.includes(issue), `public blocked HTML must not leak ${issue}`));
}

async function testUnknownBillingStopsCandidatesAndBindsSceneLane() {
  const taskId = 'cross-layer-billing-lane';
  const sceneId = 'scene-billing-review';
  storage.createTask({ id: taskId, title: 'candidate stop and lane binding', content_revision: 1 });
  const attempted = [];
  const queued = jobs.queueStage({
    taskId,
    stage: 'scene_asset',
    scopeId: sceneId,
    expectedContentRevision: 1,
    execute: async () => gateway.generateText({
      taskId,
      stage: 'new_story_ad.assist',
      systemPrompt: 'fixture',
      userPrompt: 'fixture',
      maxCandidates: 3,
      stageBudgetMs: 15000,
      _candidateModels: [
        { provider_id: 'candidate-one', model_id: 'fixture-text-1' },
        { provider_id: 'candidate-two', model_id: 'fixture-text-2' },
        { provider_id: 'candidate-three', model_id: 'fixture-text-3' },
      ],
      _generateText: async ({ model }) => {
        attempted.push(model.provider_id);
        if (model.provider_id === 'candidate-one') {
          throw Object.assign(new Error('fixture rate limit before submission'), {
            code: 'RATE_LIMIT',
            billingState: 'not_billed',
            providerSubmissionState: 'submission_rejected',
          });
        }
        throw Object.assign(new Error('fixture upstream timeout after ambiguous submission'), {
          code: 'TIMEOUT_OR_NETWORK',
          billingState: 'unknown',
          providerSubmissionState: 'submitted_unknown',
        });
      },
    }),
  });
  check(queued.accepted === true, 'scene-scoped generation must be accepted');
  await waitFor(
    () => storage.getTask(taskId)?.target_generation_results?.[`scene_asset:${sceneId}`]?.status === 'failed',
    'unknown-billing failure did not settle in the expected scene lane',
  );
  deepEqual(attempted, ['candidate-one', 'candidate-two'], 'submitted-unknown candidate must stop the chain before candidate three');
  const task = storage.getTask(taskId);
  const laneKey = `scene_asset:${sceneId}`;
  equal(task.target_generation_results[laneKey].status, 'failed', 'the exact scene lane must retain the failure result');
  equal(task.target_generation_progress[laneKey].scene_id, sceneId, 'the failure lane must retain its scene id');
  equal(Object.keys(task.target_generation_progress).length, 1, 'unknown billing must not contaminate another scene lane');
  const calls = storage.listModelCalls(taskId);
  equal(calls.length, 2, 'only the two attempted fixture candidates may be recorded');
  const terminalCall = calls.find(call => call.provider_id === 'candidate-two');
  check(terminalCall, 'the terminal candidate call must be persisted');
  equal(terminalCall.billing_state, 'unknown', 'the terminal candidate must retain unknown billing evidence');
  equal(terminalCall.provider_submission_state, 'submitted_unknown', 'the terminal candidate must retain ambiguous submission evidence');
}

function saveImage(name, bytes) {
  fs.mkdirSync(mediaAdapter.ASSET_DIR, { recursive: true });
  const file = mediaAdapter.assetPathFromName(name);
  fs.writeFileSync(file, bytes);
  return { file, url: `/api/new-story-ad/assets/${encodeURIComponent(name)}`, sha256: sha256(bytes) };
}

function sceneRecord(sceneId, files, missingKeys = []) {
  const byKey = new Map(files.map(item => [item.key, item]));
  return {
    scene_id: sceneId,
    name: sceneId,
    generation_contract_version: sceneAssets.SCENE_GENERATION_CONTRACT_VERSION,
    image_url: byKey.get('master')?.url || '',
    view_images: VIEW_KEYS.map(key => ({
      key,
      image_url: missingKeys.includes(key)
        ? `/api/new-story-ad/assets/${sceneId}-${key}-missing.png`
        : byKey.get(key)?.url,
      file_sha256: byKey.get(key)?.sha256 || '',
    })),
  };
}

function testTwoSceneReloadPreservesSuccessAndRetriesOnlyMissingUnit() {
  const taskId = 'cross-layer-two-scene-reload';
  storage.createTask({ id: taskId, title: 'two scene reload', content_revision: 1 });
  const sceneAFiles = VIEW_KEYS.map(key => ({ key, ...saveImage(`scene-a-${key}.png`, Buffer.from(`scene-a-${key}-stable`)) }));
  const sceneBFiles = VIEW_KEYS.filter(key => key !== 'detail')
    .map(key => ({ key, ...saveImage(`scene-b-${key}.png`, Buffer.from(`scene-b-${key}-stable`)) }));
  const sceneA = sceneRecord('scene-a', sceneAFiles);
  const sceneB = sceneRecord('scene-b', sceneBFiles, ['detail']);
  storage.saveOutput(taskId, 'scene_assets', [sceneA, sceneB]);

  const beforeHashes = Object.fromEntries(sceneAFiles.map(item => [item.key, sha256(fs.readFileSync(item.file))]));
  const reloadedRows = JSON.parse(JSON.stringify(storage.getOutput(taskId, 'scene_assets')));
  const normalized = sceneAssets.normalizeSceneAssets(reloadedRows);
  const reloadedA = normalized.find(item => item.scene_id === 'scene-a');
  const reloadedB = normalized.find(item => item.scene_id === 'scene-b');
  equal(reloadedA.view_images.length, 5, 'a successful adjacent scene must reload all five views');
  deepEqual(reloadedA.missing_file_view_keys || [], [], 'a successful adjacent scene must not gain false missing views');
  const afterHashes = Object.fromEntries(sceneAFiles.map(item => [item.key, sha256(fs.readFileSync(item.file))]));
  deepEqual(afterHashes, beforeHashes, 'reload and failure projection must not change successful scene bytes');
  deepEqual(reloadedB.missing_file_view_keys, ['detail'], 'reload must identify only the failed scene detail unit');
  deepEqual(reloadedB.repair_plan.view_keys, ['detail'], 'recovery must retry only the missing detail unit');
  equal(reloadedB.repair_plan.count, 1, 'recovery call plan must contain exactly one missing unit');
  equal(reloadedA.repair_plan?.count || 0, 0, 'the successful adjacent scene must schedule zero retries');
}

async function main() {
  testReleaseStatusDoesNotLeakInternalIssues();
  await testUnknownBillingStopsCandidatesAndBindsSceneLane();
  testTwoSceneReloadPreservesSuccessAndRetriesOnlyMissingUnit();
  console.log(JSON.stringify({
    passed: true,
    combinations: 3,
    checks,
    external_model_calls: 0,
    simulated_candidate_attempts: 2,
    successful_scene_views_preserved: 5,
    failed_scene_retry_units: 1,
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});
