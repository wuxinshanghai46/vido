const domain = require('./domainContract');
const { VideoGenerationError } = require('./chineseError');

const PLAN_VERSION = 'video-generation-core-v3';

const BUSINESS_PROFILES = Object.freeze({
  story_ad: { label: '剧情广告', priorities: ['人物身份', '动作连续性', '对白与视线'] },
  ecommerce_ad: { label: '电商广告', priorities: ['商品身份', '卖点特写', '价格与字幕'] },
  social_ad: { label: '社媒广告', priorities: ['前三秒钩子', '节奏', '字幕可读性'] },
  product_demo: { label: '产品演示', priorities: ['操作准确性', '步骤完整性', '界面可读性'] },
  corporate_video: { label: '企业宣传', priorities: ['品牌一致性', '空间关系', '群体镜头'] },
  free_canvas: { label: '自由创作', priorities: ['用户控制', '素材复用', '可编辑性'] },
});

/** 读取业务策略；未知业务使用自由创作策略，避免硬编码行业。 */
function resolveBusinessProfile(value = '') {
  const key = domain.text(value || 'story_ad').toLowerCase().replace(/[\s-]+/g, '_');
  return { id: BUSINESS_PROFILES[key] ? key : 'free_canvas', ...(BUSINESS_PROFILES[key] || BUSINESS_PROFILES.free_canvas) };
}

/** 根据人物规模、空间跨度和动作难度计算执行复杂度。 */
function complexityOf(editShot = {}) {
  const castScores = { no_human: 0, single: 1, dual: 2, multi_principal: 3, crowd: 4 };
  let level = castScores[editShot.cast?.mode] ?? 1;
  const actionText = `${editShot.action || ''} ${editShot.visual || ''}`;
  if (/接触|拥抱|握手|递给|争抢|遮挡|交叉|追逐|打斗|contact|hug|handshake|occlusion|fight/i.test(actionText)) level += 1;
  if (/快速|复杂|连续变形|爆炸|群舞|编队|fast|complex|transform|explosion|choreograph/i.test(actionText)) level += 1;
  return Math.max(0, Math.min(4, level));
}

/** 判断镜头是否适合完全本地化的确定性轻运镜。 */
function canUseLocalMotion(editShot = {}) {
  if (editShot.cast?.mode !== 'no_human') return false;
  const actionText = `${editShot.action || ''} ${editShot.camera || ''}`;
  const hasGeneratedEffect = /粒子|汇聚|变形|爆炸|出现人物|logo.*形成|particle|morph|transform|explosion/i.test(actionText);
  const simpleMotion = /静止|横移|推进|拉远|摇移|焦点|光影|纹理|表面|static|pan|truck|push|zoom|focus|light|texture|surface/i.test(actionText);
  return simpleMotion && !hasGeneratedEffect;
}

/** 判断镜头是否包含必须保留的剪辑边界。 */
function hasEditorialBoundary(editShot = {}) {
  return /hard.?cut|match.?cut|jump.?cut|smash.?cut|fade|dissolve|montage|flash|black/i.test(editShot.transition_type || '');
}

/** 判断一组镜头是否满足真正一镜到底的全部条件。 */
function canBuildOneTake(group = [], options = {}) {
  if (options.allow_one_take !== true && options.allowOneTake !== true) return false;
  if (options.provider_supports_one_take !== true && options.providerSupportsOneTake !== true) return false;
  if (group.length < 2) return false;
  if (!group[0].one_take_group_id || group.some(shot => shot.one_take_group_id !== group[0].one_take_group_id)) return false;
  if (group.some(shot => !domain.sameSceneVisit(group[0], shot))) return false;
  if (group.some(shot => complexityOf(shot) > 2 || hasEditorialBoundary(shot))) return false;
  const duration = group.reduce((sum, shot) => sum + Number(shot.duration_sec || 0), 0);
  return duration <= Math.max(5, Math.min(15, Number(options.one_take_max_duration || 15) || 15));
}

/** 汇总并版本化所有物理场景世界和访问状态。 */
function buildSceneWorlds(editShots = [], contracts = []) {
  const worlds = new Map();
  editShots.forEach((shot, index) => {
    const contract = contracts[index] || {};
    const lock = contract.scene_lock || {};
    const key = `${shot.scene_world_id}@${shot.scene_world_revision}`;
    const current = worlds.get(key) || {
      id: shot.scene_world_id,
      revision: shot.scene_world_revision,
      key,
      name: domain.text(lock.scene_name || lock.name),
      layout_summary: domain.text(lock.layout_summary),
      material_summary: domain.text(lock.material_summary),
      style_summary: domain.text(lock.style_summary),
      zones: Array.isArray(lock.scene_contract?.zones) ? lock.scene_contract.zones : [],
      anchors: Array.isArray(lock.scene_contract?.anchors) ? lock.scene_contract.anchors : [],
      visits: [],
      edit_shot_indexes: [],
    };
    current.edit_shot_indexes.push(index);
    if (!current.visits.some(visit => visit.id === shot.scene_visit_id)) {
      current.visits.push({ id: shot.scene_visit_id, state: shot.scene_visit_state, zone_ids: shot.scene_zone_ids });
    }
    worlds.set(key, current);
  });
  return [...worlds.values()].map(world => ({ ...world, fingerprint: domain.fingerprint(world) }));
}

