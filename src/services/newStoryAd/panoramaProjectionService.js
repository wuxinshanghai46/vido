const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const sharp = require('sharp');
const mediaAdapter = require('./mediaAdapter');

const PANORAMA_WIDTH = 2048;
const PANORAMA_HEIGHT = 1024;
const PERSPECTIVE_WIDTH = 960;
const PERSPECTIVE_HEIGHT = 540;

function clean(value, max = 1000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function localAssetPath(value = {}) {
  const direct = clean(value.filePath || value.file_path, 1600);
  if (direct) {
    const resolved = path.resolve(direct);
    if (resolved.startsWith(path.resolve(mediaAdapter.ASSET_DIR) + path.sep) && fs.existsSync(resolved)) return resolved;
  }
  const filename = clean(value.filename, 240);
  if (filename) {
    const resolved = mediaAdapter.assetPathFromName(filename);
    if (resolved && fs.existsSync(resolved)) return resolved;
  }
  const url = clean(value.image_url || value.url, 1600);
  if (!url.startsWith('/api/new-story-ad/assets/')) return '';
  const name = decodeURIComponent(url.split('/').pop()?.split('?')[0] || '');
  const resolved = mediaAdapter.assetPathFromName(name);
  return resolved && fs.existsSync(resolved) ? resolved : '';
}

function sha256(filePath = '') {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function seamError(data, width, height, channels) {
  let difference = 0;
  let samples = 0;
  for (let y = 0; y < height; y += 2) {
    const leftOffset = y * width * channels;
    const rightOffset = (y * width + width - 1) * channels;
    for (let channel = 0; channel < Math.min(3, channels); channel += 1) {
      difference += Math.abs(data[leftOffset + channel] - data[rightOffset + channel]);
      samples += 1;
    }
  }
  return samples ? Number((difference / samples / 255).toFixed(6)) : 1;
}

async function normalizeEquirectangular(input = {}, options = {}) {
  const inputPath = localAssetPath(input);
  if (!inputPath) {
    const error = new Error('全景候选图没有可验证的本地文件，已停止保存');
    error.code = 'PANORAMA_LOCAL_ASSET_REQUIRED';
    error.retryable = true;
    throw error;
  }
  const taskId = clean(options.taskId || 'task', 100).replace(/[^a-z0-9_-]/ig, '_');
  const sceneId = clean(options.sceneId || 'scene', 100).replace(/[^a-z0-9_-]/ig, '_');
  const revision = Math.max(1, Number(options.revision || 1) || 1);
  const filename = mediaAdapter.safeFilename(`scene_panorama_${taskId}_${sceneId}_r${revision}.png`, '.png');
  const outputPath = path.join(mediaAdapter.ASSET_DIR, filename);
  const metadata = await sharp(inputPath).metadata();
  const sourceWidth = Number(metadata.width || 0) || 0;
  const sourceHeight = Number(metadata.height || 0) || 0;
  const sourceRatio = sourceHeight ? sourceWidth / sourceHeight : 0;
  if (!sourceWidth || !sourceHeight || Math.abs(sourceRatio - 2) > 0.03) {
    const error = new Error(`全景供应商没有返回真实2:1图像（实际 ${sourceWidth}×${sourceHeight}），已拒绝用裁切或拉伸伪装全景`);
    error.code = 'PANORAMA_PROVIDER_ASPECT_RATIO_INVALID';
    error.retryable = true;
    error.actual_width = sourceWidth;
    error.actual_height = sourceHeight;
    throw error;
  }
  const result = await sharp(inputPath)
    .rotate()
    .resize(PANORAMA_WIDTH, PANORAMA_HEIGHT, { fit: 'fill' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = Number(result.info.channels || 3) || 3;
  const pixels = Buffer.from(result.data);
  await sharp(pixels, { raw: { width: PANORAMA_WIDTH, height: PANORAMA_HEIGHT, channels } })
    .png({ compressionLevel: 8 })
    .toFile(outputPath);
  await Promise.all([480, 720].map(width => mediaAdapter.ensureAssetThumbnail(filename, width)));
  return {
    filePath: outputPath,
    filename,
    image_url: mediaAdapter.publicAssetUrl(filename),
    url: mediaAdapter.publicAssetUrl(filename),
    width: PANORAMA_WIDTH,
    height: PANORAMA_HEIGHT,
    projection: 'equirectangular',
    aspect_ratio: '2:1',
    seam_error: seamError(pixels, PANORAMA_WIDTH, PANORAMA_HEIGHT, channels),
    sha256: sha256(outputPath),
  };
}

function runProjectionWorker(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'panoramaProjectionWorker.js'), { workerData });
    worker.once('message', message => {
      if (message?.ok) resolve();
      else reject(new Error(message?.error || 'Panorama projection worker failed'));
    });
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code !== 0) reject(new Error(`Panorama projection worker exited with code ${code}`));
    });
  });
}

