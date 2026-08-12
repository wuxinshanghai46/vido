'use strict';

const contentSkill = require('./contentSkillService');

function clean(value = '', max = 4000) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }
function visibleText(value = {}) {
  const beats = Array.isArray(value.beats) ? value.beats : [];
  const shots = Array.isArray(value.shots) ? value.shots : (Array.isArray(value) ? value : []);
  return clean([value.story_title, value.logline, ...beats.flatMap(beat => [beat.title, beat.plot, beat.visual, beat.action, beat.spoken_line, beat.voiceover, beat.visual_proof]), ...shots.flatMap(shot => [shot.title, shot.purpose, shot.visual, shot.action, shot.voiceover, shot.material_usage])].filter(Boolean).join(' '), 20000);
}

function contract(context = {}) {
  const domain = contentSkill.assertSelected(context);
  return context.content_domain_contract || contentSkill.snapshot(domain.mode).domain_contract;
}

function assertNoCrosstalk(context = {}, artifact = {}) {
  const domain = contentSkill.assertSelected(context), text = visibleText(artifact);
  const issues = [];
  if (domain.mode === 'narrative_story' && /(?:购买|下单|立即咨询|核心卖点|产品优势|销售转化|行动号召|品牌落版)/.test(text)) issues.push('剧情产物混入广告销售语言');
  if (domain.mode === 'commercial_subject') {
    const subject = clean(context.product_subject, 200);
    if (!subject) issues.push('广告产物缺少明确商品或服务主体');
    if (subject && text && !text.includes(subject) && !/(商品|产品|服务|主体|材料|方案)/.test(text)) issues.push('广告产物没有呈现广告主体或主体证据');
  }
  if (issues.length) {
    const error = new Error(`内容类型质量门禁未通过：${issues.join('；')}`);
    error.code = 'CONTENT_DOMAIN_QA_FAILED'; error.status = 422; error.retryable = true; error.issues = issues;
    throw error;
  }
  return { pass: true, mode: domain.mode };
}

function tagBlueprint(context = {}, blueprint = {}) {
  const domain = contentSkill.assertSelected(context), domainContract = contract(context);
  const tagged = { ...blueprint, content_mode: domain.mode, content_domain_contract: domainContract, prompt_pack: `${domainContract.id}@${domainContract.version}`, source_revision: Number(context.content_revision || context.revision || 1) || 1 };
  assertNoCrosstalk(context, tagged);
  return tagged;
}

function tagShots(context = {}, shots = []) {
  const domain = contentSkill.assertSelected(context), domainContract = contract(context);
  const tagged = (Array.isArray(shots) ? shots : []).map(shot => ({ ...shot, content_mode: domain.mode, content_domain_contract: domainContract, prompt_pack: `${domainContract.id}@${domainContract.version}` }));
  assertNoCrosstalk(context, { shots: tagged });
  return tagged;
}

function promptBlock(context = {}) { return contentSkill.promptBlock(contentSkill.assertSelected(context).mode); }

module.exports = { contract, assertNoCrosstalk, tagBlueprint, tagShots, promptBlock };
