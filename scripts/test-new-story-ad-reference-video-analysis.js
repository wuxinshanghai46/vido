const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-reference-video-test-'));
process.env.OUTPUT_DIR = tempRoot;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';
process.env.DB_PATH = path.join(tempRoot, 'vido-reference-video-test.sqlite');
process.env.NEW_STORY_AD_MOCK_LLM = '1';

const ffmpegPath = require('ffmpeg-static');
const service = require('../src/services/newStoryAd/referenceVideoAnalysisService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const referenceEvidenceText = require('../src/services/newStoryAd/referenceEvidenceTextService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const referenceAnalysisTaskSync = require('../src/services/newStoryAd/referenceAnalysisTaskSyncService');
const assistScenePlan = require('../src/services/newStoryAd/assistScenePlanService');
const assetPlanService = require('../src/services/newStoryAd/assetPlanService');
assert.throws(
  () => assetPlanService.assertReferenceReady({
    analysis_id: 'ref_failed_current',
    status: 'failed',
  }),
  error => error.code === 'REFERENCE_VIDEO_ANALYSIS_NOT_READY' && error.status === 409,
  'server generation must reject a failed current reference before any model call',
);
assert.equal(assistScenePlan.scenePlanHasUserContent({
  source: 'reference_video_analysis',
  spaces: [{
    scene_spec: {
      layoutText: '参考视频自动投影的空间',
    },
  }],
}), false, '参考视频自动投影不应被误判为用户手填，从而跳过后续证据一致性校验');
const settingsService = require('../src/services/settingsService');

async function waitFor(id, user, statuses, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const row = service.get(id, user);
    if (statuses.includes(row.status)) return row;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${statuses.join(',')}`);
}

function testEvidenceFrames(count = 8, prefix = 'cached') {
  return Array.from({ length: count }, (_, index) => ({
    index,
    frame_id: `F${String(index + 1).padStart(3, '0')}`,
    timestamp_seconds: index,
    shot_index: Math.floor(index / 2) + 1,
    shot_range: [Math.floor(index / 2) * 2, Math.floor(index / 2) * 2 + 2],
    sample_role: index % 2 ? 'closing' : 'opening',
    filename: `${prefix}-${index}.jpg`,
    image_url: `https://example.com/${prefix}-${index}.jpg`,
  }));
}

function testVisionPayload(frames = [], suffix = '') {
  return {
    contract_version: 'shot-aware-v2',
    frames: frames.map(frame => ({
      frame_id: frame.frame_id,
      timestamp_seconds: frame.timestamp_seconds,
      product_or_service: '测试门窗产品',
      visible_text: suffix ? [`测试品牌${suffix}`] : ['测试品牌'],
      environment: Number(frame.shot_index) % 2 ? '现代住宅客厅' : '现代住宅外立面',
      materials: ['玻璃', '金属边框'],
      colors: ['自然木色', '深灰色'],
      layout: '门窗位于画面中央，住宅空间围绕产品展开',
      lighting: '自然侧光照亮玻璃和金属边框',
      human_presence: false,
      human_actions: [],
      animal_presence: false,
      animal_description: '',
      animal_actions: [],
      shot_size: frame.sample_role === 'opening' ? '全景' : '中景',
      angle: '平视',
      movement: '固定机位',
      summary: `镜头 ${frame.shot_index} 的${frame.sample_role === 'opening' ? '开头' : '结尾'}画面展示测试门窗与住宅空间关系`,
    })),
    batch_summary: '本批逐帧展示测试门窗、住宅空间和材质变化',
  };
}

function testVisionRow(frames = [], batchIndex = 1) {
  const payload = testVisionPayload(frames, String(batchIndex));
  return {
    contract_version: 'shot-aware-v2',
    batch_index: batchIndex,
    timestamps: frames.map(frame => frame.timestamp_seconds),
    frame_ids: frames.map(frame => frame.frame_id),
    text: service._private.renderVisionEvidencePayload(payload),
    raw_text: JSON.stringify(payload),
    payload,
    coverage: { expected: frames.length, received: frames.length, complete: true },
    used_model: 'test/vision',
  };
}

