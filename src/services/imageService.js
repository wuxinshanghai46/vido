require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const ffmpegStatic = require('ffmpeg-static');
const { exec } = require('child_process');
const { getApiKey } = require('./settingsService');

const ffmpegPath = (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== 'ffmpeg')
  ? process.env.FFMPEG_PATH
  : ffmpegStatic;

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');
const CHAR_IMG_DIR = path.join(OUTPUT_DIR, 'characters');

function ensureDir() {
  fs.mkdirSync(CHAR_IMG_DIR, { recursive: true });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    proto.get(url, { headers: { 'User-Agent': 'VIDO/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        file.close();
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(destPath)));
    }).on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
  });
}

const STYLE_PROMPTS = {
  celulose:  'in the style of Japanese anime, cel-shaded coloring, flat vibrant colors, bold clean linework, large expressive eyes, anime aesthetic, manga illustration, soft pastel tones',
  urban:     'in Korean manhwa webtoon art style, modern sleek digital illustration, clean precise linework, manhwa character proportions, urban fashion, cool color palette',
  '3dcg':    'in Chinese 3D donghua style, high quality 3D CGI render, cinematic dramatic lighting, Unreal Engine quality, octane render, volumetric lighting, detailed textures',
  shadow:    'in traditional Chinese shadow puppet art style (皮影戏), amber and warm gold tones, silhouette paper-cut design, traditional folk art aesthetic, ornate patterns',
  cyberpunk: 'in cyberpunk sci-fi style, neon purple and cyan lights, dark futuristic environment, holographic effects, volumetric fog, high contrast, Blade Runner aesthetic',
  pixel:     'in pixel art style, 16-bit retro game sprite, limited color palette, crisp sharp pixels, nostalgic 8-bit aesthetic, Game Boy color style',
  chinese:   'in traditional Chinese ink wash painting style (水墨画), flowing brush strokes, rice paper texture, red seal stamp, misty mountains, classical Chinese aesthetics, 国风',
  ghibli:    'in Studio Ghibli anime style, soft watercolor painting, warm pastoral tones, hand-painted textures, whimsical and dreamlike, Hayao Miyazaki aesthetic, gentle atmosphere',
  western:   'in Pixar/DreamWorks 3D animation style, high-quality CGI render, expressive cartoon proportions, warm cinematic lighting, subsurface scattering skin',
  shonen:    'in shonen manga battle style, dynamic action lines, intense expressions, dramatic speed lines, impact frames, bold ink strokes, Japanese battle manga aesthetic',
  wuxia:     'in Chinese wuxia martial arts style (武侠), flowing robes and silk, ancient Chinese architecture, bamboo forests, moonlit night, dramatic kung fu poses, 仙侠古风',
  darkfanta: 'in dark fantasy epic style, grim atmosphere, dramatic chiaroscuro lighting, medieval armor and creatures, dark color palette with fire accents, Lord of the Rings aesthetic',
  mecha:     'in mecha anime style, detailed mechanical robot design, chrome and neon accents, cockpit details, Gundam-inspired proportions, sci-fi military aesthetic, energy weapons',
};

// 2D/3D 维度附加提示词
const DIM_SUFFIX = {
  '2d': 'flat 2D illustration, anime style, clean linework, cell shading',
  '3d': 'photorealistic 3D render, subsurface scattering, cinematic lighting, octane render, 8K',
};

// 即梦AI 专用中文风格提示词（中文模型用中文 prompt 效果更好）
const STYLE_PROMPTS_CN = {
  celulose:  '日系动漫风格，赛璐璐上色，鲜艳平涂色彩，干净线条，大眼睛，动漫插画',
  urban:     '韩国漫画风格，现代都市插画，精致干净线条，时尚造型，冷色调',
  '3dcg':    '3D CG渲染风格，电影级光影，高质量三维建模，体积光，精细纹理',
  shadow:    '中国皮影戏风格，琥珀色暖金色调，剪影纸雕设计，传统民间艺术，华丽纹饰',
  cyberpunk: '赛博朋克科幻风格，紫色青色霓虹灯光，暗色未来感环境，全息效果，高对比度',
  pixel:     '像素画风格，16位复古游戏精灵图，有限色板，清晰锐利的像素',
  chinese:   '中国传统水墨画风格，流畅笔触，宣纸质感，古典意境，国风',
  ghibli:    '吉卜力动画风格，柔和水彩画风，温暖田园色调，手绘质感，梦幻温馨氛围',
  western:   '皮克斯/梦工厂3D动画风格，高质量CG渲染，夸张卡通比例，温暖电影光影',
  shonen:    '少年漫画战斗风格，动感线条，激烈表情，速度线，浓墨线条',
  wuxia:     '中国武侠风格，飘逸衣袍，古代建筑，竹林，月夜，仙侠古风',
  darkfanta: '暗黑奇幻史诗风格，阴暗氛围，明暗对比光影，中世纪铠甲，暗色调配火焰色',
  mecha:     '机甲动漫风格，精细机械设计，铬合金与霓虹色，科幻军事美学',
};

