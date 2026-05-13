require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const TEMP_DIR = path.join(__dirname, '../../outputs/topview-assets');

function providerConfig() {
  const { getApiKey, loadSettings } = require('./settingsService');
  const settings = loadSettings();
  const provider = (settings.providers || []).find(p => p.id === 'topview' && p.enabled !== false);
  const apiKey = getApiKey('topview') || process.env.TOPVIEW_API_KEY;
  const uid = provider?.topview_uid || provider?.api_uid || provider?.uid || process.env.TOPVIEW_UID;
  const baseUrl = (provider?.api_url || 'https://api.topview.ai').replace(/\/$/, '');
  if (!apiKey) throw new Error('Topview API Key is not configured');
  if (!uid) throw new Error('Topview UID is not configured');
  return { apiKey, uid, baseUrl };
}

function headers(cfg, json = false) {
  const h = {
    'Topview-Uid': cfg.uid,
    Authorization: 'Bearer ' + cfg.apiKey,
    Accept: '*/*',
    'User-Agent': 'VIDO/1.0',
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function jsonRequest(method, url, cfg, bodyObj, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = bodyObj ? JSON.stringify(bodyObj) : '';
    const h = headers(cfg, !!bodyObj);
    if (body) h['Content-Length'] = Buffer.byteLength(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method,
      headers: h,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json;
        try { json = JSON.parse(text); }
        catch { return reject(new Error('Topview returned non-JSON: ' + text.substring(0, 180))); }
        if (res.statusCode >= 400) {
          return reject(new Error(`Topview HTTP ${res.statusCode}: ${json.message || json.error || text.substring(0, 180)}`));
        }
        if (json.code && json.code !== '200') {
          return reject(new Error(`Topview ${json.code}: ${json.message || json.errorMsg || 'request failed'}`));
        }
        resolve(json);
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Topview request timeout')));
    if (body) req.write(body);
    req.end();
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    proto.get(url, { headers: { 'User-Agent': 'VIDO/1.0' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        file.close();
        fs.unlink(destPath, () => {});
        return downloadFile(new URL(res.headers.location, url).toString(), destPath).then(resolve).catch(reject);
      }
      if (res.statusCode >= 400) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`Topview asset download failed HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(destPath)));
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function extFromInput(input, fallback) {
  const cleanFallback = fallback || '.bin';
  if (!input) return cleanFallback;
  if (input.startsWith('data:')) {
    const mime = input.slice(5, input.indexOf(';')).toLowerCase();
    if (mime.includes('jpeg')) return '.jpg';
    if (mime.includes('png')) return '.png';
    if (mime.includes('webp')) return '.webp';
    if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3';
    if (mime.includes('wav')) return '.wav';
    if (mime.includes('mp4')) return '.mp4';
    return cleanFallback;
  }
  try {
    if (/^https?:\/\//i.test(input)) {
      const ext = path.extname(new URL(input).pathname).toLowerCase();
      return ext || cleanFallback;
    }
  } catch {}
  return path.extname(input).toLowerCase() || cleanFallback;
}

async function prepareFile(input, label, fallbackExt) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  if (!input) throw new Error(`Topview ${label} is empty`);
  if (input.startsWith('data:')) {
    const m = input.match(/^data:([^;]+);base64,(.+)$/s);
    if (!m) throw new Error(`Topview ${label} data URL is invalid`);
    const p = path.join(TEMP_DIR, `${Date.now()}_${label}${extFromInput(input, fallbackExt)}`);
    fs.writeFileSync(p, Buffer.from(m[2], 'base64'));
    return p;
  }
  if (/^https?:\/\//i.test(input)) {
    const p = path.join(TEMP_DIR, `${Date.now()}_${label}${extFromInput(input, fallbackExt)}`);
    await downloadFile(input, p);
    return p;
  }
  if (fs.existsSync(input)) return input;
  throw new Error(`Topview ${label} is not accessible`);
}

function putFile(uploadUrl, filePath) {
  return new Promise((resolve, reject) => {
    const u = new URL(uploadUrl);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': fs.statSync(filePath).size,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`Topview S3 upload failed HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString().substring(0, 180)}`));
        }
        resolve();
      });
    });
    req.on('error', reject);
    fs.createReadStream(filePath).pipe(req);
  });
}

async function uploadFile(filePath, cfg) {
  const ext = (path.extname(filePath).replace('.', '').toLowerCase() || 'png').replace('jpeg', 'jpg');
  const credential = await jsonRequest('GET', `${cfg.baseUrl}/v1/upload/credential?format=${encodeURIComponent(ext)}`, cfg);
  const fileId = credential.result?.fileId || credential.fileId;
  const uploadUrl = credential.result?.uploadUrl || credential.uploadUrl;
  if (!fileId || !uploadUrl) throw new Error('Topview upload credential is incomplete');
  await putFile(uploadUrl, filePath);
  return fileId;
}

function firstVideoUrl(value) {
  if (!value) return '';
  if (typeof value === 'string') return /^https?:\/\/.+\.mp4(\?|$)/i.test(value) ? value : '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstVideoUrl(item);
      if (found) return found;
    }
    return '';
  }
  if (typeof value === 'object') {
    const preferred = value.outputVideoUrl || value.finishedVideoUrl || value.videoUrl || value.url || value.filePath || value.downloadUrl;
    if (typeof preferred === 'string' && /^https?:\/\//i.test(preferred)) return preferred;
    for (const v of Object.values(value)) {
      const found = firstVideoUrl(v);
      if (found) return found;
    }
  }
  return '';
}

function firstImageUrl(value) {
  if (!value) return '';
  if (typeof value === 'string') return /^https?:\/\/.+\.(png|jpe?g|webp)(\?|$)/i.test(value) ? value : '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstImageUrl(item);
      if (found) return found;
    }
    return '';
  }
  if (typeof value === 'object') {
    const preferred = value.outputImageUrl || value.imageUrl || value.url || value.filePath || value.downloadUrl || value.resultUrl;
    if (typeof preferred === 'string' && /^https?:\/\//i.test(preferred)) return preferred;
    for (const v of Object.values(value)) {
      const found = firstImageUrl(v);
      if (found) return found;
    }
  }
  return '';
}

function firstImageId(value) {
  if (!value) return '';
  if (typeof value === 'string') return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstImageId(item);
      if (found) return found;
    }
    return '';
  }
  if (typeof value === 'object') {
    const preferred =
      value.imageId ||
      value.outputImageId ||
      value.replaceProductTaskImageId ||
      value.productImageWithoutBackgroundFileId ||
      value.bgRemovedImageFileId ||
      value.resultImageId ||
      value.fileId;
    if (preferred) return String(preferred);
    for (const v of Object.values(value)) {
      const found = firstImageId(v);
      if (found) return found;
    }
  }
  return '';
}

async function waitTopviewTask({ cfg, queryPath, taskId, kind, onProgress, intervalMs = 5000, timeoutMs = 15 * 60 * 1000 }) {
  const started = Date.now();
  let tick = 0;
  while (Date.now() - started < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    const sep = queryPath.includes('?') ? '&' : '?';
    const status = await jsonRequest('GET', `${cfg.baseUrl}${queryPath}${sep}taskId=${encodeURIComponent(taskId)}&needCloudFrontUrl=true`, cfg, null, 30000);
    const result = status.result || status;
    const st = String(result.status || result.taskStatus || '').toLowerCase();
    tick++;
    if (typeof onProgress === 'function' && (tick % 3 === 0 || st)) {
      onProgress({ stage: `topview_${kind}_polling`, taskId, status: st || 'processing', progress: Math.min(95, 12 + tick * 4) });
    }
    if (['success', 'succeeded', 'completed', 'complete', 'finish', 'finished'].includes(st)) return result;
    if (['fail', 'failed', 'error', 'canceled', 'cancelled'].includes(st) || result.errorMsg) {
      throw new Error(`Topview ${kind} failed: ${result.errorMsg || result.message || JSON.stringify(result).substring(0, 240)}`);
    }
  }
  throw new Error(`Topview ${kind} timeout`);
}

async function generatePhotoAvatar({ imageUrl, audioUrl, prompt = '', model = 'topview-avatar4', taskTitle = '', onProgress }) {
  const cfg = providerConfig();
  if (typeof onProgress === 'function') onProgress({ stage: 'topview_preparing', model_id: model });
  const imagePath = await prepareFile(imageUrl, 'avatar_image', '.png');
  const audioPath = await prepareFile(audioUrl, 'avatar_audio', '.mp3');

  if (typeof onProgress === 'function') onProgress({ stage: 'topview_uploading', model_id: model });
  const [imageFileId, audioFileId] = await Promise.all([
    uploadFile(imagePath, cfg),
    uploadFile(audioPath, cfg),
  ]);

  const body = {
    avatarSourceFrom: '3',
    imageFileId,
    templateImageFileId: imageFileId,
    audioSourceFrom: '0',
    audioFileId,
    modeType: String(model || '').toLowerCase().includes('fast') ? '0' : '1',
    mode: String(model || '').toLowerCase().includes('fast') ? 'avatar4Fast' : 'avatar4',
    scriptMode: 'audio',
    isSave2CustomAiAvatar: false,
    saveCustomAiAvatar: false,
  };
  const motion = String(prompt || taskTitle || '').trim().substring(0, 600);
  if (motion) {
    body.motionPrompt = motion;
    body.customMotion = motion;
  }

  if (typeof onProgress === 'function') onProgress({ stage: 'topview_submitting', model_id: model });
  let submit;
  let queryPath = '/v1/video_avatar/task/query';
  try {
    submit = await jsonRequest('POST', `${cfg.baseUrl}/v1/video_avatar/task/submit`, cfg, body);
  } catch (err) {
    if (!/404|not found|Cannot POST/i.test(err.message)) throw err;
    submit = await jsonRequest('POST', `${cfg.baseUrl}/v1/photo_avatar/task/submit`, cfg, body);
    queryPath = '/v1/photo_avatar/task/query';
  }
  const taskId = submit.result?.taskId || submit.taskId;
  if (!taskId) throw new Error('Topview Video Avatar did not return taskId');

  const result = await waitTopviewTask({
    cfg,
    queryPath,
    taskId,
    kind: 'video_avatar',
    onProgress: info => typeof onProgress === 'function' && onProgress({ ...info, model_id: model }),
  });
  const videoUrl = firstVideoUrl(result);
  if (!videoUrl) throw new Error('Topview Video Avatar succeeded without video URL');
  return { videoUrl, taskId, duration: result.duration || result.videoDuration || null };
}

async function trySubmitTask({ cfg, paths, body, taskLabel }) {
  let lastErr;
  for (const p of paths) {
    try {
      const submit = await jsonRequest('POST', `${cfg.baseUrl}${p}`, cfg, body);
      const taskId = submit.result?.taskId || submit.taskId || submit.result?.id || submit.id;
      if (!taskId) throw new Error(`${taskLabel} did not return taskId`);
      return { taskId, submitPath: p, submit };
    } catch (err) {
      lastErr = err;
      if (!/404|not found|Cannot POST/i.test(err.message)) throw err;
    }
  }
  throw lastErr || new Error(`${taskLabel} submit failed`);
}

async function generateProductAvatarImage({ personImageUrl, productImageUrl, prompt = '', productName = '', onProgress }) {
  const cfg = providerConfig();
  if (typeof onProgress === 'function') onProgress({ stage: 'topview_product_uploading', progress: 8 });
  const [personPath, productPath] = await Promise.all([
    prepareFile(personImageUrl, 'product_person', '.png'),
    prepareFile(productImageUrl, 'product_image', '.png'),
  ]);
  const [personFileId, productFileId] = await Promise.all([
    uploadFile(personPath, cfg),
    uploadFile(productPath, cfg),
  ]);
  if (typeof onProgress === 'function') onProgress({ stage: 'topview_product_remove_bg', progress: 20 });
  const { taskId: bgTaskId, submitPath: bgSubmitPath } = await trySubmitTask({
    cfg,
    taskLabel: 'Topview Product Avatar remove background',
    paths: [
      '/v1/common_task/remove_background/submit',
      '/v1/common_task/remove_background/task/submit',
    ],
    body: {
      imageFileId: productFileId,
      productImageFileId: productFileId,
    },
  });
  const bgQueryPath = bgSubmitPath.includes('/task/')
    ? bgSubmitPath.replace('/submit', '/query')
    : bgSubmitPath.replace('/submit', '/query');
  const bgResult = await waitTopviewTask({
    cfg,
    queryPath: bgQueryPath,
    taskId: bgTaskId,
    kind: 'product_remove_bg',
    onProgress,
  });
  const productImageWithoutBackgroundFileId =
    bgResult.productImageWithoutBackgroundFileId ||
    bgResult.result?.productImageWithoutBackgroundFileId ||
    bgResult.fileId ||
    bgResult.outputFileId ||
    firstImageId(bgResult);
  if (!productImageWithoutBackgroundFileId) {
    throw new Error('Topview Product Avatar remove background succeeded without productImageWithoutBackgroundFileId');
  }
  const mergedPrompt = [
    prompt || 'Create a realistic ecommerce presenter image.',
    productName ? `The presenter must naturally hold and present ${productName}.` : '',
    'Preserve presenter identity and preserve the exact product appearance, category, colors and logo area.',
  ].filter(Boolean).join(' ');
  if (typeof onProgress === 'function') onProgress({ stage: 'topview_product_image_replace', progress: 45 });
  const { taskId, submitPath } = await trySubmitTask({
    cfg,
    taskLabel: 'Topview Product Avatar image replace',
    paths: [
      '/v3/product_avatar/task/image_replace/submit',
      '/v2/product_avatar/task/image_replace/submit',
    ],
    body: {
      templateImageFileId: personFileId,
      productImageWithoutBackgroundFileId,
      generateImageMode: 'auto',
      imageEditPrompt: mergedPrompt,
    },
  });
  const result = await waitTopviewTask({ cfg, queryPath: submitPath.replace('/submit', '/query'), taskId, kind: 'product_replace', onProgress });
  const imageUrl = firstImageUrl(result);
  const imageId = firstImageId(result);
  if (!imageUrl) throw new Error('Topview Product Avatar succeeded without image URL');
  return { imageUrl, imageId, taskId, removeBackgroundTaskId: bgTaskId, provider: 'topview' };
}

async function generateProductAvatarVideo({ imageId = '', imageUrl = '', text = '', title = '', voiceId = '', audioPath = '', duration = 18, onProgress }) {
  const cfg = providerConfig();
  const safeText = String(text || title || '').trim().slice(0, 3000);
  if (!safeText) throw new Error('Topview Product Avatar Video requires script text');
  let replaceProductTaskImageId = String(imageId || '').trim();
  if (!replaceProductTaskImageId) {
    if (!imageUrl) throw new Error('Topview Product Avatar Video requires imageId or imageUrl');
    if (typeof onProgress === 'function') onProgress({ stage: 'topview_product_video_uploading', progress: 12 });
    const imagePath = await prepareFile(imageUrl, 'product_avatar_video', '.png');
    replaceProductTaskImageId = await uploadFile(imagePath, cfg);
  }
  if (typeof onProgress === 'function') onProgress({ stage: 'topview_product_video_submitting', progress: 35 });
  const audioFileId = audioPath ? await uploadFile(audioPath, cfg) : '';
  if (!audioFileId && !String(voiceId || '').trim()) throw new Error('Topview Product Avatar Video requires voiceId or audioPath');
  const scriptPayload = audioFileId
    ? {
        scriptMode: 'audio',
        audioFileId,
        audioSourceFrom: '0',
      }
    : {
        scriptMode: 'text',
        voiceId: String(voiceId || '').trim(),
        ttsText: safeText,
      };
  const { taskId, submitPath } = await trySubmitTask({
    cfg,
    taskLabel: 'Topview Product Avatar Image2Video',
    paths: [
      '/v3/product_avatar/task/image2Video/submit',
      '/v2/product_avatar/task/image2Video/submit',
    ],
    body: {
      replaceProductTaskImageId,
      script: safeText,
      title: String(title || 'VIDO product avatar').slice(0, 120),
      mode: 'avatar4',
      ...scriptPayload,
      videoLengthType: Number(duration) >= 45 ? 3 : Number(duration) >= 25 ? 2 : 1,
      aspectRatio: '9:16',
    },
  });
  const result = await waitTopviewTask({
    cfg,
    queryPath: submitPath.replace('/submit', '/query'),
    taskId,
    kind: 'product_avatar_video',
    onProgress,
    timeoutMs: 20 * 60 * 1000,
  });
  const videoUrl = firstVideoUrl(result);
  if (!videoUrl) throw new Error('Topview Product Avatar Image2Video succeeded without video URL');
  return { videoUrl, taskId, provider: 'topview', model_id: 'topview-product-avatar-i2v' };
}

async function generateImageToVideo({ imageUrl, prompt = '', duration = 5, model = 'topview-image2video-pro', onProgress }) {
  const cfg = providerConfig();
  if (typeof onProgress === 'function') onProgress({ stage: 'topview_i2v_uploading', model_id: model });
  const imagePath = await prepareFile(imageUrl, 'i2v_image', '.png');
  const imageFileId = await uploadFile(imagePath, cfg);
  const { taskId, submitPath } = await trySubmitTask({
    cfg,
    taskLabel: 'Topview Image2Video',
    paths: [
      '/v1/image2video/task/submit',
      '/v1/image2video/v2/task/submit',
      '/v1/product_avatar/v2/image2video/task/submit',
      '/v1/pa/v2/image2video/task/submit',
    ],
    body: {
      imageFileId,
      prompt: String(prompt || '').slice(0, 1200),
      duration: Number(duration) || 5,
      mode: String(model || '').toLowerCase().includes('best') ? 'best' : 'pro',
    },
  });
  const result = await waitTopviewTask({ cfg, queryPath: submitPath.replace('/submit', '/query'), taskId, kind: 'image2video', onProgress });
  const videoUrl = firstVideoUrl(result);
  if (!videoUrl) throw new Error('Topview Image2Video succeeded without video URL');
  return { videoUrl, taskId, provider: 'topview', model_id: model };
}

async function generateMarketingVideo({ avatarImageUrl, materialImageUrl, text, title = '', voiceId = '', duration = 18, onProgress }) {
  const cfg = providerConfig();
  if (!String(voiceId || '').trim()) throw new Error('Topview Marketing Video requires voiceId');
  if (typeof onProgress === 'function') onProgress({ stage: 'topview_m2v_uploading' });
  const prep = [];
  if (avatarImageUrl) prep.push(prepareFile(avatarImageUrl, 'm2v_avatar', '.png'));
  if (materialImageUrl) prep.push(prepareFile(materialImageUrl, 'm2v_material', '.png'));
  const paths = await Promise.all(prep);
  const fileIds = await Promise.all(paths.map(p => uploadFile(p, cfg)));
  if (!fileIds.length) throw new Error('Topview Marketing Video requires at least one material file');
  const safeTitle = String(title || 'VIDO marketing video').slice(0, 120);
  const safeText = String(text || '').slice(0, 3000);
  const videoLengthType = Number(duration) >= 45 ? 3 : Number(duration) >= 25 ? 2 : 1;
  const { taskId, submitPath } = await trySubmitTask({
    cfg,
    taskLabel: 'Topview Marketing Video',
    paths: [
      '/v1/m2v/task/submit',
      '/v1/m-2-v/task/submit',
      '/v1/avatar_marketing_video/task/submit',
    ],
    body: {
      fileIds,
      productName: safeTitle,
      productDescription: safeText,
      language: 'zh-CN',
      aspectRatio: '16:9',
      voiceId: String(voiceId || '').trim(),
      videoLengthType,
      isDiyScript: true,
      diyScriptDescription: safeText,
      videoName: safeTitle,
      materials: fileIds.map(fileId => ({ fileId, type: 'image' })),
      materialFileIds: fileIds,
      script: safeText,
      scriptContents: [{ text: safeText, duration: Number(duration) || 18 }],
      duration: Number(duration) || 18,
    },
  });
  const result = await waitTopviewTask({
    cfg,
    queryPath: submitPath.replace('/submit', '/query'),
    taskId,
    kind: 'marketing_video',
    onProgress,
    timeoutMs: 20 * 60 * 1000,
  });
  const videoUrl = firstVideoUrl(result);
  if (!videoUrl) throw new Error('Topview Marketing Video succeeded without video URL');
  return { videoUrl, taskId, provider: 'topview', model_id: 'topview-m2v' };
}

async function listVoices({ language = 'zh-CN', pageSize = 50, style = '' } = {}) {
  const cfg = providerConfig();
  const params = new URLSearchParams({
    pageNo: '1',
    pageSize: String(pageSize || 50),
    language: language || 'zh-CN',
    isCustom: 'false',
  });
  if (style) params.set('style', style);
  const data = await jsonRequest('GET', `${cfg.baseUrl}/v1/voice/query?${params.toString()}`, cfg, null, 30000);
  const rows = data.result?.data || data.data || [];
  return Array.isArray(rows) ? rows.map(v => ({
    id: v.voiceId || v.id,
    name: v.voiceName || v.name || v.voiceId || v.id,
    gender: String(v.gender || '').toLowerCase().includes('male') ? 'male' : 'female',
    provider: 'Topview',
    providerId: 'topview',
    providerIcon: 'TV',
    lang: v.language || v.bestSupportLanguage || language,
    demoAudioUrl: v.demoAudioUrl || '',
    raw: v,
  })).filter(v => v.id) : [];
}

module.exports = {
  providerConfig,
  jsonRequest,
  uploadFile,
  generatePhotoAvatar,
  generateProductAvatarImage,
  generateProductAvatarVideo,
  generateImageToVideo,
  generateMarketingVideo,
  listVoices,
};
