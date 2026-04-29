import { Router } from "express";
import { getDb } from "../db/index.js";

const router = Router();

/** GET /api/tasks - 获取所有任务列表 */
router.get("/", (_req, res) => {
  const db = getDb();
  const tasks = db.prepare(
    "SELECT id, filename, status, total_segments, completed_segments, duration_seconds, error, created_at, updated_at FROM tasks ORDER BY created_at DESC"
  ).all();
  res.json(tasks);
});

/** GET /api/tasks/:id - 获取任务详情 */
router.get("/:id", (req, res) => {
  const db = getDb();
  const task = db.prepare(
    "SELECT * FROM tasks WHERE id = ?"
  ).get(req.params.id);

  if (!task) {
    res.status(404).json({ error: "任务不存在" });
    return;
  }

  const segments = db.prepare(
    "SELECT segment_index, status, start_time, end_time, result, error FROM segments WHERE task_id = ? ORDER BY segment_index"
  ).all(req.params.id);

  res.json({ ...task as any, segments });
});

/** GET /api/tasks/:id/result - 获取纯文本转录结果 */
router.get("/:id/result", (req, res) => {
  const db = getDb();
  const task = db.prepare("SELECT status, result FROM tasks WHERE id = ?").get(req.params.id) as any;

  if (!task) {
    res.status(404).json({ error: "任务不存在" });
    return;
  }

  if (task.status !== "completed") {
    res.status(400).json({ error: "任务尚未完成", status: task.status });
    return;
  }

  const segments = JSON.parse(task.result || "[]");
  const text = segments.map((s: any) => {
    const start = formatTime(s.start_time);
    const end = formatTime(s.end_time);
    const speaker = s.speaker ? `[${s.speaker}] ` : "";
    return `[${start} -> ${end}] ${speaker}${s.text}`;
  }).join("\n");

  res.type("text/plain").send(text);
});

/** DELETE /api/tasks/:id - 删除任务 */
router.delete("/:id", (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "任务不存在" });
    return;
  }
  res.json({ ok: true });
});

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default router;
