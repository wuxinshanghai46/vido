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
  { key: 'hair_makeup', label: '发型与妆面', pattern: /发型|发髻|束发|盘发|长发|短发|妆面|妆容|淡妆|裸妆|hair|makeup/i, referenceKinds: [['identity', 'face_front'], ['identity', 'face_profile']] },
  { key: 'hair_accessories', label: '发饰', pattern: /发饰|发冠|发簪|玉簪|木簪|步摇|珠花|发带|抹额|钗|冠|hairpin|hair ornament|headpiece/i, referenceKinds: [['identity', 'face_profile'], ['identity', 'face_front']] },
  { key: 'ear_accessories', label: '耳饰', pattern: /耳环|耳饰|耳钉|耳坠|耳夹|earrings?/i, referenceKinds: [['identity', 'face_profile'], ['identity', 'face_front']] },
  { key: 'waist_accessories', label: '腰带 / 腰佩', pattern: /腰带|玉带|腰封|腰佩|玉佩|香囊|革带|belt|waist pendant|sachet/i, referenceKinds: [['body', 'front'], ['body', 'three_quarter']] },
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
  const accessoryText = (Array.isArray(profile.accessories) ? profile.accessories : [])
    .map(item => item?.name || item?.key || item).filter(Boolean).join(' ');
  const contract = profile.wardrobe_contract || profile.wardrobeContract
    || profile.look_profiles?.find?.(look => look?.id === profile.active_look_id)?.wardrobe_contract
    || profile.look_profiles?.[0]?.wardrobe_contract || {};
  const contractAccessories = (contract.accessories?.items || []).flatMap(item => [item?.type, item?.position, item?.material, item?.evidence]).filter(Boolean).join(' ');
  const contractHairMakeup = contract.hair_makeup || contract.hairMakeup || {};
  const hairContractText = typeof contractHairMakeup === 'string'
    ? contractHairMakeup
    : [contractHairMakeup.description, contractHairMakeup.hairstyle, ...(contractHairMakeup.hair_accessories || []), contractHairMakeup.makeup, contractHairMakeup.evidence].filter(Boolean).join(' ');
  const wardrobe = `${String(profile.wardrobeText || profile.wardrobe || '')} ${String(profile.hairMakeupText || profile.hairMakeup || '')} ${accessoryText} ${contractAccessories} ${hairContractText}`
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
    const wardrobeInstructions = {
      outfit_silhouette: '把整套锁定服装拆成外层、内搭、下装或连体主件、腰部配件和鞋履的独立白底陈列，单品之间留出清晰间距，像专业造型清单，不出现人物。',
      neckline_cut: '只展示锁定服装的上装或外层主件，使用白底平铺或隐形人台陈列，完整保留领口、肩线、袖型和门襟，不出现人物。',
      fabric_drape: '只展示锁定服装的面料、刺绣、织纹和滚边样片，形成四格以内的真实材质细节板，不出现人物。',
      hem_and_footwear: '把锁定造型的下装、裙摆或袍摆与鞋履分别独立陈列，物件互不遮挡，不出现人物。',
    };
    const detailInstruction = detailKind === 'wearable_accessory'
      ? `只展示人物设定中真实存在的“${spec.label}”独立物件，使用纯净暖白背景和产品目录式陈列；完整呈现外形、材质、结构和佩戴方向，不出现人物头像、身体、手、衣服，不凭空增加其它首饰。`
      : (wardrobeInstructions[spec.key] || `制作“${spec.label}”独立服装单品证据图，不出现人物。`);
    const contract = profile.wardrobe_contract || profile.wardrobeContract || {};
    const structuredAccessories = (contract.accessories?.items || []).map(item => [item?.type, item?.position, item?.material].filter(Boolean).join('/')).filter(Boolean).join('；');
    const prompt = [
      '商业影视人物造型档案，真实摄影，高清产品目录质感，纯净暖白背景，柔和自然阴影。',
      detailInstruction,
      `人物服装与配饰设定：${String(profile.wardrobeText || profile.wardrobe || '').trim()}`,
      `人物发型与妆造设定：${String(profile.hairMakeupText || profile.hairMakeup || '').trim()}`,
      structuredAccessories ? `结构化配饰清单：${structuredAccessories}` : '',
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
          hair_makeup: String(profile.hairMakeupText || profile.hairMakeup || '').trim(),
          structured_accessories: structuredAccessories,
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
    definitions: Array.isArray(options.definitions)
      ? options.definitions
      : explicitAccessoryDefinitions(options.profile || {}),
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
 * 这里只承担人物自身的可见妆发证据裁切。发饰、耳饰、腰佩、腕饰和鞋履
 * 等可穿戴物由 wearableEvidencePolicy 进入独立白底物件生成，不能再用身体局部裁切冒充清单。
 */
async function composeWearableDetails({
  taskId,
  assetId = 'primary',
  anchor = {},
  atomicAssets = [],
  revision = 1,
  definitions = null,
} = {}, deps = {}) {
  const mediaAdapter = deps.mediaAdapter || mediaAdapterDefault;
  if (typeof mediaAdapter.assetPathFromName !== 'function' || typeof mediaAdapter.publicAssetUrl !== 'function') return [];
  const byKind = kind => atomicAssets.filter(item => item?.kind === kind);
  const body = byKind('body');
  const identity = byKind('identity');
  const byKey = (rows, key, fallback = 0) => rows.find(item => item?.key === key) || rows[fallback] || null;
  let specs = [
    {
      key: 'hair_makeup', label: '发型与妆面',
      asset: byKey(identity, 'face_front', 0) || byKey(identity, 'face_profile', 1) || anchor,
      focus: { x: 0.22, y: 0.02, width: 0.56, height: 0.62 },
    },
    {
      key: 'hair_accessories', label: '发饰',
      asset: byKey(identity, 'face_profile', 1) || byKey(identity, 'face_front', 0) || anchor,
      focus: { x: 0.20, y: 0.00, width: 0.60, height: 0.42 },
    },
    {
      key: 'ear_accessories', label: '耳部穿戴',
      asset: byKey(identity, 'face_profile', 1) || byKey(identity, 'face_front', 0) || anchor,
      focus: { x: 0.34, y: 0.16, width: 0.34, height: 0.38 },
    },
    {
      key: 'waist_accessories', label: '腰带 / 腰佩',
      asset: byKey(body, 'front', 0) || byKey(body, 'three_quarter', 1) || anchor,
      focus: { x: 0.18, y: 0.36, width: 0.64, height: 0.28 },
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
  if (Array.isArray(definitions)) {
    const allowed = new Set(definitions.map(item => String(item?.key || item || '')));
    specs = specs.filter(spec => allowed.has(spec.key));
  }
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
  const tileLabels = (assets, slots) => assets.slice(0, slots.length).map((asset, index) => {
    const slot = slots[index];
    const label = xml(compact(asset.label || asset.key || '造型单品', 12));
    return `<rect x="${slot.left + 5}" y="${slot.top + slot.height - 28}" width="${slot.width - 10}" height="23" rx="11" fill="#fffaf7" fill-opacity="0.92"/><text x="${slot.left + slot.width / 2}" y="${slot.top + slot.height - 11}" text-anchor="middle" font-family="Microsoft YaHei,Arial" font-size="12" fill="#765f75">${label}</text>`;
  }).join('');
  const wardrobeLabelSvg = tileLabels(wardrobeDetails, wardrobeSlots);
  const accessoryLabelSvg = tileLabels(accessoryDetails, accessorySlots);
  const detailAssets = [...wardrobeDetails.filter(item => item.key !== 'outfit_silhouette'), ...accessoryDetails];
  const detailLabelSvg = tileLabels(detailAssets, detailSlots);
  const labelSvg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf9"/><stop offset="0.55" stop-color="#fff9f5"/><stop offset="1" stop-color="#f8f1f4"/></linearGradient><filter id="softShadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#8d6f86" flood-opacity="0.10"/></filter></defs>
      <rect width="100%" height="100%" fill="url(#paper)"/>
      <rect x="14" y="14" width="1772" height="2372" rx="38" fill="none" stroke="#cdbac8" stroke-width="3"/>
      <rect x="25" y="25" width="1750" height="2350" rx="31" fill="none" stroke="#eadfe6" stroke-width="2" stroke-dasharray="5 5"/>
      <g fill="none" stroke="#b89ab1" stroke-width="3" opacity="0.62"><path d="M48 175 C75 120 102 98 145 65 C110 115 105 150 118 205"/><path d="M68 132 C45 112 43 86 63 64 C86 87 86 111 68 132Z"/><path d="M112 98 C99 70 110 47 137 38 C147 69 138 88 112 98Z"/><path d="M1752 175 C1725 120 1698 98 1655 65 C1690 115 1695 150 1682 205"/><path d="M1732 132 C1755 112 1757 86 1737 64 C1714 87 1714 111 1732 132Z"/><path d="M1688 98 C1701 70 1690 47 1663 38 C1653 69 1662 88 1688 98Z"/></g>
      <g fill="#d9c1d1" opacity="0.7"><circle cx="151" cy="55" r="6"/><circle cx="1649" cy="55" r="6"/><circle cx="94" cy="181" r="5"/><circle cx="1706" cy="181" r="5"/></g>
      <rect x="32" y="28" width="1736" height="188" rx="28" fill="#fffdfb" fill-opacity="0.88" stroke="#d8c7d2" stroke-width="2" filter="url(#softShadow)"/>
      <text x="900" y="74" text-anchor="middle" font-family="Microsoft YaHei,Arial" font-size="17" letter-spacing="6" fill="#a18a9b">CHARACTER STYLE ARCHIVE</text>
      <text x="900" y="142" text-anchor="middle" font-family="KaiTi,Microsoft YaHei,Arial" font-size="52" font-weight="700" fill="#6f5b72">人物轻雅档案 · ${safeTitle}</text>
      <text x="900" y="187" text-anchor="middle" font-family="Microsoft YaHei,Arial" font-size="19" fill="#927f8c">${safeRole}　·　身份一致　·　造型锁定　·　动作可复用　·　R${revision}</text>
      <rect x="40" y="250" width="330" height="850" rx="22" fill="#fffdfb" stroke="#d9cbd4" filter="url(#softShadow)"/><rect x="390" y="250" width="880" height="850" rx="22" fill="#fffdfb" stroke="#d9cbd4" filter="url(#softShadow)"/><rect x="1290" y="250" width="470" height="850" rx="22" fill="#fffdfb" stroke="#d9cbd4" filter="url(#softShadow)"/>
      <rect x="55" y="267" width="122" height="38" rx="8" fill="#b997b0"/><text x="116" y="293" text-anchor="middle" font-family="Microsoft YaHei,Arial" font-size="20" font-weight="700" fill="#fffafc">基本信息</text><text x="412" y="295" font-family="Microsoft YaHei,Arial" font-size="22" font-weight="700" fill="#756276">✦ 形象展示</text><text x="1312" y="295" font-family="Microsoft YaHei,Arial" font-size="22" font-weight="700" fill="#756276">✦ 表情记录</text>
      <rect x="40" y="1120" width="400" height="390" rx="22" fill="#fffdfb" stroke="#d9cbd4" filter="url(#softShadow)"/><rect x="460" y="1120" width="350" height="390" rx="22" fill="#fffdfb" stroke="#d9cbd4" filter="url(#softShadow)"/><rect x="830" y="1120" width="600" height="390" rx="22" fill="#fffdfb" stroke="#d9cbd4" filter="url(#softShadow)"/><rect x="1450" y="1120" width="310" height="390" rx="22" fill="#fffdfb" stroke="#d9cbd4" filter="url(#softShadow)"/>
      <text x="60" y="1160" font-family="Microsoft YaHei,Arial" font-size="20" font-weight="700" fill="#756276">✦ 穿搭单品</text><text x="480" y="1160" font-family="Microsoft YaHei,Arial" font-size="20" font-weight="700" fill="#756276">✦ 配饰清单</text><text x="850" y="1160" font-family="Microsoft YaHei,Arial" font-size="20" font-weight="700" fill="#756276">✦ 工艺细节</text><text x="1470" y="1160" font-family="Microsoft YaHei,Arial" font-size="20" font-weight="700" fill="#756276">配色灵感</text>
      <rect x="40" y="1530" width="1720" height="550" rx="22" fill="#fffdfb" stroke="#d9cbd4" filter="url(#softShadow)"/><text x="60" y="1575" font-family="Microsoft YaHei,Arial" font-size="22" font-weight="700" fill="#756276">✦ 动作档案</text><text x="1740" y="1575" text-anchor="end" font-family="Microsoft YaHei,Arial" font-size="15" fill="#9b8795">动作证据独立保留，用于人物一致性与剧情表演参考</text>
      <rect x="40" y="2100" width="560" height="260" rx="22" fill="#fffdfb" stroke="#d9cbd4" filter="url(#softShadow)"/><rect x="620" y="2100" width="700" height="260" rx="22" fill="#fffdfb" stroke="#d9cbd4" filter="url(#softShadow)"/><rect x="1340" y="2100" width="420" height="260" rx="22" fill="#fffdfb" stroke="#d9cbd4" filter="url(#softShadow)"/>
      <text x="65" y="2145" font-family="Microsoft YaHei,Arial" font-size="20" font-weight="700" fill="#656177">角色介绍</text>${textLines([profile.roleName, profile.appearanceText].filter(Boolean).join('。') || '以已确认的人物设定为准', 65, 2185, 24, 5, 16, '#665f59')}
      <text x="645" y="2145" font-family="Microsoft YaHei,Arial" font-size="20" font-weight="700" fill="#656177">使用约束</text>${textLines(profile.negativeText || '保持人物身份、五官、发型、服装和体态一致', 645, 2185, 31, 5, 16, '#665f59')}
      <text x="1550" y="2180" text-anchor="middle" font-family="Microsoft YaHei,Arial" font-size="16" fill="#9a8a7b">角色签名</text><text x="1550" y="2260" text-anchor="middle" font-family="KaiTi,Microsoft YaHei,Arial" font-size="42" fill="#34374a">${safeSignature}</text>
      ${infoSvg}
      ${viewSvg}
      ${actionSvg}
      ${expressionSvg}
      ${keywordSvg}
      ${wardrobeLabelSvg}
      ${accessoryLabelSvg}
      ${detailLabelSvg}
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
    layout: 'elegant_character_archive_v5',
    width,
    height,
    sections: ['basic_info', 'turnaround', 'expressions', 'wardrobe', 'accessories', 'details', 'keywords', 'actions', 'role_intro', 'usage_constraints'],
    generated_wardrobe_count: wardrobeTileCount,
    generated_accessory_count: accessoryTileCount,
    isolated_accessory_count: accessoryDetails.filter(item => item.evidence_mode === 'isolated_catalog_generation').length,
    generated_detail_count: detailTileCount,
    detail_crop_count: accessoryDetails.filter(item => item.evidence_mode === 'local_crop').length,
    detail_crop_source: 'hair_makeup_only; wearable_objects_generated_as_isolated_catalog',
    visual_theme: 'elegant_double_border_botanical_archive',
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
