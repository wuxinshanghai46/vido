/**
 * 阿里 语音服务统一入口（支持两条独立产品线）
 *
 * A. DashScope 百炼 CosyVoice 2.0（provider id = aliyun-tts / dashscope）
 *    - Key 格式：sk-* (DashScope API Key)
 *    - 能做：voice_customization 训练（需开通白名单）→ 永久 voice_id → CosyVoice 合成
 *    - 文档：https://help.aliyun.com/zh/model-studio/cosyvoice-clone-api
 *
 * B. 智能语音交互 NLS（provider id = aliyun-nls）
 *    - Key 格式："{AppKey}:{AccessToken}" (冒号分隔，和火山对称)
 *      - AppKey: 16 位字符，对应 NLS 控制台创建的项目
 *      - AccessToken: 32 位 hex，NLS AccessToken（24h 过期但通常用长期 Key）
 *    - 能做：基础 TTS 合成 + 预设音色（无法克隆用户音色）
 *    - 文档：https://help.aliyun.com/zh/isi/developer-reference/restful-api-1
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_HOST = 'dashscope.aliyuncs.com';
const NLS_HOST = 'nls-gateway-cn-shanghai.aliyuncs.com';

function _getKey() {
  const { getApiKey } = require('./settingsService');
  return getApiKey('aliyun-tts')
    || getApiKey('dashscope')
    || getApiKey('aliyun')
    || process.env.DASHSCOPE_API_KEY
    || process.env.ALIYUN_DASHSCOPE_API_KEY
    || null;
}

function _getNLSCreds() {
  const { getApiKey } = require('./settingsService');
  const raw = getApiKey('aliyun-nls') || process.env.ALIYUN_NLS_CREDS || '';
  if (!raw || !raw.includes(':')) return null;
  const [appKey, token] = raw.split(':').map(s => s.trim());
  if (!appKey || !token) return null;
  return { appKey, token };
}

function hasNLSCreds() { return !!_getNLSCreds(); }

/**
 * 判断 token 类型
 *   - sk-xxx   → DashScope API Key（永久，Bearer Authorization）
 *   - 32 位 hex → NLS AccessToken（24h 过期，X-NLS-Token 头）
 *   - 其他     → 按 DashScope 处理
 */
function _tokenType(key) {
  if (!key) return 'unknown';
  if (/^sk-/.test(key)) return 'dashscope';
  if (/^[0-9a-f]{32}$/i.test(key)) return 'nls';
  return 'dashscope';
}

function _authHeaders(key) {
  const type = _tokenType(key);
  if (type === 'nls') {
    return { 'X-NLS-Token': key };
  }
  return { Authorization: 'Bearer ' + key };
}

