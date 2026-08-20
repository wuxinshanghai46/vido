'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONTRACT_VERSION = 'story-ad-release-gates-v2';
const CACHE_DIRECTORY = path.join('.runtime', 'story-ad-release-gates');

const GATES = Object.freeze({
  release_core: {
    command: 'npm run story-ad:release:test',
    label: '发布完整性、传输、闭包与黄金合同',
  },
  workspace_ui: {
    command: 'node scripts/test-story-ad-workspace-v6-ui-regressions.js && node scripts/test-story-ad-dialogue-intake-v100.js && node scripts/test-story-ad-lightweight-bundle-v100.js && node scripts/check-story-ad-workspace-v6-boundaries.js',
    label: '工作台 UI、对话立项、首屏轻量投影与模块边界',
  },
  reference: {
    command: 'npm run story-ad:reference-understanding:test && npm run story-ad:reference-sync:test',
    label: '参考分析、确认与同步',
  },
  asset_plan: {
    command: 'npm run story-ad:active-plan-release:test && npm run story-ad:platform:section-recovery:test && node scripts/test-story-ad-production-planning-upgrade.js',
    label: '资产方案、分域恢复与生产规划',
  },
  upload_media: {
    command: 'node scripts/test-story-ad-workspace-reference-intake.js && node scripts/test-new-story-ad-reference-video-analysis.js && node scripts/test-new-story-ad-visual-asset-failure-recovery.js',
    label: '上传、参考媒体与失败恢复',
  },
  systemic: {
    command: 'npm run story-ad:systemic:test',
    label: '任务权威、持久化、计费与系统迁移',
  },
  narrative_v111: {
    command: 'node scripts/test-story-ad-platform-narrative-release-v111.js',
    label: '跨版本剧情固定种子与并发恢复',
  },
  platform_full: {
    command: 'npm run story-ad:v111:test && npm run platform:upgrade:test',
    label: '非家庭环境全平台与跨版本回归',
  },
});

