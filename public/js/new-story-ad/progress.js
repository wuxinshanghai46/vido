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

    if (progress.submissionPending === true) {
      const pendingLabels = {
        scene: '正在提交场景配置生成',
        blueprint: '正在提交剧本生成',
        storyboard: '正在提交分镜表生成',
        keyframes: '正在提交真实画面生成',
        video: '正在提交视频生成',
        media: '正在提交视频生成',
        compose: '正在提交最终合成',
      };
      return {
        title: pendingLabels[stage] || label || '正在提交生成任务',
        stat: stage === 'keyframes' || stage === 'storyboard'
          ? `已处理 0/${count} · 0%`
          : '准备中 · 0%',
        percent: 0,
        stat: stage === 'keyframes' || stage === 'storyboard'
          ? `已耗时 ${formatElapsedText(elapsed)} · 已处理 0/${count} · 0%`
          : `已耗时 ${formatElapsedText(elapsed)} · 等待服务器确认 · 0%`,
        indeterminate: false,
        message: '正在创建本次生成任务；服务器确认新的生成编号后才会显示真实进度。',
      };
    }

    if (stage === 'keyframes') {
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
          ? `并行生成真实画面：第 ${currentLabel} 镜（共 ${targetTotal} 镜）`
          : `生成真实画面中：第 ${current}/${targetTotal} 张`,
        stat: `已耗时 ${formatElapsedText(elapsed)} · 已处理 ${done}/${targetTotal} · ${pct}%`,
        percent: pct,
        indeterminate: done === 0,
        message: `已处理 ${done}/${targetTotal} 张，成功 ${succeeded} 张${failed ? `，失败 ${failed} 张` : ''}；${activeIndexes.length > 1 ? `正在并行生成第 ${currentLabel} 镜（并发 ${effectiveConcurrency}）` : `正在生成第 ${current} 镜`}。`,
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
        const trackedCompose = serverProgress?.stage === 'compose' ? serverProgress : null;
        const totalMilestones = Math.max(1, Number(trackedCompose?.total) || 3);
        const completedMilestones = Math.max(0, Math.min(totalMilestones, Number(trackedCompose?.completed) || 0));
        const pct = Math.max(0, Math.min(100, Number(trackedCompose?.percent) || Math.round((completedMilestones / totalMilestones) * 100)));
        const phaseLabels = {
          audio_preparing: '正在检查配音、音乐和字幕',
          audio_ready: '音频配置已就绪，正在准备成片时间线',
          timeline_ready: '成片时间线已确认，正在封装最终视频',
          persisted: '最终成片已完成',
        };
        return {
          title: phaseLabels[trackedCompose?.phase] || '连续场景视频已完成，正在合成最终成片',
          stat: `已耗时 ${formatElapsedText(elapsed)} · ${pct}%`,
          percent: pct,
          indeterminate: false,
          message: trackedCompose?.message || '合成百分比按音频、时间线和最终封装三个真实完成里程碑计算。',
        };
      }
      if (/^tts(?:_|$)/.test(currentTaskStage)) {
        return {
          title: '正在准备可选音频', stat: `已耗时 ${formatElapsedText(elapsed)} · 音频处理中`,
          percent: 0, indeterminate: false, message: '音频完成后将进入整条广告的连续场景视频生成。',
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
      const totalUnits = Math.max(0, Number(tracked.units_total || tracked.scene_block_count) || 0);
      const generatedUnits = Math.max(0, Number(tracked.units_generated) || 0);
      const repairing = Number(tracked.repair_attempt || 0) > 0;
      return {
        title: activeLabel
          ? `${repairing ? '处理修复方案' : '正在生成连续场景组'}（覆盖镜头 ${activeLabel}）`
          : (generated > processed ? '正在逐镜质检已生成场景组' : (label || '生成整条广告视频中...')),
        stat: `已耗时 ${formatElapsedText(elapsed)} · 逐镜质检 ${processed}/${totalShots} · ${pct}%`,
        percent: pct,
        indeterminate: processed === 0,
        message: `真实进度：${totalUnits ? `共 ${totalUnits} 个生成单元${generatedUnits ? `，已生成 ${generatedUnits} 个` : ''}；` : ''}已切分 ${generated}/${totalShots} 个镜头片段，质检通过 ${passed} 个${failed ? `，质检未通过 ${failed} 个` : ''}${activeLabel ? `；当前生成单元覆盖镜头 ${activeLabel}` : ''}。`,
      };
    }

    if (stage === 'blueprint') {
      const progressGenerationId = String(progress.generationId || '');
      const serverGenerationId = String(serverProgress?.generation_id || '');
      const generationMatches = !progressGenerationId || !serverGenerationId || progressGenerationId === serverGenerationId;
      const serverStage = String(serverProgress?.stage || '');
      const tracked = ['blueprint', 'script_package', 'storyboard'].includes(serverStage) && generationMatches
        ? serverProgress
        : null;
      if (!tracked) {
        return {
          title: label || '正在启动剧本生成',
          stat: `已耗时 ${formatElapsedText(elapsed)} · 准备中`,
          percent: 0,
          indeterminate: true,
          message: '等待服务器返回本次剧本的真实里程碑。',
        };
      }
      const storyboardPhase = serverStage === 'storyboard';
      const totalMilestones = Math.max(1, Number(storyboardPhase ? tracked.target_total : tracked.total) || 6);
      const completedMilestones = Math.max(0, Math.min(totalMilestones, Number(storyboardPhase ? tracked.processed : tracked.completed) || 0));
      const pct = storyboardPhase
        ? Math.max(60, Math.min(100, 60 + Math.round((completedMilestones / totalMilestones) * 40)))
        : Math.max(0, Math.min(60, Math.round((completedMilestones / totalMilestones) * 60)));
      const phaseLabels = {
        context_ready: '准备剧本上下文与原创过审规则',
        draft_generation: '生成剧本初稿',
        draft_ready: '校验剧本初稿结构',
        structure_validated: '检查中文表达与可拍性',
        language_checked: '执行质量与版权/IP 风险审核',
        quality_review: '执行质量与版权/IP 风险审核',
        quality_polish: '修正质量与版权/IP 风险问题',
        quality_approved: '保存审核通过的最终剧本',
        persisted: '剧本生成完成',
      };
      return {
        title: storyboardPhase
          ? `剧本已完成，正在生成配套分镜：${completedMilestones}/${totalMilestones}`
          : (phaseLabels[tracked.phase] || label || '生成剧本中...'),
        stat: `已耗时 ${formatElapsedText(elapsed)} · ${completedMilestones}/${totalMilestones} · ${pct}%`,
        percent: pct,
        indeterminate: false,
        message: tracked.message || '正在按真实完成的剧本里程碑更新进度。',
      };
    }

    if (stage === 'scene') {
      const progressGenerationId = String(progress.generationId || '');
      const serverGenerationId = String(serverProgress?.generation_id || '');
      const generationMatches = !progressGenerationId || !serverGenerationId || progressGenerationId === serverGenerationId;
      const tracked = serverProgress?.stage === 'scene_config' && generationMatches ? serverProgress : null;
      const totalMilestones = Math.max(1, Number(tracked?.total) || 3);
      const completedMilestones = Math.max(0, Math.min(totalMilestones, Number(tracked?.completed) || 0));
      const pct = Math.max(0, Math.min(100, Number(tracked?.percent) || Math.round((completedMilestones / totalMilestones) * 100)));
      const phaseLabels = {
        context_ready: '准备当前项目输入与业务边界',
        draft_ready: '场景配置初稿已返回，正在校验',
        structure_validated: '配置结构已通过，正在保存',
        persisted: '场景配置生成完成',
      };
      return {
        title: phaseLabels[tracked?.phase] || label || '正在启动场景配置生成',
        stat: `已耗时 ${formatElapsedText(elapsed)} · ${completedMilestones}/${totalMilestones} · ${pct}%`,
        percent: pct,
        indeterminate: false,
        message: tracked?.message || '正在等待服务器返回本次场景配置的真实里程碑。',
      };
    }

    if (stage === 'storyboard') {
      const progressGenerationId = String(progress.generationId || '');
      const serverGenerationId = String(serverProgress?.generation_id || '');
      const generationMatches = !progressGenerationId || !serverGenerationId || progressGenerationId === serverGenerationId;
      const tracked = serverProgress?.stage === 'storyboard' && generationMatches ? serverProgress : null;
      const targetTotal = Math.max(1, Number(tracked?.target_total) || count);
      const processed = Math.max(0, Math.min(targetTotal, Number(tracked?.processed) || 0));
      const current = Math.max(1, Math.min(targetTotal, Number(tracked?.current_index) || processed + 1));
      const pct = Math.max(0, Math.min(100, Number(tracked?.percent) || Math.round((processed / targetTotal) * 80)));
      const phase = String(tracked?.phase || 'preparing');
      const reviewing = phase === 'reviewing' || phase.startsWith('rewrite_');
      return {
        title: reviewing ? '分镜初稿已生成，正在执行整体质量审核' : `生成分镜表中：第 ${current}/${targetTotal} 镜`,
        stat: `已耗时 ${formatElapsedText(elapsed)} · 已生成 ${processed}/${targetTotal} 镜 · ${pct}%`,
        percent: pct,
        indeterminate: false,
        message: tracked?.message || '正在按已确认剧本生成分镜表，并检查镜头、动作、台词、场景绑定和商业一致性。',
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
