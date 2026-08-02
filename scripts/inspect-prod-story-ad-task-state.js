const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');

const taskId = String(process.argv[2] || '').trim();
if (!/^[a-f0-9-]{36}$/i.test(taskId)) {
  console.error('Usage: node scripts/inspect-prod-story-ad-task-state.js <task-id>');
  process.exit(2);
}

const remoteScript = String.raw`
  const storage = require('./src/services/newStoryAd/storageService');
  const taskId = ${JSON.stringify(taskId)};
  const task = storage.getTask(taskId);
  if (!task) {
    console.log(JSON.stringify({ found: false, task_id: taskId }, null, 2));
    process.exit(0);
  }
  const shots = storage.getOutput(taskId, 'storyboard_table') || [];
  const sketches = storage.getOutput(taskId, 'storyboard_sketches') || [];
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || [];
  const review = storage.getOutput(taskId, 'quality_review') || {};
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const blueprint = storage.getOutput(taskId, 'blueprint') || {};
  const { bindShotsToScenes } = require('./src/services/newStoryAd/sceneBindingService');
  const reboundShots = bindShotsToScenes(shots, sceneAssets);
  const calls = storage.getTaskBundle(taskId, { diagnostics: true }).model_calls || [];
  console.log(JSON.stringify({
    found: true,
    task_id: taskId,
    support_id: task.support_id || '',
    status: task.status || '',
    stage: task.stage || '',
    active_stage: task.active_stage || '',
    active_generation_id: task.active_generation_id || '',
    generation_queued_at: task.generation_queued_at || '',
    generation_started_at: task.generation_started_at || '',
    generation_finished_at: task.generation_finished_at || '',
    updated_at: task.updated_at || '',
    generation_progress: task.generation_progress || null,
    storyboard_shots: shots.length,
    context_characters: (context.characters || []).map(item => item.name || '').filter(Boolean),
    blueprint_characters: (blueprint.characters || []).map(item => item.name || '').filter(Boolean),
    rebound_zone_ids: reboundShots.map(item => item.zone_ids || []),
    storyboard_contracts: shots.map(item => ({
      shot_index: item.shot_index || item.index,
      role: item.role || '',
      purpose: item.purpose || '',
      scene_id: item.scene_id || '',
      zone_ids: item.zone_ids || [],
      story_visual: item.story_visual || '',
      promo_visual: item.promo_visual || '',
      visual: item.visual || '',
      action: item.action || '',
      keyframe_notes: item.keyframe_notes || '',
      keyframe_notes_length: String(item.keyframe_notes || '').length,
    })),
    scene_assets: sceneAssets.map(scene => ({
      scene_id: scene.scene_id || scene.id || '',
      title: scene.title || scene.name || '',
      zone_ids: (scene.scene_contract?.zones || scene.zones || scene.spatial_zones || []).map(zone => zone.zone_id || zone.id || '').filter(Boolean),
      zones: (scene.scene_contract?.zones || []).map(zone => ({ id: zone.id || '', visible_in_views: zone.visible_in_views || [] })),
      views: (scene.view_images || []).map(view => view.key || view.view || ''),
    })),
    quality_review: {
      passed: review.passed,
      blocking_issues: review.blocking_issues || [],
      rewrite_issues: review.rewrite_issues || [],
    },
    sketches: sketches.map(item => ({
      shot_index: item.shot_index,
      status: item.status,
      has_image: Boolean(item.image_url),
      updated_at: item.updated_at || '',
    })),
    recent_model_calls: calls.slice(-12).map(call => ({
      stage: call.stage || '',
      provider_id: call.provider_id || '',
      model_id: call.model_id || '',
      status: call.status || '',
      created_at: call.created_at || '',
      updated_at: call.updated_at || '',
      error_code: call.error_code || '',
    })),
  }, null, 2));
`;

const encoded = Buffer.from(remoteScript).toString('base64');
const client = new Client();
client.on('ready', () => {
  client.exec(`cd /opt/vido/app && node -e "eval(Buffer.from('${encoded}','base64').toString())"`, (error, stream) => {
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
