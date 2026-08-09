'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const sourceRoot = path.resolve(__dirname, '..');
const { BASE_FILES } = require('./lib/storyAdReleaseFiles');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-release-build-'));

function write(relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function copy(relative) {
  write(relative, fs.readFileSync(path.join(sourceRoot, relative)));
}

function digest(relative) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');
}

function runBuild() {
  return spawnSync(process.execPath, ['scripts/build-story-ad-release.js'], {
    cwd: root, encoding: 'utf8', timeout: 30000,
  });
}

try {
  copy('scripts/build-story-ad-release.js');
  copy('scripts/lib/storyAdReleaseFiles.js');
  write('config/story-ad-release.json', JSON.stringify({
    build_id: 'atomic-release-v1', contract_version: 'contract-v1',
    node_runtime: {
      version: 'v20.20.2', platform: 'linux-x64-glibc-217',
      url: 'https://example.invalid/node-runtime.tar.xz', sha256: 'a'.repeat(64),
    },
  }));
  write('package.json', JSON.stringify({ name: 'atomic-fixture', scripts: {} }));
  write('package-lock.json', '{}\n');
  write('public/story-ad/index.html', '<script type="module" src="/story-ad/app.js?v=old-release-v0"></script>\n');
  write('public/story-ad/app.js', "export const ok = true;\n");
  write('node_modules/three/build/three.module.min.js', 'export const three = true;\n');
  write('node_modules/three/build/three.core.min.js', 'export const core = true;\n');
  write('src/services/newStoryAd/runtime.js', 'module.exports = { version: 1 };\n');
  BASE_FILES.forEach((relative) => {
    const target = path.join(root, relative);
    if (fs.existsSync(target)) return;
    if (relative.endsWith('.json')) write(relative, '{}\n');
    else if (relative.endsWith('.html')) write(relative, '<!doctype html>\n');
    else write(relative, "'use strict';\n");
  });

  const first = runBuild();
  assert.strictEqual(first.status, 0, first.stderr || first.stdout);
  const publicHash = digest('public/story-ad/release-manifest.json');
  const runtimeHash = digest('config/story-ad-runtime-manifest.json');
  const firstRuntime = JSON.parse(fs.readFileSync(path.join(root, 'config/story-ad-runtime-manifest.json'), 'utf8'));
  assert(firstRuntime.files.some(entry => entry.path === 'src/services/newStoryAd/runtime.js'));

  const second = runBuild();
  assert.strictEqual(second.status, 0, second.stderr || second.stdout);
  assert.strictEqual(digest('public/story-ad/release-manifest.json'), publicHash, '相同代码重复构建必须保持静态清单不变');
  assert.strictEqual(digest('config/story-ad-runtime-manifest.json'), runtimeHash, '相同代码重复构建必须保持运行时清单不变');

  write('src/services/newStoryAd/runtime.js', 'module.exports = { version: 2 };\n');
  const rejected = runBuild();
  assert.notStrictEqual(rejected.status, 0, '同 build_id 修改运行时代码必须被拒绝');
  assert.match(`${rejected.stdout}\n${rejected.stderr}`, /禁止复用已发布 build_id/);
  assert.strictEqual(digest('public/story-ad/release-manifest.json'), publicHash, '构建失败不得提前覆盖静态清单');
  assert.strictEqual(digest('config/story-ad-runtime-manifest.json'), runtimeHash, '构建失败不得提前覆盖运行时清单');
  console.log(JSON.stringify({ passed: true, repeat_build_stable: true, runtime_change_blocked: true, failed_build_atomic: true }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
