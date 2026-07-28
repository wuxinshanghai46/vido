(() => {
  const clean = (value = '', max = 800) => String(value || '').trim().slice(0, max);
  const STAGES = {
    assist: 'AI 辅写',
    person: '人物 / 宠物设定与资产',
    subject: '人物 / 宠物资产',
    scene_config: '场景配置',
    scene_asset: '场景参考图',
    blueprint: '剧本',
    script_package: '剧本与配套分镜',
    storyboard: '分镜表',
    keyframes: '真实分镜画面',
    tts: '配音',
    video: '镜头视频',
    media: '整条广告视频',
    compose: '最终成片',
  };

  function stageKey(value = '') {
    const raw = clean(value, 160).toLowerCase().replace(/-/g, '_');
    return Object.keys(STAGES).find(key => raw.includes(key)) || '';
  }

  function stageFromPath(path = '', data = {}) {
    const taskStage = data?.task?.active_stage || data?.task?.stage || data?.stage || '';
    return stageKey(taskStage) || stageKey(path) || 'assist';
  }

  function detailList(data = {}) {
    const source = data.details || data.failure_details
      || data.task?.generation_progress?.failure_details
      || data.task?.failure_details
      || [];
    return Array.isArray(source) ? source : [];
  }

  function location(data = {}, stage = '') {
    const details = detailList(data);
    const shots = [...new Set(details.map(item => Number(item?.shot_number || 0)).filter(Boolean))];
    const fields = [...new Set(details
      .filter(item => !Number(item?.shot_number || 0))
      .map(item => clean(item?.title || item?.field || item?.code, 100))
      .filter(Boolean))];
    const progress = data.task?.generation_progress || data.progress || {};
    const scene = clean(progress.scene_name || data.scene_name, 120);
    if (shots.length) return `${STAGES[stage] || '当前阶段'}：第 ${shots.join('、')} 镜`;
    if (scene && fields.length) return `${STAGES[stage] || '当前阶段'}「${scene}」：${fields.join('、')}`;
    if (scene) return `${STAGES[stage] || '当前阶段'}「${scene}」`;
    if (fields.length) return `${STAGES[stage] || '当前阶段'}：${fields.join('、')}`;
    return STAGES[stage] || '当前操作';
  }

  function actionFor(code = '', stage = '', data = {}) {
    const normalized = clean(code, 120).toUpperCase();
    if (normalized === 'USER_CANCELLED') return '无需修改；需要继续时，从当前步骤重新点击生成。';
    if (/STALE|SNAPSHOT|REVISION|TASK_SESSION_REPLACED/.test(normalized)) {
      return '先确认页面上的最新修改已自动保存，再按当前内容重新点击本步骤；旧版本结果不会被采用。';
    }
    if (/FIELD_MISSING|INVALID_ARGUMENT|INPUT_|SPEC_|CONFLICT/.test(normalized)) {
      return `按上方指出的字段补齐或消除冲突，保存后重新执行${STAGES[stage] || '当前步骤'}。`;
    }
    if (/PERSON|SUBJECT|CAST|PET/.test(normalized) && /QA|VERIFY|CONSISTENCY|IDENTITY|ASSET/.test(normalized)) {
      return '打开对应人物 / 宠物卡片，按卡内列出的年龄、外貌、服装、发型或四视图问题修改，只重新生成未通过的主体。';
    }
    if (/SCENE/.test(normalized) && /QA|VERIFY|CONSISTENCY|RIGHTS|SPACE|ASSET|COVERAGE/.test(normalized)) {
      return '打开对应场景卡片，按失败字段修改空间布局、材质 / 色彩 / 光线、互动机位或禁止项，再只重建当前场景。';
    }
    if (/KEYFRAME|IMAGE|VISION/.test(normalized)) {
      return '先处理错误详情中列出的直接失败镜头；已成功镜头会保留，随后点击“补齐未生成镜头”。';
    }
    if (/VIDEO|BOUNDARY|CONTINUITY/.test(normalized)) {
      return '检查错误详情中的镜头编号、人物 / 场景连续性和动作边界，只重新生成未通过的生成单元。';
    }
    if (/COMPOSE|FFMPEG|AUDIO|TTS|SUBTITLE/.test(normalized)) {
      return '检查配音、音乐、字幕和已通过视频是否齐全，再从“广告生成与合成”步骤重新封装成片。';
    }
    if (/AUTH|MODEL_CONFIG|MODEL_NOT|NO_MODEL|DISABLED/.test(normalized)) {
      return '请管理员在“模型调用管理”中检查本阶段模型是否启用、凭证是否有效，并完成连通性测试后重试。';
    }
    if (/BILLING|BALANCE|QUOTA|RATE_LIMIT|429/.test(normalized)) {
      return '请管理员检查供应商余额、额度或限流状态；确认恢复前不要重复提交付费生成。';
    }
    if (/PROVIDER|TIMEOUT|NETWORK|5XX|CIRCUIT/.test(normalized)) {
      return '这是模型 / 供应商链路异常，不需要修改创作内容；请稍后从当前步骤重试，计费状态未知时先等待原结果。';
    }
    const details = detailList(data);
    if (details.length) return `按错误详情逐项修改后，只重新执行${STAGES[stage] || '当前步骤'}。`;
    return `保留支持编号并从${STAGES[stage] || '当前步骤'}重试；若再次出现，请把支持编号交给管理员定位。`;
  }

  function format({ data = {}, message = '', path = '', stage = '' } = {}) {
    const resolvedStage = stageKey(stage) || stageFromPath(path, data);
    const code = clean(data.code || data.error_code || data.task?.error_code || '', 120);
    const reason = clean(message || data.error || data.message || data.task?.error || '操作失败', 1000);
    const where = location(data, resolvedStage);
    const action = actionFor(code, resolvedStage, data);
    const supportId = clean(data.request_id || data.support_id || data.task?.support_id || '', 120);
    if (code === 'USER_CANCELLED') {
      return { code, stage: resolvedStage, where, reason, action, supportId, message: '当前生成已停止，迟到结果不会覆盖任务内容。' };
    }
    return {
      code,
      stage: resolvedStage,
      where,
      reason,
      action,
      supportId,
      message: `问题位置：${where}。原因：${reason}。处理方法：${action}${supportId ? ` 支持编号：${supportId}。` : ''}`,
    };
  }

  window.NewStoryAdErrorGuidance = { STAGES, stageKey, stageFromPath, detailList, location, actionFor, format };
})();
