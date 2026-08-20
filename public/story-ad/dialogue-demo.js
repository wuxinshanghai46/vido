const conversation = document.querySelector('[data-conversation]');
const input = document.querySelector('[data-input]');
const sendButton = document.querySelector('[data-send]');
const confirmButton = document.querySelector('[data-confirm]');
const composerContext = document.querySelector('[data-composer-context]');

const initialState = () => ({
  phase: 'contentMode',
  projectName: '',
  contentMode: '',
  idea: '',
  duration: 30,
  ratio: '9:16',
  resolution: '1080p',
  world: '',
  medium: '',
  style: '',
  userCount: 0,
  aiCount: 3,
  pendingCount: 5,
  progress: 15,
});

let state = initialState();
let toastTimer = null;

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
})[char]);

function scrollConversation() {
  requestAnimationFrame(() => { conversation.scrollTop = conversation.scrollHeight; });
}

function addMessage(role, html, actions = []) {
  const node = document.createElement('article');
  node.className = `message ${role === 'user' ? 'is-user' : 'is-assistant'}`;
  node.innerHTML = `
    <div class="message-avatar">${role === 'user' ? '你' : '导'}</div>
    <div class="message-content">
      <div class="message-name">${role === 'user' ? '你' : '导演助理'}</div>
      <div class="bubble">${html}</div>
      ${actions.length ? `<div class="quick-actions">${actions.map(action => `<button type="button" data-action="${escapeHtml(action.value)}">${escapeHtml(action.label)}</button>`).join('')}</div>` : ''}
    </div>`;
  conversation.appendChild(node);
  node.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    node.querySelectorAll('[data-action]').forEach(item => { item.disabled = true; });
    handleAction(button.dataset.action, button.textContent.trim());
  }));
  scrollConversation();
  return node;
}

function addTyping() {
  const node = addMessage('assistant', '<span class="typing"><i></i><i></i><i></i></span>');
  return () => node.remove();
}

function assistantAfter(delay, callback) {
  const removeTyping = addTyping();
  window.setTimeout(() => { removeTyping(); callback(); scrollConversation(); }, delay);
}

function setField(name, html) {
  const target = document.querySelector(`[data-field="${name}"]`);
  if (target) target.innerHTML = html;
}

function syncContract() {
  setField('projectName', state.projectName ? escapeHtml(state.projectName) : '<em>待根据创意命名</em>');
  setField('contentMode', state.contentMode ? escapeHtml(state.contentMode) : '<em>待确认</em>');
  setField('idea', state.idea ? escapeHtml(state.idea) : '<em>等待你的描述</em>');
  setField('duration', `${state.duration}秒${state.phase === 'duration' || state.phase === 'contentMode' || state.phase === 'idea' ? ' <i>建议</i>' : ''}`);
  setField('ratio', `${escapeHtml(state.ratio)}${state.phase === 'format' || ['contentMode', 'idea', 'duration'].includes(state.phase) ? ' <i>建议</i>' : ''}`);
  setField('resolution', escapeHtml(state.resolution));
  setField('world', state.world ? escapeHtml(state.world) : '<em>待识别</em>');
  setField('medium', state.medium ? escapeHtml(state.medium) : '<em>待确认</em>');
  setField('style', state.style ? escapeHtml(state.style) : '<em>等待剧情方向</em>');
  document.querySelector('[data-progress-bar]').style.width = `${state.progress}%`;
  document.querySelector('[data-progress-text]').textContent = `${state.progress}%`;
  document.querySelector('[data-user-count]').textContent = `${state.userCount} 项`;
  document.querySelector('[data-ai-count]').textContent = `${state.aiCount} 项`;
  document.querySelector('[data-pending-count]').textContent = `${state.pendingCount} 项`;
  confirmButton.disabled = state.phase !== 'ready';
}

function updateComposer(context, placeholder) {
  composerContext.textContent = context;
  input.placeholder = placeholder;
  input.focus();
}

