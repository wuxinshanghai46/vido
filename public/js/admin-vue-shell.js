(() => {
  if (!window.Vue) return;
  const { createApp } = window.Vue;

  const navItems = [
    { tab: 'dashboard', label: '仪表盘', icon: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>' },
    { tab: 'users', label: '用户管理', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
    { tab: 'roles', label: '角色管理', icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    { tab: 'credits', label: '积分记录', icon: '<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/>' },
    { tab: 'contents', label: '内容管理', icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
    { tab: 'ai', label: 'AI 配置', icon: '<path d="M12 2a4 4 0 0 1 4 4v1h1a3 3 0 0 1 3 3v1a3 3 0 0 1-2 2.83V18a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4v-4.17A3 3 0 0 1 4 11v-1a3 3 0 0 1 3-3h1V6a4 4 0 0 1 4-4z"/><circle cx="10" cy="13" r="1"/><circle cx="14" cy="13" r="1"/>' },
    { tab: 'aicap', label: 'AI 能力', icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>' },
    { tab: 'workflows', label: 'AI 工作流', icon: '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M9 6h6M6 9v6M18 9v6M9 18h6"/>' },
    { tab: 'knowledgebase', label: '知识库', icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h8"/>' },
    { tab: 'aiteam', label: 'AI 团队', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>' },
    { tab: 'monitor', label: '模型监控', icon: '<path d="M3 3v18h18"/><path d="M7 12l4-4 4 4 6-6"/>' },
    { tab: 'sync', label: '数据同步', icon: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>' },
    { tab: 'apiaccounts', label: '接口账号', icon: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>' },
    { tab: 'datasource', label: '数据源管理', icon: '<path d="M5 12V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8M5 12h14M5 12v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8M9 7h6M9 17h6"/>' },
    { tab: 'modelpipeline', label: '模型调用管理', icon: '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M9 6h6M9 18h6M6 9v6M18 9v6"/>' },
    { tab: 'system', label: '系统设置', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' }
  ];

  const loaders = {
    credits: () => window.loadCreditsLog?.(),
    contents: () => window.loadContents?.(),
    system: () => window.loadStats?.(),
    ai: () => window.loadProviders?.(),
    aicap: () => window.loadAICapData?.(),
    sync: () => window.loadSyncConfig?.(),
    knowledgebase: () => window.kbInit?.(),
    aiteam: () => window.aiteamInit?.(),
    monitor: () => window.monitorRefresh?.(),
    dashboard: () => window.loadDashboard?.(),
    datasource: () => window.loadDatasources?.(),
    modelpipeline: () => window.loadModelPipeline?.()
  };

  const prefetchUrls = {
    users: ['/api/admin/users', '/api/admin/roles'],
    roles: ['/api/admin/roles', '/api/admin/permissions-matrix'],
    credits: ['/api/admin/users'],
    contents: ['/api/admin/contents/modules', '/api/admin/users'],
    ai: ['/api/settings'],
    aicap: ['/api/ai-cap/characters', '/api/ai-cap/scenes', '/api/ai-cap/styles'],
    knowledgebase: ['/api/admin/knowledgebase/collections', '/api/admin/knowledgebase/agent-types'],
    aiteam: ['/api/admin/knowledgebase/teams'],
    monitor: ['/api/admin/token-stats/server'],
    dashboard: ['/api/admin/dashboard'],
    apiaccounts: ['/api/admin/api-accounts'],
    datasource: ['/api/admin/datasources'],
    modelpipeline: ['/api/admin/pipeline-models'],
    system: ['/api/admin/stats']
  };

  let navApp = null;

  function tabExists(tab) {
    return navItems.some(item => item.tab === tab) && !!document.getElementById('panel-' + tab);
  }

  function getInitialTab() {
    try {
      const queryTab = new URLSearchParams(window.location.search || '').get('tab');
      if (queryTab && tabExists(queryTab)) return queryTab;
    } catch {}
    const hashTab = String(window.location.hash || '').replace(/^#/, '').trim();
    if (hashTab && tabExists(hashTab)) return hashTab;
    try {
      const savedTab = localStorage.getItem('vido_admin_active_tab');
      if (savedTab && tabExists(savedTab)) return savedTab;
    } catch {}
    return 'dashboard';
  }

  function rememberTab(tab) {
    try { localStorage.setItem('vido_admin_active_tab', tab); } catch {}
    try {
      const url = new URL(window.location.href);
      if (tab === 'dashboard') url.searchParams.delete('tab');
      else url.searchParams.set('tab', tab);
      url.hash = '';
      window.history.replaceState({}, '', url.pathname + url.search);
    } catch {}
  }

  function setActiveTab(tab, options = {}) {
    const next = tabExists(tab) ? tab : 'dashboard';
    document.querySelectorAll('.nav-item[data-tab]').forEach(item => item.classList.toggle('active', item.dataset.tab === next));
    document.querySelectorAll('.admin-panel').forEach(panel => panel.classList.toggle('active', panel.id === 'panel-' + next));
    if (navApp) navApp.activeTab = next;
    if (options.remember !== false) rememberTab(next);
    if (window.AdminVueApi && prefetchUrls[next]) {
      window.AdminVueApi.prefetch(prefetchUrls[next], { ttl: 10000 }).catch(() => {});
    }
    if (options.load !== false) loaders[next]?.();
  }

  function installVueNav() {
    const nav = document.querySelector('.sidebar-nav');
    if (nav && !document.getElementById('admin-vue-nav')) {
      nav.innerHTML = '<div id="admin-vue-nav"></div>';
    }
    const actions = document.querySelector('.sidebar-actions');
    if (actions && !document.getElementById('admin-vue-sidebar-actions')) {
      actions.innerHTML = '<div id="admin-vue-sidebar-actions"></div>';
    }
  }

  function mountVueNav() {
    const navMount = document.getElementById('admin-vue-nav');
    if (navMount && !navMount.__vue_app__) {
      const app = createApp({
        data() {
          return { items: navItems, activeTab: getInitialTab() };
        },
        methods: {
          setTab(tab) { setActiveTab(tab); }
        },
        mounted() {
          navApp = this;
          setActiveTab(this.activeTab, { load: false, remember: false });
        },
        template: `
          <div class="nav-label">管理</div>
          <button v-for="item in items" :key="item.tab" class="nav-item" :class="{active:activeTab===item.tab}" :data-tab="item.tab" @click="setTab(item.tab)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" v-html="item.icon"></svg>
            <span>{{ item.label }}</span>
          </button>`
      });
      app.mount(navMount);
      navMount.__vue_app__ = app;
    }

    const actionsMount = document.getElementById('admin-vue-sidebar-actions');
    if (actionsMount && !actionsMount.__vue_app__) {
      const app = createApp({
        methods: {
          backHome() { window.location.href = '/index.html'; },
          signOut() { if (typeof window.logout === 'function') window.logout(); }
        },
        template: `
          <button class="sidebar-btn" @click="backHome">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13.8 12H3"/></svg>
            <span>返回前台</span>
          </button>
          <button class="sidebar-btn danger" @click="signOut">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
            <span>退出</span>
          </button>`
      });
      app.mount(actionsMount);
      actionsMount.__vue_app__ = app;
    }
  }

  installVueNav();
  mountVueNav();

  window.adminVueShell = {
    isVueNav: true,
    items: navItems,
    setActiveTab,
    activateInitialTab() {
      setActiveTab(getInitialTab());
    }
  };
})();
