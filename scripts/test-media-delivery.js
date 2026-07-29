const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const express = require('express');
const sharp = require('sharp');
const mediaDelivery = require('../src/services/mediaDeliveryService');

const root = path.resolve(__dirname, '..');
const tempDir = path.join(root, '.tmp', 'media-delivery-test');

function request(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });
  const imagePath = path.join(tempDir, 'sample.png');
  await sharp({
    create: { width: 1280, height: 720, channels: 3, background: { r: 35, g: 79, b: 120 } },
  }).png().toFile(imagePath);
  const videoPath = path.join(tempDir, 'sample.mp4');
  fs.writeFileSync(videoPath, Buffer.alloc(2048, 7));

  assert.strictEqual(mediaDelivery.requestedImageWidth({ thumb: 640 }), 640);
  assert.strictEqual(mediaDelivery.requestedImageWidth({ thumb: 99999 }), 2560);
  assert.strictEqual(mediaDelivery.requestedImageFormat({ format: 'webp' }, 'image/avif'), 'webp');

  const first = await mediaDelivery.ensureImageVariant(imagePath, { width: 320, format: 'webp', quality: 72 });
  const second = await mediaDelivery.ensureImageVariant(imagePath, { width: 320, format: 'webp', quality: 72 });
  assert.strictEqual(first, second, 'same source and options should reuse the cached variant');
  const metadata = await sharp(first).metadata();
  assert.strictEqual(metadata.format, 'webp');
  assert.strictEqual(metadata.width, 320);

  const app = express();
  mediaDelivery.installSendFileOptimizer(app);
  app.get('/image', (_req, res) => res.sendFile(imagePath));
  app.get('/api/story/character-image/:filename', (_req, res) => res.sendFile(imagePath));
  app.get('/video', (req, res) => mediaDelivery.streamVideo(req, res, videoPath));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const port = server.address().port;
    const preview = await request(port, '/image?thumb=320&format=webp');
    assert.strictEqual(preview.status, 200);
    assert.match(preview.headers['content-type'] || '', /^image\/webp/);
    assert.match(preview.headers['cache-control'] || '', /max-age=31536000/);
    assert.match(preview.headers['cache-control'] || '', /^private,/);
    assert.strictEqual(preview.headers['x-vido-media-variant'], 'webp');

    const publicPreview = await request(port, '/api/story/character-image/sample.png?thumb=320&format=webp');
    assert.strictEqual(publicPreview.status, 200);
    assert.match(publicPreview.headers['cache-control'] || '', /^public,/);

    const original = await request(port, '/image');
    assert.strictEqual(original.status, 200);
    assert.match(original.headers['content-type'] || '', /^image\/png/);

    const range = await request(port, '/video', { Range: 'bytes=100-199' });
    assert.strictEqual(range.status, 206);
    assert.strictEqual(range.body.length, 100);
    assert.strictEqual(range.headers['accept-ranges'], 'bytes');
    assert.strictEqual(range.headers['content-range'], 'bytes 100-199/2048');
    assert.match(range.headers['cache-control'] || '', /stale-while-revalidate/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  const htmlFiles = execFileSync('git', ['ls-files', '--', 'public/*.html'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .map(name => name.trim())
    .filter(Boolean);
  assert.ok(htmlFiles.length >= 20);
  htmlFiles.forEach(name => {
    const html = fs.readFileSync(path.join(root, name), 'utf8');
    assert.match(html, /\/js\/media-delivery\.js\?v=20260729-platform-media-v5/, `${name} must load platform media delivery`);
  });
  const browserSource = fs.readFileSync(path.join(root, 'public/js/media-delivery.js'), 'utf8');
  assert.match(browserSource, /MutationObserver/);
  assert.match(browserSource, /IntersectionObserver/);
  assert.match(browserSource, /preload = 'none'/);
  assert.match(browserSource, /searchParams\.delete\('token'\)/);
  assert.match(browserSource, /stableCacheUrl/);
  assert.match(browserSource, /function performanceSnapshot\(\)/);
  assert.match(browserSource, /window\.__VIDO_PERFORMANCE__/);
  assert.match(browserSource, /data-vido-performance/);
  assert.match(browserSource, /largest-contentful-paint/);
  assert.match(browserSource, /layout-shift/);
  assert.match(browserSource, /durationThreshold: 40/);
  assert.match(browserSource, /initial_video_bytes/);
  assert.match(browserSource, /top_resources/);
  assert.match(browserSource, /api_requests/);

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('platform media delivery tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
