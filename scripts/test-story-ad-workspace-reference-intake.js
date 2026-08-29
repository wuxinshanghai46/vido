#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/newStoryAd/taskUpdateRoute.js'), 'utf8');
assert.match(routeSource, /workflowStateOnly \? \{[\s\S]*reason: 'workflow_state_only'[\s\S]*model_call_count: 0/, '纯环节确认不得重复执行参考资产投影或模型调用');
const express = require('express');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-reference-intake-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const referenceVideoAnalyses = require('../src/services/newStoryAd/referenceVideoAnalysisService');
const referenceDetach = require('../src/services/newStoryAd/referenceDetachService');
const referenceConfirmation = require('../src/services/storyAdWorkspace/referenceUnderstandingConfirmationService');
const bundles = require('../src/services/storyAdWorkspace/projectBundleService');
const storyFlowGate = require('../src/services/storyAdWorkspace/storyFlowSketchGateService');
const newStoryAdRouter = require('../src/routes/newStoryAd');

const user = { id: 'reference-intake-owner', role: 'user' };

function requestJson(url, body, method = 'PUT') {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = Buffer.from(JSON.stringify(body));
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers: {
        'content-type': 'application/json',
        'content-length': payload.length,
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: response.statusCode, payload: JSON.parse(text) });
        } catch (error) {
          reject(new Error(`Invalid JSON response (${response.statusCode}): ${text.slice(0, 200)}`));
        }
      });
    });
    request.on('error', reject);
    request.end(payload);
  });
}

const putJson = (url, body) => requestJson(url, body, 'PUT');
const postJson = (url, body) => requestJson(url, body, 'POST');
const deleteJson = (url, body) => requestJson(url, body, 'DELETE');

function completedReference(overrides = {}) {
  return {
    analysis_id: 'analysis-reference-intake',
    status: 'completed',
    progress: 100,
    phase: '分析完成，已生成中文广告需求',
    checkpoints: [{ phase: '证据帧与语音已提取', progress: 42, at: '2026-08-01T06:00:00.000Z' }],
    analysis_quality: { valid: true },
    reference_understanding: {
      contract_version: 'reference-understanding-v6',
      schema_version: 6,
      story_summary: { full_synopsis: '参考视频展示主体、人物、场景与行动的完整发展过程。' },
      causal_chain: [{ cause: '主体需求出现', event: '人物使用主体', effect: '需求得到解决' }],
      scenes: [{ scene_id: 'reference-scene', narrative_purpose: '承载主体与人物行动' }],
      completeness: { valid: true, story_complete: true, cause_chain_complete: true, failures: [] },
    },
    generated_brief: '参考视频完整分析',
    source_facts: {
      product_or_service: '智能宠物饮水机',
      environment: '有落地窗的现代客厅',
      human_presence: true,
      human_count: 1,
      animal_presence: true,
      narrative_animal_presence: true,
      animal_actions: ['猫咪从右侧进入并靠近饮水机'],
    },
    story_outline: {
      logline: '主人发现猫咪饮水不足，并用智能饮水机改善日常。',
      opening: '猫咪绕着空水碗徘徊。',
      development: '主人安装并启动饮水机。',
      turning_point: '流动清水吸引猫咪靠近。',
      resolution: '猫咪安心饮水，主人放松微笑。',
    },
    plot_beats: [
      { range: [0, 3], purpose: '建立猫咪缺水问题' },
      { range: [3, 8], purpose: '展示产品解决问题' },
    ],
    character_prompts: [{
      id: 'owner', role: '年轻主人', age_range: '25-30岁',
      appearance_direction: '自然亲和的年轻女性', wardrobe_direction: '浅色居家服',
      continuity_rules: '全片保持同一人物与服装',
    }],
    animal_prompts: [{
      id: 'cat', name: '橘猫', species: '猫', breed: '中华田园猫',
      appearance_direction: '橘色短毛、白色胸口', continuity_rules: '全片保持花色与体型一致',
    }],
    scene_prompts: [{
      id: 'living-room', location_type: '现代客厅', layout_prompt: '落地窗位于沙发左侧，饮水区靠近窗边',
      material_light_prompt: '木地板与午后自然光', interaction_prompt: '主人从沙发走到饮水区，猫咪从右侧进入',
      negative_prompt: '禁止改变门窗、沙发和饮水区相对位置',
    }],
    shot_breakdown: [{ shot_id: 'REF-SH01', purpose: '建立问题', framing: '全景' }],
    camera_intents: [{ range: [0, 3], framing: '全景', angle: '平视', movement: '缓慢推进' }],
    character_actions: [{ subject_id: 'owner', start_pose: '坐在沙发', key_action: '起身查看水碗', end_pose: '蹲在猫咪旁' }],
    ...overrides,
  };
}

function createTask(overrides = {}) {
  return storyAd.createTask({
    project_name: '参考视频自动投影测试',
    brief: '根据参考视频制作智能宠物饮水机剧情广告',
    product_subject: '智能宠物饮水机',
    cast_mode: 'human_pet',
    expected_people: 1,
    expected_animals: 1,
    content_mode: 'commercial_subject',
    content_mode_source: 'user',
    ...overrides,
  }, user).task.id;
}

