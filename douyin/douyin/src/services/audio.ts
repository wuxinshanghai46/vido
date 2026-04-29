import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join, basename, extname } from "node:path";
import { mkdirSync } from "node:fs";

const execFileAsync = promisify(execFile);

/** 获取音视频文件时长 (秒) */
export async function getDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    filePath,
  ]);
  const info = JSON.parse(stdout);
  return parseFloat(info.format.duration);
}

/** 从视频中提取音频, 或转换音频格式为 WAV */
export async function extractAudio(
  inputPath: string,
  outputDir: string,
  sampleRate: number
): Promise<string> {
  mkdirSync(outputDir, { recursive: true });
  const name = basename(inputPath, extname(inputPath));
  const outputPath = join(outputDir, `${name}.wav`);

  await execFileAsync("ffmpeg", [
    "-i", inputPath,
    "-vn",
    "-acodec", "pcm_s16le",
    "-ar", String(sampleRate),
    "-ac", "1",
    "-y",
    outputPath,
  ]);

  return outputPath;
}

/**
 * 将音频分割成多个片段
 * 返回片段文件路径和时间信息
 */
export async function splitAudio(
  audioPath: string,
  outputDir: string,
  maxSegmentSeconds: number
): Promise<Array<{ path: string; startTime: number; endTime: number }>> {
  const duration = await getDuration(audioPath);

  if (duration <= maxSegmentSeconds) {
    return [{ path: audioPath, startTime: 0, endTime: duration }];
  }

  mkdirSync(outputDir, { recursive: true });
  const name = basename(audioPath, extname(audioPath));
  const segments: Array<{ path: string; startTime: number; endTime: number }> = [];
  let start = 0;
  let index = 0;

  while (start < duration) {
    const end = Math.min(start + maxSegmentSeconds, duration);
    const segPath = join(outputDir, `${name}_seg${index}.wav`);

    await execFileAsync("ffmpeg", [
      "-i", audioPath,
      "-ss", String(start),
      "-t", String(end - start),
      "-acodec", "pcm_s16le",
      "-y",
      segPath,
    ]);

    segments.push({ path: segPath, startTime: start, endTime: end });
    start = end;
    index++;
  }

  return segments;
}
