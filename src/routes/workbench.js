const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');

const multer = require('multer');

const outputDir = path.join(__dirname, '../../outputs/workbench');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
const voicesDir = path.join(__dirname, '../../outputs/voices');
if (!fs.existsSync(voicesDir)) fs.mkdirSync(voicesDir, { recursive: true });

const voiceUpload = multer({ dest: voicesDir, limits: { fileSize: 50 * 1024 * 1024 } });

// GET /api/workbench/clone-engines - 返回当前可用的声音克隆引擎列表（已配 key 且测试通过）
router.get('/clone-engines', (req, res) => {
  const { loadSettings } = require('../services/settingsService');
  let settings; try { settings = loadSettings(); } catch { settings = { providers: [] }; }

  // 当前实际已实现上传/克隆的引擎
  const ENGINES = [
    { id: 'aliyun-tts', name: '阿里 CosyVoice 2 定制音色',  keyFormat: 'DashScope API Key', desc: 'Plan B · 永久 voice_id · 训练一次长期复用·推荐' },
    { id: 'volcengine', name: '火山引擎声音复刻',  keyFormat: 'appId:accessToken', desc: '字节跳动豆包·中文效果最佳·秒级克隆' },
  ];

  const available = ENGINES.map(eng => {
    const p = (settings.providers || []).find(x => x.id === eng.id);
    const hasKey = !!(p && p.enabled && p.api_key);
    const testOk = !p || p.test_status !== 'error'; // 未测试也算可用
    const usable = hasKey && testOk;
    return {
      id: eng.id,
      name: eng.name,
      desc: eng.desc,
      keyFormat: eng.keyFormat,
      usable,
      reason: !hasKey ? '未配置 API Key' : (!testOk ? 'API Key 测试失败' : ''),
    };
  });

  res.json({ success: true, engines: available });
});