async function testCompletedReferenceProjection() {
  const taskId = createTask();
  const originalGenerateText = modelGateway.generateText;
  const originalGenerateVision = modelGateway.generateVision;
  let modelCalls = 0;
  modelGateway.generateText = async () => { modelCalls += 1; throw new Error('reference intake must not call a text model'); };
  modelGateway.generateVision = async () => { modelCalls += 1; throw new Error('reference intake must not call a vision model'); };
  try {
    const first = await assetPlan.projectReferenceIntake(taskId, { reference_analysis: completedReference() });
    assert.equal(first.projected, true);
    assert.equal(modelCalls, 0, '保存参考分析后的投影必须保持零模型调用');

    const context = storage.getOutput(taskId, 'context');
    assert.deepEqual(context.cast_profiles.map(item => item.id), ['owner']);
    assert.deepEqual(context.pet_profiles.map(item => item.id), ['cat']);
    assert.equal(context.cast_profiles.some(item => item.id === 'cat'), false, '动物不得进入人物档案');
    assert.equal(context.pet_profiles[0].generated_asset, false, '分析投影只能是草稿，不能伪装成正式生成资产');
    assert.equal(context.story_seed.logline, completedReference().story_outline.logline);
    assert.equal(storage.getOutput(taskId, 'scene_config').spaces[0].id, 'living-room');
    assert.equal(storage.getOutput(taskId, 'asset_plan'), null, '自动投影不得发布正式资产规划产物');

    const second = await assetPlan.projectReferenceIntake(taskId, { reference_analysis: completedReference() });
    assert.equal(second.projected, false);
    assert.equal(second.reason, 'unchanged');
    const repeated = storage.getOutput(taskId, 'context');
    assert.deepEqual(repeated.cast_profiles.map(item => item.id), ['owner']);
    assert.deepEqual(repeated.pet_profiles.map(item => item.id), ['cat']);

    const bundle = bundles.buildProjectBundle(taskId, { sections: 'all', user });
    for (const key of ['story_outline', 'plot_beats', 'character_prompts', 'animal_prompts', 'scene_prompts', 'shot_breakdown', 'camera_intents', 'character_actions']) {
      assert.ok(Object.prototype.hasOwnProperty.call(bundle.reference, key), `Bundle.reference 缺少 ${key}`);
    }
    assert.equal(bundle.assets.people.length, 1);
    assert.equal(bundle.assets.animals.length, 1);
    assert.equal(bundle.reference.source_facts.animal_presence, true);
    assert.equal(bundle.reference.progress, 100);
    assert.equal(bundle.reference.phase, '分析完成，已生成中文广告需求');
    assert.deepEqual(bundle.reference.checkpoints.map(item => item.progress), [42]);
    assert.deepEqual(bundle.reference.source_facts.animal_actions, ['猫咪从右侧进入并靠近饮水机']);
    assert.equal(bundle.assets.people[0].status, 'draft');
    assert.equal(bundle.assets.animals[0].status, 'draft');
    assert.equal(bundle.story.status, 'reference_draft');
    assert.equal(bundle.story.blueprint, null, '参考故事不得伪装成已保存的正式剧情蓝图');
    assert.equal(bundle.story.reference_draft.logline, completedReference().story_outline.logline);
    assert.equal(bundle.story.reference_draft.projection_only, true);
    assert.equal(bundle.story.reference_draft.beats.length, 2);
    assert.equal(bundle.storyboard.source, 'reference_analysis_projection');
    assert.equal(bundle.storyboard.shots.length, 1);
    assert.equal(bundle.storyboard.shots[0].shot_size, 'wide');
    assert.equal(bundle.storyboard.shots[0].camera_angle, 'eye_level');
    assert.equal(bundle.storyboard.shots[0].camera_movement, 'dolly_in');
    assert.match(bundle.storyboard.shots[0].entry_frame_state, /^镜头开始：/);
    assert.match(bundle.storyboard.shots[0].exit_frame_state, /^镜头结束：/);
    assert.equal(bundle.storyboard.shots[0].projection_only, true);
    assert.equal(bundle.navigation.counts.shots, 1, '侧栏镜头数必须包含参考视频逐镜草稿');

    storage.saveOutput(taskId, 'blueprint', { story_title: '用户正式剧情', logline: '用户已确认故事', beats: [] });
    storage.saveOutput(taskId, 'storyboard_table', [{ shot_index: 1, title: '用户正式分镜' }]);
    const authoritative = bundles.buildProjectBundle(taskId, { sections: 'story,shots', user });
    assert.equal(authoritative.story.blueprint.story_title, '用户正式剧情');
    assert.equal(authoritative.story.reference_draft, null, '正式剧情必须优先于参考故事草稿');
    assert.equal(authoritative.storyboard.source, 'saved_storyboard');
    assert.equal(authoritative.storyboard.shots[0].title, '用户正式分镜');
    assert.deepEqual(authoritative.storyboard.reference_draft, [], '正式分镜必须优先于参考逐镜草稿');
  } finally {
    modelGateway.generateText = originalGenerateText;
    modelGateway.generateVision = originalGenerateVision;
  }
}

async function testIncompleteStatesDoNotProject() {
  for (const reference of [
    completedReference({ status: 'running' }),
    completedReference({ status: 'failed' }),
    completedReference({ analysis_quality: { valid: false } }),
  ]) {
    const taskId = createTask();
    const result = await assetPlan.projectReferenceIntake(taskId, { reference_analysis: reference });
    assert.equal(result.projected, false);
    const context = storage.getOutput(taskId, 'context');
    assert.equal(context.cast_profiles.length, 0);
    assert.equal(context.pet_profiles.length, 1, '未完成分析不得覆盖创建任务时的声明档案');
    assert.equal(storage.getOutput(taskId, 'scene_config'), null);
  }
}