function _post(pathname, body, extraHeaders = {}, hostOverride) {
  const apiKey = _getKey();
  if (!apiKey) return Promise.reject(new Error('阿里 API Key 未配置 (provider id = aliyun-tts / dashscope)'));
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const host = hostOverride || API_HOST;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      path: pathname,
      method: 'POST',
      headers: {
        ..._authHeaders(apiKey),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...extraHeaders,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try {
          const json = JSON.parse(text);
          if (res.statusCode >= 400 || json.code) return reject(new Error(`Aliyun ${res.statusCode}: ${json.message || json.code || text.slice(0, 200)}`));
          resolve(json);
        } catch (e) { reject(new Error(`Aliyun 响应解析失败 ${res.statusCode}: ${text.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Aliyun 请求超时')); });
    req.write(payload);
    req.end();
  });
}

function _get(pathname) {
  const apiKey = _getKey();
  if (!apiKey) return Promise.reject(new Error('阿里 API Key 未配置'));
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: API_HOST,
      path: pathname,
      method: 'GET',
      headers: _authHeaders(apiKey),
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try {
          const json = JSON.parse(text);
          if (res.statusCode >= 400) return reject(new Error(`Aliyun ${res.statusCode}: ${json.message || text.slice(0, 200)}`));
          resolve(json);
        } catch (e) { reject(new Error(`Aliyun 响应解析失败: ${text.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Aliyun 查询超时')); });
    req.end();
  });
}

/**
 * 阿里 CosyVoice 声音复刻（同步调用）
 *
 * 官方文档（2026-04 更新）：https://help.aliyun.com/zh/model-studio/cosyvoice-clone-design-api
 *
 * 关键变更（vs 旧异步版本）：
 *   - target_model: 'cosyvoice-v3.5-plus'（旧版 v2 已废弃）
 *   - 不带 X-DashScope-Async header（同步调用）
 *   - 直接从 output.voice_id 返回永久 voice_id
 *   - 不需要 task_id 轮询
 *   - 复刻和合成接口不同，合成走 /api/v1/services/audio/tts
 *
 * @param {string} audioUrl 公网可访问的参考音频 URL（WAV/MP3，16kHz+ 单声道，10-180s）
 * @param {object} opts { voicePrefix?: string, targetModel?: string, languageHint?: string }
 * @returns {Promise<{voice_id, request_id, task_id}>} task_id 兼容字段（其实就是 voice_id）
 */
async function enrollVoice(audioUrl, opts = {}) {
  const voicePrefix = (opts.voicePrefix || 'vido').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'vido';
  const apiKey = _getKey();
  const tokenType = _tokenType(apiKey);

  if (tokenType === 'nls') {
    throw new Error(
      '⚠️ 阿里产品线不对：\n' +
      '你在「智能语音交互 NLS」创建了项目 → 只能做基础 TTS，无法克隆声音。\n' +
      '声音克隆需要另一个产品「百炼 DashScope」的 sk-* API Key：\n' +
      '1) 开通百炼：https://dashscope.console.aliyun.com/apiKey（免费领 Key，CosyVoice 复刻不需要单独申请权限）\n' +
      '2) 在 VIDO 管理后台「AI 配置」aliyun-tts provider 填 sk-* Key'
    );
  }

  const targetModel = opts.targetModel || 'cosyvoice-v3.5-plus';
  const body = {
    model: 'voice-enrollment',
    input: {
      action: 'create_voice',
      target_model: targetModel,
      prefix: voicePrefix,
      url: audioUrl,
      language_hints: [opts.languageHint || 'zh'],
    },
  };

  console.log(`[Aliyun CosyVoice] 同步复刻 prefix=${voicePrefix} model=${targetModel}`);
  // 同步调用 — 不带 X-DashScope-Async header
  const resp = await _post('/api/v1/services/audio/tts/customization', body);

  const voiceId = resp?.output?.voice_id;
  if (!voiceId) {
    throw new Error('阿里 CosyVoice 复刻未返回 voice_id: ' + JSON.stringify(resp).slice(0, 300));
  }
  console.log(`[Aliyun CosyVoice] 复刻成功 voice_id=${voiceId}`);
  return {
    voice_id: voiceId,
    target_model: targetModel,
    request_id: resp?.request_id || null,
    // 兼容旧调用方：他们期待 task_id 字段，把 voice_id 也放进 task_id
    task_id: voiceId,
    status: 'SUCCEEDED',
  };
}

/**
 * （兼容旧调用）获取任务状态 — 同步版本下，voice_id 已是最终结果，直接返回 SUCCEEDED
 */
async function getTaskStatus(taskOrVoiceId) {
  // 同步复刻不再有真正的 task，传入的 id 实际就是 voice_id
  return {
    task_id: taskOrVoiceId,
    status: 'SUCCEEDED',
    voice_id: taskOrVoiceId,
    raw: { synchronous: true },
  };
}

/**
 * （兼容旧调用）waitForEnroll — 同步版本下立即返回
 */
async function waitForEnroll(taskOrVoiceId) {
  return getTaskStatus(taskOrVoiceId);
}

/**
 * 用已有 voice_id 合成语音（CosyVoice 仅支持 WebSocket，不支持 HTTP REST）
 *
 * 官方文档：https://help.aliyun.com/zh/model-studio/cosyvoice-websocket-api
 * 协议流程：
 *   1. WSS 连接 wss://dashscope.aliyuncs.com/api-ws/v1/inference/
 *   2. send run-task 帧（指定 model + voice + format）
 *   3. recv task-started 事件
 *   4. send continue-task 帧（input.text 实际合成内容）
 *   5. send finish-task 帧
 *   6. recv 多个 binary 音频帧（拼成完整文件）
 *   7. recv task-finished 事件 → 关闭
 *
 * @param {string} text     待合成文本
 * @param {string} voiceId  voice_id（格式 cosyvoice-v3.5-plus-vido-xxxxx）
 * @param {string} outputPath  输出 mp3 路径
 * @param {object} opts     { speed? , sampleRate? , model? , format? }
 * @returns {Promise<string>}  实际写入的文件路径
 */
// 内存 LRU 缓存：同 voice_id + text + speed 命中直接复制结果文件，省 5-10 秒 WebSocket 时间
const _synthCache = new Map();  // key → cachedFilePath
const _CACHE_MAX = 200;
function _cacheKey(voiceId, text, speed, format) {
  return `${voiceId}::${format}::${speed}::${text.length}::${text.slice(0,80)}::${require('crypto').createHash('md5').update(text).digest('hex').slice(0,12)}`;
}
function _cacheGet(key) {
  const v = _synthCache.get(key);
  if (v && fs.existsSync(v)) {
    // LRU: 命中后挪到末尾
    _synthCache.delete(key);
    _synthCache.set(key, v);
    return v;
  }
  if (v) _synthCache.delete(key);
  return null;
}
function _cacheSet(key, filePath) {
  _synthCache.set(key, filePath);
  while (_synthCache.size > _CACHE_MAX) {
    const oldest = _synthCache.keys().next().value;
    _synthCache.delete(oldest);
  }
}

async function synthesize(text, voiceId, outputPath, opts = {}) {
  const apiKey = _getKey();
  if (!apiKey) throw new Error('阿里百炼 API Key 未配置');
  if (!voiceId) throw new Error('阿里合成需要 voice_id');
  const cleanText = String(text || '').slice(0, 2000);
  if (!cleanText.trim()) throw new Error('合成文本不能为空');

  const format = (opts.format || 'mp3').toLowerCase();
  const outPath = outputPath.replace(/\.[^.]+$/, '') + '.' + format;
  const safeSpeed0 = Math.min(2.0, Math.max(0.5, Number(opts.speed) || 0.85));

  // 缓存命中：直接复制
  const cKey = _cacheKey(voiceId, cleanText, safeSpeed0, format);
  if (!opts.skipCache) {
    const cached = _cacheGet(cKey);
    if (cached) {
      try {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.copyFileSync(cached, outPath);
        console.log(`[Aliyun CosyVoice] 缓存命中 voice=${voiceId.slice(0,40)}... text=${cleanText.length}字`);
        return outPath;
      } catch (e) { /* 缓存文件读不到，继续走 WS */ }
    }
  }
  // 模型从 voice_id 自动推断（必须和复刻时 target_model 一致）
  // 真克隆 voice_id 必须用同 model；预设音色用 cosyvoice-v3-flash 速度最快
  const inferredModel = /cosyvoice-v3[\._-]?5[\._-]plus/i.test(voiceId) ? 'cosyvoice-v3.5-plus'
                      : /cosyvoice-v3-flash/i.test(voiceId) ? 'cosyvoice-v3-flash'
                      : /cosyvoice-v2/i.test(voiceId) ? 'cosyvoice-v2'
                      : 'cosyvoice-v3-flash';
  const model = opts.model || inferredModel;

  // v1 音色 → v3-flash/v3.5-plus 映射（cosyvoice v3 模型用 _v3 后缀的音色名）
  // 之前把所有女声都压到 longxiaochun_v3，导致前端选不同阿里音色听起来完全一样。
  // 这里按音色逐一映射，保持真实差异；如果阿里侧某个音色不可用，会明确报错给调用方。
  const V3_VOICE_MAP = {
    longxiaochun: 'longxiaochun_v3',
    longxiaoxia: 'longxiaoxia_v3',
    longxiaobai: 'longxiaobai_v3',
    longjing: 'longjing_v3',
    longshu: 'longshu_v3',
    longmiao: 'longmiao_v3',
    longtong: 'longtong_v3',
    longjingjing: 'longjingjing_v3',
    longyumi: 'longyumi_v3',
    longanyou: 'longanyou_v3',
    longxixi: 'longxixi_v3',
    longwan: 'longwan_v3',
    longshuo: 'longshuo_v3',
  };
  let actualVoice = voiceId;
  if (model === 'cosyvoice-v3-flash' || model === 'cosyvoice-v3.5-plus') {
    if (/^long\w+$/.test(voiceId) && !/_v[23]$/.test(voiceId)) {
      actualVoice = V3_VOICE_MAP[voiceId] || voiceId;
    }
    if (actualVoice !== voiceId) {
      console.log(`[Aliyun CosyVoice] 音色映射 ${voiceId} → ${actualVoice} (${model})`);
    }
  }
  const safeSpeed = safeSpeed0;
  const sampleRate = opts.sampleRate || 22050;

  const WebSocket = require('ws');
  const { v4: uuidv4 } = require('uuid');
  const taskId = uuidv4().replace(/-/g, '');

  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://dashscope.aliyuncs.com/api-ws/v1/inference/', {
      headers: {
        Authorization: 'bearer ' + apiKey,
        'X-DashScope-DataInspection': 'enable',
      },
      handshakeTimeout: 15000,
    });

    const audioChunks = [];
    let started = false;
    let finished = false;
    const timeout = setTimeout(() => {
      if (!finished) {
        try { ws.close(); } catch {}
        reject(new Error('CosyVoice WebSocket 合成超时（90s）'));
      }
    }, 90000);

    ws.on('open', () => {
      const runTask = {
        header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio',
          task: 'tts',
          function: 'SpeechSynthesizer',
          model,
          parameters: {
            text_type: 'PlainText',
            voice: actualVoice,
            format,
            sample_rate: sampleRate,
            volume: 50,
            rate: safeSpeed,
            pitch: 1,
          },
          input: {},
        },
      };
      ws.send(JSON.stringify(runTask));
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary || Buffer.isBuffer(data) && data[0] !== 0x7B /* { */) {
        // 音频二进制
        audioChunks.push(data);
        return;
      }
      try {
        const msg = JSON.parse(data.toString());
        const event = msg?.header?.event;
        if (event === 'task-started') {
          started = true;
          // send continue-task with text
          ws.send(JSON.stringify({
            header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
            payload: { input: { text: cleanText } },
          }));
          // immediately finish
          ws.send(JSON.stringify({
            header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
            payload: { input: {} },
          }));
        } else if (event === 'task-finished') {
          finished = true;
          clearTimeout(timeout);
          try { ws.close(); } catch {}
          if (!audioChunks.length) return reject(new Error('CosyVoice 未收到音频数据'));
          const buf = Buffer.concat(audioChunks);
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, buf);
          // 写缓存（用一份独立缓存目录避免被业务方删掉）
          try {
            const cacheDir = path.resolve(__dirname, '../../outputs/_cosy_cache');
            fs.mkdirSync(cacheDir, { recursive: true });
            const cachePath = path.join(cacheDir, require('crypto').createHash('md5').update(cKey).digest('hex') + '.' + format);
            fs.copyFileSync(outPath, cachePath);
            _cacheSet(cKey, cachePath);
          } catch {}
          console.log(`[Aliyun CosyVoice] WS 合成成功 voice=${voiceId.slice(0,40)}... text=${cleanText.length}字 → ${buf.length} bytes`);
          resolve(outPath);
        } else if (event === 'task-failed') {
          finished = true;
          clearTimeout(timeout);
          try { ws.close(); } catch {}
          const errMsg = msg?.header?.error_message || msg?.payload?.error_message || JSON.stringify(msg).slice(0, 300);
          const errCode = msg?.header?.error_code || msg?.payload?.error_code || '-';
          // 失败上下文打点：方便复现 418 这类内部错误码
          console.warn('[Aliyun CosyVoice] task-failed', JSON.stringify({
            errCode,
            errMsg,
            voiceId: voiceId,
            actualVoice,
            model,
            format,
            sampleRate,
            speed: safeSpeed,
            textLen: (cleanText || '').length,
            textHead: (cleanText || '').slice(0, 40),
            taskId,
            requestId: msg?.header?.request_id || null,
          }));
          reject(new Error(`CosyVoice 合成失败 [errCode=${errCode}]: ${errMsg} (voice=${voiceId} model=${model} text=${(cleanText||'').length}字)`));
        }
        // 其他事件（result-generated 等）忽略
      } catch (e) {
        console.warn('[Aliyun CosyVoice] 解析消息失败:', e.message, data.toString().slice(0, 200));
      }
    });

    ws.on('error', err => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(new Error(`CosyVoice WebSocket 错误: ${err.message}`));
    });

    ws.on('close', (code, reason) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (!started) reject(new Error(`CosyVoice WebSocket 异常关闭 (${code}): ${reason}`));
      else if (!audioChunks.length) reject(new Error('CosyVoice WebSocket 关闭但未拿到音频'));
    });
  });
}