// POST /api/workbench/upload-voice - 上传自定义声音样本并克隆
router.post('/upload-voice', voiceUpload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '请上传音频文件' });
  const name = req.body.name || '自定义声音';
  const gender = req.body.gender || 'female';
  const engineChoice = (req.body.engine || '').trim(); // '' = auto, 'aliyun-tts' / 'volcengine'
  const ext = path.extname(req.file.originalname) || '.mp3';
  const voiceId = 'custom_' + uuidv4().slice(0, 8);
  const filename = `voice_${voiceId}${ext}`;
  const destPath = path.join(voicesDir, filename);
  fs.renameSync(req.file.path, destPath);

  // 持久化到数据库
  db.insertVoice({
    id: voiceId,
    name,
    gender,
    filename,
    file_path: destPath,
    user_id: req.user?.id || null
  });

  // 声音克隆：按 engineChoice 决定
  //   '' (auto)   — 默认顺序：阿里 CosyVoice 2 定制音色 → 火山
  //   'aliyun-tts'— 只试阿里定制音色（Plan B · 永久 voice_id）
  //   'volcengine'— 只试火山 mega_tts
  let cloned = false;
  let cloneProvider = '';
  let speakerId = null;
  let aliyunVoiceId = null;
  let aliyunTaskId = null;
  const tried = []; // 记录每一家尝试结果，失败时给前端看详细原因
  const shouldTryAliyun = !engineChoice || engineChoice === 'aliyun-tts';
  const shouldTryVolc   = !engineChoice || engineChoice === 'volcengine';

  // 策略0：阿里 CosyVoice 2 定制音色（Plan B · 异步训练 · 永久 voice_id · 推荐）
  if (shouldTryAliyun) try {
    const aliyun = require('../services/aliyunVoiceService');
    if (aliyun.hasKey()) {
      // 1. 把上传的音频复制到公网可访问目录（/public/jimeng-assets/...）
      const jimengAssetsDir = path.join(__dirname, '../../outputs/jimeng-assets');
      fs.mkdirSync(jimengAssetsDir, { recursive: true });
      const pubName = `vc_${voiceId}${ext}`;
      fs.copyFileSync(destPath, path.join(jimengAssetsDir, pubName));
      const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')
        || `${req.protocol}://${req.get('host')}`;
      const audioUrl = `${base}/public/jimeng-assets/${pubName}`;

      console.log(`[VoiceClone] 阿里 CosyVoice 2 定制音色提交训练 "${name}" url=${audioUrl}`);
      const referenceText = (req.body.reference_text || '').trim();
      const enroll = await aliyun.enrollVoice(audioUrl, { voicePrefix: 'vido', referenceText });
      aliyunTaskId = enroll.task_id;
      aliyunVoiceId = enroll.voice_id || null;

      if (aliyunVoiceId) {
        db.updateVoice(voiceId, { aliyun_voice_id: aliyunVoiceId, aliyun_task_id: aliyunTaskId, clone_provider: 'aliyun-tts' });
        cloned = true;
        cloneProvider = 'aliyun-tts';
        console.log(`[VoiceClone] 阿里定制音色同步返回 voice_id=${aliyunVoiceId}`);
      } else {
        // 异步：写入 task_id，另起 waitForEnroll 后台轮询
        db.updateVoice(voiceId, { aliyun_task_id: aliyunTaskId, clone_provider: 'aliyun-tts', status: 'training' });
        console.log(`[VoiceClone] 阿里定制音色进入异步训练 task_id=${aliyunTaskId}，后台轮询中…`);
        (async () => {
          try {
            const done = await aliyun.waitForEnroll(aliyunTaskId, { maxMs: 15 * 60 * 1000, intervalMs: 10 * 1000 });
            db.updateVoice(voiceId, { aliyun_voice_id: done.voice_id, status: 'ready' });
            console.log(`[VoiceClone] 阿里定制音色训练完成 voice_id=${done.voice_id}`);
          } catch (err) {
            console.warn(`[VoiceClone] 阿里定制音色训练失败 ${aliyunTaskId}:`, err.message);
            db.updateVoice(voiceId, { status: 'aliyun_failed' });
          }
        })();
        cloned = true; // UX 角度先当成功；aliyun_voice_id 就绪后前端再刷新
        cloneProvider = 'aliyun-tts';
      }
    }
  } catch (err) {
    console.warn('[VoiceClone] 阿里定制音色失败:', err.message);
    // ⚠️ 不再降级为"零样本"：DashScope 没有真正的 per-request-ref-audio 零样本克隆，
    //    之前的 cosyvoice-clone-v1 降级其实是用默认预设音色念文本，不是真的用用户声音
    //    → 直接失败，让火山兜底
    tried.push({ id: 'aliyun-tts', ok: false, error: err.message });
  }
  if (shouldTryAliyun && !tried.find(t => t.id === 'aliyun-tts')) {
    // 没进 try（没 key）的情况补一条记录
    try {
      const aliyun = require('../services/aliyunVoiceService');
      if (!aliyun.hasKey()) tried.push({ id: 'aliyun-tts', ok: false, error: '未配置阿里 sk-* DashScope key（在「AI 配置」→ aliyun-tts 填入即可）' });
    } catch {}
  }

  // 策略1：火山引擎声音复刻（阿里没 key / 阿里失败时兜底）
  if (!cloned && shouldTryVolc) try {
    const { getApiKey, loadSettings } = require('../services/settingsService');
    const volcKey = getApiKey('volcengine');
    // 读 provider 上的预分配 speaker_id（购买声音复刻槽位后才有）
    let preallocatedSpeaker = null;
    try {
      const volcProv = (loadSettings().providers || []).find(p => p.id === 'volcengine');
      preallocatedSpeaker = volcProv?.volc_preallocated_speaker_id || null;
    } catch {}

    if (volcKey && volcKey.includes(':')) {
      const [appId, accessToken] = [volcKey.split(':')[0], volcKey.split(':').slice(1).join(':')];
      console.log(`[VoiceClone] 正在使用火山引擎声音复刻上传 "${name}" · 槽位: ${preallocatedSpeaker || '自动生成'}`);

      const https = require('https');
      const audioData = fs.readFileSync(destPath);
      const audioBase64 = audioData.toString('base64');
      const audioFormat = ext.replace('.', '') || 'mp3';
      // 优先用预分配槽位（购买了声音复刻槽位的账户必须用那个 S_* 前缀的 id）
      speakerId = preallocatedSpeaker || ('vido_' + voiceId);

      // V3 ICL 2.0 upload body（audios 数组 + source:2 + model_type:4）
      const uploadBody = JSON.stringify({
        appid: appId,
        speaker_id: speakerId,
        audios: [{ audio_bytes: audioBase64, audio_format: audioFormat }],
        source: 2,
        language: 0, // 0=中文 1=英文 2=日文 ...
        model_type: 4, // 4=ICL 2.0 / 5=ICL 3.0（最新，效果更好但需要账号开通）
      });

      const uploadResult = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'openspeech.bytedance.com',
          path: '/api/v1/mega_tts/audio/upload',
          method: 'POST',
          headers: {
            // 火山 ICL 2.0 要求同时带 Authorization (V1 协议) + X-Api-* (V3 协议) 双组 header
            'Authorization': `Bearer;${accessToken}`,
            'X-Api-App-Key': appId,
            'X-Api-Access-Key': accessToken,
            'X-Api-Resource-Id': 'volc.megatts.voiceclone',
            'X-Api-Request-Id': require('uuid').v4(),
            'Content-Type': 'application/json',
          }
        }, (res) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            try {
              const result = JSON.parse(Buffer.concat(chunks).toString());
              result.__http_status = res.statusCode;
              resolve(result);
            } catch (e) { reject(new Error('火山响应解析失败: ' + Buffer.concat(chunks).toString().slice(0, 200))); }
          });
        });
        req.on('error', reject);
        req.setTimeout(60000, () => { req.destroy(); reject(new Error('上传超时')); });
        req.write(uploadBody);
        req.end();
      });

      // V3 成功响应：HTTP 200 + (BaseResp.StatusCode===0 || status===10(Training/Success) || speaker_id 非空)
      const uploadOk = uploadResult.__http_status < 400 && (
        uploadResult.BaseResp?.StatusCode === 0 ||
        uploadResult.base_resp?.status_code === 0 ||
        uploadResult.status === 10 ||  // Training
        uploadResult.status === 2 ||   // Success (ICL 2.0)
        uploadResult.status === 4 ||   // Success (new)
        uploadResult.speaker_id
      );

      if (uploadOk) {
        db.updateVoice(voiceId, {
          volc_speaker_id: speakerId,
          clone_provider: 'volcengine',
          status: uploadResult.status === 2 || uploadResult.status === 4 ? 'ready' : 'training',
        });
        cloned = true;
        cloneProvider = 'volcengine';
        console.log(`[VoiceClone] 火山 ICL 2.0 训练已提交: speaker_id=${speakerId}, status=${uploadResult.status || 'submitted'}`);
        tried.push({ id: 'volcengine', ok: true, speaker_id: speakerId, training: true });
      } else {
        const msg = uploadResult.BaseResp?.StatusMessage || uploadResult.base_resp?.status_message || uploadResult.message || JSON.stringify(uploadResult).slice(0, 200);
        console.warn('[VoiceClone] 火山声音复刻返回:', msg);
        tried.push({ id: 'volcengine', ok: false, error: '火山响应: ' + msg });
      }
    } else {
      tried.push({ id: 'volcengine', ok: false, error: '未配置火山 volcengine provider 或 api_key 格式错误（需 appId:accessToken 英文冒号分隔）' });
    }
  } catch (err) {
    console.error('[VoiceClone] 火山声音复刻失败:', err.message);
    tried.push({ id: 'volcengine', ok: false, error: err.message });
  }

  if (!cloned) {
    console.warn('[VoiceClone] 克隆供应商均未成功，仅保存本地文件');
  }

  res.json({
    success: true,
    voiceId,
    filename,
    name,
    gender,
    cloned,
    cloneProvider,
    aliyun_voice_id: aliyunVoiceId,
    aliyun_task_id: aliyunTaskId,
    training: !!(aliyunTaskId && !aliyunVoiceId), // 是否处于阿里异步训练中
    tried, // 三家尝试结果 [{id,ok,error?}]
  });
});

