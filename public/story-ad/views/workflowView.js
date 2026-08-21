import { request } from '../api.js?v=20260822-reference-first-compact-dialogue-v135';
import { emptyState, escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js?v=20260822-reference-first-compact-dialogue-v135';
import { inlineNodeEditor, saveInlineNode } from './workflowInlineEditor.js?v=20260822-reference-first-compact-dialogue-v135';
import { bindWorkflowDirectorSync, ensureWorkflowDirectorStyles, openWorkflowDirector, projectWorkflowDirectorNodes, workflowNodePanelMarkup, workflowNodePortMarkup } from './workflowDirectorNodes.js?v=20260822-reference-first-compact-dialogue-v135';

const MIN_STAGE_WIDTH = 3400;
const MIN_STAGE_HEIGHT = 1500;
const NODE_WIDTH = 220;
const NODE_HEIGHT = 168;
const DRAG_THRESHOLD = 4;
const NODE_MEDIA_LABELS = {
  brief: '需求摘要', reference: '参考素材', person: '人物资产', animal: '动物资产', product: '商品资产',
  logo: '品牌标识', prop: '道具资产', scene: '场景资产', story: '剧情内容', shot: '镜头内容',
  keyframe: '关键帧待生成', clip: '视频片段待生成', final: '成片待生成',
  reference_understanding: '参考理解', director_scene: '3D导演台', director_animation: '导演动画',
};
const TEXT_NODE_TYPES = new Set(['brief', 'story', 'shot']);

function firstText(...values) {
  return values.find(value => typeof value === 'string' && value.trim())?.trim() || '';
}

function nodeSummary(node = {}) {
  const detail = node.detail || {};
  if (node.type === 'brief') return firstText(detail.full_text, detail.brief_text, detail.brief, detail.text, node.subtitle);
  if (node.type === 'story') return firstText(detail.logline, detail.summary, detail.full_text, node.subtitle);
  if (node.type === 'shot') return firstText(detail.visual, detail.visual_description, detail.action, detail.full_text, node.subtitle);
  return firstText(node.subtitle);
}

function textNodePreview(node = {}) {
  return `<div class="node-text-preview is-${escapeHtml(node.type || 'text')}">
    <span>${escapeHtml(NODE_MEDIA_LABELS[node.type] || '文字内容')}</span>
    <p>${escapeHtml(nodeSummary(node) || '打开节点查看完整内容')}</p>
  </div>`;
}

function graphNode(node) {
  const x = Number(node.position?.x || 0);
  const y = Number(node.position?.y || 0);
  const isTextNode = TEXT_NODE_TYPES.has(node.type);
  return `<button class="graph-node ${isTextNode && node.media_url ? 'has-text-media' : ''}" type="button" data-node-id="${escapeHtml(node.id)}" aria-pressed="false" style="left:${x}px;top:${y}px">
    <span class="node-dot is-${escapeHtml(node.status || 'ready')}"></span>
    ${workflowNodePortMarkup(node)}
    ${isTextNode && !node.media_url ? textNodePreview(node) : mediaPreview(node, { label: node.title || '节点', width: 360, symbol: NODE_MEDIA_LABELS[node.type] || '内容待生成' })}
    <b title="${escapeHtml(node.title || node.label || '未命名节点')}">${escapeHtml(node.title || node.label || '未命名节点')}</b>
    ${isTextNode && node.media_url ? `<small class="node-media-summary">${escapeHtml(nodeSummary(node) || '打开节点查看完整内容')}</small>` : (isTextNode ? '' : `<small>${escapeHtml(node.subtitle || '')}</small>`)}
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

function readableList(items = [], { titleKey = 'title', bodyKeys = [] } = {}) {
  if (!Array.isArray(items) || !items.length) return '';
  return `<div class="node-readable-list">${items.map((item, index) => {
    if (typeof item !== 'object' || item === null) return `<article><b>${index + 1}</b><p>${escapeHtml(item)}</p></article>`;
    const title = firstText(item[titleKey], item.name, item.label, item.beat_title, item.id) || `第 ${index + 1} 项`;
    const body = firstText(...bodyKeys.map(key => item[key]), item.content, item.description, item.summary, item.action, item.visual);
    return `<article><b>${escapeHtml(title)}</b>${body ? `<p>${escapeHtml(body)}</p>` : ''}</article>`;
  }).join('')}</div>`;
}

function readableSection(title, body = '') {
  if (!body) return '';
  return `<section class="node-readable-section"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></section>`;
}

function structuredNodeDetail(node = {}) {
  const detail = node.detail || {};
  if (node.type === 'brief') {
    const fullText = firstText(detail.full_text, detail.brief_text, detail.brief, detail.text, node.subtitle);
    return `<div class="node-structured-detail is-brief">
      ${readableSection('广告目标与完整需求', fullText)}
      ${readableSection('商品或服务主体', firstText(detail.product_subject, detail.subject))}
      ${readableSection('创作方向', firstText(detail.creative_direction, detail.direction))}
    </div>`;
  }
  if (node.type === 'story') {
    const beats = Array.isArray(detail.beats) ? detail.beats : (Array.isArray(detail.story_beats) ? detail.story_beats : []);
    return `<div class="node-structured-detail is-story">
      ${readableSection('故事概述', firstText(detail.logline, detail.summary, detail.full_text, node.subtitle))}
      ${beats.length ? `<section class="node-readable-section"><h3>剧情情节点</h3>${readableList(beats, { bodyKeys: ['content', 'description', 'summary', 'action'] })}</section>` : ''}
    </div>`;
  }
  if (node.type === 'shot') {
    const bindings = detail.bindings && typeof detail.bindings === 'object' ? detail.bindings : {};
    const bindingText = [
      detail.scene_id || bindings.scene_id,
      detail.camera_id || bindings.camera_id,
      ...(Array.isArray(detail.character_ids) ? detail.character_ids : (Array.isArray(bindings.character_ids) ? bindings.character_ids : [])),
    ].filter(Boolean).join(' · ');
    const dialogueLines = Array.isArray(detail.dialogue_lines) ? detail.dialogue_lines : [];
    const dialogueText = firstText(detail.voiceover, detail.narration, detail.dialogue);
    const transition = detail.transition && typeof detail.transition === 'object' ? detail.transition : {};
    const transitionText = [
      detail.continuity,
      typeof detail.transition === 'string' ? detail.transition : '',
      transition.from ? `承接 ${transition.from}` : '',
      transition.type,
      transition.duration ? `${transition.duration} 秒` : '',
      transition.reason,
      transition.match_anchor,
      transition.requires_previous_frame === true ? '需要继承上一镜尾帧' : '',
    ].filter(Boolean).join(' · ');
    return `<div class="node-structured-detail is-shot">
      ${readableSection('画面与动作', firstText(detail.visual, detail.visual_description, detail.action, detail.full_text, node.subtitle))}
      ${readableSection('旁白 / 台词', dialogueText)}
      ${dialogueLines.length ? `<section class="node-readable-section"><h3>角色台词</h3>${readableList(dialogueLines, { titleKey: 'speaker', bodyKeys: ['text', 'line', 'dialogue', 'content'] })}</section>` : ''}
      ${readableSection('镜头目的', firstText(detail.purpose, detail.objective))}
      ${readableSection('绑定资产', bindingText)}
      ${readableSection('前后镜衔接', transitionText)}
    </div>`;
  }
  return '';
}

function remainingDetail(detail = {}, type = '') {
  const hiddenKeys = new Set(type === 'brief'
    ? ['full_text', 'brief_text', 'brief', 'text', 'product_subject', 'subject', 'creative_direction', 'direction']
    : type === 'story'
      ? ['logline', 'summary', 'full_text', 'beats', 'story_beats']
      : type === 'shot'
        ? ['visual', 'visual_description', 'action', 'full_text', 'voiceover', 'narration', 'dialogue', 'dialogue_lines', 'purpose', 'objective', 'bindings', 'character_ids', 'camera_id', 'continuity', 'transition']
        : []);
  return Object.fromEntries(Object.entries(detail).filter(([key]) => !hiddenKeys.has(key)));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

/** 挂载可编辑、可持久化的项目工作流画布。 */
export async function mount(host, context) {
  const taskId = context.bundle?.project?.id;
  ensureWorkflowDirectorStyles();
  host.innerHTML = '<div class="workflow-view"><div class="workflow-bar"><div><h1>工作流画布</h1><p>正在读取当前项目关系…</p></div></div><div class="view-loading">正在加载画布…</div></div>';
  let graph;
  try {
    const data = await request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/graph`);
    graph = projectWorkflowDirectorNodes(data.graph || { nodes: [], edges: [], clusters: [] }, context.bundle || {});
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
  const stageWidth = Math.max(MIN_STAGE_WIDTH, ...graph.nodes.map(node => Number(node.position?.x || 0) + NODE_WIDTH + 120));
  const stageHeight = Math.max(MIN_STAGE_HEIGHT, ...graph.nodes.map(node => Number(node.position?.y || 0) + NODE_HEIGHT + 120));
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
          <svg class="graph-lines" viewBox="0 0 ${stageWidth} ${stageHeight}" style="width:${stageWidth}px;height:${stageHeight}px" aria-hidden="true" data-graph-lines>${graphEdges(graph)}</svg>
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
  stage.style.width = `${stageWidth}px`;
  stage.style.height = `${stageHeight}px`;
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
  const disposeDirectorSync = bindWorkflowDirectorSync({ taskId, refresh: () => context.refreshShell() });

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
      element.style.left = `${clamp(Number(node.position?.x || 0) / stageWidth * 150, 2, 144)}px`;
      element.style.top = `${clamp(Number(node.position?.y || 0) / stageHeight * 96, 2, 90)}px`;
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
    minimapViewport.style.left = `${clamp(-panX / zoom / stageWidth * 150, 0, 150)}px`;
    minimapViewport.style.top = `${clamp(-panY / zoom / stageHeight * 96, 0, 96)}px`;
    minimapViewport.style.width = `${Math.min(150, rect.width / zoom / stageWidth * 150)}px`;
    minimapViewport.style.height = `${Math.min(96, rect.height / zoom / stageHeight * 96)}px`;
  };

  const fit = () => {
    const bounds = graph.bounds || { x: 0, y: 0, width: stageWidth, height: stageHeight };
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
    const worldX = clamp((event.clientX - rect.left) / rect.width, 0, 1) * stageWidth;
    const worldY = clamp((event.clientY - rect.top) / rect.height, 0, 1) * stageHeight;
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
    host.querySelectorAll('[data-node-id]').forEach(item => {
      item.classList.toggle('active', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    });
    const panel = host.querySelector('[data-node-panel]');
    panel.hidden = false;
    const isTextNode = TEXT_NODE_TYPES.has(node.type);
    panel.innerHTML = `<header><div><h2>${escapeHtml(node.title || node.label)}</h2>${isTextNode ? '' : `<p>${escapeHtml(node.subtitle || '')}</p>`}</div><button class="icon-btn" type="button" data-panel-close aria-label="关闭节点详情">×</button></header>
      ${node.media_url ? mediaPreview(node, { label: node.title || '节点', width: 720, symbol: node.type || '节点' }) : (isTextNode ? '' : mediaPreview(node, { label: node.title || '节点', width: 720, symbol: node.type || '节点' }))}
      ${structuredNodeDetail(node)}
      ${workflowNodePanelMarkup(node)}
      <div class="meta-list">${detailRows(remainingDetail(node.detail, node.type))}</div>
      ${['story', 'shot'].includes(node.type) ? `<button class="btn primary panel-route" type="button" data-edit-node-inline>在此编辑${node.type === 'story' ? '剧情' : '分镜'}</button><div data-node-editor-host hidden>${inlineNodeEditor(node, context.bundle)}</div>` : (node.target_route ? '<button class="btn primary panel-route" type="button" data-node-route>打开对应编辑页</button>' : '')}`;
    const closePanel = () => {
      panel.hidden = true;
      host.querySelectorAll('[data-node-id]').forEach(item => {
        item.classList.remove('active');
        item.setAttribute('aria-pressed', 'false');
      });
    };
    panel.querySelector('[data-panel-close]').addEventListener('click', closePanel);
    panel.querySelector('[data-node-route]')?.addEventListener('click', () => context.navigate(node.target_route));
    panel.querySelector('[data-open-workflow-director]')?.addEventListener('click', async event => {
      const worldId = event.currentTarget.dataset.openWorkflowDirector;
      const world = (context.bundle?.scene_worlds || []).find(item => String(item.id) === String(worldId));
      try {
        setButtonBusy(event.currentTarget, true, '正在打开…');
        await openWorkflowDirector({ taskId, world, refresh: () => context.refreshShell() });
        setButtonBusy(event.currentTarget, false);
      } catch (error) {
        setButtonBusy(event.currentTarget, false);
        toast(error.message || '导演台加载失败', 'danger');
      }
    });
    panel.querySelector('[data-edit-node-inline]')?.addEventListener('click', event => {
      const editorHost = panel.querySelector('[data-node-editor-host]');
      if (!editorHost) return;
      editorHost.hidden = false;
      event.currentTarget.hidden = true;
      editorHost.querySelector('input, textarea')?.focus();
    });
    panel.querySelector('[data-cancel-node-inline]')?.addEventListener('click', () => {
      const editorHost = panel.querySelector('[data-node-editor-host]');
      if (editorHost) editorHost.hidden = true;
      const editButton = panel.querySelector('[data-edit-node-inline]');
      if (editButton) editButton.hidden = false;
    });
    panel.querySelector('[data-node-inline-editor]')?.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('[data-save-node-inline]');
      try {
        setButtonBusy(submit, true, '保存中…');
        const saved = await saveInlineNode(form, context.bundle, context.store);
        toast(saved.kind === 'story' ? '剧情已在画布中保存，下游分镜将按新版本重建。' : `分镜 ${saved.shotIndex} 已在画布中保存。`, 'success');
        await context.refreshShell();
      } catch (error) {
        setButtonBusy(submit, false);
        toast(error.message, 'danger');
      }
    });
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
        x: clamp(nodeDrag.originX + screenDx / zoom, 20, stageWidth - NODE_WIDTH - 20),
        y: clamp(nodeDrag.originY + screenDy / zoom, 56, stageHeight - NODE_HEIGHT - 20),
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
  host.querySelector('[data-close-panel]').addEventListener('click', () => {
    host.querySelector('[data-node-panel]').hidden = true;
    host.querySelectorAll('[data-node-id]').forEach(item => {
      item.classList.remove('active');
      item.setAttribute('aria-pressed', 'false');
    });
  });
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
    disposeDirectorSync();
  };
}
