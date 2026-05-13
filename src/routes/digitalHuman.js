/**
 * 数字人板块 3 步向导后端
 *   /api/dh/images/generate   — Seedream 文生图（人+背景一体）
 *   /api/dh/images/upload     — 上传真人照片
 *   /api/dh/my-avatars        — 我的形象 CRUD（落 portrait_db, kind=digital_human）
 *
 *   Step3 的 AI 写稿 / 按秒拆分 / 出片 全部复用已有 /api/avatar/* 路由
 *   此处只补"形象生成 + 永久保存"这一块原先完全缺失的能力
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { execFileSync } = require('child_process');
const db = require('../models/database');
const { scopeUserId, ownedBy } = require('../middleware/auth');
const avatarService = require('../services/avatarService');

const JIMENG_ASSETS_DIR = path.join(__dirname, '../../outputs/jimeng-assets');
const DH_IMAGES_DIR = path.join(__dirname, '../../outputs/dh-images');
fs.mkdirSync(JIMENG_ASSETS_DIR, { recursive: true });
fs.mkdirSync(DH_IMAGES_DIR, { recursive: true });

function _toneTtsParams(tone) {
  const t = String(tone || 'natural').toLowerCase();
  const map = {
    natural: { speed: 1.0, pitch: 1.0 },
    calm: { speed: 0.88, pitch: 0.95 },
    serious: { speed: 0.92, pitch: 0.92 },
    excited: { speed: 1.16, pitch: 1.10 },
    encouraging: { speed: 1.08, pitch: 1.06 },
    warm: { speed: 0.95, pitch: 1.03 },
    firm: { speed: 0.94, pitch: 0.94 },
    curious: { speed: 1.06, pitch: 1.08 },
    confident: { speed: 1.02, pitch: 0.98 },
    gentle: { speed: 0.9, pitch: 1.02 },
    urgent: { speed: 1.2, pitch: 1.05 },
    humorous: { speed: 1.1, pitch: 1.08 },
  };
  return map[t] || map.natural;
}

async function _synthesizeSegmentedSpeech(req, { text, voiceId, segments }) {
  const usable = (Array.isArray(segments) ? segments : [])
    .filter(s => s?.text && String(s.text).trim())
    .slice(0, 20);
  if (usable.length < 2) return null;
  const { generateSpeech } = require('../services/ttsService');
  const ffmpegPath = (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== 'ffmpeg')
    ? process.env.FFMPEG_PATH
    : require('ffmpeg-static');
  const workDir = path.join(JIMENG_ASSETS_DIR, `segtts_${Date.now()}_${uuidv4().slice(0, 8)}`);
  fs.mkdirSync(workDir, { recursive: true });
  const files = [];
  for (let i = 0; i < usable.length; i++) {
    const seg = usable[i];
    const tone = seg.tone || seg.delivery || seg.voice_tone || 'natural';
    const p = _toneTtsParams(tone);
    const outBase = path.join(workDir, `seg_${String(i).padStart(2, '0')}`);
    const file = await generateSpeech(seg.text, outBase, { voiceId: voiceId || null, speed: p.speed, pitch: p.pitch });
    if (!file || !fs.existsSync(file)) throw new Error(`第 ${i + 1} 段语气合成失败`);
    files.push(file);
  }
  const listPath = path.join(workDir, 'concat.txt');
  fs.writeFileSync(listPath, files.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
  const finalName = `segtts_${Date.now()}_${uuidv4().slice(0, 8)}.mp3`;
  const finalPath = path.join(JIMENG_ASSETS_DIR, finalName);
  execFileSync(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:a', 'libmp3lame', '-q:a', '3', finalPath], { stdio: 'pipe', timeout: 120000 });
  if (!fs.existsSync(finalPath) || fs.statSync(finalPath).size < 500) throw new Error('分段语气音频拼接失败');
  return `${_publicBaseUrl(req)}/public/jimeng-assets/${finalName}`;
}

function _splitSubtitleText(text, maxChars = 14) {
  const src = String(text || '').replace(/\s+/g, '').trim();
  if (!src) return [];
  const parts = src.match(/[^。！？!?，,；;、]+[。！？!?，,；;、]?/g) || [src];
  const out = [];
  for (const part of parts) {
    let s = part.trim();
    while (s.length > maxChars) {
      let cut = maxChars;
      const near = s.slice(0, maxChars + 4).search(/[。！？!?，,；;、]/);
      if (near >= Math.floor(maxChars * 0.55)) cut = near + 1;
      out.push(s.slice(0, cut));
      s = s.slice(cut);
    }
    if (s) out.push(s);
  }
  return out.filter(Boolean);
}

function _normalizeSubtitleSegments(segments, text) {
  const source = Array.isArray(segments) && segments.length
    ? segments
    : [{ text, start: 0, end: Math.max(1, String(text || '').length * 0.25) }];
  const normalized = [];
  let fallbackCursor = 0;
  for (const seg of source) {
    const segText = String(seg?.text || '').trim();
    if (!segText) continue;
    const chunks = _splitSubtitleText(segText, 14);
    if (!chunks.length) continue;
    const start = Number.isFinite(Number(seg.start ?? seg.startTime)) ? Number(seg.start ?? seg.startTime) : fallbackCursor;
    const rawEnd = Number(seg.end ?? seg.endTime);
    const estimated = Math.max(0.8, segText.length * 0.25);
    const end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start + estimated;
    const totalUnits = chunks.reduce((sum, chunk) => sum + Math.max(1, chunk.length), 0) || 1;
    let cursor = start;
    chunks.forEach((chunk, i) => {
      const isLast = i === chunks.length - 1;
      const dur = isLast ? (end - cursor) : Math.max(0.55, (end - start) * (Math.max(1, chunk.length) / totalUnits));
      const next = isLast ? end : Math.min(end - 0.05, cursor + dur);
      normalized.push({ ...seg, text: chunk, start: cursor, end: Math.max(cursor + 0.35, next) });
      cursor = next;
    });
    fallbackCursor = Math.max(fallbackCursor, end);
  }
  return normalized;
}

const upload = multer({
  dest: path.join(__dirname, '../../outputs/dh-uploads'),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype?.startsWith('image/') || /\.(png|jpe?g|webp|bmp)$/i.test(file.originalname || '');
    cb(null, ok);
  },
});

const _sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const productAdTasks = new Map();

function _pickPipelineModel(stageId) {
  try {
    return require('../services/pipelineModelService').pickModelWithDefault(stageId);
  } catch {
    return null;
  }
}

router.post('/products/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请选择商品图片' });
    const ext = (path.extname(req.file.originalname || '') || '.jpg').toLowerCase();
    const filename = `product_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`;
    const dst = path.join(JIMENG_ASSETS_DIR, filename);
    fs.copyFileSync(req.file.path, dst);
    try { fs.unlinkSync(req.file.path); } catch {}
    const prepared = await _prepareProductAsset(dst, `product_cutout_${Date.now()}_${uuidv4().slice(0, 8)}.png`).catch(err => {
      console.warn('[DH/product-upload] product cutout failed:', err.message);
      return null;
    });
    const base = _publicBaseUrl(req);
    const absUrl = `${base}/public/jimeng-assets/${filename}`;
    const absPrepared = prepared?.url
      ? (prepared.url.startsWith('http') ? prepared.url : `${base}${prepared.url.startsWith('/') ? '' : '/'}${prepared.url}`)
      : absUrl;
    const absCutout = prepared?.url
      ? (prepared.url.startsWith('http') ? prepared.url : `${base}${prepared.url.startsWith('/') ? '' : '/'}${prepared.url}`)
      : '';
    res.json({
      success: true,
      url: absUrl,
      preparedUrl: absPrepared,
      cutoutUrl: absCutout,
      name: req.file.originalname || filename,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/products/fuse-image', async (req, res) => {
  try {
    const { image_url, product = null } = req.body || {};
    if (!image_url) return res.status(400).json({ success: false, error: '缺少人物形象图' });
    if (!product?.image_url) return res.status(400).json({ success: false, error: '缺少商品图' });

    const imageUrl = await _generateProductIntegratedAvatarImage(req, { image_url }, product);
    if (!imageUrl) return res.status(500).json({ success: false, error: '商品数字人融合失败，请更换更清晰的人物图或商品图后重试' });
    res.json({ success: true, imageUrl, topview: req._lastProductFusion || null });
  } catch (err) {
    console.error('[DH/product-fuse] 接口失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});



// 视觉自检：判一张图是不是真的"全身（脚到画面）"。返回 true=全身 / false=非全身 / null=判不出
// 用 zhipu glm-4v（已在 detect-gender 里用过）；若失败 fallback null（不阻塞主流程）
async function _checkIsFullBodyImage(localPath) {
  try {
    const { loadSettings, getApiKey } = require('../services/settingsService');
    const settings = loadSettings();
    const zhipu = (settings.providers || []).find(p => (p.id === 'zhipu' || p.preset === 'zhipu') && p.enabled && p.api_key);
    if (!zhipu) return null;
    const b64 = fs.readFileSync(localPath).toString('base64');
    const ext = path.extname(localPath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const sys = 'You are a strict image composition checker. Reply ONLY with one token: YES or NO.';
    const user = [
      { type: 'text', text: 'Question: Does this photograph show a STANDING FULL BODY shot of one person, from head all the way to feet, with both feet/shoes clearly visible at the bottom of the frame? If the image is a headshot, half-body, waist-up, sitting pose, or the legs are cropped at the waist/hip/thigh/knee, answer NO. Reply with EXACTLY one word: YES or NO.' },
      { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
    ];
    const r = await axios.post(`${(zhipu.api_url || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '')}/chat/completions`, {
      model: 'glm-4v-flash',
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      temperature: 0,
      max_tokens: 5,
    }, {
      headers: { Authorization: 'Bearer ' + zhipu.api_key, 'Content-Type': 'application/json' },
      timeout: 25000,
    });
    const ans = String(r.data?.choices?.[0]?.message?.content || '').trim().toUpperCase();
    if (ans.startsWith('YES')) return true;
    if (ans.startsWith('NO')) return false;
    return null;
  } catch (err) {
    console.warn('[DH/images] full-body 视觉自检失败:', err.message);
    return null;
  }
}

// 把 URL 解析成 Buffer。若指向本机 /public/jimeng-assets/ → 直接读盘（避免回环 HTTP +
// 在 PUBLIC_BASE_URL 写错时 axios.get 跨网拿不到自己的图）
async function _fetchImageBuffer(url) {
  if (!url) throw new Error('image url empty');
  // 同源静态资源：尝试直接读盘
  const localMarker = '/public/jimeng-assets/';
  const idx = url.indexOf(localMarker);
  if (idx >= 0) {
    const name = path.basename(url.slice(idx + localMarker.length).split('?')[0]);
    const local = path.join(JIMENG_ASSETS_DIR, name);
    if (fs.existsSync(local)) return fs.readFileSync(local);
  }
  if (url.startsWith('/public/')) {
    const local = path.resolve(__dirname, '..', '..', url.replace(/^\//, ''));
    if (fs.existsSync(local)) return fs.readFileSync(local);
  }
  // 远端：axios 拉
  const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: 50 * 1024 * 1024 });
  return Buffer.from(r.data);
}

function _publicBaseUrl(req) {
  const fromEnv = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3007';
  return `${proto}://${host}`;
}

// ═══════════════════════════════════════════════
// 人物 + 背景（完整场景）Seedream 提示词模板
// 所有 style 的 prompt 必须包含明确的 detailed background，确保画面里有完整场景而不只是纯色肖像
// ═══════════════════════════════════════════════
const STYLE_PROMPTS = {
  // 自由模式：不预设风格 / 背景，完全靠用户描述 + framing 主导
  // 给"全身"等构图指令最大主导权
  free: {
    desc: '自由（按描述生成）',
    prompt: 'realistic photograph of one single person, natural lighting, photorealistic',
    negative: 'multiple people, triptych, character sheet, multi-view, duplicated face',
  },
  idol_warm: {
    desc: '偶像暖调',
    prompt: 'beautiful magazine-cover quality photograph of one single person standing in a cozy warmly-lit interior — bright wooden cafe with hanging edison bulbs, lush green plants, soft afternoon sunlight streaming through large windows behind, bokeh background with visible depth — flawless porcelain skin, golden ratio facial proportions, warm gentle smile, stylish casual outfit, DSLR 85mm f/2.0, cinematic shallow depth of field, waist-up composition, rich environmental detail',
    negative: 'plain backdrop, empty background, studio seamless, pure color background, multiple people, triptych, character sheet, triple view, duplicated face, multi-view',
  },
  idol_cool: {
    desc: '偶像冷调',
    prompt: 'editorial magazine photograph of one single person in a sleek urban nighttime rooftop setting — distant city skyline with warm building lights, glass railings, cool blue ambient lighting, visible background with modern architecture — sharp jawline, clean flawless skin, composed confident expression, designer outfit, DSLR 85mm f/2.0, cinematic cool toning, waist-up composition with clear background depth',
    negative: 'plain backdrop, empty background, studio seamless, pure color background, multiple people, triptych, character sheet',
  },
  documentary: {
    desc: '写实纪录',
    prompt: 'authentic documentary-style photograph of one single person in their natural workspace — lived-in home studio with books, plants, warm desk lamp, art on the walls visible behind, textured realistic environment — natural skin with pores and authentic texture, genuine warm expression, everyday clothing, DSLR 50mm f/2.8, natural window light, waist-up composition, rich believable background detail',
    negative: 'plain backdrop, empty background, studio seamless, pure color background, multiple people, painting, cartoon, character sheet, triptych, multi-view',
  },
  office: {
    desc: '办公室职场',
    prompt: 'professional corporate photograph of one single person standing in a modern open-plan office — glass meeting rooms, greenery, colleagues working in soft bokeh behind, laptop and monitors visible on a clean desk, warm natural daylight — smart casual business attire, confident slight smile, well-lit face, DSLR 85mm f/2.8, shallow depth of field, waist-up composition, clear office environment visible',
    negative: 'plain backdrop, empty background, studio seamless, pure color background, multiple people, triptych, character sheet',
  },
  beach: {
    desc: '海边清新',
    prompt: 'golden hour photograph of one single person on a sunlit beach — turquoise ocean waves, soft sand, palm trees at the edge of frame, sunset colored sky with warm clouds, distant sailboats — casual summer outfit, carefree gentle smile, sun-kissed skin, DSLR 85mm f/2.0, cinematic golden-hour rim lighting, waist-up composition with full beach scenery visible',
    negative: 'plain backdrop, empty background, studio seamless, pure color background, multiple people, triptych, character sheet',
  },
  studio_plain: {
    desc: '纯色影棚',
    prompt: 'clean professional studio portrait of one single person — seamless soft gradient backdrop (subtle warm gray to cream), professional three-point softbox lighting with gentle rim light, minimalist aesthetic with visible backdrop texture and light falloff — natural pleasant expression, smart simple outfit, DSLR 85mm f/4, sharp focus, waist-up composition, the studio backdrop clearly visible as part of the composition',
    negative: 'outdoor, street, nature, random room, cluttered background, multiple people, triptych, character sheet',
  },
  // —— 新增 6 风格 ——
  live_studio: {
    desc: '直播间',
    prompt: 'professional live-streaming studio photograph of one single person sitting in front of a ring light — visible background: softbox lighting, ring light reflection in eyes, studio curtain or neon backdrop, camera setup partially in frame, modern streamer desk with RGB accents — enthusiastic friendly expression, trendy hoodie or blazer, DSLR 50mm f/2.0, sharp focus on face, waist-up composition, clear streamer-studio vibe',
    negative: 'outdoor, random room, amateur setup, multiple people, triptych, character sheet',
  },
  business_formal: {
    desc: '商务正装',
    prompt: 'corporate executive photograph of one single person in tailored suit — visible background: glass high-rise conference room, cityscape through floor-to-ceiling windows, subtle corporate art, leather chair hint — sharp authoritative expression, neat hair, premium watch, DSLR 85mm f/2.8, sophisticated lighting, waist-up composition, executive polish',
    negative: 'casual clothing, outdoor nature, multiple people, triptych, character sheet',
  },
  tech_lab: {
    desc: '科技实验室',
    prompt: 'futuristic tech-lab photograph of one single person — visible background: glowing holographic displays, server rack with blue LEDs, clean minimalist lab, subtle blue-cyan accent lighting on metallic surfaces — intelligent focused expression, smart casual tech outfit, DSLR 50mm f/2.0, cinematic tech ambience, waist-up composition, rich sci-fi/tech environment',
    negative: 'outdoor nature, pastoral scene, multiple people, triptych, character sheet',
  },
  cafe_cozy: {
    desc: '咖啡馆漫谈',
    prompt: 'warm cafe-shop photograph of one single person sitting at a window table with a latte — visible background: brick wall with shelves, hanging plants, pastries in display, barista-busy ambience blurred, afternoon light streaming through big windows — relaxed chatty smile, soft sweater, DSLR 85mm f/1.8, cozy bokeh, waist-up composition, authentic cafe atmosphere',
    negative: 'studio, plain backdrop, multiple people, triptych, character sheet',
  },
  fitness_energy: {
    desc: '运动活力',
    prompt: 'sport-style photograph of one single person in a modern gym or outdoor park — visible background: running tracks or gym equipment, morning sunlight, green trees or urban fitness space — energetic confident smile, athletic sportswear, healthy glow, DSLR 85mm f/2.2, dynamic bright lighting, waist-up composition, vibrant fitness environment',
    negative: 'indoor office, formal attire, multiple people, triptych, character sheet',
  },
  anime_illus: {
    desc: '动漫插画',
    prompt: 'high-quality anime illustration of one single person — visible background: vibrant anime cityscape or dreamy landscape, cel-shaded style, bright saturated colors, clean linework, large expressive eyes, stylized hair — cheerful expression, trendy anime-character outfit, waist-up composition, Studio Ghibli meets Makoto Shinkai aesthetic',
    negative: 'photorealistic, photograph, realistic skin, multiple people, triptych, character sheet',
  },
};

// 紧凑版真实感引导（避免 prompt 撞 2000 字符 cap，把构图/bg 指令挤掉）
const REALISTIC_PHOTO_GUIDE = [
  'photorealistic, shot on real digital camera, visible skin pores and micro imperfections, natural facial asymmetry',
  'soft realistic lighting with neck shadows, subsurface scattering on cheeks, real fabric texture with folds',
  'anatomically correct hands, real candid photo not painting/3D/anime',
].join(', ');

const REALISTIC_NEGATIVE = [
  // 强化对"塑料感/AI 感/瓷娃娃"的拒绝
  'cgi, 3d render, plastic skin, wax figure, doll face, porcelain skin, over-smoothed face, over-beautified influencer face, AI-generated look, uncanny valley',
  'perfect symmetric face, airbrushed skin, fantasy lighting, neon studio glamour, anime, cartoon, illustration, anime style face, big sparkly anime eyes, glossy plastic-doll hair',
  'overly saturated colors, oversaturated makeup, instagram filter, snapchat filter, beauty cam filter, smoothing filter',
  'fake hands, deformed fingers, extra fingers, broken wrist, floating object, pasted product, product sticker, product card',
].join(', ');

function _realisticBasePrompt(prompt) {
  return String(prompt || '')
    .replace(/beautiful magazine-cover quality photograph/gi, 'realistic phone-camera portrait')
    .replace(/editorial magazine photograph/gi, 'realistic candid portrait')
    .replace(/flawless porcelain skin/gi, 'natural skin texture with pores and slight imperfections')
    .replace(/clean flawless skin/gi, 'natural skin texture')
    .replace(/golden ratio facial proportions/gi, 'ordinary natural facial proportions')
    .replace(/DSLR 85mm f\/2\.0/gi, 'phone camera, realistic lens perspective')
    .replace(/DSLR 85mm f\/2\.8/gi, 'phone camera, realistic lens perspective')
    .replace(/DSLR 50mm f\/2\.0/gi, 'phone camera, realistic lens perspective')
    .replace(/cinematic shallow depth of field/gi, 'natural depth of field')
    .replace(/magazine cover quality/gi, 'real-life social media frame');
}

// 动作 → 英文动作描述（与 public/js/digital-human.js ACTION_PRESETS 同步）
// lip-sync 模型（Hifly / 即梦 Omni）不接受动作 prompt，所以把动作 baked 进形象图里
const ACTION_PROMPTS = {
  natural:      'natural speaking, subtle head movements, look at camera',
  greet:        'waving hello, friendly greeting gesture',
  nod:          'nodding in agreement, confident expression',
  shake_head:   'gently shaking head, reflective expression',
  lean_in:      'leaning slightly forward to emphasize the point',
  wave_bye:     'waving goodbye warmly, friendly closing gesture',
  open_palms:   'both hands open palms up explaining, welcoming posture',
  raise_hand:   'raising one hand to explain clearly',
  count_finger: 'counting on fingers, explaining points one by one',
  compare:      'comparing two ideas with left and right hand gestures',
  point_down:   'pointing downward with index finger, looking at camera',
  point_up:     'pointing upward with index finger, directing attention',
  point_side:   'pointing to the side, guiding viewer attention naturally',
  number1:      'holding up one finger, counting gesture',
  push_forward: 'pushing both hands forward, stopping or emphasizing a boundary',
  excited:      'excited gesture, eyes wide, energetic smile',
  thoughtful:   'thinking expression, hand near chin, eyes thoughtful',
  look_down:    'looking down briefly, thoughtful pause before speaking',
  surprised:    'exaggerated surprised reaction, wide eyes, jaw drop',
  celebrate:    'raising both fists in celebration, joyful expression',
  whisper:      'leaning close as if sharing a secret, hushed conspiratorial tone',
  serious_look: 'serious direct eye contact, authoritative upright posture',
  heart:        'making a heart sign with both hands, warm smile',
  like:         'giving a thumbs up, encouraging smile',
  peace:        'making peace/victory sign with two fingers, playful smile',
  ok_sign:      'making OK sign with hand, approval gesture',
  high_five:    'offering a high-five gesture toward the viewer',
  hug:          'spreading arms wide in welcoming hug gesture',
  invite:       'inviting gesture towards the viewer, friendly smile',
  clap:         'clapping hands enthusiastically, celebrating achievement',
  hold_item:    'holding up a product to camera, presenting with pride',
  bow:          'respectful bow, grateful sincere expression',
  arms_cross:   'arms crossed, authoritative confident posture',
  look_around:  'looking around with curiosity, as if discovering something new',
  think_deep:   'deep in thought, rubbing chin slowly, eyes looking sideways',
};

// LRU-ish cache：相同 description 不重复跑 LLM 翻译
const _DESC_TRANS_CACHE = new Map();
const _DESC_TRANS_CACHE_MAX = 200;

// 把用户的中文描述翻译/改写为图像生成模型友好的英文属性 prompt
// 关键：保留所有具体属性（颜色/服饰/道具/场景元素）；用逗号分隔短语；前置主体特征
//   hasBgRef=true：用户已上传自定义背景图，描述里的背景部分会与之冲突 → LLM 强制剥掉背景描述
async function _translateDescToEnAttrPrompt(description, { style, gender, hasBgRef = false } = {}) {
  if (!description || !description.trim()) return '';
  // 已经是英文（80% 以上是 ASCII）就不必翻译
  const ascii = (description.match(/[\x00-\x7F]/g) || []).length;
  if (ascii / description.length > 0.8) return description.trim();

  const key = `${style || ''}|${gender || ''}|${hasBgRef ? 'bg' : 'nobg'}|${description.trim().slice(0, 500)}`;
  if (_DESC_TRANS_CACHE.has(key)) return _DESC_TRANS_CACHE.get(key);

  try {
    const { callLLM } = require('../services/storyService');
    const bgStripRule = hasBgRef
      ? '\n\n4. BACKGROUND / SCENE / ENVIRONMENT: STRIP ALL background descriptions (e.g. "校园绿荫小道", "周围低矮的树木", "图书馆书架", "阳光透过窗户", "cafe with hanging plants", "office with glass walls"). The user has uploaded a separate background image — including background details here would conflict with it. Only output PERSON-related attributes (face / skin / hair / clothing / accessories / mood / lighting on the person). DROP all environment, scenery, props, and surrounding objects.'
      : '';
    const sys = `You convert a Chinese character/scene description into a tightly structured ENGLISH prompt for image generation models (Flux, Seedream, nano-banana). Rules:
- Preserve EVERY specific *appearance* attribute from the input: hair color/length/texture, clothing color and material, accessories (necklace/earrings/glasses/watch), props, background elements (holographic displays / LED strips / specific furniture), lighting color, mood.
- Use comma-separated short phrases (image-gen style), not full sentences.
- Front-load identity-defining attributes: hair color first, then face/skin, then clothing colors, then accessories, then background, then lighting.
- Translate Chinese color words EXACTLY: 深蓝→deep navy blue, 银白→silver white, 浅金→soft gold, 冷色调→cool tone, 暖色调→warm tone, 蓝色LED灯带→glowing blue LED light strips.
- Keep numerical / measurement details: 1米7→1.7m tall, 25岁→around 25 years old.

CRITICAL — STRIP THESE from the output even if they appear in input:
1. POSE / GESTURE / hand position / body language: e.g. "一只手轻托起脸颊", "微微倾斜", "手放在桌上", "靠近镜头", "侧身", "抱胸". Pose is controlled separately by user chip selection.
2. COMPOSITION / FRAMING / CAMERA / LENS / depth-of-field: e.g. "中长焦镜头", "浅景深", "聚焦于面庞", "特写", "半身", "全身", "DSLR 85mm", "shallow depth of field", "focus on face", "headshot", "waist-up", "full body". Framing is controlled separately by user chip selection.
3. EXPRESSION specifics tied to motion: keep simple "smiling/calm/serious" but strip "微微上扬的嘴角", "轻轻歪头" etc that imply specific motion.${bgStripRule}

Do NOT mention any framing/composition/lens/pose words in the English output. The downstream system adds those.

- Length: 80-180 English tokens.
- Output ONLY the prompt string. No quotes, no preamble, no markdown, no explanation.`;
    const user = `Style: ${style || 'unspecified'}\nGender: ${gender || 'unspecified'}\n\nChinese description:\n${description.trim()}`;
    const raw = await callLLM(sys, user, {});
    let en = String(raw || '').trim()
      .replace(/^["'『「《]+|["'』」》]+$/g, '')
      .replace(/^(prompt|english|en|output)[:：]\s*/i, '')
      .replace(/\n+/g, ' ')
      .slice(0, 1200);
    // 后处理：强制剥掉姿势/构图/镜头泄漏（LLM 即使被命令也会偷偷塞）
    const POSE_COMP_PATTERNS = [
      /\b(slight |gently |softly )?(tilt(ed|ing)? of the |tilt(ed|ing)? )?head\b[^,.|]*/gi,
      /\b(one |both |left |right )?hand[s]? (gently |softly |lightly )?(cradling|holding|touching|resting on|placed on|on|near|by) (her |his |the )?(cheek|chin|face|jaw|hair|head|shoulder|hip|waist)[^,.|]*/gi,
      /\b(focus(ed|ing)? on (the )?face|focused on her face|center of focus on the face)\b[^,.|]*/gi,
      /\b(shallow|narrow|deep) depth[ -]of[ -]field[^,.|]*/gi,
      /\b(close[ -]up|extreme close[ -]up|headshot|head shot|waist[ -]up|half[ -]body|full[ -]body) (shot|composition|portrait|framing)\b[^,.|]*/gi,
      /\b(medium|long|short|tele|wide)[ -](focal|telephoto|focus|focal length) (lens|shot)\b[^,.|]*/gi,
      /\bDSLR[^,.|]*/gi,
      /\b\d+mm\s*(f\/[\d.]+)?\b/gi,
      /,\s*(?=,)/g,  // 清理留下的连续逗号
      /,\s*$/g,
    ];
    for (const re of POSE_COMP_PATTERNS) en = en.replace(re, '');
    en = en.replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').replace(/^[,\s|]+|[,\s|]+$/g, '').trim();
    _DESC_TRANS_CACHE.set(key, en);
    if (_DESC_TRANS_CACHE.size > _DESC_TRANS_CACHE_MAX) {
      _DESC_TRANS_CACHE.delete(_DESC_TRANS_CACHE.keys().next().value);
    }
    console.log(`[DH/images] 中文描述 → 英文属性 prompt (${en.length} 字符)`);
    return en;
  } catch (e) {
    console.warn('[DH/images] 描述翻译失败，回退原中文:', e.message);
    return description.trim();
  }
}