async function testShortProjectNameAndBriefGate() {
  const emptyBriefTaskId = storyAd.createTask({ project_name: '窗', brief: '' }, user).task.id;
  assert.equal(storage.getTask(emptyBriefTaskId).title, '窗', '项目名称不得复用广告目标的最小字数限制');
  assert.throws(
    () => storyAd.prepareGeneration(emptyBriefTaskId, {}, user),
    error => error?.code === 'BRIEF_REQUIRED' && error?.status === 422,
    '无广告目标且无有效参考分析时必须继续拦截生成',
  );

  await assetPlan.projectReferenceIntake(emptyBriefTaskId, { reference_analysis: completedReference() });
  assert.ok(storage.getOutput(emptyBriefTaskId, 'context').brief.length >= 8, '有效参考分析必须零模型形成可用广告目标');
  assert.equal(storage.getOutput(emptyBriefTaskId, 'context').brief, completedReference().generated_brief, '广告目标必须保留参考视频生成的完整证据摘要，不能退化为单行 logline');
  try {
    storyAd.prepareGeneration(emptyBriefTaskId, {}, user);
  } catch (error) {
    assert.notEqual(error?.code, 'BRIEF_REQUIRED', '完成且有效的参考分析不得再被广告目标字数门禁拒绝');
  }
}

async function testTaskPutAwaitsProjection() {
  const taskId = createTask();
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req, res, next) => { req.user = user; next(); });
  app.use('/api/new-story-ad', newStoryAdRouter);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/api/new-story-ad/tasks/${taskId}`;
    for (let saveIndex = 0; saveIndex < 2; saveIndex += 1) {
      const response = await putJson(endpoint, { reference_video_analysis: completedReference() });
      assert.equal(response.status, 200);
      const payload = response.payload;
      assert.equal(payload.success, true);
      assert.equal(payload.reference_projection.model_call_count, 0);
      assert.deepEqual(payload.context.cast_profiles.map(item => item.id), ['owner']);
      assert.deepEqual(payload.context.pet_profiles.map(item => item.id), ['cat']);
      const currentTask = storage.getTask(taskId);
      assert.deepEqual(
        storage.getSnapshot(currentTask.current_snapshot_id).payload,
        storage.getOutput(taskId, 'context'),
        'PUT 投影后的 current snapshot 必须与 context 完全一致',
      );
    }
    const beforeNoop = storage.getTask(taskId);
    const referenceFingerprintBeforeNoop = assetPlan.referenceProjectionFingerprint(
      storage.getOutput(taskId, 'context').reference_video_analysis,
    );
    const noopResponse = await putJson(endpoint, {
      base_content_revision: beforeNoop.content_revision,
      client_edit_seq: Number(beforeNoop.latest_client_edit_seq || 0) + 1,
    });
    assert.equal(noopResponse.status, 200);
    assert.equal(noopResponse.payload.reference_projection.reason, 'no_business_change',
      '没有真实业务修改时不得重新投影参考内容');
    assert.equal(noopResponse.payload.content_revision, beforeNoop.content_revision,
      '无业务变化 PUT 不得制造新内容版本');
    assert.equal(assetPlan.referenceProjectionFingerprint(
      storage.getOutput(taskId, 'context').reference_video_analysis,
    ), referenceFingerprintBeforeNoop, '无业务变化 PUT 不得覆盖当前参考投影');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function testLinkCreationBindsNewReferenceBeforeResponse() {
  const taskId = createTask();
  storyAd.updateTaskRequest(taskId, { asset_setup_confirmed: true, shot_design_confirmed: true }, user);
  storage.saveOutput(taskId, 'blueprint', { story_title: '旧参考剧情', beats: [{ order: 1 }] });
  storage.saveOutput(taskId, 'storyboard_table', [{ shot_index: 1, title: '旧参考分镜' }]);
  const originalCreateFromUrl = referenceVideoAnalyses.createFromUrl;
  const createdAt = '2026-08-01T14:30:00.000Z';
  referenceVideoAnalyses.createFromUrl = async ({ body }) => ({
    id: 'ref_video_new_link_binding_test',
    task_id: body.task_id,
    status: 'importing',
    progress: 3,
    phase: '正在检查视频链接',
    created_at: createdAt,
    updated_at: createdAt,
    source: { input_type: 'url', original_name: 'video.example.com', metadata: {} },
    result: null,
    error: null,
  });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req, res, next) => { req.user = user; next(); });
  app.use('/api/new-story-ad', newStoryAdRouter);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await postJson(`http://127.0.0.1:${server.address().port}/api/new-story-ad/reference-video-links`, {
      url: 'https://video.example.com/reference.mp4',
      task_id: taskId,
      rights_confirmed: 'true',
    });
    assert.equal(response.status, 202);
    assert.equal(response.payload.task_bound, true);
    assert.equal(response.payload.task_mutation.content_revision, 2, '参考来源绑定回执必须携带服务端最新内容版本');
    assert.equal(response.payload.task_mutation.context.content_mode, 'commercial_subject', '广告参考来源绑定不得改变广告内容域');
    const context = storage.getOutput(taskId, 'context');
    assert.equal(context.reference_video_analysis.analysis_id, 'ref_video_new_link_binding_test');
    assert.equal(context.reference_video_analysis.status, 'importing');
    assert.equal(context.reference_video_analysis.created_at, createdAt);
    assert.equal(context.asset_setup_confirmed, false, '更换参考来源必须使旧资产确认失效');
    assert.equal(context.shot_design_confirmed, false, '更换参考来源必须使旧镜头确认失效');
    assert.equal(storage.getOutput(taskId, 'blueprint'), null, '旧参考剧情不得跨来源保留');
    assert.equal(storage.getOutput(taskId, 'storyboard_table'), null, '旧参考分镜不得跨来源保留');
  } finally {
    referenceVideoAnalyses.createFromUrl = originalCreateFromUrl;
    await new Promise(resolve => server.close(resolve));
  }
}

