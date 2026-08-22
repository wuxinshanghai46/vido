const crypto = require('crypto');
const { cleanText } = require('./contextBuilder');

const CONTRACT_VERSION = 'production-board-v1';

function stableId(kind, seed) {
  return `${kind}_${crypto.createHash('sha1').update(String(seed || kind)).digest('hex').slice(0, 12)}`;
}

function list(value, limit = 12, size = 240) {
  return (Array.isArray(value) ? value : (value ? [value] : []))
    .map(item => cleanText(typeof item === 'object' ? (item.text || item.name || item.value || '') : item, size))
    .filter(Boolean).slice(0, limit);
}

function soundSummary(beat = {}) {
  return [beat.ambient_sound, ...list(beat.sfx, 8, 160), beat.music_cue, beat.audio_bridge]
    .map(value => cleanText(value, 160)).filter(Boolean).join('；');
}

function normalizeCharacter(character = {}, index = 0, seed = '') {
  const id = cleanText(character.id || character.character_id || character.source_character_id, 80)
    || stableId('character', `${seed}|${index}|${character.name || character.displayName || ''}`);
  const voice = character.voice && typeof character.voice === 'object' ? character.voice : {};
  return {
    ...character,
    id,
    name: cleanText(character.name || character.displayName || `角色${index + 1}`, 120),
    gender: cleanText(character.gender || 'unspecified', 24).toLowerCase(),
    age_range: cleanText(character.age_range || character.age || '', 60),
    role: cleanText(character.role || character.roleName || '', 120),
    relationship: cleanText(character.relationship || '', 240),
    description: cleanText(character.description || '', 1000),
    voice: {
      mode: cleanText(voice.mode || (character.voice_id ? 'assigned' : 'unassigned'), 24),
      voice_id: cleanText(voice.voice_id || character.voice_id || '', 160),
      voice_name: cleanText(voice.voice_name || character.voice_name || '', 160),
      direction: cleanText(voice.direction || character.voice_tone || '', 300),
      language: cleanText(voice.language || '', 40),
      speed: Number.isFinite(Number(voice.speed)) ? Number(voice.speed) : 1,
      pitch: Number.isFinite(Number(voice.pitch)) ? Number(voice.pitch) : 0,
    },
    voice_id: cleanText(voice.voice_id || character.voice_id || '', 160),
    voice_tone: cleanText(voice.direction || character.voice_tone || '', 300),
    on_screen: character.on_screen !== false,
  };
}

