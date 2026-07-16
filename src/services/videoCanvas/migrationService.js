const fs = require('fs');
const path = require('path');
const { db } = require('./database');
const projectRepository = require('./projectRepository');
const { normalizeGraph, validateGraph } = require('./graphService');
const { NODE_CATALOG, compatible } = require('./nodeCatalog');

const LEGACY_PATH = path.resolve(process.env.OUTPUT_DIR || './outputs', 'workflow_db.json');
const TYPE_MAP = Object.freeze({
  text: 'text-input',
  image: 'image-generate',
  background: 'image-generate',
  character: 'character',
  i2v: 'image-to-video',
  video: 'text-to-video',
  voice: 'voice',
  music: 'music',
  merge: 'merge',
  avatar: 'character',
});

function readLegacy() {
  if (!fs.existsSync(LEGACY_PATH)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(LEGACY_PATH, 'utf8'));
    return Array.isArray(data.workflows) ? data.workflows : [];
  } catch {
    return [];
  }
}

function meaningfulText(raw = {}) {
  const candidates = [
    raw.text,
    raw.prompt,
    raw.text_0,
    raw.description,
    raw._textareas?.[0],
  ];
  return String(candidates.find(value => typeof value === 'string' && value.trim()) || '').trim();
}

function legacyNodeType(item = {}) {
  const oldType = String(item.name || item.class || '').replace(/^ac-node-/, '');
  return TYPE_MAP[oldType] || 'text-input';
}

function hasLegacyImageInput(legacyId, data, typeById) {
  const item = data[legacyId] || {};
  return Object.values(item.inputs || {}).some(input => (input.connections || []).some(connection => {
    const sourceType = typeById.get(String(connection.node));
    return sourceType === 'image-generate' || sourceType === 'character' || sourceType === 'image-upload';
  }));
}

function normalizeLegacyConfig(type, raw = {}) {
  const text = meaningfulText(raw);
  const config = {};
  const reviewReasons = [];

  if (type === 'text-input') {
    config.text = text || '请补充原始文案';
    if (!text) reviewReasons.push('缺少原始文案');
  } else if (['text-generate', 'structured-text', 'image-generate', 'image-edit', 'character', 'text-to-video', 'image-to-video', 'music'].includes(type)) {
    config.prompt = text || '请补充生成要求';
    if (!text) reviewReasons.push('缺少生成要求');
  }

  if (type === 'character') config.views = Math.max(1, Math.min(6, Number(raw.views) || 1));
  if (['text-to-video', 'image-to-video'].includes(type)) {
    const selects = Array.isArray(raw._selects) ? raw._selects : [];
    config.model = String(raw.model || raw.select_0 || selects[0] || '').trim();
    config.duration = Math.max(3, Math.min(15, Number(raw.duration || raw.select_1 || selects[1]) || 5));
    config.aspectRatio = String(raw.aspectRatio || raw.select_2 || selects[2] || '16:9');
    if (!config.model) reviewReasons.push('缺少视频模型');
  }
  if (['image-generate', 'image-edit', 'character'].includes(type)) {
    const selects = Array.isArray(raw._selects) ? raw._selects : [];
    config.model = String(raw.model || raw.select_0 || selects[0] || '').trim();
    config.aspectRatio = String(raw.aspectRatio || raw.select_1 || selects[1] || '16:9');
  }

  const legacyPreviewImage = String(raw._previewImg || raw.image_url || '').trim();
  const legacyPreviewVideo = String(raw._previewVid || raw.video_url || '').trim();
  if (legacyPreviewImage) config.legacyPreviewImage = legacyPreviewImage;
  if (legacyPreviewVideo) config.legacyPreviewVideo = legacyPreviewVideo;
  if (reviewReasons.length) {
    config.migrationNeedsReview = true;
    config.migrationReviewReasons = reviewReasons;
  }
  return config;
}

function chooseSourcePort(type) {
  const outputs = NODE_CATALOG[type]?.outputs || {};
  return Object.keys(outputs)[0] || '';
}

function chooseTargetPort(sourceType, targetType, usedPorts) {
  const inputs = NODE_CATALOG[targetType]?.inputs || {};
  const compatiblePorts = Object.entries(inputs)
    .filter(([, inputType]) => compatible(sourceType, inputType))
    .map(([port]) => port);
  return compatiblePorts.find(port => !usedPorts.has(port)) || compatiblePorts[0] || '';
}

