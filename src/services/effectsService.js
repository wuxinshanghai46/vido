/**
 * 视频后期特效服务 — 带货/口播视频专业后期处理
 *
 * 支持：花字/动态字幕、价格标签、产品图片叠加、指引动画、BGM混音
 * 全部通过 FFmpeg filter_complex 实现
 */
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const ffmpegPath = (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== 'ffmpeg')
  ? process.env.FFMPEG_PATH
  : ffmpegStatic;
ffmpeg.setFfmpegPath(ffmpegPath);
try { const ffprobeStatic = require('ffprobe-static'); ffmpeg.setFfprobePath(ffprobeStatic.path); } catch {}


const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');
const EFFECTS_DIR = path.join(OUTPUT_DIR, 'effects');
const ASSETS_DIR = path.join(OUTPUT_DIR, 'effects_assets');

// 确保目录存在
[EFFECTS_DIR, ASSETS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ═══ 字体查找 ═══
const FONT_CANDIDATES = [
  'C:/Windows/Fonts/msyh.ttc',
  'C:/Windows/Fonts/msyhbd.ttc',
  'C:/Windows/Fonts/simhei.ttf',
  'C:/Windows/Fonts/simsun.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
];
const FONT_FILE = FONT_CANDIDATES.find(f => fs.existsSync(f)) || '';
const FONT_BOLD_CANDIDATES = [
  'C:/Windows/Fonts/msyhbd.ttc',
  'C:/Windows/Fonts/simhei.ttf',
  FONT_FILE
];
const FONT_BOLD = FONT_BOLD_CANDIDATES.find(f => f && fs.existsSync(f)) || FONT_FILE;

function fontOpt(bold = false) {
  const f = bold ? FONT_BOLD : FONT_FILE;
  return f ? `fontfile='${f.replace(/\\/g, '/')}'` : '';
}

// ═══ 花字预设样式 ═══
const TEXT_PRESETS = {
  // 标题花字 — 大号、描边、阴影
  title: {
    fontSize: 54, fontcolor: 'white', borderw: 3, bordercolor: 'black',
    shadowcolor: 'black@0.7', shadowx: 3, shadowy: 3, bold: true
  },
  // 价格标签 — 红色大号
  price: {
    fontSize: 72, fontcolor: '#FF2D55', borderw: 4, bordercolor: 'white',
    shadowcolor: 'black@0.5', shadowx: 2, shadowy: 2, bold: true
  },
  // 促销信息 — 黄色
  promo: {
    fontSize: 42, fontcolor: '#FFD600', borderw: 3, bordercolor: '#CC0000',
    shadowcolor: 'black@0.6', shadowx: 2, shadowy: 2, bold: true
  },
  // 普通字幕
  subtitle: {
    fontSize: 32, fontcolor: 'white', borderw: 0, bordercolor: 'black',
    box: true, boxcolor: 'black@0.5', boxborderw: 8,
    shadowcolor: 'black@0.4', shadowx: 1, shadowy: 1, bold: false
  },
  // 强调文字 — 青色描边
  emphasis: {
    fontSize: 48, fontcolor: '#21FFF3', borderw: 3, bordercolor: '#0a0a0a',
    shadowcolor: 'black@0.6', shadowx: 2, shadowy: 2, bold: true
  },
  // 弹幕风格
  danmaku: {
    fontSize: 28, fontcolor: 'white', borderw: 1, bordercolor: 'black@0.8',
    shadowcolor: 'black@0.3', shadowx: 1, shadowy: 1, bold: false
  }
};

// ═══ 指引动画预设（使用 drawtext 模拟）═══
const POINTER_CHARS = {
  arrow_down: '👇',
  arrow_up: '👆',
  arrow_right: '👉',
  arrow_left: '👈',
  finger_point: '☝️',
  fire: '🔥',
  star: '⭐',
  sparkle: '✨',
  lightning: '⚡',
  gift: '🎁',
  cart: '🛒',
  money: '💰',
  hot: '🔥限时',
  click: '👆点击',
};

/**
 * 获取视频时长
 */
function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration || 10);
    });
  });
}

/**
 * 获取视频尺寸
 */
function getVideoInfo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const vs = metadata.streams.find(s => s.codec_type === 'video');
      resolve({
        width: vs?.width || 1920,
        height: vs?.height || 1080,
        duration: metadata.format.duration || 10,
        hasAudio: metadata.streams.some(s => s.codec_type === 'audio')
      });
    });
  });
}

/**
 * 安全处理文本，确保 FFmpeg drawtext 不会报错
 */
