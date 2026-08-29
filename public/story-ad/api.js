import { CLIENT_BUILD_ID, CLIENT_CONTRACT_VERSION } from './release.js?v=20260829-production-v273';

export { CLIENT_BUILD_ID, CLIENT_CONTRACT_VERSION };
const TOKEN_KEYS = ['vido_token', 'token'];
let refreshPromise = null;
let releaseExpired = false;
let releaseHeartbeat = null;
let releaseCheckPromise = null;
let serverReleaseIdentity = null;
const RELEASE_CHECK_TIMEOUT_MS = 8000;
const AUTH_REFRESH_TIMEOUT_MS = 10000;

async function fetchWithDeadline(path, options = {}, timeoutMs = RELEASE_CHECK_TIMEOUT_MS, timeoutCode = 'REQUEST_TIMEOUT', consume = response => response) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener?.('abort', abortFromExternal, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || RELEASE_CHECK_TIMEOUT_MS));
  try {
    const response = await fetch(path, { ...options, signal: controller.signal });
    return await consume(response);
  } catch (error) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      const timeoutError = new Error('页面连接超时，请检查网络后重试。');
      timeoutError.code = timeoutCode;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', abortFromExternal);
  }
}

function preserveVisibleDraft() {
  try {
    const values = [...document.querySelectorAll('#storyAdApp input, #storyAdApp textarea, #storyAdApp select')]
      .filter(field => field.type !== 'password' && field.type !== 'file' && !field.disabled)
      .map(field => ({
        key: field.name || field.id || field.dataset?.field || '',
        value: field.type === 'checkbox' ? field.checked : field.value,
        type: field.type || field.tagName.toLowerCase(),
      })).filter(item => item.key).slice(0, 300);
    sessionStorage.setItem(`story-ad-release-draft:${location.pathname}`, JSON.stringify({
      build_id: CLIENT_BUILD_ID,
      saved_at: new Date().toISOString(),
      values,
    }));
  } catch {}
}

function showReleaseBlock(expectedBuild = '') {
  releaseExpired = true;
  document.documentElement.dataset.storyAdReleaseExpired = 'true';
  window.dispatchEvent(new CustomEvent('story-ad:release-expired', { detail: { expectedBuild } }));
  let blocker = document.querySelector('[data-story-ad-release-blocker]');
  if (!blocker) {
    blocker = document.createElement('div');
    blocker.dataset.storyAdReleaseBlocker = 'true';
    blocker.className = 'story-ad-release-blocker';
    blocker.innerHTML = '<section><b>剧情广告已发布新版本</b><p>旧页面已经停止操作，正在载入最新功能，避免旧代码覆盖新内容。</p></section>';
    document.body.appendChild(blocker);
  }
}

function showManualReleaseRetry(expectedBuild = '') {
  const blocker = document.querySelector('[data-story-ad-release-blocker]');
  const section = blocker?.querySelector('section');
  if (!section || section.querySelector('[data-release-retry]')) return;
  section.insertAdjacentHTML('beforeend', '<button type="button" data-release-retry>重新载入最新版本</button>');
  section.querySelector('[data-release-retry]')?.addEventListener('click', () => {
    try { sessionStorage.removeItem(`story-ad-release-reload:${expectedBuild}`); } catch {}
    const url = new URL(location.href);
    url.searchParams.set('_reload_nonce', `${Date.now()}`);
    location.replace(url.toString());
  });
}

function expireAndReload(expectedBuild = '') {
  if (releaseExpired) return;
  preserveVisibleDraft();
  showReleaseBlock(expectedBuild);
  const url = new URL(location.href);
  const prior = url.searchParams.get('_build') || '';
  if (!expectedBuild) return showManualReleaseRetry('unknown');
  const reloadKey = `story-ad-release-reload:${expectedBuild}`;
  let attempted = false;
  try { attempted = sessionStorage.getItem(reloadKey) === '1'; } catch {}
  if (attempted) return showManualReleaseRetry(expectedBuild);
  try { sessionStorage.setItem(reloadKey, '1'); } catch {}
  url.searchParams.set('_build', expectedBuild);
  if (prior === expectedBuild) url.searchParams.set('_reload_nonce', `${Date.now()}`);
  setTimeout(() => location.replace(url.toString()), 80);
}

