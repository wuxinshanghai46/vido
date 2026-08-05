const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const mediaAdapterDefault = require('./mediaAdapter');
const checkpointServiceDefault = require('./assetGenerationCheckpointService');

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

function wearableFilename(key, taskId, assetId, revision) {
  const safeKey = String(key || 'detail').replace(/[^a-z0-9_-]/ig, '_').slice(0, 40);
  return compositeFilename(`wearable_${safeKey}`, taskId, assetId, revision);
}

function wardrobeFilename(key, taskId, assetId, revision) {
  const safeKey = String(key || 'detail').replace(/[^a-z0-9_-]/ig, '_').slice(0, 40);
  return compositeFilename(`wardrobe_${safeKey}`, taskId, assetId, revision);
}

const ACCESSORY_DEFINITIONS = [
  { key: 'ear_accessories', label: '耳饰', pattern: /耳环|耳饰|耳钉|耳坠|耳夹|earrings?/i, referenceKinds: [['identity', 'face_profile'], ['identity', 'face_front']] },
  { key: 'neck_accessories', label: '项链 / 颈部配饰', pattern: /项链|颈链|吊坠|领针|胸针|necklace|pendant|brooch/i, referenceKinds: [['identity', 'face_front'], ['body', 'front']] },
  { key: 'wrist_wearables', label: '腕表 / 手链 / 手部配饰', pattern: /手表|腕表|手链|手镯|戒指|watch|bracelet|bangle|ring/i, referenceKinds: [['body', 'three_quarter'], ['body', 'front']] },
  { key: 'shoes', label: '鞋履', pattern: /鞋|靴|凉鞋|高跟|shoes?|sneakers?|boots?|heels?|sandals?/i, referenceKinds: [['body', 'front'], ['body', 'three_quarter']] },
];

const WARDROBE_DEFINITIONS = [
  { key: 'outfit_silhouette', label: '整体穿搭拆解', aspectRatio: '3:4', referenceKinds: [['body', 'front']] },
  { key: 'neckline_cut', label: '领口与肩部剪裁', aspectRatio: '4:3', referenceKinds: [['body', 'front'], ['identity', 'face_front']] },
  { key: 'fabric_drape', label: '面料光泽与垂坠', aspectRatio: '4:3', referenceKinds: [['body', 'three_quarter'], ['body', 'front']] },
  { key: 'hem_and_footwear', label: '裙摆与鞋履搭配', aspectRatio: '4:3', referenceKinds: [['body', 'front'], ['body', 'three_quarter']] },
];

function atomicByKindKey(atomicAssets = [], pairs = []) {
  for (const [kind, key] of pairs) {
    const found = atomicAssets.find(item => item?.kind === kind && item?.key === key && item?.image_url);
    if (found) return found;
  }
  return atomicAssets.find(item => item?.image_url) || null;
}

function explicitAccessoryDefinitions(profile = {}) {
  const wardrobe = String(profile.wardrobeText || profile.wardrobe || '')
    .replace(/(?:不佩戴|未佩戴|没有|无)(?:任何)?[^，。；]{0,24}(?=，|。|；|$)/g, '');
  return ACCESSORY_DEFINITIONS.filter(item => item.pattern.test(wardrobe));
}

