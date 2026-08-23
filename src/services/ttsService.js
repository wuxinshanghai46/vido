/**
 * TTS 语音合成服务
 * 优先级（2026-04-26 改版）：阿里云 CosyVoice → 阿里云 NLS
 * 全平台统一只用阿里 TTS · 移除火山豆包/百度/讯飞/MiniMax/ElevenLabs/OpenAI/SAPI
 * 自定义克隆音色：只走阿里 CosyVoice 真克隆（永久 voice_id），失败立即报错不回退默认女声
 */
require('dotenv').config();
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const BAD_PREVIEW_VOICES_FILE = path.join(__dirname, '../../outputs/avatar/bad_preview_voices.json');

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

/**
 * 生成语音文件
 * @param {string} text - 要合成的文字
 * @param {string} outputPath - 输出文件路径（无扩展名）
 * @param {object} options - { gender: 'female'|'male', speed: 1.0, voiceId: null }
 * @returns {string|null} 生成的音频文件路径，失败返回 null
 */
async function generateSpeech(text, outputPath, { gender = 'female', speed = 1.0, pitch = 1.0, voiceId = null, instruction = '', signal = null, userId = '', requestBaseUrl = '' } = {}) {
  if (!text || !text.trim()) return null;
  if (signal?.aborted) throw signal.reason || Object.assign(new Error('TTS request aborted'), { code: 'ABORT_ERR' });

  voiceId = await require('./voicePackEnrollmentService').resolveVoiceForAccount(voiceId, { userId, requestBaseUrl });

  if (voiceId && String(voiceId).startsWith('hifly:')) {
    const result = await generateWithHiflyTTS(text, outputPath, { voiceId, speed, pitch });
    if (result) {
      console.log(`[TTS] 使用飞影 Hifly 音色 ${voiceId} 生成成功`);
      return _postProcessAudio(result);
    }
    throw new Error('飞影 Hifly 音色合成失败');
  }

  // 自定义声音：如果选择了用户上传的声音，用声音克隆
  if (voiceId && (voiceId.startsWith('custom_') || voiceId.startsWith('custom:'))) {
    const result = await _generateWithCustomVoice(text, outputPath, { voiceId, speed, pitch, instruction, signal, userId });
    if (result) {
      console.log(`[TTS] 使用自定义声音 ${voiceId} 生成成功`);
      return _postProcessAudio(result);
    }
    // 不静默回退 — 用户明确选了自定义声音，失败就报错
    throw new Error('自定义声音合成失败，请检查声音文件或配置 阿里 CosyVoice / 火山声音复刻 API Key 以启用声音克隆');
  }

  // 显式选择的智谱音色必须回到智谱合成。此前它会落入下方阿里链，
  // 把 tongtong 等智谱 voice id 误传给 CosyVoice，最终得到 418
  // InvalidParameter。显式音色失败时不改用另一位说话人，避免声音错乱。
  if (voiceProviderForId(voiceId) === 'zhipu') {
    const apiKey = _getTTSKey('zhipu');
    if (!apiKey) throw new Error(`所选智谱音色 ${voiceId} 当前未配置可用的 TTS API Key`);
    try {
      const result = await generateWithZhipu(text, outputPath, { gender, speed, voiceId, apiKey });
      if (!result) throw new Error(`智谱音色 ${voiceId} 合成返回空结果`);
      return _postProcessAudio(result);
    } catch (error) {
      if (isTtsBillingError(error)) {
        markBadPreviewVoices([...ZHIPU_PUBLIC_VOICE_IDS]);
        const unavailable = new Error('智谱 TTS 余额或资源包不足，当前智谱音色已暂停；请改选阿里云音色后重试，或先为智谱账号充值');
        unavailable.code = 'TTS_PROVIDER_BILLING';
        unavailable.retryable = true;
        throw unavailable;
      }
      throw error;
    }
  }

  // 供应商链（2026-04-26 精简）：只用阿里 — CosyVoice → NLS
  // 不再回退到火山豆包/MiniMax/讯飞/百度/OpenAI/SAPI，这些会用默认女声替代用户期望的克隆/选定音色
  const chain = [
    { id: 'aliyun-tts',  name: '阿里 CosyVoice', fn: generateWithAliyunTTS,   opts: { gender, speed, pitch, voiceId, instruction, signal } },
    { id: 'aliyun-nls',  name: '阿里 NLS',       fn: generateWithAliyunNLS,   opts: { gender, speed, pitch, voiceId, signal } },
  ];

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
        // 埋点：阿里 CosyVoice / NLS 按字符计费
        try {
          require('./tokenTracker').record({
            provider: id, model: id === 'aliyun-tts' ? 'cosyvoice-v3-flash' : 'aliyun-nls',
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
          provider: id, model: id === 'aliyun-tts' ? 'cosyvoice-v3-flash' : 'aliyun-nls',
          category: 'tts', ttsChars: (text || '').length,
          durationMs: Date.now() - startedAt, status: 'fail', errorMsg: err.message,
        });
      } catch {}
    }
  }

  console.warn('[TTS] 阿里 TTS 全部失败：' + errors.join(' | '));
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

  // 守门（2026-04-26 精简）：只用阿里 CosyVoice 真克隆 · 没有 aliyun_voice_id 直接报错
  // 不再 fallback 到火山 ICL / 默认女声，避免"选了我的声音却出来灿灿+嘟嘟"的歧义
  const hasAliyunReady = !!voice.aliyun_voice_id;
  if (!hasAliyunReady) {
    const status = voice.status || 'unknown';
    const reason = status === 'training'
      ? '还在训练中（约 3-15 分钟），请稍后再试'
      : `未完成阿里 CosyVoice 真克隆（aliyun_voice_id 为空，status=${status}）`;
    throw new Error(`"${voice.name || voiceId}" ${reason}。请去「声音克隆」页面重新上传录音 → 走阿里 CosyVoice 真克隆通道。`);
  }

  // 阿里 CosyVoice 2 定制音色 · 永久 voice_id（唯一通道）
  try {
    const aliyun = require('./aliyunVoiceService');
    if (!aliyun.hasKey()) {
      throw new Error('未配置阿里 CosyVoice API Key（去后台 AI 配置 → aliyun-tts 设置）');
    }
    let result;
    try {
      result = await aliyun.synthesize(text, voice.aliyun_voice_id, outputPath, { speed, pitch, instruction, signal });
    } catch (err) {
      const msg = String(err?.message || '');
      if (instruction && /instruction|invalid|parameter|param|unsupported|not support|不支持|参数|字段/i.test(msg)) {
        console.warn(`[TTS] 自定义音色 CosyVoice instruction 失败，降级为无 instruction 合成: ${msg}`);
        result = await aliyun.synthesize(text, voice.aliyun_voice_id, outputPath, { speed, pitch, instruction: '', signal });
      } else {
        throw err;
      }
    }
    if (result && fs.existsSync(result) && fs.statSync(result).size > 100) {
      console.log(`[TTS] 阿里 CosyVoice 定制音色合成成功: ${voice.name} voice_id=${voice.aliyun_voice_id}`);
      return result;
    }
    throw new Error('阿里 CosyVoice 返回空结果');
  } catch (err) {
    throw new Error(`"${voice.name || voiceId}" 阿里克隆合成失败: ${err.message}`);
  }
}

