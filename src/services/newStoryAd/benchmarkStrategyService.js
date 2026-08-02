'use strict';

function clean(value = '', max = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalize(input = null) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    source: clean(source.source || 'platform_competitor_learning', 80),
    opening_hook: clean(source.opening_hook || source.openingHook, 500),
    subject_introduction: clean(source.subject_introduction || source.subjectIntroduction, 500),
    proof_sequence: clean(source.proof_sequence || source.proofSequence, 800),
    spectacle: clean(source.spectacle, 600),
    closing: clean(source.closing, 500),
    camera_language: clean(source.camera_language || source.cameraLanguage, 800),
    prompt_method: clean(source.prompt_method || source.promptMethod, 1000),
    naturalness_review: clean(source.naturalness_review || source.naturalnessReview, 800),
    user_edited: source.user_edited === true || source.userEdited === true,
  };
}

function defaults(context = {}) {
  const brief = clean(context.brief || context.text, 4000);
  const rawSubject = clean(context.product_presentation?.subject || context.presentation?.subject || context.product_subject || context.subject || '', 160);
  const subject = /^(?:当前)?(?:广告|展示)?主体$/.test(rawSubject)
    ? (/不锈钢/.test(brief) ? '不锈钢材料与成品背景墙' : '当前展示主体')
    : (rawSubject || '当前展示主体');
  const presentation = context.product_presentation || context.presentation || {};
  const sceneLinked = presentation.scene_linked === true
    || /material_surface|scene_embedded_showcase/.test(String(presentation.mode || ''))
    || /材料|材质|纹理|表面|背景墙|展示墙|展台|空间成果|成品空间/.test(`${brief} ${subject}`);
  const hasComparison = /对比|旧|传统|升级|颠覆/.test(brief);
  const hasMaterial = /材料|材质|纹理|表面|金属|不锈钢|墙面/.test(`${brief} ${subject}`);
  return normalize({
    source: 'platform_competitor_learning',
    opening_hook: sceneLinked
      ? `用完整空间或旧方案建立第一眼反差，不先堆砌产品特写；让观众在 2–4 秒内看懂“这里将发生什么变化”。`
      : `从使用问题、反常状态或结果反差开场，在 2–4 秒内让观众明确主体和观看理由。`,
    subject_introduction: sceneLinked
      ? `由人物走近、触摸或指引展示墙/成品空间，自然带出“${subject}”，避免把材料误做成悬浮的独立商品。`
      : `先给“${subject}”完整轮廓，再进入操作、结构和细节；每个特写都回答一个卖点问题。`,
    proof_sequence: [
      hasComparison ? '旧方案与新成果同构图对比，保持尺度、角度和光线可比较。' : '用前后状态、使用过程或结果建立可见证据。',
      hasMaterial ? '用掠射光微距展示纹理、颜色、反射和边缘工艺，再回到完整空间证明高级感不是局部幻觉。' : '用细节、操作和结果三个层次证明核心卖点。',
    ].join(' '),
    spectacle: hasMaterial
      ? '高潮可采用材料片层分解、纹理样片有序展开、颜色/表面模块组合后回装成完整墙面的效果；运动必须遵守真实厚度、连接关系和重力。'
      : '高潮可采用零件分解—悬停展示—按装配顺序组合—恢复可用状态的效果，保持真实结构关系和运动因果。',
    closing: sceneLinked
      ? '回到完整成品空间，人物停在可读位置，以稳定构图给出价值结论；仅在已授权时叠加品牌标识。'
      : '回到完整产品或最终结果，收束核心价值和行动方向；仅在已授权时叠加品牌标识。',
    camera_language: '建立镜头 → 人物/主体引导推进 → 证据特写与侧向滑移 → 高潮分解/组合或变化镜头 → 拉回完整成果。每站写清起点、终点、方向、速度、景别和可见证据。',
    prompt_method: '提示词按“主体与空间锚点 + 起始状态 + 具体物理动作 + 摄影机轨迹/速度 + 材质与光线变化 + 结束状态 + 连续性锁 + 禁止项”编写，不只堆叠电影感、高级感等形容词。',
    naturalness_review: '所谓“去 AI 味”不能靠故意病句或删掉逻辑。保留事实、品牌词、数字和意图；删除空洞总结与机械连接词，调整长短句和停顿，同时保证口语自然、画面因果完整。',
  });
}

function resolve(context = {}) {
  const base = defaults(context);
  const saved = normalize(context.benchmark_strategy || context.benchmarkStrategy);
  const hasSaved = Object.entries(saved).some(([key, value]) => !['source', 'user_edited'].includes(key) && !!value);
  return hasSaved ? { ...base, ...saved } : base;
}

function promptBlock(context = {}) {
  const strategy = resolve(context);
  return [
    '竞品方法应用合同：只采用通用叙事、摄影和制作方法，不复制具体作品的镜头、人物、品牌、文案或受保护表达。',
    JSON.stringify(strategy),
    '蓝图必须能核对 opening_hook → subject_introduction → proof_sequence → spectacle → closing；camera_language 与 prompt_method 必须下沉到后续镜头设计，不能只作为说明文字展示。',
  ].join('\n');
}

module.exports = { defaults, normalize, promptBlock, resolve };
