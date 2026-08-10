#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('ssh2');
const { connectionOptions } = require('./lib/vidoSshAuth');
const { collectStoryAdReleaseFiles } = require('./lib/storyAdReleaseFiles');
const integrity = require('../src/services/storyAdReleaseIntegrityService');
const releaseBundle = require('../src/services/storyAdReleaseBundleService');

const root = path.resolve(__dirname, '..');
const release = require('../config/story-ad-release.json');
const publicManifest = require('../public/story-ad/release-manifest.json');
const runtimeManifest = require('../config/story-ad-runtime-manifest.json');
const artifactId = String(runtimeManifest.artifact_id || '');
const releaseBundleId = releaseBundle.identity().bundle_id;
if (!/^[a-f0-9]{64}$/.test(artifactId)) throw new Error('发布清单缺少有效 artifact_id，请先执行 story-ad:release:build');
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
const host = process.env.VIDO_DEPLOY_HOST || '43.98.167.151';
const username = process.env.VIDO_DEPLOY_USER || 'root';
const files = collectStoryAdReleaseFiles({ root, releaseManifest: publicManifest });
const uploadConcurrency = Math.max(1, Math.min(8, Number(
  process.env.VIDO_IMMUTABLE_UPLOAD_CONCURRENCY || process.env.VIDO_DEPLOY_UPLOAD_CONCURRENCY,
) || 3));
const client = new Client();
const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
const candidateName = `vido-candidate-${artifactId.slice(0, 12)}`;
let previousTarget = '/opt/vido/app';
let previousBundleId = '';
let previousBuildId = '';
let previousContractVersion = '';
let previousNodeRuntimeBin = '';
let cutoverStarted = false;
let legacyProcessFrozen = false;
let releaseMigrationMode = 'none';
let releaseMigrationApplied = false;
let assistRouteMigrationApplied = false;

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

