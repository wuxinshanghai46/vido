/**
 * 数字人视频生成服务
 * 支持：智谱AI CogVideoX / MiniMax Hailuo / Kling AI 图生视频 + TTS 语音合成
 * 流程：人像图片 → AI分镜 → 情绪曲线 → 视频模型动画 → 镜头后处理 → TTS → FFmpeg 合成
 *
 * v2 新增：
 *   - agentStoryboard()   — AI 自动分镜（景别 + 转场 + 动作）
 *   - agentEmotionCurve() — 逐句 NLP 情绪标注
 *   - applyCameraMove()   — FFmpeg 镜头后处理（推拉摇移）
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

// ═══════════════════════════════════════════════
// AI 分镜 Agent — 文本 → 镜头编排
// ═══════════════════════════════════════════════

/**
 * 镜头类型定义
 * close_up  — 特写（头肩，面部占 60%+，用于强调/情绪）
 * medium    — 中景（腰部以上，叙述/默认景别）
 * full      — 全景（全身+环境，开场/收尾）
 * zoom_in   — 推镜头（中景→特写过渡，聚焦/紧张）
 * zoom_out  — 拉镜头（特写→全景过渡，揭示/松弛）
 * pan_left / pan_right — 横摇
 */
const CAMERA_TYPES = ['close_up', 'medium', 'full', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right'];

const STORYBOARD_SYSTEM_PROMPT = `你是一个专业的数字人视频分镜师。给你一段数字人要说的文本，你需要将它拆分成多个"镜头段落"（shots），每个 shot 包含：
- text: 这一段要说的台词（完整句子，不要截断）
- camera: 镜头类型，从以下选择：close_up（特写）、medium（中景）、full（全景）、zoom_in（推镜头）、zoom_out（拉镜头）、pan_left（左摇）、pan_right（右摇）
- emotion: 情绪标签：neutral / happy / serious / excited / sad / surprised / confident / warm
- emotion_intensity: 情绪强度 0.0-1.0
- action: 一句话英文动作描述（如 "nodding gently while speaking", "pointing forward with right hand", "leaning forward with emphasis"）
- transition: 转场类型：cut（硬切）、crossfade（溶解，默认）、none（第一个镜头）

分镜原则：
1. 开场用 medium 或 full，建立画面
2. 强调关键词/数字/重点时切 close_up 或 zoom_in
3. 每 10-15 秒换一次景别，避免视觉疲劳
4. 列举内容（第一、第二...）用 medium 稳定画面
5. 总结/收尾用 zoom_out 给松弛感
6. 情绪高涨时用 close_up，冷静分析时用 medium
7. 不要过度切换，2-3 种景别交替即可
8. 每段台词 15-60 字为宜（说 5-20 秒）

**动作连贯性（极重要 — 违反会让视频看起来离谱）：**
- action 字段必须是"站定对着镜头说话时的动作"，所有段都能连起来播
- ✅ 允许: nodding gently, slight head tilt, raising eyebrows, small hand gesture at chest level, subtle shoulder movement, open palm, pointing forward with right hand, leaning slightly forward
- ❌ 禁止: picking up anything, holding a prop, walking, turning away, looking down at phone, eating, drinking, typing, looking off-camera, 拿东西/走动/转身/低头看手机/使用电子设备 等
- 相邻两段之间动作幅度要接近（不要上一段 subtle nod 下一段 dramatic arm sweep）
- 人物始终面向镜头，服装/灯光/背景/发型在所有段保持一致

输出严格 JSON 数组，不要 markdown 代码块：
[{"text":"...","camera":"medium","emotion":"neutral","emotion_intensity":0.5,"action":"speaking naturally with calm gestures","transition":"none"}, ...]`;

async function agentStoryboard(text) {
  if (!text || text.trim().length < 10) {
    // 太短，不需要分镜，返回单镜头
    return [{ text: text.trim(), camera: 'medium', emotion: 'neutral', emotion_intensity: 0.5, action: 'speaking naturally with subtle gestures', transition: 'none' }];
  }

  try {
    const { getStoryConfig, callLLM } = _getLLMHelper();
    const config = getStoryConfig();
    if (!config) throw new Error('无可用 LLM');

    const result = await callLLM(config, STORYBOARD_SYSTEM_PROMPT, `请对以下数字人台词进行分镜编排：\n\n${text}`);
    const shots = JSON.parse(result.text.replace(/```json?\s*/g, '').replace(/```/g, '').trim());

    if (!Array.isArray(shots) || shots.length === 0) throw new Error('分镜结果为空');

    // 校验并补全字段
    return shots.map((s, i) => ({
      text: s.text || '',
      camera: CAMERA_TYPES.includes(s.camera) ? s.camera : 'medium',
      emotion: s.emotion || 'neutral',
      emotion_intensity: Math.max(0, Math.min(1, Number(s.emotion_intensity) || 0.5)),
      action: s.action || 'speaking naturally',
      transition: i === 0 ? 'none' : (s.transition || 'crossfade'),
    }));
  } catch (err) {
    console.warn('[Avatar] AI 分镜失败，使用自动规则分镜:', err.message);
    return _ruleBasedStoryboard(text);
  }
}

/** 规则兜底分镜：按标点/段落切分 + 简单镜头轮换 */
function _ruleBasedStoryboard(text) {
  // 按句号/感叹号/问号/换行 切分
  const sentences = text.split(/(?<=[。！？\n])\s*/).filter(s => s.trim().length > 0);

  // 合并过短的句子
  const merged = [];
  let buf = '';
  for (const s of sentences) {
    buf += s;
    if (buf.length >= 15) { merged.push(buf.trim()); buf = ''; }
  }
  if (buf.trim()) {
    if (merged.length > 0 && merged[merged.length - 1].length < 30) {
      merged[merged.length - 1] += buf.trim();
    } else {
      merged.push(buf.trim());
    }
  }
  if (merged.length === 0) merged.push(text.trim());

  // 镜头轮换模式
  const cameraPattern = merged.length <= 2
    ? ['medium', 'medium']
    : ['medium', 'medium', 'close_up', 'medium', 'zoom_in', 'medium', 'close_up', 'zoom_out'];

  return merged.map((t, i) => ({
    text: t,
    camera: cameraPattern[i % cameraPattern.length],
    emotion: 'neutral',
    emotion_intensity: 0.5,
    action: i === 0 ? 'greeting with a warm smile' : i === merged.length - 1 ? 'concluding with a nod' : 'speaking with natural gestures',
    transition: i === 0 ? 'none' : 'crossfade',
  }));
}

// ═══════════════════════════════════════════════
// 情绪曲线 Agent — 逐句情感分析
// ═══════════════════════════════════════════════

const EMOTION_SYSTEM_PROMPT = `你是情感分析专家。给你一组数字人台词片段，为每段标注情绪。

输出严格 JSON 数组，每个元素：
{"emotion":"neutral|happy|serious|excited|sad|surprised|confident|warm","intensity":0.0-1.0,"action_hint":"一句英文动作提示"}

规则：
- 问候语/自我介绍 → warm 0.6
- 列举/分析 → neutral 0.4 或 serious 0.5
- 好消息/成就 → happy 0.7 或 excited 0.8
- 问题/挑战 → serious 0.6
- 鼓励/承诺 → confident 0.7
- 疑问句 → 根据语气判断
- action_hint 要具体，如 "nodding slowly", "raising eyebrows", "open palm gesture"`;

// ═══════════════════════════════════════════════
// 智能镜头组合 Agent — 根据内容 + 业务场景 AI 推荐镜头序列
// ═══════════════════════════════════════════════

const SMART_CAMERA_SYSTEM_PROMPT = `你是一名资深视频导演。给你一段数字人台词 + 业务场景，输出一个镜头编排序列。

支持的业务场景：
- promo   (带货/产品推广): 开场全景建立信任 → 中景讲解 → 特写强调卖点 → 推镜聚焦 → 产品贴近特写
- knowledge (知识/科普): 中景为主稳定讲解 → 关键知识点用特写 → 总结用拉镜
- news    (新闻播报): 全程中景稳定，少动 → 结语偶尔推镜
- story   (故事): 富变化，开场全景建立氛围 → 特写抓情绪转折 → 推镜入戏 → 拉镜松弛
- tutorial (教程): 步骤切换用推镜/特写强调 → 说明用中景 → 结尾拉镜总结
- live    (直播口播): 中景 + 特写交替不单调

输出严格 JSON 数组，每项：
{"text":"这段台词（从原文切出，连起来等于原文）","camera":"medium/close_up/full/zoom_in/zoom_out/pan_left/pan_right/orbit","reason":"简短选择理由"}

规则：
1. text 段落 20-50 字，合起来=原文
2. 每 2-3 段换一次景别，避免连续相同
3. 情绪转折点 ↔ 特写
4. 列举/平铺 ↔ 中景稳定
5. 开场/收尾用相对变化大（full/zoom_out）`;

async function agentSmartCameraShots(text, scenario = 'live') {
  if (!text || text.trim().length < 10) return null;
  try {
    const storyService = require('./storyService');
    const out = await storyService.callLLM(
      SMART_CAMERA_SYSTEM_PROMPT,
      `业务场景：${scenario}\n\n台词原文：\n${text}\n\n请输出镜头序列 JSON 数组。`,
      { agentId: 'avatar_smart_camera' }
    );
    const jsonMatch = out.match(/\[[\s\S]*\]/);
    const shots = JSON.parse(jsonMatch ? jsonMatch[0] : out);
    if (!Array.isArray(shots) || shots.length === 0) throw new Error('empty');
    const VALID_CAMS = ['medium','close_up','full','zoom_in','zoom_out','pan_left','pan_right','tilt_up','tilt_down','orbit'];
    return shots.map(s => ({
      text: String(s.text || '').trim(),
      camera: VALID_CAMS.includes(s.camera) ? s.camera : 'medium',
      reason: s.reason || '',
    })).filter(s => s.text);
  } catch (err) {
    console.warn('[Avatar] 智能镜头推荐失败:', err.message);
    return null;
  }
}

async function agentEmotionCurve(shots) {
  if (!shots || shots.length === 0) return shots;

  try {
    const { getStoryConfig, callLLM } = _getLLMHelper();
    const config = getStoryConfig();
    if (!config) return shots;

    const textsJson = JSON.stringify(shots.map(s => s.text));
    const result = await callLLM(config, EMOTION_SYSTEM_PROMPT, textsJson);
    const emotions = JSON.parse(result.text.replace(/```json?\s*/g, '').replace(/```/g, '').trim());

    if (Array.isArray(emotions) && emotions.length === shots.length) {
      return shots.map((s, i) => ({
        ...s,
        emotion: emotions[i].emotion || s.emotion,
        emotion_intensity: emotions[i].intensity ?? s.emotion_intensity,
        action: emotions[i].action_hint || s.action,
      }));
    }
  } catch (err) {
    console.warn('[Avatar] 情绪曲线 AI 失败:', err.message);
  }
  return shots;
}

// ═══════════════════════════════════════════════
// 镜头后处理 — FFmpeg zoompan/crop 模拟推拉摇移
// ═══════════════════════════════════════════════

/**
 * 对单个视频片段应用镜头运动效果
 * @param {string} inputPath - 输入视频
 * @param {string} outputPath - 输出视频
 * @param {string} camera - 镜头类型
 * @param {number} duration - 视频时长（秒）
 * @returns {string} 实际输出路径
 */
function applyCameraMove(inputPath, outputPath, camera, duration) {
  const ffmpegStatic = require('ffmpeg-static');
  const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic;
  const { execSync } = require('child_process');

  // 对于 medium/无特殊镜头，直接返回原片
  if (!camera || camera === 'medium') return inputPath;

  let filter = '';
  // fps=25 标准化 → zoompan 处理 → 输出
  // zoompan: z=缩放倍率, x/y=偏移, d=每帧停留, s=输出分辨率, fps=帧率
  const fps = 25;
  const totalFrames = Math.round(duration * fps);

  switch (camera) {
    case 'close_up':
      // 固定 1.3x 居中裁切 — 模拟特写
      filter = `scale=iw*2:ih*2,zoompan=z='1.3':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=hd720:fps=${fps}`;
      break;

    case 'zoom_in':
      // 从 1.0x 缓慢推到 1.4x — 聚焦效果
      filter = `scale=iw*2:ih*2,zoompan=z='min(1.0+0.4*on/${totalFrames},1.4)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=hd720:fps=${fps}`;
      break;

    case 'zoom_out':
      // 从 1.4x 缓慢拉到 1.0x — 揭示效果
      filter = `scale=iw*2:ih*2,zoompan=z='max(1.4-0.4*on/${totalFrames},1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=hd720:fps=${fps}`;
      break;

    case 'pan_left':
      // 从右向左平移 — 水平扫视
      filter = `scale=iw*2:ih*2,zoompan=z='1.2':x='(iw/2-(iw/zoom/2))*(1-on/${totalFrames})+(iw/4)*on/${totalFrames}':y='ih/2-(ih/zoom/2)':d=1:s=hd720:fps=${fps}`;
      break;

    case 'pan_right':
      // 从左向右平移
      filter = `scale=iw*2:ih*2,zoompan=z='1.2':x='(iw/4)*(1-on/${totalFrames})+(iw/2-(iw/zoom/2))*on/${totalFrames}':y='ih/2-(ih/zoom/2)':d=1:s=hd720:fps=${fps}`;
      break;

    case 'full':
      // 全景 — 轻微缩小 + 微幅呼吸式缩放
      filter = `scale=iw*2:ih*2,zoompan=z='1.0+0.02*sin(on/${totalFrames}*3.14)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=hd720:fps=${fps}`;
      break;

    default:
      return inputPath;
  }

  try {
    const cmd = `"${ffmpegPath}" -i "${inputPath}" -vf "${filter}" -c:v libx264 -preset fast -crf 22 -an -y "${outputPath}"`;
    execSync(cmd, { timeout: 120000, stdio: 'pipe' });
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 5000) {
      console.log(`[Avatar] 镜头后处理: ${camera} → ${path.basename(outputPath)}`);
      return outputPath;
    }
  } catch (err) {
    console.warn(`[Avatar] 镜头后处理失败 (${camera}):`, err.message?.slice(0, 80));
  }
  return inputPath;
}

// ═══════════════════════════════════════════════
// LLM 调用辅助
// ═══════════════════════════════════════════════

function _getLLMHelper() {
  // 复用 storyService 的 callLLM（已含 KB 注入 + token 追踪 + Anthropic 支持）
  const storyService = require('./storyService');

  return {
    getStoryConfig: () => true, // callLLM 内部自行读取 config
    callLLM: async (_config, systemPrompt, userPrompt) => {
      const text = await storyService.callLLM(systemPrompt, userPrompt, { agentId: 'avatar_director' });
      return { text };
    },
  };
}

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
// Hedra 模型列表（专业 audio-driven lip-sync）
const HEDRA_MODELS = ['hedra-character-3', 'hedra-character-2'];
const HEDRA_API_BASE = 'https://api.hedra.com/web-app/public';
// Seedance / 豆包火山方舟视频模型（2026-04 更新）
// 1-5-pro 支持 TextToAudioVideo / ImageToAudioVideo（带音频同步 — 数字人核心）
// 2-0 支持 MultimodalToVideo / VideoEditing / VideoExtension
const SEEDANCE_AV_MODELS = [
  'doubao-seedance-1-5-pro-251215',  // ⭐ 图+音频→视频
  'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast-260128',
];
// 其他 seedance（没音频同步，走普通 i2v）
const SEEDANCE_VIDEO_MODELS = [
  'doubao-seedance-1-0-pro-250528',
  'doubao-seedance-1-0-pro-fast-251015',
  'doubao-seedance-2-0-t2v-250428',
  'doubao-seedance-2-0-i2v-250428',
];
const ARK_API_BASE = 'https://ark.cn-beijing.volces.com/api/v3';