function normalizeBeat(beat = {}, index = 0, seed = '') {
  const shotId = cleanText(beat.shot_id || beat.id || beat.source_shot_id, 100)
    || stableId('shot', `${seed}|${index}|${beat.title || beat.role || ''}|${beat.visual || beat.plot || ''}`);
  const duration = Math.max(1, Math.min(30, Number(beat.duration || beat.duration_sec || 3) || 3));
  const sfx = list(beat.sfx || beat.sound_effects, 12, 180);
  const soundMode = cleanText(beat.sound_mode || '', 30)
    || (beat.explicit_silence_reason ? 'silent' : (beat.ambient_sound || sfx.length || beat.music_cue || beat.sound_design ? 'designed' : 'unassigned'));
  const spoken = cleanText(beat.spoken_line || beat.voiceover || '', 700);
  const dialogueLines = Array.isArray(beat.dialogue_lines) ? beat.dialogue_lines.map(line => {
    const speechMode = cleanText(line?.speech_mode || line?.kind || 'dialogue', 30) === 'voiceover' ? 'voiceover' : 'dialogue';
    return {
      speech_mode: speechMode,
      speaker_id: speechMode === 'voiceover' ? 'narrator' : cleanText(line?.speaker_id || '', 80),
      speaker: speechMode === 'voiceover' ? '旁白' : cleanText(line?.speaker || '', 120),
      line: cleanText(line?.line || line?.text || '', 700),
    };
  }).filter(line => line.line) : (spoken ? [{
    speech_mode: cleanText(beat.speech_mode || 'voiceover', 30) === 'dialogue' ? 'dialogue' : 'voiceover',
    speaker_id: cleanText(beat.speech_mode || '', 30) === 'dialogue' ? cleanText(beat.speaker_id || '', 80) : 'narrator',
    speaker: cleanText(beat.speech_mode || '', 30) === 'dialogue' ? cleanText(beat.speaker || '', 120) : '旁白',
    line: spoken,
  }] : []);
  const ambient = cleanText(beat.ambient_sound || '', 300);
  const music = cleanText(beat.music_cue || '', 300);
  const bridge = cleanText(beat.audio_bridge || '', 300);
  return {
    ...beat,
    shot_id: shotId, id: shotId, index: index + 1, beat_index: index + 1,
    title: cleanText(beat.title || beat.role || `镜头 ${index + 1}`, 120),
    duration, duration_sec: duration,
    scene: cleanText(beat.scene || beat.location || '', 180),
    visual: cleanText(beat.visual || beat.plot || '', 1400),
    plot: cleanText(beat.visual || beat.plot || '', 1400),
    action: cleanText(beat.action || '', 900),
    shot_size: cleanText(beat.shot_size || beat.shot_type || '', 80),
    lighting_mood: cleanText(beat.lighting_mood || '', 240),
    camera_movement: cleanText(beat.camera_movement || '', 240),
    camera_movement_notes: cleanText(beat.camera_movement_notes || '', 500),
    transition: cleanText(beat.transition || '', 160),
    speech_mode: cleanText(beat.speech_mode || (spoken ? 'voiceover' : 'silent'), 30),
    speaker_id: cleanText(beat.speaker_id || '', 80), speaker: cleanText(beat.speaker || '', 120),
    spoken_line: spoken, voiceover: spoken, dialogue_lines: dialogueLines,
    sound_contract_version: 1, sound_mode: soundMode, ambient_sound: ambient, sfx, music_cue: music, audio_bridge: bridge,
    explicit_silence_reason: cleanText(beat.explicit_silence_reason || '', 300),
    sound_design: cleanText(beat.sound_design || soundSummary({ ambient_sound: ambient, sfx, music_cue: music, audio_bridge: bridge }), 600),
    voiceover_timing: cleanText(beat.voiceover_timing || '', 300),
    prompt_notes: cleanText(beat.prompt_notes || '', 1200),
    keyframe_prompt_override: cleanText(beat.keyframe_prompt_override || '', 2400),
    video_prompt_override: cleanText(beat.video_prompt_override || '', 2400),
    negative_prompt_override: cleanText(beat.negative_prompt_override || '', 1200),
    visual_proof: cleanText(beat.visual_proof || beat.purpose || '', 800),
    confirmed: beat.confirmed !== false,
  };
}

function normalizeBoard(board = {}, { seed = '' } = {}) {
  const characters = (Array.isArray(board.characters) ? board.characters : []).map((item, index) => normalizeCharacter(item, index, seed));
  const beats = (Array.isArray(board.beats) ? board.beats : []).map((item, index) => normalizeBeat(item, index, seed));
  return { ...board, contract_version: CONTRACT_VERSION, board_id: cleanText(board.board_id || '', 100) || stableId('board', seed), characters, beats };
}

function soundComplete(beat = {}) {
  if (beat.sound_mode === 'silent') return !!cleanText(beat.explicit_silence_reason || '', 300);
  return !!(cleanText(beat.ambient_sound || '', 300) || list(beat.sfx).length || cleanText(beat.music_cue || '', 300) || cleanText(beat.audio_bridge || '', 300) || cleanText(beat.sound_design || '', 600));
}

module.exports = { CONTRACT_VERSION, normalizeBoard, normalizeBeat, normalizeCharacter, soundComplete, stableId };
