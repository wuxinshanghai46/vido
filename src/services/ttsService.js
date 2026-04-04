/**
 * TTS 语音合成服务
 * 优先级: 火山引擎(豆包) > 百度语音 > 阿里云CosyVoice > Fish Audio > MiniMax > ElevenLabs > OpenAI > Windows SAPI
 * 中文语音优先，类似百度/高德地图的自然中文语音
 */
require('dotenv').config();
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

/**
 * 生成语音文件
 * @param {string} text - 要合成的文字
 * @param {string} outputPath - 输出文件路径（无扩展名）
 * @param {object} options - { gender: 'female'|'male', speed: 1.0, voiceId: null }
 * @returns {string|null} 生成的音频文件路径，失败返回 null
 */
async function generateSpeech(text, outputPath, { gender = 'female', speed = 1.0, voiceId = null } = {}) {
  if (!text || !text.trim()) return null;

  // 自定义声音：如果选择了用户上传的声音，用声音克隆
  if (voiceId && (voiceId.startsWith('custom_') || voiceId.startsWith('custom:'))) {
    const result = await _generateWithCustomVoice(text, outputPath, { voiceId, speed });
    if (result) { console.log(`[TTS] 使用自定义声音 ${voiceId} 生成成功`); return result; }
    // 不静默回退 — 用户明确选了自定义声音，失败就报错
    throw new Error('自定义声音合成失败，请检查声音文件或配置 Fish Audio / 阿里云 CosyVoice API Key 以启用声音克隆');
  }

  // 供应商优先级链：每个失败后自动回退到下一个
  const chain = [
    { id: 'zhipu',      name: '智谱',       fn: generateWithZhipu,      opts: { gender, speed, voiceId } },
    { id: 'volcengine',  name: '火山引擎',   fn: generateWithVolcEngine,  opts: { gender, speed, voiceId } },
    { id: 'baidu',       name: '百度',       fn: generateWithBaidu,       opts: { gender, speed, voiceId } },
    { id: 'aliyun-tts',  name: '阿里云',     fn: generateWithAliyunTTS,   opts: { gender, speed, voiceId } },
    { id: 'fishaudio',   name: 'FishAudio',  fn: generateWithFishAudio,   opts: { gender, speed } },
    { id: 'minimax',     name: 'MiniMax',    fn: generateWithMiniMaxTTS,  opts: { gender, speed } },
    { id: 'xunfei',      name: '讯飞',       fn: generateWithXunfei,      opts: { gender, speed, voiceId } },
    { id: 'elevenlabs',  name: 'ElevenLabs', fn: generateWithElevenLabs,  opts: { gender, speed } },
  ];

  for (const { id, name, fn, opts } of chain) {
    const apiKey = _getTTSKey(id);
    if (!apiKey) continue;
    try {
      const result = await fn(text, outputPath, { ...opts, apiKey });
      if (result) { console.log(`[TTS] 使用 ${name} 生成成功`); return result; }
    } catch (err) {
      console.warn(`[TTS] ${name} 失败，尝试下一个: ${err.message}`);
    }
  }

  // OpenAI（支持 env 回退）
  const oaiKey = _getTTSKey('openai') || process.env.OPENAI_API_KEY;
  if (oaiKey) {
    try {
      const result = await generateWithOpenAI(text, outputPath, { gender, speed, apiKey: oaiKey });
      if (result) { console.log('[TTS] 使用 OpenAI 生成成功'); return result; }
    } catch (err) {
      console.warn(`[TTS] OpenAI 失败: ${err.message}`);
    }
  }

  // 最终兜底：Windows SAPI
  try {
    const result = await generateWithSAPI(text, outputPath, { gender, speed });
    if (result) { console.log('[TTS] 使用 Windows SAPI 生成成功'); return result; }
  } catch (err) {
    console.warn(`[TTS] SAPI 失败: ${err.message}`);
  }

  console.warn('[TTS] 所有供应商均失败，无法生成语音');
  return null;
}

