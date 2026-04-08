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

// POST /api/story/expand-theme — 把简短主题扩写为详细 prompt (即梦/TapNow 风格)
// 输出格式: 一整段连贯文字 + 内嵌编号画面列表 + 末尾画风/色彩 LUT/镜头规范
router.post('/expand-theme', async (req, res) => {
  const { theme, scene_count = 8, style = '' } = req.body;
  if (!theme || !theme.trim()) {
    return res.status(400).json({ success: false, error: '请提供主题描述' });
  }
  try {
    const systemPrompt = `你是顶级的视频生成 prompt 专家。用户给你一个简短主题, 你要把它扩写为一份**详细的图像/视频生成 prompt**, 风格严格参考"即梦 AI"和"TapNow"。

⚠️ 严格输出格式 (这一点非常重要):
1. 全部写成**一整段连贯文字**, 不要换行分段, 不要加"总览""【分镜1】""## "之类的标题或 markdown
2. 第一句简要点题, 例如: "生成一个 X 主题的短片分镜, 共 N 个画面:"
3. 紧接着用阿拉伯数字编号 + 句号的形式, 把所有画面写在一段里, 每个画面 1 句话:
   "1. 画面描述。 2. 画面描述。 3. 画面描述。 ... N. 画面描述。"
4. 所有画面写完后, 紧接着写 "画面风格: ..." 描述整体调性、配色、对比度、颗粒等
5. 然后写 "色彩 LUT: ..." (例: "teal-deepblue desat", "warm-orange film", "cyan-magenta neon")
6. 然后写 "镜头焦段约 X-Xmm, ..." 描述焦段、透视、体积雾、景深、虚化等摄影属性
7. 全文长度控制在 350-600 字
8. 完全用中文, 不要 markdown 不要代码块, 不要 "好的""以下是" 之类的开场白
9. 直接以"生成一个..."开头

参考示例 (严格按这个格式):
生成一个太空漫游主题的短片分镜, 共 8 个画面: 1. 火箭发射升空, 尾焰划破大气层。 2. 穿越云层的飞行镜头。 3. 巨大的星球在天空中缓慢移动。 4. 宇航员漂浮在空间站舷窗前, 望向远方星海。 5. 宇航员在零重力中漂浮, 四肢舒展, 背景是地球的弧线。 6. 飞船掠过行星环带。 7. 飞船外大批碎片在大气中坠落。 8. 宇航员背对镜头, 缓缓进入光芒中消失。 画面风格: 以冷蓝色为主基调, 低饱和度, 边缘带轻微暖光, 长曝光光晕与体积光效果。整体对比度低、噪点颗粒细腻; 远景呈极深景深。 色彩 LUT: teal-deepblue desat。 镜头焦段约 20-35mm, 透视感强, 暖色边缘光勾勒轮廓, 体积雾、长焦虚化效果, 画面具备写实质感。`;

    const userPrompt = `主题: ${theme.trim()}
${style ? `画风偏好: ${style}\n` : ''}请按照系统提示中的参考示例格式, 扩写为 ${scene_count} 个画面的详细 prompt, 一整段文字, 内嵌编号列表, 不要分段, 不要加标题。`;

    const expanded = await callLLM(systemPrompt, userPrompt);
    let text = (expanded || '').trim();
    // 后处理: 强制清理可能的 markdown 标题、过多换行
    text = text
      .replace(/^#+\s+.*$/gm, '')                         // 去 # 标题
      .replace(/【[^】]*】/g, '')                          // 去【】标记
      .replace(/^总览[::].*$/gm, '')                       // 去 "总览:" 行
      .replace(/^\s*分镜\s*\d+[::].*/gm, '')              // 去 "分镜 1:" 行
      .replace(/\n{2,}/g, ' ')                            // 多个换行合并成空格
      .replace(/\n/g, ' ')                                // 单换行也合并 (要求一段连贯)
      .replace(/\s{2,}/g, ' ')                            // 多空格合并
      .trim();

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
