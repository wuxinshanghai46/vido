#!/usr/bin/env node

const { Client } = require('ssh2');

const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const port = Number(process.env.VIDO_DEPLOY_PORT || 2222);
const username = process.env.VIDO_DEPLOY_USER || 'root';
const password = process.env.VIDO_DEPLOY_PASSWORD || '';
const remoteRoot = process.env.VIDO_REMOTE_ROOT || '/opt/vido/app';
const taskId = String(process.env.VIDO_REPAIR_TASK_ID || '').trim();

if (!password) throw new Error('VIDO_DEPLOY_PASSWORD is required');
if (!taskId) throw new Error('VIDO_REPAIR_TASK_ID is required');

const remoteScript = `
process.env.DB_ENABLED = 'true';
process.env.DB_PATH = '/data/vido/db/vido.sqlite';
const storage = require('./src/services/newStoryAd/storageService');
const records = require('./src/repositories/contentRecordRepository');
const blueprint = require('./src/services/newStoryAd/blueprintService');
const revision = require('./src/services/newStoryAd/revisionService');
const taskId = ${JSON.stringify(taskId)};
const task = storage.getTask(taskId);
if (!task) throw new Error('TASK_NOT_FOUND');
const ctx = storage.getOutput(taskId, 'context') || task.request || {};
const checkpoint = storage.getOutput(taskId, 'blueprint_draft_checkpoint');
const rejection = storage.getOutput(taskId, 'blueprint_rejection_diagnostic');
const snapshots = records.list('new_story_ad_snapshots', { project_id: taskId })
  .filter(row => String(row.task_id || '') === taskId)
  .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
  .slice(-6)
  .map(row => ({
    id: row.id,
    content_revision: Number(row.content_revision || 0),
    status: row.status || '',
    created_at: row.created_at || '',
    payload: {
      shot_count: Number(row.payload?.shot_count || 0),
      brand_overlay: row.payload?.brand_overlay || null,
      brief_length: String(row.payload?.brief || '').length,
      brief_end: String(row.payload?.brief || '').slice(-500),
      creative_direction_length: String(row.payload?.creative_direction?.raw || '').length,
    },
  }));
const rawSnapshots = records.list('new_story_ad_snapshots', { project_id: taskId })
  .filter(row => String(row.task_id || '') === taskId)
  .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
const revisionPairs = rawSnapshots.slice(-6).slice(1).map((row, index) => {
  const previous = rawSnapshots.slice(-6)[index];
  return {
    from: Number(previous?.content_revision || 0),
    to: Number(row?.content_revision || 0),
    changed_domains: revision.changeDomains(previous?.payload || {}, row?.payload || {}),
  };
});
const stages = (storage.getTaskBundle(taskId, { diagnostics: true }).stages || [])
  .filter(row => ['blueprint', 'blueprint_auto_repair', 'script_package', 'preflight'].includes(row.stage))
  .map(row => ({
    stage: row.stage,
    status: row.status,
    error: row.error || '',
    input_summary: row.input_summary || '',
    output_summary: row.output_summary || '',
    diagnostics: row.diagnostics || null,
    updated_at: row.updated_at || row.created_at || '',
  }));
const artifacts = records.list('new_story_ad_artifacts', { project_id: taskId })
  .filter(row => String(row.task_id || '') === taskId)
  .sort((a, b) => Number(a.source_content_revision || 0) - Number(b.source_content_revision || 0))
  .map(row => ({
    id: row.id,
    kind: row.kind,
    source_content_revision: Number(row.source_content_revision || 0),
    qa_status: row.qa_status || '',
    beat_count: Array.isArray(row.payload?.beats) ? row.payload.beats.length : null,
    shot_count: Array.isArray(row.payload) ? row.payload.length : null,
    created_at: row.created_at || '',
  }));
const beats = Array.isArray(checkpoint?.payload?.beats) ? checkpoint.payload.beats : [];
console.log(JSON.stringify({
  task: {
    id: task.id,
    status: task.status,
    stage: task.stage,
    error_code: task.error_code,
    content_revision: Number(task.content_revision || 0),
    active_generation_id: task.active_generation_id || '',
  },
  context: {
    shot_count: Number(ctx.shot_count || 0),
    explicit_segment_count: blueprint.explicitSegmentCount(ctx),
    pacing: blueprint.pacingProfile(ctx),
    brief_length: String(ctx.brief || '').length,
    brief_end: String(ctx.brief || '').slice(-1200),
    brand_overlay: ctx.brand_overlay || null,
  },
  checkpoint: checkpoint ? {
    reusable: checkpoint.reusable === true,
    content_revision: Number(checkpoint.content_revision || 0),
    expected_beat_count: Number(checkpoint.expected_beat_count || 0),
    actual_beat_count: Number(checkpoint.actual_beat_count || 0),
    payload_beat_count: beats.length,
    beat_indexes: beats.map(beat => beat.beat_index || beat.index || null),
    beat_plots: beats.map(beat => beat.plot || beat.event || beat.description || ''),
    created_at: checkpoint.created_at || '',
  } : null,
  rejection,
  stages,
  artifacts,
  snapshots,
  revision_pairs: revisionPairs,
}, null, 2));
`;

const encoded = Buffer.from(remoteScript, 'utf8').toString('base64');
const client = new Client();
client.on('ready', () => {
  client.exec(`cd '${remoteRoot}' && node --no-warnings -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`, (error, stream) => {
    if (error) throw error;
    stream.pipe(process.stdout);
    stream.stderr.pipe(process.stderr);
    stream.on('close', code => {
      client.end();
      process.exitCode = code || 0;
    });
  });
}).on('error', error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}).connect({ host, port, username, password, readyTimeout: 25000 });