const DIM_SUFFIX_CN = {
  '2d': '2D平面插画，动漫风格，干净线条',
  '3d': '写实3D渲染，电影级光影，超高清8K',
};

const ANIMAL_RACES = ['动物','宠物','神兽','怪兽'];

// 即梦AI 专用 prompt（全中文，主体描述优先）
function buildJimengPrompt(name, role, description, dim = '2d', race = '人', species = '', animStyle = '') {
  const isAnimal = ANIMAL_RACES.includes(race);
  console.log(`[buildJimengPrompt] race=${JSON.stringify(race)}, species=${JSON.stringify(species)}, isAnimal=${isAnimal}, ANIMAL_RACES=${JSON.stringify(ANIMAL_RACES)}`);
  const styleKey = animStyle && STYLE_PROMPTS_CN[animStyle] ? animStyle : 'celulose';
  const styleCN = STYLE_PROMPTS_CN[styleKey];
  const dimCN = DIM_SUFFIX_CN[dim] || DIM_SUFFIX_CN['2d'];

  if (isAnimal) {
    const creatureType = species || race;
    const parts = [`${creatureType}，${name}`];
    if (description) parts.push(description.replace(/\n/g, ' ').substring(0, 200));
    parts.push(styleCN);
    parts.push(dimCN);
    parts.push('完整身体设计，从头到尾，居中构图，高质量，精细，干净背景');
    return parts.join('，');
  }

  const roleMap = { main: '主角', supporting: '配角', villain: '反派', mentor: '导师', other: '角色' };
  const roleLabel = roleMap[role] || '角色';
  const parts = [`${name}，${roleLabel}，全身角色设计`];
  if (description) parts.push(description.replace(/\n/g, ' ').substring(0, 250));
  parts.push(styleCN);
  parts.push(dimCN);
  parts.push('全身正面站立，角色设定图风格，精细面部和服装，干净背景，高质量');
  return parts.join('，');
}

function buildPrompt(name, role, description, dim = '2d', race = '人', species = '', animStyle = '') {
  const styleKey = animStyle && STYLE_PROMPTS[animStyle] ? animStyle : 'celulose';
  const isAnimal = ANIMAL_RACES.includes(race);
  if (isAnimal) {
    const creatureType = species || race;
    const parts = [`${name}, ${creatureType}`];
    if (description) parts.push(description.replace(/\n/g, ' ').substring(0, 180));
    parts.push(STYLE_PROMPTS[styleKey]);
    if (dim && DIM_SUFFIX[dim]) parts.push(DIM_SUFFIX[dim]);
    parts.push('full body creature design, showing head to tail, centered composition, high quality, detailed, clean background');
    return parts.join(', ');
  }
  const roleMap = { main: 'protagonist', supporting: 'supporting character', villain: 'villain', mentor: 'mentor', other: 'character' };
  const roleLabel = roleMap[role] || 'character';
  const parts = [`full body character design of ${name}, ${roleLabel}`];
  if (description) parts.push(description.replace(/\n/g, ' ').substring(0, 250));
  parts.push(STYLE_PROMPTS[styleKey]);
  if (dim && DIM_SUFFIX[dim]) parts.push(DIM_SUFFIX[dim]);
  parts.push('full body shot from head to feet, standing pose, front view, character turnaround sheet style, detailed face and clothing, clean background, high quality');
  return parts.join(', ');
}

