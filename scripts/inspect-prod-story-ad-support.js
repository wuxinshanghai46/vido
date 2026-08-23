const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');

const supportId = String(process.argv[2] || '').trim();
if (!/^[a-f0-9-]{16,160}$/i.test(supportId)) {
  console.error('Usage: node scripts/inspect-prod-story-ad-support.js <support-id>');
  process.exit(2);
}

const remoteScript = String.raw`
  const storage = require('./src/services/newStoryAd/storageService');
  const assetPlan = require('./src/services/newStoryAd/assetPlanService');
  const publication = require('./src/services/newStoryAd/assetPlanPublicationService');
  const supportId = ${JSON.stringify(supportId)};
  const run = storage.getGenerationRun(supportId)
    || storage.listGenerationRuns({}).find(row => String(row.orchestration_job_id || '') === supportId);
  const task = (run?.task_id ? storage.getTask(run.task_id) : null) || storage.listTasks({ limit: 5000 }).find(row =>
    String(row.support_id || '') === supportId
    || String(row.generation_progress?.support_id || '') === supportId
    || String(row.generation_progress?.generation_id || '') === supportId
  );
  if (!task) {
    const candidates = storage.listTasks({ limit: 5000 })
      .filter(row => /person_plan|asset_plan/i.test([row.stage, row.error, row.generation_progress?.stage, row.generation_progress?.message].filter(Boolean).join(' ')))
      .slice(0, 12)
      .map(row => ({
        id: row.id || '', support_id: row.support_id || '', stage: row.stage || '', status: row.status || '',
        error_code: row.error_code || '', updated_at: row.updated_at || '',
      }));
    console.log(JSON.stringify({ found: false, support_id: supportId, candidates }, null, 2));
    process.exit(0);
  }
  const context = storage.getOutput(task.id, 'context') || task.request || {};
  const active = storage.getOutput(task.id, 'asset_plan_active') || null;
  const candidate = storage.getOutput(task.id, 'asset_plan_candidate') || null;
  const compatibilityPlan = storage.getOutput(task.id, 'asset_plan') || null;
  const current = publication.currentPlan(task.id);
  const calls = storage.getTaskBundle(task.id, { diagnostics: true }).model_calls || [];
  const summarizePlan = plan => ({
    present: Boolean(plan),
    cast_count: Array.isArray(plan?.cast_profiles) ? plan.cast_profiles.length : 0,
    space_count: Array.isArray(plan?.scene_plan?.spaces) ? plan.scene_plan.spaces.length : 0,
    complete: Boolean(plan) && assetPlan.complete(plan, context),
    fingerprint: String(plan?.fingerprint || ''),
    source: String(plan?.source || ''),
  });
  console.log(JSON.stringify({
    found: true,
    support_id: supportId,
    task: {
      id: task.id, status: task.status, stage: task.stage,
      active_stage: task.active_stage || '', active_generation_id: task.active_generation_id || '',
      error_code: task.error_code || '', retryable: task.retryable === true,
      generation_progress: task.generation_progress || null,
      content_revision: task.content_revision || 0,
    },
    generation_run: run ? {
      id: run.id || '', task_id: run.task_id || '', stage: run.stage || '', state: run.state || '',
      error_code: run.error_code || '', billing_state: run.billing_state || '',
      provider_submission_state: run.provider_submission_state || '',
    } : null,
    context: {
      cast_count: Array.isArray(context.cast_profiles) ? context.cast_profiles.length : 0,
      cast_profiles: (context.cast_profiles || []).map(person => ({
        id: person.id || '', name: person.displayName || person.name || '',
        appearance_length: String(person.appearanceText || '').length,
        wardrobe_length: String(person.wardrobeText || '').length,
        hair_makeup_length: String(person.hairMakeupText || '').length,
        negative_length: String(person.negativeText || '').length,
        look_count: Array.isArray(person.look_profiles) ? person.look_profiles.length : 0,
      })),
      scene_count: Array.isArray(context.scene_plan?.spaces) ? context.scene_plan.spaces.length : 0,
      asset_plan_fingerprint: context.asset_plan_fingerprint || '',
    },
    plans: {
      current: summarizePlan(current),
      active: summarizePlan(active?.plan || active),
      candidate: summarizePlan(candidate?.plan || candidate),
      compatibility: summarizePlan(compatibilityPlan),
    },
    recent_model_calls: calls.slice(-8).map(call => ({
      stage: call.stage || '', provider_id: call.provider_id || '', model_id: call.model_id || '',
      status: call.status || '', error_code: call.error_code || '', billing_state: call.billing_state || '',
      provider_submission_state: call.provider_submission_state || '', created_at: call.created_at || '',
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
