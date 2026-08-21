export function referenceDialogueStatus(reference = {}) {
  const status = String(reference.status || '').toLowerCase();
  if (!reference.analysis_id && !['importing', 'uploading', 'queued', 'running'].includes(status)) return '';
  const progress = Math.max(0, Math.min(100, Number(reference.progress || 0) || 0));
  const phase = String(reference.phase || '').trim();
  const error = String(reference.error?.message || reference.error || '').trim();
  if (status === 'completed' && reference.analysis_valid === true) return '参考视频分析完成，已把识别结果同步到当前项目。请先核对参考理解，再继续生成。';
  if (status === 'completed') return '参考视频已读取完成，但分析结果不完整。请重新识别或更换参考视频。';
  if (status === 'failed') return `参考视频分析失败：${error || '未取得可用结果，请重试或更换链接。'}`;
  if (status === 'cancelled') return '参考视频分析已停止。如仍需使用，请重新添加链接或上传视频。';
  if (status === 'sync_interrupted') return `参考分析仍在服务器继续，页面暂时无法取得最新进度：${error || '请稍后重试。'}`;
  return `${phase || '正在读取并分析参考视频'}${progress ? `（${progress}%）` : ''}。结果会继续显示在本对话中。`;
}

export function syncReferenceDialogueStatus(host, reference = {}) {
  const text = referenceDialogueStatus(reference);
  if (!text) return null;
  const conversation = host.querySelector('[data-brief-conversation]');
  if (!conversation) return null;
  let article = conversation.querySelector('[data-reference-dialogue-status]');
  if (!article) {
    article = document.createElement('article');
    article.className = 'brief-message is-assistant';
    article.dataset.referenceDialogueStatus = '';
    article.innerHTML = '<span class="brief-message-avatar">导</span><div><small>导演助理 · 参考分析</small><div class="brief-bubble"><p></p></div></div>';
    conversation.appendChild(article);
  }
  article.querySelector('.brief-bubble p').textContent = text;
  article.dataset.referenceStatus = String(reference.status || '').toLowerCase();
  conversation.scrollTop = conversation.scrollHeight;
  return article;
}

export function createReferenceLinkDialogueHandler({ onReferenceLink, message, onAttached, sync }) {
  return async () => {
    let pending = null;
    try {
      const result = await onReferenceLink?.({ onStart: () => {
        message('user', '已提交参考链接');
        pending = message('assistant', '正在读取链接并建立参考分析任务，请稍候…');
        pending.article.dataset.referenceDialogueStatus = '';
      } });
      if (!result || result.cancelled === true) return;
      onAttached?.();
      const text = referenceDialogueStatus(result.analysis || { analysis_id: 'pending', status: 'importing' });
      if (pending) pending.textNode.textContent = text;
      sync?.();
    } catch (error) {
      const requestId = String(error?.data?.request_id || '').trim();
      const text = `参考链接未能开始分析：${error?.message || '请求失败，请重试。'}${requestId ? `（请求编号：${requestId}）` : ''}`;
      if (pending) pending.textNode.textContent = text;
      else message('assistant', text);
    }
  };
}

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
