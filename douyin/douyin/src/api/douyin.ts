import { Router } from "express";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { extractUrl, getVideoInfo, getUserVideos, downloadVideo, downloadProgressMap } from "../services/douyin.js";
import { extractAudio, splitAudio } from "../services/audio.js";
import { transcribeAudio } from "../services/transcribe.js";
import { rewriteText, getStylePresets } from "../services/ai.js";
import { generateSpeech } from "../services/tts.js";
import { getConfig } from "../config.js";
import { getDb } from "../db/index.js";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { mkdirSync, existsSync, statSync, readdirSync, readFileSync as rfs } from "node:fs";
import { startScheduler, stopScheduler, fetchAllBloggers, isSchedulerRunning, getStopReason } from "../services/scheduler.js";

const execFileAsync = promisify(execFile);

const router = Router();

import { saveVideosToDB } from "../db/helpers.js";

/** POST /api/douyin/parse - 解析分享文本, 获取视频和用户信息 */
router.post("/parse", async (req, res) => {
  const { text } = req.body;
  if (!text) {
    res.status(400).json({ error: "请提供分享文本" });
    return;
  }

  const url = extractUrl(text);
  if (!url) {
    res.status(400).json({ error: "未找到有效链接" });
    return;
  }

  try {
    const videoInfo = await getVideoInfo(url);

    // 保存到数据库
    const db = getDb();
    db.prepare(`INSERT OR REPLACE INTO douyin_videos (id, title, description, url, thumbnail, duration, like_count, comment_count, share_count, collect_count, uploader, uploader_id, uploader_avatar, upload_date, video_url, view_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      videoInfo.id, videoInfo.title, videoInfo.description, videoInfo.url, videoInfo.thumbnail,
      videoInfo.duration, videoInfo.like_count, videoInfo.comment_count, videoInfo.share_count,
      videoInfo.collect_count || 0, videoInfo.uploader, videoInfo.uploader_id,
      videoInfo.uploader_avatar, videoInfo.upload_date, videoInfo.video_url || '', videoInfo.view_count || 0
    );

    // 保存数据快照（用于数据分析：每天获赞、收藏增长等）
    db.prepare(`INSERT INTO video_snapshots (video_id, like_count, comment_count, share_count, collect_count, view_count) VALUES (?, ?, ?, ?, ?, ?)`).run(
      videoInfo.id, videoInfo.like_count, videoInfo.comment_count, videoInfo.share_count,
      videoInfo.collect_count || 0, videoInfo.view_count || 0
    );

    res.json({
      video: videoInfo,
      user: {
        name: videoInfo.uploader,
        id: videoInfo.uploader_id,
        url: videoInfo.uploader_url,
        avatar: videoInfo.uploader_avatar,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: `解析失败: ${err.message}` });
  }
});

/** GET /api/douyin/history - 获取解析历史 */
router.get("/history", (_req, res) => {
  const db = getDb();
  const videos = db.prepare("SELECT * FROM douyin_videos ORDER BY created_at DESC").all();
  res.json(videos);
});

/** DELETE /api/douyin/history/:id - 删除解析历史 */
router.delete("/history/:id", (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM douyin_videos WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

/** GET /api/douyin/downloads - 获取已下载的视频列表 */
router.get("/downloads", (_req, res) => {
  const config = getConfig();
  const dir = resolve(config.server.uploadDir, "douyin");
  try {
    const files = readdirSync(dir)
      .filter((f: string) => f.endsWith(".mp4") && !f.includes("_work"))
      .map((f: string) => {
        const id = f.replace(".mp4", "");
        const stat = statSync(join(dir, f));
        // 尝试从 douyin_videos 表获取视频信息
        const db = getDb();
        const info = db.prepare("SELECT title, uploader, thumbnail, duration, like_count FROM douyin_videos WHERE id = ?").get(id) as any;
        return {
          id,
          filename: f,
          title: info?.title || f,
          uploader: info?.uploader || "",
          thumbnail: info?.thumbnail || "",
          duration: info?.duration || 0,
          like_count: info?.like_count || 0,
          size: stat.size,
          downloaded_at: stat.mtime.toISOString(),
          previewUrl: `/files/douyin/${f}`,
        };
      })
      .sort((a: any, b: any) => new Date(b.downloaded_at).getTime() - new Date(a.downloaded_at).getTime());
    res.json(files);
  } catch (err: any) {
    // 目录不存在是正常情况（尚未下载过视频）
    if (err.code === 'ENOENT') { res.json([]); return; }
    console.error("[Downloads]", err.message);
    res.json([]);
  }
});

/** POST /api/douyin/user-videos - 获取用户视频列表 */
router.post("/user-videos", async (req, res) => {
  const { userUrl } = req.body;
  if (!userUrl) {
    res.status(400).json({ error: "请提供用户主页地址" });
    return;
  }

  try {
    const videos = await getUserVideos(userUrl);
    res.json(videos);
  } catch (err: any) {
    res.status(500).json({ error: `获取视频列表失败: ${err.message}` });
  }
});


/** POST /api/douyin/download - 仅下载视频 */
router.post("/download", async (req, res) => {
  const { videoUrl, videoId, playUrl } = req.body;
  if (!videoUrl && !playUrl) {
    res.status(400).json({ error: "请提供视频地址" });
    return;
  }
  try {
    const id = videoId || randomUUID();
    const videoPath = await downloadVideo(videoUrl, id, playUrl);
    // 返回相对路径用于预览
    const relativePath = videoPath.split("/").slice(-2).join("/");
    res.json({ videoId: id, videoPath, previewUrl: `/files/${relativePath}` });
  } catch (err: any) {
    res.status(500).json({ error: `下载失败: ${err.message}` });
  }
});

/** GET /api/douyin/download-progress/:id - SSE 下载进度 */
router.get("/download-progress/:id", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  const videoId = req.params.id;
  const iv = setInterval(() => {
    const progress = downloadProgressMap.get(videoId);
    if (progress) {
      res.write(`data: ${JSON.stringify(progress)}\n\n`);
    } else {
      // 下载完成或不存在
      res.write(`data: ${JSON.stringify({progress: 100, done: true})}\n\n`);
      clearInterval(iv);
      res.end();
    }
  }, 500);

  req.on("close", () => clearInterval(iv));
});

/** POST /api/douyin/transcribe-local - 转录已下载的本地视频 */
router.post("/transcribe-local", async (req, res) => {
  const { videoPath, videoId, title } = req.body;
  if (!videoPath) {
    res.status(400).json({ error: "请提供视频路径" });
    return;
  }
  const config = getConfig();
  try {
    const id = videoId || randomUUID();
    const workDir = resolve(config.server.uploadDir, "douyin", `${id}_work`);
    mkdirSync(workDir, { recursive: true });
    const audioPath = await extractAudio(videoPath, workDir, config.transcribe.sampleRate);
    const segments = await splitAudio(audioPath, workDir, config.transcribe.maxSegmentSeconds);
    const allResults: any[] = [];
    for (const seg of segments) {
      const result = await transcribeAudio(seg.path);
      const adjusted = result.map((r) => ({
        ...r,
        start_time: r.start_time + seg.startTime,
        end_time: r.end_time + seg.startTime,
      }));
      allResults.push(...adjusted);
    }
    const fullText = allResults.map((r) => r.text).join("");
    const timedText = allResults.map((r) => {
      const fmt = (s: number) => { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=Math.floor(s%60); return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`; };
      return `[${fmt(r.start_time)} -> ${fmt(r.end_time)}] ${r.text}`;
    }).join("\n");
    res.json({ videoId: id, title: title || "", segments: allResults, text: fullText, timedText });
  } catch (err: any) {
    res.status(500).json({ error: `转录失败: ${err.message}` });
  }
});

