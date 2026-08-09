#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-platform-v111-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const topology = require('../src/services/newStoryAd/narrativeTopologyCompilerService');
const coverage = require('../src/services/newStoryAd/storySceneCoverageService');
const pipeline = require('../src/services/pipelineModelService');
const gateway = require('../src/services/newStoryAd/modelGateway');
const storage = require('../src/services/newStoryAd/storageService');
const publication = require('../src/services/newStoryAd/assetPlanPublicationService');
const permit = require('../src/services/newStoryAd/generationPermitService');
const releaseBundle = require('../src/services/storyAdReleaseBundleService');
const releaseFiles = require('./lib/storyAdReleaseFiles');

function relation(era, time, location, environment) {
  return { era, time, location, environment };
}

function beat(id, phase, timeAnchor, location, productionState, productionRelation) {
  return {
    id,
    phase,
    era: '当代',
    time_anchor: timeAnchor,
    location,
    production_state: productionState,
    summary: `${id}发生并推动下一步`,
    cause: `${id}的前因`,
    consequence: `${id}的后果`,
    production_relation: productionRelation,
  };
}

function storyFacts() {
  return {
    logline: '人物在连续行动中解决冲突。',
    opening: '建立目标。',
    development: '行动推进。',
    turning_point: '关键变化。',
    resolution: '结果回收。',
    plot_beats: [
      beat('beat_1', 'opening', '上午九点', '客厅', '相同陈设与相同光线', relation('changed', 'changed', 'changed', 'changed')),
      beat('beat_2', 'development', '上午九点零五分', '家中客厅', '相同光线和相同陈设', relation('same', 'continuous', 'same', 'same')),
      beat('beat_3', 'development', '片刻后', '客厅', '人物继续交谈', relation('same', 'continuous', 'same', 'continuous')),
      beat('beat_4', 'turning_point', '当天中午', '室外广场', '强烈正午日光', relation('same', 'changed', 'changed', 'changed')),
      beat('beat_5', 'development', '中午稍后', '广场', '同一布景与光线', relation('same', 'continuous', 'same', 'same')),
      beat('beat_6', 'resolution', '傍晚', '广场', '灯光开启且布景改变', relation('same', 'changed', 'same', 'changed')),
    ],
  };
}

function context() {
  return {
    content_mode: 'narrative_story',
    product_presentation: { mode: 'narrative_story' },
    story_scene_contract_version: coverage.CONTRACT_VERSION,
    target_duration: 30,
    shot_count: 6,
  };
}

function matrixFacts(caseIndex, count) {
  const topics = ['职场', '家庭', '爱情', '悬疑', '历史', '科幻', '奇幻', '儿童', '体育', '旅行', '公益', '环境叙事'];
  const topic = topics[caseIndex % topics.length];
  return {
    logline: `${topic}题材的通用平台合同样本`,
    opening: '建立目标。', development: '行动推进。', turning_point: '关键变化。', resolution: '结果回收。',
    plot_beats: Array.from({ length: count }, (_, index) => {
      const phase = index === 0 ? 'opening' : (index === count - 2 ? 'turning_point' : (index === count - 1 ? 'resolution' : 'development'));
      const changed = index === 0 || index % 3 === 0;
      return beat(
        `case_${caseIndex}_beat_${index + 1}`,
        phase,
        `相对时间${index + 1}`,
        `地点${Math.floor(index / 3) + 1}`,
        `制作状态${Math.floor(index / 3) + 1}`,
        index === 0 ? relation('changed', 'changed', 'changed', 'changed')
          : (changed ? relation('same', 'changed', 'changed', 'changed') : relation('same', 'continuous', 'same', 'same')),
      );
    }),
  };
}

