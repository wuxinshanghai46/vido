const { cleanText } = require('./contextBuilder');
const propReferences = require('./propReferenceService');

function selectedLookAsset(item = {}, shot = {}) {
  const sceneId = cleanText(shot.scene_id || shot.scene_asset_id || '', 120);
  const lookId = cleanText(shot.look_id || shot.lookId || '', 100);
  const rows = Array.isArray(item.look_assets) ? item.look_assets : [];
  if (lookId) return rows.find(look => String(look.id || '') === lookId) || null;
  return rows.find(look => sceneId && Array.isArray(look.scene_ids) && look.scene_ids.includes(sceneId))
    || (rows.length === 1 ? rows[0] : null);
}

function memberIdentityReference(item = {}, shot = {}) {
  const lookAssets = Array.isArray(item.look_assets) ? item.look_assets : [];
  const selectedLook = selectedLookAsset(item, shot);
  if (lookAssets.length > 1 && !selectedLook) return '';
  const selected = selectedLook || item;
  const nativeFace = selected.native_masters?.face || selected.nativeMasters?.face;
  const nativeBody = selected.native_masters?.body || selected.nativeMasters?.body;
  const atomic = Array.isArray(selected.atomic_assets) ? selected.atomic_assets : [];
  const preferred = atomic.find(asset => asset.kind === 'identity' && asset.key === 'face_front')
    || atomic.find(asset => asset.kind === 'body' && asset.key === 'front');
  return nativeFace?.image_url || nativeFace?.url || nativeBody?.image_url || nativeBody?.url
    || preferred?.image_url || preferred?.url
    || selected.referenceImageUrl || selected.image_url || selected.url
    || selected.view_images?.[0]?.url || selected.view_images?.[0]?.image_url || '';
}

function castReferenceUrls(ctx = {}, shot = {}) {
  const person = ctx.person_asset || {};
  const requested = new Set((Array.isArray(shot.characters) ? shot.characters : [])
    .map(value => cleanText(value?.id || value?.name || value, 120).toLowerCase()).filter(Boolean));
  const sources = [
    ...(Array.isArray(ctx.cast_profiles) ? ctx.cast_profiles : []),
    ...(Array.isArray(person.cast_assets) ? person.cast_assets : []),
  ];
  if (!sources.length && person) sources.push(person);
  const matching = requested.size
    ? sources.filter(item => requested.has(cleanText(
      item.id || item.actor_id || item.name || item.displayName || item.roleName || '',
      120,
    ).toLowerCase()))
    : sources;
  return [...new Set((matching.length ? matching : sources).map(item => memberIdentityReference(item, shot)).filter(Boolean))];
}

function petReferenceUrls(ctx = {}) {
  return [...new Set((Array.isArray(ctx.pet_profiles) ? ctx.pet_profiles : [])
    .flatMap(profile => [profile.image_url, ...(profile.reference_images || [])]).filter(Boolean))];
}

function subjectBoardUrl(ctx = {}) {
  return cleanText(ctx.subject_board_url || ctx.person_asset?.subject_board_url
    || ctx.person_contract?.subject_board_url || ctx.pet_contract?.subject_board_url || '', 1000);
}

function shotActionReference(person = {}, shot = {}) {
  const lookAssets = Array.isArray(person.look_assets) ? person.look_assets : [];
  const selectedLook = selectedLookAsset(person, shot);
  if (lookAssets.length > 1 && !selectedLook) return '';
  const selected = selectedLook || person;
  const shotIndex = Number(shot.shot_index ?? shot.index ?? shot.order - 1);
  const views = Array.isArray(selected.view_images) ? selected.view_images : [];
  const atomic = Array.isArray(selected.atomic_assets) ? selected.atomic_assets : [];
  if (Number.isFinite(shotIndex)) {
    const specific = views.find(view => cleanText(view?.key || view?.view || '', 60) === `action_shot_${shotIndex}`);
    if (specific) return specific.url || specific.image_url || '';
  }
  const actionText = [shot.action, shot.action_start, shot.action_end, shot.prop_contact].filter(Boolean).join(' ');
  const wanted = /走|walk/i.test(actionText) ? 'natural_walk'
    : (/展示|present|拿|hold/i.test(actionText) ? 'present_product' : 'neutral_stand');
  const base = atomic.find(asset => asset.kind === 'action' && asset.key === wanted);
  return base?.image_url || base?.url || '';
}

function productReference(ctx = {}) {
  const assets = Array.isArray(ctx.assets) ? ctx.assets : [];
  const product = assets.find(asset => /product|subject|商品|产品|主体/i.test(
    `${String(asset.type || '')} ${String(asset.name || '')}`,
  ));
  return product?.url || product?.image_url || ctx.product_contract?.reference_images?.[0] || '';
}

function keyframeReferenceCandidates(ctx = {}, options = {}) {
  const person = ctx.person_asset || {};
  const cast = options.includePerson ? castReferenceUrls(ctx, options.shot || {}) : [];
  const pets = petReferenceUrls(ctx);
  const allCast = castReferenceUrls(ctx, {});
  const subjectCount = cast.length + pets.length;
  const board = subjectCount > 1 && (options.includePerson || allCast.length === 0) ? subjectBoardUrl(ctx) : '';
  const propRefs = propReferences.selectPropReference(ctx.prop_assets || [], options.shot || {});
  const continuity = options.previousFrame?.image_url || '';
  const motion = options.includePerson ? (shotActionReference(person, options.shot || {}) || continuity) : continuity;
  const product = options.includeProduct ? productReference(ctx) : '';
  const rows = [];
  const push = (url, role, priority, required = false) => { if (url) rows.push({ url, role, priority, required }); };
  push(options.directorReference, 'director_composition', 110, true);
  if (!options.directorReference) push(options.sceneReference, 'scene_identity', 100, true);
  if (board) push(board, 'cast_identity_board', 98, true);
  else cast.forEach((url, index) => push(url, `person_identity_${index + 1}`, 96 - index, true));
  if (!board) pets.forEach((url, index) => push(url, `pet_identity_${index + 1}`, 92 - index, true));
  push(product, 'product_identity', 94, options.includeProduct === true);
  propRefs.forEach((url, index) => push(url, `prop_${index + 1}`, 86 - index));
  push(motion, motion === continuity ? 'previous_accepted_frame' : 'action_pose', 90, Boolean(options.includePerson));
  push(options.sceneReference, 'scene_identity', options.directorReference ? 84 : 100);
  push(options.layoutReference, 'scene_layout', 72);
  const unique = new Map();
  rows.sort((a, b) => Number(b.required) - Number(a.required) || b.priority - a.priority).forEach(row => {
    if (!unique.has(row.url)) unique.set(row.url, row);
  });
  return [...unique.values()];
}

function keyframeReferenceUrls(ctx = {}, options = {}) {
  const limit = Math.max(1, Math.min(12, Number(options.providerLimit || options.limit || 4) || 4));
  return keyframeReferenceCandidates(ctx, options).slice(0, limit).map(item => item.url);
}

module.exports = {
  memberIdentityReference,
  selectedLookAsset,
  castReferenceUrls,
  petReferenceUrls,
  subjectBoardUrl,
  shotActionReference,
  productReference,
  keyframeReferenceCandidates,
  keyframeReferenceUrls,
};
