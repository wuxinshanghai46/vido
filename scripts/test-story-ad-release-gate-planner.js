'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const planner = require('./lib/storyAdReleaseGatePlanner');
const recovery = require('./lib/immutableDeployRecovery');

function plan(files, options = {}) {
  return planner.createPlan({
    root: process.cwd(),
    baseRevision: 'a'.repeat(40),
    targetRevision: 'b'.repeat(40),
    sourceTree: options.sourceTree || 'c'.repeat(40),
    files,
    reliable: options.reliable,
    fullPlatform: options.fullPlatform,
  });
}

assert.equal(plan(['public/story-ad/views/briefView.js']).profile, 'ui');
assert.deepEqual(plan(['public/story-ad/views/briefView.js']).gates.map(row => row.id), ['workspace_ui', 'release_core']);
assert.equal(plan(['src/services/storyAdWorkspace/authoritativeReferenceProjectionService.js']).profile, 'reference');
assert(plan(['src/services/storyAdWorkspace/authoritativeReferenceProjectionService.js']).gates.some(row => row.id === 'reference'));
assert.equal(plan(['src/services/newStoryAd/assetPlanService.js']).profile, 'asset_plan');
assert.equal(plan(['src/services/newStoryAd/referenceVideoUploadService.js']).profile, 'upload_media');
assert.equal(plan(['src/services/newStoryAd/storageService.js']).profile, 'systemic');
assert.equal(plan(['src/services/newStoryAd/unclassifiedAuthority.js']).profile, 'full');
assert.equal(plan(['scripts/deploy-story-ad-immutable-release.js']).profile, 'full');
assert.equal(plan(['docs/notes.md'], { reliable: false }).profile, 'full');
assert.deepEqual(plan(['scripts/deploy-story-ad-immutable-release.js'], { fullPlatform: true }).gates.map(row => row.id), ['platform_full', 'release_core']);

const expectedRelease = {
  release_bundle_id: 'bundle-v1', artifact_id: 'artifact-v1', source_revision: 'source-v1', source_tree: 'tree-v1', build_id: 'build-v1',
};
const healthyRecovery = {
  version: {
    build_id: 'build-v1', release_bundle_id: 'bundle-v1', runtime_hash: 'runtime-v1', process_id: 7,
    release_control: { allowed: true },
    release_bundle: { artifact_id: 'artifact-v1', source_revision: 'source-v1', source_tree: 'tree-v1', remote_sync_verified: true },
  },
  public_version: { release_bundle_id: 'bundle-v1' },
  health: { status: 'ok' }, public_health: { status: 'ok' }, sqlite_quick_check: 'ok',
  readiness: { active_count: 0, active_unknown_billing_count: 0 }, release_dir: '/opt/vido/releases/artifact-v1',
};
assert.equal(recovery.confirmRecoveredRelease(healthyRecovery, expectedRelease).recovered_receipt, true);
assert.throws(() => recovery.confirmRecoveredRelease({
  ...healthyRecovery, readiness: { active_count: 1, active_unknown_billing_count: 0 },
}, expectedRelease), error => error.code === 'ALREADY_ACTIVE_RECOVERY_FAILED' && error.issues.includes('active_tasks_exist'));
assert.throws(() => recovery.confirmRecoveredRelease({
  ...healthyRecovery, public_health: { status: 'failed' },
}, expectedRelease), error => error.issues.includes('public_health_failed'));
assert.equal(recovery.isExpectedActiveRelease({ ...healthyRecovery.version, build_id: 'other' }, expectedRelease), false);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-release-gate-cache-'));
let executions = 0;
const fakeExecute = async () => { executions += 1; return { duration_ms: 7 }; };

(async () => {
  try {
    const firstPlan = plan(['public/story-ad/views/briefView.js']);
    const first = await planner.runPlan(tempRoot, firstPlan, { executeGate: fakeExecute });
    assert.equal(first.cached_count, 0);
    assert.equal(executions, 2);
    const repeated = await planner.runPlan(tempRoot, firstPlan, { executeGate: fakeExecute });
    assert.equal(repeated.cached_count, 2);
    assert.equal(executions, 2, '同一源码树与同一门禁不得重复执行');
    const changedTree = plan(['public/story-ad/views/briefView.js'], { sourceTree: 'd'.repeat(40) });
    const changed = await planner.runPlan(tempRoot, changedTree, { executeGate: fakeExecute });
    assert.equal(changed.cached_count, 0);
    assert.equal(executions, 4, '源码树变化后缓存必须失效');
    const failedTree = plan(['public/story-ad/views/briefView.js'], { sourceTree: 'e'.repeat(40) });
    await assert.rejects(() => planner.runPlan(tempRoot, failedTree, {
      executeGate: async () => { throw new Error('synthetic-gate-failure'); },
    }), /synthetic-gate-failure/);
    const recoveredAfterFailure = await planner.runPlan(tempRoot, failedTree, { executeGate: fakeExecute });
    assert.equal(recoveredAfterFailure.cached_count, 0, '失败门禁不得写入成功缓存');
    assert.equal(executions, 6);
    console.log(JSON.stringify({
      passed: true,
      profiles: 7,
      unknown_falls_back_full: true,
      exact_tree_cache: true,
      changed_tree_invalidates: true,
      failed_gate_not_cached: true,
      non_home_full_platform: true,
      recovered_receipt_requires_health_and_idle_state: true,
    }));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
