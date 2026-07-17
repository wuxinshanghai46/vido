const revisionService = require('./revisionService');
const sceneBlockService = require('./sceneBlockService');

const VIDEO_PREFLIGHT_POLICY_VERSION = 'cost-aware-video-preflight-v1';

function text(value = '') {
  return String(value || '').trim();
}

function keyframePersonPresence(keyframe = {}) {
  const value = text(keyframe.qa?.person?.person_presence || keyframe.person_presence || '').toLowerCase();
  if (['person', 'full', 'principal'].includes(value)) return 'person';
  if (['partial', 'hand', 'arm', 'body_part'].includes(value)) return 'partial';
  if (['none', 'no_human', 'empty'].includes(value)) return 'none';
  return '';
}

function approvedKeyframe(keyframe = {}, contract = {}) {
  return !!(keyframe.image_url || keyframe.imageUrl || keyframe.url)
    && keyframe.qa?.pass === true
    && (!contract.contract_fingerprint || keyframe.contract_fingerprint === contract.contract_fingerprint);
}

function reconcileShot(shot = {}, keyframe = {}, contract = {}) {
  const presence = approvedKeyframe(keyframe, contract) ? keyframePersonPresence(keyframe) : '';
  const authoredCharacters = Array.isArray(shot.characters) ? shot.characters.filter(Boolean) : [];
  const characters = authoredCharacters.length || !['person', 'partial'].includes(presence)
    ? authoredCharacters
    : [{
      name: presence === 'partial' ? '已确认关键帧中的局部人物' : '已确认关键帧中的人物',
      source: 'approved_keyframe',
      presence,
    }];
  const expectedPeople = ['person', 'partial'].includes(presence)
    ? Math.max(1, characters.length)
    : characters.length;
  return {
    ...shot,
    characters,
    expected_people: expectedPeople,
    video_person_presence: presence || (characters.length ? 'person' : 'none'),
    approved_partial_person: presence === 'partial',
  };
}

function reconcileShots(shots = [], keyframes = [], contracts = []) {
  return (Array.isArray(shots) ? shots : []).map((shot, index) => reconcileShot(
    shot || {},
    keyframes[index] || {},
    contracts[index] || {},
  ));
}

function clipHasMedia(clip = {}) {
  return !!(clip && (clip.file_path || clip.video_url || clip.videoUrl));
}

function clipApproved(clip = {}) {
  return clipHasMedia(clip)
    && clip.qa?.pass === true
    && clip.cross_shot_qa?.pass !== false
    && !clip.error
    && !clip.error_code;
}

function failureDimensions(clip = {}) {
  return [...new Set([
    ...(Array.isArray(clip.qa?.failure_dimensions) ? clip.qa.failure_dimensions : []),
    ...(Array.isArray(clip.cross_shot_qa?.failure_dimensions) ? clip.cross_shot_qa.failure_dimensions : []),
  ].map(text).filter(Boolean))];
}

function cameraOnlyShot(shot = {}, keyframe = {}, contract = {}) {
  const reconciled = reconcileShot(shot, keyframe, contract);
  const authoredCharacters = Array.isArray(shot.characters) ? shot.characters.filter(Boolean) : [];
  const designText = [shot.action, shot.visual_action, shot.camera, shot.camera_movement].map(text).join(' ');
  const effectText = [shot.motion_effect?.type, shot.motion_effect?.target_state, shot.effect, shot.vfx].map(text).join(' ');
  const humanAction = /人物|角色|演员|模特|女人|男人|女士|先生|走|点头|微笑|转身|抬手|伸手|说话|口型|person|actor|character|woman|man|walk|nod|smile|turn|gesture|speak|lip/i.test(designText);
  const authoredEffect = /logo|粒子|汇聚|变形|爆炸|particle|assemble|morph|transform|explosion/i.test(effectText + ' ' + designText);
  const cameraOrSurfaceMotion = /镜头|焦点|光影|纹理|表面|材质|横移|推进|拉远|摇移|truck|pan|push|zoom|focus|light|texture|surface|material|static/i.test(designText);
  return authoredCharacters.length === 0
    && reconciled.video_person_presence !== 'person'
    && !humanAction
    && !authoredEffect
    && cameraOrSurfaceMotion;
}

