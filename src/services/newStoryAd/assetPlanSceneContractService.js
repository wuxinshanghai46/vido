const crypto = require('crypto');
const { cleanText } = require('./contextBuilder');
const generationSpecCompletion = require('./generationSpecCompletionService');
const contentSkill = require('./contentSkillService');

function stableHash(value = '') {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 10);
}

function uniqueSpaceId(space = {}, index = 0, used = new Set()) {
  const name = cleanText(space.name || space.label || `独立空间 ${index + 1}`, 120);
  const description = cleanText(space.description || space.layout || '', 500);
  const requested = cleanText(space.id || space.space_id || space.scene_id || space.space_key || '', 100)
    .replace(/[^a-z0-9_-]+/ig, '_').replace(/^_+|_+$/g, '');
  const base = requested || `space_${stableHash(`${name}|${description}`)}`;
  let candidate = base;
  let collision = 1;
  while (used.has(candidate)) {
    collision += 1;
    candidate = `${base}_${stableHash(`${name}|${description}|${index}|${collision}`).slice(0, 6)}`.slice(0, 100);
  }
  used.add(candidate);
  return { id: candidate, repaired: candidate !== requested };
}

function closeAssetPlanSceneContracts(scenePlan = {}, options = {}) {
  const source = scenePlan && typeof scenePlan === 'object' ? scenePlan : {};
  const contentMode = contentSkill.mode(options.content_mode || options.contentMode || '');
  const rows = Array.isArray(source.spaces) ? source.spaces : [];
  const used = new Set();
  const repairs = [];
  const spaces = rows.map((space, index) => {
    const input = space && typeof space === 'object' ? space : {};
    const identity = uniqueSpaceId(input, index, used);
    const name = cleanText(input.name || input.label || `独立空间 ${index + 1}`, 120);
    const description = cleanText(input.description || input.layout || '', 500);
    const rawSpec = input.scene_spec || input.sceneSpec || {};
    const seededSpec = {
      ...(rawSpec && typeof rawSpec === 'object' ? rawSpec : {}),
      ...(!cleanText(rawSpec?.layoutText || rawSpec?.layout_text || '', 1000) && description
        ? { layoutText: description }
        : {}),
    };
    const closure = generationSpecCompletion.closeSceneSpec(seededSpec, {
      scene_id: identity.id,
      scene_name: name,
      content_mode: contentMode,
    });
    if (identity.repaired || closure.completed_components.length) {
      repairs.push({
        space_id: identity.id,
        id_repaired: identity.repaired,
        completed_components: closure.completed_components,
      });
    }
    return {
      ...input,
      id: identity.id,
      space_id: identity.id,
      scene_id: identity.id,
      name,
      description,
      scene_spec: closure.scene_spec,
    };
  });
  return {
    ...source,
    spaces,
    scene_contract_completion: {
      schema_version: 1,
      source: 'post_model_deterministic_contract_closure',
      content_mode: contentMode,
      repaired_space_count: repairs.length,
      repairs,
    },
  };
}

module.exports = { closeAssetPlanSceneContracts, uniqueSpaceId };
