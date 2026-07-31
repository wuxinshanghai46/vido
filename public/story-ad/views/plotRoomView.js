import { request } from '../api.js';
import { emptyState, escapeHtml, setButtonBusy, toast } from '../components/ui.js';
import { confirmDialog } from '../components/dialog.js';

/** 输出一个可编辑情节点。 */
function beatEditor(beat = {}, index = 0) {
  return `<article class="beat-row" data-beat-index="${index}">
    <header><code>B${String(index + 1).padStart(2, '0')}</code><input class="input" data-beat-field="title" value="${escapeHtml(beat.title || beat.role || '')}" placeholder="情节点名称"><span class="beat-actions"><button class="btn small ai-action" type="button" data-ai-beat>AI 帮写</button><button class="btn small danger delete-action" type="button" data-remove-beat><span aria-hidden="true">×</span><span>删除</span></button></span></header>
    <div class="form-grid">
      <label class="field full"><span>画面与剧情动作</span><textarea class="textarea" rows="3" data-beat-field="visual" placeholder="描述这一段实际发生的事情。">${escapeHtml(beat.visual || beat.plot || '')}</textarea></label>
      <label class="field"><span>人物动作</span><input class="input" data-beat-field="action" value="${escapeHtml(beat.action || '')}"></label>
      <label class="field"><span>时长（秒）</span><input class="input" type="number" min="1" max="30" data-beat-field="duration" value="${Number(beat.duration || beat.duration_sec || 3) || 3}"></label>
      <label class="field"><span>旁白或台词</span><input class="input" data-beat-field="spoken_line" value="${escapeHtml(beat.spoken_line || beat.voiceover || '')}"></label>
      <label class="field"><span>可见证据</span><input class="input" data-beat-field="visual_proof" value="${escapeHtml(beat.visual_proof || beat.purpose || '')}"></label>
    </div>
  </article>`;
}

function collectBeat(row) {
  const value = name => row.querySelector(`[data-beat-field="${name}"]`)?.value?.trim() || '';
  return {
    title: value('title'),
    visual: value('visual'),
    action: value('action'),
    duration: Math.max(1, Number(value('duration')) || 3),
    spoken_line: value('spoken_line'),
    visual_proof: value('visual_proof'),
  };
}

function applyBeat(row, beat = {}) {
  Object.entries({
    title: beat.title,
    visual: beat.visual,
    action: beat.action,
    duration: beat.duration,
    spoken_line: beat.spoken_line,
    visual_proof: beat.visual_proof,
  }).forEach(([name, value]) => {
    const field = row.querySelector(`[data-beat-field="${name}"]`);
    if (field && value !== undefined && value !== null) field.value = value;
  });
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
  host.querySelector('[data-beat-list]')?.addEventListener('click', async event => {
    const row = event.target.closest('[data-beat-index]');
    if (!row) return;
    const assistButton = event.target.closest('[data-ai-beat]');
    if (assistButton) {
      const rows = [...host.querySelectorAll('[data-beat-index]')];
      const index = rows.indexOf(row);
      try {
        setButtonBusy(assistButton, true, '帮写中…');
        const currentBlueprint = collectBlueprint(host, blueprint);
        const data = await request('/api/new-story-ad/assist', {
          method: 'POST',
          body: {
            mode: 'story_beat',
            task_id: bundle.project.id,
            story_assist_context: {
              current_blueprint: currentBlueprint,
              previous_beat: index > 0 ? collectBeat(rows[index - 1]) : null,
              current_beat: collectBeat(row),
              next_beat: index < rows.length - 1 ? collectBeat(rows[index + 1]) : null,
            },
          },
          timeoutMs: 180000,
        });
        applyBeat(row, data.story_beat || {});
        toast('AI 建议已填入当前情节点；确认内容后再保存剧情。', 'success');
      } catch (error) {
        toast(error.message, 'danger');
      } finally {
        setButtonBusy(assistButton, false);
      }
      return;
    }
    if (!event.target.closest('[data-remove-beat]')) return;
    if (!await confirmDialog('删除后，该情节点只会从当前编辑器移除；点击“保存剧情”后才会写入项目。', {
      title: '删除这个情节点？',
      confirmText: '确认删除',
      tone: 'danger',
    })) return;
    row.remove();
    [...host.querySelectorAll('[data-beat-index]')].forEach((item, index) => {
      item.dataset.beatIndex = index;
      item.querySelector('code').textContent = `B${String(index + 1).padStart(2, '0')}`;
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
