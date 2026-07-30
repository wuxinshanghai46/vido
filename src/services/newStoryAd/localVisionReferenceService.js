const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../../outputs'));
const ASSET_DIR = path.join(OUTPUT_DIR, 'new-story-ad-assets');
const ASSET_ROUTE = '/api/new-story-ad/assets/';

function assetFilename(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let pathname = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname;
    } catch (_) {
      return '';
    }
  }
  const index = pathname.indexOf(ASSET_ROUTE);
  if (index < 0) return '';
  const encoded = pathname.slice(index + ASSET_ROUTE.length).split(/[?#]/)[0];
  try {
    return path.basename(decodeURIComponent(encoded));
  } catch (_) {
    return '';
  }
}

function assetPath(value = '') {
  const filename = assetFilename(value);
  if (!filename) return '';
  const filePath = path.join(ASSET_DIR, filename);
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? filePath : '';
}

async function dataUrl(value = '', options = {}) {
  const filePath = assetPath(value);
  if (!filePath) return '';
  const width = Math.max(320, Math.min(1600, Number(options.width) || 1024));
  const height = Math.max(320, Math.min(1600, Number(options.height) || 1024));
  const quality = Math.max(55, Math.min(88, Number(options.quality) || 76));
  const bytes = await sharp(filePath)
    .rotate()
    .resize({ width, height, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

async function dataUrlsFor(values = [], options = {}) {
  const max = Math.max(1, Math.min(8, Number(options.max) || 8));
  const source = (Array.isArray(values) ? values : [values]).slice(0, max);
  const rows = await Promise.all(source.map(value => dataUrl(value, options).catch(() => '')));
  return rows.filter(Boolean);
}

module.exports = {
  ASSET_DIR,
  ASSET_ROUTE,
  assetFilename,
  assetPath,
  dataUrl,
  dataUrlsFor,
};
