const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const productIdentity = require('./productIdentityContractService');
const { cleanText } = require('./contextBuilder');

function score(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n > 1 && n <= 100 ? n / 100 : n));
}

function notApplicable(reason = '') {
  return { pass: true, status: 'not_applicable', reason, conflicts: [], checked_at: new Date().toISOString() };
}

async function reviewProductKeyframe({
  taskId = '', ctx = {}, shot = {}, contract: shotContract = {}, generatedUrl = '', gateway = modelGateway, repair = jsonRepair,
  timeoutMs = 60000, maxCandidates = 2, stageBudgetMs = 90000,
} = {}) {
  const presence = productIdentity.shotProductPresence(ctx, shot, shotContract);
  const proofRequired = productIdentity.shotProductProofRequired(ctx, shot, shotContract);
  const visualLockRequired = productIdentity.shotProductVisualLockRequired(ctx, shot, shotContract);
  if (!proofRequired && !visualLockRequired) return notApplicable('当前镜头没有要求广告主体证明或视觉身份锁');
  const contract = visualLockRequired ? productIdentity.assertVerifiedProduct(ctx) : productIdentity.buildProductContract(ctx);
  if (process.env.NEW_STORY_AD_MOCK_LLM === '1') {
    return { pass: true, status: 'verified', proof_pass: true, identity_score: visualLockRequired ? 0.94 : null, shape_score: visualLockRequired ? 0.92 : null, color_score: visualLockRequired ? 0.93 : null, material_score: visualLockRequired ? 0.9 : null, count_score: visualLockRequired ? 0.9 : null, conflicts: [], checked_at: new Date().toISOString(), used_model: 'mock/new-story-ad-product-keyframe-qa' };
  }
  const proofOnly = proofRequired && !visualLockRequired;
  const result = await gateway.generateVision({
    taskId,
    stage: 'new_story_ad.product_keyframe_qa',
    imageUrls: [...(visualLockRequired ? (contract.reference_images || []).slice(0, 5) : []), generatedUrl],
    systemPrompt: [
      'You are a strict product-consistency inspector for a general-purpose commercial video platform.',
      'The product may come from any lawful industry. Judge only against the current task references and never assume a fixed brand, package, material, shape or scene.',
      'The final image is the generated shot. Return strict JSON only.',
    ].join('\n'),
    userPrompt: `Product/advertised-subject contract: ${JSON.stringify(contract)}\nCurrent shot: ${JSON.stringify({ title: shot.title, visual: shot.visual, action: shot.action, material_usage: shot.material_usage, product_presence: presence })}\n${proofOnly ? 'No visual identity reference is required. Judge whether the generated image visibly proves the advertised subject and the applicable proof_requirements in this shot; missing visible proof is failure. Do not judge unspecified shape, color, package or brand identity.' : 'Judge only identity dimensions visible in this framing. A detail/partial shot must preserve local identity, color and material but does not need to reveal full silhouette or package count. A full/packshot must preserve complete identity, shape, color, material and count.'} Return {"pass":boolean,"proof_pass":boolean,"proof_evidence":string[],"identity_score":0..1,"shape_score":0..1,"color_score":0..1,"material_score":0..1,"count_score":0..1,"conflicts":string[],"mismatch_reasons":string[],"retry_instruction":string}.`,
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
    identity_score: proofOnly ? null : score(parsed.identity_score),
    shape_score: proofOnly ? null : score(parsed.shape_score),
    color_score: proofOnly ? null : score(parsed.color_score),
    material_score: proofOnly ? null : score(parsed.material_score),
    count_score: proofOnly ? null : score(parsed.count_score),
    conflicts,
    proof_pass: parsed.proof_pass === true || (!proofOnly && parsed.pass === true),
    proof_evidence: Array.isArray(parsed.proof_evidence) ? parsed.proof_evidence.map(value => cleanText(value, 300)).filter(Boolean).slice(0, 24) : [],
    retry_instruction: cleanText(parsed.retry_instruction || '', 600),
    product_presence: presence.mode,
    checked_at: new Date().toISOString(),
    used_model: result.used_model,
  };
  if (proofOnly) {
    qa.pass = parsed.pass === true && qa.proof_pass && !qa.conflicts.length;
    qa.status = qa.pass ? 'verified' : 'rejected';
    return qa;
  }
  qa.pass = presence.mode === 'partial'
    ? qa.pass && qa.identity_score >= 0.72 && qa.color_score >= 0.75 && qa.material_score >= 0.78 && !qa.conflicts.length
    : qa.pass && qa.identity_score >= 0.82 && qa.shape_score >= 0.8 && qa.color_score >= 0.8 && qa.material_score >= 0.72 && qa.count_score >= 0.7 && !qa.conflicts.length;
  qa.status = qa.pass ? 'verified' : 'rejected';
  return qa;
}

module.exports = { reviewProductKeyframe, notApplicable };
