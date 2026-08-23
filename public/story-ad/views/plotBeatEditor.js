import { escapeHtml } from '../components/ui.js?v=20260824-production-v201z';

const fields='shot_id,title,scene,duration,visual,action,shot_size,lighting_mood,speaker,speaker_id,speech_mode,spoken_line,dialogue_lines_json,sound_design,sound_mode,ambient_sound,sfx,music_cue,audio_bridge,explicit_silence_reason,camera_movement,camera_movement_notes,transition,visual_proof,prompt_notes,keyframe_prompt_override,video_prompt_override,negative_prompt_override'.split(',');
const normalizedDialogueLines=b=>Array.isArray(b.dialogue_lines)&&b.dialogue_lines.length?b.dialogue_lines:(b.spoken_line||b.voiceover?[{speech_mode:b.speech_mode||'voiceover',speaker:b.speaker||'旁白',speaker_id:b.speaker_id||'',line:b.spoken_line||b.voiceover}]:[]);
const beatStoreFields=b=>fields.map(n=>{const a={shot_id:b.shot_id||b.id,title:b.title||b.role,duration:b.duration||b.duration_sec,visual:b.visual||b.plot,shot_size:b.shot_size||b.shot_type,spoken_line:b.spoken_line||b.voiceover,dialogue_lines_json:JSON.stringify(normalizedDialogueLines(b))},raw=a[n]??b[n]??'',v=Array.isArray(raw)?raw.join('；'):raw;return `<input type="hidden" data-beat-field="${n}" value="${escapeHtml(v)}">`}).join('');

const shotSizeLabel = value => ({ wide: '大远景', long: '远景', full: '全景', medium: '中景', medium_close: '中近景', close_up: '近景', extreme_close_up: '特写', insert: '插入镜头', product_detail: '产品特写' }[String(value || '').toLowerCase()] || value || '');

function cell(group, content, className = '') {
  return `<div class="beat-cell-wrap${className ? ` ${className}` : ''}"><button type="button" class="beat-cell${className ? ` ${className}` : ''}" data-open-beat-cell="${group}">${content}</button></div>`;
}

export function beatEditor(beat = {}, index = 0) {
  const visual = beat.visual || beat.plot || '', spoken = beat.spoken_line || beat.voiceover || '';
  const dialogueSummary = normalizedDialogueLines(beat).map(line => `${line.speaker || (line.speech_mode === 'voiceover' ? '旁白' : '')}：${line.line || ''}`).filter(line => !line.endsWith('：')).join('；');
  const sound = beat.sound_design || [beat.ambient_sound, ...(beat.sfx || []), beat.music_cue].filter(Boolean).join('；');
  const empty = '<span class="beat-empty-value">＋</span>';
  return `<article class="beat-row" data-beat-index="${index}"><div class="beat-field-store" hidden>${beatStoreFields(beat)}</div>
    <div class="beat-overview"><code>B${String(index + 1).padStart(2, '0')}</code>
      ${cell('duration', `<span data-beat-summary="duration">${Number((Number(beat.duration || beat.duration_sec || 3) || 3).toFixed(2))}s</span>`)}
      ${cell('scene', `<span data-beat-summary="scene">${escapeHtml(beat.scene || '') || empty}</span>`)}
      ${cell('visual', `<strong data-beat-summary="title">${escapeHtml(beat.title || beat.role || `镜头 ${index + 1}`)}</strong><span data-beat-summary="visual">${escapeHtml(visual || '') || empty}</span>`, 'beat-visual-cell')}
      ${cell('shot_size', `<span data-beat-summary="shot_size">${escapeHtml(shotSizeLabel(beat.shot_size || beat.shot_type)) || empty}</span>`)}
      ${cell('lighting_mood', `<span data-beat-summary="lighting_mood">${escapeHtml(beat.lighting_mood || '') || empty}</span>`)}
      ${cell('spoken_line', `<span data-beat-summary="spoken_line">${escapeHtml(dialogueSummary || [beat.speaker, spoken].filter(Boolean).join('：') || '无对白')}</span>`)}
      ${cell('sound_design', `<span data-beat-summary="sound_design">${escapeHtml(sound || '') || empty}</span>`)}
      ${cell('camera_movement', `<span data-beat-summary="camera_movement">${escapeHtml(beat.camera_movement || '') || empty}</span>`)}
      ${cell('prompt_notes', '<span data-beat-summary="prompt_notes">查看完整提示词</span>')}
      <span class="beat-actions"><button class="btn icon compact" type="button" data-ai-beat title="AI 帮写并优化当前镜头">AI</button><button class="btn icon compact" type="button" data-row-menu aria-label="操作">•••</button><span class="beat-row-menu" popover="auto"><button type="button" data-duplicate-beat>复制镜头</button><button type="button" data-remove-beat>删除镜头</button></span></span>
    </div></article>`;
}