async function main() {
  const facts = storyFacts();
  const compiled = topology.compileAssetPlan({ story_seed: facts });
  const beats = compiled.story_seed.plot_beats;
  assert.equal(compiled.scene_plan.spaces.length, 3, '只有真实制作条件变化才应拆场');
  assert.equal(beats[0].production_scene_key, beats[1].production_scene_key, '同地点轻微时间推进不得误拆场');
  assert.equal(beats[1].production_scene_key, beats[2].production_scene_key, '同义环境描述不得误拆场');
  assert.notEqual(beats[2].production_scene_key, beats[3].production_scene_key, '地点和环境真实改变必须拆场');
  assert.notEqual(beats[4].production_scene_key, beats[5].production_scene_key, '实质灯光与布景变化必须拆场');
  assert.equal(coverage.expectedProductionSceneCount(compiled.story_seed, context()), 3, '不得保留按 beat 数量凑场景的硬下限');
  assert.deepEqual(coverage.coverageIssues(compiled, context()), [], '平台编译的 beat 与 scene 必须形成精确一对一覆盖');
  assert.equal(topology.compileAssetPlan({ story_seed: facts }).story_seed.topology_hash, compiled.story_seed.topology_hash, '相同事实必须产生稳定拓扑');
  const truncated = { ...facts, plot_beats: facts.plot_beats.slice(0, 2) };
  const patched = topology.mergeStorySeedPatch(truncated, {
    story_seed_patch: {
      plot_beats_upsert: [
        { ...facts.plot_beats[1], consequence: '定向替换后的后果' },
        ...facts.plot_beats.slice(2),
      ],
    },
  });
  assert.equal(patched.plot_beats.length, facts.plot_beats.length, '截断响应必须通过小补丁补齐而不是重写整份故事');
  assert.equal(patched.plot_beats[1].consequence, '定向替换后的后果');
  assert.equal(new Set(patched.plot_beats.map(item => item.id)).size, facts.plot_beats.length, '按 beat id upsert 不得产生重复节拍');
  const repairScope = topology.buildStorySeedRepairScope(facts, [
    'story_seed.plot_beats[1].consequence_missing',
    'story_seed.plot_beats[1].production_relation_uncertain',
  ], facts.plot_beats.length);
  const scopedPatch = { story_seed_patch: { fields: {}, plot_beats_upsert: [{ ...facts.plot_beats[1], consequence: '定向修复后果' }] } };
  assert.equal(topology.mergeStorySeedPatch(facts, scopedPatch, { repair_scope: repairScope }).plot_beats[1].consequence, '定向修复后果');
  assert.throws(() => topology.mergeStorySeedPatch(facts, {
    story_seed_patch: { fields: {}, plot_beats_upsert: facts.plot_beats.slice(0, 3) },
  }, { repair_scope: repairScope }), /out_of_scope|too_many_beats/, '修复模型回传整份故事必须被平台合同阻断');

  let matrixPassed = 0;
  const durations = [15, 30, 60, 120];
  for (let caseIndex = 0; caseIndex < 40; caseIndex += 1) {
    const duration = durations[caseIndex % durations.length];
    const minimum = duration >= 120 ? 10 : (duration >= 60 ? 8 : (duration >= 30 ? 6 : 4));
    const matrixPlan = topology.compileAssetPlan({ story_seed: matrixFacts(caseIndex, minimum) });
    const matrixContext = { ...context(), target_duration: duration, shot_count: Math.min(16, minimum * 2) };
    assert.deepEqual(coverage.coverageIssues(matrixPlan, matrixContext), [], `题材矩阵 case ${caseIndex} 必须通过`);
    const covered = matrixPlan.scene_plan.spaces.flatMap(space => space.covered_beat_ids);
    assert.equal(new Set(covered).size, minimum);
    matrixPassed += 1;
  }

  let propertySamples = 0;
  for (let seed = 0; seed < 10000; seed += 1) {
    const transformed = storyFacts();
    transformed.plot_beats = transformed.plot_beats.map((item, index) => ({
      ...item,
      time_anchor: `${item.time_anchor}${seed % 2 ? ' ' : '，'}${index % 2 ? '稍后' : ''}`,
      location: seed % 3 ? item.location.replace('家中', '').trim() : ` ${item.location} `,
      production_state: index === 1 && seed % 2 ? '相同陈设、相同光线' : item.production_state,
    }));
    assert.equal(topology.compileStorySeed(transformed).topology_hash, compiled.story_seed.topology_hash, `fixed seed ${seed} 的非制作语义改写不得改变拓扑`);
    propertySamples += 1;
  }
  let metamorphicPairs = 0;
  for (let pair = 0; pair < 200; pair += 1) {
    const equivalent = storyFacts();
    equivalent.plot_beats[1] = { ...equivalent.plot_beats[1], time_anchor: `九点零${5 + (pair % 5)}分`, production_state: pair % 2 ? '相同布置及同样光照' : '原有陈设保持不变' };
    assert.equal(topology.compileStorySeed(equivalent).topology_hash, compiled.story_seed.topology_hash);
    metamorphicPairs += 1;
  }
  for (let pair = 0; pair < 200; pair += 1) {
    const changedFacts = storyFacts();
    changedFacts.plot_beats[1] = {
      ...changedFacts.plot_beats[1],
      production_relation: pair % 2
        ? relation('same', 'continuous', 'changed', 'same')
        : relation('same', 'continuous', 'same', 'changed'),
    };
    assert.notEqual(topology.compileStorySeed(changedFacts).topology_hash, compiled.story_seed.topology_hash);
    assert.equal(topology.compileScenePlan(changedFacts).spaces.length, 4, '真实制作变化必须增加独立场次');
    metamorphicPairs += 1;
  }

  const requiredStages = [
    'new_story_ad.story_facts',
    'new_story_ad.story_facts_repair',
    'new_story_ad.asset_plan_missing_sections_recovery',
    'new_story_ad.blueprint_structure_repair',
    'new_story_ad.blueprint_language_repair',
    'new_story_ad.blueprint_polish',
    'new_story_ad.storyboard_fill_missing',
    'new_story_ad.storyboard_rewrite',
    'new_story_ad.storyboard_language_repair',
    'new_story_ad.scene_config_language_repair',
    'new_story_ad.person_consistency_qa',
    'new_story_ad.scene_consistency_qa',
    'new_story_ad.video_frame_qa',
    'new_story_ad.cross_shot_visual_qa',
    'new_story_ad.person_dossier_atlas',
    'new_story_ad.person_dossier_native_master',
    'new_story_ad.person_dossier_wearable_accessory',
    'new_story_ad.person_dossier_wardrobe_detail',
    'new_story_ad.pet_dossier',
    'new_story_ad.prop_dossier_atlas',
    'new_story_ad.product_asset',
  ];
  requiredStages.forEach((stage) => {
    assert(pipeline.getStageMeta(stage), `${stage} 必须出现在模型调用管理 schema`);
    assert(pipeline.isStrictPipelineManagedStage(stage), `${stage} 必须禁止隐藏 settings fallback`);
  });
  await assert.rejects(
    () => gateway.generateText({ stage: 'new_story_ad.unregistered_platform_stage', systemPrompt: '', userPrompt: '' }),
    error => error?.code === 'MODEL_STAGE_NOT_REGISTERED',
    '未登记的新模型流程必须在供应商调用之前被拒绝',
  );

  const taskId = 'platform-v111-plan';
  storage.createTask({
    id: taskId,
    title: '平台合同测试',
    brief: facts.logline,
    content_revision: 1,
    request: context(),
    status: 'running',
    stage: 'scene_config',
  });
  storage.saveOutput(taskId, 'context', context());
  storage.saveOutput(taskId, 'asset_plan', { ...compiled, fingerprint: 'legacy-only' });
  assert.equal(publication.eligibility(taskId, { fingerprint: 'legacy-only' }).eligible, false, '旧 asset_plan 投影不得授权付费流程');
  assert.throws(() => permit.issue(taskId, 'scene_asset', { idempotencyKey: 'legacy' }), error => error?.code === 'GENERATION_ACTIVE_PLAN_REQUIRED');

  const active = publication.publish(taskId, compiled, { fingerprint: 'current-input', source: 'platform-v111-test' });
  assert.equal(active.release_envelope.producer_bundle_id, releaseBundle.identity().bundle_id, 'Active Plan 必须绑定完整 release bundle');
  const eligibility = publication.eligibility(taskId, { fingerprint: 'current-input' });
  assert.equal(eligibility.eligible, true, eligibility.issues.join(','));
  const issued = permit.issue(taskId, 'scene_asset', { idempotencyKey: 'one-paid-action' });
  assert.equal(permit.consume(taskId, issued).status, 'consumed', '合法 Active Plan 才能消费生成许可');
  storage.updateTask(taskId, { content_revision: 2, status: 'running', stage: 'scene_config' }, { systemFinalization: true });
  assert.equal(publication.eligibility(taskId, { fingerprint: 'current-input' }).eligible, false, '输入 revision 改变后旧 Active Plan 必须失效');
  const migrationRun = () => childProcess.spawnSync(process.execPath, [path.join(root, 'scripts/migrate-story-ad-platform-v111.js'), '--apply', '--task', taskId], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
  });
  const migrationFirst = migrationRun();
  assert.equal(migrationFirst.status, 0, migrationFirst.stderr || migrationFirst.stdout);
  const migrationSecond = migrationRun();
  assert.equal(migrationSecond.status, 0, migrationSecond.stderr || migrationSecond.stdout);
  assert.match(migrationSecond.stdout, /"idempotent_skip": true/, '历史迁移必须可重复执行且不重复改写');
  assert.equal(storage.getOutput(taskId, 'asset_plan_migration_v111')?.policy?.automatic_resume_forbidden, true, '历史任务不得自动续跑');

  const stateResults = {};
  function createStateTask(suffix, { publish = false, legacy = false } = {}) {
    const id = `platform-v111-state-${suffix}`;
    storage.createTask({ id, brief: facts.logline, request: context(), status: 'running', stage: 'scene_config', content_revision: 1 });
    storage.saveOutput(id, 'context', context());
    if (legacy) storage.saveOutput(id, 'asset_plan', { ...compiled, fingerprint: `fp-${suffix}` });
    if (publish) publication.publish(id, compiled, { fingerprint: `fp-${suffix}`, source: 'state-matrix' });
    return id;
  }
  const noPlanId = createStateTask('no-plan');
  stateResults.no_plan = publication.eligibility(noPlanId, { fingerprint: 'fp-no-plan' }).eligible;
  const legacyId = createStateTask('legacy', { legacy: true });
  stateResults.legacy = publication.eligibility(legacyId, { fingerprint: 'fp-legacy' }).eligible;
  const validId = createStateTask('valid', { publish: true });
  stateResults.valid = publication.eligibility(validId, { fingerprint: 'fp-valid' }).eligible;
  const planningFailedId = createStateTask('planning-failed', { publish: true });
  storage.updateTask(planningFailedId, { status: 'failed', stage: 'scene_config_failed' }, { systemFinalization: true });
  stateResults.planning_failed = publication.eligibility(planningFailedId, { fingerprint: 'fp-planning-failed' }).eligible;
  const downstreamFailedId = createStateTask('downstream-failed', { publish: true });
  storage.updateTask(downstreamFailedId, { status: 'failed', stage: 'scene_asset_failed' }, { systemFinalization: true });
  stateResults.downstream_failed = publication.eligibility(downstreamFailedId, { fingerprint: 'fp-downstream-failed' }).eligible;
  const staleInputId = createStateTask('stale-input', { publish: true });
  storage.updateTask(staleInputId, { content_revision: 2 }, { systemFinalization: true });
  stateResults.stale_input = publication.eligibility(staleInputId, { fingerprint: 'fp-stale-input' }).eligible;
  const wrongFingerprintId = createStateTask('wrong-fingerprint', { publish: true });
  stateResults.wrong_fingerprint = publication.eligibility(wrongFingerprintId, { fingerprint: 'different' }).eligible;
  const staleBundleId = createStateTask('stale-bundle', { publish: true });
  const staleBundleRecord = publication.activeRecord(staleBundleId);
  staleBundleRecord.plan.release_envelope.producer_bundle_id = 'old-bundle';
  storage.saveOutput(staleBundleId, publication.ACTIVE_KIND, staleBundleRecord);
  stateResults.stale_bundle = publication.eligibility(staleBundleId, { fingerprint: 'fp-stale-bundle' }).eligible;
  assert.deepEqual(stateResults, {
    no_plan: false,
    legacy: false,
    valid: true,
    planning_failed: false,
    downstream_failed: true,
    stale_input: false,
    wrong_fingerprint: false,
    stale_bundle: false,
  }, 'Active Plan 服务端门禁必须区分 8 种平台状态');

  const concurrentPlanIds = [];
  for (let index = 0; index < 50; index += 1) {
    const id = `platform-v111-concurrency-${index}`;
    storage.createTask({ id, brief: `${facts.logline}${index}`, request: context(), status: 'running', stage: 'scene_config', content_revision: 1 });
    storage.saveOutput(id, 'context', context());
    publication.publish(id, compiled, { fingerprint: `concurrent-${index}`, source: 'concurrency-matrix' });
    const permits = Array.from({ length: 10 }, () => permit.issue(id, 'scene_asset', { idempotencyKey: `one-action-${index}` }));
    assert.equal(new Set(permits.map(item => item.permit_id)).size, 1, '同任务重复点击必须复用同一许可');
    concurrentPlanIds.push(publication.activeRecord(id).plan_id);
  }
  assert.equal(new Set(concurrentPlanIds).size, 50, '50 个任务的 Active Plan 不得跨任务污染');

  const assetView = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterView.js'), 'utf8');
  const navigation = fs.readFileSync(path.join(root, 'src/services/storyAdWorkspace/workflowNavigationService.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'public/story-ad/components/ui.js'), 'utf8');
  assert.match(assetView, /planEligibility\.eligible === true/);
  assert.match(assetView, /paidAssetDisabled/);
  assert.match(navigation, /asset_plan_eligibility/);
  assert.doesNotMatch(ui, /已产出\s*\$\{completed\}/);

  const collected = releaseFiles.collectStoryAdReleaseFiles({ root });
  assert(collected.includes('src/services/newStoryAd/narrativeTopologyCompilerService.js'));
  assert(collected.includes('src/services/newStoryAd/generationPermitService.js'));
  assert(collected.includes('scripts/deploy-story-ad-immutable-release.js'));
  assert.equal(releaseFiles.OPAQUE_RELEASE_ROOTS?.size || 0, 0, '发布闭包不得跳过 server 或动态入口');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['story-ad:release:deploy'], 'node scripts/deploy-story-ad-immutable-release.js');
  assert(!Object.values(packageJson.scripts).some(command => /node scripts\/deploy-story-ad-release\.js/.test(command)), '旧原地发布脚本不得再成为 npm 入口');
  const runtimeManifest = JSON.parse(fs.readFileSync(path.join(root, 'config/story-ad-runtime-manifest.json'), 'utf8'));
  const releaseConfig = JSON.parse(fs.readFileSync(path.join(root, 'config/story-ad-release.json'), 'utf8'));
  const immutableDeploy = fs.readFileSync(path.join(root, 'scripts/deploy-story-ad-immutable-release.js'), 'utf8');
  const pm2Release = fs.readFileSync(path.join(root, 'scripts/story-ad-pm2-release.js'), 'utf8');
  assert.equal(runtimeManifest.node_version, releaseConfig.node_runtime.version, '发布清单必须使用固定目标 Node 版本而非构建机版本');
  assert.equal(runtimeManifest.node_runtime.sha256, releaseConfig.node_runtime.sha256, '固定 Node runtime SHA256 必须进入制品身份');
  assert.match(immutableDeploy, /sha256sum -c/);
  assert.match(immutableDeploy, /--node \$\{quote\(nodeRuntimeBin\)\}/);
  assert.match(pm2Release, /--interpreter/);
  assert.match(pm2Release, /STORY_AD_ENFORCE_NODE_RUNTIME/);
  assert(pm2Release.includes("name.startsWith('vido-candidate-')"), '启动候选前必须清理所有旧候选进程，防止端口返回旧 bundle');
  assert(immutableDeploy.includes('pm2 delete ${quote(candidateName)}'), '部署失败必须清理本轮候选进程');

  console.log(JSON.stringify({
    platform_v111: 'passed',
    topology_scenes: compiled.scene_plan.spaces.length,
    covered_beats: beats.length,
    managed_model_stages_checked: requiredStages.length,
    deterministic_topic_matrix_passed: matrixPassed,
    fixed_seed_property_samples: propertySamples,
    metamorphic_pairs: metamorphicPairs,
    active_plan_state_matrix: Object.keys(stateResults).length,
    concurrent_tasks: concurrentPlanIds.length,
    duplicate_permits: 0,
    paid_provider_calls: 0,
    release_files_checked: collected.length,
  }));
}

main().finally(() => fs.rmSync(outputDir, { recursive: true, force: true }));
