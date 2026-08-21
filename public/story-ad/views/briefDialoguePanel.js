import { escapeHtml } from '../components/ui.js?v=20260821-dialogue-interaction-v112';

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
        ${hasIdea ? `<article class="brief-message is-user"><span class="brief-message-avatar">你</span><div><small>当前设想</small><div class="brief-bubble" data-dialogue-current-idea>${ideaMarkup(brief.text, 'conversation')}</div></div></article>` : ''}
      </div>
      <footer class="brief-composer"><label><span data-dialogue-context>${hasIdea ? '继续补充或修改核心设想' : '直接说说你想做什么，由你发起对话'}</span><button type="button" data-dialogue-expand aria-expanded="false">展开输入</button></label><div><button type="button" class="brief-attach" data-dialogue-reference title="添加参考材料">＋</button><textarea rows="2" data-dialogue-input placeholder="输入你的想法；内容较多时可拖动右下角，或点击“展开输入”…"></textarea><button type="button" class="brief-send" data-dialogue-send>发送</button></div><small>导演助理会结合你刚说的内容逐步回应；高级设置不会变成固定问卷</small></footer>
    </div>
    <aside class="brief-contract-panel">
      <header><div><small>实时结构化</small><h2>项目确认单</h2></div><span>草稿</span></header>
      <div class="brief-contract-progress"><i><b data-dialogue-progress></b></i><strong data-dialogue-progress-text>0%</strong></div>
      <ol class="brief-contract-checklist" aria-label="立项准备度依据"><li data-progress-item="mode">内容类型 20%</li><li data-progress-item="idea">核心内容 40%</li><li data-progress-item="name">项目名称 10%</li><li data-progress-item="reference">参考决定 20%</li><li data-progress-item="confirm">最终确认 10%</li></ol>
      <p class="brief-contract-hint">对话内容会自动同步到这里。这是立项准备度，不是高级设置完成度；只计算内容类型、核心内容、项目名称、参考决定和最终确认。</p>
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

export function dialogueIntakeState({ name = '', mode = '', idea = '', ideaReady, referenceAttached = false, referenceSkipped = false } = {}) {
  const missing = [];
  if (!mode) missing.push('mode');
  if (!idea) missing.push('idea');
  else if (ideaReady !== true) missing.push('idea_details');
  if (idea && ideaReady === true && !referenceAttached && !referenceSkipped) missing.push('reference');
  if (!name) missing.push('name');
  return {
    ready: Boolean(name && mode && idea && (referenceAttached || referenceSkipped)),
    missing,
    next: missing[0] || '',
  };
}

export function dialogueProgressState({ name = '', mode = '', idea = '', ideaReady = false, referenceAttached = false, referenceSkipped = false, confirmed = false } = {}) {
  const complete = {
    mode: Boolean(mode),
    idea: Boolean(idea && ideaReady),
    name: Boolean(name),
    reference: Boolean(referenceAttached || referenceSkipped),
    confirm: Boolean(confirmed),
  };
  const weights = { mode: 20, idea: 40, name: 10, reference: 20, confirm: 10 };
  return { percent: Object.keys(weights).reduce((sum, key) => sum + (complete[key] ? weights[key] : 0), 0), complete };
}

