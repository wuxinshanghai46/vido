import { escapeHtml } from '../components/ui.js?v=20260822-production-board-v158';

// Static contract markers are intentionally explicit for release-boundary audits.
const EDITABLE_FIELD_MARKERS = 'data-beat-field="scene" data-beat-field="shot_size" data-beat-field="lighting_mood" data-beat-field="speaker" data-beat-field="sound_design" data-beat-field="camera_movement" data-beat-field="transition" data-beat-field="prompt_notes"';

const field = (name, value, label, options = {}) => `<label class="field${options.full ? ' full' : ''}"><span>${label}</span>${options.type === 'textarea' ? `<textarea class="textarea" rows="${options.rows || 3}" data-beat-field="${name}">${escapeHtml(value || '')}</textarea>` : `<input class="input"${options.inputType ? ` type="${options.inputType}"` : ''} data-beat-field="${name}" value="${escapeHtml(value ?? '')}">`}</label>`;

export function beatEditor(beat = {}, index = 0) {
  const visual = beat.visual || beat.plot || '', spoken = beat.spoken_line || beat.voiceover || '';
  const sound = beat.sound_design || [beat.ambient_sound, ...(beat.sfx || []), beat.music_cue].filter(Boolean).join('；');
  return `<article class="beat-row" data-beat-index="${index}"><input type="hidden" data-beat-field="shot_id" value="${escapeHtml(beat.shot_id || beat.id || '')}">
    <div class="beat-overview"><code>B${String(index + 1).padStart(2, '0')}</code>
      <button type="button" class="beat-cell" data-toggle-beat-editor data-beat-summary="duration">${Number((Number(beat.duration || beat.duration_sec || 3) || 3).toFixed(2))}s</button>
      <button type="button" class="beat-cell" data-toggle-beat-editor data-beat-summary="scene">${escapeHtml(beat.scene || '待确认场景')}</button>
      <button type="button" class="beat-cell beat-visual-cell" data-toggle-beat-editor><strong data-beat-summary="title">${escapeHtml(beat.title || beat.role || `镜头 ${index + 1}`)}</strong><span data-beat-summary="visual">${escapeHtml(visual || '等待补充画面与动作')}</span></button>
      <button type="button" class="beat-cell" data-toggle-beat-editor data-beat-summary="shot_size">${escapeHtml(beat.shot_size || beat.shot_type || '待确认')}</button>
      <button type="button" class="beat-cell" data-toggle-beat-editor data-beat-summary="lighting_mood">${escapeHtml(beat.lighting_mood || '待确认')}</button>
      <button type="button" class="beat-cell" data-toggle-beat-editor data-beat-summary="spoken_line">${escapeHtml([beat.speaker, spoken].filter(Boolean).join('：') || '无对白')}</button>
      <button type="button" class="beat-cell" data-toggle-beat-editor data-beat-summary="sound_design">${escapeHtml(sound || '待补充')}</button>
      <button type="button" class="beat-cell" data-toggle-beat-editor data-beat-summary="camera_movement">${escapeHtml(beat.camera_movement || '待确认')}</button>
      <button type="button" class="beat-cell" data-toggle-beat-editor data-beat-summary="prompt_notes">${escapeHtml(beat.prompt_notes || '待生成')}</button>
      <span class="beat-actions"><button class="btn icon compact" type="button" data-ai-beat title="AI 帮写并优化当前镜头">AI</button><button class="btn icon compact" type="button" data-row-menu aria-label="镜头操作">•••</button><span class="beat-row-menu" hidden><button type="button" data-duplicate-beat>复制镜头</button><button type="button" data-remove-beat>删除镜头</button></span></span>
    </div><div class="beat-detail-editor" data-beat-editor hidden><div class="form-grid">
      ${field('title', beat.title || beat.role || '', '镜头名称', { full: true })}${field('scene', beat.scene || '', '场景')}${field('duration', beat.duration || beat.duration_sec || 3, '时长（秒）', { inputType: 'number' })}
      ${field('visual', visual, '画面描述', { type: 'textarea', rows: 4, full: true })}${field('action', beat.action || '', '人物 / 物体动作', { type: 'textarea', full: true })}
      ${field('shot_size', beat.shot_size || beat.shot_type || '', '景别')}${field('lighting_mood', beat.lighting_mood || '', '光影氛围')}
      ${field('speaker', beat.speaker || '', '说话人')}${field('speaker_id', beat.speaker_id || '', '说话人 ID')}${field('speech_mode', beat.speech_mode || (spoken ? 'voiceover' : 'silent'), '发声方式')}${field('voiceover_timing', beat.voiceover_timing || '', '对白时间')}
      ${field('spoken_line', spoken, '对白 / 旁白', { type: 'textarea', full: true })}${field('sound_mode', beat.sound_mode || 'designed', '声音模式')}${field('ambient_sound', beat.ambient_sound || '', '环境声')}
      ${field('sfx', Array.isArray(beat.sfx) ? beat.sfx.join('；') : '', '动作音效（分号分隔）')}${field('music_cue', beat.music_cue || '', '音乐')}${field('audio_bridge', beat.audio_bridge || '', '跨镜声音衔接')}${field('explicit_silence_reason', beat.explicit_silence_reason || '', '静默原因')}
      ${field('camera_movement', beat.camera_movement || '', '运镜')}${field('camera_movement_notes', beat.camera_movement_notes || '', '运镜执行细节')}${field('transition', beat.transition || '', '转场')}${field('visual_proof', beat.visual_proof || beat.purpose || '', '可见证据')}
      ${field('prompt_notes', beat.prompt_notes || '', '制作提示', { type: 'textarea', full: true })}${field('keyframe_prompt_override', beat.keyframe_prompt_override || '', '关键帧最终提示词（可选）', { type: 'textarea', full: true })}${field('video_prompt_override', beat.video_prompt_override || '', '视频最终提示词（可选）', { type: 'textarea', full: true })}${field('negative_prompt_override', beat.negative_prompt_override || '', '负面提示词（可选）', { type: 'textarea', full: true })}
    </div><div class="beat-detail-actions"><button class="btn primary small" type="button" data-close-beat-editor>保存到当前编辑稿</button></div></div></article>`;
}

