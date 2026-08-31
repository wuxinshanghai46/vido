(() => {
  if (!window.Vue || !window.AdminVueApi) return;

  const { createApp } = window.Vue;
  const api = window.AdminVueApi;

  const fmtDate = value => value ? new Date(value).toLocaleString('zh-CN') : '-';
  const fmtNum = value => Number(value || 0).toLocaleString('zh-CN');
  const fmtUsd = value => '$' + Number(value || 0).toFixed(4);
  const fmtCny = (value, rate = 7.2, digits = 2) => '¥' + (Number(value || 0) * rate).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
  const get = (obj, path, fallback = '-') => path.split('.').reduce((cur, key) => cur?.[key], obj) ?? fallback;
  const tokenized = url => {
    if (!url) return '';
    if (typeof authUrl === 'function') return authUrl(url);
    const token = typeof getToken === 'function' ? getToken() : '';
    if (!token) return url;
    return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
  };

  const TYPE_LABELS = {
    project: 'AI 视频项目',
    drama: 'AI 漫剧',
    i2v: '图生视频',
    novel: 'AI 小说',
    comic: 'AI 漫画',
    avatar: '数字人',
    portrait: '角色形象'
  };

  let contentsVm = null;
  let monitorVm = null;

  function mountContents() {
    const el = document.getElementById('admin-contents-vue');
    if (!el || contentsVm) return;

    contentsVm = createApp({
      data() {
        return {
          loading: false,
          users: [],
          modules: [],
          activeModule: 'all',
          userId: '',
          viewMode: 'grid',
          items: [],
          total: 0,
          error: '',
          detailLoading: false,
          detail: null
        };
      },
      computed: {
        currentModuleName() {
          return this.modules.find(m => m.id === this.activeModule)?.name || '全部内容';
        }
      },
      methods: {
        async refresh(force = false) {
          this.loading = true;
          this.error = '';
          try {
            const [users, modules] = await Promise.all([
              api.get('/api/admin/users', { cache: !force, ttl: 15000 }),
              api.get('/api/admin/contents/modules', { cache: !force, ttl: 15000 })
            ]);
            this.users = Array.isArray(users) ? users : (users.users || users.items || []);
            this.modules = Array.isArray(modules) ? modules : [];
            await this.loadItems(force);
          } catch (error) {
            this.error = error.message || '加载失败';
          } finally {
            this.loading = false;
          }
        },
        async loadItems(force = false) {
          const params = new URLSearchParams();
          if (this.activeModule !== 'all') params.set('type', this.activeModule);
          if (this.userId) params.set('user_id', this.userId);
          params.set('limit', '200');
          const data = await api.get('/api/admin/contents?' + params.toString(), { cache: !force, ttl: 8000 });
          this.items = data.items || [];
          this.total = data.total ?? this.items.length;
        },
        switchModule(id) {
          this.activeModule = id || 'all';
          this.loadItems(true).catch(error => {
            this.error = error.message || '加载失败';
          });
        },
        async openDetail(type, id) {
          this.detailLoading = true;
          this.detail = { type, id, title: '加载中...' };
          try {
            this.detail = await api.get(`/api/admin/contents/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
              cache: false
            });
          } catch (error) {
            this.detail = { type, id, title: '读取失败', error: error.message || '读取失败' };
          } finally {
            this.detailLoading = false;
          }
        },
        closeDetail() {
          this.detail = null;
        },
        async removeItem(type, id) {
          if (!confirm('确认删除这条内容？删除后不可恢复。')) return;
          try {
            await api.delete(`/api/admin/contents/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
            if (typeof toast === 'function') toast('已删除', 'success');
            await this.refresh(true);
          } catch (error) {
            if (typeof toast === 'function') toast(error.message || '删除失败', 'error');
            else alert(error.message || '删除失败');
          }
        },
        thumb(item) {
          const direct = item.thumbnail || item.thumbnail_url || item.cover_url || item.image_url || item.poster || item.video_cover || item.preview_url || item.previewUrl || '';
          if (direct) return tokenized(direct);
          if (item.type && item.id && item.type !== 'novel') return tokenized(`/api/admin/thumbnail/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}`);
          return '';
        },
        onThumbError(event) {
          const img = event?.target;
          if (!img) return;
          img.style.display = 'none';
          const fallback = img.parentElement?.querySelector('.ct-card-noimg');
          if (fallback) fallback.style.display = 'flex';
        },
        typeLabel(type) {
          return TYPE_LABELS[type] || type || '-';
        },
        hasMedia(item) {
          return item.has_video || item.has_content || item.video_url || item.stream_url;
        },
        detailRows(item) {
          if (!item) return [];
          return [
            ['类型', this.typeLabel(item.type)],
            ['用户', item.username || item.user_id || '-'],
            ['状态', item.status || '-'],
            ['创建时间', fmtDate(item.created_at)],
            ['更新时间', fmtDate(item.updated_at)],
            ['详情', item.detail || item.description || '-']
          ];
        },
        importantBlocks(item) {
          if (!item || item.error) return [];
          const blocks = [];
          const push = (title, value) => {
            if (value === undefined || value === null || value === '') return;
            blocks.push({ title, value });
          };
          push('提示词 / 简介', item.prompt || item.synopsis || item.description);
          push('故事大纲', item.outline || item.story_outline);
          push('章节', Array.isArray(item.chapters) ? item.chapters.map(c => `${c.title || c.index || ''}\n${c.content || c.summary || ''}`).join('\n\n') : '');
          push('场景', Array.isArray(item.scenes) ? item.scenes.map(s => `S${s.index || ''} ${s.description || s.visual_prompt || ''}`).join('\n') : '');
          push('原始数据', JSON.stringify(item, null, 2));
          return blocks;
        },
        fmtDate
      },
      mounted() {
        this.refresh();
      },
      template: `
        <section class="vue-admin-page vue-content-page">
          <div class="panel-toolbar vue-native-toolbar">
            <span class="panel-title">内容管理</span>
            <div class="vue-native-actions">
              <select v-model="userId" @change="loadItems(true)">
                <option value="">全部用户</option>
                <option v-for="user in users" :key="user.id || user.username" :value="user.id">{{ user.username || user.name || user.id }}</option>
              </select>
              <select v-model="viewMode">
                <option value="grid">卡片视图</option>
                <option value="table">表格视图</option>
              </select>
              <button class="btn-sm" @click="refresh(true)" :disabled="loading">{{ loading ? '刷新中...' : '刷新' }}</button>
            </div>
          </div>

          <div class="content-modules vue-content-modules">
            <button
              v-for="module in modules"
              :key="module.id"
              class="content-module-tab"
              :class="{ active: activeModule === module.id }"
              @click="switchModule(module.id)"
            >
              <span class="ct-mod-emoji">{{ module.emoji || '' }}</span>
              <span class="ct-mod-name">{{ module.name }}</span>
              <span class="ct-mod-count">{{ module.count || 0 }}</span>
            </button>
          </div>

          <div v-if="error" class="kb-empty">加载失败：{{ error }}</div>
          <div class="contents-stats" v-else>
            <span class="ct-stat">{{ currentModuleName }} · 共 <b>{{ total }}</b> 条内容</span>
          </div>

          <div v-if="!loading && !items.length" class="kb-empty">暂无内容</div>

          <div v-if="viewMode === 'grid' && items.length" class="content-grid">
            <article v-for="item in items" :key="item.type + '-' + item.id" class="ct-card" @click="openDetail(item.type, item.id)">
              <div class="ct-card-thumb">
                <img v-if="thumb(item)" loading="lazy" :src="thumb(item)" @error="onThumbError" />
                <div class="ct-card-noimg" :style="{display: thumb(item) ? 'none' : 'flex'}">VIDO</div>
                <span v-if="hasMedia(item)" class="ct-card-badge">已生成</span>
                <span class="ct-card-type">{{ typeLabel(item.type) }}</span>
              </div>
              <div class="ct-card-body">
                <div class="ct-card-title" :title="item.title">{{ item.title || item.name || item.id }}</div>
                <div class="ct-card-meta">
                  <span>{{ item.username || '-' }}</span>
                  <span class="ct-card-status">{{ item.status || '-' }}</span>
                </div>
                <div class="ct-card-detail">{{ item.detail || item.description || '' }}</div>
                <div class="ct-card-time">{{ fmtDate(item.created_at) }}</div>
              </div>
              <div class="ct-card-actions">
                <button class="btn-sm" @click.stop="openDetail(item.type, item.id)">查看</button>
                <button class="btn-sm danger" @click.stop="removeItem(item.type, item.id)">删除</button>
              </div>
            </article>
          </div>

          <div v-if="viewMode === 'table' && items.length" class="vue-table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>类型</th><th>标题</th><th>用户</th><th>状态</th><th>详情</th><th>创建时间</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in items" :key="item.type + '-' + item.id">
                  <td>{{ typeLabel(item.type) }}</td>
                  <td class="vue-ellipsis" :title="item.title">{{ item.title || item.name || item.id }}</td>
                  <td>{{ item.username || '-' }}</td>
                  <td>{{ item.status || '-' }}</td>
                  <td class="vue-ellipsis" :title="item.detail">{{ item.detail || item.description || '-' }}</td>
                  <td>{{ fmtDate(item.created_at) }}</td>
                  <td class="actions-cell">
                    <button class="btn-sm" @click="openDetail(item.type, item.id)">查看</button>
                    <button class="btn-sm danger" @click="removeItem(item.type, item.id)">删除</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="detail" class="modal-overlay show ct-detail-overlay" @click.self="closeDetail">
            <div class="modal-content vue-content-detail">
              <div class="modal-header">
                <span>{{ detail.title || detail.name || detail.id || '内容详情' }}</span>
                <button class="btn-sm" @click="closeDetail">×</button>
              </div>
              <div class="modal-body">
                <div v-if="detail.error" class="kb-empty">{{ detail.error }}</div>
                <template v-else>
                  <div class="ct-detail-meta">
                    <div class="ct-meta-row" v-for="row in detailRows(detail)" :key="row[0]">
                      <span class="ct-meta-label">{{ row[0] }}</span>
                      <span>{{ row[1] }}</span>
                    </div>
                  </div>
                  <section class="ct-section" v-for="block in importantBlocks(detail)" :key="block.title">
                    <div class="ct-sec-title">{{ block.title }}</div>
                    <pre class="ct-text-block vue-json-block">{{ block.value }}</pre>
                  </section>
                </template>
              </div>
            </div>
          </div>
        </section>
      `
    }).mount(el);
  }

  function mountMonitor() {
    const el = document.getElementById('admin-monitor-vue');
    if (!el || monitorVm) return;

    monitorVm = createApp({
      data() {
        return {
          days: 7,
          loading: false,
          error: '',
          overview: null,
          server: null,
          recent: [],
          usagePage: { total: 0, limit: 20, offset: 0, page: 1, summary: null, facets: {} },
          usageFilters: { date_from: '', date_to: '', provider: '', model: '', status: '', agent_id: '' },
          budgetOpen: false,
          budgetSaving: false,
          budgetForm: { monthly_budget_usd: 0, alert_threshold: 0.8, usd_cny_rate: 7.2 }
        };
      },
      computed: {
        stats() {
          return this.overview?.stats || {};
        },
        displayStats() {
          const stats = this.stats;
          if (Number(stats.total_calls || 0) > 0 || !(this.recent || []).length) return stats;
          return (this.recent || []).reduce((acc, row) => {
            acc.total_calls += 1;
            acc.total_tokens += Number(row.total_tokens || row.tokens || 0);
            acc.total_input_tokens += Number(row.input_tokens || 0);
            acc.total_output_tokens += Number(row.output_tokens || 0);
            acc.total_cost_usd += Number(row.cost_usd || 0);
            acc.total_video_seconds += Number(row.video_seconds || 0);
            acc.total_image_count += Number(row.image_count || 0);
            if ((row.status || 'success') === 'fail') acc.fail_count += 1;
            else acc.success_count += 1;
            return acc;
          }, {
            total_calls: 0,
            total_tokens: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_cost_usd: 0,
            total_video_seconds: 0,
            total_image_count: 0,
            success_count: 0,
            fail_count: 0
          });
        },
        budget() {
          return this.overview?.budget || {};
        },
        rate() {
          return this.budget.usd_cny_rate || this.budgetForm.usd_cny_rate || 7.2;
        },
        alerts() {
          return this.overview?.alerts || [];
        },
        usagePageCount() {
          return Math.max(1, Math.ceil(Number(this.usagePage?.total || 0) / Number(this.usagePage?.limit || 20)));
        },
        usageCurrentPage() {
          return Math.min(this.usagePageCount, Math.floor(Number(this.usagePage?.offset || 0) / Number(this.usagePage?.limit || 20)) + 1);
        },
        usageProviders() {
          return this.usageFacetValues('providers');
        },
        usageModels() {
          return this.usageFacetValues('models');
        },
        usageAgents() {
          return this.usageFacetValues('agents');
        },
        overviewCards() {
          const stats = this.displayStats;
          const budget = this.budget;
          const cards = [
            { label: `总调用 (${this.days}d)`, value: fmtNum(stats.total_calls), meta: `成功 ${fmtNum(stats.success_count)} · 失败 ${fmtNum(stats.fail_count)}` },
            { label: '总 Tokens', value: fmtNum(stats.total_tokens), meta: `输入 ${fmtNum(stats.total_input_tokens)} · 输出 ${fmtNum(stats.total_output_tokens)}` },
            { label: '总成本（人民币）', value: this.cny(stats.total_cost_usd), meta: `${fmtUsd(stats.total_cost_usd)} · 汇率 ${this.rate.toFixed(2)}` },
            { label: '视频生成', value: `${Number(stats.total_video_seconds || 0).toFixed(0)} 秒`, meta: `图像 ${fmtNum(stats.total_image_count)} 张` }
          ];
          if (budget.has_budget) {
            cards.splice(3, 0, {
              label: '本月预算',
              value: `${this.cny(budget.used_cost_usd)} / ${this.cny(budget.monthly_budget_usd)}`,
              meta: `剩余 ${this.cny(budget.remaining_usd)} · ${budget.used_percent || 0}%`,
              alert: budget.alerting
            });
          } else {
            cards.splice(3, 0, {
              label: '本月预算',
              value: '未设置',
              meta: `已用 ${this.cny(budget.used_cost_usd)} (${fmtUsd(budget.used_cost_usd)})`
            });
          }
          return cards;
        }
      },
      methods: {
        async refresh(force = false) {
          this.loading = true;
          this.error = '';
          try {
            this.usagePage.offset = 0;
            this.usagePage.page = 1;
            const [overview, server, recent] = await Promise.all([
              api.get(`/api/admin/token-stats/overview?days=${this.days}`, { cache: !force, ttl: 8000 }),
              api.get('/api/admin/token-stats/server', { cache: !force, ttl: 8000 }),
              this.fetchUsageRows({ force, page: 1 })
            ]);
            this.overview = overview;
            this.server = server;
            if (recent) this.applyUsagePage(recent, false);
          } catch (error) {
            this.error = error.message || '加载失败';
          } finally {
            this.loading = false;
          }
        },
        usageFacetValues(key) {
          const list = this.usagePage?.facets?.[key] || [];
          return Array.isArray(list) ? list.map(item => item.value).filter(Boolean) : [];
        },
        usageQueryParams(page = 1) {
          const params = new URLSearchParams();
          params.set('format', 'page');
          const limit = Number(this.usagePage.limit || 20);
          params.set('limit', String(limit));
          params.set('offset', String(Math.max(0, Number(page || 1) - 1) * limit));
          Object.entries(this.usageFilters || {}).forEach(([key, value]) => {
            const text = String(value || '').trim();
            if (text) params.set(key, text);
          });
          return params;
        },
        async fetchUsageRows({ force = false, page = 1 } = {}) {
          return api.get('/api/admin/token-stats/recent?' + this.usageQueryParams(page).toString(), { cache: false, ttl: force ? 0 : 8000 });
        },
        applyUsagePage(page) {
          const items = Array.isArray(page) ? page : (page.items || []);
          this.recent = items;
          this.usagePage = {
            ...this.usagePage,
            total: Number(page.total || items.length || 0),
            limit: Number(page.limit || this.usagePage.limit || 20),
            offset: Number(page.offset || 0),
            page: Math.floor(Number(page.offset || 0) / Number(page.limit || this.usagePage.limit || 20)) + 1,
            summary: page.summary || null,
            facets: page.facets || this.usagePage.facets || {}
          };
        },
        async queryUsage() {
          this.loading = true;
          this.error = '';
          try {
            const page = await this.fetchUsageRows({ force: true, page: 1 });
            this.applyUsagePage(page);
          } catch (error) {
            this.error = error.message || '调用记录查询失败';
          } finally {
            this.loading = false;
          }
        },
        async changeUsagePage(targetPage) {
          const nextPage = Math.max(1, Math.min(this.usagePageCount, Number(targetPage) || 1));
          if (this.loading || nextPage === this.usageCurrentPage) return;
          this.loading = true;
          this.error = '';
          try {
            const page = await this.fetchUsageRows({ force: true, page: nextPage });
            this.applyUsagePage(page);
          } catch (error) {
            this.error = error.message || '调用记录翻页失败';
          } finally {
            this.loading = false;
          }
        },
        resetUsageFilters() {
          this.usageFilters = { date_from: '', date_to: '', provider: '', model: '', status: '', agent_id: '' };
          this.queryUsage();
        },
        tableRows(type) {
          const rows = this.stats[type] || [];
          if (rows.length) return rows.slice(0, 10);
          return this.aggregateRecent(type).slice(0, 10);
        },
        aggregateRecent(type) {
          const keyFor = row => {
            if (type === 'by_provider') return row.provider || row.provider_name || row.vendor_label || '(unknown)';
            if (type === 'by_model') return `${row.provider || row.provider_name || '(unknown)'}/${row.model || row.model_name || row.model_label || '(unknown)'}`;
            return row.agent_id || row.agent || '(unknown)';
          };
          const groups = {};
          (this.recent || []).forEach(row => {
            const key = keyFor(row);
            if (!groups[key]) groups[key] = {
              key,
              provider: row.provider,
              model: row.model,
              provider_name: row.provider_name,
              model_name: row.model_name,
              vendor_label: row.vendor_label,
              model_label: row.model_label,
              agent_id: row.agent_id,
              calls: 0,
              tokens: 0,
              cost_usd: 0
            };
            groups[key].calls += 1;
            groups[key].tokens += Number(row.total_tokens || row.tokens || 0);
            groups[key].cost_usd += Number(row.cost_usd || 0);
          });
          return Object.values(groups)
            .map(row => ({ ...row, cost_usd: Number(row.cost_usd.toFixed(4)) }))
            .sort((a, b) => b.cost_usd - a.cost_usd);
        },
        labelFor(row, type) {
          if (type === 'by_provider') return row.provider_name || row.vendor_label || row.key || row.provider || '-';
          if (type === 'by_model') return row.model_name || row.model_label || row.key || row.model || '-';
          return row.key || row.agent_id || '-';
        },
        maxCost(rows) {
          return Math.max(0.000001, ...rows.map(r => Number(r.cost_usd || 0)));
        },
        dayWidth(day) {
          const rows = this.stats.by_day || [];
          const max = Math.max(0.000001, ...rows.map(row => Number(row.cost_usd || 0)));
          return Math.min(100, Number(day.cost_usd || 0) / max * 100);
        },
        async openBudget() {
          try {
            const budget = await api.get('/api/admin/token-stats/budget', { cache: false });
            this.budgetForm = {
              monthly_budget_usd: budget.monthly_budget_usd || 0,
              alert_threshold: budget.alert_threshold || 0.8,
              usd_cny_rate: budget.usd_cny_rate || 7.2
            };
          } catch (error) {
            if (typeof toast === 'function') toast(error.message || '读取预算失败', 'error');
          }
          this.budgetOpen = true;
        },
        async saveBudget() {
          this.budgetSaving = true;
          try {
            await api.put('/api/admin/token-stats/budget', {
              monthly_budget_usd: Number(this.budgetForm.monthly_budget_usd || 0),
              alert_threshold: Number(this.budgetForm.alert_threshold || 0.8),
              usd_cny_rate: Number(this.budgetForm.usd_cny_rate || 7.2)
            });
            this.budgetOpen = false;
            if (typeof toast === 'function') toast('预算已保存', 'success');
            await this.refresh(true);
          } catch (error) {
            if (typeof toast === 'function') toast(error.message || '保存失败', 'error');
            else alert(error.message || '保存失败');
          } finally {
            this.budgetSaving = false;
          }
        },
        cny(value, digits = 2) { return fmtCny(value, this.rate, digits); },
        usd: fmtUsd,
        num: fmtNum,
        fmtDate,
        get,
        uptime(seconds) {
          seconds = Number(seconds || 0);
          if (seconds < 60) return seconds + 's';
          if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
          if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
          return Math.floor(seconds / 86400) + 'd ' + Math.floor((seconds % 86400) / 3600) + 'h';
        }
      },
      mounted() {
        this.refresh();
      },
      template: `
        <section class="vue-admin-page vue-monitor-page">
          <div class="panel-toolbar vue-native-toolbar">
            <span class="panel-title">Token 使用与服务器监控</span>
            <div class="vue-native-actions">
              <select v-model.number="days" @change="refresh(true)">
                <option :value="1">最近 1 天</option>
                <option :value="7">最近 7 天</option>
                <option :value="30">最近 30 天</option>
                <option :value="90">最近 90 天</option>
              </select>
              <button class="btn-sm" @click="refresh(true)" :disabled="loading">{{ loading ? '刷新中...' : '刷新' }}</button>
              <button class="btn-sm" @click="openBudget">预算设置</button>
            </div>
          </div>

          <div v-if="error" class="kb-empty">加载失败：{{ error }}</div>
          <template v-else>
            <div class="monitor-alerts">
              <div v-if="!alerts.length" class="monitor-alert alert-ok">一切正常</div>
              <div v-for="alert in alerts" :key="alert.type + alert.message" class="monitor-alert" :class="'alert-' + alert.level">
                <strong>{{ alert.type }}</strong>：{{ alert.message }}
              </div>
            </div>

            <div class="monitor-cards">
              <div class="monitor-card" v-for="card in overviewCards" :key="card.label" :class="{ 'card-alert': card.alert }">
                <div class="monitor-card-label">{{ card.label }}</div>
                <div class="monitor-card-value">{{ card.value }}</div>
                <div class="monitor-card-meta">{{ card.meta }}</div>
              </div>
            </div>

            <div class="monitor-section">
              <div class="monitor-section-title">服务器状态</div>
              <div v-if="server" class="monitor-server-grid">
                <div class="monitor-server-item">
                  <div class="monitor-server-label">CPU 使用率</div>
                  <div class="monitor-server-value" :class="{ alert: get(server, 'cpu.usage_percent', 0) > 80 }">{{ get(server, 'cpu.usage_percent', 0) }}%</div>
                  <div class="monitor-server-meta">{{ get(server, 'cpu.count', 0) }} 核 · Load {{ get(server, 'cpu.load_avg_1m', 0).toFixed?.(2) || 0 }}</div>
                </div>
                <div class="monitor-server-item">
                  <div class="monitor-server-label">内存使用率</div>
                  <div class="monitor-server-value" :class="{ alert: get(server, 'memory.used_percent', 0) > 90 }">{{ get(server, 'memory.used_percent', 0) }}%</div>
                  <div class="monitor-server-meta">{{ get(server, 'memory.used_gb', 0) }} / {{ get(server, 'memory.total_gb', 0) }} GB</div>
                </div>
                <div class="monitor-server-item">
                  <div class="monitor-server-label">Node 进程内存</div>
                  <div class="monitor-server-value">{{ get(server, 'process_memory.rss_mb', 0) }} MB</div>
                  <div class="monitor-server-meta">Heap {{ get(server, 'process_memory.heap_used_mb', 0) }} / {{ get(server, 'process_memory.heap_total_mb', 0) }} MB</div>
                </div>
                <div class="monitor-server-item">
                  <div class="monitor-server-label">运行时间</div>
                  <div class="monitor-server-value">{{ uptime(server.uptime_seconds) }}</div>
                  <div class="monitor-server-meta">系统 {{ uptime(server.system_uptime_seconds) }}</div>
                </div>
              </div>
            </div>

            <div class="monitor-tables">
              <div class="monitor-table-col" v-for="table in [
                { key: 'by_provider', title: '按 Provider' },
                { key: 'by_model', title: '按 Model' },
                { key: 'by_agent', title: '按 Agent' }
              ]" :key="table.key">
                <div class="monitor-section-title">{{ table.title }}</div>
                <div v-if="!tableRows(table.key).length" class="monitor-empty">暂无数据</div>
                <table v-else class="monitor-table">
                  <thead><tr><th>名称</th><th>调用</th><th>Tokens</th><th>成本</th></tr></thead>
                  <tbody>
                    <tr v-for="row in tableRows(table.key)" :key="labelFor(row, table.key)">
                      <td class="monitor-key">{{ labelFor(row, table.key) }}</td>
                      <td>{{ num(row.calls) }}</td>
                      <td>{{ num(row.tokens) }}</td>
                      <td>
                        <strong>{{ cny(row.cost_usd) }}</strong>
                        <span class="vue-muted">{{ usd(row.cost_usd) }}</span>
                        <div class="monitor-mini-bar" :style="{ width: (Number(row.cost_usd || 0) / maxCost(tableRows(table.key)) * 100) + '%' }"></div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="monitor-section">
              <div class="monitor-section-title">按天趋势</div>
              <div v-if="!(stats.by_day || []).length" class="monitor-empty">暂无数据</div>
              <div v-else class="monitor-day-chart">
                <div class="monitor-day-bar" v-for="day in stats.by_day" :key="day.day">
                  <div class="monitor-day-label">{{ String(day.day).slice(5) }}</div>
                  <div class="monitor-day-visual"><div class="monitor-day-cost-bar" :style="{ width: dayWidth(day) + '%' }"></div></div>
                  <div class="monitor-day-meta">
                    <span>{{ num(day.calls) }} 次</span>
                    <span>{{ num(day.tokens) }} t</span>
                    <span>{{ cny(day.cost_usd) }}</span>
                    <span>{{ usd(day.cost_usd) }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="monitor-section">
              <div class="monitor-section-title">调用记录</div>
              <div class="monitor-usage-filters">
                <label>开始日期 <input type="date" v-model="usageFilters.date_from" /></label>
                <label>结束日期 <input type="date" v-model="usageFilters.date_to" /></label>
                <label>厂商
                  <input list="monitorUsageProviders" v-model.trim="usageFilters.provider" placeholder="全部厂商" />
                  <datalist id="monitorUsageProviders"><option v-for="p in usageProviders" :key="p" :value="p"></option></datalist>
                </label>
                <label>模型
                  <input list="monitorUsageModels" v-model.trim="usageFilters.model" placeholder="全部模型" />
                  <datalist id="monitorUsageModels"><option v-for="m in usageModels" :key="m" :value="m"></option></datalist>
                </label>
                <label>Agent
                  <input list="monitorUsageAgents" v-model.trim="usageFilters.agent_id" placeholder="全部 Agent" />
                  <datalist id="monitorUsageAgents"><option v-for="a in usageAgents" :key="a" :value="a"></option></datalist>
                </label>
                <label>状态
                  <select v-model="usageFilters.status">
                    <option value="">全部</option>
                    <option value="success">成功</option>
                    <option value="fail">失败</option>
                  </select>
                </label>
                <label>每页
                  <select v-model.number="usagePage.limit">
                    <option :value="20">20</option>
                    <option :value="50">50</option>
                    <option :value="100">100</option>
                  </select>
                </label>
                <button class="btn-sm" @click="queryUsage" :disabled="loading">查询</button>
                <button class="btn-sm" @click="resetUsageFilters" :disabled="loading">重置</button>
              </div>
              <div class="monitor-usage-summary">
                第 {{ num(usageCurrentPage) }} / {{ num(usagePageCount) }} 页 · 本页 {{ num(recent.length) }} / 共 {{ num(usagePage.total) }} 次调用
                <span v-if="usagePage.summary">成本 {{ cny(usagePage.summary.cost_usd, 4) }} <span class="vue-muted">{{ usd(usagePage.summary.cost_usd) }}</span></span>
              </div>
              <div v-if="!recent.length" class="monitor-empty">暂无调用记录</div>
              <div v-if="recent.length" class="vue-table-scroll">
                <table class="monitor-table">
                  <thead><tr><th>时间</th><th>接入厂商</th><th>模型</th><th>Agent</th><th>Tokens</th><th>成本</th><th>耗时</th><th>状态</th></tr></thead>
                  <tbody>
                    <tr v-for="row in recent" :key="row.id || row.timestamp + row.model" :class="{ 'row-fail': row.status === 'fail' }">
                      <td>{{ row.timestamp?.slice(11, 19) || '-' }}</td>
                      <td>{{ row.provider_name || row.vendor_label || row.provider || '-' }}</td>
                      <td>{{ row.model_name || row.model_label || row.model || '-' }}</td>
                      <td>{{ row.agent_id || '-' }}</td>
                      <td>{{ num(row.total_tokens) }}</td>
                      <td>{{ cny(row.cost_usd, 4) }} <span class="vue-muted">{{ usd(row.cost_usd) }}</span></td>
                      <td>{{ row.duration_ms || 0 }}ms</td>
                      <td>{{ row.status === 'success' ? '成功' : '失败' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="monitor-usage-actions" v-if="usagePage.total">
                <button class="btn-sm" @click="changeUsagePage(usageCurrentPage - 1)" :disabled="loading || usageCurrentPage <= 1">上一页</button>
                <span>第 {{ num(usageCurrentPage) }} / {{ num(usagePageCount) }} 页</span>
                <button class="btn-sm" @click="changeUsagePage(usageCurrentPage + 1)" :disabled="loading || usageCurrentPage >= usagePageCount">下一页</button>
              </div>
            </div>
          </template>

          <div v-if="budgetOpen" class="modal-overlay show" @click.self="budgetOpen = false">
            <div class="modal-content vue-budget-modal">
              <div class="modal-header">
                <span>月度预算设置</span>
                <button class="btn-sm" @click="budgetOpen = false">×</button>
              </div>
              <div class="modal-body">
                <div class="form-group">
                  <label>月度预算 (USD)</label>
                  <input type="number" v-model.number="budgetForm.monthly_budget_usd" min="0" step="0.01" />
                </div>
                <div class="form-group">
                  <label>告警阈值 (0-1)</label>
                  <input type="number" v-model.number="budgetForm.alert_threshold" min="0" max="1" step="0.1" />
                </div>
                <div class="form-group">
                  <label>USD → CNY 汇率</label>
                  <input type="number" v-model.number="budgetForm.usd_cny_rate" min="1" max="20" step="0.01" />
                </div>
                <div class="vue-modal-actions">
                  <button class="btn-sm" @click="budgetOpen = false">取消</button>
                  <button class="btn-primary" @click="saveBudget" :disabled="budgetSaving">{{ budgetSaving ? '保存中...' : '保存' }}</button>
                </div>
              </div>
            </div>
          </div>
        </section>
      `
    }).mount(el);
  }

  function mountAll() {
    mountContents();
    mountMonitor();
  }

  window.loadContents = function loadContentsVue(force = false) {
    mountContents();
    return contentsVm?.refresh(!!force);
  };
  window.ctLoadItems = function ctLoadItemsVue(force = false) {
    mountContents();
    return contentsVm?.loadItems(!!force);
  };
  window.ctSwitchModule = function ctSwitchModuleVue(id) {
    mountContents();
    return contentsVm?.switchModule(id);
  };
  window.viewContent = function viewContentVue(type, id) {
    mountContents();
    return contentsVm?.openDetail(type, id);
  };
  window.deleteContent = function deleteContentVue(type, id) {
    mountContents();
    return contentsVm?.removeItem(type, id);
  };
  window.ctSwitchChapter = window.ctSwitchChapter || function ctSwitchChapterVue() {};

  window.monitorRefresh = function monitorRefreshVue(force = false) {
    mountMonitor();
    return monitorVm?.refresh(!!force);
  };
  window.monitorOpenBudget = function monitorOpenBudgetVue() {
    mountMonitor();
    return monitorVm?.openBudget();
  };
  window.monitorSaveBudget = function monitorSaveBudgetVue() {
    mountMonitor();
    return monitorVm?.saveBudget();
  };

  document.addEventListener('DOMContentLoaded', mountAll);
})();
