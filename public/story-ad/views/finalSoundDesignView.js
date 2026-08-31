import { request } from '../api.js?v=20260831-production-v348';
import { emptyState, escapeHtml, setButtonBusy, toast } from '../components/ui.js?v=20260831-production-v348';

const TRACK_TYPES = [['room_tone', '空间底噪'], ['ambient', '环境声'], ['foley', '拟音'], ['sfx', '动作音效'], ['transition', '转场音'], ['bgm', '背景音乐']];
function trackOptions(selected = 'room_tone') {
  return TRACK_TYPES.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}
function speechShotCount(production = {}) {
  return (production.speech || []).filter(row => (row.units || []).length).length;
}
function usableStoryVoice(voice = {}) {
  const id = String(voice.id || '').trim();
  const provider = `${voice.providerId || ''} ${voice.provider || ''}`.toLowerCase();
  if (!id || /topview|windows|系统/.test(provider)) return false;
  return voice.isCloned === true || /^custom[_:]/.test(id) || /^hifly:/.test(id)
    || /aliyun|阿里|zhipu|智谱|hifly|飞影/.test(provider);
}
function recommendedVoice(voices = [], currentId = '', role = 'narrator') {
  const usable = voices.filter(usableStoryVoice);
  const current = usable.find(voice => String(voice.id) === String(currentId || ''));
  if (current) return current;
  return usable.map((voice, index) => {
    const descriptor = `${voice.name || ''} ${voice.tag || ''}`;
    const provider = `${voice.providerId || ''} ${voice.provider || ''}`;
    const score = (/推荐/.test(descriptor) ? 30 : 0)
      + (/aliyun|阿里/.test(provider) ? 20 : 0)
      + (role === 'narrator' && /知性|沉稳|讲述|播报|权威|精准/.test(descriptor) ? 8 : 0);
    return { voice, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index)[0]?.voice || null;
}

function previewSeconds(value = 4, cap = 6) {
  return Math.max(1, Math.min(cap, Math.round((Number(value) || 4) * 10) / 10));
}
function soundPreviewMarkup(url = '', duration = 4, label = '试听本镜') {
  if (!url) return '';
  const seconds = previewSeconds(duration, label === '试听音乐' ? 8 : 6);
  return `<div class="sound-preview-control"><button class="btn small" type="button" data-play-sound-preview data-preview-seconds="${seconds}">▶ ${label} ${seconds} 秒</button><audio preload="none" src="${escapeHtml(url)}" hidden></audio></div>`;
}

export function soundDesignMarkup(soundDesign = {}) {
  const assets = new Map((soundDesign.assets || []).map(item => [item.asset_id, item]));
  const shots = soundDesign.shots || [];
  const production = soundDesign.production || {};
  const ttsTracks = Array.isArray(production.tts_tracks) ? production.tts_tracks : [];
  const spokenShots = speechShotCount(production);
  const bgmRows = (soundDesign.timeline || []).filter(row => row.track_type === 'bgm');
  const keySoundCount = shots.filter(item => item.auto_recommend_sound).length;
  return `<section class="card generation-section sound-journey-section">
    <div class="card-head"><div><h2>配音与对白</h2><p>先确认声音效果再进入视频生成。旁白/画外音不做口型；只有人物出镜对白才进行口型同步。</p></div><span class="status-badge ${production.approved ? 'success' : 'warning'}">${production.approved ? '声音已确认' : '待试听确认'}</span></div>
    <div class="card-body">
      <div class="guide"><b>当前主流程：</b>选择音色 → 生成并试听配音 → 从页面顶部确认并进入“视频与合成”。背景音乐和场景音效均为可选，不会改变前 5 步内容。</div>
      <div class="audio-setup-grid" data-audio-plan>
        <label class="audio-toggle-field"><span>使用剧情中的旁白 / 对白</span><input type="checkbox" data-include-voiceover ${production.include_voiceover ? 'checked' : ''}></label>
        ${production.has_speech !== false ? `<label><span>系统推荐旁白音色</span><select data-voice-select data-voice-role="narrator"><option value="${escapeHtml(production.voice_assignments?.narrator || production.voice_id || '')}">${escapeHtml(production.voice_assignments?.narrator || production.voice_id || '正在选择可用音色…')}</option></select><small data-voice-recommendation-status>正在核对可合成的音色…</small></label>` : ''}
        ${(production.speakers || []).map(speaker => `<label><span>${escapeHtml(speaker)}的对白音色</span><select data-voice-select data-speaker="${escapeHtml(speaker)}"><option value="${escapeHtml(production.voice_assignments?.speakers?.[speaker] || '')}">${escapeHtml(production.voice_assignments?.speakers?.[speaker] || '正在选择可用音色…')}</option></select></label>`).join('')}
        <label><span>字幕</span><select data-subtitle-enabled><option value="true">显示字幕</option><option value="false">不显示</option></select></label>
      </div>
      <div class="sound-primary-flow"><div><b>生成配音试听</b><small>按上方音色生成 ${spokenShots} 个分镜的配音。只有点击按钮才会生成，不会在打开页面时自动计费。</small></div><div class="sound-primary-actions"><button class="btn" type="button" data-save-audio-plan>只保存设置</button><button class="btn primary" type="button" data-generate-audio>生成 ${spokenShots || ''} 段配音试听</button></div></div>
      ${(production.speech || []).length ? `<div class="speech-preview-list">${production.speech.map((row, index) => `<article data-audio-track><header><b>SH${String(row.shot_index).padStart(2, '0')}</b><span>${escapeHtml(row.mode === 'on_camera_dialogue' ? '出镜对白' : row.mode === 'offscreen' ? '旁白 / 画外音' : '无语音')}</span></header><p>${(row.units || []).map(unit => `${escapeHtml(unit.speaker || '旁白')}：${escapeHtml(unit.text)}`).join('<br>') || '本镜无对白'}</p><div>${ttsTracks[index]?.audio_url ? `<audio controls preload="metadata" src="${escapeHtml(ttsTracks[index].audio_url)}"></audio>` : '<em>生成后可在这里试听</em>'}</div></article>`).join('')}</div>` : ''}
      <section class="sound-option-block">
        <div class="sound-section-heading"><div><span class="optional-badge">可选</span><h2>背景音乐</h2><p>背景音乐服务于整条成片，所以素材通常较长；这里只试听 8 秒，采用后按成片总时长裁切。</p></div></div>
        ${shots.length ? `<article class="sound-featured-row" data-audio-track data-sound-shot="1" data-sound-query="${escapeHtml(soundDesign.bgm_query || 'cinematic background music')}" data-sound-track="bgm" data-sound-bound="${bgmRows.length ? 'true' : 'false'}" data-auto-recommend="true" data-preview-duration="8"><div><b>全片背景音乐</b><small>不采用也可以继续</small><label class="sound-volume-field"><span>混音音量</span><input type="range" min="0" max="0.35" step="0.01" value="0.16" data-bgm-volume></label></div><div>${bgmRows.map(row => { const asset = assets.get(row.asset_id) || {}; return `<span class="adopted-sound"><b>${escapeHtml(asset.name || '背景音乐')}</b><small>${escapeHtml(asset.license || '许可待核对')}</small>${soundPreviewMarkup(asset.file_url, 8, '试听音乐')}</span>`; }).join('') || '<span class="sound-empty-state">尚未采用</span>'}</div><div class="sound-row-actions"><input type="hidden" data-sound-track-type value="bgm"><div data-auto-sound-recommendation>${bgmRows.length ? '<small>已采用背景音乐</small>' : '<small>正在匹配可试听音乐…</small>'}</div></div></article>` : ''}
      </section>
      <details class="sound-option-panel">
        <summary><span><span class="optional-badge">可选</span><b>场景音效</b><small>当前剧情明确音效 ${keySoundCount} 处；普通环境描述默认不添加</small></span><span>展开设置</span></summary>
        <div class="sound-option-panel-body">
          <div class="guide sound-selection-guide"><b>按剧情需要使用：</b>动作、碰撞、脚步等明确声音会提供推荐；安静空间、空调底噪等环境描述只作参考，不会自动铺满每个分镜。试听按本镜实际时长停止，不再展示原素材的 20–24 秒总长度。</div>
          ${shots.length ? `<div class="sound-library-toolbar"><label><span>搜索声音</span><input class="input" type="search" value="${escapeHtml(shots.find(item => item.auto_recommend_sound)?.recommended_query || shots[0].recommended_query || '')}" placeholder="例如：footsteps、metal touch" data-sound-library-query></label><label><span>绑定分镜</span><select data-sound-library-shot>${shots.map(shot => `<option value="${shot.shot_index}">SH${String(shot.shot_index).padStart(2, '0')}</option>`).join('')}</select></label><label><span>声音类型</span><select data-sound-library-type>${trackOptions(shots.find(item => item.auto_recommend_sound)?.recommended_track_type || 'sfx')}</select></label><button class="btn" type="button" data-search-sound-library>搜索声音</button></div><p class="sound-license-note">仅采用 CC0、PDM、CC BY；CC BY 会进入最终署名清单。</p><div class="sound-library-results" data-sound-library-results></div>` : ''}
          ${shots.length ? `<div class="sound-journey-list">${shots.map((item, index) => {
        const rows = (soundDesign.timeline || []).filter(row => row.shot_id === item.shot_id && row.track_type !== 'bgm');
        const explicitCue = (item.sfx || []).join('、');
        return `<article data-audio-track data-sound-shot="${item.shot_index}" data-sound-query="${escapeHtml(item.recommended_query || '')}" data-sound-bound="${rows.length ? 'true' : 'false'}" data-auto-recommend="${item.auto_recommend_sound ? 'true' : 'false'}" data-preview-duration="${previewSeconds(item.preview_duration_sec || item.duration_sec)}"><header><b>SH${String(item.shot_index || index + 1).padStart(2, '0')}</b><span class="${item.auto_recommend_sound ? 'cue-required' : 'cue-optional'}">${item.auto_recommend_sound ? '剧情音效建议' : '默认不添加'}</span></header><p><b>${escapeHtml(explicitCue || '无明确动作音效')}</b><small>${escapeHtml(item.ambient_sound || '无额外环境声要求')}</small></p><div class="adopted-sound-list">${rows.map(row => { const asset = assets.get(row.asset_id) || {}; return `<span class="adopted-sound" data-license-state><b>${escapeHtml(asset.name || row.track_type)}</b><small>${escapeHtml(asset.license || '许可待核对')} · 合成使用本镜 ${previewSeconds(row.duration_sec || item.preview_duration_sec)} 秒</small>${soundPreviewMarkup(asset.file_url, row.duration_sec || item.preview_duration_sec, '试听本镜')}</span>`; }).join('') || '<span class="sound-empty-state">未添加，不影响进入下一步</span>'}</div><div class="sound-row-actions"><select data-sound-track-type>${trackOptions(item.recommended_track_type)}</select><div data-auto-sound-recommendation>${rows.length ? '<small>已采用真实音频</small>' : item.auto_recommend_sound ? '<small>正在按剧情动作匹配…</small>' : '<small>需要时可搜索或上传</small>'}</div><input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" data-sound-file hidden><button class="btn small" type="button" data-upload-sound>上传自己的</button></div></article>`;
      }).join('')}</div>` : emptyState({ title: '尚未形成逐镜声音方案', body: '先完成并确认人物场景分镜，系统会按场景和动作建立声音方案。' })}
        </div>
      </details>
    </div>
  </section>`;
}

export function bindSoundDesign(host, { bundle, store, refreshShell, navigate }) {
  request('/api/avatar/voice-list').then(result => {
    const voices = (result.voices || []).filter(usableStoryVoice);
    host.querySelectorAll('[data-voice-select]').forEach(select => {
      const current = select.value;
      const role = select.dataset.voiceRole || 'speaker';
      const recommended = recommendedVoice(voices, current, role);
      select.innerHTML = voices.map(voice => `<option value="${escapeHtml(voice.id || '')}" ${String(voice.id || '') === String(recommended?.id || '') ? 'selected' : ''}>${escapeHtml(voice.name || voice.id)} · ${escapeHtml(voice.provider || voice.providerId || '')}${String(voice.id) === String(recommended?.id) ? '（系统推荐）' : ''}</option>`).join('');
    });
    const status = host.querySelector('[data-voice-recommendation-status]');
    if (status) status.textContent = voices.length ? '已根据剧情旁白用途选择真实可合成音色，可自行更换。' : '当前没有通过健康检查的可合成音色，请先检查声音供应商。';
  }).catch(() => {
    const status = host.querySelector('[data-voice-recommendation-status]');
    if (status) status.textContent = '音色列表暂时不可用，请稍后重试。';
  });

  const audioPlanPayload = () => {
    const speakers = {};
    host.querySelectorAll('[data-voice-select][data-speaker]').forEach(select => { if (select.value) speakers[select.dataset.speaker] = select.value; });
    const narrator = host.querySelector('[data-voice-select][data-voice-role="narrator"]')?.value || '';
    return { include_voiceover: host.querySelector('[data-include-voiceover]')?.checked === true, voice_id: narrator, voice_assignments: { narrator, speakers }, bgm_volume: Number(host.querySelector('[data-bgm-volume]')?.value || 0.16), subtitle: host.querySelector('[data-subtitle-enabled]')?.value !== 'false' };
  };
  host.querySelector('[data-save-audio-plan]')?.addEventListener('click', async event => {
    try { setButtonBusy(event.currentTarget, true, '保存中…'); await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/audio-plan`, { method: 'PUT', body: audioPlanPayload() }); toast('声音设置已保存。', 'success'); await refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
  });
  host.querySelector('[data-generate-audio]')?.addEventListener('click', async event => {
    try { setButtonBusy(event.currentTarget, true, '正在生成配音试听…', { elapsed: true }); const payload = audioPlanPayload(); if (payload.include_voiceover && !payload.voice_id) throw new Error('当前没有可用音色，不能生成配音试听。'); await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/audio-plan`, { method: 'PUT', body: payload }); await store.runStage('tts', payload); toast('配音已生成，请逐段播放确认。', 'success'); await refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
  });
  host.querySelector('[data-confirm-audio]')?.addEventListener('click', async event => {
    try { setButtonBusy(event.currentTarget, true, '正在确认…'); await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/audio-confirm`, { method: 'POST', body: {} }); toast('声音已确认，正在进入视频与合成。', 'success'); navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=compose`); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
  });

  const importRecommendation = async (row, button) => {
    const id = row.dataset.recommendedSoundId || '';
    if (!id) throw new Error('该分镜还没有可采用的推荐声音。');
    setButtonBusy(button, true, '采用中…');
    await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-assets/openverse`, { method: 'POST', body: { openverse_id: id, shot_index: Number(row.dataset.soundShot || 1), track_type: row.dataset.soundTrack || row.querySelector('[data-sound-track-type]')?.value || 'sfx' } });
  };
  const recommendationRequests = new Map();
  const pendingRows = [...host.querySelectorAll('[data-sound-query][data-sound-bound="false"][data-auto-recommend="true"]')];
  pendingRows.forEach(row => {
    const query = row.dataset.soundQuery || '';
    const resultHost = row.querySelector('[data-auto-sound-recommendation]');
    if (!query || !resultHost) return;
    if (!recommendationRequests.has(query)) recommendationRequests.set(query, request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-library?q=${encodeURIComponent(query)}`));
    recommendationRequests.get(query).then(result => {
      const item = result.results?.[0];
      if (!item) { resultHost.innerHTML = '<small>暂未找到合规候选，可搜索其他声音或上传自己的。</small>'; return; }
      row.dataset.recommendedSoundId = item.id;
      const previewLabel = row.dataset.soundTrack === 'bgm' ? '试听音乐' : '试听本镜';
      resultHost.innerHTML = `<small>系统推荐：${escapeHtml(item.name)} · ${escapeHtml(String(item.license || '').toUpperCase())}${result.fallback_used ? `（已按 ${escapeHtml(result.selected_query)} 扩展匹配）` : ''}</small>${soundPreviewMarkup(item.audio_url || '', Number(row.dataset.previewDuration || 4), previewLabel)}<button class="btn small" type="button" data-use-recommended-sound>采用这个声音</button>`;
      resultHost.querySelector('[data-use-recommended-sound]')?.addEventListener('click', async event => {
        try { await importRecommendation(row, event.currentTarget); toast('声音已绑定并写入许可账本。', 'success'); await refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
      });
    }).catch(error => { resultHost.innerHTML = `<small>${escapeHtml(error.message || '声音库暂时不可用，可稍后重试或上传自己的声音。')}</small>`; });
  });

  let previewTimer = null;
  host.addEventListener('click', async event => {
    const button = event.target.closest('[data-play-sound-preview]');
    if (!button) return;
    const audio = button.parentElement?.querySelector('audio');
    if (!audio) return;
    host.querySelectorAll('[data-play-sound-preview]').forEach(other => {
      const otherAudio = other.parentElement?.querySelector('audio');
      if (otherAudio && otherAudio !== audio) { otherAudio.pause(); otherAudio.currentTime = 0; }
      if (other !== button && other.dataset.idleText) other.textContent = other.dataset.idleText;
    });
    if (!audio.paused) { audio.pause(); audio.currentTime = 0; button.textContent = button.dataset.idleText || button.textContent; return; }
    if (previewTimer) clearTimeout(previewTimer);
    button.dataset.idleText ||= button.textContent;
    const seconds = Number(button.dataset.previewSeconds || 4) || 4;
    try {
      audio.currentTime = 0;
      await audio.play();
      button.textContent = `■ 停止试听（${seconds} 秒内）`;
      const stop = () => { audio.pause(); audio.currentTime = 0; button.textContent = button.dataset.idleText; };
      previewTimer = setTimeout(stop, seconds * 1000);
      audio.addEventListener('ended', stop, { once: true });
    } catch { button.textContent = button.dataset.idleText; toast('该声音暂时无法播放，请换一个候选。', 'warning'); }
  });

  host.querySelectorAll('[data-sound-shot]').forEach(row => {
    const input = row.querySelector('[data-sound-file]');
    row.querySelector('[data-upload-sound]')?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', async event => {
      const file = event.target.files?.[0]; if (!file) return;
      const button = row.querySelector('[data-upload-sound]');
      try { setButtonBusy(button, true, '上传中…'); const uploaded = await store.upload(file, 'sound_effect'); await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-assets`, { method: 'POST', body: { asset: uploaded.asset || uploaded.data, shot_index: Number(row.dataset.soundShot), track_type: row.querySelector('[data-sound-track-type]')?.value || 'sfx' } }); toast('音频已绑定到当前分镜。', 'success'); await refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(button, false); }
    });
  });
  host.querySelector('[data-search-sound-library]')?.addEventListener('click', async event => {
    const query = host.querySelector('[data-sound-library-query]')?.value?.trim();
    if (!query) return toast('请先输入要查找的环境声或音效。', 'warning');
    const resultsHost = host.querySelector('[data-sound-library-results]');
    try {
      setButtonBusy(event.currentTarget, true, '搜索中…');
      const result = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-library?q=${encodeURIComponent(query)}`);
      const selectedShot = Number(host.querySelector('[data-sound-library-shot]')?.value || 1);
      const selectedRow = host.querySelector(`[data-sound-shot="${selectedShot}"]`);
      const previewDuration = Number(selectedRow?.dataset.previewDuration || 4);
      resultsHost.innerHTML = (result.results || []).length ? result.results.map((item, index) => `<article class="${index === 0 ? 'is-recommended' : ''}"><div><b>${escapeHtml(item.name)}${index === 0 ? '<span class="sound-recommended-tag">系统推荐</span>' : ''}</b><small>${escapeHtml(item.creator)} · ${escapeHtml(String(item.license || '').toUpperCase())}</small></div>${soundPreviewMarkup(item.audio_url || '', previewDuration, '试听本镜')}<button class="btn small" type="button" data-import-openverse="${escapeHtml(item.id)}">采用这个声音</button></article>`).join('') : `<p>${escapeHtml(result.license_note || '没有找到满足许可规则的结果。')}</p>`;
      resultsHost.querySelectorAll('[data-import-openverse]').forEach(button => button.addEventListener('click', async importEvent => {
        try { setButtonBusy(importEvent.currentTarget, true, '采用中…'); await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-assets/openverse`, { method: 'POST', body: { openverse_id: importEvent.currentTarget.dataset.importOpenverse, shot_index: Number(host.querySelector('[data-sound-library-shot]')?.value || 1), track_type: host.querySelector('[data-sound-library-type]')?.value || 'sfx' } }); toast('声音已核验许可并绑定。', 'success'); await refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(importEvent.currentTarget, false); }
      }));
    } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
  });
}
