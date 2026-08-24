const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-reference-link-test-'));
process.env.OUTPUT_DIR = tempRoot;
process.env.NEW_STORY_AD_MOCK_LLM = '1';

const ffmpegPath = require('ffmpeg-static');
const linkSecurity = require('../src/services/newStoryAd/referenceVideoLinkService');
const analysisService = require('../src/services/newStoryAd/referenceVideoAnalysisService');

async function waitFor(id, user, statuses, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const record = analysisService.get(id, user);
    if (statuses.includes(record.status)) return record;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`timed out waiting for ${statuses.join(',')}`);
}

function mockLinkService(sourcePath, delayMs = 0) {
  return {
    async inspectUrl() {
      return {
        url: 'https://video.example.com/work/123?access_token=must-not-leak',
        display_url: 'https://video.example.com/work/123',
        platform: 'public_web',
        hostname: 'video.example.com',
      };
    },
    async downloadVideo(_url, directory, options = {}) {
      if (delayMs) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs);
          options.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            const error = new Error('cancelled');
            error.code = 'REFERENCE_VIDEO_IMPORT_CANCELLED';
            reject(error);
          }, { once: true });
        });
      }
      const target = path.join(directory, 'source.mp4');
      fs.copyFileSync(sourcePath, target);
      options.onProgress?.(fs.statSync(target).size, fs.statSync(target).size);
      return {
        file_path: target,
        original_name: 'linked-reference.mp4',
        mimetype: 'video/mp4',
        size_bytes: fs.statSync(target).size,
        method: 'test-copy',
      };
    },
  };
}

