const { v4: uuidv4 } = require('uuid');
const storage = require('./storageService');
const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const { buildContext, contextPrompt, cleanText, normalizeCharacters } = require('./contextBuilder');
const { generateBlueprint } = require('./blueprintService');
const { generateStoryboardTable, rewriteStoryboard } = require('./storyboardTableService');
const { reviewStoryboard } = require('./qualityReviewService');
const { buildKeyframeContracts } = require('./keyframeContractService');
const diagnostics = require('./diagnosticsService');
const mediaAdapter = require('./mediaAdapter');
const ttsAdapter = require('./ttsAdapter');
const videoAdapter = require('./videoAdapter');
const composeService = require('./composeService');

function taskTitle(ctx) {
  return cleanText(ctx.product_subject || ctx.brief || '新剧情广告任务', 60);
}

function publicTaskBundle(taskId) {
  const bundle = storage.getTaskBundle(taskId);
  const outputs = Object.fromEntries((bundle.outputs || []).map(x => [x.kind, x.payload]));
  const context = outputs.context || bundle.task?.request || {};
  return {
    ...bundle,
    context,
    outputs,
  };
}

function createTask(body = {}, user = {}) {
  const ctx = buildContext(body, user);
  const id = cleanText(body.task_id || body.taskId || '', 80) || uuidv4();
  const task = storage.createTask({
    id,
    title: taskTitle(ctx),
    brief: ctx.brief,
    user_id: ctx.user_id,
    request: ctx,
  });
  storage.saveOutput(id, 'context', ctx);
  storage.saveStage(id, 'created', { status: 'done', output_summary: '任务已创建' });
  return { task, context: ctx };
}

function updateTaskRequest(taskId, body = {}, user = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = buildContext({ ...(task.request || {}), ...(body || {}), task_id: taskId }, user);
  const updated = storage.updateTask(taskId, {
    title: taskTitle(ctx),
    brief: ctx.brief,
    request: ctx,
  });
  storage.saveOutput(taskId, 'context', ctx);
  storage.saveStage(taskId, 'saved', { status: 'done', output_summary: '任务进度已保存' });
  return { task: updated, context: ctx };
}

async function generateSceneConfig(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  storage.updateTask(taskId, { status: 'running', stage: 'scene_config' });
  storage.saveStage(taskId, 'scene_config', { status: 'running', input_summary: ctx.brief });
  const systemPrompt = [
    '你是新剧情广告场景配置 agent。只输出 JSON 对象。',
    '你的职责是把用户需求整理成业务边界、主体、人物模式、素材使用、禁止项和建议镜头策略。',
    '不能自行继承旧任务、不能写固定行业模板。',
  ].join('\n');
  const userPrompt = `${contextPrompt(ctx)}

输出 JSON：
{
  "business_boundary": "本任务只允许使用的业务/行业/主体边界",
  "advertised_subject": "广告主体",
  "cast_mode": "single/dual/multi/no_human/auto",
  "asset_strategy": [{"asset_id":"素材ID","usage":"如何使用"}],
  "story_strategy": ["剧情策略"],
  "forbidden": ["禁止项"],
  "suggested_shot_count": 5
}`;
  const result = await modelGateway.generateText({
    taskId,
    stage: 'new_story_ad.scene_config',
    systemPrompt,
    userPrompt,
    maxTokens: 3000,
  });
  const sceneConfig = await jsonRepair.parseOrRepair({
    raw: result.text,
    expected: 'object',
    modelGateway,
    taskId,
    stage: 'new_story_ad.json_repair',
  });
  sceneConfig.model_meta = {
    used_model: result.used_model,
    fallback_used: result.fallback_used,
    failed_models: result.failed_models,
  };
  storage.saveOutput(taskId, 'scene_config', sceneConfig);
  storage.saveStage(taskId, 'scene_config', { status: 'done', output_summary: '场景配置已生成', diagnostics: sceneConfig.model_meta });
  storage.updateTask(taskId, { status: 'running', stage: 'scene_config_done' });
  return sceneConfig;
}