function isMiniMaxModel(model) { return MINIMAX_MODELS.includes(model); }
function isKlingModel(model) { return KLING_MODELS.includes(model); }
function isHedraModel(model) { return HEDRA_MODELS.includes(model); }
function isSeedanceModel(model) { return SEEDANCE_AV_MODELS.includes(model) || SEEDANCE_VIDEO_MODELS.includes(model) || /^doubao-seedance-/.test(model || ''); }
function isSeedanceAVModel(model) { return SEEDANCE_AV_MODELS.includes(model) || /^doubao-seedance-1-5-pro|^doubao-seedance-2-0-(260128|fast)/.test(model || ''); }

// ═══════════════════════════════════════════════
// 结构化运镜 (Kling camera_control) — P1
// ═══════════════════════════════════════════════

/**
 * 把 camera 字段（字符串 or 对象）标准化
 * 字符串 → 预设映射；对象 → 直接透传（已符合 Kling camera_control 规范）
 *
 * 返回 { type: 'simple'|'structured', simple: 'close_up'|..., kling: {type, config}, prompt_hint: 'english' }
 */
function normalizeCamera(camera) {
  if (!camera) return { type: 'simple', simple: 'medium', kling: null, prompt_hint: '' };
  if (typeof camera === 'string') {
    // 简单字符串 → 预设映射到 Kling camera_control（统一 type: 'simple'，config 含单一轴值）
    // Kling API 要求：要么预设（down_back/forward_up/...），要么 simple+config
    const KLING_PRESETS = {
      close_up:  { type: 'simple',    config: { zoom: 3 },              hint: 'close-up shot of the face' },
      zoom_in:   { type: 'simple',    config: { zoom: 5 },              hint: 'slow zoom in on the subject' },
      zoom_out:  { type: 'simple',    config: { zoom: -5 },             hint: 'slow zoom out revealing the environment' },
      pan_left:  { type: 'simple',    config: { horizontal: -5 },       hint: 'camera pans to the left' },
      pan_right: { type: 'simple',    config: { horizontal: 5 },        hint: 'camera pans to the right' },
      tilt_up:   { type: 'simple',    config: { vertical: 5 },          hint: 'camera tilts upward' },
      tilt_down: { type: 'simple',    config: { vertical: -5 },         hint: 'camera tilts downward' },
      orbit:     { type: 'simple',    config: { pan: 5 },               hint: 'camera orbits around the subject' },
      push_in:   { type: 'forward_up',config: {},                       hint: 'camera pushes forward toward the subject' },
      full:      null,                                                  // 不发 camera_control
      medium:    null,                                                  // 不发 camera_control
    };
    const p = KLING_PRESETS[camera];
    return {
      type: 'simple',
      simple: camera,
      kling: p && p.type ? { type: p.type, config: p.config } : null,
      prompt_hint: (p?.hint) || '',
    };
  }
  // 对象形式 — 统一转成 Kling 官方 camera_control 规范
  // Kling 要求 type 必须是：simple/down_back/forward_up/right_turn_forward/left_turn_forward/horizontal_shake/vertical_shake
  // 其中 simple 的 config 可含 {horizontal, vertical, pan, tilt, roll, zoom} 任一项
  const sim = camera.simple || 'medium';
  const cfg = camera.config || {};
  // 只要有任一轴非零 → 用 type:'simple' + 该 config
  const hasAxis = Object.values(cfg).some(v => typeof v === 'number' && v !== 0);
  const kling = hasAxis ? { type: 'simple', config: cfg } : (camera.type && ['down_back','forward_up','right_turn_forward','left_turn_forward','horizontal_shake','vertical_shake','simple'].includes(camera.type) ? { type: camera.type, config: cfg } : null);
  // prompt 提示（给非 Kling 模型做 prompt-driven 运镜）
  const hints = [];
  if (kling) {
    const c = kling.config || {};
    if (c.zoom > 0) hints.push(`slow zoom in (intensity ${c.zoom})`);
    if (c.zoom < 0) hints.push(`slow zoom out (intensity ${-c.zoom})`);
    if (c.pan > 0) hints.push(`camera pans right`);
    if (c.pan < 0) hints.push(`camera pans left`);
    if (c.tilt > 0) hints.push(`camera tilts up`);
    if (c.tilt < 0) hints.push(`camera tilts down`);
    if (c.horizontal) hints.push(c.horizontal > 0 ? 'camera orbits right' : 'camera orbits left');
    if (c.vertical > 0) hints.push('camera dollies forward');
    if (c.vertical < 0) hints.push('camera dollies backward');
    if (c.roll) hints.push(c.roll > 0 ? 'slight clockwise tilt' : 'slight counter-clockwise tilt');
  }
  return { type: 'structured', simple: sim, kling, prompt_hint: hints.join(', ') };
}

// ═══════════════════════════════════════════════
// Chroma Key 合成 — P1 视频背景
// ═══════════════════════════════════════════════

const BG_VIDEO_DIR = path.join(AVATAR_DIR, 'bg_videos');
if (!fs.existsSync(BG_VIDEO_DIR)) fs.mkdirSync(BG_VIDEO_DIR, { recursive: true });

/**
 * 把绿幕视频抠像后叠加到背景视频/图片上
 *
 * @param {string} foregroundVideo - 绿幕/蓝幕前景视频
 * @param {string} background - 背景视频 or 静态图路径（磁盘路径 or http URL）
 * @param {string} outputPath - 输出路径
 * @param {object} opts - { chromaColor:'0x00b140', similarity:0.15, blend:0.08, bgType:'video'|'image', targetSize:'1280x720' }
 */
