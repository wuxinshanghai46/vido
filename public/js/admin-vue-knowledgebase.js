(() => {
  if (!window.Vue || !window.AdminVueApi) return;

  const { createApp } = window.Vue;
  const api = window.AdminVueApi;
  let vm = null;

  const notify = (message, type = 'success') => typeof toast === 'function' ? toast(message, type) : (type === 'error' ? alert(message) : null);
  const arr = value => Array.isArray(value) ? value : [];
  const csv = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);

  function docToEditor(doc) {
    return {
      ...doc,
      tagsText: arr(doc.tags).join(','),
      keywordsText: arr(doc.keywords).join(','),
      snippetsText: arr(doc.prompt_snippets).join('\n'),
      runtimePolicyText: doc.runtime_policy ? JSON.stringify(doc.runtime_policy, null, 2) : '',
      applies_to: arr(doc.applies_to)
    };
  }

  function editorToBody(editor) {
    const body = { ...editor };
    body.tags = csv(editor.tagsText);
    body.keywords = csv(editor.keywordsText);
    body.prompt_snippets = String(editor.snippetsText || '').split('\n').map(item => item.trim()).filter(Boolean);
    if (String(editor.runtimePolicyText || '').trim()) body.runtime_policy = JSON.parse(editor.runtimePolicyText);
    else body.runtime_policy = null;
    delete body.tagsText;
    delete body.keywordsText;
    delete body.snippetsText;
    delete body.runtimePolicyText;
    return body;
  }

  function mountKnowledgebase() {
    const el = document.getElementById('admin-kb-vue');
    if (!el || vm) return;

    vm = createApp({
      data() {
        return {
          loading: false,
          collections: [],
          agentTypes: [],
          docs: [],
          activeCollection: '',
          activeSubcategory: '',
          activeDoc: null,
          editor: null,
          isNew: false,
          search: '',
          appliesTo: '',
          forceKb: true,
          importOpen: false,
          importForm: {
            source: '飞书 wiki',
            collection: 'storyboard',
            applies: '',
            content: ''
          }
        };
      },
      computed: {
        collectionIds() {
          return this.collections.length ? this.collections.map(item => item.id) : ['digital_human', 'drama', 'storyboard', 'atmosphere', 'production', 'engineering'];
        }
      },
      methods: {
        async init(force = false) {
          this.loading = true;
          try {
            const [collections, agents, forceState] = await Promise.all([
              api.get('/api/admin/knowledgebase/collections', { cache: !force, ttl: 15000 }),
              api.get('/api/admin/knowledgebase/agent-types', { cache: !force, ttl: 15000 }),
              api.get('/api/admin/knowledgebase/_force', { cache: !force, ttl: 8000 }).catch(() => ({ enabled: true }))
            ]);
            this.collections = arr(collections);
            this.agentTypes = arr(agents);
            this.forceKb = forceState?.enabled !== false;
            await this.loadDocs(force);
          } catch (error) {
            notify('加载知识库失败: ' + (error.message || error), 'error');
          } finally {
            this.loading = false;
          }
        },
        async loadDocs(force = false) {
          const params = new URLSearchParams();
          if (this.activeCollection) params.set('collection', this.activeCollection);
          if (this.activeSubcategory) params.set('subcategory', this.activeSubcategory);
          if (this.search) params.set('q', this.search);
          if (this.appliesTo) params.set('appliesTo', this.appliesTo);
          try {
            this.docs = await api.get('/api/admin/knowledgebase?' + params.toString(), { cache: !force, ttl: 8000 });
          } catch (error) {
            notify('加载条目失败: ' + (error.message || error), 'error');
          }
        },
        selectCollection(collection, subcategory = '') {
          this.activeCollection = collection || '';
          this.activeSubcategory = subcategory || '';
          this.loadDocs(true);
        },
        selectDoc(doc) {
          this.activeDoc = doc;
          this.editor = docToEditor(doc);
          this.isNew = false;
        },
        newDoc() {
          this.activeDoc = null;
          this.isNew = true;
          this.editor = docToEditor({
            id: '',
            collection: this.activeCollection || 'drama',
            subcategory: this.activeSubcategory || '',
            title: '',
            summary: '',
            content: '',
            tags: [],
            keywords: [],
            prompt_snippets: [],
            applies_to: ['screenwriter', 'director'],
            source: '',
            lang: 'zh',
            enabled: true
          });
        },
        async saveDoc() {
          if (!this.editor?.title) return notify('标题必填', 'error');
          try {
            const body = editorToBody(this.editor);
            const saved = this.isNew
              ? await api.post('/api/admin/knowledgebase', body)
              : await api.put('/api/admin/knowledgebase/' + encodeURIComponent(this.activeDoc.id), body);
            notify('已保存');
            await this.loadDocs(true);
            this.selectDoc(saved);
          } catch (error) {
            notify('保存失败: ' + (error.message || error), 'error');
          }
        },
        async deleteDoc(id) {
          if (!confirm('确认删除此条目？')) return;
          try {
            await api.delete('/api/admin/knowledgebase/' + encodeURIComponent(id));
            this.editor = null;
            this.activeDoc = null;
            await this.loadDocs(true);
            notify('已删除');
          } catch (error) {
            notify('删除失败: ' + (error.message || error), 'error');
          }
        },
        async toggleForce() {
          try {
            await api.put('/api/admin/knowledgebase/_force', { enabled: !!this.forceKb });
            notify(this.forceKb ? '已开启强制使用 KB' : '已关闭强制使用 KB');
          } catch (error) {
            notify('保存失败: ' + (error.message || error), 'error');
            this.forceKb = !this.forceKb;
          }
        },
        async doImport() {
          if (!this.importForm.content.trim()) return notify('请粘贴提示词内容', 'error');
          try {
            const applies_to = this.importForm.applies ? csv(this.importForm.applies) : ['screenwriter', 'director', 'storyboard', 'atmosphere'];
            const result = await api.post('/api/admin/knowledgebase/import-prompts', {
              source: this.importForm.source,
              collection: this.importForm.collection,
              applies_to,
              content: this.importForm.content
            });
            notify(`已导入 ${result.inserted || 0} 条`);
            this.importOpen = false;
            this.importForm.content = '';
            await this.loadDocs(true);
          } catch (error) {
            notify('导入失败: ' + (error.message || error), 'error');
          }
        },
        async preview() {
          const agent = this.appliesTo || 'screenwriter';
          try {
            const data = await api.get(`/api/admin/knowledgebase/_preview/${encodeURIComponent(agent)}`, { cache: false });
            if (typeof showModal === 'function') {
              showModal({
                title: 'Agent 注入预览',
                subtitle: agent,
                maxWidth: '900px',
                body: `<pre class="kb-preview-body" style="max-height:65vh;overflow-y:auto;">${String(data.context || '无匹配内容').replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s]))}</pre>`,
                footer: '<button class="btn-sm" onclick="closeModal()">关闭</button>'
              });
            } else {
              alert(data.context || '无匹配内容');
            }
          } catch (error) {
            notify('预览失败: ' + (error.message || error), 'error');
          }
        }
      },
      mounted() {
        this.init();
      },
      template: `
        <section class="vue-admin-page vue-kb-page">
          <div class="panel-toolbar vue-native-toolbar">
            <span class="panel-title">知识库合集</span>
            <div class="vue-native-actions">
              <input v-model="search" @input="loadDocs(true)" class="kb-search-input" placeholder="搜索标题/内容/标签/关键词" />
              <select v-model="appliesTo" @change="loadDocs(true)">
                <option value="">全部 agent 范围</option>
                <option v-for="agent in agentTypes" :key="agent.id" :value="agent.id">{{ agent.name || agent.id }}</option>
              </select>
              <button class="btn-primary" @click="newDoc">+ 新建条目</button>
              <button class="btn-sm" @click="preview">预览 Agent 注入</button>
              <button class="btn-sm" @click="importOpen = true">飞书提示词同步</button>
              <label class="kb-check"><input type="checkbox" v-model="forceKb" @change="toggleForce" />强制使用 KB</label>
            </div>
          </div>
          <div class="kb-layout">
            <aside class="kb-sidebar">
              <div class="kb-col-item" :class="{active: !activeCollection}" @click="selectCollection('')">
                <div class="kb-col-name">全部合集</div>
                <div class="kb-col-desc">跨合集搜索</div>
              </div>
              <div class="kb-col-block" v-for="collection in collections" :key="collection.id">
                <div class="kb-col-item" :class="{active: activeCollection === collection.id && !activeSubcategory}" @click="selectCollection(collection.id)">
                  <div class="kb-col-name">{{ collection.name }}</div>
                  <div class="kb-col-desc">{{ collection.desc || '' }}</div>
                </div>
                <div class="kb-col-subs">
                  <div class="kb-col-sub" v-for="sub in collection.subcategories || []" :key="sub" :class="{active: activeCollection === collection.id && activeSubcategory === sub}" @click.stop="selectCollection(collection.id, sub)">{{ sub }}</div>
                </div>
              </div>
            </aside>
            <section class="kb-list-pane">
              <div v-if="!docs.length" class="kb-empty">没有匹配的条目</div>
              <div class="kb-doc-list">
                <div class="kb-doc-item" v-for="doc in docs" :key="doc.id" :class="{active: activeDoc && activeDoc.id === doc.id, disabled: doc.enabled === false}" @click="selectDoc(doc)">
                  <div class="kb-doc-title">{{ doc.title }}</div>
                  <div class="kb-doc-meta">{{ doc.collection }} · {{ doc.subcategory || '通用' }}</div>
                  <div class="kb-doc-summary">{{ (doc.summary || '').slice(0, 90) }}</div>
                  <div class="kb-doc-tags"><span class="kb-tag" v-for="tag in (doc.tags || []).slice(0, 4)" :key="tag">{{ tag }}</span></div>
                </div>
              </div>
            </section>
            <section class="kb-editor-pane">
              <div v-if="!editor" class="kb-editor"><div class="kb-empty">选择或新建一条知识</div></div>
              <div v-else class="kb-editor">
                <div class="kb-editor-header">
                  <strong>{{ isNew ? '新建知识条目' : '编辑知识条目' }}</strong>
                  <div>
                    <label class="kb-check"><input type="checkbox" v-model="editor.enabled" />启用</label>
                    <button v-if="!isNew" class="btn-sm danger" @click="deleteDoc(activeDoc.id)">删除</button>
                    <button class="btn-primary" @click="saveDoc">保存</button>
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group"><label>标题</label><input v-model="editor.title" /></div>
                  <div class="form-group"><label>合集</label><select v-model="editor.collection"><option v-for="id in collectionIds" :key="id" :value="id">{{ id }}</option></select></div>
                  <div class="form-group"><label>子分类</label><input v-model="editor.subcategory" /></div>
                </div>
                <div class="form-group"><label>摘要</label><input v-model="editor.summary" /></div>
                <div class="form-group"><label>正文内容</label><textarea v-model="editor.content" rows="10"></textarea></div>
                <div class="form-row">
                  <div class="form-group"><label>标签</label><input v-model="editor.tagsText" /></div>
                  <div class="form-group"><label>关键词</label><input v-model="editor.keywordsText" /></div>
                </div>
                <div class="form-group"><label>提示词片段</label><textarea v-model="editor.snippetsText" rows="4"></textarea></div>
                <div class="form-group"><label>可执行生成规则（JSON，高级）</label><textarea v-model="editor.runtimePolicyText" rows="8" spellcheck="false" placeholder='{"schema_version":1,"rules":[]}'></textarea><small>仅结构化、已审核的短规则会进入生成运行时；正文不会直接注入图片或视频模型。</small></div>
                <div class="form-group">
                  <label>适用 Agent</label>
                  <div class="kb-applies">
                    <label class="kb-check kb-check-agent" v-for="agent in agentTypes" :key="agent.id">
                      <input type="checkbox" :value="agent.id" v-model="editor.applies_to" />{{ agent.emoji || '' }} {{ agent.name || agent.id }}
                    </label>
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group"><label>来源</label><input v-model="editor.source" /></div>
                  <div class="form-group"><label>语言</label><input v-model="editor.lang" /></div>
                  <div class="form-group" v-if="isNew"><label>ID（可选）</label><input v-model="editor.id" /></div>
                </div>
              </div>
            </section>
          </div>
          <div v-if="importOpen" class="modal-overlay show" @click.self="importOpen = false">
            <div class="modal-box vue-kb-import">
              <div class="form-title">飞书提示词同步到知识库</div>
              <div class="form-group"><label>来源标签</label><input v-model="importForm.source" /></div>
              <div class="form-group"><label>目标合集</label><select v-model="importForm.collection"><option value="storyboard">分镜库</option><option value="atmosphere">氛围词库</option><option value="drama">网剧库</option><option value="digital_human">数字人库</option><option value="production">制作库</option><option value="engineering">工程库</option></select></div>
              <div class="form-group"><label>适用 Agent</label><input v-model="importForm.applies" placeholder="screenwriter,director" /></div>
              <div class="form-group"><label>提示词内容</label><textarea v-model="importForm.content" rows="14"></textarea></div>
              <div class="form-actions"><button class="btn-primary" @click="doImport">导入</button><button class="btn-sm" @click="importOpen = false">取消</button></div>
            </div>
          </div>
        </section>
      `
    }).mount(el);
  }

  window.kbInit = (force = false) => { mountKnowledgebase(); return vm?.init(!!force); };
  window.kbLoadDocs = (force = false) => { mountKnowledgebase(); return vm?.loadDocs(!!force); };
  window.kbOnSearch = () => vm?.loadDocs(true);
  window.kbNewDoc = () => { mountKnowledgebase(); return vm?.newDoc(); };
  window.kbToggleForce = enabled => { mountKnowledgebase(); vm.forceKb = !!enabled; return vm?.toggleForce(); };
  window.kbOpenImportModal = () => { mountKnowledgebase(); vm.importOpen = true; };
  window.kbDoImport = () => vm?.doImport();
  window.kbOpenPreview = () => vm?.preview();
  window.kbRunPreview = window.kbOpenPreview;

  document.addEventListener('DOMContentLoaded', mountKnowledgebase);
})();
