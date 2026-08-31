import { request } from '../api.js?v=20260831-production-v344';
import { emptyState, escapeHtml, setButtonBusy, toast } from '../components/ui.js?v=20260831-production-v344';

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

export function soundDesignMarkup(soundDesign = {}) {
  const assets = new Map((soundDesign.assets || []).map(item => [item.asset_id, item]));
  const shots = soundDesign.shots || [];
  const production = soundDesign.production || {};
  const ttsTracks = Array.isArray(production.tts_tracks) ? production.tts_tracks : [];
  const spokenShots = speechShotCount(production);
  const bgmRows = (soundDesign.timeline || []).filter(row => row.track_type === 'bgm');
  return `<section class="card generation-section sound-journey-section">
    <div class="card-head"><div><h2>1. 配音与对白</h2><p>系统先选一个真实可用音色；生成后，每个有台词的分镜都会出现播放器。</p></div><span class="status-badge ${production.approved ? 'success' : 'warning'}">${production.approved ? '声音已确认' : '待试听确认'}</span></div>
    <div class="card-body">
      <div class="guide"><b>这一页只做三件事：</b>① 生成并试听配音；② 试听并采用场景音效和背景音乐；③ 确认后自动进入“视频与合成”。不会重新生成或改变前 5 步的内容。</div>
      <div class="audio-setup-grid" data-audio-plan>
        <label><span>使用剧情中的旁白 / 对白</span><input type="checkbox" data-include-voiceover ${production.include_voiceover ? 'checked' : ''}></label>
        ${production.has_speech !== false ? `<label><span>系统推荐旁白音色</span><select data-voice-select data-voice-role="narrator"><option value="${escapeHtml(production.voice_assignments?.narrator || production.voice_id || '')}">${escapeHtml(production.voice_assignments?.narrator || production.voice_id || '正在选择可用音色…')}</option></select><small data-voice-recommendation-status>正在核对可合成的音色…</small></label>` : ''}
        ${(production.speakers || []).map(speaker => `<label><span>${escapeHtml(speaker)}的对白音色</span><select data-voice-select data-speaker="${escapeHtml(speaker)}"><option value="${escapeHtml(production.voice_assignments?.speakers?.[speaker] || '')}">${escapeHtml(production.voice_assignments?.speakers?.[speaker] || '正在选择可用音色…')}</option></select></label>`).join('')}
        <label><span>背景音乐音量</span><input type="range" min="0" max="0.35" step="0.01" value="0.16" data-bgm-volume></label>
        <label><span>字幕</span><select data-subtitle-enabled><option value="true">显示字幕</option><option value="false">不显示</option></select></label>
      </div>
      <div class="sound-primary-flow"><div><b>第一步：生成配音试听</b><small>点击后会按上方推荐音色生成 ${spokenShots} 个分镜的配音；这是明确操作，不会在打开页面时自动计费。</small></div><button class="btn primary" type="button" data-generate-audio>生成 ${spokenShots || ''} 段配音试听</button></div>
      <div class="audio-action-bar"><button class="btn" type="button" data-save-audio-plan>只保存设置</button></div>
      ${(production.speech || []).length ? `<div class="speech-preview-list">${production.speech.map((row, index) => `<article data-audio-track><header><b>SH${String(row.shot_index).padStart(2, '0')}</b><span>${escapeHtml(row.mode === 'on_camera_dialogue' ? '出镜对白' : row.mode === 'offscreen' ? '旁白 / 画外音' : '无语音')}</span></header><p>${(row.units || []).map(unit => `${escapeHtml(unit.speaker || '旁白')}：${escapeHtml(unit.text)}`).join('<br>') || '本镜无对白'}</p><div>${ttsTracks[index]?.audio_url ? `<audio controls preload="metadata" src="${escapeHtml(ttsTracks[index].audio_url)}"></audio>` : '<em>点击上方“生成配音试听”后，可在这里播放</em>'}</div></article>`).join('')}</div>` : ''}
      <hr>
      <div class="sound-section-heading"><div><h2>2. 场景音效与背景音乐</h2><p>系统会按每个分镜的环境和动作寻找真实、可播放且许可合规的候选。</p></div><button class="btn" type="button" data-use-all-sound-recommendations hidden>采用全部已试听推荐</button></div>
      ${shots.length ? `<div class="guide sound-selection-guide"><b>这里的播放器就是真实声音：</b>先直接播放；满意后点“采用这个声音”，系统才会下载、绑定并写入许可账本。你也可以一键采用全部推荐。</div><div class="sound-library-toolbar"><label><span>另找其他声音</span><input class="input" type="search" value="${escapeHtml(shots[0].recommended_query || '')}" placeholder="例如：indoor ambience、footsteps、metal touch" data-sound-library-query></label><label><span>绑定分镜</span><select data-sound-library-shot>${shots.map(shot => `<option value="${shot.shot_index}">SH${String(shot.shot_index).padStart(2, '0')}</option>`).join('')}</select></label><label><span>声音类型</span><select data-sound-library-type>${trackOptions(shots[0].recommended_track_type)}</select></label><button class="btn" type="button" data-search-sound-library>搜索其他声音</button></div><p class="sound-license-note">仅采用 CC0、PDM、CC BY；CC BY 会进入最终署名清单。</p><div class="sound-library-results" data-sound-library-results></div>` : ''}
      ${shots.length ? `<div class="sound-journey-list">${shots.map((item, index) => {
        const rows = (soundDesign.timeline || []).filter(row => row.shot_id === item.shot_id && row.track_type !== 'bgm');
        return `<article data-audio-track data-sound-shot="${item.shot_index}" data-sound-query="${escapeHtml(item.recommended_query || '')}" data-sound-bound="${rows.length ? 'true' : 'false'}"><b>SH${String(item.shot_index || index + 1).padStart(2, '0')}</b><span>${escapeHtml(item.ambient_sound || '环境底噪待确认')}</span><span>${escapeHtml((item.sfx || []).join('、') || '无额外动作音')}</span><span>${rows.map(row => { const asset = assets.get(row.asset_id) || {}; return `<em data-license-state>${escapeHtml(asset.name || row.track_type)} · ${escapeHtml(asset.license || '许可待核对')}${asset.file_url ? `<audio controls preload="none" src="${escapeHtml(asset.file_url)}"></audio>` : ''}</em>`; }).join('') || '<em>尚未采用</em>'}</span><div class="sound-row-actions"><select data-sound-track-type>${trackOptions(item.recommended_track_type)}</select><div data-auto-sound-recommendation>${rows.length ? '<small>已采用真实音频</small>' : '<small>系统正在匹配可试听声音…</small>'}</div><input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" data-sound-file hidden><button class="btn small" type="button" data-upload-sound>上传自己的</button></div></article>`;
      }).join('')}
      <article data-audio-track data-sound-shot="1" data-sound-query="${escapeHtml(soundDesign.bgm_query || 'cinematic background music')}" data-sound-track="bgm" data-sound-bound="${bgmRows.length ? 'true' : 'false'}"><b>BGM</b><span>全片背景音乐</span><span>根据剧情节奏匹配</span><span>${bgmRows.map(row => { const asset = assets.get(row.asset_id) || {}; return `<em>${escapeHtml(asset.name || '背景音乐')} · ${escapeHtml(asset.license || '许可待核对')}${asset.file_url ? `<audio controls preload="none" src="${escapeHtml(asset.file_url)}"></audio>` : ''}</em>`; }).join('') || '<em>尚未采用</em>'}</span><div class="sound-row-actions"><input type="hidden" data-sound-track-type value="bgm"><div data-auto-sound-recommendation>${bgmRows.length ? '<small>已采用真实背景音乐</small>' : '<small>系统正在匹配可试听背景音乐…</small>'}</div></div></article></div>` : emptyState({ title: '尚未形成逐镜声音方案', body: '先完成并确认人物场景分镜，系统会按场景和动作建立声音方案。' })}
      <div class="sound-primary-flow sound-confirm-flow"><div><b>第三步：确认并继续</b><small>确认成功后会直接进入“视频与合成”；只切换页面，不会自动生成付费视频。</small></div><button class="btn primary" type="button" data-confirm-audio>确认声音并进入视频与合成</button></div>
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
  const pendingRows = [...host.querySelectorAll('[data-sound-query][data-sound-bound="false"]')];
  pendingRows.forEach(row => {
    const query = row.dataset.soundQuery || '';
    const resultHost = row.querySelector('[data-auto-sound-recommendation]');
    if (!query || !resultHost) return;
    if (!recommendationRequests.has(query)) recommendationRequests.set(query, request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-library?q=${encodeURIComponent(query)}`));
    recommendationRequests.get(query).then(result => {
      const item = result.results?.[0];
      if (!item) { resultHost.innerHTML = '<small>暂未找到合规候选，可搜索其他声音或上传自己的。</small>'; return; }
      row.dataset.recommendedSoundId = item.id;
      resultHost.innerHTML = `<small>系统推荐：${escapeHtml(item.name)} · ${escapeHtml(String(item.license || '').toUpperCase())}${result.fallback_used ? `（已按 ${escapeHtml(result.selected_query)} 扩展匹配）` : ''}</small><audio controls preload="none" src="${escapeHtml(item.audio_url || '')}"></audio><button class="btn small" type="button" data-use-recommended-sound>采用这个声音</button>`;
      resultHost.querySelector('[data-use-recommended-sound]')?.addEventListener('click', async event => {
        try { await importRecommendation(row, event.currentTarget); toast('声音已绑定并写入许可账本。', 'success'); await refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
      });
      const allButton = host.querySelector('[data-use-all-sound-recommendations]');
      if (allButton) allButton.hidden = false;
    }).catch(error => { resultHost.innerHTML = `<small>${escapeHtml(error.message || '声音库暂时不可用，可稍后重试或上传自己的声音。')}</small>`; });
  });
  host.querySelector('[data-use-all-sound-recommendations]')?.addEventListener('click', async event => {
    const rows = pendingRows.filter(row => row.dataset.recommendedSoundId);
    if (!rows.length) return toast('推荐声音还在匹配中，请稍候。', 'warning');
    try {
      setButtonBusy(event.currentTarget, true, `正在采用 0/${rows.length}…`);
      for (const [index, row] of rows.entries()) { event.currentTarget.textContent = `正在采用 ${index + 1}/${rows.length}…`; await importRecommendation(row, event.currentTarget); }
      toast(`已采用 ${rows.length} 条推荐声音并写入许可账本。`, 'success');
      await refreshShell();
    } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
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
      resultsHost.innerHTML = (result.results || []).length ? result.results.map((item, index) => `<article class="${index === 0 ? 'is-recommended' : ''}"><div><b>${escapeHtml(item.name)}${index === 0 ? '<span class="sound-recommended-tag">系统推荐</span>' : ''}</b><small>${escapeHtml(item.creator)} · ${escapeHtml(String(item.license || '').toUpperCase())}</small></div><audio controls preload="none" src="${escapeHtml(item.audio_url || '')}"></audio><button class="btn small" type="button" data-import-openverse="${escapeHtml(item.id)}">采用这个声音</button></article>`).join('') : `<p>${escapeHtml(result.license_note || '没有找到满足许可规则的结果。')}</p>`;
      resultsHost.querySelectorAll('[data-import-openverse]').forEach(button => button.addEventListener('click', async importEvent => {
        try { setButtonBusy(importEvent.currentTarget, true, '采用中…'); await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-assets/openverse`, { method: 'POST', body: { openverse_id: importEvent.currentTarget.dataset.importOpenverse, shot_index: Number(host.querySelector('[data-sound-library-shot]')?.value || 1), track_type: host.querySelector('[data-sound-library-type]')?.value || 'sfx' } }); toast('声音已核验许可并绑定。', 'success'); await refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(importEvent.currentTarget, false); }
      }));
    } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
  });
}
