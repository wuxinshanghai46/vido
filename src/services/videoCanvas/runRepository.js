const { executeBatch } = require('../../db/sqlite');
const { db } = require('./database');
const { id, nowIso, parseJson } = require('./common');

const NODE_TERMINAL = new Set(['succeeded', 'reused', 'failed', 'cancelled', 'skipped']);

function mapRun(row) {
  if (!row) return null;
  return { ...row, requested_node_ids: parseJson(row.requested_nodes_json, []) };
}
function mapNodeRun(row) {
  if (!row) return null;
  return { ...row, dependency_ids: parseJson(row.dependency_ids_json, []), artifact_ids: parseJson(row.artifact_ids_json, []), retryable: !!row.retryable };
}
function mapAttempt(row) { return row ? { ...row } : null; }
function getRun(runId) { return mapRun(db().prepare('SELECT * FROM video_canvas_runs WHERE id=?').get(runId)); }
function getNodeRun(nodeRunId) { return mapNodeRun(db().prepare('SELECT * FROM video_canvas_node_runs WHERE id=?').get(nodeRunId)); }
function getNodeRunByNodeId(runId, nodeId) { return mapNodeRun(db().prepare('SELECT * FROM video_canvas_node_runs WHERE run_id=? AND node_id=?').get(runId, nodeId)); }
function listNodeRuns(runId) { return db().prepare('SELECT * FROM video_canvas_node_runs WHERE run_id=? ORDER BY created_at,node_id').all(runId).map(mapNodeRun); }
function listAttempts(nodeRunId) { return db().prepare('SELECT * FROM video_canvas_node_attempts WHERE node_run_id=? ORDER BY attempt_no').all(nodeRunId).map(mapAttempt); }
function listEvents(runId, after = 0, limit = 500) {
  return db().prepare('SELECT * FROM video_canvas_events WHERE run_id=? AND sequence_no>? ORDER BY sequence_no LIMIT ?').all(runId, Number(after) || 0, Math.max(1, Math.min(1000, Number(limit) || 500))).map(row => ({ ...row, payload: parseJson(row.payload_json, {}) }));
}
function listRuns({ userId, includeAll = false, projectId = '', status = '', limit = 100 }) {
  const where = []; const params = [];
  if (!includeAll) { where.push('user_id=?'); params.push(userId); }
  if (projectId) { where.push('project_id=?'); params.push(projectId); }
  if (status && status !== 'all') { where.push('status=?'); params.push(status); }
  params.push(Math.max(1, Math.min(200, Number(limit) || 100)));
  return db().prepare(`SELECT * FROM video_canvas_runs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`).all(...params).map(mapRun);
}
function getRunBundle(runId) {
  const run = getRun(runId);
  if (!run) return null;
  const nodes = listNodeRuns(runId).map(node => ({ ...node, attempts: listAttempts(node.id) }));
  return { run, nodes, events: listEvents(runId, Math.max(0, latestSequence(runId) - 100), 100) };
}
function latestSequence(runId) { return Number(db().prepare('SELECT COALESCE(MAX(sequence_no),0) AS seq FROM video_canvas_events WHERE run_id=?').get(runId)?.seq || 0); }
function addEvent(runId, eventType, payload = {}, nodeRunId = null) {
  const eventId = id('vce'); const now = nowIso();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const sequence = latestSequence(runId) + 1;
    try {
      db().prepare('INSERT INTO video_canvas_events(id,run_id,node_run_id,sequence_no,event_type,payload_json,created_at) VALUES(?,?,?,?,?,?,?)').run(eventId, runId, nodeRunId, sequence, eventType, JSON.stringify(payload || {}), now);
      return { id: eventId, run_id: runId, node_run_id: nodeRunId, sequence_no: sequence, event_type: eventType, payload, created_at: now };
    } catch (error) {
      if (!/UNIQUE constraint/i.test(error.message) || attempt === 3) throw error;
    }
  }
}
function findIdempotency(userId, key) {
  return db().prepare('SELECT request_fingerprint,run_id FROM video_canvas_idempotency_keys WHERE user_id=? AND idempotency_key=?').get(userId, key) || null;
}
function findByIdempotency(userId, key) {
  const record = findIdempotency(userId, key);
  return record ? getRun(record.run_id) : null;
}
function findReusable({ projectId, nodeId, nodeType, inputFingerprint }) {
  const rows = db().prepare(`
    SELECT nr.* FROM video_canvas_node_runs nr
    JOIN video_canvas_runs r ON r.id=nr.run_id
    WHERE r.project_id=? AND nr.node_id=? AND nr.node_type=? AND nr.input_fingerprint=?
      AND nr.status IN ('succeeded','reused')
    ORDER BY nr.finished_at DESC LIMIT 10
  `).all(projectId, nodeId, nodeType, inputFingerprint).map(mapNodeRun);
  for (const row of rows) {
    if (!row.artifact_ids.length && !['text-input', 'condition'].includes(nodeType)) continue;
    const ready = row.artifact_ids.every(artifactId => db().prepare("SELECT 1 AS ok FROM video_canvas_artifacts WHERE id=? AND status='ready'").get(artifactId));
    if (ready) return row;
  }
  return null;
}
function createRun({ run, nodeRuns }) {
  const existingKey = findIdempotency(run.userId, run.idempotencyKey);
  if (existingKey) return {
    duplicate: existingKey.request_fingerprint === run.planFingerprint,
    idempotencyConflict: existingKey.request_fingerprint !== run.planFingerprint,
    run: getRun(existingKey.run_id),
  };
  const now = nowIso(); const runId = id('vcr');
  const operations = [
    { sql: `INSERT INTO video_canvas_runs(id,project_id,revision_id,user_id,status,plan_fingerprint,idempotency_key,requested_nodes_json,estimated_cost_min,estimated_cost_max,confirmed_cost_limit,actual_cost,queued_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, params: [runId, run.projectId, run.revisionId, run.userId, 'queued', run.planFingerprint, run.idempotencyKey, JSON.stringify(run.requestedNodeIds || []), run.estimatedCostMin || 0, run.estimatedCostMax || 0, run.confirmedCostLimit || 0, 0, now, now, now] },
    { sql: `INSERT INTO video_canvas_idempotency_keys(user_id,idempotency_key,request_fingerprint,run_id,created_at) VALUES(?,?,?,?,?)`, params: [run.userId, run.idempotencyKey, run.planFingerprint, runId, now] },
  ];
  const createdNodes = nodeRuns.map((item, index) => {
    const nodeRunId = id('vcnr');
    operations.push({ sql: `INSERT INTO video_canvas_node_runs(id,run_id,node_id,node_type,node_version,status,input_fingerprint,dependency_ids_json,reused_from_node_run_id,artifact_ids_json,estimated_cost,actual_cost,billing_state,retryable,priority,queued_at,finished_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, params: [nodeRunId, runId, item.nodeId, item.nodeType, item.nodeVersion || 1, item.status, item.inputFingerprint, JSON.stringify(item.dependencyNodeRunIds || []), item.reusedFromNodeRunId || null, JSON.stringify(item.artifactIds || []), item.estimatedCost || 0, 0, item.status === 'reused' ? 'not_submitted' : 'not_submitted', 0, Number(item.priority || (nodeRuns.length - index)), item.status === 'queued' ? now : null, item.status === 'reused' ? now : null, now, now] });
    return { ...item, id: nodeRunId };
  });
  operations.push({ sql: `INSERT INTO video_canvas_events(id,run_id,node_run_id,sequence_no,event_type,payload_json,created_at) VALUES(?,?,?,?,?,?,?)`, params: [id('vce'), runId, null, 1, 'run.created', JSON.stringify({ nodeCount: createdNodes.length }), now] });
  try {
    executeBatch(operations, { force: true });
  } catch (error) {
    if (!/UNIQUE constraint/i.test(error.message)) throw error;
    const raced = findIdempotency(run.userId, run.idempotencyKey);
    if (!raced) throw error;
    return {
      duplicate: raced.request_fingerprint === run.planFingerprint,
      idempotencyConflict: raced.request_fingerprint !== run.planFingerprint,
      run: getRun(raced.run_id),
    };
  }
  refreshRun(runId);
  return { duplicate: false, run: getRun(runId), nodeRuns: listNodeRuns(runId) };
}
function updateNodeRun(nodeRunId, patch = {}) {
  const current = getNodeRun(nodeRunId); if (!current) return null;
  const next = { ...current, ...patch };
  db().prepare(`UPDATE video_canvas_node_runs SET status=?,artifact_ids_json=?,actual_cost=?,billing_state=?,retryable=?,error_code=?,error_message=?,queued_at=?,started_at=?,finished_at=?,updated_at=? WHERE id=?`).run(
    next.status, JSON.stringify(next.artifact_ids || []), Number(next.actual_cost || 0), next.billing_state || 'not_submitted', next.retryable ? 1 : 0,
    next.error_code || null, next.error_message || null, next.queued_at || null, next.started_at || null, next.finished_at || null, nowIso(), nodeRunId,
  );
  return getNodeRun(nodeRunId);
}
function createAttempt(nodeRun, attemptNo) {
  const attemptId = id('vcna'); const now = nowIso();
  db().prepare(`INSERT INTO video_canvas_node_attempts(id,node_run_id,attempt_no,status,request_fingerprint,billing_state,estimated_cost,actual_cost,started_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(attemptId, nodeRun.id, attemptNo, 'running', nodeRun.input_fingerprint, 'not_submitted', nodeRun.estimated_cost || 0, 0, now);
  return mapAttempt(db().prepare('SELECT * FROM video_canvas_node_attempts WHERE id=?').get(attemptId));
}
function finishAttempt(attemptId, patch = {}) {
  db().prepare(`UPDATE video_canvas_node_attempts SET status=?,provider_task_id=?,billing_state=?,actual_cost=?,error_code=?,error_message=?,finished_at=? WHERE id=?`).run(patch.status || 'succeeded', patch.providerTaskId || null, patch.billingState || 'not_submitted', Number(patch.actualCost || 0), patch.errorCode || null, patch.errorMessage || null, nowIso(), attemptId);
  return mapAttempt(db().prepare('SELECT * FROM video_canvas_node_attempts WHERE id=?').get(attemptId));
}
function createProviderTask({ attemptId, provider, model = '', providerTaskId = '', requestFingerprint, submissionState = 'submitting', providerStatus = 'submitting', billingState = 'unknown', requestSummary = {} }) {
  const taskId = id('vcpt'); const now = nowIso();
  db().prepare(`INSERT INTO video_canvas_provider_tasks(id,node_attempt_id,provider,model,provider_task_id,request_fingerprint,submission_state,provider_status,billing_state,request_summary_json,response_summary_json,last_checked_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(taskId, attemptId, provider || 'unknown', model || '', providerTaskId || null, requestFingerprint, submissionState, providerStatus, billingState, JSON.stringify(requestSummary || {}), '{}', now, now, now);
  return db().prepare('SELECT * FROM video_canvas_provider_tasks WHERE id=?').get(taskId);
}
function updateProviderTask(taskId, patch = {}) {
  const current = db().prepare('SELECT * FROM video_canvas_provider_tasks WHERE id=?').get(taskId); if (!current) return null;
  const providerTaskId = patch.providerTaskId === undefined
    ? current.provider_task_id
    : (String(patch.providerTaskId || '').trim() || null);
  db().prepare(`UPDATE video_canvas_provider_tasks SET provider_task_id=?,submission_state=?,provider_status=?,billing_state=?,response_summary_json=?,last_checked_at=?,updated_at=? WHERE id=?`).run(providerTaskId, patch.submissionState ?? current.submission_state, patch.providerStatus ?? current.provider_status, patch.billingState ?? current.billing_state, JSON.stringify(patch.responseSummary || parseJson(current.response_summary_json, {})), nowIso(), nowIso(), taskId);
  return db().prepare('SELECT * FROM video_canvas_provider_tasks WHERE id=?').get(taskId);
}
function addCostEntry({ runId, nodeRunId = null, attemptId = null, entryType, provider = '', model = '', amountUsd = 0, billingState, quantity = 0, unit = '', metadata = {} }) {
  const entryId = id('vccl');
  db().prepare(`INSERT INTO video_canvas_cost_ledger(id,run_id,node_run_id,node_attempt_id,entry_type,provider,model,amount_usd,billing_state,quantity,unit,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(entryId, runId, nodeRunId, attemptId, entryType, provider || null, model || null, Number(amountUsd || 0), billingState, Number(quantity || 0), unit || null, JSON.stringify(metadata || {}), nowIso());
  return entryId;
}
function listCostEntries(runId) { return db().prepare('SELECT * FROM video_canvas_cost_ledger WHERE run_id=? ORDER BY created_at').all(runId).map(row => ({ ...row, metadata: parseJson(row.metadata_json, {}) })); }
function attemptCount(nodeRunId) { return Number(db().prepare('SELECT COUNT(*) AS n FROM video_canvas_node_attempts WHERE node_run_id=?').get(nodeRunId)?.n || 0); }
function claimNextQueued(workerId, leaseMs = 30000) {
  const now = nowIso(); const expires = new Date(Date.now() + leaseMs).toISOString();
  const row = db().prepare(`UPDATE video_canvas_node_runs SET status='running',started_at=COALESCE(started_at,?),updated_at=? WHERE id=(
    SELECT nr.id
    FROM video_canvas_node_runs nr
    JOIN video_canvas_runs r ON r.id=nr.run_id
    WHERE nr.status='queued'
      AND r.status IN ('queued','running')
      AND (
        SELECT COUNT(*)
        FROM video_canvas_node_runs active_nr
        JOIN video_canvas_runs active_r ON active_r.id=active_nr.run_id
        WHERE active_r.user_id=r.user_id AND active_nr.status='running'
      ) < COALESCE(
        (SELECT CAST(json_extract(s.settings_json,'$.concurrency') AS INTEGER) FROM video_canvas_settings s WHERE s.user_id=r.user_id),
        2
      )
    ORDER BY nr.priority DESC,nr.created_at
    LIMIT 1
  ) RETURNING *`).get(now, now);
  if (!row) return null;
  db().prepare('INSERT OR REPLACE INTO video_canvas_worker_leases(node_run_id,lease_owner,lease_expires_at,heartbeat_at) VALUES(?,?,?,?)').run(row.id, workerId, expires, now);
  const node = mapNodeRun(row);
  db().prepare("UPDATE video_canvas_runs SET status='running',started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND status='queued'").run(now, now, node.run_id);
  addEvent(node.run_id, 'node.running', { nodeId: node.node_id, nodeType: node.node_type }, node.id);
  return node;
}
function heartbeat(nodeRunId, workerId, leaseMs = 30000) {
  const now = nowIso(); const expires = new Date(Date.now() + leaseMs).toISOString();
  return db().prepare('UPDATE video_canvas_worker_leases SET lease_expires_at=?,heartbeat_at=? WHERE node_run_id=? AND lease_owner=?').run(expires, now, nodeRunId, workerId);
}
function releaseLease(nodeRunId) { db().prepare('DELETE FROM video_canvas_worker_leases WHERE node_run_id=?').run(nodeRunId); }
function unblockReady(runId) {
  const nodes = listNodeRuns(runId); const byNodeId = new Map(nodes.map(item => [item.node_id, item])); let changed = 0;
  for (const node of nodes.filter(item => item.status === 'blocked')) {
    const deps = node.dependency_ids.map(dep => byNodeId.get(dep)).filter(Boolean);
    if (deps.some(dep => ['failed', 'cancelled', 'skipped'].includes(dep.status))) {
      updateNodeRun(node.id, { status: 'skipped', error_code: 'UPSTREAM_FAILED', error_message: '上游节点失败或取消', finished_at: nowIso() }); changed += 1;
    } else if (deps.every(dep => ['succeeded', 'reused'].includes(dep.status))) {
      updateNodeRun(node.id, { status: 'queued', queued_at: nowIso() }); changed += 1;
    }
  }
  return changed;
}
function refreshRun(runId) {
  unblockReady(runId);
  const run = getRun(runId); if (!run) return null;
  const nodes = listNodeRuns(runId); const now = nowIso();
  const totalCost = nodes.reduce((sum, node) => sum + Number(node.actual_cost || 0), 0);
  let status = run.status;
  if (nodes.length && nodes.every(node => NODE_TERMINAL.has(node.status))) {
    const success = nodes.filter(node => ['succeeded', 'reused'].includes(node.status)).length;
    const failed = nodes.filter(node => node.status === 'failed').length;
    status = failed ? (success ? 'partially_completed' : 'failed') : (run.status === 'cancelled' ? 'cancelled' : 'completed');
  } else if (nodes.some(node => ['running', 'queued'].includes(node.status))) status = 'running';
  const finished = ['completed', 'partially_completed', 'failed', 'cancelled'].includes(status) ? now : null;
  db().prepare('UPDATE video_canvas_runs SET status=?,actual_cost=?,finished_at=COALESCE(finished_at,?),updated_at=? WHERE id=?').run(status, Number(totalCost.toFixed(6)), finished, now, runId);
  return getRun(runId);
}
function cancelRun(runId) {
  const now = nowIso();
  executeBatch([
    { sql: `UPDATE video_canvas_runs SET status='cancelled',finished_at=?,updated_at=? WHERE id=? AND status NOT IN ('completed','failed','cancelled')`, params: [now, now, runId] },
    { sql: `UPDATE video_canvas_node_runs SET status='cancelled',finished_at=?,updated_at=? WHERE run_id=? AND status IN ('blocked','queued')`, params: [now, now, runId] },
  ], { force: true });
  addEvent(runId, 'run.cancelled', {}, null);
  return getRun(runId);
}
function retryNode(nodeRunId) {
  const node = getNodeRun(nodeRunId); if (!node || !['failed', 'cancelled', 'skipped'].includes(node.status)) return null;
  updateNodeRun(nodeRunId, { status: 'queued', retryable: false, error_code: null, error_message: null, queued_at: nowIso(), started_at: null, finished_at: null });
  db().prepare("UPDATE video_canvas_runs SET status='running',finished_at=NULL,updated_at=? WHERE id=?").run(nowIso(), node.run_id);
  addEvent(node.run_id, 'node.retried', { nodeId: node.node_id }, node.id);
  return getNodeRun(nodeRunId);
}

module.exports = { addCostEntry, addEvent, attemptCount, cancelRun, claimNextQueued, createAttempt, createProviderTask, createRun, findByIdempotency, findReusable, finishAttempt, getNodeRun, getNodeRunByNodeId, getRun, getRunBundle, heartbeat, latestSequence, listCostEntries, listEvents, listNodeRuns, listRuns, refreshRun, releaseLease, retryNode, updateNodeRun, updateProviderTask };
