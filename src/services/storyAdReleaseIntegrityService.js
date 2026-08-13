const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

/** 固定发布清单的进程身份，区分“磁盘已更新、进程仍是旧代码”的短暂状态。 */
function manifestFingerprint(manifest = {}) {
  const files = (Array.isArray(manifest.files) ? manifest.files : []).map(entry => ({
    path: String(entry.path || '').replace(/\\/g, '/'),
    bytes: Number(entry.bytes || 0),
    sha256: String(entry.sha256 || ''),
  })).sort((a, b) => a.path.localeCompare(b.path));
  return sha256(Buffer.from(JSON.stringify({
    schema_version: Number(manifest.schema_version || 0),
    build_id: String(manifest.build_id || ''),
    contract_version: String(manifest.contract_version || ''),
    artifact_id: String(manifest.artifact_id || ''),
    source_snapshot_hash: String(manifest.source_snapshot_hash || ''),
    source_revision: String(manifest.source_revision || ''),
    source_tree: String(manifest.source_tree || ''),
    source_ref: String(manifest.source_ref || ''),
    upstream_ref: String(manifest.upstream_ref || ''),
    remote_sync_verified: manifest.remote_sync_verified === true,
    lockfile_sha256: String(manifest.lockfile_sha256 || ''),
    node_version: String(manifest.node_version || ''),
    files,
  }), 'utf8'));
}

function verify({ root = path.resolve(__dirname, '../..'), manifestPath = '', release = {} } = {}) {
  const target = manifestPath || path.join(root, 'public', 'story-ad', 'release-manifest.json');
  if (!fs.existsSync(target)) throw new Error(`Story-ad release manifest missing: ${target}`);
  const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
  const errors = [];
  if (manifest.build_id !== release.build_id) errors.push(`build_id ${manifest.build_id || 'missing'} != ${release.build_id || 'missing'}`);
  if (manifest.contract_version !== release.contract_version) errors.push(`contract_version ${manifest.contract_version || 'missing'} != ${release.contract_version || 'missing'}`);
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (!files.length) errors.push('manifest contains no files');
  files.forEach(entry => {
    const relative = String(entry.path || '').replace(/\\/g, '/');
    const absolute = path.resolve(root, relative);
    if (!relative.startsWith('public/story-ad/') || !absolute.startsWith(path.resolve(root, 'public', 'story-ad') + path.sep)) {
      errors.push(`unsafe path ${relative}`);
      return;
    }
    if (!fs.existsSync(absolute)) {
      errors.push(`missing ${relative}`);
      return;
    }
    const content = fs.readFileSync(absolute);
    if (content.length !== Number(entry.bytes) || sha256(content) !== entry.sha256) errors.push(`hash mismatch ${relative}`);
  });
  return { ok: errors.length === 0, errors, manifest, verified_files: files.length };
}

function assertCurrent(options = {}) {
  const result = verify(options);
  if (!result.ok) {
    const error = new Error(`Story-ad release integrity failed: ${result.errors.slice(0, 8).join('; ')}`);
    error.code = 'STORY_AD_RELEASE_INTEGRITY_FAILED';
    error.details = result.errors;
    throw error;
  }
  return result;
}

function verifyRuntime({ root = path.resolve(__dirname, '../..'), manifestPath = '', release = {} } = {}) {
  const target = manifestPath || path.join(root, 'config', 'story-ad-runtime-manifest.json');
  if (!fs.existsSync(target)) throw new Error(`Story-ad runtime manifest missing: ${target}`);
  const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
  const errors = [];
  if (manifest.build_id !== release.build_id) errors.push(`build_id ${manifest.build_id || 'missing'} != ${release.build_id || 'missing'}`);
  if (manifest.contract_version !== release.contract_version) errors.push(`contract_version ${manifest.contract_version || 'missing'} != ${release.contract_version || 'missing'}`);
  if (Number(manifest.schema_version || 0) >= 3) {
    if (!/^[a-f0-9]{40}$/.test(String(manifest.source_revision || ''))) errors.push('runtime manifest source_revision invalid');
    if (!/^[a-f0-9]{40}$/.test(String(manifest.source_tree || ''))) errors.push('runtime manifest source_tree invalid');
    if (!String(manifest.source_ref || '').trim()) errors.push('runtime manifest source_ref missing');
    if (!String(manifest.upstream_ref || '').trim()) errors.push('runtime manifest upstream_ref missing');
    if (manifest.remote_sync_verified !== true) errors.push('runtime manifest remote sync not verified');
  }
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (!files.length) errors.push('runtime manifest contains no files');
  const workspace = path.resolve(root);
  files.forEach(entry => {
    const relative = String(entry.path || '').replace(/\\/g, '/');
    const absolute = path.resolve(root, relative);
    if (!relative || absolute === workspace || !absolute.startsWith(workspace + path.sep)) {
      errors.push(`unsafe runtime path ${relative}`);
      return;
    }
    if (!fs.existsSync(absolute)) {
      errors.push(`missing ${relative}`);
      return;
    }
    const content = fs.readFileSync(absolute);
    if (content.length !== Number(entry.bytes) || sha256(content) !== entry.sha256) errors.push(`hash mismatch ${relative}`);
  });
  return { ok: errors.length === 0, errors, manifest, verified_files: files.length, runtime_hash: manifestFingerprint(manifest) };
}

function assertRuntimeCurrent(options = {}) {
  const result = verifyRuntime(options);
  if (!result.ok) {
    const error = new Error(`Story-ad runtime integrity failed: ${result.errors.slice(0, 8).join('; ')}`);
    error.code = 'STORY_AD_RUNTIME_INTEGRITY_FAILED';
    error.details = result.errors;
    throw error;
  }
  return result;
}

module.exports = { verify, assertCurrent, verifyRuntime, assertRuntimeCurrent, sha256, manifestFingerprint };
