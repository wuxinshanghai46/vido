require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const ffmpegStatic = require('ffmpeg-static');
const { execSync } = require('child_process');

const ffmpegPath = (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== 'ffmpeg')
  ? process.env.FFMPEG_PATH
  : ffmpegStatic;

// ——— 工具函数 ———
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    proto.get(url, { headers: { 'User-Agent': 'VIDO/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(destPath)));
    }).on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
  });
}

// ——— Demo 模式：FFmpeg 生成带文字的占位视频 ———
async function generateDemoClip({ prompt, duration = 5, outputDir, filename, sceneTitle = '', sceneIndex = 0 }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${filename}.mp4`);

  // 截取提示词前60字符作为显示文字
  const displayText = (sceneTitle || prompt).replace(/['"\\:]/g, ' ').substring(0, 50);
  const sceneNum = `Scene ${sceneIndex + 1}`;
  const clipDuration = Math.min(Math.max(duration, 3), 15);

  // 用 FFmpeg 生成: 渐变色背景 + 场景文字
  const colors = ['0x1a1a2e', '0x16213e', '0x0f3460', '0x533483', '0x2d132c', '0x1b262c'];
  const bgColor = colors[sceneIndex % colors.length];

  const cmd = [
    `"${ffmpegPath}"`,
    `-f lavfi -i "color=c=${bgColor}:size=1280x720:duration=${clipDuration}:rate=24"`,
    `-vf "drawtext=text='${sceneNum}':fontsize=36:fontcolor=white:x=(w-text_w)/2:y=h/2-60:alpha=0.9,`,
    `drawtext=text='${displayText}':fontsize=22:fontcolor=0xcccccc:x=(w-text_w)/2:y=h/2:alpha=0.8,`,
    `drawtext=text='[Demo Mode]':fontsize=16:fontcolor=0x888888:x=(w-text_w)/2:y=h/2+50:alpha=0.6"`,
    `-c:v libx264 -pix_fmt yuv420p -y`,
    `"${outputPath}"`
  ].join(' ');

  execSync(cmd, { stdio: 'pipe' });
  return { filePath: outputPath };
}

// ——— HuggingFace 模式：ModelScope text-to-video ———
async function generateHuggingFaceClip({ prompt, duration = 3, outputDir, filename, video_model }) {
  const { getApiKey } = require('./settingsService');
  const apiKey = getApiKey('huggingface') || process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) throw new Error('未配置 HUGGINGFACE_API_KEY');

  const modelPath = video_model || 'damo-vilab/text-to-video-ms-1.7b';

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${filename}.mp4`);

  const body = JSON.stringify({ inputs: prompt });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api-inference.huggingface.co',
      path: `/models/${modelPath}`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        // 检查是否返回错误 JSON
        if (res.headers['content-type']?.includes('application/json')) {
          const json = JSON.parse(buf.toString());
          if (json.error) return reject(new Error(`HuggingFace: ${json.error}`));
        }
        // 写入视频文件
        fs.writeFileSync(outputPath, buf);
        resolve({ filePath: outputPath });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ——— 智谱AI CogVideoX 模式（国内免费）———
async function generateZhipuClip({ prompt, duration = 5, outputDir, filename, image_url, video_model }) {
  const { getApiKey, loadSettings } = require('./settingsService');
  const apiKey = getApiKey('zhipu') || process.env.ZHIPU_API_KEY;
  if (!apiKey) throw new Error('未配置智谱 AI Key，请在「AI 配置」页面添加智谱供应商');

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${filename}.mp4`);

  // 优先使用用户选择的 video_model，回退到 settings，再回退默认
  let modelId = 'cogvideox-flash';
  if (video_model) {
    modelId = video_model;
  } else {
    try {
      const settings = loadSettings();
      const p = settings.providers.find(p => p.id === 'zhipu' && p.enabled);
      const m = (p?.models || []).find(m => m.enabled !== false && m.use === 'video');
      if (m?.id) modelId = m.id;
    } catch {}
  }

  // 第一步：提交生成任务
  // CogVideoX-flash 支持的 duration 值：t2v 模式 3~10 秒，i2v 模式固定 5 秒
  const bodyObj = {
    model: modelId,
    prompt
  };
  // 智谱 CogVideoX 图生视频：公网 URL 最佳，base64 也尝试（部分模型支持）
  if (image_url) {
    bodyObj.image_url = image_url;
    // i2v 模式下不传 size/duration/fps（API 会报错 "不支持当前duration值"）
    console.log(`[Zhipu] 使用${image_url.startsWith('data:') ? ' base64' : '公网 URL'} 图生视频 (i2v) 模式`);
  } else {
    // t2v 模式可以自定义参数
    bodyObj.size = '1280x720';
    bodyObj.duration = Math.min(Math.max(duration, 3), 10);
    bodyObj.fps = 30;
  }
  // 提交任务（带 i2v → t2v 自动回退）
  async function _zhipuSubmit(body) {
    const bodyStr = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'open.bigmodel.cn',
        path: '/api/paas/v4/videos/generations',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString());
            if (json.error) return reject(new Error(`智谱AI: ${json.error.message}`));
            resolve(json);
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });
  }

  // 提交任务（带 i2v → t2v 自动回退 + 限流重试）
  const isRateLimited = (msg) => /访问量过大|rate.?limit|too.?many|capacity|quota/i.test(msg || '');
  let task;
  async function submitWithRetry(body, label, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await _zhipuSubmit(body);
      } catch (e) {
        if (isRateLimited(e.message) && attempt < maxRetries - 1) {
          const wait = (attempt + 1) * 30; // 30s, 60s
          console.log(`[Zhipu] ${label} 限流，${wait}s 后重试（第 ${attempt + 1} 次）...`);
          await new Promise(r => setTimeout(r, wait * 1000));
        } else {
          throw e;
        }
      }
    }
  }

  try {
    task = await submitWithRetry(bodyObj, bodyObj.image_url ? 'i2v' : 't2v', 2);
  } catch (e) {
    // i2v 提交失败时自动回退到 t2v
    if (bodyObj.image_url) {
      console.log(`[Zhipu] i2v 提交失败 (${e.message})，回退到 t2v 模式`);
      delete bodyObj.image_url;
      // 回退到 t2v 时需要补充 size/duration/fps 参数
      bodyObj.size = '1280x720';
      bodyObj.duration = Math.min(Math.max(duration, 3), 10);
      bodyObj.fps = 30;
      task = await submitWithRetry(bodyObj, 't2v', 3);
    } else {
      throw e;
    }
  }

  const taskId = task.id;
  if (!taskId) {
    console.log(`[Zhipu] 提交响应（无 taskId）:`, JSON.stringify(task).substring(0, 500));
    throw new Error('智谱AI 未返回任务ID');
  }
  console.log(`[Zhipu] 任务已提交, taskId=${taskId}, model=${modelId}`);

  // 第二步：轮询任务状态（最多 10 分钟）
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));

    const status = await new Promise((resolve, reject) => {
      https.get(`https://open.bigmodel.cn/api/paas/v4/async-result/${taskId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
    });

    if (i % 6 === 0 || status.task_status !== 'PROCESSING') {
      console.log(`[Zhipu] 轮询 #${i}: status=${status.task_status}, keys=${Object.keys(status).join(',')}`);
    }

    if (status.task_status === 'SUCCESS') {
      const videoUrl = status.video_result?.[0]?.url;
      if (!videoUrl) {
        console.log(`[Zhipu] SUCCESS 但无 video URL:`, JSON.stringify(status).substring(0, 500));
        throw new Error('智谱AI 未返回视频URL');
      }
      console.log(`[Zhipu] 视频生成成功, URL=${videoUrl.substring(0, 100)}`);
      await downloadFile(videoUrl, outputPath);
      const fileSize = fs.statSync(outputPath).size;
      console.log(`[Zhipu] 视频已下载: ${outputPath} (${(fileSize/1024).toFixed(1)}KB)`);
      return { filePath: outputPath };
    }
    if (status.task_status === 'FAIL') {
      console.log(`[Zhipu] 任务失败:`, JSON.stringify(status).substring(0, 500));
      throw new Error(`智谱AI 生成失败: ${JSON.stringify(status).substring(0, 200)}`);
    }
  }
  throw new Error('智谱AI 生成超时（10分钟）');
}

