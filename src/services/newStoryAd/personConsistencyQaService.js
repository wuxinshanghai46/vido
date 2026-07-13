const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const personIdentity = require('./personIdentityContractService');
const { cleanText } = require('./contextBuilder');

function score(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n > 1 && n <= 100 ? n / 100 : n));
}

function notApplicable(reason = '') {
  return { pass: true, status: 'not_applicable', reason, conflicts: [], checked_at: new Date().toISOString() };
}

async function reviewPersonKeyframe({ taskId = '', ctx = {}, shot = {}, generatedUrl = '', gateway = modelGateway, repair = jsonRepair } = {}) {
  if (!personIdentity.personRequired(ctx)) return notApplicable('当前镜头不需要人物身份检查');
  const contract = personIdentity.assertVerifiedPerson(ctx);
  if (process.env.NEW_STORY_AD_MOCK_LLM === '1') {
    return { pass: true, status: 'verified', identity_score: 0.95, age_score: 0.94, wardrobe_score: 0.95, body_score: 0.92, hand_owner_score: 0.9, conflicts: [], checked_at: new Date().toISOString(), used_model: 'mock/new-story-ad-person-keyframe-qa' };
  }
  const refs = Object.values(contract.reference_views || {}).filter(Boolean).slice(0, 4);
  const result = await gateway.generateVision({
    taskId,
    stage: 'new_story_ad.person_keyframe_qa',
    imageUrls: [...refs, generatedUrl],
    systemPrompt: [
      'You are a strict person-consistency inspector for a general-purpose commercial video platform.',
      'The first images are the locked person references and the final image is the generated shot. The task may involve any lawful industry, scene, identity, ethnicity, wardrobe or visual medium. Never impose a fixed character template.',
      'Return strict JSON only.',
    ].join('\n'),
    userPrompt: `Person contract: ${JSON.stringify(contract)}\nCurrent shot: ${JSON.stringify({ title: shot.title, visual: shot.visual, action: shot.action, characters: shot.characters })}\nReturn {"pass":boolean,"identity_score":0..1,"age_score":0..1,"wardrobe_score":0..1,"body_score":0..1,"hand_owner_score":0..1,"conflicts":string[],"retry_instruction":string}.`,
    maxTokens: 2400,
  });
  const parsed = await repair.parseOrRepair({ raw: result.text, expected: 'object', modelGateway: gateway, taskId, stage: 'new_story_ad.json_repair' });
  const conflicts = Array.isArray(parsed.conflicts) ? parsed.conflicts.map(value => cleanText(value, 240)).filter(Boolean) : [];
  const qa = {
    pass: parsed.pass === true,
    status: 'rejected',
    identity_score: score(parsed.identity_score),
    age_score: score(parsed.age_score),
    wardrobe_score: score(parsed.wardrobe_score),
    body_score: score(parsed.body_score),
    hand_owner_score: score(parsed.hand_owner_score),
    conflicts,
    retry_instruction: cleanText(parsed.retry_instruction || '', 600),
    checked_at: new Date().toISOString(),
    used_model: result.used_model,
  };
  qa.pass = qa.pass && qa.identity_score >= 0.82 && qa.age_score >= 0.8 && qa.wardrobe_score >= 0.85 && qa.body_score >= 0.75 && qa.hand_owner_score >= 0.7 && !qa.conflicts.length;
  qa.status = qa.pass ? 'verified' : 'rejected';
  return qa;
}

module.exports = { reviewPersonKeyframe, notApplicable };