async function main() {
  const user = { id: 'reference-link-test-user' };
  const input = path.join(tempRoot, 'linked-input.mp4');
  execFileSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=green:s=720x1280:d=3:r=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    input,
  ], { windowsHide: true });

  [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.2',
    '169.254.1.1',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '0:0:0:0:0:ffff:7f00:1',
    'fd00::1',
    'fe80::1',
  ].forEach(ip => assert.strictEqual(linkSecurity._private.isBlockedIp(ip), true, `${ip} must be blocked`));
  ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']
    .forEach(ip => assert.strictEqual(linkSecurity._private.isBlockedIp(ip), false, `${ip} must be public`));
  await new Promise((resolve, reject) => {
    linkSecurity._private.pinnedLookup({ address: '8.8.8.8', family: 4 })(
      'public.example',
      { all: true },
      (error, addresses) => {
        try {
          if (error) throw error;
          assert.deepStrictEqual(addresses, [{ address: '8.8.8.8', family: 4 }]);
          resolve();
        } catch (assertionError) {
          reject(assertionError);
        }
      },
    );
  });
  await new Promise((resolve, reject) => {
    linkSecurity._private.pinnedLookup({ address: '8.8.8.8', family: 4 })(
      'public.example',
      {},
      (error, address, family) => {
        try {
          if (error) throw error;
          assert.strictEqual(address, '8.8.8.8');
          assert.strictEqual(family, 4);
          resolve();
        } catch (assertionError) {
          reject(assertionError);
        }
      },
    );
  });
  assert.throws(() => linkSecurity._private.parseUrl('file:///etc/passwd'), /http/);
  assert.throws(() => linkSecurity._private.parseUrl('https://example.com:8443/video.mp4'), /80\/443/);
  await assert.rejects(
    () => linkSecurity.inspectUrl('https://localhost/video.mp4'),
    error => error.code === 'REFERENCE_VIDEO_URL_PRIVATE_HOST_FORBIDDEN',
  );
  await assert.rejects(
    () => linkSecurity.inspectUrl('http://[::ffff:127.0.0.1]/video.mp4'),
    error => error.code === 'REFERENCE_VIDEO_URL_PRIVATE_HOST_FORBIDDEN',
  );
  await assert.rejects(
    () => linkSecurity.inspectUrl('https://public.example/video.mp4', {
      resolver: async () => [{ address: '192.168.1.20', family: 4 }],
    }),
    error => error.code === 'REFERENCE_VIDEO_URL_PRIVATE_HOST_FORBIDDEN',
  );
  const inspected = await linkSecurity.inspectUrl('https://www.bilibili.com/video/BV1TEST?token=secret', {
    resolver: async () => [{ address: '8.8.8.8', family: 4 }],
  });
  assert.strictEqual(inspected.platform, 'bilibili');
  assert.strictEqual(inspected.display_url, 'https://www.bilibili.com/video/BV1TEST');
  assert.strictEqual(linkSecurity._private.platformForHost('www.liblib.tv'), 'liblib');

  const proxyDir = path.join(tempRoot, 'analysis-proxy');
  fs.mkdirSync(proxyDir, { recursive: true });
  const oversizedResponse = fs.createReadStream(input);
  oversizedResponse.headers = {
    'content-length': String(linkSecurity.MAX_FILE_BYTES + 1),
    'content-type': 'video/mp4',
  };
  const proxied = await linkSecurity._private.transcodeResponseToAnalysisProxy(
    oversizedResponse,
    new URL('https://cdn.example.com/original.mp4'),
    proxyDir,
  );
  assert.strictEqual(proxied.method, 'direct-temp+ffmpeg-analysis-proxy');
  assert.strictEqual(proxied.analysis_proxy.generated, true);
  assert.ok(fs.existsSync(proxied.file_path));
  assert.ok(proxied.size_bytes > 0 && proxied.size_bytes < linkSecurity.MAX_FILE_BYTES);
  const rejectedOversizedSource = fs.createReadStream(input);
  rejectedOversizedSource.headers = {
    'content-length': String(linkSecurity.MAX_SOURCE_STREAM_BYTES + 1),
    'content-type': 'video/mp4',
  };
  await assert.rejects(
    () => linkSecurity._private.transcodeResponseToAnalysisProxy(
      rejectedOversizedSource,
      new URL('https://cdn.example.com/unsafe-original.mp4'),
      proxyDir,
    ),
    error => error.code === 'REFERENCE_VIDEO_SOURCE_STREAM_TOO_LARGE',
  );

  let liblibApiUrl = '';
  const resolvedLiblib = await linkSecurity._private.resolveLiblibShareVideo({
    url: 'https://www.liblib.tv/skill/share?uuid=fa22a3be235546c5b063f4abeecfba76',
    platform: 'liblib',
  }, {
    fetchJson: async url => {
      liblibApiUrl = url;
      return {
        code: 0,
        data: {
          skill: {
            name: '复古胶片广告风导演',
            caseItems: [{
              productionCaseUrl: 'https://libtv-res.liblib.art/upload-images/example/video.mp4',
            }],
          },
        },
      };
    },
    inspectUrl: async url => ({
      url,
      display_url: url,
      platform: 'public_web',
      hostname: 'libtv-res.liblib.art',
    }),
  });
  assert.ok(liblibApiUrl.includes('/api/community/skill/template/detail?templateUuid=fa22a3be235546c5b063f4abeecfba76'));
  assert.strictEqual(resolvedLiblib.title, '复古胶片广告风导演');
  assert.ok(resolvedLiblib.url.endsWith('/video.mp4'));
  assert.deepStrictEqual(linkSecurity._private.liblibCaseItems({
    snapshotData: JSON.stringify({
      caseItems: [{ productionCaseUrl: 'https://cdn.example/video.mp4' }],
    }),
  }), [{ productionCaseUrl: 'https://cdn.example/video.mp4' }]);
  await assert.rejects(
    () => linkSecurity._private.resolveLiblibShareVideo({
      url: 'https://www.liblib.tv/skill/share?uuid=bad',
      platform: 'liblib',
    }),
    error => error.code === 'REFERENCE_VIDEO_LIBLIB_UUID_INVALID',
  );

  let liblibProjectApiUrl = '';
  const resolvedLiblibProject = await linkSecurity._private.resolveLiblibVideo({
    url: 'https://www.liblib.tv/detail/cf025f2c342c47b69a1d19f6ee2009e5',
    platform: 'liblib',
  }, {
    fetchJson: async url => {
      liblibProjectApiUrl = url;
      return {
        code: 0,
        data: {
          detail: {
            templateUuid: 'cf025f2c342c47b69a1d19f6ee2009e5',
            name: '门窗产品TVC广告片',
            finalOutput: 'https://libtv-res.liblib.art/upload-images/example/project.mp4',
          },
        },
      };
    },
    inspectUrl: async url => ({
      url,
      display_url: url,
      platform: 'public_web',
      hostname: 'libtv-res.liblib.art',
    }),
  });
  assert.ok(liblibProjectApiUrl.includes('/api/community/project/template/detail?projectTemplateUuid=cf025f2c342c47b69a1d19f6ee2009e5'));
  assert.strictEqual(resolvedLiblibProject.title, '门窗产品TVC广告片');
  assert.ok(resolvedLiblibProject.url.endsWith('/project.mp4'));
  const liblibProxyLineage = await linkSecurity.downloadVideo(
    'https://www.liblib.tv/detail/cf025f2c342c47b69a1d19f6ee2009e5',
    proxyDir,
    {
      inspected: {
        url: 'https://www.liblib.tv/detail/cf025f2c342c47b69a1d19f6ee2009e5',
        platform: 'liblib',
      },
      fetchJson: async () => ({
        code: 0,
        data: { detail: { name: '大文件广告', finalOutput: 'https://cdn.example.com/proxy-source.mp4' } },
      }),
      inspectUrl: async url => ({ url, platform: 'public_web', hostname: 'cdn.example.com' }),
      downloadDirect: async () => ({
        file_path: path.join(proxyDir, 'source.mp4'),
        size_bytes: 1024,
        method: 'direct-temp+ffmpeg-analysis-proxy',
        analysis_proxy: { generated: true },
      }),
    },
  );
  assert.strictEqual(liblibProxyLineage.method, 'liblib-api+direct-temp+ffmpeg-analysis-proxy');

  await assert.rejects(
    () => linkSecurity._private.resolveLiblibVideo({
      url: 'https://www.liblib.tv/detail/bad',
      platform: 'liblib',
    }),
    error => error.code === 'REFERENCE_VIDEO_LIBLIB_PROJECT_UUID_INVALID',
  );
  await assert.rejects(
    () => linkSecurity._private.resolveLiblibProjectVideo({
      url: 'https://www.liblib.tv/detail/cf025f2c342c47b69a1d19f6ee2009e5',
      platform: 'liblib',
    }, {
      fetchJson: async () => ({ code: 0, data: {} }),
    }),
    error => error.code === 'REFERENCE_VIDEO_LIBLIB_PROJECT_NOT_FOUND',
  );
  await assert.rejects(
    () => linkSecurity._private.resolveLiblibProjectVideo({
      url: 'https://www.liblib.tv/detail/cf025f2c342c47b69a1d19f6ee2009e5',
      platform: 'liblib',
    }, {
      fetchJson: async () => ({
        code: 0,
        data: { detail: { name: '尚未发布成片', finalOutput: '' } },
      }),
    }),
    error => error.code === 'REFERENCE_VIDEO_LIBLIB_PROJECT_MEDIA_MISSING',
  );
  await assert.rejects(
    () => linkSecurity._private.resolveLiblibProjectVideo({
      url: 'https://www.liblib.tv/detail/cf025f2c342c47b69a1d19f6ee2009e5',
      platform: 'liblib',
    }, {
      fetchJson: async () => ({
        code: 0,
        data: { detail: { name: '危险地址', finalOutput: 'https://public.example/private.mp4' } },
      }),
      resolver: async () => [{ address: '192.168.1.20', family: 4 }],
    }),
    error => error.code === 'REFERENCE_VIDEO_URL_PRIVATE_HOST_FORBIDDEN',
  );
  await assert.rejects(
    () => linkSecurity._private.resolveLiblibVideo({
      url: 'https://www.liblib.tv/unknown/cf025f2c342c47b69a1d19f6ee2009e5',
      platform: 'liblib',
    }),
    error => error.code === 'REFERENCE_VIDEO_LIBLIB_PAGE_UNSUPPORTED',
  );

  await assert.rejects(
    () => analysisService.createFromUrl({
      body: { video_url: 'https://video.example.com/work/123' },
      user,
      linkService: mockLinkService(input),
    }),
    error => error.code === 'REFERENCE_VIDEO_RIGHTS_REQUIRED',
  );

  const created = await analysisService.createFromUrl({
    body: {
      video_url: 'https://video.example.com/work/123?access_token=must-not-leak',
      rights_confirmed: 'true',
    },
    user,
    linkService: mockLinkService(input),
  });
  assert.strictEqual(created.status, 'importing');
  assert.strictEqual(created.source.input_url, undefined);
  assert.ok(!JSON.stringify(created).includes('must-not-leak'));
  const uploaded = await waitFor(created.id, user, ['uploaded', 'failed']);
  assert.strictEqual(uploaded.status, 'uploaded', JSON.stringify(uploaded.error || {}));
  assert.ok(uploaded.source.metadata.duration_seconds >= 2.9);
  assert.strictEqual(uploaded.source.input_type, 'url');
  assert.strictEqual(uploaded.source.read_method, 'test-copy');
  assert.strictEqual(uploaded.source.local_path, undefined);
  assert.ok(!JSON.stringify(uploaded).includes('must-not-leak'));
  assert.strictEqual(uploaded.downstream_generation_triggered, false);

  const started = analysisService.start(uploaded.id, user);
  assert.strictEqual(started.accepted, true);
  const completed = await waitFor(uploaded.id, user, ['completed', 'failed']);
  assert.strictEqual(completed.status, 'completed', JSON.stringify(completed.error || {}));
  assert.strictEqual(completed.result.output_language, 'zh-CN');
  assert.ok(/[\u3400-\u9fff]{12}/.test(completed.result.generated_brief));
  assert.strictEqual(completed.downstream_generation_triggered, false);

  const cancellable = await analysisService.createFromUrl({
    body: { video_url: 'https://video.example.com/work/456', rights_confirmed: 'true' },
    user,
    linkService: mockLinkService(input, 5000),
  });
  assert.throws(() => analysisService.remove(cancellable.id, user), /取消/);
  analysisService.cancel(cancellable.id, user);
  const cancelled = await waitFor(cancellable.id, user, ['cancelled', 'failed']);
  assert.strictEqual(cancelled.status, 'cancelled');
  assert.throws(
    () => analysisService.start(cancellable.id, user),
    error => error.code === 'REFERENCE_VIDEO_SOURCE_MISSING',
  );

  const failingService = {
    async inspectUrl() {
      return {
        url: 'https://www.liblib.tv/skill/share?uuid=fa22a3be235546c5b063f4abeecfba76',
        display_url: 'https://www.liblib.tv/skill/share',
        platform: 'liblib',
        hostname: 'www.liblib.tv',
      };
    },
    async downloadVideo() {
      const error = new Error('样例读取失败');
      error.code = 'REFERENCE_VIDEO_TEST_FAILURE';
      throw error;
    },
  };
  const failing = await analysisService.createFromUrl({
    body: {
      video_url: 'https://www.liblib.tv/skill/share?uuid=fa22a3be235546c5b063f4abeecfba76',
      rights_confirmed: 'true',
    },
    user,
    linkService: failingService,
  });
  const failed = await waitFor(failing.id, user, ['failed']);
  assert.strictEqual(failed.status, 'failed');
  assert.strictEqual(failed.progress, 0, 'failed link imports must not remain on a partial percentage');
  assert.strictEqual(analysisService._private.readRecord(user.id, failing.id).progress, 0);
  if (analysisService._private.activeImports.get(failing.id)?.promise) {
    await analysisService._private.activeImports.get(failing.id).promise;
  }
  assert.throws(
    () => analysisService.reanalyze(failing.id, user),
    error => error.code === 'REFERENCE_VIDEO_SOURCE_MISSING',
  );
  const retriedImport = await analysisService.retryImport(failing.id, user, mockLinkService(input));
  assert.strictEqual(retriedImport.accepted, true);
  assert.strictEqual(retriedImport.record.status, 'importing');
  const retriedUploaded = await waitFor(failing.id, user, ['uploaded', 'failed']);
  assert.strictEqual(retriedUploaded.status, 'uploaded', JSON.stringify(retriedUploaded.error || {}));
  assert.strictEqual(retriedUploaded.source.read_method, 'test-copy');
  assert.strictEqual(retriedUploaded.import_retry.attempt, 1);

  if (analysisService._private.activeRuns.get(created.id)) {
    await analysisService._private.activeRuns.get(created.id);
  }
  analysisService.remove(created.id, user);
  analysisService.remove(cancellable.id, user);
  analysisService.remove(failing.id, user);

  console.log(JSON.stringify({
    passed: true,
    checks: 73,
    public_url_input: 'pass',
    liblib_share_api_resolution: 'pass',
    liblib_project_api_resolution: 'pass',
    ssrf_private_ranges: 'blocked',
    query_secret_exposed: false,
    cancellation: 'pass',
    failed_progress_terminal: true,
    oversized_analysis_proxy: 'pass',
    failed_import_retry: 'pass',
    chinese_autofill_source: 'pass',
    downstream_generation_triggered: false,
  }));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    const resolved = path.resolve(tempRoot);
    if (resolved.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolved, { recursive: true, force: true });
  });
