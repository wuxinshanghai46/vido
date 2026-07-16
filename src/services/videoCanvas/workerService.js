const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db } = require('./database');
const projectRepository = require('./projectRepository');
const runRepository = require('./runRepository');
const artifactRepository = require('./artifactRepository');
const { getExecutor } = require('./executors/registry');
const { classifyError, extensionFromUrl } = require('./executors/helpers');
const { nowIso } = require('./common');
const settingsRepository = require('./settingsRepository');

class VideoCanvasWorker {
  constructor(options = {}) {
    this.workerId = options.workerId || `vcw_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
    this.concurrency = Math.max(1, Math.min(8, Number(options.concurrency || process.env.VIDEO_CANVAS_WORKER_CONCURRENCY) || 3));
    this.pollMs = Math.max(250, Number(options.pollMs) || 750);
    this.stub = options.stub === true || process.env.VIDEO_CANVAS_EXECUTION_MODE === 'stub';
    this.active = new Map(); this.timer = null; this.running = false;
  }

  start() {
    if (this.running) return this;
    this.running = true; this.recoverExpiredLeases(); this.schedule(0); return this;
  }
  stop() { this.running = false; if (this.timer) clearTimeout(this.timer); this.timer = null; }
  schedule(delay = this.pollMs) {
    if (!this.running) return;
    this.timer = setTimeout(() => this.tick().finally(() => this.schedule()), delay);
    this.timer.unref?.();
  }
  async tick() {
    while (this.running && this.active.size < this.concurrency) {
      const nodeRun = runRepository.claimNextQueued(this.workerId);
      if (!nodeRun) break;
      const promise = this.executeNode(nodeRun).catch(error => console.error('[VideoCanvasWorker] node failed:', error.message)).finally(() => this.active.delete(nodeRun.id));
      this.active.set(nodeRun.id, promise);
    }
  }

  async executeNode(nodeRun) {
    const run = runRepository.getRun(nodeRun.run_id);
    const revision = run && projectRepository.getRevision(run.revision_id);
    const project = run && projectRepository.getProject(run.project_id);
    const node = revision?.graph?.nodes?.find(item => item.id === nodeRun.node_id);
    if (!run || !revision || !project || !node) return this.failBeforeAttempt(nodeRun, 'MISSING_RUN_CONTEXT', '运行上下文或节点不存在');
    if (run.status === 'cancelled') return this.cancelNode(nodeRun, '运行已取消');
    const inputArtifacts = this.inputArtifacts(nodeRun);
    const attemptNo = runRepository.attemptCount(nodeRun.id) + 1;
    const attempt = runRepository.createAttempt(nodeRun, attemptNo);
    let providerTask = null;
    if (Number(nodeRun.estimated_cost || 0) > 0) {
      providerTask = runRepository.createProviderTask({
        attemptId: attempt.id, provider: node.config.provider || 'auto', model: node.config.model || '',
        requestFingerprint: nodeRun.input_fingerprint, submissionState: 'submitting', providerStatus: 'submitting', billingState: 'not_submitted',
        requestSummary: safeRequestSummary(node),
      });
      runRepository.addCostEntry({ runId: run.id, nodeRunId: nodeRun.id, attemptId: attempt.id, entryType: 'estimated', provider: node.config.provider || 'auto', model: node.config.model || '', amountUsd: nodeRun.estimated_cost, billingState: 'not_submitted' });
    }
    const heartbeat = setInterval(() => runRepository.heartbeat(nodeRun.id, this.workerId), 10000); heartbeat.unref?.();
    try {
      const executor = getExecutor(node.type);
      const result = await executor.execute(node, {
        run, project, revision, nodeRun, attempt, inputArtifacts, stub: this.stub,
        getArtifact: artifactRepository.getArtifact,
        outputPath: extension => artifactRepository.outputPath(project.id, nodeRun.id, extension),
        onProviderRequestStarted: info => {
          if (!providerTask) providerTask = runRepository.createProviderTask({ attemptId: attempt.id, provider: info.provider || 'unknown', model: info.model || '', requestFingerprint: nodeRun.input_fingerprint });
          providerTask = runRepository.updateProviderTask(providerTask.id, { submissionState: 'request_started', providerStatus: 'submitting', billingState: 'unknown' });
        },
        onProviderSubmitted: info => {
          if (!providerTask) providerTask = runRepository.createProviderTask({ attemptId: attempt.id, provider: info.provider || 'unknown', model: info.model || '', requestFingerprint: nodeRun.input_fingerprint });
          providerTask = runRepository.updateProviderTask(providerTask.id, { providerTaskId: info.providerTaskId || '', submissionState: 'submitted', providerStatus: 'running', billingState: info.billingState || 'unknown' });
        },
      });
      const latestRun = runRepository.getRun(run.id);
      if (latestRun?.status === 'cancelled') {
        runRepository.finishAttempt(attempt.id, { status: 'cancelled', providerTaskId: result.providerTaskId || providerTask?.provider_task_id || '', billingState: result.billingState || (providerTask ? 'unknown' : 'not_submitted'), actualCost: result.actualCost || 0, errorCode: 'RUN_CANCELLED', errorMessage: '结果返回时运行已取消' });
        if (providerTask) runRepository.updateProviderTask(providerTask.id, { providerTaskId: result.providerTaskId || providerTask.provider_task_id || '', submissionState: 'finished', providerStatus: 'cancelled_late', billingState: result.billingState || 'unknown' });
        return this.cancelNode(nodeRun, '结果返回时运行已取消');
      }
      const artifactIds = await this.materializeArtifacts({ project, nodeRun, result });
      const billingState = result.billingState || (providerTask ? 'confirmed' : 'not_submitted');
      const actualCost = Number(result.actualCost || 0);
      runRepository.finishAttempt(attempt.id, { status: 'succeeded', providerTaskId: result.providerTaskId || providerTask?.provider_task_id || '', billingState, actualCost });
      if (providerTask) runRepository.updateProviderTask(providerTask.id, { providerTaskId: result.providerTaskId || providerTask.provider_task_id || '', submissionState: 'finished', providerStatus: 'succeeded', billingState, responseSummary: { artifactCount: artifactIds.length } });
      runRepository.updateNodeRun(nodeRun.id, { status: 'succeeded', artifact_ids: artifactIds, actual_cost: actualCost, billing_state: billingState, retryable: false, error_code: null, error_message: null, finished_at: nowIso() });
      if (actualCost || billingState !== 'not_submitted') runRepository.addCostEntry({ runId: run.id, nodeRunId: nodeRun.id, attemptId: attempt.id, entryType: 'actual', provider: result.provider || node.config.provider || 'auto', model: result.model || node.config.model || '', amountUsd: actualCost, billingState });
      runRepository.addEvent(run.id, 'node.succeeded', { nodeId: node.id, artifactIds, billingState, actualCost }, nodeRun.id);
    } catch (error) {
      const classified = classifyError(error);
      const submitted = providerTask && ['request_started', 'submitted', 'finished'].includes(providerTask.submission_state);
      const billingState = submitted ? 'unknown' : 'not_submitted';
      const conservativeCost = billingState === 'unknown' ? Number(nodeRun.estimated_cost || 0) : 0;
      runRepository.finishAttempt(attempt.id, { status: 'failed', providerTaskId: providerTask?.provider_task_id || '', billingState, actualCost: conservativeCost, errorCode: classified.code, errorMessage: classified.message });
      if (providerTask) runRepository.updateProviderTask(providerTask.id, { submissionState: submitted ? 'submitted' : 'failed_before_confirmation', providerStatus: 'failed', billingState, responseSummary: { errorCode: classified.code, errorMessage: classified.message } });
      const userSettings = settingsRepository.getSettings(run.user_id).settings;
      const canAutoRetry = userSettings.autoRetry > 0 && classified.retryable && Number(nodeRun.estimated_cost || 0) === 0 && attemptNo <= userSettings.autoRetry;
      runRepository.updateNodeRun(nodeRun.id, { status: canAutoRetry ? 'queued' : 'failed', actual_cost: conservativeCost, billing_state: billingState, retryable: classified.retryable, error_code: classified.code, error_message: classified.message, queued_at: canAutoRetry ? nowIso() : null, finished_at: canAutoRetry ? null : nowIso() });
      if (billingState === 'unknown') runRepository.addCostEntry({ runId: run.id, nodeRunId: nodeRun.id, attemptId: attempt.id, entryType: 'billing_unknown', provider: node.config.provider || 'auto', model: node.config.model || '', amountUsd: conservativeCost, billingState });
      runRepository.addEvent(run.id, 'node.failed', { nodeId: node.id, errorCode: classified.code, error: classified.message, retryable: classified.retryable, billingState }, nodeRun.id);
    } finally {
      clearInterval(heartbeat); runRepository.releaseLease(nodeRun.id); const updated = runRepository.refreshRun(run.id);
      if (updated && ['completed', 'partially_completed', 'failed', 'cancelled'].includes(updated.status)) runRepository.addEvent(run.id, `run.${updated.status}`, { actualCost: updated.actual_cost });
    }
  }

  inputArtifacts(nodeRun) {
    const artifacts = [];
    for (const dependencyNodeId of nodeRun.dependency_ids) {
      const dependency = runRepository.getNodeRunByNodeId(nodeRun.run_id, dependencyNodeId);
      for (const artifactId of dependency?.artifact_ids || []) {
        const artifact = artifactRepository.getArtifact(artifactId);
        if (artifact?.status === 'ready') artifacts.push(artifact);
      }
    }
    return artifacts;
  }
  async materializeArtifacts({ project, nodeRun, result }) {
    if (Array.isArray(result.reuseArtifactIds)) return [...new Set(result.reuseArtifactIds)].filter(id => artifactRepository.getArtifact(id));
    const ids = [];
    for (const spec of result.artifacts || []) {
      if (spec.kind === 'text' || spec.kind === 'json') {
        ids.push(artifactRepository.createTextArtifact({ projectId: project.id, nodeRunId: nodeRun.id, text: spec.text, inputFingerprint: nodeRun.input_fingerprint, kind: spec.kind, metadata: spec.metadata }).id); continue;
      }
      let filePath = spec.filePath || '';
      if (spec.remoteUrl) filePath = await artifactRepository.downloadRemote({ projectId: project.id, nodeRunId: nodeRun.id, url: spec.remoteUrl, extension: extensionFromUrl(spec.remoteUrl, spec.kind === 'image' ? '.png' : '.bin') });
      if (filePath && !path.resolve(filePath).startsWith(path.resolve(artifactRepository.ROOT) + path.sep)) filePath = artifactRepository.importFile({ projectId: project.id, nodeRunId: nodeRun.id, sourcePath: filePath });
      const artifact = artifactRepository.createArtifact({ projectId: project.id, nodeRunId: nodeRun.id, kind: spec.kind, filePath, inputFingerprint: nodeRun.input_fingerprint, metadata: spec.metadata || {} });
      ids.push(artifact.id);
    }
    if (!ids.length && !['condition'].includes(nodeRun.node_type)) throw new Error('节点没有产生可用产物');
    return ids;
  }
  failBeforeAttempt(nodeRun, code, message) {
    runRepository.updateNodeRun(nodeRun.id, { status: 'failed', error_code: code, error_message: message, retryable: false, finished_at: nowIso() });
    runRepository.addEvent(nodeRun.run_id, 'node.failed', { nodeId: nodeRun.node_id, errorCode: code, error: message }, nodeRun.id);
    runRepository.releaseLease(nodeRun.id); runRepository.refreshRun(nodeRun.run_id);
  }
  cancelNode(nodeRun, message) {
    runRepository.updateNodeRun(nodeRun.id, { status: 'cancelled', error_code: 'RUN_CANCELLED', error_message: message, retryable: true, finished_at: nowIso() });
    runRepository.releaseLease(nodeRun.id); runRepository.refreshRun(nodeRun.run_id);
  }
  recoverExpiredLeases() {
    const now = nowIso();
    const expired = db().prepare(`SELECT l.node_run_id FROM video_canvas_worker_leases l WHERE l.lease_expires_at<?`).all(now);
    for (const lease of expired) {
      const node = runRepository.getNodeRun(lease.node_run_id); if (!node || node.status !== 'running') { runRepository.releaseLease(lease.node_run_id); continue; }
      const provider = db().prepare(`SELECT pt.* FROM video_canvas_provider_tasks pt JOIN video_canvas_node_attempts a ON a.id=pt.node_attempt_id WHERE a.node_run_id=? ORDER BY a.attempt_no DESC LIMIT 1`).get(node.id);
      if (provider?.provider_task_id) {
        runRepository.updateNodeRun(node.id, { status: 'failed', billing_state: 'unknown', actual_cost: node.estimated_cost, retryable: false, error_code: 'WORKER_INTERRUPTED_PROVIDER_SUBMITTED', error_message: 'Worker 中断，供应商任务已提交，需人工核对后再处理', finished_at: now });
      } else {
        runRepository.updateNodeRun(node.id, { status: 'queued', billing_state: 'not_submitted', retryable: true, error_code: 'WORKER_INTERRUPTED', error_message: 'Worker 中断，任务已安全重新排队', queued_at: now, started_at: null, finished_at: null });
      }
      runRepository.releaseLease(node.id); runRepository.refreshRun(node.run_id);
    }
    return expired.length;
  }
}

function safeRequestSummary(node) {
  const config = node.config || {};
  return { nodeType: node.type, model: config.model || '', provider: config.provider || '', duration: Number(config.duration || 0), promptLength: String(config.prompt || config.text || '').length };
}

let embedded = null;
function startEmbeddedWorker(options = {}) {
  if (!embedded) embedded = new VideoCanvasWorker(options).start();
  return embedded;
}

module.exports = { VideoCanvasWorker, startEmbeddedWorker };
