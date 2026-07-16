const { fingerprint } = require('./common');
const { validateGraph } = require('./graphService');
const { estimateNodeCost } = require('./nodeCatalog');
const runRepository = require('./runRepository');
const { findEnabledModel } = require('./modelCatalogService');

function createPlan({ project, revision, requestedNodeIds = [] }) {
  const validation = validateGraph(revision.graph);
  if (!validation.valid) return { valid: false, errors: validation.errors, warnings: validation.warnings };
  const requested = selectExecutionNodes(validation, requestedNodeIds);
  const graphNodeById = new Map(validation.graph.nodes.map(node => [node.id, node]));
  const preflightErrors = validateExecutionReadiness(validation.graph.nodes.filter(node => requested.has(node.id)));
  if (preflightErrors.length) return { valid: false, errors: preflightErrors, warnings: validation.warnings };
  const fingerprints = new Map();
  const items = [];
  for (const nodeId of validation.order) {
    if (!requested.has(nodeId)) continue;
    const node = graphNodeById.get(nodeId);
    const deps = (validation.incoming.get(nodeId) || []).map(edge => edge.source).filter(id => requested.has(id));
    const inputFingerprint = fingerprint({
      nodeType: node.type, nodeVersion: node.version, config: node.config,
      upstream: deps.map(id => fingerprints.get(id)), policyVersion: 1,
    });
    fingerprints.set(nodeId, inputFingerprint);
    const reusable = runRepository.findReusable({ projectId: project.id, nodeId, nodeType: node.type, inputFingerprint });
    const estimatedCost = reusable ? 0 : estimateNodeCost(node.type, node.config);
    items.push({
      nodeId, nodeType: node.type, nodeVersion: node.version, inputFingerprint, dependencyNodeIds: deps,
      action: reusable ? 'reuse' : 'run', estimatedCost,
      reusedFromNodeRunId: reusable?.id || '', artifactIds: reusable?.artifact_ids || [],
    });
  }
  const byId = new Map(items.map(item => [item.nodeId, item]));
  for (const item of items) {
    item.status = item.action === 'reuse' ? 'reused' : item.dependencyNodeIds.every(dep => byId.get(dep)?.action === 'reuse') ? 'queued' : 'blocked';
  }
  const estimated = Number(items.reduce((sum, item) => sum + item.estimatedCost, 0).toFixed(6));
  const plan = {
    valid: true, projectId: project.id, revisionId: revision.id, graphFingerprint: revision.graph_fingerprint,
    requestedNodeIds: [...requested], items, estimatedCostMin: estimated, estimatedCostMax: estimated,
    paidNodeCount: items.filter(item => item.estimatedCost > 0).length,
    reusedNodeCount: items.filter(item => item.action === 'reuse').length,
    warnings: validation.warnings, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
  plan.planFingerprint = fingerprint({ projectId: plan.projectId, revisionId: plan.revisionId, graphFingerprint: plan.graphFingerprint, items: plan.items.map(item => ({ nodeId: item.nodeId, inputFingerprint: item.inputFingerprint, action: item.action, estimatedCost: item.estimatedCost })) });
  return plan;
}

function validateExecutionReadiness(nodes) {
  const errors = [];
  for (const node of nodes) {
    if (node.config?.migrationNeedsReview) {
      errors.push({
        code: 'MIGRATION_REVIEW_REQUIRED',
        message: `${node.label || node.type} 是旧画布迁移节点，请先确认：${(node.config.migrationReviewReasons || ['配置待确认']).join('、')}`,
        nodeId: node.id,
      });
    }
    if (['text-to-video', 'image-to-video'].includes(node.type)) {
      const provider = String(node.config?.provider || '').trim();
      const model = String(node.config?.model || '').trim();
      if (!provider || !model || !findEnabledModel('video', provider, model)) {
        errors.push({ code: 'VIDEO_MODEL_REQUIRED', message: `${node.label || node.type} 必须选择一个当前已启用的视频模型`, nodeId: node.id });
      }
    }
    if (['image-generate', 'image-edit', 'character'].includes(node.type)) {
      const provider = String(node.config?.provider || '').trim();
      const model = String(node.config?.model || '').trim();
      if (!provider || !model || !findEnabledModel('image', provider, model)) {
        errors.push({ code: 'IMAGE_MODEL_REQUIRED', message: `${node.label || node.type} 必须选择一个当前已启用的图片模型`, nodeId: node.id });
      }
    }
  }
  return errors;
}

function selectExecutionNodes(validation, requestedNodeIds) {
  if (!Array.isArray(requestedNodeIds) || !requestedNodeIds.length) return new Set(validation.order);
  const wanted = new Set(requestedNodeIds.map(String)); const incoming = validation.incoming;
  const include = id => {
    if (!id || wanted.has(`__visited__${id}`)) return;
    wanted.add(`__visited__${id}`); wanted.add(id);
    for (const edge of incoming.get(id) || []) include(edge.source);
  };
  requestedNodeIds.map(String).forEach(include);
  return new Set([...wanted].filter(id => !id.startsWith('__visited__')));
}

function materializeNodeRuns(plan) {
  const selected = new Set(plan.items.map(item => item.nodeId));
  return plan.items.map(item => ({
    ...item,
    dependencyNodeRunIds: item.dependencyNodeIds.filter(id => selected.has(id)),
  }));
}

module.exports = { createPlan, materializeNodeRuns, validateExecutionReadiness };
