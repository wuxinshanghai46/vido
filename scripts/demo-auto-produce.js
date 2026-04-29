#!/usr/bin/env node
/**
 * 服务器端演示：直接跑 tutorialProducer，跳过 HTTP 鉴权
 * 用法（SSH 到服务器后）：
 *   cd /opt/vido/app && node scripts/demo-auto-produce.js "主题" 20 "http://43.98.167.151:4600"
 */
const path = require('path');
const fs = require('fs');

const topic = process.argv[2] || 'AI 数字人 3 秒钩子 · 让口播视频不再被划走';
const durationSec = parseInt(process.argv[3] || '20', 10);
const publicBaseUrl = process.argv[4] || 'http://43.98.167.151:4600';

const assetsDir = path.join(__dirname, '../outputs/jimeng-assets');
fs.mkdirSync(assetsDir, { recursive: true });

(async () => {
  const { produceTutorialVideo } = require('../src/services/tutorialProducer');
  console.log(`\n▶ 主题: ${topic}`);
  console.log(`▶ 时长: ${durationSec} 秒`);
  console.log(`▶ 公网 URL: ${publicBaseUrl}\n`);

  const startedAt = Date.now();
  try {
    const result = await produceTutorialVideo({
      topic,
      durationSec,
      publicBaseUrl,
      assetsDir,
      onStage: ({ name, meta }) => {
        const t = ((Date.now() - startedAt) / 1000).toFixed(1);
        if (meta?.preview) console.log(`[${t}s] ${name} · 文案预览: ${meta.preview}…`);
        else if (meta?.status) console.log(`[${t}s] ${name} · cv_status=${meta.status}`);
        else console.log(`[${t}s] ${name}`);
      },
    });
    console.log('\n═══ 完成 ═══');
    console.log('人像 URL:', result.portrait_url);
    console.log('音频 URL:', result.audio_url);
    console.log('视频 URL:', result.video_url);
    console.log('CV 任务:', result.cv_task_id);
    console.log('\n口播稿:\n' + result.script);
    console.log(`\n总耗时: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error('\n✗ 失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