// ——— Replicate 模式：稳定免费额度 ———
async function generateReplicateClip({ prompt, duration = 3, outputDir, filename }) {
  const { getApiKey } = require('./settingsService');
  const apiKey = getApiKey('replicate') || process.env.REPLICATE_API_KEY;
  if (!apiKey) throw new Error('未配置 Replicate API Key，请在「AI 配置」页面添加 Replicate 供应商');

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${filename}.mp4`);

  // 创建预测
  const createBody = JSON.stringify({
    version: 'a3e2eb6cb15c0c08fc9f0cde9e83b63adf12e0cf02e98e48c75e30c83dd31f28',
    input: { prompt, num_frames: Math.min(duration * 8, 48), fps: 8 }
  });

  const prediction = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.replicate.com',
      path: '/v1/predictions',
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(createBody)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
    });
    req.on('error', reject);
    req.write(createBody);
    req.end();
  });

  // 轮询等待完成（最多 5 分钟）
  const pollUrl = prediction.urls?.get;
  if (!pollUrl) throw new Error('Replicate 未返回轮询地址');

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const status = await new Promise((resolve, reject) => {
      https.get(pollUrl, { headers: { 'Authorization': `Token ${apiKey}` } }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
      }).on('error', reject);
    });

    if (status.status === 'succeeded' && status.output) {
      const videoUrl = Array.isArray(status.output) ? status.output[0] : status.output;
      await downloadFile(videoUrl, outputPath);
      return { filePath: outputPath };
    }
    if (status.status === 'failed') throw new Error(`Replicate 生成失败: ${status.error}`);
  }
  throw new Error('Replicate 生成超时');
}

// ——— Sora 2 模式（OpenAI 视频生成）———
async function generateSoraClip({ prompt, duration = 5, outputDir, filename, video_model, image_url }) {
  const OpenAI = require('openai');
  const { getApiKey, loadSettings } = require('./settingsService');
  const apiKey = getApiKey('openai') || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('未配置 OpenAI API Key，请在「AI 配置」页面添加 OpenAI 供应商');
  const client = new OpenAI({ apiKey });
  fs.mkdirSync(outputDir, { recursive: true });

  // 优先使用用户选择的模型，回退 settings，再回退默认
  let model = 'sora-2';
  if (video_model) {
    model = video_model;
  } else {
    try {
      const settings = loadSettings();
      const p = settings.providers.find(p => p.id === 'openai' && p.enabled);
      const m = (p?.models || []).find(m => m.enabled !== false && m.use === 'video');
      if (m?.id) model = m.id;
    } catch {}
  }

  const genOpts = {
    model,
    prompt: prompt.substring(0, 4000),
    n: 1,
    duration: Math.min(Math.max(duration, 5), 20),
    resolution: '1280x720',
    quality: 'standard'
  };

  // Sora 2 支持图生视频
  if (image_url) {
    if (image_url.startsWith('data:')) {
      genOpts.image = image_url;
    } else {
      genOpts.image = image_url;
    }
    console.log(`[Sora] 使用图生视频 (i2v) 模式，model=${model}`);
  } else {
    console.log(`[Sora] 使用文生视频 (t2v) 模式，model=${model}`);
  }

  const response = await client.video.generations.create(genOpts);

  const videoData = response.data[0];
  const outputPath = path.join(outputDir, `${filename}.mp4`);

  if (videoData.url) {
    await downloadFile(videoData.url, outputPath);
    return { filePath: outputPath };
  }
  if (videoData.b64_json) {
    fs.writeFileSync(outputPath, Buffer.from(videoData.b64_json, 'base64'));
    return { filePath: outputPath };
  }
  throw new Error('Sora API 未返回视频数据');
}

// ——— FAL.ai 模式：Wan 2.1（2D）/ Kling（2D/3D）等 ———
async function generateFalClip({ prompt, duration = 5, outputDir, filename, image_url }) {
  const { getApiKey, loadSettings } = require('./settingsService');
  const apiKey = getApiKey('fal') || process.env.FAL_API_KEY;
  if (!apiKey) throw new Error('未配置 FAL.ai API Key，请在「AI 配置」页面添加 FAL.ai 供应商');

  // 从设置中取选定的视频模型
  let modelPath = 'fal-ai/wan/v2.1/1.3b/text-to-video';
  try {
    const settings = loadSettings();
    const p = settings.providers.find(p => p.id === 'fal' && p.enabled);
    const m = (p?.models || []).find(m => m.enabled !== false && m.use === 'video');
    if (m?.id) modelPath = m.id;
  } catch {}

  // 图生视频：尝试将 text-to-video 替换为 image-to-video
  if (image_url && modelPath.includes('text-to-video')) {
    modelPath = modelPath.replace('text-to-video', 'image-to-video');
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${filename}.mp4`);

  let body;
  if (modelPath.includes('kling')) {
    const kb = { prompt, duration: String(Math.min(Math.max(Math.round(duration), 5), 10)), aspect_ratio: '16:9' };
    if (image_url) kb.image_url = image_url;
    body = JSON.stringify(kb);
  } else if (modelPath.includes('ltx-video')) {
    const lb = { prompt, num_inference_steps: 40, guidance_scale: 3 };
    if (image_url) lb.image_url = image_url;
    body = JSON.stringify(lb);
  } else if (modelPath.includes('hunyuan-video')) {
    const hb = { prompt, video_size: { width: 1280, height: 720 }, num_inference_steps: 50 };
    if (image_url) hb.image_url = image_url;
    body = JSON.stringify(hb);
  } else {
    // Wan 2.1 及其他
    const falBody = { prompt, num_inference_steps: 40, image_size: { width: 1280, height: 720 } };
    if (image_url) falBody.image_url = image_url;
    body = JSON.stringify(falBody);
  }

  // 提交队列任务
  const submission = await new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(body);
    const req = https.request({
      hostname: 'queue.fal.run',
      path: '/' + modelPath,
      method: 'POST',
      headers: {
        'Authorization': 'Key ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': bodyBuf.length
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { reject(new Error('FAL.ai 返回格式错误')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  const requestId = submission.request_id;
  if (!requestId) throw new Error('FAL.ai 未返回请求 ID: ' + JSON.stringify(submission).substring(0, 200));

  // 轮询状态（最多 10 分钟）
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const st = await new Promise((resolve, reject) => {
      https.get('https://queue.fal.run/' + modelPath + '/requests/' + requestId + '/status', {
        headers: { 'Authorization': 'Key ' + apiKey }
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
      }).on('error', reject);
    });

    if (st.status === 'COMPLETED') {
      const result = await new Promise((resolve, reject) => {
        https.get('https://queue.fal.run/' + modelPath + '/requests/' + requestId, {
          headers: { 'Authorization': 'Key ' + apiKey }
        }, (res) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
        }).on('error', reject);
      });
      const videoUrl = result.video?.url || result.output?.video?.url;
      if (!videoUrl) throw new Error('FAL.ai 未返回视频 URL');
      await downloadFile(videoUrl, outputPath);
      return { filePath: outputPath };
    }
    if (st.status === 'FAILED') throw new Error('FAL.ai 生成失败: ' + (st.error || '未知错误'));
  }
  throw new Error('FAL.ai 生成超时（10 分钟）');
}

// ——— Kling AI 直连模式（2D/3D 动画，accessKey:secretKey 格式）———
function _createKlingToken(accessKey, secretKey) {
  const crypto = require('crypto');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secretKey).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

async function generateKlingClip({ prompt, negative_prompt = '', duration = 5, outputDir, filename, video_model, image_url }) {
  const { getApiKey, loadSettings } = require('./settingsService');
  const rawKey = getApiKey('kling') || process.env.KLING_API_KEY;
  if (!rawKey) throw new Error('未配置 Kling AI Key，请在「AI 配置」页面添加 Kling AI 供应商（格式：accessKey:secretKey）');

  const authToken = rawKey.includes(':')
    ? _createKlingToken(...rawKey.split(':'))
    : rawKey;

  let modelName = 'kling-v1-6';
  if (video_model) {
    modelName = video_model;
  } else {
    try {
      const settings = loadSettings();
      const p = settings.providers.find(p => p.id === 'kling' && p.enabled);
      const m = (p?.models || []).find(m => m.enabled !== false && m.use === 'video');
      if (m?.id) modelName = m.id;
    } catch {}
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${filename}.mp4`);

  // Kling i2v：支持公网 URL 和 base64（自动尝试，失败回退 t2v）
  const hasImage = !!image_url;
  let useI2V = hasImage;
  let apiPath = useI2V ? '/v1/videos/image2video' : '/v1/videos/text2video';
  // Kling V3 支持更长时长（最长120秒）和 professional 模式
  const isV3 = modelName === 'kling-v3';
  const isV25 = modelName === 'kling-v2.5-turbo-pro';
  let clipDuration;
  if (isV3) {
    // V3 支持 5/10/15/20/30/60/120 秒
    const validDurations = [5, 10, 15, 20, 30, 60, 120];
    clipDuration = validDurations.reduce((prev, curr) => Math.abs(curr - duration) < Math.abs(prev - duration) ? curr : prev);
  } else {
    clipDuration = [5, 10].includes(Math.round(duration)) ? Math.round(duration) : 5;
  }

  const bodyObj = {
    model_name: modelName,
    prompt: prompt.substring(0, isV3 ? 4000 : 2500),
    negative_prompt: negative_prompt || '',
    cfg_scale: 0.5,
    mode: isV3 ? 'pro' : (isV25 ? 'pro' : 'std'),
    aspect_ratio: '16:9',
    duration: String(clipDuration)
  };
  if (useI2V) {
    bodyObj.image = image_url;
    const mode = image_url.startsWith('data:') ? 'base64' : 'URL';
    console.log(`[Kling] 使用 ${mode} 图生视频 (i2v) 模式`);
  }
  async function _klingSubmit(body, kApiPath) {
    const bodyStr = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api-beijing.klingai.com',
        path: kApiPath,
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + authToken,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString());
            if (json.code !== 0) return reject(new Error('Kling: ' + (json.message || JSON.stringify(json))));
            resolve(json.data);
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });
  }

  let task;
  try {
    task = await _klingSubmit(bodyObj, apiPath);
  } catch (e) {
    // i2v 失败时回退到 t2v
    if (useI2V) {
      console.log(`[Kling] i2v 提交失败 (${e.message})，回退到 t2v 模式`);
      delete bodyObj.image;
      useI2V = false;
      apiPath = '/v1/videos/text2video';
      task = await _klingSubmit(bodyObj, apiPath);
    } else {
      throw e;
    }
  }

  const taskId = task.task_id;
  if (!taskId) throw new Error('Kling 未返回任务 ID');

  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const status = await new Promise((resolve, reject) => {
      const pollPath = useI2V ? '/v1/videos/image2video/' : '/v1/videos/text2video/';
      https.get('https://api-beijing.klingai.com' + pollPath + taskId, {
        headers: { 'Authorization': 'Bearer ' + authToken }
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
      }).on('error', reject);
    });

    if (status.data?.task_status === 'succeed') {
      const videoUrl = status.data?.task_result?.videos?.[0]?.url;
      if (!videoUrl) throw new Error('Kling 未返回视频 URL');
      await downloadFile(videoUrl, outputPath);
      return { filePath: outputPath };
    }
    if (status.data?.task_status === 'failed') throw new Error('Kling 生成失败: ' + (status.data.task_status_msg || '未知'));
  }
  throw new Error('Kling 生成超时');
}

// ——— Runway Gen-3/Gen-4 模式（3D 电影级）———
async function generateRunwayClip({ prompt, duration = 5, outputDir, filename, image_url }) {
  const { getApiKey, loadSettings } = require('./settingsService');
  const apiKey = getApiKey('runway') || process.env.RUNWAY_API_KEY;
  if (!apiKey) throw new Error('未配置 Runway API Key，请在「AI 配置」页面添加 Runway ML 供应商');

  let model = 'gen3a_turbo';
  try {
    const settings = loadSettings();
    const p = settings.providers.find(p => p.id === 'runway' && p.enabled);
    const m = (p?.models || []).find(m => m.enabled !== false && m.use === 'video');
    if (m?.id) model = m.id;
  } catch {}

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${filename}.mp4`);

  // Runway i2v：尝试所有格式，失败自动回退 t2v
  let runwayUseI2V = !!image_url;
  const bodyObj = {
    model,
    promptText: prompt.substring(0, 512),
    duration: [5, 10].includes(Math.round(duration)) ? Math.round(duration) : 5,
    ratio: '1280:720',
  };
  if (runwayUseI2V) {
    bodyObj.promptImage = image_url;
    const mode = image_url.startsWith('data:') ? 'base64' : 'URL';
    console.log(`[Runway] 使用 ${mode} 图生视频 (i2v) 模式`);
  }
  let createBody = JSON.stringify(bodyObj);
  let runwayApiPath = runwayUseI2V ? '/v1/image_to_video' : '/v1/text_to_video';

  async function _runwaySubmit(body, rPath) {
    const bodyStr = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.dev.runwayml.com',
        path: rPath,
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'X-Runway-Version': '2024-11-06',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString());
            if (json.error) return reject(new Error('Runway: ' + json.error));
            resolve(json);
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });
  }

  let task;
  try {
    task = await _runwaySubmit(bodyObj, runwayApiPath);
  } catch (e) {
    if (runwayUseI2V) {
      console.log(`[Runway] i2v 提交失败 (${e.message})，回退到 t2v 模式`);
      delete bodyObj.promptImage;
      runwayUseI2V = false;
      runwayApiPath = '/v1/text_to_video';
      task = await _runwaySubmit(bodyObj, runwayApiPath);
    } else {
      throw e;
    }
  }

  const taskId = task.id;
  if (!taskId) throw new Error('Runway 未返回任务 ID');

  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const status = await new Promise((resolve, reject) => {
      https.get('https://api.dev.runwayml.com/v1/tasks/' + taskId, {
        headers: { 'Authorization': 'Bearer ' + apiKey, 'X-Runway-Version': '2024-11-06' }
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
      }).on('error', reject);
    });

    if (status.status === 'SUCCEEDED') {
      const videoUrl = status.output?.[0];
      if (!videoUrl) throw new Error('Runway 未返回视频 URL');
      await downloadFile(videoUrl, outputPath);
      return { filePath: outputPath };
    }
    if (status.status === 'FAILED') throw new Error('Runway 生成失败: ' + (status.failure || '未知错误'));
  }
  throw new Error('Runway 生成超时');
}

