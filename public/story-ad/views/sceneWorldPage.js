import { renderSceneWorldWorkspace, bindSceneWorldWorkspace } from './sceneWorldView.js?v=20260813-ui-v228';
import { escapeHtml, setButtonBusy, toast } from '../components/ui.js?v=20260813-ui-v228';
import { authorizeBillingReviews, confirmBillingAwareAction } from './assetCenterBillingRetry.js?v=20260813-ui-v228';

function sceneGenerationQueue(bundle = {}) {
  const scenes = Array.isArray(bundle.assets?.scenes) ? bundle.assets.scenes : [];
  if (!scenes.length) return '<section class="card"><h2>场景生成队列</h2><p>尚未建立场景文字方案。</p></section>';
  return `<section class="card scene-generation-queue"><div class="section-title"><h2>场景生成队列</h2><span>${scenes.length}</span></div><p>每次只提交一个场景；人物出场、造型、年龄、机位和地点沿革确认后再生成。</p><div class="asset-grid">${scenes.map(scene => {
    const generated = Boolean(scene.layout?.image_url || scene.view_images?.length || scene.cameras?.some(camera => camera.image_url));
    return `<article class="asset-card"><div><small>${generated ? '已有场景资产' : '等待单独生成'}</small><h3>${escapeHtml(scene.name || '未命名场景')}</h3><p>${escapeHtml(scene.description || scene.scene_spec?.description || '')}</p></div><button class="btn ${generated ? '' : 'primary'}" type="button" data-generate-base-scene="${escapeHtml(scene.id || scene.scene_id || '')}">${generated ? '核对后重新生成' : '生成这个场景'}</button></article>`;
  }).join('')}</div></section>`;
}

export async function mount(host, context) {
  const { bundle, store } = context;
  host.innerHTML = `<section class="view-head"><div><h1>场景世界</h1><p>先确认地点、跨时代关系、空间结构、机位、人物出场顺序和造型，再按场景单独生成视觉资产。</p></div><span class="status-tag is-neutral">第 3 步 · 场景规划</span></section>
    <div class="guide"><b>操作方法</b>　①核对场景与地点血缘　②确认人物出场、造型、年龄和机位　③按场景单独生成视觉资产　④进入剧本</div>
    ${sceneGenerationQueue(bundle)}
    ${renderSceneWorldWorkspace(bundle)}
    <section class="step-completion-card is-ready"><div><b>场景规划独立于人物资产</b><span>确认文字规划即可进入剧本；场景图片可按场景分别生成，不要求一次补齐全部缺失内容。</span></div><button class="btn primary" type="button" data-open-script>进入第 4 步：剧本</button></section>`;
  bindSceneWorldWorkspace(host, bundle, store);
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
      await store.runStage('scene-assets', { space_id: id, scene_id: id, name: scene.name, regenerate: generated });
      toast('单个场景已提交，其他场景没有调用模型。', 'success');
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  }));
  host.querySelector('[data-open-script]')?.addEventListener('click', () => context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=plot`));
}
