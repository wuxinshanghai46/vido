/**
 * 通义万相 wan2.2-animate API 封装
 *   - 输入：人物图（URL）+ 模板视频（URL）
 *   - 输出：任意长度（2-30s）数字人视频，动作/表情/口型从模板视频完整迁移
 *   - 端点：阿里百炼 DashScope  /api/v1/services/aigc/image2video/video-synthesis
 *   - 异步：必须带 X-DashScope-Async: enable，返回 task_id，轮询 /tasks/{task_id}
 *
 * 文档：https://help.aliyun.com/zh/model-studio/wan-animate-move-api
 */
const axios = require('axios');
const { loadSettings } = require('./settingsService');

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const DASHSCOPE_INTL_BASE = 'https://dashscope-intl.aliyuncs.com/api/v1';
const DEFAULT_MODEL = 'wan2.2-animate-move';

function getDashScopeKey() {
  const settings = loadSettings();
  for (const p of (settings.providers || [])) {
    const isDashScope = /dashscope/i.test((p.api_url || '') + (p.preset || '') + (p.id || ''))
      || /通义|百炼|Wan/i.test(p.name || '');
    if (isDashScope && p.api_key) return p.api_key;
  }
  return process.env.DASHSCOPE_API_KEY || null;
}

function _chooseBase() {
  // 国内生产机优先北京区；如果 settings 里明确配 intl，切海外
  const settings = loadSettings();
  const p = (settings.providers || []).find(x => /dashscope-intl/i.test(x.api_url || ''));
  return p ? DASHSCOPE_INTL_BASE : DASHSCOPE_BASE;
}

/**
 * 提交一次 Wan-Animate 任务（异步）
 * @param {object} opts
 * @param {string} opts.imageUrl 人物图 URL（公网可访问，jpg/png/webp/bmp，≤5MB，200-4096 px，比例 1:3-3:1）
 * @param {string} opts.videoUrl 模板视频 URL（公网可访问，mp4/avi/mov，2-30s，200-2048 px，≤200MB）
 * @param {string} [opts.mode='wan-pro'] 推理质量：wan-std | wan-pro
 * @param {string} [opts.model='wan2.2-animate-move']
 * @param {boolean} [opts.watermark=false]
 * @param {boolean} [opts.checkImage=true] 人像合规检测
 * @returns {Promise<string>} task_id
 */
async function submitAnimateTask({ imageUrl, videoUrl, mode = 'wan-pro', model = DEFAULT_MODEL, watermark = false, checkImage = true }) {
  const apiKey = getDashScopeKey();
  if (!apiKey) throw new Error('未配置 DASHSCOPE_API_KEY（settings 或 env）');
  if (!imageUrl || !videoUrl) throw new Error('imageUrl 和 videoUrl 均必填');

  const body = {
    model,
    input: { image_url: imageUrl, video_url: videoUrl, watermark },
    parameters: { mode, check_image: checkImage },
  };

  const resp = await axios.post(
    `${_chooseBase()}/services/aigc/image2video/video-synthesis`,
    body,
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      timeout: 30000,
    }
  );

  const taskId = resp.data?.output?.task_id;
  if (!taskId) {
    const errMsg = resp.data?.message || JSON.stringify(resp.data).slice(0, 300);
    throw new Error('Wan-Animate 提交失败: ' + errMsg);
  }
  console.log(`[WanAnimate] 任务提交成功 task_id=${taskId} model=${model} mode=${mode}`);
  return taskId;
}

/**
 * 查询任务状态（单次）
 * @param {string} taskId
 * @returns {Promise<{status:string, videoUrl?:string, error?:string, raw?:object}>}
 */
async function queryAnimateTask(taskId) {
  const apiKey = getDashScopeKey();
  if (!apiKey) throw new Error('未配置 DASHSCOPE_API_KEY');
  const resp = await axios.get(
    `${_chooseBase()}/tasks/${taskId}`,
    { headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 15000 }
  );
  const out = resp.data?.output || {};
  const status = out.task_status || 'UNKNOWN';
  const result = {
    status,
    raw: resp.data,
    videoUrl: out.results?.video_url || null,
    error: null,
  };
  if (status === 'FAILED') {
    result.error = out.message || out.code || 'FAILED';
  }
  return result;
}

/**
 * 轮询直到任务完成（或超时）
 * @param {string} taskId
 * @param {object} [opts]
 * @param {number} [opts.intervalMs=15000]
 * @param {number} [opts.timeoutMs=15*60*1000] 15 分钟
 * @param {(state:object)=>void} [opts.onProgress]
 */
async function waitAnimateTask(taskId, { intervalMs = 15000, timeoutMs = 15 * 60 * 1000, onProgress } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await queryAnimateTask(taskId);
    if (onProgress) try { onProgress(s); } catch {}
    if (s.status === 'SUCCEEDED') return s;
    if (s.status === 'FAILED') throw new Error('Wan-Animate 失败: ' + s.error);
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Wan-Animate 轮询超时');
}

/**
 * 一步到位：提交 + 轮询
 */
async function generateAnimateVideo(opts) {
  const _started = Date.now();
  let _ok = false; let _err = null; let _taskId = null;
  let _videoSeconds = 0;
  try {
    _taskId = await submitAnimateTask(opts);
    const result = await waitAnimateTask(_taskId, { onProgress: opts.onProgress });
    // 探测真实视频时长（wan-animate 输出长度 ≈ 输入模板视频长度）
    if (opts.videoUrl) {
      try { _videoSeconds = await _probeDurationSec(opts.videoUrl); } catch {}
    }
    if (!_videoSeconds && result?.raw?.output?.results?.video_duration) {
      _videoSeconds = Number(result.raw.output.results.video_duration) || 0;
    }
    if (!_videoSeconds) _videoSeconds = 5;  // 兜底（wan-animate 默认 5 秒）
    _ok = true;
    return { taskId: _taskId, videoUrl: result.videoUrl };
  } catch (e) { _err = e.message; throw e; }
  finally {
    try {
      require('./tokenTracker').record({
        provider: 'dashscope', model: opts.model || DEFAULT_MODEL,
        category: 'video', videoSeconds: _videoSeconds,
        durationMs: Date.now() - _started,
        status: _ok ? 'success' : 'fail', errorMsg: _err,
        userId: opts.userId, agentId: opts.agentId, requestId: _taskId,
      });
    } catch {}
  }
}

async function _probeDurationSec(urlOrPath) {
  try {
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
    try { const fps = require('ffprobe-static'); ffmpeg.setFfprobePath(fps.path); } catch {}
    return await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(urlOrPath, (err, meta) => {
        if (err) return reject(err);
        resolve(Number(meta?.format?.duration || 0));
      });
    });
  } catch { return 0; }
}

module.exports = {
  submitAnimateTask,
  queryAnimateTask,
  waitAnimateTask,
  generateAnimateVideo,
  getDashScopeKey,
  DEFAULT_MODEL,
};
