import { escapeHtml } from '../components/ui.js?v=20260820-dialogue-flow-v90';

function modeLabel(value = '') {
  return value === 'commercial_subject' ? '商业广告' : (value === 'narrative_story' ? '剧情短片' : '待确认');
}

export function briefDialogueMarkup(bundle = {}, route = {}) {
  const brief = bundle.brief || {};
  const hasIdea = Boolean(String(brief.text || '').trim());
  return `<section class="brief-dialogue" data-brief-dialogue>
    <div class="brief-conversation-panel">
      <header class="brief-conversation-head"><span class="brief-director-avatar">导</span><div><h1>导演助理</h1><p><i></i>在线 · 先把想法整理成可执行剧情</p></div><span class="brief-stage-chip">第 1 步 · 对话立项</span></header>
      <div class="brief-conversation-scroll" data-brief-conversation aria-live="polite">
        <article class="brief-message is-assistant"><span class="brief-message-avatar">导</span><div><small>导演助理</small><div class="brief-bubble"><b>${route.isNew ? '先聊聊你想做什么。' : '我已读取这个项目的设想。'}</b><p>${route.isNew ? '你不需要先填一整页表单。我会逐步确认内容类型、核心想法和成片规格，再先生成详细剧情与对白。' : '你可以继续补充或纠正；确认后会先进入剧情与对白，不会提前生成人物图片或视频。'}</p></div>${!hasIdea ? `<div class="brief-quick-actions"><button type="button" data-dialogue-mode="commercial_subject">我要做商业广告</button><button type="button" data-dialogue-mode="narrative_story">我要做剧情短片</button></div>` : ''}</div></article>
        ${hasIdea ? `<article class="brief-message is-user"><span class="brief-message-avatar">你</span><div><small>当前设想</small><div class="brief-bubble"><p>${escapeHtml(brief.text)}</p></div></div></article>` : ''}
      </div>
      <footer class="brief-composer"><label data-dialogue-context>${hasIdea ? '继续补充或修改核心设想' : '先选择类型，也可以直接描述你的想法'}</label><div><button type="button" class="brief-attach" data-dialogue-reference title="添加参考材料">＋</button><textarea rows="2" data-dialogue-input placeholder="例如：做一条30秒不锈钢品牌广告，突出佛山制造、耐腐蚀和高端科技感…"></textarea><button type="button" class="brief-send" data-dialogue-send>发送</button></div><small>AI 建议会单独标记，不会静默覆盖你已确认的内容</small></footer>
    </div>
    <aside class="brief-contract-panel">
      <header><div><small>实时结构化</small><h2>项目确认单</h2></div><span>草稿</span></header>
      <div class="brief-contract-progress"><i><b data-dialogue-progress></b></i><strong data-dialogue-progress-text>20%</strong></div>
      <p class="brief-contract-hint">对话内容会自动同步到这里。项目名称可由系统建议，也可在“手动编辑全部设置”中修改。</p>
      <section><h3>基础信息</h3><dl><div><dt>项目名称</dt><dd data-contract-name>待根据创意命名</dd></div><div><dt>内容类型</dt><dd data-contract-mode>${escapeHtml(modeLabel(brief.content_mode_source === 'user' ? brief.content_mode : ''))}</dd></div><div class="wide"><dt>核心创意</dt><dd data-contract-idea>${hasIdea ? escapeHtml(brief.text) : '<em>等待你的描述</em>'}</dd></div></dl></section>
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

function suggestedName(idea = '', mode = '') {
  if (/不锈钢|佛山|金属/.test(idea)) return '佛山智造 · 不锈钢品牌广告';
  if (/护肤|精华|面霜/.test(idea)) return '高端护肤品牌短片';
  if (/校园|学院|孩子/.test(idea)) return '校园故事 · 剧情短片';
  return mode === 'narrative_story' ? '未命名剧情项目' : '未命名广告项目';
}

export function bindBriefDialogue(host, { form, onConfirm, onReference } = {}) {
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
  const sync = () => {
    const name = String(control('project_name')?.value || '').trim();
    const mode = String(control('content_mode')?.value || '');
    const idea = String(control('brief')?.value || '').trim();
    const duration = Number(control('target_duration')?.value || 30) || 30;
    const ratio = String(control('output_ratio')?.value || '9:16');
    const resolution = String(control('video_resolution')?.value || '1080p');
    const ready = Boolean(name && mode && idea);
    const progress = ready ? 100 : (idea ? 72 : (mode ? 38 : 20));
    panel.querySelector('[data-contract-name]').textContent = name || '待根据创意命名';
    panel.querySelector('[data-contract-mode]').textContent = modeLabel(mode);
    panel.querySelector('[data-contract-idea]').textContent = idea || '等待你的描述';
    panel.querySelector('[data-contract-duration]').textContent = `${duration}秒`;
    panel.querySelector('[data-contract-ratio]').textContent = ratio;
    panel.querySelector('[data-contract-resolution]').textContent = resolution;
    panel.querySelector('[data-contract-user]').textContent = `${[mode, idea, name].filter(Boolean).length} 项`;
    panel.querySelector('[data-contract-pending]').textContent = `${ready ? 0 : (idea ? 2 : 5)} 项`;
    panel.querySelector('[data-dialogue-progress]').style.width = `${progress}%`;
    panel.querySelector('[data-dialogue-progress-text]').textContent = `${progress}%`;
    confirm.disabled = !ready;
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
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
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
      control('project_name').value = suggestedName(text, mode);
      dispatch(control('project_name'));
    }
    message('user', text);
    message('assistant', `已整理到确认单。我建议先按${control('target_duration')?.value || 30}秒、${control('output_ratio')?.value || '9:16'}制作；你可以继续补充，或确认后先生成详细剧情和对白。`);
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

export function bindBriefDialogueWorkflow(host, { form, ensureProject, proceed, onReference, onError } = {}) {
  return bindBriefDialogue(host, {
    form,
    onReference,
    onConfirm: async button => {
      try { await ensureProject(button); await proceed(button); } catch (error) { onError?.(error, button); }
    },
  });
}
