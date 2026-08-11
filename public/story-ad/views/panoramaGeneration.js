import { request } from '../api.js?v=20260811-ui-v184';
import { toast } from '../components/ui.js?v=20260811-ui-v184';
import { confirmDialog } from '../components/dialog.js?v=20260811-ui-v184';

const rows = value => Array.isArray(value) ? value.filter(Boolean) : [];

function worldById(bundle, id) {
  return rows(bundle?.scene_worlds).find(world => String(world.id) === String(id));
}

function matching(root, selector, key, value) {
  return [...root.querySelectorAll(selector)].filter(item => item.dataset[key] === String(value));
}

/** 始终先读取服务端计划；提交时由服务端来源指纹生成持久幂等键。 */
export async function runPanoramaGeneration({ root, bundle, store, worldId } = {}) {
  const world = worldById(bundle, worldId);
  if (!world) return toast('没有找到当前场景，请刷新资产中心后重试。', 'danger');
  let plan;
  try {
    plan = await request(`/api/new-story-ad/tasks/${encodeURIComponent(bundle.project.id)}/scene-assets/${encodeURIComponent(world.id)}/panorama/plan`, {
      method: 'GET',
      timeoutMs: 30000,
    });
  } catch (error) {
    return toast(`无法取得最新调用计划：${error.message}`, 'danger');
  }
  if (plan.blocked) {
    return toast('上次供应商提交或QA状态仍未核对，系统已阻止重复付费。请先完成计费状态恢复。', 'danger');
  }
  const calls = plan.model_call_plan || {};
  const operationText = plan.operation === 'reuse'
    ? '已有同来源的已验证全景，本次复用，模型调用0次。'
    : plan.operation === 'reverify'
      ? '复用已生成候选，仅重新质检：生成0次、全景质检1次。'
      : `全景生成${Number(calls.panorama_generation || 0)}次、全景质检${Number(calls.panorama_qa || 0)}次。`;
  const pricingText = plan.pricing_status === 'provider_billing_not_configured'
    ? '当前供应商金额计费未配置，本页只确认调用次数。'
    : '';
  const approved = await confirmDialog(`将以当前场景图为权威来源：${operationText} 本地机位投影0次模型调用，深度0次、空间重建0次。${pricingText} 产出为3DoF原地环视，不是6DoF自由移动空间。`, {
    title: `确认生成「${world.name || '当前场景'}」360全景`,
    confirmText: '确认生成并质检',
  });
  if (!approved) return;
  const buttons = matching(root, '[data-generate-panorama]', 'generatePanorama', world.id);
  const statuses = matching(root, '[data-panorama-status]', 'panoramaStatus', world.id);
  if (plan.operation === 'reuse') {
    statuses.forEach(item => { item.className = 'scene-panorama-status is-ready'; item.textContent = '全景已就绪 · 3DoF'; });
    store?.load?.({ force: true });
    return toast('已复用同一来源的已验证全景，没有新增模型调用。', 'success');
  }
  buttons.forEach(item => { item.disabled = true; item.textContent = '正在提交…'; });
  statuses.forEach(item => { item.className = 'scene-panorama-status is-queued'; item.textContent = '全景生成已提交 · 等待处理'; });
  try {
    const result = await request(`/api/new-story-ad/tasks/${encodeURIComponent(bundle.project.id)}/scene-assets/${encodeURIComponent(world.id)}/panorama`, {
      method: 'POST',
      body: {
        expected_revision: world.revision || 1,
        expected_world_revision: world.revision || 1,
        source_revision: Number(world.source_asset?.source_revision || 0),
        requested_mode: 'panorama_360',
        cost_confirmation: true,
        plan_fingerprint: plan.plan_fingerprint,
        model_call_plan: calls,
      },
      timeoutMs: 120000,
    });
    const liveStatus = String(result.panorama?.status || result.scene_world?.experience?.panorama_status || result.status || 'queued');
    statuses.forEach(item => {
      item.className = `scene-panorama-status is-${liveStatus.replace(/[^a-z0-9_-]/gi, '') || 'queued'}`;
      item.textContent = liveStatus === 'ready' ? '全景已就绪 · 3DoF' : '全景正在生成 / 质检';
    });
    buttons.forEach(item => { item.textContent = '全景处理中…'; });
    store?.syncProgressPolling?.(true);
    toast('全景生成与质检已提交，可留在当前页面查看进度。镜头投影不增加模型调用。', 'success');
  } catch (error) {
    statuses.forEach(item => { item.className = 'scene-panorama-status is-failed'; item.textContent = '提交失败 · 可使用同一请求安全重试'; });
    buttons.forEach(item => { item.disabled = false; item.textContent = '重试生成360全景'; });
    toast(error.message, 'danger');
  }
}

export async function runPanoramaBatchGeneration({ root, bundle, store, button } = {}) {
  let plan;
  try {
    plan = await request(`/api/new-story-ad/tasks/${encodeURIComponent(bundle.project.id)}/scene-assets/panoramas/plan`, {
      method: 'GET',
      timeoutMs: 30000,
    });
  } catch (error) {
    return toast(`无法取得统一360调用计划：${error.message}`, 'danger');
  }
  if (!Number(plan.scene_count || 0)) return toast('当前没有可生成360全景的场景主视图。', 'warning');
  const calls = plan.model_call_plan || {};
  const blocked = Number(plan.blocked_count || 0);
  const approved = await confirmDialog(
    `将统一处理 ${Number(plan.scene_count || 0)} 个场景：全景生成 ${Number(calls.panorama_generation || 0)} 次、全景质检 ${Number(calls.panorama_qa || 0)} 次；本地机位投影不调用模型。${blocked ? `其中 ${blocked} 个计费状态未决场景会被系统跳过并保留待核账，不会重复付费。` : ''} 单个场景失败不会中断其他场景。`,
    { title: '确认统一生成全部360全景', confirmText: '确认批量生成并质检' },
  );
  if (!approved) return;
  if (button) { button.disabled = true; button.textContent = '统一360任务提交中…'; }
  try {
    await request(`/api/new-story-ad/tasks/${encodeURIComponent(bundle.project.id)}/scene-assets/panoramas`, {
      method: 'POST',
      body: {
        cost_confirmation: true,
        plan_fingerprint: plan.plan_fingerprint,
        model_call_plan: calls,
        requested_mode: 'panorama_360',
      },
      timeoutMs: 120000,
    });
    root.querySelectorAll('[data-panorama-status]').forEach(item => {
      if (!item.classList.contains('is-ready')) {
        item.className = 'scene-panorama-status is-queued';
        item.textContent = '统一360任务已提交 · 后台逐场景处理';
      }
    });
    store?.syncProgressPolling?.(true);
    toast('统一360任务已提交；系统会逐场景保存并继续，单个失败不会要求整批重来。', 'success');
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = '统一生成全部360全景'; }
    toast(error.message, 'danger');
  }
}
