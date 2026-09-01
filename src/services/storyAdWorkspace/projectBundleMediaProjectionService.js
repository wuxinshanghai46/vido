'use strict';

function clean(value = '', max = 240) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }

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

function petProfile(source = {}, index = 0) {
  return {
    id: clean(source.id || source.pet_id || source.petId || `pet_${index + 1}`, 80),
    name: clean(source.name || source.displayName, 120),
    type: clean(source.type || source.species, 120),
    breed: clean(source.breed, 160),
    appearance: clean(source.appearance || source.description, 600),
  };
}

function projectedViews(source = {}, fallback = []) {
  const raw = list(source.view_images).length ? list(source.view_images) : list(fallback);
  const labels = { front: '正面', side: '侧面', back: '背面', action: '动作' };
  return raw.slice(0, 16).map((view, index) => {
    const key = clean(view?.key || view?.id || view?.label || ['front', 'side', 'back', 'action'][index] || `view_${index + 1}`, 80);
    return { key, label: clean(view?.label || view?.name || labels[key] || `视图 ${index + 1}`, 100), image_url: mediaUrl(view) };
  }).filter(view => view.image_url);
}

module.exports = { mediaUrl, petProfile, projectedViews };
