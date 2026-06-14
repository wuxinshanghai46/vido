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
const { execFileSync } = require('child_process');
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
// 项目自带 NotoSansSC 是首选 — 保证 Windows/Linux 烧字幕一致；不需依赖系统字体
const FONT_CANDIDATES = [
  // 项目自带（优先：保证跨平台一致）
  path.resolve(__dirname, '../../public/fonts/NotoSansSC-Regular.otf'),
  path.resolve(__dirname, '../../public/fonts/NotoSansSC-Regular.ttf'),
  path.resolve(__dirname, '../../public/fonts/SourceHanSansCN-Regular.otf'),
  // Windows
  'C:/Windows/Fonts/msyh.ttc',
  'C:/Windows/Fonts/msyhbd.ttc',
  'C:/Windows/Fonts/simhei.ttf',
  'C:/Windows/Fonts/simsun.ttc',
  // Linux Noto
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc',
  // Linux 文泉驿（常见发行版默认中文字体）
  '/usr/share/fonts/wqy-microhei/wqy-microhei.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
  '/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  // 思源黑体（CentOS/RHEL 等常装）
  '/usr/share/fonts/opentype/source-han-sans/SourceHanSansCN-Regular.otf',
  '/usr/share/fonts/adobe-source-han-sans/SourceHanSansCN-Regular.otf',
  // macOS
  '/System/Library/Fonts/PingFang.ttc',
  '/System/Library/Fonts/STHeiti Medium.ttc',
];
const FONT_FILE = FONT_CANDIDATES.find(f => f && fs.existsSync(f)) || '';
const FONT_BOLD_CANDIDATES = [
  path.resolve(__dirname, '../../public/fonts/NotoSansSC-Bold.otf'),
  path.resolve(__dirname, '../../public/fonts/NotoSansSC-Bold.ttf'),
  'C:/Windows/Fonts/msyhbd.ttc',
  'C:/Windows/Fonts/simhei.ttf',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
  FONT_FILE
];
const FONT_BOLD = FONT_BOLD_CANDIDATES.find(f => f && fs.existsSync(f)) || FONT_FILE;
const FONT_NAME_CANDIDATES = {
  '抖音美好体': [
    'C:/Windows/Fonts/msyhbd.ttc',
    'C:/Windows/Fonts/simhei.ttf',
    path.resolve(__dirname, '../../public/fonts/NotoSansSC-Bold.otf'),
    path.resolve(__dirname, '../../public/fonts/NotoSansSC-Bold.ttf'),
  ],
  '思源黑体': [
    path.resolve(__dirname, '../../public/fonts/NotoSansSC-Bold.otf'),
    path.resolve(__dirname, '../../public/fonts/NotoSansSC-Bold.ttf'),
    'C:/Windows/Fonts/msyhbd.ttc',
    'C:/Windows/Fonts/simhei.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc',
  ],
  '微软雅黑': ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/msyhbd.ttc'],
  'Noto Sans SC': [
    path.resolve(__dirname, '../../public/fonts/NotoSansSC-Regular.otf'),
    path.resolve(__dirname, '../../public/fonts/NotoSansSC-Regular.ttf'),
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  ],
  '宋体': ['C:/Windows/Fonts/simsun.ttc', 'C:/Windows/Fonts/simsunb.ttf'],
  '黑体': ['C:/Windows/Fonts/simhei.ttf', 'C:/Windows/Fonts/msyhbd.ttc'],
};

// 启动时显式日志 — 生产环境缺字体会直接导致 drawtext 渲染中文失败，字幕不上视频
if (FONT_FILE) {
  console.log(`[effectsService] 中文字体已就绪: ${FONT_FILE}`);
} else {
  console.error('[effectsService] ⚠️ 未找到中文字体！drawtext 渲染中文字幕会失败！');
  console.error('[effectsService] Linux 安装：apt install fonts-noto-cjk  (Debian/Ubuntu) 或 yum install google-noto-sans-cjk-fonts (CentOS/RHEL)');
  console.error('[effectsService] 或把字体文件放到 public/fonts/NotoSansSC-Regular.ttf');
}

function resolveFontFile(fontName, bold = false) {
  const requested = String(fontName || '').trim();
  const candidates = FONT_NAME_CANDIDATES[requested] || [];
  return candidates.find(f => f && fs.existsSync(f)) || (bold ? FONT_BOLD : FONT_FILE);
}