/** POST /api/douyin/transcribe-sync - 下载视频并转录 (同步, 等待完成) */
router.post("/transcribe-sync", async (req, res) => {
  const { videoUrl, videoId, title, playUrl } = req.body;
  if (!videoUrl && !playUrl) {
    res.status(400).json({ error: "请提供视频地址" });
    return;
  }

  const config = getConfig();

  try {
    // 1. 下载视频
    const id = videoId || randomUUID();
    const videoPath = await downloadVideo(videoUrl, id, playUrl);

    // 2. 提取音频
    const workDir = resolve(config.server.uploadDir, "douyin", `${id}_work`);
    mkdirSync(workDir, { recursive: true });
    const audioPath = await extractAudio(videoPath, workDir, config.transcribe.sampleRate);

    // 3. 分段
    const segments = await splitAudio(audioPath, workDir, config.transcribe.maxSegmentSeconds);

    // 4. 转录每段
    const allResults: any[] = [];
    for (const seg of segments) {
      const result = await transcribeAudio(seg.path);
      const adjusted = result.map((r) => ({
        ...r,
        start_time: r.start_time + seg.startTime,
        end_time: r.end_time + seg.startTime,
      }));
      allResults.push(...adjusted);
    }

    // 5. 合成纯文本
    const fullText = allResults.map((r) => r.text).join("");

    res.json({
      videoId: id,
      title: title || "",
      segments: allResults,
      text: fullText,
    });
  } catch (err: any) {
    res.status(500).json({ error: `转录失败: ${err.message}` });
  }
});

