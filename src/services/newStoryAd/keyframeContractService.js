const { sceneContractForShot } = require('./sceneBindingService');

function buildKeyframeContracts(ctx, shots) {
  const controls = ctx.controlled_production || {};
  const productControl = controls.product_control || {};
  const styleControl = controls.style_control || {};
  const negativeControl = controls.negative_control || {};
  const environmentControl = controls.environment_control || {};
  return (Array.isArray(shots) ? shots : []).map((shot, idx) => {
    const sceneLock = sceneContractForShot(ctx, shot, idx);
    return {
      shot_index: idx + 1,
      title: shot.title || `镜头 ${idx + 1}`,
      role: shot.role || shot.purpose || '',
      output_ratio: ctx.output_ratio,
      subject_lock: {
        advertised_subject: ctx.product_subject,
        forbidden: ctx.forbidden || [],
        task_isolation: 'only use current new_story_ad task context',
      },
      scene_lock: sceneLock,
      continuity_lock: shot.continuity || {
        continuity_from: shot.continuity_from || '',
        entry_frame_state: shot.entry_frame_state || '',
        exit_frame_state: shot.exit_frame_state || '',
        action_start: shot.action_start || '',
        action_end: shot.action_end || '',
        screen_direction: shot.screen_direction || '',
        eyeline: shot.eyeline || '',
        camera_axis: shot.camera_axis || '',
        camera_movement: shot.camera_movement || '',
        shot_size: shot.shot_size || '',
        camera_angle: shot.camera_angle || '',
        lens_mm: shot.lens_mm || 0,
        depth_of_field: shot.depth_of_field || '',
        composition: shot.composition || '',
        subject_position: shot.subject_position || '',
        object_states: shot.object_states || '',
        transition_type: shot.transition_type || '',
        transition_reason: shot.transition_reason || '',
        audio_bridge: shot.audio_bridge || '',
        ambient_sound: shot.ambient_sound || '',
        sfx: shot.sfx || [],
        music_cue: shot.music_cue || '',
        voiceover_timing: shot.voiceover_timing || '',
      },
      cast_lock: {
        cast_mode: ctx.cast_mode,
        characters: ctx.characters || [],
        shot_characters: shot.characters || [],
        dialogue_lines: shot.dialogue_lines || [],
        person_asset: ctx.person_asset || null,
        cast_profiles: ctx.cast_profiles || [],
        real_person_locked: ctx.person_context?.real_person_locked === true,
        production_usable_actor: ctx.person_context?.production_usable_actor === true,
        person_contract: ctx.person_contract || ctx.person_asset?.person_contract || null,
      },
      product_lock: ctx.product_contract || null,
      visual_contract: {
        must_show: shot.visual,
        action: shot.action,
        evidence: shot.keyframe_notes || shot.material_usage || '',
        scene_direction: environmentControl.mode || 'auto',
        custom_scene_requirement: environmentControl.custom || '',
        product_required: productControl.enabled === true,
        product_presence: productControl.presence || 'medium',
        product_lock_strength: productControl.lock_strength || 'standard',
        product_methods: Array.isArray(productControl.methods) ? productControl.methods : [],
        style_direction: styleControl.notes || '',
        negative_requirements: negativeControl.text || '',
        text_rule: 'do not render readable UI labels, slogans, captions or brand text in image; leave clean post-production space if needed',
      },
      negative_prompt: [
        'wrong advertised subject',
        'old task subject contamination',
        'unconfirmed character',
        'unrequested pet or robot',
        'poster-only abstract scene',
        'unrequested stock-market or finance dashboard',
        'unrelated charts, K-line candles or trading screens',
        'generic data wall replacing the actual advertised subject',
        'different industry setting not requested by current task',
        'readable random text or logo',
        'missing required people in multi-person story',
        negativeControl.text || '',
      ],
    };
  });
}

module.exports = { buildKeyframeContracts };
