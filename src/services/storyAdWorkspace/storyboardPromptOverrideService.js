'use strict';

const storage = require('../newStoryAd/storageService');
const sketchGate = require('./storyboardSketchGateService');

const OUTPUT_KIND = 'storyboard_image_prompt_overrides';
const clean = (value = '', max = 160) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
function cleanPrompt(value = '', max = 3200) {
  return String(value || '').replace(/\r\n?/g, '\n').split('\n')
    .map(line => line.replace(/[\t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
function fingerprint(shotIndex, promptText = '') {
  const normalized = cleanPrompt(promptText);
  return normalized ? storage.canonicalFingerprint({ shot_index: Number(shotIndex), prompt_text: normalized }) : '';
}
function list(taskId) {
  return (Array.isArray(storage.getOutput(taskId, OUTPUT_KIND)) ? storage.getOutput(taskId, OUTPUT_KIND) : [])
    .map(item => ({ ...item, shot_index: Number(item.shot_index), prompt_text: cleanPrompt(item.prompt_text), fingerprint: clean(item.fingerprint, 160) }))
    .filter(item => item.shot_index > 0 && item.prompt_text);
}
function save(taskId, shotIndex, promptText = '', user = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw Object.assign(new Error('项目不存在'), { status: 404, code: 'TASK_NOT_FOUND' });
  if (task.active_generation_id) throw Object.assign(new Error('当前生成正在执行，不能同时修改分镜提示词'), { status: 409, code: 'GENERATION_ACTIVE_EDIT_BLOCKED' });
  sketchGate.assertReady(taskId);
  const numericIndex = Number(shotIndex);
  const shots = storage.getOutput(taskId, 'storyboard_table') || [];
  if (!shots.some((shot, index) => Number(shot.shot_index || shot.index || index + 1) === numericIndex)) {
    throw Object.assign(new Error('没有找到对应镜头'), { status: 404, code: 'STORYBOARD_SHOT_NOT_FOUND' });
  }
  const normalized = cleanPrompt(promptText);
  const prior = list(taskId);
  const old = prior.find(item => item.shot_index === numericIndex);
  const currentFingerprint = fingerprint(numericIndex, normalized);
  if (clean(old?.fingerprint, 160) === currentFingerprint) return { changed: false, override: old || null };
  const next = prior.filter(item => item.shot_index !== numericIndex);
  if (normalized) next.push({ shot_index: numericIndex, prompt_text: normalized, fingerprint: currentFingerprint, updated_at: new Date().toISOString(), updated_by: clean(user.id || user.username, 120) });
  next.sort((a, b) => a.shot_index - b.shot_index);
  storage.saveOutput(taskId, OUTPUT_KIND, next, {
    content_revision: Number(task.content_revision || 1) || 1,
    snapshot_id: task.current_snapshot_id || `manual:${taskId}`,
  });
  return { changed: true, override: next.find(item => item.shot_index === numericIndex) || null };
}

module.exports = { OUTPUT_KIND, cleanPrompt, fingerprint, list, save };
