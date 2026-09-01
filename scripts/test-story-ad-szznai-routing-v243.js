#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const childProcess = require('child_process');
const { EventEmitter } = require('events');
const { Readable } = require('stream');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-szznai-seedance-v368-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
fs.writeFileSync(path.join(outputDir, 'settings.json'), JSON.stringify({ providers: [{
  id: 'smscrw', preset: 'smscrw', name: '旧 SZ 配置', enabled: true,
  api_key: 'test-secret-not-real', api_url: 'https://ai.smscrw.cn/v1',
  models: [
    { id: 'gpt-image-2', type: 'image', use: 'image', enabled: true },
    { id: 'claude-sonnet-4-6', type: 'chat', use: 'story', enabled: true },
    { id: 'doubao-seedance-2-0-260128', type: 'video', use: 'video', enabled: true },
  ],
}] }, null, 2));
fs.writeFileSync(path.join(outputDir, 'pipeline_model_config.json'), JSON.stringify({ stages: {
  'new_story_ad.scene_asset': [{ provider_id: 'smscrw', model_id: 'gpt-image-2', priority: 1, enabled: true }],
  'new_story_ad.video': [{ provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-260128', priority: 1, enabled: true }],
  'new_story_ad.sound_generation': [{ provider_id: 'smscrw', model_id: 'doubao-seedance-2-0-260128', priority: 1, enabled: true }],
} }, null, 2));

const settingsService = require('../src/services/settingsService');
const pipeline = require('../src/services/pipelineModelService');
const videoService = require('../src/services/videoService');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const migration = require('./configure-story-ad-szznai-seedance-v368');

const videoContract = settingsService.PROVIDER_ADAPTER_DEFAULTS.smscrw.adapter_config.video;
assert.deepEqual(videoContract, {
  base_url: 'https://ai.smscrw.cn',
  task_endpoint: '/api/v3/contents/generations/tasks',
  status_endpoint: '/api/v3/contents/generations/tasks/{task_id}',
  content_endpoint: '/api/v3/contents/generations/tasks/{task_id}/content',
  cancel_endpoint: '/api/v3/contents/generations/tasks/{task_id}',
  idempotency_header: 'Idempotency-Key',
});
assert(settingsService.PROVIDER_PRESETS.smscrw.defaultModels.some(model => model.id === 'doubao-seedance-2.0' && model.use === 'video'));

const first = videoService.buildSmscrwVideoRequest({
  prompt: '保持主体与空间稳定，镜头缓慢推进',
  image_url: 'https://cdn.example.invalid/keyframe.jpg',
  reference_image_urls: ['asset://pa_authorized_person'],
  duration: 5,
  aspectRatio: '16:9',
  resolution: '720p',
});
const second = videoService.buildSmscrwVideoRequest({
  prompt: '保持主体与空间稳定，镜头缓慢推进',
  image_url: 'https://cdn.example.invalid/keyframe.jpg',
  reference_image_urls: ['asset://pa_authorized_person'],
  duration: 5,
  aspectRatio: '16:9',
  resolution: '720p',
});
assert.equal(first.body.model, 'doubao-seedance-2.0');
assert.equal(first.body.content[1].role, 'reference_image');
assert.equal(first.body.content[2].image_url.url, 'asset://pa_authorized_person');
assert.equal(first.idempotencyKey, second.idempotencyKey);
assert.match(first.idempotencyKey, /^[\x20-\x7E]{8,128}$/);
assert.equal(first.body.generate_audio, false);
assert.equal(first.body.watermark, false);
assert.throws(() => videoService.buildSmscrwVideoRequest({ prompt: 'x', image_url: 'file:///private.jpg' }), /公网 http\(s\) URL 或平台返回/);

async function verifyAdapterContract() {
  const originalRequest = https.request;
  const originalGet = https.get;
  const originalSetTimeout = global.setTimeout;
  const calls = [];
  try {
    https.request = (options, callback) => {
      const req = new EventEmitter();
      let body = '';
      req.write = chunk => { body += String(chunk); };
      req.setTimeout = () => req;
      req.destroy = error => req.emit('error', error);
      req.end = () => {
        calls.push({ options, body: body ? JSON.parse(body) : null });
        const payload = options.method === 'POST'
          ? { id: 'task_szz_1', status: 'queued' }
          : { id: 'task_szz_1', status: 'succeeded', content: { video_url: 'https://signed.example.invalid/result.mp4' } };
        process.nextTick(() => {
          const res = new EventEmitter();
          res.statusCode = 200; res.statusMessage = 'OK'; res.headers = {};
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
        if (String(url).startsWith('https://ai.smscrw.cn/')) {
          const res = new EventEmitter();
          res.statusCode = 302; res.headers = { location: 'https://signed.example.invalid/result.mp4?signature=test' };
          callback(res);
          return;
        }
        const res = Readable.from(Buffer.from('fake-mp4'));
        res.statusCode = 200; res.headers = { 'content-type': 'video/mp4' };
        callback(res);
      });
      return req;
    };
    global.setTimeout = (fn, _delay, ...args) => originalSetTimeout(fn, 0, ...args);
    const result = await videoService.generateSmscrwSeedanceClip({
      prompt: '保持人物与场景一致，镜头缓慢推进', duration: 5, outputDir,
      filename: 'szznai-contract-test', aspectRatio: '16:9',
      image_url: 'https://cdn.example.invalid/keyframe.jpg', video_model: 'doubao-seedance-2.0',
      idempotencyKey: 'stable-paid-unit-key',
    });
    assert.equal(fs.existsSync(result.filePath), true);
    assert.equal(result.providerTaskId, 'task_szz_1');
    assert.equal(calls[0].options.path, '/api/v3/contents/generations/tasks');
    assert.equal(calls[0].options.headers['Idempotency-Key'], 'stable-paid-unit-key');
    assert.equal(calls[1].options.path, '/api/v3/contents/generations/tasks/task_szz_1');
    assert.equal(calls[2].options.url, 'https://ai.smscrw.cn/api/v3/contents/generations/tasks/task_szz_1/content');
    assert.match(calls[2].options.headers.Authorization, /^Bearer /);
    assert.equal(calls[3].options.url, 'https://signed.example.invalid/result.mp4?signature=test');
    assert.equal(calls[3].options.headers.Authorization, undefined, '跨域签名下载不得泄露企业令牌');
    await videoService.cancelSmscrwSeedanceTask({ provider: settingsService.loadSettings().providers[0], apiKey: 'test-secret-not-real', taskId: 'task_szz_1' });
    assert.equal(calls[4].options.method, 'DELETE');
    assert.equal(calls[4].options.path, '/api/v3/contents/generations/tasks/task_szz_1');
  } finally {
    https.request = originalRequest;
    https.get = originalGet;
    global.setTimeout = originalSetTimeout;
  }
}

assert.equal(videoAdapter.isSmscrwSeedanceModel({ provider_id: 'smscrw', model_id: 'doubao-seedance-2.0' }), true);
assert.equal(videoAdapter.isSmscrwSeedanceModel({ provider_id: 'smscrw', model_id: 'doubao-seedance-2-0-260128' }), true);
const dryRun = migration.apply({ write: false });
assert.deepEqual(dryRun.enabled_smscrw_models, ['doubao-seedance-2.0']);
assert.deepEqual(dryRun.smscrw_routes, [{ stage_id: 'new_story_ad.video', model_id: 'doubao-seedance-2.0' }]);
assert.equal(dryRun.non_video_smscrw_routes, 0);
assert.equal(fs.existsSync(migration.BACKUP_PATH), false);

const applied = migration.apply({ write: true });
assert.equal(applied.applied, true);
const provider = settingsService.loadSettings().providers.find(migration.isSmscrw);
assert.equal(provider.api_key, 'test-secret-not-real');
assert.deepEqual(provider.models.filter(model => model.enabled !== false).map(model => model.id), ['doubao-seedance-2.0']);
assert.equal(pipeline.getStageConfig('new_story_ad.video')[0].model_id, 'doubao-seedance-2.0');
for (const [stageId, routes] of Object.entries(pipeline.loadConfig().stages || {})) {
  if (stageId === 'new_story_ad.video') continue;
  assert.equal(routes.some(migration.isSmscrw), false, `${stageId} 不得保留 SZ 非视频路由`);
}
assert.equal(videoAdapter.videoCandidates({}, { includeCircuitOpen: true })[0].provider_id, 'smscrw');
const rotated = childProcess.spawnSync(process.execPath, [
  path.join(__dirname, 'configure-smscrw-image-provider.js'), '--stdin', '--provider-only',
], {
  cwd: path.resolve(__dirname, '..'), env: { ...process.env, OUTPUT_DIR: outputDir, DB_ENABLED: '0' },
  input: 'rotated-test-secret-not-real\n', encoding: 'utf8',
});
assert.equal(rotated.status, 0, rotated.stderr || rotated.stdout);
const rotatedProvider = settingsService.loadSettings().providers.find(migration.isSmscrw);
assert.equal(rotatedProvider.api_key, 'rotated-test-secret-not-real');
assert.deepEqual(rotatedProvider.models.filter(model => model.enabled !== false).map(model => model.id), ['doubao-seedance-2.0']);
assert.equal(migration.apply({ write: false }).non_video_smscrw_routes, 0);
const backupText = fs.readFileSync(migration.BACKUP_PATH, 'utf8');
assert.equal(backupText.includes('test-secret-not-real'), false);
assert.equal(migration.apply({ write: false }).changed_stage_count, 0);
assert.equal(migration.commit().committed, true);
assert.equal(fs.existsSync(migration.BACKUP_PATH), false);

verifyAdapterContract().then(() => {
  console.log(JSON.stringify({ passed: true, video_model: 'doubao-seedance-2.0', create_query_download_cancel: true, public_and_asset_references: true, cross_origin_token_redaction: true, idempotency_checked: true, non_video_smscrw_routes: 0, paid_model_calls: 0 }));
  fs.rmSync(outputDir, { recursive: true, force: true });
}).catch(error => {
  fs.rmSync(outputDir, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
});
