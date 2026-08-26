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
const billingRoutesSource = fs.readFileSync(path.join(root, 'src/routes/newStoryAd/visualAssetBillingRoutes.js'), 'utf8');
const personPlanRoutesSource = fs.readFileSync(path.join(root, 'src/routes/newStoryAd/personPlanGenerationRoute.js'), 'utf8');
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
const billingRoutes = routeMatches(billingRoutesSource);
const personPlanRoutes = routeMatches(personPlanRoutesSource);
assert.deepEqual(taskUpdateRoutes.map(item => item.signature), ['PUT /tasks/:id'],
  '独立任务更新模块必须且只能注册一次 PUT /tasks/:id');
assert.equal(rootRoutes.some(item => item.signature === 'PUT /tasks/:id'), false,
  '根路由不得重复注册已抽取的 PUT /tasks/:id');
assert.deepEqual(billingRoutes.map(item => item.signature), [
  'POST /tasks/:id/visual-assets/retry-authorization',
  'POST /tasks/:id/visual-assets/retry-authorizations',
  'GET /tasks/:id/visual-assets/billing-reviews',
  'POST /tasks/:id/subject-recovery-preflight',
], '核账路由模块必须保留授权、只读核账及安全预检的精确顺序');
const registrations = [
  { index: source.indexOf('registerTaskUpdateRoute(router'), routes: taskUpdateRoutes },
  { index: source.indexOf('registerVisualAssetBillingRoutes(router'), routes: billingRoutes },
  { index: source.indexOf('registerPersonPlanGenerationRoute(router'), routes: personPlanRoutes },
].sort((a, b) => a.index - b.index);
assert(registrations.every(item => item.index >= 0), '根路由必须在原顺序位置注册独立路由模块');
const routeSignatures = [];
let cursor = -1;
for (const registration of registrations) {
  routeSignatures.push(...rootRoutes.filter(item => item.index > cursor && item.index < registration.index).map(item => item.signature));
  routeSignatures.push(...registration.routes.map(item => item.signature));
  cursor = registration.index;
}
routeSignatures.push(...rootRoutes.filter(item => item.index > cursor).map(item => item.signature));
assert.equal(routeSignatures.length, 88,
  '当前 88 个权威路由必须包含参考链接重新导入与逐场景提示词确认，不能丢失或重复其它路由');
assert.equal(routeSignatures.filter(value => value === 'POST /tasks/:id/scene-prompts/:sceneId/confirm').length, 1,
  '逐场景提示词确认路由必须且只能注册一次');
assert.equal(routeSignatures.filter(value => value === 'POST /reference-video-analyses/:analysisId/reimport').length, 1,
  '超大参考链接恢复入口必须且只能注册一次');
const singleRetry = 'POST /tasks/:id/visual-assets/retry-authorization';
const batchRetry = 'POST /tasks/:id/visual-assets/retry-authorizations';
const billingReviews = 'GET /tasks/:id/visual-assets/billing-reviews';
const recoveryPreflight = 'POST /tasks/:id/subject-recovery-preflight';
assert.equal(routeSignatures.filter(value => value === batchRetry).length, 1,
  '批量计费授权路由必须且只能注册一次');
assert.equal(routeSignatures.indexOf(batchRetry), routeSignatures.indexOf(singleRetry) + 1,
  '批量授权必须紧随兼容的单项授权路由，不能改变既有匹配顺序');
assert.equal(routeSignatures.indexOf(billingReviews), routeSignatures.indexOf(batchRetry) + 1,
  '只读核账查询必须继续位于两个授权路由之后');
assert.equal(routeSignatures.indexOf(recoveryPreflight), routeSignatures.indexOf(billingReviews) + 1,
  '恢复安全预检必须位于核账查询之后且只能注册一次');
assert.equal(routeSignatures.filter(value => value === 'POST /tasks/:id/production-assets/plan').length, 1,
  '统一制作图谱调用计划路由必须且只能注册一次');
assert.equal(routeSignatures.filter(value => value === 'POST /tasks/:id/production-assets').length, 1,
  '统一制作图谱执行路由必须且只能注册一次');
assert.equal(
  crypto.createHash('sha256').update(JSON.stringify(routeSignatures)).digest('hex'),
  'a9923d4f0b10aef101728252c217fd31318be379c20609231c556bc0ac3ae94a',
  '当前合并路由方法、路径及注册顺序必须与审计签名一致',
);

const batchRouteStart = billingRoutesSource.indexOf("router.post('/tasks/:id/visual-assets/retry-authorizations'");
const batchRouteEnd = billingRoutesSource.indexOf("router.get('/tasks/:id/visual-assets/billing-reviews'", batchRouteStart);
assert(batchRouteStart >= 0 && batchRouteEnd > batchRouteStart, '必须能隔离批量授权路由实现');
const batchRouteSource = billingRoutesSource.slice(batchRouteStart, batchRouteEnd);
assert.equal((batchRouteSource.match(/taskForReq\(req\)/g) || []).length, 1,
  '批量授权写路由必须先执行任务所有权/访问权限校验');
assert.equal((batchRouteSource.match(/authorizeTaskRetryBatch\(/g) || []).length, 1,
  '批量路由只能调用一次原子服务入口，不能在路由逐项写入');
assert.match(batchRouteSource, /expected_review_revisions[\s\S]*expectedReviewRevisions/,
  '批量授权必须传递客户端所见的核账 revisions 以执行并发校验');
assert.match(billingRoutesSource, /userFromReq\(req\)[\s\S]*acceptedBy:/,
  '授权审计身份必须来自服务端鉴权用户，不能相信客户端 reviewer');
assert.match(billingRoutesSource, /accept_duplicate_charge_risk\s*===\s*true[\s\S]*acceptDuplicateChargeRisk\s*===\s*true/,
  '重复计费风险必须是显式布尔 true，不能接受真值字符串');
const billingAuthorizationSource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/visualAssetBillingAuthorizationService.js'), 'utf8');
assert.match(billingAuthorizationSource, /function authorizeTaskRetryBatch[\s\S]*withWriteBatch\(/,
  '批量授权服务必须进入原子写批次');
const billingRetryUiSource = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterBillingRetry.js'), 'utf8');
assert.match(billingRetryUiSource, /visual-assets\/retry-authorizations/,
  '一次确认多个风险单元的真实 UI 必须使用新增批量端点，证明该路由确有必要');

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
  route_signature_sha256: 'a9923d4f0b10aef101728252c217fd31318be379c20609231c556bc0ac3ae94a',
}));
