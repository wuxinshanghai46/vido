(function () {
  const app = document.getElementById('novelApp');
  const createView = document.getElementById('nvCreateView');
  const workView = document.getElementById('nvWorkView');
  const taskView = document.getElementById('nvTaskView');
  const toast = document.getElementById('nvToast');

  const state = {
    view: 'create',
    panel: 'world',
    novels: [],
    current: null,
    currentChapter: 1,
    taskType: 'all',
    taskStatus: 'all',
    createMode: 'idea',
    creating: false,
    selectedRelationName: '',
    graphLayouts: {},
    graphViewports: {},
    graphDrag: null,
    graphPan: null,
    graphSuppressClick: false,
    chapterWriting: null,
    generation: null,
    taxonomy: null,
    importFile: null,
    createError: '',
    config: {
      genre: 'auto',
      subtype: 'auto',
      channel: 'auto',
      culture: 'chinese',
      length: 'short'
    }
  };

  let GENRES = [
    { key: 'auto', label: 'AI 推荐', api: 'auto', subtypes: [] },
    { key: 'fantasy', label: '玄幻', api: 'fantasy', subtypes: ['系统流', '升级流', '废柴逆袭', '宗门争霸', '家族崛起', '无敌流', '幕后流', '群像', '爽文'] },
    { key: 'xianxia', label: '仙侠', api: 'xianxia', subtypes: ['凡人修仙', '宗门修行', '剑修', '阵法丹道', '仙朝争霸', '师徒线', '红尘问道', '重生修仙'] },
    { key: 'urban', label: '都市', api: 'urban', subtypes: ['职场', '商战', '都市异能', '神医', '鉴宝', '重生创业', '娱乐圈', '生活流', '赘婿'] },
    { key: 'historical', label: '历史', api: 'historical', subtypes: ['架空历史', '权谋', '寒门崛起', '争霸', '朝堂', '边关', '种田', '穿越', '重生文'] },
    { key: 'scifi', label: '科幻', api: 'scifi', subtypes: ['星际', '赛博朋克', '末日', '机甲', '人工智能', '时间循环', '硬科幻', '废土'] },
    { key: 'wuxia', label: '武侠', api: 'wuxia', subtypes: ['江湖群像', '门派恩怨', '复仇', '镖局', '朝廷江湖', '侠义成长'] },
    { key: 'romance', label: '言情', api: 'romance', subtypes: ['现代言情', '古代言情', '幻想言情', '快穿', '重生', '破镜重圆', '先婚后爱', '女性成长'] },
    { key: 'mystery', label: '悬疑', api: 'mystery', subtypes: ['刑侦', '推理', '无限流', '密室', '心理悬疑', '民俗悬疑', '惊悚解谜'] },
    { key: 'horror', label: '灵异', api: 'horror', subtypes: ['民俗怪谈', '规则怪谈', '诡异复苏', '都市传说', '恐怖直播', '驱邪'] },
    { key: 'game', label: '游戏', api: 'game', subtypes: ['电竞', '游戏异界', '网游', '卡牌', '副本流', '职业选手'] },
    { key: 'realism', label: '现实', api: 'realism', subtypes: ['现实主义', '行业文', '年代', '乡村振兴', '家庭', '创业'] },
    { key: 'rebirth', label: '重生', api: 'rebirth', subtypes: ['重生文', '重生创业', '重生复仇', '重生年代', '重生修仙'] },
    { key: 'crossing', label: '穿越', api: 'crossing', subtypes: ['穿越文', '历史穿越', '异世穿越', '魂穿', '身穿'] },
    { key: 'light', label: '轻小说', api: 'light', subtypes: ['日轻', '校园', '异世界', '恋爱喜剧', '青春向'] }
  ];
  let CHANNELS = [
    { key: 'auto', label: 'AI 推荐' },
    { key: 'male', label: '男频' },
    { key: 'female', label: '女频' },
    { key: 'publish', label: '出版向' },
    { key: 'short', label: '短故事' },
    { key: 'young', label: '青年向' },
    { key: 'all_age', label: '全年龄' },
    { key: 'drama', label: '强剧情' },
    { key: 'emotion', label: '情感向' },
    { key: 'suspense', label: '悬疑向' },
    { key: 'light', label: '轻小说' },
    { key: 'female_growth', label: '女性成长' },
    { key: '爽文', label: '爽文' },
    { key: '男频文', label: '男频文' },
    { key: '女频文', label: '女频文' }
  ];
  const CULTURES = [
    { key: 'chinese', label: '中国语境', api: 'chinese' },
    { key: 'overseas', label: '国外语境', api: 'overseas' },
    { key: 'mixed', label: '混合语境', api: 'mixed' }
  ];
  const LENGTHS = [
    { key: 'flash', label: '短篇小说', api: 'flash', chapter_count: 3, chapter_words: 1500 },
    { key: 'short', label: '中篇小说', api: 'short', chapter_count: 8, chapter_words: 2200 },
    { key: 'long', label: '长篇小说', api: 'long', chapter_count: 30, chapter_words: 3000 }
  ];

  const FLOW = [
    { key: 'world', title: '世界观设定', sub: '规则、禁区、主线承诺' },
    { key: 'outline', title: '剧情大纲', sub: '章节轴、事件因果、伏笔' },
    { key: 'graph', title: '人物关系图', sub: '从大纲和章节事实提取' },
    { key: 'write', title: '章节创作', sub: '按章节任务书写作' }
  ];

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function arr(value) {
    return Array.isArray(value) ? value : [];
  }

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function firstText(...values) {
    for (const value of values) {
      const v = text(value);
      if (v) return v;
    }
    return '';
  }

  function richText(value, labels = {}) {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) {
      return value.map(item => richText(item, labels)).filter(Boolean).join('\n');
    }
    if (!plainObject(value)) return '';
    return Object.entries(value)
      .map(([key, item]) => {
        const body = richText(item, labels);
        if (!body) return '';
        return `${labels[key] || key}：${body}`;
      })
      .filter(Boolean)
      .join('\n');
  }

  function chapterContent(chapter = {}) {
    return firstText(chapter.content, chapter.text, chapter.body, chapter.draft, chapter.markdown, chapter.raw_content);
  }

  function chapterTitle(chapter = {}, fallback = '') {
    return firstText(chapter.title, chapter.name, chapter.chapter_title, fallback);
  }

  function entityName(entity = {}) {
    return firstText(entity.name, entity.character_name, entity.title);
  }

  function entityGender(entity = {}) {
    const raw = firstText(entity.gender, entity.sex, entity.gender_presentation, entity.profile?.gender, entity.bio?.gender, entity.role, entity.identity, entity.name).toLowerCase();
    if (/female|woman|girl|女|女性|姑娘|少女/.test(raw)) return 'female';
    if (/male|man|boy|男|男性|少年/.test(raw)) return 'male';
    return 'unknown';
  }

  function characterRoleText(entity = {}) {
    return [
      entity.name,
      entity.role,
      entity.identity,
      entity.goal,
      entity.motivation,
      entity.conflict,
      entity.personality,
      entity.arc,
      entity.evidence,
      entity.current_state
    ].map(richText).filter(Boolean).join(' ');
  }

  function genderLabel(gender) {
    if (gender === 'female') return '女';
    if (gender === 'male') return '男';
    return '待确认';
  }

  function relationEndpointGender(rel = {}, name = '', entityByName = characterMap()) {
    const entity = entityByName.get(name) || {};
    const direct = entityGender(entity);
    if (direct !== 'unknown') return direct;
    const body = [rel.type, rel.relation, rel.description, rel.tension, rel.evidence].map(richText).join(' ');
    if (!body) return 'unknown';
    const isFrom = text(rel.from) === name;
    if (/男主|男方|男性主角|male lead/i.test(body) && /女主|女方|女性主角|female lead/i.test(body)) {
      const maleFirst = body.search(/男主|男方|男性主角|male lead/i) <= body.search(/女主|女方|女性主角|female lead/i);
      return isFrom ? (maleFirst ? 'male' : 'female') : (maleFirst ? 'female' : 'male');
    }
    if (new RegExp(`${name}[^\\n，。；;:：]{0,8}(男|男性|男主)`).test(body)) return 'male';
    if (new RegExp(`${name}[^\\n，。；;:：]{0,8}(女|女性|女主)`).test(body)) return 'female';
    return 'unknown';
  }

  function endpointDisplayLabel(rel = {}, name = '', entityByName = characterMap()) {
    const gender = relationEndpointGender(rel, name, entityByName);
    if (gender !== 'unknown') return genderLabel(gender);
    const entity = entityByName.get(name) || {};
    return firstText(entity.role, entity.identity, entity.current_state, '性别待确认');
  }

  function token() {
    return typeof getToken === 'function' ? getToken() : '';
  }

  async function requireNovelAuth() {
    if (!token() && typeof tryRefresh === 'function') {
      await tryRefresh();
    }
    if (!token()) {
      window.location.href = '/?login=1&target=' + encodeURIComponent('/ai-novel');
      return false;
    }
    if (typeof fetchCurrentUser === 'function') {
      const user = await fetchCurrentUser();
      if (!user) {
        if (typeof clearToken === 'function') clearToken();
        window.location.href = '/?login=1&target=' + encodeURIComponent('/ai-novel');
        return false;
      }
    }
    return true;
  }

  async function api(path, options = {}) {
    const res = await authFetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const bodyText = await res.text();
    let data = {};
    if (bodyText) {
      try { data = JSON.parse(bodyText); } catch { data = { success: false, error: bodyText }; }
    }
    if (!res.ok || data.success === false) {
      const err = new Error(data.error || data.message || `${res.status} ${res.statusText}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function showToast(message, isError = false) {
    toast.textContent = message;
    toast.classList.toggle('is-error', !!isError);
    toast.classList.add('is-visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 3600);
  }

  function setCreateError(message = '') {
    state.createError = message || '';
    const box = document.getElementById('nvCreateError');
    if (!box) return;
    box.hidden = !state.createError;
    box.textContent = state.createError;
  }

  function createErrorMessage(error) {
    const attempts = arr(error?.data?.attempts || error?.attempts);
    const attemptText = attempts
      .filter(item => item && item.error)
      .slice(0, 2)
      .map(item => `${item.provider_id || '模型'}/${item.model_id || ''}: ${item.error}`)
      .join('；');
    return [error?.message || '小说方案生成失败', attemptText].filter(Boolean).join('\n');
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.oldText = button.textContent;
      button.textContent = label || '处理中...';
      button.disabled = true;
    } else {
      button.textContent = button.dataset.oldText || button.textContent;
      button.disabled = false;
    }
  }

  function renderGenerationStatus(type = 'outline') {
    if (!state.generation || state.generation.type !== type) return '';
    const steps = state.generation.steps || [
      '重读用户要求与已保存档案',
      '检索小说写作知识库',
      '检查人物、起因、矛盾和风险',
      '生成并修复章节任务书'
    ];
    return `<section class="nv-generation-status" aria-live="polite">
      <div class="nv-generation-orbit"><span></span><span></span><span></span></div>
      <div>
        <b>${esc(state.generation.title || '正在生成')}</b>
        <p>${esc(state.generation.detail || '正在让写作 agent 重新学习素材、知识库和章节质量门槛。')}</p>
        <div class="nv-generation-steps">${steps.map((step, index) => `<span class="${index === 0 ? 'is-active' : ''}">${esc(step)}</span>`).join('')}</div>
      </div>
    </section>`;
  }

  function optionLabel(list, key) {
    return list.find(item => item.key === key)?.label || key || '';
  }

  function mergeUniqueOptions(base = [], incoming = []) {
    const map = new Map(base.map(item => [item.key, { ...item, subtypes: [...arr(item.subtypes)] }]));
    arr(incoming).forEach(item => {
      const key = item.key || item.api || item.label;
      if (!key) return;
      const current = map.get(key) || {};
      map.set(key, {
        ...current,
        ...item,
        key,
        subtypes: Array.from(new Set([...arr(current.subtypes), ...arr(item.subtypes)]))
      });
    });
    return Array.from(map.values());
  }

  async function loadNovelTaxonomy() {
    try {
      const data = await api('/api/novel/taxonomy');
      const taxonomy = data.taxonomy || data.data || {};
      GENRES = mergeUniqueOptions(GENRES, taxonomy.genres);
      CHANNELS = mergeUniqueOptions(CHANNELS, taxonomy.channels);
      state.taxonomy = taxonomy;
    } catch (error) {
      console.warn('小说分类树加载失败，使用基础分类选项', error);
      state.taxonomy = { kb: { total: 0, drama_total: 0, drama_subcategories: [] } };
    }
  }

  function genreOf(novel) {
    return GENRES.find(item => item.api === novel.genre || item.key === novel.genre) || GENRES[0];
  }

  function cultureOf(novel) {
    return CULTURES.find(item => item.api === novel.cultural_region || item.key === novel.cultural_region) || CULTURES[0];
  }

  function lengthOf(novel) {
    return LENGTHS.find(item => item.api === novel.novel_type || item.key === novel.novel_type) || LENGTHS[1];
  }

  function chapters(novel = state.current) {
    const count = Number(novel?.chapter_count || novel?.outline?.chapters?.length || 0);
    const existing = arr(novel?.chapters);
    const byIndex = new Map(existing.map(ch => [Number(ch.index), ch]));
    const total = Math.max(count, existing.length, 1);
    return Array.from({ length: total }, (_, i) => {
      const index = i + 1;
      return byIndex.get(index) || {
        index,
        title: arr(novel?.outline?.chapters)[i]?.title || `第 ${index} 章`,
        content: '',
        status: 'draft',
        word_count: 0
      };
    });
  }

  function isChapterDone(chapter) {
    return text(chapterContent(chapter)) && (chapter.status === 'done' || chapter.submitted_at || chapter.committed_at);
  }

  function allChaptersDone(novel) {
    const list = chapters(novel);
    return list.length > 0 && list.every(isChapterDone);
  }

  function lifecycle(novel) {
    const runtime = novel?.runtime_status || {};
    if (novel?.status === 'completed') return { key: 'done', label: '已完成', cls: 'done' };
    if (runtime.last_error || novel?.status === 'failed') return { key: 'failed', label: '制作失败', cls: 'failed' };
    if (allChaptersDone(novel)) return { key: 'making', label: '待完结', cls: 'pending' };
    if (novel?.status === 'generating' || novel?.status === 'reviewing') return { key: 'making', label: '制作中', cls: 'running' };
    return { key: 'making', label: '编写中', cls: 'running' };
  }

  function chapterPhase(novel) {
    if (novel?.status === 'completed') return '已完结';
    if (allChaptersDone(novel)) return '待确认完结';
    const list = chapters(novel);
    const done = list.filter(isChapterDone).length;
    return `第 ${Math.min(done + 1, list.length)} / ${list.length} 章`;
  }

  function updateShell() {
    app.classList.toggle('has-current', !!state.current);
    app.classList.toggle('is-create-view', state.view === 'create');
    document.querySelectorAll('.nv-nav-item').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.view === state.view);
    });
    const title = state.view === 'tasks' ? '任务中心'
      : state.generation?.type === 'create' ? '生成小说方案'
        : state.current ? state.current.title : 'AI 小说工作台';
    document.getElementById('nvPageTitle').textContent = title;
    document.getElementById('nvCrumb').textContent = state.current && state.view === 'work'
      ? `AI 小说 / 当前小说`
      : state.view === 'tasks'
        ? 'AI 小说 / 任务中心'
        : 'AI 小说 / 小说创作';
  }

  function switchView(view) {
    state.view = view;
    createView.classList.toggle('is-active', view === 'create');
    workView.classList.toggle('is-active', view === 'work');
    taskView.classList.toggle('is-active', view === 'tasks');
    updateShell();
    if (view === 'tasks') renderTasks();
    if (view === 'work') renderWork();
    if (view === 'create') renderHomeList();
  }

  async function loadNovels() {
    const data = await api('/api/novel');
    state.novels = arr(data.novels || data.data || data.items);
    if (state.current) {
      const fresh = state.novels.find(item => item.id === state.current.id);
      if (fresh) state.current = { ...state.current, ...fresh };
    }
    renderHomeList();
    if (state.view === 'tasks') renderTasks();
  }

  async function loadNovel(id) {
    const data = await api('/api/novel/' + encodeURIComponent(id));
    state.current = data.novel || data.data;
    if (!state.current) throw new Error('接口没有返回小说数据');
    const firstDraft = chapters(state.current).find(ch => !isChapterDone(ch));
    state.currentChapter = firstDraft?.index || 1;
    state.panel = firstDraft ? 'world' : 'write';
    switchView('work');
  }

  function renderHomeList() {
    const box = document.getElementById('nvProjectList');
    if (!box) return;
    if (!state.novels.length) {
      box.innerHTML = '<div class="nv-empty">暂无真实小说项目。写下想法并生成后，会出现在这里。</div>';
      return;
    }
    box.innerHTML = state.novels.slice().sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).map(novel => {
      const life = lifecycle(novel);
      const type = lengthOf(novel).label;
      const words = Number(novel.total_words || 0);
      return `<button class="nv-project-card" type="button" data-open-novel="${esc(novel.id)}">
        <b>${esc(novel.title || '未命名小说')}</b>
        <p>${esc(type)} · ${words} 字 · ${esc(chapterPhase(novel))}</p>
        <p><span class="nv-pill ${life.cls}">${esc(life.label)}</span></p>
      </button>`;
    }).join('');
  }

  function renderChoiceGroup(containerId, list, selectedKey, onPick) {
    const el = document.getElementById(containerId);
    el.innerHTML = list.map(item => `<button class="nv-choice-chip ${item.key === selectedKey ? 'is-active' : ''}" type="button" data-choice="${esc(item.key)}">${esc(item.label)}</button>`).join('');
    el.querySelectorAll('[data-choice]').forEach(btn => {
      btn.addEventListener('click', () => onPick(btn.dataset.choice));
    });
  }

  function renderKnowledgePreview() {
    const box = document.getElementById('nvKnowledgePreview');
    if (!box) return;
    const kb = state.taxonomy?.kb || {};
    const subs = arr(kb.drama_subcategories).slice(0, 24);
    const total = Number(kb.total || 0);
    const dramaTotal = Number(kb.drama_total || 0);
    box.innerHTML = `<div class="nv-kb-preview-head">
      <strong>知识库合集</strong>
      <span>${total ? `${total} 条知识 · 网文/剧情 ${dramaTotal} 条` : '知识库分类未加载，仅显示基础选项'}</span>
    </div>
    <div class="nv-kb-tags">${subs.length ? subs.map(name => `<button class="nv-kb-tag" type="button" data-kb-subtype="${esc(name)}">${esc(name)}</button>`).join('') : '<span>暂无可展示分类</span>'}</div>`;
    box.querySelectorAll('[data-kb-subtype]').forEach(btn => {
      btn.addEventListener('click', () => {
        const label = btn.dataset.kbSubtype;
        const matched = GENRES.find(item => arr(item.subtypes).includes(label));
        if (matched) state.config.genre = matched.key;
        state.config.subtype = label;
        renderCreateChoices();
      });
    });
  }

  function renderCreateChoices() {
    renderChoiceGroup('nvGenreChoices', GENRES, state.config.genre, key => {
      state.config.genre = key;
      state.config.subtype = 'auto';
      renderCreateChoices();
    });
    const currentGenre = GENRES.find(item => item.key === state.config.genre);
    const subtypeList = currentGenre && currentGenre.subtypes.length
      ? [{ key: 'auto', label: 'AI 推荐' }, ...currentGenre.subtypes.map(label => ({ key: label, label }))]
      : [{ key: 'auto', label: 'AI 推荐' }];
    document.getElementById('nvSubtypeSection').style.display = subtypeList.length > 1 ? '' : 'none';
    renderChoiceGroup('nvSubtypeChoices', subtypeList, state.config.subtype, key => {
      state.config.subtype = key;
      renderCreateChoices();
    });
    renderChoiceGroup('nvChannelChoices', CHANNELS, state.config.channel, key => {
      state.config.channel = key;
      renderCreateChoices();
    });
    renderChoiceGroup('nvCultureChoices', CULTURES, state.config.culture, key => {
      state.config.culture = key;
      renderCreateChoices();
    });
    renderChoiceGroup('nvLengthChoices', LENGTHS, state.config.length, key => {
      state.config.length = key;
      renderCreateChoices();
    });
    renderKnowledgePreview();
    const summary = createSummary();
    document.getElementById('nvModalSummary').textContent = summary;
    document.getElementById('nvSelectedLine').textContent = '类型会在下一步弹窗中选择：' + summary;
  }

  async function handleImportFile(file) {
    if (!file) return;
    state.importFile = { name: file.name, type: file.type, size: file.size };
    const status = document.getElementById('nvImportFileStatus');
    const isTextLike = /^text\//.test(file.type) || /\.(txt|md|json|srt|vtt|ass|csv)$/i.test(file.name);
    if (isTextLike) {
      const content = await file.text();
      document.getElementById('nvImportInput').value = content.slice(0, 180000);
      status.textContent = `已读取：${file.name}，${content.length} 字符。`;
      showToast('导入文本已读取，可以继续生成小说方案。');
      return;
    }
    if (/^video\//.test(file.type) || /\.(mp4|mov|webm|m4v)$/i.test(file.name)) {
      status.textContent = `已选择参考视频：${file.name}。当前会记录为参考素材；如需解析字幕，请同时上传字幕或粘贴文本。`;
      showToast('参考视频已选择。');
      return;
    }
    status.textContent = `已选择文件：${file.name}。如果无法读取，请粘贴文本内容。`;
  }

  function createSummary() {
    return [
      optionLabel(GENRES, state.config.genre),
      state.config.subtype === 'auto' ? '按内容判断细分' : state.config.subtype,
      optionLabel(CHANNELS, state.config.channel),
      optionLabel(CULTURES, state.config.culture),
      optionLabel(LENGTHS, state.config.length)
    ].join(' / ');
  }

  async function createProject(button) {
    if (state.creating) return;
    const idea = text(document.getElementById('nvIdeaInput').value);
    const source = text(document.getElementById('nvImportInput').value);
    const mode = state.createMode;
    if (mode === 'idea' && !idea) {
      document.getElementById('nvCreateModal').classList.remove('is-open');
      setCreateError('请先写下核心想法：至少包含主角、目标、冲突、背景或一个关键事件。');
      throw new Error(state.createError);
    }
    if (mode === 'import' && !source) {
      document.getElementById('nvCreateModal').classList.remove('is-open');
      setCreateError('请先粘贴已有作品内容，或上传文本类文件后再生成小说方案。');
      throw new Error(state.createError);
    }
    setCreateError('');
    state.creating = true;
    setBusy(button, true, '生成方案中...');
    state.panel = 'world';
    state.generation = {
      type: 'create',
      title: '正在生成小说方案',
      detail: '正在读取你的创作要求、类型选择和知识库，生成作品承诺、世界观、剧情大纲、人物与章节任务书。',
      steps: ['读取用户要求', '匹配题材知识库', '构建世界观和冲突', '生成大纲与人物关系']
    };
    document.getElementById('nvCreateModal').classList.remove('is-open');
    switchView('work');

    try {
      const genre = GENRES.find(item => item.key === state.config.genre) || GENRES[0];
      const culture = CULTURES.find(item => item.key === state.config.culture) || CULTURES[0];
      const length = LENGTHS.find(item => item.key === state.config.length) || LENGTHS[1];
      const channel = optionLabel(CHANNELS, state.config.channel);
      const subtype = state.config.subtype === 'auto' ? '' : state.config.subtype;

      const data = await api('/api/novel/ai-create', {
        method: 'POST',
        body: JSON.stringify({
          mode,
          idea,
          source_text: source,
          genre: genre.api === 'auto' ? '' : genre.api,
          subtype,
          channel: state.config.channel === 'auto' ? '' : channel,
          cultural_region: culture.api,
          novel_type: length.api,
          chapter_count: length.chapter_count,
          chapter_words: length.chapter_words
        })
      });
      state.current = data.novel;
      state.panel = 'world';
      state.currentChapter = 1;
      state.generation = null;
      await loadNovels();
      switchView('work');
      showToast('小说方案已生成，请先确认世界观。');
    } catch (error) {
      state.generation = null;
      switchView('create');
      document.getElementById('nvCreateModal').classList.remove('is-open');
      setCreateError(createErrorMessage(error));
      throw error;
    } finally {
      state.creating = false;
      setBusy(button, false);
    }
  }

  function renderFlow() {
    return `<div class="nv-flow-copy"><b>创作流程</b>：世界观设定 → 剧情大纲 → 人物关系图 → 章节创作。每一步都可以保存，章节提交后才进入完结判断。</div>
      <div class="nv-flow">${FLOW.map((step, idx) => `<button class="nv-flow-step ${state.panel === step.key ? 'is-active' : ''}" type="button" data-panel="${step.key}">
        <span class="nv-flow-index">${idx + 1}</span>
        <span><strong>${esc(step.title)}</strong><small>${esc(step.sub)}</small></span>
      </button>`).join('')}</div>`;
  }

  function renderWork() {
    if (state.generation?.type === 'create') {
      workView.innerHTML = `<div class="nv-work-page nv-generating-page">
        ${renderGenerationStatus('create')}
      </div>`;
      return;
    }
    if (!state.current) {
      workView.innerHTML = '<div class="nv-empty">请先创建或选择一部小说。</div>';
      return;
    }
    const novel = state.current;
    const type = lengthOf(novel).label;
    const culture = cultureOf(novel).label;
    const genre = genreOf(novel).label;
    workView.innerHTML = `<div class="nv-work-page">
      <div class="nv-project-head">
        <div>
          <h2>${esc(novel.title || '未命名小说')}</h2>
          <div class="nv-project-meta">${esc(type)} / ${esc(culture)} / ${esc(genre)} / ${Number(novel.total_words || 0)} 字</div>
        </div>
        <div class="nv-action-buttons">
          <button class="nv-btn nv-btn-muted" type="button" data-export>导出</button>
          ${novel.status === 'completed' ? '<span class="nv-pill done">已完结</span>' : ''}
        </div>
      </div>
      ${renderFlow()}
      <div id="nvPanelMount">${renderPanel()}</div>
    </div>`;
  }

  function renderPanel() {
    if (state.panel === 'world') return renderWorldPanel();
    if (state.panel === 'outline') return renderOutlinePanel();
    if (state.panel === 'graph') return renderGraphPanel();
    return renderWritePanel();
  }

  function contractValue(key) {
    return state.current?.contract?.[key] || state.current?.story_bible?.[key] || '';
  }

  function hasNovelOutline(novel = state.current) {
    const outline = novel?.outline || {};
    return arr(outline.chapters).length > 0 || !!firstText(outline.synopsis, outline.summary, outline.story_summary);
  }

  function renderWorldPanel() {
    const bible = state.current.story_bible || {};
    const outline = state.current.outline || {};
    const contract = state.current.contract || {};
    const worldObject = plainObject(contract.world) ? contract.world : (plainObject(bible.world) ? bible.world : outline.world);
    const world = firstText(
      plainObject(contract.world) ? '' : contract.world,
      richText(worldObject, {
        era: '时代背景',
        setting: '主要舞台',
        rules: '世界规则',
        power_system: '力量体系',
        tone: '故事基调',
        visual_style: '视觉风格',
        taboos: '不可写崩点',
        cost: '代价'
      }),
      outline.worldview,
      state.current.description
    );
    const rules = firstText(
      contract.rules,
      contract.constraints?.continuity_rules,
      contract.constraints?.forbidden,
      plainObject(contract.world) ? contract.world.rules : '',
      plainObject(contract.world) ? contract.world.taboos : '',
      bible.world?.rules,
      outline.world?.rules
    );
    const promise = firstText(contract.promise, bible.promise, outline.promise, contract.logline, state.current.logline, bible.logline, outline.logline, state.current.description);
    const writingRules = arr(bible.writing_rules || outline.writing_rules).map(item => richText(item)).filter(Boolean).join('\n');
    const dossier = [
      { title: '核心主题', value: firstText(bible.theme, outline.theme) },
      { title: '写作纪律', value: writingRules },
      { title: '主要人物', value: arr(bible.characters || outline.characters).map(c => `${entityName(c)}（${firstText(c.role, c.identity, '人物')}）${firstText(c.goal, c.motivation) ? '：' + firstText(c.goal, c.motivation) : ''}`).filter(Boolean).join('\n') },
      { title: '重要地点', value: arr(bible.locations || outline.locations).map(l => `${firstText(l.name, l.title)}：${firstText(l.description, l.function, l.role)}`).filter(item => item.replace(/[：:]/g, '').trim()).join('\n') },
      { title: '时间线', value: arr(bible.timeline || outline.timeline).map(t => firstText(t.time, t.stage, t.chapter, t.event, t.description)).filter(Boolean).join('\n') }
    ].filter(item => item.value);
    const hasOutline = hasNovelOutline();
    const outlineBusy = state.generation?.type === 'outline';
    const busyAttr = outlineBusy ? 'disabled aria-busy="true"' : '';
    const actionBand = `<section class="nv-action-band nv-action-band-top">
      <div>
        <h3>当前要做什么</h3>
        <ul>
          <li>确认世界观和不可写崩规则没有明显冲突。</li>
          <li>如果旧小说缺少世界观档案，可以直接点“完善世界观与大纲”。</li>
          <li>${hasOutline ? '世界观和大纲已存在，确认无误后进入剧情大纲继续检查章节任务书。' : '点击下一步会先完善世界观与大纲，再进入剧情大纲继续检查。'}</li>
        </ul>
      </div>
      <div class="nv-action-buttons">
        <button class="nv-btn nv-btn-muted" type="button" data-save-world ${busyAttr}>保存世界观</button>
        <button class="nv-btn nv-btn-primary" type="button" data-generate-outline ${busyAttr}>${outlineBusy ? '生成中...' : '完善世界观与大纲'}</button>
        <button class="nv-btn nv-btn-primary" type="button" data-next-outline ${busyAttr}>${hasOutline ? '下一步：查看剧情大纲' : '下一步：完善并查看大纲'}</button>
      </div>
    </section>`;
    return `${actionBand}
    ${renderGenerationStatus('outline')}
    <div class="nv-panel-grid">
      <section class="nv-card">
        <h3>作品承诺</h3>
        <textarea class="nv-textarea" id="nvPromiseInput" placeholder="一句话卖点、目标读者、核心阅读期待。">${esc(promise)}</textarea>
      </section>
      <section class="nv-card">
        <h3>世界观基础</h3>
        <textarea class="nv-textarea" id="nvWorldInput" placeholder="时代、地域、社会结构、力量体系和核心规则。">${esc(world)}</textarea>
      </section>
      <section class="nv-card">
        <h3>不可写崩规则</h3>
        <textarea class="nv-textarea" id="nvRulesInput" placeholder="禁区、能力边界、人物命名、文化语境冲突。">${esc(rules)}</textarea>
      </section>
    </div>
    ${dossier.length ? `<section class="nv-card nv-dossier">
      <h3>已生成的作品档案</h3>
      <div class="nv-dossier-grid">${dossier.map(item => `<div>
        <b>${esc(item.title)}</b>
        <p>${esc(item.value)}</p>
      </div>`).join('')}</div>
    </section>` : ''}
    `;
  }

  function renderOutlinePanel() {
    const outline = state.current.outline || {};
    const outlineChapters = arr(outline.chapters);
    const synopsis = firstText(outline.synopsis, outline.summary, outline.story_summary, outline.description, state.current.description);
    const outlineBusy = state.generation?.type === 'outline';
    const busyAttr = outlineBusy ? 'disabled aria-busy="true"' : '';
    const dramaRows = [
      ['事件起因', firstText(outline.inciting_incident, state.current.story_bible?.inciting_incident, state.current.contract?.inciting_incident)],
      ['突出问题', firstText(outline.core_problem, state.current.story_bible?.core_problem, state.current.contract?.core_problem)],
      ['矛盾引擎', firstText(outline.conflict_engine, state.current.story_bible?.conflict_engine, state.current.contract?.conflict_engine)],
      ['失败代价', firstText(outline.stakes, state.current.story_bible?.stakes, state.current.contract?.stakes)],
      ['升级路径', firstText(outline.escalation_path, state.current.story_bible?.escalation_path, state.current.contract?.escalation_path)]
    ].filter(([, value]) => value);
    const actionBand = `<section class="nv-action-band nv-action-band-top">
      <div>
        <h3>当前要做什么</h3>
        <p>先看起因、突出问题、矛盾引擎和每章任务书。确认足够有冲突和追读力后，再进入人物关系图。</p>
      </div>
      <div class="nv-action-buttons">
        <button class="nv-btn nv-btn-muted" type="button" data-save-outline ${busyAttr}>保存大纲</button>
        <button class="nv-btn nv-btn-muted" type="button" data-generate-outline ${busyAttr}>${outlineBusy ? '生成中...' : '重新生成大纲'}</button>
        <button class="nv-btn nv-btn-primary" type="button" data-next-graph ${busyAttr}>下一步：查看人物关系图</button>
      </div>
    </section>`;
    return `${actionBand}
    ${renderGenerationStatus('outline')}
    <section class="nv-card">
      <h3>剧情大纲</h3>
      <label class="nv-field-label" for="nvSynopsisInput">故事总纲</label>
      <textarea class="nv-textarea" id="nvSynopsisInput" placeholder="生成大纲后显示，也可以人工修改。">${esc(synopsis)}</textarea>
      ${dramaRows.length ? `<div class="nv-drama-grid">${dramaRows.map(([label, value]) => `<div><b>${esc(label)}</b><span>${esc(value)}</span></div>`).join('')}</div>` : ''}
      <div class="nv-outline-list" id="nvOutlineList">${outlineChapters.length ? outlineChapters.map((ch, idx) => {
        const events = arr(ch.key_events || ch.events || ch.beats).map(item => richText(item)).filter(Boolean);
        const chars = arr(ch.characters).map(item => richText(item)).filter(Boolean);
        const craftRows = [
          ['场景目标', firstText(ch.scene_goal, ch.goal)],
          ['阻力', firstText(ch.obstacle, ch.conflict)],
          ['戏剧问题', firstText(ch.dramatic_question)],
          ['选择', firstText(ch.choice)],
          ['代价', firstText(ch.cost)],
          ['情绪变化', firstText(ch.emotional_shift, ch.character_shift)],
          ['反转/新信息', firstText(ch.reversal, ch.reveal)],
          ['伏笔/线索', firstText(ch.clue, ch.foreshadow)],
          ['回收/兑现', firstText(ch.payoff)],
          ['感官锚点', firstText(ch.sensory_anchor, ch.visual_anchor)]
        ].filter(([, value]) => value);
        return `<div class="nv-outline-item">
        <strong>第 ${idx + 1} 章：${esc(chapterTitle(ch, '未命名章节'))}</strong>
        <p>${esc(firstText(ch.summary, ch.goal, ch.description, '暂无章节目标'))}</p>
        ${craftRows.length ? `<div class="nv-outline-craft">${craftRows.map(([label, value]) => `<div><b>${esc(label)}</b><span>${esc(value)}</span></div>`).join('')}</div>` : ''}
        <div class="nv-outline-meta">
          ${firstText(ch.function, ch.purpose) ? `<span>功能：${esc(firstText(ch.function, ch.purpose))}</span>` : ''}
          ${firstText(ch.pov, ch.viewpoint) ? `<span>视角：${esc(firstText(ch.pov, ch.viewpoint))}</span>` : ''}
          ${firstText(ch.hook, ch.conflict) ? `<span>钩子：${esc(firstText(ch.hook, ch.conflict))}</span>` : ''}
          ${chars.length ? `<span>人物：${esc(chars.join('、'))}</span>` : ''}
        </div>
        ${events.length ? `<ul class="nv-outline-events">${events.map(event => `<li>${esc(event)}</li>`).join('')}</ul>` : ''}
      </div>`;
      }).join('') : '<div class="nv-empty">暂无剧情大纲。请先在世界观步骤生成大纲。</div>'}</div>
    </section>`;
  }

  function characterMap() {
    const map = new Map();
    const add = (item = {}) => {
      const name = entityName(item);
      if (!name) return;
      map.set(name, { ...(map.get(name) || {}), ...item, name });
    };
    arr(state.current.entities).forEach(add);
    arr(state.current.story_bible?.characters).forEach(add);
    arr(state.current.outline?.characters).forEach(add);
    arr(state.current.relationships).forEach(item => {
      if (text(item.from) && !map.has(text(item.from))) add({ name: text(item.from) });
      if (text(item.to) && !map.has(text(item.to))) add({ name: text(item.to) });
    });
    return map;
  }

  function relationNames() {
    return Array.from(characterMap().keys());
  }

  function relationKey(from, to, type = '') {
    const pair = [text(from), text(to)].sort().join('::');
    return `${pair}::${text(type)}`;
  }

  function characterNameSet() {
    return new Set(relationNames());
  }

  function resolveChapterCharacters(chapter = {}, names = characterNameSet()) {
    const found = new Set();
    arr(chapter.characters).forEach(item => {
      const body = richText(item);
      if (names.has(body)) found.add(body);
      names.forEach(name => {
        if (body && (body === name || body.includes(name))) found.add(name);
      });
    });
    const searchable = [
      chapter.title,
      chapter.summary,
      chapter.scene_goal,
      chapter.obstacle,
      chapter.choice,
      chapter.cost,
      chapter.emotional_shift,
      chapter.reversal,
      chapter.clue,
      chapter.payoff,
      chapter.hook,
      arr(chapter.key_events).map(richText).join('\n')
    ].map(value => richText(value)).filter(Boolean).join('\n');
    names.forEach(name => {
      if (name && searchable.includes(name)) found.add(name);
    });
    return Array.from(found);
  }

  function buildGraphRelations() {
    const names = characterNameSet();
    const entityByName = characterMap();
    const map = new Map();
    const add = (rel = {}, inferred = false) => {
      const from = text(rel.from);
      const to = text(rel.to);
      if (!from || !to || from === to || !names.has(from) || !names.has(to)) return;
      const type = text(rel.type || rel.relation) || (inferred ? '剧情关联' : '关系');
      const key = relationKey(from, to, type);
      if (map.has(key) && !inferred) {
        map.set(key, { ...map.get(key), ...rel, from, to, type, inferred: false });
        return;
      }
      if (!map.has(key)) {
        map.set(key, {
          ...rel,
          from,
          to,
          type,
          inferred,
          description: text(rel.description),
          tension: text(rel.tension),
          evidence: text(rel.evidence)
        });
      }
    };

    arr(state.current.relationships).forEach(rel => add(rel, false));
    arr(state.current.story_bible?.relationships).forEach(rel => add(rel, false));
    arr(state.current.outline?.relationships).forEach(rel => add(rel, false));

    arr(state.current.outline?.chapters).forEach(chapter => {
      const chars = resolveChapterCharacters(chapter, names);
      for (let i = 0; i < chars.length; i++) {
        for (let j = i + 1; j < chars.length; j++) {
          add({
            from: chars[i],
            to: chars[j],
            type: '同章剧情关联',
            description: `第 ${chapter.index || '?'} 章共同参与：${chapterTitle(chapter, '未命名章节')}`,
            evidence: firstText(chapter.summary, chapter.scene_goal, chapter.obstacle)
          }, true);
        }
      }
    });

    const protagonist = Array.from(names).find(name => /主角|主人公|protagonist|lead/i.test(characterRoleText(entityByName.get(name) || {}))) || Array.from(names)[0];
    names.forEach(name => {
      if (!protagonist || name === protagonist) return;
      const role = characterRoleText(entityByName.get(name) || {});
      if (/反派|敌|阻力|对手|竞争|威胁|掌控|压迫|antagonist|opponent|rival|pressure|obstacle/i.test(role)) {
        add({
          from: protagonist,
          to: name,
          type: '主线阻力',
          description: `${name} 在人物功能中承担阻力/反派压力`,
          evidence: role
        }, true);
      } else if (/线索|信息|秘密|转折|知情|见证|messenger|informant|witness|reveal|information/i.test(role)) {
        add({
          from: protagonist,
          to: name,
          type: '信息关联',
          description: `${name} 承担信息/转折功能`,
          evidence: role
        }, true);
      } else if (/盟友|同伴|伙伴|帮手|亲人|朋友|ally|companion|support|relationship/i.test(role)) {
        add({
          from: protagonist,
          to: name,
          type: '同盟/关系压力',
          description: `${name} 承担同盟或关系压力功能`,
          evidence: role
        }, true);
      }
    });

    return Array.from(map.values());
  }

  function graphLayoutKey() {
    return state.current?.id || 'draft';
  }

  function graphLayout() {
    const key = graphLayoutKey();
    if (!state.graphLayouts[key]) state.graphLayouts[key] = {};
    return state.graphLayouts[key];
  }

  function graphViewport() {
    const key = graphLayoutKey();
    if (!state.graphViewports[key]) state.graphViewports[key] = { x: 0, y: 0, scale: 1 };
    return state.graphViewports[key];
  }

  function clampGraphScale(scale) {
    return Math.max(0.45, Math.min(2.6, Number(scale) || 1));
  }

  function graphTransform() {
    const view = graphViewport();
    view.scale = clampGraphScale(view.scale);
    return `translate(${view.x || 0} ${view.y || 0}) scale(${view.scale})`;
  }

  function graphContentPointFromEvent(event) {
    const group = document.querySelector('.nv-web-stage .nv-graph-viewport');
    if (!group) return null;
    const matrix = group.getScreenCTM();
    if (!matrix) return null;
    const svg = document.querySelector('.nv-web-stage .nv-graph-svg');
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const p = pt.matrixTransform(matrix.inverse());
    return { x: p.x, y: p.y };
  }

  function updateGraphViewport() {
    const group = document.querySelector('.nv-web-stage .nv-graph-viewport');
    if (group) group.setAttribute('transform', graphTransform());
  }

  function graphPointFromEvent(event) {
    const p = graphContentPointFromEvent(event);
    if (!p) return null;
    return {
      x: Math.max(24, Math.min(1176, p.x)),
      y: Math.max(28, Math.min(532, p.y))
    };
  }

  function updateGraphDragPosition(name, point) {
    const svg = document.querySelector('.nv-web-stage .nv-graph-svg');
    if (!svg || !name || !point) return;
    const node = svg.querySelector(`[data-graph-node="${CSS.escape(name)}"]`);
    if (node) node.setAttribute('transform', `translate(${point.x},${point.y})`);
    const star = svg.querySelector(`[data-star-for="${CSS.escape(name)}"]`);
    if (star) {
      star.setAttribute('cx', point.x);
      star.setAttribute('cy', point.y);
    }
    const positions = graphPositions(relationNames());
    const savedLayout = graphLayout();
    Object.keys(savedLayout).forEach(key => { positions[key] = savedLayout[key]; });
    svg.querySelectorAll('.nv-web-edge-group').forEach(group => {
      const from = group.dataset.edgeFrom;
      const to = group.dataset.edgeTo;
      if (from !== name && to !== name) return;
      const a = positions[from];
      const b = positions[to];
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const active = group.classList.contains('is-active');
      const offset = active ? 24 : 16;
      const curveX = mx + (-dy / length) * 18;
      const curveY = my + (dx / length) * 18;
      const labelX = mx + (-dy / length) * offset;
      const labelY = my + (dx / length) * offset;
      group.querySelector('.nv-edge')?.setAttribute('d', `M ${a.x} ${a.y} Q ${curveX} ${curveY} ${b.x} ${b.y}`);
      group.querySelector('.nv-edge-label')?.setAttribute('transform', `translate(${labelX},${labelY})`);
    });
  }

  function renderGraphPanel() {
    const names = relationNames();
    const relations = buildGraphRelations();
    const entityByName = characterMap();
    const active = names.includes(state.selectedRelationName) ? state.selectedRelationName : '';
    const positions = graphPositions(names);
    const savedLayout = graphLayout();
    names.forEach(name => {
      if (savedLayout[name]) positions[name] = savedLayout[name];
    });
    const activeRelations = relations.filter(r => r.from === active || r.to === active);
    const nodeRadius = names.length > 18 ? 9 : names.length > 10 ? 12 : 16;
    const labelLimit = names.length > 18 ? 4 : names.length > 10 ? 5 : 8;
    const stars = names.map((name, idx) => {
      const p = positions[name] || { x: 80 + idx * 24, y: 80 };
      return `<circle class="nv-web-star" data-star-for="${esc(name)}" cx="${p.x}" cy="${p.y}" r="${idx % 3 === 0 ? 1.2 : .8}"></circle>`;
    }).join('');
    const svgEdges = relations.map((r, idx) => {
      const a = positions[r.from];
      const b = positions[r.to];
      if (!a || !b) return '';
      const on = r.from === active || r.to === active;
      const showLabel = on || relations.length <= 5;
      const activeRelationNo = on ? activeRelations.indexOf(r) + 1 : 0;
      const fromGenderRaw = entityGender(entityByName.get(r.from) || {});
      const toGenderRaw = entityGender(entityByName.get(r.to) || {});
      const fromGender = endpointDisplayLabel(r, r.from, entityByName);
      const toGender = endpointDisplayLabel(r, r.to, entityByName);
      const relationLabel = `${fromGender}→${toGender} · ${r.type || r.relation || '关系'}`;
      const labelText = on ? String(activeRelationNo) : relationLabel.slice(0, 12);
      const labelWidth = on ? 28 : 92;
      const labelHeight = on ? 24 : 22;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const offset = on ? 24 : 16;
      const activePoint = active && r.from === active ? a : active && r.to === active ? b : null;
      const otherPoint = active && r.from === active ? b : active && r.to === active ? a : null;
      const labelBaseX = activePoint && otherPoint ? activePoint.x + (otherPoint.x - activePoint.x) * 0.72 : mx;
      const labelBaseY = activePoint && otherPoint ? activePoint.y + (otherPoint.y - activePoint.y) * 0.72 : my;
      const labelX = labelBaseX + (-dy / length) * offset;
      const labelY = labelBaseY + (dx / length) * offset;
      const curveX = mx + (-dy / length) * (idx % 2 ? 18 : -18);
      const curveY = my + (dx / length) * (idx % 2 ? 18 : -18);
      return `<g class="nv-web-edge-group ${on ? 'is-active' : ''} ${r.inferred ? 'is-inferred' : ''} from-${fromGenderRaw} to-${toGenderRaw}" data-edge-from="${esc(r.from)}" data-edge-to="${esc(r.to)}">
        <title>${esc(r.from)} → ${esc(r.to)}：${esc(r.type || r.relation || '关系')} ${esc(r.description || r.evidence || r.tension || '')}</title>
        <path class="nv-edge ${on ? 'is-active' : ''} ${r.inferred ? 'is-inferred' : ''} from-${fromGenderRaw} to-${toGenderRaw}" d="M ${a.x} ${a.y} Q ${curveX} ${curveY} ${b.x} ${b.y}"></path>
        <g class="nv-edge-label ${on ? 'is-active' : ''} ${showLabel ? 'is-visible' : ''} to-${toGenderRaw}" transform="translate(${labelX},${labelY})">
          <rect x="${-labelWidth / 2}" y="${-labelHeight / 2}" width="${labelWidth}" height="${labelHeight}" rx="${labelHeight / 2}"></rect>
          <text text-anchor="middle" dominant-baseline="middle">${esc(labelText)}</text>
        </g>
      </g>`;
    }).join('');
    const svgNodes = names.map(name => {
      const p = positions[name];
      const ent = entityByName.get(name) || {};
      const gender = entityGender(ent);
      const on = name === active;
      const dragging = state.graphDrag?.name === name;
      const label = name.length > labelLimit ? `${name.slice(0, labelLimit - 1)}…` : name;
      const icon = gender === 'male'
        ? '<path class="nv-node-icon" d="M 0 -15 L 14 0 L 0 15 L -14 0 Z"></path><path class="nv-node-mark" d="M -5 0 H 5 M 0 -5 V 5"></path>'
        : gender === 'female'
          ? '<path class="nv-node-icon" d="M 0 -16 C 11 -16 17 -8 13 3 C 10 12 0 17 0 17 C 0 17 -10 12 -13 3 C -17 -8 -11 -16 0 -16 Z"></path><path class="nv-node-mark" d="M -5 -1 H 5 M 0 -6 V 8"></path>'
          : '<path class="nv-node-icon" d="M -13 -13 H 13 V 13 H -13 Z"></path><path class="nv-node-mark" d="M -5 -5 L 5 5 M 5 -5 L -5 5"></path>';
      return `<g class="nv-node ${on ? 'is-active' : ''} ${dragging ? 'is-dragging' : ''} is-${gender}" data-graph-node="${esc(name)}" transform="translate(${p.x},${p.y})">
        ${icon}
        <text text-anchor="middle" dominant-baseline="middle" y="${nodeRadius + 13}">${esc(label)}</text>
      </g>`;
    }).join('');
    const activeEntity = entityByName.get(active) || {};
    const chaptersWithCharacters = chapters().filter(ch => arr(ch.characters).length || firstText(ch.summary, ch.title));
    const needMoreCharacters = names.length > 0 && names.length < 5;
    const chapterClues = chaptersWithCharacters.slice(0, 5).map(ch => {
      const chars = arr(ch.characters).map(item => richText(item)).filter(Boolean).slice(0, 4);
      return `<div class="nv-clue-card">
        <b>第 ${esc(ch.index)} 章 · ${esc(chapterTitle(ch, '未命名'))}</b>
        <span>${esc(chars.length ? chars.join(' / ') : firstText(ch.summary, '等待章节事实'))}</span>
      </div>`;
    }).join('');
    const characterIndex = names.length ? names.map(name => {
      const ent = entityByName.get(name) || {};
      const gender = entityGender(ent);
      return `<button class="nv-character-card ${name === active ? 'is-active' : ''} is-${gender}" type="button" data-select-character="${esc(name)}">
        <b>${esc(name)}</b>
        <span>${esc(genderLabel(gender))} · ${esc(firstText(ent.role, ent.identity, '人物'))}</span>
      </button>`;
    }).join('') : '<div class="nv-empty">暂无人物档案。请先生成剧情大纲。</div>';
    const actionBand = `<section class="nv-action-band nv-action-band-top">
      <div><h3>下一步</h3><p>先检查人物数量、阻力方、关系证据和章节出场线索；确认后进入章节创作。</p></div>
      <div class="nv-action-buttons"><button class="nv-btn nv-btn-primary" type="button" data-panel-go="write">下一步：进入章节制作</button></div>
    </section>`;
    return `${actionBand}
    <section class="nv-relation-workbench">
      <aside class="nv-relation-side">
        <div class="nv-relation-search">
          <span>检索人物</span>
          <strong>${esc(active || '未定位')}</strong>
        </div>
        <div class="nv-relation-stats">
          <div><b>${names.length}</b><span>人物</span></div>
          <div><b>${relations.length}</b><span>关系</span></div>
          <div><b>${chaptersWithCharacters.length}</b><span>章节线索</span></div>
        </div>
        ${needMoreCharacters ? `<div class="nv-relation-warning">
          <b>人物网络偏少</b>
          <p>当前只沉淀了 ${names.length} 个人物。可以让大纲补齐盟友、阻力、信息携带者和势力代表。</p>
          <button class="nv-btn nv-btn-primary" type="button" data-expand-characters>完善人物关系</button>
        </div>` : ''}
        <div class="nv-clue-list">
          <h3>章节线索</h3>
          ${chapterClues || '<p>生成大纲后，这里会显示人物出场线索。</p>'}
        </div>
        <div class="nv-character-index">
          <h3>人物索引</h3>
          <div>${characterIndex}</div>
        </div>
      </aside>

      <section class="nv-web-stage">
        <div class="nv-web-toolbar">
          <div>
            <b>COSMIC WEB:// 人物全息关系网</b>
            <span>${relations.length ? '显示显性关系 + 大纲/章节任务书可证明的剧情关联；点击或拖动节点整理位置。' : '当前只有人物档案，提交章节后会沉淀关系链。'}</span>
          </div>
          <div class="nv-web-toolbar-actions">
            <button class="nv-btn nv-btn-muted nv-icon-btn" type="button" data-graph-zoom="out" title="缩小">-</button>
            <button class="nv-btn nv-btn-muted nv-icon-btn" type="button" data-graph-zoom="in" title="放大">+</button>
            <button class="nv-btn nv-btn-muted" type="button" data-graph-zoom="fit">适配</button>
            <button class="nv-btn nv-btn-muted" type="button" data-reset-graph-layout>重置布局</button>
            <button class="nv-btn nv-btn-muted" type="button" data-panel-go="outline">返回大纲</button>
          </div>
        </div>
        <svg class="nv-graph-svg" viewBox="0 0 1200 560" role="img" aria-label="人物关系全息网络">
          <defs>
            <radialGradient id="nvNodeGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#2ef3ea" stop-opacity=".95"/><stop offset="100%" stop-color="#2ef3ea" stop-opacity="0"/></radialGradient>
          </defs>
          <rect class="nv-web-bg" x="0" y="0" width="1200" height="560"></rect>
          <g class="nv-graph-viewport" transform="${graphTransform()}">
            ${stars}
            ${svgEdges}
            ${svgNodes}
          </g>
        </svg>
        <div class="nv-graph-legend">
          <span class="is-male">男</span>
          <span class="is-female">女</span>
          <span class="is-unknown">未标注</span>
          <em>实线为明确关系，虚线为同章/角色功能推导关联；不补假线。</em>
        </div>
      </section>

      <aside class="nv-relation-detail">
        <h3>${active ? esc(active) + ' 的人物卡' : '人物档案'}</h3>
        ${active ? `<p class="nv-character-summary">${esc(genderLabel(entityGender(activeEntity)))} · ${esc(firstText(activeEntity.role, activeEntity.identity, '人物'))}${firstText(activeEntity.arc, activeEntity.personality) ? ' · ' + esc(firstText(activeEntity.arc, activeEntity.personality)) : ''}</p>
        <div class="nv-detail-block"><b>目标/动机</b><span>${esc(firstText(activeEntity.goal, activeEntity.motivation, activeEntity.current_state, activeEntity.status, '等待章节事实继续沉淀。'))}</span></div>
        <div class="nv-detail-block"><b>人物弧光</b><span>${esc(firstText(activeEntity.arc, activeEntity.personality, activeEntity.description, '暂无明确弧光。'))}</span></div>
        <div class="nv-detail-relations">
          <b>相关关系</b>
          ${activeRelations.length ? activeRelations.map((r, idx) => {
            const fromGender = endpointDisplayLabel(r, r.from, entityByName);
            const toGender = endpointDisplayLabel(r, r.to, entityByName);
            return `<p class="nv-relation-item"><span class="nv-relation-no">${idx + 1}</span><span>${esc(r.from)}(${esc(fromGender)}) → ${esc(r.to)}(${esc(toGender)})：${esc(r.type || r.relation || '关系')}${r.inferred ? ' · 推导' : ''} ${esc(r.description || r.evidence || r.tension || '')}</span></p>`;
          }).join('') : '<p>暂无可追溯关系。生成并提交章节后会自动补充。</p>'}
        </div>` : '<p class="nv-character-summary">请先生成大纲或章节事实。</p>'}
      </aside>
    </section>`;
  }

  function graphPositions(names) {
    const cx = 600;
    const cy = 285;
    const out = {};
    if (names.length > 10) {
      const cols = Math.min(8, Math.ceil(Math.sqrt(names.length * 1.9)));
      const rows = Math.ceil(names.length / cols);
      const gapX = 1000 / Math.max(1, cols - 1);
      const gapY = 420 / Math.max(1, rows - 1);
      names.forEach((name, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const jitter = ((idx * 37) % 22) - 11;
        out[name] = { x: 100 + col * gapX + jitter, y: 70 + row * gapY - jitter };
      });
      return out;
    }
    const r = Math.max(110, Math.min(210, names.length * 26));
    names.forEach((name, idx) => {
      if (idx === 0) {
        out[name] = { x: cx, y: cy };
        return;
      }
      const angle = (-90 + (360 / Math.max(1, names.length - 1)) * (idx - 1)) * Math.PI / 180;
      out[name] = { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
    });
    return out;
  }

  function renderWritePanel() {
    const list = chapters();
    const chapter = list.find(item => Number(item.index) === Number(state.currentChapter)) || list[0];
    const outlineItem = arr(state.current.outline?.chapters)[chapter.index - 1] || {};
    const chapterRelations = arr(state.current.relationships).slice(0, 6);
    const finalVisible = allChaptersDone(state.current) && state.current.status !== 'completed';
    const currentContent = chapterContent(chapter);
    const currentTitle = chapterTitle(chapter, chapterTitle(outlineItem, ''));
    const hasCurrentContent = !!text(currentContent);
    return `<div class="nv-chapter-layout">
      <section class="nv-chapter-list">
        <h3>章节目录</h3>
        <div class="nv-chapter-scroll">${list.map(item => `<button class="nv-chapter-item ${Number(item.index) === Number(chapter.index) ? 'is-active' : ''} ${isChapterDone(item) ? 'is-done' : ''}" type="button" data-chapter="${item.index}">
          <b>第 ${item.index} 章</b>
          <small>${esc(chapterTitle(item, chapterTitle(arr(state.current.outline?.chapters)[item.index - 1] || {}, '待生成章节标题')))}</small>
          <span class="nv-status-mini">${isChapterDone(item) ? '已提交' : Number(item.index) === Number(chapter.index) ? '编辑中' : '待制作'}</span>
        </button>`).join('')}</div>
        <div class="nv-action-buttons" style="margin-top:12px">
          <button class="nv-btn nv-btn-muted" type="button" data-add-chapter>新增章节</button>
          <button class="nv-btn nv-btn-muted" type="button" data-save-outline-from-list>保存目录</button>
        </div>
      </section>
      <section class="nv-editor">
        <input class="nv-input nv-chapter-title" id="nvChapterTitle" value="${esc(currentTitle)}" placeholder="章节标题" />
        <div class="nv-editor-toolbar">
          <div class="nv-project-meta">章节正文可手动修改，也可以让 AI 续写、扩写或优化。</div>
          <div class="nv-editor-actions">
            <button class="nv-btn nv-btn-muted" type="button" data-generate-chapter>生成本章</button>
            <button class="nv-btn nv-btn-muted" type="button" data-refine="continue">续写</button>
            <button class="nv-btn nv-btn-muted" type="button" data-refine="polish">改写优化</button>
            <button class="nv-btn nv-btn-muted" type="button" data-save-chapter>保存本章</button>
            <button class="nv-btn nv-btn-primary" type="button" data-submit-chapter>提交本章</button>
          </div>
        </div>
        <div class="nv-chapter-stream-status ${state.chapterWriting ? 'is-active' : ''}" id="nvChapterStreamStatus">
          <span class="nv-thinking-dot"></span>
          <div>
            <b>${esc(state.chapterWriting?.title || 'AI 正在准备正文')}</b>
            <p>${esc(state.chapterWriting?.detail || '正在读取章节任务书、人物状态和前文事实。')}</p>
          </div>
        </div>
        ${hasCurrentContent ? '' : `<section class="nv-chapter-empty-state">
          <div>
            <h3>本章还没有正文</h3>
            <p>当前只有右侧的章节故事点和人物关系，还没有生成或保存过正文。点击“生成本章”后，正文会写入这里；也可以直接在下方手动输入。</p>
          </div>
          <button class="nv-btn nv-btn-primary" type="button" data-generate-chapter>生成本章正文</button>
        </section>`}
        <textarea class="nv-textarea nv-chapter-content ${hasCurrentContent ? '' : 'is-empty'}" id="nvChapterContent" placeholder="这里是当前章节正文创作区。">${esc(currentContent)}</textarea>
        <section class="nv-finalize ${finalVisible ? 'is-visible' : ''}">
          <div><h3>所有章节已提交</h3><p>确认后小说状态会变为“已完成”，任务中心会进入已完成列表。</p></div>
          <button class="nv-btn nv-btn-primary" type="button" data-complete-novel>确认完结小说</button>
        </section>
      </section>
      <aside class="nv-side-stack">
        <section>
          <h3>当前章节故事点</h3>
          <div class="nv-mini-list">
            <div>${esc(outlineItem.goal || outlineItem.summary || '等待 AI 根据大纲生成章节目标。')}</div>
            <div>${esc(outlineItem.conflict || outlineItem.hook || '等待 AI 提取本章关键冲突、钩子和伏笔。')}</div>
            <div>用户可在生成前修改章节标题和正文。</div>
          </div>
        </section>
        <section>
          <h3>本章人物关系</h3>
          <div class="nv-mini-list">
            ${chapterRelations.length ? chapterRelations.map(r => `<div>${esc(r.from)} → ${esc(r.to)}：${esc(r.type || r.relation || '关系')} ${esc(r.description || '')}</div>`).join('') : '<div>没有真实事实时不画假关系，只显示等待提取。</div>'}
          </div>
        </section>
        <section>
          <h3>提交后会做什么</h3>
          <div class="nv-mini-list">
            <div>保存当前章节正文。</div>
            <div>调用审稿 Agent 检查设定、时间线和人物 OOC。</div>
            <div>调用数据记忆 Agent 提取事实并更新人物关系图。</div>
          </div>
        </section>
      </aside>
    </div>`;
  }

  async function saveWorld() {
    const contract = {
      ...(state.current.contract || {}),
      promise: text(document.getElementById('nvPromiseInput')?.value),
      world: text(document.getElementById('nvWorldInput')?.value),
      rules: text(document.getElementById('nvRulesInput')?.value)
    };
    const data = await api('/api/novel/' + encodeURIComponent(state.current.id), {
      method: 'PUT',
      body: JSON.stringify({ contract, logline: contract.promise, updated_at: new Date().toISOString() })
    });
    state.current = data.novel || { ...state.current, contract, logline: contract.promise };
    showToast('世界观已保存');
  }

  async function generateOutline(button, options = {}) {
    const fromPanel = state.panel;
    state.generation = {
      type: 'outline',
      title: '正在重新生成世界观与大纲',
      detail: '写作 agent 正在重读用户要求、知识库和参考写作规则，并检查人物、起因、矛盾、风险与章节任务书。'
    };
    renderWork();
    if (document.getElementById('nvWorldInput')) {
      await saveWorld();
    }
    setBusy(button, true, '生成中...');
    try {
      const data = await api('/api/novel/' + encodeURIComponent(state.current.id) + '/generate-outline', { method: 'POST' });
      state.current = data.novel || {
        ...state.current,
        outline: data.outline || state.current.outline,
        story_bible: data.story_bible || state.current.story_bible,
        contract: data.workflow?.contract || state.current.contract,
        entities: data.workflow?.entities || state.current.entities,
        relationships: data.workflow?.relationships || state.current.relationships,
        plot_threads: data.workflow?.plot_threads || state.current.plot_threads,
        runtime_status: data.workflow?.runtime_status || state.current.runtime_status,
        logline: data.outline?.logline || state.current.logline,
        description: data.outline?.synopsis || state.current.description
      };
      state.panel = options.nextPanel || (fromPanel === 'world' ? 'world' : 'outline');
      renderWork();
      showToast(fromPanel === 'world' ? '世界观与大纲已完善' : '剧情大纲已生成');
    } finally {
      state.generation = null;
      setBusy(button, false);
      renderWork();
    }
  }

  async function saveOutline() {
    const synopsis = text(document.getElementById('nvSynopsisInput')?.value);
    const outline = { ...(state.current.outline || {}), synopsis };
    const data = await api('/api/novel/' + encodeURIComponent(state.current.id), {
      method: 'PUT',
      body: JSON.stringify({ outline, description: synopsis })
    });
    state.current = data.novel || { ...state.current, outline, description: synopsis };
    showToast('大纲已保存');
  }

  function currentChapterPayload(status) {
    const title = text(document.getElementById('nvChapterTitle')?.value);
    const content = document.getElementById('nvChapterContent')?.value || '';
    const list = chapters().map(ch => Number(ch.index) === Number(state.currentChapter)
      ? { ...ch, title, content, status: status || ch.status || 'draft', word_count: content.length, updated_at: new Date().toISOString() }
      : ch);
    return list;
  }

  async function saveChapter(status) {
    const list = currentChapterPayload(status);
    const data = await api('/api/novel/' + encodeURIComponent(state.current.id), {
      method: 'PUT',
      body: JSON.stringify({ chapters: list, status: state.current.status === 'completed' ? 'completed' : 'draft' })
    });
    state.current = data.novel || { ...state.current, chapters: list };
    showToast(status === 'done' ? '本章已保存为已提交' : '本章已保存');
  }

  function stream(url, onChunk) {
    return new Promise((resolve, reject) => {
      const es = new EventSource(url);
      let finalText = '';
      es.onmessage = event => {
        let data = {};
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'chunk') {
          finalText += data.text || '';
          onChunk(data.text || '', finalText);
        }
        if (data.type === 'done') {
          es.close();
          resolve(data);
        }
        if (data.type === 'error') {
          es.close();
          reject(new Error(data.message || '流式生成失败'));
        }
      };
      es.onerror = () => {
        es.close();
        reject(new Error('流式连接失败'));
      };
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function updateChapterWriteStatus(title, detail) {
    state.chapterWriting = { title, detail };
    const box = document.getElementById('nvChapterStreamStatus');
    if (!box) return;
    box.classList.add('is-active');
    const titleEl = box.querySelector('b');
    const detailEl = box.querySelector('p');
    if (titleEl) titleEl.textContent = title;
    if (detailEl) detailEl.textContent = detail;
  }

  function finishChapterWriteStatus() {
    state.chapterWriting = null;
    const box = document.getElementById('nvChapterStreamStatus');
    if (box) box.classList.remove('is-active');
  }

  async function showChapterThinking(steps) {
    for (const step of steps) {
      updateChapterWriteStatus(step.title, step.detail);
      await sleep(step.delay || 520);
    }
  }

  function createChapterTypingWriter(area, options = {}) {
    const sourceValue = options.sourceValue || '';
    const start = Number(options.start || 0);
    const end = Number(options.end || start);
    let queue = '';
    let displayed = '';
    let closed = false;
    let pumping = false;
    let idleResolve = null;
    let idlePromise = Promise.resolve();

    const apply = () => {
      if (options.mode === 'replace') {
        area.value = sourceValue.slice(0, start) + displayed + sourceValue.slice(end);
      } else if (options.mode === 'append') {
        area.value = sourceValue + displayed;
      } else {
        area.value = displayed;
      }
      area.scrollTop = area.scrollHeight;
    };

    const pump = async () => {
      if (pumping) return;
      pumping = true;
      idlePromise = new Promise(resolve => { idleResolve = resolve; });
      while (!closed || queue.length) {
        if (!queue.length) {
          await sleep(24);
          continue;
        }
        const size = queue.length > 240 ? 8 : queue.length > 80 ? 4 : 2;
        const part = queue.slice(0, size);
        queue = queue.slice(size);
        displayed += part;
        apply();
        await sleep(/[。！？!?；;\n]$/.test(part) ? 90 : 18);
      }
      pumping = false;
      if (idleResolve) idleResolve();
    };

    return {
      enqueue(chunk) {
        if (!chunk) return;
        queue += chunk;
        pump();
      },
      async finish() {
        closed = true;
        if (!pumping) pump();
        await idlePromise;
      },
      text() {
        return displayed;
      }
    };
  }

  async function generateChapter(button) {
    if (!token()) throw new Error('登录已失效，请重新登录');
    state.chapterWriting = {
      title: 'AI 正在准备正文',
      detail: '正在读取章节任务书、人物状态和前文事实。'
    };
    updateChapterWriteStatus(state.chapterWriting.title, state.chapterWriting.detail);
    setBusy(button, true, '生成中...');
    const area = document.getElementById('nvChapterContent');
    area.value = '';
    const writer = createChapterTypingWriter(area, { mode: 'replace', sourceValue: '', start: 0, end: 0 });
    try {
      await showChapterThinking([
        { title: '正在读取章节任务书', detail: '核对本章目标、冲突、选择、代价和钩子。' },
        { title: '正在组织场景', detail: '按人物动机、对话潜台词和场景细节准备正文。' },
        { title: '正在逐句写入正文', detail: '正文会像对话一样持续出现，请等待完整写完。' }
      ]);
      const url = `/api/novel/${encodeURIComponent(state.current.id)}/generate-chapter-stream?chapter=${encodeURIComponent(state.currentChapter)}&token=${encodeURIComponent(token())}`;
      await stream(url, (chunk) => {
        updateChapterWriteStatus('正在逐句写入正文', 'AI 正在把真实生成结果按可读节奏写入编辑区。');
        writer.enqueue(chunk);
      });
      await writer.finish();
      await refreshCurrent();
      state.panel = 'write';
      renderWork();
      showToast('本章已生成，确认后可提交。');
    } finally {
      finishChapterWriteStatus();
      setBusy(button, false);
    }
  }

  async function refineChapter(mode, button) {
    const area = document.getElementById('nvChapterContent');
    const selected = area.value.slice(area.selectionStart, area.selectionEnd);
    const base = mode === 'continue' ? area.value : selected;
    if (!text(base)) throw new Error(mode === 'continue' ? '当前章节还没有可续写内容' : '请先选中需要优化的文字');
    const instruction = mode === 'continue'
      ? '请在保持设定、人物状态和章节目标一致的前提下，自然续写当前章节，约800字。'
      : '请优化所选文字的节奏、画面感、网文追读力，并保持事实不变。';
    const selectionStart = area.selectionStart;
    const selectionEnd = area.selectionEnd;
    state.chapterWriting = {
      title: mode === 'continue' ? 'AI 正在准备续写' : 'AI 正在准备改写',
      detail: mode === 'continue' ? '正在读取现有正文、人物状态和本章目标。' : '正在读取选中文字，保持事实不变后重写表达。'
    };
    updateChapterWriteStatus(state.chapterWriting.title, state.chapterWriting.detail);
    setBusy(button, true, mode === 'continue' ? '续写中...' : '优化中...');
    const liveArea = document.getElementById('nvChapterContent');
    const sourceValue = liveArea.value;
    const writer = createChapterTypingWriter(liveArea, {
      mode: mode === 'continue' ? 'append' : 'replace',
      sourceValue: mode === 'continue' ? `${sourceValue}\n\n` : sourceValue,
      start: selectionStart,
      end: selectionEnd
    });
    try {
      let result = '';
      await showChapterThinking(mode === 'continue'
        ? [
          { title: '正在衔接前文', detail: '检查上一句情绪、行动目标和未完成冲突。' },
          { title: '正在组织续写', detail: '续写会逐句进入正文，不会等到最后一次性出现。' }
        ]
        : [
          { title: '正在分析选中文字', detail: '保持事实不变，只调整节奏、画面感和表达密度。' },
          { title: '正在逐句改写', detail: '改写内容会在原选区位置逐步替换。' }
        ]);
      const url = `/api/novel/${encodeURIComponent(state.current.id)}/refine-stream?text=${encodeURIComponent(base)}&instruction=${encodeURIComponent(instruction)}&token=${encodeURIComponent(token())}`;
      await stream(url, (chunk) => {
        result += chunk;
        updateChapterWriteStatus(mode === 'continue' ? '正在逐句续写' : '正在逐句改写', 'AI 正在把真实生成结果按可读节奏写入编辑区。');
        writer.enqueue(chunk);
      });
      await writer.finish();
      showToast(mode === 'continue' ? '续写完成，请检查后保存。' : '优化完成，请检查后保存。');
    } finally {
      finishChapterWriteStatus();
      setBusy(button, false);
    }
  }

  async function submitChapter(button) {
    const content = text(document.getElementById('nvChapterContent')?.value);
    if (!content) throw new Error('章节内容为空，不能提交本章');
    setBusy(button, true, '提交中...');
    try {
      await saveChapter('done');
      const review = await api(`/api/novel/${encodeURIComponent(state.current.id)}/chapters/${encodeURIComponent(state.currentChapter)}/review`, { method: 'POST' });
      state.current = review.novel || state.current;
      const facts = await api(`/api/novel/${encodeURIComponent(state.current.id)}/chapters/${encodeURIComponent(state.currentChapter)}/extract-facts`, { method: 'POST' });
      state.current = facts.novel || state.current;
      const next = chapters().find(ch => !isChapterDone(ch));
      if (next) state.currentChapter = next.index;
      renderWork();
      showToast(next ? `第 ${state.currentChapter - 1} 章已提交，进入第 ${next.index} 章。` : '所有章节已提交，可以确认完结小说。');
    } finally {
      setBusy(button, false);
    }
  }

  async function completeNovel(button) {
    setBusy(button, true, '完结中...');
    try {
      const data = await api('/api/novel/' + encodeURIComponent(state.current.id) + '/complete', { method: 'POST' });
      state.current = data.novel || state.current;
      await loadNovels();
      renderWork();
      showToast('小说已完结');
    } finally {
      setBusy(button, false);
    }
  }

  async function refreshCurrent() {
    const data = await api('/api/novel/' + encodeURIComponent(state.current.id));
    state.current = data.novel || data.data || state.current;
  }

  async function saveProgress() {
    if (!state.current) return;
    if (state.panel === 'world') await saveWorld();
    else if (state.panel === 'outline') await saveOutline();
    else if (state.panel === 'write') await saveChapter();
    else showToast('当前关系图来自提交事实，不需要单独保存。');
    await refreshCurrent();
  }

  async function addChapter() {
    const list = chapters();
    const next = list.length + 1;
    list.push({ index: next, title: `第 ${next} 章`, content: '', status: 'draft', word_count: 0 });
    const outline = {
      ...(state.current.outline || {}),
      chapters: [...arr(state.current.outline?.chapters), { title: `第 ${next} 章`, summary: '' }]
    };
    const data = await api('/api/novel/' + encodeURIComponent(state.current.id), {
      method: 'PUT',
      body: JSON.stringify({ chapters: list, outline, chapter_count: next })
    });
    state.current = data.novel || { ...state.current, chapters: list, outline, chapter_count: next };
    state.currentChapter = next;
    renderWork();
  }

  function renderTasks() {
    const typeFilters = [
      { key: 'all', label: '全部' },
      { key: 'flash', label: '短篇小说' },
      { key: 'short', label: '中篇小说' },
      { key: 'long', label: '长篇小说' }
    ];
    const statusFilters = [
      { key: 'all', label: '全部状态' },
      { key: 'making', label: '制作中' },
      { key: 'done', label: '已完成' },
      { key: 'failed', label: '制作失败' }
    ];
    const filtered = state.novels.filter(novel => {
      const typeOk = state.taskType === 'all' || lengthOf(novel).key === state.taskType || novel.novel_type === state.taskType;
      const life = lifecycle(novel);
      const statusOk = state.taskStatus === 'all' || life.key === state.taskStatus;
      return typeOk && statusOk;
    });
    taskView.innerHTML = `<div class="nv-task-page">
      <h2>任务中心</h2>
      <p>按小说类型查看任务，再在小说下面切换状态。制作中、已完成、制作失败是小说任务的子状态，不和类型并列。</p>
      <div class="nv-task-filters">
        <div class="nv-task-row"><span class="nv-task-label">小说类型</span>${typeFilters.map(f => `<button class="nv-filter ${state.taskType === f.key ? 'is-active' : ''}" type="button" data-task-type="${f.key}">${esc(f.label)}</button>`).join('')}</div>
        <div class="nv-task-row status"><span class="nv-task-label">任务状态</span>${statusFilters.map(f => `<button class="nv-filter child ${state.taskStatus === f.key ? 'is-active' : ''}" type="button" data-task-status="${f.key}">${esc(f.label)}</button>`).join('')}</div>
      </div>
      <table class="nv-task-table">
        <thead><tr><th>小说</th><th>类型</th><th>当前阶段</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead>
        <tbody>${filtered.length ? filtered.map(novel => {
          const life = lifecycle(novel);
          return `<tr>
            <td>${esc(novel.title || '未命名小说')}</td>
            <td>${esc(lengthOf(novel).label)}</td>
            <td>${esc(chapterPhase(novel))}</td>
            <td><span class="nv-pill ${life.cls}">${esc(life.label)}</span></td>
            <td>${esc((novel.updated_at || '').replace('T', ' ').slice(0, 16) || '-')}</td>
            <td><button class="nv-btn nv-btn-muted" type="button" data-open-novel="${esc(novel.id)}">进入</button></td>
          </tr>`;
        }).join('') : '<tr><td colspan="6">暂无真实小说任务。创建小说后显示。</td></tr>'}</tbody>
      </table>
    </div>`;
  }

  function bindEvents() {
    document.getElementById('nvBackBtn').addEventListener('click', () => { window.location.href = '/dashboard'; });
    document.getElementById('nvSaveProgressBtn').addEventListener('click', () => run(saveProgress));
    document.querySelectorAll('.nv-nav-item').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
    document.querySelectorAll('[data-create-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.createMode = btn.dataset.createMode;
        setCreateError('');
        document.querySelectorAll('[data-create-mode]').forEach(item => item.classList.toggle('is-active', item === btn));
        document.getElementById('nvIdeaInput').classList.toggle('is-hidden', state.createMode !== 'idea');
        document.getElementById('nvImportInput').classList.toggle('is-hidden', state.createMode !== 'import');
        document.getElementById('nvImportTools').classList.toggle('is-hidden', state.createMode !== 'import');
      });
    });
    document.getElementById('nvImportToggleBtn').addEventListener('click', () => {
      setCreateError('');
      document.querySelector('[data-create-mode="import"]').click();
    });
    document.getElementById('nvOpenCreateModalBtn').addEventListener('click', () => {
      setCreateError('');
      renderCreateChoices();
      document.getElementById('nvCreateModal').classList.add('is-open');
    });
    document.getElementById('nvCloseCreateModalBtn').addEventListener('click', () => {
      document.getElementById('nvCreateModal').classList.remove('is-open');
    });
    document.getElementById('nvImportFileInput').addEventListener('change', e => run(() => handleImportFile(e.currentTarget.files?.[0])));
    document.getElementById('nvCreateProjectBtn').addEventListener('click', e => run(() => createProject(e.currentTarget)));
    document.getElementById('nvIdeaInput').addEventListener('input', () => setCreateError(''));
    document.getElementById('nvImportInput').addEventListener('input', () => setCreateError(''));

    document.body.addEventListener('click', e => {
      const open = e.target.closest('[data-open-novel]');
      if (open) return run(() => loadNovel(open.dataset.openNovel));
      const panel = e.target.closest('[data-panel]');
      if (panel) {
        state.panel = panel.dataset.panel;
        renderWork();
        return;
      }
      const go = e.target.closest('[data-panel-go]');
      if (go) {
        state.panel = go.dataset.panelGo;
        renderWork();
        return;
      }
      if (e.target.closest('[data-reset-graph-layout]')) {
        delete state.graphLayouts[graphLayoutKey()];
        delete state.graphViewports[graphLayoutKey()];
        state.graphDrag = null;
        state.graphPan = null;
        renderWork();
        return;
      }
      const zoomBtn = e.target.closest('[data-graph-zoom]');
      if (zoomBtn) {
        const view = graphViewport();
        if (zoomBtn.dataset.graphZoom === 'fit') {
          view.x = 0;
          view.y = 0;
          view.scale = 1;
        } else {
          const next = clampGraphScale(view.scale * (zoomBtn.dataset.graphZoom === 'in' ? 1.18 : 1 / 1.18));
          view.scale = next;
        }
        updateGraphViewport();
        return;
      }
      const nextOutline = e.target.closest('[data-next-outline]');
      if (nextOutline) {
        if (hasNovelOutline()) {
          state.panel = 'outline';
          renderWork();
          return;
        }
        return run(() => generateOutline(nextOutline, { nextPanel: 'outline' }));
      }
      const graphBlank = state.panel === 'graph'
        && e.target.closest('.nv-graph-svg')
        && !e.target.closest('[data-graph-node]')
        && !e.target.closest('.nv-web-edge-group')
        && !e.target.closest('.nv-edge-label');
      if (graphBlank) {
        if (state.graphSuppressClick) {
          state.graphSuppressClick = false;
          return;
        }
        if (state.selectedRelationName) {
          state.selectedRelationName = '';
          renderWork();
        }
        return;
      }
      const character = e.target.closest('[data-select-character],[data-graph-node]');
      if (character) {
        if (state.graphSuppressClick) {
          state.graphSuppressClick = false;
          return;
        }
        state.selectedRelationName = character.dataset.selectCharacter || character.dataset.graphNode;
        renderWork();
        return;
      }
      const chapter = e.target.closest('[data-chapter]');
      if (chapter) {
        state.currentChapter = Number(chapter.dataset.chapter);
        renderWork();
        return;
      }
      if (e.target.closest('[data-save-world]')) return run(saveWorld);
      if (e.target.closest('[data-expand-characters]')) return run(() => generateOutline(e.target.closest('button'), { nextPanel: 'graph' }));
      if (e.target.closest('[data-generate-outline]')) return run(() => generateOutline(e.target.closest('button')));
      if (e.target.closest('[data-save-outline]')) return run(saveOutline);
      if (e.target.closest('[data-next-graph]')) {
        state.panel = 'graph';
        renderWork();
        return;
      }
      if (e.target.closest('[data-save-chapter]')) return run(() => saveChapter());
      if (e.target.closest('[data-generate-chapter]')) return run(() => generateChapter(e.target.closest('button')));
      const refine = e.target.closest('[data-refine]');
      if (refine) return run(() => refineChapter(refine.dataset.refine, refine));
      if (e.target.closest('[data-submit-chapter]')) return run(() => submitChapter(e.target.closest('button')));
      if (e.target.closest('[data-complete-novel]')) return run(() => completeNovel(e.target.closest('button')));
      if (e.target.closest('[data-add-chapter]')) return run(addChapter);
      if (e.target.closest('[data-save-outline-from-list]')) return run(() => saveChapter());
      const type = e.target.closest('[data-task-type]');
      if (type) {
        state.taskType = type.dataset.taskType;
        renderTasks();
        return;
      }
      const status = e.target.closest('[data-task-status]');
      if (status) {
        state.taskStatus = status.dataset.taskStatus;
        renderTasks();
        return;
      }
      if (e.target.closest('[data-export]')) {
        window.open('/api/novel/' + encodeURIComponent(state.current.id) + '/export?token=' + encodeURIComponent(token()));
      }
    });

    document.body.addEventListener('pointerdown', e => {
      const node = e.target.closest('[data-graph-node]');
      if (state.panel !== 'graph') return;
      if (!node && e.target.closest('.nv-graph-svg')) {
        const view = graphViewport();
        state.graphPan = { startX: e.clientX, startY: e.clientY, originX: view.x || 0, originY: view.y || 0, moved: false };
        e.preventDefault();
        return;
      }
      if (!node) return;
      state.graphDrag = { name: node.dataset.graphNode, moved: false };
      state.selectedRelationName = node.dataset.graphNode;
      node.classList.add('is-dragging');
      if (node.setPointerCapture) node.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    document.body.addEventListener('pointermove', e => {
      if (state.graphPan) {
        const view = graphViewport();
        const dx = e.clientX - state.graphPan.startX;
        const dy = e.clientY - state.graphPan.startY;
        view.x = state.graphPan.originX + dx;
        view.y = state.graphPan.originY + dy;
        if (Math.sqrt(dx * dx + dy * dy) > 3) state.graphPan.moved = true;
        updateGraphViewport();
        return;
      }
      if (!state.graphDrag) return;
      const point = graphPointFromEvent(e);
      if (!point) return;
      graphLayout()[state.graphDrag.name] = point;
      state.graphDrag.moved = true;
      state.graphSuppressClick = true;
      updateGraphDragPosition(state.graphDrag.name, point);
    });

    const finishGraphDrag = () => {
      if (state.graphPan) {
        if (state.graphPan.moved) state.graphSuppressClick = true;
        state.graphPan = null;
        return;
      }
      if (!state.graphDrag) return;
      const moved = state.graphDrag.moved;
      state.graphDrag = null;
      if (moved) renderWork();
    };
    document.body.addEventListener('pointerup', finishGraphDrag);
    document.body.addEventListener('pointercancel', finishGraphDrag);
    document.body.addEventListener('wheel', e => {
      if (state.panel !== 'graph' || !e.target.closest('.nv-graph-svg')) return;
      e.preventDefault();
      const before = graphContentPointFromEvent(e);
      if (!before) return;
      const view = graphViewport();
      const prevScale = clampGraphScale(view.scale);
      const nextScale = clampGraphScale(prevScale * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
      if (nextScale === prevScale) return;
      view.scale = nextScale;
      view.x = (view.x || 0) + before.x * (prevScale - nextScale);
      view.y = (view.y || 0) + before.y * (prevScale - nextScale);
      updateGraphViewport();
    }, { passive: false });
  }

  async function run(fn) {
    try {
      await fn();
    } catch (error) {
      console.error(error);
      showToast(error.message || '操作失败', true);
    }
  }

  async function init() {
    if (!await requireNovelAuth()) return;
    bindEvents();
    await loadNovelTaxonomy();
    renderCreateChoices();
    await loadNovels();
    updateShell();
  }

  init().catch(error => {
    console.error(error);
    showToast(error.message || 'AI 小说初始化失败', true);
  });
})();
