import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getConfig } from "../config.js";

export interface TtsOptions {
  text: string;
  voice?: string;
  speed?: number;
}

/** 使用 edge-tts 生成语音 */
export function generateSpeech(options: TtsOptions): Promise<string> {
  const config = getConfig();
  const voice = options.voice || config.tts.voice;
  const outputDir = resolve(config.server.uploadDir, "tts");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${randomUUID()}.mp3`);

  const scriptPath = resolve("python/tts.py");

  return new Promise((resolve_, reject) => {
    // 语速转换: 1.0 -> "+0%", 1.5 -> "+50%", 0.5 -> "-50%"
    const speed = options.speed ?? 1.0;
    const ratePercent = Math.round((speed - 1) * 100);
    const rateStr = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`;

    const proc = spawn(config.transcribe.pythonPath, [
      scriptPath,
      "--stdin",
      "--voice", voice,
      "--rate", rateStr,
      "--output", outputPath,
    ]);

    let stderr = "";
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    // 通过 stdin 传递文本，避免命令行参数中特殊字符问题
    proc.stdin.write(options.text);
    proc.stdin.end();

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`TTS 生成失败 (code ${code}): ${stderr}`));
        return;
      }
      resolve_(outputPath);
    });

    proc.on("error", (err) => {
      reject(new Error(`TTS 进程启动失败: ${err.message}`));
    });
  });
}
