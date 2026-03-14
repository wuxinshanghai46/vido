const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');

// 优先用环境变量，否则用 npm 内置的 ffmpeg-static
const ffmpegPath = (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== 'ffmpeg')
  ? process.env.FFMPEG_PATH
  : ffmpegStatic;
ffmpeg.setFfmpegPath(ffmpegPath);

async function mergeVideoClips({ clipPaths, outputPath, addSubtitles = false, subtitles = [] }) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    // 创建文件列表（concat demuxer 格式）
    const listPath = outputPath.replace('.mp4', '_list.txt');
    const listContent = clipPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(listPath, listContent);

    const command = ffmpeg()
      .input(listPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions([
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p'
      ])
      .output(outputPath)
      .on('end', () => {
        fs.unlinkSync(listPath);
        resolve(outputPath);
      })
      .on('error', (err) => {
        if (fs.existsSync(listPath)) fs.unlinkSync(listPath);
        reject(err);
      });

    command.run();
  });
}

async function addAudioToVideo({ videoPath, audioPath, outputPath, volume = 0.8 }) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .input(audioPath)
      .outputOptions([
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-filter:a', `volume=${volume}`,
        '-shortest'
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}

async function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
}

// 为动作场景片段添加后期视觉特效增强（FFmpeg filter chain）
// vfxTags: 来自 scene.vfx 的标签数组
// actionType: 来自 scene.action_type
async function applyPostVFX({ inputPath, outputPath, vfxTags = [], actionType = 'normal' }) {
  if (actionType === 'normal' && !vfxTags.length) {
    // 无需处理，直接复制
    fs.copyFileSync(inputPath, outputPath);
    return outputPath;
  }

  return new Promise((resolve, reject) => {
    const filters = [];

    // 根据 action_type 添加基础调色增强
    const actionFilters = {
      combat:    'eq=contrast=1.15:brightness=0.02:saturation=1.2',
      ranged:    'eq=contrast=1.1:brightness=0.03:saturation=1.3',
      chase:     'eq=contrast=1.1:brightness=0.01:saturation=1.15',
      explosion: 'eq=contrast=1.25:brightness=0.05:saturation=1.35',
      power:     'eq=contrast=1.2:brightness=0.04:saturation=1.4',
      stealth:   'eq=contrast=1.3:brightness=-0.05:saturation=0.85',
      aerial:    'eq=contrast=1.1:brightness=0.02:saturation=1.2',
    };

    if (actionFilters[actionType]) {
      filters.push(actionFilters[actionType]);
    }

    // vfx 标签 → FFmpeg filter 映射
    for (const tag of vfxTags) {
      switch (tag) {
        case 'slow_motion':
          // 慢动作效果用 setpts，但不在 filter chain 中（需要单独处理）
          break;
        case 'screen_shake':
          // 轻微随机偏移模拟镜头震动
          filters.push('crop=iw-8:ih-8:4+random(1)*4:4+random(2)*4');
          break;
        case 'impact_flash':
          // 在开头闪白帧效果（使用 fade）
          filters.push('fade=in:st=0:d=0.1:color=white');
          break;
        case 'motion_blur':
          // 轻微运动模糊
          filters.push('boxblur=luma_radius=2:luma_power=1');
          break;
        case 'speed_lines':
          // 增加对比度和锐化来强调速度感
          filters.push('unsharp=5:5:1.5:5:5:0');
          break;
        case 'dust_cloud':
        case 'fire':
          // 暖色调增强
          filters.push('colorbalance=rs=0.1:gs=0.05:bs=-0.05');
          break;
        case 'lightning':
        case 'energy_burst':
          // 高亮/冷色调增强
          filters.push('colorbalance=rs=-0.05:gs=0.05:bs=0.15');
          break;
        case 'aura_glow':
          // 柔光晕效果
          filters.push('gblur=sigma=0.8');
          break;
      }
    }

    if (!filters.length) {
      fs.copyFileSync(inputPath, outputPath);
      return resolve(outputPath);
    }

    // 构建 filter chain
    const filterChain = filters.join(',');
    ffmpeg(inputPath)
      .videoFilters(filterChain)
      .outputOptions(['-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-c:a', 'copy', '-pix_fmt', 'yuv420p'])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => {
        console.warn(`[PostVFX] 特效处理失败，使用原始片段: ${err.message}`);
        // 失败时回退到原始文件
        try { fs.copyFileSync(inputPath, outputPath); } catch {}
        resolve(outputPath);
      })
      .run();
  });
}

module.exports = { mergeVideoClips, addAudioToVideo, getVideoDuration, applyPostVFX };
