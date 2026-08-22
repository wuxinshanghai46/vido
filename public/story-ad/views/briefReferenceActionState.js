export function referenceActionState(reference = {}, contentMode = '') {
  const output = contentMode === 'commercial_subject' ? '广告脚本' : '剧情与对白';
  if (!reference.analysis_id) return { blocked: false, label: `确认设想，生成${output}` };
  const status = String(reference.status || '').toLowerCase();
  if (status === 'completed' && reference.analysis_valid === true) {
    const understanding = reference.reference_understanding && typeof reference.reference_understanding === 'object'
      ? { ...reference, ...reference.reference_understanding } : reference;
    const hasUnderstanding = Object.keys(understanding).some(key => [
      'story_bible', 'story_summary', 'story_events', 'causal_chain', 'character_arcs', 'characters',
      'scene_narratives', 'scenes', 'brand_role', 'audio_visual_alignment', 'inferences', 'unknowns',
    ].includes(key) && (Array.isArray(understanding[key]) ? understanding[key].length : Object.keys(understanding[key] || {}).length));
    const confirmation = understanding.reference_understanding_confirmation || understanding.understanding_confirmation || understanding.confirmation || {};
    const confirmed = understanding.understanding_confirmed === true || understanding.authoritative_input_confirmed === true
      || confirmation.confirmed === true || ['confirmed', 'authoritative_input'].includes(String(confirmation.status || confirmation.confirmation || '').toLowerCase());
    if (hasUnderstanding && !confirmed) return { blocked: true, label: '先确认上方参考理解' };
    return { blocked: false, label: `下一步：生成${output}` };
  }
  if (status === 'failed' && String(reference.error_code || reference.error?.code || '') === 'REFERENCE_VIDEO_EXTENDED_ANALYSIS_CONFIRMATION_REQUIRED') {
    return { blocked: true, label: '先确认参考视频分批分析' };
  }
  if (status === 'failed') return { blocked: true, label: '参考视频分析失败，请重试' };
  if (status === 'cancelled') return { blocked: true, label: '参考视频分析已停止，请更换' };
  if (status === 'completed') return { blocked: true, label: '分析结果不完整，请重试' };
  return { blocked: true, label: '等待参考视频分析完成' };
}

export function syncReferenceAction(button, reference = {}, contentMode = '') {
  if (!button) return;
  const action = referenceActionState(reference, contentMode);
  button.disabled = action.blocked;
  button.textContent = action.label;
}

export function referenceNextStepDescription(reference = {}, action = {}, contentMode = '') {
  const output = contentMode === 'commercial_subject' ? '广告脚本' : '剧情与对白';
  if (action.blocked === false) return `先生成可编辑的${output}；确认后再提取制作主体与场景。`;
  const status = String(reference.status || '').toLowerCase();
  if (status === 'completed' && reference.analysis_valid === true) return `先确认参考理解；成功后自动生成${output}。`;
  if (status === 'failed' || status === 'cancelled' || status === 'completed') return '参考识别不可用，请按上方提示重试或更换。';
  return '参考分析中；完成并确认后自动继续。';
}
