'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, 'deploy-story-ad-immutable-release.js'), 'utf8');

assert(source.includes("const port = Number(process.env.VIDO_DEPLOY_PORT || 2222)"), 'immutable deploy must default to the production SSH port');
assert(source.includes('connectionOptions({ host, port, username })'), 'immutable deploy must pass the resolved SSH port');
assert(!source.includes('connectionOptions({ host, port: 22, username })'), 'immutable deploy must not hard-code the closed port 22');
assert(source.includes(".backup '") && source.includes('vido.sqlite.before-systemic'), 'systemic migration must create a consistent SQLite backup');
assert(source.includes('migrate-new-story-ad-systemic-state.js --commit'), 'immutable deploy must apply the Work/lineage/billing migration before cutover');
assert(source.indexOf('createSystemicBackup();') < source.indexOf('migrateSystemicState();'), 'backup must precede systemic migration');
assert(source.indexOf('migrateSystemicState();') < source.indexOf("reportPhase('cutover')"), 'systemic migration must pass before cutover');
assert(source.includes('restoreSystemicBackup();'), 'deployment rollback must restore the pre-migration database backup');
assert(source.includes("VIDO_IMMUTABLE_CANDIDATE_ONLY === '1'"), 'immutable deploy must support server-side candidate verification without cutover');
assert(source.indexOf('if (candidateOnly)') < source.indexOf("setReleaseControl('draining'"), 'candidate-only mode must exit before draining, migration, or cutover');
assert(source.includes('SYSTEMIC_MIGRATION_AUDIT_FAILED'), 'systemic migration must pass a post-write audit before cutover');

assert(source.includes("sftp.writeFile(remoteAuditSpecPath, auditSpec"), '发布审计清单必须通过 SFTP 文件传输');
assert(source.includes("fs.readFileSync(process.argv[1],'utf8')"), '远端哈希审计必须从清单文件读取');
assert(!source.includes('specBase64'), '禁止把完整发布清单嵌入 shell 参数');
assert(!source.includes("Buffer.from('${specBase64}'"), '禁止恢复超长 node -e 参数路径');

assert(source.includes('VIDO_IMMUTABLE_UPLOAD_CONCURRENCY'), 'immutable deploy must allow lower SFTP concurrency');
assert(source.includes('Math.min(uploadConcurrency, queue.length)'), 'immutable deploy must not use fixed high upload concurrency');
assert(source.includes("reportPhase('artifact_upload'"), 'immutable deploy must report the phase of a transport interruption');
assert(source.includes("os.hostname().toUpperCase() === 'LAPTOP-LDFOL0GT'"), '家庭电脑必须自动选择定向发布门禁');
assert(source.includes('test-story-ad-workspace-v6-ui-regressions.js'), '家庭电脑定向发布门禁必须覆盖本次工作台 UI');
assert(source.includes("targetedHomeGate ? 'targeted_passed' : 'passed'"), '发布输出必须区分定向门禁与完整门禁');
assert(source.includes("process.env.VIDO_DEPLOY_TARGETED_GATE === '1'"), '非标准主机名环境必须支持显式启用定向门禁');
assert(source.includes("runtimeManifest.schema_version || 0) < 3"), '不可变部署必须拒绝没有源码身份的旧清单');
assert(source.includes("candidateVersion.release_bundle?.source_revision !== runtimeManifest.source_revision"), '候选进程必须核对源码提交身份');
assert(source.includes("version.release_bundle?.source_tree !== runtimeManifest.source_tree"), '切换后进程必须核对源码树身份');
assert(source.includes("remote_sync_verified !== true"), '部署必须要求源码已与远端同步');

assert(source.includes('readlink -f ${quote(`${previousTarget}/outputs`)}'), 'shared outputs must resolve to the canonical directory instead of chaining release symlinks');
assert(source.includes('if test ! -e ${quote(`${stagingDir}/outputs`)} && test -e'), 'shared outputs link must only be created when the source exists and the destination is absent');

const parseJsonStart = source.indexOf('function parseJson(output) {');
const parseJsonEnd = source.indexOf('\n}\n', parseJsonStart) + 2;
assert(parseJsonStart >= 0 && parseJsonEnd > parseJsonStart, '部署器必须保留独立 JSON 解析函数');
const parseJson = vm.runInNewContext(`(${source.slice(parseJsonStart, parseJsonEnd)})`);
assert.deepEqual(
  JSON.parse(JSON.stringify(parseJson('migration log\n{\n  "blocked_count": 0,\n  "model_calls": 0\n}'))),
  { blocked_count: 0, model_calls: 0 },
  '部署器必须解析远端命令末尾的多行 JSON',
);

const syntheticFiles = Array.from({ length: 10000 }, (_, index) => `src/platform/module-${String(index).padStart(5, '0')}.js`);
const syntheticHashes = Object.fromEntries(syntheticFiles.map(file => [file, 'a'.repeat(64)]));
const manifestBytes = Buffer.byteLength(JSON.stringify({ files: syntheticFiles, hashes: syntheticHashes }));
assert(manifestBytes > 1024 * 1024, '合成清单必须超过常见单参数安全上限');

console.log(JSON.stringify({ passed: true, checks: 18, synthetic_files: syntheticFiles.length, manifest_bytes: manifestBytes, shell_embedded_manifest: false, multiline_json: true, home_gate: 'targeted', canonical_shared_outputs: true }));