// 构图 → 强力英文指令（前置 + 后置叠加，确保模型不输出脸部特写）
const FRAMING_PROMPTS = {
  headshot:  { en: 'TIGHT HEADSHOT, head and shoulders only, formal portrait framing', neg: 'full body, legs visible' },
  half_body: { en: 'HALF BODY SHOT, upper body and waist clearly visible, hands visible in frame, both arms visible, waist-up composition', neg: 'face close-up, headshot only, cropped at neck, only face visible, extreme close-up' },
  full_body: {
    en: 'FULL BODY SHOT, COMPLETE FIGURE from HEAD to FEET, the ENTIRE PERSON visible in frame including head, torso, legs and shoes, tall vertical full-length photograph with subject occupying full vertical frame from top to bottom',
    neg: 'face close-up, headshot, head and shoulders only, portrait crop, cropped at waist, cropped at hip, cropped at thigh, cropped at knee, cropped at chest, only upper body, partial body, half body shot, bust shot, only torso visible',
  },
  close_up:  { en: 'extreme close-up portrait of face, beauty shot framing', neg: 'full body, half body, legs visible' },
};

// 风格感知的 negative：tech_lab/anime_illus 不该 ban 掉自身核心元素
function _buildNegativeForStyle(style, styleNegative) {
  let neg = REALISTIC_NEGATIVE;
  if (style === 'tech_lab') {
    // 科技实验室本来就靠"未来感蓝光/全息霓虹"立住，禁掉这些等于自相矛盾
    neg = neg
      .replace(/,\s*fantasy lighting/g, '')
      .replace(/,\s*neon studio glamour/g, '')
      .replace(/,\s*airbrushed skin/g, '');
  }
  if (style === 'anime_illus') {
    // 动漫插画风本来就是动漫，不能 ban anime/cartoon/illustration
    neg = neg
      .replace(/,\s*anime/g, '')
      .replace(/,\s*cartoon/g, '')
      .replace(/,\s*illustration/g, '');
  }
  return `${styleNegative}, ${neg}`;
}

// userEnPrompt 是已经处理好的英文属性 prompt（由调用方提前 await _translateDescToEnAttrPrompt 得到）
// 关键改动：
//   - 用户描述前置（主导）
//   - framing 在 prompt 头/中/尾三处重复，避免被 2000 字符 cap 截断
//   - hasBgRef=true 时把 style 自带的"cozy cafe / glass conference room / lab"等背景关键词剥掉，让用户上传的 bg 主导场景
// 两阶段管线 Stage1 专用 prompt 构造器
//   目标：在纯灰背景上生成指定 framing 的人物，便于 stage2 抠像
//   设计原则：
//     - 关键 framing 约束 PUT FIRST（避免 prompt 超 2000 字符 cap 时被尾部截断）
//     - userClause cap 到 400 字符（用户描述常 800+，用了之后会顶掉关键约束）
//     - 总长度 cap 到 1400 字符，给余量
//     - aspectRatio 自适应（16:9 横屏全身物理冲突 → 改"环境 establishing 镜头"）
function _buildStage1Prompt({ gender, userEnPrompt, framing, aspectRatio = '9:16' }) {
  const g = gender === 'male' ? 'a young man' : gender === 'female' ? 'a young woman' : 'a real person';
  // userClause cap 到 400 字符，避免顶掉关键约束
  const userClauseRaw = (userEnPrompt && userEnPrompt.trim()) ? userEnPrompt.trim() : '';
  const userClause = userClauseRaw.length > 400 ? userClauseRaw.slice(0, 400) + '…' : userClauseRaw;
  const isVertical = aspectRatio === '9:16' || aspectRatio === '3:4';

  if (framing === 'full_body') {
    // 关键 framing 约束在最前——任何截断都不会丢
    if (isVertical) {
      return [
        // 关键指令前置（被截不丢）
        'FULL BODY STANDING SHOT. The image MUST show the entire person from head to feet. Feet and shoes visible at the very bottom of the frame. Both legs straight and clearly visible.',
        'NO half body. NO waist-up. NO portrait crop. NO sitting.',
        `Subject: ${g}, standing upright on a plain grey studio backdrop.`,
        // 给"下半身要画的内容"
        'Lower body (REQUIRED — render even if not specified): casual full-length pants or knee-length skirt, simple shoes/sneakers, both feet visible on the floor.',
        'Pose: standing upright, weight balanced, arms relaxed by the sides, gentle natural smile, looking at camera.',
        userClause ? `Appearance: ${userClause}` : '',
        'Setting: PLAIN SOLID NEUTRAL GREY (#888888) seamless backdrop, empty, no furniture, no props.',
        'Photography: 35mm wide-angle, low camera angle from waist height to fit head-to-feet vertically, fashion editorial quality, photorealistic skin.',
        'ABSOLUTELY ONE SINGLE PERSON.',
      ].filter(Boolean).join(' ');
    } else {
      // 16:9 / 1:1 横屏：物理上塞不下站立全身。改"WIDE ESTABLISHING SHOT"风格
      // 人物占画面中心垂直条带，左右留环境
      return [
        'WIDE CINEMATIC ESTABLISHING SHOT. Camera pulled back to fit the entire standing figure from head to feet within the wide frame.',
        'Person stands centered in the frame. Head visible. Feet and shoes visible at the bottom. Both legs straight.',
        'NO half body. NO waist-up. NO closeup.',
        `Subject: ${g}, standing upright on a plain grey studio backdrop.`,
        'Lower body (REQUIRED): full-length pants or knee-length skirt, simple shoes, both feet visible.',
        'Pose: standing upright, weight balanced, arms relaxed by the sides.',
        userClause ? `Appearance: ${userClause}` : '',
        'Setting: PLAIN SOLID NEUTRAL GREY (#888888) seamless backdrop, empty, no furniture.',
        'Photography: 28mm wide-angle establishing lens, eye-level, fashion editorial quality, photorealistic.',
        'ABSOLUTELY ONE SINGLE PERSON, centered in frame.',
      ].filter(Boolean).join(' ');
    }
  }

  if (framing === 'headshot' || framing === 'close_up') {
    return [
      framing === 'close_up' ? 'EDITORIAL BEAUTY CLOSE-UP. Tight crop on face and eyes.' : 'PROFESSIONAL HEADSHOT. Head and shoulders only.',
      `Subject: ${g}.`,
      userClause ? `Appearance: ${userClause}` : '',
      'Pose: looking at camera, gentle natural expression.',
      'Setting: PLAIN SOLID NEUTRAL GREY (#888888) seamless backdrop, empty.',
      'Photography: 85mm f/2.8 portrait lens, soft beauty dish key, fashion editorial quality.',
      'NO full body. NO legs visible.',
      'ABSOLUTELY ONE SINGLE PERSON.',
    ].filter(Boolean).join(' ');
  }

  // 半身 (默认)
  return [
    'PROFESSIONAL HALF-BODY PHOTO. Waist-up — head, torso and hands visible.',
    `Subject: ${g}.`,
    userClause ? `Appearance: ${userClause}` : '',
    'Pose: standing front-facing, arms relaxed, hands visible.',
    'Setting: PLAIN SOLID NEUTRAL GREY (#888888) seamless backdrop, empty.',
    'Photography: 50mm f/4, fashion editorial quality.',
    'NO closeup. NO sitting. NO furniture.',
    'ABSOLUTELY ONE SINGLE PERSON.',
  ].filter(Boolean).join(' ');
}

function _buildPrompt({ style, gender, description, action, userEnPrompt, framing, hasBgRef = false }) {
  const s = STYLE_PROMPTS[style] || STYLE_PROMPTS.free;
  const g = gender === 'male' ? 'ordinary real young man' : gender === 'female' ? 'ordinary real young woman' : 'real person';
  const userClause = (userEnPrompt && userEnPrompt.trim())
    ? userEnPrompt.trim()
    : (description ? description.trim() : '');

  // 剥掉 style 模板里旧的构图硬编码（让 framing chip 说了算）
  let basePrompt = _realisticBasePrompt(s.prompt)
    .replace(/,?\s*waist-up composition[^,]*/gi, '')
    .replace(/,?\s*waist-up shot[^,]*/gi, '')
    .replace(/,?\s*head and shoulders[^,]*/gi, '');

  // 自定义背景：style 模板里很多场景描述（"cozy warmly-lit interior — bright wooden cafe with hanging edison bulbs, lush green plants..."）
  // 会跟用户上传的 bg 冲突。直接简化 basePrompt，只保留人物质感关键词
  if (hasBgRef) {
    basePrompt = `realistic photo of one single ${g}, photographed naturally in front of the provided reference background scene`;
  }

  // ⚠️ full_body 时：style 模板里的"standing in a cozy interior"等长描述会让 nano-banana
  // 倾向 portrait crop。完全替换 basePrompt 用极简 full-body 骨架，让构图 chip 说了算
  if (framing === 'full_body') {
    basePrompt = `vertical full-length photograph showing one single ${g} from head to feet — entire body visible including face, hair, torso, arms, hands, legs and shoes`;
  }

  const actionEn = action && ACTION_PROMPTS[action] ? ACTION_PROMPTS[action] : '';
  const actionClause = actionEn ? `Pose: ${actionEn}, anatomically correct hands. ` : '';
  const fr = FRAMING_PROMPTS[framing] || FRAMING_PROMPTS.half_body;

  // framing 在 prompt 多处重复（头/中/尾），任何位置被截断都还能命中
  const framingHead = `${fr.en}. `;
  const framingMid = framing === 'full_body'
    ? 'CRITICAL: This is a FULL-LENGTH photo. The subject MUST be visible from head all the way to feet. Show the legs and shoes. Do NOT crop at the waist or hip. '
    : '';
  const framingTail = `, ${fr.en}`;

  const headClause = userClause ? `${userClause}. ` : '';
  return {
    prompt: `${framingHead}${headClause}${framingMid}${basePrompt.replace(/one single person/g, `one single ${g}`)}. ${actionClause}${REALISTIC_PHOTO_GUIDE}${framingTail}, ABSOLUTELY ONE SINGLE PERSON, no duplicates`,
    negative: `${_buildNegativeForStyle(style, s.negative)}, ${fr.neg}`,
  };
}

function _buildProductAvatarPrompt({ gender, description, product }) {
  const g = gender === 'male'
    ? 'ordinary real young male product presenter'
    : gender === 'female'
      ? 'ordinary real young female product presenter'
      : 'ordinary real product presenter';
  const productName = product?.name || 'the exact uploaded reference product';
  const userDesc = description
    ? `Use only realistic, non-fantasy details from this user note: ${description}. Ignore fantasy, cosplay, anime, sci-fi, blue hair, neon lab, idol glamour, heavy beauty makeup, porcelain skin, magazine retouching, and any cue that changes the product category.`
    : '';
  return {
    prompt: [
      `Ultra-realistic phone-camera product introduction photo of one single ${g}, waist-up, looking directly at the camera while introducing a product.`,
      'This is a product introduction shot, not a product usage shot.',
      'The presenter is showing the product to the audience, not playing with it, not typing, not gaming, not scrolling, not making a call, and not looking down at the screen.',
      'The exact uploaded reference product is held at chest or shoulder level, front side facing the camera, clearly visible, correctly scaled, and physically integrated with natural fingers and contact shadows.',
      'If the uploaded product is a smartphone: keep it as a smartphone, vertical portrait orientation, screen facing camera, visible phone frame and camera module, one hand holding the side or bottom, the other hand lightly supporting or pointing at it.',
      `Product identity: ${productName}. Preserve the uploaded product category, shape, color, screen content, logo area, proportions and visual identity exactly.`,
      `${REALISTIC_PHOTO_GUIDE}. Real livestream room or simple indoor product-review setting, natural outfit, authentic phone snapshot, no studio idol poster look.`,
      userDesc,
      'No product replacement, no skincare bottle, no perfume, no cosmetic bottle, no product card, no floating sticker, no horizontal gaming grip, no looking at the phone, no duplicated person.',
      'ABSOLUTELY ONE SINGLE PERSON, natural hands, natural grip tension, realistic skin texture.',
    ].filter(Boolean).join(' '),
    negative: `${REALISTIC_NEGATIVE}, playing phone, gaming, typing, tapping screen, scrolling, phone call, horizontal phone, looking down, using product, bottle, skincare, cosmetics, perfume, product card, floating sticker, blue hair, sci-fi lab, idol glamour`,
  };
}

const SPACE_GUIDE_SCENES = {
  auto: {
    name: 'prompt driven space',
    scene: 'infer the exact commercial/interior space from the uploaded background, title and copy; do not force a preset scene',
  },
  gallery_wall: {
    name: 'gallery art wall',
    scene: 'premium interior gallery with a large textured art wall, warm ceiling spotlights, dark floor, quiet luxury mood',
  },
  showroom: {
    name: 'brand showroom',
    scene: 'modern brand showroom with a large display wall on the right, premium materials, warm commercial lighting',
  },
  retail_store: {
    name: 'retail store guide',
    scene: 'high-end retail store interior with a feature wall and product display area on the right, realistic shopping environment',
  },
  model_room: {
    name: 'model room tour',
    scene: 'real estate model room or home showroom with a feature wall on the right, warm interior lighting, elegant spatial depth',
  },
  museum_gallery: {
    name: 'museum gallery',
    scene: 'museum or cultural exhibition gallery with curated displays, controlled lighting, refined visitor route and clear exhibit focus',
  },
  exhibition_booth: {
    name: 'exhibition booth',
    scene: 'trade show exhibition booth with brand wall, booth lighting, product display island and professional visitor flow',
  },
  hotel_lobby: {
    name: 'hotel lobby',
    scene: 'premium hotel lobby or hospitality reception space with warm ambient lighting, textured materials and elegant spatial depth',
  },
  office_showroom: {
    name: 'corporate showroom',
    scene: 'corporate exhibition hall or office showroom with brand display wall, technology panels and polished business atmosphere',
  },
  real_estate: {
    name: 'real estate space',
    scene: 'real estate sales center, model apartment or property interior tour with clear room features and premium residential styling',
  },
  auto_showroom: {
    name: 'automotive showroom',
    scene: 'automotive showroom with vehicle display area, glossy floor, lighting reflections and premium brand atmosphere',
  },
  custom: {
    name: 'custom scene',
    scene: 'custom user-described space; follow the uploaded background and user prompt as the primary source of truth',
  },
};

function _spaceCameraPrompt(camera = 'push_in', cameraPrompt = '') {
  const presets = {
    auto: 'AI-directed single-take commercial camera movement chosen from the uploaded background and narration: start with a clear establishing composition, then use subtle push-in, pan, focus shift, or detail emphasis only when it supports the ad message; no cuts',
    push_in: 'very slow smooth camera push-in, no cuts',
    static: 'stable locked-off camera, no cuts',
    handheld: 'very subtle handheld camera movement, smooth and realistic',
    pan_right: 'slow pan from presenter on the left toward the display area on the right',
    walkthrough: 'gentle walkthrough feel, as if the viewer is being guided through the space',
    orbit: 'subtle parallax/orbit around the presenter while keeping the display wall visible',
    wide_to_detail: 'begin with a wide spatial overview, then gently emphasize material and display details',
    rack_focus: 'subtle rack focus between presenter and the important wall/display details',
    custom: '',
  };
  return [presets[camera] || presets.auto, cameraPrompt].filter(Boolean).join('; ');
}

function _buildSpaceGuideKeyframePrompt({ scene = 'auto', title = '', text = '', scenePrompt = '', camera = 'push_in', cameraPrompt = '' }) {
  const s = SPACE_GUIDE_SCENES[scene] || SPACE_GUIDE_SCENES.auto;
  const contentContext = [title, scenePrompt, String(text || '').slice(0, 260)].filter(Boolean).join(' | ');
  return [
    'Create a brand-new photorealistic 16:9 video keyframe from the two references.',
    'Reference 1 is the presenter identity and outfit. Preserve the presenter face identity, hairstyle, clothing style and natural body proportions.',
    'Reference 2 is the real space/background. Preserve the room layout, wall texture, lighting direction, materials and perspective.',
    `Scene logic: ${s.scene}.`,
    contentContext ? `User content context: ${contentContext}. Use this context to decide the correct commercial scene details, not a fixed preset.` : '',
    'Composition: one presenter stands on the LEFT THIRD of the frame, full upper body visible from head to at least mid-thigh, facing camera.',
    'The RIGHT TWO THIRDS must remain open and clearly show the wall/display area. Do not cover the wall with the presenter.',
    'Pose: presenter naturally explains the space, one open palm gestures toward the wall/display on the right, other arm relaxed.',
    `Camera intent: wide cinematic establishing shot, 28mm realistic lens, eye-level, subtle interior depth. Later video motion should feel like: ${_spaceCameraPrompt(camera, cameraPrompt)}.`,
    'Lighting: the presenter must match the warm interior spotlights, with believable shadows and color temperature.',
    'Style: real estate/showroom docent video still, authentic phone/camera footage, no beauty poster look, no sticker, no floating product, no duplicated person.',
    'Strict negatives: close-up, selfie, centered presenter blocking the wall, half face crop, extra people, deformed hands, floating body, pasted cutout, cartoon, CGI, text overlay, subtitle.',
  ].filter(Boolean).join(' ');
}

function _fallbackGuideSegments(text, totalDur = 10) {
  const chunks = _splitSubtitleText(String(text || '').trim(), 16);
  if (!chunks.length) return [];
  const dur = Math.max(6, Math.min(30, totalDur || Math.ceil(String(text).length / 4)));
  const each = dur / chunks.length;
  return chunks.map((t, i) => ({
    text: t,
    start: i * each,
    end: i === chunks.length - 1 ? dur : (i + 1) * each,
  }));
}

