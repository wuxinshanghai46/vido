const { Client } = require('ssh2');

const host = process.env.VIDO_DEPLOY_HOST;
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD;
const port = Math.max(1, Number(process.env.VIDO_DEPLOY_PORT || 22) || 22);
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const requestedTaskId = String(process.env.VIDO_TASK_ID || '').trim();
if (!host || !password) throw new Error('Missing server connection environment variables');

const client = new Client();
const exec = command => new Promise((resolve, reject) => client.exec(command, (error, stream) => {
  if (error) return reject(error);
  let stdout = '';
  let stderr = '';
  stream.on('data', chunk => { stdout += chunk; });
  stream.stderr.on('data', chunk => { stderr += chunk; });
  stream.on('close', code => code === 0 ? resolve({ stdout: stdout.trim(), stderr: stderr.trim() }) : reject(new Error(stderr || stdout || `exit ${code}`)));
}));

client.on('ready', async () => {
  try {
    const inspectScript = String.raw`
      const storage = require('./src/services/newStoryAd/storageService');
      const db = storage.readDb();
      const active = db.tasks.filter(task => task.active_generation_id || ['queued', 'running'].includes(String(task.status || '').toLowerCase()));
      const requestedTaskId = ${JSON.stringify(requestedTaskId)};
      const recent = requestedTaskId
        ? db.tasks.filter(task => String(task.id) === requestedTaskId)
        : db.tasks.slice().sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, 12);
      const selected = [...new Map([...active, ...recent].map(task => [String(task.id), task])).values()];
      const result = selected.map(task => {
        const outputs = db.outputs.filter(row => String(row.task_id) === String(task.id));
        const keyframes = outputs.find(row => row.kind === 'keyframes')?.payload || [];
        const storyboard = outputs.find(row => row.kind === 'storyboard_table')?.payload || [];
        const calls = db.model_calls.filter(row => String(row.task_id) === String(task.id)).slice(-30);
        const stages = db.stages.filter(row => String(row.task_id) === String(task.id));
        const sceneAssets = outputs.find(row => row.kind === 'scene_assets')?.payload || [];
        return {
          task: {
            id: task.id, user_id: task.user_id, title: task.title, status: task.status, stage: task.stage,
            active_stage: task.active_stage, active_generation_id: task.active_generation_id,
            generation_queued_at: task.generation_queued_at, generation_started_at: task.generation_started_at,
            created_at: task.created_at, updated_at: task.updated_at, error: task.error, error_code: task.error_code,
          },
          keyframes: {
            total: Array.isArray(keyframes) ? keyframes.length : 0,
            completed: Array.isArray(keyframes) ? keyframes.filter(item => item && (item.image_url || item.imageUrl || item.url)).length : 0,
            items: Array.isArray(keyframes) ? keyframes.map((item, index) => ({ index: item?.index || item?.shot_index || index + 1, has_image: !!(item?.image_url || item?.imageUrl || item?.url), error: item?.error || '', provider_used: item?.provider_used || '', created_at: item?.created_at || '' })) : [],
          },
          scene_assets: Array.isArray(sceneAssets) ? sceneAssets.map(asset => ({
            scene_id: asset?.scene_id || asset?.id || '',
            scene_revision: asset?.scene_revision || 1,
            created_at: asset?.created_at || '',
            updated_at: asset?.updated_at || '',
            provider_used: asset?.provider_used || '',
            full_space_lock: asset?.scene_contract?.full_space_lock === true,
            verification_state: asset?.scene_contract?.verification?.state || '',
            verification_reasons: asset?.scene_contract?.verification?.reasons || [],
            requirement_qa: asset?.scene_contract?.requirement_qa || asset?.requirement_qa || null,
            spatial_coverage_qa: asset?.scene_contract?.spatial_coverage_qa || null,
            repair_plan: asset?.repair_plan || null,
            repair_history: asset?.repair_history || [],
            views: Array.isArray(asset?.view_images) ? asset.view_images.map(view => ({
              key: view?.key || '',
              url: view?.url || view?.image_url || '',
              source_url: view?.source_url || '',
              filename: view?.filename || '',
              provider_used: view?.provider_used || '',
            })) : [],
          })) : [],
          storyboard: requestedTaskId && Array.isArray(storyboard) ? storyboard.map((shot, index) => ({
            index: shot?.index || index + 1,
            title: shot?.title || '',
            purpose: shot?.purpose || shot?.role || '',
            visual: shot?.visual || '',
            action: shot?.action || '',
            voiceover: shot?.voiceover || shot?.narration || '',
          })) : { total: Array.isArray(storyboard) ? storyboard.length : 0 },
          reviews: requestedTaskId ? db.reviews.filter(row => String(row.task_id) === String(task.id)).map(row => ({ stage: row.stage, review: row.review, updated_at: row.updated_at })) : [],
          stages: requestedTaskId ? stages.map(row => ({ stage: row.stage, status: row.status, error: row.error || '', updated_at: row.updated_at })) : stages,
          model_calls: requestedTaskId ? calls.slice(-10).map(row => ({ stage: row.stage, provider_id: row.provider_id, model_id: row.model_id, status: row.status, error_code: row.error_code, created_at: row.created_at })) : calls,
        };
      });
      console.log(JSON.stringify({ now: new Date().toISOString(), active_count: active.length, tasks: result }, null, 2));
    `;
    const encoded = Buffer.from(inspectScript).toString('base64');
    const state = await exec(`cd '${remoteRoot}' && node -e "eval(Buffer.from('${encoded}','base64').toString())"`);
    const logs = await exec("pm2 logs vido --nostream --lines 500 2>&1 | grep -Ei 'new-story-ad|keyframe|image failure|timeout|USER_CANCELLED|gpt-image|gemini|provider' | tail -n 180 || true");
    console.log('=== ACTIVE STATE ===');
    console.log(state.stdout);
    if (state.stderr) console.error(state.stderr);
    console.log('=== RECENT LOGS ===');
    console.log(logs.stdout);
    client.end();
  } catch (error) {
    console.error(error.message || error);
    client.end();
    process.exitCode = 1;
  }
}).on('error', error => {
  console.error(error.message || error);
  process.exitCode = 1;
}).connect({ host, port, username, password, readyTimeout: 25000 });
