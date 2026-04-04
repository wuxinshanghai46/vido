/**
 * 数字人视频生成服务
 * 支持：智谱AI CogVideoX / MiniMax Hailuo / Kling AI 图生视频 + TTS 语音合成
 * 流程：人像图片 → 视频模型动画 → TTS 生成语音 → FFmpeg 合成
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { getApiKey } = require('./settingsService');
const { loadSettings } = require('./settingsService');
const { generateSpeech } = require('./ttsService');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');
const AVATAR_DIR = path.join(OUTPUT_DIR, 'avatar');

// 智谱 API 配置
const ZHIPU_API_BASE = 'https://open.bigmodel.cn/api/paas/v4';
// MiniMax API 配置
const MINIMAX_API_BASE = 'https://api.minimaxi.com/v1';
// Kling API 配置
const KLING_API_HOST = 'api-beijing.klingai.com';

// MiniMax 模型列表（用于判断走哪个 provider）
const MINIMAX_MODELS = ['I2V-01', 'I2V-01-live', 'I2V-01-Director', 'MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast', 'MiniMax-Hailuo-02'];
// Kling 模型列表
const KLING_MODELS = ['kling-v3', 'kling-v2-master', 'kling-v2.5-turbo-pro', 'kling-v1-6'];

function isMiniMaxModel(model) {
  return MINIMAX_MODELS.includes(model);
}
function isKlingModel(model) {
  return KLING_MODELS.includes(model);
}

function getZhipuKey() {
  const settings = loadSettings();
  for (const p of (settings.providers || [])) {
    if (p.id === 'zhipu' || p.preset === 'zhipu') {
      const key = getApiKey(p.id);
      if (key) return key;
    }
  }
  return process.env.ZHIPU_API_KEY || '';
}

function getMiniMaxKey() {
  const settings = loadSettings();
  for (const p of (settings.providers || [])) {
    if (p.id === 'minimax' || p.preset === 'minimax') {
      const key = getApiKey(p.id);
      if (key) return key;
    }
  }
  return process.env.MINIMAX_API_KEY || '';
}

function getKlingKey() {
  const settings = loadSettings();
  for (const p of (settings.providers || [])) {
    if (p.id === 'kling' || p.preset === 'kling') {
      const key = getApiKey(p.id);
      if (key) return key;
    }
  }
  return process.env.KLING_API_KEY || '';
}

function _createKlingToken(accessKey, secretKey) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secretKey).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/**
 * Kling AI 图生视频：提交任务 → 轮询 → 下载
 */
