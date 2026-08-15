'use strict';

function rows(value) { return Array.isArray(value) ? value : []; }
function text(value = '') { return String(value ?? '').trim(); }
function same(left, right) { return JSON.stringify(left ?? null) === JSON.stringify(right ?? null); }

const DERIVED_SOURCE = 'generation_preflight_ai_completion';
const DERIVED_PROFILE_FIELDS = new Set(['wardrobe_contract', 'wardrobe_completion', 'knowledge_refs', 'style_family', 'richness', 'source', 'name_source', 'world_revision']);
const DERIVED_LOOK_FIELDS = new Set(['wardrobe_contract', 'wardrobe_completion', 'knowledge_refs', 'style_family', 'richness', 'source', 'world_revision']);

function restoreUserLook(look = {}) {
  const completion = look.wardrobe_completion;
  if (!completion || completion.source !== DERIVED_SOURCE || Number(completion.schema_version || 0) < 4) return { value: look, proven: false };
  if (text(completion.resolved_text) !== text(look.wardrobeText)
    || !same(completion.wardrobe_contract, look.wardrobe_contract)
    || !same(rows(completion.wardrobe_contract?.knowledge_doc_ids), rows(look.knowledge_refs))
    || text(completion.wardrobe_contract?.style_family) !== text(look.style_family)) return { value: look, proven: false };
  const value = { ...look, wardrobeText: text(completion.user_text) };
  delete value.style_family; delete value.wardrobe_contract; delete value.knowledge_refs; delete value.wardrobe_completion;
  return { value, proven: true };
}

function restoreUserProfile(profile = {}) {
  let proven = false;
  const looks = rows(profile.look_profiles).map((look) => {
    const restored = restoreUserLook(look); proven ||= restored.proven; return restored.value;
  });
  const primary = looks[0] || {};
  const value = { ...profile, look_profiles: looks };
  const completion = profile.wardrobe_completion;
  if (completion?.source === DERIVED_SOURCE && Number(completion.schema_version || 0) >= 4
    && text(completion.resolved_text) === text(profile.wardrobeText)
    && same(completion.wardrobe_contract, profile.wardrobe_contract)) {
    value.wardrobeText = text(completion.user_text); proven = true;
    delete value.wardrobe_contract; delete value.wardrobe_completion; delete value.knowledge_refs; delete value.style_family;
  } else if (proven && primary.wardrobeText) value.wardrobeText = primary.wardrobeText;
  return { value, proven };
}

function derivedMatches(current = {}, completed = {}) {
  if (!completed || typeof completed !== 'object') return false;
  const fields = ['wardrobeText', ...DERIVED_PROFILE_FIELDS];
  if (fields.some(field => field in current && !same(current[field], completed[field]))) return false;
  const currentLooks = rows(current.look_profiles), completedLooks = rows(completed.look_profiles);
  if (currentLooks.length !== completedLooks.length) return false;
  return currentLooks.every((look, index) => ['wardrobeText', ...DERIVED_LOOK_FIELDS]
    .every(field => !(field in look) || same(look[field], completedLooks[index]?.[field])));
}

function prove({ active = [], sealed = [], checkpoint = [], current = [], completion = [], contentRevision = 0, sealedRevision = 0,
  activeSnapshotId = '', sealedSnapshotId = '', subjectAssets } = {}) {
  const sets = [active, sealed, checkpoint, current].map(rows);
  const ids = set => set.map(row => text(row.id || row.cast_id || row.castId));
  const fail = (reason, index = -1) => ({ compatible: false, reason, index });
  if (!contentRevision || Number(sealedRevision) !== Number(contentRevision)) return fail('sealed_revision_mismatch');
  if (!activeSnapshotId || !sealedSnapshotId || text(activeSnapshotId) !== text(sealedSnapshotId)) return fail('sealed_snapshot_identity_mismatch');
  if (!sets[0].length || sets.some(set => set.length !== sets[0].length)) return fail('profile_count_mismatch');
  if (rows(completion).length !== sets[0].length) return fail('completion_provenance_missing');
  if (sets.slice(1).some(set => !same(ids(set), ids(sets[0])))) return fail('profile_identity_or_order_changed');
  if (!same(ids(completion), ids(sets[0]))) return fail('completion_identity_or_order_changed');
  for (let index = 0; index < active.length; index += 1) {
    if (text(active[index].lineage_identity_id) !== text(sealed[index].lineage_identity_id)
      || text(sealed[index].lineage_identity_id) !== text(current[index].lineage_identity_id)
      || text(current[index].lineage_identity_id) !== text(completion[index].lineage_identity_id)) return fail('lineage_identity_changed', index);
    const unexpectedProfileFields = Object.keys(current[index]).filter(key => !(key in sealed[index]) && !DERIVED_PROFILE_FIELDS.has(key));
    const sealedLooks = rows(sealed[index].look_profiles), currentLooks = rows(current[index].look_profiles);
    const unexpectedLookField = currentLooks.some((look, lookIndex) => Object.keys(look)
      .some(key => !(key in (sealedLooks[lookIndex] || {})) && !DERIVED_LOOK_FIELDS.has(key)));
    if (unexpectedProfileFields.length || unexpectedLookField) return fail('unproven_derived_field', index);
    if (!derivedMatches(current[index], completion[index])) return fail('completion_current_mismatch', index);
    const restored = restoreUserProfile(current[index]);
    if (!restored.proven) return fail('derived_enrichment_provenance_missing', index);
    DERIVED_PROFILE_FIELDS.forEach((field) => { if (!(field in sealed[index])) delete restored.value[field]; });
    rows(restored.value.look_profiles).forEach((look, lookIndex) => DERIVED_LOOK_FIELDS.forEach((field) => {
      if (!(field in (sealedLooks[lookIndex] || {}))) delete look[field];
    }));
    if (!subjectAssets.personProfileResumeCompatible(checkpoint[index], current[index])) return fail('checkpoint_current_changed', index);
    if (!subjectAssets.personProfileResumeCompatible(active[index], sealed[index])) return fail('active_sealed_changed', index);
    if (!subjectAssets.personProfileResumeCompatible(sealed[index], restored.value)) return fail('sealed_current_user_semantics_changed', index);
  }
  return { compatible: true, reason: 'proven_platform_derived_enrichment', contract_version: 1 };
}

module.exports = { DERIVED_SOURCE, prove, restoreUserProfile };
