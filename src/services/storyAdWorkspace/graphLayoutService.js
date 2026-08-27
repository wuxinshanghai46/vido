const storage = require('../newStoryAd/storageService');

const OUTPUT_KIND = 'workspace_graph_layout';
const SCHEMA_VERSION = 'story-ad-graph-layout-v1';
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1.8;
const MAX_COORDINATE = 20000;

function clean(value = '', max = 180) {
  return String(value || '').trim().slice(0, max);
}

function number(value, fallback = 0, min = -MAX_COORDINATE, max = MAX_COORDINATE) {
  const resolved = Number(value);
  return Number.isFinite(resolved) ? Math.max(min, Math.min(max, resolved)) : fallback;
}

function emptyLayout(taskId = '') {
  return {
    schema_version: SCHEMA_VERSION,
    task_id: clean(taskId, 120),
    layout_revision: 0,
    source_graph_revision: 0,
    nodes: [],
    viewport: null,
    reset: false,
    updated_at: '',
    updated_by: '',
  };
}

function rawLayout(taskId) {
  const row = storage.listOutputs(taskId)
    .find(item => item.kind === OUTPUT_KIND);
  return row?.payload && typeof row.payload === 'object' ? row.payload : null;
}

function normalizeViewport(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    zoom: number(value.zoom, 1, MIN_ZOOM, MAX_ZOOM),
    pan_x: number(value.pan_x ?? value.panX, 0),
    pan_y: number(value.pan_y ?? value.panY, 0),
  };
}

function normalizeNodes(value, allowedNodeIds = null) {
  const source = Array.isArray(value)
    ? value
    : Object.entries(value && typeof value === 'object' ? value : {}).map(([id, position]) => ({ id, ...position }));
  const allowed = allowedNodeIds ? new Set([...allowedNodeIds].map(id => clean(id, 160))) : null;
  const seen = new Set();
  return source.map(item => {
    const id = clean(item?.id || item?.node_id || item?.nodeId, 160);
    if (!id || seen.has(id) || (allowed && !allowed.has(id))) return null;
    seen.add(id);
    return {
      id,
      x: number(item?.x, 0),
      y: number(item?.y, 0),
    };
  }).filter(Boolean).sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeLayout(taskId, value = {}, allowedNodeIds = null) {
  const base = emptyLayout(taskId);
  return {
    ...base,
    schema_version: SCHEMA_VERSION,
    layout_revision: Math.max(0, Math.floor(Number(value.layout_revision || 0) || 0)),
    source_graph_revision: Math.max(0, Math.floor(Number(value.source_graph_revision || value.graph_revision || 0) || 0)),
    nodes: normalizeNodes(value.nodes, allowedNodeIds),
    viewport: normalizeViewport(value.viewport),
    reset: value.reset === true,
    updated_at: clean(value.updated_at, 80),
    updated_by: clean(value.updated_by, 120),
  };
}

function getLayout(taskId, options = {}) {
  if (!storage.getTask(taskId)) {
    const error = new Error('项目不存在');
    error.status = 404;
    error.code = 'TASK_NOT_FOUND';
    throw error;
  }
  return normalizeLayout(taskId, rawLayout(taskId) || {}, options.allowedNodeIds || null);
}

function expectedRevision(value) {
  const raw = value?.layout_revision ?? value?.base_layout_revision ?? value?.baseLayoutRevision;
  const revision = Number(raw);
  if (!Number.isInteger(revision) || revision < 0) {
    const error = new Error('保存画布前必须提供当前布局版本');
    error.status = 400;
    error.code = 'GRAPH_LAYOUT_REVISION_REQUIRED';
    throw error;
  }
  return revision;
}

function assertRevision(current, expected) {
  if (expected === current.layout_revision) return;
  const error = new Error(`画布布局已在其他页面更新；当前版本 ${current.layout_revision}，提交版本 ${expected}`);
  error.status = 409;
  error.code = 'GRAPH_LAYOUT_REVISION_CONFLICT';
  error.retryable = true;
  error.current_layout_revision = current.layout_revision;
  throw error;
}

function fingerprint(layout = {}) {
  return storage.canonicalFingerprint({
    nodes: normalizeNodes(layout.nodes),
    viewport: normalizeViewport(layout.viewport),
    reset: layout.reset === true,
  });
}

function persist(taskId, body = {}, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) {
    const error = new Error('项目不存在');
    error.status = 404;
    error.code = 'TASK_NOT_FOUND';
    throw error;
  }
  const allowedNodeIds = options.allowedNodeIds || null;
  const current = getLayout(taskId, { allowedNodeIds });
  assertRevision(current, expectedRevision(body));
  const candidate = normalizeLayout(taskId, {
    nodes: body.nodes,
    viewport: body.viewport,
    source_graph_revision: body.source_graph_revision ?? body.graph_revision,
    reset: body.reset === true,
  }, allowedNodeIds);
  if (fingerprint(current) === fingerprint(candidate)
    && current.source_graph_revision === candidate.source_graph_revision) {
    return { layout: current, changed: false };
  }
  const next = {
    ...candidate,
    layout_revision: current.layout_revision + 1,
    updated_at: new Date().toISOString(),
    updated_by: clean(options.user?.id || options.user?.userId, 120),
  };
  storage.saveOutput(taskId, OUTPUT_KIND, next);
  return { layout: next, changed: true };
}

