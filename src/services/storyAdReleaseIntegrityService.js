const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

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

module.exports = { verify, assertCurrent, sha256 };
