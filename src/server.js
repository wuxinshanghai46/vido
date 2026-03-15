require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('express').json; // express 内置无 cookie-parser，用手动解析

const app = express();
const PORT = process.env.PORT || 3000;

// 初始化 auth 数据库（首次运行创建默认管理员）
const authStore = require('./models/authStore');
authStore.init();

const { authenticate, requireRole, requirePermission } = require('./middleware/auth');

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
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
app.use(express.static(path.join(__dirname, '../public')));

// === 公开路由（无需认证） ===
app.use('/api/auth', require('./routes/auth'));

// 登录页视频展示墙（公开，无需认证）
app.get('/api/showcase/videos', (req, res) => {
  const fs = require('fs');
  const projDir = path.join(__dirname, '../outputs/projects');
  try {
    const files = fs.readdirSync(projDir).filter(f => f.endsWith('_final.mp4'));
    const videos = files
      .map(f => {
        const stat = fs.statSync(path.join(projDir, f));
        return { id: f.replace('_final.mp4', ''), size: stat.size };
      })
      .filter(v => v.size > 100000) // 过滤太小的文件
      .sort(() => Math.random() - 0.5)
      .slice(0, 12);
    res.json({ success: true, videos });
  } catch { res.json({ success: true, videos: [] }); }
});
app.get('/api/showcase/stream/:id', (req, res) => {
  const fs = require('fs');
  const filePath = path.join(__dirname, '../outputs/projects', req.params.id + '_final.mp4');
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

// === 需认证的路由 ===
app.use('/api/projects', authenticate, require('./routes/projects'));
app.use('/api/story', authenticate, require('./routes/story'));
app.use('/api/editor', authenticate, require('./routes/editor'));

// === 需特定权限的路由 ===
app.use('/api/i2v', authenticate, requirePermission('i2v'), require('./routes/i2v'));
app.use('/api/avatar', authenticate, requirePermission('avatar'), require('./routes/avatar'));
app.use('/api/imggen', authenticate, requirePermission('imggen'), require('./routes/imggen'));

// === 设置路由（仅 admin，AI 配置已移至后台） ===
app.use('/api/settings', authenticate, requireRole('admin'), require('./routes/settings'));

// === 管理后台（仅 admin） ===
app.use('/api/admin', authenticate, requireRole('admin'), require('./routes/admin'));

// 健康检查（公开）
app.get('/api/health', (req, res) => {
  const { getStoryInfo } = require('./services/storyService');
  const storyInfo = getStoryInfo();
  const videoLabels = { demo: 'FFmpeg Demo（免费）', zhipu: '智谱AI CogVideoX（免费）', huggingface: 'HuggingFace ModelScope', replicate: 'Replicate', sora: 'Sora 2' };
  const videoProvider = process.env.VIDEO_PROVIDER || 'auto';
  res.json({
    status: 'ok',
    storyProvider: storyInfo.provider,
    storyModel: storyInfo.model,
    hasDeepseekKey: !!process.env.DEEPSEEK_API_KEY,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    hasClaudeKey: !!process.env.CLAUDE_API_KEY,
    videoProvider,
    videoModel: videoLabels[videoProvider] || 'auto（由 AI 配置决定）'
  });
});

// 前端路由 — login/admin 直接返回对应页面
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../public/login.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, '../public/login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));

// SPA 回退
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  VIDO AI 视频平台已启动`);
  console.log(`  本地访问: http://localhost:${PORT}`);
  const { getStoryInfo } = require('./services/storyService');
  const story = getStoryInfo();
  console.log(`  剧情模型: ${story.provider === 'none' ? '未配置（请在 AI 配置页面添加）' : `${story.provider} (${story.model})`}`);
  const vp = process.env.VIDEO_PROVIDER || 'auto';
  const videoLabels = { demo: 'FFmpeg Demo（免费）', zhipu: '智谱AI CogVideoX（国内免费）', huggingface: 'HuggingFace ModelScope', replicate: 'Replicate', sora: 'Sora 2', auto: '自动（由 AI 配置决定）' };
  console.log(`  视频模型: ${videoLabels[vp] || vp}\n`);
});
