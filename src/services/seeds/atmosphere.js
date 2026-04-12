/**
 * 氛围库 seed
 *
 * 覆盖：电影感核心、各类氛围范式、Seedream 材质、光影系统、色彩调板 +
 * 经典电影美学 prompt 包（沙丘/BR2049/布达佩斯/寄生虫/花样年华/肖像） +
 * 品牌美学（Apple/Hermes/Chanel）+ 画风美学（吉卜力/新海诚/Caravaggio/Klimt）
 */

module.exports = [

  // —— v1 原有条目 ——
  {
    id: 'kb_atm_cinematic_core',
    collection: 'atmosphere',
    subcategory: '电影感',
    title: '电影感核心关键词集合（cinematic lexicon）',
    summary: '"电影感"= 宽屏 + 浅景深 + 胶片颗粒 + 色彩分级 + 光比控制 + 运动模糊。',
    content: `核心关键词（可直接拼入 visual_prompt 末段）：
- cinematic, filmic look, anamorphic lens, 2.39:1 aspect ratio
- shallow depth of field, bokeh, soft focus background
- film grain, subtle noise, 35mm film emulation
- color graded, teal and orange palette, lifted shadows, rolled-off highlights
- high dynamic range, motivated practical lighting
- subtle motion blur, natural lens flare
- 4K, ultra detailed, sharp focus on subject
配套: Kodak 2383 LUT / ARRI Alexa look / RED Komodo 常作为"看起来像"锚点。`,
    tags: ['电影感', 'cinematic', '胶片'],
    keywords: ['cinematic', 'film grain', 'anamorphic', 'teal and orange', 'bokeh', 'lens flare'],
    prompt_snippets: [
      'cinematic, anamorphic lens, shallow depth of field, film grain',
      'teal and orange color grade, soft lifted shadows',
      'subtle motion blur, natural lens flare, 4K ultra detailed',
    ],
    applies_to: ['director', 'atmosphere', 'storyboard'],
    source: '电影调色 + DOP 通用术语',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_high_contrast_haze',
    collection: 'atmosphere',
    subcategory: '混合范式',
    title: 'High contrast + haze：高对比雾感范式（电影感第一选择）',
    summary: '强明暗对比 + 一层雾/尘埃/烟，是最容易出"电影味"的组合。',
    content: `范式公式：
high contrast, deep shadows, blown-out highlights clipped softly,
volumetric haze in midground, atmospheric dust particles in light beams,
strong key light cutting through, rim light separation,
desaturated palette with one accent color.
使用场景：
- 黑帮 / 悬疑 / 赛博朋克 / 废墟 / 工业场景
- 侦探办公室，阳光穿过百叶窗 + 烟雾 = 经典黑色电影
- 夜晚雨后街道 + 路灯光锥 + 雾 = 都市孤独
参数建议：contrast +30%, shadows -20%, haze density 30-50%。`,
    tags: ['high contrast', 'haze', '电影感', '氛围'],
    keywords: ['high contrast', 'haze', 'volumetric', 'rim light', 'god rays', 'atmospheric dust'],
    prompt_snippets: [
      'high contrast, deep shadows, volumetric haze, god rays',
      'strong key light cutting through atmospheric dust',
      'film noir lighting, venetian blind shadows, cigarette smoke',
    ],
    applies_to: ['director', 'atmosphere'],
    source: '电影摄影黑色电影/赛博朋克通用范式',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_semi_metallic',
    collection: 'atmosphere',
    subcategory: '材质感',
    title: 'Semi-metallic lighting：半金属光泽（科技感/未来感/高级感）',
    summary: '半金属光让画面一眼看上去"有钱 + 未来 + 高端"，是科技片与奢侈品广告常用。',
    content: `关键词组合：
semi metallic lighting, brushed metal reflections, soft specular highlights,
anodized surface, iridescent thin film interference,
chrome accents, mirror-like subtle reflections,
cool steel palette with warm copper accents.
使用场景：
- 科技产品发布画面
- 未来城市 / 赛博角色 / 机甲
- 奢侈品牌广告的首镜
注意：不要和强雾叠加（会损失金属反光），与 rim light 和 practical light 搭配最佳。`,
    tags: ['金属', '材质', '科技感', '未来'],
    keywords: ['semi metallic', 'brushed metal', 'chrome', 'specular', 'iridescent', 'anodized'],
    prompt_snippets: [
      'semi metallic lighting, brushed metal reflections, soft specular highlights',
      'chrome accents with iridescent thin film',
      'cool steel palette with warm copper rim light',
    ],
    applies_to: ['director', 'atmosphere'],
    source: '产品摄影 + 科幻视觉范式',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_volumetric_fog_sparks',
    collection: 'atmosphere',
    subcategory: '天气与烟雾',
    title: 'Volumetric smoke/fog + sparks：体积雾与火花（电影感粒子组合）',
    summary: '体积雾 + 空中火花是"史诗感"最廉价高效的组合。',
    content: `组合拳：
volumetric smoke, drifting fog, dense atmosphere in midground,
floating embers, glowing sparks rising through light beams,
god rays cutting through smoke,
lit practical fires, dust particles in shaft of light.
使用场景：
- 史诗战斗结束后的余烬
- 铁匠铺 / 工厂 / 锻造场
- 火灾后幸存者登场
- 仪式感的告别场景
禁忌：不要让 sparks 过密（会变卡通），每一簇 5-15 颗最佳。`,
    tags: ['雾', '火花', 'sparks', 'volumetric'],
    keywords: ['volumetric fog', 'smoke', 'sparks', 'embers', 'god rays', 'dust shaft'],
    prompt_snippets: [
      'volumetric smoke and drifting fog, floating embers rising',
      'god rays cutting through smoke, dust particles in light shaft',
      'glowing sparks in the air, soft bokeh background',
    ],
    applies_to: ['director', 'atmosphere'],
    source: '电影 VFX 通用范式',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_seedream5_textures',
    collection: 'atmosphere',
    subcategory: '材质感',
    title: 'Seedream 5.0 材质感提示词集合（皮肤/织物/金属/液体/玻璃/皮革）',
    summary: 'Seedream 5.0 对材质描述响应好，给出具体的 texture 关键词能显著提升真实感。',
    content: `按材质分类的关键词：
- 皮肤 skin: subsurface scattering, pore detail, natural skin texture, soft diffusion
- 织物 fabric: woven linen texture, cotton weave, silk sheen, velvet nap, knit pattern
- 金属 metal: brushed aluminum, polished chrome, oxidized copper, rusted iron, hammered gold
- 液体 liquid: refractive water, caustic light patterns, foam bubbles, ripple surface
- 玻璃 glass: refraction, chromatic aberration at edges, subtle fingerprints, frosted translucency
- 皮革 leather: worn leather texture, stitched seams, natural grain, subtle sheen
- 木材 wood: wood grain texture, knots, aged patina, hand-planed surface
使用原则：一个镜头只强调 1-2 个材质，太多会混乱。`,
    tags: ['seedream', '材质', 'texture'],
    keywords: ['seedream 5.0', 'texture', 'material', 'subsurface scattering', 'caustics'],
    prompt_snippets: [
      'subsurface scattering skin, pore detail, natural diffusion',
      'brushed aluminum texture with polished chrome highlights',
      'refractive water with caustic light patterns',
      'worn leather with stitched seams and natural grain',
    ],
    applies_to: ['director', 'atmosphere'],
    source: '抖音 @阿拉赛博蕾《seedance2.0+seedream5.0高级玩法》合成整理 + Seedream 公开提示词经验',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_golden_blue_hour',
    collection: 'atmosphere',
    subcategory: '光影',
    title: 'Golden hour / Blue hour 两大黄金光线时刻',
    summary: '黄金时刻 = 浪漫怀旧暖金光，蓝色时刻 = 忧郁宁静冷蓝调。',
    content: `Golden hour（日出后 / 日落前 1 小时）:
warm amber tones, low sun angle, long shadows, soft diffused glow,
honey-colored light, lens flare, romantic nostalgic mood,
skin looks radiant, backlit hair with rim light.

Blue hour（日落后 / 日出前 30 分钟）:
cool blue palette, ambient skylight, practical lights starting to show,
melancholic contemplative mood, transition between worlds,
city lights beginning to glow, reflections on wet streets.

两者交替使用可制造"从希望到失落"的情绪曲线。`,
    tags: ['golden hour', 'blue hour', '光影'],
    keywords: ['golden hour', 'blue hour', 'magic hour', 'warm amber', 'cool blue'],
    prompt_snippets: [
      'golden hour lighting, warm amber tones, long shadows, lens flare',
      'blue hour ambience, cool blue palette, city lights beginning to glow',
      'backlit character with rim light during golden hour',
    ],
    applies_to: ['director', 'atmosphere'],
    source: '电影摄影通用光线术语',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_color_palette_formulas',
    collection: 'atmosphere',
    subcategory: '色彩',
    title: '6 组经典电影色彩调板公式',
    summary: 'Teal & Orange / Desaturated / Monochrome / Bleach Bypass / Technicolor / Duotone。',
    content: `1) Teal & Orange：蓝绿阴影 + 橙色肤色，好莱坞现代动作片标配
2) Desaturated：低饱和 + 冷色，纪录片 / 战争 / 绝望
3) Monochrome：单色（通常墨蓝或乌金），文艺 / 回忆 / 时尚
4) Bleach Bypass：漂白旁路，高对比 + 低饱和 + 银色高光，冷硬派 / 犯罪
5) Technicolor：高饱和三原色，怀旧 / 童话 / 迪士尼
6) Duotone：两色极限对比（品红 + 青），赛博朋克 / 音乐录影带
每一组在一部作品中不混用，保持锚点一致。`,
    tags: ['色彩', '调色', '色板'],
    keywords: ['teal and orange', 'desaturated', 'monochrome', 'bleach bypass', 'technicolor', 'duotone'],
    prompt_snippets: [
      'teal and orange color grade, lifted shadows',
      'desaturated cold palette, low saturation',
      'bleach bypass look, high contrast, silver highlights',
      'duotone magenta and cyan, cyberpunk mood',
    ],
    applies_to: ['director', 'atmosphere'],
    source: '电影调色通用公式',
    lang: 'en-zh',
    enabled: true,
  },
  {
    id: 'kb_atm_post_vfx',
    collection: 'atmosphere',
    subcategory: '后期质感',
    title: '后期质感关键词（film grain / chromatic aberration / vignette / halation）',
    summary: '让 AI 画面一眼"不像 AI"的 4 个后期元素：颗粒 / 色散 / 暗角 / 光晕。',
    content: `四件套：
- film grain：胶片颗粒，轻度（3-8%）比无颗粒更电影
- chromatic aberration：边缘彩色溢出，模拟真实镜头
- vignette：暗角，把观众视线收束到中心
- halation：强光周围的红/橙溢出，胶片发光特征
使用建议：
- 任何电影感 prompt 末尾加 "subtle film grain, slight chromatic aberration, soft vignette"
- 强光源场景加 "halation glow around highlights"`,
    tags: ['后期', '胶片', '颗粒', '暗角'],
    keywords: ['film grain', 'chromatic aberration', 'vignette', 'halation'],
    prompt_snippets: [
      'subtle film grain, slight chromatic aberration, soft vignette',
      'halation glow around bright highlights',
      '35mm film emulation, organic imperfection',
    ],
    applies_to: ['director', 'atmosphere'],
    source: '电影后期通用技法',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_master_checklist',
    collection: 'atmosphere',
    subcategory: '混合范式',
    title: '氛围提示词主清单（通用"一句话电影感"模板）',
    summary: '一句话就能把 AI 画面拉到电影水准的万能尾缀。',
    content: `通用尾缀（可直接拼接在任意 visual_prompt 末尾）：
"cinematic, anamorphic lens, shallow depth of field, volumetric haze, god rays, high contrast, teal and orange color grade, subtle film grain, slight chromatic aberration, soft vignette, 4K ultra detailed, sharp focus on subject, natural lens flare, motivated practical lighting"

高端氛围变体（奢华科技感）：
"semi metallic lighting, brushed metal reflections, chrome accents, cool steel palette with warm copper rim light, soft specular highlights, cinematic, 4K"

史诗氛围变体（战场/仪式）：
"volumetric smoke, drifting fog, floating embers rising through god rays, high contrast, deep shadows, epic scale, cinematic, 4K"

悬疑氛围变体（黑色电影）：
"film noir lighting, venetian blind shadows, volumetric haze, cigarette smoke, high contrast, desaturated palette with one amber accent, cinematic, 4K"`,
    tags: ['氛围', '万能提示词', 'cinematic'],
    keywords: ['master prompt', 'cinematic suffix', 'universal atmosphere'],
    prompt_snippets: [
      'cinematic, anamorphic lens, shallow depth of field, volumetric haze, god rays, high contrast, teal and orange color grade, subtle film grain, soft vignette, 4K',
      'semi metallic lighting, chrome accents, cool steel palette with warm copper rim light, cinematic',
      'volumetric smoke, floating embers, god rays, epic scale, cinematic',
      'film noir, venetian blind shadows, volumetric haze, desaturated with amber accent',
    ],
    applies_to: ['director', 'atmosphere', 'storyboard'],
    source: 'VIDO 项目整合',
    lang: 'en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // —— v2 新增：经典电影美学包 ——
  // ═══════════════════════════════════════════════════

  {
    id: 'kb_atm_v2_dune_desert',
    collection: 'atmosphere',
    subcategory: '混合范式',
    title: '《沙丘》Dune 沙漠美学包（维伦纽瓦 + Greig Fraser）',
    summary: '沙丘美学 = 琥珀色沙漠 + 巨大尺度 + 压抑沉默 + 粗砺质感。科幻史诗首选。',
    content: `《沙丘》(Dune 2021/2024) 由 Denis Villeneuve 执导、Greig Fraser 摄影，定义了当代科幻史诗美学。

**核心视觉要素**

**1. 色板**
- 主色：琥珀橙 amber orange
- 阴影：深沉棕 deep brown
- 配色：岩石米 stone beige + 钢铁灰 steel grey
- 点缀：极少的蓝色（天空或眼睛）

**2. 光线**
- 强硬的正午太阳
- 没有软化的阴影
- 高对比度
- Practical fire light (火焰实景光)

**3. 尺度**
- 人物占画面 5% 以下
- 建筑 / 飞船 / 沙丘占 95%
- 大量地平线构图
- 鸟瞰 + 远景交替

**4. 质感**
- 沙粒飞扬 (airborne sand particles)
- 粗糙石墙 (rough stone walls)
- 磨损金属 (weathered metal)
- 破旧布料 (worn fabric)

**5. 运动**
- 极慢的摄像机运动
- 长镜头
- 角色缓慢移动（营造凝重感）

**完整 Prompt 包**
\`\`\`
vast desert landscape with rolling golden dunes under harsh midday sun,
tiny human silhouettes dwarfed by massive scale,
amber and deep brown color palette, high contrast, low saturation,
airborne sand particles catching sunlight, atmospheric haze on horizon,
rough stone architecture with ancient carvings,
weathered metal ornithopter in background,
oppressive silence with distant wind,
Denis Villeneuve Dune cinematography style, Greig Fraser aesthetic,
65mm anamorphic lens, cinematic 2.39:1, epic scale
\`\`\`

**关键词清单**
desert epic, amber palette, Arrakis, giant scale, stone architecture,
weathered metal, airborne sand, contemplative silence, Villeneuve,
Greig Fraser, Hans Zimmer atmosphere

**应用场景**
- 科幻史诗 AI 漫剧
- 沙漠 / 荒漠 / 废土
- 仪式场景
- 神秘宗教题材`,
    tags: ['沙丘', 'dune', '沙漠', '史诗', '科幻'],
    keywords: ['dune', 'arrakis', 'desert epic', 'amber palette', 'villeneuve', 'greig fraser', 'giant scale'],
    prompt_snippets: [
      'vast desert dunes under harsh midday sun, amber and deep brown',
      'tiny human silhouettes dwarfed by massive architectural scale',
      'airborne sand particles catching sunlight, atmospheric haze',
      'Dune Arrakis cinematography, Villeneuve Fraser style, 65mm anamorphic',
    ],
    applies_to: ['director', 'atmosphere'],
    source: '《沙丘》(2021/2024) Denis Villeneuve / Greig Fraser 视觉分析',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_v2_br2049_neon',
    collection: 'atmosphere',
    subcategory: '混合范式',
    title: '《银翼杀手 2049》Blade Runner 2049 霓虹雾霾美学包',
    summary: 'BR2049 = 橙色雾霾废土 + 霓虹全息 + 孤独巨型空间 + 极少对话。赛博朋克视觉圣经。',
    content: `《Blade Runner 2049》(2017) 由 Denis Villeneuve + Roger Deakins 合作，是赛博朋克视觉的当代标杆。

**三大场景美学**

**A. 橙色废土 (Orange Wasteland)**
- 洛杉矶郊外辐射区
- 色板：鲜橙色 + 黄褐色
- 雾霾能见度 200m
- 风沙 + 破损建筑
- 场景：巨大雕像 + 废墟

**B. 蓝色雨城 (Blue Rain City)**
- 未来洛杉矶市区
- 色板：钴蓝 + 电子青 + 紫
- 永夜 + 雨 + 霓虹全息
- 潮湿反光地面
- 场景：高架广告 + 拥挤街道

**C. 白色总部 (White Wallace HQ)**
- 企业内部
- 色板：白 + 金 + 黑
- 水面反光投射到天花板
- 极简现代建筑
- 场景：冥想式空旷大厅

**共通要素**
- 极慢运动
- 长时间沉默
- 人物渺小
- 空间巨大
- Hans Zimmer 低频音景

**Prompt 模板 - 橙色废土**
\`\`\`
orange hazy wasteland, post-apocalyptic ruins of Las Vegas,
massive eroded statues of dancers and soldiers,
dense orange dust filling the air limiting visibility,
single tiny figure walking across rubble,
Blade Runner 2049 cinematography, Villeneuve Deakins style,
65mm anamorphic, cinematic 2.39:1, oppressive silence
\`\`\`

**Prompt 模板 - 蓝色雨城**
\`\`\`
rainy neon cyberpunk city at night, wet reflective streets,
giant holographic advertisements floating above streets,
cobalt blue and electric cyan palette with purple accents,
dense crowd under umbrellas, steam rising from vents,
Blade Runner 2049 Los Angeles aesthetic, cinematic 2.39:1
\`\`\`

**Prompt 模板 - 白色总部**
\`\`\`
minimalist white corporate chamber with reflective water floor,
golden light patterns from water rippling on ceiling and walls,
lone figure standing in vast empty space,
Villeneuve Wallace Corporation interior style,
contemplative zen atmosphere, ultra cinematic
\`\`\`

**应用场景**
- 赛博朋克 / 反乌托邦
- 未来都市 / 废土
- 企业 / 权力 / 极权题材`,
    tags: ['blade runner', 'br2049', '赛博朋克', '霓虹'],
    keywords: ['blade runner 2049', 'cyberpunk', 'neon', 'orange wasteland', 'deakins', 'holographic', 'wallace corporation'],
    prompt_snippets: [
      'orange hazy wasteland, eroded statues, post-apocalyptic ruins',
      'rainy neon cyberpunk city, giant holographic advertisements',
      'minimalist white chamber with rippling water reflections',
      'Blade Runner 2049 cinematography, Deakins aesthetic',
    ],
    applies_to: ['director', 'atmosphere'],
    source: '《银翼杀手 2049》Denis Villeneuve / Roger Deakins 视觉分析',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_v2_budapest_symmetry',
    collection: 'atmosphere',
    subcategory: '混合范式',
    title: '《布达佩斯大饭店》Grand Budapest Hotel 粉色对称美学包',
    summary: '布达佩斯美学 = 对称构图 + 粉色建筑 + 俯视镜头 + 复古服化 + 奶油色板。童话 / 复古 / 时尚首选。',
    content: `《The Grand Budapest Hotel》(2014) 由 Wes Anderson 执导，是当代视觉美学的独立流派。

**核心视觉 DNA**

**1. 色板**
- 主色：樱花粉 cherry blossom pink
- 辅色：奶油黄 cream yellow + 薄荷绿 mint green
- 阴影色：浅紫 lavender
- 点缀：深红 burgundy + 金色 gold

**2. 构图**
- 完美中心对称
- 1.37:1 学院比例（复古）
- 全景 / 中景 / 特写三种严格切换
- 大量俯拍 flat lay shot

**3. 建筑**
- 粉色外墙
- 金色装饰
- 红地毯楼梯
- 黄铜电梯
- 旋转门 / 圆拱窗

**4. 服装**
- 紫色侍应生制服（带金色肩章）
- 粉色客房女仆裙
- 厚重大衣
- 复古帽子

**5. 道具**
- 糕点盒（Mendl's 标志性粉盒）
- 古董钥匙
- 油画
- 雪橇
- 缆车

**完整 Prompt 包**
\`\`\`
perfect centered symmetric composition, flat frontal framing,
pink and cream pastel color palette with gold accents,
grand hotel exterior with ornate pink facade and snow-capped mountains,
perfectly mirrored architectural elements, cinematic 1.37:1 aspect ratio,
overhead flat lay of pink pastry box with perfect symmetry,
Wes Anderson cinematography style, Grand Budapest Hotel aesthetic,
whimsical retro atmosphere, detailed production design,
Robert Yeoman cinematography, medium shot, static camera
\`\`\`

**关键词清单**
grand hotel, pink facade, Mendl's pastry box, symmetric framing,
pastel palette, Wes Anderson, Robert Yeoman, whimsical retro,
1.37:1 academy ratio, overhead flat lay, ornate production design

**应用场景**
- 童话 / 复古 / 文艺 AI 漫剧
- 时尚品牌广告
- 酒店 / 美食 / 生活方式
- 需要"高级感 + 俏皮"的作品`,
    tags: ['budapest', 'wes anderson', '粉色', '对称'],
    keywords: ['grand budapest hotel', 'wes anderson', 'pink palette', 'symmetric', 'robert yeoman', 'academy ratio'],
    prompt_snippets: [
      'perfect centered symmetric composition, pink and cream pastel',
      'grand hotel exterior with ornate pink facade and mountains',
      'Wes Anderson Grand Budapest Hotel aesthetic, whimsical retro',
      'overhead flat lay of pastry box with mirrored symmetry',
    ],
    applies_to: ['director', 'atmosphere'],
    source: '《布达佩斯大饭店》Wes Anderson / Robert Yeoman 视觉分析',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_v2_parasite_class',
    collection: 'atmosphere',
    subcategory: '混合范式',
    title: '《寄生虫》Parasite 阶层光影美学包（奉俊昊 + 洪经彪）',
    summary: '寄生虫美学 = 垂直空间隐喻 + 高低冷暖光线对比 + 雨水作为阶层分界。韩国新浪潮视觉语法。',
    content: `《寄生虫》(2019) 由 Bong Joon-ho 执导，Hong Kyung-pyo 摄影，开创"阶层美学"视觉语法。

**核心视觉逻辑：垂直空间 = 阶层**

**上层 (Park 家族)**
- 现代主义豪宅
- 大玻璃窗 + 阳光
- 暖金光线
- 干净整洁
- 色板：米白 + 木色 + 金
- 俯视镜头多

**中层 (街道)**
- 普通社区
- 自然光
- 色板：灰绿 + 棕
- 水平镜头

**下层 (Kim 家族半地下室)**
- 半地下 semi-basement
- 光从地面窗户进入（反光）
- 冷蓝色调
- 潮湿昏暗
- 色板：青灰 + 深绿 + 暗黄
- 仰视镜头多

**暴雨场景的阶层隐喻**
- 同一场大雨对不同阶层截然不同
- 对 Park 家：浪漫 / 安全 / 欣赏
- 对 Kim 家：灾难 / 下水道涌 / 流离失所
- 摄影：低角度俯冲 + 水面倒影 + 雨水特写

**Prompt 模板 - 上层豪宅**
\`\`\`
modernist luxury mansion interior, large floor to ceiling windows,
warm golden afternoon sunlight streaming in,
minimalist wooden furniture, manicured garden view,
clean beige and wood color palette, high ceiling,
Bong Joon-ho Parasite upper class aesthetic,
Hong Kyung-pyo cinematography, cinematic overhead shots
\`\`\`

**Prompt 模板 - 下层半地下**
\`\`\`
cramped semi-basement apartment, cold blue fluorescent lighting,
small window near ceiling showing feet passing by on street,
cluttered belongings, damp walls, greenish-grey palette,
low angle shot looking up, claustrophobic atmosphere,
Parasite Kim family home aesthetic, urban realism
\`\`\`

**Prompt 模板 - 暴雨阶层**
\`\`\`
torrential rain scene, semi-basement flooding with sewage,
family wading through water, low angle upward shot,
cold blue night lighting with yellow street lamp reflections,
Bong Joon-ho Parasite flood scene aesthetic,
social realism cinematography, dramatic class allegory
\`\`\`

**应用场景**
- 阶层 / 社会题材
- 城市现实主义
- 家庭戏剧
- 需要隐喻感的视觉`,
    tags: ['parasite', '寄生虫', '阶层', '奉俊昊'],
    keywords: ['parasite', 'bong joon-ho', 'hong kyung-pyo', 'class allegory', 'vertical space', 'semi-basement', 'korean new wave'],
    prompt_snippets: [
      'modernist luxury mansion with warm golden afternoon light',
      'cramped semi-basement with cold blue fluorescent lighting',
      'low angle upward shot from basement window, feet passing on street',
      'Parasite cinematography, Bong Joon-ho class allegory style',
    ],
    applies_to: ['director', 'atmosphere'],
    source: '《寄生虫》Bong Joon-ho / Hong Kyung-pyo 视觉分析',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_v2_inthemood_red',
    collection: 'atmosphere',
    subcategory: '混合范式',
    title: '《花样年华》In the Mood for Love 慢镜头红蓝美学包（王家卫 + 杜可风）',
    summary: '王家卫美学 = 强烈红蓝对比 + 慢动作 + 过曝高光 + 镜面与隔断 + 旗袍特写。东方情感经典。',
    content: `《花样年华》(2000) 由王家卫执导，杜可风 + Mark Lee Ping-bin 摄影，是亚洲电影视觉美学顶峰。

**核心美学**

**1. 色彩：血红 + 深蓝**
- 主色：深红 crimson red（旗袍 / 霓虹 / 灯笼）
- 辅色：靛蓝 indigo blue（街道夜景 / 窗帘）
- 黑色作为结构（西装 / 阴影）
- 避免纯白和饱和绿

**2. 慢动作**
- 关键情感瞬间慢放 2-3 倍
- 走路 / 对视 / 错过
- 配合绵长的华语老歌
- 音乐进入时画面自动变慢

**3. 过曝高光**
- 灯光主动过曝
- 氛围胜于清晰
- 留下"梦幻"感

**4. 镜面与隔断**
- 大量镜子反射（关系的镜像）
- 门框 / 窗棂 / 屏风作为 framing
- 两人之间常有视觉障碍

**5. 特写**
- 旗袍领口
- 手指触碰
- 眼睛
- 烟雾缭绕
- 雨中伞
- 湿地倒影

**6. 场景**
- 狭窄楼梯 / 走廊
- 旅馆房间
- 小面馆
- 雨夜街角

**完整 Prompt 包**
\`\`\`
slow motion close-up of woman in deep crimson red qipao dress,
walking slowly down narrow hallway under warm yellow lamp light,
overexposed highlights creating dreamlike glow,
framed through ornate wooden doorway,
deep indigo blue background with hints of red lantern,
Wong Kar-wai In the Mood for Love cinematography,
Christopher Doyle aesthetic, atmospheric nostalgic romance,
1.85:1 cinematic, subtle film grain
\`\`\`

**关键词清单**
qipao, slow motion, crimson red, indigo blue, overexposed highlights,
Wong Kar-wai, Christopher Doyle, 1960s Hong Kong, narrow hallway,
framed composition, melancholic romance, atmospheric

**应用场景**
- 情感 / 爱情 AI 漫剧
- 年代戏（1950-1970 亚洲）
- 文艺 / 怀旧题材
- 需要"东方情绪"的镜头`,
    tags: ['花样年华', '王家卫', '红蓝', '慢动作'],
    keywords: ['in the mood for love', 'wong kar-wai', 'christopher doyle', 'qipao', 'slow motion', 'crimson red', '1960s hong kong'],
    prompt_snippets: [
      'slow motion close-up of woman in crimson red qipao dress',
      'narrow hallway with warm yellow lamp light, overexposed highlights',
      'Wong Kar-wai cinematography, Christopher Doyle aesthetic',
      'framed through ornate wooden doorway, 1960s Hong Kong atmosphere',
    ],
    applies_to: ['director', 'atmosphere'],
    source: '《花样年华》王家卫 / 杜可风 / Mark Lee Ping-bin 视觉分析',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_v2_portrait_daylight',
    collection: 'atmosphere',
    subcategory: '光影',
    title: '《燃烧女子的肖像》Portrait of a Lady on Fire 自然光黄金时刻美学',
    summary: '自然光美学 = 18 世纪油画质感 + 烛光 + 海浪 + 双人正面凝视。文艺 / 历史题材的顶点。',
    content: `《Portrait of a Lady on Fire》(2019) 由 Céline Sciamma 执导，Claire Mathon 摄影，获戛纳最佳剧本。

**核心视觉特征**

**1. 纯自然光**
- 白天：自然窗光
- 夜晚：烛光 / 壁炉光
- 没有任何人工光
- Claire Mathon 是这类风格的代表摄影师

**2. 油画质感**
- 构图参考 Vermeer / Chardin / Caravaggio
- 人物姿态 "摆" 出来
- 色调自然但饱和度稍低
- 织物质感强（亚麻 / 羊毛 / 丝绸）

**3. 双人正面凝视**
- 两个女性角色正面对视
- 镜头在她们之间摇移
- 无对白的长停留

**4. 风景**
- 布列塔尼海岸
- 灰色大海 / 巨石 / 荒原
- 海风吹动长裙
- 雨和雾

**5. 服装**
- 18 世纪法式服装
- 长裙 / 披肩 / 帽子
- 织物自然褶皱

**6. 篝火场景**
- 夜晚篝火聚会
- 女人们围成圈唱歌
- 火光映在脸上
- 长裙被火光燃烧（标志性镜头）

**完整 Prompt 包**
\`\`\`
natural window light on a young woman in 18th century French dress,
soft diffused daylight from side window, painterly composition,
textured linen and wool fabric, Vermeer-like still life quality,
shot inside stone cottage on Brittany coast,
Portrait of a Lady on Fire cinematography,
Claire Mathon aesthetic, naturalistic historical drama,
no artificial lighting, subtle film grain, 1.85:1 cinematic
\`\`\`

**Prompt 模板 - 篝火场景**
\`\`\`
women gathered around bonfire on Brittany cliff at dusk,
firelight illuminating faces with warm amber glow,
deep blue night sky behind, long skirts blowing in sea wind,
haunting chorus singing, cinematic wide shot,
Portrait of a Lady on Fire bonfire scene aesthetic,
Sciamma Mathon style, painterly realism
\`\`\`

**应用场景**
- 年代戏 / 历史剧
- 文艺 / 情感
- 女性主题
- 需要"油画质感"的镜头`,
    tags: ['portrait', '肖像', '自然光', '油画'],
    keywords: ['portrait of a lady on fire', 'sciamma', 'claire mathon', 'natural light', 'painterly', 'vermeer', '18th century'],
    prompt_snippets: [
      'natural window light on 18th century French dress, painterly',
      'textured linen fabric, Vermeer still life quality',
      'bonfire on Brittany cliff at dusk, warm amber glow',
      'Portrait of a Lady on Fire cinematography, Claire Mathon',
    ],
    applies_to: ['director', 'atmosphere'],
    source: '《燃烧女子的肖像》Céline Sciamma / Claire Mathon 视觉分析',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_v2_apple_keynote',
    collection: 'atmosphere',
    subcategory: '材质感',
    title: 'Apple Keynote 工业光美学（乔纳森 • 艾维 + 当代产品摄影）',
    summary: 'Apple 美学 = 纯净背景 + 精确打光 + 金属高光 + 微渐变 + 几何对称。科技 / 产品广告标杆。',
    content: `Apple 自 iPod（2001）至今定义的"科技产品美学"，成为全球工业设计视觉语言。

**核心视觉原则**

**1. 纯净背景**
- 无杂质白 / 深灰 / 渐变黑
- 没有任何"场景感"
- 产品是唯一主角
- 浮空 + 无重力

**2. 精确打光**
- Key light 软盒（大面积软光）
- Rim light 高位逆光（金属高光）
- Fill light 底部反光板（消除死角阴影）
- 光比 2:1

**3. 微渐变背景**
- 深灰 → 中灰 → 浅灰的微妙渐变
- 引导视线到中心
- 避免纯色背景的"平面感"

**4. 金属 / 玻璃质感**
- Anodized aluminum 阳极氧化铝
- Brushed stainless steel 拉丝不锈钢
- Ceramic 陶瓷
- Edge lighting 边缘光

**5. 几何对称**
- 产品居中
- 水平 / 垂直 / 45 度三个标准角度
- 对称构图

**6. 运动美学**
- 产品旋转展示
- 分解重组 (exploded view)
- 微距 + 景深变化
- 平滑轨道运镜

**Prompt 模板 - 产品特写**
\`\`\`
Apple keynote product photography style, pristine gradient dark background,
precise studio lighting with large softbox key, high rim light,
anodized aluminum product with subtle specular highlights,
centered geometric composition, macro lens shallow depth of field,
Jony Ive design aesthetic, clean minimalist product display,
4K ultra detailed, professional commercial photography
\`\`\`

**Prompt 模板 - 运动展示**
\`\`\`
floating product slowly rotating in zero gravity,
exploded view revealing internal components,
cinematic smooth tracking shot,
gradient gray to black background,
rim lighting creating metal highlights,
Apple product launch keynote aesthetic
\`\`\`

**应用场景**
- 产品广告 / TVC
- 科技类 AI 漫剧
- 奢华品牌视觉
- 极简美学作品`,
    tags: ['apple', '产品摄影', '工业设计', '金属'],
    keywords: ['apple keynote', 'product photography', 'jony ive', 'studio lighting', 'anodized aluminum', 'gradient background'],
    prompt_snippets: [
      'Apple keynote product photography, gradient dark background',
      'anodized aluminum with subtle specular highlights, rim lighting',
      'floating rotating product in zero gravity, exploded view',
      'Jony Ive design aesthetic, clean minimalist composition',
    ],
    applies_to: ['director', 'atmosphere'],
    source: 'Apple 产品广告 2001-2025 视觉语言分析',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_v2_ghibli_watercolor',
    collection: 'atmosphere',
    subcategory: '混合范式',
    title: '吉卜力 Studio Ghibli 水彩手绘美学包（宫崎骏）',
    summary: '吉卜力美学 = 水彩质感 + 柔和色调 + 自然细节 + 温暖日常 + 奇幻元素。治愈系动画首选。',
    content: `吉卜力工作室（1985 至今）由宫崎骏 / 高畑勋创立，是全球手绘动画的美学顶峰。

**核心视觉特征**

**1. 水彩质感**
- 背景是真实水彩画
- 纸张纹理可见
- 颜色轻微晕染
- 天空有明显的水彩笔触

**2. 柔和色调**
- 主色：青草绿 / 天空蓝 / 奶油白
- 辅色：夕阳橙 / 砖红 / 深棕
- 避免纯黑和荧光色
- 整体饱和度中等偏低

**3. 自然细节**
- 云朵层次丰富
- 风吹树叶
- 雨水反光
- 昆虫飞舞
- 野花 / 杂草

**4. 温暖日常**
- 厨房做饭
- 院子晾衣服
- 骑单车
- 看书
- 泡茶

**5. 奇幻元素**
- 魔法生物
- 悬浮城堡
- 会动的玩偶
- 精灵 / 森之灵
- 不合常理但温暖的景象

**6. 角色设计**
- 圆润脸型
- 大眼睛（但不夸张）
- 朴素衣着
- 有人情味的细节（鞋带 / 围裙 / 补丁）

**完整 Prompt 包**
\`\`\`
Studio Ghibli watercolor animation style, hand-painted background,
lush green grassland under blue summer sky with fluffy white clouds,
young girl with short brown hair in yellow sundress,
warm afternoon sunlight, gentle breeze through wildflowers,
nostalgic Japanese countryside atmosphere,
Hayao Miyazaki cinematography, Joe Hisaishi music mood,
soft pastel palette, traditional cel animation aesthetic,
detailed nature elements, enchanting whimsical mood
\`\`\`

**关键词清单**
Ghibli, Miyazaki, watercolor, hand-painted, cel animation, Japanese countryside,
wildflowers, summer afternoon, Joe Hisaishi, whimsical, nostalgic,
Totoro, Spirited Away, Howl's Moving Castle

**应用场景**
- 治愈 / 温暖 AI 漫剧
- 童话 / 奇幻
- 日系怀旧
- 需要"手绘感"的作品`,
    tags: ['ghibli', '吉卜力', '水彩', '宫崎骏'],
    keywords: ['studio ghibli', 'hayao miyazaki', 'watercolor', 'hand painted', 'joe hisaishi', 'totoro', 'spirited away', 'cel animation'],
    prompt_snippets: [
      'Studio Ghibli watercolor animation, hand-painted background',
      'lush green grassland, blue sky, fluffy white clouds',
      'Hayao Miyazaki nostalgic Japanese countryside aesthetic',
      'soft pastel palette, detailed nature, whimsical atmosphere',
    ],
    applies_to: ['director', 'atmosphere', 'storyboard'],
    source: 'Studio Ghibli 1985-2023 作品视觉分析',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_v2_shinkai_sky',
    collection: 'atmosphere',
    subcategory: '混合范式',
    title: '新海诚 Makoto Shinkai 蓝天云彩 + 城市黄昏美学',
    summary: '新海诚美学 = 高饱和蓝天 + 壮阔云彩 + 精细城市 + 闪光粒子 + 情感光线。青春 / 恋爱动漫标杆。',
    content: `新海诚（《你的名字。》《天气之子》《铃芽之旅》《秒速五厘米》）的视觉美学：

**核心特征**

**1. 天空即主角**
- 每部电影都有无数天空镜头
- 高饱和 + 极高对比
- 层次丰富的云彩
- 黄昏 / 星空 / 雨后
- 彩色的日出日落

**2. 城市精细化**
- 东京街道每一个细节都画出来
- 电线杆 / 便利店 / 地铁 / 阳台
- 密集的城市质感
- 真实的日本都市

**3. 闪光粒子**
- 雨滴 / 雪花 / 樱花 / 尘埃
- 空气中漂浮的光点
- 眼泪折射
- "情感可视化"

**4. 情感光线**
- 夕阳穿过发丝
- 晨光照在脸上
- 雨后彩虹
- 角色情感高潮时天色变化

**5. 色彩**
- 主色：群青蓝 ultramarine + 橙红 orange red
- 辅色：樱花粉 + 翡翠绿
- 高饱和
- 明亮清澈

**6. 人物**
- 细腻写实
- 青春面孔
- 校服 / 便服
- 情绪细致

**完整 Prompt 包**
\`\`\`
Makoto Shinkai anime style, vibrant ultramarine blue sky,
dramatic cumulus clouds lit by golden sunset,
highly detailed Tokyo cityscape in foreground,
young girl in school uniform standing on apartment rooftop,
glowing amber light on her face, wind blowing her hair,
shimmering light particles floating in the air,
Your Name / Weathering with You aesthetic,
hyperdetailed realistic anime, cinematic emotional atmosphere,
high saturation, sharp focus
\`\`\`

**关键词清单**
Makoto Shinkai, vibrant sky, dramatic clouds, Tokyo cityscape,
high saturation, school uniform, emotional anime, particle effects,
Your Name, Weathering with You, 5cm per second

**应用场景**
- 青春 / 恋爱 AI 漫剧
- 日系都市
- 情感高潮戏
- 需要"绝美日常"的作品`,
    tags: ['新海诚', 'shinkai', '动漫', '天空'],
    keywords: ['makoto shinkai', 'your name', 'weathering with you', 'tokyo anime', 'vibrant sky', 'cumulus clouds', 'emotional anime'],
    prompt_snippets: [
      'Makoto Shinkai anime style, vibrant ultramarine blue sky',
      'dramatic cumulus clouds lit by golden sunset',
      'highly detailed Tokyo cityscape with school girl on rooftop',
      'shimmering light particles, hyperdetailed realistic anime',
    ],
    applies_to: ['director', 'atmosphere', 'storyboard'],
    source: '新海诚作品 2002-2024 视觉风格分析',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_v2_cyberpunk_city',
    collection: 'atmosphere',
    subcategory: '混合范式',
    title: '赛博朋克城市夜景美学包（Cyberpunk 2077 / GITS / Akira 融合）',
    summary: '赛博朋克 = 霓虹 + 雨 + 全息广告 + 烟雾 + 摩天巨楼 + 东方文字。2024-2025 AI 视频最流行风格。',
    content: `综合《Akira》《攻壳机动队》《Cyberpunk 2077》《Blade Runner 2049》《爱，死亡和机器人》的赛博朋克视觉语言：

**核心元素清单**

**场景**
- 九龙城寨式密集建筑
- 东京涩谷十字路口
- 上海陆家嘴未来版
- 废墟工厂
- 霓虹小巷
- 悬浮地铁

**灯光**
- 霓虹广告牌（Kanji 日文字 / 繁体中文 / 韩文）
- 全息投影
- 激光扫描
- 电子屏幕光
- 雨水反光
- 车灯流动

**色彩**
- Duotone: 品红 magenta + 青 cyan
- 或 Triad: 紫 purple + 橙 orange + 青 cyan
- 高饱和
- 黑色作为结构

**天气**
- 永夜
- 持续雨 / 毛毛雨
- 雾气（neon fog）
- 水蒸气从下水道冒出
- 潮湿反光地面

**角色**
- 赛博义体（机械臂 / 眼睛 / 背部接口）
- 荧光纹身
- 暗色风衣
- 赛博眼镜
- 发光武器

**氛围**
- 压抑 / 未来 / 孤独 / 美丽 / 颓废
- 人类与技术的矛盾

**完整 Prompt 包**
\`\`\`
cyberpunk Tokyo street at night in perpetual rain,
massive holographic advertisements with Japanese kanji text floating above,
neon signs in magenta and cyan duotone, wet reflective asphalt,
dense crowd under umbrellas, steam rising from street vents,
towering megastructures fading into neon fog,
lone cyborg figure walking through puddles,
Blade Runner 2049 meets Ghost in the Shell aesthetic,
cinematic anamorphic lens, high contrast, 2.39:1, 4K ultra detailed,
atmospheric haze, lens flare from neon lights
\`\`\`

**变体 1 - 小巷**
\`\`\`
narrow cyberpunk alley with overflowing trash and glowing signs,
steam pipes, laundry lines between buildings,
red lantern lights mixed with neon blue holograms,
Kowloon Walled City futuristic vibe, intimate claustrophobic scale
\`\`\`

**变体 2 - 高楼**
\`\`\`
top floor cyberpunk penthouse overlooking neon megacity,
floor-to-ceiling windows, purple and orange sunset through smog,
holographic city map, executive desk silhouette,
corporate elite perspective, high-angle view
\`\`\`

**应用场景**
- 赛博朋克 AI 漫剧
- 科幻未来
- 亚洲都市美学
- 品牌广告（运动 / 科技）`,
    tags: ['赛博朋克', 'cyberpunk', '霓虹', '未来'],
    keywords: ['cyberpunk', 'neon', 'blade runner', 'ghost in the shell', 'akira', 'holographic', 'kanji', 'kowloon', 'megacity'],
    prompt_snippets: [
      'cyberpunk Tokyo street, perpetual rain, holographic kanji ads',
      'neon magenta and cyan duotone, wet reflective asphalt',
      'towering megastructures fading into neon fog, steam from vents',
      'Blade Runner meets Ghost in the Shell, cinematic anamorphic 2.39:1',
    ],
    applies_to: ['director', 'atmosphere'],
    source: '赛博朋克视觉谱系（Akira 1988 / GITS 1995 / BR 2049 / CP2077）综合',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_v2_kdrama_tone',
    collection: 'atmosphere',
    subcategory: '混合范式',
    title: 'K-drama 韩剧灰暖美学包（韩剧现代都市视觉语言）',
    summary: 'K-drama 美学 = 灰暖中性色 + 柔焦 + 咖啡馆美学 + 雪景雨景 + 精致服化道。甜宠 / 情感剧标配。',
    content: `K-drama 自 2003 年《冬季恋歌》至今形成的视觉范式，已成为全球甜宠/情感剧事实标准。

**色调**
- 主色：暖米 warm beige + 灰褐 taupe + 奶油 cream
- 辅色：浅蓝 pale blue + 浅粉 blush pink
- 避免浓烈饱和
- 整体接近"自然但调色柔和"

**灯光**
- 日戏：柔和窗光 + 柔光箱
- 夜戏：咖啡馆暖光 / 路灯橙黄 / 雪景冷蓝
- 一律避免硬阴影
- Fill 比例高 (3:1 或 2:1)

**场景**
- 首尔咖啡馆（咖啡杯特写 + 糕点）
- 汉江边散步
- 传统韩屋
- 办公室（简约现代）
- 雪中公交站
- 便利店屋顶

**服化道**
- 角色服装有季节感（秋冬最美）
- 配饰精致但不夸张
- 大量毛衣 / 大衣 / 围巾
- 妆容自然但精致

**摄影**
- 中景 + 近景交替
- 浅景深
- 柔焦
- 慢动作（情感高潮）
- 降格拍摄

**情感镜头**
- 雨中奔跑
- 雪中拥抱
- 车内沉默
- 分别的机场
- 咖啡店玻璃倒影

**完整 Prompt 包**
\`\`\`
Korean drama cinematography style, warm taupe and beige palette,
soft diffused window light in cozy cafe interior,
young man in beige overcoat looking out the window,
coffee cup steaming on wooden table, bokeh background,
tasteful minimalist decor, contemporary Seoul aesthetic,
gentle emotional atmosphere, 1.85:1 cinematic,
shallow depth of field, 85mm lens, subtle film grain
\`\`\`

**变体 - 雪景**
\`\`\`
first snow falling on quiet Seoul street at night,
couple walking under warm yellow street lamps,
both in long wool coats and scarves,
breath visible in cold air, snowflakes catching light,
romantic K-drama aesthetic, slow motion,
nostalgic winter atmosphere
\`\`\`

**应用场景**
- 甜宠 / 情感 AI 漫剧
- 现代都市爱情
- 韩系美学
- 需要"高级感温柔"的作品`,
    tags: ['kdrama', '韩剧', '灰暖', '甜宠'],
    keywords: ['korean drama', 'k-drama', 'warm taupe', 'seoul cafe', 'soft light', 'bokeh', 'winter snow'],
    prompt_snippets: [
      'Korean drama cinematography, warm taupe beige palette',
      'soft window light in cozy Seoul cafe, bokeh background',
      'first snow night scene, warm street lamps, couple in wool coats',
      '85mm shallow depth of field, K-drama emotional atmosphere',
    ],
    applies_to: ['director', 'atmosphere'],
    source: 'K-drama 2015-2025 头部作品视觉分析',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_v2_hk90s_street',
    collection: 'atmosphere',
    subcategory: '混合范式',
    title: '90 年代港片街头美学包（刘伟强 / 林岭东 / 杜琪峰）',
    summary: '港片美学 = 霓虹招牌 + 雨夜 + 拥挤街道 + 双雄对峙 + 烟雾 + 16:9 斜构图。华语犯罪片圣经。',
    content: `1990 年代香港电影（《古惑仔》《无间道》《暗战》《黑社会》）形成的独特视觉美学。

**核心元素**

**1. 街道**
- 九龙 / 尖沙咀 / 湾仔
- 密集的店铺招牌
- 繁体字霓虹灯
- 双层巴士
- 出租车
- 街边大排档

**2. 灯光**
- 霓虹（红 / 绿 / 粉为主）
- 路灯暖黄
- 店铺日光灯 (冷白)
- 雨夜反光
- 烟花 / 鞭炮

**3. 天气**
- 夜晚 / 雨 / 雾
- 夏天潮湿闷热
- 雷雨
- 台风前

**4. 人物**
- 黑色西装 + 墨镜
- 白衬衫 + 金表
- 长风衣
- 花衬衫 + 金项链
- 纹身

**5. 构图**
- 16:9 宽屏
- 斜角构图
- 双雄站位（一左一右）
- 对峙长镜头

**6. 动作**
- 慢动作 double gun
- 白鸽飞过 (吴宇森标志)
- 烟雾中现身
- 雨中枪战

**完整 Prompt 包**
\`\`\`
1990s Hong Kong street night scene, rainy crowded alley,
neon signs with traditional Chinese characters in red and green,
wet asphalt reflecting neon lights, steam from food stalls,
two gangsters in black suits facing each other, dramatic backlighting,
cigarette smoke curling up, yellow street lamp glow,
Hong Kong noir cinematography, Wong Kar-wai meets John Woo style,
anamorphic lens, high contrast, atmospheric, 1.85:1 aspect ratio,
nostalgic 90s Hong Kong atmosphere
\`\`\`

**变体 - 大排档**
\`\`\`
outdoor Hong Kong dai pai dong street food stall at night,
plastic tables and stools, bright fluorescent lights above,
steam rising from wok hei, crowd of locals eating,
yellow warm neon signs, rainy street behind,
street food authenticity, 1995 Hong Kong vibe
\`\`\`

**应用场景**
- 犯罪 / 警匪题材
- 华语黑帮
- 90 年代复古
- 香港都市`,
    tags: ['港片', '90年代', '香港', '霓虹'],
    keywords: ['hong kong 90s', 'cantonese noir', 'john woo', 'wong kar-wai', 'chinese neon signs', 'rainy alley', 'gangster'],
    prompt_snippets: [
      '1990s Hong Kong street night, rainy crowded alley with neon',
      'traditional Chinese neon signs in red and green on narrow alley',
      'two gangsters in black suits, dramatic backlighting, cigarette smoke',
      'Hong Kong noir cinematography, John Woo Wong Kar-wai style',
    ],
    applies_to: ['director', 'atmosphere'],
    source: '1990-2000 香港电影视觉美学综合',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_v2_caravaggio_chiaroscuro',
    collection: 'atmosphere',
    subcategory: '光影',
    title: 'Caravaggio 明暗对照法（Chiaroscuro）油画光影美学',
    summary: '明暗对照 = 强烈单光源 + 深邃黑暗 + 戏剧性阴影。巴洛克绘画的终极光影系统。',
    content: `Caravaggio（1571-1610）的 Chiaroscuro（明暗对照法）是西方美术史上最重要的光影系统，至今仍是电影和摄影的基础美学。

**核心原则**

**1. 单一强光源**
- 画面中只有一个主光源
- 通常来自左上方或右上方
- 光线是"神的光" / "启示的光"
- 其他区域几乎全黑

**2. 极端对比**
- 亮部和暗部对比 10:1 或更高
- 没有灰阶过渡
- 人物一半亮一半暗
- 背景完全消失在黑暗

**3. 戏剧性姿态**
- 人物姿态夸张（指向 / 回望 / 惊讶）
- 手势有 "被光选中" 的感觉
- 表情清晰可读

**4. 织物质感**
- 深红 / 深蓝 / 深绿的天鹅绒
- 白色亚麻衬衫
- 金色装饰
- 光线在织物上的反射

**5. 情感戏剧**
- 宗教场景（使徒 / 圣母）
- 日常劳动（农夫 / 工匠）
- 暴力瞬间（被砍 / 被刺）
- 情欲觉醒

**Prompt 模板**
\`\`\`
chiaroscuro lighting in the style of Caravaggio,
single dramatic light source from upper left,
deep black background with 90% of frame in shadow,
subject half illuminated with warm golden light,
dark red velvet fabric catching highlights,
Baroque painting aesthetic, oil painting texture,
extreme contrast, cinematic drama,
inspired by "The Calling of Saint Matthew",
1.85:1 aspect ratio, detailed skin and fabric textures
\`\`\`

**应用场景**
- 古典 / 宗教 / 历史题材
- 戏剧性场景
- 人物肖像
- 需要"神性"或"命运感"的镜头

**摄影师灵感**
- Gordon Willis (《教父》)
- Christopher Doyle (《花样年华》)
- Roger Deakins 的暗场景
- Vittorio Storaro (《末代皇帝》)`,
    tags: ['caravaggio', '明暗对照', 'chiaroscuro', '巴洛克'],
    keywords: ['caravaggio', 'chiaroscuro', 'baroque', 'dramatic lighting', 'oil painting', 'single light source', 'godfather lighting'],
    prompt_snippets: [
      'chiaroscuro lighting Caravaggio style, single upper light source',
      'deep black background, subject half illuminated',
      'Baroque oil painting aesthetic, extreme contrast',
      'warm golden light on skin and dark red velvet fabric',
    ],
    applies_to: ['director', 'atmosphere'],
    source: 'Caravaggio 油画 + 巴洛克艺术 + 电影光影传承',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_v2_hermes_chanel_luxury',
    collection: 'atmosphere',
    subcategory: '材质感',
    title: '奢侈品广告美学（Hermès 橙 + Chanel 黑白 + Dior 灰金）',
    summary: '奢侈品 = 材质考究 + 静物摆拍 + 极简构图 + 质感光影。奢侈品 TVC 和 AI 广告的视觉圣经。',
    content: `全球三大奢侈品牌的视觉语言系统：

**Hermès 爱马仕（橙色美学）**
- 主色：Hermès Orange (PMS 1665C)
- 辅色：奶油白 + 深棕皮革 + 金色
- 标志场景：摩洛哥马拉喀什 / 法国乡村 / 骑马
- 质感：丝巾 / 皮革 / 马具 / 瓷器
- 摄影：干净背景 + 自然光 + 手工细节特写
- 核心：工匠精神 artisan craftsmanship

**Chanel 香奈儿（黑白极简）**
- 主色：纯黑 + 纯白
- 辅色：金色 + 珍珠白
- 标志场景：巴黎 / 舞会 / 双 C 标志
- 质感：山茶花 / 珍珠 / 斜纹软呢 / 黑色漆皮
- 摄影：高对比黑白 + 极简构图
- 核心：Coco Chanel 神秘传奇

**Dior 迪奥（灰金浪漫）**
- 主色：珍珠灰 + 金色
- 辅色：粉紫 + 薄纱白
- 标志场景：凡尔赛 / 花园 / 沙龙
- 质感：薄纱 / 丝绸 / 水晶 / 花卉
- 摄影：柔焦 + 逆光 + 慢动作
- 核心：女性浪漫 feminine romance

**奢侈品广告的 7 条视觉法则**

1. **纯净背景** - 背景绝对不抢戏
2. **极简构图** - 产品 = 视觉焦点
3. **极致光影** - 多次打光塑形
4. **微距细节** - 材质的每一道纹理
5. **缓慢节奏** - 禁止快切
6. **品牌色 Lock** - 整支广告色调一致
7. **无价格感** - 从不展示价格

**Prompt 模板 - Hermès 橙**
\`\`\`
luxurious Hermès commercial style, warm sunlight in Marrakech,
orange silk scarf floating gently over terracotta tiles,
master craftsman hands stitching leather saddle,
amber golden light, shallow depth of field,
artisan craftsmanship aesthetic, editorial photography
\`\`\`

**Prompt 模板 - Chanel 黑白**
\`\`\`
Chanel black and white high fashion editorial,
elegant woman in tweed jacket and pearls,
minimalist composition against white wall,
high contrast monochrome, soft directional light,
Paris couture atmosphere, timeless elegance
\`\`\`

**Prompt 模板 - Dior 灰金**
\`\`\`
Dior romantic commercial, silk tulle gown floating in Versailles garden,
soft backlit afternoon glow, pearl grey and gold palette,
slow motion petal fall, crystal chandeliers in background,
feminine romance, couture dreamscape
\`\`\`

**应用场景**
- 奢侈品广告
- 时尚 AI 漫剧
- 高端品牌宣传
- 产品植入戏`,
    tags: ['奢侈品', 'hermes', 'chanel', 'dior', '广告'],
    keywords: ['luxury advertising', 'hermes orange', 'chanel black white', 'dior romance', 'high fashion', 'editorial'],
    prompt_snippets: [
      'Hermès commercial, orange silk scarf in Marrakech sunlight',
      'Chanel black and white editorial, tweed and pearls',
      'Dior silk tulle gown in Versailles garden, pearl grey and gold',
      'luxury artisan craftsmanship aesthetic, editorial photography',
    ],
    applies_to: ['director', 'atmosphere'],
    source: 'Hermès / Chanel / Dior 2015-2025 广告视觉语言分析',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_v2_vintage_atomic',
    collection: 'atmosphere',
    subcategory: '混合范式',
    title: 'Atomic Age 原子时代复古美学（1950s-1960s）',
    summary: '原子时代 = 流线型设计 + 土耳其蓝 + 粉红 + 鸡尾酒文化 + 对未来的乐观。《疯人》《布达佩斯》时代。',
    content: `Atomic Age（1945-1969）美国战后乐观主义时代，美学特征鲜明，是复古题材的首选。

**时代特征**
- 核能 + 太空 + 新技术
- 对未来充满期待
- 中产阶级家庭生活理想化
- 鸡尾酒 + 烟 + 爵士

**视觉元素**

**1. 色板**
- 土耳其蓝 turquoise
- 珊瑚粉 coral pink
- 芥末黄 mustard yellow
- 原子绿 atomic green
- 配色：深棕木色 + 黄铜

**2. 设计**
- 流线型家具（Eero Saarinen 风格）
- 郁金香椅
- 玻璃纤维
- 圆角电视
- 带火箭装饰的汽车

**3. 场景**
- 美国郊区独栋别墅
- 车库 + 草坪 + 烧烤
- 鸡尾酒派对
- 复古厨房
- 老爷车加油站

**4. 时尚**
- 女性：A 字裙 + 珍珠 + 红唇 + 卷发
- 男性：灰色西装 + 窄领带 + 礼帽
- 儿童：吊带裙 + 皮鞋

**5. 摄影风格**
- Kodachrome 胶片质感
- 柔和柯达色
- 微微过曝
- 模糊边缘

**Prompt 模板 - 客厅派对**
\`\`\`
1958 American suburban living room, atomic age aesthetic,
turquoise walls with wood paneling, tulip chairs,
cocktail party with men in grey suits and women in A-line dresses,
red lipstick and pearl necklaces, crystal glasses,
Kodachrome film look, soft warm lighting,
mid-century modern furniture, vintage optimism atmosphere
\`\`\`

**Prompt 模板 - 加油站**
\`\`\`
1960 American roadside gas station, chrome pumps and rocket fin designs,
pastel turquoise and coral walls, neon Coca-Cola sign,
vintage convertible pulling in, driver in sunglasses,
warm golden afternoon light, Kodak film aesthetic,
Americana nostalgia, cinematic wide shot
\`\`\`

**Prompt 模板 - 厨房**
\`\`\`
1955 atomic age kitchen, mint green cabinets and pink appliances,
housewife in apron baking cake, checkered curtains,
sunlight through window, warm film grain,
Mad Men era domestic aesthetic
\`\`\`

**应用场景**
- 复古 / 年代题材
- 美式怀旧
- 时尚摄影
- 《疯人》《猫王》《蜂鸟》类美学`,
    tags: ['atomic age', '复古', '50年代', '美式'],
    keywords: ['atomic age', 'mid-century modern', '1950s', 'mad men', 'kodachrome', 'tulip chair', 'turquoise', 'americana'],
    prompt_snippets: [
      '1958 American suburban living room, atomic age turquoise and coral',
      'Kodachrome film look, mid-century modern furniture',
      '1960 roadside gas station with chrome and neon Coca-Cola',
      'Mad Men era cocktail party, warm vintage optimism',
    ],
    applies_to: ['director', 'atmosphere'],
    source: '1950-1970 美国战后视觉文化 + 《Mad Men》美学分析',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_atm_v2_mood_light_atlas',
    collection: 'atmosphere',
    subcategory: '光影',
    title: '情绪光影图谱（12 种情绪 × 对应光线设计）',
    summary: '每种情绪都有对应的光线设计。这是一张 12×4 的"情绪→光源→色温→方向"速查表。',
    content: `每个情绪都有对应的光线设计方案。AI 漫剧生成时直接按表套用。

**情绪光影速查表**

| 情绪 | 光源 | 色温 | 方向 | 对比度 | 代表场景 |
|---|---|---|---|---|---|
| **浪漫** | 烛光 / 黄昏 | 2800K 暖 | 侧光 / 逆光 | 中 | 烛光晚餐、日落散步 |
| **悲伤** | 阴天 / 雨 | 5000K 冷 | 散射 | 低 | 雨中独坐、清晨醒来 |
| **恐惧** | 单点 / 手电 | 3000K 暗 | 顶光 / 底光 | **极高** | 地下室、暗巷 |
| **希望** | 晨光 / 窗光 | 4500K 温 | 逆光 | 中高 | 窗前站立、山顶日出 |
| **愤怒** | 火光 / 霓虹红 | 2500K 暖红 | 硬光 | 高 | 火场、酒吧 |
| **宁静** | 月光 / 雪景 | 6500K 蓝 | 散射 | 低 | 雪夜窗前、湖边 |
| **神秘** | 雾 / 霓虹 | 4000K 青 | 逆光轮廓 | 高 | 迷雾森林、赛博街道 |
| **回忆** | 偏色暖光 | 3500K 橙 | 散射柔 | 低 | 老照片质感、阁楼 |
| **绝望** | 阴暗单色 | 3800K 死 | 顶光压迫 | 极高 | 审讯室、医院走廊 |
| **狂喜** | 阳光 / 彩虹 | 5500K 鲜 | 顶光 + 背光 | 中高 | 海滩、草原奔跑 |
| **庄严** | 顶窗光 / 祭坛 | 5000K 冷 | 顶光 | 中 | 教堂、宫殿 |
| **诡异** | 闪烁 / 紫色 | 4000K 紫青 | 多源冲突 | 高 | 废墟、超现实 |

**情绪 + 光影组合 Prompt 示例**

**浪漫 + 烛光晚餐**
\`\`\`
romantic candlelit dinner scene, warm 2800K candlelight,
soft side lighting creating glow on faces,
shallow depth of field, medium contrast,
cinematic amber and deep brown palette,
intimate romantic atmosphere
\`\`\`

**恐惧 + 地下室**
\`\`\`
terrifying dark basement scene, single flashlight beam,
harsh top light creating deep shadows on face,
extreme high contrast, cool 3000K dim,
cold green-gray background fading to black,
claustrophobic horror atmosphere
\`\`\`

**希望 + 山顶日出**
\`\`\`
hopeful morning scene, golden 4500K sunrise backlight,
warm rim light on silhouetted figure,
medium high contrast, clean sky background,
inspirational cinematic atmosphere
\`\`\`

**神秘 + 迷雾森林**
\`\`\`
mysterious foggy forest, cool 4000K diffused light,
silhouette rim lighting through atmospheric haze,
high contrast with dark trees against glowing mist,
ethereal enigmatic atmosphere
\`\`\`

**使用建议**
- 一个场景只选 1 种情绪光
- 情绪切换要配合光线变化
- 不要混用冲突的情绪光（例：浪漫烛光 + 恐惧顶光）
- 情绪是第一优先级，其他视觉元素服从情绪光`,
    tags: ['情绪', '光影', '图谱', '布光'],
    keywords: ['mood lighting', 'emotion light atlas', 'color temperature', 'lighting direction', 'cinematic lighting'],
    prompt_snippets: [
      'romantic warm 2800K candlelight, soft side lighting',
      'terrifying 3000K dim flashlight, harsh top light, extreme contrast',
      'hopeful 4500K sunrise backlight, warm rim light silhouette',
      'mysterious 4000K diffused fog light, ethereal atmospheric haze',
    ],
    applies_to: ['director', 'atmosphere'],
    source: '电影照明理论 + 12 种情绪光线组合实践',
    lang: 'zh-en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // v13: AI 视频"去 AI 味"三大类提示词（基于赛博AI 抖音整理）
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_atm_anti_ai_taste',
    collection: 'atmosphere',
    subcategory: '去 AI 味',
    title: 'AI 人物去"AI 味"三大类提示词（光源 / 面部细节 / 前景遮挡）',
    summary: 'AI 人物显假的根源：光线太均匀、皮肤太干净、画面太规整。针对性补三类词即可显著提升真实感。',
    content: `## 为什么 AI 人物看起来假？
1. **光线太均匀** —— 没有明确光源方向，缺立体感与边缘光
2. **皮肤太干净** —— 没有毛孔、雀斑、肤色不均，像塑料贴皮
3. **画面太规整** —— 主体居中、无遮挡、无景深虚化，像证件照

## 解决方案：三大类必加提示词

### 一、光源词（明确光线方向 → 立体感与电影感）
- **头顶光 / top light / overhead light** —— 戏剧性、神圣感、强调发顶反光
- **发丝光 / hair light / rim light on hair** —— 头发边缘亮起，与背景分离
- **侧光 / side light / 45-degree key light** —— 立体五官，最常用的人物布光
- **逆光 / backlight / contre-jour** —— 剪影感，黄金时刻最美
- **窗光 / window light / soft natural window light** —— 自然柔和，电影常用

### 二、面部细节词（破"塑料感" → 显微级真实感）
- **可见毛孔 / visible skin pores / pore-level detail**
- **细微雀斑 / subtle freckles / faint freckles on cheeks and nose bridge**
- **毛孔质感 / realistic skin texture / textured skin surface**
- **肤色不均 / uneven skin tone / natural skin color variation**
- **细小绒毛 / peach fuzz / vellus hair on cheeks**
- **唇纹 / fine lip lines / textured lips**
- **眼袋淡纹 / faint under-eye lines / natural eye creases**
- **皮肤反光 / subsurface scattering / SSS skin shader**

### 三、前景遮挡（破"摆拍感" → 偷窥感与景深）
- **前景虚化绿植 / out-of-focus foreground plants / blurred foreground leaves**
- **遮挡物 / partial foreground obstruction / object framing the subject**
- **中景人物清晰 / midground subject in sharp focus**
- **背景虚化 / heavy background bokeh / shallow depth of field**
- **门框/窗框遮挡 / shot through doorway / framed by window**
- **路过的行人 / passing pedestrians blurring foreground / foreground motion blur**

## 完整组合示例（直接复制使用）

### 例 1：女性特写（最常用）
\`\`\`
beautiful woman portrait, side lighting from window, hair light catching loose strands,
visible skin pores, subtle freckles on cheek bones, peach fuzz on cheeks,
out-of-focus foreground green leaves blurring left edge, midground subject in sharp focus,
heavy background bokeh, 85mm lens, shallow depth of field
\`\`\`

### 例 2：男性街头
\`\`\`
casual man walking city street, top light from setting sun, rim light on hair edge,
realistic skin texture, faint stubble shadows, uneven skin tone,
foreground out-of-focus passing pedestrian, midground subject crisp,
shot from across the street through tree branches
\`\`\`

### 例 3：室内人物
\`\`\`
woman reading by window, soft window light from 45 degrees, gentle rim light on shoulder,
visible pores, subtle under-eye creases, natural lip lines,
foreground blurred coffee cup edge, midground subject in focus,
background bookshelf bokeh, photographic realism
\`\`\`

## 使用原则
1. **三类至少各选 1 个** —— 缺一类就会少一个真实维度
2. **不要全堆** —— 每类挑 1-2 个最贴合场景的，过多反而矛盾
3. **配合相机参数** —— 加 85mm/50mm 焦段词强化景深
4. **慎用"perfect skin"等反向词** —— 直接破坏真实感
5. **优先用英文** —— 多数视频模型对英文 prompt 更敏感`,
    tags: ['去 AI 味', 'anti-AI', '真实感', '光源', '皮肤细节', '前景遮挡', 'depth of field'],
    keywords: [
      '头顶光', '发丝光', '侧光', '可见毛孔', '细微雀斑', '肤色不均', '前景遮挡',
      'top light', 'hair light', 'side light', 'visible pores', 'subtle freckles',
      'foreground bokeh', 'depth of field', 'subsurface scattering', 'realistic skin',
      'peach fuzz', 'rim light',
    ],
    prompt_snippets: [
      'top light, hair light, side lighting from 45 degrees',
      'visible skin pores, subtle freckles, peach fuzz, uneven skin tone',
      'out-of-focus foreground green leaves, midground subject in sharp focus, heavy background bokeh',
      'shot through doorway, foreground obstruction, shallow depth of field',
      'subsurface scattering, realistic skin texture, faint under-eye creases',
    ],
    applies_to: ['director', 'atmosphere', 'screenwriter', 'storyboard', 'character_consistency'],
    source: '@赛博AI 抖音 + 影视布光 + Stable Diffusion 社区实践（v13 整理）',
    lang: 'zh-en',
    enabled: true,
  },
];
