export async function submitUnifiedProductionAssets({ button, bundle, request, confirmDialog, store, setButtonBusy, toast }) {
  try {
    setButtonBusy(button, true, '正在核对生成计划…', { elapsed: true });
    const plan = await request(`/api/new-story-ad/tasks/${encodeURIComponent(bundle.project.id)}/production-assets/plan`, {
      method: 'POST', body: { spatial_mode: 'multi_view', generate_panoramas: false }, timeoutMs: 120000,
    });
    await store.runStage('production-assets', { spatial_mode: 'multi_view', generate_panoramas: false, cost_confirmation: true,
      plan_fingerprint: plan.plan_fingerprint });
    toast('全部制作资产已进入统一生成任务；请查看页面顶部进度。', 'success');
    return true;
  } catch (error) {
    toast(error.message, 'danger');
    return false;
  } finally {
    setButtonBusy(button, false);
  }
}
