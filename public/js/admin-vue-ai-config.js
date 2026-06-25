(() => {
  if (!window.Vue || !window.AdminVueApi) return;

  const { createApp } = window.Vue;
  const api = window.AdminVueApi;
  let vm = null;

  const notify = (message, type = 'success') => {
    if (typeof toast === 'function') toast(message, type);
    else if (type === 'error') alert(message);
  };

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function mountAIConfig() {
    const el = document.getElementById('admin-ai-vue');
    if (!el || vm) return;

    vm = createApp({
      data() {
        return {
          tab: 'providers',
          loading: false,
          settings: { providers: [], mcps: [], skills: [] },
          presets: [],
          expandedProviders: {},
          modal: '',
          editingId: '',
          provider: { id: '', name: '', api_url: '', api_key: '' },
          providerEdit: { api_url: '', api_key: '' },
          model: { providerId: '', id: '', name: '', type: 'chat', use: 'story' },
          mcp: { name: '', url: '', description: '' },
          skill: { name: '', emoji: '', type: '文本', endpoint: '', description: '' }
        };
      },
      computed: {
        availablePresets() {
          const existing = new Set((this.settings.providers || []).map(provider => provider.id));
          return this.presets.filter(preset => !existing.has(preset.id));
        },
        activePreset() {
          return this.presets.find(preset => preset.id === this.provider.id);
        }
      },
      methods: {
        async refresh(force = false) {
          this.loading = true;
          try {
            const [settings, presets] = await Promise.all([
              api.get('/api/settings', { cache: !force, ttl: 8000 }),
              api.get('/api/settings/presets', { cache: !force, ttl: 30000 })
            ]);
            this.settings = settings || { providers: [], mcps: [], skills: [] };
            this.presets = list(presets);
          } catch (error) {
            notify('加载 AI 配置失败: ' + (error.message || error), 'error');
          } finally {
            this.loading = false;
          }
        },
        switchTab(tab) {
          this.tab = tab;
        },
        applyPreset(preset) {
          this.provider.id = preset.id || '';
          this.provider.name = preset.name || '';
          this.provider.api_url = preset.api_url || '';
        },
        openProvider() {
          this.modal = 'provider';
          this.provider = { id: '', name: '', api_url: '', api_key: '' };
        },
        isProviderExpanded(id) {
          return !!this.expandedProviders[id];
        },
        toggleProviderExpand(id) {
          this.expandedProviders = { ...this.expandedProviders, [id]: !this.isProviderExpanded(id) };
        },
        openProviderEdit(provider) {
          this.modal = 'providerEdit';
          this.editingId = provider.id;
          this.providerEdit = { api_url: provider.api_url || '', api_key: '' };
        },
        openModel(providerId) {
          this.modal = 'model';
          this.model = { providerId, id: '', name: '', type: 'chat', use: 'story' };
        },
        openMCP() {
          this.modal = 'mcp';
          this.mcp = { name: '', url: '', description: '' };
        },
        openSkill() {
          this.modal = 'skill';
          this.skill = { name: '', emoji: '', type: '文本', endpoint: '', description: '' };
        },
        close() {
          this.modal = '';
          this.editingId = '';
        },
        async saveProvider() {
          if (!this.provider.name || !this.provider.api_url) return notify('请填写供应商名称和 API 地址', 'error');
          try {
            await api.post('/api/settings/providers', {
              id: this.provider.id || undefined,
              name: this.provider.name,
              api_url: this.provider.api_url,
              api_key: this.provider.api_key,
              models: this.activePreset?.defaultModels || []
            });
            this.close();
            await this.refresh(true);
            notify('供应商已添加');
          } catch (error) {
            notify('添加失败: ' + (error.message || error), 'error');
          }
        },
        async saveProviderEdit() {
          const body = {};
          if (this.providerEdit.api_url) body.api_url = this.providerEdit.api_url;
          if (this.providerEdit.api_key) body.api_key = this.providerEdit.api_key;
          try {
            await api.put(`/api/settings/providers/${encodeURIComponent(this.editingId)}`, body);
            this.close();
            await this.refresh(true);
            notify('已保存');
          } catch (error) {
            notify('保存失败: ' + (error.message || error), 'error');
          }
        },
        async toggleProvider(provider, enabled) {
          try {
            await api.put(`/api/settings/providers/${encodeURIComponent(provider.id)}/toggle`, { enabled });
            provider.enabled = enabled;
            await this.refresh(true);
            notify(enabled ? '已启用' : '已禁用');
          } catch (error) {
            notify('切换失败: ' + (error.message || error), 'error');
            await this.refresh(true);
          }
        },
        async testProvider(id) {
          try {
            await api.post(`/api/settings/providers/${encodeURIComponent(id)}/test`, {}, { cache: false });
            await this.refresh(true);
            notify('测试完成');
          } catch (error) {
            notify('测试失败: ' + (error.message || error), 'error');
          }
        },
        async refreshAll() {
          try {
            await api.post('/api/settings/providers/refresh-all', {}, { cache: false });
            await this.refresh(true);
            notify('刷新完成');
          } catch (error) {
            notify('刷新失败: ' + (error.message || error), 'error');
          }
        },
        async deleteProvider(id) {
          if (!confirm('确认删除该供应商？')) return;
          try {
            await api.delete(`/api/settings/providers/${encodeURIComponent(id)}`);
            await this.refresh(true);
            notify('已删除');
          } catch (error) {
            notify('删除失败: ' + (error.message || error), 'error');
          }
        },
        async saveModel() {
          if (!this.model.id || !this.model.name) return notify('请填写模型 ID 和名称', 'error');
          try {
            await api.post(`/api/settings/providers/${encodeURIComponent(this.model.providerId)}/models`, {
              id: this.model.id,
              name: this.model.name,
              type: this.model.type,
              use: this.model.use
            });
            this.close();
            await this.refresh(true);
            notify('模型已添加');
          } catch (error) {
            notify('添加失败: ' + (error.message || error), 'error');
          }
        },
        async deleteModel(providerId, modelId) {
          if (!confirm('确认删除该模型？')) return;
          try {
            await api.delete(`/api/settings/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`);
            await this.refresh(true);
            notify('已删除');
          } catch (error) {
            notify('删除失败: ' + (error.message || error), 'error');
          }
        },
        async saveMCP() {
          if (!this.mcp.name || !this.mcp.url) return notify('请填写名称和 URL', 'error');
          try {
            await api.post('/api/settings/mcps', this.mcp);
            this.close();
            await this.refresh(true);
            this.tab = 'mcps';
            notify('MCP 已添加');
          } catch (error) {
            notify('添加失败: ' + (error.message || error), 'error');
          }
        },
        async deleteMCP(id) {
          if (!confirm('确认删除该 MCP 连接器？')) return;
          try {
            await api.delete(`/api/settings/mcps/${encodeURIComponent(id)}`);
            await this.refresh(true);
            notify('已删除');
          } catch (error) {
            notify('删除失败: ' + (error.message || error), 'error');
          }
        },
        async saveSkill() {
          if (!this.skill.name) return notify('请填写 Skill 名称', 'error');
          try {
            await api.post('/api/settings/skills', this.skill);
            this.close();
            await this.refresh(true);
            this.tab = 'skills';
            notify('Skill 已创建');
          } catch (error) {
            notify('创建失败: ' + (error.message || error), 'error');
          }
        },
        async deleteSkill(id) {
          if (!confirm('确认删除该 Skill？')) return;
          try {
            await api.delete(`/api/settings/skills/${encodeURIComponent(id)}`);
            await this.refresh(true);
            notify('已删除');
          } catch (error) {
            notify('删除失败: ' + (error.message || error), 'error');
          }
        }
      },
      mounted() {
        this.refresh();
      },
      template: `
        <section class="vue-admin-page vue-ai-config-page">
          <div class="panel-toolbar vue-native-toolbar">
            <span class="panel-title">AI 配置</span>
            <span class="ai-refresh-indicator" v-if="loading">加载中...</span>
          </div>
          <div class="ai-sub-tabs">
            <button class="ai-sub-tab" :class="{active:tab==='providers'}" @click="switchTab('providers')">供应商</button>
            <button class="ai-sub-tab" :class="{active:tab==='mcps'}" @click="switchTab('mcps')">MCP 连接器</button>
            <button class="ai-sub-tab" :class="{active:tab==='skills'}" @click="switchTab('skills')">Skills</button>
          </div>
          <div v-if="tab==='providers'">
            <div class="ai-pane-toolbar">
              <button class="btn-sm accent" @click="refreshAll">刷新状态</button>
              <button class="btn-primary" @click="openProvider">+ 添加供应商</button>
            </div>
            <div v-if="!settings.providers.length" class="sp-empty-state"><p>还没有供应商</p></div>
            <div class="sp-provider-row" v-for="provider in settings.providers" :key="provider.id">
              <div class="sp-prov-main" :class="{expanded:isProviderExpanded(provider.id)}" @click="toggleProviderExpand(provider.id)">
                <div class="sp-prov-info">
                  <div class="sp-prov-name-line">
                    <span class="sp-expand-icon">{{ isProviderExpanded(provider.id) ? '▾' : '▸' }}</span>
                    <span class="sp-prov-name">{{ provider.name }}</span>
                    <span class="sp-status-badge" :class="provider.enabled ? 'active' : 'inactive'">{{ provider.enabled ? '启用' : '未启用' }}</span>
                  </div>
                  <div class="sp-prov-meta"><span class="sp-prov-tag">{{ String(provider.id).toUpperCase() }}</span></div>
                </div>
                <div class="sp-prov-url" :title="provider.api_url">{{ provider.api_url }}</div>
                <div class="sp-prov-key">{{ provider.api_key_masked || '未配置' }}</div>
                <div class="sp-prov-model-count"><span class="sp-cnt-num">{{ (provider.models || []).length }}</span><span class="sp-cnt-label">模型</span></div>
                <div class="sp-prov-actions">
                  <label class="sp-toggle" @click.stop><input type="checkbox" :checked="provider.enabled" @change="toggleProvider(provider, $event.target.checked)"><span class="sp-toggle-slider"></span></label>
                  <button class="sp-btn" @click.stop="openProviderEdit(provider)">编辑</button>
                  <button class="sp-btn" @click.stop="testProvider(provider.id)" :disabled="!provider.enabled">测试</button>
                  <button class="sp-btn danger" @click.stop="deleteProvider(provider.id)">删除</button>
                </div>
              </div>
              <div class="sp-error-bar" v-if="provider.test_error">{{ provider.test_error }}</div>
              <div class="sp-models-sub" v-show="isProviderExpanded(provider.id)">
                <div class="sp-models-sub-head"><span>{{ (provider.models || []).length }} 个模型</span><button class="sp-btn primary-btn" @click="openModel(provider.id)">+ 添加模型</button></div>
                <div class="sp-model-row" v-for="model in provider.models || []" :key="model.id">
                  <span class="sp-model-name">{{ model.name }}</span>
                  <span class="sp-model-id">{{ model.id }}</span>
                  <span class="sp-model-type">{{ model.type }}</span>
                  <span class="sp-model-use">{{ model.use }}</span>
                  <button class="sp-model-del" @click="deleteModel(provider.id, model.id)">×</button>
                </div>
              </div>
            </div>
          </div>
          <div v-if="tab==='mcps'">
            <div class="ai-pane-toolbar"><button class="btn-primary" @click="openMCP">+ 添加连接器</button></div>
            <div v-if="!settings.mcps.length" class="sp-empty-state"><p>还没有 MCP 连接器</p></div>
            <div class="sp-card" v-for="item in settings.mcps" :key="item.id">
              <div class="sp-card-head"><div class="sp-card-icon">M</div><div class="sp-card-info"><div class="sp-card-name">{{ item.name }}</div><div class="sp-card-desc">{{ item.description }}</div><div class="sp-card-url">{{ item.url }}</div></div></div>
              <div class="sp-card-actions"><button class="sp-card-del" @click="deleteMCP(item.id)">删除</button></div>
            </div>
          </div>
          <div v-if="tab==='skills'">
            <div class="ai-pane-toolbar"><button class="btn-primary" @click="openSkill">+ 新建 Skill</button></div>
            <div v-if="!settings.skills.length" class="sp-empty-state"><p>还没有 Skill</p></div>
            <div class="sp-card" v-for="item in settings.skills" :key="item.id">
              <div class="sp-card-head"><div class="sp-card-icon">{{ item.emoji || 'S' }}</div><div class="sp-card-info"><div class="sp-card-name">{{ item.name }}</div><div class="sp-card-desc">{{ item.description }}</div></div></div>
              <div class="sp-card-meta"><span class="sp-card-type">{{ item.type }}</span></div>
              <div class="sp-card-actions"><button class="sp-card-del" @click="deleteSkill(item.id)">删除</button></div>
            </div>
          </div>
          <div v-if="modal" class="modal-overlay show" @click.self="close">
            <div class="modal-box vue-ai-modal">
              <template v-if="modal==='provider'">
                <div class="form-title">添加供应商</div>
                <div class="ai-preset-row" v-if="availablePresets.length"><button v-for="preset in availablePresets" :key="preset.id" @click="applyPreset(preset)" :class="{active:provider.id===preset.id}">{{ preset.name || preset.id }}</button></div>
                <div class="ai-preset-empty" v-else>常用预设都已添加，可直接填写自定义供应商。</div>
                <div class="form-row"><div class="form-group"><label>供应商名称</label><input v-model="provider.name" autocomplete="off"></div><div class="form-group"><label>ID</label><input v-model="provider.id" autocomplete="off"></div></div>
                <div class="form-group"><label>API 地址</label><input v-model="provider.api_url" autocomplete="off"></div>
                <div class="form-group"><label>API Key</label><input type="password" v-model="provider.api_key" autocomplete="new-password"></div>
                <div class="form-actions"><button class="btn-primary" @click="saveProvider">添加</button><button class="btn-sm" @click="close">取消</button></div>
              </template>
              <template v-if="modal==='providerEdit'">
                <div class="form-title">编辑供应商</div>
                <div class="form-group"><label>API 地址</label><input v-model="providerEdit.api_url"></div>
                <div class="form-group"><label>API Key</label><input type="password" v-model="providerEdit.api_key" placeholder="留空不修改"></div>
                <div class="form-actions"><button class="btn-primary" @click="saveProviderEdit">保存</button><button class="btn-sm" @click="close">取消</button></div>
              </template>
              <template v-if="modal==='model'">
                <div class="form-title">添加模型</div>
                <div class="form-row"><div class="form-group"><label>模型 ID</label><input v-model="model.id"></div><div class="form-group"><label>显示名称</label><input v-model="model.name"></div></div>
                <div class="form-row"><div class="form-group"><label>类型</label><select v-model="model.type"><option>chat</option><option>image</option><option>video</option><option>tts</option><option>embedding</option></select></div><div class="form-group"><label>用途</label><select v-model="model.use"><option value="story">剧情生成</option><option value="image">图像生成</option><option value="video">视频生成</option><option value="tts">语音合成</option><option value="avatar">数字人</option></select></div></div>
                <div class="form-actions"><button class="btn-primary" @click="saveModel">添加</button><button class="btn-sm" @click="close">取消</button></div>
              </template>
              <template v-if="modal==='mcp'">
                <div class="form-title">添加 MCP 连接器</div>
                <div class="form-group"><label>名称</label><input v-model="mcp.name"></div><div class="form-group"><label>服务 URL</label><input v-model="mcp.url"></div><div class="form-group"><label>描述</label><input v-model="mcp.description"></div>
                <div class="form-actions"><button class="btn-primary" @click="saveMCP">添加</button><button class="btn-sm" @click="close">取消</button></div>
              </template>
              <template v-if="modal==='skill'">
                <div class="form-title">新建 Skill</div>
                <div class="form-row"><div class="form-group"><label>名称</label><input v-model="skill.name"></div><div class="form-group"><label>图标</label><input v-model="skill.emoji"></div></div>
                <div class="form-row"><div class="form-group"><label>分类</label><select v-model="skill.type"><option>图像</option><option>文本</option><option>视频</option><option>语音</option><option>通用</option></select></div><div class="form-group"><label>接口地址</label><input v-model="skill.endpoint"></div></div>
                <div class="form-group"><label>描述</label><textarea v-model="skill.description" rows="3"></textarea></div>
                <div class="form-actions"><button class="btn-primary" @click="saveSkill">创建</button><button class="btn-sm" @click="close">取消</button></div>
              </template>
            </div>
          </div>
        </section>
      `
    }).mount(el);
  }

  window.switchAITab = tab => { mountAIConfig(); return vm?.switchTab(tab); };
  window.loadProviders = (force = false) => { mountAIConfig(); return vm?.refresh(!!force); };
  window.showAddProvider = () => { mountAIConfig(); return vm?.openProvider(); };
  window.closeProviderModal = () => vm?.close();
  window.saveProvider = () => vm?.saveProvider();
  window.editProviderKey = id => {
    mountAIConfig();
    const provider = vm?.settings.providers.find(item => item.id === id);
    if (provider) return vm.openProviderEdit(provider);
  };
  window.closeApiKeyModal = () => vm?.close();
  window.saveProviderEdit = () => vm?.saveProviderEdit();
  window.toggleProvider = (id, enabled) => {
    mountAIConfig();
    const provider = vm?.settings.providers.find(item => item.id === id);
    if (provider) return vm.toggleProvider(provider, enabled);
  };
  window.testProvider = id => { mountAIConfig(); return vm?.testProvider(id); };
  window.refreshAllProviders = () => { mountAIConfig(); return vm?.refreshAll(); };
  window.showAddModel = id => { mountAIConfig(); return vm?.openModel(id); };
  window.closeModelModal = () => vm?.close();
  window.saveModel = () => vm?.saveModel();
  window.deleteModel = (providerId, modelId) => { mountAIConfig(); return vm?.deleteModel(providerId, modelId); };
  window.showAddMCP = () => { mountAIConfig(); return vm?.openMCP(); };
  window.closeMCPModal = () => vm?.close();
  window.saveMCP = () => vm?.saveMCP();
  window.deleteMCP = id => { mountAIConfig(); return vm?.deleteMCP(id); };
  window.showAddSkill = () => { mountAIConfig(); return vm?.openSkill(); };
  window.closeSkillModal = () => vm?.close();
  window.saveSkill = () => vm?.saveSkill();
  window.deleteSkill = id => { mountAIConfig(); return vm?.deleteSkill(id); };

  document.addEventListener('DOMContentLoaded', mountAIConfig);
})();
