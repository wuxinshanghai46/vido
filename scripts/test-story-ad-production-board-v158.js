'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const board = require('../src/services/newStoryAd/productionBoardContractService');
const projection = require('../src/services/newStoryAd/blueprintCharacterProjectionService');
const dialogue = require('../src/services/newStoryAd/briefDialogueHistoryService');
const beatAssist = require('../src/services/newStoryAd/storyBeatAssistService');
const quality = require('../src/services/newStoryAd/qualityReviewService');
const tts = require('../src/services/newStoryAd/ttsAdapter');

let checks = 0;
const ok = (value, message) => { assert(value, message); checks += 1; };
const equal = (actual, expected, message) => { assert.deepStrictEqual(actual, expected, message); checks += 1; };

const normalized = board.normalizeBoard({
  characters: [{ name: '林岚', gender: 'female', age_range: '32岁', role: '设计师', relationship: '向客户介绍方案', voice_id: 'voice_lin', voice_tone: '沉稳清晰' }, { name: '陈先生', gender: 'male', age_range: '45岁', role: '客户', voice_id: 'voice_chen' }],
  beats: [{ title: '材质展示', visual: '林岚向客户展示不锈钢板的完整纹理变化', spoken_line: '这里能看到真实质感。', speaker: '林岚', ambient_sound: '安静展厅底噪', sfx: ['手指轻触金属'], music_cue: '克制现代电子氛围', camera_movement: '中景缓慢推近', prompt_notes: '保留材质纹理' }],
}, { seed: 'task-v158' });
equal(normalized.contract_version, 'production-board-v1', 'board contract version');
ok(normalized.board_id && normalized.beats[0].shot_id && normalized.characters[0].id, 'stable IDs exist');
equal(board.normalizeBoard(normalized, { seed: 'task-v158' }).beats[0].shot_id, normalized.beats[0].shot_id, 'shot ID survives readback');
equal(normalized.beats[0].sfx, ['手指轻触金属'], 'structured SFX survives');
ok(board.soundComplete(normalized.beats[0]), 'designed sound is complete');
ok(!board.soundComplete(board.normalizeBeat({ sound_mode: 'silent' }, 0, 'x')), 'silent needs reason');
ok(board.soundComplete(board.normalizeBeat({ sound_mode: 'silent', explicit_silence_reason: '刻意留白突出画面' }, 0, 'x')), 'explicit silence passes');
const mixedDialogueBeat = board.normalizeBeat({ dialogue_lines: [
  { speech_mode: 'dialogue', speaker_id: 'designer', speaker: '林岚', line: '请看这里的纹理。' },
  { speech_mode: 'voiceover', speaker_id: 'wrong', speaker: '错误人物', line: '材料效果逐渐清晰。' },
] }, 0, 'dialogue-contract');
equal(mixedDialogueBeat.dialogue_lines.map(line => line.speech_mode), ['dialogue', 'voiceover'], '台词与旁白类型不得在制作表投影中丢失');
equal(mixedDialogueBeat.dialogue_lines[1].speaker_id, 'narrator', '旁白必须自动绑定内部旁白者');

const projected = projection.projectCharacters({ cast_profiles: [{ id: normalized.characters[0].id, appearanceText: '短发，简洁西装' }] }, normalized);
equal(projected.cast_profiles.length, 2, 'all people projected');
equal(projected.cast_profiles[0].gender, 'female', 'gender projected');
equal(projected.cast_profiles[0].age_range, '32岁', 'age projected');
equal(projected.cast_profiles[0].appearanceText, '短发，简洁西装', 'enriched look preserved');
equal(projected.voice_assignments.speakers[normalized.characters[0].id], 'voice_lin', 'voice binds stable character id');

const units = tts.shotSpeechUnits({ speech_mode: 'on_camera_dialogue', dialogue_lines: [{ speaker_id: normalized.characters[0].id, speaker: '改名后的林岚', line: '测试台词' }] }, '', projected.voice_assignments);
equal(units[0].voice_id, 'voice_lin', 'TTS resolves stable speaker id after rename');

const richAssist = beatAssist.normalizeAssistedStoryBeat({ story_beat: { ambient_sound: '室内底噪', sfx: ['脚步'], camera_movement: '环绕半圈', keyframe_prompt_override: '锁定材质细节' } }, normalized.beats[0]);
equal(richAssist.sfx, ['脚步'], 'AI assist returns SFX');
equal(richAssist.camera_movement, '环绕半圈', 'AI assist returns camera movement');
equal(richAssist.keyframe_prompt_override, '锁定材质细节', 'AI assist returns prompt override');

const history = dialogue.normalizeHistory([{ role: 'assistant', content: '谁出镜？', suggested_answers: ['一人', '两人'], selected_value: '两人', interaction_type: 'choice', answered: true }]);
equal(history[0].suggested_answers, ['一人', '两人'], 'dialogue choices survive');
equal(history[0].selected_value, '两人', 'dialogue selection survives');

const soundIssues = quality.detailContractIssues({ sound_contract_version: 1, shot_size: '中景', camera_angle: '平视', depth_of_field: '中等景深', composition: '三分构图', subject_position: '画面右侧', entry_frame_state: '人物在场', exit_frame_state: '人物在场', action_start: '抬手', action_end: '放下', camera_movement: '缓慢推近', object_states: '稳定', lens_mm: 50, visual: '人物站在真实展厅内向客户展示不锈钢板材，并明确看到表面纹理、空间关系与柔和侧光变化。', action: '人物抬手触摸材料表面，镜头同时缓慢推近展示细节。', keyframe_notes: '本镜目的：展示；必须出现：材料；禁止出现：其他品牌' }, 0);
ok(soundIssues.some(item => item.includes('声音设计')), 'quality blocks empty sound');

const ui = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/plotBeatEditor.js'), 'utf8');
['ambient_sound', 'sfx', 'music_cue', 'dialogue_lines_json', 'camera_movement_notes', 'keyframe_prompt_override', 'video_prompt_override'].forEach(marker => ok(ui.includes(marker), `UI contains ${marker}`));
ok(!ui.includes('voiceover_timing'), '用户不需要编辑模糊的对白时间字段');
ok(ui.includes('data-open-beat-cell'), 'cells open the compact field editor');
ok(ui.includes('data-beat-floating-editor') === false, 'row renderer must not embed one large editor per row');

console.log(JSON.stringify({ ok: true, checks, model_calls: 0, media_calls: 0 }));
