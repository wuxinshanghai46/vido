/**
 * 教程数字人一条龙服务
 *   主题 → 自动生成人像 → AI 写口播文案 → TTS → 即梦 Omni → 视频
 */
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { generateJimengImage } = require('./imageService');
const { callLLM } = require('./storyService');
const { generateSpeech } = require('./ttsService');
const jimengAvatarService = require('./jimengAvatarService');

// Idol/偶像脸方向 — 视频里"黑猫教程"那个目标女生一样的抖音爆款审美
// 关键词：flawless porcelain skin, golden ratio, idol, magazine cover
// 负面：freckles/blemishes/pores/oily/wrinkles/plastic-doll
const DEFAULT_PORTRAIT_PROMPT =
  'cinematic beauty portrait photograph of a breathtakingly beautiful 23 year old east asian female idol, ' +
  'flawless luminous porcelain skin with natural healthy glow, perfect golden ratio facial harmony, ' +
  'large expressive almond eyes with sparkling catchlights, delicate pink cupid-bow lips with subtle gloss and natural gentle smile, ' +
  'small straight nose, long silky straight jet black hair falling gracefully over shoulders, ' +
  'wearing an elegant cream knit spaghetti-strap dress, ' +
  'seated upright facing camera in a warm cozy library with blurred wooden bookshelves and fairy lights bokeh, ' +
  'soft golden hour front-left light, even beauty-dish style key light on face, ' +
  'DSLR 85mm f/1.8 dreamy bokeh, vogue magazine cover quality, commercial beauty photography, ' +
  'one single person, perfectly centered 9:16 portrait, upper body composition with shoulders and chest fully visible, ' +
  'looking directly at viewer. ' +
  'NEGATIVE: freckles, blemishes, skin texture, visible pores, oily skin, wrinkles, harsh shadows, asymmetric features, plastic doll, 3D render, cartoon, anime, illustration, multiple people';

const SCRIPT_SYSTEM_PROMPT = `你是一位专写抖音/小红书知识类口播的顶尖编剧。按"黄金 4 段结构"写一段 **{DURATION}** 秒、约 **{CHARS}** 字的中文口播稿，朗读自然流畅：
1) 3 秒钩子：反常识 / 冲突 / 数字挑起好奇
2) 立论：一句话亮出核心观点
3) 证据/方法：1-3 个具体要点（用"第一/第二"或数字列举）
4) 钩子式收尾：留悬念或 CTA（关注/评论/收藏）

硬约束：
- 总字数控制在 {CHARS} ± 8 字以内（TTS 语速 ~4 字/秒）
- 不要带任何角色名、不要写"大家好"之类客套开头
- 不写舞台指令、不写表情括号、不要中英夹杂
- 只输出**口播正文**，不要标题/编号/前后缀
- 句子短促、人话、有节奏感`;

async function _generateScript({ topic, durationSec }) {
  const chars = Math.round(durationSec * 4);
  const system = SCRIPT_SYSTEM_PROMPT
    .replace('{DURATION}', String(durationSec))
    .replace(/{CHARS}/g, String(chars));
  const user = `主题：${topic}\n\n请直接写口播正文（不要其他）。`;
  const result = await callLLM(system, user, { temperature: 0.85 });
  const text = (result?.text || result || '').toString().trim();
  // 清掉常见的前后缀污染
  return text
    .replace(/^[""'「『]|[""'」』]$/g, '')
    .replace(/^【.*?】/, '')
    .replace(/^口播正文[:：]?\s*/, '')
    .replace(/^标题[:：].*?\n/, '')
    .trim();
}

