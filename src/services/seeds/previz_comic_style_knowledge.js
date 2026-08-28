/**
 * 白模预演与漫剧画风知识（2026-08-28）
 *
 * 来源为用户提供的两份本地微信公众号网页存档。白模条目保留文章实测与
 * VIDO 工程判断的边界；画风网页正文声称包含 40 种，但本地存档实际只
 * 带有 25 张可核对的画风卡，因此这里只收录有本地证据的 25 种。
 */

const SOURCE_TITLES = [
  'AI视频的运镜难题，终于被攻克了｜附教程+实测',
  '分享AI漫剧各种不同的画风，不用瞎找关键词',
];

const WHITE_PREVIZ = {
  collection: 'storyboard',
  subcategory: '白模预演',
  id: 'kb_white_model_previsualization_20260828',
  title: '白模预演不是单一模型：场景重建、确定性调度、参考视频生成与一致性验收',
  summary: '用三维白模先锁定空间、人物站位、运动路线和摄影机，再把预演视频交给支持参考视频约束的生成模型；不得把普通图生视频冒充白模控制。',
  content: `白模预演解决的是“先锁空间与运动，再生成画面”，并不是换一个生图模型。完整链路由四层组成：
1. 场景重建层：从多张场景参考图重建可浏览的三维空间，可使用图像到 3D、NeRF、Gaussian Splatting、网格重建或具备同等能力的在线预演服务。重建结果主要提供空间尺度、遮挡和机位依据，不负责最终美术画面。
2. 确定性预演层：在三维编辑器中放置角色代理、道具和相机，用关键帧设置人物路线、相机轨迹、跟随/看向目标、焦段、景深、速度变化与停顿。这一层是时间轴和几何计算，不应伪装成生成模型能力。
3. 视频生成层：把白模录屏/预演视频连同人物、场景和风格参考交给明确支持参考视频、动作迁移、结构控制或相机控制的视频模型。附件文章实测认为 Seedance 2.5 对白模约束较稳定；它同时记录 Seedance 2.0 出现增人、人物前后关系错误等问题。VIDO 当前的 doubao-seedance-2-0-260128 不能仅因名称相近就宣称具备 Seedance 2.5 的白模能力，必须先验证接口是否接受参考视频及其约束强度。
4. 一致性验收层：用视觉模型或确定性检测比较预演与成片的人数、身份、站位、朝向、遮挡关系、进出画时间、相机路径和场景结构；不合格时保留失败响应并进入真实后备路由。

适用场景：多人物调度、一镜到底、绕行/跟随/推拉摇移、复杂空间穿行、严格站位或产品交互。优先从开阔室外或结构清楚的场景开始；狭小室内、密集墙体、镜面和细碎几何会增加重建与遮挡错误。

能力门禁：只有当供应商接口明确支持 video reference / motion reference / camera control，并通过一次不付费的合同检查和一次最小真实样例后，才可标为“白模可用”。只支持文本、首帧或普通图生视频的模型应显示为不支持，不得自动降级后继续收费。`,
  tags: ['白模', '3D预演', '运镜', '场景重建', '人物站位', '参考视频', 'Seedance 2.5', '一致性'],
  keywords: ['white model previz', 'previsualization', 'scene reconstruction', 'camera path', 'character blocking', 'motion reference', 'reference video', 'Seedance 2.5'],
  prompt_snippets: [
    '先输出白模预演合同：场景坐标、人物起终点与朝向、相机轨迹、看向目标、焦段、关键帧时间和不可改变的遮挡关系。',
    '生成后逐项比较预演与成片的人数、站位、路径、机位、进出画时间和空间结构，任何一项漂移都不得判定通过。',
  ],
  applies_to: ['director', 'storyboard', 'art_director', 'character_consistency', 'prompt_engineer', 'project_assistant'],
  lang: 'zh',
  enabled: true,
  source_titles: [SOURCE_TITLES[0]],
  source: '用户提供的本地网页存档；VIDO 按文章实测与平台能力边界结构化整理，2026-08-28',
};