function fontOpt(bold = false, fontName = '') {
  const f = resolveFontFile(fontName, bold);
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
      if (err) {
        try {
          execFileSync(ffmpegPath, ['-hide_banner', '-i', filePath], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (probeErr) {
          const parsed = parseVideoInfoFromFfmpeg(`${probeErr.stdout || ''}\n${probeErr.stderr || ''}`);
          if (parsed.width && parsed.height) return resolve(parsed);
        }
        return reject(err);
      }
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

function parseVideoInfoFromFfmpeg(raw) {
  const text = String(raw || '');
  const dm = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  const vm = text.match(/Video:\s*[^,\n]+(?:,[^,\n]+)*,\s*(\d{2,5})x(\d{2,5})/i);
  return {
    width: vm ? Number(vm[1]) : 1080,
    height: vm ? Number(vm[2]) : 1920,
    duration: dm ? (Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3])) : 10,
    hasAudio: /Audio:/i.test(text),
  };
}

/**
 * 安全处理文本，确保 FFmpeg drawtext 不会报错
 */
function safeText(text) {
  return (text || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%')
    .replace(/\n/g, ' ');
}

function safeFilterPath(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
}

const FILTER_SUPPORT = {};
function hasFfmpegFilter(name) {
  if (FILTER_SUPPORT[name] !== undefined) return FILTER_SUPPORT[name];
  try {
    const out = execFileSync(ffmpegPath, ['-hide_banner', '-filters'], { encoding: 'utf8', timeout: 5000 });
    FILTER_SUPPORT[name] = new RegExp(`\\s${name}\\s`).test(out);
  } catch {
    FILTER_SUPPORT[name] = false;
  }
  return FILTER_SUPPORT[name];
}

function assTime(sec) {
  const n = Math.max(0, Number(sec) || 0);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = Math.floor(n % 60);
  const cs = Math.floor((n - Math.floor(n)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function assEscape(text) {
  return String(text || '')
    .replace(/\r?\n/g, '\\N')
    .replace(/[{}]/g, '');
}

function assColor(hex, fallback = '#FFFFFF') {
  const s = String(hex || fallback).trim();
  const m = s.match(/^#?([0-9a-f]{6})/i);
  if (!m) return '&H00FFFFFF';
  const v = m[1];
  return `&H00${v.slice(4, 6)}${v.slice(2, 4)}${v.slice(0, 2)}`.toUpperCase();
}

function assAlignment(position) {
  return ({
    top: 8, 'top-center': 8, 'top-left': 7, 'top-right': 9,
    center: 5, 'center-left': 4, 'center-right': 6,
    bottom: 2, 'bottom-center': 2, 'bottom-left': 1, 'bottom-right': 3,
  })[position || 'bottom'] || 2;
}

function visualTextWidth(text) {
  return Array.from(String(text || '')).reduce((sum, ch) => {
    const code = ch.codePointAt(0) || 0;
    if (/\s/.test(ch)) return sum + 0.35;
    return sum + (code > 255 ? 1 : 0.58);
  }, 0);
}

function wrapAssText(text, maxUnits, maxLines = 2) {
  const raw = String(text || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const chars = Array.from(raw);
  const lines = [];
  let line = '';
  for (let idx = 0; idx < chars.length; idx++) {
    const ch = chars[idx];
    const next = line + ch;
    if (line && visualTextWidth(next) > maxUnits) {
      lines.push(line.trim());
      line = ch;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line.trim());
  if (lines.length <= maxLines) return lines.join('\\N');
  const head = lines.slice(0, maxLines - 1);
  const tail = lines.slice(maxLines - 1).join('');
  return [...head, tail].join('\\N');
}

// ═══ 字幕动效预设 ═══
// 抖音/小红书/TikTok 风格的多样化字幕。每个 preset 决定 ASS Style + Dialogue 的动画 override。
// anim 字段：原生 ASS override 字符串（不带 {}），或特殊标记 '__karaoke__' / '__emphasis__'。
// fontSize/position/borderStyle/borderw 是该风格的"美学默认"，调用方仍可单独覆盖。
const SUBTITLE_STYLE_PRESETS = {
  classic: {
    label: '经典 静态',
    primary: '#FFFFFF', secondary: '#FFFFFF', outline: '#000000', back: '#80000000',
    borderStyle: 1, borderw: 3, shadow: 1, position: 'bottom', fontSizeFactor: 1.0,
    bold: true, anim: '',
  },
  popup: {
    label: '弹跳出现 · 短视频主流',
    primary: '#FFFFFF', secondary: '#FFFFFF', outline: '#000000', back: '#80000000',
    borderStyle: 1, borderw: 4, shadow: 2, position: 'bottom', fontSizeFactor: 1.05,
    bold: true,
    anim: '\\fad(120,80)\\fscx72\\fscy72\\t(0,180,\\fscx108\\fscy108)\\t(180,320,\\fscx100\\fscy100)',
  },
  bouncy: {
    label: '律动跳字 · 节奏感',
    primary: '#FFE600', secondary: '#FFE600', outline: '#000000', back: '#80000000',
    borderStyle: 1, borderw: 4, shadow: 2, position: 'bottom', fontSizeFactor: 1.05,
    bold: true,
    anim: '\\fad(100,80)\\frz-2\\fscx88\\fscy88\\t(0,200,\\frz2\\fscx106\\fscy106)\\t(200,420,\\frz0\\fscx100\\fscy100)',
  },
  karaoke: {
    label: '卡拉OK · 逐字高亮',
    primary: '#FFE600', secondary: '#FFFFFF', outline: '#000000', back: '#80000000',
    borderStyle: 1, borderw: 4, shadow: 1, position: 'bottom', fontSizeFactor: 1.0,
    bold: true, anim: '__karaoke__',
  },
  neon: {
    label: '霓虹发光 · 赛博风',
    primary: '#21FFF3', secondary: '#21FFF3', outline: '#9933FF', back: '#809933FF',
    borderStyle: 1, borderw: 5, shadow: 8, position: 'bottom', fontSizeFactor: 1.05,
    bold: true,
    anim: '\\fad(120,120)\\bord5\\shad8',
  },
  comic: {
    label: '漫画黄底黑字 · 综艺感',
    primary: '#000000', secondary: '#000000', outline: '#FFE600', back: '#FFE600',
    borderStyle: 3, borderw: 8, shadow: 0, position: 'top', fontSizeFactor: 1.05,
    bold: true,
    anim: '\\fad(100,80)\\fscx88\\fscy88\\t(0,200,\\fscx106\\fscy106)\\t(200,360,\\fscx100\\fscy100)',
  },
  news: {
    label: '新闻条 · 黑底白字',
    primary: '#FFFFFF', secondary: '#FFFFFF', outline: '#000000', back: '#000000',
    borderStyle: 3, borderw: 0, shadow: 0, position: 'bottom', fontSizeFactor: 0.86,
    bold: false,
    anim: '\\fad(80,60)',
  },
  emphasis: {
    label: '关键词强调 · 自动放大数字/限时词',
    primary: '#FFFFFF', secondary: '#FFFFFF', outline: '#000000', back: '#80000000',
    borderStyle: 1, borderw: 4, shadow: 2, position: 'bottom', fontSizeFactor: 1.0,
    bold: true,
    anim: '__emphasis__',
  },
  fire: {
    label: '火焰燃烧 · 激情感',
    primary: '#FF6600', secondary: '#FF6600', outline: '#CC0000', back: '#80000000',
    borderStyle: 1, borderw: 5, shadow: 6, position: 'bottom', fontSizeFactor: 1.08,
    bold: true,
    anim: '\\fad(60,80)\\blur2\\bord5\\shad6\\fscx85\\fscy85\\t(0,200,\\fscx110\\fscy110\\blur0)\\t(200,380,\\fscx100\\fscy100)',
  },
  shake: {
    label: '地震抖动 · 紧张感',
    primary: '#FFFFFF', secondary: '#FFFFFF', outline: '#FF2200', back: '#80000000',
    borderStyle: 1, borderw: 4, shadow: 2, position: 'bottom', fontSizeFactor: 1.05,
    bold: true,
    anim: '\\fad(40,40)\\frz-1\\t(0,120,\\frz1)\\t(120,240,\\frz-0.5)\\t(240,360,\\frz0.5)\\t(360,480,\\frz0)',
  },
  gold: {
    label: '土豪金 · 奢华感',
    primary: '#FFD700', secondary: '#FFD700', outline: '#7A5800', back: '#80000000',
    borderStyle: 1, borderw: 5, shadow: 4, position: 'bottom', fontSizeFactor: 1.05,
    bold: true,
    anim: '\\fad(120,100)\\bord5\\shad4\\fscx80\\fscy80\\t(0,250,\\fscx104\\fscy104)\\t(250,400,\\fscx100\\fscy100)',
  },
  matrix: {
    label: '科技矩阵 · 未来感',
    primary: '#00FF41', secondary: '#00FF41', outline: '#004410', back: '#E6000000',
    borderStyle: 3, borderw: 0, shadow: 0, position: 'bottom', fontSizeFactor: 0.9,
    bold: false,
    anim: '\\fad(60,80)\\blur1',
  },
  film: {
    label: '电影字幕 · 大片感',
    primary: '#FFFFFF', secondary: '#FFFFFF', outline: '#000000', back: '#D9000000',
    borderStyle: 3, borderw: 0, shadow: 0, position: 'bottom', fontSizeFactor: 0.88,
    bold: false,
    anim: '\\fad(250,200)',
  },
  pink: {
    label: '少女粉 · 生活感',
    primary: '#FF69B4', secondary: '#FF69B4', outline: '#7B1D54', back: '#80000000',
    borderStyle: 1, borderw: 3, shadow: 2, position: 'bottom', fontSizeFactor: 1.0,
    bold: true,
    anim: '\\fad(100,80)\\fscx88\\fscy88\\t(0,200,\\fscx108\\fscy108)\\t(200,360,\\fscx100\\fscy100)',
  },
  wave: {
    label: '波浪摇摆 · 活力感',
    primary: '#FFFFFF', secondary: '#FFFFFF', outline: '#000080', back: '#80000000',
    borderStyle: 1, borderw: 4, shadow: 2, position: 'bottom', fontSizeFactor: 1.0,
    bold: true,
    anim: '\\fad(80,60)\\frz-3\\t(0,160,\\frz3)\\t(160,320,\\frz-2)\\t(320,480,\\frz0)',
  },
  zoom: {
    label: '冲击放大 · 爆款感',
    primary: '#FFFFFF', secondary: '#FFFFFF', outline: '#000000', back: '#80000000',
    borderStyle: 1, borderw: 5, shadow: 3, position: 'bottom', fontSizeFactor: 1.1,
    bold: true,
    anim: '\\fad(40,120)\\fscx150\\fscy150\\t(0,250,\\fscx100\\fscy100)',
  },
};

// 智能高亮：数字/价格、限时/促销词、重点指令词
const KEYWORD_EMPHASIS_REGEX = /(\d+(?:\.\d+)?(?:[%‰元块折天日时分秒倍亿万千百件个款套包种]|小时|平方米|公里|公斤|分钟)?|限时|特价|秒杀|必抢|必看|必备|爆款|超值|赠送|最后|记住|重点|划重点|今天|新品|首发|包邮|福利|优惠|折扣|低至|仅需|直降|限量|限购|首单|0元|免费|送你|赶紧|马上|立刻|注意|警告|不要|千万)/g;

const _KARA_NL = '';

function applyKaraokeMarkup(escapedText, durSec) {
  const text = escapedText.replace(/\\N/g, _KARA_NL);
  const chars = Array.from(text);
  const realChars = chars.filter(c => c !== _KARA_NL && c.trim().length > 0);
  const cs = Math.max(2, Math.round((Math.max(0.8, durSec) * 100) / Math.max(1, realChars.length)));
  return chars.map(c => {
    if (c === _KARA_NL) return '\\N';
    if (c.trim().length === 0) return c; // 空格不加 \kf
    return `{\\kf${cs}}${c}`;
  }).join('');
}

function applyKeywordEmphasisMarkup(escapedText) {
  // 把关键词替换为放大 + 黄色 + 粗描边，结尾 \r 重置回 Style 默认
  return escapedText.replace(KEYWORD_EMPHASIS_REGEX, (m) =>
    `{\\c&H00FFFF&\\3c&H0000C8&\\bord6\\fscx118\\fscy118}${m}{\\r}`
  );
}

function buildAssSubtitleFile(texts, outputId, videoInfo, opts = {}) {
  const assPath = path.join(EFFECTS_DIR, `sub_${outputId}.ass`);
  const playResX = Math.max(1, Math.round(videoInfo.width || 1080));
  const playResY = Math.max(1, Math.round(videoInfo.height || 1920));
  const defaultStyleKey = opts.defaultStyle || 'popup';
  const styles = [];
  const events = [];

  texts.forEach((txt, i) => {
    if (!txt?.text) return;
    const preset = TEXT_PRESETS[txt.preset] || TEXT_PRESETS.subtitle;
    const style = `S${i}`;
    const isSubtitle = (txt.preset || txt.style || '') === 'subtitle';

    // 解析字幕动效 preset：txt.subtitleStyle > 全局 default > 'classic'
    const styleKey = (typeof txt.subtitleStyle === 'string' && SUBTITLE_STYLE_PRESETS[txt.subtitleStyle])
      ? txt.subtitleStyle
      : (SUBTITLE_STYLE_PRESETS[defaultStyleKey] ? defaultStyleKey : 'classic');
    const sp = SUBTITLE_STYLE_PRESETS[styleKey];
    const factor = isSubtitle ? (sp.fontSizeFactor || 1.0) : 1.0;
    const smartEmphasis = txt.smartEmphasis === true && styleKey !== 'karaoke' && styleKey !== 'emphasis';

    // position：style 的位置优先（comic 默认 top），用户显式给 txt.position 时仍允许覆盖
    const pos = isSubtitle ? String(txt.position || sp.position || 'bottom') : String(txt.position || 'bottom');
    const marginL = Math.max(28, Math.round(playResX * 0.055));
    const marginR = marginL;
    const maxLines = isSubtitle ? 2 : 2;
    const usableTextWidth = Math.max(120, playResX - marginL - marginR);
    const maxSubtitleSize = Math.max(26, Math.min(Math.round(playResX * 0.064), Math.round(playResY * 0.044)));
    const requestedFontSize = Math.round(Number(txt.fontSize || preset.fontSize || 56) * factor);
    const totalUnits = Math.max(1, visualTextWidth(txt.text));
    const fitFontSize = Math.floor(usableTextWidth / ((totalUnits / maxLines) * 0.92));
    const fontSize = isSubtitle
      ? Math.max(24, Math.min(requestedFontSize, maxSubtitleSize, fitFontSize || maxSubtitleSize))
      : requestedFontSize;
    const borderw = isSubtitle
      ? Number(txt.borderw ?? sp.borderw ?? preset.borderw ?? 3)
      : Number(txt.borderw ?? preset.borderw ?? 3);
    const alignment = assAlignment(pos);
    const styleBold = isSubtitle ? (txt.bold ?? sp.bold ?? preset.bold) : (txt.bold ?? preset.bold);
    const fontName = txt.fontName || (styleBold ? 'Noto Sans SC Bold' : 'Noto Sans SC');
    const marginV = /bottom/.test(pos)
      ? Math.max(44, Math.round(playResY * 0.075))
      : /top/.test(pos)
        ? Math.max(42, Math.round(playResY * 0.055))
        : Math.max(10, Math.round(playResY * 0.02));
    const maxTextUnits = Math.max(8, (playResX - marginL - marginR) / (fontSize * 0.92));

    // 文本：包行 → escape (去掉用户的 {}) → 应用动效（karaoke/emphasis 改文本，其它前缀 anim）
    const wrapped = isSubtitle ? wrapAssText(txt.text, maxTextUnits, maxLines) : String(txt.text || '');
    let dialogueText = assEscape(wrapped);
    if (isSubtitle) {
      const dur = Math.max(0.4, Number(txt.endTime ?? 0) - Number(txt.startTime ?? 0));
      if (sp.anim === '__karaoke__') {
        dialogueText = applyKaraokeMarkup(dialogueText, dur);
      } else if (sp.anim === '__emphasis__') {
        dialogueText = applyKeywordEmphasisMarkup(dialogueText);
      } else {
        if (smartEmphasis) dialogueText = applyKeywordEmphasisMarkup(dialogueText);
        if (sp.anim) dialogueText = `{${sp.anim}}${dialogueText}`;
      }
    }

    // Style 颜色优先级：
    //   字幕(isSubtitle)：用户 fontcolor > 字幕风格 sp.primary > 通用 preset.fontcolor > 兜底白
    //   非字幕：用户 fontcolor > 通用 preset.fontcolor > 兜底白
    // ⚠ 不能让 'white'/'black' 这种命名色冒充 hex（assColor 只认 #RRGGBB）— 字幕路径必须先看 sp.primary
    const primaryColor = isSubtitle
      ? assColor(txt.fontcolor || sp.primary || preset.fontcolor || '#FFFFFF')
      : assColor(txt.fontcolor || preset.fontcolor || '#FFFFFF');
    const secondaryColor = assColor(isSubtitle ? (sp.secondary || '#FFFFFF') : '#FFFFFF');
    const outlineColor = isSubtitle
      ? assColor(txt.bordercolor || sp.outline || preset.bordercolor || '#000000')
      : assColor(txt.bordercolor || preset.bordercolor || '#000000');
    // BackColour 支持 #RRGGBB 或 #AARRGGBB（前两位是 alpha 透明度，FF=完全透明，00=不透明）
    const backHex = isSubtitle ? sp.back : '#80000000';
    let backColor = '&H7F000000';
    if (typeof backHex === 'string') {
      const m8 = backHex.match(/^#?([0-9a-f]{8})$/i);
      const m6 = backHex.match(/^#?([0-9a-f]{6})$/i);
      if (m8) {
        const v = m8[1];
        backColor = `&H${v.slice(0, 2)}${v.slice(6, 8)}${v.slice(4, 6)}${v.slice(2, 4)}`.toUpperCase();
      } else if (m6) {
        const v = m6[1];
        backColor = `&H80${v.slice(4, 6)}${v.slice(2, 4)}${v.slice(0, 2)}`.toUpperCase();
      }
    }
    const borderStyle = isSubtitle ? (sp.borderStyle || 1) : 1;
    const shadow = isSubtitle ? (sp.shadow ?? 1) : 1;

    styles.push([
      `Style: ${style}`, fontName, fontSize,
      primaryColor, secondaryColor, outlineColor, backColor,
      styleBold ? -1 : 0, 0, 0, 0, 100, 100, 0, 0,
      borderStyle, borderw, shadow, alignment, marginL, marginR, marginV, 1,
    ].join(','));
    const start = txt.startTime ?? 0;
    const end = txt.endTime ?? videoInfo.duration ?? 999;
    events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},${style},,0,0,0,,${dialogueText}`);
  });

  const body = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
${styles.join('\n')}

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
${events.join('\n')}
`;
  fs.writeFileSync(assPath, body, 'utf8');
  return assPath;
}

/**
 * 构建单个 drawtext 滤镜字符串
 */
function buildDrawText(cfg) {
  const preset = TEXT_PRESETS[cfg.preset] || TEXT_PRESETS.subtitle;
  const fontSize = cfg.fontSize || preset.fontSize;
  const parts = [];

  // 字体
  const fo = fontOpt(cfg.bold ?? preset.bold, cfg.fontName);
  if (fo) parts.push(fo);

  // 文本：字幕优先使用 textfile，避免中文、标点、引号在 drawtext 中被错误解析
  if (cfg.textFile && fs.existsSync(cfg.textFile)) {
    parts.push(`textfile='${safeFilterPath(cfg.textFile)}'`);
  } else {
    parts.push(`text='${safeText(cfg.text)}'`);
  }
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
// ════════════════════════════════════════════════
// ASR 强制对齐：抽 audio → OpenAI Whisper → 拿带时间戳的 segments → 用作字幕
// 失败返回 null（让外层 fallback 字符密度重分配）
// ════════════════════════════════════════════════
async function _asrAlignSubtitles(videoPath, originalTexts, videoDur) {
  const { getApiKey } = require('./settingsService');
  const apiKey = getApiKey('openai') || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[Effects/ASR] 未配置 openai key，跳过 ASR 对齐');
    return null;
  }

  // 1) 抽 audio 成 mp3（小，传输快）
  const audioPath = path.join(EFFECTS_DIR, `asr_${uuidv4().split('-')[0]}.mp3`);
  await new Promise((resolve, reject) => {
    require('child_process').execFile(
      ffmpegPath,
      ['-i', videoPath, '-vn', '-acodec', 'libmp3lame', '-ar', '16000', '-ac', '1', '-b:a', '64k', '-y', audioPath],
      { timeout: 60000 },
      (err) => err ? reject(err) : resolve(),
    );
  });
  const audioStat = fs.statSync(audioPath);
  console.log(`[Effects/ASR] audio 抽取完成 ${(audioStat.size / 1024).toFixed(1)} KB, 时长 ${videoDur.toFixed(1)}s`);

  // 2) 调 OpenAI Whisper API
  const FormData = require('form-data');
  const fd = new FormData();
  fd.append('file', fs.createReadStream(audioPath));
  fd.append('model', 'whisper-1');
  fd.append('language', 'zh');
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'segment');

  const axios = require('axios');
  let r;
  try {
    r = await axios.post('https://api.openai.com/v1/audio/transcriptions', fd, {
      headers: { ...fd.getHeaders(), Authorization: 'Bearer ' + apiKey },
      timeout: 90000,
      maxContentLength: 60 * 1024 * 1024,
      maxBodyLength: 60 * 1024 * 1024,
    });
  } finally {
    try { fs.unlinkSync(audioPath); } catch {}
  }

  const segs = r.data?.segments || [];
  if (!segs.length) return null;

  // 3) 把 ASR segments 处理成字幕格式
  // ASR 每段可能很长（10-20 字），按句号/逗号再切一次让字幕节奏更好
  const splitLong = (text) => {
    const parts = String(text || '').split(/([。！？，、；])/).reduce((acc, cur, i, arr) => {
      if (i % 2 === 0) {
        const punct = arr[i + 1] || '';
        const piece = (cur + punct).trim();
        if (piece) acc.push(piece);
      }
      return acc;
    }, []);
    return parts.length ? parts : [String(text || '').trim()].filter(Boolean);
  };

  // 视觉提前量：ASR 识别滞后 30-80ms + 字幕样式 fade-in/缩放动画 100-200ms + HiFly lip-sync 模型固有偏差 100-150ms
  // = 总 350ms 视觉延迟。让 startTime 全部往前移 0.35s，字幕动画"完成可见"的瞬间 ≈ 真实嘴型/声音开始的时间
  // （2026-05-03 从 200ms 调到 350ms 以补偿 HiFly 模型口型滞后）
  const VISUAL_LEAD_MS = 0.35;
  const out = [];
  for (const seg of segs) {
    const start = Math.max(0, (Number(seg.start) || 0) - VISUAL_LEAD_MS);
    const end = Math.min(videoDur, Math.max(start + 0.3, (Number(seg.end) || (start + 1)) - VISUAL_LEAD_MS));
    const pieces = splitLong(seg.text);
    if (!pieces.length) continue;
    const segDur = end - start;
    const totalChars = pieces.reduce((s, p) => s + p.length, 0) || 1;
    let cursor = start;
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const portion = (piece.length / totalChars) * segDur;
      const ps = cursor;
      const pe = i === pieces.length - 1 ? end : Math.min(end, cursor + portion);
      out.push({ text: piece, startTime: ps, endTime: Math.max(ps + 0.3, pe) });
      cursor = pe;
    }
  }
  // 最后一段补到视频末尾
  if (out.length) out[out.length - 1].endTime = videoDur;
  return out;
}

async function applyEffects(config) {
  const {
    videoPath,
    texts = [],
    images = [],
    pointers = [],
    bgm = null,
    voiceVolume = 1,
    cameraMotion = 'static',
    cameraSegments = [],
    coverWatermark = false,
    // 字幕全局默认动效（'classic'|'popup'|'bouncy'|'karaoke'|'neon'|'comic'|'news'|'emphasis'）
    // 单个 text 上可设置 subtitleStyle 覆盖
    subtitleStyle = 'popup',
    // ASR 强制对齐字幕（抽视频 audio → Whisper 识别 → 用真实时间戳）
    asrAlign = false,
    onProgress = () => {}
  } = config;

  if (!fs.existsSync(videoPath)) throw new Error('输入视频不存在: ' + videoPath);

  const videoInfo = await getVideoInfo(videoPath);
  const outputId = uuidv4().split('-')[0];
  const outputPath = path.join(EFFECTS_DIR, `fx_${outputId}.mp4`);

  onProgress({ step: 'analyzing', detail: '分析视频参数...', progress: 5 });

  // ═══ 字幕/镜头时间戳校准 ═══
  // 三级策略（优先级从高到低）：
  //   ① ASR 强制对齐（asrAlign=true）：抽视频 audio 走 OpenAI Whisper 拿带时间戳的 segments，
  //      字幕和声音 word-level 对齐，最准。失败 fallback ②。
  //   ② 字符密度重分配：按"段文本字符数 / 总字符数 × 视频时长"重算每段 start/end。
  //   ③ 旧策略（线性整体 scale）：保段间比例不变。
  const _actualDur = Math.max(0.1, Number(videoInfo.duration) || 0);

  // ─── ① ASR 强制对齐 ───
  let _asrAligned = false;
  if (asrAlign && Array.isArray(texts) && texts.length && _actualDur > 1.0) {
    try {
      const aligned = await _asrAlignSubtitles(videoPath, texts, _actualDur);
      if (aligned && aligned.length) {
        const styleProto = texts[0] || {};
        texts.length = 0;
        for (const seg of aligned) {
          texts.push({ ...styleProto, ...seg });
        }
        _asrAligned = true;
        console.log(`[Effects] ASR 强制对齐成功 → ${texts.length} 段, 视频 ${_actualDur.toFixed(2)}s`);
      } else {
        console.warn('[Effects] ASR 对齐返回空，fallback 字符密度重分配');
      }
    } catch (asrErr) {
      console.warn('[Effects] ASR 对齐失败，fallback 字符密度重分配:', asrErr.message);
    }
  }

  // ─── ② 字符密度重分配（仅在没成功 ASR 对齐时跑）───
  if (!_asrAligned && Array.isArray(texts) && texts.length && _actualDur > 0.5) {
    const charWeight = (s) => {
      const str = String(s || '');
      let w = 0;
      for (const ch of str) {
        if (/\s/.test(ch)) continue;
        if (/[，。！？、；：,.\!?;:""''()（）【】\-—…]/.test(ch)) w += 0.5;
        else w += 1;
      }
      return w;
    };
    const weights = texts.map(t => charWeight(t?.text));
    const totalW = weights.reduce((a, b) => a + b, 0);
    if (totalW > 0.5) {
      // 留 0.3s 头缓冲（让字幕略晚于声音 0.3s 出现，符合阅读习惯）
      const headPad = Math.min(0.3, _actualDur * 0.05);
      const usableDur = Math.max(0.5, _actualDur - headPad);
      let cursor = headPad;
      texts.forEach((t, idx) => {
        if (!t) return;
        const portion = (weights[idx] / totalW) * usableDur;
        const s = cursor;
        const e = idx === texts.length - 1 ? _actualDur : Math.min(_actualDur, cursor + portion);
        t.startTime = s;
        t.endTime = Math.max(s + 0.3, e);
        cursor = e;
      });
      console.log(`[Effects] 字幕重分配: 视频 ${_actualDur.toFixed(2)}s, 总字符权重 ${totalW.toFixed(1)}, 段数 ${texts.length}`);
    }
  }
  // 同步缩放 cameraSegments
  if (Array.isArray(cameraSegments) && cameraSegments.length && _actualDur > 0.5) {
    const camLastEnd = cameraSegments.reduce((m, s) => Math.max(m, Number(s?.end ?? s?.endTime) || 0), 0);
    if (camLastEnd > 0.5 && Math.abs(camLastEnd - _actualDur) / _actualDur > 0.02) {
      const camScale = _actualDur / camLastEnd;
      cameraSegments.forEach((s) => {
        if (!s) return;
        s.start = Math.max(0, (Number(s.start ?? s.startTime) || 0) * camScale);
        s.end = Math.min(_actualDur, (Number(s.end ?? s.endTime) || 0) * camScale);
      });
    }
  }

  // 如果没有任何特效，只做 BGM 混音或直接复制
  if (texts.length === 0 && images.length === 0 && pointers.length === 0 && !bgm && !coverWatermark) {
    fs.copyFileSync(videoPath, outputPath);
    return { outputPath, duration: videoInfo.duration };
  }

  // ═══ 构建 filter_complex ═══
  const filterParts = [];
  const inputFiles = [videoPath];
  let currentLabel = '0:v';
  const videoW = Math.max(2, Math.round(videoInfo.width || 1080));
  const videoH = Math.max(2, Math.round(videoInfo.height || 1920));
  const videoDur = Math.max(0.1, Number(videoInfo.duration || 1));

  function cameraFilterChain(inputLabel, cam, dur, outLabel) {
    const d = Math.max(0.1, Number(dur || 1));
    if (cam === 'push_in' || cam === 'close_up') {
      return `[${inputLabel}]scale=w='iw*(1+0.14*t/${d})':h='ih*(1+0.14*t/${d})':eval=frame,crop=${videoW}:${videoH}:x='(iw-ow)/2':y='(ih-oh)/2',setsar=1[${outLabel}]`;
    }
    if (cam === 'pull_back') {
      return `[${inputLabel}]scale=w='iw*(1.14-0.14*t/${d})':h='ih*(1.14-0.14*t/${d})':eval=frame,crop=${videoW}:${videoH}:x='(iw-ow)/2':y='(ih-oh)/2',setsar=1[${outLabel}]`;
    }
    if (cam === 'pan_product') {
      return `[${inputLabel}]scale=w='iw*1.14':h='ih*1.14',crop=${videoW}:${videoH}:x='(iw-ow)*t/${d}':y='(ih-oh)/2',setsar=1[${outLabel}]`;
    }
    if (cam === 'handheld') {
      return `[${inputLabel}]scale=w='iw*1.08':h='ih*1.08',crop=${videoW}:${videoH}:x='(iw-ow)/2+sin(t*2.2)*14':y='(ih-oh)/2+cos(t*1.7)*10',setsar=1[${outLabel}]`;
    }
    filterParts.push(`[${inputLabel}]scale=${videoW}:${videoH},setsar=1[${outLabel}]`);
    return null;
  }

  const usableCameraSegments = (Array.isArray(cameraSegments) ? cameraSegments : [])
    .map(s => ({
      start: Math.max(0, Number(s.start ?? s.startTime ?? 0) || 0),
      end: Math.min(videoDur, Math.max(0, Number(s.end ?? s.endTime ?? 0) || 0)),
      camera: String(s.camera || s.cameraMotion || 'static'),
    }))
    .filter(s => s.end > s.start + 0.05)
    .sort((a, b) => a.start - b.start);

  if (usableCameraSegments.some(s => s.camera && s.camera !== 'static')) {
    const pieces = [];
    let cursor = 0;
    const addPiece = (start, end, cam, idx) => {
      const trimLabel = `v_cam_trim${idx}`;
      const outLabel = `v_cam_seg${idx}`;
      filterParts.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[${trimLabel}]`);
      const chain = cameraFilterChain(trimLabel, cam, end - start, outLabel);
      if (chain) filterParts.push(chain);
      pieces.push(outLabel);
    };
    let idx = 0;
    for (const seg of usableCameraSegments) {
      if (seg.start > cursor + 0.05) addPiece(cursor, seg.start, 'static', idx++);
      addPiece(seg.start, seg.end, seg.camera, idx++);
      cursor = Math.max(cursor, seg.end);
    }
    if (cursor < videoDur - 0.05) addPiece(cursor, videoDur, 'static', idx++);
    if (pieces.length > 1) {
      filterParts.push(`${pieces.map(p => `[${p}]`).join('')}concat=n=${pieces.length}:v=1:a=0[v_camera]`);
      currentLabel = 'v_camera';
    } else if (pieces.length === 1) {
      currentLabel = pieces[0];
    }
  } else {
    const cam = String(cameraMotion || 'static');
    if (cam && cam !== 'static') {
    const nextLabel = 'v_camera';
    const chain = cameraFilterChain(currentLabel, cam, videoDur, nextLabel);
    if (chain) filterParts.push(chain);
    if (filterParts[filterParts.length - 1]?.includes(`[${nextLabel}]`)) currentLabel = nextLabel;
    }
  }

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

  // 遮盖左上角第三方/生成水印（即梦/jimeng 等）。
  // 经验：delogo 用周围像素插值会留下糊化色块（特别是大水印区），用户视觉上仍能看到"被处理过"。
  // 干净做法：crop 掉顶部 12% 高度（覆盖水印区），再 scale 回原尺寸。视觉上轻微纵向拉伸（人物在中部几乎看不出），
  // 但水印 100% 消失，没有糊化痕迹。
  if (coverWatermark) {
    const cropPx = Math.round(videoH * 0.12);
    const nextLabel = 'v_wm_cover';
    filterParts.push(`[${currentLabel}]crop=${videoW}:${videoH - cropPx}:0:${cropPx},scale=${videoW}:${videoH}[${nextLabel}]`);
    currentLabel = nextLabel;
  }

  // 步骤 2: 文字/字幕特效。生产 ffmpeg-static 没有 drawtext，优先用 libass 字幕滤镜。
  const validTexts = texts.filter(t => t?.text);
  if (validTexts.length && hasFfmpegFilter('ass')) {
    const assPath = buildAssSubtitleFile(validTexts, outputId, videoInfo, { defaultStyle: subtitleStyle });
    const nextLabel = 'v_sub';
    filterParts.push(`[${currentLabel}]ass='${safeFilterPath(assPath)}'[${nextLabel}]`);
    currentLabel = nextLabel;
  } else {
    for (let i = 0; i < validTexts.length; i++) {
      const txt = { ...validTexts[i] };
      const textFile = path.join(EFFECTS_DIR, `txt_${outputId}_${i}.txt`);
      fs.writeFileSync(textFile, String(txt.text || '').replace(/\r?\n/g, ' '), 'utf8');
      txt.textFile = textFile;
      const filter = buildDrawText(txt);
      const nextLabel = `v_txt${i}`;
      filterParts.push(`[${currentLabel}]${filter}[${nextLabel}]`);
      currentLabel = nextLabel;
    }
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
    const voiceVol = Math.max(0.6, Math.min(1.2, Number(bgm.voiceVolume ?? bgm.voice_volume ?? voiceVolume) || 1));
    const fadeIn = bgm.fadeIn ?? 1;
    const fadeOut = bgm.fadeOut ?? 2;
    const dur = videoInfo.duration;

    if (videoInfo.hasAudio) {
      // 混合原声 + BGM（先裁剪BGM到视频时长）
      filterParts.push(`[0:a]volume=${voiceVol}[voice_a]`);
      filterParts.push(`[${bgmIdx}:a]atrim=0:${dur},asetpts=PTS-STARTPTS,volume=${vol},afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${Math.max(0, dur - fadeOut)}:d=${fadeOut}[bgm_a]`);
      filterParts.push(`[voice_a][bgm_a]amix=inputs=2:duration=first:dropout_transition=2[a_out]`);
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

    // 完整 stderr 捕获 — 字幕烧录失败时这是唯一调试线索
    let stderrBuf = '';
    cmd.outputOptions(outputOpts)
      .output(outputPath)
      .on('start', (cmdline) => {
        // 详细日志（仅前 1500 字符，避免刷屏）
        console.log('[Effects] FFmpeg cmd:', String(cmdline).slice(0, 1500));
      })
      .on('stderr', (line) => { stderrBuf += line + '\n'; })
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
        if (stderrBuf) console.error('[Effects] FFmpeg stderr (tail):', stderrBuf.slice(-1500));
        if (!FONT_FILE) console.error('[Effects] ⚠️ 中文字体缺失！请把 NotoSansSC-Regular.otf 放到 public/fonts/ 或在 Linux 服务器上 apt install fonts-noto-cjk');
        const e = new Error('特效渲染失败: ' + err.message);
        e.stderr = stderrBuf;
        reject(e);
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

function getSubtitleStylePresets() {
  return Object.entries(SUBTITLE_STYLE_PRESETS).map(([id, p]) => ({
    id,
    label: p.label,
    primary: p.primary,
    secondary: p.secondary,
    outline: p.outline,
    back: p.back,
    position: p.position,
    borderStyle: p.borderStyle,
    borderw: p.borderw,
  }));
}

module.exports = { applyEffects, applyEcommerceTemplate, getPresetsInfo, getSubtitleStylePresets, buildAssSubtitleFile, EFFECTS_DIR, ASSETS_DIR };
