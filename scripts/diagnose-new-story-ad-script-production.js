const { Client } = require('ssh2');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const port = Number(process.env.VIDO_DEPLOY_PORT || 22);
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD || '';
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const targetTaskId = process.env.VIDO_REPAIR_TASK_ID || '';

if (!password) throw new Error('VIDO_DEPLOY_PASSWORD is required');

function quote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function exec(client, command) {
  return new Promise((resolve, reject) => client.exec(command, (error, stream) => {
    if (error) return reject(error);
    let stdout = '';
    let stderr = '';
    stream.on('data', chunk => { stdout += chunk; });
    stream.stderr.on('data', chunk => { stderr += chunk; });
    stream.on('close', code => code === 0
      ? resolve(stdout)
      : reject(new Error(stderr || stdout || `remote diagnostic failed (${code})`)));
  }));
}

(async () => {
  const client = new Client();
  await new Promise((resolve, reject) => {
    client.on('ready', resolve).on('error', reject);
    client.connect({ host, port, username, password, readyTimeout: 25000 });
  });
  try {
    const probe = Buffer.from(`
      const storage = require('./src/services/newStoryAd/storageService');
      const preferredTaskId = ${JSON.stringify(targetTaskId)};
      const tasks = storage.listTasks({ limit: 500 })
        .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
      const candidates = preferredTaskId
        ? tasks.filter(task => String(task.id) === preferredTaskId)
        : tasks.slice(0, 12);
      const result = candidates.map(task => {
        const bundle = storage.getTaskBundle(task.id, { diagnostics: true });
        const stages = (bundle.stages || [])
          .sort((a, b) => String(a.updated_at || a.created_at || '').localeCompare(String(b.updated_at || b.created_at || '')))
          .slice(-12)
          .map(row => ({
            stage: row.stage,
            status: row.status,
            error: row.error || '',
            error_code: row.error_code || '',
            input_summary: row.input_summary || '',
            output_summary: row.output_summary || '',
            updated_at: row.updated_at || row.created_at || '',
          }));
        const modelCalls = (bundle.model_calls || [])
          .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
          .slice(-12)
          .map(call => ({
            stage: call.stage,
            status: call.status,
            error_code: call.error_code || '',
            error_message: call.error_message || '',
            provider_status: call.provider_status || '',
            provider_reason: call.provider_reason || '',
            latency_ms: call.latency_ms || 0,
            created_at: call.created_at || '',
          }));
        const kinds = (bundle.outputs || []).map(row => row.kind).filter(Boolean);
        const context = storage.getOutput(task.id, 'context') || {};
        const request = task.request || {};
        const storyboardCheckpoint = storage.getOutput(task.id, 'storyboard_checkpoint') || null;
        return {
          id: task.id,
          status: task.status,
          stage: task.stage || task.active_stage || '',
          error: task.error || '',
          error_code: task.error_code || '',
          retryable: task.retryable === true,
          content_revision: Number(task.content_revision || 0),
          active_generation_id: task.active_generation_id || '',
          active_generation_stage: task.active_generation_stage || '',
          updated_at: task.updated_at || '',
          has_scene_config: kinds.includes('scene_config'),
          has_scene_assets: kinds.includes('scene_assets'),
          has_blueprint: kinds.includes('blueprint'),
          has_storyboard: kinds.includes('storyboard'),
          storyboard_checkpoint: storyboardCheckpoint ? {
            phase: storyboardCheckpoint.phase || '',
            status: storyboardCheckpoint.status || '',
            expected_total: Number(storyboardCheckpoint.expected_total || 0),
            completed_count: Number(storyboardCheckpoint.completed_count || 0),
            shot_count: Array.isArray(storyboardCheckpoint.shots) ? storyboardCheckpoint.shots.length : 0,
            updated_at: storyboardCheckpoint.updated_at || '',
          } : null,
          recent_reviews: (bundle.reviews || []).slice(-6).map(row => ({
            stage: row.stage || '',
            pass: row.review?.pass,
            blocking_issues: row.review?.blocking_issues || [],
            rewrite_issues: row.review?.rewrite_issues || [],
            updated_at: row.updated_at || row.created_at || '',
          })),
          brand_overlay: context.brand_overlay || request.brand_overlay || null,
          stages,
          model_calls_total: (bundle.model_calls || []).length,
          model_calls: modelCalls,
        };
      });
      console.log(JSON.stringify({ active: tasks.filter(task => task.active_generation_id || ['queued', 'running'].includes(String(task.status || ''))).map(task => ({ id: task.id, status: task.status, stage: task.stage, generation_id: task.active_generation_id || '' })), candidates: result }, null, 2));
    `, 'utf8').toString('base64');
    const command = `cd ${quote(remoteRoot)} && node -e "eval(Buffer.from('${probe}','base64').toString('utf8'))"`;
    process.stdout.write(await exec(client, command));
  } finally {
    client.end();
  }
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
