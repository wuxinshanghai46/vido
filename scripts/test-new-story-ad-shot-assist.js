'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizeAssistedShotSettings } = require('../src/services/newStoryAd/storyAdService');

function testNormalizesGenericShotSettings() {
  const result = normalizeAssistedShotSettings({
    shot_settings: {
      visual: '主体位于画面右侧，环境保持当前任务已确认的空间。',
      action: '主体自然转身，镜头缓慢推进。',
      motion_effect: {
        type: 'particle_assembly',
        source_state: '少量粒子分散',
        target_state: '汇聚为任务已有标识',
        timeline: '前段稳定，中段汇聚，末段定格',
        intensity: 'low',
        preserve_scene_geometry: true,
      },
      shot_size: 'medium',
      camera_angle: 'eye_level',
      lens_mm: 999,
      depth_of_field: 'shallow',
      transition_type: 'cut_on_action',
      scene_view: 'runner_follow_left',
      shot_scope: 'dynamic_product_trial',
      surface_topology: {
        mode: 'task_authored_flexible_surface',
        seam_policy: 'brief_defined',
        finish_distribution: 'evidence_mapped',
        notes: '仅服从当前任务的可见证据。',
      },
    },
  });

  // V2.0 开放字段不得被旧行业枚举吞掉。
  assert.equal(result.shot_scope, 'dynamic_product_trial');
  assert.equal(result.surface_topology.mode, 'task_authored_flexible_surface');
  assert.equal(result.surface_topology.seam_policy, 'brief_defined');
  assert.equal(result.scene_view, 'runner_follow_left');
  assert.equal(result.motion_effect.type, 'particle_assembly');
  assert.equal(result.motion_effect.preserve_scene_geometry, true);
  assert.equal(result.shot_size, 'medium');
  assert.equal(result.lens_mm, 300);
  assert.equal(result.transition_type, 'cut_on_action');
}

function testPreservesCurrentValuesAndRejectsInvalidEnums() {
  const current = {
    scene_id: 'scene_original',
    visual: '保留当前画面',
    voiceover: '保留当前台词',
    shot_size: 'wide',
    camera_angle: 'low_angle',
    transition_type: 'fade',
    surface_topology: { mode: 'auto', seam_policy: 'auto', finish_distribution: 'auto' },
  };
  const result = normalizeAssistedShotSettings({
    shot_settings: {
      shot_size: 'not-a-shot-size',
      camera_angle: 'not-an-angle',
      transition_type: 'not-a-transition',
    },
  }, current);

  assert.equal(result.visual, current.visual);
  assert.equal(result.voiceover, current.voiceover);
  assert.equal(result.shot_size, current.shot_size);
  assert.equal(result.camera_angle, current.camera_angle);
  assert.equal(result.transition_type, current.transition_type);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'scene_id'), false);
}

function testUiContractIsPresent() {
  const root = path.resolve(__dirname, '..');
  const ui = fs.readFileSync(path.join(root, 'public/js/new-story-ad-legacy-ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public/css/digital-human-wizard.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public/digital-human.html'), 'utf8');

  assert.match(ui, /data-nsa-shot-ai-run/);
  assert.match(ui, /AI 帮我设置/);
  assert.match(ui, /填写后自动保存/);
  assert.match(ui, /data-nsa-shot-autosave-status/);
  assert.doesNotMatch(ui, /data-nsa-shot-save/);
  assert.match(ui, /data-nsa-shot-jump/);
  assert.match(css, /\.dh-nsa-shot-ai-assist/);
  assert.match(css, /\.dh-nsa-editor-section-fields/);
  assert.match(html, /new-story-ad\/bootstrap\.js\?v=20260725-subject-scene-contract-v10/);
}

testNormalizesGenericShotSettings();
testPreservesCurrentValuesAndRejectsInvalidEnums();
testUiContractIsPresent();
console.log('new story ad shot assist tests passed');