async function generateDetailRows({
  taskId,
  assetId = 'primary',
  atomicAssets = [],
  revision = 1,
  profile = {},
  definitions = [],
  detailKind = 'wardrobe_detail',
  loadCheckpoint = async () => null,
  saveCheckpoint = async () => {},
  onProgress = async () => {},
} = {}, deps = {}) {
  const mediaAdapter = deps.mediaAdapter || mediaAdapterDefault;
  const checkpointService = deps.checkpointService || checkpointServiceDefault;
  if (typeof mediaAdapter.generateImage !== 'function') throw new Error('人物高清细节生成缺少图片模型适配器');
  const rows = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const spec = definitions[index];
    const checkpointKey = `person_detail:${assetId}:${revision}:${detailKind}:${spec.key}`;
    const cached = await loadCheckpoint(checkpointKey);
    if (cached?.image_url) {
      rows.push(cached);
      await onProgress({ completed: index + 1, total: definitions.length, key: spec.key, reused: true });
      continue;
    }
    const reference = atomicByKindKey(atomicAssets, spec.referenceKinds);
    if (!reference?.image_url) throw new Error(`人物高清细节 ${spec.label} 缺少可追溯参考图`);
    const detailInstruction = detailKind === 'wearable_accessory'
      ? `只展示人物设定中真实存在的“${spec.label}”单品，像专业服装造型档案的独立物件拆解图；完整呈现物件外形、材质、结构和佩戴方向，不出现人物头像、半身或全身，不凭空增加其它首饰。`
      : `制作“${spec.label}”高清服装造型证据图；这是专门重拍的商业服装细节照片，不是从全身照放大的截图。保留同一套服装的颜色、材质、结构和鞋履，清楚呈现剪裁、纹理、垂坠与真实细节。`;
    const prompt = [
      '商业影视人物造型档案，真实摄影，高清产品级细节，干净中性背景。',
      detailInstruction,
      `人物服装与配饰设定：${String(profile.wardrobeText || profile.wardrobe || '').trim()}`,
      '严格依据参考图，不改变服装款式和配色，不加入文字、标签、水印、拼贴边框或人物档案排版。',
    ].filter(Boolean).join('\n');
    const checkpointed = await checkpointService.runCheckpointedUnit({
      identity: {
        key: checkpointKey,
        taskId,
        assetType: 'person_detail',
        assetId,
        unit: `${detailKind}:${spec.key}`,
        revision,
        input: {
          detail_kind: detailKind,
          detail_key: spec.key,
          reference_image: reference.image_url,
          wardrobe: String(profile.wardrobeText || profile.wardrobe || '').trim(),
        },
      },
      load: loadCheckpoint,
      save: saveCheckpoint,
      execute: async controls => {
        const generated = controls.providerResult || await mediaAdapter.generateImage({
          taskId,
          stage: `new_story_ad.person_dossier_${detailKind}`,
          prompt,
          auditSafePrompt: prompt,
          filename: `${detailKind}_${taskId}_${assetId}_${spec.key}_r${revision}`,
          aspectRatio: spec.aspectRatio || '4:3',
          resolution: '2K',
          imageModel: 'gpt-image-2',
          referenceImages: [reference.image_url],
          requireReferences: true,
          inputFidelity: 'high',
          singleAttempt: true,
          clientRequestId: checkpointKey,
          onSubmitting: controls.onSubmitting,
          onSubmitted: controls.onSubmitted,
        });
        if (!controls.providerResult) await controls.onProviderResult(generated);
        return {
          id: `${assetId}_${spec.key}_r${Math.max(1, Number(revision) || 1)}`,
          key: spec.key,
          kind: detailKind,
          label: spec.label,
          filename: generated.filename || '',
          image_url: generated.image_url || generated.url || '',
          source_asset_id: reference.id || reference.asset_id || reference.key || '',
          derived_locally: false,
          detail_mode: 'generated_high_resolution',
          resolution: '2K',
          provider_used: generated.provider_used || '',
          model_call_count: 1,
        };
      },
    });
    const row = checkpointed.result;
    if (!row.image_url) throw new Error(`人物高清细节 ${spec.label} 未返回图片`);
    rows.push(row);
    await onProgress({ completed: index + 1, total: definitions.length, key: spec.key, reused: checkpointed.reused });
  }
  return rows;
}

async function generateWearableDetails(options = {}, deps = {}) {
  return generateDetailRows({
    ...options,
    definitions: explicitAccessoryDefinitions(options.profile || {}),
    detailKind: 'wearable_accessory',
  }, deps);
}

