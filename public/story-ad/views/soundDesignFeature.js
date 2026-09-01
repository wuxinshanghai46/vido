import { request } from '../api.js?v=20260901-production-v370';
import { emptyState, escapeHtml, setButtonBusy, toast } from '../components/ui.js?v=20260901-production-v370';

const TRACK_TYPES = [['room_tone', '空间底噪'], ['ambient', '环境声'], ['foley', '拟音'], ['sfx', '动作音效'], ['transition', '转场音'], ['bgm', '背景音乐']];
function trackOptions(selected = 'room_tone') {
  return TRACK_TYPES.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}
function speechShotCount(production = {}) {
  return (production.speech || []).filter(row => (row.units || []).length).length;
}
function voiceSampleText(production = {}, speaker = '') {
  const units = (production.speech || []).flatMap(row => row.units || []);
  const matched = speaker ? units.find(unit => String(unit.speaker || '') === String(speaker)) : units.find(unit => unit.text);
  return String(matched?.text || units.find(unit => unit.text)?.text || '你好，这是当前选择的配音音色试听。').trim().slice(0, 80);
}
function usableStoryVoice(voice = {}) {
  const id = String(voice.id || '').trim();
  const provider = `${voice.providerId || ''} ${voice.provider || ''}`.toLowerCase();
  if (!id || /topview|windows|系统|zhipu|智谱|aliyun|阿里|cosyvoice|智能语音交互|\bnls\b/.test(provider)) return false;
  if (voice.isCloned === true || /^custom[_:]/.test(id)) return voice.has_volc === true && /volcengine-tts|字节|豆包|声音复刻/.test(provider);
  return /volcengine-tts|字节豆包语音/.test(provider);
}
function recommendedVoice(voices = [], currentId = '', role = 'narrator') {
  const usable = voices.filter(usableStoryVoice);
  const current = usable.find(voice => String(voice.id) === String(currentId || ''));
  if (current) return current;
  return usable.map((voice, index) => {
    const descriptor = `${voice.name || ''} ${voice.tag || ''}`;
    const provider = `${voice.providerId || ''} ${voice.provider || ''}`;
    const score = (/推荐/.test(descriptor) ? 30 : 0)
      + (/volcengine-tts|字节|豆包/.test(provider) ? 20 : 0)
      + (role === 'narrator' && /知性|沉稳|讲述|播报|权威|精准/.test(descriptor) ? 8 : 0);
    return { voice, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index)[0]?.voice || null;
}
function voicePickerMarkup({ value = '', role = '', speaker = '', label = '音色', sample = '' } = {}) {
  return `<label><span>${escapeHtml(label)}</span><div class="voice-picker-summary"><select data-voice-select ${role ? `data-voice-role="${escapeHtml(role)}"` : ''} ${speaker ? `data-speaker="${escapeHtml(speaker)}"` : ''} hidden><option value="${escapeHtml(value)}">${escapeHtml(value)}</option></select><button class="voice-picker-trigger" type="button" data-open-voice-library data-preview-text="${escapeHtml(sample)}"><span><b data-selected-voice-name>${escapeHtml(value ? '正在加载音色名称…' : '正在选择可用音色…')}</b><small data-selected-voice-provider>点击打开音色库，可在弹窗内搜索、试听和选择</small></span><em>选择音色</em></button></div>${role === 'narrator' ? '<small data-voice-recommendation-status>正在加载剧情音色目录…</small>' : ''}</label>`;
}

function previewSeconds(value = 4, cap = 6) {
  return Math.max(1, Math.min(cap, Math.round((Number(value) || 4) * 10) / 10));
}
function soundPreviewMarkup(url = '', duration = 4, label = '试听本镜') {
  if (!url) return '';
  const seconds = previewSeconds(duration, label === '试听音乐' ? 8 : 6);
  return `<div class="sound-preview-control"><button class="btn small" type="button" data-play-sound-preview data-preview-seconds="${seconds}">▶ ${label} ${seconds} 秒</button><audio preload="none" src="${escapeHtml(url)}" hidden></audio></div>`;
}
function bgmCandidateMarkup(item = {}, index = 0) {
  return `<article class="bgm-candidate ${index === 0 ? 'is-recommended' : ''}"><div><b>${escapeHtml(item.name || '背景音乐')}</b><small>${escapeHtml(item.creator || 'Unknown')} · ${escapeHtml(String(item.license || '').toUpperCase())}${index === 0 ? ' · 系统首选' : ''}</small></div>${soundPreviewMarkup(item.audio_url || '', 8, '试听音乐')}<button class="btn small" type="button" data-import-bgm="${escapeHtml(item.id || '')}">${index === 0 ? '使用这首' : '切换为这首'}</button></article>`;
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
      <div class="voice-setup-panel" data-audio-plan data-has-speech="${spokenShots > 0 ? 'true' : 'false'}">
        <div class="voice-settings-panel" data-voice-settings>
          <div class="voice-story-contract"><b>声音内容已按剧情自动确定</b><small>${spokenShots > 0 ? `检测到 ${spokenShots} 个分镜包含旁白或人物对白；旁白按旁白生成，对白按对应人物生成，两者并存时会自动组合。` : '当前分镜没有旁白或人物对白，因此不会生成配音。'}</small></div>
          <div class="voice-settings-grid">
            ${production.has_speech !== false ? voicePickerMarkup({ value: production.voice_assignments?.narrator || production.voice_id || '', role: 'narrator', label: '旁白音色', sample: voiceSampleText(production) }) : ''}
            ${(production.speakers || []).map(speaker => voicePickerMarkup({ value: production.voice_assignments?.speakers?.[speaker] || '', speaker, label: `${speaker}的对白音色`, sample: voiceSampleText(production, speaker) })).join('')}
            <label><span>字幕</span><select data-subtitle-enabled><option value="true" ${production.subtitle !== false ? 'selected' : ''}>显示字幕</option><option value="false" ${production.subtitle === false ? 'selected' : ''}>不显示字幕</option></select><small>字幕跟随最终确认的旁白与对白。</small></label>
          </div>
          <div class="voice-generation-bar"><div><b>生成并逐段试听</b><small>将按上方音色生成 ${spokenShots} 段配音。</small></div><div class="sound-primary-actions"><button class="btn" type="button" data-save-audio-plan>保存设置</button><button class="btn primary" type="button" data-generate-audio data-generate-label="生成 ${spokenShots || ''} 段配音试听">生成 ${spokenShots || ''} 段配音试听</button></div></div>
          <dialog class="voice-library-dialog" data-voice-library-dialog aria-labelledby="voiceLibraryTitle"><header><div><small>试听后再选择</small><h2 id="voiceLibraryTitle">选择配音音色</h2><p>仅显示当前可用的字节豆包语音 2.0 音色；默认推荐项会高亮显示。</p></div><button class="icon-btn dialog-close-button" type="button" data-close-voice-library aria-label="关闭音色库">×</button></header><div class="voice-library-dialog-body"><div class="voice-library-toolbar"><input class="input" type="search" placeholder="搜索音色或风格" data-voice-library-query><select class="voice-library-provider-select" data-voice-library-provider><option value="">全部可用供应商</option></select></div><div class="dialog-inline-feedback" data-voice-library-feedback role="alert" hidden></div><div class="voice-library-results" data-voice-library-results><p>正在加载可试听音色…</p></div><audio data-voice-library-audio preload="none" hidden></audio></div></dialog>
        </div>
      </div>
      ${(production.speech || []).length ? `<div class="speech-preview-list">${production.speech.map((row, index) => `<article data-audio-track><header><b>SH${String(row.shot_index).padStart(2, '0')}</b><span>${escapeHtml(row.mode === 'on_camera_dialogue' ? '出镜对白' : row.mode === 'offscreen' ? '旁白 / 画外音' : '无语音')}</span></header><p>${(row.units || []).map(unit => `${escapeHtml(unit.speaker || '旁白')}：${escapeHtml(unit.text)}`).join('<br>') || '本镜无对白'}</p><div>${ttsTracks[index]?.audio_url ? `<audio controls preload="metadata" src="${escapeHtml(ttsTracks[index].audio_url)}"></audio>` : '<em>生成后可在这里试听</em>'}</div></article>`).join('')}</div>` : ''}
      <section class="sound-option-block">
        <div class="sound-section-heading"><div><span class="optional-badge">可选</span><h2>背景音乐</h2><p>先试听多首候选，再选择一首作为全片音乐；重新选择会替换原音乐，不会叠加两条 BGM。</p></div></div>
        ${shots.length ? `<article class="bgm-picker" data-audio-track data-sound-shot="1" data-sound-query="${escapeHtml(soundDesign.bgm_query || 'cinematic background music')}" data-sound-track="bgm" data-sound-bound="${bgmRows.length ? 'true' : 'false'}" data-auto-recommend="true" data-preview-duration="8"><div class="bgm-current"><div><span>当前使用</span><b>${bgmRows.length ? escapeHtml(assets.get(bgmRows.at(-1)?.asset_id)?.name || '已采用背景音乐') : '尚未选择背景音乐'}</b><small>${bgmRows.length ? '选择其他音乐会直接替换当前音乐' : '不选择也可以继续进入视频与合成'}</small></div><label class="sound-volume-field"><span>混音音量</span><input type="range" min="0" max="0.35" step="0.01" value="${Number(production.bgm_volume ?? 0.16)}" data-bgm-volume></label></div><div class="bgm-recommendations"><div class="bgm-recommendation-head"><div><b>为当前剧情推荐 1 首</b><small>默认只展示一首；需要更多候选时打开音乐库查询</small></div><button class="btn small" type="button" data-open-bgm-library>查询更多开源音乐</button></div><div data-auto-sound-recommendation><small>正在匹配一首可试听音乐…</small></div></div><dialog class="bgm-library-dialog" data-bgm-library-dialog aria-labelledby="bgmLibraryTitle"><header><div><small>可选 · 不采用也能继续</small><h2 id="bgmLibraryTitle">查询与选择背景音乐</h2><p>输入歌名或风格后按回车即可查询；系统会返回相近的开放授权音乐。</p></div><button class="icon-btn dialog-close-button" type="button" data-close-bgm-library aria-label="关闭音乐库">×</button></header><div class="bgm-library-dialog-body"><div class="bgm-mood-list"><button type="button" data-bgm-query="elegant minimal background music">高级克制</button><button type="button" data-bgm-query="warm piano background music">温暖叙事</button><button type="button" data-bgm-query="upbeat corporate background music">轻快商业</button><button type="button" data-bgm-query="cinematic ambient background music">电影氛围</button></div><div class="bgm-search-bar"><input class="input" type="search" value="${escapeHtml(soundDesign.bgm_query || 'cinematic background music')}" placeholder="输入歌名或音乐风格，按回车查询" data-bgm-library-query><button class="btn primary" type="button" data-search-bgm-library>查询音乐</button></div><div class="dialog-inline-feedback" data-bgm-library-feedback role="alert" hidden></div><div class="sound-library-results bgm-library-results" data-bgm-library-results><p>打开音乐库后会显示可试听候选。</p></div></div></dialog></article>` : ''}
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
  let availableVoices = [];
  let blockedVoiceProviders = new Set();
  try { blockedVoiceProviders = new Set(JSON.parse(sessionStorage.getItem('story-ad-blocked-voice-providers') || '[]')); } catch {}
  let activeVoiceSelect = null;
  const voiceDialog = host.querySelector('[data-voice-library-dialog]');
  const voiceResults = host.querySelector('[data-voice-library-results]');
  const voiceAudio = host.querySelector('[data-voice-library-audio]');
  const setDialogFeedback = (selector, message = '', tone = 'danger') => {
    const feedback = host.querySelector(selector);
    if (!feedback) return;
    feedback.hidden = !message;
    feedback.className = `dialog-inline-feedback is-${tone}`;
    feedback.textContent = message;
  };
  const syncVoiceSummary = select => {
    const voice = availableVoices.find(item => String(item.id || '') === String(select?.value || ''));
    const trigger = select?.parentElement?.querySelector('[data-open-voice-library]');
    if (!trigger) return;
    trigger.querySelector('[data-selected-voice-name]').textContent = voice?.name || '尚未选择可用音色';
    trigger.querySelector('[data-selected-voice-provider]').textContent = voice ? `${voice.provider || voice.providerId || '语音服务'} · 点击更换` : '点击打开音色库，可在弹窗内搜索、试听和选择';
  };
  const stopVoicePreview = () => {
    if (voiceAudio) { voiceAudio.pause(); voiceAudio.currentTime = 0; voiceAudio.removeAttribute('src'); }
    host.querySelectorAll('[data-preview-library-voice]').forEach(button => { button.textContent = '▶ 试听'; button.classList.remove('is-playing'); });
  };
  const renderVoiceLibrary = () => {
    if (!voiceResults) return;
    const query = String(host.querySelector('[data-voice-library-query]')?.value || '').trim().toLowerCase();
    const provider = String(host.querySelector('[data-voice-library-provider]')?.value || '');
    const filtered = availableVoices.filter(voice => (!provider || (voice.providerId || voice.provider) === provider) && (!query || `${voice.name} ${voice.provider} ${voice.tag || ''}`.toLowerCase().includes(query)));
    voiceResults.innerHTML = filtered.length ? filtered.map(voice => `<article class="voice-library-item ${String(voice.id) === String(activeVoiceSelect?.value) ? 'is-selected' : ''}"><div><b>${escapeHtml(voice.name || voice.id)}</b><small>${escapeHtml(voice.provider || voice.providerId || '')}${voice.tag ? ` · ${escapeHtml(voice.tag)}` : ''}</small></div><div><button class="btn small" type="button" data-preview-library-voice="${escapeHtml(voice.id)}">▶ 试听</button><button class="btn small ${String(voice.id) === String(activeVoiceSelect?.value) ? '' : 'primary'}" type="button" data-choose-library-voice="${escapeHtml(voice.id)}">${String(voice.id) === String(activeVoiceSelect?.value) ? '已选择' : '选择'}</button></div></article>`).join('') : '<p>没有匹配且通过可用性检查的音色。</p>';
  };
  request('/api/avatar/voice-list?scope=story').then(result => {
    const voices = (result.voices || []).filter(voice => usableStoryVoice(voice) && !blockedVoiceProviders.has(String(voice.providerId || voice.provider || '')));
    availableVoices = voices;
    host.querySelectorAll('[data-voice-select]').forEach(select => {
      const current = select.value;
      const role = select.dataset.voiceRole || 'speaker';
      const recommended = recommendedVoice(voices, current, role);
      select.innerHTML = voices.map(voice => `<option value="${escapeHtml(voice.id || '')}" ${String(voice.id || '') === String(recommended?.id || '') ? 'selected' : ''}>${escapeHtml(voice.name || voice.id)} · ${escapeHtml(voice.provider || voice.providerId || '')}${String(voice.id) === String(recommended?.id) ? '（系统推荐）' : ''}</option>`).join('');
      syncVoiceSummary(select);
    });
    const providerSelect = host.querySelector('[data-voice-library-provider]');
    if (providerSelect) providerSelect.innerHTML = '<option value="">全部供应商</option>' + [...new Map(voices.map(v => [v.providerId || v.provider, v.provider || v.providerId])).entries()].map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join('');
    const status = host.querySelector('[data-voice-recommendation-status]');
    if (status) status.textContent = voices.length ? '已按剧情推荐音色；点击试听时会实际检测语音服务。' : '当前没有可选择的剧情音色，请先检查声音供应商配置。';
  }).catch(() => {
    const status = host.querySelector('[data-voice-recommendation-status]');
    if (status) status.textContent = '音色列表暂时不可用，请稍后重试。';
    setDialogFeedback('[data-voice-library-feedback]', '音色列表暂时不可用，请稍后重试。');
  });

  const audioPlanPayload = () => {
    const speakers = {};
    host.querySelectorAll('[data-voice-select][data-speaker]').forEach(select => { if (select.value) speakers[select.dataset.speaker] = select.value; });
    const narrator = host.querySelector('[data-voice-select][data-voice-role="narrator"]')?.value || '';
    return { voice_id: narrator, voice_assignments: { narrator, speakers }, bgm_volume: Number(host.querySelector('[data-bgm-volume]')?.value || 0.16), subtitle: host.querySelector('[data-subtitle-enabled]')?.value !== 'false' };
  };
  host.querySelectorAll('[data-open-voice-library]').forEach(button => button.addEventListener('click', () => {
    activeVoiceSelect = button.parentElement?.querySelector('[data-voice-select]');
    setDialogFeedback('[data-voice-library-feedback]');
    renderVoiceLibrary();
    voiceDialog?.showModal();
  }));
  host.querySelector('[data-close-voice-library]')?.addEventListener('click', () => { stopVoicePreview(); voiceDialog?.close(); });
  host.querySelector('[data-voice-library-query]')?.addEventListener('input', renderVoiceLibrary);
  host.querySelector('[data-voice-library-provider]')?.addEventListener('change', renderVoiceLibrary);
  voiceResults?.addEventListener('click', async event => {
    const choose = event.target.closest('[data-choose-library-voice]');
    if (choose && activeVoiceSelect) { activeVoiceSelect.value = choose.dataset.chooseLibraryVoice; syncVoiceSummary(activeVoiceSelect); stopVoicePreview(); voiceDialog?.close(); return; }
    const button = event.target.closest('[data-preview-library-voice]');
    if (!button) return;
    if (button.classList.contains('is-playing')) return stopVoicePreview();
    stopVoicePreview();
    const voice = availableVoices.find(item => String(item.id) === String(button.dataset.previewLibraryVoice));
    if (!voice) return;
    try {
      setButtonBusy(button, true, '生成试听…');
      const blob = await request('/api/avatar/preview-voice', { method: 'POST', responseType: 'blob', timeoutMs: 120000, body: { voiceId: voice.id, gender: voice.gender || '', providerId: voice.providerId || '', provider: voice.provider || '', text: activeVoiceSelect?.parentElement?.querySelector('[data-open-voice-library]')?.dataset.previewText || '' } });
      if (!blob?.size) throw new Error('试听音频为空。');
      voiceAudio.src = URL.createObjectURL(blob); await voiceAudio.play(); button.classList.add('is-playing'); button.textContent = '■ 停止'; voiceAudio.addEventListener('ended', stopVoicePreview, { once: true });
    } catch (error) {
      stopVoicePreview();
      const providerKey = String(voice.providerId || voice.provider || '');
      if (error.code === 'TTS_PROVIDER_BILLING' && providerKey) {
        blockedVoiceProviders.add(providerKey);
        try { sessionStorage.setItem('story-ad-blocked-voice-providers', JSON.stringify([...blockedVoiceProviders])); } catch {}
        availableVoices = availableVoices.filter(item => String(item.providerId || item.provider || '') !== providerKey);
        const status = host.querySelector('[data-voice-recommendation-status]');
        if (status) status.textContent = '当前语音服务未能完成实际试听；已停止展示该服务的音色，后台检测通过后请刷新页面。';
      } else {
        availableVoices = availableVoices.filter(item => item.id !== voice.id);
      }
      setDialogFeedback('[data-voice-library-feedback]', error.message || '该音色暂时无法试听。');
      renderVoiceLibrary();
    }
    finally { setButtonBusy(button, false); if (button.classList.contains('is-playing')) button.textContent = '■ 停止'; }
  });
  host.querySelector('[data-save-audio-plan]')?.addEventListener('click', async event => {
    try { setButtonBusy(event.currentTarget, true, '保存中…'); await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/audio-plan`, { method: 'PUT', body: audioPlanPayload() }); toast('声音设置已保存。', 'success'); await refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
  });
  host.querySelector('[data-generate-audio]')?.addEventListener('click', async event => {
    try { setButtonBusy(event.currentTarget, true, '正在生成配音试听…', { elapsed: true }); const payload = audioPlanPayload(); if (host.querySelector('[data-audio-plan]')?.dataset.hasSpeech === 'true' && !payload.voice_id) throw new Error('当前没有可用音色，不能生成配音试听。'); await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/audio-plan`, { method: 'PUT', body: payload }); await store.runStage('tts', payload); toast('配音已生成，请逐段播放确认。', 'success'); await refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
  });
  host.querySelector('[data-confirm-audio]')?.addEventListener('click', async event => {
    try { setButtonBusy(event.currentTarget, true, '正在确认…'); await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/audio-confirm`, { method: 'POST', body: {} }); toast('声音已确认，正在进入视频与合成。', 'success'); navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=compose`); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
  });

  const importSound = async (row, button, id = row.dataset.recommendedSoundId || '') => {
    if (!id) throw new Error('该分镜还没有可采用的推荐声音。');
    setButtonBusy(button, true, '采用中…');
    await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-assets/openverse`, { method: 'POST', body: { openverse_id: id, shot_index: Number(row.dataset.soundShot || 1), track_type: row.dataset.soundTrack || row.querySelector('[data-sound-track-type]')?.value || 'sfx' } });
  };
  const bindBgmImportButtons = (container, row) => {
    container?.querySelectorAll('[data-import-bgm]').forEach(button => button.addEventListener('click', async event => {
      try { await importSound(row, event.currentTarget, event.currentTarget.dataset.importBgm); toast('背景音乐已切换，原音乐不会重复叠加。', 'success'); await refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
    }));
  };
  const recommendationRequests = new Map();
  const pendingRows = [...host.querySelectorAll('[data-sound-query][data-auto-recommend="true"]')].filter(row => row.dataset.soundTrack === 'bgm' || row.dataset.soundBound === 'false');
  pendingRows.forEach(row => {
    const query = row.dataset.soundQuery || '';
    const resultHost = row.querySelector('[data-auto-sound-recommendation]');
    if (!query || !resultHost) return;
    if (!recommendationRequests.has(query)) recommendationRequests.set(query, request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-library?q=${encodeURIComponent(query)}`));
    recommendationRequests.get(query).then(result => {
      const items = result.results || [];
      const item = items[0];
      if (!item) { resultHost.innerHTML = '<small>暂未找到合规候选，可搜索其他声音或上传自己的。</small>'; return; }
      if (row.dataset.soundTrack === 'bgm') {
        resultHost.innerHTML = `<div class="bgm-candidate-grid">${items.slice(0, 1).map(bgmCandidateMarkup).join('')}</div>`;
        bindBgmImportButtons(resultHost, row);
        return;
      }
      row.dataset.recommendedSoundId = item.id;
      const previewLabel = row.dataset.soundTrack === 'bgm' ? '试听音乐' : '试听本镜';
      resultHost.innerHTML = `<small>系统推荐：${escapeHtml(item.name)} · ${escapeHtml(String(item.license || '').toUpperCase())}${result.fallback_used ? `（已按 ${escapeHtml(result.selected_query)} 扩展匹配）` : ''}</small>${soundPreviewMarkup(item.audio_url || '', Number(row.dataset.previewDuration || 4), previewLabel)}<button class="btn small" type="button" data-use-recommended-sound>采用这个声音</button>`;
      resultHost.querySelector('[data-use-recommended-sound]')?.addEventListener('click', async event => {
        try { await importSound(row, event.currentTarget); toast('声音已绑定并写入许可账本。', 'success'); await refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
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
  const bgmRow = host.querySelector('[data-sound-track="bgm"]');
  const bgmDialog = host.querySelector('[data-bgm-library-dialog]');
  const searchBgm = async (query, button) => {
    const resultsHost = host.querySelector('[data-bgm-library-results]');
    if (!query || !resultsHost || !bgmRow) return toast('请先选择或输入一种音乐风格。', 'warning');
    try {
      setButtonBusy(button, true, '搜索中…');
      setDialogFeedback('[data-bgm-library-feedback]');
      const result = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-library?q=${encodeURIComponent(query)}&track_type=bgm`);
      const items = result.results || [];
      const contextNote = result.match_mode === 'similar_open_license' ? `<p class="bgm-search-context">已将“${escapeHtml(result.reference_query || query)}”识别为歌曲或中文意境；以下展示风格相近的开放授权背景音乐，不会把商业原曲冒充为开源素材。</p>` : '';
      resultsHost.innerHTML = items.length ? `${contextNote}<div class="bgm-candidate-grid">${items.slice(0, 8).map(bgmCandidateMarkup).join('')}</div>` : `<p>${escapeHtml(result.license_note || '没有找到满足许可规则的音乐。')}</p>`;
      bindBgmImportButtons(resultsHost, bgmRow);
    } catch (error) { setDialogFeedback('[data-bgm-library-feedback]', error.message || '开源音乐库暂时不可用。'); } finally { setButtonBusy(button, false); }
  };
  host.querySelector('[data-search-bgm-library]')?.addEventListener('click', event => searchBgm(host.querySelector('[data-bgm-library-query]')?.value?.trim(), event.currentTarget));
  host.querySelector('[data-bgm-library-query]')?.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    const button = host.querySelector('[data-search-bgm-library]');
    if (!button?.disabled) searchBgm(event.currentTarget.value.trim(), button);
  });
  host.querySelector('[data-open-bgm-library]')?.addEventListener('click', async event => {
    if (!bgmDialog) return;
    bgmDialog.showModal();
    const query = host.querySelector('[data-bgm-library-query]')?.value?.trim() || bgmRow?.dataset.soundQuery || '';
    await searchBgm(query, event.currentTarget);
  });
  host.querySelector('[data-close-bgm-library]')?.addEventListener('click', () => bgmDialog?.close());
  bgmDialog?.addEventListener('click', event => { if (event.target === bgmDialog) bgmDialog.close(); });
  host.querySelectorAll('[data-bgm-query]').forEach(button => button.addEventListener('click', async event => {
    const input = host.querySelector('[data-bgm-library-query]');
    if (input) input.value = event.currentTarget.dataset.bgmQuery;
    host.querySelectorAll('[data-bgm-query]').forEach(item => item.classList.toggle('is-active', item === event.currentTarget));
    await searchBgm(event.currentTarget.dataset.bgmQuery, event.currentTarget);
  }));
  host.querySelector('[data-search-sound-library]')?.addEventListener('click', async event => {
    const query = host.querySelector('[data-sound-library-query]')?.value?.trim();
    if (!query) return toast('请先输入要查找的环境声或音效。', 'warning');
    const resultsHost = host.querySelector('[data-sound-library-results]');
    try {
      setButtonBusy(event.currentTarget, true, '搜索中…');
      const result = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-library?q=${encodeURIComponent(query)}`);
      const selectedShot = Number(host.querySelector('[data-sound-library-shot]')?.value || 1);
      const selectedRow = host.querySelector(`[data-sound-shot="${selectedShot}"]:not([data-sound-track="bgm"])`);
      const previewDuration = Number(selectedRow?.dataset.previewDuration || 4);
      resultsHost.innerHTML = (result.results || []).length ? result.results.map((item, index) => `<article class="${index === 0 ? 'is-recommended' : ''}"><div><b>${escapeHtml(item.name)}${index === 0 ? '<span class="sound-recommended-tag">系统推荐</span>' : ''}</b><small>${escapeHtml(item.creator)} · ${escapeHtml(String(item.license || '').toUpperCase())}</small></div>${soundPreviewMarkup(item.audio_url || '', previewDuration, '试听本镜')}<button class="btn small" type="button" data-import-openverse="${escapeHtml(item.id)}">采用这个声音</button></article>`).join('') : `<p>${escapeHtml(result.license_note || '没有找到满足许可规则的结果。')}</p>`;
      resultsHost.querySelectorAll('[data-import-openverse]').forEach(button => button.addEventListener('click', async importEvent => {
        try { setButtonBusy(importEvent.currentTarget, true, '采用中…'); await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-assets/openverse`, { method: 'POST', body: { openverse_id: importEvent.currentTarget.dataset.importOpenverse, shot_index: Number(host.querySelector('[data-sound-library-shot]')?.value || 1), track_type: host.querySelector('[data-sound-library-type]')?.value || 'sfx' } }); toast('声音已核验许可并绑定。', 'success'); await refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(importEvent.currentTarget, false); }
      }));
    } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
  });
}