const STYLE_CARDS = [
  ['电影写实', '叙事构图、冷暖分离、真实材质、浅景深和细胶片颗粒', '悬疑、都市、权谋、现实题材', ['cinematic realism', 'low-key lighting', 'realistic materials', 'shallow depth of field', 'fine film grain']],
  ['赛博朋克', '蓝紫霓虹、雨夜反射、电子屏、体积雾和金属玻璃材质', '科幻、未来都市、动作题材', ['cyberpunk', 'neon lights', 'rainy night reflections', 'volumetric fog', 'metal and glass']],
  ['新艺术', '植物曲线、花卉纹样、优雅轮廓、柔和渐变和装饰构图', '浪漫、幻想、女性成长', ['Art Nouveau', 'organic curves', 'floral textures', 'soft gradients', 'decorative composition']],
  ['Riso孔版印刷', '限定色、网点、轻微套印错位和粗糙纸张', '青春、独立叙事、轻喜剧', ['Riso print', 'two-color overprint', 'halftone grain', 'slight misregistration', 'rough paper']],
  ['故障风', 'RGB 通道错位、扫描线、数据破损、数字噪点和残影', '虚拟世界、意识混乱、科技悬疑', ['glitch art', 'RGB channel offset', 'scanlines', 'data corruption', 'digital afterimage']],
  ['黑白默片', '高反差黑白、划痕、暗角、旧胶片颗粒和年代感', '年代、悲剧、回忆', ['black and white silent film', 'high contrast', 'film scratches', 'vignetting', 'period look']],
  ['东方复古', '低饱和棕绿、旧式室内、木质家具、柔和窗光和年代材质', '民国、家族、怀旧', ['oriental retro aesthetic', 'low-saturation brown green', 'old wooden furniture', 'soft window light', 'period textures']],
  ['胶片质感', '暖色偏移、自然曝光、细颗粒、轻微漏光和高光晕染', '青春、旅行、爱情、回忆', ['35mm film', 'warm color shift', 'natural exposure', 'fine grain', 'subtle light leak']],
  ['CCD质感', '直闪、早期数码高饱和、暗部噪点和抓拍感', '校园、聚会、Y2K', ['early digital camera', 'direct flash', 'high saturation', 'dark noise', 'Y2K snapshot']],
  ['美式复古广告', '红黄蓝配色、粗块面、网点和复古海报排版', '喜剧、商业、荒诞', ['American retro advertising', 'red yellow blue palette', 'chunky shapes', 'halftone', 'vintage poster']],
  ['纪实摄影', '自然状态、环境叙事、真实光线、生活质感和非摆拍', '现实、家庭、社会题材', ['documentary photography', 'natural state', 'environmental storytelling', 'real light', 'non-posed']],
  ['街头摄影', '决定性瞬间、动态人物、城市背景、抓拍和运动模糊', '都市、追逐、青春', ['street photography', 'decisive moment', 'urban scene', 'motion blur', 'observational']],
  ['写真人像', '干净背景、柔和侧光、清晰眼神、浅景深和细腻皮肤', '情绪、人物独白、爱情', ['portrait photography', 'soft side light', 'clear eyes', 'shallow depth', 'fine skin']],
  ['定格动画', '手工黏土或毛毡模型、微缩场景、逐格感和可触材质', '童话、治愈、轻幻想', ['stop motion', 'handmade clay model', 'felt texture', 'miniature scene', 'frame-by-frame feeling']],
  ['Q版动画', '大头小身、圆润轮廓、明亮配色和夸张表情', '喜剧、萌系、轻日常', ['chibi style', 'large head small body', 'rounded design', 'bright palette', 'exaggerated expression']],
  ['水彩插画', '透明叠色、湿画法晕染、柔边、留白和水彩纸纤维', '治愈、乡野、成长、爱情', ['watercolor illustration', 'wet bleed', 'transparent washes', 'negative space', 'watercolor paper texture']],
  ['彩铅手绘', '细腻线条、温暖配色、颗粒笔触、纸张纹理和手作感', '日常、可爱、温暖题材', ['colored pencil', 'delicate strokes', 'paper texture', 'warm palette', 'handmade feel']],
  ['铅笔素描', '黑白灰、结构线、交叉排线、层次和纸张肌理', '回忆、人物研究、悬疑草稿', ['pencil sketch', 'graphite line', 'cross hatching', 'grayscale layers', 'paper texture']],
  ['炭笔表现', '粗粝笔触、深重阴影、炭粉颗粒、断裂边缘和强情绪', '悲剧、战争、心理题材', ['charcoal drawing', 'rough strokes', 'high contrast black white', 'charcoal dust', 'broken edges']],
  ['写实油画', '厚涂颜料、古典配色、明暗法、画布纹理和稳定构图', '历史、宫廷、家族史诗', ['realistic oil painting', 'impasto', 'classical palette', 'chiaroscuro', 'canvas texture']],
  ['扁平矢量', '纯色块、清楚硬边、简化造型、大留白和几何光影', '科普、轻喜剧、信息漫剧', ['flat vector illustration', 'flat colors', 'simple outlines', 'limited palette', 'geometric lighting']],
  ['等距插画', '30度轴线、无透视汇聚、模块化空间、统一比例和柔和环境阴影', '商业、职场、空间展示', ['isometric illustration', '30-degree axes', 'modular space', 'unified proportions', 'soft ambient shadows']],
  ['低多边形', '几何切面、平面光影、简化块体、硬折线和雕塑感', '冒险、游戏、幻想', ['low poly', 'geometric facets', 'flat lighting', 'hard folds', 'low-poly modeling']],
  ['像素艺术', '方形像素、限定色板、硬边和复古游戏画面', '游戏穿越、复古冒险、轻喜剧', ['pixel art', '16-bit', 'limited palette', 'square pixels', 'retro game scene']],
  ['分层剪纸', '多层卡纸、镂空轮廓、纸纤维和柔和层间投影', '童话、寓言、传统题材', ['layered paper cut', 'multilayer cardstock', 'hollow contour', 'paper fiber', 'soft cast shadows']],
];

