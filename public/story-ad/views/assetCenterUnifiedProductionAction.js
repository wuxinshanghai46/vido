export async function submitUnifiedProductionAssets({ button, bundle, request, confirmDialog, store, setButtonBusy, toast }) {
  try {
    setButtonBusy(button, true, '正在核对生成计划…', { elapsed: true });
    const plan = await request(`/api/new-story-ad/tasks/${encodeURIComponent(bundle.project.id)}/production-assets/plan`, {
      method: 'POST', body: { generate_panoramas: true, confirmed_cost_limit_rmb: 10 }, timeoutMs: 120000,
    });
    const calls = Number(plan.estimated_model_calls?.total_max || 0);
    const paidCalls = Number(plan.estimated_paid_image_calls_max || 0);
    const visualCost = Number(plan.estimated_visual_cost_max_rmb || 0).toFixed(2);
    const accepted = await confirmDialog(`本次会生成完整人物、穿搭配饰、随身物、动作表情、场景母图、360°全景、机位和逐镜执行合同。服务端保守预估最多 ${calls} 次模型调用，其中付费图片最多 ${paidCalls} 次、视觉费用上限约 ${visualCost} 元；超过本次 10 元授权上限会在图片模型调用前停止。`, {
      title: '生成全部制作资产', confirmText: '确认开始生成',
    });
    if (!accepted) return false;
    await store.runStage('production-assets', { generate_panoramas: true, cost_confirmation: true,
      confirmed_cost_limit_rmb: 10, plan_fingerprint: plan.plan_fingerprint });
    toast('全部制作资产已进入统一生成任务；请查看页面顶部进度。', 'success');
    return true;
  } catch (error) {
    toast(error.message, 'danger');
    return false;
  } finally {
    setButtonBusy(button, false);
  }
}