async function _chromaKeyOverlay(foregroundVideo, background, outputPath, opts = {}) {
  const ffmpegStatic = require('ffmpeg-static');
  const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic;
  const { execSync } = require('child_process');

  const chromaColor = opts.chromaColor || '0x00b140'; // 标准绿幕
  const similarity = opts.similarity ?? 0.18;
  const blend = opts.blend ?? 0.08;
  const targetSize = opts.targetSize || '1280x720';
  const [w, h] = targetSize.split('x').map(Number);

  // 背景：如果是 http，先下载到本地
  let bgLocal = background;
  if (typeof background === 'string' && background.startsWith('http')) {
    const ext = background.split('?')[0].split('.').pop() || 'mp4';
    const fname = path.join(BG_VIDEO_DIR, `bg_${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`);
    const r = await axios.get(background, { responseType: 'arraybuffer', timeout: 120000 });
    fs.writeFileSync(fname, Buffer.from(r.data));
    bgLocal = fname;
  }
  if (!fs.existsSync(bgLocal)) throw new Error('背景文件不存在: ' + background);

  // 判断背景是否为视频（扩展名）
  const ext = path.extname(bgLocal).toLowerCase();
  const isBgVideo = ['.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(ext);

  // 构建 filter_complex
  // 1. scale bg to target
  // 2. chromakey fg
  // 3. overlay fg on bg
  let bgInputArgs;
  if (isBgVideo) {
    // 背景视频：循环到前景长度（-stream_loop）
    bgInputArgs = `-stream_loop -1 -i "${bgLocal}"`;
  } else {
    // 静态图：-loop 1 + -t 跟随前景
    bgInputArgs = `-loop 1 -i "${bgLocal}"`;
  }
  const filter =
    `[1:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1[bg];` +
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:-1:-1:color=${chromaColor},` +
    `chromakey=${chromaColor}:${similarity}:${blend},despill=type=green:mix=0.6[fg];` +
    `[bg][fg]overlay=shortest=1[v]`;

  // 保留前景音轨
  const cmd = `"${ffmpegPath}" -i "${foregroundVideo}" ${bgInputArgs} -filter_complex "${filter}" -map "[v]" -map 0:a? -c:v libx264 -preset fast -crf 22 -c:a aac -b:a 128k -pix_fmt yuv420p -shortest -movflags +faststart -y "${outputPath}"`;

  try {
    execSync(cmd, { timeout: 300000, stdio: 'pipe' });
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 5000) {
      console.log(`[Avatar] ChromaKey 合成完成: ${path.basename(outputPath)} (${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(1)}MB)`);
      return outputPath;
    }
    throw new Error('chromakey output too small');
  } catch (err) {
    console.warn(`[Avatar] ChromaKey 失败: ${err.message?.slice(0, 120)}`);
    throw err;
  }
}

/**
 * 情绪强度（0-1）→ prompt 关键词 & provider-specific 参数
 * 0.0-0.3: subtle, 0.3-0.6: moderate, 0.6-0.85: strong, 0.85-1.0: extreme
 */
function _emotionIntensityHint(emotion, intensity) {
  const i = Math.max(0, Math.min(1, intensity ?? 0.5));
  const EMOTION_WORDS = {
    neutral:   { low: 'slightly flat',      mid: 'natural',               high: 'pronounced composure',         extreme: 'stoic intensity' },
    happy:     { low: 'subtle smile',       mid: 'warm genuine smile',    high: 'big joyful smile',             extreme: 'radiant beaming grin' },
    serious:   { low: 'slightly focused',   mid: 'focused serious',       high: 'intense serious',              extreme: 'grave intense stare' },
    excited:   { low: 'mildly enthused',    mid: 'excited',               high: 'very excited and animated',    extreme: 'electrifying excited energy' },
    sad:       { low: 'slight melancholy',  mid: 'sad',                   high: 'visibly sad',                  extreme: 'deeply sorrowful' },
    surprised: { low: 'slightly surprised', mid: 'surprised',             high: 'visibly shocked',              extreme: 'mouth agape in astonishment' },
    confident: { low: 'calm confidence',    mid: 'confident',             high: 'strongly confident',           extreme: 'powerfully commanding' },
    warm:      { low: 'subtle warmth',      mid: 'warm friendly',         high: 'deeply warm',                  extreme: 'overflowing warmth' },
  };
  const band = i < 0.3 ? 'low' : i < 0.6 ? 'mid' : i < 0.85 ? 'high' : 'extreme';
  const map = EMOTION_WORDS[emotion] || EMOTION_WORDS.neutral;
  const word = map[band];
  // 强度数值也直接写入 prompt（某些模型会 attend 到数字）
  return `${word} expression (emotion intensity ${(i * 100).toFixed(0)}/100)`;
}

// ═══════════════════════════════════════════════
// 半身构图 + 多机位 — P0 数字人丝滑升级
// ═══════════════════════════════════════════════

const BODY_FRAMES = ['head_shoulders', 'half_body', 'full_body'];

function _bodyFramePromptHint(bodyFrame) {
  switch (bodyFrame) {
    case 'full_body':
      return 'full body shot, entire figure visible from head to feet, natural body posture, expressive hand and arm movements while speaking';
    case 'half_body':
      return 'half body medium shot visible from waist up, hands and forearms in frame, natural hand gestures while speaking, subtle shoulder and chest movement';
    case 'head_shoulders':
    default:
      return 'head and shoulders composition, talking head shot with confident direct eye contact';
  }
}

// ═══════════════════════════════════════════════
// 动作连贯性 — 口播场景只允许"讲话兼容"动作
// 反面清单：离画面 / 拿道具 / 走开 / 看别处 / 使用手机 / 撇嘴 等 → 会让段间跳戏
// 白名单：头部/手部微动 + 面部表情 + 身姿轻微调整
// ═══════════════════════════════════════════════
const SPEECH_COMPATIBLE_NEGATIVES = [
  'picking up an object', 'picks up', 'holding prop', 'reaching for',
  'turning away', 'walking', 'looking away', 'looking down at phone',
  'using phone', 'typing', 'eating', 'drinking',
  '拿起', '拿着道具', '转身离开', '走开', '低头看手机', '使用手机', '打字', '吃东西',
];
function _sanitizeSegmentAction(rawAction, idx, prevAction) {
  const a = String(rawAction || '').trim() || 'speaking naturally with subtle head movements';
  // 如果 action 含反面动作，降级成安全默认
  const lower = a.toLowerCase();
  for (const bad of SPEECH_COMPATIBLE_NEGATIVES) {
    if (lower.includes(bad.toLowerCase())) {
      return 'subtle natural gestures while speaking directly to camera, hands relaxed';
    }
  }
  // 正向白名单动作兜底修饰（确保总是"面对镜头说话"）
  return `${a}, while facing camera and speaking`;
}

// 段与段之间的姿态连贯性提示：从第二段起，都引用前一段的动作关键词，防止姿态跳变
function _continuityPromptHint(idx, prevAction) {
  if (idx === 0) return 'maintain stable posture, feet grounded, face centered to camera';
  const prev = String(prevAction || '').slice(0, 80);
  return `continuing smoothly from previous shot (previous: ${prev}), keep body posture / hand position / outfit / lighting consistent with prior segment, avoid abrupt reposition or wardrobe change`;
}

// 动作层面的通用 negative — 所有段 prompt 末尾统一追加
const ACTION_NEGATIVES_SUFFIX = 'NEGATIVE: sudden wardrobe change, sudden lighting change, sudden background change, different person, turning away from camera, looking away from camera, picking up random objects, walking off frame, disappearing, multi-person scene';

/**
 * 按 shot.camera 从 multiAngleImages 中选择最合适的参考图
 * @param {object} shot - { camera }
 * @param {object} multiAngleImages - { front_medium, side_45, front_closeup }
 * @param {string} fallback - 主 avatar URL 作为兜底
 */
function _pickAngleForShot(shot, multiAngleImages, fallback) {
  if (!multiAngleImages || typeof multiAngleImages !== 'object') return fallback;
  const cam = typeof shot?.camera === 'string' ? shot.camera : (shot?.camera?.simple || 'medium');
  const ANGLE_MAP = {
    close_up: 'front_closeup',
    zoom_in:  'front_closeup',
    pan_left: 'side_45',
    pan_right:'side_45',
    orbit:    'side_45',
    medium:   'front_medium',
    full:     'front_medium',
    zoom_out: 'front_medium',
    tilt_up:  'front_medium',
    tilt_down:'front_medium',
    push_in:  'front_closeup',
  };
  const key = ANGLE_MAP[cam] || 'front_medium';
  return multiAngleImages[key] || multiAngleImages.front_medium || fallback;
}

/**
 * 从一张源 avatar 生成 3 机位参考图（front_medium / side_45 / front_closeup）
 * 走 NanoBanana i2i，保脸。失败某个角度不阻塞其他，返回已生成的。
 *
 * @param {string} sourceImage - avatar 源图（http URL / data: / 本地路径）
 * @param {object} opts - { aspectRatio, bodyFrame, onProgress, taskDir, filenamePrefix }
 * @returns {Promise<{front_medium?: string, side_45?: string, front_closeup?: string, failed: string[]}>}
 *   value 是本地磁盘路径
 */
async function generateMultiAngleReferenceSet(sourceImage, opts = {}) {
  const { aspectRatio = '9:16', bodyFrame = 'half_body', onProgress, filenamePrefix = 'multi_angle' } = opts;
  const { generateDramaImage } = require('./imageService');
  const sharp = require('sharp');

  // 1. 统一拿到源图 Buffer
  let srcBuf;
  if (sourceImage.startsWith('http')) {
    const resp = await axios.get(sourceImage, { responseType: 'arraybuffer', timeout: 30000 });
    srcBuf = Buffer.from(resp.data);
  } else if (sourceImage.startsWith('data:')) {
    srcBuf = Buffer.from(sourceImage.replace(/^data:[^;]+;base64,/, ''), 'base64');
  } else if (sourceImage.startsWith('/api/')) {
    const localPath = sourceImage.includes('preset-img')
      ? path.join(OUTPUT_DIR, 'presets', path.basename(sourceImage))
      : path.join(AVATAR_DIR, path.basename(sourceImage));
    if (!fs.existsSync(localPath)) throw new Error('源图不存在: ' + sourceImage);
    srcBuf = fs.readFileSync(localPath);
  } else if (fs.existsSync(sourceImage)) {
    srcBuf = fs.readFileSync(sourceImage);
  } else {
    throw new Error('无效的源图路径: ' + sourceImage);
  }

  // 2. sharp 缩到 max 1024px + 转 JPEG 80%（降 payload 避免 NanoBanana 413）
  let refBase64;
  try {
    const resized = await sharp(srcBuf)
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    refBase64 = resized.toString('base64');
    console.log(`[multi-angle] 源图: ${(srcBuf.length / 1024).toFixed(0)}KB → resize ${(resized.length / 1024).toFixed(0)}KB`);
  } catch (resizeErr) {
    console.warn('[multi-angle] sharp resize 失败，用原图:', resizeErr.message);
    refBase64 = srcBuf.toString('base64');
  }

  const bodyZh = { full_body: '全身', half_body: '半身（腰部以上，含手部）', head_shoulders: '头肩' }[bodyFrame] || '半身';

  const angleConfigs = [
    {
      key: 'front_medium',
      prompt: `严格保留图中人物的脸型、五官、发型、肤色、服装完全不变，改为正对镜头的${bodyZh}中景站姿，自然站立，双手自然放松或轻微手势，柔和光线，干净简约背景，电影级写实摄影，8K`,
    },
    {
      key: 'side_45',
      prompt: `严格保留图中人物的脸型、五官、发型、肤色、服装完全不变，改为身体转向 45 度侧面的${bodyZh}姿态，眼神朝向镜头方向，自然转身动态，柔和光线，干净简约背景，电影级写实摄影，8K`,
    },
    {
      key: 'front_closeup',
      prompt: `严格保留图中人物的脸型、五官、发型、肤色完全不变，改为正对镜头的头肩近景特写，面部占画面 60% 以上，柔和正面自然光，虚化背景，浅景深人像摄影，电影级写实 8K`,
    },
  ];

  // 按 provider 优先级试（seedream 用户有 ark key 最稳；nanobanana 保脸最好但可能 402；mxapi gemini3pro 次；jimeng i2i 兜底但偶尔超时）
  const TRY_MODELS = ['seedream', 'nanobanana', 'mxapi', 'jimeng'];

  const out = { failed: [] };
  for (const angle of angleConfigs) {
    onProgress?.({ step: 'multi_angle', message: `生成 ${angle.key} 机位...`, angle: angle.key });
    let ok = false;
    const errs = [];
    for (const model of TRY_MODELS) {
      try {
        let filePath = null;
        if (model === 'seedream') {
          // 火山方舟 Seedream 5.0 i2i — 直接走 Ark /images/generations
          filePath = await _arkSeedreamGenerate({
            prompt: angle.prompt,
            referenceBase64: refBase64,
            aspectRatio,
            filename: `${filenamePrefix}_${angle.key}_${Date.now()}`,
          });
        } else {
          const r = await generateDramaImage({
            prompt: angle.prompt,
            filename: `${filenamePrefix}_${angle.key}_${Date.now()}`,
            aspectRatio,
            referenceImages: [refBase64],
            image_model: model,
          });
          filePath = (r?.filePath && fs.existsSync(r.filePath)) ? r.filePath : null;
        }
        if (filePath && fs.existsSync(filePath)) {
          out[angle.key] = filePath;
          console.log(`[multi-angle] ${angle.key} ← ${model}`);
          ok = true;
          break;
        }
      } catch (err) {
        errs.push(`${model}: ${err.message.slice(0, 80)}`);
        console.warn(`[multi-angle] ${angle.key} ${model} 失败:`, err.message.slice(0, 120));
      }
    }
    if (!ok) {
      out.failed.push(angle.key);
      console.warn(`[multi-angle] ${angle.key} 全部失败: ${errs.join(' | ')}`);
    }
  }
  return out;
}

/**
 * 把半身/头肩照扩成全身照（i2i outpainting）
 * —— 专门给即梦 Omni 用：Omni 不会扩图，输入什么构图输出就什么构图。
 *    用户选 bodyFrame='full_body' 但 avatar 是头肩/半身照时，会看到"没有腿"的成片。
 *    这里用 Seedream/NanoBanana i2i 把人物扩成全身站立照，保持脸型/发型/服装不变。
 *
 * @param {string} sourceImage - avatar 源图（http URL / data: / 本地路径）
 * @param {object} opts - { aspectRatio?, filenamePrefix? }
 * @returns {Promise<string>} 本地磁盘路径（全身照 png）
 */
async function generateFullBodyOutpaint(sourceImage, opts = {}) {
  const { aspectRatio = '9:16', filenamePrefix = 'fullbody' } = opts;
  const { generateDramaImage } = require('./imageService');
  const sharp = require('sharp');

  // 1. 拿源图 buffer
  let srcBuf;
  if (sourceImage.startsWith('http')) {
    const resp = await axios.get(sourceImage, { responseType: 'arraybuffer', timeout: 30000 });
    srcBuf = Buffer.from(resp.data);
  } else if (sourceImage.startsWith('data:')) {
    srcBuf = Buffer.from(sourceImage.replace(/^data:[^;]+;base64,/, ''), 'base64');
  } else if (sourceImage.startsWith('/api/')) {
    const localPath = sourceImage.includes('preset-img')
      ? path.join(OUTPUT_DIR, 'presets', path.basename(sourceImage))
      : path.join(AVATAR_DIR, path.basename(sourceImage));
    if (!fs.existsSync(localPath)) throw new Error('源图不存在: ' + sourceImage);
    srcBuf = fs.readFileSync(localPath);
  } else if (fs.existsSync(sourceImage)) {
    srcBuf = fs.readFileSync(sourceImage);
  } else {
    throw new Error('无效的源图路径: ' + sourceImage);
  }

  // 2. 缩到 1024 + jpeg 85%
  let refBase64;
  try {
    const resized = await sharp(srcBuf)
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    refBase64 = resized.toString('base64');
  } catch {
    refBase64 = srcBuf.toString('base64');
  }

  const prompt = '严格保留图中人物的脸型、五官、发型、肤色、年龄、性别、服装款式与颜色完全不变，只把画面扩展为人物的全身站立照（从头部到脚部完整入镜），自然站姿双脚着地，双手自然下垂或轻微手势，服装延伸到下半身（如商务女性延伸为西装长裤/半身裙+高跟鞋，男性延伸为西裤+皮鞋，休闲风格延伸为牛仔/运动裤+运动鞋），原始背景如果是纯色/影棚延续同样的背景，如果是复杂场景则保持同类型场景延伸到地面，柔和影棚光或原图光线方向一致，电影级写实摄影，8K, DSLR photograph, preserve exact facial identity, do not change face, 保留完整的头部，不要遮挡，full body standing shot from head to feet with feet on the ground';

  const filename = `${filenamePrefix}_${Date.now()}`;

  // 优先 seedream（Ark key 最稳定），再 nanobanana，兜底 jimeng
  const TRY_MODELS = ['seedream', 'nanobanana', 'jimeng'];
  const errs = [];
  for (const model of TRY_MODELS) {
    try {
      let filePath = null;
      if (model === 'seedream') {
        filePath = await _arkSeedreamGenerate({ prompt, referenceBase64: refBase64, aspectRatio, filename });
      } else {
        const r = await generateDramaImage({
          prompt, filename, aspectRatio, referenceImages: [refBase64], image_model: model,
        });
        filePath = (r?.filePath && fs.existsSync(r.filePath)) ? r.filePath : null;
      }
      if (filePath && fs.existsSync(filePath)) {
        console.log(`[fullbody-outpaint] OK via ${model} → ${filePath}`);
        return filePath;
      }
    } catch (err) {
      errs.push(`${model}: ${err.message.slice(0, 80)}`);
      console.warn(`[fullbody-outpaint] ${model} 失败:`, err.message.slice(0, 120));
    }
  }
  throw new Error('全身扩图失败: ' + errs.join(' | '));
}

/**
 * 火山方舟 Seedream 5.0 图像生成（支持 i2i 参考图）
 * 直连 Ark /api/v3/images/generations 端点（OpenAI 兼容）
 *
 * @param {object} opts - { prompt, referenceBase64?, aspectRatio, filename }
 * @returns {Promise<string>} 本地磁盘路径
 */
async function _arkSeedreamGenerate({ prompt, referenceBase64, aspectRatio = '9:16', filename, watermark = false, cropBottomPx = 100, destDir: customDestDir }) {
  const _trackerStartedAt = Date.now();
  let _trackerModel = 'doubao-seedream-5-0-260128';
  let _trackerStatus = 'success', _trackerErr = null;
  const apiKey = getArkKey();
  if (!apiKey) throw new Error('未配置火山方舟 Ark Key');

  const settings = loadSettings();
  const arkProvider = (settings.providers || []).find(p => /volces/i.test(p.api_url || '') || /火山方舟/.test(p.name || ''));
  const seedreamModels = (arkProvider?.models || [])
    .filter(m => /seedream/i.test(m.id || '') && m.enabled !== false)
    .sort((a, b) => (b.id || '').localeCompare(a.id || ''));
  const modelId = seedreamModels[0]?.id || 'doubao-seedream-5-0-260128';

  // Ark Seedream 5.0 要求 image size >= 3,686,400 像素
  const sizeMap = { '9:16': '1536x2688', '16:9': '2688x1536', '1:1': '1920x1920', '4:3': '2208x1656', '3:4': '1656x2208' };
  const size = sizeMap[aspectRatio] || '1536x2688';

  const body = {
    model: modelId,
    prompt: prompt.slice(0, 2000),
    size,
    response_format: 'url',
    n: 1,
    watermark,
  };
  if (referenceBase64) {
    body.image = `data:image/jpeg;base64,${referenceBase64}`;
  }

  console.log(`[Ark/Seedream] model=${modelId} size=${size} ref=${!!referenceBase64} wm=${watermark} crop=${cropBottomPx}`);
  const resp = await axios.post(
    `${ARK_API_BASE}/images/generations`,
    body,
    { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 120000 }
  );
  const imgUrl = resp.data?.data?.[0]?.url || resp.data?.data?.[0]?.b64_json;
  if (!imgUrl) throw new Error('Seedream 无 URL 返回: ' + JSON.stringify(resp.data).slice(0, 200));

  const destDir = customDestDir || path.join(AVATAR_DIR, 'multi_angle_out');
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, `${filename}.png`);

  // 下载原图到 buffer
  let rawBuf;
  if (imgUrl.startsWith('http')) {
    const dlResp = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 60000 });
    rawBuf = Buffer.from(dlResp.data);
  } else {
    rawBuf = Buffer.from(imgUrl, 'base64');
  }

  // 后处理裁剪底部（即使 watermark=false，某些模型仍可能嵌入不可见元素，cropBottomPx=0 跳过）
  if (cropBottomPx > 0) {
    try {
      const sharp = require('sharp');
      const meta = await sharp(rawBuf).metadata();
      await sharp(rawBuf)
        .extract({ left: 0, top: 0, width: meta.width, height: Math.max(1, meta.height - cropBottomPx) })
        .png()
        .toFile(destPath);
    } catch (e) {
      console.warn(`[Ark/Seedream] 裁底失败，写入原图: ${e.message}`);
      fs.writeFileSync(destPath, rawBuf);
    }
  } else {
    fs.writeFileSync(destPath, rawBuf);
  }

  console.log(`[Ark/Seedream] 完成 → ${destPath} (${(fs.statSync(destPath).size/1024).toFixed(0)}KB)`);
  // 埋点：Seedream 按张计费
  try {
    require('./tokenTracker').record({
      provider: 'volcengine', model: _trackerModel, category: 'image', imageCount: 1,
      durationMs: Date.now() - _trackerStartedAt, status: _trackerStatus, errorMsg: _trackerErr,
    });
  } catch {}
  return destPath;
}

function getHedraKey() {
  const settings = loadSettings();
  for (const p of (settings.providers || [])) {
    if ((p.id === 'hedra' || p.preset === 'hedra') && p.api_key) return p.api_key;
  }
  return process.env.HEDRA_API_KEY || null;
}

/**
 * Hedra Character-3 — audio-driven lip-sync
 * 输入：人像图片 + 已合成的 TTS 音频文件
 * 输出：精确对口型的视频（自带音轨，无需后期合成）
 */
async function _hedraGenerateVideo(imgParam, audioPath, model, apiKey, aspectRatio = '9:16', onProgress, userId = null, agentId = null) {
  const FormData = require('form-data');
  const _started = Date.now();
  let _ok = false; let _err = null; let _videoSeconds = 0; let _genId = null;
  const _trackerModel = model === 'hedra-character-2' ? 'character-2' : 'character-3';

  // 用闭包 try/finally 包住整个流程
  let _result = null;
  try {

  // 1. 上传 image 资产
  onProgress?.({ step: 'video', message: 'Hedra 上传头像…' });
  let imageBuffer;
  if (typeof imgParam === 'string' && imgParam.startsWith('data:')) {
    imageBuffer = Buffer.from(imgParam.replace(/^data:[^;]+;base64,/, ''), 'base64');
  } else if (typeof imgParam === 'string' && imgParam.startsWith('http')) {
    const r = await axios.get(imgParam, { responseType: 'arraybuffer', timeout: 30000 });
    imageBuffer = Buffer.from(r.data);
  } else if (fs.existsSync(imgParam)) {
    imageBuffer = fs.readFileSync(imgParam);
  } else {
    throw new Error('Hedra: 无法读取头像');
  }
  const imgForm = new FormData();
  imgForm.append('file', imageBuffer, { filename: 'avatar.png', contentType: 'image/png' });
  imgForm.append('type', 'image');
  const imgUploadRes = await axios.post(`${HEDRA_API_BASE}/assets`, imgForm, {
    headers: { ...imgForm.getHeaders(), 'X-API-KEY': apiKey },
    timeout: 60000,
    maxBodyLength: Infinity,
  });
  const imageAssetId = imgUploadRes.data?.id || imgUploadRes.data?.asset?.id;
  if (!imageAssetId) throw new Error('Hedra 头像上传失败: ' + JSON.stringify(imgUploadRes.data).slice(0, 200));

  // 2. 上传 audio 资产
  onProgress?.({ step: 'video', message: 'Hedra 上传语音…' });
  const audioBuffer = fs.readFileSync(audioPath);
  const audioForm = new FormData();
  audioForm.append('file', audioBuffer, { filename: 'voice.mp3', contentType: 'audio/mpeg' });
  audioForm.append('type', 'audio');
  const audioUploadRes = await axios.post(`${HEDRA_API_BASE}/assets`, audioForm, {
    headers: { ...audioForm.getHeaders(), 'X-API-KEY': apiKey },
    timeout: 120000,
    maxBodyLength: Infinity,
  });
  const audioAssetId = audioUploadRes.data?.id || audioUploadRes.data?.asset?.id;
  if (!audioAssetId) throw new Error('Hedra 语音上传失败: ' + JSON.stringify(audioUploadRes.data).slice(0, 200));

  // 3. 创建生成任务
  onProgress?.({ step: 'video', message: 'Hedra 正在精确对口型生成…（约 1-2 分钟）' });
  const sizeMap = { '9:16': '9:16', '16:9': '16:9', '1:1': '1:1' };
  const genRes = await axios.post(`${HEDRA_API_BASE}/generations`, {
    type: 'video',
    ai_model_id: model === 'hedra-character-2' ? 'character-2' : 'character-3',
    start_keyframe_id: imageAssetId,
    audio_id: audioAssetId,
    aspect_ratio: sizeMap[aspectRatio] || '9:16',
    resolution: '720p',
  }, {
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    timeout: 60000,
  });
  _genId = genRes.data?.id || genRes.data?.generation_id;
  if (!_genId) throw new Error('Hedra 提交失败: ' + JSON.stringify(genRes.data).slice(0, 200));

  // 4. 轮询
  let videoUrl = null;
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 4000));
    onProgress?.({ step: 'video', message: `Hedra 生成中…(${(i+1)*4}秒)` });
    try {
      const pr = await axios.get(`${HEDRA_API_BASE}/generations/${_genId}/status`, {
        headers: { 'X-API-KEY': apiKey }, timeout: 15000,
      });
      const st = pr.data?.status;
      if (st === 'complete' || st === 'COMPLETE' || st === 'succeeded') {
        videoUrl = pr.data?.url || pr.data?.video_url || pr.data?.asset?.url;
        break;
      }
      if (st === 'error' || st === 'failed' || st === 'FAILED') {
        throw new Error('Hedra 生成失败: ' + (pr.data?.error_message || pr.data?.message || 'unknown'));
      }
    } catch (e) {
      if (e.message.startsWith('Hedra 生成失败')) throw e;
    }
  }
  if (!videoUrl) throw new Error('Hedra 轮询超时（6 分钟）');

  // 5. 下载
  const videoResp = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 120000 });
  _result = Buffer.from(videoResp.data); // 返回 buffer，含音轨

  // 探测视频时长（用于按秒计费）
  try {
    const tmp = require('path').join(require('os').tmpdir(), `hedra_${Date.now()}.mp4`);
    require('fs').writeFileSync(tmp, _result);
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
    try { const fps = require('ffprobe-static'); ffmpeg.setFfprobePath(fps.path); } catch {}
    _videoSeconds = await new Promise((res) => {
      ffmpeg.ffprobe(tmp, (e, m) => res(Number(m?.format?.duration) || 0));
    });
    try { require('fs').unlinkSync(tmp); } catch {}
  } catch {}
  if (!_videoSeconds) _videoSeconds = 8; // 兜底：Hedra 短视频通常 5-15s
  _ok = true;
  return _result;

  } catch (e) { _err = e.message; throw e; }
  finally {
    try {
      require('./tokenTracker').record({
        provider: 'hedra', model: _trackerModel,
        category: 'video', videoSeconds: _videoSeconds,
        durationMs: Date.now() - _started,
        status: _ok ? 'success' : 'fail', errorMsg: _err,
        userId, agentId, requestId: _genId,
      });
    } catch {}
  }
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

// 火山方舟 Ark API Key（Seedance / Seedream / 豆包 LLM 共用）
// 按 name 含"火山方舟"或 api_url 含 volces 匹配
function getArkKey() {
  const settings = loadSettings();
  for (const p of (settings.providers || [])) {
    if (!p.enabled || !p.api_key) continue;
    if (/volces/i.test(p.api_url || '')) return p.api_key;
    if (/火山方舟|seedance|^ark$/i.test(p.name || p.id || '')) return p.api_key;
  }
  return process.env.VOLCENGINE_ARK_KEY || process.env.ARK_API_KEY || '';
}

/**
 * Seedance 1.5 Pro / 2.0 的音视频生成路径（火山方舟 Ark /contents/generations/tasks）
 * 输入：image + text prompt
 * 输出：video（1.5-pro 会自动生成匹配的音频 + 对口型；2.0 支持多模态编辑）
 *
 * @param {string} imgParam - 图片 URL / data URI / base64（有 data: 前缀）
 * @param {string} prompt - 完整 prompt（含台词 + 情绪 + 镜头 + 身位）
 * @param {string} model - 模型 id
 * @param {string} apiKey - Ark API Key
 * @param {Function} onProgress
 * @param {object} opts - { ratio, duration, hasAudio: boolean }
 * @returns {Promise<{videoBuffer: Buffer, audioEmbedded: boolean, videoUrl: string}>}
 */
async function _seedanceAVGenerate(imgParam, prompt, model, apiKey, onProgress, opts = {}) {
  const ratio = opts.ratio || '9:16';
  const duration = Math.min(Math.max(opts.duration || 5, 3), 10);
  // hasAudio：1.5-pro/2.0 支持音频同步输出
  const hasAudio = opts.hasAudio ?? isSeedanceAVModel(model);

  const _started = Date.now();
  let _ok = false; let _err = null; let _seedTaskId = null;

  // Ark 的 content 参数格式（OpenAI 风格 + Ark 扩展）
  // 参数通过 prompt 末尾 --flag value 形式传递（官方推荐写法）
  const promptWithFlags = `${prompt} --resolution 720p --ratio ${ratio} --duration ${duration}${hasAudio ? ' --cameramove false' : ''}`;
  try {

  // Ark image 接受 URL / data URI / base64
  const imageUrl = imgParam;

  onProgress?.({ step: 'seedance', message: '提交 Seedance 任务...' });

  let createResp;
  for (let retry = 0; retry < 3; retry++) {
    try {
      createResp = await axios.post(
        `${ARK_API_BASE}/contents/generations/tasks`,
        {
          model,
          content: [
            { type: 'text', text: promptWithFlags },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
        {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 60000,
        }
      );
      break;
    } catch (apiErr) {
      const detail = apiErr.response?.data?.error?.message || apiErr.response?.data?.message || apiErr.message;
      const status = apiErr.response?.status;
      const isNetErr = !apiErr.response && /ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket|TLS/i.test(apiErr.message);
      const isRateLimit = status === 429 || /rate.?limit|too many|访问量过大/i.test(detail || '');
      if ((isNetErr || isRateLimit) && retry < 2) {
        const wait = isRateLimit ? 30 : 8 * (retry + 1);
        console.warn(`[Seedance] ${isRateLimit ? '限流' : '网络'}，${wait}s 重试 ${retry + 1}/3: ${detail}`);
        await new Promise(r => setTimeout(r, wait * 1000));
        continue;
      }
      console.error('[Seedance] 创建任务失败:', status, detail);
      throw new Error(`Seedance 创建任务失败 (${status || 'net'}): ${detail}`);
    }
  }

  _seedTaskId = createResp.data?.id;
  if (!_seedTaskId) throw new Error('Seedance 返回异常: ' + JSON.stringify(createResp.data).slice(0, 200));
  console.log(`[Seedance] 任务创建: id=${_seedTaskId}, model=${model}, hasAudio=${hasAudio}`);

  // 轮询（最多 8 分钟）
  let videoUrl = null;
  for (let i = 0; i < 96; i++) {
    await new Promise(r => setTimeout(r, 5000));
    if (i % 4 === 0) onProgress?.({ step: 'seedance', message: `Seedance 生成中... (${(i + 1) * 5}秒)` });
    try {
      const statusResp = await axios.get(
        `${ARK_API_BASE}/contents/generations/tasks/${_seedTaskId}`,
        { headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 15000 }
      );
      const st = statusResp.data?.status;
      if (st === 'succeeded') {
        videoUrl = statusResp.data?.content?.video_url;
        if (!videoUrl) throw new Error('Seedance 成功但无 video_url: ' + JSON.stringify(statusResp.data).slice(0, 200));
        console.log(`[Seedance] 完成: ${videoUrl.slice(0, 80)}...`);
        break;
      } else if (st === 'failed' || st === 'cancelled') {
        const err = statusResp.data?.error || statusResp.data?.message || st;
        throw new Error(`Seedance 生成失败: ${JSON.stringify(err).slice(0, 300)}`);
      }
      // 'queued' / 'running' → 继续轮询
    } catch (pollErr) {
      if (pollErr.message.includes('生成失败') || pollErr.message.includes('无 video_url')) throw pollErr;
      // 网络抖动 → 继续
    }
  }
  if (!videoUrl) throw new Error('Seedance 生成超时（>8 分钟）');

  onProgress?.({ step: 'seedance', message: '下载 Seedance 视频...' });
  const videoResp = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 180000 });
  _ok = true;
  return { videoBuffer: Buffer.from(videoResp.data), audioEmbedded: hasAudio, videoUrl };

  } catch (e) { _err = e.message; throw e; }
  finally {
    try {
      require('./tokenTracker').record({
        provider: 'volcengine', model,
        category: 'video', videoSeconds: duration,
        durationMs: Date.now() - _started,
        status: _ok ? 'success' : 'fail', errorMsg: _err,
        userId: opts.userId, agentId: opts.agentId, requestId: _seedTaskId,
      });
    } catch {}
  }
}

// 返回 {key, host, useAggregator}：优先漫路（deyunai）聚合平台，回退官方 Kling
// 注意：Kling API 路径本身含 /v1/videos/image2video，所以 pathPrefix 必须是空
// 即使 api_url 末尾带 /v1，我们也只取 hostname 丢掉路径（Kling 路径硬编码）
function getKlingRoute() {
  const settings = loadSettings();
  // 漫路：只要配了 key 且没勾掉 kling 模型就走它
  const deyunai = (settings.providers || []).find(p => (p.id === 'deyunai' || p.preset === 'deyunai') && p.enabled && p.api_key);
  if (deyunai) {
    const hasKling = (deyunai.models || []).some(m => /^kling[-/]/i.test(m.id || '') && m.enabled !== false);
    if (hasKling) {
      const url = new URL(deyunai.api_url || 'https://api.deyunai.com/v1');
      return { key: deyunai.api_key, host: url.hostname, pathPrefix: '', useAggregator: true };
    }
  }
  // 回退官方
  const key = getKlingKey();
  if (key) return { key, host: KLING_API_HOST, pathPrefix: '', useAggregator: false };
  return null;
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
// Kling camera_control 支持的模型白名单（严格按 Kling API 文档实测）
// 仅 kling-v1-5 + pro mode + 5s duration 支持 camera_control
// 其他模型（v1-6/v2/v2.5-turbo/v3）一律不支持 → API 会直接 400
const KLING_CAMERA_SUPPORTED = new Set(['kling-v1-5-pro']);

async function _klingGenerateVideo(imgParam, prompt, model, rawKey, onProgress, cameraControl = null, aspectRatio = '9:16', route = null) {
  // route: { key, host, pathPrefix, useAggregator } — 若不传则按传入 rawKey 走官方
  const klingRoute = route || (rawKey?.includes(':') ? { key: rawKey, host: KLING_API_HOST, pathPrefix: '', useAggregator: false } : { key: rawKey, host: 'api.deyunai.com', pathPrefix: '/v1', useAggregator: true });
  const apiHost = klingRoute.host;
  const apiPrefix = klingRoute.pathPrefix || '';
  const useAggregator = klingRoute.useAggregator;
  // 漫路用 Bearer token；官方用 JWT(AK/SK) 签名
  const authToken = useAggregator ? klingRoute.key : (klingRoute.key.includes(':') ? _createKlingToken(...klingRoute.key.split(':')) : klingRoute.key);
  const isV3 = model === 'kling-v3';
  // 如果模型不在白名单 → 不发 camera_control（否则 API 直接 400）
  const canUseCameraControl = KLING_CAMERA_SUPPORTED.has(model);
  if (cameraControl && !canUseCameraControl) {
    console.log(`[Avatar] Kling ${model} 不支持 camera_control，已自动剥离（运镜改走 prompt）`);
    cameraControl = null;
  }

  // Kling API 严格要求：image 字段是「公网 URL」或「纯 base64（无 data: 前缀）」
  // 否则会报: "File is not in a valid base64 format"
  let klingImage = imgParam;
  if (imgParam.startsWith('data:')) {
    klingImage = imgParam.replace(/^data:[^;]+;base64,/, '');
  }

  // Kling 模型名映射（2026-04 实测确认）
  // API 实际接受: kling-v1 / kling-v1-5 / kling-v1-6 / kling-v2-master / kling-v2-1-master
  // 不接受: kling-v2 / kling-v2-1（必须带 -master 后缀）
  const klingModelMap = {
    'kling-v3':              'kling-v2-1-master',  // V3 用 V2.1 旗舰
    'kling-v2.5-turbo-pro':  'kling-v2-master',    // V2.5 turbo 用 V2 master
    'kling-v2-master':       'kling-v2-master',
    'kling-v1-6':            'kling-v1-6',
    'kling-v1-5-pro':        'kling-v1-5',         // v1-5 必须 pro mode
    'kling-v1':              'kling-v1',
  };
  const apiModelName = klingModelMap[model] || model;
  const requiresPro = model === 'kling-v1-5-pro' || apiModelName === 'kling-v1-5'
    || model === 'kling-v3' || model === 'kling-v2.5-turbo-pro' || model === 'kling-v2-master';

  const bodyObj = {
    model_name: apiModelName,
    prompt: prompt.substring(0, isV3 ? 4000 : 2500),
    image: klingImage,
    cfg_scale: 0.5,
    mode: requiresPro ? 'pro' : 'std',
    aspect_ratio: aspectRatio,
    duration: '5'
  };
  // 结构化运镜 — Kling 官方 camera_control（v1-6 / v2-master / v2-1-master 均支持）
  if (cameraControl && cameraControl.type) {
    bodyObj.camera_control = {
      type: cameraControl.type, // simple|zoom|pan|tilt|horizontal|vertical|roll
      config: cameraControl.config || {},
    };
  }
  console.log(`[Avatar] Kling I2V 请求: model=${model}→${apiModelName}, prompt长度=${prompt.length}, 图片格式=${imgParam.startsWith('http') ? 'URL' : 'base64'}${cameraControl?.type ? ', camera='+cameraControl.type : ''}`);

  // 提交任务（漫路/官方共用同一套 Kling 原生协议）
  function _klingRequest(method, kPath, body) {
    const fullPath = apiPrefix + kPath;
    const bodyStr = body ? JSON.stringify(body) : '';
    return new Promise((resolve, reject) => {
      const headers = { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' };
      if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr); // 显式 CL，避免 chunked 被网关丢弃
      const opts = { hostname: apiHost, path: fullPath, method, headers };
      const req = https.request(opts, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          try { resolve(JSON.parse(raw)); }
          catch (e) {
            console.warn(`[Kling] 响应非 JSON（状态 ${res.statusCode}）: ${raw.slice(0, 300)}`);
            reject(new Error('Kling 响应解析失败: ' + raw.slice(0, 200)));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(60000, () => { req.destroy(); reject(new Error('Kling 请求超时')); });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  let task;
  for (let retry = 0; retry < 3; retry++) {
    try {
      const result = await _klingRequest('POST', '/v1/videos/image2video', bodyObj);
      if (result.code !== 0) throw new Error('Kling: ' + (result.message || JSON.stringify(result)));
      task = result.data;
      if (!task?.task_id) {
        console.warn('[Kling] 响应缺 task_id:', JSON.stringify(result).slice(0, 300));
        throw new Error('Kling: 响应无 task_id - ' + JSON.stringify(result).slice(0, 200));
      }
      break;
    } catch (e) {
      // camera_control 不被支持时 → 剥离后重试（兜底）
      if (bodyObj.camera_control && /camera.{0,10}control.*not.{0,10}support/i.test(e.message)) {
        console.warn(`[Avatar] Kling ${model} 拒绝 camera_control，剥离后自动重试`);
        onProgress?.({ step: 'video', message: '运镜参数降级，重试中...' });
        delete bodyObj.camera_control;
        continue;
      }
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
async function _minimaxGenerateVideo(imgParam, prompt, model, apiKey, onProgress, opts = {}) {
  const _started = Date.now();
  let _ok = false; let _err = null; let _taskIdMM = null;
  // 1. 创建任务
  const reqBody = {
    model,
    first_frame_image: imgParam,
    prompt: prompt.substring(0, 2000),
    prompt_optimizer: true
  };
  console.log(`[Avatar] MiniMax I2V 请求: model=${model}, prompt长度=${prompt.length}`);
  try {

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

  _taskIdMM = createRes.data?.task_id;
  const respCode = createRes.data?.base_resp?.status_code;
  if (respCode !== 0 || !_taskIdMM) {
    throw new Error(`MiniMax 创建任务失败: ${createRes.data?.base_resp?.status_msg || JSON.stringify(createRes.data)}`);
  }
  console.log(`[Avatar] MiniMax 任务已创建: ${_taskIdMM}`);

  // 2. 轮询等待结果
  let fileId = null;
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    onProgress?.({ step: 'video', message: `MiniMax 生成中... (${(i + 1) * 5}秒)` });

    try {
      const pollRes = await axios.get(`${MINIMAX_API_BASE}/query/video_generation`, {
        params: { task_id: _taskIdMM },
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
  _ok = true;
  return fileResp.data; // Buffer

  } catch (e) { _err = e.message; throw e; }
  finally {
    try {
      // MiniMax 短视频通常 6 秒；如能 probe 真实时长更好（这里取 6 兜底）
      const _videoSeconds = 6;
      require('./tokenTracker').record({
        provider: 'minimax', model,
        category: 'video', videoSeconds: _videoSeconds,
        durationMs: Date.now() - _started,
        status: _ok ? 'success' : 'fail', errorMsg: _err,
        userId: opts.userId, agentId: opts.agentId, requestId: _taskIdMM,
      });
    } catch {}
  }
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
  const {
    imageUrl, text, voiceId, speed = 1.0, ratio = '9:16',
    model = 'cogvideox-flash', expression = 'natural', background = 'office',
    onProgress, bgm, voiceVolume = 1.0, bgmVolume = 0.15,
    camera,                 // string or {type,config,simple} — 结构化运镜
    emotion = 'neutral',    // 情绪标签
    emotion_intensity = 0.5,// 情绪强度 0-1
    backgroundVideo,        // URL or 本地路径 — 视频背景（需要绿幕模式）
    customPromptSuffix = '',// 用户在 UI 中追加的 prompt 片段
    bodyFrame = 'head_shoulders', // P0: head_shoulders / half_body / full_body
    promptOverride = '',    // 用户在前端编辑过的最终 prompt（优先用这个，跳过自动组装）
  } = params;
  const taskId = uuidv4();
  const taskDir = path.join(AVATAR_DIR, taskId);
  fs.mkdirSync(taskDir, { recursive: true });

  const useMiniMax = isMiniMaxModel(model);
  const useKling = isKlingModel(model);
  const useHedra = isHedraModel(model);
  const useSeedance = isSeedanceModel(model);
  const klingRoute = useKling ? getKlingRoute() : null;
  const apiKey = useHedra ? getHedraKey()
    : useSeedance ? getArkKey()
    : useKling ? (klingRoute?.key || null)
    : (useMiniMax ? getMiniMaxKey() : getZhipuKey());
  if (!apiKey) throw new Error(
    useHedra ? '未配置 Hedra API Key，请在设置中添加 hedra 供应商'
    : useSeedance ? '未配置火山方舟 Ark API Key，请在设置中添加火山方舟供应商'
    : useKling ? '未配置 Kling AI Key（或漫路 deyunai key），请在 AI 配置中添加'
    : (useMiniMax ? '未配置 MiniMax API Key' : '未配置智谱 AI API Key')
  );
  if (useKling && klingRoute?.useAggregator) console.log('[Avatar] Kling 走漫路聚合平台 (api.deyunai.com)');

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
    natural: 'natural and relaxed facial expression, subtle micro-expressions',
    smile: 'warm genuine smiling expression with slight eye squint',
    serious: 'serious and focused expression with intent gaze',
    excited: 'excited energetic expression with bright eyes and animated gestures',
    calm: 'calm composed expression with serene confidence',
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

  // 增强 prompt: 加入自然动态描述，减少僵硬感
  const motionEnhance = 'gentle breathing motion visible in shoulders, natural subtle weight shifts, occasional slight head tilts, realistic eye blinks every 3-4 seconds, smooth fluid body language, lifelike micro-movements';

  // 结构化运镜归一化 + prompt 运镜提示
  const normalizedCam = normalizeCamera(camera);
  const camHint = normalizedCam.prompt_hint ? `, ${normalizedCam.prompt_hint}` : '';
  // 情绪强度真传（覆盖简单 expression）
  const emotionDesc = _emotionIntensityHint(emotion || expression || 'neutral', emotion_intensity);
  // P0: 身位构图
  const bodyHint = _bodyFramePromptHint(bodyFrame);

  const suffixStr = customPromptSuffix && customPromptSuffix.trim() ? `. ${customPromptSuffix.trim()}` : '';
  // 用户在前端编辑过完整 prompt → 直接用，跳过自动组装
  const prompt = (promptOverride && promptOverride.trim())
    ? promptOverride.trim()
    : (text
      ? `The person in the image is speaking directly to the camera with confident eye contact ${bgDesc ? bgDesc + ', ' : ''}with ${emotionDesc}. ${bodyHint}. ${motionEnhance}${camHint}. They say: "${text.slice(0, 100)}"${suffixStr}. Realistic lip sync, natural hand gestures while talking, cinematic smooth motion, 24fps film quality.`
      : `The person in the image is looking at the camera with confident eye contact ${bgDesc ? bgDesc + ', ' : ''}with ${emotionDesc}. ${bodyHint}. ${motionEnhance}${camHint}${suffixStr}. Professional demeanor, cinematic smooth motion, 24fps film quality.`);
  if (promptOverride) console.log(`[Avatar] 使用用户编辑的 prompt (${promptOverride.length} 字符)`);

  // 2.5 如果选择了背景（非绿幕/自定义），用 i2i（NanoBanana 优先）把 avatar 做参考图合成到背景中
  // 这样能保留用户的真实人脸，而不是 CogView 纯文生图生成一张通用脸
  if (background && background !== 'green' && background !== 'custom') {
    const bgPromptMap = {
      office: '现代高端办公室，落地窗城市夜景，暖色办公灯光',
      studio: '专业电视演播室，蓝紫色霓虹灯光，弧形 LED 屏幕',
      classroom: '明亮的现代教室，白板和书架，自然阳光',
      outdoor: '美丽的户外樱花园林，金色阳光，浅景深虚化',
    };
    const bgPrompt = bgPromptMap[background] || bgPromptMap.office;
    onProgress?.({ step: 'start', message: '把头像融合进场景背景…' });
    try {
      const { generateDramaImage } = require('./imageService');
      // 参考图传 avatar（NanoBanana 支持 base64 不带 data: 前缀）
      const refImg = (typeof imgParam === 'string' && imgParam.startsWith('data:'))
        ? imgParam.replace(/^data:[^;]+;base64,/, '')
        : imgParam;
      const compositePrompt = `严格保留图中人物的脸型、五官、发型、服装完全不变，只把背景替换为：${bgPrompt}。自然融合的光影方向与色温，接地阴影，浅景深虚化背景，电影级写实摄影，8K`;
      const compResult = await generateDramaImage({
        prompt: compositePrompt,
        filename: `avatar_composite_${taskId}`,
        aspectRatio: ratio,
        referenceImages: [refImg],
        image_model: 'nanobanana',  // 优先 NanoBanana i2i，失败自动 fallback（mxapi / zhipu / jimeng）
      });
      if (compResult?.filePath && fs.existsSync(compResult.filePath)) {
        const compBuf = fs.readFileSync(compResult.filePath);
        const compPath = path.join(taskDir, 'avatar_with_bg.png');
        fs.writeFileSync(compPath, compBuf);
        imgParam = `data:image/png;base64,${compBuf.toString('base64')}`;
        console.log(`[Avatar] i2i 场景融合完成 (${(compBuf.length/1024).toFixed(0)}KB, provider=${compResult.provider_used || 'nanobanana'})`);
      }
    } catch (compErr) {
      console.warn('[Avatar] i2i 合成失败，使用原始头像（直接在 I2V prompt 里描述背景）:', compErr.message?.slice(0, 120));
    }
  }

  const providerName = useHedra ? 'Hedra' : useSeedance ? 'Seedance' : useKling ? 'Kling' : (useMiniMax ? 'MiniMax' : '智谱');
  onProgress?.({ step: 'video', message: `${providerName} 正在生成动画视频（约1-3分钟）...` });

  const rawVideoPath = path.join(taskDir, 'avatar_raw.mp4');
  const ffmpegStatic = require('ffmpeg-static');
  const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic;
  const { execSync } = require('child_process');

  if (useSeedance) {
    // ═══ Seedance 路径：Ark contents/generations/tasks → 1.5-pro 自动生成带音频同步的视频 ═══
    // 1.5-pro / 2.0 音视频一体输出，跳过我们自己的 TTS + mux 步骤
    const isAV = isSeedanceAVModel(model);
    const dur = Math.ceil(Math.min(10, Math.max(3, (text?.length || 30) / 5))); // 估：5字/秒
    const { videoBuffer, audioEmbedded } = await _seedanceAVGenerate(imgParam, prompt, model, apiKey, onProgress, { ratio, duration: dur, hasAudio: isAV });
    const finalSeedPath = path.join(taskDir, 'avatar_final.mp4');
    fs.writeFileSync(finalSeedPath, videoBuffer);
    console.log(`[Avatar] Seedance 视频完成: ${(videoBuffer.length / 1024).toFixed(0)}KB${audioEmbedded ? '（带音频同步）' : ''}`);

    if (audioEmbedded) {
      // 1.5-pro / 2.0 已经生成了带嘴型同步的音视频 → 直接返回，跳过 TTS + mux
      // 若有 BGM，再叠加一层 BGM（原音轨保留）
      if (bgm && fs.existsSync(bgm)) {
        try {
          onProgress?.({ step: 'mux', message: '叠加背景音乐...' });
          const withBgmPath = path.join(taskDir, 'avatar_with_bgm.mp4');
          const mixCmd = `"${ffmpegPath}" -i "${finalSeedPath}" -i "${bgm}" -filter_complex "[0:a]volume=${voiceVolume}[a0];[1:a]volume=${bgmVolume},aloop=loop=-1:size=2e+09[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]" -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -shortest -y "${withBgmPath}"`;
          execSync(mixCmd, { timeout: 120000, stdio: 'pipe' });
          if (fs.existsSync(withBgmPath) && fs.statSync(withBgmPath).size > 5000) {
            return { taskDir, videoPath: withBgmPath };
          }
        } catch (bgmErr) { console.warn('[Avatar] Seedance BGM 叠加失败，用原视频:', bgmErr.message?.slice(0, 120)); }
      }
      return { taskDir, videoPath: finalSeedPath };
    }
    // 否则（非 AV 模型）→ 走后续乒乓 + TTS + mux 标准流水线
    fs.writeFileSync(rawVideoPath, videoBuffer);
  } else if (useHedra) {
    // ═══ Hedra 路径：需要先合成 TTS → 喂给 Hedra 得到带音轨的对口型视频 ═══
    if (!text || !text.trim()) throw new Error('Hedra 模式需要文本（用于合成语音驱动对口型）');
    onProgress?.({ step: 'tts', message: 'Hedra 前置合成语音…' });
    const voiceBase = path.join(taskDir, 'voice_for_hedra');
    const audioFile = await generateSpeech(text, voiceBase, { voiceId: voiceId || null, speed });
    if (!audioFile || !fs.existsSync(audioFile)) throw new Error('TTS 合成失败，Hedra 无法继续');
    const videoBuf = await _hedraGenerateVideo(imgParam, audioFile, model, apiKey, ratio, onProgress);
    const finalHedraPath = path.join(taskDir, 'avatar_final.mp4');
    fs.writeFileSync(finalHedraPath, videoBuf);
    console.log(`[Avatar] Hedra 视频已下载: ${(videoBuf.length / 1024).toFixed(0)}KB（自带音轨+对口型）`);
    // 直接返回，跳过乒乓循环 + 合成步骤
    return { taskDir, videoPath: finalHedraPath };
  } else if (useKling) {
    // ═══ Kling 路径（支持漫路聚合平台 + 官方）═══
    const videoData = await _klingGenerateVideo(imgParam, prompt, model, apiKey, onProgress, normalizedCam.kling, ratio, klingRoute);
    fs.writeFileSync(rawVideoPath, videoData);
    console.log(`[Avatar] Kling 视频已下载: ${(videoData.length / 1024).toFixed(0)}KB`);
  } else if (useMiniMax) {
    // ═══ MiniMax 路径 ═══
    const videoData = await _minimaxGenerateVideo(imgParam, prompt, model, apiKey, onProgress);
    fs.writeFileSync(rawVideoPath, videoData);
    console.log(`[Avatar] MiniMax 视频已下载: ${(videoData.length / 1024).toFixed(0)}KB`);
  } else {
    // ═══ 智谱 CogVideoX 路径 ═══
    const _zhipuStarted = Date.now();
    let _zhipuOk = false; let _zhipuErr = null; let _zhipuTaskId = null;
    try {
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

      _zhipuTaskId = genRes.data?.id;
      if (!_zhipuTaskId) throw new Error('智谱 API 返回异常: ' + JSON.stringify(genRes.data));

      let videoUrl = null;
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 5000));
        onProgress?.({ step: 'video', message: `等待视频生成... (${(i + 1) * 5}秒)` });
        try {
          const pollRes = await axios.get(`${ZHIPU_API_BASE}/async-result/${_zhipuTaskId}`, {
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
      _zhipuOk = true;
    } catch (e) { _zhipuErr = e.message; throw e; }
    finally {
      try {
        require('./tokenTracker').record({
          provider: 'zhipu', model,
          category: 'video', videoSeconds: 5,  // CogVideoX 默认 5-6 秒
          durationMs: Date.now() - _zhipuStarted,
          status: _zhipuOk ? 'success' : 'fail', errorMsg: _zhipuErr,
          requestId: _zhipuTaskId,
        });
      } catch {}
    }
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
      const audioFile = await generateSpeech(text, voiceBase, { voiceId: voiceId || null, speed });

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
          // 如果有 BGM，用 amix 混合语音和背景音乐
          let mergeCmd;
          // bgm 可能是 URL 路径如 /api/avatar/audios/xxx.mp3，需要映射到磁盘文件
          let bgmPath = null;
          if (bgm) {
            const bgmFilename = bgm.includes('/') ? path.basename(bgm) : bgm;
            const candidatePaths = [
              path.join(AVATAR_DIR, bgmFilename),
              path.resolve(bgm.startsWith('/') ? '.' + bgm : bgm),
            ];
            bgmPath = candidatePaths.find(p => fs.existsSync(p)) || null;
          }
          const hasBgm = bgmPath && fs.existsSync(bgmPath);
          if (hasBgm) {
            // 3路混合：视频 + 语音(音量可调) + BGM(音量可调，循环)
            mergeCmd = `"${ffmpegPath}" -stream_loop -1 -i "${videoPath}" -i "${audioFile}" -stream_loop -1 -i "${bgmPath}" -filter_complex "[1:a]volume=${voiceVolume}[voice];[2:a]volume=${bgmVolume}[bgm];[voice][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]" -map 0:v:0 -map "[aout]" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -t ${Math.ceil(audioDuration)} -movflags +faststart -y "${mergedPath}"`;
            console.log(`[Avatar] 混合BGM: 人声${Math.round(voiceVolume*100)}% + BGM${Math.round(bgmVolume*100)}%`);
          } else {
            mergeCmd = `"${ffmpegPath}" -stream_loop -1 -i "${videoPath}" -i "${audioFile}" -filter_complex "[1:a]volume=${voiceVolume}[aout]" -map 0:v:0 -map "[aout]" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -t ${Math.ceil(audioDuration)} -movflags +faststart -y "${mergedPath}"`;
          }
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

  // ═══ P1: 视频背景 chromakey 合成 ═══
  // 当 background=green 且用户提供了 backgroundVideo，先对 finalPath 抠像再叠在 bg 视频上
  if (background === 'green' && backgroundVideo) {
    try {
      onProgress?.({ step: 'merge', message: '应用背景视频合成（绿幕抠像）...' });
      const composedPath = path.join(taskDir, 'avatar_bg_composed.mp4');
      const sizeMap2 = { '9:16': '720x1280', '16:9': '1280x720', '1:1': '1024x1024' };
      const outSize = sizeMap2[ratio] || '720x1280';
      let bgResolved = backgroundVideo;
      if (bgResolved.startsWith('/api/avatar/bg-videos/')) {
        bgResolved = path.join(BG_VIDEO_DIR, path.basename(bgResolved));
      }
      await _chromaKeyOverlay(finalPath, bgResolved, composedPath, { targetSize: outSize });
      if (fs.existsSync(composedPath) && fs.statSync(composedPath).size > 5000) {
        finalPath = composedPath;
      }
    } catch (ckErr) {
      console.warn('[Avatar] ChromaKey 合成失败（保留绿幕原片）:', ckErr.message?.slice(0, 120));
    }
  }

  return {
    taskDir,
    videoPath: finalPath
  };
}

/**
 * 多段视频生成 — 支持 AI 分镜 + 情绪曲线 + 镜头后处理
 *
 * 新增模式（v2）：
 *   - 传入 segments → 使用用户手动分镜
 *   - 传入 text + autoStoryboard=true → AI 自动分镜
 *
 * 每段流水线：I2V → 镜头后处理 → TTS → 合成 → crossfade 拼接
 */
async function generateMultiSegmentVideo(params) {
  const {
    imageUrl, segments: rawSegments, text, voiceId, speed = 1.0, ratio = '9:16',
    model = 'cogvideox-flash', background = 'office', onProgress, autoStoryboard = false,
    bodyFrame = 'head_shoulders',  // P0
    multiAngleImages = null,       // P0: { front_medium, side_45, front_closeup } 的 URL/本地路径映射
  } = params;
  const taskId = uuidv4();
  const taskDir = path.join(AVATAR_DIR, taskId);
  fs.mkdirSync(taskDir, { recursive: true });

  const useMiniMax = isMiniMaxModel(model);
  const useKling = isKlingModel(model);
  const useSeedance = isSeedanceModel(model);
  const klingRoute = useKling ? getKlingRoute() : null;
  const apiKey = useSeedance ? getArkKey()
    : useKling ? (klingRoute?.key || null)
    : (useMiniMax ? getMiniMaxKey() : getZhipuKey());
  if (!apiKey) throw new Error(
    useSeedance ? '未配置火山方舟 Ark Key'
    : useKling ? '未配置 Kling AI Key（或漫路 deyunai key）'
    : (useMiniMax ? '未配置 MiniMax API Key' : '未配置智谱 AI API Key')
  );
  if (useKling && klingRoute?.useAggregator) console.log('[Avatar-multi] Kling 走漫路');

  // ═══ v2: AI 分镜 + 情绪曲线 ═══
  let segments;
  if (rawSegments && rawSegments.length > 0) {
    // 用户传入手动分镜 — 保留原有行为，补全缺失字段
    segments = rawSegments.map((s, i) => ({
      text: s.text || '',
      camera: s.camera || 'medium',
      emotion: s.emotion || s.expression || 'neutral',
      emotion_intensity: s.emotion_intensity ?? 0.5,
      action: s.action || s.motion || 'speaking naturally',
      transition: i === 0 ? 'none' : (s.transition || 'crossfade'),
    }));
  } else if (text && text.trim()) {
    // 纯文本模式 → AI 分镜
    onProgress?.({ step: 'storyboard', message: 'AI 正在编排分镜...' });
    segments = await agentStoryboard(text);
    console.log(`[Avatar] AI 分镜完成: ${segments.length} 个镜头`);

    // 情绪曲线增强
    onProgress?.({ step: 'storyboard', message: 'AI 正在分析情绪曲线...' });
    segments = await agentEmotionCurve(segments);
    console.log(`[Avatar] 情绪曲线: ${segments.map(s => `${s.emotion}(${s.emotion_intensity})`).join(' → ')}`);

    // 保存分镜结果供前端展示
    fs.writeFileSync(path.join(taskDir, 'storyboard.json'), JSON.stringify(segments, null, 2));
  } else {
    throw new Error('请提供 text 或 segments');
  }

  const total = segments.length;
  onProgress?.({ step: 'start', message: `开始多段生成（共 ${total} 段，含镜头后处理）...` });

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

  // P0: 多机位参考图预解析（每个角度一次 base64，供各 shot 按镜头类型派发）
  let multiAngleImgParams = null;
  if (multiAngleImages && typeof multiAngleImages === 'object') {
    multiAngleImgParams = {};
    for (const [key, url] of Object.entries(multiAngleImages)) {
      if (!url) continue;
      try {
        if (url.startsWith('http')) {
          multiAngleImgParams[key] = url;
        } else if (url.startsWith('data:')) {
          multiAngleImgParams[key] = url;
        } else if (url.startsWith('/api/')) {
          const localPath = url.includes('preset-img')
            ? path.join(OUTPUT_DIR, 'presets', path.basename(url))
            : path.join(AVATAR_DIR, path.basename(url));
          if (fs.existsSync(localPath)) {
            const buf = fs.readFileSync(localPath);
            const ext = path.extname(localPath).slice(1) || 'png';
            multiAngleImgParams[key] = `data:image/${ext};base64,${buf.toString('base64')}`;
          }
        } else if (fs.existsSync(url)) {
          const buf = fs.readFileSync(url);
          const ext = path.extname(url).slice(1) || 'png';
          multiAngleImgParams[key] = `data:image/${ext};base64,${buf.toString('base64')}`;
        }
      } catch (e) {
        console.warn(`[Avatar-multi] 多机位图 ${key} 解析失败:`, e.message);
      }
    }
    if (Object.keys(multiAngleImgParams).length === 0) multiAngleImgParams = null;
    else console.log(`[Avatar-multi] 多机位启用: ${Object.keys(multiAngleImgParams).join(' / ')}`);
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
  const bodyHint = _bodyFramePromptHint(bodyFrame);

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

      // v2: 差异化 prompt —— 从分镜结果获取情绪+动作+镜头
      const emotionToExpr = {
        neutral: 'natural and relaxed facial expression',
        happy: 'warm genuine smiling expression with bright eyes',
        serious: 'serious and focused expression with intent gaze',
        excited: 'excited energetic expression with animated gestures',
        sad: 'slightly melancholic expression with soft eyes',
        surprised: 'subtly surprised expression with raised eyebrows',
        confident: 'confident and assured expression with steady gaze',
        warm: 'warm and friendly expression with gentle smile',
      };
      const emotionDesc = _emotionIntensityHint(seg.emotion || 'neutral', seg.emotion_intensity ?? 0.5);
      const prevSeg = idx > 0 ? segments[idx - 1] : null;
      const actionDesc = _sanitizeSegmentAction(seg.action, idx, prevSeg?.action);
      const continuityHint = _continuityPromptHint(idx, prevSeg?.action);
      const textSnippet = seg.text.slice(0, 80);
      const segCamHint = normalizeCamera(seg.camera).prompt_hint;
      const segCamHintStr = segCamHint ? `, ${segCamHint}` : '';

      // P0: 按本 shot 的 camera 从多机位图中挑选参考图（没启用多机位则 fallback 到主 imgParam）
      const segImgParam = _pickAngleForShot(seg, multiAngleImgParams, imgParam);
      const usedAngle = multiAngleImgParams ? (segImgParam === multiAngleImgParams.front_closeup ? 'front_closeup'
        : segImgParam === multiAngleImgParams.side_45 ? 'side_45'
        : segImgParam === multiAngleImgParams.front_medium ? 'front_medium' : 'fallback') : 'single';

      const prompt = `The person in the image is speaking directly to the camera with confident eye contact ${bgDesc ? bgDesc + ', ' : ''}with ${emotionDesc}. ${bodyHint}. ${actionDesc}${segCamHintStr}. ${continuityHint}. Gentle breathing motion, natural eye blinks, subtle weight shifts. They say: "${textSnippet}". Realistic lip sync, cinematic smooth motion, 24fps film quality. ${ACTION_NEGATIVES_SUFFIX}`;

      onProgress?.({ step: 'video', message: `生成第 ${idx + 1}/${total} 段视频 (机位 ${usedAngle})...`, segment: idx + 1, total });

      const rawPath = path.join(segDir, 'raw.mp4');

      if (useSeedance) {
        // Seedance 路径 — 1.5-pro/2.0 音视频一体生成
        const segProgress = (info) => onProgress?.({ ...info, message: `第${idx+1}段: ${info.message}`, segment: idx + 1, total });
        const dur = Math.ceil(Math.min(10, Math.max(3, (seg.text?.length || 30) / 5)));
        const { videoBuffer } = await _seedanceAVGenerate(segImgParam, prompt, model, apiKey, segProgress, { ratio, duration: dur, hasAudio: isSeedanceAVModel(model) });
        fs.writeFileSync(rawPath, videoBuffer);
      } else if (useKling) {
        // Kling 路径 — 接 camera_control + 漫路路由
        const segProgress = (info) => onProgress?.({ ...info, message: `第${idx+1}段: ${info.message}`, segment: idx + 1, total });
        const segCam = normalizeCamera(seg.camera);
        const videoData = await _klingGenerateVideo(segImgParam, prompt, model, apiKey, segProgress, segCam.kling, ratio, klingRoute);
        fs.writeFileSync(rawPath, videoData);
      } else if (useMiniMax) {
        // MiniMax 路径
        const segProgress = (info) => onProgress?.({ ...info, message: `第${idx+1}段: ${info.message}`, segment: idx + 1, total });
        const videoData = await _minimaxGenerateVideo(segImgParam, prompt, model, apiKey, segProgress);
        fs.writeFileSync(rawPath, videoData);
      } else {
        // 智谱 CogVideoX 路径（多段分镜模式）
        const _zStarted = Date.now();
        let _zOk = false; let _zErr = null; let _zTaskId = null;
        try {
          let genRes;
          for (let retry = 0; retry < 5; retry++) {
            try {
              genRes = await axios.post(`${ZHIPU_API_BASE}/videos/generations`, {
                model, prompt, image_url: segImgParam
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

          _zTaskId = genRes.data?.id;
          if (!_zTaskId) throw new Error(`第${idx + 1}段: 智谱 API 返回异常`);

          let videoUrl = null;
          for (let i = 0; i < 120; i++) {
            await new Promise(r => setTimeout(r, 5000));
            if (i % 6 === 0) onProgress?.({ step: 'video', message: `第 ${idx + 1}/${total} 段生成中... (${(i + 1) * 5}秒)`, segment: idx + 1, total });
            try {
              const pollRes = await axios.get(`${ZHIPU_API_BASE}/async-result/${_zTaskId}`, {
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
          _zOk = true;
        } catch (e) { _zErr = e.message; throw e; }
        finally {
          try {
            require('./tokenTracker').record({
              provider: 'zhipu', model,
              category: 'video', videoSeconds: 5,
              durationMs: Date.now() - _zStarted,
              status: _zOk ? 'success' : 'fail', errorMsg: _zErr,
              requestId: _zTaskId,
            });
          } catch {}
        }
      }

      // Seedance AV 已带音频同步 → 跳过乒乓 + TTS（保持原生音视频）
      const segAVEmbedded = useSeedance && isSeedanceAVModel(model);

      // 乒乓循环（Seedance AV 跳过：乒乓会打乱音频）
      const ppPath = path.join(segDir, 'pingpong.mp4');
      let segVideoPath = rawPath;
      if (!segAVEmbedded) {
        try {
          const ppCmd = `"${ffmpegPath}" -i "${rawPath}" -filter_complex "[0:v]split[v1][v2];[v2]reverse[vr];[v1][vr]concat=n=2:v=1:a=0" -c:v libx264 -preset fast -crf 22 -an -y "${ppPath}"`;
          execSync(ppCmd, { timeout: 60000, stdio: 'pipe' });
          if (fs.existsSync(ppPath) && fs.statSync(ppPath).size > 5000) segVideoPath = ppPath;
        } catch {}
      }

      // v2: 镜头后处理（Kling / Seedance 原生运镜，跳过 FFmpeg 兜底）
      const segCamSimple = normalizeCamera(seg.camera).simple;
      if (!useKling && !useSeedance && segCamSimple && segCamSimple !== 'medium') {
        onProgress?.({ step: 'camera', message: `第 ${idx + 1}/${total} 段镜头处理 (${segCamSimple})...`, segment: idx + 1, total });
        // 获取乒乓后的视频时长用于镜头计算
        let segDuration = 10;
        try {
          const probeOut = execSync(`"${ffmpegPath}" -i "${segVideoPath}" 2>&1`, { encoding: 'utf8', timeout: 10000 });
          const dm = probeOut.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
          if (dm) segDuration = +dm[1] * 3600 + +dm[2] * 60 + +dm[3] + +dm[4] / 100;
        } catch (e) {
          const stderr = e.stderr?.toString() || e.stdout?.toString() || '';
          const dm = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
          if (dm) segDuration = +dm[1] * 3600 + +dm[2] * 60 + +dm[3] + +dm[4] / 100;
        }
        const cameraPath = path.join(segDir, 'camera.mp4');
        segVideoPath = applyCameraMove(segVideoPath, cameraPath, segCamSimple, segDuration);
      }

      // TTS（Seedance AV 已带嘴型同步音频 → 跳过我们的 TTS，保留模型原生音轨）
      let audioPath = null;
      if (!segAVEmbedded && seg.text && seg.text.trim()) {
        onProgress?.({ step: 'tts', message: `第 ${idx + 1}/${total} 段配音...`, segment: idx + 1, total });
        try {
          const voiceBase = path.join(segDir, 'voice');
          audioPath = await generateSpeech(seg.text, voiceBase, { voiceId: voiceId || null, speed });
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

/**
 * 方案 C: 多场景视频生成 — 每个 scene 可以有不同的 avatar/背景/文本/镜头
 *
 * scenes: [
 *   { imageUrl, text, background, camera, emotion, action, transition },
 *   ...
 * ]
 *
 * 典型用途：
 *   - 场景1: 主持人在演播室开场（avatar A, studio 背景, medium）
 *   - 场景2: 切换到教室讲课（avatar A, classroom 背景, zoom_in）
 *   - 场景3: 嘉宾对话（avatar B, office 背景, close_up）
 */
async function generateMultiSceneVideo(params) {
  const { scenes, voiceId, speed = 1.0, ratio = '9:16', model = 'cogvideox-flash', onProgress } = params;
  const taskId = uuidv4();
  const taskDir = path.join(AVATAR_DIR, taskId);
  fs.mkdirSync(taskDir, { recursive: true });

  const useMiniMax = isMiniMaxModel(model);
  const useKling = isKlingModel(model);
  const klingRoute = useKling ? getKlingRoute() : null;
  const apiKey = useKling ? (klingRoute?.key || null) : (useMiniMax ? getMiniMaxKey() : getZhipuKey());
  if (!apiKey) throw new Error(useKling ? '未配置 Kling AI Key（或漫路）' : (useMiniMax ? '未配置 MiniMax API Key' : '未配置智谱 AI API Key'));

  const total = scenes.length;
  onProgress?.({ step: 'start', message: `多场景模式：共 ${total} 个场景` });

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

  const emotionToExpr = {
    neutral: 'natural and relaxed facial expression',
    happy: 'warm genuine smiling expression with bright eyes',
    serious: 'serious and focused expression with intent gaze',
    excited: 'excited energetic expression with animated gestures',
    confident: 'confident and assured expression with steady gaze',
    warm: 'warm and friendly expression with gentle smile',
  };

  // 逐场景生成（串行以避免 API 并发限制）
  const sceneClips = [];
  for (let idx = 0; idx < total; idx++) {
    const scene = scenes[idx];
    const sceneDir = path.join(taskDir, `scene_${idx}`);
    fs.mkdirSync(sceneDir, { recursive: true });

    const bgDesc = bgDescMap[scene.background] || bgDescMap.office;
    const emotionDesc = _emotionIntensityHint(scene.emotion || 'neutral', scene.emotion_intensity ?? 0.5);
    const actionDesc = scene.action || 'speaking naturally with subtle gestures';
    const textSnippet = (scene.text || '').slice(0, 80);
    const camera = scene.camera || 'medium';
    const camHintScene = normalizeCamera(camera).prompt_hint;
    const camHintStr = camHintScene ? `, ${camHintScene}` : '';

    const prompt = `The person in the image is speaking directly to the camera with confident eye contact ${bgDesc}, with ${emotionDesc}. ${actionDesc}${camHintStr}. Gentle breathing motion, natural eye blinks, subtle weight shifts. ${textSnippet ? `They say: "${textSnippet}".` : ''} Realistic lip sync, cinematic smooth motion, 24fps film quality.`;

    // 准备图片
    let imgParam = scene.imageUrl;
    if (imgParam && !imgParam.startsWith('http') && !imgParam.startsWith('data:') && fs.existsSync(imgParam)) {
      const buf = fs.readFileSync(imgParam);
      const ext = path.extname(imgParam).slice(1) || 'png';
      imgParam = `data:image/${ext};base64,${buf.toString('base64')}`;
    }

    onProgress?.({ step: 'video', message: `场景 ${idx + 1}/${total}: 生成视频...`, segment: idx + 1, total });

    // I2V 生成
    const rawPath = path.join(sceneDir, 'raw.mp4');
    const sceneCam = normalizeCamera(scene.camera);
    if (useKling) {
      const videoData = await _klingGenerateVideo(imgParam, prompt, model, apiKey, (info) => onProgress?.({ ...info, message: `场景${idx+1}: ${info.message}`, segment: idx+1, total }), sceneCam.kling, ratio, klingRoute);
      fs.writeFileSync(rawPath, videoData);
    } else if (useMiniMax) {
      const videoData = await _minimaxGenerateVideo(imgParam, prompt, model, apiKey, (info) => onProgress?.({ ...info, message: `场景${idx+1}: ${info.message}`, segment: idx+1, total }));
      fs.writeFileSync(rawPath, videoData);
    } else {
      // 智谱 CogVideoX（多场景模式）
      const _zStarted = Date.now();
      let _zOk = false; let _zErr = null; let _zTaskId = null;
      try {
        let genRes;
        for (let retry = 0; retry < 3; retry++) {
          try {
            genRes = await axios.post(`${ZHIPU_API_BASE}/videos/generations`, { model, prompt, image_url: imgParam }, {
              headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 300000
            });
            break;
          } catch (e) {
            if (retry < 2) { await new Promise(r => setTimeout(r, 10000 * (retry + 1))); continue; }
            throw new Error(`场景${idx+1} 视频 API 失败: ${e.message}`);
          }
        }
        _zTaskId = genRes.data?.id;
        let videoUrl = null;
        for (let i = 0; i < 120; i++) {
          await new Promise(r => setTimeout(r, 5000));
          if (i % 6 === 0) onProgress?.({ step: 'video', message: `场景 ${idx+1}/${total} 生成中... (${(i+1)*5}秒)`, segment: idx+1, total });
          try {
            const poll = await axios.get(`${ZHIPU_API_BASE}/async-result/${_zTaskId}`, { headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 15000 });
            if (poll.data?.task_status === 'SUCCESS') { videoUrl = poll.data?.video_result?.[0]?.url; break; }
            if (poll.data?.task_status === 'FAIL') throw new Error(`场景${idx+1} 视频生成失败`);
          } catch (e) { if (e.message.includes('生成失败')) throw e; }
        }
        if (!videoUrl) throw new Error(`场景${idx+1} 视频生成超时`);
        const vr = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 120000 });
        fs.writeFileSync(rawPath, vr.data);
        _zOk = true;
      } catch (e) { _zErr = e.message; throw e; }
      finally {
        try {
          require('./tokenTracker').record({
            provider: 'zhipu', model,
            category: 'video', videoSeconds: 5,
            durationMs: Date.now() - _zStarted,
            status: _zOk ? 'success' : 'fail', errorMsg: _zErr,
            requestId: _zTaskId,
          });
        } catch {}
      }
    }

    // 乒乓循环
    const ppPath = path.join(sceneDir, 'pingpong.mp4');
    let segVideoPath = rawPath;
    try {
      execSync(`"${ffmpegPath}" -i "${rawPath}" -filter_complex "[0:v]split[v1][v2];[v2]reverse[vr];[v1][vr]concat=n=2:v=1:a=0" -c:v libx264 -preset fast -crf 22 -an -y "${ppPath}"`, { timeout: 60000, stdio: 'pipe' });
      if (fs.existsSync(ppPath) && fs.statSync(ppPath).size > 5000) segVideoPath = ppPath;
    } catch {}

    // 镜头后处理（Kling 已经 API 层运镜，不再 FFmpeg 叠加）
    const camSimple = normalizeCamera(camera).simple;
    if (!useKling && camSimple && camSimple !== 'medium') {
      onProgress?.({ step: 'camera', message: `场景 ${idx+1}: 镜头处理 (${camSimple})...`, segment: idx+1, total });
      let segDuration = 10;
      try {
        const p = execSync(`"${ffmpegPath}" -i "${segVideoPath}" 2>&1`, { encoding: 'utf8', timeout: 10000 });
        const dm = p.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
        if (dm) segDuration = +dm[1]*3600 + +dm[2]*60 + +dm[3] + +dm[4]/100;
      } catch (e) {
        const s = e.stderr?.toString() || '';
        const dm = s.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
        if (dm) segDuration = +dm[1]*3600 + +dm[2]*60 + +dm[3] + +dm[4]/100;
      }
      const camPath = path.join(sceneDir, 'camera.mp4');
      segVideoPath = applyCameraMove(segVideoPath, camPath, camSimple, segDuration);
    }

    // TTS
    let finalSegPath = segVideoPath;
    if (scene.text && scene.text.trim()) {
      onProgress?.({ step: 'tts', message: `场景 ${idx+1}: 语音合成...`, segment: idx+1, total });
      try {
        const voiceBase = path.join(sceneDir, 'voice');
        const audioFile = await generateSpeech(scene.text, voiceBase, { voiceId: scene.voiceId || voiceId || null, speed });
        if (audioFile && fs.existsSync(audioFile)) {
          const mergedPath = path.join(sceneDir, 'merged.mp4');
          let audioDuration = 5;
          try {
            const o = execSync(`"${ffmpegPath}" -i "${audioFile}" 2>&1`, { encoding: 'utf8', timeout: 10000 });
            const dm = o.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
            if (dm) audioDuration = +dm[1]*3600 + +dm[2]*60 + +dm[3] + +dm[4]/100;
          } catch (e) {
            const s = e.stderr?.toString() || e.stdout?.toString() || '';
            const dm = s.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
            if (dm) audioDuration = +dm[1]*3600 + +dm[2]*60 + +dm[3] + +dm[4]/100;
          }
          execSync(`"${ffmpegPath}" -stream_loop -1 -i "${segVideoPath}" -i "${audioFile}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -map 0:v:0 -map 1:a:0 -t ${Math.ceil(audioDuration)} -movflags +faststart -y "${mergedPath}"`, { timeout: 120000, stdio: 'pipe' });
          if (fs.existsSync(mergedPath) && fs.statSync(mergedPath).size > 1000) finalSegPath = mergedPath;
        }
      } catch (ttsErr) {
        console.warn(`[Avatar] 场景${idx+1} TTS 失败:`, ttsErr.message);
      }
    }

    sceneClips.push({ idx, videoPath: finalSegPath, transition: scene.transition || (idx === 0 ? 'none' : 'crossfade') });
  }

  // 拼接所有场景
  onProgress?.({ step: 'merge', message: '拼接所有场景...' });
  const finalPath = path.join(taskDir, 'avatar_final.mp4');

  if (sceneClips.length === 1) {
    fs.copyFileSync(sceneClips[0].videoPath, finalPath);
  } else {
    // crossfade 拼接（和 multiSegment 相同逻辑）
    const durations = [];
    for (const clip of sceneClips) {
      let dur = 5;
      try {
        const o = execSync(`"${ffmpegPath}" -i "${clip.videoPath}" 2>&1`, { encoding: 'utf8', timeout: 10000 });
        const dm = o.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
        if (dm) dur = +dm[1]*3600 + +dm[2]*60 + +dm[3] + +dm[4]/100;
      } catch (e) {
        const s = e.stderr?.toString() || '';
        const dm = s.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
        if (dm) dur = +dm[1]*3600 + +dm[2]*60 + +dm[3] + +dm[4]/100;
      }
      durations.push(dur);
    }

    const XFADE_DUR = 0.5;
    let inputArgs = sceneClips.map(c => `-i "${c.videoPath}"`).join(' ');
    let filterComplex = '';
    let vLabel = '[0:v]', aLabel = '[0:a]';
    let offset = durations[0] - XFADE_DUR;
    for (let i = 1; i < sceneClips.length; i++) {
      const outV = i < sceneClips.length - 1 ? `[xv${i}]` : '[outv]';
      const outA = i < sceneClips.length - 1 ? `[xa${i}]` : '[outa]';
      filterComplex += `${vLabel}[${i}:v]xfade=transition=fade:duration=${XFADE_DUR}:offset=${Math.max(0, offset).toFixed(2)}${outV};`;
      filterComplex += `${aLabel}[${i}:a]acrossfade=d=${XFADE_DUR}${outA};`;
      vLabel = outV; aLabel = outA;
      offset += durations[i] - XFADE_DUR;
    }
    filterComplex = filterComplex.replace(/;$/, '');

    try {
      execSync(`"${ffmpegPath}" ${inputArgs} -filter_complex "${filterComplex}" -map "[outv]" -map "[outa]" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart -y "${finalPath}"`, { timeout: 300000, stdio: 'pipe' });
    } catch {
      // 回退 concat
      const concatFile = path.join(taskDir, 'concat.txt');
      fs.writeFileSync(concatFile, sceneClips.map(c => `file '${c.videoPath.replace(/\\/g, '/')}'`).join('\n'));
      execSync(`"${ffmpegPath}" -f concat -safe 0 -i "${concatFile}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart -y "${finalPath}"`, { timeout: 300000, stdio: 'pipe' });
    }
  }

  console.log(`[Avatar] 多场景拼接完成: ${sceneClips.length} 场景, ${(fs.statSync(finalPath).size / 1024 / 1024).toFixed(1)}MB`);

  // 保存场景信息
  fs.writeFileSync(path.join(taskDir, 'scenes.json'), JSON.stringify(scenes, null, 2));

  return { taskDir, videoPath: finalPath };
}

