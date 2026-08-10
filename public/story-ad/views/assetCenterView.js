import { request } from '../api.js?v=20260810-scene-config-release-rebase-v130';
import { bindMediaLightbox, emptyState, escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js?v=20260810-scene-config-release-rebase-v130';
import { confirmDialog } from '../components/dialog.js?v=20260810-scene-config-release-rebase-v130';
import { openActorLibrary, openRealPersonFlow } from './assetCenterPersonSources.js?v=20260810-scene-config-release-rebase-v130';
import { bindSceneWorldWorkspace, renderSceneWorldWorkspace } from './sceneWorldView.js?v=20260810-scene-config-release-rebase-v130';
import { renderSceneCoverCard } from './sceneDossierCard.js?v=20260810-scene-config-release-rebase-v130';
import { authorizeBillingReviews, bindCombinedVisualGeneration, visualGenerationState } from './assetCenterBillingRetry.js?v=20260810-scene-config-release-rebase-v130';
import { collectPersonLookValues, renderPersonLookEditors } from './assetCenterPersonLooks.js?v=20260810-scene-config-release-rebase-v130';
import { legacyDossierBoard, mediaSection } from './assetCenterDossierSections.js?v=20260810-scene-config-release-rebase-v130';
const GROUPS = [
  ['people', '人物'],
  ['animals', '动物'],
  ['products', '商品 / 展示主体'],
  ['logos', 'LOGO'],
  ['scenes', '场景与机位'],
];
const GENERATABLE = new Set(['people', 'animals']);

function groupLabel(group = '') {
  return GROUPS.find(([id]) => id === group)?.[1] || '资产';
}

function hasGeneratedMedia(item = {}) {
  return Boolean(item.dossier_sheet?.image_url
    || (Array.isArray(item.view_images) && item.view_images.length >= 4));
}

function personAssetState(item = {}) {
  if (item.dossier_sheet?.image_url && Number(item.visual_asset_contract_version || 0) >= 2) return 'complete_dossier';
  if (item.dossier_sheet?.image_url) return 'upgrade_required';
  if (Array.isArray(item.view_images) && item.view_images.length) return 'legacy_views';
  return 'missing';
}

function subjectNeedsGeneration(item = {}, kind = '') {
  return kind === 'human'
    ? personAssetState(item) !== 'complete_dossier'
    : !hasGeneratedMedia(item);
}

function sceneNeedsGeneration(item = {}) {
  const hasAnyMedia = Boolean(item.layout?.image_url
    || item.scene_master?.image_url
    || (Array.isArray(item.view_images) && item.view_images.some(view => view?.image_url))
    || (Array.isArray(item.cameras) && item.cameras.some(camera => camera?.image_url)));
  const repairKeys = Array.isArray(item.repair_plan?.view_keys) ? item.repair_plan.view_keys.filter(Boolean) : [];
  return !hasAnyMedia || (item.repair_plan?.action === 'regenerate_failed_views' && repairKeys.length > 0);
}

function profileList(bundle = {}, key = '') {
  return (bundle.assets?.[key] || []).map(item => item.profile).filter(profile => profile?.id);
}

export function subjectGenerationPayload(bundle = {}, target = null, requestKey = '') {
  const people = bundle.assets?.people || [];
  const animals = bundle.assets?.animals || [];
  const castProfiles = profileList(bundle, 'people');
  const petProfiles = profileList(bundle, 'animals');
  const payload = {
    task_id: bundle.project?.id || '',
    brief: bundle.brief?.text || '',
    expected_people: castProfiles.length,
    expected_animals: petProfiles.length,
    cast_profiles: castProfiles,
    pet_profiles: petProfiles,
    request_key: requestKey,
    person_spec: {
      castMode: bundle.brief?.cast_mode || (castProfiles.length > 1 ? 'group' : (castProfiles.length ? 'single' : 'no_human')),
      expected_people: castProfiles.length,
      expected_animals: petProfiles.length,
    },
  };
  if (target) {
    const group = target.kind === 'animal' ? 'animals' : 'people';
    const source = group === 'animals' ? animals : people;
    const index = Math.max(0, source.findIndex(item => item.asset_id === target.asset_id || item.id === target.id));
    const selected = {
      kind: group === 'animals' ? 'pet' : 'human',
      id: target.subject_id || target.profile?.id || '',
      index,
    };
    const missing = [
      ...people.map((item, subjectIndex) => ({ item, kind: 'human', index: subjectIndex })),
      ...animals.map((item, subjectIndex) => ({ item, kind: 'pet', index: subjectIndex })),
    ].filter(entry => entry.kind === 'human'
      ? personAssetState(entry.item) === 'missing'
      : subjectNeedsGeneration(entry.item, entry.kind))
      .map(entry => ({ kind: entry.kind, id: entry.item.subject_id || entry.item.profile?.id || '', index: entry.index }));
    payload.subject_targets = [selected, ...missing].filter((entry, entryIndex, rows) => (
      entry.id && rows.findIndex(candidate => candidate.kind === entry.kind && candidate.id === entry.id && candidate.index === entry.index) === entryIndex
    ));
    payload.regenerate_selected = true;
    payload.resume_partial_checkpoint = target.partial_checkpoint === true;
    payload.person_change_kind = target.kind === 'animal' ? 'semantic' : 'visual_dossier';
  } else {
    const pending = [
      ...people.map((item, index) => ({ item, kind: 'human', index })),
      ...animals.map((item, index) => ({ item, kind: 'pet', index })),
    ].filter(entry => entry.kind === 'human'
      ? subjectNeedsGeneration(entry.item, 'human')
      : subjectNeedsGeneration(entry.item, 'pet'));
    if (pending.length) {
      payload.subject_targets = pending.map(entry => ({
        kind: entry.kind,
        id: entry.item.subject_id || entry.item.profile?.id || '',
        index: entry.index,
      })).filter(entry => entry.id);
      payload.regenerate_selected = pending.some(entry => entry.kind === 'human' && personAssetState(entry.item) !== 'missing');
      payload.person_change_kind = payload.regenerate_selected ? 'visual_dossier' : 'semantic';
    }
  }
  return payload;
}

function generationValidation(payload = {}) {
  if (!payload.brief) return '请先在“目标与材料”填写广告目标。';
  if (!payload.expected_people && !payload.expected_animals) return '当前项目还没有人物或动物档案，请先完善主体资料。';
  if (payload.cast_profiles.length !== payload.expected_people) return `人物档案数量不完整：需要 ${payload.expected_people} 份。`;
  if (payload.pet_profiles.length !== payload.expected_animals) return `动物档案数量不完整：需要 ${payload.expected_animals} 份。`;
  for (const [index, profile] of payload.cast_profiles.entries()) {
    const missing = [['姓名', profile.displayName], ['角色', profile.roleName], ['外貌', profile.appearanceText], ['发型/妆造', profile.hairMakeupText]]
      .filter(([, value]) => !String(value || '').trim()).map(([label]) => label);
    if (missing.length) return `人物 ${index + 1} 缺少：${missing.join('、')}。`;
    const looks = Array.isArray(profile.look_profiles) ? profile.look_profiles : [];
    if (!looks.length || looks.some(look => !String(look.wardrobeText || '').trim())) return `人物 ${index + 1} 至少需要一套完整造型。`;
    if (looks.length > 1 && looks.some(look => !(look.scene_ids || []).length && !String(look.story_state || '').trim())) return `人物 ${index + 1} 的每套造型都需要填写适用场景或剧情状态。`;
  }
  for (const [index, profile] of payload.pet_profiles.entries()) {
    if (!String(profile.type || '').trim() || !String(profile.appearance || '').trim()) return `动物 ${index + 1} 缺少类型或外观特征。`;
  }
  return '';
}

function assetCard(item, group) {
  const views = Array.isArray(item.view_images) ? item.view_images.length : 0;
  const personState = group === 'people' ? personAssetState(item) : '';
  const sceneDetail = group === 'scenes' ? [
    item.reference_only ? '未绑定场景参考' : '',
    item.zones?.length ? `${item.zones.length} 个区域` : '',
    item.cameras?.length ? `${item.cameras.length} 个机位` : '',
    views ? `${views} 个视角` : '',
    item.candidate_count ? `${item.candidate_count} 选 1` : '',
    item.shot_refs?.length ? `用于 ${item.shot_refs.length} 个镜头` : '',
  ] : [];
  const productDetail = group === 'products' ? [
    item.presentation?.label,
    item.presentation?.scene_linked ? `关联 ${item.linked_scene_ids?.length || 0} 个场景` : '',
    item.image_url ? '已有独立素材' : '无独立商品图',
  ] : [];
  const detail = (group === 'scenes' ? sceneDetail : (group === 'products' ? productDetail : [
    item.partial_checkpoint ? `已保留 ${item.completed_checkpoint_units || 0} 个成功单元 · 档案待补齐` : '',
    personState === 'legacy_views' ? '仅历史四视图 · 尚未生成完整档案' : '',
    item.role,
    views ? `${views} 个视图` : '',
    item.revision ? `版本 ${item.revision}` : '',
  ]))
    .filter(Boolean).join(' · ');
  const needsGeneration = group === 'people'
    ? personState !== 'complete_dossier'
    : (GENERATABLE.has(group) && !hasGeneratedMedia(item));
  const needsProductVerification = group === 'products' && Boolean(item.image_url) && item.status !== 'verified';
  const sceneGenerated = group === 'scenes' && Boolean(item.layout?.image_url || item.view_images?.length || item.cameras?.some(camera => camera.image_url));
  return `<article class="asset-card ${GENERATABLE.has(group) ? 'is-subject' : ''} ${group === 'scenes' ? 'is-scene' : ''}">
    <div class="asset-card-preview">
      <div class="asset-card-media">${group === 'scenes' ? renderSceneCoverCard(item) : mediaPreview(item, { label: item.name, width: 720, symbol: groupLabel(group), zoomable: true, zoomGroup: `asset-${group}` })}</div>
      <button class="asset-card-copy" type="button" data-asset-group="${group}" data-asset-id="${escapeHtml(item.id)}" aria-label="查看${escapeHtml(item.name)}完整详情">
        <span>${escapeHtml(item.partial_checkpoint ? '部分资产已保留' : (personState === 'legacy_views' ? '历史四视图' : (personState === 'upgrade_required' ? '旧版档案 · 待升级' : (personState === 'complete_dossier' ? '完整档案' : (item.status || '未确认')))))}</span>
        <b>${escapeHtml(item.name)}</b>
        <small>${escapeHtml(detail || '点击查看当前项目中的真实详情')}</small>
      </button>
    </div>
    <div class="asset-card-actions">
      <button class="btn small" type="button" data-asset-group="${group}" data-asset-id="${escapeHtml(item.id)}">${personState === 'legacy_views' ? '查看参考档案' : `查看${item.dossier_sheet?.image_url ? '完整档案' : (group === 'scenes' ? '完整场景档案' : '完整视图')}`}</button>
      ${needsGeneration ? `<button class="btn small primary ${personState === 'legacy_views' || personState === 'upgrade_required' ? 'complete-dossier-action' : ''}" type="button" data-generate-asset="${escapeHtml(item.id)}" data-generate-group="${group}">${group === 'people' ? (personState === 'upgrade_required' ? '升级独立穿搭 / 配饰档案' : '生成完整人物档案') : '生成该动物资产'}</button>` : ''}
      ${group === 'people' && personState === 'complete_dossier' ? `<button class="btn small" type="button" data-generate-asset="${escapeHtml(item.id)}" data-generate-group="${group}">重生成完整人物档案</button>` : ''}
      ${group === 'people' && item.status === 'verified' && !item.provider_asset_id ? `<button class="btn small" type="button" data-sync-person-provider="${escapeHtml(item.id)}">同步 / 重试 Seedance 人物 ID</button>` : ''}
      ${group === 'products' ? `<button class="btn small" type="button" data-upload-product="${escapeHtml(item.id)}">${item.image_url ? '更换主体图片' : '上传主体图片'}</button><button class="btn small primary" type="button" data-generate-product="${escapeHtml(item.id)}">${item.presentation?.standalone_generation_supported ? 'AI 生成商品多视图' : 'AI 生成主体参考图'}</button>` : ''}
      ${group === 'scenes' ? `<button class="btn small ${sceneGenerated ? '' : 'primary'}" type="button" data-edit-scene-world="${escapeHtml(item.id)}">${sceneGenerated ? '编辑 / 补齐场景世界' : '完善并生成场景世界'}</button>` : ''}
      ${needsProductVerification ? `<button class="btn small primary" type="button" data-verify-product="${escapeHtml(item.id)}">验证商品素材</button>` : ''}
    </div>
  </article>`;
}

function profileDetails(item = {}, group = '') {
  const profile = item.profile || {};
  const looks = Array.isArray(profile.look_profiles) ? profile.look_profiles : [];
  const rows = group === 'people' ? [
    ['身份 / 关系', profile.roleName || item.role],
    ['外貌、气质与年龄', profile.appearanceText],
    ...(looks.length ? looks.map((look, index) => [`造型 ${index + 1} · ${look.name || '未命名'}`, `${(look.scene_names || look.scene_ids || []).join('、') || '未限定场景'}｜${look.wardrobeText || ''}`]) : [['服装 / 鞋 / 配饰', profile.wardrobeText]]),
    ['发型 / 妆造', profile.hairMakeupText],
    ['禁止项', profile.negativeText],
  ] : group === 'animals' ? [
    ['类型', profile.type], ['品种', profile.breed], ['外观特征', profile.appearance],
  ] : [];
  if (!rows.length) return '';
  return `<section class="drawer-profile"><h3>${group === 'people' ? '人物设定' : '动物设定'}</h3>${rows.filter(([, value]) => value).map(([label, value]) => `<div><span>${escapeHtml(label)}</span><p>${escapeHtml(value)}</p></div>`).join('')}</section>`;
}

function dossierDetails(item = {}) {
  const sections = [
    ...(Array.isArray(item.look_assets) ? item.look_assets.map(look => mediaSection(`${look.name || '人物'}造型档案`, look.dossier_sheet?.image_url ? [{ image_url: look.dossier_sheet.image_url, label: look.name }] : [])) : []),
    mediaSection('人物分类档案', item.category_atlases),
    mediaSection('身份与形象视图', item.identity_views, 'is-portrait-grid'),
    mediaSection('表情记录', item.expressions, 'is-portrait-grid'),
    mediaSection('剧情动作姿态', item.base_actions, 'is-portrait-grid'),
  ].join('');
  return sections ? `<details class="raw-view-details dossier-atomic-details"><summary>查看单图素材（点击任意图片放大）</summary>${sections}</details>` : '';
}


function personEditForm(item = {}) {
  const profile = item.profile || {};
  const field = (name, label, value, textarea = false) => `<label><span>${label}</span>${textarea
    ? `<textarea name="${name}" rows="3">${escapeHtml(value || '')}</textarea>`
    : `<input name="${name}" value="${escapeHtml(value || '')}">`}</label>`;
  return `<details class="person-edit-panel"><summary>修改人物信息</summary><form data-person-edit>
    <div class="form-grid two">${field('displayName', '人物名称', profile.displayName)}${field('roleName', '身份 / 关系', profile.roleName || item.role)}</div>
    ${field('appearanceText', '外貌、气质与年龄（请在正文写明实际年龄）', profile.appearanceText, true)}
    ${renderPersonLookEditors(profile)}<p class="form-hint">每套造型会独立补齐服装组成、鞋履、配饰、配色和面料；不会再把跨时代或换装状态合并。</p>
    ${field('negativeText', '禁止项', profile.negativeText, true)}
    <div class="assist-form-actions"><button class="btn" type="button" data-ai-assist-person>AI 帮写人物设定</button><button class="btn primary" type="submit">保存人物信息</button></div>
  </form></details>`;
}

let planningDetailsPromise; async function openDrawer(item, group, handlers = {}) {
  planningDetailsPromise ||= import('./assetCenterPlanningDetails.js?v=20260810-scene-config-release-rebase-v130');
  return (await planningDetailsPromise).openAssetDrawer(item, group, handlers, {
    groupLabel: groupLabel(group), generatable: GENERATABLE.has(group),
    mediaSection, profileDetails, legacyDossierBoard, dossierDetails, personEditForm,
  });
}

function renderSections(assets = {}, total = 0) {
  if (!total) return `<div class="asset-total-empty">${emptyState({
    title: '当前项目还没有可用资产',
    body: '先完善人物或动物档案，也可以上传已有的商品、LOGO、场景和道具参考。',
    action: '添加人物', actionId: 'people',
  })}</div>`;
  const missing = GROUPS.filter(([key]) => !(assets[key] || []).length).map(([, label]) => label);
  return `${missing.length ? `<div class="asset-missing-strip"><span>尚未建立</span><b>${missing.map(escapeHtml).join('、')}</b><small>可通过上方分类进入后添加</small></div>` : ''}
    ${GROUPS.map(([key, label]) => {
      const rows = assets[key] || [];
      return `<section class="asset-section" data-asset-section="${key}" ${rows.length ? '' : 'hidden'}>
        <div class="section-title"><h2>${escapeHtml(label)}</h2><span>${rows.length}</span><button class="btn small" type="button" data-add-asset="${key}">+ 添加${escapeHtml(label)}</button></div>
        <div data-section-body>${rows.length ? `<div class="asset-grid">${rows.map(item => assetCard(item, key)).join('')}</div>` : emptyState({ title: `尚未建立${label}`, body: '可以上传已有参考，或先完善该主体档案。', action: `添加${label}`, actionId: key })}</div>
      </section>`;
    }).join('')}`;
}

export async function mount(host, context) {
  const { store, bundle } = context;
  const assets = bundle?.assets || {};
  let assistModulePromise;
  const runAssist = async (kind, ...args) => (await (assistModulePromise ||= import('./assetCenterAssist.js?v=20260810-scene-config-release-rebase-v130'))).createAssetAssistHandlers(bundle)[kind](...args);
  const assistPerson = (...args) => runAssist('assistPerson', ...args); const assistScene = (...args) => runAssist('assistScene', ...args);
  const total = GROUPS.reduce((sum, [key]) => sum + (assets[key]?.length || 0), 0);
  const planEligibility = bundle?.navigation?.asset_plan_eligibility || {};
  const assetPlanReady = planEligibility.eligible === true;
  const paidAssetDisabled = assetPlanReady ? '' : 'disabled title="当前没有通过本版本合同的 Active Plan"';
  const missingSubjectCount = (assets.people || []).filter(item => subjectNeedsGeneration(item, 'human')).length
    + (assets.animals || []).filter(item => subjectNeedsGeneration(item, 'animal')).length;
  const missingSceneCount = (assets.scenes || []).filter(sceneNeedsGeneration).length;
  const { billingReviewRequired, billingReviewSupportId, visualActionLabel } = visualGenerationState(bundle, missingSubjectCount, missingSceneCount);
  host.innerHTML = `
    <section class="view-head">
      <div><h1>资产中心</h1><p>人物、动物、展示主体、LOGO、场景与机位分别建档；材料墙、展台等空间成果不再冒充独立商品。</p></div>
      <div class="view-actions asset-primary-actions"><button class="btn" type="button" data-select-person>选择已有人物素材</button><button class="btn" type="button" data-upload-real-person>上传真人素材</button><button class="btn" type="button" data-generate-subjects ${paidAssetDisabled}>AI 生成人物 / 动物</button><button class="btn" type="button" data-generate-product-main ${paidAssetDisabled}>${assets.products?.[0]?.presentation?.standalone_generation_supported ? 'AI 生成独立商品' : '添加 / 生成展示主体'}</button><button class="btn" type="button" data-build-scenes>${assets.scenes?.length ? '重新建立场景规划' : '建立场景规划'}</button></div>
    </section>
    <div class="guide">点击人物卡查看完整人物档案、四视图、设定和版本。生成操作只会在确认后提交。</div>
    ${assetPlanReady ? `<section class="card asset-visual-next-step" aria-label="人物与场景视觉生成步骤">
      <div><span class="status-tag is-success">方案已建立</span><h2>接下来生成视觉资产</h2><p>当前方案包含 ${assets.people?.length || 0} 个人物、${assets.animals?.length || 0} 个动物和 ${assets.scenes?.length || 0} 个场景。图片生成会产生模型调用，每类资产都会在提交前单独确认，不会因刚才确认参考理解而自动付费。</p></div>
      <div class="asset-visual-next-actions"><button class="btn primary" type="button" data-generate-visual-assets ${(missingSubjectCount || missingSceneCount) ? '' : 'disabled'}>${visualActionLabel}</button><button class="btn" type="button" data-generate-missing-subjects ${missingSubjectCount ? '' : 'disabled'}>仅生成人物 / 动物</button><button class="btn" type="button" data-show-pending-scenes ${missingSceneCount ? '' : 'disabled'}>查看 / 单独生成场景</button></div>
    </section>` : `<section class="card asset-visual-next-step is-blocked" role="alert"><div><span class="status-tag is-danger">付费生成已锁定</span><h2>当前方案尚未通过本版本合同</h2><p>旧计划、失败计划或版本不一致的计划只能查看，不能提交人物、场景、图片或视频模型调用。请先完成当前版本的故事事实与场次规划。</p></div></section>`}
    <div class="tabs"><button class="tab active" type="button" data-asset-filter="all">全部 ${total}</button>${GROUPS.map(([key, label]) => `<button class="tab" type="button" data-asset-filter="${key}">${label} ${assets[key]?.length || 0}</button>`).join('')}</div>
    <input class="hidden-input" hidden type="file" accept="image/png,image/jpeg,image/webp" data-asset-upload-file>
    <div data-asset-sections>${renderSections(assets, total)}</div>
    ${renderSceneWorldWorkspace(bundle)}
    <section class="step-completion-card ${assetPlanReady ? 'is-ready' : ''}">
      <div><b>${assetPlanReady ? '资产方案已建立' : '正在建立资产方案'}</b><span>${assetPlanReady ? '请核对人物、动物、商品与场景是否符合参考视频；确认后，当前方案会成为剧情室的权威输入。' : '资产规划完成前不会开放剧情室，页面会在后台任务完成后自动更新。'}</span></div>
      <button class="btn primary" type="button" data-confirm-assets ${assetPlanReady ? '' : 'disabled'}>确认资产方案，进入剧情室</button>
    </section>`;

  bindSceneWorldWorkspace(host, bundle, store);
  bindMediaLightbox(host);

  const generationKeys = new Map();
  const generate = async (target = null, group = '', button = null) => {
    const intent = target?.subject_id || 'all';
    const requestKey = generationKeys.get(intent) || `${bundle.project.id}:${intent}:${globalThis.crypto?.randomUUID?.() || Date.now()}`;
    generationKeys.set(intent, requestKey);
    const payload = subjectGenerationPayload(bundle, target, requestKey);
    const validation = generationValidation(payload);
    if (validation) { toast(validation, 'warning'); return false; }
    const selected = payload.subject_targets?.length || payload.expected_people + payload.expected_animals;
    const regeneratingCompletePerson = group === 'people' && personAssetState(target || {}) === 'complete_dossier';
    const lookCount = payload.cast_profiles.reduce((sum, profile) => sum + Math.max(1, profile.look_profiles?.length || 0), 0);
    const lookNotice = lookCount > payload.expected_people ? `当前 ${payload.expected_people} 个人物共包含 ${lookCount} 套造型；每套造型会分别生成独立档案并产生相应模型调用。\n\n` : '';
    const confirmationBase = regeneratingCompletePerson
      ? `将为“${target.name}”重新生成视觉档案：身体视角、面部与发型、6 种表情、6 种动作，以及服装、鞋履和配饰细节，共 4 个分类图集和 20 项拆分视图。人物身份、剧情蓝图、文字故事板、场景和人物场景分配保持不变；完成后只需要刷新草图、关键帧和视频。`
      : `本次将提交 ${selected} 个缺失或选中的主体生成。系统会先保留用户设定并自动补齐缺少的服装、鞋履、配饰、配色和面料，再调用图片模型；未选且已有四视图的主体会原样保留。`;
    const confirmation = `${lookNotice}${confirmationBase}`;
    if (!await confirmDialog(confirmation, {
      title: regeneratingCompletePerson ? `重生成${target.name}的完整人物档案` : (target ? `生成${target.name}的完整资产` : '生成人物 / 动物资产'),
      confirmText: regeneratingCompletePerson ? '确认重生成完整档案' : '确认开始生成',
    })) return false;
    try {
      setButtonBusy(button, true, regeneratingCompletePerson ? '正在重生成完整档案…' : '正在生成完整档案…', { elapsed: true });
      await authorizeBillingReviews({
        bundle,
        lane: 'subjects',
        subjectId: target?.subject_id || target?.profile?.id || '',
      });
      await store.runStage('subject-assets', payload);
      toast(regeneratingCompletePerson ? '人物视觉档案重生成已提交；剧情、文字故事板和场景分配会继续保留。' : '人物或动物资产生成已提交，页面顶部会持续显示阶段、百分比和耗时。', 'success');
      generationKeys.delete(intent);
      return true;
    } catch (error) {
      toast(error.message, 'danger');
      return false;
    } finally {
      setButtonBusy(button, false);
    }
  };

  const generateProduct = async (item = null, button = null) => {
    const name = item?.name || bundle.brief?.product_subject || '';
    if (!name) return toast('请先在目标与材料中填写商品或广告主体。', 'warning');
    const standalone = item?.presentation?.standalone_generation_supported !== false;
    const body = standalone
      ? `将为“${name}”生成正面、三分之四、侧面和细节视图。完成后仍需进行商品一致性验证。`
      : `将为“${name}”生成一张可复用的展示主体参考图，用于后续场景、分镜和关键帧锁定。它不会伪装成独立商品四视图。`;
    if (!await confirmDialog(body, { title: standalone ? 'AI 生成商品资产' : 'AI 生成展示主体参考图', confirmText: '确认生成' })) return false;
    try {
      setButtonBusy(button, true, '正在提交商品生成…', { elapsed: true });
      await store.runStage('product-assets', { product_name: name, description: item?.description || '', reference_only: !standalone });
      toast(`${standalone ? '商品资产' : '展示主体参考图'}生成已提交，进度和耗时将在页面顶部显示。`, 'success');
      return true;
    } catch (error) { toast(error.message, 'danger'); return false; } finally { setButtonBusy(button, false); }
  };

  const generateScene = async (item, button = null) => {
    const sceneGenerated = Boolean(item.layout?.image_url || item.view_images?.length || item.cameras?.some(camera => camera.image_url));
    const repairKeys = item.repair_plan?.action === 'regenerate_failed_views' && Array.isArray(item.repair_plan?.view_keys)
      ? item.repair_plan.view_keys.filter(Boolean) : [];
    const repairing = sceneGenerated && repairKeys.length > 0;
    const prompt = sceneGenerated
      ? (repairing
        ? `“${item.name}”已有成功视图，本次只补齐 ${repairKeys.length} 个未通过的视图（${repairKeys.join('、')}）；其余成功图片会原样保留，不会重复调用。`
        : `“${item.name}”已有空间母版和机位。当前没有可定向补齐的失败视图；继续将完整重建该场景并产生全部视图的模型调用。`)
      : `将先保留用户填写的场景设定并自动补齐布局关系、材质、光线、互动点和行动路线，再生成“${item.name}”的空间母版、场景视角和机位图。`;
    if (!await confirmDialog(prompt, { title: sceneGenerated ? '重新生成场景与机位' : '生成场景与机位', confirmText: sceneGenerated ? '确认重新生成' : '确认生成' })) return false;
    try {
      setButtonBusy(button, true, '正在提交场景生成…', { elapsed: true });
      await authorizeBillingReviews({ bundle, lane: 'scenes', sceneId: item.id });
      await store.runStage('scene-assets', { space_id: item.id, scene_id: item.id, name: item.name, regenerate: sceneGenerated, repair_existing: repairing });
      toast(`${sceneGenerated ? '场景与机位重新生成' : '场景与机位生成'}已提交，进度和耗时将在页面顶部显示。`, 'success');
      return true;
    } catch (error) { toast(error.message, 'danger'); return false; } finally { setButtonBusy(button, false); }
  };

  const savePerson = async (item, values, button = null) => {
    const normalizedValues = collectPersonLookValues(values, item.profile || {});
    const profiles = (assets.people || []).map(row => row.profile || {}).map(profile => (
      String(profile.id || '') === String(item.profile?.id || '') ? { ...profile, ...normalizedValues } : profile
    ));
    try {
      setButtonBusy(button, true, '正在保存…', { elapsed: true });
      await store.updateRequest({ cast_profiles: profiles });
      toast('人物信息已保存；下次生成会使用最新设定。', 'success');
      return true;
    } catch (error) { toast(error.message, 'danger'); return false; } finally { setButtonBusy(button, false); }
  };

  const saveProduct = async (item, values, button = null) => {
    try {
      setButtonBusy(button, true, '正在保存…', { elapsed: true });
      await store.updateRequest({
        product_subject: String(values.product_subject || '').trim(),
        product_presentation: {
          ...(item.presentation || {}),
          mode: String(values.mode || '').trim(),
          description: String(values.description || '').trim(),
          source: 'user_edit',
        },
      });
      toast('展示主体已保存；后续场景、剧情和分镜会使用最新设置。', 'success');
      return true;
    } catch (error) { toast(error.message, 'danger'); return false; } finally { setButtonBusy(button, false); }
  };

  const saveScene = async (item, values, button = null) => {
    const sourcePlan = bundle.asset_editor?.scene_plan || { scene_mode: 'single', spaces: [] };
    const plan = JSON.parse(JSON.stringify(sourcePlan));
    const index = (plan.spaces || []).findIndex(space => String(space.id || space.space_id || space.scene_id) === String(item.id));
    if (index < 0) return toast('当前场景不在权威场景计划中，已停止保存，避免覆盖其他场景。', 'danger');
    const current = plan.spaces[index];
    const currentSpec = current.scene_spec || current.sceneSpec || {};
    const cameraSource = item.camera_plan?.length ? item.camera_plan : (item.cameras || []);
    plan.spaces[index] = {
      ...current,
      name: String(values.name || '').trim(),
      description: String(values.description || '').trim(),
      story_purpose: String(values.story_purpose || '').trim(),
      scene_spec: {
        ...currentSpec,
        layoutText: String(values.layout || '').trim(),
        materialLightText: String(values.materials || '').trim(),
        interactionText: String(values.interaction || '').trim(),
        negativeText: String(values.negative || '').trim(),
        cameraPlan: cameraSource.map((camera, cameraIndex) => ({
          ...camera,
          movement: String(values[`camera_movement_${cameraIndex}`] || camera.movement || '').trim(),
        })),
      },
    };
    try {
      setButtonBusy(button, true, '正在保存…', { elapsed: true });
      await store.updateRequest({ scene_plan: plan, changed_domains: ['scene'] });
      toast('场景与机位预案已保存；不兼容的旧场景和下游结果已按版本规则处理。', 'success');
      return true;
    } catch (error) { toast(error.message, 'danger'); return false; } finally { setButtonBusy(button, false); }
  };

  const generateProp = async (owner, prop, button = null, referenceFile = null) => {
    const input = { ...prop };
    if (!String(input.name || '').trim() || !String(input.description || '').trim()) return toast('请填写道具名称和外观描述。', 'warning');
    if (!await confirmDialog(`道具“${input.name}”会绑定到人物“${owner.name}”，生成身份视图和必要状态图。`, { title: '生成人物随身道具', confirmText: '确认生成' })) return false;
    try {
      setButtonBusy(button, true, '正在提交道具生成…', { elapsed: true });
      if (referenceFile instanceof File && referenceFile.size) {
        const uploaded = await store.upload(referenceFile, 'prop_reference');
        const media = uploaded.asset || uploaded.data || {};
        input.reference_image_url = media.image_url || media.url || media.file_url || '';
      }
      await store.runStage('prop-assets', {
        ...input,
        id: input.id || `prop_${Date.now()}`,
        owner_id: owner.subject_id || owner.profile?.id || owner.id,
        type: input.type || 'handheld', quantity: Number(input.quantity || 1) || 1,
      });
      toast('人物随身道具生成已提交，进度和耗时将在页面顶部显示。', 'success');
      return true;
    } catch (error) { toast(error.message, 'danger'); return false; } finally { setButtonBusy(button, false); }
  };

  const verifyProduct = async (item, button = null) => {
    if (!item?.image_url) {
      toast('请先添加商品图片素材。', 'warning');
      return false;
    }
    if (!await confirmDialog('商品验证会调用一次视觉审核模型，检查外观、形状、颜色和材质一致性；确认后才会提交。', {
      title: `验证商品素材：${item.name || '当前商品'}`,
      confirmText: '确认开始验证',
    })) return false;
    try {
      setButtonBusy(button, true, '正在验证…', { elapsed: true });
      const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(bundle.project.id)}/product-verify`, {
        method: 'POST',
        body: {},
        timeoutMs: 360000,
      });
      const status = data.product_contract?.status || '';
      if (status !== 'verified') {
        toast(status === 'rejected' ? '商品素材未通过一致性验证，请查看原因或更换图片。' : '商品验证暂未完成，请稍后重试。', 'warning');
        await context.refreshShell();
        return false;
      }
      toast('商品素材已通过一致性验证。', 'success');
      await context.refreshShell();
      return true;
    } catch (error) {
      toast(error.message, 'danger');
      return false;
    } finally {
      setButtonBusy(button, false);
    }
  };

  host.querySelectorAll('[data-asset-filter]').forEach(button => button.addEventListener('click', () => {
    const filter = button.dataset.assetFilter;
    host.querySelectorAll('[data-asset-filter]').forEach(item => item.classList.toggle('active', item === button));
    host.querySelector('.asset-missing-strip')?.toggleAttribute('hidden', filter !== 'all');
    host.querySelectorAll('[data-asset-section]').forEach(section => {
      const rows = assets[section.dataset.assetSection] || [];
      section.hidden = filter === 'all' ? !rows.length : section.dataset.assetSection !== filter;
    });
  }));

  const showAsset = button => {
    const group = button.dataset.assetGroup;
    const item = (assets[group] || []).find(asset => String(asset.id) === button.dataset.assetId);
    if (item) openDrawer(item, group, { onGenerate: generate, onVerifyProduct: verifyProduct, onSavePerson: savePerson, onAssistPerson: assistPerson, onSaveProduct: saveProduct, onSaveScene: saveScene, onAssistScene: assistScene, onGenerateScene: generateScene, onGenerateProp: generateProp, onGenerateProduct: generateProduct, onUploadProduct: () => openUpload('products'), returnFocus: button });
  };
  host.querySelectorAll('[data-asset-id]').forEach(button => button.addEventListener('click', () => showAsset(button)));
  host.querySelectorAll('[data-generate-asset]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const item = (assets[button.dataset.generateGroup] || []).find(asset => String(asset.id) === button.dataset.generateAsset);
    if (item) generate(item, button.dataset.generateGroup, button);
  }));
  host.querySelectorAll('[data-verify-product]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const item = (assets.products || []).find(asset => String(asset.id) === button.dataset.verifyProduct);
    if (item) verifyProduct(item, button);
  }));
  host.querySelectorAll('[data-generate-product]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const item = (assets.products || []).find(asset => String(asset.id) === button.dataset.generateProduct);
    generateProduct(item, button);
  }));
  host.querySelectorAll('[data-upload-product]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    openUpload('products');
  }));
  host.querySelectorAll('[data-edit-scene-world]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const item = (assets.scenes || []).find(asset => String(asset.id) === button.dataset.editSceneWorld);
    if (item) openDrawer(item, 'scenes', { onSaveScene: saveScene, onAssistScene: assistScene, onGenerateScene: generateScene, onGenerateProp: generateProp, returnFocus: button });
  }));
  host.querySelectorAll('[data-sync-person-provider]').forEach(button => button.addEventListener('click', async event => {
    event.stopPropagation();
    try {
      setButtonBusy(button, true, '正在提交同步…', { elapsed: true });
      await store.runStage('person-provider-sync');
      toast('Seedance 人物 ID 同步已提交；失败时可继续从该按钮单独重试，不会重新生成人物。', 'success');
    } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(button, false); }
  }));

  let uploadGroup = '';
  const uploadInput = host.querySelector('[data-asset-upload-file]');
  const openUpload = group => {
    if (group === 'people') { openRealPersonFlow({ context, taskId: bundle.project.id }); return; }
    uploadGroup = group;
    uploadInput.click();
  };
  host.querySelectorAll('[data-add-asset]').forEach(button => button.addEventListener('click', () => openUpload(button.dataset.addAsset)));
  host.querySelectorAll('[data-empty-action]').forEach(button => button.addEventListener('click', () => openUpload(button.dataset.emptyAction)));
  uploadInput.addEventListener('change', async () => {
    const file = uploadInput.files?.[0];
    if (!file || !uploadGroup) return;
    try {
      const roleMap = { people: 'person_reference', animals: 'animal_reference', products: 'product_reference', logos: 'brand_logo', scenes: 'scene_reference', props: 'prop_reference' };
      const uploaded = await store.upload(file, roleMap[uploadGroup] || 'asset');
      const asset = uploaded.asset || uploaded.data;
      const materialRoles = { people: 'person', animals: 'animal', products: 'product', logos: 'logo', scenes: 'scene', props: 'prop' };
      await store.attachMaterial(materialRoles[uploadGroup], asset, { authorized: uploadGroup === 'logos' });
      toast('资产已添加到当前项目。', 'success');
      await context.refreshShell();
    } catch (error) { toast(error.message, 'danger'); } finally { uploadInput.value = ''; }
  });

  host.querySelectorAll('[data-generate-subjects], [data-generate-missing-subjects]').forEach(button => button.addEventListener('click', event => generate(null, '', event.currentTarget)));
  bindCombinedVisualGeneration({
    host, bundle, assets, store, missingSubjectCount, missingSceneCount,
    billingReviewRequired, billingReviewSupportId, subjectGenerationPayload,
    generationValidation, sceneNeedsGeneration,
  });
  host.querySelector('[data-show-pending-scenes]')?.addEventListener('click', () => {
    host.querySelector('[data-asset-section="scenes"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('请在待生成的场景卡中核对设定，再点击“生成场景与机位”。', 'info');
  });
  host.querySelector('[data-select-person]').addEventListener('click', () => openActorLibrary({ store, context, taskId: bundle.project.id }));
  host.querySelector('[data-upload-real-person]').addEventListener('click', () => openRealPersonFlow({ context, taskId: bundle.project.id }));
  host.querySelector('[data-generate-product-main]').addEventListener('click', event => {
    const item = (assets.products || [])[0] || null;
    if (item && !item.presentation?.standalone_generation_supported) {
      openDrawer(item, 'products', { onGenerate: generate, onVerifyProduct: verifyProduct, onSavePerson: savePerson, onAssistPerson: assistPerson, onSaveProduct: saveProduct, onSaveScene: saveScene, onAssistScene: assistScene, onGenerateScene: generateScene, onGenerateProp: generateProp, onGenerateProduct: generateProduct, onUploadProduct: () => openUpload('products'), returnFocus: event.currentTarget });
      return;
    }
    generateProduct(item, event.currentTarget);
  });
  host.querySelector('[data-build-scenes]').addEventListener('click', async event => {
    const button = event.currentTarget;
    const replanSceneCoverage = Boolean(assets.scenes?.length);
    if (replanSceneCoverage && !await confirmDialog('将按完整故事节拍重新规划场景卡，保留现有人物和道具。此操作只调用文本规划模型，不会生成或扣费创建场景图片。', { title: '重新建立场景规划', confirmText: '确认重新规划' })) return;
    try {
      button.classList.add('primary');
      setButtonBusy(button, true, '正在建立…', { elapsed: true });
      await store.runStage('scene-config', replanSceneCoverage ? { replan_scene_coverage: true } : {});
      toast(replanSceneCoverage ? '故事场景覆盖重新规划已提交，请稍后查看状态。' : '场景规划已提交，请稍后查看状态。', 'success');
      await context.refreshShell();
    } catch (error) { toast(error.message, 'danger'); } finally {
      setButtonBusy(button, false);
      button.classList.remove('primary');
    }
  });
  host.querySelector('[data-confirm-assets]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, '正在确认…');
      await store.updateRequest({ asset_setup_confirmed: true });
      toast('资产方案已确认，剧情室将使用当前人物、动物、商品和场景。', 'success');
      context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=plot`);
    } catch (error) {
      toast(error.message, 'danger');
      setButtonBusy(button, false);
    }
  });
}
