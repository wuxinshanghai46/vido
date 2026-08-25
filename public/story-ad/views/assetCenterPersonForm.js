import { escapeHtml } from '../components/ui.js?v=20260826-production-v228e';

export function personEditForm(item = {}) {
  const profile = item.profile || {};
  const prompt = String(profile.generation_prompt || '').trim();
  return `<section class="person-edit-panel person-prompt-workbench" data-person-prompt-workbench><header class="person-prompt-head"><div><small>人物生成提示词</small><h3>${escapeHtml(profile.displayName || item.name || '未命名人物')}</h3><p>剧情生成时已写好完整提示词；点击人物即可查看、直接修改。</p></div><div><span>模型生成</span><span>${escapeHtml(item.status || 'draft')}</span></div></header><form id="personEditForm" data-person-edit>
    <label class="person-prompt-editor"><span class="sr-only">完整人物生成提示词</span><textarea name="generation_prompt" rows="18" required spellcheck="false" aria-label="完整人物生成提示词">${escapeHtml(prompt)}</textarea></label>
    <footer class="person-prompt-toolbar" aria-label="人物图片生成设置"><div class="person-prompt-settings">
      <span class="person-setting-chip" title="当前人物图片模型"><b>◉</b> GPT Image 2</span>
      <span class="person-setting-chip" title="人物设定图展示比例；内部人物档案按多视图合同生成">▭ 2:1</span>
      <span class="person-setting-chip" title="当前图片适配器使用高画质生成">高画质</span>
      <span class="person-setting-chip" title="当前人物设定图输出清晰度">2K</span>
      <span class="person-setting-chip" title="每次生成一个人物档案">1张</span>
    </div><div class="person-prompt-actions"><button class="btn" type="submit">保存提示词</button><button class="person-generate-submit" type="submit" data-save-regenerate-person aria-label="保存并生成人物" title="保存并生成人物">↑</button></div></footer>
  </form></section>`;
}
