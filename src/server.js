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
app.use(express.static(path.join(__dirname, '../public'), { index: false }));

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
app.use('/api/avatar', authenticate, requirePermission('avatar'), require('./routes/avatar'));
app.use('/api/imggen', authenticate, requirePermission('imggen'), require('./routes/imggen'));
app.use('/api/novel', authenticate, requirePermission('novel'), require('./routes/novel'));
app.use('/api/comic', authenticate, requirePermission('comic'), require('./routes/comic'));
app.use('/api/drama', authenticate, require('./routes/drama'));
app.use('/api/ai-cap', authenticate, require('./routes/aiCap'));
app.use('/api/workflow', authenticate, require('./routes/workflow'));
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

// === AI 团队（登录即可用，所有 agent 岗位的可调用端点）===
app.use('/api/ai-team', authenticate, require('./routes/aiTeam'));

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

// 前端路由 — 根路径 / 返回新的公开营销首页
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/home.html')));
app.get('/home', (req, res) => res.sendFile(path.join(__dirname, '../public/home.html')));
app.get('/home.html', (req, res) => res.sendFile(path.join(__dirname, '../public/home.html')));
// 登录后工作台
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
// login / admin
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../public/login.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, '../public/login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));

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

  // 【v6】注册每日 00:00 自动学习任务
  try {
    const dailyLearn = require('./services/dailyLearnService');
    dailyLearn.scheduleDaily(0, 0);  // 每天 00:00 触发
    console.log('  [DailyLearn] ✓ 已注册每日 00:00 自动学习任务');
  } catch (err) {
    console.error('  [DailyLearn] 注册失败:', err.message);
  }
});
