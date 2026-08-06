const { cleanText } = require('./contextBuilder');

// Image providers commonly cap prompts around 2,500 characters. Keep every
// task-specific constraint category, but give the visual/action and identity
// locks more room than explanatory prose. This is semantic compaction, not an
// industry template and not a blind tail cut.
function compactKeyframePrompt(parts = [], maxChars = 2400) {
  const lines = (Array.isArray(parts) ? parts : [parts])
    .filter(Boolean)
    .flatMap(value => String(value).split(/\r?\n/))
    .map(value => cleanText(value, 1200))
    .filter(value => value && !/^(?:Strict actor consistency lock|Storyboard scene binding lock|Strict scene consistency lock|Strict shot continuity lock):$/i.test(value));
  const categories = [
    { name: 'context', cap: 140, items: 2, match: /^Campaign brief:|^Photorealistic live-action/i },
    { name: 'subject', cap: 130, items: 2, match: /^Advertised subject|^Shot \d+:/i },
    { name: 'visual', cap: 300, items: 2, match: /User-edited visual override|^Visual:|Final priority:/i },
    { name: 'action', cap: 180, items: 2, match: /^Action:|^Current shot action:|Visible interaction grounding/i },
    { name: 'design', cap: 880, items: 10, whole_lines: true, match: /^Shot scope:|^This is an isolated product\/sample comparison insert|^Master environment only|Surface topology lock:|Surface conflict resolution \(authoritative\):|Seam policy:|Finish distribution:|Task-specific surface note:|Motion effect plan:|START KEYFRAME|Effect source state|Later animation target|Preserve the locked scene geometry|Target reference asset|Task-specific effect note:/i },
    { name: 'actor', cap: 700, items: 7, match: /Actor photorealism lock|Actor compliance lock|Person QA required|no-human lock|If the shot includes any body part|actor consistency lock|Actor wardrobe lock|Actor identity|Actor hair|Actor appearance|Actor name|Actor reference|Locked real actor|Locked cast profiles|Do not crop/i },
    { name: 'pet', cap: 340, items: 2, match: /Pet consistency lock/i },
    { name: 'scene', cap: 430, items: 6, match: /Scene photorealism lock|scene consistency lock|scene binding lock|Locked scene asset|Scene lock strength|Scene material lock|Scene layout lock|Scene style lock|Scene reference images|Required scene view|Required visible scene anchors|Required scene zone|Shot scene binding|keyframe must be generated inside/i },
    { name: 'repair', cap: 220, items: 4, match: /Previous visual QA rejected|structured consistency conflicts|^(?:场景空间|人物身份|产品主体)：/i },
    { name: 'continuity', cap: 220, items: 6, match: /shot continuity lock|^Continuity from:|^Entry frame state:|^Exit frame state:|^Action start\/end:|^Screen direction:|^Eyeline:|^Camera axis:|^Camera movement:|^Object state lock:|^Transition:|^Requires previous frame:|Continuity reference from previous accepted keyframe|Previous keyframe prompt summary/i },
    { name: 'product', cap: 200, items: 5, match: /Product visibility|Product presentation|Commercial evidence|Product identity lock|Product shape lock|Product material lock|Product color lock|Product reference images/i },
    { name: 'style', cap: 140, items: 2, match: /^Style:|Visual style direction|Scene direction|Custom scene requirement/i },
    { name: 'knowledge', cap: 650, items: 10, whole_lines: true, match: /^Knowledge policy|^HARD:|^GUIDANCE:/i },
    { name: 'safety', cap: 220, items: 3, match: /Forbidden:|Negative visual|Semantic fidelity rule|Never infer a different industry|Use a real camera look/i },
    { name: 'other', cap: 40, items: 1, match: /.*/ },
  ];
  const buckets = new Map(categories.map(category => [category.name, []]));
  const classificationOrder = ['repair', 'knowledge', 'safety', 'context', 'subject', 'visual', 'action', 'design', 'actor', 'pet', 'scene', 'continuity', 'product', 'style', 'other']
    .map(name => categories.find(category => category.name === name))
    .filter(Boolean);
  lines.forEach(line => {
    const category = classificationOrder.find(item => item.match.test(line)) || categories[categories.length - 1];
    buckets.get(category.name).push(line);
  });
  const excerpts = categories.map((category, categoryIndex) => {
    let values = buckets.get(category.name) || [];
    if (category.name === 'actor') {
      const rank = value => /Actor photorealism lock/i.test(value) ? 0
        : (/Actor compliance lock/i.test(value) ? 1
          : (/actor consistency lock|Actor wardrobe lock/i.test(value) ? 2
            : (/Person QA required/i.test(value) ? 3 : (/If the shot includes any body part/i.test(value) ? 4 : 5))));
      values = values.slice().sort((a, b) => rank(a) - rank(b));
    } else if (category.name === 'context') {
      values = values.slice().sort((a, b) => (/^Campaign brief:/i.test(a) ? 0 : 1) - (/^Campaign brief:/i.test(b) ? 0 : 1));
    } else if (category.name === 'product') {
      const rank = value => /Product identity lock/i.test(value) ? 0
        : (/Product material lock/i.test(value) ? 1
          : (/Product shape lock|Product color lock/i.test(value) ? 2
            : (/Product visibility/i.test(value) ? 3 : (/Product presentation/i.test(value) ? 4 : 5))));
      values = values.slice().sort((a, b) => rank(a) - rank(b));
    } else if (category.name === 'continuity') {
      const rank = value => /^Object state lock:/i.test(value) ? 0
        : (/^Entry frame state:/i.test(value) ? 1 : (/^Exit frame state:/i.test(value) ? 2 : (/^Transition:/i.test(value) ? 3 : 4)));
      values = values.slice().sort((a, b) => rank(a) - rank(b));
    } else if (category.name === 'scene') {
      const rank = value => /Scene photorealism lock/i.test(value) ? 0
        : (/scene consistency lock|scene binding lock|Required visible scene anchors|Scene material lock/i.test(value) ? 1
          : (/Shot scene binding|Locked scene asset|Required scene view/i.test(value) ? 2 : 3));
      values = values.slice().sort((a, b) => rank(a) - rank(b));
    } else if (category.name === 'style') {
      values = values.slice().sort((a, b) => (/Visual style direction/i.test(a) ? 0 : 1) - (/Visual style direction/i.test(b) ? 0 : 1));
    } else if (category.name === 'safety') {
      const rank = value => /Semantic fidelity rule/i.test(value) ? 0 : (/^Forbidden:|Negative visual|no-human lock/i.test(value) ? 1 : (/Use a real camera look/i.test(value) ? 2 : 3));
      values = values.slice().sort((a, b) => rank(a) - rank(b));
    } else if (category.name === 'design') {
      const rank = value => /^Surface conflict resolution \(authoritative\):/i.test(value) ? 0
        : (/isolated product\/sample comparison insert/i.test(value) ? 1
          : (/^Surface topology lock:/i.test(value) ? 2
            : (/^Seam policy:/i.test(value) ? 3
              : (/^Finish distribution:/i.test(value) ? 4
                : (/^Task-specific surface note:/i.test(value) ? 5
                  : (/^Master environment only/i.test(value) ? 6 : 7))))));
      values = values.slice().sort((a, b) => rank(a) - rank(b));
    }
    const selected = [...new Set(values)].slice(0, category.items || 1);
    if (category.whole_lines) {
      const complete = [];
      let used = 0;
      for (const value of selected) {
        const normalized = cleanText(value, 1200);
        const nextSize = normalized.length + (complete.length ? 3 : 0);
        if (!normalized || used + nextSize > category.cap) continue;
        complete.push(normalized);
        used += nextSize;
      }
      return { name: category.name, index: categoryIndex, text: complete.join(' | ') };
    }
    if (category.name === 'actor') {
      let remaining = category.cap - Math.max(0, selected.length - 1) * 3;
      const rendered = selected.map((value, index) => {
        const preferred = /Actor photorealism lock/i.test(value)
          ? 350
          : (/Actor compliance lock/i.test(value) ? 110 : 48);
        const remainingItems = selected.length - index - 1;
        const reservedTail = remainingItems * 40;
        const allowance = Math.max(40, Math.min(preferred, remaining - reservedTail));
        const text = cleanText(value, allowance);
        remaining -= text.length;
        return text;
      }).filter(Boolean);
      return { name: category.name, index: categoryIndex, text: rendered.join(' | ') };
    }
    const perItem = Math.max(40, Math.floor((category.cap - Math.max(0, selected.length - 1) * 3) / Math.max(1, selected.length)));
    return {
      name: category.name,
      index: categoryIndex,
      text: selected.map(value => cleanText(value, perItem)).filter(Boolean).join(' | '),
    };
  }).filter(excerpt => excerpt.text);
  const limit = Math.max(400, Number(maxChars) || 2400);
  const requiredExcerpt = excerpt => {
    if (excerpt.name === 'safety') return /Semantic fidelity rule:/i.test(excerpt.text);
    if (excerpt.name === 'design') return /Surface conflict resolution \(authoritative\):/i.test(excerpt.text);
    if (excerpt.name === 'scene') return /Shot scene binding:/i.test(excerpt.text);
    if (excerpt.name === 'actor') return /Locked real actor\/person asset:|Explicit no-human lock:/i.test(excerpt.text);
    if (excerpt.name === 'pet') return /Pet consistency lock:/i.test(excerpt.text);
    if (excerpt.name === 'product') return /Product identity lock:/i.test(excerpt.text);
    if (excerpt.name === 'visual') return /User-edited visual override, highest priority:/i.test(excerpt.text);
    if (excerpt.name === 'knowledge') return /^Knowledge policy|^HARD:|^GUIDANCE:/i.test(excerpt.text);
    return false;
  };
  const selectedIndexes = new Set();
  let used = 0;
  const reserve = excerpt => {
    const nextSize = excerpt.text.length + (selectedIndexes.size ? 1 : 0);
    if (used + nextSize > limit) return false;
    selectedIndexes.add(excerpt.index);
    used += nextSize;
    return true;
  };
  // Reserve every generation-critical category before filling optional context.
  // The final output is restored to its natural category order afterwards.
  for (const excerpt of excerpts.filter(requiredExcerpt)) reserve(excerpt);
  for (const excerpt of excerpts) {
    if (selectedIndexes.has(excerpt.index)) continue;
    reserve(excerpt);
  }
  return excerpts
    .filter(excerpt => selectedIndexes.has(excerpt.index))
    .sort((a, b) => a.index - b.index)
    .map(excerpt => excerpt.text)
    .join('\n');
}

module.exports = { compactKeyframePrompt };
