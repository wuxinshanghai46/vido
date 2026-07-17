#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/task-store.js'), 'utf8');
const taskCenterSource = fs.readFileSync(path.join(__dirname, '../public/js/digital-human.js'), 'utf8');
const values = new Map([['vido_new_story_ad_current_task_id', 'old-task']]);
const location = {
  href: 'https://example.test/digital-human?tab=new-story-ad&nsa_task_id=old-task&nsa_step=4',
  search: '?tab=new-story-ad&nsa_task_id=old-task&nsa_step=4',
  hash: '',
};
let replacedUrl = '';
const context = {
  URL,
  URLSearchParams,
  window: {},
  location,
  localStorage: {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  },
  history: {
    replaceState: (_state, _title, nextUrl) => {
      replacedUrl = String(nextUrl || '');
      const next = new URL(replacedUrl, 'https://example.test');
      location.href = next.href;
      location.search = next.search;
      location.hash = next.hash;
    },
  },
};
vm.runInNewContext(source, context, { filename: 'task-store.js' });
const store = context.window.NewStoryAdTaskStore;

assert.equal(store.resumeStep({ stage: 'created' }, {}), 1);
assert.equal(store.resumeStep({ stage: 'scene_config_done' }, {}), 2);
assert.equal(store.resumeStep({ stage: 'blueprint_failed' }, {}), 3);
assert.equal(store.resumeStep({ stage: 'keyframes_failed', shot_count: 6 }, {}), 4);
assert.equal(store.resumeStep({ stage: 'video_failed' }, {}), 4);
assert.equal(store.resumeStep({ stage: 'video_ready' }, { video_clips: [{ video_url: '/shot.mp4', qa: { pass: true } }] }), 4);
assert.equal(store.resumeStep({ stage: 'media_failed' }, { video_clips: [{ video_url: '/shot.mp4' }] }), 4);
assert.equal(store.resumeStep({ stage: 'tts_ready' }, { tts_audio: { tracks: [] } }), 5);
assert.equal(store.resumeStep({ stage: 'compose_failed' }, {}), 5);
assert.equal(store.resumeStep({}, [
  { kind: 'scene_config', payload: { id: 'scene-1' } },
  { kind: 'blueprint', payload: { beats: [] } },
  { kind: 'storyboard_table', payload: [{ id: 'shot-1' }] },
]), 4);
assert.equal(store.resumeStep({}, { final_video: { video_url: '/video.mp4' } }), 5);
assert.equal(store.resumeStep({}, { video_clips: [] }), 1);
assert.equal(store.canContinue({ status: 'working' }), true);
assert.equal(store.canContinue({ status: 'failed' }), true);
assert.equal(store.canContinue({ status: 'done' }), true);
assert.equal(store.canContinue({ status: 'completed' }), true);
assert.equal(store.canContinue({ status: 'succeeded' }), true);
assert.equal(store.canContinue({ status: 'done', videoUrl: '/final.mp4' }), false);
assert.match(taskCenterSource, /canContinueNewStoryAdTask\s*\?/);
assert.match(taskCenterSource, /创建时间 \$\{escapeHtml\(created\)\} · 更新时间 \$\{escapeHtml\(updated\)\}/);
assert.match(taskCenterSource, /\(b\.updatedAt \|\| b\.startedAt \|\| 0\) - \(a\.updatedAt \|\| a\.startedAt \|\| 0\)/);
assert.match(taskCenterSource, /\.filter\(taskBelongsToCurrentUser\)/, 'task center must remove stale tasks that belong to another signed-in user');
assert.doesNotMatch(taskCenterSource, /\$\{isNewStoryAdTask\s*\?\s*`<button[^`]+data-new-story-ad-continue/);

store.rememberTaskId('', 1);
assert.equal(values.has('vido_new_story_ad_current_task_id'), false);
assert.equal(new URL(replacedUrl, 'https://example.test').searchParams.has('nsa_task_id'), false);
assert.equal(new URL(replacedUrl, 'https://example.test').searchParams.get('nsa_step'), '1');

store.rememberTaskId('restored-task', 4);
assert.equal(values.get('vido_new_story_ad_current_task_id'), 'restored-task');
assert.equal(new URL(replacedUrl, 'https://example.test').searchParams.get('nsa_task_id'), 'restored-task');
assert.equal(new URL(replacedUrl, 'https://example.test').searchParams.get('nsa_step'), '4');

console.log('new story ad task resume routing: ok');