async function generateBlueprintStage(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  storage.updateTask(taskId, { status: 'running', stage: 'blueprint' });
  storage.saveStage(taskId, 'blueprint', { status: 'running', input_summary: ctx.brief });
  const blueprint = await generateBlueprint(ctx, { taskId });
  storage.saveOutput(taskId, 'blueprint', blueprint);
  storage.saveStage(taskId, 'blueprint', { status: 'done', output_summary: `${blueprint.beats?.length || 0} 个剧情 beat`, diagnostics: blueprint.model_meta || {} });
  storage.updateTask(taskId, { status: 'running', stage: 'blueprint_done' });
  return blueprint;
}

async function generateStoryboardStage(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  let blueprint = storage.getOutput(taskId, 'blueprint');
  if (!blueprint) blueprint = await generateBlueprintStage(taskId);
  const stageCtx = {
    ...ctx,
    characters: normalizeCharacters(Array.isArray(blueprint.characters) && blueprint.characters.length ? blueprint.characters : ctx.characters),
  };
  storage.updateTask(taskId, { status: 'running', stage: 'storyboard' });
  storage.saveStage(taskId, 'storyboard', { status: 'running', input_summary: `${blueprint.beats?.length || 0} beats` });
  const generated = await generateStoryboardTable(stageCtx, blueprint, { taskId });
  let shots = generated.shots;
  let review = await reviewStoryboard(stageCtx, shots, { taskId });
  storage.saveReview(taskId, 'storyboard.initial', review);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const issues = [
      ...(review.blocking_issues || []),
      ...(review.rewrite_issues || []),
    ];
    if (!shots.length || !issues.length) break;
    shots = await rewriteStoryboard(stageCtx, blueprint, shots, issues, { taskId });
    const nextReview = await reviewStoryboard(stageCtx, shots, { taskId });
    storage.saveReview(taskId, `storyboard.rewrite.${attempt}`, nextReview);
    review = nextReview;
    if (!review.blocking_issues.length && !review.rewrite_issues.length) break;
  }
  if (review.blocking_issues.length) {
    storage.saveOutput(taskId, 'storyboard_table', shots);
    storage.saveStage(taskId, 'storyboard', { status: 'failed', error: review.blocking_issues.join('；'), diagnostics: review });
    storage.updateTask(taskId, { status: 'failed', stage: 'storyboard_failed', error: review.blocking_issues.join('；') });
    const err = new Error(`新剧情广告分镜硬阻断：${review.blocking_issues.join('；')}`);
    err.review = review;
    err.partial = shots;
    throw err;
  }
  const contracts = buildKeyframeContracts(stageCtx, shots);
  storage.saveOutput(taskId, 'storyboard_table', shots);
  storage.saveOutput(taskId, 'quality_review', review);
  storage.saveOutput(taskId, 'keyframe_contracts', contracts);
  storage.saveStage(taskId, 'storyboard', { status: 'done', output_summary: `${shots.length} 个镜头`, diagnostics: review });
  storage.saveStage(taskId, 'keyframe_contract', { status: 'done', output_summary: `${contracts.length} 个关键帧合同` });
  storage.updateTask(taskId, {
    status: 'done',
    stage: 'keyframe_contract_ready',
    diagnostics: diagnostics.summarizeTask({ task, review }),
  });
  return { shots, review, keyframe_contracts: contracts, model_meta: generated.model_meta };
}

async function buildKeyframeContractStage(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const shots = storage.getOutput(taskId, 'storyboard_table');
  if (!Array.isArray(shots) || !shots.length) throw new Error('请先生成分镜表');
  const contracts = buildKeyframeContracts(ctx, shots);
  storage.saveOutput(taskId, 'keyframe_contracts', contracts);
  storage.saveStage(taskId, 'keyframe_contract', { status: 'done', output_summary: `${contracts.length} 个关键帧合同` });
  storage.updateTask(taskId, { status: 'done', stage: 'keyframe_contract_ready' });
  return contracts;
}