// POST /api/workbench/voices/:id/refresh-status — 主动查阿里训练状态（前端轮询用）
router.post('/voices/:id/refresh-status', async (req, res) => {
  try {
    const v = db.getVoice(req.params.id);
    if (!v) return res.status(404).json({ success: false, error: '声音不存在' });
    if (v.aliyun_voice_id) return res.json({ success: true, status: 'ready', aliyun_voice_id: v.aliyun_voice_id });
    if (!v.aliyun_task_id) return res.json({ success: true, status: v.volc_speaker_id ? 'ready' : 'no-task' });

    const aliyun = require('../services/aliyunVoiceService');
    const s = await aliyun.getTaskStatus(v.aliyun_task_id);
    if (s.voice_id) {
      db.updateVoice(req.params.id, { aliyun_voice_id: s.voice_id, status: 'ready' });
      return res.json({ success: true, status: 'ready', aliyun_voice_id: s.voice_id });
    }
    res.json({ success: true, status: s.status || 'pending', aliyun_task_id: v.aliyun_task_id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/workbench/voices/:id/refresh-volc-status — 查询火山 ICL 2.0 训练状态（前端轮询用）
// 状态码：1=NotFound 2=Training 3=Success 4=Failed 5=Active 10=Training-in-progress
router.post('/voices/:id/refresh-volc-status', async (req, res) => {
  try {
    const v = db.getVoice(req.params.id);
    if (!v) return res.status(404).json({ success: false, error: '声音不存在' });
    if (!v.volc_speaker_id) return res.json({ success: true, status: 'no-task', note: '该声音未走火山路径' });

    const { getApiKey } = require('../services/settingsService');
    const volcKey = getApiKey('volcengine');
    if (!volcKey || !volcKey.includes(':')) return res.status(400).json({ success: false, error: '火山 provider 未配或格式错' });
    const [appId, accessToken] = [volcKey.split(':')[0], volcKey.split(':').slice(1).join(':')];

    const https = require('https');
    const body = JSON.stringify({ appid: appId, speaker_id: v.volc_speaker_id });
    const result = await new Promise((resolve, reject) => {
      const rq = https.request({
        hostname: 'openspeech.bytedance.com',
        path: '/api/v1/mega_tts/status',
        method: 'POST',
        headers: {
          'X-Api-App-Key': appId,
          'X-Api-Access-Key': accessToken,
          'X-Api-Resource-Id': 'volc.megatts.voiceclone',
          'X-Api-Request-Id': require('uuid').v4(),
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        }
      }, resp => {
        const chunks = [];
        resp.on('data', c => chunks.push(c));
        resp.on('end', () => {
          try { resolve({ http: resp.statusCode, ...JSON.parse(Buffer.concat(chunks).toString()) }); }
          catch (e) { reject(new Error('响应解析失败: ' + Buffer.concat(chunks).toString().slice(0, 200))); }
        });
      });
      rq.on('error', reject);
      rq.setTimeout(15000, () => { rq.destroy(); reject(new Error('查询超时')); });
      rq.write(body);
      rq.end();
    });

    // 解析状态
    const statusMap = { 1: 'not-found', 2: 'training', 3: 'ready', 4: 'failed', 5: 'ready', 10: 'training' };
    const statusNum = result.status;
    const statusLabel = statusMap[statusNum] || 'unknown';
    // demo audio 只在训练完成后有值
    const demoAudio = result.demo_audio || null;

    if (statusLabel === 'ready') {
      db.updateVoice(req.params.id, { status: 'ready' });
    } else if (statusLabel === 'failed') {
      db.updateVoice(req.params.id, { status: 'volc_failed' });
    }

    res.json({
      success: true,
      status: statusLabel,
      volc_status_code: statusNum,
      speaker_id: v.volc_speaker_id,
      demo_audio: demoAudio,
      raw: result,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/workbench/voices - 列出自定义声音（DB + 文件系统）
router.get('/voices', async (req, res) => {
  const dbVoices = db.listVoices(req.user?.id);

  // 对 status=training 且明显超时（>30 分钟）的记录先做硬超时标记
  // 正常训练 2-10 分钟就完；超过 30 分钟基本是服务器重启丢失了 waitForEnroll 后台任务
  const TRAINING_HARD_TIMEOUT_MS = 30 * 60 * 1000;
  const now = Date.now();
  for (const v of dbVoices) {
    if (v.status !== 'training') continue;
    const createdMs = v.created_at ? new Date(v.created_at).getTime() : 0;
    if (!createdMs || now - createdMs < TRAINING_HARD_TIMEOUT_MS) continue;

    // 超 30 分钟还 training → 先查一次真实状态，查不到就标 timeout
    let resolved = false;
    if (v.aliyun_task_id && !v.aliyun_voice_id) {
      try {
        const aliyun = require('../services/aliyunVoiceService');
        if (aliyun.hasKey()) {
          const s = await aliyun.getTaskStatus(v.aliyun_task_id);
          if (s.voice_id) {
            db.updateVoice(v.id, { aliyun_voice_id: s.voice_id, status: 'ready' });
            v.aliyun_voice_id = s.voice_id;
            v.status = 'ready';
            resolved = true;
          } else if (['FAILED', 'ERROR', 'CANCELLED'].includes(String(s.status).toUpperCase())) {
            db.updateVoice(v.id, { status: 'aliyun_failed', last_error: `阿里 task ${v.aliyun_task_id} 状态=${s.status}` });
            v.status = 'aliyun_failed';
            resolved = true;
          }
        }
      } catch (e) {
        console.warn(`[voices] 查阿里 task ${v.aliyun_task_id} 失败:`, e.message);
      }
    }
    if (!resolved) {
      db.updateVoice(v.id, { status: 'training_timeout', last_error: '训练超 30 分钟未完成（服务器可能重启导致后台任务丢失）。请删除后重新克隆。' });
      v.status = 'training_timeout';
    }
  }

  // 过滤掉文件已被删除的记录
  const voices = dbVoices.filter(v => v.file_path && fs.existsSync(v.file_path)).map(v => ({
    id: v.id,
    name: v.name,
    gender: v.gender || 'female',
    filename: v.filename,
    // 真克隆 ready = 拿到永久 ID（aliyun_voice_id 或 volc_speaker_id + status≠failed）
    cloned: !!((v.aliyun_voice_id) || (v.volc_speaker_id && v.status !== 'volc_failed')),
    clone_provider: v.clone_provider || (v.aliyun_voice_id ? 'aliyun-tts' : v.volc_speaker_id ? 'volcengine' : ''),
    aliyun_voice_id: v.aliyun_voice_id || null,
    aliyun_task_id: v.aliyun_task_id || null,
    aliyun_mode: v.aliyun_mode || null, // 'zeroshot' 表示零样本模式
    volc_speaker_id: v.volc_speaker_id || null,
    status: v.status || (v.aliyun_task_id && !v.aliyun_voice_id ? 'training' : 'ready'),
    last_error: v.last_error || null,
    created_at: v.created_at
  }));
  res.json({ success: true, voices });
});

// POST /api/workbench/voices/:id/reclone-aliyun
//   用已有 voice 记录的 file_path 重新调阿里 CosyVoice 复刻（同步），
//   成功后把 aliyun_voice_id 写入同一条记录（不删火山的 speaker_id，保留双通道）
router.post('/voices/:id/reclone-aliyun', async (req, res) => {
  try {
    const voice = db.getVoice(req.params.id);
    if (!voice) return res.status(404).json({ success: false, error: '声音不存在' });
    if (voice.user_id && req.user?.id !== voice.user_id && req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, error: '无权操作' });
    }
    if (!voice.file_path || !fs.existsSync(voice.file_path)) {
      return res.status(400).json({ success: false, error: '原始录音文件已丢失，无法重新克隆' });
    }
    const aliyun = require('../services/aliyunVoiceService');
    if (!aliyun.hasKey()) {
      return res.status(400).json({ success: false, error: '未配置阿里 sk-* DashScope key' });
    }

    // 把 file_path 复制到公网可访问目录
    const jimengAssetsDir = path.join(__dirname, '../../outputs/jimeng-assets');
    fs.mkdirSync(jimengAssetsDir, { recursive: true });
    const ext = path.extname(voice.file_path);
    const pubName = `vc_${voice.id}${ext}`;
    fs.copyFileSync(voice.file_path, path.join(jimengAssetsDir, pubName));
    const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')
      || `${req.protocol}://${req.get('host')}`;
    const audioUrl = `${base}/public/jimeng-assets/${pubName}`;

    console.log(`[VoiceClone/reclone-aliyun] 用阿里 CosyVoice 重新复刻 ${voice.name} (${voice.id})`);
    const enroll = await aliyun.enrollVoice(audioUrl, { voicePrefix: 'vido' });
    db.updateVoice(voice.id, {
      aliyun_voice_id: enroll.voice_id,
      aliyun_target_model: enroll.target_model,
      clone_provider: 'aliyun-tts',  // 切换主 provider 到阿里
      status: 'ready',
      reclone_at: new Date().toISOString(),
    });
    res.json({ success: true, aliyun_voice_id: enroll.voice_id, target_model: enroll.target_model });
  } catch (err) {
    console.warn('[VoiceClone/reclone-aliyun] 失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/workbench/voices/:id - 删除自定义声音
router.delete('/voices/:id', (req, res) => {
  const voice = db.getVoice(req.params.id);
  if (!voice) return res.status(404).json({ success: false, error: '声音不存在' });
  // 删除文件
  if (voice.file_path && fs.existsSync(voice.file_path)) {
    try { fs.unlinkSync(voice.file_path); } catch {}
  }
  db.deleteVoice(req.params.id);
  res.json({ success: true });
});

// PATCH /api/workbench/voices/:id - 编辑名称 / 性别
router.patch('/voices/:id', (req, res) => {
  const voice = db.getVoice(req.params.id);
  if (!voice) return res.status(404).json({ success: false, error: '声音不存在' });
  const patch = {};
  if (typeof req.body.name === 'string') {
    const n = req.body.name.trim().slice(0, 30);
    if (!n) return res.status(400).json({ success: false, error: '名称不能为空' });
    patch.name = n;
  }
  if (req.body.gender && ['female', 'male'].includes(req.body.gender)) {
    patch.gender = req.body.gender;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ success: false, error: '没有可更新的字段' });
  db.updateVoice(req.params.id, patch);
  res.json({ success: true, voice: db.getVoice(req.params.id) });
});

// GET /api/workbench/voices/:id/play - 播放自定义声音样本（原始上传文件）
router.get('/voices/:id/play', (req, res) => {
  const voice = db.getVoice(req.params.id);
  if (!voice?.file_path || !fs.existsSync(voice.file_path)) {
    return res.status(404).json({ error: '声音文件不存在' });
  }
  const ext = path.extname(voice.file_path).slice(1);
  const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', pcm: 'audio/pcm', m4a: 'audio/mp4', ogg: 'audio/ogg', webm: 'audio/webm' };
  res.setHeader('Content-Type', mimeMap[ext] || 'audio/mpeg');
  fs.createReadStream(voice.file_path).pipe(res);
});

// POST /api/workbench/voices/:id/preview - 测试声音：合成用户输入文字并返回音频流
// body: { text?: string, speed?: number }
// 直接返回 audio/mpeg（前端 response.blob() → new Audio(blobUrl) 播放）
router.post('/voices/:id/preview', async (req, res) => {
  try {
    const voice = db.getVoice(req.params.id);
    if (!voice) return res.status(404).json({ success: false, error: '声音不存在' });
    const hasId = voice.aliyun_voice_id || voice.volc_speaker_id;
    const isZeroshot = voice.clone_provider === 'aliyun-zeroshot' || voice.aliyun_mode === 'zeroshot';
    if (!hasId && !isZeroshot) {
      return res.status(400).json({ success: false, error: '该声音尚未完成克隆（阿里 voice_id / 火山 speaker_id 均空，且非零样本模式）' });
    }

    // 火山 speaker：合成前先查一次远端训练状态，避免 speaker 其实是占位槽位（未真训练）
    // 时返回默认女声导致"快速女声+滴声"错觉。只 allow status_code∈{3,5}(Success/Active)。
    if (voice.volc_speaker_id && !voice.aliyun_voice_id) {
      try {
        const { getApiKey } = require('../services/settingsService');
        const volcKey = getApiKey('volcengine');
        if (volcKey && volcKey.includes(':')) {
          const [appId, accessToken] = [volcKey.split(':')[0], volcKey.split(':').slice(1).join(':')];
          const https = require('https');
          const body = JSON.stringify({ appid: appId, speaker_id: voice.volc_speaker_id });
          const statusResp = await new Promise((resolve) => {
            const rq = https.request({
              hostname: 'openspeech.bytedance.com',
              path: '/api/v1/mega_tts/status',
              method: 'POST',
              headers: {
                'X-Api-App-Key': appId,
                'X-Api-Access-Key': accessToken,
                'X-Api-Resource-Id': 'volc.megatts.voiceclone',
                'X-Api-Request-Id': require('uuid').v4(),
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
              }
            }, r => {
              const chunks = [];
              r.on('data', c => chunks.push(c));
              r.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                catch { resolve(null); }
              });
            });
            rq.on('error', () => resolve(null));
            rq.setTimeout(8000, () => { rq.destroy(); resolve(null); });
            rq.write(body);
            rq.end();
          });
          const statusCode = statusResp?.status;
          // 3 = Success, 5 = Active（可用合成）；其他（2/10 训练中，4 失败，1 not-found）都不让合成
          if (statusResp && statusCode != null && statusCode !== 3 && statusCode !== 5) {
            const map = { 1: '未找到该 speaker（火山后台未识别）', 2: '还在训练中', 4: '训练失败', 10: '还在训练中' };
            const reason = map[statusCode] || `火山返回 status=${statusCode}`;
            // 把 DB 里的 status 同步校正，让前端刷新后卡片显示对
            if (statusCode === 2 || statusCode === 10) db.updateVoice(voice.id, { status: 'training' });
            else if (statusCode === 4) db.updateVoice(voice.id, { status: 'volc_failed', last_error: reason });
            return res.status(409).json({
              success: false,
              error: `火山 speaker ${voice.volc_speaker_id} ${reason}，不能合成（避免返回错误音色）。请等训练完成或删除后重新克隆。`,
              volc_status: statusCode,
            });
          }
        }
      } catch (e) {
        console.warn('[VoicePreview] 火山状态预检失败（继续合成）:', e.message);
      }
    }

    const text = (req.body?.text || '你好，这是我的克隆声音。输入任意文字，都能用我的音色朗读出来。').slice(0, 200);
    // 默认 0.85（中文自然语速 4-5 字/秒）· CosyVoice rate=1.0 对中文偏快 ≈ 5-6 字/秒
    // 短文本（<15 字）再降 0.05，避免"一口气念完"的急促感
    const rawSpeed = Number(req.body?.speed);
    let speed = isFinite(rawSpeed) && rawSpeed > 0 ? rawSpeed : 0.85;
    if (!rawSpeed && text.length < 15) speed = 0.80;
    speed = Math.min(1.5, Math.max(0.5, speed));

    const { generateSpeech } = require('../services/ttsService');
    const outBase = path.join(outputDir, `preview_${voice.id}_${Date.now()}`);
    const audioPath = await generateSpeech(text, outBase, {
      gender: voice.gender || 'female',
      speed,
      voiceId: voice.id, // custom_xxx 触发 _generateWithCustomVoice
    });
    if (!audioPath || !fs.existsSync(audioPath)) {
      return res.status(500).json({ success: false, error: '合成失败，请检查克隆状态及 API Key' });
    }
    // 直接返回音频流（重要：前端用 response.blob() 解析）
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-Clone-Provider', voice.clone_provider || '');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(audioPath).pipe(res);
  } catch (err) {
    console.error('[VoicePreview] 失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/workbench/preview-audio/:filename - 提供合成的试听音频
router.get('/preview-audio/:filename', (req, res) => {
  const f = path.join(outputDir, path.basename(req.params.filename));
  if (!fs.existsSync(f)) return res.status(404).end();
  res.setHeader('Content-Type', 'audio/mpeg');
  fs.createReadStream(f).pipe(res);
});

// POST /api/workbench/synthesize - TTS 语音合成
router.post('/synthesize', async (req, res) => {
  try {
    const { text, voiceId = 'female-sweet', speed = 1.0 } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ success: false, error: '请输入配音文本' });

    const { generateSpeech } = require('../services/ttsService');
    const taskId = uuidv4();
    const audioBase = path.join(outputDir, taskId);

    const audioFile = await generateSpeech(text, audioBase, { voiceId, speed });
    if (!audioFile || !fs.existsSync(audioFile)) {
      throw new Error('语音合成失败，请检查 TTS 配置');
    }

    const audioUrl = `/api/workbench/audio/${path.basename(audioFile)}`;
    res.json({ success: true, audioUrl });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/workbench/audio/:filename - 提供音频文件
router.get('/audio/:filename', (req, res) => {
  const filePath = path.join(outputDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
  const ext = path.extname(filePath).slice(1);
  const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', pcm: 'audio/pcm', m4a: 'audio/mp4' };
  res.setHeader('Content-Type', mimeMap[ext] || 'audio/mpeg');
  fs.createReadStream(filePath).pipe(res);
});

module.exports = router;