// ═══════════════════════════════════════════════
// 多人数字人同框对话 (P0 差异化功能)
// ═══════════════════════════════════════════════

/**
 * 把任意来源的 imageUrl 解析成 data:image base64 字符串（I2V 可直接用）
 * 支持：http URL / /api/avatar/... / /api/... preset / 绝对磁盘路径
 */
function _resolveImageToBase64(imageUrl) {
  if (!imageUrl) throw new Error('imageUrl 不能为空');
  if (imageUrl.startsWith('data:')) return imageUrl;
  if (imageUrl.startsWith('http')) return imageUrl; // 远程 URL 直接传给 provider
  if (imageUrl.startsWith('/api/')) {
    const localPath = imageUrl.includes('preset-img')
      ? path.join(OUTPUT_DIR, 'presets', path.basename(imageUrl))
      : path.join(AVATAR_DIR, path.basename(imageUrl));
    if (!fs.existsSync(localPath)) throw new Error('图片不存在: ' + imageUrl);
    const buf = fs.readFileSync(localPath);
    const ext = path.extname(localPath).slice(1) || 'png';
    return `data:image/${ext};base64,${buf.toString('base64')}`;
  }
  if (fs.existsSync(imageUrl)) {
    const buf = fs.readFileSync(imageUrl);
    const ext = path.extname(imageUrl).slice(1) || 'png';
    return `data:image/${ext};base64,${buf.toString('base64')}`;
  }
  throw new Error('无效的图片路径: ' + imageUrl);
}