// ——— Luma Dream Machine 模式（3D 高质量）———
async function generateLumaClip({ prompt, duration = 5, outputDir, filename, image_url }) {
  const { getApiKey, loadSettings } = require('./settingsService');
  const apiKey = getApiKey('luma') || process.env.LUMA_API_KEY;
  if (!apiKey) throw new Error('未配置 Luma AI API Key，请在「AI 配置」页面添加 Luma AI 供应商');

  let model = 'ray-2';
  try {
    const settings = loadSettings();
    const p = settings.providers.find(p => p.id === 'luma' && p.enabled);
    const m = (p?.models || []).find(m => m.enabled !== false && m.use === 'video');
    if (m?.id) model = m.id.replace('-720p', ''); // strip resolution suffix for model id
  } catch {}

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${filename}.mp4`);

  const bodyObj = {
    prompt: prompt.substring(0, 500),
    model,
    resolution: '720p',
    duration: Math.min(Math.max(Math.round(duration), 5), 9) + 's',
    aspect_ratio: '16:9',
  };
  // Luma i2v：尝试所有格式
  if (image_url) {
    bodyObj.keyframes = { frame0: { type: 'image', url: image_url } };
    const mode = image_url.startsWith('data:') ? 'base64' : 'URL';
    console.log(`[Luma] 使用 ${mode} 图生视频 (i2v) 模式`);
  }
  const createBody = JSON.stringify(bodyObj);

  async function _lumaSubmit(body) {
    const bodyStr = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.lumalabs.ai',
        path: '/dream-machine/v1/generations',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString());
            if (json.detail) return reject(new Error('Luma: ' + json.detail));
          resolve(json);
        } catch (e) { reject(e); }
      });
    });
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });
  }

  let generation;
  try {
    generation = await _lumaSubmit(bodyObj);
  } catch (e) {
    if (bodyObj.keyframes) {
      console.log(`[Luma] i2v 提交失败 (${e.message})，回退到 t2v 模式`);
      delete bodyObj.keyframes;
      generation = await _lumaSubmit(bodyObj);
    } else {
      throw e;
    }
  }

  const genId = generation.id;
  if (!genId) throw new Error('Luma AI 未返回生成 ID');

  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const status = await new Promise((resolve, reject) => {
      https.get('https://api.lumalabs.ai/dream-machine/v1/generations/' + genId, {
        headers: { 'Authorization': 'Bearer ' + apiKey }
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
      }).on('error', reject);
    });

    if (status.state === 'completed') {
      const videoUrl = status.assets?.video;
      if (!videoUrl) throw new Error('Luma AI 未返回视频 URL');
      await downloadFile(videoUrl, outputPath);
      return { filePath: outputPath };
    }
    if (status.state === 'failed') throw new Error('Luma AI 生成失败: ' + (status.failure_reason || '未知错误'));
  }
  throw new Error('Luma AI 生成超时');
}

// ——— MiniMax Hailuo 模式（2D 高质量）———
async function generateMinimaxClip({ prompt, duration = 5, outputDir, filename, image_url }) {
  const { getApiKey, loadSettings } = require('./settingsService');
  const apiKey = getApiKey('minimax') || process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('未配置 MiniMax API Key，请在「AI 配置」页面添加 MiniMax 供应商');

  let model = 'video-01';
  try {
    const settings = loadSettings();
    const p = settings.providers.find(p => p.id === 'minimax' && p.enabled);
    const m = (p?.models || []).find(m => m.enabled !== false && m.use === 'video');
    if (m?.id) model = m.id;
  } catch {}

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${filename}.mp4`);

  const mmBody = { model, prompt: prompt.substring(0, 2000), prompt_optimizer: true };
  // MiniMax i2v：尝试所有格式
  if (image_url) {
    mmBody.first_frame_image = image_url;
    const mode = image_url.startsWith('data:') ? 'base64' : 'URL';
    console.log(`[MiniMax] 使用 ${mode} 图生视频 (i2v) 模式`);
  }
  const createBody = JSON.stringify(mmBody);

  async function _minimaxSubmit(body) {
    const bodyStr = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.minimaxi.chat',
        path: '/v1/video_generation',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString());
            if (json.base_resp?.status_code !== 0) return reject(new Error('MiniMax: ' + json.base_resp?.status_msg));
            resolve(json);
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });
  }

  let taskResp;
  try {
    taskResp = await _minimaxSubmit(mmBody);
  } catch (e) {
    if (mmBody.first_frame_image) {
      console.log(`[MiniMax] i2v 提交失败 (${e.message})，回退到 t2v 模式`);
      delete mmBody.first_frame_image;
      taskResp = await _minimaxSubmit(mmBody);
    } else {
      throw e;
    }
  }

  const taskId = taskResp.task_id;
  if (!taskId) throw new Error('MiniMax 未返回任务 ID');

  // 轮询任务状态
  let fileId;
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const status = await new Promise((resolve, reject) => {
      https.get('https://api.minimaxi.chat/v1/query/video_generation?task_id=' + taskId, {
        headers: { 'Authorization': 'Bearer ' + apiKey }
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
      }).on('error', reject);
    });

    if (status.status === 'Success') { fileId = status.file_id; break; }
    if (status.status === 'Fail') throw new Error('MiniMax 生成失败: ' + (status.base_resp?.status_msg || '未知'));
  }
  if (!fileId) throw new Error('MiniMax 生成超时');

  // 获取下载地址
  const fileResp = await new Promise((resolve, reject) => {
    https.get('https://api.minimaxi.chat/v1/files/retrieve?file_id=' + fileId, {
      headers: { 'Authorization': 'Bearer ' + apiKey }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
    }).on('error', reject);
  });

  const videoUrl = fileResp.file?.download_url;
  if (!videoUrl) throw new Error('MiniMax 未返回视频下载地址');
  await downloadFile(videoUrl, outputPath);
  return { filePath: outputPath };
}

