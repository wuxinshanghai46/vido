function durationLabel(seconds = 30) {
  const value = Number(seconds || 30) || 30;
  if (value % 60 === 0) return `${value / 60} 分钟`;
  if (value > 60) return `${Math.floor(value / 60)} 分 ${value % 60} 秒`;
  return `${value} 秒`;
}

export function specificationQuestionText({ mode = '', duration = 30, ratio = '9:16', resolution = '1080p' } = {}) {
  const kind = mode === 'commercial_subject' ? '这条广告' : '这个故事';
  return `${kind}的核心内容已经明确。成片规格建议先按 ${durationLabel(duration)}、${ratio}、${resolution}；是否采用？也可以直接回复要修改的时长、画幅或清晰度。`;
}

export function mountSpecificationQuestion(conversation, options = {}) {
  const article = document.createElement('article');
  article.className = 'brief-message is-assistant';
  article.dataset.specificationQuestion = '';
  article.innerHTML = `<span class="brief-message-avatar">导</span><div><small>导演助理</small><div class="brief-bubble"><p></p></div><div class="brief-quick-actions"><button type="button" data-specification-choice="confirm">确认当前规格</button><button type="button" data-specification-choice="adjust">调整规格</button></div></div>`;
  article.querySelector('.brief-bubble p').textContent = specificationQuestionText(options);
  conversation.appendChild(article);
  article.querySelector('[data-specification-choice="confirm"]')?.addEventListener('click', () => {
    article.querySelectorAll('button').forEach(button => { button.disabled = true; });
    options.onConfirm?.();
  });
  article.querySelector('[data-specification-choice="adjust"]')?.addEventListener('click', () => options.onAdjust?.());
  conversation.scrollTop = conversation.scrollHeight;
  return article;
}