function runLocalGate() {
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm run story-ad:v111:test && npm run platform:upgrade:test']
    : ['run', 'story-ad:release:predeploy'];
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-immutable-release-'));
  try {
    const result = childProcess.spawnSync(command, args, {
      cwd: root,
      env: { ...process.env, OUTPUT_DIR: outputDir, DB_ENABLED: '0', DB_READ_PRIMARY: '0', DB_DUAL_WRITE: '0', DB_JSON_FALLBACK: '1' },
      encoding: 'utf8', maxBuffer: 96 * 1024 * 1024, timeout: 45 * 60 * 1000,
    });
    if (result.status !== 0) throw new Error(`本地不可变制品门禁失败：\n${`${result.stdout || ''}\n${result.stderr || ''}`.slice(-30000)}`);
    console.log('LOCAL_IMMUTABLE_RELEASE_GATE=passed');
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
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
  throw new Error(`UNSUPPORTED_RELEASE_MIGRATION: refusing mixed checkpoint transition from ${previousBuildId || 'unknown'} (${previousBundleId}) to ${release.build_id}`);
}

async function migrateAssistRoute() {
  assistRouteMigrationApplied = true;
  const result = parseJson(await exec(`cd ${quote(releaseDir)} && node ${quote(`${previousTarget}/scripts/run-with-pm2-env.js`)} vido node scripts/migrate-new-story-ad-assist-route-v127.js --apply`));
  assistRouteMigrationApplied = result.changed === true;
  return result;
}

async function rollbackAssistRoute() {
  if (!assistRouteMigrationApplied) return null;
  return parseJson(await exec(`cd ${quote(releaseDir)} && node scripts/run-with-pm2-env.js vido node scripts/migrate-new-story-ad-assist-route-v127.js --rollback`));
}

async function commitAssistRoute() {
  if (!assistRouteMigrationApplied) return null;
  return parseJson(await exec(`cd ${quote(releaseDir)} && node scripts/run-with-pm2-env.js vido node scripts/migrate-new-story-ad-assist-route-v127.js --commit`));
}

async function rollbackReleaseState() {
  if (!releaseMigrationApplied || releaseMigrationMode !== 'v120_deterministic_checkpoint') return null;
  return parseJson(await exec(`cd ${quote(releaseDir)} && node scripts/run-with-pm2-env.js vido node scripts/migrate-story-ad-v120-checkpoints.js --rollback --summary-only`));
}

async function rollback() {
  if (!cutoverStarted && !releaseMigrationApplied && !assistRouteMigrationApplied) return;
  await rollbackAssistRoute();
  await rollbackReleaseState();
  if (!cutoverStarted) return;
  await exec(`ln -sfn ${quote(previousTarget)} /opt/vido/.current-rollback && mv -Tf /opt/vido/.current-rollback ${quote(currentLink)}`);
  await exec(`node ${quote(`${releaseDir}/scripts/story-ad-pm2-release.js`)} --mode cutover --release ${quote(previousTarget)} --build ${quote(previousBuildId || release.build_id)} --candidate ${quote(candidateName)}${previousNodeRuntimeBin ? ` --node ${quote(previousNodeRuntimeBin)}` : ''}`);
  await exec(previousBundleId
    ? `cd ${quote(releaseDir)} && node scripts/run-with-pm2-env.js vido node scripts/manage-story-ad-release-control.js --state active --bundle ${quote(previousBundleId)}`
    : `cd ${quote(releaseDir)} && node scripts/run-with-pm2-env.js vido node scripts/manage-story-ad-release-control.js --state rollback`);
  await exec('curl -fsS http://127.0.0.1:4600/api/health >/dev/null');
  const restoredVersion = parseJson(await exec('curl -fsS http://127.0.0.1:4600/api/story-ad/version'));
  if ((previousBundleId && restoredVersion.release_bundle_id !== previousBundleId)
    || (!previousBundleId && previousBuildId && restoredVersion.build_id !== previousBuildId)) {
    throw new Error(`ROLLBACK_RELEASE_IDENTITY_MISMATCH: ${JSON.stringify(restoredVersion)}`);
  }
}

runLocalGate();

client.on('ready', async () => {
  let sftp;
  try {
    reportPhase('connected', { files: files.length, upload_concurrency: uploadConcurrency });
    await exec(`mkdir -p /opt/vido/releases /opt/vido/deploy-locks /opt/vido/dependencies /opt/vido/runtimes && mkdir ${quote(lockDir)}`);
    sftp = await new Promise((resolve, reject) => client.sftp((error, channel) => error ? reject(error) : resolve(channel)));
    reportPhase('audit_upload');
    await new Promise((resolve, reject) => sftp.writeFile(remoteAuditSpecPath, auditSpec, error => error ? reject(error) : resolve()));
    previousTarget = (await exec(`if test -e ${quote(currentLink)}; then readlink -f ${quote(currentLink)}; else printf %s /opt/vido/app; fi`)).trim() || '/opt/vido/app';
    const preVersion = parseJson(await exec('curl -fsS http://127.0.0.1:4600/api/story-ad/version'));
    previousBundleId = String(preVersion.release_bundle_id || '');
    previousBuildId = String(preVersion.build_id || '');
    previousContractVersion = String(preVersion.contract_version || '');
    const previousRuntimeVersion = String(preVersion.release_bundle?.node_runtime_version || '');
    const previousRuntimePlatform = String(preVersion.release_bundle?.node_runtime_platform || '');
    if (/^v\d+\.\d+\.\d+$/.test(previousRuntimeVersion) && /^[a-z0-9._-]+$/i.test(previousRuntimePlatform)) {
      previousNodeRuntimeBin = `/opt/vido/runtimes/node-${previousRuntimeVersion}-${previousRuntimePlatform}/bin/node`;
    }
    const before = await releaseReadiness(previousTarget);
    if (Number(before.active_count) || Number(before.unknown_billing_count)) throw new Error(`发布前仍有活动任务或未知计费：${JSON.stringify(before)}`);
    const quickBefore = await exec("echo UFJBR01BIHF1aWNrX2NoZWNrOw== | base64 -d | sqlite3 /data/vido/db/vido.sqlite");
    if (quickBefore.trim() !== 'ok') throw new Error(`发布前数据库 quick_check 失败：${quickBefore}`);

    const exists = (await exec(`test -d ${quote(releaseDir)} && echo yes || echo no`)).trim() === 'yes';
    if (!exists) {
      reportPhase('artifact_upload', { files: files.length, upload_concurrency: uploadConcurrency });
      await exec(`mkdir -p ${quote(stagingDir)}`);
      const directories = [...new Set(files.map(file => path.posix.dirname(file)).filter(dir => dir !== '.'))];
      await exec(`mkdir -p ${directories.map(dir => quote(`${stagingDir}/${dir}`)).join(' ')}`);
      const queue = files.slice();
      await Promise.all(Array.from({ length: Math.min(uploadConcurrency, queue.length) }, async () => {
        while (queue.length) {
          const file = queue.shift();
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
        `test ! -e ${quote(`${stagingDir}/.env`)} && test ! -e ${quote(`${previousTarget}/.env`)} || ln -s ${quote(`${previousTarget}/.env`)} ${quote(`${stagingDir}/.env`)}`,
        `test ! -e ${quote(`${stagingDir}/outputs`)} && test ! -e ${quote(`${previousTarget}/outputs`)} || ln -s ${quote(`${previousTarget}/outputs`)} ${quote(`${stagingDir}/outputs`)}`,
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
    if (candidateVersion.release_bundle?.artifact_id !== artifactId || candidateVersion.node_version !== nodeRuntime.version) throw new Error(`候选进程制品或 Node 身份错误：${JSON.stringify(candidateVersion)}`);

    if (!previousBundleId) {
      cutoverStarted = true;
      await exec('pm2 stop vido >/dev/null');
      legacyProcessFrozen = true;
    }
    await setReleaseControl('draining', preVersion.release_bundle_id || '');
    const drained = await releaseReadiness(previousTarget);
    if (Number(drained.active_count) || Number(drained.unknown_billing_count)) throw new Error(`停写后仍有活动任务或未知计费：${JSON.stringify(drained)}`);
    const migration = await migrateReleaseState();
    const assistRouteMigration = await migrateAssistRoute();
    cutoverStarted = true;
    reportPhase('cutover');
    await exec(`ln -sfn ${quote(releaseDir)} /opt/vido/.current-next && mv -Tf /opt/vido/.current-next ${quote(currentLink)}`);
    await exec(`node ${quote(`${releaseDir}/scripts/story-ad-pm2-release.js`)} --mode cutover --release ${quote(releaseDir)} --build ${quote(release.build_id)} --candidate ${quote(candidateName)} --node ${quote(nodeRuntimeBin)}`);
    await exec('for i in 1 2 3 4 5 6 7 8 9 10 11 12; do sleep 3; curl -fsS http://127.0.0.1:4600/api/health >/dev/null && exit 0; done; exit 1');
    const activeControl = parseJson(await exec(`cd ${quote(releaseDir)} && node scripts/run-with-pm2-env.js vido node scripts/manage-story-ad-release-control.js --state active --bundle ${quote(candidateVersion.release_bundle_id)}`));
    const version = parseJson(await exec('curl -fsS http://127.0.0.1:4600/api/story-ad/version'));
    const health = parseJson(await exec('curl -fsS http://127.0.0.1:4600/api/health'));
    const publicHealth = parseJson(await exec('curl -fsS https://vido.smsend.cn/api/health'));
    const publicVersion = parseJson(await exec('curl -fsS https://vido.smsend.cn/api/story-ad/version'));
    const after = await releaseReadiness(releaseDir);
    const quickAfter = await exec("echo UFJBR01BIHF1aWNrX2NoZWNrOw== | base64 -d | sqlite3 /data/vido/db/vido.sqlite");
    if (version.release_bundle?.artifact_id !== artifactId || version.release_bundle_id !== releaseBundleId
      || version.node_version !== nodeRuntime.version || version.release_control?.allowed !== true
      || publicVersion.release_bundle_id !== releaseBundleId || publicVersion.build_id !== release.build_id
      || health.status !== 'ok' || publicHealth.status !== 'ok' || quickAfter.trim() !== 'ok'
      || Number(after.active_count) || Number(after.unknown_billing_count)) {
      throw new Error(`发布后门禁失败：${JSON.stringify({ version, health, publicHealth, after, quickAfter, activeControl })}`);
    }
    const assistRouteCommit = await commitAssistRoute();
    reportPhase('verified', { build_id: version.build_id, artifact_id: artifactId });
    console.log(`IMMUTABLE_RELEASE=${JSON.stringify({
      build_id: version.build_id, contract_version: version.contract_version,
      release_bundle_id: version.release_bundle_id, artifact_id: artifactId,
      runtime_hash: version.runtime_hash, process_id: version.process_id,
      release_dir: releaseDir, previous_target: previousTarget, files: files.length,
      active_before: before.active_count, active_after: after.active_count,
      unknown_billing_before: before.unknown_billing_count, unknown_billing_after: after.unknown_billing_count,
      legacy_process_frozen: legacyProcessFrozen,
      release_migration_mode: releaseMigrationMode,
      release_migration: migration,
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
}).on('error', error => { console.error(error.message || error); process.exitCode = 1; }).connect(connectionOptions({ host, port: 22, username }));