// ——— 即梦AI（字节跳动）模式：视频生成3.0 Pro ———
// API Key 格式：AccessKeyId:SecretAccessKey（火山引擎控制台获取）
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

  // Canonical query string（按 key 字母序排列）
  const sortedQuery = Object.keys(query).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&');

  // Canonical headers（必须含 host/content-type/x-content-sha256/x-date，按字母序）
  const canonHeaders = `content-type:application/json\nhost:${host}\nx-content-sha256:${bodyHash}\nx-date:${xDate}\n`;
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';

  // Canonical request
  const canonRequest = [method.toUpperCase(), '/', sortedQuery, canonHeaders, signedHeaders, bodyHash].join('\n');

  // String to sign
  const credentialScope = `${dateStr}/${region}/${service}/request`;
  const stringToSign = [
    'HMAC-SHA256', xDate, credentialScope,
    crypto.createHash('sha256').update(canonRequest).digest('hex')
  ].join('\n');

  // Signing key
  const hmac = (key, data, enc) => crypto.createHmac('sha256', key).update(data).digest(enc || undefined);
  const signingKey = hmac(hmac(hmac(hmac(sk, dateStr), region), service), 'request');
  const signature = hmac(signingKey, stringToSign, 'hex');

  return {
    'Authorization': `HMAC-SHA256 Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'X-Date': xDate,
    'X-Content-Sha256': bodyHash,
    'Content-Type': 'application/json',
    'Host': host
  };
}

async function generateJimengClip({ prompt, duration = 5, outputDir, filename, aspectRatio = '16:9', image_url, video_model }) {
  const { getApiKey, loadSettings } = require('./settingsService');
  const rawKey = getApiKey('jimeng') || process.env.JIMENG_API_KEY;
  if (!rawKey) throw new Error('未配置即梦AI Key，请在「AI 配置」页面添加即梦AI供应商（格式：AccessKeyId:SecretAccessKey）');
  if (!rawKey.includes(':')) throw new Error('即梦AI Key 格式错误，应为 AccessKeyId:SecretAccessKey');

  const [ak, sk] = rawKey.split(':');

  // 优先使用用户选择的 video_model，回退到 settings
  let reqKey = 'jimeng_vgfm_t2v_l20_pro';
  if (video_model) {
    reqKey = video_model;
  } else {
    try {
      const settings = loadSettings();
      const p = settings.providers.find(p => p.id === 'jimeng' && p.enabled);
      const m = (p?.models || []).find(m => m.enabled !== false && m.use === 'video');
      if (m?.id) reqKey = m.id;
    } catch {}
  }

  // 图生视频：切换到 i2v 模型
  if (image_url && reqKey.includes('t2v')) {
    reqKey = reqKey.replace('t2v', 'i2v');
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${filename}.mp4`);

  const query = { Action: 'CVSync2AsyncSubmitTask', Version: '2022-08-31' };
  const submitObj = {
    req_key: reqKey,
    prompt: prompt.substring(0, 2000),
    seed: -1,
    aspect_ratio: aspectRatio
  };
  if (image_url) {
    if (image_url.startsWith('data:')) {
      // 即梦支持 binary_data_base64
      const b64 = image_url.replace(/^data:[^;]+;base64,/, '');
      submitObj.binary_data_base64 = [b64];
      console.log(`[Jimeng Video] 使用 base64 图生视频 (i2v) 模式`);
    } else {
      submitObj.image_urls = [image_url];
      console.log(`[Jimeng Video] 使用 URL 图生视频 (i2v) 模式`);
    }
  }
  const submitBody = JSON.stringify(submitObj);

  const submitHeaders = _signJimeng(ak, sk, { method: 'POST', query, body: submitBody });

  const task = await new Promise((resolve, reject) => {
    const qs = Object.keys(query).sort().map(k => `${k}=${query[k]}`).join('&');
    const req = https.request({
      hostname: 'visual.volcengineapi.com',
      path: '/?' + qs,
      method: 'POST',
      headers: { ...submitHeaders, 'Content-Length': Buffer.byteLength(submitBody) }
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
    req.on('error', reject);
    req.write(submitBody);
    req.end();
  });

  const taskId = task.Result?.data?.task_id || task.data?.task_id;
  if (!taskId) throw new Error('即梦AI 未返回任务ID: ' + JSON.stringify(task).substring(0, 300));

  // 轮询查询结果（最多 10 分钟）
  const queryAction = { Action: 'CVSync2AsyncGetResult', Version: '2022-08-31' };
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));

    const queryBody = JSON.stringify({ req_key: reqKey, task_id: taskId });
    const queryHeaders = _signJimeng(ak, sk, { method: 'POST', query: queryAction, body: queryBody });

    const result = await new Promise((resolve, reject) => {
      const qs = Object.keys(queryAction).sort().map(k => `${k}=${queryAction[k]}`).join('&');
      const req = https.request({
        hostname: 'visual.volcengineapi.com',
        path: '/?' + qs,
        method: 'POST',
        headers: { ...queryHeaders, 'Content-Length': Buffer.byteLength(queryBody) }
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
      });
      req.on('error', reject);
      req.write(queryBody);
      req.end();
    });

    const resultData = result.Result?.data || result.data || {};
    const status = resultData.status;

    if (status === 'done' || status === 'succeed') {
      const videoUrl = resultData.video_url
        || resultData.videos?.[0]?.url
        || resultData.output?.video_url;
      if (!videoUrl) throw new Error('即梦AI 未返回视频URL');
      await downloadFile(videoUrl, outputPath);
      return { filePath: outputPath };
    }
    if (status === 'failed' || status === 'fail') {
      throw new Error('即梦AI 生成失败: ' + (resultData.message || resultData.error_message || '未知错误'));
    }
    // status === 'processing' 继续等待
  }
  throw new Error('即梦AI 生成超时（10 分钟）');
}

