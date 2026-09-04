import { BRIEF_DURATION_OPTIONS, durationLabel } from './briefDurationOptions.js?v=20260904-production-v465';

export function specificationQuestionText({ mode = '', duration = 30, ratio = '9:16', resolution = '480p' } = {}) {
  const kind = mode === 'commercial_subject' ? '这条广告' : '这个故事';
  return `${kind}的创作内容已经问完。建议成片采用 ${durationLabel(duration)}、${ratio}、${resolution}。你可以直接确认，也可以在这里调整后确认。`;
}

const optionsList = (values, current, label = value => value) => values.map(value => `<option value="${value}"${value === current ? ' selected' : ''}>${label(value)}</option>`).join('');

export function mountSpecificationQuestion(conversation, options = {}) {
  const article = document.createElement('article');
  const find = selector => article.querySelector(selector);
  article.className = 'brief-message is-assistant';
  article.dataset.specificationQuestion = '';
  article.innerHTML = `<span class="brief-message-avatar">导</span><div><small>导演助理</small><div class="brief-bubble"><p></p></div><div class="brief-quick-actions" data-spec-actions><button type="button" data-spec-choice="confirm">确认当前规格</button><button type="button" data-spec-choice="adjust">调整规格</button></div><div class="brief-inline-specification" data-spec-editor hidden><label>时长<select data-spec-duration>${optionsList(BRIEF_DURATION_OPTIONS, Number(options.duration || 30), durationLabel)}</select></label><label>画幅<select data-spec-ratio>${optionsList(['9:16', '16:9', '1:1'], options.ratio || '9:16')}</select></label><label>清晰度<select data-spec-resolution>${optionsList(['480p', '720p', '1080p', '4K'], options.resolution || '480p')}</select></label><button type="button" data-spec-choice="apply">确认调整</button></div></div>`;
  find('.brief-bubble p').textContent = specificationQuestionText(options);
  conversation.appendChild(article);
  find('[data-spec-choice="confirm"]')?.addEventListener('click', () => {
    article.querySelectorAll('button').forEach(button => { button.disabled = true; });
    options.onConfirm?.();
  });
  find('[data-spec-choice="adjust"]')?.addEventListener('click', () => {
    find('[data-spec-actions]').hidden = true;
    find('[data-spec-editor]').hidden = false;
    conversation.scrollTop = conversation.scrollHeight;
  });
  find('[data-spec-choice="apply"]')?.addEventListener('click', () => {
    article.querySelectorAll('button,select').forEach(control => { control.disabled = true; });
    options.onAdjust?.({
      duration: Number(find('[data-spec-duration]')?.value || options.duration || 30),
      ratio: String(find('[data-spec-ratio]')?.value || options.ratio || '9:16'),
      resolution: String(find('[data-spec-resolution]')?.value || options.resolution || '480p'),
    });
  });
  conversation.scrollTop = conversation.scrollHeight;
  return article;
}
