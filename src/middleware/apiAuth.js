/**
 * OpenAPI 签名验证中间件
 * 验证 header: X-App-Id, X-Timestamp, X-Nonce, X-Signature
 * 签名算法：HMAC-SHA256( app_secret, `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}` )
 *   - method：大写 HTTP 方法
 *   - path：请求 path（不含 query）
 *   - timestamp：秒级 UNIX 时间（±300s 内有效）
 *   - nonce：客户端生成，建议 16-32 字节随机
 *   - bodyHash：SHA-256(原始 body 字节) 的 hex；GET/无 body 请求用 ''
 * 通过后在 req.apiAccount 注入账号对象。
 */
const crypto = require('crypto');
const authStore = require('../models/authStore');
const { matchCatalogKey } = require('../services/apiCatalog');

const MAX_CLOCK_SKEW_SEC = 300;
// 简单内存防重放 — 5 分钟窗口的 nonce + ts 集合
const _seenNonces = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _seenNonces.entries()) if (now - v > MAX_CLOCK_SKEW_SEC * 1000) _seenNonces.delete(k);
}, 60 * 1000);

function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function hmacHex(secret, payload) { return crypto.createHmac('sha256', secret).update(payload).digest('hex'); }

function apiAuth(req, res, next) {
  const appId = req.get('X-App-Id');
  const ts = req.get('X-Timestamp');
  const nonce = req.get('X-Nonce');
  const signature = req.get('X-Signature');
  if (!appId || !ts || !nonce || !signature) {
    return res.status(401).json({ success: false, error: '缺少签名 header (X-App-Id / X-Timestamp / X-Nonce / X-Signature)' });
  }

  // 时间戳窗口
  const tsNum = parseInt(ts, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(tsNum) || Math.abs(nowSec - tsNum) > MAX_CLOCK_SKEW_SEC) {
    return res.status(401).json({ success: false, error: '时间戳超出 ±5 分钟窗口，请检查客户端时间' });
  }

  // 防重放
  const seenKey = `${appId}:${ts}:${nonce}`;
  if (_seenNonces.has(seenKey)) return res.status(401).json({ success: false, error: 'nonce 重复，疑似重放' });
  _seenNonces.set(seenKey, Date.now());

  // 账号
  const acc = authStore.getApiAccountByAppId(appId);
  if (!acc) return res.status(401).json({ success: false, error: 'AppID 不存在' });
  if (acc.status !== 'active') return res.status(403).json({ success: false, error: '账号已停用' });

  // 计算签名
  const method = (req.method || '').toUpperCase();
  const pathOnly = (req.originalUrl || req.url).split('?')[0];
  const rawBody = req.rawBody || (req.body && Object.keys(req.body).length ? Buffer.from(JSON.stringify(req.body)) : Buffer.alloc(0));
  const bodyHash = rawBody.length ? sha256Hex(rawBody) : '';
  const payload = `${method}\n${pathOnly}\n${ts}\n${nonce}\n${bodyHash}`;
  const expected = hmacHex(acc.app_secret, payload);
  if (expected !== signature) {
    return res.status(401).json({ success: false, error: '签名校验失败' });
  }

  // 权限校验（按 catalog 匹配）— pathOnly 形如 /openapi/drama/projects，剥掉 /openapi
  const businessPath = pathOnly.replace(/^\/openapi/, '') || '/';
  const catalogKey = matchCatalogKey(method, businessPath);
  if (!catalogKey) return res.status(404).json({ success: false, error: '未知接口路径' });
  const allowed = Array.isArray(acc.allowed_apis) ? acc.allowed_apis : [];
  if (!allowed.includes('*') && !allowed.includes(catalogKey)) {
    return res.status(403).json({ success: false, error: '账号无权限调用: ' + catalogKey });
  }

  // 记录用量
  try { authStore.recordApiUsage(acc.id); } catch {}

  req.apiAccount = acc;
  req.apiCatalogKey = catalogKey;
  next();
}

module.exports = { apiAuth };