// ——— Pika 模式（2D/3D 高质量）———
async function generatePikaClip({ prompt, negative_prompt = '', duration = 5, outputDir, filename, image_url }) {
  const { getApiKey, loadSettings } = require('./settingsService');
  const rawKey = getApiKey('pika') || process.env.PIKA_API_KEY;
  if (!rawKey) throw new Error('未配置 Pika API Key，请在「AI 配置」页面添加 Pika 供应商');

  // Pika key 格式：secretKey 或 accessKey:secretKey
  const apiKey = rawKey;

  let model = 'pika-2.0';
  try {
    const settings = loadSettings();
    const p = settings.providers.find(p => p.id === 'pika' && p.enabled);
    const m = (p?.models || []).find(m => m.enabled !== false && m.use === 'video');
    if (m?.id) model = m.id;
  } catch {}

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${filename}.mp4`);

  const bodyObj = {
    model,
    promptText: prompt.substring(0, 500),
    options: {
      aspectRatio: '16:9',
      frameRate: 24,
      camera: {},
      parameters: { guidanceScale: 16, motion: 2, negativePrompt: [negative_prompt, 'blurry, low quality'].filter(Boolean).join(', ') }
    }
  };
  // Pika i2v：尝试所有格式
  if (image_url) {
    bodyObj.image = image_url;
    const mode = image_url.startsWith('data:') ? 'base64' : 'URL';
    console.log(`[Pika] 使用 ${mode} 图生视频 (i2v) 模式`);
  }
  const createBody = JSON.stringify(bodyObj);

  // 提交生成任务（带 i2v → t2v 自动回退）
  let pikaUseI2V = !!image_url;
  async function _pikaSubmit(body, isI2V) {
    const bodyStr = JSON.stringify(body);
    const pApiPath = isI2V ? '/api/v1/generate/image2video' : '/api/v1/generate/text2video';
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.pika.art',
        path: pApiPath,
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString());
            if (json.error) return reject(new Error('Pika: ' + (json.error.message || JSON.stringify(json.error))));
          resolve(json);
        } catch (e) { reject(e); }
      });
    });
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });
  }

  let task;
  try {
    task = await _pikaSubmit(bodyObj, pikaUseI2V);
  } catch (e) {
    if (pikaUseI2V) {
      console.log(`[Pika] i2v 提交失败 (${e.message})，回退到 t2v 模式`);
      delete bodyObj.image;
      pikaUseI2V = false;
      task = await _pikaSubmit(bodyObj, false);
    } else {
      throw e;
    }
  }

  const taskId = task.data?.id || task.id;
  if (!taskId) throw new Error('Pika 未返回任务 ID: ' + JSON.stringify(task).substring(0, 300));

  // 轮询任务状态（最多 10 分钟）
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const status = await new Promise((resolve, reject) => {
      https.get('https://api.pika.art/api/v1/generate/' + taskId, {
        headers: { 'Authorization': 'Bearer ' + apiKey }
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
      }).on('error', reject);
    });

    const state = status.data?.status || status.status;
    if (state === 'completed' || state === 'finished') {
      const videoUrl = status.data?.resultUrl || status.data?.videos?.[0]?.resultUrl;
      if (!videoUrl) throw new Error('Pika 未返回视频 URL');
      await downloadFile(videoUrl, outputPath);
      return { filePath: outputPath };
    }
    if (state === 'failed' || state === 'error') {
      throw new Error('Pika 生成失败: ' + (status.data?.message || '未知错误'));
    }
  }
  throw new Error('Pika 生成超时（10 分钟）');
}

// ——— Seedance 2.0（ByteDance，通过 FAL.ai 代理，动作场景最强）———
async function generateSeedanceClip({ prompt, duration = 5, outputDir, filename, image_url, video_model }) {
  const { getApiKey, loadSettings } = require('./settingsService');
  // Seedance 通过 FAL.ai API 访问，需要 FAL API Key
  const apiKey = getApiKey('seedance') || getApiKey('fal') || process.env.SEEDANCE_API_KEY || process.env.FAL_API_KEY;
  if (!apiKey) throw new Error('未配置 Seedance/FAL.ai API Key');

  let modelPath = 'fal-ai/seedance/video/text-to-video';
  if (video_model) {
    modelPath = video_model;
  } else {
    try {
      const settings = loadSettings();
      const p = settings.providers.find(p => p.id === 'seedance' && p.enabled);
      const m = (p?.models || []).find(m => m.enabled !== false && m.use === 'video');
      if (m?.id) modelPath = m.id;
    } catch {}
  }

  // 图生视频自动切换
  if (image_url && modelPath.includes('text-to-video')) {
    modelPath = modelPath.replace('text-to-video', 'image-to-video');
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${filename}.mp4`);

  const body = { prompt, num_inference_steps: 50 };
  if (image_url) body.image_url = image_url;
  if (duration) body.duration = Math.min(Math.max(Math.round(duration), 4), 20);

  // 提交队列任务
  const bodyStr = JSON.stringify(body);
  const submission = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'queue.fal.run',
      path: '/' + modelPath,
      method: 'POST',
      headers: {
        'Authorization': 'Key ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(new Error('Seedance 返回格式错误')); } });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });

  const requestId = submission.request_id;
  if (!requestId) throw new Error('Seedance 未返回请求 ID: ' + JSON.stringify(submission).substring(0, 200));

  // 轮询状态（最多 10 分钟）
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const st = await new Promise((resolve, reject) => {
      https.get(`https://queue.fal.run/${modelPath}/requests/${requestId}/status`, {
        headers: { 'Authorization': 'Key ' + apiKey }
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
      }).on('error', reject);
    });
    if (st.status === 'COMPLETED') {
      const result = await new Promise((resolve, reject) => {
        https.get(`https://queue.fal.run/${modelPath}/requests/${requestId}`, {
          headers: { 'Authorization': 'Key ' + apiKey }
        }, (res) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
        }).on('error', reject);
      });
      const videoUrl = result.video?.url || result.output?.video?.url;
      if (!videoUrl) throw new Error('Seedance 未返回视频 URL');
      await downloadFile(videoUrl, outputPath);
      return { filePath: outputPath };
    }
    if (st.status === 'FAILED') throw new Error('Seedance 生成失败: ' + (st.error || '未知错误'));
  }
  throw new Error('Seedance 生成超时（10 分钟）');
}