function hasKey() { return !!_getKey(); }

/**
 * 阿里 NLS · 基础 TTS 合成（REST，使用 AppKey + AccessToken）
 * 无法克隆用户音色，只能选预设音色
 *
 * @param {string} text 合成文本（≤ 300 字符建议）
 * @param {string} outputPath 输出路径（会自动补 .mp3）
 * @param {object} opts { voice?: string, speed?: number, volume?: number, pitch?: number, format?: 'mp3'|'wav'|'pcm', sampleRate?: number }
 * @returns {Promise<string>} 实际输出文件路径
 */
function synthesizeWithNLS(text, outputPath, opts = {}) {
  const creds = _getNLSCreds();
  if (!creds) return Promise.reject(new Error('阿里 NLS 未配置 (provider id = aliyun-nls, api_key 格式 "{AppKey}:{AccessToken}")'));
  if (!text || !text.trim()) return Promise.reject(new Error('NLS 合成文本不能为空'));

  const format = (opts.format || 'mp3').toLowerCase();
  const extMap = { mp3: '.mp3', wav: '.wav', pcm: '.pcm' };
  const outPath = outputPath.replace(/\.[^.]+$/, '') + (extMap[format] || '.mp3');

  // 速度映射：VIDO 的 speed 是 0.5-1.5，NLS 的 speech_rate 是 -500..500
  const rate = Math.round(((Number(opts.speed) || 1.0) - 1) * 500);

  const body = JSON.stringify({
    appkey: creds.appKey,
    token: creds.token,
    text: String(text).slice(0, 300),
    format,
    sample_rate: opts.sampleRate || 16000,
    voice: opts.voice || 'xiaoyun',
    volume: Math.max(0, Math.min(100, opts.volume || 50)),
    speech_rate: Math.max(-500, Math.min(500, rate)),
    pitch_rate: Math.max(-500, Math.min(500, opts.pitch || 0)),
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: NLS_HOST,
      path: '/stream/v1/tts',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = res.headers['content-type'] || '';
        if (ct.includes('audio')) {
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, buf);
          return resolve(outPath);
        }
        try {
          const json = JSON.parse(buf.toString());
          reject(new Error(`阿里 NLS TTS 失败: ${json.message || json.status || buf.toString().slice(0, 200)}`));
        } catch (e) {
          reject(new Error(`阿里 NLS TTS 响应非音频 (${res.statusCode}): ${buf.toString().slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('阿里 NLS TTS 超时')); });
    req.write(body);
    req.end();
  });
}

module.exports = { enrollVoice, getTaskStatus, waitForEnroll, synthesize, hasKey, synthesizeWithNLS, hasNLSCreds };
