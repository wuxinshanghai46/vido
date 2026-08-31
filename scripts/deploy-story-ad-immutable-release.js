#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');
const { collectStoryAdReleaseFiles } = require('./lib/storyAdReleaseFiles');
const releaseGatePlanner = require('./lib/storyAdReleaseGatePlanner');
const deployRecovery = require('./lib/immutableDeployRecovery');
const deployOptions = require('./lib/immutableDeployOptions');
const integrity = require('../src/services/storyAdReleaseIntegrityService');
const releaseBundle = require('../src/services/storyAdReleaseBundleService');

const root = path.resolve(__dirname, '..');
const release = require('../config/story-ad-release.json');
const publicManifest = require('../public/story-ad/release-manifest.json');
const runtimeManifest = require('../config/story-ad-runtime-manifest.json');
const artifactId = String(runtimeManifest.artifact_id || '');
const releaseBundleId = releaseBundle.identity().bundle_id;
if (!/^[a-f0-9]{64}$/.test(artifactId)) throw new Error('发布清单缺少有效 artifact_id，请先执行 story-ad:release:build');
if (Number(runtimeManifest.schema_version || 0) < 3
  || !/^[a-f0-9]{40}$/.test(String(runtimeManifest.source_revision || ''))
  || !/^[a-f0-9]{40}$/.test(String(runtimeManifest.source_tree || ''))
  || runtimeManifest.remote_sync_verified !== true) {
  throw new Error('发布清单缺少已同步远端的源码提交身份，拒绝部署无法证明的新旧代码');
}
const nodeRuntime = runtimeManifest.node_runtime || {};
if (!/^v\d+\.\d+\.\d+$/.test(String(nodeRuntime.version || ''))
  || !/^[a-z0-9._-]+$/i.test(String(nodeRuntime.platform || ''))
  || !/^https:\/\//.test(String(nodeRuntime.url || ''))
  || !/^[a-f0-9]{64}$/.test(String(nodeRuntime.sha256 || ''))) throw new Error('运行清单缺少固定 Node runtime 身份');
const releaseDir = `/opt/vido/releases/${artifactId}`;
const dependencyId = `${String(runtimeManifest.lockfile_sha256 || '').slice(0, 32)}-node${Number(String(runtimeManifest.node_version || process.version).replace(/^v/, '').split('.')[0])}`;
const dependencyDir = `/opt/vido/dependencies/${dependencyId}`;
const nodeRuntimeDir = `/opt/vido/runtimes/node-${nodeRuntime.version}-${nodeRuntime.platform}`;
const nodeRuntimeBin = `${nodeRuntimeDir}/bin/node`;
const stagingDir = `/opt/vido/releases/.staging-${artifactId}-${process.pid}`;
const currentLink = '/opt/vido/current';
const lockDir = `/opt/vido/deploy-locks/story-ad-${artifactId}`;
const systemicBackupDir = `/opt/vido/backups/story-ad-systemic-${artifactId}`;
const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const port = Number(process.env.VIDO_DEPLOY_PORT || 2222);
const username = process.env.VIDO_DEPLOY_USER || 'root';
const files = collectStoryAdReleaseFiles({ root, releaseManifest: publicManifest });
const uploadConcurrency = Math.max(1, Math.min(8, Number(
  process.env.VIDO_IMMUTABLE_UPLOAD_CONCURRENCY || process.env.VIDO_DEPLOY_UPLOAD_CONCURRENCY,
) || 3));
deployOptions.assertKnownDeployArgs();
const candidateOnly = deployOptions.candidateOnlyRequested();
const baseReleaseDir = String(process.env.VIDO_IMMUTABLE_BASE_RELEASE || '').trim();
if (baseReleaseDir && !/^\/opt\/vido\/releases\/[a-f0-9]{64}$/.test(baseReleaseDir)) {
  throw new Error('VIDO_IMMUTABLE_BASE_RELEASE must identify an immutable release directory');
}
const client = new Client();
const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
const candidateName = `vido-candidate-${artifactId.slice(0, 12)}`;
let previousTarget = '/opt/vido/app';
let effectiveBaseReleaseDir = baseReleaseDir;
let previousBundleId = '';
let previousBuildId = '';
let previousContractVersion = '';
let previousMigrationSetId = '';
let previousNodeRuntimeBin = '';
let cutoverStarted = false;
let releaseControlDrained = false;
let legacyProcessFrozen = false;
let releaseMigrationMode = 'none';
let releaseMigrationApplied = false;
let assistRouteMigrationApplied = false;
let systemicBackupCreated = false;
let systemicMigrationApplied = false;

integrity.assertCurrent({ root, release });
integrity.assertRuntimeCurrent({ root, release });
const localHashes = Object.fromEntries(files.map(file => [
  file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
]));
const auditSpec = Buffer.from(JSON.stringify({ files, hashes: localHashes }), 'utf8');
const remoteAuditSpecPath = `${lockDir}/release-audit.json`;

