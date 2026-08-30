'use strict';

const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const port = Number(process.env.VIDO_DEPLOY_PORT || 2222);
const username = process.env.VIDO_DEPLOY_USER || 'root';
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/current';
const taskId = String(process.argv[2] || '').trim();

if (!taskId) throw new Error('Usage: node scripts/audit-story-ad-target-storyboard-remote.js <task-id>');

function remoteAuditSource(id) {
  return String.raw`
const storage = require('./src/services/newStoryAd/storageService');
const references = require('./src/services/newStoryAd/referenceSelectionService');
const personIdentity = require('./src/services/newStoryAd/personIdentityContractService');
const productIdentity = require('./src/services/newStoryAd/productIdentityContractService');
const sceneBinding = require('./src/services/newStoryAd/sceneBindingService');
const scenePlanningAuthority = require('./src/services/newStoryAd/scenePlanningAuthorityService');
const imageGate = require('./src/services/storyAdWorkspace/storyboardImageConfirmationGateService');
const id = ${JSON.stringify(id)};
const rows = value => Array.isArray(value) ? value : [];
const clean = value => String(value ?? '').trim();
const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row?.[key]]).filter(([, value]) => value !== undefined));
const task = storage.getTask(id);
const shots = rows(storage.getOutput(id, 'storyboard_table'));
const contracts = rows(storage.getOutput(id, 'keyframe_contracts'));
const keyframes = rows(storage.getOutput(id, 'keyframes'));
const sketches = rows(storage.getOutput(id, 'storyboard_sketches'));
const images = rows(storage.getOutput(id, 'storyboard_images'));
const flow = storage.getOutput(id, 'story_flow_contract') || {};
const rawSceneAssets = rows(storage.getOutput(id, 'scene_assets'));
const sceneConfig = storage.getOutput(id, 'scene_config') || {};
const sceneWorldOverrides = storage.getOutput(id, 'scene_world_overrides') || {};
const baseContext = storage.getOutput(id, 'context') || task?.request || {};
const sceneAssets = scenePlanningAuthority.enrichSceneAssets(rawSceneAssets, sceneConfig, baseContext, sceneWorldOverrides);
const context = { ...baseContext, scene_assets: sceneAssets };
const runs = storage.listGenerationRuns({ task_id: id });
const calls = storage.listModelCalls(id);
const byShot = value => new Map(rows(value).map((row, index) => [Number(row.shot_index ?? index + 1), row]));
const contractsByShot = byShot(contracts), keyframesByShot = byShot(keyframes), sketchesByShot = byShot(sketches), imagesByShot = byShot(images);
const report = {
  schema_version: 2,
  read_only: true,
  source: 'production_ssh',
  task: task ? pick(task, ['id', 'status', 'current_stage', 'active_generation_id', 'generation_progress', 'updated_at']) : null,
  counts: { shots: shots.length, contracts: contracts.length, keyframes: keyframes.length, sketches: sketches.length, images: images.length, scene_assets: sceneAssets.length, runs: runs.length, model_calls: calls.length },
  image_gate: imageGate.inspect(id),
  flow: { version: flow.version || flow.contract_version || '', fingerprint: flow.fingerprint || flow.contract_fingerprint || '', units: rows(flow.units).map(unit => pick(unit, ['unit_id', 'scene_id', 'scene_name', 'story_beat_ids', 'transition_reason'])) },
  scenes: sceneAssets.map(scene => ({
    ...pick(scene, ['id', 'scene_id', 'name', 'title', 'scene_name', 'prompt_fingerprint', 'scene_planning_fingerprint', 'assignment_revision']),
    planning: scene.planning_contract ? pick(scene.planning_contract, ['version', 'actor_blocking_required', 'experience_narrative', 'selected_camera_id']) : null,
    urls: Object.fromEntries(Object.entries(scene).filter(([key, value]) => /url|image/i.test(key) && typeof value === 'string' && value).slice(0, 20)),
  })),
  shots: shots.map((shot, index) => {
    const shotIndex = Number(shot.shot_index ?? index + 1);
    const contract = contractsByShot.get(shotIndex) || {};
    const frame = keyframesByShot.get(shotIndex) || {};
    const sketch = sketchesByShot.get(shotIndex) || {};
    const image = imagesByShot.get(shotIndex) || {};
    const sceneId = clean(contract.scene_lock?.scene_id || shot.scene_id || shot.scene_asset_id);
    const scene = sceneAssets.find(item => [item.id, item.scene_id].map(clean).includes(sceneId)) || {};
    const wantedView = clean(contract.scene_lock?.scene_view || shot.scene_view || 'master');
    const sceneViews = rows(scene.view_images);
    const sceneView = sceneViews.find(item => clean(item.key || item.view || item.view_id) === wantedView)
      || sceneViews.find(item => clean(item.key || item.view || item.view_id) === 'master') || sceneViews[0] || {};
    const sceneReference = sceneView.image_url || sceneView.url || scene.image_url || '';
    const includePerson = personIdentity.shotPersonRequired(context, shot, contract) && !personIdentity.shotForbidsPerson(context, shot);
    const includeProduct = productIdentity.shotProductRequired(context, shot, contract);
    const layoutReference = sceneBinding.completeSpaceLock(scene) ? sceneBinding.layoutSceneReference(scene)?.url : '';
    const referenceCandidates = references.keyframeReferenceCandidates(context, { sceneReference, shot, includePerson, includeProduct, layoutReference });
    return {
      shot_index: shotIndex,
      shot: pick(shot, ['title', 'visual', 'visual_description', 'action', 'purpose', 'shot_size', 'camera_angle', 'camera_movement', 'lens_mm', 'composition', 'subject_position', 'subject_type', 'expected_people', 'characters', 'scene_id', 'scene_name', 'scene_view', 'camera_id', 'scene_zone_id', 'scene_zone_ids', 'scene_zone_label', 'scene_anchor_ids', 'story_beat_id', 'story_beat_ids', 'contract_fingerprint', 'shot_fingerprint', 'content_fingerprint']),
      contract: pick(contract, ['scene_id', 'scene_name', 'contract_fingerprint', 'shot_fingerprint', 'content_fingerprint', 'prompt_fingerprint']),
      scene_reference: sceneReference,
      reference_candidates: referenceCandidates.slice(0, 8).map(item => pick(item, ['role', 'url', 'priority', 'required'])),
      keyframe: pick(frame, ['scene_id', 'scene_name', 'url', 'image_url', 'contract_fingerprint', 'shot_fingerprint', 'content_fingerprint', 'prompt_fingerprint', 'generation_id']),
      sketch: pick(sketch, ['scene_id', 'scene_name', 'url', 'image_url', 'contract_fingerprint', 'shot_fingerprint', 'content_fingerprint', 'prompt_fingerprint', 'generation_id']),
      image: { keys: Object.keys(image), ...pick(image, ['scene_id', 'scene_name', 'url', 'image_url', 'lineage_schema_version', 'contract_fingerprint', 'shot_contract_fingerprint', 'scene_planning_fingerprint', 'story_context_fingerprint', 'content_fingerprint', 'prompt_fingerprint', 'generation_id', 'reference_count', 'source_content_revision', 'updated_at']) },
    };
  }),
  storyboard_runs: runs.filter(run => /storyboard/i.test(clean(run.stage || run.target_stage || run.domain || run.target_type))).sort((a, b) => clean(a.created_at).localeCompare(clean(b.created_at))).slice(-20).map(run => pick(run, ['id', 'state', 'status', 'stage', 'target_stage', 'domain', 'target_type', 'shot_index', 'created_at', 'started_at', 'completed_at', 'updated_at'])),
  storyboard_calls: calls.filter(call => /storyboard/i.test(clean(call.stage))).sort((a, b) => clean(a.created_at).localeCompare(clean(b.created_at))).slice(-20).map(call => pick(call, ['id', 'stage', 'shot_index', 'status', 'billing_state', 'provider_submission_state', 'provider_id', 'model_id', 'generation_id', 'created_at', 'updated_at'])),
};
console.log(JSON.stringify(report));
`;
}

