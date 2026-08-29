'use strict';

const sceneVisualAcceptance = require('../newStoryAd/sceneVisualAcceptanceService');

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
  const acceptanceState = sceneVisualAcceptance.inspect(
    outputs.scene_assets || context.scene_assets || [],
    outputs[sceneVisualAcceptance.OUTPUT_KIND],
  );
  const blueprintBeats = list(outputs.blueprint?.beats);
  const previewByScene = new Map();
  blueprintBeats.forEach((beat, index) => {
    const label = clean(beat.scene || beat.location || beat.setting || beat.title || `场景 ${index + 1}`, 240);
    const key = label || `scene-${index + 1}`;
    if (previewByScene.has(key)) return;
    const visual = clean(beat.visual || beat.story_visual || beat.plot || beat.summary || '', 900);
    const action = clean(beat.action || '', 500);
    previewByScene.set(key, {
      id: `scene-preview-${previewByScene.size + 1}`,
      name: label || `场景 ${previewByScene.size + 1}`,
      generation_prompt: [
        `场景：${label || `场景 ${previewByScene.size + 1}`}`,
        visual ? `画面内容：${visual}` : '',
        action ? `人物动作：${action}` : '',
        beat.lighting_mood ? `光线氛围：${clean(beat.lighting_mood, 300)}` : '',
        '提示：这是根据已确认剧情即时整理的预览；正式场景规划完成后会替换为完整空间、材质、光线与人物路线提示词。',
      ].filter(Boolean).join('\n\n'),
      provisional: true,
    });
  });
  const previewScenes = [...previewByScene.values()].slice(0, 24);
  return {
    asset_editor: { scene_plan: outputs.scene_config && typeof outputs.scene_config === 'object' ? outputs.scene_config : (context.scene_plan && typeof context.scene_plan === 'object' ? context.scene_plan : { scene_mode: 'auto', spaces: [] }) },
    scene_workflow: {
      planned_count: planned.length,
      estimated_count: planned.length || previewScenes.length,
      generated_count: generated.length,
      locked_count: locked.length,
      prompts_ready: planned.length > 0,
      initialization_required: planned.length === 0 && previewScenes.length > 0 && context.asset_setup_confirmed === true,
      preview_scenes: planned.length ? [] : previewScenes,
      visuals_complete: planned.length > 0 && locked.length === planned.length,
      visuals_accepted: acceptanceState.accepted,
      can_accept_current: acceptanceState.all_views_complete
        && locked.length !== planned.length
        && acceptanceState.accepted !== true,
      acceptance_mode: acceptanceState.accepted ? 'explicit_user_acceptance' : '',
      confirmed: context.scene_setup_confirmed === true
        && (locked.length === planned.length || acceptanceState.accepted),
    },
  };
}

module.exports = { projectBundleState, promptProjection, promptText };
