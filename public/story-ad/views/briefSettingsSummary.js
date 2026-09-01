import { escapeHtml } from '../components/ui.js?v=20260901-production-v362';

function compactText(value, maxLength = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '尚未填写';
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function durationText(value) {
  const seconds = Number(value || 30) || 30;
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60), remainder = seconds % 60;
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
}

export function briefSettingsSummary(bundle = {}) {
  const brief = bundle.brief || {};
  const world = brief.world_setting?.profiles?.[0] || {};
  return `<span class="brief-settings-values" data-brief-settings-values>
    <span class="brief-settings-goal"><small>内容目标</small><strong>${escapeHtml(compactText(brief.text, 150))}</strong></span>
    <span class="brief-settings-meta"><em>${brief.content_mode === 'narrative_story' ? '剧情' : (brief.content_mode === 'commercial_subject' ? '广告' : '未选择类型')}</em><em>${escapeHtml(world.era_family && world.era_family !== 'auto' ? `${world.era_family}${world.time_period ? ` · ${world.time_period}` : ''}` : '世界观待识别')}</em><em>${escapeHtml(({ live_action: '真人实拍', cinematic_3d: '3D动画', anime_2d: '2D动漫', motion_comic: '动态漫', mixed_media: '混合媒介', custom: '自定义媒介' })[world.visual_medium] || '画面形态待识别')}</em><em>${escapeHtml(compactText(brief.product_subject || '未指定商品 / 主题', 48))}</em><em>${durationText(brief.target_duration)}</em><em>${escapeHtml(brief.output_ratio || '9:16')}</em><em>${escapeHtml(brief.video_resolution || '1080p')}</em></span>
  </span>`;
}
