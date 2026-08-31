#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function main() {
  const root = path.resolve(__dirname, '..');
  const view = fs.readFileSync(path.join(root, 'public/story-ad/views/finalSoundDesignView.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public/story-ad/workspace-ux.css'), 'utf8');
  const avatar = fs.readFileSync(path.join(root, 'src/routes/avatar.js'), 'utf8');

  assert(view.includes('data-preview-selected-voice'), '每个旁白或对白音色选择器旁必须提供试听入口');
  assert(view.includes("request('/api/avatar/preview-voice'"), '音色试听必须调用现有真实 TTS 试听接口');
  assert(view.includes("responseType: 'blob'"), '音色试听必须读取真实音频流而不是展示假状态');
  assert(view.includes('可能产生少量语音费用') && view.includes('优先使用缓存'), '音色试听必须说明费用和缓存边界');
  assert(view.includes('不生成旁白或人物对白'), '关闭人声选项必须直接说明关闭的内容');
  assert(view.includes('这里只关闭人声；背景音乐和场景音效仍可在下方单独选择'), '关闭人声不得让用户误以为音乐和音效也会关闭');
  assert(!view.includes('<b>本片不使用人声</b>'), '废弃的含糊人声文案不得继续参与当前页面');

  assert(view.includes('data-open-bgm-library') && view.includes('<dialog class="bgm-library-dialog"'), '背景音乐查询必须恢复为独立弹窗');
  assert(view.includes('查询与选择背景音乐') && view.includes('先按风格查询，再逐首试听'), '弹窗必须说明查询、试听、采用的顺序');
  assert(view.includes('data-play-sound-preview') && view.includes('data-import-bgm'), '弹窗候选必须同时具备试听和采用动作');
  assert(!view.includes('data-toggle-bgm-library'), '旧的页面内展开音乐库入口必须退出当前合同');
  assert(css.includes('v350 voice preview and background-music library dialog'));
  assert(css.includes('.voice-select-preview') && css.includes('.bgm-library-dialog::backdrop'));
  assert(avatar.includes("router.post('/preview-voice'") && avatar.includes('previewVoiceCacheDir'), '真实音色试听接口与缓存必须仍然存在');

  console.log(JSON.stringify({ ok: true, voice_preview: true, clear_no_voice_copy: true, bgm_dialog: true, bgm_preview_and_select: true, upstream_changed: 0 }));
}

main();
