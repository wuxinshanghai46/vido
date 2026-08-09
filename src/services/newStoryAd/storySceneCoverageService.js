'use strict';

const contentSkill = require('./contentSkillService');
const { cleanText } = require('./contextBuilder');
const topologyCompiler = require('./narrativeTopologyCompilerService');

const CONTRACT_VERSION = 5;
const MINIMUM_ENFORCED_VERSION = 4;
const REQUIRED_PHASES = ['opening', 'development', 'turning_point', 'resolution'];
const TRANSITION_TYPES = new Set([
  'opening', 'continuity', 'time_change', 'location_change', 'environment_change', 'narrative_shift', 'composite_change',
]);
const TIME_CHANGE_TYPES = new Set(['time_change', 'narrative_shift', 'composite_change']);
const LOCATION_CHANGE_TYPES = new Set(['location_change', 'narrative_shift', 'composite_change']);
const ENVIRONMENT_CHANGE_TYPES = new Set(['environment_change', 'narrative_shift', 'composite_change']);

function required(ctx = {}, options = {}) {
  if (contentSkill.mode(ctx.content_mode || ctx.product_presentation?.mode) !== 'narrative_story') return false;
  return options.required === true
    || Number(ctx.story_scene_contract_version || ctx.storySceneContractVersion || 0) >= MINIMUM_ENFORCED_VERSION;
}

function plotBeats(storySeed = {}) {
  return topologyCompiler.compileStorySeed(storySeed).plot_beats.slice(0, 32);
}

function expectedBeatCount(ctx = {}) {
  const duration = Math.max(1, Number(ctx.target_duration || ctx.targetDuration || 30) || 30);
  const shots = Math.max(0, Number(ctx.shot_count || ctx.shotCount || 0) || 0);
  const durationFloor = duration >= 60 ? 8 : (duration >= 30 ? 6 : 4);
  return Math.max(4, Math.min(16, Math.max(durationFloor, Math.ceil(duration / 12), shots ? Math.ceil(shots / 2) : 0)));
}

function expectedProductionSceneCount(storySeed = {}, ctx = {}) {
  const beats = plotBeats(storySeed);
  if (!beats.length) return 1;
  return Math.max(1, new Set(beats.map(beat => beat.production_scene_key).filter(Boolean)).size);
}

function storySeedIssues(storySeed = {}, ctx = {}, options = {}) {
  if (!required(ctx, options)) return [];
  const issues = topologyCompiler.storyFactIssues(storySeed);
  const beats = plotBeats(storySeed);
  if (!beats.length) return [...new Set(issues.length ? issues : ['story_seed.plot_beats_missing'])];
  const minimumBeats = expectedBeatCount(ctx);
  if (beats.length < minimumBeats) issues.push(`story_seed.plot_beats_too_shallow:${beats.length}/${minimumBeats}`);
  const requiredPhases = REQUIRED_PHASES.filter(phase => cleanText(storySeed?.[phase] || '', 1000));
  const phases = new Set(beats.map(beat => beat.phase));
  requiredPhases.forEach((phase) => {
    if (!phases.has(phase)) issues.push(`story_seed.plot_beats_phase_missing:${phase}`);
  });
  beats.forEach((beat, index) => {
    const prefix = `story_seed.plot_beats[${index}]`;
    ['production_scene_key', 'transition_type'].forEach((field) => {
      if (!beat[field]) issues.push(`${prefix}.${field}_compiler_missing`);
    });
    if (beat.transition_type && !TRANSITION_TYPES.has(beat.transition_type)) {
      issues.push(`${prefix}.transition_type_invalid:${beat.transition_type}`);
    }
    if (index === 0 && beat.transition_type && beat.transition_type !== 'opening') {
      issues.push(`${prefix}.transition_type_first_must_be_opening`);
    }
  });
  const keyLastIndex = new Map();
  beats.forEach((beat, index) => {
    const prefix = `story_seed.plot_beats[${index}]`;
    if (!beat.production_scene_key) return;
    const previousIndex = keyLastIndex.get(beat.production_scene_key);
    if (Number.isInteger(previousIndex) && previousIndex !== index - 1) {
      issues.push(`story_seed.production_scene_key_non_contiguous_reuse:${beat.production_scene_key}`);
    }
    keyLastIndex.set(beat.production_scene_key, index);
    if (index > 0 && beat.production_scene_key !== beats[index - 1].production_scene_key && !beat.scene_change_reason) {
      issues.push(`${prefix}.scene_change_reason_missing`);
    }
  });
  return [...new Set(issues)];
}

