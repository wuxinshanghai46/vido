import { request } from '../api.js?v=20260902-production-v386';
import { promptDialog } from '../components/dialog.js?v=20260902-production-v386';
import { escapeHtml, toast } from '../components/ui.js?v=20260902-production-v386';

async function saveSceneWorld(taskId, world, patch = {}) {
  return request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/scene-worlds/${encodeURIComponent(world.id)}`, {
    method: 'PUT',
    body: { ...patch, expected_revision: world.revision || 1 },
  });
}

export function openSceneExperiencePlanner({ bundle, world, onOpenDirector }) {
  const current = world.experience || {};
  const spatialReady = world.capabilities?.supports_spatial_model === true;
  const overlay = document.createElement('div');
  overlay.className = 'scene-experience-planner';
  overlay.innerHTML = `<form><header><div><small>场景空间能力</small><h2>${escapeHtml(world.name)}</h2><p>按当前故事选择空间体验；结构化3D导演预演可立即使用，真实6DoF需要额外空间模型。</p></div><button type="button" data-close>×</button></header><div class="scene-experience-form"><label><span>目标体验</span><select name="requested_mode"><option value="photo_views">多视角图片</option><option value="panorama_360">360原地环视（3DoF）</option><option value="director_3d">3D导演预演（结构化）</option><option value="spatial_3d">真实可移动空间（6DoF，需供应商）</option></select></label><label><span>场景来源</span><select name="source_mode"><option value="existing_assets">沿用现有图片</option><option value="ai_concept">AI概念空间</option><option value="real_capture">真实场地拍摄/扫描</option></select></label><label><span>观察点数量</span><input name="observation_point_target" type="number" min="1" max="30" value="${Number(current.observation_point_target || 1)}"></label><label class="full"><span>进入路线和希望查看的区域</span><textarea name="route_brief" rows="4" placeholder="说明希望查看的区域、镜头方向，以及是否需要摄像机或人物真实位移。">${escapeHtml(current.route_brief || '')}</textarea></label><div class="scene-experience-warning"><b>能力边界</b><p>3D导演预演使用可旋转结构、区域、人物站位和镜头路线，不调用图像模型；3DoF只能原地转向；真实6DoF还需要深度、几何、碰撞与遮挡验证，当前未配置重建供应商。</p></div></div><footer><button class="btn" type="button" data-ai-assist-experience>AI 完善规划</button><button class="btn" type="button" data-close>取消</button><button class="btn primary" type="submit">保存空间规划</button></footer></form>`;
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  const form = overlay.querySelector('form');
  const spatialOption = form.elements.requested_mode.querySelector('option[value="spatial_3d"]');
  if (spatialOption && !spatialReady) {
    spatialOption.disabled = true;
    spatialOption.textContent = '真实可移动空间（6DoF，当前不可用）';
  }
  form.elements.requested_mode.value = !spatialReady && (current.requested_mode === 'spatial_3d' || current.current_mode === 'spatial_3d')
    ? 'photo_views' : (current.requested_mode || current.current_mode || 'photo_views');
  form.elements.source_mode.value = current.source_mode || 'existing_assets';
  const close = () => { overlay.remove(); document.body.classList.remove('modal-open'); };
  overlay.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', close));
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  form.querySelector('[data-ai-assist-experience]')?.addEventListener('click', async event => {
    const instruction = await promptDialog('AI 完善360 / 3D规划', {
      inputLabel: '你希望观众怎么看这个场景',
      placeholder: '例如：先从门口看全景，再跟随人物走到柜台，最后环绕展示核心区域',
      multiline: true, rows: 4, maxLength: 800, confirmText: '完善规划',
    });
    if (!instruction) return;
    const button = event.currentTarget;
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = 'AI 正在完善…';
    try {
      const data = await request('/api/new-story-ad/assist', { method: 'POST', timeoutMs: 120000, body: {
        task_id: bundle.project.id,
        mode: 'scene_experience',
        brief: bundle.brief?.text || '',
        content_mode: bundle.brief?.content_mode || bundle.project?.request?.content_mode,
        target_scene: world,
        scene_experience: {
          requested_mode: form.elements.requested_mode.value,
          source_mode: form.elements.source_mode.value,
          observation_point_target: Number(form.elements.observation_point_target.value) || 1,
          route_brief: form.elements.route_brief.value.trim(),
        },
        user_instruction: instruction,
      } });
      const plan = data.experience_plan || {};
      if (plan.requested_mode && (plan.requested_mode !== 'spatial_3d' || spatialReady)) form.elements.requested_mode.value = plan.requested_mode;
      if (plan.source_mode) form.elements.source_mode.value = plan.source_mode;
      if (plan.observation_point_target) form.elements.observation_point_target.value = plan.observation_point_target;
      if (plan.route_brief) form.elements.route_brief.value = plan.route_brief;
      toast('AI 已结合当前故事、场景区域和能力边界完善规划，请确认后保存。', 'success');
    } catch (error) { toast(error.message, 'danger'); } finally { button.disabled = false; button.textContent = oldText; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const requestedMode = form.elements.requested_mode.value;
      const result = await saveSceneWorld(bundle.project.id, world, { experience: {
        ...current,
        requested_mode: requestedMode,
        source_mode: form.elements.source_mode.value,
        observation_point_target: Math.max(1, Math.min(30, Number(form.elements.observation_point_target.value) || 1)),
        route_brief: form.elements.route_brief.value.trim(),
        status: requestedMode === current.current_mode ? current.status || 'base_ready' : 'planned',
      } });
      if (result.world) Object.assign(world, result.world);
      if (result.manifest) bundle.production_manifest = result.manifest;
      toast(requestedMode === 'director_3d' ? '3D导演预演规划已保存，正在打开结构化3D工作台。' : '空间规划已保存。需要新增全景或真实6DoF素材时，系统会按该规划生成或接收上传素材。', 'success');
      close();
      if (requestedMode === 'director_3d') onOpenDirector?.();
    } catch (error) { toast(error.message, 'danger'); submit.disabled = false; }
  });
}
