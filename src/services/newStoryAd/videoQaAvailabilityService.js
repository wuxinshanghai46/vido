'use strict';

const fs = require('fs');

const UNAVAILABLE_CODES = new Set([
  'VISION_QA_UNAVAILABLE',
  'VISION_CIRCUIT_OPEN',
  'VISION_REFERENCE_UNAVAILABLE',
  'VISION_QA_SCHEMA_INVALID',
  'VIDEO_AUDIO_QA_UNAVAILABLE',
]);

function codeOf(value = {}) {
  return String(value?.code || value?.error_code || '').trim().toUpperCase();
}

function isUnavailable(value = {}) {
  const code = codeOf(value);
  return UNAVAILABLE_CODES.has(code) || /(?:视觉|声音).*审核服务.*(?:不可用|繁忙)/.test(String(value?.message || value?.error || ''));
}

function pendingFailure(index = 0, kind = 'visual', error = {}) {
  return {
    index: Math.max(0, Number(index) || 0),
    kind: kind === 'audio' ? 'audio_qa_unavailable' : 'frame_qa_unavailable',
    code: codeOf(error) || (kind === 'audio' ? 'VIDEO_AUDIO_QA_UNAVAILABLE' : 'VISION_QA_UNAVAILABLE'),
    message: String(error?.message || error?.error || '自动审片服务暂不可用').trim().slice(0, 1200),
    retryable: true,
  };
}

function createDeferral({ storage, videoAdapter, videoCostAuthorization, taskId, shots }) {
  const failures = [];
  function preserve(clips, index, clip, error, kind = 'visual') {
    const pending = pendingFailure(index, kind, error);
    failures.push(pending);
    const preserved = {
      ...clip,
      qa_pending: true,
      qa_unavailable: { code: pending.code, kind: pending.kind, recorded_at: new Date().toISOString() },
      error: '', error_code: '',
    };
    clips[index] = preserved;
    videoAdapter.updateVideoShotStatus(taskId, index, {
      lifecycle: 'video_qa', qa_status: 'unavailable',
      file_path: clip.file_path || '', file_exists: !!(clip.file_path && fs.existsSync(clip.file_path)),
      video_url: clip.video_url || clip.videoUrl || '',
      error: pending.message, error_code: pending.code, retryable: true,
    }, shots.length);
    storage.saveOutput(taskId, 'video_clips', clips);
    return preserved;
  }
  function throwIfPending(clips) {
    if (!failures.length) return;
    const indexes = [...new Set(failures.map(item => item.index))].sort((a, b) => a - b);
    storage.saveStage(taskId, 'video', {
      status: 'failed', output_summary: `${clips.filter(Boolean).length}/${shots.length} video clips；${indexes.length} 镜待重新审片`,
      error: '自动审片服务暂不可用',
      diagnostics: { qa_unavailable: failures, pending_qa_indexes: indexes.map(index => index + 1), generated_indexes: clips.map((clip, index) => clip && index + 1).filter(Boolean) },
    });
    storage.updateTask(taskId, {
      status: 'failed', stage: 'video_failed',
      error: `已生成的视频均已保留，但自动审片服务暂不可用；待复审镜头：${indexes.map(index => `第 ${index + 1} 镜`).join('、')}`,
      error_code: 'VISION_QA_UNAVAILABLE', retryable: true,
    });
    videoCostAuthorization.transition(taskId, 'failed', { failure_code: 'VISION_QA_UNAVAILABLE' });
    const error = new Error('视频已生成并保留，但自动审片服务暂不可用；再次继续时会先复审已保存视频，不会重复生成。');
    error.code = 'VISION_QA_UNAVAILABLE'; error.retryable = true; error.video_clips = clips; error.qa_unavailable = failures.slice();
    throw error;
  }
  return { failures, preserve, throwIfPending };
}

module.exports = { UNAVAILABLE_CODES, codeOf, isUnavailable, pendingFailure, createDeferral };
