'use strict';

const personIdentity = require('./personIdentityContractService');

const CONTRACT_VERSION = 2;
const list = value => Array.isArray(value) ? value.filter(Boolean) : [];
const clean = (value = '', max = 1600) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

function idOf(value = {}) { return clean(value.scene_id || value.scene_asset_id || value.id, 120); }

function actorPlan(asset = {}, ctx = {}) {
  const spec = asset.scene_spec || {};
  const experience = spec.sceneExperienceContract || spec.scene_experience_contract || {};
  const interaction = clean(spec.interactionText || spec.interaction_text, 1400);
  const planned = asset.scene_plan_actor_blocking_required === true || experience.actor_blocking_required === true;
  if (!planned) return null;
  return {
    interaction,
    layout: clean(spec.layoutText || spec.layout_text || spec.layout, 1600),
    anchors: list(spec.interactionAnchors || spec.interaction_anchors),
    routes: list(spec.routes || spec.movement_routes),
    cameras: list(asset.scene_contract?.cameras || spec.cameraPlan || spec.camera_plan),
  };
}

function hasPerson(shot = {}) {
  return personIdentity.shotPersonPresence(shot, {}).required;
}

function castForShot(ctx = {}, action = '', shots = []) {
  const plannedRows = list(ctx.characters).length ? list(ctx.characters) : list(ctx.cast_profiles);
  const existingRows = list(shots).flatMap(shot => list(shot.characters)).filter(item => clean(item?.name || item, 120));
  const rows = plannedRows.length ? plannedRows : existingRows;
  if (rows.length) return rows.slice(0, Math.max(1, Number(ctx.expected_people || 1) || 1)).map(item => ({
    ...(item && typeof item === 'object' ? item : { name: clean(item, 120) }),
    name: clean(item?.name || item?.displayName || item?.roleName || item, 120),
    action: clean(action, 600),
  }));
  const person = ctx.person_asset || {};
  const name = clean(person.name || person.displayName || person.profile?.name || '', 120);
  return name ? [{ name, action: clean(action, 600) }] : [];
}

function plannedRole(entry = {}, role = '') {
  return clean(entry.shot?.scene_context_role, 120) === role;
}

function contractCurrent(shot = {}, role = '') {
  return clean(shot.scene_context_role, 120) === role
    && Number(shot.scene_performance_contract?.version || 0) >= CONTRACT_VERSION;
}

function cameraFor(plan = {}, viewId = '', fallback = {}) {
  return plan.cameras.find(camera => clean(camera.view_id || camera.view, 80) === viewId)
    || plan.cameras.find(camera => new RegExp(viewId === 'master' ? 'master|建立|全景|空间' : 'interaction|人物|互动|跟随', 'iu')
      .test(clean([camera.id, camera.view_id, camera.label, camera.role, camera.movement_type].join(' '), 600)))
    || fallback || {};
}

function cameraMovement(camera = {}, fallback = '') {
  return clean(camera.movement_type || camera.movement || camera.camera_movement || fallback, 180);
}

function cameraAngle(camera = {}, fallback = 'eye_level') {
  return clean(camera.angle || camera.camera_angle || fallback, 160);
}

function stripInternalPlanningNotes(value = '') {
  return clean(value, 1600).split(/[。；;]/u)
    .filter(clause => !/^\s*(?:AI|系统|自动)补齐[:：]/iu.test(clause))
    .join('；');
}

function sceneOnlyLayout(value = '') {
  return clean(value, 1800).split(/[。；;]/u)
    .filter(clause => !/(?:人物|角色|演员|模特|顾客|客户|真人|person|actor|model|customer)/iu.test(clause))
    .join('；');
}