async function generateWardrobeDetails(options = {}, deps = {}) {
  return generateDetailRows({
    ...options,
    definitions: WARDROBE_DEFINITIONS,
    detailKind: 'wardrobe_detail',
  }, deps);
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

/**
 * 配饰是可穿戴物，不是人物头像。这里从已经完成的人物原子图本地裁切
 * 耳部、颈部、腕部和鞋履的实际穿戴证据，不再增加图片模型调用。
 */
async function composeWearableDetails({
  taskId,
  assetId = 'primary',
  anchor = {},
  atomicAssets = [],
  revision = 1,
} = {}, deps = {}) {
  const mediaAdapter = deps.mediaAdapter || mediaAdapterDefault;
  if (typeof mediaAdapter.assetPathFromName !== 'function' || typeof mediaAdapter.publicAssetUrl !== 'function') return [];
  const byKind = kind => atomicAssets.filter(item => item?.kind === kind);
  const body = byKind('body');
  const identity = byKind('identity');
  const byKey = (rows, key, fallback = 0) => rows.find(item => item?.key === key) || rows[fallback] || null;
  const specs = [
    {
      key: 'ear_accessories', label: '耳部穿戴',
      asset: byKey(identity, 'face_profile', 1) || byKey(identity, 'face_front', 0) || anchor,
      focus: { x: 0.34, y: 0.16, width: 0.34, height: 0.38 },
    },
    {
      key: 'neck_accessories', label: '颈部穿戴与领口',
      asset: byKey(identity, 'face_front', 0) || byKey(body, 'front', 0) || anchor,
      focus: { x: 0.27, y: 0.55, width: 0.46, height: 0.30 },
    },
    {
      key: 'wrist_wearables', label: '腕表 / 手链 / 手部穿戴',
      asset: byKey(body, 'three_quarter', 1) || byKey(body, 'front', 0) || anchor,
      focus: { x: 0.20, y: 0.42, width: 0.60, height: 0.24 },
    },
    {
      key: 'shoes', label: '鞋履',
      asset: byKey(body, 'front', 0) || byKey(body, 'three_quarter', 1) || anchor,
      focus: { x: 0.28, y: 0.72, width: 0.44, height: 0.15 },
    },
  ];
  const rows = [];
  for (const spec of specs) {
    const buffer = await detailTile(spec.asset, spec.focus, 640, 480, mediaAdapter);
    if (!buffer) continue;
    const filename = wearableFilename(spec.key, taskId, assetId, revision);
    const out = mediaAdapter.assetPathFromName(filename);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await fs.promises.writeFile(out, buffer);
    rows.push({
      id: `${assetId}_${spec.key}_r${Math.max(1, Number(revision) || 1)}`,
      key: spec.key,
      kind: 'wearable_accessory',
      label: spec.label,
      filename,
      image_url: mediaAdapter.publicAssetUrl(filename),
      source_asset_id: spec.asset?.id || spec.asset?.asset_id || spec.asset?.key || '',
      derived_locally: true,
      model_call_count: 0,
    });
  }
  return rows;
}

async function composeWardrobeDetails({
  taskId,
  assetId = 'primary',
  anchor = {},
  atomicAssets = [],
  revision = 1,
} = {}, deps = {}) {
  const mediaAdapter = deps.mediaAdapter || mediaAdapterDefault;
  if (typeof mediaAdapter.assetPathFromName !== 'function' || typeof mediaAdapter.publicAssetUrl !== 'function') return [];
  const body = atomicAssets.filter(item => item?.kind === 'body');
  const byKey = (key, fallback = 0) => body.find(item => item?.key === key) || body[fallback] || anchor;
  const specs = [
    {
      key: 'outfit_silhouette', label: '整体廓形', asset: byKey('front', 0),
      focus: { x: 0.24, y: 0.12, width: 0.52, height: 0.75 }, width: 520, height: 720,
    },
    {
      key: 'neckline_cut', label: '领口与肩部剪裁', asset: byKey('front', 0),
      focus: { x: 0.29, y: 0.20, width: 0.42, height: 0.24 }, width: 640, height: 480,
    },
    {
      key: 'fabric_drape', label: '面料光泽与垂坠', asset: byKey('three_quarter', 1),
      focus: { x: 0.30, y: 0.40, width: 0.40, height: 0.30 }, width: 640, height: 480,
    },
    {
      key: 'hem_and_footwear', label: '裙摆与鞋履搭配', asset: byKey('front', 0),
      focus: { x: 0.27, y: 0.65, width: 0.46, height: 0.22 }, width: 640, height: 480,
    },
  ];
  const rows = [];
  for (const spec of specs) {
    const buffer = await detailTile(spec.asset, spec.focus, spec.width, spec.height, mediaAdapter);
    if (!buffer) continue;
    const filename = wardrobeFilename(spec.key, taskId, assetId, revision);
    const out = mediaAdapter.assetPathFromName(filename);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await fs.promises.writeFile(out, buffer);
    rows.push({
      id: `${assetId}_${spec.key}_r${Math.max(1, Number(revision) || 1)}`,
      key: spec.key,
      kind: 'wardrobe_evidence',
      label: spec.label,
      filename,
      image_url: mediaAdapter.publicAssetUrl(filename),
      source_asset_id: spec.asset?.id || spec.asset?.asset_id || spec.asset?.key || '',
      derived_locally: true,
      model_call_count: 0,
    });
  }
  return rows;
}

async function composePersonDossier({
  taskId,
  assetId = 'primary',
  anchor = {},
  atomicAssets = [],
  revision = 1,
  title = 'Character Production Dossier',
  profile = {},
  wardrobeDetails = [],
  accessoryDetails = [],
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
  const xml = value => String(value || '').replace(/[<>&"']/g, character => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  }[character]));
  const compact = (value, max = 120) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const width = 1800;
  const height = 2400;
  const composites = [];
  const byKind = kind => atomicAssets.filter(item => item.kind === kind);
  const body = byKind('body');
  const expressions = byKind('expression');
  const actions = byKind('action');
  const identity = byKind('identity');
  const byKey = (rows, key, fallback = 0) => rows.find(item => item.key === key) || rows[fallback];
  const mainViews = [byKey(body, 'front', 0), byKey(body, 'side', 2), byKey(body, 'back', 3)].filter(Boolean);
  for (let index = 0; index < mainViews.length; index += 1) {
    const buffer = await fittedTile(mainViews[index], 270, 650, mediaAdapter);
    if (buffer) composites.push({ input: buffer, left: 410 + index * 280, top: 330 });
  }
  for (let index = 0; index < expressions.slice(0, 6).length; index += 1) {
    const buffer = await fittedTile(expressions[index], 200, 190, mediaAdapter, 'cover');
    if (buffer) composites.push({ input: buffer, left: 1310 + (index % 2) * 215, top: 330 + Math.floor(index / 2) * 240 });
  }
  for (let index = 0; index < actions.slice(0, 6).length; index += 1) {
    const buffer = await fittedTile(actions[index], 260, 390, mediaAdapter);
    if (buffer) composites.push({ input: buffer, left: 60 + index * 280, top: 1600 });
  }
  const wardrobeSlots = [
    { width: 170, height: 145, left: 60, top: 1185 }, { width: 170, height: 145, left: 250, top: 1185 },
    { width: 170, height: 145, left: 60, top: 1345 }, { width: 170, height: 145, left: 250, top: 1345 },
  ];
  const accessorySlots = [
    { width: 150, height: 145, left: 480, top: 1185 }, { width: 150, height: 145, left: 645, top: 1185 },
    { width: 150, height: 145, left: 480, top: 1345 }, { width: 150, height: 145, left: 645, top: 1345 },
  ];
  const detailSlots = [
    { width: 270, height: 130, left: 850, top: 1185 }, { width: 270, height: 130, left: 1140, top: 1185 },
    { width: 270, height: 130, left: 850, top: 1335 }, { width: 270, height: 130, left: 1140, top: 1335 },
  ];
  const addGeneratedTiles = async (assets, slots, fit = 'contain') => {
    let count = 0;
    for (let index = 0; index < Math.min(assets.length, slots.length); index += 1) {
      const slot = slots[index];
      const buffer = await fittedTile(assets[index], slot.width, slot.height, mediaAdapter, fit);
      if (!buffer) continue;
      composites.push({ input: buffer, left: slot.left, top: slot.top });
      count += 1;
    }
    return count;
  };
  const wardrobeTileCount = await addGeneratedTiles(wardrobeDetails, wardrobeSlots);
  const accessoryTileCount = await addGeneratedTiles(accessoryDetails, accessorySlots);
  const detailTileCount = await addGeneratedTiles([
    ...wardrobeDetails.filter(item => item.key !== 'outfit_silhouette'),
    ...accessoryDetails,
  ], detailSlots, 'cover');
  const titleText = compact(profile.displayName || profile.name || title, 28);
  const safeTitle = xml(titleText);
  const safeSignature = xml(compact(titleText, 16));
  const safeRole = xml(compact(profile.roleName || profile.role || '广告剧情人物', 90));
  const infoRows = [
    ['姓名', profile.displayName || profile.name || '待命名'],
    ['身份 / 关系', profile.roleName || profile.role || '待补充'],
    ['年龄', profile.age || profile.ageRange || '按人物设定'],
    ['外貌与气质', profile.appearanceText || profile.appearance || '以已确认人物锚点为准'],
    ['服装 / 配饰', profile.wardrobeText || profile.wardrobe || '以生成档案为准'],
    ['发型 / 妆造', profile.hairMakeupText || profile.hair_makeup || '以生成档案为准'],
  ];
  const wrap = (value, maxChars = 18, maxLines = 2) => {
    const source = compact(value, maxChars * maxLines);
    return Array.from({ length: maxLines }, (_, index) => source.slice(index * maxChars, (index + 1) * maxChars)).filter(Boolean);
  };
  const textLines = (value, x, y, maxChars = 18, maxLines = 2, size = 18, color = '#2d3442') => wrap(value, maxChars, maxLines)
    .map((line, index) => `<text x="${x}" y="${y + index * (size + 8)}" font-family="Microsoft YaHei,Arial" font-size="${size}" fill="${color}">${xml(line)}</text>`).join('');
  const infoSvg = infoRows.map(([label, value], index) => {
    const y = 335 + index * 120;
    return `<text x="62" y="${y}" font-family="Microsoft YaHei,Arial" font-size="15" fill="#96887a">${xml(label)}</text>${textLines(value, 62, y + 29, 15, 2, 17)}`;
  }).join('');
  const viewLabels = ['正面', '侧面', '背面'];
  const actionLabels = ['自然站立', '自然行走', '坐下 / 起身', '伸手 / 持物', '商品展示', '人物与道具互动'];
  const expressionLabels = ['平静', '自然微笑', '专注', '疑惑', '惊讶', '放松认可'];
  const viewSvg = viewLabels.map((label, index) => `<text x="${545 + index * 280}" y="1015" text-anchor="middle" font-family="Microsoft YaHei,Arial" font-size="16" fill="#756c63">${label}</text>`).join('');
  const actionSvg = actionLabels.map((label, index) => `<text x="${190 + index * 280}" y="2027" text-anchor="middle" font-family="Microsoft YaHei,Arial" font-size="15" fill="#756c63">${xml(label)}</text>`).join('');
  const expressionSvg = expressionLabels.map((label, index) => `<text x="${1410 + (index % 2) * 215}" y="${538 + Math.floor(index / 2) * 240}" text-anchor="middle" font-family="Microsoft YaHei,Arial" font-size="14" fill="#756c63">${xml(label)}</text>`).join('');
  const keywordRows = ([profile.roleName, profile.appearanceText, profile.wardrobeText].filter(Boolean).join('，') || '身份一致，自然真实，服装一致，动作可复用')
    .split(/[，。；、·/]/).map(value => compact(value, 16)).filter(value => value.length >= 2).slice(0, 6);
  const keywordSvg = keywordRows.map((line, index) => `<rect x="1470" y="${1200 + index * 43}" width="265" height="31" rx="15" fill="#eeeaf1"/><text x="1602" y="${1222 + index * 43}" text-anchor="middle" font-family="Microsoft YaHei,Arial" font-size="14" fill="#625b70">${xml(line)}</text>`).join('');
  const labelSvg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#fbf8f1"/>
      <rect x="32" y="28" width="1736" height="188" rx="28" fill="#fffdf9" stroke="#d8cfc2" stroke-width="2" stroke-dasharray="8 6"/>
      <text x="70" y="85" font-family="Microsoft YaHei,Arial" font-size="18" letter-spacing="4" fill="#9a8a7b">CHARACTER PRODUCTION DOSSIER</text>
      <text x="70" y="145" font-family="Microsoft YaHei,Arial" font-size="48" font-weight="700" fill="#34374a">人物制作档案 · ${safeTitle}</text>
      <text x="70" y="187" font-family="Microsoft YaHei,Arial" font-size="20" fill="#776f68">${safeRole} · 身份一致 · 服装一致 · 动作可复用 · R${revision}</text>
      <rect x="40" y="250" width="330" height="850" rx="22" fill="#fffdf9" stroke="#d8cfc2"/><rect x="390" y="250" width="880" height="850" rx="22" fill="#fffdf9" stroke="#d8cfc2"/><rect x="1290" y="250" width="470" height="850" rx="22" fill="#fffdf9" stroke="#d8cfc2"/>
      <text x="62" y="295" font-family="Microsoft YaHei,Arial" font-size="22" font-weight="700" fill="#656177">基本信息</text><text x="412" y="295" font-family="Microsoft YaHei,Arial" font-size="22" font-weight="700" fill="#656177">形象展示</text><text x="1312" y="295" font-family="Microsoft YaHei,Arial" font-size="22" font-weight="700" fill="#656177">表情记录</text>
      <rect x="40" y="1120" width="400" height="390" rx="22" fill="#fffdf9" stroke="#d8cfc2"/><rect x="460" y="1120" width="350" height="390" rx="22" fill="#fffdf9" stroke="#d8cfc2"/><rect x="830" y="1120" width="600" height="390" rx="22" fill="#fffdf9" stroke="#d8cfc2"/><rect x="1450" y="1120" width="310" height="390" rx="22" fill="#fffdf9" stroke="#d8cfc2"/>
      <text x="60" y="1160" font-family="Microsoft YaHei,Arial" font-size="20" font-weight="700" fill="#656177">穿搭分析</text><text x="480" y="1160" font-family="Microsoft YaHei,Arial" font-size="20" font-weight="700" fill="#656177">配饰与妆造</text><text x="850" y="1160" font-family="Microsoft YaHei,Arial" font-size="20" font-weight="700" fill="#656177">细节展示</text><text x="1470" y="1160" font-family="Microsoft YaHei,Arial" font-size="20" font-weight="700" fill="#656177">风格关键词</text>
      <rect x="40" y="1530" width="1720" height="550" rx="22" fill="#fffdf9" stroke="#d8cfc2"/><text x="60" y="1575" font-family="Microsoft YaHei,Arial" font-size="22" font-weight="700" fill="#656177">动作档案</text><text x="1740" y="1575" text-anchor="end" font-family="Microsoft YaHei,Arial" font-size="15" fill="#8d8278">补充参考版缺少的动作类，用于视频人物一致性与剧情动作参考</text>
      <rect x="40" y="2100" width="560" height="260" rx="22" fill="#fffdf9" stroke="#d8cfc2"/><rect x="620" y="2100" width="700" height="260" rx="22" fill="#fffdf9" stroke="#d8cfc2"/><rect x="1340" y="2100" width="420" height="260" rx="22" fill="#fffdf9" stroke="#d8cfc2"/>
      <text x="65" y="2145" font-family="Microsoft YaHei,Arial" font-size="20" font-weight="700" fill="#656177">角色介绍</text>${textLines([profile.roleName, profile.appearanceText].filter(Boolean).join('。') || '以已确认的人物设定为准', 65, 2185, 24, 5, 16, '#665f59')}
      <text x="645" y="2145" font-family="Microsoft YaHei,Arial" font-size="20" font-weight="700" fill="#656177">使用约束</text>${textLines(profile.negativeText || '保持人物身份、五官、发型、服装和体态一致', 645, 2185, 31, 5, 16, '#665f59')}
      <text x="1550" y="2180" text-anchor="middle" font-family="Microsoft YaHei,Arial" font-size="16" fill="#9a8a7b">角色签名</text><text x="1550" y="2260" text-anchor="middle" font-family="KaiTi,Microsoft YaHei,Arial" font-size="42" fill="#34374a">${safeSignature}</text>
      ${infoSvg}
      ${viewSvg}
      ${actionSvg}
      ${expressionSvg}
      ${keywordSvg}
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
    layout: 'reference_character_dossier_v4',
    width,
    height,
    sections: ['basic_info', 'turnaround', 'expressions', 'wardrobe', 'accessories', 'details', 'keywords', 'actions', 'role_intro', 'usage_constraints'],
    generated_wardrobe_count: wardrobeTileCount,
    generated_accessory_count: accessoryTileCount,
    generated_detail_count: detailTileCount,
    detail_crop_count: 0,
    detail_crop_source: 'none_generated_assets_only',
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
  composeWearableDetails,
  composeWardrobeDetails,
  generateWearableDetails,
  generateWardrobeDetails,
  explicitAccessoryDefinitions,
  composePersonDossier,
  composePersonReferenceBoard,
};
