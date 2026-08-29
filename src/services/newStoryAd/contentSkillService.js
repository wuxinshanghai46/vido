const contentDomains = require('./contentDomains');
const SKILL_VERSION = '2.0.0';

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
  if (!String(value || '').trim()) return 'commercial_subject';
  return contentDomains.resolve(value).mode;
}

function snapshot(value = '') {
  const contentMode = mode(value);
  const definition = DEFINITIONS[contentMode];
  const domain = contentDomains.snapshot(contentMode);
  return {
    id: definition.id,
    version: SKILL_VERSION,
    mode: contentMode,
    label: definition.label,
    objective: definition.objective,
    forbidden: [...definition.forbidden],
    domain_contract: domain,
    runtime: 'vido_server',
  };
}

function promptBlock(value = '') {
  const skill = snapshot(value);
  return [
    `平台内容 Skill：${skill.label}（${skill.id}@${skill.version}）。`,
    `唯一生成目标：${skill.objective}。`,
    `禁止：${skill.forbidden.join('；')}。`,
    contentDomains.promptBlock(skill.mode),
  ].join('\n');
}

function applyModeTransition(previousContext = {}, nextContext = {}, request = {}) {
  const from = String(previousContext.content_mode || '').trim();
  const to = String(nextContext.content_mode || '').trim();
  const changed = Boolean(from && to && from !== to);
  if (changed && request.content_mode_change_confirmed !== true && request.contentModeChangeConfirmed !== true) {
    const error = new Error('切换广告/剧情类型会使旧剧本、提示词、分镜和下游生成结果失效；请明确确认后再保存。');
    error.code = 'CONTENT_MODE_CHANGE_CONFIRMATION_REQUIRED';
    error.status = 409;
    error.retryable = false;
    error.from_content_mode = from;
    error.to_content_mode = to;
    throw error;
  }
  if (!changed) return nextContext;
  return {
    ...nextContext,
    content_mode_migration: {
      from,
      to,
      confirmed_at: new Date().toISOString(),
      retained: ['uploads', 'person_identity', 'scene_raw_assets'],
      invalidated: ['asset_plan', 'scene_config', 'blueprint', 'story_flow_sketches', 'storyboard', 'storyboard_images', 'keyframes', 'tts_audio', 'video_clips', 'final_video'],
    },
  };
}

module.exports = { SKILL_VERSION, DEFINITIONS, mode, snapshot, promptBlock, applyModeTransition, assertSelected: contentDomains.assertSelected };
