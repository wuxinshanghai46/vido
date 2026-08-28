'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const zlib = require('zlib');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-kb-policy-perf-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_KB_POLICY_CACHE_TTL_MS = '300000';

const compiler = require('../src/services/newStoryAd/knowledgePolicyCompilerService');
const knowledgeBase = require('../src/services/knowledgeBaseService');
const root = path.resolve(__dirname, '..');

function runtimeDoc(id, rule) {
  return { id: `doc-${id}`, title: id, enabled: true, runtime_policy: { schema_version: 1, rules: [rule] } };
}

function percentile(values, ratio) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
}

function initialFrontendBudget() {
  const files = [
    'public/story-ad/index.html',
    'public/story-ad/app.js',
    'public/story-ad/api.js',
    'public/story-ad/store/projectStore.js',
    'public/story-ad/components/ui.js',
    'public/story-ad/styles.css',
    'public/story-ad/workspace.css',
    'public/story-ad/reference-progress.css',
    'public/js/vido-theme.js',
    'public/js/media-delivery.js',
  ];
  return files.reduce((totals, file) => {
    const buffer = fs.readFileSync(path.join(root, file));
    totals.raw += buffer.length;
    totals.gzip += zlib.gzipSync(buffer).length;
    return totals;
  }, { raw: 0, gzip: 0, requests: files.length });
}

function testConflictAndQaIsolation() {
  const docs = [
    runtimeDoc('active', {
      id: 'active-rule', version: 1, status: 'active', priority: 10, enforcement: 'hard', conflict_key: 'same',
      stages: ['keyframe'], asset_types: ['shot'], instruction: 'active instruction', negative: 'active negative', qa_checks: ['active qa'],
    }),
    runtimeDoc('shadow', {
      id: 'shadow-rule', version: 1, status: 'shadow', priority: 99, enforcement: 'hard', conflict_key: 'same',
      stages: ['keyframe'], asset_types: ['shot'], instruction: 'shadow instruction', negative: 'shadow negative', qa_checks: ['shadow qa'],
    }),
    runtimeDoc('qa', {
      id: 'qa-rule', version: 1, status: 'active', priority: 20, enforcement: 'qa_only', conflict_key: 'qa',
      stages: ['keyframe'], asset_types: ['shot'], instruction: 'must not enter generation', negative: 'must not enter generation negative', qa_checks: ['qa-only visible evidence'],
    }),
  ];
  const policy = compiler.compile({ stage: 'keyframe', assetType: 'shot' }, { docs });
  assert(policy.rule_ids.includes('active-rule@1'), 'shadow 规则不得压掉 active 规则');
  assert(policy.shadow_rule_ids.includes('shadow-rule@1'));
  assert(!policy.prompt_block.includes('shadow instruction'));
  assert(!policy.prompt_block.includes('must not enter generation'));
  assert(!policy.negative_constraints.includes('must not enter generation negative'), 'qa_only 不得进入生成负面词');
  assert(policy.qa_checks.includes('qa-only visible evidence'));
}

function testBoundedBudget() {
  const docs = Array.from({ length: 20 }, (_, index) => runtimeDoc(`budget-${index}`, {
    id: `budget-${index}`, version: 1, status: 'active', priority: 100 - index, enforcement: 'hard', conflict_key: `budget-${index}`,
    stages: ['scene_asset'], asset_types: ['scene'], instruction: `bounded-${index} ${'x'.repeat(700)}`,
  }));
  const policy = compiler.compile({
    stage: 'scene_asset', assetType: 'scene', budget: { hard: Number.MAX_SAFE_INTEGER, soft: Number.MAX_SAFE_INTEGER, negative: Number.MAX_SAFE_INTEGER, qa: Number.MAX_SAFE_INTEGER },
  }, { docs });
  const promptAddition = policy.prompt_block.length + policy.negative_constraints.join('; ').length;
  assert(promptAddition <= 1500, `调用方不得绕过提示词预算：${promptAddition}`);
}

