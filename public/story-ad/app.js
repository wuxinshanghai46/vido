import { createProjectStore } from './store/projectStore.js?v=20260812-ui-v217';
import { bindHoverVideoPreviews, escapeHtml, formatDate, generationProgressPanel, refreshElapsedLabels, setButtonBusy, statusView, toast } from './components/ui.js?v=20260812-ui-v217';
import { assertCurrentRelease, startReleaseHeartbeat } from './api.js?v=20260812-ui-v217';
import { confirmDialog } from './components/dialog.js?v=20260812-ui-v217';

await assertCurrentRelease();
startReleaseHeartbeat();

const app = document.querySelector('#storyAdApp');
const store = createProjectStore();
const VIEW_ORDER = ['brief', 'assets', 'scene', 'plot', 'storyboard', 'final', 'workflow'];
const VIEW_META = {
  brief: ['1', '目标与材料'],
  assets: ['2', '人物资产'],
  scene: ['3', '场景世界'],
  plot: ['4', '剧本'],
  storyboard: ['5', '分镜与线稿'],
  final: ['6', '镜头、声音与成片'],
  workflow: ['⌘', '工作流画布'],
};
const VIEW_MODULES = {
  brief: () => import('./views/briefView.js?v=20260812-ui-v217'),
  assets: () => import('./views/assetCenterView.js?v=20260812-ui-v217'),
  scene: () => import('./views/sceneWorldPage.js?v=20260812-ui-v217'),
  plot: () => import('./views/plotRoomView.js?v=20260812-ui-v217'),
  storyboard: () => import('./views/storyboardView.js?v=20260812-ui-v217'),
  final: () => import('./views/finalView.js?v=20260812-ui-v217'),
  workflow: () => import('./views/workflowView.js?v=20260812-ui-v217'),
};
let activeViewCleanup = null;
let centerFilter = '';
let observedGenerationCompletionSeq = 0;
setInterval(() => refreshElapsedLabels(document), 1000);

function platformTopbar({ project = null, saving = false, isNew = false } = {}) {
  return `<header class="platform-topbar ${project ? 'project-topbar' : ''}">
    <button class="platform-brand" type="button" data-workbench aria-label="返回 VIDO 工作台"><span>V</span><b>VIDO</b></button>
    ${project ? `<div class="project-context"><span>剧情广告</span><i>/</i><b title="${escapeHtml(project.title || '')}">${escapeHtml(project.title || (isNew ? '新建项目' : '正在读取项目'))}</b></div>` : '<div class="module-context"><b>剧情广告任务中心</b><span>真实项目、生成任务与交付版本</span></div>'}
    <div class="top-actions">
      ${project ? `<span class="save-state">${saving ? '保存中…' : (isNew ? '尚未创建任务' : '已连接真实任务')}</span><button class="btn" type="button" data-center>返回任务中心</button>` : ''}
      <button class="btn" type="button" data-workbench>返回工作台 ↗</button>
      <button class="icon-btn" type="button" data-theme-toggle aria-label="切换主题">☼</button>
      <span class="avatar" aria-label="当前账号">U</span>
    </div>
  </header>`;
}

function currentRoute() {
  const match = location.pathname.match(/^\/story-ad\/projects\/([^/]+)$/);
  const params = new URLSearchParams(location.search);
  const view = VIEW_ORDER.includes(params.get('view')) ? params.get('view') : 'brief';
  return {
    page: match ? 'project' : 'center',
    taskId: match ? decodeURIComponent(match[1]) : '',
    isNew: match?.[1] === 'new',
    view,
    params,
  };
}

function navigate(path, options = {}) {
  history[options.replace ? 'replaceState' : 'pushState']({}, '', path);
  renderRoute().catch(showFatal);
}

function applyTheme(theme, options = {}) {
  const platformTheme = window.vidoTheme?.normalize
    ? window.vidoTheme.normalize(theme)
    : (String(theme || '').startsWith('light') ? 'light-mist' : 'purple');
  const resolved = platformTheme.startsWith('light') ? 'light' : 'dark';
  document.documentElement.dataset.theme = resolved;
  if (options.persist) {
    if (window.vidoTheme?.set) window.vidoTheme.set(platformTheme);
    else localStorage.setItem('vido-theme', platformTheme);
  }
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.textContent = resolved === 'light' ? '☾' : '☼';
    button.title = resolved === 'light' ? '切换到暗色' : '切换到亮色';
  });
}

