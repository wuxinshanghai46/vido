const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-reference-video-test-'));
process.env.OUTPUT_DIR = tempRoot;
process.env.NEW_STORY_AD_MOCK_LLM = '1';

const ffmpegPath = require('ffmpeg-static');
const service = require('../src/services/newStoryAd/referenceVideoAnalysisService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const assistScenePlan = require('../src/services/newStoryAd/assistScenePlanService');

async function waitFor(id, user, statuses, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const row = service.get(id, user);
    if (statuses.includes(row.status)) return row;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${statuses.join(',')}`);
}

async function main() {
  const user = { id: 'reference-video-test-user' };
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
  assert.ok(completed.result.generated_brief.includes('运镜'));
  assert.strictEqual(completed.result.output_language, 'zh-CN');
  assert.ok(/[\u3400-\u9fff]{12}/.test(completed.result.generated_brief), 'generated brief must be readable Simplified Chinese');
  assert.strictEqual(completed.result.transcript.status, 'mocked');
  assert.ok(completed.result.transcript.segments.length >= 1);
  assert.strictEqual(completed.result.analysis_quality.valid, true);
  assert.ok(completed.result.source_facts.product_or_service);
  assert.ok(completed.result.generated_brief.includes('【参考内容事实】'));
  const privateVisionFrame = service._private.frameVisionUrl(completed.result.evidence_frames[0]);
  assert.ok(privateVisionFrame.startsWith('data:image/jpeg;base64,'), 'vision provider must receive embedded evidence instead of a localhost URL');
  assert.ok(!privateVisionFrame.includes('localhost'));

  assert.throws(
    () => service._private.normalizeResult({ data: "I'm sorry, I can't assist with that." }),
    error => error.code === 'REFERENCE_VIDEO_ANALYSIS_SEMANTIC_INVALID'
      && error.failures.includes('provider_refusal')
      && error.failures.includes('story_outline_incomplete')
      && error.failures.includes('scene_prompts_incomplete'),
    'provider refusal must not become a completed generic Chinese brief',
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
  process.env.NEW_STORY_AD_MOCK_LLM = previousMock;
  assert.strictEqual(fallbackVision.fallback_used, true, 'semantic refusal must fall through to the next vision candidate');
  assert.strictEqual(fallbackVision.used_model, 'openai/valid-model');
  assert.strictEqual(providerVisionInputs.deyunai, 'https://example.com/reference-frame.jpg');
  assert.ok(providerVisionInputs.zhipu.startsWith('data:image/jpeg;base64,'));
  assert.ok(providerVisionInputs.openai.startsWith('data:image/jpeg;base64,'));
  assert.deepStrictEqual(
    fallbackVision.failed_models.map(item => item.code),
    ['PROVIDER_EMPTY_RESPONSE', 'PROVIDER_RESPONSE_INVALID'],
  );

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
    checks: 76,
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
