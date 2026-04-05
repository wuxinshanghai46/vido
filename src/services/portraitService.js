/**
 * 形象生成服务 — 上传照片 → AI 生成 2D/3D 卡通形象
 *
 * 流程：
 *   1. 上传照片
 *   2. 用 LLM（视觉）分析照片中的人物外貌特征
 *   3. 用描述 + 风格提示词生成 2D/3D 卡通形象
 *   4. 对于支持 img2img 的供应商，直接用照片做参考
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { getApiKey } = require('./settingsService');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');
const PORTRAIT_DIR = path.join(OUTPUT_DIR, 'portraits');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    proto.get(url, { headers: { 'User-Agent': 'VIDO/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        file.close();
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

// ——— 2D 风格提示词 ———
const STYLE_2D = {
  prompt: 'anime character design, clean cel-shaded coloring, flat vibrant colors, bold linework, large expressive eyes, anime aesthetic, manga illustration, professional character turnaround sheet, front view, 3/4 view, white background, full body standing pose',
  negative: 'realistic, photographic, 3D render, blurry, deformed, ugly, bad anatomy, disfigured'
};

// ——— 3D 风格提示词 ———
const STYLE_3D = {
  prompt: 'high quality 3D CGI character render, Pixar Disney style, smooth subsurface scattering skin, cinematic lighting, octane render, detailed textures, professional character design, front view, 3/4 view, neutral background, full body standing pose, 8K',
  negative: '2D, flat, sketch, lineart, anime, blurry, deformed, ugly, bad anatomy'
};

// ——— 用 LLM 视觉分析照片中人物外貌 ———
async function analyzePortrait(imagePath) {
  // 将图片转为 base64
  const imgData = fs.readFileSync(imagePath);
  const base64 = imgData.toString('base64');
  const ext = path.extname(imagePath).toLowerCase().replace('.', '');
  const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const dataUrl = `data:${mime};base64,${base64}`;

  // 尝试使用支持视觉的 LLM
  const config = getVisionConfig();
  if (!config) {
    // 没有视觉模型，返回通用描述
    return { description_cn: '人物角色', description_en: 'a character', features: {} };
  }

  const systemPrompt = '你是专业的角色设计师。分析照片中人物的外貌特征，用于生成卡通形象。';
  const userContent = [
    { type: 'text', text: `请详细分析这张照片中人物的外貌特征，输出JSON格式：
{
  "gender": "男/女",
  "age_range": "年龄段（如：青年、中年）",
  "hair": "发型和发色描述",
  "face": "脸型和五官特征",
  "skin": "肤色",
  "body": "体型",
  "clothing": "服装描述",
  "accessories": "配饰",
  "expression": "表情",
  "description_cn": "完整中文外貌描述（一段话，150字内）",
  "description_en": "Complete English appearance description (one paragraph, detailed, for image generation)"
}
只输出JSON，不要其他内容。` },
    { type: 'image_url', image_url: { url: dataUrl } }
  ];

  try {
    let result;
    if (config.providerId === 'anthropic') {
      result = await callAnthropicVision(config, systemPrompt, userContent, base64, mime);
    } else {
      result = await callOpenAIVision(config, systemPrompt, userContent);
    }
    // 解析 JSON
    let str = result.trim();
    const m = str.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) str = m[1].trim();
    return JSON.parse(str);
  } catch (err) {
    console.error('[PortraitService] LLM 视觉分析失败:', err.message);
    return { description_cn: '人物角色', description_en: 'a character portrait', features: {} };
  }
}

// 获取支持视觉的 LLM 配置
function getVisionConfig() {
  try {
    const { loadSettings } = require('./settingsService');
    const settings = loadSettings();
    // 查找支持视觉的模型（GPT-4o, Claude, Qwen-VL 等）
    const visionModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5', 'qwen-vl-max', 'qwen-vl-plus', 'glm-4v', 'glm-4v-flash'];
    for (const provider of settings.providers) {
      if (!provider.enabled || !provider.api_key) continue;
      for (const model of (provider.models || [])) {
        if (model.enabled === false) continue;
        if (visionModels.some(vm => model.id.includes(vm) || model.id.includes('vision'))) {
          return { apiKey: provider.api_key, baseURL: provider.api_url, model: model.id, providerId: provider.id };
        }
      }
      // 如果供应商有 story 模型且是已知支持视觉的
      const storyModel = (provider.models || []).find(m => m.use === 'story' && m.enabled !== false);
      if (storyModel && visionModels.some(vm => storyModel.id.includes(vm))) {
        return { apiKey: provider.api_key, baseURL: provider.api_url, model: storyModel.id, providerId: provider.id };
      }
    }
  } catch {}
  // env fallback
  if (process.env.OPENAI_API_KEY) return { apiKey: process.env.OPENAI_API_KEY, baseURL: null, model: 'gpt-4o-mini', providerId: 'openai' };
  if (process.env.CLAUDE_API_KEY) return { apiKey: process.env.CLAUDE_API_KEY, baseURL: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-6', providerId: 'anthropic' };
  return null;
}

// OpenAI 兼容视觉调用
async function callOpenAIVision(config, systemPrompt, userContent) {
  const OpenAI = require('openai');
  const opts = { apiKey: config.apiKey };
  if (config.baseURL) opts.baseURL = config.baseURL;
  const client = new OpenAI(opts);
  const res = await client.chat.completions.create({
    model: config.model,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ]
  });
  return res.choices[0].message.content;
}

// Anthropic 视觉调用
async function callAnthropicVision(config, systemPrompt, userContent, base64, mime) {
  const mediaType = mime === 'image/jpeg' ? 'image/jpeg' : mime === 'image/png' ? 'image/png' : 'image/webp';
  const body = JSON.stringify({
    model: config.model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: userContent.find(c => c.type === 'text').text }
      ]
    }]
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01',
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body)
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          if (data.error) return reject(new Error(data.error.message));
          resolve(data.content[0].text);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ——— Stability AI img2img ———
async function generateStabilityImg2Img(imagePath, prompt, dim) {
  const apiKey = getApiKey('stability') || process.env.STABILITY_API_KEY;
  if (!apiKey) return null;

  ensureDir(PORTRAIT_DIR);
  const suffix = dim === '3d' ? '3d' : '2d';
  const filename = `portrait_${suffix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
  const outputPath = path.join(PORTRAIT_DIR, filename);

  const imgBuf = fs.readFileSync(imagePath);
  const boundary = '----VIDOPortrait' + Date.now();

  // Stability img2img: send image + prompt + strength
  const style = dim === '3d' ? STYLE_3D : STYLE_2D;
  const fullPrompt = `${prompt}, ${style.prompt}`;
  const strength = dim === '3d' ? 0.72 : 0.65; // 2D 保留更多原始特征

  const parts = [];
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`);
  const imgPart = Buffer.from(parts[0]);
  parts.length = 0;

  const textFields = [
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${fullPrompt}`,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="negative_prompt"\r\n\r\n${style.negative}`,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="strength"\r\n\r\n${strength}`,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${dim === '3d' ? 'sd3.5-large' : 'sd3.5-large-turbo'}`,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="output_format"\r\n\r\npng`,
    `\r\n--${boundary}--`,
  ];
  const textBuf = Buffer.from(textFields.join(''));
  const body = Buffer.concat([imgPart, imgBuf, textBuf]);

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
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`Stability img2img HTTP ${res.statusCode}`));
        else resolve(Buffer.concat(chunks));
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });

  fs.writeFileSync(outputPath, imgData);
  return { filename, path: outputPath };
}

// ——— 通用文本生成（基于描述） ———
async function generateFromDescription(description, dim) {
  const { generateCharacterImage } = require('./imageService');
  const style = dim === '3d' ? STYLE_3D : STYLE_2D;
  const fullDesc = `${description}, ${style.prompt}`;

  const result = await generateCharacterImage({
    name: `portrait_${dim}`,
    role: 'main',
    description: fullDesc,
    dim: dim,
    race: '人',
    species: '',
    animStyle: dim === '3d' ? '3dcg' : 'celulose'
  });

  // 复制到 portraits 目录
  ensureDir(PORTRAIT_DIR);
  const filename = `portrait_${dim}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
  const destPath = path.join(PORTRAIT_DIR, filename);
  if (result.filePath && fs.existsSync(result.filePath)) {
    fs.copyFileSync(result.filePath, destPath);
  }
  return { filename, path: destPath };
}

// ——— Demo 模式：FFmpeg 卡通化滤镜 ———
async function generateDemoPortrait(imagePath, dim) {
  const ffmpegStatic = require('ffmpeg-static');
  const { exec } = require('child_process');
  const ffmpegPath = (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== 'ffmpeg')
    ? process.env.FFMPEG_PATH : ffmpegStatic;

  ensureDir(PORTRAIT_DIR);
  const suffix = dim === '3d' ? '3d' : '2d';
  const filename = `portrait_${suffix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
  const outputPath = path.join(PORTRAIT_DIR, filename);

  // 2D: 边缘检测 + 色调简化 (卡通效果)
  // 3D: 柔化 + 增强对比度 + 暖色调 (CG 感)
  const filter = dim === '3d'
    ? 'smartblur=1:0.5:0,eq=contrast=1.3:saturation=1.4:brightness=0.05,unsharp=5:5:1.2'
    : 'edgedetect=mode=colormix:high=0.1,eq=saturation=1.8:contrast=1.2,colorbalance=rs=0.1:gs=-0.05:bs=0.15';

  const cmd = `"${ffmpegPath}" -i "${imagePath}" -vf "${filter}" -y "${outputPath}"`;

  await new Promise((resolve, reject) => {
    exec(cmd, { stdio: 'pipe' }, (err) => err ? reject(err) : resolve());
  });
  return { filename, path: outputPath };
}

// ——— 主入口：生成卡通形象 ———
async function generatePortrait(imagePath, dim = '2d', progressCallback) {
  const progress = (step, pct, msg) => {
    if (progressCallback) progressCallback({ step, progress: pct, message: msg });
  };

  // 1. 分析照片
  progress('analyze', 10, '正在分析照片中的人物特征...');
  let analysis;
  try {
    analysis = await analyzePortrait(imagePath);
  } catch (err) {
    console.error('[PortraitService] 分析失败:', err.message);
    analysis = { description_en: 'a person', description_cn: '人物' };
  }
  progress('analyze', 30, `识别完成：${analysis.description_cn?.substring(0, 50) || '人物'}...`);

  // 2. 生成卡通形象
  progress('generate', 40, `正在生成${dim === '3d' ? '3D' : '2D'}卡通形象...`);

  let result;
  // 优先尝试 Stability img2img
  try {
    result = await generateStabilityImg2Img(imagePath, analysis.description_en || '', dim);
  } catch (err) {
    console.log('[PortraitService] Stability img2img 不可用:', err.message);
  }

  // 回退到基于描述的文生图
  if (!result) {
    try {
      const desc = analysis.description_en || analysis.description_cn || 'a character';
      result = await generateFromDescription(desc, dim);
    } catch (err) {
      console.log('[PortraitService] 文生图失败:', err.message);
    }
  }

  if (!result) {
    throw new Error('形象生成失败：所有可用供应商均无法生成，请检查API配置。');
  }

  progress('done', 100, '形象生成完成！');

  return {
    ...result,
    analysis,
    dim
  };
}

module.exports = { generatePortrait, analyzePortrait, PORTRAIT_DIR };
