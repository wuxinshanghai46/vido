export function bindTextAutosave({ input, status, save, delay = 700, onError = () => {} } = {}) {
  let timer = null;
  let inflight = null;
  let lastSaved = String(input?.value || '');
  let composing = false;
  let disposed = false;
  let lastResult = null;

  const show = (state, message) => {
    if (!status) return;
    status.dataset.autosaveState = state;
    status.textContent = message;
  };
  const schedule = () => {
    clearTimeout(timer);
    if (disposed || composing || String(input.value) === lastSaved) return;
    show('dirty', '有未保存修改');
    timer = setTimeout(() => { flush().catch(() => {}); }, delay);
  };
  const flush = async () => {
    clearTimeout(timer);
    if (composing) return lastResult;
    if (inflight) {
      await inflight;
      if (String(input.value) !== lastSaved) return flush();
      return lastResult;
    }
    const value = String(input.value);
    if (value === lastSaved) return lastResult;
    show('saving', '正在自动保存…');
    inflight = Promise.resolve(save(value)).then(result => {
      lastSaved = value;
      lastResult = result;
      if (String(input.value) === value) show('saved', '已自动保存');
      else schedule();
      return result;
    }).catch(error => {
      show('error', '自动保存失败');
      onError(error);
      throw error;
    }).finally(() => { inflight = null; });
    return inflight;
  };
  const onInput = () => schedule();
  const onCompositionStart = () => { composing = true; clearTimeout(timer); };
  const onCompositionEnd = () => { composing = false; schedule(); };
  const onBlur = () => { flush().catch(() => {}); };
  input?.addEventListener('input', onInput);
  input?.addEventListener('compositionstart', onCompositionStart);
  input?.addEventListener('compositionend', onCompositionEnd);
  input?.addEventListener('blur', onBlur);
  show('saved', '已自动保存');
  return {
    flush,
    dirty: () => String(input?.value || '') !== lastSaved,
    destroy() {
      disposed = true;
      clearTimeout(timer);
      input?.removeEventListener('input', onInput);
      input?.removeEventListener('compositionstart', onCompositionStart);
      input?.removeEventListener('compositionend', onCompositionEnd);
      input?.removeEventListener('blur', onBlur);
    },
  };
}
