const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { generateStory, generateLongStory, refineScene, parseScript } = require('../services/storyService');
const { generateCharacterImage, generateSceneImage, CHAR_IMG_DIR, SCENE_IMG_DIR } = require('../services/imageService');
const { getAvailableVoices } = require('../services/ttsService');
const motionService = require('../services/motionService');

// 获取可用 TTS 音色列表
router.get('/voices', (req, res) => {
  try {
    const voices = getAvailableVoices();
    res.json({ success: true, voices });
  } catch (err) {
    res.json({ success: true, voices: [] });
  }
});

// 语音试听
router.post('/preview-voice', async (req, res) => {
  const { voice_id, text } = req.body;
  const previewText = text || '欢迎使用VIDO AI视频创作平台。';
  const { generateSpeech } = require('../services/ttsService');
  const { v4: uuidv4 } = require('uuid');
  const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');
  const voiceDir = path.join(OUTPUT_DIR, 'voice', 'preview');
  if (!fs.existsSync(voiceDir)) fs.mkdirSync(voiceDir, { recursive: true });
  const outBase = path.join(voiceDir, `pv_${uuidv4().slice(0, 8)}`);
  try {
    const audioFile = await generateSpeech(previewText, outBase, { voiceId: voice_id });
    if (!audioFile || !fs.existsSync(audioFile)) {
      return res.json({ success: false, error: '语音生成失败' });
    }
    const filename = path.basename(audioFile);
    res.json({ success: true, audio_url: `/api/story/voice-preview/${filename}` });
    // 60秒后清理预览文件
    setTimeout(() => { try { fs.unlinkSync(audioFile); } catch {} }, 60000);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 提供语音预览文件
router.get('/voice-preview/:filename', (req, res) => {
  const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');
  const filePath = path.join(OUTPUT_DIR, 'voice', 'preview', path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// 单独预生成剧情（预览用，不创建项目）
router.post('/generate', async (req, res) => {
  const { theme, genre = 'drama', duration = 60, language = '中文' } = req.body;

  if (!theme) {
    return res.status(400).json({ success: false, error: '请提供主题' });
  }

  try {
    const story = await generateStory({ theme, genre, duration, language });
    res.json({ success: true, data: story });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 优化某个场景
router.post('/refine-scene', async (req, res) => {
  const { scene, feedback } = req.body;

  if (!scene || !feedback) {
    return res.status(400).json({ success: false, error: '请提供场景和修改意见' });
  }

  try {
    const refined = await refineScene(scene, feedback);
    res.json({ success: true, data: refined });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 解析剧本，提取角色和场景
router.post('/parse-script', async (req, res) => {
  const { script, genre = 'drama', duration = 60 } = req.body;
  if (!script || !script.trim()) {
    return res.status(400).json({ success: false, error: '请提供剧本内容' });
  }
  try {
    const result = await parseScript({ script, genre, duration });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 生成角色形象图
router.post('/generate-character-image', async (req, res) => {
  const { name, role = 'main', description = '', dim = '2d', race = '人', species = '' } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: '请先填写角色名称' });
  }
  try {
    const result = await generateCharacterImage({ name: name.trim(), role, description, dim, race, species });
    res.json({ success: true, data: { imageUrl: `/api/story/character-image/${result.filename}`, dim } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 批量生成角色形象（并行）
router.post('/generate-character-images', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ success: false, error: '请提供角色列表' });
  }
  const settled = await Promise.allSettled(
    items.map(c => generateCharacterImage({ name: (c.name || '').trim(), role: c.role, description: c.description, dim: c.dim || '2d' }))
  );
  res.json({
    success: true,
    data: settled.map((r, i) => ({
      clientId: items[i].clientId,
      success: r.status === 'fulfilled',
      imageUrl: r.status === 'fulfilled' ? `/api/story/character-image/${r.value.filename}` : null,
      error: r.status === 'rejected' ? r.reason.message : null
    }))
  });
});

// 生成场景概念图
router.post('/generate-scene-image', async (req, res) => {
  const { title = '', description = '', theme = '', timeOfDay = '', category = '', dim = '2d' } = req.body;
  if (!title.trim() && !description.trim()) {
    return res.status(400).json({ success: false, error: '请填写场景名称或描述' });
  }
  try {
    const result = await generateSceneImage({ title: title.trim(), description: description.trim(), theme, timeOfDay, category, dim });
    res.json({ success: true, data: { imageUrl: `/api/story/character-image/${result.filename}` } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 提供角色图片文件
router.get('/character-image/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // 防路径穿越
  // 依次检查角色图目录和场景图目录（场景图也通过此路由提供）
  for (const dir of [CHAR_IMG_DIR, SCENE_IMG_DIR]) {
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) return res.sendFile(filePath);
  }
  return res.status(404).json({ error: 'not found' });
});

// ═══ 长篇剧情动画生成（中国国风专用） ═══
router.post('/generate-long', async (req, res) => {
  const {
    theme, genre = 'drama', duration = 120, language = '中文',
    scene_dim = '2d', char_dim = '2d', anim_style = '',
    episode_count = 1, episode_index = 1,
    characters = [], plot = {},
    previous_summary = '', style_notes = ''
  } = req.body;

  if (!theme) {
    return res.status(400).json({ success: false, error: '请提供主题' });
  }
  try {
    const story = await generateLongStory({
      theme, genre, duration, language,
      scene_dim, char_dim, anim_style,
      episode_count, episode_index,
      characters, plot,
      previous_summary, style_notes
    });
    res.json({ success: true, data: story });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ 动作资源目录 API ═══
router.get('/motions', (req, res) => {
  res.json({ success: true, data: motionService.getCatalog() });
});

router.get('/motions/stats', (req, res) => {
  res.json({ success: true, data: motionService.getStats() });
});

// 根据场景内容匹配动作
router.post('/motions/match', (req, res) => {
  const { text = '', action_type = 'normal', count = 5, style = '' } = req.body;
  const motions = motionService.matchMotionsForScene(text, action_type, count);
  const motionPrompt = motionService.buildMotionPrompt(text, action_type, style);
  res.json({ success: true, data: { motions, prompt: motionPrompt } });
});

// Slang detection
router.post('/detect-slang', (req, res) => {
  try {
    const { detectSlangTerms } = require('../services/slangService');
    const { text } = req.body;
    const matches = detectSlangTerms(text || '');
    res.json({ success: true, data: matches });
  } catch (e) {
    res.json({ success: true, data: [] });
  }
});

module.exports = router;
