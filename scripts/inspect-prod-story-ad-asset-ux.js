const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');

const taskId = String(process.argv[2] || '').trim();
if (!/^[a-f0-9-]{36}$/i.test(taskId)) {
  console.error('Usage: node scripts/inspect-prod-story-ad-asset-ux.js <task-id>');
  process.exit(2);
}

const remoteScript = String.raw`
  const storage = require('./src/services/newStoryAd/storageService');
  const bundleService = require('./src/services/storyAdWorkspace/projectBundleService');
  const publication = require('./src/services/newStoryAd/assetPlanPublicationService');
  const releaseBundle = require('./src/services/storyAdReleaseBundleService');
  const taskId = ${JSON.stringify(taskId)};
  const task = storage.getTask(taskId);
  if (!task) {
    console.log(JSON.stringify({ found: false, task_id: taskId }, null, 2));
    process.exit(0);
  }
  const rawContext = storage.getOutput(taskId, 'context') || task.request || {};
  const activePlan = publication.activeRecord(taskId);
  const generationEligibility = publication.eligibility(taskId, { fingerprint: activePlan?.fingerprint || '' });
  const peopleSource = rawContext.person_asset?.cast_assets || (rawContext.person_asset ? [rawContext.person_asset] : []);
  const bundle = bundleService.buildProjectBundle(taskId, { sections: 'assets,shots' });
  const generationRuns = storage.listGenerationRuns({ work_id: taskId }) || [];
  const modelCalls = storage.getTaskBundle(taskId, { diagnostics: true }).model_calls || [];
  const url = value => value?.image_url || value?.thumbnail_url || value?.url || '';
  console.log(JSON.stringify({
    found: true,
    task: { status: task.status, stage: task.stage, error_code: task.error_code || '' },
    generation_release: {
      current_bundle_id: releaseBundle.identity().bundle_id,
      task_required_bundle_id: task.required_bundle_id || '',
      active_plan_bundle_id: activePlan?.plan?.release_envelope?.producer_bundle_id || '',
      eligible: generationEligibility.eligible === true,
      issues: generationEligibility.issues || [],
      release_migration: generationEligibility.release_migration || null,
    },
    navigation: {
      brief_completed: bundle.navigation?.steps?.brief?.completed === true,
      asset_plan_eligible: bundle.navigation?.asset_plan_eligibility?.eligible === true,
      asset_plan_issues: bundle.navigation?.asset_plan_eligibility?.issues || [],
    },
    subject_generation: {
      runs: generationRuns.filter(run => /subject|person|visual/i.test(String(run.domain || run.stage || run.operation || '')))
        .map(run => ({ id: run.id, state: run.state, created_at: run.created_at || '' })),
      model_calls: modelCalls.filter(call => /subject|person|visual/i.test(String(call.stage || '')))
        .map(call => ({ stage: call.stage, status: call.status, created_at: call.created_at || '' })),
    },
    storyboard: {
      status: bundle.storyboard?.status || null,
      gate: bundle.storyboard?.sketch_gate || null,
      shots: bundle.storyboard?.shots?.length || 0,
      sketches: bundle.storyboard?.sketches?.length || 0,
    },
    projected_people: (bundle.assets?.people || []).map(person => ({
      id: person.id,
      dossier: person.dossier_sheet,
      views: (person.view_images || []).map(item => ({ key: item.key, label: item.label, url: item.image_url })),
      wardrobe: (person.wardrobe_details || []).map(item => ({ key: item.key, label: item.label, url: item.image_url })),
      accessories: (person.accessory_details || []).map(item => ({ key: item.key, label: item.label, url: item.image_url })),
    })),
    source_people: peopleSource.map(person => ({
      id: person.id || person.actor_asset_id || '',
      dossier: person.dossier_sheet || null,
      wardrobe: (person.wardrobe_details?.items || person.wardrobe_detail_items || []).map(item => ({ key: item.key, mode: item.detail_mode || '', url: url(item), source: item.source_asset_id || '' })),
      accessories: (person.accessory_details || []).map(item => ({ key: item.key, mode: item.detail_mode || '', url: url(item), source: item.source_asset_id || '' })),
    })),
    scenes: (bundle.assets?.scenes || []).map(scene => ({
      id: scene.id,
      layout_url: scene.layout?.image_url || '',
      views: (scene.view_images || []).map(item => ({ key: item.key, label: item.label, url: item.image_url })),
      cameras: (scene.cameras || []).map(item => ({ id: item.id, view_id: item.view_id, label: item.label, url: item.image_url || '', position: item.position || null, look_at: item.look_at || null })),
      camera_plan: scene.camera_plan || [],
    })),
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
