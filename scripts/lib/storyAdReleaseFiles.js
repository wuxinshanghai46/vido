'use strict';

const fs = require('fs');
const path = require('path');

const BASE_FILES = [
  '.gitattributes',
  'config/story-ad-release.json',
  'package.json',
  'package-lock.json',
  'public/index.html',
  'public/js/dashboard-workbench.js',
  'public/js/admin-vue-knowledgebase.js',
  'src/server.js',
  'src/routes/admin.js',
  'src/routes/dashboard.js',
  'src/routes/newStoryAd.js',
  'src/routes/storyAdWorkspace.js',
  'scripts/build-story-ad-release.js',
  'scripts/lib/releaseSourceIdentity.js',
  'scripts/audit-new-story-ad-systemic-state.js',
  'scripts/audit-new-story-ad-systemic-state-remote.js',
  'scripts/migrate-new-story-ad-systemic-state.js',
  'scripts/test-new-story-ad-systemic-state-audit.js',
  'scripts/test-new-story-ad-work-aggregate.js',
  'scripts/test-new-story-ad-permanent-identity-dependency.js',
  'scripts/validate-new-story-ad-golden-project.js',
  'scripts/run-new-story-ad-golden-real-text.js',
  'scripts/test-new-story-ad-systemic-migration.js',
  'scripts/test-new-story-ad-systemic-remote-audit.js',
  'scripts/test-story-ad-workspace-v6-ui-regressions.js',
  'scripts/test-story-ad-person-plan-unified-generation-v179.js',
  'scripts/test-story-ad-dialogue-intake-v100.js',
  'scripts/test-story-ad-dialogue-assist-v107.js',
  'scripts/test-story-ad-background-performer-flow-v212.js',
  'scripts/test-video-canvas-worker-lifecycle.js',
  'scripts/test-story-ad-platform-responsive-v108.js',
  'scripts/test-story-ad-brief-modal-auto-blueprint-v103.js',
  'scripts/test-story-ad-lightweight-bundle-v100.js',
  'scripts/test-story-ad-platform-narrative-release-v111.js',
  'scripts/check-story-ad-workspace-v6-boundaries.js',
  'scripts/test-story-ad-release-source-identity.js',
  'scripts/run-with-pm2-env.js',
  'scripts/test-story-ad-pm2-env-sanitization-v104.js',
  'scripts/check-new-story-ad-active-tasks.js',
  'scripts/deploy-story-ad-release.js',
  'scripts/deploy-story-ad-immutable-release.js',
  'scripts/run-story-ad-release-gates.js',
  'scripts/manage-story-ad-release-control.js',
  'scripts/migrate-story-ad-platform-v111.js',
  'scripts/migrate-story-ad-v120-checkpoints.js',
  'scripts/migrate-new-story-ad-assist-route-v127.js',
  'scripts/configure-story-ad-independent-text-routes.js',
  'scripts/configure-story-ad-webang-content-routing-v204.js',
  'scripts/configure-story-ad-reference-vision-routing-v205.js',
  'scripts/test-story-ad-reference-vision-routing-v205.js',
  'scripts/configure-story-ad-consistency-vision-routing-v240.js',
  'scripts/test-story-ad-consistency-vision-routing-v240.js',
  'scripts/test-story-ad-vision-schema-fallback-v240.js',
  'scripts/configure-story-ad-szznai-routing-v243.js',
  'scripts/test-story-ad-szznai-routing-v243.js',
  'scripts/test-story-ad-scene-submit-feedback-v273.js',
  'scripts/test-story-ad-scene-auto-qa-repair-v274.js',
  'scripts/test-story-ad-new-contract-redline-v275.js',
  'scripts/migrate-story-ad-era-identities-v170.js',
  'scripts/migrate-story-ad-person-count-contract-v174.js',
  'scripts/migrate-story-ad-person-demographics-v63.js',
  'scripts/test-story-ad-history-edit-entry-final-dom-v63.js',
  'scripts/test-story-ad-product-entry-taxonomy-v64.js',
  'scripts/test-story-ad-visual-checkpoint-plan-stability-v65.js',
  'scripts/test-story-ad-visual-generation-lineage-v65.js',
  'scripts/test-story-ad-candidate-systemic-readiness-v66.js',
  'scripts/test-story-ad-person-asset-interactions-v68.js',
  'scripts/test-story-ad-recovery-status-hierarchy-v70.js',
  'scripts/test-story-ad-recovery-card-visual-v72.js',
  'scripts/test-story-ad-recovery-action-computed-style-v73.js',
  'scripts/test-story-ad-recovery-metric-layout-v74.js',
  'scripts/test-story-ad-billing-recovery-next-step-v75.js',
  'scripts/test-story-ad-billing-review-state-machine-v75.js',
  'scripts/test-story-ad-billing-recovery-atomic-v75.js',
  'scripts/test-story-ad-submission-billing-classification-v75.js',
  'scripts/test-story-ad-accessory-slot-contract-v75.js',
  'scripts/test-story-ad-asset-url-readiness-v75.js',
  'scripts/test-story-ad-billing-recovery-routes-v76.js',
  'scripts/test-story-ad-asset-center-mount-dependencies-v77.js',
  'scripts/test-story-ad-desired-unit-reconciliation-v78.js',
  'scripts/test-story-ad-desired-unit-obsolescence-v78.js',
  'scripts/reconcile-story-ad-desired-visual-units-v78.js',
  'public/story-ad/views/assetCenterStageView.js',
  'public/story-ad/views/subjectRecoveryPreflightAction.js',
  'src/services/newStoryAd/negativeConstraintContractService.js',
  'src/services/newStoryAd/subjectRecoveryPreflightService.js',
  'src/services/newStoryAd/subjectProfileAuthorityProofService.js',
  'scripts/test-story-ad-single-stage-primary-action-v79.js',
  'scripts/test-story-ad-recovery-plan-action-final-dom-v79.js',
  'scripts/test-story-ad-partial-checkpoint-negative-rebase-v79.js',
  'scripts/test-story-ad-negative-constraint-semantics-v81.js',
  'scripts/test-story-ad-negative-constraint-production-v81.js',
  'scripts/test-story-ad-subject-recovery-preflight-v81.js',
  'scripts/test-story-ad-three-way-authority-proof-v84.js',
  'scripts/test-story-ad-three-way-authority-proof-independent-v84.js',
  'scripts/test-story-ad-three-way-authority-rebase-independent-v84.js',
  'scripts/resolve-story-ad-visual-billing-review-v75.js',
  'scripts/audit-story-ad-visual-generation-lineage-v65.js',
  'scripts/audit-story-ad-checkpoint-billing-correlation-v65.js',
  'scripts/repair-story-ad-visual-generation-lineage-v65.js',
  'scripts/test-story-ad-person-plan-demographics-v63.js',
  'scripts/test-story-ad-person-demographics-migration-v63.js',
  'scripts/test-story-ad-v120-checkpoint-migration-v121.js',
  'scripts/audit-story-ad-model-management.js',
  'scripts/test-story-ad-platform-v111-real-model-contract.js',
  'scripts/story-ad-pm2-release.js',
  'scripts/repair-new-story-ad-person-looks.js',
  'scripts/repair-story-ad-reference-authority.js',
  'scripts/migrate-story-ad-active-plan-release.js',
  'scripts/migrate-story-ad-public-media-models-v262.js',
  'scripts/lib/storyAdReleaseFiles.js',
  'scripts/run-with-pm2-env.js',
];

