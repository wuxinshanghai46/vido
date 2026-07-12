(() => {
  function formatElapsedText(ms = 0) {
    const sec = Math.max(0, Math.round(Number(ms) / 1000) || 0);
    if (sec >= 60) return `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, '0')}秒`;
    return `${sec}秒`;
  }

  function snapshot({ progress = {}, label = '', total = 1, completed = 0, serverProgress = null } = {}) {
    const stage = progress.stage || '';
    const count = Math.max(1, Number(progress.total || total) || 1);
    const elapsed = Math.max(0, Date.now() - (Number(progress.startedAt || 0) || Date.now()));

    if (stage === 'single_keyframe') {
      const shotNo = Math.max(1, Number(progress.shotNo || progress.targetIndex + 1 || 1) || 1);
      const pct = Math.max(8, Math.min(88, Math.round(8 + Math.min(80, elapsed / 1200))));
      return {
        title: `正在重新生成第 ${shotNo} 镜真实关键帧`,
        stat: `已耗时 ${formatElapsedText(elapsed)} · ${pct}%`,
        percent: pct,
        message: `当前正在重新生成第 ${shotNo} 镜，完成后会自动替换本镜图片。`,
      };
    }

    if (stage === 'keyframes') {
      const tracked = serverProgress?.stage === 'keyframes' ? serverProgress : null;
      const targetTotal = Math.max(1, Number(tracked?.target_total || count) || count);
      const done = Math.max(0, Math.min(targetTotal, Number(tracked?.processed ?? completed) || 0));
      const succeeded = Math.max(0, Number(tracked?.succeeded ?? done) || 0);
      const failed = Math.max(0, Number(tracked?.failed) || 0);
      const current = Math.max(1, Math.min(targetTotal, Number(tracked?.current_index) || done + 1));
      const pct = done >= targetTotal ? 96 : Math.max(8, Math.min(92, Math.round(8 + (done / targetTotal) * 78 + Math.min(10, elapsed / 9000))));
      return {
        title: `生成真实画面中：第 ${current}/${targetTotal} 张`,
        stat: `已耗时 ${formatElapsedText(elapsed)} · ${pct}%`,
        percent: pct,
        message: `已处理 ${done}/${targetTotal} 张，成功 ${succeeded} 张${failed ? `，失败 ${failed} 张` : ''}；正在生成第 ${current} 张。`,
      };
    }

    if (stage === 'storyboard') {
      const pct = Math.max(12, Math.min(88, Math.round(18 + elapsed / 900)));
      return {
        title: `生成分镜表中：共 ${count} 镜`,
        stat: `已耗时 ${formatElapsedText(elapsed)} · ${pct}%`,
        percent: pct,
        message: '正在按已确认剧本生成分镜表，并检查镜头、动作、台词、场景绑定和商业一致性。',
      };
    }

    const pct = Math.max(12, Math.min(86, Math.round(18 + elapsed / 1000)));
    return {
      title: label || progress.label || '处理中...',
      stat: `已耗时 ${formatElapsedText(elapsed)} · ${pct}%`,
      percent: pct,
      message: progress.message || '正在执行当前阶段，请稍候。',
    };
  }

  window.NewStoryAdProgress = {
    formatElapsedText,
    snapshot,
  };
})();
