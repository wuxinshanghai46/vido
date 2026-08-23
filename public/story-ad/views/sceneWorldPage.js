import { renderSceneWorldWorkspace, bindSceneWorldWorkspace } from './sceneWorldView.js?v=20260824-production-v201z';
import { escapeHtml } from '../components/ui.js?v=20260824-production-v201z';
import { bindScenePlanUpdate, scenePlanBlockedView } from './scenePlanStatus.js?v=20260824-production-v201z';

function sceneGenerationQueue(bundle = {}) {
  const scenes = Array.isArray(bundle.assets?.scenes) ? bundle.assets.scenes : [];
  if (!scenes.length) return '<section class="card"><h2>场景资产核对</h2><p>统一制作图谱尚未建立场景。</p></section>';
  return `<section class="card scene-generation-queue"><div class="section-title"><h2>场景资产核对</h2><span>${scenes.length}</span></div><p>这里仅查看统一制作图谱生成的场景、机位与全景；如需修改，请回到资产中心修改设定后重新执行“生成全部制作资产”。</p><div class="scene-queue-grid">${scenes.map(scene => {
    const generated = Boolean(scene.layout?.image_url || scene.view_images?.length || scene.cameras?.some(camera => camera.image_url));
    return `<article class="asset-card"><div><small>${generated ? '已进入统一制作图谱' : '统一制作资产待补齐'}</small><h3>${escapeHtml(scene.name || '未命名场景')}</h3><p>${escapeHtml(scene.description || scene.scene_spec?.description || '')}</p></div><span class="status-tag ${generated ? 'is-ready' : 'is-neutral'}">${generated ? '场景资产已就绪' : '请返回资产中心统一生成'}</span></article>`;
  }).join('')}</div></section>`;
}

export async function mount(host, context) {
  const { bundle, store } = context;
  const planEligibility = bundle?.navigation?.asset_plan_eligibility || {};
  const scenePlanEligibility = planEligibility.scene || planEligibility;
  const scenePlanReady = scenePlanEligibility.eligible === true;
  const graphReady = bundle.outputs?.production_graph_v1?.validation?.status === 'ready';
  const generationActive = !!bundle?.project?.active_generation_id;
  host.innerHTML = `<section class="view-head"><div><h1>场景世界</h1><p>查看统一制作图谱中的地点、时代、空间结构、360°全景、机位与人物出场关系。</p></div><span class="status-tag is-neutral">第 4 步 · 场景核对</span></section>
    <div class="guide"><b>操作方法</b>　①核对剧情中的地点与时代　②查看空间结构、360°全景和人物出场　③确认机位与衔接　④进入线稿与分镜</div>
    ${scenePlanReady ? '' : scenePlanBlockedView(scenePlanEligibility, generationActive)}
    ${sceneGenerationQueue(bundle)}
    ${renderSceneWorldWorkspace(bundle)}
    <section class="step-completion-card ${graphReady ? 'is-ready' : ''}"><div><b>场景世界由统一制作图谱承接</b><span>${graphReady ? '人物、造型、配饰、场景、全景、机位和逐镜绑定均已锁定，可以进入线稿与分镜。' : '统一制作图谱尚未完整，请返回资产中心一次补齐；这里不再启动任何旧的单项生成任务。'}</span></div><button class="btn primary" type="button" data-open-script ${graphReady ? '' : 'disabled'}>进入第 5 步：线稿与分镜</button></section>`;
  bindSceneWorldWorkspace(host, bundle, store);
  bindScenePlanUpdate(host, context);
  host.querySelector('[data-open-script]')?.addEventListener('click', () => context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=storyboard`));
}
