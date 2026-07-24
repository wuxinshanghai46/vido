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

module.exports = { castReferenceUrls, petReferenceUrls };