function statCards(stats = {}) {
  return [
    ['进行中的项目', stats.running || 0, '需要继续制作或正在生成'],
    ['等待处理', stats.waiting || 0, '存在阻塞或失败'],
    ['已完成', stats.completed || 0, '已经形成最终成片'],
    ['累计镜头', stats.shots || 0, '来自当前项目列表'],
  ].map(([label, value, hint]) => `
    <article class="stat-card">
      <span>${escapeHtml(label)}</span>
      <b>${Number(value) || 0}</b>
      <small>${escapeHtml(hint)}</small>
    </article>`).join('');
}

function renderCenter() {
  const { projects, stats, loading, error } = store.state;
  const visibleProjects = projects.filter(project => {
    if (!centerFilter) return true;
    const tone = statusView(project).tone;
    if (centerFilter === 'waiting') return tone === 'danger';
    if (centerFilter === 'completed') return tone === 'success';
    return tone === 'info' || tone === 'neutral';
  });
  app.innerHTML = `
    ${platformTopbar()}
    <main class="center-shell">
      <div class="center-layout">
        <aside class="center-filter">
          <button class="filter ${centerFilter === '' ? 'active' : ''}" type="button" data-status-filter="">全部项目 <b>${Number(stats.total) || 0}</b></button>
          <button class="filter ${centerFilter === 'active' ? 'active' : ''}" type="button" data-status-filter="active">进行中 <b>${Number(stats.running) || 0}</b></button>
          <button class="filter ${centerFilter === 'waiting' ? 'active' : ''}" type="button" data-status-filter="waiting">等待处理 <b>${Number(stats.waiting) || 0}</b></button>
          <button class="filter ${centerFilter === 'completed' ? 'active' : ''}" type="button" data-status-filter="completed">已完成 <b>${Number(stats.completed) || 0}</b></button>
        </aside>
        <section class="center-content">
          <div class="create-banner">
            <div><h1>从一个想法开始制作剧情广告</h1><p>视频、人物、商品、场景和脚本均为可选材料，可以进入项目后按需补充。</p></div>
            <button class="btn primary" type="button" data-new-project>开始创作</button>
          </div>
          <div class="stat-grid">${statCards(stats)}</div>
          <section class="project-table-card">
            <div class="table-toolbar">
              <div><h2>项目</h2><p>只显示当前账号真实任务，不使用演示数据。</p></div>
              <button class="btn" type="button" data-refresh-projects>刷新</button>
            </div>
            ${loading ? '<div class="table-loading">正在读取项目…</div>' : ''}
            ${error ? `<div class="inline-error">${escapeHtml(error)}</div>` : ''}
            <div class="project-table" role="table">
              <div class="project-row project-head" role="row"><span>任务编号</span><span>项目内容</span><span>当前阶段</span><span>镜头</span><span>最近更新</span><span>操作</span></div>
              ${visibleProjects.map(project => {
                const status = statusView(project);
                return `<div class="project-row" role="row" data-project-id="${escapeHtml(project.id)}">
                  <code>${escapeHtml(project.display_id)}</code>
                  <span class="project-copy"><b>${escapeHtml(project.title)}</b><small>${escapeHtml(project.brief || '尚未填写完整目标')}</small></span>
                  <span class="status-tag is-${status.tone}">${escapeHtml(status.label)}</span>
                  <span>${Number(project.shot_count) || 0}</span>
                  <time>${escapeHtml(formatDate(project.updated_at))}</time>
                  <span class="project-actions"><button class="btn small" type="button" data-open-project="${escapeHtml(project.id)}">打开</button><button class="btn small danger" type="button" data-delete-project="${escapeHtml(project.id)}" data-project-title="${escapeHtml(project.title)}">删除</button></span>
                </div>`;
              }).join('')}
              ${!loading && !visibleProjects.length ? `<div class="table-empty"><b>${projects.length ? '当前分类没有项目' : '还没有剧情广告项目'}</b><span>${projects.length ? '切换左侧分类查看其他项目。' : '点击“开始创作”建立第一个项目。'}</span></div>` : ''}
            </div>
          </section>
        </section>
      </div>
    </main>`;
  applyTheme(localStorage.getItem('vido-theme') || 'purple');
}

