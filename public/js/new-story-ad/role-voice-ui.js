(() => {
  function speakersFromState(state = {}, normalizeText = value => String(value || '').trim()) {
    const names = [];
    (state.shots || []).forEach(shot => (shot.dialogue_lines || []).forEach(line => {
      const name = normalizeText(line?.speaker || '', 100);
      if (name && !/^(旁白|解说|画外音)$/.test(name) && !names.includes(name)) names.push(name);
    }));
    (state.castProfiles || []).forEach(profile => {
      const name = normalizeText(profile?.name || profile?.character_name || '', 100);
      if (name && !names.includes(name)) names.push(name);
    });
    return names.slice(0, 30);
  }

  async function open(deps = {}) {
    const { state, loadVoices, toast, ensureModal, hideModal, showModal, escapeHtml, voiceDisplay, normalizeText, markMediaDirty, renderAll, scheduleAutoSave } = deps;
    try { await loadVoices(false); } catch (err) { return toast(err.message || '音色列表加载失败', 'error'); }
    const speakers = speakersFromState(state, normalizeText);
    if (!speakers.length) return toast('当前分镜还没有带说话人姓名的角色对白，请先生成或补充 dialogue_lines', 'error');
    const modal = ensureModal('dhNsaRoleVoiceModal', '设置旁白与角色音色');
    const body = modal.querySelector('[data-nsa-modal-body]');
    const selectable = (state.voiceList || []).filter(voice => voice.selectable !== false && String(voice.id || '').trim());
    const optionHtml = selected => `<option value="">未设置</option>${selectable.map(voice => {
      const id = String(voice.id || ''); const display = voiceDisplay(voice);
      return `<option value="${escapeHtml(id)}" ${id === selected ? 'selected' : ''}>${escapeHtml(display.name)} · ${escapeHtml(display.sub)}</option>`;
    }).join('')}`;
    const assignments = state.voiceAssignments || { narrator: state.voiceId || '', speakers: {} };
    body.innerHTML = `<p class="dh-nsa-picker-note">旁白和每个角色分别绑定真实可用音色。生成时按说话人逐句 TTS，再按台词顺序拼成该镜音轨；不会把多个人的对白串成同一个声音。</p>
      <div style="display:grid;gap:10px">
        <label class="dh-nsa-picker-card"><b>旁白 / 画外音</b><select class="dh-input" data-nsa-role-voice="__narrator">${optionHtml(assignments.narrator || state.voiceId || '')}</select></label>
        ${speakers.map(speaker => `<label class="dh-nsa-picker-card"><b>${escapeHtml(speaker)}</b><select class="dh-input" data-nsa-role-voice="${escapeHtml(speaker)}">${optionHtml(assignments.speakers?.[speaker] || '')}</select></label>`).join('')}
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px"><button type="button" class="dh-btn dh-btn-ghost" data-nsa-role-voice-cancel>取消</button><button type="button" class="dh-btn dh-btn-primary" data-nsa-role-voice-save>保存角色音色</button></div>`;
    body.querySelector('[data-nsa-role-voice-cancel]')?.addEventListener('click', () => hideModal(modal));
    body.querySelector('[data-nsa-role-voice-save]')?.addEventListener('click', () => {
      const next = { narrator: '', speakers: {} };
      body.querySelectorAll('[data-nsa-role-voice]').forEach(select => {
        const speaker = select.dataset.nsaRoleVoice; const voiceId = select.value || '';
        if (speaker === '__narrator') next.narrator = voiceId;
        else if (voiceId) next.speakers[speaker] = voiceId;
      });
      state.voiceAssignments = next;
      state.voiceId = next.narrator || state.voiceId || '';
      const narratorVoice = selectable.find(voice => String(voice.id || '') === state.voiceId);
      if (narratorVoice) state.voiceName = narratorVoice.name || state.voiceId;
      markMediaDirty('voice'); state.ttsAudio = null; state.videoClips = []; state.finalVideo = null;
      renderAll(); hideModal(modal); scheduleAutoSave('role_voice_assignments');
      toast(`已保存：旁白${next.narrator ? '已设置' : '未设置'}，${Object.keys(next.speakers).length} 个角色已绑定音色`, 'success');
    });
    showModal(modal);
  }

  window.NewStoryAdRoleVoiceUI = { open };
})();
