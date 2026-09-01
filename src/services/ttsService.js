/**
 * TTS 语音合成服务
 * 字节豆包语音 2.0 是当前唯一权威 TTS 链路。
 * 自定义克隆音色：只走字节声音复刻 2.0，失败立即报错且不回退默认女声。
 */
require('dotenv').config();
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../outputs'));
const BAD_PREVIEW_VOICES_FILE = path.join(OUTPUT_DIR, 'avatar', 'bad_preview_voices.json');

function readBadPreviewVoices() {
  try {
    const rows = JSON.parse(fs.readFileSync(BAD_PREVIEW_VOICES_FILE, 'utf8'));
    return new Set(Array.isArray(rows) ? rows.filter(Boolean).map(String) : []);
  } catch {
    return new Set();
  }
}

function markBadPreviewVoices(voiceIds = []) {
  const bad = readBadPreviewVoices();
  voiceIds.filter(Boolean).map(String).forEach(id => bad.add(id));
  fs.mkdirSync(path.dirname(BAD_PREVIEW_VOICES_FILE), { recursive: true });
  fs.writeFileSync(BAD_PREVIEW_VOICES_FILE, JSON.stringify([...bad], null, 2), 'utf8');
}

function isTtsBillingError(error) {
  return /\b429\b|余额不足|资源包|请充值|insufficient (?:balance|quota|credit)|quota exceeded/i.test(String(error?.message || error || ''));
}

function isTtsVoiceError(error) {
  const text = String(error?.message || error || '');
  if (isTtsBillingError(error) || /Arrearage|account is in good standing|API.?Key|Unauthorized|Forbidden|WebSocket|超时|连接/i.test(text)) return false;
  return /InvalidParameter|invalid voice|voice.*(?:not found|unsupported|不存在|不支持)|音色.*(?:无效|不存在|不支持)/i.test(text);
}

/**
 * 生成语音文件
 * @param {string} text - 要合成的文字
 * @param {string} outputPath - 输出文件路径（无扩展名）
 * @param {object} options - { gender: 'female'|'male', speed: 1.0, voiceId: null }
 * @returns {string|null} 生成的音频文件路径，失败返回 null
 */
async function generateSpeech(text, outputPath, { gender = 'female', speed = 1.0, pitch = 1.0, voiceId = null, providerId = '', strictProvider = false, instruction = '', signal = null, userId = '', requestBaseUrl = '' } = {}) {
  if (!text || !text.trim()) return null;
  if (signal?.aborted) throw signal.reason || Object.assign(new Error('TTS request aborted'), { code: 'ABORT_ERR' });

  voiceId = await require('./voicePackEnrollmentService').resolveVoiceForAccount(voiceId, { userId, requestBaseUrl });

  // 自定义声音：如果选择了用户上传的声音，用声音克隆
  if (voiceId && (voiceId.startsWith('custom_') || voiceId.startsWith('custom:'))) {
    const result = await _generateWithCustomVoice(text, outputPath, { voiceId, speed, pitch, instruction, signal, userId });
    if (result) {
      console.log(`[TTS] 使用自定义声音 ${voiceId} 生成成功`);
      return _postProcessAudio(result);
    }
    // 不静默回退 — 用户明确选了自定义声音，失败就报错
    throw new Error('自定义声音合成失败，请检查声音文件或配置字节豆包语音 TTS API Key');
  }

  // 新合同：普通配音只走独立的 volcengine-tts 供应商。
  // 该供应商只能调用 seed-tts-2.0 / seed-icl-2.0，不得调用字节其他模型。
  const selectedProvider = String(providerId || voiceProviderForId(voiceId) || '').toLowerCase();
  const chain = [
    { id: 'volcengine-tts', name: '字节豆包语音 2.0', fn: generateWithVolcEngine, opts: { gender, speed, pitch, voiceId, instruction, signal, userId } },
  ].filter(item => !selectedProvider || !strictProvider || item.id === selectedProvider);

  if (strictProvider && selectedProvider && !chain.length) {
    throw new Error(`所选音色的供应商 ${selectedProvider} 当前不支持独立试听`);
  }

  const errors = [];
  for (const { id, name, fn, opts } of chain) {
    if (signal?.aborted) throw signal.reason || Object.assign(new Error('TTS request aborted'), { code: 'ABORT_ERR' });
    const apiKey = _getTTSKey(id);
    if (!apiKey) { errors.push(`${name}: 未配置 API Key`); continue; }
    const startedAt = Date.now();
    try {
      const result = await fn(text, outputPath, { ...opts, apiKey });
      if (result) {
        console.log(`[TTS] 使用 ${name} 生成成功`);
        // 豆包语音 2.0 按字符计费。
        try {
          require('./tokenTracker').record({
            provider: id, model: 'seed-tts-2.0',
            category: 'tts', ttsChars: (text || '').length,
            durationMs: Date.now() - startedAt, status: 'success',
          });
        } catch {}
        return _postProcessAudio(result);
      }
      errors.push(`${name}: 返回空结果`);
    } catch (err) {
      console.warn(`[TTS] ${name} 失败: ${err.message}`);
      errors.push(`${name}: ${err.message}`);
      try {
        require('./tokenTracker').record({
          provider: id, model: 'seed-tts-2.0',
          category: 'tts', ttsChars: (text || '').length,
          durationMs: Date.now() - startedAt, status: 'fail', errorMsg: err.message,
        });
      } catch {}
    }
  }

  console.warn('[TTS] 字节豆包语音全部失败：' + errors.join(' | '));
  if (strictProvider) {
    const detail = errors.join(' | ');
    const error = new Error(detail || '所选语音供应商当前不可用');
    if (/余额|欠费|quota|resource package|insufficient/i.test(detail)) error.code = 'TTS_PROVIDER_BILLING';
    else if (/未配置 API Key/i.test(detail)) error.code = 'TTS_PROVIDER_NOT_CONFIGURED';
    else error.code = 'TTS_PROVIDER_UNAVAILABLE';
    throw error;
  }
  // 返回 null 让上游决定是 throw 还是 fallback；不再用 SAPI/默认女声替代
  return null;
}

