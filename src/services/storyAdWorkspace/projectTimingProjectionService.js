function cleanTiming(value, clean) {
  return clean(value, 80);
}

function generationTiming(task = {}, clean) {
  return {
    generation_queued_at: cleanTiming(task.generation_queued_at, clean),
    generation_started_at: cleanTiming(task.generation_started_at, clean),
    generation_finished_at: cleanTiming(task.generation_finished_at, clean),
    generation_progress: task.generation_progress && typeof task.generation_progress === 'object'
      ? task.generation_progress
      : null,
  };
}

function semanticContractProgress(value = {}, clean, list) {
  if (!value || typeof value !== 'object') return null;
  const allowedContracts = ['story', 'timeline', 'cast', 'scenes', 'brand_audio'];
  const contracts = {};
  for (const name of allowedContracts) {
    const state = value.contracts?.[name];
    if (!state || typeof state !== 'object') continue;
    contracts[name] = {
      complete: state.complete === true,
      status: clean(state.status, 40),
      failures: list(state.failures).slice(0, 8).map(item => clean(item, 100)).filter(Boolean),
    };
  }
  return {
    version: clean(value.version, 80),
    valid: value.valid === true,
    completed: Math.max(0, Math.min(allowedContracts.length, Number(value.completed || 0) || 0)),
    total: Math.max(0, Math.min(allowedContracts.length, Number(value.total || 0) || 0)),
    score: Math.max(0, Math.min(100, Number(value.score || 0) || 0)),
    active_contract: allowedContracts.includes(value.active_contract) ? value.active_contract : '',
    missing_contracts: list(value.missing_contracts).filter(name => allowedContracts.includes(name)),
    contracts,
  };
}

function referenceTiming(analysis = {}, clean, list) {
  return {
    progress: Math.max(0, Math.min(100, Number(analysis.progress || 0) || 0)),
    phase: clean(analysis.phase, 180),
    started_at: cleanTiming(analysis.started_at, clean),
    updated_at: cleanTiming(analysis.updated_at, clean),
    completed_at: cleanTiming(analysis.completed_at, clean),
    failed_at: cleanTiming(analysis.failed_at, clean),
    cancelled_at: cleanTiming(analysis.cancelled_at, clean),
    retry_after_ms: Math.max(0, Number(analysis.error?.retry_after_ms || 0) || 0),
    evidence_batch_progress: {
      total: Math.max(0, Number(analysis.evidence_batch_progress?.total || 0) || 0),
      completed: Math.max(0, Number(analysis.evidence_batch_progress?.completed || 0) || 0),
      remaining: Math.max(0, Number(analysis.evidence_batch_progress?.remaining || 0) || 0),
      failed: Math.max(0, Number(analysis.evidence_batch_progress?.failed || 0) || 0),
    },
    semantic_contract_progress: semanticContractProgress(analysis.semantic_contract_progress, clean, list),
    checkpoints: list(analysis.checkpoints).slice(-12).map(item => ({
      phase: clean(item?.phase, 180),
      progress: Math.max(0, Math.min(100, Number(item?.progress || 0) || 0)),
      at: cleanTiming(item?.at || item?.created_at, clean),
    })),
  };
}

module.exports = { generationTiming, referenceTiming, semanticContractProgress };
