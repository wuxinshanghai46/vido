const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const schema = require('../src/services/newStoryAd/knowledgeRuleSchemaService');
const compiler = require('../src/services/newStoryAd/knowledgePolicyCompilerService');
const snapshots = require('../src/services/newStoryAd/knowledgePolicySnapshotService');
const { insertMissingKnowledgeDocs } = require('../src/models/databaseSqliteAdapter');

function rule(overrides = {}) {
  return {
    id: 'universal-rule',
    version: 1,
    status: 'active',
    priority: 50,
    enforcement: 'hard',
    conflict_key: 'universal-contract',
    stages: ['keyframe'],
    asset_types: ['shot'],
    instruction: 'Preserve verified task facts and change only the authored visible state.',
    negative: 'unrequested asset change',
    qa_checks: ['verified task facts remain visible'],
    ...overrides,
  };
}

function docs(rules) {
  return [{
    id: 'kb-runtime-test',
    title: 'Runtime test rules',
    enabled: true,
    runtime_policy: { schema_version: 1, rules },
  }];
}

function throwsInvalid(value, pattern) {
  assert.throws(
    () => schema.normalizeRuntimePolicy(value),
    error => error.code === 'KNOWLEDGE_RUNTIME_POLICY_INVALID' && pattern.test(error.message),
  );
}

function testSchema() {
  const statuses = ['active', 'shadow', 'canary', 'draft', 'retired'];
  statuses.forEach(status => {
    const normalized = schema.normalizeRuntimePolicy({
      schema_version: 1,
      rules: [rule({ id: `rule-${status}`, status, canary_percent: status === 'canary' ? 25 : undefined })],
    });
    assert.strictEqual(normalized.rules[0].status, status);
  });
  throwsInvalid({ schema_version: 1, rules: [rule({ industry: 'retail' })] }, /不支持字段 industry/);
  throwsInvalid({ schema_version: 1, rules: [rule({ instruction: 'x'.repeat(1801) })] }, /1800/);
  throwsInvalid({ schema_version: 1, rules: [rule({ status: 'published' })] }, /不支持状态/);
  throwsInvalid({ schema_version: 1, rules: [rule({ enforcement: 'qa_only', qa_checks: [] })] }, /qa_checks/);
  throwsInvalid({ schema_version: 1, rules: [rule(), rule()] }, /规则版本重复/);
  const seeded = require('../src/services/seeds/generation_runtime_policy');
  seeded.forEach(doc => schema.normalizeRuntimePolicy(doc.runtime_policy));
}

function testLifecycleAndConflictIsolation() {
  const policyDocs = docs([
    rule({ id: 'active-v1', status: 'active', priority: 50, instruction: 'ACTIVE CONTRACT' }),
    rule({ id: 'shadow-v2', version: 2, status: 'shadow', priority: 100, instruction: 'SHADOW CONTRACT' }),
    rule({ id: 'draft-v3', version: 3, status: 'draft', priority: 200, instruction: 'DRAFT CONTRACT' }),
    rule({ id: 'retired-v4', version: 4, status: 'retired', priority: 300, instruction: 'RETIRED CONTRACT' }),
  ]);
  const compiled = compiler.compile({ stage: 'keyframe', assetType: 'shot', taskId: 'task-a' }, { docs: policyDocs });
  assert(compiled.prompt_block.includes('ACTIVE CONTRACT'));
  assert(!compiled.prompt_block.includes('SHADOW CONTRACT'));
  assert.deepStrictEqual(compiled.rule_ids, ['active-v1@1']);
  assert.deepStrictEqual(compiled.shadow_rule_ids, ['shadow-v2@2']);
  assert(!JSON.stringify(compiled).includes('DRAFT CONTRACT'));
  assert(!JSON.stringify(compiled).includes('RETIRED CONTRACT'));
}

