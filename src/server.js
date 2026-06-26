require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// 初始化 auth 数据库（首次运行创建默认管理员）
const authStore = require('./models/authStore');
authStore.init();

const { authenticate, requireRole, requirePermission, JWT_SECRET } = require('./middleware/auth');

// ── 页面级认证 ──
// 解析 Cookie 字符串（无需 cookie-parser 依赖）
function _parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) out[k.trim()] = decodeURIComponent(v.join('=').trim());
  });
  return out;
}

// 受保护页面中间件：验证 vido_session Cookie（长期会话 JWT）
function requirePageAuth(req, res, next) {
  const cookies = _parseCookies(req);
  const token = cookies.vido_session;
  if (!token) {
    const target = encodeURIComponent(req.originalUrl);
    return res.redirect(`/?login=1&target=${target}`);
  }
  try {
    const d = jwt.verify(token, JWT_SECRET);
    if (!d.userId) throw new Error('no userId');
    next();
  } catch {
    res.clearCookie('vido_session', { path: '/' });
    const target = encodeURIComponent(req.originalUrl);
    return res.redirect(`/?login=1&target=${target}`);
  }
}

app.use(cors({ origin: true, credentials: true }));
// 保留原始 body（签名验证用）仅对 /openapi/* 生效，避免影响其他路由的 JSON 解析
app.use('/openapi', express.json({
  verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); },
}));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '5mb' }));
// 手动解析 cookie（不引入 cookie-parser 依赖）
app.use((req, res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(';').forEach(c => {
      const [key, ...v] = c.trim().split('=');
      if (key) req.cookies[key.trim()] = decodeURIComponent(v.join('='));
    });
  }
  next();
});

// 静态文件（登录页、admin页不需要 auth）
// 屏蔽未登录直接访问 .html 文件（防绕过路由层直接取源码）
const _PUBLIC_HTML = new Set(['/home.html', '/login.html', '/ai-novel.html']);
app.use((req, res, next) => {
  if (req.path.endsWith('.html') && !_PUBLIC_HTML.has(req.path)) {
    return requirePageAuth(req, res, next);
  }
  next();
});

app.use(express.static(path.join(__dirname, '../public'), {
  index: false,
  setHeaders(res, filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return;
    }
    if (/\.(?:js|css|svg|ico|woff2?|ttf|otf)$/i.test(normalized)) {
      res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      return;
    }
    if (/\.(?:png|jpe?g|webp|gif|mp4|mp3|wav)$/i.test(normalized)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  },
}));

// === 公开路由（无需认证） ===
app.use('/api/auth', require('./routes/auth'));

// 登录页视频展示墙（公开，无需认证）
app.get('/api/showcase/videos', (req, res) => {
  const fs = require('fs');
  const root = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../outputs'));
  const projDir = path.join(root, 'projects');
  const avatarDir = path.join(root, 'avatar');
  try {
    const items = [];
    // 1. 普通视频项目
    if (fs.existsSync(projDir)) {
      fs.readdirSync(projDir)
        .filter(f => f.endsWith('_final.mp4'))
        .forEach(f => {
          const stat = fs.statSync(path.join(projDir, f));
          if (stat.size > 100000) {
            items.push({ id: 'v:' + f.replace('_final.mp4', ''), type: 'video', size: stat.size });
          }
        });
    }
    // 2. 数字人项目 (avatar/{id}/avatar_final.mp4)
    if (fs.existsSync(avatarDir)) {
      fs.readdirSync(avatarDir).forEach(taskId => {
        const finalPath = path.join(avatarDir, taskId, 'avatar_final.mp4');
        const rawPath = path.join(avatarDir, taskId, 'avatar_raw.mp4');
        const candidate = fs.existsSync(finalPath) ? finalPath : (fs.existsSync(rawPath) ? rawPath : null);
        if (candidate) {
          const stat = fs.statSync(candidate);
          if (stat.size > 100000) {
            items.push({ id: 'a:' + taskId, type: 'avatar', size: stat.size });
          }
        }
      });
    }
    // 按类型分桶随机，再交错合并保证两种类型都出现
    const videos = items.filter(x => x.type === 'video').sort(() => Math.random() - 0.5);
    const avatars = items.filter(x => x.type === 'avatar').sort(() => Math.random() - 0.5);
    const mixed = [];
    const targetVideo = Math.min(8, videos.length);
    const targetAvatar = Math.min(4, avatars.length);
    // 交错插入：vavavava…
    for (let i = 0; i < Math.max(targetVideo, targetAvatar); i++) {
      if (i < targetVideo) mixed.push(videos[i]);
      if (i < targetAvatar) mixed.push(avatars[i]);
    }
    res.json({ success: true, videos: mixed.slice(0, 12) });
  } catch { res.json({ success: true, videos: [] }); }
});
app.get('/api/showcase/stream/:id', (req, res) => {
  const fs = require('fs');
  const root = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../outputs'));
  const raw = req.params.id;
  // 解析类型前缀: v:xxx (项目视频) | a:xxx (数字人)
  let filePath;
  if (raw.startsWith('a:')) {
    const taskId = raw.slice(2);
    const finalPath = path.join(root, 'avatar', taskId, 'avatar_final.mp4');
    const rawPath   = path.join(root, 'avatar', taskId, 'avatar_raw.mp4');
    filePath = fs.existsSync(finalPath) ? finalPath : rawPath;
  } else if (raw.startsWith('v:')) {
    filePath = path.join(root, 'projects', raw.slice(2) + '_final.mp4');
  } else {
    // 兼容旧格式 (无前缀 = 项目视频)
    filePath = path.join(root, 'projects', raw + '_final.mp4');
  }
  if (!fs.existsSync(filePath)) return res.status(404).end();
  const stat = fs.statSync(filePath);
  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=3600' });
  fs.createReadStream(filePath).pipe(res);
});

