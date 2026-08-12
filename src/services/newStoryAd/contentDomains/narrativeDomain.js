'use strict';

module.exports = Object.freeze({
  mode: 'narrative_story',
  id: 'vido.story_ad.domain.narrative',
  version: 1,
  label: '剧情',
  objective: '围绕用户确认的世界、人物关系、地点、因果链、冲突、高潮、结局和主题完成叙事',
  required_sections: Object.freeze([
    'world', 'characters', 'relationships', 'goals', 'locations',
    'causal_chain', 'conflict', 'climax', 'ending', 'theme',
  ]),
  script_fields: Object.freeze([
    'story_event', 'character_goal', 'causal_link', 'conflict',
    'action', 'dialogue', 'state_change', 'location_change',
  ]),
  prompt_rules: Object.freeze([
    '人物、关系、地点、事件顺序和结局以用户故事事实为最高权威',
    '不得凭空加入商品、品牌、卖点、购买引导或销售转化',
    '跨时代地点必须保存地点血缘、保留锚点和改造差异',
  ]),
  forbidden: Object.freeze(['套用广告卖点结构覆盖故事因果', '把故事结尾改写成品牌或购买行动']),
});
