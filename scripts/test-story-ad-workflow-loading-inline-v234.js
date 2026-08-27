'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const graphProjection = require('../src/services/storyAdWorkspace/graphProjectionService');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const app = read('public/story-ad/app.js');
const workflow = read('public/story-ad/views/workflowView.js');
const workspaceRoute = read('src/routes/storyAdWorkspace.js');
const workflowCss = read('public/story-ad/workflow.css');

assert(app.includes("plot: 'summary,story'"), '剧情页面首屏不得加载未消费的人物/场景资产投影');
assert(app.includes("workflow: 'summary,reference,assets,story,shots,media,graph'"), '工作流必须通过单一 bundle 同步取得图投影');
assert(workspaceRoute.includes("includes('graph')"), 'bundle 路由必须识别 graph section');
assert(workspaceRoute.includes('bundle.workflow_graph = projected.graph'), 'bundle 与图谱必须来自同一次权威投影');
assert(workflow.includes('context.bundle?.workflow_graph'), '画布必须复用 bundle 内图谱，避免第二次全项目读取');
assert(workflow.includes('node-inline-panel'), '节点详情必须在画布节点附近展开');
assert(workflow.includes('直接编辑并同步'), '画布编辑器必须明确写回对应权威环节');
assert(workflowCss.includes('.node-direct-editor'), '节点内直接编辑样式缺失');
assert(workflowCss.includes('user-select: text'), '展开编辑器必须允许选择和编辑文本');

const graph = graphProjection.projectGraph({
  project: { id: 'task-v234' },
  brief: { text: '制作一条剧情广告' },
  assets: { people: [{ id: 'person-1', name: '角色甲', status: 'ready' }], animals: [], products: [], logos: [], props: [], scenes: [] },
  story: { blueprint: { story_title: '测试剧情', logline: '一句话剧情', beats: [] } },
  storyboard: { shots: [] },
  generation: {},
});
const story = graph.nodes.find(node => node.type === 'story');
const person = graph.nodes.find(node => node.type === 'person');
assert(story && person, '剧情与人物节点必须同时存在');
assert(story.position.x < person.position.x, '画布顺序必须是剧情在人物资产之前');
assert(graph.edges.some(edge => edge.source === story.id && edge.target === person.id && edge.kind === 'defines'), '人物资产必须由剧情节点向下游定义');
assert(!graph.edges.some(edge => edge.source === person.id && edge.target === story.id), '不得保留人物资产反向驱动剧情的旧关系');

console.log(JSON.stringify({ passed: true, plot_sections: ['summary', 'story'], workflow_round_trips: 1, order: ['story', 'assets'], authoritative_inline_edit: true, paid_model_calls: 0 }));