async function _klingGenerateVideo(imgParam, prompt, model, rawKey, onProgress) {
  const authToken = rawKey.includes(':') ? _createKlingToken(...rawKey.split(':')) : rawKey;
  const isV3 = model === 'kling-v3';

  const bodyObj = {
    model_name: model,
    prompt: prompt.substring(0, isV3 ? 4000 : 2500),
    image: imgParam,
    cfg_scale: 0.5,
    mode: isV3 ? 'pro' : 'std',
    aspect_ratio: '9:16',
    duration: '5'
  };
  console.log(`[Avatar] Kling I2V 请求: model=${model}, prompt长度=${prompt.length}`);

  // 提交任务
  function _klingRequest(method, kPath, body) {
    return new Promise((resolve, reject) => {
      const opts = { hostname: KLING_API_HOST, path: kPath, method, headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' } };
      const req = https.request(opts, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
      });
      req.on('error', reject);
      req.setTimeout(60000, () => { req.destroy(); reject(new Error('Kling 请求超时')); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  let task;
  for (let retry = 0; retry < 3; retry++) {
    try {
      const result = await _klingRequest('POST', '/v1/videos/image2video', bodyObj);
      if (result.code !== 0) throw new Error('Kling: ' + (result.message || JSON.stringify(result)));
      task = result.data;
      break;
    } catch (e) {
      if (retry < 2 && /ECONNRESET|ETIMEDOUT|socket/i.test(e.message)) {
        const wait = 10 * (retry + 1);
        console.warn(`[Avatar] Kling 网络波动，${wait}秒后重试: ${e.message}`);
        onProgress?.({ step: 'video', message: `网络波动，${wait}秒后自动重试...` });
        await new Promise(r => setTimeout(r, wait * 1000));
        continue;
      }
      throw new Error(`Kling 视频提交失败: ${e.message}`);
    }
  }

  const taskId = task?.task_id;
  if (!taskId) throw new Error('Kling 未返回任务 ID');
  console.log(`[Avatar] Kling 任务已创建: ${taskId}`);

  // 轮询
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    onProgress?.({ step: 'video', message: `Kling 生成中... (${(i + 1) * 5}秒)` });
    try {
      const status = await _klingRequest('GET', '/v1/videos/image2video/' + taskId, null);
      if (status.data?.task_status === 'succeed') {
        const videoUrl = status.data?.task_result?.videos?.[0]?.url;
        if (!videoUrl) throw new Error('Kling 未返回视频 URL');
        console.log(`[Avatar] Kling 生成完成`);
        // 下载视频
        onProgress?.({ step: 'video', message: '下载 Kling 视频...' });
        const videoResp = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 120000 });
        return videoResp.data; // Buffer
      }
      if (status.data?.task_status === 'failed') {
        throw new Error('Kling 视频生成失败: ' + (status.data.task_status_msg || '未知错误'));
      }
    } catch (pollErr) {
      if (pollErr.message.includes('生成失败')) throw pollErr;
    }
  }
  throw new Error('Kling 视频生成超时，请重试');
}

/**
 * MiniMax 图生视频：提交任务 → 轮询 → 下载
 */
async function _minimaxGenerateVideo(imgParam, prompt, model, apiKey, onProgress) {
  // 1. 创建任务
  const reqBody = {
    model,
    first_frame_image: imgParam,
    prompt: prompt.substring(0, 2000),
    prompt_optimizer: true
  };
  console.log(`[Avatar] MiniMax I2V 请求: model=${model}, prompt长度=${prompt.length}`);

  let createRes;
  for (let retry = 0; retry < 5; retry++) {
    try {
      createRes = await axios.post(`${MINIMAX_API_BASE}/video_generation`, reqBody, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 60000
      });
      if (createRes.data?.base_resp?.status_code === 1002) {
        const wait = 30 + retry * 15;
        console.warn(`[Avatar] MiniMax 限流，${wait}秒后重试 (${retry + 1}/5)`);
        onProgress?.({ step: 'video', message: `服务繁忙，${wait}秒后自动重试...` });
        await new Promise(r => setTimeout(r, wait * 1000));
        continue;
      }
      break;
    } catch (apiErr) {
      const detail = apiErr.response?.data?.base_resp?.status_msg || apiErr.message;
      const status = apiErr.response?.status;
      const isNetworkErr = !apiErr.response && /ECONNRESET|ECONNREFUSED|socket|TLS|ETIMEDOUT|network/i.test(apiErr.message);
      if (isNetworkErr && retry < 4) {
        const wait = 10 * (retry + 1);
        console.warn(`[Avatar] MiniMax 网络波动，${wait}秒后重试 (${retry + 1}/5): ${detail}`);
        onProgress?.({ step: 'video', message: `网络波动，${wait}秒后自动重试...` });
        await new Promise(r => setTimeout(r, wait * 1000));
        continue;
      }
      throw new Error(`MiniMax 视频 API 调用失败 (${status || '网络错误'}): ${detail}`);
    }
  }

  const taskIdMM = createRes.data?.task_id;
  const respCode = createRes.data?.base_resp?.status_code;
  if (respCode !== 0 || !taskIdMM) {
    throw new Error(`MiniMax 创建任务失败: ${createRes.data?.base_resp?.status_msg || JSON.stringify(createRes.data)}`);
  }
  console.log(`[Avatar] MiniMax 任务已创建: ${taskIdMM}`);

  // 2. 轮询等待结果
  let fileId = null;
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    onProgress?.({ step: 'video', message: `MiniMax 生成中... (${(i + 1) * 5}秒)` });

    try {
      const pollRes = await axios.get(`${MINIMAX_API_BASE}/query/video_generation`, {
        params: { task_id: taskIdMM },
        headers: { 'Authorization': `Bearer ${apiKey}` },
        timeout: 15000
      });
      const status = pollRes.data?.status;
      if (status === 'Success') {
        fileId = pollRes.data?.file_id;
        console.log(`[Avatar] MiniMax 生成完成, file_id=${fileId}, ${pollRes.data?.video_width}x${pollRes.data?.video_height}`);
        break;
      } else if (status === 'Fail') {
        throw new Error('MiniMax 视频生成失败: ' + (pollRes.data?.base_resp?.status_msg || '未知错误'));
      }
      // Preparing / Queueing / Processing → 继续等
    } catch (pollErr) {
      if (pollErr.message.includes('生成失败')) throw pollErr;
    }
  }

  if (!fileId) throw new Error('MiniMax 视频生成超时，请重试');

  // 3. 下载视频文件
  onProgress?.({ step: 'video', message: '下载 MiniMax 视频...' });
  const fileResp = await axios.get(`${MINIMAX_API_BASE}/files/retrieve_content`, {
    params: { file_id: fileId },
    headers: { 'Authorization': `Bearer ${apiKey}` },
    responseType: 'arraybuffer',
    timeout: 120000
  });
  return fileResp.data; // Buffer
}

