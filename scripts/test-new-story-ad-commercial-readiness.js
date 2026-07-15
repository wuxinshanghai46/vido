#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-commercial-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_MOCK_TTS = '1';

const storage = require('../src/services/newStoryAd/storageService');
const jobs = require('../src/services/newStoryAd/jobService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const ttsAdapter = require('../src/services/newStoryAd/ttsAdapter');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const continuity = require('../src/services/newStoryAd/continuityService');
const providerAdapters = require('../src/services/newStoryAd/providerAdapterRegistry');
const ffprobePath = require('ffprobe-static').path;

function probe(filePath) {
  const run = spawnSync(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,sample_rate,channels', '-of', 'json', filePath], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(run.stderr || 'ffprobe failed');
  return JSON.parse(run.stdout);
}

async function main() {
  const shots = continuity.withContinuityContracts([
    { index: 1, scene_id: 'dynamic_scene_a', action: 'subject raises the current task object', exit_frame_state: 'object remains raised on the right' },
    { index: 2, scene_id: 'dynamic_scene_a', action: 'subject continues the same movement', screen_direction: 'left_to_right', transition_type: 'cut_on_action', transition_reason: 'continue the current action' },
    { index: 3, scene_id: 'dynamic_scene_b', action: 'show the result', transition_type: 'match_cut', audio_bridge: 'carry current ambience' },
  ]);
  assert.equal(shots[1].entry_frame_state, 'object remains raised on the right');
  assert.equal(shots[1].continuity_from, 'shot_1');
  assert.equal(shots[2].same_scene_as_previous, false);
  assert.match(continuity.continuityPrompt(shots[2], shots[1]), /match_cut/);

  const originalGenerateText = providerAdapters.generateText;
  let textAttempts = 0;
  providerAdapters.generateText = async () => {
    textAttempts += 1;
    throw new Error('provider HTTP 503');
  };
  await assert.rejects(
    () => modelGateway.generateText({
      taskId: 'budget-check',
      stage: 'new_story_ad.scene_config',
      systemPrompt: 'generic',
      userPrompt: 'generic',
      maxCandidates: 2,
      stageBudgetMs: 30000,
    }),
    error => error.code === 'MODEL_ATTEMPTS_EXHAUSTED' && error.attempted_count === 2,
  );
  providerAdapters.generateText = originalGenerateText;
  assert.equal(textAttempts, 2);

  const owner = { id: 'commercial-owner', role: 'user' };
  const orphan = storage.createTask({ id: 'commercial-orphan', title: 'generic task', user_id: owner.id, status: 'running', stage: 'video' });
  storage.updateTask(orphan.id, {
    active_stage: 'video',
    active_generation_id: 'old-generation',
    generation_started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  });
  const recovered = jobs.reconcileInterruptedJobs({ now: Date.now() });
  assert.equal(recovered.interrupted, 1);
  assert.equal(storage.getTask(orphan.id).status, 'failed');
  assert.equal(storage.getTask(orphan.id).error_code, 'WORKER_INTERRUPTED');
  assert.equal(storage.getTask(orphan.id).active_generation_id, '');

  const model = { provider_id: 'test-provider', model_id: 'test-model' };
  modelGateway.recordHealth(model, { ok: false, error: new Error('configuration not found') });
  assert.equal(modelGateway.healthState(model).circuit_open, true);

  const audio = await ttsAdapter.generateShotAudio({ taskId: 'commercial-media', shot: { voiceover: 'generic commercial audio', duration: 2 }, index: 0, voiceId: 'test' });
  const source = path.join(tempDir, 'source.mp4');
  const normalized = path.join(tempDir, 'normalized.mp4');
  await videoAdapter.renderLocalClip({ outputPath: source, durationSec: 2, aspectRatio: '16:9' });
  await videoAdapter.normalizeProviderClip({
    inputPath: source,
    outputPath: normalized,
    audioPath: ttsAdapter.audioPathFromName(audio.filename),
    durationSec: 2,
    aspectRatio: '16:9',
    resolution: '480p',
  });
  const media = probe(normalized);
  assert(media.streams.some(stream => stream.codec_type === 'video' && stream.codec_name === 'h264'));
  assert(media.streams.some(stream => stream.codec_type === 'audio' && stream.codec_name === 'aac'));
  assert(Math.abs(Number(media.format.duration) - 2) < 0.2);

  await assert.rejects(
    () => videoAdapter.generateShotVideo({ taskId: 'duration-check', shot: { duration: 16 }, index: 0 }),
    error => error.code === 'SHOT_DURATION_UNSUPPORTED',
  );

  console.log(JSON.stringify({
    success: true,
    continuity_contracts: shots.length,
    text_attempt_budget: textAttempts,
    orphan_recovered: recovered.interrupted,
    circuit_open: modelGateway.healthState(model).circuit_open,
    normalized_duration: Number(media.format.duration),
    streams: media.streams.map(stream => stream.codec_type),
  }, null, 2));
}

main()
  .finally(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  })
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
