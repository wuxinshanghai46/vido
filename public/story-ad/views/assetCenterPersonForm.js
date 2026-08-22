import { escapeHtml } from '../components/ui.js?v=20260822-production-board-v160';
import { personAgeDisplay } from './assetCenterPersonState.js?v=20260822-production-board-v160';
import { renderPersonLookEditors } from './assetCenterPersonLooks.js?v=20260822-production-board-v160';
import { renderPersonEvolutionEditor } from './assetCenterPersonEvolution.js?v=20260822-production-board-v160';

export function personEditForm(item = {}) {
  const profile = item.profile || {};
  const field = (name, label, value, textarea = false) => `<label><span>${label}</span>${textarea
    ? `<textarea name="${name}" rows="3">${escapeHtml(value || '')}</textarea>`
    : `<input name="${name}" value="${escapeHtml(value || '')}">`}</label>`;
  return `<details class="person-edit-panel" open><summary>修改人物信息</summary><form id="personEditForm" data-person-edit>
    <div class="form-grid two">${field('displayName', '人物名称', profile.displayName)}${field('roleName', '身份 / 职责', profile.roleName || item.role)}${field('gender', '性别', profile.gender)}${field('relationship', '人物关系', profile.relationship)}</div>
    <label><span>年龄（确切年龄或年龄区间）</span><input name="age" value="${escapeHtml(personAgeDisplay(profile))}" placeholder="如：22岁、18~25岁、实际年龄1000岁"><small>填写后作为生成硬约束；支持 ~、～、-、—、–、至、到，保存时统一为“22岁”或“18~25岁”。留空则根据剧本和人物关系自动分析。</small></label><input type="hidden" name="age_source" value="user">
    <label><span>原创族裔 / 地域外貌设定</span><input name="ethnicity" value="${escapeHtml(profile.ethnicity || profile.ethnic_appearance || '')}" list="personEthnicityOptions" placeholder="如：东亚外貌设计、欧美外貌设计"><datalist id="personEthnicityOptions"><option value="东亚外貌设计"><option value="欧美外貌设计"><option value="南亚外貌设计"><option value="中东外貌设计"><option value="非洲外貌设计"><option value="拉丁裔外貌设计"><option value="多元混合外貌设计"><option value="未指定（原创角色，可修改）"></datalist><small>这是原创角色设计字段，不会把参考真人的族裔当作识别事实；系统会优先按已确认的地域和剧情自动补齐，无法可靠判断时保留可编辑默认值。</small></label><input type="hidden" name="ethnicity_source" value="user">
    ${field('appearanceText', '外貌与气质（年龄请填写在上方独立字段）', profile.appearanceText, true)}
    <div class="form-grid two">${field('voice_tone', '声音表演', profile.voice_tone)}${field('voice_id', '已绑定音色 ID', profile.voice_id)}</div>
    ${renderPersonEvolutionEditor(profile)}
    ${renderPersonLookEditors(profile)}<p class="form-hint">每套造型会独立补齐服装组成、鞋履、配饰、配色和面料；不会再把跨时代或换装状态合并。</p>
    ${field('negativeText', '禁止项', profile.negativeText, true)}
    <div class="assist-form-actions"><button class="btn" type="button" data-ai-assist-person>AI 帮写人物设定</button><button class="btn primary" type="submit">保存人物文字设定</button></div>
  </form></details>`;
}
