/**
 * 视频抠像 + 背景合成 pipeline
 *
 * matteVideo(videoPath, outMattedPath, opts)
 *   ffmpeg 抽帧 → baidu body_seg 逐帧 → 重新打包为带 alpha 通道的 .mov (Quicktime ProRes 4444)
 *   .mov 保留 alpha，后续合成时直接 overlay
 *
 * composeWithBackground(mattedMov, bgPath, outPath, opts)
 *   bgPath 支持 .jpg/.png（静态）或 .mp4（动态背景视频）
 *   保留 matted 源的音频
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const ffmpegStatic = require('ffmpeg-static');
const { segmentFramesBatch } = require('./baiduMattingService');

const execFileP = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic;

function _ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

/**
 * 探测视频的 fps 和 duration
 */
async function probeVideo(videoPath) {
  const { stdout } = await execFileP(FFMPEG, ['-i', videoPath, '-hide_banner'], { maxBuffer: 10 * 1024 * 1024 }).catch(e => ({ stdout: (e.stderr || e.stdout || '') }));
  // ffmpeg 输出的 "Stream #0:0(und): Video: ... 24 fps"
  const fpsMatch = /,\s*([\d.]+)\s*fps/i.exec(stdout) || /,\s*([\d.]+)\s*tbr/i.exec(stdout);
  const durMatch = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(stdout);
  const fps = fpsMatch ? parseFloat(fpsMatch[1]) : 24;
  const duration = durMatch ? (+durMatch[1] * 3600 + +durMatch[2] * 60 + +durMatch[3]) : 0;
  return { fps, duration };
}

/**
 * 抽帧 → 每帧抠图 → 重新打包为带 alpha 的 mov
 * @param {string} videoPath 输入视频
 * @param {string} outMattedPath 输出 .mov（带 alpha）
 * @param {object} opts { fps?, tmpDir?, qps?, onProgress? }
 */
async function matteVideo(videoPath, outMattedPath, { fps, tmpDir, qps = 8, onProgress } = {}) {
  if (!fs.existsSync(videoPath)) throw new Error('video not found: ' + videoPath);

  const info = await probeVideo(videoPath);
  const targetFps = fps || info.fps || 24;
  const workDir = tmpDir || path.join(path.dirname(outMattedPath), `.matte_${Date.now()}`);
  const framesDir = path.join(workDir, 'frames');
  const mattedDir = path.join(workDir, 'matted');
  _ensureDir(framesDir);
  _ensureDir(mattedDir);

  // Step 1: 抽帧 JPG（JPG 比 PNG 小，传 base64 省流量；百度 body_seg 输入支持 JPG）
  onProgress && onProgress({ stage: 'extract', fps: targetFps });
  await execFileP(FFMPEG, [
    '-y', '-i', videoPath,
    '-vf', `fps=${targetFps}`,
    '-q:v', '3', // JPG 质量
    path.join(framesDir, 'f_%05d.jpg'),
    '-loglevel', 'error',
  ], { maxBuffer: 50 * 1024 * 1024 });

  const frameNames = fs.readdirSync(framesDir).filter(n => n.endsWith('.jpg')).sort();
  if (!frameNames.length) throw new Error('抽帧失败：0 帧');
  onProgress && onProgress({ stage: 'extract_done', frames: frameNames.length });

  // Step 2: 每帧抠图（并发 qps）
  const frameBuffers = frameNames.map(n => fs.readFileSync(path.join(framesDir, n)));
  onProgress && onProgress({ stage: 'matting_start', total: frameBuffers.length });
  const mattedBuffers = await segmentFramesBatch(frameBuffers, {
    qps,
    onFrame: (done, total) => onProgress && onProgress({ stage: 'matting_progress', done, total }),
  });

  // Step 3: 写入 matted PNG 序列（每张带 alpha）
  onProgress && onProgress({ stage: 'writing_mattes' });
  mattedBuffers.forEach((buf, i) => {
    fs.writeFileSync(path.join(mattedDir, `m_${String(i + 1).padStart(5, '0')}.png`), buf);
  });

  // Step 4: PNG 序列 → 带 alpha 的 MOV（ProRes 4444，有损但画质高，体积只有 qtrle 的 1/5）
  // 原来用 qtrle 无损 → 20 秒视频 1.4 GB；ProRes 4444 只需 ~300 MB
  onProgress && onProgress({ stage: 'encoding_matte_mov' });
  await execFileP(FFMPEG, [
    '-y',
    '-framerate', String(targetFps),
    '-i', path.join(mattedDir, 'm_%05d.png'),
    '-i', videoPath,
    '-map', '0:v', '-map', '1:a?',
    '-c:v', 'prores_ks',
    '-profile:v', '4444',
    '-pix_fmt', 'yuva444p10le',
    '-c:a', 'aac', '-b:a', '128k',
    '-shortest',
    outMattedPath,
    '-loglevel', 'error',
  ], { maxBuffer: 50 * 1024 * 1024 });

  onProgress && onProgress({ stage: 'matte_done', outputPath: outMattedPath });
  return { outputPath: outMattedPath, frames: frameNames.length, fps: targetFps, tmpDir: workDir };
}

/**
 * 把带 alpha 的 matted mov 叠到背景上
 * @param {string} mattedMov .mov 带 alpha
 * @param {string} bgPath 背景：.jpg/.png 静态或 .mp4 动态
 * @param {string} outPath 输出 .mp4
 * @param {object} opts { width?, height?, scaleMode?, onProgress? }
 */
async function composeWithBackground(mattedMov, bgPath, outPath, { width = 720, height = 1280, scaleMode = 'cover', onProgress } = {}) {
  if (!fs.existsSync(mattedMov)) throw new Error('matted 不存在: ' + mattedMov);
  if (!fs.existsSync(bgPath)) throw new Error('背景不存在: ' + bgPath);

  const isBgVideo = /\.(mp4|mov|webm|mkv)$/i.test(bgPath);
  onProgress && onProgress({ stage: 'compose_start', isBgVideo });

  // 背景尺寸填充方式：
  //   cover: 背景等比填充，溢出部分裁剪（短视频常用）
  //   contain: 完整显示，黑边补齐
  const bgScaleFilter = scaleMode === 'contain'
    ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`
    : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;

  // 人物等比缩到目标尺寸（常见逻辑：铺满画布高度）
  const fgScaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease`;

  const args = ['-y'];

  if (isBgVideo) {
    args.push('-stream_loop', '-1', '-i', bgPath);
  } else {
    args.push('-loop', '1', '-i', bgPath);
  }
  args.push('-i', mattedMov);

  const filter = `[0:v]${bgScaleFilter}[bg];[1:v]${fgScaleFilter}[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[out]`;
  args.push('-filter_complex', filter);
  args.push('-map', '[out]');
  args.push('-map', '1:a?'); // 保留 matted 的音频
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20');
  args.push('-c:a', 'aac', '-b:a', '128k');
  args.push('-shortest', outPath, '-loglevel', 'error');

  await execFileP(FFMPEG, args, { maxBuffer: 50 * 1024 * 1024 });
  onProgress && onProgress({ stage: 'compose_done', outputPath: outPath });
  return { outputPath: outPath };
}

/**
 * 清理临时目录
 */
function cleanup(tmpDir) {
  if (!tmpDir || !fs.existsSync(tmpDir)) return;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

module.exports = {
  probeVideo,
  matteVideo,
  composeWithBackground,
  cleanup,
};
