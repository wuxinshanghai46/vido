#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-v111-real-contract-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';
const liveSettingsPath = path.join(process.cwd(), 'outputs', 'settings.json');
if (fs.existsSync(liveSettingsPath)) fs.copyFileSync(liveSettingsPath, path.join(outputDir, 'settings.json'));

const gateway = require('../src/services/newStoryAd/modelGateway');
const topology = require('../src/services/newStoryAd/narrativeTopologyCompilerService');
const coverage = require('../src/services/newStoryAd/storySceneCoverageService');
const storyFactsPrompt = require('../src/services/newStoryAd/storyFactsPromptService');
const pipeline = require('../src/services/pipelineModelService');

const smoke = process.argv.includes('--smoke');
const productionRoute = process.argv.includes('--production-route');
const auditReplayArg = process.argv.find(arg => arg.startsWith('--audit-replay='));
const auditReplayPath = auditReplayArg ? path.resolve(auditReplayArg.slice('--audit-replay='.length)) : '';
const caseFilterArg = process.argv.find(arg => arg.startsWith('--case='));
const caseFilter = caseFilterArg ? caseFilterArg.slice('--case='.length) : '';
const MODELS = [
  { provider_id: 'apismile', model_id: 'gpt-5.5', priority: 1, enabled: true },
  { provider_id: 'deyunai', model_id: 'gemini-2.5-pro', priority: 1, enabled: true },
  { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 1, enabled: true },
];
const PRIMARY_CONTRACT_FAILURE_CODES = new Set(['PROVIDER_RESPONSE_INVALID', 'MODEL_JSON']);
const topics = [
  '职场团队在同一会议室连续讨论后前往仓库解决交付危机',
  '家庭成员在老宅整理旧物并在院子里完成和解',
  '两名旅行者在车站相识，随后在山顶共同完成救援',
  '儿童在学校实验室解决科学比赛中的误会',
  '运动员从训练馆前往赛场完成接力赛',
  '公益志愿者在社区中心组织物资并送往受助家庭',
  '历史人物在宫殿议事后前往城门处理突发事件',
  '科幻维修员在飞船控制舱排障后进入引擎室',
  '奇幻学徒在图书塔发现线索并前往森林解除危机',
  '无人物环境叙事：河流从清晨薄雾到傍晚灯光下展现生态变化',
  '悬疑记者在办公室核对证据后前往停车场揭开真相',
  '跨语言故事：设计师在 studio 内讨论方案，随后前往展厅完成展示',
];
const highRisk = [
  '同一客厅连续行动，时间从9:00推进到9:05，陈设与光线语义相同但表达方式不同；之后才真正前往室外广场。',
  '同一竹林步道从人物进入、交谈到短暂沉默都不换制作场次；傍晚灯光和布景实质改变后才换场。',
  '故事只有两个真实制作场次：古代段全部发生在同一宫殿，现代段全部发生在同一博物馆；每个时代内部的连续动作不得为了凑数量拆场。',
  '全片只有一个真实物理地点“会谈室”，全部节拍的时代、location 名称、连续时间、光线、固定陈设和可行动区域始终不变；只有人物关系逐步变化，人物情绪与动作不属于制作变化。除首节拍外，production_relation 必须保持 same/continuous，不得按节拍数量拆场。',
  '同一地点先是白天自然光，后来跨到冬季夜晚并重新布景；必须声明真实制作变化。',
  '故事只有两个真实制作场次：地点A“东馆一号展厅”和地点B“东馆二号展厅”。全部节拍的 location 只能使用这两个稳定名称；从A到B时必须把 location relation 标为 changed，之后在B内连续行动标为 same/continuous；不得额外虚构第三个地点。',
];
const highRiskSceneCounts = [2, 2, 2, 1, 2, 2];

