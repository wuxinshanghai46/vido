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
const db = require('../models/database');
const { scopeUserId, ownedBy } = require('../middleware/auth');
const avatarService = require('../services/avatarService');

const JIMENG_ASSETS_DIR = path.join(__dirname, '../../outputs/jimeng-assets');
const DH_IMAGES_DIR = path.join(__dirname, '../../outputs/dh-images');
fs.mkdirSync(JIMENG_ASSETS_DIR, { recursive: true });
fs.mkdirSync(DH_IMAGES_DIR, { recursive: true });

const upload = multer({
  dest: path.join(__dirname, '../../outputs/dh-uploads'),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype?.startsWith('image/') || /\.(png|jpe?g|webp|bmp)$/i.test(file.originalname || '');
    cb(null, ok);
  },
});

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

function _buildPrompt({ style, gender, description }) {
  const s = STYLE_PROMPTS[style] || STYLE_PROMPTS.idol_warm;
  const g = gender === 'male' ? 'handsome young man' : gender === 'female' ? 'beautiful young woman' : 'person';
  const userDesc = description ? `. ${description}` : '';
  return {
    prompt: `${s.prompt.replace(/one single person/g, `one single ${g}`)}${userDesc}, ABSOLUTELY ONE SINGLE PERSON, no duplicates`,
    negative: s.negative,
  };
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

输出结构必须覆盖以下 6 个维度，每项至少 1 句具体描述：
1. 人物形象：身高气质、面部特征（脸型/五官/肤色/眼神）、发型（长度/颜色/质感/发丝飘动）
2. 服装搭配：上衣风格/颜色/面料、下装或搭配、配饰（项链/耳环/眼镜/手表）
3. 妆容姿态：妆感（日系/欧美/干净/复古）、表情、微动作（手势/头部角度）
4. 背景环境：具体场景（家具/物品/陈设要可以点名）、空间感、道具细节
5. 光线氛围：主光源方向、色温（冷暖）、光影层次、氛围关键词（治愈/高级/清晨/黄昏）
6. 构图质感：镜头焦距暗示、景深、色调、画质参考（胶片/杂志/DSLR/电影感）

全文用中文，以顿号/句号自然衔接，目标 180-260 字。不要编号，不要分点，不要加引号/标题/前缀后缀。只输出正文。`;

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
async function _generateViaDeyunaiNanoBanana({ prompt, aspectRatio, filename, destDir }) {
  const { loadSettings } = require('../services/settingsService');
  const settings = loadSettings();
  const dy = (settings.providers || []).find(p => (p.id === 'deyunai' || p.preset === 'deyunai') && p.enabled && p.api_key);
  if (!dy) throw new Error('未配置 deyunai 漫路 provider');
  // 优先 nano-banana-pro，其次 nano-banana
  const candidates = ['nano-banana-pro', 'nano-banana'];
  const enabledModel = (dy.models || []).find(m => candidates.includes(m.id) && m.enabled !== false)?.id;
  if (!enabledModel) throw new Error('deyunai 没启用 nano-banana 模型');

  // 比例 → 尺寸映射
  const sizeMap = { '9:16': '720x1280', '16:9': '1280x720', '1:1': '1024x1024', '3:4': '768x1024', '4:3': '1024x768' };
  const size = sizeMap[aspectRatio] || '1024x1024';

  const axios = require('axios');
  const baseUrl = (dy.api_url || 'https://api.deyunai.com/v1').replace(/\/$/, '');
  const r = await axios.post(`${baseUrl}/images/generations`, {
    model: enabledModel,
    prompt,
    n: 1,
    size,
  }, {
    headers: { Authorization: 'Bearer ' + dy.api_key, 'Content-Type': 'application/json' },
    timeout: 120000,
  });
  const url = r.data?.data?.[0]?.url || r.data?.data?.[0]?.b64_json;
  if (!url) throw new Error('deyunai nano-banana 未返回图片 URL: ' + JSON.stringify(r.data).slice(0, 200));

  fs.mkdirSync(destDir, { recursive: true });
  const outPath = path.join(destDir, filename + '.png');

  if (url.startsWith('http')) {
    const img = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    fs.writeFileSync(outPath, Buffer.from(img.data));
  } else {
    // base64
    fs.writeFileSync(outPath, Buffer.from(url, 'base64'));
  }
  console.log(`[DH/images] ✓ deyunai ${enabledModel} 完成: ${outPath}`);
  return outPath;
}

router.post('/images/generate', async (req, res) => {
  try {
    const { style = 'idol_warm', gender = '', description = '', aspectRatio = '9:16' } = req.body || {};
    const { prompt } = _buildPrompt({ style, gender, description });

    const baseUrl = _publicBaseUrl(req);
    const filename = `dh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 优先级链：① deyunai 漫路 nano-banana → ② 火山 Seedream
    let filePath = null;
    let lastError = null;
    const attempts = [];

    // ① deyunai nano-banana
    try {
      console.log('[DH/images] 尝试 deyunai 漫路 nano-banana...');
      filePath = await _generateViaDeyunaiNanoBanana({ prompt, aspectRatio, filename, destDir: JIMENG_ASSETS_DIR });
      attempts.push({ provider: 'deyunai-nano-banana', ok: true });
    } catch (e1) {
      console.warn('[DH/images] nano-banana 失败:', e1.message);
      attempts.push({ provider: 'deyunai-nano-banana', ok: false, error: e1.message });
      lastError = e1;
      // ② Seedream fallback
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

    if (!filePath) {
      const msg = '所有图像 provider 失败：' + attempts.map(a => `${a.provider}=${a.error || 'ok'}`).join('；');
      throw new Error(msg);
    }

    const imgName = path.basename(filePath);
    const imageUrl = `${baseUrl}/public/jimeng-assets/${imgName}`;
    // attempts 留作调试用，不向前端透出具体 provider 名（用户要求）
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
    const { name, imageUrl, sampleVideoUrl = null, gender = '', style = '', tags = [], source = 'generate', description = '' } = req.body || {};
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
    const { topic, duration_sec = 30, style = 'tutorial', tone = '亲切自然' } = req.body || {};
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

    const sysPrompt = `你是专业的短视频口播稿撰写助手。输出内容必须可直接被 TTS 朗读。`;
    const userPrompt = `主题：${topic}
风格：${styleHint}
语气：${tone}
目标时长：约 ${duration_sec} 秒（中文约 ${targetChars} 字）

要求：
1. 输出一段连贯口播稿，只输出正文，不要加引号/标题/"以下是"等说明
2. 字数控制在 ${targetChars - 10} ~ ${targetChars + 10} 之间
3. 句子短促易读，多用标点分割呼吸节点
4. 不要包含数字人无法读出的内容（括号注释、表情符号等）`;

    const text = (await callLLM(sysPrompt, userPrompt, {
      kb: { scene: 'avatar_script', query: topic.slice(0, 120), limit: 2 },
    })).trim();

    res.json({
      success: true,
      text,
      duration_sec: Math.round(text.length / 4),
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
    const { text } = req.body || {};
    if (!text || text.trim().length < 10) {
      return res.status(400).json({ success: false, error: '文本过短' });
    }

    const { callLLM } = require('../services/storyService');
    const sysPrompt = `你是专业视频口播分段师。按自然语义/呼吸节点拆分，每段约 8-12 秒（中文 30-50 字）。
输出严格 JSON 数组，每项：{"text":"...","expression":"natural|smile|serious|excited|calm","motion":"英文动作描述"}
不要输出其他任何内容。`;
    const userPrompt = `台词：\n${text}\n\n直接输出 JSON 数组。`;
    const out = await callLLM(sysPrompt, userPrompt);

    let raw;
    try {
      const m = out.match(/\[[\s\S]*\]/);
      raw = JSON.parse(m ? m[0] : out);
    } catch {
      raw = text.match(/[^。！？\n]+[。！？]?/g)
        ?.filter(s => s.trim().length > 5)
        ?.map(s => ({ text: s.trim(), expression: 'natural', motion: 'natural speaking with subtle head movements' })) || [];
    }

    // 加时间戳（按 4 字/秒估算）
    let cursor = 0;
    const segments = raw.map((seg, i) => {
      const chars = (seg.text || '').length;
      const dur = Math.max(2, Math.round(chars / 4));
      const s = cursor;
      cursor += dur;
      return {
        index: i,
        text: seg.text,
        expression: seg.expression || 'natural',
        motion: seg.motion || 'natural speaking',
        start: s,
        end: cursor,
        char_count: chars,
      };
    });

    res.json({
      success: true,
      segments,
      total_duration: cursor,
      total_chars: text.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════
// Step 3 · POST /api/dh/videos/generate
//   body: { avatar_id, text, voice_id?, title? }
//   内部转发给 /api/avatar/jimeng-omni/generate
// —— 借助 Jimeng Omni 已实现的 TTS+驱动+持久化链路
// ═══════════════════════════════════════════════
router.post('/videos/generate', async (req, res) => {
  try {
    const { avatar_id, text, voice_id, title, segments = [], subtitle = null } = req.body || {};
    if (!avatar_id) return res.status(400).json({ success: false, error: 'avatar_id 必填' });
    if (!text?.trim()) return res.status(400).json({ success: false, error: 'text 必填' });

    const avatar = db.getPortrait(avatar_id);
    if (!avatar || avatar.kind !== 'digital_human' || !ownedBy(req, avatar)) {
      return res.status(404).json({ success: false, error: '形象不存在' });
    }
    if (!avatar.image_url) return res.status(400).json({ success: false, error: '形象缺少图片' });

    // 字幕：转换 segments + subtitle 配置 → Jimeng Omni 支持的 textEffects
    // 如果 subtitle.show=true 但没有 segments（AI 拆分失败 / 用户没点手动拆分），
    // 做一次本地字数 fallback 拆分：每段 ~16 字、按 4 字/秒估算 startTime/endTime。
    // 这样字幕至少能烧到视频上，而不是因为 segments 为空就整个丢弃。
    let effectiveSegments = Array.isArray(segments) ? segments : [];
    if (subtitle?.show && !effectiveSegments.length && text && text.trim()) {
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
    if (subtitle?.show && effectiveSegments.length) {
      textEffects = effectiveSegments.map(s => ({
        text: s.text,
        position: 'bottom-center',
        style: 'subtitle',
        startTime: s.start ?? 0,
        endTime: s.end,
        // subtitle 配置用于 FFmpeg drawtext：字体/颜色/描边
        fontSize: subtitle.fontSize || 72,
        color: subtitle.color || '#FFFFFF',
        outlineColor: subtitle.outlineColor || '#000000',
      }));
    }

    const base = _publicBaseUrl(req);
    const resp = await axios.post(`${base}/api/avatar/jimeng-omni/generate`, {
      image_url: avatar.image_url,
      text,
      voiceId: voice_id || null,
      title: title || avatar.name,
      speed: 1.0,
      textEffects,
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
      message: '已提交到 Jimeng Omni，渲染 1-3 分钟',
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