function convertDrawflow(drawflow = {}) {
  const data = drawflow?.drawflow?.Home?.data || drawflow?.Home?.data || {};
  const typeById = new Map(Object.entries(data).map(([legacyId, item]) => [String(legacyId), legacyNodeType(item)]));

  for (const [legacyId, type] of typeById) {
    if (type === 'text-to-video' && hasLegacyImageInput(legacyId, data, typeById)) typeById.set(legacyId, 'image-to-video');
  }

  const nodes = Object.entries(data).map(([legacyId, item], index) => {
    const type = typeById.get(String(legacyId)) || 'text-input';
    const raw = item.data || {};
    return {
      id: `legacy_${legacyId}`,
      type,
      version: 1,
      label: String(raw.label || raw.charName || '').slice(0, 100),
      config: normalizeLegacyConfig(type, raw),
      position: {
        x: Number(item.pos_x) || 60 + index * 260,
        y: Number(item.pos_y) || 120,
      },
    };
  });

  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const edges = [];
  const seen = new Set();
  const usedTargetPorts = new Map();
  for (const [legacyId, item] of Object.entries(data)) {
    for (const output of Object.values(item.outputs || {})) {
      for (const connection of output.connections || []) {
        const sourceNode = nodeById.get(`legacy_${legacyId}`);
        const targetNode = nodeById.get(`legacy_${connection.node}`);
        if (!sourceNode || !targetNode) continue;
        const sourcePort = chooseSourcePort(sourceNode.type);
        const sourceType = NODE_CATALOG[sourceNode.type]?.outputs?.[sourcePort];
        const targetKey = targetNode.id;
        const usedPorts = usedTargetPorts.get(targetKey) || new Set();
        const targetPort = chooseTargetPort(sourceType, targetNode.type, usedPorts);
        if (!sourcePort || !targetPort) continue;
        const signature = `${sourceNode.id}:${sourcePort}>${targetNode.id}:${targetPort}`;
        if (seen.has(signature)) continue;
        seen.add(signature);
        usedPorts.add(targetPort);
        usedTargetPorts.set(targetKey, usedPorts);
        edges.push({
          id: `legacy_edge_${legacyId}_${connection.node}_${edges.length + 1}`,
          source: sourceNode.id,
          sourcePort,
          target: targetNode.id,
          targetPort,
        });
      }
    }
  }
  return normalizeGraph({ nodes, edges });
}

function reviewSummary(graph) {
  const nodes = graph.nodes.filter(node => node.config?.migrationNeedsReview);
  return {
    needsReview: nodes.length > 0,
    reviewNodeCount: nodes.length,
    reviewNodes: nodes.map(node => ({
      nodeId: node.id,
      reasons: node.config.migrationReviewReasons || [],
    })),
  };
}

function preview({ userId = '', includeAll = false } = {}) {
  return readLegacy()
    .filter(row => includeAll || String(row.user_id || '') === String(userId))
    .map(row => {
      const graph = convertDrawflow(row.drawflow);
      const validation = validateGraph(graph);
      const review = reviewSummary(graph);
      const owner = row.user_id || userId || 'legacy';
      const existing = db().prepare('SELECT id FROM video_canvas_projects WHERE user_id=? AND legacy_workflow_id=?').get(owner, row.id);
      return {
        legacyId: row.id,
        userId: owner,
        name: row.name || '旧视频画布项目',
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        valid: validation.valid,
        errors: validation.errors,
        ...review,
        existingProjectId: existing?.id || '',
      };
    });
}

function migrate({ userId = '', includeAll = false } = {}) {
  const rows = readLegacy().filter(row => includeAll || String(row.user_id || '') === String(userId));
  const result = { created: [], skipped: [], failed: [] };
  for (const row of rows) {
    const owner = row.user_id || userId || 'legacy';
    const existing = db().prepare('SELECT id FROM video_canvas_projects WHERE user_id=? AND legacy_workflow_id=?').get(owner, row.id);
    if (existing) {
      result.skipped.push({ legacyId: row.id, projectId: existing.id });
      continue;
    }
    try {
      const graph = convertDrawflow(row.drawflow);
      const validation = validateGraph(graph);
      if (!validation.valid) throw new Error(validation.errors.map(item => item.message).join('；'));
      const review = reviewSummary(graph);
      const created = projectRepository.createProject({
        userId: owner,
        name: row.name || '旧视频画布项目',
        domainPack: 'blank',
        settings: { migratedFromV1: true, migrationNeedsReview: review.needsReview },
        graph,
      });
      db().prepare('UPDATE video_canvas_projects SET legacy_workflow_id=? WHERE id=?').run(row.id, created.project.id);
      result.created.push({ legacyId: row.id, projectId: created.project.id, ...review });
    } catch (error) {
      result.failed.push({ legacyId: row.id, error: error.message });
    }
  }
  return result;
}

module.exports = { LEGACY_PATH, convertDrawflow, migrate, preview, readLegacy };
