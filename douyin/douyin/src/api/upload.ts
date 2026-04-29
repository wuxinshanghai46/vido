import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { Buffer } from "node:buffer";
import { getConfig } from "../config.js";
import { getDb } from "../db/index.js";

/** 修复 multer 中文文件名乱码 (Latin-1 → UTF-8) */
function fixFilename(name: string): string {
  // 检查是否每个字符都在 latin1 范围内 (0-255)
  // 如果包含多字节 Unicode 字符，说明已经是正确的 UTF-8，无需转换
  const isLatin1 = [...name].every(ch => ch.charCodeAt(0) <= 255);
  if (!isLatin1) return name;
  try {
    const decoded = Buffer.from(name, "latin1").toString("utf-8");
    // 如果转换后包含替换字符，说明原始数据不是合法的 UTF-8 字节序列，返回原始值
    if (decoded.includes("\ufffd")) return name;
    return decoded;
  } catch {
    return name;
  }
}

const router = Router();

// 支持的文件类型
const ALLOWED_EXTENSIONS = new Set([
  ".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma",
  ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".flv", ".ts",
]);

function getUpload() {
  const config = getConfig();
  const uploadDir = resolve(config.server.uploadDir);
  mkdirSync(uploadDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const name = fixFilename(file.originalname);
      const ext = name.substring(name.lastIndexOf("."));
      cb(null, `${randomUUID()}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: config.server.maxUploadMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const name = fixFilename(file.originalname);
      const ext = name.substring(name.lastIndexOf(".")).toLowerCase();
      if (ALLOWED_EXTENSIONS.has(ext)) {
        cb(null, true);
      } else {
        cb(new Error(`不支持的文件格式: ${ext}`));
      }
    },
  });
}

/** POST /api/upload - 上传音视频文件并创建转录任务 */
router.post("/", (req, res, next) => {
  const upload = getUpload();
  upload.single("file")(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        res.status(400).json({ error: err.message });
      } else {
        res.status(400).json({ error: (err as Error).message });
      }
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "请上传文件" });
      return;
    }

    const taskId = randomUUID();
    const db = getDb();
    const filename = fixFilename(req.file.originalname);

    db.prepare(
      "INSERT INTO tasks (id, filename, original_path) VALUES (?, ?, ?)"
    ).run(taskId, filename, req.file.path);

    res.json({
      taskId,
      filename,
      status: "pending",
    });
  });
});

export default router;