// 注：原火山 ICL 2.0 / volc_speaker_id 路径 + 阿里零样本兜底，已下线
//     （2026-04-26：用户要求全平台只用阿里 CosyVoice 真克隆，非真克隆直接报错）

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
  if (/^(?:long|loong)[a-z0-9_-]+$/i.test(id)) return 'aliyun-tts';
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
// 火山引擎 TTS（豆包大模型语音合成）
// API Key 格式：AppId:AccessToken
// 音色列表（中文最丰富）：
//   女声：zh_female_tianmei（甜美）、zh_female_shuangkuai（爽快）、zh_female_qingxin（清新）
//         zh_female_wanwan（温婉）、zh_female_linjia（知性邻家）
//   男声：zh_male_chunhou（醇厚）、zh_male_yangguang（阳光）、zh_male_jingqiang（京腔）
//         zh_male_daxuesheng（大学生）、zh_male_shaonian（少年音）
//   特色：zh_female_story（故事女声）、zh_male_story（故事男声）
//         zh_female_rap（说唱女声）、zh_male_rap（说唱男声）
//   童声：zh_child_girl（童声女）、zh_child_boy（童声男）
// ═══════════════════════════════════════════
// 豆包语音合成2.0 voice_type（BVxxx_streaming 格式）
const VOLC_VOICES = {
  female: 'BV700_streaming',   // 灿灿（默认女声）
  male: 'BV002_streaming',     // 通用男声
  child: 'BV061_streaming',    // 天才童声
  // 前端预设映射
  'female-sweet': 'BV700_streaming',   // 灿灿
  'female-pro': 'BV009_streaming',     // 知性女声
  'male-mature': 'BV006_streaming',    // 磁性男声
  'male-young': 'BV004_streaming',     // 开朗青年
};

