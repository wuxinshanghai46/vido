'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const view = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterView.js'), 'utf8');
assert.match(view, /import\s*\{[^}]*bindSubjectBillingRecovery[^}]*\}\s*from\s*['"]\.\/assetCenterBillingRetry\.js/,
  '资产中心必须通过真实模块依赖导入计费恢复绑定器');
assert.equal((view.match(/bindSubjectBillingRecovery\(\{\s*host,\s*bundle,\s*store,\s*checkpointRecovery,\s*generate\s*\}\)/g) || []).length, 1,
  '资产中心 mount 必须且只能绑定一次计费恢复状态机');

const scriptsDir = path.join(root, 'scripts');
const mountHarnesses = fs.readdirSync(scriptsDir).filter(name => name.endsWith('.js')).filter(name => {
  const source = fs.readFileSync(path.join(scriptsDir, name), 'utf8');
  return source.includes('assetCenterView.js') && /globalThis\.__tested\s*=\s*\{\s*mount\s*\}/.test(source);
});
assert.deepEqual(mountHarnesses, ['test-story-ad-product-entry-taxonomy-v64.js'],
  '新增执行 assetCenterView.mount 的 VM harness 必须显式进入依赖合同审计');
for (const name of mountHarnesses) {
  const source = fs.readFileSync(path.join(scriptsDir, name), 'utf8');
  assert.match(source, /bindSubjectBillingRecovery\s*\([^)]*\)\s*\{/,
    `${name} 剥离 import 后必须注入可观察的计费恢复绑定器，不能吞掉真实绑定`);
  assert.match(source, /billingRecoveryBindings\.length/,
    `${name} 必须断言 mount 最终执行了恢复绑定，不能只提供空桩`);
}

console.log(JSON.stringify({ passed: true, production_bindings: 1, vm_mount_harnesses: mountHarnesses.length }));
