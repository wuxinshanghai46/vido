#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_ROOT = path.join(ROOT, 'public', 'story-ad');
const CONFIG_PATH = path.join(ROOT, 'config', 'story-ad-release.json');
const RELEASE_MODULE = path.join(PUBLIC_ROOT, 'release.js');
const MANIFEST_PATH = path.join(PUBLIC_ROOT, 'release-manifest.json');
const THREE_SOURCE = path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.min.js');
const THREE_TARGET = path.join(PUBLIC_ROOT, 'vendor', 'three.module.min.js');
const THREE_CORE_SOURCE = path.join(ROOT, 'node_modules', 'three', 'build', 'three.core.min.js');
const THREE_CORE_TARGET = path.join(PUBLIC_ROOT, 'vendor', 'three.core.min.js');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function normalizeReleaseUrls(source, buildId) {
  const current = source.replace(/((?:\/story-ad\/|\.{1,2}\/)[^'"?\s]+[?&]v=)(?:2026\d{4}[a-z0-9-]*|[a-z0-9]+(?:-[a-z0-9]+){2,})/ig,
    (_match, prefix) => `${prefix}${buildId}`);
  return current.replace(/((?:from\s*|import\(\s*)['"])(\.{1,2}\/[^'"?\s]+\.js)(['"])/g,
    (_match, prefix, url, suffix) => `${prefix}${url}?v=${buildId}${suffix}`);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function main() {
  const release = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (!/^[a-z0-9][a-z0-9._-]{7,80}$/i.test(String(release.build_id || ''))) {
    throw new Error('story-ad build_id 无效');
  }
  if (fs.existsSync(MANIFEST_PATH)) {
    const prior = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    if (prior.build_id === release.build_id) {
      const changed = (Array.isArray(prior.files) ? prior.files : []).filter(entry => {
        const absolute = path.resolve(ROOT, String(entry.path || ''));
        if (!absolute.startsWith(PUBLIC_ROOT + path.sep) || !fs.existsSync(absolute)) return true;
        const content = fs.readFileSync(absolute);
        return content.length !== Number(entry.bytes) || sha256(content) !== entry.sha256;
      });
      if (changed.length) {
        throw new Error(`禁止复用已发布 build_id ${release.build_id} 覆盖不同静态代码；请先生成新的 build_id。变化文件：${changed.slice(0, 6).map(item => item.path).join(', ')}`);
      }
    }
  }
  fs.mkdirSync(path.dirname(THREE_TARGET), { recursive: true });
  fs.copyFileSync(THREE_SOURCE, THREE_TARGET);
  fs.copyFileSync(THREE_CORE_SOURCE, THREE_CORE_TARGET);
  const sourceFiles = walk(PUBLIC_ROOT).filter(file => /\.(?:html|js)$/i.test(file)
    && file !== RELEASE_MODULE && file !== MANIFEST_PATH);
  sourceFiles.forEach(file => {
    const current = fs.readFileSync(file, 'utf8');
    const next = normalizeReleaseUrls(current, release.build_id);
    if (next !== current) fs.writeFileSync(file, next, 'utf8');
  });
  fs.writeFileSync(RELEASE_MODULE, [
    `export const CLIENT_BUILD_ID = ${JSON.stringify(release.build_id)};`,
    `export const CLIENT_CONTRACT_VERSION = ${JSON.stringify(release.contract_version)};`,
    '',
  ].join('\n'), 'utf8');
  const files = walk(PUBLIC_ROOT).filter(file => file !== MANIFEST_PATH).sort().map(file => {
    const content = fs.readFileSync(file);
    return {
      path: path.relative(ROOT, file).replace(/\\/g, '/'),
      bytes: content.length,
      sha256: sha256(content),
    };
  });
  const manifest = {
    schema_version: 1,
    build_id: release.build_id,
    contract_version: release.contract_version,
    generated_at: new Date().toISOString(),
    files,
  };
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ success: true, build_id: release.build_id, files: files.length }));
}

main();
