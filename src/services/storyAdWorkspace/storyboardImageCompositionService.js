'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const mediaAdapter = require('../newStoryAd/mediaAdapter');

const FRACTIONS = [1 / 2, 1 / 3, 2 / 3];
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function boundaryScore(data, width, height, axis, boundary) {
  if (axis === 'horizontal') {
    if (boundary < 1 || boundary >= height) return 0;
    const upper = (boundary - 1) * width;
    const lower = boundary * width;
    let total = 0;
    for (let x = 0; x < width; x += 1) total += Math.abs(data[upper + x] - data[lower + x]);
    return total / width;
  }
  if (boundary < 1 || boundary >= width) return 0;
  let total = 0;
  for (let y = 0; y < height; y += 1) total += Math.abs(data[(y * width) + boundary - 1] - data[(y * width) + boundary]);
  return total / height;
}

function inspectAxis(data, width, height, axis) {
  const size = axis === 'horizontal' ? height : width;
  for (const fraction of FRACTIONS) {
    const expected = Math.round(size * fraction);
    const candidates = [expected - 2, expected - 1, expected, expected + 1, expected + 2]
      .filter(value => value > 0 && value < size)
      .map(boundary => ({ boundary, score: boundaryScore(data, width, height, axis, boundary) }))
      .sort((left, right) => right.score - left.score);
    const best = candidates[0];
    const nearby = [];
    for (let offset = -14; offset <= 14; offset += 1) {
      const boundary = expected + offset;
      if (Math.abs(boundary - best.boundary) <= 2 || boundary < 1 || boundary >= size) continue;
      nearby.push(boundaryScore(data, width, height, axis, boundary));
    }
    const localMean = mean(nearby);
    const localMax = Math.max(1, ...nearby);
    if (best.score >= 18 && best.score >= localMean * 3.2 && best.score >= localMax * 2.15) {
      return { axis, fraction, boundary: best.boundary, score: Number(best.score.toFixed(2)), local_mean: Number(localMean.toFixed(2)) };
    }
  }
  return null;
}

async function inspectBuffer(input) {
  const { data, info } = await sharp(input).rotate().greyscale().raw().toBuffer({ resolveWithObject: true });
  if (info.width < 96 || info.height < 96) return { multi_panel: false };
  const seam = inspectAxis(data, info.width, info.height, 'horizontal') || inspectAxis(data, info.width, info.height, 'vertical');
  return { multi_panel: Boolean(seam), seam, width: info.width, height: info.height };
}

function localAssetPath(generated = {}) {
  const filename = path.basename(String(generated.filename || generated.image_url || generated.url || '').split('?')[0]);
  if (!filename) return '';
  const resolved = path.resolve(mediaAdapter.ASSET_DIR, filename);
  const root = `${path.resolve(mediaAdapter.ASSET_DIR)}${path.sep}`;
  return resolved.startsWith(root) ? resolved : '';
}

async function assertSingleFrame(generated = {}) {
  const filePath = localAssetPath(generated);
  if (!filePath || !fs.existsSync(filePath)) return { checked: false, reason: 'non_local_asset' };
  const result = await inspectBuffer(filePath);
  if (!result.multi_panel) return { checked: true, ...result };
  const error = new Error('图片被识别为上下或左右多画面拼接，已阻止写入正式分镜；请使用同一请求重试单一连续画面。');
  error.code = 'STORYBOARD_IMAGE_MULTI_PANEL_DETECTED';
  error.status = 422;
  error.retryable = true;
  error.composition = result;
  throw error;
}

module.exports = { assertSingleFrame, boundaryScore, inspectBuffer };
