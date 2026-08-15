import { confirmDialog, setButtonBusy, toast } from '../components/ui.js?v=20260815-asset-ui-v61';

export function scenePlanBlockedView(eligibility = {}, generationActive = false) {
  const failed = (eligibility.issues || []).includes('task_current_planning_stage_failed');
  return `<section class="card asset-visual-next-step is-blocked" role="status"><div><span class="status-tag is-danger">场景方案${failed ? '更新失败' : '需要更新'}</span><h2>${failed ? '重新建立' : '更新'}当前内容的场景方案</h2><p>本次只更新场景文字方案，不修改人物身份、人物图片和人物造型；已有站位绑定无法安全延续时会阻止发布，也不会生成图片。</p></div><div class="asset-visual-next-actions"><button class="btn${generationActive ? '' : ' primary'}" type="button" data-update-scene-plan ${generationActive ? 'disabled' : ''}>${generationActive ? '正在更新场景方案' : '更新场景方案'}</button><button class="btn" type="button" disabled>文字方案确认后，再单独生成图片</button></div></section>`;
}

export function bindScenePlanUpdate(host, context) {
  host.querySelector('[data-update-scene-plan]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if (!await confirmDialog('本次只更新场景文字方案，不修改人物身份、人物图片或人物造型。若已有站位绑定无法安全延续，系统会阻止发布。', { title: '更新场景方案', confirmText: '确认更新场景方案' })) return;
    try {
      setButtonBusy(button, true, '正在更新场景方案…', { elapsed: true });
      await context.store.runStage('scene-plan');
      toast('场景方案更新已提交；人物方案和人物资产不会被改动。', 'success');
      await context.refreshShell();
    } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(button, false); }
  });
}
