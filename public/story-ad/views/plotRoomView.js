import { emptyState, escapeHtml, setButtonBusy, toast } from '../components/ui.js';

/** 输出一个可编辑情节点。 */
function beatEditor(beat = {}, index = 0) {
  return `<article class="beat-row" data-beat-index="${index}">
    <header><code>B${String(index + 1).padStart(2, '0')}</code><input class="input" data-beat-field="title" value="${escapeHtml(beat.title || beat.role || '')}" placeholder="情节点名称"><button class="btn small danger" type="button" data-remove-beat>删除</button></header>
    <div class="form-grid">
      <label class="field full"><span>画面与剧情动作</span><textarea class="textarea" rows="3" data-beat-field="visual" placeholder="描述这一段实际发生的事情。">${escapeHtml(beat.visual || beat.plot || '')}</textarea></label>
      <label class="field"><span>人物动作</span><input class="input" data-beat-field="action" value="${escapeHtml(beat.action || '')}"></label>
      <label class="field"><span>时长（秒）</span><input class="input" type="number" min="1" max="30" data-beat-field="duration" value="${Number(beat.duration || beat.duration_sec || 3) || 3}"></label>
      <label class="field"><span>旁白或台词</span><input class="input" data-beat-field="spoken_line" value="${escapeHtml(beat.spoken_line || beat.voiceover || '')}"></label>
      <label class="field"><span>可见证据</span><input class="input" data-beat-field="visual_proof" value="${escapeHtml(beat.visual_proof || beat.purpose || '')}"></label>
    </div>
  </article>`;
}

/** 从当前编辑器收集剧情蓝图。 */
function collectBlueprint(host, original = {}) {
  const beats = [...host.querySelectorAll('[data-beat-index]')].map((row, index) => {
    const value = name => row.querySelector(`[data-beat-field="${name}"]`)?.value?.trim() || '';
    return {
      ...(original.beats?.[index] || {}),
      index: index + 1,
      beat_index: index + 1,
      title: value('title') || `情节点 ${index + 1}`,
      visual: value('visual'),
      plot: value('visual'),
      action: value('action'),
      duration: Math.max(1, Number(value('duration')) || 3),
      duration_sec: Math.max(1, Number(value('duration')) || 3),
      spoken_line: value('spoken_line'),
      voiceover: value('spoken_line'),
      visual_proof: value('visual_proof'),
      confirmed: true,
    };
  });
  return {
    ...original,
    story_title: host.querySelector('[name="story_title"]')?.value?.trim() || '',
    logline: host.querySelector('[name="logline"]')?.value?.trim() || '',
    beats,
  };
}

/** 挂载剧情室。 */
export async function mount(host, context) {
  const { bundle, store } = context;
  const blueprint = bundle?.story?.blueprint || null;
  const characters = Array.isArray(blueprint?.characters) ? blueprint.characters : [];
  host.innerHTML = `
    <section class="view-head">
      <div><h1>剧情室</h1><p>剧情蓝图是分镜和镜头的唯一上游；人物、商品和场景都从资产中心引用。</p></div>
      <div class="view-actions">
        ${blueprint ? '<button class="btn" type="button" data-add-beat>＋ 添加情节点</button><button class="btn primary" type="button" data-save-story>保存剧情</button>' : '<button class="btn primary" type="button" data-generate-story>生成剧情蓝图</button>'}
      </div>
    </section>
    <div class="guide">先确认故事因果和品牌目标，再进入分镜。修改剧情会使下游镜头按现有版本规则失效。</div>
    ${blueprint ? `<div class="plot-layout">
      <aside class="card">
        <div class="card-head"><div><h2>故事与角色</h2><p>来自当前任务蓝图。</p></div></div>
        <div class="card-body form-grid">
          <label class="field full"><span>故事标题</span><input class="input" name="story_title" value="${escapeHtml(blueprint.story_title || blueprint.title || '')}"></label>
          <label class="field full"><span>一句话剧情</span><textarea class="textarea" name="logline" rows="5">${escapeHtml(blueprint.logline || blueprint.summary || '')}</textarea></label>
          <div class="field full"><span>角色</span><div class="binding-chips">${characters.length ? characters.map(character => `<span class="chip ok">${escapeHtml(character.name || character.role || '角色')}</span>`).join('') : '<span class="chip">当前蓝图没有独立角色记录</span>'}</div></div>
        </div>
      </aside>
      <section class="card">
        <div class="card-head"><div><h2>情节点</h2><p>按故事发生顺序排列。</p></div></div>
        <div class="card-body beat-list" data-beat-list>${(blueprint.beats || []).map(beatEditor).join('')}</div>
      </section>
    </div>` : `<section class="card">${emptyState({
      title: '还没有剧情蓝图',
      body: '系统会根据当前目标、人物、商品和场景生成剧情；不会引用原型或其他任务内容。',
      action: '生成剧情蓝图',
      actionId: 'generate-story',
    })}</section>`}`;

  const generate = async button => {
    try {
      setButtonBusy(button, true, '正在提交…');
      await store.runStage('blueprint');
      toast('剧情生成任务已提交。', 'success');
      await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  };
  host.querySelector('[data-generate-story]')?.addEventListener('click', event => generate(event.currentTarget));
  host.querySelector('[data-empty-action="generate-story"]')?.addEventListener('click', event => generate(event.currentTarget));

  host.querySelector('[data-add-beat]')?.addEventListener('click', () => {
    const list = host.querySelector('[data-beat-list]');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = beatEditor({}, list.children.length);
    list.appendChild(wrapper.firstElementChild);
  });
  host.querySelector('[data-beat-list]')?.addEventListener('click', event => {
    if (!event.target.closest('[data-remove-beat]')) return;
    event.target.closest('[data-beat-index]')?.remove();
    [...host.querySelectorAll('[data-beat-index]')].forEach((row, index) => {
      row.dataset.beatIndex = index;
      row.querySelector('code').textContent = `B${String(index + 1).padStart(2, '0')}`;
    });
  });
  host.querySelector('[data-save-story]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, '保存中…');
      await store.saveBlueprint(collectBlueprint(host, blueprint));
      toast('剧情蓝图已保存。', 'success');
      await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  });
}
