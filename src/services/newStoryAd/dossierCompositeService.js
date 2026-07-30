const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const mediaAdapterDefault = require('./mediaAdapter');

function localAsset(asset = {}, mediaAdapter = mediaAdapterDefault) {
  return mediaAdapter.assetPathFromName(asset.filename || path.basename(String(asset.image_url || '')));
}

function compositeFilename(kind, taskId, assetId, revision) {
  const digest = crypto.createHash('sha256')
    .update([taskId, assetId, kind, revision].map(value => String(value || '')).join('\n'))
    .digest('hex')
    .slice(0, 16);
  return `person_${kind}_r${Math.max(1, Number(revision) || 1)}_${digest}.png`;
}

async function fittedTile(asset, width, height, mediaAdapter, fit = 'contain') {
  const local = localAsset(asset, mediaAdapter);
  if (!local || !fs.existsSync(local)) return null;
  return sharp(local)
    .resize(width, height, { fit, position: 'attention', background: '#f5f1e9' })
    .png()
    .toBuffer();
}

async function detailTile(asset, focus, width, height, mediaAdapter) {
  const local = localAsset(asset, mediaAdapter);
  if (!local || !fs.existsSync(local)) return null;
  const image = sharp(local).rotate();
  const metadata = await image.metadata();
  const sourceWidth = Number(metadata.width || 0);
  const sourceHeight = Number(metadata.height || 0);
  if (!sourceWidth || !sourceHeight) return null;
  const left = Math.max(0, Math.min(sourceWidth - 2, Math.round(sourceWidth * focus.x)));
  const top = Math.max(0, Math.min(sourceHeight - 2, Math.round(sourceHeight * focus.y)));
  const cropWidth = Math.max(2, Math.min(sourceWidth - left, Math.round(sourceWidth * focus.width)));
  const cropHeight = Math.max(2, Math.min(sourceHeight - top, Math.round(sourceHeight * focus.height)));
  return image
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize(width, height, { fit: 'cover', position: 'attention' })
    .png()
    .toBuffer();
}

async function composePersonDossier({
  taskId,
  assetId = 'primary',
  anchor = {},
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
  const width = 2400;
  const height = 1350;
  const composites = [];
  const byKind = kind => atomicAssets.filter(item => item.kind === kind);
  const body = byKind('body');
  const expressions = byKind('expression');
  const actions = byKind('action');
  const identity = byKind('identity');
  const hero = Object.keys(anchor || {}).length ? anchor : body[0];
  const heroBuffer = await fittedTile(hero, 540, 1120, mediaAdapter);
  if (heroBuffer) composites.push({ input: heroBuffer, left: 36, top: 150 });

  for (let index = 0; index < body.slice(0, 4).length; index += 1) {
    const buffer = await fittedTile(body[index], 250, 420, mediaAdapter);
    if (buffer) composites.push({ input: buffer, left: 620 + index * 260, top: 100 });
  }
  for (let index = 0; index < actions.slice(0, 3).length; index += 1) {
    const buffer = await fittedTile(actions[index], 220, 420, mediaAdapter);
    if (buffer) composites.push({ input: buffer, left: 1680 + index * 225, top: 100 });
  }
  for (let index = 0; index < expressions.slice(0, 6).length; index += 1) {
    const buffer = await fittedTile(expressions[index], 270, 250, mediaAdapter, 'cover');
    if (buffer) composites.push({ input: buffer, left: 620 + index * 280, top: 585 });
  }
  const detailSpecs = [
    { asset: identity[0], focus: { x: 0.17, y: 0.1, width: 0.66, height: 0.28 } },
    { asset: identity[2] || identity[1], focus: { x: 0.08, y: 0.06, width: 0.7, height: 0.52 } },
    { asset: body[0], focus: { x: 0.26, y: 0.15, width: 0.48, height: 0.27 } },
    { asset: body[2] || body[0], focus: { x: 0.42, y: 0.28, width: 0.36, height: 0.36 } },
    { asset: body[0], focus: { x: 0.24, y: 0.68, width: 0.52, height: 0.3 } },
    { asset: actions[2] || actions[0], focus: { x: 0.3, y: 0.25, width: 0.4, height: 0.32 } },
    { asset: body[3] || body[0], focus: { x: 0.24, y: 0.16, width: 0.52, height: 0.36 } },
    { asset: body[1] || body[0], focus: { x: 0.28, y: 0.32, width: 0.44, height: 0.32 } },
  ];
  let detailCropCount = 0;
  for (let index = 0; index < detailSpecs.length; index += 1) {
    const buffer = await detailTile(detailSpecs[index].asset, detailSpecs[index].focus, 200, 285, mediaAdapter);
    if (!buffer) continue;
    detailCropCount += 1;
    composites.push({ input: buffer, left: 620 + index * 210, top: 940 });
  }
  const safeTitle = String(title).replace(/[<>&]/g, '').slice(0, 80);
  const labelSvg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f5f1e9"/>
      <text x="36" y="58" font-family="Arial" font-size="34" font-weight="700" fill="#2d2924">${safeTitle}</text>
      <text x="36" y="92" font-family="Arial" font-size="16" fill="#6f675d">CHARACTER BIBLE / R${revision} / LOCAL COMPOSITE</text>
      <line x1="620" y1="72" x2="2360" y2="72" stroke="#aaa196" stroke-width="2"/>
      <text x="620" y="94" font-family="Arial" font-size="18" font-weight="700" fill="#504940">TURNAROUND</text>
      <text x="1680" y="94" font-family="Arial" font-size="18" font-weight="700" fill="#504940">BASE ACTIONS</text>
      <line x1="620" y1="555" x2="2360" y2="555" stroke="#aaa196" stroke-width="2"/>
      <text x="620" y="580" font-family="Arial" font-size="18" font-weight="700" fill="#504940">EXPRESSION STUDY</text>
      <line x1="620" y1="905" x2="2360" y2="905" stroke="#aaa196" stroke-width="2"/>
      <text x="620" y="932" font-family="Arial" font-size="18" font-weight="700" fill="#504940">DETAIL STUDY · crops from finished identity, wardrobe and action images</text>
    </svg>`,
  );
  const filename = compositeFilename('dossier', taskId, assetId, revision);
  const out = mediaAdapter.assetPathFromName(filename);
  await sharp(labelSvg).composite(composites).png().toFile(out);
  return {
    filename,
    image_url: mediaAdapter.publicAssetUrl(filename),
    composition: 'local_sharp',
    model_generated_text: false,
    atomic_count: atomicAssets.length,
    layout: 'editorial_character_bible_v2',
    detail_crop_count: detailCropCount,
    detail_crop_source: 'finished_atomic_assets',
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
  const filename = compositeFilename('reference_board', taskId, assetId, revision);
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
  compositeFilename,
  composePersonDossier,
  composePersonReferenceBoard,
};
