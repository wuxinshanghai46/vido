/**
 * 即梦 Omni 数字人服务（照片+音频驱动）
 *
 * 基于火山引擎 智能视觉·克隆数字人·Omni v1.5
 * 文档：https://www.volcengine.com/docs/85128/1773810
 *
 * 三步走：
 *   1. CVProcess  + jimeng_realman_avatar_object_detection  — 主体检测（可选）
 *   2. CVSubmitTask + jimeng_realman_avatar_picture_omni_v15 — 提交生成
 *   3. CVGetResult  + jimeng_realman_avatar_picture_omni_v15 — 轮询结果
 *
 * API 凭证：复用 settings 里 jimeng provider 的 api_key，格式 AK:SK
 * 输入：image_url / audio_url 必须公网可访问
 */
const crypto = require('crypto');
const axios = require('axios');
const { loadSettings } = require('./settingsService');

const HOST = 'visual.volcengineapi.com';
const REGION = 'cn-north-1';
const SERVICE = 'cv';
const VERSION = '2022-08-31';

const REQ_KEY_OMNI = 'jimeng_realman_avatar_picture_omni_v15';
const REQ_KEY_DETECT = 'jimeng_realman_avatar_object_detection';

function _loadJimengAkSk() {
  const s = loadSettings();
  const p = (s.providers || []).find(x => (x.id === 'jimeng' || x.preset === 'jimeng') && x.enabled !== false);
  if (!p || !p.api_key) throw new Error('未配置 jimeng provider 的 api_key（需 AK:SK 格式）');
  if (!p.api_key.includes(':')) throw new Error('jimeng api_key 必须是 AccessKeyId:SecretAccessKey 格式');
  const [ak, sk] = p.api_key.split(':');
  return { ak: ak.trim(), sk: sk.trim() };
}

