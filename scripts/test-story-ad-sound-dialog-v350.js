#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function main() {
  const root = path.resolve(__dirname, '..');
  const view = ['finalSoundDesignView.js', 'soundDesignFeature.js'].map(file => fs.readFileSync(path.join(root, 'public/story-ad/views', file), 'utf8')).join('\n');
  const css = fs.readFileSync(path.join(root, 'public/story-ad/workspace-ux.css'), 'utf8');
  const avatar = fs.readFileSync(path.join(root, 'src/routes/avatar.js'), 'utf8');

  assert(view.includes('data-voice-library-dialog') && view.includes('data-preview-library-voice'), '音色必须在弹窗内提供搜索、试听和选择');
  assert(!view.includes('data-preview-selected-voice'), '页面主表单不得继续把试听按钮放在下拉框旁边');
  assert(view.includes("request('/api/avatar/preview-voice'"), '音色试听必须调用现有真实 TTS 试听接口');
  assert(view.includes("responseType: 'blob'"), '音色试听必须读取真实音频流而不是展示假状态');
  assert(!view.includes('可能产生少量语音费用') && !view.includes('不会自动计费'), '声音选择说明不得用计费提示干扰业务含义');
  assert(view.includes('分镜中的文字要不要被念出来') && view.includes('做成无旁白版本'), '人声选项必须直接解释它控制成片是否念出分镜文字');
  assert(view.includes('纯画面＋字幕＋音乐') && view.includes('背景音乐和场景音效仍然保留'), '无旁白版本必须解释最终成片形态和保留内容');
  assert(!view.includes('<b>本片不使用人声</b>'), '废弃的含糊人声文案不得继续参与当前页面');

  assert(view.includes('data-open-bgm-library') && view.includes('<dialog class="bgm-library-dialog"'), '背景音乐查询必须恢复为独立弹窗');
  assert(view.includes('查询与选择背景音乐') && view.includes('输入歌名或风格后按回车即可查询'), '弹窗必须说明输入内容和回车查询方式');
  assert(view.includes('data-play-sound-preview') && view.includes('data-import-bgm'), '弹窗候选必须同时具备试听和采用动作');
  assert(!view.includes('data-toggle-bgm-library'), '旧的页面内展开音乐库入口必须退出当前合同');
  assert(css.includes('v350 voice preview and background-music library dialog'));
  assert(css.includes('.voice-library-dialog::backdrop') && css.includes('.bgm-library-dialog::backdrop'));
  assert(view.includes('data-voice-library-feedback') && view.includes('data-bgm-library-feedback'), '弹窗内必须有不会被顶层对话框遮挡的错误反馈区');
  assert(css.includes('.dialog-inline-feedback'), '弹窗错误反馈必须具备独立可见样式');
  assert(view.includes("event.key !== 'Enter'") && view.includes('event.preventDefault()'), '背景音乐输入框必须支持回车查询');
  assert(view.includes('dialog-close-button') && css.includes('height:42px;min-height:42px;flex:0 0 42px'), '弹窗关闭按钮必须保持固定正方形');
  assert(avatar.includes("router.post('/preview-voice'") && avatar.includes('previewVoiceCacheDir'), '真实音色试听接口与缓存必须仍然存在');

  console.log(JSON.stringify({ ok: true, voice_preview: true, semantic_voice_choice: true, bgm_enter_search: true, stable_close_button: true, upstream_changed: 0 }));
}

main();
