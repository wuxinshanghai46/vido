(() => {
  if (!window.Vue || !window.AdminVueApi) return;

  const { createApp } = window.Vue;
  const api = window.AdminVueApi;

  let syncVm = null;

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let index = 0;
    let value = Number(bytes || 0);
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return value.toFixed(index > 0 ? 1 : 0) + ' ' + units[index];
  }

  function fmtDate(value) {
    return value ? new Date(value).toLocaleString('zh-CN') : '从未';
  }

  function notify(message, type = 'success') {
    if (typeof toast === 'function') toast(message, type);
    else if (type === 'error') alert(message);
  }

  function mountSync() {
    const el = document.getElementById('admin-sync-vue');
    if (!el || syncVm) return;

    syncVm = createApp({
      data() {
        return {
          loading: false,
          saving: false,
          testing: false,
          executing: false,
          status: '',
          error: '',
          form: {
            host: '',
            port: 22,
            username: '',
            auth_type: 'password',
            password: '',
            private_key_path: '',
            passphrase: '',
            remote_path: ''
          },
          configMeta: {
            last_synced: '',
            last_sync_files: 0,
            password_masked: ''
          },
          stats: {
            files: 0,
            totalSize: 0,
            dirs: {}
          },
          logs: []
        };
      },
      computed: {
        dirRows() {
          return Object.entries(this.stats?.dirs || {})
            .filter(([, value]) => Number(value?.files || 0) > 0)
            .map(([name, value]) => ({
              name,
              files: value.files || 0,
              size: value.size || 0
            }));
        },
        statCards() {
          return [
            { label: '总文件数', value: `${this.stats.files || 0} 个` },
            { label: '总大小', value: formatBytes(this.stats.totalSize) },
            { label: '上次同步', value: fmtDate(this.configMeta.last_synced) },
            { label: '上次文件数', value: `${this.configMeta.last_sync_files || 0} 个` }
          ];
        },
        canExecute() {
          return !!this.form.host && !!this.form.username && !this.executing;
        }
      },
      methods: {
        async refresh(force = false) {
          this.loading = true;
          this.error = '';
          try {
            const [config, stats] = await Promise.all([
              api.get('/api/sync/config', { cache: !force, ttl: 8000 }),
              api.get('/api/sync/stats', { cache: !force, ttl: 8000 })
            ]);
            if (config) {
              this.form.host = config.host || '';
              this.form.port = config.port || 22;
              this.form.username = config.username || '';
              this.form.auth_type = config.auth_type || 'password';
              this.form.password = '';
              this.form.private_key_path = config.private_key_path || '';
              this.form.passphrase = '';
              this.form.remote_path = config.remote_path || '';
              this.configMeta = {
                last_synced: config.last_synced || '',
                last_sync_files: config.last_sync_files || 0,
                password_masked: config.password_masked || ''
              };
            }
            this.stats = stats || { files: 0, totalSize: 0, dirs: {} };
          } catch (error) {
            this.error = error.message || '加载失败';
          } finally {
            this.loading = false;
          }
        },
        async save() {
          if (!this.form.host.trim() || !this.form.username.trim()) {
            notify('请填写主机地址和用户名', 'error');
            return;
          }
          this.saving = true;
          try {
            await api.post('/api/sync/config', {
              host: this.form.host.trim(),
              port: this.form.port || 22,
              username: this.form.username.trim(),
              auth_type: this.form.auth_type,
              password: this.form.password || '',
              private_key_path: this.form.private_key_path.trim(),
              passphrase: this.form.passphrase || '',
              remote_path: this.form.remote_path.trim()
            });
            notify('同步配置已保存');
            this.form.password = '';
            this.form.passphrase = '';
            await this.refresh(true);
          } catch (error) {
            notify('保存失败: ' + (error.message || error), 'error');
          } finally {
            this.saving = false;
          }
        },
        async testConnection() {
          this.testing = true;
          this.status = '正在测试连接...';
          try {
            const result = await api.post('/api/sync/test', {}, { cache: false });
            this.status = result?.detail || result?.message || '连接正常';
            notify('连接成功: ' + this.status);
          } catch (error) {
            this.status = '连接失败';
            notify('连接失败: ' + (error.message || error), 'error');
          } finally {
            setTimeout(() => {
              this.testing = false;
              if (this.status === '正在测试连接...') this.status = '';
            }, 600);
          }
        },
        execute() {
          if (!this.canExecute) return;
          const token = typeof getToken === 'function' ? getToken() : '';
          if (!token) {
            notify('登录状态已失效，请重新登录', 'error');
            return;
          }

          this.executing = true;
          this.status = '正在连接...';
          this.logs = [];

          let eventSource;
          try {
            eventSource = new EventSource(`/api/sync/execute?token=${encodeURIComponent(token)}`);
          } catch (error) {
            this.executing = false;
            this.status = '连接失败';
            notify('同步失败: ' + (error.message || error), 'error');
            return;
          }

          eventSource.onmessage = event => {
            let data;
            try {
              data = JSON.parse(event.data);
            } catch {
              return;
            }
            this.status = data.message || '';
            this.logs.push({
              step: data.step || 'info',
              message: data.message || '',
              detail: data.detail || ''
            });
            this.$nextTick(() => {
              const box = this.$refs.logBox;
              if (box) box.scrollTop = box.scrollHeight;
            });

            if (data.step === 'complete' || data.step === 'error') {
              eventSource.close();
              this.executing = false;
              if (data.step === 'complete') {
                notify(`同步完成，共上传 ${data.files || 0} 个文件`);
                this.refresh(true);
              } else {
                notify(data.message || '同步失败', 'error');
              }
            }
          };

          eventSource.onerror = () => {
            eventSource.close();
            this.executing = false;
            this.status = '连接中断';
            notify('同步连接中断', 'error');
          };
        },
        logClass(step) {
          return {
            error: step === 'error',
            done: step === 'complete'
          };
        },
        formatBytes
      },
      mounted() {
        this.refresh();
      },
      template: `
        <section class="vue-admin-page vue-sync-page">
          <div class="panel-toolbar vue-native-toolbar">
            <span class="panel-title">数据同步</span>
            <div class="vue-native-actions">
              <span class="sync-status-indicator"></span>
              <button class="btn-sm" @click="refresh(true)" :disabled="loading">{{ loading ? '刷新中...' : '刷新' }}</button>
            </div>
          </div>

          <div v-if="error" class="kb-empty">加载失败：{{ error }}</div>

          <div class="sync-config-section">
            <div class="sync-section-title">远程服务器配置</div>
            <div class="form-row">
              <div class="form-group">
                <label>主机地址</label>
                <input v-model="form.host" placeholder="例如：192.168.1.100 或 myserver.com" />
              </div>
              <div class="form-group" style="flex:0.4">
                <label>端口</label>
                <input v-model.number="form.port" type="number" placeholder="22" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>用户名</label>
                <input v-model="form.username" placeholder="root" />
              </div>
              <div class="form-group">
                <label>认证方式</label>
                <select v-model="form.auth_type">
                  <option value="password">密码</option>
                  <option value="key">SSH 私钥</option>
                </select>
              </div>
            </div>

            <div v-if="form.auth_type === 'password'" class="form-row">
              <div class="form-group">
                <label>密码</label>
                <input v-model="form.password" type="password" :placeholder="configMeta.password_masked ? '留空保持当前密码' : '输入密码'" />
                <small v-if="configMeta.password_masked" class="vue-form-hint">当前已保存：{{ configMeta.password_masked }}，留空不改变。</small>
              </div>
            </div>

            <div v-if="form.auth_type === 'key'" class="form-row">
              <div class="form-group">
                <label>私钥路径</label>
                <input v-model="form.private_key_path" placeholder="~/.ssh/id_rsa" />
              </div>
              <div class="form-group">
                <label>密钥口令（可选）</label>
                <input v-model="form.passphrase" type="password" placeholder="留空表示无口令" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>远程目录</label>
                <input v-model="form.remote_path" placeholder="/home/user/vido-sync" />
              </div>
            </div>

            <div class="form-actions" style="margin-top:12px">
              <button class="btn-primary" @click="save" :disabled="saving">{{ saving ? '保存中...' : '保存配置' }}</button>
              <button class="btn-sm accent" @click="testConnection" :disabled="testing">{{ testing ? '测试中...' : '测试连接' }}</button>
              <span class="vue-sync-status">{{ status }}</span>
            </div>
          </div>

          <div class="sync-section-title" style="margin-top:24px">本地数据概览</div>
          <div class="sync-stats-grid">
            <div class="sync-stat-card" v-for="card in statCards" :key="card.label">
              <div class="sync-stat-label">{{ card.label }}</div>
              <div class="sync-stat-value">{{ card.value }}</div>
            </div>
          </div>

          <div v-if="dirRows.length" class="sync-dir-list vue-sync-dir-list">
            <div class="sync-dir-item" v-for="row in dirRows" :key="row.name">
              <span class="sync-dir-name">{{ row.name }}/</span>
              <span class="sync-dir-meta">{{ row.files }} 个文件 · {{ formatBytes(row.size) }}</span>
            </div>
          </div>

          <div class="vue-sync-execute">
            <button class="btn-primary" @click="execute" :disabled="!canExecute" style="padding:10px 28px;font-size:14px">
              {{ executing ? '同步中...' : '开始同步' }}
            </button>
            <span>{{ status }}</span>
          </div>

          <div v-if="logs.length" class="sync-log-container">
            <div class="sync-section-title">同步日志</div>
            <div class="sync-log" ref="logBox">
              <div class="sync-log-line" v-for="(line, index) in logs" :key="index">
                <span class="sync-log-step" :class="logClass(line.step)">[{{ line.step }}]</span>
                {{ line.message }}
                <span v-if="line.detail" class="vue-muted">{{ line.detail }}</span>
              </div>
            </div>
          </div>
        </section>
      `
    }).mount(el);
  }

  window.toggleSyncAuth = function toggleSyncAuthVue() {
    mountSync();
    return syncVm?.form?.auth_type;
  };

  window.loadSyncConfig = function loadSyncConfigVue(force = false) {
    mountSync();
    return syncVm?.refresh(!!force);
  };

  window.saveSyncConfig = function saveSyncConfigVue() {
    mountSync();
    return syncVm?.save();
  };

  window.testSyncConnection = function testSyncConnectionVue() {
    mountSync();
    return syncVm?.testConnection();
  };

  window.executeSyncNow = function executeSyncNowVue() {
    mountSync();
    return syncVm?.execute();
  };

  document.addEventListener('DOMContentLoaded', mountSync);
})();
