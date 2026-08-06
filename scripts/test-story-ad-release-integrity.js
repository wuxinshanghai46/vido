const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const service = require('../src/services/storyAdReleaseIntegrityService');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-release-integrity-'));
try {
  const publicRoot = path.join(root, 'public', 'story-ad');
  fs.mkdirSync(publicRoot, { recursive: true });
  const filePath = path.join(publicRoot, 'app.js');
  fs.writeFileSync(filePath, 'export const ok = true;\n');
  const content = fs.readFileSync(filePath);
  const release = { build_id: '20260803-test-release', contract_version: 'director-scene-v1' };
  const manifest = {
    schema_version: 1,
    ...release,
    files: [{ path: 'public/story-ad/app.js', bytes: content.length, sha256: service.sha256(content) }],
  };
  const manifestPath = path.join(publicRoot, 'release-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const valid = service.verify({ root, manifestPath, release });
  assert.strictEqual(valid.ok, true);
  assert.strictEqual(valid.verified_files, 1);
  const runtimeHash = service.manifestFingerprint(manifest);
  assert.match(runtimeHash, /^[a-f0-9]{64}$/);
  assert.strictEqual(service.manifestFingerprint({ ...manifest, files: manifest.files.slice().reverse() }), runtimeHash);
  assert.notStrictEqual(service.manifestFingerprint({ ...manifest, build_id: '20260803-test-release-v2' }), runtimeHash);
  const runtimeManifestPath = path.join(root, 'config', 'story-ad-runtime-manifest.json');
  fs.mkdirSync(path.dirname(runtimeManifestPath), { recursive: true });
  fs.writeFileSync(runtimeManifestPath, JSON.stringify(manifest));
  const runtimeValid = service.verifyRuntime({ root, manifestPath: runtimeManifestPath, release });
  assert.strictEqual(runtimeValid.ok, true);
  assert.strictEqual(runtimeValid.runtime_hash, runtimeHash);
  assert.strictEqual(service.assertRuntimeCurrent({ root, manifestPath: runtimeManifestPath, release }).verified_files, 1);
  fs.appendFileSync(filePath, '// stale\n');
  const stale = service.verify({ root, manifestPath, release });
  assert.strictEqual(stale.ok, false);
  assert(stale.errors.some(error => error.includes('hash mismatch')));
  assert.throws(() => service.assertCurrent({ root, manifestPath, release }), error => error.code === 'STORY_AD_RELEASE_INTEGRITY_FAILED');
  assert.throws(() => service.assertRuntimeCurrent({ root, manifestPath: runtimeManifestPath, release }), error => error.code === 'STORY_AD_RUNTIME_INTEGRITY_FAILED');
  console.log(JSON.stringify({ passed: true, checks: 11, stale_release_blocked: true, stale_runtime_blocked: true, runtime_hash: runtimeHash }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
