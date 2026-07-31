import { request } from '../api.js';
import { emptyState, escapeHtml, mediaPreview, toast } from '../components/ui.js';

const STAGE_WIDTH = 2900;
const STAGE_HEIGHT = 1500;
const NODE_WIDTH = 220;
const NODE_HEIGHT = 142;
const DRAG_THRESHOLD = 4;

function graphNode(node) {
  const x = Number(node.position?.x || 0);
  const y = Number(node.position?.y || 0);
  return `<button class="graph-node" type="button" data-node-id="${escapeHtml(node.id)}" style="left:${x}px;top:${y}px">
    <span class="node-dot is-${escapeHtml(node.status || 'ready')}"></span>
    ${mediaPreview(node, { label: node.title || '节点', width: 360, symbol: node.type || '节点' })}
    <b>${escapeHtml(node.title || node.label || '未命名节点')}</b>
    <small>${escapeHtml(node.subtitle || '')}</small>
  </button>`;
}

function edgePath(source, target) {
  const x1 = Number(source.position?.x || 0) + NODE_WIDTH;
  const y1 = Number(source.position?.y || 0) + NODE_HEIGHT / 2;
  const x2 = Number(target.position?.x || 0);
  const y2 = Number(target.position?.y || 0) + NODE_HEIGHT / 2;
  const curve = Math.max(70, Math.abs(x2 - x1) * 0.42);
  return `M${x1},${y1} C${x1 + curve},${y1} ${x2 - curve},${y2} ${x2},${y2}`;
}

function graphEdges(graph) {
  const byId = new Map((graph.nodes || []).map(node => [node.id, node]));
  return (graph.edges || []).map(item => {
    const source = byId.get(item.source);
    const target = byId.get(item.target);
    if (!source || !target) return '';
    return `<path class="is-${escapeHtml(item.kind || 'feeds')}" data-edge-id="${escapeHtml(item.id)}" d="${edgePath(source, target)}"></path>`;
  }).join('');
}

function minimap(graph) {
  return (graph.nodes || []).map(node => `<i data-mini-node="${escapeHtml(node.id)}"></i>`).join('');
}

