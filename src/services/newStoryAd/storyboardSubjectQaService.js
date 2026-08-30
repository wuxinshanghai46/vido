'use strict';

const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const sceneDomain = require('./sceneDomainContractService');

const QA_POLICY_VERSION = 2;
const clean = (value = '', max = 1200) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

function normalizeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function evaluate(parsed = {}, expected = {}) {
  const actual = {
    people: normalizeCount(parsed.visible_people),
    animals: normalizeCount(parsed.visible_animals),
    vehicles: normalizeCount(parsed.visible_vehicles),
    products: normalizeCount(parsed.visible_products),
  };
  const required = ['people', 'animals', 'vehicles', 'products'];
  const mismatches = required.filter(key => expected.count_modes?.[key] === 'minimum'
    ? actual[key] < normalizeCount(expected[key])
    : actual[key] !== normalizeCount(expected[key]));
  const duplicate = parsed.duplicated_identity === true
    || parsed.same_identity_multiple_instances === true
    || normalizeCount(parsed.same_identity_instance_count) > 1;
  return {
    pass: parsed.pass === true && !mismatches.length && !duplicate,
    expected,
    actual,
    count_mismatches: mismatches,
    duplicated_identity: duplicate,
    conflicts: (Array.isArray(parsed.conflicts) ? parsed.conflicts : []).map(value => clean(value, 300)).filter(Boolean),
    retry_instruction: clean(parsed.retry_instruction, 700),
  };
}

async function review({ taskId = '', shot = {}, generatedUrl = '', domainContract = null, gateway = modelGateway, repair = jsonRepair } = {}) {
  const contract = domainContract || sceneDomain.compile({ shot });
  const expected = contract.subject_counts || sceneDomain.subjectCountContract(shot);
  if (process.env.NEW_STORY_AD_MOCK_LLM === '1') {
    return { pass: true, status: 'verified', policy_version: QA_POLICY_VERSION, expected, actual: { ...expected }, count_mismatches: [], duplicated_identity: false, conflicts: [], used_model: 'mock/storyboard-subject-qa' };
  }
  const response = await gateway.generateVision({
    taskId,
    stage: 'new_story_ad.storyboard_subject_qa',
    imageUrls: [generatedUrl],
    systemPrompt: 'You are a strict subject-count and identity-duplication inspector for a general-purpose storyboard platform covering every lawful industry and visual medium. Inspect only the supplied generated image and return strict JSON.',
    userPrompt: `Expected subject contract: ${JSON.stringify(expected)}\nScene domain: ${JSON.stringify({ environment_archetype: contract.environment_archetype, primary_subject_class: contract.primary_subject_class, motion_model: contract.motion_model })}\nPerform two independent visual passes before deciding. Pass 1: enumerate every visible physical instance, including partial bodies at frame edges, distant figures, repeated poses and figures seen through doorways; count each separately even when they share one identity. Pass 2: compare clothing, face, hair and body appearance to detect whether the same identity appears at multiple positions or action phases. A geometrically plausible mirror reflection is not a second physical subject, but a second full or partial body at another location is duplication. Count every visible principal human, animal, vehicle and authored product instance. Reject any added, missing, merged, replaced or duplicated principal subject. The pass field may be true only when your own counts exactly satisfy the contract and no identity is duplicated. Return {"pass":boolean,"visible_people":number,"visible_animals":number,"visible_vehicles":number,"visible_products":number,"duplicated_identity":boolean,"same_identity_multiple_instances":boolean,"same_identity_instance_count":number,"instance_evidence":string[],"conflicts":string[],"retry_instruction":string}.`,
    maxTokens: 1400,
    timeoutMs: 60000,
    maxCandidates: 2,
    stageBudgetMs: 90000,
  });
  const parsed = await repair.parseOrRepair({ raw: response.text, expected: 'object', modelGateway: gateway, taskId, stage: 'new_story_ad.json_repair' });
  const result = evaluate(parsed, expected);
  return { ...result, status: result.pass ? 'verified' : 'rejected', policy_version: QA_POLICY_VERSION, checked_at: new Date().toISOString(), used_model: response.used_model };
}

async function assert({ taskId = '', shot = {}, generatedUrl = '', domainContract = null, gateway, repair } = {}) {
  const result = await review({ taskId, shot, generatedUrl, domainContract, gateway, repair });
  if (result.pass) return result;
  const error = new Error(`分镜图主体数量或身份唯一性不符合镜头合同，已阻止进入视频流程：${result.count_mismatches.join('、') || '检测到重复身份'}`);
  error.code = 'STORYBOARD_SUBJECT_COUNT_MISMATCH';
  error.status = 422;
  error.retryable = true;
  error.subject_qa = result;
  throw error;
}

module.exports = { QA_POLICY_VERSION, review, assert, evaluate, normalizeCount };
