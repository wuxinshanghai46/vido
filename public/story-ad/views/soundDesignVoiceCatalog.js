export function speechShotCount(production = {}) {
  return (production.speech || []).filter(row => (row.units || []).length).length;
}

export function voiceSampleText(production = {}, speaker = '') {
  const units = (production.speech || []).flatMap(row => row.units || []);
  const matched = speaker ? units.find(unit => String(unit.speaker || '') === String(speaker)) : units.find(unit => unit.text);
  return String(matched?.text || units.find(unit => unit.text)?.text || '你好，这是当前选择的配音音色试听。').trim().slice(0, 80);
}

function usableStoryVoice(voice = {}) {
  const id = String(voice.id || '').trim();
  const provider = `${voice.providerId || ''} ${voice.provider || ''}`.toLowerCase();
  if (!id || /topview|windows|系统|zhipu|智谱|aliyun|阿里|cosyvoice|智能语音交互|\bnls\b/.test(provider)) return false;
  if (voice.isCloned === true || /^custom[_:]/.test(id)) return voice.has_volc === true && /volcengine-tts|字节|豆包|声音复刻/.test(provider);
  return /volcengine-tts|字节豆包语音/.test(provider);
}

export function recommendedVoice(voices = [], currentId = '', role = 'narrator') {
  const usable = voices.filter(usableStoryVoice);
  const current = usable.find(voice => String(voice.id) === String(currentId || ''));
  if (current) return current;
  return usable.map((voice, index) => {
    const descriptor = `${voice.name || ''} ${voice.tag || ''}`;
    const provider = `${voice.providerId || ''} ${voice.provider || ''}`;
    const score = (/推荐/.test(descriptor) ? 30 : 0)
      + (/volcengine-tts|字节|豆包/.test(provider) ? 20 : 0)
      + (role === 'narrator' && /知性|沉稳|讲述|播报|权威|精准/.test(descriptor) ? 8 : 0);
    return { voice, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index)[0]?.voice || null;
}
