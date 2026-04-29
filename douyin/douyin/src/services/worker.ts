import { getDb } from "../db/index.js";
import { getConfig } from "../config.js";
import { extractAudio, splitAudio, getDuration } from "./audio.js";
import { transcribeAudio, type TranscriptionSegment } from "./transcribe.js";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";

/** 处理单个转录任务 */
async function processTask(taskId: string): Promise<void> {
  const db = getDb();
  const config = getConfig();

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as any;
  if (!task) return;

  db.prepare("UPDATE tasks SET status = 'processing', updated_at = datetime('now') WHERE id = ?").run(taskId);

  try {
    const workDir = join(dirname(task.original_path), taskId);
    mkdirSync(workDir, { recursive: true });

    // 1. 获取时长
    const duration = await getDuration(task.original_path);
    db.prepare("UPDATE tasks SET duration_seconds = ?, updated_at = datetime('now') WHERE id = ?").run(duration, taskId);

    // 2. 提取音频 (视频转音频, 或统一格式)
    const audioPath = await extractAudio(task.original_path, workDir, config.transcribe.sampleRate);

    // 3. 按时长分段
    const segments = await splitAudio(audioPath, workDir, config.transcribe.maxSegmentSeconds);

    db.prepare("UPDATE tasks SET total_segments = ?, updated_at = datetime('now') WHERE id = ?").run(segments.length, taskId);

    // 4. 插入分段记录（使用事务）
    const insertSeg = db.prepare(
      "INSERT INTO segments (task_id, segment_index, file_path, start_time, end_time) VALUES (?, ?, ?, ?, ?)"
    );
    const insertAll = db.transaction(() => {
      for (let i = 0; i < segments.length; i++) {
        insertSeg.run(taskId, i, segments[i].path, segments[i].startTime, segments[i].endTime);
      }
    });
    insertAll();

    // 5. 逐段转录
    const allResults: TranscriptionSegment[] = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segRow = db.prepare(
        "SELECT id FROM segments WHERE task_id = ? AND segment_index = ?"
      ).get(taskId, i) as any;

      db.prepare("UPDATE segments SET status = 'processing', updated_at = datetime('now') WHERE id = ?").run(segRow.id);

      try {
        const result = await transcribeAudio(seg.path);

        // 调整时间偏移
        const adjusted = result.map((r) => ({
          ...r,
          start_time: r.start_time + seg.startTime,
          end_time: r.end_time + seg.startTime,
        }));

        allResults.push(...adjusted);

        db.prepare(
          "UPDATE segments SET status = 'completed', result = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(JSON.stringify(adjusted), segRow.id);

        db.prepare(
          "UPDATE tasks SET completed_segments = completed_segments + 1, updated_at = datetime('now') WHERE id = ?"
        ).run(taskId);
      } catch (err: any) {
        db.prepare(
          "UPDATE segments SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(err.message, segRow.id);
        throw err;
      }
    }

    // 6. 汇总结果
    db.prepare(
      "UPDATE tasks SET status = 'completed', result = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(JSON.stringify(allResults), taskId);

  } catch (err: any) {
    db.prepare(
      "UPDATE tasks SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(err.message, taskId);
  }
}

/** 启动后台 worker, 轮询待处理任务 */
export function startWorker(): void {
  const pollInterval = 3000;

  async function poll() {
    try {
      const db = getDb();
      const task = db.prepare(
        "SELECT id FROM tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
      ).get() as any;

      if (task) {
        await processTask(task.id);
      }
    } catch (err) {
      console.error("[Worker] Error:", err);
    }
    setTimeout(poll, pollInterval);
  }

  console.log("[Worker] Started background task processor");
  poll();
}