/** 构建只负责连续性传递、绝不隐含付费合并的连续性段。 */
function buildContinuityRuns(editShots = []) {
  const runs = [];
  let current = null;
  editShots.forEach((shot, index) => {
    const previous = editShots[index - 1] || null;
    const sameVisit = previous && domain.sameSceneVisit(previous, shot);
    const explicitBoundary = hasEditorialBoundary(shot);
    if (!current || !sameVisit || explicitBoundary) {
      if (current) runs.push({ ...current, fingerprint: domain.fingerprint(current) });
      current = {
        id: `continuity-run-${runs.length + 1}`,
        scene_world_id: shot.scene_world_id,
        scene_visit_id: shot.scene_visit_id,
        edit_shot_indexes: [index],
        character_ids: [...new Set([...(shot.cast?.principal_character_ids || []), ...(shot.cast?.supporting_character_ids || [])])],
      };
      return;
    }
    current.edit_shot_indexes.push(index);
    current.character_ids = [...new Set([...current.character_ids, ...(shot.cast?.principal_character_ids || []), ...(shot.cast?.supporting_character_ids || [])])];
  });
  if (current) runs.push({ ...current, fingerprint: domain.fingerprint(current) });
  return runs;
}

/** 创建一个可独立计费、独立失败和独立恢复的生成单元。 */
function makeGenerationUnit(editShots = [], indexes = [], mode = 'single_shot') {
  const members = indexes.map(index => editShots[index]).filter(Boolean);
  if (!members.length) throw new VideoGenerationError('VIDEO_PLAN_INVALID');
  const duration = members.reduce((sum, shot) => sum + Number(shot.duration_sec || 0), 0);
  const complexity = Math.max(...members.map(complexityOf));
  const payload = {
    mode,
    edit_shot_indexes: indexes,
    scene_world_id: members[0].scene_world_id,
    scene_visit_id: members[0].scene_visit_id,
    duration_sec: duration,
    complexity_level: complexity,
    requires_manual_review: complexity >= 3,
  };
  return {
    id: `generation-unit-${indexes[0] + 1}-${domain.fingerprint(payload).slice(0, 12)}`,
    ...payload,
    paid: mode !== 'local_motion',
    automatic_retry_limit: 0,
    fingerprint: domain.fingerprint(payload),
  };
}

/** 默认逐镜构建生成单元，仅对明确标记且满足能力约束的一镜到底进行合并。 */
function buildGenerationUnits(editShots = [], options = {}) {
  const units = [];
  let index = 0;
  while (index < editShots.length) {
    const shot = editShots[index];
    if (shot.one_take_group_id) {
      const group = [];
      let cursor = index;
      while (cursor < editShots.length && editShots[cursor].one_take_group_id === shot.one_take_group_id) {
        group.push(editShots[cursor]);
        cursor += 1;
      }
      if (canBuildOneTake(group, options)) {
        units.push(makeGenerationUnit(editShots, group.map(item => item.index), 'one_take'));
        index = cursor;
        continue;
      }
    }
    const mode = canUseLocalMotion(shot) && options.disable_local_motion !== true ? 'local_motion' : 'single_shot';
    units.push(makeGenerationUnit(editShots, [index], mode));
    index += 1;
  }
  return units;
}

/** 编译跨行业通用的视频执行方案，并保留旧项目可读取的镜头序号。 */
function compileExecutionPlan({ shots = [], contracts = [], businessProfile = 'story_ad', options = {} } = {}) {
  if (!Array.isArray(shots) || !shots.length) throw new VideoGenerationError('VIDEO_PLAN_INVALID', '当前项目没有可执行镜头，请先完成剧本和分镜。');
  const editShots = shots.map((shot, index) => domain.buildEditShot(shot || {}, contracts[index] || {}, index));
  const sceneWorlds = buildSceneWorlds(editShots, contracts);
  const continuityRuns = buildContinuityRuns(editShots);
  const generationUnits = buildGenerationUnits(editShots, options);
  const profile = resolveBusinessProfile(businessProfile);
  const plan = {
    version: PLAN_VERSION,
    business_profile: profile,
    scene_worlds: sceneWorlds,
    edit_shots: editShots,
    continuity_runs: continuityRuns,
    generation_units: generationUnits,
    summary: {
      scene_world_count: sceneWorlds.length,
      scene_visit_count: sceneWorlds.reduce((sum, world) => sum + world.visits.length, 0),
      edit_shot_count: editShots.length,
      generation_unit_count: generationUnits.length,
      paid_unit_count: generationUnits.filter(unit => unit.paid).length,
      local_unit_count: generationUnits.filter(unit => !unit.paid).length,
      one_take_unit_count: generationUnits.filter(unit => unit.mode === 'one_take').length,
      high_risk_unit_count: generationUnits.filter(unit => unit.requires_manual_review).length,
      cast_modes: [...new Set(editShots.map(shot => shot.cast.mode))],
    },
  };
  return { ...plan, fingerprint: domain.fingerprint(plan) };
}

module.exports = {
  PLAN_VERSION,
  BUSINESS_PROFILES,
  resolveBusinessProfile,
  complexityOf,
  canUseLocalMotion,
  hasEditorialBoundary,
  canBuildOneTake,
  buildSceneWorlds,
  buildContinuityRuns,
  makeGenerationUnit,
  buildGenerationUnits,
  compileExecutionPlan,
};
