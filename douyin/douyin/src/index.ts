import express from "express";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import JSON5 from "json5";

// 加载 .env 环境变量
try {
  const envContent = readFileSync(resolve(".env"), "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx > 0) {
      const key = trimmed.substring(0, idx).trim();
      const val = trimmed.substring(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch {}

import { loadConfig } from "./config.js";
import { initDb, getDb } from "./db/index.js";
import uploadRouter from "./api/upload.js";
import tasksRouter from "./api/tasks.js";
import douyinRouter from "./api/douyin.js";
import voiceRouter from "./api/voice.js";
import { startWorker } from "./services/worker.js";
import { startScheduler, isSchedulerRunning } from "./services/scheduler.js";

function autoResumeScheduler() {
  try {
    if (isSchedulerRunning()) return;
    const cookieFile = resolve("data/douyin_cookies.txt");
    if (!existsSync(cookieFile)) return;
    const content = readFileSync(cookieFile, "utf-8");
    const ageHours = (Date.now() - statSync(cookieFile).mtimeMs) / 1000 / 3600;
    if (!/\bsessionid\t/.test(content) || ageHours > 24) return;
    const db = getDb();
    const count = (db.prepare("SELECT COUNT(*) as c FROM bloggers WHERE auto_fetch_enabled = 1").get() as any)?.c || 0;
    if (count > 0) {
      startScheduler(60);
      console.log(`[Server] 自动恢复定时抓取（${count} 个博主）`);
    }
  } catch (e: any) { console.log("[Server] 定时抓取自动恢复跳过:", e.message); }
}

let config = loadConfig();
mkdirSync(resolve(config.server.uploadDir), { recursive: true });
initDb(config.database.path);

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(resolve("public")));
app.use("/files", express.static(resolve(config.server.uploadDir)));

app.use("/api/upload", uploadRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/douyin", douyinRouter);
app.use("/api/voices", voiceRouter);

app.get("/health", (_req, res) => { res.json({ status: "ok" }); });

// 安全文件名校验（只允许 UUID + 扩展名）
function isSafeFilename(name: string): boolean {
  return /^[a-zA-Z0-9_-]+\.(mp3|wav|mp4)$/.test(name);
}

// 列出 TTS 生成的音频文件
app.get("/api/tts-files", (_req, res) => {
  const config = loadConfig();
  const ttsDir = resolve(config.server.uploadDir, "tts");
  try {
    const files = readdirSync(ttsDir).filter((f: string) => f.endsWith(".mp3") || f.endsWith(".wav"))
      .map((f: string) => {
        const s = statSync(resolve(ttsDir, f));
        return { name: f, size: s.size, created_at: s.mtime.toISOString(), url: `/files/tts/${f}` };
      })
      .sort((a: { created_at: string }, b: { created_at: string }) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json(files);
  } catch (err) {
    console.error("[TTS] 列出文件失败:", err);
    res.json([]);
  }
});

// 删除 TTS 文件
app.delete("/api/tts-files/:name", (req, res) => {
  const name = req.params.name;
  if (!isSafeFilename(name)) {
    res.status(400).json({ error: "非法文件名" });
    return;
  }
  const config = loadConfig();
  const filePath = resolve(config.server.uploadDir, "tts", name);
  try {
    unlinkSync(filePath);
    res.json({ ok: true });
  } catch (err: any) { res.status(404).json({ error: err.message }); }
});

// 获取当前模型配置
app.get("/api/config/model", (_req, res) => {
  config = loadConfig();
  res.json({ modelPath: config.transcribe.modelPath });
});

// 切换模型
app.post("/api/config/model", (req, res) => {
  const { modelPath } = req.body;
  if (!modelPath) { res.status(400).json({ error: "请提供 modelPath" }); return; }
  try {
    const configFile = resolve("config.json5");
    const raw = readFileSync(configFile, "utf-8");
    const parsed = JSON5.parse(raw);
    parsed.transcribe = parsed.transcribe || {};
    parsed.transcribe.modelPath = modelPath;
    writeFileSync(configFile, JSON.stringify(parsed, null, 2));
    config = loadConfig();
    console.log(`[Config] 模型已切换为: ${modelPath}`);
    res.json({ ok: true, modelPath });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 取消处理中的任务
app.post("/api/tasks/:id/cancel", (req, res) => {
  const db = getDb();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id) as any;
  if (!task) { res.status(404).json({ error: "任务不存在" }); return; }
  if (task.status !== "processing" && task.status !== "pending") {
    res.status(400).json({ error: "只能取消排队中或处理中的任务" }); return;
  }
  db.prepare("UPDATE tasks SET status = 'failed', error = '用户取消', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  db.prepare("UPDATE segments SET status = 'failed', error = '用户取消', updated_at = datetime('now') WHERE task_id = ? AND status IN ('pending', 'processing')").run(req.params.id);
  res.json({ ok: true });
});

// 重试失败的任务
app.post("/api/tasks/:id/retry", (req, res) => {
  const db = getDb();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id) as any;
  if (!task) { res.status(404).json({ error: "任务不存在" }); return; }
  db.prepare("UPDATE tasks SET status = 'pending', error = NULL, completed_segments = 0, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  db.prepare("DELETE FROM segments WHERE task_id = ?").run(req.params.id);
  res.json({ ok: true });
});

const server = app.listen(config.server.port, config.server.host, () => {
  console.log(`[Server] 音视频转文字服务已启动: http://localhost:${config.server.port}`);
  console.log(`[Server] 当前模型: ${config.transcribe.modelPath}`);

  // 启动时自动恢复定时抓取（如果 cookie 有效且有自动抓取博主）
  autoResumeScheduler();
});

startWorker();

process.on("SIGINT", () => { console.log("\n[Server] 正在关闭..."); server.close(() => process.exit(0)); });
process.on("SIGTERM", () => { server.close(() => process.exit(0)); });
