import { renderSceneWorldWorkspace, bindSceneWorldWorkspace } from './sceneWorldView.js?v=20260822-reference-extended-analysis-v141';
import { escapeHtml, setButtonBusy, toast } from '../components/ui.js?v=20260822-reference-extended-analysis-v141';
import { authorizeBillingReviews, confirmBillingAwareAction } from './assetCenterBillingRetry.js?v=20260822-reference-extended-analysis-v141';
import { bindScenePlanUpdate, scenePlanBlockedView } from './scenePlanStatus.js?v=20260822-reference-extended-analysis-v141';

function sceneGenerationQueue(bundle = {}, scenePlanReady = true) {
  const scenes = Array.isArray(bundle.assets?.scenes) ? bundle.assets.scenes : [];
  if (!scenes.length) return '<section class="card"><h2>场景生成队列</h2><p>尚未建立场景文字方案。</p></section>';
  return `<section class="card scene-generation-queue"><div class="section-title"><h2>场景生成队列</h2><span>${scenes.length}</span></div><p>每次只提交一个场景；人物出场、造型、年龄、机位和地点沿革确认后再生成。</p><div class="scene-queue-grid">${scenes.map(scene => {
    const generated = Boolean(scene.layout?.image_url || scene.view_images?.length || scene.cameras?.some(camera => camera.image_url));
    return `<article class="asset-card"><div><small>${generated ? '已有场景资产' : '等待单独生成'}</small><h3>${escapeHtml(scene.name || '未命名场景')}</h3><p>${escapeHtml(scene.description || scene.scene_spec?.description || '')}</p></div><button class="btn ${generated ? '' : 'primary'}" type="button" data-generate-base-scene="${escapeHtml(scene.id || scene.scene_id || '')}" ${scenePlanReady ? '' : 'disabled title="请先更新场景方案"'}>${generated ? '核对后重新生成' : '生成这个场景'}</button></article>`;
  }).join('')}</div></section>`;
}

export async function mount(host, context) {
  const { bundle, store } = context;
  const planEligibility = bundle?.navigation?.asset_plan_eligibility || {};
  const scenePlanEligibility = planEligibility.scene || planEligibility;
  const scenePlanReady = scenePlanEligibility.eligible === true;
  const generationActive = !!bundle?.project?.active_generation_id;
  host.innerHTML = `<section class="view-head"><div><h1>场景世界</h1><p>根据已确认剧情和人物，核对地点、时代、空间结构、机位与人物出场关系，再按场景单独生成视觉资产。</p></div><span class="status-tag is-neutral">第 4 步 · 场景规划</span></section>
    <div class="guide"><b>操作方法</b>　①核对剧情中的地点与时代　②确认空间结构和人物出场　③按场景单独生成视觉资产　④进入线稿与分镜</div>
    ${scenePlanReady ? '' : scenePlanBlockedView(scenePlanEligibility, generationActive)}
    ${sceneGenerationQueue(bundle, scenePlanReady)}
    ${renderSceneWorldWorkspace(bundle)}
    <section class="step-completion-card ${scenePlanReady ? 'is-ready' : ''}"><div><b>场景规划承接已确认剧情</b><span>${scenePlanReady ? '确认文字规划即可进入线稿与分镜；场景图片可按场景分别生成，不要求一次补齐全部缺失内容。' : '请先完成场景文字方案更新；已确认的人物方案和人物资产不会被改写。'}</span></div><button class="btn primary" type="button" data-open-script ${scenePlanReady ? '' : 'disabled'}>进入第 5 步：线稿与分镜</button></section>`;
  bindSceneWorldWorkspace(host, bundle, store);
  bindScenePlanUpdate(host, context);
  host.querySelectorAll('[data-generate-base-scene]').forEach(button => button.addEventListener('click', async () => {
    const id = button.dataset.generateBaseScene;
    const scene = (bundle.assets?.scenes || []).find(item => String(item.id || item.scene_id || '') === id);
    if (!scene) return;
    const generated = Boolean(scene.layout?.image_url || scene.view_images?.length || scene.cameras?.some(camera => camera.image_url));
    const confirmation = await confirmBillingAwareAction({
      bundle,
      lane: 'scenes',
      sceneId: id,
      title: generated ? '重新生成单个场景' : '生成单个场景',
      message: `本次只提交“${scene.name || '当前场景'}”，不会连带生成其他场景。生成前将锁定地点沿革、人物出场顺序、造型、年龄和机位。`,
      confirmText: generated ? '确认重新生成' : '确认生成',
    });
    if (!confirmation.accepted) return;
    try {
      setButtonBusy(button, true, '正在提交单个场景…', { elapsed: true });
      await authorizeBillingReviews({ bundle, lane: 'scenes', sceneId: id, reviewBatch: confirmation.reviewBatch });
      const requestKey = `${bundle.project.id}:scene:${id}:${globalThis.crypto?.randomUUID?.() || Date.now()}`;
      await store.runStage('scene-assets', { space_id: id, scene_id: id, name: scene.name, regenerate: generated, request_key: requestKey });
      toast('单个场景已提交，其他场景没有调用模型。', 'success');
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  }));
  host.querySelector('[data-open-script]')?.addEventListener('click', () => context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=storyboard`));
}