async function main() {
  const familyFrames = testEvidenceFrames(4, 'family-contract');
  const familyPayload = {
    contract_version: 'shot-aware-v2',
    frames: familyFrames.map((frame, index) => ({
      frame_id: frame.frame_id,
      timestamp_seconds: frame.timestamp_seconds,
      product_or_service: '全景天窗',
      visible_text: [],
      environment: index < 2 ? '自然风景蒙太奇' : '住宅客餐厅',
      materials: ['玻璃', '金属边框'],
      colors: ['自然木色'],
      layout: index === 3 ? '一人在厨房，两人在客厅沙发上休闲放松' : '全景天窗连接室内外视野',
      lighting: '自然光',
      human_presence: index === 3,
      human_actions: index === 3 ? ['一人在厨房，两人在客厅沙发上休闲放松'] : [],
      animal_presence: index === 0,
      animal_role: index === 0 ? 'ambient_wildlife' : '',
      animal_description: index === 0 ? '海边远景飞鸟' : '',
      animal_actions: index === 0 ? ['鸟群飞过天空'] : [],
      shot_size: '全景',
      angle: '平视',
      movement: '固定机位',
      summary: index === 3 ? '住宅内一家三口共同享受全景天窗带来的明亮空间' : '全景天窗与自然景观建立联系',
    })),
    batch_summary: '全景天窗从自然景观过渡到一家三口的住宅生活',
  };
  const familyEvidence = [{
    contract_version: 'shot-aware-v2',
    batch_index: 1,
    timestamps: familyFrames.map(frame => frame.timestamp_seconds),
    frame_ids: familyFrames.map(frame => frame.frame_id),
    payload: service._private.parseVisionEvidencePayload(JSON.stringify(familyPayload), familyFrames),
    coverage: { expected: 4, received: 4, complete: true },
  }];
  const familyCompiled = service._private.compileAnalysisFromEvidence({
    source: { metadata: { duration_seconds: 4 } },
  }, familyEvidence, { status: 'no_audio', text: '', segments: [] });
  assert.equal(familyCompiled.source_facts.human_count, 3, '同一画面的一人加两人必须识别为三人，不能压成一个家庭条目');
  assert.equal(familyCompiled.character_prompts.length, 3, '资产投影前必须为三名人物分别建立档案提示词');
  assert.equal(familyCompiled.source_facts.animal_presence, true, '环境飞鸟仍应保留为可见事实');
  assert.equal(familyCompiled.source_facts.narrative_animal_presence, false, '自然蒙太奇中的飞鸟不得被误投影成宠物资产');
  assert.equal(familyCompiled.animal_prompts.length, 0, '环境动物不得生成动物角色提示词');

  const companionEvidence = JSON.parse(JSON.stringify(familyEvidence));
  companionEvidence[0].payload.frames[0].animal_role = 'companion';
  companionEvidence[0].payload.frames[0].animal_description = '家庭陪伴犬';
  const companionCompiled = service._private.compileAnalysisFromEvidence({
    source: { metadata: { duration_seconds: 4 } },
  }, companionEvidence, { status: 'no_audio', text: '', segments: [] });
  assert.equal(companionCompiled.source_facts.narrative_animal_presence, true, '明确陪伴角色的动物仍必须进入资产链路');
  assert.ok(companionCompiled.animal_prompts.length > 0, '叙事动物必须生成独立动物档案提示词');

  const animalContractFixture = {
    schema_version: 4,
    status: 'completed',
    source_facts: {
      product_or_service: '宠物清洁服务',
      environment: '明亮的家庭客厅',
      materials: ['棉质地毯'],
      layout: '小狗位于地毯中央，护理员在右侧',
      lighting: '窗户自然侧光',
      human_presence: true,
      animal_presence: true,
      human_actions: ['护理员蹲下伸手'],
      animal_actions: ['棕色小狗从沙发旁走到地毯中央并坐下'],
    },
    story_outline: {
      logline: '小狗接受清洁护理后恢复舒适状态',
      opening: '小狗从沙发旁进入客厅',
      development: '护理员蹲下为小狗清洁毛发',
      turning_point: '小狗停止抓挠并安静坐下',
      resolution: '小狗在干净地毯上轻松趴卧',
    },
    plot_beats: [
      { order: 1, range: [0, 2.5], purpose: '建立小狗与客厅环境' },
      { order: 2, range: [2.5, 5], purpose: '展示护理动作和舒适结果' },
    ],
    character_prompts: [{ role: '宠物护理员' }],
    scene_prompts: [{
      id: 'scene_living_room',
      location_type: '明亮的家庭客厅',
      layout_prompt: '小狗位于地毯中央，护理员在右侧',
      material_light_prompt: '棉质地毯由窗户自然侧光照亮',
      camera_purpose: '记录宠物移动与护理过程',
    }],
    camera_intents: [{ range: [0, 5], movement: 'tracking' }],
    character_actions: [{ role: '宠物护理员', key_action: '护理员蹲下伸手清洁小狗毛发' }],
    animal_actions: [{
      animal_id: 'animal_dog_1',
      action: '从沙发旁走到地毯中央并坐下',
      range: [0, 2.5],
      scene_id: 'scene_living_room',
    }],
    animal_prompts: [{
      id: 'animal_dog_1',
      species: '狗',
      appearance_direction: '棕色短毛小型犬，白色胸口毛发',
      continuity_rules: '毛色、体型、项圈和四肢外观跨镜一致',
    }],
    shot_breakdown: [{
      order: 1,
      range: [0, 2.5],
      visual: '棕色小狗从沙发旁走入画面并停在地毯中央',
      action: '小狗走到地毯中央后坐下',
      scene_id: 'scene_living_room',
      subject_ids: ['animal_dog_1'],
      shot_size: 'wide',
      angle: 'eye_level',
      movement: 'tracking',
      duration_seconds: 2.5,
    }, {
      order: 2,
      range: [2.5, 5],
      visual: '护理员在小狗右侧蹲下并清洁毛发',
      action: '护理员伸手清洁，小狗保持坐姿',
      scene_id: 'scene_living_room',
      subject_ids: ['animal_dog_1'],
      shot_size: 'medium',
      angle: 'eye_level',
      movement: 'static',
      duration_seconds: 2.5,
    }],
    prompt_suggestions: ['保持小狗毛色、体型和动作连续'],
  };
  const normalizedAnimalContract = service._private.normalizeResult(animalContractFixture);
  assert.equal(normalizedAnimalContract.source_facts.animal_presence, true);
  assert.deepEqual(normalizedAnimalContract.source_facts.animal_actions, animalContractFixture.source_facts.animal_actions);
  assert.deepEqual(normalizedAnimalContract.animal_actions, animalContractFixture.animal_actions);
  assert.deepEqual(normalizedAnimalContract.animal_prompts, animalContractFixture.animal_prompts);
  assert.deepEqual(normalizedAnimalContract.shot_breakdown, animalContractFixture.shot_breakdown);
  assert.doesNotThrow(() => service._private.validateAnalysisResult(normalizedAnimalContract));

  const evidenceAuthoritative = service._private.mergeAnalysisWithEvidence(animalContractFixture, {
    scene_prompts: [{
      id: 'scene_model_summary',
      location_type: '模型概括场景',
      layout_prompt: '模型只返回少量概括场景，不能替换逐帧场景目录',
      material_light_prompt: '模型概括的材质和光线',
    }],
    shot_breakdown: [{
      order: 1,
      range: [0, 1],
      visual: '模型输出在此处被截断',
      action: '不完整动作',
      scene_id: '',
      subject_ids: [],
      shot_size: '',
      angle: '',
      movement: '',
      duration_seconds: 1,
    }],
    camera_intents: [{ range: [0, 1], movement: 'static' }],
  });
  assert.equal(evidenceAuthoritative.schema_version, 5);
  assert.deepEqual(evidenceAuthoritative.shot_breakdown, animalContractFixture.shot_breakdown, '模型整理不得覆盖完整逐帧证据分镜');
  assert.deepEqual(evidenceAuthoritative.camera_intents, normalizedAnimalContract.camera_intents, '模型整理不得覆盖逐帧机位证据');
  assert.deepEqual(evidenceAuthoritative.scene_prompts, normalizedAnimalContract.scene_prompts, '模型概括场景不得破坏证据分镜的 scene_id 映射');
  assert.doesNotThrow(() => service._private.validateAnalysisResult(evidenceAuthoritative));

  const thirtyTwoScenes = Array.from({ length: 32 }, (_, index) => ({
    ...animalContractFixture.scene_prompts[0],
    id: `scene_prompt_${index + 1}`,
    location_type: `独立证据空间${index + 1}`,
  }));
  const nineteenShots = Array.from({ length: 19 }, (_, index) => ({
    ...animalContractFixture.shot_breakdown[0],
    order: index + 1,
    range: [index, index + 1],
    scene_id: `scene_prompt_${Math.min(31, index * 2) + 1}`,
    duration_seconds: 1,
  }));
  const manySceneResult = service._private.normalizeResult({
    ...animalContractFixture,
    schema_version: 5,
    evidence_coverage: { complete: true },
    scene_prompts: thirtyTwoScenes,
    shot_breakdown: nineteenShots,
  });
  assert.equal(manySceneResult.scene_prompts.length, 32, '最终标准化不得截断仍被分镜引用的证据场景');
  assert.equal(manySceneResult.shot_breakdown.length, 19);
  assert.doesNotThrow(() => service._private.validateAnalysisResult(manySceneResult));
  const manySceneContext = contextBuilder.normalizeReferenceVideoAnalysis({ analysis_id: 'many-scenes', ...manySceneResult });
  assert.equal(manySceneContext.scene_prompts.length, 32, '上下文投影不得再次把证据场景截成 12 个');

  const normalizedAnimalContext = contextBuilder.normalizeReferenceVideoAnalysis({
    analysis_id: 'animal-contract',
    ...normalizedAnimalContract,
    status: 'completed',
    schema_version: 5,
    analysis_quality: { ...normalizedAnimalContract.analysis_quality, valid: true, visual_evidence_complete: true },
  });
  assert.deepEqual(normalizedAnimalContext.animal_actions, animalContractFixture.animal_actions);
  assert.deepEqual(normalizedAnimalContext.animal_prompts, animalContractFixture.animal_prompts);
  assert.deepEqual(normalizedAnimalContext.shot_breakdown, animalContractFixture.shot_breakdown);
  const animalDownstreamPrompt = contextBuilder.referenceVideoAnalysisPrompt(normalizedAnimalContext);
  ['animal_presence', 'animal_actions', 'animal_prompts', 'shot_breakdown', 'animal_dog_1']
    .forEach(term => assert.ok(animalDownstreamPrompt.includes(term), `${term} must survive into the downstream prompt`));

  const legacyV3 = {
    ...animalContractFixture,
    schema_version: 3,
    source_facts: { ...animalContractFixture.source_facts },
  };
  delete legacyV3.source_facts.animal_presence;
  delete legacyV3.source_facts.animal_actions;
  delete legacyV3.animal_actions;
  delete legacyV3.animal_prompts;
  delete legacyV3.shot_breakdown;
  assert.doesNotThrow(() => service._private.validateAnalysisResult(legacyV3));
  assert.doesNotThrow(() => contextBuilder.normalizeReferenceVideoAnalysis({
    analysis_id: 'legacy-v3',
    status: 'completed',
    analysis_quality: { valid: true },
    ...legacyV3,
  }));
  assert.throws(
    () => service._private.validateAnalysisResult({
      ...animalContractFixture,
      animal_actions: [],
      animal_prompts: [],
    }),
    error => error.failures.includes('animal_actions_missing') && error.failures.includes('animal_prompts_missing'),
  );
  const noAnimalContract = service._private.normalizeResult({
    ...animalContractFixture,
    source_facts: {
      ...animalContractFixture.source_facts,
      animal_presence: false,
      animal_actions: [],
    },
    animal_actions: [{ animal_id: 'invented', action: '凭空出现' }],
    animal_prompts: [{ id: 'invented', species: '猫' }],
    shot_breakdown: animalContractFixture.shot_breakdown.map(shot => ({
      ...shot,
      subject_ids: ['advertised_subject'],
      visual: shot.visual.replace(/小狗/g, '产品'),
      action: shot.action.replace(/小狗/g, '产品'),
    })),
  });
  assert.deepEqual(noAnimalContract.animal_actions, []);
  assert.deepEqual(noAnimalContract.animal_prompts, []);

  const structuredVision = [
    {
      timestamps: [0.3, 4.2],
      text: '以下是逐帧分析及总结：1. **时间点 0.3 秒** - 产品或服务：大玻璃全景幕墙窗 - 可见文字：新标门窗 - 真实环境：城市现代住宅客厅，窗外可见城市天际线 - 材质：透明玻璃、木饰面与米色沙发 - 颜色：米白、原木色与绿色 - 布局：人物站在窗边，沙发位于右侧 - 光线：自然侧光，室内明亮柔和 - 人物动作：女性侧身面向窗外。',
    },
  ];
  const compiledVision = service._private.compileAnalysisFromEvidence({
    source: { metadata: { duration_seconds: 8 } },
  }, structuredVision, {});
  assert.equal(compiledVision.source_facts.product_or_service, '大玻璃全景幕墙窗');
  assert.equal(compiledVision.source_facts.environment, '城市现代住宅客厅，窗外可见城市天际线');
  assert.equal(compiledVision.source_facts.materials[0], '透明玻璃、木饰面与米色沙发');
  assert.equal(compiledVision.source_facts.lighting, '自然侧光，室内明亮柔和');
  assert.ok(!compiledVision.scene_prompts[0].layout_prompt.includes('逐帧分析'));
  assert.ok(!compiledVision.scene_prompts[0].layout_prompt.includes('时间点'));
  assert.match(compiledVision.scene_prompts[0].layout_prompt, /城市现代住宅客厅/);
  assert.match(compiledVision.scene_prompts[0].material_light_prompt, /透明玻璃/);

  const porscheEvidence = [
    {
      timestamps: [0, 9],
      text: '产品或服务：不确定；真实环境：昏暗车库；材质：金属车身；颜色：银色；布局：车辆局部特写；光线：低调光；人物：无。',
    },
    {
      timestamps: [24.84, 29.74, 39.56, 44.46],
      text: '产品或服务：银色跑车，外观特征符合保时捷 Porsche 918 Spyder；可见文字：Porsche 918 Spyder；真实环境：湿润山路；材质：银色金属漆面、玻璃；颜色：银色、深绿色；布局：跑车沿山路行驶；光线：阴天自然光；人物：无。',
    },
  ];
  const porscheCompiled = service._private.compileAnalysisFromEvidence({
    source: { metadata: { duration_seconds: 44.513 } },
  }, porscheEvidence, {});
  const modelWithoutProduct = {
    ...porscheCompiled,
    source_facts: {
      ...porscheCompiled.source_facts,
      product_or_service: '',
    },
  };
  const mergedPorsche = service._private.mergeAnalysisWithEvidence(porscheCompiled, modelWithoutProduct);
  assert.match(mergedPorsche.source_facts.product_or_service, /保时捷|Porsche|918 Spyder/);
  assert.doesNotThrow(() => service._private.validateAnalysisResult(mergedPorsche));

  const productionLikeVision = [
    {
      timestamps: [0.3, 27.16],
      text: '以下是逐帧分析及总结： 1. **时间点 0.3 秒** - 产品或服务：现代多层住宅，配备大玻璃全景幕墙窗。 - 可见文字：“新标门窗 | 大玻璃全景幕墙窗”。 - 真实环境：城市中的现代建筑，建筑有多层阳台、绿色植被屋顶，背景为城市天际线和山脉。 - 材质：玻璃幕墙、木质外立面、混凝土结构。 - 颜色：棕色木质、灰色混凝土、透明玻璃。 - 布局：建筑居中，城市天际线在背景。 - 光线：自然日光。 - 人物：无。',
    },
    {
      timestamps: [36.11, 62.97],
      text: '### 逐帧说明 1. **36.11秒** - 产品或服务：窗帘（薄纱窗帘、深色系系带窗帘）。 - 可见文字：“50%开启面积，让风随意流动”。 - 真实环境：室内窗边，窗外可见山峦、绿植与建筑。 - 材质：薄纱窗帘（半透明，浅色系），深色系窗帘（厚实，深灰/棕色）。 - 颜色：窗帘为米白/浅色，深色系为深色调。 - 布局：窗帘部分开启，露出窗外自然景观。 - 光线：自然光，柔和。 - 人物：无。',
    },
  ];
  const productionLikeCompiled = service._private.compileAnalysisFromEvidence({
    source: { metadata: { duration_seconds: 80.9 } },
  }, productionLikeVision, {});
  const productionLikeNormalized = service._private.normalizeResult({
    status: 'completed',
    ...productionLikeCompiled,
  });
  assert.equal(productionLikeNormalized.source_facts.product_or_service, '大玻璃全景幕墙窗');
  assert.equal(productionLikeNormalized.source_facts.environment, '城市中的现代建筑，建筑有多层阳台、绿色植被屋顶，背景为城市天际线和山脉');
  assert.match(productionLikeNormalized.scene_prompts[1].layout_prompt, /室内窗边/);
  assert.match(productionLikeNormalized.scene_prompts[1].material_light_prompt, /薄纱窗帘/);
  assert.doesNotMatch(JSON.stringify(productionLikeNormalized), /逐帧分析|逐帧说明|时间点\s*\d+(?:\.\d+)?\s*秒/);
  const normalizedProductionContext = contextBuilder.buildContext({
    brief: productionLikeNormalized.generated_brief,
    product_subject: productionLikeNormalized.source_facts.product_or_service,
    reference_video_analysis: {
      analysis_id: 'production_like',
      status: 'completed',
      ...productionLikeNormalized,
    },
    person_spec: {
      age: 'adult_30_40',
      appearanceText: '30-40岁成熟青年年龄感，成熟青年年龄感，成熟青年年龄感，原创、可信的自然外观',
    },
  });
  assert.equal(
    normalizedProductionContext.person_spec.appearanceText,
    '30-40岁成熟青年年龄感，原创、可信的自然外观',
  );
  assert.doesNotMatch(JSON.stringify(normalizedProductionContext.reference_video_analysis), /逐帧分析|逐帧说明|时间点\s*\d+(?:\.\d+)?\s*秒/);
  const distinctSceneInput = {
    ...productionLikeCompiled,
    source_facts: {
      ...productionLikeCompiled.source_facts,
      environment: '自然景观与现代住宅空间',
    },
    scene_prompts: [{
      id: 'scene_mountain',
      location_type: '山脉自然景观',
      layout_prompt: '环境：广告展示空间；布局：山脉位于远景；广告主体：大玻璃全景幕墙窗',
      material_light_prompt: '材质：岩石与植被；光线：山间自然日光',
      interaction_prompt: '用自然景观建立品牌意境',
    }, {
      id: 'scene_living_room',
      location_type: '现代住宅客厅',
      layout_prompt: '环境：广告展示空间；布局：全景窗位于客厅正面；广告主体：大玻璃全景幕墙窗',
      material_light_prompt: '材质：玻璃与木饰面；光线：客厅自然侧光',
      interaction_prompt: '展示门窗与室内空间关系',
    }],
  };
  const sanitizedDistinctScenes = referenceEvidenceText.sanitizeAnalysis(distinctSceneInput);
  assert.deepEqual(
    sanitizedDistinctScenes.scene_prompts.map(item => item.location_type),
    ['山脉自然景观', '现代住宅客厅'],
    '场景自身名称不得被布局中重复的全片环境概述覆盖',
  );
  assert.throws(
    () => service._private.normalizeResult(distinctSceneInput),
    /shot_breakdown_incomplete/,
    '替换场景目录后没有同步逐镜 scene_id 时必须拒绝，不能留下悬空引用',
  );
  assert.throws(
    () => service._private.validateAnalysisResult({
      ...productionLikeCompiled,
      scene_prompts: productionLikeCompiled.scene_prompts.map((item, index) => ({
        ...item,
        id: `duplicate_scene_${index + 1}`,
        location_type: '同一个未区分的住宅空间',
      })),
    }),
    error => error.failures.includes('scene_locations_duplicated'),
    '真正无法区分的重复场景仍必须被质量门禁拒绝',
  );
  const failedReferenceContext = contextBuilder.normalizeReferenceVideoAnalysis({
    analysis_id: 'failed-scene-analysis',
    status: 'failed',
    error: {
      code: 'REFERENCE_VIDEO_ANALYSIS_SEMANTIC_INVALID',
      message: '参考视频识别结果不完整：scene_locations_duplicated',
      retryable: true,
      failures: ['scene_locations_duplicated'],
    },
  });
  assert.equal(failedReferenceContext.error.message, '参考视频识别结果不完整：scene_locations_duplicated');
  assert.deepEqual(failedReferenceContext.error.failures, ['scene_locations_duplicated']);

  const cachedFrames = testEvidenceFrames(8);
  const cachedRecord = {
    source: { metadata: { duration_seconds: 8 } },
    evidence_frames: cachedFrames,
  };
  cachedRecord._visual_evidence_cache = {
    contract_version: 'shot-aware-v2',
    key: service._private.visualEvidenceCacheKey(cachedRecord, cachedFrames),
    batches: [
      testVisionRow(cachedFrames.slice(0, 4), 1),
      testVisionRow(cachedFrames.slice(4, 8), 2),
    ],
  };
  assert.equal(service._private.hasReusableVisualEvidence(cachedRecord), true);
  assert.equal(service._private.hasReusableVisualEvidence({
    ...cachedRecord,
    _visual_evidence_cache: { ...cachedRecord._visual_evidence_cache, batches: [cachedRecord._visual_evidence_cache.batches[0], null] },
  }), false, '缺少任一视觉批次时禁止走缓存重试');
  const legacyNonEmptyCache = {
    ...cachedRecord,
    _visual_evidence_cache: {
      key: service._private.visualEvidenceCacheKey(cachedRecord, cachedFrames),
      batches: [{ text: '只有一帧的旧缓存文字' }, { text: '另一批非空文字' }],
    },
  };
  assert.equal(service._private.hasReusableVisualEvidence(legacyNonEmptyCache), false, '旧版非空文字缓存不得冒充逐帧覆盖完整');
  assert.throws(
    () => service._private.parseVisionEvidencePayload(JSON.stringify({
      frames: testVisionPayload(cachedFrames.slice(0, 4)).frames.slice(0, 1),
    }), cachedFrames.slice(0, 4)),
    error => error.code === 'REFERENCE_VIDEO_EVIDENCE_COVERAGE_INVALID',
    '视觉模型漏掉任一 frame_id 时必须立即拒绝该批次',
  );
  const repairablePayload = testVisionPayload(cachedFrames.slice(0, 4));
  const repairableJson = JSON.stringify(repairablePayload).replace(/}$/, ',}');
  const repairedEvidence = service._private.parseVisionEvidencePayload(
    `\`\`\`json\n${repairableJson}\n\`\`\``,
    cachedFrames.slice(0, 4),
  );
  assert.strictEqual(repairedEvidence.frames.length, 4, '完整证据只含 Markdown 包裹或尾逗号时应确定性修复，不得浪费视觉调用');
  const derivedSummaryPayload = testVisionPayload(cachedFrames.slice(0, 4));
  derivedSummaryPayload.frames.forEach(frame => { frame.summary = '不确定'; });
  const derivedSummaryEvidence = service._private.parseVisionEvidencePayload(
    JSON.stringify(derivedSummaryPayload),
    cachedFrames.slice(0, 4),
  );
  assert.ok(
    derivedSummaryEvidence.frames.every(frame => frame.summary.includes('测试门窗产品')),
    'summary 简短时应从同帧结构化证据生成摘要，不能与“单项可不确定”的提示词冲突',
  );
  const emptyEvidencePayload = testVisionPayload(cachedFrames.slice(0, 4));
  emptyEvidencePayload.frames = emptyEvidencePayload.frames.map(frame => ({
    frame_id: frame.frame_id,
    timestamp_seconds: frame.timestamp_seconds,
    product_or_service: '不确定',
    visible_text: [],
    environment: '未知',
    materials: [],
    colors: [],
    layout: '',
    lighting: '',
    human_presence: false,
    human_actions: [],
    animal_presence: false,
    animal_description: '',
    animal_actions: [],
    shot_size: '',
    angle: '',
    movement: '',
    summary: '不确定',
  }));
  assert.throws(
    () => service._private.parseVisionEvidencePayload(JSON.stringify(emptyEvidencePayload), cachedFrames.slice(0, 4)),
    error => error.code === 'REFERENCE_VIDEO_EVIDENCE_COVERAGE_INVALID',
    '真正没有可见内容的逐帧响应仍必须拒绝，不能用修复器降低证据门禁',
  );
  assert.throws(
    () => service._private.parseVisionEvidencePayload('{"frames":[}oops', cachedFrames.slice(0, 4)),
    error => error.code === 'PROVIDER_RESPONSE_INVALID'
      && error.response_diagnostics?.response_length > 0
      && !!error.response_diagnostics?.response_sha256,
    '无法修复的模型响应必须保留长度、哈希和解析原因，供失败任务追查',
  );
  assert.deepStrictEqual(
    modelGateway.classifyError({ code: 'REFERENCE_VIDEO_EVIDENCE_COVERAGE_INVALID', message: 'coverage failed' }),
    { code: 'REFERENCE_VIDEO_EVIDENCE_COVERAGE_INVALID', retryable: true },
    '逐帧覆盖错误不得再被降级成 UNKNOWN',
  );
  assert.throws(
    () => service._private.normalizeResult({
      ...animalContractFixture,
      evidence_coverage: { complete: false, expected_frame_count: 4, covered_frame_count: 1 },
    }),
    error => error.code === 'REFERENCE_VIDEO_ANALYSIS_SEMANTIC_INVALID'
      && error.failures.includes('visual_frame_coverage_incomplete'),
    '最终分析不得把覆盖不完整的视觉证据标记为有效',
  );
  assert.throws(
    () => service._private.validateAnalysisResult({
      ...productionLikeCompiled,
      source_facts: {
        ...productionLikeCompiled.source_facts,
        product_or_service: '现代多层住宅，配备大玻璃全景幕墙窗',
      },
    }),
    error => error.code === 'REFERENCE_VIDEO_ANALYSIS_SEMANTIC_INVALID'
      && error.failures.includes('source_product_environment_conflated'),
    'an environment carrying a product must never pass as the advertised subject',
  );
  const sampledFrames = service._private.selectEvidenceFrames(
    Array.from({ length: 10 }, (_, index) => ({ index })),
    8,
  );
  assert.strictEqual(sampledFrames.length, 8);
  assert.strictEqual(sampledFrames[0].index, 0);
  assert.strictEqual(sampledFrames[sampledFrames.length - 1].index, 9, 'the final brand/product card must always be sampled');
  assert.ok(sampledFrames.some(item => item.index === 8), 'the penultimate model/product frame must survive bounded sampling');
  const normalizedCuts = service._private.normalizeShotCuts(20, [0.1, 1, 1.2, 5, 19.8]);
  assert.deepStrictEqual(normalizedCuts, [1, 5]);
  const shotAwarePlan = service._private.buildShotAwareEvidencePlan(20, [1, 5]);
  assert.ok(shotAwarePlan.length > 8, '镜头感知取证不得再固定为八张');
  assert.ok(shotAwarePlan.every(item => item.frame_id && item.shot_index && item.shot_range.length === 2));
  assert.ok(new Set(shotAwarePlan.map(item => item.shot_index)).size >= 5, '超过六秒的长镜头必须继续拆分取证窗口');
  assert.throws(
    () => service._private.buildShotAwareEvidencePlan(180, Array.from({ length: 60 }, (_, index) => 1 + index * 2.5)),
    error => error.code === 'REFERENCE_VIDEO_TOO_MANY_SHOTS',
    '超过费用边界时必须显式阻止，不能静默丢弃后半段镜头',
  );

  settingsService.saveSettings({
    providers: [
      {
        id: 'deyunai',
        preset: 'deyunai',
        name: 'DeyunAI',
        api_url: 'https://api.deyunai.com/v1',
        api_key: 'test-deyunai-key',
        enabled: true,
        models: [
          { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', type: 'chat', use: 'story', enabled: true },
        ],
      },
      {
        id: 'zhipu',
        preset: 'zhipu',
        name: 'Zhipu',
        api_url: 'https://open.bigmodel.cn/api/paas/v4',
        api_key: 'test-zhipu-key',
        enabled: true,
        models: [],
      },
      {
        id: 'webang-maas',
        preset: 'webang-maas',
        name: 'Webang MaaS',
        api_url: 'https://example.invalid/v1',
        api_key: 'test-webang-key',
        enabled: true,
        models: [
          { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', type: 'chat', use: 'story', enabled: true },
        ],
      },
      {
        id: 'openai',
        preset: 'openai',
        name: 'OpenAI',
        api_url: 'https://api.openai.com/v1',
        api_key: 'test-openai-key',
        enabled: true,
        models: [
          { id: 'gpt-4o', name: 'GPT-4o', type: 'chat', use: 'story', enabled: true },
        ],
      },
    ],
    mcps: [],
    skills: [],
  });
  const routedVisionModels = modelGateway
    .candidatesForVisionStage('new_story_ad.reference_video_vision')
    .map(item => `${item.provider_id}/${item.model_id}`);
  assert.deepStrictEqual(routedVisionModels, [
    'deyunai/gemini-2.5-flash',
    'zhipu/glm-4.6v-flash',
    'webang-maas/gemini-2.5-flash',
  ], 'reference video analysis must use only its explicit VLM route');
  const routedAvailability = modelGateway.visionAvailability('new_story_ad.reference_video_vision');
  assert.strictEqual(routedAvailability.source, 'stage_route');
  assert.strictEqual(routedAvailability.available_count, 3);
  assert.ok(!routedAvailability.models.some(item => item.provider_id === 'openai'));
  assert.strictEqual(modelGateway.classifyError(new Error('401 该令牌已过期')).code, 'AUTH_CONFIG');
  assert.strictEqual(modelGateway.classifyError(new Error('Connection error.')).code, 'TIMEOUT_OR_NETWORK');

  const authBlockedModel = { provider_id: 'zhipu', model_id: 'glm-4.6v-flash' };
  const permanentAuthError = new Error('401 令牌已过期或验证不正确');
  modelGateway.recordHealth(authBlockedModel, { ok: false, error: permanentAuthError });
  assert.strictEqual(modelGateway.healthState(authBlockedModel).circuit_open, true);
  assert.strictEqual(modelGateway.healthState(authBlockedModel).blocked_until_config_change, true);
  const rotatedSettings = settingsService.loadSettings();
  const rotatedZhipu = rotatedSettings.providers.find(item => item.id === 'zhipu');
  rotatedZhipu.api_key = 'rotated-test-zhipu-key';
  settingsService.saveSettings(rotatedSettings);
  assert.strictEqual(
    modelGateway.healthState(authBlockedModel).circuit_open,
    false,
    'a credential change must create a fresh health identity and unblock validation',
  );
  rotatedZhipu.api_key = 'test-zhipu-key';
  settingsService.saveSettings(rotatedSettings);
  fs.rmSync(path.join(tempRoot, 'new_story_ad_model_health.json'), { force: true });

  const publicFailure = service._private.publicVisionFailure({
    code: 'VISION_QA_UNAVAILABLE',
    failures: ['scene_locations_duplicated'],
    failed_models: [
      { provider_id: 'zhipu', model_id: 'glm-4.6v-flash', code: 'AUTH_CONFIG', message: 'private provider detail' },
    ],
  });
  assert.deepStrictEqual(publicFailure.failed_models, [{
    provider_id: 'zhipu',
    model_id: 'glm-4.6v-flash',
    code: 'AUTH_CONFIG',
    retry_after_ms: 0,
  }]);
  assert.deepStrictEqual(publicFailure.failures, ['scene_locations_duplicated']);
  assert.ok(!JSON.stringify(publicFailure).includes('private provider detail'));

  const user = { id: 'reference-video-test-user' };
  const legacyAnalysisId = 'ref_video_legacy_semantic_contract';
  const legacyDir = service._private.analysisDir(user.id, legacyAnalysisId);
  fs.mkdirSync(legacyDir, { recursive: true });
  const legacyRow = {
    ...familyEvidence[0],
    contract_version: 'shot-aware-v1',
    payload: { ...familyEvidence[0].payload, contract_version: 'shot-aware-v1' },
  };
  const legacyRecord = {
    id: legacyAnalysisId,
    analysis_id: legacyAnalysisId,
    user_id: user.id,
    status: 'completed',
    progress: 100,
    phase: 'legacy completed',
    source: { kind: 'upload', metadata: { duration_seconds: 4 } },
    evidence_frames: familyFrames,
    transcript: { status: 'no_audio', text: '', segments: [] },
    result: { source_facts: { human_presence: true, animal_presence: true }, character_prompts: [{}], animal_prompts: [{}, {}] },
    _visual_evidence_cache: {
      contract_version: 'shot-aware-v1',
      key: 'legacy-cache-key',
      batches: [legacyRow],
    },
    _synthesis_raw: {
      contract_version: 'shot-aware-v1',
      text: JSON.stringify({
        ...familyCompiled,
        story_outline: {
          logline: '一家三口在明亮住宅中体验全景天窗带来的开阔生活。',
          opening: '自然风景与飞鸟建立室内外相连的视觉主题。',
          development: '住宅外观和全景玻璃逐步展示产品结构与采光。',
          turning_point: '镜头进入客餐厅，三名家庭成员分别出现在厨房和沙发区域。',
          resolution: '一家三口共同享受全景天窗带来的明亮空间。',
        },
      }),
      used_model: 'stored/test-model',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(legacyDir, 'record.json'), JSON.stringify(legacyRecord, null, 2));
  const originalLegacyText = modelGateway.generateText;
  const originalLegacyVision = modelGateway.generateVision;
  const originalMockMode = process.env.NEW_STORY_AD_MOCK_LLM;
  let legacyModelCalls = 0;
  modelGateway.generateText = async () => { legacyModelCalls += 1; throw new Error('stored contract migration must not call text model'); };
  modelGateway.generateVision = async () => { legacyModelCalls += 1; throw new Error('stored contract migration must not call vision model'); };
  try {
    process.env.NEW_STORY_AD_MOCK_LLM = '0';
    await assert.rejects(
      () => service.rebuildStoredAnalysis(legacyAnalysisId, user),
      error => error.code === 'REFERENCE_VIDEO_ANALYSIS_SEMANTIC_INVALID'
        && error.failures.includes('semantic_understanding_missing'),
      '缺少真实深度语义的旧记录不得零模型伪造为 V6 完整报告',
    );
    assert.equal(legacyModelCalls, 0, '旧证据契约升级必须保持零模型调用，避免重复付费');
    assert.equal(service._private.readRecord(user.id, legacyAnalysisId).evidence_frames.length, familyFrames.length, '拒绝伪迁移后必须保留原始证据帧');
  } finally {
    process.env.NEW_STORY_AD_MOCK_LLM = originalMockMode;
    modelGateway.generateText = originalLegacyText;
    modelGateway.generateVision = originalLegacyVision;
    service.remove(legacyAnalysisId, user);
  }
  const input = path.join(tempRoot, 'input.mp4');
  execFileSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:s=720x1280:d=3:r=24',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    input,
  ], { windowsHide: true });
  const directInput = path.join(tempRoot, 'direct-input.mp4');
  fs.copyFileSync(input, directInput);

  let releaseLinkedDownload;
  const linkedDownloadGate = new Promise(resolve => { releaseLinkedDownload = resolve; });
  const linkedSource = path.join(tempRoot, 'linked-source.mp4');
  fs.copyFileSync(input, linkedSource);
  const linked = await service.createFromUrl({
    body: {
      url: 'https://video.example.com/reference.mp4',
      task_id: 'task-bound-link-auto-start',
      rights_confirmed: 'true',
    },
    user,
    linkService: {
      async inspectUrl() {
        return {
          url: 'https://video.example.com/reference.mp4',
          display_url: 'https://video.example.com/reference.mp4',
          platform: 'public_web',
          hostname: 'video.example.com',
          resolved_addresses: ['203.0.113.10'],
        };
      },
      async downloadVideo(_url, directory, options = {}) {
        options.onProgress?.(512, 1024);
        await linkedDownloadGate;
        const target = path.join(directory, 'source.mp4');
        fs.copyFileSync(linkedSource, target);
        options.onProgress?.(1024, 1024);
        return {
          file_path: target,
          original_name: 'new-linked-reference.mp4',
          mimetype: 'video/mp4',
          size_bytes: fs.statSync(target).size,
          method: 'test-direct',
        };
      },
    },
  });
  assert.equal(linked.status, 'importing');
  assert.equal(linked.task_id, 'task-bound-link-auto-start');
  assert.ok(service._private.activeImports.has(linked.id), '链接下载等待期间必须立即返回可轮询的新分析 ID');
  releaseLinkedDownload();
  await service._private.activeImports.get(linked.id).promise;
  const linkedCompleted = await waitFor(linked.id, user, ['completed', 'failed']);
  assert.equal(linkedCompleted.status, 'completed', '绑定任务的链接读取完成后必须脱离浏览器自动启动并完成分析');
  assert.equal(linkedCompleted.source.original_name, 'new-linked-reference.mp4');
  if (service._private.activeRuns.get(linked.id)) await service._private.activeRuns.get(linked.id);
  service.remove(linked.id, user);

  const cutInput = path.join(tempRoot, 'shot-cut-input.mp4');
  execFileSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=640x360:d=2:r=24',
    '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:d=2:r=24',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    cutInput,
  ], { windowsHide: true });
  const cutRecord = {
    id: 'shot-cut-evidence-test',
    user_id: user.id,
    source: {
      local_path: cutInput,
      metadata: { duration_seconds: 4, width: 640, height: 360, has_audio: false },
    },
  };
  const detectedCuts = await service._private.detectShotBoundaries(cutRecord);
  assert.ok(detectedCuts.cuts.some(value => Math.abs(value - 2) < 0.15), '真实硬切必须被 ffmpeg 场景检测识别');
  const detectedPlan = service._private.buildShotAwareEvidencePlan(4, detectedCuts.cuts);
  assert.ok(new Set(detectedPlan.map(item => item.shot_index)).size >= 2);
  const detectedFrames = await service._private.extractEvidenceFrames(cutRecord, detectedPlan);
  assert.equal(detectedFrames.length, detectedPlan.length);
  assert.ok(detectedFrames.every((frame, index) => frame.frame_id === detectedPlan[index].frame_id && fs.existsSync(require('../src/services/newStoryAd/mediaAdapter').assetPathFromName(frame.filename))));

  const cachedRetryId = 'ref_video_cached_semantic_retry';
  const cachedRetryDir = service._private.analysisDir(user.id, cachedRetryId);
  fs.mkdirSync(cachedRetryDir, { recursive: true });
  const cachedRetrySource = path.join(cachedRetryDir, 'source.mp4');
  fs.copyFileSync(input, cachedRetrySource);
  const cachedRetryRecord = {
    id: cachedRetryId,
    user_id: user.id,
    task_id: '',
    status: 'failed',
    progress: 55,
    phase: '分析失败',
    cancelled: false,
    rights_confirmed: true,
    identity_extraction_allowed: false,
    downstream_generation_triggered: false,
    source: {
      kind: 'upload',
      original_name: 'cached-retry.mp4',
      local_path: cachedRetrySource,
      private_directory: cachedRetryDir,
      size_bytes: fs.statSync(cachedRetrySource).size,
      metadata: { duration_seconds: 3, width: 720, height: 1280, video_codec: 'h264', has_audio: true },
    },
    evidence_frames: cachedFrames,
    transcript: { status: 'failed_non_blocking', text: '', segments: [] },
    checkpoints: [],
    result: null,
    error: {
      code: 'REFERENCE_VIDEO_ANALYSIS_SEMANTIC_INVALID',
      message: '参考视频识别结果不完整：scene_locations_duplicated',
      retryable: true,
      failures: ['scene_locations_duplicated'],
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    started_at: '2020-01-01T00:00:00.000Z',
    completed_at: '2020-01-01T00:01:00.000Z',
    failed_at: '2020-01-01T00:01:00.000Z',
  };
  cachedRetryRecord._visual_evidence_cache = {
    contract_version: 'shot-aware-v2',
    key: service._private.visualEvidenceCacheKey(cachedRetryRecord, cachedFrames),
    batches: cachedRecord._visual_evidence_cache.batches,
  };
  fs.writeFileSync(path.join(cachedRetryDir, 'record.json'), JSON.stringify(cachedRetryRecord, null, 2));
  const cachedRetryStarted = service.start(cachedRetryId, user);
  assert.equal(cachedRetryStarted.accepted, true);
  assert.notEqual(cachedRetryStarted.record.started_at, '2020-01-01T00:00:00.000Z', '重试必须重新计算本次耗时');
  assert.equal(cachedRetryStarted.record.completed_at, '');
  assert.equal(cachedRetryStarted.record.failed_at, '');
  assert.equal(cachedRetryStarted.record.phase, '已复用画面证据，等待重新整理');
  const cachedRetryCompleted = await waitFor(cachedRetryId, user, ['completed', 'failed']);
  assert.equal(cachedRetryCompleted.status, 'completed');
  assert.ok(cachedRetryCompleted.checkpoints.some(item => item.phase === '已复用画面证据，重新整理分析结构'));
  assert.equal(cachedRetryCompleted.result.analysis_quality.valid, true);
  if (service._private.activeRuns.get(cachedRetryId)) await service._private.activeRuns.get(cachedRetryId);
  assert.equal(service._private.activeRuns.has(cachedRetryId), false, '缓存快速恢复完成后不得残留幽灵活动任务');
  service.remove(cachedRetryId, user);

  const uploadSession = service.createUploadSession({
    body: {
      file_name: 'resumable-reference.mp4',
      size_bytes: fs.statSync(input).size,
      mimetype: 'video/mp4',
      last_modified: 123456,
      chunk_size: 1024 * 1024,
      rights_confirmed: 'true',
    },
    user,
  });
  const resumedSession = service.createUploadSession({
    body: {
      file_name: 'resumable-reference.mp4',
      size_bytes: fs.statSync(input).size,
      mimetype: 'video/mp4',
      last_modified: 123456,
      chunk_size: 1024 * 1024,
      rights_confirmed: 'true',
    },
    user,
  });
  assert.strictEqual(resumedSession.id, uploadSession.id);
  const chunkFile = path.join(tempRoot, 'chunk-0.part');
  fs.copyFileSync(input, chunkFile);
  const chunked = service.saveUploadChunk(uploadSession.id, 0, {
    path: chunkFile,
    size: fs.statSync(chunkFile).size,
  }, user);
  assert.deepStrictEqual(chunked.received_chunks, [0]);
  const completedUpload = await service.completeUploadSession(uploadSession.id, user);
  assert.strictEqual(completedUpload.session.status, 'completed');
  assert.ok(completedUpload.analysis.id);
  service.remove(completedUpload.analysis.id, user);

  const uploaded = await service.create({
    file: {
      path: directInput,
      originalname: 'reference.mp4',
      mimetype: 'video/mp4',
      size: fs.statSync(directInput).size,
    },
    body: { rights_confirmed: 'true' },
    user,
  });
  assert.strictEqual(uploaded.status, 'uploaded');
  assert.strictEqual(uploaded.identity_extraction_allowed, false);
  assert.ok(uploaded.source.metadata.duration_seconds >= 2.9);
  assert.strictEqual(uploaded.source.local_path, undefined, 'private video path must not leave the service');
  assert.throws(() => service._private.validateUpload(
    { originalname: 'too-long.mp4', size: 1024 },
    { width: 720, height: 1280, duration_seconds: 180.01 },
  ), /180 秒/);
  assert.throws(() => service._private.validateUpload(
    { originalname: 'wrong.avi', size: 1024 },
    { width: 720, height: 1280, duration_seconds: 10 },
  ), /MP4、MOV 或 WebM/);

  const guardedInput = path.join(tempRoot, 'guarded-input.mp4');
  fs.copyFileSync(input, guardedInput);
  const guarded = await service.create({
    file: {
      path: guardedInput,
      originalname: 'guarded-reference.mp4',
      mimetype: 'video/mp4',
      size: fs.statSync(guardedInput).size,
    },
    body: { rights_confirmed: 'true' },
    user,
  });
  const authError = new Error('test auth failure');
  authError.code = 'AUTH_CONFIG';
  modelGateway.recordHealth({ provider_id: 'deyunai', model_id: 'gemini-2.5-flash' }, { ok: false, error: authError });
  modelGateway.recordHealth({ provider_id: 'zhipu', model_id: 'glm-4.6v-flash' }, { ok: false, error: authError });
  modelGateway.recordHealth({ provider_id: 'webang-maas', model_id: 'gemini-2.5-flash' }, { ok: false, error: authError });
  const mockBeforeGuard = process.env.NEW_STORY_AD_MOCK_LLM;
  process.env.NEW_STORY_AD_MOCK_LLM = '0';
  assert.throws(
    () => service.start(guarded.id, user),
    error => error.code === 'VISION_CIRCUIT_OPEN' && error.status === 503,
    'an unavailable runtime route must fail before queueing or issuing a model call',
  );
  process.env.NEW_STORY_AD_MOCK_LLM = mockBeforeGuard;
  const guardedAfter = service.get(guarded.id, user);
  assert.strictEqual(guardedAfter.status, 'uploaded');
  assert.strictEqual(guardedAfter.error, null);
  service.remove(guarded.id, user);
  fs.rmSync(modelGateway.visionAvailability('new_story_ad.reference_video_vision').models.length
    ? path.join(tempRoot, 'new_story_ad_model_health.json')
    : path.join(tempRoot, 'unused-health.json'), { force: true });

  const started = service.start(uploaded.id, user);
  assert.strictEqual(started.accepted, true);
  const duplicate = service.start(uploaded.id, user);
  assert.strictEqual(duplicate.duplicate, true, 'start must be idempotent');

  const completed = await waitFor(uploaded.id, user, ['completed', 'failed']);
  assert.strictEqual(completed.status, 'completed', JSON.stringify(completed.error || {}));
  assert.strictEqual(completed.progress, 100);
  assert.ok(completed.checkpoints.length >= 5);
  assert.strictEqual(completed.downstream_generation_triggered, false);
  assert.strictEqual(completed.result.analysis_scope, 'reference_content_and_creative_structure');
  assert.ok(completed.result.prohibited_reuse.includes('person_identity'));
  assert.ok(completed.result.camera_intents.length >= 2);
  assert.ok(completed.result.camera_intents.every(item => item.evidence_timestamps.length));
  assert.ok(completed.result.character_actions.every(item => item.start_pose && item.key_action && item.end_pose));
  assert.ok(completed.result.story_outline.logline);
  assert.ok(completed.result.character_prompts.length >= 1);
  assert.ok(completed.result.character_prompts.every(item => item.role && item.wardrobe_direction && item.continuity_rules));
  assert.ok(completed.result.scene_prompts.length >= 1);
  assert.ok(completed.result.scene_prompts.every(item => item.layout_prompt && item.material_light_prompt && item.camera_purpose));
  assert.ok(completed.result.generated_brief.includes('【完整剧情】'));
  assert.ok(completed.result.generated_brief.includes('【人物提示词】'));
  assert.ok(completed.result.generated_brief.includes('【场景提示词】'));
  assert.ok(completed.result.generated_brief.includes('【核心卖点】'));
  assert.doesNotMatch(completed.result.generated_brief, /【运镜与节奏】|【场景与机位】/);
  assert.strictEqual(completed.result.output_language, 'zh-CN');
  assert.ok(/[\u3400-\u9fff]{12}/.test(completed.result.generated_brief), 'generated brief must be readable Simplified Chinese');
  assert.strictEqual(completed.result.transcript.status, 'mocked');
  assert.ok(completed.result.transcript.segments.length >= 1);
  assert.strictEqual(completed.result.analysis_quality.valid, true);
  assert.strictEqual(completed.result.analysis_quality.visual_evidence_complete, true);
  assert.strictEqual(completed.result.analysis_quality.expected_evidence_frames, completed.result.evidence_frames.length);
  assert.strictEqual(completed.result.analysis_quality.covered_evidence_frames, completed.result.evidence_frames.length);
  assert.ok(completed.result.source_facts.product_or_service);
  assert.ok(completed.result.generated_brief.includes('【参考内容事实】'));
  const privateVisionFrame = service._private.frameVisionUrl(completed.result.evidence_frames[0]);
  assert.ok(privateVisionFrame.startsWith('data:image/jpeg;base64,'), 'vision provider must receive embedded evidence instead of a localhost URL');
  assert.ok(!privateVisionFrame.includes('localhost'));
  assert.throws(
    () => service.reanalyze(uploaded.id, user),
    error => error.code === 'REFERENCE_VIDEO_REANALYSIS_NOT_REQUIRED' && error.status === 409,
    '已经通过质量门的完成记录不得误触发重复付费识别',
  );

  const invalidReanalysisId = `ref_video_${'r'.repeat(70)}`;
  const invalidReanalysisDir = service._private.analysisDir(user.id, invalidReanalysisId);
  fs.mkdirSync(invalidReanalysisDir, { recursive: true });
  const invalidReanalysisSource = path.join(invalidReanalysisDir, 'source.mp4');
  fs.copyFileSync(service._private.readRecord(user.id, uploaded.id).source.local_path, invalidReanalysisSource);
  const invalidReanalysisRecord = JSON.parse(JSON.stringify(service._private.readRecord(user.id, uploaded.id)));
  invalidReanalysisRecord.id = invalidReanalysisId;
  invalidReanalysisRecord.analysis_id = invalidReanalysisId;
  invalidReanalysisRecord.source.local_path = invalidReanalysisSource;
  invalidReanalysisRecord.source.private_directory = invalidReanalysisDir;
  invalidReanalysisRecord.result.analysis_quality.valid = false;
  invalidReanalysisRecord.result.analysis_quality.reference_understanding_complete = false;
  invalidReanalysisRecord.result.reference_understanding.completeness.valid = false;
  invalidReanalysisRecord.result.reference_understanding.completeness.failures = ['story_semantic_generic'];
  const invalidReanalysisBatches = [];
  for (let index = 0; index < invalidReanalysisRecord.evidence_frames.length; index += 4) {
    invalidReanalysisBatches.push(testVisionRow(
      invalidReanalysisRecord.evidence_frames.slice(index, index + 4),
      invalidReanalysisBatches.length + 1,
    ));
  }
  invalidReanalysisRecord._visual_evidence_cache = {
    contract_version: 'shot-aware-v2',
    batches: invalidReanalysisBatches,
    completed_batch_indexes: invalidReanalysisBatches.map((_, index) => index),
    failed_attempts: {},
  };
  invalidReanalysisRecord._visual_evidence_cache.key = service._private.visualEvidenceCacheKey(
    invalidReanalysisRecord,
    invalidReanalysisRecord.evidence_frames,
  );
  fs.writeFileSync(
    path.join(invalidReanalysisDir, 'record.json'),
    JSON.stringify(invalidReanalysisRecord, null, 2),
  );
  const originalTerminalSync = referenceAnalysisTaskSync.syncTerminalAnalysis;
  let failedTerminalSyncs = 0;
  referenceAnalysisTaskSync.syncTerminalAnalysis = async (analysis) => {
    if (analysis.status === 'failed') failedTerminalSyncs += 1;
    return { synced: false, reason: 'test_projection', model_call_count: 0 };
  };
  const preparationFailure = new Error('project reset failed before model execution');
  preparationFailure.code = 'REFERENCE_REANALYSIS_PREPARE_FAILED';
  const failedPreparationStart = service.reanalyze(invalidReanalysisId, user, {
    beforeRun: async () => { throw preparationFailure; },
  });
  assert.equal(failedPreparationStart.accepted, true);
  const failedPreparationRecord = await waitFor(invalidReanalysisId, user, ['failed']);
  assert.equal(failedPreparationRecord.error.code, 'REFERENCE_REANALYSIS_PREPARE_FAILED');
  assert.equal(failedTerminalSyncs, 1, 'server lifecycle must synchronize failed terminal state without browser polling');
  referenceAnalysisTaskSync.syncTerminalAnalysis = originalTerminalSync;

  let releasePreparation;
  let preparationStarted = false;
  const preparationGate = new Promise(resolve => { releasePreparation = resolve; });
  const invalidReanalysisStarted = service.reanalyze(invalidReanalysisId, user, {
    beforeRun: async () => {
      preparationStarted = true;
      await preparationGate;
    },
  });
  assert.equal(preparationStarted, false, 'reanalysis acknowledgement must return before background preparation starts');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(preparationStarted, true, 'background preparation must start before analysis execution');
  assert.equal(service.get(invalidReanalysisId, user).status, 'queued', 'paid analysis must not start before preparation completes');
  assert.equal(invalidReanalysisStarted.accepted, true, '质量无效完成态必须复用同一视频 ID 进入重新识别队列');
  assert.equal(invalidReanalysisStarted.record.status, 'queued');
  assert.equal(invalidReanalysisStarted.record.progress, 1, '重新识别必须开启新的进度与耗时，不能重放旧 100%');
  assert.equal(invalidReanalysisStarted.record.result, null, '排队前必须撤下旧的不合格语义结果');
  assert.equal(invalidReanalysisStarted.record.reanalysis.visual_evidence_reused, true, '完整逐帧缓存应保留并避免重复视觉调用');
  assert.ok(invalidReanalysisStarted.record.reanalysis.previous_result_digest, '旧结果只保留审计摘要，不得继续作为当前结果');
  const concurrentInvalidReanalysis = service.reanalyze(invalidReanalysisId, user);
  assert.equal(concurrentInvalidReanalysis.duplicate, true, '并发重复点击重新识别必须幂等，不能创建第二个付费任务');
  releasePreparation();
  const invalidReanalysisCompleted = await waitFor(invalidReanalysisId, user, ['completed', 'failed']);
  assert.equal(invalidReanalysisCompleted.status, 'completed');
  assert.equal(invalidReanalysisCompleted.result.analysis_quality.valid, true);
  assert.equal(invalidReanalysisCompleted.source.original_name, completed.source.original_name, '重新识别必须保留当前视频来源');
  if (service._private.activeRuns.get(invalidReanalysisId)) await service._private.activeRuns.get(invalidReanalysisId);
  assert.equal(service._private.activeRuns.has(invalidReanalysisId), false, '重新识别完成后不得残留活动任务');
  service.remove(invalidReanalysisId, user);

  const legacyAuthTranscript = {
    status: 'failed_non_blocking',
    text: '',
    segments: [],
    error: {
      code: 'ERR_BAD_REQUEST',
      message: 'Request failed with status code 401',
    },
  };
  assert.strictEqual(service._private.isReusableTranscriptFailure(legacyAuthTranscript), true);
  assert.strictEqual(service._private.isReusableTranscriptFailure({
    status: 'failed_non_blocking',
    error: { code: 'RATE_LIMIT', message: 'HTTP 429 rate limit', retryable: true },
  }), false);
  assert.strictEqual(
    await service._private.transcribeAudio({
      transcript: legacyAuthTranscript,
      source: { metadata: { has_audio: true } },
    }),
    legacyAuthTranscript,
    'a legacy 401 transcript failure must not issue another provider request during visual recovery',
  );
  assert.strictEqual(
    service._private.isReusableTranscriptFailure({
      status: 'failed_non_blocking',
      error: { code: 'AUTH_CONFIG', message: 'invalid credential', retryable: false },
    }),
    true,
  );

  assert.throws(
    () => service._private.normalizeResult({ data: "I'm sorry, I can't assist with that." }),
    error => error.code === 'REFERENCE_VIDEO_ANALYSIS_SEMANTIC_INVALID'
      && error.failures.includes('provider_refusal')
      && error.failures.includes('story_outline_incomplete')
      && error.failures.includes('scene_prompts_incomplete'),
    'provider refusal must not become a completed generic Chinese brief',
  );
  assert.equal(
    service._private.assertCandidateAnalysisText(JSON.stringify({
      source_facts: { product_or_service: '测试产品' },
      reference_understanding: { story_summary: { logline: '测试故事' } },
    })),
    true,
    'a parseable partial JSON response must reach deterministic merge and the deep semantic quality gate',
  );
  assert.throws(
    () => service._private.assertCandidateAnalysisText('plain text without a structured object'),
    error => error.code === 'PROVIDER_RESPONSE_INVALID',
    'non-structured semantic output must still fall through to another candidate',
  );

  const times = service._private.evidenceTimes(10.194);
  assert.ok(times.length >= 6, 'short product videos need more than four evidence frames');
  assert.ok(times[0] <= 0.3, 'opening product/title evidence must be sampled');
  assert.ok(times[times.length - 1] >= 10.1, 'ending result/CTA evidence must be sampled');
  assert.deepStrictEqual(
    modelGateway.diversifyVisionCandidates([
      { provider_id: 'provider-a', model_id: 'a1' },
      { provider_id: 'provider-a', model_id: 'a2' },
      { provider_id: 'provider-b', model_id: 'b1' },
      { provider_id: 'provider-c', model_id: 'c1' },
    ]).map(item => item.model_id),
    ['a1', 'b1', 'c1', 'a2'],
    'vision fallback must cross provider boundaries before retrying the same provider',
  );
  assert.deepStrictEqual(
    modelGateway.preferReferenceVisionCandidates([
      { provider_id: 'deyunai', model_id: 'gpt-4o' },
      { provider_id: 'deyunai', model_id: 'gemini-2.5-pro' },
      { provider_id: 'deyunai', model_id: 'gemini-2.5-flash' },
      { provider_id: 'zhipu', model_id: 'glm-4.6v' },
    ], 'new_story_ad.reference_video_vision').map(item => item.model_id),
    ['gemini-2.5-flash', 'gemini-2.5-pro', 'gpt-4o', 'glm-4.6v'],
    'reference analysis must prefer the faster compatible vision model within each provider',
  );

  const previousMock = process.env.NEW_STORY_AD_MOCK_LLM;
  process.env.NEW_STORY_AD_MOCK_LLM = '0';
  const providerVisionInputs = {};
  const fallbackVision = await modelGateway.generateVision({
    taskId: 'reference-video-semantic-fallback',
    stage: 'new_story_ad.reference_video_vision',
    systemPrompt: 'test',
    userPrompt: 'test',
    imageUrls: ['https://example.com/reference-frame.jpg'],
    imageDataUrls: ['data:image/jpeg;base64,YWJj'],
    maxCandidates: 3,
    _candidateModels: [
      { provider_id: 'deyunai', model_id: 'empty-model' },
      { provider_id: 'zhipu', model_id: 'refusal-model' },
      { provider_id: 'openai', model_id: 'valid-model' },
    ],
    _generateText: async ({ model, messages }) => {
      providerVisionInputs[model.provider_id] = messages[1].content[1].image_url.url;
      if (model.model_id === 'empty-model') {
        const error = new Error('provider returned no visible content');
        error.code = 'PROVIDER_EMPTY_RESPONSE';
        throw error;
      }
      return {
        text: model.model_id === 'refusal-model'
        ? JSON.stringify({ data: "I'm sorry, I can't assist with that." })
        : JSON.stringify({
          source_facts: {},
          story_outline: {},
          plot_beats: [],
          scene_prompts: [],
          camera_intents: [],
        }),
        adapter: 'test',
      };
    },
    validateText: service._private.assertCandidateAnalysisText,
  });
  assert.strictEqual(fallbackVision.fallback_used, true, 'semantic refusal must fall through to the next vision candidate');
  assert.strictEqual(fallbackVision.used_model, 'openai/valid-model');
  assert.ok(
    providerVisionInputs.deyunai.startsWith('data:image/jpeg;base64,'),
    'deyunai must also receive embedded evidence when a complete local-safe data URL set is available',
  );
  assert.ok(providerVisionInputs.zhipu.startsWith('data:image/jpeg;base64,'));
  assert.ok(providerVisionInputs.openai.startsWith('data:image/jpeg;base64,'));
  assert.deepStrictEqual(
    fallbackVision.failed_models.map(item => item.code),
    ['PROVIDER_EMPTY_RESPONSE', 'PROVIDER_RESPONSE_INVALID'],
  );
  const rateLimitAttempts = [];
  const rateLimitFallback = await modelGateway.generateVision({
    taskId: 'reference-video-rate-limit-fallback',
    stage: 'new_story_ad.reference_video_vision',
    systemPrompt: 'test',
    userPrompt: 'test',
    imageUrls: ['https://example.com/reference-frame.jpg'],
    imageDataUrls: ['data:image/jpeg;base64,YWJj'],
    maxCandidates: 2,
    _candidateModels: [
      { provider_id: 'rate-limited-provider', model_id: 'primary-vision' },
      { provider_id: 'backup-provider', model_id: 'backup-vision' },
    ],
    _generateText: async ({ model }) => {
      rateLimitAttempts.push(`${model.provider_id}/${model.model_id}`);
      if (model.model_id === 'primary-vision') {
        const error = new Error('HTTP 429 rate limit');
        error.code = 'RATE_LIMIT';
        throw error;
      }
      return {
        text: '备用视觉模型已返回完整广告证据：画面依次展示门窗产品、客厅空间、金属边框与玻璃材质、自然光线、人物开关门动作、品牌文字、产品特写、景别变化和结尾行动号召；每个时间点都说明了真实可见内容及其在完整广告剧情中的推进作用，没有编造画面外信息。',
        adapter: 'test',
      };
    },
    validateText: text => String(text || '').length >= 80,
  });
  process.env.NEW_STORY_AD_MOCK_LLM = previousMock;
  assert.deepStrictEqual(rateLimitAttempts, [
    'rate-limited-provider/primary-vision',
    'backup-provider/backup-vision',
  ]);
  assert.strictEqual(rateLimitFallback.fallback_used, true);
  assert.strictEqual(rateLimitFallback.used_model, 'backup-provider/backup-vision');
  assert.deepStrictEqual(rateLimitFallback.failed_models.map(item => item.code), ['RATE_LIMIT']);
  assert.ok(
    rateLimitFallback.failed_models[0].retry_after_ms >= 4 * 60 * 1000,
    'rate-limited vision candidates must expose their circuit cooldown instead of returning retry_after_ms=0',
  );

  const originalGenerateVision = modelGateway.generateVision;
  const originalGenerateText = modelGateway.generateText;
  const originalVisionCandidates = modelGateway.candidatesForVisionStage;
  const visualBatchSizes = [];
  let activeVisualBatches = 0;
  let peakVisualBatches = 0;
  let synthesisCalls = 0;
  const stagedFrames = testEvidenceFrames(8, 'frame');
  const stagedContract = {
    source_facts: {
      product_or_service: '测试产品',
      visible_text: [],
      environment: '测试场景',
      materials: ['测试材质'],
      colors: ['测试颜色'],
      layout: '测试布局',
      lighting: '测试光线',
      human_presence: false,
      human_actions: [],
      chronological_story: ['开场', '展示', '结尾'],
      evidence_timestamps: [0, 1, 2, 3, 4, 5, 6, 7],
    },
    summary: '测试广告摘要',
    generated_brief: '【参考内容事实】测试产品',
    story_outline: {
      logline: '测试故事',
      opening: '测试开场',
      development: '测试发展',
      turning_point: '测试转折',
      resolution: '测试结尾',
    },
    plot_beats: [{ purpose: '测试开场' }, { purpose: '测试结尾' }],
    character_prompts: [],
    scene_prompts: [{ location_type: '测试场景', layout_prompt: '测试布局', material_light_prompt: '测试材质与光线' }],
    camera_intents: [{ range: [0, 1], movement: 'static' }],
    character_actions: [],
    subtitle_cta: '测试行动号召',
    prompt_suggestions: ['测试提示词'],
  };
  try {
    modelGateway.candidatesForVisionStage = () => [
      { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 1, enabled: true },
    ];
    modelGateway.generateVision = async (options) => {
      activeVisualBatches += 1;
      peakVisualBatches = Math.max(peakVisualBatches, activeVisualBatches);
      visualBatchSizes.push(options.imageUrls.length);
      const batchFrames = options.imageUrls.map(url => stagedFrames.find(frame => frame.image_url === url));
      const text = JSON.stringify(testVisionPayload(batchFrames));
      await options.validateText(text);
      await new Promise(resolve => setTimeout(resolve, 20));
      activeVisualBatches -= 1;
      return { text, used_model: 'deyunai/gemini-2.5-flash' };
    };
    modelGateway.generateText = async (options) => {
      synthesisCalls += 1;
      throw new Error(`unexpected synthesis model call: ${options.stage}`);
    };
    const staged = await service._private.analyzeWithModels({
      id: 'batch-analysis-test',
      source: { metadata: { duration_seconds: 8 } },
    }, stagedFrames, { status: 'no_audio', text: '' });
    assert.deepStrictEqual(visualBatchSizes, [4, 4], 'eight evidence frames must be read in two bounded batches');
    assert.strictEqual(peakVisualBatches, 2, 'the two fixed evidence batches must execute concurrently with limit two');
    assert.strictEqual(synthesisCalls, 0, 'mock mode must compile validated structured evidence without a second model pass');
    assert.strictEqual(staged.visual_evidence_batches.length, 2);
    assert.equal(staged.evidence_coverage.complete, true);
    assert.equal(staged.evidence_coverage.covered_frame_count, 8);
    assert.ok(staged.story_outline.logline.includes('测试门窗产品'));
    assert.strictEqual(service._private.normalizeResult(staged).analysis_quality.valid, false, '只有逐帧证据、没有深度语义时不得标记为完整分析');
    const stagedEvidenceBatches = service._private.readRecord('anonymous', 'batch-analysis-test')._visual_evidence_cache.batches;

    const {
      shot_breakdown: omittedModelShots,
      camera_intents: omittedModelCameras,
      scene_prompts: omittedModelScenes,
      ...semanticContract
    } = staged;
    const semanticEvents = staged.shot_breakdown.map((shot, index) => ({
      id: `event_${index + 1}`,
      range: shot.range,
      scene_id: shot.scene_id,
      subject: '测试门窗产品',
      action: shot.action,
      motivation: '',
      result: index === staged.shot_breakdown.length - 1 ? '完成空间体验递进' : '展示下一层产品体验',
      caused_by: null,
      leads_to: null,
      evidence_refs: staged.evidence_frames.filter(frame => frame.timestamp_seconds >= shot.range[0] && frame.timestamp_seconds <= shot.range[1]).map(frame => frame.frame_id),
      certainty: 'fact',
    }));
    const semanticSceneIds = [...new Set(staged.shot_breakdown.map(shot => shot.scene_id))];
    semanticContract.reference_understanding = {
      contract_version: 'reference-understanding-v6',
      story_summary: {
        narrative_mode: 'showcase_montage',
        narrative_mode_reason: '画面以连续空间和产品体验递进为主，没有传统戏剧冲突。',
        logline: '镜头从空间建立推进到门窗细节与使用体验，完成产品价值展示。',
        short_synopsis: '以空间、材质和采光体验逐层展示测试门窗产品。',
        full_synopsis: '开场建立真实空间与门窗产品的整体关系，随后通过多个有证据的镜头展示材质、采光和使用体验，最后以完整空间效果完成展示型广告收束。',
        theme: '空间体验与产品细节共同证明使用价值。',
        central_conflict: '', trigger: '进入产品所在空间', turning_point: '从整体空间转向使用体验', climax: '产品效果被集中展示',
        resolution: '完整空间效果完成收束。', brand_function: '门窗产品是空间采光与体验变化的核心证明对象。', cta: '进一步了解产品方案。',
      },
      causal_chain: semanticEvents,
      characters: [],
      scenes: semanticSceneIds.map((sceneId, index) => {
        const events = semanticEvents.filter(event => event.scene_id === sceneId);
        return {
          scene_id: sceneId,
          narrative_function: index === 0 ? '建立产品与整体空间的关系' : `承载第 ${index + 1} 层产品体验证明`,
          events: events.map(event => event.id),
          state_change: '展示信息从整体空间推进到具体体验',
          evidence_refs: [...new Set(events.flatMap(event => event.evidence_refs))], certainty: 'fact',
        };
      }),
      brand_role: {
        subject: '测试门窗产品', story_function: '连接空间采光、材质和使用体验', visible_claims: [], proof_moments: semanticEvents.map(event => event.id),
        cta: '进一步了解产品方案', evidence_refs: semanticEvents.flatMap(event => event.evidence_refs).slice(0, 4), certainty: 'fact',
      },
      facts: [], inferences: [], unknowns: [],
    };

    const mockFlagBeforeSynthesis = process.env.NEW_STORY_AD_MOCK_LLM;
    process.env.NEW_STORY_AD_MOCK_LLM = '0';
    modelGateway.generateText = async (options) => {
      synthesisCalls += 1;
      assert.strictEqual(options.stage, 'new_story_ad.reference_video_synthesis');
      assert.ok(options.systemPrompt.includes('不要输出 scene_prompts、shot_breakdown 或 camera_intents'));
      assert.ok(!options.userPrompt.includes('"scene_prompts"'));
      assert.ok(!options.userPrompt.includes('"shot_breakdown"'));
      assert.ok(!options.userPrompt.includes('"camera_intents"'));
      const { plot_beats: _omittedPlotBeats, ...partialSemanticContract } = semanticContract;
      const text = JSON.stringify(partialSemanticContract);
      await options.validateText(text);
      return { text, used_model: 'test/reference-synthesis' };
    };
    const synthesized = await service._private.synthesizeAnalysisFromEvidence({
      id: 'reference-synthesis-test',
      source: { metadata: { duration_seconds: 8 } },
    }, stagedEvidenceBatches, { status: 'no_audio', text: '' });
    assert.match(synthesized.source_facts.product_or_service, /测试品牌|测试门窗产品/);
    assert.strictEqual(synthesisCalls, 1, 'real reference analysis must run one semantic synthesis pass after visual evidence extraction');
    assert.ok(synthesized.plot_beats.length >= 2, 'missing top-level plot_beats must be restored from deterministic evidence after semantic validation');
    const synthesisAudit = service._private.readRecord('anonymous', 'reference-synthesis-test');
    assert.ok(synthesisAudit._synthesis_raw.text.includes('测试门窗产品'), '最终汇总原文必须持久化，失败后仍可审计模型真实输出');
    assert.equal(synthesisAudit._synthesis_raw.used_model, 'test/reference-synthesis');

    const reusedSynthesis = await service._private.synthesizeAnalysisFromEvidence({
      id: 'reference-synthesis-reuse-test',
      user_id: 'anonymous',
      source: { metadata: { duration_seconds: 8 } },
      _reuse_synthesis_raw: true,
      _synthesis_raw: {
        text: `\`\`\`json\n${JSON.stringify(semanticContract)}\n\`\`\``,
        used_model: 'test/stored-reference-synthesis',
      },
    }, stagedEvidenceBatches, { status: 'no_audio', text: '' });
    assert.strictEqual(synthesisCalls, 1, '结构校验失败恢复必须复用已保存语义结果，不得再次调用文本模型');
    process.env.NEW_STORY_AD_MOCK_LLM = mockFlagBeforeSynthesis;
    const reusedSceneIds = new Set(reusedSynthesis.scene_prompts.map(item => item.id));
    assert.ok(reusedSynthesis.scene_prompts.length > 0);
    assert.ok(reusedSynthesis.shot_breakdown.length > 0);
    assert.ok(reusedSynthesis.shot_breakdown.every(shot => reusedSceneIds.has(shot.scene_id)));
    assert.equal(
      reusedSynthesis.reference_understanding?.completeness?.valid,
      true,
      JSON.stringify(reusedSynthesis.reference_understanding?.completeness || {}),
    );
    assert.doesNotThrow(() => service._private.validateAnalysisResult(reusedSynthesis));

    const recoveryInput = path.join(tempRoot, 'rate-limit-recovery-input.mp4');
    fs.copyFileSync(input, recoveryInput);
    const recoveryAnalysis = await service.create({
      file: {
        path: recoveryInput,
        originalname: 'rate-limit-recovery.mp4',
        mimetype: 'video/mp4',
        size: fs.statSync(recoveryInput).size,
      },
      body: { rights_confirmed: 'true' },
      user,
    });
    const recoveryRecordPath = path.join(
      tempRoot,
      'new-story-ad',
      'reference-video-analyses',
      user.id,
      recoveryAnalysis.id,
      'record.json',
    );
    let recoveryRecord = JSON.parse(fs.readFileSync(recoveryRecordPath, 'utf8'));
    const recoveryFrames = testEvidenceFrames(8, 'recovery-frame');
    let recoveryRound = 1;
    const recoveryCalls = [];
    const recoveryCandidateLimits = [];
    modelGateway.generateVision = async (options) => {
      const batchIndex = Number(String(options.userPrompt || '').match(/第\s+(\d+)\/2\s+组/)?.[1] || 0);
      recoveryCalls.push({ round: recoveryRound, batch_index: batchIndex });
      recoveryCandidateLimits.push(options.maxCandidates);
      if (recoveryRound === 1 && batchIndex === 2) {
        const error = new Error('primary provider rate limited before fallback was available');
        error.code = 'VISION_QA_UNAVAILABLE';
        error.retryable = true;
        error.failed_models = [{
          provider_id: 'zhipu',
          model_id: 'glm-4.6v-flash',
          code: 'RATE_LIMIT',
          response_diagnostics: { response_length: 123, response_sha256: 'test-response-hash' },
        }];
        throw error;
      }
      const batchFrames = options.imageUrls.map(url => recoveryFrames.find(frame => frame.image_url === url));
      const text = JSON.stringify(testVisionPayload(batchFrames, `恢复${batchIndex}`));
      await options.validateText(text);
      return {
        text,
        used_model: recoveryRound === 1 ? 'zhipu/glm-4.6v-flash' : 'backup-provider/backup-vision',
      };
    };
    await assert.rejects(
      service._private.analyzeWithModels(recoveryRecord, recoveryFrames, { status: 'no_audio', text: '' }),
      error => error.code === 'VISION_QA_UNAVAILABLE'
        && error.failed_models.some(item => item.code === 'RATE_LIMIT' && item.batch_index === 2),
    );
    recoveryRecord = JSON.parse(fs.readFileSync(recoveryRecordPath, 'utf8'));
    assert.deepStrictEqual(
      recoveryCalls.map(item => item.batch_index).sort(),
      [1, 2],
      'the first attempt must run both bounded evidence batches',
    );
    assert.ok(
      recoveryCandidateLimits.every(limit => limit === 3),
      'each reference-video batch must allow cross-provider fallback candidates',
    );
    assert.deepStrictEqual(
      recoveryRecord._visual_evidence_cache.completed_batch_indexes,
      [0],
      'the successful batch must be persisted when its sibling is rate limited',
    );
    assert.equal(recoveryRecord._visual_evidence_cache.failed_attempts['1'][0].code, 'RATE_LIMIT');
    assert.equal(
      recoveryRecord._visual_evidence_cache.failed_attempts['1'][0].response_diagnostics.response_length,
      123,
      '失败批次必须私下持久化安全诊断，不能只剩页面上的 UNKNOWN',
    );
    const partialPublicRecord = service.get(recoveryAnalysis.id, user);
    assert.deepStrictEqual(
      partialPublicRecord.evidence_batch_progress,
      { total: 2, completed: 1, remaining: 1, failed: 1 },
      '失败任务必须公开安全的批次进度，明确重试只处理缺失批次',
    );
    assert.equal(Object.prototype.hasOwnProperty.call(partialPublicRecord, '_visual_evidence_cache'), false);

    recoveryRound = 2;
    const recovered = await service._private.analyzeWithModels(
      recoveryRecord,
      recoveryFrames,
      { status: 'no_audio', text: '' },
    );
    const secondRoundCalls = recoveryCalls.filter(item => item.round === 2);
    assert.deepStrictEqual(
      secondRoundCalls.map(item => item.batch_index),
      [2],
      'retry must execute only the missing evidence batch',
    );
    assert.strictEqual(recovered.visual_evidence_batches.length, 2);
    recoveryRecord = JSON.parse(fs.readFileSync(recoveryRecordPath, 'utf8'));
    assert.deepStrictEqual(recoveryRecord._visual_evidence_cache.completed_batch_indexes, [0, 1]);
    assert.equal(recoveryRecord._visual_evidence_cache.failed_attempts['1'], undefined, '缺失批次成功后必须清除该批次旧失败状态');
    service.remove(recoveryAnalysis.id, user);
  } finally {
    modelGateway.generateVision = originalGenerateVision;
    modelGateway.generateText = originalGenerateText;
    modelGateway.candidatesForVisionStage = originalVisionCandidates;
  }

  const metalWallAnalysis = service._private.normalizeResult({
    schema_version: 3,
    analysis_scope: 'reference_content_and_creative_structure',
    source_facts: {
      product_or_service: '304不锈钢青冥金缕金属装饰墙板',
      visible_text: ['304不锈钢', '青冥金缕'],
      environment: '高端客厅金属墙板展示空间',
      materials: ['304不锈钢金属墙板'],
      colors: ['青绿色', '铜金色'],
      layout: '整面金属装饰墙位于画面中央，沙发和茶几在前景，右侧人物触摸墙板。',
      lighting: '顶部暖色射灯沿墙面形成重点照明，窗侧自然光补充暗部。',
      human_presence: true,
      human_actions: ['女性展示者从右侧入画并用手触摸墙板纹理'],
      chronological_story: ['建立整面墙板', '纹理特写', '人物触摸展示', '回到空间全景'],
      evidence_timestamps: [0.2, 2.2, 4.2, 6.2, 8.2, 10.1],
    },
    summary: '参考视频展示304不锈钢青冥金缕金属装饰墙板，通过空间全景、纹理特写和女性触摸动作证明金属质感。',
    story_outline: {
      logline: '高端客厅先展示整面青冥金缕金属墙板，再由女性触摸纹理并以空间全景收束。',
      opening: '开场以高端客厅全景建立整面金属装饰墙和前景沙发茶几。',
      development: '镜头推进到青绿色与铜金色交织的金属墙板纹理细节。',
      turning_point: '女性从右侧入画，用手触摸墙板表面并面向镜头完成展示。',
      resolution: '结尾回到墙板、人物和客厅关系清楚的稳定展示画面。',
    },
    plot_beats: [
      { order: 1, purpose: '建立金属墙板与高端客厅空间', range: [0, 3] },
      { order: 2, purpose: '展示墙板纹理并由人物触摸证明质感', range: [3, 8] },
      { order: 3, purpose: '回到产品与空间全景完成收束', range: [8, 10.194] },
    ],
    character_prompts: [{
      role: '成年女性产品展示者',
      narrative_function: '用触摸动作展示墙板纹理与尺度',
      age_range: '成年',
      appearance_direction: '自然可信的商业展示者',
      wardrobe_direction: '原创深绿色长裙，与青绿色墙板形成统一色调',
      performance_style: '动作克制，手掌明确接触墙板',
      continuity_rules: '发型、服装和动作方向连续',
      negative_prompt: '禁止复制真人身份和水印',
    }],
    scene_prompts: [{
      location_type: '高端客厅金属墙板展示空间',
      beat_refs: [1, 2, 3],
      layout_prompt: '整面304不锈钢青冥金缕金属装饰墙板居中，沙发茶几位于前景，人物从右侧接近墙面。',
      material_light_prompt: '304不锈钢金属墙板呈青绿色与铜金色氧化纹理，顶部暖色射灯洗亮墙面。',
      interaction_prompt: '人物站在墙板右侧并用右手触摸纹理，主机位保持墙面尺度。',
      camera_purpose: '全景建立空间，近景展示金属纹理，中景记录人物触摸。',
      negative_prompt: '禁止书桌、书架、电脑和家庭办公元素。',
    }],
    camera_intents: [{
      movement: 'slow_push_in',
      start_shot_size: 'wide',
      end_shot_size: 'close_up',
      angle: 'eye_level',
      evidence_timestamps: [0.2, 4.2],
    }],
    character_actions: [{
      start_pose: '人物从画面右侧自然入场',
      key_action: '右手手掌贴近并触摸金属墙板纹理',
      end_pose: '人物站在墙板右侧完成稳定展示',
    }],
    transcript: { status: 'failed_non_blocking', text: '', segments: [] },
  });
  assert.strictEqual(metalWallAnalysis.analysis_quality.valid, true);
  assert.ok(metalWallAnalysis.generated_brief.includes('304不锈钢青冥金缕金属装饰墙板'));
  assert.ok(metalWallAnalysis.generated_brief.includes('高端客厅金属墙板展示空间'));
  assert.ok(!/家庭工作环境/.test(metalWallAnalysis.source_facts.environment));
  assert.ok(!/书桌|书架|电脑/.test(metalWallAnalysis.scene_prompts[0].layout_prompt));
  assert.ok(metalWallAnalysis.warnings.some(item => item.includes('仅依据画面证据')));

  const wrongScenePlan = {
    scene_mode: 'single',
    spaces: [{
      id: 'space_1',
      name: '家庭书房',
      scene_spec: {
        layoutText: '书桌位于房间中央，书架位于背后墙壁，桌上摆放笔记本电脑。',
        materialLightText: '浅色木质书桌与乳白色墙面。',
        interactionText: '人物坐在电脑前。',
        negativeText: '禁止办公室元素。',
      },
    }],
  };
  const referenceContext = {
    brief: metalWallAnalysis.generated_brief,
    scene_spec: {},
    reference_video_analysis: {
      status: 'completed',
      generated_brief: metalWallAnalysis.generated_brief,
      source_facts: metalWallAnalysis.source_facts,
      analysis_quality: metalWallAnalysis.analysis_quality,
    },
  };
  assert.throws(
    () => assistScenePlan.assertReferenceSceneAlignment(wrongScenePlan, referenceContext, {}),
    error => error.code === 'ASSIST_SCENE_REFERENCE_MISMATCH',
    'unrelated study scene must be rejected before persistence',
  );
  const alignedScenePlan = {
    scene_mode: 'single',
    spaces: [{
      id: 'space_1',
      name: metalWallAnalysis.source_facts.environment,
      scene_spec: {
        layoutText: `${metalWallAnalysis.source_facts.environment}内，整面墙展示${metalWallAnalysis.source_facts.product_or_service}。`,
        materialLightText: `${metalWallAnalysis.source_facts.materials[0]}保留青绿色与铜金色纹理。`,
        interactionText: '女性从右侧触摸墙板。',
        negativeText: '禁止无关书房元素。',
      },
    }],
  };
  assert.doesNotThrow(() => assistScenePlan.assertReferenceSceneAlignment(alignedScenePlan, referenceContext, {}));

  const context = contextBuilder.buildContext({
    brief: '用户已把参考剧情修改为适合自己的办公协作产品，主角改为创业团队负责人。',
    product_subject: '办公协作产品',
    person_context: {
      spec_source: {
        kind: 'reference_video',
        analysisId: completed.id,
        manualOverride: false,
      },
    },
    reference_video_analysis: {
      analysis_id: completed.id,
      status: 'completed',
      analysis_scope: completed.result.analysis_scope,
      generated_brief: completed.result.generated_brief,
      source_facts: completed.result.source_facts,
      analysis_quality: completed.result.analysis_quality,
      story_outline: completed.result.story_outline,
      plot_beats: completed.result.plot_beats,
      character_prompts: completed.result.character_prompts,
      scene_prompts: completed.result.scene_prompts,
      camera_intents: completed.result.camera_intents,
      character_actions: completed.result.character_actions,
      prompt_suggestions: completed.result.prompt_suggestions,
    },
  }, { id: user.id });
  assert.equal(context.reference_video_analysis.character_prompts.length, completed.result.character_prompts.length);
  assert.equal(context.reference_video_analysis.scene_prompts.length, completed.result.scene_prompts.length);
  assert.equal(context.person_context.spec_source.kind, 'reference_video');
  assert.equal(context.person_context.spec_source.analysisId, completed.id);
  assert.equal(context.person_context.spec_source.manualOverride, false);
  const downstreamPrompt = contextBuilder.contextPrompt(context);
  assert.ok(downstreamPrompt.includes('参考视频内容与原创改写合同'));
  assert.ok(downstreamPrompt.includes('source_facts'));
  assert.ok(downstreamPrompt.includes('generated_brief'));
  ['完整剧情', '人物提示词', '场景提示词', '动作', '机位运镜']
    .forEach(term => assert.ok(downstreamPrompt.includes(term), `downstream prompt must include ${term}`));
  assert.ok(downstreamPrompt.includes('用户当前“广告需求”文本是可编辑权威版本'));
  assert.ok(downstreamPrompt.includes('创业团队负责人'), '用户修改后的广告需求必须进入后续剧情生成提示词');
  assert.ok(downstreamPrompt.includes('wardrobe_direction'), '原创人物服装方向必须进入后续剧情生成提示词');
  assert.ok(downstreamPrompt.includes('layout_prompt'), '分场景布局提示词必须进入后续剧情生成提示词');

  const mapping = service.mapSceneViews(uploaded.id, user, [
    { view_key: 'master', image_url: '/master.png' },
    { view_key: 'interaction', image_url: '/interaction.png' },
    { view_key: 'detail', image_url: '/detail.png' },
  ]);
  assert.strictEqual(mapping.status, 'mapped');
  assert.ok(mapping.mappings.every(item => item.feasible && item.mapped_view));

  assert.throws(() => service.get(uploaded.id, { id: 'other-user' }), /不存在|无权/);
  const deleted = service.remove(uploaded.id, user);
  assert.strictEqual(deleted.deleted, true);

  console.log(JSON.stringify({
    passed: true,
    checks: 197,
    evidence_frames: completed.result.evidence_frames.length,
    camera_intents: completed.result.camera_intents.length,
    scene_mappings: mapping.mappings.length,
    private_source_path_exposed: false,
    downstream_generation_triggered: false,
  }));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    const resolved = path.resolve(tempRoot);
    if (resolved.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolved, { recursive: true, force: true });
  });