// 后处理：仅对开头可能的 click/beep 做一次短暂的淡入（30ms），不再主动 silenceremove。
// 之前的 silenceremove 用 peak detection + -40dB 阈值，对部分低响度的克隆合成音频会误剪
// 有效人声片段，导致听感"一开头就快进一段"或"滴声后半句没了"。
// 改为：只加一个 30ms 的 fade-in，把硬边削掉，不删除任何样本。
function _postProcessAudio(audioPath) {
  if (!audioPath || !fs.existsSync(audioPath)) return audioPath;
  try {
    const ffmpegPath = (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== 'ffmpeg')
      ? process.env.FFMPEG_PATH : require('ffmpeg-static');
    if (!ffmpegPath) return audioPath;
    const { execSync } = require('child_process');
    const ext = (path.extname(audioPath) || '.mp3').toLowerCase();
    const dir = path.dirname(audioPath);
    const base = path.basename(audioPath, ext);
    const outPath = path.join(dir, `${base}_clean${ext}`);
    const codec = ext === '.wav' ? 'pcm_s16le' : 'libmp3lame';
    const codecArgs = codec === 'libmp3lame' ? `-c:a ${codec} -q:a 3` : `-c:a ${codec}`;
    // 只做 30ms 淡入，消除开头硬边引起的 click / "滴"声；不剪样本、不改长度。
    const af = 'afade=t=in:st=0:d=0.03';
    execSync(
      `"${ffmpegPath}" -y -i "${audioPath}" -af "${af}" ${codecArgs} "${outPath}"`,
      { stdio: 'pipe', timeout: 15000 }
    );
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 500) {
      try { fs.unlinkSync(audioPath); } catch {}
      fs.renameSync(outPath, audioPath);
    }
  } catch (err) {
    console.warn('[TTS] 开头淡入后处理失败（用原音频）:', err.message);
  }
  return audioPath;
}

function _getTTSKey(providerId) {
  try {
    const { loadSettings } = require('./settingsService');
    const settings = loadSettings();
    const p = settings.providers.find(p => p.id === providerId && p.enabled && p.api_key);
    if (!p) return '';
    // Do not permanently hide a TTS vendor just because an old health check
    // failed. Individual unusable voices are filtered by preview-voice after a
    // real synthesis attempt, which avoids losing the whole Aliyun pool due to
    // stale provider metadata.
    // Some production providers were saved before per-model metadata existed.
    // If a TTS provider has a valid key but no models array, treat it as usable
    // and fall back to the provider's built-in/default voice pool.
    const models = Array.isArray(p.models) ? p.models : [];
    const hasTTS = models.length === 0 || models.some(m => m.enabled !== false && m.use === 'tts');
    return hasTTS ? p.api_key : '';
  } catch { return ''; }
}

function _getTTSModel(providerId) {
  try {
    const { loadSettings } = require('./settingsService');
    const settings = loadSettings();
    const p = settings.providers.find(p => p.id === providerId && p.enabled);
    return (p?.models || []).find(m => m.enabled !== false && m.use === 'tts') || null;
  } catch { return null; }
}

// ═══════════════════════════════════════════
// 自定义声音克隆
// 策略1: Fish Audio — 上传参考音频作为 reference，用 reference_id 生成
// 策略2: 回退到基础 TTS + FFmpeg 音色微调
// ═══════════════════════════════════════════

/**
 * 上传音频到 Fish Audio 创建声音克隆 reference
 * @returns {string|null} reference_id
 */