// ═══════════════════════════════════════════════
// Step 1 辅助 · POST /api/dh/describe/enhance
//   根据 style + gender + 用户零散关键词 → LLM 补全成完整中文描述
// ═══════════════════════════════════════════════
router.post('/describe/enhance', async (req, res) => {
  try {
    const { style = 'idol_warm', gender = 'female', keywords = '' } = req.body || {};
    const styleMeta = STYLE_PROMPTS[style] || STYLE_PROMPTS.idol_warm;
    const { callLLM } = require('../services/storyService');

    const sys = `你是专业的数字人形象照美术指导（参考飞影/硅基/腾讯智影的高标准）。任务：为"${styleMeta.desc}"风格的数字人形象生成详尽的中文视觉描述，让画师/AI 看完能还原出完整画面。

输出结构覆盖以下 5 个维度，每项至少 1 句具体描述：
1. 人物形象：身高气质、面部特征（脸型/五官/肤色/眼神）、发型（长度/颜色/质感）
2. 服装搭配：上衣风格/颜色/面料、下装或搭配、配饰（项链/耳环/眼镜/手表）
3. 妆容：妆感（日系/欧美/干净/复古）、表情整体氛围（如"温暖治愈"/"专业自信"）
4. 背景环境：具体场景（家具/物品/陈设要可以点名）、空间感、道具细节
5. 光线氛围：主光源方向、色温（冷暖）、光影层次、氛围关键词（治愈/高级/清晨/黄昏）

⚠️ 严禁出现以下内容（这些由用户在前端用 chip 单独选择，描述里出现会跟 chip 选择冲突）：
- 任何"姿势/手部动作/头部角度/身体朝向"（如"一只手托脸""微微倾斜""叉腰""手放桌上"）
- 任何"构图/镜头/景深/焦距/特写/半身/全身"（如"中长焦镜头""浅景深""聚焦面庞""半身像"）

全文用中文，以顿号/句号自然衔接，目标 150-220 字。不要编号，不要分点，不要加引号/标题/前缀后缀。只输出正文。`;

    const user = `风格：${styleMeta.desc}
英文参考（给你看不用翻译）：${styleMeta.prompt.slice(0, 200)}
性别：${gender === 'male' ? '男性' : gender === 'female' ? '女性' : '不限'}
用户关键词（必须融入、不能漏）：${keywords || '(留空，你自由发挥)'}

请基于以上写一段 180-260 字的详细可视化描述，覆盖 6 个维度。`;

    const text = (await callLLM(sys, user, {
      kb: { scene: 'digital_human_portrait', query: `${styleMeta.desc} ${keywords}`.slice(0, 120), limit: 3, collection: 'digital_human' },
    })).trim().replace(/^["'『「]+|["'』」]+$/g, '').replace(/\n+/g, '');

    res.json({ success: true, description: text, char_count: text.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// Step 1 · POST /api/dh/images/generate
//   body: { style, gender, description, aspectRatio? }
//   return: { imageUrl, filename }
// ═══════════════════════════════════════════════
// 通过 deyunai 漫路聚合调 nano-banana（OpenAI 兼容图像生成接口）
function _extractGeneratedImageUrl(payload) {
  const seen = new Set();
  const preferredKeys = new Set([
    'url', 'image_url', 'imageUrl', 'image', 'result_url', 'resultUrl',
    'output_url', 'outputUrl', 'b64_json', 'base64', 'content',
  ]);
  function walk(value) {
    if (!value) return '';
    if (typeof value === 'object') {
      if (seen.has(value)) return '';
      seen.add(value);
    }
    if (typeof value === 'string') {
      const v = value.trim();
      if (/^data:image\//i.test(v)) return v;
      if (/^https?:\/\//i.test(v)) return v;
      if (/^[A-Za-z0-9+/=]{800,}$/.test(v)) return v;
      return '';
    }
    if (typeof value !== 'object') return '';
    if (Array.isArray(value)) {
      for (const item of value) {
        const hit = walk(item);
        if (hit) return hit;
      }
      return '';
    }
    for (const key of Object.keys(value)) {
      if (preferredKeys.has(key)) {
        const hit = walk(value[key]);
        if (hit) return hit;
      }
    }
    for (const key of Object.keys(value)) {
      const hit = walk(value[key]);
      if (hit) return hit;
    }
    return '';
  }
  return walk(payload);
}

function _extractAsyncTaskId(payload) {
  return payload?.data?.task_id
    || payload?.data?.id
    || payload?.task_id
    || payload?.id
    || payload?.taskId
    || payload?.data?.taskId
    || '';
}

function _extractTaskStatus(payload) {
  return String(
    payload?.data?.task_status
    || payload?.data?.status
    || payload?.task_status
    || payload?.status
    || ''
  ).toLowerCase();
}

async function _generateViaDeyunaiNanoBanana({ prompt, aspectRatio, filename, destDir, referenceImages = [] }) {
  const { loadSettings } = require('../services/settingsService');
  const settings = loadSettings();
  const dy = (settings.providers || []).find(p => (p.id === 'deyunai' || p.preset === 'deyunai') && p.enabled && p.api_key);
  if (!dy) throw new Error('未配置 deyunai 漫路 provider');
  // 严格按 candidates 顺序优先（之前用 dy.models.find 是按 settings 数组顺序，pro 排在 base 后面会被跳过）
  const candidates = ['nano-banana-pro', 'nano-banana'];
  const modelMap = new Map((dy.models || []).map(m => [m.id, m]));
  let enabledModel = null;
  for (const id of candidates) {
    const m = modelMap.get(id);
    if (m && m.enabled !== false) { enabledModel = id; break; }
  }
  if (!enabledModel) throw new Error('deyunai 没启用 nano-banana / nano-banana-pro 模型');
  // ⚠️ deyunai nano-banana 硬限制：文档说 ≤ 2500 字符，但实测：
  //   - prompt.length == 2500 → HTTP 400 + `module not exists:v1`（边界 bug）
  //   - 长 prompt（2000+）含特殊字符/被截断的 UTF-8 半字符 → 也可能 400 + `module not exists:v1`
  // 安全做法：① cap 降到 2000；② 截断时按 unicode codepoint，避免破坏多字节字符；
  //          ③ 失败时把 prompt 头/尾片段打印到日志，方便定位脏字符。
  if (typeof prompt === 'string' && prompt.length > 2000) {
    const original = prompt.length;
    // 用 Array.from 按 codepoint 切，避免破坏 surrogate pair
    const chars = Array.from(prompt);
    if (chars.length > 2000) prompt = chars.slice(0, 2000).join('');
    console.warn(`[DH/images] prompt ${original} 字符 → 截断到 ${prompt.length}（cap=2000，防 deyunai 边界 bug）`);
  }
  // 移除控制字符（非打印 ASCII / 零宽字符），保留 \n \t
  if (typeof prompt === 'string') {
    prompt = prompt.replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\uFEFF]/g, '');
  }

  // 比例 → 尺寸映射
  const sizeMap = { '9:16': '720x1280', '16:9': '1280x720', '1:1': '1024x1024', '3:4': '768x1024', '4:3': '1024x768' };
  const size = sizeMap[aspectRatio] || '1024x1024';

  const axios = require('axios');
  // 经线上对照测试：nano-banana / nano-banana-pro 走 /v1 国内通道（200 SUCCEED）；
  // /c35/v1 海外通道反而报 `method not exists`。所以 baseUrl 固定 /v1。
  const baseUrl = (dy.api_url || 'https://api.deyunai.com/v1').replace(/\/$/, '');
  const headers = { Authorization: 'Bearer ' + dy.api_key, 'Content-Type': 'application/json' };

  const body = {
    model: enabledModel,
    prompt,
    n: 1,
    size,
  };
  const refs = (referenceImages || []).filter(Boolean).slice(0, 4);
  if (refs.length) {
    body.image_url = refs[0];
    if (refs.length > 1) body.image_urls = refs;
  }
  console.log(`[DH/images] 调 deyunai ${enabledModel} (refs=${refs.length}, prompt=${prompt.length}c)`);
  // 重试机制：deyunai 偶发 400 + `module not exists:v1` / 其它代理层错误，重试 2 次（间隔 2s/4s）
  let r;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      r = await axios.post(`${baseUrl}/images/generations`, body, { headers, timeout: 120000 });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const msg = err.response?.data?.message || err.message;
      console.warn(`[DH/images] 提交失败 attempt=${attempt+1}/3 status=${status} msg=${String(msg).slice(0, 120)}`);
      // 失败时把 prompt 头/尾片段打到日志，方便定位脏字符 / 编码问题
      if (attempt === 0) {
        const head = prompt.slice(0, 80).replace(/[\r\n]+/g, ' ');
        const tail = prompt.slice(-80).replace(/[\r\n]+/g, ' ');
        console.warn(`[DH/images] prompt[len=${prompt.length}] head="${head}" tail="${tail}" refs=${refs.length}`);
      }
      // 5xx / 429 / module-not-exists / network 类错误才重试；4xx 业务错（如 1201 prompt 超长）不重试
      const retriable = !status || status >= 500 || status === 429 || /module not exists|temporary|timeout|gateway|proxy/i.test(String(msg));
      if (!retriable) throw err;
      if (attempt < 2) await _sleep((attempt + 1) * 2000);
    }
  }
  if (!r) throw lastErr || new Error('deyunai 提交失败');
  let url = _extractGeneratedImageUrl(r.data);
  const taskId = _extractAsyncTaskId(r.data);
  if (!url && taskId) {
    const pollUrls = [
      `${baseUrl}/images/generations/${encodeURIComponent(taskId)}`,
      `${baseUrl}/images/${encodeURIComponent(taskId)}`,
      `${baseUrl}/tasks/${encodeURIComponent(taskId)}`,
      `${baseUrl}/task/${encodeURIComponent(taskId)}`,
      `${baseUrl}/images/tasks/${encodeURIComponent(taskId)}`,
    ];
    let lastPayload = r.data;
    for (let i = 0; i < 50 && !url; i++) {
      await _sleep(i < 2 ? 1800 : 3000);
      for (const pollUrl of pollUrls) {
        try {
          const pr = await axios.get(pollUrl, {
            headers,
            timeout: 30000,
          });
          lastPayload = pr.data;
          url = _extractGeneratedImageUrl(pr.data);
          const status = _extractTaskStatus(pr.data);
          if (url) break;
          if (/(fail|failed|error|cancel|rejected)/i.test(status)) {
            throw new Error('deyunai nano-banana 任务失败: ' + JSON.stringify(pr.data).slice(0, 240));
          }
        } catch (pollErr) {
          // 只在我们自己抛出的"任务失败"错误时再抛；axios 通讯错误（"Request failed with status code 400/404"
          // 也会含 failed 子串）必须吞掉继续尝试其它 pollUrl，否则会被误判为任务失败。
          if (pollErr.message && pollErr.message.startsWith('deyunai nano-banana 任务失败')) throw pollErr;
        }
      }
      if (!url && i % 5 === 4) {
        console.log(`[DH/images] nano-banana task ${taskId} waiting ${i + 1}/50 status=${_extractTaskStatus(lastPayload) || 'unknown'}`);
      }
    }
    if (!url) {
      throw new Error('deyunai nano-banana 异步任务超时，task_id=' + taskId + ' last=' + JSON.stringify(lastPayload).slice(0, 240));
    }
  }
  if (!url) throw new Error('deyunai nano-banana 未返回图片 URL: ' + JSON.stringify(r.data).slice(0, 200));

  fs.mkdirSync(destDir, { recursive: true });
  const outPath = path.join(destDir, filename + '.png');

  if (url.startsWith('data:image/')) {
    const b64 = url.replace(/^data:image\/\w+;base64,/i, '');
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  } else if (url.startsWith('http')) {
    const img = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    fs.writeFileSync(outPath, Buffer.from(img.data));
  } else {
    // base64
    fs.writeFileSync(outPath, Buffer.from(url, 'base64'));
  }
  console.log(`[DH/images] ✓ deyunai ${enabledModel} 完成: ${outPath}`);
  return outPath;
}

function _absolutePublicUrl(req, url) {
  if (!url || typeof url !== 'string') return '';
  if (/^https?:\/\//i.test(url)) return url;
  return _publicBaseUrl(req) + (url.startsWith('/') ? url : `/${url}`);
}

// Convert a URL (which may point to our own server) into a base64 data URI so
// external AI providers (Replicate / deyunai) can use it without needing to reach our port.
async function _resolveImageForExternalApi(req, url) {
  if (!url) return '';
  const localPath = _localAssetPathFromUrl(url);
  if (localPath) {
    try {
      const data = fs.readFileSync(localPath);
      const ext = path.extname(localPath).toLowerCase().replace('.', '');
      const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
      const mime = mimeMap[ext] || 'image/jpeg';
      return `data:${mime};base64,${data.toString('base64')}`;
    } catch (e) {
      console.warn('[DH] 转 base64 失败，回退 URL:', e.message);
    }
  }
  return _absolutePublicUrl(req, url);
}

function _localAssetPathFromUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let clean = url.split('?')[0];
  try {
    const u = new URL(clean);
    clean = u.pathname;
  } catch {}
  if (clean.includes('/public/jimeng-assets/')) {
    const p = path.join(JIMENG_ASSETS_DIR, path.basename(clean));
    return fs.existsSync(p) ? p : '';
  }
  if (clean.includes('/api/dh/my-avatars/')) return '';
  if (clean.startsWith('/public/jimeng-assets/')) {
    const p = path.join(JIMENG_ASSETS_DIR, path.basename(clean));
    return fs.existsSync(p) ? p : '';
  }
  return '';
}

async function _prepareProductAsset(inputPath, outName) {
  const sharp = _loadSharp();
  if (!sharp) return null;
  const maxSize = 1200;
  const src = sharp(inputPath).rotate().resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true }).ensureAlpha();
  const { data, info } = await src.raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels || 4;
  const sample = [];
  const pts = [
    [0, 0], [Math.max(0, info.width - 1), 0],
    [0, Math.max(0, info.height - 1)], [Math.max(0, info.width - 1), Math.max(0, info.height - 1)],
  ];
  for (const [x, y] of pts) {
    const i = (y * info.width + x) * channels;
    sample.push([data[i], data[i + 1], data[i + 2]]);
  }
  const bg = sample.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]).map(v => v / sample.length);
  const bgBright = (bg[0] + bg[1] + bg[2]) / 3;
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += channels) {
    const dr = out[i] - bg[0];
    const dg = out[i + 1] - bg[1];
    const db = out[i + 2] - bg[2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    const bright = (out[i] + out[i + 1] + out[i + 2]) / 3;
    if ((bgBright > 210 && bright > 205 && dist < 46) || (bgBright > 235 && bright > 230 && dist < 70)) {
      out[i + 3] = 0;
    }
  }
  const outPath = path.join(JIMENG_ASSETS_DIR, outName);
  await sharp(out, { raw: info })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .png()
    .toFile(outPath);
  return { path: outPath, url: `/public/jimeng-assets/${path.basename(outPath)}` };
}

function _productSourceUrl(product) {
  return product?.cutout_url || product?.cutoutUrl || product?.prepared_url || product?.preparedUrl || product?.image_url || '';
}

function _loadSharp() {
  try {
    return require('sharp');
  } catch (err) {
    console.warn('[DH/product-fuse] sharp unavailable, fallback to ffmpeg:', err.message.split('\n')[0]);
    return null;
  }
}

function _ffmpegBin() {
  return process.env.FFMPEG_PATH || require('ffmpeg-static') || 'ffmpeg';
}

// 注：以前这里有 _createProductCompositeFallbackFfmpeg / _createProductCompositeFallback 两个贴图兜底函数
// （sharp/FFmpeg 把商品 PNG overlay 到人物图 + 加假肉色"手块"），效果像 PS 贴图，与 Topview 真融合差距巨大。
// 2026-05-03 已删除 — 商品融合只走 nano-banana / Seedream 等真正 AI 图像融合模型。
// 模型失败时直接抛错让用户重试或换图，绝不返回贴图假成品。


function _replicateAuthMessage(msg) {
  const text = String(msg || '');
  if (/valid authentication token|authentication token|unauthorized|401|invalid api key|invalid token/i.test(text)) {
    return 'Replicate API Key 无效或已失效：这不是余额不足，请到后台 AI 供应商配置里更新 Replicate Token（通常以 r8_ 开头）。';
  }
  if (/payment|billing|credit|balance|insufficient/i.test(text)) {
    return 'Replicate 余额或账单状态异常：请检查 Replicate 账户余额/账单后重试。';
  }
  return '';
}

function _formatReplicateError(prefix, err) {
  const status = err?.response?.status;
  const msg = err?.response?.data?.detail || err?.response?.data?.error || err?.message || err;
  const normalized = _replicateAuthMessage(`${status || ''} ${msg}`);
  return `${prefix}: ${normalized || String(msg).slice(0, 200)}`;
}

// ════════════════════════════════════════════════
// flux-kontext-multi (Black Forest Labs / Replicate) — 多 ref 图像融合
// 接 multi-image-kontext-pro 模型：输入 input_image_1（人物）+ input_image_2（商品）+ prompt
// 商品 SKU 保真度业界第一，明显优于 nano-banana。
// 价格 ≈ ¥0.4/张（pro），¥0.8/张（max）。
// 需要在 settings 配 Replicate provider + REPLICATE_API_TOKEN。
// ════════════════════════════════════════════════
async function _generateViaFluxKontextMulti({ prompt, image1Url, image2Url, aspectRatio, filename, destDir, modelTier = 'pro' }) {
  const { loadSettings, getApiKey } = require('../services/settingsService');
  const settings = loadSettings();
  const apiKey = getApiKey('replicate') || process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
  if (!apiKey) throw new Error('未配置 Replicate API key（settings 加 replicate provider 或 export REPLICATE_API_TOKEN）');

  // 模型路径：multi-image-kontext-pro / max
  // Replicate namespace is flux-kontext-apps, not black-forest-labs/flux-kontext-apps.
  const modelPath = modelTier === 'max'
    ? 'flux-kontext-apps/multi-image-kontext-max'
    : 'flux-kontext-apps/multi-image-kontext-pro';

  // Replicate 接受 9:16 / 16:9 / 1:1 / 4:3 / 3:4
  const aspect = ['9:16','16:9','1:1','4:3','3:4'].includes(aspectRatio) ? aspectRatio : '9:16';

  const axios = require('axios');
  const submitUrl = `https://api.replicate.com/v1/models/${modelPath}/predictions`;
  const headers = {
    Authorization: 'Bearer ' + apiKey,
    'Content-Type': 'application/json',
    Prefer: 'wait=60', // 提交时同步等最多 60s，多数情况下直接拿到结果不用轮询
  };
  const body = {
    input: {
      input_image_1: image1Url,
      input_image_2: image2Url,
      prompt,
      aspect_ratio: aspect,
      output_format: 'png',
      safety_tolerance: 2,
    },
  };

  console.log(`[DH/flux-kontext] 调 ${modelPath} 提交任务…`);
  let prediction;
  try {
    const r = await axios.post(submitUrl, body, { headers, timeout: 90000 });
    prediction = r.data;
  } catch (err) {
    throw new Error(_formatReplicateError('flux-kontext 提交失败', err));
  }

  // 轮询 — 如果 wait=60 已经返回 succeeded 就直接拿结果
  let result = prediction;
  let attempts = 0;
  while (result?.status && !['succeeded', 'failed', 'canceled'].includes(result.status) && attempts < 30) {
    await _sleep(2500);
    const pollR = await axios.get(`https://api.replicate.com/v1/predictions/${result.id}`, { headers: { Authorization: 'Bearer ' + apiKey }, timeout: 25000 });
    result = pollR.data;
    attempts++;
  }
  if (result.status !== 'succeeded') {
    throw new Error('flux-kontext 任务失败: status=' + result.status + ' error=' + String(result.error || '').slice(0, 200));
  }
  const outputUrl = Array.isArray(result.output) ? result.output[0] : result.output;
  if (!outputUrl) throw new Error('flux-kontext 未返回图片 URL');

  fs.mkdirSync(destDir, { recursive: true });
  const outPath = path.join(destDir, filename + '.png');
  const img = await axios.get(outputUrl, { responseType: 'arraybuffer', timeout: 60000 });
  fs.writeFileSync(outPath, Buffer.from(img.data));
  console.log(`[DH/flux-kontext] ✓ 融合完成 ${path.basename(outPath)}`);
  return outPath;
}

// ════════════════════════════════════════════════════════════════
// 商品数字人融合 — 两步法（人脸保真级）
//   Step A: flux-kontext-multi-pro  →  注入商品到一张构图正确的"持物图"
//   Step B: InstantID (Replicate)   →  把脸换成上传的真人脸（ID 锁定）
// 这是当前唯一能同时保人脸+保商品 SKU 的稳定通路。
// 没有 Replicate Key 直接抛错——绝不再用 nano-banana 兜底（会生成随机脸）。
// ════════════════════════════════════════════════════════════════
async function _generateProductIntegratedAvatarImage(req, avatar, product) {
  if (!product?.image_url || !avatar?.image_url) return null;
  const baseUrl = _publicBaseUrl(req);

  try {
    const topview = require('../services/topviewService');
    const fuseModel = _pickPipelineModel('product_avatar.fuse_image');
    if (fuseModel && fuseModel.provider_id !== 'topview') {
      throw new Error(`模型调用管理当前将商品融合形象图配置为 ${fuseModel.provider_id}/${fuseModel.model_id}，当前商品融合接口只支持 Topview Product Avatar，请在模型调用管理切回 topview-product-avatar-v3`);
    }
    const rawName = (product.name || '').replace(/^[0-9a-f-]{8,}(\.(jpg|jpeg|png|webp))?$/i, '').trim();
    const productName = rawName || product.image_name || 'the uploaded product';
    const personUrl = await _resolveImageForExternalApi(req, avatar.image_url);
    const productUrl = await _resolveImageForExternalApi(req, _productSourceUrl(product));
    const startedAt = Date.now();
    const tv = await topview.generateProductAvatarImage({
      personImageUrl: personUrl,
      productImageUrl: productUrl,
      productName,
      prompt: [
        'Create a realistic product presenter image from the uploaded person and product.',
        'The presenter naturally holds the exact uploaded product at chest level.',
        'Preserve face identity, hairstyle, outfit style and product SKU details.',
      ].join(' '),
    });
    if (tv?.imageUrl) {
      const finalPath = path.join(JIMENG_ASSETS_DIR, `topview_product_${Date.now()}_${uuidv4().slice(0, 8)}.png`);
      const imgResp = await axios.get(tv.imageUrl, { responseType: 'arraybuffer', timeout: 60000 });
      fs.writeFileSync(finalPath, Buffer.from(imgResp.data));
      console.log(`[DH/product-fuse] Topview Product Avatar completed: ${path.basename(finalPath)}`);
      req._lastProductFusion = {
        imageId: tv.imageId || '',
        taskId: tv.taskId || '',
        removeBackgroundTaskId: tv.removeBackgroundTaskId || '',
        provider: 'topview',
      };
      try {
        require('../services/tokenTracker').record({
          provider: 'topview',
          model: fuseModel?.model_id || 'topview-product-avatar-v3',
          category: 'image',
          agentId: 'product_avatar.fuse_image',
          imageCount: 1,
          durationMs: Date.now() - startedAt,
          status: 'success',
        });
      } catch {}
      return `${baseUrl}/public/jimeng-assets/${path.basename(finalPath)}`;
    }
  } catch (topviewErr) {
    console.error('[DH/product-fuse] Topview Product Avatar failed:', topviewErr);
    throw new Error(`Topview 商品数字人合成失败：${topviewErr.message}`);
  }

  const { getApiKey } = require('../services/settingsService');
  const replicateKey = getApiKey('replicate') || process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
  if (!replicateKey) {
    throw new Error('商品数字人需要 Replicate API Key（人脸保真模型 PuLID/InstantID + 商品融合 flux-kontext）。请到设置→供应商中配置 Replicate。');
  }

  const rawName = (product.name || '').replace(/^[0-9a-f-]{8,}(\.(jpg|jpeg|png|webp))?$/i, '').trim();
  const productName = rawName || product.image_name || 'the uploaded product';
  const motionStyle = product.motion_style || 'hold';

  const actionHint = {
    hold: 'one hand visibly grips the product at chest level with all fingers wrapped, knuckles visible, front face of product toward camera',
    point: 'one hand holds the product up to camera, the other hand points at it with index finger',
    compare: 'one hand holds the product upright, the other hand gestures comparison',
    demo: 'one hand holds the product up at chest height, the other hand mid-presenter-gesture',
  }[motionStyle] || 'one hand grips the product naturally';

  // Prompt for Step A (flux-kontext): 商品+构图，人脸允许漂（反正 Step B 会换）
  const kontextPrompt = [
    `A young person holding the EXACT product from image 2 in their hand, waist-up framing, both hands visible, photorealistic.`,
    `The product MUST physically appear in this photo, exactly matching image 2 in shape, color, logo, screen content, proportions. NEVER omit, NEVER replace.`,
    `Composition: vertical 9:16, waist-up, hand grips product with five fingers wrapped, contact shadows, natural finger occlusion.`,
    `Pose: ${actionHint}. Anatomically correct hands.`,
    `Product: ${productName}. Front face toward camera, not cropped. If smartphone: vertical orientation, screen ON.`,
    `Photography: candid 85mm DSLR snapshot, real depth of field, natural ambient light.`,
    `Avoid: empty hands, floating product, product card/sticker, deformed fingers, multiple persons, category swap.`,
  ].join(' ');

  const personUrl = await _resolveImageForExternalApi(req, avatar.image_url);
  const productUrl = await _resolveImageForExternalApi(req, _productSourceUrl(product));
  console.log(`[DH/product-fuse] 图像解析: person=${personUrl.startsWith('data:') ? `base64(${Math.round(personUrl.length/1024)}KB)` : personUrl}, product=${productUrl.startsWith('data:') ? `base64(${Math.round(productUrl.length/1024)}KB)` : productUrl}`);

  const filename = `product_fused_${Date.now()}_${uuidv4().slice(0, 8)}`;

  // ── Step A: flux-kontext-multi-pro 注入商品 ──
  console.log('[DH/product-fuse] Step A: flux-kontext 注入商品（脸不重要，下一步会换）');
  let stepAPath;
  try {
    stepAPath = await _generateViaFluxKontextMulti({
      prompt: kontextPrompt,
      image1Url: personUrl,
      image2Url: productUrl,
      aspectRatio: '9:16',
      filename: filename + '_kontext',
      destDir: JIMENG_ASSETS_DIR,
      modelTier: 'pro',
    });
  } catch (e) {
    const hint = _replicateAuthMessage(e.message);
    throw new Error(`Step A flux-kontext 失败: ${hint || e.message}`);
  }
  const stepAUrl = `${baseUrl}/public/jimeng-assets/${path.basename(stepAPath)}`;
  console.log(`[DH/product-fuse] Step A ✓ 持物图: ${path.basename(stepAPath)}`);

  // ── Step B: InstantID 把脸换成上传的真人脸（人脸 ID 锁定） ──
  console.log('[DH/product-fuse] Step B: InstantID 锁定真人脸');
  let stepBImageUrl;
  try {
    const instantPrompt = `photorealistic portrait, holding ${productName}, natural skin, sharp focus, identity preserved`;
    const negPrompt = 'low quality, distorted, plastic skin, cartoon, blurry, deformed, multiple faces, child';
    stepBImageUrl = await _runInstantIDForProduct({
      apiKey: replicateKey,
      refFaceUrl: personUrl,
      poseImageUrl: stepAUrl,
      prompt: instantPrompt,
      negativePrompt: negPrompt,
    });
  } catch (e) {
    throw new Error(`Step B InstantID 换脸失败: ${e.message}。Step A 已生成持物图但人脸非真人，未保存。`);
  }

  // 下载最终图到本地
  const finalPath = path.join(JIMENG_ASSETS_DIR, filename + '.png');
  try {
    const imgResp = await axios.get(stepBImageUrl, { responseType: 'arraybuffer', timeout: 60000 });
    fs.writeFileSync(finalPath, Buffer.from(imgResp.data));
  } catch (e) {
    throw new Error(`下载 Step B 结果失败: ${e.message}`);
  }
  console.log(`[DH/product-fuse] ✓ 两步融合完成: ${path.basename(finalPath)}`);
  return `${baseUrl}/public/jimeng-assets/${path.basename(finalPath)}`;
}

// 调用 Replicate zsxkib/instant-id —— 锁定参考人脸 + pose 引导
async function _runInstantIDForProduct({ apiKey, refFaceUrl, poseImageUrl, prompt, negativePrompt }) {
  const submitUrl = 'https://api.replicate.com/v1/models/zsxkib/instant-id/predictions';
  const headers = { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', Prefer: 'wait=60' };
  const input = {
    image: refFaceUrl,
    pose_image: poseImageUrl,
    prompt: prompt || 'photorealistic, preserve facial identity',
    negative_prompt: negativePrompt || 'low quality, distorted, plastic skin',
    num_inference_steps: 30,
    guidance_scale: 5,
    ip_adapter_scale: 0.85,           // 高 ID 还原
    controlnet_conditioning_scale: 0.9, // 高 pose 跟随，保留 Step A 构图（手+商品）
  };
  let r;
  try {
    r = await axios.post(submitUrl, { input }, { headers, timeout: 120000 });
  } catch (err) {
    throw new Error(_formatReplicateError('InstantID 提交失败', err));
  }
  let result = r.data;
  for (let i = 0; i < 40 && result?.status && !['succeeded', 'failed', 'canceled'].includes(result.status); i++) {
    await _sleep(2500);
    try {
      const pollR = await axios.get(`https://api.replicate.com/v1/predictions/${result.id}`, { headers: { Authorization: 'Bearer ' + apiKey }, timeout: 25000 });
      result = pollR.data;
    } catch (err) {
      throw new Error(_formatReplicateError('InstantID 轮询失败', err));
    }
  }
  if (result.status !== 'succeeded') throw new Error('InstantID status=' + result.status + ' err=' + String(result.error || '').slice(0, 200));
  const out = Array.isArray(result.output) ? result.output[0] : result.output;
  if (!out) throw new Error('InstantID 未返回 URL');
  return out;
}

function _getSeedanceAdConfig(preferred = null) {
  const { loadSettings } = require('../services/settingsService');
  const settings = loadSettings();
  const providers = settings.providers || [];
  const p = preferred?.provider_id
    ? providers.find(x => x.id === preferred.provider_id && x.enabled && x.api_key)
    : providers.find(x => x.enabled && x.api_key && (
      /火山方舟|seedance|^ark$/i.test(x.name || x.id || '') || String(x.id || '').includes('202604')
    ));
  if (!p) throw new Error('未配置火山方舟 Seedance API Key');
  const models = Array.isArray(p.models) ? p.models : [];
  if (preferred?.model_id) return { apiKey: p.api_key, model: preferred.model_id, providerId: p.id };
  const preferredModels = [
    'doubao-seedance-2-0-i2v-250428',
    'doubao-seedance-2-0-260128',
    'doubao-seedance-2-0-fast-260128',
    'doubao-seedance-1-0-pro-fast-251015',
  ];
  const model = preferredModels.find(id => models.some(m => m.id === id && m.enabled !== false))
    || models.find(m => /seedance/i.test(m.id || '') && m.enabled !== false)?.id
    || 'doubao-seedance-2-0-i2v-250428';
  return { apiKey: p.api_key, model };
}

function _taskPatch(taskId, patch) {
  const t = productAdTasks.get(taskId);
  if (!t) return null;
  Object.assign(t, patch, { updated_at: new Date().toISOString() });
  productAdTasks.set(taskId, t);
  return t;
}

function _cleanJsonArray(text) {
  const raw = String(text || '').trim();
  const m = raw.match(/\[[\s\S]*\]/);
  return JSON.parse(m ? m[0] : raw);
}

function _fallbackProductAdScenes(product, topic, durationSec) {
  const name = product?.name || product?.image_name || 'this product';
  const selling = product?.selling_points || 'portable, useful, easy to use';
  const each = Math.max(3, Math.min(6, Math.round((durationSec || 18) / 4)));
  return [
    {
      title: '生活场景',
      role: 'scene',
      duration: each,
      voiceover: `${name}，让日常使用更轻松。`,
      visual_prompt: `A realistic ecommerce lifestyle scene showing ${name} in use, the exact uploaded product clearly visible, natural daylight, social media ad style. Context: ${topic || selling}.`,
      video_prompt: `Slow camera push-in on the product in a real use scene. Keep the exact product shape, color and category unchanged. Smooth commercial ad motion.`,
    },
    {
      title: '痛点对比',
      role: 'pain',
      duration: each,
      voiceover: `不用忍受麻烦和低效率，它把关键问题一次解决。`,
      visual_prompt: `A realistic comparison scene where people face the pain point, while ${name} appears as the clear solution. Exact uploaded product preserved, no redesign.`,
      video_prompt: `Show a subtle before-and-after feeling, camera pans from the problem to the product. Product remains stable and realistic.`,
    },
    {
      title: '商品特写',
      role: 'closeup',
      duration: each,
      voiceover: `核心亮点是${selling}。`,
      visual_prompt: `Premium close-up ecommerce product hero shot of ${name}, exact uploaded product, clear details, realistic shadows, clean background, TikTok ad style.`,
      video_prompt: `Macro product close-up with gentle rotation and light movement. Preserve exact product identity and visible details.`,
    },
    {
      title: '真人介绍',
      role: 'presenter',
      duration: each,
      voiceover: `现在就把它加入你的必备清单。`,
      visual_prompt: `A realistic product presenter holding ${name} facing the camera, product front side clearly visible, natural hands, livestream room, exact uploaded product unchanged.`,
      video_prompt: `Presenter looks at camera and introduces the product, natural hand gesture, product held upright and clear, smooth ending shot.`,
    },
  ];
}

function _sceneNeedsPresenter(scene = {}) {
  const role = String(scene.role || '').toLowerCase();
  return ['scene', 'pain', 'presenter', 'demo', 'lifestyle'].includes(role);
}

function _productAdIdentityLockPrompt({ product, scene }) {
  const name = product?.name || product?.image_name || 'the uploaded product';
  return [
    'Topview Image2-style controlled storyboard keyframe.',
    `Use the uploaded product reference as ${name}; preserve its category, silhouette, proportions, colors, logo area and visible details exactly.`,
    _sceneNeedsPresenter(scene)
      ? 'If a human presenter appears, use the uploaded presenter/avatar reference as the same person across all keyframes: same face identity, hairstyle, age, body type and outfit style.'
      : 'This shot may focus on product details; do not introduce a different presenter unless the storyboard explicitly needs one.',
    'Stable commercial composition, realistic lighting, no product morphing, no identity drift, no extra text, no watermark.',
  ].join(' ');
}

async function _buildProductAdStoryboard({ product, topic, durationSec }) {
  const { callLLM } = require('../services/storyService');
  const name = product?.name || product?.image_name || '商品';
  const target = Math.max(12, Math.min(40, Number(durationSec) || 18));
  const sys = '你是跨境电商短视频广告导演。你会把单张商品图设计成 Topview/Image2+Seedance 风格的多关键帧产品广告。只输出 JSON。';
  const user = `商品名称：${name}
商品卖点：${product?.selling_points || '未填写'}
目标人群：${product?.audience || '未指定'}
优惠/行动号召：${product?.offer || '未指定'}
广告重点：${topic || '生成一条产品介绍短视频'}
目标总时长：${target} 秒

请输出 4 个镜头的 JSON 数组。每项字段：
{
  "title": "短标题",
  "role": "scene|pain|closeup|presenter",
  "duration": 3到6之间的整数,
  "voiceover": "中文口播短句",
  "visual_prompt": "英文关键帧生成提示词，必须强调 exact uploaded product unchanged",
  "video_prompt": "英文图生视频提示词，描述镜头运动和动作"
}

镜头必须覆盖：使用场景、痛点对比、商品特写、真人手持介绍。商品外观绝对不能变品类。`;
  try {
    const out = await callLLM(sys, user);
    const scenes = _cleanJsonArray(out)
      .filter(x => x && x.visual_prompt && x.video_prompt)
      .slice(0, 5)
      .map((x, i) => ({
        title: String(x.title || `镜头 ${i + 1}`).slice(0, 20),
        role: ['scene', 'pain', 'closeup', 'presenter'].includes(x.role) ? x.role : (i === 3 ? 'presenter' : i === 2 ? 'closeup' : i === 1 ? 'pain' : 'scene'),
        duration: Math.max(3, Math.min(6, Math.round(Number(x.duration) || target / 4))),
        voiceover: String(x.voiceover || '').trim(),
        visual_prompt: String(x.visual_prompt || '').trim(),
        video_prompt: String(x.video_prompt || '').trim(),
      }));
    if (scenes.length >= 3) return scenes;
  } catch (err) {
    console.warn('[DH/product-ad] storyboard fallback:', err.message);
  }
  return _fallbackProductAdScenes(product, topic, target);
}

async function _concatVideosSmooth(videoPaths, outputPath, ratio = '9:16') {
  if (!Array.isArray(videoPaths) || !videoPaths.length) throw new Error('没有可拼接的视频片段');
  if (videoPaths.length === 1) {
    fs.copyFileSync(videoPaths[0], outputPath);
    return;
  }
  const ffmpeg = _ffmpegBin();
  const durations = videoPaths.map(p => _probeMediaDuration(ffmpeg, p, 5));
  const xfadeDur = 0.35;
  const size = ratio === '16:9' ? { w: 1280, h: 720 } : { w: 720, h: 1280 };
  const args = ['-y'];
  videoPaths.forEach(p => args.push('-i', p));
  let filter = '';
  for (let i = 0; i < videoPaths.length; i++) {
    filter += `[${i}:v]scale=${size.w}:${size.h}:force_original_aspect_ratio=increase,crop=${size.w}:${size.h},setsar=1,fps=30,format=yuv420p[v${i}];`;
  }
  let vLabel = '[v0]';
  let offset = Math.max(0.1, durations[0] - xfadeDur);
  for (let i = 1; i < videoPaths.length; i++) {
    const outV = i === videoPaths.length - 1 ? '[outv]' : `[xv${i}]`;
    filter += `${vLabel}[v${i}]xfade=transition=fade:duration=${xfadeDur}:offset=${offset.toFixed(2)}${outV};`;
    vLabel = outV;
    offset += Math.max(0.1, durations[i] - xfadeDur);
  }
  args.push('-filter_complex', filter.replace(/;$/, ''));
  args.push('-map', '[outv]', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-movflags', '+faststart', outputPath);
  try {
    execFileSync(ffmpeg, args, { stdio: 'pipe', timeout: 240000 });
  } catch (err) {
    console.warn('[DH/ad] smooth concat failed, fallback to copy concat:', err.message);
    await _concatVideos(videoPaths, outputPath);
  }
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
    throw new Error('视频平滑拼接失败');
  }
}

function _probeMediaDuration(ffmpegPath, filePath, fallback = 5) {
  try {
    const out = execFileSync(ffmpegPath, ['-i', filePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
    const m = String(out).match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100;
  } catch (err) {
    const s = String(err.stderr || err.stdout || '');
    const m = s.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100;
  }
  return fallback;
}

async function _concatVideos(videoPaths, outputPath) {
  const listPath = path.join(path.dirname(outputPath), 'concat.txt');
  fs.writeFileSync(listPath, videoPaths.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
  execFileSync(_ffmpegBin(), ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath], { stdio: 'pipe', timeout: 180000 });
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
    throw new Error('产品广告片拼接失败');
  }
}

async function _muxAudio(videoPath, audioPath, outputPath) {
  execFileSync(_ffmpegBin(), [
    '-y',
    '-i', videoPath,
    '-i', audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-shortest',
    outputPath,
  ], { stdio: 'pipe', timeout: 180000 });
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
    throw new Error('产品广告片音频合成失败');
  }
}

async function _runProductAdTask(req, taskId, { avatar, product, topic, durationSec, voiceId, voiceProvider, subtitle }) {
  const taskDir = path.join(JIMENG_ASSETS_DIR, `product_ad_${taskId}`);
  fs.mkdirSync(taskDir, { recursive: true });
  const base = _publicBaseUrl(req);
  const videoModel = _pickPipelineModel('product_avatar.marketing_video') || { provider_id: 'topview', model_id: 'topview-product-avatar-i2v' };
  const ttsModel = _pickPipelineModel('product_avatar.tts') || { provider_id: 'aliyun-tts', model_id: 'cosyvoice-v3-flash' };
  try {
    if (videoModel.provider_id === 'topview') try {
      const topview = require('../services/topviewService');
      const topviewImageId =
        avatar?.topview_product_image_id ||
        avatar?.product?.topview_image_id ||
        avatar?.product?.topviewImageId ||
        avatar?.product?.topview?.imageId ||
        '';
      if (!topviewImageId) {
        throw new Error('缺少 Topview 商品形象 imageId，请重新生成商品数字人形象后再生成视频');
      }
      _taskPatch(taskId, { status: 'running', stage: 'topview_product_avatar_video', progress: 10, message: 'Topview 商品数字人视频生成中' });
      const title = `${product?.name || product?.image_name || '商品'} 商品数字人`;
      const script = topic || `${product?.name || product?.image_name || '这款商品'} 的商品数字人口播介绍`;
      const startedAt = Date.now();
      const effectiveVoiceProvider = voiceProvider || ttsModel.provider_id || '';
      const useTopviewTts = String(effectiveVoiceProvider || '').toLowerCase() === 'topview';
      let audioPath = '';
      if (!useTopviewTts) {
        _taskPatch(taskId, { stage: 'aliyun_tts', progress: 18, message: '阿里 TTS 生成配音中' });
        const { generateSpeech } = require('../services/ttsService');
        const voiceBase = path.join(taskDir, 'product_voice');
        audioPath = await generateSpeech(script, voiceBase, { voiceId: voiceId || null, speed: 1.0 });
        if (!audioPath || !fs.existsSync(audioPath)) throw new Error('阿里 TTS 配音生成失败');
        _taskPatch(taskId, { stage: 'topview_audio_upload', progress: 28, message: '上传阿里配音到 Topview' });
      }
      const tv = await topview.generateProductAvatarVideo({
        imageId: topviewImageId,
        imageUrl: avatar?.image_url ? _absolutePublicUrl(req, avatar.image_url) : '',
        title,
        text: script,
        voiceId: useTopviewTts ? (voiceId || '') : '',
        audioPath,
        duration: Math.max(10, Math.min(60, Number(durationSec) || 18)),
        onProgress: info => _taskPatch(taskId, {
          stage: info.stage || 'topview_product_avatar_video',
          progress: Math.max(10, Math.min(95, Number(info.progress) || 10)),
          message: `Topview ${info.status || info.stage || 'processing'}`,
        }),
      });
      if (tv?.videoUrl) {
        const dl = await axios.get(tv.videoUrl, { responseType: 'arraybuffer', timeout: 120000 });
        const finalPath = path.join(taskDir, 'topview_product_ad.mp4');
        fs.writeFileSync(finalPath, Buffer.from(dl.data));
        const publicName = `topview_product_ad_${taskId}.mp4`;
        fs.copyFileSync(finalPath, path.join(JIMENG_ASSETS_DIR, publicName));
        const taskData = {
          id: taskId,
          status: 'done',
          stage: 'done',
          title: `${product?.name || product?.image_name || '商品'} · 商品数字人`,
          text: topic || '',
          videoPath: finalPath,
          videoUrl: `/api/avatar/tasks/${taskId}/stream`,
          video_url: `${base}/public/jimeng-assets/${publicName}`,
          image_url: avatar?.image_url || product?.image_url || '',
          thumbnail_url: avatar?.image_url || product?.image_url || '',
          kind: 'production',
          mode: 'product_ad',
          generation_mode: 'topview',
          pipeline_video_provider: videoModel.provider_id,
          pipeline_video_model: videoModel.model_id,
          pipeline_tts_provider: ttsModel.provider_id,
          pipeline_tts_model: ttsModel.model_id,
          user_id: productAdTasks.get(taskId)?.user_id,
          ratio: '9:16',
          model: tv.model_id || 'topview-product-avatar-i2v',
          provider_id: 'topview',
          topview_task_id: tv.taskId,
          created_at: productAdTasks.get(taskId)?.created_at || new Date().toISOString(),
        };
        productAdTasks.set(taskId, { ...productAdTasks.get(taskId), ...taskData, progress: 100, updated_at: new Date().toISOString() });
        if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
        else db.updateAvatarTask(taskId, taskData);
        try {
          require('../services/tokenTracker').record({
            provider: videoModel.provider_id,
            model: videoModel.model_id || tv.model_id || 'topview-product-avatar-i2v',
            category: 'video',
            agentId: 'product_avatar.marketing_video',
            videoSeconds: Math.max(10, Math.min(60, Number(durationSec) || 18)),
            durationMs: Date.now() - startedAt,
            status: 'success',
          });
        } catch {}
        return;
      }
    } catch (topviewErr) {
      console.error('[DH/product-ad] Topview failed:', topviewErr);
      _taskPatch(taskId, {
        status: 'error',
        stage: 'topview_product_avatar_video_error',
        error: `Topview 商品数字人视频生成失败：${topviewErr.message}`,
        message: topviewErr.message,
      });
      try {
        require('../services/tokenTracker').record({
          provider: videoModel.provider_id,
          model: videoModel.model_id || 'topview-product-avatar-i2v',
          category: 'video',
          agentId: 'product_avatar.marketing_video',
          videoSeconds: Math.max(10, Math.min(60, Number(durationSec) || 18)),
          status: 'fail',
          errorMsg: topviewErr.message,
        });
      } catch {}
      try {
        if (!db.getAvatarTask(taskId)) {
          const t = productAdTasks.get(taskId);
          db.insertAvatarTask({ ...t, status: 'error', error: `Topview 商品数字人视频生成失败：${topviewErr.message}`, kind: 'production', mode: 'product_ad', generation_mode: 'topview' });
        }
      } catch {}
      return;
    }
    if (!['volcengine', 'api-key-20260404180437', 'jimeng'].includes(videoModel.provider_id)) {
      throw new Error(`商品介绍片生成当前配置为 ${videoModel.provider_id}/${videoModel.model_id}，暂不支持该供应商执行商品数字人成片`);
    }

    _taskPatch(taskId, { status: 'running', stage: 'storyboard', progress: 8, message: '生成产品广告分镜' });
    const scenes = await _buildProductAdStoryboard({ product, topic, durationSec });
    _taskPatch(taskId, { scenes, progress: 15 });

    const productUrl = _absolutePublicUrl(req, _productSourceUrl(product));
    const avatarUrl = avatar?.image_url ? _absolutePublicUrl(req, avatar.image_url) : '';
    const keyframes = [];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      _taskPatch(taskId, { stage: 'keyframes', progress: 15 + Math.round((i / scenes.length) * 28), message: `生成关键帧 ${i + 1}/${scenes.length}` });
      const refs = [productUrl];
      if (_sceneNeedsPresenter(scene) && avatarUrl) refs.unshift(avatarUrl);
      const prompt = [
        scene.visual_prompt,
        _productAdIdentityLockPrompt({ product, scene }),
        `Product reference: ${product?.name || product?.image_name || 'the uploaded product'}.`,
        'The exact uploaded product must remain the same category, shape, color, logo area, proportions and visual identity.',
        _sceneNeedsPresenter(scene)
          ? 'Keep the same presenter identity as the reference avatar. Do not change face, hairstyle or outfit between shots.'
          : '',
        'No product replacement, no generic object, no floating sticker, no extra text, no watermark, realistic ecommerce advertising frame.',
      ].join(' ');
      const filePath = await _generateViaDeyunaiNanoBanana({
        prompt,
        aspectRatio: '9:16',
        filename: `product_ad_${taskId}_kf_${String(i + 1).padStart(2, '0')}`,
        destDir: JIMENG_ASSETS_DIR,
        referenceImages: refs.filter(Boolean),
      });
      const url = `${base}/public/jimeng-assets/${path.basename(filePath)}`;
      keyframes.push({ ...scene, image_url: url, local_path: filePath });
      _taskPatch(taskId, { keyframes });
    }

    const { _seedanceAVGenerate } = require('../services/avatarService');
    const { apiKey, model } = _getSeedanceAdConfig(videoModel);
    const clips = [];
    for (let i = 0; i < keyframes.length; i++) {
      const kf = keyframes[i];
      _taskPatch(taskId, { stage: 'video', progress: 45 + Math.round((i / keyframes.length) * 35), message: `生成视频镜头 ${i + 1}/${keyframes.length}` });
      const prompt = [
        kf.video_prompt,
        `Shot title: ${kf.title}.`,
        `Voiceover meaning: ${kf.voiceover || ''}`,
        'Keep the product visually identical to the keyframe. Smooth commercial video, stable product geometry, no morphing, no text overlay, no watermark.',
      ].join(' ');
      const { videoBuffer } = await _seedanceAVGenerate(
        kf.image_url,
        prompt,
        model,
        apiKey,
        info => _taskPatch(taskId, { message: info.message || `Seedance 镜头 ${i + 1}` }),
        { ratio: '9:16', duration: kf.duration || 4, hasAudio: false }
      );
      const clipPath = path.join(taskDir, `clip_${String(i + 1).padStart(2, '0')}.mp4`);
      fs.writeFileSync(clipPath, videoBuffer);
      clips.push(clipPath);
    }

    _taskPatch(taskId, { stage: 'post_effects', progress: 84, message: '拼接视频' });
    const concatPath = path.join(taskDir, 'product_ad_concat.mp4');
    await _concatVideosSmooth(clips, concatPath, '9:16');

    const voiceover = keyframes.map(k => k.voiceover).filter(Boolean).join('');
    let finalPath = concatPath;
    if (voiceover) {
      try {
        _taskPatch(taskId, { message: '合成口播音频' });
        const { generateSpeech } = require('../services/ttsService');
        const audioBase = path.join(taskDir, 'voiceover');
        const audioPath = await generateSpeech(voiceover, audioBase, { voiceId: voiceId || null, speed: 1.0 });
        const muxPath = path.join(taskDir, 'product_ad_audio.mp4');
        await _muxAudio(concatPath, audioPath, muxPath);
        finalPath = muxPath;
      } catch (audioErr) {
        console.warn('[DH/product-ad] voiceover failed:', audioErr.message);
      }
    }

    const showSubtitles = subtitle?.show !== false;
    if (showSubtitles && voiceover) {
      try {
        _taskPatch(taskId, { message: '烧录字幕' });
        const { applyEffects } = require('../services/effectsService');
        let cursor = 0;
        const texts = keyframes.filter(k => k.voiceover).map(k => {
          const startTime = cursor;
          cursor += Number(k.duration) || 4;
          return {
            text: k.voiceover,
            preset: 'subtitle',
            position: 'bottom',
            startTime,
            endTime: cursor,
            fontName: subtitle?.fontName || '抖音美好体',
            fontSize: subtitle?.fontSize || 64,
            color: subtitle?.color || '#FFFFFF',
            outlineColor: subtitle?.outlineColor || '#000000',
          };
        });
        const fx = await applyEffects({ videoPath: finalPath, texts });
        if (fx?.outputPath && fs.existsSync(fx.outputPath)) finalPath = fx.outputPath;
      } catch (fxErr) {
        console.warn('[DH/product-ad] subtitle failed:', fxErr.message);
      }
    }

    const taskData = {
      id: taskId,
      status: 'done',
      stage: 'done',
      title: `${product?.name || product?.image_name || '商品'} · 产品介绍片`,
      text: voiceover || topic || '',
      scenes,
      keyframes: keyframes.map(k => ({ title: k.title, role: k.role, image_url: k.image_url, voiceover: k.voiceover })),
      videoPath: finalPath,
      videoUrl: `/api/avatar/tasks/${taskId}/stream`,
      image_url: keyframes[0]?.image_url || avatar?.image_url || product?.image_url || '',
      thumbnail_url: keyframes[0]?.image_url || '',
      kind: 'production',
      mode: 'product_ad',
      user_id: productAdTasks.get(taskId)?.user_id,
      ratio: '9:16',
      model,
      created_at: task.created_at,
    };
    productAdTasks.set(taskId, { ...productAdTasks.get(taskId), ...taskData, progress: 100, updated_at: new Date().toISOString() });
    if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
    else db.updateAvatarTask(taskId, taskData);
  } catch (err) {
    console.error('[DH/product-ad] failed:', err);
    _taskPatch(taskId, { status: 'error', stage: 'error', error: err.message, message: err.message });
    try {
      if (!db.getAvatarTask(taskId)) {
        const t = productAdTasks.get(taskId);
        db.insertAvatarTask({ ...t, status: 'error', error: err.message, kind: 'production', mode: 'product_ad' });
      }
    } catch {}
  }
}

router.post('/product-ads/generate', async (req, res) => {
  try {
    const { avatar_id, product = null, topic = '', duration_sec = 18, voice_id = null, voice_provider = '', subtitle = null } = req.body || {};
    if (!avatar_id) return res.status(400).json({ success: false, error: '请选择商品数字人形象' });
    if (!String(voice_id || '').trim()) return res.status(400).json({ success: false, error: 'voice_id 必填，请先选择 Topview 配音音色' });
    const avatar = db.getPortrait(avatar_id);
    if (!avatar || avatar.kind !== 'digital_human' || !ownedBy(req, avatar)) {
      return res.status(404).json({ success: false, error: '形象不存在' });
    }
    const effectiveProduct = product?.image_url
      ? product
      : ((avatar.avatar_type === 'product' || avatar.type === 'product') ? (avatar.product || null) : null);
    if (!effectiveProduct?.image_url) return res.status(400).json({ success: false, error: '商品广告片需要商品图' });
    const taskId = uuidv4();
    const task = {
      id: taskId,
      taskId,
      status: 'submitted',
      stage: 'submitted',
      progress: 3,
      message: '已提交商品数字人生成',
      avatar_id,
      product: effectiveProduct,
      topic,
      user_id: req.user?.id,
      created_at: new Date().toISOString(),
      started_at: Date.now(),
      kind: 'production',
      mode: 'product_ad',
    };
    productAdTasks.set(taskId, task);
    res.json({ success: true, taskId, message: '已提交商品数字人任务' });
    _runProductAdTask(req, taskId, { avatar, product: effectiveProduct, topic, durationSec: duration_sec, voiceId: voice_id, voiceProvider: voice_provider, subtitle });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/product-ads/:taskId', (req, res) => {
  const task = productAdTasks.get(req.params.taskId) || db.getAvatarTask(req.params.taskId);
  if (!task) return res.status(404).json({ success: false, error: '任务不存在' });
  if (task.user_id && req.user?.id && task.user_id !== req.user.id) {
    return res.status(404).json({ success: false, error: '任务不存在' });
  }
  res.json({ success: true, task });
});

router.post('/images/generate', async (req, res) => {
  try {
    const { style = 'idol_warm', gender = '', description = '', aspectRatio: rawAspectRatio = '9:16', avatar_type = 'normal', product = null, action = 'natural', framing = 'half_body', background_image_url = '' } = req.body || {};
    const isProduct = avatar_type === 'product' && product?.image_url;
    // 自定义背景：把图当 reference 喂给 nano-banana，并往 prompt 加"以参考图作为背景场景"
    const bgRef = background_image_url && /^https?:\/\//i.test(background_image_url)
      ? background_image_url : '';

    // 用户上传 bg → 画布尺寸跟随 bg 比例，避免 stage3 cover 裁切丢失大块背景
    let aspectRatio = rawAspectRatio;
    let cachedBgBuf = null;
    if (bgRef) {
      try {
        const sharp = require('sharp');
        cachedBgBuf = await _fetchImageBuffer(bgRef);
        const bgMeta = await sharp(cachedBgBuf).metadata();
        const bgRatio = bgMeta.width / bgMeta.height;
        // 找最接近的预设比例
        let chosen = rawAspectRatio;
        if (bgRatio > 1.6) chosen = '16:9';
        else if (bgRatio < 0.65) chosen = '9:16';
        else if (Math.abs(bgRatio - 1) < 0.1) chosen = '1:1';
        else if (bgRatio < 1) chosen = '3:4';
        else chosen = '4:3';
        if (chosen !== rawAspectRatio) {
          console.log(`[DH/images] 背景图实际尺寸 ${bgMeta.width}x${bgMeta.height} (≈${chosen}) ≠ 用户选 ${rawAspectRatio} → 自动跟随背景比例避免裁切`);
          aspectRatio = chosen;
        }
      } catch (e) {
        console.warn('[DH/images] 读 bg 比例失败，沿用用户选的比例:', e.message);
      }
    }

    const baseUrl = _publicBaseUrl(req);
    const filename = `dh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // ════════════════════════════════════════════════
    // 商品数字人（Topview 模式）：两阶段
    //   阶段 A: 用 STYLE_PROMPTS[style] 生成基础人物（无商品）
    //   阶段 B: 用人物图 + 商品图 + 场景模板做 nano-banana 多 ref 融合
    // 不再单 ref（只商品图）+ 强 prompt — 那样模型不知道人是谁，商品也很难塞进去
    // ════════════════════════════════════════════════
    if (isProduct) {
      // ─── 阶段 A: 生成基础人物图 ───
      // 商品数字人阶段 A 不注入 action（持物姿势由阶段 B 商品融合时决定）
      const userEnPrompt = await _translateDescToEnAttrPrompt(description, { style, gender });
      // 商品数字人阶段 A 默认 half_body，让人物半身可见，方便阶段 B 持物融合
      const stylePack = _buildPrompt({ style, gender, description, userEnPrompt, framing: framing || 'half_body' });
      console.log(`[DH/images] 阶段A: 生成基础人物 style=${style} gender=${gender}`);
      const baseFilename = filename + '_base';
      let baseFilePath = null;
      try {
        baseFilePath = await _generateViaDeyunaiNanoBanana({
          prompt: stylePack.prompt,
          aspectRatio,
          filename: baseFilename,
          destDir: JIMENG_ASSETS_DIR,
          referenceImages: [],
        });
      } catch (eA1) {
        console.warn('[DH/images] 阶段A nano-banana 失败，fallback Seedream:', eA1.message);
        baseFilePath = await avatarService._arkSeedreamGenerate({
          prompt: stylePack.prompt, aspectRatio, filename: baseFilename,
          watermark: false, cropBottomPx: 100, destDir: JIMENG_ASSETS_DIR,
        });
      }
      if (!baseFilePath) throw new Error('阶段A 基础人物生成失败');
      const baseImgUrl = `${baseUrl}/public/jimeng-assets/${path.basename(baseFilePath)}`;
      console.log(`[DH/images] 阶段A ✓ 基础人物 ${path.basename(baseFilePath)}`);

      // ─── 阶段 B: 人物 + 商品 + 场景融合（Topview 真融合）───
      console.log(`[DH/images] 阶段B: 融合人物+商品`);
      const fusedUrl = await _generateProductIntegratedAvatarImage(
        req,
        { image_url: baseImgUrl },
        product,
      );
      if (!fusedUrl) throw new Error('阶段B 商品融合失败');
      const fusedName = fusedUrl.split('/').pop();
      console.log(`[DH/images] 阶段B ✓ 融合完成 ${fusedName}`);
      res.json({ success: true, imageUrl: fusedUrl, filename: fusedName });
      return;
    }

    // ════════════════════════════════════════════════
    // 普通数字人：单图生成
    // ════════════════════════════════════════════════
    // 关键：先把用户中文描述 LLM 翻译为英文属性 prompt（前置占主导权重）
    // 有 bgRef 时强制告诉 LLM 剥掉描述里的背景部分，避免污染 stage1（用户上传的 bg 才是最终背景）
    const userEnPrompt = await _translateDescToEnAttrPrompt(description, { style, gender, hasBgRef: !!bgRef });
    const promptPack = _buildPrompt({ style, gender, description, action, userEnPrompt, framing, hasBgRef: !!bgRef });
    const { prompt } = promptPack;
    if (action && action !== 'natural') {
      console.log(`[DH/images] 注入动作姿势 action=${action} → 烘焙到形象图（lip-sync 不接受动作 prompt，只能在生成时 baked-in）`);
    }
    if (framing && framing !== 'half_body') {
      console.log(`[DH/images] 构图 framing=${framing}（前置+后置双重强化覆盖 style 模板默认）`);
    }

    let filePath = null;
    let lastError = null;
    const attempts = [];

    // 自定义背景两阶段管线：
    //   ① 让 nano-banana 在纯灰背景上生成人物（不带 bg ref，避免 nano-banana 自己改背景）
    //   ② 百度 body_seg 抠出人物（透明 PNG）
    //   ③ Sharp 把人物贴到用户上传的 bg 上
    // 任何阶段失败 → 抛出明确错误（不再静默降级到 nano-banana 单阶段，那个对背景替换不可靠）
    let composePath = 'single-stage';
    let composeStageError = null;
    if (bgRef) {
      console.log(`[DH/images] 自定义背景两阶段管线启动 → bg=${bgRef.slice(0, 80)}…`);
      let stageMark = 'init';
      try {
        // 阶段①：纯灰背景人物图（用专门的 stage1 prompt 构造器，按 aspectRatio 自适应）
        stageMark = 'stage1-gen-person-on-grey';
        const stage1Prompt = _buildStage1Prompt({ gender, userEnPrompt, framing, aspectRatio });
        console.log(`[DH/images] 阶段①: 生成纯灰背景人物图… framing=${framing} ar=${aspectRatio} promptLen=${stage1Prompt.length}`);
        let stage1Path = await _generateViaDeyunaiNanoBanana({
          prompt: stage1Prompt, aspectRatio, filename: filename + '_stage1',
          destDir: JIMENG_ASSETS_DIR,
          referenceImages: [],
        });

        // ─── full_body 视觉自检 + 自动 retry（最多 1 次）───
        // nano-banana 对 face-rich 描述容易忽略 framing → 出半身。视觉判一次，没出全身就用更暴力 prompt 重 try
        if (framing === 'full_body') {
          const ok = await _checkIsFullBodyImage(stage1Path);
          if (ok === false) {
            console.warn('[DH/images] 阶段①视觉自检：判定非全身 → 重 try 一次（更激进 prompt）');
            // 注意：g / userClause 是 _buildStage1Prompt 内部局部变量，这里需要重新计算
            const _g = gender === 'male' ? 'a young man' : gender === 'female' ? 'a young woman' : 'a real person';
            const _userClause = (userEnPrompt && userEnPrompt.trim()) ? userEnPrompt.trim() : '';
            const retryPrompt = [
              'EXTREME WIDE SHOT FULL-LENGTH PHOTOGRAPH OF A PERSON STANDING.',
              'The image MUST show the entire person from the very top of the head to the very bottom of the feet.',
              'Critical framing rule: the head is at the top 10% of the image, the feet are at the bottom 5% of the image, the legs are clearly visible filling the lower half of the image.',
              `Subject: ${_g}. Standing upright. Both legs straight. Both feet and shoes clearly visible on the floor at the bottom of the image.`,
              _userClause ? `Appearance: ${_userClause}.` : '',
              'Lower body REQUIRED: full-length pants or knee-length skirt, simple shoes/sneakers, both legs and feet visible.',
              'Setting: PLAIN SOLID NEUTRAL GREY (#888888) seamless studio backdrop, completely empty.',
              'Photography: 24mm wide-angle lens, low camera angle from waist height, vertical fashion editorial composition.',
              'Strictly forbidden: NO portrait crop, NO headshot, NO bust shot, NO half body, NO waist-up, NO sitting, NO chair, NO furniture. The legs and feet MUST be in the frame or the image is wrong.',
              'ABSOLUTELY ONE SINGLE PERSON.',
            ].filter(Boolean).join(' ');
            try {
              const retryPath = await _generateViaDeyunaiNanoBanana({
                prompt: retryPrompt, aspectRatio, filename: filename + '_stage1_r',
                destDir: JIMENG_ASSETS_DIR,
                referenceImages: [],
              });
              const ok2 = await _checkIsFullBodyImage(retryPath);
              if (ok2 !== false) {
                stage1Path = retryPath;
                console.log('[DH/images] 阶段①重 try：' + (ok2 === true ? '✓ 全身通过' : '⚠ 视觉判不出，沿用 retry 结果'));
              } else {
                console.warn('[DH/images] 阶段①重 try 仍非全身，用最后结果继续（用户可再点重新生成）');
                stage1Path = retryPath;
              }
            } catch (retryErr) {
              console.warn('[DH/images] 阶段①重 try 失败，用首次结果继续:', retryErr.message);
            }
          } else if (ok === true) {
            console.log('[DH/images] 阶段①视觉自检：✓ 全身通过');
          }
        }
        // 阶段②：百度抠像
        stageMark = 'stage2-baidu-matting';
        console.log('[DH/images] 阶段②: 百度 body_seg 抠人物…');
        const baiduMatting = require('../services/baiduMattingService');
        const sharp = require('sharp');
        const personBuf = fs.readFileSync(stage1Path);
        const fgPng = await baiduMatting.segmentFrame(personBuf, 'foreground');
        // 阶段③：合成 — trim 透明边 + 智能尺寸 + alpha 软边 + 按 framing 贴底/居中
        stageMark = 'stage3-sharp-compose';
        console.log('[DH/images] 阶段③: Sharp 合成人物到用户背景…');
        const sizeMap = { '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [1024, 1024], '3:4': [768, 1024], '4:3': [1024, 768] };
        const [W, H] = sizeMap[aspectRatio] || [1024, 1024];
        const bgBuf = cachedBgBuf || await _fetchImageBuffer(bgRef);
        // 因为 aspectRatio 已经自动跟随 bg 实际比例了，cover 此时几乎不会裁切（最多差 1-2%）
        const bgResized = await sharp(bgBuf).resize(W, H, { fit: 'cover' }).toBuffer();
        // ① trim 去掉抠像周围空白透明边 — 避免人物只占小块导致背景大面积裸露
        const trimmed = await sharp(fgPng).trim({ threshold: 1 }).toBuffer();
        const tMeta = await sharp(trimmed).metadata();
        // ② alpha 软边（高斯模糊 alpha 通道 1.5px → 抠像硬边变 1-2px 过渡）
        let softened = trimmed;
        try {
          const alpha = await sharp(trimmed).extractChannel(3).blur(1.5).toBuffer();
          softened = await sharp(trimmed).removeAlpha().joinChannel(alpha).png().toBuffer();
        } catch (softErr) {
          console.warn('[DH/images] stage3 alpha 软边失败:', softErr.message);
        }
        // ③ 按 framing 决定占画布高度比例 + 位置
        const heightPct = framing === 'full_body' ? 0.96
          : framing === 'headshot' ? 0.7
          : framing === 'close_up' ? 0.95
          : 0.85;  // half_body
        const targetH = Math.round(H * heightPct);
        const scale = targetH / tMeta.height;
        let fgW = Math.round(tMeta.width * scale);
        let fgH = targetH;
        const maxW = Math.round(W * 0.92);
        if (fgW > maxW) {
          const s2 = maxW / tMeta.width;
          fgW = Math.round(tMeta.width * s2);
          fgH = Math.round(tMeta.height * s2);
        }
        const fgScaled = await sharp(softened).resize(fgW, fgH, { fit: 'fill' }).toBuffer();
        const leftPos = Math.round((W - fgW) / 2);
        const topPos = framing === 'full_body' ? Math.max(0, H - fgH) : Math.round((H - fgH) / 2);
        const composedBuf = await sharp(bgResized).composite([{ input: fgScaled, top: topPos, left: leftPos, blend: 'over' }]).jpeg({ quality: 92 }).toBuffer();
        console.log(`[DH/images] 阶段③ ✓ canvas=${W}x${H} fg=${fgW}x${fgH} pos=(${topPos},${leftPos}) hPct=${heightPct.toFixed(2)}`);
        const outName = `${filename}_composed.jpg`;
        const outPath = path.join(JIMENG_ASSETS_DIR, outName);
        fs.writeFileSync(outPath, composedBuf);
        filePath = outPath;
        composePath = 'two-stage-compose';
        attempts.push({ provider: 'two-stage-compose', ok: true, stage1: path.basename(stage1Path) });
        console.log(`[DH/images] ✓ 两阶段合成完成: ${outName}`);
      } catch (composeErr) {
        composeStageError = `${stageMark}: ${composeErr.message}`;
        console.error(`[DH/images] 两阶段合成失败 @ ${composeStageError}`);
        attempts.push({ provider: 'two-stage-compose', ok: false, stage: stageMark, error: composeErr.message });
        // 不再静默 fallback 单阶段：背景换不上来对 UX 有误导
        return res.status(500).json({
          success: false,
          error: `自定义背景合成失败 @ ${stageMark}: ${composeErr.message}`,
          hint: stageMark === 'stage2-baidu-matting'
            ? '百度抠像失败 — 检查 settings 里 baidu-aip provider 的 api_key 是否填对（格式 API_KEY:SECRET_KEY）'
            : '请重试或换一张背景图',
          attempts,
        });
      }
    }

    // 单阶段（无自定义背景，或两阶段失败 fallback）
    if (!filePath) {
      try {
        console.log('[DH/images] 尝试 deyunai 漫路 nano-banana (单阶段)...');
        filePath = await _generateViaDeyunaiNanoBanana({
          prompt, aspectRatio, filename,
          destDir: JIMENG_ASSETS_DIR,
          referenceImages: bgRef ? [bgRef] : [],  // fallback: 还是把 bg 当 ref 试一下
        });
        attempts.push({ provider: 'deyunai-nano-banana', ok: true, bgRef: !!bgRef });
      } catch (e1) {
        console.warn('[DH/images] nano-banana 失败:', e1.message);
        attempts.push({ provider: 'deyunai-nano-banana', ok: false, error: e1.message });
        lastError = e1;
        try {
          console.log('[DH/images] fallback 火山 Seedream...');
          filePath = await avatarService._arkSeedreamGenerate({
            prompt, aspectRatio, filename,
            watermark: false, cropBottomPx: 100, destDir: JIMENG_ASSETS_DIR,
          });
          attempts.push({ provider: 'volces-seedream', ok: true });
        } catch (e2) {
          attempts.push({ provider: 'volces-seedream', ok: false, error: e2.message });
          lastError = e2;
        }
      }
    }

    if (!filePath) {
      const msg = '所有图像 provider 失败：' + attempts.map(a => `${a.provider}=${a.error || 'ok'}`).join('；');
      throw new Error(msg);
    }

    const imgName = path.basename(filePath);
    const imageUrl = `${baseUrl}/public/jimeng-assets/${imgName}`;
    console.log('[DH/images] 全链路:', JSON.stringify(attempts));
    res.json({ success: true, imageUrl, filename: imgName });
  } catch (err) {
    const detail = err.response?.data
      ? (typeof err.response.data === 'object' ? (err.response.data.error?.message || err.response.data.message || JSON.stringify(err.response.data).slice(0, 300)) : String(err.response.data).slice(0, 300))
      : null;
    const msg = detail ? `${detail}` : err.message;
    console.error('[DH] generate image 失败:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

// ═══════════════════════════════════════════════
// Step 1 · POST /api/dh/images/detect-gender
//   body: { imageUrl }  → { gender: 'male'|'female'|'unknown' }
//   使用多模态 LLM（优先 zhipu glm-4v，回退 openai gpt-4o-mini）识别图中人物性别
// ═══════════════════════════════════════════════
router.post('/images/detect-gender', async (req, res) => {
  try {
    const { imageUrl } = req.body || {};
    if (!imageUrl) return res.status(400).json({ success: false, error: 'imageUrl 必填' });

    // 同源图转成本地文件，再 base64（避免外网模型回拉走 IP/鉴权）
    let b64 = null, mime = 'image/jpeg';
    try {
      const base = _publicBaseUrl(req);
      let localPath = null;
      if (imageUrl.startsWith(base) || imageUrl.startsWith('/public/jimeng-assets/')) {
        const name = path.basename(imageUrl.split('?')[0]);
        localPath = path.join(JIMENG_ASSETS_DIR, name);
      }
      if (localPath && fs.existsSync(localPath)) {
        b64 = fs.readFileSync(localPath).toString('base64');
        if (/\.png$/i.test(localPath)) mime = 'image/png';
        else if (/\.webp$/i.test(localPath)) mime = 'image/webp';
      } else {
        const r = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 15000 });
        b64 = Buffer.from(r.data).toString('base64');
        mime = r.headers['content-type'] || 'image/jpeg';
      }
    } catch (e) {
      return res.status(400).json({ success: false, error: '图片加载失败: ' + e.message });
    }

    const { loadSettings, getApiKey } = require('../services/settingsService');
    const settings = loadSettings();

    // 优先顺序：zhipu glm-4v > openai gpt-4o-mini
    const tryProvider = async (keywords, model, payloadBuilder) => {
      const prov = (settings.providers || []).find(p => {
        const hay = ((p.id || '') + '|' + (p.preset || '') + '|' + (p.name || '')).toLowerCase();
        return keywords.some(k => hay.includes(k)) && p.api_key && p.enabled;
      });
      if (!prov) return null;
      const key = getApiKey(prov.id);
      if (!key) return null;
      const baseUrl = prov.base_url || (prov.preset === 'zhipu' ? 'https://open.bigmodel.cn/api/paas/v4' : 'https://api.openai.com/v1');
      try {
        const r = await axios.post(`${baseUrl}/chat/completions`, payloadBuilder(model), {
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          timeout: 30000,
        });
        return r.data?.choices?.[0]?.message?.content || '';
      } catch (e) {
        console.warn(`[detect-gender] ${prov.id} 失败:`, e.response?.data?.error?.message || e.message);
        return null;
      }
    };

    const promptText = '请看这张照片，判断其中主要人物的性别。只回答以下三个词之一：male / female / unknown。不要加任何解释。';
    const imgDataUrl = `data:${mime};base64,${b64}`;

    let reply = null;
    reply = await tryProvider(['zhipu', '智谱'], 'glm-4v-flash', (model) => ({
      model,
      messages: [{ role: 'user', content: [
        { type: 'text', text: promptText },
        { type: 'image_url', image_url: { url: imgDataUrl } },
      ] }],
      temperature: 0,
    }));
    if (!reply) {
      reply = await tryProvider(['openai'], 'gpt-4o-mini', (model) => ({
        model,
        messages: [{ role: 'user', content: [
          { type: 'text', text: promptText },
          { type: 'image_url', image_url: { url: imgDataUrl } },
        ] }],
        max_tokens: 10,
        temperature: 0,
      }));
    }

    if (!reply) return res.json({ success: true, gender: 'unknown', note: '未配置多模态模型（zhipu/openai）' });
    const low = String(reply).toLowerCase();
    const gender = /female|女/.test(low) ? 'female' : /male|男/.test(low) ? 'male' : 'unknown';
    res.json({ success: true, gender, raw: reply.slice(0, 40) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// Step 1.bis · POST /api/dh/images/compose-scene
//   用户已上传一张「人物图」+ 一张「背景图」 → 合成
//   body: {
//     person_image_url, background_image_url,
//     aspectRatio?='9:16',
//     placement?='center'|'bottom'|'fit',
//     mode?='fast',                        // 上传真人照只允许保真抠像合成
//     person_height_pct?=0.8,              // 0.5-0.95
//   }
//   - 百度抠像 + sharp 合成（秒级、保留原人物）+ alpha 软边
//   - 禁止上传人物图进入 AI 生成/融合模型，避免身份和长相被重绘
//   return: { success, imageUrl, filename, mode }
// ═══════════════════════════════════════════════
router.post('/images/compose-scene', async (req, res) => {
  try {
    const {
      person_image_url, background_image_url,
      aspectRatio = '9:16',
      placement = 'center',
      mode = 'fast',
      person_height_pct,
    } = req.body || {};
    if (!person_image_url) return res.status(400).json({ success: false, error: '缺少 person_image_url' });
    if (!background_image_url) return res.status(400).json({ success: false, error: '缺少 background_image_url' });
    if (mode && mode !== 'fast') {
      console.warn(`[DH/compose-scene] ignore unsafe upload compose mode=${mode}; force fast matting compose`);
    }

    // ─── 上传人物 + 上传背景：只走百度抠像 + sharp，绝不 fallback 到 AI 重绘 ───
    const sharp = require('sharp');
    const baiduMatting = require('../services/baiduMattingService');

    let stage = 'fetch-images';
    try {
      const [personBuf, bgBuf] = await Promise.all([
        _fetchImageBuffer(person_image_url),
        _fetchImageBuffer(background_image_url),
      ]);

      stage = 'baidu-matting';
      console.log('[DH/compose-scene] 百度 body_seg 抠人物…');
      const fgPng = await baiduMatting.segmentFrame(personBuf, 'foreground');

      stage = 'sharp-compose';
      const sizeMap = { '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [1024, 1024], '3:4': [768, 1024], '4:3': [1024, 768] };
      const [W, H] = sizeMap[aspectRatio] || [1024, 1024];
      const bgResized = await sharp(bgBuf)
        .resize(W, H, { fit: 'cover' })
        .modulate({ brightness: 0.98, saturation: 0.96 })
        .toBuffer();

      // ① trim 去透明边
      const trimmed = await sharp(fgPng).trim({ threshold: 1 }).toBuffer();
      const tMeta = await sharp(trimmed).metadata();

      // ② alpha 软边（高斯模糊 alpha 通道 1.1px → 提取 + 模糊 + 合回）
      // 把硬抠边变成细微过渡，避开"一刀切"的贴纸感。
      let softened = trimmed;
      try {
        const alpha = await sharp(trimmed).extractChannel(3).blur(1.1).toBuffer();
        softened = await sharp(trimmed).removeAlpha().joinChannel(alpha).png().toBuffer();
      } catch (softErr) {
        console.warn('[DH/compose-scene] alpha 软边失败，用硬边继续:', softErr.message);
      }

      // ③ 决定人物大小：默认更克制，脚部贴底，避免漂浮在背景中间。
      const heightPct = (typeof person_height_pct === 'number' && person_height_pct >= 0.4 && person_height_pct <= 0.98)
        ? person_height_pct
        : (placement === 'fit' ? 0.88 : 0.76);
      const requestedH = Math.round(H * heightPct);
      const maxUpscale = placement === 'fit' ? 2.05 : 1.85;
      const targetH = Math.min(requestedH, Math.round(tMeta.height * maxUpscale));
      const scale = targetH / tMeta.height;
      let fgW = Math.round(tMeta.width * scale);
      let fgH = targetH;
      const maxW = Math.round(W * 0.92);
      if (fgW > maxW) {
        const s2 = maxW / tMeta.width;
        fgW = Math.round(tMeta.width * s2);
        fgH = Math.round(tMeta.height * s2);
      }
      const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
      let foreground = softened;
      try {
        const [bgStats, fgStats] = await Promise.all([
          sharp(bgResized)
            .extract({
              left: Math.round(W * 0.18),
              top: Math.round(H * 0.18),
              width: Math.round(W * 0.64),
              height: Math.round(H * 0.64),
            })
            .stats(),
          sharp(softened).removeAlpha().stats(),
        ]);
        const lum = (s) => 0.2126 * s.channels[0].mean + 0.7152 * s.channels[1].mean + 0.0722 * s.channels[2].mean;
        const bgLum = lum(bgStats);
        const fgLum = lum(fgStats);
        const brightness = clamp((bgLum / Math.max(1, fgLum)) * 0.96, 0.82, 1.12);
        const saturation = clamp((bgStats.channels[0].stdev + bgStats.channels[1].stdev + bgStats.channels[2].stdev)
          / Math.max(1, (fgStats.channels[0].stdev + fgStats.channels[1].stdev + fgStats.channels[2].stdev)) * 0.95, 0.82, 1.08);
        foreground = await sharp(softened)
          .modulate({ brightness, saturation })
          .sharpen({ sigma: 0.45, m1: 0.35, m2: 0.25 })
          .png()
          .toBuffer();
      } catch (toneErr) {
        console.warn('[DH/compose-scene] 色调匹配失败，用原人物继续:', toneErr.message);
      }

      const fgScaled = await sharp(foreground)
        .resize(fgW, fgH, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .sharpen({ sigma: 0.55, m1: 0.45, m2: 0.35 })
        .png()
        .toBuffer();
      const left = Math.round((W - fgW) / 2);
      const bottomMargin = placement === 'fit' ? 0 : Math.round(H * 0.025);
      const top = Math.max(0, H - fgH - bottomMargin);

      const shadowAlpha = await sharp(fgScaled)
        .extractChannel(3)
        .blur(Math.max(8, Math.round(W * 0.018)))
        .linear(0.18, 0)
        .toBuffer();
      const dropShadow = await sharp({
        create: { width: fgW, height: fgH, channels: 3, background: { r: 0, g: 0, b: 0 } },
      }).joinChannel(shadowAlpha).png().toBuffer();
      const contactShadowSvg = Buffer.from(`
        <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
          <filter id="b"><feGaussianBlur stdDeviation="${Math.max(10, W * 0.02)}"/></filter>
          <ellipse cx="${left + fgW / 2}" cy="${Math.min(H - 8, top + fgH - H * 0.015)}"
            rx="${Math.max(36, fgW * 0.34)}" ry="${Math.max(12, H * 0.018)}"
            fill="rgba(0,0,0,0.20)" filter="url(#b)"/>
        </svg>`);
      const edgeWrap = await sharp(fgScaled)
        .extractChannel(3)
        .blur(6)
        .threshold(10)
        .linear(0.025, 0)
        .toBuffer()
        .then(alpha => sharp({
          create: { width: fgW, height: fgH, channels: 3, background: { r: 210, g: 190, b: 160 } },
        }).joinChannel(alpha).png().toBuffer());

      const composed = await sharp(bgResized).composite([
        { input: contactShadowSvg, top: 0, left: 0, blend: 'over' },
        { input: dropShadow, top: Math.min(H - fgH, top + Math.round(H * 0.012)), left: clamp(left + Math.round(W * 0.012), 0, W - fgW), blend: 'over' },
        { input: edgeWrap, top, left, blend: 'screen' },
        { input: fgScaled, top, left, blend: 'over' },
      ]).jpeg({ quality: 93, chromaSubsampling: '4:4:4' }).toBuffer();

      stage = 'write-output';
      const filename = `dh_compose_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      const outPath = path.join(JIMENG_ASSETS_DIR, filename);
      fs.writeFileSync(outPath, composed);

      const baseUrl = _publicBaseUrl(req);
      console.log(`[DH/compose-scene] ✓ ${filename} (canvas=${W}x${H}, fg=${fgW}x${fgH}, top=${top}, left=${left}, hPct=${heightPct.toFixed(2)})`);
      res.json({
        success: true,
        imageUrl: `${baseUrl}/public/jimeng-assets/${filename}`,
        filename,
        mode: 'fast',
        identity_preserved: true,
        ai_generation_used: false,
      });
    } catch (err) {
      const msg = `合成失败 @ ${stage}: ${err.message}`;
      console.error('[DH/compose-scene]', msg);
      const hint = stage === 'baidu-matting'
        ? '百度抠像失败 — 检查 settings 里 baidu-aip provider 的 api_key（格式 API_KEY:SECRET_KEY）'
        : (stage === 'fetch-images' ? '图片 URL 拉取失败 — 检查 URL 是否对外可访问' : '请重试或换图');
      res.status(500).json({ success: false, error: msg, stage, hint });
    }
  } catch (outer) {
    res.status(500).json({ success: false, error: outer.message });
  }
});

// ═══════════════════════════════════════════════
// Step 1 · POST /api/dh/images/upload
//   form-data: image
//   return: { imageUrl, filename }
// ═══════════════════════════════════════════════
router.post('/images/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请选择图片' });
    const ext = path.extname(req.file.originalname || '').toLowerCase() || '.png';
    const dstName = `dh_upload_${uuidv4()}${ext}`;
    const dstPath = path.join(JIMENG_ASSETS_DIR, dstName);
    fs.copyFileSync(req.file.path, dstPath);
    try { fs.unlinkSync(req.file.path); } catch {}
    const baseUrl = _publicBaseUrl(req);
    res.json({ success: true, imageUrl: `${baseUrl}/public/jimeng-assets/${dstName}`, filename: dstName });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// Step 2 · 我的形象 CRUD（落 portrait_db, kind='digital_human'）
