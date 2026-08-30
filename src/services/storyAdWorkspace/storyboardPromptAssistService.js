'use strict';

const storage = require('../newStoryAd/storageService');
const modelGateway = require('../newStoryAd/modelGateway');
const jsonRepair = require('../newStoryAd/jsonRepairService');
const scenePlanningAuthority = require('../newStoryAd/scenePlanningAuthorityService');
const sceneDomainContract = require('../newStoryAd/sceneDomainContractService');

function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function clean(value = '', max = 3200) { return String(value || '').replace(/\r\n?/g, '\n').trim().slice(0, max); }
function indexOfShot(shot = {}, index = 0) { return Number(shot.shot_index || shot.index || index + 1) || index + 1; }
function compact(value, max = 12000) { return JSON.stringify(value ?? null).slice(0, max); }

function authority(taskId, requestedShotIndex) {
  const task = storage.getTask(taskId);
  if (!task) {
    const error = new Error('项目不存在'); error.status = 404; error.code = 'TASK_NOT_FOUND'; throw error;
  }
  const shots = list(storage.getOutput(taskId, 'storyboard_table'));
  const numericIndex = Number(requestedShotIndex);
  const position = shots.findIndex((shot, index) => indexOfShot(shot, index) === numericIndex);
  if (!Number.isInteger(numericIndex) || numericIndex < 1 || position < 0) {
    const error = new Error('没有找到需要 AI 完善的分镜'); error.status = 404; error.code = 'STORYBOARD_SHOT_NOT_FOUND'; throw error;
  }
  const contextOutput = storage.getOutput(taskId, 'context');
  const context = contextOutput && typeof contextOutput === 'object' ? contextOutput : (task.request || {});
  const rawScenes = list(storage.getOutput(taskId, 'scene_assets')).length
    ? list(storage.getOutput(taskId, 'scene_assets')) : list(context.scene_assets);
  const sceneConfig = storage.getOutput(taskId, 'scene_config') || context.scene_config || context.scene_plan || {};
  const overrides = storage.getOutput(taskId, 'scene_world_overrides') || {};
  const scenes = scenePlanningAuthority.enrichSceneAssets(rawScenes, sceneConfig, context, overrides);
  const shot = shots[position];
  const sceneId = clean(shot.scene_id || shot.scene_asset_id, 160);
  const scene = scenes.find(item => [item.id, item.scene_id].map(value => clean(value, 160)).includes(sceneId)) || {};
  const planning = scenePlanningAuthority.contractForShot(scene, shot);
  const domain = sceneDomainContract.compile({ shot, sceneAsset: scene, scenePlanningContract: planning, context });
  const flow = storage.getOutput(taskId, 'story_flow_contract') || {};
  const units = list(flow.units);
  const beatId = clean(shot.source_beat_id || shot.story_beat_id, 160);
  const beatPosition = units.findIndex(unit => clean(unit.beat_id || unit.unit_id, 160) === beatId);
  const promptOverride = list(storage.getOutput(taskId, 'storyboard_image_prompt_overrides'))
    .find(item => Number(item.shot_index) === numericIndex);
  const referencePack = list(storage.getOutput(taskId, 'shot_reference_packs'))
    .find(item => Number(item.shot_index) === numericIndex) || {};
  return {
    task, shots, shot, position, context, scene, planning, domain, flow,
    currentBeat: beatPosition >= 0 ? units[beatPosition] : units[position] || null,
    previousBeat: beatPosition > 0 ? units[beatPosition - 1] : (position > 0 ? units[position - 1] : null),
    nextBeat: beatPosition >= 0 && beatPosition < units.length - 1 ? units[beatPosition + 1] : units[position + 1] || null,
    currentPrompt: clean(promptOverride?.prompt_text || sceneDomainContract.userPrompt(shot, domain), 3200),
    referenceRoles: list(referencePack.references).map(item => ({ role: item.role, required: item.required === true, order: item.order })),
  };
}

