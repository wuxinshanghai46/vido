import { escapeHtml } from '../components/ui.js?v=20260904-production-v447';

export function previewSeconds(value = 4, cap = 6) {
  return Math.max(1, Math.min(cap, Math.round((Number(value) || 4) * 10) / 10));
}

export function soundPreviewMarkup(url = '', duration = 4, label = '试听本镜', previewKind = '') {
  if (!url) return '';
  const seconds = previewSeconds(duration, label === '试听音乐' ? 8 : 6);
  return `<div class="sound-preview-control"><button class="btn small" type="button" data-play-sound-preview data-preview-seconds="${seconds}">▶ ${label} ${seconds} 秒</button><audio preload="none" src="${escapeHtml(url)}" ${previewKind ? `data-preview-kind="${escapeHtml(previewKind)}"` : ''} hidden></audio></div>`;
}

export function bgmCandidateMarkup(item = {}, index = 0, selectedSourceId = '') {
  const selected = !!selectedSourceId && String(item.id || '') === String(selectedSourceId);
  return `<article class="bgm-candidate ${index === 0 ? 'is-recommended' : ''} ${selected ? 'is-selected' : ''}" data-openverse-preview="${escapeHtml(item.id || '')}"><div><b>${escapeHtml(item.name || '背景音乐')}</b><small>${escapeHtml(item.creator || 'Unknown')} · ${escapeHtml(String(item.license || '').toUpperCase())}${selected ? ' · 当前使用' : (index === 0 ? ' · 系统首选' : '')}</small>${item.match_reason ? `<small class="bgm-match-reason">匹配方向：${escapeHtml(item.match_reason)}</small>` : ''}</div>${soundPreviewMarkup(item.audio_url || '', 8, '试听音乐', 'bgm')}<button class="btn small" type="button" data-import-bgm="${escapeHtml(item.id || '')}" ${selected ? 'disabled' : ''}>${selected ? '已选择' : (index === 0 ? '使用这首' : '切换为这首')}</button></article>`;
}