async function uploadVoiceToFishAudio(voiceFilePath, voiceName, apiKey) {
  const audioData = fs.readFileSync(voiceFilePath);
  const boundary = '----VidoVoiceClone' + Date.now();
  const ext = path.extname(voiceFilePath).slice(1) || 'mp3';
  const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', webm: 'audio/webm' };

  // multipart/form-data 构建
  const parts = [];
  // id 字段
  const refId = 'vido_' + voiceName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20) + '_' + Date.now();
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="id"\r\n\r\n${refId}`);
  // text 字段（参考文本，可选）
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="text"\r\n\r\n${voiceName}`);
  // audio 字段
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="ref.${ext}"\r\nContent-Type: ${mimeMap[ext] || 'audio/mpeg'}\r\n\r\n`);

  const bodyStart = Buffer.from(parts.join('\r\n') + '\r\n');
  const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([bodyStart, audioData, bodyEnd]);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.fish.audio',
      path: '/v1/references/add',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`Fish Audio 上传失败 (${res.statusCode}): ${data}`));
        }
        console.log(`[TTS] Fish Audio 声音克隆上传成功: ${refId}`);
        resolve(refId);
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Fish Audio 上传超时')); });
    req.write(body);
    req.end();
  });
}

async function _generateWithCustomVoice(text, outputPath, { voiceId, speed = 1.0, pitch = 1.0, instruction = '', signal = null, userId = '' }) {
  const db = require('../models/database');
  const voice = db.getVoice(voiceId);
  if (userId && (!voice || String(voice.user_id || '') !== String(userId))) {
    const error = new Error('所选声音不属于当前账号');
    error.code = 'VOICE_ACCOUNT_MISMATCH';
    error.status = 403;
    throw error;
  }
  if (!voice?.file_path || !fs.existsSync(voice.file_path)) {
    throw new Error(`自定义声音 ${voiceId} 文件不存在`);
  }

  // 新合同：自定义声音只能使用字节声音复刻 2.0 的已就绪 speaker_id。
  const hasVolcReady = !!voice.volc_speaker_id && voice.status === 'ready';
  if (!hasVolcReady) {
    const status = voice.status || 'unknown';
    const reason = status === 'training'
      ? '还在训练中（约 3-15 分钟），请稍后再试'
      : `未完成字节声音复刻 2.0（volc_speaker_id 为空或不可用，status=${status}）`;
    throw new Error(`"${voice.name || voiceId}" ${reason}。请去「声音克隆」页面重新上传录音。`);
  }

  // 字节声音复刻 2.0（seed-icl-2.0 唯一通道）。
  try {
    const volc = require('./volcengineSpeechService');
    if (!volc.hasKey()) throw new Error('未配置字节豆包语音 API Key（后台 AI 配置 → 字节豆包语音 TTS）');
    const result = await volc.synthesize(text, voice.volc_speaker_id, outputPath, {
      speed, pitch, signal, userId, cloned: true,
    });
    if (result && fs.existsSync(result) && fs.statSync(result).size > 100) {
      console.log(`[TTS] 字节声音复刻 2.0 合成成功: ${voice.name} speaker_id=${voice.volc_speaker_id}`);
      return result;
    }
    throw new Error('字节声音复刻 2.0 返回空结果');
  } catch (err) {
    throw new Error(`"${voice.name || voiceId}" 字节复刻合成失败: ${err.message}`);
  }
}

// ═══════════════════════════════════════════
// 阿里云 CosyVoice 声音克隆（通过参考音频）
// ═══════════════════════════════════════════
async function _cloneWithCosyVoice(text, outputPath, refAudioPath, { speed = 0.85, apiKey }) {
  const mp3Path = outputPath.replace(/\.[^.]+$/, '') + '.mp3';
  const refAudioBuf = fs.readFileSync(refAudioPath);
  const refBase64 = refAudioBuf.toString('base64');
  const ext = path.extname(refAudioPath).slice(1) || 'wav';

  // rate 限制 0.5-1.5，默认 0.85（中文自然语速）· 1.0 对中文会偏快
  const safeSpeed = Math.min(1.5, Math.max(0.5, Number(speed) || 0.85));

  const body = JSON.stringify({
    model: 'cosyvoice-clone-v1',
    input: { text: text.substring(0, 5000) },
    parameters: { voice: `data:audio/${ext};base64,${refBase64}`, format: 'mp3', rate: safeSpeed }
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'dashscope.aliyuncs.com',
      path: '/api/v1/services/aigc/text2audio/text-synthesis',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      if (res.headers['content-type']?.includes('audio')) {
        // 流式返回音频
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          fs.mkdirSync(path.dirname(mp3Path), { recursive: true });
          fs.writeFileSync(mp3Path, Buffer.concat(chunks));
          resolve(mp3Path);
        });
      } else {
        let errData = '';
        res.on('data', c => errData += c);
        res.on('end', () => reject(new Error(`CosyVoice ${res.statusCode}: ${errData.substring(0, 200)}`)));
      }
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('CosyVoice 超时')); });
    req.write(body);
    req.end();
  });
}

// ═══════════════════════════════════════════
// MiniMax 声音克隆（T2A v2 + voice_clone 模式）
// ═══════════════════════════════════════════
async function _cloneWithMiniMax(text, outputPath, refAudioPath, { speed = 1.0, apiKey }) {
  const mp3Path = outputPath.replace(/\.[^.]+$/, '') + '.mp3';

  // 读取参考音频作为 base64，通过 file_upload 上传
  const refAudioBuf = fs.readFileSync(refAudioPath);

  // MiniMax T2A v2 支持 voice_clone: 传 audio_sample_file_url 或 inline
  // 使用 multipart 上传参考音频 + 文本
  const FormData = await (async () => {
    try { return require('form-data'); } catch { return null; }
  })();

  // 用 JSON 模式 + timber_weights（参考音色权重）
  const body = JSON.stringify({
    model: 'speech-01-turbo',
    text: text.substring(0, 5000),
    voice_setting: {
      voice_id: 'male-qingxin',
      speed: Math.min(2.0, Math.max(0.5, speed)),
      vol: 1.0
    },
    audio_setting: { format: 'mp3', sample_rate: 32000 },
    // 传参考音频 base64 做 voice clone
    voice_clone: {
      voice_audio: 'data:audio/' + (path.extname(refAudioPath).slice(1) || 'wav') + ';base64,' + refAudioBuf.toString('base64')
    }
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.minimaxi.chat',
      path: '/v1/t2a_v2?GroupId=0',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          if (json.base_resp?.status_code !== 0) return reject(new Error('MiniMax 克隆TTS: ' + (json.base_resp?.status_msg || '未知错误')));
          const hexAudio = json.data?.audio;
          if (!hexAudio) return reject(new Error('MiniMax 克隆TTS 未返回音频'));
          fs.mkdirSync(path.dirname(mp3Path), { recursive: true });
          fs.writeFileSync(mp3Path, Buffer.from(hexAudio, 'hex'));
          resolve(mp3Path);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('MiniMax 克隆TTS 超时')); });
    req.write(body);
    req.end();
  });
}

// ═══════════════════════════════════════════
// 智谱 GLM-TTS（OpenAI 兼容格式）
// 音色：tongtong（彤彤）、chuichui（锤锤）、xiaochen（小陈）、
//       jam、kazi、douji、luodo
// ═══════════════════════════════════════════
const ZHIPU_VOICES = {
  female: 'tongtong',
  male: 'chuichui',
  child: 'tongtong',
  // 前端预设音色映射到智谱实际音色
  'female-sweet': 'tongtong',
  'female-pro': 'xiaochen',
  'male-mature': 'chuichui',
  'male-young': 'jam',
  'child': 'tongtong',
};

const ZHIPU_PUBLIC_VOICE_IDS = new Set([
  'tongtong', 'xiaochen', 'chuichui', 'jam', 'kazi', 'douji', 'luodo',
]);

function voiceProviderForId(voiceId = '') {
  const id = String(voiceId || '').trim();
  if (!id) return '';
  if (ZHIPU_PUBLIC_VOICE_IDS.has(id) || Object.prototype.hasOwnProperty.call(ZHIPU_VOICES, id)) return 'zhipu';
  if (require('./volcengineSpeechCatalog').voiceIds.has(id)) return 'volcengine-tts';
  if (/^custom[_:]/i.test(id)) return 'custom';
  return '';
}

async function generateWithZhipu(text, outputPath, { gender, speed, voiceId, apiKey }) {
  const OpenAI = require('openai');
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://open.bigmodel.cn/api/paas/v4'
  });

  let voice = ZHIPU_VOICES[voiceId] || voiceId || ZHIPU_VOICES[gender] || 'tongtong';
  const model = _getTTSModel('zhipu');
  if (model?.id && model.id !== 'glm-tts' && !voiceId) voice = model.id;

  const mp3Path = outputPath.replace(/\.[^.]+$/, '') + '.wav';

  const response = await client.audio.speech.create({
    model: 'glm-tts',
    voice,
    input: text.substring(0, 1024),
    response_format: 'wav',
    speed: Math.min(2.0, Math.max(0.5, speed))
  });

  fs.mkdirSync(path.dirname(mp3Path), { recursive: true });
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(mp3Path, buffer);
  console.log(`[TTS] 智谱 GLM-TTS 合成成功: ${voice}, ${buffer.length} bytes`);
  return mp3Path;
}

// ═══════════════════════════════════════════
// 字节豆包语音 TTS 2.0（新版控制台 API Key + V3 SSE）。
// ═══════════════════════════════════════════
const VOLC_VOICES = {
  female: 'zh_female_vv_uranus_bigtts',
  male: 'zh_male_m191_uranus_bigtts',
  child: 'zh_male_tiancaitongsheng_uranus_bigtts',
  'female-sweet': 'zh_female_tianmeitaozi_uranus_bigtts',
  'female-pro': 'zh_female_zhixingnv_uranus_bigtts',
  'male-mature': 'zh_male_cixingjieshuonan_uranus_bigtts',
  'male-young': 'zh_male_yangguangqingnian_uranus_bigtts',
};

async function generateWithVolcEngine(text, outputPath, { gender, speed, pitch, voiceId, apiKey, signal, userId }) {
  let voice = VOLC_VOICES[voiceId] || voiceId || VOLC_VOICES[gender] || VOLC_VOICES.female;
  return require('./volcengineSpeechService').synthesize(text, voice, outputPath, {
    speed, pitch, apiKey, signal, userId, cloned: false,
  });
}

// ═══════════════════════════════════════════
// 百度语音合成（短文本合成 + 长文本合成）
// API Key 格式：APIKey:SecretKey
// 音色（per）：
//   0=度小美(标准女声) 1=度小宇(标准男声) 3=度逍遥(情感男声) 4=度丫丫(萝莉女声)
//   5=度小娇(情感女声) 106=度博文(新闻男声) 110=度小童(童声) 111=度小萌(萌宝童声)
//   5003=度米朵(甜美女声) 5118=度小鹿(知性女声)
// ═══════════════════════════════════════════
const BAIDU_VOICES = {
  female: 5003,   // 度米朵(甜美)
  male: 106,      // 度博文(新闻播报)
  // 扩展
  'duxiaomei': 0, 'duxiaoyu': 1, 'duxiaoyao': 3, 'duyaya': 4,
  'duxiaojiao': 5, 'dubowen': 106, 'duxiaotong': 110, 'duxiaomeng': 111,
  'dumiduo': 5003, 'duxiaolu': 5118,
};

async function generateWithBaidu(text, outputPath, { gender, speed, voiceId, apiKey }) {
  // Key 格式：APIKey:SecretKey
  const [ak, sk] = apiKey.split(':');
  if (!ak || !sk) throw new Error('百度语音 Key 格式错误，应为 APIKey:SecretKey');

  // 先获取 access_token
  const tokenUrl = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${ak}&client_secret=${sk}`;
  const tokenResp = await _httpPost(tokenUrl, '');
  const tokenJson = JSON.parse(tokenResp);
  if (!tokenJson.access_token) throw new Error('百度语音获取 token 失败');
  const token = tokenJson.access_token;

  // 选择音色
  let per = voiceId ? (BAIDU_VOICES[voiceId] !== undefined ? BAIDU_VOICES[voiceId] : (parseInt(voiceId) || 0)) : (BAIDU_VOICES[gender] || 5003);
  const model = _getTTSModel('baidu');
  if (model?.id && !voiceId) {
    per = BAIDU_VOICES[model.id] !== undefined ? BAIDU_VOICES[model.id] : (parseInt(model.id) || per);
  }

  const mp3Path = outputPath.replace(/\.[^.]+$/, '') + '.mp3';
  const spd = Math.round(Math.min(15, Math.max(0, (speed - 0.5) * 10)));

  const params = new URLSearchParams({
    tex: text.substring(0, 2048),
    tok: token,
    cuid: 'VIDO_APP',
    ctp: '1',
    lan: 'zh',
    spd: String(spd),
    pit: '5',
    vol: '5',
    per: String(per),
    aue: '3'  // mp3
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'tsn.baidu.com',
      path: '/text2audio',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(params.toString())
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = res.headers['content-type'] || '';
        if (ct.includes('audio')) {
          fs.mkdirSync(path.dirname(mp3Path), { recursive: true });
          fs.writeFileSync(mp3Path, buf);
          resolve(mp3Path);
        } else {
          try {
            const json = JSON.parse(buf.toString());
            reject(new Error('百度语音: ' + (json.err_msg || json.err_no)));
          } catch {
            reject(new Error('百度语音返回格式错误'));
          }
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('百度语音连接超时')); });
    req.write(params.toString());
    req.end();
  });
}

