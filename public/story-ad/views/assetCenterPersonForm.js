import { escapeHtml } from '../components/ui.js?v=20260828-production-v255';
import { personGenerationSettingsControls } from './assetCenterPlanningDetailsGenerationSettings.js?v=20260828-production-v255';

export function personEditForm(item = {}) {
  const profile = item.profile || {};
  const prompt = String(profile.generation_prompt || '').trim();
  const runtime = item.generation_runtime || {};
  const ratios = Array.isArray(runtime.aspect_ratios) ? runtime.aspect_ratios.filter(Boolean).join(' · ') : '';
  const calls = Math.max(0, Number(runtime.estimated_provider_calls || 0) || 0);
  const outputs = Math.max(0, Number(runtime.expected_output_assets || 0) || 0);
  const routes = Math.max(0, Number(runtime.available_route_count || 0) || 0);
  const settings = profile.generation_settings || {};
  return `<section class="person-edit-panel person-prompt-workbench" data-person-prompt-workbench><header class="person-prompt-head"><div><small>人物生成提示词</small><h3>${escapeHtml(profile.displayName || item.name || '未命名人物')}</h3><p>剧情生成时已写好完整提示词；点击人物即可查看、直接修改。</p></div><div><span>模型生成</span><span>${escapeHtml(item.status || 'draft')}</span></div></header><form id="personEditForm" data-person-edit>
    <label class="person-prompt-editor"><span class="sr-only">完整人物生成提示词</span><textarea name="generation_prompt" rows="18" required spellcheck="false" aria-label="完整人物生成提示词">${escapeHtml(prompt)}</textarea></label>
    <footer class="person-prompt-toolbar" aria-label="人物图片生成设置"><div class="person-prompt-settings">
      <span class="person-setting-chip" title="当前人物生图模型；供应商通道由系统按健康状态选择"><b>◉</b> ${escapeHtml(runtime.model_label || runtime.model_id || '图片模型待配置')}</span>
      ${personGenerationSettingsControls(runtime, settings)}
      ${ratios ? `<span class="person-setting-chip" title="人物档案各生成单元的实际画面规格">▭ ${escapeHtml(ratios)}</span>` : ''}
      ${calls ? `<span class="person-setting-chip" title="按当前 ${Math.max(1, Number(runtime.look_count || 1) || 1)} 套造型计算的供应商生图单元">${calls}组生图 · 1张/组</span>` : ''}
      ${outputs ? `<span class="person-setting-chip" title="包含原子素材与原生人物主视图">${outputs}项素材</span>` : ''}
      <span class="person-setting-chip" title="当前所有人物档案阶段共同可用的模型通道">${routes ? `${routes}条可用通道` : '生图通道暂不可用'}</span>
    </div><div class="person-prompt-actions"><span data-autosave-state="saved">已自动保存</span><button class="person-generate-submit" type="button" data-generate-person aria-label="生成人物" title="使用自动保存的最新提示词生成人物">↑</button></div></footer>
  </form></section>`;
}
