#!/usr/bin/env node
/**
 * 服务器端：拿一个本地视频 + 背景图 → 抠像 + 合成 → 输出路径
 * 用法：
 *   cd /opt/vido/app && node scripts/demo-matting.js <video> <bg> [outName]
 *
 * 示例：
 *   node scripts/demo-matting.js outputs/jimeng-assets/demo_20s_1776511412.mp4 outputs/jimeng-assets/bg_office.jpg matted_demo.mp4
 */
const path = require('path');
const fs = require('fs');

const videoPath = process.argv[2];
const bgPath = process.argv[3];
const outName = process.argv[4] || `matted_${Date.now()}.mp4`;

if (!videoPath || !bgPath) { console.error('usage: demo-matting.js <video> <bg> [outName]'); process.exit(1); }
if (!fs.existsSync(videoPath)) { console.error('video not found:', videoPath); process.exit(1); }
if (!fs.existsSync(bgPath)) { console.error('bg not found:', bgPath); process.exit(1); }

const assetsDir = path.join(__dirname, '../outputs/jimeng-assets');
const mattedDir = path.join(__dirname, '../outputs/jimeng-matted');
fs.mkdirSync(assetsDir, { recursive: true });
fs.mkdirSync(mattedDir, { recursive: true });

(async () => {
  const { matteVideo, composeWithBackground, probeVideo, cleanup } = require('../src/services/videoMattingPipeline');
  const started = Date.now();

  console.log(`▶ 源视频: ${videoPath}`);
  console.log(`▶ 背景  : ${bgPath}`);
  const info = await probeVideo(videoPath);
  console.log(`▶ 源参数: fps=${info.fps} duration=${info.duration}s`);

  const mattedMov = path.join(mattedDir, `matte_${Date.now()}.mov`);
  console.log(`\n▶ 阶段 1/2: 百度抠像 → ${mattedMov}`);
  const t1 = Date.now();
  const m = await matteVideo(videoPath, mattedMov, {
    fps: info.fps,
    qps: 8,
    onProgress: (p) => {
      const el = ((Date.now() - t1) / 1000).toFixed(1);
      if (p.stage === 'matting_progress' && (p.done % 20 === 0 || p.done === p.total)) {
        console.log(`  [${el}s] 抠像 ${p.done}/${p.total}`);
      } else if (p.stage !== 'matting_progress') {
        console.log(`  [${el}s] ${p.stage}`);
      }
    },
  });
  console.log(`  ✓ 抠像完成，${m.frames} 帧，耗时 ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  const outPath = path.join(assetsDir, outName);
  console.log(`\n▶ 阶段 2/2: 合成背景 → ${outPath}`);
  const t2 = Date.now();
  await composeWithBackground(mattedMov, bgPath, outPath, { width: 720, height: 1280, scaleMode: 'cover' });
  console.log(`  ✓ 合成完成，耗时 ${((Date.now() - t2) / 1000).toFixed(1)}s`);

  const size = fs.statSync(outPath).size;
  console.log(`\n═══ 完成 ═══`);
  console.log(`输出:   ${outPath}`);
  console.log(`大小:   ${(size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`公网:   http://43.98.167.151:4600/public/jimeng-assets/${outName}`);
  console.log(`抠像中间件(可换背景复用): ${mattedMov}`);
  console.log(`总耗时: ${((Date.now() - started) / 1000).toFixed(1)}s`);

  cleanup(m.tmpDir);
})().catch(err => {
  console.error('\n✗ 失败:', err.message);
  console.error(err.stack);
  process.exit(1);
});