const RUNTIME_DIRECTORIES = [
  // A production process must run from one complete application closure. The
  // former story-ad-only list allowed shared routes, dynamic modules and global
  // browser dependencies to remain on an older release.
  'src',
  'public',
  'config',
];
const REMOTE_TEST_SCRIPTS = [
  'story-ad:knowledge-policy:test',
  'story-ad:v100:test',
  'story-ad:v101:test',
  'story-ad:v102:test',
  'story-ad:release:test',
  'story-ad:systemic:test',
  'story-ad:v3:boundaries',
  'story-ad:v6:boundaries',
];
const OPAQUE_RELEASE_ROOTS = new Set();
const NON_RUNTIME_PATHS = [
  /^src\/outputs(?:\/|$)/i,
  /(?:^|\/)recovery-backups(?:\/|$)/i,
  /^public\/dashboard-clean-demo\.html?$/i,
  // Defense in depth: the retired source is physically absent and this pattern
  // prevents a stale working copy from re-entering an immutable release.
  /^public\/js\/new-story-ad-legacy-ui\.js$/i,
];

function isRuntimeReleaseFile(file = '') {
  const normalized = String(file || '').replace(/\\/g, '/');
  return Boolean(normalized) && !NON_RUNTIME_PATHS.some(pattern => pattern.test(normalized));
}

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
  const runtimeExtensions = /\.(?:js|mjs|cjs|json|html?|css|svg|png|jpe?g|webp|gif|ico|otf|ttf|woff2?)$/i;
  const runtimeFiles = RUNTIME_DIRECTORIES.flatMap(directory => walk(workspace, directory))
    .filter(file => runtimeExtensions.test(file) && isRuntimeReleaseFile(file));
  const testFiles = packageTestFiles(workspace);
  const initial = [...new Set([...BASE_FILES, ...publicFiles, ...runtimeFiles, ...testFiles])];
  const closed = dependencyClosure(workspace, initial);
  const missing = [...closed].filter(file => !fs.existsSync(path.join(workspace, file)));
  if (missing.length) throw new Error(`Release closure references missing files: ${missing.slice(0, 20).join(', ')}`);
  return [...closed].sort();
}

module.exports = {
  BASE_FILES,
  RUNTIME_DIRECTORIES,
  REMOTE_TEST_SCRIPTS,
  OPAQUE_RELEASE_ROOTS,
  NON_RUNTIME_PATHS,
  collectStoryAdReleaseFiles,
  dependencyClosure,
  isRuntimeReleaseFile,
  packageTestFiles,
  resolveLocalModule,
};
