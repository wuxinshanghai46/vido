(() => {
  let previewAudio = null;

  /** 只读取人物明确字段，不根据行业、职业或场景猜测声音性别。 */
  function explicitVoiceGender(state = {}) {
    const context = state.context || {};
    const values = [
      context.person_spec?.gender,
      context.personSpec?.gender,
      context.person_context?.person_spec?.gender,
      ...(Array.isArray(context.cast_profiles) ? context.cast_profiles.map(item => item?.gender) : []),
      ...(Array.isArray(state.castProfiles) ? state.castProfiles.map(item => item?.gender) : []),
    ];
    const raw = values.map(value => String(value || '').trim().toLowerCase()).find(Boolean) || '';
    if (/female|woman|girl|女/.test(raw)) return 'female';
    if (/male|man|boy|男/.test(raw)) return 'male';
    return '';
  }

  /** 从当前健康音色列表中选择通用推荐项，已有人工选择始终优先。 */
  function recommendVoice(voices = [], state = {}) {
    const selectable = (Array.isArray(voices) ? voices : []).filter(voice => voice && voice.selectable !== false && String(voice.id || '').trim());
    const existing = selectable.find(voice => String(voice.id) === String(state.voiceId || ''));
    if (existing) return existing;
    const gender = explicitVoiceGender(state);
    const ranked = selectable.map((voice, index) => {
      const rawGender = String(voice.gender || voice.sex || voice.tags?.gender || '').toLowerCase();
      const normalizedGender = /female|woman|girl|女/.test(rawGender) ? 'female' : (/male|man|boy|男/.test(rawGender) ? 'male' : '');
      const recommended = /推荐|recommended/i.test(String(voice.tag || voice.tags?.join?.(' ') || ''));
      return { voice, index, score: (gender && normalizedGender === gender ? 20 : 0) + (recommended ? 5 : 0) };
    }).sort((a, b) => b.score - a.score || a.index - b.index);
    return ranked[0]?.voice || null;
  }

  function stableHash(value = '') {
    let hash = 2166136261;
    for (const character of String(value)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  /** 使用来源身份去重，页面键不再依赖搜索结果顺序。 */
  function musicIdentity(item = {}) {
    return [
      item.provider || item.source || '', item.id || item.audio_id || '',
      item.preview_url || item.previewUrl || item.file_url || item.url || '',
      item.title || item.title_zh || item.name || '', item.creator || '',
    ].map(value => String(value || '').trim().toLowerCase()).join('|');
  }

  function musicKey(item = {}) {
    return `music_${stableHash(musicIdentity(item))}`;
  }

  /** 并行读取音色和公开曲目候选；已有 BGM 也必须加载曲库以便替换。 */
  async function load({ state = {}, api, loadVoices, musicText = '' } = {}) {
    const musicRequest = typeof api === 'function'
      ? api(`/api/new-story-ad/music/search?${new URLSearchParams({
        q: '', profile_id: state.bgmProfile || 'auto', text: String(musicText || '').slice(0, 600), page: '1', page_size: '20',
      }).toString()}`)
      : Promise.resolve({ results: [] });
    const [voiceResult, musicResult] = await Promise.allSettled([
      typeof loadVoices === 'function' ? loadVoices(false) : Promise.resolve(state.voiceList || []),
      musicRequest,
    ]);
    const loadedVoices = voiceResult.status === 'fulfilled' ? (voiceResult.value || []) : (state.voiceList || []);
    const voices = Array.isArray(loadedVoices) ? loadedVoices.slice() : [];
    if (state.voiceId && !voices.some(voice => String(voice?.id || '') === String(state.voiceId))) {
      voices.unshift({ id: state.voiceId, name: state.voiceName || state.voiceId, provider: '当前已保存选择', selectable: true });
    }
    const recommendedVoice = recommendVoice(voices, state);
    const remoteMusic = musicResult.status === 'fulfilled' && Array.isArray(musicResult.value?.results) ? musicResult.value.results : [];
    const music = [];
    const seenMusic = new Set();
    if (state.bgmAsset) {
      const identity = musicIdentity(state.bgmAsset);
      seenMusic.add(identity);
      music.push({ ...state.bgmAsset, _existing: true, _identity: identity, _key: 'existing_bgm' });
    }
    for (const item of remoteMusic) {
      const identity = musicIdentity(item);
      if (!identity || seenMusic.has(identity)) continue;
      seenMusic.add(identity);
      music.push({ ...item, _identity: identity, _key: musicKey(item) });
      if (music.filter(row => !row._existing).length >= 12) break;
    }
    return {
      voices: voices.filter(voice => voice && voice.selectable !== false && String(voice.id || '').trim()),
      voiceId: String(state.voiceId || recommendedVoice?.id || ''),
      music,
      musicKey: state.bgmAsset ? 'existing_bgm' : (music[0]?._key || ''),
      warnings: [voiceResult.status === 'rejected' ? '音色列表暂时不可用' : '', musicResult.status === 'rejected' ? '公开曲库暂时不可用，请稍后重新打开本窗口' : ''].filter(Boolean),
    };
  }

  function pickerHtml({ kind, value = '', options = [] } = {}, escapeHtml = text => String(text || '')) {
    const selected = options.find(option => String(option.value) === String(value)) || options[0] || { value: '', label: '' };
    const optionHtml = options.map(option => {
      const isSelected = String(option.value) === String(selected.value);
      return `<button type="button" class="dh-nsa-audio-picker-option${isSelected ? ' is-selected' : ''}" role="option" aria-selected="${isSelected}" data-nsa-audio-picker-option data-value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</button>`;
    }).join('');
    return `<div class="dh-nsa-audio-picker" data-nsa-audio-picker="${kind}">
      <input type="hidden" data-nsa-audio-${kind} value="${escapeHtml(selected.value)}">
      <button type="button" class="dh-nsa-audio-picker-trigger" aria-haspopup="listbox" aria-expanded="false" data-nsa-audio-picker-trigger><span data-nsa-audio-picker-label>${escapeHtml(selected.label)}</span><i aria-hidden="true"></i></button>
      <div class="dh-nsa-audio-picker-options" role="listbox" tabindex="-1" data-nsa-audio-picker-options hidden>${optionHtml}</div>
    </div>`;
  }

  /** 渲染自动推荐但可由用户关闭或替换的轻量声音配置。 */
  function html(plan = {}, escapeHtml = value => String(value || '')) {
    const voicePicker = pickerHtml({
      kind: 'voice', value: plan.voiceId,
      options: [{ value: '', label: '不使用配音' }, ...(plan.voices || []).map(voice => ({
        value: String(voice.id || ''), label: `${voice.name || voice.id} · ${voice.provider || voice.providerId || '系统'}`,
      }))],
    }, escapeHtml);
    const musicPicker = pickerHtml({
      kind: 'music', value: plan.musicKey,
      options: [{ value: '', label: '不使用背景音乐' }, ...(plan.music || []).map(item => ({
        value: String(item._key || ''), label: `${item.title_zh || item.title || item.name || '公开曲目'} · ${item.creator || item.source || item.license_label || item.license || '已授权'}`,
      }))],
    }, escapeHtml);
    const warning = plan.warnings?.length ? `<div class="dh-nsa-audio-preflight-warning">${escapeHtml(plan.warnings.join('；'))}</div>` : '';
    return `<section class="dh-nsa-audio-preflight" data-nsa-audio-preflight>
      <div class="dh-nsa-audio-preflight-head"><b>声音配置</b><span>系统已自动推荐，提交前可更换或关闭；不会改变视频人物与场景。</span></div>
      <label><span>旁白配音</span><div>${voicePicker}<button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-nsa-audio-voice-preview>试听</button></div></label>
      <label><span>背景音乐</span><div>${musicPicker}<button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-nsa-audio-music-preview>试听</button></div></label>
      ${warning}
      <div class="dh-nsa-audio-preflight-error" data-nsa-audio-error hidden></div>
    </section>`;
  }

  /** 停止声音预检弹窗中正在播放的公开曲目。 */
  function stopPreview() {
    if (!previewAudio) return;
    try { previewAudio.pause(); previewAudio.currentTime = 0; } catch {}
    previewAudio = null;
  }

  function bindPicker(modal, picker) {
    const trigger = picker.querySelector('[data-nsa-audio-picker-trigger]');
    const list = picker.querySelector('[data-nsa-audio-picker-options]');
    const input = picker.querySelector('input[type="hidden"]');
    const label = picker.querySelector('[data-nsa-audio-picker-label]');
    const options = () => [...picker.querySelectorAll('[data-nsa-audio-picker-option]')];
    const close = () => {
      list?.setAttribute('hidden', '');
      trigger?.setAttribute('aria-expanded', 'false');
    };
    const open = focusSelected => {
      modal.querySelectorAll('[data-nsa-audio-picker]').forEach(other => {
        if (other === picker) return;
        other.querySelector('[data-nsa-audio-picker-options]')?.setAttribute('hidden', '');
        other.querySelector('[data-nsa-audio-picker-trigger]')?.setAttribute('aria-expanded', 'false');
      });
      list?.removeAttribute('hidden');
      trigger?.setAttribute('aria-expanded', 'true');
      if (focusSelected) (options().find(option => option.getAttribute('aria-selected') === 'true') || options()[0])?.focus();
    };
    const choose = option => {
      if (!option || !input) return;
      input.value = String(option.dataset.value || '');
      if (label) label.textContent = option.textContent || '';
      options().forEach(row => {
        const selected = row === option;
        row.classList.toggle('is-selected', selected);
        row.setAttribute('aria-selected', String(selected));
      });
      if (picker.dataset.nsaAudioPicker === 'music') stopPreview();
      close();
      trigger?.focus();
    };
    trigger?.addEventListener('click', () => list?.hasAttribute('hidden') ? open(false) : close());
    trigger?.addEventListener('keydown', event => {
      if (['Enter', ' ', 'ArrowDown'].includes(event.key)) { event.preventDefault(); open(event.key === 'ArrowDown'); }
      else if (event.key === 'Escape') close();
    });
    options().forEach(option => {
      option.addEventListener('click', () => choose(option));
      option.addEventListener('keydown', event => {
        const rows = options();
        const index = rows.indexOf(option);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
        } else if (['Enter', ' '].includes(event.key)) { event.preventDefault(); choose(option); }
        else if (event.key === 'Escape') { event.preventDefault(); close(); trigger?.focus(); }
      });
    });
    return close;
  }

  /** 绑定列表与试听；选择、试听和关闭都不会触发生成或导入。 */
  function bind(modal, plan = {}, { previewVoice } = {}) {
    const voice = modal.querySelector('[data-nsa-audio-voice]');
    const music = modal.querySelector('[data-nsa-audio-music]');
    const pickers = [...(modal.querySelectorAll?.('[data-nsa-audio-picker]') || [])];
    const closePickers = pickers.map(picker => bindPicker(modal, picker));
    modal.addEventListener?.('click', event => {
      pickers.forEach((picker, index) => { if (!picker.contains(event.target)) closePickers[index](); });
    });
    modal.querySelector('[data-nsa-audio-voice-preview]')?.addEventListener('click', event => {
      if (voice?.value && typeof previewVoice === 'function') previewVoice(voice.value, event.currentTarget);
    });
    modal.querySelector('[data-nsa-audio-music-preview]')?.addEventListener('click', event => {
      stopPreview();
      const item = (plan.music || []).find(row => row._key === music?.value);
      const url = item?.preview_url || item?.previewUrl || item?.file_url || item?.url || '';
      if (!url) { event.currentTarget.textContent = '暂无试听'; return; }
      previewAudio = new Audio(url);
      previewAudio.addEventListener('ended', stopPreview, { once: true });
      previewAudio.play().catch(() => { event.currentTarget.textContent = '无法试听'; stopPreview(); });
    });
  }

  /** 读取最终选择；同时关闭配音和音乐即为明确的静音选择。 */
  function read(modal, plan = {}) {
    const voiceId = String(modal.querySelector('[data-nsa-audio-voice]')?.value || '');
    const selectedMusicKey = String(modal.querySelector('[data-nsa-audio-music]')?.value || '');
    const voice = (plan.voices || []).find(item => String(item.id) === voiceId) || null;
    const music = (plan.music || []).find(item => item._key === selectedMusicKey) || null;
    return { value: { voiceId, voiceName: voice?.name || '', music, silent: !voiceId && !music } };
  }

  /** 导入用户确认的公开曲目，并只在确认成功后更新页面媒体状态。 */
  async function apply(selection = {}, { state = {}, api } = {}) {
    let bgmAsset = null;
    if (selection.music?._existing) bgmAsset = state.bgmAsset || selection.music;
    else if (selection.music) {
      const imported = await api('/api/new-story-ad/music/import', { method: 'POST', body: { item: selection.music } });
      bgmAsset = imported.bgm_asset || imported.bgmAsset || imported.asset || null;
      if (!bgmAsset) throw new Error('背景音乐导入后没有返回可用文件，本次没有提交视频生成。');
    }
    state.voiceId = selection.voiceId || '';
    state.voiceName = selection.voiceName || '';
    state.bgmAsset = bgmAsset;
    stopPreview();
    return { voiceId: state.voiceId, voiceName: state.voiceName, bgmAsset };
  }

  const api = { explicitVoiceGender, recommendVoice, musicIdentity, musicKey, load, html, bind, read, apply, stopPreview };
  if (typeof window !== 'undefined') window.NewStoryAdAudioPreflight = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
