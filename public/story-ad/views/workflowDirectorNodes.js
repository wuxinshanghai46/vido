const TYPE_CONTRACTS = Object.freeze({
  reference_understanding: { inputs: [{ id: 'source', contract: 'ReferenceSource', max: 1 }], outputs: [{ id: 'understanding', contract: 'ReferenceUnderstanding' }] },
  person: { inputs: [], outputs: [{ id: 'person', contract: 'PersonReference' }] },
  scene: { inputs: [], outputs: [{ id: 'scene', contract: 'SceneReference' }] },
  product: { inputs: [], outputs: [{ id: 'product', contract: 'ProductReference' }] },
  director_scene: {
    inputs: [
      { id: 'scene', contract: 'SceneReference', max: 1 },
      { id: 'people', contract: 'PersonReference', max: 60 },
      { id: 'products', contract: 'ProductReference', max: 12 },
    ],
    outputs: [{ id: 'director', contract: 'DirectorScene' }, { id: 'shots', contract: 'ShotReferencePack' }],
  },
  director_animation: { inputs: [{ id: 'director', contract: 'DirectorScene', max: 1 }], outputs: [{ id: 'animation', contract: 'DirectorAnimation' }] },
  shot: { inputs: [{ id: 'director', contract: 'DirectorScene', max: 1 }], outputs: [{ id: 'shot', contract: 'ShotReferencePack' }] },
  keyframe: { inputs: [{ id: 'shot', contract: 'ShotReferencePack', max: 1 }], outputs: [{ id: 'frame', contract: 'KeyframeReference' }] },
  clip: {
    inputs: [{ id: 'frame', contract: 'KeyframeReference', max: 2 }, { id: 'animation', contract: 'DirectorAnimation', max: 1 }],
    outputs: [{ id: 'video', contract: 'VideoClip' }],
  },
});