function guessProject(idea) {
  if (/不锈钢|佛山|金属/.test(idea)) return '佛山智造 · 不锈钢品牌广告';
  if (/护肤|面霜|精华/.test(idea)) return '高端护肤品牌短片';
  if (/校园|孩子|学院/.test(idea)) return '孤岛学院 · 剧情短片';
  return state.contentMode === '剧情短片' ? '未命名剧情项目' : '未命名广告项目';
}

function inferIdea(idea) {
  if (/不锈钢|佛山|金属/.test(idea)) {
    state.world = '现代中国 · 佛山';
    state.style = /科技/.test(idea) ? '高端工业科技 · 冷银蓝光' : '现代工业质感';
    state.medium = '真人实拍';
  } else if (/古代|古装|江湖/.test(idea)) {
    state.world = '中国古代 · 具体时期待确认';
    state.style = '电影感东方美学';
    state.medium = '真人写实';
  } else {
    state.world = '现代 · 地区待确认';
    state.style = state.contentMode === '剧情短片' ? '电影感叙事' : '高质感商业影像';
    state.medium = '真人实拍';
  }
}

function handleAction(value, label) {
  addMessage('user', `<p>${escapeHtml(label)}</p>`);
  if (value.startsWith('mode:')) {
    state.contentMode = value.split(':')[1];
    state.phase = 'idea'; state.userCount = 1; state.pendingCount = 4; state.progress = 28;
    syncContract();
    assistantAfter(420, () => {
      addMessage('assistant', `<p>好的，先按<b>${escapeHtml(state.contentMode)}</b>来整理。请像和导演聊天一样，说清楚你最想表达的内容。</p><p>不用写成专业方案，一两句话也可以。我会保留你明确说出的事实，再单独标出我的建议。</p>`);
      updateComposer('当前：描述核心创意、商品或故事冲突', '例如：30秒不锈钢广告，突出佛山制造、耐腐蚀和高端科技感…');
    });
    return;
  }
  if (value.startsWith('duration:')) {
    state.duration = Number(value.split(':')[1]);
    state.phase = 'format'; state.userCount += 1; state.pendingCount = 2; state.progress = 65;
    syncContract();
    assistantAfter(360, () => {
      addMessage('assistant', '<p>时长已确认。你准备把成片主要发布在哪里？这会决定画幅和镜头构图。</p>', [
        { label: '竖屏 9:16 · 抖音/视频号', value: 'ratio:9:16' },
        { label: '横屏 16:9 · 宣传片', value: 'ratio:16:9' },
        { label: '方形 1:1 · 社交媒体', value: 'ratio:1:1' },
      ]);
      updateComposer('当前：确认发布画幅', '也可以补充主要发布平台…');
    });
    return;
  }
  if (value.startsWith('ratio:')) {
    state.ratio = value.slice('ratio:'.length);
    state.phase = 'style'; state.userCount += 1; state.pendingCount = 1; state.progress = 78;
    syncContract();
    assistantAfter(360, () => {
      addMessage('assistant', `<p>现在还差最后一个创作决定。根据你的想法，我建议使用<b>${escapeHtml(state.style)}</b>，你可以采用建议，也可以换一个方向。</p>`, [
        { label: `采用建议：${state.style}`, value: 'style:accept' },
        { label: '更写实克制', value: 'style:real' },
        { label: '更未来科技', value: 'style:future' },
      ]);
      updateComposer('当前：确认视觉方向', '也可以直接描述你喜欢的画面感觉…');
    });
    return;
  }
  if (value.startsWith('style:')) {
    if (value === 'style:real') state.style = '真实摄影 · 克制高级';
    if (value === 'style:future') state.style = '未来科技 · 强视觉光影';
    state.phase = 'ready'; state.userCount += 1; state.aiCount = 2; state.pendingCount = 0; state.progress = 100;
    syncContract();
    assistantAfter(420, () => {
      addMessage('assistant', `<p><b>第一步的信息已经整理完成。</b></p><p>我会依据右侧确认单先创作详细剧情和对白，不会提前生成人物、场景、图片或视频。</p><span class="notice">请检查右侧项目确认单。确认后，下一步先进入“剧情与对白”。</span>`);
      updateComposer('当前：检查右侧项目确认单', '还可以继续补充或纠正设想…');
    });
  }
}

