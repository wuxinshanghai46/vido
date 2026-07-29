const pipeline = require('./pipelineModelService');

function parseCombinedSelection(value = '') {
  const text = String(value || '').trim();
  if (!text || text === 'auto') return null;
  if (!text.includes('::')) return { provider_id: text, model_id: '' };
  const [providerId, ...modelParts] = text.split('::');
  return {
    provider_id: String(providerId || '').trim(),
    model_id: String(modelParts.join('::') || '').trim(),
  };
}

function resolveStageSelection(stageId, {
  combined = '',
  providerId = '',
  modelId = '',
} = {}) {
  const explicitProvider = String(providerId || '').trim();
  const explicitModel = String(modelId || '').trim();
  if (explicitProvider && explicitModel) {
    return {
      provider_id: explicitProvider,
      model_id: explicitModel,
      source: 'business_input',
      stage_id: stageId,
    };
  }

  const parsed = parseCombinedSelection(combined);
  if (parsed?.provider_id && parsed?.model_id) {
    return {
      ...parsed,
      source: 'business_input',
      stage_id: stageId,
    };
  }

  const configured = pipeline.pickModelWithDefault(stageId);
  if (!configured?.provider_id || !configured?.model_id) return null;
  return {
    provider_id: configured.provider_id,
    model_id: configured.model_id,
    source: pipeline.pickModel(stageId) ? 'pipeline_config' : 'pipeline_default',
    stage_id: stageId,
  };
}

function serializeSelection(selection) {
  if (!selection?.provider_id || !selection?.model_id) return '';
  return `${selection.provider_id}::${selection.model_id}`;
}

module.exports = {
  parseCombinedSelection,
  resolveStageSelection,
  serializeSelection,
};
