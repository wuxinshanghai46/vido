import { escapeHtml, mediaPreview } from '../components/ui.js?v=20260904-production-v443';

const labels = {
  front: '正面', three_quarter: '三分之四侧', side: '侧面', back: '背面',
  neutral: '平静', natural_smile: '微笑', focused: '专注', doubtful: '沉思', surprised: '惊讶', relaxed_approved: '放松',
  neutral_stand: '自然站立', natural_walk: '自然行走', sit_and_rise: '坐下 / 起身', reach_and_hold: '伸手 / 持物', present_product: '商品展示', interact_with_prop: '道具互动',
};

const text = (value, fallback = '未填写') => escapeHtml(String(value || '').trim() || fallback);
const normalizeImage = item => {
  if (!item || typeof item !== 'object') return null;
  const imageUrl = item.image_url || item.imageUrl || item.url || item.file_url || '';
  return imageUrl ? { ...item, image_url: imageUrl } : null;
};
const list = value => Array.isArray(value) ? value.map(normalizeImage).filter(Boolean) : [];
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

function uniqueImages(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    const url = String(row?.image_url || '');
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function gallerySection(title, description, rows, group, className = '') {
  const items = uniqueImages(rows);
  if (!items.length) return '';
  return `<section class="character-dossier-panel person-image-category ${className}"><header><h3>${escapeHtml(title)}</h3>${description ? `<p>${escapeHtml(description)}</p>` : ''}</header><div>${items.map((view, index) => `<figure>${image(view, localizedLabel(view, `${title} ${index + 1}`), group, 1600)}<figcaption>${escapeHtml(localizedLabel(view, `${title} ${index + 1}`))}</figcaption></figure>`).join('')}</div></section>`;
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
  const nativeFace = normalizeImage(item.native_masters?.face);
  const nativeBody = normalizeImage(item.native_masters?.body);
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
  const normalizedDossier = normalizeImage(item.dossier_sheet);
  const dossier = normalizedDossier?.image_url
    && item.dossier_sheet?.layout === 'elegant_character_archive_v5'
    && Number(item.visual_asset_contract_version || 0) >= 2
    ? normalizedDossier
    : null;
  const partial = item.partial_checkpoint === true;
  const portrait = nativeFace || byKey(identity, 'face_front', 0) || identity[0] || null;
  // The generated dossier sheet also contains expression/action evidence. It is not a
  // person-only view and must never replace the clean identity/body image in the hero.
  const globalImage = nativeBody || byKey(body, 'front', 0) || body[0] || portrait || dossier || null;
  const avatarRows = uniqueImages([nativeFace, ...identity].filter(Boolean));
  const viewRows = uniqueImages([nativeBody, ...body].filter(Boolean));
  const chips = keywords(profile);
  return `<section class="character-dossier-showcase" aria-label="${escapeHtml(displayName)}完整人物档案">
    <header class="character-dossier-title">
      <div><small>CHARACTER PRODUCTION DOSSIER</small><h2>人物制作档案 · ${escapeHtml(displayName)}</h2><p>${text(profile.roleName || item.role, '剧情广告人物')} · 身份一致、服装一致、动作可复用</p></div><span class="status-tag ${nativeFace && nativeBody ? 'is-success' : 'is-warning'}">${nativeFace && nativeBody ? '原生高清母版可用' : '历史档案 · 建议升级母版'}</span>
    </header>
    ${globalImage ? `<div class="character-dossier-hero ${globalImage === dossier ? 'is-global-dossier' : 'is-avatar-fallback'}" data-person-global-image data-global-image-state="${globalImage === dossier ? 'legacy_dossier_fallback' : 'person_only'}">${image(globalImage, globalImage === dossier ? `${displayName}历史合成档案` : `${displayName}人物标准视图`, groups.sheet, globalImage === dossier ? 2400 : 1600)}<p>${globalImage === dossier ? '当前仅有历史合成档案；重新生成后将优先展示独立人物标准视图' : '人物标准视图 · 点击查看高清大图'}</p></div>` : '<div class="character-dossier-regenerate-notice"><b>人物形象尚未生成</b><p>当前没有可展示的人物头像或人物标准视图。</p></div>'}
    ${partial ? '<div class="character-dossier-regenerate-notice"><b>完整人物档案尚未合成</b><p>已成功的人物头像、视图和分类素材均已保留；缺失单元完成后才会合成为完整全局人物图。</p></div>' : ''}
    <div class="person-image-categories" data-person-image-categories>
      ${gallerySection('人物头像', '单人半身身份图与面部角度', avatarRows, groups.masters, 'is-avatar-category')}
      ${gallerySection('人物视图', '全身母版与正面、三分之四、侧面、背面视图', viewRows, groups.views, 'is-view-category')}
      ${gallerySection('穿搭', '服装轮廓、剪裁、面料和鞋履细节', generatedWardrobe, groups.wardrobe, 'is-wardrobe-category')}
      ${gallerySection('服饰与配饰', '仅展示设定中明确存在的服饰、配饰与鞋履单品；不再用头像或全身图冒充配饰', generatedAccessories, groups.accessories, 'is-accessory-category')}
      ${gallerySection('表情', '可复用的表情状态', expressions, groups.expressions, 'is-expression-category')}
      ${gallerySection('动作', '用于剧情表演与人物一致性的动作参考', actions, groups.actions, 'is-action-category')}
    </div>
    <section class="character-dossier-panel character-dossier-facts"><h3>人物信息</h3><div class="person-image-facts">${fact('人物名称', profile.displayName || displayName)}${fact('身份 / 关系', profile.roleName || item.role)}${fact('年龄', personAge(profile))}${fact('原创族裔外貌设定', profile.ethnicity || profile.ethnic_appearance)}${fact('外貌与气质', profile.appearanceText)}${fact('服装与配饰', profile.wardrobeText)}${fact('发型 / 妆造', profile.hairMakeupText)}</div></section>
    <section class="character-dossier-panel dossier-keywords"><h3>风格关键词</h3><div>${(chips.length ? chips : ['身份一致', '自然真实', '服装一致', '动作可复用']).map(value => `<span>${escapeHtml(value)}</span>`).join('')}</div></section>
    <footer class="character-dossier-footer">
      <div><h3>角色介绍</h3><p>${text([profile.roleName, profile.appearanceText].filter(Boolean).join('。'))}</p></div>
      <div><h3>使用约束</h3><p>${text(profile.negativeText, '保持人物身份、五官、发型、服装和体态一致。')}</p></div>
      <div class="dossier-signature"><small>角色签名</small><b>${escapeHtml(profile.displayName || displayName)}</b></div>
    </footer>
  </section>`;
}
