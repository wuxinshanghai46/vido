import { escapeHtml } from '../components/ui.js?v=20260902-production-v393';

const CAPABILITY_LABELS = {
  supports_photo_views: '真实图片视角',
  supports_panorama: '360原地环视（3DoF）',
  supports_structure_map: '结构 / 路线',
  supports_3d_proxy: '可旋转结构代理',
  supports_spatial_model: '可移动空间（6DoF）',
  supports_navigation: '6DoF空间导航',
  supports_camera_orbit: '环绕机位',
  supports_character_blocking: '人物站位',
  supports_motion_path: '行动路线',
  supports_transition_portal: '跨场景入口',
  supports_state_variants: '状态变化',
};

export function capabilityChips(world = {}) {
  return Object.entries(CAPABILITY_LABELS)
    .filter(([key]) => world.capabilities?.[key] === true)
    .map(([, label]) => `<span>${escapeHtml(label)}</span>`)
    .join('');
}