function peopleOnlyFailureCanBeRechecked(shot = {}, keyframe = {}, contract = {}, clip = {}) {
  if (!clipHasMedia(clip) || clip.qa?.pass !== false || !approvedKeyframe(keyframe, contract)) return false;
  const presence = keyframePersonPresence(keyframe);
  if (!['person', 'partial'].includes(presence)) return false;
  const dimensions = failureDimensions(clip);
  if (!dimensions.length) return false;
  return dimensions.every(value => ['people_count', 'person_identity', 'scene_consistency'].includes(value));
}

function repairInstruction(shot = {}, keyframe = {}, contract = {}, clip = {}) {
  const dimensions = failureDimensions(clip);
  const parts = [];
  const presence = keyframePersonPresence(keyframe);
  if (dimensions.includes('person_identity')) {
    parts.push('Use the current approved keyframe private asset as the only visual reference. Start from that exact face, body, wardrobe, pose, crop and scene; do not recast or rebuild the person.');
  }
  if (dimensions.includes('action_fulfillment')) {
    parts.push('Reduce motion to one small physically plausible action that begins from the exact approved keyframe pose. Do not invent an entry position or a different body direction.');
  }
  if (dimensions.includes('people_count') && presence === 'none') {
    parts.push('This is a no-principal-person shot. Preserve the supplied frame and never introduce a face, body, hand or reflection of a person.');
  }
  if (dimensions.includes('scene_consistency')) {
    parts.push('Keep the approved keyframe geometry and material topology pixel-consistent at the opening; animate only the authored camera or surface motion.');
  }
  return parts.join(' ');
}

function providerBillingBlocked(statuses = [], clips = [], indexes = null) {
  const scoped = indexes instanceof Set ? indexes : null;
  return (Array.isArray(statuses) ? statuses : []).some((status, index) => {
    if (scoped && !scoped.has(index)) return false;
    const code = text(status?.error_code || clips[index]?.error_code).toUpperCase();
    return /BILLING|BALANCE|CREDIT|QUOTA/.test(code) && !clipHasMedia(clips[index] || {});
  });
}

function shotTitle(shot = {}, index = 0) {
  return text(shot.title) || `第 ${index + 1} 镜`;
}

function economyShotPlan({ shot, keyframe, contract, clip, status, index }) {
  const title = shotTitle(shot, index);
  const changes = [];
  if (clipApproved(clip)) return { index, shot_index: index + 1, title, action: 'reuse', label: '保留已通过视频', paid: false, changes };
  if (peopleOnlyFailureCanBeRechecked(shot, keyframe, contract, clip)) {
    changes.push('以已确认关键帧中的人物/手部为准，修正人数与场景审核冲突');
    return { index, shot_index: index + 1, title, action: 'review_only', label: '只复审现有视频', paid: false, changes };
  }
  if (cameraOnlyShot(shot, keyframe, contract)) {
    changes.push('改用已确认关键帧的本地缓慢运镜，不再调用视频模型，也不会凭空增加人物');
    return { index, shot_index: index + 1, title, action: 'local_motion', label: '本地确定性运镜（不调用视频模型）', paid: false, changes };
  }
  const instruction = repairInstruction(shot, keyframe, contract, clip);
  const dimensions = failureDimensions(clip);
  if (dimensions.includes('person_identity')) changes.push('输入由多参考图改为“当前关键帧私有素材单一锁定”，避免人物和场景互相冲突');
  if (dimensions.includes('action_fulfillment')) changes.push('把动作缩减为从当前姿态开始的一项小动作，不再要求重新入场或改变站位');
  if (!clipHasMedia(clip)) changes.push('当前没有可用视频，只生成一次且自动重试为 0');
  return {
    index, shot_index: index + 1, title, action: 'provider_generate', label: '按修正方案生成一次', paid: true,
    input_strategy: 'approved_keyframe_private_asset_only',
    repair_instruction: instruction,
    changes,
    blocked_by_billing: /BILLING|BALANCE|CREDIT|QUOTA/.test(text(status?.error_code || clip?.error_code).toUpperCase()),
  };
}

