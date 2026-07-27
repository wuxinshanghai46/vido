const { cleanText } = require('./contextBuilder');
const sceneAssistCompleteness = require('./sceneAssistCompletenessService');
const { normalizeScenePlan, assertScenePlanContract } = require('./sceneBindingService');

/** 返回场景辅助模型的结构化输出合同；独立物理空间必须逐项输出，禁止混写进单个文本字段。 */
function outputSchema() {
  return `{
  "scene_plan": {
    "scene_mode": "single/multi",
    "spaces": [{
      "id": "稳定且唯一的 space_1/space_2 等 ID",
      "name": "独立物理空间名称",
      "description": "只描述这个地点，不得混入其它地点",
      "story_purpose": "该地点承载的剧情作用",
      "scene_spec": {
        "layoutText": "仅属于这个地点的空间布局、主体位置、前景/背景关系、合理实用物件、维护或使用线索和可复用空间身份，80-180 字",
        "materialLightText": "仅属于这个地点的材质、色彩、光线方向、真实尺度、局部自然变化和真实摄影光学质感，80-180 字",
        "interactionText": "仅属于这个地点的人物/商品动作区、通行路线和可用机位，60-140 字",
        "negativeText": "这个地点不得出现的其它空间、结构、材质、人物、文字水印和无关元素；不得把现实痕迹和合理局部变化全部排除，分号分隔",
        "surfaceTopology": {
          "mode": "auto/continuous/segmented/modular",
          "seam_policy": "auto/hidden/visible/task_defined",
          "finish_distribution": "auto/uniform/gradient/regional/sample_comparison",
          "primary_surface_count": "明确要求的主展示/材质平面数量；没有明确数量时为 null",
          "secondary_surface_policy": "auto/forbidden/task_defined",
          "notes": "当前地点明确要求的表面结构"
        },
        "materialContract": {
          "dominant_finish": "当前地点的主导饰面表达",
          "observable_cues": ["当前需求支持的颜色、纹理、反射、粗糙度、肌理和尺度证据"]
        }
      }
    }]
  }
}`;
}

/** 为模型输出补齐稳定空间 ID 和逐空间完整合同，同时保留已有结构化空间。 */
function enforceAssistedScenePlan(raw = {}, currentPlan = {}, currentSpec = {}, context = {}, targetSpaceId = '') {
  const source = raw && typeof raw === 'object' ? raw : {};
  const previous = normalizeScenePlan(currentPlan && typeof currentPlan === 'object' ? currentPlan : {});
  const scopedId = cleanText(targetSpaceId, 100);
  if (scopedId) {
    const targetIndex = previous.spaces.findIndex(space => space.id === scopedId);
    if (targetIndex < 0) {
      const error = new Error('目标场景不在当前场景计划中');
      error.code = 'ASSIST_SCENE_TARGET_INVALID';
      error.status = 400;
      throw error;
    }
    const incoming = (Array.isArray(source.spaces)
      ? source.spaces.find(space => cleanText(space?.id || space?.space_id || space?.scene_id, 100) === scopedId) || source.spaces[0]
      : null) || source.scene_spec || source.sceneSpec || source;
    const current = previous.spaces[targetIndex];
    const incomingSpec = incoming?.scene_spec || incoming?.sceneSpec || incoming || {};
    const updated = {
      ...current,
      id: scopedId,
      space_id: scopedId,
      scene_id: scopedId,
      name: cleanText(incoming?.name || incoming?.label || current.name, 120),
      description: cleanText(incoming?.description || incoming?.layout || current.description, 500),
      story_purpose: cleanText(incoming?.story_purpose || incoming?.storyPurpose || incoming?.purpose || current.story_purpose, 300),
      scene_spec: sceneAssistCompleteness.enforceAssistedSceneSpec(
        incomingSpec,
        current.scene_spec || currentSpec,
        context,
      ),
    };
    const spaces = previous.spaces.map((space, index) => index === targetIndex ? updated : space);
    return assertScenePlanContract(normalizeScenePlan({
      ...previous,
      scene_mode: spaces.length > 1 ? 'multi' : 'single',
      spaces,
    }));
  }
  let spaces = Array.isArray(source.spaces) ? source.spaces : [];
  if (!spaces.length && previous.spaces.length) spaces = previous.spaces;
  if (!spaces.length) {
    const rawSpec = source.scene_spec || source.sceneSpec || source;
    spaces = [{
      id: 'space_1',
      name: cleanText(source.name || '主要空间', 120),
      description: cleanText(source.description || rawSpec.layoutText || rawSpec.layout_text || '', 500),
      story_purpose: cleanText(source.story_purpose || source.storyPurpose || '承载当前广告剧情', 300),
      scene_spec: rawSpec,
    }];
  }
  const usedIds = new Set();
  const normalizedSpaces = spaces.slice(0, 12).map((space, index) => {
    const item = space && typeof space === 'object' ? space : {};
    const fallbackId = `space_${index + 1}`;
    let id = cleanText(item.id || item.space_id || item.scene_id || fallbackId, 100) || fallbackId;
    if (usedIds.has(id)) id = `${id}_${index + 1}`;
    usedIds.add(id);
    const previousSpace = previous.spaces.find(candidate => candidate.id === id) || previous.spaces[index] || {};
    const baseSpec = previousSpace.scene_spec || (index === 0 ? currentSpec : {});
    const sceneSpec = sceneAssistCompleteness.enforceAssistedSceneSpec(
      item.scene_spec || item.sceneSpec || {},
      baseSpec,
      context,
    );
    return {
      id,
      space_id: id,
      scene_id: id,
      name: cleanText(item.name || item.label || previousSpace.name || `独立空间 ${index + 1}`, 120),
      description: cleanText(item.description || item.layout || previousSpace.description || sceneSpec.layoutText, 500),
      story_purpose: cleanText(item.story_purpose || item.storyPurpose || item.purpose || previousSpace.story_purpose || '承载当前广告剧情', 300),
      scene_spec: sceneSpec,
    };
  });
  const plan = normalizeScenePlan({
    ...source,
    scene_mode: normalizedSpaces.length > 1 ? 'multi' : 'single',
    spaces: normalizedSpaces,
  });
  return assertScenePlanContract(plan);
}

/** 构造前后端兼容的场景辅助响应：结构化计划为真源，首空间 spec 仅供旧表单展示。 */
function buildResponse({ parsed = {}, context = {}, currentPlan = {}, targetSpaceId = '', mode = 'scene_spec', modelResult = {} } = {}) {
  const rawPlan = parsed.scene_plan || parsed.scenePlan || parsed.scene_config || parsed.sceneConfig || parsed;
  const plan = enforceAssistedScenePlan(
    rawPlan,
    currentPlan,
    context.scene_spec || context.sceneSpec || {},
    context,
    targetSpaceId,
  );
  const active = plan.spaces.find(space => space.id === targetSpaceId) || plan.spaces[0];
  return {
    scene_plan: plan,
    scene_config: plan,
    scene_spec: active?.scene_spec || null,
    mode,
    model_meta: {
      used_model: modelResult.used_model,
      fallback_used: modelResult.fallback_used,
      failed_models: modelResult.failed_models,
    },
  };
}

module.exports = { outputSchema, enforceAssistedScenePlan, buildResponse };