// ——— Google Veo 3 / 3.1（Gemini API，影院级视频）———
async function generateVeoClip({ prompt, duration = 8, outputDir, filename, image_url, video_model }) {
  const { getApiKey, loadSettings } = require('./settingsService');
  const apiKey = getApiKey('veo') || process.env.VEO_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('未配置 Google Veo API Key');

  let model = 'veo-3.1-fast';
  if (video_model) {
    model = video_model;
  } else {
    try {
      const settings = loadSettings();
      const p = settings.providers.find(p => p.id === 'veo' && p.enabled);
      const m = (p?.models || []).find(m => m.enabled !== false && m.use === 'video');
      if (m?.id) model = m.id;
    } catch {}
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${filename}.mp4`);

  const body = {
    instances: [{ prompt }],
    parameters: {
      aspectRatio: '16:9',
      personGeneration: 'allow_all',
      generateAudio: false
    }
  };
  if (image_url && !image_url.startsWith('data:')) {
    body.instances[0].image = { imageUri: image_url };
  }
  const bodyStr = JSON.stringify(body);

  // Gemini API: predictLongRunning
  const apiPath = `/v1beta/models/${model}:predictLongRunning?key=${apiKey}`;
  const submission = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: apiPath,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(new Error('Veo 返回格式错误')); } });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });

  const opName = submission.name;
  if (!opName) throw new Error('Veo 未返回操作名: ' + JSON.stringify(submission).substring(0, 300));

  // 轮询 long-running operation
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const st = await new Promise((resolve, reject) => {
      https.get(`https://generativelanguage.googleapis.com/v1beta/${opName}?key=${apiKey}`, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
      }).on('error', reject);
    });
    if (st.done) {
      const videos = st.response?.generateVideoResponse?.generatedSamples;
      if (!videos?.length) throw new Error('Veo 未返回视频');
      const videoUri = videos[0].video?.uri;
      if (videoUri) {
        await downloadFile(videoUri + (videoUri.includes('?') ? '&' : '?') + 'key=' + apiKey, outputPath);
        return { filePath: outputPath };
      }
      // base64 encoded
      const videoBytes = videos[0].video?.encodedVideo;
      if (videoBytes) {
        fs.writeFileSync(outputPath, Buffer.from(videoBytes, 'base64'));
        return { filePath: outputPath };
      }
      throw new Error('Veo 未返回可下载的视频');
    }
    if (st.error) throw new Error('Veo 生成失败: ' + (st.error.message || JSON.stringify(st.error)));
  }
  throw new Error('Veo 生成超时（10 分钟）');
}

