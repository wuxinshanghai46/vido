'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function git(root, args) {
  const result = childProcess.spawnSync('git', args, {
    cwd: path.resolve(root),
    encoding: 'utf8',
    timeout: 15000,
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(`无法取得发布源码身份：git ${args.join(' ')}${detail ? `：${detail}` : ''}`);
  }
  return String(result.stdout || '').trim();
}

function normalizeRef(value = '') {
  return String(value || '').trim().replace(/^refs\/remotes\//, '');
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function trustedGeneratedPaths(root) {
  const targets = [
    path.join(root, 'config', 'story-ad-runtime-manifest.json'),
    path.join(root, 'public', 'story-ad', 'release-manifest.json'),
  ];
  const entries = targets.flatMap(target => {
    if (!fs.existsSync(target)) return [];
    try {
      const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
      return Array.isArray(manifest.files) ? manifest.files : [];
    } catch { return []; }
  });
  return new Set(entries.filter(entry => {
    const relative = String(entry.path || '').replace(/\\/g, '/');
    const absolute = path.resolve(root, relative);
    return relative && absolute.startsWith(path.resolve(root) + path.sep)
      && fs.existsSync(absolute)
      && sha256(absolute) === String(entry.sha256 || '');
  }).map(entry => String(entry.path || '').replace(/\\/g, '/')));
}

function resolveReleaseSourceIdentity({ root = path.resolve(__dirname, '../..'), requireRemoteSync = true } = {}) {
  const sourceRevision = git(root, ['rev-parse', 'HEAD']);
  const sourceTree = git(root, ['rev-parse', 'HEAD^{tree}']);
  // Compatible with older production Git versions; unlike rev-parse this also
  // fails closed when the repository is on a detached HEAD.
  const sourceRef = git(root, ['symbolic-ref', '--short', 'HEAD']);
  const dirty = git(root, [
    'status', '--porcelain', '--untracked-files=all', '--',
    'src', 'public', 'config', 'scripts', 'package.json', 'package-lock.json',
  ]);
  const trusted = trustedGeneratedPaths(root);
  // These manifests are deterministic build outputs and were historically
  // excluded by a newer Git pathspec. Filter them after status parsing so old
  // Git versions do not need to understand that syntax.
  const generatedManifests = new Set([
    'config/story-ad-runtime-manifest.json',
    'public/story-ad/release-manifest.json',
  ]);
  const dirtyLines = dirty ? dirty.split(/\r?\n/).filter(Boolean) : [];
  const unsafeDirty = dirtyLines.filter(line => {
    const match = line.match(/^\s?(?:[A-Z?!]{1,2})\s+(.+)$/);
    const relative = String(match?.[1] || line).replace(/^"|"$/g, '').replace(/\\/g, '/');
    return !generatedManifests.has(relative) && !trusted.has(relative);
  });
  if (unsafeDirty.length) {
    const files = unsafeDirty.slice(0, 12).join(', ');
    throw new Error(`发布构建必须来自已提交的干净源码；仍有未提交的运行代码或配置：${files}`);
  }
  if (!/^[a-f0-9]{40}$/.test(sourceRevision) || !/^[a-f0-9]{40}$/.test(sourceTree)) {
    throw new Error('发布源码提交或源码树身份无效');
  }
  if (!sourceRef) throw new Error('禁止从 detached HEAD 构建正式发布制品');

  let upstreamRef = '';
  try {
    upstreamRef = normalizeRef(git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']));
  } catch (error) {
    if (requireRemoteSync) throw new Error(`发布分支 ${sourceRef} 尚未设置远端跟踪，不能证明是远端最新代码`);
  }
  if (requireRemoteSync) {
    const upstreamRevision = git(root, ['rev-parse', upstreamRef]);
    if (upstreamRevision !== sourceRevision) {
      const counts = git(root, ['rev-list', '--left-right', '--count', `HEAD...${upstreamRef}`]);
      throw new Error(`发布源码不是远端最新提交：HEAD=${sourceRevision}，${upstreamRef}=${upstreamRevision}，ahead/behind=${counts}`);
    }
  }
  return {
    source_revision: sourceRevision,
    source_tree: sourceTree,
    source_ref: sourceRef,
    upstream_ref: upstreamRef,
    tracked_worktree_clean: true,
    remote_sync_verified: Boolean(requireRemoteSync && upstreamRef),
  };
}

module.exports = { git, normalizeRef, resolveReleaseSourceIdentity, trustedGeneratedPaths };
