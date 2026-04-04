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

// POST /api/workbench/upload-voice - 上传自定义声音样本并克隆
router.post('/upload-voice', voiceUpload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '请上传音频文件' });
  const name = req.body.name || '自定义声音';
  const gender = req.body.gender || 'female';
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

  // 立即触发 Fish Audio 声音克隆
  let fishRefId = null;
  try {
    const { uploadVoiceToFishAudio } = require('../services/ttsService');
    const { getApiKey } = require('../services/settingsService');
    const fishKey = getApiKey('fishaudio') || process.env.FISH_AUDIO_API_KEY;
    if (fishKey) {
      console.log(`[VoiceClone] 正在将 "${name}" 上传到 Fish Audio 进行克隆...`);
      fishRefId = await uploadVoiceToFishAudio(destPath, name, fishKey);
      db.updateVoice(voiceId, { fish_ref_id: fishRefId });
      console.log(`[VoiceClone] 克隆成功: ${fishRefId}`);
    } else {
      console.warn('[VoiceClone] 未配置 Fish Audio API Key，仅保存本地文件');
    }
  } catch (err) {
    console.error('[VoiceClone] Fish Audio 克隆失败:', err.message);
  }

  res.json({ success: true, voiceId, filename, name, gender, cloned: !!fishRefId });
});

// GET /api/workbench/voices - 列出自定义声音（DB + 文件系统）
router.get('/voices', (req, res) => {
  const dbVoices = db.listVoices(req.user?.id);
  // 过滤掉文件已被删除的记录
  const voices = dbVoices.filter(v => v.file_path && fs.existsSync(v.file_path)).map(v => ({
    id: v.id,
    name: v.name,
    gender: v.gender || 'female',
    filename: v.filename,
    created_at: v.created_at
  }));
  res.json({ success: true, voices });
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

// GET /api/workbench/voices/:id/play - 播放自定义声音样本
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
