import { escapeHtml as esc } from '../components/ui.js?v=20260903-production-v423';
import { list } from './sceneWorldData.js?v=20260903-production-v423';

const value = (row, keys) => keys.map(key => row?.[key]).find(item => item !== undefined && item !== null && item !== '');
export function normalizedLayoutPoint(input) {
  const pair = Array.isArray(input) ? input : (input && [input.x, input.y ?? input.z]);
  const x = Number(pair?.[0]); const y = Number(pair?.[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
export function normalizedLayoutPath(input) {
  return list(input).map(normalizedLayoutPoint).filter(Boolean);
}
export function sceneCameraRows(bundle = {}, world = {}) {
  const scene = list(bundle.assets?.scenes).find(row => String(row.id || row.scene_id || '') === String(world.id || '')) || {};
  const generated = list(scene.cameras); const planned = list(scene.camera_plan).length ? list(scene.camera_plan) : generated;
  return planned.map((camera, index) => {
    const key = String(value(camera, ['id', 'camera_id', 'view_id']) || '');
    const match = rows => rows.find(row => String(value(row, ['id', 'camera_id', 'view_id']) || '') === key) || rows[index] || {};
    const generatedMatch = match(generated); const worldMatch = match(list(world.cameras));
    const row = { ...worldMatch, ...generatedMatch, ...camera };
    return { ...row,
      id: value(row, ['id', 'camera_id', 'view_id']) || `camera-${index + 1}`,
      name: value(row, ['label', 'name']) || `机位 ${index + 1}`,
      position: normalizedLayoutPoint(value(row, ['position', 'normalized_position', 'position_on_layout'])),
      lookAt: normalizedLayoutPoint(value(row, ['look_at', 'lookAt', 'target_on_layout'])),
      image_url: value(row, ['image_url', 'reference_image_url']) || '',
    };
  });
}
export function scenePeopleRows(bundle = {}, world = {}) {
  return sceneSubjectRows(bundle, world).filter(row => row.kind !== 'animal');
}
export function sceneSubjectRows(bundle = {}, world = {}) {
  const matrix = list(bundle.production_manifest?.subject_world_matrix).length
    ? list(bundle.production_manifest.subject_world_matrix)
    : list(bundle.production_manifest?.character_world_matrix);
  const peopleById = new Map(list(bundle.assets?.people).map(item => [String(item.subject_id || item.profile?.id || item.id), item]));
  return matrix.map(row => {
    const cell = list(row.cells).find(item => String(item.world_id || '') === String(world.id || ''));
    if (!cell || !['confirmed', 'suggested'].includes(cell.presence)) return null;
    const person = peopleById.get(String(row.character_id || row.subject_id || '')) || {};
    return {
      id: row.character_id || row.id || row.name,
      name: row.name || '未命名人物',
      kind: row.kind || 'person',
      gender: String(row.gender || person.gender || person.profile?.gender || '').toLowerCase(),
      species: row.species || '',
      position: normalizedLayoutPoint(value(cell, ['blocking_position', 'position_on_layout', 'position'])),
      entryPoint: normalizedLayoutPoint(value(cell, ['entry_point', 'entry_position'])),
      exitPoint: normalizedLayoutPoint(value(cell, ['exit_point', 'exit_position'])),
      routePoints: normalizedLayoutPath(value(cell, ['route_points', 'path_points'])),
    };
  }).filter(Boolean);
}
const point = row => row ? `(${row.x.toFixed(2)}, ${row.y.toFixed(2)}) · 布局归一化坐标` : '未规划（不显示伪造点）';
const field = (label, content) => `<div><dt>${label}</dt><dd>${esc(content || '未规划')}</dd></div>`;
const personCard = ({ row, cell }) => {
  const state = { confirmed: '确认在场', suggested: '建议在场', unassigned: '尚未确认' }[cell.presence] || '尚未确认';
  return `<article class="scene-world-person-plan is-${esc(cell.presence || 'unassigned')}"><div><b>${esc(row.name || '未命名人物')}</b><span>${state}</span></div><dl>${field('站位', cell.blocking || '站位说明未规划')}${field('站位坐标', point(normalizedLayoutPoint(value(cell, ['blocking_position', 'position_on_layout', 'position']))))}${field('动作 / 任务', cell.role || '动作尚未规划')}${field('入场 → 离场', `${cell.entry_direction || '未规划'} → ${cell.exit_direction || '未规划'}`)}${field('对应机位', cell.camera_id || '尚未绑定机位')}</dl></article>`;
};
const cameraCard = (camera, index) => `<button type="button" class="scene-world-camera-plan" data-focus-camera="${esc(camera.id)}"><div><b>${index + 1}. ${esc(camera.name)}</b><span>${camera.image_url ? '已关联对应图片' : '对应图片未生成'}</span></div><dl>${field('位置', point(camera.position))}${field('朝向目标', point(camera.lookAt))}${field('取景 / 镜头', [camera.framing, camera.lens, camera.height].filter(Boolean).join(' · '))}${field('方向 / 运镜', [camera.orientation, camera.movement].filter(Boolean).join('；'))}${field('对应图片', camera.view_id || camera.id || (camera.image_url ? '已关联' : '未关联'))}</dl></button>`;
export function sceneAuthorityPlan(bundle = {}, world = {}) {
  const people = list(bundle.production_manifest?.character_world_matrix).map(row => ({ row, cell: list(row.cells).find(cell => String(cell.world_id || '') === String(world.id || '')) })).filter(item => item.cell && item.cell.presence !== 'excluded');
  const cameras = sceneCameraRows(bundle, world);
  return `<section class="scene-world-authority-plan" data-scene-authority-plan="${esc(world.id)}"><header><b>当前场景执行说明</b><span>人物与机位只读取已保存数据；缺失项明确标为未规划。</span></header><div class="scene-world-authority-group"><h3>谁在场、站在哪里</h3>${people.length ? people.map(personCard).join('') : '<p class="scene-world-authority-empty">当前场景没有已保存的人物出场关系。</p>'}</div><div class="scene-world-authority-group"><h3>机位在哪里、朝哪里拍</h3>${cameras.length ? cameras.map(cameraCard).join('') : '<p class="scene-world-authority-empty">当前场景还没有权威机位方案。</p>'}</div></section>`;
}