function safeText(text) {
  return (text || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%')
    .replace(/\n/g, ' ');
}

/**
 * 构建单个 drawtext 滤镜字符串
 */
function buildDrawText(cfg) {
  const preset = TEXT_PRESETS[cfg.preset] || TEXT_PRESETS.subtitle;
  const fontSize = cfg.fontSize || preset.fontSize;
  const parts = [];

  // 字体
  const fo = fontOpt(cfg.bold ?? preset.bold);
  if (fo) parts.push(fo);

  // 文本
  parts.push(`text='${safeText(cfg.text)}'`);
  parts.push(`fontsize=${fontSize}`);
  parts.push(`fontcolor=${cfg.fontcolor || preset.fontcolor}`);

  // 描边
  const bw = cfg.borderw ?? preset.borderw;
  if (bw > 0) {
    parts.push(`borderw=${bw}`);
    parts.push(`bordercolor=${cfg.bordercolor || preset.bordercolor}`);
  }

  // 背景框
  if (cfg.box || preset.box) {
    parts.push(`box=1`);
    parts.push(`boxcolor=${cfg.boxcolor || preset.boxcolor || 'black@0.5'}`);
    parts.push(`boxborderw=${cfg.boxborderw || preset.boxborderw || 6}`);
  }

  // 阴影
  parts.push(`shadowcolor=${cfg.shadowcolor || preset.shadowcolor || 'black@0.5'}`);
  parts.push(`shadowx=${cfg.shadowx ?? preset.shadowx ?? 2}`);
  parts.push(`shadowy=${cfg.shadowy ?? preset.shadowy ?? 2}`);

  // 位置
  const pos = cfg.position || 'center';
  let xExpr, yExpr;
  if (cfg.x != null && cfg.y != null) {
    // 百分比或绝对值
    xExpr = String(cfg.x).includes('%') ? `(w*${parseInt(cfg.x)}/100-text_w/2)` : String(cfg.x);
    yExpr = String(cfg.y).includes('%') ? `(h*${parseInt(cfg.y)}/100-text_h/2)` : String(cfg.y);
  } else {
    switch (pos) {
      case 'top':         xExpr = '(w-text_w)/2'; yExpr = '60';                break;
      case 'top-left':    xExpr = '40';            yExpr = '60';                break;
      case 'top-right':   xExpr = '(w-text_w-40)'; yExpr = '60';              break;
      case 'center':      xExpr = '(w-text_w)/2'; yExpr = '(h-text_h)/2';     break;
      case 'center-left': xExpr = '40';            yExpr = '(h-text_h)/2';     break;
      case 'center-right':xExpr = '(w-text_w-40)'; yExpr = '(h-text_h)/2';    break;
      case 'bottom':      xExpr = '(w-text_w)/2'; yExpr = `(h-text_h-80)`;    break;
      case 'bottom-left': xExpr = '40';            yExpr = `(h-text_h-80)`;    break;
      case 'bottom-right':xExpr = '(w-text_w-40)'; yExpr = `(h-text_h-80)`;   break;
      default:            xExpr = '(w-text_w)/2'; yExpr = '(h-text_h)/2';
    }
  }
  parts.push(`x=${xExpr}`);
  parts.push(`y=${yExpr}`);

  // 时间控制
  const start = cfg.startTime ?? 0;
  const end = cfg.endTime;
  if (end != null) {
    parts.push(`enable='between(t,${start},${end})'`);
  } else if (start > 0) {
    parts.push(`enable='gte(t,${start})'`);
  }

  return 'drawtext=' + parts.join(':');
}

/**
 * 构建指引动画滤镜（用 drawtext + emoji 实现闪烁/弹跳效果）
 */
function buildPointerFilter(cfg) {
  const char = POINTER_CHARS[cfg.icon] || cfg.icon || '👇';
  const fontSize = cfg.fontSize || 48;
  const x = cfg.x || '50%';
  const y = cfg.y || '70%';
  const start = cfg.startTime ?? 0;
  const end = cfg.endTime ?? 999;

  const xExpr = String(x).includes('%') ? `(w*${parseInt(x)}/100-text_w/2)` : String(x);
  // 弹跳效果：y 位置随时间上下偏移
  const baseY = String(y).includes('%') ? `(h*${parseInt(y)}/100)` : String(y);
  const yExpr = `${baseY}+sin(t*6)*12`;

  const parts = [];
  const fo = fontOpt(false);
  if (fo) parts.push(fo);
  parts.push(`text='${safeText(char)}'`);
  parts.push(`fontsize=${fontSize}`);
  parts.push(`fontcolor=white`);
  parts.push(`x=${xExpr}`);
  parts.push(`y=${yExpr}`);
  parts.push(`shadowcolor=black@0.5:shadowx=2:shadowy=2`);
  parts.push(`enable='between(t,${start},${end})'`);

  return 'drawtext=' + parts.join(':');
}

/**
 * 主函数：为视频应用后期特效
 *
 * @param {object} config
 * @param {string} config.videoPath - 输入视频路径
 * @param {Array}  config.texts - 文字特效数组 [{ text, preset, position, startTime, endTime, x, y, fontSize, fontcolor, ... }]
 * @param {Array}  config.images - 图片叠加数组 [{ path, x, y, width, height, startTime, endTime }]
 * @param {Array}  config.pointers - 指引动画数组 [{ icon, x, y, startTime, endTime, fontSize }]
 * @param {object} config.bgm - 背景音乐 { path, volume, fadeIn, fadeOut }
 * @param {function} config.onProgress - 进度回调
 * @returns {object} { outputPath, duration }
 */
async function applyEffects(config) {
  const {
    videoPath,
    texts = [],
    images = [],
    pointers = [],
    bgm = null,
    onProgress = () => {}
  } = config;

  if (!fs.existsSync(videoPath)) throw new Error('输入视频不存在: ' + videoPath);

  const videoInfo = await getVideoInfo(videoPath);
  const outputId = uuidv4().split('-')[0];
  const outputPath = path.join(EFFECTS_DIR, `fx_${outputId}.mp4`);

  onProgress({ step: 'analyzing', detail: '分析视频参数...', progress: 5 });

  // 如果没有任何特效，只做 BGM 混音或直接复制
  if (texts.length === 0 && images.length === 0 && pointers.length === 0 && !bgm) {
    fs.copyFileSync(videoPath, outputPath);
    return { outputPath, duration: videoInfo.duration };
  }

  // ═══ 构建 filter_complex ═══
  const filterParts = [];
  const inputFiles = [videoPath];
  let currentLabel = '0:v';

  // 步骤 1: 图片叠加（每个图片需要单独的 input）
  onProgress({ step: 'building', detail: '构建特效管线...', progress: 10 });

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (!img.path || !fs.existsSync(img.path)) continue;

    inputFiles.push(img.path);
    const inputIdx = inputFiles.length - 1;
    const nextLabel = `v_img${i}`;

    // 缩放图片到目标尺寸
    const imgW = img.width || 200;
    const imgH = img.height || 200;
    filterParts.push(`[${inputIdx}:v]scale=${imgW}:${imgH}[img${i}]`);

    // 叠加到视频
    const ox = img.x || 0;
    const oy = img.y || 0;
    const start = img.startTime ?? 0;
    const end = img.endTime ?? videoInfo.duration;
    // 弹入效果：前0.3秒从大到小缩放
    const enable = `between(t,${start},${end})`;
    filterParts.push(`[${currentLabel}][img${i}]overlay=x=${ox}:y=${oy}:enable='${enable}'[${nextLabel}]`);
    currentLabel = nextLabel;
  }

  // 步骤 2: 文字特效（drawtext 叠加）
  for (let i = 0; i < texts.length; i++) {
    const txt = texts[i];
    if (!txt.text) continue;
    const filter = buildDrawText(txt);
    const nextLabel = `v_txt${i}`;
    filterParts.push(`[${currentLabel}]${filter}[${nextLabel}]`);
    currentLabel = nextLabel;
  }

  // 步骤 3: 指引动画
  for (let i = 0; i < pointers.length; i++) {
    const ptr = pointers[i];
    const filter = buildPointerFilter(ptr);
    const nextLabel = `v_ptr${i}`;
    filterParts.push(`[${currentLabel}]${filter}[${nextLabel}]`);
    currentLabel = nextLabel;
  }

  // 最终视频输出标签
  const finalVideoLabel = currentLabel;

  // 步骤 4: BGM 混音
  let finalAudioLabel = null;
  if (bgm?.path && fs.existsSync(bgm.path)) {
    inputFiles.push(bgm.path);
    const bgmIdx = inputFiles.length - 1;
    const vol = bgm.volume ?? 0.3;
    const fadeIn = bgm.fadeIn ?? 1;
    const fadeOut = bgm.fadeOut ?? 2;
    const dur = videoInfo.duration;

    if (videoInfo.hasAudio) {
      // 混合原声 + BGM（先裁剪BGM到视频时长）
      filterParts.push(`[${bgmIdx}:a]atrim=0:${dur},asetpts=PTS-STARTPTS,volume=${vol},afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${Math.max(0, dur - fadeOut)}:d=${fadeOut}[bgm_a]`);
      filterParts.push(`[0:a][bgm_a]amix=inputs=2:duration=first:dropout_transition=2[a_out]`);
      finalAudioLabel = 'a_out';
    } else {
      // 没有原声，用 BGM（裁剪到视频时长）
      filterParts.push(`[${bgmIdx}:a]atrim=0:${dur},asetpts=PTS-STARTPTS,volume=${vol},afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${Math.max(0, dur - fadeOut)}:d=${fadeOut}[a_out]`);
      finalAudioLabel = 'a_out';
    }
  }

  onProgress({ step: 'processing', detail: '正在渲染特效...', progress: 30 });

  // ═══ 执行 FFmpeg ═══
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();

    // 添加所有输入文件
    inputFiles.forEach(f => cmd.input(f));

    // 构建 filter_complex
    if (filterParts.length > 0) {
      cmd.complexFilter(filterParts.join(';'));
    }

    // 输出映射
    const outputOpts = ['-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
    const videoChanged = finalVideoLabel !== '0:v'; // 视频是否经过 filter 处理

    if (filterParts.length > 0) {
      if (videoChanged) {
        outputOpts.push('-map', `[${finalVideoLabel}]`);
      } else {
        outputOpts.push('-map', '0:v');
      }
      if (finalAudioLabel) {
        outputOpts.push('-map', `[${finalAudioLabel}]`);
      } else if (videoInfo.hasAudio) {
        outputOpts.push('-map', '0:a?');
      }
      outputOpts.push('-c:a', 'aac', '-shortest');
    }

    cmd.outputOptions(outputOpts)
      .output(outputPath)
      .on('progress', (p) => {
        const pct = p.percent ? Math.min(90, 30 + p.percent * 0.6) : 50;
        onProgress({ step: 'rendering', detail: `渲染中 ${Math.round(pct)}%`, progress: Math.round(pct) });
      })
      .on('end', () => {
        onProgress({ step: 'done', detail: '特效渲染完成', progress: 100 });
        resolve({ outputPath, duration: videoInfo.duration });
      })
      .on('error', (err) => {
        console.error('[Effects] FFmpeg 错误:', err.message);
        reject(new Error('特效渲染失败: ' + err.message));
      })
      .run();
  });
}