function cases() {
  if (smoke) return MODELS.map((model, index) => ({ id: `smoke-${index + 1}`, prompt: highRisk[index], expectedScenes: highRiskSceneCounts[index], duration: 30, model }));
  const rows = [];
  for (let index = 0; index < 24; index += 1) {
    rows.push({ id: `matrix-${index + 1}`, prompt: topics[index % topics.length], duration: [15, 30, 60, 120][index % 4], model: MODELS[index % MODELS.length] });
  }
  highRisk.forEach((prompt, riskIndex) => MODELS.forEach((model, modelIndex) => {
    rows.push({ id: `risk-${riskIndex + 1}-model-${modelIndex + 1}`, prompt, expectedScenes: highRiskSceneCounts[riskIndex], duration: 60, model });
  }));
  return productionRoute ? rows.map(row => ({ ...row, model: MODELS[0] })) : rows;
}

async function runCase(item) {
  const ctx = {
    content_mode: 'narrative_story', product_presentation: { mode: 'narrative_story' },
    story_scene_contract_version: coverage.CONTRACT_VERSION, target_duration: item.duration,
    shot_count: item.duration >= 120 ? 16 : (item.duration >= 60 ? 12 : 6),
    brief: item.prompt,
  };
  let accepted = null, textModelCalls = 0, primaryCandidateFailed = false;
  let primaryContractEvaluated = true, initialFailure = null;
  const validateText = async (text, candidate = {}) => {
      const parsed = candidate.parsed_json || JSON.parse(text);
      const seed = parsed.story_seed || parsed.storySeed || parsed;
      const factIssues = coverage.storySeedIssues(seed, ctx);
      if (factIssues.length) {
        throw Object.assign(new Error(factIssues.join(',')), {
          code: 'STORY_FACTS_INVALID',
          story_scene_coverage_issues: factIssues,
        });
      }
      const compiled = topology.compileAssetPlan({ story_seed: seed });
      const issues = coverage.coverageIssues(compiled, ctx);
      if (issues.length) {
        throw Object.assign(new Error(issues.join(',')), {
          code: 'STORY_FACTS_CONTRACT_INVALID',
          story_scene_coverage_issues: issues,
        });
      }
      if (Number.isInteger(item.expectedScenes) && compiled.scene_plan.spaces.length !== item.expectedScenes) {
        throw Object.assign(new Error(`expected_scene_count:${compiled.scene_plan.spaces.length}/${item.expectedScenes}`), { code: 'STORY_FACTS_TOPOLOGY_INVALID' });
      }
      accepted = compiled;
  };
  const managedCandidates = [
    item.model,
    ...MODELS.filter(model => model.provider_id !== item.model.provider_id || model.model_id !== item.model.model_id),
  ];
  const invoke = async (stage, userPrompt, validator = validateText) => {
    try {
      const response = await gateway.generateText({
      taskId: `v111-real-${item.id}`,
      stage,
      systemPrompt: stage === 'new_story_ad.story_facts_repair'
        ? storyFactsPrompt.repairSystemPrompt(ctx)
        : (stage === 'new_story_ad.story_facts_compact_retry'
          ? storyFactsPrompt.compactRetrySystemPrompt(ctx)
          : storyFactsPrompt.developmentSystemPrompt(ctx)),
      userPrompt,
      maxTokens: stage === 'new_story_ad.story_facts'
        ? 5200
        : (stage === 'new_story_ad.story_facts_repair' ? 3200 : 4200),
      temperature: stage === 'new_story_ad.story_facts' ? 0.35 : 0.1,
      timeoutMs: 150000,
      stageBudgetMs: 160000,
      maxCandidates: managedCandidates.length,
      structuredOutput: { mode: 'json_object' },
      _candidateModels: managedCandidates,
      validateText: validator,
      });
      textModelCalls += 1 + (response.failed_models || []).length;
      return response;
    } catch (error) {
      textModelCalls += Math.max(1, (error.failed_models || []).length);
      throw error;
    }
  };
  const initialPrompt = JSON.stringify(storyFactsPrompt.developmentUserPayload(
    ctx,
    {},
    coverage.expectedBeatCount(ctx),
  ));
  let result;
  try {
    result = await invoke('new_story_ad.story_facts', initialPrompt);
    primaryCandidateFailed = Boolean((result.failed_models || []).length);
    if (primaryCandidateFailed) {
      primaryContractEvaluated = PRIMARY_CONTRACT_FAILURE_CODES.has(String(result.failed_models?.[0]?.code || ''));
    }
  } catch (error) {
    primaryCandidateFailed = true;
    primaryContractEvaluated = PRIMARY_CONTRACT_FAILURE_CODES.has(String(error.code || ''));
    initialFailure = {
      code: error.code || '',
      message: String(error.message || '').slice(0, 1000),
      failed_models: error.failed_models || [],
      candidate_beat_count: Array.isArray(error.candidate_parsed_json?.story_seed?.plot_beats)
        ? error.candidate_parsed_json.story_seed.plot_beats.length
        : 0,
    };
    if (!['PROVIDER_RESPONSE_INVALID', 'MODEL_JSON', 'PROVIDER_EMPTY_RESPONSE'].includes(error.code)) throw error;
    const candidate = error.candidate_parsed_json?.story_seed || error.candidate_parsed_json?.storySeed || {};
    const candidateBeats = Array.isArray(candidate.plot_beats || candidate.plotBeats) ? (candidate.plot_beats || candidate.plotBeats) : [];
    const diagnosticIssues = error.failed_models?.[0]?.response_diagnostics?.issues;
    const repairIssues = Array.isArray(diagnosticIssues) && diagnosticIssues.length
      ? diagnosticIssues
      : String(error.failed_models?.[0]?.message || error.message || '').split(',').filter(Boolean);
    const repairScope = topology.buildStorySeedRepairScope(candidate, repairIssues, coverage.expectedBeatCount(ctx));
    if (storyFactsPrompt.shouldUseCompactRetry(candidateBeats, repairScope, coverage.expectedBeatCount(ctx))) {
      result = await invoke('new_story_ad.story_facts_compact_retry', JSON.stringify(
        storyFactsPrompt.compactRetryUserPayload(
          ctx,
          {},
          coverage.expectedBeatCount(ctx),
          candidateBeats,
          repairIssues,
        ),
      ));
    } else {
    let repairedSeed = null;
    const repairPrompt = JSON.stringify(storyFactsPrompt.repairUserPayload(
      ctx,
      coverage.expectedBeatCount(ctx),
      repairIssues,
      repairScope,
    ));
    let repairResult;
    try {
      repairResult = await invoke('new_story_ad.story_facts_repair', repairPrompt, async (text, meta = {}) => {
        const parsed = meta.parsed_json || JSON.parse(text);
        repairedSeed = topology.mergeStorySeedPatch(candidate, parsed, { repair_scope: repairScope });
        return validateText(JSON.stringify({ story_seed: repairedSeed }), { parsed_json: { story_seed: repairedSeed } });
      });
    } catch (error) {
      error.contract_repair_diagnostics = {
        base_beat_count: candidateBeats.length,
        repair_issues: repairIssues,
        repair_scope: repairScope,
      };
      throw error;
    }
    result = { ...repairResult, parsed_json: { story_seed: repairedSeed }, text: JSON.stringify({ story_seed: repairedSeed }) };
    }
  }
  assert(accepted);
  return {
    id: item.id,
    provider_id: item.model.provider_id,
    model_id: item.model.model_id,
    duration: item.duration,
    beat_count: accepted.story_seed.plot_beats.length,
    scene_count: accepted.scene_plan.spaces.length,
    topology_hash: accepted.story_seed.topology_hash,
    used_model: result.used_model,
    primary_candidate_passed: !primaryCandidateFailed,
    primary_candidate_contract_evaluated: primaryContractEvaluated,
    initial_failure: initialFailure,
    failed_models: result.failed_models || [],
    text_model_calls: textModelCalls,
    response: result.parsed_json || JSON.parse(result.text),
  };
}