// ═══════════════════════════════════════════
// 阿里云 TTS（CosyVoice / 通义语音合成）
// API Key 格式：DashScope API Key
// 音色列表：
//   女声：longxiaochun（龙小淳·温柔）、longxiaoxia（龙小夏·热情）、longlaotie（龙老铁·东北）
//         longmiao（龙喵·软萌）、longshu（龙姝·知性）、longjing（龙婧·新闻播报）
//   男声：longcheng（龙城·沉稳）、longhua（龙华·儒雅）、longyuan（龙远·磁性）
//         longfei（龙飞·激昂）、longxiang（龙翔·阳光）
//   童声：longshuo（龙硕·童声男）、longtong（龙童·童声女）
//   方言：longwan（龙湾·粤语）、longyu（龙渝·重庆话）
// ═══════════════════════════════════════════
const ALI_VOICES = {
  female: 'longxiaochun_v3',
  male: 'longcheng',
};

// 阿里 TTS 现在统一走 aliyunVoiceService.synthesize（CosyVoice WebSocket）
// CosyVoice 已经不支持 HTTP REST 了，旧的 cosyvoice-v1 HTTP 端点已停服
async function generateWithAliyunTTS(text, outputPath, { gender, speed, pitch, voiceId, apiKey, instruction = '', signal = null }) {
  const voice = voiceId || ALI_VOICES[gender] || 'longxiaochun';
  const aliyun = require('./aliyunVoiceService');
  // aliyunVoiceService.synthesize 自动从 voice id 推断 model（v3-flash for 预设/v3.5-plus for 真克隆）
  try {
    return await aliyun.synthesize(text, voice, outputPath, { speed, pitch, instruction, signal });
  } catch (err) {
    const msg = String(err?.message || '');
    if (instruction && /instruction|invalid|parameter|param|unsupported|not support|不支持|参数|字段/i.test(msg)) {
      console.warn(`[TTS] CosyVoice instruction 失败，降级为无 instruction 合成: ${msg}`);
      return aliyun.synthesize(text, voice, outputPath, { speed, pitch, instruction: '', signal });
    }
    throw err;
  }
}

