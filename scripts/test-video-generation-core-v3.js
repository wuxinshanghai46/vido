const assert = require('assert');
const core = require('../src/services/videoGenerationCore');

/** 为测试镜头创建最小场景锁合同。 */
function contract(sceneId, revision = 1) {
  return {
    contract_fingerprint: `contract-${sceneId}-${revision}`,
    scene_lock: {
      scene_id: sceneId,
      scene_revision: revision,
      scene_name: `测试场景 ${sceneId}`,
      layout_summary: '固定空间结构',
      scene_contract: { lighting: '自然光', zones: [], anchors: [] },
    },
  };
}

/** 使用通用剧情广告策略编译测试执行方案。 */
function compile(shots, contracts, options = {}) {
  return core.planner.compileExecutionPlan({ shots, contracts, businessProfile: 'story_ad', options });
}

/** 执行人物规模、场景规模、生成路由和成本门禁的完整回归。 */
function run() {
  const noHumanSingle = compile([
    { title: '产品空镜', scene_id: 'product-room', characters: [], action: '镜头缓慢推进展示表面纹理', camera: 'push slow' },
  ], [contract('product-room')]);
  assert.deepStrictEqual(noHumanSingle.summary.cast_modes, ['no_human']);
  assert.strictEqual(noHumanSingle.generation_units[0].mode, 'local_motion');

  const noHumanMulti = compile([
    { scene_id: 'room-a', characters: [], action: '产品静止，镜头推进' },
    { scene_id: 'room-b', characters: [], action: '产品静止，镜头推进' },
  ], [contract('room-a'), contract('room-b')]);
  assert.strictEqual(noHumanMulti.summary.scene_world_count, 2);
  assert.strictEqual(noHumanMulti.summary.generation_unit_count, 2);

  const singleSingle = compile([
    { scene_id: 'home', characters: ['主角'], action: '主角抬头' },
    { scene_id: 'home', characters: ['主角'], action: '主角起身' },
  ], [contract('home'), contract('home')]);
  assert.deepStrictEqual(singleSingle.summary.cast_modes, ['single']);
  assert.deepStrictEqual(singleSingle.generation_units.map(unit => unit.edit_shot_indexes), [[0], [1]], '同场景也必须默认逐镜生成');

  const singleMulti = compile([
    { scene_id: 'office', characters: ['主角'], time_of_day: '白天' },
    { scene_id: 'street', characters: ['主角'], time_of_day: '夜晚' },
  ], [contract('office'), contract('street')]);
  assert.strictEqual(singleMulti.summary.scene_world_count, 2);

  const dualSingle = compile([
    { scene_id: 'cafe', characters: ['角色甲', '角色乙'], camera_axis_id: 'axis-a', eyeline_target_id: '角色乙' },
  ], [contract('cafe')]);
  assert.strictEqual(dualSingle.edit_shots[0].cast.mode, 'dual');
  assert.strictEqual(dualSingle.edit_shots[0].cast.camera_axis_id, 'axis-a');

  const dualMulti = compile([
    { scene_id: 'cafe', characters: ['角色甲', '角色乙'] },
    { scene_id: 'station', characters: ['角色甲', '角色乙'] },
  ], [contract('cafe'), contract('station')]);
  assert.strictEqual(dualMulti.summary.scene_world_count, 2);
  assert.strictEqual(dualMulti.summary.generation_unit_count, 2);

  const multiSingle = compile([
    { scene_id: 'meeting', characters: ['甲', '乙', '丙', '丁'], action: '四人开会并依次发言' },
  ], [contract('meeting')]);
  assert.strictEqual(multiSingle.edit_shots[0].cast.mode, 'multi_principal');
  assert.strictEqual(multiSingle.summary.high_risk_unit_count, 1);

  const crowdMulti = compile([
    { scene_id: 'square', cast_mode: 'crowd', people_count: 20, action: '人群沿道路移动' },
    { scene_id: 'hall', cast_mode: 'crowd', people_count: 30, action: '观众入场' },
  ], [contract('square'), contract('hall')]);
  assert.deepStrictEqual(crowdMulti.summary.cast_modes, ['crowd']);
  assert.strictEqual(crowdMulti.summary.high_risk_unit_count, 2);

  const oneTakeShots = [
    { scene_id: 'studio', characters: ['主角'], duration: 3, one_take_group_id: 'take-1', action: '主角向前走' },
    { scene_id: 'studio', characters: ['主角'], duration: 3, one_take_group_id: 'take-1', action: '主角停下并回头' },
  ];
  const defaultOneTake = compile(oneTakeShots, [contract('studio'), contract('studio')]);
  assert.strictEqual(defaultOneTake.summary.one_take_unit_count, 0, '一镜到底不得默认开启');
  const approvedOneTake = compile(oneTakeShots, [contract('studio'), contract('studio')], {
    allow_one_take: true,
    provider_supports_one_take: true,
  });
  assert.strictEqual(approvedOneTake.summary.one_take_unit_count, 1);

  const costPlan = core.costGuard.buildCostPlan({
    executionPlan: singleSingle,
    providerId: 'deyunai',
    modelId: 'doubao-seedance-2-0-260128',
    options: { usd_cny_rate: 7.2 },
  });
  assert.strictEqual(costPlan.price_known, true);
  assert.strictEqual(costPlan.automatic_paid_retry_count, 0);
  assert(costPlan.maximum_cost_rmb >= costPlan.estimated_cost_rmb);
  const authorization = core.costGuard.assertCostAuthorization(costPlan, {
    cost_plan_fingerprint: costPlan.fingerprint,
    confirmed_cost_limit_rmb: costPlan.maximum_cost_rmb,
  });
  assert.strictEqual(authorization.authorized, true);

  const unknownCost = core.costGuard.buildCostPlan({ executionPlan: singleSingle, modelId: 'unknown-paid-video-model' });
  assert.throws(
    () => core.costGuard.assertCostAuthorization(unknownCost, {}),
    error => error.code === 'VIDEO_COST_PRICE_UNKNOWN' && /[\u3400-\u9fff]/.test(error.message),
  );

  assert.strictEqual(core.planner.resolveBusinessProfile('ecommerce_ad').label, '电商广告');
  assert.strictEqual(core.planner.resolveBusinessProfile('unknown-industry').id, 'free_canvas');
  console.log('通用视频生成核心 V3：全部测试通过');
}

run();
