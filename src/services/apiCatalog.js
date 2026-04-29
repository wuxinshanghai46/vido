/**
 * OpenAPI 对接能力目录 — 管理端接口账号勾选用，同时驱动 /openapi/* 路由与接口文档。
 * 每一项定义一个"对外能力" key，指向内部一个或多个现有 /api/* 路由。
 */

const CATALOG = [
  // ——— 网剧 ———
  {
    group: 'drama', groupLabel: '网剧生成',
    items: [
      { key: 'drama.create',   label: '创建网剧项目',           method: 'POST', path: '/drama/projects',                                                target: 'POST /api/drama/projects' },
      { key: 'drama.list',     label: '网剧列表',               method: 'GET',  path: '/drama/projects',                                                target: 'GET /api/drama/projects' },
      { key: 'drama.detail',   label: '网剧详情',               method: 'GET',  path: '/drama/projects/:pid',                                           target: 'GET /api/drama/projects/:pid' },
      { key: 'drama.generate', label: '生成一集（异步）',       method: 'POST', path: '/drama/projects/:pid/episodes/:eid/generate',                   target: 'POST /api/drama/projects/:pid/episodes/:eid/generate' },
      { key: 'drama.progress', label: '进度 SSE 流',            method: 'GET',  path: '/drama/projects/:pid/episodes/:eid/progress',                   target: 'GET /api/drama/projects/:pid/episodes/:eid/progress' },
      { key: 'drama.suggest',  label: 'AI 推荐场景参数',        method: 'POST', path: '/drama/suggest-scene-params',                                    target: 'POST /api/drama/suggest-scene-params' },
      { key: 'drama.outline',  label: '生成大纲',               method: 'POST', path: '/drama/generate-outline',                                        target: 'POST /api/drama/generate-outline' },
    ],
  },
  // ——— 剧情/剧本 ———
  {
    group: 'story', groupLabel: '剧情生成',
    items: [
      { key: 'story.generate',  label: '剧情生成',     method: 'POST', path: '/story/generate',                target: 'POST /api/story/generate' },
      { key: 'story.parse',     label: '剧本解析',     method: 'POST', path: '/story/parse-script',            target: 'POST /api/story/parse-script' },
      { key: 'story.charImg',   label: '角色形象图',   method: 'POST', path: '/story/generate-character-image', target: 'POST /api/story/generate-character-image' },
    ],
  },
  // ——— 图生视频 ———
  {
    group: 'i2v', groupLabel: '图生视频',
    items: [
      { key: 'i2v.upload',   label: '上传图片',     method: 'POST', path: '/i2v/upload-image', target: 'POST /api/i2v/upload-image' },
      { key: 'i2v.generate', label: '生成视频',     method: 'POST', path: '/i2v/generate',     target: 'POST /api/i2v/generate' },
      { key: 'i2v.tasks',    label: '任务列表',     method: 'GET',  path: '/i2v/tasks',        target: 'GET /api/i2v/tasks' },
      { key: 'i2v.taskInfo', label: '任务详情',     method: 'GET',  path: '/i2v/tasks/:id',    target: 'GET /api/i2v/tasks/:id' },
    ],
  },
  // ——— 数字人 ———
  {
    group: 'avatar', groupLabel: '数字人',
    items: [
      { key: 'avatar.generate',   label: '生成数字人视频',    method: 'POST', path: '/avatar/generate',           target: 'POST /api/avatar/generate' },
      { key: 'avatar.presets',    label: '预设形象/背景',     method: 'GET',  path: '/avatar/presets',            target: 'GET /api/avatar/presets' },
      { key: 'avatar.voiceList',  label: '可用音色列表',      method: 'GET',  path: '/avatar/voice-list',         target: 'GET /api/avatar/voice-list' },
      { key: 'avatar.uploadImg',  label: '上传头像',          method: 'POST', path: '/avatar/upload-image',       target: 'POST /api/avatar/upload-image' },
      { key: 'avatar.uploadAudio',label: '上传驱动音频',      method: 'POST', path: '/avatar/upload-audio',       target: 'POST /api/avatar/upload-audio' },
    ],
  },
  // ——— 漫画 ———
  {
    group: 'comic', groupLabel: '漫画生成',
    items: [
      { key: 'comic.create', label: '创建漫画',  method: 'POST', path: '/comic/projects',       target: 'POST /api/comic/projects' },
      { key: 'comic.list',   label: '漫画列表',  method: 'GET',  path: '/comic/projects',       target: 'GET /api/comic/projects' },
      { key: 'comic.detail', label: '漫画详情',  method: 'GET',  path: '/comic/projects/:pid',  target: 'GET /api/comic/projects/:pid' },
    ],
  },
  // ——— 工作台: 声音克隆 ———
  {
    group: 'voice', groupLabel: '声音克隆',
    items: [
      { key: 'voice.clone', label: '上传并克隆声音',  method: 'POST', path: '/workbench/upload-voice', target: 'POST /api/workbench/upload-voice' },
      { key: 'voice.list',  label: '我的声音',        method: 'GET',  path: '/workbench/voices',        target: 'GET /api/workbench/voices' },
    ],
  },
];

// 扁平化 → { key: item } 便于查找
const _flat = {};
for (const g of CATALOG) for (const it of g.items) _flat[it.key] = { ...it, group: g.group, groupLabel: g.groupLabel };

function listCatalog() { return CATALOG; }
function getItem(key) { return _flat[key] || null; }
function allKeys() { return Object.keys(_flat); }

// 输入一个请求的 method + path，判断它是否命中某个 catalog key
// path 里允许通配，例如 /drama/projects/:pid 匹配实际 /drama/projects/abc123
function matchCatalogKey(method, reqPath) {
  const m = (method || '').toUpperCase();
  const cleanPath = reqPath.split('?')[0].replace(/\/+$/, '') || '/';
  for (const item of Object.values(_flat)) {
    if (item.method.toUpperCase() !== m) continue;
    const pattern = item.path.replace(/\/+$/, '') || '/';
    // 把 :param 换成正则段
    const regex = new RegExp('^' + pattern.replace(/:[^\/]+/g, '[^/]+') + '$');
    if (regex.test(cleanPath)) return item.key;
  }
  return null;
}

module.exports = { listCatalog, getItem, allKeys, matchCatalogKey };
