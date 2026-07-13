const { cleanText } = require('./contextBuilder');

function buildSoundJourney(shots = []) {
  let cursor = 0;
  return (Array.isArray(shots) ? shots : []).map((shot, index) => {
    const duration = Math.max(1, Math.min(30, Number(shot.duration || shot.duration_sec || 3) || 3));
    const segment = {
      shot_index: Number(shot.index || index + 1) || index + 1,
      start_sec: cursor,
      end_sec: cursor + duration,
      ambient: cleanText(shot.ambient_sound || '', 180),
      sfx: (Array.isArray(shot.sfx) ? shot.sfx : String(shot.sfx || '').split(/[,，；;]/)).map(value => cleanText(value, 100)).filter(Boolean).slice(0, 12),
      music: cleanText(shot.music_cue || '', 180),
      transition: cleanText(shot.audio_bridge || '', 180),
      voiceover_timing: cleanText(shot.voiceover_timing || '', 120),
    };
    cursor += duration;
    return segment;
  });
}

module.exports = { buildSoundJourney };