function _probeDuration(ffmpegPath, filePath, fallback = 5) {
  const { execSync } = require('child_process');
  try {
    const o = execSync(`"${ffmpegPath}" -i "${filePath}" 2>&1`, { encoding: 'utf8', timeout: 10000 }).toString();
    const m = o.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100;
  } catch (e) {
    const s = e.stderr?.toString() || e.stdout?.toString() || '';
    const m = s.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100;
  }
  return fallback;
}

/**
 * 生成单个说话片段（一个 avatar 说一句话）
 * 返回片段磁盘路径 + 实际时长
 */
async function _generateOneUtteranceClip({
  imgParam, text, voiceId, speed, model, apiKey,
  emotion, emotionIntensity, motion, camera, background, ratio,
  utterDir, onProgress, klingRoute
}) {
  const { execSync } = require('child_process');
  const ffmpegStatic = require('ffmpeg-static');
  const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic;
  fs.mkdirSync(utterDir, { recursive: true });

  const useMiniMax = isMiniMaxModel(model);
  const useKling = isKlingModel(model);
  const useHedra = isHedraModel(model);

  const bgDescMap = {
    office: 'in a modern corporate office with city skyline view through glass windows, warm professional lighting',
    studio: 'in a professional TV broadcast studio with blue and purple neon lighting, LED screen background',
    classroom: 'in a modern bright classroom with whiteboard and bookshelves, warm natural lighting',
    outdoor: 'in a beautiful outdoor garden with cherry blossoms and soft golden sunlight',
    green: 'against a solid green chroma key background',
    custom: '',
  };
  const emotionToExpr = {
    neutral: 'natural and relaxed facial expression',
    happy: 'warm genuine smiling expression with bright eyes',
    serious: 'serious and focused expression with intent gaze',
    excited: 'excited energetic expression with animated gestures',
    sad: 'subdued melancholic expression with lowered gaze',
    surprised: 'surprised widened-eyes expression',
    confident: 'confident and assured expression with steady gaze',
    warm: 'warm and friendly expression with gentle smile',
  };
  const bgDesc = bgDescMap[background] || bgDescMap.studio;
  const emotionDesc = _emotionIntensityHint(emotion || 'neutral', emotionIntensity ?? 0.5);
  const actionDesc = motion || 'speaking naturally with subtle gestures';
  const camHint = normalizeCamera(camera).prompt_hint;
  const camHintStr = camHint ? `, ${camHint}` : '';

  const prompt = `The person in the image is speaking directly to the camera with confident eye contact ${bgDesc ? bgDesc + ', ' : ''}with ${emotionDesc}. ${actionDesc}${camHintStr}. Gentle breathing motion, natural eye blinks, subtle weight shifts. They say: "${(text || '').slice(0, 100)}". Realistic lip sync, cinematic smooth motion, 24fps film quality.`;

  // 1. I2V
  const rawPath = path.join(utterDir, 'raw.mp4');

  if (useHedra) {
    // Hedra: 先合成 TTS → 喂给 Hedra → 返回含音轨对口型视频
    if (!text || !text.trim()) throw new Error('Hedra 模式需要文本');
    const voiceBase = path.join(utterDir, 'voice_for_hedra');
    const audioFile = await generateSpeech(text, voiceBase, { voiceId: voiceId || null, speed });
    if (!audioFile || !fs.existsSync(audioFile)) throw new Error('TTS 合成失败');
    const videoBuf = await _hedraGenerateVideo(imgParam, audioFile, model, apiKey, ratio, onProgress);
    fs.writeFileSync(rawPath, videoBuf);
    // Hedra 自带音轨 + 对口型，跳过后面合成，直接可选镜头后处理（只用 simple 字符串做 FFmpeg 回退）
    let finalPath = rawPath;
    const camSimple = normalizeCamera(camera).simple;
    if (camSimple && camSimple !== 'medium') {
      const dur = _probeDuration(ffmpegPath, rawPath, 5);
      const camPath = path.join(utterDir, 'camera.mp4');
      finalPath = applyCameraMove(rawPath, camPath, camSimple, dur);
    }
    return { clipPath: finalPath, duration: _probeDuration(ffmpegPath, finalPath, 5) };
  } else if (useKling) {
    const utterCam = normalizeCamera(camera);
    const videoData = await _klingGenerateVideo(imgParam, prompt, model, apiKey, onProgress, utterCam.kling, ratio, klingRoute);
    fs.writeFileSync(rawPath, videoData);
  } else if (useMiniMax) {
    const videoData = await _minimaxGenerateVideo(imgParam, prompt, model, apiKey, onProgress);
    fs.writeFileSync(rawPath, videoData);
  } else {
    // 智谱 CogVideoX
    let genRes;
    for (let retry = 0; retry < 3; retry++) {
      try {
        genRes = await axios.post(`${ZHIPU_API_BASE}/videos/generations`, { model, prompt, image_url: imgParam }, {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 300000
        });
        break;
      } catch (e) {
        if (retry < 2) { await new Promise(r => setTimeout(r, 10000 * (retry + 1))); continue; }
        throw new Error(`I2V API 失败: ${e.message}`);
      }
    }
    const zhipuTaskId = genRes.data?.id;
    let videoUrl = null;
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 5000));
      try {
        const poll = await axios.get(`${ZHIPU_API_BASE}/async-result/${zhipuTaskId}`, { headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 15000 });
        if (poll.data?.task_status === 'SUCCESS') { videoUrl = poll.data?.video_result?.[0]?.url; break; }
        if (poll.data?.task_status === 'FAIL') throw new Error('视频生成失败');
      } catch (e) { if (e.message.includes('生成失败')) throw e; }
    }
    if (!videoUrl) throw new Error('视频生成超时');
    const vr = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 120000 });
    fs.writeFileSync(rawPath, vr.data);
  }

  // 2. 乒乓循环（平滑过渡）
  let videoPath = rawPath;
  const ppPath = path.join(utterDir, 'pingpong.mp4');
  try {
    execSync(`"${ffmpegPath}" -i "${rawPath}" -filter_complex "[0:v]split[v1][v2];[v2]reverse[vr];[v1][vr]concat=n=2:v=1:a=0" -c:v libx264 -preset fast -crf 22 -an -y "${ppPath}"`, { timeout: 60000, stdio: 'pipe' });
    if (fs.existsSync(ppPath) && fs.statSync(ppPath).size > 5000) videoPath = ppPath;
  } catch {}

  // 3. 镜头后处理（仅当 Kling 没在 API 层处理时）
  // Kling 已通过 camera_control 原生运镜，不再 FFmpeg 叠加；其他模型走 FFmpeg 兜底
  const camSimpleName = normalizeCamera(camera).simple;
  if (!useKling && camSimpleName && camSimpleName !== 'medium') {
    const dur = _probeDuration(ffmpegPath, videoPath, 10);
    const camPath = path.join(utterDir, 'camera.mp4');
    videoPath = applyCameraMove(videoPath, camPath, camSimpleName, dur);
  }

  // 4. TTS 合成
  let finalPath = videoPath;
  let finalDuration = _probeDuration(ffmpegPath, videoPath, 5);
  if (text && text.trim()) {
    try {
      const voiceBase = path.join(utterDir, 'voice');
      const audioFile = await generateSpeech(text, voiceBase, { voiceId: voiceId || null, speed });
      if (audioFile && fs.existsSync(audioFile)) {
        const mergedPath = path.join(utterDir, 'merged.mp4');
        const audioDuration = _probeDuration(ffmpegPath, audioFile, 5);
        execSync(`"${ffmpegPath}" -stream_loop -1 -i "${videoPath}" -i "${audioFile}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -map 0:v:0 -map 1:a:0 -t ${Math.ceil(audioDuration)} -movflags +faststart -y "${mergedPath}"`, { timeout: 120000, stdio: 'pipe' });
        if (fs.existsSync(mergedPath) && fs.statSync(mergedPath).size > 1000) {
          finalPath = mergedPath;
          finalDuration = audioDuration;
        }
      }
    } catch (ttsErr) {
      console.warn(`[MultiSpeaker] TTS 失败: ${ttsErr.message?.slice(0, 80)}`);
    }
  }

  return { clipPath: finalPath, duration: finalDuration };
}

