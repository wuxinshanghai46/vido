import { escapeHtml } from '../components/ui.js?v=20260830-production-v289f';

export function modeLabel(value = '') {
  return value === 'commercial_subject' ? '商业广告' : (value === 'narrative_story' ? '剧情短片' : '待确认');
}

const IDEA_SECTION_MARKER = /(?:^|\n)\s*(?:【?(?:详细剧情描述|剧情表达补充|出场人物|主要场景|剧情段落|结尾|主题|人物设定|场景设定)】?|#{1,4}\s*(?:剧情|人物|场景))/i;

export function briefIdeaPreview(value = '', max = 420) {
  const full = String(value || '').trim();
  if (!full) return { text: '', full: '', collapsed: false };
  const sectionIndex = full.search(IDEA_SECTION_MARKER);
  const source = sectionIndex > 80 ? full.slice(0, sectionIndex).trim() : full;
  const text = source.length > max ? `${source.slice(0, max).trim()}…` : source;
  return { text, full, collapsed: text !== full };
}

export function ideaMarkup(value = '', location = 'conversation') {
  const preview = briefIdeaPreview(value, location === 'contract' ? 180 : 420);
  if (!preview.text) return '<em>等待你的描述</em>';
  return `<p>${escapeHtml(preview.text)}</p>${preview.collapsed ? `<details class="brief-idea-details"><summary>查看完整设想</summary><div>${escapeHtml(preview.full)}</div></details>` : ''}`;
}

export function normalizedDialogueHistory(value = []) {
  return (Array.isArray(value) ? value : []).map((item, index) => ({
    id: String(item?.id || `dialogue_${index + 1}`), seq: index + 1,
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    content: String(item?.content || '').trim().slice(0, 1200),
    topic: String(item?.topic || '').trim().slice(0, 40),
    selected_answer: item?.selected_answer === true,
    selected_value: String(item?.selected_value || '').trim().slice(0, 300),
    suggested_answers: (Array.isArray(item?.suggested_answers) ? item.suggested_answers : []).map(value => String(value || '').trim().slice(0, 300)).filter(Boolean).slice(0, 6),
    interaction_type: String(item?.interaction_type || (item?.suggested_answers?.length ? 'choice' : 'text')).slice(0, 40),
    answered: item?.answered === true || Boolean(item?.selected_value),
    created_at: String(item?.created_at || ''),
  })).filter(item => item.content).slice(-60);
}

export function recordDialogueHistory(history, role, content, { topic = '', selectedAnswer = false, selectedValue = '', suggestedAnswers = [], interactionType = '' } = {}) {
  const text = String(content || '').trim();
  if (!text) return history;
  const previous = history.at(-1);
  if (previous?.role === role && previous?.content === text && previous?.topic === topic) return history;
  const id = globalThis.crypto?.randomUUID?.() || `dialogue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return normalizedDialogueHistory([...history, {
    id, role, content: text, topic, selected_answer: selectedAnswer, selected_value: selectedValue,
    suggested_answers: suggestedAnswers, interaction_type: interactionType || (suggestedAnswers.length ? 'choice' : 'text'), answered: Boolean(selectedValue), created_at: new Date().toISOString(),
  }]);
}

export function dialogueHistoryMarkup(value = []) {
  return normalizedDialogueHistory(value).map(item => `<article class="brief-message ${item.role === 'user' ? 'is-user' : 'is-assistant'}" data-dialogue-message-id="${escapeHtml(item.id)}"><span class="brief-message-avatar">${item.role === 'user' ? '你' : '导'}</span><div><small>${item.role === 'user' ? '你' : '导演助理'}</small><div class="brief-bubble"><p>${escapeHtml(item.content)}</p>${item.suggested_answers.length ? `<div class="brief-quick-actions is-history">${item.suggested_answers.map(answer => `<button type="button" disabled${answer === item.selected_value ? ' class="is-selected"' : ''}>${escapeHtml(answer)}</button>`).join('')}</div>` : ''}</div></div></article>`).join('');
}

export function appendDialogueSuggestions(entry, answers = [], { isSending, onSelect } = {}) {
  const values = [...new Set((Array.isArray(answers) ? answers : []).map(value => String(value || '').trim()).filter(Boolean))].slice(0, 3);
  if (!entry?.article || values.length < 2) return;
  const actions = document.createElement('div');
  actions.className = 'brief-quick-actions brief-dialogue-suggestions';
  actions.dataset.dialogueSuggestions = '';
  values.forEach(value => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = value;
    button.addEventListener('click', () => { if (!isSending?.()) onSelect?.(value); });
    actions.appendChild(button);
  });
  entry.article.lastElementChild?.appendChild(actions);
}

export function contextualDialogueFallback(mode, ready) {
  if (!ready) return mode === 'narrative_story' ? '发生什么事后，人物不得不面对这场冲突？' : '你最希望观众看完后记住什么？';
  return '请选择成片时长、画幅和清晰度。';
}
