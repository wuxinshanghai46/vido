require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');
const { getEdit } = require('../models/editStore');

const ffmpegPath = (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== 'ffmpeg')
  ? process.env.FFMPEG_PATH : ffmpegStatic;
ffmpeg.setFfmpegPath(ffmpegPath);

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');

// 裁剪单个片段
function trimClip(inputPath, outputPath, startSec, endSec) {
  return new Promise((resolve, reject) => {
    const duration = endSec - startSec;
    ffmpeg(inputPath)
      .setStartTime(startSec)
      .setDuration(duration)
      .outputOptions(['-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p'])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}

// 给片段烧录字幕
function burnSubtitle(inputPath, outputPath, text, startSec, durationSec, position = 'bottom', fontSize = 28, color = 'white') {
  return new Promise((resolve, reject) => {
    const safeText = text.replace(/['"\\:]/g, ' ').replace(/\n/g, ' ');
    const yMap = { top: '60', center: '(h-text_h)/2', bottom: '(h-text_h-60)' };
    const y = yMap[position] || yMap.bottom;

    const filter = [
      `drawtext=text='${safeText}'`,
      `fontsize=${fontSize}`,
      `fontcolor=${color}`,
      `x=(w-text_w)/2`,
      `y=${y}`,
      `box=1:boxcolor=black@0.5:boxborderw=8`,
      `enable='between(t,${startSec},${startSec + durationSec})'`
    ].join(':');

    ffmpeg(inputPath)
      .videoFilter(filter)
      .outputOptions(['-c:a', 'copy'])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}

// 合并片段列表
function concatClips(clipPaths, outputPath) {
  return new Promise((resolve, reject) => {
    const listPath = outputPath.replace('.mp4', '_concat.txt');
    fs.writeFileSync(listPath, clipPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
    ffmpeg()
      .input(listPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', '-pix_fmt', 'yuv420p'])
      .output(outputPath)
      .on('end', () => { fs.existsSync(listPath) && fs.unlinkSync(listPath); resolve(outputPath); })
      .on('error', (err) => { fs.existsSync(listPath) && fs.unlinkSync(listPath); reject(err); })
      .run();
  });
}

// 叠加背景音乐
function mixMusic(videoPath, musicPath, outputPath, volume = 0.5, loop = true) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(videoPath).input(musicPath);
    const loopOpt = loop ? ['-stream_loop', '-1'] : [];

    cmd.inputOptions(loop ? ['-stream_loop', '-1'] : [])
      .complexFilter([
        `[1:a]volume=${volume}[music]`,
        `[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`
      ])
      .outputOptions(['-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-shortest'])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => {
        // 无音轨时直接叠加音乐
        ffmpeg(videoPath).input(musicPath)
          .inputOptions(loop ? ['-stream_loop', '-1'] : [])
          .outputOptions([
            '-map', '0:v',
            '-map', '1:a',
            `-af:a volume=${volume}`,
            '-c:v', 'copy', '-c:a', 'aac', '-shortest'
          ])
          .output(outputPath)
          .on('end', () => resolve(outputPath))
          .on('error', reject)
          .run();
      })
      .run();
  });
}

// 获取视频时长
function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return reject(err);
      resolve(meta.format.duration || 0);
    });
  });
}

// ——— 主函数：根据编辑数据重新渲染 ———
async function renderWithEdits(projectId, progressCallback) {
  const details = getProjectDetails(projectId);
  if (!details) throw new Error('项目不存在');

  const edit = getEdit(projectId);
  const allClips = details.clips.filter(c => c.status === 'done');
  if (allClips.length === 0) throw new Error('没有可用的视频片段');

  const tmpDir = path.join(OUTPUT_DIR, 'tmp', projectId);
  fs.mkdirSync(tmpDir, { recursive: true });

  // 确定场景顺序
  let orderedClips = [...allClips];
  if (edit.scenes_order) {
    orderedClips = edit.scenes_order
      .filter(idx => !edit.deleted_scenes.includes(idx))
      .map(idx => allClips.find(c => c.scene_index === idx))
      .filter(Boolean);
  } else {
    orderedClips = allClips.filter(c => !edit.deleted_scenes.includes(c.scene_index));
  }

  progressCallback?.({ step: 'trim', message: `处理 ${orderedClips.length} 个场景...` });

  // 处理每个片段（裁剪 + 字幕）
  const processedPaths = [];
  for (let i = 0; i < orderedClips.length; i++) {
    const clip = orderedClips[i];
    let currentPath = clip.file_path;
    const tmpBase = path.join(tmpDir, `clip_${String(i).padStart(3, '0')}`);

    // 裁剪
    const trim = edit.scene_trims?.[clip.scene_index];
    if (trim && (trim.start > 0 || trim.end)) {
      const clipDuration = await getVideoDuration(currentPath).catch(() => 999);
      const end = trim.end || clipDuration;
      const trimmedPath = `${tmpBase}_trimmed.mp4`;
      await trimClip(currentPath, trimmedPath, trim.start || 0, end);
      currentPath = trimmedPath;
      progressCallback?.({ step: 'trim', message: `场景 ${i + 1} 裁剪完成` });
    }

    // 字幕
    const dialogue = edit.dialogues?.find(d => d.scene_index === clip.scene_index);
    if (dialogue?.text) {
      const subtitledPath = `${tmpBase}_sub.mp4`;
      await burnSubtitle(
        currentPath, subtitledPath,
        dialogue.text,
        dialogue.start || 0,
        dialogue.duration || 999,
        dialogue.position || 'bottom',
        dialogue.font_size || 28,
        dialogue.color || 'white'
      );
      currentPath = subtitledPath;
      progressCallback?.({ step: 'subtitle', message: `场景 ${i + 1} 字幕添加完成` });
    }

    processedPaths.push(currentPath);
  }

  // 合并
  progressCallback?.({ step: 'merge', message: '合并视频片段...' });
  const mergedPath = path.join(tmpDir, 'merged.mp4');
  await concatClips(processedPaths, mergedPath);

  // 叠加音乐
  const renderDir = path.join(OUTPUT_DIR, 'renders');
  fs.mkdirSync(renderDir, { recursive: true });
  const finalPath = path.join(renderDir, `${projectId}_edited_${Date.now()}.mp4`);

  if (edit.music?.file_path && fs.existsSync(edit.music.file_path)) {
    progressCallback?.({ step: 'music', message: '叠加背景音乐...' });
    await mixMusic(mergedPath, edit.music.file_path, finalPath, edit.music.volume ?? 0.5, edit.music.loop !== false);
  } else {
    fs.copyFileSync(mergedPath, finalPath);
  }

  // 清理临时文件
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  progressCallback?.({ step: 'done', message: '渲染完成', filePath: finalPath });
  return finalPath;
}

function getProjectDetails(projectId) {
  const project = db.getProject(projectId);
  if (!project) return null;
  const clips = db.getClipsByProject(projectId);
  const story = db.getStoryByProject(projectId);
  return {
    ...project,
    clips,
    story: story ? { ...story, scenes: story.scenes_json ? JSON.parse(story.scenes_json) : [] } : null
  };
}

module.exports = { renderWithEdits, getVideoDuration };
