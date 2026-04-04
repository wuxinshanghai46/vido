/**
 * AI 配乐生成服务
 * 根据场景情绪/风格自动生成背景音乐
 * 支持：Suno API（需配置 key）/ 本地生成静音+节拍
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUTPUT_DIR = path.join(__dirname, '../../outputs/music');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

/**
 * 根据场景描述生成 AI 音乐 prompt
 */
function buildMusicPrompt(scenes, genre, mood) {
  const sceneTexts = (scenes || []).map(s => s.mood || s.title || '').filter(Boolean).join(', ');
  const genreMap = {
    '魔幻': 'epic orchestral fantasy, sweeping strings, choir',
    '科幻': 'electronic ambient, sci-fi synths, futuristic soundscape',
    '都市': 'modern pop, urban beat, city vibe',
    '古风': 'Chinese traditional instruments, guzheng, bamboo flute, erhu',
    '搞笑': 'upbeat quirky, playful ukulele, comedy',
    '恐怖': 'dark ambient, tension strings, horror atmosphere',
    '爱情': 'romantic piano, gentle strings, warm emotional',
    '动作': 'intense percussion, driving drums, action thriller',
    '纪录片': 'cinematic ambient, atmospheric, documentary score',
  };

  const moodMap = {
    '紧张': 'tense suspenseful building',
    '欢快': 'happy uplifting joyful',
    '悲伤': 'sad melancholic emotional',
    '史诗': 'epic grand heroic triumphant',
    '温馨': 'warm cozy heartfelt tender',
    '神秘': 'mysterious enigmatic ethereal',
    '激昂': 'energetic powerful dynamic',
  };

  const genrePrompt = genreMap[genre] || 'cinematic background music';
  const moodPrompt = moodMap[mood] || mood || '';

  return `${genrePrompt}, ${moodPrompt}, ${sceneTexts}, instrumental, no vocals, background music, professional production, high quality`.substring(0, 500);
}

/**
 * 通过 Suno API 生成音乐
 */
async function generateWithSuno(prompt, duration, apiKey) {
  const body = JSON.stringify({
    prompt,
    make_instrumental: true,
    wait_audio: true
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.sunoapi.org',
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`Suno API ${res.statusCode}: ${data}`));
        try {
          const result = JSON.parse(data);
          const audioUrl = result?.[0]?.audio_url || result?.audio_url;
          if (audioUrl) resolve(audioUrl);
          else reject(new Error('Suno 未返回音频 URL'));
        } catch (e) { reject(new Error('Suno 响应解析失败')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Suno 生成超时')); });
    req.write(body);
    req.end();
  });
}

/**
 * 下载远程音频到本地
 */
function downloadAudio(url, outputPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : require('http');
    proto.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadAudio(res.headers.location, outputPath).then(resolve).catch(reject);
      }
      const ws = fs.createWriteStream(outputPath);
      res.pipe(ws);
      ws.on('finish', () => { ws.close(); resolve(outputPath); });
    }).on('error', reject);
  });
}

/**
 * 生成 FFmpeg 静音+节拍音轨作为兜底（无需API）
 */
async function generateLocalBeat(duration, mood, outputPath) {
  const ffmpegPath = (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== 'ffmpeg')
    ? process.env.FFMPEG_PATH : require('ffmpeg-static');
  const { execSync } = require('child_process');

  // 用 FFmpeg 生成简单的 ambient tone（总比没有好）
  const freq = mood === '紧张' ? 220 : mood === '欢快' ? 440 : 330;
  try {
    execSync(
      `"${ffmpegPath}" -f lavfi -i "sine=frequency=${freq}:duration=${duration}" -af "volume=0.05,afade=t=in:ss=0:d=2,afade=t=out:st=${duration - 2}:d=2" -c:a aac -b:a 64k -y "${outputPath}"`,
      { stdio: 'pipe', timeout: 30000 }
    );
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 100) {
      return outputPath;
    }
  } catch {}
  return null;
}

/**
 * 主入口：根据项目信息生成配乐
 * @param {object} options - { scenes, genre, mood, duration, projectId }
 * @returns {{ filePath: string, source: string }}
 */
async function generateMusic({ scenes, genre, mood, duration = 60, projectId }) {
  const outputPath = path.join(OUTPUT_DIR, `${projectId || 'music'}_bgm.mp3`);
  const prompt = buildMusicPrompt(scenes, genre, mood);
  console.log(`[Music] 生成配乐 prompt: ${prompt.substring(0, 100)}...`);

  // 策略1: Suno API
  try {
    const { loadSettings } = require('./settingsService');
    const settings = loadSettings();
    const suno = settings.providers?.find(p => p.id === 'suno' && p.enabled && p.api_key);
    if (suno?.api_key) {
      console.log('[Music] 使用 Suno API 生成配乐...');
      const audioUrl = await generateWithSuno(prompt, duration, suno.api_key);
      await downloadAudio(audioUrl, outputPath);
      return { filePath: outputPath, source: 'suno', prompt };
    }
  } catch (err) {
    console.warn('[Music] Suno 生成失败:', err.message);
  }

  // 策略2: 本地 FFmpeg 生成 ambient（兜底）
  console.log('[Music] 使用本地生成简单配乐...');
  const local = await generateLocalBeat(duration, mood, outputPath.replace('.mp3', '.m4a'));
  if (local) return { filePath: local, source: 'local', prompt };

  return null;
}

module.exports = { generateMusic, buildMusicPrompt };
