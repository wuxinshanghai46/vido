const { cleanText } = require('./contextBuilder');

function requestedPropIds(shot = {}) {
  const direct = [
    ...(Array.isArray(shot.prop_ids) ? shot.prop_ids : []),
    ...(Array.isArray(shot.props) ? shot.props : []),
  ];
  return new Set(direct.map(value => cleanText(
    typeof value === 'object' ? (value.id || value.prop_id || value.name) : value,
    120,
  ).toLowerCase()).filter(Boolean));
}

function selectPropReference(propAssets = [], shot = {}) {
  const ids = requestedPropIds(shot);
  const text = [shot.visual, shot.action, shot.prop_contact, shot.title].filter(Boolean).join(' ').toLowerCase();
  const matching = (Array.isArray(propAssets) ? propAssets : []).filter(prop => (
    ids.has(cleanText(prop.id || prop.prop_id || '', 120).toLowerCase())
    || ids.has(cleanText(prop.name || '', 120).toLowerCase())
    || (prop.name && text.includes(String(prop.name).toLowerCase()))
  ));
  const candidates = matching.length ? matching : [];
  return candidates.map(prop => {
    const index = Number(shot.shot_index ?? shot.index ?? shot.order - 1);
    const state = Array.isArray(prop.shot_timeline)
      ? prop.shot_timeline.find(row => Number(row.shot_index) === index)?.state
      : '';
    const stateView = Array.isArray(prop.state_views)
      ? prop.state_views.find(view => cleanText(view.key || '', 100) === state)
      : null;
    return stateView?.image_url || stateView?.url || prop.view_images?.[0]?.image_url
      || prop.view_images?.[0]?.url || prop.image_url || '';
  }).filter(Boolean);
}

module.exports = {
  requestedPropIds,
  selectPropReference,
};