// ═══════════════════════════════════════════════

// GET /api/dh/my-avatars
router.get('/my-avatars', (req, res) => {
  try {
    const all = db.listPortraits(scopeUserId(req));
    const dh = all.filter(p => p.kind === 'digital_human');
    res.json({ success: true, data: dh });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dh/my-avatars/:id
router.get('/my-avatars/:id', (req, res) => {
  const p = db.getPortrait(req.params.id);
  if (!p || p.kind !== 'digital_human' || !ownedBy(req, p)) {
    return res.status(404).json({ success: false, error: '形象不存在' });
  }
  res.json({ success: true, data: p });
});

// POST /api/dh/my-avatars
//   body: { name, imageUrl, sampleVideoUrl?, gender?, style?, tags?, source? }
router.post('/my-avatars', (req, res) => {
  try {
    const { name, imageUrl, sampleVideoUrl = null, gender = '', style = '', tags = [], source = 'generate', description = '', avatar_type = 'normal', product = null } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ success: false, error: '请输入形象名称' });
    if (!imageUrl) return res.status(400).json({ success: false, error: '缺少图片' });

    const id = uuidv4();
    const row = {
      id,
      user_id: req.user?.id || null,
      name: name.trim(),
      kind: 'digital_human',
      image_url: imageUrl,
      photo_url: imageUrl,  // 兼容 portrait 表老字段
      sample_video_url: sampleVideoUrl, // 动态预览 5-8s 样片（可选）
      gender,
      style,
      avatar_type: avatar_type === 'product' ? 'product' : 'normal',
      type: avatar_type === 'product' ? 'product' : 'normal',
      product: product || null,
      product_image_url: product?.image_url || '',
      product_image_name: product?.image_name || '',
      product_cutout_url: product?.cutout_url || product?.cutoutUrl || product?.prepared_url || product?.preparedUrl || '',
      topview_product_image_id: product?.topview_image_id || product?.topviewImageId || product?.topview?.imageId || '',
      topview_product_task_id: product?.topview_task_id || product?.topviewTaskId || product?.topview?.taskId || '',
      tags: Array.isArray(tags) ? tags : [],
      source,                // 'generate' | 'upload'
      description,
      status: 'done',        // 数字人形象不走 2D/3D 生成，直接标完成
      progress: 100,
      message: '已保存',
    };
    db.insertPortrait(row);
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// Step 1.5 · 动态预览样片（5-8 秒 Jimeng Omni 驱动测试）
//   用户上传/生成图后，马上跑一次 Jimeng Omni 用短招呼语（"你好，我是..."）
//   出一段小视频让用户验证这张脸真的能被驱动、效果是否满意
// ═══════════════════════════════════════════════

// POST /api/dh/samples/generate
//   body: { image_url, sample_text? }
//   → { taskId }  （复用 /api/avatar/jimeng-omni/tasks/:id 查进度）
router.post('/samples/generate', async (req, res) => {
  try {
    const { image_url, sample_text } = req.body || {};
    if (!image_url) return res.status(400).json({ success: false, error: 'image_url 必填' });

    const text = (sample_text?.trim()) || '大家好，我是你的 AI 数字人，很高兴为你服务';

    const base = _publicBaseUrl(req);
    const resp = await axios.post(`${base}/api/avatar/jimeng-omni/generate`, {
      image_url,
      text,
      speed: 1.0,
      title: '[预览样片]',
      kind: 'sample',
    }, {
      headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
      timeout: 30000,
    });

    if (!resp.data?.success) {
      return res.status(500).json({ success: false, error: resp.data?.error || '提交样片失败' });
    }
    res.json({ success: true, taskId: resp.data.taskId, sample_text: text });
  } catch (err) {
    const e = err.response?.data?.error || err.message;
    console.error('[DH] samples/generate 失败:', e);
    res.status(500).json({ success: false, error: e });
  }
});

// GET /api/dh/samples/:taskId — 样片任务进度（代理到 jimeng-omni）
router.get('/samples/:taskId', async (req, res) => {
  try {
    const base = _publicBaseUrl(req);
    const r = await axios.get(`${base}/api/avatar/jimeng-omni/tasks/${req.params.taskId}`, {
      headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
      timeout: 10000,
    });
    res.json(r.data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dh/my-avatars/:id/thumbnail — 抽取 sample_video_url 首帧作为封面
//   公开端点（<video poster> 不能带 token），portrait id 是 uuid 不可枚举
router.get('/my-avatars/:id/thumbnail', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const ffmpegService = require('../services/ffmpegService');
    const p = db.getPortrait(req.params.id);
    if (!p) return res.status(404).end();
    const sample = p.sample_video_url || '';
    if (!sample) return res.status(204).end();
    // 优先用 portrait 自带的 image_url（已经是图）
    if (p.image_url && p.image_url.startsWith('/public/')) {
      const local = path.resolve(__dirname, '../..' + p.image_url);
      if (fs.existsSync(local)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return fs.createReadStream(local).pipe(res);
      }
    }
    // 找本地视频文件抽帧
    let localVideo = null;
    if (sample.includes('/public/jimeng-assets/')) {
      const name = path.basename(sample.split('?')[0]);
      const candidate = path.resolve(__dirname, '../../outputs/jimeng-assets', name);
      if (fs.existsSync(candidate)) localVideo = candidate;
    }
    if (!localVideo) return res.status(204).end();

    const thumbPath = localVideo.replace(/\.(mp4|mov|webm|mkv)$/i, '') + '.thumb.jpg';
    const send = () => {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      fs.createReadStream(thumbPath).pipe(res);
    };
    if (fs.existsSync(thumbPath)) return send();
    try {
      await ffmpegService.extractFirstFrame(localVideo, thumbPath, { atSec: 0.5, width: 480 });
      send();
    } catch (e) {
      console.warn('[DH/avatar-thumb] 抽帧失败:', e.message);
      res.status(204).end();
    }
  } catch (err) {
    console.warn('[DH/avatar-thumb] err:', err.message);
    res.status(500).end();
  }
});

// PATCH /api/dh/my-avatars/:id — 改名/附样片
router.patch('/my-avatars/:id', (req, res) => {
  const p = db.getPortrait(req.params.id);
  if (!p || p.kind !== 'digital_human' || !ownedBy(req, p)) {
    return res.status(404).json({ success: false, error: '形象不存在' });
  }
  const fields = {};
  ['name', 'gender', 'tags', 'description', 'sample_video_url',
   'sample_task_id', 'sample_status', 'sample_started_at'].forEach(k => {
    if (req.body?.[k] !== undefined) fields[k] = req.body[k];
  });
  // 当 sample_video_url 写入成功，自动清掉生成中标记
  if (req.body?.sample_video_url) {
    fields.sample_status = 'done';
    fields.sample_task_id = null;
  }
  db.updatePortrait(req.params.id, fields);
  res.json({ success: true });
});

// POST /api/dh/my-avatars/:id/promote-to-video
//   对已有图片素材（image-only）触发 Jimeng Omni 样片生成，完成后回写 sample_video_url
//   → 返回 { taskId }，前端用 /api/dh/samples/:taskId 轮询；完成后前端 PATCH /my-avatars/:id
router.post('/my-avatars/:id/promote-to-video', async (req, res) => {
  try {
    const p = db.getPortrait(req.params.id);
    if (!p || p.kind !== 'digital_human' || !ownedBy(req, p)) {
      return res.status(404).json({ success: false, error: '形象不存在' });
    }
    if (!p.image_url) return res.status(400).json({ success: false, error: '该形象缺少图片' });

    const base = _publicBaseUrl(req);
    const resp = await axios.post(`${base}/api/dh/samples/generate`, {
      image_url: p.image_url,
    }, {
      headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
      timeout: 30000,
    });
    if (!resp.data?.success) return res.status(500).json({ success: false, error: resp.data?.error || '提交失败' });
    res.json({ success: true, taskId: resp.data.taskId, avatar_id: req.params.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.response?.data?.error || err.message });
  }
});

// ═══════════════════════════════════════════════
// 双人 · AI 智能生成两位主持人（一次调 Seedream 两次，得 2 个形象并自动存库）
//   body: { gender_combo: 'mf'|'mm'|'ff', age: '青年'|'中年'|'老年', description, brand? }
// ═══════════════════════════════════════════════
router.post('/dual/generate-hosts', async (req, res) => {
  try {
    const { gender_combo = 'mf', age = '青年', description = '', brand = '' } = req.body || {};
    const genderMap = { mf: ['male', 'female'], mm: ['male', 'male'], ff: ['female', 'female'] };
    const [g1, g2] = genderMap[gender_combo] || genderMap.mf;
    const ageMap = { '青年': 'young adult', '中年': 'middle-aged', '老年': 'elderly with gentle wisdom' };
    const ageEn = ageMap[age] || 'young adult';

    const baseUrl = _publicBaseUrl(req);
    const makePrompt = (g) => {
      const gStr = g === 'male' ? `handsome ${ageEn} man` : `beautiful ${ageEn} woman`;
      return `professional podcast host, photograph of one single ${gStr}, sitting on a cozy warm-lit sofa in a modern home lounge — visible background: bookshelves, soft warm lighting, coffee mug on side table, blurred decor — confident friendly expression, smart casual clothing${brand ? `, subtle brand element: ${brand}` : ''}, ${description ? `. creative direction: ${description}` : ''}, DSLR 85mm f/2.0, magazine cover quality, waist-up, ABSOLUTELY ONE SINGLE PERSON, no duplicates, natural podcast-host look`;
    };

    // 并行生成 2 张
    const nameBase = (description || '主持人').slice(0, 12);
    const [p1, p2] = await Promise.all([
      avatarService._arkSeedreamGenerate({
        prompt: makePrompt(g1), aspectRatio: '9:16',
        filename: `dh_host1_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        watermark: false, cropBottomPx: 100, destDir: JIMENG_ASSETS_DIR,
      }),
      avatarService._arkSeedreamGenerate({
        prompt: makePrompt(g2), aspectRatio: '9:16',
        filename: `dh_host2_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        watermark: false, cropBottomPx: 100, destDir: JIMENG_ASSETS_DIR,
      }),
    ]);
    const img1Url = `${baseUrl}/public/jimeng-assets/${path.basename(p1)}`;
    const img2Url = `${baseUrl}/public/jimeng-assets/${path.basename(p2)}`;

    // 落库 2 个 portrait
    const makeRow = (name, imageUrl, gender) => {
      const id = uuidv4();
      const row = {
        id, user_id: req.user?.id || null, name, kind: 'digital_human',
        image_url: imageUrl, photo_url: imageUrl, sample_video_url: null,
        gender, style: 'podcast_host', tags: ['dual', 'host'],
        source: 'dual_generate', description, status: 'done', progress: 100, message: '已保存',
      };
      db.insertPortrait(row);
      return row;
    };

    const a = makeRow(`${nameBase}·A`, img1Url, g1);
    const b = makeRow(`${nameBase}·B`, img2Url, g2);
    res.json({ success: true, hostA: a, hostB: b });
  } catch (err) {
    console.error('[DH/dual/hosts] 失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// 双人 · AI 辅助生成剧本（给定主题 + 两位主持人 → 输出 A:/B: 对白）
//   body: { topic, duration_sec?, style?, tone? }
// ═══════════════════════════════════════════════
router.post('/dual/write-script', async (req, res) => {
  try {
    const { topic, duration_sec = 60, style = 'podcast', tone = '轻松专业' } = req.body || {};
    if (!topic?.trim()) return res.status(400).json({ success: false, error: '请输入主题' });

    const targetChars = Math.round(duration_sec * 4);
    const { callLLM } = require('../services/storyService');
    const sys = `你是专业播客剧本撰写助手，为"双人对话数字人"写 A/B 两位主持人的对白。输出必须严格用以下格式（每行一句）：
A: xxx
B: xxx
A: xxx
...
不要输出任何其他说明/引号/标题。`;
    const user = `主题：${topic}
风格：${style === 'podcast' ? '播客访谈' : style}
语气：${tone}
目标时长：约 ${duration_sec} 秒（中文约 ${targetChars} 字）

要求：
1. 严格 A:/B: 交替，A 先开场
2. 每句 15-30 字（播客自然节奏）
3. 总字数 ${targetChars - 20} ~ ${targetChars + 20}
4. 结构：A 开场问候 → B 回应 → A 抛主题 → B 展开 → A 提问 → B 总结 → A 结尾
5. 不要加括号注释、表情、表演提示
6. 只输出 A:/B: 对白行，不要其他内容`;

    const text = await callLLM(sys, user, { kb: { scene: 'dual_podcast', query: topic.slice(0, 120), limit: 2 } });
    const cleaned = text.split(/\n/).filter(l => /^\s*[AB]\s*[:：]/.test(l)).join('\n');
    res.json({ success: true, script: cleaned, char_count: cleaned.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/dh/my-avatars/:id
router.delete('/my-avatars/:id', (req, res) => {
  const p = db.getPortrait(req.params.id);
  if (!p || p.kind !== 'digital_human' || !ownedBy(req, p)) {
    return res.status(404).json({ success: false, error: '形象不存在' });
  }
  db.deletePortrait(req.params.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
// Step 3 · POST /api/dh/scripts/write
//   body: { topic, duration_sec?, style?, tone? }
//   return: { text, duration_sec, char_count }
// —— 薄封装：复用 storyService.callLLM
// ═══════════════════════════════════════════════
router.post('/scripts/write', async (req, res) => {
  try {
    const { topic, duration_sec = 30, style = 'tutorial', tone = '亲切自然', mode = 'script', product = null } = req.body || {};
    if (!topic?.trim()) return res.status(400).json({ success: false, error: '请输入主题' });

    const targetChars = Math.round(duration_sec * 4);  // 中文约 4 字/秒
    const { callLLM } = require('../services/storyService');

    const styleHint = {
      tutorial: '教程讲解（问题 → 方法 → 效果）',
      promo:    '产品推广（痛点 → 亮点 → 行动号召）',
      story:    '故事叙述（悬念 → 发展 → 感悟）',
      knowledge:'知识分享（好奇 → 知识 → 建议）',
      news:     '新闻播报（导入 → 事件 → 观点）',
      daily:    '日常分享（自然口语）',
    }[style] || '口播自然风格';

    const isProduct = mode === 'product' && product?.name;
    const isSpace = mode === 'space';
    const sysPrompt = isProduct
      ? `你是专业电商商品数字人口播策划。输出内容必须可直接被 TTS 朗读，适合真人数字人边展示商品边讲解。`
      : isSpace
        ? `你是专业空间导览数字人口播策划。输出内容必须可直接被 TTS 朗读，像真实导览员一样有停顿、强调和情绪起伏。`
        : `你是专业的短视频口播稿撰写助手。输出内容必须可直接被 TTS 朗读。`;
    const userPrompt = isProduct ? `商品名称：${product.name}
商品场景/口播重点：${topic}
目标人群：${product.audience || '未指定'}
核心卖点：${product.selling_points || '未指定'}
优惠/行动号召：${product.offer || '未指定'}
展示动作偏好：${product.motion_style || 'hold'}
商品素材：${product.image_url ? `已上传（${product.image_name || '商品图'}）` : '未上传'}
目标时长：约 ${duration_sec} 秒（中文约 ${targetChars} 字）

要求：
1. 输出一段连贯电商口播稿，只输出正文，不要标题/编号/括号注释
2. 结构必须是：3 秒痛点钩子 → 商品亮点 → 使用场景/信任理由 → 行动号召
3. 必须自然提到商品名和核心卖点，不要夸大医疗、金融、绝对化效果
4. 句子短促易读，适合数字人边手持/指向/展示商品边说；如果已上传商品素材，要自然引导观众看画面中的商品卡片
5. 字数控制在 ${targetChars - 10} ~ ${targetChars + 10} 之间`
      : isSpace ? `空间/场景信息：${topic}
语气：${tone}
目标时长：约 ${duration_sec} 秒（中文约 ${targetChars} 字）

要求：
1. 输出一段连贯空间导览口播稿，只输出正文，不要标题、编号、括号注释
2. 结构必须是：开场引入 → 讲空间/材质/灯光亮点 → 引导观众看右侧展示区 → 收束一句记忆点
3. 根据输入自行判断场景，不要局限在展厅/门店/样板间几个固定类型
4. 句子要短，适合后续拆分；每 1-2 句就有一个自然停顿，语气要有起伏，不要全程平铺直叙
5. 字数控制在 ${targetChars - 10} ~ ${targetChars + 10} 之间`
      : `主题：${topic}
风格：${styleHint}
语气：${tone}
目标时长：约 ${duration_sec} 秒（中文约 ${targetChars} 字）

要求：
1. 输出一段连贯口播稿，只输出正文，不要加引号/标题/"以下是"等说明
2. 字数控制在 ${targetChars - 10} ~ ${targetChars + 10} 之间
3. 句子短促易读，多用标点分割呼吸节点
4. 不要包含数字人无法读出的内容（括号注释、表情符号等）`;

    let text = (await callLLM(sysPrompt, userPrompt, {
      kb: { scene: 'avatar_script', query: topic.slice(0, 120), limit: 2 },
    })).trim();
    text = text.replace(/^["“”'`]+|["“”'`]+$/g, '').replace(/\s+/g, '');
    const maxChars = Math.max(10, targetChars + 6);
    if (text.length > maxChars) {
      const clipped = text.slice(0, maxChars);
      const cut = Math.max(
        clipped.lastIndexOf('。'),
        clipped.lastIndexOf('！'),
        clipped.lastIndexOf('？'),
        clipped.lastIndexOf('，')
      );
      text = (cut >= targetChars - 8 ? clipped.slice(0, cut + 1) : clipped).trim();
    }

    res.json({
      success: true,
      text,
      duration_sec,
      char_count: text.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// Step 3 · POST /api/dh/scripts/segment
//   body: { text }
//   return: { segments: [{text, start, end, expression, motion, char_count}] }
// —— 直接转发到 /api/avatar/segment-script 逻辑，加上 start/end 时间戳
// ═══════════════════════════════════════════════
router.post('/scripts/segment', async (req, res) => {
  try {
    const { text, target_duration_sec = null } = req.body || {};
    if (!text || text.trim().length < 10) {
      return res.status(400).json({ success: false, error: '文本过短' });
    }

    const targetDuration = Math.max(5, Math.min(180, Math.round(Number(target_duration_sec) || Math.ceil(text.trim().length / 4))));
    const { callLLM } = require('../services/storyService');
    const sysPrompt = `你是专业视频口播分段师。按自然语义/呼吸节点拆分，总时长必须严格等于 ${targetDuration} 秒。
输出严格 JSON 数组，每项：{"text":"...","expression":"natural|smile|serious|excited|calm|thoughtful|surprised|concerned|confident|friendly|focused|moved","tone":"natural|calm|serious|excited|encouraging|warm|firm|curious|confident|gentle|urgent|humorous","motion":"英文动作描述","camera":"static|push_in|pull_back|pan_product|close_up|handheld"}
不要输出其他任何内容。`;
    const userPrompt = `台词：\n${text}\n\n目标总时长：${targetDuration} 秒。请按语义拆成适合 ${targetDuration} 秒内讲完的段落，直接输出 JSON 数组。`;
    const out = await callLLM(sysPrompt, userPrompt);

    let raw;
    try {
      const m = out.match(/\[[\s\S]*\]/);
      raw = JSON.parse(m ? m[0] : out);
    } catch {
      raw = text.match(/[^。！？\n]+[。！？]?/g)
        ?.filter(s => s.trim().length > 5)
        ?.map(s => ({ text: s.trim(), expression: 'natural', tone: 'natural', motion: 'natural speaking with subtle head movements', camera: 'static' })) || [];
    }
    raw = (Array.isArray(raw) ? raw : []).filter(seg => seg && String(seg.text || '').trim()).map(seg => ({ ...seg, text: String(seg.text || '').trim() }));
    if (!raw.length) raw = [{ text: text.trim(), expression: 'natural', tone: 'natural', motion: 'natural speaking' }];
    if (raw.length > targetDuration) {
      const merged = raw.slice(0, targetDuration).map(x => ({ ...x }));
      for (let i = targetDuration; i < raw.length; i++) {
        merged[merged.length - 1].text += raw[i].text;
      }
      raw = merged;
    }

    // 加时间戳：严格按目标总时长分配，最终 end 必须等于 targetDuration。
    let cursor = 0;
    const totalChars = raw.reduce((sum, seg) => sum + Math.max(1, (seg.text || '').length), 0) || 1;
    const segments = raw.map((seg, i) => {
      const chars = (seg.text || '').length;
      let dur = i === raw.length - 1 ? (targetDuration - cursor) : Math.max(1, Math.round(targetDuration * (Math.max(1, chars) / totalChars)));
      const remainingSlots = Math.max(0, raw.length - i - 1);
      dur = Math.max(1, Math.min(dur, targetDuration - cursor - remainingSlots));
      const s = cursor;
      cursor += dur;
      return {
        index: i,
        text: seg.text,
        expression: seg.expression || 'natural',
        tone: seg.tone || seg.delivery || seg.voice_tone || 'natural',
        motion: seg.motion || 'natural speaking',
        camera: seg.camera || 'static',
        start: s,
        end: cursor,
        char_count: chars,
      };
    });

    res.json({
      success: true,
      segments,
      total_duration: targetDuration,
      target_duration: targetDuration,
      total_chars: text.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// Space guide · POST /api/dh/spaces/generate
//   body: { avatar_id, background_url, text, voice_id?, title?, scene?, camera?, subtitle? }
//   Builds a 16:9 docent keyframe first, then drives it through the existing digital-human video chain.
// ═══════════════════════════════════════════════
function _fallbackSpaceAdStoryboard({ title = '广告数字人', text = '', durationSec = 30, segments = [] }) {
  const source = Array.isArray(segments) && segments.length
    ? segments
    : _fallbackGuideSegments(text, Math.max(12, Number(durationSec) || 30));
  const picked = source.slice(0, 4);
  const labels = ['开场钩子', '场景亮点', '卖点讲解', '行动引导'];
  const roles = ['hook', 'display', 'benefit', 'cta'];
  return picked.map((seg, i) => ({
    title: labels[i] || `镜头 ${i + 1}`,
    role: roles[i] || 'display',
    duration: Math.max(3, Math.min(6, Math.round(Number(seg.end) - Number(seg.start) || (Number(durationSec) || 24) / picked.length))),
    voiceover: String(seg.text || '').trim(),
    visual_prompt: [
      `A controlled Image2-style keyframe for a realistic ${title} video.`,
      i === 0
        ? 'Presenter is visible in a clean advertising/showroom scene, looking confident at camera.'
        : i === picked.length - 1
          ? 'Presenter makes a clear closing gesture toward the display or product area.'
          : 'Presenter remains consistent while the display/background communicates the selling point.',
      'Use the uploaded presenter/avatar as the same person and the uploaded background as the exact advertising environment.',
      '16:9 cinematic composition, stable identity, natural commercial lighting.',
    ].join(' '),
    video_prompt: [
      i === 0 ? 'Slow confident opening shot with subtle push-in.' : '',
      i > 0 && i < picked.length - 1 ? 'Gentle camera move across the display area while presenter gestures naturally.' : '',
      i === picked.length - 1 ? 'Smooth closing shot, presenter faces camera and completes the call-to-action.' : '',
      'Keep presenter face identity, outfit and background stable. Natural hand gesture, no face morphing, no text overlay, no watermark.',
    ].filter(Boolean).join(' '),
  })).filter(x => x.voiceover || x.visual_prompt);
}

async function _buildSpaceAdStoryboard({ title, text, durationSec, segments, scenePrompt }) {
  const { callLLM } = require('../services/storyService');
  const target = Math.max(12, Math.min(40, Number(durationSec) || 30));
  const seedSegments = (Array.isArray(segments) && segments.length ? segments : _fallbackGuideSegments(text, target))
    .slice(0, 5)
    .map((s, i) => `${i + 1}. ${s.text}`)
    .join('\n');
  const sys = '你是短视频广告导演。你会把广告数字人口播文案拆成 Topview/Image2 + Seedance 风格的可控多关键帧广告分镜。只输出 JSON 数组。';
  const user = `标题：${title || '广告数字人'}
场景/背景要点：${scenePrompt || '根据上传背景自动识别'}
目标时长：${target} 秒
文案分段：
${seedSegments || text}

请输出 3-5 个镜头 JSON 数组。每项字段：
{
  "title": "短标题",
  "role": "hook|display|benefit|proof|cta",
  "duration": 3到6之间的整数,
  "voiceover": "对应这一镜头的中文口播",
  "visual_prompt": "英文首帧提示词，必须强调 same presenter identity 和 exact uploaded background",
  "video_prompt": "英文图生视频提示词，描述轻微镜头运动、自然手势、稳定口型"
}

要求：人物必须来自上传的数字人形象；背景必须来自上传广告背景；每个镜头只做一个动作或一个卖点，避免大幅度转身、换装、换脸、换场景。`;
  try {
    const out = await callLLM(sys, user);
    const scenes = _cleanJsonArray(out)
      .filter(x => x && x.visual_prompt && x.video_prompt)
      .slice(0, 5)
      .map((x, i) => ({
        title: String(x.title || `镜头 ${i + 1}`).slice(0, 20),
        role: ['hook', 'display', 'benefit', 'proof', 'cta'].includes(x.role) ? x.role : (i === 0 ? 'hook' : i === 3 ? 'cta' : 'display'),
        duration: Math.max(3, Math.min(6, Math.round(Number(x.duration) || target / 4))),
        voiceover: String(x.voiceover || '').trim(),
        visual_prompt: String(x.visual_prompt || '').trim(),
        video_prompt: String(x.video_prompt || '').trim(),
      }));
    if (scenes.length >= 3) return scenes;
  } catch (err) {
    console.warn('[DH/space-ad] storyboard fallback:', err.message);
  }
  return _fallbackSpaceAdStoryboard({ title, text, durationSec: target, segments });
}

function _spaceAdKeyframePrompt({ scene, title, text, scenePrompt }) {
  return [
    scene.visual_prompt,
    'Topview Image2-style controlled keyframe for an advertising digital human video.',
    'Reference 1 is the exact presenter/avatar. Preserve the same face identity, hairstyle, age, body type and outfit style across all keyframes.',
    'Reference 2 is the exact advertising background/display. Preserve the layout, product/display area, spatial perspective and lighting direction.',
    scenePrompt ? `Scene emphasis: ${scenePrompt}.` : '',
    text ? `Narration meaning for this shot: ${String(text).slice(0, 180)}.` : '',
    `Shot title: ${scene.title || title || '广告数字人'}.`,
    '16:9 realistic commercial frame, presenter naturally placed without covering the key display area, no extra people, no subtitles generated in image, no watermark.',
  ].filter(Boolean).join(' ');
}

async function _runSpaceStoryboardTask(req, taskId, payload) {
  const { avatar, backgroundUrl, text, voiceId, title, scenePrompt, durationSec, segments, subtitle } = payload;
  const taskDir = path.join(JIMENG_ASSETS_DIR, `digital_ad_${taskId}`);
  fs.mkdirSync(taskDir, { recursive: true });
  const base = _publicBaseUrl(req);
  try {
    _taskPatch(taskId, { status: 'running', stage: 'storyboard', progress: 8, message: '生成广告数字人分镜' });
    const guideSegments = Array.isArray(segments) && segments.length
      ? segments
      : _fallbackGuideSegments(text, Math.max(12, Number(durationSec) || Math.ceil(String(text).length / 4)));
    const scenes = await _buildSpaceAdStoryboard({ title, text, durationSec, segments: guideSegments, scenePrompt });
    _taskPatch(taskId, { scenes, progress: 15 });

    const refs = [
      await _resolveImageForExternalApi(req, avatar.image_url),
      await _resolveImageForExternalApi(req, backgroundUrl),
    ].filter(Boolean);
    const keyframes = [];
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      _taskPatch(taskId, { stage: 'keyframes', progress: 15 + Math.round((i / scenes.length) * 28), message: `生成广告首帧 ${i + 1}/${scenes.length}` });
      const keyframePath = await _generateViaDeyunaiNanoBanana({
        prompt: _spaceAdKeyframePrompt({ scene: sc, title, text: sc.voiceover || text, scenePrompt }),
        aspectRatio: '16:9',
        filename: `digital_ad_${taskId}_kf_${String(i + 1).padStart(2, '0')}`,
        destDir: JIMENG_ASSETS_DIR,
        referenceImages: refs,
      });
      const url = `${base}/public/jimeng-assets/${path.basename(keyframePath)}`;
      keyframes.push({ ...sc, image_url: url, local_path: keyframePath });
      _taskPatch(taskId, { keyframes, keyframeUrl: keyframes[0]?.image_url, image_url: keyframes[0]?.image_url, thumbnail_url: keyframes[0]?.image_url });
    }

    const { _seedanceAVGenerate } = require('../services/avatarService');
    const { apiKey, model } = _getSeedanceAdConfig();
    const clips = [];
    for (let i = 0; i < keyframes.length; i++) {
      const kf = keyframes[i];
      _taskPatch(taskId, { stage: 'video', progress: 45 + Math.round((i / keyframes.length) * 35), message: `生成广告镜头 ${i + 1}/${keyframes.length}` });
      const prompt = [
        kf.video_prompt,
        `Voiceover meaning: ${kf.voiceover || ''}`,
        'Keep the presenter identity, face, outfit and the background stable from the keyframe. Smooth natural talking gesture, subtle camera movement only, no face morphing, no scene replacement, no generated text.',
      ].join(' ');
      const { videoBuffer } = await _seedanceAVGenerate(
        kf.image_url,
        prompt,
        model,
        apiKey,
        info => _taskPatch(taskId, { message: info.message || `Seedance 广告镜头 ${i + 1}` }),
        { ratio: '16:9', duration: kf.duration || 4, hasAudio: false }
      );
      const clipPath = path.join(taskDir, `clip_${String(i + 1).padStart(2, '0')}.mp4`);
      fs.writeFileSync(clipPath, videoBuffer);
      clips.push(clipPath);
    }

    _taskPatch(taskId, { stage: 'post_effects', progress: 84, message: '平滑拼接广告镜头' });
    const concatPath = path.join(taskDir, 'digital_ad_concat.mp4');
    await _concatVideosSmooth(clips, concatPath, '16:9');
    const voiceover = keyframes.map(k => k.voiceover).filter(Boolean).join('') || text;
    let finalPath = concatPath;
    if (voiceover) {
      try {
        _taskPatch(taskId, { message: '合成广告口播音频' });
        const { generateSpeech } = require('../services/ttsService');
        const audioBase = path.join(taskDir, 'voiceover');
        const audioPath = await generateSpeech(voiceover, audioBase, { voiceId: voiceId || null, speed: 1.0 });
        const muxPath = path.join(taskDir, 'digital_ad_audio.mp4');
        await _muxAudio(concatPath, audioPath, muxPath);
        finalPath = muxPath;
      } catch (audioErr) {
        console.warn('[DH/space-ad] voiceover failed:', audioErr.message);
      }
    }

    if (subtitle?.show !== false && voiceover) {
      try {
        _taskPatch(taskId, { message: '烧录广告字幕' });
        const { applyEffects } = require('../services/effectsService');
        let cursor = 0;
        const texts = keyframes.filter(k => k.voiceover).map(k => {
          const startTime = cursor;
          cursor += Number(k.duration) || 4;
          return {
            text: k.voiceover,
            preset: 'subtitle',
            position: 'bottom',
            startTime,
            endTime: cursor,
            fontName: subtitle?.fontName || '抖音美好体',
            fontSize: subtitle?.fontSize || 64,
            color: subtitle?.color || '#FFFFFF',
            outlineColor: subtitle?.outlineColor || '#000000',
          };
        });
        const fx = await applyEffects({ videoPath: finalPath, texts });
        if (fx?.outputPath && fs.existsSync(fx.outputPath)) finalPath = fx.outputPath;
      } catch (fxErr) {
        console.warn('[DH/space-ad] subtitle failed:', fxErr.message);
      }
    }

    const taskData = {
      id: taskId,
      status: 'done',
      stage: 'done',
      title: title || '广告数字人',
      text: voiceover || text,
      scenes,
      keyframes: keyframes.map(k => ({ title: k.title, role: k.role, image_url: k.image_url, voiceover: k.voiceover })),
      videoPath: finalPath,
      videoUrl: `/api/avatar/tasks/${taskId}/stream`,
      video_url: `/api/avatar/tasks/${taskId}/stream`,
      image_url: keyframes[0]?.image_url || '',
      thumbnail_url: keyframes[0]?.image_url || '',
      keyframeUrl: keyframes[0]?.image_url || '',
      kind: 'production',
      mode: 'digital_ad',
      generation_mode: 'storyboard',
      user_id: productAdTasks.get(taskId)?.user_id,
      ratio: '16:9',
      model,
      created_at: productAdTasks.get(taskId)?.created_at || new Date().toISOString(),
    };
    productAdTasks.set(taskId, { ...productAdTasks.get(taskId), ...taskData, progress: 100, updated_at: new Date().toISOString() });
    if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
    else db.updateAvatarTask(taskId, taskData);
  } catch (err) {
    console.error('[DH/space-ad/storyboard] failed:', err);
    _taskPatch(taskId, { status: 'error', stage: 'error', error: err.message, message: err.message });
    try {
      if (!db.getAvatarTask(taskId)) {
        const t = productAdTasks.get(taskId);
        db.insertAvatarTask({ ...t, status: 'error', error: err.message, kind: 'production', mode: 'digital_ad', generation_mode: 'storyboard' });
      }
    } catch {}
  }
}

async function _runSpaceGuideTask(req, taskId, payload) {
  const { avatar, backgroundUrl, text, voiceId, title, scene, camera, scenePrompt, cameraPrompt, durationSec, segments, subtitle, generationMode = 'storyboard' } = payload;
  try {
    const topview = require('../services/topviewService');
    const base = _publicBaseUrl(req);
    _taskPatch(taskId, { status: 'running', stage: 'topview_m2v', progress: 10, message: 'Topview 生成广告数字人视频' });
    const tv = await topview.generateMarketingVideo({
      avatarImageUrl: avatar?.image_url ? _absolutePublicUrl(req, avatar.image_url) : '',
      materialImageUrl: backgroundUrl ? _absolutePublicUrl(req, backgroundUrl) : '',
      title: title || '广告数字人',
      text: [
        text,
        scenePrompt ? `场景要求：${scenePrompt}` : '',
        cameraPrompt ? `镜头要求：${cameraPrompt}` : '',
      ].filter(Boolean).join('\n'),
      voiceId: voiceId || '',
      duration: Math.max(10, Math.min(60, Number(durationSec) || 18)),
      onProgress: info => _taskPatch(taskId, {
        stage: info.stage || 'topview_m2v',
        progress: Math.max(10, Math.min(95, Number(info.progress) || 10)),
        message: `Topview ${info.status || info.stage || 'processing'}`,
      }),
    });
    if (tv?.videoUrl) {
      const taskDir = path.join(JIMENG_ASSETS_DIR, `digital_ad_${taskId}`);
      fs.mkdirSync(taskDir, { recursive: true });
      const dl = await axios.get(tv.videoUrl, { responseType: 'arraybuffer', timeout: 120000 });
      const finalPath = path.join(taskDir, 'topview_digital_ad.mp4');
      fs.writeFileSync(finalPath, Buffer.from(dl.data));
      const publicName = `topview_digital_ad_${taskId}.mp4`;
      fs.copyFileSync(finalPath, path.join(JIMENG_ASSETS_DIR, publicName));
      const taskData = {
        id: taskId,
        status: 'done',
        stage: 'done',
        title: title || '广告数字人',
        text,
        videoPath: finalPath,
        videoUrl: `/api/avatar/tasks/${taskId}/stream`,
        video_url: `${base}/public/jimeng-assets/${publicName}`,
        image_url: backgroundUrl || avatar?.image_url || '',
        thumbnail_url: backgroundUrl || avatar?.image_url || '',
        kind: 'production',
        mode: 'digital_ad',
        generation_mode: 'topview',
        user_id: productAdTasks.get(taskId)?.user_id,
        ratio: '16:9',
        model: tv.model_id || 'topview-m2v',
        provider_id: 'topview',
        topview_task_id: tv.taskId,
        created_at: productAdTasks.get(taskId)?.created_at || new Date().toISOString(),
      };
      productAdTasks.set(taskId, { ...productAdTasks.get(taskId), ...taskData, progress: 100, updated_at: new Date().toISOString() });
      if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
      else db.updateAvatarTask(taskId, taskData);
      return;
    }
  } catch (topviewErr) {
    console.error('[DH/space-guide] Topview failed:', topviewErr);
    _taskPatch(taskId, {
      status: 'error',
      stage: 'topview_m2v_error',
      error: `Topview 广告数字人生成失败：${topviewErr.message}`,
      message: topviewErr.message,
    });
    try {
      if (!db.getAvatarTask(taskId)) {
        const t = productAdTasks.get(taskId);
        db.insertAvatarTask({ ...t, status: 'error', error: `Topview 广告数字人生成失败：${topviewErr.message}`, kind: 'production', mode: 'digital_ad', generation_mode: 'topview' });
      }
    } catch {}
    return;
  }
  if (generationMode === 'storyboard') return _runSpaceStoryboardTask(req, taskId, payload);
  try {
    const base = _publicBaseUrl(req);
    _taskPatch(taskId, { status: 'running', stage: 'guide_keyframe', progress: 8, message: '生成空间导览首帧' });
    const keyframePrompt = _buildSpaceGuideKeyframePrompt({ scene, title, text, scenePrompt, camera, cameraPrompt });
    const refs = [
      await _resolveImageForExternalApi(req, avatar.image_url),
      await _resolveImageForExternalApi(req, backgroundUrl),
    ].filter(Boolean);

    const keyframePath = await _generateViaDeyunaiNanoBanana({
      prompt: keyframePrompt,
      aspectRatio: '16:9',
      filename: `space_guide_${Date.now()}_${uuidv4().slice(0, 8)}`,
      destDir: JIMENG_ASSETS_DIR,
      referenceImages: refs,
    });
    const keyframeUrl = `${base}/public/jimeng-assets/${path.basename(keyframePath)}`;
    _taskPatch(taskId, { keyframeUrl, image_url: keyframeUrl, thumbnail_url: keyframeUrl, progress: 42, message: '导览首帧已完成' });

    const showSubtitles = subtitle?.show !== false;
    const guideSegments = Array.isArray(segments) && segments.length
      ? segments
      : _fallbackGuideSegments(text, Math.max(10, Number(durationSec) || Math.ceil(String(text).length / 4)));
    const subtitleStyle = subtitle?.style || 'popup';
    const textEffects = showSubtitles
      ? _normalizeSubtitleSegments(guideSegments, text).map(s => ({
        text: s.text,
        position: subtitleStyle === 'comic' ? 'top-center' : 'bottom-center',
        style: 'subtitle',
        subtitleStyle,
        smartEmphasis: subtitle?.smartEmphasis !== false,
        startTime: s.start ?? 0,
        endTime: s.end,
        fontName: subtitle?.fontName || '抖音美好体',
        fontSize: subtitle?.fontSize || 72,
        color: subtitle?.color || '#FFFFFF',
        outlineColor: subtitle?.outlineColor || '#000000',
      }))
      : [];

    const cameraMotion = ['auto', 'push_in', 'static', 'handheld', 'pan_right', 'walkthrough', 'orbit', 'wide_to_detail', 'rack_focus', 'custom'].includes(camera) ? camera : 'auto';
    const motionPrompt = [
      'One continuous realistic showroom/space docent video. Presenter looks at the camera and speaks naturally with expressive but controlled delivery.',
      'Keep the presenter on the left side and keep the right wall/display visible for the whole video.',
      'Natural open-palm gesture toward the display area on the right, subtle head movement, realistic lip sync.',
      scenePrompt ? `Scene context to emphasize: ${scenePrompt}.` : '',
      text ? `Narration meaning: ${String(text).slice(0, 420)}.` : '',
      `Camera motion: ${_spaceCameraPrompt(cameraMotion, cameraPrompt)}.`,
      'No subtitles generated by the model itself, no stickers, no extra people, no layout changes.',
    ].filter(Boolean).join(' ');

    _taskPatch(taskId, { stage: 'guide_video', progress: 55, message: '提交数字人讲解视频' });
    const resp = await axios.post(`${base}/api/avatar/jimeng-omni/generate`, {
      image_url: keyframeUrl,
      text,
      audio_url: null,
      voiceId: voiceId || null,
      title: title || '广告数字人',
      prompt: motionPrompt,
      speed: 1.0,
      textEffects,
      stickers: [],
      cameraMotion,
      cameraSegments: [],
      coverWatermark: true,
      kind: 'production',
    }, {
      headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
      timeout: 30000,
    });

    if (!resp.data?.success) throw new Error(resp.data?.error || '提交空间讲解任务失败');
    const linkedTaskId = resp.data.taskId;
    _taskPatch(taskId, { linkedTaskId, stage: 'submitted', progress: 68, message: '数字人渲染中' });

    const started = Date.now();
    while (Date.now() - started < 10 * 60 * 1000) {
      await _sleep(6000);
      let statusResp = null;
      try {
        statusResp = await axios.get(`${base}/api/avatar/jimeng-omni/tasks/${linkedTaskId}`, {
          headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
          timeout: 15000,
        });
      } catch (pollErr) {
        _taskPatch(taskId, { message: pollErr.response?.data?.error || pollErr.message });
        continue;
      }
      const t = statusResp.data?.task || {};
      _taskPatch(taskId, {
        status: t.status || 'running',
        stage: t.stage || 'running',
        progress: Math.max(68, Math.min(98, Number(t.progress) || 72)),
        message: t.message || '数字人渲染中',
        video_url: t.video_url || t.videoUrl || '',
        videoUrl: t.videoUrl || t.video_url || '',
        subtitle_burned: !!t.subtitle_burned,
        subtitle_warning: t.subtitle_warning || '',
        error: t.error || '',
      });
      const doneVideoUrl = t.video_url || t.videoUrl;
      if (t.status === 'done' && doneVideoUrl) {
        const taskData = {
          id: taskId,
          status: 'done',
          stage: 'done',
          title: title || '广告数字人',
          text,
          videoUrl: doneVideoUrl,
          video_url: doneVideoUrl,
          image_url: keyframeUrl,
          thumbnail_url: keyframeUrl,
          keyframeUrl,
          linkedTaskId,
          kind: 'production',
          mode: 'digital_ad',
          user_id: productAdTasks.get(taskId)?.user_id,
          ratio: '16:9',
          created_at: productAdTasks.get(taskId)?.created_at || new Date().toISOString(),
          subtitle_burned: !!t.subtitle_burned,
          subtitle_warning: t.subtitle_warning || '',
        };
        productAdTasks.set(taskId, { ...productAdTasks.get(taskId), ...taskData, progress: 100, updated_at: new Date().toISOString() });
        if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
        else db.updateAvatarTask(taskId, taskData);
        return;
      }
      if (t.status === 'error') throw new Error(t.error || '广告数字人渲染失败');
    }
    throw new Error('广告数字人轮询超时');
  } catch (err) {
    console.error('[DH/space-guide] failed:', err);
    _taskPatch(taskId, { status: 'error', stage: 'error', error: err.message, message: err.message });
    try {
      if (!db.getAvatarTask(taskId)) {
        const t = productAdTasks.get(taskId);
        db.insertAvatarTask({ ...t, status: 'error', error: err.message, kind: 'production', mode: 'digital_ad' });
      }
    } catch {}
  }
}

router.post('/spaces/generate', async (req, res) => {
  try {
    const {
      avatar_id,
      background_url,
      text,
      voice_id = null,
      title = '广告数字人',
      scene = 'auto',
      camera = 'auto',
      scene_prompt = '',
      camera_prompt = '',
      duration_sec = null,
      segments = [],
      subtitle = null,
      generation_mode = 'topview',
    } = req.body || {};

    if (!avatar_id) return res.status(400).json({ success: false, error: 'avatar_id 必填' });
    if (!background_url) return res.status(400).json({ success: false, error: 'background_url 必填' });
    if (!text?.trim()) return res.status(400).json({ success: false, error: 'text 必填' });
    if (!String(voice_id || '').trim()) return res.status(400).json({ success: false, error: 'voice_id 必填，请先选择配音音色' });

    const avatar = db.getPortrait(avatar_id);
    if (!avatar || avatar.kind !== 'digital_human' || !ownedBy(req, avatar)) {
      return res.status(404).json({ success: false, error: '形象不存在' });
    }
    if (!avatar.image_url) return res.status(400).json({ success: false, error: '形象缺少图片' });

    const taskId = uuidv4();
    const task = {
      id: taskId,
      taskId,
      status: 'submitted',
      stage: 'submitted',
      progress: 3,
      message: '已提交广告数字人任务',
      avatar_id,
      background_url,
      scene,
      camera,
      title,
      text,
      user_id: req.user?.id,
      created_at: new Date().toISOString(),
      started_at: Date.now(),
      kind: 'production',
      mode: 'digital_ad',
      generation_mode,
    };
    productAdTasks.set(taskId, task);
    res.json({ success: true, taskId, message: '已提交广告数字人任务' });
    _runSpaceGuideTask(req, taskId, {
      avatar,
      backgroundUrl: background_url,
      text,
      voiceId: voice_id,
      title,
      scene,
      camera,
      scenePrompt: scene_prompt,
      cameraPrompt: camera_prompt,
      durationSec: duration_sec,
      segments,
      subtitle,
      generationMode: 'topview',
    });
    return;

    const base = _publicBaseUrl(req);
    const keyframePrompt = _buildSpaceGuideKeyframePrompt({ scene, title });
    const refs = [
      await _resolveImageForExternalApi(req, avatar.image_url),
      await _resolveImageForExternalApi(req, background_url),
    ].filter(Boolean);

    const keyframePath = await _generateViaDeyunaiNanoBanana({
      prompt: keyframePrompt,
      aspectRatio: '16:9',
      filename: `space_guide_${Date.now()}_${uuidv4().slice(0, 8)}`,
      destDir: JIMENG_ASSETS_DIR,
      referenceImages: refs,
    });
    const keyframeUrl = `${base}/public/jimeng-assets/${path.basename(keyframePath)}`;

    const showSubtitles = !!subtitle?.show;
    const guideSegments = _fallbackGuideSegments(text, Math.max(10, Math.ceil(String(text).length / 4)));
    const subtitleStyle = subtitle?.style || 'classic';
    const textEffects = showSubtitles
      ? _normalizeSubtitleSegments(guideSegments, text).map(s => ({
        text: s.text,
        position: 'bottom-center',
        style: 'subtitle',
        subtitleStyle,
        smartEmphasis: subtitle?.smartEmphasis === true,
        startTime: s.start ?? 0,
        endTime: s.end,
        fontSize: subtitle?.fontSize || 42,
        color: subtitle?.color || '#FFFFFF',
        outlineColor: subtitle?.outlineColor || '#000000',
      }))
      : [];

    const cameraMotion = ['push_in', 'static', 'handheld'].includes(camera) ? camera : 'push_in';
    const motionPrompt = [
      'One continuous showroom docent video. Presenter looks at the camera and speaks naturally.',
      'Keep the presenter on the left side and keep the right wall/display visible for the whole video.',
      'Natural open-palm gesture toward the display wall on the right, subtle head movement, realistic lip sync.',
      cameraMotion === 'push_in' ? 'Very slow smooth camera push-in, no cuts.' : '',
      cameraMotion === 'handheld' ? 'Very subtle handheld camera movement, no cuts.' : '',
      cameraMotion === 'static' ? 'Stable locked-off camera, no cuts.' : '',
      'No subtitles generated by the model itself, no stickers, no extra people, no layout changes.',
    ].filter(Boolean).join(' ');

    const resp = await axios.post(`${base}/api/avatar/jimeng-omni/generate`, {
      image_url: keyframeUrl,
      text,
      audio_url: null,
      voiceId: voice_id || null,
      title: title || '广告数字人',
      prompt: motionPrompt,
      speed: 1.0,
      textEffects,
      stickers: [],
      cameraMotion,
      cameraSegments: [],
      coverWatermark: true,
      kind: 'production',
    }, {
      headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
      timeout: 30000,
    });

    if (!resp.data?.success) {
        return res.status(500).json({ success: false, error: resp.data?.error || '提交广告数字人任务失败', keyframeUrl });
    }

    res.json({
      success: true,
      taskId: resp.data.taskId,
      keyframeUrl,
      avatar_id,
      scene,
      camera: cameraMotion,
      message: '广告数字人视频已提交',
    });
  } catch (err) {
    const e = err.response?.data?.error || err.message;
    console.error('[DH/spaces/generate] 失败:', e);
    res.status(500).json({ success: false, error: e });
  }
});

router.get('/spaces/:taskId', (req, res) => {
  const task = productAdTasks.get(req.params.taskId) || db.getAvatarTask(req.params.taskId);
  if (!task) return res.status(404).json({ success: false, error: '任务不存在' });
  if (task.user_id && req.user?.id && task.user_id !== req.user.id) {
    return res.status(404).json({ success: false, error: '任务不存在' });
  }
  res.json({ success: true, task });
});

// ═══════════════════════════════════════════════
// Step 3 · POST /api/dh/videos/generate
//   body: { avatar_id, text, voice_id?, title? }
//   内部转发给 /api/avatar/jimeng-omni/generate
// —— 借助 Jimeng Omni 已实现的 TTS+驱动+持久化链路
// ═══════════════════════════════════════════════
router.post('/videos/generate', async (req, res) => {
  try {
    const { avatar_id, text, voice_id, title, segments = [], subtitle = null, product = null } = req.body || {};
    if (!avatar_id) return res.status(400).json({ success: false, error: 'avatar_id 必填' });
    if (!text?.trim()) return res.status(400).json({ success: false, error: 'text 必填' });

    const avatar = db.getPortrait(avatar_id);
    if (!avatar || avatar.kind !== 'digital_human' || !ownedBy(req, avatar)) {
      return res.status(404).json({ success: false, error: '形象不存在' });
    }
    if (!avatar.image_url) return res.status(400).json({ success: false, error: '形象缺少图片' });

    const effectiveProduct = product?.image_url
      ? product
      : ((avatar.avatar_type === 'product' || avatar.type === 'product') ? (avatar.product || null) : null);
    // ⚡ 优化：商品数字人在 Step 1 已经融合过一次，avatar.image_url 就是融合成品。
    // Step 3 再融合一次 → 模型把已融合图当 reference + 再叠加商品图 → 商品被引入两次/位置错乱/浪费 30-60 秒。
    // 仅当：① 请求体里显式传了新的 product（用户在 Step 3 临时换商品），或 ② avatar 本身没融合过（旧版本数据 / 异常）才再融合。
    const avatarAlreadyFused = !!(avatar.avatar_type === 'product' || avatar.type === 'product');
    const userOverridesProduct = !!(product?.image_url);
    const shouldFuse = effectiveProduct?.image_url && (userOverridesProduct || !avatarAlreadyFused);
    const fusedImageUrl = shouldFuse ? await _generateProductIntegratedAvatarImage(req, avatar, effectiveProduct) : null;
    const sourceImageUrl = fusedImageUrl || avatar.image_url;
    if (effectiveProduct?.image_url && !shouldFuse) {
      console.log('[DH/videos/generate] avatar 已是商品融合形象，跳过 Step 3 二次融合，直接驱动');
    }
    const subtitleCfg = subtitle || { show: true, fontName: '抖音美好体', fontSize: 60, color: '#FFFFFF', outlineColor: '#000000', style: 'popup', smartEmphasis: true };
    const showSubtitles = subtitleCfg.show !== false;
    const subtitleStyle = subtitleCfg.style || 'popup';
    const smartEmphasis = subtitleCfg.smartEmphasis !== false;
    // comic 风格默认顶部，其它默认底部
    const subtitlePosition = subtitleStyle === 'comic' ? 'top-center' : 'bottom-center';

    // 字幕：转换 segments + subtitle 配置 → Jimeng Omni 支持的 textEffects
    // 如果 subtitle.show=true 但没有 segments（AI 拆分失败 / 用户没点手动拆分），
    // 做一次本地字数 fallback 拆分：每段 ~16 字、按 4 字/秒估算 startTime/endTime。
    // 这样字幕至少能烧到视频上，而不是因为 segments 为空就整个丢弃。
    let effectiveSegments = Array.isArray(segments) ? segments : [];
    if (showSubtitles && !effectiveSegments.length && text && text.trim()) {
      const CHAR_PER_SEG = 16;
      const SEC_PER_CHAR = 0.25;
      const chunks = [];
      const src = text.trim();
      let idx = 0;
      while (idx < src.length) {
        // 按标点优先切分（。！？，、；），凑到 ≈ CHAR_PER_SEG 个字就收一段
        let end = Math.min(idx + CHAR_PER_SEG, src.length);
        // 试着往后退到最近的标点，但不要小于 CHAR_PER_SEG/2
        const windowEnd = Math.min(idx + CHAR_PER_SEG + 8, src.length);
        const slice = src.slice(idx, windowEnd);
        const m = slice.match(/^.*?[。！？，、；,\.!?;][^。！？，、；,\.!?;]*$/);
        if (m && m[0].length >= CHAR_PER_SEG / 2) {
          end = idx + m[0].length;
        }
        const segText = src.slice(idx, end).trim();
        if (segText) chunks.push(segText);
        idx = end;
      }
      let cursor = 0;
      effectiveSegments = chunks.map(t => {
        const dur = Math.max(0.6, t.length * SEC_PER_CHAR);
        const start = cursor;
        const endT = cursor + dur;
        cursor = endT;
        return { text: t, start, end: endT };
      });
      console.log(`[DH/videos/generate] subtitle.show=true 但前端未提供 segments，已 fallback 拆分为 ${effectiveSegments.length} 段`);
    }

    let textEffects = [];
    const subtitleSegments = showSubtitles ? _normalizeSubtitleSegments(effectiveSegments, text) : [];
    if (showSubtitles && effectiveSegments.length) {
      textEffects = subtitleSegments.map(s => ({
        text: s.text,
        position: subtitlePosition,
        style: 'subtitle',
        // 字幕动效预设：classic/popup/bouncy/karaoke/neon/comic/news/emphasis
        subtitleStyle,
        smartEmphasis,
        startTime: s.start ?? 0,
        endTime: s.end,
        // subtitle 配置用于字体/颜色/描边覆盖；不写就走 preset 默认
        fontName: subtitleCfg.fontName || '抖音美好体',
        fontSize: subtitleCfg.fontSize || 60,
        color: subtitleCfg.color || '',
        outlineColor: subtitleCfg.outlineColor || '',
      }));
    }

    const productPrompt = effectiveProduct?.image_url
      ? `\n商品数字人素材：已在生成前融合到人物形象图中（${effectiveProduct.image_name || effectiveProduct.name || '商品'}）。动作需要像真实口播一样自然手持、指向或展示商品，商品必须像被人物拿在手里或放在身前真实空间里，不要漂浮贴片。商品名称=${effectiveProduct.name || '未填写'}，卖点=${effectiveProduct.selling_points || '未填写'}。`
      : '';
    const segmentPrompt = effectiveSegments.length
      ? effectiveSegments.map(s => {
        const tone = s.tone || s.delivery || s.voice_tone || 'natural';
        const motion = s.motion || 'natural speaking';
        const expression = s.expression || 'natural';
        const camera = s.camera || 'static';
        return `${s.start ?? 0}-${s.end ?? ''}s | expression=${expression} | tone=${tone} | camera=${camera} | motion=${motion} | line=${s.text}`;
      }).join('\n') + productPrompt
      : productPrompt.trim();
    const productStickers = [];
    // ⚠️ 数字人单段视频不再分段运镜！原来把视频按字幕 segments trim+concat 会产生 hard cut（"切割感"）。
    // 改成整段统一一个柔和运镜，全程一镜到底。
    const cameraMotion = effectiveSegments.map(s => s.camera).find(c => c && c !== 'static')
      || (effectiveProduct?.image_url ? 'push_in' : 'static');
    const cameraSegments = []; // 强制不分段，避免切割感
    const audioUrl = null;
    console.log('[DH/videos/generate] 使用整段稳定 TTS + 整段一致运镜，避免分段切割感');

    const base = _publicBaseUrl(req);
    const resp = await axios.post(`${base}/api/avatar/jimeng-omni/generate`, {
      image_url: sourceImageUrl,
      text: audioUrl ? null : text,
      audio_url: audioUrl,
      voiceId: voice_id || null,
      title: title || avatar.name,
      prompt: segmentPrompt,
      speed: 1.0,
      textEffects,
      stickers: productStickers,
      cameraMotion,
      cameraSegments,
      // 默认开启左上角水印遮盖（delogo 像素修复，效果远好于黑块）
      // 即梦 Omni / Hifly 等 lip-sync 模型即使关了 aigc_flag，部分线上链路仍会带 AI 标识，统一覆盖
      coverWatermark: true,
      kind: 'production',
    }, {
      headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
      timeout: 30000,
    });

    if (!resp.data?.success) {
      return res.status(500).json({ success: false, error: resp.data?.error || '提交失败' });
    }

    res.json({
      success: true,
      taskId: resp.data.taskId,
      avatar_id,
      message: '已按管理端模型链提交，渲染 1-3 分钟',
    });
  } catch (err) {
    const e = err.response?.data?.error || err.message;
    console.error('[DH] videos/generate 失败:', e);
    res.status(500).json({ success: false, error: e });
  }
});

// GET /api/dh/videos/tasks — 用户所有数字人视频作品（从 avatar_db）
router.get('/videos/tasks', (req, res) => {
  try {
    const uid = scopeUserId(req);
    const tasks = db.listAvatarTasks(uid);
    const base = _publicBaseUrl(req);
    // 兼容：旧数据 kind 字段空 → 按 title 猜（含"预览样片"当 sample，其他按 production）
    const data = tasks.map(t => {
      let kind = t.kind;
      if (!kind) {
        kind = (t.title && /预览样片|sample/i.test(t.title)) ? 'sample' : 'production';
      }
      // 统一 thumbnail_url：优先已有 image_url（生成数字人时的形象图），
      // 否则走 on-demand 首帧端点（懒生成，第一次访问时 ffmpeg 抽帧+缓存）
      const hasVideo = !!(t.videoUrl || t.video_url || t.local_path || t.videoPath);
      const thumbnail_url = t.thumbnail_url
        || t.image_url
        || (hasVideo ? `${base}/api/dh/videos/tasks/${t.id}/thumbnail` : null);
      return { ...t, kind, thumbnail_url };
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dh/videos/tasks/:id
router.get('/videos/tasks/:id', (req, res) => {
  const t = db.getAvatarTask(req.params.id);
  if (!t || !ownedBy(req, t)) return res.status(404).json({ success: false, error: 'task not found' });
  res.json({ success: true, data: t });
});

// GET /api/dh/videos/tasks/:id/thumbnail — 视频首帧 jpg（懒生成 + 缓存）
//   生成位置：与视频同目录的 <basename>.thumb.jpg
//   命中策略：缓存存在直接 stream；不存在 → ffmpeg.extractFirstFrame → 写盘 → stream
router.get('/videos/tasks/:id/thumbnail', async (req, res) => {
  try {
    const t = db.getAvatarTask(req.params.id);
    if (!t) return res.status(404).end();
    // 鉴权：作品库的 poster URL 走 <video> 标签直接发，<video poster> 不会带 Authorization
    // 因此这里不强制鉴权；但用 task id 不可枚举（uuid）来保证安全。

    const localPath = t.videoPath || t.local_path;
    if (!localPath || !fs.existsSync(localPath)) {
      // 没有本地视频文件（远端 URL）→ 返回 1x1 透明 png 占位
      return res.status(204).end();
    }

    const thumbPath = localPath.replace(/\.(mp4|mov|webm|mkv|avi)$/i, '') + '.thumb.jpg';
    if (!fs.existsSync(thumbPath)) {
      const ffmpegService = require('../services/ffmpegService');
      try {
        await ffmpegService.extractFirstFrame(localPath, thumbPath, { atSec: 0.5, width: 480 });
      } catch (e) {
        console.warn('[DH/thumbnail] 抽帧失败 ' + req.params.id + ':', e.message);
        return res.status(204).end();
      }
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(thumbPath).pipe(res);
  } catch (err) {
    console.warn('[DH/thumbnail] err:', err.message);
    res.status(500).end();
  }
});

// DELETE /api/dh/videos/tasks/:id — 删除作品 + 本地 mp4
router.delete('/videos/tasks/:id', (req, res) => {
  try {
    const t = db.getAvatarTask(req.params.id);
    if (!t || !ownedBy(req, t)) return res.status(404).json({ success: false, error: 'task not found' });
    // 删本地文件
    const files = [t.videoPath, t.local_path].filter(Boolean);
    for (const f of files) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} }
    db.deleteAvatarTask(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// 双人对话数字人（MVP）
//   - A/B 各一段 Jimeng Omni 任务并行跑
//   - 跑完用 FFmpeg hstack / vstack 合成 / 或依次 concat
// ═══════════════════════════════════════════════

const dualTasks = new Map(); // in-memory; 完成后写入 avatar_db 持久化

function _parseDualScript(script) {
  const aLines = [], bLines = [];
  let current = null;
  (script || '').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([AaBb])\s*[:：]\s*(.*)$/);
    if (m) {
      current = m[1].toUpperCase();
      const text = (m[2] || '').trim();
      if (text) (current === 'A' ? aLines : bLines).push(text);
    } else if (current && line.trim()) {
      (current === 'A' ? aLines : bLines).push(line.trim());
    }
  });
  return { aText: aLines.join('。'), bText: bLines.join('。') };
}

// POST /api/dh/dual/generate
//   body: { avatarA_id, avatarB_id, script, voice_a?, voice_b?, layout? }
router.post('/dual/generate', async (req, res) => {
  try {
    const { avatarA_id, avatarB_id, script, voice_a, voice_b, layout = 'hstack' } = req.body || {};
    if (!avatarA_id || !avatarB_id) return res.status(400).json({ success: false, error: '需要选 A 和 B 两个形象' });
    if (!script?.trim()) return res.status(400).json({ success: false, error: 'script 必填' });

    const avA = db.getPortrait(avatarA_id);
    const avB = db.getPortrait(avatarB_id);
    if (!avA || avA.kind !== 'digital_human' || !ownedBy(req, avA)) return res.status(404).json({ success: false, error: 'A 形象不存在' });
    if (!avB || avB.kind !== 'digital_human' || !ownedBy(req, avB)) return res.status(404).json({ success: false, error: 'B 形象不存在' });

    const { aText, bText } = _parseDualScript(script);
    if (!aText || !bText) return res.status(400).json({ success: false, error: '脚本需同时含 A: / B: 两种台词' });

    const taskId = uuidv4();
    const base = _publicBaseUrl(req);
    const task = {
      id: taskId,
      status: 'running',
      stage: 'submitting_both',
      created_at: Date.now(),
      user_id: req.user?.id || null,
      avatarA_id, avatarB_id,
      layout,
      aTaskId: null, bTaskId: null,
      aVideoPath: null, bVideoPath: null,
      video_url: null,
      error: null,
    };
    dualTasks.set(taskId, task);
    res.json({ success: true, taskId });

    // 异步流水线
    (async () => {
      try {
        const headers = req.headers.authorization ? { Authorization: req.headers.authorization } : {};
        // 1. 并行提交 A / B
        const [subA, subB] = await Promise.all([
          axios.post(`${base}/api/avatar/jimeng-omni/generate`, {
            image_url: avA.image_url, text: aText, voiceId: voice_a || null, title: `[双人 A] ${avA.name}`, speed: 1.0,
          }, { headers, timeout: 30000 }).then(r => r.data),
          axios.post(`${base}/api/avatar/jimeng-omni/generate`, {
            image_url: avB.image_url, text: bText, voiceId: voice_b || null, title: `[双人 B] ${avB.name}`, speed: 1.0,
          }, { headers, timeout: 30000 }).then(r => r.data),
        ]).catch(e => { throw new Error('提交失败: ' + (e.response?.data?.error || e.message)); });

        task.aTaskId = subA.taskId;
        task.bTaskId = subB.taskId;
        if (!task.aTaskId || !task.bTaskId) throw new Error('未拿到 A/B 任务 id');
        task.stage = 'rendering_both';

        // 2. 并行轮询直到两边都 done
        const pollOne = async (subTaskId) => {
          const start = Date.now();
          const MAX = 12 * 60 * 1000;
          while (Date.now() - start < MAX) {
            const r = await axios.get(`${base}/api/avatar/jimeng-omni/tasks/${subTaskId}`, { headers, timeout: 10000 }).catch(() => null);
            const t = r?.data?.task;
            if (!t) { await new Promise(r => setTimeout(r, 5000)); continue; }
            if (t.status === 'done' && t.local_path) return t;
            if (t.status === 'error') throw new Error('子任务失败: ' + (t.error || ''));
            await new Promise(r => setTimeout(r, 5000));
          }
          throw new Error('子任务超时 ' + subTaskId);
        };

        const [rA, rB] = await Promise.all([pollOne(task.aTaskId), pollOne(task.bTaskId)]);
        task.aVideoPath = rA.local_path;
        task.bVideoPath = rB.local_path;

        // 3. FFmpeg 合成
        task.stage = 'composing';
        const outDir = path.join(__dirname, '../../outputs/jimeng-assets');
        const outName = `dual_${taskId}.mp4`;
        const outPath = path.join(outDir, outName);

        const ffmpeg = require('fluent-ffmpeg');
        const ffmpegStatic = require('ffmpeg-static');
        ffmpeg.setFfmpegPath(ffmpegStatic);

        await new Promise((resolve, reject) => {
          const cmd = ffmpeg();
          cmd.input(rA.local_path).input(rB.local_path);
          // 按 layout 拼
          let filterComplex;
          if (layout === 'vstack') {
            filterComplex = [
              '[0:v]scale=720:1280,setsar=1[va]',
              '[1:v]scale=720:1280,setsar=1[vb]',
              '[va][vb]vstack=inputs=2[v]',
              // 音轨：A+B 混合
              '[0:a][1:a]amix=inputs=2:duration=longest[a]',
            ];
          } else if (layout === 'alternate') {
            filterComplex = [
              '[0:v]scale=1080:1920,setsar=1[va]',
              '[1:v]scale=1080:1920,setsar=1[vb]',
              '[va][0:a][vb][1:a]concat=n=2:v=1:a=1[v][a]',
            ];
          } else {
            // hstack（默认）
            filterComplex = [
              '[0:v]scale=540:1920,setsar=1[va]',
              '[1:v]scale=540:1920,setsar=1[vb]',
              '[va][vb]hstack=inputs=2[v]',
              '[0:a][1:a]amix=inputs=2:duration=longest[a]',
            ];
          }
          cmd.complexFilter(filterComplex)
            .outputOptions(['-map [v]', '-map [a]', '-c:v libx264', '-preset medium', '-crf 22', '-c:a aac', '-b:a 192k', '-shortest'])
            .save(outPath)
            .on('end', () => resolve())
            .on('error', err => reject(err));
        });

        task.video_url = `${base}/public/jimeng-assets/${outName}`;
        task.local_path = outPath;
        task.status = 'done';
        task.stage = 'done';
        task.finished_at = Date.now();

        // 持久化到 avatar_db
        try {
          const row = {
            id: taskId,
            user_id: task.user_id,
            status: 'done',
            title: `[双人] ${avA.name} & ${avB.name}`,
            videoUrl: task.video_url.replace(base, ''),
            videoPath: outPath,
            model: 'dual-omni',
            ratio: layout === 'vstack' ? '9:16' : (layout === 'alternate' ? '9:16' : '9:16'),
            source: 'dual',
            layout,
            avatarA_id, avatarB_id,
            created_at: new Date(task.created_at).toISOString(),
            finished_at: new Date().toISOString(),
          };
          if (!db.getAvatarTask(taskId)) db.insertAvatarTask(row);
        } catch (dbErr) { console.warn('[dual] DB 持久化失败:', dbErr.message); }

        console.log(`[DH/dual] 完成 ${taskId} → ${outPath}`);
      } catch (err) {
        task.status = 'error';
        task.error = err.message;
        console.error('[DH/dual] 失败:', err.message);
      }
    })();
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dh/dual/tasks/:id
router.get('/dual/tasks/:id', (req, res) => {
  const t = dualTasks.get(req.params.id);
  if (!t) {
    // 可能已经只在 avatar_db 里了（服务重启后）
    const row = db.getAvatarTask(req.params.id);
    if (row && ownedBy(req, row)) return res.json({ success: true, task: row });
    return res.status(404).json({ success: false, error: 'task not found' });
  }
  res.json({ success: true, task: t });
});

// ═══════════════════════════════════════════════
// 阿里 Token 管理（快速更新入口）· 24h NLS token 易过期
// ═══════════════════════════════════════════════
function _findAliyunProvider(settings) {
  return (settings.providers || []).find(p => p.id === 'aliyun-tts')
      || (settings.providers || []).find(p => /aliyun|dashscope|百炼/i.test(p.id + '|' + (p.name || '')))
      || null;
}
function _tokenType(k) {
  if (!k) return 'unknown';
  if (/^sk-/.test(k)) return 'dashscope';   // 智能语音交互 2.0 sk-* · 永久
  if (/^[0-9a-f]{32}$/i.test(k)) return 'nls'; // 旧版 NLS AccessToken · 24h
  return 'dashscope'; // 默认按 dashscope（永久）处理
}

// GET /api/dh/aliyun-token/view — 只返回遮罩版 token + 更新时间
router.get('/aliyun-token/view', (req, res) => {
  try {
    const { loadSettings } = require('../services/settingsService');
    const settings = loadSettings();
    const p = _findAliyunProvider(settings);
    if (!p?.api_key) return res.json({ success: true, token_preview: '(未配置)', updated_at: null });
    const k = p.api_key;
    const preview = k.length <= 12 ? (k.slice(0, 3) + '***') : (k.slice(0, 6) + '…' + k.slice(-4));
    res.json({
      success: true,
      provider_id: p.id,
      token_preview: preview,
      token_type: _tokenType(k),
      updated_at: p.token_updated_at || null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/dh/aliyun-token/update — { token }
router.post('/aliyun-token/update', (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token?.trim()) return res.status(400).json({ success: false, error: 'token 必填' });
    const trimmed = token.trim();

    const { loadSettings, saveSettings } = require('../services/settingsService');
    const settings = loadSettings();
    let p = _findAliyunProvider(settings);
    const type = _tokenType(trimmed);
    if (!p) {
      p = {
        id: 'aliyun-tts',
        preset: 'aliyun-tts',
        name: type === 'nls' ? '阿里云语音（旧版 NLS AccessToken · 24h）' : '阿里云智能语音交互 2.0（DashScope · 永久）',
        api_url: '',
        api_key: trimmed,
        enabled: true,
        models: [],
      };
      settings.providers.push(p);
    } else {
      p.api_key = trimmed;
      p.enabled = true;
    }
    p.token_updated_at = Date.now();
    saveSettings(settings);
    res.json({ success: true, type, provider_id: p.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// 健康诊断（哪个引擎可用）
// ═══════════════════════════════════════════════
router.get('/status', (req, res) => {
  const { loadSettings } = require('../services/settingsService');
  const settings = loadSettings();
  const hasProvider = (needle) => (settings.providers || []).some(p => {
    const hay = ((p.id || '') + '|' + (p.preset || '') + '|' + (p.name || '')).toLowerCase();
    return hay.includes(needle) && p.api_key;
  });

  res.json({
    success: true,
    engines: {
      seedream:    { available: hasProvider('volces') || hasProvider('ark') || hasProvider('火山') || hasProvider('seedream'), desc: 'Step1 文生图' },
      jimeng_omni: { available: hasProvider('jimeng') || hasProvider('volc') || hasProvider('火山') || !!process.env.JIMENG_ACCESS_KEY, desc: 'Step3 照片驱动数字人（推荐）' },
      wan_animate: { available: hasProvider('dashscope') || hasProvider('百炼') || hasProvider('wan') || !!process.env.DASHSCOPE_API_KEY, desc: 'Step3 阿里 Wan-Animate（备用）' },
      hifly_free:  { available: hasProvider('coze') || !!process.env.COZE_PAT, desc: 'Step3 飞影免费（公共 avatar，兜底）' },
      hifly_paid:  { available: hasProvider('hifly') || hasProvider('lingverse') || !!process.env.HIFLY_TOKEN, desc: '需 REST API Token' },
    },
  });
});

module.exports = router;
