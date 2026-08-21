import { escapeHtml } from '../components/ui.js?v=20260821-dialogue-intake-v116';

export function beatEditor(beat = {}, index = 0) {
  const visual = beat.visual || beat.plot || '';
  const spoken = beat.spoken_line || beat.voiceover || '';
  return `<article class="beat-row" data-beat-index="${index}">
    <div class="beat-overview"><code>B${String(index + 1).padStart(2, '0')}</code><span class="beat-duration-summary" data-beat-summary="duration">${Number((Number(beat.duration || beat.duration_sec || 3) || 3).toFixed(2))}s</span><span class="beat-visual-cell"><strong class="beat-title-summary" data-beat-summary="title">${escapeHtml(beat.title || beat.role || `情节点 ${index + 1}`)}</strong><span class="beat-visual-summary" data-beat-summary="visual">${escapeHtml(visual || '等待补充画面与剧情动作')}</span></span><span class="beat-spoken-summary" data-beat-summary="spoken_line">${escapeHtml(spoken || '暂无对白 / 旁白')}</span><span class="beat-actions"><button class="btn small ai-action" type="button" data-ai-beat>AI 帮写</button><button class="btn small" type="button" data-toggle-beat-editor>编辑</button><button class="btn small danger delete-action" type="button" data-remove-beat aria-label="删除情节点"><span aria-hidden="true">×</span></button></span></div>
    <div class="beat-detail-editor" data-beat-editor hidden><div class="form-grid">
      <label class="field full"><span>情节点名称</span><input class="input" data-beat-field="title" value="${escapeHtml(beat.title || beat.role || '')}" placeholder="情节点名称"></label>
      <label class="field full"><span>画面与剧情动作</span><textarea class="textarea" rows="4" data-beat-field="visual" placeholder="描述这一段实际发生的事情。">${escapeHtml(visual)}</textarea></label>
      <label class="field"><span>人物动作</span><input class="input" data-beat-field="action" value="${escapeHtml(beat.action || '')}"></label>
      <label class="field"><span>时长（秒）</span><input class="input" type="number" min="1" max="30" step="0.01" data-beat-field="duration" value="${Number((Number(beat.duration || beat.duration_sec || 3) || 3).toFixed(2))}"></label>
      <label class="field"><span>旁白或台词</span><input class="input" data-beat-field="spoken_line" value="${escapeHtml(beat.spoken_line || beat.voiceover || '')}"></label>
      <label class="field"><span>可见证据</span><input class="input" data-beat-field="visual_proof" value="${escapeHtml(beat.visual_proof || beat.purpose || '')}"></label>
    </div><div class="beat-detail-actions"><button class="btn primary small" type="button" data-close-beat-editor>完成本段编辑</button></div></div>
  </article>`;
}

export function syncBeatPresentation(row) {
  const value = name => row.querySelector(`[data-beat-field="${name}"]`)?.value?.trim() || '';
  const set = (name, text) => { const target = row.querySelector(`[data-beat-summary="${name}"]`); if (target) target.textContent = text; };
  set('title', value('title') || '未命名情节点');
  set('duration', `${Math.max(1, Number(value('duration')) || 3)}s`);
  set('visual', value('visual') || '等待补充画面与剧情动作');
  set('spoken_line', value('spoken_line') || '暂无对白 / 旁白');
}

export function collectBeat(row) {
  const value = name => row.querySelector(`[data-beat-field="${name}"]`)?.value?.trim() || '';
  return { title: value('title'), visual: value('visual'), action: value('action'), duration: Math.max(1, Number(value('duration')) || 3), spoken_line: value('spoken_line'), visual_proof: value('visual_proof') };
}

export function applyBeat(row, beat = {}) {
  Object.entries({ title: beat.title, visual: beat.visual, action: beat.action, duration: beat.duration, spoken_line: beat.spoken_line, visual_proof: beat.visual_proof }).forEach(([name, value]) => {
    const field = row.querySelector(`[data-beat-field="${name}"]`);
    if (field && value !== undefined && value !== null) field.value = value;
  });
  syncBeatPresentation(row);
}

export function collectBlueprint(host, original = {}) {
  const beats = [...host.querySelectorAll('[data-beat-index]')].map((row, index) => {
    const current = collectBeat(row);
    return { ...(original.beats?.[index] || {}), index: index + 1, beat_index: index + 1, ...current, title: current.title || `情节点 ${index + 1}`, plot: current.visual, duration_sec: current.duration, voiceover: current.spoken_line, confirmed: true };
  });
  return { ...original, story_title: host.querySelector('[name="story_title"]')?.value?.trim() || '', logline: host.querySelector('[name="logline"]')?.value?.trim() || '', beats };
}
