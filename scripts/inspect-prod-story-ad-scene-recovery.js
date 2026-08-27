const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');

const taskId = String(process.argv[2] || '').trim();
if (!/^[a-f0-9-]{36}$/i.test(taskId)) {
  console.error('Usage: node scripts/inspect-prod-story-ad-scene-recovery.js <task-id>');
  process.exit(2);
}

const remoteScript = String.raw`
  const storage = require('./src/services/newStoryAd/storageService');
  const publication = require('./src/services/newStoryAd/assetPlanPublicationService');
  const assetPlan = require('./src/services/newStoryAd/assetPlanService');
  const projectBundle = require('./src/services/storyAdWorkspace/projectBundleService');
  const taskId = ${JSON.stringify(taskId)};
  const task = storage.getTask(taskId) || {};
  if (!task.id) {
    console.log(JSON.stringify({ found: false, task_id: taskId }, null, 2));
    process.exit(0);
  }
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const active = storage.getOutput(taskId, 'asset_plan_active') || {};
  const fingerprint = assetPlan.fingerprint(task, context);
  const eligibility = publication.eligibility(taskId, { fingerprint });
  const bundle = projectBundle.buildProjectBundle(taskId, {
    sections: 'summary,assets',
    user: { role: 'admin' },
  });
  const formalSceneAssets = storage.getOutput(taskId, 'scene_assets') || [];
  const calls = storage.listModelCalls(taskId)
    .filter(call => String(call.stage || '').includes('scene_'))
    .map(call => ({
      id: call.id || '', stage: call.stage || '', provider_id: call.provider_id || '',
      model_id: call.model_id || '', status: call.status || '', error_code: call.error_code || '',
      error_message: String(call.error_message || call.error || '').slice(0, 300),
      provider_status: call.provider_status || '', provider_request_id: call.provider_request_id || '',
      platform_request_id: call.platform_request_id || '',
      provider_submission_state: call.provider_submission_state || '', billing_state: call.billing_state || '',
      duration_ms: Number(call.duration_ms || call.latency_ms || 0) || 0, created_at: call.created_at || '', updated_at: call.updated_at || '',
    }));
  const runs = storage.listGenerationRuns({ task_id: taskId }).map(run => ({
    id: run.id || '', state: run.state || '', stage: run.stage || '',
    target_permanent_id: run.target_permanent_id || '', target_id: run.target_id || '',
    error_code: run.error_code || '', error: String(run.error || '').slice(0, 240),
    started_at: run.started_at || '', finished_at: run.finished_at || '', updated_at: run.updated_at || '',
  }));
  const checkpoints = storage.listOutputsByKindPrefixes(taskId, ['scene_asset_checkpoint:']).map(row => ({
    kind: row.kind || '', updated_at: row.updated_at || '',
    payload: {
      status: row.payload?.status || '', scene_id: row.payload?.scene_id || '',
      last_error_code: row.payload?.last_error_code || '',
      views: Object.fromEntries(Object.entries(row.payload?.views || {}).map(([key, view]) => [key, {
        status: view.status || '', error_code: view.error_code || '',
        error: String(view.error || view.message || '').slice(0, 240),
        provider_id: view.provider_id || '', model_id: view.model_id || '',
        provider_status: view.provider_status || '',
        platform_request_id: view.platform_request_id || view.submission_id || '',
        provider_request_id: view.provider_request_id || '', provider_task_id: view.provider_task_id || '',
        provider_submission_state: view.provider_submission_state || '', billing_state: view.billing_state || '',
        duration_ms: Number(view.duration_ms || 0) || 0, updated_at: view.updated_at || '',
      }])) ,
    },
  }));
  console.log(JSON.stringify({
    found: true,
    task: {
      id: task.id, status: task.status, stage: task.stage, required_bundle_id: task.required_bundle_id,
      content_revision: task.content_revision, active_generation_id: task.active_generation_id,
      active_target_generations: task.active_target_generations, generation_progress: task.generation_progress,
      updated_at: task.updated_at,
    },
    active_plan: {
      plan_id: active.plan_id || '', producer_bundle_id: active.plan?.release_envelope?.producer_bundle_id || '',
      content_revision: active.plan?.content_revision || 0, fingerprint: active.plan?.fingerprint || '',
      domain_state: active.plan?.domain_state || {}, publication_scope: active.plan?.publication_scope || '',
      activated_at: active.plan?.activated_at || '',
    },
    eligibility,
    project: bundle.project,
    navigation_eligibility: bundle.navigation?.asset_plan_eligibility || {},
    formal_scene_assets: formalSceneAssets.map(scene => ({
      id: scene.id || scene.scene_id || '', view_count: Array.isArray(scene.view_images) ? scene.view_images.length : 0,
      repair_plan: scene.repair_plan || {}, scene_revision: scene.scene_revision || scene.revision || 0,
    })),
    scenes: (bundle.assets?.scenes || []).map(scene => ({
      id: scene.id || scene.scene_id || '', name: scene.name || '', repair_plan: scene.repair_plan || {},
      qa: scene.qa || {}, verification: scene.verification || {},
      checkpoint_error_code: scene.checkpoint_error_code || '', failed_view_keys: scene.failed_view_keys || [],
      view_statuses: scene.view_statuses || {}, view_count: scene.view_count || 0,
    })),
    runs, calls, checkpoints,
  }, null, 2));
`;

const encoded = Buffer.from(remoteScript).toString('base64');
const client = new Client();
client.on('ready', () => {
  client.exec(`cd /opt/vido/current && node -e "eval(Buffer.from('${encoded}','base64').toString())"`, (error, stream) => {
    if (error) throw error;
    stream.on('data', chunk => process.stdout.write(chunk));
    stream.stderr.on('data', chunk => process.stderr.write(chunk));
    stream.on('close', code => {
      client.end();
      process.exitCode = code || 0;
    });
  });
}).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect(connectionOptions());
