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

async function reviewPersonKeyframe({
  taskId = '', ctx = {}, shot = {}, contract: shotContract = {}, generatedUrl = '', gateway = modelGateway, repair = jsonRepair,
  timeoutMs = 60000, maxCandidates = 2, stageBudgetMs = 90000,
} = {}) {
  const presence = personIdentity.shotPersonPresence(shot, shotContract);
  if (personIdentity.shotForbidsPerson(ctx, shot)) {
    if (process.env.NEW_STORY_AD_MOCK_LLM === '1') {
      return { pass: true, status: 'verified', forbidden_person_check: true, visible_human: false, conflicts: [], checked_at: new Date().toISOString(), used_model: 'mock/new-story-ad-no-human-qa' };
    }
    const result = await gateway.generateVision({
      taskId,
      stage: 'new_story_ad.person_keyframe_qa',
      imageUrls: [generatedUrl],
      systemPrompt: 'You are a strict no-human visual inspector for a general-purpose commercial video platform. Inspect only the supplied generated image and return strict JSON.',
      userPrompt: 'This shot has an explicit no-human contract. Reject any visible human face, body, hand, finger, arm, sleeve worn by a person, reflection, silhouette or other human trace. Return {"pass":boolean,"visible_human":boolean,"conflicts":string[],"retry_instruction":string}.',
      maxTokens: 1200,
      timeoutMs,
      maxCandidates,
      stageBudgetMs,
    });
    const parsed = await repair.parseOrRepair({ raw: result.text, expected: 'object', modelGateway: gateway, taskId, stage: 'new_story_ad.json_repair' });
    const conflicts = [...new Set([...(Array.isArray(parsed.conflicts) ? parsed.conflicts : []), ...(Array.isArray(parsed.mismatch_reasons) ? parsed.mismatch_reasons : [])]
      .map(value => cleanText(value, 240)).filter(Boolean))];
    const pass = parsed.pass === true && parsed.visible_human === false && !conflicts.length;
    return {
      pass,
      status: pass ? 'verified' : 'rejected',
      forbidden_person_check: true,
      visible_human: parsed.visible_human === true,
      conflicts,
      retry_instruction: cleanText(parsed.retry_instruction || '', 600),
      checked_at: new Date().toISOString(),
      used_model: result.used_model,
    };
  }
  if (!personIdentity.shotPersonRequired(ctx, shot, shotContract)) return notApplicable('当前镜头不需要人物身份检查');
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
    userPrompt: `Person contract: ${JSON.stringify(contract)}\nCurrent shot: ${JSON.stringify({ title: shot.title, visual: shot.visual, action: shot.action, characters: shot.characters, person_presence: presence })}\nJudge only visible dimensions: require hand ownership only when a hand/arm is visible, wardrobe only when clothing is visible, identity/age when a face is visible, and body proportions when enough body is visible. A required partial person can never be not_applicable. Return {"pass":boolean,"identity_score":0..1,"age_score":0..1,"wardrobe_score":0..1,"body_score":0..1,"hand_owner_score":0..1,"conflicts":string[],"mismatch_reasons":string[],"retry_instruction":string}.`,
    maxTokens: 2400,
    timeoutMs,
    maxCandidates,
    stageBudgetMs,
  });
  const parsed = await repair.parseOrRepair({ raw: result.text, expected: 'object', modelGateway: gateway, taskId, stage: 'new_story_ad.json_repair' });
  const conflicts = [...new Set([
    ...(Array.isArray(parsed.conflicts) ? parsed.conflicts : []),
    ...(Array.isArray(parsed.mismatch_reasons) ? parsed.mismatch_reasons : []),
  ].map(value => cleanText(value, 240)).filter(Boolean))];
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
    person_presence: presence.mode,
    checked_at: new Date().toISOString(),
    used_model: result.used_model,
  };
  const visibleParts = new Set(presence.visible_parts || []);
  const handPass = !visibleParts.has('hand') || qa.hand_owner_score >= 0.75;
  const wardrobePass = !visibleParts.has('wardrobe') || qa.wardrobe_score >= 0.85;
  const bodyPass = !visibleParts.has('body') || qa.body_score >= 0.75;
  qa.pass = presence.mode === 'partial'
    ? qa.pass && handPass && wardrobePass && !qa.conflicts.length
    : (presence.mode === 'face_partial'
      ? qa.pass && qa.identity_score >= 0.82 && qa.age_score >= 0.78 && wardrobePass && handPass && !qa.conflicts.length
      : (presence.mode === 'reflection'
        ? qa.pass && qa.identity_score >= 0.65 && wardrobePass && handPass && !qa.conflicts.length
        : (presence.mode === 'obscured'
          ? qa.pass && wardrobePass && (!visibleParts.has('body') || qa.body_score >= 0.65) && handPass && !qa.conflicts.length
          : qa.pass && qa.identity_score >= 0.82 && qa.age_score >= 0.8 && wardrobePass && bodyPass && handPass && !qa.conflicts.length)));
  qa.status = qa.pass ? 'verified' : 'rejected';
  return qa;
}

module.exports = { reviewPersonKeyframe, notApplicable };