async function testStoryLinkBindingPreservesContentDomain() {
  const taskId = createTask({
    project_name: '纯剧情参考视频',
    brief: '两位朋友在海边重逢并解开心结。',
    product_subject: '',
    content_mode: 'narrative_story',
  });
  const originalCreateFromUrl = referenceVideoAnalyses.createFromUrl;
  referenceVideoAnalyses.createFromUrl = async ({ body }) => ({
    id: 'ref_video_story_link_binding_test',
    task_id: body.task_id,
    status: 'importing',
    progress: 3,
    phase: '正在检查视频链接',
    created_at: '2026-08-12T16:00:00.000Z',
    updated_at: '2026-08-12T16:00:00.000Z',
    source: { input_type: 'url', original_name: 'story.example.com', metadata: {} },
    result: null,
    error: null,
  });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req, res, next) => { req.user = user; next(); });
  app.use('/api/new-story-ad', newStoryAdRouter);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await postJson(`http://127.0.0.1:${server.address().port}/api/new-story-ad/reference-video-links`, {
      url: 'https://story.example.com/reference.mp4',
      task_id: taskId,
      rights_confirmed: 'true',
    });
    assert.equal(response.status, 202);
    assert.equal(response.payload.task_mutation.content_revision, 2);
    assert.equal(response.payload.task_mutation.context.content_mode, 'narrative_story', '剧情参考来源绑定不得切换到广告内容域');
    assert.equal(response.payload.task_mutation.context.product_subject, '', '剧情参考来源绑定不得生成广告主体');
  } finally {
    referenceVideoAnalyses.createFromUrl = originalCreateFromUrl;
    await new Promise(resolve => server.close(resolve));
  }
}

