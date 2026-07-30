const { cleanText } = require('./contextBuilder');
const propReferences = require('./propReferenceService');

function memberIdentityReference(item = {}) {
  const atomic = Array.isArray(item.atomic_assets) ? item.atomic_assets : [];
  const preferred = atomic.find(asset => asset.kind === 'identity' && asset.key === 'face_front')
    || atomic.find(asset => asset.kind === 'body' && asset.key === 'front');
  return preferred?.image_url || preferred?.url
    || item.referenceImageUrl || item.image_url || item.url
    || item.view_images?.[0]?.url || item.view_images?.[0]?.image_url || '';
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
  return [...new Set((matching.length ? matching : sources).map(memberIdentityReference).filter(Boolean))];
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
  const shotIndex = Number(shot.shot_index ?? shot.index ?? shot.order - 1);
  const views = Array.isArray(person.view_images) ? person.view_images : [];
  const atomic = Array.isArray(person.atomic_assets) ? person.atomic_assets : [];
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

function keyframeReferenceUrls(ctx = {}, options = {}) {
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
  const ordered = board
    ? [options.sceneReference, board, product, ...propRefs, motion]
    : [options.sceneReference, ...cast, ...pets, product, ...propRefs, motion];
  if (options.layoutReference) ordered.push(options.layoutReference);
  return [...new Set(ordered.filter(Boolean))].slice(0, 4);
}

module.exports = {
  memberIdentityReference,
  castReferenceUrls,
  petReferenceUrls,
  subjectBoardUrl,
  shotActionReference,
  productReference,
  keyframeReferenceUrls,
};