function saveLayout(taskId, body = {}, options = {}) {
  return persist(taskId, { ...body, reset: false }, options);
}

function resetLayout(taskId, body = {}, options = {}) {
  return persist(taskId, {
    layout_revision: body.layout_revision ?? body.base_layout_revision,
    source_graph_revision: body.source_graph_revision ?? body.graph_revision,
    nodes: [],
    viewport: null,
    reset: true,
  }, options);
}

function recomputeGeometry(graph) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const oldClusters = new Map((graph.clusters || []).map(item => [item.id, item]));
  const groupOrder = [...new Set(nodes.map(item => item.group).filter(Boolean))];
  graph.clusters = groupOrder.map(group => {
    const grouped = nodes.filter(item => item.group === group);
    const minX = Math.min(...grouped.map(item => Number(item.position?.x || 0)));
    const minY = Math.min(...grouped.map(item => Number(item.position?.y || 0)));
    const maxX = Math.max(...grouped.map(item => Number(item.position?.x || 0) + 220));
    const maxY = Math.max(...grouped.map(item => Number(item.position?.y || 0) + 142));
    return {
      id: group,
      label: oldClusters.get(group)?.label || group,
      node_ids: grouped.map(item => item.id),
      x: minX - 24,
      y: minY - 48,
      width: Math.max(268, maxX - minX + 48),
      height: Math.max(230, maxY - minY + 72),
    };
  });
  if (!graph.clusters.length) {
    graph.bounds = { x: 0, y: 0, width: 600, height: 420 };
    return graph;
  }
  const minX = Math.min(...graph.clusters.map(item => item.x));
  const minY = Math.min(...graph.clusters.map(item => item.y));
  graph.bounds = {
    x: minX,
    y: minY,
    width: Math.max(...graph.clusters.map(item => item.x + item.width)) - minX,
    height: Math.max(...graph.clusters.map(item => item.y + item.height)) - minY,
  };
  return graph;
}

/**
 * 旧任务可能保存过“身份资产在剧情之前”的横向坐标。业务阶段顺序升级后，
 * 继续原样叠加这些坐标会把新版投影重新覆盖成旧顺序。这里只迁移发生倒置的
 * 两个阶段，并整体平移各阶段内的节点，保留用户原有的纵向排列和组内间距。
 */
function enforceStoryBeforeAssets(nodes = []) {
  const storyNodes = nodes.filter(item => item.group === 'story');
  const assetNodes = nodes.filter(item => item.group === 'assets');
  if (!storyNodes.length || !assetNodes.length) return { nodes, rebased: false };

  const storyX = Math.min(...storyNodes.map(item => Number(item.position?.x || 0)));
  const assetX = Math.min(...assetNodes.map(item => Number(item.position?.x || 0)));
  if (storyX < assetX) return { nodes, rebased: false };

  const storyShift = assetX - storyX;
  const assetShift = storyX - assetX;
  return {
    nodes: nodes.map(item => {
      if (item.group === 'story') {
        return { ...item, position: { ...item.position, x: Number(item.position?.x || 0) + storyShift } };
      }
      if (item.group === 'assets') {
        return { ...item, position: { ...item.position, x: Number(item.position?.x || 0) + assetShift } };
      }
      return item;
    }),
    rebased: true,
  };
}

function mergeGraph(graph = {}, layout = {}) {
  const normalized = normalizeLayout(graph.project_id || layout.task_id, layout, new Set((graph.nodes || []).map(item => item.id)));
  const positions = new Map(normalized.nodes.map(item => [item.id, item]));
  const mergedNodes = (graph.nodes || []).map(item => {
    const saved = positions.get(item.id);
    return saved ? { ...item, position: { x: saved.x, y: saved.y }, read_only: false } : { ...item, read_only: false };
  });
  const ordered = enforceStoryBeforeAssets(mergedNodes);
  graph.nodes = ordered.nodes;
  graph.read_only = false;
  graph.layout_revision = normalized.layout_revision;
  graph.layout = {
    ...normalized,
    nodes: graph.nodes.map(item => ({ id: item.id, x: item.position.x, y: item.position.y })),
    stage_order_rebased: ordered.rebased,
  };
  return recomputeGeometry(graph);
}

module.exports = {
  OUTPUT_KIND,
  SCHEMA_VERSION,
  emptyLayout,
  enforceStoryBeforeAssets,
  fingerprint,
  getLayout,
  mergeGraph,
  normalizeLayout,
  normalizeNodes,
  normalizeViewport,
  recomputeGeometry,
  resetLayout,
  saveLayout,
};
