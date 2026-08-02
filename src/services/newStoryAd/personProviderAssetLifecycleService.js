const crypto = require('crypto');
const personIdentity = require('./personIdentityContractService');

function dossierView(dossier = {}, kind = '', key = '') {
  const groups = {
    body: dossier.body_views,
    identity: dossier.identity_views,
    expression: dossier.expressions,
    action: dossier.base_actions,
  };
  return (Array.isArray(groups[kind]) ? groups[kind] : []).find(item => item?.key === key) || null;
}

function buildApprovedRealPersonAsset(production = {}) {
  const dossier = production.dossier || {};
  const profile = production.person_profile || {};
  const sourceId = String(production.source_identity_id || dossier.id || '').replace(/[^a-z0-9_-]/ig, '_').slice(0, 80);
  const actorId = `real_person_${sourceId}`;
  const actorAssetId = `actor_asset_${actorId}`;
  const front = dossierView(dossier, 'body', 'front') || dossierView(dossier, 'identity', 'face_front');
  const side = dossierView(dossier, 'body', 'side') || dossierView(dossier, 'identity', 'face_profile');
  const back = dossierView(dossier, 'body', 'back') || dossierView(dossier, 'identity', 'hair_back');
  const action = dossierView(dossier, 'action', 'neutral_stand') || (dossier.base_actions || [])[0];
  const anchorUrl = production.approved_anchor?.image_url || '';
  const viewImages = [
    { key: 'front', url: front?.image_url || anchorUrl },
    { key: 'side', url: side?.image_url || anchorUrl },
    { key: 'back', url: back?.image_url || anchorUrl },
    { key: 'action', url: action?.image_url || anchorUrl },
  ].filter(view => view.url);
  const qaSource = dossier.qa || {};
  const qa = personIdentity.normalizeQa({
    pass: qaSource.pass === true,
    identity_score: Math.min(Number(qaSource.source_identity_score || 0), Number(qaSource.cross_view_identity_score || 0)),
    age_score: qaSource.adult_age_consistency_score,
    wardrobe_score: qaSource.wardrobe_consistency_score,
    body_score: qaSource.body_proportion_score,
    mismatch_reasons: qaSource.reasons || [],
    used_model: 'authorized_real_person_dossier_qa',
  });
  const baseAsset = {
    id: actorAssetId,
    actor_asset_id: actorAssetId,
    actor_id: actorId,
    name: profile.displayName || profile.name || '授权真人角色',
    source: 'authorized_real_person_dossier',
    reference_kind: 'authorized_real_actor',
    real_person_reference: true,
    source_identity_id: production.source_identity_id || '',
    strict_reference_required: true,
    input_fidelity: 'high',
    image_url: front?.image_url || anchorUrl,
    file_url: front?.image_url || anchorUrl,
    view_images: viewImages,
    extra_image_urls: (dossier.atomic_assets || []).map(item => item?.image_url).filter(Boolean),
    dossier_sheet_url: dossier.sheet?.image_url || '',
    dossier_sheet: dossier.sheet || null,
    subject_board_url: dossier.reference_board?.image_url || '',
    category_atlases: dossier.category_atlases || [],
    identity_views: dossier.identity_views || [],
    expressions: dossier.expressions || [],
    base_actions: dossier.base_actions || [],
    accessory_details: dossier.accessory_details || [],
    wardrobe_detail_items: dossier.wardrobe_details?.items || [],
    dossier_revision: dossier.revision || 1,
    subject_profile: {
      ...profile,
      id: actorId,
      actor_id: actorId,
      actor_asset_id: actorAssetId,
      displayName: profile.displayName || profile.name || '授权真人角色',
      referenceImageUrl: front?.image_url || anchorUrl,
      identityLock: { face: true, outfit: true, body: true },
    },
    dossier: {
      schema_version: dossier.schema_version || 3,
      body_views: dossier.body_views || [],
      identity_views: dossier.identity_views || [],
      expressions: dossier.expressions || [],
      base_actions: dossier.base_actions || [],
      accessory_details: dossier.accessory_details || [],
      wardrobe_details: dossier.wardrobe_details || {},
      motion_profile: dossier.motion_profile || {},
    },
  };
  const contract = personIdentity.buildPersonContract(baseAsset, profile, {
    revision: Math.max(1, Number(dossier.revision || 1) || 1),
  });
  contract.cross_view_qa = qa;
  contract.status = qa.pass ? 'verified' : 'rejected';
  contract.verification = qa.pass
    ? { status: 'verified', verified_at: new Date().toISOString(), used_model: qa.used_model }
    : { status: 'rejected', rejected_at: new Date().toISOString(), reasons: qa.mismatch_reasons };
  contract.reference_fingerprint = personIdentity.contractFingerprint(contract);
  return { ...baseAsset, person_revision: contract.person_revision, person_contract: contract, production_usable_actor: contract.status === 'verified' };
}

function upsertActorAsset({ db, userId, actor = {}, patch = {}, ensureActor }) {
  const foreignOwner = String(actor.user_id || '') && String(actor.user_id) !== String(userId);
  const sourceAssetId = String(actor.actor_asset_id || actor.id || actor.actor_id || 'actor');
  const privateToken = crypto.createHash('sha256').update(`${userId}\n${sourceAssetId}`).digest('hex').slice(0, 18);
  const scopedActor = foreignOwner ? {
    ...actor,
    id: `actor_asset_user_${privateToken}`,
    actor_asset_id: `actor_asset_user_${privateToken}`,
    actor_id: `actor_user_${privateToken}`,
    source_library_asset_id: sourceAssetId,
  } : actor;
  const row = ensureActor(userId, scopedActor, patch);
  const merged = {
    ...row,
    ...scopedActor,
    user_id: userId,
    id: row.id,
    actor_asset_id: scopedActor.actor_asset_id || row.actor_asset_id || row.id,
    actor_id: scopedActor.actor_id || row.actor_id || row.id,
    metadata: { ...(row.metadata || {}), ...(scopedActor.metadata || {}), ...patch },
    updated_at: new Date().toISOString(),
  };
  db.updateAsset(row.id, merged);
  return merged;
}

function persistProviderPersonIds({ context = {}, upsert }) {
  const master = context.person_asset || {};
  const members = Array.isArray(master.cast_assets) && master.cast_assets.length ? master.cast_assets : [master];
  return members.filter(member => member?.actor_asset_id || member?.id).map(member => upsert(member, {
    deyunai_asset_id: member.deyunai_asset_id || '',
    deyunai_asset_status: member.deyunai_asset_status || '',
    deyunai_asset_group_id: member.deyunai_asset_group_id || '',
    deyunai_asset_group_type: member.deyunai_asset_group_type || '',
  }));
}

module.exports = { buildApprovedRealPersonAsset, upsertActorAsset, persistProviderPersonIds };
