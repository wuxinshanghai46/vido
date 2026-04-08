/**
 * AI 能力模块路由
 * 角色库 / 场景库 / 风格库 / 小说导入 / 单格重抽
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const db = require('../models/database');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');

// ——— 文件上传配置 ———
function mkUploader(subDir) {
  const dir = path.join(OUTPUT_DIR, 'ai_cap', subDir);
  fs.mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, dir),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.png';
        cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`);
      }
    }),
    limits: { fileSize: 20 * 1024 * 1024 }
  });
}

const charUpload  = mkUploader('characters');
const sceneUpload = mkUploader('scenes');
const styleUpload = mkUploader('styles');
const scriptUpload = mkUploader('scripts');

// ══════════════════════════════════════════════
// 角色库 CRUD
// ══════════════════════════════════════════════

// GET /api/ai-cap/characters — 列表
router.get('/characters', (req, res) => {
  const chars = db.listAIChars(req.user?.id);
  res.json({ success: true, data: chars });
});

// GET /api/ai-cap/characters/:id — 详情
router.get('/characters/:id', (req, res) => {
  const c = db.getAIChar(req.params.id);
  if (!c) return res.status(404).json({ success: false, error: '角色不存在' });
  res.json({ success: true, data: c });
});

// POST /api/ai-cap/characters — 创建角色
router.post('/characters', charUpload.array('ref_images', 5), (req, res) => {
  try {
    const { name, personality, appearance, appearance_prompt, gender, age_range, tags } = req.body;
    if (!name) return res.status(400).json({ success: false, error: '角色名称必填' });

    const refImages = (req.files || []).map(f => `/api/ai-cap/file/characters/${f.filename}`);

    const char = {
      id: uuidv4(),
      user_id: req.user?.id,
      name,
      personality: personality || '',
      appearance: appearance || '',
      appearance_prompt: appearance_prompt || '',
      gender: gender || '',
      age_range: age_range || '',
      tags: tags ? (typeof tags === 'string' ? JSON.parse(tags) : tags) : [],
      ref_images: refImages,
    };
    db.insertAIChar(char);
    res.json({ success: true, data: char });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/ai-cap/characters/:id — 更新角色
router.put('/characters/:id', charUpload.array('ref_images', 5), (req, res) => {
  const existing = db.getAIChar(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: '角色不存在' });

  const fields = {};
  for (const key of ['name', 'personality', 'appearance', 'appearance_prompt', 'gender', 'age_range']) {
    if (req.body[key] !== undefined) fields[key] = req.body[key];
  }
  if (req.body.tags) {
    fields.tags = typeof req.body.tags === 'string' ? JSON.parse(req.body.tags) : req.body.tags;
  }
  // 追加新上传的参考图
  if (req.files?.length) {
    const newImages = req.files.map(f => `/api/ai-cap/file/characters/${f.filename}`);
    fields.ref_images = [...(existing.ref_images || []), ...newImages];
  }
  db.updateAIChar(req.params.id, fields);
  res.json({ success: true, data: { ...existing, ...fields } });
});

// DELETE /api/ai-cap/characters/:id — 删除角色
router.delete('/characters/:id', (req, res) => {
  db.deleteAIChar(req.params.id);
  res.json({ success: true });
});

// DELETE /api/ai-cap/characters/:id/images — 删除角色的某张参考图
router.delete('/characters/:id/images', (req, res) => {
  const existing = db.getAIChar(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: '角色不存在' });
  const { image_url } = req.body;
  const ref_images = (existing.ref_images || []).filter(u => u !== image_url);
  db.updateAIChar(req.params.id, { ref_images });
  res.json({ success: true });
});

// POST /api/ai-cap/characters/:id/generate-image — AI 生成角色参考图
router.post('/characters/:id/generate-image', async (req, res) => {
  const char = db.getAIChar(req.params.id);
  if (!char) return res.status(404).json({ success: false, error: '角色不存在' });
  try {
    const { generateCharacterImage } = require('../services/imageService');
    const prompt = char.appearance_prompt || char.appearance || `${char.name}, ${char.personality}`;
    const result = await generateCharacterImage({
      name: `aichar_${Date.now()}`,
      role: 'other',
      description: prompt,
      dim: '2d', race: '人', species: '', animStyle: ''
    });
    const destDir = path.join(OUTPUT_DIR, 'ai_cap', 'characters');
    fs.mkdirSync(destDir, { recursive: true });
    const destName = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
    const destPath = path.join(destDir, destName);
    if (result.filePath && fs.existsSync(result.filePath)) {
      fs.copyFileSync(result.filePath, destPath);
    }
    const imageUrl = `/api/ai-cap/file/characters/${destName}`;
    const ref_images = [...(char.ref_images || []), imageUrl];
    db.updateAIChar(req.params.id, { ref_images });
    res.json({ success: true, data: { image_url: imageUrl } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ai-cap/characters/:id/generate-three-view — 生成角色三视图(前/侧/后)
// 参考样式: AI 漫剧教程强调的"角色三视图"用于跨镜头一致性
router.post('/characters/:id/generate-three-view', async (req, res) => {
  const char = db.getAIChar(req.params.id);
  if (!char) return res.status(404).json({ success: false, error: '角色不存在' });
  try {
    const { generateCharacterImage } = require('../services/imageService');
    const basePrompt = char.appearance_prompt || char.appearance || `${char.name}, ${char.personality}`;
    const views = [
      { key: 'front', label: '前视图', suffix: ', front view, facing camera, full body, T-pose, neutral expression, white background, character reference sheet' },
      { key: 'side',  label: '侧视图', suffix: ', side view, profile, full body, T-pose, neutral expression, white background, character reference sheet' },
      { key: 'back',  label: '后视图', suffix: ', back view, facing away, full body, T-pose, neutral expression, white background, character reference sheet' },
    ];

    const destDir = path.join(OUTPUT_DIR, 'ai_cap', 'characters');
    fs.mkdirSync(destDir, { recursive: true });

    const three_view = {};
    const newRefImages = [];
    for (const v of views) {
      try {
        const result = await generateCharacterImage({
          name: `aichar_${v.key}_${Date.now()}`,
          role: 'other',
          description: basePrompt + v.suffix,
          dim: '2d', race: '人', species: '', animStyle: '',
          aspectRatio: '1:1'
        });
        if (result.filePath && fs.existsSync(result.filePath)) {
          const destName = `tv_${v.key}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
          const destPath = path.join(destDir, destName);
          fs.copyFileSync(result.filePath, destPath);
          const imageUrl = `/api/ai-cap/file/characters/${destName}`;
          three_view[v.key] = imageUrl;
          newRefImages.push(imageUrl);
        }
      } catch (e) {
        console.warn(`[generate-three-view] ${v.key} failed:`, e.message);
      }
    }

    const ref_images = [...(char.ref_images || []), ...newRefImages];
    db.updateAIChar(req.params.id, { ref_images, three_view });
    res.json({ success: true, data: { three_view, generated: Object.keys(three_view).length } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ai-cap/characters/:id/generate-expressions — 生成表情包(6 种)
router.post('/characters/:id/generate-expressions', async (req, res) => {
  const char = db.getAIChar(req.params.id);
  if (!char) return res.status(404).json({ success: false, error: '角色不存在' });
  try {
    const { generateCharacterImage } = require('../services/imageService');
    const basePrompt = char.appearance_prompt || char.appearance || `${char.name}, ${char.personality}`;
    const expressions = [
      { key: 'happy',    label: '开心', en: 'happy smiling expression, cheerful' },
      { key: 'sad',      label: '悲伤', en: 'sad melancholy expression, downcast eyes' },
      { key: 'angry',    label: '愤怒', en: 'angry furious expression, furrowed brow' },
      { key: 'surprised',label: '惊讶', en: 'surprised wide-eyed expression, open mouth' },
      { key: 'shy',      label: '害羞', en: 'shy bashful expression, blushing cheeks' },
      { key: 'serious',  label: '严肃', en: 'serious determined expression, intense gaze' },
    ];

    const destDir = path.join(OUTPUT_DIR, 'ai_cap', 'characters');
    fs.mkdirSync(destDir, { recursive: true });

    const expression_pack = {};
    const newRefImages = [];
    for (const e of expressions) {
      try {
        const result = await generateCharacterImage({
          name: `aichar_exp_${e.key}_${Date.now()}`,
          role: 'other',
          description: basePrompt + `, ${e.en}, close-up portrait, headshot, white background`,
          dim: '2d', race: '人', species: '', animStyle: '',
          aspectRatio: '1:1'
        });
        if (result.filePath && fs.existsSync(result.filePath)) {
          const destName = `exp_${e.key}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
          const destPath = path.join(destDir, destName);
          fs.copyFileSync(result.filePath, destPath);
          const imageUrl = `/api/ai-cap/file/characters/${destName}`;
          expression_pack[e.key] = imageUrl;
          newRefImages.push(imageUrl);
        }
      } catch (e2) {
        console.warn(`[generate-expressions] ${e.key} failed:`, e2.message);
      }
    }

    const ref_images = [...(char.ref_images || []), ...newRefImages];
    db.updateAIChar(req.params.id, { ref_images, expression_pack });
    res.json({ success: true, data: { expression_pack, generated: Object.keys(expression_pack).length } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/ai-cap/characters/:id/card — 角色卡 HTML(可打印)
router.get('/characters/:id/card', (req, res) => {
  const char = db.getAIChar(req.params.id);
  if (!char) return res.status(404).send('角色不存在');
  const tv = char.three_view || {};
  const ep = char.expression_pack || {};
  const tags = (char.tags || []).map(t => `<span class="tag">${t}</span>`).join('');
  const tvHtml = ['front','side','back'].map(k => tv[k] ? `<div class="view"><img src="${tv[k]}"/><div>${({front:'前视图',side:'侧视图',back:'后视图'})[k]}</div></div>` : '').join('');
  const epLabels = { happy:'开心', sad:'悲伤', angry:'愤怒', surprised:'惊讶', shy:'害羞', serious:'严肃' };
  const epHtml = Object.keys(epLabels).map(k => ep[k] ? `<div class="exp"><img src="${ep[k]}"/><div>${epLabels[k]}</div></div>` : '').join('');
  res.send(`<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>角色卡 - ${char.name}</title>
<style>
  body { font-family: 'Inter', -apple-system, sans-serif; background: #0a0a0e; color: #eee; padding: 32px; max-width: 1000px; margin: 0 auto; }
  h1 { font-size: 28px; margin: 0 0 4px; color: #fff; }
  .meta { color: rgba(255,255,255,.5); font-size: 12px; margin-bottom: 18px; }
  .tag { display: inline-block; padding: 2px 10px; background: rgba(255,255,255,.08); border-radius: 999px; font-size: 11px; margin-right: 6px; }
  h2 { font-size: 16px; color: #fff; border-bottom: 1px solid rgba(255,255,255,.1); padding-bottom: 6px; margin-top: 24px; }
  .desc { background: rgba(255,255,255,.04); padding: 12px 14px; border-radius: 10px; line-height: 1.7; font-size: 13px; color: rgba(255,255,255,.85); }
  .three-view, .expressions { display: grid; gap: 12px; margin-top: 12px; }
  .three-view { grid-template-columns: repeat(3, 1fr); }
  .expressions { grid-template-columns: repeat(6, 1fr); }
  .view, .exp { background: rgba(255,255,255,.04); padding: 8px; border-radius: 10px; text-align: center; }
  .view img, .exp img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; display: block; }
  .view div, .exp div { font-size: 11px; color: rgba(255,255,255,.6); margin-top: 6px; }
  .empty { color: rgba(255,255,255,.3); font-size: 12px; padding: 20px; text-align: center; background: rgba(255,255,255,.02); border-radius: 10px; }
  @media print { body { background: #fff; color: #000; } .tag { background: #eee; } .desc, .view, .exp, .empty { background: #f5f5f5; } }
</style></head><body>
<h1>${char.name}</h1>
<div class="meta">${char.gender || ''} · ${char.age_range || ''} · ${tags || ''}</div>
<h2>外貌描述</h2>
<div class="desc">${char.appearance || char.appearance_prompt || '<i>未填写</i>'}</div>
<h2>性格</h2>
<div class="desc">${char.personality || '<i>未填写</i>'}</div>
<h2>三视图</h2>
${tvHtml ? `<div class="three-view">${tvHtml}</div>` : '<div class="empty">尚未生成三视图,请在角色库点击「生成三视图」</div>'}
<h2>表情包</h2>
${epHtml ? `<div class="expressions">${epHtml}</div>` : '<div class="empty">尚未生成表情包,请在角色库点击「生成表情包」</div>'}
</body></html>`);
});

// ══════════════════════════════════════════════
// 场景库 CRUD
// ══════════════════════════════════════════════

// GET /api/ai-cap/scenes
router.get('/scenes', (req, res) => {
  const scenes = db.listAIScenes(req.user?.id);
  res.json({ success: true, data: scenes });
});

// GET /api/ai-cap/scenes/:id
router.get('/scenes/:id', (req, res) => {
  const s = db.getAIScene(req.params.id);
  if (!s) return res.status(404).json({ success: false, error: '场景不存在' });
  res.json({ success: true, data: s });
});

// POST /api/ai-cap/scenes
router.post('/scenes', sceneUpload.array('ref_images', 5), (req, res) => {
  try {
    const { name, description, scene_type, scene_prompt, tags } = req.body;
    if (!name) return res.status(400).json({ success: false, error: '场景名称必填' });

    const refImages = (req.files || []).map(f => `/api/ai-cap/file/scenes/${f.filename}`);

    const scene = {
      id: uuidv4(),
      user_id: req.user?.id,
      name,
      description: description || '',
      scene_type: scene_type || 'outdoor',
      scene_prompt: scene_prompt || '',
      tags: tags ? (typeof tags === 'string' ? JSON.parse(tags) : tags) : [],
      ref_images: refImages,
    };
    db.insertAIScene(scene);
    res.json({ success: true, data: scene });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/ai-cap/scenes/:id
router.put('/scenes/:id', sceneUpload.array('ref_images', 5), (req, res) => {
  const existing = db.getAIScene(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: '场景不存在' });

  const fields = {};
  for (const key of ['name', 'description', 'scene_type', 'scene_prompt']) {
    if (req.body[key] !== undefined) fields[key] = req.body[key];
  }
  if (req.body.tags) {
    fields.tags = typeof req.body.tags === 'string' ? JSON.parse(req.body.tags) : req.body.tags;
  }
  if (req.files?.length) {
    const newImages = req.files.map(f => `/api/ai-cap/file/scenes/${f.filename}`);
    fields.ref_images = [...(existing.ref_images || []), ...newImages];
  }
  db.updateAIScene(req.params.id, fields);
  res.json({ success: true, data: { ...existing, ...fields } });
});

// DELETE /api/ai-cap/scenes/:id
router.delete('/scenes/:id', (req, res) => {
  db.deleteAIScene(req.params.id);
  res.json({ success: true });
});

// POST /api/ai-cap/scenes/:id/generate-image — AI 生成场景参考图
router.post('/scenes/:id/generate-image', async (req, res) => {
  const scene = db.getAIScene(req.params.id);
  if (!scene) return res.status(404).json({ success: false, error: '场景不存在' });
  try {
    const { generateCharacterImage } = require('../services/imageService');
    const prompt = scene.scene_prompt || scene.description || scene.name;
    const result = await generateCharacterImage({
      name: `aiscene_${Date.now()}`,
      role: 'other',
      description: `${prompt}, detailed background scene, no characters, cinematic lighting, high quality`,
      dim: '2d', race: '', species: '', animStyle: ''
    });
    const destDir = path.join(OUTPUT_DIR, 'ai_cap', 'scenes');
    fs.mkdirSync(destDir, { recursive: true });
    const destName = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
    const destPath = path.join(destDir, destName);
    if (result.filePath && fs.existsSync(result.filePath)) {
      fs.copyFileSync(result.filePath, destPath);
    }
    const imageUrl = `/api/ai-cap/file/scenes/${destName}`;
    const ref_images = [...(scene.ref_images || []), imageUrl];
    db.updateAIScene(req.params.id, { ref_images });
    res.json({ success: true, data: { image_url: imageUrl } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════
// 风格库 CRUD
// ══════════════════════════════════════════════

// 内置预设风格（初始化用）
const PRESET_STYLES = [
  // 写实/电影
  { name: '电影写实', prompt_en: 'cinematic realistic style, photorealistic, shallow depth of field, anamorphic lens flare, film grain, natural skin texture, volumetric lighting, 35mm film look, Hollywood cinematography, 8K', category: 'realistic' },
  { name: '真人摄影', prompt_en: 'professional photography style, DSLR quality, sharp focus, natural lighting, photorealistic skin detail, bokeh background, magazine editorial look, 8K ultra HD', category: 'realistic' },
  { name: '3D写实', prompt_en: 'photorealistic 3D CGI render, Unreal Engine 5 quality, subsurface scattering, ray tracing, cinematic lighting, octane render, hyper-detailed textures, 8K', category: 'realistic' },
  { name: '油画写实', prompt_en: 'oil painting style, realistic proportions, rich textures, classical art composition, dramatic chiaroscuro lighting, Renaissance master technique', category: 'realistic' },
  // 动漫/漫画
  { name: '日系动漫', prompt_en: 'Japanese anime style, clean linework, screen tones, dramatic shading, anime aesthetic, vibrant colors, expressive eyes', category: 'manga' },
  { name: '美式漫画', prompt_en: 'American comic book style, bold ink lines, halftone dots, dynamic composition, Marvel/DC aesthetic', category: 'comic' },
  { name: '韩国漫画', prompt_en: 'Korean manhwa webtoon style, clean digital art, soft gradients, modern character design, beautiful color palette', category: 'manga' },
  { name: '欧式漫画', prompt_en: 'European graphic novel style, detailed cross-hatching, muted color palette, Moebius inspired', category: 'comic' },
  { name: '少年漫画', prompt_en: 'shonen manga style, dynamic action lines, speed lines, intense expressions, dramatic poses, high energy', category: 'manga' },
  { name: '少女漫画', prompt_en: 'shoujo manga style, sparkle effects, flower backgrounds, soft dreamy atmosphere, beautiful characters', category: 'manga' },
  // 中国风
  { name: '水墨漫画', prompt_en: 'Chinese ink wash manga style, brush stroke art, traditional Chinese painting meets manga, misty atmosphere', category: 'traditional' },
  { name: '国风仙侠', prompt_en: 'Chinese xianxia fantasy style, flowing robes, cloud motifs, ethereal atmosphere, traditional Chinese art meets modern illustration, golden and jade tones', category: 'traditional' },
  { name: '国风古韵', prompt_en: 'ancient Chinese traditional art style, Song Dynasty painting aesthetic, delicate brushwork, silk scroll texture, muted earth tones, poetic atmosphere', category: 'traditional' },
  // 3D/卡通
  { name: '迪士尼卡通', prompt_en: 'Disney Pixar 3D animation style, rounded features, expressive eyes, vibrant colors, subsurface scattering skin, warm cinematic lighting', category: 'cartoon' },
  { name: '3D动画', prompt_en: 'high quality 3D animation style, stylized character design, Pixar quality render, soft ambient occlusion, colorful palette, family-friendly aesthetic', category: 'cartoon' },
  // 科幻/暗黑
  { name: '赛博朋克', prompt_en: 'cyberpunk style, neon purple and cyan lights, dark futuristic cityscape, holographic effects, rain-slicked streets, Blade Runner aesthetic, high contrast', category: 'scifi' },
  { name: '暗黑哥特', prompt_en: 'dark gothic style, heavy shadows, ornate details, cathedral architecture, dramatic contrast, blood red accents, Victorian horror', category: 'dark' },
  { name: '末日废土', prompt_en: 'post-apocalyptic wasteland style, rust and decay textures, desolate landscape, muted desaturated colors, harsh sunlight, survival aesthetic', category: 'dark' },
  // 特殊风格
  { name: '治愈系', prompt_en: 'healing iyashikei style, soft pastel colors, warm golden lighting, gentle expressions, cozy atmosphere, watercolor texture, Studio Ghibli inspired', category: 'soft' },
  { name: '像素风格', prompt_en: 'pixel art style, retro game aesthetic, 16-bit color palette, clean pixel edges, nostalgic', category: 'stylized' },
  { name: '水彩手绘', prompt_en: 'watercolor painting style, soft washes of color, visible brush strokes, paper texture, dreamy atmospheric perspective, artistic imperfection', category: 'stylized' },
  { name: '黑白电影', prompt_en: 'black and white film noir style, high contrast, dramatic shadows, vintage 1940s cinematography, grain texture, moody atmosphere', category: 'realistic' },
];

// GET /api/ai-cap/styles — 列表（含预设 + 自定义）
router.get('/styles', (req, res) => {
  let styles = db.listAIStyles();
  // 自动注入缺失的预设风格（首次或新增预设时）
  const existingNames = new Set(styles.map(s => s.name));
  let added = false;
  for (const preset of PRESET_STYLES) {
    if (!existingNames.has(preset.name)) {
      db.insertAIStyle({ id: uuidv4(), name: preset.name, prompt_en: preset.prompt_en, category: preset.category, is_preset: true, ref_image: '' });
      added = true;
    }
  }
  if (added) styles = db.listAIStyles();
  res.json({ success: true, data: styles });
});

// POST /api/ai-cap/styles — 新增风格
router.post('/styles', styleUpload.single('ref_image'), (req, res) => {
  try {
    const { name, prompt_en, category } = req.body;
    if (!name || !prompt_en) return res.status(400).json({ success: false, error: '名称和英文 prompt 必填' });

    const style = {
      id: uuidv4(),
      name,
      prompt_en,
      category: category || 'custom',
      is_preset: false,
      ref_image: req.file ? `/api/ai-cap/file/styles/${req.file.filename}` : '',
    };
    db.insertAIStyle(style);
    res.json({ success: true, data: style });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/ai-cap/styles/:id
router.put('/styles/:id', styleUpload.single('ref_image'), (req, res) => {
  const existing = db.getAIStyle(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: '风格不存在' });

  const fields = {};
  for (const key of ['name', 'prompt_en', 'category']) {
    if (req.body[key] !== undefined) fields[key] = req.body[key];
  }
  if (req.file) fields.ref_image = `/api/ai-cap/file/styles/${req.file.filename}`;
  db.updateAIStyle(req.params.id, fields);
  res.json({ success: true, data: { ...existing, ...fields } });
});

// DELETE /api/ai-cap/styles/:id
router.delete('/styles/:id', (req, res) => {
  db.deleteAIStyle(req.params.id);
  res.json({ success: true });
});

// ══════════════════════════════════════════════
// 小说/剧本导入解析
// ══════════════════════════════════════════════

// POST /api/ai-cap/import-script — 上传 TXT/PDF 并 AI 解析为分镜结构
router.post('/import-script', scriptUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请上传文件' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    let text = '';

    if (ext === '.txt') {
      text = fs.readFileSync(req.file.path, 'utf8');
    } else if (ext === '.pdf') {
      // 简单 PDF 文本提取（仅提取可识别文字）
      const buf = fs.readFileSync(req.file.path);
      const matches = buf.toString('latin1').match(/\(([^)]+)\)/g);
      text = matches ? matches.map(m => m.slice(1, -1)).join(' ') : '';
      if (!text.trim()) {
        return res.status(400).json({ success: false, error: 'PDF 无法提取文本，请使用 TXT 格式' });
      }
    } else {
      return res.status(400).json({ success: false, error: '仅支持 .txt 和 .pdf 格式' });
    }

    // 截取前 8000 字（避免 token 超限）
    const truncated = text.slice(0, 8000);
    const { style, pages, panels_per_page, characters: charIds } = req.body;

    // 查询角色库中选中的角色
    const selectedChars = (charIds ? (typeof charIds === 'string' ? JSON.parse(charIds) : charIds) : [])
      .map(id => db.getAIChar(id)).filter(Boolean);

    const charDesc = selectedChars.length
      ? `\n已选角色（必须使用这些角色）：\n${selectedChars.map(c => `- ${c.name}：外貌=${c.appearance}，性格=${c.personality}`).join('\n')}`
      : '';

    const { callLLM } = require('../services/storyService');
    const systemPrompt = `你是专业的漫画编剧和分镜师。将用户提供的小说/剧本文本拆解为漫画分镜脚本。
要求：
- 提炼核心剧情，删去冗余描写
- 自动识别主要角色并保持一致
- 每个面板有清晰的画面描述和简洁对话
- 严格输出 JSON 格式`;

    const userPrompt = `将以下文本转换为漫画分镜脚本：

【原文】
${truncated}

【参数】
画风：${style || '日系动漫'}
页数：${pages || 4}，每页 ${panels_per_page || 4} 格${charDesc}

输出 JSON：
{
  "title": "标题",
  "synopsis": "一句话简介",
  "extracted_characters": [
    { "name": "角色名", "appearance": "外貌特征", "personality": "性格" }
  ],
  "pages": [
    {
      "page_number": 1,
      "panels": [
        {
          "index": 1,
          "description": "中文画面描述",
          "dialogue": "对话",
          "speaker": "说话角色",
          "narrator": "旁白",
          "sfx": "音效",
          "emotion": "情感基调",
          "visual_prompt": "English visual description for image generation"
        }
      ]
    }
  ]
}`;

    const raw = await callLLM(systemPrompt, userPrompt);

    // 复用 comicService 的 JSON 解析
    let parsed;
    try {
      let str = raw.trim();
      const m = str.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (m) str = m[1].trim();
      const start = str.indexOf('{');
      const end = str.lastIndexOf('}');
      if (start !== -1 && end > start) str = str.slice(start, end + 1);
      parsed = JSON.parse(str);
    } catch {
      parsed = JSON.parse(raw);
    }

    res.json({
      success: true,
      data: {
        script: parsed,
        source_file: req.file.originalname,
        text_length: text.length,
        truncated: text.length > 8000,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════
// 单格重抽
// ══════════════════════════════════════════════

// POST /api/ai-cap/comic/:taskId/repaint — 重新生成单个面板
router.post('/comic/:taskId/repaint', async (req, res) => {
  try {
    const { page_index, panel_index, custom_prompt } = req.body;
    if (page_index === undefined || panel_index === undefined) {
      return res.status(400).json({ success: false, error: '需要 page_index 和 panel_index' });
    }

    const task = db.getComicTask(req.params.taskId);
    if (!task || !task.result) return res.status(404).json({ success: false, error: '漫画任务不存在或未完成' });

    const page = task.result.pages?.[page_index];
    if (!page) return res.status(400).json({ success: false, error: '页码不存在' });
    const panel = page.panels?.[panel_index];
    if (!panel) return res.status(400).json({ success: false, error: '面板不存在' });

    // 使用 comicService 重新生成
    const { generatePanelImage, composePage, COMIC_DIR } = require('../services/comicService');
    const taskDir = path.join(COMIC_DIR, req.params.taskId);
    const style = task.result.style || task.style || '日系动漫';

    // 如果有自定义 prompt，覆盖
    const panelData = { ...panel };
    if (custom_prompt) panelData.visual_prompt = custom_prompt;

    const result = await generatePanelImage(panelData, style, taskDir);

    // 更新面板数据
    const updatedPages = JSON.parse(JSON.stringify(task.result.pages));
    updatedPages[page_index].panels[panel_index].image = result.filename;

    // 重新合成该页
    const allPanelPaths = updatedPages[page_index].panels.map(p => {
      return path.join(taskDir, p.image);
    }).filter(p => fs.existsSync(p));

    await composePage(allPanelPaths, page_index + 1, taskDir);
    updatedPages[page_index].filename = `page_${page_index + 1}.png`;

    // 更新数据库
    db.updateComicTask(req.params.taskId, { result: { ...task.result, pages: updatedPages } });

    res.json({
      success: true,
      data: {
        panel_image: `/api/comic/tasks/${req.params.taskId}/panels/${result.filename}`,
        page_image: `/api/comic/tasks/${req.params.taskId}/pages/${page_index + 1}`,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════
// 静态文件服务（公开，img 标签不带 token）
// ══════════════════════════════════════════════
// 注意：此路由在 server.js 中单独注册为公开路由

// ══════════════════════════════════════════════
// 概览：列出所有 AI 能力库的统计
// ══════════════════════════════════════════════
router.get('/stats', (req, res) => {
  const userId = req.user?.id;
  res.json({
    success: true,
    data: {
      characters: db.listAIChars(userId).length,
      scenes: db.listAIScenes(userId).length,
      styles: db.listAIStyles().length,
    }
  });
});

module.exports = router;