async function generateWithVolcEngine(text, outputPath, { gender, speed, voiceId, apiKey }) {
  // Key 格式：AppId:AccessToken（新版 Header 鉴权）
  const parts = apiKey.split(':');
  const appId = parts.length >= 2 ? parts[0] : '';
  const accessToken = parts.length >= 2 ? parts.slice(1).join(':') : apiKey;

  // 从 settings 读取音色
  let voice = voiceId || VOLC_VOICES[voiceId] || VOLC_VOICES[gender] || 'BV700_streaming';
  const model = _getTTSModel('volcengine');
  if (model?.id && !voiceId) voice = model.id;

  const mp3Path = outputPath.replace(/\.[^.]+$/, '') + '.mp3';
  const speedRatio = Math.min(2.0, Math.max(0.5, speed));
  const { v4: uuidv4 } = require('uuid');

  const body = JSON.stringify({
    app: { appid: appId, cluster: 'volcano_tts' },
    user: { uid: 'vido_user' },
    audio: { voice_type: voice, encoding: 'mp3', speed_ratio: speedRatio },
    request: { reqid: uuidv4(), text: text.substring(0, 10000), operation: 'query' }
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'openspeech.bytedance.com',
      path: '/api/v1/tts',
      method: 'POST',
      headers: {
        'X-Api-App-Key': appId,
        'X-Api-Access-Key': accessToken,
        'X-Api-Resource-Id': 'seed-tts-1.0',
        'X-Api-Connect-Id': uuidv4(),
        'Content-Type': 'application/json',
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          if (json.code !== 3000) return reject(new Error('火山引擎 TTS: ' + (json.message || `code=${json.code}`)));
          const audioData = json.data;
          if (!audioData) return reject(new Error('火山引擎 TTS 未返回音频数据'));
          fs.mkdirSync(path.dirname(mp3Path), { recursive: true });
          fs.writeFileSync(mp3Path, Buffer.from(audioData, 'base64'));
          resolve(mp3Path);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('火山引擎 TTS 连接超时')); });
    req.write(body);
    req.end();
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

// —— 阿里 NLS（智能语音交互）基础 TTS · 不支持克隆，只能预设音色 ——
// 使用 AppKey + AccessToken（api_key 存成 "{AppKey}:{AccessToken}" 格式）
async function generateWithAliyunNLS(text, outputPath, { gender, speed, pitch, voiceId, signal = null }) {
  const { synthesizeWithNLS, hasNLSCreds } = require('./aliyunVoiceService');
  if (!hasNLSCreds()) return null;
  // NLS TTS 的音色 ID 和 DashScope CosyVoice 不一样，单独映射
  const NLS_VOICES = { female: 'xiaoyun', male: 'xiaogang', neutral: 'Aiqi' };
  const voice = voiceId || NLS_VOICES[gender] || 'xiaoyun';
  const model = _getTTSModel('aliyun-nls');
  const finalVoice = (model?.id && !voiceId) ? model.id : voice;
  const pitchRate = Math.round(((Number(pitch) || 1) - 1) * 500);
  return synthesizeWithNLS(text, outputPath, { voice: finalVoice, speed, pitch: pitchRate, signal });
}

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
  const { loadSettings } = require('./settingsService');
  const voices = [];

  // 智谱 GLM-TTS
  if (_getTTSKey('zhipu')) {
    voices.push(
      { id: 'tongtong', name: '彤彤·温柔', gender: 'female', provider: '智谱AI', providerIcon: '🔮', lang: 'zh', tag: '推荐' },
      { id: 'xiaochen', name: '小陈·知性', gender: 'female', provider: '智谱AI', providerIcon: '🔮', lang: 'zh' },
      { id: 'chuichui', name: '锤锤·沉稳', gender: 'male', provider: '智谱AI', providerIcon: '🔮', lang: 'zh', tag: '推荐' },
      { id: 'jam', name: 'Jam·活力', gender: 'male', provider: '智谱AI', providerIcon: '🔮', lang: 'zh' },
      { id: 'kazi', name: 'Kazi·磁性', gender: 'male', provider: '智谱AI', providerIcon: '🔮', lang: 'zh' },
      { id: 'douji', name: 'Douji·少年', gender: 'male', provider: '智谱AI', providerIcon: '🔮', lang: 'zh' },
      { id: 'luodo', name: 'Luodo·儒雅', gender: 'male', provider: '智谱AI', providerIcon: '🔮', lang: 'zh' },
    );
  }

  // 火山引擎
  if (_getTTSKey('volcengine')) {
    voices.push(
      { id: 'zh_female_tianmei', name: '甜美女声', gender: 'female', provider: '火山引擎', providerIcon: '🌋', lang: 'zh', tag: '推荐' },
      { id: 'zh_female_shuangkuai', name: '爽快女声', gender: 'female', provider: '火山引擎', providerIcon: '🌋', lang: 'zh' },
      { id: 'zh_female_qingxin', name: '清新女声', gender: 'female', provider: '火山引擎', providerIcon: '🌋', lang: 'zh' },
      { id: 'zh_female_wanwan', name: '温婉女声', gender: 'female', provider: '火山引擎', providerIcon: '🌋', lang: 'zh' },
      { id: 'zh_female_linjia', name: '知性邻家', gender: 'female', provider: '火山引擎', providerIcon: '🌋', lang: 'zh' },
      { id: 'zh_female_story', name: '故事女声', gender: 'female', provider: '火山引擎', providerIcon: '🌋', lang: 'zh', tag: '讲述' },
      { id: 'zh_male_chunhou', name: '醇厚男声', gender: 'male', provider: '火山引擎', providerIcon: '🌋', lang: 'zh', tag: '推荐' },
      { id: 'zh_male_yangguang', name: '阳光男声', gender: 'male', provider: '火山引擎', providerIcon: '🌋', lang: 'zh' },
      { id: 'zh_male_jingqiang', name: '京腔男声', gender: 'male', provider: '火山引擎', providerIcon: '🌋', lang: 'zh', tag: '方言' },
      { id: 'zh_male_daxuesheng', name: '大学生', gender: 'male', provider: '火山引擎', providerIcon: '🌋', lang: 'zh' },
      { id: 'zh_male_shaonian', name: '少年音', gender: 'male', provider: '火山引擎', providerIcon: '🌋', lang: 'zh' },
      { id: 'zh_male_story', name: '故事男声', gender: 'male', provider: '火山引擎', providerIcon: '🌋', lang: 'zh', tag: '讲述' },
      { id: 'zh_child_girl', name: '童声女孩', gender: 'child', provider: '火山引擎', providerIcon: '🌋', lang: 'zh', tag: '童声' },
      { id: 'zh_child_boy', name: '童声男孩', gender: 'child', provider: '火山引擎', providerIcon: '🌋', lang: 'zh', tag: '童声' },
    );
  }

  // 百度语音
  if (_getTTSKey('baidu')) {
    voices.push(
      { id: 'dumiduo', name: '度米朵·甜美', gender: 'female', provider: '百度语音', providerIcon: '🔵', lang: 'zh', tag: '推荐' },
      { id: 'duxiaomei', name: '度小美·标准', gender: 'female', provider: '百度语音', providerIcon: '🔵', lang: 'zh' },
      { id: 'duxiaojiao', name: '度小娇·情感', gender: 'female', provider: '百度语音', providerIcon: '🔵', lang: 'zh' },
      { id: 'duxiaolu', name: '度小鹿·知性', gender: 'female', provider: '百度语音', providerIcon: '🔵', lang: 'zh' },
      { id: 'duyaya', name: '度丫丫·萝莉', gender: 'female', provider: '百度语音', providerIcon: '🔵', lang: 'zh' },
      { id: 'dubowen', name: '度博文·新闻', gender: 'male', provider: '百度语音', providerIcon: '🔵', lang: 'zh', tag: '播报' },
      { id: 'duxiaoyu', name: '度小宇·标准', gender: 'male', provider: '百度语音', providerIcon: '🔵', lang: 'zh' },
      { id: 'duxiaoyao', name: '度逍遥·情感', gender: 'male', provider: '百度语音', providerIcon: '🔵', lang: 'zh' },
      { id: 'duxiaotong', name: '度小童·童声', gender: 'child', provider: '百度语音', providerIcon: '🔵', lang: 'zh', tag: '童声' },
      { id: 'duxiaomeng', name: '度小萌·萌宝', gender: 'child', provider: '百度语音', providerIcon: '🔵', lang: 'zh', tag: '童声' },
    );
  }

  // 阿里云 CosyVoice
  if (_getTTSKey('aliyun-tts')) {
    const ali = (id, name, gender, tag = '') => ({ id, name, gender, provider: '阿里云', providerIcon: '☁️', lang: 'zh', ...(tag ? { tag } : {}) });
    voices.push(
      // CosyVoice v3-flash 官方公开音色。这里不再只放少量样例，
      // 让配音弹窗更接近阿里控制台里能看到的声音库规模。
      ali('longxiaochun_v3', '龙小淳·知性积极', 'female', '推荐'),
      ali('longxiaoxia_v3', '龙小夏·沉稳权威', 'female', '口播'),
      ali('longyumi_v3', 'YUMI·正经青年女', 'female'),
      ali('longanwen_v3', '龙安温·优雅知性', 'female'),
      ali('longanli_v3', '龙安莉·利落从容', 'female'),
      ali('longyingmu_v3', '龙应沐·优雅知性', 'female'),
      ali('longantai_v3', '龙安台·嗲甜台湾', 'female'),
      ali('longhua_v3', '龙华·元气甜美', 'female'),
      ali('longyan_v3', '龙颜·温暖春风', 'female'),
      ali('longxing_v3', '龙星·温婉邻家', 'female'),
      ali('longwan_v3', '龙婉·细腻柔声', 'female'),
      ali('longqiang_v3', '龙嫱·浪漫风情', 'female'),
      ali('longfeifei_v3', '龙菲菲·甜美娇气', 'female'),
      ali('longanrou_v3', '龙安柔·温柔闺蜜', 'female'),
      ali('longanling_v3', '龙安灵·思维灵动', 'female'),
      ali('longanya_v3', '龙安雅·高雅气质', 'female'),
      ali('longanqin_v3', '龙安亲·亲和活泼', 'female'),
      ali('longmiao_v3', '龙妙·抑扬顿挫', 'female', '有声书'),
      ali('longyuan_v3', '龙媛·温暖治愈', 'female', '有声书'),
      ali('longyue_v3', '龙悦·温暖磁性', 'female', '有声书'),
      ali('longwanjun_v3', '龙婉君·细腻柔声', 'female', '有声书'),
      ali('longlaoyi_v3', '龙老姨·烟火从容', 'female', '长者'),
      ali('longdaiyu_v3', '龙黛玉·娇率才女', 'female', '短视频'),
      ali('longanran_v3', '龙安燃·活泼质感', 'female', '直播'),
      ali('longanxuan_v3', '龙安宣·经典直播', 'female', '直播'),
      ali('loongbella_v3', 'Bella3.0·精准干练', 'female', '播报'),
      ali('longanyun_v3', '龙安昀·居家暖男', 'male'),
      ali('longanlang_v3', '龙安朗·清爽利落', 'male', '播报'),
      ali('longcheng_v3', '龙橙·智慧青年', 'male', '推荐'),
      ali('longze_v3', '龙泽·温暖元气', 'male'),
      ali('longzhe_v3', '龙哲·讲述暖男', 'male'),
      ali('longtian_v3', '龙天·磁性理智', 'male'),
      ali('longhao_v3', '龙浩·多情忧郁', 'male'),
      ali('longhan_v3', '龙寒·温暖痴情', 'male'),
      ali('longanzhi_v3', '龙安智·睿智轻熟', 'male'),
      ali('longsanshu_v3', '龙三叔·沉稳质感', 'male', '有声书'),
      ali('longxiu_v3', '龙修·博才说书', 'male', '有声书'),
      ali('longnan_v3', '龙楠·睿智青年', 'male', '有声书'),
      ali('longyichen_v3', '龙逸尘·洒脱活力', 'male', '有声书'),
      ali('longlaobo_v3', '龙老伯·沧桑岁月', 'male', '长者'),
      ali('longjiqi_v3', '龙机器·呆萌机器人', 'neutral', '短视频'),
      ali('longhouge_v3', '龙猴哥·经典猴哥', 'male', '短视频'),
      ali('longshuo_v3', '龙硕·博才干练', 'male', '播报'),
      ali('longshu_v3', '龙书·沉稳青年', 'male', '播报'),
      ali('longhuhu_v3', '龙呼呼·天真烂漫', 'child', '童声'),
      // v3-flash 有些账号仍只接受无 _v3 的旧别名，保留少量兜底。
      ali('longxiaochun', '龙小淳·兼容', 'female'),
      ali('longcheng', '龙城·兼容', 'male'),
      ali('longhua', '龙华·兼容', 'male')
    );
  }

  // 阿里 NLS 预置音色（智能语音交互，和 CosyVoice 是不同产品线）
  if (_getTTSKey('aliyun-nls')) {
    const nls = (id, name, gender, tag = '') => ({ id, name, gender, provider: '阿里NLS', providerIcon: '☁️', lang: 'zh', ...(tag ? { tag } : {}) });
    voices.push(
      nls('xiaoyun', '小云·标准女声', 'female', '推荐'),
      nls('xiaomei', '小美·甜美女声', 'female'),
      nls('ruoxi', '若兮·温柔女声', 'female'),
      nls('siqi', '思琪·自然女声', 'female'),
      nls('sijia', '思佳·亲和女声', 'female'),
      nls('aixia', '艾夏·活力女声', 'female'),
      nls('xiaogang', '小刚·标准男声', 'male', '推荐'),
      nls('aicheng', '艾诚·磁性男声', 'male'),
      nls('sicheng', '思诚·自然男声', 'male'),
      nls('aiqi', '艾琪·童声', 'child', '童声')
    );
  }

  // 科大讯飞
  if (_getTTSKey('xunfei')) {
    voices.push(
      { id: 'xiaoyan', name: '小燕·温柔', gender: 'female', provider: '科大讯飞', providerIcon: '🔷', lang: 'zh', tag: '推荐' },
      { id: 'aisxping', name: '小萍·甜美', gender: 'female', provider: '科大讯飞', providerIcon: '🔷', lang: 'zh' },
      { id: 'aisjinger', name: '晶儿·清亮', gender: 'female', provider: '科大讯飞', providerIcon: '🔷', lang: 'zh' },
      { id: 'x4_lingxiaoli_assist', name: '凌小乐·助手', gender: 'female', provider: '科大讯飞', providerIcon: '🔷', lang: 'zh' },
      { id: 'aisjiuxu', name: '许久·沉稳', gender: 'male', provider: '科大讯飞', providerIcon: '🔷', lang: 'zh', tag: '推荐' },
      { id: 'x4_lingfeizhe_oral', name: '凌飞哲·自然', gender: 'male', provider: '科大讯飞', providerIcon: '🔷', lang: 'zh' },
      { id: 'aisbabyxu', name: '许小宝·童声', gender: 'child', provider: '科大讯飞', providerIcon: '🔷', lang: 'zh', tag: '童声' },
    );
  }

  // Fish Audio
  if (_getTTSKey('fishaudio')) {
    voices.push(
      { id: 'speech-1.5', name: 'Fish Speech 1.5', gender: 'female', provider: 'Fish Audio', providerIcon: '🐟', lang: 'multi', tag: '多语言' },
    );
  }

  // MiniMax
  if (_getTTSKey('minimax')) {
    voices.push(
      { id: 'female-tianmei', name: '甜美女声', gender: 'female', provider: 'MiniMax', providerIcon: '🟠', lang: 'zh' },
      { id: 'male-qingxin', name: '清新男声', gender: 'male', provider: 'MiniMax', providerIcon: '🟠', lang: 'zh' },
    );
  }

  // ElevenLabs
  if (_getTTSKey('elevenlabs')) {
    voices.push(
      { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella (Female)', gender: 'female', provider: 'ElevenLabs', providerIcon: '🟣', lang: 'multi' },
      { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian (Male)', gender: 'male', provider: 'ElevenLabs', providerIcon: '🟣', lang: 'multi' },
    );
  }

  // OpenAI
  if (_getTTSKey('openai') || process.env.OPENAI_API_KEY) {
    voices.push(
      { id: 'nova', name: 'Nova', gender: 'female', provider: 'OpenAI', providerIcon: '⬛', lang: 'multi' },
      { id: 'shimmer', name: 'Shimmer', gender: 'female', provider: 'OpenAI', providerIcon: '⬛', lang: 'multi' },
      { id: 'alloy', name: 'Alloy', gender: 'female', provider: 'OpenAI', providerIcon: '⬛', lang: 'multi' },
      { id: 'echo', name: 'Echo', gender: 'male', provider: 'OpenAI', providerIcon: '⬛', lang: 'multi' },
      { id: 'fable', name: 'Fable', gender: 'male', provider: 'OpenAI', providerIcon: '⬛', lang: 'multi' },
      { id: 'onyx', name: 'Onyx', gender: 'male', provider: 'OpenAI', providerIcon: '⬛', lang: 'multi' },
    );
  }

  // Windows SAPI（总是可用）
  voices.push(
    { id: 'sapi-female', name: '系统女声', gender: 'female', provider: 'Windows', providerIcon: '🪟', lang: 'zh', tag: '免费' },
    { id: 'sapi-male', name: '系统男声', gender: 'male', provider: 'Windows', providerIcon: '🪟', lang: 'zh', tag: '免费' },
  );

  // 自定义声音（用户上传）
  try {
    const db = require('../models/database');
    const customVoices = db.listVoices();
    for (const v of customVoices) {
      // 参考素材、训练中和失败记录只能在声音克隆页查看，不能进入 TTS 选择器。
      // 只有拿到真实 CosyVoice voice_id 的音色才具备“选择后可生成”的语义。
      if (!v.aliyun_voice_id || v.status !== 'ready') continue;
      voices.unshift({
        id: v.id,
        name: v.name,
        gender: v.gender || 'female',
        provider: '我的声音',
        providerIcon: '🎤',
        lang: 'zh',
        tag: '自定义',
        custom: true,
        filePath: v.file_path,
        sourceVoicePackId: v.source_voice_pack_id || null,
        ttsReady: true,
      });
    }
  } catch {}

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
      volcengine: () => generateWithVolcEngine('测试', outputPath, { apiKey: p.api_key, gender: 'female', speed: 1.0 }),
      zhipu:       () => generateWithZhipu('测试', outputPath, { apiKey: p.api_key, gender: 'female', speed: 1.0 }),
      baidu:       () => generateWithBaidu('测试', outputPath, { apiKey: p.api_key, gender: 'female', speed: 1.0 }),
      'aliyun-tts':() => generateWithAliyunTTS('测试', outputPath, { apiKey: p.api_key, gender: 'female', speed: 1.0 }),
      'aliyun-nls':() => generateWithAliyunNLS('测试', outputPath, { gender: 'female', speed: 1.0 }),
      minimax:     () => generateWithMiniMaxTTS('测试', outputPath, { apiKey: p.api_key, gender: 'female', speed: 1.0 }),
      xunfei:      () => generateWithXunfei('测试', outputPath, { apiKey: p.api_key, gender: 'female', speed: 1.0 }),
      elevenlabs:  () => generateWithElevenLabs('测试', outputPath, { apiKey: p.api_key, gender: 'female', speed: 1.0 }),
      openai:      () => generateWithOpenAI('测试', outputPath, { apiKey: p.api_key, gender: 'female', speed: 1.0 }),
    };
    const fn = map[providerId];
    if (!fn) throw new Error('未支持的 TTS 供应商 id');
    return await fn();
  }
  const map = {
    volcengine: () => generateWithVolcEngine('测试', outputPath, { apiKey, gender: 'female', speed: 1.0 }),
    zhipu:       () => generateWithZhipu('测试', outputPath, { apiKey, gender: 'female', speed: 1.0 }),
    baidu:       () => generateWithBaidu('测试', outputPath, { apiKey, gender: 'female', speed: 1.0 }),
    'aliyun-tts':() => generateWithAliyunTTS('测试', outputPath, { apiKey, gender: 'female', speed: 1.0 }),
    'aliyun-nls':() => generateWithAliyunNLS('测试', outputPath, { gender: 'female', speed: 1.0 }),
    minimax:     () => generateWithMiniMaxTTS('测试', outputPath, { apiKey, gender: 'female', speed: 1.0 }),
    xunfei:      () => generateWithXunfei('测试', outputPath, { apiKey, gender: 'female', speed: 1.0 }),
    elevenlabs:  () => generateWithElevenLabs('测试', outputPath, { apiKey, gender: 'female', speed: 1.0 }),
    openai:      () => generateWithOpenAI('测试', outputPath, { apiKey, gender: 'female', speed: 1.0 }),
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
};