function quote(value) { return `'${String(value).replace(/'/g, `'"'"'`)}'`; }

function buildRemoteCommand(id) {
  const encoded = Buffer.from(remoteAuditSource(id), 'utf8').toString('base64');
  const evaluation = `eval(Buffer.from('${encoded}','base64').toString('utf8'))`;
  return `cd ${quote(remoteRoot)} && node scripts/run-with-pm2-env.js vido node -e ${quote(evaluation)}`;
}

const client = new Client();
client.on('ready', () => {
  client.exec(buildRemoteCommand(taskId), (error, stream) => {
    if (error) { client.end(); throw error; }
    let stdout = '', stderr = '';
    stream.on('data', chunk => { stdout += chunk; });
    stream.stderr.on('data', chunk => { stderr += chunk; });
    stream.on('close', code => {
      client.end();
      if (code !== 0) throw new Error(stderr.trim() || `Remote audit exited ${code}`);
      const report = JSON.parse(stdout.trim());
      if (report.read_only !== true || report.source !== 'production_ssh') throw new Error('INVALID_REMOTE_AUDIT_EVIDENCE');
      console.log(JSON.stringify(report, null, 2));
    });
  });
}).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect(connectionOptions({ host, port, username }));

module.exports = { buildRemoteCommand, remoteAuditSource };
