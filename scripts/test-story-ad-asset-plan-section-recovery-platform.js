#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-section-recovery-platform-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const storage = require('../src/services/newStoryAd/storageService');
const gateway = require('../src/services/newStoryAd/modelGateway');
const outputLanguage = require('../src/services/newStoryAd/outputLanguageService');
const coverage = require('../src/services/newStoryAd/storySceneCoverageService');
const sectionContract = require('../src/services/newStoryAd/assetPlanSectionRecoveryContractService');
const pipeline = require('../src/services/pipelineModelService');
const jobs = require('../src/services/newStoryAd/jobService');

const originalGenerateText = gateway.generateText;
const originalEnsureChineseOutput = outputLanguage.ensureChineseOutput;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function hash(value) {
  const serialized = JSON.stringify(canonical(value));
  return crypto.createHash('sha256').update(serialized === undefined ? '__undefined__' : serialized).digest('hex');
}

function relation(era, time, location, environment) {
  return { era, time, location, environment };
}

function beat(id, phase, timeAnchor, location, state, productionRelation) {
  return {
    id,
    phase,
    era: '当代',
    time_anchor: timeAnchor,
    location,
    production_state: state,
    production_relation: productionRelation,
    production_requirements: {
      layout: `${location}的固定布局`,
      material_light: `${state}的材质与光线`,
      interaction: '人物在可见行动区连续行动',
      negative: '禁止商品、品牌和销售引导',
    },
    summary: `${id}推动下一步行动`,
    cause: `${id}由上一步结果触发`,
    consequence: `${id}形成可见结果`,
  };
}

function storySeed() {
  return {
    logline: '一名返乡青年在旧屋中完成与过去的告别。',
    opening: '青年回到旧屋。',
    development: '青年整理旧物。',
    turning_point: '青年发现未寄出的信。',
    resolution: '青年带着信离开并开始新生活。',
    plot_beats: [
      beat('beat_1', 'opening', '清晨', '旧屋客厅', '冷色晨光与封存家具', relation('changed', 'changed', 'changed', 'changed')),
      beat('beat_2', 'development', '清晨稍后', '旧屋客厅', '相同家具与连续晨光', relation('same', 'continuous', 'same', 'same')),
      beat('beat_3', 'turning_point', '上午', '旧屋书房', '书桌抽屉打开且光线变亮', relation('same', 'changed', 'changed', 'changed')),
      beat('beat_4', 'resolution', '午后', '旧屋门外', '室外暖光与打开的大门', relation('same', 'changed', 'changed', 'changed')),
    ],
  };
}

function narrativeContext(id) {
  return {
    request_id: id,
    brief: '返乡青年在旧屋整理过去并完成告别。',
    content_mode: 'narrative_story',
    content_mode_source: 'user',
    product_presentation: {
      mode: 'narrative_story',
      subject: '',
      standalone_generation_supported: false,
    },
    expected_people: 1,
    cast_mode: 'single',
    target_duration: 15,
    shot_count: 4,
    output_ratio: '9:16',
    cast_profiles: [],
    characters: [],
    pet_profiles: [],
    prop_assets: [],
    scene_assets: [],
    assets: [],
    forbidden: [],
    creative_direction: {},
    performance: {},
  };
}

function cast() {
  return [{
    id: 'returning_youth',
    name: '返乡青年',
    role: '主角',
    age: '25~30岁',
    ethnicity: '东亚外貌设计',
    asset_scope: 'primary',
    appearanceText: '28岁东亚男性，椭圆脸型，眉眼清晰，鼻梁挺直，薄唇；肤色自然偏暖，皮肤保留真实纹理；身形修长、肩背挺直，体态克制；目光沉静，神态内敛而可靠。',
    wardrobeText: '深灰色羊毛短外套，内搭浅米色棉质衬衫；下装为炭黑色直筒长裤，脚穿深棕色皮鞋；佩戴简洁黑色皮带与银色手表，无其他配饰，整体色调低饱和、利落且符合返乡青年身份。',
    hairMakeupText: '自然黑色短发，三七分缝，发型整洁但保留少量碎发；清透素颜妆感，眉形自然，肤质真实；不佩戴眼镜、耳饰、帽子或其他首饰。',
    negativeText: '禁止改变年龄、性别、脸型、五官与人物身份；禁止更换发型、发色和妆容；禁止改动外套、上衣、下装、鞋、配饰及颜色；避免网红脸、塑料皮肤、过度磨皮、肢体畸形和多余人物。',
    look_profiles: [],
  }];
}

