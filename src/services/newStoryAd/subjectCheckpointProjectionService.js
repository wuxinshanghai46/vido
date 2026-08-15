const checkpoints = require('./assetGenerationCheckpointService');
const reviewStates = require('./visualAssetBillingReviewStateService');

const MAX_PROJECTED_MEDIA = 48;

function clean(value = '', max = 1200) {
  return String(value || '').trim().slice(0, max);
}

function mediaUrl(value = {}) {
  if (typeof value === 'string') return clean(value);
  return clean(value?.image_url || value?.imageUrl || value?.url || '');
}

function publicUnitLabel(unit = '', key = '') {
  const value = `${unit} ${key}`.toLowerCase();
  if (value.includes('waist_accessories')) return '腰部配饰';
  if (value.includes('hair_accessories')) return '发饰';
  if (value.includes('natural_walk')) return '自然行走';
  return clean(unit || key || '人物资产单元', 80).replaceAll('_', ' / ');
}

function publicFailureReason(code = '', fallback = '') {
  if (code === 'PROVIDER_CONTENT_AUDIT') return '内容安全审核未通过，需人工核对后处理';
  if (code === 'IMAGE_ATTEMPTS_EXHAUSTED') return clean(fallback || '多次生成仍未达到质量标准', 120);
  return '该生成单元未完成，需人工核对后处理';
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
      kind: clean(value.kind || value.asset_type || value.category || label, 80),
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

function canonicalPersonAtlas(media = []) {
  const score = row => {
    const key = clean(row.key, 120).toLowerCase();
    const semantic = `${key} ${clean(row.kind, 80)} ${clean(row.label, 160)} ${clean(row.image_url, 1200)}`.toLowerCase();
    if (key === 'body_1' || /person[_-]body[_-]atlas/.test(semantic)) return 100;
    if (/body/.test(semantic) && /atlas/.test(semantic)) return 90;
    if (/(?:person|dossier)/.test(semantic) && /atlas/.test(semantic)) return 80;
    if (/(?:identity|face.?front|portrait)/.test(semantic)) return 40;
    return 0;
  };
  return media.map((row, index) => ({ row, index, score: score(row) }))
    .filter(item => item.score > 0).sort((left, right) => right.score - left.score || left.index - right.index)[0]?.row || null;
}

function projectCheckpoint(checkpoint = {}, profiles = []) {
  const units = Object.entries(checkpoint.person_dossier_checkpoints || {});
  const bySubject = new Map();
  units.forEach(([key, raw]) => {
    const unit = checkpoints.normalizeCheckpoint(raw, { key });
    if (checkpoints.isObsolete(unit)) return;
    const owner = checkpoint.subject_checkpoint_owners?.[key] || {};
    const subjectId = clean(owner.subject_id || profiles[Number(owner.index || 0)]?.id || profiles[0]?.id || 'subject', 120);
    const current = bySubject.get(subjectId) || { media: [], completed: 0, failed: [] };
    if (unit.status === 'completed' && unit.result) {
      collectMedia(unit.result, clean(unit.unit || unit.asset_type || '已完成素材', 160), current.media);
      current.completed += 1;
    } else if (!['pending', 'cancelled'].includes(unit.status)) {
      const errorCode = clean(unit.error?.code || unit.status || 'GENERATION_INCOMPLETE', 120);
      current.failed.push({
        key: clean(key, 120),
        unit: clean(unit.unit || unit.asset_type || key, 160),
        label: publicUnitLabel(unit.unit, key),
        reason: publicFailureReason(errorCode, unit.error?.message),
        error_code: errorCode,
        billing_state: clean(unit.billing_state, 40),
        provider_submission_state: clean(unit.provider_submission_state, 60),
        billing_review_state: reviewStates.reviewState(unit),
        review_revision: reviewStates.reviewRevision(unit),
        retry_blocked: checkpoints.hasAmbiguousSubmission(unit) && !checkpoints.hasRetryAuthorization(unit),
      });
    }
    bySubject.set(subjectId, current);
  });
  return [...bySubject.entries()].map(([subjectId, state]) => ({
    subject_id: subjectId,
    image_url: canonicalPersonAtlas(state.media)?.image_url || state.media[0]?.image_url || '',
    checkpoint_media: state.media,
    completed_unit_count: state.completed,
    total_unit_count: state.completed + state.failed.length,
    failed_units: state.failed,
  }));
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
    if (item.dossier_sheet?.image_url && item.partial_checkpoint !== true) return item;
    const directPreview = previews.find(row => row.subject_id === item.subject_id || row.subject_id === item.profile?.id);
    const lineageId = clean(item.profile?.lineage_identity_id || item.profile?.source_identity_id, 120);
    const retainedLineagePreview = item.profile?.era_identity === 'ancient' && lineageId
      ? previews.find(row => row.subject_id === lineageId)
      : null;
    const preview = directPreview || retainedLineagePreview
      || (previews.length === 1 && index === 0 ? previews[0] : null);
    if (!preview) return item;
    const failedUnits = preview.failed_units.map(unit => ({ ...unit }));
    const retryBlocked = preview.failed_units.some(unit => unit.retry_blocked);
    return {
      ...item,
      image_url: item.image_url || preview.image_url,
      cover_image_url: item.cover_image_url || preview.image_url,
      view_images: item.view_images?.length ? item.view_images : preview.checkpoint_media,
      category_atlases: item.category_atlases?.length ? item.category_atlases : preview.checkpoint_media,
      partial_checkpoint: true,
      checkpoint_status: clean(checkpoint.status, 40),
      completed_checkpoint_units: preview.completed_unit_count,
      total_checkpoint_units: preview.total_unit_count,
      failed_checkpoint_units: failedUnits,
      checkpoint_recovery_summary: {
        completed_units: preview.completed_unit_count,
        total_units: preview.total_unit_count,
        missing_units: preview.failed_units,
        retry_blocked: retryBlocked,
        requires_billing_review: retryBlocked,
        billing_review_state: preview.failed_units.some(unit => unit.billing_review_state === 'pending')
          ? 'pending'
          : (preview.failed_units.some(unit => unit.billing_review_state === 'unverifiable') ? 'unverifiable'
            : (preview.failed_units.some(unit => unit.billing_review_state === 'not_billed') ? 'not_billed' : 'completed')),
      },
      billing_review_required: retryBlocked,
      status: 'partial',
    };
  });
}

module.exports = { MAX_PROJECTED_MEDIA, canonicalPersonAtlas, collectMedia, mergePeople, projectCheckpoint, publicFailureReason, publicUnitLabel };