export function syncBeatPresentation(row) {
  const value = name => row.querySelector(`[data-beat-field="${name}"]`)?.value?.trim() || '';
  const set = (name, text) => { const target = row.querySelector(`[data-beat-summary="${name}"]`); if (target) target.textContent = text; };
  set('title', value('title') || '未命名镜头'); set('duration', `${Math.max(1, Number(value('duration')) || 3)}s`); set('scene', value('scene') || '待确认场景'); set('visual', value('visual') || '等待补充画面与动作'); set('shot_size', value('shot_size') || '待确认'); set('lighting_mood', value('lighting_mood') || '待确认'); set('spoken_line', [value('speaker'), value('spoken_line')].filter(Boolean).join('：') || '无对白'); set('sound_design', [value('ambient_sound'), value('sfx'), value('music_cue')].filter(Boolean).join('；') || (value('sound_mode') === 'silent' ? `静默：${value('explicit_silence_reason')}` : '待补充')); set('camera_movement', value('camera_movement') || '待确认'); set('prompt_notes', value('prompt_notes') || value('keyframe_prompt_override') || '待生成');
}

export function collectBeat(row) {
  const value = name => row.querySelector(`[data-beat-field="${name}"]`)?.value?.trim() || '', spoken = value('spoken_line'), speaker = value('speaker');
  return { shot_id: value('shot_id'), title: value('title'), scene: value('scene'), visual: value('visual'), action: value('action'), duration: Math.max(1, Number(value('duration')) || 3), shot_size: value('shot_size'), speaker, speaker_id: value('speaker_id'), spoken_line: spoken, dialogue_lines: spoken ? [{ speaker_id: value('speaker_id'), speaker: speaker || '旁白', line: spoken }] : [], speech_mode: value('speech_mode'), voiceover_timing: value('voiceover_timing'), lighting_mood: value('lighting_mood'), sound_mode: value('sound_mode'), ambient_sound: value('ambient_sound'), sfx: value('sfx').split(/[；;\n]/).map(x => x.trim()).filter(Boolean), music_cue: value('music_cue'), audio_bridge: value('audio_bridge'), explicit_silence_reason: value('explicit_silence_reason'), camera_movement: value('camera_movement'), camera_movement_notes: value('camera_movement_notes'), transition: value('transition'), prompt_notes: value('prompt_notes'), keyframe_prompt_override: value('keyframe_prompt_override'), video_prompt_override: value('video_prompt_override'), negative_prompt_override: value('negative_prompt_override'), visual_proof: value('visual_proof') };
}

export function applyBeat(row, beat = {}) { Object.entries(beat).forEach(([name, raw]) => { const target = row.querySelector(`[data-beat-field="${name}"]`); if (target && raw !== undefined) target.value = Array.isArray(raw) ? raw.join('；') : raw; }); syncBeatPresentation(row); }

export function collectBlueprint(host, original = {}) {
  const originalById = new Map((original.beats || []).map(beat => [beat.shot_id || beat.id, beat]));
  const beats = [...host.querySelectorAll('[data-beat-index]')].map((row, index) => { const current = collectBeat(row), prior = originalById.get(current.shot_id) || original.beats?.[index] || {}; return { ...prior, ...current, index: index + 1, beat_index: index + 1, plot: current.visual, duration_sec: current.duration, voiceover: current.spoken_line, confirmed: true }; });
  const characters = [...host.querySelectorAll('[data-character-index]')].map((card, index) => { const value = name => card.querySelector(`[data-character-field="${name}"]`)?.value?.trim() || ''; return { ...(original.characters?.[index] || {}), id: value('id') || `character_${index + 1}`, name: value('name'), gender: value('gender'), age_range: value('age_range'), role: value('role'), relationship: value('relationship'), description: value('description'), voice_id: value('voice_id'), voice_tone: value('voice_tone'), voice: { ...(original.characters?.[index]?.voice || {}), mode: value('voice_id') ? 'assigned' : 'unassigned', voice_id: value('voice_id'), voice_name: card.querySelector('[data-character-field="voice_id"] option:checked')?.textContent?.trim() || '', direction: value('voice_tone') }, on_screen: true }; });
  return { ...original, story_title: host.querySelector('[name="story_title"]')?.value?.trim() || '', logline: host.querySelector('[name="logline"]')?.value?.trim() || '', characters, beats };
}
