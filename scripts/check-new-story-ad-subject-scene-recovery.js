const { Client } = require('ssh2');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD;
const taskId = process.env.VIDO_REPAIR_TASK_ID || '';
const supportId = process.env.VIDO_SUPPORT_ID || '';
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const client = new Client();

if (!password) throw new Error('VIDO_DEPLOY_PASSWORD is required');
if (!taskId) throw new Error('VIDO_REPAIR_TASK_ID is required');
if (supportId && !/^[A-Za-z0-9_-]{1,120}$/.test(supportId)) throw new Error('VIDO_SUPPORT_ID is invalid');

const remoteScript = `
const storage = require('./src/services/newStoryAd/storageService');
const storyAdService = require('./src/services/newStoryAd/storyAdService');
const sceneCheckpointProjection = require('./src/services/newStoryAd/sceneCheckpointProjectionService');
const blueprintQuality = require('./src/services/newStoryAd/blueprintQualityService');
const sqlite = require('./src/db/sqlite');
const taskId = ${JSON.stringify(taskId)};
const supportId = ${JSON.stringify(supportId)};
const supportMatches = supportId ? (storage.readDb().tasks || []).flatMap(candidate => {
  const outputs = storage.listOutputs(candidate.id);
  const matchedOutputs = outputs.filter(row => JSON.stringify(row).includes(supportId));
  const taskMatched = JSON.stringify(candidate).includes(supportId);
  if (!taskMatched && !matchedOutputs.length) return [];
  return [{
    task: {
      id: candidate.id,
      user_id: candidate.user_id || '',
      status: candidate.status || '',
      stage: candidate.stage || '',
      active_stage: candidate.active_stage || '',
      active_generation_id: candidate.active_generation_id || '',
      error_code: candidate.error_code || '',
      support_id: candidate.support_id || '',
      error: candidate.error || '',
      created_at: candidate.created_at || '',
      updated_at: candidate.updated_at || '',
    },
    outputs: matchedOutputs.map(row => ({
      kind: row.kind || '',
      status: row.payload?.status || '',
      error: row.payload?.error || '',
      diagnostics: row.payload?.diagnostics || null,
      updated_at: row.updated_at || '',
    })),
  }];
}) : [];
const task = storage.getTask(taskId);
const context = storage.getOutput(taskId, 'context') || task?.request || {};
const sceneConfig = storage.getOutput(taskId, 'scene_config') || context.scene_config || {};
const generatedLogoPattern = /(?:logo|标志|商标|品牌字样).{0,18}(?:生成|形成|汇聚|变形|浮现|拼成|长出)|(?:生成|形成|汇聚|变形|浮现|拼成|长出).{0,18}(?:logo|标志|商标|品牌字样)/ig;
const rightsPreflightBySpace = (Array.isArray(sceneConfig?.spaces) ? sceneConfig.spaces : []).map(space => {
  const spec = space.scene_spec || space.sceneSpec || {};
  const visibleText = [
    context.brief,
    context.product_subject,
    space.description,
    spec.layoutText,
    spec.layout_text,
    spec.materialLightText,
    spec.material_light_text,
    spec.interactionText,
    spec.interaction_text,
    spec.negativeText,
    spec.negative_text,
  ].map(value => String(value || '').trim().slice(0, 1600)).filter(Boolean).join('\\n');
  const matches = Array.from(visibleText.matchAll(generatedLogoPattern)).map(match => ({
    match: match[0],
    offset: match.index,
    context: visibleText.slice(Math.max(0, match.index - 80), Math.min(visibleText.length, match.index + match[0].length + 80)),
  }));
  const assessment = blueprintQuality.assessBlueprintRights({
    story_title: 'scene asset preflight',
    logline: visibleText,
    beats: [{ visual: visibleText }],
  });
  return {
    id: space.id || space.space_id || '',
    name: space.name || '',
    description: space.description || '',
    scene_spec: spec,
    visible_text: visibleText,
    generated_logo_matches: matches,
    assessment,
  };
});
const profiles = Array.isArray(context.cast_profiles) ? context.cast_profiles : [];
const checkpoints = storage.listOutputs(taskId)
  .filter(row => String(row.kind || '').startsWith('scene_asset_checkpoint:'))
  .map(row => ({
    kind: row.kind,
    status: row.payload?.status,
    succeeded: Object.values(row.payload?.views || {}).filter(view => view?.status === 'succeeded').map(view => view.key),
    last_error_code: row.payload?.last_error_code || '',
  }));
const bundle = storage.getTaskBundle(taskId, { diagnostics: true });
const directProjectedSceneAssets = sceneCheckpointProjection.projectSceneAssets(bundle.outputs || []);
const database = sqlite.openDatabase();
const expectedSceneAssetsId = taskId + ':scene_assets';
const exactSceneAssetsRecord = database.prepare(
  'SELECT id, project_id, length(id) AS id_length, hex(id) AS id_hex, payload_json FROM content_records WHERE collection = ? AND id = ?'
).get('new_story_ad_outputs', expectedSceneAssetsId);
const prefixedOutputRecords = database.prepare(
  'SELECT id, project_id, length(id) AS id_length, hex(id) AS id_hex FROM content_records WHERE collection = ? AND substr(id, 1, ?) = ? ORDER BY id'
).all('new_story_ad_outputs', expectedSceneAssetsId.length - 'scene_assets'.length, taskId + ':');
const personAsset = context.person_asset || {};
const castAssets = Array.isArray(personAsset.cast_assets) ? personAsset.cast_assets : [];
const petProfiles = Array.isArray(context.pet_profiles) ? context.pet_profiles : [];
const personContract = context.person_contract || personAsset.person_contract || storage.getOutput(taskId, 'person_contract') || {};
const subjectCheckpoints = storage.listOutputs(taskId)
  .filter(row => String(row.kind || '').startsWith('subject_asset_checkpoint:'))
  .map(row => ({
    kind: row.kind,
    status: row.payload?.status,
    human_count: Array.isArray(row.payload?.humans) ? row.payload.humans.length : 0,
    pet_count: Array.isArray(row.payload?.pets) ? row.payload.pets.length : 0,
    error_code: row.payload?.error_code || '',
    updated_at: row.payload?.updated_at || '',
    humans: (Array.isArray(row.payload?.humans) ? row.payload.humans : []).map(asset => ({
      id: asset.actor_id || asset.id || '',
      name: asset.name || '',
      wardrobe: asset.subject_profile?.wardrobeText || '',
      description: asset.description || '',
      contract_status: asset.person_contract?.status || '',
      qa_pass: asset.person_contract?.cross_view_qa?.pass === true,
      qa_scores: {
        identity: asset.person_contract?.cross_view_qa?.identity_score,
        age: asset.person_contract?.cross_view_qa?.age_score,
        wardrobe: asset.person_contract?.cross_view_qa?.wardrobe_score,
        body: asset.person_contract?.cross_view_qa?.body_score,
      },
      mismatch_reasons: asset.person_contract?.cross_view_qa?.mismatch_reasons || [],
      qa_unavailable: asset.person_contract?.qa_unavailable === true,
      verification_error_code: asset.person_contract?.verification_error_code || '',
    })),
    pets: (Array.isArray(row.payload?.pets) ? row.payload.pets : []).map(asset => ({
      id: asset.pet_id || asset.id || '',
      name: asset.name || '',
      view_count: Array.isArray(asset.view_images) ? asset.view_images.length : 0,
      reference_count: Array.isArray(asset.reference_images) ? asset.reference_images.length : 0,
      contract_status: asset.pet_contract?.status || '',
    })),
  }));
const sceneAssets = storage.getOutput(taskId, 'scene_assets') || context.scene_assets || [];
const sceneAssetsRecord = storage.listOutputs(taskId).find(row => String(row.kind || '') === 'scene_assets') || null;
const projectedSceneAssets = storyAdService.publicTaskBundle(taskId).outputs?.scene_assets || [];
console.log(JSON.stringify({
  support_matches: supportMatches,
  status: task?.status,
  stage: task?.stage,
  active_generation_id: task?.active_generation_id || '',
  generation_progress: task?.generation_progress || null,
  spaces: (sceneConfig.spaces || []).map(space => ({ id: space.id || space.space_id, name: space.name })),
  rights_preflight_by_space: rightsPreflightBySpace,
  cast_profiles: profiles.map(profile => ({
    id: profile.id || profile.actor_id || '',
    name: profile.displayName || profile.name,
    appearance: profile.appearanceText,
    wardrobe: profile.wardrobeText,
    hair: profile.hairMakeupText,
  })),
  cast_assets: castAssets.map(asset => ({
    id: asset.actor_id || asset.id || '',
    name: asset.name || asset.cast_role || '',
    image_url: asset.image_url || '',
    wardrobe: asset.subject_profile?.wardrobeText || '',
    contract_status: asset.person_contract?.status || '',
    qa_pass: asset.person_contract?.cross_view_qa?.pass === true,
    qa_scores: {
      identity: asset.person_contract?.cross_view_qa?.identity_score,
      age: asset.person_contract?.cross_view_qa?.age_score,
      wardrobe: asset.person_contract?.cross_view_qa?.wardrobe_score,
      body: asset.person_contract?.cross_view_qa?.body_score,
    },
    mismatch_reasons: asset.person_contract?.cross_view_qa?.mismatch_reasons || [],
    qa_unavailable: asset.person_contract?.qa_unavailable === true,
    verification_error_code: asset.person_contract?.verification_error_code || '',
  })),
  pet_profiles: petProfiles.map(asset => ({
    id: asset.pet_id || asset.id || '',
    name: asset.name || '',
    image_url: asset.image_url || '',
    view_count: Array.isArray(asset.view_images) ? asset.view_images.length : 0,
    reference_count: Array.isArray(asset.reference_images) ? asset.reference_images.length : 0,
    contract_status: asset.pet_contract?.status || '',
  })),
  person_contract: {
    status: personContract.status || '',
    verification_state: personContract.verification?.state || '',
    expected_people: personContract.expected_people,
    verified_members: personContract.cross_view_qa?.verified_members,
    expected_members: personContract.cross_view_qa?.expected_members,
    mismatch_reasons: personContract.cross_view_qa?.mismatch_reasons || [],
    members: (personContract.member_contracts || []).map(member => ({
      person_id: member?.person_id || '',
      status: member?.status || '',
      qa_pass: member?.cross_view_qa?.pass === true,
      qa_scores: {
        identity: member?.cross_view_qa?.identity_score,
        age: member?.cross_view_qa?.age_score,
        wardrobe: member?.cross_view_qa?.wardrobe_score,
        body: member?.cross_view_qa?.body_score,
      },
      mismatch_reasons: member?.cross_view_qa?.mismatch_reasons || [],
      qa_unavailable: member?.qa_unavailable === true,
      verification_error_code: member?.verification_error_code || '',
    })),
  },
  subject_checkpoints: subjectCheckpoints,
  scene_assets: (Array.isArray(sceneAssets) ? sceneAssets : []).map(asset => ({
    id: asset.id || asset.scene_id || '',
    space_id: asset.space_id || asset.scene_id || '',
    name: asset.name || '',
    image_url: asset.image_url || '',
    view_count: Array.isArray(asset.view_images) ? asset.view_images.length : 0,
    verification_status: asset.verification_status || asset.scene_contract?.status || '',
    verification: asset.scene_contract?.verification || asset.verification || null,
    qa_unavailable: asset.scene_contract?.qa_unavailable === true,
    qa_error_code: asset.scene_contract?.qa_error_code || '',
    compatibility_status: asset.scene_contract?.compatibility_status || '',
    spatial_coverage_status: asset.scene_contract?.spatial_coverage_qa?.coverage_status || '',
    spatial_coverage_legacy: asset.scene_contract?.spatial_coverage_qa?.legacy === true,
    full_space_lock: asset.scene_contract?.full_space_lock === true,
    repair_action: asset.repair_plan?.action || '',
    schema_version: asset.scene_contract?.schema_version || 0,
    generation_contract_version: asset.generation_contract_version || asset.scene_contract?.generation_contract_version || 0,
    partial_checkpoint: asset.partial_checkpoint === true,
    completed_view_keys: Array.isArray(asset.completed_view_keys) ? asset.completed_view_keys : [],
    failed_view_keys: Array.isArray(asset.failed_view_keys) ? asset.failed_view_keys : [],
  })),
  scene_assets_updated_at: sceneAssetsRecord?.updated_at || '',
  projected_scene_assets: (Array.isArray(projectedSceneAssets) ? projectedSceneAssets : []).map(asset => ({
    id: asset.id || asset.scene_id || '',
    space_id: asset.space_id || asset.scene_id || '',
    name: asset.name || '',
    image_url: asset.image_url || '',
    view_count: Array.isArray(asset.view_images) ? asset.view_images.length : 0,
    verification_status: asset.verification_status || asset.scene_contract?.status || '',
    partial_checkpoint: asset.partial_checkpoint === true,
    failed_view_keys: Array.isArray(asset.failed_view_keys) ? asset.failed_view_keys : [],
    billing_state: asset.billing_state || '',
  })),
  direct_projected_scene_assets: (Array.isArray(directProjectedSceneAssets) ? directProjectedSceneAssets : []).map(asset => ({
    id: asset.id || asset.scene_id || '',
    space_id: asset.space_id || asset.scene_id || '',
    partial_checkpoint: asset.partial_checkpoint === true,
    view_count: Array.isArray(asset.view_images) ? asset.view_images.length : 0,
  })),
  raw_scene_asset_rows: (bundle.outputs || [])
    .filter(row => String(row.kind || '') === 'scene_assets')
    .map(row => ({
      count: Array.isArray(row.payload) ? row.payload.length : -1,
      ids: (Array.isArray(row.payload) ? row.payload : []).map(asset => asset.space_id || asset.scene_id || asset.id || ''),
    })),
  exact_scene_assets_record: exactSceneAssetsRecord ? {
    id: exactSceneAssetsRecord.id,
    project_id: exactSceneAssetsRecord.project_id,
    id_length: exactSceneAssetsRecord.id_length,
    id_hex: exactSceneAssetsRecord.id_hex,
    payload_keys: Object.keys(JSON.parse(exactSceneAssetsRecord.payload_json || '{}')),
    payload_task_id: JSON.parse(exactSceneAssetsRecord.payload_json || '{}').task_id || '',
  } : null,
  prefixed_output_records: prefixedOutputRecords,
  checkpoints,
  model_call_count: bundle.model_calls.length,
  recent_model_calls: bundle.model_calls.slice(-8).map(call => ({
    kind: call.kind || call.stage || call.operation || '',
    status: call.status || '',
    error_code: call.error_code || '',
    created_at: call.created_at || call.started_at || '',
  })),
  model_call_statuses: bundle.model_calls.reduce((out, call) => {
    out[call.status] = (out[call.status] || 0) + 1;
    return out;
  }, {}),
}));
`;
const encoded = Buffer.from(remoteScript, 'utf8').toString('base64');
const command = [
  `cd '${remoteRoot}'`,
  `node -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`,
  supportId
    ? `printf 'SUPPORT_LOG_MATCHES\\n'; (pm2 logs vido --nostream --lines 5000 2>&1 | grep -F -- '${supportId}' | tail -n 20) || true`
    : 'true',
  "pm2 jlist | node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d).find(x=>x.name==='vido');console.log(JSON.stringify({pm2_status:p?.pm2_env?.status,restarts:p?.pm2_env?.restart_time,pm_cwd:p?.pm2_env?.pm_cwd,pm_exec_path:p?.pm2_env?.pm_exec_path}))})\"",
  "curl -fsS -w '\\nHTTP:%{http_code}\\n' http://127.0.0.1:4600/api/health",
  "grep -q 'subject-gallery-state-v23' public/digital-human.html",
  "grep -q '\\[data-nsa-pet-field\\]\\[hidden\\]' public/css/digital-human-wizard.css",
  "grep -q \"delete normalizedPersonSpec.petType\" src/services/newStoryAd/contextBuilder.js",
  "grep -q 'projectLatestSubjectCheckpoint' src/services/newStoryAd/storyAdService.js",
  "grep -q '成片阶段后期叠加的已授权品牌素材' src/services/newStoryAd/blueprintQualityService.js",
  "grep -q 'localizeReasonsZh' src/services/newStoryAd/personIdentityContractService.js",
  "grep -q 'raw_mismatch_reasons' src/services/newStoryAd/personIdentityContractService.js",
  "grep -q 'verification-language.js' public/js/new-story-ad/bootstrap.js",
  "grep -q 'data-nsa-scene-plan-select' public/css/digital-human-wizard.css",
  "grep -q 'selectedSceneAssetIndex' public/js/new-story-ad/scene-assets.js",
  "grep -q 'SCENE_PLAN_REQUIRED_FOR_SCENE_SAVE' public/js/new-story-ad/task-persistence.js",
  "grep -q 'subject-profile-assist.js' public/js/new-story-ad/bootstrap.js",
  "grep -q 'ASSIST_SUBJECT_TARGET_INVALID' src/services/newStoryAd/storyAdService.js",
  "grep -q 'SCENE_PLAN_REQUIRED_FOR_GENERATION' src/services/newStoryAd/sceneBindingService.js",
  "grep -q 'addDraftSpace' public/js/new-story-ad/scene-assets.js",
  "grep -q 'identitySheetRealismPrompt' src/services/newStoryAd/subjectAssetBundleService.js",
  "grep -q 'activeBundleTasks' src/services/newStoryAd/subjectAssetBundleService.js",
  "grep -q 'PERSON_VERIFICATION_IN_PROGRESS' src/services/newStoryAd/subjectAssetBundleService.js",
  "grep -q 'reverifyPersonBundle' src/services/newStoryAd/storyAdService.js",
  "grep -q 'sceneOperationFailure' public/js/new-story-ad/scene-assets.js",
  "grep -q 'FOUR_VIEW_ASSIST_RULE_ZH' src/services/newStoryAd/subjectContinuityPolicyService.js",
  "grep -q 'subjectContinuityPolicy.assistRuleZh' src/services/newStoryAd/storyAdService.js",
  "grep -q 'subjectContinuityPolicy.generationRuleEn' src/services/newStoryAd/subjectAssetBundleService.js",
  "grep -q 'mergeAutosaveSceneAssets' src/services/newStoryAd/taskProgressSaveService.js",
  "grep -q 'taskProgressSave.mergeAutosaveSceneAssets' src/services/newStoryAd/storyAdService.js",
  "printf 'REMOTE_JS_FILE_SHA256=' && sha256sum public/js/new-story-ad-legacy-ui.js | awk '{print $1}'",
  "printf 'REMOTE_JS_HTTP_SHA256=' && curl -fsS http://127.0.0.1:4600/js/new-story-ad-legacy-ui.js | sha256sum | awk '{print $1}'",
  "grep -q 'subjectGalleryOpenKeys' public/js/new-story-ad-legacy-ui.js",
  "grep -q 'data-nsa-subject-gallery-key' public/js/new-story-ad/subject-assets-ui.js",
  "grep -q 'aria-expanded' public/js/new-story-ad/subject-assets-ui.js",
  "printf 'REMOTE_GALLERY_FILE_SHA256=' && sha256sum public/js/new-story-ad/subject-assets-ui.js | awk '{print $1}'",
  "printf 'REMOTE_GALLERY_HTTP_SHA256=' && curl -fsS http://127.0.0.1:4600/js/new-story-ad/subject-assets-ui.js | sha256sum | awk '{print $1}'",
  "curl -fsS http://127.0.0.1:4600/js/new-story-ad/verification-language.js | grep -q '不同视图中的鞋型'",
  "echo STATIC_CONTRACT_OK",
].join(' && ');

client.on('ready', () => {
  client.exec(command, (error, stream) => {
    if (error) throw error;
    stream.pipe(process.stdout);
    stream.stderr.pipe(process.stderr);
    stream.on('close', code => {
      client.end();
      process.exitCode = code || 0;
    });
  });
}).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect({ host, port: 22, username, password, readyTimeout: 25000 });
