const crypto = require('crypto');
const storage = require('../newStoryAd/storageService');

const OUTPUT_KIND = 'reference_understanding_confirmation';
const SCHEMA_VERSION = 1;
const REQUIRED_CONTRACT = 'reference-understanding-v6';

function text(value, max = 300) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableObject(value[key]);
    return result;
  }, {});
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableObject(value || {}))).digest('hex');
}

function analysisId(analysis = {}) {
  return text(analysis.analysis_id || analysis.id, 120);
}

function readiness(analysis = {}) {
  const understanding = analysis.reference_understanding && typeof analysis.reference_understanding === 'object'
    ? analysis.reference_understanding
    : {};
  const completeness = understanding.completeness && typeof understanding.completeness === 'object'
    ? understanding.completeness
    : {};
  const failures = Array.isArray(completeness.failures)
    ? completeness.failures.map(item => text(item, 180)).filter(Boolean).slice(0, 20)
    : [];
  const missing = [];
  if (String(analysis.status || '').toLowerCase() !== 'completed') missing.push('analysis_not_completed');
  if (analysis.analysis_quality?.valid !== true) missing.push('analysis_quality_invalid');
  if (understanding.contract_version !== REQUIRED_CONTRACT || Number(understanding.schema_version || 0) < 6) missing.push('understanding_contract_outdated');
  if (!text(understanding.story_summary?.full_synopsis, 10000)) missing.push('full_synopsis_missing');
  if (!Array.isArray(understanding.causal_chain) || !understanding.causal_chain.length) missing.push('causal_chain_missing');
  if (!Array.isArray(understanding.scenes) || !understanding.scenes.length) missing.push('scene_narrative_missing');
  if (completeness.valid !== true || completeness.story_complete !== true || completeness.cause_chain_complete !== true) {
    missing.push('understanding_incomplete');
  }
  return {
    ready: missing.length === 0 && failures.length === 0,
    contract_version: text(understanding.contract_version, 80),
    missing: [...new Set([...missing, ...failures])],
  };
}

function inspect(taskId, context = {}) {
  const analysis = context.reference_video_analysis && typeof context.reference_video_analysis === 'object'
    ? context.reference_video_analysis
    : {};
  const id = analysisId(analysis);
  const understanding = analysis.reference_understanding || {};
  const currentFingerprint = fingerprint(understanding);
  const stored = storage.getOutput(taskId, OUTPUT_KIND);
  const gate = readiness(analysis);
  const current = !!stored
    && stored.status === 'confirmed'
    && stored.analysis_id === id
    && stored.understanding_fingerprint === currentFingerprint
    && gate.ready;
  return {
    schema_version: SCHEMA_VERSION,
    status: current ? 'confirmed' : (stored ? 'stale' : 'unconfirmed'),
    ready: gate.ready,
    analysis_id: id,
    contract_version: gate.contract_version,
    understanding_fingerprint: currentFingerprint,
    confirmed_at: current ? text(stored.confirmed_at, 80) : '',
    confirmed_revision: current ? Math.max(1, Number(stored.confirmed_revision || 1) || 1) : 0,
    failures: gate.missing,
  };
}

function confirm(taskId, context = {}, body = {}, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) {
    const error = new Error('项目不存在');
    error.status = 404;
    error.code = 'TASK_NOT_FOUND';
    throw error;
  }
  const currentRevision = Math.max(1, Number(task.content_revision || 1) || 1);
  const expectedRevision = Math.max(0, Number(body.base_revision ?? body.base_content_revision ?? 0) || 0);
  if (!expectedRevision || expectedRevision !== currentRevision) {
    const error = new Error(`项目已更新到版本 ${currentRevision}，请刷新深度学习报告后再确认`);
    error.status = 409;
    error.code = 'REFERENCE_UNDERSTANDING_REVISION_CONFLICT';
    error.current_content_revision = currentRevision;
    throw error;
  }
  if (body.confirmation !== 'authoritative_input') {
    const error = new Error('请明确确认该学习报告作为后续创作依据');
    error.status = 400;
    error.code = 'REFERENCE_UNDERSTANDING_CONFIRMATION_REQUIRED';
    throw error;
  }
  const analysis = context.reference_video_analysis && typeof context.reference_video_analysis === 'object'
    ? context.reference_video_analysis
    : {};
  const currentAnalysisId = analysisId(analysis);
  if (!currentAnalysisId || text(body.analysis_id, 120) !== currentAnalysisId) {
    const error = new Error('参考内容已经更换，请刷新后确认最新学习报告');
    error.status = 409;
    error.code = 'REFERENCE_UNDERSTANDING_ANALYSIS_CHANGED';
    throw error;
  }
  const gate = readiness(analysis);
  if (!gate.ready) {
    const error = new Error(`深度学习报告尚未达到确认标准：${gate.missing.join('、') || '报告不完整'}`);
    error.status = 422;
    error.code = 'REFERENCE_UNDERSTANDING_INCOMPLETE';
    error.failures = gate.missing;
    throw error;
  }
  const previous = inspect(taskId, context);
  if (previous.status === 'confirmed') return { ...previous, changed: false };
  const payload = {
    schema_version: SCHEMA_VERSION,
    status: 'confirmed',
    analysis_id: currentAnalysisId,
    contract_version: gate.contract_version,
    understanding_fingerprint: fingerprint(analysis.reference_understanding),
    confirmed_revision: currentRevision,
    confirmed_at: new Date().toISOString(),
    confirmed_by: text(options.user?.id || options.user?.userId, 120),
  };
  storage.saveOutput(taskId, OUTPUT_KIND, payload, { content_revision: currentRevision });
  return { ...inspect(taskId, context), changed: true };
}

module.exports = {
  OUTPUT_KIND,
  SCHEMA_VERSION,
  REQUIRED_CONTRACT,
  fingerprint,
  readiness,
  inspect,
  confirm,
};
