'use strict';
const tts = require('./ttsAdapter');
const MODE = 'seedance_native_audio_v1';
const fail = (code, message) => Object.assign(new Error(message), { code, status: 422, retryable: false });

function speech(shot = {}) { return tts.shotSpeechUnits(shot).map(unit => ({ kind: unit.kind, speaker: unit.speaker, text: unit.text })); }
function wantsSound(shot = {}) {
  if (speech(shot).length) return true;
  return shot.sound_mode !== 'silent' && [shot.sound_design, shot.ambient_sound, shot.sfx, shot.music_cue].some(value => String(value || '').trim());
}
function estimateSpeechSeconds(text = '') {
  const han = (String(text).match(/[\p{Script=Han}]/gu) || []).length;
  const words = (String(text).replace(/[\p{Script=Han}]/gu, ' ').match(/[\p{L}\p{N}]+/gu) || []).length;
  const pauses = (String(text).match(/[，。！？；,.!?;]/g) || []).length;
  return han / 4 + words / 2.3 + pauses * 0.15;
}
function prepareShots(shots = []) {
  return shots.map((shot, index) => {
    const units = speech(shot), speaking = units.reduce((sum, unit) => sum + estimateSpeechSeconds(unit.text), 0);
    if (tts.speechMode(shot) === 'on_camera_dialogue' && !units.some(unit => unit.kind === 'dialogue')) throw fail('VIDEO_DIALOGUE_TEXT_REQUIRED', `第 ${index + 1} 镜是出镜对白或介绍，必须提供对应人物的完整台词。`);
    const required = units.length ? Math.ceil(speaking + 1 + Math.max(0, units.length - 1) * 0.3) : 0;
    if (required > 15) throw fail('VIDEO_SPEECH_SHOT_TOO_LONG', `第 ${index + 1} 镜台词预计需要 ${required} 秒，超过单镜15秒；请拆分该镜头，不能截断旁白或对白。`);
    const duration = Math.ceil(Math.max(Number(shot.duration_sec || shot.duration || 0), required, 3));
    if (!Number.isFinite(duration) || duration > 15) throw fail('VIDEO_SHOT_DURATION_UNSUPPORTED', `第 ${index + 1} 镜时长超出单镜范围，请拆分镜头。`);
    return { ...shot, duration, duration_sec: duration, native_audio_plan: { mode: MODE, speech: units, required_seconds: required, leading_silence_sec: 0.25, trailing_silence_sec: 0.5 } };
  });
}
function context(ctx = {}) { return { ...ctx, audio_mode: MODE, include_voiceover: false, voice_id: '', voice_assignments: {}, bgm_asset: null }; }
function prompt(shot = {}) {
  const units = speech(shot), duration = Number(shot.duration_sec || shot.duration || 0);
  return `原生音视频合同：一次生成画面与声音；全镜时长${duration}秒。${units.length ? `必须逐字完整说出以下台词，按顺序、不漏字、不重复、不加词：${JSON.stringify(units)}。在0.25秒后开始，至少在镜头结束前0.5秒说完最后一个字；不得通过异常加速、吞字、截断句尾完成。` : '本镜没有台词，不得添加人声。'}${tts.speechMode(shot) === 'on_camera_dialogue' ? '出镜人物对白或介绍：说话人身份、轮次、口型开合必须与实际发音同步；未说话人物闭口，不得用旁白代替人物开口。' : '旁白属于画外音，不要让画面人物跟随旁白张嘴。'}同一人物/旁白在全片保持同一音色、口音与语速；环境声和音乐服从剧情，不遮盖台词。`;
}
function assertPostproduction(taskId, storage) {
  const final = storage.getOutput(taskId, 'final_video');
  if (!(final?.video_url || final?.videoUrl)) throw fail('AUDIO_EDIT_FINAL_REQUIRED', '请先生成并合成初版成片，再在成片剪辑中修改声音。');
  return final;
}
module.exports = { MODE, context, speech, wantsSound, estimateSpeechSeconds, prepareShots, prompt, assertPostproduction };