export async function readServerRelease(timeoutMs = RELEASE_CHECK_TIMEOUT_MS) {
  const result = await fetchWithDeadline(`/api/story-ad/version?_t=${Date.now()}`, {
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  }, timeoutMs, 'RELEASE_CHECK_TIMEOUT', async response => ({
    response,
    data: response.ok ? await response.json() : null,
  }));
  if (!result.response.ok) throw new Error('无法核对剧情广告版本。');
  return result.data;
}

export function assertCurrentRelease(options = {}) {
  if (releaseCheckPromise) return releaseCheckPromise;
  releaseCheckPromise = (async () => {
  const release = await readServerRelease(options.timeoutMs);
  if (release.build_id !== CLIENT_BUILD_ID || release.contract_version !== CLIENT_CONTRACT_VERSION) {
    expireAndReload(release.build_id || '');
    const error = new Error('服务器已经发布新版本，正在刷新页面。');
    error.code = 'CLIENT_BUILD_EXPIRED';
    throw error;
  }
  if (!release.release_bundle_id || !release.runtime_hash) {
    const error = new Error('服务器没有返回完整发布身份，已停止写入。');
    error.code = 'SERVER_RELEASE_IDENTITY_MISSING';
    throw error;
  }
  if (serverReleaseIdentity?.release_bundle_id
    && serverReleaseIdentity.release_bundle_id !== release.release_bundle_id) {
    expireAndReload(release.build_id || '');
    const error = new Error('服务器运行制品已变化，正在刷新页面。');
    error.code = 'CLIENT_BUILD_EXPIRED';
    throw error;
  }
  serverReleaseIdentity = release;
  try { sessionStorage.removeItem(`story-ad-release-reload:${release.build_id}`); } catch {}
  return release;
  })().finally(() => { releaseCheckPromise = null; });
  return releaseCheckPromise;
}

export function startReleaseHeartbeat(intervalMs = 60000) {
  if (releaseHeartbeat) return () => clearInterval(releaseHeartbeat);
  const check = () => assertCurrentRelease().catch(error => {
    if (error?.code !== 'CLIENT_BUILD_EXPIRED') console.warn('[story-ad] 版本核对暂时不可用');
  });
  releaseHeartbeat = setInterval(check, Math.max(15000, Number(intervalMs) || 60000));
  const onVisible = () => { if (document.visibilityState === 'visible') check(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(releaseHeartbeat);
    releaseHeartbeat = null;
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export function readToken() {
  for (const key of TOKEN_KEYS) {
    const token = sessionStorage.getItem(key) || localStorage.getItem(key) || '';
    if (token) return token;
  }
  return '';
}

function writeToken(token = '') {
  if (!token) return;
  sessionStorage.setItem('vido_token', token);
  localStorage.setItem('vido_token', token);
}

async function refreshAuth() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = fetchWithDeadline('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  }, AUTH_REFRESH_TIMEOUT_MS, 'AUTH_REFRESH_TIMEOUT', async response => ({
    response,
    data: response.ok ? await response.json() : null,
  })).then(async ({ response, data }) => {
    if (!response.ok) return false;
    const token = data?.success && data?.data?.access_token;
    if (!token) return false;
    writeToken(token);
    return true;
  }).catch(() => false).finally(() => {
    setTimeout(() => { refreshPromise = null; }, 800);
  });
  return refreshPromise;
}

function errorMessage(data, status) {
  const raw = String(data?.error || data?.message || data?.code || '').trim();
  const code = String(data?.code || '').trim().toUpperCase();
  if (code === 'GENERATION_ACTIVE_PLAN_REQUIRED'
    || /Active Plan|active_plan|person_plan_stale|scene_plan_stale|bundle_mismatch|input_fingerprint_mismatch|content_revision_mismatch/i.test(raw)) {
    return '当前项目的生成版本正在同步，或已有任务正在处理。请等待当前操作结束并刷新页面后再试；本次没有提交新的模型调用。';
  }
  if (/SCENE_(?:VISUAL_)?QA|VISION_QA|视觉模型全部失败|PROVIDER_RESPONSE_INVALID|(?:^|[\s:;])RATE_LIMIT(?:$|[\s:;])|(?:smscrw|webang-maas|zhipu|deyunai)\//i.test(`${code} ${raw}`)) {
    return '场景图片已保留，但审核服务暂时没有完成。可以稍后重新审核；重新审核不会重新生成图片。';
  }
  if (/[\u3400-\u9fff]/.test(raw)) return raw;
  if (status === 401) return '登录状态已失效，请重新登录。';
  if (status === 403) return '当前账号没有执行此操作的权限。';
  if (status === 404) return '没有找到对应项目，请返回任务中心刷新。';
  if (status === 409) return '项目内容已经变化，请刷新后再继续。';
  if (status === 426) return '当前页面版本已经过期。为避免旧代码覆盖新内容，请刷新页面后继续。';
  if (status === 429) return '调用过于频繁，请稍后重试。';
  return status ? `请求失败（状态码 ${status}）` : '请求失败，请稍后重试。';
}

