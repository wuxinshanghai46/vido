const dns = require('dns').promises;
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const path = require('path');
const { execFile } = require('child_process');
const ytdlpService = require('../ytdlpService');

const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MAX_DURATION_SECONDS = 180;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 120000;

const PLATFORM_HOSTS = [
  { platform: 'liblib', hosts: ['liblib.tv'] },
  { platform: 'douyin', hosts: ['douyin.com', 'iesdouyin.com'] },
  { platform: 'bilibili', hosts: ['bilibili.com', 'b23.tv'] },
  { platform: 'xiaohongshu', hosts: ['xiaohongshu.com', 'xhslink.com'] },
  { platform: 'kuaishou', hosts: ['kuaishou.com', 'chenzhongtech.com'] },
  { platform: 'youtube', hosts: ['youtube.com', 'youtu.be'] },
];

function makeError(message, code, status = 422) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function extractHttpUrl(raw = '') {
  const text = String(raw || '').trim();
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) {
    throw makeError('请输入完整的公开视频链接（以 http:// 或 https:// 开头）', 'REFERENCE_VIDEO_URL_REQUIRED', 400);
  }
  return match[0].replace(/[，。；、）》】]+$/g, '');
}

function parseUrl(raw = '') {
  let parsed;
  try {
    parsed = new URL(extractHttpUrl(raw));
  } catch (error) {
    if (error.code) throw error;
    throw makeError('视频链接格式不正确', 'REFERENCE_VIDEO_URL_INVALID', 422);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw makeError('仅支持公网 HTTP/HTTPS 视频链接', 'REFERENCE_VIDEO_URL_PROTOCOL_UNSUPPORTED', 422);
  }
  if (parsed.username || parsed.password) {
    throw makeError('视频链接不能包含账号或密码', 'REFERENCE_VIDEO_URL_CREDENTIALS_FORBIDDEN', 422);
  }
  if ((parsed.protocol === 'http:' && parsed.port && parsed.port !== '80')
    || (parsed.protocol === 'https:' && parsed.port && parsed.port !== '443')) {
    throw makeError('视频链接仅允许使用标准的 80/443 端口', 'REFERENCE_VIDEO_URL_PORT_FORBIDDEN', 422);
  }
  return parsed;
}

function isBlockedIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0)
    || a >= 224;
}

function isBlockedIp(ip = '') {
  const value = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const version = net.isIP(value);
  if (version === 4) return isBlockedIpv4(value);
  if (version !== 6) return true;
  const halves = value.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length > 1
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  if (groups.length !== 8) return true;
  const nums = groups.map(group => Number.parseInt(group || '0', 16));
  if (nums.some(group => !Number.isInteger(group) || group < 0 || group > 0xffff)) return true;
  const first = nums[0];
  const isMappedIpv4 = nums.slice(0, 5).every(group => group === 0) && [0, 0xffff].includes(nums[5]);
  if (isMappedIpv4) {
    const mapped = [
      nums[6] >> 8,
      nums[6] & 255,
      nums[7] >> 8,
      nums[7] & 255,
    ].join('.');
    return isBlockedIpv4(mapped);
  }
  return nums.every(group => group === 0)
    || nums.slice(0, 7).every(group => group === 0) && nums[7] === 1
    || (first & 0xfe00) === 0xfc00
    || (first & 0xffc0) === 0xfe80
    || (first & 0xff00) === 0xff00
    || (nums[0] === 0x2001 && nums[1] === 0x0db8);
}

function platformForHost(hostname = '') {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  const match = PLATFORM_HOSTS.find(row => row.hosts.some(domain => host === domain || host.endsWith(`.${domain}`)));
  return match?.platform || '';
}

function sanitizeDisplayUrl(parsed) {
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
}

async function resolvePublicHost(hostname, resolver = dns.lookup) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw makeError('不允许读取本机或内网视频地址', 'REFERENCE_VIDEO_URL_PRIVATE_HOST_FORBIDDEN', 422);
  }
  const directIp = net.isIP(host);
  let addresses;
  try {
    addresses = directIp ? [{ address: host, family: directIp }] : await resolver(host, { all: true, verbatim: true });
  } catch {
    throw makeError('视频链接域名无法解析或暂时不可访问', 'REFERENCE_VIDEO_URL_HOST_UNREACHABLE', 422);
  }
  if (!addresses.length || addresses.some(row => isBlockedIp(row.address))) {
    throw makeError('不允许读取本机、内网或保留网段的视频地址', 'REFERENCE_VIDEO_URL_PRIVATE_HOST_FORBIDDEN', 422);
  }
  return addresses;
}

