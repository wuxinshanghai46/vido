const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const brief = read('public/story-ad/views/briefDialoguePanel.js');
const briefProjection = read('public/story-ad/views/briefDialogueProjection.js');
const plot = read('public/story-ad/views/plotRoomView.js');
const plotEditor = read('public/story-ad/views/plotBeatEditor.js');
const scene = read('public/story-ad/views/sceneWorldPage.js');
const scenePromptPreview = read('public/story-ad/views/scenePromptPreview.js');
const storyboard = read('public/story-ad/views/storyboardView.js');
const dialogueCss = read('public/story-ad/dialogue-theme.css');
const workspaceCss = read('public/story-ad/workspace.css');
const workspaceUxCss = read('public/story-ad/workspace-ux.css');

assert.match(brief, /briefIdeaPreview/, '对话提问必须使用核心创意摘要而不是整段历史');
assert.match(briefProjection, /brief-idea-details[\s\S]*查看完整设想/, '完整历史设想必须按需展开，不能直接撑高首屏');
assert.match(brief, /data-dialogue-professional>手动编辑/, '对话立项必须保留明确的手动编辑入口');
assert.match(dialogueCss, /brief-conversation-scroll\{[^}]*min-height:0;overflow:auto/, '对话记录必须在弹性区域内局部滚动，输入区不能被推到页面底部');

assert.match(plot, /AI 补全剧情/, '参考投影为空壳时必须提供完整剧情补全主操作');
assert.match(plot, /beat-table-head/, '剧情页必须使用顺序表呈现主流程');
assert.match(plot, /data-beat-floating-editor/, '复杂字段必须收进按需打开的镜头编辑器');
assert.match(plotEditor, /data-beat-summary="title"[\s\S]*data-beat-summary="visual"[\s\S]*beat-visual-cell/, '情节点标题必须并入画面列，不能脱离表头另起错位行');
assert.match(workspaceUxCss, /beat-overview\{[^}]*grid-template-columns/, '剧情顺序表必须有稳定列布局');
assert.match(workspaceUxCss, /beat-table-head,.beat-overview\{[^}]*min-width:/, '窄屏剧情列表必须保留内部横向滚动所需的稳定列宽');

assert.match(scenePromptPreview, /data-scene-detail-tab="prompt"/, '每个场景必须提供提示词标签页');
assert.match(scenePromptPreview, /data-scene-detail-tab="images"/, '每个场景必须提供场景画面标签页');
assert.match(scene, /scene-production-grid/, '场景提示词与画面必须使用清晰的自适应卡片网格');
assert.match(workspaceUxCss, /scene-production-grid\{[^}]*auto-fit/, '单场景必须占满可用宽度，多场景自动换行');
assert.match(workspaceUxCss, /scene-production-tabs[^}]*font-size:12px/, '场景页标签和提示不得继续使用过大的字号');
assert.match(storyboard, /shot-table-scroll/, '分镜宽表只能在表格内部横向滚动');
assert.match(storyboard, /shot-duration/, '分镜主表必须直接显示时长');
assert.match(`${workspaceCss}\n${workspaceUxCss}`, /shot-row[\s\S]*min-width:\s*1120px/, '分镜表必须保留可读列宽');
assert.match(storyboard, /function sketchGateReason[\s\S]*\[object Object\]/, '历史审核原因对象必须转换为用户可读文本');
assert.doesNotMatch(storyboard, /disabled'\}>\$\{sketchGate\.ready[\s\S]*文字分镜审核未通过/, '审核失败状态不能伪装成不可点击主按钮');

console.log(JSON.stringify({ passed: true, checks: 18, scope: 'story-ad-workspace-ux-v100' }));
