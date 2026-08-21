import { escapeHtml, mediaPreview } from '../components/ui.js?v=20260821-dialogue-v121';

const labels = {
  front: '正面', three_quarter: '三分之四侧', side: '侧面', back: '背面',
  neutral: '平静', natural_smile: '微笑', focused: '专注', doubtful: '沉思', surprised: '惊讶', relaxed_approved: '放松',
  neutral_stand: '自然站立', natural_walk: '自然行走', sit_and_rise: '坐下 / 起身', reach_and_hold: '伸手 / 持物', present_product: '商品展示', interact_with_prop: '道具互动',
};

const text = (value, fallback = '未填写') => escapeHtml(String(value || '').trim() || fallback);
const list = value => Array.isArray(value) ? value.filter(item => item?.image_url) : [];
const byKey = (rows, key, fallbackIndex = 0) => rows.find(item => item.key === key) || rows[fallbackIndex] || null;
const localizedLabel = (view = {}, fallback = '人物素材') => labels[view.key] || view.label || fallback;

function image(item, label, group, width = 720) {
  if (!item?.image_url) return '<div class="media-placeholder"><span>待补充</span></div>';
  return mediaPreview(item, { label, width, symbol: '人物图', zoomable: true, zoomGroup: group });
}

function generatedDetailFigure(view, label, group) {
  const highResolution = view?.detail_mode === 'generated_high_resolution';
  return `<figure class="${highResolution ? 'is-generated-detail' : 'is-legacy-crop'}">${image(view, label, group, highResolution ? 2048 : 640)}<figcaption><span>${escapeHtml(label)}</span><small>${highResolution ? '2K 独立细节图' : '历史裁切图 · 建议重生成高清档案'}</small></figcaption></figure>`;
}

function fact(label, value) {
  return `<div><span>${escapeHtml(label)}</span><b>${text(value)}</b></div>`;
}

function personAge(profile = {}) {
  const value = profile.age_contract?.display_text || profile.age || profile.age_range || '';
  return String(value) === 'match_brief' ? '' : value;
}

function keywords(profile = {}) {
  const source = [profile.roleName, profile.appearanceText, profile.wardrobeText, profile.hairMakeupText]
    .filter(Boolean).join('，').split(/[，。；、·/]/).map(value => value.trim()).filter(value => value.length >= 2);
  return [...new Set(source)].slice(0, 7);
}

