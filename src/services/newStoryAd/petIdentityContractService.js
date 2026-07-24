const { cleanText } = require('./contextBuilder');

/**
 * 读取当前镜头独立的宠物数量；镜头明确写 0 时不得回退到全局数量。
 */
function expectedAnimalsForShot(ctx = {}, shot = {}) {
  const hasShotValue = Object.prototype.hasOwnProperty.call(shot, 'expected_animals')
    || Object.prototype.hasOwnProperty.call(shot, 'animal_count')
    || Object.prototype.hasOwnProperty.call(shot, 'pet_count');
  const explicit = Number(hasShotValue
    ? (shot.expected_animals ?? shot.animal_count ?? shot.pet_count)
    : (ctx.expected_animals || ctx.pet_contract?.expected_animals || 0));
  if (Number.isFinite(explicit) && explicit >= 0) return Math.min(8, Math.round(explicit));
  return ['animal', 'human_pet'].includes(String(ctx.cast_mode || '').toLowerCase()) ? 1 : 0;
}

/**
 * 为需要宠物出镜的关键帧生成独立身份与数量锁。
 */
function keyframePrompt(ctx = {}, shot = {}) {
  const expectedAnimals = expectedAnimalsForShot(ctx, shot);
  if (!expectedAnimals) return '';
  const contract = ctx.pet_contract || {
    expected_animals: expectedAnimals,
    profiles: ctx.pet_profiles || [],
  };
  return `Pet consistency lock: exactly ${expectedAnimals} animal/pet subject(s) must be visible in this shot. Preserve the declared species/breed, coat color and texture, body size, age impression, facial markings, collar/accessories and unique identifying features across every frame. Do not add, remove, replace, recolor, duplicate or merge a pet. Contract: ${cleanText(JSON.stringify(contract), 900)}`;
}

/**
 * 保留用户已经明确填写的宠物字段，避免辅助补齐覆盖硬约束。
 */
function preserveAssistedFields(output = {}, source = {}) {
  const value = (camel, snake, max) => cleanText(source[camel] || source[snake] || '', max);
  const expectedAnimals = value('expectedAnimals', 'expected_animals', 8);
  const petType = value('petType', 'pet_type', 100);
  const petDescription = value('petDescription', 'pet_description', 500);
  if (expectedAnimals) output.expectedAnimals = expectedAnimals;
  if (petType) output.petType = petType;
  if (petDescription) output.petDescription = petDescription;
  return output;
}

/**
 * 归一化辅助补齐接口返回的宠物字段。
 */
function assistedResponseFields(spec = {}) {
  return {
    expectedAnimals: Math.max(0, Math.min(8, Number(spec.expectedAnimals || spec.expected_animals || 0) || 0)) || '',
    petType: cleanText(spec.petType || spec.pet_type || '', 100),
    petDescription: cleanText(spec.petDescription || spec.pet_description || '', 500),
  };
}

module.exports = { expectedAnimalsForShot, keyframePrompt, preserveAssistedFields, assistedResponseFields };
