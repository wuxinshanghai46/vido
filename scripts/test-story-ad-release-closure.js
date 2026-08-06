'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  RUNTIME_DIRECTORIES,
  collectStoryAdReleaseFiles,
  dependencyClosure,
  packageTestFiles,
} = require('./lib/storyAdReleaseFiles');

const root = path.resolve(__dirname, '..');
const manifest = require('../public/story-ad/release-manifest.json');
const runtimeManifest = require('../config/story-ad-runtime-manifest.json');

function walk(directory) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(absolute, entry.name);
    return entry.isDirectory()
      ? walk(path.relative(root, target))
      : [path.relative(root, target).replace(/\\/g, '/')];
  });
}

function main() {
  const files = collectStoryAdReleaseFiles({ root, releaseManifest: manifest });
  const selected = new Set(files);
  const runtimeSelected = new Set((runtimeManifest.files || []).map(item => item.path));
  assert(files.length > 100, `剧情广告发布集合异常偏小：${files.length}`);
  files.forEach(file => assert(fs.existsSync(path.join(root, file)), `发布文件不存在：${file}`));
  (manifest.files || []).forEach(entry => assert(selected.has(entry.path), `静态发布清单未进入发布集合：${entry.path}`));
  for (const directory of RUNTIME_DIRECTORIES) {
    for (const file of walk(directory).filter(value => /\.(?:js|json)$/i.test(value))) {
      assert(selected.has(file), `剧情广告运行时模块漏发：${file}`);
    }
  }
  packageTestFiles(root).forEach(file => assert(selected.has(file), `生产回归脚本漏发：${file}`));
  files.filter(file => file !== 'config/story-ad-runtime-manifest.json').forEach(file => {
    assert(runtimeSelected.has(file), `运行时哈希清单漏发：${file}`);
  });
  const closed = dependencyClosure(root, files);
  const missingDependencies = [...closed].filter(file => !selected.has(file));
  assert.deepStrictEqual(missingDependencies, [], `本地依赖闭包漏发：${missingDependencies.slice(0, 12).join(', ')}`);
  [
    'src/services/newStoryAd/knowledgePolicyCompilerService.js',
    'src/services/seeds/generation_runtime_policy.js',
    'scripts/test-new-story-ad-knowledge-policy-performance.js',
    'scripts/test-story-ad-release-closure.js',
  ].forEach(file => assert(selected.has(file), `本轮知识运行时文件漏发：${file}`));
  const deploySource = fs.readFileSync(path.join(root, 'scripts/deploy-story-ad-release.js'), 'utf8');
  assert(deploySource.includes("require('./lib/storyAdReleaseFiles')"), '部署脚本必须使用统一发布集合');
  assert(!deploySource.includes('const extraFiles = ['), '部署脚本不得保留第二份手工文件清单');
  assert(deploySource.indexOf('runLocalReleaseRegression();') < deploySource.indexOf("client.on('ready'"), '完整回归必须发生在连接生产并发布之前');
  assert(deploySource.includes("mv ${quote(`${stagingDir}/public/story-ad`)}"), '剧情广告静态目录必须整体切换');
  assert(deploySource.indexOf("pm2 reload vido") < deploySource.indexOf("npm run story-ad:knowledge-policy:test"), '发布后必须先 reload 再执行快速生产验收');
  assert(deploySource.includes('productionReleaseAfterReload.runtime_hash !== localRuntimeHash'), '发布后必须核对进程运行时哈希');
  const buildSource = fs.readFileSync(path.join(root, 'scripts/build-story-ad-release.js'), 'utf8');
  assert(buildSource.includes('禁止复用已发布 build_id') && buildSource.includes('RUNTIME_MANIFEST_PATH'), '构建必须禁止同 build_id 覆盖不同运行时代码');
  console.log(JSON.stringify({ passed: true, release_files: files.length, runtime_directories: RUNTIME_DIRECTORIES.length, package_test_files: packageTestFiles(root).length }));
}

main();
