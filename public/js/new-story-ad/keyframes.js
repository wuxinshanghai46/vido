(() => {
  // Category-level translations only. They intentionally contain no fixed
  // industry, person, scene, product or model examples.
  const QA_REASON_TRANSLATIONS = [
    [/(?:camera|perspective|framing|composition|viewpoint|angle)/i, '机位、视角或构图与当前镜头约束不一致'],
    [/(?:material|texture|surface|finish|fabric)/i, '材质、纹理或表面质感与已锁定参考不一致'],
    [/(?:space|spatial|layout|geometry|anchor|zone|location)/i, '空间结构、区域关系或定位锚点与已锁定场景不一致'],
    [/(?:unsupported|unexpected|new element|not (?:present|specified|allowed)|forbidden|contradict)/i, '画面出现了当前合同未要求或明确禁止的新元素'],
    [/(?:person|human|identity|face|facial|body|wardrobe|clothing|character)/i, '人物身份、外貌、身形或服装与已锁定人物参考不一致'],
    [/(?:product|logo|packag|brand|shape|color|count)/i, '产品主体、标识、包装、形状、颜色或数量与已锁定参考不一致'],
    [/(?:interaction|eyeline|gaze|contact|hand|pose|action)/i, '人物动作、视线或与物体的交互关系不符合当前镜头要求'],
  ];

  function qaReasonToChinese(reason = '') {
    const raw = String(reason || '').trim();
    if (!raw || /[\u3400-\u9fff]/.test(raw)) return raw;
    const matched = QA_REASON_TRANSLATIONS.find(([pattern]) => pattern.test(raw));
    return matched
      ? matched[1]
      : '视觉审核发现画面与当前镜头合同不一致（原始详情已保留供技术人员排查）';
  }

  function frameUrl(frame = {}) {
    const raw = String(frame.image_url || frame.imageUrl || frame.url || '').trim();
    return raw;
  }

  function isQaInfrastructureError(value = '', code = '') {
    return /VISION_QA_UNAVAILABLE|VISION_CIRCUIT_OPEN|MODEL_ATTEMPTS_EXHAUSTED|TIMEOUT_OR_NETWORK/i.test(String(code || ''))
      || /视觉模型全部失败|视觉审核服务|timed?\s*out|timeout|ECONNRESET|socket hang up|(?:HTTP\s*)?5\d\d/i.test(String(value || ''));
  }

  function friendlyError(value = '', code = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (isQaInfrastructureError(raw, code)) return '本轮视觉审核服务暂时不可用；系统已只重试审核，没有因审核异常额外生成图片，当前继续保留上一版画面。';
    if (/STAGE_DEADLINE_EXCEEDED/i.test(String(code || '')) || /安全执行时限|后端总时限/i.test(raw)) return '本批次已达到安全执行时限，完成结果已保存；可以继续补齐未完成镜头。';
    if (/prompt:\s*size must be between|prompt.*(?:too long|length|limit)/i.test(raw)) return '本镜头生成约束过长，系统需要压缩提示词后重新生成。';
    if (/PROVIDER_BILLING/i.test(String(code || '')) || /insufficient quota|account balance not enough|insufficient balance|balance not enough|"code"\s*:\s*(1005|1102)/i.test(raw)) return '供应商返回当前模型计费通道不可用；可能是调用 Key、子账号、模型授权或通道额度不一致，不代表平台账户总余额为零。';
    if (/temporary|expired|asset.*not found|404/i.test(raw)) return '关键帧图片地址已失效，请重新生成本镜头。';
    const match = raw.match(/^(第\s*\d+\s*镜(?:(?:场景空间|视觉)一致性\s*)?QA\s*未通过)[：:]\s*(.*)$/i);
    if (match) {
      const translated = String(match[2] || '')
        .split(/\s*[;；]\s*/)
        .map(qaReasonToChinese)
        .filter(Boolean)
        .filter((reason, index, all) => all.indexOf(reason) === index);
      return `${match[1]}：${translated.join('；') || '画面与当前镜头合同不一致'}`;
    }
    return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
  }

  function regenerationStatusText(frame = {}) {
    return isQaInfrastructureError(frame.regeneration_error, frame.regeneration_error_code)
      ? '仍显示上一版 · 本轮视觉审核服务异常'
      : '仍显示上一版 · 新版本未通过 QA';
  }

  function thumbUrl(url = '', width = 520) {
    const raw = String(url || '').trim();
    if (!raw || /^blob:/i.test(raw) || /^data:/i.test(raw)) return raw;
    // Never mutate signed provider URLs: adding thumb/w invalidates signatures.
    if (/^https?:\/\//i.test(raw)) return raw;
    if (!/^\/api\/new-story-ad\/assets\//i.test(raw)) return raw;
    const join = raw.includes('?') ? '&' : '?';
    return `${raw}${join}thumb=${Math.max(160, Math.min(960, Number(width) || 520))}`;
  }

  function completedCount(keyframes = []) {
    return (Array.isArray(keyframes) ? keyframes : []).filter(frame => frame && frameUrl(frame)).length;
  }

  function status(keyframes = [], shots = []) {
    const total = Math.max(
      Array.isArray(shots) ? shots.length : 0,
      Array.isArray(keyframes) ? keyframes.length : 0,
    );
    const missingIndexes = Array.from({ length: total })
      .map((_, index) => index)
      .filter(index => !frameUrl((keyframes || [])[index] || {}));
    const failed = Array.from({ length: total })
      .filter((_, index) => (keyframes || [])[index]?.error && !frameUrl((keyframes || [])[index] || {}))
      .length;
    const retainedPrevious = Array.from({ length: total })
      .filter((_, index) => frameUrl((keyframes || [])[index] || {}) && !!(keyframes || [])[index]?.regeneration_error)
      .length;
    const freshPass = Array.from({ length: total })
      .filter((_, index) => {
        const frame = (keyframes || [])[index] || {};
        return frameUrl(frame) && !frame.regeneration_error
          && !['pending', 'generating', 'retrying_serial', 'outdated'].includes(String(frame.current_generation_status || ''))
          && frame.contract_outdated !== true
          && Number(frame.qa_policy_version || 0) >= 2 && frame.qa?.pass === true;
      }).length;
    const outdated = Array.from({ length: total })
      .filter((_, index) => {
        const frame = (keyframes || [])[index] || {};
        return frameUrl(frame) && !frame.regeneration_error && (
          Number(frame.qa_policy_version || 0) < 2
          || frame.contract_outdated === true
          || String(frame.current_generation_status || '') === 'outdated'
        );
      }).length;
    return {
      total,
      completed: Math.max(0, total - missingIndexes.length),
      fresh_pass: freshPass,
      outdated,
      retained_previous: retainedPrevious,
      latest_failed: retainedPrevious + failed,
      needs_regeneration: Array.from({ length: total }).filter((_, index) => {
        const frame = (keyframes || [])[index] || {};
        return !frameUrl(frame) || !!frame.regeneration_error || Number(frame.qa_policy_version || 0) < 2
          || frame.contract_outdated === true
          || ['pending', 'generating', 'retrying_serial', 'outdated'].includes(String(frame.current_generation_status || ''))
          || frame.qa?.pass !== true;
      }).length,
      missing: missingIndexes.length,
      failed,
      missing_indexes: missingIndexes,
    };
  }

  function frameTitle(shot = {}, index = 0) {
    return shot.title || `第 ${index + 1} 镜`;
  }

  function previewButtonHtml({ frame = {}, shot = {}, index = 0, previewUrl = '', imageUrl = '', escapeHtml } = {}) {
    const esc = typeof escapeHtml === 'function' ? escapeHtml : (x => String(x || ''));
    const title = frameTitle(shot, index);
    const displayError = friendlyError(frame.error || (frame.image_url && !previewUrl ? '关键帧图片地址已失效，请重新生成本镜头。' : ''), frame.error_code);
    const stateText = displayError ? displayError : '等待生成关键帧';
    const source = previewUrl ? thumbUrl(previewUrl, index < 2 ? 640 : 520) : '';
    const loading = index < 2 ? 'eager' : 'lazy';
    const priority = index < 2 ? ' fetchpriority="high"' : '';
    const qa = frame.qa || {};
    const qaOutdated = !!previewUrl && (Number(frame.qa_policy_version || 0) < 2 || frame.contract_outdated === true || String(frame.current_generation_status || '') === 'outdated');
    const qaText = frame.regeneration_error
      ? regenerationStatusText(frame)
      : qaOutdated
      ? (frame.contract_outdated ? '镜头信息已修改 · 需重新生成验证' : '旧版画面 · 需按新规则重新验证')
      : qa.status === 'not_applicable'
      ? '当前镜头无需视觉一致性检查'
      : (qa.pass === true
        ? `视觉 QA 已通过${qa.scene?.scene_consistency_score ? ` · 场景 ${Math.round(Number(qa.scene.scene_consistency_score) * 100)}%` : ''}`
        : (displayError ? `失败：${displayError}` : '等待视觉 QA'));
    return `<button type="button" class="dh-nsa-frame-preview ${previewUrl ? '' : 'pending'}" ${previewUrl ? `data-nsa-frame-preview="${index}" data-nsa-frame-full="${esc(imageUrl || previewUrl)}" title="点击查看第 ${index + 1} 镜大图"` : 'disabled'}>
      ${source ? `<img src="${esc(source)}" alt="${esc(title)}" loading="${loading}" decoding="async"${priority} onerror="const p=this.closest('.dh-nsa-frame-preview');this.hidden=true;p?.classList.add('image-error');const s=p?.querySelector('small');if(s)s.textContent='图片地址已失效，请重新生成本镜'">` : `<span>${String(index + 1).padStart(2, '0')}</span>`}
      <b>${String(index + 1).padStart(2, '0')} · ${esc(title)}</b>
      <small>${previewUrl ? qaText : stateText}</small>
    </button>`;
  }

  window.NewStoryAdKeyframes = {
    frameUrl,
    thumbUrl,
    completedCount,
    status,
    frameTitle,
    qaReasonToChinese,
    isQaInfrastructureError,
    regenerationStatusText,
    friendlyError,
    previewButtonHtml,
  };
})();
