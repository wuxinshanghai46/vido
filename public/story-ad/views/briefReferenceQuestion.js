export function mountReferenceQuestion(conversation, { onReference, onReferenceLink, onSkip } = {}) {
  const article = document.createElement('article');
  article.className = 'brief-message is-assistant';
  article.dataset.referenceQuestion = '';
  article.innerHTML = '<span class="brief-message-avatar">导</span><div><small>导演助理</small><div class="brief-bubble"><p>有参考视频或链接吗？有的话可以直接添加，没有也可以继续。</p></div><div class="brief-quick-actions"><button type="button" data-reference-choice="upload">上传视频</button><button type="button" data-reference-choice="link">添加链接</button><button type="button" data-reference-choice="none">没有，继续</button></div></div>';
  conversation.appendChild(article);
  article.querySelector('[data-reference-choice="upload"]')?.addEventListener('click', () => onReference?.());
  article.querySelector('[data-reference-choice="link"]')?.addEventListener('click', () => onReferenceLink?.());
  article.querySelector('[data-reference-choice="none"]')?.addEventListener('click', () => {
    article.querySelectorAll('button').forEach(button => { button.disabled = true; });
    onSkip?.();
  });
  conversation.scrollTop = conversation.scrollHeight;
  return article;
}