async function suggest(taskId, requestedShotIndex, options = {}, dependencies = {}) {
  const source = authority(taskId, requestedShotIndex);
  if (source.task.active_generation_id) {
    const error = new Error('当前项目正在生成，请等待完成后再使用 AI 帮写');
    error.status = 409; error.code = 'GENERATION_ACTIVE_EDIT_BLOCKED'; throw error;
  }
  const beforeRevision = Number(source.task.content_revision || 1) || 1;
  const beforeShotFingerprint = storage.canonicalFingerprint(source.shot);
  const gateway = dependencies.modelGateway || modelGateway;
  const response = await gateway.generateText({
    taskId,
    stage: 'new_story_ad.assist',
    systemPrompt: [
      '你是全行业影视分镜提示词编辑器。只输出 JSON 对象，不要 markdown。',
      '重新阅读当前项目的剧本节拍、当前镜头、前后镜头、权威场景规划和引用角色，为当前这一镜改写可直接用于单张分镜图生成的中文提示词。',
      '只能完善表达，不得更换 scene_id、人物/动物/车辆/商品身份与数量、剧情先后、机位权威或引用资产。',
      '一张图只能呈现一个决定性瞬间；不得把进入、行走、触摸、转身、离开等多个时间阶段同时画入，禁止同一身份重复出现。',
      '提示词必须适用于当前真实行业和主体类型，不得套用家居、展厅、人类或其它固定模板。',
      '输出结构：{"prompt_text":"完整提示词","improvements":["简短改进点"]}。',
    ].join('\n'),
    userPrompt: [
      `项目需求：${clean(source.task.request?.brief || source.context.brief || source.task.brief, 5000)}`,
      `剧本当前节拍：${compact(source.currentBeat, 5000)}`,
      `上一节拍：${compact(source.previousBeat, 2400)}`,
      `下一节拍：${compact(source.nextBeat, 2400)}`,
      `当前镜头：${compact(source.shot, 7000)}`,
      `权威场景：${compact({ id: source.scene.id || source.scene.scene_id, name: source.scene.name, story_purpose: source.scene.story_purpose }, 2400)}`,
      `场景与机位规划：${compact(source.planning, 6500)}`,
      `不可覆盖的场景域与主体数量合同：${compact(source.domain, 5000)}`,
      `本镜引用角色：${compact(source.referenceRoles, 1600)}`,
      `当前提示词：${source.currentPrompt}`,
    ].join('\n\n'),
    maxTokens: 1800,
    temperature: 0.2,
    timeoutMs: 90000,
    maxCandidates: 2,
    structuredOutput: { mode: 'json_object', name: 'storyboard_prompt_assist' },
  });
  const parsed = response.parsed_json || jsonRepair.parseJson(response.text, 'object');
  const promptText = clean(parsed.prompt_text || parsed.prompt || '', 3200);
  if (promptText.length < 40) {
    const error = new Error('AI 返回的分镜提示词不完整，请重试'); error.status = 502; error.code = 'STORYBOARD_PROMPT_ASSIST_INVALID'; throw error;
  }
  const currentTask = storage.getTask(taskId);
  const currentShots = list(storage.getOutput(taskId, 'storyboard_table'));
  const currentShot = currentShots.find((shot, index) => indexOfShot(shot, index) === Number(requestedShotIndex));
  if ((Number(currentTask?.content_revision || 1) || 1) !== beforeRevision
    || storage.canonicalFingerprint(currentShot) !== beforeShotFingerprint) {
    const error = new Error('AI 帮写期间剧本或分镜已变化，本次建议没有覆盖新内容');
    error.status = 409; error.code = 'STORYBOARD_PROMPT_ASSIST_STALE'; throw error;
  }
  return {
    shot_index: Number(requestedShotIndex),
    prompt_text: promptText,
    improvements: list(parsed.improvements).map(item => clean(item, 160)).filter(Boolean).slice(0, 6),
    source_content_revision: beforeRevision,
    saved: false,
    generation_started: false,
    model_meta: { used_model: response.used_model, fallback_used: response.fallback_used === true },
  };
}

module.exports = { authority, suggest };