async function testProjectReferenceRemoval() {
  const manualPatch = referenceDetach.buildDetachPatch({
    brief: '用户手写的广告目标',
    brief_source: 'user',
    brief_intake: {
      creative_brief_confirmed: true,
      specifications_confirmed: true,
      reference_decision: 'attached',
      completed_dialogue_topics: ['audience_intent', 'commercial_evidence'],
      active_dialogue_topic: 'reference',
    },
    cast_profiles: [
      { id: 'projected', source: 'reference_analysis_projection', projection_only: true },
      { id: 'manual', source: 'user' },
    ],
    pet_profiles: [{ id: 'manual-pet', source: 'user' }],
  }, null, {});
  assert.equal(Object.prototype.hasOwnProperty.call(manualPatch, 'brief'), false, '删除参考不得清空用户手写广告目标');
  assert.deepEqual(manualPatch.cast_profiles.map(item => item.id), ['manual'], '删除参考必须保留用户自建人物');
  assert.equal(Object.prototype.hasOwnProperty.call(manualPatch, 'pet_profiles'), false, '没有参考投影动物时不得重写用户动物');
  assert.deepEqual(manualPatch.brief_intake, {
    creative_brief_confirmed: true,
    specifications_confirmed: true,
    reference_decision: 'skipped',
    completed_dialogue_topics: ['audience_intent', 'commercial_evidence'],
    active_dialogue_topic: '',
  }, '点击跳过参考必须原子保留已确认内容并记录跳过决策，不能重载后再次追问');
  const reanalysisPatch = referenceDetach.buildReanalysisPatch({
    brief: '旧参考自动目标',
    brief_source: 'reference_analysis',
    cast_profiles: [{ id: 'projected', source: 'reference_analysis_projection', projection_only: true }],
    story_seed: { logline: '旧参考故事', source: 'reference_analysis_projection' },
    reference_video_analysis: { analysis_id: 'same-reference', status: 'completed' },
  }, { source: 'reference_analysis_projection', spaces: [{ id: 'old-space' }] }, {
    analysis_id: 'same-reference', status: 'queued', progress: 1, analysis_quality: {},
  });
  assert.equal(reanalysisPatch.reference_video_analysis.analysis_id, 'same-reference', '重新识别必须保留同一视频绑定');
  assert.equal(reanalysisPatch.reference_video_analysis.status, 'queued');
  assert.equal(reanalysisPatch.brief, '', '旧参考自动目标必须在重新识别排队时撤下');
  assert.deepEqual(reanalysisPatch.cast_profiles, [], '旧参考人物投影不得跨重新识别继续使用');
  assert.equal(reanalysisPatch.story_seed, null, '旧参考故事投影不得跨重新识别继续使用');
  assert.deepEqual(reanalysisPatch.scene_spec, {}, '旧参考场景投影不得跨重新识别继续使用');
  const taskId = createTask();
  await assetPlan.projectReferenceIntake(taskId, { reference_analysis: completedReference() });
  storage.saveOutput(taskId, 'asset_plan', { cast_profiles: [{ id: 'owner' }], scene_plan: { spaces: [{ id: 'living-room' }] } });
  storage.saveOutput(taskId, 'blueprint', { story_title: '参考剧情', beats: [{ order: 1 }] });
  storage.saveOutput(taskId, 'storyboard_table', [{ shot_index: 1, title: '参考分镜' }]);
  const revisionBefore = storage.getTask(taskId).content_revision;
  const originalGet = referenceVideoAnalyses.get;
  const originalCancel = referenceVideoAnalyses.cancel;
  const originalRemove = referenceVideoAnalyses.remove;
  let removedId = '';
  let removalReason = '';
  referenceVideoAnalyses.get = analysisId => ({ id: analysisId, status: 'completed' });
  referenceVideoAnalyses.remove = (analysisId, _user, options = {}) => {
    removedId = analysisId;
    removalReason = options.reason || '';
    return { id: analysisId, deleted: true, audit_tombstone: true };
  };
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req, res, next) => { req.user = user; next(); });
  app.use('/api/new-story-ad', newStoryAdRouter);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await deleteJson(
      `http://127.0.0.1:${server.address().port}/api/new-story-ad/tasks/${taskId}/reference-video`,
      { base_content_revision: revisionBefore, client_edit_seq: 20 },
    );
    assert.equal(response.status, 200);
    assert.equal(response.payload.reference_removed, true);
    assert.equal(response.payload.analysis_cleanup, 'deleted_with_audit_tombstone');
    assert.equal(removedId, completedReference().analysis_id);
    assert.equal(removalReason, 'detached_from_story_ad_project');
    const context = storage.getOutput(taskId, 'context');
    assert.equal(context.reference_video_analysis, null, '移除后任务不得继续绑定旧参考分析');
    assert.equal(context.brief, '', '参考分析自动填写的目标必须清空，恢复手动填写和 AI 帮写入口');
    assert.equal(context.brief_source, 'system');
    assert.equal(context.brief_intake.reference_decision, 'skipped', '正式解绑结果必须持久化用户已跳过参考');
    assert.equal(context.cast_profiles.length, 0, '仅由参考分析投影的人物草稿必须清理');
    assert.equal(storage.getTask(taskId).content_revision, revisionBefore + 1, '移除参考必须形成新的来源版本');
    assert.equal(storage.getOutput(taskId, 'asset_plan'), null, '旧参考资产方案不得跨解绑保留');
    assert.equal(storage.getOutput(taskId, 'scene_config'), null, '旧参考场景方案不得跨解绑保留');
    assert.equal(storage.getOutput(taskId, 'blueprint'), null, '旧参考剧情不得跨解绑保留');
    assert.equal(storage.getOutput(taskId, 'storyboard_table'), null, '旧参考分镜不得跨解绑保留');
    const bundle = bundles.buildProjectBundle(taskId, { sections: 'all', user });
    assert.equal(bundle.reference.analysis_id, '');
    assert.equal(bundle.navigation.steps.assets.enabled, false, '删除后广告目标为空时不得沿用旧资产方案越级');

    const activeTaskId = storyAd.createTask({
      project_name: '手写目标保留测试',
      brief: '这是用户自己填写的广告目标，删除参考后必须原样保留。',
      brief_source: 'user',
      reference_video_analysis: { analysis_id: 'active-reference', status: 'running' },
    }, user).task.id;
    storage.saveOutput(activeTaskId, 'asset_plan', { source: 'old-reference' });
    let cancelledId = '';
    referenceVideoAnalyses.get = analysisId => ({ id: analysisId, status: 'running' });
    referenceVideoAnalyses.cancel = analysisId => { cancelledId = analysisId; return { id: analysisId, status: 'cancelling' }; };
    const activeResult = referenceDetach.detach({
      taskId: activeTaskId,
      body: { base_content_revision: 1, client_edit_seq: 1 },
      user,
      storyAdService: storyAd,
      storage,
      referenceVideoAnalyses,
    });
    assert.equal(activeResult.analysis_cleanup, 'cancelling');
    assert.equal(cancelledId, 'active-reference', '移除正在分析的参考必须停止后台任务');
    assert.equal(storage.getOutput(activeTaskId, 'context').brief, '这是用户自己填写的广告目标，删除参考后必须原样保留。');
    assert.equal(storage.getOutput(activeTaskId, 'context').reference_video_analysis, null);
    assert.equal(storage.getOutput(activeTaskId, 'asset_plan'), null);
    const repeated = referenceDetach.detach({ taskId: activeTaskId, body: {}, user, storyAdService: storyAd, storage, referenceVideoAnalyses });
    assert.equal(repeated.already_removed, true, '网络重试不得重复修改已解绑项目');

    const blockedTaskId = storyAd.createTask({ brief: '生成中的参考删除门禁', brief_source: 'user', reference_video_analysis: { analysis_id: 'locked-reference', status: 'running' } }, user).task.id;
    storage.updateTask(blockedTaskId, { active_generation_id: 'generation-lock' });
    assert.throws(
      () => referenceDetach.detach({ taskId: blockedTaskId, body: {}, user, storyAdService: storyAd, storage, referenceVideoAnalyses }),
      error => error?.code === 'GENERATION_ACTIVE_EDIT_BLOCKED',
      '当前生成锁定参考来源时不得删除或覆盖数据',
    );
  } finally {
    referenceVideoAnalyses.get = originalGet;
    referenceVideoAnalyses.cancel = originalCancel;
    referenceVideoAnalyses.remove = originalRemove;
    await new Promise(resolve => server.close(resolve));
  }
}

