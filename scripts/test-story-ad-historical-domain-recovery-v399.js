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
      { id: 'shot_2', index: 2, duration: 3, scene_id: 'space_01_showroom', visual: '纹理特写', voiceover: '细节决定最终品质。', requires_previous_frame: true, transition_type: 'cut_on_action', transition_reason: '旧人物动作承接', camera_axis: 'opposite', temporal_state: { continuity_links: ['旧人物动作'] } },
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
  assert.equal(recovered.context.asset_setup_confirmed, true);
  assert.equal(recovered.context.scene_setup_confirmed, true);
  assert.equal(recovered.context.shot_confirmed, true);
  assert.equal(recovered.context.shot_design_confirmed, true);
  assert.equal(recovered.storyboard_table[1].requires_previous_frame, false);
  assert.equal(recovered.storyboard_table[1].transition_type, 'hard_cut');
  assert.equal(recovered.storyboard_table[1].camera_axis, '');
  assert.deepEqual(recovered.storyboard_table[1].temporal_state.continuity_links, []);
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

{
  const shots = recoveryService.compileSceneTransitionReasons([
    { id: 'a', scene_id: 'scene_a' },
    { id: 'b', scene_id: 'scene_b' },
  ], [{ id: 'scene_a', name: '展台' }, { id: 'scene_b', name: '家居展厅' }]);
  assert.equal(shots[0].transition_reason, undefined);
  assert.match(shots[1].transition_reason, /展台.+家居展厅/);
}

{
  const crossScene = fixture();
  crossScene.currentWork.scene_assets = [
    { id: 'space_01_showroom', name: '现代展厅' },
    { id: 'space_02_exhibition', name: '商业展台' },
  ];
  crossScene.historicalWork.storyboard_table[1].scene_id = 'space_02_exhibition';
  const recovered = recoveryService.buildRecovery(crossScene);
  assert.equal(recovered.storyboard_table[1].transition_type, 'dissolve');
  assert.equal(recovered.storyboard_table[1].transition_duration_sec, 0.45,
    '缺失时长的跨场景叠化必须使用连续性合同默认值，不能被早期归一化的 0 覆盖');
}

console.log('story-ad historical domain recovery v399 tests passed');