/**
 * 把静态图生成 N 秒静态视频（用于 side-by-side 模式下非说话者的填充）
 */
function _imageToStaticVideo(ffmpegPath, imagePath, durationSec, outPath, sizeWH) {
  const { execSync } = require('child_process');
  const [w, h] = sizeWH.split('x').map(Number);
  // -loop 1 循环图片 + -t 时长 + scale 到目标尺寸
  execSync(
    `"${ffmpegPath}" -loop 1 -i "${imagePath}" -t ${durationSec} -vf "scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -r 24 -y "${outPath}"`,
    { timeout: 60000, stdio: 'pipe' }
  );
  return outPath;
}

/**
 * 把 base64 图片写到临时文件（用于 _imageToStaticVideo）
 */
function _writeBase64ImageToFile(base64OrUrl, outPath) {
  if (base64OrUrl.startsWith('data:')) {
    const b64 = base64OrUrl.replace(/^data:[^;]+;base64,/, '');
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
    return outPath;
  }
  // http URL: 下载
  if (base64OrUrl.startsWith('http')) {
    // 同步下载有点糟糕，但这里是小图
    throw new Error('远程 URL 请先下载后传本地路径');
  }
  if (fs.existsSync(base64OrUrl)) {
    fs.copyFileSync(base64OrUrl, outPath);
    return outPath;
  }
  throw new Error('图片无效: ' + base64OrUrl);
}

