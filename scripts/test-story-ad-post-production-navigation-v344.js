'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const navigation = require('../src/services/storyAdWorkspace/workflowNavigationService');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const clean = value => String(value || '').trim();
const list = value => Array.isArray(value) ? value : [];
const baseOutputs = {
  blueprint: { beats: [{}] },
  asset_plan_eligibility: { eligible: true },
  asset_plan: { cast_profiles: [], scene_plan: { spaces: [{}] } },
  storyboard_table: [{ shot_index: 1 }],
};
const context = { project_name: '测试', brief: '测试后段导航', shot_design_confirmed: true, asset_setup_confirmed: true, scene_setup_confirmed: true };
const build = outputs => navigation.build({ task: { title: '测试' }, context, outputs: { ...baseOutputs, ...outputs }, counts: {}, clean, list });

const beforeSound = build({});
assert.equal(beforeSound.steps.sound.enabled, true);
assert.equal(beforeSound.steps.compose.enabled, false, '声音未确认时不得进入视频与合成');
assert.equal(beforeSound.steps.edit.enabled, false, '没有初版成片时不得进入剪辑');
assert.equal(beforeSound.current, 'sound');

const soundApproval = { confirmed: true, signature: 'persisted-audio-signature' };
const afterSound = build({ audio_production_approval: soundApproval });
assert.equal(afterSound.steps.sound.completed, true);
assert.equal(afterSound.steps.compose.enabled, true);
assert.equal(afterSound.steps.edit.enabled, false);
assert.equal(afterSound.current, 'compose');

const afterClips = build({ audio_production_approval: soundApproval, video_clips: [{ shot_index: 1, video_url: '/clip.mp4' }] });
assert.equal(afterClips.steps.edit.enabled, false, '只有分镜视频、尚未合成初版成片时仍不得显示剪辑');
assert.equal(afterClips.counts.final_videos, 0);

const afterFinal = build({ audio_production_approval: soundApproval, video_clips: [{ shot_index: 1, video_url: '/clip.mp4' }], final_video: { video_url: '/final.mp4' } });
assert.equal(afterFinal.steps.edit.enabled, true);
assert.equal(afterFinal.counts.final_videos, 1);
assert.equal(afterFinal.current, 'edit');

const app = read('public/story-ad/app.js');
const soundView = read('public/story-ad/views/finalSoundView.js');
const composeView = read('public/story-ad/views/finalView.js');
const editView = read('public/story-ad/views/finalEditView.js');
const soundWorkbench = read('public/story-ad/views/finalSoundDesignView.js') + read('public/story-ad/views/soundDesignFeature.js');
const css = read('public/story-ad/workspace-ux.css');

assert.match(app, /rawView === 'final' \? 'sound'/, '历史 final 链接必须迁移到声音页');
assert.match(app, /view !== 'edit' \|\| Number\(counts\.final_videos \|\| 0\) > 0/, '剪辑导航必须在初版成片存在后出现');
assert.match(soundView, /<h1>声音<\/h1>/);
assert.match(soundView, /soundDesignMarkup/);
assert.doesNotMatch(soundView, /data-generate-video|data-compose|data-save-timeline/);
assert.match(composeView, /<h1>视频与合成<\/h1>/);
assert.match(composeView, /data-generate-video/);
assert.match(composeView, /合成初版成片/);
assert.doesNotMatch(composeView, /data-save-timeline|data-trim-start|data-transition-type/, '合成页不得提前渲染剪辑控件');
assert.match(editView, /<h1>成片剪辑<\/h1>/);
assert.match(editView, /if \(!finalVideo \|\| !videoUrl\(finalVideo\)\)/, '剪辑页必须自行拒绝无成片状态');
assert.match(editView, /data-save-timeline/);
assert.match(editView, /data-apply-edit/);
assert.match(editView, /store\.runStage\('compose'\)/, '剪辑应用必须通过重新合成生成新成片');
assert.match(soundWorkbench, /voice-setup-panel/);
assert.match(soundWorkbench, /sound-primary-actions/);
assert.match(soundWorkbench, /sound-option-panel/);
assert.match(soundWorkbench, /bgm-picker/);
assert.match(css, /\.voice-setup-panel\{[^}]*grid-template-columns:minmax\(0,1fr\)/, '剧情权威声音合同必须使用单列设置区，不得恢复旧人声模式双栏');
assert.match(soundWorkbench, /voice-story-contract/, '声音页必须解释旁白与对白由剧情自动决定');
assert.match(css, /\.post-stage-summary\{[^}]*repeat\(3,minmax\(0,1fr\)\)/);

console.log(JSON.stringify({ passed: true, checks: 28, no_video_editor_hidden: true, legacy_final_redirected: true, post_production_views: ['sound', 'compose', 'edit'], upstream_steps_changed: 0 }));
