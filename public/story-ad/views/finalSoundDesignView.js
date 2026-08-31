import { request } from '../api.js?v=20260831-production-v342';
import { emptyState, escapeHtml, setButtonBusy, toast } from '../components/ui.js?v=20260831-production-v342';

const TRACK_TYPES = [['room_tone', '空间底噪'], ['ambient', '环境声'], ['foley', '拟音'], ['sfx', '动作音效'], ['transition', '转场音'], ['bgm', '背景音乐']];
function trackOptions(selected = 'room_tone') {
  return TRACK_TYPES.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

export function soundDesignMarkup(soundDesign = {}) {
  const assets = new Map((soundDesign.assets || []).map(item => [item.asset_id, item]));
  const shots = soundDesign.shots || [];
  const production = soundDesign.production || {};
  const ttsTracks = Array.isArray(production.tts_tracks) ? production.tts_tracks : [];
  return `<section class="card generation-section sound-journey-section">
    <div class="card-head"><div><h2>声音工作台</h2><p>先听旁白/多人对白，再确认环境声、动作音效和背景音乐；确认后才能提交视频生成。</p></div><span class="status-badge ${production.approved ? 'success' : 'warning'}">${production.approved ? '声音已确认' : '待试听确认'}</span></div>
    <div class="card-body">
      <div class="guide"><b>正确顺序：</b>设置旁白与每位说话人的音色 → 生成并逐镜试听 → 绑定场景声/音效/BGM → 确认声音方案。任何音轨变化都会自动撤销确认。</div>
      <div class="sound-library-toolbar" data-audio-plan>
        <label><span>启用旁白 / 对白</span><input type="checkbox" data-include-voiceover ${production.include_voiceover ? 'checked' : ''}></label>
        <label><span>旁白音色</span><select data-voice-select data-voice-role="narrator"><option value="${escapeHtml(production.voice_assignments?.narrator || production.voice_id || '')}">${escapeHtml(production.voice_assignments?.narrator || production.voice_id || '请选择可用音色')}</option></select></label>
        ${(production.speakers || []).map(speaker => `<label><span>${escapeHtml(speaker)} 的音色</span><select data-voice-select data-speaker="${escapeHtml(speaker)}"><option value="${escapeHtml(production.voice_assignments?.speakers?.[speaker] || '')}">${escapeHtml(production.voice_assignments?.speakers?.[speaker] || '请选择该角色音色')}</option></select></label>`).join('')}
        <label><span>背景音乐音量</span><input type="range" min="0" max="0.35" step="0.01" value="0.16" data-bgm-volume></label>
        <label><span>字幕</span><select data-subtitle-enabled><option value="true">显示字幕</option><option value="false">不显示</option></select></label>
        <button class="btn" type="button" data-save-audio-plan>保存声音设置</button>
        <button class="btn" type="button" data-generate-audio>生成 / 更新配音</button>
        <button class="btn primary" type="button" data-confirm-audio>我已试听并确认声音</button>
      </div>
      ${(production.speech || []).length ? `<div class="sound-journey-list">${production.speech.map((row, index) => `<article data-audio-track><b>SH${String(row.shot_index).padStart(2, '0')}</b><span>${escapeHtml(row.mode === 'on_camera_dialogue' ? '出镜对白（视频阶段执行口型同步）' : row.mode === 'offscreen' ? '旁白 / 画外音' : '无语音')}</span><span>${(row.units || []).map(unit => `${escapeHtml(unit.speaker || '旁白')}：${escapeHtml(unit.text)}`).join('<br>') || '本镜无对白'}</span><span>${ttsTracks[index]?.audio_url ? `<audio controls preload="none" src="${escapeHtml(ttsTracks[index].audio_url)}"></audio>` : '<em>尚未生成试听音频</em>'}</span></article>`).join('')}</div>` : ''}
      <hr>
      <h3>场景音效与背景音乐</h3>
      ${shots.length ? `<div class="guide sound-selection-guide"><b>怎么操作：</b>点击镜头右侧“试听推荐”，试听后点“使用这个声音”即可绑定；不满意时修改上方搜索词，或直接上传自己的声音。</div><div class="sound-library-toolbar"><label><span>系统建议 / 搜索其他声音</span><input class="input" type="search" value="${escapeHtml(shots[0].recommended_query || '')}" placeholder="例如：showroom ambience、footsteps、metal touch" data-sound-library-query></label><label><span>绑定镜头</span><select data-sound-library-shot>${shots.map(shot => `<option value="${shot.shot_index}">SH${String(shot.shot_index).padStart(2, '0')}</option>`).join('')}</select></label><label><span>声音类型</span><select data-sound-library-type>${trackOptions(shots[0].recommended_track_type)}</select></label><button class="btn" type="button" data-search-sound-library>试听 / 搜索</button></div><p class="sound-license-note">试听不会产生导入或绑定；只有点击“使用这个声音”后，系统才会核验许可并绑定。仅接受 CC0、PDM、CC BY。</p><div class="sound-library-results" data-sound-library-results></div>` : ''}
      ${shots.length ? `<div class="sound-journey-list">${shots.map((item, index) => {
        const rows = (soundDesign.timeline || []).filter(row => row.shot_id === item.shot_id);
        return `<article data-audio-track data-sound-shot="${item.shot_index}"><b>SH${String(item.shot_index || index + 1).padStart(2, '0')}</b><span>${escapeHtml(item.ambient_sound || '环境底噪待确认')}</span><span>${escapeHtml((item.sfx || []).join('、') || '动作音待确认')}</span><span>${rows.map(row => { const asset = assets.get(row.asset_id) || {}; return `<em data-license-state title="${escapeHtml(asset.file_sha256 || '')}">${escapeHtml(asset.name || row.track_type)} · ${escapeHtml(asset.license || '许可待核对')}</em>`; }).join('') || '<em>尚未绑定真实音频</em>'}</span><label><select data-sound-track-type>${trackOptions(item.recommended_track_type)}</select><button class="btn small" type="button" data-preview-sound data-sound-query="${escapeHtml(item.recommended_query || '')}">试听推荐</button><input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" data-sound-file hidden><button class="btn small" type="button" data-upload-sound>上传自己的</button></label></article>`;
      }).join('')}</div>` : emptyState({ title: '尚未形成逐镜声音方案', body: '先完成并确认人物场景分镜，系统会按场景和动作建立环境声、拟音、音效和音乐节点。' })}
    </div>
  </section>`;
}

export function bindSoundDesign(host, { bundle, store, refreshShell }) {
  request('/api/avatar/voice-list').then(result => {
    host.querySelectorAll('[data-voice-select]').forEach(select => {
      const selected = select.value;
      select.innerHTML = (result.voices || []).map(voice => `<option value="${escapeHtml(voice.id || '')}" ${String(voice.id || '') === selected ? 'selected' : ''}>${escapeHtml(voice.name || voice.id || '自动')} · ${escapeHtml(voice.provider || '系统')}</option>`).join('');
    });
  }).catch(() => {});
  const audioPlanPayload = () => {
    const speakers = {};
    host.querySelectorAll('[data-voice-select][data-speaker]').forEach(select => { if (select.value) speakers[select.dataset.speaker] = select.value; });
    const narrator = host.querySelector('[data-voice-select][data-voice-role="narrator"]')?.value || '';
    return { include_voiceover: host.querySelector('[data-include-voiceover]')?.checked === true, voice_id: narrator, voice_assignments: { narrator, speakers }, bgm_volume: Number(host.querySelector('[data-bgm-volume]')?.value || 0.16), subtitle: host.querySelector('[data-subtitle-enabled]')?.value !== 'false' };
  };
  host.querySelector('[data-save-audio-plan]')?.addEventListener('click', async event => {
    try { setButtonBusy(event.currentTarget, true, '保存中…'); await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/audio-plan`, { method: 'PUT', body: audioPlanPayload() }); toast('声音设置已保存；请生成并试听配音。', 'success'); await refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
  });
  host.querySelector('[data-generate-audio]')?.addEventListener('click', async event => {
    try { setButtonBusy(event.currentTarget, true, '正在生成配音…', { elapsed: true }); const payload = audioPlanPayload(); await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/audio-plan`, { method: 'PUT', body: payload }); await store.runStage('tts', payload); toast('配音已生成，请逐镜试听后确认声音。', 'success'); await refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
  });
  host.querySelector('[data-confirm-audio]')?.addEventListener('click', async event => {
    try { setButtonBusy(event.currentTarget, true, '确认中…'); await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/audio-confirm`, { method: 'POST', body: {} }); toast('声音方案已锁定，现在可以进行视频预检。', 'success'); await refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
  });
  host.querySelectorAll('[data-sound-shot]').forEach(row => {
    const input = row.querySelector('[data-sound-file]');
    row.querySelector('[data-upload-sound]')?.addEventListener('click', () => input?.click());
    row.querySelector('[data-preview-sound]')?.addEventListener('click', () => {
      const query = host.querySelector('[data-sound-library-query]');
      const shot = host.querySelector('[data-sound-library-shot]');
      const type = host.querySelector('[data-sound-library-type]');
      if (query) query.value = row.querySelector('[data-preview-sound]').dataset.soundQuery || '';
      if (shot) shot.value = row.dataset.soundShot;
      if (type) type.value = row.querySelector('[data-sound-track-type]')?.value || 'room_tone';
      host.querySelector('[data-search-sound-library]')?.click();
      host.querySelector('[data-sound-library-results]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    input?.addEventListener('change', async event => {
      const file = event.target.files?.[0]; if (!file) return;
      const button = row.querySelector('[data-upload-sound]');
      try {
        setButtonBusy(button, true, '上传中…');
        const uploaded = await store.upload(file, 'sound_effect');
        await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-assets`, { method: 'POST', body: { asset: uploaded.asset || uploaded.data, shot_index: Number(row.dataset.soundShot), track_type: row.querySelector('[data-sound-track-type]')?.value || 'sfx' } });
        toast('音频已绑定到当前镜头，并写入许可与文件哈希账本。', 'success');
        await refreshShell();
      } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(button, false); }
    });
  });
  host.querySelector('[data-search-sound-library]')?.addEventListener('click', async event => {
    const query = host.querySelector('[data-sound-library-query]')?.value?.trim();
    if (!query) return toast('请先输入要查找的环境声或音效。', 'warning');
    const resultsHost = host.querySelector('[data-sound-library-results]');
    try {
      setButtonBusy(event.currentTarget, true, '搜索中…');
      const result = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-library?q=${encodeURIComponent(query)}`);
      resultsHost.innerHTML = (result.results || []).length ? result.results.map((item, index) => `<article class="${index === 0 ? 'is-recommended' : ''}"><div><b>${escapeHtml(item.name)}${index === 0 ? '<span class="sound-recommended-tag">系统推荐</span>' : ''}</b><small>${escapeHtml(item.creator)} · ${escapeHtml(String(item.license || '').toUpperCase())}</small></div><audio controls preload="none" src="${escapeHtml(item.audio_url || '')}"></audio><button class="btn small" type="button" data-import-openverse="${escapeHtml(item.id)}">使用这个声音</button></article>`).join('') : '<p>没有找到满足许可和下载安全规则的结果，可修改搜索词或上传自己的声音。</p>';
      resultsHost.querySelectorAll('[data-import-openverse]').forEach(button => button.addEventListener('click', async importEvent => {
        try {
          setButtonBusy(importEvent.currentTarget, true, '导入中…');
          await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-assets/openverse`, { method: 'POST', body: { openverse_id: importEvent.currentTarget.dataset.importOpenverse, shot_index: Number(host.querySelector('[data-sound-library-shot]')?.value || 1), track_type: host.querySelector('[data-sound-library-type]')?.value || 'sfx' } });
          toast('开放音频已核验许可、下载并绑定到镜头。', 'success');
          await refreshShell();
        } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(importEvent.currentTarget, false); }
      }));
    } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
  });
}