/**
 * 多人数字人同框对话
 *
 * @param {Object} params
 *   - speakers: [{ id, imageUrl, voiceId, name?, emotion? }]
 *   - dialogue: [{ speakerId, text, emotion?, emotion_intensity?, motion?, camera?, transition? }]
 *   - layout: 'cut-to-speaker' | 'side-by-side'  (default: cut-to-speaker)
 *   - background, ratio, model, speed, onProgress
 *
 * 布局：
 *   - cut-to-speaker: 顺序生成每人说话片段 → xfade 拼接（像对话剪辑切镜）
 *   - side-by-side:   每发言片段并排显示所有 speakers（当前说话者为动态视频，其他为静态图）
 */
async function generateMultiSpeakerScene(params) {
  const {
    speakers,
    dialogue,
    layout = 'cut-to-speaker',
    background = 'studio',
    ratio = '16:9', // 多人对话默认横屏
    model = 'cogvideox-flash',
    speed = 1.0,
    onProgress,
  } = params;

  // ─── 校验 ───
  if (!Array.isArray(speakers) || speakers.length < 1) throw new Error('至少 1 个 speaker');
  if (!Array.isArray(dialogue) || dialogue.length < 1) throw new Error('至少 1 条 dialogue');
  const speakerIds = new Set(speakers.map(s => s.id));
  for (const s of speakers) if (!s.id || !s.imageUrl) throw new Error(`speaker 缺 id/imageUrl: ${JSON.stringify(s)}`);
  for (const d of dialogue) {
    if (!d.speakerId) throw new Error('dialogue 缺 speakerId');
    if (!speakerIds.has(d.speakerId)) throw new Error(`dialogue 引用了未知 speaker: ${d.speakerId}`);
    if (!d.text || !d.text.trim()) throw new Error('dialogue.text 不能为空');
  }
  if (layout === 'side-by-side' && speakers.length !== 2) {
    throw new Error('side-by-side 目前仅支持 2 个 speakers，其他数量请用 cut-to-speaker');
  }

  const taskId = uuidv4();
  const taskDir = path.join(AVATAR_DIR, taskId);
  fs.mkdirSync(taskDir, { recursive: true });

  const useMiniMax = isMiniMaxModel(model);
  const useKling = isKlingModel(model);
  const useHedra = isHedraModel(model);
  const klingRoute = useKling ? getKlingRoute() : null;
  const apiKey = useHedra ? getHedraKey()
    : useKling ? (klingRoute?.key || null)
    : (useMiniMax ? getMiniMaxKey() : getZhipuKey());
  if (!apiKey) throw new Error('未配置对应 provider 的 API Key');

  const ffmpegStatic = require('ffmpeg-static');
  const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic;
  const { execSync } = require('child_process');
  const sizeMap = { '9:16': '720x1280', '16:9': '1280x720', '1:1': '1024x1024' };
  const size = sizeMap[ratio] || '1280x720';

  onProgress?.({ step: 'start', message: `多人对话模式 (${layout})：${speakers.length} 角色 × ${dialogue.length} 发言` });

  // ─── 预处理每个 speaker 的图片（只解析一次）───
  const speakerMap = new Map();
  for (const s of speakers) {
    const imgParam = _resolveImageToBase64(s.imageUrl);
    // side-by-side 还需要一张物理文件（用于静态填充视频）
    let imgFilePath = null;
    if (layout === 'side-by-side') {
      imgFilePath = path.join(taskDir, `speaker_${s.id}.png`);
      if (imgParam.startsWith('data:')) {
        _writeBase64ImageToFile(imgParam, imgFilePath);
      } else if (fs.existsSync(s.imageUrl)) {
        fs.copyFileSync(s.imageUrl, imgFilePath);
      } else if (s.imageUrl.startsWith('/api/')) {
        const localPath = s.imageUrl.includes('preset-img')
          ? path.join(OUTPUT_DIR, 'presets', path.basename(s.imageUrl))
          : path.join(AVATAR_DIR, path.basename(s.imageUrl));
        if (fs.existsSync(localPath)) fs.copyFileSync(localPath, imgFilePath);
      }
    }
    speakerMap.set(s.id, { ...s, imgParam, imgFilePath });
  }

  // ─── 逐条发言生成片段 ───
  const utterClips = []; // [{ speakerId, clipPath, duration, utterance }]
  for (let i = 0; i < dialogue.length; i++) {
    const utter = dialogue[i];
    const speaker = speakerMap.get(utter.speakerId);
    const utterDir = path.join(taskDir, `utter_${String(i).padStart(3, '0')}_${speaker.id}`);

    onProgress?.({
      step: 'utterance',
      message: `生成发言 ${i + 1}/${dialogue.length}: ${speaker.name || speaker.id} "${utter.text.slice(0, 30)}..."`,
      current: i + 1,
      total: dialogue.length,
    });

    const clip = await _generateOneUtteranceClip({
      imgParam: speaker.imgParam,
      text: utter.text,
      voiceId: utter.voiceId || speaker.voiceId,
      speed,
      model,
      apiKey,
      klingRoute,
      emotion: utter.emotion || speaker.emotion || 'neutral',
      emotionIntensity: utter.emotion_intensity ?? 0.5,
      motion: utter.motion,
      camera: utter.camera || 'medium',
      background,
      ratio,
      utterDir,
      onProgress: (info) => onProgress?.({ ...info, message: `发言${i + 1}: ${info.message}`, current: i + 1, total: dialogue.length }),
    });

    utterClips.push({
      speakerId: utter.speakerId,
      clipPath: clip.clipPath,
      duration: clip.duration,
      transition: i === 0 ? 'none' : (utter.transition || 'crossfade'),
    });
  }

  // ─── 布局合成 ───
  const finalPath = path.join(taskDir, 'multispeaker_final.mp4');

  if (layout === 'cut-to-speaker') {
    // 切镜头：顺序 + xfade
    onProgress?.({ step: 'compose', message: '切镜头拼接 (cut-to-speaker)...' });
    await _concatWithXfade(ffmpegPath, utterClips, finalPath);
  } else if (layout === 'side-by-side') {
    // 并排：每条发言把当前说话者的视频 + 非说话者的静态图 hstack
    onProgress?.({ step: 'compose', message: '并排合成 (side-by-side)...' });
    const composedClips = [];
    const [spA, spB] = speakers; // 已校验恰 2 个
    const [w, h] = size.split('x').map(Number);
    const halfW = Math.floor(w / 2);

    for (let i = 0; i < utterClips.length; i++) {
      const uc = utterClips[i];
      const speakerClip = uc.clipPath;
      const speakerDur = uc.duration;
      const isAspeaking = uc.speakerId === spA.id;
      const silent = isAspeaking ? spB : spA;
      const silentImg = speakerMap.get(silent.id).imgFilePath;
      if (!silentImg || !fs.existsSync(silentImg)) throw new Error(`speaker ${silent.id} 无图片文件`);

      const utterDir = path.dirname(speakerClip);
      // 生成静态填充视频（匹配时长）
      const silentVideoPath = path.join(utterDir, 'silent_fill.mp4');
      _imageToStaticVideo(ffmpegPath, silentImg, Math.ceil(speakerDur), silentVideoPath, `${halfW}x${h}`);

      // 把 speaker 视频 scale 到半宽，hstack（注意顺序：A 左 B 右）
      const composedPath = path.join(utterDir, 'hstack.mp4');
      const leftVid = isAspeaking ? speakerClip : silentVideoPath;
      const rightVid = isAspeaking ? silentVideoPath : speakerClip;
      // 左右都 scale 到 halfW x h，再 hstack
      const cmd = `"${ffmpegPath}" -i "${leftVid}" -i "${rightVid}" ` +
        `-filter_complex "[0:v]scale=${halfW}:${h}:force_original_aspect_ratio=increase,crop=${halfW}:${h},setsar=1[l];` +
        `[1:v]scale=${halfW}:${h}:force_original_aspect_ratio=increase,crop=${halfW}:${h},setsar=1[r];` +
        `[l][r]hstack=inputs=2[v]" ` +
        `-map "[v]" -map ${isAspeaking ? '0' : '1'}:a? -c:v libx264 -preset fast -crf 22 -c:a aac -b:a 128k -pix_fmt yuv420p -r 24 -t ${Math.ceil(speakerDur)} -y "${composedPath}"`;
      execSync(cmd, { timeout: 120000, stdio: 'pipe' });

      composedClips.push({ clipPath: composedPath, duration: speakerDur, transition: uc.transition });
    }
    await _concatWithXfade(ffmpegPath, composedClips, finalPath);
  } else {
    throw new Error(`未知 layout: ${layout}（仅支持 cut-to-speaker / side-by-side）`);
  }

  // 保存元数据
  fs.writeFileSync(path.join(taskDir, 'multispeaker.json'), JSON.stringify({ speakers: speakers.map(s => ({ id: s.id, name: s.name })), dialogue, layout, ratio }, null, 2));

  console.log(`[Avatar] 多人对话完成: ${dialogue.length} 发言, ${(fs.statSync(finalPath).size / 1024 / 1024).toFixed(1)}MB`);
  return { taskDir, videoPath: finalPath };
}