function submitIdea(text) {
  state.idea = text;
  state.projectName = guessProject(text);
  inferIdea(text);
  state.phase = 'duration'; state.userCount = 2; state.aiCount = 5; state.pendingCount = 3; state.progress = 50;
  syncContract();
  assistantAfter(520, () => {
    addMessage('assistant', `<p>我先这样理解你的设想：</p><ul><li>项目：${escapeHtml(state.projectName)}</li><li>核心内容：${escapeHtml(text)}</li><li>建议视觉：${escapeHtml(state.style)}</li><li>时代地区：${escapeHtml(state.world)}</li></ul><span class="notice">视觉方向和项目名称目前属于AI建议，你仍然可以修改。</span><p>你希望成片大约多长？</p>`, [
      { label: '15秒 · 单一卖点', value: 'duration:15' },
      { label: '30秒 · 推荐', value: 'duration:30' },
      { label: '60秒 · 完整叙事', value: 'duration:60' },
    ]);
    updateComposer('当前：确认目标时长', '也可以直接输入其他时长或补充要求…');
  });
}

function submitInput() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  addMessage('user', `<p>${escapeHtml(text)}</p>`);
  if (state.phase === 'contentMode') {
    state.contentMode = /故事|剧情|短剧|人物/.test(text) ? '剧情短片' : '商业广告';
    state.userCount = 1;
    submitIdea(text);
  } else if (state.phase === 'idea') {
    submitIdea(text);
  } else {
    assistantAfter(320, () => addMessage('assistant', '<p>补充内容已记录在本轮对话中。正式版本会把这类补充标记为“待同步到项目确认单”，避免AI静默覆盖已经确认的信息。</p>'));
  }
}

function renderScriptDraft() {
  document.querySelector('[data-stage="brief"]').classList.remove('is-active');
  document.querySelector('[data-stage="brief"]').classList.add('is-complete');
  document.querySelector('[data-stage="plot"]').classList.add('is-active');
  composerContext.textContent = '当前：审阅详细剧情与对白草案';
  confirmButton.disabled = true;
  confirmButton.textContent = '剧情草案已生成';
  addMessage('assistant', `<p><b>项目设想已确认，下面先进入“剧情与对白”。</b></p><p>这是根据确认单生成的演示草案。真实产品中，你可以直接对我说“第三段不要旁白”“加强产品测试过程”，我只会修改受影响段落。</p>
    <div class="script-card">
      <header><b>《佛山智造 · 不锈钢品牌广告》</b><span>30秒 · 9:16 · 剧情草案 V1</span></header>
      <section class="script-scene"><b>【00:00–00:05】火与钢的开场</b><p><strong>画面：</strong>暗场中熔炉亮起，炽热钢水倾泻，火星在黑色空间中划过。镜头快速逼近被锻压成型的不锈钢表面。</p><p><strong>旁白：</strong>“每一寸可靠，都从对材料的敬畏开始。”</p></section>
      <section class="script-scene"><b>【00:05–00:14】耐腐蚀实验</b><p><strong>画面：</strong>冷银色实验室内，不锈钢样板同时经历盐雾、水流和高温测试；微距展示表面依然平整明亮。</p><p><strong>旁白：</strong>“耐腐蚀、耐高温，经得住时间，也经得住每一次严苛检验。”</p></section>
      <section class="script-scene"><b>【00:14–00:24】从制造到应用</b><p><strong>画面：</strong>钢卷切割、精密折弯与自动化质检连续转场，随后切入高端商业空间、现代厨房与建筑幕墙。</p><p><strong>工程师：</strong>“我们交付的不只是一块钢，而是长期稳定的标准。”</p></section>
      <section class="script-scene"><b>【00:24–00:30】品牌收束</b><p><strong>画面：</strong>成品表面映出佛山城市天际线，品牌Logo在冷银蓝光中出现。</p><p><strong>旁白：</strong>“佛山智造，让品质经得起看见。”</p></section>
      <footer class="script-actions"><button type="button" data-script-edit>通过对话修改剧情</button><button type="button" data-script-compare>查看修改影响</button><button class="primary" type="button" data-next-person>确认剧情，进入人物</button></footer>
    </div>`);
  conversation.querySelector('[data-script-edit]').addEventListener('click', () => {
    input.focus(); input.placeholder = '例如：第二段不要实验室，改成海边盐雾环境测试…';
    showToast('可以直接在下方输入修改意见；Demo不会真正调用模型。');
  });
  conversation.querySelector('[data-script-compare]').addEventListener('click', () => showToast('正式版会标记受影响的人物、场景和镜头，未受影响资产继续复用。'));
  conversation.querySelector('[data-next-person]').addEventListener('click', () => showToast('Demo体验到这里：真实流程下一步才会从已确认剧情提取人物。'));
}

