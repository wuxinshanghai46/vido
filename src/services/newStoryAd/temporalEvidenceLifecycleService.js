const temporalEvidenceGraph = require('./temporalEvidenceGraphService');

/**
 * 集中负责编译和校验 V2.0 时序证据图，避免把协议生命周期继续堆进主服务。
 */
function compile({ ctx = {}, blueprint = {}, shots = [], existingGraph = null } = {}) {
  const graph = temporalEvidenceGraph.buildGraph({ ctx, blueprint, shots, existingGraph });
  const validation = temporalEvidenceGraph.validateGraph(graph);
  if (!validation.pass) {
    const error = new Error(`剧情广告 V2.0 时序证据图校验失败：${validation.errors.join('；')}`);
    error.code = 'TEMPORAL_EVIDENCE_GRAPH_INVALID';
    error.validation = validation;
    throw error;
  }
  return {
    graph,
    shots: temporalEvidenceGraph.attachGraphToShots(shots, graph),
  };
}

function compileForTask({ storage, taskId = '', ctx = {}, blueprint = {}, shots = [], persist = true } = {}) {
  const compiled = compile({
    ctx,
    blueprint,
    shots,
    existingGraph: storage.getOutput(taskId, 'temporal_evidence_graph'),
  });
  if (persist) storage.saveOutput(taskId, 'temporal_evidence_graph', compiled.graph);
  return compiled;
}

module.exports = {
  compile,
  compileForTask,
};