async function inspectUrl(raw, options = {}) {
  const parsed = parseUrl(raw);
  const addresses = await resolvePublicHost(parsed.hostname, options.resolver || dns.lookup);
  return {
    url: parsed.toString(),
    display_url: sanitizeDisplayUrl(parsed),
    platform: platformForHost(parsed.hostname) || 'public_web',
    hostname: parsed.hostname,
    resolved_addresses: addresses.map(row => row.address),
  };
}

function safeUnlink(filePath) {
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
}

async function fetchPublicJson(initialUrl, options = {}) {
  let current = parseUrl(initialUrl);
  const maxBytes = Number(options.maxBytes || 2 * 1024 * 1024);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const addresses = await resolvePublicHost(current.hostname, options.resolver || dns.lookup);
    const pinned = addresses[0];
    const client = current.protocol === 'https:' ? https : http;
    const response = await new Promise((resolve, reject) => {
      const request = client.get(current, {
        headers: {
          'User-Agent': 'VIDO-ReferenceVideo/1.0',
          Accept: 'application/json',
        },
        lookup: (_hostname, _lookupOptions, callback) => callback(null, pinned.address, pinned.family),
      }, resolve);
      request.setTimeout(options.timeoutMs || 30000, () => {
        request.destroy(makeError('视频详情接口读取超时', 'REFERENCE_VIDEO_PAGE_RESOLVE_TIMEOUT', 504));
      });
      request.on('error', reject);
      if (options.signal) {
        const abort = () => request.destroy(makeError('视频链接读取已取消', 'REFERENCE_VIDEO_IMPORT_CANCELLED', 409));
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
      }
    });
    const status = Number(response.statusCode || 0);
    if ([301, 302, 303, 307, 308].includes(status)) {
      response.resume();
      const location = response.headers.location;
      if (!location) throw makeError('视频详情接口跳转地址无效', 'REFERENCE_VIDEO_PAGE_REDIRECT_INVALID', 422);
      current = parseUrl(new URL(location, current).toString());
      continue;
    }
    if (status < 200 || status >= 300) {
      response.resume();
      throw makeError(`视频详情接口读取失败（HTTP ${status || '未知'}）`, 'REFERENCE_VIDEO_PAGE_RESOLVE_FAILED', 422);
    }
    const chunks = [];
    let received = 0;
    await new Promise((resolve, reject) => {
      response.on('data', chunk => {
        received += chunk.length;
        if (received > maxBytes) {
          response.destroy(makeError('视频详情数据异常或过大', 'REFERENCE_VIDEO_PAGE_RESPONSE_TOO_LARGE', 413));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', resolve);
      response.on('error', reject);
    });
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw makeError('视频详情接口没有返回有效数据', 'REFERENCE_VIDEO_PAGE_RESPONSE_INVALID', 422);
    }
  }
  throw makeError('视频详情接口跳转次数过多', 'REFERENCE_VIDEO_PAGE_TOO_MANY_REDIRECTS', 422);
}

function liblibCaseItems(skill = {}) {
  const direct = Array.isArray(skill.caseItems) ? skill.caseItems : [];
  if (direct.length) return direct;
  try {
    const snapshot = typeof skill.snapshotData === 'string'
      ? JSON.parse(skill.snapshotData)
      : (skill.snapshotData || {});
    if (Array.isArray(snapshot.caseItems)) return snapshot.caseItems;
    if (Array.isArray(snapshot.productionCaseUrls)) {
      return snapshot.productionCaseUrls.map(productionCaseUrl => ({ productionCaseUrl }));
    }
  } catch {}
  return [];
}

async function resolveLiblibShareVideo(inspected, options = {}) {
  const pageUrl = new URL(inspected.url);
  if (!/^\/skill\/share\/?$/.test(pageUrl.pathname)) {
    throw makeError('当前仅支持 Liblib Skill 分享页的视频样例', 'REFERENCE_VIDEO_LIBLIB_PAGE_UNSUPPORTED', 422);
  }
  const uuid = String(pageUrl.searchParams.get('uuid') || '').trim();
  if (!/^[a-f0-9-]{16,64}$/i.test(uuid)) {
    throw makeError('Liblib 分享链接缺少有效的 uuid', 'REFERENCE_VIDEO_LIBLIB_UUID_INVALID', 422);
  }
  const apiUrl = `https://api.liblib.tv/api/community/skill/template/detail?templateUuid=${encodeURIComponent(uuid)}`;
  const payload = await (options.fetchJson || fetchPublicJson)(apiUrl, options);
  const skill = payload?.data?.skill || payload?.skill || payload?.data || {};
  const item = liblibCaseItems(skill)
    .find(row => /^https?:\/\//i.test(String(row?.productionCaseUrl || row?.videoUrl || '')));
  const mediaUrl = String(item?.productionCaseUrl || item?.videoUrl || '').trim();
  if (!mediaUrl) {
    throw makeError('该 Liblib 分享页没有可读取的视频样例', 'REFERENCE_VIDEO_LIBLIB_MEDIA_MISSING', 422);
  }
  const media = await (options.inspectUrl || inspectUrl)(mediaUrl, options);
  return {
    ...media,
    title: String(skill.name || 'Liblib 视频样例').trim().slice(0, 80),
  };
}

async function downloadDirect(initialUrl, directory, options = {}) {
  let current = parseUrl(initialUrl);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const addresses = await resolvePublicHost(current.hostname, options.resolver || dns.lookup);
    const pinned = addresses[0];
    const client = current.protocol === 'https:' ? https : http;
    const target = path.join(directory, 'source-download.part');
    safeUnlink(target);
    const response = await new Promise((resolve, reject) => {
      const request = client.get(current, {
        headers: {
          'User-Agent': 'VIDO-ReferenceVideo/1.0',
          Accept: 'video/*,application/octet-stream;q=0.8',
        },
        lookup: (_hostname, _lookupOptions, callback) => callback(null, pinned.address, pinned.family),
      }, resolve);
      request.setTimeout(options.timeoutMs || REQUEST_TIMEOUT_MS, () => {
        request.destroy(makeError('读取视频链接超时，请检查链接后重试', 'REFERENCE_VIDEO_URL_TIMEOUT', 504));
      });
      request.on('error', reject);
      if (options.signal) {
        const abort = () => request.destroy(makeError('视频链接读取已取消', 'REFERENCE_VIDEO_IMPORT_CANCELLED', 409));
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
      }
    });
    const status = Number(response.statusCode || 0);
    if ([301, 302, 303, 307, 308].includes(status)) {
      response.resume();
      const location = response.headers.location;
      if (!location) throw makeError('视频链接跳转地址无效', 'REFERENCE_VIDEO_URL_REDIRECT_INVALID', 422);
      current = parseUrl(new URL(location, current).toString());
      continue;
    }
    if (status < 200 || status >= 300) {
      response.resume();
      throw makeError(`视频链接读取失败（HTTP ${status || '未知'}）`, 'REFERENCE_VIDEO_URL_FETCH_FAILED', 422);
    }
    const contentLength = Number(response.headers['content-length'] || 0);
    if (contentLength > MAX_FILE_BYTES) {
      response.destroy();
      throw makeError('链接视频不能超过 200MB', 'REFERENCE_VIDEO_TOO_LARGE', 413);
    }
    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    const pathname = current.pathname.toLowerCase();
    if (!contentType.startsWith('video/') && !/\.(mp4|mov|webm)$/.test(pathname)) {
      response.destroy();
      throw makeError('该地址不是可直接读取的视频，请粘贴受支持平台的视频作品页或视频直链', 'REFERENCE_VIDEO_URL_NOT_MEDIA', 422);
    }
    let received = 0;
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(target, { flags: 'wx' });
      response.on('data', chunk => {
        received += chunk.length;
        if (received > MAX_FILE_BYTES) {
          response.destroy(makeError('链接视频不能超过 200MB', 'REFERENCE_VIDEO_TOO_LARGE', 413));
          return;
        }
        options.onProgress?.(received, contentLength);
      });
      response.on('error', reject);
      output.on('error', reject);
      output.on('finish', resolve);
      response.pipe(output);
    }).catch(error => {
      safeUnlink(target);
      throw error;
    });
    const extension = pathname.endsWith('.mov') ? '.mov' : pathname.endsWith('.webm') ? '.webm' : '.mp4';
    const finalPath = path.join(directory, `source${extension}`);
    safeUnlink(finalPath);
    fs.renameSync(target, finalPath);
    return {
      file_path: finalPath,
      original_name: path.basename(current.pathname) || `链接视频${extension}`,
      mimetype: contentType.split(';')[0] || 'video/mp4',
      size_bytes: received,
      final_url: current.toString(),
      method: 'direct',
    };
  }
  throw makeError('视频链接跳转次数过多', 'REFERENCE_VIDEO_URL_TOO_MANY_REDIRECTS', 422);
}

