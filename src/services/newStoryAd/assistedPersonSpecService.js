'use strict';

const { cleanText } = require('./contextBuilder');
const subjectProfileText = require('./subjectProfileTextService');
const petIdentity = require('./petIdentityContractService');

function alignPersonAgeDescription(text = '', age = '') {
  return subjectProfileText.alignAgeDescription(text, age, 360);
}

function fallback(spec = {}, current = {}, context = {}) {
  const merged = { ...(current && typeof current === 'object' ? current : {}), ...(spec && typeof spec === 'object' ? spec : {}) };
  const role = cleanText(merged.roleName || merged.role_name || '广告主角', 80);
  const subject = cleanText(context.product_subject || context.brief || '当前广告主体', 80);
  const ageLabel = subjectProfileText.AGE_LABELS[String(merged.age || '')]
    || '符合目标用户与剧情关系的真实成年人物年龄感';
  return {
    appearanceText: `${ageLabel}，${role}的脸型、体态、肤质和表情自然可信，保持真实商业摄影质感，避免网红脸、过度磨皮和夸张表演。`,
    wardrobeText: `${role}穿着符合${subject}定位和使用场景的真实服装；明确上衣、下装或裙装、鞋、配饰、颜色与材质，整体克制协调，并在全部镜头中保持一致。`,
    hairMakeupText: `${role}采用整洁自然且符合身份的发型与妆造，发色、发长、分缝、妆容、眼镜或胡须等识别特征在全部镜头中保持一致，避免厚重滤镜和塑料皮肤。`,
    negativeText: `不要改变${role}的年龄、性别、脸型、发型、服装颜色和配饰；不要出现多余人物、网红脸、塑料皮肤、夸张表情、肢体畸形、文字水印或与${subject}无关的造型。`,
  };
}

function enforceAssistedPersonSpec(spec = {}, current = {}, context = {}) {
  const output = { ...(spec && typeof spec === 'object' ? spec : {}) };
  const source = current && typeof current === 'object' ? current : {};
  const preserve = (key, defaults = []) => {
    const value = cleanText(source[key] || source[key.replace(/[A-Z]/g, match => `_${match.toLowerCase()}`)] || '', 80);
    if (value && !defaults.includes(value)) output[key] = value;
  };
  preserve('castMode', ['auto']);
  preserve('gender', ['auto']);
  preserve('age', ['match_brief']);
  preserve('origin', ['match_brief']);
  preserve('roleName');
  preserve('displayName');
  preserve('expectedPeople');
  petIdentity.preserveAssistedFields(output, source);
  const defaults = fallback(output, source, context);
  output.appearanceText = alignPersonAgeDescription(
    output.appearanceText || output.appearance
      || source.appearanceText || source.appearance || defaults.appearanceText,
    output.age,
  );
  output.wardrobeText = cleanText(
    output.wardrobeText || output.wardrobe || output.outfit
      || source.wardrobeText || source.wardrobe || source.outfit || defaults.wardrobeText,
    420,
  );
  output.hairMakeupText = cleanText(
    output.hairMakeupText || output.hair_makeup || output.hair
      || source.hairMakeupText || source.hair_makeup || source.hair || defaults.hairMakeupText,
    280,
  );
  output.negativeText = cleanText(
    output.negativeText || output.negative || source.negativeText || source.negative || defaults.negativeText,
    420,
  );
  return output;
}

module.exports = { alignPersonAgeDescription, enforceAssistedPersonSpec, fallback };
