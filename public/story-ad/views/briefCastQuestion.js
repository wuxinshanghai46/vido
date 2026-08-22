const INTENTS = {
  presenter_customer: {
    label: '设计师向客户现场介绍（2 人出镜）',
    intent: {
      confirmed: true, mode: 'dual', expected_people: 2, source: 'user_dialogue',
      participants: [
        { id: 'presenter', role: '空间设计师 / 讲解者', gender: 'unknown', age_range: '28~40岁', on_screen: true },
        { id: 'customer', role: '客户 / 采购方', gender: 'unknown', age_range: '30~50岁', on_screen: true },
      ],
    },
  },
  presenter_only: {
    label: '设计师单人介绍（1 人出镜）',
    intent: {
      confirmed: true, mode: 'single', expected_people: 1, source: 'user_dialogue',
      participants: [{ id: 'presenter', role: '空间设计师 / 讲解者', gender: 'unknown', age_range: '28~40岁', on_screen: true }],
    },
  },
  audience_only: {
    label: '客户只是受众，不在画面中出镜',
    intent: { confirmed: true, mode: 'no_human', expected_people: 0, source: 'user_dialogue', participants: [] },
  },
};

export function castQuestionText() {
  return '目标客户需要在画面中实际出镜吗？这会直接决定人物数量和后续人物资产。';
}

export function castChoices() {
  return Object.entries(INTENTS).map(([id, config]) => ({ id, label: config.label, cast_intent: structuredClone(config.intent) }));
}

export function mountCastQuestion(conversation, { onSelect } = {}) {
  const article = document.createElement('article');
  article.className = 'brief-message is-assistant';
  article.dataset.castQuestion = '';
  article.innerHTML = `<span class="brief-message-avatar">导</span><div><small>导演助理</small><div class="brief-bubble"><p>${castQuestionText()}</p></div><div class="brief-quick-actions"></div></div>`;
  const actions = article.querySelector('.brief-quick-actions');
  Object.entries(INTENTS).forEach(([key, config]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.castChoice = key;
    button.textContent = config.label;
    button.addEventListener('click', () => {
      article.querySelectorAll('button').forEach(control => { control.disabled = true; });
      onSelect?.({ key, label: config.label, intent: structuredClone(config.intent) });
    });
    actions.appendChild(button);
  });
  conversation.appendChild(article);
  conversation.scrollTop = conversation.scrollHeight;
  return article;
}