function projectNavigation(bundle, active) {
  const counts = bundle?.navigation?.counts || {};
  const steps = bundle?.navigation?.steps || {};
  const countFor = view => ({
    assets: counts.assets,
    storyboard: counts.shots,
    shot: counts.keyframes,
    final: counts.clips,
  }[view]);
  return VIEW_ORDER.map(view => {
    const [number, label] = VIEW_META[view];
    const count = countFor(view);
    const state = steps[view] || { enabled: true, completed: false, blocker: '' };
    return `<button class="workspace-nav ${view === active ? 'active' : ''} ${view === 'workflow' ? 'workflow' : ''} ${state.completed ? 'is-complete' : ''} ${state.enabled === false ? 'is-locked' : ''}" type="button" data-view="${view}" aria-disabled="${state.enabled === false ? 'true' : 'false'}" title="${escapeHtml(state.blocker || '')}" ${view === active ? 'aria-current="page"' : ''}>
      <span class="nav-number">${state.completed ? '✓' : number}</span><span>${escapeHtml(label)}</span>${Number.isFinite(Number(count)) ? `<small>${Number(count) || 0}</small>` : ''}
    </button>`;
  }).join('');
}

function renderProjectShell(route) {
  const bundle = store.state.bundle;
  const project = bundle?.project || {};
  const counts = bundle?.navigation?.counts || {};
  app.innerHTML = `
    <div class="project-shell">
      ${platformTopbar({ project, saving: store.state.saving, isNew: route.isNew })}
      <aside class="workspace-sidebar">
        <div class="side-label">剧情广告制作</div>
        <nav>${projectNavigation(bundle, route.view)}</nav>
        ${!route.isNew ? `<div class="side-divider"></div>
          <div class="side-label">当前项目</div>
          <div class="side-metric"><b>${Number(counts.assets) || 0}</b><span>已生成 / 已上传资产</span></div>
          <div class="side-metric"><b>${Number(counts.shots) || 0}</b><span>镜头</span></div>` : ''}
      </aside>
      <main class="workspace-main">
        <div id="projectProgressHost" class="project-progress-host">${generationProgressPanel(bundle || {}, route.view)}</div>
        <div id="viewHost" class="view-host"><div class="view-loading">正在加载工作区…</div></div>
      </main>
    </div>`;
  applyTheme(localStorage.getItem('vido-theme') || 'purple');
}

function syncControlSemantics(scope = document) {
  scope.querySelectorAll('.tab').forEach(item => {
    item.setAttribute('role', 'tab');
    item.setAttribute('aria-selected', String(item.classList.contains('active')));
  });
  scope.querySelectorAll('.choice, .filter, .shot-rail-item').forEach(item => {
    item.setAttribute('aria-pressed', String(item.classList.contains('active')));
  });
}

async function mountView(route) {
  activeViewCleanup?.();
  activeViewCleanup = null;
  const host = document.querySelector('#viewHost');
  if (!host) return;
  try {
    const module = await VIEW_MODULES[route.view]();
    const result = await module.mount(host, {
      route,
      bundle: store.state.bundle,
      store,
      navigate,
      toast,
      refreshShell: async () => {
        if (!route.isNew) await store.loadBundle(route.taskId, 'all');
        await renderRoute();
      },
      refreshCurrentView: async () => mountView(currentRoute()),
    });
    if (typeof result === 'function') activeViewCleanup = result;
    syncControlSemantics(host);
    const disposeHoverPreviews = bindHoverVideoPreviews(host);
    const previousCleanup = activeViewCleanup;
    activeViewCleanup = () => { disposeHoverPreviews(); previousCleanup?.(); };
  } catch (error) {
    host.innerHTML = `<div class="view-error"><b>工作区没有加载完成</b><span>${escapeHtml(error.message)}</span><button class="btn" type="button" data-retry-view>重试</button></div>`;
  }
}

async function renderRoute() {
  const route = currentRoute();
  activeViewCleanup?.();
  activeViewCleanup = null;
  store.stopProgressPolling();
  if (route.page === 'center') {
    renderCenter();
    try {
      await store.loadProjects();
      renderCenter();
    } catch {}
    return;
  }
  if (route.isNew && store.state.bundle) store.clearProject();
  if (!route.isNew && store.state.bundle?.project?.id !== route.taskId) {
    app.innerHTML = '<div class="app-loading"><div class="loading-mark">剧</div><div><b>正在读取项目</b><span>只加载当前项目的统一数据包…</span></div></div>';
    await store.loadBundle(route.taskId, 'all');
  }
  const routeStep = store.state.bundle?.navigation?.steps?.[route.view];
  if (!route.isNew && routeStep?.enabled === false) {
    const fallback = [...VIEW_ORDER].reverse().find(view => view !== 'workflow'
      && store.state.bundle?.navigation?.steps?.[view]?.enabled !== false
      && VIEW_ORDER.indexOf(view) < VIEW_ORDER.indexOf(route.view)) || 'brief';
    toast(routeStep.blocker || '请先完成上一个制作环节。', 'warning');
    navigate(`/story-ad/projects/${encodeURIComponent(route.taskId)}?view=${encodeURIComponent(fallback)}`, { replace: true });
    return;
  }
  renderProjectShell(route);
  await mountView(route);
  store.syncProgressPolling();
}

