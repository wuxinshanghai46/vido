'use strict';
const storage = require('./storageService');
const flow = require('../storyAdWorkspace/storyFlowContractService');
const alignment = require('./storyboardFlowConsistencyService');
const table = require('./storyboardTableService');
const keyframes = require('./keyframeContractService');
const scenePlanning = require('./scenePlanningAuthorityService');
const tts = require('./ttsAdapter');

function plan(taskId, bindings) {
  const task = storage.getTask(taskId);
  if (!task || task.active_generation_id || (storage.getOutput(taskId, 'video_clips') || []).length || storage.getOutput(taskId, 'final_video')) {
    throw Object.assign(new Error('仅允许修复没有活动生成和下游视频的任务'), { code: 'STORYBOARD_AUTHORITY_REPAIR_BLOCKED' });
  }
  const base = flow.draft(taskId);
  if (!Array.isArray(bindings) || bindings.length !== base.units.length || new Set(bindings.map(x => x.beat_id)).size !== base.units.length) {
    throw new Error('必须明确提供每个已确认剧情节点的场景绑定');
  }
  const byBeat = new Map(bindings.map(x => [x.beat_id, x.scene_id]));
  const units = base.units.map((unit, index) => ({ ...unit, scene_id: byBeat.get(unit.beat_id),
    transition_from: index && byBeat.get(base.units[index - 1].beat_id) !== byBeat.get(unit.beat_id) ? byBeat.get(base.units[index - 1].beat_id) : '',
    transition_reason: index && byBeat.get(base.units[index - 1].beat_id) !== byBeat.get(unit.beat_id) ? '按用户确认的剧情地点安排进入下一空间' : '',
  }));
  // Validate all IDs before a single write. Binding choices are supplied by
  // the caller, never guessed from a target task or scene-array position.
  flow.validateUnits(base, units, { requireExact: true });
  const oldShots = storage.getOutput(taskId, 'storyboard_table') || [];
  const sourceFingerprint = storage.canonicalFingerprint({ task_revision: task.content_revision, oldShots, flow: storage.getOutput(taskId, flow.OUTPUT_KIND), bindings });
  return { taskId, base, units, oldShots, sourceFingerprint };
}

function apply(taskId, bindings, expectedFingerprint) {
  const p = plan(taskId, bindings);
  if (p.sourceFingerprint !== expectedFingerprint) throw new Error('任务状态已改变，请重新执行只读预检');
  const context = storage.getOutput(taskId, 'context') || storage.getTask(taskId).request || {};
  const beforeAudio = storage.getOutput(taskId, 'tts_audio');
  const sceneConfig = storage.getOutput(taskId, 'scene_config') || {};
  const archiveKinds = ['context', 'scene_config', 'story_flow_contract', 'storyboard_table', 'storyboard_meta', 'keyframe_contracts', 'storyboard_images', 'storyboard_image_batch', 'shot_reference_packs', 'quality_review'];
  const archive = Object.fromEntries(archiveKinds.map(kind => [kind, storage.getOutput(taskId, kind)]));
  return storage.withWriteBatch(() => {
    storage.saveOutput(taskId, `storyboard_authority_repair_archive:${p.sourceFingerprint}`, archive);
    storage.saveOutput(taskId, 'scene_config', { ...sceneConfig, spaces: (sceneConfig.spaces || []).map(space => ({
      ...space, covered_beat_ids: bindings.filter(b => b.scene_id === (space.id || space.scene_id)).map(b => b.beat_id),
    })) });
    const currentBase = flow.draft(taskId);
    const repaired = flow.repairSystem(taskId, p.units, { reason: 'authored_visual_and_explicit_scene_bindings_v413' }).contract;
    const sceneAssets = scenePlanning.enrichSceneAssets(storage.getOutput(taskId, 'scene_assets') || [], storage.getOutput(taskId, 'scene_config') || {}, context, storage.getOutput(taskId, 'scene_world_overrides') || {});
    const byBeat = new Map((storage.getOutput(taskId, 'blueprint')?.beats || []).map(b => [b.beat_id || b.story_beat_id || b.id, b]));
    const source = alignment.rebaseWhenPresent(p.oldShots, repaired).shots.map((shot, index) => {
      const changedScene = p.oldShots[index].scene_id !== shot.scene_id;
      const changedPeople = Number(p.oldShots[index].expected_people) !== shot.expected_people;
      if (!changedScene && !changedPeople) return { ...p.oldShots[index], ...shot };
      const beat = byBeat.get(shot.source_beat_id) || {};
      const next = { ...shot, visual: beat.visual || beat.plot || shot.visual, action: beat.action || shot.action,
        subject_type: shot.expected_people ? 'human_scene' : 'product_only' };
      for (const key of ['visual_layers', 'story_visual', 'story_moment', 'character_moment', 'promo_visual', 'product_visual', 'commercial_visual', 'scene_domain_contract', 'subject_count_contract', 'decisive_moment', 'keyframe_notes', 'person_presence']) delete next[key];
      if (changedScene) for (const key of ['scene_name', 'scene_view', 'camera_id', 'zone_ids', 'anchor_ids', 'scene_zone', 'scene_zone_id', 'scene_zone_ids', 'scene_anchor_ids']) delete next[key];
      if (changedScene) for (const key of ['entry_frame_state', 'exit_frame_state', 'action_start', 'action_end', 'screen_direction', 'eyeline', 'camera_axis', 'object_states', 'subject_position', 'temporal_state', 'temporal_evidence', 'continuity', 'visual_proof']) delete next[key];
      return next;
    });
    const ctx = { ...context, scene_assets: sceneAssets, story_flow_contract: repaired };
    const shots = table.normalizeShots(source, ctx).map((shot, index) =>
      p.oldShots[index].scene_id === source[index].scene_id && Number(p.oldShots[index].expected_people) === source[index].expected_people
        ? source[index] : shot);
    if (shots.length !== p.oldShots.length || shots.some((shot, i) => shot.shot_id !== p.oldShots[i].shot_id || tts.shotSpeechText(shot) !== tts.shotSpeechText(p.oldShots[i]))) throw new Error('修复改变了镜头身份或旁白，已阻止提交');
    const contracts = keyframes.buildKeyframeContracts(ctx, shots);
    alignment.assertMatches(shots, repaired);
    storage.saveOutput(taskId, 'storyboard_table', shots);
    storage.saveOutput(taskId, 'keyframe_contracts', contracts);
    storage.saveOutput(taskId, 'storyboard_meta', { ...(storage.getOutput(taskId, 'storyboard_meta') || {}), status: 'ready', source: 'authored_authority_repair', story_flow_contract_fingerprint: repaired.contract_fingerprint });
    storage.deleteOutput(taskId, 'shot_reference_packs');
    storage.deleteOutput(taskId, 'storyboard_checkpoint');
    storage.saveOutput(taskId, 'context', { ...context, shot_design_confirmed: false, shot_confirmed: false });
    if (storage.canonicalFingerprint(beforeAudio) !== storage.canonicalFingerprint(storage.getOutput(taskId, 'tts_audio'))) throw new Error('已有音频被意外改变');
    return { repaired: true, scenes: shots.map(s => s.scene_id), people: shots.map(s => s.expected_people), audio_unchanged: true,
      images_preserved: (storage.getOutput(taskId, 'storyboard_images') || []).length, provider_calls: 0, flow_version: currentBase.contract_version };
  });
}
module.exports = { plan, apply };
