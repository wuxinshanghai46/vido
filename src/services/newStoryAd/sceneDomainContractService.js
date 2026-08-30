'use strict';

const crypto = require('crypto');

const CONTRACT_VERSION = 1;
const clean = (value = '', max = 1600) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = value => Array.isArray(value) ? value.filter(Boolean) : [];

const ENVIRONMENTS = new Set([
  'interior', 'exterior', 'roadway', 'rail', 'airborne', 'aquatic', 'industrial',
  'tabletop', 'stage', 'abstract', 'virtual', 'general_physical',
]);
const SUBJECTS = new Set(['human', 'animal', 'vehicle', 'product', 'environment', 'abstract', 'mixed']);
const MOTIONS = new Set(['stationary', 'route', 'pursuit', 'rigid_body', 'flock', 'transformation', 'process', 'performance', 'dialogue', 'interaction']);

function firstStructured(values = [], allowed = null) {
  for (const value of values) {
    const normalized = clean(value, 80).toLowerCase();
    if (normalized && (!allowed || allowed.has(normalized))) return normalized;
  }
  return '';
}

function sourceText({ shot = {}, sceneAsset = {}, scenePlanningContract = {}, context = {} } = {}) {
  const spec = sceneAsset.scene_spec || {};
  return clean([
    shot.title, shot.purpose, shot.visual, shot.action, shot.subject_type,
    sceneAsset.name, sceneAsset.description, sceneAsset.story_purpose,
    spec.layoutText, spec.layout_text, spec.interactionText, spec.interaction_text,
    scenePlanningContract.layout, scenePlanningContract.interaction,
    context.content_form, context.industry, context.product_subject,
  ].filter(Boolean).join(' '), 7000).toLowerCase();
}

function inferEnvironment(input = {}) {
  const { shot = {}, sceneAsset = {}, scenePlanningContract = {}, context = {} } = input;
  const spec = sceneAsset.scene_spec || {};
  const explicit = firstStructured([
    shot.environment_archetype, shot.environment_class, sceneAsset.environment_archetype,
    sceneAsset.environment_class, spec.environmentArchetype, spec.environment_archetype,
    scenePlanningContract.environment_archetype, context.environment_archetype,
  ], ENVIRONMENTS);
  if (explicit) return explicit;
  const text = sourceText(input);
  if (/抽象|粒子|光流|能量场|形态变化|abstract|particle|energy field|motion graphic|surreal field/u.test(text)) return 'abstract';
  if (/虚拟空间|数字孪生|元宇宙|赛博空间|virtual world|digital twin|metaverse|cyberspace/u.test(text)) return 'virtual';
  if (/飞机|飞行器|无人机|天空|云层|航空|aircraft|airplane|drone|sky|aerial/u.test(text)) return 'airborne';
  if (/海洋|水下|河流|湖面|船舶|游艇|aquatic|underwater|ocean|river|boat|ship/u.test(text)) return 'aquatic';
  if (/铁路|轨道|列车|地铁|railway|railroad|train|subway/u.test(text)) return 'rail';
  if (/道路|公路|街道|车道|赛道|road|highway|street|lane|racetrack/u.test(text)) return 'roadway';
  if (/工厂|产线|车间|仓库|实验室|施工|机械臂|factory|production line|workshop|warehouse|laboratory|construction|robot arm/u.test(text)) return 'industrial';
  if (/舞台|演播室|秀场|球场|赛场|剧院|stage|studio set|runway show|stadium|arena|theatre/u.test(text)) return 'stage';
  if (/桌面|台面|静物|产品棚拍|tabletop|countertop|still life|product studio/u.test(text)) return 'tabletop';
  if (/户外|森林|草原|山地|沙漠|广场|田野|公园|城市外景|outdoor|forest|grassland|mountain|desert|plaza|field|park/u.test(text)) return 'exterior';
  if (/室内|房间|展厅|办公室|商店|住宅|酒店|餐厅|教室|医院|interior|room|showroom|office|store|home|hotel|restaurant|classroom|hospital/u.test(text)) return 'interior';
  return 'general_physical';
}