function buildKeyframePrompt(ctx = {}, shot = {}, contract = {}, index = 0) {
  const visualContract = contract.visual_contract || {};
  const parts = [
    'Photorealistic live-action commercial storyboard keyframe.',
    `Campaign brief: ${cleanText(ctx.brief, 900)}`,
    `Advertised subject: ${cleanText(ctx.product_subject, 160)}`,
    `Shot ${index + 1}: ${cleanText(shot.title || '', 120)}`,
    `Visual: ${cleanText(shot.visual || shot.content_prompt || '', 900)}`,
    `Action: ${cleanText(shot.action || shot.visual_action || '', 500)}`,
    `Dialogue or copy: ${cleanText(shot.voiceover || shot.narration || shot.ad_copy || shot.subtitle || '', 300)}`,
    visualContract.composition ? `Composition: ${cleanText(visualContract.composition, 300)}` : '',
    visualContract.subject ? `Subject lock: ${cleanText(visualContract.subject, 300)}` : '',
    visualContract.evidence ? `Commercial evidence: ${cleanText(visualContract.evidence, 300)}` : '',
    visualContract.style ? `Style: ${cleanText(visualContract.style, 260)}` : '',
    visualContract.scene_direction && visualContract.scene_direction !== 'auto' ? `Scene direction: ${cleanText(visualContract.scene_direction, 80)}` : '',
    visualContract.custom_scene_requirement ? `Custom scene requirement: ${cleanText(visualContract.custom_scene_requirement, 240)}` : '',
    visualContract.product_required ? `Product visibility: required, presence ${cleanText(visualContract.product_presence || 'medium', 40)}, lock ${cleanText(visualContract.product_lock_strength || 'standard', 40)}.` : '',
    Array.isArray(visualContract.product_methods) && visualContract.product_methods.length ? `Product presentation methods: ${cleanText(visualContract.product_methods.join(', '), 240)}` : '',
    visualContract.style_direction ? `Visual style direction: ${cleanText(visualContract.style_direction, 360)}` : '',
    visualContract.negative_requirements ? `Negative visual requirements: ${cleanText(visualContract.negative_requirements, 360)}` : '',
    Array.isArray(shot.characters) && shot.characters.length ? `Characters: ${cleanText(JSON.stringify(shot.characters), 500)}` : '',
    ctx.person_asset ? `Locked real actor/person asset: ${cleanText(JSON.stringify(ctx.person_asset), 1200)}` : '',
    Array.isArray(ctx.cast_profiles) && ctx.cast_profiles.length ? `Locked cast profiles: ${cleanText(JSON.stringify(ctx.cast_profiles), 1200)}` : '',
    ctx.person_context?.real_person_locked ? 'Use the uploaded/authorized real-person reference as the identity and appearance lock. Preserve face identity, age impression, body proportions, wardrobe family and natural real-camera skin texture.' : '',
    Array.isArray(ctx.forbidden) && ctx.forbidden.length ? `Forbidden: ${cleanText(ctx.forbidden.join('; '), 400)}` : '',
    'Use a real camera look, natural light, realistic skin and materials, no cartoon, no anime, no 3D render, no poster text, no watermark.',
  ];
  return parts.filter(Boolean).join('\n');
}

function keyframeUrlFromResult(result = {}) {
  if (result.image_url || result.imageUrl || result.url) return result.image_url || result.imageUrl || result.url;
  const filename = result.filename || (result.filePath ? require('path').basename(result.filePath) : '');
  return filename ? mediaAdapter.publicAssetUrl(filename) : '';
}