export function syncFloatingEditor(editor, row) {
  editor.querySelectorAll('[data-floating-field]').forEach(input => {
    const target = row.querySelector(`[data-beat-field="${input.dataset.floatingField}"]`);
    if (target) target.value = input.value;
  });
  const dialogueRows = [...editor.querySelectorAll('[data-dialogue-line]')];
  if (dialogueRows.length || editor.dataset.dialogueEditor === 'true') {
    const lines = dialogueRows.map(item => {
      const mode = item.querySelector('[data-dialogue-mode]')?.value === 'voiceover' ? 'voiceover' : 'dialogue';
      const select = item.querySelector('[data-dialogue-speaker]');
      const option = select?.selectedOptions?.[0];
      return { speech_mode: mode, speaker: mode === 'voiceover' ? '旁白' : (select?.value || ''), speaker_id: mode === 'voiceover' ? 'narrator' : (option?.dataset.speakerId || ''), line: item.querySelector('[data-dialogue-text]')?.value?.trim() || '' };
    }).filter(line => line.line);
    const first = lines[0] || {};
    for (const [name, value] of Object.entries({ dialogue_lines_json: JSON.stringify(lines), speech_mode: first.speech_mode || 'silent', speaker: first.speaker || '', speaker_id: first.speaker_id || '', spoken_line: first.line || '' })) {
      const target = row.querySelector(`[data-beat-field="${name}"]`); if (target) target.value = value;
    }
  }
  syncBeatPresentation(row);
}

export function syncBeatPresentation(row) {
  const v = n => row.querySelector(`[data-beat-field="${n}"]`)?.value?.trim() || '';
  const s = (n, text) => { const t = row.querySelector(`[data-beat-summary="${n}"]`); if (t) { t.textContent = text || '＋'; t.classList.toggle('beat-empty-value', !text); } };
  let lines=[];try{lines=JSON.parse(v('dialogue_lines_json')||'[]')}catch{}const dialogue=lines.map(line=>`${line.speaker||'旁白'}：${line.line||''}`).filter(line=>!line.endsWith('：')).join('；');
  s('title', v('title') || '未命名镜头'); s('duration', `${Math.max(1, Number(v('duration')) || 3)}s`); s('scene', v('scene')); s('visual', v('visual')); s('shot_size', shotSizeLabel(v('shot_size'))); s('lighting_mood', v('lighting_mood')); s('spoken_line', dialogue || [v('speaker'), v('spoken_line')].filter(Boolean).join('：') || (['silent', 'ambient_only'].includes(v('speech_mode')) ? '无对白' : '')); s('sound_design', v('sound_design') || [v('ambient_sound'), v('sfx'), v('music_cue')].filter(Boolean).join('；') || (v('sound_mode') === 'silent' ? `静默：${v('explicit_silence_reason')}` : '')); s('camera_movement', v('camera_movement')); s('prompt_notes', '查看完整提示词');
}

