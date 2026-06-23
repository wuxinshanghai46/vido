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
    chapterCheck: null,
    generation: null,
    taskLoading: false,
    taskError: '',
    taxonomy: null,
    importFile: null,
    importAnalysis: null,
    importUploadRequest: null,
    createError: '',
    autoSaveTimer: null,
    autoSaveInFlight: null,
    autoSaveQueued: false,
    autoSaveLastAt: 0,
    autoSaveError: '',
    submittingChapters: new Set(),
    draggingChapter: null,
    config: {
      genre: 'auto',
      subtype: 'auto',
      channel: 'auto',
      culture: 'chinese',
      length: 'short'
    }
  };

  let chapterListResizeObserver = null;

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

  function displayWordCount(value) {
    return String(value || '').replace(/\s+/g, '').length;
  }

  function normalizeCheckMatches(matches = []) {
    return arr(matches)
      .map(match => ({
        ...match,
        start: Number(match.start),
        end: Number(match.end)
      }))
      .filter(match => Number.isFinite(match.start) && Number.isFinite(match.end) && match.end > match.start)
      .sort((a, b) => a.start - b.start || b.end - a.end);
  }

  function highlightedContentHtml(content, matches = []) {
    const source = String(content || '');
    const normalized = normalizeCheckMatches(matches);
    if (!source || !normalized.length) return esc(source);
    const parts = [];
    let cursor = 0;
    for (const match of normalized) {
      const start = Math.max(0, Math.min(source.length, match.start));
      const end = Math.max(start, Math.min(source.length, match.end));
      if (start < cursor) continue;
      if (start > cursor) parts.push(esc(source.slice(cursor, start)));
      const title = [match.category, match.suggestion ? `建议：${match.suggestion}` : ''].filter(Boolean).join(' · ');
      parts.push(`<mark class="nv-check-mark is-${esc(match.type || 'hit')}" title="${esc(title)}">${esc(source.slice(start, end))}</mark>`);
      cursor = end;
    }
    if (cursor < source.length) parts.push(esc(source.slice(cursor)));
    return parts.join('');
  }

  function renderChapterCheckResult(content) {
    const result = state.chapterCheck;
    if (!result || Number(result.chapter_index) !== Number(state.currentChapter)) return '';
    const matches = normalizeCheckMatches(result.matches);
    const label = result.type === 'sensitive' ? '敏感词检测' : '错别字检测';
    const empty = matches.length === 0;
    return `<section class="nv-chapter-check-result ${empty ? 'is-empty' : ''}">
      <div class="nv-check-head">
        <b>${label}</b>
        <span>${empty ? '未发现问题' : `发现 ${matches.length} 处`}</span>
      </div>
      ${empty ? '<p>当前章节没有命中检测规则。</p>' : `<div class="nv-check-preview">${highlightedContentHtml(content, matches)}</div>
        <div class="nv-check-list">${matches.slice(0, 20).map(match => `<span>${esc(match.word)}${match.category ? ` · ${esc(match.category)}` : ''}${match.suggestion ? ` · 建议：${esc(match.suggestion)}` : ''}</span>`).join('')}</div>`}
    </section>`;
  }

  function checkIntroHtml(type) {
    if (type === 'sensitive') {
      return `<div class="nv-check-modal-summary">
        <p>本次会检测当前章节正文编辑框里的内容，不会自动修改正文，也不会替你提交章节。</p>
        <ul>
          <li>知识库中启用的小说敏感词条：<b>novel_sensitive_terms</b></li>
          <li>基础审核分类：政治敏感、违法犯罪、成人与暴力、未成年人风险、自伤风险、危险行为</li>
          <li>检测完成后，会弹窗展示命中数量、命中词、分类，并在预览中标红位置</li>
        </ul>
      </div>`;
    }
    return `<div class="nv-check-modal-summary">
      <p>本次会检测当前章节正文编辑框里的内容，不会自动修改正文，也不会替你提交章节。</p>
      <ul>
        <li>常见错别字和易混词，例如“必竟/毕竟”“在也/再也”等</li>
        <li>重复标点、疑似重复短语等可疑文本</li>
        <li>检测完成后，会弹窗展示命中数量、建议写法，并在预览中标红位置</li>
      </ul>
    </div>`;
  }

  function checkResultModalHtml(content, result = {}) {
    const matches = normalizeCheckMatches(result.matches);
    const empty = matches.length === 0;
    if (empty) {
      return `<div class="nv-check-modal-summary is-ok">
        <p>当前章节没有命中本次检测规则。</p>
      </div>`;
    }
    return `<div class="nv-check-modal-summary">
      <p>共发现 <b>${matches.length}</b> 处命中。下方预览已标红，列表最多展示前 30 条。</p>
    </div>
    <div class="nv-check-preview is-modal">${highlightedContentHtml(content, matches)}</div>
    <div class="nv-check-list is-modal">${matches.slice(0, 30).map(match => `<span>${esc(match.word)}${match.category ? ` · ${esc(match.category)}` : ''}${match.suggestion ? ` · 建议：${esc(match.suggestion)}` : ''}</span>`).join('')}</div>`;
  }

  function novelContentWordCount(novel = state.current) {
    return chapters(novel).reduce((sum, chapter) => sum + displayWordCount(chapterContent(chapter)), 0);
  }

  function chapterWordSum(list = []) {
    return arr(list).reduce((sum, chapter) => sum + displayWordCount(chapterContent(chapter)), 0);
  }

  function currentChapterPlanText(chapter = outlineChapterAt(state.currentChapter)) {
    return firstText(
      chapter.summary,
      chapter.scene_goal,
      chapter.goal,
      chapter.description,
      chapter.function,
      chapter.hook
    );
  }

  function outlineChapterNeedsFill(chapter = {}) {
    return !firstText(chapter.summary, chapter.scene_goal, chapter.goal, chapter.obstacle, chapter.choice, chapter.cost, chapter.hook);
  }

  function chapterIndexOf(chapter = {}, fallback = 1) {
    const explicit = Number(chapter.index);
    return Number.isFinite(explicit) && explicit > 0 ? explicit : fallback;
  }

  function isBareChapterNumberTitle(value = '') {
    return /^第\s*[零〇一二三四五六七八九十百千万两\d]+\s*章$/i.test(text(value));
  }

  function renumberChapterRecord(record = {}, index = 1) {
    return {
      ...record,
      index,
      title: isBareChapterNumberTitle(record.title) ? `第 ${index} 章` : record.title
    };
  }

  function maxChapterIndex(novel = state.current) {
    const outlineList = arr(novel?.outline?.chapters);
    const indexes = [
      Number(novel?.chapter_count || 0),
      outlineList.length,
      arr(novel?.chapters).length,
      ...arr(novel?.chapters).map((chapter, idx) => chapterIndexOf(chapter, idx + 1)),
      ...outlineList.map((chapter, idx) => chapterIndexOf(chapter, idx + 1))
    ].filter(Number.isFinite);
    return Math.max(0, ...indexes);
  }

  function normalizedOutlineChapters(novel = state.current) {
    const raw = arr(novel?.outline?.chapters);
    const byIndex = new Map();
    raw.forEach((chapter, idx) => {
      const index = chapterIndexOf(chapter, idx + 1);
      byIndex.set(index, renumberChapterRecord(chapter, index));
    });
    const total = Math.max(maxChapterIndex(novel), 1);
    return Array.from({ length: total }, (_, idx) => {
      const index = idx + 1;
      return byIndex.get(index) || {
        index,
        title: `第 ${index} 章`,
        summary: '',
        scene_goal: '',
        obstacle: '',
        choice: '',
        cost: '',
        hook: '',
        characters: [],
        key_events: []
      };
    });
  }

  function outlineChapterAt(index) {
    const target = Number(index);
    return normalizedOutlineChapters(state.current).find(chapter => Number(chapter.index) === target) || {};
  }

  function focusOutlineChapter(index) {
    window.setTimeout(() => {
      const card = document.querySelector(`[data-outline-card][data-outline-index="${Number(index)}"]`);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('is-new');
      window.setTimeout(() => card.classList.remove('is-new'), 1800);
    }, 80);
  }

  function focusChapterListItem(index) {
    window.setTimeout(() => {
      const item = document.querySelector(`[data-chapter="${Number(index)}"]`);
      if (!item) return;
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      item.classList.add('is-new');
      window.setTimeout(() => item.classList.remove('is-new'), 1800);
    }, 80);
  }

  function focusAddedChapter(index, panel) {
    if (panel === 'outline') focusOutlineChapter(index);
    else focusChapterListItem(index);
  }

  function disconnectChapterListHeightSync() {
    if (!chapterListResizeObserver) return;
    chapterListResizeObserver.disconnect();
    chapterListResizeObserver = null;
  }

  function syncChapterListHeightToContent() {
    window.requestAnimationFrame(() => {
      const list = document.querySelector('.nv-chapter-list');
      const content = document.getElementById('nvChapterContent');
      if (!list || !content || state.panel !== 'write') {
        if (list) list.style.height = '';
        return;
      }
      if (window.matchMedia('(max-width: 920px)').matches) {
        list.style.height = '';
        return;
      }
      const listBox = list.getBoundingClientRect();
      const contentBox = content.getBoundingClientRect();
      const nextHeight = Math.max(360, Math.round(contentBox.bottom - listBox.top));
      if (Number.isFinite(nextHeight) && nextHeight > 0) {
        list.style.height = `${nextHeight}px`;
      }
    });
  }

  function bindChapterListHeightSync() {
    disconnectChapterListHeightSync();
    syncChapterListHeightToContent();
    const content = document.getElementById('nvChapterContent');
    if (!content || typeof ResizeObserver === 'undefined') return;
    chapterListResizeObserver = new ResizeObserver(syncChapterListHeightToContent);
    chapterListResizeObserver.observe(content);
  }

  function collectOutlineFromInputs() {
    const outline = { ...(state.current?.outline || {}) };
    const synopsisInput = document.getElementById('nvSynopsisInput');
    if (synopsisInput) outline.synopsis = text(synopsisInput.value);
    const cards = Array.from(document.querySelectorAll('[data-outline-card]'));
    if (cards.length) {
      const baseByIndex = new Map(normalizedOutlineChapters(state.current).map((chapter, idx) => [chapterIndexOf(chapter, idx + 1), chapter]));
      outline.chapters = cards.map((card, idx) => {
        const index = Number(card.dataset.outlineIndex) || idx + 1;
        const base = baseByIndex.get(index) || {};
        const field = name => text(card.querySelector(`[data-outline-field="${name}"]`)?.value);
        return {
          ...base,
          index,
          title: field('title') || base.title || `第 ${index} 章`,
          summary: field('summary'),
          scene_goal: field('scene_goal'),
          obstacle: field('obstacle'),
          choice: field('choice'),
          cost: field('cost'),
          hook: field('hook')
        };
      }).sort((a, b) => Number(a.index) - Number(b.index));
    }
    return outline;
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
    const method = String(options.method || 'GET').toUpperCase();
    let requestPath = path;
    if (method === 'GET') {
      const url = new URL(path, window.location.origin);
      url.searchParams.set('_ts', String(Date.now()));
      requestPath = url.pathname + url.search;
    }
    const res = await authFetch(requestPath, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const bodyText = await res.text();
    let data = {};
    if (bodyText) {
      try { data = JSON.parse(bodyText); } catch { data = { success: false, error: bodyText }; }
    }
    if (!res.ok || data.success === false) {
      const rawError = data.error || data.message || '';
      const looksLikeGatewayHtml = /^<!doctype|^<html[\s>]/i.test(String(rawError).trim()) || /502 Bad Gateway|Tengine|nginx/i.test(String(rawError));
      const message = looksLikeGatewayHtml
        ? `服务网关暂时不可用（${res.status || 502}）。通常是后端刚重启、网关连接中断或接口处理超时，请稍后重试。`
        : (rawError || `${res.status} ${res.statusText}`);
      const err = new Error(message);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function getRouteState() {
    const params = new URLSearchParams(window.location.search || '');
    const route = {
      view: params.get('view') || '',
      novel: params.get('novel') || params.get('id') || '',
      chapter: Number(params.get('chapter') || 0) || 0,
      panel: params.get('panel') || ''
    };
    if (route.novel || ['create', 'tasks', 'work'].includes(route.view)) return route;
    try {
      const saved = JSON.parse(localStorage.getItem('vido_novel_last_route') || '{}');
      return {
        view: saved.view || '',
        novel: saved.novel || '',
        chapter: Number(saved.chapter || 0) || 0,
        panel: saved.panel || ''
      };
    } catch {
      return route;
    }
  }

  function updateRouteState({ novelId = state.current?.id || '', chapter = state.currentChapter, panel = state.panel, view = state.view } = {}) {
    const url = new URL(window.location.href);
    if (novelId) {
      url.searchParams.set('view', 'work');
      url.searchParams.set('novel', novelId);
      url.searchParams.set('chapter', String(Number(chapter) || 1));
      url.searchParams.set('panel', panel || 'write');
      try {
        localStorage.setItem('vido_novel_last_route', JSON.stringify({
          view: 'work',
          novel: novelId,
          chapter: Number(chapter) || 1,
          panel: panel || 'write'
        }));
      } catch {}
    } else {
      const routeView = ['create', 'tasks'].includes(view) ? view : 'create';
      url.searchParams.set('view', routeView);
      url.searchParams.delete('novel');
      url.searchParams.delete('chapter');
      url.searchParams.delete('panel');
      try {
        localStorage.setItem('vido_novel_last_route', JSON.stringify({
          view: routeView,
          novel: '',
          chapter: 0,
          panel: ''
        }));
      } catch {}
    }
    window.history.replaceState({}, '', url.pathname + url.search);
  }

  function showToast(message, isError = false) {
    toast.textContent = message;
    toast.classList.toggle('is-error', !!isError);
    toast.classList.add('is-visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 3600);
  }

  function showCenterNotice(message) {
    let notice = document.getElementById('nvCenterNotice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'nvCenterNotice';
      notice.className = 'nv-center-notice';
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      notice.innerHTML = '<span></span>';
      document.body.appendChild(notice);
    }
    notice.querySelector('span').textContent = message;
    notice.classList.remove('is-visible');
    clearTimeout(showCenterNotice.timer);
    requestAnimationFrame(() => notice.classList.add('is-visible'));
    showCenterNotice.timer = setTimeout(() => notice.classList.remove('is-visible'), 2600);
  }

  function confirmAction({
    title = '确认操作',
    message = '',
    detail = '',
    confirmText = '确定',
    cancelText = '取消',
    danger = false
  } = {}) {
    return new Promise(resolve => {
      let mask = document.getElementById('nvConfirmModal');
      if (!mask) {
        mask = document.createElement('div');
        mask.id = 'nvConfirmModal';
        mask.className = 'nv-modal-mask nv-confirm-mask';
        mask.innerHTML = `
          <div class="nv-modal nv-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="nvConfirmTitle">
            <header class="nv-modal-head">
              <div>
                <h2 id="nvConfirmTitle"></h2>
                <p id="nvConfirmMessage"></p>
              </div>
            </header>
            <div class="nv-modal-body">
              <div class="nv-confirm-detail" id="nvConfirmDetail"></div>
            </div>
            <footer class="nv-modal-foot">
              <div></div>
              <button class="nv-btn nv-btn-muted" type="button" data-confirm-cancel></button>
              <button class="nv-btn nv-btn-primary" type="button" data-confirm-ok></button>
            </footer>
          </div>`;
        document.body.appendChild(mask);
      }
      const titleEl = mask.querySelector('#nvConfirmTitle');
      const messageEl = mask.querySelector('#nvConfirmMessage');
      const detailEl = mask.querySelector('#nvConfirmDetail');
      const okBtn = mask.querySelector('[data-confirm-ok]');
      const cancelBtn = mask.querySelector('[data-confirm-cancel]');
      titleEl.textContent = title;
      messageEl.textContent = message;
      detailEl.textContent = detail;
      detailEl.hidden = !detail;
      okBtn.textContent = confirmText;
      cancelBtn.textContent = cancelText;
      okBtn.classList.toggle('is-danger', !!danger);
      const close = value => {
        mask.classList.remove('is-open');
        mask.setAttribute('aria-hidden', 'true');
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        mask.onclick = null;
        document.removeEventListener('keydown', onKeydown);
        resolve(value);
      };
      const onKeydown = event => {
        if (event.key === 'Escape') close(false);
        if (event.key === 'Enter') close(true);
      };
      okBtn.onclick = () => close(true);
      cancelBtn.onclick = () => close(false);
      mask.onclick = event => {
        if (event.target === mask) close(false);
      };
      document.addEventListener('keydown', onKeydown);
      mask.setAttribute('aria-hidden', 'false');
      mask.classList.add('is-open');
      cancelBtn.focus();
    });
  }

  function showInfoModal({
    title = '提示',
    message = '',
    contentHtml = '',
    confirmText = '知道了'
  } = {}) {
    return new Promise(resolve => {
      let mask = document.getElementById('nvInfoModal');
      if (!mask) {
        mask = document.createElement('div');
        mask.id = 'nvInfoModal';
        mask.className = 'nv-modal-mask nv-info-mask';
        mask.innerHTML = `
          <div class="nv-modal nv-info-modal" role="dialog" aria-modal="true" aria-labelledby="nvInfoTitle">
            <header class="nv-modal-head">
              <div>
                <h2 id="nvInfoTitle"></h2>
                <p id="nvInfoMessage"></p>
              </div>
            </header>
            <div class="nv-modal-body" id="nvInfoContent"></div>
            <footer class="nv-modal-foot">
              <div></div>
              <button class="nv-btn nv-btn-primary" type="button" data-info-ok></button>
            </footer>
          </div>`;
        document.body.appendChild(mask);
      }
      const titleEl = mask.querySelector('#nvInfoTitle');
      const messageEl = mask.querySelector('#nvInfoMessage');
      const contentEl = mask.querySelector('#nvInfoContent');
      const okBtn = mask.querySelector('[data-info-ok]');
      titleEl.textContent = title;
      messageEl.textContent = message;
      contentEl.innerHTML = contentHtml || '';
      okBtn.textContent = confirmText;
      const close = () => {
        mask.classList.remove('is-open');
        mask.setAttribute('aria-hidden', 'true');
        okBtn.onclick = null;
        mask.onclick = null;
        document.removeEventListener('keydown', onKeydown);
        resolve(true);
      };
      const onKeydown = event => {
        if (event.key === 'Escape' || event.key === 'Enter') close();
      };
      okBtn.onclick = close;
      mask.onclick = event => {
        if (event.target === mask) close();
      };
      document.addEventListener('keydown', onKeydown);
      mask.setAttribute('aria-hidden', 'false');
      mask.classList.add('is-open');
      okBtn.focus();
    });
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
    const rawMessage = error?.message || '';
    const message = /Failed to fetch|NetworkError|Load failed/i.test(rawMessage)
      ? '请求没有拿到服务器响应，可能是网络中断、服务重启或接口连接被关闭。请稍后重试；如果连续出现，联系管理员查看生产日志。'
      : (rawMessage || '小说方案生成失败');
    return [message, attemptText].filter(Boolean).join('\n');
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
    const progress = Number.isFinite(Number(state.generation.progress))
      ? Math.max(0, Math.min(100, Math.round(Number(state.generation.progress))))
      : null;
    const activeIndex = progress === null ? 0 : Math.min(steps.length - 1, Math.floor(progress / Math.max(1, Math.ceil(100 / steps.length))));
    return `<section class="nv-generation-status" aria-live="polite">
      <div class="nv-generation-orbit"><span></span><span></span><span></span></div>
      <div>
        <b>${esc(state.generation.title || '正在生成')}</b>
        <p>${esc(state.generation.detail || '正在让写作 agent 重新学习素材、知识库和章节质量门槛。')}</p>
        ${progress === null ? '' : `<div class="nv-generation-progress-row"><div class="nv-generation-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div><em>${progress}%</em></div>`}
        <div class="nv-generation-steps">${steps.map((step, index) => `<span class="${index <= activeIndex ? 'is-active' : ''}">${esc(step)}</span>`).join('')}</div>
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
    const existing = arr(novel?.chapters);
    const outlineList = normalizedOutlineChapters(novel);
    const byIndex = new Map(existing.map((chapter, idx) => {
      const index = chapterIndexOf(chapter, idx + 1);
      return [index, renumberChapterRecord(chapter, index)];
    }));
    const outlineByIndex = new Map(outlineList.map((chapter, idx) => [chapterIndexOf(chapter, idx + 1), chapter]));
    const total = Math.max(maxChapterIndex(novel), 1);
    return Array.from({ length: total }, (_, i) => {
      const index = i + 1;
      const outlineChapter = outlineByIndex.get(index) || {};
      return byIndex.get(index) || {
        index,
        title: chapterTitle(outlineChapter, `第 ${index} 章`),
        content: '',
        status: 'draft',
        word_count: 0
      };
    });
  }

  function isChapterDone(chapter) {
    return isChapterSubmitted(chapter);
  }

  function hasSubmittedChapterStatus(chapter) {
    const status = String(chapter?.status || '').toLowerCase();
    return ['done', 'submitted', 'completed', 'finalized'].includes(status);
  }

  function isChapterSubmitted(chapter) {
    return text(chapterContent(chapter)) && !!(chapter.submitted_at || chapter.committed_at || hasSubmittedChapterStatus(chapter));
  }

  function isChapterSubmitting(index) {
    return state.submittingChapters.has(Number(index));
  }

  function isChapterDeleteLocked(chapter) {
    return isChapterSubmitting(chapter?.index);
  }

  function reorderedChapterIndex(index, fromIndex, toIndex) {
    const number = Number(index);
    const from = Number(fromIndex);
    const to = Number(toIndex);
    if (!Number.isFinite(number) || !Number.isFinite(from) || !Number.isFinite(to)) return number;
    if (number === from) return to;
    if (from < to && number > from && number <= to) return number - 1;
    if (from > to && number >= to && number < from) return number + 1;
    return number;
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

  function switchView(view, options = {}) {
    state.view = view;
    createView.classList.toggle('is-active', view === 'create');
    workView.classList.toggle('is-active', view === 'work');
    taskView.classList.toggle('is-active', view === 'tasks');
    if (!options.keepRoute && view !== 'work') updateRouteState({ novelId: '' });
    updateShell();
    if (view === 'tasks') {
      renderTasks();
      run(refreshTasks);
    }
    if (view === 'work') renderWork();
    if (view === 'create') renderHomeList();
  }

  async function loadNovels() {
    const data = await api('/api/novel');
    state.novels = arr(data.novels || data.data || data.items);
    state.taskError = '';
    if (state.current) {
      const fresh = state.novels.find(item => item.id === state.current.id);
      if (fresh) state.current = { ...state.current, ...fresh };
    }
    renderHomeList();
    if (state.view === 'tasks') renderTasks();
  }

  async function refreshTasks() {
    if (state.taskLoading) return;
    state.taskLoading = true;
    state.taskError = '';
    renderTasks();
    try {
      await loadNovels();
    } catch (error) {
      state.taskError = error.message || '任务列表加载失败';
    } finally {
      state.taskLoading = false;
      renderTasks();
    }
  }

  async function loadNovel(id, options = {}) {
    const data = await api('/api/novel/' + encodeURIComponent(id));
    state.current = data.novel || data.data;
    if (!state.current) throw new Error('接口没有返回小说数据');
    const firstDraft = chapters(state.current).find(ch => !isChapterDone(ch));
    const requestedChapter = Number(options.chapter || 0);
    const chapterExists = chapters(state.current).some(ch => Number(ch.index) === requestedChapter);
    state.currentChapter = chapterExists ? requestedChapter : (firstDraft?.index || 1);
    state.panel = options.panel || 'write';
    switchView('work', { keepRoute: true });
    updateRouteState();
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
      const words = novelContentWordCount(novel);
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
    if (state.createMode !== 'import') {
      document.getElementById('nvSelectedLine').textContent = '类型会在下一步弹窗中选择：' + summary;
    }
  }

  function formatFileSize(size = 0) {
    const value = Number(size) || 0;
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
    if (value >= 1024) return `${Math.ceil(value / 1024)}KB`;
    return `${value}B`;
  }

  function setImportStatus(title, detail = '', kind = '', actionLabel = '', progress = null) {
    const status = document.getElementById('nvImportFileStatus');
    if (!status) return;
    status.classList.toggle('is-loading', kind === 'loading');
    status.classList.toggle('is-ready', kind === 'ready');
    status.classList.toggle('is-error', kind === 'error');
    status.classList.toggle('has-action', !!actionLabel);
    const progressValue = progress && Number.isFinite(progress.percent)
      ? Math.max(0, Math.min(100, Math.round(progress.percent)))
      : null;
    const progressHtml = progress
      ? `<div class="nv-import-progress" role="progressbar" aria-label="上传进度" aria-valuemin="0" aria-valuemax="100"${progressValue === null ? '' : ` aria-valuenow="${progressValue}"`}>
          <span style="width:${progressValue === null ? 100 : progressValue}%"></span>
        </div>`
      : '';
    status.innerHTML = `<div><b>${esc(title)}</b>${detail ? `<span>${esc(detail)}</span>` : ''}${progressHtml}</div>${actionLabel ? `<button class="nv-import-clear" type="button" data-clear-import>${esc(actionLabel)}</button>` : ''}`;
  }

  function resetImportContent() {
    if (state.importUploadRequest) {
      state.importUploadRequest.abort();
      state.importUploadRequest = null;
    }
    state.importFile = null;
    state.importAnalysis = null;
    const fileInput = document.getElementById('nvImportFileInput');
    const importInput = document.getElementById('nvImportInput');
    if (fileInput) fileInput.value = '';
    if (importInput) importInput.value = '';
    setCreateError('');
    setImportStatus(
      '等待上传内容',
      '文本、Word、PDF、字幕会提取正文；视频会优先读取内嵌字幕，用于反推世界观、人物和剧情场景。'
    );
    state.createMode = 'import';
    updateCreateModeUI();
  }

  function xhrImportFile(file, onProgress, onUploaded) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      state.importUploadRequest = xhr;
      xhr.open('POST', '/api/novel/import-file');
      if (token()) xhr.setRequestHeader('Authorization', `Bearer ${token()}`);
      xhr.upload.onprogress = event => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(Math.min(99, (event.loaded / event.total) * 100), event.loaded, event.total);
        } else {
          onProgress(null, event.loaded || 0, event.total || file.size || 0);
        }
      };
      xhr.upload.onload = () => {
        onUploaded();
      };
      xhr.onload = () => {
        if (state.importUploadRequest === xhr) state.importUploadRequest = null;
        let data = {};
        try {
          data = JSON.parse(xhr.responseText || '{}');
        } catch (_) {
          data = {};
        }
        resolve({ status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300, data });
      };
      xhr.onerror = () => {
        if (state.importUploadRequest === xhr) state.importUploadRequest = null;
        reject(new Error('上传失败，请检查网络后重试。'));
      };
      xhr.onabort = () => {
        if (state.importUploadRequest === xhr) state.importUploadRequest = null;
        const error = new Error('上传已停止');
        error.name = 'AbortError';
        reject(error);
      };
      const form = new FormData();
      form.append('file', file);
      xhr.send(form);
    });
  }

  async function uploadImportFile(file, handlers) {
    let res = await xhrImportFile(file, handlers.onProgress, handlers.onUploaded);
    if (res.status === 401 && typeof tryRefresh === 'function' && await tryRefresh()) {
      res = await xhrImportFile(file, handlers.onProgress, handlers.onUploaded);
    }
    return res;
  }

  function updateCreateModeUI() {
    document.querySelectorAll('[data-create-mode]').forEach(item => {
      item.classList.toggle('is-active', item.dataset.createMode === state.createMode);
    });
    document.getElementById('nvIdeaInput').classList.toggle('is-hidden', state.createMode !== 'idea');
    document.getElementById('nvImportInput').classList.toggle('is-hidden', state.createMode !== 'import');
    document.getElementById('nvImportTools').classList.toggle('is-hidden', state.createMode !== 'import');
    const mainBtn = document.getElementById('nvOpenCreateModalBtn');
    if (mainBtn) mainBtn.textContent = state.createMode === 'import' ? '解析上传内容' : '选择类型并生成';
    const selectedLine = document.getElementById('nvSelectedLine');
    if (selectedLine) {
      selectedLine.textContent = state.createMode === 'import'
        ? '导入模式：先解析上传/粘贴内容，再根据真实内容生成并完善世界观、人物、剧情场景和章节规划。'
        : '类型会在下一步弹窗中选择：' + createSummary();
    }
  }

  async function handleImportFile(file) {
    if (!file) return;
    if (state.importUploadRequest) {
      state.importUploadRequest.abort();
      state.importUploadRequest = null;
    }
    state.createMode = 'import';
    updateCreateModeUI();
    state.importFile = { name: file.name, type: file.type, size: file.size };
    state.importAnalysis = null;
    const supported = /\.(txt|md|json|srt|vtt|ass|csv|docx|pdf|mp4|mov|webm|m4v)$/i.test(file.name)
      || /^text\//.test(file.type)
      || /^video\//.test(file.type)
      || /pdf|wordprocessingml/.test(file.type);
    if (!supported) {
      const message = '不支持该文件格式。请上传 txt、md、json、srt、vtt、ass、csv、docx、pdf、mp4、mov、webm 或 m4v。';
      setImportStatus(`无法上传：${file.name}`, message, 'error', '清除选择');
      setCreateError(message);
      return;
    }
    const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|webm|m4v)$/i.test(file.name);
    const maxSize = isVideo ? 300 * 1024 * 1024 : 20 * 1024 * 1024;
    if (file.size > maxSize) {
      const message = isVideo ? '视频文件不能超过 300MB。' : '文本/文档文件不能超过 20MB。';
      setImportStatus(`无法上传：${file.name}`, message, 'error', '清除选择');
      setCreateError(message);
      return;
    }
    setCreateError('');
    setImportStatus(
      `已选择：${file.name}`,
      `${formatFileSize(file.size)} · 准备上传，上传完成后会自动解析内容。`,
      'loading',
      '',
      { percent: 0 }
    );
    let result;
    try {
      result = await uploadImportFile(file, {
        onProgress: (percent, loaded, total) => {
          const detail = Number.isFinite(percent)
            ? `${formatFileSize(loaded)} / ${formatFileSize(total || file.size)} · 上传完成后自动解析内容。`
            : `已上传 ${formatFileSize(loaded)} · 上传完成后自动解析内容。`;
          setImportStatus(
            Number.isFinite(percent) ? `上传中：${Math.round(percent)}%` : '上传中',
            detail,
            'loading',
            '',
            { percent }
          );
        },
        onUploaded: () => {
          setImportStatus(
            `上传完成：${file.name}`,
            `${formatFileSize(file.size)} · 正在解析内容，请稍候。`,
            'loading',
            '',
            { percent: 100 }
          );
        }
      });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      const message = error?.message || '上传失败，请检查网络后重试。';
      setImportStatus(`上传失败：${file.name}`, message, 'error', '清除选择');
      setCreateError(message);
      return;
    }
    const data = result.data || {};
    if (!result.ok || data.success === false) {
      const message = data.error || '文件读取失败';
      setImportStatus(`已上传但解析失败：${file.name}`, message, 'error', '删除上传');
      setCreateError(message);
      return;
    }
    const content = text(data.content).slice(0, 180000);
    state.importAnalysis = data.analysis || null;
    document.getElementById('nvImportInput').value = content;
    const analysis = state.importAnalysis || {};
    const importKindText = analysis.kind === 'full_text'
      ? `识别为全文 · ${analysis.chapter_count || 0} 章 · ${analysis.word_count || data.meaningful_length || content.length} 字`
      : analysis.kind === 'full_text_unsectioned'
        ? `识别为全文片段 · 暂未检测到清晰章节标题 · ${analysis.word_count || data.meaningful_length || content.length} 字`
        : analysis.chapter_count >= 2
          ? `识别为大纲/章节规划 · ${analysis.chapter_count} 个章节条目`
          : '识别为大纲/片段内容';
    setImportStatus(
      `已上传并解析：${file.name}`,
      `${formatFileSize(file.size)} · ${importKindText}。下一步点击“解析上传内容”。`,
      'ready',
      '删除上传'
    );
    updateCreateModeUI();
    showToast(isVideo ? '视频内容已读取，将用于反推世界观、人物和剧情。' : '导入内容已读取，可以开始分析。');
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

  function updateGenerationFromTask(task = {}) {
    if (!state.generation || state.generation.type !== 'create') return;
    state.generation = {
      ...state.generation,
      progress: Number.isFinite(Number(task.progress)) ? Number(task.progress) : state.generation.progress,
      detail: task.message || state.generation.detail,
      title: task.status === 'done'
        ? '小说方案已生成'
        : task.status === 'failed'
          ? '小说方案生成失败'
          : state.generation.title
    };
    if (state.view === 'work') renderWork();
    updateShell();
  }

  async function waitForCreateTask(taskId) {
    let consecutiveFailures = 0;
    for (let i = 0; i < 450; i += 1) {
      if (i > 0) await sleep(2000);
      try {
        const data = await api('/api/novel/ai-create/tasks/' + encodeURIComponent(taskId));
        const task = data.task || {};
        consecutiveFailures = 0;
        updateGenerationFromTask(task);
        if (task.status === 'done') return task.result || {};
        if (task.status === 'failed') {
          const error = new Error(task.error || task.message || '小说方案生成失败');
          error.data = { attempts: task.attempts || [] };
          throw error;
        }
      } catch (error) {
        if (error?.data?.attempts || error?.status === 400 || error?.status === 401 || error?.status === 403 || error?.status === 404) throw error;
        consecutiveFailures += 1;
        if (state.generation?.type === 'create') {
          state.generation = {
            ...state.generation,
            detail: '正在重新连接后台任务状态，请稍候。',
            progress: state.generation.progress || 10
          };
          if (state.view === 'work') renderWork();
        }
        if (consecutiveFailures >= 3) throw error;
      }
    }
    throw new Error('后台分析任务等待超时，请稍后刷新任务状态或联系管理员查看生产日志。');
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
      setCreateError('请先粘贴已有作品内容，或上传文件解析出可分析文本后再继续。');
      throw new Error(state.createError);
    }
    setCreateError('');
    state.creating = true;
    setBusy(button, true, mode === 'import' ? '解析内容中...' : '生成方案中...');
    state.panel = 'world';
    state.generation = {
      type: 'create',
      title: mode === 'import' ? '正在分析导入内容' : '正在生成小说方案',
      detail: mode === 'import'
        ? '正在提交后台分析任务，提交成功后会持续显示进度。'
        : '正在提交后台生成任务，提交成功后会持续显示进度。',
      progress: 3,
      steps: mode === 'import'
        ? ['读取导入文本', '提取作品事实', '反推世界观与人物', '生成剧情场景和章节规划']
        : ['读取用户要求', '匹配题材知识库', '构建世界观和冲突', '生成大纲与人物关系']
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
          source_filename: state.importFile?.name || '',
          genre: mode === 'import' ? '' : (genre.api === 'auto' ? '' : genre.api),
          subtype: mode === 'import' ? '' : subtype,
          channel: mode === 'import' || state.config.channel === 'auto' ? '' : channel,
          cultural_region: culture.api,
          novel_type: length.api,
          chapter_count: length.chapter_count,
          chapter_words: length.chapter_words,
          async: true
        })
      });
      const result = data.task?.id ? await waitForCreateTask(data.task.id) : data;
      const novel = result.novel || result.result?.novel;
      if (!novel) throw new Error('后台任务已结束，但没有返回小说项目数据。');
      state.current = novel;
      state.panel = 'world';
      state.currentChapter = 1;
      state.generation = null;
      await loadNovels();
      switchView('work', { keepRoute: true });
      updateRouteState();
      showToast(mode === 'import' ? '导入内容已分析，请先确认世界观和人物。' : '小说方案已生成，请先确认世界观。');
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
      disconnectChapterListHeightSync();
      workView.innerHTML = `<div class="nv-work-page nv-generating-page">
        ${renderGenerationStatus('create')}
      </div>`;
      return;
    }
    if (!state.current) {
      disconnectChapterListHeightSync();
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
          <div class="nv-project-meta">${esc(type)} / ${esc(culture)} / ${esc(genre)} / <span id="nvNovelLiveWordCount">${novelContentWordCount(novel)}</span> 字</div>
        </div>
        <div class="nv-action-buttons">
          <button class="nv-btn nv-btn-muted" type="button" data-export>导出</button>
          ${novel.status === 'completed' ? '<span class="nv-pill done">已完结</span>' : ''}
        </div>
      </div>
      ${renderFlow()}
      <div id="nvPanelMount">${renderPanel()}</div>
    </div>`;
    bindChapterListHeightSync();
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
    const currentLength = lengthOf(state.current);
    const targetChapters = Number(state.current.chapter_count || currentLength.chapter_count || 0);
    const outlineChapterCount = normalizedOutlineChapters(state.current).length;
    const lengthMismatch = outlineChapterCount > 0 && targetChapters > 0 && outlineChapterCount !== targetChapters;
    const lengthAdapter = `<section class="nv-card nv-length-adapter">
      <div class="nv-length-head">
        <div>
          <h3>篇幅改编</h3>
          <p>把当前小说按短篇、中篇或长篇重新规划。这里只保存篇幅目标，不会删除已有正文；重新完善世界观与大纲后，会按目标章节数重构章节任务。</p>
        </div>
        <span>${esc(currentLength.label)} · ${targetChapters || currentLength.chapter_count} 章 · 每章约 ${Number(state.current.chapter_words || currentLength.chapter_words || 0)} 字</span>
      </div>
      <div class="nv-length-options">${LENGTHS.map(item => `<button class="nv-length-option ${currentLength.key === item.key || state.current.novel_type === item.api ? 'is-active' : ''}" type="button" data-adapt-length="${esc(item.key)}" ${busyAttr}>
        <b>${esc(item.label)}</b>
        <span>${item.chapter_count} 章 · 每章约 ${item.chapter_words} 字</span>
      </button>`).join('')}</div>
      ${lengthMismatch ? `<div class="nv-length-warning">当前大纲是 ${outlineChapterCount} 章，目标篇幅是 ${targetChapters} 章。请点击“完善世界观与大纲”或“重新生成大纲”完成改编。</div>` : ''}
    </section>`;
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
    ${lengthAdapter}
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
    const outlineChapters = normalizedOutlineChapters(state.current);
    const incompleteCount = outlineChapters.filter(outlineChapterNeedsFill).length;
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
        <button class="nv-btn nv-btn-muted" type="button" data-add-chapter ${busyAttr}>新增章节</button>
        <button class="nv-btn nv-btn-muted" type="button" data-fill-outline-gaps ${busyAttr}>${outlineBusy ? '补齐中...' : `AI补齐空白章节${incompleteCount ? `（${incompleteCount}）` : ''}`}</button>
        <button class="nv-btn nv-btn-muted" type="button" data-generate-outline ${busyAttr}>${outlineBusy ? '生成中...' : '重新生成大纲'}</button>
        <button class="nv-btn nv-btn-primary" type="button" data-next-graph ${busyAttr}>下一步：查看人物关系图</button>
      </div>
    </section>`;
    return `${actionBand}
    ${renderGenerationStatus('outline')}
    <section class="nv-card">
      <div class="nv-outline-headline">
        <h3>剧情大纲</h3>
        <span>当前共 ${outlineChapters.length} 章${incompleteCount ? ` · ${incompleteCount} 章待补齐` : ''}</span>
      </div>
      <label class="nv-field-label" for="nvSynopsisInput">故事总纲</label>
      <textarea class="nv-textarea" id="nvSynopsisInput" placeholder="生成大纲后显示，也可以人工修改。">${esc(synopsis)}</textarea>
      ${dramaRows.length ? `<div class="nv-drama-grid">${dramaRows.map(([label, value]) => `<div><b>${esc(label)}</b><span>${esc(value)}</span></div>`).join('')}</div>` : ''}
      <div class="nv-outline-list" id="nvOutlineList">${outlineChapters.length ? outlineChapters.map((ch, idx) => {
        const chapterIndex = chapterIndexOf(ch, idx + 1);
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
        return `<div class="nv-outline-item" data-outline-card data-outline-index="${esc(chapterIndex)}">
        <div class="nv-outline-edit-head">
          <span>第 ${chapterIndex} 章</span>
          <input class="nv-input" data-outline-field="title" value="${esc(chapterTitle(ch, '未命名章节'))}" placeholder="章节标题" />
          <button class="nv-btn nv-btn-muted" type="button" data-split-outline-chapter="${esc(chapterIndex)}" ${busyAttr}>拆分章节</button>
          <button class="nv-btn nv-btn-muted" type="button" data-fill-outline-chapter="${esc(chapterIndex)}" ${busyAttr}>AI补齐本章</button>
        </div>
        <label class="nv-field-label">章节任务</label>
        <textarea class="nv-textarea nv-outline-summary-input" data-outline-field="summary" placeholder="写清这一章要发生什么：起因、行动、冲突、转折、结果。">${esc(firstText(ch.summary, ch.goal, ch.description, ''))}</textarea>
        <div class="nv-outline-edit-grid">
          <label><b>场景目标</b><input class="nv-input" data-outline-field="scene_goal" value="${esc(firstText(ch.scene_goal, ch.goal))}" placeholder="本章要完成的具体行动" /></label>
          <label><b>阻力</b><input class="nv-input" data-outline-field="obstacle" value="${esc(firstText(ch.obstacle, ch.conflict))}" placeholder="谁或什么阻拦人物" /></label>
          <label><b>选择</b><input class="nv-input" data-outline-field="choice" value="${esc(firstText(ch.choice))}" placeholder="人物必须做出的选择" /></label>
          <label><b>代价</b><input class="nv-input" data-outline-field="cost" value="${esc(firstText(ch.cost))}" placeholder="选择带来的损失或后果" /></label>
          <label><b>钩子</b><input class="nv-input" data-outline-field="hook" value="${esc(firstText(ch.hook, ch.conflict))}" placeholder="章末留给读者的悬念" /></label>
        </div>
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
    const outlineBusy = state.generation?.type === 'outline';
    const busyAttr = outlineBusy ? 'disabled aria-busy="true"' : '';
    const actionBand = `<section class="nv-action-band nv-action-band-top">
      <div><h3>下一步</h3><p>先检查人物是否来自剧情、关系是否有文本证据、章节出场线索是否清楚；确认后进入章节创作。</p></div>
      <div class="nv-action-buttons"><button class="nv-btn nv-btn-primary" type="button" data-panel-go="write" ${busyAttr}>下一步：进入章节制作</button></div>
    </section>`;
    return `${actionBand}
    ${renderGenerationStatus('outline')}
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
          <p>当前只沉淀了 ${names.length} 个人物。可以让 AI 只根据剧情证据补齐关键人物和明确关系；没有证据则留空。</p>
          <button class="nv-btn nv-btn-primary" type="button" data-expand-characters ${busyAttr}>${outlineBusy ? '完善中...' : '完善人物关系'}</button>
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
            <button class="nv-btn nv-btn-muted" type="button" data-panel-go="outline" ${busyAttr}>返回大纲</button>
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
    const outlineItems = normalizedOutlineChapters(state.current);
    const outlineByIndex = new Map(outlineItems.map((item, idx) => [chapterIndexOf(item, idx + 1), item]));
    const outlineItem = outlineByIndex.get(Number(chapter.index)) || {};
    const chapterRelations = arr(state.current.relationships).slice(0, 6);
    const finalVisible = allChaptersDone(state.current) && state.current.status !== 'completed';
    const currentContent = chapterContent(chapter);
    const currentTitle = chapterTitle(chapter, chapterTitle(outlineItem, ''));
    const hasCurrentContent = !!text(currentContent);
    const currentWords = displayWordCount(currentContent);
    return `<div class="nv-chapter-layout">
      <section class="nv-chapter-list">
        <h3>章节目录</h3>
        <div class="nv-chapter-list-actions">
          <button class="nv-btn nv-btn-muted" type="button" data-add-chapter>新增章节</button>
          <button class="nv-btn nv-btn-muted" type="button" data-save-outline-from-list>保存目录</button>
        </div>
        <div class="nv-chapter-scroll">${list.map(item => {
          const itemDone = isChapterDone(item);
          const itemSubmitting = isChapterSubmitting(item.index);
          const itemDeleteLocked = isChapterDeleteLocked(item);
          return `<div class="nv-chapter-card" draggable="true" data-reorder-chapter="${item.index}">
            <button class="nv-chapter-item ${Number(item.index) === Number(chapter.index) ? 'is-active' : ''} ${itemDone ? 'is-done' : ''}" type="button" data-chapter="${item.index}">
              <b><span class="nv-chapter-drag-handle" title="拖动调整顺序" aria-hidden="true">↕</span>第 ${item.index} 章</b>
              <small>${esc(chapterTitle(item, chapterTitle(outlineByIndex.get(Number(item.index)) || {}, '待生成章节标题')))}</small>
              <span class="nv-status-mini" data-chapter-word-count="${item.index}">${itemSubmitting ? '提交中' : itemDone ? '已提交' : Number(item.index) === Number(chapter.index) ? '编辑中' : '待制作'} · ${displayWordCount(chapterContent(item))} 字</span>
            </button>
            ${itemDeleteLocked ? '' : `<button class="nv-chapter-delete" type="button" data-delete-chapter="${item.index}" title="删除章节">删除</button>`}
          </div>`;
        }).join('')}</div>
      </section>
      <section class="nv-editor">
        <input class="nv-input nv-chapter-title" id="nvChapterTitle" value="${esc(currentTitle)}" placeholder="章节标题" />
        <div class="nv-editor-toolbar">
          <div class="nv-project-meta">当前正文 <span id="nvChapterLiveWordCount">${currentWords}</span> 字。章节正文可手动修改，也可以让 AI 续写、扩写或优化。</div>
          <div class="nv-editor-actions">
            <button class="nv-btn nv-btn-muted" type="button" data-generate-chapter>生成本章</button>
            <button class="nv-btn nv-btn-muted" type="button" data-refine="continue">续写</button>
            <button class="nv-btn nv-btn-muted" type="button" data-refine="polish">改写优化</button>
            <button class="nv-btn nv-btn-muted" type="button" data-split-chapter>拆分本章</button>
            <button class="nv-btn nv-btn-muted" type="button" data-check-typos>错别字检测</button>
            <button class="nv-btn nv-btn-muted" type="button" data-check-sensitive>敏感词检测</button>
            <button class="nv-btn nv-btn-primary" type="button" data-submit-chapter ${isChapterSubmitting(chapter.index) ? 'disabled aria-busy="true"' : ''}>${isChapterSubmitting(chapter.index) ? '提交中...' : '提交本章'}</button>
          </div>
        </div>
        <div class="nv-chapter-stream-status ${state.chapterWriting ? 'is-active' : ''} ${state.chapterWriting?.isError ? 'is-error' : ''}" id="nvChapterStreamStatus">
          <span class="nv-thinking-dot"></span>
          <div>
            <b>${esc(state.chapterWriting?.title || '正在生成正文')}</b>
            <p>${esc(state.chapterWriting?.detail || '请稍候，内容会写入下方编辑区。')}</p>
          </div>
        </div>
        ${hasCurrentContent || state.chapterWriting ? '' : `<section class="nv-chapter-empty-state">
          <div>
            <h3>本章还没有正文</h3>
            <p>当前只有章节故事点和人物线索，还没有生成或保存过正文。可以点击上方“生成本章”，也可以直接在下方手动输入。</p>
          </div>
        </section>`}
        <textarea class="nv-textarea nv-chapter-content ${hasCurrentContent ? '' : 'is-empty'}" id="nvChapterContent" placeholder="正文会显示在这里，也可以手动编辑。">${esc(currentContent)}</textarea>
        ${renderChapterCheckResult(currentContent)}
        <section class="nv-finalize ${finalVisible ? 'is-visible' : ''}">
          <div><h3>所有章节已提交</h3><p>确认后小说状态会变为“已完成”，任务中心会进入已完成列表。</p></div>
          <button class="nv-btn nv-btn-primary" type="button" data-complete-novel>确认完结小说</button>
        </section>
      </section>
      <aside class="nv-side-stack">
        <section>
          <h3>当前章节故事点</h3>
          <section class="nv-chapter-plan-editor">
            <label>
              <b>本章写作任务（给作家）</b>
              <textarea class="nv-textarea" id="nvChapterPlanInput" placeholder="写清这一章具体要怎么写：开场场景、人物行动、冲突、转折、结尾钩子。">${esc(currentChapterPlanText(outlineItem))}</textarea>
            </label>
            <div class="nv-chapter-plan-grid">
              <label><b>阻力</b><input class="nv-input" id="nvChapterObstacleInput" value="${esc(firstText(outlineItem.obstacle, outlineItem.conflict))}" placeholder="本章阻力或关系张力" /></label>
              <label><b>选择</b><input class="nv-input" id="nvChapterChoiceInput" value="${esc(firstText(outlineItem.choice))}" placeholder="人物必须做的选择" /></label>
              <label><b>代价</b><input class="nv-input" id="nvChapterCostInput" value="${esc(firstText(outlineItem.cost))}" placeholder="选择造成的后果" /></label>
              <label><b>钩子</b><input class="nv-input" id="nvChapterHookInput" value="${esc(firstText(outlineItem.hook))}" placeholder="章末悬念或情绪落点" /></label>
            </div>
            <label>
              <b>本次给作家的具体要求</b>
              <textarea class="nv-textarea nv-writer-note" id="nvChapterWriterNote" placeholder="例如：这一段改成先压抑后爆发；多写动作和对话；不要增加新人名；保留原剧情但让情绪更疼。"></textarea>
            </label>
          </section>
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

  async function adaptNovelLength(key, button) {
    const length = LENGTHS.find(item => item.key === key || item.api === key);
    if (!length || !state.current) return;
    setBusy(button, true, '保存中...');
    try {
      const data = await api('/api/novel/' + encodeURIComponent(state.current.id), {
        method: 'PUT',
        body: JSON.stringify({
          novel_type: length.api,
          chapter_count: length.chapter_count,
          chapter_words: length.chapter_words
        })
      });
      state.current = data.novel || {
        ...state.current,
        novel_type: length.api,
        chapter_count: length.chapter_count,
        chapter_words: length.chapter_words
      };
      await loadNovels();
      renderWork();
      showToast(`已切换为${length.label}。重新生成大纲后，会按 ${length.chapter_count} 章重新规划。`);
    } finally {
      setBusy(button, false);
    }
  }

  async function generateOutline(button, options = {}) {
    const fromPanel = state.panel;
    const isGraphRepair = options.nextPanel === 'graph' && fromPanel === 'graph';
    state.generation = {
      type: 'outline',
      title: isGraphRepair ? '正在完善人物关系' : '正在重新生成世界观与大纲',
      detail: isGraphRepair
        ? '写作 agent 正在重读大纲、章节任务书和人物线索，只补齐有剧情证据的人物和关系。'
        : '写作 agent 正在重读用户要求、知识库和参考写作规则，并检查人物、起因、矛盾、风险与章节任务书。',
      progress: 12
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

  async function saveOutline(options = {}) {
    const outline = collectOutlineFromInputs();
    const chapter_count = Math.max(maxChapterIndex({ ...state.current, outline }), arr(outline.chapters).length || 0);
    const data = await api('/api/novel/' + encodeURIComponent(state.current.id), {
      method: 'PUT',
      body: JSON.stringify({
        outline,
        description: outline.synopsis || state.current.description,
        chapter_count
      })
    });
    state.current = data.novel || { ...state.current, outline, chapter_count, description: outline.synopsis || state.current.description };
    if (!options.silent) showToast('大纲已保存');
    return state.current;
  }

  async function fillOutlineGaps(button, chapterIndex = null) {
    state.generation = {
      type: 'outline',
      title: chapterIndex ? `正在补齐第 ${chapterIndex} 章任务书` : '正在补齐空白章节任务书',
      detail: '写作 agent 会读取已有剧情、人物、章节前后关系，只补齐空白或指定章节，不覆盖已有完整章节。',
      progress: 18
    };
    renderWork();
    setBusy(button, true, '补齐中...');
    try {
      await saveOutline({ silent: true });
      const body = chapterIndex ? { chapter_indexes: [Number(chapterIndex)] } : {};
      const data = await api(`/api/novel/${encodeURIComponent(state.current.id)}/outline/fill-gaps`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      state.current = data.novel || { ...state.current, outline: data.outline || state.current.outline };
      state.panel = 'outline';
      renderWork();
      showToast(chapterIndex ? `第 ${chapterIndex} 章任务书已补齐` : `已补齐 ${data.filled_count || 0} 个空白章节`);
    } finally {
      state.generation = null;
      setBusy(button, false);
      renderWork();
    }
  }

  async function autoFillSplitChapter(chapterIndex) {
    if (!state.current?.id || !Number(chapterIndex)) return;
    state.generation = {
      type: 'outline',
      title: `正在补齐第 ${chapterIndex} 章任务书`,
      detail: '已先完成拆分和顺延，写作 agent 正在根据前后章节补齐场景目标、阻力、选择、代价和钩子。',
      progress: 24
    };
    renderWork();
    focusOutlineChapter(chapterIndex);
    try {
      const data = await api(`/api/novel/${encodeURIComponent(state.current.id)}/outline/fill-gaps`, {
        method: 'POST',
        body: JSON.stringify({ chapter_indexes: [Number(chapterIndex)] })
      });
      state.current = data.novel || { ...state.current, outline: data.outline || state.current.outline };
      state.panel = 'outline';
      renderWork();
      focusOutlineChapter(chapterIndex);
      showToast(`第 ${chapterIndex} 章任务书已自动补齐`);
    } catch (error) {
      showToast(`第 ${chapterIndex} 章已拆分，但 AI 补齐失败：${error.message}`, true);
    } finally {
      state.generation = null;
      renderWork();
      focusOutlineChapter(chapterIndex);
    }
  }

  function readCurrentChapterPlanFromDom() {
    return {
      summary: text(document.getElementById('nvChapterPlanInput')?.value),
      obstacle: text(document.getElementById('nvChapterObstacleInput')?.value),
      choice: text(document.getElementById('nvChapterChoiceInput')?.value),
      cost: text(document.getElementById('nvChapterCostInput')?.value),
      hook: text(document.getElementById('nvChapterHookInput')?.value),
      user_note: text(document.getElementById('nvChapterWriterNote')?.value)
    };
  }

  function currentChapterDraftFromDom(status) {
    if (!state.current) return null;
    const index = Number(state.currentChapter || 1);
    const title = text(document.getElementById('nvChapterTitle')?.value) || `第 ${index} 章`;
    const content = document.getElementById('nvChapterContent')?.value || '';
    return {
      index,
      title,
      content,
      status,
      word_count: displayWordCount(content),
      updated_at: new Date().toISOString()
    };
  }

  function currentChapterReorderDraftFromDom() {
    const draft = currentChapterDraftFromDom();
    if (!draft) return null;
    return {
      ...draft,
      plan: readCurrentChapterPlanFromDom()
    };
  }

  function chapterReorderSnapshot(index) {
    const target = Number(index);
    if (!state.current || !Number.isInteger(target) || target < 1) return null;
    const chapter = chapters(state.current).find(item => Number(item.index) === target);
    const outlineChapter = normalizedOutlineChapters(state.current).find(item => Number(item.index) === target);
    if (!chapter && !outlineChapter) return null;
    return {
      index: target,
      chapter: chapter ? { ...chapter, index: target } : null,
      outline_chapter: outlineChapter ? { ...outlineChapter, index: target } : null
    };
  }

  function sameReorderValue(a, b) {
    return text(a) === text(b);
  }

  function assertMovedChapterSnapshot(snapshot, targetIndex) {
    if (!snapshot || !state.current) return;
    const target = Number(targetIndex);
    const sourceChapter = snapshot.chapter || {};
    const sourceOutline = snapshot.outline_chapter || {};
    const movedChapter = chapters(state.current).find(chapter => Number(chapter.index) === target) || {};
    const movedOutline = normalizedOutlineChapters(state.current).find(chapter => Number(chapter.index) === target) || {};
    const checks = [
      [chapterTitle(movedChapter, ''), chapterTitle(sourceChapter, ''), '标题'],
      [chapterContent(movedChapter), chapterContent(sourceChapter), '正文'],
      [currentChapterPlanText(movedOutline), currentChapterPlanText(sourceOutline), '章节故事点'],
      [firstText(movedOutline.obstacle, movedOutline.conflict), firstText(sourceOutline.obstacle, sourceOutline.conflict), '阻力'],
      [firstText(movedOutline.choice), firstText(sourceOutline.choice), '选择'],
      [firstText(movedOutline.cost), firstText(sourceOutline.cost), '代价'],
      [firstText(movedOutline.hook), firstText(sourceOutline.hook), '钩子']
    ];
    const failed = checks.find(([actual, expected]) => text(expected) && !sameReorderValue(actual, expected));
    if (failed) {
      throw new Error(`章节移动后内容校验失败：${failed[2]}没有跟随章节整体移动，请刷新后重试。`);
    }
  }

  function applyCurrentChapterDraftToNovel(novel = state.current, status) {
    const draft = currentChapterDraftFromDom(status);
    if (!novel || !draft) return novel;
    const list = chapters(novel);
    let found = false;
    const nextChapters = list.map(chapter => {
      if (Number(chapter.index) !== Number(draft.index)) return chapter;
      found = true;
      return {
        ...chapter,
        title: draft.title,
        content: draft.content,
        status: draft.status || chapter.status || 'draft',
        word_count: draft.word_count,
        updated_at: draft.updated_at
      };
    });
    if (!found) nextChapters.push({
      index: draft.index,
      title: draft.title,
      content: draft.content,
      status: draft.status || 'draft',
      word_count: draft.word_count,
      updated_at: draft.updated_at
    });
    nextChapters.sort((a, b) => Number(a.index) - Number(b.index));
    return {
      ...novel,
      chapters: nextChapters,
      total_words: chapterWordSum(nextChapters),
      updated_at: draft.updated_at
    };
  }

  function updateCurrentChapterDraftDisplay() {
    if (!state.current) return;
    const index = Number(state.currentChapter || 1);
    const chapter = chapters().find(item => Number(item.index) === index);
    if (!chapter) return;
    const wordCount = displayWordCount(chapterContent(chapter));
    const currentCount = document.getElementById('nvChapterLiveWordCount');
    if (currentCount) currentCount.textContent = String(wordCount);
    const novelCount = document.getElementById('nvNovelLiveWordCount');
    if (novelCount) novelCount.textContent = String(novelContentWordCount(state.current));
    const item = document.querySelector(`[data-chapter="${index}"]`);
    if (!item) return;
    const titleNode = item.querySelector('small');
    if (titleNode) titleNode.textContent = chapterTitle(chapter, `第 ${index} 章`);
    const statusNode = item.querySelector(`[data-chapter-word-count="${index}"]`);
    if (statusNode) {
      const label = isChapterSubmitting(index) ? '提交中' : isChapterDone(chapter) ? '已提交' : '编辑中';
      statusNode.textContent = `${label} · ${wordCount} 字`;
    }
  }

  function syncCurrentChapterDraftFromDom(status) {
    if (!hasActiveChapterEditor()) return;
    state.current = applyCurrentChapterDraftToNovel(state.current, status);
    updateCurrentChapterDraftDisplay();
  }

  async function saveChapterPlan(options = {}) {
    if (!state.current) return state.current;
    const index = Number(state.currentChapter || 1);
    const title = text(document.getElementById('nvChapterTitle')?.value) || `第 ${index} 章`;
    const content = document.getElementById('nvChapterContent')?.value || '';
    const plan = readCurrentChapterPlanFromDom();
    const list = chapters().map(ch => Number(ch.index) === index
      ? {
          ...ch,
          title,
          content,
          word_count: displayWordCount(content),
          updated_at: new Date().toISOString()
        }
      : ch);
    const outlineChapters = normalizedOutlineChapters(state.current);
    const outlinePosition = outlineChapters.findIndex(chapter => Number(chapter.index) === index);
    if (outlinePosition < 0) {
      outlineChapters.push({ index, title: `第 ${index} 章`, summary: '' });
      outlineChapters.sort((a, b) => Number(a.index) - Number(b.index));
    }
    const targetPosition = outlineChapters.findIndex(chapter => Number(chapter.index) === index);
    const previousOutlineChapter = outlineChapters[targetPosition] || {};
    outlineChapters[targetPosition] = {
      ...previousOutlineChapter,
      index,
      title,
      summary: plan.summary || previousOutlineChapter.summary || '',
      scene_goal: plan.summary || previousOutlineChapter.scene_goal || previousOutlineChapter.goal || '',
      obstacle: plan.obstacle || previousOutlineChapter.obstacle || previousOutlineChapter.conflict || '',
      choice: plan.choice || previousOutlineChapter.choice || '',
      cost: plan.cost || previousOutlineChapter.cost || '',
      hook: plan.hook || previousOutlineChapter.hook || ''
    };
    const outline = { ...(state.current.outline || {}), chapters: outlineChapters };
    const chapter_count = Math.max(maxChapterIndex({ ...state.current, chapters: list, outline }), outlineChapters.length, list.length);
    const data = await api('/api/novel/' + encodeURIComponent(state.current.id), {
      method: 'PUT',
      body: JSON.stringify({ chapters: list, outline, chapter_count, allow_shorter_chapter_content: true })
    });
    state.current = hasActiveChapterEditor()
      ? applyCurrentChapterDraftToNovel(data.novel || { ...state.current, chapters: list, outline, chapter_count })
      : (data.novel || { ...state.current, chapters: list, outline, chapter_count });
    updateCurrentChapterDraftDisplay();
    if (!options.silent) showToast('章节任务已保存');
    return state.current;
  }

  function currentChapterPayload(status) {
    const title = text(document.getElementById('nvChapterTitle')?.value);
    const content = document.getElementById('nvChapterContent')?.value || '';
    const list = chapters().map(ch => Number(ch.index) === Number(state.currentChapter)
      ? {
          ...ch,
          title,
          content,
          status: status || ch.status || 'draft',
          submitted_at: status === 'done' ? (ch.submitted_at || new Date().toISOString()) : ch.submitted_at,
          word_count: displayWordCount(content),
          updated_at: new Date().toISOString()
        }
      : ch);
    return list;
  }

  async function saveChapter(status) {
    await saveChapterPlan({ silent: true });
    const list = currentChapterPayload(status);
    const data = await api('/api/novel/' + encodeURIComponent(state.current.id), {
      method: 'PUT',
      body: JSON.stringify({ chapters: list, status: state.current.status === 'completed' ? 'completed' : 'draft', allow_shorter_chapter_content: true })
    });
    state.current = hasActiveChapterEditor()
      ? applyCurrentChapterDraftToNovel(data.novel || { ...state.current, chapters: list }, status)
      : (data.novel || { ...state.current, chapters: list });
    updateCurrentChapterDraftDisplay();
    showToast(status === 'done' ? '本章已保存为已提交' : '本章已保存');
  }

  function stream(url, onChunk, options = {}) {
    return new Promise((resolve, reject) => {
      const es = new EventSource(url);
      let finalText = '';
      let receivedChunk = false;
      const firstChunkTimer = setTimeout(() => {
        if (!receivedChunk) options.onWaiting?.();
      }, options.firstChunkDelay || 12000);
      const cleanup = () => {
        clearTimeout(firstChunkTimer);
        es.close();
      };
      es.onmessage = event => {
        let data = {};
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'chunk') {
          receivedChunk = true;
          finalText += data.text || '';
          onChunk(data.text || '', finalText);
        }
        if (data.type === 'done') {
          cleanup();
          resolve(data);
        }
        if (data.type === 'error') {
          cleanup();
          reject(new Error(data.message || '流式生成失败'));
        }
      };
      es.onerror = () => {
        cleanup();
        reject(new Error('流式连接失败'));
      };
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function updateChapterWriteStatus(title, detail, isError = false) {
    state.chapterWriting = { title, detail, isError };
    const box = document.getElementById('nvChapterStreamStatus');
    if (!box) return;
    box.classList.add('is-active');
    box.classList.toggle('is-error', !!isError);
    const titleEl = box.querySelector('b');
    const detailEl = box.querySelector('p');
    if (titleEl) titleEl.textContent = title;
    if (detailEl) detailEl.textContent = detail;
  }

  function finishChapterWriteStatus() {
    state.chapterWriting = null;
    const box = document.getElementById('nvChapterStreamStatus');
    if (box) {
      box.classList.remove('is-active');
      box.classList.remove('is-error');
    }
  }

  function hasActiveChapterEditor() {
    return !!(state.current && state.panel === 'write' && document.getElementById('nvChapterContent'));
  }

  function scheduleChapterAutoSave(delay = 350) {
    if (!hasActiveChapterEditor()) return;
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = setTimeout(() => {
      run(() => autoSaveCurrentChapter({ reason: 'input' }));
    }, delay);
  }

  async function autoSaveCurrentChapter(options = {}) {
    if (!hasActiveChapterEditor()) return state.current;
    clearTimeout(state.autoSaveTimer);
    if (state.autoSaveInFlight) {
      state.autoSaveQueued = true;
      await state.autoSaveInFlight;
      if (state.autoSaveQueued) {
        state.autoSaveQueued = false;
        return autoSaveCurrentChapter(options);
      }
      return state.current;
    }
    state.autoSaveInFlight = saveChapterPlan({ silent: true })
      .then(novel => {
        state.autoSaveLastAt = Date.now();
        state.autoSaveError = '';
        return novel;
      })
      .catch(error => {
        state.autoSaveError = error.message || '自动保存失败';
        if (!options.quiet) showToast('自动保存失败，请检查网络后继续编辑，系统会再次尝试自动保存', true);
        throw error;
      })
      .finally(() => {
        state.autoSaveInFlight = null;
      });
    return state.autoSaveInFlight;
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
    const writerNote = text(document.getElementById('nvChapterWriterNote')?.value);
    await saveChapterPlan({ silent: true });
    state.chapterWriting = {
      title: '正在生成正文',
      detail: '正在连接写作模型，请稍候。'
    };
    updateChapterWriteStatus(state.chapterWriting.title, state.chapterWriting.detail);
    setBusy(button, true, '生成中...');
    const area = document.getElementById('nvChapterContent');
    area.value = '';
    const writer = createChapterTypingWriter(area, { mode: 'replace', sourceValue: '', start: 0, end: 0 });
    let failed = false;
    try {
      updateChapterWriteStatus('正在生成正文', '正在等待模型返回正文。');
      const url = `/api/novel/${encodeURIComponent(state.current.id)}/generate-chapter-stream?chapter=${encodeURIComponent(state.currentChapter)}&user_note=${encodeURIComponent(writerNote)}&token=${encodeURIComponent(token())}`;
      await stream(url, (chunk) => {
        updateChapterWriteStatus('正在生成正文', '已收到正文内容，正在持续生成。');
        writer.enqueue(chunk);
      }, {
        onWaiting: () => updateChapterWriteStatus('仍在等待模型返回', '模型还没有返回第一段正文，请继续等待；如果接口失败，会显示真实错误。')
      });
      await writer.finish();
      await refreshCurrent();
      state.panel = 'write';
      renderWork();
      showToast('本章已生成，确认后可提交。');
    } catch (error) {
      failed = true;
      updateChapterWriteStatus('生成失败', error.message || '章节生成失败', true);
      throw error;
    } finally {
      if (!failed) finishChapterWriteStatus();
      setBusy(button, false);
    }
  }

  async function refineChapter(mode, button) {
    const area = document.getElementById('nvChapterContent');
    const selected = area.value.slice(area.selectionStart, area.selectionEnd);
    const base = mode === 'continue' ? area.value : (selected || area.value);
    if (!text(base)) throw new Error(mode === 'continue' ? '当前章节还没有可续写内容' : '当前章节还没有可改写内容');
    const writerNote = text(document.getElementById('nvChapterWriterNote')?.value);
    const plan = readCurrentChapterPlanFromDom();
    await saveChapterPlan({ silent: true });
    const instruction = [
      mode === 'continue'
        ? '请在保持设定、人物状态和章节目标一致的前提下，自然续写当前章节，约800字。'
        : selected
          ? '请把所选文字改写成可直接替换的小说正文，优化节奏、画面感、对话潜台词和追读力，并保持事实不变。'
          : '请把当前章节全文改写成可直接替换的小说正文，优化节奏、画面感、对话潜台词和追读力，并保持事实不变。',
      plan.summary ? `本章写作任务：${plan.summary}` : '',
      plan.obstacle ? `本章阻力/关系张力：${plan.obstacle}` : '',
      plan.choice ? `本章选择：${plan.choice}` : '',
      plan.cost ? `本章代价：${plan.cost}` : '',
      plan.hook ? `本章钩子：${plan.hook}` : '',
      writerNote ? `用户给作家的具体要求：${writerNote}` : ''
    ].filter(Boolean).join('\n');
    const selectionStart = area.selectionStart;
    const selectionEnd = area.selectionEnd;
    state.chapterWriting = {
      title: mode === 'continue' ? '正在续写正文' : '正在改写正文',
      detail: '正在连接写作模型，请稍候。'
    };
    updateChapterWriteStatus(state.chapterWriting.title, state.chapterWriting.detail);
    setBusy(button, true, mode === 'continue' ? '续写中...' : '优化中...');
    const liveArea = document.getElementById('nvChapterContent');
    const sourceValue = liveArea.value;
    const writer = createChapterTypingWriter(liveArea, {
      mode: mode === 'continue' ? 'append' : 'replace',
      sourceValue: mode === 'continue' ? `${sourceValue}\n\n` : sourceValue,
      start: selected ? selectionStart : 0,
      end: selected ? selectionEnd : sourceValue.length
    });
    let failed = false;
    try {
      updateChapterWriteStatus(mode === 'continue' ? '正在续写正文' : '正在改写正文', '正在等待模型返回内容。');
      const data = await api(`/api/novel/${encodeURIComponent(state.current.id)}/refine`, {
        method: 'POST',
        body: JSON.stringify({
          text: base,
          instruction,
          mode,
          chapter: state.currentChapter,
          user_note: writerNote
        })
      });
      if (!text(data.text)) throw new Error('模型没有返回可用改写内容');
      updateChapterWriteStatus(mode === 'continue' ? '正在续写正文' : '正在改写正文', '已收到内容，正在写入编辑区。');
      writer.enqueue(data.text || '');
      await writer.finish();
      showToast(mode === 'continue' ? '续写完成，请检查后保存。' : '优化完成，请检查后保存。');
    } catch (error) {
      failed = true;
      updateChapterWriteStatus(mode === 'continue' ? '续写失败' : '改写失败', error.message || '操作失败', true);
      throw error;
    } finally {
      if (!failed) finishChapterWriteStatus();
      setBusy(button, false);
    }
  }

  async function submitChapter(button) {
    const content = text(document.getElementById('nvChapterContent')?.value);
    if (!content) throw new Error('章节内容为空，不能提交本章');
    const submittingIndex = Number(state.currentChapter || 1);
    syncCurrentChapterDraftFromDom();
    state.submittingChapters.add(submittingIndex);
    renderWork();
    setBusy(button, true, '提交中...');
    try {
      await saveChapter('done');
      const review = await api(`/api/novel/${encodeURIComponent(state.current.id)}/chapters/${encodeURIComponent(state.currentChapter)}/review`, { method: 'POST' });
      state.current = review.novel || state.current;
      const facts = await api(`/api/novel/${encodeURIComponent(state.current.id)}/chapters/${encodeURIComponent(state.currentChapter)}/extract-facts`, { method: 'POST' });
      state.current = facts.novel || state.current;
      const next = chapters().find(ch => !isChapterDone(ch));
      if (next) state.currentChapter = next.index;
      state.submittingChapters.delete(submittingIndex);
      renderWork();
      showToast(next ? `第 ${submittingIndex} 章已提交，进入第 ${next.index} 章。` : '所有章节已提交，可以确认完结小说。');
    } finally {
      state.submittingChapters.delete(submittingIndex);
      renderWork();
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
    const targetPanel = state.panel === 'outline' ? 'outline' : 'write';
    const baseOutline = state.panel === 'outline' ? collectOutlineFromInputs() : state.current.outline;
    const baseNovel = { ...state.current, outline: baseOutline };
    const list = chapters(baseNovel);
    const next = maxChapterIndex(baseNovel) + 1;
    const newChapter = { index: next, title: `第 ${next} 章`, content: '', status: 'draft', word_count: 0 };
    const newOutlineChapter = {
      index: next,
      title: `第 ${next} 章`,
      summary: '',
      scene_goal: '',
      obstacle: '',
      choice: '',
      cost: '',
      hook: '',
      characters: [],
      key_events: []
    };
    const nextList = [...list.filter(chapter => Number(chapter.index) !== next), newChapter].sort((a, b) => Number(a.index) - Number(b.index));
    const outline = {
      ...(state.current.outline || {}),
      chapters: [
        ...normalizedOutlineChapters(baseNovel).filter(chapter => Number(chapter.index) !== next),
        newOutlineChapter
      ].sort((a, b) => Number(a.index) - Number(b.index))
    };
    const chapter_count = Math.max(next, outline.chapters.length, nextList.length);
    const optimistic = { ...state.current, chapters: nextList, outline, chapter_count };
    state.current = optimistic;
    state.currentChapter = next;
    state.panel = targetPanel;
    updateRouteState();
    renderWork();
    focusAddedChapter(next, targetPanel);
    const data = await api('/api/novel/' + encodeURIComponent(state.current.id), {
      method: 'PUT',
      body: JSON.stringify({ chapters: nextList, outline, chapter_count })
    });
    state.current = data.novel || optimistic;
    state.currentChapter = next;
    state.panel = targetPanel;
    updateRouteState();
    renderWork();
    focusAddedChapter(next, targetPanel);
    showToast(`已新增第 ${next} 章，已同步到剧情大纲。`);
  }

  async function splitOutlineChapter(index) {
    if (!state.current) return;
    const splitIndex = Number(index || state.currentChapter || 1);
    if (!Number.isFinite(splitIndex) || splitIndex < 1) throw new Error('请选择要拆分的章节');
    const insertIndex = splitIndex + 1;
    const ok = await confirmAction({
      title: '拆分章节',
      message: `将在第 ${splitIndex} 章后插入新的第 ${insertIndex} 章。`,
      detail: '确认后会自动顺延后续章节。新章节会保持空白，你可以在大纲卡片里填写标题和章节任务，再让 AI 补写或改写。',
      confirmText: '确定拆分',
      cancelText: '取消'
    });
    if (!ok) return;
    const newTitle = `第 ${insertIndex} 章`;
    const newTask = '';
    const previous = state.current;
    const baseOutline = state.panel === 'outline' ? collectOutlineFromInputs() : previous.outline;
    const baseNovel = { ...previous, outline: baseOutline };
    const updatedChapters = chapters(baseNovel).map(chapter => {
      const currentIndex = Number(chapter.index);
      return currentIndex >= insertIndex
        ? renumberChapterRecord(chapter, currentIndex + 1)
        : renumberChapterRecord(chapter, currentIndex);
    });
    updatedChapters.push({
      index: insertIndex,
      title: newTitle,
      content: '',
      status: 'draft',
      word_count: 0,
      source: 'manual_split',
      updated_at: new Date().toISOString()
    });
    updatedChapters.sort((a, b) => Number(a.index) - Number(b.index));
    const updatedOutlineChapters = normalizedOutlineChapters(baseNovel).map(chapter => {
      const currentIndex = Number(chapter.index);
      return currentIndex >= insertIndex
        ? renumberChapterRecord(chapter, currentIndex + 1)
        : renumberChapterRecord(chapter, currentIndex);
    });
    updatedOutlineChapters.push({
      index: insertIndex,
      title: newTitle,
      summary: newTask,
      scene_goal: newTask,
      obstacle: '',
      choice: '',
      cost: '',
      hook: '',
      characters: [],
      key_events: [],
      source: 'manual_split'
    });
    updatedOutlineChapters.sort((a, b) => Number(a.index) - Number(b.index));
    const outline = { ...(baseOutline || {}), chapters: updatedOutlineChapters };
    const chapter_count = Math.max(maxChapterIndex({ ...previous, chapters: updatedChapters, outline }), updatedChapters.length, updatedOutlineChapters.length);
    const optimistic = { ...previous, chapters: updatedChapters, outline, chapter_count };
    state.current = optimistic;
    state.currentChapter = insertIndex;
    state.panel = 'outline';
    renderWork();
    focusOutlineChapter(insertIndex);
    showToast(`已先插入第 ${insertIndex} 章，正在保存并让 AI 补齐任务书。`);
    try {
      const data = await api('/api/novel/' + encodeURIComponent(previous.id), {
        method: 'PUT',
        body: JSON.stringify({ chapters: updatedChapters, outline, chapter_count })
      });
      state.current = data.novel || optimistic;
      state.currentChapter = insertIndex;
      state.panel = 'outline';
      renderWork();
      focusOutlineChapter(insertIndex);
      await autoFillSplitChapter(insertIndex);
    } catch (error) {
      state.current = previous;
      state.currentChapter = splitIndex;
      state.panel = 'outline';
      renderWork();
      throw error;
    }
  }

  async function splitCurrentChapter() {
    if (!state.current) return;
    const area = document.getElementById('nvChapterContent');
    if (!area) throw new Error('当前没有可拆分的正文编辑区');
    const source = area.value || '';
    if (!text(source)) throw new Error('当前章节还没有正文，不能拆分');
    const currentIndex = Number(state.currentChapter || 1);
    const start = Number(area.selectionStart || 0);
    const end = Number(area.selectionEnd || 0);
    let currentContent = '';
    let newContent = '';
    if (end > start) {
      newContent = source.slice(start, end).trim();
      currentContent = `${source.slice(0, start)}${source.slice(end)}`.trim();
    } else {
      if (start <= 0 || start >= source.length) {
        throw new Error('请先选中要拆出的正文，或把光标放在要拆分的位置');
      }
      currentContent = source.slice(0, start).trim();
      newContent = source.slice(start).trim();
    }
    if (!text(currentContent) || !text(newContent)) throw new Error('拆分后两章都需要保留正文内容');
    const insertIndex = currentIndex + 1;
    const ok = await confirmAction({
      title: '拆分本章正文',
      message: `将当前第 ${currentIndex} 章拆成第 ${currentIndex} 章和第 ${insertIndex} 章。`,
      detail: end > start
        ? '确认后，选中的正文会移动到新章节；当前章节会保留剩余正文。'
        : '确认后，光标后的正文会移动到新章节；当前章节保留光标前的正文。',
      confirmText: '确定拆分',
      cancelText: '取消'
    });
    if (!ok) return;
    const currentTitle = text(document.getElementById('nvChapterTitle')?.value) || `第 ${currentIndex} 章`;
    const newTitle = `第 ${insertIndex} 章`;
    const newPlan = '';
    const previous = state.current;
    const updatedChapters = chapters(previous).map(chapter => {
      const index = Number(chapter.index);
      if (index === currentIndex) {
        return {
          ...chapter,
          index,
          title: currentTitle,
          content: currentContent,
          status: 'draft',
          word_count: displayWordCount(currentContent),
          updated_at: new Date().toISOString()
        };
      }
      if (index >= insertIndex) return renumberChapterRecord(chapter, index + 1);
      return renumberChapterRecord(chapter, index);
    });
    updatedChapters.push({
      index: insertIndex,
      title: newTitle,
      content: newContent,
      status: 'draft',
      word_count: displayWordCount(newContent),
      updated_at: new Date().toISOString()
    });
    updatedChapters.sort((a, b) => Number(a.index) - Number(b.index));
    const updatedOutlineChapters = normalizedOutlineChapters(previous).map(chapter => {
      const index = Number(chapter.index);
      return index >= insertIndex ? renumberChapterRecord(chapter, index + 1) : renumberChapterRecord(chapter, index);
    });
    updatedOutlineChapters.push({
      index: insertIndex,
      title: newTitle,
      summary: newPlan,
      scene_goal: newPlan,
      obstacle: '',
      choice: '',
      cost: '',
      hook: '',
      characters: [],
      key_events: []
    });
    updatedOutlineChapters.sort((a, b) => Number(a.index) - Number(b.index));
    const outline = { ...(previous.outline || {}), chapters: updatedOutlineChapters };
    const chapter_count = Math.max(maxChapterIndex({ ...previous, chapters: updatedChapters, outline }), updatedChapters.length, updatedOutlineChapters.length);
    const optimistic = { ...previous, chapters: updatedChapters, outline, chapter_count };
    state.current = optimistic;
    state.currentChapter = insertIndex;
    state.panel = 'outline';
    renderWork();
    focusOutlineChapter(insertIndex);
    showToast(`已先拆出第 ${insertIndex} 章，正在保存并让 AI 补齐任务书。`);
    try {
      const data = await api('/api/novel/' + encodeURIComponent(previous.id), {
        method: 'PUT',
        body: JSON.stringify({ chapters: updatedChapters, outline, chapter_count })
      });
      state.current = data.novel || optimistic;
      state.currentChapter = insertIndex;
      state.panel = 'outline';
      renderWork();
      focusOutlineChapter(insertIndex);
      await autoFillSplitChapter(insertIndex);
    } catch (error) {
      state.current = previous;
      state.currentChapter = currentIndex;
      state.panel = 'write';
      renderWork();
      throw error;
    }
  }

  async function deleteChapter(index) {
    if (!state.current) return;
    const chapterIndex = Number(index || state.currentChapter || 0);
    if (!Number.isFinite(chapterIndex) || chapterIndex < 1) throw new Error('请选择要删除的章节');
    const chapter = chapters().find(item => Number(item.index) === chapterIndex);
    if (!chapter) throw new Error('章节不存在');
    if (isChapterDeleteLocked(chapter)) throw new Error('章节正在提交，不能删除');
    const ok = await confirmAction({
      title: '删除章节',
      message: `确定删除第 ${chapterIndex} 章吗？`,
      detail: '删除后，后续章节会自动顺延上来，剧情大纲、章节任务和人物关系等关联数据也会同步调整。已提交章节也允许删除，请确认这次操作。',
      confirmText: '确定删除',
      cancelText: '取消',
      danger: true
    });
    if (!ok) return;
    const previous = state.current;
    const data = await api(`/api/novel/${encodeURIComponent(previous.id)}/chapters/${encodeURIComponent(chapterIndex)}`, {
      method: 'DELETE'
    });
    state.current = data.novel || previous;
    const nextList = chapters(state.current);
    const fallback = nextList.find(item => Number(item.index) >= chapterIndex) || nextList[nextList.length - 1] || { index: 1 };
    state.currentChapter = Number(fallback.index) || 1;
    updateRouteState();
    renderWork();
    focusChapterListItem(state.currentChapter);
    showToast(`第 ${chapterIndex} 章已删除，后续章节已自动顺延。`);
  }

  function clearChapterDragState() {
    document.querySelectorAll('.nv-chapter-card.is-dragging,.nv-chapter-card.is-drag-over').forEach(card => {
      card.classList.remove('is-dragging', 'is-drag-over');
    });
    document.querySelectorAll('.nv-chapter-scroll.is-reordering').forEach(list => {
      list.classList.remove('is-reordering');
    });
    state.draggingChapter = null;
  }

  async function reorderChapter(fromIndex, toIndex) {
    if (!state.current?.id) return;
    const from = Number(fromIndex);
    const to = Number(toIndex);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1) throw new Error('章节移动位置无效');
    if (from === to) return;
    if (state.submittingChapters.size) throw new Error('章节正在提交，请等待提交完成后再调整顺序');
    clearTimeout(state.autoSaveTimer);
    syncCurrentChapterDraftFromDom();
    const reorderDraft = currentChapterReorderDraftFromDom();
    const movingSnapshot = chapterReorderSnapshot(from);
    await autoSaveCurrentChapter({ reason: 'chapter-reorder' });
    const data = await api(`/api/novel/${encodeURIComponent(state.current.id)}/chapters/reorder`, {
      method: 'POST',
      body: JSON.stringify({
        from_index: from,
        to_index: to,
        current_chapter_draft: reorderDraft,
        moving_chapter_snapshot: movingSnapshot
      })
    });
    state.current = data.novel || state.current;
    state.currentChapter = to;
    assertMovedChapterSnapshot(movingSnapshot, to);
    updateRouteState();
    renderWork();
    focusChapterListItem(state.currentChapter);
    showCenterNotice(`第 ${from} 章已移动到第 ${to} 章，剧情大纲已同步调整。`);
  }

  async function checkChapterContent(type, button) {
    if (!state.current?.id) return;
    const chapterIndex = Number(state.currentChapter || 1);
    const content = document.getElementById('nvChapterContent')?.value || '';
    if (!text(content)) throw new Error('章节正文为空，不能检测');
    const isSensitive = type === 'sensitive';
    if (isSensitive) {
      await showInfoModal({
        title: '敏感词检测范围',
        message: '检测前请先确认本次会检查哪些内容。',
        contentHtml: checkIntroHtml('sensitive'),
        confirmText: '开始检测'
      });
    }
    setBusy(button, true, isSensitive ? '检测中...' : '检测中...');
    try {
      syncCurrentChapterDraftFromDom();
      const data = await api(`/api/novel/${encodeURIComponent(state.current.id)}/chapters/${encodeURIComponent(chapterIndex)}/${isSensitive ? 'check-sensitive' : 'check-typos'}`, {
        method: 'POST',
        body: JSON.stringify({ content })
      });
      state.chapterCheck = {
        type: isSensitive ? 'sensitive' : 'typo',
        chapter_index: chapterIndex,
        matches: arr(data.matches),
        count: Number(data.count || 0)
      };
      renderWork();
      const count = state.chapterCheck.count;
      await showInfoModal({
        title: isSensitive ? '敏感词检测结果' : '错别字检测结果',
        message: count ? `发现 ${count} 处命中，已在预览中标红。` : '未发现命中。',
        contentHtml: checkResultModalHtml(content, state.chapterCheck),
        confirmText: '知道了'
      });
      showToast(isSensitive
        ? (count ? `发现 ${count} 处敏感词，已在下方标红。` : '敏感词检测通过，未发现命中。')
        : (count ? `发现 ${count} 处疑似错别字，已在下方标红。` : '错别字检测通过，未发现命中。'));
    } finally {
      setBusy(button, false);
    }
  }

  async function deleteNovelTask(id) {
    const novel = state.novels.find(item => item.id === id);
    const title = novel?.title || '未命名小说';
    const ok = await confirmAction({
      title: '删除任务',
      message: `确定删除《${title}》这个任务吗？`,
      detail: '这里只会把任务从列表移出，保留小说数据，不会物理删除正文内容。',
      confirmText: '确定删除',
      cancelText: '取消',
      danger: true
    });
    if (!ok) return;
    const previousNovels = state.novels.slice();
    state.novels = state.novels.filter(item => item.id !== id);
    if (state.current?.id === id) {
      state.current = null;
      state.panel = 'world';
      state.currentChapter = 1;
    }
    renderTasks();
    try {
      await api('/api/novel/' + encodeURIComponent(id), { method: 'DELETE' });
      await loadNovels();
      renderTasks();
      showToast('小说任务已移出列表，数据已保留。');
    } catch (error) {
      if (error.status === 404) {
        showToast('服务器上已没有该任务，已从列表移除。');
        return;
      }
      state.novels = previousNovels;
      renderTasks();
      throw error;
    }
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
        <div class="nv-task-row status"><span class="nv-task-label">任务状态</span>${statusFilters.map(f => `<button class="nv-filter child ${state.taskStatus === f.key ? 'is-active' : ''}" type="button" data-task-status="${f.key}">${esc(f.label)}</button>`).join('')}<button class="nv-filter child" type="button" data-refresh-tasks ${state.taskLoading ? 'disabled' : ''}>${state.taskLoading ? '加载中' : '刷新'}</button></div>
      </div>
      <table class="nv-task-table">
        <thead><tr><th>小说</th><th>类型</th><th>当前阶段</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead>
        <tbody>${state.taskLoading ? '<tr><td colspan="6">正在加载小说任务...</td></tr>' : state.taskError ? `<tr><td colspan="6"><div class="nv-task-error"><b>任务列表加载失败</b><span>${esc(state.taskError)}</span><button class="nv-btn nv-btn-muted" type="button" data-refresh-tasks>重新加载</button></div></td></tr>` : filtered.length ? filtered.map(novel => {
          const life = lifecycle(novel);
          return `<tr>
            <td>${esc(novel.title || '未命名小说')}</td>
            <td>${esc(lengthOf(novel).label)}</td>
            <td>${esc(chapterPhase(novel))}</td>
            <td><span class="nv-pill ${life.cls}">${esc(life.label)}</span></td>
            <td>${esc((novel.updated_at || '').replace('T', ' ').slice(0, 16) || '-')}</td>
            <td><div class="nv-task-actions">
              <button class="nv-btn nv-btn-muted" type="button" data-open-novel="${esc(novel.id)}">进入</button>
              <button class="nv-btn nv-btn-danger" type="button" data-delete-novel="${esc(novel.id)}">删除任务</button>
            </div></td>
          </tr>`;
        }).join('') : `<tr><td colspan="6">${state.novels.length ? '当前筛选下没有匹配的小说任务。' : '暂无真实小说任务。创建小说后显示。'}</td></tr>`}</tbody>
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
        updateCreateModeUI();
      });
    });
    document.getElementById('nvImportToggleBtn').addEventListener('click', () => {
      setCreateError('');
      document.querySelector('[data-create-mode="import"]').click();
    });
    document.getElementById('nvOpenCreateModalBtn').addEventListener('click', () => {
      setCreateError('');
      if (state.createMode === 'import') return run(() => createProject(document.getElementById('nvOpenCreateModalBtn')));
      renderCreateChoices();
      document.getElementById('nvCreateModal').classList.add('is-open');
    });
    document.getElementById('nvCloseCreateModalBtn').addEventListener('click', () => {
      document.getElementById('nvCreateModal').classList.remove('is-open');
    });
    document.getElementById('nvImportFileInput').addEventListener('change', e => run(() => handleImportFile(e.currentTarget.files?.[0])));
    document.getElementById('nvCreateProjectBtn').addEventListener('click', e => run(() => createProject(e.currentTarget)));
    document.getElementById('nvIdeaInput').addEventListener('input', () => setCreateError(''));
    document.getElementById('nvImportInput').addEventListener('input', () => {
      setCreateError('');
      state.createMode = 'import';
      updateCreateModeUI();
      const value = text(document.getElementById('nvImportInput').value);
      if (value) setImportStatus('已粘贴导入内容', `当前已有 ${value.length} 个字符。下一步点击“解析上传内容”。`, 'ready', '清空内容');
    });

    document.body.addEventListener('dragstart', e => {
      const card = e.target.closest('[data-reorder-chapter]');
      if (!card || e.target.closest('[data-delete-chapter]')) return;
      state.draggingChapter = Number(card.dataset.reorderChapter);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(state.draggingChapter));
      card.closest('.nv-chapter-scroll')?.classList.add('is-reordering');
      card.classList.add('is-dragging');
    });
    document.body.addEventListener('dragover', e => {
      const card = e.target.closest('[data-reorder-chapter]');
      if (!card || !state.draggingChapter) return;
      const targetIndex = Number(card.dataset.reorderChapter);
      if (!targetIndex || targetIndex === Number(state.draggingChapter)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.nv-chapter-card.is-drag-over').forEach(item => {
        if (item !== card) item.classList.remove('is-drag-over');
      });
      card.classList.add('is-drag-over');
    });
    document.body.addEventListener('dragleave', e => {
      const card = e.target.closest('[data-reorder-chapter]');
      if (card && !card.contains(e.relatedTarget)) card.classList.remove('is-drag-over');
    });
    document.body.addEventListener('drop', e => {
      const card = e.target.closest('[data-reorder-chapter]');
      if (!card) return clearChapterDragState();
      const from = state.draggingChapter || Number(e.dataTransfer.getData('text/plain'));
      const to = Number(card.dataset.reorderChapter);
      e.preventDefault();
      clearChapterDragState();
      return run(() => reorderChapter(from, to));
    });
    document.body.addEventListener('dragend', clearChapterDragState);

    document.body.addEventListener('click', e => {
      if (e.target.closest('[data-clear-import]')) {
        resetImportContent();
        return;
      }
      const open = e.target.closest('[data-open-novel]');
      if (open) return run(() => loadNovel(open.dataset.openNovel));
      const deleteNovel = e.target.closest('[data-delete-novel]');
      if (deleteNovel) return run(() => deleteNovelTask(deleteNovel.dataset.deleteNovel));
      if (e.target.closest('[data-refresh-tasks]')) return run(refreshTasks);
      const panel = e.target.closest('[data-panel]');
      if (panel) {
        state.panel = panel.dataset.panel;
        updateRouteState();
        renderWork();
        return;
      }
      const go = e.target.closest('[data-panel-go]');
      if (go) {
        state.panel = go.dataset.panelGo;
        updateRouteState();
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
        return run(async () => {
          if (state.submittingChapters.size) throw new Error('章节正在提交，请等待提交完成后再切换');
          const nextChapter = Number(chapter.dataset.chapter);
          if (!nextChapter || Number(state.currentChapter) === nextChapter) return;
          await autoSaveCurrentChapter({ reason: 'chapter-switch' });
          state.currentChapter = nextChapter;
          updateRouteState();
          renderWork();
        });
      }
      const adaptLength = e.target.closest('[data-adapt-length]');
      if (adaptLength) return run(() => adaptNovelLength(adaptLength.dataset.adaptLength, adaptLength));
      if (e.target.closest('[data-save-world]')) return run(saveWorld);
      if (e.target.closest('[data-expand-characters]')) return run(() => generateOutline(e.target.closest('button'), { nextPanel: 'graph' }));
      if (e.target.closest('[data-generate-outline]')) return run(() => generateOutline(e.target.closest('button')));
      if (e.target.closest('[data-save-outline]')) return run(saveOutline);
      const fillChapter = e.target.closest('[data-fill-outline-chapter]');
      if (fillChapter) return run(() => fillOutlineGaps(fillChapter, fillChapter.dataset.fillOutlineChapter));
      if (e.target.closest('[data-fill-outline-gaps]')) return run(() => fillOutlineGaps(e.target.closest('button')));
      const splitOutline = e.target.closest('[data-split-outline-chapter]');
      if (splitOutline) return run(() => splitOutlineChapter(splitOutline.dataset.splitOutlineChapter));
      if (e.target.closest('[data-next-graph]')) {
        state.panel = 'graph';
        renderWork();
        return;
      }
      if (e.target.closest('[data-generate-chapter]')) return run(() => generateChapter(e.target.closest('button')));
      const refine = e.target.closest('[data-refine]');
      if (refine) return run(() => refineChapter(refine.dataset.refine, refine));
      if (e.target.closest('[data-split-chapter]')) return run(splitCurrentChapter);
      if (e.target.closest('[data-check-typos]')) return run(() => checkChapterContent('typo', e.target.closest('button')));
      if (e.target.closest('[data-check-sensitive]')) return run(() => checkChapterContent('sensitive', e.target.closest('button')));
      if (e.target.closest('[data-submit-chapter]')) return run(() => submitChapter(e.target.closest('button')));
      if (e.target.closest('[data-complete-novel]')) return run(() => completeNovel(e.target.closest('button')));
      const deleteChapterButton = e.target.closest('[data-delete-chapter]');
      if (deleteChapterButton) return run(() => deleteChapter(deleteChapterButton.dataset.deleteChapter));
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
    document.addEventListener('input', e => {
      if (!e.target.closest('#nvChapterContent,#nvChapterTitle,#nvChapterPlanInput,#nvChapterObstacleInput,#nvChapterChoiceInput,#nvChapterCostInput,#nvChapterHookInput')) return;
      if (e.target.closest('#nvChapterContent,#nvChapterTitle')) {
        state.chapterCheck = null;
        document.querySelector('.nv-chapter-check-result')?.remove();
        syncCurrentChapterDraftFromDom();
      }
      scheduleChapterAutoSave();
    });
    window.addEventListener('beforeunload', () => {
      if (!hasActiveChapterEditor()) return;
      clearTimeout(state.autoSaveTimer);
      const payload = currentChapterPayload();
      const body = JSON.stringify({
        chapters: payload,
        status: state.current.status === 'completed' ? 'completed' : 'draft',
        allow_shorter_chapter_content: true
      });
      const url = '/api/novel/' + encodeURIComponent(state.current.id);
      try {
        fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
          body,
          keepalive: true
        });
      } catch {}
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
      const clickedName = state.graphDrag.name;
      state.graphDrag = null;
      if (moved) renderWork();
      else if (clickedName) {
        state.selectedRelationName = clickedName;
        renderWork();
      }
    };
    document.body.addEventListener('pointerup', finishGraphDrag);
    document.body.addEventListener('pointercancel', finishGraphDrag);
    window.addEventListener('resize', syncChapterListHeightToContent);
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
    updateCreateModeUI();
    const route = getRouteState();
    if (route.novel) {
      await loadNovel(route.novel, {
        chapter: route.chapter,
        panel: route.panel || 'write'
      });
      run(loadNovels);
    } else if (route.view === 'tasks') {
      switchView('tasks', { keepRoute: true });
    } else if (route.view === 'create') {
      await loadNovels();
      switchView('create', { keepRoute: true });
    } else {
      await loadNovels();
    }
    updateShell();
  }

  init().catch(error => {
    console.error(error);
    showToast(error.message || 'AI 小说初始化失败', true);
  });
})();