async function generateKeyframesStage(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('Task not found');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  let shots = storage.getOutput(taskId, 'storyboard_table');
  if (!Array.isArray(shots) || !shots.length) {
    const generated = await generateStoryboardStage(taskId);
    shots = generated.shots || [];
  }
  if (!Array.isArray(shots) || !shots.length) throw new Error('Storyboard table is empty');
  let contracts = storage.getOutput(taskId, 'keyframe_contracts');
  if (!Array.isArray(contracts) || contracts.length !== shots.length) {
    contracts = buildKeyframeContracts(ctx, shots);
    storage.saveOutput(taskId, 'keyframe_contracts', contracts);
  }
  const existing = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes') : [];
  const onlyIndex = Number.isFinite(Number(options.only_index ?? options.onlyIndex))
    ? Number(options.only_index ?? options.onlyIndex)
    : null;
  const indexes = onlyIndex === null
    ? shots.map((_, i) => i)
    : [Math.max(0, Math.min(shots.length - 1, onlyIndex))];
  const keyframes = existing.slice();
  const attempts = [];
  storage.updateTask(taskId, { status: 'running', stage: 'keyframes' });
  storage.saveStage(taskId, 'keyframes', { status: 'running', input_summary: `${indexes.length} image keyframes` });
  for (const i of indexes) {
    const shot = shots[i] || {};
    const prompt = buildKeyframePrompt(ctx, shot, contracts[i] || {}, i);
    const filename = `scene_new_story_ad_${taskId}_${String(i + 1).padStart(2, '0')}_${Date.now()}`;
    try {
      const result = await mediaAdapter.generateImage({
        prompt,
        filename,
        stage: 'new_story_ad.keyframe',
        aspectRatio: ctx.output_ratio || '9:16',
        resolution: options.resolution || '2K',
        imageModel: options.image_model || options.imageModel || 'auto',
      });
      const imageUrl = keyframeUrlFromResult(result);
      if (!imageUrl) throw new Error('Image provider returned no image url');
      keyframes[i] = {
        ...(keyframes[i] || {}),
        shot_index: i,
        index: i + 1,
        title: shot.title || `Shot ${i + 1}`,
        image_url: imageUrl,
        imageUrl,
        provider_used: result.provider_used || '',
        reference_mode: 'new_story_ad_generated_keyframe',
        prompt,
        qa: { pass: true, accepted_with_warning: true, reason: 'New story ad keyframe generated by independent image stage.' },
        contract: contracts[i] || null,
      };
      attempts.push({ index: i, ok: true, provider_id: result.provider_used || '', image_url: imageUrl });
    } catch (err) {
      attempts.push({ index: i, ok: false, error: String(err.message || err) });
      keyframes[i] = {
        ...(keyframes[i] || {}),
        shot_index: i,
        index: i + 1,
        title: shot.title || `Shot ${i + 1}`,
        error: String(err.message || err),
        contract: contracts[i] || null,
      };
    }
    storage.saveOutput(taskId, 'keyframes', keyframes);
  }
  const failed = attempts.filter(a => !a.ok);
  if (failed.length) {
    const message = `Keyframe image generation failed for shot ${failed.map(a => a.index + 1).join(', ')}`;
    storage.saveStage(taskId, 'keyframes', { status: 'failed', error: message, diagnostics: { attempts } });
    storage.updateTask(taskId, { status: 'failed', stage: 'keyframes_failed', error: message });
    const err = new Error(message);
    err.keyframes = keyframes;
    err.attempts = attempts;
    throw err;
  }
  storage.saveOutput(taskId, 'keyframes', keyframes);
  storage.saveStage(taskId, 'keyframes', { status: 'done', output_summary: `${keyframes.filter(k => k?.image_url || k?.imageUrl).length} image keyframes`, diagnostics: { attempts } });
  storage.updateTask(taskId, { status: 'done', stage: 'keyframes_ready' });
  return { keyframes, keyframe_contracts: contracts, attempts };
}

