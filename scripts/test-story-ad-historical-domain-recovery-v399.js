const assert = require('assert');
const recoveryService = require('../src/services/newStoryAd/historicalDomainRecoveryService');

function fixture() {
  const currentWork = {
    context: {
      target_duration: 6,
      cast_profiles: [{
        id: 'char_chenmo', name: '陈默', role: '背景出镜人物', gender: '女', age: '25岁',
        age_source: 'confirmed_input',
      }],
    },
    scene_assets: [{ id: 'space_01_showroom', name: '现代展厅' }],
  };
  const historicalWork = {
    blueprint: {
      characters: [{ id: 'char_chenmo', name: '陈默', role: '背景出镜人物', gender: '女', age_range: '30岁' }],
      beats: [{ beat_index: 1, plot: '展示不锈钢质感', spoken_line: '看见材料真正的质感。' }],
    },
    storyboard_table: [
      { id: 'shot_1', index: 1, duration: 3, scene_id: 'space_01_showroom', visual: '展厅全景', voiceover: '看见材料真正的质感。' },
      { id: 'shot_2', index: 2, duration: 3, scene_id: 'space_01_showroom', visual: '纹理特写', voiceover: '细节决定最终品质。' },
    ],
    tts_audio: { voice_id: 'voice_narrator', tracks: [
      { shot_id: 'shot_1', text: '看见材料真正的质感。', audio_url: '/audio/shot_1.mp3' },
      { shot_id: 'shot_2', text: '细节决定最终品质。', audio_url: '/audio/shot_2.mp3' },
    ] },
    sound_journey: [{ shot_id: 'shot_1', cue: '安静展厅' }],
  };
  return { currentWork, historicalWork };
}

{
  const recovered = recoveryService.buildRecovery(fixture());
  assert.equal(recovered.blueprint.characters[0].age_range, '25岁');
  assert.equal(recovered.storyboard_table.length, 2);
  assert.equal(recovered.tts_audio.tracks.length, 2);
  assert.deepEqual(recovered.invalidated_domains, ['keyframes', 'video', 'compose']);
  assert.equal(recovered.diagnostics.reused_visual_outputs, 0);
  assert.equal(recovered.context.shot_confirmed, true);
}

{
  const broken = fixture();
  broken.historicalWork.tts_audio.tracks[1].text = '不一致的旁白';
  assert.throws(
    () => recoveryService.buildRecovery(broken),
    error => error.code === 'RECOVERY_AUDIO_INCOMPATIBLE'
      && error.details.issues.includes('spoken_text_mismatch:shot_2'),
  );
}

{
  const broken = fixture();
  broken.historicalWork.tts_audio.tracks.pop();
  assert.throws(
    () => recoveryService.buildRecovery(broken),
    error => error.code === 'RECOVERY_AUDIO_INCOMPATIBLE'
      && error.details.issues.includes('missing_track:shot_2')
      && error.details.issues.includes('count_mismatch:1/2'),
  );
}

{
  const flat = fixture();
  const aggregate = recoveryService.buildRecovery({
    currentWork: { domain_payloads: { brief: { context: flat.currentWork.context }, scenes: { assets: flat.currentWork.scene_assets } } },
    historicalWork: { domain_payloads: {
      blueprint: flat.historicalWork.blueprint,
      storyboard: flat.historicalWork.storyboard_table,
      audio: { tts_audio: flat.historicalWork.tts_audio, sound_journey: flat.historicalWork.sound_journey },
    } },
  });
  assert.equal(aggregate.blueprint.characters[0].age_range, '25岁');
  assert.equal(aggregate.storyboard_table.length, 2);
  assert.equal(aggregate.tts_audio.tracks.length, 2);
}

console.log('story-ad historical domain recovery v399 tests passed');
