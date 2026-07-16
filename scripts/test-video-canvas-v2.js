const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

process.env.DB_ENABLED = 'true';
const TEST_DB_PATH = path.join(__dirname, '..', 'outputs', `video-canvas-v2-test-${process.pid}.sqlite`);
process.env.DB_PATH = TEST_DB_PATH;

const sqlite = require('../src/db/sqlite');
const testDatabase = sqlite.openDatabase({ force: true, fresh: true });
for (const migrationFile of fs.readdirSync(path.join(__dirname, '..', 'src', 'db', 'migrations')).filter(name => name.endsWith('.sql')).sort()) {
  testDatabase.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', migrationFile), 'utf8'));
}

const { db } = require('../src/services/videoCanvas/database');
const projectRepository = require('../src/services/videoCanvas/projectRepository');
const runRepository = require('../src/services/videoCanvas/runRepository');
const { createPlan, materializeNodeRuns } = require('../src/services/videoCanvas/planService');
const { normalizeGraph, validateGraph } = require('../src/services/videoCanvas/graphService');
const { TEMPLATES } = require('../src/services/videoCanvas/domainPacks');
const { getModelCatalog } = require('../src/services/videoCanvas/modelCatalogService');
const { convertDrawflow, readLegacy } = require('../src/services/videoCanvas/migrationService');
const { VideoCanvasWorker } = require('../src/services/videoCanvas/workerService');
const { EXECUTORS } = require('../src/services/videoCanvas/executors/registry');
const artifactRepository = require('../src/services/videoCanvas/artifactRepository');
const settingsRepository = require('../src/services/videoCanvas/settingsRepository');

const TEST_USER = `__vc_test_${process.pid}_${Date.now()}`;
const projectIds = [];
const originalTextExecutor = EXECUTORS.get('text-input');
const originalImageExecutor = EXECUTORS.get('image-generate');

