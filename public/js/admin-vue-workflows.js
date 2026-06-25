(() => {
  if (!window.Vue) return;

  const { createApp } = window.Vue;
  const api = window.AdminVueApi;

  function token() {
    try {
      return (
        localStorage.getItem('vido_token') ||
        localStorage.getItem('vido-token') ||
        sessionStorage.getItem('vido_token') ||
        localStorage.getItem('token') ||
        ''
      );
    } catch {
      return '';
    }
  }

  async function request(url, options = {}) {
    if (api?.request) return api.request(url, options);
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        Authorization: `Bearer ${token()}`,
      },
    });
    const data = await res.json().catch(() => ({ success: false, error: '返回不是 JSON' }));
    if (!data?.success) throw new Error(data?.error || `${res.status} ${res.statusText}`);
    return data;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value || null));
  }

  function toast(message, ok = true) {
    if (typeof showToast === 'function') return showToast(message, ok ? 'success' : 'error');
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = `position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:99999;min-width:160px;max-width:min(520px,calc(100vw - 32px));padding:10px 16px;border-radius:8px;font-size:13px;color:#fff;text-align:center;background:${ok ? '#16a34a' : '#dc2626'};box-shadow:0 6px 20px rgba(0,0,0,.24);`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  let vm = null;

  const appDef = {
    data() {
      return {
        loading: false,
        saving: false,
        running: false,
        workflows: [],
        capabilities: [],
        currentId: '',
        currentWorkflow: null,
        isEditing: false,
        jsonText: '',
        formInputs: {},
        runHistory: [],
        runResult: null,
        modalOpen: false,
        modalTitle: '',
        modalMode: '',
      };
    },
    computed: {
      builtinWorkflows() {
        return this.workflows.filter((item) => item.builtin);
      },
      userWorkflows() {
        return this.workflows.filter((item) => !item.builtin);
      },
      isBuiltinCurrent() {
        return !!(this.currentWorkflow && (this.currentWorkflow._builtin || this.currentWorkflow.builtin));
      },
    },
    mounted() {
      this.refreshAll();
    },
    methods: {
      async refreshAll() {
        this.loading = true;
        try {
          const [wfs, caps] = await Promise.all([
            request('/api/workflows'),
            request('/api/workflows/capabilities'),
          ]);
          this.workflows = wfs.workflows || [];
          this.capabilities = caps.capabilities || [];
          if (this.currentId) {
            const exists = this.workflows.some((item) => item.id === this.currentId);
            if (exists) await this.openWorkflow(this.currentId, { keepResult: true });
            else this.clearCurrent();
          }
        } catch (error) {
          toast(`加载工作流失败：${error.message}`, false);
        } finally {
          this.loading = false;
        }
      },
      clearCurrent() {
        this.currentId = '';
        this.currentWorkflow = null;
        this.isEditing = false;
        this.jsonText = '';
        this.formInputs = {};
        this.runHistory = [];
        this.runResult = null;
      },
      async openWorkflow(id, options = {}) {
        if (!id) return;
        try {
          const data = await request(`/api/workflows/${encodeURIComponent(id)}`);
          this.currentId = id;
          this.currentWorkflow = data.workflow;
          this.isEditing = false;
          this.jsonText = JSON.stringify(data.workflow, null, 2);
          this.formInputs = this.buildDefaultInputs(data.workflow);
          if (!options.keepResult) this.runResult = null;
          await this.refreshRuns();
        } catch (error) {
          toast(`加载工作流详情失败：${error.message}`, false);
        }
      },
      buildDefaultInputs(workflow) {
        const values = {};
        (workflow?.inputs || []).forEach((input) => {
          if (input.default != null) values[input.name] = Array.isArray(input.default) ? input.default.join('\n') : input.default;
          else values[input.name] = input.type === 'number' ? '' : '';
        });
        return values;
      },
      toggleEdit() {
        if (this.isBuiltinCurrent && !this.isEditing) {
          toast('内置工作流不能直接编辑，请先克隆为自定义工作流', false);
          return;
        }
        this.isEditing = !this.isEditing;
        if (this.currentWorkflow) this.jsonText = JSON.stringify(this.currentWorkflow, null, 2);
      },
      formatJson() {
        try {
          this.jsonText = JSON.stringify(JSON.parse(this.jsonText), null, 2);
        } catch (error) {
          toast(`JSON 格式错误：${error.message}`, false);
        }
      },
      async saveJson() {
        let parsed;
        try {
          parsed = JSON.parse(this.jsonText);
        } catch (error) {
          toast(`JSON 格式错误：${error.message}`, false);
          return;
        }
        if (!parsed.id) return toast('JSON 必须包含 id', false);
        if (!parsed.name) return toast('JSON 必须包含 name', false);

        this.saving = true;
        try {
          const data = await request(`/api/workflows/${encodeURIComponent(parsed.id)}`, {
            method: 'PUT',
            body: JSON.stringify(parsed),
          });
          api?.clearCache?.('/api/workflows');
          toast('工作流已保存');
          this.currentWorkflow = data.workflow || parsed;
          this.currentId = parsed.id;
          this.isEditing = false;
          await this.refreshAll();
          await this.openWorkflow(parsed.id);
        } catch (error) {
          toast(`保存失败：${error.message}`, false);
        } finally {
          this.saving = false;
        }
      },
      newWorkflow() {
        const tpl = {
          id: `my-workflow-${Date.now()}`,
          name: '我的工作流',
          category: 'custom',
          version: 1,
          description: '描述这个工作流的用途',
          inputs: [
            { name: 'imageUrl', type: 'string', required: true, label: '输入图片 URL' },
          ],
          steps: [
            { id: 'step1', type: 'cutout', params: { imageUrl: '$imageUrl' } },
          ],
          outputs: [
            { name: 'result', from: '$step1.imageUrl', type: 'string' },
          ],
        };
        this.currentId = tpl.id;
        this.currentWorkflow = tpl;
        this.jsonText = JSON.stringify(tpl, null, 2);
        this.formInputs = this.buildDefaultInputs(tpl);
        this.runHistory = [];
        this.runResult = null;
        this.isEditing = true;
      },
      cloneWorkflow() {
        if (!this.currentWorkflow) return;
        const cloned = clone(this.currentWorkflow);
        cloned.id = `${cloned.id}-copy-${Date.now()}`;
        cloned.name = `${cloned.name || '工作流'} (副本)`;
        delete cloned._builtin;
        delete cloned._file;
        this.currentId = cloned.id;
        this.currentWorkflow = cloned;
        this.jsonText = JSON.stringify(cloned, null, 2);
        this.formInputs = this.buildDefaultInputs(cloned);
        this.runHistory = [];
        this.runResult = null;
        this.isEditing = true;
        toast('已生成副本，请保存后生效');
      },
      async deleteWorkflow() {
        if (!this.currentWorkflow) return;
        if (this.isBuiltinCurrent) return toast('内置工作流不能删除', false);
        if (!confirm(`确定删除工作流“${this.currentWorkflow.name}”？`)) return;
        try {
          await request(`/api/workflows/${encodeURIComponent(this.currentWorkflow.id)}`, { method: 'DELETE' });
          api?.clearCache?.('/api/workflows');
          toast('工作流已删除');
          this.clearCurrent();
          await this.refreshAll();
        } catch (error) {
          toast(`删除失败：${error.message}`, false);
        }
      },
      valueForInput(input) {
        let value = this.formInputs[input.name];
        if (input.type === 'number') value = value === '' || value == null ? null : Number(value);
        else if (input.type === 'array') value = String(value || '').split('\n').map((item) => item.trim()).filter(Boolean);
        else if (input.type === 'object') {
          try {
            value = value ? JSON.parse(value) : null;
          } catch {
            throw new Error(`输入 ${input.name} 不是合法 JSON`);
          }
        }
        if (input.required && (value == null || value === '' || (Array.isArray(value) && value.length === 0))) {
          throw new Error(`必填：${input.label || input.name}`);
        }
        return value;
      },
      async runWorkflow() {
        if (!this.currentWorkflow || this.running) return;
        const inputs = {};
        try {
          (this.currentWorkflow.inputs || []).forEach((input) => {
            inputs[input.name] = this.valueForInput(input);
          });
        } catch (error) {
          toast(error.message, false);
          return;
        }

        this.running = true;
        this.runResult = { status: 'running' };
        try {
          const data = await request(`/api/workflows/${encodeURIComponent(this.currentWorkflow.id)}/run`, {
            method: 'POST',
            body: JSON.stringify({ inputs }),
          });
          this.runResult = data.run;
          await this.refreshRuns();
        } catch (error) {
          this.runResult = { status: 'failed', error: error.message, durationMs: 0, stepLogs: [] };
        } finally {
          this.running = false;
        }
      },
      async refreshRuns() {
        if (!this.currentId) return;
        try {
          const data = await request(`/api/workflows/${encodeURIComponent(this.currentId)}/runs?limit=20`);
          this.runHistory = data.runs || [];
        } catch (error) {
          console.warn(error);
        }
      },
      async openRun(runId) {
        try {
          const data = await request(`/api/workflows/runs/${encodeURIComponent(runId)}`);
          this.runResult = data.run;
          this.$nextTick(() => document.getElementById('wf-run-result-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        } catch (error) {
          toast(`打开运行记录失败：${error.message}`, false);
        }
      },
      showCapabilities() {
        this.modalTitle = `节点能力清单 (${this.capabilities.length})`;
        this.modalMode = 'capabilities';
        this.modalOpen = true;
      },
      closeModal() {
        this.modalOpen = false;
      },
      stepParams(step) {
        const raw = JSON.stringify(step.params || {});
        return raw.length > 100 ? `${raw.slice(0, 100)}...` : raw;
      },
      outputValue(value) {
        if (value == null) return '';
        if (typeof value === 'object') return JSON.stringify(value, null, 2);
        return String(value);
      },
      isImage(value) {
        return typeof value === 'string' && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(value);
      },
      isVideo(value) {
        return typeof value === 'string' && /\.(mp4|webm|mov)(\?|$)/i.test(value);
      },
      isUrl(value) {
        return typeof value === 'string' && /^https?:\/\//i.test(value);
      },
      isImageArray(value) {
        return Array.isArray(value) && value.every((item) => this.isImage(item));
      },
      runStatusText(status) {
        if (status === 'succeeded') return '成功';
        if (status === 'failed') return '失败';
        if (status === 'running') return '运行中';
        return status || '-';
      },
      formatTime(value) {
        if (!value) return '-';
        return new Date(value).toLocaleString('zh-CN', { hour12: false });
      },
      seconds(ms) {
        return ((ms || 0) / 1000).toFixed(1);
      },
      usageSummary(logs) {
        const summary = { prompt: 0, completion: 0, cost: 0 };
        (logs || []).forEach((log) => {
          if (!log.usage) return;
          summary.prompt += log.usage.promptTokens || 0;
          summary.completion += log.usage.completionTokens || 0;
          summary.cost += log.usage.costUsd || 0;
        });
        return summary;
      },
    },
    template: `
      <section class="vue-admin-page vue-workflows-page">
        <div class="panel-toolbar vue-native-toolbar">
          <span class="panel-title">AI 工作流编排</span>
          <div class="vue-native-actions">
            <button class="btn-sm" type="button" @click="refreshAll" :disabled="loading">{{ loading ? '刷新中' : '刷新' }}</button>
            <button class="btn-sm" type="button" @click="showCapabilities">节点能力</button>
            <button class="btn-primary" type="button" @click="newWorkflow">新建工作流</button>
          </div>
        </div>

        <div class="wf-layout">
          <aside class="wf-list-pane">
            <div class="wf-list-section-title">内置工作流</div>
            <div class="wf-list">
              <button
                v-for="item in builtinWorkflows"
                :key="item.id"
                type="button"
                class="wf-list-item"
                :class="{ active: item.id === currentId }"
                @click="openWorkflow(item.id)"
              >
                <div class="wf-list-item-head">
                  <span class="wf-list-item-name">{{ item.name }}</span>
                  <span class="wf-badge wf-badge-builtin">内置</span>
                </div>
                <div class="wf-list-item-meta">{{ item.category || 'custom' }} · {{ item.stepCount || 0 }}步 · v{{ item.version || 1 }}</div>
                <div class="wf-list-item-desc">{{ item.description || '暂无描述' }}</div>
              </button>
              <div v-if="!builtinWorkflows.length" class="wf-list-empty">暂无内置工作流</div>
            </div>

            <div class="wf-list-section-title" style="margin-top:14px">自定义工作流</div>
            <div class="wf-list">
              <button
                v-for="item in userWorkflows"
                :key="item.id"
                type="button"
                class="wf-list-item"
                :class="{ active: item.id === currentId }"
                @click="openWorkflow(item.id)"
              >
                <div class="wf-list-item-head">
                  <span class="wf-list-item-name">{{ item.name }}</span>
                </div>
                <div class="wf-list-item-meta">{{ item.category || 'custom' }} · {{ item.stepCount || 0 }}步 · v{{ item.version || 1 }}</div>
                <div class="wf-list-item-desc">{{ item.description || '暂无描述' }}</div>
              </button>
              <div v-if="!userWorkflows.length" class="wf-list-empty">还没有自定义工作流，点击右上角新建</div>
            </div>
          </aside>

          <section class="wf-detail-pane">
            <div v-if="!currentWorkflow" class="wf-empty">从左侧选择一个工作流，或点击“新建工作流”。</div>
            <template v-else>
              <div class="wf-detail-head">
                <div>
                  <div class="wf-detail-title">
                    {{ currentWorkflow.name }}
                    <span v-if="isBuiltinCurrent" class="wf-badge wf-badge-builtin">内置</span>
                  </div>
                  <div class="wf-detail-meta">id: <code>{{ currentWorkflow.id }}</code> · {{ (currentWorkflow.steps || []).length }}步 · {{ (currentWorkflow.outputs || []).length }}个输出</div>
                  <div v-if="currentWorkflow.description" class="wf-detail-desc">{{ currentWorkflow.description }}</div>
                </div>
                <div class="wf-detail-actions">
                  <button class="btn-sm" type="button" @click="toggleEdit">{{ isEditing ? '取消编辑' : '编辑 JSON' }}</button>
                  <button v-if="isBuiltinCurrent" class="btn-sm" type="button" @click="cloneWorkflow">克隆为自定义</button>
                  <button v-else class="btn-sm danger" type="button" @click="deleteWorkflow">删除</button>
                </div>
              </div>

              <div class="wf-detail-body">
                <div class="wf-pane-left">
                  <template v-if="isEditing">
                    <div class="wf-form-row">
                      <label>工作流 JSON 定义</label>
                      <textarea id="wf-json-editor" class="wf-json-editor" rows="22" v-model="jsonText"></textarea>
                      <div style="margin-top:8px;display:flex;gap:8px;">
                        <button class="btn-primary" type="button" @click="saveJson" :disabled="saving">{{ saving ? '保存中' : '保存' }}</button>
                        <button class="btn-sm" type="button" @click="formatJson">格式化</button>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="wf-section-title">输入参数</div>
                    <div v-if="!(currentWorkflow.inputs || []).length" class="wf-empty-small">该工作流无输入参数</div>
                    <div v-for="input in currentWorkflow.inputs || []" :key="input.name" class="wf-form-row">
                      <label>{{ input.label || input.name }} <span v-if="input.required" class="wf-required">*</span></label>
                      <div v-if="input.desc" class="wf-input-desc">{{ input.desc }}</div>
                      <textarea
                        v-if="input.type === 'array' || input.type === 'object'"
                        class="wf-input"
                        rows="4"
                        :placeholder="input.type === 'array' ? '一行一个 URL/值' : '请输入 JSON'"
                        v-model="formInputs[input.name]"
                      ></textarea>
                      <input
                        v-else
                        class="wf-input"
                        :type="input.type === 'number' ? 'number' : 'text'"
                        :placeholder="input.placeholder || ''"
                        v-model="formInputs[input.name]"
                      />
                    </div>
                    <div class="wf-form-row" style="margin-top:14px">
                      <button class="btn-primary wf-run-btn" type="button" @click="runWorkflow" :disabled="running">{{ running ? '执行中...' : '试运行' }}</button>
                    </div>
                  </template>
                </div>

                <div class="wf-pane-right">
                  <div class="wf-section-title">步骤流</div>
                  <div class="wf-steps-vis">
                    <div v-for="(step, index) in currentWorkflow.steps || []" :key="step.id || index" class="wf-step-block">
                      <span class="wf-step-idx">{{ index + 1 }}</span>
                      <div>
                        <div class="wf-step-name">{{ step.id }} <code>{{ step.type }}</code></div>
                        <div v-if="step.params" class="wf-step-params">{{ stepParams(step) }}</div>
                      </div>
                    </div>
                    <div v-if="!(currentWorkflow.steps || []).length" class="wf-empty-small">无步骤</div>
                  </div>

                  <div class="wf-section-title" style="margin-top:14px">声明的输出</div>
                  <div class="wf-outputs-list">
                    <div v-for="output in currentWorkflow.outputs || []" :key="output.name" class="wf-output-row">
                      <code>{{ output.name }}</code> <- <code>{{ output.from }}</code> <span style="color:var(--text3)">{{ output.type || '' }}</span>
                    </div>
                    <div v-if="!(currentWorkflow.outputs || []).length" class="wf-empty-small">未声明输出</div>
                  </div>

                  <div class="wf-section-title" style="margin-top:14px">
                    运行历史
                    <button class="btn-sm" type="button" @click="refreshRuns" style="margin-left:8px;font-size:11px">刷新</button>
                  </div>
                  <div class="wf-runs-list">
                    <button v-for="run in runHistory" :key="run.runId" type="button" class="wf-run-row" @click="openRun(run.runId)">
                      <span class="wf-run-status" :class="run.status">{{ runStatusText(run.status) }}</span>
                      <span class="wf-run-time">{{ formatTime(run.startedAt) }}</span>
                      <span class="wf-run-dur">{{ seconds(run.durationMs) }}s</span>
                    </button>
                    <div v-if="!runHistory.length" class="wf-empty-small">暂无运行记录</div>
                  </div>
                </div>
              </div>

              <div id="wf-run-result-area">
                <div v-if="runResult && runResult.status === 'running'" class="wf-running">
                  <div class="wf-spinner"></div>
                  工作流执行中...可能需要 30-180 秒
                </div>
                <div v-else-if="runResult && runResult.status === 'failed'" class="wf-run-fail">
                  <div class="wf-section-title" style="color:#ef4444">执行失败 ({{ seconds(runResult.durationMs) }}s)</div>
                  <pre>{{ runResult.error }}</pre>
                  <details v-if="(runResult.stepLogs || []).length" class="wf-step-logs">
                    <summary>步骤日志 ({{ runResult.stepLogs.length }})</summary>
                    <div v-for="log in runResult.stepLogs" :key="log.id" class="wf-step-log" :class="log.ok ? 'ok' : (log.skipped ? 'skip' : 'err')">
                      <span class="wf-step-log-id">{{ log.id }}</span>
                      <code>{{ log.type }}</code>
                      <span class="wf-step-log-tag">{{ log.skipped ? '跳过' : (log.ok ? '成功' : '失败') }}</span>
                      <div v-if="log.error" class="wf-step-log-err">{{ log.error }}</div>
                    </div>
                  </details>
                </div>
                <div v-else-if="runResult" class="wf-run-success">
                  <div class="wf-section-title" style="color:#22c55e">执行成功 ({{ seconds(runResult.durationMs) }}s · run {{ runResult.runId }})</div>
                  <div v-if="(runResult.stepLogs || []).some(item => item.usage)" class="wf-usage-bar">
                    Token 合计:
                    <b>{{ usageSummary(runResult.stepLogs).prompt.toLocaleString() }}</b> in /
                    <b>{{ usageSummary(runResult.stepLogs).completion.toLocaleString() }}</b> out ·
                    估算费用: <b>USD {{ usageSummary(runResult.stepLogs).cost.toFixed(5) }}</b>
                  </div>
                  <div class="wf-outputs-display">
                    <div v-for="(value, key) in runResult.outputs || {}" :key="key" class="wf-output-block">
                      <div class="wf-output-key">{{ key }}</div>
                      <img v-if="isImage(value)" :src="value" class="wf-output-img" alt="" />
                      <video v-else-if="isVideo(value)" :src="value" class="wf-output-video" controls></video>
                      <div v-else-if="isImageArray(value)" class="wf-output-img-grid">
                        <img v-for="item in value" :key="item" :src="item" class="wf-output-img" alt="" />
                      </div>
                      <a v-else-if="isUrl(value)" :href="value" target="_blank" class="wf-output-link">{{ value }}</a>
                      <pre v-else>{{ outputValue(value) }}</pre>
                    </div>
                  </div>
                  <details v-if="(runResult.stepLogs || []).length" class="wf-step-logs">
                    <summary>步骤日志 ({{ runResult.stepLogs.length }})</summary>
                    <div v-for="log in runResult.stepLogs" :key="log.id" class="wf-step-log" :class="log.ok ? 'ok' : (log.skipped ? 'skip' : 'err')">
                      <span class="wf-step-log-id">{{ log.id }}</span>
                      <code>{{ log.type }}</code>
                      <span class="wf-step-log-tag">{{ log.skipped ? '跳过' : (log.ok ? (log.durationMs || 0) + 'ms' : '失败') }}</span>
                      <span v-if="log.usage" class="wf-step-log-usage">{{ log.usage.model }} · {{ (log.usage.promptTokens || 0) + (log.usage.completionTokens || 0) }} tok</span>
                      <div v-if="log.error" class="wf-step-log-err">{{ log.error }}</div>
                    </div>
                  </details>
                </div>
              </div>
            </template>
          </section>
        </div>

        <div v-if="modalOpen" id="wf-modal" class="wf-modal open">
          <div class="wf-modal-backdrop" @click="closeModal"></div>
          <div class="wf-modal-card">
            <div class="wf-modal-head">
              <span class="wf-modal-title">{{ modalTitle }}</span>
              <button class="wf-modal-close" type="button" @click="closeModal">×</button>
            </div>
            <div class="wf-modal-body">
              <div v-if="modalMode === 'capabilities'" class="wf-cap-grid">
                <div v-for="cap in capabilities" :key="cap.type" class="wf-cap-card">
                  <div class="wf-cap-head"><code>{{ cap.type }}</code><span>{{ cap.label }}</span></div>
                  <div class="wf-cap-desc">{{ cap.description || '暂无说明' }}</div>
                  <div class="wf-cap-io">
                    <div class="wf-cap-io-col">
                      <strong>输入</strong>
                      <div v-for="input in cap.inputs || []" :key="input.name">
                        <code>{{ input.name }}</code>
                        <span v-if="input.required" class="wf-required">*</span>
                        <span class="wf-cap-io-type">{{ input.type || '' }}</span>
                        <br v-if="input.desc" /><small v-if="input.desc">{{ input.desc }}</small>
                      </div>
                      <div v-if="!(cap.inputs || []).length">-</div>
                    </div>
                    <div class="wf-cap-io-col">
                      <strong>输出</strong>
                      <div v-for="output in cap.outputs || []" :key="output.name">
                        <code>{{ output.name }}</code>
                        <span class="wf-cap-io-type">{{ output.type || '' }}</span>
                      </div>
                      <div v-if="!(cap.outputs || []).length">-</div>
                    </div>
                  </div>
                </div>
                <div v-if="!capabilities.length">暂无注册节点</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    `,
  };

  function mountWorkflows() {
    const el = document.getElementById('admin-workflows-vue');
    if (!el || vm) return;
    vm = createApp(appDef).mount(el);

    window.wfRefreshAll = () => vm.refreshAll();
    window.wfOpenWorkflow = (id) => vm.openWorkflow(id);
    window.wfToggleEdit = () => vm.toggleEdit();
    window.wfFormatJson = () => vm.formatJson();
    window.wfSaveJson = () => vm.saveJson();
    window.wfNewWorkflow = () => vm.newWorkflow();
    window.wfClone = () => vm.cloneWorkflow();
    window.wfDelete = () => vm.deleteWorkflow();
    window.wfRun = () => vm.runWorkflow();
    window.wfRefreshRuns = () => vm.refreshRuns();
    window.wfOpenRun = (runId) => vm.openRun(runId);
    window.wfShowCapabilities = () => vm.showCapabilities();
    window.wfCloseModal = () => vm.closeModal();
  }

  window.loadWorkflowsVue = () => {
    mountWorkflows();
    if (vm) vm.refreshAll();
  };

  document.addEventListener('DOMContentLoaded', mountWorkflows);
})();