export async function request(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (releaseExpired && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const error = new Error('页面版本已经过期，已停止写入，请等待刷新。');
    error.code = 'CLIENT_BUILD_EXPIRED';
    error.status = 426;
    throw error;
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !serverReleaseIdentity?.release_bundle_id) {
    await assertCurrentRelease();
  }
  const headers = { ...(options.headers || {}) };
  headers['X-VIDO-Client-Build'] ||= CLIENT_BUILD_ID;
  headers['X-VIDO-Contract-Version'] ||= CLIENT_CONTRACT_VERSION;
  if (serverReleaseIdentity?.release_bundle_id) headers['X-VIDO-Client-Bundle'] ||= serverReleaseIdentity.release_bundle_id;
  if (serverReleaseIdentity?.release_control?.epoch) headers['X-VIDO-Release-Epoch'] ||= String(serverReleaseIdentity.release_control.epoch);
  const isForm = options.body instanceof FormData;
  if (!isForm) headers['Content-Type'] ||= 'application/json';
  const token = readToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || (isForm ? 180000 : 30000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const execute = () => fetch(path, {
    method,
    credentials: 'include',
    cache: method === 'GET' ? 'no-store' : 'default',
    headers,
    signal: options.signal || controller.signal,
    body: isForm ? options.body : (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  try {
    let response = await execute();
    if (response.status === 401 && await refreshAuth()) {
      const nextToken = readToken();
      if (nextToken) headers.Authorization = `Bearer ${nextToken}`;
      response = await execute();
    }
    if (response.status === 401) {
      location.href = `/?login=1&target=${encodeURIComponent(location.pathname + location.search)}`;
      throw new Error('登录状态已失效，请重新登录。');
    }
    const serverBuild = String(response.headers.get('X-VIDO-Build') || '').trim();
    const serverBundle = String(response.headers.get('X-VIDO-Release-Bundle') || '').trim();
    if (serverBuild && serverBuild !== CLIENT_BUILD_ID) {
      expireAndReload(serverBuild);
      const versionError = new Error('服务器已经发布新版本。为避免旧页面覆盖新内容，请刷新后继续。');
      versionError.status = 426;
      versionError.code = 'CLIENT_BUILD_EXPIRED';
      throw versionError;
    }
    if (serverBundle && serverReleaseIdentity?.release_bundle_id && serverBundle !== serverReleaseIdentity.release_bundle_id) {
      expireAndReload(serverBuild || CLIENT_BUILD_ID);
      const versionError = new Error('服务器运行制品已变化。为避免混用代码，正在刷新页面。');
      versionError.status = 426;
      versionError.code = 'CLIENT_RELEASE_BUNDLE_EXPIRED';
      throw versionError;
    }
    if (response.ok && options.responseType === 'blob') return response.blob();
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || data.success === false) {
      const error = new Error(errorMessage(data, response.status));
      error.status = response.status;
      error.code = data.code || '';
      error.data = data;
      throw error;
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('请求等待时间过长，已停止本次页面等待。');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function uploadAsset(file, role = 'asset') {
  const body = new FormData();
  body.append('file', file);
  body.append('role', role);
  return request('/api/new-story-ad/upload', { method: 'POST', body, timeoutMs: 180000 });
}

export function uploadReferenceVideo(file, taskId = '') {
  const body = new FormData();
  body.append('file', file);
  body.append('rights_confirmed', 'true');
  if (taskId) body.append('task_id', taskId);
  return request('/api/new-story-ad/reference-video-analyses', {
    method: 'POST',
    body,
    timeoutMs: 240000,
  });
}
