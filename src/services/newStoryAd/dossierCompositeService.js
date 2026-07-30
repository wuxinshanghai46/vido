const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const mediaAdapterDefault = require('./mediaAdapter');

function safeSegment(value = '') {
  return String(value || '').replace(/[^a-z0-9_-]/ig, '_').slice(0, 90) || 'asset';
}

function localAsset(asset = {}, mediaAdapter = mediaAdapterDefault) {
  return mediaAdapter.assetPathFromName(asset.filename || path.basename(String(asset.image_url || '')));
}

async function composePersonDossier({
  taskId,
  assetId = 'primary',
  atomicAssets = [],
  revision = 1,
  title = 'Character Production Dossier',
} = {}, deps = {}) {
  const mediaAdapter = deps.mediaAdapter || mediaAdapterDefault;
  if (typeof mediaAdapter.assetPathFromName !== 'function' || typeof mediaAdapter.publicAssetUrl !== 'function') {
    return {
      filename: '',
      image_url: atomicAssets[0]?.image_url || atomicAssets[0]?.url || '',
      composition: 'local_composite_mock',
      model_generated_text: false,
      atomic_count: atomicAssets.length,
    };
  }
  const width = 1800;
  const height = 1400;
  const padding = 30;
  const tileWidth = 280;
  const tileHeight = 360;
  const composites = [];
  for (let index = 0; index < atomicAssets.length; index += 1) {
    const local = localAsset(atomicAssets[index], mediaAdapter);
    if (!local || !fs.existsSync(local)) continue;
    const buffer = await sharp(local)
      .resize(tileWidth, tileHeight - 42, { fit: 'contain', background: '#f8fafc' })
      .extend({ bottom: 42, background: '#f8fafc' })
      .png()
      .toBuffer();
    composites.push({
      input: buffer,
      left: padding + (index % 6) * (tileWidth + 12),
      top: 90 + Math.floor(index / 6) * (tileHeight + 12),
    });
  }
  const safeTitle = String(title).replace(/[<>&]/g, '').slice(0, 80);
  const safeTask = String(taskId).replace(/[<>&]/g, '').slice(0, 80);
  const labelSvg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f8fafc"/>
      <text x="30" y="54" font-family="Arial" font-size="32" font-weight="700" fill="#0f172a">${safeTitle} · ${safeTask} · R${revision}</text>
      <text x="30" y="82" font-family="Arial" font-size="18" fill="#475569">17 atomic identity, body, expression and action references · composed locally</text>
    </svg>`,
  );
  const filename = `person_dossier_${safeSegment(taskId)}_${safeSegment(assetId)}_r${revision}.png`;
  const out = mediaAdapter.assetPathFromName(filename);
  await sharp(labelSvg).composite(composites).png().toFile(out);
  return {
    filename,
    image_url: mediaAdapter.publicAssetUrl(filename),
    composition: 'local_sharp',
    model_generated_text: false,
    atomic_count: atomicAssets.length,
  };
}

async function composePersonReferenceBoard({
  taskId,
  assetId = 'primary',
  anchor = {},
  atomicAssets = [],
  revision = 1,
} = {}, deps = {}) {
  const mediaAdapter = deps.mediaAdapter || mediaAdapterDefault;
  const selected = [
    anchor,
    atomicAssets.find(item => item.kind === 'identity' && item.key === 'face_front'),
    atomicAssets.find(item => item.kind === 'body' && item.key === 'front'),
    atomicAssets.find(item => item.kind === 'body' && item.key === 'side'),
  ].filter(Boolean);
  const tiles = [];
  for (let index = 0; index < selected.length; index += 1) {
    const local = localAsset(selected[index], mediaAdapter);
    if (!local || !fs.existsSync(local)) continue;
    tiles.push({
      input: await sharp(local).resize(500, 700, { fit: 'contain', background: '#f8fafc' }).png().toBuffer(),
      left: (index % 2) * 512,
      top: Math.floor(index / 2) * 712,
    });
  }
  const filename = `person_reference_board_${safeSegment(taskId)}_${safeSegment(assetId)}_r${revision}.png`;
  const out = mediaAdapter.assetPathFromName(filename);
  await sharp({
    create: { width: 1024, height: 1424, channels: 3, background: '#f8fafc' },
  }).composite(tiles).png().toFile(out);
  return {
    filename,
    image_url: mediaAdapter.publicAssetUrl(filename),
    composition: 'local_sharp_reference_compiler',
    includes: ['approved_outfit_anchor', 'face_front', 'body_front', 'body_side'],
    provider_reference_slot_cost: 1,
  };
}

module.exports = {
  composePersonDossier,
  composePersonReferenceBoard,
};