function auditResults(results = []) {
  const contractEvaluated = (row = {}) => {
    if (typeof row.primary_candidate_contract_evaluated === 'boolean') return row.primary_candidate_contract_evaluated;
    if (row.primary_candidate_passed === true) return true;
    const failure = row.initial_failure?.failed_models?.[0] || row.failed_models?.[0] || {};
    return PRIMARY_CONTRACT_FAILURE_CODES.has(String(failure.code || ''));
  };
  const primaryEvaluated = results.filter(contractEvaluated).length;
  const primaryPassed = results.filter(row => contractEvaluated(row) && row.primary_candidate_passed).length;
  const primaryPassRate = primaryEvaluated ? primaryPassed / primaryEvaluated : 0;
  const primaryTransportFailures = results.length - primaryEvaluated;
  const evaluatedPrimaryModels = new Set(results
    .filter(contractEvaluated)
    .map(row => `${row.provider_id}/${row.model_id}`));
  if (!caseFilter) {
    assert(primaryEvaluated >= Math.ceil(results.length / 2), `too few primary candidates returned content for contract evaluation: ${primaryEvaluated}/${results.length}`);
    const expectedPrimaryModels = productionRoute ? [MODELS[0]] : MODELS;
    expectedPrimaryModels.forEach(model => assert(
      evaluatedPrimaryModels.has(`${model.provider_id}/${model.model_id}`),
      `primary model produced no contract-evaluable candidate: ${model.provider_id}/${model.model_id}`,
    ));
    assert(primaryPassRate >= 0.95, `single candidate contract pass rate below 95%: ${primaryPassed}/${primaryEvaluated}`);
  }
  return { primaryEvaluated, primaryPassed, primaryPassRate, primaryTransportFailures };
}

