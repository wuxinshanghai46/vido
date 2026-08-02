'use strict';

function clean(value = '', max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function mediaUrl(value = {}) {
  if (typeof value === 'string') return clean(value, 1200);
  return clean(
    value.thumbnail_url
      || value.thumb_url
      || value.image_url
      || value.imageUrl
      || value.video_url
      || value.videoUrl
      || value.url
      || value.file_path
      || '',
    1200,
  );
}

function shootingPreset(camera = {}) {
  const role = clean(camera.view_id || camera.role || camera.id, 100).toLowerCase();
  if (role.includes('master')) return {
    movement: '从空间入口或画外广角缓慢推进，保持背景墙、展台与出入口同时可见，停在完整空间建立位。', movement_type: '轨道缓推 / dolly in', speed: '慢速匀速', duration: 4,
    subject_action: '人物暂不抢画面；如需入场，在镜头后半段从画面边缘自然进入。', focus: '先锁定完整空间层次，再把注意力引向展示主体。', continuity: '建立空间轴线和人物入场方向，后续镜头不得无理由越轴。', stabilization: '三脚架或直轨稳定器',
  };
  if (role.includes('reverse')) return {
    movement: '从主机位沿横向滑移到反向角度，保持轴线方向一致，交代入口与墙面的连接关系。', movement_type: '横移 / slider', speed: '中慢速匀速', duration: 3,
    subject_action: '人物沿既定方向继续移动，不折返、不突然改变视线。', focus: '保持主体与入口关系清楚，移动中不丢失主体。', continuity: '承接上一镜运动方向，切换点落在人物动作中段。', stabilization: '滑轨或稳定器',
  };
  if (role.includes('interaction')) return {
    movement: '平视中景跟随人物走向展示主体，在触摸、指引或操作位置停住，为动作前后保留画面空间。', movement_type: '稳定器跟拍 / tracking', speed: '与人物步速同步', duration: 4,
    subject_action: '人物走近主体并完成一次明确互动：触摸、指示、拿取或操作。', focus: '焦点由人物眼神转移到手部与展示主体，动作完成时稳定停留。', continuity: '保持人物行进方向、手部动作和视线连续。', stabilization: '三轴稳定器',
  };
  if (role.includes('detail')) return {
    movement: '从人物手部或展示主体中景缓慢推近到材质微距，让掠射光扫过纹理后停住。', movement_type: '微距滑轨缓推 / macro push', speed: '极慢速', duration: 3,
    subject_action: '手部只做轻触、旋转或组合动作，不遮挡关键纹理与结构。', focus: '由手部接触点拉焦至材料纹理、接缝或工艺证据。', continuity: '细节方向与上一镜主体朝向一致，避免纹理左右翻转。', stabilization: '微距滑轨 + 手动跟焦',
  };
  return { movement: '从上一机位顺轴衔接，明确起点、终点、速度与本镜需要证明的画面证据。', movement_type: '稳定器移动', speed: '中慢速', duration: 3, subject_action: '按本镜剧情完成一个可见动作。', focus: '焦点始终服务本镜卖点证据。', continuity: '保持轴线、动作方向与光线方向连续。', stabilization: '稳定器' };
}

function projectShootingRules(camera = {}, cameraIndex = 0, previous = {}) {
  const preset = shootingPreset(camera);
  const label = clean(camera.label || camera.name || camera.id || `机位 ${cameraIndex + 1}`, 120);
  const previousLabel = clean(previous.label || previous.name || previous.id || '片场入口 / 画外起点', 120);
  return {
    movement: clean(camera.movement || camera.camera_movement || camera.move || preset.movement, 300),
    movement_type: clean(camera.movement_type || camera.move_type || camera.rig || camera.support || preset.movement_type, 100),
    route: clean(camera.route || camera.camera_path || camera.path || `${previousLabel} → ${label}`, 260),
    speed: clean(camera.speed || camera.movement_speed || camera.pace || preset.speed, 80),
    duration: Math.max(1, Number(camera.duration || camera.duration_sec || preset.duration) || preset.duration),
    subject_action: clean(camera.subject_action || camera.action || camera.performance || preset.subject_action, 300),
    focus: clean(camera.focus || camera.focus_target || camera.focus_plan || preset.focus, 260),
    start_state: clean(camera.start_state || camera.start || `${previousLabel}完成后保持轴线和光向不变。`, 260),
    end_state: clean(camera.end_state || camera.end || `在${label}完成构图并稳定停留，给剪辑保留 0.5 秒。`, 260),
    continuity: clean(camera.continuity || camera.transition || camera.axis_rule || preset.continuity, 300),
    stabilization: clean(camera.stabilization || camera.stabilizer || camera.rig_note || preset.stabilization, 180),
  };
}

/** Bind one scene camera to its generated view and preserve movement planning. */
function projectSceneCamera(camera = {}, views = [], cameraIndex = 0) {
  const viewId = clean(camera.view_id || camera.view || camera.key, 100);
  const matchedView = viewId && viewId !== 'layout'
    ? list(views).find(view => clean(view.key || view.view_id || view.id, 100) === viewId)
    : null;
  return {
    id: clean(camera.id || camera.camera_id || camera.key || `camera_${cameraIndex + 1}`, 100),
    view_id: viewId,
    label: clean(camera.label || camera.name || camera.id || `机位 ${cameraIndex + 1}`, 120),
    image_url: mediaUrl(camera.reference_image_url || camera.referenceImageUrl || '') || mediaUrl(matchedView || {}),
    role: clean(camera.role || camera.target_description, 180),
    framing: clean(camera.framing || camera.shot_size, 100),
    lens: clean(camera.lens_class || camera.lens || camera.focal_length, 100),
    height: clean(camera.height_class || camera.height, 80),
    orientation: clean(camera.orientation || camera.direction, 180),
    position: Array.isArray(camera.normalized_position) ? camera.normalized_position.slice(0, 3).map(Number) : [],
    look_at: Array.isArray(camera.look_at) ? camera.look_at.slice(0, 3).map(Number) : [],
    visible_evidence: clean(camera.visible_evidence, 260),
    zone: clean(camera.zone || camera.zone_id, 120),
    movement: clean(camera.movement || camera.camera_movement || camera.move || camera.route, 260),
    movement_type: clean(camera.movement_type || camera.move_type || camera.rig || camera.support, 100),
    route: clean(camera.route || camera.camera_path || camera.path, 260),
    speed: clean(camera.speed || camera.movement_speed || camera.pace, 80),
    start_state: clean(camera.start_state || camera.start, 220),
    end_state: clean(camera.end_state || camera.end, 220),
    duration: Math.max(0, Number(camera.duration || camera.duration_sec || 0) || 0),
    subject_action: clean(camera.subject_action || camera.action || camera.performance, 260),
    focus: clean(camera.focus || camera.focus_target || camera.focus_plan, 220),
    continuity: clean(camera.continuity || camera.transition || camera.axis_rule, 260),
    stabilization: clean(camera.stabilization || camera.stabilizer || camera.rig_note, 180),
    notes: clean(camera.notes || camera.purpose, 260),
    ...projectShootingRules(camera, cameraIndex),
  };
}

module.exports = { projectSceneCamera, projectShootingRules };
