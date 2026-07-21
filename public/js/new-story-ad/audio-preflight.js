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

  /** 为弹窗中的候选曲目生成稳定但不泄露外部地址的页面键。 */
  function musicKey(item = {}, index = 0) {
    return `music_${index}_${String(item.id || item.title || item.name || '').replace(/[^a-z0-9_-]/ig, '_').slice(0, 48)}`;
  }

  /** 并行读取音色和公开曲目候选；任一来源失败都保留另一来源供用户选择。 */
  async function load({ state = {}, api, loadVoices, musicText = '' } = {}) {
    const [voiceResult, musicResult] = await Promise.allSettled([
      typeof loadVoices === 'function' ? loadVoices(false) : Promise.resolve(state.voiceList || []),
      state.bgmAsset ? Promise.resolve({ results: [] }) : api(`/api/new-story-ad/music/search?${new URLSearchParams({
        q: '', profile_id: state.bgmProfile || 'auto', text: String(musicText || '').slice(0, 600), page: '1', page_size: '20',
      }).toString()}`),
    ]);
    const loadedVoices = voiceResult.status === 'fulfilled' ? (voiceResult.value || []) : (state.voiceList || []);
    const voices = Array.isArray(loadedVoices) ? loadedVoices.slice() : [];
    if (state.voiceId && !voices.some(voice => String(voice?.id || '') === String(state.voiceId))) {
      voices.unshift({ id: state.voiceId, name: state.voiceName || state.voiceId, provider: '当前已保存选择', selectable: true });
    }
    const recommendedVoice = recommendVoice(voices, state);
    const remoteMusic = musicResult.status === 'fulfilled' && Array.isArray(musicResult.value?.results) ? musicResult.value.results : [];
    const music = [
      ...(state.bgmAsset ? [{ ...state.bgmAsset, _existing: true, _key: 'existing_bgm' }] : []),
      ...remoteMusic.slice(0, 12).map((item, index) => ({ ...item, _key: musicKey(item, index) })),
    ];
    return {
      voices: (Array.isArray(voices) ? voices : []).filter(voice => voice && voice.selectable !== false && String(voice.id || '').trim()),
      voiceId: String(state.voiceId || recommendedVoice?.id || ''),
      music,
      musicKey: state.bgmAsset ? 'existing_bgm' : (music[0]?._key || ''),
      warnings: [voiceResult.status === 'rejected' ? '音色列表暂时不可用' : '', musicResult.status === 'rejected' ? '公开曲库暂时不可用' : ''].filter(Boolean),
    };
  }

  /** 渲染自动推荐但可由用户关闭或替换的轻量声音配置。 */
  function html(plan = {}, escapeHtml = value => String(value || '')) {
    const voiceOptions = ['<option value="">不使用配音</option>', ...(plan.voices || []).map(voice => `<option value="${escapeHtml(voice.id)}" ${String(voice.id) === String(plan.voiceId) ? 'selected' : ''}>${escapeHtml(`${voice.name || voice.id} · ${voice.provider || voice.providerId || '系统'}`)}</option>`)].join('');
    const musicOptions = ['<option value="">不使用背景音乐</option>', ...(plan.music || []).map(item => `<option value="${escapeHtml(item._key)}" ${item._key === plan.musicKey ? 'selected' : ''}>${escapeHtml(`${item.title_zh || item.title || item.name || '公开曲目'} · ${item.creator || item.source || item.license_label || item.license || '已授权'}`)}</option>`)].join('');
    const warning = plan.warnings?.length ? `<div class="dh-nsa-audio-preflight-warning">${escapeHtml(plan.warnings.join('；'))}</div>` : '';
    return `<section class="dh-nsa-audio-preflight" data-nsa-audio-preflight>
      <div class="dh-nsa-audio-preflight-head"><b>声音配置</b><span>系统已自动推荐，提交前可更换或关闭；不会改变视频人物与场景。</span></div>
      <label><span>旁白配音</span><div><select class="dh-input" data-nsa-audio-voice>${voiceOptions}</select><button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-nsa-audio-voice-preview>试听</button></div></label>
      <label><span>背景音乐</span><div><select class="dh-input" data-nsa-audio-music>${musicOptions}</select><button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-nsa-audio-music-preview>试听</button></div></label>
      ${warning}
      <label class="dh-nsa-audio-silent-ack" data-nsa-audio-silent-ack hidden><input type="checkbox">我确认生成无旁白、无背景音乐的静音成片</label>
      <div class="dh-nsa-audio-preflight-error" data-nsa-audio-error hidden></div>
    </section>`;
  }

  /** 停止声音预检弹窗中正在播放的公开曲目。 */
  function stopPreview() {
    if (!previewAudio) return;
    try { previewAudio.pause(); previewAudio.currentTime = 0; } catch {}
    previewAudio = null;
  }

  /** 绑定试听与静音确认状态，不触发任何生成或导入操作。 */
  function bind(modal, plan = {}, { previewVoice } = {}) {
    const voice = modal.querySelector('[data-nsa-audio-voice]');
    const music = modal.querySelector('[data-nsa-audio-music]');
    const ack = modal.querySelector('[data-nsa-audio-silent-ack]');
    const refreshAck = () => { if (ack) ack.hidden = !!(voice?.value || music?.value); };
    voice?.addEventListener('change', refreshAck);
    music?.addEventListener('change', refreshAck);
    modal.querySelector('[data-nsa-audio-voice-preview]')?.addEventListener('click', event => {
      if (voice?.value && typeof previewVoice === 'function') previewVoice(voice.value, event.currentTarget);
    });
    modal.querySelector('[data-nsa-audio-music-preview]')?.addEventListener('click', event => {
      stopPreview();
      const item = (plan.music || []).find(row => row._key === music?.value);
      const url = item?.preview_url || item?.previewUrl || item?.file_url || item?.url || '';
      if (!url) return;
      previewAudio = new Audio(url);
      previewAudio.addEventListener('ended', stopPreview, { once: true });
      previewAudio.play().catch(() => { event.currentTarget.textContent = '无法试听'; stopPreview(); });
    });
    refreshAck();
  }

  /** 读取最终选择；完全静音必须由用户额外明确确认。 */
  function read(modal, plan = {}) {
    const voiceId = String(modal.querySelector('[data-nsa-audio-voice]')?.value || '');
    const selectedMusicKey = String(modal.querySelector('[data-nsa-audio-music]')?.value || '');
    const silentAccepted = modal.querySelector('[data-nsa-audio-silent-ack] input')?.checked === true;
    if (!voiceId && !selectedMusicKey && !silentAccepted) return { error: '配音和背景音乐都已关闭；如需静音成片，请勾选确认。' };
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

  const api = { explicitVoiceGender, recommendVoice, load, html, bind, read, apply, stopPreview };
  if (typeof window !== 'undefined') window.NewStoryAdAudioPreflight = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