function expectedCount(shot = {}, names = [], fallback = 0) {
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(shot, name)) continue;
    const value = Number(shot[name]);
    if (Number.isFinite(value)) return Math.max(0, Math.round(value));
  }
  return Math.max(0, Math.round(Number(fallback) || 0));
}

function subjectCountContract(shot = {}, context = {}) {
  const characters = list(shot.characters);
  const animals = list(shot.pets || shot.animals);
  const vehicles = list(shot.vehicles);
  // 只有结构化 products 才代表需要精确计数的主要商品；普通 props 可能包含
  // 背景陈设和状态道具，不能误升格为逐个可见的主要商品合同。
  const products = list(shot.products).filter(item => item?.on_screen !== false);
  const shotText = clean([shot.title, shot.visual, shot.action].filter(Boolean).join(' '), 2400).toLowerCase();
  const animalGroup = shot.animal_group === true || /动物群|兽群|鸟群|鱼群|蜂群|flock|herd|school of fish|swarm/u.test(shotText);
  const vehicleGroup = shot.vehicle_group === true || /车队|机群|船队|convoy|fleet|formation/u.test(shotText);
  return {
    people: expectedCount(shot, ['expected_people', 'person_count'], characters.length),
    animals: expectedCount(shot, ['expected_animals', 'animal_count'], animals.length),
    vehicles: expectedCount(shot, ['expected_vehicles', 'vehicle_count'], vehicles.length),
    products: expectedCount(shot, ['expected_products', 'product_count'], products.length),
    people_ids: characters.map(item => clean(item?.id || item?.name || item, 120)).filter(Boolean),
    animal_ids: animals.map(item => clean(item?.id || item?.name || item?.species || item, 120)).filter(Boolean),
    vehicle_ids: vehicles.map(item => clean(item?.id || item?.name || item?.model || item, 120)).filter(Boolean),
    count_modes: {
      people: clean(shot.people_count_mode || 'exact', 30),
      animals: clean(shot.animals_count_mode || (animalGroup ? 'minimum' : 'exact'), 30),
      vehicles: clean(shot.vehicles_count_mode || (vehicleGroup ? 'minimum' : 'exact'), 30),
      products: clean(shot.products_count_mode || 'exact', 30),
    },
    strict_principal_counts: true,
    background_crowd_allowed: shot.background_crowd_allowed === true || context.background_crowd_allowed === true,
  };
}

function inferSubject(input = {}, counts = subjectCountContract(input.shot, input.context)) {
  const { shot = {}, sceneAsset = {}, scenePlanningContract = {}, context = {} } = input;
  const spec = sceneAsset.scene_spec || {};
  const explicit = firstStructured([
    shot.subject_archetype, shot.primary_subject_class, sceneAsset.subject_archetype,
    spec.subjectArchetype, spec.subject_archetype, scenePlanningContract.subject_archetype,
    context.subject_archetype,
  ], SUBJECTS);
  if (explicit) return explicit;
  const active = [counts.people > 0 && 'human', counts.animals > 0 && 'animal', counts.vehicles > 0 && 'vehicle', counts.products > 0 && 'product'].filter(Boolean);
  if (active.length > 1) return 'mixed';
  if (active.length === 1) return active[0];
  const text = sourceText(input);
  if (/动物|宠物|猫|狗|马|鸟|兽群|animal|pet|cat|dog|horse|bird|wildlife/u.test(text)) return 'animal';
  if (/汽车|车辆|摩托|卡车|列车|飞机|船舶|vehicle|car|motorcycle|truck|train|aircraft|ship/u.test(text)) return 'vehicle';
  if (/人物|演员|顾客|角色|human|person|actor|customer|character/u.test(text)) return 'human';
  if (/产品|商品|设备|材料|product|goods|device|material/u.test(text)) return 'product';
  if (/抽象|粒子|能量|abstract|particle|energy/u.test(text)) return 'abstract';
  return 'environment';
}