function partialPlan() {
  return coverage.compileAssetPlan({
    cast_profiles: cast(),
    story_seed: storySeed(),
  });
}

function createTask(id, ctx) {
  storage.createTask({
    id,
    title: '平台区段恢复测试',
    brief: ctx.brief,
    content_revision: 1,
    request: ctx,
    status: 'running',
    stage: 'scene_config',
  });
  storage.saveOutput(id, 'context', ctx);
  return storage.getTask(id);
}

async function waitForJob(taskId, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = jobs.getJob(taskId);
    if (job && !['queued', 'running'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`job_timeout:${taskId}`);
}

async function main() {
  const baseNarrative = narrativeContext('contract-matrix');
  assert.deepEqual(
    sectionContract.sectionDiagnostics({ prop_plan: [] }, baseNarrative).prop_plan,
    { present: true, valid: true, issues: [], value: [] },
    '纯剧情显式 prop_plan:[] 必须表示“确认无独立道具”而不是缺失',
  );
  const missingKey = sectionContract.sectionDiagnostics({}, baseNarrative).prop_plan;
  assert.equal(missingKey.valid, false, '缺少 prop_plan key 必须失败');
  assert(missingKey.issues.includes('prop_plan_key_missing'));

  const standaloneCommercial = {
    content_mode: 'commercial_subject',
    product_subject: '智能门锁',
    product_presentation: {
      mode: 'standalone_product',
      subject: '智能门锁',
      standalone_generation_supported: true,
    },
  };
  const standaloneEmpty = sectionContract.sectionDiagnostics({ prop_plan: [] }, standaloneCommercial).prop_plan;
  assert.equal(standaloneEmpty.valid, false, '独立商品广告不得用空 prop_plan 绕过商品资产');
  assert(standaloneEmpty.issues.includes('commercial_standalone_product_prop_missing'));
  assert.equal(sectionContract.sectionDiagnostics({
    prop_plan: [{ id: 'product_1', name: '智能门锁', type: 'advertised_product' }],
  }, standaloneCommercial).prop_plan.valid, true);

  const contractLockedCommercial = {
    content_mode: 'commercial_subject',
    product_subject: '咖啡机',
    product_presentation: { subject: '咖啡机' },
    advertised_subject_contract: {
      subject: '咖啡机',
      asset_requirement: { visual_lock_required: true },
    },
  };
  assert.equal(sectionContract.sectionDiagnostics({ prop_plan: [] }, contractLockedCommercial).prop_plan.valid, false,
    '显式独立产品视觉锁合同不得接受空 prop_plan');

  const serviceCommercial = {
    content_mode: 'commercial_subject',
    product_subject: '云端协作服务',
    product_presentation: {
      mode: 'service_or_digital',
      subject: '云端协作服务',
      standalone_generation_supported: false,
    },
    creative_direction: { production_mode: 'service_app_story' },
  };
  assert.equal(sectionContract.sectionDiagnostics({ prop_plan: [] }, serviceCommercial).prop_plan.valid, true,
    '服务/应用商业故事允许显式空 prop_plan');
  const materialCommercial = {
    content_mode: 'commercial_subject',
    product_subject: '天然石材饰面',
    product_presentation: {
      mode: 'material_surface',
      subject: '天然石材饰面',
      standalone_generation_supported: false,
    },
  };
  assert.equal(sectionContract.sectionDiagnostics({ prop_plan: [] }, materialCommercial).prop_plan.valid, true,
    '材质/表面商业任务允许显式空 prop_plan');
  const subjectOnlyCommercial = {
    content_mode: 'commercial_subject',
    advertised_subject_contract: { subject: '本地生活服务' },
  };
  assert.equal(sectionContract.sectionDiagnostics({ prop_plan: [] }, subjectOnlyCommercial).prop_plan.valid, true,
    '仅广告主体合同且无独立商品要求时允许显式空 prop_plan');
  const noSubjectCommercial = {
    content_mode: 'commercial_subject',
    product_presentation: { mode: 'service_or_digital', standalone_generation_supported: false },
  };
  const noSubject = sectionContract.sectionDiagnostics({ prop_plan: [] }, noSubjectCommercial).prop_plan;
  assert.equal(noSubject.valid, false, '商业主体本身不得缺失');
  assert(noSubject.issues.includes('commercial_advertised_subject_missing'));

  const castShort = sectionContract.sectionDiagnostics({ cast_profiles: cast() }, {
    content_mode: 'narrative_story', cast_mode: 'dual', expected_people: 2,
  }).cast_profiles;
  assert.equal(castShort.valid, false, '预期双人但只返回一人必须失败');
  assert(castShort.issues.includes('cast_profiles_count_mismatch:1/2'));
  assert.equal(sectionContract.sectionDiagnostics({ cast_profiles: [] }, {
    content_mode: 'narrative_story', cast_mode: 'no_human', expected_people: 0,
  }).cast_profiles.valid, true, '明确无人故事允许空 cast_profiles');

  const base = partialPlan();
  assert.deepEqual(coverage.coverageIssues(base, baseNarrative), [], '集成夹具自身必须通过故事-场景覆盖合同');
  const preservedHashes = Object.fromEntries(['cast_profiles', 'story_seed', 'scene_plan']
    .map(section => [section, hash(base[section])]));
  assert.throws(() => sectionContract.validateSectionPatch({
    required_missing_sections: ['prop_plan'],
    section_patch: { section: 'cast_profiles', value: cast() },
  }, 'prop_plan', baseNarrative), error => error?.code === 'ASSET_PLAN_SECTION_PATCH_SCOPE_INVALID',
  '请求 prop 时，恢复模型只回 cast 必须在合并前失败');
  const patched = sectionContract.mergeSectionPatch(base, {
    required_missing_sections: ['prop_plan'],
    section_patch: { section: 'prop_plan', value: [] },
  }, 'prop_plan', baseNarrative);
  assert.deepEqual(patched.prop_plan, []);
  Object.entries(preservedHashes).forEach(([section, before]) => {
    assert.equal(hash(patched[section]), before, `补 prop 不得改变已成功的 ${section} 哈希`);
  });

  const checkpointCtx = narrativeContext('checkpoint-contract');
  const checkpointTask = createTask('checkpoint-contract', checkpointCtx);
  const firstCheckpoint = sectionContract.saveCheckpointAtomic(
    checkpointTask.id,
    'asset_plan_draft_checkpoint',
    base,
    checkpointCtx,
    { fingerprint: 'fp-checkpoint', generation_id: 'gen-checkpoint' },
  );
  assert.deepEqual(firstCheckpoint.missing_sections, ['prop_plan']);
  const sameCheckpoint = sectionContract.saveCheckpointAtomic(
    checkpointTask.id,
    'asset_plan_draft_checkpoint',
    base,
    checkpointCtx,
    { fingerprint: 'fp-checkpoint', generation_id: 'gen-checkpoint' },
  );
  ['cast_profiles', 'story_seed', 'scene_plan'].forEach((section) => {
    assert.equal(sameCheckpoint.section_hashes[section], firstCheckpoint.section_hashes[section]);
    assert.equal(sameCheckpoint.section_revisions[section], firstCheckpoint.section_revisions[section]);
  });
  const staleCheckpoint = { ...sameCheckpoint, release_envelope: { ...sameCheckpoint.release_envelope, producer_bundle_id: 'old-bundle' } };
  assert.equal(sectionContract.checkpointCompatibility(checkpointTask, staleCheckpoint, {
    ctx: checkpointCtx,
    fingerprint: 'fp-checkpoint',
    generation_id: 'gen-checkpoint',
  }).compatible, false, '旧 bundle 检查点必须 fail closed');

  const exactTaskId = 'timeout-fallback-partial-recovery';
  const exactCtx = narrativeContext(exactTaskId);
  createTask(exactTaskId, exactCtx);
  let mainPlanningCalls = 0;
  let patchCalls = 0;
  const patchRequests = [];
  const patchExistingHashes = [];
  let returnWrongSection = true;
  gateway.generateText = async (options = {}) => {
    if (options.taskId === exactTaskId && options.stage === 'new_story_ad.asset_plan') {
      mainPlanningCalls += 1;
      return {
        text: JSON.stringify({ cast_profiles: cast(), story_seed: storySeed() }),
        used_model: 'mock/fallback-partial',
        fallback_used: true,
        failed_models: [{ model: 'mock/primary', code: 'MODEL_TIMEOUT', error: 'primary planning timeout' }],
      };
    }
    if (options.taskId === exactTaskId && options.stage === 'new_story_ad.asset_plan_section_patch') {
      patchCalls += 1;
      const request = JSON.parse(options.userPrompt);
      patchRequests.push(request.required_missing_sections);
      patchExistingHashes.push(Object.fromEntries(['cast_profiles', 'story_seed', 'scene_plan']
        .map(section => [section, hash(request.existing_payload[section])])));
      const body = returnWrongSection
        ? {
          required_missing_sections: ['prop_plan'],
          section_patch: { section: 'cast_profiles', value: cast() },
        }
        : {
          required_missing_sections: ['prop_plan'],
          section_patch: { section: 'prop_plan', value: [] },
        };
      return {
        text: JSON.stringify(body),
        used_model: 'mock/section-patch',
        fallback_used: false,
        failed_models: [],
      };
    }
    throw new Error(`unexpected_mock_model_stage:${options.taskId}:${options.stage}`);
  };
  outputLanguage.ensureChineseOutput = async ({ payload }) => ({
    payload, repaired: false, assessment: { pass: true },
  });

  let assetPlan = require('../src/services/newStoryAd/assetPlanService');
  await assert.rejects(
    () => assetPlan.generate(exactTaskId),
    error => error?.code === 'ASSET_PLAN_SECTION_PATCH_SCOPE_INVALID',
    '主规划备用模型部分响应后，恢复只回 cast 漏 prop 必须失败，不能伪装完成',
  );
  const partialCheckpoint = storage.getOutput(exactTaskId, 'asset_plan_draft_checkpoint');
  assert(partialCheckpoint, '部分成功区段必须持久化为检查点');
  assert.deepEqual(partialCheckpoint.valid_sections.sort(), ['cast_profiles', 'scene_plan', 'story_seed']);
  assert.deepEqual(partialCheckpoint.missing_sections, ['prop_plan']);
  assert.equal(partialCheckpoint.unified_model_meta.fallback_used, true);
  assert(partialCheckpoint.unified_model_meta.failed_models.some(item => item.code === 'MODEL_TIMEOUT'));
  assert.deepEqual(patchRequests, [['prop_plan']], '第一次恢复必须只请求真正缺失的 prop_plan');
  const beforeRestartHashes = { ...partialCheckpoint.section_hashes };

  returnWrongSection = false;
  delete require.cache[require.resolve('../src/services/newStoryAd/assetPlanService')];
  assetPlan = require('../src/services/newStoryAd/assetPlanService');
  await assetPlan.generate(exactTaskId);
  assert.equal(mainPlanningCalls, 1, '进程重启后的恢复不得重跑已经成功的主规划');
  assert.equal(patchCalls, 2, '第二次只能重试失败的 prop 区段');
  assert.deepEqual(patchRequests, [['prop_plan'], ['prop_plan']]);
  patchExistingHashes.forEach((requestHashes) => {
    Object.entries(beforeRestartHashes).forEach(([section, before]) => {
      assert.equal(requestHashes[section], before, `重启前后恢复请求不得改写已成功的 ${section}`);
    });
  });
  assert.equal(storage.getOutput(exactTaskId, 'asset_plan_draft_checkpoint'), null,
    '所有区段成功后必须删除草稿检查点');
  const savedPlan = storage.getOutput(exactTaskId, 'asset_plan');
  assert(savedPlan && Array.isArray(savedPlan.prop_plan) && savedPlan.prop_plan.length === 0);
  assert.equal(savedPlan.model_meta.draft_checkpoint_reused, true);
  const recoveryAudit = storage.getOutput(exactTaskId, 'asset_plan_missing_sections_recovery');
  assert.deepEqual(recoveryAudit.recovered_sections, ['prop_plan']);

  const staleTaskId = 'stale-bundle-checkpoint';
  const staleCtx = narrativeContext(staleTaskId);
  const staleTask = createTask(staleTaskId, staleCtx);
  const staleFingerprint = assetPlan.fingerprint(staleTask, staleCtx);
  const liveCheckpoint = sectionContract.saveCheckpointAtomic(
    staleTaskId,
    'asset_plan_draft_checkpoint',
    base,
    staleCtx,
    { fingerprint: staleFingerprint },
  );
  storage.saveOutput(staleTaskId, 'asset_plan_draft_checkpoint', {
    ...liveCheckpoint,
    release_envelope: { ...liveCheckpoint.release_envelope, producer_bundle_id: 'old-bundle' },
  });
  let staleMainCalls = 0;
  let stalePatchCalls = 0;
  gateway.generateText = async (options = {}) => {
    if (options.taskId === staleTaskId && options.stage === 'new_story_ad.asset_plan') {
      staleMainCalls += 1;
      return {
        text: JSON.stringify({ cast_profiles: cast(), prop_plan: [], story_seed: storySeed() }),
        used_model: 'mock/current-bundle-main',
        fallback_used: false,
        failed_models: [],
      };
    }
    if (options.taskId === staleTaskId && options.stage === 'new_story_ad.asset_plan_section_patch') {
      stalePatchCalls += 1;
    }
    throw new Error(`unexpected_stale_bundle_stage:${options.stage}`);
  };
  await assetPlan.generate(staleTaskId);
  assert.equal(staleMainCalls, 1, '旧 bundle 检查点不得续跑，必须从当前主规划重新建立权威结果');
  assert.equal(stalePatchCalls, 0, '旧 bundle 检查点不得触发区段恢复模型');

  const concurrencyTaskId = 'section-recovery-concurrency-gate';
  createTask(concurrencyTaskId, narrativeContext(concurrencyTaskId));
  let executeCount = 0;
  let releaseExecution;
  const executionGate = new Promise(resolve => { releaseExecution = resolve; });
  const firstJob = jobs.queueStage({
    taskId: concurrencyTaskId,
    stage: 'scene_config',
    expectedContentRevision: 1,
    idempotencyKey: 'same-section-recovery-action',
    execute: async () => {
      executeCount += 1;
      await executionGate;
    },
  });
  const duplicateJobs = Array.from({ length: 20 }, () => jobs.queueStage({
    taskId: concurrencyTaskId,
    stage: 'scene_config',
    expectedContentRevision: 1,
    idempotencyKey: 'same-section-recovery-action',
    execute: async () => { executeCount += 1; },
  }));
  assert.equal(firstJob.accepted, true);
  assert(duplicateJobs.every(item => item.duplicate === true));
  assert.equal(new Set([firstJob, ...duplicateJobs].map(item => item.job.id)).size, 1,
    '并发重复操作必须绑定同一个后台任务');
  releaseExecution();
  const terminalJob = await waitForJob(concurrencyTaskId);
  assert.equal(terminalJob.status, 'succeeded');
  assert.equal(executeCount, 1, '20 次并发重复恢复不得重复执行或重复计费');

  ['new_story_ad.asset_plan', 'new_story_ad.asset_plan_section_patch'].forEach((stage) => {
    assert(pipeline.getStageMeta(stage), `${stage} 必须注册在模型管理 schema`);
    assert(pipeline.isStrictPipelineManagedStage(stage), `${stage} 必须禁止隐式 settings fallback`);
  });

  console.log(JSON.stringify({
    passed: true,
    commercial_boundary_cases: 7,
    narrative_explicit_empty_prop_valid: true,
    missing_prop_key_blocked: true,
    cast_shortage_blocked: true,
    exact_timeout_fallback_partial_replayed: true,
    wrong_cast_only_recovery_blocked: true,
    restart_reused_checkpoint: true,
    only_missing_section_retried: ['prop_plan'],
    successful_section_hashes_preserved: true,
    stale_bundle_checkpoint_reused: false,
    concurrent_duplicate_requests: 20,
    concurrent_executions: executeCount,
    mocked_model_calls: mainPlanningCalls + patchCalls + staleMainCalls + stalePatchCalls,
    paid_provider_calls: 0,
  }, null, 2));
}

main().finally(() => {
  gateway.generateText = originalGenerateText;
  outputLanguage.ensureChineseOutput = originalEnsureChineseOutput;
  fs.rmSync(outputDir, { recursive: true, force: true });
});
