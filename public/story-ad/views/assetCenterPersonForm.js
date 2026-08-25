import { escapeHtml } from '../components/ui.js?v=20260825-production-v226b';
import { personAgeDisplay } from './assetCenterPersonState.js?v=20260825-production-v226b';
import { renderPersonLookEditors } from './assetCenterPersonLooks.js?v=20260825-production-v226b';
import { renderPersonEvolutionEditor } from './assetCenterPersonEvolution.js?v=20260825-production-v226b';

export function personEditForm(item = {}) {
  const profile = item.profile || {};
  const field = (name, label, value, textarea = false) => `<label><span>${label}</span>${textarea
    ? `<textarea name="${name}" rows="3">${escapeHtml(value || '')}</textarea>`
    : `<input name="${name}" value="${escapeHtml(value || '')}">`}</label>`;
  return `<section class="person-edit-panel person-prompt-workbench" data-person-prompt-workbench><header class="person-prompt-head"><div><small>人物生成提示词</small><h3>${escapeHtml(profile.displayName || item.name || '未命名人物')}</h3><p>下列内容就是模型生成该人物时使用的可编辑设定。</p></div><div><span>模型生成</span><span>${escapeHtml(item.status || '草稿')}</span></div></header><form id="personEditForm" data-person-edit>
    <input type="hidden" name="age_source" value="user"><input type="hidden" name="ethnicity_source" value="user">
    <section class="person-prompt-block"><header><b>名称与身份</b><small>人物是谁</small></header><div class="form-grid person-identity-grid">${field('displayName', '名称', profile.displayName)}${field('roleName', '角色 / 职责', profile.roleName || item.role)}<label><span>年龄</span><input name="age" value="${escapeHtml(personAgeDisplay(profile))}" placeholder="如：25岁、18~25岁"><small>留空时由模型按剧情分析。</small></label></div></section>
    <section class="person-prompt-block"><header><b>描述</b><small>外貌、体态与整体气质</small></header>${field('appearanceText', '人物描述', profile.appearanceText, true)}</section>
    ${renderPersonLookEditors(profile)}
    <section class="person-prompt-block"><header><b>特征与表演</b><small>神态、动作和镜头中的行为边界</small></header>${field('performanceText', '表演与动作', profile.performanceText, true)}</section>
    <section class="person-prompt-block"><header><b>一致性与构图规范</b><small>跨镜头保持同一人物；人物站位和机位由场景模块处理</small></header>${field('continuityText', '人物一致性要求', profile.continuityText, true)}</section>
    <section class="person-prompt-block"><header><b>视觉限制</b><small>明确不允许模型生成的内容</small></header>${field('negativeText', '禁止项', profile.negativeText, true)}</section>
    <details class="person-prompt-advanced"><summary>高级身份字段</summary><div class="form-grid two">${field('gender', '性别', profile.gender)}${field('relationship', '人物关系', profile.relationship)}</div><label><span>原创族裔 / 地域外貌设定</span><input name="ethnicity" value="${escapeHtml(profile.ethnicity || profile.ethnic_appearance || '')}" list="personEthnicityOptions" placeholder="如：东亚外貌设计"><datalist id="personEthnicityOptions"><option value="东亚外貌设计"><option value="欧美外貌设计"><option value="南亚外貌设计"><option value="中东外貌设计"><option value="非洲外貌设计"><option value="拉丁裔外貌设计"><option value="多元混合外貌设计"><option value="未指定（原创角色，可修改）"></datalist></label></details>
    ${renderPersonEvolutionEditor(profile)}
    <div class="person-generation-contract"><span>完整人物档案</span><span>身份四视图</span><span>穿搭与配饰细节</span><span>按项目画面合同</span></div>
    <div class="assist-form-actions person-prompt-actions"><button class="btn" type="button" data-ai-assist-person>AI 完善提示词</button><button class="btn" type="submit">保存提示词</button><button class="btn primary" type="submit" data-save-regenerate-person>保存并生成人物</button></div>
  </form></section>`;
}