function qualityUnits({ reconciledShots, keyframes, contracts, sceneBlocks }) {
  return sceneBlocks.map((block, unitIndex) => {
    const cameraOnly = block.member_indexes.every(index => cameraOnlyShot(reconciledShots[index] || {}, keyframes[index] || {}, contracts[index] || {}));
    const action = cameraOnly && block.member_indexes.length === 1 ? 'local_motion' : 'provider_generate';
    return {
      id: block.id,
      unit_index: unitIndex,
      member_indexes: block.member_indexes,
      shots: block.member_indexes.map(index => index + 1),
      title: block.member_indexes.length > 1
        ? `连续镜组 ${block.member_indexes.map(index => index + 1).join('→')}`
        : shotTitle(reconciledShots[block.first_index] || {}, block.first_index),
      action,
      label: action === 'local_motion' ? '本地确定性运镜（不调用视频模型）' : (block.continuous ? '整组一次生成' : '单镜一次生成'),
      paid: action === 'provider_generate',
      continuous: block.continuous,
      duration_sec: block.duration_sec,
      input_strategy: action === 'provider_generate' ? 'approved_keyframe_private_asset_only' : 'approved_keyframe_local_motion',
      changes: [
        ...(block.continuous ? [`第 ${block.member_indexes.map(index => index + 1).join('、')} 镜合并为一段连续运镜，不再分别抽卡后拼接`] : []),
        ...(action === 'local_motion' ? ['只做可控的平移/推进/聚焦，保持关键帧人物、材质与构图不变'] : ['以镜组第一张已确认关键帧作为唯一视觉起点，按时间轴完成全部动作']),
      ],
    };
  });
}

function buildVideoPreflight({
  taskId = '', shots = [], keyframes = [], contracts = [], clips = [], statuses = [], ctx = {}, mode = 'economy', providerRoute = '', onlyIndexes = null,
} = {}) {
  const normalizedMode = text(mode).toLowerCase() === 'quality' ? 'quality' : 'economy';
  const reconciledShots = reconcileShots(shots, keyframes, contracts);
  let sceneBlocks = [];
  let shotPlans = [];
  let units = [];
  if (normalizedMode === 'quality') {
    sceneBlocks = sceneBlockService.buildSceneBlocks(reconciledShots, contracts, {
      preserve_existing_topology: false,
      continuous_quality_mode: true,
      scene_block_generation: true,
    });
    units = qualityUnits({ reconciledShots, keyframes, contracts, sceneBlocks });
    shotPlans = reconciledShots.map((shot, index) => {
      const unit = units.find(item => item.member_indexes.includes(index));
      return {
        index, shot_index: index + 1, title: shotTitle(shot, index), action: unit?.action || 'provider_generate',
        label: unit?.label || '按连续方案生成', paid: unit?.paid !== false, unit_id: unit?.id || '',
        changes: unit?.changes || [],
      };
    });
  } else {
    shotPlans = reconciledShots.map((shot, index) => economyShotPlan({
      shot: shots[index] || shot,
      keyframe: keyframes[index] || {},
      contract: contracts[index] || {},
      clip: clips[index] || {},
      status: statuses[index] || {},
      index,
    }));
    const requested = Array.isArray(onlyIndexes)
      ? new Set(onlyIndexes.map(Number).filter(index => Number.isInteger(index) && index >= 0 && index < reconciledShots.length))
      : null;
    if (requested?.size) shotPlans = shotPlans.filter(item => requested.has(item.index));
    units = shotPlans.filter(item => !['reuse', 'review_only'].includes(item.action)).map(item => ({
      id: `economy-shot-${item.shot_index}`,
      member_indexes: [item.index], shots: [item.shot_index], title: item.title,
      action: item.action, label: item.label, paid: item.paid, duration_sec: sceneBlockService.durationOf(shots[item.index] || {}),
      input_strategy: item.input_strategy || '', changes: item.changes || [],
    }));
    sceneBlocks = sceneBlockService.buildSceneBlocks(shots, contracts, { preserve_existing_topology: true });
  }
  const paidUnits = units.filter(unit => unit.paid);
  const paidIndexes = new Set(paidUnits.flatMap(unit => unit.member_indexes || []));
  const billingBlocked = providerBillingBlocked(statuses, clips, paidIndexes);
  const localUnits = units.filter(unit => !unit.paid && unit.action === 'local_motion');
  const reviewOnly = shotPlans.filter(item => item.action === 'review_only');
  const blockers = [];
  if (billingBlocked && paidUnits.length) {
    blockers.push({
      code: 'VIDEO_PROVIDER_BILLING_BLOCKED',
      message: '视频供应商刚刚返回余额/计费错误。为避免先生成一部分后再次中断，所有付费提交已暂停；可先应用不调用视频生成模型的复审和本地运镜。',
    });
  }
  const source = {
    policy_version: VIDEO_PREFLIGHT_POLICY_VERSION,
    task_id: taskId,
    mode: normalizedMode,
    only_indexes: shotPlans.map(item => item.index),
    provider_route: providerRoute,
    shot_contracts: reconciledShots.map((shot, index) => ({
      index, title: shot.title || '', visual: shot.visual || '', action: shot.action || '', characters: shot.characters || [],
      expected_people: shot.expected_people, person_presence: shot.video_person_presence,
      keyframe_generation_id: keyframes[index]?.current_generation_id || keyframes[index]?.generation_id || '',
      keyframe_contract: keyframes[index]?.contract_fingerprint || '',
      clip_lineage: clips[index]?.lineage_fingerprint || clips[index]?.lineage?.fingerprint || '',
      clip_qa: clips[index]?.qa?.pass,
    })),
    units: units.map(unit => ({ shots: unit.shots, action: unit.action, paid: unit.paid, duration_sec: unit.duration_sec, input_strategy: unit.input_strategy })),
    blockers: blockers.map(item => item.code),
  };
  const fingerprint = revisionService.signature(source);
  return {
    policy_version: VIDEO_PREFLIGHT_POLICY_VERSION,
    task_id: taskId,
    mode: normalizedMode,
    fingerprint,
    status: blockers.length ? (localUnits.length || reviewOnly.length ? 'partial_ready' : 'blocked') : 'ready',
    provider_route: providerRoute,
    paid_unit_count: paidUnits.length,
    paid_video_seconds: paidUnits.reduce((sum, unit) => sum + Number(unit.duration_sec || 0), 0),
    local_unit_count: localUnits.length,
    review_only_count: reviewOnly.length,
    reuse_count: shotPlans.filter(item => item.action === 'reuse').length,
    zero_cost_action_count: localUnits.length + reviewOnly.length,
    automatic_retry_count: 0,
    blockers,
    shots: shotPlans,
    units,
    scene_blocks: sceneBlocks,
    reconciled_shots: reconciledShots,
    repair_instructions: Object.fromEntries(shotPlans.filter(item => item.repair_instruction).map(item => [item.index, item.repair_instruction])),
    local_motion_indexes: [...new Set(units.filter(unit => unit.action === 'local_motion').flatMap(unit => unit.member_indexes))],
    keyframe_reference_only_indexes: [...new Set(units.filter(unit => unit.paid).flatMap(unit => unit.member_indexes))],
    generated_at: new Date().toISOString(),
  };
}

