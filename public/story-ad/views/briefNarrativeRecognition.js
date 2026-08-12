function compact(value = '', max = 5000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function narrativeRecognition(value = '') {
  const text = compact(value);
  const crossEra = /古今|跨越千年|千年后|从古代到现代|前世今生/.test(text);
  const ancient = crossEra || /古代|古装|古时|前世|王朝|朝代|江湖|雪山围杀|泛舟|街市/.test(text);
  const modern = /现代|当代|千年后|活到现代|回到现代|现代都市/.test(text);
  const samePerson = /活过千年|活到现代|长生不老|本人穿越|同一身份/.test(text);
  const reincarnation = /转生|转世|轮回|投胎|来生|后世化身/.test(text);
  const lines = [];
  if (ancient && modern) lines.push('世界：混合古今；古代场景与现代场景分别建立，不会合并为单一古代世界。');
  else if (ancient) lines.push('世界：包含古代时期；后续将按古代场景与服饰规则规划。');
  else if (modern) lines.push('世界：包含现代时期；后续将按现代场景与服饰规则规划。');
  if (samePerson) lines.push('同一人物跨时代：保持稳定人物身份 ID，并分别建立古代与现代年龄状态、造型和适用场景。');
  if (reincarnation) lines.push('转生人物：与前世建立转生血缘，但作为新的独立身份和现代姓名，不能直接复用前世人物脸与姓名。');
  if (!lines.length) lines.push('尚未识别到明确时代或身份变化。请在剧本中直接写明“古代 / 现代 / 穿越 / 转生”等事实，避免提交后漏建人物或场景。');
  return { mixed: ancient && modern, ancient, modern, samePerson, reincarnation, concrete: lines.length > 0 && (ancient || modern || samePerson || reincarnation), lines };
}

function updateWorldFieldHints(form, result) {
  const family = form?.elements?.namedItem('world_family');
  const period = form?.elements?.namedItem('world_period');
  const medium = form?.elements?.namedItem('visual_medium');
  const familyAuto = family?.querySelector('option[value="auto"]');
  const mediumAuto = medium?.querySelector('option[value="auto"]');
  const familyLabel = result.mixed ? '已识别：混合古今（古代＋现代）'
    : (result.ancient ? '已识别：古代世界' : (result.modern ? '已识别：现代世界' : '待识别：请在剧本中写明时代'));
  if (familyAuto) familyAuto.textContent = familyLabel;
  if (family?.value === 'auto') family.title = familyLabel;
  if (period && !period.value) period.placeholder = result.mixed
    ? '已识别：古代＋现代；具体朝代未写明'
    : (result.ancient ? '已识别古代；具体朝代未写明' : (result.modern ? '已识别现代；具体年份未写明' : '请填写或在剧本中写明具体时期'));
  if (mediumAuto) mediumAuto.textContent = '待识别：原文未指定真人、3D或动漫';
}

export function bindNarrativeRecognitionLayout({ form }) {
  const screenplayInput = form?.elements?.namedItem('brief');
  const sync = () => {
    if (!screenplayInput) return;
    screenplayInput.style.height = 'auto';
    screenplayInput.style.height = `${Math.max(352, screenplayInput.scrollHeight + 2)}px`;
    const result = narrativeRecognition(screenplayInput.value || '');
    updateWorldFieldHints(form, result);
  };
  sync();
  return sync;
}
