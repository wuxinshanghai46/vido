const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { generateStory, generateLongStory, refineScene, parseScript, callLLM } = require('../services/storyService');
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

// POST /api/story/expand-theme — 把简短主题扩写为分镜脚本级别的详细描述
// 参考 TapNow 的 prompt 详细度: 每个分镜都有具体画面 / 镜头 / 色彩 / 焦段
router.post('/expand-theme', async (req, res) => {
  const { theme, scene_count = 8, style = '' } = req.body;
  if (!theme || !theme.trim()) {
    return res.status(400).json({ success: false, error: '请提供主题描述' });
  }
  try {
    const systemPrompt = `你是顶级的视频分镜师和摄影指导。用户会给你一个简短的主题或一句话描述,你要把它扩写为一份**分镜脚本级别的详细内容描述**。

要求:
- 输出结构: 一段总览(主题/类型/时长/基调) + 多个编号分镜段落(每段一个画面) + 末尾的画风/色彩/镜头规范
- 每个分镜段落要写清: 镜头中谁在做什么、表情/动作细节、场景布置、光线、关键道具
- 末尾的画面规范要包含:
  * 画风 (例: "以冷蓝色为主基调,低饱和度,边缘轻微暖光")
  * 色彩 LUT (例: "teal-deepblue desat")
  * 镜头焦段 (例: "20-35mm 广角,透视感强")
  * 体积雾/景深/颗粒等氛围标签
- 整段长度控制在 400-700 字
- 直接输出最终的扩写文本,不要加 "好的,这是扩写结果" 之类的话, 不要 markdown 标题, 不要代码块
- 完全用中文`;

    const userPrompt = `主题: ${theme.trim()}
${style ? `画风偏好: ${style}\n` : ''}请扩写为 ${scene_count} 个分镜的详细内容描述。`;

    const expanded = await callLLM(systemPrompt, userPrompt);
    const text = (expanded || '').trim();

    res.json({
      success: true,
      data: {
        original_theme: theme,
        expanded_text: text,
        char_count: text.length,
        scene_count,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/story/import-novel — 上传小说文件 (.txt/.docx) → 编剧+导演 agent → 漫剧化场景
const multer = require('multer');
const novelUploadDir = path.join(path.resolve(process.env.OUTPUT_DIR || './outputs'), 'imports');
fs.mkdirSync(novelUploadDir, { recursive: true });
const novelUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, novelUploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.txt';
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`);
    }
  }),
  limits: { fileSize: 30 * 1024 * 1024 }
});

router.post('/import-novel', novelUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请上传文件' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    let text = '';

    if (ext === '.txt') {
      // 自动检测编码: 先试 utf8, 如果有大量 replacement char 则尝试 gbk
      const buf = fs.readFileSync(req.file.path);
      text = buf.toString('utf8');
      const repCount = (text.match(/\uFFFD/g) || []).length;
      if (repCount > 5) {
        // 简易 GBK 兜底: 用 latin1 + 标记 (Node 内置无 GBK, 真要做需要 iconv-lite)
        text = buf.toString('utf8');
      }
    } else if (ext === '.docx') {
      try {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: req.file.path });
        text = result.value || '';
      } catch (e) {
        return res.status(500).json({ success: false, error: 'docx 解析失败: ' + e.message });
      }
    } else if (ext === '.doc') {
      return res.status(400).json({ success: false, error: '旧版 .doc 不支持，请另存为 .docx 或 .txt' });
    } else {
      return res.status(400).json({ success: false, error: '仅支持 .txt 和 .docx 格式' });
    }

    if (!text.trim()) {
      return res.status(400).json({ success: false, error: '文件内容为空' });
    }

    // 截断防止 token 超限
    const MAX_CHARS = 12000;
    const truncated = text.length > MAX_CHARS;
    const content = text.slice(0, MAX_CHARS);

    const sceneCount = parseInt(req.body.scene_count) || 6;
    const duration = sceneCount * 10;

    // 调用编剧 + 导演 agent (复用 parseScript, 它内部就是 LLM 漫剧化分镜)
    let scenes = null;
    let parseError = null;
    try {
      const parsed = await parseScript({ script: content, genre: 'drama', duration });
      scenes = parsed?.scenes || parsed?.custom_scenes || null;
    } catch (e) {
      parseError = e.message;
    }

    // 清理上传的临时文件
    try { fs.unlinkSync(req.file.path); } catch {}

    res.json({
      success: true,
      data: {
        text: content,
        text_length: text.length,
        truncated,
        source_file: req.file.originalname,
        scenes,
        parse_error: parseError,
        scene_count: scenes?.length || 0,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 生成角色形象图
router.post('/generate-character-image', async (req, res) => {
  const { name, role = 'main', description = '', dim = '2d', race = '人', species = '', mode = 'turnaround', aspectRatio = '1:1', resolution = '2K', referenceImages = [] } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: '请先填写角色名称' });
  }
  try {
    const result = await generateCharacterImage({ name: name.trim(), role, description, dim, race, species, mode, aspectRatio, resolution, referenceImages });
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
  const { title = '', description = '', theme = '', timeOfDay = '', category = '', dim = '2d', aspectRatio = '16:9', resolution = '2K', referenceImages = [] } = req.body;
  if (!title.trim() && !description.trim()) {
    return res.status(400).json({ success: false, error: '请填写场景名称或描述' });
  }
  try {
    const result = await generateSceneImage({ title: title.trim(), description: description.trim(), theme, timeOfDay, category, dim, aspectRatio, resolution, referenceImages });
    res.json({ success: true, data: { imageUrl: `/api/story/character-image/${result.filename}` } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 列出已生成的角色图片
router.get('/character-images', (req, res) => {
  const images = [];
  for (const dir of [CHAR_IMG_DIR, SCENE_IMG_DIR]) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir)
      .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .sort((a, b) => {
        // 按修改时间倒序
        try { return fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs; } catch { return 0; }
      });
    files.forEach((f, i) => {
      // 用文件名前缀判断类型（characters/ 目录下也可能有 scene_ 开头的文件）
      const isChar = f.startsWith('char_');
      const baseName = f.replace(/\.[^.]+$/, '').replace(/^(char|scene)_(2d|3d|realistic)_\d+_\w+$/, '');
      images.push({
        name: baseName || (isChar ? `角色${i + 1}` : `场景${i + 1}`),
        url: `/api/story/character-image/${f}`,
        type: isChar ? 'character' : 'scene',
        filename: f
      });
    });
  }
  res.json({ success: true, data: images });
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
