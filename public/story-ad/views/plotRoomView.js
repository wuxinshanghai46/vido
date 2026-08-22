import { request } from '../api.js?v=20260822-provider-v163';
import { emptyState, escapeHtml, setButtonBusy, toast } from '../components/ui.js?v=20260822-provider-v163';
import { confirmDialog } from '../components/dialog.js?v=20260822-provider-v163';
import { applyBeat, beatEditor, collectBeat, collectBlueprint, syncBeatPresentation } from './plotBeatEditor.js?v=20260822-provider-v163';

function domainContractBanner(brief = {}) {
  const contract = brief.content_domain_contract || {};
  const narrative = brief.content_mode === 'narrative_story';
  const objective = contract.objective || (narrative ? '以人物、关系、因果和主题完成剧情' : '围绕商品或服务主体完成传播目标');
  const forbidden = Array.isArray(contract.forbidden) ? contract.forbidden.slice(0, 4).join('、') : (narrative ? '禁止混入商品卖点、购买号召和品牌落版' : '禁止丢失广告主体与可见传播证据');
  return `<section class="guide content-domain-banner"><b>${narrative ? '剧情专用规则' : '广告专用规则'}</b><span>${escapeHtml(objective)}</span><small>${escapeHtml(forbidden)}</small></section>`;
}

function characterEditor(character = {}, index = 0) {
  const gender = String(character.gender || '').toLowerCase();
  const complete = !!(character.name && character.gender && (character.age_range || character.age) && character.role);
  return `<details class="story-character-card" data-character-index="${index}"${complete ? '' : ' open'}><summary><span><b>${escapeHtml(character.name || `角色 ${index + 1}`)}</b><small>${escapeHtml([character.gender === 'female' ? '女' : character.gender === 'male' ? '男' : '', character.age_range || character.age, character.role].filter(Boolean).join(' · ') || '基础信息待补充')}</small></span><span>展开详情</span></summary><div class="story-character-fields">
    <input type="hidden" data-character-field="id" value="${escapeHtml(character.id || character.character_id || `character_${index + 1}`)}">
    <label><span>姓名</span><input class="input" data-character-field="name" value="${escapeHtml(character.name || '')}" placeholder="待确认"></label>
    <label><span>性别</span><select class="input" data-character-field="gender"><option value=""${!gender ? ' selected' : ''}>待确认</option><option value="female"${gender === 'female' || gender === '女' ? ' selected' : ''}>女</option><option value="male"${gender === 'male' || gender === '男' ? ' selected' : ''}>男</option><option value="unspecified"${gender === 'unspecified' ? ' selected' : ''}>不限定</option></select></label>
    <label><span>年龄</span><input class="input" data-character-field="age_range" value="${escapeHtml(character.age_range || character.age || '')}" placeholder="如 28~35 岁"></label>
    <label><span>身份 / 职责</span><input class="input" data-character-field="role" value="${escapeHtml(character.role || '')}" placeholder="如 空间设计师"></label>
    <label><span>人物关系</span><input class="input" data-character-field="relationship" value="${escapeHtml(character.relationship || '')}" placeholder="如 向客户介绍方案"></label>
    <label><span>音色</span><select class="input" data-character-field="voice_id" data-current-voice="${escapeHtml(character.voice?.voice_id || character.voice_id || '')}"><option value="">未指定（生成前需确认）</option></select></label>
    <label><span>声音表演</span><input class="input" data-character-field="voice_tone" value="${escapeHtml(character.voice?.direction || character.voice_tone || '')}" placeholder="如 沉稳、清晰、语速自然"></label>
    <label class="character-description"><span>人物设定</span><textarea class="textarea" rows="2" data-character-field="description">${escapeHtml(character.description || '')}</textarea></label>
  </div></details>`;
}