function runYtdlp(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, {
      maxBuffer: 8 * 1024 * 1024,
      timeout: options.timeoutMs || REQUEST_TIMEOUT_MS,
      windowsHide: true,
      signal: options.signal,
    }, (error, stdout, stderr) => {
      if (!error) return resolve({ stdout, stderr });
      const detail = String(stderr || error.message || '').slice(-800);
      if (error.name === 'AbortError' || options.signal?.aborted) {
        return reject(makeError('视频链接读取已取消', 'REFERENCE_VIDEO_IMPORT_CANCELLED', 409));
      }
      if (/duration|longer than/i.test(detail)) {
        return reject(makeError('链接视频不能超过 180 秒', 'REFERENCE_VIDEO_TOO_LONG', 422));
      }
      if (/filesize|max-filesize|larger than/i.test(detail)) {
        return reject(makeError('链接视频不能超过 200MB', 'REFERENCE_VIDEO_TOO_LARGE', 413));
      }
      if (/login|cookie|private|sign in|403/i.test(detail)) {
        return reject(makeError('该链接需要登录或不是公开视频，请改用本地上传', 'REFERENCE_VIDEO_URL_LOGIN_REQUIRED', 422));
      }
      return reject(makeError(`无法读取该视频链接：${detail || '平台解析失败'}`, 'REFERENCE_VIDEO_URL_EXTRACT_FAILED', 422));
    });
  });
}

