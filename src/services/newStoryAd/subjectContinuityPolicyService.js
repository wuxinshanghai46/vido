const FOUR_VIEW_ASSIST_RULE_ZH = [
  '人物描述必须面向同一套四视图身份资产，写成一个无条件、可直接观察的固定状态。',
  '上衣、下装或裙装、鞋、帽子、眼镜、发带等发饰、首饰、发型、发色和妆容在正面、侧面、背面、动作四个视图中必须完全一致。',
  '同一个 look_profiles 造型内部不得使用“户外时、室内时、运动时、必要时、可佩戴、偶尔、某个视角”等条件式或可选式描述。剧情明确要求换装、跨时代或不同故事状态时，必须拆成多个带稳定 ID 和 scene_ids 的造型；不得把多套造型压进一个 wardrobeText。',
  '对容易漂移的帽子、眼镜、发带、耳饰、项链等项目，必须明确写出固定款式、颜色和佩戴状态；不需要时明确写“不佩戴”。',
].join('');

const FOUR_VIEW_GENERATION_RULE_EN = [
  'Four-view continuity is a hard identity contract.',
  'Before rendering, resolve every wardrobe, footwear, headwear, eyewear, hair-accessory, jewelry, hairstyle, hair-color and makeup description into one single visible state.',
  'Apply the selected look profile unchanged in the front, side, back and action cells.',
  'Never add, remove, swap, recolor, resize or reposition a garment or accessory between cells. Alternate looks are allowed only as separate look profiles with stable IDs and explicit scene bindings.',
].join(' ');

function assistRuleZh() {
  return FOUR_VIEW_ASSIST_RULE_ZH;
}

function generationRuleEn() {
  return FOUR_VIEW_GENERATION_RULE_EN;
}

module.exports = {
  FOUR_VIEW_ASSIST_RULE_ZH,
  FOUR_VIEW_GENERATION_RULE_EN,
  assistRuleZh,
  generationRuleEn,
};
