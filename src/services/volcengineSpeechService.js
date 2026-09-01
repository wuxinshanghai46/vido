/**
 * 火山引擎豆包语音专用客户端。
 * 安全边界：只实现 TTS 2.0、声音复刻 2.0 的合成/训练/查询接口；
 * 不暴露文本、图片、视频、ASR 或任何其他字节模型调用。
 */
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const PROVIDER_ID = 'volcengine-tts';
const DEFAULT_API_BASE = 'https://openspeech.bytedance.com';
const TTS_RESOURCE_ID = 'seed-tts-2.0';
const CLONE_RESOURCE_ID = 'seed-icl-2.0';
const DEFAULT_VOICE = 'zh_female_vv_uranus_bigtts';

function providerConfig() {
  const { loadSettings } = require('./settingsService');
  const provider = (loadSettings().providers || []).find(item => (
    item && item.enabled !== false && (item.id === PROVIDER_ID || item.preset === PROVIDER_ID)
  )) || {};
  return {
    apiKey: String(provider.api_key || process.env.VOLCENGINE_SPEECH_API_KEY || '').trim(),
    apiBase: String(provider.api_url || DEFAULT_API_BASE).trim().replace(/\/$/, ''),
    ttsResourceId: String(provider.tts_resource_id || TTS_RESOURCE_ID).trim(),
    cloneResourceId: String(provider.clone_resource_id || CLONE_RESOURCE_ID).trim(),
  };
}

function hasKey() {
  return !!providerConfig().apiKey;
}

function assertAllowedResource(resourceId) {
  if (resourceId !== TTS_RESOURCE_ID && resourceId !== CLONE_RESOURCE_ID) {
    const error = new Error(`禁止调用非 TTS 字节资源：${resourceId || 'empty'}`);
    error.code = 'VOLCENGINE_TTS_SCOPE_VIOLATION';
    throw error;
  }
}

function requestJson(endpoint, body, { apiKey, apiBase, signal, timeoutMs = 60000, resourceId = '' } = {}) {
  const config = providerConfig();
  const key = String(apiKey || config.apiKey || '').trim();
  if (!key) throw Object.assign(new Error('字节豆包语音 API Key 未配置'), { code: 'TTS_PROVIDER_NOT_CONFIGURED' });
  if (resourceId) assertAllowedResource(resourceId);
  const url = new URL(endpoint, apiBase || config.apiBase || DEFAULT_API_BASE);
  const payload = Buffer.from(JSON.stringify(body || {}));
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': payload.length,
    'X-Api-Key': key,
    'X-Api-Request-Id': crypto.randomUUID(),
  };
  if (resourceId) headers['X-Api-Resource-Id'] = resourceId;
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = raw ? JSON.parse(raw) : {}; }
        catch { return reject(Object.assign(new Error(`字节豆包语音返回了无效 JSON (${res.statusCode})`), { status: res.statusCode })); }
        if (res.statusCode < 200 || res.statusCode >= 300 || (json.code != null && ![0, 20000000].includes(Number(json.code)))) {
          const message = json.message || json.msg || json.error || `HTTP ${res.statusCode}`;
          return reject(Object.assign(new Error(`字节豆包语音：${message}`), { status: res.statusCode, providerCode: json.code }));
        }
        resolve({ ...json, request_id: res.headers['x-tt-logid'] || headers['X-Api-Request-Id'] });
      });
    });
    const abort = () => req.destroy(signal?.reason || Object.assign(new Error('TTS request aborted'), { code: 'ABORT_ERR' }));
    if (signal?.aborted) return abort();
    signal?.addEventListener?.('abort', abort, { once: true });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('字节豆包语音请求超时')));
    req.end(payload);
  });
}

function speedToRate(speed = 1) {
  const value = Math.min(2, Math.max(0.5, Number(speed) || 1));
  return Math.round(value >= 1 ? (value - 1) * 100 : (value - 1) * 100);
}

function pitchToRate(pitch = 1) {
  const value = Math.min(2, Math.max(0.5, Number(pitch) || 1));
  return Math.max(-12, Math.min(12, Math.round((value - 1) * 12)));
}

