function requiredCharacterIssues(characters = []) {
  const required = [['name', '姓名'], ['gender', '性别'], ['age_range', '年龄'], ['role', '身份']];
  return characters.flatMap((character, index) => required
    .filter(([field]) => !String(character?.[field] || '').trim())
    .map(([, label]) => `角色 ${index + 1} 的${label}`));
}

function updateCharacterSummaries(host, characters = []) {
  [...host.querySelectorAll('[data-character-index]')].forEach((card, index) => {
    const character = characters[index] || {};
    const title = card.querySelector('summary b');
    const summary = card.querySelector('summary small');
    if (title) title.textContent = character.name || `角色 ${index + 1}`;
    if (summary) summary.textContent = [
      character.gender === 'female' ? '女' : character.gender === 'male' ? '男' : '',
      character.age_range || character.age || '', character.role || '',
    ].filter(Boolean).join(' · ') || '基础信息待补充';
  });
}

export function bindCharacterAutosave({ host, blueprint, store, collectBlueprint, toast }) {
  const section = host.querySelector('.story-characters-card');
  const status = section?.querySelector('[data-character-save-status]');
  const button = section?.querySelector('[data-save-characters]');
  let timer = null;
  let inFlight = null;
  let editVersion = 0;
  let savedVersion = 0;

  const setStatus = (message, state = 'idle') => {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  };
  const currentCharacters = () => collectBlueprint(host, blueprint).characters;
  let observedSignature = JSON.stringify(currentCharacters());
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => save({ automatic: true }).catch(() => {}), 900);
  };
  const markDirty = () => {
    const signature = JSON.stringify(currentCharacters());
    if (signature === observedSignature) return;
    observedSignature = signature;
    editVersion += 1;
    setStatus('有未保存修改', 'dirty');
    schedule();
  };
  const save = async ({ automatic = false } = {}) => {
    clearTimeout(timer); timer = null;
    if (inFlight) {
      await inFlight;
      if (savedVersion === editVersion) return true;
    }
    if (savedVersion === editVersion) {
      if (!automatic) toast('角色设置已保存。', 'success');
      return true;
    }
    const version = editVersion;
    const characters = currentCharacters();
    const issues = requiredCharacterIssues(characters);
    if (issues.length) {
      setStatus(`待补：${issues.slice(0, 2).join('、')}`, 'warning');
      const error = new Error(`请先补全${issues.slice(0, 2).join('、')}。`);
      error.code = 'CHARACTER_FIELDS_INCOMPLETE';
      if (!automatic) toast(error.message, 'warning');
      throw error;
    }
    setStatus(automatic ? '正在自动保存…' : '正在保存…', 'saving');
    if (button) button.disabled = true;
    const payload = { ...blueprint, characters };
    inFlight = store.saveBlueprint(payload);
    try {
      const result = await inFlight;
      blueprint.characters = Array.isArray(result?.blueprint?.characters) ? result.blueprint.characters : characters;
      observedSignature = JSON.stringify(currentCharacters());
      savedVersion = version;
      updateCharacterSummaries(host, blueprint.characters);
      if (savedVersion === editVersion) setStatus(automatic ? '已自动保存' : '已保存', 'saved');
      else schedule();
      if (!automatic) toast('角色设置已保存。', 'success');
      return true;
    } catch (error) {
      setStatus('保存失败，请重试', 'error');
      if (automatic) toast(`角色设置未保存：${error.message}`, 'danger');
      throw error;
    } finally {
      inFlight = null;
      if (button) button.disabled = false;
    }
  };

  section?.addEventListener('input', event => {
    if (event.target.closest('[data-character-field]')) markDirty();
  });
  section?.addEventListener('change', event => {
    if (event.target.closest('[data-character-field]')) markDirty();
  });
  button?.addEventListener('click', () => save().catch(() => {}));
  setStatus('修改后自动保存', 'idle');
  return {
    flush: () => save({ automatic: true }),
    cancelPending() { clearTimeout(timer); timer = null; },
    markSaved() { savedVersion = editVersion; setStatus('已保存', 'saved'); },
  };
}

export { requiredCharacterIssues };
