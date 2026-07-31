import { request } from '../api.js';
import { emptyState, escapeHtml, mediaPreview, toast } from '../components/ui.js';

const STAGE_WIDTH = 2900;
const STAGE_HEIGHT = 1500;

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

function graphEdges(graph) {
  const byId = new Map((graph.nodes || []).map(node => [node.id, node]));
  return (graph.edges || []).map(item => {
    const source = byId.get(item.source);
    const target = byId.get(item.target);
    if (!source || !target) return '';
    const x1 = Number(source.position?.x || 0) + 220;
    const y1 = Number(source.position?.y || 0) + 71;
    const x2 = Number(target.position?.x || 0);
    const y2 = Number(target.position?.y || 0) + 71;
    const curve = Math.max(70, Math.abs(x2 - x1) * 0.42);
    return `<path class="is-${escapeHtml(item.kind || 'feeds')}" d="M${x1},${y1} C${x1 + curve},${y1} ${x2 - curve},${y2} ${x2},${y2}"></path>`;
  }).join('');
}

function minimap(graph) {
  return (graph.nodes || []).map(node => {
    const left = Math.max(2, Math.min(144, Number(node.position?.x || 0) / STAGE_WIDTH * 150));
    const top = Math.max(2, Math.min(90, Number(node.position?.y || 0) / STAGE_HEIGHT * 96));
    return `<i style="left:${left}px;top:${top}px"></i>`;
  }).join('');
}

function detailRows(detail = {}) {
  return Object.entries(detail)
    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
    .slice(0, 30)
    .map(([key, value]) => `<div class="meta-row"><span>${escapeHtml(key)}</span><b>${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : value)}</b></div>`)
    .join('');
}

/** 挂载由真实项目投影生成的可平移、可缩放工作流画布。 */
export async function mount(host, context) {
  const taskId = context.bundle?.project?.id;
  host.innerHTML = `<div class="workflow-view"><div class="workflow-bar"><div><h1>工作流画布</h1><p>正在读取当前项目关系…</p></div></div><div class="view-loading">正在加载画布…</div></div>`;
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
        <div><h1>工作流画布</h1><p>${graph.nodes.length} 个真实节点 · ${graph.edges.length} 条关系</p></div>
        <div class="workflow-tools"><button class="icon-btn" type="button" data-fit title="适应画布">适配</button><button class="icon-btn" type="button" data-close-panel title="关闭详情">×</button></div>
      </div>
      <div class="canvas-viewport" data-viewport>
        <div class="canvas-stage" data-stage>
          ${(graph.clusters || []).map(cluster => `<section class="canvas-cluster" style="left:${Number(cluster.x || 0)}px;top:${Number(cluster.y || 0)}px;width:${Number(cluster.width || 360)}px;height:${Number(cluster.height || 260)}px"><label>${escapeHtml(cluster.label || '')}</label></section>`).join('')}
          <svg class="graph-lines" viewBox="0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}" aria-hidden="true">${graphEdges(graph)}</svg>
          ${(graph.nodes || []).map(graphNode).join('')}
        </div>
        <div class="canvas-controls">
          <button type="button" data-zoom-out aria-label="缩小">−</button>
          <button type="button" data-zoom-in aria-label="放大">＋</button>
          <button type="button" data-fit aria-label="适应画布">⌂</button>
          <span class="canvas-zoom" data-zoom-label>100%</span>
        </div>
        <div class="mini-map" aria-label="画布导航图">${minimap(graph)}<span class="viewport-box" data-minimap-viewport></span></div>
      </div>
      <aside class="node-panel" data-node-panel hidden></aside>
    </div>`;
  const viewport = host.querySelector('[data-viewport]');
  const stage = host.querySelector('[data-stage]');
  const zoomLabel = host.querySelector('[data-zoom-label]');
  const minimapViewport = host.querySelector('[data-minimap-viewport]');
  let zoom = 1;
  let panX = 20;
  let panY = 20;
  let drag = null;

  const renderTransform = () => {
    stage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    const rect = viewport.getBoundingClientRect();
    minimapViewport.style.left = `${Math.max(0, -panX / zoom / STAGE_WIDTH * 150)}px`;
    minimapViewport.style.top = `${Math.max(0, -panY / zoom / STAGE_HEIGHT * 96)}px`;
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
    const resolved = Math.max(.2, Math.min(1.8, next));
    const worldX = (clientX - panX) / zoom;
    const worldY = (clientY - panY) / zoom;
    zoom = resolved;
    panX = clientX - worldX * zoom;
    panY = clientY - worldY * zoom;
    renderTransform();
  };
  viewport.addEventListener('pointerdown', event => {
    if (event.target.closest('[data-node-id], .canvas-controls, .mini-map')) return;
    drag = { x: event.clientX, y: event.clientY, panX, panY };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-panning');
  });
  viewport.addEventListener('pointermove', event => {
    if (!drag) return;
    panX = drag.panX + event.clientX - drag.x;
    panY = drag.panY + event.clientY - drag.y;
    renderTransform();
  });
  viewport.addEventListener('pointerup', () => { drag = null; viewport.classList.remove('is-panning'); });
  viewport.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    setZoom(zoom * (event.deltaY > 0 ? .9 : 1.1), event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  host.querySelectorAll('[data-fit]').forEach(button => button.addEventListener('click', fit));
  host.querySelector('[data-zoom-in]').addEventListener('click', () => setZoom(zoom * 1.18));
  host.querySelector('[data-zoom-out]').addEventListener('click', () => setZoom(zoom / 1.18));
  host.querySelector('[data-close-panel]').addEventListener('click', () => { host.querySelector('[data-node-panel]').hidden = true; });
  host.querySelectorAll('[data-node-id]').forEach(button => button.addEventListener('click', () => {
    const node = graph.nodes.find(item => item.id === button.dataset.nodeId);
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
  }));
  fit();
  return () => { drag = null; };
}