const styleDocs = STYLE_CARDS.map(([name, features, suitable, keywords], index) => ({
  collection: 'atmosphere',
  subcategory: '漫剧画风',
  id: `kb_comic_style_${String(index + 1).padStart(2, '0')}_20260828`,
  title: `漫剧画风：${name}`,
  summary: `${name}的稳定视觉锚点是${features}；适合${suitable}。`,
  content: `选择“${name}”时，不要只附加画风名称。按“主体与动作 + 场景与时代 + 画风名称 + 线条/笔触 + 配色与光线 + 材质/纹理”的顺序写完整视觉合同。\n\n固定特征：${features}。\n适用题材：${suitable}。\n连续性要求：同一项目固定色板、线条粗细、材质颗粒尺度、光影规则和人物比例；换场景时只改变剧情所需内容，不得随机漂移媒介与画风。`,
  tags: ['漫剧画风', name, ...keywords.slice(0, 3)],
  keywords: [name, ...keywords],
  prompt_snippets: [`${name}：${keywords.join(', ')}；在此之前先写清主体、动作、场景和时代。`],
  applies_to: ['art_director', 'prompt_engineer', 'director', 'storyboard', 'character_consistency', 'project_assistant'],
  lang: 'zh',
  enabled: true,
  source_titles: [SOURCE_TITLES[1]],
  source: '用户提供的本地网页存档中可读取的画风卡；VIDO 结构化整理，2026-08-28',
}));

module.exports = [WHITE_PREVIZ, ...styleDocs];
module.exports.STYLE_CARDS = STYLE_CARDS;
