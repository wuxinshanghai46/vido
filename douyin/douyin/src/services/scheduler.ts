import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { getDb } from "../db/index.js";
import { getConfig } from "../config.js";
import { saveVideosToDB } from "../db/helpers.js";

const execFileAsync = promisify(execFile);

let intervalId: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let stopReason = "";  // 自动停止原因

const COOKIE_FILE = resolve("data/douyin_cookies.txt");

/** 启动定时抓取（每小时执行一次） */
export function startScheduler(intervalMinutes = 60): void {
  if (intervalId) return;
  stopReason = "";
  console.log(`[Scheduler] 定时抓取已启动，间隔 ${intervalMinutes} 分钟`);
  intervalId = setInterval(() => fetchAllBloggers(), intervalMinutes * 60 * 1000);
  // 启动后 30 秒执行一次
  setTimeout(() => fetchAllBloggers(), 30000);
}

/** 停止定时抓取 */
export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[Scheduler] 定时抓取已停止");
  }
}

/** 手动触发一次抓取 */
export async function fetchAllBloggers(): Promise<{ ok: number; fail: number }> {
  if (isRunning) {
    console.log("[Scheduler] 上一次抓取尚未完成，跳过");
    return { ok: 0, fail: 0 };
  }

  if (!existsSync(COOKIE_FILE)) {
    console.log("[Scheduler] 未登录抖音，自动停止定时抓取");
    stopReason = "cookie 文件不存在，请重新登录抖音";
    stopScheduler();
    return { ok: 0, fail: 0 };
  }

  isRunning = true;
  let ok = 0, fail = 0;

  try {
    const db = getDb();
    const bloggers = db.prepare(
      "SELECT * FROM bloggers WHERE auto_fetch_enabled = 1 ORDER BY last_fetched_at ASC NULLS FIRST"
    ).all() as any[];

    if (!bloggers.length) {
      console.log("[Scheduler] 无需抓取的博主");
      return { ok: 0, fail: 0 };
    }

    console.log(`[Scheduler] 开始抓取 ${bloggers.length} 位博主`);
    const config = getConfig();
    const scriptPath = resolve("python/douyin_videos.py");

    for (const b of bloggers) {
      if (!b.url) continue;
      try {
        console.log(`[Scheduler] 抓取 ${b.name}...`);
        const { stdout, stderr } = await execFileAsync(config.transcribe.pythonPath, [
          scriptPath,
          "--url", b.url,
          "--cookies", COOKIE_FILE,
          "--limit", "0",
        ], { timeout: 300000, maxBuffer: 50 * 1024 * 1024 });

        if (stderr) console.log(`[Scheduler] ${b.name}:`, stderr.trim().slice(-200));

        const result = JSON.parse(stdout.trim());
        if (result.error) {
          // 检测 cookie 过期
          if (result.error === "cookies_expired" || result.message?.includes("cookie") || result.message?.includes("登录")) {
            console.error(`[Scheduler] Cookie 已过期，自动停止定时抓取`);
            stopReason = "抖音登录已过期，请重新登录";
            stopScheduler();
            return { ok, fail: fail + 1 };
          }
          console.error(`[Scheduler] ${b.name} 失败:`, result.message);
          fail++;
          continue;
        }

        saveVideosToDB(result);

        // 更新最后抓取时间
        db.prepare("UPDATE bloggers SET last_fetched_at = datetime('now') WHERE id = ?").run(b.id);
        console.log(`[Scheduler] ${b.name}: ${result.length} 条视频已更新`);
        ok++;
      } catch (err: any) {
        console.error(`[Scheduler] ${b.name} 抓取失败:`, err.message.slice(-200));
        fail++;
      }
    }
  } finally {
    isRunning = false;
  }

  // 全部失败时，可能是 cookie 过期
  if (ok === 0 && fail > 0) {
    console.warn(`[Scheduler] 全部抓取失败(${fail}个)，可能是登录已过期，自动停止`);
    stopReason = "全部抓取失败，可能是登录已过期，请重新登录抖音";
    stopScheduler();
  }

  console.log(`[Scheduler] 抓取完成: ${ok} 成功, ${fail} 失败`);
  return { ok, fail };
}

export function isSchedulerRunning(): boolean {
  return intervalId !== null;
}

export function getStopReason(): string {
  return stopReason;
}