/**
 * 快捷方式：应用带货视频模板
 * 自动添加标题花字 + 价格标签 + 促销文字 + 指引动画
 */
async function applyEcommerceTemplate(config) {
  const {
    videoPath,
    title = '',
    price = '',
    promo = '',
    productImage = '',
    bgmPath = '',
    onProgress = () => {}
  } = config;

  const videoInfo = await getVideoInfo(videoPath);
  const dur = videoInfo.duration;

  const texts = [];
  const images = [];
  const pointers = [];

  // 标题花字（前半段显示）
  if (title) {
    texts.push({
      text: title, preset: 'title',
      position: 'top', startTime: 0.5, endTime: Math.min(dur - 1, dur * 0.6)
    });
  }

  // 价格标签（中段出现）
  if (price) {
    const priceStart = dur * 0.25;
    texts.push({
      text: price.startsWith('¥') ? price : `¥${price}`,
      preset: 'price',
      position: 'center-right',
      startTime: priceStart, endTime: dur - 1
    });
    // 价格旁边的火焰指引
    pointers.push({
      icon: 'fire', x: '80%', y: '45%',
      startTime: priceStart + 0.3, endTime: dur - 1,
      fontSize: 40
    });
  }

  // 促销文字（后半段出现）
  if (promo) {
    texts.push({
      text: promo, preset: 'promo',
      position: 'bottom',
      startTime: dur * 0.4, endTime: dur - 0.5
    });
  }

  // 产品图片叠加
  if (productImage && fs.existsSync(productImage)) {
    images.push({
      path: productImage,
      x: Math.round(videoInfo.width * 0.05),
      y: Math.round(videoInfo.height * 0.15),
      width: Math.round(videoInfo.width * 0.35),
      height: Math.round(videoInfo.height * 0.35),
      startTime: dur * 0.2, endTime: dur * 0.8
    });
  }

  // 底部购物指引
  pointers.push({
    icon: 'cart', x: '50%', y: '88%',
    startTime: dur * 0.5, endTime: dur - 0.5,
    fontSize: 36
  });

  const bgm = bgmPath && fs.existsSync(bgmPath) ? { path: bgmPath, volume: 0.25, fadeIn: 1, fadeOut: 2 } : null;

  return applyEffects({ videoPath, texts, images, pointers, bgm, onProgress });
}

// 导出预设信息供前端使用
function getPresetsInfo() {
  return {
    textPresets: Object.entries(TEXT_PRESETS).map(([id, p]) => ({
      id, name: { title: '标题花字', price: '价格标签', promo: '促销信息', subtitle: '普通字幕', emphasis: '强调文字', danmaku: '弹幕风格' }[id] || id,
      fontSize: p.fontSize, fontcolor: p.fontcolor
    })),
    pointerIcons: Object.entries(POINTER_CHARS).map(([id, char]) => ({ id, char, name: id })),
    positions: ['top', 'top-left', 'top-right', 'center', 'center-left', 'center-right', 'bottom', 'bottom-left', 'bottom-right']
  };
}

module.exports = { applyEffects, applyEcommerceTemplate, getPresetsInfo, EFFECTS_DIR, ASSETS_DIR };
