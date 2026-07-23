'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

// 默认路径对应用户本轮提供的五个竞品样本与一条当前平台成片，也可通过环境变量替换。
const defaultCompetitors = [
  'C:\\Users\\User\\Videos\\38dfdf4ff3cdc633a0006f8a98a62406_raw.mp4',
  'C:\\Users\\User\\Videos\\44068d9aad5b229644c9135355841430_raw.mp4',
  'C:\\Users\\User\\Videos\\580403c796818ab99921a5646d892d55_raw.mp4',
  'C:\\Users\\User\\Videos\\abdd8dcf52f4bead843fb52b1b044fc7_raw.mp4',
  'C:\\Users\\User\\Videos\\be5eedd377cf14735efa67a0aa851b54.mp4',
];
const competitorFiles = String(process.env.VIDO_V2_BENCHMARK_COMPETITORS || defaultCompetitors.join(';'))
  .split(';').map(value => value.trim()).filter(Boolean);
const oursFile = String(process.env.VIDO_V2_BENCHMARK_OURS
  || 'D:\\xwechat_files\\wxid_z7ag3mt8vglj21_a9f9\\msg\\video\\2026-07\\aa3dbb7a7e7757816b10ceb4a1a2a90a_raw.mp4').trim();

function command(binary, args, label) {
  const result = spawnSync(binary, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${label}失败：${result.error?.message || result.stderr || result.stdout || result.status}`);
  }
  return result;
}

function ratio(value = '0/1') {
  const [left, right] = String(value).split('/').map(Number);
  return right ? left / right : Number(left) || 0;
}

function analyze(file, group) {
  if (!fs.existsSync(file)) throw new Error(`基准视频不存在：${file}`);
  const probe = JSON.parse(command(ffprobePath, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'format=duration,size:stream=width,height,avg_frame_rate,nb_frames',
    '-of', 'json',
    file,
  ], 'ffprobe').stdout);
  const stream = probe.streams?.[0] || {};
  const duration = Number(probe.format?.duration || 0);
  // 低分辨率解码只用于统计明显硬切，避免把生成视频中的自然运动误判成镜头切换。
  const cutScan = command(ffmpegPath, [
    '-hide_banner', '-nostats', '-i', file,
    '-vf', "scale=320:-2,select='gt(scene,0.35)',showinfo",
    '-an', '-f', 'null', '-',
  ], 'ffmpeg 场景切点扫描');
  const cutTimes = [...cutScan.stderr.matchAll(/pts_time:([0-9.]+)/g)].map(match => Number(match[1]));
  return {
    group,
    file,
    duration_seconds: Number(duration.toFixed(3)),
    width: Number(stream.width || 0),
    height: Number(stream.height || 0),
    average_fps: Number(ratio(stream.avg_frame_rate).toFixed(3)),
    decoded_frames: Number(stream.nb_frames || 0),
    hard_cut_count: cutTimes.length,
    hard_cut_times: cutTimes,
    average_segment_seconds: Number((duration / Math.max(1, cutTimes.length + 1)).toFixed(3)),
  };
}

const rows = [
  ...competitorFiles.map(file => analyze(file, 'competitor')),
  analyze(oursFile, 'current_platform'),
];
const aggregate = group => {
  const selected = rows.filter(row => row.group === group);
  return {
    samples: selected.length,
    total_seconds: Number(selected.reduce((sum, row) => sum + row.duration_seconds, 0).toFixed(3)),
    hard_cuts: selected.reduce((sum, row) => sum + row.hard_cut_count, 0),
    mean_segment_seconds: Number((selected.reduce((sum, row) => sum + row.average_segment_seconds, 0) / Math.max(1, selected.length)).toFixed(3)),
  };
};

console.log(JSON.stringify({
  benchmark: '剧情广告 V2.0 真实视频结构基准',
  method: 'ffprobe 元数据 + FFmpeg scene>0.35 明显硬切扫描；材质、人物和动作一致性仍由 V2.0 时序证据 QA 判断',
  aggregate: {
    competitor: aggregate('competitor'),
    current_platform: aggregate('current_platform'),
  },
  samples: rows,
}, null, 2));
