'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-causal-story-scenes-v104-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const storage = require('../src/services/newStoryAd/storageService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const outputLanguage = require('../src/services/newStoryAd/outputLanguageService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const coverage = require('../src/services/newStoryAd/storySceneCoverageService');
const publication = require('../src/services/newStoryAd/assetPlanPublicationService');
const storyFactsPrompt = require('../src/services/newStoryAd/storyFactsPromptService');

const originalGenerateText = modelGateway.generateText;
const originalEnsureChineseOutput = outputLanguage.ensureChineseOutput;

function context(mode = 'narrative_story') {
  return {
    request_id: `causal-scenes-${mode}`,
    brief: mode === 'narrative_story'
      ? '古代竹海初遇相爱，战乱中生离死别，千年后在现代重逢。'
      : '智能门锁家庭广告，突出安全与便捷。',
    content_mode: mode,
    content_mode_source: 'user',
    product_subject: mode === 'narrative_story' ? '' : '智能门锁',
    product_presentation: { mode, subject: mode === 'narrative_story' ? '' : '智能门锁' },
    story_scene_contract_version: mode === 'narrative_story' ? 4 : 0,
    expected_people: 2,
    cast_mode: 'dual',
    target_duration: 90,
    shot_count: 12,
    output_ratio: '9:16',
    cast_profiles: [], characters: [], pet_profiles: [], prop_assets: [], scene_assets: [], assets: [], forbidden: [],
    creative_direction: {}, performance: {},
  };
}

function cast() {
  return [
    { id: 'hero', name: '陆光', role: '男主', appearanceText: '清俊', wardrobeText: '古装与现代装', look_profiles: [] },
    { id: 'heroine', name: '月瑶', role: '女主', appearanceText: '清秀', wardrobeText: '古代华服与现代白裙', look_profiles: [] },
  ];
}

const beats = [
  ['meet', 'opening', '古代', '春日午后', '竹海溪畔', '春日完整竹林与溪畔', 'ancient_bamboo_meet', 'opening', '开场', '两人因救下一只受伤白鹭相识', '彼此留下信物并约定再见'],
  ['bond', 'development', '古代', '三个月后', '竹海溪畔', '春日完整竹林与溪畔', 'ancient_bamboo_meet', 'time_change', 'continuity', '多次相见让两人建立信任', '两人确认感情并计划成亲'],
  ['war_call', 'development', '古代', '婚期前七日', '将军府前厅', '婚礼筹备中的府邸', 'ancient_manor_call', 'composite_change', '征召令抵达，室内政治压力成为新冲突', '边关告急且男主被紧急征召', '婚期取消并必须立刻出征'],
  ['farewell', 'development', '古代', '次日清晨', '边关城门', '军队集结的城门外', 'frontier_farewell', 'composite_change', '人物离城且军队集结，必须换场', '征召令迫使两人在城门分别', '女主独自等待，男主立下归来承诺'],
  ['battle', 'turning_point', '古代', '半年后黄昏', '北境战场', '交战后的残破阵地', 'northern_battle', 'composite_change', '战争主行动发生在远方战场', '敌军突袭使男主必须以身断后', '男主失踪，错误军报传回故乡'],
  ['loss', 'turning_point', '古代', '一年后深秋', '竹海残亭', '深秋残损竹亭', 'ancient_bamboo_loss', 'composite_change', '季节、陈设和人物命运均显著变化', '女主长期等候且因战乱染病', '女主离世；归来的男主只见遗物'],
  ['bridge', 'transition', '跨越千年', '千年流转蒙太奇', '竹海与城市变迁', '跨时空变化蒙太奇', 'time_bridge_montage', 'composite_change', '时代跨越必须独立桥接', '男主的执念与信物成为跨时空记忆线索', '古代竹海演变为现代保护区，人物进入新身份'],
  ['modern_setup', 'development', '现代', '重逢前三日', '现代城市博物馆', '开放中的文物修复区', 'modern_museum_setup', 'composite_change', '现代人物需要先建立日常身份和行动目标', '现代女主研究出土信物，男主作为修复师协助', '两人因项目约定前往竹海考察'],
  ['reunion', 'resolution', '现代', '考察日傍晚', '现代竹海步道', '保护区傍晚步道', 'modern_bamboo_reunion', 'composite_change', '人物从城市项目地点到竹海考察', '共同研究和信物记忆引导两人来到旧地', '两人在似曾相识中重新选择靠近'],
].map(([id, phase, era, time_anchor, location, production_state, production_scene_key, transition_type, scene_change_reason, cause, consequence]) => ({
  id: `beat_${id}`, phase, era, time_anchor, location, production_state, production_scene_key, transition_type, scene_change_reason,
  summary: `${cause}，${consequence}`, cause, consequence,
}));

function storySeed() {
  return {
    logline: '一段有完整前因后果的古今重逢故事',
    opening: '竹海相识并建立感情',
    development: '婚约、征召、分别、战争和现代身份依次展开',
    turning_point: '错误军报与迟归造成生离死别',
    resolution: '经千年桥接和现代共同目标后重逢',
    plot_beats: beats.map(beat => ({ ...beat })),
  };
}

function sceneFor(key, coveredBeatIds) {
  return {
    id: `scene_${key}`,
    production_scene_key: key,
    covered_beat_ids: coveredBeatIds,
    name: key,
    description: `${key} 的独立时空制作环境`,
    story_purpose: `承载 ${coveredBeatIds.join('、')}`,
    scene_spec: {
      layoutText: '明确前中后景、出入口和人物活动区',
      materialLightText: '符合时代的材质、天气、时间与电影光线',
      interactionText: '明确人物站位、动作锚点与移动路线',
      negativeText: '禁止品牌、商品、现代元素误入古代场景',
      storyStates: [], interactionAnchors: [], routes: [], propPlacements: [],
    },
  };
}

function scenePlan() {
  const groups = new Map();
  beats.forEach(beat => groups.set(beat.production_scene_key, [...(groups.get(beat.production_scene_key) || []), beat.id]));
  return {
    business_boundary: '纯剧情', advertised_subject: '', cast_mode: 'dual', scene_mode: 'multi',
    spaces: [...groups].map(([key, ids]) => sceneFor(key, ids)),
    asset_strategy: [], story_strategy: [], forbidden: [], suggested_shot_count: 12,
  };
}

function genericBeat({ id, phase, era, time, location, state, key, transition, cause, consequence }) {
  return {
    id, phase, era, time_anchor: time, location, production_state: state,
    production_scene_key: key, transition_type: transition,
    scene_change_reason: transition === 'continuity' ? 'continuity' : `${transition} requires an independent production setup`,
    summary: `${cause}，${consequence}`, cause, consequence,
  };
}

function genericStory({ logline, beats: storyBeats }) {
  return {
    logline,
    opening: '建立人物目标与初始状态',
    development: '行动推进并产生阻力',
    turning_point: '关键变化迫使人物调整行动',
    resolution: '行动结果回收前述因果',
    plot_beats: storyBeats,
  };
}

const workplaceStory = genericStory({
  logline: '仓储团队在系统异常后协作完成紧急交付',
  beats: [
    genericBeat({ id: 'work_1', phase: 'opening', era: '当日', time: '上午九点', location: '仓储作业区', state: '正常分拣中', key: 'warehouse_normal', transition: 'opening', cause: '团队接到紧急订单', consequence: '负责人制定当天目标' }),
    genericBeat({ id: 'work_2', phase: 'development', era: '当日', time: '上午九点', location: '仓储作业区', state: '正常分拣中', key: 'warehouse_normal', transition: 'continuity', cause: '订单量超过预估', consequence: '团队加快分拣并发现系统异常' }),
    genericBeat({ id: 'work_3', phase: 'development', era: '当日', time: '上午十点', location: '调度室', state: '系统告警亮起', key: 'dispatch_alert', transition: 'composite_change', cause: '扫描记录无法同步', consequence: '调度员切换人工核对流程' }),
    genericBeat({ id: 'work_4', phase: 'turning_point', era: '当日', time: '中午十二点', location: '装卸区', state: '待发车辆集中排队', key: 'loading_queue', transition: 'composite_change', cause: '人工流程造成车辆积压', consequence: '负责人重新分配人员与通道' }),
    genericBeat({ id: 'work_5', phase: 'development', era: '当日', time: '下午三点', location: '仓储作业区', state: '备用流程稳定运行', key: 'warehouse_recovered', transition: 'composite_change', cause: '新的分工缩短核对时间', consequence: '最后一批货物按序出库' }),
    genericBeat({ id: 'work_6', phase: 'resolution', era: '当日', time: '傍晚六点', location: '调度室', state: '订单面板全部完成', key: 'dispatch_complete', transition: 'composite_change', cause: '团队完成所有交付', consequence: '负责人记录改进方案' }),
  ],
});

const familyStory = genericStory({
  logline: '一家人通过多年保存的录音重新理解彼此',
  beats: [
    genericBeat({ id: 'family_1', phase: 'opening', era: '童年阶段', time: '暑假第一天', location: '旧宅客厅', state: '全家准备搬家', key: 'old_home_move', transition: 'opening', cause: '孩子不愿离开旧宅', consequence: '家长用录音机记录约定' }),
    genericBeat({ id: 'family_2', phase: 'development', era: '童年阶段', time: '暑假第一天', location: '旧宅客厅', state: '全家准备搬家', key: 'old_home_move', transition: 'continuity', cause: '家人各自说出愿望', consequence: '录音带成为共同记忆' }),
    genericBeat({ id: 'family_3', phase: 'development', era: '求学阶段', time: '离家前夜', location: '新居卧室', state: '行李尚未收好', key: 'new_home_departure', transition: 'composite_change', cause: '孩子即将远行', consequence: '沟通因分歧中断' }),
    genericBeat({ id: 'family_4', phase: 'development', era: '工作阶段', time: '多年后的工作日', location: '异地工作间', state: '持续加班的夜晚', key: 'remote_work', transition: 'composite_change', cause: '长期忙碌使联系减少', consequence: '未接来电不断累积' }),
    genericBeat({ id: 'family_5', phase: 'transition', era: '返乡阶段', time: '返乡当天', location: '返乡列车', state: '窗外景物连续后退', key: 'return_train', transition: 'composite_change', cause: '旧物整理通知促使返乡', consequence: '人物决定面对未解分歧' }),
    genericBeat({ id: 'family_6', phase: 'turning_point', era: '返乡阶段', time: '当天下午', location: '旧宅储物间', state: '封存纸箱被重新打开', key: 'old_home_storage', transition: 'composite_change', cause: '人物找到旧录音带', consequence: '当年的约定被重新听见' }),
    genericBeat({ id: 'family_7', phase: 'development', era: '返乡阶段', time: '当天傍晚', location: '旧宅客厅', state: '家人围坐倾听录音', key: 'old_home_talk', transition: 'composite_change', cause: '录音揭示彼此长期误解', consequence: '家人开始坦诚说明各自处境' }),
    genericBeat({ id: 'family_8', phase: 'resolution', era: '返乡阶段', time: '当天夜晚', location: '旧宅客厅', state: '纸箱整理完毕且灯光温暖', key: 'old_home_resolved', transition: 'environment_change', cause: '对话消除核心误解', consequence: '一家人约定新的联系方式' }),
  ],
});

(async () => {
  const narrative = context();
  const forbiddenScenarioTerms = /生离死别|转世|千年|古代|现代|战场|远征|重逢|牺牲/;
  assert(!forbiddenScenarioTerms.test(coverage.promptBlock(narrative)), '通用运行时合同不得包含单个案例的题材和事件词');
  assert.equal(coverage.expectedBeatCount(narrative), 8, '90秒/12镜至少需要8个剧情节拍');
  assert.equal(coverage.expectedProductionSceneCount(storySeed(), narrative), 8, '制作场景数必须由实际时间、地点与环境状态推导');
  assert.equal(coverage.expectedBeatCount({ ...narrative, target_duration: 30, shot_count: 5 }), 6, '30秒剧情也不能退化成三个跳跃节点');
  const shallow = { story_seed: { logline: '相爱、死别、千年后重逢' }, scene_plan: { scene_mode: 'single', spaces: [] } };
  assert(coverage.coverageIssues(shallow, narrative).includes('story_seed.plot_beats_missing'));
  const nonContiguousReuse = storySeed();
  nonContiguousReuse.plot_beats[5] = { ...nonContiguousReuse.plot_beats[5], production_scene_key: 'ancient_bamboo_meet', location: '竹海溪畔' };
  assert(coverage.storySeedIssues(nonContiguousReuse, narrative).includes('story_seed.production_scene_key_non_contiguous_reuse:ancient_bamboo_meet'));
  const compressedMultiEra = storySeed();
  compressedMultiEra.plot_beats = compressedMultiEra.plot_beats.map((beat) => ({
    ...beat,
    production_scene_key: beat.era === '现代' ? 'modern_all' : (beat.phase === 'transition' ? 'bridge_all' : 'ancient_all'),
  }));
  assert(!coverage.storySeedIssues(compressedMultiEra, narrative).some(issue => issue.startsWith('story_seed.production_scenes_too_shallow:')), 'v5 不得按 beat 数量或时代数量设置场景硬下限');
  const workplaceContext = { ...narrative, brief: workplaceStory.logline, target_duration: 30, shot_count: 6 };
  assert.equal(coverage.storySeedIssues(workplaceStory, workplaceContext).length, 0, '单日职场故事应按自身因果和空间变化通过');
  assert.equal(coverage.expectedProductionSceneCount(workplaceStory, workplaceContext), 5, '单时空故事不应被跨时代案例固定数量干扰');
  const familyContext = { ...narrative, brief: familyStory.logline, target_duration: 60, shot_count: 10 };
  assert.equal(coverage.storySeedIssues(familyStory, familyContext).length, 0, '家庭跨阶段故事应使用通用时间层合同通过');
  assert.equal(coverage.expectedProductionSceneCount(familyStory, familyContext), 7, '跨阶段故事应按真实制作状态自适应拆场');
  assert.equal(coverage.coverageIssues(shallow, context('commercial_subject')).length, 0, '商业广告路径不启用纯剧情场景深度合同');

  const taskId = 'causal-scenes-retry-v104';
  storage.createTask({ id: taskId, brief: narrative.brief, content_revision: 1, request: narrative });
  storage.saveOutput(taskId, 'context', narrative);
  const currentPlan = {
    story_seed: storySeed(),
    scene_plan: scenePlan(),
    cast_profiles: cast(), prop_plan: [{ id: 'jade', name: '弦月佩', type: 'story_prop' }],
  };
  publication.publish(taskId, currentPlan, {
    fingerprint: assetPlan.fingerprint(storage.getTask(taskId), narrative),
    source: 'current_bundle_pre_replan',
  });

  let unifiedCalls = 0;
  let storyCalls = 0;
  let sceneCalls = 0;
  modelGateway.generateText = async (options = {}) => {
    if (options.stage === 'new_story_ad.asset_plan') {
      unifiedCalls += 1;
      throw new Error('强制重建必须复用现有人物与道具，不应重跑统一规划');
    }
    if (options.stage === 'new_story_ad.story_facts') {
      storyCalls += 1;
      const payload = { story_seed: storySeed() };
      await options.validateText(JSON.stringify(payload), { parsed_json: payload });
      return { text: JSON.stringify(payload), used_model: 'mock/story', fallback_used: false, failed_models: [] };
    }
    if (options.stage === 'new_story_ad.asset_plan_scene_coverage_recovery') {
      sceneCalls += 1;
      throw new Error('当前场景拓扑必须由平台确定性编译，不得调用旧场景恢复模型');
    }
    throw new Error(`unexpected stage ${options.stage}`);
  };
  outputLanguage.ensureChineseOutput = async ({ payload }) => ({ payload, repaired: false, assessment: { pass: true } });

  const result = await assetPlan.generate(taskId, { replan_scene_coverage: true });
  const stored = storage.getOutput(taskId, 'asset_plan');
  assert.equal(result.spaces.length, 8, '9个剧情节拍应按实际时空状态形成8个制作场景，而不是固定3个');
  assert.equal(stored.cast_profiles.length, 2);
  assert.equal(stored.prop_plan.length, 1);
  assert.equal(unifiedCalls, 0);
  assert.equal(storyCalls, 1, '当前 bundle 只调用一次故事事实模型');
  assert.equal(sceneCalls, 0, '场景拓扑必须由平台确定性编译，不能回落旧场景模型');
  assert.equal(coverage.coverageIssues(stored, storage.getOutput(taskId, 'context')).length, 0);

  modelGateway.generateText = originalGenerateText;
  let semanticError;
  let semanticCandidateCalls = 0;
  try {
    await originalGenerateText({
      taskId: 'semantic-classification-v104',
      stage: 'new_story_ad.asset_plan_story_development',
      systemPrompt: 'test', userPrompt: 'test', structuredOutput: { mode: 'json_object' }, maxCandidates: 2,
      _candidateModels: [
        { provider_id: 'mock', model_id: 'one' },
        { provider_id: 'mock', model_id: 'two' },
      ],
      _generateText: async () => {
        semanticCandidateCalls += 1;
        return { text: JSON.stringify({ story_seed: {} }), structured_output: {} };
      },
      validateText: () => {
        const error = new Error('plot beats missing');
        error.code = 'ASSET_PLAN_STORY_SCENE_COVERAGE_INCOMPLETE';
        error.story_scene_coverage_issues = ['story_seed.plot_beats_missing'];
        throw error;
      },
    });
  } catch (error) { semanticError = error; }
  assert(semanticError, '语义失败必须抛出最终错误');
  assert.equal(semanticError.code, 'PROVIDER_RESPONSE_INVALID');
  assert.equal(semanticError.retryable, true);
  assert.equal(semanticCandidateCalls, 1, '业务语义失败不得跨模型盲重试');

  let recoveryCandidateCalls = 0;
  const recoveryFallback = await originalGenerateText({
    taskId: 'managed-recovery-fallback-v124',
    stage: 'new_story_ad.story_facts_compact_retry',
    systemPrompt: 'test', userPrompt: 'test', structuredOutput: { mode: 'json_object' }, maxCandidates: 2,
    _candidateModels: [
      { provider_id: 'mock', model_id: 'invalid-shape' },
      { provider_id: 'mock', model_id: 'valid-shape' },
    ],
    _generateText: async ({ model }) => {
      recoveryCandidateCalls += 1;
      return model.model_id === 'invalid-shape'
        ? { text: JSON.stringify({ story_seed: ['invalid'] }), structured_output: {} }
        : { text: JSON.stringify({ story_seed: { plot_beats: [{ id: 'beat-1' }] } }), structured_output: {} };
    },
    validateText: (text, candidate = {}) => {
      const parsed = candidate.parsed_json || JSON.parse(text);
      if (!Array.isArray(parsed?.story_seed?.plot_beats)) {
        const error = new Error('plot beats missing');
        error.code = 'ASSET_PLAN_STORY_SCENE_COVERAGE_INCOMPLETE';
        error.story_scene_coverage_issues = ['story_seed.plot_beats_missing'];
        throw error;
      }
    },
  });
  assert.equal(recoveryCandidateCalls, 2, '受管恢复阶段结构错误后必须切换到下一个已配置候选');
  assert.equal(recoveryFallback.used_model, 'mock/valid-shape');
  assert.equal(recoveryFallback.failed_models.length, 1);
  assert.equal(storyFactsPrompt.shouldUseCompactRetry([{ id: 'b1' }], { append_count: 3 }, 8), true);
  assert.equal(storyFactsPrompt.shouldUseCompactRetry(Array.from({ length: 8 }, (_, index) => ({ id: `b${index}` })), { append_count: 2 }, 10), false);

  let denseDiagnosticError;
  try {
    await originalGenerateText({
      taskId: 'dense-diagnostic-v124',
      stage: 'new_story_ad.story_facts',
      systemPrompt: 'test', userPrompt: 'test', structuredOutput: { mode: 'json_object' }, maxCandidates: 1,
      _candidateModels: [{ provider_id: 'mock', model_id: 'dense-invalid' }],
      _generateText: async () => ({ text: JSON.stringify({ story_seed: { plot_beats: [] } }), structured_output: {} }),
      validateText: () => {
        const error = new Error('dense story facts invalid');
        error.code = 'ASSET_PLAN_STORY_SCENE_COVERAGE_INCOMPLETE';
        error.story_scene_coverage_issues = [
          ...Array.from({ length: 25 }, (_, index) => `story_seed.plot_beats[${index}].field_missing`),
          'story_seed.plot_beats_too_shallow:8/10',
        ];
        throw error;
      },
    });
  } catch (error) { denseDiagnosticError = error; }
  const denseIssues = denseDiagnosticError?.failed_models?.[0]?.response_diagnostics?.issues || [];
  assert(denseIssues.includes('story_seed.plot_beats_too_shallow:8/10'), '全局数量问题不得被逐节拍诊断截断');
  assert.equal(denseDiagnosticError.failed_models[0].response_diagnostics.issue_count, 26);
  assert.equal(coverage.buildStorySeedRepairScope({}, denseIssues, 10).append_count, 2);

  console.log(JSON.stringify({
    passed: true,
    minimum_beats: coverage.expectedBeatCount(narrative),
    generated_beats: beats.length,
    generated_production_scenes: stored.scene_plan.spaces.length,
    story_calls: storyCalls,
    scene_calls_including_retry: sceneCalls,
    unified_calls: unifiedCalls,
    checkpoint_resume_preserved_story: true,
    semantic_errors_classified_as_response_invalid: true,
    managed_recovery_candidate_fallback: true,
    dense_diagnostics_preserve_global_repairs: true,
    commercial_path_isolated: true,
    adaptive_runtime_prompt_has_no_scenario_terms: true,
    diverse_narrative_cases: ['workplace_single_time_layer', 'family_multi_stage', 'historical_cross_time_regression'],
    real_model_calls: 0,
  }, null, 2));
})().finally(() => {
  modelGateway.generateText = originalGenerateText;
  outputLanguage.ensureChineseOutput = originalEnsureChineseOutput;
  fs.rmSync(outputDir, { recursive: true, force: true });
});
