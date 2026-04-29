import { spawn, execSync } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdirSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getConfig } from "../config.js";

// 获取 Python certifi 证书路径，解决 SSL 问题
let sslCertFile = "";
try {
  sslCertFile = execSync("python3 -c 'import certifi;print(certifi.where())'", { encoding: "utf-8" }).trim();
} catch {}


export interface VoiceCloneOptions {
  refAudio: string;
  refText: string;
  genText: string;
  speed?: number;
  cosyvoiceId?: string;
}

/** 注册声音到 CosyVoice（获取 voice_id） */
export function enrollVoice(audioPath: string): Promise<string> {
  const config = getConfig();
  const scriptPath = resolve("python/cosyvoice.py");

  return new Promise((resolve_, reject) => {
    const proc = spawn(config.transcribe.pythonPath, [
      scriptPath,
      "--mode", "enroll",
      "--audio_file", audioPath,
    ], {
      timeout: 300000,
      env: { ...process.env, ...(sslCertFile ? { SSL_CERT_FILE: sslCertFile } : {}) },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`声音注册失败 (code ${code}): ${stderr.slice(-300)}`));
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        resolve_(result.voice_id);
      } catch {
        reject(new Error(`声音注册失败: 无法解析结果 - ${stdout}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`CosyVoice 进程启动失败: ${err.message}`));
    });
  });
}

/** 使用 CosyVoice 合成语音 */
export function cloneVoice(options: VoiceCloneOptions): Promise<string> {
  const config = getConfig();
  const outputDir = resolve(config.server.uploadDir, "tts");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${randomUUID()}.mp3`);

  const scriptPath = resolve("python/cosyvoice.py");

  if (!options.cosyvoiceId) {
    return Promise.reject(new Error("请先在音色库中注册声音"));
  }

  return new Promise((resolve_, reject) => {
    const proc = spawn(config.transcribe.pythonPath, [
      scriptPath,
      "--mode", "synthesize",
      "--voice_id", options.cosyvoiceId!,
      "--speed", String(options.speed ?? 1.0),
      "--output", outputPath,
      "--stdin",
    ], {
      timeout: 300000,
      env: { ...process.env, ...(sslCertFile ? { SSL_CERT_FILE: sslCertFile } : {}) },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    // 通过 stdin 传递文本
    proc.stdin.write(options.genText);
    proc.stdin.end();

    proc.on("close", (code) => {
      // 检查文件是否生成
      try {
        if (statSync(outputPath).size > 0) {
          resolve_(outputPath);
          return;
        }
      } catch {}

      if (code !== 0) {
        reject(new Error(`语音合成失败 (code ${code}): ${stderr.slice(-300)}`));
        return;
      }
      resolve_(outputPath);
    });

    proc.on("error", (err) => {
      reject(new Error(`CosyVoice 进程启动失败: ${err.message}`));
    });
  });
}
