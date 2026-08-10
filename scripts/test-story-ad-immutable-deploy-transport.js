'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, 'deploy-story-ad-immutable-release.js'), 'utf8');

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

console.log(JSON.stringify({ passed: true, checks: 13, synthetic_files: syntheticFiles.length, manifest_bytes: manifestBytes, shell_embedded_manifest: false, multiline_json: true, home_gate: 'targeted' }));