async function testInvalidCompletedReferenceReanalysisRoute() {
  const taskId = createTask();
  await assetPlan.projectReferenceIntake(taskId, { reference_analysis: completedReference() });
  storage.saveOutput(taskId, 'asset_plan', { source: 'reference_analysis_projection' });
  storage.saveOutput(taskId, 'blueprint', { story_title: '旧参考剧情' });
  storage.saveOutput(taskId, 'storyboard_table', [{ shot_index: 1, title: '旧参考分镜' }]);
  const analysisId = completedReference().analysis_id;
  const originalGet = referenceVideoAnalyses.get;
  const originalReanalyze = referenceVideoAnalyses.reanalyze;
  let queuedRecord = null;
  let beforeRun = null;
  let scheduleDelayMs = null;
  referenceVideoAnalyses.get = id => ({
    id,
    analysis_id: id,
    task_id: taskId,
    status: 'completed',
    progress: 100,
    result: { analysis_quality: { valid: false } },
  });
  referenceVideoAnalyses.reanalyze = (id, _user, options = {}) => {
    beforeRun = options.beforeRun;
    scheduleDelayMs = options.scheduleDelayMs;
    queuedRecord = {
      id,
      analysis_id: id,
      task_id: taskId,
      status: 'queued',
      progress: 1,
      phase: '已保留当前视频，等待重新读取并识别',
      result: null,
      analysis_quality: {},
      started_at: new Date().toISOString(),
    };
    return { accepted: true, duplicate: false, record: queuedRecord };
  };
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req, res, next) => { req.user = user; next(); });
  app.use('/api/new-story-ad', newStoryAdRouter);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await postJson(
      `http://127.0.0.1:${server.address().port}/api/new-story-ad/reference-video-analyses/${analysisId}/reanalyze`,
      {},
    );
    assert.equal(response.status, 202);
    assert.equal(response.payload.task_reset, true);
    assert.equal(response.payload.analysis.status, 'queued');
    assert.equal(response.payload.analysis.progress, 1);
    assert.equal(typeof beforeRun, 'function', '重新识别接口必须把项目重置注册为后台分析前置步骤');
    assert.equal(scheduleDelayMs, 100, 'HTTP 202 must get a socket flush window before background projection blocks the event loop');
    let context = storage.getOutput(taskId, 'context');
    assert.equal(context.reference_video_analysis.status, 'completed', 'HTTP 202 返回不得等待项目持久化完成');
    await beforeRun(queuedRecord);
    context = storage.getOutput(taskId, 'context');
    assert.equal(context.reference_video_analysis.analysis_id, analysisId, '专用接口必须继续绑定当前视频');
    assert.equal(context.reference_video_analysis.status, 'queued', '项目必须立即采用新的识别状态');
    assert.equal(context.brief, '', '旧参考自动目标必须在新模型调用前撤下');
    assert.equal(context.cast_profiles.length, 0, '旧参考人物投影必须在新模型调用前撤下');
    assert.equal(storage.getOutput(taskId, 'asset_plan'), null, '旧参考资产方案不得跨重新识别继续使用');
    assert.equal(storage.getOutput(taskId, 'blueprint'), null, '旧参考剧情不得跨重新识别继续使用');
    assert.equal(storage.getOutput(taskId, 'storyboard_table'), null, '旧参考分镜不得跨重新识别继续使用');
  } finally {
    referenceVideoAnalyses.get = originalGet;
    referenceVideoAnalyses.reanalyze = originalReanalyze;
    await new Promise(resolve => server.close(resolve));
  }
}

async function testManualAuthorityAndReferenceReplacement() {
  const manualTaskId = createTask();
  await assetPlan.projectReferenceIntake(manualTaskId, { reference_analysis: completedReference() });
  const projectedContext = storage.getOutput(manualTaskId, 'context');
  storage.saveOutput(manualTaskId, 'context', {
    ...projectedContext,
    cast_profiles: [{ id: 'manual-person', name: '用户手改人物', source: 'user' }],
    pet_profiles: [{ id: 'manual-pet', name: '用户手改动物', source: 'user' }],
    story_seed: { logline: '用户手改故事', source: 'user' },
  });
  storage.saveOutput(manualTaskId, 'scene_config', {
    source: 'user', scene_mode: 'single', spaces: [{ id: 'manual-scene', name: '用户手改场景' }],
  });
  await assetPlan.projectReferenceIntake(manualTaskId, {
    reference_analysis: completedReference({ analysis_id: 'analysis-reference-b' }),
  });
  const manualContext = storage.getOutput(manualTaskId, 'context');
  assert.deepEqual(manualContext.cast_profiles.map(item => item.id), ['manual-person']);
  assert.deepEqual(manualContext.pet_profiles.map(item => item.id), ['manual-pet']);
  assert.equal(manualContext.story_seed.logline, '用户手改故事');
  assert.equal(storage.getOutput(manualTaskId, 'scene_config').spaces[0].id, 'manual-scene');

  const replaceTaskId = createTask();
  await assetPlan.projectReferenceIntake(replaceTaskId, { reference_analysis: completedReference() });
  await assetPlan.projectReferenceIntake(replaceTaskId, {
    reference_analysis: completedReference({
      analysis_id: 'analysis-reference-b',
      story_outline: { ...completedReference().story_outline, logline: '第二条参考分析故事' },
      character_prompts: [{ id: 'new-owner', role: '新主人', wardrobe_direction: '深色居家服', continuity_rules: '保持一致' }],
      animal_prompts: [{ id: 'dog', name: '柴犬', species: '狗', continuity_rules: '保持一致' }],
      scene_prompts: [{
        id: 'new-scene', location_type: '新客厅', layout_prompt: '新布局', material_light_prompt: '新光线',
        interaction_prompt: '新路线', negative_prompt: '禁止改变布局',
      }],
    }),
  });
  const replacedContext = storage.getOutput(replaceTaskId, 'context');
  assert.deepEqual(replacedContext.cast_profiles.map(item => item.id), ['new-owner']);
  assert.deepEqual(replacedContext.pet_profiles.map(item => item.id), ['dog']);
  assert.equal(replacedContext.story_seed.logline, '第二条参考分析故事');
  assert.equal(storage.getOutput(replaceTaskId, 'scene_config').spaces[0].id, 'new-scene');
}

