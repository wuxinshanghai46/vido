const fs = require('fs');
const path = require('path');
const pipeline = require('./pipelineModelService');
const capability = require('./modelCapabilityService');
const { loadSettings } = require('./settingsService');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SOURCE_ROOTS = ['src', 'public/js'];
const SKIP_FILES = new Set([
  path.normalize('src/services/pipelineModelService.js'),
  path.normalize('src/services/pipelineCapabilityAuditService.js'),
]);

function walk(relativeDir) {
  const absoluteDir = path.join(PROJECT_ROOT, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap(entry => {
    const relativePath = path.join(relativeDir, entry.name);
    return entry.isDirectory() ? walk(relativePath) : [relativePath];
  });
}

function sourceFiles() {
  return SOURCE_ROOTS
    .flatMap(walk)
    .filter(file => /\.(?:js|mjs|cjs)$/i.test(file))
    .filter(file => !SKIP_FILES.has(path.normalize(file)));
}

function providerModelLookup() {
  const settings = loadSettings();
  const lookup = new Map();
  for (const provider of settings.providers || []) {
    for (const model of provider.models || []) {
      lookup.set(`${provider.id}/${model.id}`.toLowerCase(), {
        ...model,
        provider_id: provider.id,
        model_id: model.id,
        provider_enabled: provider.enabled !== false,
      });
    }
  }
  return lookup;
}

function explicitCapabilityKeys(model = {}) {
  const explicit = model.capabilities || model.capability_flags || {};
  if (Array.isArray(explicit)) return [...new Set(explicit.map(String).filter(Boolean))];
  if (!explicit || typeof explicit !== 'object') return [];
  return Object.keys(explicit).filter(key => explicit[key] === true);
}

function verifiedCapabilityKeys(model = {}) {
  const verification = model.capability_verification || model.capability_verifications || {};
  if (!verification || typeof verification !== 'object') return [];
  return Object.entries(verification)
    .filter(([, value]) => value === true || value?.status === 'verified')
    .map(([key]) => key);
}

function flattenStages() {
  return Object.entries(pipeline.listSchema()).flatMap(([group, stages]) =>
    stages.map(stage => ({ ...stage, group })));
}

function auditPipelineCapabilities() {
  const files = sourceFiles();
  const contents = new Map(files.map(file => [file, fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8')]));
  const modelLookup = providerModelLookup();
  const rows = flattenStages().map(stage => {
    const references = files.filter(file => contents.get(file).includes(stage.id));
    const configured = pipeline.pickAllEnabledWithDefault(stage.id).map(model => {
      const settingsModel = modelLookup.get(`${model.provider_id}/${model.model_id}`.toLowerCase()) || {};
      const merged = { ...settingsModel, ...model };
      const report = capability.modelCapabilityReport(merged);
      return {
        provider_id: model.provider_id,
        model_id: model.model_id,
        source: pipeline.pickAllEnabled(stage.id).some(item =>
          item.provider_id === model.provider_id && item.model_id === model.model_id)
          ? 'pipeline_config'
          : 'pipeline_default',
        inferred_capabilities: Object.keys(report.capabilities).filter(key => report.capabilities[key] === true),
        explicit_capabilities: explicitCapabilityKeys(merged),
        verified_capabilities: verifiedCapabilityKeys(merged),
      };
    });
    return {
      group: stage.group,
      stage_id: stage.id,
      name: stage.name,
      type: stage.type,
      enabled_model_count: configured.length,
      configured_models: configured,
      business_reference_count: references.length,
      business_reference_files: references,
      connection_status: references.length
        ? 'configured_and_statically_referenced'
        : 'configured_but_not_statically_referenced',
    };
  });
  const allConfiguredModels = rows.flatMap(row => row.configured_models);
  return {
    generated_at: new Date().toISOString(),
    scope: 'read_only_static_audit',
    summary: {
      group_count: Object.keys(pipeline.listSchema()).length,
      stage_count: rows.length,
      referenced_stage_count: rows.filter(row => row.business_reference_count > 0).length,
      unreferenced_stage_count: rows.filter(row => row.business_reference_count === 0).length,
      stages_without_enabled_model: rows.filter(row => row.enabled_model_count === 0).length,
      explicit_capability_assignment_count: allConfiguredModels.reduce((sum, model) => sum + model.explicit_capabilities.length, 0),
      verified_capability_assignment_count: allConfiguredModels.reduce((sum, model) => sum + model.verified_capabilities.length, 0),
    },
    advanced_chain_findings: [
      {
        capability: 'new_story_ad_first_frame',
        business_need: true,
        business_input: 'approved keyframe',
        adapter_parameter: 'image_url',
        provider_parameter: 'content[].role=first_frame',
        status: 'connected',
      },
      {
        capability: 'new_story_ad_reference_images',
        business_need: true,
        business_input: 'verified person and scene assets',
        adapter_parameter: 'reference_image_urls',
        provider_parameter: 'content[].role=reference_image',
        status: 'connected',
      },
      {
        capability: 'new_story_ad_camera_motion',
        business_need: true,
        business_input: 'shot.camera_movement / shot.camera / shot.action',
        adapter_parameter: 'compiled prompt',
        provider_parameter: 'structured content text',
        status: 'connected_as_prompt_not_native_control',
      },
      {
        capability: 'new_story_ad_last_frame',
        business_need: false,
        business_input: '',
        adapter_parameter: '',
        provider_parameter: '',
        status: 'not_required_current_flow',
      },
      {
        capability: 'new_story_ad_motion_reference_video',
        business_need: false,
        business_input: 'reference video analysis produces semantic camera/action guidance only',
        adapter_parameter: '',
        provider_parameter: '',
        status: 'not_required_current_flow',
      },
      {
        capability: 'new_story_ad_native_audio',
        business_need: false,
        business_input: 'separate TTS and deterministic audio mux',
        adapter_parameter: '',
        provider_parameter: 'generate_audio=false',
        status: 'intentionally_disabled_to_avoid_double_audio_and_billing',
      },
    ],
    stages: rows,
  };
}

module.exports = {
  auditPipelineCapabilities,
  explicitCapabilityKeys,
  verifiedCapabilityKeys,
};
