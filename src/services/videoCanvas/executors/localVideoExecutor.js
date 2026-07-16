const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { mediaInputs, textInputs } = require('./helpers');

ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== 'ffmpeg' ? process.env.FFMPEG_PATH : ffmpegStatic);

async function execute(node, context) {
  if (['select', 'batch', 'condition'].includes(node.type)) {
    const selected = node.type === 'condition' && node.config.branch === 'no' ? [] : context.inputArtifacts;
    return { reuseArtifactIds: selected.map(item => item.id), provider: 'local', model: node.type, billingState: 'not_submitted', actualCost: 0 };
  }
  const videos = mediaInputs(context, 'video');
  if (!videos.length) throw new Error(`${node.type} 缺少上游视频`);
  if (node.type === 'merge') {
    if (videos.length === 1) return { reuseArtifactIds: [videos[0].id], provider: 'local', model: 'passthrough', billingState: 'not_submitted', actualCost: 0 };
    const { mergeVideoClips } = require('../../ffmpegService'); const output = context.outputPath('mp4');
    await mergeVideoClips({ clipPaths: videos.map(item => item.storage_path), outputPath: output });
    return { artifacts: [{ kind: 'video', filePath: output }], provider: 'local', model: 'ffmpeg-merge', billingState: 'not_submitted', actualCost: 0 };
  }
  if (node.type === 'subtitle') {
    const { burnSubtitle } = require('../../ffmpegService'); const text = node.config.text || textInputs(context).join('\n');
    if (!text) throw new Error('字幕节点缺少文本');
    const output = context.outputPath('mp4'); await burnSubtitle(videos[0].storage_path, output, text, node.config);
    return { artifacts: [{ kind: 'video', filePath: output }], provider: 'local', model: 'ffmpeg-subtitle', billingState: 'not_submitted', actualCost: 0 };
  }
  if (node.type === 'video-trim') {
    const output = context.outputPath('mp4'); const start = Math.max(0, Number(node.config.start) || 0); const duration = Math.max(0.1, Number(node.config.duration) || 5);
    await new Promise((resolve, reject) => ffmpeg(videos[0].storage_path).setStartTime(start).duration(duration).outputOptions(['-c:v','libx264','-c:a','aac','-movflags','+faststart']).output(output).on('end', resolve).on('error', reject).run());
    if (!fs.existsSync(output)) throw new Error('视频裁剪没有产生文件');
    return { artifacts: [{ kind: 'video', filePath: output, metadata: { duration } }], provider: 'local', model: 'ffmpeg-trim', billingState: 'not_submitted', actualCost: 0 };
  }
  throw new Error(`本地视频执行器不支持 ${node.type}`);
}

module.exports = { execute };