export function bindBriefDialogue(host, { form, referenceAttached = false, requireUserInitiation = false, onAssist, onConfirm, onReference, onReferenceLink, onProfessional } = {}) {
  const panel = host.querySelector('[data-brief-dialogue]');
  if (!panel || !form) return () => {};
  const conversation = panel.querySelector('[data-brief-conversation]');
  const input = panel.querySelector('[data-dialogue-input]');
  const confirm = panel.querySelector('[data-dialogue-confirm]');
  const send = panel.querySelector('[data-dialogue-send]');
  const control = name => form.elements.namedItem(name);
  const dispatch = element => element?.dispatchEvent(new Event('input', { bubbles: true }));
  const history = [];
  let disposed = false;
  let sending = false;
  let ideaReady = !requireUserInitiation && Boolean(String(control('brief')?.value || '').trim());
  const message = (role, text = '') => {
    const article = document.createElement('article');
    article.className = `brief-message ${role === 'user' ? 'is-user' : 'is-assistant'}`;
    article.innerHTML = `<span class="brief-message-avatar">${role === 'user' ? '你' : '导'}</span><div><small>${role === 'user' ? '你' : '导演助理'}</small><div class="brief-bubble"><p>${escapeHtml(text)}</p></div></div>`;
    conversation.appendChild(article);
    conversation.scrollTop = conversation.scrollHeight;
    return { article, textNode: article.querySelector('.brief-bubble p') };
  };
  const streamMessage = async (text, target = null) => {
    const entry = target || message('assistant');
    const value = String(text || '').trim();
    entry.article.classList.add('is-streaming');
    entry.textNode.textContent = '';
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduced) entry.textNode.textContent = value;
    else {
      for (let index = 0; index < value.length && !disposed; index += 2) {
        entry.textNode.textContent = value.slice(0, index + 2);
        conversation.scrollTop = conversation.scrollHeight;
        await new Promise(resolve => setTimeout(resolve, 22));
      }
    }
    entry.article.classList.remove('is-streaming');
    conversation.scrollTop = conversation.scrollHeight;
    return entry;
  };
  let referenceSkipped = false;
  let referenceQuestionLoading = false;
  const appendReferenceQuestion = async () => {
    if (referenceQuestionLoading || conversation.querySelector('[data-reference-question]') || referenceAttached || referenceSkipped) return;
    referenceQuestionLoading = true;
    const { mountReferenceQuestion } = await import('./briefReferenceQuestion.js?v=20260821-dialogue-interaction-v112');
    mountReferenceQuestion(conversation, { onReference, onReferenceLink, onSkip: () => {
      referenceSkipped = true;
      message('user', '没有参考材料，继续');
      streamMessage('明白，我会只按你已经明确的内容继续，不把默认值当成你的选择。请核对右侧确认单。');
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
    const intake = dialogueIntakeState({ name, mode, idea, ideaReady, referenceAttached, referenceSkipped });
    const ready = intake.ready;
    const progress = dialogueProgressState({ name, mode, idea, ideaReady, referenceAttached, referenceSkipped });
    panel.querySelector('[data-contract-name]').textContent = name || '待根据创意命名';
    panel.querySelector('[data-contract-mode]').textContent = modeLabel(mode);
    panel.querySelector('[data-contract-idea]').innerHTML = ideaMarkup(idea, 'contract');
    panel.querySelector('[data-contract-duration]').textContent = `${duration}秒`;
    panel.querySelector('[data-contract-ratio]').textContent = ratio;
    panel.querySelector('[data-contract-resolution]').textContent = resolution;
    panel.querySelector('[data-contract-user]').textContent = `${[mode, idea, name].filter(Boolean).length} 项`;
    panel.querySelector('[data-contract-pending]').textContent = `${intake.missing.length} 项`;
    panel.querySelector('[data-dialogue-progress]').style.width = `${progress.percent}%`;
    panel.querySelector('[data-dialogue-progress-text]').textContent = `${progress.percent}%`;
    Object.entries(progress.complete).forEach(([key, complete]) => panel.querySelector(`[data-progress-item="${key}"]`)?.classList.toggle('is-complete', complete));
    confirm.disabled = !ready;
    return intake;
  };
  const contextualFallback = (text, mode, ready) => {
    const preview = briefIdeaPreview(text, 72).text;
    if (!ready) return mode === 'narrative_story'
      ? `我理解你想做剧情短片，目前提到的是“${preview}”。请再告诉我主要人物、关键事件，以及希望观众最后感受到什么。`
      : `我理解你想做商业广告，目前提到的是“${preview}”。请再说明产品或服务、最想证明的价值，以及希望观众记住什么。`;
    return `我理解到的核心是“${preview}”。人物或主体、事件与表达目标已经足够进入下一步；你有希望参考的视频、图片或链接吗？`;
  };
  const submit = async () => {
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    send.disabled = true;
    panel.setAttribute('aria-busy', 'true');
    const explicitSettings = await import('./briefExplicitSettings.js?v=20260821-dialogue-interaction-v112');
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
    history.push({ role: 'user', content: text });
    ideaReady = false;
    sync();
    const pending = message('assistant');
    pending.article.classList.add('is-thinking');
    pending.textNode.textContent = '正在理解你的想法…';
    try {
      const accumulatedIdea = String(control('brief')?.value || '').trim();
      const result = await onAssist?.({
        user_message: text,
        accumulated_idea: accumulatedIdea,
        content_mode: mode,
        project_name: String(control('project_name')?.value || '').trim(),
        target_duration: Number(control('target_duration')?.value || 30) || 30,
        output_ratio: String(control('output_ratio')?.value || '9:16'),
        video_resolution: String(control('video_resolution')?.value || '1080p'),
        reference_attached: referenceAttached,
        reference_skipped: referenceSkipped,
        history: history.slice(-8),
      });
      ideaReady = result?.idea_ready === true;
      const reply = String(result?.dialogue_reply || contextualFallback(text, mode, ideaReady));
      pending.article.classList.remove('is-thinking');
      await streamMessage(reply, pending);
      history.push({ role: 'assistant', content: reply });
    } catch {
      ideaReady = accumulatedIdeaIsSubstantive(String(control('brief')?.value || ''));
      const reply = contextualFallback(text, mode, ideaReady);
      pending.article.classList.remove('is-thinking');
      await streamMessage(reply, pending);
      history.push({ role: 'assistant', content: reply });
    } finally {
      sending = false;
      send.disabled = false;
      panel.removeAttribute('aria-busy');
      const intake = sync();
      if (intake.next === 'reference') await appendReferenceQuestion();
      input.focus();
    }
  };
  const accumulatedIdeaIsSubstantive = value => String(value || '').replace(/\s+/g, '').length >= 24;
  panel.querySelector('[data-dialogue-send]')?.addEventListener('click', submit);
  input?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
  });
  panel.querySelector('[data-dialogue-professional]')?.addEventListener('click', event => onProfessional?.(event.currentTarget));
  panel.querySelector('[data-dialogue-reference]')?.addEventListener('click', () => onReference?.());
  panel.querySelector('[data-dialogue-expand]')?.addEventListener('click', event => {
    const expanded = panel.querySelector('.brief-composer')?.classList.toggle('is-expanded') === true;
    event.currentTarget.setAttribute('aria-expanded', String(expanded));
    event.currentTarget.textContent = expanded ? '收起输入' : '展开输入';
    input.focus();
  });
  confirm?.addEventListener('click', () => onConfirm?.(confirm));
  form.addEventListener('input', sync);
  form.addEventListener('change', sync);
  const initialIntake = sync();
  if (!requireUserInitiation && initialIntake.next === 'reference') appendReferenceQuestion();
  return () => {
    disposed = true;
    form.removeEventListener('input', sync);
    form.removeEventListener('change', sync);
  };
}

export function bindBriefDialogueWorkflow(host, { form, referenceAttached, requireUserInitiation, onAssist, ensureProject, proceed, onReference, onReferenceLink, onProfessional, onError } = {}) {
  return bindBriefDialogue(host, {
    form,
    referenceAttached,
    requireUserInitiation,
    onAssist,
    onReference,
    onReferenceLink,
    onProfessional,
    onConfirm: async button => {
      try { await ensureProject(button); await proceed(button); } catch (error) { onError?.(error, button); }
    },
  });
}