function detailRows(detail = {}) {
  return Object.entries(detail)
    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
    .slice(0, 30)
    .map(([key, value]) => `<div class="meta-row"><span>${escapeHtml(key)}</span><b>${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : value)}</b></div>`)
    .join('');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

/** 挂载可编辑、可持久化的项目工作流画布。 */
export async function mount(host, context) {
  const taskId = context.bundle?.project?.id;
  host.innerHTML = '<div class="workflow-view"><div class="workflow-bar"><div><h1>工作流画布</h1><p>正在读取当前项目关系…</p></div></div><div class="view-loading">正在加载画布…</div></div>';
  let graph;
  try {
    const data = await request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/graph`);
    graph = data.graph || { nodes: [], edges: [], clusters: [] };
  } catch (error) {
    host.innerHTML = `<section class="card">${emptyState({ title: '工作流暂时无法读取', body: error.message })}</section>`;
    return;
  }
  if (!graph.nodes?.length) {
    host.innerHTML = `<section class="view-head"><div><h1>工作流画布</h1><p>画布只展示当前项目已经存在的节点。</p></div></section><section class="card">${emptyState({
      title: '当前项目还没有工作流节点',
      body: '从目标与材料开始，真实资产和分镜产生后会自动出现在这里。',
      action: '返回目标与材料',
      actionId: 'back-brief',
    })}</section>`;
    host.querySelector('[data-empty-action="back-brief"]')?.addEventListener('click', () => context.navigate(`/story-ad/projects/${encodeURIComponent(taskId)}?view=brief`));
    return;
  }
  host.innerHTML = `
    <div class="workflow-view">
      <div class="workflow-bar">
        <div><h1>工作流画布</h1><p>${graph.nodes.length} 个真实节点 · ${graph.edges.length} 条关系 · 拖动节点可保存布局</p></div>
        <div class="workflow-tools">
          <button class="icon-btn" type="button" data-fit title="适应画布">适配</button>
          <button class="icon-btn" type="button" data-reset-layout title="恢复自动布局">重置布局</button>
          <button class="icon-btn" type="button" data-close-panel title="关闭详情">×</button>
        </div>
      </div>
      <div class="canvas-viewport" data-viewport>
        <div class="canvas-stage" data-stage>
          ${(graph.clusters || []).map(cluster => `<section class="canvas-cluster" data-cluster-id="${escapeHtml(cluster.id)}" style="left:${Number(cluster.x || 0)}px;top:${Number(cluster.y || 0)}px;width:${Number(cluster.width || 360)}px;height:${Number(cluster.height || 260)}px"><label>${escapeHtml(cluster.label || '')}</label></section>`).join('')}
          <svg class="graph-lines" viewBox="0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}" aria-hidden="true" data-graph-lines>${graphEdges(graph)}</svg>
          ${(graph.nodes || []).map(graphNode).join('')}
        </div>
        <div class="canvas-controls">
          <button type="button" data-zoom-out aria-label="缩小">−</button>
          <button type="button" data-zoom-in aria-label="放大">＋</button>
          <button type="button" data-fit aria-label="适应画布">◎</button>
          <span class="canvas-zoom" data-zoom-label>100%</span>
        </div>
        <div class="mini-map" aria-label="画布导航图" data-minimap>${minimap(graph)}<span class="viewport-box" data-minimap-viewport></span></div>
      </div>
      <aside class="node-panel" data-node-panel hidden></aside>
    </div>`;

  const viewport = host.querySelector('[data-viewport]');
  const stage = host.querySelector('[data-stage]');
  const lines = host.querySelector('[data-graph-lines]');
  const zoomLabel = host.querySelector('[data-zoom-label]');
  const miniMap = host.querySelector('[data-minimap]');
  const minimapViewport = host.querySelector('[data-minimap-viewport]');
  const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
  const nodeElements = new Map([...host.querySelectorAll('[data-node-id]')].map(element => [element.dataset.nodeId, element]));
  const miniNodes = new Map([...host.querySelectorAll('[data-mini-node]')].map(element => [element.dataset.miniNode, element]));
  const clusterElements = new Map([...host.querySelectorAll('[data-cluster-id]')].map(element => [element.dataset.clusterId, element]));
  let zoom = 1;
  let panX = 20;
  let panY = 20;
  let panDrag = null;
  let nodeDrag = null;
  let minimapDrag = null;
  let suppressNodeClickUntil = 0;
  let saveTimer = null;
  let saving = false;
  let savePending = false;
  let destroyed = false;

  const updateBoundsAndClusters = () => {
    (graph.clusters || []).forEach(cluster => {
      const nodes = (cluster.node_ids || []).map(id => nodeById.get(id)).filter(Boolean);
      if (!nodes.length) return;
      const minX = Math.min(...nodes.map(node => Number(node.position?.x || 0)));
      const minY = Math.min(...nodes.map(node => Number(node.position?.y || 0)));
      const maxX = Math.max(...nodes.map(node => Number(node.position?.x || 0) + NODE_WIDTH));
      const maxY = Math.max(...nodes.map(node => Number(node.position?.y || 0) + NODE_HEIGHT));
      Object.assign(cluster, {
        x: minX - 24,
        y: minY - 48,
        width: Math.max(268, maxX - minX + 48),
        height: Math.max(230, maxY - minY + 72),
      });
      const element = clusterElements.get(cluster.id);
      if (element) {
        element.style.left = `${cluster.x}px`;
        element.style.top = `${cluster.y}px`;
        element.style.width = `${cluster.width}px`;
        element.style.height = `${cluster.height}px`;
      }
    });
    if (graph.clusters?.length) {
      const minX = Math.min(...graph.clusters.map(item => item.x));
      const minY = Math.min(...graph.clusters.map(item => item.y));
      graph.bounds = {
        x: minX,
        y: minY,
        width: Math.max(...graph.clusters.map(item => item.x + item.width)) - minX,
        height: Math.max(...graph.clusters.map(item => item.y + item.height)) - minY,
      };
    }
  };

  const renderMinimapNodes = () => {
    graph.nodes.forEach(node => {
      const element = miniNodes.get(node.id);
      if (!element) return;
      element.style.left = `${clamp(Number(node.position?.x || 0) / STAGE_WIDTH * 150, 2, 144)}px`;
      element.style.top = `${clamp(Number(node.position?.y || 0) / STAGE_HEIGHT * 96, 2, 90)}px`;
    });
  };

  const renderGeometry = () => {
    graph.nodes.forEach(node => {
      const element = nodeElements.get(node.id);
      if (!element) return;
      element.style.left = `${Number(node.position?.x || 0)}px`;
      element.style.top = `${Number(node.position?.y || 0)}px`;
    });
    updateBoundsAndClusters();
    lines.innerHTML = graphEdges(graph);
    renderMinimapNodes();
  };

  const renderTransform = () => {
    stage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    const rect = viewport.getBoundingClientRect();
    minimapViewport.style.left = `${clamp(-panX / zoom / STAGE_WIDTH * 150, 0, 150)}px`;
    minimapViewport.style.top = `${clamp(-panY / zoom / STAGE_HEIGHT * 96, 0, 96)}px`;
    minimapViewport.style.width = `${Math.min(150, rect.width / zoom / STAGE_WIDTH * 150)}px`;
    minimapViewport.style.height = `${Math.min(96, rect.height / zoom / STAGE_HEIGHT * 96)}px`;
  };

  const fit = () => {
    const bounds = graph.bounds || { x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT };
    const rect = viewport.getBoundingClientRect();
    zoom = Math.max(.22, Math.min(1, Math.min((rect.width - 80) / Math.max(600, bounds.width), (rect.height - 80) / Math.max(420, bounds.height))));
    panX = 40 - Number(bounds.x || 0) * zoom;
    panY = 40 - Number(bounds.y || 0) * zoom;
    renderTransform();
  };

  const setZoom = (next, clientX = viewport.clientWidth / 2, clientY = viewport.clientHeight / 2) => {
    const resolved = clamp(next, .2, 1.8);
    const worldX = (clientX - panX) / zoom;
    const worldY = (clientY - panY) / zoom;
    zoom = resolved;
    panX = clientX - worldX * zoom;
    panY = clientY - worldY * zoom;
    renderTransform();
  };

  const layoutBody = () => ({
    layout_revision: Number(graph.layout_revision || 0),
    source_graph_revision: Number(graph.revision || 0),
    nodes: graph.nodes.map(node => ({ id: node.id, x: Number(node.position?.x || 0), y: Number(node.position?.y || 0) })),
    viewport: { zoom, pan_x: panX, pan_y: panY },
  });

  const saveLayout = async () => {
    if (destroyed) return;
    if (saving) {
      savePending = true;
      return;
    }
    saving = true;
    try {
      const data = await request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/graph-layout`, {
        method: 'PUT',
        body: layoutBody(),
      });
      graph.layout_revision = Number(data.layout?.layout_revision || graph.layout_revision || 0);
    } catch (error) {
      if (error.code === 'GRAPH_LAYOUT_REVISION_CONFLICT') {
        toast('画布已在其他页面更新，正在载入最新布局。', 'warning');
        await context.refreshShell();
      } else {
        toast(`画布布局未保存：${error.message}`, 'danger');
      }
    } finally {
      saving = false;
      if (savePending && !destroyed) {
        savePending = false;
        void saveLayout();
      }
    }
  };

  const scheduleSave = (delay = 260) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void saveLayout(); }, delay);
  };

  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('[data-node-id], .canvas-controls, .mini-map')) return;
    panDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX, panY, moved: false };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-panning');
  });
  viewport.addEventListener('pointermove', event => {
    if (!panDrag || panDrag.pointerId !== event.pointerId) return;
    const dx = event.clientX - panDrag.x;
    const dy = event.clientY - panDrag.y;
    panDrag.moved ||= Math.hypot(dx, dy) >= DRAG_THRESHOLD;
    panX = panDrag.panX + dx;
    panY = panDrag.panY + dy;
    renderTransform();
  });
  const finishPan = event => {
    if (!panDrag || panDrag.pointerId !== event.pointerId) return;
    const moved = panDrag.moved;
    panDrag = null;
    viewport.classList.remove('is-panning');
    if (moved) scheduleSave();
  };
  viewport.addEventListener('pointerup', finishPan);
  viewport.addEventListener('pointercancel', finishPan);
  viewport.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    setZoom(zoom * (event.deltaY > 0 ? .9 : 1.1), event.clientX - rect.left, event.clientY - rect.top);
    scheduleSave(420);
  }, { passive: false });

  const navigateMinimap = event => {
    const rect = miniMap.getBoundingClientRect();
    const worldX = clamp((event.clientX - rect.left) / rect.width, 0, 1) * STAGE_WIDTH;
    const worldY = clamp((event.clientY - rect.top) / rect.height, 0, 1) * STAGE_HEIGHT;
    panX = viewport.clientWidth / 2 - worldX * zoom;
    panY = viewport.clientHeight / 2 - worldY * zoom;
    renderTransform();
  };
  miniMap.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.stopPropagation();
    minimapDrag = event.pointerId;
    miniMap.setPointerCapture(event.pointerId);
    navigateMinimap(event);
  });
  miniMap.addEventListener('pointermove', event => {
    if (minimapDrag !== event.pointerId) return;
    navigateMinimap(event);
  });
  const finishMinimap = event => {
    if (minimapDrag !== event.pointerId) return;
    minimapDrag = null;
    scheduleSave();
  };
  miniMap.addEventListener('pointerup', finishMinimap);
  miniMap.addEventListener('pointercancel', finishMinimap);

  const openNodePanel = button => {
    if (Date.now() < suppressNodeClickUntil) return;
    const node = nodeById.get(button.dataset.nodeId);
    if (!node) return;
    host.querySelectorAll('[data-node-id]').forEach(item => item.classList.toggle('active', item === button));
    const panel = host.querySelector('[data-node-panel]');
    panel.hidden = false;
    panel.innerHTML = `<header><div><h2>${escapeHtml(node.title || node.label)}</h2><p>${escapeHtml(node.subtitle || '')}</p></div><button class="icon-btn" type="button" data-panel-close>×</button></header>
      ${mediaPreview(node, { label: node.title || '节点', width: 720, symbol: node.type || '节点' })}
      <div class="meta-list">${detailRows(node.detail)}</div>
      ${node.target_route ? '<button class="btn primary panel-route" type="button" data-node-route>打开对应编辑页</button>' : ''}`;
    panel.querySelector('[data-panel-close]').addEventListener('click', () => { panel.hidden = true; });
    panel.querySelector('[data-node-route]')?.addEventListener('click', () => context.navigate(node.target_route));
  };

  nodeElements.forEach((button, nodeId) => {
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const node = nodeById.get(nodeId);
      if (!node) return;
      event.stopPropagation();
      nodeDrag = {
        pointerId: event.pointerId,
        node,
        x: event.clientX,
        y: event.clientY,
        originX: Number(node.position?.x || 0),
        originY: Number(node.position?.y || 0),
        moved: false,
      };
      button.setPointerCapture(event.pointerId);
      button.classList.add('is-dragging');
    });
    button.addEventListener('pointermove', event => {
      if (!nodeDrag || nodeDrag.pointerId !== event.pointerId || nodeDrag.node.id !== nodeId) return;
      const screenDx = event.clientX - nodeDrag.x;
      const screenDy = event.clientY - nodeDrag.y;
      if (!nodeDrag.moved && Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD) return;
      nodeDrag.moved = true;
      nodeDrag.node.position = {
        x: clamp(nodeDrag.originX + screenDx / zoom, 20, STAGE_WIDTH - NODE_WIDTH - 20),
        y: clamp(nodeDrag.originY + screenDy / zoom, 56, STAGE_HEIGHT - NODE_HEIGHT - 20),
      };
      renderGeometry();
    });
    const finishNodeDrag = event => {
      if (!nodeDrag || nodeDrag.pointerId !== event.pointerId || nodeDrag.node.id !== nodeId) return;
      const moved = nodeDrag.moved;
      nodeDrag = null;
      button.classList.remove('is-dragging');
      if (moved) {
        suppressNodeClickUntil = Date.now() + 350;
        scheduleSave(80);
      }
    };
    button.addEventListener('pointerup', finishNodeDrag);
    button.addEventListener('pointercancel', finishNodeDrag);
    button.addEventListener('click', event => {
      if (Date.now() < suppressNodeClickUntil) {
        event.preventDefault();
        return;
      }
      openNodePanel(button);
    });
  });

  host.querySelectorAll('[data-fit]').forEach(button => button.addEventListener('click', () => { fit(); scheduleSave(); }));
  host.querySelector('[data-zoom-in]').addEventListener('click', () => { setZoom(zoom * 1.18); scheduleSave(); });
  host.querySelector('[data-zoom-out]').addEventListener('click', () => { setZoom(zoom / 1.18); scheduleSave(); });
  host.querySelector('[data-close-panel]').addEventListener('click', () => { host.querySelector('[data-node-panel]').hidden = true; });
  host.querySelector('[data-reset-layout]').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    clearTimeout(saveTimer);
    savePending = false;
    try {
      await request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/graph-layout`, {
        method: 'DELETE',
        body: {
          layout_revision: Number(graph.layout_revision || 0),
          source_graph_revision: Number(graph.revision || 0),
        },
      });
      toast('已恢复自动布局。', 'success');
      await context.refreshShell();
    } catch (error) {
      if (error.code === 'GRAPH_LAYOUT_REVISION_CONFLICT') {
        toast('画布已在其他页面更新，正在载入最新布局。', 'warning');
        await context.refreshShell();
      } else {
        toast(error.message, 'danger');
        button.disabled = false;
      }
    }
  });

  renderGeometry();
  if (graph.layout?.viewport) {
    zoom = clamp(graph.layout.viewport.zoom, .2, 1.8);
    panX = Number(graph.layout.viewport.pan_x || 0);
    panY = Number(graph.layout.viewport.pan_y || 0);
    renderTransform();
  } else {
    fit();
  }

  return () => {
    destroyed = true;
    clearTimeout(saveTimer);
    panDrag = null;
    nodeDrag = null;
    minimapDrag = null;
  };
}