async function _downloadUrlToFile(url, outputPath) {
  const target = path.extname(outputPath) ? outputPath : outputPath + '.mp3';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const client = /^https:/i.test(url) ? https : http;
  await new Promise((resolve, reject) => {
    const req = client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return _downloadUrlToFile(res.headers.location, target).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`download failed HTTP ${res.statusCode}`));
      }
      const ws = fs.createWriteStream(target);
      res.pipe(ws);
      ws.on('finish', () => ws.close(resolve));
      ws.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('download timeout')));
  });
  return target;
}

async function generateWithHiflyTTS(text, outputPath, { voiceId, speed }) {
  const hiflyVoice = String(voiceId || '').replace(/^hifly:/, '');
  if (!hiflyVoice) throw new Error('飞影音色 ID 为空');
  const hifly = require('./hiflyService');
  const taskId = await hifly.createAudioByTTS({
    voice: hiflyVoice,
    text,
    title: `vido${Date.now()}`,
    aigc_flag: 1,
  });
  const done = await hifly.waitAudioTask(taskId, { intervalMs: 3000, timeoutMs: 5 * 60 * 1000 });
  const audioUrl = done.audio_url;
  if (!audioUrl) throw new Error('飞影音频任务未返回音频地址');
  return _downloadUrlToFile(audioUrl, outputPath.endsWith('.mp3') ? outputPath : outputPath + '.mp3');
}