function confirmConcept() {
  if (state.phase !== 'ready') return;
  confirmButton.disabled = true;
  confirmButton.textContent = '正在整理剧情草案…';
  assistantAfter(650, renderScriptDraft);
}

function loadSample() {
  conversation.innerHTML = '';
  state = {
    phase: 'ready', projectName: '佛山智造 · 不锈钢品牌广告', contentMode: '商业广告',
    idea: '制作一条30秒不锈钢品牌广告，突出佛山制造、耐腐蚀、高端工艺和科技感。',
    duration: 30, ratio: '9:16', resolution: '1080p', world: '现代中国 · 佛山', medium: '真人实拍',
    style: '高端工业科技 · 冷银蓝光', userCount: 6, aiCount: 2, pendingCount: 0, progress: 100,
  };
  syncContract();
  addMessage('assistant', '<p>你好，我是你的<b>导演助理</b>。你不需要先填完整表单，直接告诉我想做什么，我会逐步整理。</p>');
  addMessage('user', '<p>我想做一个30秒的不锈钢商业广告，突出佛山制造、高端、耐腐蚀，画面要有科技感。</p>');
  addMessage('assistant', '<p>我已经把示例设想整理到右侧确认单，包括内容类型、时长、画幅、时代地区和视觉建议。</p><p><b>你现在可以点击右侧“确认设想，生成剧情草案”查看下一步效果。</b></p><span class="notice">当前只生成演示文本，不调用任何模型。</span>');
  updateComposer('当前：检查右侧项目确认单', '还可以继续补充设想…');
}

function resetDemo() {
  window.clearTimeout(toastTimer);
  document.querySelector('[data-toast]').classList.remove('is-visible');
  state = initialState();
  conversation.innerHTML = '';
  document.querySelectorAll('.stage-list li').forEach(item => item.classList.remove('is-active', 'is-complete'));
  document.querySelector('[data-stage="brief"]').classList.add('is-active');
  confirmButton.textContent = '确认设想，生成剧情草案';
  syncContract();
  addMessage('assistant', '<p>你好，我是你的<b>导演助理</b>。</p><p>不用先填完整表单。你可以像和导演讨论一样告诉我想做什么，我会一边追问，一边把确定的信息整理到右侧。</p><span class="notice">这一阶段只整理设想，不生成图片或视频，也不会产生视觉生成费用。</span>', [
    { label: '商业广告', value: 'mode:商业广告' },
    { label: '剧情短片', value: 'mode:剧情短片' },
    { label: '参考视频改编', value: 'mode:参考视频改编' },
  ]);
  updateComposer('当前：先选择想制作的内容类型', '也可以直接说：我想做一个30秒的不锈钢品牌广告…');
}

function showToast(message) {
  const toast = document.querySelector('[data-toast]');
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

sendButton.addEventListener('click', submitInput);
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitInput(); }
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 110)}px`;
});
confirmButton.addEventListener('click', confirmConcept);
document.querySelector('[data-sample]').addEventListener('click', loadSample);
document.querySelector('[data-reset]').addEventListener('click', resetDemo);
document.querySelector('[data-attach]').addEventListener('click', () => showToast('正式版这里可上传图片、剧本、参考视频和品牌资料。'));
document.querySelector('[data-professional]').addEventListener('click', () => showToast('正式版会在这里打开完整设置，并与对话确认单双向同步。'));

resetDemo();
