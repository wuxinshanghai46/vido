const tokenTracker = require('../tokenTracker');
const domain = require('./domainContract');
const { VideoGenerationError } = require('./chineseError');

const COST_POLICY_VERSION = 'video-cost-authorization-v1';

/** 在全局视频定价表中按完整或部分模型名称查找美元每秒单价。 */
function findVideoPrice(modelId = '') {
  const normalized = domain.text(modelId).toLowerCase();
  const table = tokenTracker.VIDEO_PRICING || {};
  const keys = Object.keys(table).sort((left, right) => right.length - left.length);
  const matched = keys.find(key => normalized === key.toLowerCase()
    || normalized.includes(key.toLowerCase())
    || key.toLowerCase().includes(normalized));
  return matched ? { known: true, key: matched, usd_per_second: Number(table[matched]) || 0 } : { known: false, key: '', usd_per_second: 0 };
}

/** 读取美元兑人民币汇率，异常时采用保守的安全汇率。 */
function cnyRate(value = 0) {
  const explicit = Number(value);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  try {
    const tracked = Number(tokenTracker.getUSDtoCNY?.());
    if (Number.isFinite(tracked) && tracked > 0) return tracked;
  } catch {}
  return 7.5;
}

/** 按供应商最小计费片段计算单个生成单元的计费秒数。 */
function billableSeconds(unit = {}, options = {}) {
  const minimum = Math.max(1, Number(options.minimum_billable_seconds || options.minimumBillableSeconds || 5) || 5);
  return Math.max(minimum, Math.ceil(Number(unit.duration_sec || 0) || minimum));
}

/** 生成包含人民币最坏费用、单元明细和零自动重试的成本方案。 */
function buildCostPlan({ executionPlan = {}, modelId = '', providerId = '', options = {} } = {}) {
  const price = findVideoPrice(modelId);
  const rate = cnyRate(options.usd_cny_rate || options.usdCnyRate);
  const safetyFactor = Math.max(1, Math.min(2, Number(options.cost_safety_factor || options.costSafetyFactor || 1.15) || 1.15));
  const paidUnits = (executionPlan.generation_units || []).filter(unit => unit.paid !== false);
  const units = paidUnits.map(unit => {
    const seconds = billableSeconds(unit, options);
    const estimatedUsd = seconds * price.usd_per_second;
    return {
      generation_unit_id: unit.id,
      edit_shot_indexes: unit.edit_shot_indexes,
      mode: unit.mode,
      billable_seconds: seconds,
      estimated_cost_usd: Number(estimatedUsd.toFixed(6)),
      estimated_cost_rmb: Number((estimatedUsd * rate).toFixed(2)),
      automatic_retry_limit: 0,
      complexity_level: unit.complexity_level,
      requires_manual_review: unit.requires_manual_review === true,
    };
  });
  const estimatedUsd = units.reduce((sum, unit) => sum + unit.estimated_cost_usd, 0);
  const estimatedRmb = estimatedUsd * rate;
  const plan = {
    version: COST_POLICY_VERSION,
    execution_plan_fingerprint: executionPlan.fingerprint || '',
    provider_id: domain.text(providerId),
    model_id: domain.text(modelId),
    price_known: price.known,
    price_key: price.key,
    unit_price_usd_per_second: price.usd_per_second,
    usd_cny_rate: rate,
    safety_factor: safetyFactor,
    paid_unit_count: units.length,
    automatic_paid_retry_count: 0,
    estimated_cost_rmb: Number(estimatedRmb.toFixed(2)),
    maximum_cost_rmb: Number((estimatedRmb * safetyFactor).toFixed(2)),
    units,
  };
  return { ...plan, fingerprint: domain.fingerprint(plan) };
}

/** 校验高复杂度镜头是否已经完成人工预演确认。 */
function assertComplexityReview(executionPlan = {}, options = {}) {
  const risky = (executionPlan.generation_units || []).filter(unit => unit.requires_manual_review);
  if (!risky.length || options.complexity_review_confirmed === true || options.complexityReviewConfirmed === true) return;
  throw new VideoGenerationError('VIDEO_COMPLEXITY_REVIEW_REQUIRED', '', {
    status: 409,
    retryable: false,
    details: { generation_unit_ids: risky.map(unit => unit.id) },
  });
}

/** 校验用户确认的成本指纹和人民币上限，任何变化都要求重新确认。 */
function assertCostAuthorization(costPlan = {}, options = {}) {
  if (!Number(costPlan.paid_unit_count || 0)) return { authorized: true, zero_cost: true };
  if (!costPlan.price_known) {
    throw new VideoGenerationError('VIDEO_COST_PRICE_UNKNOWN', '', { status: 409, retryable: false, details: costPlan });
  }
  const suppliedFingerprint = domain.text(options.cost_plan_fingerprint || options.costPlanFingerprint);
  const confirmedLimit = Number(options.confirmed_cost_limit_rmb ?? options.confirmedCostLimitRmb);
  if (!suppliedFingerprint || suppliedFingerprint !== costPlan.fingerprint || !Number.isFinite(confirmedLimit)) {
    throw new VideoGenerationError('VIDEO_COST_CONFIRMATION_REQUIRED', '', { status: 409, retryable: false, details: costPlan });
  }
  if (confirmedLimit + 0.001 < Number(costPlan.maximum_cost_rmb || 0)) {
    throw new VideoGenerationError('VIDEO_COST_LIMIT_EXCEEDED', '', { status: 409, retryable: false, details: costPlan });
  }
  return {
    authorized: true,
    zero_cost: false,
    fingerprint: costPlan.fingerprint,
    confirmed_cost_limit_rmb: Number(confirmedLimit.toFixed(2)),
    maximum_cost_rmb: Number(costPlan.maximum_cost_rmb || 0),
  };
}

/** 返回前端可展示的成本方案，隐藏不需要的内部对象。 */
function publicCostPlan(plan = {}) {
  return {
    version: plan.version,
    fingerprint: plan.fingerprint,
    provider_id: plan.provider_id,
    model_id: plan.model_id,
    price_known: plan.price_known === true,
    unit_price_usd_per_second: Number(plan.unit_price_usd_per_second || 0),
    usd_cny_rate: Number(plan.usd_cny_rate || 0),
    paid_unit_count: Number(plan.paid_unit_count || 0),
    automatic_paid_retry_count: 0,
    estimated_cost_rmb: Number(plan.estimated_cost_rmb || 0),
    maximum_cost_rmb: Number(plan.maximum_cost_rmb || 0),
    units: Array.isArray(plan.units) ? plan.units : [],
  };
}

module.exports = {
  COST_POLICY_VERSION,
  findVideoPrice,
  cnyRate,
  billableSeconds,
  buildCostPlan,
  assertComplexityReview,
  assertCostAuthorization,
  publicCostPlan,
};
