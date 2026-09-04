import { setButtonBusy, toast } from '../components/ui.js?v=20260905-production-v473';

export function scenePlanBlockedView(eligibility = {}, generationActive = false, options = {}) {
  const automatic = options.automatic === true;
  return `<section class="scene-production-start" data-scene-production-start><div><h2>${automatic ? '正在整理正式场景提示词' : '重新生成场景提示词'}</h2><p>${automatic ? '页面已先展示根据剧情整理的场景数量与独立提示词预览；正式规划会自动补齐空间、材质、光线和人物路线，再由你逐个确认生成场景画面。' : '上次场景提示词生成没有完成，可以从已保留的人物与道具方案继续；系统会先根据已确认剧情整理场景数量和每个场景的生图提示词，再由你逐个确认生成场景画面；不修改人物身份、人物图片和人物造型。'}</p></div>${automatic ? '<span class="scene-plan-auto-state">自动处理中</span>' : `<button class="btn primary" type="button" data-update-scene-plan ${generationActive ? 'disabled' : ''}>${generationActive ? '正在生成场景提示词…' : '重新生成场景提示词'}</button>`}</section>`;
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
