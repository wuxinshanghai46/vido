'use strict';

const storage = require('../newStoryAd/storageService');

const OUTPUT_KIND = 'story_flow_sketches';

function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function clean(value = '', max = 180) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }

function blueprintState(taskId) {
  const task = storage.getTask(taskId) || {};
  const blueprint = storage.getOutput(taskId, 'blueprint') || {};
  const beats = list(blueprint.beats);
  const fingerprint = clean(blueprint.fingerprint, 180) || storage.canonicalFingerprint({
    title: blueprint.story_title || blueprint.title || '',
    logline: blueprint.logline || '',
    beats,
  });
  return { task, blueprint, beats, fingerprint };
}

function inspectSnapshot(task = {}, blueprint = {}, sketches = []) {
  const beats = list(blueprint.beats);
  const fingerprint = clean(blueprint.fingerprint, 180) || storage.canonicalFingerprint({
    title: blueprint.story_title || blueprint.title || '',
    logline: blueprint.logline || '',
    beats,
  });
  const byBeat = new Map(sketches.map(item => [Number(item.beat_index), item]));
  const current = beats.map((beat, index) => byBeat.get(Number(beat.beat_index || beat.index || index + 1) || index + 1))
    .filter(item => item
      && clean(item.source_blueprint_fingerprint, 180) === fingerprint);
  const confirmed = current.filter(item => item.status === 'confirmed' && clean(item.image_url, 1200));
  const ready = beats.length > 0 && current.length === beats.length && confirmed.length === beats.length;
  return {
    ready,
    total: beats.length,
    current: current.length,
    confirmed: confirmed.length,
    blueprint_fingerprint: fingerprint,
    reason: ready
      ? '剧情流向线稿已全部确认，可以生成绑定人物、场景与机位的分镜。'
      : (!beats.length ? '请先生成并确认剧情与对白。' : `请先完成并确认全部剧情流向线稿（${confirmed.length}/${beats.length}）。`),
  };
}

function inspect(taskId) {
  const task = storage.getTask(taskId) || {};
  const blueprint = storage.getOutput(taskId, 'blueprint') || {};
  return inspectSnapshot(task, blueprint, list(storage.getOutput(taskId, OUTPUT_KIND)));
}

function assertReady(taskId) {
  const state = inspect(taskId);
  if (state.ready) return state;
  const error = new Error(state.reason);
  error.code = 'STORY_FLOW_SKETCH_CONFIRMATION_REQUIRED';
  error.status = 409;
  error.retryable = false;
  throw error;
}

module.exports = { OUTPUT_KIND, assertReady, blueprintState, inspect, inspectSnapshot };
