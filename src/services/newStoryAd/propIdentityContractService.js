const crypto = require('crypto');
const { cleanText } = require('./contextBuilder');

const PROP_TYPES = new Set(['advertised_product', 'wearable_accessory', 'story_prop', 'fixed_scene_object']);

function normalizeStates(values = []) {
  const list = Array.isArray(values) ? values : [];
  return [...new Set(list.map(value => cleanText(
    typeof value === 'object' ? (value.id || value.name || value.state) : value,
    100,
  )).filter(Boolean))].slice(0, 8);
}

function inferType(input = {}) {
  const declared = cleanText(input.type || input.kind || input.prop_type || input.propType || '', 80);
  if (PROP_TYPES.has(declared)) return declared;
  const text = [
    input.name,
    input.description,
    input.usage,
    input.owner,
  ].filter(Boolean).join(' ');
  if (/商品|产品|advertised|product/i.test(text)) return 'advertised_product';
  if (/佩戴|穿戴|眼镜|手表|腕表|包|accessor|wearable/i.test(text)) return 'wearable_accessory';
  if (/固定|墙|门|桌|灯具|fixed|fixture/i.test(text)) return 'fixed_scene_object';
  return 'story_prop';
}

function normalizeProp(input = {}, index = 0) {
  const name = cleanText(input.name || input.label || input.title || `道具${index + 1}`, 160);
  const id = cleanText(input.id || input.prop_id || input.propId || `prop_${index + 1}`, 120)
    .replace(/[^a-z0-9._-]/ig, '_');
  return {
    id,
    name,
    type: inferType(input),
    description: cleanText(input.description || input.appearance || input.visual || '', 800),
    material: cleanText(input.material || input.materials || '', 300),
    scale: cleanText(input.scale || input.size || input.dimensions || '', 200),
    quantity: Math.max(1, Math.min(99, Number(input.quantity || input.count || 1) || 1)),
    owner_id: cleanText(input.owner_id || input.ownerId || input.owner || '', 120),
    scene_id: cleanText(input.scene_id || input.sceneId || '', 120),
    hand_contact: cleanText(input.hand_contact || input.handContact || input.prop_contact || '', 400),
    placement: cleanText(input.placement || input.scene_placement || input.scenePlacement || '', 400),
    reference_image_url: cleanText(input.reference_image_url || input.referenceImageUrl || input.source_image_url || input.sourceImageUrl || '', 1000),
    states: normalizeStates(input.states || input.state_variants || input.stateVariants),
    revision: Math.max(1, Number(input.revision || 1) || 1),
  };
}

function buildContract(input = {}, index = 0) {
  const prop = normalizeProp(input, index);
  const contract = {
    schema_version: 1,
    contract_type: 'prop_identity',
    prop_id: prop.id,
    revision: prop.revision,
    classification: prop.type,
    identity: {
      name: prop.name,
      description: prop.description,
      material: prop.material,
      scale: prop.scale,
      quantity: prop.quantity,
    },
    ownership: {
      owner_id: prop.owner_id,
      scene_id: prop.scene_id,
    },
    interaction: {
      hand_contact: prop.hand_contact,
      placement: prop.placement,
    },
    states: prop.states,
    reference_image_url: prop.reference_image_url,
  };
  contract.fingerprint = crypto.createHash('sha256').update(JSON.stringify(contract)).digest('hex');
  return contract;
}

module.exports = {
  PROP_TYPES,
  normalizeStates,
  inferType,
  normalizeProp,
  buildContract,
};
