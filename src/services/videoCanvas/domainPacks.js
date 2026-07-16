const { normalizeGraph } = require('./graphService');

function node(id, type, x, y, config = {}, label = '') { return { id, type, version: 1, label, position: { x, y }, config }; }
function edge(id, source, sourcePort, target, targetPort) { return { id, source, sourcePort, target, targetPort }; }

const PACKS = Object.freeze({
  blank: { id: 'blank', label: '自由画布', description: '从空白画布自由组合文字、图片、视频、语音和合成节点。', accent: '#5b6df8' },
  ecommerce: { id: 'ecommerce', label: '电商广告', description: '商品卖点、主图、详情页与商品短视频工作流。', accent: '#ff8a4c' },
  story: { id: 'story', label: '故事剧情', description: '画布内独立的故事大纲、镜头、画面和视频流程。', accent: '#8b5cf6' },
  'social-ad': { id: 'social-ad', label: '社媒广告', description: '钩子文案、口播、信息流镜头和多比例导出。', accent: '#ec4899' },
  'product-demo': { id: 'product-demo', label: '产品演示', description: '功能拆解、演示脚本、屏幕镜头和解说视频。', accent: '#14b8a6' },
});

const TEMPLATES = Object.freeze([
  template('blank-basic', 'blank', '基础视频链路', '文字构思 → 图片 → 视频 → 合成', [
    node('idea', 'text-input', 80, 180, { text: '请填写视频主题和目标' }, '创作目标'),
    node('image', 'image-generate', 380, 180, { prompt: '根据创作目标生成电影感首帧', aspectRatio: '16:9' }, '生成首帧'),
    node('video', 'image-to-video', 680, 180, { prompt: '自然、稳定的镜头运动', duration: 5, aspectRatio: '16:9' }, '生成视频'),
    node('merge', 'merge', 980, 180, {}, '合成导出'),
  ], [edge('e1','idea','text','image','prompt'), edge('e2','image','image','video','image'), edge('e3','idea','text','video','prompt'), edge('e4','video','video','merge','video')]),
  template('ecommerce-15s', 'ecommerce', '15 秒商品广告', '卖点策划、商品画面、动态视频和交付', [
    node('brief','text-input',60,160,{text:'填写商品、目标人群、核心卖点和平台'},'商品简报'),
    node('selling','text-generate',340,80,{prompt:'提炼三条可视化商品卖点，语言简洁可信'},'卖点分析'),
    node('visual','image-generate',620,80,{prompt:'生成干净高级的商品广告主视觉，突出商品主体',aspectRatio:'9:16'},'商品主视觉'),
    node('motion','image-to-video',900,80,{prompt:'商品广告运镜，缓慢推进并突出材质细节',duration:5,aspectRatio:'9:16'},'商品动态镜头'),
    node('voice','voice',620,300,{speed:1.05},'广告配音'),
    node('merge','merge',1190,180,{},'广告合成'),
  ], [edge('e1','brief','text','selling','prompt'),edge('e2','selling','text','visual','prompt'),edge('e3','visual','image','motion','image'),edge('e4','selling','text','motion','prompt'),edge('e5','selling','text','voice','text'),edge('e6','motion','video','merge','video'),edge('e7','voice','audio','merge','audio')]),
  template('story-short', 'story', '故事剧情短片', '故事构思、镜头文本、画面和剧情视频', [
    node('idea','text-input',60,180,{text:'填写故事主题、人物、冲突和结局'},'故事想法'),
    node('outline','text-generate',340,80,{prompt:'写出紧凑的短片故事大纲，包含开端、冲突、转折和结局'},'故事大纲'),
    node('shot','structured-text',620,80,{prompt:'把故事大纲整理为可拍摄的镜头描述 JSON'},'镜头规划'),
    node('frame','image-generate',900,80,{prompt:'根据镜头规划生成故事关键画面，角色和场景清晰',aspectRatio:'16:9'},'剧情画面'),
    node('clip','image-to-video',1180,80,{prompt:'根据剧情动作生成自然连续的镜头运动',duration:5,aspectRatio:'16:9'},'剧情片段'),
    node('merge','merge',1460,80,{},'剧情合成'),
  ], [edge('e1','idea','text','outline','prompt'),edge('e2','outline','text','shot','prompt'),edge('e3','shot','text','frame','prompt'),edge('e4','frame','image','clip','image'),edge('e5','shot','text','clip','prompt'),edge('e6','clip','video','merge','video')]),
  template('social-hook', 'social-ad', '社媒钩子广告', '受众钩子、口播、竖屏镜头和字幕', [
    node('goal','text-input',60,180,{text:'填写平台、目标受众、产品和转化目标'},'营销目标'),
    node('hook','text-generate',340,100,{prompt:'生成前三秒有冲击力、不过度夸张的广告钩子和口播'},'钩子文案'),
    node('visual','image-generate',620,100,{prompt:'生成适合信息流的竖屏广告首帧，主体明确',aspectRatio:'9:16'},'信息流画面'),
    node('clip','image-to-video',900,100,{prompt:'快节奏信息流运镜，主体稳定',duration:5,aspectRatio:'9:16'},'信息流视频'),
    node('subtitle','subtitle',1180,100,{},'字幕'),
    node('merge','merge',1460,100,{},'多平台导出'),
  ], [edge('e1','goal','text','hook','prompt'),edge('e2','hook','text','visual','prompt'),edge('e3','visual','image','clip','image'),edge('e4','hook','text','clip','prompt'),edge('e5','clip','video','subtitle','video'),edge('e6','hook','text','subtitle','text'),edge('e7','subtitle','video','merge','video')]),
  template('product-demo-basic', 'product-demo', '产品功能演示', '功能清单、演示脚本、画面和解说', [
    node('features','text-input',60,180,{text:'填写产品功能、使用步骤和目标用户'},'功能清单'),
    node('script','text-generate',340,100,{prompt:'生成清晰的产品演示脚本，逐步说明操作和价值'},'演示脚本'),
    node('visual','image-generate',620,100,{prompt:'生成整洁的产品演示画面或界面示意',aspectRatio:'16:9'},'演示画面'),
    node('clip','image-to-video',900,100,{prompt:'平稳的产品演示镜头，突出关键操作区域',duration:5,aspectRatio:'16:9'},'演示视频'),
    node('voice','voice',900,320,{speed:1},'解说配音'),
    node('merge','merge',1190,180,{},'演示成片'),
  ], [edge('e1','features','text','script','prompt'),edge('e2','script','text','visual','prompt'),edge('e3','visual','image','clip','image'),edge('e4','script','text','clip','prompt'),edge('e5','script','text','voice','text'),edge('e6','clip','video','merge','video'),edge('e7','voice','audio','merge','audio')]),
]);

function template(id, packId, name, description, nodes, edges) { return { id, packId, name, description, graph: normalizeGraph({ nodes, edges }) }; }
function listPacks() { return Object.values(PACKS); }
function listTemplates(packId = '') { return TEMPLATES.filter(item => !packId || item.packId === packId); }
function getTemplate(templateId) { return TEMPLATES.find(item => item.id === templateId) || null; }

module.exports = { getTemplate, listPacks, listTemplates, PACKS, TEMPLATES };
