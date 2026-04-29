import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { Buffer } from "node:buffer";
import { getDb } from "../db/index.js";
import { getConfig } from "../config.js";
import { getDuration } from "../services/audio.js";
import { cloneVoice, enrollVoice } from "../services/voice-clone.js";
import { transcribeAudio } from "../services/transcribe.js";

const router = Router();

function fixFilename(name: string): string {
  try { return Buffer.from(name, "latin1").toString("utf-8"); } catch { return name; }
}

function getUpload() {
  const config = getConfig();
  const dir = resolve(config.server.uploadDir, "voices");
  mkdirSync(dir, { recursive: true });

  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, dir),
      filename: (_req, file, cb) => {
        const ext = fixFilename(file.originalname).substring(
          fixFilename(file.originalname).lastIndexOf(".")
        );
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const name = fixFilename(file.originalname);
      const ext = name.substring(name.lastIndexOf(".")).toLowerCase();
      const allowed = new Set([".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac"]);
      if (allowed.has(ext)) cb(null, true);
      else cb(new Error(`不支持的音频格式: ${ext}`));
    },
  });
}

/** POST /api/voices/upload - 上传声音样本 */
router.post("/upload", (req, res) => {
  const upload = getUpload();
  upload.single("audio")(req, res, async (err) => {
    if (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "请上传音频文件" });
      return;
    }

    try {
      const id = randomUUID();
      const name = req.body.name || fixFilename(req.file.originalname);
      let refText = req.body.ref_text || "";
      let duration = 0;
      try { duration = await getDuration(req.file.path); } catch (e) {
        console.warn("[Voice] 获取音频时长失败:", (e as Error).message);
      }

      // 如果没有填写参考文本，自动用 Whisper 转写
      if (!refText) {
        console.log(`[Voice] 未填写参考文本，正在自动转写: ${req.file.path}`);
        try {
          const segments = await transcribeAudio(req.file.path);
          refText = segments.map((s: any) => s.text).join("");
          console.log(`[Voice] 自动转写完成: ${refText.slice(0, 50)}...`);
        } catch (e: any) {
          console.error(`[Voice] 自动转写失败: ${e.message}`);
        }
      }

      const db = getDb();

      // 注册声音到 CosyVoice
      let cosyvoiceId = "";
      try {
        console.log("[Voice] 正在注册声音到 CosyVoice...");
        cosyvoiceId = await enrollVoice(req.file.path);
        console.log(`[Voice] CosyVoice 注册成功: ${cosyvoiceId}`);
      } catch (e: any) {
        console.error(`[Voice] CosyVoice 注册失败: ${e.message}`);
      }

      db.prepare(
        "INSERT INTO voices (id, name, audio_path, ref_text, duration_seconds, cosyvoice_id) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(id, name, req.file.path, refText, duration, cosyvoiceId);

      res.json({ id, name, duration, refText, cosyvoiceId });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
});

/** GET /api/voices - 获取声音列表 */
router.get("/", (_req, res) => {
  const db = getDb();
  const voices = db.prepare(
    "SELECT id, name, ref_text, audio_path, duration_seconds, cosyvoice_id, created_at FROM voices ORDER BY created_at DESC"
  ).all();
  // 添加播放 URL
  const result = (voices as any[]).map(v => ({
    ...v,
    audioUrl: v.audio_path ? `/files/${v.audio_path.split("/").slice(-2).join("/")}` : '',
  }));
  res.json(result);
});

/** POST /api/voices/:id/enroll - 手动注册声音到 CosyVoice */
router.post("/:id/enroll", async (req, res) => {
  const db = getDb();
  const voice = db.prepare("SELECT * FROM voices WHERE id = ?").get(req.params.id) as any;
  if (!voice) { res.status(404).json({ error: "声音不存在" }); return; }

  try {
    console.log(`[Voice] 手动注册声音到 CosyVoice: ${voice.name}`);
    const cosyvoiceId = await enrollVoice(voice.audio_path);
    db.prepare("UPDATE voices SET cosyvoice_id = ? WHERE id = ?").run(cosyvoiceId, req.params.id);
    res.json({ ok: true, cosyvoiceId });
  } catch (err: any) {
    res.status(500).json({ error: `注册失败: ${err.message}` });
  }
});

/** PUT /api/voices/:id/ref-text - 更新参考文本 */
router.put("/:id/ref-text", (req, res) => {
  const { refText } = req.body;
  const db = getDb();
  const result = db.prepare("UPDATE voices SET ref_text = ? WHERE id = ?").run(refText || "", req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: "声音不存在" }); return; }
  res.json({ ok: true });
});

/** DELETE /api/voices/:id - 删除声音样本 */
router.delete("/:id", (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM voices WHERE id = ?").run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "声音不存在" });
    return;
  }
  res.json({ ok: true });
});

/** POST /api/voices/synthesize - 使用克隆声音合成语音 */
router.post("/synthesize", async (req, res) => {
  const { voiceId, text, speed } = req.body;
  if (!voiceId || !text) {
    res.status(400).json({ error: "请提供 voiceId 和 text" });
    return;
  }

  const db = getDb();
  const voice = db.prepare("SELECT * FROM voices WHERE id = ?").get(voiceId) as any;
  if (!voice) {
    res.status(404).json({ error: "声音不存在" });
    return;
  }

  if (!voice.cosyvoice_id) {
    res.status(400).json({ error: "该声音还未注册到云端，请先在音色库中点击「注册到云端」" });
    return;
  }

  try {
    // 如果没有参考文本，先用 faster-whisper 转录参考音频
    let refText = voice.ref_text;
    if (!refText) {
      console.log("[Voice] 参考文本为空，正在用 Whisper 识别...");
      const segments = await transcribeAudio(voice.audio_path);
      refText = segments.map((s: any) => s.text).join("");
      // 保存到数据库，下次不用再识别
      db.prepare("UPDATE voices SET ref_text = ? WHERE id = ?").run(refText, voiceId);
      console.log(`[Voice] 参考文本识别完成: ${refText.slice(0, 50)}...`);
    }

    const outputPath = await cloneVoice({
      refAudio: voice.audio_path,
      refText,
      genText: text,
      speed: speed || 1.0,
      cosyvoiceId: voice.cosyvoice_id,
    });

    const relativePath = outputPath.split("/").slice(-2).join("/");
    res.json({ audioUrl: `/files/${relativePath}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
