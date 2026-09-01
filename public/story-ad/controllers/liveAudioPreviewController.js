import { escapeHtml } from '../components/ui.js?v=20260901-production-v376';

export function previewSeconds(value = 4, cap = 6) {
  return Math.max(1, Math.min(cap, Math.round((Number(value) || 4) * 10) / 10));
}

export function soundPreviewMarkup(url = '', duration = 4, label = '试听本镜', previewKind = '') {
  if (!url) return '';
  const seconds = previewSeconds(duration, label === '试听音乐' ? 8 : 6);
  return `<div class="sound-preview-control"><button class="btn small" type="button" data-play-sound-preview data-preview-seconds="${seconds}">▶ ${label} ${seconds} 秒</button><audio preload="none" src="${escapeHtml(url)}" ${previewKind ? `data-preview-kind="${escapeHtml(previewKind)}"` : ''} hidden></audio></div>`;
}

export function bgmCandidateMarkup(item = {}, index = 0) {
  return `<article class="bgm-candidate ${index === 0 ? 'is-recommended' : ''}" data-openverse-preview="${escapeHtml(item.id || '')}"><div><b>${escapeHtml(item.name || '背景音乐')}</b><small>${escapeHtml(item.creator || 'Unknown')} · ${escapeHtml(String(item.license || '').toUpperCase())}${index === 0 ? ' · 系统首选' : ''}</small>${item.match_reason ? `<small class="bgm-match-reason">匹配方向：${escapeHtml(item.match_reason)}</small>` : ''}</div>${soundPreviewMarkup(item.audio_url || '', 8, '试听音乐', 'bgm')}<button class="btn small" type="button" data-import-bgm="${escapeHtml(item.id || '')}">${index === 0 ? '使用这首' : '切换为这首'}</button></article>`;
}

export function bindLiveAudioPreview({ host, bundle, audioPlanPayload, request, setButtonBusy, toast }) {
  const volumeValue = selector => Math.max(0, Math.min(1, Number(host.querySelector(selector)?.value || 0)));
  const voicePlayer = host.querySelector('[data-overall-voice-player]');
  const bgmPlayer = host.querySelector('[data-overall-bgm-player]');
  const status = host.querySelector('[data-overall-audio-status]');
  const playButton = host.querySelector('[data-play-overall-audio]');

  host.addEventListener('play', event => {
    const current = event.target;
    if (String(current?.tagName || '').toLowerCase() !== 'audio') return;
    const stoppedOverall = current.dataset.audioGroup !== 'overall' && voicePlayer && !voicePlayer.paused;
    host.querySelectorAll('audio').forEach(audio => {
      const sameGroup = current.dataset.audioGroup && audio.dataset.audioGroup === current.dataset.audioGroup;
      if (audio !== current && !sameGroup && !audio.paused) { audio.pause(); audio.currentTime = 0; }
    });
    host.querySelectorAll('[data-play-sound-preview]').forEach(button => {
      const audio = button.parentElement?.querySelector('audio');
      if (audio !== current && button.dataset.idleText) button.textContent = button.dataset.idleText;
    });
    if (stoppedOverall) {
      if (playButton && !playButton.disabled) playButton.textContent = '▶ 试听背景音乐 + 配音对白';
      if (status) status.textContent = '已切换到单项试听；整体试听已停止。';
    }
  }, true);

  const stopOverall = ({ clearSource = false } = {}) => {
    [voicePlayer, bgmPlayer].filter(Boolean).forEach(audio => {
      audio.pause(); audio.currentTime = 0;
      if (clearSource) audio.removeAttribute('src');
    });
    if (playButton && !playButton.disabled) playButton.textContent = '▶ 试听背景音乐 + 配音对白';
  };
  const syncPreviewVolumes = () => {
    const voiceVolume = volumeValue('[data-voice-volume]');
    const bgmVolume = volumeValue('[data-bgm-volume]');
    host.querySelectorAll('audio[data-preview-kind="voice"]').forEach(audio => { audio.volume = voiceVolume; });
    host.querySelectorAll('audio[data-preview-kind="bgm"]').forEach(audio => { audio.volume = bgmVolume; });
    const voiceOutput = host.querySelector('[data-voice-volume-value]'); if (voiceOutput) voiceOutput.textContent = `${Math.round(voiceVolume * 100)}%`;
    const bgmOutput = host.querySelector('[data-bgm-volume-value]'); if (bgmOutput) bgmOutput.textContent = `${Math.round(bgmVolume * 100)}%`;
    if (status && voicePlayer && !voicePlayer.paused) status.textContent = `正在试听：配音 ${Math.round(voiceVolume * 100)}% + 背景音乐 ${Math.round(bgmVolume * 100)}%（可继续实时调节）`;
  };
  syncPreviewVolumes();
  host.querySelector('[data-voice-volume]')?.addEventListener('input', syncPreviewVolumes);
  host.querySelector('[data-bgm-volume]')?.addEventListener('input', syncPreviewVolumes);

  playButton?.addEventListener('click', async event => {
    try {
      if (voicePlayer && !voicePlayer.paused) {
        stopOverall();
        if (status) status.textContent = '整体试听已停止；音量设置会保留。';
        return;
      }
      setButtonBusy(event.currentTarget, true, '正在准备整体试听…', { elapsed: true });
      const payload = audioPlanPayload();
      await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/audio-plan`, { method: 'PUT', body: payload });
      if (!voicePlayer?.src || !bgmPlayer?.src) {
        const result = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/audio-mix-preview`, { method: 'POST', body: payload, timeoutMs: 120000 });
        if (!result.preview?.voice_audio_url || !result.preview?.bgm_audio_url) throw new Error('整体试听的配音轨或背景音乐轨没有准备完成。');
        voicePlayer.src = result.preview.voice_audio_url;
        bgmPlayer.src = result.preview.bgm_audio_url;
      }
      syncPreviewVolumes();
      voicePlayer.currentTime = 0;
      bgmPlayer.currentTime = 0;
      await Promise.all([voicePlayer.play(), bgmPlayer.play()]);
      if (status) status.textContent = `正在试听：配音 ${Math.round(volumeValue('[data-voice-volume]') * 100)}% + 背景音乐 ${Math.round(volumeValue('[data-bgm-volume]') * 100)}%（可继续实时调节）`;
    } catch (error) {
      stopOverall({ clearSource: true });
      toast(error.message, 'danger');
      if (status) status.textContent = error.message || '整体试听生成失败。';
    } finally {
      setButtonBusy(event.currentTarget, false);
      if (voicePlayer && !voicePlayer.paused) event.currentTarget.textContent = '■ 停止整体试听';
    }
  });
  voicePlayer?.addEventListener('ended', () => {
    stopOverall();
    if (status) status.textContent = '整体试听已播放完成，可调整音量后直接再次试听。';
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