async function _generatePortraitToAssets({ assetsDir, prompt }) {
  const charId = `avatar_auto_${uuidv4().slice(0, 8)}`;

  // 优先走 Seedream 5.0（flawless idol 质感 + watermark=false + 裁底）
  // 失败再 fallback 到即梦 T2I（并发=1，常被挤占）
  let producedPath = null;

  try {
    const { _arkSeedreamGenerate, getArkKey } = require('./avatarService');
    if (getArkKey && getArkKey()) {
      producedPath = await _arkSeedreamGenerate({
        prompt,
        filename: charId,
        aspectRatio: '9:16',
        watermark: false,
        cropBottomPx: 100,
        destDir: assetsDir,
      });
      console.log(`[tutorialProducer] portrait via Seedream 5.0 → ${producedPath}`);
    }
  } catch (e) {
    console.warn(`[tutorialProducer] Seedream 失败，fallback 即梦: ${e.message}`);
  }

  if (!producedPath || !fs.existsSync(producedPath)) {
    producedPath = await generateJimengImage({
      prompt,
      filename: charId,
      dim: '2d',
      aspectRatio: '3:4',
    });
    if (!producedPath || !fs.existsSync(producedPath)) throw new Error('人像生成失败（Seedream 与即梦均失败）');
    console.log(`[tutorialProducer] portrait via 即梦 fallback → ${producedPath}`);
  }

  // 若产出路径不在 assetsDir，复制一份过去（统一公开访问）
  if (path.dirname(producedPath) === assetsDir) {
    return path.basename(producedPath);
  }
  const dstName = `${uuidv4()}.png`;
  const dstPath = path.join(assetsDir, dstName);
  fs.copyFileSync(producedPath, dstPath);
  return dstName;
}

async function _ttsToAssets({ assetsDir, text, voiceId }) {
  const base = path.join(assetsDir, uuidv4());
  const result = await generateSpeech(text, base, { voiceId: voiceId || null, speed: 1.0 });
  if (!result) throw new Error('TTS 失败');
  return path.basename(result);
}

/**
 * 一条龙生产
 * @param {object} opts
 * @param {string} opts.topic 视频主题
 * @param {number} [opts.durationSec=20]
 * @param {string} [opts.portraitPrompt] 自定义人像 prompt；空则默认
 * @param {string} [opts.voiceId] TTS 音色
 * @param {string} opts.publicBaseUrl 公网 URL 根（http://host:port）
 * @param {string} opts.assetsDir 公开素材目录（server.js 已挂 /public/jimeng-assets）
 * @param {(stage: {name: string, meta?: any}) => void} [opts.onStage]
 * @returns {Promise<{portrait_url, script, audio_url, video_url, cv_task_id}>}
 */
async function produceTutorialVideo({ topic, durationSec = 20, portraitPrompt = '', voiceId = '', publicBaseUrl, assetsDir, onStage } = {}) {
  if (!topic || !String(topic).trim()) throw new Error('topic 必填');
  if (!publicBaseUrl) throw new Error('publicBaseUrl 必填');
  if (!assetsDir) throw new Error('assetsDir 必填');
  const report = (name, meta) => { try { onStage && onStage({ name, meta }); } catch {} };

  // 并行：人像 + 文案
  report('portrait_start');
  report('script_start');
  const [portraitName, script] = await Promise.all([
    _generatePortraitToAssets({ assetsDir, prompt: portraitPrompt || DEFAULT_PORTRAIT_PROMPT }),
    _generateScript({ topic, durationSec }),
  ]);
  report('portrait_done', { name: portraitName });
  report('script_done', { length: script.length, preview: script.slice(0, 60) });

  const portraitUrl = `${publicBaseUrl}/public/jimeng-assets/${portraitName}`;

  // TTS
  report('tts_start');
  const audioName = await _ttsToAssets({ assetsDir, text: script, voiceId });
  report('tts_done', { name: audioName });
  const audioUrl = `${publicBaseUrl}/public/jimeng-assets/${audioName}`;

  // 即梦 Omni
  report('jimeng_start');
  const { taskId: cvTaskId, videoUrl } = await jimengAvatarService.generateDigitalHumanVideo({
    imageUrl: portraitUrl,
    audioUrl,
    prompt: '严格保持原图人物面部特征不变，不要改变发型/年龄/肤色/五官/脸型，自然表情，嘴型清晰与音频同步，眼神坚定有感染力，真人摄影质感，preserve exact facial identity',
    timeoutMs: 15 * 60 * 1000,
    onProgress: (info) => report('jimeng_progress', info),
  });
  report('jimeng_done', { videoUrl });

  return {
    portrait_url: portraitUrl,
    audio_url: audioUrl,
    video_url: videoUrl,
    script,
    cv_task_id: cvTaskId,
  };
}

module.exports = {
  produceTutorialVideo,
  generateScript: _generateScript,
  DEFAULT_PORTRAIT_PROMPT,
};