function publicVideoPreflight(plan = {}) {
  return {
    policy_version: plan.policy_version,
    task_id: plan.task_id,
    mode: plan.mode,
    fingerprint: plan.fingerprint,
    status: plan.status,
    provider_route: plan.provider_route,
    paid_unit_count: plan.paid_unit_count,
    paid_video_seconds: plan.paid_video_seconds,
    local_unit_count: plan.local_unit_count,
    review_only_count: plan.review_only_count,
    reuse_count: plan.reuse_count,
    zero_cost_action_count: plan.zero_cost_action_count,
    automatic_retry_count: 0,
    blockers: plan.blockers || [],
    shots: (plan.shots || []).map(item => ({
      shot_index: item.shot_index, title: item.title, action: item.action, label: item.label,
      paid: item.paid, unit_id: item.unit_id || '', changes: item.changes || [],
    })),
    units: (plan.units || []).map(unit => ({
      id: unit.id, shots: unit.shots, title: unit.title, action: unit.action, label: unit.label,
      paid: unit.paid, continuous: unit.continuous === true, duration_sec: unit.duration_sec,
      input_strategy: unit.input_strategy || '', changes: unit.changes || [],
    })),
    generated_at: plan.generated_at,
  };
}

module.exports = {
  VIDEO_PREFLIGHT_POLICY_VERSION,
  keyframePersonPresence,
  approvedKeyframe,
  reconcileShot,
  reconcileShots,
  cameraOnlyShot,
  peopleOnlyFailureCanBeRechecked,
  repairInstruction,
  buildVideoPreflight,
  publicVideoPreflight,
};
