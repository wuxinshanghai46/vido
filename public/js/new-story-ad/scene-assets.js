(() => {
  const VIEW_LABELS = {
    master: '主视角',
    reverse: '反向/侧向',
    interaction: '互动位',
    detail: '材质细节',
    layout: '俯视布局',
  };
  const SCENE_GENERATION_CONTRACT_VERSION = 7;

  const clean = (value = '', max = 1000) => String(value || '').trim().slice(0, max);
  const root = () => document.getElementById('dhNewStoryAdLegacyMount') || document;

  function sceneRepairFailureMessage(error = '') {
    const text = clean(error, 1200);
    if (!text) return '';
    if (/AuditSubmitIllegal|submit.*illegal|size must be between 0 and 2500/i.test(text)) {
      return '图像供应商未接受本轮生成请求，因此没有创建新版本，旧图已安全保留。请再次执行自动修复。';
    }
    return `本轮自动修复未创建新版本：${clean(text, 220)}`;
  }

  function sceneOperationFailure(state = {}, plannedSpaces = []) {
    const persisted = state.generationProgress?.stage === 'scene_asset'
      && state.generationProgress?.status === 'failed'
      ? state.generationProgress
      : null;
    const local = state.sceneOperationFailure && typeof state.sceneOperationFailure === 'object'
      ? state.sceneOperationFailure
      : null;
    const taskFailed = state.taskStatus === 'failed' && /scene_asset/i.test(String(state.taskStage || ''));
    const source = persisted || local || (taskFailed ? {} : null);
    if (!source) return null;
    const sceneId = clean(source.scene_id || source.sceneId || '', 120);
    const sceneIndex = sceneId
      ? plannedSpaces.findIndex(space => clean(space.id || space.space_id || space.scene_id, 120) === sceneId)
      : -1;
    const sceneName = clean(
      (sceneIndex >= 0 ? plannedSpaces[sceneIndex]?.name : '')
      || source.scene_name
      || source.sceneName
      || (sceneIndex >= 0 ? `场景 ${sceneIndex + 1}` : '当前场景'),
      120,
    );
    const viewStates = Array.isArray(source.view_states) ? source.view_states : [];
    const failedViews = viewStates
      .filter(view => view?.status === 'failed')
      .map(view => clean(view.label || VIEW_LABELS[view.key] || view.key, 80))
      .filter(Boolean);
    const missingFields = (Array.isArray(source.failure_details) ? source.failure_details : [])
      .filter(item => item?.status === 'missing' || /FIELD_MISSING/.test(String(item?.code || '')))
      .map(item => clean(item.title || item.message || '', 180))
      .filter(Boolean);
    return {
      sceneId,
      sceneName,
      message: clean(source.message || source.error || state.taskError || '场景图片生成未完成', 600),
      errorCode: clean(source.error_code || source.errorCode || state.taskErrorCode || '', 120),
      supportId: clean(source.support_id || source.supportId || '', 120),
      failedViews: [...new Set(failedViews)],
      missingFields: [...new Set(missingFields)],
    };
  }

  function sceneProgressHtml(progress = {}, plannedSpaces = [], options = {}) {
    if (!progress?.active) return '';
    const view = sceneProgressView(progress);
    const sceneId = clean(progress.scene_id || progress.sceneId, 120);
    const target = plannedSpaces.find(space => clean(space.id || space.space_id || space.scene_id, 120) === sceneId);
    const title = target?.name ? `${target.name} · ${view.title}` : view.title;
    return `<div class="dh-nsa-scene-operation is-running">
      <div class="dh-lux-person-progress">
        <div class="dh-lux-person-progress-head">
          <b>${escapeHtml(title)}</b>
          <div class="dh-nsa-progress-actions">
            <span class="dh-lux-person-progress-stat"><em>耗时 ${escapeHtml(view.elapsedText)}</em><i>${view.pct}%</i></span>
            ${options.canCancel === false ? '' : `<button type="button" class="dh-nsa-cancel-generation" data-nsa-cancel-generation ${options.cancelRequested ? 'disabled' : ''}>${options.cancelRequested ? '正在停止...' : '停止生成'}</button>`}
          </div>
        </div>
        <div class="dh-lux-person-progress-track" aria-hidden="true"><i style="width:${view.pct}%"></i></div>
        <small>${escapeHtml(view.message)}</small>
      </div>
    </div>`;
  }

  function sceneFailureHtml(failure = null) {
    if (!failure) return '';
    const details = [
      failure.failedViews.length ? `失败视图：${failure.failedViews.join('、')}` : '',
      failure.missingFields?.length ? `缺失字段：${failure.missingFields.join('、')}` : '',
      failure.errorCode ? `错误代码：${failure.errorCode}` : '',
      failure.supportId ? `支持编号：${failure.supportId}` : '',
    ].filter(Boolean);
    return `<div class="dh-nsa-scene-operation is-failed" role="alert">
      <b>${escapeHtml(failure.sceneName)}生成失败</b>
      <span>${escapeHtml(failure.message)}</span>
      ${details.length ? `<em>${escapeHtml(details.join(' · '))}</em>` : ''}
      <small>已成功的视图和其他场景均已保留；系统不会自动重复提交失败视图。</small>
    </div>`;
  }

  function scorePercent(qa = {}, keys = []) {
    for (const key of keys) {
      const raw = qa?.[key];
      if (raw === undefined || raw === null || raw === '') continue;
      const value = Number(raw);
      if (Number.isFinite(value)) return Math.round(Math.max(0, Math.min(1, value)) * 100);
    }
    return null;
  }

  function completeSceneViewEvidence(asset = {}) {
    const requiredKeys = ['master', 'reverse', 'interaction', 'detail', 'layout'];
    const views = Array.isArray(asset.view_images) ? asset.view_images : [];
    const identities = requiredKeys.map(key => {
      const view = views.find(item => clean(item?.key || item?.view, 40) === key);
      const url = clean(view?.url || view?.image_url || '', 1000);
      return url ? url.split(/[?#]/, 1)[0] : '';
    });
    return identities.every(Boolean) && new Set(identities).size === requiredKeys.length;
  }

  function sceneLockAssessment(asset = {}) {
    const partialCheckpoint = asset.partial_checkpoint === true;
    const contract = asset.scene_contract && typeof asset.scene_contract === 'object' ? asset.scene_contract : {};
    const requirementQa = contract.requirement_qa || asset.requirement_qa || {};
    const photographicRealismQa = contract.photographic_realism_qa || asset.photographic_realism_qa || {};
    const cameraDesignQa = contract.camera_design_qa || asset.camera_design_qa || {};
    const crossViewQa = contract.cross_view_qa || asset.cross_view_qa || {};
    const spatialQa = contract.spatial_coverage_qa || asset.spatial_coverage_qa || {};
    const layoutContract = contract.layout_contract || asset.layout_contract || {};
    const views = Array.isArray(asset.view_images) ? asset.view_images : [];
    const hasLayoutView = views.some(view => clean(view?.key || view?.view, 40) === 'layout');
    const schemaVersion = Number(contract.schema_version || asset.schema_version || 0) || 0;
    const generationContractVersion = Number(
      asset.generation_contract_version
      || asset.view_acquisition?.generation_contract_version
      || 0,
    ) || 0;
    const hasSpatialQa = !!(asset.spatial_coverage_qa || contract.spatial_coverage_qa);
    const layoutAvailable = layoutContract.status === 'available' && hasLayoutView;
    const requirementPass = requirementQa.pass === true;
    const photographicRealismPass = photographicRealismQa.pass === true;
    const realismReviewRequired = photographicRealismQa.legacy === true
      || (!asset.photographic_realism_qa && !contract.photographic_realism_qa);
    const cameraDesignPass = cameraDesignQa.pass === true;
    const cameraReviewRequired = cameraDesignQa.legacy === true
      || (!asset.camera_design_qa && !contract.camera_design_qa);
    const crossViewPass = crossViewQa.pass === true;
    const spatialPass = spatialQa.pass === true;
    const appearancePass = contract.status === 'verified' && requirementPass && photographicRealismPass && crossViewPass;
    const evidenceComplete = completeSceneViewEvidence(asset);
    const complete = schemaVersion >= 6 && appearancePass && cameraDesignPass
      && spatialPass && layoutAvailable && evidenceComplete;
    const upgradeRequired = !partialCheckpoint && !complete && generationContractVersion < SCENE_GENERATION_CONTRACT_VERSION;
    const legacy = !partialCheckpoint && !complete && (schemaVersion < 3
      || !hasSpatialQa
      || spatialQa.legacy === true
      || spatialQa.coverage_status === 'legacy_partial'
      || contract.compatibility_status === 'legacy_partial'
      || upgradeRequired);
    const requirementScore = averagePercent(requirementQa, ['layout_match_score', 'material_light_match_score', 'interaction_match_score', 'surface_topology_match_score', 'negative_compliance_score']);
    const crossViewScore = averagePercent(crossViewQa, ['scene_consistency_score', 'geometry_consistency_score', 'material_consistency_score']);
    const spatialScore = scorePercent(spatialQa, ['coverage_score', 'spatial_coverage_score'])
      ?? averagePercent(spatialQa, ['layout_topology_score', 'camera_diversity_score', 'reverse_coverage_score', 'interaction_zone_score'])
      ?? null;
    const photographicRealismScore = averagePercent(photographicRealismQa, [
      'photographic_realism_score',
      'physical_material_score',
      'natural_variation_score',
      'optical_capture_score',
    ]);
    const cameraDesignScore = averagePercent(cameraDesignQa, [
      'role_definition_score',
      'requirement_mapping_score',
      'direction_evidence_score',
      'parameter_completeness_score',
      'layout_mapping_score',
    ]);
    return {
      complete,
      partialCheckpoint,
      legacy,
      upgradeRequired,
      generationContractVersion,
      appearancePass,
      layoutAvailable,
      hasLayoutView,
      hasSpatialQa,
      evidenceComplete,
      requirementQa,
      photographicRealismQa,
      cameraDesignQa,
      crossViewQa,
      spatialQa,
      layoutContract,
      schemaVersion,
      requirementScore,
      photographicRealismScore,
      cameraDesignScore,
      crossViewScore,
      spatialScore,
      realismReviewRequired,
      cameraReviewRequired,
    };
  }

  function verificationView(asset = {}) {
    const contract = asset.scene_contract && typeof asset.scene_contract === 'object' ? asset.scene_contract : {};
    const qa = asset.cross_view_qa || contract.cross_view_qa || {};
    const requirementQa = asset.requirement_qa || contract.requirement_qa || {};
    const photographicRealismQa = asset.photographic_realism_qa || contract.photographic_realism_qa || {};
    const cameraDesignQa = asset.camera_design_qa || contract.camera_design_qa || {};
    const assessment = sceneLockAssessment(asset);
    const spatialQa = assessment.spatialQa;
    const details = Object.keys(contract).length
      ? (contract.verification || {})
      : (asset.verification || {});
    const reasons = [...new Set([
      ...(Array.isArray(details.reasons) ? details.reasons : []),
      ...(Array.isArray(qa.mismatch_reasons) ? qa.mismatch_reasons : []),
      ...(Array.isArray(requirementQa.mismatch_reasons) ? requirementQa.mismatch_reasons : []),
      ...(Array.isArray(photographicRealismQa.mismatch_reasons) ? photographicRealismQa.mismatch_reasons : []),
      ...(Array.isArray(cameraDesignQa.mismatch_reasons) ? cameraDesignQa.mismatch_reasons : []),
      ...(Array.isArray(spatialQa.mismatch_reasons) ? spatialQa.mismatch_reasons : []),
    ].map(value => clean(value, 240)).filter(Boolean))].slice(0, 6);
    const firstPresent = (...values) => values.find(value => value !== undefined && value !== null && value !== '');
    const scores = [
      ['空间', qa.scene_consistency_score],
      ['结构', firstPresent(qa.geometry_consistency_score, qa.anchor_consistency_score)],
      ['材质', firstPresent(qa.material_consistency_score, qa.material_match_score)],
      ['需求布局', requirementQa.layout_match_score],
      ['需求材质/光线', requirementQa.material_light_match_score],
      ['互动空间', requirementQa.interaction_match_score],
      ['表面结构', requirementQa.surface_topology_match_score],
      ['禁止项', requirementQa.negative_compliance_score],
    ].filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([label, value]) => ({ label, value: Number(value) }))
      .filter(item => Number.isFinite(item.value))
      .map(item => ({ ...item, percent: Math.round(Math.max(0, Math.min(1, item.value)) * 100) }));
    [
      ['摄影真实性', photographicRealismQa.photographic_realism_score],
      ['自然变化', photographicRealismQa.natural_variation_score],
    ].forEach(([label, value]) => {
      if (value === undefined || value === null || value === '' || !Number.isFinite(Number(value))) return;
      scores.push({
        label,
        value: Number(value),
        percent: Math.round(Math.max(0, Math.min(1, Number(value))) * 100),
      });
    });
    if (assessment.partialCheckpoint) {
      const completed = Array.isArray(asset.completed_view_keys) ? asset.completed_view_keys.length : (Array.isArray(asset.view_images) ? asset.view_images.length : 0);
      const failedLabels = (Array.isArray(asset.failed_view_keys) ? asset.failed_view_keys : [])
        .map(key => VIEW_LABELS[key] || key)
        .filter(Boolean);
      return {
        tone: 'partial',
        label: `部分场景已保留 ${completed}/5`,
        message: details.message || `本轮已有 ${completed} 张场景图成功并保留${failedLabels.length ? `；${failedLabels.join('、')}尚未完成` : ''}。这些图片可查看，但未形成完整空间锁。`,
        reasons,
        scores: [],
        assessment,
      };
    }
    if (assessment.complete) {
      return { tone: 'verified', label: '完整空间已锁定', message: details.message || '需求、摄影真实性、机位设计、跨视图和空间覆盖五道验证均已通过，俯视布局已纳入空间合同', reasons: [], scores, assessment };
    }
    if (assessment.upgradeRequired) {
      return { tone: 'upgrade', label: '需要完整升级', message: '当前图片生成于旧版空间合同，重复验证或局部修复无法升级。请重新补齐空间设定并完整生成新版场景。', reasons: [], scores: [], assessment };
    }
    if (assessment.realismReviewRequired) {
      return {
        tone: 'unverified',
        label: '待摄影真实性复核',
        message: '当前图片已有 V7 空间母图，但生成于独立摄影真实性门禁启用之前。必须先复核真实材质、自然局部变化和相机光学证据，未通过前不会进入关键帧。',
        reasons: ['缺少新版摄影真实性评分与可见证据'],
        scores,
        assessment,
      };
    }
    if (assessment.cameraReviewRequired) {
      return {
        tone: 'unverified',
        label: '待逐机位设计复核',
        message: '当前图片已通过旧版综合空间 QA，但缺少每个机位的景别、镜头类型、高度、方向、俯视图位置、目标区域和需求映射证据。补齐并通过前不会进入关键帧。',
        reasons: ['缺少可核对的逐机位参数、俯视定位与需求映射'],
        scores,
        assessment,
      };
    }
    if (details.state === 'unavailable' || contract.qa_unavailable === true) {
      return { tone: 'unavailable', label: '场景待验证', message: details.message || '视觉审核服务暂时不可用，现有图片没有被判定为失败；再次验证不会重新生成图片。', reasons, assessment };
    }
    if (assessment.legacy && assessment.appearancePass) {
      return { tone: 'upgrade', label: '待升级', message: '这是旧版场景资产，目前只能确认外观一致。请重新生成当前场景，补齐俯视布局与空间覆盖验证。', reasons, scores, assessment };
    }
    if (assessment.appearancePass) {
      return { tone: 'appearance', label: '仅外观锁定', message: details.message || '需求和跨视图外观已通过，但空间覆盖或俯视布局未通过，不能标记为完整空间锁定。', reasons, scores, assessment };
    }
    if (contract.status === 'rejected') {
      return { tone: 'rejected', label: '场景验证未通过', message: details.message || reasons[0] || '场景未满足原始要求、跨视图不一致或空间覆盖不足', reasons, scores, assessment };
    }
    return { tone: 'unverified', label: '空间锁待验证', message: details.message || '首次使用或场景版本变化后需要验证一次', reasons, assessment };
  }

  function verificationDetailsHtml(view = {}, escapeHtml = value => value) {
    const lines = [view.message, ...(view.reasons || []).filter(reason => reason !== view.message)].filter(Boolean);
    if (!lines.length || view.tone === 'verified') return '';
    const guidance = window.NewStoryAdVerificationLanguage?.guidance?.({
      subject: '场景',
      reasons: lines,
      scores: view.scores || [],
      tone: view.tone,
    }) || [];
    return `<div class="dh-nsa-verification-details is-${escapeHtml(view.tone || 'unverified')}"><b>${escapeHtml(view.label)}</b>${(view.scores || []).length ? `<div class="dh-nsa-verification-scores">${view.scores.map(item => `<em>${escapeHtml(item.label)} ${item.percent}%</em>`).join('')}</div>` : ''}${lines.map(line => `<span>${escapeHtml(line)}</span>`).join('')}${guidance.length ? `<span><b>需要修改的位置：</b>${guidance.map(item => escapeHtml(item)).join('；')}</span>` : ''}</div>`;
  }

  function specPayload() {
    const scope = root();
    const value = key => clean(scope.querySelector(`[data-nsa-scene-spec="${key}"]`)?.value || '', key === 'negativeText' ? 500 : 600);
    const topologyKeys = ['mode', 'seam_policy', 'finish_distribution', 'primary_surface_count', 'secondary_surface_policy'];
    const userOverrides = topologyKeys.filter(key =>
      scope.querySelector(`[data-nsa-scene-spec="surfaceTopology.${key}"]`)?.dataset?.nsaUserEdited === 'true'
    );
    const primarySurfaceCount = Number(value('surfaceTopology.primary_surface_count') || 0);
    return {
      mode: clean(scope.querySelector('#dhNsaAdSceneMode')?.value || 'auto', 40),
      layoutText: value('layoutText'),
      materialLightText: value('materialLightText'),
      interactionText: value('interactionText'),
      negativeText: value('negativeText'),
      surfaceTopology: {
        mode: value('surfaceTopology.mode') || 'auto',
        seam_policy: value('surfaceTopology.seam_policy') || 'auto',
        finish_distribution: value('surfaceTopology.finish_distribution') || 'auto',
        primary_surface_count: Number.isInteger(primarySurfaceCount) && primarySurfaceCount > 0
          ? Math.max(1, Math.min(12, primarySurfaceCount))
          : null,
        secondary_surface_policy: value('surfaceTopology.secondary_surface_policy') || 'auto',
        user_overrides: userOverrides,
        notes: value('surfaceTopology.notes'),
      },
    };
  }

  function hasContinuousSurfaceIntent(spec = {}) {
    const topology = spec.surfaceTopology || spec.surface_topology || {};
    const text = [spec.layoutText, spec.materialLightText, spec.negativeText, topology.notes].filter(Boolean).join(' ');
    const surface = '(?:墙|墙面|背景墙|展示墙|基面|表面|平面)';
    const continuity = '(?:连续(?:完整)?|无缝|无接缝|隐藏(?:所有)?拼缝|拼缝不可见|无可见拼缝|零可见拼缝)';
    return new RegExp(`${surface}[^。；;]{0,24}${continuity}|${continuity}[^。；;]{0,24}${surface}`, 'i').test(text)
      || /(?:不要|禁止|不得)[^。；;]{0,120}可见(?:拼缝|接缝)|(?:拼缝|接缝)(?:必须|需要)?(?:隐藏|不可见)/i.test(text)
      || /(?:single|one)\s+(?:continuous|uninterrupted|seamless)\s+(?:wall|surface|plane)|(?:continuous|uninterrupted|seamless)\s+(?:single|one)\s+(?:wall|surface|plane)|no\s+(?:visible\s+)?(?:seam|joint)/i.test(text);
  }

  function hasSinglePrimarySurfaceIntent(spec = {}) {
    const topology = spec.surfaceTopology || spec.surface_topology || {};
    const text = [spec.layoutText, spec.materialLightText, spec.negativeText, topology.notes].filter(Boolean).join(' ');
    return /(?:仅|只|唯一|单独)?\s*(?:设置|保留|展示|使用|采用|需要|要|为|是|由|以)?\s*(?:一|1)\s*(?:整\s*)?(?:面|堵)\s*(?:完整的?)?\s*(?:主|主体|主要|核心)?\s*(?:(?:展示|背景|材料|材质|形象|艺术)\s*)*墙(?:面)?|(?:一|1)\s*(?:整\s*)?面(?:完整的?)?(?:的)?面板|单(?:一|独)?\s*(?:主|主体|主要)?\s*(?:展示|背景|材料|材质)?\s*(?:墙|墙面|平面)|(?:only|exactly|single|one)\s+(?:primary\s+|main\s+|display\s+|feature\s+|material\s+)*(?:wall|plane|surface)\b/i.test(text);
  }

  function reconcileSurfaceIntent(spec = {}, { syncControls = false } = {}) {
    const source = spec && typeof spec === 'object' ? spec : {};
    const current = source.surfaceTopology || source.surface_topology || {};
    const overrides = new Set(Array.isArray(current.user_overrides) ? current.user_overrides : []);
    const explicitContinuity = hasContinuousSurfaceIntent(source);
    const userLockedContinuity = (overrides.has('mode') && current.mode === 'continuous')
      || (overrides.has('seam_policy') && current.seam_policy === 'hidden');
    const singlePrimary = (overrides.has('primary_surface_count') && Number(current.primary_surface_count) === 1)
      || hasSinglePrimarySurfaceIntent(source);
    const topology = {
      ...current,
      mode: explicitContinuity || userLockedContinuity
        ? 'continuous'
        : (current.mode === 'continuous' && !overrides.has('mode') ? 'auto' : (current.mode || 'auto')),
      seam_policy: explicitContinuity || userLockedContinuity
        ? 'hidden'
        : (current.seam_policy === 'hidden' && !overrides.has('seam_policy') ? 'auto' : (current.seam_policy || 'auto')),
      finish_distribution: singlePrimary && !overrides.has('finish_distribution')
        ? 'uniform'
        : (current.finish_distribution || 'auto'),
      primary_surface_count: singlePrimary
        ? 1
        : (overrides.has('primary_surface_count') ? (Number(current.primary_surface_count) || null) : null),
      secondary_surface_policy: singlePrimary && !overrides.has('secondary_surface_policy')
        ? 'forbidden'
        : (current.secondary_surface_policy || 'auto'),
      user_overrides: [...overrides],
    };
    const changed = current.mode !== topology.mode
      || current.seam_policy !== topology.seam_policy
      || current.finish_distribution !== topology.finish_distribution
      || Number(current.primary_surface_count || 0) !== Number(topology.primary_surface_count || 0)
      || current.secondary_surface_policy !== topology.secondary_surface_policy;
    const next = { ...source, surfaceTopology: topology };
    if (syncControls && changed) applySpec(next, { clearMissing: false });
    return { spec: next, changed };
  }

  function requiresLayoutView(spec = {}) {
    // schema v3 requires a whole-space layout for every newly generated scene.
    // Keep the argument and exported helper for backward-compatible callers.
    void spec;
    return true;
  }

  function cameraAcceptanceHtml(asset = {}, assessment = {}) {
    const contract = asset.scene_contract && typeof asset.scene_contract === 'object' ? asset.scene_contract : {};
    const cameras = Array.isArray(contract.cameras) ? contract.cameras : [];
    const layoutView = (Array.isArray(asset.view_images) ? asset.view_images : [])
      .find(view => clean(view?.key || view?.view, 40) === 'layout');
    const layoutUrl = clean(layoutView?.url || layoutView?.image_url || contract.layout_contract?.reference_image_url || '', 1000);
    const cameraQa = assessment.cameraDesignQa || contract.camera_design_qa || {};
    const scoreText = assessment.cameraDesignScore === null || assessment.cameraDesignScore === undefined
      ? '待复核'
      : `${Math.round(Number(assessment.cameraDesignScore) || 0)}%`;
    const requirementLabels = {
      layout: '空间布局',
      material_light: '材质/光线',
      interaction: '互动位',
      style: '视觉风格',
      negative: '禁止项',
      surface_topology: '表面结构',
    };
    const validPoint = value => Array.isArray(value) && value.length === 2
      && value.every(number => Number.isFinite(Number(number)));
    const mappedCameras = cameras.filter(camera => validPoint(camera.normalized_position) && validPoint(camera.look_at));
    const colors = { master: '#38bdf8', reverse: '#a78bfa', interaction: '#34d399', detail: '#f59e0b' };
    const mapHtml = layoutUrl ? `<div class="dh-nsa-camera-map">
      <img src="${escapeHtml(thumbUrl(layoutUrl, 720))}" alt="机位俯视定位图" loading="lazy" decoding="async">
      <svg viewBox="0 0 100 100" role="img" aria-label="机位位置和拍摄方向（视觉估算）">
        <defs><marker id="dhNsaCameraArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="context-stroke"></path></marker></defs>
        ${mappedCameras.map(camera => {
          const x1 = Math.max(0, Math.min(100, Number(camera.normalized_position[0]) * 100));
          const y1 = Math.max(0, Math.min(100, Number(camera.normalized_position[1]) * 100));
          const x2 = Math.max(0, Math.min(100, Number(camera.look_at[0]) * 100));
          const y2 = Math.max(0, Math.min(100, Number(camera.look_at[1]) * 100));
          const color = colors[camera.view_id] || '#f8fafc';
          return `<g style="color:${color}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="1.8" marker-end="url(#dhNsaCameraArrow)"></line><circle cx="${x1}" cy="${y1}" r="3.2" fill="currentColor"></circle><text x="${Math.min(96, x1 + 4)}" y="${Math.max(5, y1 - 3)}" fill="currentColor">${escapeHtml(VIEW_LABELS[camera.view_id] || camera.label || camera.view_id)}</text></g>`;
        }).join('')}
      </svg>
      <small>点位、方向和角度均为视觉 QA 根据俯视图与透视图作出的估算，不是相机 EXIF；用于核对需求覆盖和机位差异。</small>
    </div>` : '<div class="dh-nsa-camera-map is-missing"><b>缺少俯视定位图</b><span>无法把各机位映射到空间布局。</span></div>';
    const rows = cameras.length ? cameras.map(camera => {
      const requirementRefs = (Array.isArray(camera.requirement_refs) ? camera.requirement_refs : [])
        .map(value => requirementLabels[value] || value).filter(Boolean);
      const angles = [
        Number.isFinite(Number(camera.estimated_azimuth_degrees)) ? `方位 ${Math.round(Number(camera.estimated_azimuth_degrees))}°` : '',
        Number.isFinite(Number(camera.estimated_pitch_degrees)) ? `俯仰 ${Math.round(Number(camera.estimated_pitch_degrees))}°` : '',
        camera.view_id === 'reverse' && Number.isFinite(Number(camera.azimuth_delta_from_master_degrees))
          ? `较主机位变化 ${Math.round(Number(camera.azimuth_delta_from_master_degrees))}°` : '',
      ].filter(Boolean).join(' · ');
      return `<div class="dh-nsa-camera-row ${camera.pass === true ? 'is-pass' : 'is-pending'}">
        <div><b>${escapeHtml(VIEW_LABELS[camera.view_id] || camera.label || camera.view_id)}</b><em>${camera.pass === true ? '证据完整' : '待补证据'}</em></div>
        <span><small>用途</small>${escapeHtml(camera.role || '待补充')}</span>
        <span><small>参数</small>${escapeHtml([camera.framing, camera.lens_class, camera.height_class].filter(Boolean).join(' · ') || '待补充')}</span>
        <span><small>方向</small>${escapeHtml([camera.orientation, angles].filter(Boolean).join(' · ') || '待补充')}</span>
        <span><small>目标区域</small>${escapeHtml(camera.target_description || '待补充')}</span>
        <span><small>对应要求</small>${escapeHtml(requirementRefs.join('、') || '待映射')}</span>
        <span class="dh-nsa-camera-evidence"><small>可见证据</small>${escapeHtml(camera.visible_evidence || '待补充')}</span>
      </div>`;
    }).join('') : '<div class="dh-nsa-camera-empty">当前合同没有逐机位参数，必须再次验证补齐后才能进入关键帧。</div>';
    return `<details class="dh-nsa-camera-acceptance">
      <summary><span><b>机位设计验收</b><small>逐机位参数、俯视定位、需求映射与可见证据</small></span><em class="${cameraQa.pass === true ? 'is-pass' : 'is-pending'}">${escapeHtml(scoreText)}</em></summary>
      <div class="dh-nsa-camera-acceptance-body">${mapHtml}<div class="dh-nsa-camera-table">${rows}</div></div>
    </details>`;
  }

  function selectedSceneAssetIndex(state = {}, assetInput = null) {
    const assets = Array.isArray(assetInput) ? assetInput : (Array.isArray(state.sceneAssets) ? state.sceneAssets : []);
    if (!assets.length) return -1;
    const plannedSpaces = Array.isArray(state.sceneConfig?.spaces) ? state.sceneConfig.spaces : [];
    if (plannedSpaces.length && Object.prototype.hasOwnProperty.call(state, 'scenePlanSelectedIndex')) {
      const selectedSpace = plannedSpaces[selectedPlanIndex(state, state.sceneConfig)] || null;
      const selectedSpaceId = clean(selectedSpace?.space_id || selectedSpace?.id || selectedSpace?.scene_id || '', 120);
      if (selectedSpaceId) {
        return assets.findIndex(asset => clean(asset.space_id || asset.scene_id || asset.id, 120) === selectedSpaceId);
      }
    }
    return Math.max(0, Math.min(assets.length - 1, Number(state.sceneSelectedIndex || 0) || 0));
  }

  function selectedSceneUpgradeRequired(state = {}) {
    const assets = Array.isArray(state.sceneAssets) ? state.sceneAssets : [];
    const index = selectedSceneAssetIndex(state, assets);
    if (index < 0) return false;
    return sceneLockAssessment(assets[index] || {}).upgradeRequired === true;
  }

  function resumableUpgradeProgress(state = {}, sceneId = '') {
    const progress = state.generationProgress && typeof state.generationProgress === 'object'
      ? state.generationProgress
      : {};
    return selectedSceneUpgradeRequired(state)
      && progress.stage === 'scene_asset'
      && progress.status === 'failed'
      && clean(progress.scene_id, 120) === clean(sceneId, 120)
      && Math.max(0, Number(progress.succeeded || 0) || 0) > 0;
  }

  function averagePercent(qa = {}, keys = []) {
    const values = keys.map(key => qa?.[key])
      .filter(value => value !== undefined && value !== null && value !== '')
      .map(Number)
      .filter(Number.isFinite);
    if (!values.length) return null;
    return Math.round((values.reduce((sum, value) => sum + Math.max(0, Math.min(1, value)), 0) / values.length) * 100);
  }

  function applySpecSuggestion(spec = {}) {
    const scope = root();
    let changed = false;
    Object.entries(spec || {}).forEach(([key, value]) => {
      const el = scope.querySelector(`[data-nsa-scene-spec="${key}"]`);
      const text = clean(value || '', 700);
      if (el && text && !clean(el.value || '', 10)) {
        el.value = text;
        changed = true;
      }
    });
    const topology = spec.surfaceTopology || spec.surface_topology || {};
    ['mode', 'seam_policy', 'finish_distribution', 'primary_surface_count', 'secondary_surface_policy', 'notes'].forEach(key => {
      const el = scope.querySelector(`[data-nsa-scene-spec="surfaceTopology.${key}"]`);
      const value = topology[key] ?? topology[key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())];
      const text = clean(value || '', 300);
      const current = clean(el?.value || '', 60);
      if (el && text && (!current || current === 'auto')) {
        el.value = text;
        changed = true;
      }
    });
    syncSpecSelectionState(scope);
    return changed;
  }

  function closeSpecSelect(control, { focus = false } = {}) {
    const shell = control?._nsaCustomSelect;
    if (!shell) return;
    shell.classList.remove('is-open');
    shell.classList.remove('opens-up');
    shell.querySelector('[data-nsa-select-trigger]')?.setAttribute('aria-expanded', 'false');
    const menu = shell.querySelector('[data-nsa-select-menu]');
    menu?.setAttribute('hidden', '');
    if (menu) menu.style.maxHeight = '';
    shell.closest('.dh-luxgen-story')?.classList.remove('has-open-scene-select');
    if (focus) shell.querySelector('[data-nsa-select-trigger]')?.focus();
  }

  function positionSpecSelectMenu(control) {
    const shell = control?._nsaCustomSelect;
    const trigger = shell?.querySelector('[data-nsa-select-trigger]');
    const menu = shell?.querySelector('[data-nsa-select-menu]');
    if (!shell || !trigger || !menu || menu.hidden) return;
    const rect = trigger.getBoundingClientRect();
    const viewportHeight = Math.max(0, Number(window.innerHeight || document.documentElement?.clientHeight || 0));
    const below = Math.max(0, viewportHeight - rect.bottom - 10);
    const above = Math.max(0, rect.top - 10);
    const desired = Math.min(320, Math.max(0, Number(menu.scrollHeight || 0)));
    const opensUp = below < desired && above > below;
    const available = opensUp ? above : below;
    shell.classList.toggle('opens-up', opensUp);
    menu.style.maxHeight = `${Math.max(96, Math.min(320, available))}px`;
  }

  function syncCustomSpecSelect(control) {
    const shell = control?._nsaCustomSelect;
    if (!shell) return;
    const optionSignature = Array.from(control.options || [])
      .map(option => [option.value, option.textContent, option.disabled ? '1' : '0'].join('\u0001'))
      .join('\u0002');
    if (control._nsaCustomSelectOptionSignature !== optionSignature) {
      const menu = shell.querySelector('[data-nsa-select-menu]');
      if (menu) {
        menu.replaceChildren();
        Array.from(control.options || []).forEach(nativeOption => {
          const option = document.createElement('button');
          option.type = 'button';
          option.className = 'dh-nsa-custom-select-option';
          option.dataset.nsaSelectOption = 'true';
          option.dataset.value = nativeOption.value;
          option.setAttribute('role', 'option');
          option.textContent = nativeOption.textContent;
          option.disabled = !!nativeOption.disabled;
          option.addEventListener('click', event => {
            event.preventDefault();
            if (option.disabled) return;
            if (control.value === nativeOption.value) {
              closeSpecSelect(control, { focus: true });
              return;
            }
            control.value = nativeOption.value;
            control.dispatchEvent(new Event('input', { bubbles: true }));
            control.dispatchEvent(new Event('change', { bubbles: true }));
            syncSpecSelectionState(control);
            closeSpecSelect(control, { focus: true });
          });
          menu.appendChild(option);
        });
      }
      control._nsaCustomSelectOptionSignature = optionSignature;
    }
    const selected = Array.from(control.options || []).find(option => option.value === control.value)
      || control.options?.[0];
    const trigger = shell.querySelector('[data-nsa-select-trigger]');
    if (trigger) {
      trigger.querySelector('[data-nsa-select-value]').textContent = selected?.textContent || '';
      trigger.disabled = !!control.disabled;
    }
    shell.classList.toggle('is-explicit-selection', control.dataset.nsaSelectionState === 'explicit');
    shell.querySelectorAll('[data-nsa-select-option]').forEach(option => {
      const active = option.dataset.value === String(control.value || '');
      option.classList.toggle('is-selected', active);
      option.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function enhanceSpecSelect(control) {
    if (!control || control.tagName !== 'SELECT' || control._nsaCustomSelect) return;
    const options = Array.from(control.options || []);
    if (!options.length || !control.parentNode) return;
    const shell = document.createElement('div');
    shell.className = 'dh-nsa-custom-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'dh-nsa-custom-select-trigger';
    trigger.dataset.nsaSelectTrigger = 'true';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = '<span data-nsa-select-value></span><i aria-hidden="true"></i>';
    const menu = document.createElement('div');
    menu.className = 'dh-nsa-custom-select-menu';
    menu.dataset.nsaSelectMenu = 'true';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('hidden', '');
    control.parentNode.insertBefore(shell, control);
    shell.append(control, trigger, menu);
    control.classList.add('dh-nsa-custom-select-native');
    control._nsaCustomSelect = shell;
    trigger.addEventListener('click', event => {
      event.preventDefault();
      syncCustomSpecSelect(control);
      const opening = !shell.classList.contains('is-open');
      document.querySelectorAll('.dh-nsa-custom-select.is-open').forEach(openShell => {
        const native = openShell.querySelector('select');
        if (native && native !== control) closeSpecSelect(native);
      });
      shell.classList.toggle('is-open', opening);
      trigger.setAttribute('aria-expanded', opening ? 'true' : 'false');
      menu.toggleAttribute('hidden', !opening);
      shell.closest('.dh-luxgen-story')?.classList.toggle('has-open-scene-select', opening);
      if (opening) {
        positionSpecSelectMenu(control);
        (menu.querySelector('.is-selected') || menu.querySelector('[data-nsa-select-option]:not(:disabled)'))?.focus();
      }
    });
    shell.addEventListener('keydown', event => {
      const enabled = Array.from(menu.querySelectorAll('[data-nsa-select-option]:not(:disabled)'));
      const current = enabled.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSpecSelect(control, { focus: true });
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!shell.classList.contains('is-open')) trigger.click();
        else enabled[(current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length]?.focus();
      }
    });
    if (!document.documentElement.dataset.nsaSpecSelectOutsideBound) {
      document.documentElement.dataset.nsaSpecSelectOutsideBound = 'true';
      document.addEventListener('pointerdown', event => {
        document.querySelectorAll('.dh-nsa-custom-select.is-open').forEach(openShell => {
          if (openShell.contains(event.target)) return;
          const native = openShell.querySelector('select');
          if (native) closeSpecSelect(native);
        });
      });
    }
    syncCustomSpecSelect(control);
  }

  function isStoryAdSelect(control) {
    if (!control) return false;
    if (control.matches?.('select[data-nsa-scene-spec], #dhNsaAdSceneMode')) return true;
    if (control.tagName !== 'SELECT') return false;
    if (control.classList?.contains?.('dh-luxgen-hidden-control') || control.getAttribute?.('aria-hidden') === 'true') return false;
    if (!control.classList?.contains?.('dh-input')) return false;
    if (root()?.contains?.(control)) return true;
    if (String(control.id || '').startsWith('dhNsa')) return true;
    if (Array.from(control.attributes || []).some(attribute => attribute.name.startsWith('data-nsa-'))) return true;
    return !!control.closest('[class*="dh-nsa-"]');
  }

  function storyAdSelects(target = root()) {
    if (target?.matches?.('select[data-nsa-scene-spec], #dhNsaAdSceneMode')) return [target];
    if (target?.matches?.('select') && isStoryAdSelect(target)) return [target];
    const controls = Array.from(target?.querySelectorAll?.('select.dh-input:not(.dh-luxgen-hidden-control):not([aria-hidden="true"])') || []);
    return controls.filter(isStoryAdSelect);
  }

  function bindStoryAdSelectObserver() {
    if (!document.documentElement || typeof MutationObserver !== 'function') return;
    if (document.documentElement.dataset.nsaCustomSelectObserverBound) return;
    document.documentElement.dataset.nsaCustomSelectObserverBound = 'true';
    const observer = new MutationObserver(mutations => {
      const targets = new Set();
      mutations.forEach(mutation => {
        if (mutation.target?.closest?.('select')) targets.add(mutation.target.closest('select'));
        mutation.addedNodes?.forEach(node => {
          if (node?.matches?.('select')) targets.add(node);
          node?.querySelectorAll?.('select')?.forEach(select => targets.add(select));
        });
      });
      targets.forEach(control => {
        if (isStoryAdSelect(control)) syncSpecSelectionState(control);
      });
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });
    document.addEventListener('new-story-ad:restore-finished', () => syncSpecSelectionState(), true);
  }

  function bindSceneSpecEditTracking() {
    const scope = root();
    if (!scope?.addEventListener || scope.dataset?.nsaSceneSpecEditTrackingBound === 'true') return;
    if (scope.dataset) scope.dataset.nsaSceneSpecEditTrackingBound = 'true';
    const mark = event => {
      const control = event.target?.closest?.('[data-nsa-scene-spec^="surfaceTopology."]');
      if (!control) return;
      const key = clean(control.getAttribute('data-nsa-scene-spec') || '', 100).replace('surfaceTopology.', '');
      if (['mode', 'seam_policy', 'finish_distribution', 'primary_surface_count', 'secondary_surface_policy'].includes(key)) {
        control.dataset.nsaUserEdited = 'true';
      }
    };
    scope.addEventListener('input', mark, true);
    scope.addEventListener('change', mark, true);
  }

  function syncSpecSelectionState(target = root()) {
    bindStoryAdSelectObserver();
    bindSceneSpecEditTracking();
    const controls = storyAdSelects(target);
    controls.forEach(control => {
      const explicit = !['', 'auto', 'match_brief'].includes(clean(control.value || '', 60));
      control.classList.toggle('is-explicit-selection', explicit);
      control.dataset.nsaSelectionState = explicit ? 'explicit' : 'auto';
      enhanceSpecSelect(control);
      syncCustomSpecSelect(control);
    });
  }

  function applySpec(spec = {}, options = {}) {
    const scope = root();
    const clearMissing = options.clearMissing !== false;
    const source = spec && typeof spec === 'object' ? spec : {};
    ['layoutText', 'materialLightText', 'interactionText', 'negativeText'].forEach(key => {
      const el = scope.querySelector(`[data-nsa-scene-spec="${key}"]`);
      if (!el) return;
      const value = source[key];
      if (value !== undefined && value !== null) {
        el.value = String(value);
      } else if (clearMissing) {
        el.value = '';
      }
    });
    const topology = source.surfaceTopology || source.surface_topology || {};
    const userOverrides = new Set(Array.isArray(topology.user_overrides || topology.userOverrides)
      ? (topology.user_overrides || topology.userOverrides)
      : []);
    ['mode', 'seam_policy', 'finish_distribution', 'primary_surface_count', 'secondary_surface_policy', 'notes'].forEach(key => {
      const el = scope.querySelector(`[data-nsa-scene-spec="surfaceTopology.${key}"]`);
      if (!el) return;
      const value = topology[key] ?? topology[key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())];
      if (value !== undefined && value !== null) el.value = String(value);
      else if (clearMissing) el.value = ['notes', 'primary_surface_count'].includes(key) ? '' : 'auto';
      el.dataset.nsaUserEdited = userOverrides.has(key) ? 'true' : 'false';
    });
    const mode = scope.querySelector('#dhNsaAdSceneMode');
    if (mode) {
      if (source.mode) mode.value = String(source.mode);
      else if (clearMissing) mode.value = 'auto';
    }
    syncSpecSelectionState(scope);
  }

  function clearSpecInputs() {
    applySpec({}, { clearMissing: true });
  }

  /** 规范化前端场景计划；场景数量只由 spaces 数组决定，不再从混合文本猜测。 */
  function normalizePlan(plan = {}) {
    const source = plan && typeof plan === 'object' ? plan : {};
    const spaces = (Array.isArray(source.spaces) ? source.spaces : []).map((space, index) => {
      const item = space && typeof space === 'object' ? space : {};
      const id = clean(item.id || item.space_id || item.scene_id || `space_${index + 1}`, 120);
      return {
        ...item,
        id,
        space_id: id,
        scene_id: id,
        name: clean(item.name || item.label || `独立空间 ${index + 1}`, 120),
        description: clean(item.description || item.layout || '', 500),
        story_purpose: clean(item.story_purpose || item.storyPurpose || item.purpose || '', 300),
        scene_spec: item.scene_spec && typeof item.scene_spec === 'object'
          ? item.scene_spec
          : (item.sceneSpec && typeof item.sceneSpec === 'object' ? item.sceneSpec : {}),
      };
    }).filter(space => space.id);
    return {
      ...source,
      scene_mode: spaces.length > 1 ? 'multi' : (spaces.length === 1 ? 'single' : 'auto'),
      spaces,
    };
  }

  function selectedPlanIndex(state = {}, planInput = null) {
    const plan = normalizePlan(planInput || state.sceneConfig || {});
    if (!plan.spaces.length) return 0;
    const selectedId = clean(state.scenePlanSelectedId, 120);
    const selectedById = selectedId ? plan.spaces.findIndex(space => space.id === selectedId) : -1;
    if (selectedById >= 0) return selectedById;
    return Math.max(0, Math.min(
      plan.spaces.length - 1,
      Number(state.scenePlanSelectedIndex || 0) || 0,
    ));
  }

  /** 应用结构化场景计划并把当前空间同步到编辑表单，供用户逐空间检查。 */
  function applyPlan(state = {}, plan = {}) {
    const normalized = normalizePlan(plan);
    if (!normalized.spaces.length) return null;
    state.sceneConfig = normalized;
    state.scenePlanSelectedIndex = selectedPlanIndex(state, normalized);
    const mode = root()?.querySelector?.('#dhNsaAdSceneMode');
    if (mode) mode.value = normalized.scene_mode;
    const target = normalized.spaces[state.scenePlanSelectedIndex] || normalized.spaces[0];
    state.scenePlanSelectedId = target.id;
    applySpec(target.scene_spec || {}, { clearMissing: true });
    if (mode) mode.value = normalized.scene_mode;
    syncSpecSelectionState(root());
    return { plan: normalized, active_space: target, scene_spec: target.scene_spec || {} };
  }

  /** 保存前将当前表单写回对应 space，避免自动保存持久化旧的场景计划。 */
  function sceneSpecControlsAvailable() {
    return !!root()?.querySelector?.('[data-nsa-scene-spec="layoutText"]');
  }

  function planPayload(state = {}, currentSpec = null) {
    const plan = normalizePlan(state.sceneConfig || {});
    if (!plan.spaces.length) return null;
    const targetIndex = selectedPlanIndex(state, plan);
    plan.spaces[targetIndex] = {
      ...plan.spaces[targetIndex],
      scene_spec: currentSpec && typeof currentSpec === 'object' ? currentSpec : specPayload(),
    };
    return normalizePlan(plan);
  }

  /**
   * “AI 补齐”只能填补当前场景的空白字段。当前 DOM 的非空值是用户权威，
   * 其它空间和稳定 ID 必须保持不变。
   */
  function preserveCurrentSpecInPlan(planInput = {}, targetSpaceId = '', currentSpec = {}) {
    const plan = normalizePlan(planInput);
    if (!plan.spaces.length) return plan;
    const selectedId = clean(targetSpaceId, 120);
    const targetIndex = selectedId
      ? plan.spaces.findIndex(space => space.id === selectedId)
      : 0;
    if (targetIndex < 0) return plan;
    const incoming = plan.spaces[targetIndex].scene_spec || {};
    const protectedText = ['layoutText', 'materialLightText', 'interactionText', 'negativeText']
      .reduce((result, key) => {
        const value = clean(currentSpec?.[key], key === 'negativeText' ? 500 : 600);
        if (value) result[key] = value;
        return result;
      }, {});
    const currentTopology = currentSpec?.surfaceTopology || currentSpec?.surface_topology || {};
    plan.spaces[targetIndex] = {
      ...plan.spaces[targetIndex],
      description: protectedText.layoutText || plan.spaces[targetIndex].description,
      scene_spec: {
        ...incoming,
        ...protectedText,
        surfaceTopology: Object.keys(currentTopology).length
          ? { ...(incoming.surfaceTopology || incoming.surface_topology || {}), ...currentTopology }
          : (incoming.surfaceTopology || incoming.surface_topology || {}),
      },
    };
    return normalizePlan(plan);
  }

  function sceneSpecFingerprint(spec = {}) {
    const reconciled = reconcileSurfaceIntent(spec).spec;
    const topology = reconciled.surfaceTopology || reconciled.surface_topology || {};
    return JSON.stringify({
      layoutText: clean(reconciled.layoutText || '', 600),
      materialLightText: clean(reconciled.materialLightText || '', 600),
      interactionText: clean(reconciled.interactionText || '', 600),
      negativeText: clean(reconciled.negativeText || '', 600),
      surfaceTopology: {
        mode: clean(topology.mode || 'auto', 60),
        seam_policy: clean(topology.seam_policy || 'auto', 60),
        finish_distribution: clean(topology.finish_distribution || 'auto', 60),
        primary_surface_count: Number(topology.primary_surface_count || 0) || null,
        secondary_surface_policy: clean(topology.secondary_surface_policy || 'auto', 60),
        user_overrides: [...new Set(Array.isArray(topology.user_overrides) ? topology.user_overrides : [])].sort(),
        notes: clean(topology.notes || '', 500),
      },
    });
  }

  function assertCurrentSceneSpecSubmitted(currentSpec = {}, submittedSpec = {}) {
    if (sceneSpecFingerprint(currentSpec) === sceneSpecFingerprint(submittedSpec)) return true;
    const error = new Error('当前编辑的场景设定与即将提交的场景合同不一致，已停止图片生成；请重新确认当前场景。');
    error.code = 'SCENE_SPEC_STALE_SUBMISSION_BLOCKED';
    error.retryable = false;
    throw error;
  }

  function selectPlanSpace(state = {}, index = 0) {
    const saved = planPayload(state) || normalizePlan(state.sceneConfig || {});
    if (!saved.spaces.length) return null;
    state.sceneConfig = saved;
    state.scenePlanSelectedIndex = Math.max(0, Math.min(saved.spaces.length - 1, Number(index) || 0));
    const selected = saved.spaces[state.scenePlanSelectedIndex];
    state.scenePlanSelectedId = selected.id;
    const assets = Array.isArray(state.sceneAssets) ? state.sceneAssets : [];
    const assetIndex = assets.findIndex(asset => clean(asset.space_id || asset.scene_id || asset.id, 120) === selected.id);
    if (assetIndex >= 0) state.sceneSelectedIndex = assetIndex;
    applySpec(selected.scene_spec || {}, { clearMissing: true });
    const mode = root()?.querySelector?.('#dhNsaAdSceneMode');
    if (mode) mode.value = saved.scene_mode;
    syncSpecSelectionState(root());
    return selected;
  }

  function selectPlanSpaceById(state = {}, spaceId = '') {
    const plan = normalizePlan(state.sceneConfig || {});
    const index = plan.spaces.findIndex(space => space.id === clean(spaceId, 120));
    return index >= 0 ? selectPlanSpace(state, index) : null;
  }

  function draftSpaceId(existing = new Set()) {
    const cryptoId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    let candidate = `space_${String(cryptoId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    let suffix = 1;
    while (existing.has(candidate)) candidate = `${candidate}_${suffix++}`;
    return candidate;
  }

  /** 仅增加一个可编辑的场景计划，不提交图片生成。 */
  function addDraftSpace(state = {}) {
    const plan = planPayload(state) || normalizePlan(state.sceneConfig || {});
    const existing = new Set(plan.spaces.map(space => space.id));
    const id = draftSpaceId(existing);
    const nextIndex = plan.spaces.length;
    plan.spaces.push({
      id,
      space_id: id,
      scene_id: id,
      name: `独立空间 ${nextIndex + 1}`,
      description: '',
      story_purpose: '',
      scene_spec: {},
      draft: true,
    });
    state.sceneConfig = normalizePlan(plan);
    state.scenePlanSelectedIndex = nextIndex;
    state.scenePlanSelectedId = id;
    applySpec({}, { clearMissing: true });
    const mode = root()?.querySelector?.('#dhNsaAdSceneMode');
    if (mode) mode.value = state.sceneConfig.scene_mode;
    syncSpecSelectionState(root());
    return state.sceneConfig.spaces[nextIndex];
  }

  function addDraft({ state = {}, renderAll, toast, onChanged } = {}) {
    const added = addDraftSpace(state);
    if (!added) return false;
    onChanged?.(added);
    renderAll?.();
    toast?.(`已新增“${added.name}”设定，尚未提交任何图片生成。`, 'success');
    return true;
  }

  function normalizeView(view = {}, index = 0) {
    const key = clean(view.key || view.view || ['master', 'reverse', 'interaction', 'detail'][index] || `view_${index + 1}`, 40);
    const url = clean(view.url || view.image_url || view.imageUrl || view.file_url || '', 1000);
    return {
      ...view,
      key,
      label: clean(view.label || VIEW_LABELS[key] || `视角 ${index + 1}`, 80),
      url,
      image_url: clean(view.image_url || url, 1000),
    };
  }

  function normalizeAsset(asset = {}, index = 0) {
    if (!asset || typeof asset !== 'object') return null;
    const rawViews = Array.isArray(asset.view_images)
      ? asset.view_images
      : (Array.isArray(asset.views) ? asset.views : []);
    const views = rawViews.length
      ? rawViews.map(normalizeView).filter(view => view.url || view.image_url)
      : [];
    const url = clean(asset.image_url || asset.url || views[0]?.url || views[0]?.image_url || '', 1000);
    if (!url && !views.length) return null;
    return {
      ...asset,
      id: clean(asset.id || asset.scene_id || `scene_${index + 1}`, 120),
      scene_id: clean(asset.scene_id || asset.id || `scene_${index + 1}`, 120),
      space_id: clean(asset.space_id || asset.spaceId || asset.scene_id || asset.id || `scene_${index + 1}`, 120),
      name: clean(asset.name || `任务场景 ${index + 1}`, 120),
      lock_strength: clean(asset.lock_strength || asset.lockStrength || 'standard', 40),
      image_url: url,
      url,
      view_images: views,
      view_count: Number(asset.view_count || views.length || (url ? 1 : 0)) || 0,
      scene_revision: Math.max(1, Number(asset.scene_revision || asset.sceneRevision || 1) || 1),
      generation_contract_version: Math.max(0, Number(asset.generation_contract_version || asset.view_acquisition?.generation_contract_version || 0) || 0),
      scene_contract: asset.scene_contract && typeof asset.scene_contract === 'object' ? asset.scene_contract : null,
      cross_view_qa: asset.scene_contract?.cross_view_qa || asset.cross_view_qa || null,
      requirement_qa: asset.scene_contract?.requirement_qa || asset.requirement_qa || null,
      photographic_realism_qa: asset.scene_contract?.photographic_realism_qa || asset.photographic_realism_qa || null,
      camera_design_qa: asset.scene_contract?.camera_design_qa || asset.camera_design_qa || null,
      layout_contract: asset.scene_contract?.layout_contract || asset.layout_contract || null,
      spatial_coverage_qa: asset.scene_contract?.spatial_coverage_qa || asset.spatial_coverage_qa || null,
    };
  }

  function normalizeAssets(input = []) {
    const raw = Array.isArray(input) ? input : [];
    return raw.map(normalizeAsset).filter(Boolean);
  }

  function escapeHtml(value = '') {
    return String(value || '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function thumbUrl(url = '', width = 480) {
    const raw = String(url || '').trim();
    if (!/^\/api\/new-story-ad\/assets\//i.test(raw)) return raw;
    const size = Math.max(160, Math.min(960, Number(width) || 480));
    return `${raw}${raw.includes('?') ? '&' : '?'}thumb=${size}`;
  }

  function formatElapsedText(ms = 0) {
    const sec = Math.max(0, Math.round(Number(ms) / 1000) || 0);
    if (sec >= 60) return `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, '0')}秒`;
    return `${sec}秒`;
  }

  function sceneProgressView(progress = {}) {
    const startedAt = Number(progress.startedAt || 0)
      || Date.parse(progress.started_at || '')
      || Date.now();
    const elapsed = Math.max(0, Date.now() - startedAt);
    const total = Math.max(1, Number(progress.target_total || progress.total || 5) || 5);
    const completed = Math.max(0, Math.min(total, Number(progress.succeeded ?? progress.completed ?? 0) || 0));
    const realStates = Array.isArray(progress.view_states) ? progress.view_states : [];
    const verifying = progress.phase === 'verification' || progress.status === 'verifying';
    const activeStates = realStates.filter(item => item.status === 'running');
    const runningCredit = Math.min(Math.max(0, total - completed), activeStates.length) * 0.25;
    const pct = verifying
      ? 94
      : Math.max(8, Math.min(92, Math.round(Number(realStates.length
        ? (8 + (((completed + runningCredit) / total) * 80))
        : progress.percent) || 8)));
    const activeLabels = activeStates
      .map(item => item.label || VIEW_LABELS[item.key] || item.key)
      .filter(Boolean);
    const queuedLabels = realStates
      .filter(item => item.status === 'queued')
      .map(item => item.label || VIEW_LABELS[item.key] || item.key)
      .filter(Boolean);
    const targetKeys = Array.isArray(progress.view_keys) && progress.view_keys.length
      ? progress.view_keys
      : realStates.map(item => item.key).filter(Boolean);
    const targetLabels = targetKeys.map(key => VIEW_LABELS[key] || key).filter(Boolean);
    const activePositions = activeStates
      .map(item => targetKeys.indexOf(item.key) + 1)
      .filter(position => position > 0)
      .sort((a, b) => a - b);
    const current = activePositions[0] || Math.max(1, Math.min(total, Number(progress.current || completed + 1) || 1));
    const viewLabel = activeLabels[0] || targetLabels[current - 1] || `视图 ${current}`;
    const operation = progress.mode === 'repair' ? '修复' : '生成';
    const activeRange = activePositions.length > 1
      ? `${activePositions[0]}–${activePositions[activePositions.length - 1]}`
      : String(activePositions[0] || current);
    const retryStates = activeStates.filter(item => item.retrying === true || Number(item.attempt || 1) > 1);
    const retryText = retryStates.length
      ? `（${retryStates.map(item => `${item.label || VIEW_LABELS[item.key] || item.key} 第 ${Number(item.attempt || 1)}/${Number(item.max_attempts || 3)} 次尝试`).join('、')}）`
      : '';
    const title = verifying
      ? `${total}/${total} 张已生成，正在自动复验`
      : (activeLabels.length
        ? `正在${activeLabels.length > 1 ? `并行${operation}` : operation}第 ${activeRange}/${total} 张：${activeLabels.join('、')}${retryText}`
        : (realStates.length && queuedLabels.length
          ? `准备${operation} ${total} 张：${queuedLabels.join('、')}`
          : `${operation}任务正在提交：共 ${total} 张`));
    const realMessage = verifying
      ? `${completed}/${total} 张已生成完成，正在执行自动视觉验证。`
      : (activeLabels.length
        ? `已完成 ${completed}/${total} 张；正在生成：${activeLabels.join('、')}。`
        : (realStates.length && queuedLabels.length
          ? `已完成 ${completed}/${total} 张；等待生成：${queuedLabels.join('、')}。`
          : '任务已提交，正在等待服务器返回真实视图进度。'));
    return {
      pct,
      completed,
      current,
      total,
      viewLabel,
      title,
      targetLabels,
      elapsedText: formatElapsedText(elapsed),
      message: realStates.length || verifying
        ? realMessage
        : (progress.message || `预计生成 ${total} 张场景参考，正在等待真实生成状态。`),
    };
  }

  function liveSceneProgress(state = {}, fallback = {}) {
    const server = state.generationProgress && state.generationProgress.stage === 'scene_asset'
      ? state.generationProgress
      : null;
    const serverStartedAt = Date.parse(server?.started_at || '') || 0;
    const clickStartedAt = Number(fallback.startedAt || 0) || Date.now();
    const current = server
      && ['running', 'verifying'].includes(String(server.status || ''))
      && (!serverStartedAt || serverStartedAt >= clickStartedAt - 30000);
    return current
      ? { ...server, active: true, startedAt: serverStartedAt || clickStartedAt }
      : { ...fallback, active: true, startedAt: clickStartedAt };
  }

  function render({ host, state = {} } = {}) {
    if (!host) return;
    const assets = normalizeAssets(state.sceneAssets || []);
    const plannedSpaces = Array.isArray(state.sceneConfig?.spaces) ? state.sceneConfig.spaces : [];
    const detectedMulti = state.sceneConfig?.scene_mode === 'multi' || plannedSpaces.length > 1;
    const modeControl = root()?.querySelector?.('#dhNsaAdSceneMode') || null;
    if (detectedMulti && modeControl?.value === 'auto') modeControl.value = 'multi';
    const progress = state.sceneGenerationProgress || null;
    const planIndex = selectedPlanIndex(state);
    state.scenePlanSelectedIndex = planIndex;
    const selectedSpace = plannedSpaces[planIndex] || null;
    state.scenePlanSelectedId = selectedSpace?.id || '';
    const progressSceneId = clean(progress?.scene_id || progress?.sceneId, 120);
    const failure = sceneOperationFailure(state, plannedSpaces);
    const selectedSpaceId = clean(selectedSpace?.id || selectedSpace?.space_id || selectedSpace?.scene_id, 120);
    const selectedFailure = failure?.sceneId && failure.sceneId === selectedSpaceId ? failure : null;
    const progressPanel = sceneProgressHtml(progress, plannedSpaces, {
      canCancel: !!state.taskId,
      cancelRequested: state.cancelRequested === true,
    });
    const failurePanel = progress?.active ? '' : sceneFailureHtml(selectedFailure);
    const plannedAssetIndex = selectedSpace
      ? assets.findIndex(item => clean(item.space_id || item.scene_id || item.id, 120) === clean(selectedSpace.id || selectedSpace.space_id || selectedSpace.scene_id, 120))
      : -1;
    const fallbackAssetIndex = Math.max(0, Math.min(assets.length - 1, Number(state.sceneSelectedIndex || 0) || 0));
    const selectedIndex = plannedAssetIndex >= 0 ? plannedAssetIndex : fallbackAssetIndex;
    const displaySceneIndex = plannedSpaces.length ? planIndex : selectedIndex;
    const displaySceneTotal = plannedSpaces.length || assets.length;
    const planTabs = plannedSpaces.length
      ? `<div class="dh-nsa-scene-tabs">${plannedSpaces.map((space, index) => {
          const spaceId = clean(space.id || space.space_id || space.scene_id, 120);
          const generated = assets.some(item => clean(item.space_id || item.scene_id || item.id, 120) === spaceId);
          const generating = progress?.active && !!progressSceneId && progressSceneId === spaceId;
          const failed = !progress?.active && !!failure?.sceneId && failure.sceneId === spaceId;
          return `<div class="dh-nsa-scene-tab ${index === planIndex ? 'active' : ''} ${generating ? 'is-running' : ''} ${failed ? 'is-failed' : ''}">
            <button type="button" data-nsa-scene-plan-select="${index}">
              <b>场景 ${index + 1}</b><span>${escapeHtml(space.name || `独立空间 ${index + 1}`)} · ${generating ? '生成中' : (failed ? '生成失败' : (generated ? '已生成' : '待生成'))}</span>
            </button>
          </div>`;
        }).join('')}</div>`
      : '';
    if (!assets.length || (selectedSpace && plannedAssetIndex < 0)) {
      host.innerHTML = `<div class="dh-nsa-scene-list">
        ${planTabs}
        ${progressPanel}
        ${failurePanel}
        <div class="dh-nsa-scene-card is-empty">
        <div class="dh-nsa-scene-thumb">空间</div>
          <div class="dh-nsa-scene-body">
            <b>${escapeHtml(selectedSpace?.name || '未生成场景参考')}</b>
            <span>${selectedSpace ? `当前为场景 ${planIndex + 1}/${plannedSpaces.length}，空间设定已单独显示。填写或检查后，再按需点击“生成/重新生成当前场景”。` : (detectedMulti ? `剧情已识别 ${plannedSpaces.length || 2} 个独立空间，请分别生成并验证同等数量的场景资产后再生成分镜。` : '可在生成剧本前先锁定当前任务的空间布局、材质和光线；复杂场景会自动增加俯视布局参考。')}</span>
          </div>
        </div>
      </div>`;
      return;
    }
    state.sceneSelectedIndex = selectedIndex;
    const asset = assets[selectedIndex];
    const views = asset.view_images || [];
    const mainUrl = asset.url || asset.image_url || views[0]?.url || views[0]?.image_url || '';
    const canonicalSource = asset.space_asset_contract?.canonical_source || {};
    const atlasUrl = canonicalSource.url || canonicalSource.image_url || '';
    const atlasHash = clean(canonicalSource.sha256 || '', 80);
    const isV7Atlas = Number(asset.generation_contract_version || 0) >= SCENE_GENERATION_CONTRACT_VERSION
      && asset.view_strategy === 'atlas_2x2'
      && !!atlasUrl;
    const sceneVerification = verificationView(asset);
    const assessment = sceneVerification.assessment || sceneLockAssessment(asset);
    const qaPassed = assessment.complete;
    const repairAction = asset.repair_plan?.action || '';
    const repairViewKeys = Array.isArray(asset.repair_plan?.view_keys)
      ? asset.repair_plan.view_keys.filter(key => VIEW_LABELS[key])
      : [];
    const currentReverifyContract = repairAction === 'reverify'
      && assessment.generationContractVersion >= SCENE_GENERATION_CONTRACT_VERSION
      && completeSceneViewEvidence(asset);
    const effectiveLegacy = assessment.legacy && !currentReverifyContract;
    const canReverify = !qaPassed && !assessment.partialCheckpoint && !effectiveLegacy && (
      assessment.realismReviewRequired
      || assessment.cameraReviewRequired
      ||
      repairAction === 'reverify'
      || (!repairAction && ['unavailable', 'unverified', 'appearance'].includes(sceneVerification.tone))
    );
    const canRepair = !qaPassed
      && !assessment.partialCheckpoint
      && !effectiveLegacy
      && repairAction === 'regenerate_failed_views'
      && repairViewKeys.length > 0;
    const canRebuildAtlas = !qaPassed
      && !assessment.partialCheckpoint
      && !effectiveLegacy
      && repairAction === 'rebuild_atlas';
    const canUpgrade = !qaPassed && !assessment.partialCheckpoint
      && assessment.upgradeRequired && !currentReverifyContract;
    const verificationBadgeText = assessment.partialCheckpoint
      ? '部分成功图片仅供查看，完整空间锁仍未完成；不会自动重复提交失败视图'
      : (canUpgrade
        ? '旧版图片不能继续复验或局部修复，需要一次完整升级'
        : (effectiveLegacy
          ? '旧资产仅锁定外观，不能作为完整空间锁进入关键帧'
          : (sceneVerification.tone === 'unavailable'
            ? '审核服务异常，图片尚未判定失败'
            : '未完整锁定的场景不会进入关键帧')));
    const legacyUpgradeHint = effectiveLegacy
      ? '<span class="dh-nsa-verification-hint">请点击下方“生成/重新生成当前场景”升级，系统会补齐俯视布局与空间覆盖验证。</span>'
      : '';
    const repairFailure = selectedFailure
      ? sceneRepairFailureMessage(selectedFailure.message)
      : '';
    const repairCount = repairViewKeys.length;
    const repairLabels = repairViewKeys.map(key => VIEW_LABELS[key]).join('、');
    const metricValue = value => value === null || value === undefined || value === ''
      ? '待验证'
      : (Number.isFinite(Number(value)) ? `${Math.round(Number(value))}%` : '待验证');
    host.innerHTML = `<div class="dh-nsa-scene-list">
      ${planTabs || (assets.length ? `<div class="dh-nsa-scene-tabs">
        ${assets.map((item, index) => `<div class="dh-nsa-scene-tab ${index === selectedIndex ? 'active' : ''}">
          <button type="button" data-nsa-scene-select="${index}">
            <b>场景 ${index + 1}</b><span>${escapeHtml(item.name || '任务场景')}</span>
          </button>
          <button type="button" class="dh-nsa-scene-delete" data-nsa-scene-delete="${index}" aria-label="删除场景 ${index + 1}">×</button>
        </div>`).join('')}
      </div>` : '')}
      ${progressPanel}
      ${failurePanel}
      <div class="dh-nsa-scene-card">
        <button type="button" class="dh-nsa-scene-thumb dh-nsa-scene-main-preview" data-nsa-scene-preview="${selectedIndex}:0">
          ${mainUrl ? `<img src="${escapeHtml(thumbUrl(mainUrl, 560))}" alt="${escapeHtml(asset.name || `任务场景 ${selectedIndex + 1}`)}" loading="eager" decoding="async" fetchpriority="high">` : '空间'}
        </button>
        <div class="dh-nsa-scene-body">
          <div class="dh-nsa-scene-head">
            <div>
              <b>${escapeHtml(asset.name || `任务场景 ${selectedIndex + 1}`)}</b>
              <span>${escapeHtml([`场景 ${displaySceneIndex + 1}/${displaySceneTotal}`, `版本 r${asset.scene_revision || 1}`, asset.lock_strength ? `锁定强度：${asset.lock_strength}` : '', STRATEGY_LABELS[asset.view_strategy] || '', `${views.length || 1} 张空间参考`].filter(Boolean).join(' · '))}</span>
            </div>
            <em class="is-${escapeHtml(sceneVerification.tone)}">${escapeHtml(sceneVerification.label)}</em>
          </div>
          <div class="dh-nsa-scene-provenance ${isV7Atlas ? 'is-v7' : 'is-legacy'}">
            <b>${isV7Atlas ? '新版 V7 空间资产正在使用' : '非完整 V7 空间资产'}</b>
            <span>${isV7Atlas
              ? `1 张 2×2 母图 → 本地裁切 4 个透视视角 + 1 张俯视布局 · 图片模型调用 ${Number(asset.space_asset_contract?.provider_image_call_count || asset.view_acquisition?.provider_image_call_count || 2)} 次${atlasHash ? ` · 母图校验 ${atlasHash.slice(0, 12)}` : ''}`
              : '当前资产缺少 V7 母图血缘或新版生成协议，未升级前不会作为完整空间锁进入关键帧。'}</span>
          </div>
          ${repairFailure ? `<div class="dh-nsa-scene-repair-error"><b>上次修复失败，当前仍显示版本 r${asset.scene_revision || 1}</b><span>${escapeHtml(repairFailure)}</span></div>` : ''}
          <div class="dh-nsa-scene-lock-metrics" aria-label="场景锁定验证指标">
            <div class="${assessment.requirementQa.pass === true ? 'is-pass' : 'is-pending'}"><small>需求符合度</small><b>${escapeHtml(metricValue(assessment.requirementScore))}</b><span>布局、材质、互动与禁止项</span></div>
            <div class="${assessment.photographicRealismQa.pass === true ? 'is-pass' : 'is-pending'}"><small>摄影真实性</small><b>${escapeHtml(metricValue(assessment.photographicRealismScore))}</b><span>真实材质、自然变化与相机光学</span></div>
            <div class="${assessment.cameraDesignQa.pass === true ? 'is-pass' : 'is-pending'}"><small>机位设计</small><b>${escapeHtml(metricValue(assessment.cameraDesignScore))}</b><span>逐机位参数、方向与需求映射</span></div>
            <div class="${assessment.crossViewQa.pass === true ? 'is-pass' : 'is-pending'}"><small>跨视图一致性</small><b>${escapeHtml(metricValue(assessment.crossViewScore))}</b><span>结构、材质与场景身份</span></div>
            <div class="${assessment.spatialQa.pass === true && assessment.layoutAvailable ? 'is-pass' : 'is-pending'}"><small>空间覆盖度</small><b>${escapeHtml(metricValue(assessment.spatialScore))}</b><span>${assessment.layoutAvailable ? '俯视拓扑与机位覆盖' : '缺少可用俯视布局'}</span></div>
          </div>
          ${cameraAcceptanceHtml(asset, assessment)}
          ${!qaPassed && state.taskId ? `<div class="dh-nsa-verification-row"><span class="dh-nsa-verification-badge is-${escapeHtml(sceneVerification.tone)}">${escapeHtml(verificationBadgeText)}</span>${canUpgrade ? `<button type="button" class="dh-btn dh-btn-primary dh-btn-sm" data-nsa-scene-upgrade="${escapeHtml(asset.scene_id || asset.id)}">升级当前空间（2 次图片调用）</button>` : ''}${canReverify ? `<button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-nsa-scene-verify="${escapeHtml(asset.scene_id || asset.id)}">再次验证（不重新生成）</button>` : ''}${canRepair ? `<button type="button" class="dh-btn dh-btn-primary dh-btn-sm" data-nsa-scene-repair="${escapeHtml(asset.scene_id || asset.id)}">自动修复：${escapeHtml(repairLabels)}（${repairCount} 张）</button>` : ''}${canRebuildAtlas ? `<button type="button" class="dh-btn dh-btn-primary dh-btn-sm" data-nsa-scene-repair="${escapeHtml(asset.scene_id || asset.id)}">重建空间母图与布局（2 次图片调用）</button>` : ''}${canUpgrade ? '<span class="dh-nsa-verification-hint">系统会先补齐空间设定，再生成一张 2×2 母图、本地裁切 4 个视角并生成 1 张俯视布局；旧版图片保留。</span>' : legacyUpgradeHint}${canReverify ? '<span class="dh-nsa-verification-hint">本操作只重试视觉审核，不会调用图片模型，也不会产生新的图片费用。</span>' : ''}${canRepair ? `<span class="dh-nsa-verification-hint">系统只重做：${escapeHtml(repairLabels)}，保留其余通过视图并自动复验。</span>` : ''}${canRebuildAtlas ? '<span class="dh-nsa-verification-hint">四个透视视角来自同一母图，不能单独重做某一格；本次会重建母图和俯视布局，避免视角之间身份漂移。</span>' : ''}</div>${verificationDetailsHtml(sceneVerification, escapeHtml)}` : ''}
          <div class="dh-nsa-scene-views">
            ${atlasUrl ? `<button type="button" class="dh-nsa-scene-view is-atlas" data-nsa-scene-preview="${selectedIndex}:atlas">
              <img src="${escapeHtml(thumbUrl(atlasUrl, 360))}" alt="V7 2×2 空间母图" loading="lazy" decoding="async">
              <b>V7 母图（2×2）</b>
            </button>` : ''}
            ${views.slice(0, 5).map((view, index) => {
              const url = view.url || view.image_url || '';
              return `<button type="button" class="dh-nsa-scene-view ${view.key === 'layout' ? 'is-layout' : ''}" data-nsa-scene-preview="${selectedIndex}:${index}">
                ${url ? `<img src="${escapeHtml(thumbUrl(url, 360))}" alt="${escapeHtml(view.label || `视角 ${index + 1}`)}" loading="lazy" decoding="async">` : ''}
                <b>${escapeHtml(view.label || VIEW_LABELS[view.key] || `视角 ${index + 1}`)}</b>
              </button>`;
            }).join('')}
          </div>
        </div>
      </div>
    </div>`;
  }

  function payload(state = {}) {
    return normalizeAssets(state.sceneAssets || []);
  }

  function configInfoHtml({ sceneConfig = null, brief = '', subject = '', castMode = 'auto', formatCastMode = value => value } = {}) {
    const rows = sceneConfig ? [
      ['广告主体', sceneConfig.advertised_subject],
      ['业务边界', sceneConfig.business_boundary],
      ['人物/主体模式', formatCastMode(sceneConfig.cast_mode || sceneConfig.castMode)],
      ['独立空间', Array.isArray(sceneConfig.spaces) ? sceneConfig.spaces.map(space => space.name || space.id || space.space_id).filter(Boolean).join('；') : ''],
      ['剧情策略', Array.isArray(sceneConfig.story_strategy) ? sceneConfig.story_strategy.join('；') : ''],
      ['禁止项', Array.isArray(sceneConfig.forbidden || sceneConfig.forbidden_elements) ? (sceneConfig.forbidden || sceneConfig.forbidden_elements).join('；') : ''],
    ] : [
      ['广告主体', subject || '按广告需求判断'],
      ['业务边界', brief ? '待 AI 根据当前广告需求确认，不继承其他任务。' : '待填写广告需求'],
      ['人物/主体模式', formatCastMode(castMode)],
      ['剧情策略', '待生成基础信息后确认'],
      ['禁止项', '按当前任务禁止项和高级设置判断'],
    ];
    return `<div class="dh-lux-asset-manifest${sceneConfig ? '' : ' is-draft'}">${rows.map(([key, value]) => `<div><b>${escapeHtml(key)}</b><span>${escapeHtml(value || '-')}</span></div>`).join('')}</div>`;
  }

  function plannedGenerationTarget(state = {}, { append = false } = {}) {
    const assets = Array.isArray(state.sceneAssets) ? state.sceneAssets : [];
    const plannedSpaces = Array.isArray(state.sceneConfig?.spaces) ? state.sceneConfig.spaces : [];
    const multiScene = state.sceneConfig?.scene_mode === 'multi' || plannedSpaces.length > 1;
    const currentIndex = selectedSceneAssetIndex(state, assets);
    const currentAsset = !append && currentIndex >= 0 ? assets[currentIndex] : null;
    const existingIds = new Set(assets.map(asset => clean(asset.space_id || asset.scene_id || asset.id, 120)));
    const hasExplicitPlanSelection = Object.prototype.hasOwnProperty.call(state, 'scenePlanSelectedIndex');
    const selectedSpace = hasExplicitPlanSelection
      ? (plannedSpaces[selectedPlanIndex(state, state.sceneConfig)] || null)
      : null;
    const selectedSpaceId = clean(selectedSpace?.space_id || selectedSpace?.id || selectedSpace?.scene_id || '', 120);
    const currentId = clean(currentAsset?.space_id || currentAsset?.scene_id || currentAsset?.id || selectedSpaceId, 120);
    const targetSpace = append
      ? plannedSpaces.find(space => !existingIds.has(clean(space.space_id || space.id || space.scene_id, 120)))
      : (selectedSpaceId
        ? selectedSpace
        : (currentId
          ? plannedSpaces.find(space => clean(space.space_id || space.id || space.scene_id, 120) === currentId)
          : plannedSpaces[0]));
    const targetSpaceId = clean(targetSpace?.space_id || targetSpace?.id || targetSpace?.scene_id || currentId, 120);
    return { currentAsset, multiScene, targetSpace, targetSpaceId };
  }

  function hydrate(state = {}, { request = {}, outputs = {}, response = {} } = {}) {
    const assets = normalizeAssets(
      outputs.scene_assets
      || response.scene_assets
      || request.scene_assets
      || request.sceneAssets
      || [],
    );
    state.sceneAssets = assets;
    const plan = normalizePlan(outputs.scene_config || response.scene_config || state.sceneConfig || {});
    const selected = plan.spaces[selectedPlanIndex(state, plan)] || null;
    if (selected) {
      state.sceneConfig = plan;
      state.scenePlanSelectedIndex = plan.spaces.findIndex(space => space.id === selected.id);
      state.scenePlanSelectedId = selected.id;
    }
    const spec = selected?.scene_spec || request.scene_spec || request.sceneSpec || outputs.context?.scene_spec || response.context?.scene_spec || null;
    applySpec(spec, { clearMissing: true });
    return assets;
  }

  async function generate({
    state,
    ensureTask,
    api,
    payload: buildPayload,
    normalizeBundle,
    renderAll,
    setBusy,
    setButtonBusy,
    toast,
    confirmAction,
    button,
    append = false,
    fullUpgrade = false,
  } = {}) {
    if (!state || typeof ensureTask !== 'function' || typeof api !== 'function') return false;
    const hasCurrentForm = sceneSpecControlsAvailable();
    const reconciled = reconcileSurfaceIntent(specPayload(), { syncControls: true });
    const sceneSpec = reconciled.spec;
    if (reconciled.changed) {
      toast?.(
        hasContinuousSurfaceIntent(sceneSpec)
          ? '检测到明确无缝要求，已采用“连续表面 + 隐藏拼缝”'
          : (hasSinglePrimarySurfaceIntent(sceneSpec)
            ? '已按当前文字锁定为 1 个主墙面；未明确要求无缝时不会继承旧的隐藏拼缝设置'
            : '已按当前文字清除旧的自动推断表面设置'),
        'info',
      );
    }
    if (hasCurrentForm) {
      const editedPlan = planPayload(state, sceneSpec);
      if (editedPlan) state.sceneConfig = editedPlan;
    }
    const totalViews = 5;
    const generationTarget = plannedGenerationTarget(state, { append });
    const targetSpaceId = generationTarget.targetSpaceId;
    const label = append ? '追加场景参考中...' : '生成场景参考中...';
    const startedAt = Date.now();
    const fallbackProgress = {
      mode: 'generate',
      total: totalViews,
      completed: 0,
      startedAt,
      percent: 8,
      scene_id: targetSpaceId || '',
      scene_name: generationTarget.targetSpace?.name || '',
      message: '任务正在提交，等待服务器返回每个视图的真实生成状态。',
    };
    state.sceneOperationFailure = null;
    if (!append) {
      state.taskStatus = 'working';
      state.taskStage = 'scene_asset';
      state.taskError = '';
      state.taskErrorCode = '';
    }
    const setProgressStage = () => {
      state.sceneGenerationProgress = liveSceneProgress(state, fallbackProgress);
      renderAll?.();
    };
    state.sceneGenerationProgress = liveSceneProgress(state, fallbackProgress);
    const timer = setInterval(setProgressStage, 1000);
    setBusy?.(true, label);
    setButtonBusy?.(button, true, label);
    renderAll?.();
    try {
      const taskId = await ensureTask();
      const body = typeof buildPayload === 'function' ? buildPayload() : {};
      const { currentAsset, multiScene, targetSpace } = generationTarget;
      if (multiScene && !targetSpaceId) {
        const error = new Error(append
          ? '场景计划中的独立空间都已生成；如需修改，请先选择对应场景再重新生成。'
          : '多场景计划缺少可生成的稳定空间 ID，已停止图片调用。');
        error.code = 'SCENE_GENERATION_TARGET_REQUIRED';
        throw error;
      }
      const targetSceneSpec = hasCurrentForm
        ? sceneSpec
        : (targetSpace?.scene_spec || targetSpace?.sceneSpec || sceneSpec);
      if (hasCurrentForm) assertCurrentSceneSpecSubmitted(sceneSpec, targetSceneSpec);
      // 用户点击生成就是本次付费请求的明确授权。直接恢复未知计费检查点，
      // 后端仍继续阻止后台自动重试和没有显式授权的非交互调用。
      const submitted = await api(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/scene-assets`, {
        method: 'POST',
        body: {
          ...body,
          scene_spec: targetSceneSpec,
          include_layout_view: requiresLayoutView(targetSceneSpec),
          view_strategy: 'atlas_2x2',
          scene_assets: payload(state),
          space_id: targetSpaceId || undefined,
          scene_id: targetSpaceId || undefined,
          acknowledge_billing_unknown: true,
          lock_strength: 'standard',
          require_complete_scene_spec: fullUpgrade === true,
        },
      });
      if (submitted.job) {
        window.NewStoryAdGenerationFlow?.adoptActiveGeneration?.(state, submitted.job, 'scene_asset', {});
        renderAll?.();
      }
      const r = submitted.job && window.NewStoryAdGenerationFlow?.waitForStage
        ? await window.NewStoryAdGenerationFlow.waitForStage(taskId, 'scene_asset', {
            api, normalizeBundle, renderAll, state,
          })
        : submitted;
      if (typeof normalizeBundle === 'function') normalizeBundle(r);
      state.sceneAssets = normalizeAssets(r.scene_assets || r.outputs?.scene_assets || r.bundle?.outputs?.scene_assets || []);
      const generatedIndex = targetSpaceId
        ? state.sceneAssets.findIndex(asset => clean(asset.space_id || asset.scene_id || asset.id, 120) === targetSpaceId)
        : -1;
      state.sceneSelectedIndex = generatedIndex >= 0
        ? generatedIndex
        : (append ? Math.max(0, state.sceneAssets.length - 1) : Math.max(0, selectedSceneAssetIndex(state, state.sceneAssets)));
      state.sceneGenerationProgress = null;
      state.sceneOperationFailure = null;
      renderAll?.();
      const updatedAsset = state.sceneAssets[state.sceneSelectedIndex] || {};
      const verificationResult = verificationView(updatedAsset);
      toast?.(
        verificationResult.tone === 'verified'
          ? (append ? '新场景参考已生成、自动验证并绑定当前任务' : '当前场景参考已生成、自动验证并绑定当前任务')
          : (verificationResult.message || verificationResult.label),
        verificationResult.tone === 'verified' ? 'success' : (verificationResult.tone === 'unavailable' ? 'warning' : 'error'),
      );
      return true;
    } catch (err) {
      state.sceneGenerationProgress = null;
      const failedTask = err?.data?.task || {};
      const failedProgress = failedTask.generation_progress || state.generationProgress || {};
      state.sceneOperationFailure = {
        ...failedProgress,
        scene_id: failedProgress.scene_id || targetSpaceId || '',
        scene_name: generationTarget.targetSpace?.name || '',
        message: failedProgress.message || failedTask.error || err.message || '场景参考生成失败',
        error_code: failedProgress.error_code || failedTask.error_code || err.code || '',
        support_id: failedProgress.support_id || failedTask.support_id || '',
      };
      renderAll?.();
      toast?.(err.message || '场景参考生成失败', err.code === 'USER_CANCELLED' ? 'info' : 'error');
      return false;
    } finally {
      clearInterval(timer);
      setButtonBusy?.(button, false);
      setBusy?.(false);
    }
  }

  async function verify({ state, api, normalizeBundle, renderAll, setButtonBusy, toast, button, sceneId } = {}) {
    if (!state?.taskId || !sceneId) return false;
    setButtonBusy?.(button, true, '验证中...');
    try {
      const response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(state.taskId)}/scene-assets/${encodeURIComponent(sceneId)}/verify`, { method: 'POST', body: {} });
      if (typeof normalizeBundle === 'function' && response.bundle) normalizeBundle(response);
      state.sceneAssets = normalizeAssets(response.scene_assets || response.outputs?.scene_assets || state.sceneAssets || []);
      renderAll?.();
      const updated = state.sceneAssets.find(asset => String(asset.scene_id || asset.id) === String(sceneId)) || response.scene_asset || {};
      const result = verificationView(updated);
      const pendingTones = new Set(['unverified', 'appearance', 'upgrade', 'partial']);
      const toastType = result.tone === 'verified'
        ? 'success'
        : (result.tone === 'unavailable' || pendingTones.has(result.tone) ? 'warning' : 'error');
      const toastMessage = pendingTones.has(result.tone)
        ? `${result.label}，请查看场景卡内的验收说明`
        : (result.message || result.label);
      toast?.(toastMessage, toastType);
      return result.tone === 'verified';
    } catch (error) {
      toast?.(error.message || '场景重新验证失败', 'error');
      return false;
    } finally {
      setButtonBusy?.(button, false);
    }
  }

  async function repair({
    state,
    api,
    payload: buildPayload,
    normalizeBundle,
    renderAll,
    setBusy,
    setButtonBusy,
    toast,
    button,
    sceneId,
  } = {}) {
    if (!state?.taskId || !sceneId || typeof api !== 'function') return false;
    const currentIndex = (state.sceneAssets || []).findIndex(asset => String(asset.scene_id || asset.id) === String(sceneId));
    const currentAsset = currentIndex >= 0 ? state.sceneAssets[currentIndex] : null;
    const repairViewKeys = currentAsset?.repair_plan?.action === 'regenerate_failed_views'
      && Array.isArray(currentAsset?.repair_plan?.view_keys)
      ? currentAsset.repair_plan.view_keys.filter(key => VIEW_LABELS[key])
      : [];
    if (!repairViewKeys.length) {
      toast?.('没有明确的失败视图，已停止图片重生成；请先执行再次验证。', 'warning');
      return false;
    }
    const total = repairViewKeys.length;
    const startedAt = Date.now();
    const fallbackProgress = {
      mode: 'repair',
      total,
      completed: 0,
      startedAt,
      percent: 8,
      view_keys: repairViewKeys,
      view_states: repairViewKeys.map(key => ({ key, label: VIEW_LABELS[key], status: 'queued' })),
      message: `本次将重做 ${total} 张：${repairViewKeys.map(key => VIEW_LABELS[key]).join('、')}。正在等待服务器返回真实生成状态。`,
    };
    const updateProgress = () => {
      state.sceneGenerationProgress = liveSceneProgress(state, fallbackProgress);
      renderAll?.();
    };
    updateProgress();
    const timer = setInterval(updateProgress, 1000);
    setBusy?.(true, '自动修复场景中...');
    setButtonBusy?.(button, true, '修复并复验中...');
    try {
      const body = typeof buildPayload === 'function' ? buildPayload() : {};
      const submitted = await api(`/api/new-story-ad/tasks/${encodeURIComponent(state.taskId)}/scene-assets/${encodeURIComponent(sceneId)}/repair`, {
        method: 'POST',
        body: {
          ...body,
          scene_spec: reconcileSurfaceIntent(specPayload(), { syncControls: true }).spec,
        },
      });
      if (submitted.job) {
        window.NewStoryAdGenerationFlow?.adoptActiveGeneration?.(state, submitted.job, 'scene_asset', {});
        renderAll?.();
      }
      const response = submitted.job && window.NewStoryAdGenerationFlow?.waitForStage
        ? await window.NewStoryAdGenerationFlow.waitForStage(state.taskId, 'scene_asset', {
            api, normalizeBundle, renderAll, state,
          })
        : submitted;
      if (typeof normalizeBundle === 'function') normalizeBundle(response);
      state.sceneAssets = normalizeAssets(response.scene_assets || response.outputs?.scene_assets || response.bundle?.outputs?.scene_assets || state.sceneAssets || []);
      state.sceneSelectedIndex = Math.max(0, state.sceneAssets.findIndex(asset => String(asset.scene_id || asset.id) === String(sceneId)));
      state.sceneGenerationProgress = null;
      renderAll?.();
      const updated = state.sceneAssets[state.sceneSelectedIndex] || {};
      const result = verificationView(updated);
      toast?.(
        result.tone === 'verified' ? '失败视图已修复并通过自动验证' : (result.message || result.label),
        result.tone === 'verified' ? 'success' : (result.tone === 'unavailable' ? 'warning' : 'error'),
      );
      return result.tone === 'verified';
    } catch (error) {
      state.sceneGenerationProgress = null;
      const failedTask = error?.data?.task || {};
      const failedProgress = failedTask.generation_progress || state.generationProgress || {};
      state.sceneOperationFailure = {
        ...failedProgress,
        scene_id: failedProgress.scene_id || sceneId,
        message: failedProgress.message || failedTask.error || error.message || '场景自动修复失败',
        error_code: failedProgress.error_code || failedTask.error_code || error.code || '',
        support_id: failedProgress.support_id || failedTask.support_id || '',
      };
      renderAll?.();
      toast?.(error.message || '场景自动修复失败', error.code === 'USER_CANCELLED' ? 'info' : 'error');
      return false;
    } finally {
      clearInterval(timer);
      setButtonBusy?.(button, false);
      setBusy?.(false);
    }
  }

  window.NewStoryAdSceneAssets = {
    normalizeAssets,
    sceneLockAssessment,
    completeSceneViewEvidence,
    selectedSceneAssetIndex,
    selectedSceneUpgradeRequired,
    resumableUpgradeProgress,
    thumbUrl,
    specPayload,
    hasContinuousSurfaceIntent,
    hasSinglePrimarySurfaceIntent,
    reconcileSurfaceIntent,
    requiresLayoutView,
    sceneProgressView,
    applySpec,
    clearSpecInputs,
    normalizePlan,
    applyPlan,
    planPayload,
    preserveCurrentSpecInPlan,
    sceneSpecFingerprint,
    sceneSpecFingerprint,
    assertCurrentSceneSpecSubmitted,
    selectPlanSpace,
    selectPlanSpaceById,
    addDraftSpace,
    addDraft,
    applySpecSuggestion,
    syncSpecSelectionState,
    render,
    payload,
    configInfoHtml,
    plannedGenerationTarget,
    hydrate,
    generate,
    repair,
    verify,
  };
  const STRATEGY_LABELS = {
    single_view: '单视角',
    image_derived: '母场景图片派生',
    atlas_2x2: '2×2 空间母资产',
    orbit_extract: '环绕视频抽帧',
    path_extract: '路径视频抽帧',
    uploaded_views: '用户多视图',
  };
})();
