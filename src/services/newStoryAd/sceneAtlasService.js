const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const mediaAdapter = require('./mediaAdapter');
const { cleanText } = require('./contextBuilder');

const SPACE_ASSET_SCHEMA_VERSION = 7;
const ATLAS_VIEW_KEYS = Object.freeze(['master', 'reverse', 'interaction', 'detail']);
const ATLAS_CROPS = Object.freeze({
  master: Object.freeze({ x: 0, y: 0, width: 0.5, height: 0.5, role: 'master_establishing' }),
  reverse: Object.freeze({ x: 0.5, y: 0, width: 0.5, height: 0.5, role: 'reverse_or_side' }),
  interaction: Object.freeze({ x: 0, y: 0.5, width: 0.5, height: 0.5, role: 'interaction_position' }),
  detail: Object.freeze({ x: 0.5, y: 0.5, width: 0.5, height: 0.5, role: 'material_detail' }),
});

function sha256File(filePath = '') {
  const resolved = path.resolve(String(filePath || ''));
  if (!resolved || !fs.existsSync(resolved)) return '';
  return crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
}

function shortHash(value = '', length = 16) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function sourceFilePath(source = {}) {
  const direct = cleanText(source.filePath || source.file_path || '', 1000);
  if (direct && fs.existsSync(path.resolve(direct))) return path.resolve(direct);
  const url = cleanText(source.url || source.image_url || source.imageUrl || '', 1600);
  if (url.startsWith('/api/new-story-ad/assets/')) {
    const candidate = mediaAdapter.assetPathFromName(decodeURIComponent(url.split('/').pop()?.split('?')[0] || ''));
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function buildSceneAtlasPrompt(scenePrompt = '', options = {}) {
  const repairFeedback = cleanText(options.repairFeedback || '', 1200);
  return [
    'Create one canonical 2-by-2 perspective atlas of ONE AND THE SAME physical location.',
    'The four equal panels must be, in reading order: top-left MASTER ESTABLISHING view; top-right TRUE REVERSE OR SIDE view with a substantial camera relocation; bottom-left PRACTICAL INTERACTION-POSITION view showing the empty action zone and route; bottom-right CLOSE MATERIAL / CONSTRUCTION DETAIL view.',
    'All four panels must preserve identical fixed geometry, openings, boundaries, anchor positions, materials, colour family, object design and lighting direction. Only camera position, framing and scale may change.',
    'Use a thin neutral gutter between panels. Keep each panel as an unoccupied clean 16:9 photograph containing only task-defined spatial content, free of readable typography, identifying marks and additional inset imagery after local cropping.',
    'The result is a spatial identity asset, not four independent scene concepts. Do not redesign, restyle or substitute the location between panels.',
    repairFeedback
      ? `Mandatory correction: ${repairFeedback}. Rebuild the complete atlas so every perspective shares the corrected physical identity.`
      : '',
    scenePrompt,
  ].filter(Boolean).join('\n\n');
}

async function splitSceneAtlas({ source = {}, taskId = '', sceneId = '', revision = 1 } = {}) {
  const parentPath = sourceFilePath(source);
  if (!parentPath) {
    const error = new Error('空间母图未形成可读取的本地文件，无法执行零费用裁切');
    error.code = 'SCENE_ATLAS_SOURCE_UNAVAILABLE';
    error.retryable = true;
    throw error;
  }
  const parentSha256 = sha256File(parentPath);
  if (!parentSha256) {
    const error = new Error('空间母图无法计算完整性校验值，已停止派生视图');
    error.code = 'SCENE_ATLAS_HASH_FAILED';
    error.retryable = true;
    throw error;
  }
  const parentAssetId = `space_atlas_${shortHash(`${taskId}:${sceneId}:${revision}:${parentSha256}`, 20)}`;
  let views;
  try {
    const metadata = await require('sharp')(parentPath).metadata();
    const nativeTileWidth = Math.max(1, Math.floor((Number(metadata.width) || 1536) / 2));
    const nativeTileHeight = Math.max(1, Math.floor((Number(metadata.height) || 1024) / 2));
    const outputWidth = Math.min(1024, nativeTileWidth);
    const outputHeight = Math.min(576, nativeTileHeight, Math.round(outputWidth * 9 / 16));
    views = await mediaAdapter.splitReferenceSheet({
      source: { ...source, filePath: parentPath },
      filenamePrefix: `scene_atlas_${shortHash(taskId, 10)}_${shortHash(sceneId, 10)}_r${Math.max(1, Number(revision) || 1)}`,
      filenameSuffix: parentSha256.slice(0, 12),
      viewKeys: ATLAS_VIEW_KEYS,
      outputWidth,
      outputHeight,
      fit: 'cover',
      background: { r: 5, g: 7, b: 11, alpha: 1 },
    });
  } catch (cause) {
    const error = new Error(`空间母图本地裁切失败：${String(cause?.message || cause || '').slice(0, 240)}`);
    error.code = 'SCENE_ATLAS_SPLIT_FAILED';
    error.retryable = true;
    error.cause = cause;
    throw error;
  }
  return {
    parent: {
      asset_id: parentAssetId,
      type: 'perspective_atlas_2x2',
      url: cleanText(source.url || source.image_url || '', 1600),
      image_url: cleanText(source.image_url || source.url || '', 1600),
      filename: cleanText(source.filename || path.basename(parentPath), 200),
      filePath: parentPath,
      provider_used: cleanText(source.provider_used || '', 160),
      sha256: parentSha256,
    },
    views: views.map((view, index) => {
      const key = ATLAS_VIEW_KEYS[index];
      return {
        ...view,
        key,
        source_kind: 'atlas_local_crop',
        source_role: ATLAS_CROPS[key].role,
        derived_locally: true,
        parent_asset_id: parentAssetId,
        parent_sha256: parentSha256,
        crop: { ...ATLAS_CROPS[key] },
        file_sha256: sha256File(view.filePath),
      };
    }),
  };
}

function buildSpaceAssetContract({
  spaceId = '',
  sceneId = '',
  revision = 1,
  atlas = null,
  views = [],
  layout = null,
} = {}) {
  const parent = atlas?.parent || atlas || {};
  const perspectiveViews = (Array.isArray(views) ? views : [])
    .filter(view => ATLAS_VIEW_KEYS.includes(view?.key))
    .map(view => ({
      key: view.key,
      camera_id: cleanText(view.camera_id || `camera_${view.key}`, 100),
      url: cleanText(view.url || view.image_url || '', 1600),
      parent_asset_id: cleanText(view.parent_asset_id || parent.asset_id || '', 120),
      parent_sha256: cleanText(view.parent_sha256 || parent.sha256 || '', 64),
      file_sha256: cleanText(view.file_sha256 || '', 64),
      crop: view.crop && typeof view.crop === 'object' ? { ...view.crop } : null,
      derivation: 'local_crop',
    }));
  return {
    schema_version: SPACE_ASSET_SCHEMA_VERSION,
    strategy: 'atlas_2x2',
    space_id: cleanText(spaceId || sceneId, 120),
    scene_id: cleanText(sceneId || spaceId, 120),
    scene_revision: Math.max(1, Number(revision) || 1),
    canonical_source: {
      asset_id: cleanText(parent.asset_id || '', 120),
      type: 'perspective_atlas_2x2',
      url: cleanText(parent.url || parent.image_url || '', 1600),
      sha256: cleanText(parent.sha256 || '', 64),
      provider_used: cleanText(parent.provider_used || '', 160),
      billing_state: 'confirmed',
    },
    perspective_views: perspectiveViews,
    layout_asset: layout ? {
      key: 'layout',
      url: cleanText(layout.url || layout.image_url || '', 1600),
      parent_asset_id: cleanText(parent.asset_id || '', 120),
      parent_sha256: cleanText(parent.sha256 || '', 64),
      derivation: 'image_generation_from_atlas',
    } : null,
    provider_image_call_count: 2,
    local_crop_count: perspectiveViews.length,
    created_at: new Date().toISOString(),
  };
}

module.exports = {
  SPACE_ASSET_SCHEMA_VERSION,
  ATLAS_VIEW_KEYS,
  ATLAS_CROPS,
  buildSceneAtlasPrompt,
  splitSceneAtlas,
  buildSpaceAssetContract,
  sha256File,
};
