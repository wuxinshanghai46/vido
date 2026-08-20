const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const brief = read('public/story-ad/views/briefDialoguePanel.js');
const plot = read('public/story-ad/views/plotRoomView.js');
const scene = read('public/story-ad/views/sceneWorldPage.js');
const storyboard = read('public/story-ad/views/storyboardView.js');
const dialogueCss = read('public/story-ad/dialogue-theme.css');
const workspaceCss = read('public/story-ad/workspace.css');

assert.match(brief, /briefIdeaPreview[\s\S]*IDEA_SECTION_MARKER/, '长历史设想必须先投影为核心创意摘要');
assert.match(brief, /brief-idea-details[\s\S]*查看完整设想/, '完整历史设想必须按需展开，不能直接撑高首屏');
assert.match(brief, /data-open-history-edit data-history-safe/, '只读历史步骤必须在输入区提供明确编辑入口');
assert.match(dialogueCss, /brief-conversation-scroll\{[^}]*max-height:390px/, '对话记录必须局部滚动，输入区不能被推到页面底部');

assert.match(plot, /AI 补全剧情、动作与对白/, '参考投影为空壳时必须提供完整剧情补全主操作');
assert.match(plot, /beat-table-head/, '剧情页必须使用顺序表呈现主流程');
assert.match(plot, /data-beat-editor hidden/, '复杂字段必须收进逐段编辑区');
assert.match(workspaceCss, /beat-overview\{[^}]*grid-template-columns/, '剧情顺序表必须有稳定列布局');

assert.match(scene, /scene-queue-grid/, '场景生成队列必须使用独立自适应网格');
assert.match(workspaceCss, /scene-queue-grid\{[^}]*auto-fit/, '单场景不得只占三分之一宽度并留下大块空白');
assert.match(storyboard, /shot-table-scroll/, '分镜宽表只能在表格内部横向滚动');
assert.match(storyboard, /shot-duration/, '分镜主表必须直接显示时长');
assert.match(workspaceCss, /shot-row[\s\S]*min-width:\s*1120px/, '分镜表必须保留可读列宽');

console.log(JSON.stringify({ passed: true, checks: 13, scope: 'story-ad-workspace-ux-v95' }));
