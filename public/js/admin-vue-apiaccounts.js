(() => {
  if (!window.Vue || !window.AdminVueApi) return;
  const { createApp } = window.Vue;
  const api = window.AdminVueApi;

  let vm = null;

  function masked(value) {
    return value || '••••••';
  }

  function mountApiAccounts() {
    const el = document.getElementById('admin-apiaccounts-vue');
    if (!el || vm) return;
    vm = createApp({
      data() {
        return {
          loading: false,
          accounts: [],
          modelCatalog: [],
          showModal: false,
          editing: null,
          secretBox: null,
          form: this.emptyForm()
        };
      },
      computed: {
        allModelKeys() {
          return this.modelCatalog.flatMap(group => (group.items || []).map(item => item.key));
        },
        allSelected() {
          return this.form.allowed_models.includes('*') || (this.allModelKeys.length > 0 && this.allModelKeys.every(key => this.form.allowed_models.includes(key)));
        }
      },
      methods: {
        emptyForm() {
          return { name: '', remark: '', status: 'active', credits: 0, allowed_apis: ['*'], allowed_models: [] };
        },
        async refresh(force = false) {
          this.loading = true;
          try {
            const rows = await api.get('/api/admin/api-accounts', { cache: !force, ttl: 8000 });
            this.accounts = Array.isArray(rows) ? rows : [];
          } catch (error) {
            toast(error.message || '接口账号加载失败', 'error');
          } finally {
            this.loading = false;
          }
        },
        async ensureModelCatalog() {
          if (this.modelCatalog.length) return this.modelCatalog;
          this.modelCatalog = await api.get('/api/admin/api-accounts/model-catalog', { cache: true, ttl: 20000 });
          return this.modelCatalog;
        },
        async openModal(account = null) {
          await this.ensureModelCatalog();
          this.editing = account;
          this.secretBox = null;
          this.form = account
            ? { name: account.name || '', remark: account.remark || '', status: account.status || 'active', credits: account.credits || 0, allowed_apis: account.allowed_apis || ['*'], allowed_models: account.allowed_models || [] }
            : this.emptyForm();
          this.showModal = true;
        },
        closeModal() {
          this.showModal = false;
          this.editing = null;
        },
        modelCount(account) {
          const list = account.allowed_models || [];
          return list.includes('*') ? '全部模型' : `${list.length} 个模型`;
        },
        toggleAllModels(checked) {
          this.form.allowed_models = checked ? ['*'] : [];
        },
        groupChecked(group) {
          if (this.form.allowed_models.includes('*')) return true;
          return (group.items || []).every(item => this.form.allowed_models.includes(item.key));
        },
        toggleGroup(group, checked) {
          if (this.form.allowed_models.includes('*')) this.form.allowed_models = this.allModelKeys.slice();
          const set = new Set(this.form.allowed_models);
          (group.items || []).forEach(item => checked ? set.add(item.key) : set.delete(item.key));
          this.form.allowed_models = [...set];
        },
        modelChecked(key) {
          return this.form.allowed_models.includes('*') || this.form.allowed_models.includes(key);
        },
        toggleModel(key, checked) {
          if (this.form.allowed_models.includes('*')) this.form.allowed_models = this.allModelKeys.slice();
          const set = new Set(this.form.allowed_models);
          checked ? set.add(key) : set.delete(key);
          this.form.allowed_models = [...set];
        },
        async save() {
          if (!this.form.name.trim()) return toast('请填写账号名称', 'error');
          const body = {
            name: this.form.name.trim(),
            remark: this.form.remark.trim(),
            status: this.form.status,
            credits: Number(this.form.credits || 0),
            allowed_apis: ['*'],
            allowed_models: this.allSelected ? ['*'] : this.form.allowed_models
          };
          try {
            if (this.editing?.id && !this.secretBox) {
              await api.put('/api/admin/api-accounts/' + this.editing.id, body);
              toast('已保存');
              this.closeModal();
            } else {
              const created = await api.post('/api/admin/api-accounts', body);
              this.secretBox = created;
              this.editing = { ...created, _justCreated: true };
              toast('接口账号已创建，请保存 AppKey');
            }
            await this.refresh(true);
          } catch (error) {
            toast(error.message || '保存失败', 'error');
          }
        },
        async edit(id) {
          try {
            const account = await api.get('/api/admin/api-accounts/' + id, { cache: false });
            await this.openModal(account);
          } catch (error) {
            toast(error.message || '加载失败', 'error');
          }
        },
        async rotate(id) {
          if (!confirm('确定重置 AppKey？重置后旧密钥立即失效。')) return;
          try {
            const data = await api.post('/api/admin/api-accounts/' + id + '/rotate-secret', {});
            alert('新 AppKey：\n\n' + data.app_secret + '\n\n请立即保存，仅此一次显示。');
            await this.refresh(true);
          } catch (error) {
            toast(error.message || '重置失败', 'error');
          }
        },
        async remove(id, name) {
          if (!confirm('确定删除接口账号 "' + name + '"？')) return;
          try {
            await api.delete('/api/admin/api-accounts/' + id);
            toast('已删除');
            await this.refresh(true);
          } catch (error) {
            toast(error.message || '删除失败', 'error');
          }
        },
        copySecret() {
          const secret = this.secretBox?.app_secret || '';
          if (!secret) return;
          navigator.clipboard?.writeText(secret).then(() => toast('已复制'));
        },
        masked,
        date(value) { return value ? new Date(value).toLocaleString('zh-CN') : '-'; }
      },
      mounted() { this.refresh(); },
      template: `
        <section class="vue-admin-page">
          <div class="panel-toolbar vue-native-toolbar">
            <span class="panel-title">接口账号（AppID / AppKey 对接）</span>
            <div class="vue-native-actions">
              <a class="btn-sm" href="/api-docs.html" target="_blank">查看接口文档</a>
              <button class="btn-primary" @click="openModal()">+ 新建接口账号</button>
            </div>
          </div>
          <table class="data-table">
            <thead><tr><th>名称</th><th>AppID</th><th>AppSecret</th><th>可调模型</th><th>状态</th><th>调用次数</th><th>最后使用</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="account in accounts" :key="account.id">
                <td><b>{{ account.name }}</b><div style="font-size:10px;color:var(--text3)">{{ account.remark || '' }}</div></td>
                <td><code style="font-size:11px">{{ account.app_id }}</code></td>
                <td><code style="font-size:11px;color:var(--text3)">{{ masked(account.app_secret_masked) }}</code><button class="btn-sm" style="margin-left:6px;padding:2px 8px;font-size:10px" @click="rotate(account.id)">重置</button></td>
                <td><span :style="{color:(account.allowed_models || []).includes('*') ? 'var(--accent)' : 'var(--text2)'}">{{ modelCount(account) }}</span></td>
                <td><span class="pill" :class="account.status === 'active' ? 'pill-ok' : 'pill-muted'">{{ account.status === 'active' ? '启用' : '停用' }}</span></td>
                <td>{{ account.call_count || 0 }}</td>
                <td style="font-size:11px;color:var(--text3)">{{ date(account.last_used_at) }}</td>
                <td><button class="btn-sm" @click="edit(account.id)">编辑</button><button class="btn-sm btn-danger" @click="remove(account.id, account.name)">删除</button></td>
              </tr>
              <tr v-if="!accounts.length"><td colspan="8" class="empty-state">{{ loading ? '加载中...' : '暂无接口账号' }}</td></tr>
            </tbody>
          </table>
          <div class="vue-modal-mask" v-if="showModal" @click.self="closeModal">
            <div class="vue-modal api-account-modal">
              <div class="vue-modal-head"><b>{{ editing?.id && !secretBox ? '编辑接口账号' : '新建接口账号' }}</b><button @click="closeModal">×</button></div>
              <div class="vue-form-grid">
                <label class="required"><span>账号名称</span><input v-model.trim="form.name" placeholder="合作方 / 内部系统" /></label>
                <label><span>状态</span><select v-model="form.status"><option value="active">启用</option><option value="disabled">停用</option></select></label>
                <label><span>配额积分</span><input type="number" v-model.number="form.credits" min="0" /></label>
                <label class="wide"><span>备注</span><input v-model.trim="form.remark" placeholder="用途说明" /></label>
                <div class="wide api-secret-box" v-if="secretBox">
                  <div>请立即保存以下密钥（只显示一次）</div>
                  <p><b>AppID：</b><code>{{ secretBox.app_id }}</code></p>
                  <p><b>AppKey：</b><code>{{ secretBox.app_secret }}</code></p>
                  <button class="btn-sm" @click="copySecret">复制 AppKey</button>
                </div>
                <div class="wide api-model-auth">
                  <div class="api-model-head"><span>可调用 AI 模型</span><label><input type="checkbox" :checked="allSelected" @change="toggleAllModels($event.target.checked)" /> 全选</label></div>
                  <section v-for="group in modelCatalog" :key="group.provider_id">
                    <h4><label><input type="checkbox" :checked="groupChecked(group)" @change="toggleGroup(group, $event.target.checked)" />{{ group.provider_name }} <span>({{ group.items.length }})</span></label></h4>
                    <div class="api-model-grid">
                      <label v-for="item in group.items" :key="item.key"><input type="checkbox" :checked="modelChecked(item.key)" @change="toggleModel(item.key, $event.target.checked)" /><b>{{ item.label }}</b><small>{{ item.model_id }}</small></label>
                    </div>
                  </section>
                </div>
              </div>
              <div class="vue-modal-foot"><button class="vue-btn" @click="closeModal">关闭</button><button class="vue-btn primary" @click="save">保存</button></div>
            </div>
          </div>
        </section>`
    }).mount(el);
  }

  mountApiAccounts();

  window.adminVueApiAccounts = { mountApiAccounts, refresh: () => vm?.refresh(true), open: account => vm?.openModal(account) };
  window.loadApiAccounts = () => { mountApiAccounts(); return vm?.refresh(true); };
  window.openApiAcctModal = account => { mountApiAccounts(); return vm?.openModal(account || null); };
  window.closeApiAcctModal = () => vm?.closeModal();
  window.saveApiAcct = () => vm?.save();
  window.editApiAcct = id => vm?.edit(id);
  window.rotateApiSecret = id => vm?.rotate(id);
  window.deleteApiAcct = (id, name) => vm?.remove(id, name);
  window.copyApaSecret = () => vm?.copySecret();
  window.apaToggleAllApis = () => {};
  window.apaToggleGroup = () => {};
  window.AdminVueModules?.register('apiaccounts', { load: window.loadApiAccounts });
})();
