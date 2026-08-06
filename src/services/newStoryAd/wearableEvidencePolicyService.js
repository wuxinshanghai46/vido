const compositesDefault = require('./dossierCompositeService');

function text(value) {
  return String(value || '').trim().toLowerCase();
}

function criticalTokens(profile = {}) {
  const raw = [
    ...(Array.isArray(profile.criticalAccessoryKeys) ? profile.criticalAccessoryKeys : []),
    ...(Array.isArray(profile.critical_accessory_keys) ? profile.critical_accessory_keys : []),
    ...(Array.isArray(profile.criticalAccessories) ? profile.criticalAccessories : []),
    ...(Array.isArray(profile.critical_accessories) ? profile.critical_accessories : []),
    ...(Array.isArray(profile.accessories) ? profile.accessories.filter(item => item?.critical === true) : []),
  ];
  return raw.map(item => text(item?.key || item?.type || item?.name || item)).filter(Boolean);
}

function criticalDefinitions(profile = {}, definitions = []) {
  const tokens = criticalTokens(profile);
  return definitions.filter(definition => tokens.some(token => (
    token === text(definition.key)
    || token === text(definition.label)
    || definition.pattern?.test(String(token))
  )));
}

function pendingRow(assetId, revision, definition) {
  return {
    id: `${assetId}_${definition.key}_r${Math.max(1, Number(revision) || 1)}`,
    key: definition.key,
    kind: 'wearable_accessory',
    label: definition.label,
    image_url: '',
    evidence_status: 'pending',
    evidence_mode: 'local_source_unavailable',
    derived_locally: false,
    model_call_count: 0,
  };
}

async function resolve(options = {}, deps = {}) {
  const composites = deps.composites || compositesDefault;
  const definitions = composites.explicitAccessoryDefinitions(options.profile || {});
  if (!definitions.length) return { items: [], trace: { explicit: 0, local: 0, enhanced: 0, pending: 0, model_call_count: 0 } };
  const local = await composites.composeWearableDetails({ ...options, definitions }, deps);
  const critical = criticalDefinitions(options.profile || {}, definitions);
  const enhanced = critical.length
    ? await composites.generateWearableDetails({ ...options, definitions: critical }, deps)
    : [];
  const localByKey = new Map(local.map(item => [item.key, { ...item, evidence_status: 'ready', evidence_mode: 'local_crop' }]));
  const enhancedByKey = new Map(enhanced.map(item => [item.key, { ...item, evidence_status: 'ready', evidence_mode: 'critical_model_enhancement' }]));
  const items = definitions.map(definition => (
    enhancedByKey.get(definition.key)
    || localByKey.get(definition.key)
    || pendingRow(options.assetId || 'primary', options.revision, definition)
  ));
  return {
    items,
    trace: {
      explicit: definitions.length,
      critical: critical.length,
      local: items.filter(item => item.evidence_mode === 'local_crop').length,
      enhanced: items.filter(item => item.evidence_mode === 'critical_model_enhancement').length,
      pending: items.filter(item => item.evidence_status === 'pending').length,
      model_call_count: items.reduce((sum, item) => sum + Number(item.model_call_count || 0), 0),
    },
  };
}

module.exports = { resolve, criticalTokens, criticalDefinitions };