async function ensureStoryboardForMedia(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('Task not found');
  let shots = storage.getOutput(taskId, 'storyboard_table');
  if (!Array.isArray(shots) || !shots.length) {
    const generated = await generateStoryboardStage(taskId);
    shots = generated.shots || [];
  }
  if (!Array.isArray(shots) || !shots.length) throw new Error('Storyboard table is empty');
  return shots;
}

async function ensureContractsForMedia(taskId, ctx, shots) {
  let contracts = storage.getOutput(taskId, 'keyframe_contracts');
  if (!Array.isArray(contracts) || contracts.length !== shots.length) {
    contracts = buildKeyframeContracts(ctx, shots);
    storage.saveOutput(taskId, 'keyframe_contracts', contracts);
  }
  return contracts;
}

async function generateTtsStage(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('Task not found');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const shots = await ensureStoryboardForMedia(taskId);
  const voiceId = cleanText(options.voice_id || options.voiceId || ctx.voice_id || ctx.voiceId || '', 120);
  storage.updateTask(taskId, { status: 'running', stage: 'tts' });
  storage.saveStage(taskId, 'tts', { status: 'running', input_summary: `${shots.length} shot voice tracks` });
  const tts_audio = await ttsAdapter.generateVoiceover({
    taskId,
    shots,
    voiceId,
    speed: options.speed || ctx.tts_speed || 1,
    allowSilentFallback: options.allow_silent_fallback !== false && options.allowSilentFallback !== false,
  });
  storage.saveOutput(taskId, 'tts_audio', tts_audio);
  storage.saveStage(taskId, 'tts', {
    status: 'done',
    output_summary: `${tts_audio.tracks.length} audio tracks`,
    diagnostics: {
      provider_used: tts_audio.provider_used || '',
      warnings: tts_audio.warnings || [],
    },
  });
  storage.updateTask(taskId, { status: 'done', stage: 'tts_ready' });
  return { tts_audio };
}

async function generateVideoStage(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('Task not found');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const shots = await ensureStoryboardForMedia(taskId);
  const contracts = await ensureContractsForMedia(taskId, ctx, shots);
  let keyframes = storage.getOutput(taskId, 'keyframes');
  if (!Array.isArray(keyframes) || keyframes.filter(k => k?.image_url || k?.imageUrl).length < shots.length) {
    try {
      const generated = await generateKeyframesStage(taskId, options);
      keyframes = generated.keyframes || [];
    } catch (err) {
      if (options.require_keyframes === true || options.requireKeyframes === true) throw err;
      keyframes = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes') : [];
    }
  }
  let ttsAudio = storage.getOutput(taskId, 'tts_audio');
  if (!ttsAudio && options.auto_tts !== false && options.autoTts !== false) {
    const generatedTts = await generateTtsStage(taskId, options);
    ttsAudio = generatedTts.tts_audio;
  }
  storage.updateTask(taskId, { status: 'running', stage: 'video' });
  storage.saveStage(taskId, 'video', { status: 'running', input_summary: `${shots.length} shot videos` });
  const generated = await videoAdapter.generateShotVideos({
    taskId,
    shots,
    keyframes: Array.isArray(keyframes) ? keyframes : [],
    ttsAudio,
    contracts,
    ctx,
    options,
  });
  storage.saveOutput(taskId, 'video_clips', generated.clips);
  storage.saveStage(taskId, 'video', {
    status: 'done',
    output_summary: `${generated.clips.length} video clips`,
    diagnostics: { provider_used: generated.provider_used || '' },
  });
  storage.updateTask(taskId, { status: 'done', stage: 'video_ready' });
  return { video_clips: generated.clips };
}