export function collectBeat(row) {
  const v = n => row.querySelector(`[data-beat-field="${n}"]`)?.value?.trim() || '', spoken = v('spoken_line'), speaker = v('speaker');
  let dialogueLines=[];try{dialogueLines=JSON.parse(v('dialogue_lines_json')||'[]')}catch{}if(!dialogueLines.length&&spoken)dialogueLines=[{speech_mode:v('speech_mode'),speaker_id:v('speaker_id'),speaker:speaker||'旁白',line:spoken}];
  return { shot_id: v('shot_id'), title: v('title'), scene: v('scene'), visual: v('visual'), action: v('action'), duration: Math.max(1, Number(v('duration')) || 3), shot_size: v('shot_size'), speaker, speaker_id: v('speaker_id'), spoken_line: spoken, dialogue_lines: dialogueLines, speech_mode: v('speech_mode'), lighting_mood: v('lighting_mood'), sound_design: v('sound_design'), sound_mode: v('sound_mode'), ambient_sound: v('ambient_sound'), sfx: v('sfx').split(/[；;\n]/).map(x => x.trim()).filter(Boolean), music_cue: v('music_cue'), audio_bridge: v('audio_bridge'), explicit_silence_reason: v('explicit_silence_reason'), camera_movement: v('camera_movement'), camera_movement_notes: v('camera_movement_notes'), transition: v('transition'), prompt_notes: v('prompt_notes'), keyframe_prompt_override: v('keyframe_prompt_override'), video_prompt_override: v('video_prompt_override'), negative_prompt_override: v('negative_prompt_override'), visual_proof: v('visual_proof') };
}

export function productionIssues(host) {
  const issues = [];
  [...host.querySelectorAll('[data-beat-index]')].forEach((row, index) => {
    const beat = collectBeat(row), missing = [];
    if (!beat.scene) missing.push('scene'); if (!beat.visual) missing.push('visual'); if (!beat.shot_size) missing.push('shot_size'); if (!beat.lighting_mood) missing.push('lighting_mood');
    if (!(beat.sound_mode === 'silent' ? beat.explicit_silence_reason : (beat.sound_design || beat.ambient_sound || beat.sfx.length || beat.music_cue || beat.audio_bridge))) missing.push('sound_design');
    if (!beat.camera_movement) missing.push('camera_movement'); if (!(beat.prompt_notes || beat.keyframe_prompt_override)) missing.push('prompt_notes');
    missing.forEach(group => issues.push({ row, group, index }));
  });
  return issues;
}

export function applyBeat(row, beat = {}) { Object.entries(beat).forEach(([name, raw]) => { const fieldName=name==='dialogue_lines'?'dialogue_lines_json':name,target = row.querySelector(`[data-beat-field="${fieldName}"]`); if (target && raw !== undefined) target.value = name==='dialogue_lines'?JSON.stringify(raw):(Array.isArray(raw) ? raw.join('；') : raw); }); syncBeatPresentation(row); }

export function collectBlueprint(host, original = {}) {
  const originalById = new Map((original.beats || []).map(beat => [beat.shot_id || beat.id, beat]));
  const beats = [...host.querySelectorAll('[data-beat-index]')].map((row, index) => { const current = collectBeat(row), prior = originalById.get(current.shot_id) || original.beats?.[index] || {}; return { ...prior, ...current, index: index + 1, beat_index: index + 1, plot: current.visual, duration_sec: current.duration, voiceover: current.spoken_line, confirmed: true }; });
  const characters = [...host.querySelectorAll('[data-character-index]')].map((card, index) => { const value = name => card.querySelector(`[data-character-field="${name}"]`)?.value?.trim() || ''; return { ...(original.characters?.[index] || {}), id: value('id') || `character_${index + 1}`, name: value('name'), gender: value('gender'), age_range: value('age_range'), role: value('role'), relationship: value('relationship'), description: value('description'), voice_id: value('voice_id'), voice_tone: value('voice_tone'), voice: { ...(original.characters?.[index]?.voice || {}), mode: value('voice_id') ? 'assigned' : 'unassigned', voice_id: value('voice_id'), voice_name: card.querySelector('[data-character-field="voice_id"] option:checked')?.textContent?.trim() || '', direction: value('voice_tone') }, on_screen: true }; });
  return { ...original, story_title: host.querySelector('[name="story_title"]')?.value?.trim() || '', logline: host.querySelector('[name="logline"]')?.value?.trim() || '', characters, beats };
}
