(() => {
  if (!window.Vue || !window.AdminVueApi) return;

  const { createApp } = window.Vue;
  const api = window.AdminVueApi;
  let vm = null;

  const notify = (message, type = 'success') => typeof toast === 'function' ? toast(message, type) : (type === 'error' ? alert(message) : null);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[s]));
  }

  function mountAiteam() {
    const el = document.getElementById('admin-aiteam-vue');
    if (!el || vm) return;

    vm = createApp({
      data() {
        return {
          loading: false,
          teams: [],
          logs: null
        };
      },
      computed: {
        totalAgents() {
          return this.teams.reduce((sum, team) => sum + Number(team.total_agents || 0), 0);
        },
        totalDocs() {
          return this.teams.reduce((sum, team) => sum + Number(team.total_docs || 0), 0);
        }
      },
      methods: {
        async refresh() {
          this.loading = true;
          try {
            this.teams = await api.get('/api/admin/knowledgebase/teams', { cache: false });
            await this.refreshLogs();
          } catch (error) {
            notify('加载 AI 团队失败: ' + (error.message || error), 'error');
          } finally {
            this.loading = false;
          }
        },
        async refreshLogs() {
          try {
            this.logs = await api.get('/api/admin/logs/tree', { cache: false });
          } catch (error) {
            this.logs = { error: error.message || '加载失败' };
          }
        },
        async openAgent(agent) {
          try {
            const docs = await api.get('/api/admin/knowledgebase?appliesTo=' + encodeURIComponent(agent.id), { cache: false });
            const body = `
              <div class="agent-detail-meta">
                <div class="agent-detail-desc">${escapeHtml(agent.desc || '')}</div>
                <div class="agent-detail-stats">可读取知识：<strong>${docs.length}</strong> 条</div>
              </div>
              <div class="agent-kb-list">
                ${docs.slice(0, 40).map(doc => `<div class="agent-kb-item"><div class="agent-kb-item-head"><span class="agent-kb-sub">${escapeHtml(doc.collection || '')}</span><span class="agent-kb-title">${escapeHtml(doc.title || '')}</span></div><div class="agent-kb-summary">${escapeHtml(doc.summary || '')}</div></div>`).join('') || '<div class="kb-empty">暂无对应知识</div>'}
              </div>`;
            if (typeof showModal === 'function') {
              showModal({
                title: `${escapeHtml(agent.emoji || '')} ${escapeHtml(agent.name || agent.id)}`,
                subtitle: `<code>${escapeHtml(agent.id)}</code>`,
                maxWidth: '900px',
                body,
                footer: '<button class="btn-sm" onclick="closeModal()">关闭</button>'
              });
            } else {
              alert(`${agent.id}: ${docs.length} 条知识`);
            }
          } catch (error) {
            notify('加载 Agent 详情失败: ' + (error.message || error), 'error');
          }
        },
        async viewLog(entry) {
          if (!entry.path) return;
          try {
            const file = await api.get('/api/admin/logs/file?file=' + encodeURIComponent(entry.path), { cache: false });
            if (typeof showModal === 'function') {
              showModal({
                title: entry.name || entry.path,
                subtitle: `<code>${escapeHtml(entry.path)}</code>`,
                maxWidth: '900px',
                body: `<pre class="kb-preview-body" style="max-height:65vh;overflow-y:auto;">${escapeHtml(file.content || '')}</pre>`,
                footer: '<button class="btn-sm" onclick="closeModal()">关闭</button>'
              });
            } else {
              alert(file.content || '');
            }
          } catch (error) {
            notify('读取日志失败: ' + (error.message || error), 'error');
          }
        }
      },
      mounted() {
        this.refresh();
      },
      template: `
        <section class="vue-admin-page vue-team-page">
          <div class="panel-toolbar vue-native-toolbar">
            <span class="panel-title">VIDO AI 团队</span>
            <div class="vue-native-actions">
              <span class="aiteam-stats">{{ teams.length }} 个团队 · {{ totalAgents }} 名 agent · {{ totalDocs }} 条知识</span>
              <button class="btn-sm" @click="refresh" :disabled="loading">{{ loading ? '刷新中...' : '刷新' }}</button>
              <button class="btn-primary" onclick="aiteamOpenNewAgent()">+ 新增 Agent</button>
              <button class="btn-primary" onclick="aiteamOpenWorkflowAtlas()">工作流图谱</button>
              <button class="btn-primary" onclick="aiteamOpenRunWorkflow()">执行任务</button>
            </div>
          </div>
          <div class="aiteam-desc">每个 agent 只读取自己团队对应的知识库。点击 agent 查看其详细能力和对应 KB 条目。</div>
          <div class="aiteam-teams">
            <div class="aiteam-team" v-for="team in teams" :key="team.id || team.name">
              <div class="aiteam-team-head">
                <span class="aiteam-team-emoji">{{ team.emoji }}</span>
                <span class="aiteam-team-name">{{ team.name }}</span>
                <span class="aiteam-team-meta">{{ team.total_agents }} 名 · {{ team.total_docs }} 条知识</span>
              </div>
              <div class="aiteam-agents">
                <div class="aiteam-agent" v-for="agent in team.agents || []" :key="agent.id" @click="openAgent(agent)">
                  <div class="aiteam-agent-head">
                    <span class="aiteam-emoji">{{ agent.emoji }}</span>
                    <span class="aiteam-name">{{ agent.name }}</span>
                    <span class="aiteam-id">{{ agent.id }}</span>
                    <span class="aiteam-badge">{{ agent.layer }}</span>
                  </div>
                  <div class="aiteam-desc-line">{{ agent.desc }}</div>
                  <div class="aiteam-skills"><span class="aiteam-skill" v-for="skill in agent.skills || []" :key="skill">{{ skill }}</span></div>
                  <div class="aiteam-foot"><span class="aiteam-count">{{ agent.total_docs }} 条</span></div>
                </div>
              </div>
            </div>
          </div>

          <div class="panel-toolbar" style="margin-top:24px">
            <span class="panel-title">项目日志</span>
            <div class="vue-native-actions">
              <span class="aiteam-stats" v-if="logs && logs.stats">{{ logs.stats.total_sessions }} 会话 · {{ logs.stats.total_changes }} 修改 · {{ logs.stats.total_deployments }} 部署</span>
              <button class="btn-sm" @click="refreshLogs">刷新</button>
              <button class="btn-sm" onclick="logsTriggerDailyLearn()">手动触发学习</button>
            </div>
          </div>
          <div class="aiteam-desc">所有日志统一存储在 <code>docs/logs/</code>，按类型分目录，按天归档。</div>
          <div class="logs-tree">
            <div v-if="logs && logs.error" class="kb-empty">{{ logs.error }}</div>
            <div class="log-category" v-for="cat in (logs && logs.categories) || []" :key="cat.id">
              <div class="log-cat-head">{{ cat.id }} <span class="log-cat-path">{{ cat.path }}</span></div>
              <div class="log-entries">
                <div class="log-entry" v-for="entry in (cat.entries || []).slice(0, 10)" :key="entry.path || entry.name" @click="viewLog(entry)">
                  <div class="log-entry-head">{{ entry.name }} <span class="log-size">{{ entry.files ? '(' + entry.files + ' 文件)' : '' }}</span></div>
                  <div class="log-subfiles" v-if="entry.file_list">
                    <div class="log-subfile" v-for="file in entry.file_list" :key="file.path" @click.stop="viewLog(file)">{{ file.name }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      `
    }).mount(el);
  }

  window.aiteamInit = () => { mountAiteam(); return vm?.refresh(); };
  window.aiteamRefresh = () => { mountAiteam(); return vm?.refresh(); };
  window.logsTreeRefresh = () => { mountAiteam(); return vm?.refreshLogs(); };

  document.addEventListener('DOMContentLoaded', mountAiteam);
})();