async function downloadPlatformVideo(inspected, directory, options = {}) {
  const binary = ytdlpService._findYtdlp();
  if (!binary) {
    throw makeError('服务器暂未安装视频链接解析组件，请改用本地上传', 'REFERENCE_VIDEO_LINK_READER_UNAVAILABLE', 503);
  }
  let cookieFile = null;
  if (['douyin', 'bilibili', 'xiaohongshu', 'kuaishou'].includes(inspected.platform)) {
    cookieFile = await ytdlpService.getBestCookieFile(inspected.platform);
  }
  const outputTemplate = path.join(directory, 'source.%(ext)s');
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificate',
    '--max-filesize', '200M',
    '--match-filter', `!is_live & duration <= ${MAX_DURATION_SECONDS}`,
    '--merge-output-format', 'mp4',
    '-f', 'bv*[height<=720]+ba/b[height<=720]/b',
    '-o', outputTemplate,
  ];
  if (cookieFile && fs.existsSync(cookieFile)) args.push('--cookies', cookieFile);
  args.push(inspected.url);
  await runYtdlp(binary, args, options);
  const files = fs.readdirSync(directory)
    .filter(name => /^source\.(mp4|mov|webm)$/i.test(name))
    .map(name => path.join(directory, name));
  if (!files.length) {
    throw makeError('平台未返回可读取的视频文件，请改用本地上传', 'REFERENCE_VIDEO_URL_MEDIA_MISSING', 422);
  }
  const filePath = files[0];
  return {
    file_path: filePath,
    original_name: `${inspected.platform}-reference${path.extname(filePath).toLowerCase()}`,
    mimetype: path.extname(filePath).toLowerCase() === '.webm' ? 'video/webm' : 'video/mp4',
    size_bytes: fs.statSync(filePath).size,
    final_url: inspected.url,
    method: 'yt-dlp',
  };
}

async function downloadVideo(raw, directory, options = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const inspected = options.inspected || await inspectUrl(raw, options);
  const isDirectMedia = /\.(mp4|mov|webm)$/i.test(new URL(inspected.url).pathname);
  let downloaded;
  if (inspected.platform === 'liblib' && !isDirectMedia) {
    const media = await resolveLiblibShareVideo(inspected, options);
    downloaded = await downloadDirect(media.url, directory, options);
    downloaded.original_name = `${media.title}${path.extname(downloaded.file_path).toLowerCase()}`;
    downloaded.method = 'liblib-api+direct';
  } else if (inspected.platform !== 'public_web' && !isDirectMedia) {
    downloaded = await downloadPlatformVideo(inspected, directory, options);
  } else {
    downloaded = await downloadDirect(inspected.url, directory, options);
  }
  return { ...downloaded, inspected };
}

module.exports = {
  MAX_FILE_BYTES,
  MAX_DURATION_SECONDS,
  inspectUrl,
  downloadVideo,
  _private: {
    extractHttpUrl,
    parseUrl,
    isBlockedIp,
    platformForHost,
    sanitizeDisplayUrl,
    resolvePublicHost,
    fetchPublicJson,
    liblibCaseItems,
    resolveLiblibShareVideo,
    downloadDirect,
  },
};
