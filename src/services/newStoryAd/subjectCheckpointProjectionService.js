const checkpoints = require('./assetGenerationCheckpointService');

const MAX_PROJECTED_MEDIA = 48;

function clean(value = '', max = 1200) {
  return String(value || '').trim().slice(0, max);
}

function mediaUrl(value = {}) {
  if (typeof value === 'string') return clean(value);
  return clean(value?.image_url || value?.imageUrl || value?.url || '');
}

function collectMedia(value, label, result = [], seen = new Set(), depth = 0) {
  if (!value || depth > 5 || result.length >= MAX_PROJECTED_MEDIA) return result;
  if (typeof value === 'string') {
    if (/^(?:https?:\/\/|\/api\/new-story-ad\/assets\/)/i.test(value) && !seen.has(value)) {
      seen.add(value);
      result.push({ key: `${label}_${result.length + 1}`, label, image_url: clean(value) });
    }
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectMedia(item, label, result, seen, depth + 1));
    return result;
  }
  if (typeof value !== 'object') return result;
  const direct = mediaUrl(value);
  if (direct && !seen.has(direct)) {
    seen.add(direct);
    result.push({
      key: clean(value.key || value.id || `${label}_${result.length + 1}`, 120),
      label: clean(value.label || value.name || label, 160),
      image_url: direct,
    });
  }
  Object.entries(value).forEach(([key, child]) => {
    if (!['image_url', 'imageUrl', 'url', 'filePath', 'file_path'].includes(key)) {
      collectMedia(child, label, result, seen, depth + 1);
    }
  });
  return result;
}

function projectCheckpoint(checkpoint = {}, profiles = []) {
  const units = Object.entries(checkpoint.person_dossier_checkpoints || {});
  const bySubject = new Map();
  units.forEach(([key, raw]) => {
    const unit = checkpoints.normalizeCheckpoint(raw, { key });
    if (unit.status !== 'completed' || !unit.result) return;
    const owner = checkpoint.subject_checkpoint_owners?.[key] || {};
    const subjectId = clean(owner.subject_id || profiles[Number(owner.index || 0)]?.id || profiles[0]?.id || 'subject', 120);
    const current = bySubject.get(subjectId) || [];
    collectMedia(unit.result, clean(unit.unit || unit.asset_type || '已完成素材', 160), current);
    bySubject.set(subjectId, current);
  });
  return [...bySubject.entries()].map(([subjectId, media]) => ({
    subject_id: subjectId,
    image_url: media[0]?.image_url || '',
    checkpoint_media: media,
    completed_unit_count: units.filter(([key, raw]) => {
      const owner = checkpoint.subject_checkpoint_owners?.[key] || {};
      const ownerId = clean(owner.subject_id || profiles[Number(owner.index || 0)]?.id || profiles[0]?.id || 'subject', 120);
      return ownerId === subjectId && checkpoints.normalizeCheckpoint(raw, { key }).status === 'completed';
    }).length,
  })).filter(item => item.image_url);
}

function mergePeople(people = [], outputs = {}) {
  const checkpoint = Object.entries(outputs || {})
    .filter(([kind, payload]) => kind.startsWith('subject_asset_checkpoint:') && payload && typeof payload === 'object')
    .map(([, payload]) => payload)
    .sort((left, right) => Date.parse(right.updated_at || '') - Date.parse(left.updated_at || ''))[0];
  if (!checkpoint) return people;
  const profiles = people.map(item => item.profile || {});
  const previews = projectCheckpoint(checkpoint, profiles);
  return people.map((item, index) => {
    if (item.dossier_sheet?.image_url) return item;
    const directPreview = previews.find(row => row.subject_id === item.subject_id || row.subject_id === item.profile?.id);
    const lineageId = clean(item.profile?.lineage_identity_id || item.profile?.source_identity_id, 120);
    const retainedLineagePreview = item.profile?.era_identity === 'ancient' && lineageId
      ? previews.find(row => row.subject_id === lineageId)
      : null;
    const preview = directPreview || retainedLineagePreview
      || (previews.length === 1 && index === 0 ? previews[0] : null);
    if (!preview) return item;
    return {
      ...item,
      image_url: item.image_url || preview.image_url,
      cover_image_url: item.cover_image_url || preview.image_url,
      category_atlases: item.category_atlases?.length ? item.category_atlases : preview.checkpoint_media,
      partial_checkpoint: true,
      checkpoint_status: clean(checkpoint.status, 40),
      completed_checkpoint_units: preview.completed_unit_count,
      status: 'partial',
    };
  });
}

module.exports = { MAX_PROJECTED_MEDIA, collectMedia, mergePeople, projectCheckpoint };