export async function mount(host, context) {
  const { bundle, store } = context;
  const savedBlueprint = bundle?.story?.blueprint || null;
  const referenceDraft = bundle?.story?.reference_draft || null;
  const blueprint = savedBlueprint || referenceDraft;
  const failureCode = String(bundle?.generation?.progress?.error_code || bundle?.project?.error_code || '').toUpperCase();
  const savedQualityDraft = !blueprint && failureCode === 'BLUEPRINT_POLISH_QUALITY_FAILED';
  const isReferenceDraft = !savedBlueprint && !!referenceDraft;
  const draftNeedsGeneration = isReferenceDraft && (blueprint?.beats || []).some(beat => !String(beat.visual || beat.plot || '').trim() || !String(beat.spoken_line || beat.voiceover || '').trim());
  const characters = Array.isArray(blueprint?.characters) ? blueprint.characters : [];
  host.innerHTML = `
    <section class="view-head">
      <div><h1>${bundle.brief?.content_mode === 'narrative_story' ? '剧情与对白' : '广告剧情与对白'}</h1><p>第 2 步先把创作设想展开为详细分段、动作、旁白和对白；确认后才从剧情提取人物与场景。</p>${isReferenceDraft ? '<span class="status-tag is-neutral">参考视频提取草稿 · 待优化</span>' : ''}</div>
      <div class="view-actions">
        <button class="btn" type="button" data-import-script>导入脚本</button>
        ${blueprint ? `<button class="btn" type="button" data-add-beat>＋ 添加情节点</button>${isReferenceDraft ? `<button class="btn" type="button" data-save-story>保存当前草稿</button><button class="btn primary" type="button" data-generate-story>${draftNeedsGeneration ? 'AI 补全剧情、动作与对白' : 'AI 生成完整剧情与对白'}</button>` : '<button class="btn" type="button" data-save-story>保存剧情</button><button class="btn" type="button" data-regenerate-story>重新生成剧情</button><button class="btn primary" type="button" data-open-storyboard>确认剧情，进入人物</button>'}` : '<button class="btn primary" type="button" data-generate-story>生成详细剧情与对白</button>'}
      </div>
    </section>
    ${domainContractBanner(bundle.brief || {})}
    <div class="guide">${isReferenceDraft ? '这里仅显示参考视频提取的故事草稿。请先补齐分段、动作和对白，确认后再提取人物。' : '先确认故事因果、每段动作和对白。人物、场景、线稿与分镜都从这份已确认剧情继续，避免先生成资产再反过来改故事。'}</div>
    <input class="hidden-input" hidden type="file" accept=".txt,.md,text/plain,text/markdown" data-script-file>
    ${blueprint ? `<div class="plot-layout plot-workspace">
      <section class="card story-overview-card">
        <div class="card-head"><div><h2>故事设定</h2><p>${isReferenceDraft ? '来自参考视频分析，尚未保存为正式剧情。' : '来自当前任务蓝图。'}</p></div></div>
        <div class="card-body story-overview-grid story-only-grid">
          <label class="field story-summary-surface"><span>故事标题</span><textarea class="textarea" name="story_title" rows="4">${escapeHtml(blueprint.story_title || blueprint.title || '')}</textarea></label>
          <label class="field story-summary-surface"><span>一句话剧情</span><textarea class="textarea" name="logline" rows="4">${escapeHtml(blueprint.logline || blueprint.summary || '')}</textarea></label>
        </div>
      </section>
      <section class="card story-characters-card"><div class="card-head"><div><h2>角色设定</h2><p>基础信息与音色会按稳定人物 ID 同步到下一步人物资产和配音。</p></div><span class="status-tag is-info">${characters.length} 个角色</span></div><div class="card-body story-character-grid">${characters.length ? characters.map(characterEditor).join('') : '<span class="chip">当前蓝图没有独立角色记录</span>'}</div></section>
      <section class="card plot-sequence-card">
        <div class="card-head"><div><h2>剧情、动作与对白</h2><p>完整制作表平铺显示；每一列都可以展开编辑，后续人物、场景和分镜沿用同一份数据。</p></div><span class="status-tag is-info">${(blueprint.beats || []).length} 个情节点</span></div>
        <div class="beat-table-scroll"><div class="beat-table-head" aria-hidden="true"><span>镜号</span><span>时长</span><span>场景</span><span>画面描述 / 动作</span><span>景别</span><span>光影氛围</span><span>对白 / 旁白</span><span>音效</span><span>运镜</span><span>镜头提示</span><span>操作</span></div>
        <div class="card-body beat-list" data-beat-list>${(blueprint.beats || []).map(beatEditor).join('')}</div></div>
      </section>
    </div>` : `<section class="card">${emptyState({
      title: savedQualityDraft ? '脚本初稿已保存，等待重新检查' : '还没有剧情蓝图',
      body: savedQualityDraft
        ? '上次初稿没有进入后续制作。系统会复用已经保存的初稿，重新按统一的时长与口播标准检查。'
        : '系统会根据当前对话确认单生成详细剧情、动作、旁白与对白；不会引用其他项目内容。',
      action: savedQualityDraft ? '重新检查已保存初稿' : '生成详细剧情与对白',
      actionId: 'generate-story',
    })}</section>`}`;

  if (characters.length) {
    request('/api/avatar/voice-list', { timeoutMs: 30000 }).then(data => {
      const voices = Array.isArray(data.voices) ? data.voices.filter(voice => voice && voice.id) : [];
      host.querySelectorAll('[data-character-field="voice_id"]').forEach(select => {
        const selected = select.dataset.currentVoice || '';
        select.insertAdjacentHTML('beforeend', voices.map(voice => `<option value="${escapeHtml(voice.id)}"${voice.id === selected ? ' selected' : ''}>${escapeHtml(voice.name || voice.label || voice.id)}</option>`).join(''));
      });
    }).catch(() => toast('音色列表暂时无法加载；已保留原音色绑定，可稍后重试。', 'warning'));
  }

  const generate = async (button, force = false) => {
    try {
      setButtonBusy(button, true, '正在提交…', { elapsed: true });
      await store.runStage('blueprint', force ? { force_regenerate: true } : {});
      toast('全部剧情生成任务已提交。', 'success');
      await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  };
  host.querySelector('[data-generate-story]')?.addEventListener('click', event => generate(event.currentTarget));
  host.querySelector('[data-empty-action="generate-story"]')?.addEventListener('click', event => generate(event.currentTarget));
  host.querySelector('[data-regenerate-story]')?.addEventListener('click', async event => {
    if (!await confirmDialog('将重新生成故事标题、一句话剧情和全部情节点；当前剧情及已有分镜、线稿和下游媒体会按版本失效。', {
      title: '批量重生成全部剧情', confirmText: '确认批量生成',
    })) return;
    await generate(event.currentTarget, true);
  });

  const scriptInput = host.querySelector('[data-script-file]');
  host.querySelector('[data-import-script]')?.addEventListener('click', () => scriptInput?.click());
  scriptInput?.addEventListener('change', async () => {
    const file = scriptInput.files?.[0];
    if (!file) return;
    const button = host.querySelector('[data-import-script]');
    let importedName = '';
    try {
      const text = await file.text();
      if (!text.trim()) throw new Error('脚本文本为空。');
      setButtonBusy(button, true, '正在导入…');
      await store.updateRequest({
        creative_direction: { raw: text.slice(0, 12000), source_name: file.name },
      });
      importedName = file.name;
      toast('脚本已作为剧情生成依据导入；请在剧情室生成或继续编辑剧情。', 'success');
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
      if (importedName) {
        button.textContent = `已导入：${importedName}`;
        button.dataset.previousText = button.textContent;
      }
      scriptInput.value = '';
    }
  });

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
        setButtonBusy(assistButton, true, '帮写中…', { elapsed: true });
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
    const toggle = event.target.closest('[data-toggle-beat-editor]');
    if (toggle) {
      const editor = row.querySelector('[data-beat-editor]');
      editor.hidden = !editor.hidden;
      return;
    }
    if (event.target.closest('[data-close-beat-editor]')) {
      syncBeatPresentation(row);
      row.querySelector('[data-beat-editor]').hidden = true;
      return;
    }
    const menuButton = event.target.closest('[data-row-menu]');
    if (menuButton) { const menu = row.querySelector('.beat-row-menu'); menu.hidden = !menu.hidden; return; }
    if (event.target.closest('[data-duplicate-beat]')) {
      const copy = collectBeat(row); copy.shot_id = ''; const wrapper = document.createElement('div'); wrapper.innerHTML = beatEditor(copy, host.querySelectorAll('[data-beat-index]').length); row.after(wrapper.firstElementChild); return;
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
  host.querySelector('[data-beat-list]')?.addEventListener('input', event => {
    const row = event.target.closest('[data-beat-index]');
    if (row) syncBeatPresentation(row);
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
  host.querySelector('[data-open-storyboard]')?.addEventListener('click', () => {
    context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=assets`);
  });
}
