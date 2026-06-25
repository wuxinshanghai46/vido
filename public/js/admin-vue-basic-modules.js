(() => {
  if (!window.Vue || !window.AdminVueApi) return;
  const { createApp } = window.Vue;
  const api = window.AdminVueApi;

  const esc = value => String(value ?? '');
  const fmtDate = value => value ? new Date(value).toLocaleString('zh-CN') : '-';
  const fmtNum = value => Number(value || 0).toLocaleString('zh-CN');
  const fmtMoney = (usd, rate = 7.2) => '¥' + (Number(usd || 0) * rate).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let dashboardVm = null;
  let creditsVm = null;
  let systemVm = null;
  let datasourceVm = null;
  let pipelineVm = null;
  const legacyLoadModelPipeline = window.loadModelPipeline;
  const legacyOpenStageEditModal = window.openStageEditModal;

  function mountDashboard() {
    const el = document.getElementById('admin-dashboard-vue');
    if (!el || dashboardVm) return;
    dashboardVm = createApp({
      data() {
        return { loading: false, error: '', data: null, updatedAt: '' };
      },
      computed: {
        rate() { return this.data?.currency?.usd_cny_rate || 7.2; },
        cards() {
          const d = this.data;
          if (!d) return [];
          return [
            { label: '用户总数', value: d.users?.total ?? 0, meta: `今日 +${d.users?.today || 0} / 本周 +${d.users?.week || 0} / 本月 +${d.users?.month || 0}` },
            { label: '生成内容总数', value: d.content?._total?.total ?? 0, meta: `今日 +${d.content?._total?.today || 0} / 本周 +${d.content?._total?.week || 0}` },
            { label: '已接入模型', value: `${d.models?.enabled_models || 0} / ${d.models?.total_models || 0}`, meta: `${d.models?.enabled_providers || 0} 个 provider` },
            { label: '累计消耗', value: fmtMoney(d.tokens?.total_cost_usd || 0, this.rate), meta: `$${Number(d.tokens?.total_cost_usd || 0).toFixed(4)}` },
            { label: '知识库', value: d.knowledge?.total_docs ?? 0, meta: `${d.knowledge?.total_agents || 0} 个 agent` },
            { label: 'Token 调用次数', value: fmtNum(d.tokens?.total_calls || 0), meta: `${fmtNum(d.tokens?.total_tokens || 0)} tokens` }
          ].map((card, index) => ({
            ...card,
            icon: ['\uD83D\uDC65', '\uD83D\uDCE6', '\uD83E\uDD16', '\uD83D\uDCB0', '\uD83E\uDDE0', '\u2699\uFE0F'][index] || '\u25A3'
          }));
        },
        contentRows() {
          const content = this.data?.content || {};
          return Object.entries(content).filter(([key]) => key !== '_total').map(([key, value]) => ({ key, ...value }));
        }
      },
      methods: {
        async refresh(force = false) {
          this.loading = true;
          this.error = '';
          try {
            this.data = await api.get('/api/admin/dashboard', { cache: !force, ttl: 10000 });
            this.updatedAt = this.data?.timestamp ? fmtDate(this.data.timestamp) : fmtDate(new Date());
          } catch (error) {
            this.error = error.message || '加载失败';
          } finally {
            this.loading = false;
          }
        },
        money(value) { return fmtMoney(value, this.rate); },
        usd(value) { return '$' + Number(value || 0).toFixed(4); },
        num: fmtNum
      },
      mounted() { this.refresh(); },
      template: `
        <section class="vue-admin-page">
          <div class="panel-toolbar vue-native-toolbar">
            <span class="panel-title">仪表盘 / Dashboard</span>
            <div class="vue-native-actions">
              <span class="vue-native-time" v-if="updatedAt">更新于 {{ updatedAt }}</span>
              <button class="btn-sm" @click="refresh(true)" :disabled="loading">{{ loading ? '刷新中...' : '刷新' }}</button>
            </div>
          </div>
          <div v-if="error" class="kb-empty">加载失败：{{ error }}</div>
          <div v-else-if="!data" class="kb-empty">加载中...</div>
          <template v-else>
            <div class="dash-section-title">核心指标 <span>· 汇率 1$ ≈ ¥{{ rate.toFixed(2) }}</span></div>
            <div class="dash-cards">
              <div class="dash-card" v-for="card in cards" :key="card.label">
                <div class="dash-card-icon" aria-hidden="true">{{ card.icon }}</div>
                <div class="dash-card-main">
                  <div class="dash-card-label">{{ card.label }}</div>
                  <div class="dash-card-value">{{ card.value }}</div>
                  <div class="dash-card-meta">{{ card.meta }}</div>
                </div>
              </div>
            </div>
            <div class="dash-section-title">平台消耗清单</div>
            <table class="monitor-table">
              <thead><tr><th>时段</th><th>调用次数</th><th>Tokens</th><th>消耗（CNY）</th><th>消耗（USD）</th></tr></thead>
              <tbody>
                <tr v-for="row in [
                  ['今日', data.tokens.today],
                  ['本周', data.tokens.week],
                  ['本月', data.tokens.month],
                  ['本季', data.tokens.quarter]
                ]" :key="row[0]">
                  <td class="dash-key">{{ row[0] }}</td>
                  <td>{{ num(row[1]?.calls || 0) }}</td>
                  <td>{{ num(row[1]?.tokens || 0) }}</td>
                  <td style="color:var(--accent);font-weight:700">{{ money(row[1]?.cost_usd || 0) }}</td>
                  <td style="color:var(--text3)">{{ usd(row[1]?.cost_usd || 0) }}</td>
                </tr>
              </tbody>
            </table>
            <div class="dash-section-title">内容模块统计</div>
            <table class="monitor-table">
              <thead><tr><th>模块</th><th>总数</th><th>今日</th><th>本周</th><th>本月</th></tr></thead>
              <tbody>
                <tr v-for="row in contentRows" :key="row.key">
                  <td class="dash-key">{{ row.name }}</td>
                  <td>{{ row.total }}</td>
                  <td>+{{ row.today }}</td>
                  <td>+{{ row.week }}</td>
                  <td>+{{ row.month }}</td>
                </tr>
              </tbody>
            </table>
          </template>
        </section>`
    }).mount(el);
  }

  function mountCredits() {
    const el = document.getElementById('admin-credits-vue');
    if (!el || creditsVm) return;
    creditsVm = createApp({
      data() {
        return {
          loading: false,
          logs: [],
          users: [],
          filters: { user_id: '', operation: '', start_date: '', end_date: '' }
        };
      },
      methods: {
        async refresh(force = false) {
          this.loading = true;
          try {
            const params = new URLSearchParams();
            Object.entries(this.filters).forEach(([key, value]) => { if (value) params.set(key, value); });
            params.set('limit', '100');
            const [logs, users] = await Promise.all([
              api.get('/api/admin/credits-log?' + params.toString(), { cache: !force, ttl: 8000 }),
              api.get('/api/admin/users', { cache: true, ttl: 12000 })
            ]);
            this.logs = Array.isArray(logs) ? logs : [];
            this.users = Array.isArray(users) ? users : [];
          } catch (error) {
            toast(error.message || '积分记录加载失败', 'error');
          } finally {
            this.loading = false;
          }
        },
        reset() {
          this.filters = { user_id: '', operation: '', start_date: '', end_date: '' };
          this.refresh(true);
        },
        date: fmtDate,
        amountClass(amount) { return Number(amount || 0) >= 0 ? 'vue-credit-plus' : 'vue-credit-minus'; },
        amountText(amount) { return Number(amount || 0) >= 0 ? `+${amount || 0}` : String(amount || 0); }
      },
      mounted() { this.refresh(); },
      template: `
        <section class="vue-admin-page">
          <div class="panel-toolbar vue-native-toolbar"><span class="panel-title">积分记录</span></div>
          <div class="filter-bar vue-native-filter">
            <div class="form-group"><label>用户</label><select v-model="filters.user_id"><option value="">全部</option><option v-for="user in users" :key="user.id" :value="user.id">{{ user.username }}</option></select></div>
            <div class="form-group"><label>操作类型</label><select v-model="filters.operation"><option value="">全部</option><option value="admin_adjust">管理员调整</option><option value="consume">消费</option><option value="recharge">充值</option><option value="refund">退款</option><option value="init">初始化</option></select></div>
            <div class="form-group"><label>开始日期</label><input type="date" v-model="filters.start_date" /></div>
            <div class="form-group"><label>结束日期</label><input type="date" v-model="filters.end_date" /></div>
            <button class="btn-primary" @click="refresh(true)" :disabled="loading">{{ loading ? '查询中...' : '查询' }}</button>
            <button class="btn-sm" @click="reset">重置</button>
          </div>
          <div style="overflow-x:auto;">
            <table class="data-table">
              <thead><tr><th>时间</th><th>用户</th><th>操作类型</th><th>变动</th><th>余额</th><th>详情</th></tr></thead>
              <tbody>
                <tr v-for="log in logs" :key="log.id || log.created_at + log.user_id">
                  <td style="font-size:12px;">{{ date(log.created_at) }}</td>
                  <td>{{ log.username || log.user_id || '-' }}</td>
                  <td><span class="badge badge-pending">{{ log.operation || '-' }}</span></td>
                  <td :class="amountClass(log.amount)" style="font-weight:600;">{{ amountText(log.amount) }}</td>
                  <td>{{ log.balance ?? '-' }}</td>
                  <td style="font-size:12px;color:var(--text3);">{{ log.reason || log.detail || '-' }}</td>
                </tr>
                <tr v-if="!logs.length"><td colspan="6" class="empty-state">{{ loading ? '加载中...' : '暂无记录' }}</td></tr>
              </tbody>
            </table>
          </div>
        </section>`
    }).mount(el);
  }

  function mountSystem() {
    const el = document.getElementById('admin-system-vue');
    if (!el || systemVm) return;
    systemVm = createApp({
      data() {
        return { loading: false, stats: null };
      },
      computed: {
        cards() {
          const s = this.stats || {};
          return [
            { label: '总用户数', value: s.total_users ?? '-' },
            { label: '活跃用户', value: s.active_users ?? '-' },
            { label: '今日积分消费', value: s.today_credits_consumed ?? '-' },
            { label: '总交易数', value: s.total_transactions ?? '-' }
          ];
        }
      },
      methods: {
        async refresh(force = false) {
          this.loading = true;
          try {
            this.stats = await api.get('/api/admin/stats', { cache: !force, ttl: 10000 });
          } catch (error) {
            toast(error.message || '系统统计加载失败', 'error');
          } finally {
            this.loading = false;
          }
        }
      },
      mounted() { this.refresh(); },
      template: `
        <section class="vue-admin-page">
          <div class="panel-toolbar vue-native-toolbar">
            <span class="panel-title">系统设置</span>
            <button class="btn-sm" @click="refresh(true)" :disabled="loading">{{ loading ? '刷新中...' : '刷新' }}</button>
          </div>
          <div class="stats-grid">
            <div class="stat-card" v-for="card in cards" :key="card.label">
              <div class="stat-card-label">{{ card.label }}</div>
              <div class="stat-card-value">{{ card.value }}</div>
            </div>
          </div>
        </section>`
    }).mount(el);
  }

  function mountDatasource() {
    const el = document.getElementById('admin-datasource-vue');
    if (!el || datasourceVm) return;
    datasourceVm = createApp({
      data() {
        return { loading: false, providers: [], status: {} };
      },
      methods: {
        async refresh(force = false) {
          this.loading = true;
          try {
            const data = await api.get('/api/admin/datasources', { cache: !force, ttl: 10000 });
            this.providers = data.providers || [];
          } catch (error) {
            toast(error.message || '数据源加载失败', 'error');
          } finally {
            this.loading = false;
          }
        },
        providerConfig(provider, key, schema) {
          const config = provider.config || {};
          return config[key] !== undefined ? config[key] : (schema.default || '');
        },
        setProviderConfig(provider, key, value, schema) {
          provider.config = provider.config || {};
          provider.config[key] = schema?.type === 'number' ? Number(value || 0) : value;
        },
        async save(provider, silent = false) {
          const config = { ...(provider.config || {}) };
          config.enabled = !!config.enabled;
          try {
            await api.put(`/api/admin/datasources/${provider.id}`, config);
            this.status[provider.id] = { ok: true, text: `已保存 ${new Date().toLocaleTimeString('zh-CN')}` };
            if (!silent) toast('已保存');
            await this.refresh(true);
          } catch (error) {
            this.status[provider.id] = { ok: false, text: error.message };
            if (!silent) toast(error.message || '保存失败', 'error');
          }
        },
        async reset(provider) {
          if (!confirm(`重置数据源 ${provider.id}？\n\n会清空 API Key/Cookie 等配置并禁用该 provider`)) return;
          try {
            await api.put(`/api/admin/datasources/${provider.id}`, { enabled: false, api_key: '', cookie: '', region: '', timeout: undefined });
            toast('已重置');
            await this.refresh(true);
          } catch (error) {
            toast(error.message || '重置失败', 'error');
          }
        },
        async test(provider) {
          this.status[provider.id] = { ok: null, text: '测试中...' };
          try {
            const data = await api.post(`/api/admin/datasources/${provider.id}/health`, {});
            const health = data.health || data;
            this.status[provider.id] = { ok: !!health.ok, text: health.message || (health.ok ? '连接正常' : '连接失败') };
          } catch (error) {
            this.status[provider.id] = { ok: false, text: error.message };
          }
        }
      },
      mounted() { this.refresh(); },
      template: `
        <section class="vue-admin-page">
          <div class="panel-toolbar vue-native-toolbar">
            <span class="panel-title">数据源管理 <span style="font-size:11px;color:var(--text3);font-weight:400;margin-left:8px">爆款复刻 / 多平台搜索的数据源 provider 配置</span></span>
            <button class="btn-sm" @click="refresh(true)" :disabled="loading">{{ loading ? '刷新中...' : '刷新' }}</button>
          </div>
          <div class="vue-datasource-list">
            <div class="vue-datasource-card" v-for="provider in providers" :key="provider.id" :class="{enabled:provider.config?.enabled}">
              <div class="vue-datasource-head">
                <div>
                  <div class="vue-datasource-title">
                    <span>{{ provider.name }}</span>
                    <span class="vue-datasource-tag warn" v-if="provider.requires_key">需 Key</span>
                    <span class="vue-datasource-tag ok" v-else>免 Key</span>
                    <span class="vue-datasource-state">{{ provider.config?.enabled ? '已启用' : '已禁用' }}</span>
                  </div>
                  <div class="vue-datasource-desc">{{ provider.description }}</div>
                  <div class="vue-datasource-meta">id: {{ provider.id }} · platform: {{ provider.platform }}</div>
                </div>
                <label class="vido-toggle">
                  <input type="checkbox" v-model="provider.config.enabled" @change="save(provider, true)" />
                  <span class="vido-toggle-slider"></span>
                </label>
              </div>
              <div class="vue-datasource-fields">
                <label v-for="(schema, key) in provider.config_schema" :key="key">
                  <span>{{ schema.label || key }}</span>
                  <select v-if="schema.type === 'select'" :value="providerConfig(provider, key, schema)" @change="setProviderConfig(provider, key, $event.target.value, schema)">
                    <option v-for="option in schema.options || []" :key="option" :value="option">{{ option }}</option>
                  </select>
                  <input v-else :type="schema.type === 'password' ? 'password' : (schema.type === 'number' ? 'number' : 'text')" :value="providerConfig(provider, key, schema)" @input="setProviderConfig(provider, key, $event.target.value, schema)" :placeholder="schema.label || key" />
                </label>
              </div>
              <div class="vue-datasource-actions">
                <button class="btn-primary btn-sm" @click="save(provider)">保存配置</button>
                <button class="btn-sm" @click="test(provider)">测试连通</button>
                <span class="vue-spacer"></span>
                <button class="btn-sm danger" @click="reset(provider)">重置</button>
              </div>
              <div class="vue-datasource-status" v-if="status[provider.id]" :class="{ok:status[provider.id].ok, bad:status[provider.id].ok===false}">{{ status[provider.id].text }}</div>
            </div>
            <div v-if="!providers.length" class="kb-empty">{{ loading ? '加载中...' : '暂无数据源' }}</div>
          </div>
        </section>`
    }).mount(el);
  }

  function mountPipeline() {
    const el = document.getElementById('admin-modelpipeline-vue');
    if (!el || pipelineVm) return;
    pipelineVm = createApp({
      data() {
        return { loading: false, data: null };
      },
      computed: {
        groups() {
          return Object.entries(this.data?.schema || {}).map(([name, stages]) => ({ name, stages }));
        },
        totalStages() {
          return this.groups.reduce((sum, group) => sum + group.stages.length, 0);
        },
        configuredStages() {
          const config = this.data?.config || {};
          const defaults = this.data?.defaults || {};
          return this.groups.flatMap(group => group.stages).filter(stage => (config[stage.id] || []).length || (defaults[stage.id] || []).length).length;
        }
      },
      methods: {
        async refresh(force = false) {
          this.loading = true;
          try {
            this.data = await api.get('/api/admin/pipeline-models', { cache: !force, ttl: 10000 });
          } catch (error) {
            toast(error.message || '模型调用管理加载失败', 'error');
          } finally {
            this.loading = false;
          }
        },
        stageModels(stage) {
          const config = this.data?.config || {};
          const defaults = this.data?.defaults || {};
          const saved = config[stage.id] || [];
          return saved.length ? saved : (defaults[stage.id] || []).map(model => ({ ...model, _isDefault: true }));
        },
        firstModel(stage) {
          return this.stageModels(stage).find(model => model.enabled) || null;
        },
        modelMeta(stage, model) {
          if (!model) return null;
          return (this.data?.available?.[stage.type] || []).find(item => item.provider_id === model.provider_id && item.model_id === model.model_id);
        },
        modelName(stage, model) {
          const meta = this.modelMeta(stage, model);
          return meta?.model_name || model?.model_id || '未配置';
        },
        providerName(stage, model) {
          const meta = this.modelMeta(stage, model);
          return (model?._isDefault ? '系统默认 · ' : '') + (meta?.provider_name || model?.provider_id || '-');
        },
        async openStage(stage) {
          if (typeof legacyLoadModelPipeline === 'function') await legacyLoadModelPipeline();
          if (typeof legacyOpenStageEditModal === 'function') legacyOpenStageEditModal(stage.id, stage.type);
        }
      },
      mounted() { this.refresh(); },
      template: `
        <section class="vue-admin-page">
          <div class="panel-toolbar vue-native-toolbar">
            <span class="panel-title">模型调用管理 <span style="font-size:11px;color:var(--text3);font-weight:400;margin-left:8px">各业务环节使用哪些模型 + 优先级</span></span>
            <button class="btn-sm" @click="refresh(true)" :disabled="loading">{{ loading ? '刷新中...' : '刷新' }}</button>
          </div>
          <div class="vue-pipeline-summary">
            可路由模型环节：已配置 <b>{{ configuredStages }}</b> / {{ totalStages }}
            <span>点击任一环节卡片，继续使用现有弹窗配置模型和优先级</span>
          </div>
          <div v-if="!data" class="kb-empty">{{ loading ? '加载中...' : '暂无配置' }}</div>
          <div v-for="group in groups" :key="group.name" class="vue-pipeline-group">
            <div class="vue-pipeline-group-title">{{ group.name }} <span>{{ group.stages.length }} 个环节</span></div>
            <div class="pms-flow">
              <template v-for="(stage, index) in group.stages" :key="stage.id">
                <div class="pms-flow-stage configured" @click="openStage(stage)">
                  <div class="pms-stage-num">#{{ index + 1 }}</div>
                  <div class="pms-stage-title">{{ stage.name }}</div>
                  <div class="pms-stage-type">{{ stage.type }}</div>
                  <div class="pms-stage-models">
                    <template v-if="firstModel(stage)">
                      <div class="first">{{ modelName(stage, firstModel(stage)) }}</div>
                      <div style="font-size:10px;color:var(--text3);margin-top:2px">{{ providerName(stage, firstModel(stage)) }}</div>
                      <div v-if="stageModels(stage).filter(m=>m.enabled).length > 1" style="font-size:10px;color:var(--text3);margin-top:2px">+{{ stageModels(stage).filter(m=>m.enabled).length - 1 }} 备用</div>
                    </template>
                    <div v-else class="empty">未配置</div>
                  </div>
                  <div class="pms-stage-foot"><span>{{ stageModels(stage).length }} 个模型</span><span class="pms-stage-edit">编辑 →</span></div>
                </div>
                <div v-if="index < group.stages.length - 1" class="pms-flow-arrow">→</div>
              </template>
            </div>
          </div>
        </section>`
    }).mount(el);
  }

  function mountAll() {
    mountDashboard();
    mountCredits();
    mountSystem();
    mountDatasource();
    mountPipeline();
  }

  function refreshDashboard() {
    mountDashboard();
    return dashboardVm?.refresh(true);
  }

  function refreshCredits() {
    mountCredits();
    return creditsVm?.refresh(true);
  }

  function refreshSystem() {
    mountSystem();
    return systemVm?.refresh(true);
  }

  function refreshDatasource() {
    mountDatasource();
    return datasourceVm?.refresh(true);
  }

  function refreshPipeline() {
    mountPipeline();
    return pipelineVm?.refresh(true);
  }

  mountAll();

  window.adminVueBasicModules = { mountAll, refreshDashboard, refreshCredits, refreshSystem, refreshDatasource, refreshPipeline };
  window.loadDashboard = refreshDashboard;
  window.loadCreditsLog = refreshCredits;
  window.loadStats = refreshSystem;
  window.loadDatasources = refreshDatasource;
  window.loadModelPipeline = refreshPipeline;
  window.saveDatasource = (id, silent) => datasourceVm?.save(datasourceVm.providers.find(p => p.id === id), silent);
  window.testDatasource = id => datasourceVm?.test(datasourceVm.providers.find(p => p.id === id));
  window.resetDatasource = id => datasourceVm?.reset(datasourceVm.providers.find(p => p.id === id));

  window.AdminVueModules?.register('dashboard', { load: refreshDashboard });
  window.AdminVueModules?.register('credits', { load: refreshCredits });
  window.AdminVueModules?.register('system', { load: refreshSystem });
  window.AdminVueModules?.register('datasource', { load: refreshDatasource });
  window.AdminVueModules?.register('modelpipeline', { load: refreshPipeline });
})();
