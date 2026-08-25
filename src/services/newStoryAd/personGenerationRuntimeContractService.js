'use strict';

const dossier = require('./personDossierCompiler');
const mediaAdapterDefault = require('./mediaAdapter');

function routeKey(model = {}) {
  return `${String(model.provider_id || model.providerId || '').trim()}/${String(model.model_id || model.model || '').trim()}`;
}

function inspect(options = {}, deps = {}) {
  const mediaAdapter = deps.mediaAdapter || mediaAdapterDefault;
  const stages = Object.values(dossier.PERSON_DOSSIER_STAGES);
  const stageRoutes = stages.map(stage => {
    try { return mediaAdapter.availableImageCandidates(stage).map(routeKey).filter(Boolean); } catch { return []; }
  });
  const commonRoutes = stageRoutes.length ? stageRoutes.reduce((common, routes) => common.filter(route => routes.includes(route)), stageRoutes[0]) : [];
  const specs = [...dossier.CATEGORY_SPECS, ...dossier.NATIVE_MASTER_SPECS];
  const lookCount = Math.max(1, Number(options.look_count || options.lookCount || 1) || 1);
  const callsPerLook = specs.length;
  const assetsPerLook = dossier.EXPECTED_ATOMIC_COUNT + dossier.NATIVE_MASTER_SPECS.length;
  const modelId = mediaAdapter.requiredImageModelForStage(dossier.PERSON_DOSSIER_STAGES.atlas) || 'gpt-image-2';
  return {
    schema_version: 'person-generation-runtime-v1',
    workflow: 'complete_person_dossier', workflow_label: '完整人物档案',
    model_id: modelId, model_label: modelId === 'gpt-image-2' ? 'GPT Image 2' : modelId,
    aspect_ratios: [...new Set(specs.map(spec => String(spec.aspectRatio || '')).filter(Boolean))],
    provider_calls_per_look: callsPerLook, expected_assets_per_look: assetsPerLook,
    look_count: lookCount, estimated_provider_calls: callsPerLook * lookCount,
    expected_output_assets: assetsPerLook * lookCount,
    available_route_count: commonRoutes.length, ready: commonRoutes.length > 0,
    adjustable: false,
  };
}

module.exports = { inspect, routeKey };
