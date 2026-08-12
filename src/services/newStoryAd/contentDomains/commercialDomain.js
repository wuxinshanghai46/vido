'use strict';

module.exports = Object.freeze({
  mode: 'commercial_subject',
  id: 'vido.story_ad.domain.commercial',
  version: 1,
  label: '广告',
  objective: '围绕用户明确提供的商品或服务主体、受众、价值、证据和传播动作完成广告表达',
  required_sections: Object.freeze([
    'advertised_subject', 'audience', 'value_proposition', 'proof',
    'presentation_scenes', 'communication_structure', 'call_to_action', 'forbidden_claims',
  ]),
  script_fields: Object.freeze([
    'advertised_subject', 'audience_need', 'value_proposition', 'visual_proof',
    'presentation_action', 'spoken_line', 'call_to_action',
  ]),
  prompt_rules: Object.freeze([
    '广告主体、卖点和证据只能来自用户输入或已确认资产',
    '不得编造功效、价格、资质、销量、排名或品牌事实',
    '允许使用故事化表达，但每个情节必须服务于明确的广告传播目标',
  ]),
  forbidden: Object.freeze(['把广告改写成与主体无关的纯故事', '用人物冲突替代产品或服务证据']),
});
