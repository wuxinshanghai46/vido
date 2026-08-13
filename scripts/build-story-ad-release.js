#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_ROOT = path.join(ROOT, 'public', 'story-ad');
const CONFIG_PATH = path.join(ROOT, 'config', 'story-ad-release.json');
const RELEASE_MODULE = path.join(PUBLIC_ROOT, 'release.js');
const MANIFEST_PATH = path.join(PUBLIC_ROOT, 'release-manifest.json');
const RUNTIME_MANIFEST_PATH = path.join(ROOT, 'config', 'story-ad-runtime-manifest.json');
const THREE_SOURCE = path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.min.js');
const THREE_TARGET = path.join(PUBLIC_ROOT, 'vendor', 'three.module.min.js');
const THREE_CORE_SOURCE = path.join(ROOT, 'node_modules', 'three', 'build', 'three.core.min.js');
const THREE_CORE_TARGET = path.join(PUBLIC_ROOT, 'vendor', 'three.core.min.js');
const { resolveReleaseSourceIdentity } = require('./lib/releaseSourceIdentity');

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
  const sourceIdentity = resolveReleaseSourceIdentity({
    root: ROOT,
    requireRemoteSync: process.env.VIDO_RELEASE_REQUIRE_REMOTE_SYNC !== '0',
  });
  const release = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (!/^[a-z0-9][a-z0-9._-]{7,80}$/i.test(String(release.build_id || ''))) {
    throw new Error('story-ad build_id 无效');
  }
  const nodeRuntime = release.node_runtime || {};
  if (!/^v\d+\.\d+\.\d+$/.test(String(nodeRuntime.version || ''))
    || !/^https:\/\//.test(String(nodeRuntime.url || ''))
    || !/^[a-f0-9]{64}$/.test(String(nodeRuntime.sha256 || ''))
    || !/^[a-z0-9._-]+$/i.test(String(nodeRuntime.platform || ''))) {
    throw new Error('story-ad node_runtime 缺少固定版本、平台、HTTPS URL 或 SHA256');
  }
  const targetNodeMajor = Number(String(nodeRuntime.version).replace(/^v/, '').split('.')[0]);
  let priorPublicManifest = null;
  if (fs.existsSync(MANIFEST_PATH)) {
    priorPublicManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    if (priorPublicManifest.build_id === release.build_id) {
      const changed = (Array.isArray(priorPublicManifest.files) ? priorPublicManifest.files : []).filter(entry => {
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
    generated_at: priorPublicManifest?.build_id === release.build_id
      ? priorPublicManifest.generated_at
      : new Date().toISOString(),
    files,
  };
  const manifestBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const { collectStoryAdReleaseFiles } = require('./lib/storyAdReleaseFiles');
  const runtimeFiles = [...new Set([
    ...collectStoryAdReleaseFiles({ root: ROOT, releaseManifest: manifest }),
    'public/story-ad/release-manifest.json',
  ])].filter(file => file !== 'config/story-ad-runtime-manifest.json').sort();
  const runtimeEntries = runtimeFiles.map(file => {
    const content = file === 'public/story-ad/release-manifest.json'
      ? manifestBuffer
      : fs.readFileSync(path.join(ROOT, file));
    return { path: file, bytes: content.length, sha256: sha256(content) };
  });
  const lockfileSha256 = sha256(fs.readFileSync(path.join(ROOT, 'package-lock.json')));
  const sourceSnapshotHash = sha256(Buffer.from(JSON.stringify(runtimeEntries.map(entry => ({
    path: entry.path, bytes: entry.bytes, sha256: entry.sha256,
  })).sort((a, b) => a.path.localeCompare(b.path))), 'utf8'));
  const artifactId = sha256(Buffer.from(JSON.stringify({
    build_id: release.build_id,
    contract_version: release.contract_version,
    lockfile_sha256: lockfileSha256,
    source_snapshot_hash: sourceSnapshotHash,
    node_major: targetNodeMajor,
    node_runtime_sha256: nodeRuntime.sha256,
    source_revision: sourceIdentity.source_revision,
    source_tree: sourceIdentity.source_tree,
  }), 'utf8'));
  let priorRuntime = null;
  if (fs.existsSync(RUNTIME_MANIFEST_PATH)) {
    priorRuntime = JSON.parse(fs.readFileSync(RUNTIME_MANIFEST_PATH, 'utf8'));
    if (priorRuntime.build_id === release.build_id) {
      const canonical = entries => JSON.stringify((Array.isArray(entries) ? entries : []).map(entry => ({
        path: String(entry.path || '').replace(/\\/g, '/'), bytes: Number(entry.bytes || 0), sha256: String(entry.sha256 || ''),
      })).sort((a, b) => a.path.localeCompare(b.path)));
      if (canonical(priorRuntime.files) !== canonical(runtimeEntries)) {
        throw new Error(`禁止复用已发布 build_id ${release.build_id} 覆盖不同后端运行时代码；请先生成新的 build_id。`);
      }
    }
  }
  const runtimeManifest = {
    schema_version: 3,
    build_id: release.build_id,
    contract_version: release.contract_version,
    artifact_id: artifactId,
    source_snapshot_hash: sourceSnapshotHash,
    source_revision: sourceIdentity.source_revision,
    source_tree: sourceIdentity.source_tree,
    source_ref: sourceIdentity.source_ref,
    upstream_ref: sourceIdentity.upstream_ref,
    remote_sync_verified: sourceIdentity.remote_sync_verified,
    lockfile_sha256: lockfileSha256,
    node_version: nodeRuntime.version,
    node_runtime: nodeRuntime,
    generated_at: priorRuntime?.build_id === release.build_id
      ? priorRuntime.generated_at
      : new Date().toISOString(),
    files: runtimeEntries,
  };
  const publicTemp = `${MANIFEST_PATH}.${process.pid}.tmp`;
  const runtimeTemp = `${RUNTIME_MANIFEST_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(publicTemp, manifestBuffer);
  fs.writeFileSync(runtimeTemp, `${JSON.stringify(runtimeManifest, null, 2)}\n`, 'utf8');
  fs.renameSync(publicTemp, MANIFEST_PATH);
  fs.renameSync(runtimeTemp, RUNTIME_MANIFEST_PATH);
  console.log(JSON.stringify({
    success: true,
    build_id: release.build_id,
    files: files.length,
    runtime_files: runtimeEntries.length,
    source_revision: sourceIdentity.source_revision,
    source_ref: sourceIdentity.source_ref,
    upstream_ref: sourceIdentity.upstream_ref,
  }));
}

main();
