function buildKeyframeContracts(ctx, shots) {
  return (Array.isArray(shots) ? shots : []).map((shot, idx) => ({
    shot_index: idx + 1,
    title: shot.title || `镜头 ${idx + 1}`,
    role: shot.role || shot.purpose || '',
    output_ratio: ctx.output_ratio,
    subject_lock: {
      advertised_subject: ctx.product_subject,
      forbidden: ctx.forbidden || [],
      task_isolation: 'only use current new_story_ad task context',
    },
    cast_lock: {
      cast_mode: ctx.cast_mode,
      characters: ctx.characters || [],
      shot_characters: shot.characters || [],
      dialogue_lines: shot.dialogue_lines || [],
    },
    visual_contract: {
      must_show: shot.visual,
      action: shot.action,
      evidence: shot.keyframe_notes || shot.material_usage || '',
      text_rule: 'do not render readable UI labels, slogans, captions or brand text in image; leave clean post-production space if needed',
    },
    negative_prompt: [
      'wrong advertised subject',
      'old task subject contamination',
      'unconfirmed character',
      'unrequested pet or robot',
      'poster-only abstract scene',
      'readable random text or logo',
      'missing required people in multi-person story',
    ],
  }));
}

module.exports = { buildKeyframeContracts };
