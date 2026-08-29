import { request } from '../api.js?v=20260829-production-v279c';
import { emptyState, escapeHtml, setButtonBusy, toast } from '../components/ui.js?v=20260829-production-v279c';
import { confirmDialog } from '../components/dialog.js?v=20260829-production-v279c';
import { applyBeat, beatEditor, collectBeat, collectBlueprint, productionIssues, syncFloatingEditor } from './plotBeatEditor.js?v=20260829-production-v279c';

function characterEditor(character = {}, index = 0) {
  const gender = String(character.gender || '').toLowerCase();
  const age = character.age_range || character.age;
  const complete = !!(character.name && character.gender && age && character.role);
  return `<details class="story-character-card" data-character-index="${index}"${complete ? '' : ' open'}><summary><span><b>${escapeHtml(character.name || `角色 ${index + 1}`)}</b><small>${escapeHtml([character.gender === 'female' ? '女' : character.gender === 'male' ? '男' : '', age, character.role].filter(Boolean).join(' · ') || '基础信息待补充')}</small></span><span>展开详情</span></summary><div class="story-character-fields">
    <input type="hidden" data-character-field="id" value="${escapeHtml(character.id || character.character_id || `character_${index + 1}`)}">
    <label><span>姓名</span><input class="input" data-character-field="name" value="${escapeHtml(character.name || '')}" placeholder="待确认"></label>
    <label><span>性别</span><select class="input" data-character-field="gender"><option value=""${!gender ? ' selected' : ''}>待确认</option><option value="female"${gender === 'female' || gender === '女' ? ' selected' : ''}>女</option><option value="male"${gender === 'male' || gender === '男' ? ' selected' : ''}>男</option><option value="unspecified"${gender === 'unspecified' ? ' selected' : ''}>不限定</option></select></label>
    <label><span>年龄</span><input class="input" data-character-field="age_range" value="${escapeHtml(age || '')}" placeholder="如 28~35 岁"></label>
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
  const savedQualityDraft = failureCode === 'BLUEPRINT_POLISH_QUALITY_FAILED';
  const isReferenceDraft = !savedBlueprint && !!referenceDraft;
  const draftNeedsGeneration = isReferenceDraft && (blueprint?.beats || []).some(beat => !String(beat.visual || beat.plot || '').trim() || !String(beat.spoken_line || beat.voiceover || '').trim());
  const characters = Array.isArray(blueprint?.characters) ? blueprint.characters : [];
  const castIntent = bundle?.brief?.brief_intake?.cast_intent || bundle?.brief?.cast_intent || {};
  const expectedCharacters = castIntent.confirmed === true ? Number(castIntent.expected_people || 0) : characters.length;
  const castMismatch = castIntent.confirmed === true && characters.filter(item => item?.on_screen !== false).length !== expectedCharacters;
  host.innerHTML = `
    <section class="view-head plot-view-head">
      <div><h1>${bundle.brief?.content_mode === 'narrative_story' ? '剧情与对白' : '广告剧情与对白'}</h1><p>第 2 步先把创作设想展开为详细分段、动作、旁白和对白；确认后才从剧情提取人物与场景。</p>${isReferenceDraft ? '<span class="status-tag is-neutral">参考视频提取草稿 · 待优化</span>' : ''}</div>
      <div class="view-actions plot-view-actions">
        <button class="btn" type="button" data-import-script>导入脚本</button>
        ${blueprint ? `${isReferenceDraft ? `<button class="btn" type="button" data-save-story>保存草稿</button><button class="btn primary" type="button" data-generate-story>${draftNeedsGeneration ? 'AI 补全剧情' : 'AI 完善剧情'}</button>` : `<button class="btn" type="button" data-save-story>保存剧情</button><button class="btn" type="button" ${savedQualityDraft ? 'data-recheck-story' : 'data-regenerate-story'}>${savedQualityDraft ? '重新检查初稿' : (castMismatch ? `按 ${expectedCharacters} 人重新生成` : '重新生成')}</button><button class="btn primary" type="button" data-open-storyboard>确认并进入人物</button>`}` : '<button class="btn primary" type="button" data-generate-story>生成剧情蓝图</button>'}
      </div>
    </section>
    <input class="hidden-input" hidden type="file" accept=".txt,.md,text/plain,text/markdown" data-script-file>
    ${blueprint ? `<div class="plot-layout plot-workspace">
      <section class="card story-overview-card">
        <div class="card-head"><div><h2>故事设定</h2><p>${isReferenceDraft ? '来自参考视频分析，尚未保存为正式剧情。' : '来自当前任务蓝图。'}</p></div></div>
        <div class="card-body story-overview-grid story-only-grid">
          <label class="field story-summary-surface"><span>故事标题</span><textarea class="textarea" name="story_title" rows="2">${escapeHtml(blueprint.story_title || blueprint.title || '')}</textarea></label>
          <label class="field story-summary-surface"><span>一句话剧情</span><textarea class="textarea" name="logline" rows="2">${escapeHtml(blueprint.logline || blueprint.summary || '')}</textarea></label>
        </div>
      </section>
      <section class="card story-characters-card"><div class="card-head"><div><h2>角色设定</h2><p>修改后自动保存，并同步到下一步人物资产和配音。</p></div><div class="story-character-save-actions"><span data-character-save-status data-state="idle" aria-live="polite">修改后自动保存</span><button class="btn small" type="button" data-save-characters>保存角色设置</button><span class="status-tag ${castMismatch ? 'is-warning' : 'is-info'}">${castMismatch ? `已确认 ${expectedCharacters} 人，当前剧情仅 ${characters.length} 人` : `${characters.length} 个角色`}</span></div></div><div class="card-body story-character-grid">${characters.length ? characters.map(characterEditor).join('') : '<span class="chip">当前蓝图没有独立角色记录</span>'}</div></section>
      <section class="card plot-sequence-card">
        <div class="card-head"><div><h2>剧情、动作与对白</h2><p>点击任意单元格编辑，人物、场景和后续分镜沿用同一份数据。</p></div><div class="plot-sequence-actions"><span data-production-completeness></span><button class="btn small" type="button" data-add-beat>＋ 新增镜头</button></div></div>
        <div class="beat-table-scroll"><div class="beat-table-head" aria-hidden="true"><span>镜号</span><span>时长</span><span>场景</span><span>画面描述 / 动作</span><span>景别</span><span>光影氛围</span><span>声音内容（旁白 / 对白）</span><span>音效</span><span>运镜</span><span>镜头提示</span><span>操作</span></div>
        <div class="card-body beat-list" data-beat-list>${(blueprint.beats || []).map(beatEditor).join('')}</div></div>
      </section>
    </div><div class="beat-floating-editor" data-beat-floating-editor role="dialog" popover="auto"></div>` : `<section class="card">${emptyState({
      title: savedQualityDraft ? '脚本初稿已保存，等待重新检查' : '还没有剧情蓝图',
      body: savedQualityDraft
        ? '上次初稿没有进入后续制作。系统会复用已经保存的初稿，重新按统一的时长与口播标准检查。'
        : '系统会根据当前对话确认单生成详细剧情、动作、旁白与对白；不会引用其他项目内容。',
      action: savedQualityDraft ? '重新检查已保存初稿' : '生成剧情蓝图',
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

  const characterAutosave = characters.length
    ? (await import('./plotCharacterAutosave.js?v=20260829-production-v279c'))
      .bindCharacterAutosave({ host, blueprint, store, collectBlueprint, toast })
    : null;

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
  host.querySelector('[data-recheck-story]')?.addEventListener('click', event => generate(event.currentTarget));
  host.querySelector('[data-regenerate-story]')?.addEventListener('click', async event => {
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

  const pop = host.querySelector('[data-beat-floating-editor]');
  let active = null, cellEditorModule, promptModule;
  const closeAll = () => { host.querySelectorAll(':popover-open').forEach(node => node.hidePopover()); active = null; };
  const refreshState = () => {
    const target = host.querySelector('[data-production-completeness]');
    if (!target) return;
    const issues = productionIssues(host);
    const labels = { scene: '场景', visual: '画面', shot_size: '景别', lighting_mood: '光影', sound_design: '声音', camera_movement: '运镜', prompt_notes: '提示词' };
    const counts = Object.entries(issues.reduce((all, item) => ((all[item.group] ||= []).push(item), all), {}));
    target.textContent = issues.length ? `待补：${counts.map(([group, rows]) => `${labels[group] || group} ${rows.length}`).join(' · ')}` : '制作信息已完整';
    target.className = issues.length ? 'is-warning' : 'is-complete';
  };
  const place = button => {
    const rect = button.getBoundingClientRect();
    const width = Math.min(pop.offsetWidth || 520, window.innerWidth - 24);
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    let top = rect.bottom + 8;
    const height = pop.offsetHeight || 280;
    if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 8);
    pop.style.left = `${left}px`; pop.style.top = `${top}px`;
  };
  const openEditor = async (button, row, group) => {
    if (group === 'prompt_notes') {
      promptModule ||= await import('./plotPromptPreview.js?v=20260829-production-v279c');
      await promptModule.openPromptPreview({ pop, row, host, projectId: bundle.project.id, place: () => place(button), closeAll });
      return;
    }
    cellEditorModule ||= await import('./plotBeatCellPopover.js?v=20260829-production-v279c');
    const currentCharacters = collectBlueprint(host, blueprint).characters;
    closeAll(); active = row; pop.innerHTML = cellEditorModule.beatCellEditor(row, group, currentCharacters); pop.dataset.group = group; pop.dataset.dialogueEditor = group === 'spoken_line' ? 'true' : 'false'; pop.showPopover(); place(button);
    pop.querySelector('[data-floating-field]')?.focus();
  };
  const reindex = () => [...host.querySelectorAll('[data-beat-index]')].forEach((item, index) => {
    item.dataset.beatIndex = index;
    item.querySelector('code').textContent = `B${String(index + 1).padStart(2, '0')}`;
  });
  const appendBeat = () => {
    const list = host.querySelector('[data-beat-list]');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = beatEditor({}, list.children.length);
    list.appendChild(wrapper.firstElementChild);
    reindex(); refreshState();
    list.lastElementChild?.querySelector('[data-open-beat-cell="visual"]')?.click();
  };
  host.querySelectorAll('[data-add-beat]').forEach(button => button.addEventListener('click', appendBeat));
  const syncPop = () => { if (active) { syncFloatingEditor(pop, active); refreshState(); } };
  pop?.addEventListener('input', syncPop); pop?.addEventListener('change', syncPop);
  pop?.addEventListener('click', event => {
    if (cellEditorModule?.handleCameraPreset(pop, event.target)) { syncPop(); return; }
    if (cellEditorModule?.handleDialogueAction(pop, event.target, collectBlueprint(host, blueprint).characters)) { syncPop(); return; }
    if (event.target.closest('[data-close-beat-floating]')) closeAll();
    if (event.target.closest('[data-save-beat-floating]')) { const message = cellEditorModule?.validateDialogueEditor?.(pop) || ''; if (message) { toast(message, 'warning'); return; } syncPop(); closeAll(); }
  });
  pop?.addEventListener('change', event => {
    if (cellEditorModule?.handleDialogueAction(pop, event.target, collectBlueprint(host, blueprint).characters)) syncPop();
  });
  host.querySelector('[data-beat-list]')?.addEventListener('click', async event => {
    const row = event.target.closest('[data-beat-index]');
    if (!row) return;
    const assistButton = event.target.closest('[data-ai-beat]');
    if (assistButton) {
      closeAll();
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
        refreshState();
        toast('AI 建议已填入当前镜头；确认内容后再保存剧情。', 'success');
      } catch (error) {
        toast(error.message, 'danger');
      } finally {
        setButtonBusy(assistButton, false);
      }
      return;
    }
    const cellButton = event.target.closest('[data-open-beat-cell]');
    if (cellButton) { await openEditor(cellButton, row, cellButton.dataset.openBeatCell); return; }
    const menuButton = event.target.closest('[data-row-menu]');
    if (menuButton) {
      const menu = row.querySelector('.beat-row-menu'), open = menu.matches(':popover-open'); closeAll();
      if (!open) { const rect = menuButton.getBoundingClientRect(); menu.style.left = `${Math.max(12, rect.left - 132)}px`; menu.style.top = `${Math.max(12, rect.top)}px`; menu.showPopover(); }
      return;
    }
    if (event.target.closest('[data-duplicate-beat]')) {
      closeAll(); const copy = collectBeat(row); copy.shot_id = ''; const wrapper = document.createElement('div'); wrapper.innerHTML = beatEditor(copy, host.querySelectorAll('[data-beat-index]').length); row.after(wrapper.firstElementChild); reindex(); refreshState(); return;
    }
    if (!event.target.closest('[data-remove-beat]')) return;
    if (!await confirmDialog('删除后，该情节点只会从当前编辑器移除；点击“保存剧情”后才会写入项目。', {
      title: '删除这个情节点？',
      confirmText: '确认删除',
      tone: 'danger',
    })) return;
    closeAll(); row.remove(); reindex(); refreshState();
  });
  refreshState();
  host.querySelector('[data-save-story]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      characterAutosave?.cancelPending();
      setButtonBusy(button, true, '保存中…');
      await store.saveBlueprint(collectBlueprint(host, blueprint));
      characterAutosave?.markSaved();
      toast('剧情蓝图已保存。', 'success');
      await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  });
  host.querySelector('[data-open-storyboard]')?.addEventListener('click', async () => {
    if (castMismatch) {
      host.querySelector('.story-characters-card')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      toast(`已确认 ${expectedCharacters} 人出镜，但当前历史剧情只有 ${characters.length} 人；请重新生成剧情后再进入人物。`, 'warning');
      return;
    }
    const issues = productionIssues(host);
    if (issues.length) {
      const first = issues[0];
      const button = first.row.querySelector(`[data-open-beat-cell="${first.group}"]`);
      if (button) { button.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); openEditor(button, first.row, first.group); }
      toast('制作表仍有空项，已为你打开第一个需要补充的位置。', 'warning');
      return;
    }
    try {
      await characterAutosave?.flush();
    } catch {
      host.querySelector('.story-characters-card')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=assets`);
  });
}
