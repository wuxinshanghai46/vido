(() => {
  function html(progress = {}, { escapeHtml = value => String(value || ''), formatElapsedText = value => `${Math.round(value / 1000)}秒` } = {}) {
    if (!progress?.active) return '';
    const elapsed = Math.max(0, Date.now() - (Number(progress.startedAt || 0) || Date.now()));
    return `<div class="dh-lux-person-progress is-indeterminate" role="status" aria-live="polite">
      <div class="dh-lux-person-progress-head"><b>${escapeHtml(progress.label || 'AI 正在整理文本')}</b><span class="dh-lux-person-progress-stat"><em>已耗时 ${escapeHtml(formatElapsedText(elapsed))}</em></span></div>
      <div class="dh-lux-person-progress-track" aria-hidden="true"><i style="width:28%"></i></div>
      <small>${escapeHtml(progress.message || '模型正在返回结构化内容，请稍候；这一步不会提交图片生成。')}</small>
    </div>`;
  }

  function start(state = {}, key = '', progress = {}, render = () => {}) {
    state[key] = { active: true, startedAt: Date.now(), ...progress };
    render();
    const timer = setInterval(render, 1000);
    return () => {
      clearInterval(timer);
      state[key] = null;
      render();
    };
  }

  function personRunningHtml(state = {}, helpers = {}) {
    if (!state.personAssistProgress?.active) return '';
    return `<div class="dh-luxgen-character-sheet"><div class="dh-luxgen-person-thumb">AI</div><b>正在补齐人物档案</b><small>只整理人物文本，不会提交图片模型；完成后会直接写入下方每个人物自己的字段。</small>${html(state.personAssistProgress, helpers)}</div>`;
  }

  function emptyPersonHtml(state = {}, escapeHtml = value => String(value || '')) {
    const profiles = Array.isArray(state.castProfiles) ? state.castProfiles : [];
    const profile = profiles[0] || null;
    if (!profile) return '<span class="dh-luxgen-person-badge">未选择</span><div class="dh-luxgen-person-copy"><b>尚未建立人物档案</b><small>可以先用 AI 补齐人物文字设定；真人演员请选择演员库或上传真人参考。</small></div>';
    const detail = [profile.roleName, profile.appearanceText, profiles.length > 1 ? `共 ${profiles.length} 个人物，完整内容见下方各自档案` : '补齐内容已写入下方本人物字段；尚未生成人物图片资产'].filter(Boolean).join(' · ');
    return `<span class="dh-luxgen-person-badge">档案已补齐</span><div class="dh-luxgen-person-copy"><b>${escapeHtml(profile.displayName || profile.name || profile.roleName || '人物档案')}</b><small>${escapeHtml(detail)}</small></div>`;
  }

  window.NewStoryAdAssistProgress = { html, start, personRunningHtml, emptyPersonHtml };
})();
