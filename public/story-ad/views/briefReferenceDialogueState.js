import { followConversationAfter } from './briefConversationScroll.js?v=20260904-production-v472';

export function referenceDialogueStatus(reference = {}) {
  const status = String(reference.status || '').toLowerCase();
  if (!reference.analysis_id && !['importing', 'uploading', 'queued', 'running'].includes(status)) return '';
  const progress = Math.max(0, Math.min(100, Number(reference.progress || 0) || 0));
  const phase = String(reference.phase || '').trim();
  const error = String(reference.error?.message || reference.error || '').trim();
  const errorCode = String(reference.error_code || reference.error?.code || '');
  const preflight = reference.analysis_preflight && typeof reference.analysis_preflight === 'object'
    ? reference.analysis_preflight
    : {};
  if (status === 'completed' && reference.analysis_valid === true) return '参考视频分析完成，已把识别结果同步到当前项目。请先核对参考理解，再继续生成。';
  if (status === 'completed') return '参考视频已读取完成，但分析结果不完整。请重新识别或更换参考视频。';
  if (status === 'failed' && errorCode === 'REFERENCE_VIDEO_EXTENDED_ANALYSIS_CONFIRMATION_REQUIRED') {
    return `参考视频已免费预检：检测到 ${Number(preflight.segment_count || 0)} 个片段，需要 ${Number(preflight.batch_count || 0)} 批完整读取；尚未启动付费模型，请使用下方确认按钮继续。`;
  }
  if (status === 'failed') {
    const limitClarification = /访问量过大|RATE_LIMIT/i.test(error)
      ? '这是视觉供应商限流，不是视频内容或信息量过大。'
      : '';
    return `参考视频分析失败：${error || '未取得可用结果，请重试或更换链接。'}${limitClarification}你仍可继续输入修改设想，或使用下方按钮停止、跳过、更换或稍后重试。`;
  }
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
  followConversationAfter(conversation, () => {
    if (!article) {
      article = document.createElement('article');
      article.className = 'brief-message is-assistant';
      article.dataset.referenceDialogueStatus = '';
      article.innerHTML = '<span class="brief-message-avatar">导</span><div><small>导演助理 · 参考分析</small><div class="brief-bubble"><p></p></div></div>';
      conversation.appendChild(article);
    }
    article.querySelector('.brief-bubble p').textContent = text;
    article.dataset.referenceStatus = String(reference.status || '').toLowerCase();
  });
  return article;
}

export function createReferenceLinkDialogueHandler({ onReferenceLink, message, onAttached, sync }) {
  return async ({ url = '', echoUser = true } = {}) => {
    let pending = null;
    try {
      const result = await onReferenceLink?.({ providedUrl: url, onStart: () => {
        if (echoUser) message('user', '已提交参考链接');
        pending = message('assistant', '正在读取链接并建立参考分析任务，请稍候…');
        pending.article.dataset.referenceDialogueStatus = '';
      } });
      if (!result || result.cancelled === true) {
        if (!echoUser) message('assistant', '已识别到参考链接；本次尚未开始读取，确认拥有分析与使用权后即可继续。');
        return result;
      }
      onAttached?.();
      const text = referenceDialogueStatus(result.analysis || { analysis_id: 'pending', status: 'importing' });
      // Keep the live subscriber authoritative over the initial 202 snapshot.
      if (pending && !pending.article.dataset.referenceStatus) pending.textNode.textContent = text;
      sync?.();
      return result;
    } catch (error) {
      const requestId = String(error?.data?.request_id || '').trim();
      const text = `参考链接未能开始分析：${error?.message || '请求失败，请重试。'}${requestId ? `（请求编号：${requestId}）` : ''}`;
      if (pending) pending.textNode.textContent = text;
      else message('assistant', text);
      return { failed: true, error };
    }
  };
}

export function referenceInputIntent(text = '') {
  const source = String(text || '').trim();
  const url = String(source.match(/https?:\/\/[^\s<>"']+/iu)?.[0] || '').replace(/[，。！？；、,!;?]+$/u, '').replace(/[)\]}）】》]+$/u, '');
  if (url) return { kind: 'link', url };
  const offersMaterial = /(?:我|这边|手上)?\s*(?:有|准备了|可以提供|要上传|想上传|发给你|给你)\s*(?:一个|一段|一份|份)?\s*(?:参考)?\s*(?:视频|视频素材|视频文件|链接)|(?:上传|添加|提供|使用)\s*(?:这个|一个|一段)?\s*(?:参考视频|视频素材|视频文件)/u.test(source);
  return offersMaterial ? { kind: 'material', preferred: /链接/u.test(source) ? 'link' : 'upload' } : { kind: '' };
}

export async function routeReferenceInput({ text = '', message, history, referenceLinkDialogue, panel, send, input, sync, showChoices }) {
  const intent = referenceInputIntent(text);
  if (!intent.kind) return false;
  message('user', text);
  history.push({ role: 'user', content: text });
  const finish = () => {
    send.disabled = false;
    panel.removeAttribute('aria-busy');
    sync();
    input.focus();
  };
  if (intent.kind === 'link') {
    try { await referenceLinkDialogue({ url: intent.url, echoUser: false }); } finally { finish(); }
  } else {
    finish();
    await showChoices();
  }
  return true;
}

export function referenceNextStepDescription(reference = {}, action = {}, contentMode = '') {
  const output = contentMode === 'commercial_subject' ? '广告脚本' : '剧情与对白';
  if (action.blocked === false) return `先生成可编辑的${output}；确认后再提取制作主体与场景。`;
  const status = String(reference.status || '').toLowerCase();
  if (status === 'completed' && reference.analysis_valid === true) return `先确认参考理解；成功后自动生成${output}。`;
  if (status === 'failed' || status === 'cancelled' || status === 'completed') return '参考识别不可用，请按上方提示重试或更换。';
  return '参考分析中；完成并确认后自动继续。';
}
