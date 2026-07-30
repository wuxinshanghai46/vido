const { v4: uuidv4 } = require('uuid');
const mediaAdapterDefault = require('./mediaAdapter');
const checkpointServiceDefault = require('./assetGenerationCheckpointService');
const concurrencyDefault = require('./generationConcurrencyService');

const PERSON_DOSSIER_SCHEMA_VERSION = 2;
const BODY_VIEWS = ['front', 'three_quarter', 'side', 'back'];
const IDENTITY_VIEWS = ['face_front', 'face_three_quarter', 'face_profile', 'hair_back'];
const EXPRESSIONS = ['neutral', 'natural_smile', 'focused', 'doubtful', 'surprised', 'relaxed_approved'];
const BASE_ACTIONS = ['neutral_stand', 'natural_walk', 'present_product'];

const CATEGORY_SPECS = [
  {
    kind: 'body',
    keys: BODY_VIEWS,
    columns: 2,
    rows: 2,
    aspectRatio: '1:1',
    outputWidth: 768,
    outputHeight: 1024,
    instruction: 'Four full-body casting views: front, three-quarter, side, back. Complete shoes visible.',
  },
  {
    kind: 'identity',
    keys: IDENTITY_VIEWS,
    columns: 2,
    rows: 2,
    aspectRatio: '1:1',
    outputWidth: 1024,
    outputHeight: 1024,
    instruction: 'Four identity close-ups: face front, face three-quarter, face profile, hair and head from back.',
  },
  {
    kind: 'expression',
    keys: EXPRESSIONS,
    columns: 3,
    rows: 2,
    aspectRatio: '3:2',
    outputWidth: 768,
    outputHeight: 768,
    instruction: 'Six head-and-shoulders expressions: neutral, natural smile, focused, doubtful, surprised, relaxed approval.',
  },
  {
    kind: 'action',
    keys: BASE_ACTIONS,
    columns: 3,
    rows: 1,
    aspectRatio: '3:1',
    outputWidth: 768,
    outputHeight: 1024,
    instruction: 'Three full-body actions: neutral standing, natural walking, presenting a generic product-sized object with clear hands.',
  },
];

function categoryPrompt(spec, personPrompt = '') {
  return [
    'Create one clean production contact sheet for a single reusable commercial actor.',
    `LAYOUT IS MANDATORY: exactly ${spec.columns} columns x ${spec.rows} rows, exactly ${spec.keys.length} equal cells.`,
    `Cell order left-to-right, top-to-bottom: ${spec.keys.join(', ')}.`,
    spec.instruction,
    personPrompt ? `Actor contract: ${personPrompt}` : '',
    'All cells must preserve the exact same face identity, apparent age, body proportions, hairstyle, garments, shoes and accessories.',
    'Use the same plain light-gray casting studio in every cell. No scene, logo, caption, border label or watermark.',
    'Do not merge cells. Do not add extra people. Keep hands and body anatomy realistic.',
  ].filter(Boolean).join('\n');
}

function checkpointIdentity({ taskId, assetId, revision, spec, anchorUrl, personPrompt }) {
  return {
    taskId,
    assetType: 'person_dossier',
    assetId,
    unit: spec.kind,
    revision,
    input: {
      schema_version: PERSON_DOSSIER_SCHEMA_VERSION,
      keys: spec.keys,
      anchor_url: anchorUrl,
      person_prompt: personPrompt,
    },
  };
}

function atomicFromView(view, kind) {
  return {
    id: `${kind}_${view.key}_${uuidv4().slice(0, 8)}`,
    kind,
    key: view.key,
    image_url: view.image_url || view.url,
    filename: view.filename || '',
    provider_used: view.provider_used || '',
    strict_reference_required: true,
    input_fidelity: 'high',
    source_atlas_kind: kind,
    locally_split: true,
  };
}