// 从描述中去除人物/动作内容，只保留环境信息
function stripCharacterContent(desc) {
  if (!desc) return '';
  // 提取方括号中的环境标签内容（[地理环境]、[光影]、[细节]等）
  const envTags = desc.match(/\[(?:地理环境|光影|细节|场景|环境|背景|天气|氛围)[^\]]*\][^[]*(?=\[|$)/g);
  if (envTags && envTags.length > 0) {
    return envTags.join(' ').trim();
  }
  // 去掉包含人物动作的短句（中文）
  let clean = desc.replace(/[^，。、；\n]*(?:走|跑|站|坐|说|看|打|挥|握|拿|举|转身|回头|微笑|哭|笑|喊|叫|冲|跳|飞|踢|挡|躲|闪|追|逃|倒|躺|蹲|跪|抱|扔|拉|推|砍|刺|射|吼|怒|惊|喜|悲|叹|角色|人物|主角|少年|少女|男|女|老人|孩子|身穿|手持|头戴|腰间|肩上)[^，。、；\n]*/g, '');
  // 去掉英文中的人物动作描述
  clean = clean.replace(/\b(he|she|they|him|her|character|person|man|woman|boy|girl|figure|protagonist|hero|heroine|warrior|sword|weapon)\b[^,.;]*/gi, '');
  // 去掉 Character 描述块
  clean = clean.replace(/\[Character[^\]]*\][^,.]*/gi, '');
  // 清理多余标点
  clean = clean.replace(/[，,]{2,}/g, '，').replace(/^[，,\s]+|[，,\s]+$/g, '');
  return clean || desc;
}

// 场景图片 prompt
function buildScenePrompt(title, description, theme, timeOfDay, category, dim = '2d', animStyle = '') {
  const parts = [];
  const cleanDesc = stripCharacterContent(description);
  parts.push(`background environment scene: ${title || 'scene'}, ${cleanDesc || 'cinematic landscape'}`);
  if (theme) parts.push(`${theme} genre`);
  if (timeOfDay) {
    const timeMap = { '白天': 'bright daylight', '傍晚': 'sunset golden hour', '夜晚': 'night scene, moonlight', '清晨': 'early morning, dawn', '黄昏': 'twilight, dusk' };
    parts.push(timeMap[timeOfDay] || timeOfDay);
  }
  if (category) {
    const catMap = { '室外': 'outdoor', '室内': 'indoor interior', '战场': 'battlefield', '自然': 'nature landscape', '城市': 'cityscape urban' };
    parts.push(catMap[category] || category);
  }
  // 使用选定的风格，而非硬编码
  const styleKey = animStyle && STYLE_PROMPTS[animStyle] ? animStyle : 'celulose';
  parts.push(STYLE_PROMPTS[styleKey]);
  if (dim && DIM_SUFFIX[dim]) parts.push(DIM_SUFFIX[dim]);
  parts.push('wide angle establishing shot, cinematic composition, detailed environment, concept art, background only, NO people, NO characters, NO figures, NO human, empty scene, high quality');
  return parts.join(', ');
}

function resolveProvider(dim) {
  const explicit = process.env.IMAGE_PROVIDER;
  if (explicit && explicit !== 'auto') return explicit;

  // 按维度选择
  if (dim === '3d') {
    if (getApiKey('jimeng'))    return 'jimeng';
    if (getApiKey('stability')) return 'stability';
    if (getApiKey('openai'))    return 'openai';
    if (getApiKey('replicate')) return 'replicate';
  } else {
    if (getApiKey('jimeng'))    return 'jimeng';
    if (getApiKey('zhipu'))     return 'zhipu';
    if (getApiKey('replicate')) return 'replicate';
    if (getApiKey('stability')) return 'stability';
    if (getApiKey('openai'))    return 'openai';
  }
  return 'demo';
}

const DEMO_COLORS = {
  celulose:  ['0x7a3a8c', '0x5a2a6c', '0x3e1a5c'],
  urban:     ['0x1a0830', '0x180828', '0x0d0518'],
  '3dcg':    ['0x0d1b3e', '0x1a3060', '0x0f2050'],
  shadow:    ['0x6b2800', '0x4a1800', '0x2d1000'],
  cyberpunk: ['0x000040', '0x00003a', '0x000028'],
  pixel:     ['0x3a1888', '0x2a1060', '0x150a28'],
  chinese:   ['0x4a0e0e', '0x3a0808', '0x200505'],
  ghibli:    ['0x1e4a20', '0x2e6030', '0x1a3a1a'],
  western:   ['0x181828', '0x101020', '0x080810'],
};

