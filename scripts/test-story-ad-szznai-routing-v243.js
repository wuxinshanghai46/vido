#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const childProcess = require('child_process');
const { EventEmitter } = require('events');
const { Readable } = require('stream');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-szznai-routing-v243-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
fs.writeFileSync(path.join(outputDir, 'settings.json'), JSON.stringify({ providers: [
  { id: 'smscrw', preset: 'smscrw', name: 'SMSCRW 图像服务', enabled: true, api_key: 'test-secret-not-real', api_url: 'https://ai.smscrw.cn/v1', models: [{ id: 'gpt-image-2', type: 'image', use: 'image', enabled: true }] },
  { id: 'deyunai', preset: 'deyunai', enabled: true, api_key: 'test', api_url: 'https://example.invalid/v1', models: [
    { id: 'claude-sonnet-4-6', type: 'chat', use: 'story', enabled: true },
    { id: 'doubao-seedance-2-0-260128', type: 'video', use: 'video', enabled: true },
  ] },
  { id: 'webang-maas', preset: 'webang-maas', enabled: true, api_key: 'test', api_url: 'https://example.invalid/v1', models: [{ id: 'gemini-2.5-flash', type: 'chat', use: 'story', enabled: true }] },
  { id: 'zhipu', preset: 'zhipu', enabled: true, api_key: 'test', api_url: 'https://example.invalid/v1', models: [{ id: 'glm-4.6v-flash', type: 'vlm', use: 'vision', enabled: true }] },
] }, null, 2));

const settingsService = require('../src/services/settingsService');
const pipeline = require('../src/services/pipelineModelService');
const videoService = require('../src/services/videoService');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const gateway = require('../src/services/newStoryAd/modelGateway');
const migration = require('./configure-story-ad-szznai-routing-v243');

const expectedModels = [
  'claude-fable-5', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-4-6', 'MiniMax-H3', 'gemini-2.5-flash',
  'gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview', 'gemini-3.1-flash-lite-image', 'gpt-image-2', 'doubao-seedance-2-0-260128',
];
assert.deepEqual(settingsService.PROVIDER_PRESETS.smscrw.defaultModels.map(model => model.id), expectedModels, 'SZZNAI 模型目录必须与门户当前 11 个可用模型一致');
assert.equal(settingsService.PROVIDER_PRESETS.smscrw.name, 'SZZNAI（SMSCRW）');
assert.deepEqual(settingsService.PROVIDER_ADAPTER_DEFAULTS.smscrw.adapter_config.video, {
  task_endpoint: '/videos/generations',
  status_endpoint: '/videos/generations/{task_id}',
  content_endpoint: '/videos/{task_id}/content',
  idempotency_header: 'Idempotency-Key',
});

const first = videoService.buildSmscrwVideoRequest({
  prompt: '保持主体与空间稳定，镜头缓慢推进',
  model: 'doubao-seedance-2-0-260128',
  image_url: 'https://cdn.example.invalid/keyframe.jpg',
  duration: 5,
  aspectRatio: '16:9',
  resolution: '720p',
});
const second = videoService.buildSmscrwVideoRequest({
  prompt: '保持主体与空间稳定，镜头缓慢推进',
  model: 'doubao-seedance-2-0-260128',
  image_url: 'https://cdn.example.invalid/keyframe.jpg',
  duration: 5,
  aspectRatio: '16:9',
  resolution: '720p',
});
assert.deepEqual(first.body.content, [
  { type: 'text', text: '保持主体与空间稳定，镜头缓慢推进' },
  { type: 'image_url', image_url: { url: 'https://cdn.example.invalid/keyframe.jpg' }, role: 'reference_image' },
]);
assert.equal(first.idempotencyKey, second.idempotencyKey, '相同视频请求必须产生稳定幂等键');
assert.equal(first.body.generate_audio, false);
assert.equal(first.body.watermark, false);
assert.throws(() => videoService.buildSmscrwVideoRequest({ prompt: 'x', image_url: 'file:///private.jpg' }), /公网 http\(s\) URL/);

async function verifyVideoAdapterExecution() {
  const originalRequest = https.request;
  const originalGet = https.get;
  const originalSetTimeout = global.setTimeout;
  const calls = [];
  let submitted = null;
  const progress = [];
  try {
    https.request = (options, callback) => {
      const req = new EventEmitter();
      let requestBody = '';
      req.write = chunk => { requestBody += String(chunk); };
      req.setTimeout = () => req;
      req.destroy = error => req.emit('error', error);
      req.end = () => {
        calls.push({ options, body: requestBody ? JSON.parse(requestBody) : null });
        const payload = options.method === 'POST' ? { id: 'szz-task-1', status: 'queued' } : { id: 'szz-task-1', status: 'succeeded' };
        process.nextTick(() => {
          const res = new EventEmitter();
          res.statusCode = 200; res.statusMessage = 'OK'; res.headers = { 'content-type': 'application/json' };
          callback(res);
          process.nextTick(() => { res.emit('data', Buffer.from(JSON.stringify(payload))); res.emit('end'); });
        });
      };
      return req;
    };
    https.get = (url, options, callback) => {
      calls.push({ options: { method: 'GET-DOWNLOAD', url, headers: options.headers }, body: null });
      const req = new EventEmitter();
      req.destroy = error => req.emit('error', error);
      process.nextTick(() => {
        const res = Readable.from(Buffer.from('fake-mp4'));
        res.statusCode = 200; res.headers = { 'content-type': 'video/mp4' };
        callback(res);
      });
      return req;
    };
    global.setTimeout = (fn, _delay, ...args) => originalSetTimeout(fn, 0, ...args);
    const result = await videoService.generateSmscrwSeedanceClip({
      prompt: '保持人物与场景一致，镜头缓慢推进',
      duration: 5,
      outputDir,
      filename: 'szznai-contract-test',
      aspectRatio: '16:9',
      image_url: 'https://cdn.example.invalid/keyframe.jpg',
      video_model: 'doubao-seedance-2-0-260128',
      idempotencyKey: 'stable-paid-unit-key',
      onSubmitted: event => { submitted = event; },
      onProgress: event => { progress.push(event); },
    });
    assert.equal(fs.existsSync(result.filePath), true);
    assert.equal(result.providerTaskId, 'szz-task-1');
    assert.equal(calls[0].options.path, '/v1/videos/generations');
    assert.equal(calls[0].options.headers['Idempotency-Key'], 'stable-paid-unit-key');
    assert.equal(calls[0].body.content[1].role, 'reference_image');
    assert.equal(calls[1].options.path, '/v1/videos/generations/szz-task-1');
    assert.equal(calls[2].options.url, 'https://ai.smscrw.cn/v1/videos/szz-task-1/content');
    assert.match(calls[2].options.headers.Authorization, /^Bearer /);
    assert.equal(submitted.taskId, 'szz-task-1');
    assert.ok(progress.some(event => event.status === 'downloading'));
  } finally {
    https.request = originalRequest;
    https.get = originalGet;
    global.setTimeout = originalSetTimeout;
  }
}

