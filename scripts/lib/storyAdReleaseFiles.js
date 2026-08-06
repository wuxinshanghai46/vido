'use strict';

const fs = require('fs');
const path = require('path');

const BASE_FILES = [
  'config/story-ad-release.json',
  'config/story-ad-runtime-manifest.json',
  'package.json',
  'package-lock.json',
  'public/story-ad/release-manifest.json',
  'public/js/admin-vue-knowledgebase.js',
  'src/server.js',
  'src/routes/admin.js',
  'src/routes/newStoryAd.js',
  'src/routes/storyAdWorkspace.js',
  'scripts/build-story-ad-release.js',
  'scripts/check-new-story-ad-active-tasks.js',
  'scripts/deploy-story-ad-release.js',
  'scripts/lib/storyAdReleaseFiles.js',
  'scripts/run-with-pm2-env.js',
];

const RUNTIME_DIRECTORIES = [
  'src/routes/newStoryAd',
  'src/services/newStoryAd',
  'src/services/storyAdWorkspace',
  'src/services/videoGenerationCore',
  'src/services/seeds',
];
const REMOTE_TEST_SCRIPTS = [
  'story-ad:knowledge-policy:test',
  'story-ad:release:test',
  'story-ad:v3:boundaries',
  'story-ad:v6:boundaries',
];
const OPAQUE_RELEASE_ROOTS = new Set(['src/server.js', 'src/routes/admin.js']);

function relative(root, file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function walk(root, directory) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(absolute, entry.name);
    return entry.isDirectory() ? walk(root, relative(root, target)) : [relative(root, target)];
  });
}

function packageTestFiles(root, entries = REMOTE_TEST_SCRIPTS) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const scripts = packageJson.scripts || {};
  const visited = new Set();
  const files = new Set();
  function visit(name) {
    if (!name || visited.has(name)) return;
    visited.add(name);
    if (scripts[`pre${name}`]) visit(`pre${name}`);
    const command = String(scripts[name] || '');
    for (const match of command.matchAll(/(?:npm\s+run\s+|npm\s+test\s+--\s+)([\w:-]+)/g)) visit(match[1]);
    for (const match of command.matchAll(/(?:^|&&|;)\s*node\s+([^\s;&]+\.js)\b/g)) {
      files.add(String(match[1]).replace(/^['"]|['"]$/g, '').replace(/\\/g, '/'));
    }
    if (scripts[`post${name}`]) visit(`post${name}`);
  }
  (Array.isArray(entries) ? entries : [entries]).forEach(visit);
  return [...files];
}

function resolveLocalModule(root, fromFile, request) {
  if (!String(request || '').startsWith('.')) return '';
  const candidate = path.resolve(path.dirname(path.join(root, fromFile)), request);
  const choices = [candidate, `${candidate}.js`, `${candidate}.json`, path.join(candidate, 'index.js')];
  const resolved = choices.find(file => fs.existsSync(file) && fs.statSync(file).isFile());
  if (!resolved || !resolved.startsWith(path.resolve(root) + path.sep)) return '';
  return relative(root, resolved);
}

function dependencyClosure(root, initialFiles) {
  const selected = new Set(initialFiles);
  const queue = [...selected];
  while (queue.length) {
    const file = queue.shift();
    if (!file.endsWith('.js')) continue;
    if (OPAQUE_RELEASE_ROOTS.has(file)) continue;
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) continue;
    const source = fs.readFileSync(absolute, 'utf8');
    const requests = [
      ...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g),
      ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map(match => match[1]);
    for (const request of requests) {
      const resolved = resolveLocalModule(root, file, request);
      if (!resolved || selected.has(resolved)) continue;
      selected.add(resolved);
      queue.push(resolved);
    }
  }
  return selected;
}

function collectStoryAdReleaseFiles({ root, releaseManifest } = {}) {
  const workspace = path.resolve(root || path.join(__dirname, '../..'));
  const manifest = releaseManifest || require(path.join(workspace, 'public/story-ad/release-manifest.json'));
  const publicFiles = (Array.isArray(manifest.files) ? manifest.files : []).map(item => item.path);
  const runtimeFiles = RUNTIME_DIRECTORIES.flatMap(directory => walk(workspace, directory))
    .filter(file => /\.(?:js|json)$/i.test(file));
  const testFiles = packageTestFiles(workspace);
  const initial = [...new Set([...BASE_FILES, ...publicFiles, ...runtimeFiles, ...testFiles])];
  const closed = dependencyClosure(workspace, initial);
  return [...closed].filter(file => fs.existsSync(path.join(workspace, file))).sort();
}

module.exports = {
  BASE_FILES,
  RUNTIME_DIRECTORIES,
  REMOTE_TEST_SCRIPTS,
  collectStoryAdReleaseFiles,
  dependencyClosure,
  packageTestFiles,
  resolveLocalModule,
};
