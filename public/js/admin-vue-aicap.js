(() => {
  if (!window.Vue || !window.AdminVueApi) return;

  const { createApp } = window.Vue;
  const api = window.AdminVueApi;
  let vm = null;

  const sceneTypeMap = { indoor: '室内', outdoor: '室外', fantasy: '幻想', urban: '都市', nature: '自然' };
  const styleCatMap = { manga: '漫画', comic: '西式漫画', cartoon: '卡通', traditional: '传统', realistic: '写实', scifi: '科幻', dark: '暗黑', soft: '治愈', stylized: '风格化', custom: '自定义' };

  function notify(message, type = 'success') {
    if (typeof toast === 'function') toast(message, type);
    else if (type === 'error') alert(message);
  }

  function tagsToText(tags) {
    return Array.isArray(tags) ? tags.join(',') : '';
  }

  function textToTags(value) {
    return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  }

  async function sendForm(url, method, fields, fileMap) {
    const fd = new FormData();
    Object.entries(fields).forEach(([key, value]) => {
      fd.append(key, Array.isArray(value) ? JSON.stringify(value) : (value ?? ''));
    });
    Object.entries(fileMap || {}).forEach(([key, files]) => {
      Array.from(files || []).forEach(file => fd.append(key, file));
    });
    return api.request(url, { method, body: fd, cache: false });
  }

  function emptyChar() {
    return { name: '', gender: '', age_range: '', personality: '', appearance: '', appearance_prompt: '', tagsText: '' };
  }

  function emptyScene() {
    return { name: '', scene_type: 'outdoor', description: '', scene_prompt: '', tagsText: '' };
  }

  function emptyStyle() {
    return { name: '', prompt_en: '', category: 'custom' };
  }

  function mountAICap() {
    const el = document.getElementById('admin-aicap-vue');
    if (!el || vm) return;

    vm = createApp({
      data() {
        return {
          tab: 'chars',
          loading: false,
          chars: [],
          scenes: [],
          styles: [],
          modal: null,
          editingId: null,
          form: {},
          files: null,
          busyId: '',
          saving: false
        };
      },
      computed: {
        stylePresetCount() {
          return this.styles.filter(item => item.is_preset).length;
        }
      },
      methods: {
        async refresh(force = false) {
          this.loading = true;
          try {
            const [chars, scenes, styles] = await Promise.all([
              api.get('/api/ai-cap/characters', { cache: !force, ttl: 8000 }),
              api.get('/api/ai-cap/scenes', { cache: !force, ttl: 8000 }),
              api.get('/api/ai-cap/styles', { cache: !force, ttl: 8000 })
            ]);
            this.chars = Array.isArray(chars) ? chars : [];
            this.scenes = Array.isArray(scenes) ? scenes : [];
            this.styles = Array.isArray(styles) ? styles : [];
          } catch (error) {
            notify('加载 AI 能力失败: ' + (error.message || error), 'error');
          } finally {
            this.loading = false;
          }
        },
        switchTab(tab) {
          this.tab = tab;
        },
        image(url) {
          return url || '';
        },
        styleImage(item) {
          if (item?.ref_image) return this.image(item.ref_image);
          const prompt = String(`${item?.category || ''} ${item?.name || ''} ${item?.prompt_en || ''}`).toLowerCase();
          if (/cyber|科幻|赛博/.test(prompt)) return '/images/styles/cyberpunk.svg';
          if (/pixel|像素/.test(prompt)) return '/images/styles/pixel.svg';
          if (/3d|cg|动画/.test(prompt)) return '/images/styles/3dcg.svg';
          if (/dark|goth|暗黑/.test(prompt)) return '/images/styles/darkfanta.svg';
          if (/chinese|xianxia|国风|水墨|传统/.test(prompt)) return '/images/styles/chinese.svg';
          if (/western|american|comic|美式|西式/.test(prompt)) return '/images/styles/western.svg';
          if (/ghibli|治愈/.test(prompt)) return '/images/styles/ghibli.svg';
          if (/mecha|机甲/.test(prompt)) return '/images/styles/mecha.svg';
          if (/manga|anime|漫画|少年|少女/.test(prompt)) return '/images/styles/shonen.svg';
          return '/images/styles/wuxia.svg';
        },
        cardImage(item, kind) {
          if (kind === 'style') return this.styleImage(item);
          return Array.isArray(item?.ref_images) && item.ref_images.length ? this.image(item.ref_images[0]) : '';
        },
        onCardImageError(event) {
          const img = event?.target;
          if (!img) return;
          img.style.display = 'none';
          const fallback = img.parentElement?.querySelector('.placeholder-icon');
          if (fallback) fallback.style.display = 'flex';
        },
        openChar(id) {
          const item = id ? this.chars.find(row => row.id === id) : null;
          this.modal = 'char';
          this.editingId = id || null;
          this.form = item ? {
            name: item.name || '',
            gender: item.gender || '',
            age_range: item.age_range || '',
            personality: item.personality || '',
            appearance: item.appearance || '',
            appearance_prompt: item.appearance_prompt || '',
            tagsText: tagsToText(item.tags)
          } : emptyChar();
          this.files = null;
        },
        openScene(id) {
          const item = id ? this.scenes.find(row => row.id === id) : null;
          this.modal = 'scene';
          this.editingId = id || null;
          this.form = item ? {
            name: item.name || '',
            scene_type: item.scene_type || 'outdoor',
            description: item.description || '',
            scene_prompt: item.scene_prompt || '',
            tagsText: tagsToText(item.tags)
          } : emptyScene();
          this.files = null;
        },
        openStyle(id) {
          const item = id ? this.styles.find(row => row.id === id) : null;
          this.modal = 'style';
          this.editingId = id || null;
          this.form = item ? {
            name: item.name || '',
            prompt_en: item.prompt_en || '',
            category: item.category || 'custom'
          } : emptyStyle();
          this.files = null;
        },
        closeModal() {
          this.modal = null;
          this.editingId = null;
          this.form = {};
          this.files = null;
        },
        onFiles(event) {
          this.files = event.target.files;
        },
        async saveChar() {
          this.saving = true;
          try {
            await sendForm(
              this.editingId ? `/api/ai-cap/characters/${encodeURIComponent(this.editingId)}` : '/api/ai-cap/characters',
              this.editingId ? 'PUT' : 'POST',
              {
                name: this.form.name,
                gender: this.form.gender,
                age_range: this.form.age_range,
                personality: this.form.personality,
                appearance: this.form.appearance,
                appearance_prompt: this.form.appearance_prompt,
                tags: textToTags(this.form.tagsText)
              },
              { ref_images: this.files }
            );
            notify(this.editingId ? '角色已更新' : '角色已创建');
            this.closeModal();
            await this.refresh(true);
          } catch (error) {
            notify('保存失败: ' + (error.message || error), 'error');
          } finally {
            this.saving = false;
          }
        },
        async saveScene() {
          this.saving = true;
          try {
            await sendForm(
              this.editingId ? `/api/ai-cap/scenes/${encodeURIComponent(this.editingId)}` : '/api/ai-cap/scenes',
              this.editingId ? 'PUT' : 'POST',
              {
                name: this.form.name,
                scene_type: this.form.scene_type,
                description: this.form.description,
                scene_prompt: this.form.scene_prompt,
                tags: textToTags(this.form.tagsText)
              },
              { ref_images: this.files }
            );
            notify(this.editingId ? '场景已更新' : '场景已创建');
            this.closeModal();
            await this.refresh(true);
          } catch (error) {
            notify('保存失败: ' + (error.message || error), 'error');
          } finally {
            this.saving = false;
          }
        },
        async saveStyle() {
          this.saving = true;
          try {
            await sendForm(
              this.editingId ? `/api/ai-cap/styles/${encodeURIComponent(this.editingId)}` : '/api/ai-cap/styles',
              this.editingId ? 'PUT' : 'POST',
              {
                name: this.form.name,
                prompt_en: this.form.prompt_en,
                category: this.form.category
              },
              { ref_image: this.files }
            );
            notify(this.editingId ? '风格已更新' : '风格已创建');
            this.closeModal();
            await this.refresh(true);
          } catch (error) {
            notify('保存失败: ' + (error.message || error), 'error');
          } finally {
            this.saving = false;
          }
        },
        async remove(kind, id) {
          if (!confirm('确认删除？')) return;
          const path = kind === 'char' ? 'characters' : kind === 'scene' ? 'scenes' : 'styles';
          try {
            await api.delete(`/api/ai-cap/${path}/${encodeURIComponent(id)}`);
            notify('已删除');
            await this.refresh(true);
          } catch (error) {
            notify('删除失败: ' + (error.message || error), 'error');
          }
        },
        async removeCharRef(charId, imageUrl) {
          try {
            await api.delete(`/api/ai-cap/characters/${encodeURIComponent(charId)}/images`, {
              body: JSON.stringify({ image_url: imageUrl })
            });
            await this.refresh(true);
            this.openChar(charId);
          } catch (error) {
            notify('删除参考图失败: ' + (error.message || error), 'error');
          }
        },
        async generate(url, busyId, doneMessage) {
          this.busyId = busyId;
          try {
            await api.post(url, {}, { cache: false });
            notify(doneMessage);
            await this.refresh(true);
            if (this.modal === 'char' && this.editingId) this.openChar(this.editingId);
            if (this.modal === 'scene' && this.editingId) this.openScene(this.editingId);
          } catch (error) {
            notify('生成失败: ' + (error.message || error), 'error');
          } finally {
            this.busyId = '';
          }
        },
        generateChar(id) {
          const charId = id || this.editingId;
          if (!charId) return notify('请先保存角色', 'error');
          return this.generate(`/api/ai-cap/characters/${encodeURIComponent(charId)}/generate-image`, `char-image-${charId}`, '形象已生成');
        },
        generateThreeView(id) {
          const charId = id || this.editingId;
          if (!charId) return notify('请先保存角色', 'error');
          if (!confirm('生成前/侧/后三视图，会调用多次图片 API，继续？')) return;
          return this.generate(`/api/ai-cap/characters/${encodeURIComponent(charId)}/generate-three-view`, `char-three-${charId}`, '三视图已生成');
        },
        generateExpressions(id) {
          const charId = id || this.editingId;
          if (!charId) return notify('请先保存角色', 'error');
          if (!confirm('生成 6 种表情包，会调用多次图片 API，继续？')) return;
          return this.generate(`/api/ai-cap/characters/${encodeURIComponent(charId)}/generate-expressions`, `char-exp-${charId}`, '表情包已生成');
        },
        async openCharCard(id) {
          try {
            const res = await authFetch(`/api/ai-cap/characters/${encodeURIComponent(id)}/card`);
            if (!res.ok) throw new Error('打开失败');
            const html = await res.text();
            const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
          } catch (error) {
            notify('打开失败: ' + (error.message || error), 'error');
          }
        },
        generateScene(id) {
          const sceneId = id || this.editingId;
          if (!sceneId) return notify('请先保存场景', 'error');
          return this.generate(`/api/ai-cap/scenes/${encodeURIComponent(sceneId)}/generate-image`, `scene-image-${sceneId}`, '场景图已生成');
        },
        sceneType(value) {
          return sceneTypeMap[value] || value || '-';
        },
        styleCat(value) {
          return styleCatMap[value] || value || '-';
        },
        currentChar() {
          return this.editingId ? this.chars.find(item => item.id === this.editingId) : null;
        },
        currentScene() {
          return this.editingId ? this.scenes.find(item => item.id === this.editingId) : null;
        },
        currentStyle() {
          return this.editingId ? this.styles.find(item => item.id === this.editingId) : null;
        }
      },
      mounted() {
        this.refresh();
      },
      template: `
        <section class="vue-admin-page vue-aicap-page">
          <div class="panel-toolbar vue-native-toolbar">
            <span class="panel-title">AI 能力</span>
            <div class="vue-native-actions">
              <button class="btn-sm" @click="refresh(true)" :disabled="loading">{{ loading ? '刷新中...' : '刷新' }}</button>
            </div>
          </div>

          <div class="ai-sub-tabs">
            <button class="ai-sub-tab" :class="{ active: tab === 'chars' }" @click="switchTab('chars')">角色库</button>
            <button class="ai-sub-tab" :class="{ active: tab === 'scenes' }" @click="switchTab('scenes')">场景库</button>
            <button class="ai-sub-tab" :class="{ active: tab === 'styles' }" @click="switchTab('styles')">风格库</button>
          </div>

          <div v-if="tab === 'chars'">
            <div class="ai-pane-toolbar">
              <span class="aicap-stats">共 {{ chars.length }} 个角色</span>
              <button class="btn-primary" @click="openChar()">+ 新建角色</button>
            </div>
            <div class="aicap-grid">
              <div v-if="!chars.length" class="kb-empty">暂无角色，点击上方按钮新建</div>
              <article class="aicap-card" v-for="item in chars" :key="item.id" @click="openChar(item.id)">
                <div class="aicap-card-thumb">
                  <img v-if="cardImage(item, 'char')" :src="cardImage(item, 'char')" @error="onCardImageError" />
                  <div class="placeholder-icon" :style="{display: cardImage(item, 'char') ? 'none' : 'flex'}">角色</div>
                </div>
                <div class="aicap-card-body">
                  <div class="aicap-card-name">{{ item.name }}</div>
                  <div class="aicap-card-meta">{{ (item.personality || item.appearance || '').slice(0, 40) }}</div>
                  <div class="aicap-card-tags"><span class="aicap-tag" v-for="tag in item.tags || []" :key="tag">{{ tag }}</span></div>
                </div>
                <div class="aicap-card-actions" @click.stop>
                  <button @click="openChar(item.id)">编辑</button>
                  <button @click="generateChar(item.id)" :disabled="busyId === 'char-image-' + item.id">生图</button>
                  <button @click="generateThreeView(item.id)" :disabled="busyId === 'char-three-' + item.id">三视图</button>
                  <button @click="generateExpressions(item.id)" :disabled="busyId === 'char-exp-' + item.id">表情包</button>
                  <button @click="openCharCard(item.id)">角色卡</button>
                  <button class="danger" @click="remove('char', item.id)">删除</button>
                </div>
              </article>
            </div>
          </div>

          <div v-if="tab === 'scenes'">
            <div class="ai-pane-toolbar">
              <span class="aicap-stats">共 {{ scenes.length }} 个场景</span>
              <button class="btn-primary" @click="openScene()">+ 新建场景</button>
            </div>
            <div class="aicap-grid">
              <div v-if="!scenes.length" class="kb-empty">暂无场景，点击上方按钮新建</div>
              <article class="aicap-card" v-for="item in scenes" :key="item.id" @click="openScene(item.id)">
                <div class="aicap-card-thumb">
                  <img v-if="cardImage(item, 'scene')" :src="cardImage(item, 'scene')" @error="onCardImageError" />
                  <div class="placeholder-icon" :style="{display: cardImage(item, 'scene') ? 'none' : 'flex'}">场景</div>
                </div>
                <div class="aicap-card-body">
                  <div class="aicap-card-name">{{ item.name }}</div>
                  <div class="aicap-card-meta">{{ sceneType(item.scene_type) }} · {{ (item.description || '').slice(0, 30) }}</div>
                  <div class="aicap-card-tags"><span class="aicap-tag" v-for="tag in item.tags || []" :key="tag">{{ tag }}</span></div>
                </div>
                <div class="aicap-card-actions" @click.stop>
                  <button @click="openScene(item.id)">编辑</button>
                  <button @click="generateScene(item.id)" :disabled="busyId === 'scene-image-' + item.id">AI 生图</button>
                  <button class="danger" @click="remove('scene', item.id)">删除</button>
                </div>
              </article>
            </div>
          </div>

          <div v-if="tab === 'styles'">
            <div class="ai-pane-toolbar">
              <span class="aicap-stats">共 {{ styles.length }} 个风格（{{ stylePresetCount }} 预设 + {{ styles.length - stylePresetCount }} 自定义）</span>
              <button class="btn-primary" @click="openStyle()">+ 新建风格</button>
            </div>
            <div class="aicap-grid">
              <div v-if="!styles.length" class="kb-empty">暂无风格</div>
              <article class="aicap-card" v-for="item in styles" :key="item.id" @click="openStyle(item.id)">
                <div class="aicap-card-thumb">
                  <img v-if="cardImage(item, 'style')" :src="cardImage(item, 'style')" @error="onCardImageError" />
                  <div class="placeholder-icon" :style="{display: cardImage(item, 'style') ? 'none' : 'flex'}">风格</div>
                  <span v-if="item.is_preset" class="aicap-preset-badge">预设</span>
                </div>
                <div class="aicap-card-body">
                  <div class="aicap-card-name">{{ item.name }}</div>
                  <div class="aicap-card-meta">{{ styleCat(item.category) }} · {{ (item.prompt_en || '').slice(0, 40) }}</div>
                </div>
                <div class="aicap-card-actions" @click.stop>
                  <button @click="openStyle(item.id)">编辑</button>
                  <button class="danger" @click="remove('style', item.id)">删除</button>
                </div>
              </article>
            </div>
          </div>

          <div v-if="modal" class="modal-overlay show" @click.self="closeModal">
            <div class="modal-box vue-aicap-modal">
              <div class="form-title">
                {{ modal === 'char' ? (editingId ? '编辑角色' : '新建角色') : modal === 'scene' ? (editingId ? '编辑场景' : '新建场景') : (editingId ? '编辑风格' : '新建风格') }}
              </div>

              <template v-if="modal === 'char'">
                <div class="form-row">
                  <div class="form-group" style="flex:2"><label>角色名称</label><input v-model="form.name" /></div>
                  <div class="form-group"><label>性别</label><select v-model="form.gender"><option value="">未设定</option><option value="male">男</option><option value="female">女</option><option value="other">其他</option></select></div>
                  <div class="form-group"><label>年龄段</label><select v-model="form.age_range"><option value="">未设定</option><option value="child">儿童</option><option value="teen">少年</option><option value="young">青年</option><option value="middle">中年</option><option value="old">老年</option></select></div>
                </div>
                <div class="form-group"><label>性格特征</label><input v-model="form.personality" /></div>
                <div class="form-group"><label>外貌描述（中文）</label><textarea v-model="form.appearance" rows="2"></textarea></div>
                <div class="form-group"><label>外貌 Prompt（英文）</label><textarea v-model="form.appearance_prompt" rows="2"></textarea></div>
                <div class="form-group"><label>标签</label><input v-model="form.tagsText" placeholder="用逗号分隔" /></div>
                <div class="form-group">
                  <label>参考图（最多5张）</label>
                  <div class="aicap-ref-images" v-if="currentChar()?.ref_images?.length">
                    <div class="ref-thumb" v-for="url in currentChar().ref_images" :key="url">
                      <img :src="url" />
                      <div class="ref-remove" @click="removeCharRef(editingId, url)">x</div>
                    </div>
                  </div>
                  <input type="file" accept="image/*" multiple @change="onFiles" />
                </div>
                <div class="form-actions">
                  <button class="btn-primary" @click="saveChar" :disabled="saving">{{ saving ? '保存中...' : '保存' }}</button>
                  <button class="btn-sm accent" @click="generateChar()" :disabled="!editingId || busyId">AI 生成形象</button>
                  <button class="btn-sm" @click="closeModal">取消</button>
                </div>
              </template>

              <template v-if="modal === 'scene'">
                <div class="form-row">
                  <div class="form-group" style="flex:2"><label>场景名称</label><input v-model="form.name" /></div>
                  <div class="form-group"><label>类型</label><select v-model="form.scene_type"><option value="indoor">室内</option><option value="outdoor">室外</option><option value="fantasy">幻想</option><option value="urban">都市</option><option value="nature">自然</option></select></div>
                </div>
                <div class="form-group"><label>场景描述</label><textarea v-model="form.description" rows="2"></textarea></div>
                <div class="form-group"><label>场景 Prompt（英文）</label><textarea v-model="form.scene_prompt" rows="2"></textarea></div>
                <div class="form-group"><label>标签</label><input v-model="form.tagsText" placeholder="用逗号分隔" /></div>
                <div class="form-group"><label>参考图</label><input type="file" accept="image/*" multiple @change="onFiles" /></div>
                <div class="form-actions">
                  <button class="btn-primary" @click="saveScene" :disabled="saving">{{ saving ? '保存中...' : '保存' }}</button>
                  <button class="btn-sm accent" @click="generateScene()" :disabled="!editingId || busyId">AI 生成场景图</button>
                  <button class="btn-sm" @click="closeModal">取消</button>
                </div>
              </template>

              <template v-if="modal === 'style'">
                <div class="form-row">
                  <div class="form-group" style="flex:2"><label>风格名称</label><input v-model="form.name" /></div>
                  <div class="form-group"><label>分类</label><select v-model="form.category"><option value="manga">漫画</option><option value="comic">漫画(西式)</option><option value="cartoon">卡通</option><option value="traditional">传统</option><option value="realistic">写实</option><option value="scifi">科幻</option><option value="dark">暗黑</option><option value="soft">治愈</option><option value="stylized">风格化</option><option value="custom">自定义</option></select></div>
                </div>
                <div class="form-group"><label>英文 Prompt（用于 AI 生图）</label><textarea v-model="form.prompt_en" rows="3"></textarea></div>
                <div class="form-group"><label>预览图（可选）</label><input type="file" accept="image/*" @change="onFiles" /></div>
                <div class="form-actions">
                  <button class="btn-primary" @click="saveStyle" :disabled="saving">{{ saving ? '保存中...' : '保存' }}</button>
                  <button class="btn-sm" @click="closeModal">取消</button>
                </div>
              </template>
            </div>
          </div>
        </section>
      `
    }).mount(el);
  }

  window.switchAICapTab = function switchAICapTabVue(tab) { mountAICap(); return vm?.switchTab(tab); };
  window.loadAICapData = function loadAICapDataVue(force = false) { mountAICap(); return vm?.refresh(!!force); };
  window.loadAICapChars = function loadAICapCharsVue(force = false) { mountAICap(); return vm?.refresh(!!force); };
  window.loadAICapScenes = function loadAICapScenesVue(force = false) { mountAICap(); return vm?.refresh(!!force); };
  window.loadAICapStyles = function loadAICapStylesVue(force = false) { mountAICap(); return vm?.refresh(!!force); };
  window.showCharModal = function showCharModalVue(id) { mountAICap(); return vm?.openChar(id); };
  window.editChar = window.showCharModal;
  window.closeCharModal = function closeCharModalVue() { return vm?.closeModal(); };
  window.saveChar = function saveCharVue() { return vm?.saveChar(); };
  window.deleteChar = function deleteCharVue(id) { mountAICap(); return vm?.remove('char', id); };
  window.removeCharRef = function removeCharRefVue(id, url) { mountAICap(); return vm?.removeCharRef(id, url); };
  window.aiGenCharImage = function aiGenCharImageVue(id) { mountAICap(); return vm?.generateChar(id); };
  window.genCharThreeView = function genCharThreeViewVue(id) { mountAICap(); return vm?.generateThreeView(id); };
  window.genCharExpressions = function genCharExpressionsVue(id) { mountAICap(); return vm?.generateExpressions(id); };
  window.openCharCard = function openCharCardVue(id) { mountAICap(); return vm?.openCharCard(id); };
  window.showSceneModal = function showSceneModalVue(id) { mountAICap(); return vm?.openScene(id); };
  window.editScene = window.showSceneModal;
  window.closeSceneModal = function closeSceneModalVue() { return vm?.closeModal(); };
  window.saveScene = function saveSceneVue() { return vm?.saveScene(); };
  window.deleteScene = function deleteSceneVue(id) { mountAICap(); return vm?.remove('scene', id); };
  window.aiGenSceneImage = function aiGenSceneImageVue(id) { mountAICap(); return vm?.generateScene(id); };
  window.aiGenSceneImageCard = window.aiGenSceneImage;
  window.showStyleModal = function showStyleModalVue(id) { mountAICap(); return vm?.openStyle(id); };
  window.editStyle = window.showStyleModal;
  window.closeStyleModal = function closeStyleModalVue() { return vm?.closeModal(); };
  window.saveStyle = function saveStyleVue() { return vm?.saveStyle(); };
  window.deleteStyle = function deleteStyleVue(id) { mountAICap(); return vm?.remove('style', id); };

  document.addEventListener('DOMContentLoaded', mountAICap);
})();
