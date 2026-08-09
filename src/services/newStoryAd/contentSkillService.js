const SKILL_VERSION = '1.0.0';

const DEFINITIONS = Object.freeze({
  commercial_subject: Object.freeze({
    id: 'vido.story_ad.commercial_subject',
    label: '广告内容生成',
    objective: '围绕用户明确提供的广告主体、卖点证据和品牌约束生成内容',
    forbidden: ['编造未提供的功效、价格、资质或品牌事实', '把纯剧情要求误写成销售广告'],
  }),
  narrative_story: Object.freeze({
    id: 'vido.story_ad.narrative_story',
    label: '纯剧情内容生成',
    objective: '围绕用户故事事实、人物关系和情节目标生成内容',
    forbidden: ['凭空加入商品、品牌、卖点、购买引导或销售转化', '复用广告行业模板覆盖故事事实'],
  }),
});

function mode(value = '') {
  return value === 'narrative_story' ? 'narrative_story' : 'commercial_subject';
}

function snapshot(value = '') {
  const contentMode = mode(value);
  const definition = DEFINITIONS[contentMode];
  return {
    id: definition.id,
    version: SKILL_VERSION,
    mode: contentMode,
    label: definition.label,
    objective: definition.objective,
    forbidden: [...definition.forbidden],
    runtime: 'vido_server',
  };
}

function promptBlock(value = '') {
  const skill = snapshot(value);
  return [
    `平台内容 Skill：${skill.label}（${skill.id}@${skill.version}）。`,
    `唯一生成目标：${skill.objective}。`,
    `禁止：${skill.forbidden.join('；')}。`,
  ].join('\n');
}

module.exports = { SKILL_VERSION, DEFINITIONS, mode, snapshot, promptBlock };
