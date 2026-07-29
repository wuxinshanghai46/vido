const { cleanText } = require('./contextBuilder');

function castReferenceUrls(ctx = {}, shot = {}) {
  const person = ctx.person_asset || {};
  const requested = new Set((Array.isArray(shot.characters) ? shot.characters : [])
    .map(value => cleanText(value?.id || value?.name || value, 120).toLowerCase()).filter(Boolean));
  const sources = [
    ...(Array.isArray(ctx.cast_profiles) ? ctx.cast_profiles : []),
    ...(Array.isArray(person.cast_assets) ? person.cast_assets : []),
  ];
  const matching = requested.size
    ? sources.filter(item => requested.has(cleanText(item.id || item.actor_id || item.name || item.displayName || item.roleName || '', 120).toLowerCase()))
    : sources;
  return [...new Set((matching.length ? matching : sources).map(item => (
    item.referenceImageUrl || item.image_url || item.url || item.view_images?.[0]?.url || ''
  )).filter(Boolean))];
}

function petReferenceUrls(ctx = {}) {
  return [...new Set((Array.isArray(ctx.pet_profiles) ? ctx.pet_profiles : [])
    .flatMap(profile => [profile.image_url, ...(profile.reference_images || [])]).filter(Boolean))];
}

function subjectBoardUrl(ctx = {}) {
  return cleanText(ctx.subject_board_url || ctx.person_asset?.subject_board_url
    || ctx.person_contract?.subject_board_url || ctx.pet_contract?.subject_board_url || '', 1000);
}

function keyframeReferenceUrls(ctx = {}, options = {}) {
  const person = ctx.person_asset || {};
  const personViews = Array.isArray(person.view_images) ? person.view_images : [];
  const castReferences = castReferenceUrls(ctx, options.shot || {});
  const personPrimary = options.includePerson
    ? (castReferences[0] || person.image_url || person.url || personViews[0]?.url || personViews[0]?.image_url || '')
    : '';
  const secondaryPersonReferences = options.includePerson ? castReferences.slice(1) : [];
  const petReferences = petReferenceUrls(ctx);
  const allCastReferences = castReferenceUrls(ctx, {});
  const subjectCount = (options.includePerson ? castReferences.length : 0) + petReferences.length;
  const boardCanRepresentThisShot = options.includePerson || allCastReferences.length === 0;
  const subjectBoard = subjectCount > 1 && boardCanRepresentThisShot ? subjectBoardUrl(ctx) : '';
  const assets = Array.isArray(ctx.assets) ? ctx.assets : [];
  const product = assets.find(asset => /product|subject|商品|产品|主体/i.test(String(asset.type || '') + ' ' + String(asset.name || '')));
  const productReference = options.includeProduct
    ? (product?.url || product?.image_url || ctx.product_contract?.reference_images?.[0] || '')
    : '';
  const continuityReference = options.previousFrame?.image_url || '';
  const personFallback = options.includePerson && !continuityReference
    ? (personViews[1]?.url || personViews[1]?.image_url || personViews[0]?.url || personViews[0]?.image_url || '')
    : '';
  const shotIndex = Number(options.shot?.shot_index ?? options.shot?.index ?? options.shot?.order - 1);
  const actionReference = options.includePerson && Number.isFinite(shotIndex)
    ? (personViews.find(view => cleanText(view?.key || view?.view || '', 60) === `action_shot_${shotIndex}`)?.url
      || personViews.find(view => cleanText(view?.key || view?.view || '', 60) === `action_shot_${shotIndex}`)?.image_url
      || '')
    : '';
  const motionReference = actionReference || continuityReference || personFallback;
  const refs = subjectBoard
    ? [options.sceneReference, subjectBoard, productReference, motionReference]
    : [options.sceneReference, personPrimary, ...petReferences, ...secondaryPersonReferences, productReference, motionReference];
  if (options.layoutReference && refs.filter(Boolean).length < 4) refs.push(options.layoutReference);
  return [...new Set(refs.filter(Boolean))].slice(0, 4);
}

module.exports = { castReferenceUrls, petReferenceUrls, subjectBoardUrl, keyframeReferenceUrls };
