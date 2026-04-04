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

// 用户主题偏好
app.put('/api/user/theme', authenticate, (req, res) => {
  const { theme } = req.body;
  const valid = ['purple', 'cyan', 'green', 'amber', 'rose', 'blue', 'light', 'light-purple', 'light-blue', 'light-green', 'light-rose', 'light-amber'];
  if (!valid.includes(theme)) return res.status(400).json({ success: false, error: '无效主题' });
  const authStore = require('./models/authStore');
  authStore.updateUser(req.user.id, { theme });
  res.json({ success: true });
});
app.get('/api/user/theme', authenticate, (req, res) => {
  const authStore = require('./models/authStore');
  const user = authStore.getUserById(req.user.id);
  res.json({ success: true, theme: user?.theme || 'purple' });
});

// === 需认证的路由 ===
app.use('/api/dashboard', authenticate, require('./routes/dashboard'));
app.use('/api/radar', authenticate, require('./routes/radar'));
app.use('/api/projects', authenticate, require('./routes/projects'));
app.use('/api/story', authenticate, require('./routes/story'));
app.use('/api/editor', authenticate, require('./routes/editor'));
app.use('/api/assets', authenticate, require('./routes/assets'));

// === 社交媒体发布 ===
app.use('/api/publish', authenticate, require('./routes/publish'));

// === 需特定权限的路由 ===
app.use('/api/i2v', authenticate, requirePermission('i2v'), require('./routes/i2v'));
app.use('/api/avatar', authenticate, requirePermission('avatar'), require('./routes/avatar'));
app.use('/api/imggen', authenticate, requirePermission('imggen'), require('./routes/imggen'));
app.use('/api/novel', authenticate, requirePermission('novel'), require('./routes/novel'));
app.use('/api/comic', authenticate, requirePermission('comic'), require('./routes/comic'));
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

// SPA 回退（排除 API 路径）
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'API 端点不存在' });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
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
  const videoLabels = { demo: 'FFmpeg Demo（免费）', zhipu: '智谱AI CogVideoX（国内免费）', huggingface: 'HuggingFace ModelScope', replicate: 'Replicate', sora: 'Sora 2', auto: '自动（由 AI 配置决定）' };
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
});
