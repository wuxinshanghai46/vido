'use strict';

const crypto = require('crypto');

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const canonical = value => clean(value).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 96);

function semanticKey(kind, entity = {}) {
  const rawExplicit = clean(entity.semantic_key || entity.semanticKey || entity.stable_key || entity.stableKey);
  if (rawExplicit.startsWith(`${kind}:`)) return rawExplicit;
  const explicit = canonical(rawExplicit);
  if (explicit) return `${kind}:${explicit}`;
  const components = kind === 'scene'
    ? [entity.scene_name || entity.name || entity.title, entity.space_type || entity.type, entity.location || entity.setting]
    : kind === 'shot'
      ? [entity.beat_id || entity.beatId, entity.scene_id || entity.sceneId, entity.purpose || entity.title, entity.shot_scope || entity.shotScope]
      : [entity.role || entity.subject_type || entity.type, entity.name || entity.display_name, entity.product_name || entity.species];
  const key = components.map(canonical).filter(Boolean).join('|');
  return `${kind}:${key || 'unnamed'}`;
}

function permanentId(workId, kind, key) {
  const digest = crypto.createHash('sha256').update(`${clean(workId)}\n${clean(kind)}\n${clean(key)}`).digest('hex');
  return `${kind}_${digest.slice(0, 24)}`;
}

function existingPermanentId(entity = {}, kind = '') {
  return clean(entity.permanent_id || entity.permanentId || entity[`${kind}_permanent_id`]);
}

function reconcile(workId, kind, incoming = [], existing = []) {
  const previousByKey = new Map((Array.isArray(existing) ? existing : []).map(entity => [semanticKey(kind, entity), entity]));
  const seen = new Map();
  const items = (Array.isArray(incoming) ? incoming : []).map((entity, index) => {
    const key = semanticKey(kind, entity);
    const duplicateIndex = seen.get(key) || 0;
    seen.set(key, duplicateIndex + 1);
    const identityKey = duplicateIndex ? `${key}#${duplicateIndex + 1}` : key;
    const previous = previousByKey.get(key) || {};
    const id = existingPermanentId(previous, kind)
      || existingPermanentId(entity, kind)
      || permanentId(workId, kind, identityKey);
    const contentFingerprint = crypto.createHash('sha256').update(JSON.stringify(entity || {})).digest('hex');
    const previousFingerprint = clean(previous.identity_content_fingerprint);
    return {
      ...entity,
      permanent_id: id,
      semantic_key: key,
      identity_revision: Math.max(1, Number(previous.identity_revision || 0) + (previousFingerprint && previousFingerprint !== contentFingerprint ? 1 : (previous.identity_revision ? 0 : 1))),
      identity_content_fingerprint: contentFingerprint,
      source_position: index,
    };
  });
  const activeIds = new Set(items.map(item => item.permanent_id));
  const archived = (Array.isArray(existing) ? existing : []).filter(item => {
    const id = existingPermanentId(item, kind);
    return id && !activeIds.has(id);
  }).map(item => ({ ...item, identity_status: 'archived' }));
  return { items, archived, duplicate_semantic_keys: [...seen.entries()].filter(([, count]) => count > 1).map(([key, count]) => ({ key, count })) };
}

module.exports = { canonical, permanentId, reconcile, semanticKey };