export function personDossierShowcase(item = {}) {
  const profile = item.profile || {};
  const body = list(item.view_images);
  const identity = list(item.identity_views);
  const expressions = list(item.expressions);
  const actions = list(item.base_actions);
  const nativeFace = item.native_masters?.face?.image_url ? item.native_masters.face : null;
  const nativeBody = item.native_masters?.body?.image_url ? item.native_masters.body : null;
  const generatedAccessories = list(item.accessory_details).filter(view => view.detail_mode === 'generated_high_resolution');
  const generatedWardrobe = list(item.wardrobe_details).filter(view => view.detail_mode === 'generated_high_resolution');
  const groupRoot = `person-dossier-${item.id || profile.id || 'current'}`;
  const groups = {
    sheet: `${groupRoot}-sheet`,
    views: `${groupRoot}-views`,
    expressions: `${groupRoot}-expressions`,
    wardrobe: `${groupRoot}-wardrobe`,
    accessories: `${groupRoot}-accessories`,
    details: `${groupRoot}-details`,
    actions: `${groupRoot}-actions`,
    masters: `${groupRoot}-native-masters`,
  };
  const displayName = item.name || profile.displayName || '人物档案';
  const views = [byKey(body, 'front', 0), byKey(body, 'side', 2), byKey(body, 'back', 3)].filter(Boolean);
  const detailViews = [byKey(identity, 'face_front', 0), byKey(identity, 'face_profile', 2), byKey(identity, 'hair_back', 3), byKey(body, 'three_quarter', 1)].filter(Boolean);
  const accessories = generatedAccessories;
  const chips = keywords(profile);
  const dossier = item.dossier_sheet?.image_url
    && item.dossier_sheet?.layout === 'elegant_character_archive_v5'
    && Number(item.visual_asset_contract_version || 0) >= 2
    ? item.dossier_sheet
    : null;
  const partial = item.partial_checkpoint === true;
  return `<section class="character-dossier-showcase" aria-label="${escapeHtml(displayName)}完整人物档案">
    <header class="character-dossier-title">
      <div><small>CHARACTER PRODUCTION DOSSIER</small><h2>人物制作档案 · ${escapeHtml(displayName)}</h2><p>${text(profile.roleName || item.role, '剧情广告人物')} · 身份一致、服装一致、动作可复用</p></div><span class="status-tag ${nativeFace && nativeBody ? 'is-success' : 'is-warning'}">${nativeFace && nativeBody ? '原生高清母版可用' : '历史档案 · 建议升级母版'}</span>
    </header>
    ${nativeFace || nativeBody ? `<section class="character-dossier-panel dossier-native-masters"><h3>原生高清身份母版</h3><p>独立生成的原生图，不是从拼版放大裁切；关键帧优先使用面部身份母版。</p><div>${nativeFace ? `<figure>${image(nativeFace, `${displayName} 面部身份母版`, groups.masters, 1600)}<figcaption>面部身份母版</figcaption></figure>` : ''}${nativeBody ? `<figure>${image(nativeBody, `${displayName} 全身比例母版`, groups.masters, 1600)}<figcaption>全身比例母版</figcaption></figure>` : ''}</div></section>` : ''}
    ${dossier ? `<div class="character-dossier-hero">${image(dossier, `${displayName}完整人物设定档案`, groups.sheet, 2400)}<p>完整人物档案 · 点击查看高清大图</p></div><details class="character-dossier-breakdown"><summary>展开查看可复用单图与动作素材</summary>` : `<div class="character-dossier-regenerate-notice"><b>${partial ? '完整人物档案尚未合成' : '当前是历史人物档案'}</b><p>${partial ? '已成功的分类图和人物子资产均已保留；同一档案版本的缺失单元安全完成后，系统才会合成为一张完整人物档案。当前分类拼图不是最终整图。' : '历史档案只有人物原图裁切，不能作为正式人物档案。请使用下方“重生成完整人物档案”，新版会重新生成身体、面部、表情、动作、服装、鞋履和饰品的全部内容。'}</p></div>`}
    <div class="character-dossier-primary">
      <aside class="character-dossier-panel character-dossier-facts"><h3>基本信息</h3>
        ${fact('人物名称', profile.displayName || displayName)}${fact('身份 / 关系', profile.roleName || item.role)}
        ${fact('年龄', personAge(profile))}${fact('原创族裔外貌设定', profile.ethnicity || profile.ethnic_appearance)}
        ${fact('外貌与气质', profile.appearanceText)}${fact('服装与配饰', profile.wardrobeText)}${fact('发型 / 妆造', profile.hairMakeupText)}
      </aside>
      <section class="character-dossier-panel character-dossier-views"><h3>形象展示</h3><div>${views.map((view, index) => `<figure>${image(view, localizedLabel(view, `人物视图 ${index + 1}`), groups.views)}<figcaption>${escapeHtml(localizedLabel(view, `视图 ${index + 1}`))}</figcaption></figure>`).join('')}</div></section>
      <section class="character-dossier-panel character-dossier-expressions"><h3>表情记录</h3><div>${expressions.slice(0, 6).map((view, index) => `<figure>${image(view, localizedLabel(view, `表情 ${index + 1}`), groups.expressions, 520)}<figcaption>${escapeHtml(localizedLabel(view, `表情 ${index + 1}`))}</figcaption></figure>`).join('')}</div></section>
    </div>
    <div class="character-dossier-secondary">
      <section class="character-dossier-panel dossier-wardrobe"><h3>服装拆解</h3><div>${generatedWardrobe.length ? generatedWardrobe.map((view, index) => generatedDetailFigure(view, localizedLabel(view, `${displayName}穿搭 ${index + 1}`), groups.wardrobe)).join('') : '<div class="dossier-accessory-empty">历史档案没有独立服装拆解成品；不再用全身图裁切冒充服装细节。</div>'}</div><p>${text(profile.wardrobeText)}</p></section>
      <section class="character-dossier-panel dossier-accessories"><h3>配饰与鞋履单品</h3><div>${accessories.length ? accessories.map((view, index) => generatedDetailFigure(view, localizedLabel(view, `${displayName}配饰 ${index + 1}`), groups.accessories)).join('') : '<div class="dossier-accessory-empty">设定中没有明确填写耳饰、项链、腕饰或鞋履；系统不会凭空添加配饰。</div>'}</div><p>${generatedAccessories.length ? '只展示设定中明确存在的独立配饰和鞋履单品，不再用头像或全身图冒充配饰。' : '请先在“修改人物信息”中写明实际配饰或鞋履，再重生成高清人物档案。'}</p></section>
      <section class="character-dossier-panel dossier-details"><h3>人物细节</h3><div>${detailViews.map((view, index) => image(view, view.label || `人物细节 ${index + 1}`, groups.details, 520)).join('')}</div></section>
      <section class="character-dossier-panel dossier-keywords"><h3>风格关键词</h3><div>${(chips.length ? chips : ['身份一致', '自然真实', '服装一致', '动作可复用']).map(value => `<span>${escapeHtml(value)}</span>`).join('')}</div></section>
    </div>
    <section class="character-dossier-panel character-dossier-actions"><div class="dossier-section-heading"><h3>动作档案</h3><span>补充参考版缺少的动作类，用于 Seedance 人物一致性与剧情动作参考</span></div><div>${actions.slice(0, 6).map((view, index) => `<figure>${image(view, localizedLabel(view, `动作 ${index + 1}`), groups.actions)}<figcaption>${escapeHtml(localizedLabel(view, `动作 ${index + 1}`))}</figcaption></figure>`).join('')}</div></section>
    <footer class="character-dossier-footer">
      <div><h3>角色介绍</h3><p>${text([profile.roleName, profile.appearanceText].filter(Boolean).join('。'))}</p></div>
      <div><h3>使用约束</h3><p>${text(profile.negativeText, '保持人物身份、五官、发型、服装和体态一致。')}</p></div>
      <div class="dossier-signature"><small>角色签名</small><b>${escapeHtml(profile.displayName || displayName)}</b></div>
    </footer>
    ${dossier ? '</details>' : ''}
  </section>`;
}
