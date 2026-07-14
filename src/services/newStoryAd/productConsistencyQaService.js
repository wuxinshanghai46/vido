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
  taskId = '', ctx = {}, shot = {}, generatedUrl = '', gateway = modelGateway, repair = jsonRepair,
  timeoutMs = 60000, maxCandidates = 2, stageBudgetMs = 90000,
} = {}) {
  if (!productIdentity.productRequired(ctx)) return notApplicable('当前任务没有需要视觉锁定的产品参考');
  const contract = productIdentity.assertVerifiedProduct(ctx);
  if (process.env.NEW_STORY_AD_MOCK_LLM === '1') {
    return { pass: true, status: 'verified', identity_score: 0.94, shape_score: 0.92, color_score: 0.93, material_score: 0.9, count_score: 0.9, conflicts: [], checked_at: new Date().toISOString(), used_model: 'mock/new-story-ad-product-keyframe-qa' };
  }
  const result = await gateway.generateVision({
    taskId,
    stage: 'new_story_ad.product_keyframe_qa',
    imageUrls: [...(contract.reference_images || []).slice(0, 5), generatedUrl],
    systemPrompt: [
      'You are a strict product-consistency inspector for a general-purpose commercial video platform.',
      'The product may come from any lawful industry. Judge only against the current task references and never assume a fixed brand, package, material, shape or scene.',
      'The final image is the generated shot. Return strict JSON only.',
    ].join('\n'),
    userPrompt: `Product contract: ${JSON.stringify(contract)}\nCurrent shot: ${JSON.stringify({ title: shot.title, visual: shot.visual, action: shot.action, material_usage: shot.material_usage })}\nReturn {"pass":boolean,"identity_score":0..1,"shape_score":0..1,"color_score":0..1,"material_score":0..1,"count_score":0..1,"conflicts":string[],"retry_instruction":string}.`,
    maxTokens: 2400,
    timeoutMs,
    maxCandidates,
    stageBudgetMs,
  });
  const parsed = await repair.parseOrRepair({ raw: result.text, expected: 'object', modelGateway: gateway, taskId, stage: 'new_story_ad.json_repair' });
  const conflicts = Array.isArray(parsed.conflicts) ? parsed.conflicts.map(value => cleanText(value, 240)).filter(Boolean) : [];
  const qa = {
    pass: parsed.pass === true,
    status: 'rejected',
    identity_score: score(parsed.identity_score),
    shape_score: score(parsed.shape_score),
    color_score: score(parsed.color_score),
    material_score: score(parsed.material_score),
    count_score: score(parsed.count_score),
    conflicts,
    retry_instruction: cleanText(parsed.retry_instruction || '', 600),
    checked_at: new Date().toISOString(),
    used_model: result.used_model,
  };
  qa.pass = qa.pass && qa.identity_score >= 0.82 && qa.shape_score >= 0.8 && qa.color_score >= 0.8 && qa.material_score >= 0.72 && qa.count_score >= 0.7 && !qa.conflicts.length;
  qa.status = qa.pass ? 'verified' : 'rejected';
  return qa;
}

module.exports = { reviewProductKeyframe, notApplicable };