function inferMotion(input = {}, environment = inferEnvironment(input), subject = inferSubject(input)) {
  const { shot = {}, sceneAsset = {}, scenePlanningContract = {}, context = {} } = input;
  const spec = sceneAsset.scene_spec || {};
  const explicit = firstStructured([
    shot.motion_model, shot.motion_topology, sceneAsset.motion_model,
    spec.motionModel, spec.motion_model, scenePlanningContract.motion_model,
    context.motion_model,
  ], MOTIONS);
  if (explicit) return explicit;
  const text = sourceText(input);
  if (/追逐|追赶|逃跑|尾随|chase|pursuit|escape|follow target/u.test(text)) return 'pursuit';
  if (/群体|兽群|鸟群|鱼群|迁徙|蜂群|flock|herd|school of fish|swarm|migration/u.test(text)) return 'flock';
  if (/变形|生长|溶解|聚合|形态变化|transform|morph|dissolve|grow|assemble/u.test(text) || environment === 'abstract') return 'transformation';
  if (/生产|加工|装配|施工|烹饪|实验|制造|process|manufactur|assemble|construct|cook|experiment/u.test(text) || environment === 'industrial') return 'process';
  if (/对话|交谈|问答|采访|dialogue|conversation|interview/u.test(text)) return 'dialogue';
  if (/表演|舞蹈|演奏|比赛|演讲|performance|dance|concert|competition|speech/u.test(text) || environment === 'stage') return 'performance';
  if (/互动|触摸|操作|拿起|使用|观察|interact|touch|operate|pick up|use|inspect/u.test(text)) return 'interaction';
  if (/路线|进入|离开|穿过|移动|行驶|飞行|航行|route|enter|leave|walk|run|drive|fly|sail/u.test(text)) return subject === 'vehicle' ? 'rigid_body' : 'route';
  return 'stationary';
}

function spatialTopology(environment = 'general_physical') {
  return ({
    interior: 'bounded_space', exterior: 'open_terrain', roadway: 'network_path', rail: 'guided_path',
    airborne: 'air_volume', aquatic: 'water_volume', industrial: 'workcell', tabletop: 'support_surface',
    stage: 'performance_zone', abstract: 'abstract_field', virtual: 'virtual_field', general_physical: 'general_space',
  })[environment] || 'general_space';
}

function cameraStrategy(environment = '', motion = '', subject = '') {
  if (motion === 'pursuit') return 'preserve pursuit order, screen direction, subject separation and route readability with tracking/chase coverage';
  if (motion === 'flock') return 'use readable group-scale coverage, preserve group count, heading, spacing and dominant individual identity';
  if (subject === 'vehicle' || motion === 'rigid_body') return 'preserve vehicle heading, lane/path occupancy, rigid geometry, wheel/contact state and camera safety distance';
  if (environment === 'airborne') return 'preserve altitude layers, horizon, flight direction and safe relative distance';
  if (environment === 'aquatic') return 'preserve waterline/depth, current direction, buoyancy and subject separation';
  if (motion === 'transformation') return 'show one authored transformation phase with stable form continuity, scale and visual center';
  if (motion === 'process') return 'show one causal process state with readable input, operation, contact and result';
  if (motion === 'dialogue') return 'preserve eyelines, axis, speaking/listening roles and shot-reverse-shot continuity';
  if (motion === 'performance') return 'preserve stage geography, performer spacing, audience direction and choreography phase';
  if (motion === 'interaction') return 'preserve the declared subject, interaction target, contact point and spatial relationship';
  return 'preserve the declared subject identity, spatial topology, scale, orientation and current story state';
}

function decisiveMoment(shot = {}, scenePlanningContract = {}, counts = subjectCountContract(shot)) {
  const explicit = clean(shot.decisive_moment || shot.single_frame_moment || shot.action_end, 900);
  if (explicit) return explicit;
  const action = clean(shot.action || shot.visual || '', 1600);
  const segments = action.split(/[，,；;。]/u).map(value => clean(value, 500)).filter(Boolean);
  const interaction = [...segments].reverse().find(value => /触摸|触碰|操作|拿起|放下|观察|对视|交谈|接触|停留|驻足|touch|interact|operate|hold|inspect|speak|look at|contact/u.test(value));
  const movement = [...segments].reverse().find(value => /追逐|奔跑|行驶|飞行|航行|迁徙|移动|chase|run|drive|fly|sail|migrate|move/u.test(value));
  const selected = interaction || movement || segments[0] || clean(shot.title, 400) || '当前剧情状态';
  const names = counts.people_ids.length ? counts.people_ids.join('、') : (counts.animal_ids.length ? counts.animal_ids.join('、') : '当前主体');
  const anchor = list(scenePlanningContract.interaction_anchors || scenePlanningContract.anchors)[0] || {};
  const anchorLabel = clean(anchor.label || anchor.name, 160);
  return clean(`${names}${counts.people === 1 ? '单独' : ''}${anchorLabel ? `位于“${anchorLabel}”` : ''}，${selected}`, 900);
}