// Demo: FFmpeg 生成占位图（异步，不阻塞事件循环）
async function generateDemoImage({ name, filename }) {
  ensureDir();
  const outputPath = path.join(CHAR_IMG_DIR, `${filename}.png`);
  const palette = DEMO_COLORS.celulose;
  const color = palette[Math.floor(Math.random() * palette.length)];
  const safeName = (name || '角色').replace(/['"\\:<>]/g, ' ').substring(0, 12);
  const styleLabel = 'Demo';

  const cmd = [
    `"${ffmpegPath}"`,
    `-f lavfi -i "color=c=${color}:size=512x512:duration=1"`,
    `-vframes 1`,
    `-vf "drawtext=text='${safeName}':fontsize=60:fontcolor=white:x=(w-text_w)/2:y=h/2-30:alpha=0.9,`,
    `drawtext=text='${styleLabel}':fontsize=18:fontcolor=0x888888:x=(w-text_w)/2:y=h/2+50:alpha=0.5"`,
    `-y "${outputPath}"`
  ].join(' ');

  await new Promise((resolve, reject) => {
    exec(cmd, { stdio: 'pipe' }, (err) => err ? reject(err) : resolve());
  });
  return outputPath;
}

// OpenAI DALL-E 3
async function generateOpenAIImage({ name, role, description, filename, race, species, imageType = 'character' }) {
  const apiKey = getApiKey('openai') || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('未配置 OPENAI_API_KEY');
  ensureDir();
  const outputPath = path.join(CHAR_IMG_DIR, `${filename}.png`);
  const prompt = imageType === 'scene'
    ? buildScenePrompt(name, description, race, species, '')
    : buildPrompt(name, role, description, '2d', race, species);
  // Full body character → portrait; scene → landscape
  const size = imageType === 'scene' ? '1792x1024' : '1024x1792';

  const body = JSON.stringify({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size,
    response_format: 'url'
  });

  const result = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/images/generations',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });

  if (result.error) throw new Error(`DALL-E: ${result.error.message}`);
  const imageUrl = result.data?.[0]?.url;
  if (!imageUrl) throw new Error('DALL-E 未返回图片');
  await downloadFile(imageUrl, outputPath);
  return outputPath;
}

// 智谱 CogView-3-Flash
async function generateZhipuImage({ name, role, description, filename, race, species, imageType = 'character' }) {
  const apiKey = getApiKey('zhipu') || process.env.ZHIPU_API_KEY;
  if (!apiKey) throw new Error('未配置 ZHIPU_API_KEY');
  ensureDir();
  const outputPath = path.join(CHAR_IMG_DIR, `${filename}.png`);
  const prompt = imageType === 'scene'
    ? buildScenePrompt(name, description, race, species, '')
    : buildPrompt(name, role, description, '2d', race, species);

  const body = JSON.stringify({ model: 'cogview-3-flash', prompt, size: '1024x1024' });

  const result = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'open.bigmodel.cn',
      path: '/api/paas/v4/images/generations',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });

  if (result.error) throw new Error(`CogView: ${result.error.message || JSON.stringify(result.error)}`);
  const imageUrl = result.data?.[0]?.url;
  if (!imageUrl) throw new Error('CogView 未返回图片');
  await downloadFile(imageUrl, outputPath);
  return outputPath;
}

// ——— Stability AI SD 3.5 ———
async function generateStabilityImage({ name, role, description, dim, filename, race, species }) {
  const apiKey = getApiKey('stability') || process.env.STABILITY_API_KEY;
  if (!apiKey) throw new Error('未配置 STABILITY_API_KEY');
  ensureDir();
  const outputPath = path.join(CHAR_IMG_DIR, `${filename}.png`);
  const prompt = buildPrompt(name, role, description, dim, race, species);
  const model = dim === '3d' ? 'sd3.5-large' : 'sd3.5-large-turbo';

  // Stability API uses multipart/form-data
  const boundary = '----VIDOBoundary' + Date.now();
  const formParts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="output_format"\r\n\r\npng`,
    `--${boundary}--`,
  ];
  const body = Buffer.from(formParts.join('\r\n'), 'utf8');

  const imgData = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.stability.ai',
      path: '/v2beta/stable-image/generate/sd3',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'image/*',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Stability AI HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString().substring(0, 200)}`));
        } else {
          resolve(Buffer.concat(chunks));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  fs.writeFileSync(outputPath, imgData);
  return outputPath;
}

