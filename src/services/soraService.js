require('dotenv').config();
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

let client = null;

function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    proto.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(destPath)));
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function generateVideoClip({ prompt, duration = 5, outputDir, filename }) {
  const openai = getClient();

  fs.mkdirSync(outputDir, { recursive: true });

  // Sora 2 视频生成
  const response = await openai.video.generations.create({
    model: 'sora-2',
    prompt: prompt,
    n: 1,
    duration: Math.min(Math.max(duration, 5), 20), // Sora 支持 5-20 秒
    resolution: '1280x720',
    quality: 'standard'
  });

  const videoData = response.data[0];

  // 如果返回 URL，下载到本地
  if (videoData.url) {
    const outputPath = path.join(outputDir, `${filename}.mp4`);
    await downloadFile(videoData.url, outputPath);
    return { filePath: outputPath, url: videoData.url };
  }

  // 如果返回 base64
  if (videoData.b64_json) {
    const outputPath = path.join(outputDir, `${filename}.mp4`);
    const buffer = Buffer.from(videoData.b64_json, 'base64');
    fs.writeFileSync(outputPath, buffer);
    return { filePath: outputPath };
  }

  throw new Error('Sora API 未返回视频数据');
}

module.exports = { generateVideoClip };
