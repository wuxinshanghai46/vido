(() => {
  const rules = [
    [/\b(?:shoe|shoes|footwear|sneaker|sneakers|heel|heels|boot|boots)\b/i, '不同视图中的鞋型、鞋跟或鞋子外观不一致。'],
    [/\b(?:wardrobe|outfit|clothing|clothes|garment|dress|shirt|jacket|trouser|pants|skirt|accessor)\w*\b/i, '不同视图中的服装、颜色或配饰不一致。'],
    [/\b(?:hair|hairstyle|bangs|ponytail|hairline)\b/i, '不同视图中的发型、发色或发际线不一致。'],
    [/\b(?:identity|face|facial|same person|different person)\b/i, '不同视图中的人物身份或面部特征不一致。'],
    [/\b(?:age|older|younger)\b/i, '不同视图中的人物年龄特征不一致。'],
    [/\b(?:body|proportion|anatomy|limb|hand|finger)\w*\b/i, '不同视图中的体态、身体比例或肢体结构不一致。'],
    [/\b(?:extra person|multiple people|person count|people count)\b/i, '画面中的人物数量与要求不一致。'],
    [/\b(?:watermark|logo|caption|subtitle|text)\b/i, '参考图中存在不应出现的文字、水印或标识。'],
    [/\b(?:collage|border|grid|panel)\b/i, '参考图存在拼图边框或分栏，无法作为独立视图验证。'],
  ];

  function reason(value = '', subject = '资产') {
    const text = String(value || '').trim();
    if (!text || /[\u3400-\u9fff]/u.test(text)) return text;
    return rules.find(([pattern]) => pattern.test(text))?.[1]
      || `${subject}在不同视图中存在不一致，请根据验证评分重新生成或调整后复验。`;
  }

  function message(value = '', subject = '资产', state = 'rejected') {
    const text = String(value || '').trim();
    if (!text || /[\u3400-\u9fff]/u.test(text)) return text;
    if (state === 'unavailable') return `${subject}视觉验证暂时不可用，请稍后重试。`;
    return reason(text, subject);
  }

  const FIELD_RULES = {
    person: [
      [/(?:年龄|age|older|younger)/i, '人物与表演 → 该人物年龄；独立外貌 / 年龄 / 气质'],
      [/(?:鞋|服装|配饰|wardrobe|outfit|clothing|shoe|accessor)/i, '人物与表演 → 独立服装 / 鞋 / 配饰'],
      [/(?:发型|发色|发际线|妆|hair|hairstyle|makeup)/i, '人物与表演 → 独立发型 / 妆造'],
      [/(?:身份|面部|脸|体态|身体|比例|identity|face|facial|body|proportion)/i, '人物与表演 → 独立外貌 / 年龄 / 气质'],
      [/(?:数量|多余人物|person count|people count|extra person)/i, '人物与表演 → 主体模式；精确人物数量'],
      [/(?:文字|水印|标识|watermark|logo|text)/i, '人物与表演 → 该人物禁止项'],
    ],
    scene: [
      [/(?:布局|空间|结构|区域|定位|覆盖|layout|space|spatial|geometry|zone|coverage)/i, '场景空间设定 → 空间布局 / 主体位置'],
      [/(?:材质|纹理|表面|光线|色温|真实|material|texture|surface|finish|light|realism)/i, '场景空间设定 → 材质 / 色彩 / 光线'],
      [/(?:互动|机位|视角|构图|路线|interaction|camera|view|composition|route)/i, '场景空间设定 → 互动区 / 可用机位'],
      [/(?:拼缝|主墙|连续表面|topology|seam|primary surface)/i, '场景空间设定 → 高级设置 → 表面结构'],
      [/(?:人物|文字|水印|无关|禁止|forbidden|person|watermark|logo|unexpected)/i, '场景空间设定 → 场景禁止项'],
    ],
  };

  function guidance({ subject = '资产', reasons = [], scores = [], tone = '' } = {}) {
    if (tone === 'unavailable') return ['无需修改上述提示字段；这是验证服务异常，请只执行“再次验证”，不要重新生成图片。'];
    const group = /场景|空间/.test(subject) ? 'scene' : (/人物|演员/.test(subject) ? 'person' : '');
    if (!group) return [];
    const evidence = [
      ...(Array.isArray(reasons) ? reasons : []),
      ...(Array.isArray(scores) ? scores.filter(item => Number(item.percent) < 80).map(item => item.label) : []),
    ].join('；');
    const matched = (FIELD_RULES[group] || [])
      .filter(([pattern]) => pattern.test(evidence))
      .map(([, field]) => field);
    return [...new Set(matched)].slice(0, 4);
  }

  window.NewStoryAdVerificationLanguage = { reason, message, guidance };
})();
