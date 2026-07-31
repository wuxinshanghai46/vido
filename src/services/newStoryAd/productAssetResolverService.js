/**
 * 商品媒体只允许由明确的商品资产字段产生。
 * 自由文本即使提到商品，也不能被误判成可用于视觉一致性验证的媒体。
 */
function text(value = '', max = 200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

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

module.exports = {
  isProductAsset,
  mediaUrl,
  normalizedAssetType,
  primaryProductAsset,
  productAssets,
};