async function synthesize(text, speaker, outputPath, options = {}) {
  const config = providerConfig();
  const resourceId = options.cloned ? CLONE_RESOURCE_ID : TTS_RESOURCE_ID;
  assertAllowedResource(resourceId);
  const endpoint = new URL('/api/v3/tts/unidirectional/sse', options.apiBase || config.apiBase).toString();
  const body = {
    user: { uid: String(options.userId || 'vido_user').slice(0, 128) },
    req_params: {
      text: String(text || '').slice(0, 10000),
      speaker: String(speaker || DEFAULT_VOICE),
      audio_params: {
        format: 'mp3',
        sample_rate: 24000,
        bit_rate: 64000,
        speech_rate: speedToRate(options.speed),
        loudness_rate: 0,
      },
      additions: JSON.stringify({
        post_process: { pitch: pitchToRate(options.pitch) },
        disable_markdown_filter: true,
        enable_latex_tn: false,
        latex_parser: 'v2',
      }),
    },
  };
  const key = String(options.apiKey || config.apiKey || '').trim();
  if (!key) throw Object.assign(new Error('字节豆包语音 API Key 未配置'), { code: 'TTS_PROVIDER_NOT_CONFIGURED' });
  const url = new URL(endpoint);
  const payload = Buffer.from(JSON.stringify(body));
  const requestId = crypto.randomUUID();
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': payload.length,
    'X-Api-Key': key,
    'X-Api-Resource-Id': resourceId,
    'X-Api-Request-Id': requestId,
  };
  const audio = await new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', headers }, res => {
      let pending = '';
      const audioChunks = [];
      let providerError = null;
      const consume = line => {
        const value = line.trim();
        if (!value.startsWith('data:')) return;
        let event;
        try { event = JSON.parse(value.slice(5).trim()); } catch { return; }
        if (event.code != null && ![0, 20000000].includes(Number(event.code))) {
          providerError = new Error(`字节豆包语音：${event.message || event.msg || `code=${event.code}`}`);
          providerError.providerCode = event.code;
          return;
        }
        if (event.data) audioChunks.push(Buffer.from(event.data, 'base64'));
      };
      res.setEncoding('utf8');
      res.on('data', chunk => {
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || '';
        lines.forEach(consume);
      });
      res.on('end', () => {
        if (pending) consume(pending);
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(providerError || new Error(`字节豆包语音 HTTP ${res.statusCode}`));
        if (providerError) return reject(providerError);
        if (!audioChunks.length) return reject(new Error('字节豆包语音未返回音频数据'));
        resolve(Buffer.concat(audioChunks));
      });
    });
    const abort = () => req.destroy(options.signal?.reason || Object.assign(new Error('TTS request aborted'), { code: 'ABORT_ERR' }));
    if (options.signal?.aborted) return abort();
    options.signal?.addEventListener?.('abort', abort, { once: true });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('字节豆包语音合成超时')));
    req.end(payload);
  });
  const mp3Path = String(outputPath).replace(/\.[^.]+$/, '') + '.mp3';
  fs.mkdirSync(path.dirname(mp3Path), { recursive: true });
  fs.writeFileSync(mp3Path, audio);
  return mp3Path;
}

async function enrollVoice(audioPath, options = {}) {
  const ext = path.extname(audioPath).slice(1).toLowerCase() || 'wav';
  const customId = String(options.customSpeakerId || '').trim();
  const body = {
    speaker_id: customId ? 'custom_speaker_id' : String(options.speakerId || ''),
    audio: { data: fs.readFileSync(audioPath).toString('base64'), format: ext },
    language: Number.isInteger(options.language) ? options.language : 0,
    extra_params: {
      demo_text: String(options.demoText || '你好，这是我的声音复刻效果试听。').slice(0, 300),
      enable_audio_denoise: options.enableAudioDenoise === true,
    },
  };
  if (customId) body.custom_speaker_id = customId;
  const result = await requestJson('/api/v3/tts/voice_clone', body, options);
  return {
    speaker_id: result.speaker_id || customId,
    status: Number(result.status),
    ready: [2, 4].includes(Number(result.status)),
    available_training_times: result.available_training_times,
    demo_audio: result.speaker_status?.find(item => Number(item.model_type) === 5)?.demo_audio || '',
    request_id: result.request_id,
  };
}

async function queryVoice(speakerId, options = {}) {
  const customId = String(speakerId || '').trim();
  const body = /^S_/i.test(customId)
    ? { speaker_id: customId }
    : { speaker_id: 'custom_speaker_id', custom_speaker_id: customId };
  const result = await requestJson('/api/v3/tts/get_voice', body, options);
  return {
    speaker_id: result.speaker_id || customId,
    status: Number(result.status),
    ready: [2, 4].includes(Number(result.status)),
    available_training_times: result.available_training_times,
    demo_audio: result.speaker_status?.find(item => Number(item.model_type) === 5)?.demo_audio || '',
    request_id: result.request_id,
  };
}

module.exports = {
  PROVIDER_ID,
  TTS_RESOURCE_ID,
  CLONE_RESOURCE_ID,
  DEFAULT_VOICE,
  providerConfig,
  hasKey,
  assertAllowedResource,
  synthesize,
  enrollVoice,
  queryVoice,
  _requestJson: requestJson,
};
