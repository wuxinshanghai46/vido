const { cleanText } = require('./contextBuilder');
const shotDesign = require('./shotDesignService');

const EVIDENCE_LABELS = [
  '产品或服务', '产品', '可见文字', '真实环境', '环境', '空间', '场景',
  '材质', '颜色', '色调', '布局', '构图', '光线', '照明', '灯光',
  '人物动作', '人物', '动作',
];

function evidenceField(value = '', labels = []) {
  const source = String(value || '').replace(/\*\*/g, '').replace(/\r/g, '\n');
  for (const label of labels) {
    const match = new RegExp(`(?:^|[\\n\\s-])${label}\\s*[:：]\\s*`, 'u').exec(source);
    if (!match) continue;
    const tail = source.slice(match.index + match[0].length);
    const next = new RegExp(`(?:\\s+-\\s+|\\n+)\\s*(?:${EVIDENCE_LABELS.join('|')})\\s*[:：]`, 'u').exec(tail);
    const result = cleanText(next ? tail.slice(0, next.index) : tail, 500);
    if (result) return result;
  }
  return '';
}

function conciseSceneText(value = '', kind = 'layout') {
  const source = cleanText(value, 1200);
  if (!/(?:逐帧分析|时间点\s*\d+(?:\.\d+)?\s*秒)/u.test(source)) return source;
  const fields = kind === 'material'
    ? [
        ['材质', evidenceField(value, ['材质'])],
        ['颜色', evidenceField(value, ['颜色', '色调'])],
        ['光线', evidenceField(value, ['光线', '照明', '灯光'])],
      ]
    : kind === 'interaction'
      ? [['动作', evidenceField(value, ['人物动作', '动作', '人物'])]]
      : [
          ['环境', evidenceField(value, ['真实环境', '环境', '空间', '场景'])],
          ['布局', evidenceField(value, ['布局', '构图'])],
          ['广告主体', evidenceField(value, ['产品或服务', '产品'])],
        ];
  const concise = fields.filter(([, content]) => content).map(([label, content]) => `${label}：${content}`).join('；');
  return cleanText(concise || source.replace(/^以下是逐帧分析(?:及总结)?[:：]?\s*/u, ''), 500);
}

/** 补齐场景辅助结果；模型漏字段或返回残句时保留已有内容，仍缺失则使用跨行业安全兜底。 */
function enforceAssistedSceneSpec(spec = {}, current = {}, context = {}, options = {}) {
  const output = spec && typeof spec === 'object' ? spec : {};
  const source = current && typeof current === 'object' ? current : {};
  const subject = cleanText(context.product_subject || context.brief || '当前广告主体', 100);
  const fallback = {
    layoutText: `围绕${subject}建立一个可连续拍摄的完整真实空间，明确主体展示区、前景、背景、入口、行动通路和可复用空间边界，保证多个镜头切换视角时仍属于同一地点。`,
    materialLightText: `材质、色彩和光线依据${subject}的真实属性与当前需求确定，保持可观察的纹理、反射、粗糙度和尺度一致；采用自然商业布光与统一色温，避免廉价棚拍、材质漂移和过度虚化。`,
    interactionText: '预留后续可放置人物或商品的空白站位、展示区、近景特写区和连续镜头移动路径；场景参考保持空场景，不生成人物，并确保所有互动区域可到达且没有功能性障碍。',
    negativeText: '不要出现真人、背影、侧脸、手、身体局部、人物倒影或无关主体；不要改变场景、材质、结构和光线方向；不要出现文字、水印、Logo、卡通或三维渲染感。',
  };
  const value = (keys = [], max = 420, kind = 'layout') => cleanText(conciseSceneText(keys.map(key => output[key]).find(Boolean) || '', kind), max);
  const existing = (keys = [], max = 420, kind = 'layout') => cleanText(conciseSceneText(keys.map(key => source[key]).find(Boolean) || '', kind), max);
  const usable = (text, minimum) => text.length >= minimum
    && !/(?:由|为|的|及|以及|包括|采用|融合|形成|一面|一个|一种|位于|呈现)$/u.test(text);
  const preserveCurrentFields = options.preserveCurrentFields === true;
  const complete = (candidate, prior, safeFallback, minimum, max) => {
    if (preserveCurrentFields && usable(prior, minimum)) return cleanText(prior, max);
    if (usable(candidate, minimum)) return cleanText(candidate, max);
    if (usable(prior, minimum)) return cleanText(prior, max);
    return cleanText(safeFallback, max);
  };
  const layoutText = complete(value(['layoutText', 'layout_text', 'layout', 'description']), existing(['layoutText', 'layout_text', 'layout', 'description']), fallback.layoutText, 30, 420);
  const materialLightText = complete(value(['materialLightText', 'material_light_text', 'materialLight', 'material', 'light'], 420, 'material'), existing(['materialLightText', 'material_light_text', 'materialLight', 'material', 'light'], 420, 'material'), fallback.materialLightText, 30, 420);
  const interactionText = complete(value(['interactionText', 'interaction_text', 'interaction', 'camera'], 420, 'interaction'), existing(['interactionText', 'interaction_text', 'interaction', 'camera'], 420, 'interaction'), fallback.interactionText, 24, 320);
  const negativeText = complete(value(['negativeText', 'negative_text', 'negative']), existing(['negativeText', 'negative_text', 'negative']), fallback.negativeText, 24, 420);
  const requestedTopology = output.surfaceTopology || output.surface_topology;
  const existingTopology = source.surfaceTopology || source.surface_topology;
  const topologyInput = preserveCurrentFields && existingTopology && typeof existingTopology === 'object'
    ? existingTopology
    : (requestedTopology && typeof requestedTopology === 'object'
    ? {
      ...requestedTopology,
      user_overrides: Array.isArray(existingTopology?.user_overrides || existingTopology?.userOverrides)
        ? (existingTopology.user_overrides || existingTopology.userOverrides)
        : [],
    }
    : existingTopology);
  const surfaceTopology = shotDesign.reconcileSceneSurfaceTopology(topologyInput, [layoutText, materialLightText, negativeText, topologyInput?.notes]);
  const materialContract = shotDesign.normalizeMaterialContract(
    output.materialContract || output.material_contract || source.materialContract || source.material_contract,
    { sourceText: materialLightText, topology: surfaceTopology, referenceAvailable: false },
  );
  const structuredList = (candidate, prior, keys = [], limit = 20) => {
    const requested = keys.map(key => candidate?.[key]).find(Array.isArray);
    const existingRows = keys.map(key => prior?.[key]).find(Array.isArray);
    if (preserveCurrentFields && existingRows?.length) return existingRows.slice(0, limit);
    if (requested?.length) return requested.slice(0, limit);
    return (existingRows || []).slice(0, limit);
  };
  return {
    layoutText,
    materialLightText,
    interactionText,
    negativeText,
    storyStates: structuredList(output, source, ['storyStates', 'story_states', 'stateTimeline', 'state_timeline'], 20),
    interactionAnchors: structuredList(output, source, ['interactionAnchors', 'interaction_anchors'], 16),
    routes: structuredList(output, source, ['routes', 'movement_routes'], 12),
    propPlacements: structuredList(output, source, ['propPlacements', 'prop_placements'], 20),
    surfaceTopology,
    materialContract,
  };
}

module.exports = { enforceAssistedSceneSpec, conciseSceneText };
