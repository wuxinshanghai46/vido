#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');

async function main() {
  const filename = `scene-thumb-concurrency-${process.pid}-${Date.now()}.png`;
  const source = mediaAdapter.assetPathFromName(filename);
  const output = mediaAdapter.assetThumbPathFromName(filename, 1600);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  try {
    await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#6d5947' } }).png().toFile(source);
    fs.rmSync(output, { force: true });
    const results = await Promise.all(Array.from({ length: 10 }, () => mediaAdapter.ensureAssetThumbnail(filename, 1600)));
    assert(results.every(item => item === output), '同图同宽并发请求必须复用一个确定性输出');
    const content = fs.readFileSync(output);
    assert(content.length > 0, '并发生成不得暴露空文件');
    const digest = crypto.createHash('sha256').update(content).digest('hex');
    const metadata = await sharp(content).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 1024);
    assert.equal(metadata.height, 1536);
    const repeated = await Promise.all(Array.from({ length: 10 }, async () => {
      const file = await mediaAdapter.ensureAssetThumbnail(filename, 1600);
      return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }));
    assert(repeated.every(value => value === digest), '缓存命中必须保持相同字节与哈希');
    console.log(JSON.stringify({ passed: true, concurrent_requests: 10, bytes: content.length, dimensions: `${metadata.width}x${metadata.height}`, model_calls: 0 }));
  } finally {
    fs.rmSync(source, { force: true });
    fs.rmSync(output, { force: true });
  }
}

main().catch(error => { console.error(error); process.exit(1); });