async function derivePerspective(panorama = {}, options = {}) {
  const inputPath = localAssetPath(panorama);
  if (!inputPath) throw new Error('缺少可投影的全景本地文件');
  const yaw = Math.max(-360, Math.min(360, Number(options.yaw || 0) || 0));
  const pitch = Math.max(-80, Math.min(80, Number(options.pitch || 0) || 0));
  const fov = Math.max(25, Math.min(110, Number(options.fov || 82) || 82));
  const key = clean(options.key || `yaw_${yaw}`, 60).replace(/[^a-z0-9_-]/ig, '_');
  const panoramaHash = panorama.sha256 || sha256(inputPath);
  const cacheKey = crypto.createHash('sha256').update(JSON.stringify({ panoramaHash, yaw, pitch, fov, width: PERSPECTIVE_WIDTH, height: PERSPECTIVE_HEIGHT, renderer: 2 })).digest('hex').slice(0, 16);
  const base = path.basename(panorama.filename || inputPath, path.extname(panorama.filename || inputPath));
  const filename = mediaAdapter.safeFilename(`${base}_${key}_${cacheKey}.jpg`, '.jpg');
  const outputPath = path.join(mediaAdapter.ASSET_DIR, filename);
  if (!fs.existsSync(outputPath)) {
    await runProjectionWorker({ inputPath, outputPath, outputWidth: PERSPECTIVE_WIDTH, outputHeight: PERSPECTIVE_HEIGHT, yaw, pitch, fov });
  }
  await mediaAdapter.ensureAssetThumbnail(filename, 480);
  return {
    key,
    label: clean(options.label || key, 100),
    camera_id: clean(options.camera_id || `panorama_camera_${key}`, 120),
    image_url: mediaAdapter.publicAssetUrl(filename),
    url: mediaAdapter.publicAssetUrl(filename),
    filename,
    width: PERSPECTIVE_WIDTH,
    height: PERSPECTIVE_HEIGHT,
    yaw,
    pitch,
    fov,
    projection: 'perspective_from_equirectangular',
    derived_locally: true,
    parent_sha256: panoramaHash,
    renderer_version: 2,
    sha256: sha256(outputPath),
  };
}

async function deriveCardinalViews(panorama = {}) {
  const views = [
    { key: 'panorama_front', label: '全景正向', camera_id: 'camera_master', yaw: 0 },
    { key: 'panorama_right', label: '全景右向', camera_id: 'camera_interaction', yaw: 90 },
    { key: 'panorama_back', label: '全景反向', camera_id: 'camera_reverse', yaw: 180 },
    { key: 'panorama_left', label: '全景左向', camera_id: 'camera_detail', yaw: -90 },
  ];
  return Promise.all(views.map(view => derivePerspective(panorama, { ...view, pitch: 0, fov: 82 })));
}

function selectDerivedView(panorama = {}, options = {}) {
  const views = Array.isArray(panorama.derived_views) ? panorama.derived_views : [];
  if (!views.length) return null;
  const cameraId = clean(options.camera_id, 120).toLowerCase();
  const sceneView = clean(options.scene_view || options.view_key, 80).toLowerCase();
  const direct = views.find(view => clean(view.camera_id, 120).toLowerCase() === cameraId)
    || views.find(view => cameraId && clean(view.key, 80).toLowerCase().includes(cameraId.replace(/^camera[_:-]?/, '')))
    || views.find(view => sceneView && clean(view.key, 80).toLowerCase().includes(sceneView));
  if (direct) return direct;
  const requestedYaw = Number(options.yaw);
  if (!Number.isFinite(requestedYaw)) return views[0];
  const angularDistance = value => Math.abs((((Number(value || 0) - requestedYaw) % 360) + 540) % 360 - 180);
  return [...views].sort((a, b) => angularDistance(a.yaw) - angularDistance(b.yaw))[0] || views[0];
}

module.exports = {
  PANORAMA_WIDTH,
  PANORAMA_HEIGHT,
  PERSPECTIVE_WIDTH,
  PERSPECTIVE_HEIGHT,
  localAssetPath,
  seamError,
  normalizeEquirectangular,
  derivePerspective,
  deriveCardinalViews,
  selectDerivedView,
};
