(() => {
  function formatElapsedText(ms = 0) {
    const sec = Math.max(0, Math.round(Number(ms) / 1000) || 0);
    if (sec >= 60) return `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, '0')}秒`;
    return `${sec}秒`;
  }

  function snapshot({ progress = {}, label = '', total = 1, completed = 0, serverProgress = null, taskStage = '', taskStatus = '', finalVideoReady = false } = {}) {
    const stage = progress.stage || '';
    const count = Math.max(1, Number(progress.total || total) || 1);
    const elapsed = Math.max(0, Date.now() - (Number(progress.startedAt || 0) || Date.now()));

    if (stage === 'single_keyframe') {
      const shotNo = Math.max(1, Number(progress.shotNo || progress.targetIndex + 1 || 1) || 1);
      return {
        title: `正在重新生成第 ${shotNo} 镜真实关键帧`,
        stat: `已耗时 ${formatElapsedText(elapsed)}`,
        percent: 0,
        indeterminate: true,
        message: `当前正在重新生成第 ${shotNo} 镜，完成后会自动替换本镜图片。`,
      };
    }

    if (stage === 'keyframes') {
      if (progress.submissionPending === true) {
        return {
          title: '正在启动画面生成',
          stat: '准备中',
          percent: 0,
          indeterminate: true,
          message: '正在创建本次生成任务，请稍候。',
        };
      }
      const progressGenerationId = String(progress.generationId || '');
      const serverGenerationId = String(serverProgress?.generation_id || '');
      const tracked = serverProgress?.stage === 'keyframes'
        && progressGenerationId
        && serverGenerationId
        && progressGenerationId === serverGenerationId
        ? serverProgress
        : null;
      const targetTotal = Math.max(1, Number(tracked?.target_total || count) || count);
      // A new batch always starts at 0. Historical keyframes are retained for
      // display, but must not be counted as work completed by this batch.
      const done = Math.max(0, Math.min(targetTotal, Number(tracked?.processed ?? 0) || 0));
      const succeeded = Math.max(0, Number(tracked?.succeeded ?? 0) || 0);
      const failed = Math.max(0, Number(tracked?.failed) || 0);
      const activeIndexes = [...new Set((Array.isArray(tracked?.active_indexes) ? tracked.active_indexes : [])
        .map(value => Math.round(Number(value) || 0))
        .filter(value => value >= 1 && value <= targetTotal))].sort((a, b) => a - b);
      const current = Math.max(1, Math.min(targetTotal, Number(tracked?.current_index) || done + 1));
      const currentLabel = activeIndexes.length ? activeIndexes.join('、') : String(current);
      const effectiveConcurrency = Math.max(1, Number(tracked?.effective_concurrency) || 1);
      const pct = Math.round((done / targetTotal) * 100);
      return {
        title: activeIndexes.length > 1
          ? `并行生成真实画面：第 ${currentLabel} 张（共 ${targetTotal} 张）`
          : `生成真实画面中：第 ${current}/${targetTotal} 张`,
        stat: `已耗时 ${formatElapsedText(elapsed)} · 已处理 ${done}/${targetTotal} · ${pct}%`,
        percent: pct,
        indeterminate: done === 0,
        message: `已处理 ${done}/${targetTotal} 张，成功 ${succeeded} 张${failed ? `，失败 ${failed} 张` : ''}；${activeIndexes.length > 1 ? `正在并行生成第 ${currentLabel} 张（并发 ${effectiveConcurrency}）` : `正在生成第 ${current} 张`}。`,
      };
    }

    if (stage === 'video' || stage === 'media' || stage === 'compose') {
      const currentTaskStage = String(taskStage || '').toLowerCase();
      const currentTaskStatus = String(taskStatus || '').toLowerCase();
      const finished = finalVideoReady || ['completed', 'compose_done', 'final_video_ready'].includes(currentTaskStage)
        || ['done', 'completed', 'succeeded'].includes(currentTaskStatus) && currentTaskStage === 'video_ready';
      if (finished) {
        return { title: '视频合成已完成', stat: '100%', percent: 100, message: '全部镜头和最终成片均已生成完成。' };
      }
      if (currentTaskStage === 'compose' || currentTaskStage === 'video_ready' || stage === 'compose') {
        const totalShots = Math.max(0, Number(serverProgress?.total) || 0);
        return {
          title: '逐镜视频已完成，正在合成最终成片',
          stat: `已耗时 ${formatElapsedText(elapsed)}${totalShots ? ` · 逐镜视频 ${totalShots}/${totalShots}` : ''} · 合成中`,
          percent: 0,
          indeterminate: true,
          message: '当前处于最终封装阶段，不使用虚假的时间推算百分比。',
        };
      }
      if (/^tts(?:_|$)/.test(currentTaskStage)) {
        return {
          title: '正在准备可选音频', stat: `已耗时 ${formatElapsedText(elapsed)} · 音频处理中`,
          percent: 0, indeterminate: true, message: '音频完成后将进入逐镜视频生成。',
        };
      }
      const progressGenerationId = String(progress.generationId || '');
      const serverGenerationId = String(serverProgress?.generation_id || '');
      const generationMatches = !progressGenerationId || !serverGenerationId || progressGenerationId === serverGenerationId;
      const tracked = serverProgress?.stage === 'video' && generationMatches ? serverProgress : null;
      if (!tracked) {
        return {
          title: label || '正在启动视频生成', stat: `已耗时 ${formatElapsedText(elapsed)} · 准备中`,
          percent: 0, indeterminate: true, message: '等待服务器返回本次任务的真实镜头状态。',
        };
      }
      const totalShots = Math.max(1, Number(tracked.total) || count);
      const passed = Math.max(0, Number(tracked.qa_passed) || 0);
      const failed = Math.max(0, Number(tracked.failed) || 0);
      const processed = Math.max(0, Math.min(totalShots, Number(tracked.completed) || passed + failed));
      const generated = Math.max(processed, Math.min(totalShots, Number(tracked.generated) || 0));
      const activeIndexes = [...new Set((Array.isArray(tracked.active_indexes) ? tracked.active_indexes : [])
        .map(value => Math.round(Number(value) || 0)).filter(value => value >= 1 && value <= totalShots))].sort((a, b) => a - b);
      const pct = Math.round((processed / totalShots) * 100);
      const activeLabel = activeIndexes.length ? activeIndexes.join('、') : '';
      const repairing = Number(tracked.repair_attempt || 0) > 0;
      return {
        title: activeLabel
          ? `${repairing ? '自动修复' : '生成连续场景视频'}：第 ${activeLabel} 镜（共 ${totalShots} 镜）`
          : (generated > processed ? '正在审核已生成镜头' : (label || '生成逐镜视频中...')),
        stat: `已耗时 ${formatElapsedText(elapsed)} · 已完成 ${processed}/${totalShots} 镜 · ${pct}%`,
        percent: pct,
        indeterminate: processed === 0,
        message: `真实进度：已生成 ${generated}/${totalShots} 镜，审片通过 ${passed} 镜${failed ? `，失败 ${failed} 镜` : ''}${activeLabel ? `；当前处理第 ${activeLabel} 镜` : ''}。`,
      };
    }

    if (stage === 'storyboard') {
      return {
        title: `生成分镜表中：共 ${count} 镜`,
        stat: `已耗时 ${formatElapsedText(elapsed)}`,
        percent: 0,
        indeterminate: true,
        message: '正在按已确认剧本生成分镜表，并检查镜头、动作、台词、场景绑定和商业一致性。',
      };
    }

    return {
      title: label || progress.label || '处理中...',
      stat: `已耗时 ${formatElapsedText(elapsed)}`,
      percent: 0,
      indeterminate: true,
      message: progress.message || '正在执行当前阶段，请稍候。',
    };
  }

  window.NewStoryAdProgress = {
    formatElapsedText,
    snapshot,
  };
})();