const DOMAIN_RULES = [
  {
    domain: 'release_infrastructure',
    risk: 'full',
    patterns: [
      /^config\/story-ad-release\.json$/,
      /^package(?:-lock)?\.json$/,
      /^scripts\/(?:build|deploy)-story-ad-/,
      /^scripts\/story-ad-pm2-release\.js$/,
      /^scripts\/lib\/(?:storyAdReleaseFiles|releaseSourceIdentity|immutableDeployOptions|storyAdReleaseGatePlanner)\.js$/,
      /^src\/services\/storyAdRelease(?:Bundle|Integrity)Service\.js$/,
    ],
  },
  {
    domain: 'systemic_safety',
    risk: 'systemic',
    patterns: [
      /^src\/server\.js$/,
      /(?:storage|database|sqlite|migration|billing|generation|modelGateway|jobService|concurrency|releaseControl)/i,
      /^scripts\/(?:migrate|audit)-new-story-ad-systemic/,
    ],
  },
  {
    domain: 'reference',
    risk: 'reference',
    patterns: [/reference/i, /storyAdWorkspace\/authoritativeReference/i],
  },
  {
    domain: 'upload_media',
    risk: 'upload_media',
    patterns: [/(?:upload|multipart|mediaAdapter|mediaCatalog|fileStorage|videoAnalysis)/i],
  },
  {
    domain: 'asset_plan',
    risk: 'asset_plan',
    patterns: [/(?:assetPlan|PlanningDetails|PlanRelease|PlanMigration|scenePlanStatus)/i],
  },
  {
    domain: 'workspace_ui',
    risk: 'ui',
    patterns: [/^public\/story-ad\//, /^src\/routes\/storyAdWorkspace\.js$/],
  },
];

function normalizeFile(file = '') { return String(file || '').replace(/\\/g, '/').replace(/^\.\//, ''); }
function unique(values = []) { return [...new Set(values)]; }
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

function git(root, args = []) {
  return childProcess.execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}

function resolveArtifactRevision(root, artifactId = '', targetRevision = '') {
  if (!/^[a-f0-9]{64}$/i.test(String(artifactId || ''))) return '';
  try {
    const commits = git(root, ['log', '--all', '--format=%H', '--', 'config/story-ad-runtime-manifest.json'])
      .split(/\r?\n/).filter(value => /^[a-f0-9]{40}$/i.test(value)).slice(0, 200);
    for (const commit of commits) {
      let manifest;
      try { manifest = JSON.parse(git(root, ['show', `${commit}:config/story-ad-runtime-manifest.json`])); } catch { continue; }
      if (String(manifest.artifact_id || '') !== String(artifactId)) continue;
      if (/^[a-f0-9]{40}$/i.test(String(targetRevision || ''))) {
        try {
          childProcess.execFileSync('git', ['merge-base', '--is-ancestor', commit, targetRevision], {
            cwd: root, stdio: 'ignore', windowsHide: true,
          });
        } catch { continue; }
      }
      return commit;
    }
  } catch {}
  return '';
}

function changedFiles(root, baseRevision, targetRevision) {
  if (!/^[a-f0-9]{40}$/i.test(String(baseRevision || '')) || !/^[a-f0-9]{40}$/i.test(String(targetRevision || ''))) {
    return { files: [], reliable: false, reason: 'revision_missing' };
  }
  try {
    git(root, ['cat-file', '-e', `${baseRevision}^{commit}`]);
    git(root, ['cat-file', '-e', `${targetRevision}^{commit}`]);
    childProcess.execFileSync('git', ['merge-base', '--is-ancestor', baseRevision, targetRevision], {
      cwd: root, stdio: 'ignore', windowsHide: true,
    });
    const files = git(root, ['diff', '--name-only', '--diff-filter=ACMRTUXB', baseRevision, targetRevision])
      .split(/\r?\n/).map(normalizeFile).filter(Boolean);
    return { files: unique(files), reliable: true, reason: files.length ? 'production_delta' : 'same_source_revision' };
  } catch (error) {
    return { files: [], reliable: false, reason: 'git_history_unavailable', error: String(error.message || error) };
  }
}

function releaseConfigChangeKind(before = {}, after = {}) {
  const stripBuildId = value => {
    const copy = canonicalJson(value);
    if (copy && typeof copy === 'object' && !Array.isArray(copy)) delete copy.build_id;
    return copy;
  };
  if (JSON.stringify(canonicalJson(before)) === JSON.stringify(canonicalJson(after))) return 'unchanged';
  return JSON.stringify(stripBuildId(before)) === JSON.stringify(stripBuildId(after))
    ? 'build_id_only'
    : 'runtime_contract';
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalJson(value[key]);
    return result;
  }, {});
}

function releaseConfigDelta(root, baseRevision, targetRevision) {
  try {
    const before = JSON.parse(git(root, ['show', `${baseRevision}:config/story-ad-release.json`]));
    const after = JSON.parse(git(root, ['show', `${targetRevision}:config/story-ad-release.json`]));
    return releaseConfigChangeKind(before, after);
  } catch {
    return 'unverified';
  }
}

function classifyFiles(files = [], { reliable = true } = {}) {
  const normalized = unique(files.map(normalizeFile).filter(Boolean));
  if (!reliable) return {
    profile: 'full', domains: ['unknown'], unknown_files: normalized, reasons: ['影响范围无法可靠计算，自动执行完整门禁'],
  };
  const domains = new Set();
  const risks = new Set();
  const unknownFiles = [];
  for (const file of normalized) {
    if (/^(?:docs\/|README(?:\.|$)|\.github\/|\.gitee\/)/i.test(file)) continue;
    const matches = DOMAIN_RULES.filter(rule => rule.patterns.some(pattern => pattern.test(file)));
    if (!matches.length) {
      unknownFiles.push(file);
      continue;
    }
    matches.forEach(match => { domains.add(match.domain); risks.add(match.risk); });
  }
  if (unknownFiles.length || risks.has('full')) return {
    profile: 'full', domains: unique([...domains, ...(unknownFiles.length ? ['unknown'] : [])]), unknown_files: unknownFiles,
    reasons: [unknownFiles.length ? '存在未分类运行文件，自动执行完整门禁' : '发布基础设施变更，执行完整门禁'],
  };
  if (risks.has('systemic')) return {
    profile: 'systemic', domains: [...domains], unknown_files: [], reasons: ['涉及持久化、计费、任务或生成安全'],
  };
  if (risks.has('upload_media')) return {
    profile: 'upload_media', domains: [...domains], unknown_files: [], reasons: ['涉及上传或媒体处理链路'],
  };
  if (risks.has('reference') && risks.has('asset_plan')) return {
    profile: 'reference_asset_plan', domains: [...domains], unknown_files: [], reasons: ['同时涉及参考权威与资产方案'],
  };
  if (risks.has('reference')) return { profile: 'reference', domains: [...domains], unknown_files: [], reasons: ['参考权威链路变更'] };
  if (risks.has('asset_plan')) return { profile: 'asset_plan', domains: [...domains], unknown_files: [], reasons: ['资产方案链路变更'] };
  return { profile: 'ui', domains: [...domains], unknown_files: [], reasons: ['仅涉及已分类工作台展示或交互'] };
}

function gateIdsForProfile(profile = 'full', { fullPlatform = false } = {}) {
  const profiles = {
    release_metadata: ['release_core'],
    ui: ['workspace_ui', 'release_core'],
    reference: ['reference', 'workspace_ui', 'release_core'],
    asset_plan: ['asset_plan', 'workspace_ui', 'release_core'],
    reference_asset_plan: ['reference', 'asset_plan', 'workspace_ui', 'release_core'],
    upload_media: ['upload_media', 'reference', 'workspace_ui', 'release_core'],
    systemic: ['systemic', 'workspace_ui', 'narrative_v111', 'release_core'],
    full: ['systemic', 'workspace_ui', 'narrative_v111', 'release_core'],
  };
  if (profile === 'full' && fullPlatform) return ['systemic', 'platform_full', 'release_core'];
  return profiles[profile] || profiles.full;
}

function createPlan({
  root, baseRevision = '', baseArtifactId = '', targetRevision = '', sourceTree = '', files, reliable, fullPlatform = false,
} = {}) {
  const artifactRevision = Array.isArray(files) ? '' : resolveArtifactRevision(root, baseArtifactId, targetRevision);
  const effectiveBaseRevision = artifactRevision || baseRevision;
  const delta = Array.isArray(files)
    ? { files: files.map(normalizeFile), reliable: reliable !== false, reason: 'provided' }
    : changedFiles(root, effectiveBaseRevision, targetRevision);
  const metadataFiles = [];
  let runtimeFiles = delta.files;
  if (!Array.isArray(files) && delta.reliable && delta.files.includes('config/story-ad-release.json')) {
    const kind = releaseConfigDelta(root, effectiveBaseRevision, targetRevision);
    if (kind === 'build_id_only') {
      metadataFiles.push('config/story-ad-release.json');
      runtimeFiles = delta.files.filter(file => file !== 'config/story-ad-release.json');
    }
  }
  const classification = runtimeFiles.length
    ? classifyFiles(runtimeFiles, { reliable: delta.reliable })
    : (metadataFiles.length
      ? { profile: 'release_metadata', domains: ['release_metadata'], unknown_files: [], reasons: ['仅发布编号变化，执行发布完整性门禁'] }
      : classifyFiles(runtimeFiles, { reliable: delta.reliable }));
  const gateIds = gateIdsForProfile(classification.profile, { fullPlatform });
  return {
    contract_version: CONTRACT_VERSION,
    profile: classification.profile,
    domains: classification.domains,
    reasons: classification.reasons,
    unknown_files: classification.unknown_files,
    changed_files: delta.files,
    runtime_changed_files: runtimeFiles,
    metadata_files: metadataFiles,
    delta_reliable: delta.reliable,
    delta_reason: delta.reason,
    base_revision: effectiveBaseRevision,
    base_source_revision: baseRevision,
    base_artifact_id: baseArtifactId,
    artifact_revision_resolved: Boolean(artifactRevision),
    target_revision: targetRevision,
    source_tree: sourceTree,
    full_platform: fullPlatform === true,
    gates: gateIds.map(id => ({ id, ...GATES[id] })),
  };
}

function cachePath(root, plan, gate) {
  const identity = sha256(JSON.stringify({
    contract: CONTRACT_VERSION,
    source_tree: plan.source_tree,
    target_revision: plan.target_revision,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    id: gate.id,
    command: gate.command,
  }));
  return path.join(root, CACHE_DIRECTORY, `${identity}.json`);
}

function readGateCache(root, plan, gate) {
  if (process.env.VIDO_RELEASE_GATE_CACHE === '0' || !plan.source_tree) return null;
  const file = cachePath(root, plan, gate);
  try {
    const row = JSON.parse(fs.readFileSync(file, 'utf8'));
    return row?.passed === true && row?.contract_version === CONTRACT_VERSION ? row : null;
  } catch { return null; }
}

function saveGateCache(root, plan, gate, details = {}) {
  const file = cachePath(root, plan, gate);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({
    contract_version: CONTRACT_VERSION,
    passed: true,
    gate_id: gate.id,
    command: gate.command,
    profile: plan.profile,
    source_tree: plan.source_tree,
    target_revision: plan.target_revision,
    node_version: process.version,
    completed_at: new Date().toISOString(),
    ...details,
  }, null, 2)}\n`, 'utf8');
  return file;
}

function shellCommand(command) {
  return process.platform === 'win32'
    ? { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] }
    : { file: '/bin/sh', args: ['-lc', command] };
}

function executeGate(root, gate, { outputDir, timeoutMs = 45 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    const shell = shellCommand(gate.command);
    const child = childProcess.spawn(shell.file, shell.args, {
      cwd: root,
      env: { ...process.env, OUTPUT_DIR: outputDir, DB_ENABLED: '0', DB_READ_PRIMARY: '0', DB_DUAL_WRITE: '0', DB_JSON_FALLBACK: '1' },
      stdio: 'inherit', windowsHide: true,
    });
    const heartbeat = setInterval(() => {
      console.log(`RELEASE_GATE_PROGRESS=${JSON.stringify({ gate: gate.id, elapsed_seconds: Math.round((Date.now() - startedAt) / 1000) })}`);
    }, 30 * 1000);
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      clearInterval(heartbeat);
      reject(new Error(`发布门禁 ${gate.id} 超过 ${Math.round(timeoutMs / 1000)} 秒`));
    }, timeoutMs);
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', code => {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      if (code === 0) resolve({ duration_ms: Date.now() - startedAt });
      else reject(new Error(`发布门禁 ${gate.id} 失败，退出码 ${code}`));
    });
  });
}

async function runPlan(root, plan, options = {}) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-release-gates-'));
  const results = [];
  try {
    console.log(`RELEASE_GATE_PLAN=${JSON.stringify({ profile: plan.profile, domains: plan.domains, changed_files: plan.changed_files.length, gates: plan.gates.map(gate => gate.id), reasons: plan.reasons })}`);
    for (let index = 0; index < plan.gates.length; index += 1) {
      const gate = plan.gates[index];
      const cached = readGateCache(root, plan, gate);
      if (cached) {
        const result = { gate: gate.id, status: 'cached', duration_ms: 0, cached_at: cached.completed_at };
        results.push(result);
        console.log(`RELEASE_GATE_RESULT=${JSON.stringify({ index: index + 1, total: plan.gates.length, ...result })}`);
        continue;
      }
      console.log(`RELEASE_GATE_START=${JSON.stringify({ index: index + 1, total: plan.gates.length, gate: gate.id, label: gate.label })}`);
      const executed = await (options.executeGate || executeGate)(root, gate, { ...options, outputDir });
      saveGateCache(root, plan, gate, executed);
      const result = { gate: gate.id, status: 'passed', ...executed };
      results.push(result);
      console.log(`RELEASE_GATE_RESULT=${JSON.stringify({ index: index + 1, total: plan.gates.length, ...result })}`);
    }
    return { passed: true, profile: plan.profile, results, cached_count: results.filter(row => row.status === 'cached').length };
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

module.exports = {
  CACHE_DIRECTORY,
  CONTRACT_VERSION,
  DOMAIN_RULES,
  GATES,
  cachePath,
  changedFiles,
  classifyFiles,
  createPlan,
  executeGate,
  gateIdsForProfile,
  readGateCache,
  releaseConfigChangeKind,
  releaseConfigDelta,
  resolveArtifactRevision,
  runPlan,
  saveGateCache,
};
