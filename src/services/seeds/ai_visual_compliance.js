/**
 * AI visual quality and compliance knowledge.
 *
 * Public creator material is used only to extract general principles. These
 * entries are rewritten for VIDO and deliberately exclude moderation-evasion
 * instructions or recognizable third-party style imitation.
 */
module.exports = [
  {
    id: 'kb_visual_premium_style_matrix_originality',
    collection: 'atmosphere',
    subcategory: 'Visual Style Matrix',
    title: '高级感来自可观察的风格矩阵，不来自空泛画质词',
    summary: '先描述具体内容，再用灯光、色彩、镜头、材质和颗粒构成原创风格矩阵；不依赖“8K、电影感”或受保护作品名称。',
    content: `高级感提示词采用“基础内容 + 可观察风格矩阵”结构。

基础内容先锁定主体、动作、空间关系、产品和必须可见的叙事信息。风格矩阵再从以下维度选择少量相互兼容的参数：
- 灯光：光源方向、软硬、明暗比、轮廓光、实景光动机；
- 色彩：色温关系、主辅色、饱和度、黑位、对比曲线；
- 镜头：焦段感、机位、景深、透视、运动稳定性；
- 质感：表面材质、空气介质、细颗粒、轻微光晕、真实高光滚降；
- 美术：空间年代、陈设密度、服装轮廓、产品视觉层级。

质量门禁：每个风格词都应能被画面 QA 直接观察。删除“顶级、震撼、8K、超真实、电影感”等无法单独验收的堆词。

版权门禁：不得要求复刻在世创作者、知名影视 IP、受保护角色或标志性作品的可识别风格。把参考意图转译成上述可观察参数，形成与当前任务内容绑定的原创组合。`,
    tags: ['高级感', 'style matrix', '原创风格', '视觉QA', '版权合规'],
    keywords: ['基础内容加风格矩阵', 'lighting', 'color treatment', 'lens', 'film grain', 'original visual language'],
    prompt_snippets: [
      '将空泛的电影感要求改写为：灯光方向、色温关系、对比曲线、镜头透视、材质高光和颗粒强度。',
      '不要模仿具体作品或创作者；提取可观察的光色、镜头、材质和美术参数，生成任务专属原创组合。',
    ],
    applies_to: ['director', 'art_director', 'prompt_engineer', 'test_engineer'],
    source: 'VIDO synthesis from public Douyin creator 上班时间打酱油, video 7664112433132342579, reviewed 2026-07-20',
    source_url: 'https://www.douyin.com/video/7664112433132342579',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_face_realism_authorized_physical_cues',
    collection: 'digital_human',
    subcategory: 'Authorized Face Realism',
    title: '授权人脸的真实感：用生理与光学线索消除蜡像感',
    summary: '真实人脸依赖皮下透光、微小不对称、毛孔与油脂高光等物理线索；仅用于合成、本人授权或明确许可的人脸。',
    content: `人脸真实感不靠“完美皮肤”，而靠相互一致的生理和光学线索：
- 皮肤在耳缘、鼻翼等薄处有克制的皮下透光，不是通体发亮；
- 毛孔、细小纹理、局部肤色变化存在，但强度服从景别和光线；
- 左右面部和表情有自然的微小不对称，眼神与嘴角不过度同步；
- 额头、鼻梁等区域有受光线约束的轻微油脂高光，避免塑料般均匀反射；
- 眼球湿润高光、眼睑厚度、发际碎发和面部软组织运动彼此一致。

使用门禁：只允许完全合成人脸、本人明确同意的人脸或具有有效素材许可的人脸。生成前记录授权状态，输出保留来源与用途范围。名人、公众人物或来源不明的人脸不得进入一致性流程。

禁止把网格、遮挡、马赛克、变形或其他处理当作“过审核”方案；审核失败应停止生成，核验授权或改用原创合成人物。`,
    tags: ['人脸真实感', '授权人脸', 'subsurface scattering', 'skin texture', '合规'],
    keywords: ['蜡像感', '皮下透光', '微小不对称', '油脂高光', '人脸授权', 'face consistency'],
    prompt_snippets: [
      '自然皮肤微纹理与局部色差，克制的皮下透光，轻微生理不对称，受光线约束的油脂高光。',
      '先检查 face_reference_consent；无授权或来源不明时停止人脸一致性生成并改用原创合成人物。',
    ],
    applies_to: ['director', 'art_director', 'prompt_engineer', 'project_assistant', 'test_engineer'],
    source: 'VIDO compliance rewrite from public face-realism observations by Douyin creator 上班时间打酱油, reviewed 2026-07-20',
    source_url: 'https://www.douyin.com/video/7605843079001673012',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_provider_rights_review_error_protocol',
    collection: 'engineering',
    subcategory: 'Provider Review Safety',
    title: '供应商版权与审核型 500 的停止重试协议',
    summary: '供应商 500 可能是版权或内容审核拒绝；不得按普通抖动盲目重试，应保留已完成资产、分类原因并要求改写或核验权利。',
    content: `图片或视频供应商返回版权、知识产权、公众人物、肖像权、内容审核等信号时，将错误归类为审核终止，不进入普通网络重试。

当供应商只返回模糊 5xx 且无法确认是系统故障还是审核拒绝时，也停止自动付费重试：
1. 立即持久化已经成功的视图与生成契约；
2. 标记失败视图和供应商原始错误类别，不把内部错误细节暴露给终端用户；
3. 检查提示词与参考素材中的人物、角色、品牌、Logo、作品名和标志性风格；
4. 有合法授权则补充权利声明和可验证来源；没有授权则改为原创人物、原创视觉语言或通用产品表达；
5. 修改后的契约生成新指纹，只重建受影响候选，不重复计费已成功且仍兼容的视图。

不得通过拆词、错别字、遮挡、变形或其他方式规避供应商审核。`,
    tags: ['provider 500', '版权审核', '停止重试', 'checkpoint', '成本控制'],
    keywords: ['PROVIDER_RIGHTS_AUDIT', 'PROVIDER_CONTENT_AUDIT', 'PROVIDER_5XX_AMBIGUOUS', 'copyright review', 'partial checkpoint'],
    prompt_snippets: [
      '检测受保护角色、名人肖像、商标、Logo、作品名和标志性模仿要求；命中时停止自动生成并请求授权或原创改写。',
      '供应商模糊 5xx 按审核风险处理：保留成功视图，不自动重复付费调用。',
    ],
    applies_to: ['prompt_engineer', 'project_assistant', 'test_engineer', 'director'],
    source: 'VIDO supplier feedback and engineering incident review, 2026-07-20',
    lang: 'zh',
    enabled: true,
  },
];
