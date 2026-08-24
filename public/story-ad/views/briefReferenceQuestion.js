export function referenceQuestionText({ mode = '', idea = '' } = {}) {
  const subject = String(idea || '').replace(/\s+/g, ' ').trim().slice(0, 54);
  if (mode === 'commercial_subject') return `针对${subject ? `“${subject}”` : '这条广告'}，有没有产品实拍、品牌视觉、竞品视频或镜头节奏参考？有的话可直接添加；没有也请明确告诉我。`;
  if (mode !== 'narrative_story') return '可以，直接在这里上传参考视频或添加公开链接；系统会把识别进度和结果继续显示在本对话中。';
  const referenceTypes = /机器人|机械人|仿生人|人工智能/u.test(subject)
    ? '青年年龄变化、机器人外观、生活空间、影片画面或镜头'
    : (/古代|古装|朝代|王朝/u.test(subject) ? '人物服饰、时代空间、影片画面或镜头' : '人物形象、生活环境、影片画面或镜头');
  return `针对${subject ? `“${subject}”` : '这个故事'}，有没有希望对齐的${referenceTypes}参考？有的话可直接添加；没有也请明确告诉我。`;
}

export function mountReferenceQuestion(conversation, { onReference, onReferenceLink, onSkip, mode = '', idea = '' } = {}) {
  const article = document.createElement('article');
  article.className = 'brief-message is-assistant';
  article.dataset.referenceQuestion = '';
  article.innerHTML = '<span class="brief-message-avatar">导</span><div><small>导演助理</small><div class="brief-bubble"><p></p></div><div class="brief-quick-actions"><button type="button" data-reference-choice="upload">上传视频</button><button type="button" data-reference-choice="link">添加链接</button><button type="button" data-reference-choice="none">没有</button></div></div>';
  article.querySelector('.brief-bubble p').textContent = referenceQuestionText({ mode, idea });
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