/** GET /api/douyin/styles - 获取 AI 风格预设列表 */
router.get("/styles", (_req, res) => {
  res.json(getStylePresets());
});

/** POST /api/douyin/rewrite - AI 改写文案 */
router.post("/rewrite", async (req, res) => {
  const { text, style, prompt } = req.body;
  if (!text) {
    res.status(400).json({ error: "请提供文案内容" });
    return;
  }

  try {
    const result = await rewriteText({ text, style, prompt });
    res.json({ rewritten: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/douyin/tts - AI 配音 */
router.post("/tts", async (req, res) => {
  const { text, voice, speed } = req.body;
  if (!text) {
    res.status(400).json({ error: "请提供配音文本" });
    return;
  }

  try {
    const filePath = await generateSpeech({ text, voice, speed: speed ? parseFloat(speed) : undefined });
    res.json({ audioUrl: `/files/${filePath.split("/").slice(-2).join("/")}` });
  } catch (err: any) {
    res.status(500).json({ error: `配音失败: ${err.message}` });
  }
});

/** POST /api/douyin/add-task - 把已下载的视频加入转录任务队列 */
router.post("/add-task", (req, res) => {
  const { videoPath, videoId, filename } = req.body;
  if (!videoPath) {
    res.status(400).json({ error: "请提供视频路径" });
    return;
  }
  const taskId = videoId || randomUUID();
  const db = getDb();
  // 检查是否已存在
  const existing = db.prepare("SELECT id FROM tasks WHERE id = ?").get(taskId);
  if (existing) {
    res.json({ taskId, status: "exists" });
    return;
  }
  db.prepare(
    "INSERT INTO tasks (id, filename, original_path) VALUES (?, ?, ?)"
  ).run(taskId, filename || `${taskId}.mp4`, videoPath);
  res.json({ taskId, status: "pending" });
});

// ==================== Cookie 登录相关 ====================

const COOKIE_FILE = resolve("data/douyin_cookies.txt");
let loginProcess: any = null;

/** GET /api/douyin/cookie-status - 检查 cookies 是否有效 */
router.get("/cookie-status", (_req, res) => {
  const exists = existsSync(COOKIE_FILE);
  if (!exists) {
    res.json({ status: "none", message: "未登录" });
    return;
  }
  // 检查文件内容是否有 sessionid（真正的登录标志）
  const content = rfs(COOKIE_FILE, "utf-8");
  // 必须有 sessionid 才算真正登录（passport_csrf_token 不够）
  const hasSession = /\bsessionid\t/.test(content);
  // statSync imported at top
  const stat = statSync(COOKIE_FILE);
  const ageHours = (Date.now() - stat.mtimeMs) / 1000 / 3600;

  let status = "none";
  let message = "未登录";
  if (hasSession && ageHours <= 24) {
    status = "ok"; message = "已登录";
    // 登录有效时，自动恢复定时抓取
    if (!isSchedulerRunning()) {
      const db = getDb();
      const autoFetchCount = (db.prepare("SELECT COUNT(*) as c FROM bloggers WHERE auto_fetch_enabled = 1").get() as any)?.c || 0;
      if (autoFetchCount > 0) {
        startScheduler(60);
        console.log(`[CookieCheck] 登录有效，自动恢复定时抓取（${autoFetchCount} 个博主）`);
      }
    }
  } else if (hasSession && ageHours > 24) {
    status = "expired"; message = `登录可能已过期（${Math.round(ageHours)}小时前）`;
  } else {
    status = "none"; message = "未登录（Cookies 无效）";
  }

  res.json({
    status,
    message,
    ageHours: Math.round(ageHours),
  });
});

/** POST /api/douyin/login - 启动浏览器扫码登录 */
router.post("/login", (_req, res) => {
  if (loginProcess) {
    res.json({ status: "already_running", message: "登录窗口已打开" });
    return;
  }

  const config = getConfig();
  const scriptPath = resolve("python/douyin_login.py");

  loginProcess = spawn(config.transcribe.pythonPath, [
    scriptPath,
    "--output", COOKIE_FILE,
    "--timeout", "180",
  ], {
    env: { ...process.env },
  });

  let lastOutput = "";
  loginProcess.stdout.on("data", (data: Buffer) => {
    lastOutput = data.toString().trim();
    console.log("[DouyinLogin] stdout:", lastOutput);
  });
  loginProcess.stderr.on("data", (data: Buffer) => {
    console.log("[DouyinLogin]", data.toString().trim());
  });
  loginProcess.on("close", () => {
    loginProcess = null;
  });

  res.json({ status: "started", message: "浏览器已打开，请扫码登录" });
});

/** GET /api/douyin/login-qrcode - 获取登录二维码截图 */
router.get("/login-qrcode", (_req, res) => {
  const qrPath = resolve("data/login_qrcode.png");
  if (existsSync(qrPath)) {
    res.set('Cache-Control', 'no-cache, no-store');
    res.set('Content-Type', 'image/png');
    res.send(rfs(qrPath));
  } else {
    res.status(404).json({ error: "二维码未就绪" });
  }
});

/** GET /api/douyin/login-status - 检查登录状态 */
router.get("/login-status", (_req, res) => {
  if (loginProcess) {
    const qrPath = resolve("data/login_qrcode.png");
    const hasQr = existsSync(qrPath);
    res.json({ status: "waiting", message: "等待扫码...", hasQrcode: hasQr });
    return;
  }
  // 进程结束了，检查 cookie 文件
  if (existsSync(COOKIE_FILE)) {
    // statSync imported at top
    const stat = statSync(COOKIE_FILE);
    const ageSeconds = (Date.now() - stat.mtimeMs) / 1000;
    if (ageSeconds < 10) {
      // 登录成功后，自动恢复定时抓取（如果有博主开启了自动抓取）
      if (!isSchedulerRunning()) {
        const db = getDb();
        const autoFetchCount = (db.prepare("SELECT COUNT(*) as c FROM bloggers WHERE auto_fetch_enabled = 1").get() as any)?.c || 0;
        if (autoFetchCount > 0) {
          startScheduler(60);
          console.log(`[Login] 登录成功，自动恢复定时抓取（${autoFetchCount} 个博主）`);
        }
      }
      res.json({ status: "ok", message: "登录成功！" });
      return;
    }
  }
  res.json({ status: "failed", message: "登录失败或超时" });
});

/** POST /api/douyin/author-videos - 获取作者全部视频列表 */
router.post("/author-videos", async (req, res) => {
  const { userUrl, limit } = req.body;
  if (!userUrl) {
    res.status(400).json({ error: "请提供作者主页 URL" });
    return;
  }

  if (!existsSync(COOKIE_FILE)) {
    res.status(401).json({ error: "请先登录抖音", needLogin: true });
    return;
  }

  const config = getConfig();
  const scriptPath = resolve("python/douyin_videos.py");

  try {
    const { stdout, stderr } = await execFileAsync(config.transcribe.pythonPath, [
      scriptPath,
      "--url", userUrl,
      "--cookies", COOKIE_FILE,
      "--limit", String(limit || 0),
    ], { timeout: 300000, maxBuffer: 50 * 1024 * 1024 });

    if (stderr) console.log("[DouyinVideos]", stderr.trim());

    const result = JSON.parse(stdout.trim());
    if (result.error) {
      if (result.error === "cookies_expired") {
        res.status(401).json({ error: result.message, needLogin: true });
      } else {
        res.status(500).json({ error: result.message });
      }
      return;
    }
    saveVideosToDB(result);
    console.log(`[DouyinVideos] 保存 ${result.length} 条视频到解析记录`);

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: `获取视频列表失败: ${err.message}` });
  }
});

/** POST /api/douyin/batch-download - 批量下载视频（通过 iesdouyin 直链） */
router.post("/batch-download", async (req, res) => {
  const { videos } = req.body;
  if (!videos?.length) {
    res.status(400).json({ error: "请提供视频列表" });
    return;
  }

  const db = getDb();
  const results: any[] = [];

  for (const v of videos) {
    try {
      const videoPath = await downloadVideo(v.url, v.id, v.video_url);

      // 自动加入转录任务队列
      const existing = db.prepare("SELECT id FROM tasks WHERE id = ?").get(v.id);
      if (!existing) {
        const filename = (v.title || v.id).slice(0, 30) + ".mp4";
        db.prepare("INSERT INTO tasks (id, filename, original_path) VALUES (?, ?, ?)").run(v.id, filename, videoPath);
      }

      results.push({ id: v.id, status: "ok" });
    } catch (err: any) {
      results.push({ id: v.id, status: "failed", error: err.message.slice(-200) });
    }
  }
  res.json({ results });
});

// ==================== 龙虎榜 ====================

/** GET /api/douyin/ranking/videos - 视频排行 */
router.get("/ranking/videos", (req, res) => {
  const sortBy = (req.query.sort as string) || "likes";
  const db = getDb();
  const orderMap: Record<string, string> = {
    likes: "like_count DESC",
    comments: "comment_count DESC",
    collects: "collect_count DESC",
    duration: "duration DESC",
  };
  const order = orderMap[sortBy] || "like_count DESC";
  const videos = db.prepare(`SELECT id, title, thumbnail, uploader, uploader_id, uploader_avatar, duration, like_count, comment_count, share_count, collect_count, upload_date, created_at FROM douyin_videos ORDER BY ${order}`).all();
  res.json(videos);
});

/** GET /api/douyin/ranking/bloggers - 博主排行（按视频总点赞） */
router.get("/ranking/bloggers", (_req, res) => {
  const db = getDb();
  const bloggers = db.prepare(`
    SELECT d.uploader as name, d.uploader_id as unique_id,
      COALESCE(NULLIF(d.uploader_avatar, ''), b.avatar, '') as avatar,
      COUNT(*) as video_count,
      SUM(d.like_count) as total_likes,
      SUM(d.comment_count) as total_comments,
      SUM(d.collect_count) as total_collects,
      AVG(d.like_count) as avg_likes
    FROM douyin_videos d
    LEFT JOIN bloggers b ON d.uploader = b.name OR d.uploader_id = b.unique_id
    WHERE d.uploader != ''
    GROUP BY d.uploader
    ORDER BY total_likes DESC
    LIMIT 20
  `).all();
  res.json(bloggers);
});

/** GET /api/douyin/ranking/snapshots - 数据快照（趋势分析） */
router.get("/ranking/snapshots", (_req, res) => {
  const db = getDb();
  const snapshots = db.prepare(`
    SELECT s.video_id, s.like_count, s.comment_count, s.collect_count, s.view_count, s.snapshot_at,
      v.title, v.uploader
    FROM video_snapshots s
    LEFT JOIN douyin_videos v ON s.video_id = v.id
    ORDER BY s.snapshot_at DESC
  `).all();
  res.json(snapshots);
});

/** GET /api/douyin/ranking/today - 今日新增视频 */
router.get("/ranking/today", (_req, res) => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '%';
  const videos = db.prepare(`
    SELECT * FROM douyin_videos
    WHERE upload_date LIKE ?
    ORDER BY like_count DESC
  `).all(today);
  res.json(videos);
});

/** GET /api/douyin/ranking/stats - 数据概览统计 */
router.get("/ranking/stats", (_req, res) => {
  const db = getDb();
  const totalVideos = (db.prepare("SELECT COUNT(*) as c FROM douyin_videos").get() as any).c;
  const totalBloggers = (db.prepare("SELECT COUNT(DISTINCT uploader) as c FROM douyin_videos WHERE uploader != ''").get() as any).c;
  const totalLikes = (db.prepare("SELECT SUM(like_count) as s FROM douyin_videos").get() as any).s || 0;
  const totalComments = (db.prepare("SELECT SUM(comment_count) as s FROM douyin_videos").get() as any).s || 0;
  const totalCollects = (db.prepare("SELECT SUM(collect_count) as s FROM douyin_videos").get() as any).s || 0;
  const avgLikes = totalVideos > 0 ? Math.round(totalLikes / totalVideos) : 0;
  const avgDuration = (db.prepare("SELECT AVG(duration) as a FROM douyin_videos WHERE duration > 0").get() as any).a || 0;

  // 每月发布量
  const monthly = db.prepare(`
    SELECT SUBSTR(upload_date, 1, 6) as month, COUNT(*) as count,
      SUM(like_count) as likes, AVG(like_count) as avg_likes
    FROM douyin_videos
    WHERE upload_date != ''
    GROUP BY month
    ORDER BY month DESC
    LIMIT 12
  `).all();

  // 时长分布
  const durationDist = db.prepare(`
    SELECT
      CASE
        WHEN duration < 60 THEN '0-1分钟'
        WHEN duration < 180 THEN '1-3分钟'
        WHEN duration < 300 THEN '3-5分钟'
        ELSE '5分钟以上'
      END as range,
      COUNT(*) as count
    FROM douyin_videos WHERE duration > 0
    GROUP BY range
    ORDER BY MIN(duration)
  `).all();

  // 高互动率视频（点赞/时长比最高）
  const highEngagement = db.prepare(`
    SELECT id, title, thumbnail, uploader, upload_date, duration, like_count, comment_count, collect_count,
      ROUND(CAST(like_count AS REAL) / MAX(duration, 1), 1) as likes_per_sec
    FROM douyin_videos
    WHERE duration > 0 AND like_count > 0
    ORDER BY likes_per_sec DESC
    LIMIT 10
  `).all();

  res.json({ totalVideos, totalBloggers, totalLikes, totalComments, totalCollects, avgLikes, avgDuration: Math.round(avgDuration), monthly, durationDist, highEngagement });
});

// ==================== 博主管理 ====================

/** POST /api/douyin/follow - 关注博主 */
router.post("/follow", (req, res) => {
  const { name, uniqueId, avatar, secUid, url } = req.body;
  if (!name) { res.status(400).json({ error: "请提供博主信息" }); return; }
  const db = getDb();
  const id = uniqueId || name;
  const existing = db.prepare("SELECT id FROM bloggers WHERE id = ?").get(id);
  if (existing) {
    res.json({ ok: true, status: "already_followed" });
    return;
  }
  db.prepare("INSERT INTO bloggers (id, name, unique_id, avatar, sec_uid, url) VALUES (?, ?, ?, ?, ?, ?)").run(
    id, name, uniqueId || "", avatar || "", secUid || "", url || ""
  );
  res.json({ ok: true, status: "followed" });
});

/** DELETE /api/douyin/follow/:id - 取消关注 */
router.delete("/follow/:id", (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM bloggers WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

/** GET /api/douyin/bloggers - 获取关注的博主列表 */
router.get("/bloggers", (_req, res) => {
  const db = getDb();
  const bloggers = db.prepare("SELECT * FROM bloggers ORDER BY created_at DESC").all();
  res.json(bloggers);
});

// ==================== 定时抓取 ====================

/** POST /api/douyin/scheduler/start - 启动定时抓取 */
router.post("/scheduler/start", (req, res) => {
  const interval = parseInt(req.body.interval) || 60;
  startScheduler(interval);
  res.json({ ok: true, interval });
});

/** POST /api/douyin/scheduler/stop - 停止定时抓取 */
router.post("/scheduler/stop", (_req, res) => {
  stopScheduler();
  res.json({ ok: true });
});

/** GET /api/douyin/scheduler/status - 查询定时抓取状态 */
router.get("/scheduler/status", (_req, res) => {
  res.json({ running: isSchedulerRunning(), stopReason: getStopReason() });
});

/** POST /api/douyin/scheduler/fetch-now - 手动触发一次抓取 */
router.post("/scheduler/fetch-now", async (_req, res) => {
  try {
    const result = await fetchAllBloggers();
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/douyin/bloggers/:id/auto-fetch - 切换博主自动抓取 */
router.put("/bloggers/:id/auto-fetch", (req, res) => {
  const { enabled } = req.body;
  const db = getDb();
  db.prepare("UPDATE bloggers SET auto_fetch_enabled = ? WHERE id = ?").run(enabled ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

export default router;