function _getTTSKey(providerId) {
  try {
    const { loadSettings } = require('./settingsService');
    const settings = loadSettings();
    const p = settings.providers.find(p => p.id === providerId && p.enabled && p.api_key);
    if (!p) return '';
    const hasTTS = (p.models || []).some(m => m.enabled !== false && m.use === 'tts');
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

async function _generateWithCustomVoice(text, outputPath, { voiceId, speed = 1.0 }) {
  const db = require('../models/database');
  const voice = db.getVoice(voiceId);
  if (!voice?.file_path || !fs.existsSync(voice.file_path)) {
    throw new Error(`自定义声音 ${voiceId} 文件不存在`);
  }

  // 策略1: Fish Audio 声音克隆（效果最好）
  const fishKey = _getTTSKey('fishaudio');
  if (fishKey) {
    try {
      // 检查是否已有 Fish Audio reference_id
      let refId = voice.fish_ref_id;
      if (!refId) {
        // 首次使用：上传音频到 Fish Audio 创建克隆
        console.log(`[TTS] 首次使用自定义声音 "${voice.name}"，正在上传到 Fish Audio...`);
        refId = await uploadVoiceToFishAudio(voice.file_path, voice.name, fishKey);
        // 保存 reference_id 到数据库，后续直接复用
        db.updateVoice(voiceId, { fish_ref_id: refId });
      }
      // 用 reference_id 生成 TTS
      const mp3Path = outputPath.replace(/\.[^.]+$/, '') + '.mp3';
      const body = JSON.stringify({
        text: text.substring(0, 10000),
        reference_id: refId,
        format: 'mp3',
        latency: 'normal',
        normalize: true,
        streaming: false
      });

      const result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.fish.audio',
          path: '/v1/tts',
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + fishKey,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          }
        }, (res) => {
          if (res.statusCode >= 400) {
            let errData = '';
            res.on('data', c => errData += c);
            res.on('end', () => reject(new Error(`Fish Audio TTS ${res.statusCode}: ${errData}`)));
            return;
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
        req.setTimeout(60000, () => { req.destroy(); reject(new Error('Fish Audio TTS 超时')); });
        req.write(body);
        req.end();
      });

      if (result && fs.existsSync(result) && fs.statSync(result).size > 100) {
        console.log(`[TTS] Fish Audio 声音克隆生成成功: ${voice.name}`);
        return result;
      }
    } catch (err) {
      console.warn(`[TTS] Fish Audio 声音克隆失败: ${err.message}`);
    }
  }

  // 策略2: 阿里云 CosyVoice 声音克隆
  const aliyunKey = _getTTSKey('aliyun-tts');
  if (aliyunKey) {
    try {
      const result = await _cloneWithCosyVoice(text, outputPath, voice.file_path, { speed, apiKey: aliyunKey });
      if (result) { console.log(`[TTS] 阿里云 CosyVoice 声音克隆成功: ${voice.name}`); return result; }
    } catch (err) {
      console.warn(`[TTS] 阿里云 CosyVoice 声音克隆失败: ${err.message}`);
    }
  }

  // 策略3: MiniMax 声音克隆（用 voice_clone 上传参考音频）
  const mmKey = _getTTSKey('minimax');
  if (mmKey) {
    try {
      const result = await _cloneWithMiniMax(text, outputPath, voice.file_path, { speed, apiKey: mmKey });
      if (result) { console.log(`[TTS] MiniMax 声音克隆成功: ${voice.name}`); return result; }
    } catch (err) {
      console.warn(`[TTS] MiniMax 声音克隆失败: ${err.message}`);
    }
  }

  // 策略4: 回退 — 基础 TTS + FFmpeg 音色微调（仅调音高，非真正克隆）
  console.warn(`[TTS] 无声音克隆 API，回退到 FFmpeg 音色微调`);
  const baseGender = voice.gender || 'female';
  const providers = [
    { id: 'zhipu', fn: generateWithZhipu },
    { id: 'xunfei', fn: generateWithXunfei },
    { id: 'volcengine', fn: generateWithVolcEngine },
  ];

  let baseAudio = null;
  for (const { id, fn } of providers) {
    const apiKey = _getTTSKey(id);
    if (!apiKey) continue;
    try {
      baseAudio = await fn(text, outputPath + '_base', { gender: baseGender, speed, apiKey });
      if (baseAudio) break;
    } catch { continue; }
  }
  if (!baseAudio) baseAudio = await generateWithSAPI(text, outputPath + '_base', { gender: baseGender, speed });
  if (!baseAudio) throw new Error('基础语音生成失败');

  // FFmpeg 微调音色
  const ffmpegPath = (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== 'ffmpeg')
    ? process.env.FFMPEG_PATH : require('ffmpeg-static');
  const { execSync } = require('child_process');
  const finalPath = outputPath.replace(/\.[^.]+$/, '') + '.mp3';

  try {
    const pitchShift = baseGender === 'male' ? 0.97 : 1.03;
    execSync(
      `"${ffmpegPath}" -i "${baseAudio}" -af "asetrate=44100*${pitchShift},aresample=44100,atempo=${1/pitchShift}" -y "${finalPath}"`,
      { stdio: 'pipe', timeout: 30000 }
    );
    try { fs.unlinkSync(baseAudio); } catch {}
    if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 100) return finalPath;
  } catch (err) {
    console.warn('[TTS] FFmpeg 音色调整失败:', err.message);
  }

  // 最终：直接用基础语音
  if (fs.existsSync(baseAudio)) return baseAudio;
  return null;
}