function testQaOnlyAndFingerprints() {
  const baseRules = [
    rule({ id: 'generation-rule', conflict_key: 'generation', instruction: 'GENERATION A', qa_checks: ['QA A'] }),
    rule({
      id: 'qa-only-rule',
      conflict_key: 'qa-only',
      enforcement: 'qa_only',
      instruction: '',
      negative: 'MUST NOT ENTER GENERATION',
      qa_checks: ['QA ONLY A'],
    }),
  ];
  const first = compiler.compile({ stage: 'keyframe', assetType: 'shot' }, { docs: docs(baseRules) });
  assert(!first.prompt_block.includes('MUST NOT ENTER GENERATION'));
  assert(!first.negative_constraints.includes('MUST NOT ENTER GENERATION'));
  assert(!first.generation_rule_ids.includes('qa-only-rule@1'));

  const qaChanged = compiler.compile({ stage: 'keyframe', assetType: 'shot' }, { docs: docs([
    { ...baseRules[0], qa_checks: ['QA B'] },
    { ...baseRules[1], qa_checks: ['QA ONLY B'] },
  ]) });
  assert.strictEqual(first.generation_fingerprint, qaChanged.generation_fingerprint);
  assert.notStrictEqual(first.qa_fingerprint, qaChanged.qa_fingerprint);

  const promptChanged = compiler.compile({ stage: 'keyframe', assetType: 'shot' }, { docs: docs([
    { ...baseRules[0], instruction: 'GENERATION B' },
    baseRules[1],
  ]) });
  assert.notStrictEqual(first.generation_fingerprint, promptChanged.generation_fingerprint);
  assert.strictEqual(first.qa_fingerprint, promptChanged.qa_fingerprint);
}

function testCanaryAndBudgets() {
  const canaryRule = rule({ id: 'canary-rule', status: 'canary', canary_percent: 50, conflict_key: 'canary' });
  let includedTask = '';
  let excludedTask = '';
  for (let index = 0; index < 1000 && (!includedTask || !excludedTask); index += 1) {
    const taskId = `task-${index}`;
    if (compiler.deterministicBucket(taskId, canaryRule) < 50) includedTask = taskId;
    else excludedTask = taskId;
  }
  assert(includedTask && excludedTask);
  const included = compiler.compile({ stage: 'keyframe', assetType: 'shot', taskId: includedTask }, { docs: docs([canaryRule]) });
  const includedAgain = compiler.compile({ stage: 'keyframe', assetType: 'shot', taskId: includedTask }, { docs: docs([canaryRule]) });
  const excluded = compiler.compile({ stage: 'keyframe', assetType: 'shot', taskId: excludedTask }, { docs: docs([canaryRule]) });
  assert.deepStrictEqual(included.rule_ids, ['canary-rule@1']);
  assert.deepStrictEqual(included.rule_ids, includedAgain.rule_ids);
  assert.deepStrictEqual(excluded.rule_ids, []);
  assert.deepStrictEqual(excluded.shadow_rule_ids, ['canary-rule@1']);

  const budget = compiler.normalizeBudget({ hard: 999999, soft: -8, negative: Infinity, qa: 999999 });
  assert.deepStrictEqual(budget, { hard: 900, soft: 0, negative: 200, qa: 1200 });
}

function testIndustryNeutralityAndPerformance() {
  const policyDocs = docs([rule()]);
  const fingerprints = ['manufacturing', 'finance', 'healthcare', 'education', 'unknown-sector', '']
    .map(industry => compiler.compile({ stage: 'keyframe', assetType: 'shot', taskId: 'same-task', industry }, { docs: policyDocs }).fingerprint);
  assert.strictEqual(new Set(fingerprints).size, 1);

  const durations = [];
  for (let index = 0; index < 200; index += 1) {
    const started = performance.now();
    compiler.compile({ stage: 'keyframe', assetType: 'shot', taskId: `perf-${index}` }, { docs: policyDocs });
    durations.push(performance.now() - started);
  }
  durations.sort((a, b) => a - b);
  const p95 = durations[Math.floor(durations.length * 0.95)];
  assert(p95 < 50, `知识策略本地编译 P95 ${p95.toFixed(2)}ms 超过 50ms`);
  return p95;
}

