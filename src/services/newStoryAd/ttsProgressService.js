'use strict';

const storage = require('./storageService');
const stageProgress = require('./stageProgressService');

function create({ taskId, total = 1, generationId = '', voiceId = '', voiceAssignments = {}, startedAt = '' } = {}) {
  const safeTotal = Math.max(1, Number(total) || 1);
  let completed = 0;
  const update = (phase, options = {}) => stageProgress.update(taskId, {
    stage: 'tts', phase, completed: options.completed ?? completed, total: safeTotal,
    generationId, startedAt, status: options.status || 'running', message: options.message || '',
  });
  return {
    preparing: () => update('voice_preparing', { message: `正在准备 ${safeTotal} 段配音` }),
    skipped: () => update('voice_skipped', { status: 'done', completed: safeTotal, message: '当前分镜没有需要生成的旁白或对白' }),
    reused: () => update('voice_reused', { status: 'done', completed: safeTotal, message: `已复用 ${safeTotal} 段当前音色的有效配音` }),
    checkpoint(tracks = [], checkpoint = {}) {
      completed = Number(checkpoint.completed ?? tracks.filter(Boolean).length) || 0;
      storage.saveOutput(taskId, 'tts_audio', {
        tracks, voice_id: voiceId, voice_assignments: voiceAssignments,
        provider_used: tracks.find(track => track?.provider_used)?.provider_used || '',
        warnings: tracks.map(track => track?.warning).filter(Boolean),
        status: tracks.every(Boolean) ? 'ready' : 'running', updated_at: new Date().toISOString(),
      });
      return update('voice_generating', { message: `已生成 ${completed}/${safeTotal} 段配音` });
    },
    failed: error => update('voice_failed', { status: 'failed', message: error?.message || '配音生成失败' }),
    ready: () => update('voice_ready', { status: 'done', completed: safeTotal, message: `${safeTotal} 段配音已生成，可逐段试听` }),
  };
}

module.exports = { create };