async function pollAliyunTTSTask(taskId, apiKey, mp3Path) {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const resp = await new Promise((resolve, reject) => {
      https.get(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
        headers: { 'Authorization': 'Bearer ' + apiKey }
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
      }).on('error', reject);
    });

    if (resp.output?.task_status === 'SUCCEEDED') {
      const audioUrl = resp.output?.results?.[0]?.url;
      if (!audioUrl) throw new Error('阿里云 TTS 未返回音频 URL');
      await _downloadToFile(audioUrl, mp3Path);
      return mp3Path;
    }
    if (resp.output?.task_status === 'FAILED') throw new Error('阿里云 TTS 合成失败');
  }
  throw new Error('阿里云 TTS 超时');
}

// ——— Fish Audio TTS（中文/多语言极自然）———
async function generateWithFishAudio(text, outputPath, { gender, speed, apiKey }) {
  let referenceId = null;
  try {
    const { loadSettings } = require('./settingsService');
    const settings = loadSettings();
    const p = settings.providers.find(p => p.id === 'fishaudio' && p.enabled);
    const m = (p?.models || []).find(m => m.enabled !== false && m.use === 'tts');
    if (m?.id && m.id !== 'speech-1.5') referenceId = m.id;
  } catch {}

  const mp3Path = outputPath.replace(/\.[^.]+$/, '') + '.mp3';

  const body = JSON.stringify({
    text: text.substring(0, 10000),
    ...(referenceId ? { reference_id: referenceId } : {}),
    format: 'mp3',
    latency: 'normal',
    normalize: true,
    streaming: false
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.fish.audio',
      path: '/v1/tts',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error('Fish Audio HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        fs.mkdirSync(path.dirname(mp3Path), { recursive: true });
        fs.writeFileSync(mp3Path, Buffer.concat(chunks));
        resolve(mp3Path);
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Fish Audio 连接超时')); });
    req.write(body);
    req.end();
  });
}

// ——— MiniMax TTS（中文优质，多种音色）———
async function generateWithMiniMaxTTS(text, outputPath, { gender, speed, apiKey }) {
  const voiceId = gender === 'female' ? 'female-tianmei' : 'male-qingxin';
  let modelId = 'speech-01-turbo';
  try {
    const { loadSettings } = require('./settingsService');
    const settings = loadSettings();
    const p = settings.providers.find(p => p.id === 'minimax' && p.enabled);
    const m = (p?.models || []).find(m => m.enabled !== false && m.use === 'tts');
    if (m?.id) modelId = m.id;
  } catch {}

  const mp3Path = outputPath.replace(/\.[^.]+$/, '') + '.mp3';

  const body = JSON.stringify({
    model: modelId,
    text: text.substring(0, 5000),
    voice_setting: {
      voice_id: voiceId,
      speed: Math.min(2.0, Math.max(0.5, speed)),
      vol: 1.0,
      pitch: 0
    },
    audio_setting: { format: 'mp3', sample_rate: 32000 }
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.minimaxi.chat',
      path: '/v1/t2a_v2',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          if (json.base_resp?.status_code !== 0) return reject(new Error('MiniMax TTS: ' + json.base_resp?.status_msg));
          const hexAudio = json.data?.audio;
          if (!hexAudio) return reject(new Error('MiniMax TTS 未返回音频数据'));
          fs.mkdirSync(path.dirname(mp3Path), { recursive: true });
          fs.writeFileSync(mp3Path, Buffer.from(hexAudio, 'hex'));
          resolve(mp3Path);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('MiniMax TTS 连接超时')); });
    req.write(body);
    req.end();
  });
}

