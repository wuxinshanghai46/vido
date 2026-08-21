import { worldSettingPayload } from './briefWorldSettings.js?v=20260821-dialogue-v120';

export function formPayload(form) {
  const data = new FormData(form);
  const brief = String(data.get('brief') || '').trim();
  return {
    project_name: String(data.get('project_name') || '').trim(),
    brief,
    content: brief,
    brief_source: 'user',
    content_mode: String(data.get('content_mode') || '').trim(),
    content_mode_source: 'user',
    product_subject: '',
    target_duration: Number(data.get('target_duration') || 30) || 30,
    output_ratio: String(data.get('output_ratio') || '9:16'),
    output_size: String(data.get('output_size') || 'standard'),
    video_resolution: String(data.get('video_resolution') || '1080p'),
    production_mode: String(data.get('production_mode') || 'auto'),
    brief_intake: {
      creative_brief_confirmed: String(data.get('creative_brief_confirmed') || '') === 'true',
      specifications_confirmed: String(data.get('specifications_confirmed') || '') === 'true',
      reference_decision: String(data.get('reference_decision') || ''),
    },
    world_setting: worldSettingPayload(data),
    benchmark_strategy: {
      source: 'platform_competitor_learning',
      opening_hook: String(data.get('benchmark_opening_hook') || '').trim(),
      subject_introduction: String(data.get('benchmark_subject_introduction') || '').trim(),
      proof_sequence: String(data.get('benchmark_proof_sequence') || '').trim(),
      spectacle: String(data.get('benchmark_spectacle') || '').trim(),
      closing: String(data.get('benchmark_closing') || '').trim(),
      camera_language: String(data.get('benchmark_camera_language') || '').trim(),
      prompt_method: String(data.get('benchmark_prompt_method') || '').trim(),
      naturalness_review: String(data.get('benchmark_naturalness_review') || '').trim(),
      user_edited: true,
    },
  };
}
