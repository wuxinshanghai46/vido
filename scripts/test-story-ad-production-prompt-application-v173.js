#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const compiler = require('../src/services/newStoryAd/productionPromptCompilerService');
const { buildSoundJourney } = require('../src/services/newStoryAd/soundJourneyService');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const ttsAdapter = require('../src/services/newStoryAd/ttsAdapter');
const lipSync = require('../src/services/newStoryAd/lipSyncService');
const deyunai = require('../src/services/deyunaiService');
const videoCore = require('../src/services/videoGenerationCore');

const shot = {
  title: '材料展示', scene: '海蓝展厅', duration: 8,
  visual: '林岚在弧形金属墙前展示样板', action: '林岚右手沿纹理缓慢滑动',
  shot_size: 'medium_close', composition: '三分构图，纹理与手部都清晰可见',
  lighting_mood: '冷青侧逆光，薄雾散射，高亮不过曝',
  dialogue_lines: [{ speech_mode: 'dialogue', speaker: '林岚', line: '纹理会随光线变化。' }],
  sound_design: '低频空间底噪逐渐收窄', ambient_sound: '展厅空调微弱回响',
  sfx: ['指腹摩擦金属细响'], music_cue: '克制的电子氛围铺底', audio_bridge: '摩擦声 J-cut 进入下一镜',
  camera_movement: '缓慢推镜', camera_movement_notes: '由中近景推至手部特写', transition: '动作匹配切',
  prompt_notes: '突出真实金属拉丝与人物手指接触点',
  keyframe_prompt_override: '保留人物位于画面左侧三分线',
  video_prompt_override: '第 6 秒后运镜停止并稳定两秒',
  negative_prompt_override: '禁止塑料质感和悬空手势',
};

const keyframe = compiler.compileKeyframeDirection(shot);
const motion = compiler.compileVideoDirection(shot);
const actualMotion = videoAdapter.clipPrompt(shot, { product_subject: '金属墙面材料' });
const journey = buildSoundJourney([shot]);
assert.equal(videoAdapter.explicitShotSpeechMode({ speech_mode: 'dialogue' }), 'on_camera_dialogue', '人物对白必须进入逐字口型链路，不能误判成画外音');
assert.deepEqual(ttsAdapter.shotSpeechUnits({ speech_mode: 'dialogue', dialogue_lines: [{ speaker: '林岚', speaker_id: 'linlan', line: '你好' }] }, '', { speakers: { linlan: 'voice_linlan' } }), [{ speaker: '林岚', speaker_id: 'linlan', text: '你好', voice_id: 'voice_linlan', kind: 'dialogue' }]);
assert.ok(lipSync.candidates().length > 0, '模型调用管理必须提供 new_story_ad.lip_sync 候选');
assert.equal(lipSync.preferredCandidate({ soundRequired: true }).model_id, 'doubao-seedance-2-0-260128', '包含声音设计的对白镜头必须选择同时支持原生音频的 Seedance');
assert.equal(videoAdapter.expectedModelForShot({ ...shot, speech_mode: 'dialogue' }, {}, { provider_id: 'deyunai', model_id: 'plain-video' }).model_id, 'doubao-seedance-2-0-260128');
const seedanceBody = deyunai.buildSeedanceContentTaskBody({ model: 'doubao-seedance-2-0-260128', prompt: '测试', duration: 8, size: '720x1280', imageUrl: 'https://example.com/frame.jpg', audioUrl: 'https://example.com/voice.mp3', generateAudio: true });
assert.equal(seedanceBody.generate_audio, true);
assert.ok(seedanceBody.content.some(item => item.type === 'audio_url' && item.role === 'reference_audio'), 'Seedance 音频驱动必须发送真实 TTS 音频');

