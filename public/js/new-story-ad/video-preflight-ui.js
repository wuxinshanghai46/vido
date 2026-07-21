(() => {
  /** 两阶段确认：先选连续生成单元，再读取 scoped preflight 并确认精确费用。 */
  async function runScopedPreflight(options = {}) {
    const {
      mode = 'economy', onlyIndex = null, ensureTask, api, toast, confirmAction, videoReview,
      escapeHtml, loadAudioPlan, bindAudio, readAudio, applyAudio, stopAudio,
    } = options;
    let id = '';
    let data = null;
    try {
      id = await ensureTask();
      const onlyQuery = Number.isInteger(Number(onlyIndex)) && onlyIndex !== null ? `&only_index=${Number(onlyIndex)}` : '';
      data = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/video/preflight?mode=${encodeURIComponent(mode)}${onlyQuery}&_t=${Date.now()}`);
    } catch (error) {
      toast(error.message || '暂时无法读取生成前方案，本次没有提交视频模型', 'error'); return null;
    }
    const preflight = data.preflight || {};
    const blocked = Array.isArray(preflight.blockers) && preflight.blockers.length > 0;
    const zeroCostOnly = blocked && Number(preflight.zero_cost_action_count || 0) > 0;
    if (!videoReview?.selectionHtml || !videoReview?.readSelection) {
      toast('生成单元选择组件未就绪，本次没有提交视频模型', 'error'); return null;
    }
    if (blocked && !zeroCostOnly) {
      await confirmAction({ title: '生成通道已暂停', summary: preflight.blockers.map(item => item.message).join('；'), description: '当前没有可安全执行的生成单元，本次不会提交视频模型。', confirmLabel: '关闭', cancelLabel: '返回', tone: 'danger' });
      return null;
    }
    const selected = await confirmAction({
      title: mode === 'quality' ? '选择整条广告的生成单元' : '选择本次重做单元',
      summary: `候选方案预计付费提交 ${Number(preflight.paid_unit_count || 0)} 个连续生成单元；成员镜头只用于审片。`,
      description: '先明确勾选本次要生成或重做的单元。页面不会默认全选，未选择时不会提交。',
      confirmLabel: '按所选范围重新计算费用', cancelLabel: '取消', tone: blocked ? 'danger' : 'primary',
      facts: [
        { value: String(Number(preflight.paid_unit_count || 0)), label: '可选付费单元', tone: 'warning' },
        { value: String(Number(preflight.local_unit_count || 0)), label: '可选本地单元', tone: 'pass' },
        { value: '0', label: '自动重试', tone: 'pass' },
      ],
      customHtml: videoReview.selectionHtml(preflight, escapeHtml),
      onMount: modal => videoReview.bindSelection(modal, preflight),
      readSelection: modal => videoReview.readSelection(modal, preflight),
      note: '下一步会向服务器读取仅包含所选镜头的精确预检，并要求再次确认精确费用。点击取消不会改变按钮和任务状态。',
    });
    if (!selected) return null;
    let scopedData = null;
    try {
      scopedData = await api(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/video/preflight?mode=${encodeURIComponent(mode)}&only_indexes=${encodeURIComponent(selected.indexes.join(','))}&_t=${Date.now()}`);
    } catch (error) {
      toast(error.message || '无法读取所选范围的精确费用，本次没有提交视频模型', 'error'); return null;
    }
    const scopedPreflight = scopedData?.preflight || {};
    const scopedUnits = Array.isArray(scopedPreflight.units) ? scopedPreflight.units : [];
    const scopedSelection = videoReview.selectionSummary(scopedPreflight, scopedUnits.map(unit => unit.id));
    if (scopedSelection.indexes.join(',') !== selected.indexes.join(',')) {
      toast('服务器返回的精确预检范围与所选单元不一致，本次没有提交视频模型', 'error'); return null;
    }
    const scopedBlocked = Array.isArray(scopedPreflight.blockers) && scopedPreflight.blockers.length > 0;
    const scopedZeroCostOnly = scopedBlocked && Number(scopedPreflight.zero_cost_action_count || 0) > 0;
    const audioPlan = mode === 'quality' && !scopedBlocked && loadAudioPlan ? await loadAudioPlan() : null;
    const accepted = await confirmAction({
      title: '确认精确执行范围与费用',
      summary: scopedBlocked ? scopedPreflight.blockers.map(item => item.message).join('；') : '费用已按所选连续生成单元重新计算。',
      description: '请再次核对付费单元、计费秒数、预计费用和最高费用。确认后只提交这份 scoped preflight。',
      confirmLabel: scopedZeroCostOnly ? '确认执行所选本地单元' : '确认提交所选生成单元', cancelLabel: '返回修改', tone: scopedBlocked ? 'danger' : 'primary',
      customHtml: [videoReview.costConfirmationHtml(scopedPreflight, escapeHtml), audioPlan ? options.audioHtml(audioPlan, escapeHtml) : ''].join(''),
      onMount: modal => { if (audioPlan) bindAudio(modal, audioPlan); },
      readSelection: modal => {
        const cost = videoReview.readCostConfirmation(modal, scopedPreflight); if (cost.error) return cost;
        const audio = audioPlan ? readAudio(modal, audioPlan) : { value: {} };
        return audio.error ? audio : { value: { ...(audio.value || {}), videoSelection: cost.value } };
      },
      note: '自动付费重试固定为 0；复审未通过也不会自动付费重做。若内容或所选范围变化，必须重新预检和确认。',
    });
    stopAudio?.();
    if (!accepted || (scopedBlocked && !scopedZeroCostOnly)) return null;
    if (audioPlan) try { await applyAudio(accepted); } catch (error) {
      toast(error.message || '声音配置没有准备完成，本次没有提交视频模型', 'error'); return null;
    }
    const scopedCostPlan = scopedPreflight.cost_plan || {};
    return {
      preflight: scopedPreflight, zeroCostOnly: scopedZeroCostOnly,
      costPlanFingerprint: scopedZeroCostOnly ? '' : (scopedCostPlan.fingerprint || ''),
      confirmedCostLimitRmb: scopedZeroCostOnly ? 0 : Number(scopedCostPlan.maximum_cost_rmb || 0),
      complexityReviewConfirmed: !scopedZeroCostOnly,
      selectedIndexes: accepted.videoSelection?.indexes || [], selectedUnitIds: accepted.videoSelection?.unitIds || [], selectedCost: accepted.videoSelection || null,
    };
  }

  const api = { runScopedPreflight };
  if (typeof window !== 'undefined') window.NewStoryAdVideoPreflightUi = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
