import { escapeHtml } from '../components/ui.js?v=20260821-guided-workspace-v102';

function modeLabel(value = '') {
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

function ideaMarkup(value = '', location = 'conversation') {
  const preview = briefIdeaPreview(value, location === 'contract' ? 180 : 420);
  if (!preview.text) return '<em>等待你的描述</em>';
  return `<p>${escapeHtml(preview.text)}</p>${preview.collapsed ? `<details class="brief-idea-details"><summary>查看完整设想</summary><div>${escapeHtml(preview.full)}</div></details>` : ''}`;
}

export function briefDialogueMarkup(bundle = {}, route = {}) {
  const brief = bundle.brief || {};
  const hasIdea = Boolean(String(brief.text || '').trim());
  return `<section class="brief-dialogue" data-brief-dialogue>
    <div class="brief-conversation-panel">
      <header class="brief-conversation-head"><span class="brief-director-avatar">导</span><div><h1>导演助理</h1><p><i></i>在线 · 先把想法整理成可执行剧情</p></div><span class="brief-stage-chip">第 1 步 · 对话立项</span></header>
      <div class="brief-conversation-scroll" data-brief-conversation aria-live="polite">
        <article class="brief-message is-assistant"><span class="brief-message-avatar">导</span><div><small>导演助理</small><div class="brief-bubble"><b>${route.isNew ? '先聊聊你想做什么。' : '我已读取这个项目的设想。'}</b><p>${route.isNew ? '你不需要先填一整页表单。我会逐步确认内容类型、核心想法和成片规格，再先生成详细剧情与对白。' : '你可以继续补充或纠正；确认后会先进入剧情与对白，不会提前生成人物图片或视频。'}</p></div>${!hasIdea ? `<div class="brief-quick-actions"><button type="button" data-dialogue-mode="commercial_subject">我要做商业广告</button><button type="button" data-dialogue-mode="narrative_story">我要做剧情短片</button></div>` : ''}</div></article>
        ${hasIdea ? `<article class="brief-message is-user"><span class="brief-message-avatar">你</span><div><small>当前设想</small><div class="brief-bubble" data-dialogue-current-idea>${ideaMarkup(brief.text, 'conversation')}</div></div></article>` : ''}
      </div>
      <footer class="brief-composer"><label data-dialogue-context>${hasIdea ? '继续补充或修改核心设想' : '先选择类型，也可以直接描述你的想法'}</label><div><button type="button" class="brief-attach" data-dialogue-reference title="添加参考材料">＋</button><textarea rows="2" data-dialogue-input placeholder="例如：做一条30秒不锈钢品牌广告，突出佛山制造、耐腐蚀和高端科技感…"></textarea><button type="button" class="brief-send" data-dialogue-send>发送</button></div><button type="button" class="brief-edit-history" data-open-history-edit data-history-safe>这一步已确认；需要修改时点这里开启编辑</button><small>AI 建议会单独标记，不会静默覆盖你已确认的内容</small></footer>
    </div>
    <aside class="brief-contract-panel">
      <header><div><small>实时结构化</small><h2>项目确认单</h2></div><span>草稿</span></header>
      <div class="brief-contract-progress"><i><b data-dialogue-progress></b></i><strong data-dialogue-progress-text>20%</strong></div>
      <p class="brief-contract-hint">对话内容会自动同步到这里。项目名称可由系统建议，也可在“手动编辑全部设置”中修改。</p>
      <section><h3>基础信息</h3><dl><div><dt>项目名称</dt><dd data-contract-name>待根据创意命名</dd></div><div><dt>内容类型</dt><dd data-contract-mode>${escapeHtml(modeLabel(brief.content_mode_source === 'user' ? brief.content_mode : ''))}</dd></div><div class="wide"><dt>核心创意</dt><dd data-contract-idea>${ideaMarkup(brief.text, 'contract')}</dd></div></dl></section>
      <section><h3>成片规格</h3><dl class="triple"><div><dt>时长</dt><dd data-contract-duration>${Number(brief.target_duration || 30)}秒 <i>建议</i></dd></div><div><dt>画幅</dt><dd data-contract-ratio>${escapeHtml(brief.output_ratio || '9:16')} <i>建议</i></dd></div><div><dt>清晰度</dt><dd data-contract-resolution>${escapeHtml(brief.video_resolution || '1080p')}</dd></div></dl></section>
      <section><h3>信息依据</h3><div class="brief-evidence"><span class="user">用户明确</span><b data-contract-user>${hasIdea ? 2 : 0} 项</b></div><div class="brief-evidence"><span class="ai">AI 建议</span><b>3 项</b></div><div class="brief-evidence"><span class="pending">等待确认</span><b data-contract-pending>${hasIdea ? 2 : 5} 项</b></div></section>
      <button class="brief-confirm-concept" type="button" data-dialogue-confirm disabled>确认设想，生成剧情与对白</button>
      <button class="brief-professional" type="button" data-dialogue-professional>手动编辑全部设置</button>
    </aside>
  </section>`;
}

export function referenceNextStepDescription(reference = {}, action = {}) {
  if (action.blocked === false) return '先生成可编辑的详细剧情与对白；确认剧情后再提取人物与场景。';
  const status = String(reference.status || '').toLowerCase();
  if (status === 'completed' && reference.analysis_valid === true) return '先确认参考理解；成功后自动生成剧情与对白。';
  if (status === 'failed' || status === 'cancelled' || status === 'completed') return '参考识别不可用，请按上方提示重试或更换。';
  return '参考分析中；完成并确认后自动继续。';
}

export function dialogueIntakeState({ name = '', mode = '', idea = '', referenceAttached = false, referenceSkipped = false } = {}) {
  const missing = [];
  if (!mode) missing.push('mode');
  if (!idea) missing.push('idea');
  if (idea && !referenceAttached && !referenceSkipped) missing.push('reference');
  if (!name) missing.push('name');
  return {
    ready: Boolean(name && mode && idea && (referenceAttached || referenceSkipped)),
    missing,
    next: missing[0] || '',
  };
}

export function bindBriefDialogue(host, { form, referenceAttached = false, onConfirm, onReference, onReferenceLink } = {}) {
  const panel = host.querySelector('[data-brief-dialogue]');
  if (!panel || !form) return () => {};
  const conversation = panel.querySelector('[data-brief-conversation]');
  const input = panel.querySelector('[data-dialogue-input]');
  const confirm = panel.querySelector('[data-dialogue-confirm]');
  const control = name => form.elements.namedItem(name);
  const dispatch = element => element?.dispatchEvent(new Event('input', { bubbles: true }));
  const message = (role, text) => {
    const article = document.createElement('article');
    article.className = `brief-message ${role === 'user' ? 'is-user' : 'is-assistant'}`;
    article.innerHTML = `<span class="brief-message-avatar">${role === 'user' ? '你' : '导'}</span><div><small>${role === 'user' ? '你' : '导演助理'}</small><div class="brief-bubble"><p>${escapeHtml(text)}</p></div></div>`;
    conversation.appendChild(article);
    conversation.scrollTop = conversation.scrollHeight;
  };
  let referenceSkipped = false;
  let referenceQuestionLoading = false;
  const appendReferenceQuestion = async () => {
    if (referenceQuestionLoading || conversation.querySelector('[data-reference-question]') || referenceAttached || referenceSkipped) return;
    referenceQuestionLoading = true;
    const { mountReferenceQuestion } = await import('./briefReferenceQuestion.js?v=20260821-guided-workspace-v102');
    mountReferenceQuestion(conversation, { onReference, onReferenceLink, onSkip: () => {
      referenceSkipped = true;
      message('user', '没有参考材料，继续');
      message('assistant', '好的。我会按你已经明确的内容整理，不会把默认值伪装成你的选择。请核对右侧确认单。');
      sync();
    } });
    referenceQuestionLoading = false;
  };
  const sync = () => {
    const name = String(control('project_name')?.value || '').trim();
    const mode = String(control('content_mode')?.value || '');
    const idea = String(control('brief')?.value || '').trim();
    const duration = Number(control('target_duration')?.value || 30) || 30;
    const ratio = String(control('output_ratio')?.value || '9:16');
    const resolution = String(control('video_resolution')?.value || '1080p');
    const intake = dialogueIntakeState({ name, mode, idea, referenceAttached, referenceSkipped });
    const ready = intake.ready;
    const progress = ready ? 100 : (idea ? 78 : (mode ? 38 : 20));
    panel.querySelector('[data-contract-name]').textContent = name || '待根据创意命名';
    panel.querySelector('[data-contract-mode]').textContent = modeLabel(mode);
    panel.querySelector('[data-contract-idea]').innerHTML = ideaMarkup(idea, 'contract');
    panel.querySelector('[data-contract-duration]').textContent = `${duration}秒`;
    panel.querySelector('[data-contract-ratio]').textContent = ratio;
    panel.querySelector('[data-contract-resolution]').textContent = resolution;
    panel.querySelector('[data-contract-user]').textContent = `${[mode, idea, name].filter(Boolean).length} 项`;
    panel.querySelector('[data-contract-pending]').textContent = `${intake.missing.length} 项`;
    panel.querySelector('[data-dialogue-progress]').style.width = `${progress}%`;
    panel.querySelector('[data-dialogue-progress-text]').textContent = `${progress}%`;
    confirm.disabled = !ready;
    if (idea && intake.next === 'reference') appendReferenceQuestion();
  };
  panel.querySelectorAll('[data-dialogue-mode]').forEach(button => button.addEventListener('click', () => {
    const mode = button.dataset.dialogueMode;
    control('content_mode').value = mode;
    control('content_mode').dispatchEvent(new Event('change', { bubbles: true }));
    panel.querySelectorAll('[data-dialogue-mode]').forEach(item => { item.disabled = true; });
    message('user', button.textContent.trim());
    message('assistant', mode === 'commercial_subject'
      ? '好的。请说清楚产品或服务、最想证明的价值，以及希望观众记住什么。'
      : '好的。请告诉我主要人物、发生了什么，以及你想让观众感受到什么。');
    input.focus();
    sync();
  }));
  const submit = async () => {
    const text = input.value.trim();
    if (!text) return;
    const explicitSettings = await import('./briefExplicitSettings.js?v=20260821-guided-workspace-v102');
    input.value = '';
    let mode = String(control('content_mode')?.value || '');
    if (!mode) {
      mode = /剧情|故事|短剧|人物/.test(text) ? 'narrative_story' : 'commercial_subject';
      control('content_mode').value = mode;
      control('content_mode').dispatchEvent(new Event('change', { bubbles: true }));
    }
    const previous = String(control('brief')?.value || '').trim();
    control('brief').value = previous ? `${previous}\n${text}` : text;
    dispatch(control('brief'));
    if (!String(control('project_name')?.value || '').trim()) {
      control('project_name').value = explicitSettings.suggestedName(text, mode);
      dispatch(control('project_name'));
    }
    const explicit = explicitSettings.extractExplicitBriefSettings(text);
    Object.entries(explicit).forEach(([name, value]) => {
      const field = control(name);
      if (!field) return;
      if (field.options && ![...field.options].some(option => String(option.value || option.textContent) === String(value))) return;
      field.value = String(value);
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    message('user', text);
    const recognized = Object.keys(explicit).length
      ? `并识别到你明确写出的${[explicit.target_duration && `${explicit.target_duration}秒`, explicit.output_ratio, explicit.video_resolution, explicit.world_period, explicit.world_region].filter(Boolean).join('、')}等设置。`
      : '';
    message('assistant', `已整理到确认单，${recognized}我只会继续追问会影响结果且尚未明确的内容。`);
    sync();
  };
  panel.querySelector('[data-dialogue-send]')?.addEventListener('click', submit);
  input?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
  });
  panel.querySelector('[data-dialogue-professional]')?.addEventListener('click', () => {
    const details = host.querySelector('[data-brief-settings]');
    if (details) { details.open = true; details.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  panel.querySelector('[data-open-history-edit]')?.addEventListener('click', event => {
    const unlock = host.querySelector('[data-unlock-history-step]');
    if (unlock) unlock.click();
    else {
      event.currentTarget.hidden = true;
      input?.focus();
    }
  });
  panel.querySelector('[data-dialogue-reference]')?.addEventListener('click', () => onReference?.());
  confirm?.addEventListener('click', () => onConfirm?.(confirm));
  form.addEventListener('input', sync);
  form.addEventListener('change', sync);
  sync();
  return () => {
    form.removeEventListener('input', sync);
    form.removeEventListener('change', sync);
  };
}

export function bindBriefDialogueWorkflow(host, { form, referenceAttached, ensureProject, proceed, onReference, onReferenceLink, onError } = {}) {
  return bindBriefDialogue(host, {
    form,
    referenceAttached,
    onReference,
    onReferenceLink,
    onConfirm: async button => {
      try { await ensureProject(button); await proceed(button); } catch (error) { onError?.(error, button); }
    },
  });
}