// ═══════════════════════════════════════════
// 科大讯飞 TTS（WebSocket 实时语音合成）
// API Key 格式：APPID:APISecret:APIKey
// 音色列表：
//   女声：xiaoyan（小燕·温柔）、aisxping（小萍·甜美）、aisjinger（晶儿·清亮）
//         x4_lingxiaoli_assist（凌小乐·助手）
//   男声：aisjiuxu（许久·沉稳）、x4_lingfeizhe_oral（凌飞哲·自然）
//   童声：aisbabyxu（许小宝）
// ═══════════════════════════════════════════
const XUNFEI_VOICES = {
  female: 'xiaoyan',
  male: 'aisjiuxu',
};

async function generateWithXunfei(text, outputPath, { gender, speed, voiceId, apiKey }) {
  const crypto = require('crypto');

  // Key 格式：APPID:APISecret:APIKey
  const parts = apiKey.split(':');
  if (parts.length < 3) throw new Error('科大讯飞 Key 格式错误，应为 APPID:APISecret:APIKey');
  const [appId, apiSecret, apiKeyPart] = parts;

  // 选择音色
  let voice = voiceId || XUNFEI_VOICES[gender] || 'xiaoyan';
  const model = _getTTSModel('xunfei');
  if (model?.id && !voiceId) voice = model.id;

  const mp3Path = outputPath.replace(/\.[^.]+$/, '') + '.mp3';
  const speedVal = Math.max(0, Math.min(100, Math.round(speed * 50))); // 0-100, 50 为正常

  // 生成鉴权 URL
  const host = 'tts-api.xfyun.cn';
  const urlPath = '/v2/tts';
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${urlPath} HTTP/1.1`;
  const signature = crypto.createHmac('sha256', apiSecret).update(signatureOrigin).digest('base64');
  const authorizationOrigin = `api_key="${apiKeyPart}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin).toString('base64');
  const wsUrl = `wss://${host}${urlPath}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${encodeURIComponent(host)}`;

  // 兼容 Node < 21（无全局 WebSocket），回退到 ws 包
  const WS = typeof WebSocket !== 'undefined' ? WebSocket : (() => { try { return require('ws'); } catch { throw new Error('需要安装 ws 包: npm i ws'); } })();

  return new Promise((resolve, reject) => {
    const ws = new WS(wsUrl);
    const audioChunks = [];
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) { resolved = true; ws.close(); reject(new Error('科大讯飞 TTS 连接超时')); }
    }, 30000);

    ws.addEventListener('open', () => {
      // 发送合成请求
      const request = JSON.stringify({
        common: { app_id: appId },
        business: {
          aue: 'lame',  // mp3 格式
          auf: 'audio/L16;rate=16000',
          vcn: voice,
          speed: speedVal,
          volume: 50,
          pitch: 50,
          tte: 'UTF8'
        },
        data: {
          status: 2,
          text: Buffer.from(text.substring(0, 8000)).toString('base64')
        }
      });
      ws.send(request);
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());

        if (msg.code !== 0) {
          clearTimeout(timeout);
          resolved = true;
          ws.close();
          reject(new Error(`科大讯飞 TTS 错误 ${msg.code}: ${msg.message || '未知错误'}`));
          return;
        }

        if (msg.data?.audio) {
          audioChunks.push(Buffer.from(msg.data.audio, 'base64'));
        }

        // status=2 表示最后一帧
        if (msg.data?.status === 2) {
          clearTimeout(timeout);
          resolved = true;
          ws.close();

          if (audioChunks.length === 0) {
            reject(new Error('科大讯飞 TTS 未返回音频数据'));
            return;
          }

          fs.mkdirSync(path.dirname(mp3Path), { recursive: true });
          fs.writeFileSync(mp3Path, Buffer.concat(audioChunks));
          console.log(`[TTS] 科大讯飞合成完成: ${voice}, ${audioChunks.length} chunks, ${Buffer.concat(audioChunks).length} bytes`);
          resolve(mp3Path);
        }
      } catch (e) {
        if (!resolved) { clearTimeout(timeout); resolved = true; ws.close(); reject(e); }
      }
    });

    ws.addEventListener('error', (err) => {
      if (!resolved) { clearTimeout(timeout); resolved = true; reject(new Error('科大讯飞 WebSocket 错误: ' + (err.message || '连接失败'))); }
    });

    ws.addEventListener('close', () => {
      if (!resolved) { clearTimeout(timeout); resolved = true; reject(new Error('科大讯飞 WebSocket 意外关闭')); }
    });
  });
}

// ——— ElevenLabs TTS ———
async function generateWithElevenLabs(text, outputPath, { gender, speed, apiKey }) {
  const voiceId = gender === 'female' ? 'EXAVITQu4vr4xnSDxMaL' : 'nPczCjzI2devNBz1zQrb';
  const mp3Path = outputPath.replace(/\.[^.]+$/, '') + '.mp3';

  let modelId = 'eleven_multilingual_v2';
  try {
    const { loadSettings } = require('./settingsService');
    const settings = loadSettings();
    const p = settings.providers.find(p => p.id === 'elevenlabs' && p.enabled);
    const m = (p?.models || []).find(m => m.enabled !== false && m.use === 'tts');
    if (m?.id) modelId = m.id;
  } catch {}

  const body = JSON.stringify({
    text: text.substring(0, 5000),
    model_id: modelId,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.8,
      speed: Math.min(2.0, Math.max(0.5, speed))
    }
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: '/v1/text-to-speech/' + voiceId,
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error('ElevenLabs HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        fs.mkdirSync(path.dirname(mp3Path), { recursive: true });
        fs.writeFileSync(mp3Path, Buffer.concat(chunks));
        resolve(mp3Path);
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('ElevenLabs 连接超时')); });
    req.write(body);
    req.end();
  });
}