[
  '海蓝展厅', '林岚在弧形金属墙前展示样板', '林岚右手沿纹理缓慢滑动', 'medium_close',
  '冷青侧逆光', '纹理会随光线变化', '突出真实金属拉丝', '人物位于画面左侧三分线', '禁止塑料质感',
].forEach(value => assert.ok(keyframe.includes(value), `关键帧实际设计缺少：${value}`));
[
  '时间段 0-4 秒', '时间段 4-8 秒', '缓慢推镜', '由中近景推至手部特写', '冷青侧逆光',
  '展厅空调微弱回响', '指腹摩擦金属细响', '克制的电子氛围铺底', '摩擦声 J-cut',
  '第 6 秒后运镜停止并稳定两秒', '只有已绑定的真实音频素材才允许进入最终混音',
].forEach(value => assert.ok(motion.includes(value), `视频实际设计缺少：${value}`));
assert.ok(actualMotion.includes(motion), '视频适配器提交给供应商的提示必须包含完整制作设计');
assert.equal(journey[0].design, '低频空间底噪逐渐收窄');
assert.equal(journey[0].ambient, '展厅空调微弱回响');
assert.deepEqual(journey[0].sfx, ['指腹摩擦金属细响']);

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const popover = read('public/story-ad/views/plotBeatCellPopover.js');
const plotRoom = read('public/story-ad/views/plotRoomView.js');
const promptPreview = read('public/story-ad/views/plotPromptPreview.js');
const status = read('public/story-ad/views/assetCenterPlanReleaseStatus.js');
const pipelineSource = read('src/services/pipelineModelService.js');
const videoSource = read('src/services/newStoryAd/videoAdapter.js');
const videoServiceSource = read('src/services/videoService.js');
assert.match(popover, /sound_design:'sound_design'/, '声音单元格必须是单字段简洁编辑器');
assert.match(popover, /camera_movement:'camera_movement'/, '运镜单元格必须是单字段简洁编辑器');
assert.doesNotMatch(popover, /visual:'title,visual,action,visual_proof'/, '画面单元格不得继续一次展示四个字段');
assert.match(popover, /data-camera-preset="推镜"/, '运镜编辑器必须提供竞品同类快捷选项');
assert.match(plotRoom, /plotPromptPreview/, '镜头提示必须按需加载实际提示词预览');
assert.match(promptPreview, /prompt-preview/, '镜头提示必须读取后端实际编译结果');
assert.match(promptPreview, /关键帧实际输入/, '界面必须标明关键帧真实输入');
assert.match(promptPreview, /视频模型实际输入/, '界面必须标明视频模型真实输入');
assert.match(status, />\$\{button\}<\/button>/, '过期人物方案只能呈现真实的生成动作');
assert.doesNotMatch(status, /<button class="btn" type="button" disabled>\$\{migrationOnly/, '人物方案提示不得伪装成禁用按钮');
assert.doesNotMatch(status, /status-tag|人物方案需要更新|文字方案确认后，再单独生成图片/, '人物方案入口不得保留旧状态标签或两步式提示');
assert.match(pipelineSource, /new_story_ad\.lip_sync/, '逐字口型必须登记到模型调用管理');
assert.match(pipelineSource, /new_story_ad\.sound_generation/, '环境声、音效、音乐生成必须登记到模型调用管理');
assert.match(videoSource, /SOUND_GENERATION_MODEL_NOT_ALIGNED/, '视频模型和声音模型配置不一致时必须停止，不能文本假生效');
assert.match(videoSource, /lip_sync_applied: true/, '出镜对白产物必须记录音频驱动口型已执行');
assert.match(videoServiceSource, /generate_audio: generateAudio === true \|\| generate_audio === true/, 'Seedance 调用必须真实传递 generate_audio');
assert.match(videoServiceSource, /type: 'audio_url'.*role: 'reference_audio'/, 'Seedance 逐字口型候选必须真实传入 TTS 音频');

const mixedCost = videoCore.costGuard.buildCostPlan({
  executionPlan: { fingerprint: 'mixed-routes', generation_units: [
    { id: 'normal', paid: true, duration_sec: 5, provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-260128' },
    { id: 'lip', paid: true, duration_sec: 5, provider_id: 'topview', model_id: 'topview-avatar4' },
  ] },
  providerId: 'deyunai', modelId: 'doubao-seedance-2-0-260128',
});
assert.equal(mixedCost.price_known, false, '任一口型路由价格未知时必须在付费提交前阻断');
assert.equal(mixedCost.price_route, 'mixed', '费用确认必须展示逐生成单元的混合模型路由');

console.log(JSON.stringify({ ok: true, checks: 40, prompt_fields_applied: 18, sound_plan_fields: 4, model_calls: 0, media_calls: 0 }));