// ═══════════════════════════════════════════
// 阿里云 CosyVoice 声音克隆（通过参考音频）
// ═══════════════════════════════════════════
async function _cloneWithCosyVoice(text, outputPath, refAudioPath, { speed = 1.0, apiKey }) {
  const mp3Path = outputPath.replace(/\.[^.]+$/, '') + '.mp3';
  const refAudioBuf = fs.readFileSync(refAudioPath);
  const refBase64 = refAudioBuf.toString('base64');
  const ext = path.extname(refAudioPath).slice(1) || 'wav';

  const body = JSON.stringify({
    model: 'cosyvoice-clone-v1',
    input: { text: text.substring(0, 5000) },
    parameters: { voice: `data:audio/${ext};base64,${refBase64}`, format: 'mp3', rate: speed }
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
};

async function generateWithZhipu(text, outputPath, { gender, speed, voiceId, apiKey }) {
  const OpenAI = require('openai');
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://open.bigmodel.cn/api/paas/v4'
  });

  let voice = voiceId || ZHIPU_VOICES[gender] || 'tongtong';
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
const VOLC_VOICES = {
  female: 'zh_female_tianmei',
  male: 'zh_male_chunhou',
  // 扩展音色映射
  'zh_female_tianmei': '甜美女声', 'zh_female_shuangkuai': '爽快女声',
  'zh_female_qingxin': '清新女声', 'zh_female_wanwan': '温婉女声',
  'zh_female_linjia': '知性邻家', 'zh_female_story': '故事女声',
  'zh_male_chunhou': '醇厚男声', 'zh_male_yangguang': '阳光男声',
  'zh_male_jingqiang': '京腔男声', 'zh_male_daxuesheng': '大学生',
  'zh_male_shaonian': '少年音', 'zh_male_story': '故事男声',
  'zh_child_girl': '童声女', 'zh_child_boy': '童声男',
};

async function generateWithVolcEngine(text, outputPath, { gender, speed, voiceId, apiKey }) {
  // Key 格式：AppId:AccessToken
  const parts = apiKey.split(':');
  const appId = parts.length >= 2 ? parts[0] : '';
  const accessToken = parts.length >= 2 ? parts.slice(1).join(':') : apiKey;

  // 从 settings 读取音色
  let voice = voiceId || VOLC_VOICES[gender] || 'zh_female_tianmei';
  const model = _getTTSModel('volcengine');
  if (model?.id && model.id !== 'tts-mega' && !voiceId) voice = model.id;

  const mp3Path = outputPath.replace(/\.[^.]+$/, '') + '.mp3';
  const speedRatio = Math.min(2.0, Math.max(0.5, speed));

  const body = JSON.stringify({
    app: { appid: appId, token: 'access_token', cluster: 'volcano_tts' },
    user: { uid: 'vido_user' },
    audio: { voice_type: voice, encoding: 'mp3', speed_ratio: speedRatio },
    request: { reqid: Date.now().toString(), text: text.substring(0, 10000), operation: 'query' }
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'openspeech.bytedance.com',
      path: '/api/v1/tts',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer;' + accessToken,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
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
  female: 'longxiaochun',
  male: 'longcheng',
};

async function generateWithAliyunTTS(text, outputPath, { gender, speed, voiceId, apiKey }) {
  let voice = voiceId || ALI_VOICES[gender] || 'longxiaochun';
  const model = _getTTSModel('aliyun-tts');
  if (model?.id && model.id !== 'cosyvoice-v1' && !voiceId) voice = model.id;

  const mp3Path = outputPath.replace(/\.[^.]+$/, '') + '.mp3';

  const body = JSON.stringify({
    model: 'cosyvoice-v1',
    input: { text: text.substring(0, 10000) },
    parameters: {
      voice: voice,
      format: 'mp3',
      sample_rate: 22050,
      rate: speed
    }
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'dashscope.aliyuncs.com',
      path: '/api/v1/services/aigc/text2audio/text-synthesis',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-DashScope-DataInspection': 'disable'
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
            // DashScope 异步任务模式
            if (json.output?.task_id) {
              return pollAliyunTTSTask(json.output.task_id, apiKey, mp3Path).then(resolve).catch(reject);
            }
            reject(new Error('阿里云 TTS: ' + (json.message || json.code || '未知错误')));
          } catch {
            reject(new Error('阿里云 TTS 返回格式错误'));
          }
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('阿里云 TTS 连接超时')); });
    req.write(body);
    req.end();
  });
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

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
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
    voices.push(
      { id: 'longxiaochun', name: '龙小淳·温柔', gender: 'female', provider: '阿里云', providerIcon: '☁️', lang: 'zh', tag: '推荐' },
      { id: 'longmiao', name: '龙喵·软萌', gender: 'female', provider: '阿里云', providerIcon: '☁️', lang: 'zh' },
      { id: 'longshu', name: '龙姝·知性', gender: 'female', provider: '阿里云', providerIcon: '☁️', lang: 'zh' },
      { id: 'longjing', name: '龙婧·播报', gender: 'female', provider: '阿里云', providerIcon: '☁️', lang: 'zh', tag: '播报' },
      { id: 'longcheng', name: '龙城·沉稳', gender: 'male', provider: '阿里云', providerIcon: '☁️', lang: 'zh', tag: '推荐' },
      { id: 'longhua', name: '龙华·儒雅', gender: 'male', provider: '阿里云', providerIcon: '☁️', lang: 'zh' },
      { id: 'longyuan', name: '龙远·磁性', gender: 'male', provider: '阿里云', providerIcon: '☁️', lang: 'zh' },
      { id: 'longfei', name: '龙飞·激昂', gender: 'male', provider: '阿里云', providerIcon: '☁️', lang: 'zh' },
      { id: 'longwan', name: '龙湾·粤语', gender: 'female', provider: '阿里云', providerIcon: '☁️', lang: 'zh', tag: '粤语' },
      { id: 'longyu', name: '龙渝·重庆话', gender: 'male', provider: '阿里云', providerIcon: '☁️', lang: 'zh', tag: '方言' },
      { id: 'longshuo', name: '龙硕·童声男', gender: 'child', provider: '阿里云', providerIcon: '☁️', lang: 'zh', tag: '童声' },
      { id: 'longtong', name: '龙童·童声女', gender: 'child', provider: '阿里云', providerIcon: '☁️', lang: 'zh', tag: '童声' },
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
      voices.unshift({
        id: v.id,
        name: v.name,
        gender: v.gender || 'female',
        provider: '我的声音',
        providerIcon: '🎤',
        lang: 'zh',
        tag: '自定义',
        custom: true,
        filePath: v.file_path
      });
    }
  } catch {}

  return voices;
}

module.exports = { generateSpeech, getAvailableVoices, uploadVoiceToFishAudio };
