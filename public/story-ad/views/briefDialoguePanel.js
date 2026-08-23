import { escapeHtml } from '../components/ui.js?v=20260824-production-v201q';
import { createReferenceLinkDialogueHandler, referenceDialogueStatus, referenceNextStepDescription, routeReferenceInput, syncReferenceDialogueStatus } from './briefReferenceDialogueState.js?v=20260824-production-v201q';
import { dialogueBudgetReached,referenceDialoguePhase,sanitizeDialogueTopics } from './briefDialoguePolicy.js?v=20260824-production-v201q';
import { followConversationAfter } from './briefConversationScroll.js?v=20260824-production-v201q';
import { appendDialogueSuggestions,briefIdeaPreview,contextualDialogueFallback,dialogueHistoryMarkup,ideaMarkup,modeLabel,normalizedDialogueHistory,recordDialogueHistory } from './briefDialogueProjection.js?v=20260824-production-v201q';
import { dialogueIntakeState, dialogueProgressState } from './briefDialogueReadiness.js?v=20260824-production-v201q';
export { referenceDialogueStatus, referenceNextStepDescription, syncReferenceDialogueStatus };
export { briefIdeaPreview,dialogueIntakeState,dialogueProgressState };
export function briefDialogueMarkup(bundle={}, _route={}, options={}) {
  const brief = bundle.brief || {};
  const commercial = brief.content_mode_source === 'user' && brief.content_mode === 'commercial_subject';
  const narrative = brief.content_mode_source === 'user' && brief.content_mode === 'narrative_story';
  const domainLabel = commercial ? '广告方案' : (narrative ? '剧情' : '方案');
  const outputLabel = commercial ? '广告脚本' : (narrative ? '剧情与对白' : '内容方案');
  const referenceStatus = referenceDialogueStatus(bundle.reference || {});
  const intake = brief.brief_intake || {};
  const persistedHistory = normalizedDialogueHistory(intake.dialogue_history);
  const pendingInteractiveTopic = persistedHistory.at(-1)?.role === 'assistant'
    && ((persistedHistory.at(-1)?.topic === 'on_screen_cast' && intake.cast_intent?.confirmed !== true)
      || (persistedHistory.at(-1)?.topic === 'specifications' && intake.specifications_confirmed !== true)
      || (persistedHistory.at(-1)?.topic === 'reference' && !['attached', 'skipped'].includes(intake.reference_decision)))
    ? persistedHistory.at(-1)?.topic : '';
  const displayedHistory = pendingInteractiveTopic ? persistedHistory.slice(0, -1) : persistedHistory;
  const hasIdea = Boolean(String(brief.text || '').trim());
  return `<section class="brief-dialogue" data-brief-dialogue>
    <div class="brief-conversation-panel">
      <header class="brief-conversation-head"><span class="brief-director-avatar">导</span><div><h1>导演助理</h1><p><i></i><span data-dialogue-domain-copy>在线 · 先把想法整理成可执行${domainLabel}</span></p></div><span class="brief-stage-chip">第 1 步 · 对话立项</span></header>
      <div class="brief-conversation-scroll" data-brief-conversation aria-live="polite">
        ${displayedHistory.length && hasIdea && !displayedHistory.some(item => item.role === 'user' && String(brief.text || '').includes(item.content.slice(0, 40))) ? `<article class="brief-message is-user is-legacy-summary"><span class="brief-message-avatar">你</span><div><small>升级前立项摘要</small><div class="brief-bubble" data-dialogue-current-idea>${ideaMarkup(brief.text, 'conversation')}</div></div></article>` : ''}
        ${displayedHistory.length ? dialogueHistoryMarkup(displayedHistory) : (hasIdea ? `<article class="brief-message is-user"><span class="brief-message-avatar">你</span><div><small>当前设想</small><div class="brief-bubble" data-dialogue-current-idea>${ideaMarkup(brief.text, 'conversation')}</div></div></article>` : '')}
        ${referenceStatus ? `<article class="brief-message is-assistant" data-reference-dialogue-status data-reference-status="${escapeHtml(String(bundle.reference?.status || '').toLowerCase())}"><span class="brief-message-avatar">导</span><div><small>导演助理 · 参考分析</small><div class="brief-bubble"><p>${escapeHtml(referenceStatus)}</p></div></div></article>` : ''}
        ${options.referenceProgressMarkup ? `<div class="brief-reference-progress-slot" data-reference-progress-host>${options.referenceProgressMarkup}</div>` : ''}
      </div>
      <footer class="brief-composer"><label><span data-dialogue-context>${hasIdea ? '继续补充或修改核心设想' : '直接说说你想做什么，由你发起对话'}</span><button type="button" data-dialogue-expand aria-expanded="false">展开输入</button></label><div><button type="button" class="brief-attach" data-dialogue-reference title="添加参考材料">参考</button><textarea rows="2" data-dialogue-input placeholder="输入你的想法；内容较多时可拖动右下角，或点击“展开输入”…"></textarea><button type="button" class="brief-send" data-dialogue-send>发送</button></div><small>仅问关键问题；参考完成后继续</small></footer>
    </div>
    <aside class="brief-contract-panel">
      <header><div><small>实时结构化</small><h2>项目确认单</h2></div><span>草稿</span></header>
      <div class="brief-contract-progress"><i><b data-dialogue-progress></b></i><strong data-dialogue-progress-text>0%</strong></div>
      <ol class="brief-contract-checklist" aria-label="立项准备度依据"><li data-progress-item="mode">内容类型 15%</li><li data-progress-item="idea">核心内容 30%</li><li data-progress-item="name">项目名称 10%</li><li data-progress-item="cast">出镜人物 10%</li><li data-progress-item="specifications">成片规格 15%</li><li data-progress-item="reference">参考决定 10%</li><li data-progress-item="confirm">最终确认 10%</li></ol>
      <p class="brief-contract-hint">对话内容会自动同步到这里。这是立项准备度，不是高级设置完成度；系统建议的规格不算完成，必须由你明确确认。</p>
      <section><h3>基础信息</h3><dl><div><dt>项目名称</dt><dd data-contract-name>待根据创意命名</dd></div><div><dt>内容类型</dt><dd data-contract-mode>${escapeHtml(modeLabel(brief.content_mode_source === 'user' ? brief.content_mode : ''))}</dd></div><div class="wide"><dt>核心创意</dt><dd data-contract-idea>${ideaMarkup(brief.text, 'contract')}</dd></div></dl></section>
      <section><h3>成片规格</h3><dl class="triple"><div><dt>时长</dt><dd><span data-contract-duration>${Number(brief.target_duration || 30)}秒</span> <i data-contract-spec-source>${intake.specifications_confirmed === true ? '用户已确认' : '建议·待确认'}</i></dd></div><div><dt>画幅</dt><dd><span data-contract-ratio>${escapeHtml(brief.output_ratio || '9:16')}</span> <i data-contract-spec-source>${intake.specifications_confirmed === true ? '用户已确认' : '建议·待确认'}</i></dd></div><div><dt>清晰度</dt><dd><span data-contract-resolution>${escapeHtml(brief.video_resolution || '1080p')}</span> <i data-contract-spec-source>${intake.specifications_confirmed === true ? '用户已确认' : '建议·待确认'}</i></dd></div></dl></section>
      <section><h3>信息依据</h3><div class="brief-evidence"><span class="user">用户明确</span><b data-contract-user>${hasIdea ? 2 : 0} 项</b></div><div class="brief-evidence"><span class="ai">AI 建议</span><b>3 项</b></div><div class="brief-evidence"><span class="pending">等待确认</span><b data-contract-pending>${hasIdea ? 2 : 5} 项</b></div></section>
      <button class="brief-confirm-concept" type="button" data-dialogue-confirm disabled>确认设想，生成${outputLabel}</button>
      <button class="brief-professional" type="button" data-dialogue-professional>手动编辑全部设置</button>
    </aside>
  </section>`;
}

