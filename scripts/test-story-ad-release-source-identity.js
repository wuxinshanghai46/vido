'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sourceIdentity = require('./lib/releaseSourceIdentity');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-source-identity-'));
function git(args) {
  const result = childProcess.spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || '').trim();
}

try {
  git(['init', '-q']);
  git(['config', 'user.email', 'release-test@vido.invalid']);
  git(['config', 'user.name', 'VIDO Release Test']);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'module.exports = 1;\n');
  git(['add', 'src/app.js']);
  git(['commit', '-qm', 'fixture']);
  const local = sourceIdentity.resolveReleaseSourceIdentity({ root, requireRemoteSync: false });
  assert.match(local.source_revision, /^[a-f0-9]{40}$/);
  assert.match(local.source_tree, /^[a-f0-9]{40}$/);
  assert.strictEqual(local.tracked_worktree_clean, true);
  assert.strictEqual(local.remote_sync_verified, false);
  assert.throws(
    () => sourceIdentity.resolveReleaseSourceIdentity({ root, requireRemoteSync: true }),
    /尚未设置远端跟踪/,
  );
  fs.appendFileSync(path.join(root, 'src', 'app.js'), '// dirty\n');
  assert.throws(
    () => sourceIdentity.resolveReleaseSourceIdentity({ root, requireRemoteSync: false }),
    /必须来自已提交的干净源码/,
  );
  git(['checkout', '--', 'src/app.js']);
  fs.writeFileSync(path.join(root, 'src', 'untracked.js'), 'module.exports = true;\n');
  assert.throws(
    () => sourceIdentity.resolveReleaseSourceIdentity({ root, requireRemoteSync: false }),
    /必须来自已提交的干净源码/,
  );
  console.log(JSON.stringify({ passed: true, clean_commit_identified: true, dirty_tracked_blocked: true, untracked_runtime_blocked: true, missing_upstream_blocked: true }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
