'use strict';

function clean(value, max = 4000) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function rows(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }

function normalizeOwnedProps(profile = {}) {
  return rows(profile.owned_props || profile.ownedProps || profile.props).slice(0, 12).map((prop, index) => ({
    id: clean(prop.id || `owned_prop_${index + 1}`, 120),
    name: clean(prop.name || `随身道具${index + 1}`, 120),
    description: clean(prop.description || prop.appearance || '', 500),
    material: clean(prop.material || '', 120),
    scale: clean(prop.scale || prop.size || '', 100),
    type: clean(prop.type || prop.kind || 'handheld', 60),
    quantity: Math.max(1, Number(prop.quantity || 1) || 1),
  }));
}

function propsText(profile = {}) {
  const props = normalizeOwnedProps(profile);
  if (!props.length) return '无';
  return props.map(prop => [prop.name, prop.description, prop.material, prop.scale]
    .filter(Boolean).join('，')).join('；');
}

function performanceOnly(value = '') {
  const source = clean(value, 1600);
  if (!source) return '';
  const clauses = source.split(/[。；;]\s*/u).map(item => item.trim()).filter(Boolean);
  const action = clauses.filter(item => /动作|表演|眼神|目光|神态|表情|触摸|拿取|握持|走|驻足|坐|站|转身|回头|展示|介绍|说话|对白|开口|自然|克制|专注|欣赏/u.test(item)
    && !/固定穿|上衣|下装|连衣裙|晚礼服|西裤|鞋|发型|发色|淡妆|底妆|耳饰|项链|手链|戒指/u.test(item));
  return clean(action.join('；'), 600);
}

function fallbackPrompt(profile = {}) {
  const name = clean(profile.displayName || profile.name || '未命名人物', 120);
  const role = clean(profile.roleName || profile.role || '剧情人物', 120);
  const age = clean(profile.age_contract?.display_text || profile.age_contract?.value || profile.age || profile.age_range || '按剧情设定', 80);
  const description = [role, clean(profile.gender, 30), age, clean(profile.ethnicity || profile.ethnic_appearance, 120), clean(profile.appearanceText, 1000)]
    .filter(Boolean).join('，');
  const looks = rows(profile.look_profiles);
  const look = looks.find(item => clean(item.id, 120) === clean(profile.active_look_id, 120)) || looks[0] || {};
  const wardrobe = clean(look.wardrobeText || profile.wardrobeText || '按剧情身份生成完整服装、鞋履和配饰', 1200);
  const hair = clean(look.hairMakeupText || profile.hairMakeupText || '发型、妆面和肤质符合人物年龄与身份', 800);
  const feature = performanceOnly(profile.performanceText || profile.performance)
    || '神态与动作符合剧情，表演自然克制，保持完整身体和真实受力。';
  const continuity = clean(look.continuityText || profile.continuityText, 1000)
    || '同一人物的脸型、年龄、体态、发型、服装、鞋履和配饰在全部视图与镜头中保持一致。';
  const negative = clean(look.negativeText || profile.negativeText, 1000)
    || '不得出现多余人物、身份漂移、年龄变化、服装变色、肢体畸形、文字、水印、Logo 或无关场景。';
  return [
    `名称：${name}`,
    `描述：${description}`,
    `服装：${wardrobe}`,
    `发型妆造：${hair}`,
    `特征：${feature}`,
    `随身道具：${propsText(profile)}`,
    `构图规范：高质量专业人物设定图，纯浅灰色或纯白色无缝背景，中性摄影棚柔光；同一人物依次提供正面面部特写、全身正面、全身三分之四侧面、全身侧面和全身背面，完整头顶到鞋底，清晰展示脸型、体态、发型、服装结构、材质、鞋履、配饰与手部；${continuity} 无文字、标签、边框、水印、Logo、UI 元素或背景物体。`,
    `视觉限制：${negative}`,
    '视觉风格：电影级写实人物设定，真实肤质与自然光影，细节清晰，避免塑料皮肤、过度磨皮、卡通化和夸张棚拍姿势。',
  ].join('\n\n');
}

function ensurePropsLine(prompt = '', profile = {}) {
  const normalized = clean(prompt, 8000);
  const line = `随身道具：${propsText(profile)}`;
  if (!normalized) return line;
  if (/随身道具\s*[:：][^\n]*/u.test(normalized)) return normalized;
  return `${normalized}\n\n${line}`;
}

function compile(profile = {}) {
  const authored = clean(profile.generation_prompt || profile.generationPrompt, 8000);
  return ensurePropsLine(authored || fallbackPrompt(profile), profile);
}

function normalizeSettings() {
  const quality = 'high';
  return {
    model: 'gpt-image-2',
    aspect_ratio: '2:1',
    quality,
    resolution: '2K',
    count: 1,
  };
}

function project(profile = {}) {
  const ownedProps = normalizeOwnedProps(profile);
  const authored = clean(profile.generation_prompt || profile.generationPrompt, 8000);
  return {
    ...profile,
    owned_props: ownedProps,
    generation_prompt: compile({ ...profile, owned_props: ownedProps }),
    generation_prompt_source: clean(profile.generation_prompt_source || profile.generationPromptSource, 40)
      || (authored ? 'model_or_user' : 'compiled_from_profile'),
    generation_settings: normalizeSettings(profile.generation_settings || profile.generationSettings),
  };
}

module.exports = { clean, normalizeOwnedProps, propsText, performanceOnly, fallbackPrompt, ensurePropsLine, compile, normalizeSettings, project };
