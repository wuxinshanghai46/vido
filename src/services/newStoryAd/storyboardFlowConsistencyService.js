'use strict';

function text(value = '') { return String(value || '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }
function collapse(values = []) { return values.filter(Boolean).filter((value, index, rows) => value !== rows[index - 1]); }

function inspect(shots = [], contract = {}) {
  const units = list(contract.units);
  const unitByBeat = new Map(units.map(unit => [text(unit.beat_id), unit]));
  const errors = [];
  const actualScenes = [];
  list(shots).forEach((shot, index) => {
    const beatId = text(shot.source_beat_id || shot.source_story_beat_id || shot.flow_beat_id);
    const unit = unitByBeat.get(beatId);
    const shotNo = Number(shot.index || shot.shot_index || index + 1);
    if (!beatId) {
      errors.push(`第 ${shotNo} 镜缺少 source_beat_id，无法证明它继承了已确认剧本`);
      return;
    }
    if (!unit) {
      errors.push(`第 ${shotNo} 镜引用了当前剧本不存在的剧情节点 ${beatId}`);
      return;
    }
    const actual = text(shot.scene_id || shot.scene_asset_id);
    const expected = text(unit.scene_id);
    if (!actual || actual !== expected) errors.push(`第 ${shotNo} 镜场景应为 ${expected || '(未绑定)'}，实际为 ${actual || '(未绑定)'}`);
    if (actual) actualScenes.push(actual);
    const fingerprint = text(shot.story_flow_contract_fingerprint);
    if (!fingerprint || fingerprint !== text(contract.contract_fingerprint)) {
      errors.push(`第 ${shotNo} 镜没有继承当前剧情流合同指纹`);
    }
    if (Object.hasOwn(unit, 'character_ids')) {
      const expectedPeople = list(unit.character_ids).length;
      if (Number(shot.expected_people) !== expectedPeople || list(shot.characters).length !== expectedPeople) {
        errors.push(`第 ${shotNo} 镜出镜人数应为 ${expectedPeople}，不能复用其他剧情节点的人物绑定`);
      }
    }
  });
  const expectedScenes = collapse(units.map(unit => text(unit.scene_id)));
  const actualSequence = collapse(actualScenes);
  if (expectedScenes.length && actualSequence.join('|') !== expectedScenes.join('|')) {
    errors.push(`分镜场景顺序必须为 ${expectedScenes.join(' → ')}，实际为 ${actualSequence.join(' → ') || '(空)'}`);
  }
  return { ok: errors.length === 0, errors, expected_scene_sequence: expectedScenes, actual_scene_sequence: actualSequence };
}

function assertMatches(shots = [], contract = {}, options = {}) {
  if (!contract || !list(contract.units).length || !text(contract.contract_fingerprint)) {
    throw Object.assign(new Error('当前没有可验证的剧情流合同，禁止保存或继续生成分镜'), {
      code: 'STORYBOARD_FLOW_CONTRACT_REQUIRED', status: 409, retryable: false,
    });
  }
  const result = inspect(shots, contract);
  if (!result.ok) {
    throw Object.assign(new Error(`分镜与已确认剧本不一致：${result.errors.join('；')}`), {
      code: 'STORYBOARD_FLOW_MISMATCH', status: 422, retryable: false,
      flow_consistency: result, boundary: options.boundary || '',
    });
  }
  return result;
}

function assertWhenPresent(shots = [], contract = {}, options = {}) {
  if (!contract || !list(contract.units).length || !text(contract.contract_fingerprint)) {
    return { ok: true, skipped: true, reason: 'legacy_story_flow_contract_absent' };
  }
  return assertMatches(shots, contract, options);
}

function rebaseWhenPresent(shots = [], contract = {}, options = {}) {
  if (!contract || !list(contract.units).length || !text(contract.contract_fingerprint)) {
    return { shots: list(shots), changed: false, skipped: true, reason: 'legacy_story_flow_contract_absent' };
  }
  const unitByBeat = new Map(list(contract.units).map(unit => [text(unit.beat_id), unit]));
  const missing = [];
  const seenBeatIds = new Set();
  const rebased = list(shots).map((shot, index) => {
    const beatId = text(shot.source_beat_id || shot.source_story_beat_id || shot.flow_beat_id);
    const unit = unitByBeat.get(beatId);
    if (!beatId || !unit) {
      missing.push(!beatId
        ? `第 ${Number(shot.index || shot.shot_index || index + 1)} 镜缺少 source_beat_id`
        : `第 ${Number(shot.index || shot.shot_index || index + 1)} 镜引用了当前剧本不存在的剧情节点 ${beatId}`);
      return shot;
    }
    const firstShotForBeat = !seenBeatIds.has(beatId);
    seenBeatIds.add(beatId);
    // The scene id and its revision are one authority unit. Keeping the old
    // revision while rebasing only the id creates an impossible r2/r5 pair,
    // which is later rejected by sceneBindingService before prompt generation.
    const { scene_revision: _staleSceneRevision, sceneRevision: _staleSceneRevisionAlias, ...current } = shot;
    const cast = Object.hasOwn(unit, 'character_ids') ? list(unit.character_ids).map(id => {
      const person = list(contract.people).find(item => text(item.character_id) === text(id));
      return { id, name: person?.name || id, action: text(unit.action) };
    }) : null;
    const existingCast = list(shot.characters);
    const stableCast = cast && existingCast.length === cast.length && cast.every(person =>
      existingCast.some(existing => text(existing.name || existing) === text(person.name))) ? existingCast : cast;
    return {
      ...current,
      ...(cast ? { character_ids: [...unit.character_ids], characters: stableCast, expected_people: cast.length,
        no_person: cast.length === 0, look_bindings: unit.look_bindings || {}, voice_bindings: unit.voice_bindings || {} } : {}),
      scene_id: text(unit.scene_id),
      scene_asset_id: text(unit.scene_id),
      // Scene transitions are confirmed story-flow authority, not optional
      // model prose. A split beat carries the boundary only on its first shot.
      transition_from: firstShotForBeat ? text(unit.transition_from) : '',
      transition_reason: firstShotForBeat ? text(unit.transition_reason) : '',
      story_flow_contract_fingerprint: text(contract.contract_fingerprint),
    };
  });
  if (missing.length) {
    throw Object.assign(new Error(`分镜无法重绑定到当前剧本：${missing.join('；')}`), {
      code: 'STORYBOARD_FLOW_REBASE_UNSAFE', status: 422, retryable: false,
      boundary: options.boundary || '', errors: missing,
    });
  }
  return {
    shots: rebased,
    changed: JSON.stringify(rebased) !== JSON.stringify(list(shots)),
    rebased: true,
  };
}

module.exports = { collapse, inspect, assertMatches, assertWhenPresent, rebaseWhenPresent };