const EDGE_LABELS = Object.freeze({ extracts: '提取权威引用', stages: '加入导演场景', animates: '生成导演动画', directs: '编译逐镜参考', drives_motion: '驱动视频运动' });
function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function text(value = '', max = 180) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function escape(value = '') { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function identity(value = {}) { return text(value.id || value.asset_id || value.subject_id || value.profile?.id, 120); }
function revision(value = {}) { return Math.max(0, Math.floor(number(value.revision || value.person_revision || value.entity_revision, 0))); }
function edgeId(source, kind, target) { return `${source}:${kind}:${target}`; }

export function workflowNodeContracts(type = '') {
  const contract = TYPE_CONTRACTS[type] || { inputs: [], outputs: [] };
  return { inputs: contract.inputs.map(item => ({ ...item })), outputs: contract.outputs.map(item => ({ ...item })) };
}

function directorStateRows(bundle = {}) {
  const supplied = bundle.director_scenes || bundle.director_scene_states;
  if (Array.isArray(supplied)) return supplied;
  const states = supplied?.states && typeof supplied.states === 'object' ? supplied.states : supplied;
  return states && typeof states === 'object'
    ? Object.entries(states).map(([worldId, row]) => ({ ...(row || {}), world_id: row?.world_id || worldId }))
    : [];
}

function entityRefs(state = {}) {
  const supplied = list(state.entity_refs);
  return (supplied.length ? supplied : list(state.entities)).slice(0, 72).map(item => ({
    entity_id: text(item.entity_id || item.id, 120),
    entity_revision: Math.max(0, Math.floor(number(item.entity_revision || item.revision, 0))),
    kind: text(item.kind || item.type || 'object', 30),
  })).filter(item => item.entity_id);
}

function worldAliases(world = {}) {
  return new Set([world.id, world.world_id, world.scene_id, world.source_asset?.id, world.source_asset?.asset_id, world.source_asset?.scene_id]
    .map(value => text(value, 120)).filter(Boolean));
}

function currentAssets(bundle = {}) {
  const assets = bundle.assets || {};
  return [...list(assets.people), ...list(assets.products), ...list(assets.scenes)].reduce((map, item) => {
    const id = identity(item);
    if (id) map.set(id, revision(item));
    return map;
  }, new Map());
}

function directorStatus(detail = {}, bundle = {}, assets = currentAssets(bundle)) {
  const staleRefs = list(detail.entity_refs).filter(ref => {
    const current = assets.get(text(ref.entity_id, 120));
    return current > Math.max(0, number(ref.entity_revision, 0));
  });
  const world = list(bundle.scene_worlds).find(item => String(item.id) === String(detail.world_id));
  const staleWorld = world && number(world.revision, 1) > number(detail.world_revision, 0);
  const compatibility = text(detail.compatibility_status || detail.sync_status || '', 40);
  const conflict = compatibility === 'conflict' || detail.conflict === true;
  const stale = staleWorld || staleRefs.length > 0 || ['stale_source', 'stale_entities', 'stale_input', 'outdated'].includes(compatibility);
  return {
    status: conflict ? 'conflict' : (stale ? 'stale' : (text(detail.status, 40) || 'draft')),
    sync_status: conflict ? 'conflict' : (stale ? 'stale' : 'current'),
    stale_refs: staleRefs,
    stale_world: Boolean(staleWorld),
  };
}

function addEdge(edges, edgeKeys, source, target, kind, sourcePort, targetPort) {
  if (!source || !target) return;
  const id = edgeId(source, kind, target);
  if (edgeKeys.has(id)) return;
  edgeKeys.add(id);
  edges.push({ id, source, target, kind, sourcePort, targetPort, label: EDGE_LABELS[kind] || kind });
}

function referenceProjection(nodes, bundle = {}) {
  const referenceRoot = bundle.reference || {};
  const reference = bundle.reference_understanding || referenceRoot.reference_understanding || referenceRoot;
  const confirmation = referenceRoot.understanding_confirmation || bundle.reference_understanding_confirmation || {};
  const analysisId = text(referenceRoot.analysis_id || reference.analysis_id || reference.id, 120);
  if (!analysisId) return '';
  let node = nodes.find(item => item.type === 'reference_understanding' || String(item.id) === `reference:${analysisId}`);
  if (!node) {
    node = { id: `reference:${analysisId}`, type: 'reference_understanding', group: 'input', label: '参考理解', title: '参考理解', subtitle: '', status: 'draft', media_url: '', target_route: '', position: { x: 60, y: 80 }, read_only: true, detail: {} };
    nodes.push(node);
  }
  node.type = 'reference_understanding';
  node.title = node.label = '参考理解';
  node.subtitle = text(confirmation.status || reference.confirmation_status || reference.status || node.subtitle || '待确认', 120);
  node.detail = {
    ...(node.detail || {}),
    analysis_id: analysisId,
    revision: Math.max(0, Math.floor(number(reference.revision || reference.understanding_revision || reference.analysis_revision, 0))),
    status: text(confirmation.status || reference.confirmation_status || reference.status || '', 40),
    confirmed_revision: Math.max(0, Math.floor(number(confirmation.confirmed_revision || reference.confirmed_revision, 0))),
  };
  node.ports ||= workflowNodeContracts(node.type);
  return node.id;
}

function defaultEntityRefs(bundle = {}, world = {}) {
  const matrix = list(bundle.production_manifest?.character_world_matrix);
  const people = list(bundle.assets?.people).filter(person => {
    const id = identity(person);
    const row = matrix.find(item => String(item.character_id) === String(id));
    const cell = list(row?.cells).find(item => String(item.world_id) === String(world.id));
    return cell?.presence !== 'excluded';
  }).map(person => ({ entity_id: identity(person), entity_revision: revision(person), kind: 'person' }));
  const products = list(bundle.assets?.products).slice(0, 12)
    .map(product => ({ entity_id: identity(product), entity_revision: revision(product), kind: 'product' }));
  return [...people, ...products].filter(item => item.entity_id).slice(0, 72);
}

function normalizedDirectorDetail(state = {}, world = {}, bundle = {}) {
  const refs = entityRefs(state);
  return {
    director_scene_id: text(state.director_scene_id || `director:${world.id}`, 160),
    world_id: text(state.world_id || world.id, 120),
    revision: Math.max(0, Math.floor(number(state.revision, 0))),
    world_revision: Math.max(0, Math.floor(number(state.world_revision || world.revision, 0))),
    source_revision: Math.max(0, Math.floor(number(state.source_revision || world.source_asset?.source_revision, 0))),
    status: text(state.status || 'draft', 40),
    compatibility_status: text(state.compatibility_status || state.sync_status || (state.updated_at ? 'current' : 'draft'), 40),
    entity_refs: refs.length ? refs : defaultEntityRefs(bundle, world),
    camera_count: Math.max(0, Math.floor(number(state.camera_count, list(state.cameras).length))),
    path_count: Math.max(0, Math.floor(number(state.path_count, list(state.paths).length))),
    snapshot_count: Math.max(0, Math.floor(number(state.snapshot_count, list(state.snapshots).length))),
    updated_at: text(state.updated_at, 80),
  };
}

function ensureDirectorNodes(nodes, bundle = {}) {
  const worlds = list(bundle.scene_worlds);
  const states = directorStateRows(bundle);
  const assets = currentAssets(bundle);
  const directors = [];
  worlds.forEach((world, index) => {
    const state = states.find(item => String(item.world_id) === String(world.id)) || {};
    const baseDetail = normalizedDirectorDetail(state, world, bundle);
    let node = nodes.find(item => item.type === 'director_scene' && String(item.detail?.world_id || item.world_id) === String(world.id));
    if (!node) {
      node = {
        id: `director:${text(world.id, 120)}`, type: 'director_scene', group: 'director',
        label: `${text(world.name || `场景 ${index + 1}`, 100)} · 导演台`, title: `${text(world.name || `场景 ${index + 1}`, 100)} · 导演台`,
        subtitle: '', status: 'draft', media_url: text(world.source_asset?.image_url, 1000), target_route: '',
        position: { x: 1690, y: 80 + index * 220 }, read_only: true, detail: baseDetail,
      };
      nodes.push(node);
    } else {
      node.detail = normalizedDirectorDetail({ ...baseDetail, ...(node.detail || {}) }, world, bundle);
    }
    const stateStatus = directorStatus(node.detail, bundle, assets);
    node.status = stateStatus.status;
    node.subtitle = stateStatus.sync_status === 'current'
      ? `导演版本 ${node.detail.revision || 1} · 场景版本 ${node.detail.world_revision || world.revision || 1}`
      : (stateStatus.sync_status === 'conflict' ? '检测到并发冲突，请刷新后处理' : `有 ${stateStatus.stale_refs.length + Number(stateStatus.stale_world)} 项引用需要确认升级`);
    node.detail = { ...node.detail, ...stateStatus };
    node.ports = workflowNodeContracts(node.type);

    let animation = nodes.find(item => item.type === 'director_animation' && (
      String(item.detail?.director_scene_id || '') === String(node.detail.director_scene_id)
      || String(item.detail?.world_id || '') === String(node.detail.world_id)
    ));
    if (!animation) {
      animation = {
        id: `director-animation:${text(world.id, 120)}`, type: 'director_animation', group: 'director',
        label: `${text(world.name || `场景 ${index + 1}`, 100)} · 导演动画`, title: `${text(world.name || `场景 ${index + 1}`, 100)} · 导演动画`,
        subtitle: node.detail.path_count ? `${node.detail.path_count} 条运动轨迹` : '待规划人物与相机轨迹',
        status: node.detail.path_count ? node.status : 'draft', media_url: '', target_route: '',
        position: { x: 2180, y: 80 + index * 220 }, read_only: true,
        detail: { director_scene_id: node.detail.director_scene_id, director_revision: node.detail.revision, world_id: node.detail.world_id, path_count: node.detail.path_count, sync_status: stateStatus.sync_status },
      };
      nodes.push(animation);
    }
    animation.subtitle = node.detail.path_count ? `${node.detail.path_count} 条运动轨迹` : '待规划人物与相机轨迹';
    animation.status = node.detail.path_count ? node.status : 'draft';
    animation.detail = {
      director_scene_id: node.detail.director_scene_id,
      director_revision: node.detail.revision,
      world_id: node.detail.world_id,
      path_count: node.detail.path_count,
      sync_status: stateStatus.sync_status,
    };
    animation.ports = workflowNodeContracts(animation.type);
    directors.push({ node, animation, world, aliases: worldAliases(world) });
  });
  return directors;
}

function updateClusters(graph, nodes) {
  const clusters = list(graph.clusters).map(cluster => ({ ...cluster, node_ids: list(cluster.node_ids) }));
  const directorIds = nodes.filter(node => node.group === 'director').map(node => node.id);
  if (!directorIds.length) return clusters;
  const existing = clusters.find(cluster => cluster.id === 'director');
  if (existing) existing.node_ids = [...new Set([...existing.node_ids, ...directorIds])];
  else clusters.push({ id: 'director', label: '导演与运动', node_ids: directorIds, x: 1666, y: 32, width: 758, height: Math.max(230, Math.ceil(directorIds.length / 2) * 220 + 72) });
  return clusters;
}

/** 在权威图谱上增加轻量导演投影；这里只保留 ID、revision、状态和计数。 */
export function projectWorkflowDirectorNodes(sourceGraph = {}, bundle = {}) {
  const nodes = list(sourceGraph.nodes).map(node => ({ ...node, detail: { ...(node.detail || {}) }, position: { ...(node.position || {}) } }));
  const edges = list(sourceGraph.edges).map(edge => ({ ...edge }));
  const edgeKeys = new Set(edges.map(edge => edgeId(edge.source, edge.kind || 'feeds', edge.target)));
  const referenceId = referenceProjection(nodes, bundle);
  const directors = ensureDirectorNodes(nodes, bundle);
  nodes.forEach(node => { node.ports ||= workflowNodeContracts(node.type); });

  if (referenceId) {
    nodes.filter(node => ['person', 'scene', 'product'].includes(node.type))
      .forEach(node => addEdge(edges, edgeKeys, referenceId, node.id, 'extracts', 'understanding', node.type));
  }
  directors.forEach(({ node: director, animation, aliases }) => {
    const refs = list(director.detail?.entity_refs);
    nodes.filter(node => ['person', 'product'].includes(node.type)).forEach(assetNode => {
      const assetId = text(assetNode.id.split(':').slice(1).join(':'), 120);
      if (refs.some(ref => ref.entity_id === assetId)) addEdge(edges, edgeKeys, assetNode.id, director.id, 'stages', assetNode.type, assetNode.type === 'person' ? 'people' : 'products');
    });
    nodes.filter(node => node.type === 'scene').forEach(sceneNode => {
      const assetId = text(sceneNode.id.split(':').slice(1).join(':'), 120);
      if (aliases.has(assetId)) {
        sceneNode.detail.world_id = director.detail.world_id;
        sceneNode.detail.world_revision = director.detail.world_revision;
        addEdge(edges, edgeKeys, sceneNode.id, director.id, 'stages', 'scene', 'scene');
      }
    });
    addEdge(edges, edgeKeys, director.id, animation.id, 'animates', 'director', 'director');
    const matchingShots = nodes.filter(shot => shot.type === 'shot' && aliases.has(text(shot.detail?.bindings?.scene_id || shot.detail?.scene_id, 120)));
    matchingShots.forEach(shot => addEdge(edges, edgeKeys, director.id, shot.id, 'directs', 'shots', 'director'));
    const shotIndexes = new Set(matchingShots.map(shot => Math.max(0, number(shot.detail?.shot_index, 0))).filter(Boolean));
    nodes.filter(media => media.type === 'clip' && shotIndexes.has(Math.max(0, number(media.detail?.shot_index || String(media.id).split(':')[1], 0))))
      .forEach(media => addEdge(edges, edgeKeys, animation.id, media.id, 'drives_motion', 'animation', 'animation'));
  });

  if (directors.length) {
    // 只移动服务端的默认列，不覆盖用户已经拖动的自定义布局。
    nodes.forEach(node => {
      if (['keyframe', 'clip'].includes(node.type) && number(node.position?.x, 0) === 1940) node.position.x = 2480;
      if (node.type === 'final' && number(node.position?.x, 0) === 2400) node.position.x = 2980;
    });
  }
  return {
    ...sourceGraph,
    nodes,
    edges,
    clusters: updateClusters(sourceGraph, nodes),
    stats: { ...(sourceGraph.stats || {}), nodes: nodes.length, edges: edges.length },
  };
}

export function workflowNodePortMarkup(node = {}) {
  const contract = node.ports || workflowNodeContracts(node.type);
  const dots = [];
  list(contract.inputs).slice(0, 4).forEach((port, index) => dots.push(`<i class="workflow-port is-input" style="--port-index:${index}" title="输入：${escape(port.contract)}"></i>`));
  list(contract.outputs).slice(0, 4).forEach((port, index) => dots.push(`<i class="workflow-port is-output" style="--port-index:${index}" title="输出：${escape(port.contract)}"></i>`));
  return dots.join('');
}

export function workflowNodePanelMarkup(node = {}) {
  const contract = node.ports || workflowNodeContracts(node.type);
  if (!contract.inputs.length && !contract.outputs.length) return '';
  const detail = node.detail || {};
  const rows = side => list(contract[side]).map(port => `<li><b>${escape(port.contract)}</b><small>${side === 'inputs' ? '输入' : '输出'}端口 · ${escape(port.id)}${port.max ? ` · 最多 ${Number(port.max)}` : ''}</small></li>`).join('');
  const warning = detail.sync_status === 'conflict'
    ? '<div class="workflow-sync-warning is-conflict"><b>并发冲突</b><p>另一入口已经更新导演版本。当前草稿不会静默覆盖，请刷新后合并或另存分支。</p></div>'
    : (detail.sync_status === 'stale'
      ? `<div class="workflow-sync-warning"><b>引用版本已更新</b><p>${Number(list(detail.stale_refs).length) + Number(detail.stale_world === true)} 项人物或场景引用需要确认升级；视频生成不会静默使用旧版本。</p></div>`
      : '');
  const canOpenDirector = ['scene', 'director_scene', 'director_animation'].includes(node.type);
  const worldId = text(detail.world_id || (node.type === 'scene' ? node.id.split(':').slice(1).join(':') : ''), 120);
  return `<section class="workflow-contract-panel">
    <header><h3>节点输入 / 输出合同</h3><span class="is-${escape(detail.sync_status || node.status || 'current')}">${escape(detail.sync_status === 'stale' ? '待升级' : detail.sync_status === 'conflict' ? '有冲突' : '已同步')}</span></header>
    ${warning}
    <div class="workflow-contract-columns"><div><b>输入</b><ul>${rows('inputs') || '<li><small>无上游输入</small></li>'}</ul></div><div><b>输出</b><ul>${rows('outputs') || '<li><small>无下游输出</small></li>'}</ul></div></div>
    ${canOpenDirector && worldId ? `<button class="btn primary panel-route" type="button" data-open-workflow-director="${escape(worldId)}">${node.type === 'scene' ? '创建 / 打开3D导演台' : '打开同一3D导演台'}</button>` : ''}
  </section>`;
}

export function ensureWorkflowDirectorStyles() {
  if (typeof document === 'undefined' || document.querySelector('link[data-workflow-director-css]')) return;
  const link = document.createElement('link');
  const moduleUrl = new URL(import.meta.url);
  link.rel = 'stylesheet';
  link.dataset.workflowDirectorCss = 'true';
  link.href = `/story-ad/workflow-director.css${moduleUrl.search || ''}`;
  document.head.appendChild(link);
}

export function bindWorkflowDirectorSync({ taskId, refresh }) {
  if (typeof window === 'undefined') return () => {};
  let refreshTimer = 0;
  const schedule = () => {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => { if (typeof refresh === 'function') void refresh(); }, 160);
  };
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('vido-story-ad-director-v1') : null;
  const message = event => { if (String(event.data?.task_id || '') === String(taskId)) schedule(); };
  channel?.addEventListener('message', message);
  const visible = () => { if (document.visibilityState === 'visible') schedule(); };
  document.addEventListener('visibilitychange', visible);
  return () => {
    clearTimeout(refreshTimer);
    channel?.removeEventListener('message', message);
    channel?.close();
    document.removeEventListener('visibilitychange', visible);
  };
}

export async function openWorkflowDirector({ taskId, world, refresh }) {
  if (!taskId || !world?.id) throw new Error('当前导演节点缺少场景引用，无法打开');
  const before = new Set(typeof document === 'undefined' ? [] : document.querySelectorAll('.director-studio'));
  const module = await import('./directorStudioView.js?v=20260814-reference-world-recognition-v50');
  await module.openDirectorStudio({ taskId, world });
  const overlay = [...document.querySelectorAll('.director-studio')].find(item => !before.has(item));
  if (!overlay) return;
  const observer = new MutationObserver(() => {
    if (overlay.isConnected) return;
    observer.disconnect();
    if (typeof BroadcastChannel === 'function') {
      const channel = new BroadcastChannel('vido-story-ad-director-v1');
      channel.postMessage({ task_id: taskId, world_id: world.id, event: 'director_scene.updated' });
      channel.close();
    }
    if (typeof refresh === 'function') void refresh();
  });
  observer.observe(document.body, { childList: true });
}
