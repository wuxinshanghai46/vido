#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { Readable } = require('stream');

async function main() {
  let assertions = 0;
  const ok = (value, message) => { assert.ok(value, message); assertions++; };
  const equal = (actual, expected, message) => { assert.strictEqual(actual, expected, message); assertions++; };

  const catalog = require('../src/services/volcengineSpeechCatalog');
  equal(catalog.voices.length, 99, '必须同步火山官方 99 个标准音色');
  equal(catalog.voiceIds.size, 99, '音色 ID 必须唯一');
  ok(catalog.voices.every(voice => voice.providerId === 'volcengine-tts' && voice.model === 'seed-tts-2.0'), '目录只能归属 TTS 专用供应商');

  const settingsService = require('../src/services/settingsService');
  const bounded = settingsService.enforceSpeechProviderBoundary({ providers: [
    { id: 'aliyun-tts', api_key: 'secret', models: [] },
    { id: 'qwen', api_key: 'keep', models: [{ id: 'qwen-max', type: 'chat', use: 'story' }] },
    { id: 'volcengine', api_url: 'https://openspeech.bytedance.com/api/v1', api_key: 'old', models: [] },
    { id: 'volcengine-tts', api_url: 'https://bad.example.com', models: [
      { id: 'seed-tts-2.0', type: 'tts', use: 'tts' },
      { id: 'doubao-seedance', type: 'video', use: 'video' },
    ] },
  ] });
  ok(!bounded.providers.some(provider => provider.id === 'aliyun-tts'), '阿里 TTS 配置必须移除');
  ok(bounded.providers.some(provider => provider.id === 'qwen'), '阿里非 TTS 的 Qwen 配置必须保留');
  ok(!bounded.providers.some(provider => provider.id === 'volcengine'), '旧 openspeech V1 TTS 配置必须移除');
  const isolated = bounded.providers.find(provider => provider.id === 'volcengine-tts');
  equal(isolated.api_url, 'https://openspeech.bytedance.com', 'TTS API Host 必须固定');
  equal(isolated.models.length, 1, '视频等非 TTS 模型必须从语音供应商移除');
  equal(isolated.models[0].id, 'seed-tts-2.0');

  const pipeline = require('../src/services/pipelineModelService');
  const defaults = pipeline.listDefaults();
  for (const [stageId, models] of Object.entries(defaults)) {
    for (const model of models || []) {
      if (stageId === 'voice.enrollment') {
        equal(`${model.provider_id}/${model.model_id}`, 'volcengine-tts/seed-icl-2.0');
      } else if (/\.tts$/.test(stageId)) {
        equal(`${model.provider_id}/${model.model_id}`, 'volcengine-tts/seed-tts-2.0');
      } else {
        ok(!['volcengine-tts', 'volcengine'].includes(model.provider_id), `非 TTS 阶段禁止字节直连：${stageId}`);
      }
    }
  }

  const speech = require('../src/services/volcengineSpeechService');
  assert.throws(() => speech.assertAllowedResource('doubao-seedance-2-0'), error => error.code === 'VOLCENGINE_TTS_SCOPE_VIOLATION'); assertions++;

  const https = require('https');
  const originalRequest = https.request;
  const captures = [];
  https.request = (url, options, callback) => {
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = error => { if (error) req.emit('error', error); };
    req.end = payload => {
      const parsed = new URL(url);
      captures.push({ path: parsed.pathname, headers: options.headers, body: JSON.parse(Buffer.from(payload || '').toString('utf8') || '{}') });
      const res = new Readable({ read() {} });
      res.statusCode = 200;
      res.headers = { 'x-tt-logid': 'test-log' };
      callback(res);
      if (parsed.pathname.endsWith('/unidirectional/sse')) {
        res.push(`data: ${JSON.stringify({ code: 0, data: Buffer.from('fake-mp3-audio').toString('base64') })}\n\n`);
      } else if (parsed.pathname.endsWith('/voice_clone')) {
        res.push(JSON.stringify({ status: 2, speaker_id: captures.at(-1).body.custom_speaker_id, speaker_status: [{ model_type: 5, demo_audio: 'https://example.test/demo' }] }));
      } else if (parsed.pathname.endsWith('/get_voice')) {
        res.push(JSON.stringify({ status: 4, speaker_id: captures.at(-1).body.custom_speaker_id || captures.at(-1).body.speaker_id, speaker_status: [{ model_type: 5 }] }));
      }
      res.push(null);
    };
    return req;
  };

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-volc-tts-'));
  try {
    const output = await speech.synthesize('测试', 'zh_female_vv_uranus_bigtts', path.join(tempRoot, 'speech'), {
      apiKey: 'test-api-key', apiBase: 'https://openspeech.bytedance.com', speed: 1, pitch: 1,
    });
    ok(fs.existsSync(output) && fs.statSync(output).size > 0, 'V3 SSE 音频必须落盘');
    const synthCall = captures.find(call => call.path.endsWith('/unidirectional/sse'));
    equal(synthCall.headers['X-Api-Resource-Id'], 'seed-tts-2.0');
    equal(synthCall.headers['X-Api-Key'], 'test-api-key');
    ok(!synthCall.headers['X-Api-App-Key'] && !synthCall.headers['X-Api-Access-Key'], '新版合同不得回退旧 AppId/AccessToken 鉴权');
    equal(synthCall.body.req_params.speaker, 'zh_female_vv_uranus_bigtts');

    const sample = path.join(tempRoot, 'sample.wav');
    fs.writeFileSync(sample, Buffer.alloc(4096, 1));
    const clone = await speech.enrollVoice(sample, {
      apiKey: 'test-api-key', apiBase: 'https://openspeech.bytedance.com', customSpeakerId: 'vido_12345678', demoText: '测试声音复刻',
    });
    equal(clone.ready, true);
    const cloneCall = captures.find(call => call.path.endsWith('/voice_clone'));
    equal(cloneCall.body.speaker_id, 'custom_speaker_id');
    equal(cloneCall.body.custom_speaker_id, 'vido_12345678');
    ok(!cloneCall.headers['X-Api-Resource-Id'], '训练接口不得伪造合成资源 ID');

    const queried = await speech.queryVoice('vido_12345678', { apiKey: 'test-api-key', apiBase: 'https://openspeech.bytedance.com' });
    equal(queried.ready, true);
    equal(captures.find(call => call.path.endsWith('/get_voice')).body.custom_speaker_id, 'vido_12345678');
  } finally {
    https.request = originalRequest;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const tts = require('../src/services/ttsService');
  equal(tts.voiceProviderForId('zh_female_vv_uranus_bigtts'), 'volcengine-tts');
  equal(tts.voiceProviderForId('longxiaochun_v3'), '', '阿里音色不能再进入权威 TTS 路由');

  const adminUi = fs.readFileSync(path.join(__dirname, '../public/js/admin-vue-ai-config.js'), 'utf8');
  ok(adminUi.includes('仅限 TTS / 声音复刻') && adminUi.includes("provider.id!=='volcengine-tts'"), '后台必须显示并锁定 TTS 专用范围');
  const storyUi = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/soundDesignFeature.js'), 'utf8');
  ok(storyUi.includes('字节豆包语音 2.0') && !storyUi.includes('仅显示当前可用的阿里百炼'), '剧情声音库必须切换字节目录');

  console.log(`volcengine tts v365: ${assertions} assertions passed`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