export function bindLiveAudioPreview({ host, bundle, audioPlanPayload, request, toast }) {
  const volumeValue = (selector, maximum = 1) => Math.max(0, Math.min(maximum, Number(host.querySelector(selector)?.value || 0)));
  const voicePlayer = host.querySelector('[data-overall-voice-player]');
  const bgmPlayer = host.querySelector('[data-overall-bgm-player]');
  const status = host.querySelector('[data-overall-audio-status]');
  const playButton = host.querySelector('[data-play-overall-audio]');
  let overallState = 'idle';
  let expectedDuration = 0;
  let endGuard = null;
  let audioContext = null;
  let voiceGain = null;
  let bgmGain = null;
  let overallPreparation = null;

  const setPlayButton = (label, disabled = false) => {
    if (!playButton) return;
    playButton.textContent = label;
    playButton.disabled = disabled;
    if (disabled) playButton.setAttribute('aria-busy', 'true'); else playButton.removeAttribute('aria-busy');
  };
  const ensureGainGraph = () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !voicePlayer || !bgmPlayer) return;
    if (!audioContext) {
      audioContext = new AudioContextClass();
      voiceGain = audioContext.createGain();
      bgmGain = audioContext.createGain();
      audioContext.createMediaElementSource(voicePlayer).connect(voiceGain).connect(audioContext.destination);
      audioContext.createMediaElementSource(bgmPlayer).connect(bgmGain).connect(audioContext.destination);
      voicePlayer.volume = 1;
      bgmPlayer.volume = 1;
    }
    // Some browsers keep AudioContext.resume() pending while media is still
    // buffering.  Never let that promise hold the click handler in "loading".
    if (audioContext.state === 'suspended') Promise.resolve(audioContext.resume()).catch(() => {});
  };
  const clearEndGuard = () => { if (endGuard) clearTimeout(endGuard); endGuard = null; };
  const armEndGuard = () => {
    clearEndGuard();
    const remaining = Math.max(0, expectedDuration - Number(voicePlayer?.currentTime || 0));
    if (remaining > 0) endGuard = setTimeout(() => finishOverall(), Math.ceil((remaining + 0.35) * 1000));
  };

  host.addEventListener('play', event => {
    const current = event.target;
    if (String(current?.tagName || '').toLowerCase() !== 'audio') return;
    const stoppedOverall = current.dataset.audioGroup !== 'overall' && overallState === 'playing';
    host.querySelectorAll('audio').forEach(audio => {
      const sameGroup = current.dataset.audioGroup && audio.dataset.audioGroup === current.dataset.audioGroup;
      if (audio !== current && !sameGroup && !audio.paused) { audio.pause(); audio.currentTime = 0; }
    });
    host.querySelectorAll('[data-play-sound-preview]').forEach(button => {
      const audio = button.parentElement?.querySelector('audio');
      if (audio !== current && button.dataset.idleText) button.textContent = button.dataset.idleText;
    });
    if (stoppedOverall) {
      overallState = 'idle';
      clearEndGuard();
      setPlayButton('▶ 整体试听');
      if (status) status.textContent = '已切换到单项试听；整体试听已停止。';
    }
  }, true);

  const stopOverall = ({ clearSource = false, reset = true } = {}) => {
    clearEndGuard();
    [voicePlayer, bgmPlayer].filter(Boolean).forEach(audio => {
      audio.pause();
      if (reset) audio.currentTime = 0;
      if (clearSource) audio.removeAttribute('src');
    });
    overallState = reset ? 'idle' : 'paused';
    setPlayButton(reset ? '▶ 整体试听' : '▶ 继续试听');
  };
  const finishOverall = () => {
    if (overallState === 'idle') return;
    stopOverall();
    if (status) status.textContent = '试听已结束。';
  };
  const syncPreviewVolumes = () => {
    const voiceVolume = volumeValue('[data-voice-volume]', 1.5);
    const bgmVolume = volumeValue('[data-bgm-volume]', 1);
    host.querySelectorAll('audio[data-preview-kind="voice"]').forEach(audio => { if (audio !== voicePlayer || !voiceGain) audio.volume = Math.min(1, voiceVolume); });
    host.querySelectorAll('audio[data-preview-kind="bgm"]').forEach(audio => { if (audio !== bgmPlayer || !bgmGain) audio.volume = Math.min(1, bgmVolume); });
    if (voiceGain) voiceGain.gain.value = voiceVolume;
    if (bgmGain) bgmGain.gain.value = bgmVolume;
    const voiceOutput = host.querySelector('[data-voice-volume-value]'); if (voiceOutput) voiceOutput.textContent = `${Math.round(voiceVolume * 100)}%`;
    const bgmOutput = host.querySelector('[data-bgm-volume-value]'); if (bgmOutput) bgmOutput.textContent = `${Math.round(bgmVolume * 100)}%`;
    if (status && overallState === 'playing') status.textContent = `试听中：配音 ${Math.round(voiceVolume * 100)}% + 背景音乐 ${Math.round(bgmVolume * 100)}%`;
  };
  syncPreviewVolumes();
  host.querySelector('[data-voice-volume]')?.addEventListener('input', syncPreviewVolumes);
  host.querySelector('[data-bgm-volume]')?.addEventListener('input', syncPreviewVolumes);

  const prepareOverallPreview = () => {
    if (voicePlayer?.src && bgmPlayer?.src) return Promise.resolve();
    if (overallPreparation) return overallPreparation;
    const payload = audioPlanPayload();
    overallPreparation = request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/audio-mix-preview`, { method: 'POST', body: payload, timeoutMs: 120000 })
      .then(result => {
        if (!result.preview?.voice_audio_url || !result.preview?.bgm_audio_url) throw new Error('整体试听的配音轨或背景音乐轨没有准备完成。');
        voicePlayer.src = result.preview.voice_audio_url;
        bgmPlayer.src = result.preview.bgm_audio_url;
        expectedDuration = Math.max(0, Number(result.preview.duration_sec || 0));
      })
      .finally(() => { overallPreparation = null; });
    return overallPreparation;
  };
  if (playButton && !playButton.disabled) setTimeout(() => { prepareOverallPreview().catch(() => {}); }, 0);

  const playOverall = () => {
    ensureGainGraph();
    syncPreviewVolumes();
    overallState = 'playing';
    setPlayButton('⏸ 暂停');
    syncPreviewVolumes();
    armEndGuard();
    // Leave the click event stack before invoking media playback. Some browser
    // engines synchronously wait for remote media startup inside play().
    setTimeout(() => {
      Promise.all([voicePlayer.play(), bgmPlayer.play()]).catch(error => {
        stopOverall({ clearSource: true });
        toast(error.message || '整体试听无法播放。', 'danger');
        if (status) status.textContent = error.message || '整体试听无法播放。';
      });
    }, 0);
  };

  playButton?.addEventListener('click', async () => {
    try {
      if (overallState === 'playing') {
        stopOverall({ reset: false });
        if (status) status.textContent = '试听已暂停。';
        return;
      }
      if (overallState === 'paused' && voicePlayer?.src && bgmPlayer?.src) {
        playOverall();
        return;
      }
      overallState = 'loading';
      const payload = audioPlanPayload();
      request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/audio-plan`, { method: 'PUT', body: payload }).catch(error => toast(error.message || '音量设置暂未保存。', 'warning'));
      await prepareOverallPreview();
      voicePlayer.currentTime = 0;
      bgmPlayer.currentTime = 0;
      playOverall();
    } catch (error) {
      stopOverall({ clearSource: true });
      toast(error.message, 'danger');
      if (status) status.textContent = error.message || '整体试听生成失败。';
    }
  });
  voicePlayer?.addEventListener('ended', finishOverall);
  voicePlayer?.addEventListener('error', finishOverall);
  bgmPlayer?.addEventListener('ended', () => {
    if (overallState !== 'playing' || voicePlayer?.ended) return;
    bgmPlayer.currentTime = 0;
    bgmPlayer.play().catch(finishOverall);
  });

  let previewTimer = null;
  host.addEventListener('click', async event => {
    const button = event.target.closest('[data-play-sound-preview]');
    if (!button) return;
    const audio = button.parentElement?.querySelector('audio');
    if (!audio) return;
    const openverseId = button.closest('[data-openverse-preview]')?.dataset.openversePreview;
    if (openverseId) request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-assets/openverse/prepare`, { method: 'POST', body: { openverse_id: openverseId }, timeoutMs: 60000 }).catch(() => {});
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

  return { syncPreviewVolumes, stopOverall };
}