/**
 * 把多个 clip 用 xfade 串起来 (共享实现)
 */
async function _concatWithXfade(ffmpegPath, clips, outPath) {
  const { execSync } = require('child_process');
  if (clips.length === 1) { fs.copyFileSync(clips[0].clipPath, outPath); return; }

  const XFADE_DUR = 0.5;
  const inputArgs = clips.map(c => `-i "${c.clipPath}"`).join(' ');
  const durations = clips.map(c => c.duration || _probeDuration(ffmpegPath, c.clipPath, 5));
  let filterComplex = '';
  let vLabel = '[0:v]', aLabel = '[0:a]';
  let offset = durations[0] - XFADE_DUR;
  for (let i = 1; i < clips.length; i++) {
    const outV = i < clips.length - 1 ? `[xv${i}]` : '[outv]';
    const outA = i < clips.length - 1 ? `[xa${i}]` : '[outa]';
    filterComplex += `${vLabel}[${i}:v]xfade=transition=fade:duration=${XFADE_DUR}:offset=${Math.max(0, offset).toFixed(2)}${outV};`;
    filterComplex += `${aLabel}[${i}:a]acrossfade=d=${XFADE_DUR}${outA};`;
    vLabel = outV; aLabel = outA;
    offset += durations[i] - XFADE_DUR;
  }
  filterComplex = filterComplex.replace(/;$/, '');

  try {
    execSync(`"${ffmpegPath}" ${inputArgs} -filter_complex "${filterComplex}" -map "[outv]" -map "[outa]" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart -y "${outPath}"`, { timeout: 600000, stdio: 'pipe' });
  } catch {
    // 回退 concat demuxer（无 xfade）
    const concatFile = path.join(path.dirname(outPath), 'concat_fallback.txt');
    fs.writeFileSync(concatFile, clips.map(c => `file '${c.clipPath.replace(/\\/g, '/')}'`).join('\n'));
    execSync(`"${ffmpegPath}" -f concat -safe 0 -i "${concatFile}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart -y "${outPath}"`, { timeout: 600000, stdio: 'pipe' });
  }
}

module.exports = {
  generateAvatarVideo,
  generateMultiSegmentVideo,
  generateMultiSceneVideo,
  generateMultiSpeakerScene,
  agentStoryboard,
  agentEmotionCurve,
  agentSmartCameraShots,
  applyCameraMove,
  generateMultiAngleReferenceSet,
  _bodyFramePromptHint,
  _pickAngleForShot,
  BODY_FRAMES,
  // 全身扩图（outpainting）— Omni 配 full_body 用
  generateFullBodyOutpaint,
  // 直接调 Ark Seedream 5.0（带 watermark=false + 可选裁底）
  _arkSeedreamGenerate,
  // Seedance / 火山方舟
  isSeedanceModel,
  isSeedanceAVModel,
  getArkKey,
  _seedanceAVGenerate,
  SEEDANCE_AV_MODELS,
  SEEDANCE_VIDEO_MODELS,
};
