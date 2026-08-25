function ownedProps(canonical = {}, item = {}, projectedProps = [], index = 0, helpers = {}) {
  const clean = helpers.clean || (value => String(value || '').trim());
  const list = helpers.list || (value => Array.isArray(value) ? value.filter(Boolean) : []);
  const identities = [canonical.id, item.actor_id, item.actor_asset_id, item.id]
    .map(value => clean(value, 120)).filter(Boolean);
  const authored = list(canonical.owned_props).map((prop, propIndex) => ({
    id: clean(prop.id || `${canonical.id}_prop_${propIndex + 1}`, 120), owner_id: canonical.id,
    name: clean(prop.name, 160), description: clean(prop.description || prop.appearance, 600),
    material: clean(prop.material, 160), scale: clean(prop.scale || prop.size, 160), status: 'planned',
  }));
  const generated = list(projectedProps).filter(prop => {
    const owner = clean(prop.owner_id, 120);
    return owner ? identities.includes(owner) : index === 0;
  });
  return [...authored, ...generated].filter((prop, propIndex, source) => {
    const key = clean(prop.id || prop.name, 180);
    return key && source.findIndex(candidate => clean(candidate.id || candidate.name, 180) === key) === propIndex;
  });
}

module.exports = { ownedProps };