async function generateCategory({
  taskId,
  assetId,
  revision,
  anchorUrl,
  personPrompt,
  requireReferences,
  spec,
  loadCheckpoint,
  saveCheckpoint,
  onEvent,
  mediaAdapter,
  checkpointService,
}) {
  const identity = checkpointIdentity({ taskId, assetId, revision, spec, anchorUrl, personPrompt });
  return checkpointService.runCheckpointedUnit({
    identity,
    load: loadCheckpoint,
    save: saveCheckpoint,
    onEvent,
    execute: async controls => {
      const atlas = await mediaAdapter.generateActorReference({
        taskId,
        stage: 'new_story_ad.person_dossier_atlas',
        prompt: categoryPrompt(spec, personPrompt),
        filename: `person_${taskId}_${assetId}_${spec.kind}_atlas_r${revision}`,
        aspectRatio: spec.aspectRatio,
        referenceImages: anchorUrl ? [anchorUrl] : [],
        requireReferences,
        inputFidelity: 'high',
        clientRequestId: identity.key || checkpointService.checkpointKey(identity),
        onSubmitting: controls.onSubmitting,
        onSubmitted: controls.onSubmitted,
      });
      const splitSheet = mediaAdapter.splitReferenceSheet || mediaAdapter.splitActorSheet;
      if (typeof splitSheet !== 'function') throw new Error('人物档案图集缺少本地拆分适配器');
      const views = await splitSheet({
        source: atlas,
        filenamePrefix: `person_${taskId}_${assetId}_${spec.kind}`,
        filenameSuffix: `r${revision}`,
        viewKeys: spec.keys,
        columns: spec.columns,
        rows: spec.rows,
        outputWidth: spec.outputWidth,
        outputHeight: spec.outputHeight,
        fit: 'contain',
        background: { r: 242, g: 244, b: 247, alpha: 1 },
      });
      return {
        kind: spec.kind,
        keys: spec.keys,
        atlas: {
          image_url: atlas.image_url || atlas.url,
          filename: atlas.filename || '',
          provider_used: atlas.provider_used || '',
          grid: { columns: spec.columns, rows: spec.rows },
        },
        atomic_assets: views.map(view => atomicFromView(view, spec.kind)),
      };
    },
  });
}

async function compilePersonDossier(options = {}, deps = {}) {
  const {
    taskId = '',
    assetId = 'primary',
    revision = 1,
    anchorUrl = '',
    personPrompt = '',
    requireReferences = Boolean(anchorUrl),
    loadCheckpoint = async () => null,
    saveCheckpoint = async () => {},
    onEvent = null,
    onProgress = null,
    concurrency = Number(process.env.NEW_STORY_AD_PERSON_DOSSIER_CONCURRENCY) || 2,
  } = options;
  if (!taskId) throw new Error('compilePersonDossier requires taskId');
  if (requireReferences && !anchorUrl) {
    const error = new Error('严格人物档案缺少身份锚点');
    error.code = 'PERSON_DOSSIER_ANCHOR_REQUIRED';
    throw error;
  }
  const mediaAdapter = deps.mediaAdapter || mediaAdapterDefault;
  const checkpointService = deps.checkpointService || checkpointServiceDefault;
  const concurrencyService = deps.concurrencyService || concurrencyDefault;
  let completed = 0;
  const generated = await concurrencyService.map(
    'new_story_ad.person_dossier',
    CATEGORY_SPECS,
    concurrency,
    async spec => {
      const row = await generateCategory({
        taskId,
        assetId,
        revision,
        anchorUrl,
        personPrompt,
        requireReferences,
        spec,
        loadCheckpoint,
        saveCheckpoint,
        onEvent,
        mediaAdapter,
        checkpointService,
      });
      completed += 1;
      if (onProgress) await onProgress({
        completed,
        total: CATEGORY_SPECS.length,
        kind: spec.kind,
        reused: row.reused,
      });
      return row;
    },
  );
  const categories = generated.map(item => item.result);
  const atomicAssets = categories.flatMap(item => item.atomic_assets);
  if (atomicAssets.length !== 17) {
    const error = new Error(`人物档案原子资产不完整：期望17项，实际${atomicAssets.length}项`);
    error.code = 'PERSON_DOSSIER_ATOMIC_COUNT_INVALID';
    throw error;
  }
  return {
    schema_version: PERSON_DOSSIER_SCHEMA_VERSION,
    category_atlases: categories.map(item => item.atlas),
    categories,
    atomic_assets: atomicAssets,
    body_views: atomicAssets.filter(item => item.kind === 'body'),
    identity_views: atomicAssets.filter(item => item.kind === 'identity'),
    expressions: atomicAssets.filter(item => item.kind === 'expression'),
    base_actions: atomicAssets.filter(item => item.kind === 'action'),
    generation_summary: {
      planned_provider_calls: 4,
      category_count: categories.length,
      atomic_count: atomicAssets.length,
      checkpoint_hits: generated.filter(item => item.reused).length,
      provider_calls_this_run: generated.filter(item => !item.reused).length,
    },
  };
}

module.exports = {
  PERSON_DOSSIER_SCHEMA_VERSION,
  BODY_VIEWS,
  IDENTITY_VIEWS,
  EXPRESSIONS,
  BASE_ACTIONS,
  CATEGORY_SPECS,
  categoryPrompt,
  compilePersonDossier,
};
