'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const planner = require('./lib/storyAdReleaseGatePlanner');

const root = path.resolve(__dirname, '..');
const routeFile = path.join(root, 'src/routes/newStoryAd.js');
const source = fs.readFileSync(routeFile, 'utf8');
const taskUpdateSource = fs.readFileSync(path.join(root, 'src/routes/newStoryAd/taskUpdateRoute.js'), 'utf8');
const lines = source.replace(/\r?\n$/, '').split(/\r?\n/).length;

const fullGates = planner.gateIdsForProfile('full');
assert(fullGates.includes('systemic'),
  'full 候选发布必须包含 systemic 门禁，不能只跑UI、剧情和release_core');
const fullPlatformGates = planner.gateIdsForProfile('full', { fullPlatform: true });
assert(fullPlatformGates.includes('systemic'),
  '显式全平台发布同样不能绕过 systemic 门禁');

assert(lines <= 2134,
  `src/routes/newStoryAd.js 为 ${lines} 行，超过冻结上限2134；新增能力必须拆模块而非放宽边界`);

function routeMatches(value) {
  return [...value.matchAll(/router\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g)]
    .map(match => ({ index: match.index, signature: `${match[1].toUpperCase()} ${match[2]}` }));
}
const rootRoutes = routeMatches(source);
const taskUpdateRoutes = routeMatches(taskUpdateSource);
assert.deepEqual(taskUpdateRoutes.map(item => item.signature), ['PUT /tasks/:id'],
  '独立任务更新模块必须且只能注册一次 PUT /tasks/:id');
assert.equal(rootRoutes.some(item => item.signature === 'PUT /tasks/:id'), false,
  '根路由不得重复注册已抽取的 PUT /tasks/:id');
const registrationIndex = source.indexOf('registerTaskUpdateRoute(router');
assert(registrationIndex >= 0, '根路由必须在原顺序位置注册任务更新模块');
const beforeRegistration = rootRoutes.filter(item => item.index < registrationIndex).map(item => item.signature);
const afterRegistration = rootRoutes.filter(item => item.index > registrationIndex).map(item => item.signature);
const routeSignatures = [
  ...beforeRegistration,
  ...taskUpdateRoutes.map(item => item.signature),
  ...afterRegistration,
];
assert.equal(routeSignatures.length, 82, '拆模块不得丢失或重复根路由注册');
assert.equal(
  crypto.createHash('sha256').update(JSON.stringify(routeSignatures)).digest('hex'),
  '82a420099957166c91f9ec6a312db13ada54e0bc31dcb6baba29a4fe4efd47cd',
  '拆模块前后根路由方法、路径及注册顺序必须保持一致',
);

const router = require('../src/routes/newStoryAd');
['buildActorDescription', 'buildActorViewPrompt', 'buildActorSheetPrompt'].forEach(name => {
  assert.equal(typeof router[name], 'function', `拆模块后必须保留既有 ${name} 测试/调用合同`);
});
const actor = router.buildActorDescription({
  brief: '成年女性产品展示',
  spec: { gender: 'female', age: '25~35岁', appearanceText: '自然写实面部' },
});
assert.match(actor, /25~35|成年/, '人物提示委托拆分后不得丢失年龄语义');
assert.match(router.buildActorSheetPrompt(actor), /front|正面/i,
  '人物图集提示委托拆分后必须保留正面视图合同');

console.log(JSON.stringify({
  passed: true,
  full_gates: fullGates,
  full_platform_gates: fullPlatformGates,
  route_lines: lines,
  root_route_count: routeSignatures.length,
  route_signature_sha256: '82a420099957166c91f9ec6a312db13ada54e0bc31dcb6baba29a4fe4efd47cd',
}));