function verifyPythonReturningCommit() {
  const dbPath = path.join(__dirname, '..', 'outputs', `vc-python-returning-${process.pid}.sqlite`);
  const script = `
    const { openDatabase, closeDatabase } = require('./src/db/sqlite');
    const db = openDatabase({ force: true });
    db.exec("CREATE TABLE queue(id TEXT PRIMARY KEY,status TEXT NOT NULL); INSERT INTO queue VALUES('one','queued');");
    const first = db.prepare("UPDATE queue SET status='running' WHERE id=(SELECT id FROM queue WHERE status='queued' LIMIT 1) RETURNING *").get();
    const second = db.prepare("UPDATE queue SET status='running' WHERE id=(SELECT id FROM queue WHERE status='queued' LIMIT 1) RETURNING *").get();
    if (!first || second) throw new Error('Python SQLite UPDATE RETURNING claim was not committed exactly once');
    closeDatabase();
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DB_ENABLED: 'true', DB_PATH: dbPath, SQLITE_DRIVER: 'python' },
    encoding: 'utf8',
    timeout: 30000,
  });
  try {
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Python SQLite returning test failed');
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(`${dbPath}${suffix}`, { force: true }); } catch {}
    }
  }
}

function node(id, type, config = {}, x = 0, y = 0) {
  return { id, type, version: 1, label: id, config, position: { x, y } };
}

function edge(id, source, sourcePort, target, targetPort) {
  return { id, source, sourcePort, target, targetPort };
}

function graph(nodes, edges = []) {
  return normalizeGraph({ nodes, edges });
}

function createProject(name, value) {
  const created = projectRepository.createProject({ userId: TEST_USER, name, domainPack: 'blank', graph: value });
  projectIds.push(created.project.id);
  return created;
}

function createRunFromPlan(bundle, plan, key) {
  return runRepository.createRun({
    run: {
      projectId: bundle.project.id,
      revisionId: bundle.revision.id,
      userId: TEST_USER,
      planFingerprint: plan.planFingerprint,
      idempotencyKey: key,
      requestedNodeIds: plan.requestedNodeIds,
      estimatedCostMin: plan.estimatedCostMin,
      estimatedCostMax: plan.estimatedCostMax,
      confirmedCostLimit: plan.estimatedCostMax,
    },
    nodeRuns: materializeNodeRuns(plan),
  });
}

async function drainRun(runId, worker = new VideoCanvasWorker({ stub: true })) {
  for (let index = 0; index < 100; index += 1) {
    const claimed = runRepository.claimNextQueued(worker.workerId);
    if (claimed) await worker.executeNode(claimed);
    const current = runRepository.refreshRun(runId);
    if (['completed', 'partially_completed', 'failed', 'cancelled'].includes(current.status)) return current;
  }
  throw new Error(`run did not finish: ${runId}`);
}

function cleanup() {
  EXECUTORS.set('text-input', originalTextExecutor);
  EXECUTORS.set('image-generate', originalImageExecutor);
  db().prepare('DELETE FROM video_canvas_idempotency_keys WHERE user_id=?').run(TEST_USER);
  db().prepare('DELETE FROM video_canvas_settings WHERE user_id=?').run(TEST_USER);
  db().prepare('DELETE FROM video_canvas_projects WHERE user_id=?').run(TEST_USER);
  const root = path.resolve(artifactRepository.ARTIFACT_ROOT);
  for (const projectId of projectIds) {
    const target = path.resolve(root, projectId);
    if (target.startsWith(`${root}${path.sep}`) && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  }
  sqlite.closeDatabase();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true }); } catch {}
  }
}

async function main() {
  try {
    verifyPythonReturningCommit();
    for (const template of TEMPLATES) {
      const validation = validateGraph(template.graph);
      assert.equal(validation.valid, true, `${template.id} template must remain structurally valid`);
    }

    const invalidTypes = validateGraph(graph([
      node('text', 'text-input', { text: 'hello' }),
      node('image', 'image-generate', { prompt: 'image' }),
    ], [edge('bad', 'image', 'image', 'text', 'text')]));
    assert.equal(invalidTypes.valid, false);
    assert(invalidTypes.errors.some(item => item.code === 'UNKNOWN_PORT' || item.code === 'PORT_TYPE_MISMATCH'));

    const cyclic = validateGraph(graph([
      node('a', 'select'), node('b', 'select'),
    ], [edge('a-b', 'a', 'output', 'b', 'input'), edge('b-a', 'b', 'output', 'a', 'input')]));
    assert.equal(cyclic.valid, false);
    assert(cyclic.errors.some(item => item.code === 'GRAPH_CYCLE'));

    const revisionProject = createProject('revision-lock', graph([node('input', 'text-input', { text: 'v1' })]));
    const second = projectRepository.saveRevision({
      projectId: revisionProject.project.id,
      userId: TEST_USER,
      baseRevisionId: revisionProject.revision.id,
      graph: graph([node('input', 'text-input', { text: 'v2' })]),
    });
    assert.equal(second.revision.revision_no, 2);
    const conflict = projectRepository.saveRevision({
      projectId: revisionProject.project.id,
      userId: TEST_USER,
      baseRevisionId: revisionProject.revision.id,
      graph: graph([node('input', 'text-input', { text: 'stale' })]),
    });
    assert.equal(conflict.conflict, true);

    settingsRepository.saveSettings(TEST_USER, { quality: 'preview', maxCostUsd: 5, autoRetry: 0, concurrency: 1 });
    const concurrencyProject = createProject('per-user-concurrency', graph([
      node('one', 'text-input', { text: 'one' }),
      node('two', 'text-input', { text: 'two' }),
    ]));
    const concurrencyPlan = createPlan({ project: concurrencyProject.project, revision: concurrencyProject.revision });
    const concurrencyRun = createRunFromPlan(concurrencyProject, concurrencyPlan, `concurrency_${Date.now()}`);
    const concurrencyWorker = new VideoCanvasWorker({ stub: true });
    const firstClaim = runRepository.claimNextQueued(concurrencyWorker.workerId);
    assert(firstClaim);
    assert.equal(runRepository.claimNextQueued(`${concurrencyWorker.workerId}_second`), null, 'per-user concurrency=1 must prevent a second simultaneous claim');
    await concurrencyWorker.executeNode(firstClaim);
    const secondClaim = runRepository.claimNextQueued(concurrencyWorker.workerId);
    assert(secondClaim);
    await concurrencyWorker.executeNode(secondClaim);
    assert.equal(runRepository.refreshRun(concurrencyRun.run.id).status, 'completed');

    EXECUTORS.set('text-input', {
      execute: async () => {
        const error = new Error('safe retry is disabled by user settings');
        error.code = 'TEMPORARY_FREE_FAILURE';
        error.retryable = true;
        throw error;
      },
    });
    const noRetryProject = createProject('auto-retry-off', graph([node('retry', 'text-input', { text: 'retry' })]));
    const noRetryPlan = createPlan({ project: noRetryProject.project, revision: noRetryProject.revision });
    const noRetryRun = createRunFromPlan(noRetryProject, noRetryPlan, `no_retry_${Date.now()}`);
    const noRetryWorker = new VideoCanvasWorker({ stub: true });
    const noRetryClaim = runRepository.claimNextQueued(noRetryWorker.workerId);
    await noRetryWorker.executeNode(noRetryClaim);
    assert.equal(runRepository.getNodeRun(noRetryClaim.id).status, 'failed');
    assert.equal(runRepository.attemptCount(noRetryClaim.id), 1);
    EXECUTORS.set('text-input', originalTextExecutor);
    settingsRepository.saveSettings(TEST_USER, { quality: 'preview', maxCostUsd: 5, autoRetry: 0, concurrency: 2 });

    const missingModelProject = createProject('missing-model', graph([
      node('video', 'text-to-video', { prompt: 'test', duration: 5 }),
    ]));
    const missingModelPlan = createPlan({ project: missingModelProject.project, revision: missingModelProject.revision });
    assert.equal(missingModelPlan.valid, false);
    assert(missingModelPlan.errors.some(item => item.code === 'VIDEO_MODEL_REQUIRED'));

    for (const legacy of readLegacy()) {
      const converted = convertDrawflow(legacy.drawflow);
      assert.equal(validateGraph(converted).valid, true, `legacy workflow ${legacy.id} must convert structurally`);
    }

    const modelCatalog = getModelCatalog();
    const imageModel = modelCatalog.image[0];
    const videoModel = modelCatalog.video[0];
    if (imageModel && videoModel) {
      const paidGraph = graph([
        node('brief', 'text-input', { text: 'test product' }, 0, 0),
        node('image', 'image-generate', { prompt: 'clean product hero', provider: imageModel.providerId, model: imageModel.modelId, aspectRatio: '16:9' }, 300, 0),
        node('clip', 'image-to-video', { prompt: 'slow push in', provider: videoModel.providerId, model: videoModel.modelId, duration: 5, aspectRatio: '16:9' }, 600, 0),
        node('merge', 'merge', {}, 900, 0),
      ], [
        edge('e1', 'brief', 'text', 'image', 'prompt'),
        edge('e2', 'image', 'image', 'clip', 'image'),
        edge('e3', 'brief', 'text', 'clip', 'prompt'),
        edge('e4', 'clip', 'video', 'merge', 'video'),
      ]);
      const paidProject = createProject('paid-stub-pipeline', paidGraph);
      const paidPlan = createPlan({ project: paidProject.project, revision: paidProject.revision });
      assert.equal(paidPlan.valid, true);
      assert.equal(paidPlan.paidNodeCount, 2);
      assert(paidPlan.estimatedCostMax > 0);

      const key = `paid_${Date.now()}`;
      const firstRun = createRunFromPlan(paidProject, paidPlan, key);
      assert.equal(firstRun.duplicate, false);
      const duplicate = createRunFromPlan(paidProject, paidPlan, key);
      assert.equal(duplicate.duplicate, true);
      assert.equal(duplicate.run.id, firstRun.run.id);
      const idempotencyConflict = runRepository.createRun({
        run: { projectId: paidProject.project.id, revisionId: paidProject.revision.id, userId: TEST_USER, planFingerprint: `${paidPlan.planFingerprint}_changed`, idempotencyKey: key },
        nodeRuns: [],
      });
      assert.equal(idempotencyConflict.idempotencyConflict, true);

      const completed = await drainRun(firstRun.run.id);
      const completedNodes = runRepository.listNodeRuns(firstRun.run.id);
      assert.equal(completed.status, 'completed', JSON.stringify(completedNodes.map(item => ({ node: item.node_id, status: item.status, error: item.error_message, code: item.error_code }))));
      assert(completedNodes.every(item => ['succeeded', 'reused'].includes(item.status)));
      assert.equal(db().prepare(`SELECT COUNT(*) AS n FROM video_canvas_provider_tasks pt JOIN video_canvas_node_attempts a ON a.id=pt.node_attempt_id JOIN video_canvas_node_runs nr ON nr.id=a.node_run_id WHERE nr.run_id=?`).get(firstRun.run.id).n, 2);

      const reusePlan = createPlan({ project: paidProject.project, revision: paidProject.revision });
      assert.equal(reusePlan.estimatedCostMax, 0);
      assert.equal(reusePlan.reusedNodeCount, 4);
      const reuseRun = createRunFromPlan(paidProject, reusePlan, `reuse_${Date.now()}`);
      assert.equal(reuseRun.run.status, 'completed');

      const cancelGraph = graph([node('cancel', 'text-input', { text: `cancel-${Date.now()}` })]);
      const cancelProject = createProject('cancel-before-start', cancelGraph);
      const cancelPlan = createPlan({ project: cancelProject.project, revision: cancelProject.revision });
      const cancelRun = createRunFromPlan(cancelProject, cancelPlan, `cancel_${Date.now()}`);
      runRepository.cancelRun(cancelRun.run.id);
      assert.equal(runRepository.getRun(cancelRun.run.id).status, 'cancelled');
      assert(runRepository.listNodeRuns(cancelRun.run.id).every(item => item.status === 'cancelled'));

      let releaseLate;
      let startedLate;
      const started = new Promise(resolve => { startedLate = resolve; });
      EXECUTORS.set('text-input', {
        execute: async () => {
          startedLate();
          return new Promise(resolve => { releaseLate = () => resolve({ artifacts: [{ kind: 'text', text: 'late result' }] }); });
        },
      });
      const lateProject = createProject('late-result', graph([node('late', 'text-input', { text: `late-${Date.now()}` })]));
      const latePlan = createPlan({ project: lateProject.project, revision: lateProject.revision });
      const lateRun = createRunFromPlan(lateProject, latePlan, `late_${Date.now()}`);
      const lateWorker = new VideoCanvasWorker({ stub: true });
      const claimedLate = runRepository.claimNextQueued(lateWorker.workerId);
      const executingLate = lateWorker.executeNode(claimedLate);
      await started;
      runRepository.cancelRun(lateRun.run.id);
      releaseLate();
      await executingLate;
      const lateNode = runRepository.getNodeRun(claimedLate.id);
      assert.equal(lateNode.status, 'cancelled');
      assert.equal(lateNode.artifact_ids.length, 0);
      EXECUTORS.set('text-input', originalTextExecutor);

      EXECUTORS.set('image-generate', {
        execute: async (_node, context) => {
          context.onProviderRequestStarted({ provider: imageModel.providerId, model: imageModel.modelId });
          const error = new Error('simulated provider timeout after request start');
          error.code = 'PROVIDER_TIMEOUT';
          error.retryable = true;
          throw error;
        },
      });
      const failureProject = createProject('billing-unknown', graph([
        node('image', 'image-generate', { prompt: 'failure test', provider: imageModel.providerId, model: imageModel.modelId }),
      ]));
      const failurePlan = createPlan({ project: failureProject.project, revision: failureProject.revision });
      const failureRun = createRunFromPlan(failureProject, failurePlan, `failure_${Date.now()}`);
      const failureWorker = new VideoCanvasWorker({ stub: false });
      const claimedFailure = runRepository.claimNextQueued(failureWorker.workerId);
      await failureWorker.executeNode(claimedFailure);
      const failedNode = runRepository.getNodeRun(claimedFailure.id);
      assert.equal(failedNode.status, 'failed');
      assert.equal(failedNode.billing_state, 'unknown');
      assert.equal(runRepository.attemptCount(failedNode.id), 1);
      assert.equal(runRepository.listCostEntries(failureRun.run.id).filter(item => item.entry_type === 'billing_unknown').length, 1);
      EXECUTORS.set('image-generate', originalImageExecutor);
    } else {
      console.warn('VIDEO_CANVAS_PAID_STUB_SKIPPED no enabled image/video model is configured');
    }

    console.log(`VIDEO_CANVAS_V2_OK templates=${TEMPLATES.length} legacy=${readLegacy().length} projects=${projectIds.length}`);
  } finally {
    cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
