'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const replacement = require('../src/services/newStoryAd/storyboardReplacementLifecycleService');
const flowConsistency = require('../src/services/newStoryAd/storyboardFlowConsistencyService');

function memoryStorage(ttsText = '正确旁白') {
  const outputs = new Map([
    ['context', { shot_confirmed: true, shot_design_confirmed: true }],
    ['storyboard_images', [{ shot_index: 1, image_url: '/old.png' }]],
    ['video_clips', [{ shot_index: 1, video_url: '/old.mp4' }]],
    ['final_video', { video_url: '/old-final.mp4' }],
    ['tts_audio', { tracks: [{ shot_id: 'shot_1', text: ttsText, audio_url: '/voice.mp3' }] }],
    ['audio_approval', { approved: true }],
  ]);
  let task = { request: outputs.get('context') };
  return {
    outputs,
    getTask: () => task,
    getOutput: (_taskId, kind) => outputs.get(kind),
    saveOutput: (_taskId, kind, value) => outputs.set(kind, value),
    deleteOutput: (_taskId, kind) => outputs.delete(kind),
    deleteOutputs: (_taskId, kinds) => kinds.forEach(kind => outputs.delete(kind)),
    updateTask: (_taskId, patch) => { task = { ...task, ...patch }; },
  };
}

const compatible = memoryStorage();
const kept = replacement.finalizeForcedReplacement({
  storage: compatible,
  taskId: 'task-compatible',
  previousTtsAudio: compatible.outputs.get('tts_audio'),
  nextShots: [{ shot_id: 'shot_1', voiceover: '正确旁白' }],
  audioApprovalKind: 'audio_approval',
});
assert.equal(kept.audio_preserved, true);
assert(compatible.outputs.has('tts_audio'), '旁白逐字一致时应保留已有配音，避免重复付费');
assert(!compatible.outputs.has('storyboard_images') && !compatible.outputs.has('video_clips') && !compatible.outputs.has('final_video'), '旧画面与视频必须失效');
assert.equal(compatible.outputs.get('context').shot_design_confirmed, false, '新镜头结构必须由用户重新确认');

const incompatible = memoryStorage('旧旁白');
const removed = replacement.finalizeForcedReplacement({
  storage: incompatible,
  taskId: 'task-incompatible',
  previousTtsAudio: incompatible.outputs.get('tts_audio'),
  nextShots: [{ shot_id: 'shot_1', voiceover: '新旁白' }],
  audioApprovalKind: 'audio_approval',
});
assert.equal(removed.audio_preserved, false);
assert(!incompatible.outputs.has('tts_audio') && !incompatible.outputs.has('audio_approval'), '旁白变化时禁止复用旧配音与审批');
assert(!incompatible.outputs.has('audio_timeline') && !incompatible.outputs.has('audio_license_ledger'), '旁白变化时关联音频时间线也必须失效');

const transitionContract = {
  contract_fingerprint: 'flow-contract-current',
  units: [
    { beat_id: 'beat-1', scene_id: 'scene-a', transition_from: '', transition_reason: '' },
    { beat_id: 'beat-2', scene_id: 'scene-b', transition_from: 'scene-a', transition_reason: '剧情进入产品细节展示空间' },
  ],
};
const transitionRebase = flowConsistency.rebaseWhenPresent([
  { index: 1, source_beat_id: 'beat-1', scene_id: 'stale', transition_from: 'stale', transition_reason: '旧理由' },
  { index: 2, source_beat_id: 'beat-2', scene_id: 'stale', transition_from: '', transition_reason: '' },
  { index: 3, source_beat_id: 'beat-2', scene_id: 'stale', transition_from: 'stale', transition_reason: '旧理由' },
], transitionContract).shots;
assert.deepEqual(
  transitionRebase.map(shot => [shot.scene_id, shot.transition_from, shot.transition_reason]),
  [
    ['scene-a', '', ''],
    ['scene-b', 'scene-a', '剧情进入产品细节展示空间'],
    ['scene-b', '', ''],
  ],
  '剧情流合同必须覆盖模型遗漏或残留的转场字段，拆分剧情节点只在首镜携带场景边界',
);

const root = path.resolve(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'src/routes/newStoryAd.js'), 'utf8');
const view = fs.readFileSync(path.join(root, 'public/story-ad/views/storyboardView.js'), 'utf8');
const service = fs.readFileSync(path.join(root, 'src/services/newStoryAd/storyAdService.js'), 'utf8');
const table = fs.readFileSync(path.join(root, 'src/services/newStoryAd/storyboardTableService.js'), 'utf8');
const recovery = fs.readFileSync(path.join(root, 'src/services/newStoryAd/storyboardCheckpointRecoveryService.js'), 'utf8');
assert.match(route, /const forceRegenerate = body\.force_regenerate === true \|\| body\.forceRegenerate === true/, '路由必须识别强制重建意图');
assert.match(route, /force_regenerate: forceRegenerate/, '路由必须把强制重建意图传到服务层');
assert.match(
  route,
  /allowUnacknowledgedBillingUnknownRetry:\s*forceRegenerate/,
  '用户明确点击结构重建后，历史计费未知记录只能保留审计，不能要求再次确认或阻断排队',
);
assert.match(service, /if \(!forceRegenerate && existingMeta\.status === 'ready'/, '强制重建不得命中旧分镜缓存');
assert.match(service, /const resumeShots = !forceRegenerate &&/, '强制重建不得续用旧检查点镜头');
assert.match(table, /rebaseWhenPresent\([\s\S]{0,180}storyboard_table_normalize/, '新任务生成结果必须先继承剧情流转场合同再绑定场景');
assert.match(recovery, /rebaseWhenPresent\([\s\S]{0,180}storyboard_checkpoint_recovery/, '完整失败检查点必须先继承剧情流转场合同再做零模型恢复');
assert.match(view, /data-regenerate-storyboard-structure/, '错位状态必须展示镜头结构重建入口');
assert.match(view, /force_regenerate: true,[\s\S]*generate_images: false/, '结构重建不得连带生成图片');
assert.match(view, /当前镜头结构与已确认剧情不一致/, '页面必须明确解释为什么不能直接生成旧分镜图');
assert.doesNotMatch(view, /data-regenerate-storyboard-structure[^>]*>[^<]*重新生成分镜</, '结构和图片动作不能再使用含混文案');

console.log('story-ad storyboard structure replacement v408 tests passed');
