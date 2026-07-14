const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUTPUT_ROOT = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../outputs'));
const IMAGE_CACHE_DIR = path.join(OUTPUT_ROOT, 'media-cache', 'images');
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff', '.bmp', '.avif']);
const inflightVariants = new Map();

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function isImageFile(filePath = '') {
  return IMAGE_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

function resolveSendFilePath(filePath = '', options = {}) {
  if (!filePath) return '';
  if (path.isAbsolute(filePath)) return path.resolve(filePath);
  if (options?.root) return path.resolve(options.root, filePath);
  return '';
}

function requestedImageWidth(query = {}) {
  const raw = query.thumb || query.w || query.width || query.preview;
  if (raw === undefined || raw === null || raw === '') return 0;
  return clamp(raw === true ? 960 : raw, 120, 2560, 960);
}

function requestedImageFormat(query = {}, accept = '') {
  const requested = String(query.format || query.fm || '').trim().toLowerCase();
  if (requested === 'avif') return 'avif';
  if (requested === 'jpg' || requested === 'jpeg') return 'jpeg';
  if (requested === 'png') return 'png';
  if (requested === 'auto' && /image\/avif/i.test(String(accept || '')) && process.env.MEDIA_PREVIEW_AVIF === '1') return 'avif';
  return 'webp';
}

function variantContentType(format = 'webp') {
  if (format === 'avif') return 'image/avif';
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'png') return 'image/png';
  return 'image/webp';
}

async function ensureImageVariant(filePath, options = {}) {
  const source = path.resolve(String(filePath || ''));
  if (!source || !fs.existsSync(source) || !isImageFile(source)) {
    const error = new Error('Image asset not found');
    error.status = 404;
    throw error;
  }
  const width = clamp(options.width, 120, 2560, 960);
  const quality = clamp(options.quality, 45, 92, 76);
  const format = ['webp', 'avif', 'jpeg', 'png'].includes(options.format) ? options.format : 'webp';
  const stat = fs.statSync(source);
  const fingerprint = crypto.createHash('sha1')
    .update([source, stat.size, Math.round(stat.mtimeMs), width, quality, format].join('|'))
    .digest('hex');
  const extension = format === 'jpeg' ? 'jpg' : format;
  const outputPath = path.join(IMAGE_CACHE_DIR, fingerprint.slice(0, 2), `${fingerprint}_${width}.${extension}`);
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).isFile()) return outputPath;
  if (inflightVariants.has(outputPath)) return inflightVariants.get(outputPath);

  const work = (async () => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const tempPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
    let pipeline = sharp(source, { failOn: 'none' })
      .rotate()
      .resize({ width, withoutEnlargement: true, fit: 'inside' });
    if (format === 'avif') pipeline = pipeline.avif({ quality: Math.max(40, quality - 8), effort: 3 });
    else if (format === 'jpeg') pipeline = pipeline.flatten({ background: '#111827' }).jpeg({ quality, mozjpeg: true });
    else if (format === 'png') pipeline = pipeline.png({ compressionLevel: 8 });
    else pipeline = pipeline.webp({ quality, effort: 3, smartSubsample: true });
    try {
      await pipeline.toFile(tempPath);
      fs.renameSync(tempPath, outputPath);
      return outputPath;
    } catch (error) {
      try { if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true }); } catch (_) {}
      throw error;
    }
  })().finally(() => inflightVariants.delete(outputPath));
  inflightVariants.set(outputPath, work);
  return work;
}

function isPublicMediaPath(requestPath = '') {
  const value = String(requestPath || '');
  return /^(?:\/api\/(?:assets\/file|portrait\/image|comic\/image|drama\/tasks\/[^/]+\/image|ai-cap\/file|story\/character-image|i2v\/images|avatar\/preset-img|new-story-ad\/assets)|\/public\/)/i.test(value);
}

function immutableHeaders(res, format = 'webp', options = {}) {
  res.setHeader('Content-Type', variantContentType(format));
  res.setHeader('Cache-Control', options.public === true
    ? 'public, max-age=31536000, immutable'
    : 'private, max-age=31536000, immutable');
  res.vary('Accept');
  if (options.public !== true) {
    res.vary('Authorization');
    res.vary('Cookie');
  }
  res.setHeader('X-VIDO-Media-Variant', format);
}

function installSendFileOptimizer(app) {
  app.use((req, res, next) => {
    const width = requestedImageWidth(req.query || {});
    if (!width || !['GET', 'HEAD'].includes(req.method)) return next();
    const originalSendFile = res.sendFile.bind(res);
    res.sendFile = function optimizedSendFile(filePath, options, callback) {
      const opts = typeof options === 'object' && options !== null ? options : {};
      const done = typeof options === 'function' ? options : callback;
      const resolved = resolveSendFilePath(filePath, opts);
      if (!resolved || !isImageFile(resolved)) return originalSendFile(filePath, options, callback);
      const normalizedResolved = resolved.replace(/\\/g, '/');
      if (/\/(?:media-cache\/images|new-story-ad-assets\/thumbs)\//i.test(normalizedResolved)) {
        return originalSendFile(filePath, options, callback);
      }
      const format = requestedImageFormat(req.query || {}, req.headers.accept || '');
      const quality = clamp(req.query?.quality || req.query?.q, 45, 92, 76);
      void ensureImageVariant(resolved, { width, quality, format })
        .then(variantPath => {
          immutableHeaders(res, format, { public: isPublicMediaPath(req.path) });
          originalSendFile(variantPath, done);
        })
        .catch(error => {
          if (typeof done === 'function') return done(error);
          if (!res.headersSent) res.status(error.status || 500).json({ success: false, error: String(error.message || error) });
        });
      return res;
    };
    next();
  });
}

function contentTypeForVideo(filePath = '') {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.mkv') return 'video/x-matroska';
  return 'video/mp4';
}

function streamVideo(req, res, filePath, options = {}) {
  const source = path.resolve(String(filePath || ''));
  if (!source || !fs.existsSync(source)) return res.status(404).end();
  const stat = fs.statSync(source);
  const size = stat.size;
  const type = options.contentType || contentTypeForVideo(source);
  const cacheControl = options.cacheControl || 'public, max-age=86400, stale-while-revalidate=604800';
  const common = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
  };
  const range = String(req.headers.range || '');
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/i);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
      res.writeHead(416, { ...common, 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, {
      ...common,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
    });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(source, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...common, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(source).pipe(res);
}

module.exports = {
  IMAGE_CACHE_DIR,
  isImageFile,
  requestedImageWidth,
  requestedImageFormat,
  isPublicMediaPath,
  ensureImageVariant,
  installSendFileOptimizer,
  streamVideo,
};