// 音乐预听（公开，audio 标签无法带 Authorization header）
app.get('/api/projects/music/:filename', (req, res) => {
  const fs = require('fs');
  const filePath = path.join(__dirname, '../outputs/music', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// 素材文件（公开，audio/img 标签无法带 Authorization header）
app.get('/api/assets/file/:filename', (req, res) => {
  const fs = require('fs');
  const filename = path.basename(req.params.filename);
  const dirs = ['music', 'characters', 'scenes'];
  for (const sub of dirs) {
    const filePath = path.join(__dirname, '../outputs/assets', sub, filename);
    if (fs.existsSync(filePath)) return res.sendFile(filePath);
  }
  res.status(404).end();
});

// 语音预览文件（公开，audio 标签无法带 Authorization header）
app.get('/api/story/voice-preview/:filename', (req, res) => {
  const fs = require('fs');
  const filePath = path.join(__dirname, '../outputs/voice/preview', path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// 形象图片（公开，img 标签无法带 Authorization header）
app.get('/api/portrait/image/:filename', (req, res) => {
  const fs = require('fs');
  const filename = path.basename(req.params.filename);
  // 先查 portraits 主目录，再查 uploads 子目录
  let filePath = path.join(__dirname, '../outputs/portraits', filename);
  if (!fs.existsSync(filePath)) filePath = path.join(__dirname, '../outputs/portraits/uploads', filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// 漫画页面/面板图片（公开，img 标签无法带 Authorization header）
app.get('/api/comic/image/:taskId/:filename', (req, res) => {
  const fs = require('fs');
  const filename = path.basename(req.params.filename);
  const filePath = path.join(__dirname, '../outputs/comics', req.params.taskId, filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// 网剧场景视频（公开）
app.get('/api/drama/tasks/:id/video/:idx', (req, res) => {
  const fs = require('fs');
  const filePath = path.join(__dirname, '../outputs/dramas', req.params.id, `video_${req.params.idx}.mp4`);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  const stat = fs.statSync(filePath);
  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': stat.size });
  fs.createReadStream(filePath).pipe(res);
});

// 网剧场景图片（公开）
app.get('/api/drama/tasks/:id/image/:idx', (req, res) => {
  const fs = require('fs');
  const filePath = path.join(__dirname, '../outputs/dramas', req.params.id, `scene_${req.params.idx}.png`);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// AI 能力模块静态文件（公开，img 标签无法带 Authorization header）
app.get('/api/ai-cap/file/:subDir/:filename', (req, res) => {
  const fs = require('fs');
  const subDir = path.basename(req.params.subDir);
  const filename = path.basename(req.params.filename);
  const filePath = path.join(__dirname, '../outputs/ai_cap', subDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// 角色/场景图片（公开，img 标签无法带 Authorization header）
app.get('/api/story/character-image/:filename', (req, res) => {
  const fs = require('fs');
  const filename = path.basename(req.params.filename);
  // 先查角色目录，再查场景目录
  let filePath = path.join(__dirname, '../outputs/characters', filename);
  if (!fs.existsSync(filePath)) filePath = path.join(__dirname, '../outputs/scenes', filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// i2v 上传图片的公开读取（img 标签预览）
app.get('/api/i2v/images/:filename', (req, res) => {
  const fs = require('fs');
  const filename = path.basename(req.params.filename);
  const filePath = path.join(__dirname, '../outputs/i2v_images', filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// 工作流资产（生成图、抠图、融合图等中间产物）— 必须公网可访问供 Replicate / DashScope 等拉取
app.get('/public/workflow-assets/:filename', (req, res) => {
  const fs = require('fs');
  const filename = path.basename(req.params.filename);
  const filePath = path.join(__dirname, '../outputs/workflow-assets', filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  const stat = fs.statSync(filePath);
  const ext = path.extname(filename).toLowerCase();
  const mimeMap = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4',
                    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  res.writeHead(200, {
    'Content-Type': mimeMap[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'public, max-age=3600',
  });
  fs.createReadStream(filePath).pipe(res);
});

// 即梦数字人 Omni 临时素材（图片/音频）— 必须公网可访问供火山 API 拉取
app.get('/public/jimeng-assets/:filename', async (req, res) => {
  const fs = require('fs');
  const filename = path.basename(req.params.filename);
  const filePath = path.join(__dirname, '../outputs/jimeng-assets', filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  const stat = fs.statSync(filePath);
  const ext = path.extname(filename).toLowerCase();
  const mimeMap = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4',
                    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  const contentType = mimeMap[ext] || 'application/octet-stream';
  const thumbWidth = Math.max(0, Math.min(1200, Math.round(Number(req.query.thumb || req.query.w || 0))));
  if (thumbWidth && ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    const crypto = require('crypto');
    const thumbDir = path.join(__dirname, '../outputs/jimeng-thumbs');
    const cacheKey = crypto
      .createHash('sha1')
      .update([filename, stat.size, Math.round(stat.mtimeMs), thumbWidth].join('|'))
      .digest('hex')
      .slice(0, 18);
    const thumbPath = path.join(thumbDir, `${path.basename(filename, ext)}_${thumbWidth}_${cacheKey}.jpg`);
    try {
      fs.mkdirSync(thumbDir, { recursive: true });
      if (!fs.existsSync(thumbPath)) {
        let made = false;
        try {
          const sharp = require('sharp');
          await sharp(filePath)
            .rotate()
            .resize({ width: thumbWidth, withoutEnlargement: true })
            .flatten({ background: '#111827' })
            .jpeg({ quality: 78, mozjpeg: true })
            .toFile(thumbPath);
          made = true;
        } catch (sharpErr) {
          try {
            const { execFile } = require('child_process');
            const ffmpegPath = process.env.FFMPEG_PATH || require('ffmpeg-static');
            await new Promise((resolve, reject) => {
              execFile(ffmpegPath, [
                '-y',
                '-i', filePath,
                '-vf', `scale=${thumbWidth}:-2`,
                '-frames:v', '1',
                '-q:v', '5',
                thumbPath,
              ], { timeout: 30000 }, err => err ? reject(err) : resolve());
            });
            made = true;
          } catch (ffmpegErr) {
            console.warn('[jimeng-thumb] 生成缩略图失败:', ffmpegErr.message || sharpErr.message);
          }
        }
        if (!made || !fs.existsSync(thumbPath)) throw new Error('thumbnail not generated');
      }
      const thumbStat = fs.statSync(thumbPath);
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': thumbStat.size,
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      return fs.createReadStream(thumbPath).pipe(res);
    } catch (thumbErr) {
      console.warn('[jimeng-thumb] fallback original:', thumbErr.message);
    }
  }
  if (['.mp4', '.mov', '.webm', '.mkv', '.avi', '.mp3', '.wav', '.m4a'].includes(ext)) {
    const range = req.headers.range;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (range) {
      const parts = String(range).replace(/bytes=/, '').split('-');
      const start = Math.max(0, parseInt(parts[0], 10) || 0);
      const end = Math.min(stat.size - 1, parts[1] ? parseInt(parts[1], 10) : stat.size - 1);
      if (start >= stat.size || end < start) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      });
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
  }
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': 'public, max-age=3600',
  });
  fs.createReadStream(filePath).pipe(res);
});

// 用户主题偏好
// 数字人上传素材缓存：按内容 hash 持久化，浏览器和外部模型都从这里复用。
app.get('/public/dh-assets/:filename', (req, res) => {
  const fs = require('fs');
  const filename = path.basename(req.params.filename);
  const filePath = path.join(__dirname, '../outputs/dh-assets', filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  const stat = fs.statSync(filePath);
  const ext = path.extname(filename).toLowerCase();
  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.bmp': 'image/bmp' };
  res.writeHead(200, {
    'Content-Type': mimeMap[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(filePath).pipe(res);
});

app.put('/api/user/theme', authenticate, (req, res) => {
  const { theme } = req.body;
  const valid = ['purple', 'light-mist'];
  if (!valid.includes(theme)) return res.status(400).json({ success: false, error: '无效主题' });
  const authStore = require('./models/authStore');
  authStore.updateUser(req.user.id, { theme });
  res.json({ success: true });
});
app.get('/api/user/theme', authenticate, (req, res) => {
  const authStore = require('./models/authStore');
  const user = authStore.getUserById(req.user.id);
  const normalizeTheme = theme => theme === 'light-mist' ? 'light-mist' : 'purple';
  res.json({ success: true, theme: normalizeTheme(user?.theme) });
});

// === 需认证的路由 ===
app.use('/api/dashboard', authenticate, require('./routes/dashboard'));
app.use('/api/radar', authenticate, require('./routes/radar'));
// 平台账号绑定 — 复用 VIDO 已有的 /api/browser 路由（browserService）
// 启动关键字订阅调度器
try { require('./services/subscriptionScheduler').start(); } catch (e) { console.warn('[server] subscription scheduler start failed:', e.message); }
app.use('/api/projects', authenticate, require('./routes/projects'));
app.use('/api/story', authenticate, require('./routes/story'));
app.use('/api/editor', authenticate, require('./routes/editor'));
app.use('/api/assets', authenticate, require('./routes/assets'));

// === 社交媒体发布 ===
app.use('/api/publish', authenticate, require('./routes/publish'));

// === 媒体流公开访问（video/img 标签不带 Authorization header）===
app.get('/api/workflow/effects/result/:id', require('./routes/effects-stream'));
app.get('/api/i2v/tasks/:id/stream', require('./routes/i2v-stream'));
app.get('/api/i2v/tasks/:id/download', require('./routes/i2v-stream'));
app.get('/api/projects/:id/stream', require('./routes/project-stream'));
app.get('/api/projects/:id/clips/:clipId/stream', require('./routes/project-stream'));

// === 需特定权限的路由 ===
app.use('/api/i2v', authenticate, requirePermission('i2v'), require('./routes/i2v'));
// 预设图片公开访问（img 标签不带 token）
app.use('/api/avatar/preset-img', require('./routes/avatar-preset-img'));
// prompt-preview / translate-prompt 是纯文本工具，不消耗模型/不返回敏感数据
//   登录即可使用，不要求 'avatar' 权限，避免普通用户进首页时被 401 / 403 弹回
const _avatarPublicPaths = new Set(['/prompt-preview', '/translate-prompt', '/smart-camera']);
function _avatarPermGate(req, res, next) {
  if (_avatarPublicPaths.has(req.path)) return next();
  return requirePermission('avatar')(req, res, next);
}
app.use('/api/avatar', authenticate, _avatarPermGate, require('./routes/avatar'));
app.use('/api/hifly', authenticate, requirePermission('avatar'), require('./routes/hifly'));
// 数字人作品缩略图 — 公开端点（在 authenticate 之前注册）
//   <video poster> 不能带 Authorization header；task id 是 uuid 不可枚举，安全 OK
app.get('/api/dh/videos/tasks/:id/thumbnail', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  try {
    const db = require('./models/database');
    const ffmpegService = require('./services/ffmpegService');
    const t = db.getAvatarTask(req.params.id);
    if (!t) return res.status(404).end();
    const resolveJimengVideoPath = (url = '') => {
      const raw = String(url || '').split('?')[0].split('#')[0];
      const marker = '/public/jimeng-assets/';
      const idx = raw.indexOf(marker);
      if (idx < 0) return '';
      const name = path.basename(raw.slice(idx + marker.length));
      if (!name || name.includes('..')) return '';
      const candidate = path.resolve(__dirname, '../outputs/jimeng-assets', name);
      return fs.existsSync(candidate) ? candidate : '';
    };
    const localPath = (t.videoPath && fs.existsSync(t.videoPath) ? t.videoPath : '')
      || (t.local_path && fs.existsSync(t.local_path) ? t.local_path : '')
      || resolveJimengVideoPath(t.video_url || t.videoUrl);
    if (!localPath || !fs.existsSync(localPath)) return res.status(204).end();
    const thumbPath = localPath.replace(/\.(mp4|mov|webm|mkv|avi)$/i, '') + '.thumb.jpg';
    const send = () => {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      fs.createReadStream(thumbPath).pipe(res);
    };
    if (fs.existsSync(thumbPath)) return send();
    ffmpegService.extractFirstFrame(localPath, thumbPath, { atSec: 0.5, width: 480 })
      .then(send)
      .catch(err => {
        console.warn('[DH/thumbnail] 抽帧失败:', err.message);
        res.status(204).end();
      });
  } catch (err) {
    console.warn('[DH/thumbnail] err:', err.message);
    res.status(500).end();
  }
});

// 我的形象（portrait）样片视频首帧 — 公开端点（同上理由）
app.get('/api/dh/my-avatars/:id/thumbnail', async (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const axios = require('axios');
  try {
    const db = require('./models/database');
    const ffmpegService = require('./services/ffmpegService');
    const p = db.getPortrait(req.params.id);
    if (!p) return res.status(404).end();

    const sendFile = (filePath, contentType = 'image/jpeg') => {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      fs.createReadStream(filePath).pipe(res);
      return true;
    };
    const sendPlaceholder = () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="720" viewBox="0 0 480 720"><rect width="480" height="720" fill="#0b0d12"/><rect x="34" y="34" width="412" height="652" rx="18" fill="none" stroke="#2a2f3a" stroke-width="3" stroke-dasharray="12 10"/><text x="240" y="340" text-anchor="middle" fill="#8791a5" font-size="30" font-family="Arial, sans-serif">本地未同步图片</text><text x="240" y="388" text-anchor="middle" fill="#596276" font-size="20" font-family="Arial, sans-serif">请同步 outputs/jimeng-assets</text></svg>`;
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(svg);
    };
    const findLocalImage = (url) => {
      if (!url) return null;
      const clean = String(url).split('?')[0];
      const candidates = [];
      if (/^\/public\//.test(clean)) candidates.push(path.resolve(__dirname, '..' + clean));
      if (clean.includes('/public/jimeng-assets/')) candidates.push(path.resolve(__dirname, '../outputs/jimeng-assets', path.basename(clean)));
      if (clean.includes('/api/portrait/image/')) candidates.push(path.resolve(__dirname, '../outputs/portraits', path.basename(clean)), path.resolve(__dirname, '../outputs/portraits/uploads', path.basename(clean)));
      return candidates.find(x => x && fs.existsSync(x)) || null;
    };
    const imageUrl = p.image_url || p.photo_url || '';
    const preferVideo = req.query.prefer_video === '1' || req.query.prefer === 'video';
    const sample = p.sample_video_url || '';
    let localVideo = null;
    if (sample.includes('/public/jimeng-assets/')) {
      const name = path.basename(sample.split('?')[0]);
      const candidate = path.resolve(__dirname, '../outputs/jimeng-assets', name);
      if (fs.existsSync(candidate)) localVideo = candidate;
    }
    const sendVideoThumb = () => {
      if (!localVideo) return false;
      const thumbPath = localVideo.replace(/\.(mp4|mov|webm|mkv)$/i, '') + '.thumb.jpg';
      const send = () => {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        fs.createReadStream(thumbPath).pipe(res);
      };
      if (fs.existsSync(thumbPath)) { send(); return true; }
      ffmpegService.extractFirstFrame(localVideo, thumbPath, { atSec: 0.5, width: 480 })
        .then(send)
        .catch(err => { console.warn('[DH/avatar-thumb] 抽帧失败:', err.message); res.status(204).end(); });
      return true;
    };
    if (preferVideo && sendVideoThumb()) return;

    const localImage = findLocalImage(imageUrl);
    if (localImage) {
      const ext = path.extname(localImage).toLowerCase();
      const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      return sendFile(localImage, type);
    }

    // 本地开发常见情况：portrait_db 从线上同步了 URL，但 outputs/jimeng-assets 没同步。
    // 默认快速返回明确占位图，避免每张卡片等待远程外链超时；需要尝试代理时加 ?proxy=1。
    if (/^https?:\/\//i.test(imageUrl) && req.query.proxy === '1') {
      const clean = imageUrl.split('?')[0];
      const ext = /\.(png|webp|jpg|jpeg)$/i.test(clean) ? path.extname(clean).toLowerCase() : '.jpg';
      const cachePath = path.resolve(__dirname, '../outputs/jimeng-assets', `avatar_thumb_${req.params.id}${ext}`);
      if (fs.existsSync(cachePath)) {
        const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        return sendFile(cachePath, type);
      }
      try {
        const r = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 2500, maxRedirects: 3 });
        if (r.status >= 200 && r.status < 300 && r.data?.byteLength) {
          fs.mkdirSync(path.dirname(cachePath), { recursive: true });
          fs.writeFileSync(cachePath, Buffer.from(r.data));
          return sendFile(cachePath, r.headers['content-type'] || (ext === '.png' ? 'image/png' : 'image/jpeg'));
        }
      } catch (e) {
        console.warn('[DH/avatar-thumb] remote image unavailable:', imageUrl, e.message);
      }
    }

    if (sendVideoThumb()) return;
    return sendPlaceholder();
  } catch (err) {
    console.warn('[DH/avatar-thumb] err:', err.message);
    res.status(500).end();
  }
});

app.use('/api/dh', authenticate, requirePermission('avatar'), require('./routes/digitalHuman'));
app.use('/api/imggen', authenticate, requirePermission('imggen'), require('./routes/imggen'));
app.use('/api/novel', authenticate, requirePermission('novel'), require('./routes/novel'));
app.use('/api/comic', authenticate, requirePermission('comic'), require('./routes/comic'));
app.use('/api/drama', authenticate, require('./routes/drama'));
app.use('/api/ai-cap', authenticate, require('./routes/aiCap'));
app.use('/api/workflow', authenticate, require('./routes/workflow'));
// 新工作流引擎（复数）— JSON 驱动可配置 AI 工作流
app.use('/api/workflows', authenticate, require('./routes/workflows'));
app.use('/api/agent', authenticate, require('./routes/agent'));
app.use('/api/portrait', authenticate, requirePermission('portrait'), require('./routes/portrait'));
app.use('/api/workbench', authenticate, require('./routes/workbench'));
app.use('/api/works', authenticate, require('./routes/works'));
app.use('/api/browser', authenticate, require('./routes/browser'));

// === 设置路由（仅 admin，AI 配置已移至后台） ===
app.use('/api/settings', authenticate, requireRole('admin'), require('./routes/settings'));

// === MCP 管理（仅 admin） ===
app.use('/api/mcp', authenticate, requireRole('admin'), require('./routes/mcp'));

// === 数据同步（仅 admin） ===
app.use('/api/sync', authenticate, requireRole('admin'), require('./routes/sync'));

// === 管理后台（仅 admin） ===
app.use('/api/admin', authenticate, requireRole('admin'), require('./routes/admin'));

// === OpenAPI 开放接口（AppID/AppKey 签名验证，对外分发） ===
const { apiAuth } = require('./middleware/apiAuth');
app.use('/openapi', apiAuth, require('./routes/openapi'));

// === 公开接口目录（给 /api-docs.html 用，无需认证） ===
app.get('/api/public/openapi-catalog', (_req, res) => {
  try {
    const { listCatalog } = require('./services/apiCatalog');
    res.json({ success: true, data: listCatalog() });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// === AI 团队（登录即可用，所有 agent 岗位的可调用端点）===
app.use('/api/ai-team', authenticate, require('./routes/aiTeam'));

// 健康检查（公开）
app.get('/api/health', (req, res) => {
  const { getStoryInfo } = require('./services/storyService');
  const storyInfo = getStoryInfo();
  const videoLabels = { demo: 'FFmpeg Demo（免费）', zhipu: '智谱AI CogVideoX（免费）', huggingface: 'HuggingFace ModelScope', replicate: 'Replicate', sora: 'Sora 2', 'webang-seedance': '微众 Seedance 2.0' };
  const videoProvider = process.env.VIDEO_PROVIDER || 'auto';
  let database = { enabled: false, status: 'disabled' };
  try {
    database = require('./db/sqlite').healthCheck();
  } catch (error) {
    database = { enabled: true, status: 'error', error: error.message };
  }
  res.json({
    status: 'ok',
    storyProvider: storyInfo.provider,
    storyModel: storyInfo.model,
    hasDeepseekKey: !!process.env.DEEPSEEK_API_KEY,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    hasClaudeKey: !!process.env.CLAUDE_API_KEY,
    database,
    videoProvider,
    videoModel: videoLabels[videoProvider] || 'auto（由 AI 配置决定）'
  });
});

// 前端路由 — 根路径 / 返回新的公开营销首页
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/home.html')));
app.get('/home', (req, res) => res.sendFile(path.join(__dirname, '../public/home.html')));
app.get('/home.html', (req, res) => res.sendFile(path.join(__dirname, '../public/home.html')));
// 登录后工作台
app.get('/dashboard', requirePageAuth, (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/index.html', requirePageAuth, (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/digital-human', requirePageAuth, (req, res) => res.sendFile(path.join(__dirname, '../public/digital-human.html')));
app.get('/digital-human.html', requirePageAuth, (req, res) => res.sendFile(path.join(__dirname, '../public/digital-human.html')));
function sendNoStorePage(res, filePath) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return res.sendFile(filePath);
}
app.get('/ai-novel', (req, res) => sendNoStorePage(res, path.join(__dirname, '../public/ai-novel.html')));
app.get('/ai-novel.html', (req, res) => sendNoStorePage(res, path.join(__dirname, '../public/ai-novel.html')));
app.get('/ai-manga-drama', requirePageAuth, (req, res) => sendNoStorePage(res, path.join(__dirname, '../public/ai-manga-drama.html')));
app.get('/ai-manga-drama.html', requirePageAuth, (req, res) => sendNoStorePage(res, path.join(__dirname, '../public/ai-manga-drama.html')));
// /login.html — admin 独立登录入口（公开）
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../public/login.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, '../public/login.html')));
app.get('/admin', requirePageAuth, (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));
app.get('/admin.html', requirePageAuth, (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));

// SPA 回退（排除 API 路径）
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'API 端点不存在' });
  }
  res.sendFile(path.join(__dirname, '../public/home.html'));
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n  VIDO AI 视频平台已启动`);
  console.log(`  本地访问: http://localhost:${PORT}`);
  // 显示局域网地址
  try {
    const nets = require('os').networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`  局域网: http://${net.address}:${PORT}`);
        }
      }
    }
  } catch {}
  const { getStoryInfo } = require('./services/storyService');
  const story = getStoryInfo();
  console.log(`  剧情模型: ${story.provider === 'none' ? '未配置（请在 AI 配置页面添加）' : `${story.provider} (${story.model})`}`);
  const vp = process.env.VIDEO_PROVIDER || 'auto';
  const videoLabels = { demo: 'FFmpeg Demo（免费）', zhipu: '智谱AI CogVideoX（国内免费）', huggingface: 'HuggingFace ModelScope', replicate: 'Replicate', sora: 'Sora 2', 'webang-seedance': '微众 Seedance 2.0', auto: '自动（由 AI 配置决定）' };
  console.log(`  视频模型: ${videoLabels[vp] || vp}\n`);

  // 自动启动本地 MCP 服务器
  try {
    const mcpManager = require('./services/mcpManager');
    await mcpManager.startAll();
    // 优雅退出时停止 MCP 子进程
    const cleanup = () => { mcpManager.stopAll(); process.exit(0); };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  } catch (err) {
    console.error('  [MCP] 自动启动失败:', err.message);
  }

  // 【v6】注册每日 00:00 自动学习任务
  try {
    const dailyLearn = require('./services/dailyLearnService');
    dailyLearn.scheduleDaily(0, 0);  // 每天 00:00 触发
    console.log('  [DailyLearn] ✓ 已注册每日 00:00 自动学习任务');
  } catch (err) {
    console.error('  [DailyLearn] 注册失败:', err.message);
  }
});