(async () => {
  assert(pipeline.getStageMeta('new_story_ad.story_facts'));
  if (auditReplayPath) {
    const replay = JSON.parse(fs.readFileSync(auditReplayPath, 'utf8'));
    const results = Array.isArray(replay.results) ? replay.results : [];
    assert(results.length, `real contract replay has no results: ${auditReplayPath}`);
    const audit = auditResults(results);
    console.log(JSON.stringify({
      real_model_contract_replay_audit: 'passed',
      production_route: productionRoute,
      cases: results.length,
      primary_candidate_passed: audit.primaryPassed,
      primary_candidate_contract_evaluated: audit.primaryEvaluated,
      primary_candidate_pass_rate: Number(audit.primaryPassRate.toFixed(4)),
      primary_transport_failures: audit.primaryTransportFailures,
      text_model_calls: 0,
      image_calls: 0,
      video_calls: 0,
      replay_path: auditReplayPath,
    }));
    return;
  }
  const rows = cases().filter(row => !caseFilter || row.id === caseFilter);
  assert(rows.length, `real contract case not found: ${caseFilter}`);
  const results = [];
  const replayDir = path.join(process.cwd(), 'outputs', 'replays');
  fs.mkdirSync(replayDir, { recursive: true });
  const replayPath = path.join(replayDir, `story-ad-platform-v111-real-contract-${caseFilter ? `case-${caseFilter}` : (smoke ? 'smoke' : (productionRoute ? 'production-route' : 'full'))}.json`);
  for (const row of rows) {
    results.push(await runCase(row));
    fs.writeFileSync(replayPath, `${JSON.stringify({ status: 'running', completed: results.length, total: rows.length, results }, null, 2)}\n`, 'utf8');
    console.log(`REAL_CONTRACT_PROGRESS=${results.length}/${rows.length}:${row.id}`);
  }
  const audit = auditResults(results);
  fs.writeFileSync(replayPath, `${JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    real_model_contract: 'passed',
    mode: smoke ? 'smoke' : 'full',
    production_route: productionRoute,
    cases: results.length,
    providers: [...new Set(results.map(row => row.provider_id))],
    primary_candidate_passed: audit.primaryPassed,
    primary_candidate_contract_evaluated: audit.primaryEvaluated,
    primary_candidate_pass_rate: Number(audit.primaryPassRate.toFixed(4)),
    primary_transport_failures: audit.primaryTransportFailures,
    text_model_calls: results.reduce((sum, row) => sum + row.text_model_calls, 0),
    image_calls: 0,
    video_calls: 0,
    replay_path: replayPath,
  }));
})().finally(() => fs.rmSync(outputDir, { recursive: true, force: true }))
  .catch(error => { console.error(error); process.exitCode = 1; });
