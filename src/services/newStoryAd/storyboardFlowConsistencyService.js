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
  const rebased = list(shots).map((shot, index) => {
    const beatId = text(shot.source_beat_id || shot.source_story_beat_id || shot.flow_beat_id);
    const unit = unitByBeat.get(beatId);
    if (!beatId || !unit) {
      missing.push(!beatId
        ? `第 ${Number(shot.index || shot.shot_index || index + 1)} 镜缺少 source_beat_id`
        : `第 ${Number(shot.index || shot.shot_index || index + 1)} 镜引用了当前剧本不存在的剧情节点 ${beatId}`);
      return shot;
    }
    return {
      ...shot,
      scene_id: text(unit.scene_id),
      scene_asset_id: text(unit.scene_id),
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
