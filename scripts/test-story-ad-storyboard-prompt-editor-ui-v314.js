#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const view = read('public/story-ad/views/storyboardView.js');
const dialog = read('public/story-ad/views/storyboardPromptEditorDialog.js');
const css = read('public/story-ad/storyboard-simple.css');
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks += 1; };

function loadDialogModule() {
  const executable = dialog
    .replace(/^import[^\n]+\n/u, '')
    .replaceAll('export function ', 'function ');
  return Function('escapeHtml', 'mediaPreview', 'setButtonBusy', 'toast', `${executable}\nreturn { referenceItemsFor, sketchReferenceMarkup };`)(
    value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    item => `<img src="${item.image_url}">`,
    () => {},
    () => {},
  );
}

async function main() {
  check(view.trimEnd().split(/\r?\n/).length <= 600, 'storyboardView 必须保持 600 行以内');
  check(view.includes('data-expand-sketch-prompt'), '每镜必须有放大编辑入口');
  check(view.includes('class="sketch-prompt-expand"'), '放大编辑必须使用紧凑图标按钮');
  check(view.includes('aria-label="放大编辑镜头'), '图标按钮必须保留无障碍名称');
  check(!view.includes('⛶ 放大编辑</button>'), '卡片不得显示放大的文字按钮');
  check(view.includes('openStoryboardPromptEditor'), '放大入口必须打开独立提示词弹层');
  check(view.includes('data-ai-assist-sketch-prompt'), '卡片必须提供 AI 帮写按钮');
  check(view.includes('/prompt-assist'), 'AI 帮写必须调用逐镜 prompt-assist 接口');
  check(view.includes("[data-ai-assist-sketch-prompt]')?.addEventListener('click', () => card.querySelector('[data-expand-sketch-prompt]')?.click())"), '卡片 AI 修改必须先打开诊断编辑器，不得直接发起模型调用');
  const assistHandler = view.slice(view.indexOf("card.querySelector('[data-ai-assist-sketch-prompt]')"), view.indexOf("card.querySelector('[data-expand-sketch-prompt]')"));
  check(!assistHandler.includes('saveStoryboardPrompt'), 'AI 帮写不得自动保存');
  check(view.includes('async_start: true'), '单镜和批量生成必须异步启动');
  check(view.includes('target_indexes: targetIndexes'), '批次请求必须提交明确目标镜头');
  check(!view.includes(`/storyboard-images/${'${shotIndex}'}/generate`), '前端不得再调用旧同步单镜生成接口');
  const batchStart = view.slice(view.indexOf('const startSketchBatch'), view.indexOf('batchButton?.addEventListener'));
  check(batchStart.indexOf("method: 'POST'") < batchStart.indexOf('sketchBatchPollTimer = setTimeout(pollSketchBatch, 100)'), 'POST 启动后必须进入 GET 轮询');
  check(view.includes('data-sketch-shot-progress'), '每张镜头卡必须有独立进度宿主');
  check(view.includes('sketchShotProgressMarkup'), '卡片进度必须投影进度条与耗时');
  check(view.indexOf('renderSketchResults(data.sketches, data.progress)') < view.indexOf('renderSketchBatch(data.progress)'), '轮询必须先合并同一批次的完成镜头，再渲染总进度与单镜进度');
  check(view.includes('completedTargets.has(shotIndex)'), '单镜完成状态必须来自批次 completed_indexes，不能把旧图片误判为本轮完成');
  const promptSave = view.slice(view.indexOf('async function saveStoryboardPrompt'), view.indexOf('async function assistStoryboardPrompt'));
  check(!promptSave.includes('await context.refreshShell()'), '提示词保存成功后不得等待完整页面外壳刷新');
  check(promptSave.includes("void store.refreshSections?.('summary,shots')"), '保存后必须在后台定向同步提示词与镜头状态');
  check(/mainSketchAction\}\$\{shots\.length.*data-confirm-storyboard/.test(view), '确认分镜按钮必须紧邻全部重新生成按钮');
  const confirmAction = view.slice(view.indexOf("host.querySelector('[data-confirm-storyboard]')"), view.indexOf("host.querySelectorAll('[data-storyboard-page]')"));
  check(confirmAction.includes("refreshSections: 'summary'"), '确认分镜后必须读取服务器最新导航状态');
  check(!confirmAction.includes('skipRefresh'), '确认分镜不得带着旧导航状态立即跳转');
  check(confirmAction.indexOf('navigation?.steps?.final') < confirmAction.indexOf('context.navigate'), '必须先确认视频阶段已解锁，再进入下一步');
  check(!view.includes('class="storyboard-next-action"'), '页面底部不得重复显示整条确认栏');
  check(css.includes('.storyboard-prompt-dialog-backdrop'), '必须提供全屏弹层样式');
  check(/width:min\(1120px,96vw\)/.test(css), '弹层必须接近竞品的大尺寸编辑体验');
  check(/\.storyboard-prompt-dialog-content\{[^}]*grid-template-rows:auto auto auto minmax\(360px,1fr\)[^}]*overflow:auto/.test(css), 'AI 修改要求、诊断和提示词必须纵向全宽排列，内容过长时独立滚动');
  check(/\.storyboard-prompt-dialog-reference-grid\{[^}]*display:flex[^}]*overflow-x:auto/.test(css), '引用资产必须横向排列，不能挤压提示词编辑区');
  check(/\.storyboard-prompt-dialog-field textarea\{[^}]*padding:20px 22px[^}]*line-height:1\.95/.test(css), '长提示词必须使用舒适的内边距和行距');
  check(css.includes('.storyboard-prompt-dialog-reference-grid'), '弹层必须完整展示引用缩略图');
  check(css.includes('.sketch-shot-progress'), '卡片必须有可见进度条样式');
  check(/\.storyboard-simple-view \.sketch-actions\s*\{[^}]*display:grid[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)[^}]*width:100%/.test(css), '四个卡片操作必须同一行平铺');
  check(/\.sketch-prompt-expand\{[^}]*width:27px[^}]*height:27px/.test(css), '放大编辑图标必须保持小尺寸');
  check(dialog.includes('AI 帮写只会更新当前草稿'), '弹层必须明确 AI 帮写不自动保存和生成');
  check(dialog.includes('data-dialog-ai-instruction'), '弹层必须允许普通用户描述具体不一致问题');
  check(dialog.includes('data-dialog-ai-advice'), '弹层必须展示诊断、修改点和明确下一步');
  check(dialog.includes('AI 诊断并改写'), 'AI 操作必须表达先诊断再改写');
  check(dialog.includes('syncDraft(result?.prompt_text || result)'), 'AI 返回值必须只写入当前提示词草稿');
  check(dialog.includes('data-dialog-save-prompt'), '弹层必须提供保存入口');
  check(dialog.includes('data-close-prompt-dialog'), '弹层必须提供关闭入口');

  const namespace = loadDialogModule();
  const references = namespace.referenceItemsFor({ storyboard: { reference_packs: [{ shot_index: 5, references: [
    { role: 'scene_identity', url: '/scene.png', required: true },
    { role: 'person_identity_actor', url: '/person.png', required: false },
  ] }] } }, 0, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(references.map(item => [item.label, item.source, item.order]))), [
    ['场景', '场景主视图', 1], ['人物', '人物身份参考', 2],
  ]);
  checks += 1;
  const markup = namespace.sketchReferenceMarkup(references, 5);
  check(markup.includes('场景主视图 · 生成必需'), '卡片引用必须显示中文角色和必需状态');
  check(markup.includes('人物身份参考 · 辅助参考'), '卡片引用必须显示辅助参考状态');
  console.log(`STORYBOARD_PROMPT_EDITOR_UI_V314_OK checks=${checks} model_calls=0 paid_calls=0`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
