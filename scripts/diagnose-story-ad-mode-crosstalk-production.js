const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');

const taskId = String(process.argv[2] || '').trim();
if (!/^[a-f0-9-]{36}$/i.test(taskId)) {
  console.error('Usage: node scripts/diagnose-story-ad-mode-crosstalk-production.js <task-id>');
  process.exit(2);
}

const remoteScript = String.raw`
  const storage = require('./src/services/newStoryAd/storageService');
  const assetPlan = require('./src/services/newStoryAd/assetPlanService');
  const storyAd = require('./src/services/newStoryAd/storyAdService');
  const jobs = require('./src/services/newStoryAd/jobService');
  const taskId = ${JSON.stringify(taskId)};
  const task = storage.getTask(taskId);
  const bundle = storage.getTaskBundle(taskId, { diagnostics: true });
  const context = storage.getOutput(taskId, 'context') || task?.request || {};
  const checkpoint = storage.getOutput(taskId, 'asset_plan_draft_checkpoint');
  const recovery = storage.getOutput(taskId, 'asset_plan_missing_sections_recovery');
  const assetPlanOutput = storage.getOutput(taskId, 'asset_plan');
  const sceneConfig = storage.getOutput(taskId, 'scene_config');
  const snapshots = (storage.readDb().snapshots || [])
    .filter(row => String(row.task_id || '') === taskId)
    .sort((a, b) => Number(a.content_revision || 0) - Number(b.content_revision || 0));
  const previousBrief = String(snapshots.at(-2)?.payload?.brief || '');
  const currentBrief = String(snapshots.at(-1)?.payload?.brief || '');
  let firstBriefDiff = -1;
  for (let index = 0; index < Math.max(previousBrief.length, currentBrief.length); index += 1) {
    if (previousBrief[index] !== currentBrief[index]) { firstBriefDiff = index; break; }
  }
  const payload = checkpoint?.payload || {};
  const scenePlan = payload.scene_plan || payload.scenePlan || payload.scene_config || payload.sceneConfig || {};
  const props = Array.isArray(payload.prop_plan || payload.propPlan) ? (payload.prop_plan || payload.propPlan) : [];
  const calls = (bundle.model_calls || []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  console.log(JSON.stringify({
    task: task ? {
      id: task.id,
      status: task.status,
      stage: task.stage,
      support_id: task.support_id,
      retryable: task.retryable,
      content_revision: task.content_revision,
      updated_at: task.updated_at,
      active_generation_id: task.active_generation_id || '',
    } : null,
    deployed_budget_policy: {
      default_ms: storyAd.sceneConfigStageBudgetMs(taskId),
      forced_replan_ms: storyAd.sceneConfigStageBudgetMs(taskId, { replan_scene_coverage: true }),
      deadline_recovery: jobs.deadlineRecoveryState(taskId, 'scene_config'),
      model_call_count: calls.length,
    },
    context: {
      content_mode: context.content_mode,
      product_presentation_mode: context.product_presentation?.mode || '',
      product_subject: context.product_subject || '',
      advertised_subject_contract_subject: context.advertised_subject_contract?.subject || '',
      expected_people: context.expected_people,
      cast_mode: context.cast_mode,
      brief_length: String(context.brief || '').length,
      brief_sha256: require('crypto').createHash('sha256').update(String(context.brief || '')).digest('hex'),
    },
    current_fingerprint: assetPlan.fingerprint(task || {}, context),
    checkpoint: checkpoint ? {
      status: checkpoint.status,
      fingerprint: checkpoint.fingerprint,
      content_mode: checkpoint.content_mode,
      reusable: checkpoint.reusable,
      valid_sections: checkpoint.valid_sections,
      missing_sections: checkpoint.missing_sections,
      created_at: checkpoint.created_at,
      updated_at: checkpoint.updated_at,
      payload_keys: Object.keys(payload),
      cast_count: Array.isArray(payload.cast_profiles || payload.castProfiles) ? (payload.cast_profiles || payload.castProfiles).length : -1,
      prop_count: props.length,
      advertised_prop_count: props.filter(item => String(item?.type || '').toLowerCase() === 'advertised_product').length,
      space_count: Array.isArray(scenePlan.spaces) ? scenePlan.spaces.length : -1,
      advertised_subject: scenePlan.advertised_subject || '',
      story_seed_keys: Object.keys(payload.story_seed || payload.storySeed || {}),
      unified_model_meta: checkpoint.unified_model_meta || null,
    } : null,
    current_asset_plan: assetPlanOutput ? {
      story_seed: assetPlanOutput.story_seed || {},
      scene_plan: {
        scene_mode: assetPlanOutput.scene_plan?.scene_mode || '',
        story_strategy: assetPlanOutput.scene_plan?.story_strategy || [],
        spaces: (assetPlanOutput.scene_plan?.spaces || []).map(space => ({
          id: space.id || space.scene_id || '',
          name: space.name || '',
          description: space.description || '',
          story_purpose: space.story_purpose || '',
          story_states: space.scene_spec?.storyStates || [],
        })),
      },
    } : null,
    current_scene_config: sceneConfig ? {
      scene_mode: sceneConfig.scene_mode || '',
      space_count: Array.isArray(sceneConfig.spaces) ? sceneConfig.spaces.length : 0,
      space_ids: (sceneConfig.spaces || []).map(space => space.id || space.scene_id || ''),
    } : null,
    recovery,
    snapshots: snapshots.slice(-6).map(row => ({
      id: row.id,
      content_revision: row.content_revision,
      status: row.status,
      input_fingerprint: row.input_fingerprint,
      created_at: row.created_at,
      updated_at: row.updated_at,
      context: {
        content_mode: row.payload?.content_mode || '',
        production_mode: row.payload?.production_mode || '',
        output_size: row.payload?.output_size || '',
        video_resolution: row.payload?.video_resolution || '',
        brief_length: String(row.payload?.brief || '').length,
        brief_sha256: require('crypto').createHash('sha256').update(String(row.payload?.brief || '')).digest('hex'),
        benchmark_user_edited: row.payload?.benchmark_strategy?.user_edited,
        creative_direction: row.payload?.creative_direction || '',
        performance: row.payload?.performance || '',
      },
      asset_plan_fingerprint: assetPlan.fingerprint(task || {}, row.payload || {}),
    })),
    latest_brief_diff: {
      first_index: firstBriefDiff,
      previous_excerpt: firstBriefDiff >= 0 ? previousBrief.slice(Math.max(0, firstBriefDiff - 30), firstBriefDiff + 60) : '',
      current_excerpt: firstBriefDiff >= 0 ? currentBrief.slice(Math.max(0, firstBriefDiff - 30), firstBriefDiff + 60) : '',
    },
    recent_calls: calls.slice(-12).map(call => ({
      stage: call.stage,
      provider_id: call.provider_id,
      model_id: call.model_id,
      status: call.status,
      error_code: call.error_code,
      error_message: call.error_message || '',
      provider_reason: call.provider_reason || '',
      latency_ms: call.latency_ms,
      created_at: call.created_at,
    })),
    scene_stage: (bundle.stages || []).find(row => row.stage === 'scene_config') || null,
  }, null, 2));
`;

const encoded = Buffer.from(remoteScript, 'utf8').toString('base64');
const client = new Client();
client.on('ready', () => {
  client.exec(`cd /opt/vido/app && node -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`, (error, stream) => {
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
