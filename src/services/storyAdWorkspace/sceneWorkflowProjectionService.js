'use strict';

function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function clean(value = '', max = 12000) { return String(value || '').trim().slice(0, max); }

function promptText({ name = '', storyPurpose = '', description = '', spec = {}, cameraPlan = [] } = {}) {
  return [
    `场景：${name || '未命名场景'}`,
    storyPurpose ? `剧情用途：${storyPurpose}` : '',
    description ? `场景描述：${description}` : '',
    spec.layoutText || spec.layout || spec.spatialLayout ? `空间结构：${spec.layoutText || spec.layout || spec.spatialLayout}` : '',
    spec.materialLightText || spec.material_light_text || spec.materials ? `材质、色彩与光线：${spec.materialLightText || spec.material_light_text || spec.materials}` : '',
    spec.interactionText || spec.interaction_text || spec.interaction ? `人物互动与路线：${spec.interactionText || spec.interaction_text || spec.interaction}` : '',
    cameraPlan.length ? `机位与构图：${cameraPlan.map(camera => [camera.label || camera.name, camera.framing || camera.shot_size, camera.movement || camera.camera_movement].filter(Boolean).join(' · ')).join('；')}` : '',
    spec.negativeText || spec.negative_text || spec.negative ? `视觉限制：${spec.negativeText || spec.negative_text || spec.negative}` : '',
    '视觉风格：沿用当前项目已确认的画面形态、人物档案和整体美术方向，保持真实空间比例与跨视角一致性。',
  ].filter(Boolean).join('\n\n');
}

function promptProjection({ space = {}, asset = {}, reference = {}, spec = {}, index = 0, cleanText } = {}) {
  const sceneName = cleanText(space.display_name || space.name || asset.display_name || asset.name || asset.scene_name || reference.display_name || reference.name || `场景 ${index + 1}`, 120);
  const generationPrompt = clean(promptText({ name: sceneName, storyPurpose: space.story_purpose || space.purpose || asset.story_purpose, description: space.description || asset.description || spec.description || spec.layoutText, spec, cameraPlan: list(spec.cameraPlan || spec.camera_plan || space.camera_plan) }));
  return { sceneName, generationPrompt: clean(asset.prompt || space.generation_prompt || space.generationPrompt || generationPrompt), generationPromptSource: asset.prompt ? 'generated_asset' : (space.generation_prompt || space.generationPrompt ? 'scene_plan' : 'scene_plan_compiled') };
}

function projectBundleState(scenes = [], context = {}, outputs = {}) {
  const planned = list(scenes).filter(scene => scene.planned !== false && scene.reference_only !== true);
  const generated = planned.filter(scene => Boolean(scene.image_url || scene.layout?.image_url || scene.view_images?.some(view => view?.image_url)));
  const locked = planned.filter(scene => scene.qa?.full_space_lock === true);
  return {
    asset_editor: { scene_plan: outputs.scene_config && typeof outputs.scene_config === 'object' ? outputs.scene_config : (context.scene_plan && typeof context.scene_plan === 'object' ? context.scene_plan : { scene_mode: 'auto', spaces: [] }) },
    scene_workflow: { planned_count: planned.length, generated_count: generated.length, locked_count: locked.length, prompts_ready: planned.length > 0, visuals_complete: planned.length > 0 && locked.length === planned.length, confirmed: context.scene_setup_confirmed === true },
  };
}

module.exports = { projectBundleState, promptProjection, promptText };