// ——— 自动检测视频 provider（settings > env > demo）———
function resolveVideoProvider() {
  const explicit = process.env.VIDEO_PROVIDER;
  if (explicit && explicit !== 'auto') return explicit;
  // 从 settings 中找第一个有 video 用途模型的供应商（按优先级）
  try {
    const { loadSettings } = require('./settingsService');
    const settings = loadSettings();
    for (const provider of settings.providers) {
      if (!provider.enabled || !provider.api_key) continue;
      const model = (provider.models || []).find(m => m.enabled !== false && m.use === 'video');
      if (model) {
        if (provider.id === 'openai')      return 'sora';
        if (provider.id === 'pika')         return 'pika';
        if (provider.id === 'jimeng')      return 'jimeng';
        if (provider.id === 'fal')         return 'fal';
        if (provider.id === 'kling')       return 'kling';
        if (provider.id === 'runway')      return 'runway';
        if (provider.id === 'luma')        return 'luma';
        if (provider.id === 'minimax')     return 'minimax';
        if (provider.id === 'seedance')    return 'seedance';
        if (provider.id === 'veo')         return 'veo';
        if (provider.id === 'zhipu')       return 'zhipu';
        if (provider.id === 'replicate')   return 'replicate';
        if (provider.id === 'huggingface') return 'huggingface';
      }
    }
  } catch {}
  return 'demo';
}

