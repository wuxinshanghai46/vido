/**
 * 数字人视频生成服务
 * 基于智谱AI CogVideoX 图生视频 + TTS 语音合成
 * 流程：人像图片 → CogVideoX 动画视频 → TTS 生成语音 → FFmpeg 合成
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { getApiKey } = require('./settingsService');
const { loadSettings } = require('./settingsService');
const { generateSpeech } = require('./ttsService');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');
const AVATAR_DIR = path.join(OUTPUT_DIR, 'avatar');

// 智谱 API 配置
const ZHIPU_API_BASE = 'https://open.bigmodel.cn/api/paas/v4';

function getZhipuKey() {
  // 优先从 settings 获取，回退到 env
  const settings = loadSettings();
  for (const p of (settings.providers || [])) {
    if (p.id === 'zhipu' || p.preset === 'zhipu') {
      const key = getApiKey(p.id);
      if (key) return key;
    }
  }
  return process.env.ZHIPU_API_KEY || '';
}

/**
 * 生成数字人视频
 * @param {object} params
 * @param {string} params.imageUrl - 人像图片 URL 或本地路径
 * @param {string} params.text - 要说的话（用于 TTS 和 prompt）
 * @param {string} params.voiceId - TTS 音色
 * @param {string} params.ratio - 比例 9:16 / 16:9 / 1:1
 * @param {string} params.model - 模型 cogvideox-3 / cogvideox-flash
 * @param {function} params.onProgress - 进度回调
 */
async function generateAvatarVideo(params) {
  const { imageUrl, text, voiceId, ratio = '9:16', model = 'cogvideox-flash', onProgress } = params;
  const taskId = uuidv4();
  const taskDir = path.join(AVATAR_DIR, taskId);
  fs.mkdirSync(taskDir, { recursive: true });

  const apiKey = getZhipuKey();
  if (!apiKey) throw new Error('未配置智谱 AI API Key');

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

  const prompt = text
    ? `The person in the image is speaking naturally to the camera. They say: "${text.slice(0, 100)}". Natural head movements, subtle facial expressions, professional presentation, smooth lip movements.`
    : 'The person in the image is speaking naturally to the camera with confident expression, subtle head movements, professional demeanor, smooth motion.';

  onProgress?.({ step: 'video', message: '正在生成动画视频（约1-3分钟）...' });

  // 3. 调用智谱 CogVideoX API
  const genRes = await axios.post(`${ZHIPU_API_BASE}/videos/generations`, {
    model,
    prompt,
    image_url: imgParam,
    size,
    duration: 5,
    fps: 30,
    quality: 'quality'
  }, {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 30000
  });

  const zhipuTaskId = genRes.data?.id;
  if (!zhipuTaskId) throw new Error('智谱 API 返回异常: ' + JSON.stringify(genRes.data));

  // 4. 轮询等待结果
  let videoUrl = null;
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    onProgress?.({ step: 'video', message: `等待视频生成... (${(i + 1) * 5}秒)` });

    try {
      const pollRes = await axios.get(`${ZHIPU_API_BASE}/async-result/${zhipuTaskId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        timeout: 15000
      });

      const status = pollRes.data?.task_status;
      if (status === 'SUCCESS') {
        videoUrl = pollRes.data?.video_result?.[0]?.url;
        break;
      } else if (status === 'FAIL') {
        throw new Error('视频生成失败: ' + (pollRes.data?.message || '未知错误'));
      }
    } catch (pollErr) {
      if (pollErr.message.includes('视频生成失败')) throw pollErr;
      // 网络错误继续重试
    }
  }

  if (!videoUrl) throw new Error('视频生成超时，请重试');

  // 5. 下载视频
  onProgress?.({ step: 'download', message: '下载生成的视频...' });
  const videoPath = path.join(taskDir, 'avatar_raw.mp4');
  const videoResp = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 60000 });
  fs.writeFileSync(videoPath, videoResp.data);

  // 6. 生成 TTS 语音（如果有文本）
  let finalPath = videoPath;
  if (text && text.trim()) {
    onProgress?.({ step: 'tts', message: '生成语音配音...' });
    try {
      const voiceBase = path.join(taskDir, 'voice');
      const audioFile = await generateSpeech(text, voiceBase, { voiceId: voiceId || null });

      if (audioFile && fs.existsSync(audioFile)) {
        // 7. 合成视频 + 音频
        onProgress?.({ step: 'merge', message: '合成视频与语音...' });
        const mergedPath = path.join(taskDir, 'avatar_final.mp4');
        const ffmpeg = require('fluent-ffmpeg');
        const ffmpegStatic = require('ffmpeg-static');
        ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || ffmpegStatic);

        await new Promise((resolve, reject) => {
          ffmpeg(videoPath)
            .input(audioFile)
            .outputOptions([
              '-c:v', 'copy',
              '-c:a', 'aac',
              '-map', '0:v:0',
              '-map', '1:a:0',
              '-shortest'
            ])
            .output(mergedPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });

        if (fs.existsSync(mergedPath) && fs.statSync(mergedPath).size > 1000) {
          finalPath = mergedPath;
        }
        try { fs.unlinkSync(audioFile); } catch {}
      }
    } catch (ttsErr) {
      console.warn('[Avatar] TTS 失败，使用无声视频:', ttsErr.message);
    }
  }

  onProgress?.({ step: 'done', message: '数字人视频生成完成' });

  return {
    taskId,
    videoPath: finalPath,
    videoUrl: `/api/avatar/tasks/${taskId}/stream`
  };
}

module.exports = { generateAvatarVideo };