async function composeStage(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('Task not found');
  let clips = storage.getOutput(taskId, 'video_clips');
  if (!Array.isArray(clips) || !clips.length) {
    const generated = await generateVideoStage(taskId, options);
    clips = generated.video_clips || [];
  }
  storage.updateTask(taskId, { status: 'running', stage: 'compose' });
  storage.saveStage(taskId, 'compose', { status: 'running', input_summary: `${clips.length} clips` });
  const final_video = await composeService.concatVideos({ taskId, clips });
  storage.saveOutput(taskId, 'final_video', final_video);
  storage.saveStage(taskId, 'compose', {
    status: 'done',
    output_summary: `final video from ${final_video.clip_count || clips.length} clips`,
    diagnostics: { provider_used: final_video.provider_used || '' },
  });
  storage.updateTask(taskId, { status: 'done', stage: 'final_video_ready' });
  return { final_video, video_clips: clips };
}

async function runFull(body = {}, user = {}) {
  const { task, context } = createTask(body, user);
  try {
    const scene_config = await generateSceneConfig(task.id);
    const blueprint = await generateBlueprintStage(task.id);
    const storyboard = await generateStoryboardStage(task.id);
    return {
      success: true,
      task_id: task.id,
      task: storage.getTask(task.id),
      context,
      scene_config,
      blueprint,
      ...storyboard,
      bundle: publicTaskBundle(task.id),
    };
  } catch (err) {
    const message = String(err.message || err);
    storage.updateTask(task.id, { status: 'failed', error: message, stage: 'failed' });
    return {
      success: false,
      task_id: task.id,
      error: message,
      review: err.review || null,
      partial: err.partial || null,
      bundle: publicTaskBundle(task.id),
    };
  }
}

function modelHealth() {
  return storage.readHealth();
}

