const { NODE_CATALOG, compatible } = require('./nodeCatalog');
const { fingerprint } = require('./common');

function normalizeGraph(raw = {}) {
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const edges = Array.isArray(raw.edges) ? raw.edges : [];
  return {
    schemaVersion: Math.max(1, Number(raw.schemaVersion) || 1),
    nodes: nodes.map((item, index) => ({
      id: String(item.id || `node_${index + 1}`),
      type: String(item.type || 'text-input'),
      version: Math.max(1, Number(item.version) || 1),
      label: String(item.label || '').slice(0, 100),
      config: item.config && typeof item.config === 'object' ? item.config : {},
      position: { x: Number(item.position?.x) || 0, y: Number(item.position?.y) || 0 },
    })),
    edges: edges.map((item, index) => ({
      id: String(item.id || `edge_${index + 1}`),
      source: String(item.source || ''), sourcePort: String(item.sourcePort || ''),
      target: String(item.target || ''), targetPort: String(item.targetPort || ''),
    })),
    viewport: raw.viewport && typeof raw.viewport === 'object' ? raw.viewport : { x: 0, y: 0, zoom: 1 },
  };
}

function validateGraph(raw = {}) {
  const graph = normalizeGraph(raw);
  const errors = [];
  const warnings = [];
  const nodeById = new Map();
  for (const node of graph.nodes) {
    if (nodeById.has(node.id)) errors.push(issue('DUPLICATE_NODE_ID', `节点 ID 重复：${node.id}`, node.id));
    nodeById.set(node.id, node);
    const manifest = NODE_CATALOG[node.type];
    if (!manifest) { errors.push(issue('UNKNOWN_NODE_TYPE', `未知节点类型：${node.type}`, node.id)); continue; }
    for (const key of manifest.policy.requiredConfig || []) {
      if (node.config[key] == null || String(node.config[key]).trim() === '') errors.push(issue('MISSING_CONFIG', `${manifest.label}缺少配置：${key}`, node.id));
    }
  }
  const incoming = new Map(graph.nodes.map(node => [node.id, []]));
  const outgoing = new Map(graph.nodes.map(node => [node.id, []]));
  const edgeIds = new Set();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) errors.push(issue('DUPLICATE_EDGE_ID', `连线 ID 重复：${edge.id}`));
    edgeIds.add(edge.id);
    const source = nodeById.get(edge.source); const target = nodeById.get(edge.target);
    if (!source || !target) { errors.push(issue('MISSING_EDGE_NODE', `连线 ${edge.id} 引用了不存在的节点`)); continue; }
    const sourceType = NODE_CATALOG[source.type]?.outputs?.[edge.sourcePort];
    const targetType = NODE_CATALOG[target.type]?.inputs?.[edge.targetPort];
    if (!sourceType || !targetType) errors.push(issue('UNKNOWN_PORT', `连线 ${edge.id} 使用了不存在的端口`, target.id));
    else if (!compatible(sourceType, targetType)) errors.push(issue('PORT_TYPE_MISMATCH', `${sourceType} 不能连接到 ${targetType}`, target.id));
    incoming.get(target.id).push(edge); outgoing.get(source.id).push(edge);
  }
  for (const node of graph.nodes) {
    const manifest = NODE_CATALOG[node.type];
    if (!manifest) continue;
    for (const port of manifest.policy.requiredInputs || []) {
      if (!(incoming.get(node.id) || []).some(edge => edge.targetPort === port)) errors.push(issue('MISSING_INPUT', `${manifest.label}缺少输入：${port}`, node.id));
    }
  }
  const order = topologicalOrder(graph, incoming, outgoing);
  if (order.length !== graph.nodes.length) errors.push(issue('GRAPH_CYCLE', '画布存在循环连接，请先断开循环'));
  if (!graph.nodes.length) warnings.push(issue('EMPTY_GRAPH', '画布还没有节点'));
  return { valid: errors.length === 0, errors, warnings, graph, order, incoming, outgoing };
}

function topologicalOrder(graph, incoming, outgoing) {
  const degree = new Map(graph.nodes.map(node => [node.id, (incoming.get(node.id) || []).length]));
  const queue = graph.nodes.filter(node => degree.get(node.id) === 0).map(node => node.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift(); order.push(id);
    for (const edge of outgoing.get(id) || []) {
      degree.set(edge.target, degree.get(edge.target) - 1);
      if (degree.get(edge.target) === 0) queue.push(edge.target);
    }
  }
  return order;
}

function graphFingerprint(graph) {
  const normalized = normalizeGraph(graph);
  return fingerprint({ schemaVersion: normalized.schemaVersion, nodes: normalized.nodes, edges: normalized.edges });
}

function issue(code, message, nodeId = '') { return { code, message, nodeId }; }

module.exports = { graphFingerprint, normalizeGraph, validateGraph };