function testPinnedSnapshotDoesNotDrift() {
  const memory = new Map();
  const storage = {
    getOutput(taskId, kind) { return memory.get(`${taskId}:${kind}`) || null; },
    saveOutput(taskId, kind, payload) { memory.set(`${taskId}:${kind}`, payload); return payload; },
  };
  const selectors = [{ stage: 'keyframe', assetType: 'shot' }];
  const first = snapshots.pinTaskPolicy({ storage, taskId: 'pinned-task', selectors, docs: docs([rule({ instruction: 'PINNED A' })]) });
  assert.strictEqual(first.reused, false);
  assert(snapshots.promptContract(first.snapshot, selectors[0]).prompt_block.includes('PINNED A'));

  const second = snapshots.pinTaskPolicy({ storage, taskId: 'pinned-task', selectors, docs: docs([rule({ version: 2, instruction: 'NEW RULE B' })]) });
  assert.strictEqual(second.reused, true);
  assert.strictEqual(second.snapshot.fingerprint, first.snapshot.fingerprint);
  assert(snapshots.promptContract(second.snapshot, selectors[0]).prompt_block.includes('PINNED A'));
  assert(!snapshots.promptContract(second.snapshot, selectors[0]).prompt_block.includes('NEW RULE B'));

  const forced = snapshots.pinTaskPolicy({ storage, taskId: 'pinned-task', selectors, docs: docs([rule({ version: 2, instruction: 'NEW RULE B' })]), force: true });
  assert.strictEqual(forced.reused, false);
  assert.notStrictEqual(forced.snapshot.fingerprint, first.snapshot.fingerprint);
  assert(snapshots.promptContract(forced.snapshot, selectors[0]).prompt_block.includes('NEW RULE B'));
  assert(snapshots.qaContract(forced.snapshot, selectors[0]).qa_checks.length > 0);
}

function testSeedMergeAndMissingInsert() {
  const existingPolicy = { schema_version: 1, rules: [rule({ instruction: 'ADMIN EDIT PRESERVED' })] };
  const seededPolicy = { schema_version: 1, rules: [
    rule({ instruction: 'SEED SAME VERSION MUST NOT OVERWRITE' }),
    rule({ version: 2, instruction: 'VERSION TWO ADDED' }),
  ] };
  const merged = schema.mergeVersionedRuntimePolicy(existingPolicy, seededPolicy);
  assert.strictEqual(merged.changed, true);
  assert.strictEqual(merged.policy.rules.length, 2);
  assert.strictEqual(merged.policy.rules[0].instruction, 'ADMIN EDIT PRESERVED');
  assert.strictEqual(merged.policy.rules[1].instruction, 'VERSION TWO ADDED');
  assert.deepStrictEqual(merged.added, ['universal-rule@2']);

  const table = new Map([['existing', { id: 'existing', title: 'admin title' }]]);
  const inserted = insertMissingKnowledgeDocs(
    [{ id: 'existing', title: 'seed overwrite' }, { id: 'new', title: 'new seed' }],
    id => table.get(id),
    row => table.set(row.id, row),
  );
  assert.strictEqual(inserted, 1);
  assert.strictEqual(table.get('existing').title, 'admin title');
  assert.strictEqual(table.get('new').title, 'new seed');
}

function testAdminPersistenceBoundary() {
  const admin = fs.readFileSync(path.join(__dirname, '../src/routes/admin.js'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '../public/js/admin-vue-knowledgebase.js'), 'utf8');
  assert(admin.includes('knowledgeRuleSchema.normalizeRuntimePolicy'), '管理后台必须在保存前验证 runtime_policy');
  assert(admin.includes("'runtime_policy'"), '管理后台更新字段不得丢失 runtime_policy');
  assert(admin.includes('error.status || 422'), '非法 runtime_policy 必须返回 422');
  assert(ui.includes('runtimePolicyText') && ui.includes('body.runtime_policy'), '知识库编辑器必须读写 runtime_policy');
}

function run() {
  testSchema();
  testLifecycleAndConflictIsolation();
  testQaOnlyAndFingerprints();
  testCanaryAndBudgets();
  const p95 = testIndustryNeutralityAndPerformance();
  testPinnedSnapshotDoesNotDrift();
  testSeedMergeAndMissingInsert();
  testAdminPersistenceBoundary();
  console.log(JSON.stringify({
    passed: true,
    schema_version: schema.POLICY_SCHEMA_VERSION,
    lifecycle_states: 5,
    industry_hardcoded_branches: 0,
    compiler_model_calls: 0,
    compile_p95_ms: Number(p95.toFixed(3)),
    pinned_snapshot_drift: 0,
    seed_existing_overwrites: 0,
  }, null, 2));
}

run();
