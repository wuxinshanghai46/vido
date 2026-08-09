const semantic = require('./productionSemanticLocalizationService');

function clean(value = '', max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function mediaUrl(value = {}) {
  if (typeof value === 'string') return clean(value, 1200);
  return clean(
    value.thumbnail_url
      || value.thumb_url
      || value.image_url
      || value.imageUrl
      || value.video_url
      || value.videoUrl
      || value.url
      || value.file_path
      || '',
    1200,
  );
}

function projectedDossierItems(source = []) {
  const items = Array.isArray(source) ? source.filter(Boolean) : [];
  return items.slice(0, 40).map((item, index) => ({
    ...semantic.dossierItem({
      id: clean(item.id || item.asset_id || item.filename || item.key || `dossier-${index + 1}`, 120),
      key: clean(item.key || item.kind || item.category || item.label || `item_${index + 1}`, 80),
      kind: clean(item.kind || item.category || item.type, 80),
      label: clean(item.label || item.name || item.title || item.key || item.kind || `素材 ${index + 1}`, 120),
      image_url: mediaUrl(item),
    }),
    detail_mode: clean(item.detail_mode, 80),
    evidence_mode: clean(item.evidence_mode, 80),
    evidence_status: clean(item.evidence_status, 40),
    resolution: clean(item.resolution, 40),
    derived_locally: item.derived_locally === true,
    model_call_count: Math.max(0, Number(item.model_call_count || 0) || 0),
  })).filter(item => item.image_url);
}

module.exports = { projectedDossierItems };
