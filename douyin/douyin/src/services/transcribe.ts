import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { getConfig } from "../config.js";

export interface TranscriptionSegment {
  start_time: number;
  end_time: number;
  speaker: string;
  text: string;
}

/**
 * 调用 Python 脚本进行语音识别
 * 返回转录结果 (JSON 格式的 segments)
 */
export function transcribeAudio(audioPath: string): Promise<TranscriptionSegment[]> {
  const config = getConfig();
  const scriptPath = resolve("python/transcribe.py");

  return new Promise((resolve_, reject) => {
    const proc = spawn(config.transcribe.pythonPath, [
      scriptPath,
      "--model_path", config.transcribe.modelPath,
      "--audio_file", audioPath,
    ], { timeout: 600000 }); // 10 分钟超时

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Transcription failed (code ${code}): ${stderr}`));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        resolve_(result);
      } catch {
        reject(new Error(`Failed to parse transcription output: ${stdout}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start Python process: ${err.message}`));
    });
  });
}
