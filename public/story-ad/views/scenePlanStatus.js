import { setButtonBusy, toast } from '../components/ui.js?v=20260826-production-v230r';

export function scenePlanBlockedView(eligibility = {}, generationActive = false) {
  return `<section class="scene-production-start" data-scene-production-start><div><h2>生成场景</h2><p>先根据已确认剧情整理场景数量和每个场景的生图提示词，再由你逐个确认生成场景画面；不修改人物身份、人物图片和人物造型。</p></div><button class="btn primary" type="button" data-update-scene-plan ${generationActive ? 'disabled' : ''}>${generationActive ? '正在生成场景提示词…' : '生成场景'}</button></section>`;
}

export function bindScenePlanUpdate(host, context) {
  host.querySelector('[data-update-scene-plan]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, '正在生成场景提示词…', { elapsed: true });
      await context.store.runStage('scene-plan');
      toast('场景提示词正在生成，人物档案不会被改动。', 'success');
    } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(button, false); }
  });
}