function _sign(method, body, query, ak, sk) {
  const now = new Date();
  const shortDate = now.toISOString().substring(0, 10).replace(/-/g, '');
  const dateStamp = now.toISOString().replace(/[-:]/g, '').substring(0, 15) + 'Z';
  const canonicalUri = '/';
  const canonicalQuery = Object.entries(query)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const hashedPayload = crypto.createHash('sha256').update(body || '').digest('hex');
  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${HOST}\n` +
    `x-content-sha256:${hashedPayload}\n` +
    `x-date:${dateStamp}\n`;
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;
  const scope = `${shortDate}/${REGION}/${SERVICE}/request`;
  const stringToSign = `HMAC-SHA256\n${dateStamp}\n${scope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;
  const kDate = crypto.createHmac('sha256', sk).update(shortDate).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(REGION).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(SERVICE).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const authorization = `HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    'Content-Type': 'application/json',
    'X-Date': dateStamp,
    'X-Content-Sha256': hashedPayload,
    'Authorization': authorization,
  };
}

// 检测是否是"并发限流"类不可重试错误 — 立即抛，让上层 fallback 到下个候选模型
// （避免对每次限流都做 3×8s 等待 → 烧钱拖时长）
function _isConcurrentLimit(payload) {
  if (!payload) return false;
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return /Concurrent\s*Limit|Reached\s*API\s*Concurrent|Rate\s*Limit|TooManyRequests|QuotaExceeded|Concurrency/i.test(text);
}

async function _call(action, bodyObj, { ak, sk }, { maxRetries = 2 } = {}) {
  const query = { Action: action, Version: VERSION };
  const body = JSON.stringify(bodyObj);
  const url = `https://${HOST}/?Action=${encodeURIComponent(action)}&Version=${encodeURIComponent(VERSION)}`;
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // 每次重新签名（避免 x-date 过期）
    const headers = _sign('POST', body, query, ak, sk);
    try {
      const res = await axios.post(url, body, {
        headers,
        timeout: 60000,
        validateStatus: () => true,
      });
      // 并发限流 / 配额限流 — 立即抛，不重试（让上层切换到下一个候选模型）
      if (_isConcurrentLimit(res.data)) {
        const msg = res.data?.ResponseMetadata?.Error?.Message || res.data?.message || JSON.stringify(res.data).slice(0, 200);
        const err = new Error('即梦并发限流: ' + msg);
        err.code = 'CONCURRENT_LIMIT';
        throw err;
      }
      // HTTP 5xx / gateway timeout → 重试
      if (res.status >= 500 && attempt < maxRetries) {
        console.warn(`[jimeng] ${action} 收到 HTTP ${res.status}，${(attempt + 1) * 8}s 后重试 (第 ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, (attempt + 1) * 8000));
        continue;
      }
      // HTML 响应体（通常是 nginx 网关错误页）→ 重试
      if (typeof res.data === 'string' && /<html/i.test(res.data) && attempt < maxRetries) {
        console.warn(`[jimeng] ${action} 网关 HTML 错误，${(attempt + 1) * 8}s 后重试`);
        await new Promise(r => setTimeout(r, (attempt + 1) * 8000));
        continue;
      }
      return res.data;
    } catch (e) {
      // 并发限流类错误立即向上抛，不重试
      if (e.code === 'CONCURRENT_LIMIT') throw e;
      lastErr = e;
      if (attempt < maxRetries) {
        console.warn(`[jimeng] ${action} 网络错误 ${e.message}，${(attempt + 1) * 5}s 后重试`);
        await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
    }
  }
  if (lastErr) throw lastErr;
  throw new Error(`即梦 ${action} 请求失败（已重试 ${maxRetries} 次）`);
}

/**
 * 主体检测 — 返回 mask URL 列表
 * @param {string} imageUrl 公网可访问的图片 URL
 * @returns {Promise<string[]>} mask URL 数组（可能为空）
 */
async function detectSubjects(imageUrl) {
  const { ak, sk } = _loadJimengAkSk();
  const resp = await _call('CVProcess', { req_key: REQ_KEY_DETECT, image_url: imageUrl }, { ak, sk });
  // 文档返回结构：{ data: { resp_data: "JSON string", ... } }
  const respData = resp?.data?.resp_data;
  if (!respData) {
    const msg = resp?.ResponseMetadata?.Error?.Message || resp?.message || JSON.stringify(resp).slice(0, 200);
    throw new Error('即梦检测失败: ' + msg);
  }
  let parsed;
  try {
    parsed = typeof respData === 'string' ? JSON.parse(respData) : respData;
  } catch (e) {
    throw new Error('即梦检测返回 resp_data 解析失败: ' + e.message);
  }
  const masks = parsed?.object_detection_result?.mask?.url || [];
  return Array.isArray(masks) ? masks : [];
}

/**
 * 提交生成任务
 * @param {object} opts
 * @param {string} opts.imageUrl 公网图片 URL
 * @param {string} opts.audioUrl 公网音频 URL
 * @param {string[]} [opts.maskUrls] 可选 mask URL 数组，默认 []
 * @param {string} [opts.prompt] 可选提示词
 * @returns {Promise<string>} task_id
 */
async function submitAvatarTask({ imageUrl, audioUrl, maskUrls = [], prompt = '' }) {
  if (!imageUrl) throw new Error('imageUrl 必填');
  if (!audioUrl) throw new Error('audioUrl 必填');
  const { ak, sk } = _loadJimengAkSk();
  const body = {
    req_key: REQ_KEY_OMNI,
    image_url: imageUrl,
    audio_url: audioUrl,
    mask_url: Array.isArray(maskUrls) ? maskUrls : [],
    prompt: prompt || '',
  };
  const resp = await _call('CVSubmitTask', body, { ak, sk });
  // 即梦在 task_id 缺失时把错误信息放在 ResponseMetadata.Error 或 message
  const taskId = resp?.data?.task_id;
  if (!taskId) {
    const msg = resp?.ResponseMetadata?.Error?.Message || resp?.message || JSON.stringify(resp).slice(0, 300);
    if (_isConcurrentLimit(msg)) {
      const err = new Error('即梦并发限流: ' + msg);
      err.code = 'CONCURRENT_LIMIT';
      throw err;
    }
    throw new Error('即梦提交任务失败: ' + msg);
  }
  return taskId;
}

/**
 * 轮询任务结果
 * @param {string} taskId
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] 默认 600s
 * @param {number} [opts.intervalMs] 默认 3s
 * @param {(info: {elapsed:number, status:string})=>void} [opts.onProgress]
 * @returns {Promise<string>} video_url
 */
async function pollAvatarResult(taskId, { timeoutMs = 600000, intervalMs = 3000, onProgress } = {}) {
  if (!taskId) throw new Error('taskId 必填');
  const { ak, sk } = _loadJimengAkSk();
  const startedAt = Date.now();
  let lastStatus = 'unknown';
  while (Date.now() - startedAt < timeoutMs) {
    const resp = await _call('CVGetResult', { req_key: REQ_KEY_OMNI, task_id: taskId }, { ak, sk });
    const data = resp?.data || {};
    lastStatus = data.status || lastStatus;
    if (typeof onProgress === 'function') {
      onProgress({ elapsed: Date.now() - startedAt, status: lastStatus });
    }
    if (data.status === 'done') {
      const videoUrl = data.video_url;
      if (!videoUrl) throw new Error('任务完成但无 video_url');
      return videoUrl;
    }
    if (data.status === 'failed' || data.status === 'not_found') {
      throw new Error('即梦任务失败: ' + (data.reason || data.status));
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`即梦任务轮询超时（${timeoutMs}ms），最后状态=${lastStatus}`);
}

/**
 * 一站式生成：提交 + 轮询
 */
async function generateDigitalHumanVideo({ imageUrl, audioUrl, maskUrls = [], prompt = '', onProgress, timeoutMs, intervalMs, userId, agentId } = {}) {
  const startedAt = Date.now();
  let videoUrl = null;
  let taskId = null;
  let status = 'success';
  let errMsg = null;
  try {
    taskId = await submitAvatarTask({ imageUrl, audioUrl, maskUrls, prompt });
    if (onProgress) onProgress({ stage: 'submitted', taskId });
    videoUrl = await pollAvatarResult(taskId, {
      timeoutMs,
      intervalMs,
      onProgress: (info) => onProgress && onProgress({ stage: 'polling', taskId, ...info }),
    });
    return { taskId, videoUrl };
  } catch (e) {
    status = 'fail'; errMsg = e.message; throw e;
  } finally {
    // 埋点：火山即梦 Omni 按"视频时长"计费 — 优先 probe 输入音频时长（≈视频时长），失败时再用估算
    try {
      const tracker = require('./tokenTracker');
      let videoSeconds = 0;
      if (status === 'success' && audioUrl) {
        try {
          videoSeconds = await _probeAudioDurationSec(audioUrl);
        } catch (e) {
          console.warn('[jimeng] probe audio duration 失败:', e.message);
        }
      }
      // probe 失败 / 失败任务也要记录，按"已知最常见时长 30s"兜底
      if (!videoSeconds || !Number.isFinite(videoSeconds)) videoSeconds = 30;
      tracker.record({
        provider: 'volcengine',
        model: 'jimeng_realman_avatar_picture_omni_v15',
        category: 'video',
        videoSeconds,
        durationMs: Date.now() - startedAt,
        status, errorMsg: errMsg, userId, agentId,
        requestId: taskId,
      });
    } catch {}
  }
}

// 用 ffprobe 探测音频/视频文件时长（秒）。支持本地路径和 http(s) URL。
async function _probeAudioDurationSec(audioUrlOrPath) {
  try {
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
    try { const fps = require('ffprobe-static'); ffmpeg.setFfprobePath(fps.path); } catch {}
    let target = audioUrlOrPath;
    // 如果是 http(s) 但是同源 /public/jimeng-assets 路径，直接拼到本地路径上
    if (/^https?:\/\//i.test(audioUrlOrPath)) {
      const path = require('path');
      const m = audioUrlOrPath.match(/\/public\/jimeng-assets\/([^?#]+)/);
      if (m) {
        const local = path.join(__dirname, '../../outputs/jimeng-assets', m[1]);
        const fs = require('fs');
        if (fs.existsSync(local)) target = local;
      }
    }
    return await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(target, (err, meta) => {
        if (err) return reject(err);
        const d = meta?.format?.duration || meta?.streams?.[0]?.duration;
        resolve(Number(d) || 0);
      });
    });
  } catch (e) { throw e; }
}

module.exports = {
  detectSubjects,
  submitAvatarTask,
  pollAvatarResult,
  generateDigitalHumanVideo,
  REQ_KEY_OMNI,
  REQ_KEY_DETECT,
};
