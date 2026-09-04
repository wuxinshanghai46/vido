import { escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js?v=20260904-production-v448';

const REFERENCE_ROLE_META = [
  [/^person_identity_/u, ['人物', '人物身份参考']], [/^cast_identity_board$/u, ['人物', '人物组合身份板']],
  [/^pet_identity_/u, ['动物', '动物身份参考']], [/^scene_identity$/u, ['场景', '场景主视图']],
  [/^scene_view$/u, ['机位视图', '当前镜头机位视图']], [/^director_composition$/u, ['机位视图', '导演台构图截图']],
  [/^scene_layout$/u, ['布局', '空间布局参考']], [/^product_identity$/u, ['商品', '商品身份参考']],
  [/^prop_/u, ['道具', '镜头道具参考']], [/^action_pose$/u, ['人物', '人物动作姿态参考']],
  [/^previous_accepted_frame$/u, ['上一镜', '上一镜连续性参考']], [/^storyboard_composition$/u, ['分镜', '已确认分镜构图']],
];

function referenceRoleMeta(role = '') {
  return REFERENCE_ROLE_META.find(([pattern]) => pattern.test(String(role || '').trim().toLowerCase()))?.[1]
    || ['其他', '其他生成参考'];
}

export function referenceItemsFor(bundle = {}, index = 0, shotIndex = 0) {
  const packs = Array.isArray(bundle?.storyboard?.reference_packs) ? bundle.storyboard.reference_packs : [];
  const pack = packs.find(item => Number(item?.shot_index) === shotIndex)
    || packs.find(item => Number(item?.shot_index) === index)
    || packs[index] || null;
  return (Array.isArray(pack?.references) ? pack.references : [])
    .filter(reference => reference?.url)
    .map((reference, referenceIndex) => {
      const [label, source] = referenceRoleMeta(reference.role);
      return {
        ...reference,
        label,
        source,
        order: Number(reference.order || referenceIndex + 1) || referenceIndex + 1,
      };
    });
}

export function sketchReferenceMarkup(references = [], shotIndex = 0) {
  if (!references.length) return '<div class="sketch-reference-empty" role="status">本镜暂无已编译引用资产。</div>';
  return `<div class="sketch-reference-strip" aria-label="镜头 ${shotIndex} 引用资产">${references.map(reference => (
    `<figure class="sketch-reference-thumb">${mediaPreview({ image_url: reference.url }, {
      label: `镜头 ${shotIndex} · ${reference.label} · ${reference.source}`,
      width: 320,
      zoomable: true,
      zoomGroup: `storyboard-reference-${shotIndex}`,
    })}<figcaption><b>${escapeHtml(`${reference.order}. ${reference.label}`)}</b><small>${escapeHtml(`${reference.source} · ${reference.required === true ? '生成必需' : '辅助参考'}`)}</small></figcaption></figure>`
  )).join('')}</div>`;
}

function dialogReferencesMarkup(references = [], shotIndex = 0) {
  if (!references.length) return '<div class="storyboard-prompt-dialog-empty">本镜暂无已编译引用资产</div>';
  return references.map(reference => `<figure class="storyboard-prompt-dialog-reference">
    ${mediaPreview({ image_url: reference.url }, { label: `镜头 ${shotIndex} · ${reference.label}`, width: 480 })}
    <figcaption><b>${escapeHtml(`${reference.order}. ${reference.label}`)}</b><span>${escapeHtml(reference.source)}</span><small>${reference.required === true ? '生成必需' : '辅助参考'}</small></figcaption>
  </figure>`).join('');
}

function assistAdviceMarkup(result = {}) {
  const conflicts = Array.isArray(result.conflicts) ? result.conflicts.filter(Boolean) : [];
  const improvements = Array.isArray(result.improvements) ? result.improvements.filter(Boolean) : [];
  const action = result.recommended_action === 'review_multiple_shots' ? '检查相关镜头，再逐镜生成' : '保存后重生成本镜';
  return `<b>诊断</b><p>${escapeHtml(result.diagnosis || '提示词已检查。')}</p>${conflicts.length ? `<b>冲突</b><ul>${conflicts.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}${improvements.length ? `<b>修改点</b><ul>${improvements.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}<b>下一步</b><p>${escapeHtml(action)}。${escapeHtml(result.action_reason || '')}</p>`;
}

export function openStoryboardPromptEditor(options = {}) {
  const existing = document.querySelector('[data-storyboard-prompt-dialog]');
  existing?.remove();
  const shotIndex = Number(options.shotIndex || 0);
  const sourceField = options.sourceField || null;
  const overlay = document.createElement('div');
  overlay.className = 'storyboard-prompt-dialog-backdrop';
  overlay.dataset.storyboardPromptDialog = String(shotIndex);
  overlay.innerHTML = `<section class="storyboard-prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="storyboard-prompt-dialog-title-${shotIndex}">
    <header><div><span>SH${String(shotIndex).padStart(2, '0')}</span><h2 id="storyboard-prompt-dialog-title-${shotIndex}">编辑分镜提示词</h2></div><button class="storyboard-prompt-dialog-close" type="button" data-close-prompt-dialog aria-label="关闭提示词编辑器">×</button></header>
    <div class="storyboard-prompt-dialog-content">
      <section class="storyboard-prompt-dialog-references"><div><b>本镜引用资产</b><span>生成时按以下顺序引用</span></div><div class="storyboard-prompt-dialog-reference-grid">${dialogReferencesMarkup(options.references || [], shotIndex)}</div></section>
      <label class="storyboard-prompt-dialog-instruction"><span>AI 修改要求（选填）</span><textarea rows="2" data-dialog-ai-instruction></textarea></label>
      <section class="storyboard-prompt-dialog-advice" data-dialog-ai-advice hidden aria-live="polite"></section>
      <label class="storyboard-prompt-dialog-field"><span>分镜提示词</span><textarea rows="16" data-dialog-sketch-prompt>${escapeHtml(options.promptText || '')}</textarea><small>AI 帮写只会更新当前草稿；保存后也不会自动生成图片。</small></label>
    </div>
    <footer><button class="btn" type="button" data-dialog-ai-assist>AI 诊断并改写</button><div><button class="btn" type="button" data-close-prompt-dialog>取消</button><button class="btn primary" type="button" data-dialog-save-prompt>保存提示词</button></div></footer>
  </section>`;
  document.body.appendChild(overlay);
  document.body.classList.add('has-storyboard-prompt-dialog');
  const field = overlay.querySelector('[data-dialog-sketch-prompt]');
  const instructionField = overlay.querySelector('[data-dialog-ai-instruction]');
  const advice = overlay.querySelector('[data-dialog-ai-advice]');
  const close = () => {
    document.body.classList.remove('has-storyboard-prompt-dialog');
    overlay.remove();
    options.onClose?.();
  };
  const syncDraft = value => {
    field.value = String(value || '');
    if (sourceField) sourceField.value = field.value;
  };
  field.addEventListener('input', () => { if (sourceField) sourceField.value = field.value; });
  overlay.querySelectorAll('[data-close-prompt-dialog]').forEach(button => button.addEventListener('click', close));
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  overlay.querySelector('[data-dialog-ai-assist]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, 'AI 正在完善…', { elapsed: true });
      const result = await options.onAssist?.(field.value, instructionField?.value || '');
      syncDraft(result?.prompt_text || result);
      if (advice && result && typeof result === 'object') {
        advice.innerHTML = assistAdviceMarkup(result);
        advice.hidden = false;
      }
      toast(`SH${shotIndex} 已改写，请确认后保存。`, 'success');
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  });
  overlay.querySelector('[data-dialog-save-prompt]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const promptText = String(field.value || '').trim();
    if (!promptText) return field.focus();
    try {
      setButtonBusy(button, true, '保存中…');
      await options.onSave?.(promptText);
      syncDraft(promptText);
      close();
    } catch (error) {
      toast(error.message, 'danger');
      setButtonBusy(button, false);
    }
  });
  field.focus();
  return { close, setPrompt: syncDraft, element: overlay };
}
