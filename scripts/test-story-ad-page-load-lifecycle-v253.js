#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const executable = file => read(file).replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');

function storage() { return { getItem() { return null; }, setItem() {}, removeItem() {} }; }

function loadApi(fetchImpl) {
  const sandbox = {
    CLIENT_BUILD_ID: 'build-v253', CLIENT_CONTRACT_VERSION: 'contract-v6',
    fetch: fetchImpl, AbortController, FormData, URL, Date, Error, Promise,
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, console,
    sessionStorage: storage(), localStorage: storage(),
    location: { pathname: '/story-ad/projects/test', search: '', href: 'https://example.test/story-ad/projects/test', replace() {} },
    document: { querySelectorAll: () => [], querySelector: () => null, createElement: () => ({ dataset: {}, className: '', innerHTML: '' }), body: { appendChild() {} }, addEventListener() {}, removeEventListener() {}, visibilityState: 'visible', documentElement: { dataset: {} } },
    window: { dispatchEvent() {} }, CustomEvent: function CustomEvent() {},
  };
  vm.runInNewContext(`${executable('public/story-ad/api.js')}\nglobalThis.__api={readServerRelease,assertCurrentRelease,startReleaseHeartbeat};`, sandbox);
  return sandbox.__api;
}

function heldFetch(counter) {
  return (_url, options = {}) => {
    counter.calls += 1;
    return new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => {
      const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
    }, { once: true }));
  };
}

async function main() {
  const timeoutCounter = { calls: 0 };
  const timeoutApi = loadApi(heldFetch(timeoutCounter));
  await assert.rejects(timeoutApi.readServerRelease(25), error => error.code === 'RELEASE_CHECK_TIMEOUT');
  assert.equal(timeoutCounter.calls, 1, '版本接口半开时必须在截止时间中止');

  const dedupeCounter = { calls: 0 };
  const dedupeApi = loadApi(heldFetch(dedupeCounter));
  const first = dedupeApi.assertCurrentRelease({ timeoutMs: 25 });
  const second = dedupeApi.assertCurrentRelease({ timeoutMs: 25 });
  assert.strictEqual(first, second, '并发版本检查必须复用同一个在途请求');
  await Promise.allSettled([first, second]);
  assert.equal(dedupeCounter.calls, 1, '在途版本检查不得叠加网络请求');

  const successApi = loadApi(async () => ({ ok: true, async json() { return {
    build_id: 'build-v253', contract_version: 'contract-v6', release_bundle_id: 'bundle-1', runtime_hash: 'hash-1',
  }; } }));
  const release = await successApi.assertCurrentRelease({ timeoutMs: 25 });
  assert.equal(release.release_bundle_id, 'bundle-1');

  const apiSource = read('public/story-ad/api.js');
  const appSource = read('public/story-ad/app.js');
  assert.match(apiSource, /fetchWithDeadline\('\/api\/auth\/refresh'[\s\S]*AUTH_REFRESH_TIMEOUT_MS/,
    '登录刷新也必须有截止时间，不能让页面内部读取永久等待');
  assert.match(appSource, /页面连接超时[\s\S]*data-retry-page[\s\S]*location\.reload/,
    '入口版本检查失败后必须结束加载态并提供重试');
  console.log(JSON.stringify({ passed: true, scope: 'page-load-lifecycle-v253', timeout_ms: 25, max_concurrent_release_checks: 1, model_calls: 0 }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