function testIndustryNeutralityAndPerformance() {
  knowledgeBase.ensureSeeded();
  compiler.clearCache();
  const startupStarted = performance.now();
  const base = compiler.compile({ stage: 'scene_asset', assetType: 'scene', providerId: 'generic', modelId: 'generic-image' });
  const startupMs = performance.now() - startupStarted;
  assert(base.rule_ids.length > 0, '生产知识规则必须可编译');
  const industries = ['零售', '工业制造', '教育', '医疗科普', '房地产', '旅游', '餐饮', '非行业抽象叙事'];
  const fingerprints = industries.map(industry => compiler.compile({
    stage: 'scene_asset', assetType: 'scene', providerId: 'generic', modelId: 'generic-image', industry,
  }).fingerprint);
  assert.strictEqual(new Set(fingerprints).size, 1, '行业字段不得改变通用规则选择');
  industries.forEach(industry => assert(!base.prompt_block.includes(industry), `通用规则不得写死行业：${industry}`));

  const coldTimings = [];
  for (let index = 0; index < 20; index += 1) {
    compiler.clearCache();
    const started = performance.now();
    compiler.compile({ stage: 'scene_asset', assetType: 'scene', providerId: 'generic', modelId: 'generic-image' });
    coldTimings.push(performance.now() - started);
  }
  const coldP95 = percentile(coldTimings, 0.95);

  const timings = [];
  for (let index = 0; index < 1000; index += 1) {
    const started = performance.now();
    const value = compiler.compile({ stage: 'scene_asset', assetType: 'scene', providerId: 'generic', modelId: 'generic-image' });
    timings.push(performance.now() - started);
    assert.strictEqual(value.fingerprint, base.fingerprint);
    assert.strictEqual(value.cache_hit, true);
  }
  const warmP95 = percentile(timings, 0.95);
  assert(startupMs <= 5000, `首次知识源初始化 ${startupMs.toFixed(3)}ms 超过 5000ms`);
  assert(coldP95 <= 50, `知识规则冷缓存刷新 P95 ${coldP95.toFixed(3)}ms 超过 50ms`);
  assert(warmP95 <= 10, `知识规则热编译 P95 ${warmP95.toFixed(3)}ms 超过 10ms`);
  return { startupMs, coldP95, warmP95 };
}

function testNoModelOrFrontendCost() {
  const source = fs.readFileSync(path.join(root, 'src/services/newStoryAd/knowledgePolicyCompilerService.js'), 'utf8');
  assert(!/mediaAdapter|modelGateway|generateImage|generateVideo|axios|\bfetch\s*\(/.test(source), '知识编译器不得触发模型或网络调用');
  const budget = initialFrontendBudget();
  assert(budget.requests === 10, `剧情广告首屏请求集合发生变化：${budget.requests}`);
  assert(budget.gzip <= 50 * 1024, `剧情广告首屏 gzip ${budget.gzip} 超过 50KiB`);
  const indexSource = fs.readFileSync(path.join(root, 'public/story-ad/index.html'), 'utf8');
  const workflowSource = fs.readFileSync(path.join(root, 'public/story-ad/views/workflowView.js'), 'utf8');
  assert(!indexSource.includes('/story-ad/workflow.css'), '工作流样式不得回到剧情广告首屏');
  assert(workflowSource.includes("href: '/story-ad/workflow.css"), '进入工作流时必须按需加载工作流样式');
  const summary = compiler.compactSummary(compiler.compile({ stage: 'video', assetType: 'shot' }));
  assert(Buffer.byteLength(JSON.stringify(summary)) <= 2048, '策略摘要不得拖大轮询或项目载荷');
  return budget;
}

function main() {
  try {
    testConflictAndQaIsolation();
    testBoundedBudget();
    const performanceResult = testIndustryNeutralityAndPerformance();
    const frontend = testNoModelOrFrontendCost();
    console.log(JSON.stringify({
      passed: true,
      startup_compile_ms: Number(performanceResult.startupMs.toFixed(3)),
      cold_compile_p95_ms: Number(performanceResult.coldP95.toFixed(3)),
      warm_compile_p95_ms: Number(performanceResult.warmP95.toFixed(3)),
      frontend_gzip_bytes: frontend.gzip,
      frontend_requests: frontend.requests,
      real_model_calls: 0,
    }));
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

main();