async function assistBrief(body = {}, user = {}) {
  const ctx = buildContext(body, user);
  const mode = cleanText(body.mode || body.assist_mode || 'write', 20);
  const isStyleControl = mode === 'style_control' || mode === 'style';
  const isNegativeControl = mode === 'negative_control' || mode === 'negative';
  const isPersonSpec = mode === 'person_spec' || mode === 'person';
  const systemPrompt = [
    '你是新剧情广告模块的广告需求整理助手。只输出 JSON 对象，不要 markdown。',
    '你的任务是把用户的一句话或零散信息整理成可直接生成商用剧情广告的需求表单。',
    '必须保持用户原始业务主体，不得编造未授权行业、人物、宠物、机器人或旧任务内容。',
    '当 mode 是 style_control 时，只补写画面风格方向，不要写剧本、分镜、卖点或执行步骤。',
    '当 mode 是 negative_control 时，只整理画面禁止项，每条都必须是明确不能出现的内容。',
    '当 mode 是 person_spec 时，只补齐人物设定字段，必须包含外貌、穿着、发型妆造和人物禁止项。',
    '如果是“write”，请补成完整广告需求；如果是“clean”，请只整理和补齐缺失字段，不改变用户核心意思。',
  ].join('\n');
  const outputSchema = isStyleControl
    ? `{
  "text": "只包含画面风格、光线、真实程度、镜头情绪和不能偏离的质感方向，80-180 字"
}`
    : isNegativeControl
      ? `{
  "text": "用分号分隔的禁止项，例如：不要出现无关人物；避免卡通质感；禁止商品变形"
}`
      : isPersonSpec
        ? `{
  "person_spec": {
    "castMode": "auto/single/dual/group",
    "gender": "auto/male/female/mixed/all_male/all_female",
    "age": "match_brief/young_adult/adult_30_40/middle_40_55/senior_55_plus",
    "origin": "east_asian_cn/match_brief/mixed_global",
    "roleName": "人物身份或职业",
    "displayName": "正式人物姓名，可留空",
    "appearanceText": "脸型、体型、年龄感、商业真实感、气质、表情可信度，80-160 字",
    "wardrobeText": "上衣、下装、鞋、配饰、颜色、材质、与产品/场景的关系，80-160 字",
    "hairMakeupText": "发型、妆容、眼镜、胡须或其它妆造细节，50-120 字",
    "negativeText": "不要出现的人物错误、服装错误、肤质错误、表情错误，分号分隔"
  }
}`
      : `{
  "brief": "可直接放入广告需求文本框的完整需求",
  "product_subject": "广告主体",
  "cast_mode": "auto/single/dual/multi/no_human",
  "shot_count": 0,
  "forbidden": ["禁止项"],
  "characters": [{"name":"角色名","role":"剧情职责","description":"简短说明"}]
}`;
  const userPrompt = `${contextPrompt(ctx)}

模式：${isStyleControl ? 'style_control 风格方向帮写' : isNegativeControl ? 'negative_control 禁止项帮写' : isPersonSpec ? 'person_spec 人物设定补齐' : mode === 'clean' ? 'clean 整理内容' : 'write 帮我写'}

输出 JSON：
${outputSchema}`;
  const result = await modelGateway.generateText({
    taskId: cleanText(body.task_id || body.taskId || '', 80),
    stage: 'new_story_ad.assist',
    systemPrompt,
    userPrompt,
    maxTokens: 3000,
  });
  const parsed = await jsonRepair.parseOrRepair({
    raw: result.text,
    expected: 'object',
    modelGateway,
    taskId: cleanText(body.task_id || body.taskId || '', 80),
    stage: 'new_story_ad.json_repair',
  });
  if (isStyleControl || isNegativeControl) {
    const text = cleanText(parsed.text || parsed.brief || parsed.content || '', 800);
    return {
      brief: text,
      text,
      mode,
      model_meta: {
        used_model: result.used_model,
        fallback_used: result.fallback_used,
        failed_models: result.failed_models,
      },
    };
  }
  if (isPersonSpec) {
    const raw = parsed.person_spec || parsed.personSpec || parsed;
    const spec = raw && typeof raw === 'object' ? raw : {};
    return {
      person_spec: {
        castMode: cleanText(spec.castMode || spec.cast_mode || 'auto', 40),
        gender: cleanText(spec.gender || 'auto', 40),
        age: cleanText(spec.age || 'match_brief', 40),
        origin: cleanText(spec.origin || 'east_asian_cn', 60),
        roleName: cleanText(spec.roleName || spec.role_name || '', 100),
        displayName: cleanText(spec.displayName || spec.display_name || '', 60),
        appearanceText: cleanText(spec.appearanceText || spec.appearance || spec.description || '', 360),
        wardrobeText: cleanText(spec.wardrobeText || spec.wardrobe || spec.outfit || '', 420),
        hairMakeupText: cleanText(spec.hairMakeupText || spec.hair_makeup || spec.hair || '', 280),
        negativeText: cleanText(spec.negativeText || spec.negative || '', 420),
      },
      mode,
      model_meta: {
        used_model: result.used_model,
        fallback_used: result.fallback_used,
        failed_models: result.failed_models,
      },
    };
  }
  return {
    brief: cleanText(parsed.brief || parsed.content || ctx.brief, 3000),
    product_subject: cleanText(parsed.product_subject || parsed.productSubject || ctx.product_subject, 200),
    cast_mode: cleanText(parsed.cast_mode || parsed.castMode || ctx.cast_mode || 'auto', 40),
    shot_count: Math.max(0, Math.min(18, Number(parsed.shot_count || parsed.shotCount || ctx.shot_count || 0) || 0)),
    forbidden: Array.isArray(parsed.forbidden) ? parsed.forbidden.map(x => cleanText(x, 100)).filter(Boolean) : ctx.forbidden,
    characters: Array.isArray(parsed.characters) ? normalizeCharacters(parsed.characters) : ctx.characters,
    model_meta: {
      used_model: result.used_model,
      fallback_used: result.fallback_used,
      failed_models: result.failed_models,
    },
  };
}

module.exports = {
  createTask,
  updateTaskRequest,
  generateSceneConfig,
  generateBlueprintStage,
  generateStoryboardStage,
  buildKeyframeContractStage,
  generateKeyframesStage,
  generateTtsStage,
  generateVideoStage,
  composeStage,
  runFull,
  publicTaskBundle,
  modelHealth,
  assistBrief,
};