function ensureCoverage(shots = [], sceneAssets = [], ctx = {}) {
  const result = list(shots).map(shot => ({ ...shot }));
  const assets = new Map(list(sceneAssets).map(asset => [idOf(asset), asset]));
  const grouped = new Map();
  result.forEach((shot, index) => {
    const id = idOf(shot);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push({ shot, index });
  });
  grouped.forEach((entries, sceneId) => {
    const plan = actorPlan(assets.get(sceneId) || {}, ctx);
    if (!plan) return;
    const plannedInteraction = entries.find(entry => plannedRole(entry, 'planned_actor_interaction'));
    const plannedEstablishing = entries.find(entry => plannedRole(entry, 'planned_scene_establishing'));
    const existingPerson = entries.find(entry => hasPerson(entry.shot));
    // Scenes that already arrived with a valid human shot remain untouched.
    // Only create missing coverage, or upgrade a previous deterministic coverage contract.
    if (existingPerson && !plannedInteraction) return;
    const selected = plannedInteraction || entries[0];
    if (!selected) return;
    const anchor = plan.anchors[0] || {};
    const route = plan.routes[0] || {};
    const interactionCamera = cameraFor(plan, 'interaction', plan.cameras[0]);
    const masterCamera = cameraFor(plan, 'master', plan.cameras[0]);
    const action = stripInternalPlanningNotes(plan.interaction || clean(route.label || route.continuity || anchor.purpose, 1000));
    const personCharacters = castForShot(ctx, action, result);
    const anchorLabel = clean(anchor.label || anchor.name, 200);
    const routeLabel = clean(route.label || route.continuity, 300);
    const sceneName = clean((assets.get(sceneId) || {}).name || selected.shot.scene_name || sceneId, 200);
    const interactionGoal = clean(selected.shot.purpose || selected.shot.title, 500);
    const interactionMovement = cameraMovement(interactionCamera, 'slow_follow');
    const visualAuthority = [
      `人物依照已确认场景规划进入并完成互动，画面保留可识别的完整空间关系`,
      plan.layout ? `空间布局：${plan.layout}` : '',
      anchorLabel ? `人物站位对应互动点“${anchorLabel}”` : '',
      routeLabel ? `行动路线：${routeLabel}` : '',
    ].filter(Boolean).join('；');
    if (!contractCurrent(selected.shot, 'planned_actor_interaction')) {
      selected.shot = result[selected.index] = {
        ...selected.shot,
        title: anchorLabel ? `人物按规划路线体验${anchorLabel}` : `${sceneName}人物互动`,
        purpose: `通过人物在完整${sceneName}中的规划动线与互动动作证明实际空间应用${interactionGoal ? `；内容目标：${interactionGoal}` : ''}`,
        subject_type: 'human_scene',
        expected_people: Math.max(1, Number(ctx.expected_people || personCharacters.length || 1) || 1),
        characters: personCharacters,
        no_person: false,
        noHuman: false,
        scene_view: clean(interactionCamera.view_id || 'interaction', 80),
        camera_id: clean(interactionCamera.id || interactionCamera.camera_id, 120) || selected.shot.camera_id,
        anchor_ids: clean(anchor.id || anchor.anchor_id, 120) ? [clean(anchor.id || anchor.anchor_id, 120)] : list(selected.shot.anchor_ids),
        scene_context_role: 'planned_actor_interaction',
        shot_size: 'medium_wide',
        lens_mm: Number(interactionCamera.lens_mm || interactionCamera.lens || 35) || 35,
        camera_angle: cameraAngle(interactionCamera),
        camera_movement: interactionMovement,
        composition: `完整保留${sceneName}入口、人物路线、互动点与整面主要展示面；人物和展示面同时可识别，不得裁成手部或单块材质特写。`,
        subject_position: anchor.normalized_position ? `人物位于场景归一化坐标 ${JSON.stringify(anchor.normalized_position)}` : `人物位于${anchorLabel || '规划互动点'}`,
        visual: `${visualAuthority}；镜头为单一连续中广景，人物、路线、互动点和整面主要展示面必须同时可读${interactionGoal ? `；内容目标：${interactionGoal}` : ''}。`,
        action: clean(action, 1400) || '人物按规划路线移动到互动位置并完成当前剧情动作。',
        keyframe_notes: `${visualAuthority}；必须显示人物、规划站位、整面主要展示面和对应场景机位；禁止微距、局部材质满画幅或裁掉空间边界。`,
        scene_performance_contract: { version: CONTRACT_VERSION, scene_id: sceneId, source: 'structured_scene_plan', role: 'actor_interaction' },
      };
    }
    const establishing = plannedEstablishing || entries.find(entry => entry.index !== selected.index) || null;
    if (establishing) {
      const establishingAuthority = [
        `空间建立镜必须清楚呈现当前场景的完整边界、整面主要展示面以及入口至互动点的空间动线关系`,
        sceneOnlyLayout(plan.layout) ? `空间布局：${sceneOnlyLayout(plan.layout)}` : '',
        anchorLabel ? `保留互动点“${anchorLabel}”所在位置` : '',
      ].filter(Boolean).join('；');
      if (!contractCurrent(establishing.shot, 'planned_scene_establishing')) {
        const establishingGoal = clean(establishing.shot.purpose || establishing.shot.title, 500);
        const establishingMovement = cameraMovement(masterCamera, establishing.shot.camera_movement || 'slow_push');
        establishing.shot = result[establishing.index] = {
          ...establishing.shot,
          title: `${sceneName}完整空间与整面主要展示面`,
          purpose: `以完整空间、整面主要展示面和人物行动关系建立${sceneName}${establishingGoal ? `；内容目标：${establishingGoal}` : ''}`,
          subject_type: 'scene_only',
          expected_people: 0,
          characters: [],
          no_person: true,
          noHuman: true,
          scene_view: 'master',
          camera_id: clean(masterCamera.id || masterCamera.camera_id, 120) || establishing.shot.camera_id,
          anchor_ids: clean(anchor.id || anchor.anchor_id, 120) ? [clean(anchor.id || anchor.anchor_id, 120)] : list(establishing.shot.anchor_ids),
          scene_context_role: 'planned_scene_establishing',
          shot_size: 'wide',
          lens_mm: Number(masterCamera.lens_mm || masterCamera.lens || 35) || 35,
          camera_angle: cameraAngle(masterCamera),
          camera_movement: establishingMovement,
          composition: `完整呈现${sceneName}的空间边界、入口、中央区域、整面主要展示面及互动点；主展示面保持完整，不得只保留局部色板或单块材质。`,
          subject_position: '整面主要展示面位于画面中后景并完整可见，入口、中央区域与互动点共同建立空间尺度。',
          visual: `${establishingAuthority}；镜头为单一连续广角空间建立画面${establishingGoal ? `；内容目标：${establishingGoal}` : ''}。`,
          action: `摄影机从主建立机位以${establishingMovement}缓慢展示完整空间、整面主要展示面和互动点，画面不得裁成局部材质。`,
          keyframe_notes: `${establishingAuthority}；必须显示完整空间边界和整面主要展示面；禁止人物和微距，不得裁成仅剩局部墙面或单块材质，不得裁掉入口与中央区域。`,
          scene_performance_contract: { version: CONTRACT_VERSION, scene_id: sceneId, source: 'structured_scene_plan', role: 'spatial_establishing' },
        };
      }
    }
  });
  return result;
}

function inspect(shots = [], sceneAssets = [], ctx = {}) {
  const missing = list(sceneAssets).filter(asset => {
    const plan = actorPlan(asset, ctx);
    if (!plan) return false;
    const sceneShots = list(shots).filter(shot => idOf(shot) === idOf(asset));
    const plannedShots = sceneShots.filter(shot => /^planned_(?:actor_interaction|scene_establishing)$/u.test(clean(shot.scene_context_role, 120)));
    return !sceneShots.some(hasPerson) || plannedShots.some(shot => Number(shot.scene_performance_contract?.version || 0) < CONTRACT_VERSION);
  });
  return {
    contract_version: CONTRACT_VERSION,
    ready: missing.length === 0,
    missing_scene_ids: missing.map(idOf),
    issues: missing.map(asset => `${clean(asset.name || idOf(asset), 160)}缺少场景规划要求的人物站位与互动镜头`),
  };
}

module.exports = { CONTRACT_VERSION, actorPlan, hasPerson, ensureCoverage, inspect };