function showFatal(error) {
  app.innerHTML = `<div class="fatal-error"><b>页面没有打开</b><span>${escapeHtml(error.message || error)}</span><button class="btn" type="button" data-center>返回任务中心</button></div>`;
}

document.addEventListener('click', event => {
  const target = event.target.closest('button,a');
  if (!target) return;
  if (target.matches('[data-theme-toggle]')) {
    const isLight = String(document.documentElement.dataset.theme || '').startsWith('light');
    applyTheme(isLight ? 'purple' : 'light-mist', { persist: true });
    return;
  }
  if (target.matches('[data-workbench]')) {
    location.href = '/dashboard';
    return;
  }
  if (target.matches('[data-center], .wordmark')) {
    navigate('/story-ad/');
    return;
  }
  if (target.matches('[data-new-project]')) {
    navigate('/story-ad/projects/new?view=brief');
    return;
  }
  if (target.dataset.openProject) {
    navigate(`/story-ad/projects/${encodeURIComponent(target.dataset.openProject)}?view=brief`);
    return;
  }
  if (target.dataset.deleteProject) {
    const taskId = target.dataset.deleteProject;
    const title = target.dataset.projectTitle || taskId;
    (async () => {
      const confirmed = await confirmDialog(`将彻底删除“${title}”及其任务记录和未被其他项目引用的本地生成文件。此操作无法恢复。`, {
        title: '彻底删除项目', confirmText: '确认彻底删除', cancelText: '取消', danger: true,
      });
      if (!confirmed) return;
      setButtonBusy(target, true, '删除中…');
      try {
        const result = await store.deleteProject(taskId);
        renderCenter();
        const files = Number(result.cleanup?.deleted_files || 0);
        toast(`项目已彻底删除${files ? `，同时清理 ${files} 个专属文件` : ''}。`, 'success');
      } catch (error) { setButtonBusy(target, false); toast(error.message, 'danger'); }
    })();
    return;
  }
  if (target.dataset.view) {
    const route = currentRoute();
    if (route.isNew && target.dataset.view !== 'brief') {
      toast('先填写目标并创建项目，再进入其他工作区。', 'warning');
      return;
    }
    const step = store.state.bundle?.navigation?.steps?.[target.dataset.view];
    if (step?.enabled === false) {
      toast(step.blocker || '请先完成上一个制作环节。', 'warning');
      return;
    }
    navigate(`/story-ad/projects/${encodeURIComponent(route.taskId)}?view=${encodeURIComponent(target.dataset.view)}`);
    return;
  }
  if (target.matches('[data-refresh-projects]')) {
    store.loadProjects().then(renderCenter).catch(error => toast(error.message, 'danger'));
    return;
  }
  if (target.matches('[data-cancel-generation]')) {
    const generationId = target.dataset.generationId || '';
    setButtonBusy(target, true, '正在停止…');
    store.cancelGeneration(generationId)
      .then(() => toast('已提交停止请求，当前已完成内容会保留。', 'success'))
      .catch(error => {
        setButtonBusy(target, false);
        toast(error.message, 'danger');
      });
    return;
  }
  if (target.matches('[data-status-filter]')) {
    centerFilter = target.dataset.statusFilter || '';
    renderCenter();
    return;
  }
  if (target.matches('[data-retry-view]')) mountView(currentRoute());
});

window.addEventListener('popstate', () => renderRoute().catch(showFatal));
window.addEventListener('beforeunload', () => {
  store.stopProgressPolling();
  store.stopReferencePolling();
});
store.subscribe(state => {
  const host = document.querySelector('#projectProgressHost');
  if (host) host.innerHTML = generationProgressPanel(state.bundle || {}, currentRoute().view);
  if (state.generationCompletionSeq > observedGenerationCompletionSeq && currentRoute().page === 'project') {
    window.setTimeout(() => mountView(currentRoute()).catch(showFatal), 0);
  }
  observedGenerationCompletionSeq = state.generationCompletionSeq;
});
applyTheme(localStorage.getItem('vido-theme') || 'purple');
window.setTimeout(() => applyTheme(localStorage.getItem('vido-theme') || 'purple'), 250);
renderRoute().catch(showFatal);