assert.equal(videoAdapter.isSmscrwSeedanceModel({ provider_id: 'smscrw', model_id: 'doubao-seedance-2-0-260128' }), true);
assert.equal(videoAdapter.isDeyunaiSeedanceModel({ provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-260128' }), true);

const dryRun = migration.apply({ write: false });
assert.equal(dryRun.model_count, 11);
assert.ok(dryRun.stage_count > 20);
assert.equal(fs.existsSync(migration.BACKUP_PATH || path.join(outputDir, `${migration.MIGRATION_ID}-backup.json`)), false, 'dry-run 不得写备份');

const applied = migration.apply({ write: true });
assert.equal(applied.applied, true);
const provider = settingsService.loadSettings().providers.find(item => item.id === 'smscrw');
assert.equal(provider.name, 'SZZNAI（SMSCRW）');
assert.equal(provider.api_key, 'test-secret-not-real', '同步目录不得覆盖现有 API Key');
assert.deepEqual(provider.models.map(model => model.id), expectedModels);
for (const stageId of migration.targetStages()) {
  assert.equal(pipeline.getStageConfig(stageId)[0].provider_id, 'smscrw', `${stageId} 必须以 SZZNAI 为第一候选`);
}
assert.equal(pipeline.getStageConfig('new_story_ad.story_facts')[0].model_id, 'claude-sonnet-4-6');
assert.equal(pipeline.getStageConfig('new_story_ad.scene_camera_qa')[0].model_id, 'claude-sonnet-4-6');
assert.equal(pipeline.getStageConfig('new_story_ad.scene_asset')[0].model_id, 'gpt-image-2');
assert.equal(pipeline.getStageConfig('new_story_ad.video')[0].model_id, 'doubao-seedance-2-0-260128');
assert.equal(pipeline.getStageConfig('new_story_ad.sound_generation')[0].model_id, 'doubao-seedance-2-0-260128');
assert.notEqual(pipeline.getStageConfig('new_story_ad.lip_sync')[0]?.provider_id, 'smscrw', 'SZZNAI 普通视频不能伪装成逐字口型模型');

assert.equal(gateway.candidatesForVisionStage('new_story_ad.scene_camera_qa')[0].provider_id, 'smscrw', '视觉理解真实候选必须以 SZZNAI Claude 开始');
assert.equal(videoAdapter.videoCandidates({}, { includeCircuitOpen: true })[0].provider_id, 'smscrw', '视频真实候选必须以 SZZNAI Seedance 开始');

const rotated = childProcess.spawnSync(process.execPath, [
  path.join(__dirname, 'configure-smscrw-image-provider.js'), '--stdin', '--provider-only',
], {
  cwd: path.resolve(__dirname, '..'), env: { ...process.env, OUTPUT_DIR: outputDir, DB_ENABLED: '0' },
  input: 'rotated-test-secret-not-real\n', encoding: 'utf8',
});
assert.equal(rotated.status, 0, rotated.stderr || rotated.stdout);
const rotatedProvider = settingsService.loadSettings().providers.find(item => item.id === 'smscrw');
assert.equal(rotatedProvider.api_key, 'rotated-test-secret-not-real');
assert.deepEqual(rotatedProvider.models.map(model => model.id), expectedModels,
  'SZZNAI Key 轮换不得把 11 个文本、视觉、图片和视频模型收缩成单一图片模型');

const backupPath = path.join(outputDir, `${migration.MIGRATION_ID}-backup.json`);
const backupText = fs.readFileSync(backupPath, 'utf8');
assert.equal(backupText.includes('test-secret-not-real'), false, '迁移备份禁止落盘 API Key');
assert.equal(migration.apply({ write: false }).changed_stage_count, 0, '迁移必须幂等');
assert.equal(migration.commit().committed, true);
assert.equal(fs.existsSync(backupPath), false);

verifyVideoAdapterExecution().then(() => {
  console.log(JSON.stringify({ passed: true, synced_models: expectedModels.length, routed_stages: applied.stage_count, szznai_first: true, video_contract_checked: true, video_adapter_stub_checked: true, idempotency_checked: true, secret_backup_checked: true, paid_model_calls: 0 }));
  fs.rmSync(outputDir, { recursive: true, force: true });
}).catch(error => {
  fs.rmSync(outputDir, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
});