/**
 * 生成数字人视频
 * @param {object} params
 * @param {string} params.imageUrl - 人像图片 URL 或本地路径
 * @param {string} params.text - 要说的话（用于 TTS 和 prompt）
 * @param {string} params.voiceId - TTS 音色
 * @param {string} params.ratio - 比例 9:16 / 16:9 / 1:1
 * @param {string} params.model - 模型（cogvideox-flash / I2V-01-live / MiniMax-Hailuo-2.3 等）
 * @param {function} params.onProgress - 进度回调
 */
async function generateAvatarVideo(params) {
  const { imageUrl, text, voiceId, ratio = '9:16', model = 'cogvideox-flash', expression = 'natural', background = 'office', onProgress } = params;
  const taskId = uuidv4();
  const taskDir = path.join(AVATAR_DIR, taskId);
  fs.mkdirSync(taskDir, { recursive: true });

  const useMiniMax = isMiniMaxModel(model);
  const useKling = isKlingModel(model);
  const apiKey = useKling ? getKlingKey() : (useMiniMax ? getMiniMaxKey() : getZhipuKey());
  if (!apiKey) throw new Error(useKling ? '未配置 Kling AI Key，请在设置中添加 kling 供应商' : (useMiniMax ? '未配置 MiniMax API Key，请在设置中添加 minimax 供应商' : '未配置智谱 AI API Key'));

  onProgress?.({ step: 'start', message: '开始生成数字人视频...' });

  // 1. 准备图片（转为 base64 或 URL）
  let imgParam;
  if (imageUrl.startsWith('http')) {
    imgParam = imageUrl;
  } else if (imageUrl.startsWith('/api/')) {
    // 本地 API 路径，读取文件转 base64
    const localPath = imageUrl.includes('preset-img')
      ? path.join(OUTPUT_DIR, 'presets', path.basename(imageUrl))
      : path.join(AVATAR_DIR, path.basename(imageUrl));
    if (fs.existsSync(localPath)) {
      const buf = fs.readFileSync(localPath);
      const ext = path.extname(localPath).slice(1) || 'png';
      imgParam = `data:image/${ext};base64,${buf.toString('base64')}`;
    } else {
      throw new Error('图片文件不存在: ' + imageUrl);
    }
  } else if (fs.existsSync(imageUrl)) {
    const buf = fs.readFileSync(imageUrl);
    const ext = path.extname(imageUrl).slice(1) || 'png';
    imgParam = `data:image/${ext};base64,${buf.toString('base64')}`;
  } else {
    throw new Error('无效的图片路径: ' + imageUrl);
  }

  // 2. 构建 prompt
  const sizeMap = { '9:16': '720x1280', '16:9': '1280x720', '1:1': '1024x1024' };
  const size = sizeMap[ratio] || '720x1280';

  const expressionMap = {
    natural: 'natural and relaxed facial expression',
    smile: 'warm smiling facial expression',
    serious: 'serious and focused facial expression',
    excited: 'excited and energetic facial expression',
    calm: 'calm and composed facial expression',
  };
  const exprDesc = expressionMap[expression] || expressionMap.natural;

  const bgDescMap = {
    office: 'in a modern corporate office with city skyline view through glass windows, warm professional lighting',
    studio: 'in a professional TV broadcast studio with blue and purple neon lighting, LED screen background',
    classroom: 'in a modern bright classroom with whiteboard and bookshelves, warm natural lighting',
    outdoor: 'in a beautiful outdoor garden with cherry blossoms and soft golden sunlight',
    green: 'against a solid green chroma key background',
    custom: '',
  };
  const bgDesc = bgDescMap[background] || bgDescMap.office;

  const prompt = text
    ? `The person in the image is speaking naturally to the camera ${bgDesc ? bgDesc + ', ' : ''}with ${exprDesc}. They say: "${text.slice(0, 100)}". Natural head movements, professional presentation, smooth lip movements.`
    : `The person in the image is speaking naturally to the camera ${bgDesc ? bgDesc + ', ' : ''}with ${exprDesc}, subtle head movements, professional demeanor, smooth motion.`;

  // 2.5 如果选择了背景（非绿幕/自定义），先用 CogView 生成"人物+背景"合成图
  if (background && background !== 'green' && background !== 'custom') {
    const bgPromptMap = {
      office: '现代高端办公室，落地窗城市夜景',
      studio: '专业电视演播室，蓝色霓虹灯光',
      classroom: '明亮的现代教室，白板和书架',
      outdoor: '美丽的户外樱花园林，金色阳光',
    };
    const bgPrompt = bgPromptMap[background] || bgPromptMap.office;
    onProgress?.({ step: 'start', message: '生成场景合成图...' });
    try {
      const zhipuKeyForBg = getZhipuKey();
      if (zhipuKeyForBg) {
        const compRes = await axios.post(`${ZHIPU_API_BASE}/images/generations`, {
          model: 'cogview-3-flash',
          prompt: `一个年轻的中国职业人士半身照，站在${bgPrompt}的场景中，面对镜头，自然微笑，专业摄影风格，高清写实`
        }, {
          headers: { 'Authorization': `Bearer ${zhipuKeyForBg}`, 'Content-Type': 'application/json' },
          timeout: 30000
        });
        const compUrl = compRes.data?.data?.[0]?.url;
        if (compUrl) {
          const compImg = await axios.get(compUrl, { responseType: 'arraybuffer', timeout: 30000 });
          const compPath = path.join(taskDir, 'avatar_with_bg.png');
          fs.writeFileSync(compPath, compImg.data);
          imgParam = `data:image/png;base64,${compImg.data.toString('base64')}`;
          console.log(`[Avatar] 场景合成图生成完成 (${(compImg.data.length/1024).toFixed(0)}KB)`);
        }
      }
    } catch (compErr) {
      console.warn('[Avatar] 场景合成图生成失败，使用原始头像:', compErr.message?.slice(0, 80));
    }
  }

  const providerName = useKling ? 'Kling' : (useMiniMax ? 'MiniMax' : '智谱');
  onProgress?.({ step: 'video', message: `${providerName} 正在生成动画视频（约1-3分钟）...` });

  const rawVideoPath = path.join(taskDir, 'avatar_raw.mp4');
  const ffmpegStatic = require('ffmpeg-static');
  const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic;
  const { execSync } = require('child_process');

  if (useKling) {
    // ═══ Kling 路径 ═══
    const videoData = await _klingGenerateVideo(imgParam, prompt, model, apiKey, onProgress);
    fs.writeFileSync(rawVideoPath, videoData);
    console.log(`[Avatar] Kling 视频已下载: ${(videoData.length / 1024).toFixed(0)}KB`);
  } else if (useMiniMax) {
    // ═══ MiniMax 路径 ═══
    const videoData = await _minimaxGenerateVideo(imgParam, prompt, model, apiKey, onProgress);
    fs.writeFileSync(rawVideoPath, videoData);
    console.log(`[Avatar] MiniMax 视频已下载: ${(videoData.length / 1024).toFixed(0)}KB`);
  } else {
    // ═══ 智谱 CogVideoX 路径 ═══
    const reqBody = { model, prompt, image_url: imgParam };
    console.log(`[Avatar] 智谱 i2v 请求: model=${model}, prompt长度=${prompt.length}, 图片=${imgParam.startsWith('data:') ? 'base64' : imgParam.slice(0, 60)}`);

    let genRes;
    for (let retry = 0; retry < 5; retry++) {
      try {
        genRes = await axios.post(`${ZHIPU_API_BASE}/videos/generations`, reqBody, {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 300000
        });
        break;
      } catch (apiErr) {
        const detail = apiErr.response?.data?.error?.message || apiErr.response?.data?.message || apiErr.message;
        const status = apiErr.response?.status;
        const isNetworkErr = !apiErr.response && (apiErr.code === 'ECONNRESET' || apiErr.code === 'ECONNREFUSED' || /socket|TLS|ETIMEDOUT|network/i.test(apiErr.message));
        const isRateLimit = status === 429 || /访问量过大|rate.?limit|too many|请稍后/i.test(detail);
        if ((isNetworkErr || isRateLimit) && retry < 4) {
          const wait = isRateLimit ? 30 + retry * 15 : 10 * (retry + 1);
          const reason = isRateLimit ? '服务繁忙' : '网络波动';
          console.warn(`[Avatar] ${reason}，${wait}秒后重试 (${retry + 1}/5): ${detail}`);
          onProgress?.({ step: 'video', message: `${reason}，${wait}秒后自动重试...` });
          await new Promise(r => setTimeout(r, wait * 1000));
          continue;
        }
        console.error('[Avatar] 智谱 API 错误:', status, JSON.stringify(apiErr.response?.data || ''));
        throw new Error(`智谱视频 API 调用失败 (${status || '网络错误'}): ${detail}`);
      }
    }

    const zhipuTaskId = genRes.data?.id;
    if (!zhipuTaskId) throw new Error('智谱 API 返回异常: ' + JSON.stringify(genRes.data));

    let videoUrl = null;
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 5000));
      onProgress?.({ step: 'video', message: `等待视频生成... (${(i + 1) * 5}秒)` });
      try {
        const pollRes = await axios.get(`${ZHIPU_API_BASE}/async-result/${zhipuTaskId}`, {
          headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 15000
        });
        const status = pollRes.data?.task_status;
        if (status === 'SUCCESS') { videoUrl = pollRes.data?.video_result?.[0]?.url; break; }
        else if (status === 'FAIL') throw new Error('视频生成失败: ' + (pollRes.data?.message || '未知错误'));
      } catch (pollErr) {
        if (pollErr.message.includes('视频生成失败')) throw pollErr;
      }
    }
    if (!videoUrl) throw new Error('视频生成超时，请重试');

    onProgress?.({ step: 'video', message: '获取视频结果...' });
    const videoResp = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 60000 });
    fs.writeFileSync(rawVideoPath, videoResp.data);
  }

  // 5.5 创建乒乓循环视频（正放+倒放，过渡更平滑，约10秒基础素材）
  let videoPath = rawVideoPath;
  const pingpongPath = path.join(taskDir, 'avatar_pingpong.mp4');
  try {
    onProgress?.({ step: 'video', message: '优化视频连贯性...' });
    const ppCmd = `"${ffmpegPath}" -i "${rawVideoPath}" -filter_complex "[0:v]split[v1][v2];[v2]reverse[vr];[v1][vr]concat=n=2:v=1:a=0" -c:v libx264 -preset fast -crf 22 -an -y "${pingpongPath}"`;
    execSync(ppCmd, { timeout: 60000, stdio: 'pipe' });
    if (fs.existsSync(pingpongPath) && fs.statSync(pingpongPath).size > 5000) {
      videoPath = pingpongPath;
      console.log('[Avatar] 乒乓循环视频创建完成（~10秒基础素材）');
    }
  } catch (ppErr) {
    console.warn('[Avatar] 乒乓循环失败:', ppErr.message?.slice(0, 80));
  }

  // 6. 生成 TTS 语音（如果有文本）
  let finalPath = videoPath;
  if (text && text.trim()) {
    onProgress?.({ step: 'tts', message: '生成语音配音...' });
    try {
      const voiceBase = path.join(taskDir, 'voice');
      const audioFile = await generateSpeech(text, voiceBase, { voiceId: voiceId || null });

      if (audioFile && fs.existsSync(audioFile)) {
        // 7. 合成视频 + 音频（循环视频匹配音频长度）
        onProgress?.({ step: 'merge', message: '合成视频与语音...' });
        const mergedPath = path.join(taskDir, 'avatar_final.mp4');
        const ffmpegStatic = require('ffmpeg-static');
        const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic;
        const { execSync } = require('child_process');

        try {
          // 获取音频时长
          const probeCmd = `"${ffmpegPath}" -i "${audioFile}" 2>&1`;
          let audioDuration = 5;
          try {
            const probeOut = execSync(probeCmd, { encoding: 'utf8', timeout: 10000 }).toString();
            const durMatch = probeOut.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
            if (durMatch) audioDuration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseInt(durMatch[3]) + parseInt(durMatch[4]) / 100;
          } catch (e) {
            const stderr = e.stderr?.toString() || e.stdout?.toString() || '';
            const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
            if (durMatch) audioDuration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseInt(durMatch[3]) + parseInt(durMatch[4]) / 100;
          }
          console.log(`[Avatar] 音频时长: ${audioDuration.toFixed(1)}秒，视频将循环匹配`);

          // 用 -stream_loop 循环视频到音频长度，重新编码
          const mergeCmd = `"${ffmpegPath}" -stream_loop -1 -i "${videoPath}" -i "${audioFile}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -map 0:v:0 -map 1:a:0 -t ${Math.ceil(audioDuration)} -movflags +faststart -y "${mergedPath}"`;
          execSync(mergeCmd, { timeout: 120000, stdio: 'pipe' });

          if (fs.existsSync(mergedPath) && fs.statSync(mergedPath).size > 1000) {
            finalPath = mergedPath;
            console.log(`[Avatar] 合成完成: ${(fs.statSync(mergedPath).size / 1024).toFixed(0)}KB, 时长≈${Math.ceil(audioDuration)}秒`);
          }
        } catch (mergeErr) {
          console.warn('[Avatar] 循环合成失败，回退到简单合成:', mergeErr.message);
          // 回退：简单合成 -shortest
          const fluent = require('fluent-ffmpeg');
          fluent.setFfmpegPath(ffmpegPath);
          await new Promise((resolve, reject) => {
            fluent(videoPath).input(audioFile)
              .outputOptions(['-c:v', 'copy', '-c:a', 'aac', '-map', '0:v:0', '-map', '1:a:0', '-shortest'])
              .output(mergedPath).on('end', resolve).on('error', reject).run();
          });
          if (fs.existsSync(mergedPath) && fs.statSync(mergedPath).size > 1000) finalPath = mergedPath;
        }
        try { fs.unlinkSync(audioFile); } catch {}
      }
    } catch (ttsErr) {
      console.warn('[Avatar] TTS 失败，使用无声视频:', ttsErr.message);
    }
  }

  return {
    taskDir,
    videoPath: finalPath
  };
}