function reportPhase(phase, details = {}) {
  console.log(`IMMUTABLE_RELEASE_PHASE=${JSON.stringify({ phase, ...details })}`);
}

async function runLocalGate(baseRevision = '', baseArtifactId = '') {
  const targetedHomeGate = process.env.VIDO_DEPLOY_TARGETED_GATE === '1'
    || os.hostname().toUpperCase() === 'LAPTOP-LDFOL0GT';
  const plan = releaseGatePlanner.createPlan({
    root,
    baseRevision,
    baseArtifactId,
    targetRevision: runtimeManifest.source_revision,
    sourceTree: runtimeManifest.source_tree,
    fullPlatform: !targetedHomeGate,
    targetedHome: targetedHomeGate,
  });
  const result = await releaseGatePlanner.runPlan(root, plan);
  console.log(`LOCAL_IMMUTABLE_RELEASE_GATE=${JSON.stringify({
    mode: targetedHomeGate ? 'targeted' : 'standard', profile: result.profile,
    cached: result.cached_count, total: result.results.length,
  })}`);
  return result;
}

function exec(command) {
  return new Promise((resolve, reject) => client.exec(command, (error, stream) => {
    if (error) return reject(error);
    let stdout = ''; let stderr = '';
    stream.on('data', chunk => { stdout += chunk; });
    stream.stderr.on('data', chunk => { stderr += chunk; });
    stream.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${stdout}\n${stderr}`.trim().slice(-20000))));
  }));
}

function parseJson(output) {
  const lines = String(output || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  try { return JSON.parse(lines.join('\n')); } catch {}
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines.slice(index).join('\n')); } catch {}
  }
  throw new Error(`远端输出缺少 JSON：${lines.slice(-6).join(' | ')}`);
}

async function remoteHashAudit(directory) {
  return parseJson(await exec(`cd ${quote(directory)} && node -e ${quote(`
    const fs=require('fs'),crypto=require('crypto');
    const spec=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
    const mismatches=spec.files.filter(file=>!fs.existsSync(file)||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==spec.hashes[file]);
    console.log(JSON.stringify({checked:spec.files.length,mismatches}));
  `)} ${quote(remoteAuditSpecPath)}`));
}

async function releaseReadiness(appRoot) {
  return parseJson(await exec(`cd ${quote(appRoot)} && node scripts/run-with-pm2-env.js vido node scripts/check-new-story-ad-active-tasks.js`));
}

function blockingUnknownBilling(readiness = {}) {
  return Number(readiness.active_unknown_billing_count
    ?? readiness.unknown_billing_count
    ?? 0);
}

function isExpectedActiveRelease(version = {}) {
  return deployRecovery.isExpectedActiveRelease(version, {
    release_bundle_id: releaseBundleId,
    artifact_id: artifactId,
    source_revision: runtimeManifest.source_revision,
    source_tree: runtimeManifest.source_tree,
    build_id: release.build_id,
  });
}

async function recoverAlreadyActiveRelease(version = {}) {
  if (!isExpectedActiveRelease(version)) return null;
  reportPhase('already_active_verify', { build_id: version.build_id, artifact_id: artifactId });
  const health = parseJson(await exec('curl -fsS http://127.0.0.1:4600/api/health'));
  const publicHealth = parseJson(await exec('curl -fsS https://vido.smsend.cn/api/health'));
  const publicVersion = parseJson(await exec('curl -fsS https://vido.smsend.cn/api/story-ad/version'));
  const readiness = await releaseReadiness(previousTarget);
  const quick = await exec("echo UFJBR01BIHF1aWNrX2NoZWNrOw== | base64 -d | sqlite3 /data/vido/db/vido.sqlite");
  const receipt = deployRecovery.confirmRecoveredRelease({
    version, health, public_health: publicHealth, public_version: publicVersion,
    readiness, sqlite_quick_check: quick.trim(), release_dir: previousTarget,
  }, {
    release_bundle_id: releaseBundleId,
    artifact_id: artifactId,
    source_revision: runtimeManifest.source_revision,
    source_tree: runtimeManifest.source_tree,
    build_id: release.build_id,
  });
  reportPhase('already_active', { build_id: version.build_id, artifact_id: artifactId });
  console.log(`IMMUTABLE_RELEASE=${JSON.stringify(receipt)}`);
  return receipt;
}

async function setReleaseControl(state, bundleId = '') {
  const command = `cd ${quote(releaseDir)} && node ${quote(`${previousTarget}/scripts/run-with-pm2-env.js`)} vido node scripts/manage-story-ad-release-control.js --state ${quote(state)}${bundleId ? ` --bundle ${quote(bundleId)}` : ''}`;
  return parseJson(await exec(command));
}

async function migrateReleaseState() {
  if (previousBundleId === releaseBundleId) {
    releaseMigrationMode = 'same_bundle';
    return { migration_id: '', task_count: 0, summary: { same_bundle: 1 }, model_calls: 0, paid_calls: 0 };
  }
  if (!previousBundleId) {
    releaseMigrationMode = 'legacy_v110_isolation';
    const result = parseJson(await exec(`cd ${quote(releaseDir)} && node ${quote(`${previousTarget}/scripts/run-with-pm2-env.js`)} vido node scripts/migrate-story-ad-platform-v111.js --apply`));
    releaseMigrationApplied = true;
    return result;
  }
  if (previousBuildId === '20260810-platform-release-migration-v126'
    && previousContractVersion === 'story-scene-platform-v6') {
    releaseMigrationMode = 'v126_runtime_compatible';
    return { migration_id: '', task_count: 0, summary: { runtime_compatible: 1 }, model_calls: 0, paid_calls: 0 };
  }
  if (previousBuildId === '20260809-platform-cinematic-layers-v120'
    && previousContractVersion === 'story-scene-platform-v6') {
    releaseMigrationMode = 'v120_deterministic_checkpoint';
    // Mark the attempt before the command so a mid-write failure still triggers
    // the backup-driven rollback path.
    releaseMigrationApplied = true;
    const result = parseJson(await exec(`cd ${quote(releaseDir)} && node ${quote(`${previousTarget}/scripts/run-with-pm2-env.js`)} vido node scripts/migrate-story-ad-v120-checkpoints.js --apply --summary-only --source-build ${quote(previousBuildId)} --source-bundle ${quote(previousBundleId)}`));
    if (Number(result.blocked_count || 0)) throw new Error(`V120_MIGRATION_BLOCKED: ${JSON.stringify(result)}`);
    return result;
  }
  if (previousContractVersion === release.contract_version) {
    releaseMigrationMode = 'same_contract_runtime_compatible';
    return { migration_id: '', task_count: 0, summary: { runtime_compatible: 1 }, model_calls: 0, paid_calls: 0 };
  }
  if (previousContractVersion === 'story-scene-platform-v6'
    && release.contract_version === 'story-scene-platform-v7') {
    releaseMigrationMode = 'v7_seven_step_contract_isolation';
    return {
      migration_id: '', task_count: 0,
      summary: { old_combined_storyboard_sketch_outputs_ignored: 1, seven_step_contract_enabled: 1 },
      model_calls: 0, paid_calls: 0,
    };
  }
  if (previousContractVersion === 'story-scene-platform-v7'
    && release.contract_version === 'story-scene-platform-v8') {
    releaseMigrationMode = 'v8_six_step_system_binding_compatible';
    return {
      migration_id: '', task_count: 0,
      summary: { persisted_authorities_preserved: 1, user_story_flow_route_disabled: 1, system_binding_on_storyboard_start: 1 },
      model_calls: 0, paid_calls: 0,
    };
  }
  throw new Error(`UNSUPPORTED_RELEASE_MIGRATION: refusing mixed checkpoint transition from ${previousBuildId || 'unknown'} (${previousBundleId}) to ${release.build_id}`);
}

async function migrateAssistRoute() {
  assistRouteMigrationApplied = true;
  const result = parseJson(await exec(`cd ${quote(releaseDir)} && node ${quote(`${previousTarget}/scripts/run-with-pm2-env.js`)} vido node scripts/configure-story-ad-quality-supplier-routing-v327.js --apply`));
  assistRouteMigrationApplied = result.applied === true;
  return result;
}

async function createSystemicBackup() {
  const legacyJson = `${previousTarget}/outputs/new_story_ad_db.json`;
  await exec([
    `mkdir -p ${quote(systemicBackupDir)}`,
    `sqlite3 /data/vido/db/vido.sqlite ${quote(`.backup '${systemicBackupDir}/vido.sqlite.before-systemic'`)}`,
    `echo UFJBR01BIHF1aWNrX2NoZWNrOw== | base64 -d | sqlite3 ${quote(`${systemicBackupDir}/vido.sqlite.before-systemic`)} | grep -Fx ok`,
    `if test -f ${quote(legacyJson)}; then cp -a ${quote(legacyJson)} ${quote(`${systemicBackupDir}/new_story_ad_db.json.before-systemic`)} && touch ${quote(`${systemicBackupDir}/legacy-json-existed`)}; else touch ${quote(`${systemicBackupDir}/legacy-json-missing`)}; fi`,
  ].join(' && '));
  systemicBackupCreated = true;
  return { backup_dir: systemicBackupDir, sqlite_quick_check: 'ok' };
}

async function migrateSystemicState() {
  const targetMigrationSetId = String(releaseBundle.identity().migration_set_id || '');
  if (previousMigrationSetId && previousMigrationSetId === targetMigrationSetId) {
    return {
      skipped: true,
      reason: 'same_migration_set',
      migration_set_id: targetMigrationSetId,
      model_calls_started: 0,
    };
  }
  const runner = `${previousTarget}/scripts/run-with-pm2-env.js`;
  const dryRun = parseJson(await exec(`cd ${quote(releaseDir)} && node ${quote(runner)} vido node scripts/migrate-new-story-ad-systemic-state.js`));
  if (dryRun.read_only !== true || Number(dryRun.model_calls_started || 0) !== 0) {
    throw new Error(`SYSTEMIC_MIGRATION_DRY_RUN_INVALID: ${JSON.stringify(dryRun)}`);
  }
  systemicMigrationApplied = true;
  const applied = parseJson(await exec(`cd ${quote(releaseDir)} && node ${quote(runner)} vido node scripts/migrate-new-story-ad-systemic-state.js --commit`));
  if (applied.ok !== true || Number(applied.model_calls_started || 0) !== 0
    || Number(applied.remaining?.tasks_without_work || 0) !== 0
    || Number(applied.remaining?.tasks_without_lineage || 0) !== 0
    || Number(applied.remaining?.unknown_billing_without_quarantine || 0) !== 0
    || Number(applied.remaining?.non_authoritative_works || 0) !== 0) {
    throw new Error(`SYSTEMIC_MIGRATION_FAILED: ${JSON.stringify(applied)}`);
  }
  const audit = parseJson(await exec(`cd ${quote(releaseDir)} && node ${quote(runner)} vido node scripts/audit-new-story-ad-systemic-state.js`));
  if (Number(audit.summary?.task_without_work_count || 0) !== 0
    || Number(audit.summary?.shadow_work_count || 0) !== 0
    || Number(audit.summary?.task_with_issue_count || 0) !== 0
    || Number(audit.summary?.unquarantined_unknown_billing_count || 0) !== 0
    || Number(audit.summary?.active_generation_count || 0) !== 0) {
    throw new Error(`SYSTEMIC_MIGRATION_AUDIT_FAILED: ${JSON.stringify(audit.summary || audit)}`);
  }
  return { dry_run: dryRun, applied, audit: audit.summary };
}

async function auditCandidateSystemicState() {
  const runner = `${previousTarget}/scripts/run-with-pm2-env.js`;
  const dryRun = parseJson(await exec(`cd ${quote(releaseDir)} && node ${quote(runner)} vido node scripts/migrate-new-story-ad-systemic-state.js`));
  const audit = parseJson(await exec(`cd ${quote(releaseDir)} && node ${quote(runner)} vido node scripts/audit-new-story-ad-systemic-state.js`));
  const plannedQuarantines = Number(dryRun.unknown_billing_to_quarantine?.length || 0);
  const unquarantined = Number(audit.summary?.unquarantined_unknown_billing_count || 0);
  if (dryRun.read_only !== true || Number(dryRun.model_calls_started || 0) !== 0
    || Number(audit.summary?.active_generation_count || 0) !== 0) {
    throw new Error(`CANDIDATE_SYSTEMIC_PREFLIGHT_FAILED: ${JSON.stringify({
      planned_quarantines: plannedQuarantines,
      unquarantined_unknown_billing: unquarantined,
      active_generation_count: Number(audit.summary?.active_generation_count || 0),
    })}`);
  }
  return {
    dry_run: dryRun, audit: audit.summary, planned_quarantines: plannedQuarantines,
    unquarantined_unknown_billing_count: unquarantined,
  };
}

async function restoreSystemicBackup() {
  if (!systemicBackupCreated) return null;
  if (!systemicMigrationApplied) {
    return { restored: false, reason: 'systemic_migration_not_applied', backup_dir: systemicBackupDir };
  }
  await exec(`pm2 stop vido >/dev/null 2>&1 || true; pm2 stop ${quote(candidateName)} >/dev/null 2>&1 || true`);
  const legacyJson = `${previousTarget}/outputs/new_story_ad_db.json`;
  await exec([
    `cp -a ${quote(`${systemicBackupDir}/vido.sqlite.before-systemic`)} /data/vido/db/vido.sqlite.restore`,
    `echo UFJBR01BIHF1aWNrX2NoZWNrOw== | base64 -d | sqlite3 /data/vido/db/vido.sqlite.restore | grep -Fx ok`,
    'mv -f /data/vido/db/vido.sqlite.restore /data/vido/db/vido.sqlite',
    'rm -f /data/vido/db/vido.sqlite-wal /data/vido/db/vido.sqlite-shm',
    `if test -f ${quote(`${systemicBackupDir}/legacy-json-existed`)}; then cp -a ${quote(`${systemicBackupDir}/new_story_ad_db.json.before-systemic`)} ${quote(legacyJson)}; elif test -f ${quote(`${systemicBackupDir}/legacy-json-missing`)}; then rm -f ${quote(legacyJson)}; fi`,
  ].join(' && '));
  systemicMigrationApplied = false;
  return { restored: true, backup_dir: systemicBackupDir };
}

async function rollbackAssistRoute() {
  if (!assistRouteMigrationApplied) return null;
  return parseJson(await exec(`cd ${quote(releaseDir)} && node scripts/run-with-pm2-env.js vido node scripts/configure-story-ad-quality-supplier-routing-v327.js --rollback`));
}

async function commitAssistRoute() {
  if (!assistRouteMigrationApplied) return null;
  return parseJson(await exec(`cd ${quote(releaseDir)} && node scripts/run-with-pm2-env.js vido node scripts/configure-story-ad-quality-supplier-routing-v327.js --commit`));
}

async function rollbackReleaseState() {
  if (!releaseMigrationApplied || releaseMigrationMode !== 'v120_deterministic_checkpoint') return null;
  return parseJson(await exec(`cd ${quote(releaseDir)} && node scripts/run-with-pm2-env.js vido node scripts/migrate-story-ad-v120-checkpoints.js --rollback --summary-only`));
}

async function rollback() {
  if (!cutoverStarted && !releaseMigrationApplied && !assistRouteMigrationApplied
    && !releaseControlDrained && !systemicBackupCreated) return;
  await rollbackAssistRoute();
  await rollbackReleaseState();
  const restored = await restoreSystemicBackup();
  const restartPreviousRuntime = cutoverStarted || legacyProcessFrozen || restored?.restored === true;
  if (cutoverStarted) {
    await exec(`ln -sfn ${quote(previousTarget)} /opt/vido/.current-rollback && mv -Tf /opt/vido/.current-rollback ${quote(currentLink)}`);
  }
  if (restartPreviousRuntime) {
    await exec(`node ${quote(`${releaseDir}/scripts/story-ad-pm2-release.js`)} --mode cutover --release ${quote(previousTarget)} --build ${quote(previousBuildId || release.build_id)} --candidate ${quote(candidateName)}${previousNodeRuntimeBin ? ` --node ${quote(previousNodeRuntimeBin)}` : ''}`);
  }
  if (releaseControlDrained) {
    await exec(previousBundleId
      ? `cd ${quote(releaseDir)} && node scripts/run-with-pm2-env.js vido node scripts/manage-story-ad-release-control.js --state active --bundle ${quote(previousBundleId)}`
      : `cd ${quote(releaseDir)} && node scripts/run-with-pm2-env.js vido node scripts/manage-story-ad-release-control.js --state rollback`);
  }
  if (!restartPreviousRuntime && !releaseControlDrained) return;
  await exec('for i in $(seq 1 30); do sleep 3; curl -fsS http://127.0.0.1:4600/api/health >/dev/null && exit 0; done; exit 1');
  const restoredVersion = parseJson(await exec('curl -fsS http://127.0.0.1:4600/api/story-ad/version'));
  if ((previousBundleId && restoredVersion.release_bundle_id !== previousBundleId)
    || (!previousBundleId && previousBuildId && restoredVersion.build_id !== previousBuildId)) {
    throw new Error(`ROLLBACK_RELEASE_IDENTITY_MISMATCH: ${JSON.stringify(restoredVersion)}`);
  }
}

client.on('ready', async () => {
  let sftp;
  try {
    reportPhase('connected', { files: files.length, upload_concurrency: uploadConcurrency });
    previousTarget = (await exec(`if test -e ${quote(currentLink)}; then readlink -f ${quote(currentLink)}; else printf %s /opt/vido/app; fi`)).trim() || '/opt/vido/app';
    if (!effectiveBaseReleaseDir && /^\/opt\/vido\/releases\/[a-f0-9]{64}$/.test(previousTarget)) {
      effectiveBaseReleaseDir = previousTarget;
    }
    const preVersion = parseJson(await exec('curl -fsS http://127.0.0.1:4600/api/story-ad/version'));
    previousBundleId = String(preVersion.release_bundle_id || '');
    previousBuildId = String(preVersion.build_id || '');
    previousContractVersion = String(preVersion.contract_version || '');
    previousMigrationSetId = String(preVersion.release_bundle?.migration_set_id || '');
    const previousRuntimeVersion = String(preVersion.release_bundle?.node_runtime_version || '');
    const previousRuntimePlatform = String(preVersion.release_bundle?.node_runtime_platform || '');
    if (/^v\d+\.\d+\.\d+$/.test(previousRuntimeVersion) && /^[a-z0-9._-]+$/i.test(previousRuntimePlatform)) {
      previousNodeRuntimeBin = `/opt/vido/runtimes/node-${previousRuntimeVersion}-${previousRuntimePlatform}/bin/node`;
    }
    const recovered = await recoverAlreadyActiveRelease(preVersion);
    if (recovered) {
      client.end();
      return;
    }
    reportPhase('local_gate', { base_revision: preVersion.release_bundle?.source_revision || '' });
    await runLocalGate(
      String(preVersion.release_bundle?.source_revision || ''),
      String(preVersion.release_bundle?.artifact_id || ''),
    );
    await exec(`mkdir -p /opt/vido/releases /opt/vido/deploy-locks /opt/vido/dependencies /opt/vido/runtimes && mkdir ${quote(lockDir)}`);
    sftp = await new Promise((resolve, reject) => client.sftp((error, channel) => error ? reject(error) : resolve(channel)));
    reportPhase('audit_upload');
    await new Promise((resolve, reject) => sftp.writeFile(remoteAuditSpecPath, auditSpec, error => error ? reject(error) : resolve()));
    const quickBefore = await exec("echo UFJBR01BIHF1aWNrX2NoZWNrOw== | base64 -d | sqlite3 /data/vido/db/vido.sqlite");
    if (quickBefore.trim() !== 'ok') throw new Error(`发布前数据库 quick_check 失败：${quickBefore}`);

    const exists = (await exec(`test -d ${quote(releaseDir)} && echo yes || echo no`)).trim() === 'yes';
    if (!exists) {
      reportPhase('artifact_upload', { files: files.length, upload_concurrency: uploadConcurrency });
      await exec(`mkdir -p ${quote(stagingDir)}`);
      if (effectiveBaseReleaseDir) {
        const baseExists = (await exec(`test -d ${quote(effectiveBaseReleaseDir)} && echo yes || echo no`)).trim() === 'yes';
        if (!baseExists) throw new Error(`IMMUTABLE_BASE_RELEASE_MISSING: ${effectiveBaseReleaseDir}`);
        await exec(`node -e ${quote(`
          const fs=require('fs'),path=require('path');
          const spec=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
          const base=process.argv[2],target=process.argv[3];
          let reused=0;
          for(const file of spec.files){
            const source=path.join(base,file),destination=path.join(target,file);
            if(!fs.existsSync(source)) continue;
            fs.mkdirSync(path.dirname(destination),{recursive:true});
            fs.linkSync(source,destination); reused+=1;
          }
          console.log(JSON.stringify({reused}));
        `)} ${quote(remoteAuditSpecPath)} ${quote(effectiveBaseReleaseDir)} ${quote(stagingDir)}`);
      }
      const directories = [...new Set(files.map(file => path.posix.dirname(file)).filter(dir => dir !== '.'))];
      await exec(`mkdir -p ${directories.map(dir => quote(`${stagingDir}/${dir}`)).join(' ')}`);
      const stagedAudit = await remoteHashAudit(stagingDir);
      const queue = stagedAudit.mismatches.slice();
      reportPhase('artifact_delta', { reused: files.length - queue.length, upload: queue.length });
      await Promise.all(Array.from({ length: Math.min(uploadConcurrency, queue.length) }, async () => {
        while (queue.length) {
          const file = queue.shift();
          // Reused files are hard links to the previous immutable release.
          // Break the link before fastPut truncates the destination, otherwise
          // uploading a changed file would silently mutate the rollback image.
          await new Promise((resolve, reject) => sftp.unlink(`${stagingDir}/${file}`, error => {
            if (!error || Number(error.code) === 2) resolve();
            else reject(error);
          }));
          await new Promise((resolve, reject) => sftp.fastPut(path.join(root, file), `${stagingDir}/${file}`, error => error ? reject(error) : resolve()));
        }
      }));
      const audit = await remoteHashAudit(stagingDir);
      reportPhase('artifact_verified', { checked: audit.checked });
      if (audit.mismatches.length) throw new Error(`上传制品哈希不一致：${audit.mismatches.slice(0, 20).join(', ')}`);
      const runtimeExists = (await exec(`test -x ${quote(nodeRuntimeBin)} && echo yes || echo no`)).trim() === 'yes';
      if (!runtimeExists) {
        const runtimeStaging = `${nodeRuntimeDir}.staging-${process.pid}`;
        const runtimeArchive = `${runtimeStaging}.tar.xz`;
        await exec([
          `mkdir ${quote(runtimeStaging)}`,
          `curl -fL --retry 5 --retry-delay 2 --connect-timeout 15 ${quote(nodeRuntime.url)} -o ${quote(runtimeArchive)}`,
          `echo ${quote(`${nodeRuntime.sha256}  ${runtimeArchive}`)} | sha256sum -c -`,
          `tar -xJf ${quote(runtimeArchive)} -C ${quote(runtimeStaging)} --strip-components=1`,
          `test "$(${quote(`${runtimeStaging}/bin/node`)} -v)" = ${quote(nodeRuntime.version)}`,
          `mv ${quote(runtimeStaging)} ${quote(nodeRuntimeDir)}`,
          `rm -f ${quote(runtimeArchive)}`,
        ].join(' && '));
      }
      const dependencyExists = (await exec(`test -d ${quote(`${dependencyDir}/node_modules`)} && echo yes || echo no`)).trim() === 'yes';
      if (!dependencyExists) {
        const dependencyStaging = `${dependencyDir}.staging-${process.pid}`;
        await exec([
          `mkdir -p ${quote(dependencyStaging)}`,
          `cp ${quote(`${stagingDir}/package.json`)} ${quote(`${stagingDir}/package-lock.json`)} ${quote(`${dependencyStaging}/`)}`,
          `cd ${quote(dependencyStaging)} && PATH=${quote(`${nodeRuntimeDir}/bin`)}:$PATH npm ci --omit=dev --no-audit --no-fund --registry=https://registry.npmjs.org`,
          `cd ${quote(dependencyStaging)} && PATH=${quote(`${nodeRuntimeDir}/bin`)}:$PATH npm ls --omit=dev --json >/dev/null`,
          `mv ${quote(dependencyStaging)} ${quote(dependencyDir)}`,
        ].join(' && '));
      }
      await exec([
        `test ! -e ${quote(`${stagingDir}/node_modules`)} && ln -s ${quote(`${dependencyDir}/node_modules`)} ${quote(`${stagingDir}/node_modules`)}`,
        `if test ! -e ${quote(`${stagingDir}/.env`)} && test -e ${quote(`${previousTarget}/.env`)}; then ln -s "$(readlink -f ${quote(`${previousTarget}/.env`)})" ${quote(`${stagingDir}/.env`)}; fi`,
        `if test ! -e ${quote(`${stagingDir}/outputs`)} && test -e ${quote(`${previousTarget}/outputs`)}; then ln -s "$(readlink -f ${quote(`${previousTarget}/outputs`)})" ${quote(`${stagingDir}/outputs`)}; fi`,
        `mv ${quote(stagingDir)} ${quote(releaseDir)}`,
      ].join(' && '));
    }
    const finalAudit = await remoteHashAudit(releaseDir);
    if (finalAudit.mismatches.length) throw new Error(`不可变 release 哈希不一致：${finalAudit.mismatches.slice(0, 20).join(', ')}`);
    reportPhase('candidate_start');
    await exec(`cd ${quote(releaseDir)} && node scripts/story-ad-pm2-release.js --mode candidate --release ${quote(releaseDir)} --build ${quote(release.build_id)} --candidate ${quote(candidateName)} --node ${quote(nodeRuntimeBin)}`);
    await exec('for i in 1 2 3 4 5 6 7 8 9 10 11 12; do sleep 3; curl -fsS http://127.0.0.1:4601/api/health >/dev/null && exit 0; done; exit 1');
    const candidateVersion = parseJson(await exec('curl -fsS http://127.0.0.1:4601/api/story-ad/version'));
    if (candidateVersion.release_bundle_id !== releaseBundleId) {
      throw new Error(`CANDIDATE_RELEASE_BUNDLE_MISMATCH: expected ${releaseBundleId}, received ${candidateVersion.release_bundle_id || 'missing'}`);
    }
    if (candidateVersion.release_bundle?.artifact_id !== artifactId
      || candidateVersion.release_bundle?.source_revision !== runtimeManifest.source_revision
      || candidateVersion.release_bundle?.source_tree !== runtimeManifest.source_tree
      || candidateVersion.release_bundle?.remote_sync_verified !== true
      || candidateVersion.node_version !== nodeRuntime.version) {
      throw new Error(`候选进程制品、源码或 Node 身份错误：${JSON.stringify(candidateVersion)}`);
    }
    const before = await releaseReadiness(releaseDir);
    if (Number(before.active_count) || blockingUnknownBilling(before)) {
      throw new Error(`发布前仍有活动任务或当前生成未知计费：${JSON.stringify(before)}`);
    }
    if (candidateOnly) {
      const candidateSystemicAudit = await auditCandidateSystemicState();
      if (Number(candidateSystemicAudit.unquarantined_unknown_billing_count || 0)
        > Number(candidateSystemicAudit.planned_quarantines || 0)) {
        throw new Error(`CANDIDATE_SYSTEMIC_PREFLIGHT_FAILED: ${JSON.stringify(candidateSystemicAudit)}`);
      }
      reportPhase('candidate_verified', { build_id: candidateVersion.build_id, artifact_id: artifactId, write_allowed: candidateVersion.release_control?.allowed === true });
      console.log(`IMMUTABLE_CANDIDATE=${JSON.stringify({
        build_id: candidateVersion.build_id,
        release_bundle_id: candidateVersion.release_bundle_id,
        artifact_id: artifactId,
        source_revision: candidateVersion.release_bundle.source_revision,
        source_tree: candidateVersion.release_bundle.source_tree,
        remote_sync_verified: candidateVersion.release_bundle.remote_sync_verified,
        write_allowed: candidateVersion.release_control?.allowed === true,
        release_dir: releaseDir,
        process_id: candidateVersion.process_id,
        systemic_preflight: candidateSystemicAudit,
      })}`);
      if (sftp) sftp.end();
      await exec(`rm -f ${quote(remoteAuditSpecPath)} && rmdir ${quote(lockDir)}`);
      client.end();
      return;
    }

    if (!previousBundleId) {
      await exec('pm2 stop vido >/dev/null');
      legacyProcessFrozen = true;
    }
    await setReleaseControl('draining', preVersion.release_bundle_id || '');
    releaseControlDrained = true;
    // The current release may contain the very read-path defect this candidate
    // repairs.  Once writes are drained, inspect the shared production database
    // with the already verified candidate code so a broken historical reader
    // cannot permanently prevent its own replacement.
    const drained = await releaseReadiness(releaseDir);
    if (Number(drained.active_count) || blockingUnknownBilling(drained)) throw new Error(`停写后仍有活动任务或当前生成未知计费：${JSON.stringify(drained)}`);
    const systemicBackup = await createSystemicBackup();
    const migration = await migrateReleaseState();
    const systemicMigration = await migrateSystemicState();
    const assistRouteMigration = await migrateAssistRoute();
    reportPhase('cutover');
    cutoverStarted = true;
    await exec(`ln -sfn ${quote(releaseDir)} /opt/vido/.current-next && mv -Tf /opt/vido/.current-next ${quote(currentLink)}`);
    await exec(`node ${quote(`${releaseDir}/scripts/story-ad-pm2-release.js`)} --mode cutover --release ${quote(releaseDir)} --build ${quote(release.build_id)} --candidate ${quote(candidateName)} --node ${quote(nodeRuntimeBin)}`);
    await exec('for i in $(seq 1 30); do sleep 3; curl -fsS http://127.0.0.1:4600/api/health >/dev/null && exit 0; done; exit 1');
    const activeControl = parseJson(await exec(`cd ${quote(releaseDir)} && node scripts/run-with-pm2-env.js vido node scripts/manage-story-ad-release-control.js --state active --bundle ${quote(candidateVersion.release_bundle_id)}`));
    const version = parseJson(await exec('curl -fsS http://127.0.0.1:4600/api/story-ad/version'));
    const health = parseJson(await exec('curl -fsS http://127.0.0.1:4600/api/health'));
    const publicHealth = parseJson(await exec('curl -fsS https://vido.smsend.cn/api/health'));
    const publicVersion = parseJson(await exec('curl -fsS https://vido.smsend.cn/api/story-ad/version'));
    const after = await releaseReadiness(releaseDir);
    const quickAfter = await exec("echo UFJBR01BIHF1aWNrX2NoZWNrOw== | base64 -d | sqlite3 /data/vido/db/vido.sqlite");
    if (version.release_bundle?.artifact_id !== artifactId
      || version.release_bundle?.source_revision !== runtimeManifest.source_revision
      || version.release_bundle?.source_tree !== runtimeManifest.source_tree
      || version.release_bundle?.remote_sync_verified !== true
      || version.release_bundle_id !== releaseBundleId
      || version.node_version !== nodeRuntime.version || version.release_control?.allowed !== true
      || publicVersion.release_bundle_id !== releaseBundleId || publicVersion.build_id !== release.build_id
      || health.status !== 'ok' || publicHealth.status !== 'ok' || quickAfter.trim() !== 'ok'
      || Number(after.active_count) || blockingUnknownBilling(after)) {
      throw new Error(`发布后门禁失败：${JSON.stringify({ version, health, publicHealth, after, quickAfter, activeControl })}`);
    }
    const assistRouteCommit = await commitAssistRoute();
    reportPhase('verified', { build_id: version.build_id, artifact_id: artifactId });
    console.log(`IMMUTABLE_RELEASE=${JSON.stringify({
      build_id: version.build_id, contract_version: version.contract_version,
      release_bundle_id: version.release_bundle_id, artifact_id: artifactId,
      source_revision: version.release_bundle.source_revision,
      source_tree: version.release_bundle.source_tree,
      source_ref: version.release_bundle.source_ref,
      upstream_ref: version.release_bundle.upstream_ref,
      runtime_hash: version.runtime_hash, process_id: version.process_id,
      release_dir: releaseDir, previous_target: previousTarget, files: files.length,
      active_before: before.active_count, active_after: after.active_count,
      unknown_billing_before: before.unknown_billing_count, unknown_billing_after: after.unknown_billing_count,
      active_unknown_billing_before: blockingUnknownBilling(before),
      active_unknown_billing_after: blockingUnknownBilling(after),
      legacy_process_frozen: legacyProcessFrozen,
      release_migration_mode: releaseMigrationMode,
      release_migration: migration,
      systemic_backup: systemicBackup,
      systemic_migration: systemicMigration,
      assist_route_migration: assistRouteMigration,
      assist_route_commit: assistRouteCommit,
      public_release_bundle_id: publicVersion.release_bundle_id,
      health: health.status, public_health: publicHealth.status, sqlite_quick_check: quickAfter.trim(),
    })}`);
    if (sftp) sftp.end();
    await exec(`rm -f ${quote(remoteAuditSpecPath)} && rmdir ${quote(lockDir)}`);
    client.end();
  } catch (error) {
    if (sftp) sftp.end();
    try { await rollback(); console.error('IMMUTABLE_RELEASE_ROLLED_BACK'); } catch (rollbackError) { console.error(`ROLLBACK_FAILED: ${rollbackError.message || rollbackError}`); }
    try { await exec(`pm2 delete ${quote(candidateName)} >/dev/null 2>&1 || true`); } catch {}
    try { await exec(`rm -f ${quote(remoteAuditSpecPath)} 2>/dev/null || true; rmdir ${quote(lockDir)} 2>/dev/null || true`); } catch {}
    console.error(error.message || error);
    client.end();
    process.exitCode = 1;
  }
}).on('error', error => { console.error(error.message || error); process.exitCode = 1; }).connect(connectionOptions({ host, port, username }));
