function compact(value = '', max = 5000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function narrativeRecognition(value = '') {
  const text = compact(value);
  const ancient = /古代|古装|前世|王朝|朝代|江湖|雪山围杀|泛舟|街市/.test(text);
  const modern = /现代|当代|千年后|活到现代|回到现代|现代都市/.test(text);
  const samePerson = /活过千年|活到现代|长生不老|本人穿越|同一身份/.test(text);
  const reincarnation = /转生|转世|轮回|投胎|来生|后世化身/.test(text);
  const lines = [];
  if (ancient && modern) lines.push('世界：混合古今；古代场景与现代场景分别建立，不会合并为单一古代世界。');
  else if (ancient) lines.push('世界：包含古代时期；后续将按古代场景与服饰规则规划。');
  else if (modern) lines.push('世界：包含现代时期；后续将按现代场景与服饰规则规划。');
  if (samePerson) lines.push('同一人物跨时代：保持稳定人物身份 ID，并分别建立古代与现代年龄状态、造型和适用场景。');
  if (reincarnation) lines.push('转生人物：与前世建立转生血缘，但作为新的独立身份和现代姓名，不能直接复用前世人物脸与姓名。');
  if (!lines.length) lines.push('当前没有足够的明确时代或身份变化事实；系统会在资产规划时识别，并把结果展示给你确认。');
  return { mixed: ancient && modern, ancient, modern, samePerson, reincarnation, lines };
}

export function narrativeRecognitionPreview(value = '', escapeHtml = input => String(input || '')) {
  const result = narrativeRecognition(value);
  return `<header><b>生成前识别预览</b><small>依据当前剧本文字，提交后仍需通过结构化合同校验</small></header><ul>${result.lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
}

export function bindNarrativeRecognitionLayout({ form, host, escapeHtml }) {
  const screenplayInput = form?.elements?.namedItem('brief');
  const preview = host?.querySelector('[data-brief-recognition-preview]');
  const sync = () => {
    if (!screenplayInput) return;
    screenplayInput.style.height = 'auto';
    screenplayInput.style.height = `${Math.max(352, screenplayInput.scrollHeight + 2)}px`;
    if (preview) preview.innerHTML = narrativeRecognitionPreview(screenplayInput.value || '', escapeHtml);
  };
  sync();
  return sync;
}