function countPrompt(counts = {}) {
  const modeText = (key, exact, minimum) => counts.count_modes?.[key] === 'minimum' ? minimum : exact;
  const rows = [
    modeText('people', `可见主要人物必须恰好 ${counts.people} 名`, `可见主要人物不得少于 ${counts.people} 名`),
    modeText('animals', `可见主要动物必须恰好 ${counts.animals} 只`, `可见动物群体不得少于 ${Math.max(1, counts.animals)} 只，保持群体关系`),
    counts.vehicles > 0 ? modeText('vehicles', `可见主要车辆必须恰好 ${counts.vehicles} 辆`, `可见车辆群体不得少于 ${Math.max(1, counts.vehicles)} 辆，保持编队关系`) : '',
    counts.products > 0 ? `可见主要产品/关键道具必须恰好 ${counts.products} 个` : '',
  ].filter(Boolean);
  return `${rows.join('；')}。同一身份不得因动作路径、镜面、时间阶段或构图需要被复制成多个实例；不得新增、删除、合并或替换主体。${counts.background_crowd_allowed ? '已明确允许非主体背景人群，但不得与主要角色混淆。' : '不得自行添加背景人物或人群。'}`;
}

function compile(input = {}) {
  const counts = subjectCountContract(input.shot || {}, input.context || {});
  const environment = inferEnvironment(input);
  const subject = inferSubject(input, counts);
  const motion = inferMotion(input, environment, subject);
  const contract = {
    version: CONTRACT_VERSION,
    environment_archetype: environment,
    primary_subject_class: subject,
    motion_model: motion,
    spatial_topology: spatialTopology(environment),
    subject_counts: counts,
    decisive_moment: decisiveMoment(input.shot || {}, input.scenePlanningContract || {}, counts),
    camera_strategy: cameraStrategy(environment, motion, subject),
    continuity_rules: ['subject_identity', 'subject_count', 'screen_direction', 'spatial_topology', 'causal_state'],
  };
  contract.fingerprint = crypto.createHash('sha256').update(JSON.stringify(contract)).digest('hex');
  return contract;
}

function promptBlock(contract = {}) {
  return [
    `全行业场景合同（强制）：${clean(JSON.stringify(contract), 4200)}`,
    `主体数量与唯一性（强制）：${countPrompt(contract.subject_counts || {})}`,
    `本张图只呈现这个决定性瞬间：${clean(contract.decisive_moment, 900)}。动作中的起点、过程和终点只用于理解前后因果，禁止把不同时间位置同时画进一张图。`,
    `机位与连续性策略：${clean(contract.camera_strategy, 900)}。`,
  ].join('\n');
}

function userPrompt(shot = {}, contract = compile({ shot })) {
  return [
    clean(shot.visual || shot.visual_description || shot.title, 1200),
    `决定性瞬间：${clean(contract.decisive_moment, 900)}`,
    `镜头：${clean([shot.shot_size, shot.camera_angle, shot.lens_mm ? `${shot.lens_mm}mm` : '', shot.composition, shot.subject_position, shot.camera_movement].filter(Boolean).join('；'), 700)}`,
    `连续性：${clean(contract.camera_strategy, 700)}`,
  ].filter(line => !line.endsWith('：')).join('\n');
}

module.exports = {
  CONTRACT_VERSION,
  compile,
  promptBlock,
  countPrompt,
  decisiveMoment,
  subjectCountContract,
  inferEnvironment,
  inferSubject,
  inferMotion,
  spatialTopology,
  cameraStrategy,
  userPrompt,
};