// ——— 主入口：自动选择 provider ———
async function generateVideoClip(options) {
  const provider = options.video_provider || resolveVideoProvider();
  console.log(`[VideoService] provider=${provider}, video_model=${options.video_model || '(auto)'}, image_url=${options.image_url ? 'YES' : 'no'}`);

  // 根据 video_model 自动路由到正确的 provider（新模型可能通过 FAL 代理）
  const model = options.video_model || '';
  const isFalModel = model.startsWith('fal-ai/');

  // FAL 代理的模型（包括 Seedance 2.0 via FAL、HunyuanVideo 1.5 via FAL、Wan 2.2 via FAL 等）
  if (isFalModel && provider !== 'fal') {
    console.log(`[VideoService] 模型 ${model} 通过 FAL 代理路由`);
    return generateFalClip(options);
  }

  switch (provider) {
    case 'pika':        return generatePikaClip(options);
    case 'sora':
    case 'openai':      return generateSoraClip(options);
    case 'fal':
    case 'seedance':    return isFalModel || provider === 'fal' ? generateFalClip(options) : generateSeedanceClip(options);
    case 'kling':       return generateKlingClip(options);
    case 'runway':      return generateRunwayClip(options);
    case 'luma':        return generateLumaClip(options);
    case 'minimax':     return generateMinimaxClip(options);
    case 'veo':         return generateVeoClip(options);
    case 'jimeng':      return generateJimengClip(options);
    case 'zhipu':       return generateZhipuClip(options);
    case 'huggingface': return generateHuggingFaceClip(options);
    case 'replicate':   return generateReplicateClip(options);
    case 'demo':
    default:            return generateDemoClip(options);
  }
}

module.exports = { generateVideoClip };