// ——— OpenAI TTS ———
async function generateWithOpenAI(text, outputPath, { gender, speed, apiKey }) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY });
  const voice = gender === 'female' ? 'nova' : 'onyx';
  const mp3Path = outputPath.replace(/\.[^.]+$/, '') + '.mp3';

  const response = await client.audio.speech.create({
    model: 'tts-1',
    voice,
    input: text.substring(0, 4096),
    speed: Math.min(4.0, Math.max(0.25, speed))
  });

  fs.mkdirSync(path.dirname(mp3Path), { recursive: true });
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(mp3Path, buffer);
  return mp3Path;
}

// ——— Windows SAPI（本地免费）———
function generateWithSAPI(text, outputPath, { gender, speed }) {
  return new Promise((resolve) => {
    const wavPath = outputPath.replace(/\.[^.]+$/, '') + '.wav';
    const ps1Path = wavPath + '.ps1';
    const txtPath = wavPath + '.txt';
    const genderStr = gender === 'female' ? 'Female' : 'Male';
    const rate = Math.max(-10, Math.min(10, Math.round((speed - 1.0) * 5)));

    const escapedWav = wavPath.replace(/\\/g, '\\\\');
    const escapedTxt = txtPath.replace(/\\/g, '\\\\');

    const script = `$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::${genderStr})
$synth.Rate = ${rate}
$synth.SetOutputToWaveFile("${escapedWav}")
$text = Get-Content -Path "${escapedTxt}" -Raw -Encoding UTF8
$synth.Speak($text)
$synth.Dispose()
Remove-Item "${escapedTxt}" -ErrorAction SilentlyContinue
`;

    fs.mkdirSync(path.dirname(wavPath), { recursive: true });
    fs.writeFileSync(txtPath, text.substring(0, 2000), 'utf8');
    fs.writeFileSync(ps1Path, script, 'utf8');

    execFile('powershell', ['-ExecutionPolicy', 'Bypass', '-File', ps1Path], { timeout: 30000 }, (err) => {
      try { fs.unlinkSync(ps1Path); } catch {}
      if (err || !fs.existsSync(wavPath) || fs.statSync(wavPath).size < 100) {
        resolve(null);
      } else {
        resolve(wavPath);
      }
    });
  });
}

// ——— 工具函数 ———
function _httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const proto = urlObj.protocol === 'https:' ? https : http;
    const req = proto.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('HTTP 超时')); });
    if (body) req.write(body);
    req.end();
  });
}

function _downloadToFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const file = fs.createWriteStream(destPath);
    proto.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        return _downloadToFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(destPath)));
    }).on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
  });
}

/**
 * 获取所有可用的 TTS 音色列表（供前端展示）
 * 返回按供应商分组的音色数组
 */
function getAvailableVoices() {
  const voices = [];

  // 字节豆包语音合成 2.0 官方标准音色（99 个）。
  if (_getTTSKey('volcengine-tts')) {
    voices.push(...require('./volcengineSpeechCatalog').voices);
  }

  return voices;
}

// 体检用：直接对某个供应商跑一次最小合成（绕过备选链）
async function testProviderSynthesis(providerId, outputPath) {
  const apiKey = _getTTSKey(providerId);
  if (!apiKey) {
    // test 模式下 test_status=error 会让 _getTTSKey 返回空；这里直接读 settings 避免自引用
    const { loadSettings } = require('./settingsService');
    const s = loadSettings();
    const p = (s.providers || []).find(x => x.id === providerId && x.enabled && x.api_key);
    if (!p) throw new Error('供应商未配置或已停用');
    const models = Array.isArray(p.models) ? p.models : [];
    if (models.length > 0 && !models.some(m => m.enabled !== false && m.use === 'tts')) throw new Error('未启用 TTS 模型');
    // 绕过 test_status 的屏蔽，直接用 api_key
    const map = {
      'volcengine-tts': () => generateWithVolcEngine('测试', outputPath, { apiKey: p.api_key, gender: 'female', speed: 1.0 }),
    };
    const fn = map[providerId];
    if (!fn) throw new Error('未支持的 TTS 供应商 id');
    return await fn();
  }
  const map = {
    'volcengine-tts': () => generateWithVolcEngine('测试', outputPath, { apiKey, gender: 'female', speed: 1.0 }),
  };
  const fn = map[providerId];
  if (!fn) throw new Error('未支持的 TTS 供应商 id');
  return await fn();
}

module.exports = {
  generateSpeech,
  getAvailableVoices,
  uploadVoiceToFishAudio,
  testProviderSynthesis,
  voiceProviderForId,
  isTtsBillingError,
  readBadPreviewVoices,
  markBadPreviewVoices,
  isTtsVoiceError,
};
