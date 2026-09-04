'use strict';

function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }

function audioFailureLabel(mode = '') {
  if (mode === 'on_camera_dialogue') return '对白声音与口型不合格';
  if (mode === 'silent') return '原声音轨不合格';
  return '旁白声音不合格';
}

function merge({ audioQa = {}, visualQa = {}, speechMode = 'offscreen_voiceover' } = {}) {
  if (audioQa.pass === true) return visualQa;
  const visualFailed = visualQa.pass === false;
  return {
    ...visualQa,
    pass: false,
    status: 'failed',
    problems: [...new Set([...list(audioQa.problems), ...(visualFailed ? list(visualQa.problems) : [])])],
    failure_dimensions: [...new Set(['native_audio', ...(visualFailed ? list(visualQa.failure_dimensions) : [])])],
    failure_labels_zh: [...new Set([audioFailureLabel(speechMode), ...(visualFailed ? list(visualQa.failure_labels_zh) : [])])],
  };
}

module.exports = { audioFailureLabel, merge };