export function bindBriefDialogue(host, { form, referenceState={}, referenceAttached=false, requireUserInitiation=false, onAssist, onDialogueState, onConfirm, onReference, onReferenceLink, onProfessional }={}) {
  const panel = host.querySelector('[data-brief-dialogue]');
  if (!panel || !form) return () => {};
  const conversation = panel.querySelector('[data-brief-conversation]');
  const input = panel.querySelector('[data-dialogue-input]');
  const confirm = panel.querySelector('[data-dialogue-confirm]');
  const send = panel.querySelector('[data-dialogue-send]');
  const control = name => form.elements.namedItem(name);
  const dispatch = element => element?.dispatchEvent(new Event('input', { bubbles: true }));
  let history = [];
  try { history = normalizedDialogueHistory(JSON.parse(String(control('dialogue_history')?.value || '[]'))); } catch { history = []; }
  let castIntent = {};
  try { castIntent = JSON.parse(String(control('cast_intent')?.value || '{}')) || {}; } catch { castIntent = {}; }
  const recordHistory = (role, content, { topic = '', selectedAnswer = false } = {}) => {
    history = recordDialogueHistory(history, role, content, { topic, selectedAnswer });
    if (control('dialogue_history')) control('dialogue_history').value = JSON.stringify(history);
  };
  const modeAtMount = String(control('content_mode')?.value || '');
  const completedTopics = new Set(sanitizeDialogueTopics(String(control('completed_dialogue_topics')?.value || '').split(','), modeAtMount));
  let activeQuestionTopic = sanitizeDialogueTopics([String(control('active_dialogue_topic')?.value || '')], modeAtMount)[0] || '';
  let disposed = false;
  let sending = false;
  let ideaReady = String(control('creative_brief_confirmed')?.value || '') === 'true';
  let specificationsConfirmed = String(control('specifications_confirmed')?.value || '') === 'true';
  let currentReference = referenceState || {};
  let referencePresent = referenceAttached || Boolean(currentReference.analysis_id);
  const explicitSpecificationKeys = new Set();
  const message = (role, text = '') => {
    const article = document.createElement('article');
    article.className = `brief-message ${role === 'user' ? 'is-user' : 'is-assistant'}`;
    article.innerHTML = `<span class="brief-message-avatar">${role === 'user' ? '你' : '导'}</span><div><small>${role === 'user' ? '你' : '导演助理'}</small><div class="brief-bubble"><p>${escapeHtml(text)}</p></div></div>`;
    followConversationAfter(conversation, () => conversation.appendChild(article), { force: role === 'user' });
    return { article, textNode: article.querySelector('.brief-bubble p') };
  };
  const retireSuggestions = () => conversation.querySelectorAll('[data-dialogue-suggestions] button').forEach(button => { button.disabled = true; });
  const appendSuggestions = (entry, answers = []) => appendDialogueSuggestions(entry, answers, {
    isSending: () => sending,
    onSelect: value => { retireSuggestions(); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); submit(); },
  });
  const streamMessage = async (text, target = null, meta = {}) => {
    const entry = target || message('assistant');
    const value = String(text || '').trim();
    entry.article.classList.add('is-streaming');
    entry.textNode.textContent = '';
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduced) entry.textNode.textContent = value;
    else {
      for (let index = 0; index < value.length && !disposed; index += 2) {
        followConversationAfter(conversation, () => { entry.textNode.textContent = value.slice(0, index + 2); });
        await new Promise(resolve => setTimeout(resolve, 22));
      }
    }
    entry.article.classList.remove('is-streaming');
    followConversationAfter(conversation, () => {});
    recordHistory('assistant', value, meta);
    return entry;
  };
  let referenceSkipped = String(control('reference_decision')?.value || '') === 'skipped';
  let referenceQuestionLoading = false;
  let specificationQuestionLoading = false;
  let castQuestionLoading = false;
  const referenceLinkDialogue = createReferenceLinkDialogueHandler({
    onReferenceLink,
    message,
    onAttached: () => { referencePresent = true; },
    sync: () => sync(),
  });
  const appendReferenceQuestion = async () => {
    if (referenceQuestionLoading || conversation.querySelector('[data-reference-question]') || referencePresent || referenceSkipped) return;
    referenceQuestionLoading = true;
    const { mountReferenceQuestion, referenceQuestionText } = await import('./briefReferenceQuestion.js?v=20260824-production-v201q');
    recordHistory('assistant', referenceQuestionText({ mode: String(control('content_mode')?.value || ''), idea: briefIdeaPreview(String(control('brief')?.value || ''), 54).text }), { topic: 'reference' });
    mountReferenceQuestion(conversation, {
      mode: String(control('content_mode')?.value || ''),
      idea: briefIdeaPreview(String(control('brief')?.value || ''), 54).text,
      onReference,
      onReferenceLink: referenceLinkDialogue,
      onSkip: () => {
        referenceSkipped = true;
        message('user', '没有');
        recordHistory('user', '没有', { topic: 'reference', selectedAnswer: true });
        const output = String(control('content_mode')?.value || '') === 'commercial_subject' ? '广告脚本' : '剧情与对白';
        streamMessage(`参考材料已记为没有。创作内容、成片规格和参考材料都已问完；现在请确认整体设想，确认后我会生成${output}。`);
        sync();
      },
    });
    referenceQuestionLoading = false;
  };
  const appendSpecificationQuestion = async () => {
    if (specificationQuestionLoading || conversation.querySelector('[data-specification-question]') || specificationsConfirmed) return;
    specificationQuestionLoading = true;
    const { mountSpecificationQuestion, specificationQuestionText } = await import('./briefSpecificationQuestion.js?v=20260824-production-v201q');
    recordHistory('assistant', specificationQuestionText({ mode: String(control('content_mode')?.value || ''), duration: Number(control('target_duration')?.value || 30) || 30, ratio: String(control('output_ratio')?.value || '9:16'), resolution: String(control('video_resolution')?.value || '1080p') }), { topic: 'specifications' });
    mountSpecificationQuestion(conversation, {
      mode: String(control('content_mode')?.value || ''),
      duration: Number(control('target_duration')?.value || 30) || 30,
      ratio: String(control('output_ratio')?.value || '9:16'),
      resolution: String(control('video_resolution')?.value || '1080p'),
      onConfirm: async () => {
        specificationsConfirmed = true;
        message('user', '确认当前成片规格');
        recordHistory('user', '确认当前成片规格', { topic: 'specifications', selectedAnswer: true });
        await streamMessage('好的，成片规格已由你确认。接下来确认是否使用参考材料。');
        sync();
        await appendReferenceQuestion();
      },
      onAdjust: async values => {
        const mappings = { target_duration: values.duration, output_ratio: values.ratio, video_resolution: values.resolution };
        Object.entries(mappings).forEach(([name, value]) => {
          const field = control(name);
          if (!field) return;
          field.value = String(value);
          field.dispatchEvent(new Event('change', { bubbles: true }));
        });
        specificationsConfirmed = true;
        message('user', `调整为 ${values.duration} 秒、${values.ratio}、${values.resolution}`);
        recordHistory('user', `调整为 ${values.duration} 秒、${values.ratio}、${values.resolution}`, { topic: 'specifications', selectedAnswer: true });
        await streamMessage('成片规格已按这个项目调整并确认。最后确认是否使用参考材料。');
        sync();
        await appendReferenceQuestion();
      },
    });
    specificationQuestionLoading = false;
  };
  const appendCastQuestion = async () => {
    if (castQuestionLoading || conversation.querySelector('[data-cast-question]') || castIntent?.confirmed === true || String(control('content_mode')?.value || '') !== 'commercial_subject') return;
    castQuestionLoading = true;
    const { mountCastQuestion, castQuestionText } = await import('./briefCastQuestion.js?v=20260824-production-v201q');
    const question = castQuestionText();
    recordHistory('assistant', question, { topic: 'on_screen_cast' });
    mountCastQuestion(conversation, {
      onSelect: async ({ label, intent }) => {
        castIntent = intent;
        if (control('cast_intent')) control('cast_intent').value = JSON.stringify(castIntent);
        message('user', label);
        recordHistory('user', label, { topic: 'on_screen_cast', selectedAnswer: true });
        await streamMessage(`出镜人物已确认：${label}。接下来确认成片规格。`, null, { topic: 'on_screen_cast' });
        sync();
        await persistDialogueState();
        await appendSpecificationQuestion();
      },
    });
    castQuestionLoading = false;
    sync();
    persistDialogueState().catch(() => {});
  };
  const sync = () => {
    const name = String(control('project_name')?.value || '').trim();
    const mode = String(control('content_mode')?.value || '');
    const idea = String(control('brief')?.value || '').trim();
    const duration = Number(control('target_duration')?.value || 30) || 30;
    const ratio = String(control('output_ratio')?.value || '9:16');
    const resolution = String(control('video_resolution')?.value || '1080p');
    const castIntentConfirmed = castIntent?.confirmed === true;
    const intake = dialogueIntakeState({ name, mode, idea, ideaReady, castIntentConfirmed, specificationsConfirmed, referenceAttached: referencePresent, referenceSkipped });
    const ready = intake.ready;
    const progress = dialogueProgressState({ name, mode, idea, ideaReady, castIntentConfirmed, specificationsConfirmed, referenceAttached: referencePresent, referenceSkipped });
    if (control('creative_brief_confirmed')) control('creative_brief_confirmed').value = ideaReady ? 'true' : 'false';
    if (control('specifications_confirmed')) control('specifications_confirmed').value = specificationsConfirmed ? 'true' : 'false';
    if (control('reference_decision')) control('reference_decision').value = referencePresent ? 'attached' : (referenceSkipped ? 'skipped' : '');
    if (control('completed_dialogue_topics')) control('completed_dialogue_topics').value = [...completedTopics].join(',');
    if (control('active_dialogue_topic')) control('active_dialogue_topic').value = activeQuestionTopic;
    if (control('dialogue_history')) control('dialogue_history').value = JSON.stringify(history);
    if (control('cast_intent')) control('cast_intent').value = JSON.stringify(castIntent || {});
    panel.querySelector('[data-contract-name]').textContent = name || '待根据创意命名';
    panel.querySelector('[data-contract-mode]').textContent = modeLabel(mode);
    const domainCopy = panel.querySelector('[data-dialogue-domain-copy]');
    if (domainCopy) domainCopy.textContent = `在线 · 先把想法整理成可执行${mode === 'commercial_subject' ? '广告方案' : (mode === 'narrative_story' ? '剧情' : '方案')}`;
    if (!panel.hasAttribute('aria-busy')) confirm.textContent = `确认设想，生成${mode === 'commercial_subject' ? '广告脚本' : (mode === 'narrative_story' ? '剧情与对白' : '内容方案')}`;
    panel.querySelector('[data-contract-idea]').innerHTML = ideaMarkup(idea, 'contract');
    panel.querySelector('[data-contract-duration]').textContent = `${duration}秒`;
    panel.querySelector('[data-contract-ratio]').textContent = ratio;
    panel.querySelector('[data-contract-resolution]').textContent = resolution;
    panel.querySelectorAll('[data-contract-spec-source]').forEach(source => { source.textContent = specificationsConfirmed ? '用户已确认' : '建议·待确认'; });
    panel.querySelector('[data-contract-user]').textContent = `${[mode, idea, name, specificationsConfirmed ? 'specifications' : '', (referencePresent || referenceSkipped) ? 'reference' : ''].filter(Boolean).length} 项`;
    panel.querySelector('[data-contract-pending]').textContent = `${intake.missing.length} 项`;
    panel.querySelector('[data-dialogue-progress]').style.width = `${progress.percent}%`;
    panel.querySelector('[data-dialogue-progress-text]').textContent = `${progress.percent}%`;
    Object.entries(progress.complete).forEach(([key, complete]) => panel.querySelector(`[data-progress-item="${key}"]`)?.classList.toggle('is-complete', complete));
    confirm.disabled = !ready;
    return intake;
  };
  const persistDialogueState = async () => {
    sync();
    await onDialogueState?.({
      creative_brief_confirmed: ideaReady,
      specifications_confirmed: specificationsConfirmed,
      reference_decision: referencePresent ? 'attached' : (referenceSkipped ? 'skipped' : ''),
      completed_dialogue_topics: [...completedTopics],
      active_dialogue_topic: activeQuestionTopic,
      dialogue_history: history,
      cast_intent: castIntent,
    });
  };
  const applyReferenceGate = async reference => {
    currentReference = reference || {};
    referencePresent = Boolean(currentReference.analysis_id);
    const phase = referenceDialoguePhase(currentReference);
    const blocked = phase === 'active' || phase === 'blocked';
    input.disabled = blocked;
    send.disabled = blocked || sending;
    const context = panel.querySelector('[data-dialogue-context]');
    if (context) context.textContent = phase === 'active'
      ? '正在读取并分析参考视频，完成前无需回答其他问题'
      : (phase === 'blocked' ? '参考视频未能完成分析，请重试、更换或移除后继续'
        : (String(control('brief')?.value || '').trim() ? '继续补充或修改核心设想' : '直接说说你想做什么，由你发起对话'));
    if (phase === 'ready' && !ideaReady) {
      ideaReady = true;
      activeQuestionTopic = '';
      const intake = sync();
      await persistDialogueState();
      if (intake.next === 'cast') await appendCastQuestion();
      if (intake.next === 'specifications') await appendSpecificationQuestion();
    }
    return phase;
  };
  const submit = async () => {
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    send.disabled = true;
    panel.setAttribute('aria-busy', 'true');
    const explicitSettings = await import('./briefExplicitSettings.js?v=20260824-production-v201q');
    input.value = '';
    const intakeBefore = sync();
    if (await routeReferenceInput({
      text, message, history, referenceLinkDialogue,
      panel, send, input, sync: () => { sending = false; sync(); },
      showChoices: appendReferenceQuestion,
    })) return;
    const answeredTopic = activeQuestionTopic;
    if (answeredTopic) {
      completedTopics.add(answeredTopic);
      activeQuestionTopic = '';
    }
    retireSuggestions();
    const explicit = explicitSettings.extractExplicitBriefSettings(text);
    const explicitOutputKeys = explicitSettings.explicitOutputSettingKeys(explicit);
    const applyExplicitSettings = () => Object.entries(explicit).forEach(([name, value]) => {
      const field = control(name);
      if (!field) return;
      if (field.options && ![...field.options].some(option => String(option.value || option.textContent) === String(value))) return;
      field.value = String(value);
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const finishImmediate = async reply => {
      message('user', text);
      recordHistory('user', text, { topic: answeredTopic, selectedAnswer: Boolean(answeredTopic) });
      await streamMessage(reply, null, { topic: answeredTopic });
      sending = false;
      send.disabled = false;
      panel.removeAttribute('aria-busy');
      const intake = sync();
      await persistDialogueState();
      if (intake.next === 'cast') await appendCastQuestion();
      if (intake.next === 'specifications') await appendSpecificationQuestion();
      if (intake.next === 'reference') await appendReferenceQuestion();
      input.focus();
    };
    if (intakeBefore.next === 'specifications' && (explicitOutputKeys.length > 0 || explicitSettings.isBriefConfirmationReply(text))) {
      applyExplicitSettings();
      explicitOutputKeys.forEach(key => explicitSpecificationKeys.add(key));
      const confirmedByReply = explicitSettings.isBriefConfirmationReply(text);
      specificationsConfirmed = confirmedByReply || explicitSpecificationKeys.size === explicitSettings.OUTPUT_SETTING_KEYS.length;
      const duration = Number(control('target_duration')?.value || 30) || 30;
      const ratio = String(control('output_ratio')?.value || '9:16');
      const resolution = String(control('video_resolution')?.value || '1080p');
      await finishImmediate(specificationsConfirmed
        ? `成片规格现已由你明确确认：${duration} 秒、${ratio}、${resolution}。下一步再决定是否使用参考材料。`
        : `已修改你明确给出的规格。当前组合为 ${duration} 秒、${ratio}、${resolution}，其余仍是系统建议；请回复“确认”采用整组规格，或继续修改。`);
      return;
    }
    if (intakeBefore.next === 'reference' && explicitSettings.isNoReferenceReply(text)) {
      referenceSkipped = true;
      const output = String(control('content_mode')?.value || '') === 'commercial_subject' ? '广告脚本' : '剧情与对白';
      await finishImmediate(`参考材料已记为没有。创作内容、成片规格和参考材料都已问完；现在请确认整体设想，确认后我会生成${output}。`);
      return;
    }
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
    applyExplicitSettings();
    explicitOutputKeys.forEach(key => explicitSpecificationKeys.add(key));
    if (explicitSpecificationKeys.size === explicitSettings.OUTPUT_SETTING_KEYS.length) specificationsConfirmed = true;
    message('user', text);
    recordHistory('user', text, { topic: answeredTopic, selectedAnswer: Boolean(answeredTopic) });
    ideaReady = false;
    sync();
    if (dialogueBudgetReached([...completedTopics], mode)) {
      ideaReady = true;
      const intake = sync();
      await persistDialogueState();
      sending = false;
      send.disabled = false;
      panel.removeAttribute('aria-busy');
      if (intake.next === 'cast') await appendCastQuestion();
      if (intake.next === 'specifications') await appendSpecificationQuestion();
      if (intake.next === 'reference') await appendReferenceQuestion();
      input.focus();
      return;
    }
    await persistDialogueState();
    const pending = message('assistant');
    pending.article.classList.add('is-thinking');
    pending.textNode.innerHTML = '<span class="brief-thinking-dots" role="status" aria-label="导演助理正在组织下一问"><i></i><i></i><i></i></span>';
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
        specifications_confirmed: specificationsConfirmed,
        reference_attached: referencePresent,
        reference_skipped: referenceSkipped,
        history: history.slice(-8),
        completed_topics: [...completedTopics],
      });
      ideaReady = result?.idea_ready === true;
      activeQuestionTopic = ideaReady ? '' : (sanitizeDialogueTopics([String(result?.question_topic || '').trim()], mode)[0] || '');
      const reply = String(result?.dialogue_reply || contextualDialogueFallback(mode, ideaReady));
      pending.article.classList.remove('is-thinking');
      if (ideaReady && result?.next_step === 'specifications') pending.article.remove();
      else {
        await streamMessage(reply, pending, { topic: activeQuestionTopic || answeredTopic });
        appendSuggestions(pending, result?.suggested_answers);
      }
    } catch {
      ideaReady = false;
      const reply = contextualDialogueFallback(mode, ideaReady);
      pending.article.classList.remove('is-thinking');
      await streamMessage(reply, pending, { topic: activeQuestionTopic || answeredTopic });
    } finally {
      sending = false;
      send.disabled = false;
      panel.removeAttribute('aria-busy');
      const intake = sync();
      await persistDialogueState();
      if (intake.next === 'cast') await appendCastQuestion();
      if (intake.next === 'specifications') await appendSpecificationQuestion();
      if (intake.next === 'reference') await appendReferenceQuestion();
      input.focus();
    }
  };
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
  if (dialogueBudgetReached([...completedTopics], modeAtMount)) ideaReady = true;
  const initialIntake = sync();
  const initialReferencePhase = referenceDialoguePhase(currentReference);
  applyReferenceGate(currentReference).catch(() => {});
  if (!requireUserInitiation && initialReferencePhase === 'none' && String(control('brief')?.value || '').trim() && !ideaReady) {
    import('./briefGuidedResume.js?v=20260824-production-v201q').then(({ guidedResumePrompt }) => {
      if (disposed) return;
      const guidance = guidedResumePrompt({ mode: String(control('content_mode')?.value || ''), idea: String(control('brief')?.value || '') });
      const entry = message('assistant', guidance.text);
      recordHistory('assistant', guidance.text, { topic: guidance.topic });
      appendSuggestions(entry, guidance.answers);
      activeQuestionTopic = guidance.topic;
      sync();
      persistDialogueState().catch(() => {});
    });
  }
  if (!requireUserInitiation && initialReferencePhase === 'none' && initialIntake.next === 'cast') appendCastQuestion();
  if (!requireUserInitiation && initialReferencePhase === 'none' && initialIntake.next === 'specifications') appendSpecificationQuestion();
  if (!requireUserInitiation && initialReferencePhase === 'none' && initialIntake.next === 'reference') appendReferenceQuestion();
  const cleanup = () => {
    disposed = true;
    form.removeEventListener('input', sync);
    form.removeEventListener('change', sync);
  };
  cleanup.updateReference = reference => applyReferenceGate(reference);
  return cleanup;
}

export function bindBriefDialogueWorkflow(host, { form, referenceState, referenceAttached, requireUserInitiation, onAssist, onDialogueState, ensureProject, proceed, onReference, onReferenceLink, onProfessional, onError } = {}) {
  return bindBriefDialogue(host, {
    form,
    referenceState,
    referenceAttached,
    requireUserInitiation,
    onAssist,
    onDialogueState,
    onReference,
    onReferenceLink,
    onProfessional,
    onConfirm: async button => {
      try { await ensureProject(button); await proceed(button); } catch (error) { onError?.(error, button); }
    },
  });
}