function coverageIssues(source = {}, ctx = {}, options = {}) {
  if (!required(ctx, options)) return [];
  const storySeed = topologyCompiler.compileStorySeed(source.story_seed || source.storySeed || {});
  const seedIssues = storySeedIssues(storySeed, ctx, options);
  if (seedIssues.length) return seedIssues;
  const scenePlan = source.scene_plan || source.scenePlan || source.scene_config || source.sceneConfig || {};
  const spaces = Array.isArray(scenePlan.spaces) ? scenePlan.spaces : [];
  if (!spaces.length) return ['scene_plan.spaces_missing'];
  const issues = [];
  const sceneIds = new Set();
  const spaceByKey = new Map();
  spaces.forEach((space, index) => {
    const id = cleanText(space?.id || space?.scene_id || space?.sceneId || space?.space_id || space?.spaceId || '', 100);
    if (!id) {
      issues.push(`scene_plan.spaces[${index}].id_missing`);
      return;
    }
    if (sceneIds.has(id)) {
      issues.push(`scene_plan.spaces[${index}].id_duplicate:${id}`);
      return;
    }
    sceneIds.add(id);
    const key = cleanText(space?.production_scene_key || space?.productionSceneKey || '', 100);
    if (!key) issues.push(`scene_plan.spaces[${index}].production_scene_key_missing`);
    else if (spaceByKey.has(key)) issues.push(`scene_plan.production_scene_key_duplicate:${key}`);
    else spaceByKey.set(key, { id, covered: new Set((space.covered_beat_ids || space.coveredBeatIds || []).map(value => cleanText(value, 100)).filter(Boolean)) });
  });
  const coveredBeatIds = new Map();
  spaceByKey.forEach((space, key) => space.covered.forEach((beatId) => {
    if (coveredBeatIds.has(beatId)) issues.push(`scene_plan.beat_covered_more_than_once:${beatId}`);
    else coveredBeatIds.set(beatId, key);
  }));
  plotBeats(storySeed).forEach((beat, index) => {
    if (!spaceByKey.has(beat.production_scene_key)) issues.push(`story_seed.plot_beats[${index}].production_scene_key_unmapped:${beat.production_scene_key}`);
    if (coveredBeatIds.get(beat.id) !== beat.production_scene_key) issues.push(`story_seed.plot_beats[${index}].beat_not_covered_by_scene:${beat.id}`);
  });
  if (sceneIds.size > 1 && cleanText(scenePlan.scene_mode || '', 30) !== 'multi') {
    issues.push('scene_plan.scene_mode_must_be_multi');
  }
  return issues;
}

function assertCoverage(source = {}, ctx = {}, options = {}) {
  const issues = coverageIssues(source, ctx, options);
  if (!issues.length) return source;
  const error = new Error(`剧情场景未覆盖完整故事时空：${issues.join('；')}`);
  error.code = 'ASSET_PLAN_STORY_SCENE_COVERAGE_INCOMPLETE';
  error.status = 422;
  error.retryable = true;
  error.story_scene_coverage_issues = issues;
  throw error;
}

function promptBlock(ctx = {}, options = {}) {
  if (!required(ctx, options)) return '';
  return [
    `剧情事实合同 v${CONTRACT_VERSION}：模型只陈述剧情事实，production_scene_key、scene_id、transition_type 和 covered_beat_ids 均由平台确定性编译，模型不得自行分配。`,
    `story_seed.plot_beats 至少 ${expectedBeatCount(ctx)} 个，必须覆盖 opening、development、turning_point、resolution，并根据用户输入补足人物目标、关系或状态建立、触发原因、发展升级、关键变化、代价、后果和结局回收。`,
    '题材、行业、时代、文化、人物身份、地点、冲突类型和结局方向只能来自用户输入、已确认素材及与其一致的知识；允许补足必要连接动作，但禁止擅自注入输入中不存在的题材套路、职业、商品、灾难、死亡、穿越或关系类型。',
    '每个 plot beat 必须包含稳定 id、phase、era、time_anchor、location、production_state、summary、cause、consequence，以及 production_relation。',
    'production_relation 必须分别声明 era、time、location、environment 相对上一节拍是 same、continuous 或 changed；无法确定必须写 unknown，禁止用自然语言同义词差异代替结构化关系。',
    'production_requirements 可描述 layout、material_light、interaction、negative；这些是制作事实，不是场景键。',
    '场景数量由平台根据结构化制作变化确定，不设固定模板和数量下限，也不得为了凑数量虚构空间。',
  ].join('\n');
}

module.exports = {
  CONTRACT_VERSION,
  REQUIRED_PHASES,
  TRANSITION_TYPES,
  required,
  plotBeats,
  expectedBeatCount,
  expectedProductionSceneCount,
  storySeedIssues,
  coverageIssues,
  assertCoverage,
  promptBlock,
  compileStorySeed: topologyCompiler.compileStorySeed,
  compileScenePlan: topologyCompiler.compileScenePlan,
  compileAssetPlan: topologyCompiler.compileAssetPlan,
  buildStorySeedRepairScope: topologyCompiler.buildStorySeedRepairScope,
  storySeedPatchOutputTemplate: topologyCompiler.storySeedPatchOutputTemplate,
  validateStorySeedPatch: topologyCompiler.validateStorySeedPatch,
  mergeStorySeedPatch: topologyCompiler.mergeStorySeedPatch,
};