async function testFamilyRecognitionAndSequentialWorkflowGates() {
  const taskId = createTask();
  const familyReference = completedReference({
    analysis_id: 'analysis-family-three',
    source_facts: {
      product_or_service: '全景天窗',
      environment: '现代住宅的厨房、客厅和餐区',
      human_presence: true,
      human_count: 3,
      animal_presence: true,
      narrative_animal_presence: false,
      ambient_animals: ['自然风景蒙太奇中的海鸟'],
      human_actions: ['一人在厨房，两人在客厅沙发上休闲放松'],
      animal_actions: [],
    },
    story_outline: {
      logline: '一家三口在明亮住宅中体验全景天窗连接室内外的生活价值。',
      opening: '自然景观建立开阔视野。',
      development: '全景天窗的玻璃和金属结构逐步显现。',
      turning_point: '一家三口分别出现在厨房和客厅。',
      resolution: '家庭共同享受明亮通透的居住空间。',
    },
    character_prompts: [1, 2, 3].map(index => ({
      id: `family-${index}`,
      role: `家庭成员${index}`,
      age_range: '按画面可见年龄范围确认',
      appearance_direction: `原创家庭成员${index}外观`,
      wardrobe_direction: `原创居家服装${index}`,
      hair_makeup_direction: `自然居家发型${index}`,
      continuity_rules: '全片保持同一人物设定',
    })),
    // 即使旧语义结果曾把环境飞鸟写入提示词，资产投影也必须按叙事角色过滤。
    animal_prompts: [{ id: 'ambient-bird', species: '海鸟', appearance_direction: '远景飞鸟' }],
    scene_prompts: Array.from({ length: 16 }, (_, index) => ({
      id: `family-scene-${index + 1}`,
      location_type: index < 4 ? `自然蒙太奇场景${index + 1}` : `住宅产品场景${index + 1}`,
      layout_prompt: `场景${index + 1}的完整空间布局与门窗位置`,
      material_light_prompt: `场景${index + 1}的玻璃、金属与自然光`,
      interaction_prompt: index === 15 ? '一家三口分别位于厨房和客厅' : '保持产品与空间关系',
      negative_prompt: '禁止改变产品类别和空间关系',
    })),
    shot_breakdown: Array.from({ length: 13 }, (_, index) => ({
      order: index + 1,
      range: [index * 2, index * 2 + 2],
      visual: `第${index + 1}镜展示全景天窗与空间关系`,
      action: index === 12 ? '一家三口在厨房和客厅自然活动' : '展示门窗材质与采光变化',
      scene_id: `family-scene-${index + 1}`,
      subject_ids: ['advertised_subject'],
      shot_size: 'wide',
      angle: 'eye_level',
      movement: 'locked',
      duration_seconds: 2,
    })),
  });
  const originalGenerateText = modelGateway.generateText;
  const originalGenerateVision = modelGateway.generateVision;
  let modelCalls = 0;
  modelGateway.generateText = async () => { modelCalls += 1; throw new Error('reference workflow projection must stay zero-model'); };
  modelGateway.generateVision = async () => { modelCalls += 1; throw new Error('reference workflow projection must stay zero-model'); };
  try {
    await assetPlan.projectReferenceIntake(taskId, { reference_analysis: familyReference });
    let context = storage.getOutput(taskId, 'context');
    assert.equal(context.brief, familyReference.generated_brief);
    assert.equal(context.brief_source, 'reference_analysis');
    assert.equal(context.expected_people, 3);
    assert.equal(context.expected_animals, 0);
    assert.equal(context.cast_profiles.length, 3);
    assert.equal(context.pet_profiles.length, 0);
    assert.equal(context.cast_mode, 'multi');

    let bundle = bundles.buildProjectBundle(taskId, { sections: 'all', user });
    assert.equal(bundle.navigation.steps.brief.completed, true, '识别完成并形成有效设想后应完成对话立项');
    assert.equal(bundle.navigation.steps.plot.enabled, true, '识别有效后必须先开放剧情与对白');
    assert.equal(bundle.navigation.steps.assets.enabled, false, '剧情尚未生成时不得越级进入人物资产');
    assert.equal(bundle.navigation.current, 'plot', '识别完成后的当前环节必须进入剧情与对白');

    context = storage.getOutput(taskId, 'context');
    referenceConfirmation.confirm(taskId, context, {
      base_revision: storage.getTask(taskId).content_revision,
      confirmation: 'authoritative_input',
      analysis_id: familyReference.analysis_id,
    }, { user });
    await assetPlan.generate(taskId);
    assert.equal(modelCalls, 0, '参考视频到正式资产方案必须复用识别结果，不能重复调用模型');
    bundle = bundles.buildProjectBundle(taskId, { sections: 'all', user });
    assert.equal(bundle.navigation.steps.brief.completed, true, JSON.stringify(bundle.navigation.asset_plan_eligibility));
    const publishedPlan = storage.getOutput(taskId, 'asset_plan');
    const persistedContext = storage.getOutput(taskId, 'context');
    assert.equal(
      publishedPlan.fingerprint,
      assetPlan.fingerprint(storage.getTask(taskId), persistedContext),
      '新方案必须使用最终持久化上下文的同一输入指纹，不能创建后立即过期',
    );
    const userEditedContext = {
      ...persistedContext,
      cast_profiles: persistedContext.cast_profiles.map((item, index) => (
        index === 0 ? { ...item, appearanceText: `${item.appearanceText || ''} 用户明确修改外观` } : item
      )),
    };
    assert.notEqual(
      assetPlan.fingerprint(storage.getTask(taskId), userEditedContext),
      publishedPlan.fingerprint,
      '用户真实修改人物后仍必须使方案指纹失效',
    );
    assert.equal(bundle.assets.people.length, 3);
    assert.equal(bundle.assets.animals.length, 0);
    assert.equal(bundle.assets.scenes.length, 16, '长参考视频的场景目录不得静默截断为前 12 个');
    const plannedSceneIds = new Set(bundle.assets.scenes.map(item => item.id));
    assert.equal(bundle.storyboard.shots.every(shot => plannedSceneIds.has(shot.scene_id)), true, '每个参考分镜的 scene_id 都必须能解析到资产中心场景');
    assert.equal(bundle.navigation.steps.plot.enabled, true);
    assert.equal(bundle.navigation.current, 'plot', '兼容资产投影不得绕过尚未确认的剧情环节');

    storyAd.updateTaskRequest(taskId, { asset_setup_confirmed: true }, user);
    bundle = bundles.buildProjectBundle(taskId, { sections: 'all', user });
    assert.equal(bundle.navigation.steps.assets.completed, true);
    assert.equal(bundle.navigation.steps.plot.enabled, true);
    assert.equal(bundle.navigation.steps.storyboard.enabled, false);
    assert.equal(bundle.navigation.current, 'plot');

    storage.saveOutput(taskId, 'blueprint', {
      story_title: '一家三口的明亮一天',
      logline: familyReference.story_outline.logline,
      beats: [{ order: 1, purpose: '建立自然与住宅关系' }],
    });
    bundle = bundles.buildProjectBundle(taskId, { sections: 'all', user });
    assert.equal(bundle.navigation.steps.plot.completed, true);
    assert.equal(bundle.navigation.steps.flow.enabled, false, '场景尚未确认时不得提前开放流向线稿');
    assert.equal(bundle.navigation.steps.storyboard.enabled, false, '流向线稿未确认时不得提前开放人物场景分镜');
    assert.equal(bundle.navigation.steps.final.enabled, false);
    assert.equal(bundle.navigation.current, 'scene', '剧情和人物确认后必须先核对场景，再进入分镜');

    storyAd.updateTaskRequest(taskId, { scene_setup_confirmed: true }, user);
    bundle = bundles.buildProjectBundle(taskId, { sections: 'all', user });
    assert.equal(bundle.navigation.steps.flow.enabled, true, '确认场景后才允许进入流向线稿');
    assert.equal(bundle.navigation.steps.storyboard.enabled, false, '流向线稿确认前不得进入人物场景分镜');
    assert.equal(bundle.navigation.current, 'flow');

    const flowState = storyFlowGate.blueprintState(taskId);
    storage.saveOutput(taskId, 'story_flow_sketches', flowState.beats.map((beat, index) => ({
      beat_index: Number(beat.beat_index || beat.index || index + 1) || index + 1,
      image_url: `/flow-${index + 1}.png`,
      status: 'confirmed',
      source_blueprint_fingerprint: flowState.fingerprint,
      source_content_revision: Number(flowState.task.content_revision || 1) || 1,
    })));
    bundle = bundles.buildProjectBundle(taskId, { sections: 'all', user });
    assert.equal(bundle.navigation.steps.flow.completed, true);
    assert.equal(bundle.navigation.steps.storyboard.enabled, true, '确认全部流向线稿后才允许进入人物场景分镜');
    assert.equal(bundle.navigation.current, 'storyboard');

    storage.saveOutput(taskId, 'storyboard_table', [{
      shot_index: 1,
      title: '家庭客厅全景',
      visual: '一家三口位于厨房和客厅区域',
      action: '家庭成员自然交流',
      scene_id: 'living-room',
      shot_size: 'wide',
      camera_angle: 'eye_level',
      camera_movement: 'locked',
      entry: '从住宅外景切入',
      exit: '以全景天窗高光收束',
    }]);
    bundle = bundles.buildProjectBundle(taskId, { sections: 'all', user });
    assert.equal(bundle.navigation.steps.storyboard.completed, false);
    assert.equal(bundle.navigation.steps.final.enabled, false);
    assert.equal(bundle.navigation.current, 'storyboard');

    storyAd.updateTaskRequest(taskId, { shot_design_confirmed: true }, user);
    bundle = bundles.buildProjectBundle(taskId, { sections: 'all', user });
    assert.equal(bundle.navigation.steps.storyboard.completed, true);
    assert.equal(bundle.navigation.steps.final.enabled, true);
    assert.equal(bundle.navigation.current, 'final');
  } finally {
    modelGateway.generateText = originalGenerateText;
    modelGateway.generateVision = originalGenerateVision;
  }
}

async function main() {
  await testCompletedReferenceProjection();
  await testIncompleteStatesDoNotProject();
  await testShortProjectNameAndBriefGate();
  await testTaskPutAwaitsProjection();
  await testLinkCreationBindsNewReferenceBeforeResponse();
  await testStoryLinkBindingPreservesContentDomain();
  await testProjectReferenceRemoval();
  await testInvalidCompletedReferenceReanalysisRoute();
  await testManualAuthorityAndReferenceReplacement();
  await testFamilyRecognitionAndSequentialWorkflowGates();
  console.log('story-ad workspace reference intake tests: 158 checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