/**
 * 多段视频生成 — 每段独立 CogVideoX + TTS，最后 crossfade 拼接
 */
async function generateMultiSegmentVideo(params) {
  const { imageUrl, segments, voiceId, ratio = '9:16', model = 'cogvideox-flash', background = 'office', onProgress } = params;
  const taskId = uuidv4();
  const taskDir = path.join(AVATAR_DIR, taskId);
  fs.mkdirSync(taskDir, { recursive: true });

  const useMiniMax = isMiniMaxModel(model);
  const useKling = isKlingModel(model);
  const apiKey = useKling ? getKlingKey() : (useMiniMax ? getMiniMaxKey() : getZhipuKey());
  if (!apiKey) throw new Error(useKling ? '未配置 Kling AI Key' : (useMiniMax ? '未配置 MiniMax API Key' : '未配置智谱 AI API Key'));
  const total = segments.length;

  onProgress?.({ step: 'start', message: `开始多段生成（共 ${total} 段）...` });

  // 1. 准备图片（只做一次）
  let imgParam;
  if (imageUrl.startsWith('http')) {
    imgParam = imageUrl;
  } else if (fs.existsSync(imageUrl)) {
    const buf = fs.readFileSync(imageUrl);
    const ext = path.extname(imageUrl).slice(1) || 'png';
    imgParam = `data:image/${ext};base64,${buf.toString('base64')}`;
  } else {
    throw new Error('无效的图片路径: ' + imageUrl);
  }

  const ffmpegStatic = require('ffmpeg-static');
  const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic;
  const { execSync } = require('child_process');

  const bgDescMap = {
    office: 'in a modern corporate office with city skyline view through glass windows, warm professional lighting',
    studio: 'in a professional TV broadcast studio with blue and purple neon lighting, LED screen background',
    classroom: 'in a modern bright classroom with whiteboard and bookshelves, warm natural lighting',
    outdoor: 'in a beautiful outdoor garden with cherry blossoms and soft golden sunlight',
    green: 'against a solid green chroma key background',
    custom: '',
  };
  const bgDesc = bgDescMap[background] || bgDescMap.office;

  const expressionMap = {
    natural: 'natural and relaxed facial expression',
    smile: 'warm smiling facial expression',
    serious: 'serious and focused facial expression',
    excited: 'excited and energetic facial expression',
    calm: 'calm and composed facial expression',
  };

  // 2. 并发生成各段视频（每次最多3个并发，避免 API 限流）
  const segClips = []; // [{videoPath, audioPath}]
  const CONCURRENCY = 2;

  for (let batch = 0; batch < total; batch += CONCURRENCY) {
    const batchSegs = segments.slice(batch, batch + CONCURRENCY);
    const batchPromises = batchSegs.map(async (seg, batchIdx) => {
      const idx = batch + batchIdx;
      const segDir = path.join(taskDir, `seg_${idx}`);
      fs.mkdirSync(segDir, { recursive: true });

      // 差异化 prompt —— 每段不同的表情和动作
      const exprDesc = expressionMap[seg.expression] || expressionMap.natural;
      const motion = seg.motion || 'natural speaking with subtle head movements';
      const textSnippet = seg.text.slice(0, 80);

      const prompt = `The person in the image is speaking naturally to the camera ${bgDesc ? bgDesc + ', ' : ''}with ${exprDesc}. ${motion}. They say: "${textSnippet}". Smooth lip movements, professional presentation.`;

      onProgress?.({ step: 'video', message: `生成第 ${idx + 1}/${total} 段视频...`, segment: idx + 1, total });

      const rawPath = path.join(segDir, 'raw.mp4');

      if (useKling) {
        // Kling 路径
        const segProgress = (info) => onProgress?.({ ...info, message: `第${idx+1}段: ${info.message}`, segment: idx + 1, total });
        const videoData = await _klingGenerateVideo(imgParam, prompt, model, apiKey, segProgress);
        fs.writeFileSync(rawPath, videoData);
      } else if (useMiniMax) {
        // MiniMax 路径
        const segProgress = (info) => onProgress?.({ ...info, message: `第${idx+1}段: ${info.message}`, segment: idx + 1, total });
        const videoData = await _minimaxGenerateVideo(imgParam, prompt, model, apiKey, segProgress);
        fs.writeFileSync(rawPath, videoData);
      } else {
        // 智谱 CogVideoX 路径
        let genRes;
        for (let retry = 0; retry < 5; retry++) {
          try {
            genRes = await axios.post(`${ZHIPU_API_BASE}/videos/generations`, {
              model, prompt, image_url: imgParam
            }, {
              headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
              timeout: 300000
            });
            break;
          } catch (apiErr) {
            const detail = apiErr.response?.data?.error?.message || apiErr.message;
            const status = apiErr.response?.status;
            const isNetworkErr = !apiErr.response && (apiErr.code === 'ECONNRESET' || apiErr.code === 'ECONNREFUSED' || /socket|TLS|ETIMEDOUT|network/i.test(apiErr.message));
            const isRateLimit = status === 429 || /访问量过大|rate.?limit|too many|请稍后/i.test(detail);
            if ((isNetworkErr || isRateLimit) && retry < 4) {
              const wait = isRateLimit ? 30 + retry * 15 : 10 * (retry + 1);
              const reason = isRateLimit ? '服务繁忙' : '网络波动';
              console.warn(`[Avatar] 第${idx + 1}段${reason}，${wait}秒后重试 (${retry + 1}/5): ${detail}`);
              onProgress?.({ step: 'video', message: `第${idx + 1}段${reason}，${wait}秒后自动重试...`, segment: idx + 1, total });
              await new Promise(r => setTimeout(r, wait * 1000));
              continue;
            }
            throw new Error(`第${idx + 1}段视频 API 失败: ${detail}`);
          }
        }

        const zhipuTaskId = genRes.data?.id;
        if (!zhipuTaskId) throw new Error(`第${idx + 1}段: 智谱 API 返回异常`);

        let videoUrl = null;
        for (let i = 0; i < 120; i++) {
          await new Promise(r => setTimeout(r, 5000));
          if (i % 6 === 0) onProgress?.({ step: 'video', message: `第 ${idx + 1}/${total} 段生成中... (${(i + 1) * 5}秒)`, segment: idx + 1, total });
          try {
            const pollRes = await axios.get(`${ZHIPU_API_BASE}/async-result/${zhipuTaskId}`, {
              headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 15000
            });
            if (pollRes.data?.task_status === 'SUCCESS') { videoUrl = pollRes.data?.video_result?.[0]?.url; break; }
            else if (pollRes.data?.task_status === 'FAIL') throw new Error(`第${idx + 1}段视频生成失败`);
          } catch (pollErr) {
            if (pollErr.message.includes('生成失败')) throw pollErr;
          }
        }
        if (!videoUrl) throw new Error(`第${idx + 1}段视频生成超时`);

        const videoResp = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 60000 });
        fs.writeFileSync(rawPath, videoResp.data);
      }

      // 乒乓循环
      const ppPath = path.join(segDir, 'pingpong.mp4');
      let segVideoPath = rawPath;
      try {
        const ppCmd = `"${ffmpegPath}" -i "${rawPath}" -filter_complex "[0:v]split[v1][v2];[v2]reverse[vr];[v1][vr]concat=n=2:v=1:a=0" -c:v libx264 -preset fast -crf 22 -an -y "${ppPath}"`;
        execSync(ppCmd, { timeout: 60000, stdio: 'pipe' });
        if (fs.existsSync(ppPath) && fs.statSync(ppPath).size > 5000) segVideoPath = ppPath;
      } catch {}

      // TTS
      onProgress?.({ step: 'tts', message: `第 ${idx + 1}/${total} 段配音...`, segment: idx + 1, total });
      let audioPath = null;
      if (seg.text && seg.text.trim()) {
        try {
          const voiceBase = path.join(segDir, 'voice');
          audioPath = await generateSpeech(seg.text, voiceBase, { voiceId: voiceId || null });
          if (!audioPath || !fs.existsSync(audioPath)) audioPath = null;
        } catch (ttsErr) {
          console.warn(`[Avatar] 第${idx + 1}段 TTS 失败:`, ttsErr.message);
        }
      }

      // 合成单段：循环视频匹配音频长度
      let finalSegPath = segVideoPath;
      if (audioPath) {
        const mergedPath = path.join(segDir, 'merged.mp4');
        try {
          let audioDuration = 5;
          try {
            const probeOut = execSync(`"${ffmpegPath}" -i "${audioPath}" 2>&1`, { encoding: 'utf8', timeout: 10000 });
            const dm = probeOut.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
            if (dm) audioDuration = +dm[1] * 3600 + +dm[2] * 60 + +dm[3] + +dm[4] / 100;
          } catch (e) {
            const stderr = e.stderr?.toString() || e.stdout?.toString() || '';
            const dm = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
            if (dm) audioDuration = +dm[1] * 3600 + +dm[2] * 60 + +dm[3] + +dm[4] / 100;
          }

          const mergeCmd = `"${ffmpegPath}" -stream_loop -1 -i "${segVideoPath}" -i "${audioPath}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -map 0:v:0 -map 1:a:0 -t ${Math.ceil(audioDuration)} -movflags +faststart -y "${mergedPath}"`;
          execSync(mergeCmd, { timeout: 120000, stdio: 'pipe' });
          if (fs.existsSync(mergedPath) && fs.statSync(mergedPath).size > 1000) {
            finalSegPath = mergedPath;
          }
        } catch (mergeErr) {
          console.warn(`[Avatar] 第${idx + 1}段合成失败:`, mergeErr.message?.slice(0, 80));
        }
      }

      return { idx, videoPath: finalSegPath };
    });

    const results = await Promise.all(batchPromises);
    segClips.push(...results);
  }

  // 排序确保顺序
  segClips.sort((a, b) => a.idx - b.idx);

  // 3. 拼接所有段落 — crossfade 过渡
  onProgress?.({ step: 'merge', message: '合成最终视频（无缝拼接）...' });
  const finalPath = path.join(taskDir, 'avatar_final.mp4');

  if (segClips.length === 1) {
    // 只有一段，直接用
    fs.copyFileSync(segClips[0].videoPath, finalPath);
  } else {
    // 创建 concat 文件列表
    const concatFile = path.join(taskDir, 'concat.txt');
    const concatContent = segClips.map(c => `file '${c.videoPath.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(concatFile, concatContent);

    try {
      // 先用 concat 拼接，然后用 crossfade（如果段数<=6且各段有音频）
      if (segClips.length <= 6) {
        // 使用 xfade 做视频过渡 + acrossfade 做音频过渡
        let filterComplex = '';
        let inputArgs = segClips.map(c => `-i "${c.videoPath}"`).join(' ');

        // 先获取每段时长
        const durations = [];
        for (const clip of segClips) {
          let dur = 5;
          try {
            const out = execSync(`"${ffmpegPath}" -i "${clip.videoPath}" 2>&1`, { encoding: 'utf8', timeout: 10000 });
            const dm = out.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
            if (dm) dur = +dm[1] * 3600 + +dm[2] * 60 + +dm[3] + +dm[4] / 100;
          } catch (e) {
            const stderr = e.stderr?.toString() || '';
            const dm = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
            if (dm) dur = +dm[1] * 3600 + +dm[2] * 60 + +dm[3] + +dm[4] / 100;
          }
          durations.push(dur);
        }

        // 构建 xfade filter chain
        const XFADE_DUR = 0.5; // 0.5秒过渡
        let vLabel = '[0:v]';
        let aLabel = '[0:a]';
        let offset = durations[0] - XFADE_DUR;

        for (let i = 1; i < segClips.length; i++) {
          const outV = i < segClips.length - 1 ? `[xv${i}]` : '[outv]';
          const outA = i < segClips.length - 1 ? `[xa${i}]` : '[outa]';
          filterComplex += `${vLabel}[${i}:v]xfade=transition=fade:duration=${XFADE_DUR}:offset=${Math.max(0, offset).toFixed(2)}${outV};`;
          filterComplex += `${aLabel}[${i}:a]acrossfade=d=${XFADE_DUR}${outA};`;
          vLabel = outV;
          aLabel = outA;
          offset += durations[i] - XFADE_DUR;
        }
        // 去掉末尾分号
        filterComplex = filterComplex.replace(/;$/, '');

        const xfadeCmd = `"${ffmpegPath}" ${inputArgs} -filter_complex "${filterComplex}" -map "[outv]" -map "[outa]" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart -y "${finalPath}"`;

        try {
          execSync(xfadeCmd, { timeout: 300000, stdio: 'pipe' });
        } catch (xfadeErr) {
          console.warn('[Avatar] xfade 拼接失败，回退 concat:', xfadeErr.message?.slice(0, 100));
          // 回退到简单 concat
          const concatCmd = `"${ffmpegPath}" -f concat -safe 0 -i "${concatFile}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart -y "${finalPath}"`;
          execSync(concatCmd, { timeout: 300000, stdio: 'pipe' });
        }
      } else {
        // 段数太多，直接 concat
        const concatCmd = `"${ffmpegPath}" -f concat -safe 0 -i "${concatFile}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart -y "${finalPath}"`;
        execSync(concatCmd, { timeout: 300000, stdio: 'pipe' });
      }
    } catch (concatErr) {
      console.error('[Avatar] 拼接失败:', concatErr.message?.slice(0, 100));
      // 最后兜底：直接用第一段
      fs.copyFileSync(segClips[0].videoPath, finalPath);
    }
  }

  if (!fs.existsSync(finalPath)) throw new Error('最终视频文件生成失败');
  const finalSize = fs.statSync(finalPath).size;
  console.log(`[Avatar] 多段拼接完成: ${segClips.length}段, ${(finalSize / 1024 / 1024).toFixed(1)}MB`);

  return { taskDir, videoPath: finalPath };
}

module.exports = { generateAvatarVideo, generateMultiSegmentVideo };
