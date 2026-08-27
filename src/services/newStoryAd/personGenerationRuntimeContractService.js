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
  const settings = options.generation_settings || options.generationSettings || {};
  const plan = dossier.generationPlan(settings);
  const specs = [...plan.categorySpecs, ...plan.nativeMasterSpecs];
  const lookCount = Math.max(1, Number(options.look_count || options.lookCount || 1) || 1);
  const callsPerLook = specs.length;
  const assetsPerLook = plan.expectedAtomicCount + plan.nativeMasterSpecs.length;
  const modelId = mediaAdapter.requiredImageModelForStage(dossier.PERSON_DOSSIER_STAGES.atlas) || 'gpt-image-2';
  return {
    schema_version: 'person-generation-runtime-v2',
    workflow: plan.generationType,
    workflow_label: ({ three_view: '3视图', four_view: '4视图', global_dossier: '全局整图' })[plan.generationType],
    model_id: modelId, model_label: modelId === 'gpt-image-2' ? 'GPT Image 2' : modelId,
    aspect_ratios: [...new Set(specs.map(spec => String(spec.aspectRatio || '')).filter(Boolean))],
    provider_calls_per_look: callsPerLook, expected_assets_per_look: assetsPerLook,
    look_count: lookCount, estimated_provider_calls: callsPerLook * lookCount,
    expected_output_assets: assetsPerLook * lookCount,
    available_route_count: commonRoutes.length, ready: commonRoutes.length > 0,
    generation_type: plan.generationType,
    supported_generation_types: ['three_view', 'four_view', 'global_dossier'],
    supported_qualities: ['low', 'standard', 'high'],
    supported_resolutions: ['1K', '2K'],
    count: 1,
    adjustable: true,
  };
}

module.exports = { inspect, routeKey };
