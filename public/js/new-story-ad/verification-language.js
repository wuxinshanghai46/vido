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

  window.NewStoryAdVerificationLanguage = { reason, message };
})();
