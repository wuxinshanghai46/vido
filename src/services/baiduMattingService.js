/**
 * 百度 AI 人像分割（body_seg）封装
 * 文档：https://ai.baidu.com/ai-doc/BODY/Fk3cpyxua
 *
 * api_key 格式：API_KEY:SECRET_KEY（存在 settings 的 baidu-aip provider.api_key）
 *
 * 核心：
 *   getAccessToken()                — 带缓存（30 天有效）
 *   segmentFrame(imgBuffer, type)    — 单帧抠图，返回 foreground PNG buffer
 *   segmentFramesBatch(buffers, cfg) — 并发分批（QPS=10）
 */
const axios = require('axios');
const { getApiKey, loadSettings } = require('./settingsService');

const OAUTH = 'https://aip.baidubce.com/oauth/2.0/token';
const BODY_SEG = 'https://aip.baidubce.com/rest/2.0/image-classify/v1/body_seg';

let _cachedToken = null;
let _tokenExpireAt = 0;

function _loadCreds() {
  const key = getApiKey('baidu-aip');
  if (!key) {
    // fallback: 直接扫 providers
    const s = loadSettings();
    const p = (s.providers || []).find(x => x.id === 'baidu-aip' || x.preset === 'baidu-aip');
    if (!p?.api_key) throw new Error('未配置 baidu-aip 的 api_key（格式 API_KEY:SECRET_KEY）');
    if (!p.api_key.includes(':')) throw new Error('baidu-aip api_key 必须是 API_KEY:SECRET_KEY 格式');
    const [ak, sk] = p.api_key.split(':');
    return { ak: ak.trim(), sk: sk.trim() };
  }
  if (!key.includes(':')) throw new Error('baidu-aip api_key 必须是 API_KEY:SECRET_KEY 格式');
  const [ak, sk] = key.split(':');
  return { ak: ak.trim(), sk: sk.trim() };
}

async function getAccessToken(force = false) {
  if (!force && _cachedToken && Date.now() < _tokenExpireAt - 60_000) return _cachedToken;
  const { ak, sk } = _loadCreds();
  const res = await axios.post(OAUTH, null, {
    params: { grant_type: 'client_credentials', client_id: ak, client_secret: sk },
    timeout: 15000,
  });
  if (!res.data?.access_token) throw new Error('百度 OAuth 失败: ' + JSON.stringify(res.data).slice(0, 200));
  _cachedToken = res.data.access_token;
  _tokenExpireAt = Date.now() + (res.data.expires_in || 30 * 24 * 3600) * 1000;
  return _cachedToken;
}

/**
 * 单帧抠图
 * @param {Buffer} imgBuffer
 * @param {'foreground'|'scoremap'|'labelmap'} type  — 默认 foreground 直接给透明背景 PNG
 * @returns {Promise<Buffer>} foreground PNG buffer（有 alpha 通道）
 */
async function segmentFrame(imgBuffer, type = 'foreground') {
  if (!Buffer.isBuffer(imgBuffer)) throw new Error('imgBuffer must be Buffer');
  const token = await getAccessToken();
  // 图片 base64 编码（去掉 Data URL 前缀）
  const b64 = imgBuffer.toString('base64');
  const form = new URLSearchParams();
  form.append('image', b64);
  form.append('type', type);
  const res = await axios.post(`${BODY_SEG}?access_token=${token}`, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30000,
    validateStatus: () => true,
    maxContentLength: 50 * 1024 * 1024,
  });
  if (res.data?.error_code) {
    // 111 = access_token 过期，重试一次
    if (res.data.error_code === 111 || res.data.error_code === 110) {
      await getAccessToken(true);
      return segmentFrame(imgBuffer, type);
    }
    throw new Error(`百度抠图错误 ${res.data.error_code}: ${res.data.error_msg || 'unknown'}`);
  }
  const fgB64 = res.data?.foreground;
  if (!fgB64) throw new Error('百度返回无 foreground: ' + JSON.stringify(res.data).slice(0, 200));
  return Buffer.from(fgB64, 'base64');
}

/**
 * 批量抠图（并发控制 = QPS）
 * @param {Buffer[]} buffers
 * @param {{qps?: number, onFrame?: (idx, total)=>void}} [opts]
 * @returns {Promise<Buffer[]>} 与输入等长
 */
async function segmentFramesBatch(buffers, { qps = 8, onFrame } = {}) {
  const total = buffers.length;
  const results = new Array(total);
  let nextIdx = 0;
  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= total) return;
      try {
        results[i] = await segmentFrame(buffers[i]);
      } catch (e) {
        // 失败保留原图作兜底（不抠，叠背景后会露出原背景；比整体报错强）
        console.warn(`[baidu-matting] 第 ${i + 1}/${total} 帧失败: ${e.message}`);
        results[i] = buffers[i];
      }
      if (onFrame) try { onFrame(i + 1, total); } catch {}
    }
  }
  const workers = Array.from({ length: Math.min(qps, total) }, () => worker());
  await Promise.all(workers);
  return results;
}

module.exports = {
  getAccessToken,
  segmentFrame,
  segmentFramesBatch,
};
