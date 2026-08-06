/**
 * 商品媒体只允许由明确的商品资产字段产生。
 * 自由文本即使提到商品，也不能被误判成可用于视觉一致性验证的媒体。
 */
function text(value = '', max = 200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const briefAuthority = require('./briefAuthorityService');

function mediaUrl(asset = {}) {
  if (typeof asset === 'string') return text(asset, 1200);
  return text(asset.image_url || asset.imageUrl || asset.url || asset.file_path || '', 1200);
}

function normalizedAssetType(asset = {}) {
  return text(asset.type || asset.asset_type || asset.kind || asset.role || asset.asset_role, 120)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function isProductAsset(asset = {}) {
  if (!asset || !mediaUrl(asset)) return false;
  const type = normalizedAssetType(asset);
  // 类型是权威字段。人物或场景描述即使提到商品，也不能变成商品参考图。
  if (/(?:^|_)(?:person|people|human|actor|character|cast|portrait|face|scene|environment|location|room|space|background)(?:_|$)/i.test(type)) return false;
  if (/(?:^|_)(?:product|goods|package|packaging|packshot|merchandise|sku|product_material|material_sample)(?:_|$)/i.test(type)) return true;
  if (/(?:商品|产品|包装|货品|样品)/.test(type)) return true;

  // 历史上传可能只有通用类型，此时只接受名称中的明确商品语义，不读取描述字段。
  if (!type || /^(?:reference|image|asset|upload|uploaded_image)$/.test(type)) {
    const name = text(asset.name || asset.label, 160);
    return /(?:产品|商品|包装|货品|样品)(?:参考|素材|图片|图|照)|(?:product|goods|package|packshot)\s*(?:reference|asset|image|photo)/i.test(name);
  }
  return false;
}

function assetKeys(asset = {}) {
  return [
    text(asset.id || asset.asset_id, 160),
    mediaUrl(asset),
  ].filter(Boolean);
}

/**
 * 合并当前 canonical product_asset 与历史 context.assets 商品媒体。
 * product_asset 优先；同 ID 或同媒体地址只返回一次。
 */
function productAssets(context = {}) {
  const candidates = [];
  const primary = context.product_asset && typeof context.product_asset === 'object'
    ? context.product_asset
    : null;
  if (primary && mediaUrl(primary)) candidates.push(primary);
  (Array.isArray(context.assets) ? context.assets : [])
    .filter(isProductAsset)
    .forEach(asset => candidates.push(asset));

  const used = new Set();
  return candidates.filter((asset) => {
    const keys = assetKeys(asset);
    if (keys.some(key => used.has(key))) return false;
    keys.forEach(key => used.add(key));
    return true;
  });
}

function primaryProductAsset(context = {}) {
  return productAssets(context)[0] || null;
}

const GENERIC_SUBJECTS = new Set(['当前广告主体', '广告主体', '当前产品', '商品主体', '产品主体']);

function inferredSubject(context = {}) {
  if (briefAuthority.contentMode(context) === 'narrative_story') return '';
  const explicit = text(context.product_subject || context.productSubject, 200);
  if (explicit && !GENERIC_SUBJECTS.has(explicit)) return explicit;
  const sourceFact = text(context.reference_video_analysis?.source_facts?.product_or_service, 200);
  if (sourceFact) return sourceFact;
  const brief = text(context.brief || context.content || '', 1000);
  const patterns = [
    /为([^，。；,.!?！？]{2,40}?)(?:制作|生成|打造)(?:一支|一条|一个)?广告/i,
    /(?:做|制作|生成)(?:一个|一支|一条|一款)?([^，。；,.!?！？]{2,40}?)(?:的)?广告/i,
    /(?:推广|宣传|介绍|展示)(?:我们的|一款|一个)?([^，。；,.!?！？]{2,40})/i,
    /([^，。；,.!?！？]{2,36}(?:原材料|背景墙|墙面|门窗|机器人|设备|板材|材料|产品|商品|服务))/i,
  ];
  for (const pattern of patterns) {
    const candidate = text(brief.match(pattern)?.[1] || '', 120)
      .replace(/^(?:要|需要|想要|我们的|一个|一款)+/, '')
      .replace(/(?:的)?广告$/, '')
      .trim();
    if (candidate.length >= 2 && !GENERIC_SUBJECTS.has(candidate)) return candidate;
  }
  return explicit || '待明确的展示主体';
}

/** 区分独立商品与依附场景呈现的材料、墙面或空间成果。 */
function productPresentation(context = {}) {
  const explicit = context.product_presentation || context.productPresentation || {};
  const product = primaryProductAsset(context);
  const subject = inferredSubject(context);
  if (briefAuthority.contentMode(context) === 'narrative_story') {
    return {
      mode: 'narrative_story',
      label: '纯剧情 / 故事主题',
      subject: '',
      standalone_generation_supported: false,
      scene_linked: false,
      source: 'user_story_brief',
      description: '按用户提供的故事、人物关系、地点和事件推进，不强行添加商品、卖点、购买引导或独立商品资产。',
    };
  }
  const evidence = text([subject, context.brief, explicit.notes, explicit.description].filter(Boolean).join(' '), 1800);
  let mode = text(explicit.mode || explicit.type, 60).toLowerCase().replace(/[\s-]+/g, '_');
  if (mode === 'narrative_story') mode = '';
  if (!mode) {
    if (/(?:原材料|板材|钢板|材质|纹理|表面|墙面|背景墙|涂层|面料|饰面)/i.test(evidence)) mode = 'material_surface';
    else if (/(?:展厅|展示墙|展台|样板间|建筑|住宅|空间|场景|门窗|橱柜|家居)/i.test(evidence)) mode = 'scene_embedded_showcase';
    else if (/(?:机器人|机器|设备|装置|包装|瓶|盒|车辆|家具|家电|商品|实体产品)/i.test(evidence)) mode = 'standalone_product';
    else if (/(?:软件|平台|应用|app|小程序|系统|服务)/i.test(evidence)) mode = 'service_or_digital';
    else mode = 'standalone_product';
  }
  const standalone = mode === 'standalone_product';
  const labels = {
    narrative_story: '纯剧情 / 故事主题',
    standalone_product: '独立商品',
    material_surface: '场景中的材料 / 表面成果',
    scene_embedded_showcase: '场景中的展示成果',
    service_or_digital: '服务 / 数字界面',
  };
  return {
    mode,
    label: labels[mode] || '任务自定义展示主体',
    subject,
    standalone_generation_supported: standalone,
    scene_linked: !standalone,
    source: text(explicit.source || (product ? 'canonical_product_asset' : 'brief_semantics'), 80),
    description: text(explicit.description || (standalone
      ? '以独立商品多视图、细节和使用证明呈现。'
      : '主体依附于场景、展示墙、材料表面或空间成果，应从场景全景进入，再用细节、对比和人物互动证明卖点。'), 500),
  };
}

function sceneMaterialReferenceImages(context = {}, body = {}) {
  const spec = body.scene_spec || body.sceneSpec || context.scene_spec || {};
  const presentation = productPresentation({ ...context, ...body });
  const productReferences = presentation.mode === 'material_surface'
    ? context.product_contract?.reference_images
    : [];
  const candidates = [
    spec.material_reference_images,
    spec.materialReferenceImages,
    body.material_reference_images,
    body.materialReferenceImages,
    context.material_reference_images,
    context.materialReferenceImages,
    productReferences,
  ].flatMap(value => Array.isArray(value) ? value : (value ? [value] : []));
  return [...new Set(candidates.map(item => text(
    typeof item === 'string' ? item : (item?.url || item?.image_url || item?.imageUrl || ''),
    1600,
  )).filter(value => /^https?:\/\/|^\//i.test(value)))].slice(0, 2);
}

module.exports = {
  GENERIC_SUBJECTS,
  inferredSubject,
  isProductAsset,
  mediaUrl,
  normalizedAssetType,
  primaryProductAsset,
  productPresentation,
  productAssets,
  sceneMaterialReferenceImages,
};
