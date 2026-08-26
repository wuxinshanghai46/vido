import { request } from '../api.js?v=20260826-production-v233a';
import { promptDialog } from '../components/dialog.js?v=20260826-production-v233a';
import { setButtonBusy, toast } from '../components/ui.js?v=20260826-production-v233a';
import { applyGeneratedPersonLooks, collectPersonLookValues } from './assetCenterPersonLooks.js?v=20260826-production-v233a';

export function createAssetAssistHandlers(bundle) {
  const assistPerson = async (item, form, button = null) => {
    const concept = await promptDialog('AI 帮写人物设定', {
      inputLabel: '人物想法', placeholder: '例如：古装美女，温柔但有侠气，二十多岁',
      multiline: true, rows: 4, maxLength: 500, confirmText: '生成设定',
    });
    if (!concept) return false;
    const profile = item.profile || {};
    const currentValues = Object.fromEntries(new FormData(form).entries());
    const currentProfile = { ...profile, ...collectPersonLookValues(currentValues, profile) };
    const richnessLabels = { auto: '按剧情自动判断', restrained: '朴素克制', refined: '精致雅致', ornate_luxurious: '华丽华贵' };
    const richnessInstruction = (currentProfile.look_profiles || []).map(look => (
      `${look.name || '当前造型'}：${richnessLabels[look.style_richness] || richnessLabels.auto}`
    )).join('；');
    const stableId = profile.id || item.subject_id || item.id || 'cast_1';
    try {
      setButtonBusy(button, true, 'AI 正在结合知识规则帮写…', { elapsed: true });
      const data = await request('/api/new-story-ad/assist', { method: 'POST', timeoutMs: 120000, body: {
        task_id: bundle.project.id, mode: 'person_spec',
        brief: `${bundle.brief?.text || ''}\n【本次人物补充】${concept}\n【用户选择的造型华丽程度】${richnessInstruction || '按剧情自动判断'}。华丽华贵必须转化为符合时代、身份和婚姻状态的分层服装、面料工艺、鞋履、发饰与首饰清单，不得只写“华丽”两个字，也不得无依据堆砌。`,
        content_mode: bundle.brief?.content_mode || bundle.project?.request?.content_mode,
        cast_mode: 'single', expected_people: 1,
        cast_profiles: [{ ...currentProfile, id: stableId }],
        scene_plan: bundle.asset_editor?.scene_plan || { spaces: [] },
        assist_subject_target: { kind: 'human', index: 0, id: stableId },
        assist_replaceable_fields: ['displayName', 'roleName', 'appearanceText', 'wardrobeText', 'hairMakeupText', 'negativeText'],
      } });
      const generated = data.cast_profiles?.[0] || data.person_spec || {};
      if (Array.isArray(generated.look_profiles)) {
        generated.look_profiles = generated.look_profiles.map((look, index) => ({
          ...look,
          style_richness: currentProfile.look_profiles?.find(currentLook => currentLook.id === look.id)?.style_richness
            || currentProfile.look_profiles?.[index]?.style_richness
            || look.style_richness
            || 'auto',
        }));
      }
      ['displayName', 'roleName', 'appearanceText', 'wardrobeText', 'hairMakeupText', 'negativeText'].forEach(name => {
        if (form.elements[name] && generated[name]) form.elements[name].value = generated[name];
      });
      applyGeneratedPersonLooks(form, generated);
      toast('AI 已按当前项目与人物知识规则写入表单，请确认后再保存。', 'success');
      return true;
    } catch (error) { toast(error.message, 'danger'); return false; } finally { setButtonBusy(button, false); }
  };

  const assistScene = async (item, form, button = null) => {
    const concept = await promptDialog('AI 帮写场景设定', {
      inputLabel: '场景想法', placeholder: '例如：雨夜里的古代客栈，人物从门口走到二楼栏杆处',
      multiline: true, rows: 4, maxLength: 800, confirmText: '生成设定',
    });
    if (!concept) return false;
    const sourcePlan = bundle.asset_editor?.scene_plan || { scene_mode: 'single', spaces: [] };
    try {
      setButtonBusy(button, true, 'AI 正在结合故事与场景知识帮写…', { elapsed: true });
      const data = await request('/api/new-story-ad/assist', { method: 'POST', timeoutMs: 120000, body: {
        task_id: bundle.project.id, mode: 'scene_spec',
        brief: `${bundle.brief?.text || ''}\n【本次场景补充】${concept}`,
        content_mode: bundle.brief?.content_mode || bundle.project?.request?.content_mode,
        scene_plan: sourcePlan, target_space_id: item.id, preserve_current_scene_fields: false,
      } });
      const space = data.scene_plan?.spaces?.find(row => String(row.id) === String(item.id)) || data.scene_plan?.spaces?.[0] || {};
      const spec = space.scene_spec || {};
      const values = { name: space.name, story_purpose: space.story_purpose, description: space.description,
        layout: spec.layoutText, materials: spec.materialLightText, interaction: spec.interactionText, negative: spec.negativeText };
      Object.entries(values).forEach(([name, value]) => { if (form.elements[name] && value) form.elements[name].value = value; });
      toast('AI 已结合当前故事和场景知识写入表单，请确认后再保存。', 'success');
      return true;
    } catch (error) { toast(error.message, 'danger'); return false; } finally { setButtonBusy(button, false); }
  };
  return { assistPerson, assistScene };
}
