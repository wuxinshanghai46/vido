#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-test-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const jobs = require('../src/services/newStoryAd/jobService');
const service = require('../src/services/newStoryAd/storyAdService');
const { buildContext, assertContextConsistent } = require('../src/services/newStoryAd/contextBuilder');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const ttsAdapter = require('../src/services/newStoryAd/ttsAdapter');
const newStoryAdModelConfig = require('./configure-new-story-ad-models');

function waitUntil(predicate, timeoutMs = 4000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('test wait timed out'));
      }
    }, 20);
  });
}

async function main() {
  const owner = { id: 'owner-1', role: 'user' };
  const created = service.createTask({
    brief: '制作一条面向通用业务场景的产品功能演示广告，按用户输入动态生成内容。',
    product_subject: '用户指定的广告主体',
    cast_mode: 'no_human',
  }, owner);
  const taskId = created.task.id;
  assert.equal(service.assertTaskOwner(taskId, owner).id, taskId);
  assert.throws(() => service.assertTaskOwner(taskId, { id: 'other-user', role: 'user' }), /无权访问/);

  const conflicting = buildContext({
    brief: '一位讲解者面对镜头演示用户指定的服务。',
    cast_mode: 'single',
    forbidden: ['不能出现人物'],
  }, owner);
  assert.throws(() => assertContextConsistent(conflicting), /约束冲突/);

  let runs = 0;
  const first = jobs.queueStage({
    taskId,
    stage: 'storyboard',
    execute: async () => {
      runs += 1;
      await new Promise(resolve => setTimeout(resolve, 80));
      storage.saveOutput(taskId, 'storyboard_table', [{ index: 1, visual: '按输入生成的画面', action: '主体完成用户要求的演示动作', voiceover: '通用测试' }]);
      storage.updateTask(taskId, { status: 'running', stage: 'storyboard_done' });
    },
  });
  const duplicate = jobs.queueStage({ taskId, stage: 'storyboard', execute: async () => { runs += 1; } });
  assert.equal(first.accepted, true);
  assert.equal(duplicate.duplicate, true);
  await waitUntil(() => !storage.getTask(taskId).active_generation_id);
  assert.equal(runs, 1);
  assert.equal(storage.getTask(taskId).status, 'done');
  assert.equal(storage.getOutput(taskId, 'storyboard_table').length, 1);

  const failed = jobs.queueStage({
    taskId,
    stage: 'video',
    execute: async () => { throw new Error('Token not valid'); },
  });
  assert.equal(failed.accepted, true);
  await waitUntil(() => storage.getTask(taskId).stage === 'video_failed');
  assert.equal(storage.getTask(taskId).error_code, 'AUTH_CONFIG');
  assert.equal(storage.getTask(taskId).retryable, false);
  assert.equal(modelGateway.classifyError(new Error('400 Token not valid')).code, 'AUTH_CONFIG');
  assert.deepEqual(modelGateway.classifyError(new Error('HTTP 400: {"code":1102,"message":"Account balance not enough"}')), { code: 'PROVIDER_BILLING', retryable: false });
  await assert.rejects(() => ttsAdapter.generateShotAudio({ shot: { voiceover: '测试' }, voiceId: '' }), /未选择配音音色/);

  const repeatedSpeechShot = {
    voiceover: '开发 AI 应用，总想找到更强大的开发伙伴。',
    narration: '开发 AI 应用，总想找到更强大的开发伙伴。',
    ad_copy: '开发 AI 应用，总想找到更强大的开发伙伴。',
    subtitle: '开发 AI 应用，总想找到更强大的开发伙伴。',
    dialogue_lines: [{ speaker: '旁白', line: '开发 AI 应用，总想找到更强大的开发伙伴。' }],
  };
  const dedupedSpeech = ttsAdapter.shotSpeechText(repeatedSpeechShot);
  assert.equal(dedupedSpeech, '开发 AI 应用，总想找到更强大的开发伙伴。');
  assert.equal(ttsAdapter.shotSpeechText({
    voiceover: '先介绍产品。',
    dialogue_lines: [{ speaker: '主持人', line: '再演示核心功能。' }],
  }), '先介绍产品。 主持人: 再演示核心功能。');
  assert.equal(ttsAdapter.voiceoverPlanMatches({
    voice_id: 'voice-a',
    tracks: [{ text: dedupedSpeech }],
  }, [repeatedSpeechShot], 'voice-a'), true);
  assert.equal(ttsAdapter.voiceoverPlanMatches({
    voice_id: 'voice-a',
    tracks: [{ text: `${dedupedSpeech} ${dedupedSpeech}` }],
  }, [repeatedSpeechShot], 'voice-a'), false);
  assert.equal(ttsAdapter.voiceoverPlanMatches({
    voice_id: 'voice-b',
    tracks: [{ text: dedupedSpeech }],
  }, [repeatedSpeechShot], 'voice-a'), false);
  assert.equal(service.resolveTtsVoiceId({}, {}, { voice_id: 'legacy-voice' }), 'legacy-voice');
  assert.equal(service.resolveTtsVoiceId({ voice_id: 'new-voice' }, {}, { voice_id: 'legacy-voice' }), 'new-voice');
  assert(newStoryAdModelConfig.VIDEO_MODELS.some(model => (
    model.provider_id === 'zhipu'
      && model.model_id === 'cogvideox-flash'
      && model.enabled === true
  )));

  const staleFailedFrame = service.keyframeCompletion([{ image_url: 'https://example.test/old.png', error: 'latest regeneration failed', error_code: 'IMAGE_ATTEMPTS_EXHAUSTED' }], [{}]);
  assert.deepEqual(staleFailedFrame, { total: 1, completed: 0, missing: 1, failed: 1, missing_indexes: [0] });

  const deduped = storage.dedupeLatestTasks([
    { id: 'older', user_id: 'same-user', brief: '相同任务', request: { duration_sec: 30, output_ratio: '9:16' }, updated_at: '2026-01-01T00:00:00.000Z' },
    { id: 'newer', user_id: 'same-user', brief: ' 相同任务 ', request: { duration_sec: 30, output_ratio: '9:16' }, updated_at: '2026-01-02T00:00:00.000Z' },
    { id: 'other-user', user_id: 'other-user', brief: '相同任务', request: { duration_sec: 30, output_ratio: '9:16' }, updated_at: '2026-01-03T00:00:00.000Z' },
  ]);
  assert.deepEqual(deduped.map(task => task.id).sort(), ['newer', 'other-user']);

  const summary = service.taskSummary(storage.getTask(taskId));
  assert.equal(Object.prototype.hasOwnProperty.call(summary, 'request'), false);
  assert.equal(summary.id, taskId);
  console.log('new-story-ad reliability tests passed');
}

main()
  .finally(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  })
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