// ——— Replicate FLUX ———
async function generateReplicateImage({ name, role, description, dim, filename, race, species }) {
  const apiKey = getApiKey('replicate') || process.env.REPLICATE_API_KEY;
  if (!apiKey) throw new Error('未配置 REPLICATE_API_KEY');
  ensureDir();
  const outputPath = path.join(CHAR_IMG_DIR, `${filename}.png`);
  const prompt = buildPrompt(name, role, description, dim, race, species);
  // Use flux-schnell for 2D (fast), flux-dev for 3D (quality)
  const model = dim === '3d'
    ? 'black-forest-labs/flux-dev'
    : 'black-forest-labs/flux-schnell';

  const body = JSON.stringify({ input: { prompt, num_outputs: 1, aspect_ratio: '1:1', output_format: 'png', num_inference_steps: dim === '3d' ? 28 : 4 } });

  // Submit prediction
  const prediction = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.replicate.com',
      path: `/v1/models/${model}/predictions`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Prefer': 'wait=30',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  // Poll until complete
  let result = prediction;
  let attempts = 0;
  while (result.status !== 'succeeded' && result.status !== 'failed' && attempts < 30) {
    await new Promise(r => setTimeout(r, 2000));
    result = await new Promise((resolve, reject) => {
      https.get({
        hostname: 'api.replicate.com',
        path: `/v1/predictions/${result.id}`,
        headers: { 'Authorization': `Bearer ${apiKey}` },
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
    attempts++;
  }

  if (result.status !== 'succeeded') throw new Error('Replicate 生成失败: ' + (result.error || result.status));
  const imageUrl = Array.isArray(result.output) ? result.output[0] : result.output;
  if (!imageUrl) throw new Error('Replicate 未返回图片 URL');
  await downloadFile(imageUrl, outputPath);
  return outputPath;
}

// ——— 即梦AI（Volcengine）图片生成 ———
function _signJimeng(ak, sk, { method, query, body }) {
  const crypto = require('crypto');
  const now = new Date();
  const xDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z/, 'Z').replace('Z', '').replace('T', 'T') + 'Z';
  const dateStr = xDate.substring(0, 8);
  const host = 'visual.volcengineapi.com';
  const region = 'cn-north-1';
  const service = 'cv';
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
  const sortedQuery = Object.keys(query).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&');
  const canonHeaders = `content-type:application/json\nhost:${host}\nx-content-sha256:${bodyHash}\nx-date:${xDate}\n`;
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const canonRequest = [method.toUpperCase(), '/', sortedQuery, canonHeaders, signedHeaders, bodyHash].join('\n');
  const credentialScope = `${dateStr}/${region}/${service}/request`;
  const stringToSign = ['HMAC-SHA256', xDate, credentialScope, crypto.createHash('sha256').update(canonRequest).digest('hex')].join('\n');
  const hmac = (key, data, enc) => require('crypto').createHmac('sha256', key).update(data).digest(enc || undefined);
  const signingKey = hmac(hmac(hmac(hmac(sk, dateStr), region), service), 'request');
  const signature = hmac(signingKey, stringToSign, 'hex');
  return {
    'Authorization': `HMAC-SHA256 Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'X-Date': xDate, 'X-Content-Sha256': bodyHash, 'Content-Type': 'application/json', 'Host': host
  };
}

// 即梦 API 通用请求
function _jimengRequest(ak, sk, query, body) {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = _signJimeng(ak, sk, { method: 'POST', query, body: bodyStr });
  return new Promise((resolve, reject) => {
    const qs = Object.keys(query).sort().map(k => `${k}=${query[k]}`).join('&');
    const req = https.request({
      hostname: 'visual.volcengineapi.com', path: '/?' + qs, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          if (json.ResponseMetadata?.Error) return reject(new Error('即梦AI: ' + (json.ResponseMetadata.Error.Message || JSON.stringify(json.ResponseMetadata.Error))));
          resolve(json);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject); req.write(bodyStr); req.end();
  });
}

async function generateJimengImage({ prompt, filename, dim = '2d' }) {
  const rawKey = getApiKey('jimeng') || process.env.JIMENG_API_KEY;
  if (!rawKey) throw new Error('未配置即梦AI Key');
  if (!rawKey.includes(':')) throw new Error('即梦AI Key 格式错误，应为 AccessKeyId:SecretAccessKey');
  const [ak, sk] = rawKey.split(':');
  ensureDir();
  const outputPath = path.join(CHAR_IMG_DIR, `${filename}.png`);

  // 选择模型：从 settings 读取 use=image 的模型，否则用默认 3.0
  let reqKey = 'jimeng_t2i_v30';
  try {
    const { loadSettings } = require('./settingsService');
    const settings = loadSettings();
    const p = settings.providers.find(p => p.id === 'jimeng' && p.enabled);
    const m = (p?.models || []).find(m => m.enabled !== false && m.use === 'image');
    if (m?.id) reqKey = m.id;
  } catch {}

  // 判断是否 3.0+ 异步接口（jimeng_ 开头）还是旧版同步接口
  const isAsync = reqKey.startsWith('jimeng_');

  console.log(`[Jimeng Image] reqKey=${reqKey}, async=${isAsync}`);

  if (isAsync) {
    // ——— 3.0 异步接口：CVSync2AsyncSubmitTask + CVSync2AsyncGetResult ———
    const query = { Action: 'CVSync2AsyncSubmitTask', Version: '2022-08-31' };
    const reqJson = JSON.stringify({
      logo_info: { add_logo: false }
    });
    const submitBody = JSON.stringify({
      req_key: reqKey,
      prompt: prompt.substring(0, 800),
      seed: -1,
      width: 1024,
      height: 1024,
      use_pre_llm: true,
      return_url: true,
      req_json: reqJson
    });

    const task = await _jimengRequest(ak, sk, query, submitBody);
    console.log('[Jimeng Image] submit response:', JSON.stringify(task).substring(0, 500));

    const taskId = task.data?.task_id;
    if (!taskId) throw new Error('即梦AI 未返回任务ID: ' + JSON.stringify(task).substring(0, 300));

    // 轮询结果（最多 2 分钟）
    const queryAction = { Action: 'CVSync2AsyncGetResult', Version: '2022-08-31' };
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const queryBody = JSON.stringify({ req_key: reqKey, task_id: taskId });
      const result = await _jimengRequest(ak, sk, queryAction, queryBody);
      const rd = result.data || {};
      console.log(`[Jimeng Image] poll #${i+1}: status=${rd.status}`);
      if (rd.status === 'done') {
        const images = rd.image_urls || [];
        const b64List = rd.binary_data_base64 || [];
        if (images.length) { await downloadFile(images[0], outputPath); return outputPath; }
        if (b64List.length) { fs.writeFileSync(outputPath, Buffer.from(b64List[0], 'base64')); return outputPath; }
        throw new Error('即梦AI 已完成但未返回图片');
      }
      if (rd.status === 'failed') throw new Error('即梦AI 生成失败: ' + (rd.message || ''));
    }
    throw new Error('即梦AI 图片生成超时');

  } else {
    // ——— 旧版同步接口：CVProcess ———
    const query = { Action: 'CVProcess', Version: '2022-08-31' };
    const submitBody = JSON.stringify({
      req_key: reqKey,
      prompt: prompt.substring(0, 2000),
      seed: -1,
      width: 1024,
      height: 1024
    });
    const result = await _jimengRequest(ak, sk, query, submitBody);
    console.log('[Jimeng Image] CVProcess response:', JSON.stringify(result).substring(0, 500));

    if (result.code !== 10000 && result.data?.status_code !== 0) {
      throw new Error('即梦AI 生成失败: ' + (result.message || JSON.stringify(result).substring(0, 200)));
    }
    const images = result.data?.image_urls || [];
    const b64List = result.data?.binary_data_base64 || [];
    if (images.length) { await downloadFile(images[0], outputPath); return outputPath; }
    if (b64List.length) { fs.writeFileSync(outputPath, Buffer.from(b64List[0], 'base64')); return outputPath; }
    throw new Error('即梦AI 未返回图片: ' + JSON.stringify(result).substring(0, 300));
  }
}

// ——— 主入口 ———
async function generateCharacterImage({ name, role = 'main', description = '', dim = '2d', race = '人', species = '', animStyle = '' }) {
  const provider = resolveProvider(dim);
  const dimTag = dim === '3d' ? '3d' : '2d';
  const filename = `char_${dimTag}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const prompt = provider === 'jimeng'
    ? buildJimengPrompt(name, role, description, dim, race, species, animStyle)
    : buildPrompt(name, role, description, dim, race, species, animStyle);

  console.log(`[ImageService] 角色「${name}」→ provider=${provider}, dim=${dim}`);
  console.log(`[ImageService] prompt: ${prompt.substring(0, 200)}`);

  let filePath;
  switch (provider) {
    case 'jimeng':    filePath = await generateJimengImage({ prompt, filename, dim }); break;
    case 'openai':    filePath = await generateOpenAIImage({ name, role, description, filename, race, species }); break;
    case 'zhipu':     filePath = await generateZhipuImage({ name, role, description, filename, race, species });  break;
    case 'stability': filePath = await generateStabilityImage({ name, role, description, dim, filename, race, species }); break;
    case 'replicate': filePath = await generateReplicateImage({ name, role, description, dim, filename, race, species }); break;
    default:          filePath = await generateDemoImage({ name, filename }); break;
  }
  return { filePath, filename: path.basename(filePath) };
}

// 即梦AI 专用中文场景 prompt
function buildJimengScenePrompt(title, description, theme, timeOfDay, category, dim = '2d', animStyle = '') {
  const parts = [];
  const cleanDesc = stripCharacterContent(description);
  parts.push(`纯背景环境场景：${title || '场景'}，${cleanDesc || '电影级场景'}`);
  if (theme) parts.push(`${theme}题材`);
  if (timeOfDay) parts.push(timeOfDay);
  if (category) parts.push(category);
  const styleKey = animStyle && STYLE_PROMPTS_CN[animStyle] ? animStyle : 'celulose';
  parts.push(STYLE_PROMPTS_CN[styleKey]);
  parts.push(DIM_SUFFIX_CN[dim] || DIM_SUFFIX_CN['2d']);
  parts.push('广角全景镜头，电影构图，精细环境，概念艺术，纯背景，禁止出现人物，禁止出现角色，无人物，空场景，高质量');
  return parts.join('，');
}

// ——— 场景图片生成（复用 provider，但使用场景 prompt） ———
const SCENE_IMG_DIR = path.join(OUTPUT_DIR, 'scenes');

async function generateSceneImage({ title = '', description = '', theme = '', timeOfDay = '', category = '', dim = '2d', animStyle = '' }) {
  fs.mkdirSync(SCENE_IMG_DIR, { recursive: true });
  const provider = resolveProvider(dim);
  const filename = `scene_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const prompt = provider === 'jimeng'
    ? buildJimengScenePrompt(title, description, theme, timeOfDay, category, dim, animStyle)
    : buildScenePrompt(title, description, theme, timeOfDay, category, dim, animStyle);
  ensureDir();

  console.log(`[ImageService] 场景「${title}」→ provider=${provider}, dim=${dim}`);

  let filePath;
  switch (provider) {
    case 'jimeng':
      filePath = await generateJimengImage({ prompt, filename, dim });
      break;
    case 'zhipu':
      filePath = await generateZhipuImage({ name: title, role: '', description, filename, race: '', species: '', imageType: 'scene' });
      break;
    case 'openai':
      filePath = await generateOpenAIImage({ name: title, role: '', description, filename, race: '', species: '', imageType: 'scene' });
      break;
    case 'stability':
      filePath = await generateStabilityImage({ name: title, role: '', description, dim, filename, race: '', species: '' });
      break;
    case 'replicate':
      filePath = await generateReplicateImage({ name: title, role: '', description, dim, filename, race: '', species: '' });
      break;
    default:
      filePath = await generateDemoImage({ name: title || '场景', filename });
      break;
  }
  return { filePath, filename: path.basename(filePath) };
}

module.exports = { generateCharacterImage, generateSceneImage, CHAR_IMG_DIR, SCENE_IMG_DIR };
